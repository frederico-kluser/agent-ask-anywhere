import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import './setup-tmpdir.js';
import { SkillsManager } from '../src/skills/manager.js';
import { RecordingBuffer } from '../src/skills/recording-buffer.js';

const SKILLS_ROOT = process.env.AAA_SKILLS_ROOT!;

describe('RecordingBuffer', () => {
  let mgr: SkillsManager;

  before(async () => {
    mgr = new SkillsManager();
    await mgr.init();
  });

  after(async () => {
    await mgr.close();
  });

  it('starts inactive', () => {
    const buf = new RecordingBuffer(mgr);
    assert.equal(buf.isActive(), false);
  });

  it('start() makes it active', () => {
    const buf = new RecordingBuffer(mgr);
    buf.start();
    assert.equal(buf.isActive(), true);
    buf.abort();
  });

  it('push() while not active is a no-op', async () => {
    const buf = new RecordingBuffer(mgr);
    buf.push({ type: 'click', selectors: [['#x']] });
    const result = await buf.stop();
    assert.equal(result, null);
  });

  it('push() validates step shape and silently drops invalid steps', async () => {
    const buf = new RecordingBuffer(mgr);
    buf.start();
    buf.push({ type: 'click' /* missing selectors */ });
    buf.push({ type: 'gibberish' });
    const result = await buf.stop();
    assert.equal(result, null, 'no valid steps → no skill saved');
  });

  it('stop() with valid steps creates a draft skill and returns name+count', async () => {
    const buf = new RecordingBuffer(mgr);
    buf.start();
    buf.push({ type: 'navigate', url: 'https://example.com' });
    buf.push({ type: 'click', selectors: [['#submit']] });
    const result = await buf.stop();
    assert.notEqual(result, null);
    assert.equal(result?.stepCount, 2);
    assert.match(result?.name ?? '', /^draft-/);
    assert.equal(existsSync(join(SKILLS_ROOT, result?.name ?? '', 'flow.json')), true);
    assert.equal(existsSync(join(SKILLS_ROOT, result?.name ?? '', 'SKILL.md')), true);
  });

  it('abort() resets state without writing anything', async () => {
    const buf = new RecordingBuffer(mgr);
    buf.start();
    buf.push({ type: 'click', selectors: [['#x']] });
    buf.abort();
    assert.equal(buf.isActive(), false);
    const result = await buf.stop();
    assert.equal(result, null);
  });

  it('stop() while not active returns null', async () => {
    const buf = new RecordingBuffer(mgr);
    const result = await buf.stop();
    assert.equal(result, null);
  });

  it('start() resets the previous step buffer', async () => {
    const buf = new RecordingBuffer(mgr);
    buf.start();
    buf.push({ type: 'click', selectors: [['#a']] });
    buf.start();
    buf.push({ type: 'click', selectors: [['#b']] });
    const result = await buf.stop();
    assert.equal(result?.stepCount, 1);
  });
});
