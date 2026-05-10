import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import AdmZip from 'adm-zip';
import './setup-tmpdir.js';
import { exportSkillZip, importSkillZip } from '../src/skills/export-import.js';
import { SkillsManager } from '../src/skills/manager.js';

const SKILLS_ROOT = process.env.AAA_SKILLS_ROOT!;

describe('export/import', () => {
  let mgr: SkillsManager;

  before(async () => {
    mgr = new SkillsManager();
    await mgr.init();
    await mgr.create({
      name: 'roundtrip',
      description: 'a skill that exports and re-imports',
      flow: {
        version: '1.0',
        title: 't',
        steps: [{ type: 'navigate', url: 'https://example.com' }],
      },
    });
  });

  after(async () => {
    await mgr.close();
  });

  it('exportSkillZip returns a non-empty buffer for an existing skill', async () => {
    const buf = await exportSkillZip('roundtrip');
    assert.notEqual(buf, null);
    assert.equal(Buffer.isBuffer(buf), true);
    if (!buf) return;
    const zip = new AdmZip(buf);
    const names = zip.getEntries().map((e) => e.entryName);
    assert.equal(
      names.some((n) => n === 'roundtrip/SKILL.md'),
      true,
      `expected roundtrip/SKILL.md in zip, got ${JSON.stringify(names)}`,
    );
    assert.equal(
      names.some((n) => n === 'roundtrip/flow.json'),
      true,
    );
  });

  it('exportSkillZip returns null for unknown skill', async () => {
    const buf = await exportSkillZip('does-not-exist');
    assert.equal(buf, null);
  });

  it('importSkillZip rejects empty zip', async () => {
    const empty = new AdmZip();
    await assert.rejects(() => importSkillZip(empty.toBuffer(), mgr), /empty zip/);
  });

  it('importSkillZip rejects invalid skill name in zip', async () => {
    const zip = new AdmZip();
    zip.addFile('Bad_Name/SKILL.md', Buffer.from('hi'));
    await assert.rejects(() => importSkillZip(zip.toBuffer(), mgr), /invalid skill name/);
  });

  it('importSkillZip rejects zip-slip attempts (../../etc/passwd)', async () => {
    const zip = new AdmZip();
    zip.addFile('evil/SKILL.md', Buffer.from('valid'));
    zip.addFile('evil/../../etc/passwd', Buffer.from('owned'));
    await assert.rejects(
      () => importSkillZip(zip.toBuffer(), mgr),
      (err: unknown) =>
        err instanceof Error &&
        (/zip slip rejected/.test(err.message) || /zip entry outside/.test(err.message)),
    );
    // and the malicious target must NOT have been written:
    assert.equal(
      existsSync('/etc/passwd-aaa-test-marker'),
      false,
      'zip slip wrote outside the safe root',
    );
  });

  it('importSkillZip rejects entries outside the skill prefix', async () => {
    const zip = new AdmZip();
    zip.addFile('somethingelse/SKILL.md', Buffer.from('valid'));
    zip.addFile('somethingelse/data', Buffer.from('ok'));
    zip.addFile('escaped/file', Buffer.from('not under prefix'));
    await assert.rejects(() => importSkillZip(zip.toBuffer(), mgr), /zip entry outside skill root/);
  });

  it('round-trip: export → import preserves files', async () => {
    const buf = await exportSkillZip('roundtrip');
    assert.notEqual(buf, null);
    if (!buf) return;
    // delete original first
    await mgr.delete('roundtrip');
    assert.equal(existsSync(join(SKILLS_ROOT, 'roundtrip')), false);
    const result = await importSkillZip(buf, mgr);
    assert.equal(result.name, 'roundtrip');
    assert.equal(existsSync(join(SKILLS_ROOT, 'roundtrip', 'SKILL.md')), true);
    assert.equal(existsSync(join(SKILLS_ROOT, 'roundtrip', 'flow.json')), true);
  });
});
