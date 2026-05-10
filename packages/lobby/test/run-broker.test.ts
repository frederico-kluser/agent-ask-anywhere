import './setup-tmpdir.js';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { WebSocketServer } from 'ws';
import { RunBroker } from '../src/run-broker.js';

type FakePeer = { readyState: number; OPEN: number; sent: string[]; send: (s: string) => void };

function makeFakePeer(): FakePeer {
  const peer: FakePeer = {
    readyState: 1,
    OPEN: 1,
    sent: [],
    send(s: string) {
      this.sent.push(s);
    },
  };
  return peer;
}

describe('RunBroker', () => {
  it('hasExtension() is false when no peer is registered', () => {
    const wss = new WebSocketServer({ noServer: true });
    const broker = new RunBroker(wss);
    assert.equal(broker.hasExtension(), false);
  });

  it('runFlow() rejects immediately when no extension is connected', async () => {
    const wss = new WebSocketServer({ noServer: true });
    const broker = new RunBroker(wss);
    await assert.rejects(
      () =>
        broker.runFlow(
          {
            flowId: 'x',
            flow: {
              version: '1.0',
              title: 't',
              steps: [{ type: 'navigate', url: 'https://example.com' }],
            },
            slots: {},
            runId: 'r-1',
          },
          1000,
        ),
      /no extension connected/,
    );
  });

  it('multiplexes two concurrent runs by runId', async () => {
    const wss = new WebSocketServer({ noServer: true });
    const broker = new RunBroker(wss);
    const peer = makeFakePeer();
    // biome-ignore lint/suspicious/noExplicitAny: stand-in for ws.WebSocket in unit tests
    broker.registerExtension(peer as any);

    const flow = {
      version: '1.0' as const,
      title: 't',
      steps: [{ type: 'navigate' as const, url: 'https://example.com' }],
    };

    const p1 = broker.runFlow({ flowId: 'a', flow, slots: {}, runId: 'r-1' }, 5000);
    const p2 = broker.runFlow({ flowId: 'b', flow, slots: { x: '1' }, runId: 'r-2' }, 5000);

    // Both flow:run frames were sent to the extension peer with their runId.
    await wait(10);
    assert.equal(peer.sent.length, 2);
    const sent = peer.sent.map((s) => JSON.parse(s));
    assert.equal(sent[0].type, 'flow:run');
    assert.equal(sent[0].runId, 'r-1');
    assert.equal(sent[1].runId, 'r-2');

    // Resolve them out-of-order: r-2 finishes first.
    broker.handleIncoming({
      type: 'step:result',
      runId: 'r-2',
      stepIdx: 0,
      ok: true,
      durationMs: 5,
    });
    broker.handleIncoming({
      type: 'flow:result',
      runId: 'r-2',
      flowId: 'b',
      ok: true,
      durationMs: 30,
    });
    const r2 = await p2;
    assert.equal(r2.ok, true);
    assert.equal(r2.steps.length, 1);

    broker.handleIncoming({
      type: 'flow:result',
      runId: 'r-1',
      flowId: 'a',
      ok: false,
      error: 'oops',
      durationMs: 40,
    });
    const r1 = await p1;
    assert.equal(r1.ok, false);
    assert.equal(r1.error, 'oops');
  });

  it('runFlow() rejects on timeout and cleans up the pending entry', async () => {
    const wss = new WebSocketServer({ noServer: true });
    const broker = new RunBroker(wss);
    const peer = makeFakePeer();
    // biome-ignore lint/suspicious/noExplicitAny: stand-in for ws.WebSocket in unit tests
    broker.registerExtension(peer as any);

    const flow = {
      version: '1.0' as const,
      title: 't',
      steps: [{ type: 'navigate' as const, url: 'https://example.com' }],
    };
    await assert.rejects(
      () =>
        broker.runFlow(
          { flowId: 'slow', flow, slots: {}, runId: 'r-timeout' },
          50, // 50ms — will time out
        ),
      /timeout/,
    );
    // After a timeout, a late flow:result must NOT cause uncaught rejections.
    broker.handleIncoming({
      type: 'flow:result',
      runId: 'r-timeout',
      flowId: 'slow',
      ok: true,
      durationMs: 9999,
    });
  });

  it('unregister() removes the peer', () => {
    const wss = new WebSocketServer({ noServer: true });
    const broker = new RunBroker(wss);
    const peer = makeFakePeer();
    // biome-ignore lint/suspicious/noExplicitAny: stand-in for ws.WebSocket in unit tests
    const unregister = broker.registerExtension(peer as any);
    assert.equal(broker.hasExtension(), true);
    unregister();
    assert.equal(broker.hasExtension(), false);
  });
});
