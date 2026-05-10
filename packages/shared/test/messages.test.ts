import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { WSMessageSchema } from '../src/messages.js';

describe('WSMessageSchema', () => {
  it('parses hello with valid client', () => {
    const r = WSMessageSchema.safeParse({
      type: 'hello',
      client: 'extension',
      version: '1.0.0',
    });
    assert.equal(r.success, true);
  });

  it('rejects hello with unknown client', () => {
    const r = WSMessageSchema.safeParse({ type: 'hello', client: 'curl' });
    assert.equal(r.success, false);
  });

  it('parses ping/pong without payload', () => {
    assert.equal(WSMessageSchema.safeParse({ type: 'ping' }).success, true);
    assert.equal(WSMessageSchema.safeParse({ type: 'pong' }).success, true);
  });

  it('parses flow:run with default empty slots', () => {
    const r = WSMessageSchema.safeParse({ type: 'flow:run', flowId: 'send', runId: 'run-1' });
    assert.equal(r.success, true);
    if (r.success && r.data.type === 'flow:run') {
      assert.deepEqual(r.data.slots, {});
    }
  });

  it('rejects flow:run without runId (now required for multiplex)', () => {
    const r = WSMessageSchema.safeParse({ type: 'flow:run', flowId: 'send' });
    assert.equal(r.success, false);
  });

  it('parses step:result with required runId', () => {
    const r = WSMessageSchema.safeParse({
      type: 'step:result',
      runId: 'run-1',
      stepIdx: 0,
      ok: true,
      durationMs: 12,
    });
    assert.equal(r.success, true);
  });

  it('parses peer:register with role', () => {
    const r = WSMessageSchema.safeParse({ type: 'peer:register', role: 'extension' });
    assert.equal(r.success, true);
  });

  it('rejects peer:register with unknown role', () => {
    const r = WSMessageSchema.safeParse({ type: 'peer:register', role: 'fart' });
    assert.equal(r.success, false);
  });

  it('rejects step:result with negative stepIdx', () => {
    const r = WSMessageSchema.safeParse({
      type: 'step:result',
      runId: 'run-1',
      stepIdx: -1,
      ok: true,
    });
    assert.equal(r.success, false);
  });

  it('parses page:state with required fields', () => {
    const r = WSMessageSchema.safeParse({
      type: 'page:state',
      requestId: 'pg-1',
      url: 'https://example.com',
      title: 't',
      axTree: '[heading] Hello',
    });
    assert.equal(r.success, true);
  });

  it('rejects unknown discriminator', () => {
    const r = WSMessageSchema.safeParse({ type: 'wat' });
    assert.equal(r.success, false);
  });

  it('rejects payloads without a type field', () => {
    const r = WSMessageSchema.safeParse({ stepIdx: 0, ok: true });
    assert.equal(r.success, false);
  });

  it('parses skills:updated with empty list', () => {
    const r = WSMessageSchema.safeParse({ type: 'skills:updated', skills: [] });
    assert.equal(r.success, true);
  });
});
