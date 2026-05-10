import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import './setup-tmpdir.js';
import { SkillsManager } from '../src/skills/manager.js';

const SKILLS_ROOT = process.env.AAA_SKILLS_ROOT!;

describe('SkillsManager', () => {
  let mgr: SkillsManager;

  before(async () => {
    mgr = new SkillsManager();
    await mgr.init();
  });

  after(async () => {
    await mgr.close();
  });

  it('creates SKILLS_ROOT on init if missing', () => {
    assert.equal(existsSync(SKILLS_ROOT), true);
  });

  it('list() is empty initially', () => {
    assert.deepEqual(mgr.list(), []);
  });

  it('create() persists SKILL.md + flow.json and updates the cache', async () => {
    const created = await mgr.create({
      name: 'test-skill',
      description: 'a test skill for unit tests',
      flow: {
        version: '1.0',
        title: 't',
        steps: [{ type: 'navigate', url: 'https://example.com' }],
      },
    });
    assert.equal(created.name, 'test-skill');
    assert.equal(existsSync(join(SKILLS_ROOT, 'test-skill', 'SKILL.md')), true);
    assert.equal(existsSync(join(SKILLS_ROOT, 'test-skill', 'flow.json')), true);
    assert.equal(mgr.get('test-skill')?.name, 'test-skill');
    assert.equal(mgr.list().length, 1);
  });

  it('rejects create with invalid name (kebab regex)', async () => {
    await assert.rejects(() =>
      mgr.create({
        name: 'Bad_Name',
        description: 'aaaaaaaaaa',
        flow: {
          version: '1.0',
          title: 't',
          steps: [{ type: 'navigate', url: 'https://example.com' }],
        },
      }),
    );
  });

  it('update() merges patches without overwriting unspecified fields', async () => {
    const before = mgr.get('test-skill');
    assert.notEqual(before, undefined);
    const updated = await mgr.update('test-skill', {
      description: 'updated description for test',
    });
    assert.notEqual(updated, null);
    assert.equal(updated?.description, 'updated description for test');
    assert.equal(updated?.flow.steps.length, before?.flow.steps.length);
  });

  it('update() returns null for non-existent skill', async () => {
    const r = await mgr.update('does-not-exist', { description: 'aaaaaaaaaa' });
    assert.equal(r, null);
  });

  it('scan picks up an externally-modified SKILL.md (rejects if invalid)', async () => {
    const path = join(SKILLS_ROOT, 'test-skill', 'SKILL.md');
    const original = await readFile(path, 'utf8');
    await writeFile(path, '---\nname: NOT-VALID\n---\nbody', 'utf8');
    // force a manual rescan via private method substitute: re-init
    const mgr2 = new SkillsManager();
    await mgr2.init();
    assert.equal(mgr2.get('test-skill'), undefined, 'invalid frontmatter should drop the skill');
    await mgr2.close();
    await writeFile(path, original, 'utf8');
  });

  it('delete() removes the directory and updates the cache', async () => {
    const ok = await mgr.delete('test-skill');
    assert.equal(ok, true);
    assert.equal(existsSync(join(SKILLS_ROOT, 'test-skill')), false);
    assert.equal(mgr.get('test-skill'), undefined);
  });

  it('delete() returns false for non-existent skill', async () => {
    const ok = await mgr.delete('does-not-exist');
    assert.equal(ok, false);
  });
});
