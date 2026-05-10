import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import './setup-tmpdir.js';
import { RunHistory } from '../src/skills/run-history.js';

describe('RunHistory', () => {
  it('begin → step → end produces a valid JSONL file', async () => {
    const history = new RunHistory();
    history.ensureRoot();
    const runId = 'run-test-1';
    const flowId = 'send-message';
    history.begin(runId, flowId);
    history.step({
      type: 'step:result',
      runId,
      stepIdx: 0,
      ok: true,
      durationMs: 12,
    });
    history.step({
      type: 'step:result',
      runId,
      stepIdx: 1,
      ok: false,
      error: 'element not found',
      durationMs: 80,
    });
    history.end({
      type: 'flow:result',
      runId,
      flowId,
      ok: false,
      error: 'step #1 (click): element not found',
      durationMs: 100,
    });

    // file writes are async fire-and-forget; give the loop a tick to flush.
    await wait(50);

    const data = await history.read(flowId, runId);
    assert.notEqual(data, null);
    const lines = (data ?? '').trim().split('\n');
    assert.equal(lines.length, 4);

    const first = JSON.parse(lines[0]!) as { event: string; flowId: string };
    assert.equal(first.event, 'start');
    assert.equal(first.flowId, flowId);

    const last = JSON.parse(lines[3]!) as { event: string; ok: boolean };
    assert.equal(last.event, 'end');
    assert.equal(last.ok, false);
  });

  it('list() returns runs sorted desc by runId', async () => {
    const history = new RunHistory();
    history.ensureRoot();
    const flowId = 'list-sort-flow'; // distinct flowId so the previous test leaves no residue
    for (const id of ['run-001', 'run-002', 'run-003']) {
      history.begin(id, flowId);
      history.end({
        type: 'flow:result',
        runId: id,
        flowId,
        ok: true,
        durationMs: 10,
      });
    }
    await wait(50);
    const list = await history.list(flowId);
    const ids = list.map((r) => r.runId);
    assert.deepEqual(ids, ['run-003', 'run-002', 'run-001']);
  });

  it('read() returns null for unknown run', async () => {
    const history = new RunHistory();
    const data = await history.read('nope', 'run-doesnt-exist');
    assert.equal(data, null);
  });

  it('list() returns [] for unknown flowId', async () => {
    const history = new RunHistory();
    const list = await history.list('does-not-exist');
    assert.deepEqual(list, []);
  });

  it('step() before begin() does not write anything', async () => {
    const history = new RunHistory();
    history.ensureRoot();
    history.step({
      type: 'step:result',
      runId: 'orphan-run',
      stepIdx: 0,
      ok: true,
      durationMs: 10,
    });
    await wait(20);
    const data = await history.read('any-flow', 'orphan-run');
    assert.equal(data, null);
  });
});
