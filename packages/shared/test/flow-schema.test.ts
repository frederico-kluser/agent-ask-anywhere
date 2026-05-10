import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { FlowSchema, StepSchema } from '../src/flow-schema.js';

describe('StepSchema', () => {
  it('parses a navigate step with a valid url', () => {
    const r = StepSchema.safeParse({ type: 'navigate', url: 'https://example.com' });
    assert.equal(r.success, true);
  });

  it('rejects navigate without url', () => {
    const r = StepSchema.safeParse({ type: 'navigate' });
    assert.equal(r.success, false);
  });

  it('rejects navigate with non-url string', () => {
    const r = StepSchema.safeParse({ type: 'navigate', url: 'not a url' });
    assert.equal(r.success, false);
  });

  it('parses a click step with a 1x1 selector chain', () => {
    const r = StepSchema.safeParse({ type: 'click', selectors: [['#submit']] });
    assert.equal(r.success, true);
  });

  it('rejects click with empty selector chain', () => {
    const r = StepSchema.safeParse({ type: 'click', selectors: [] });
    assert.equal(r.success, false);
  });

  it('rejects click with empty inner group', () => {
    const r = StepSchema.safeParse({ type: 'click', selectors: [[]] });
    assert.equal(r.success, false);
  });

  it('parses a type step with selectors and value', () => {
    const r = StepSchema.safeParse({
      type: 'type',
      selectors: [['#email']],
      value: 'me@example.com',
    });
    assert.equal(r.success, true);
  });

  it('rejects type without value', () => {
    const r = StepSchema.safeParse({ type: 'type', selectors: [['#email']] });
    assert.equal(r.success, false);
  });

  it('parses press without selectors (uses activeElement)', () => {
    const r = StepSchema.safeParse({ type: 'press', key: 'Enter' });
    assert.equal(r.success, true);
  });

  it('parses waitForElement with default timeout', () => {
    const r = StepSchema.safeParse({ type: 'waitForElement', selectors: [['#x']] });
    assert.equal(r.success, true);
    if (r.success && r.data.type === 'waitForElement') {
      assert.equal(r.data.timeout, 10000);
    }
  });

  it('rejects waitForElement with non-positive timeout', () => {
    const r = StepSchema.safeParse({
      type: 'waitForElement',
      selectors: [['#x']],
      timeout: 0,
    });
    assert.equal(r.success, false);
  });

  it('accepts allowAgenticFallback and useCDP on any step', () => {
    const r = StepSchema.safeParse({
      type: 'click',
      selectors: [['#submit']],
      allowAgenticFallback: true,
      useCDP: true,
      description: 'submit form',
    });
    assert.equal(r.success, true);
  });

  it('rejects unknown step type', () => {
    const r = StepSchema.safeParse({ type: 'fart', selectors: [['x']] });
    assert.equal(r.success, false);
  });
});

describe('FlowSchema', () => {
  it('parses a minimal valid flow', () => {
    const r = FlowSchema.safeParse({
      version: '1.0',
      title: 't',
      steps: [{ type: 'navigate', url: 'https://example.com' }],
    });
    assert.equal(r.success, true);
  });

  it('rejects flow with empty steps', () => {
    const r = FlowSchema.safeParse({ version: '1.0', title: 't', steps: [] });
    assert.equal(r.success, false);
  });

  it('rejects flow with wrong version literal', () => {
    const r = FlowSchema.safeParse({
      version: '2.0',
      title: 't',
      steps: [{ type: 'navigate', url: 'https://example.com' }],
    });
    assert.equal(r.success, false);
  });

  it('rejects flow with one bad step among many', () => {
    const r = FlowSchema.safeParse({
      version: '1.0',
      title: 't',
      steps: [{ type: 'navigate', url: 'https://example.com' }, { type: 'click' }],
    });
    assert.equal(r.success, false);
  });
});
