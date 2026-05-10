import './setup-tmpdir.js';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import AdmZip from 'adm-zip';
import { buildSkillZip } from '../src/skills/template.js';

describe('buildSkillZip', () => {
  it('emits a plug-and-play zip with SKILL.md, flow.json, run.js, lobby-bootstrap.js, package.json, meta.json', () => {
    const buf = buildSkillZip({
      frontmatter: {
        name: 'send-msg',
        description: 'send a message somewhere',
        license: 'MIT',
        metadata: {},
        slots: [{ name: 'recipient', type: 'string', description: 'who', required: true }],
      },
      body: '# send-msg\n\nbody here\n',
      flow: {
        version: '1.0',
        title: 'send',
        steps: [
          { type: 'navigate', url: 'https://example.com' },
          { type: 'type', selectors: [['#to']], value: '{{recipient}}' },
        ],
      },
    });
    assert.equal(Buffer.isBuffer(buf), true);
    const zip = new AdmZip(buf);
    const names = zip.getEntries().map((e) => e.entryName);
    for (const expected of [
      'send-msg/SKILL.md',
      'send-msg/flow.json',
      'send-msg/run.js',
      'send-msg/lobby-bootstrap.js',
      'send-msg/package.json',
      'send-msg/meta.json',
      'send-msg/INSTALL.md',
    ]) {
      assert.ok(names.includes(expected), `missing ${expected} in zip; got ${names.join(', ')}`);
    }
  });

  it('meta.json contains name + slots', () => {
    const buf = buildSkillZip({
      frontmatter: {
        name: 'a-b',
        description: 'a description that is long enough',
        license: 'MIT',
        metadata: {},
        slots: [{ name: 'x', type: 'string', description: 'x slot', required: true }],
      },
      body: '# a-b\n',
      flow: {
        version: '1.0',
        title: 'a-b',
        steps: [{ type: 'navigate', url: 'https://example.com' }],
      },
    });
    const zip = new AdmZip(buf);
    const meta = zip.getEntry('a-b/meta.json');
    assert.notEqual(meta, null);
    const parsed = JSON.parse(meta!.getData().toString('utf8'));
    assert.equal(parsed.name, 'a-b');
    assert.equal(parsed.slots.length, 1);
    assert.equal(parsed.slots[0].name, 'x');
  });

  it('run.js is executable Node JavaScript (not TS)', () => {
    const buf = buildSkillZip({
      frontmatter: {
        name: 't',
        description: 'a description that is long enough',
        license: 'MIT',
        metadata: {},
        slots: [],
      },
      body: '# t\n',
      flow: {
        version: '1.0',
        title: 't',
        steps: [{ type: 'navigate', url: 'https://example.com' }],
      },
    });
    const zip = new AdmZip(buf);
    const run = zip.getEntry('t/run.js');
    assert.notEqual(run, null);
    const src = run!.getData().toString('utf8');
    assert.match(src, /#!\/usr\/bin\/env node/);
    assert.match(src, /require\('node:http'\)/);
    assert.match(src, /lobby-bootstrap/);
  });
});
