import './setup-tmpdir.js';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('run.js + lobby-bootstrap.js parse with `node --check` (real syntax validation)', () => {
    // Catches accidental TS syntax leaking into the JS templates, mismatched
    // backticks, etc. that simple regex checks miss.
    const buf = buildSkillZip({
      frontmatter: {
        name: 'syntax-check',
        description: 'a description that is long enough',
        license: 'MIT',
        metadata: {},
        slots: [],
      },
      body: '# syntax-check\n',
      flow: {
        version: '1.0',
        title: 'syntax-check',
        steps: [{ type: 'navigate', url: 'https://example.com' }],
      },
    });
    const zip = new AdmZip(buf);
    const dir = mkdtempSync(join(tmpdir(), 'aaa-syntax-'));
    for (const name of ['run.js', 'lobby-bootstrap.js']) {
      const entry = zip.getEntry(`syntax-check/${name}`);
      assert.notEqual(entry, null);
      const filepath = join(dir, name);
      writeFileSync(filepath, entry!.getData());
      // execFileSync throws on non-zero exit; that's our assertion.
      execFileSync(process.execPath, ['--check', filepath], { stdio: 'pipe' });
    }
  });

  it('lobby-bootstrap.js exports ensureLobby + LOBBY_HOST/PORT', () => {
    const buf = buildSkillZip({
      frontmatter: {
        name: 'exports-test',
        description: 'a description that is long enough',
        license: 'MIT',
        metadata: {},
        slots: [],
      },
      body: '# exports-test\n',
      flow: {
        version: '1.0',
        title: 'exports-test',
        steps: [{ type: 'navigate', url: 'https://example.com' }],
      },
    });
    const src = new AdmZip(buf)
      .getEntry('exports-test/lobby-bootstrap.js')!
      .getData()
      .toString('utf8');
    assert.match(src, /module\.exports\s*=\s*\{[^}]*ensureLobby/);
    assert.match(src, /LOBBY_HOST/);
    assert.match(src, /LOBBY_PORT/);
  });
});
