import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { Flow } from '../src/flow-schema.js';
import { MissingSlotError, fillFlow, fillString } from '../src/slots.js';

describe('fillString', () => {
  it('replaces a single token', () => {
    assert.equal(fillString('hi {{name}}', { name: 'Ana' }), 'hi Ana');
  });

  it('replaces multiple tokens', () => {
    assert.equal(fillString('{{a}} and {{b}}', { a: '1', b: '2' }), '1 and 2');
  });

  it('preserves strings without tokens', () => {
    assert.equal(fillString('plain', {}), 'plain');
  });

  it('throws MissingSlotError for unknown slots', () => {
    assert.throws(
      () => fillString('hi {{name}}', {}),
      (err: unknown) => err instanceof MissingSlotError && err.slotName === 'name',
    );
  });

  it('treats whitespace inside braces as part of slot name lookup', () => {
    assert.equal(fillString('{{ name }}', { name: 'Ana' }), 'Ana');
  });

  it('does not interpolate empty-string slot as missing', () => {
    assert.equal(fillString('hi {{name}}', { name: '' }), 'hi ');
  });
});

describe('fillFlow', () => {
  const baseFlow: Flow = {
    version: '1.0',
    title: 't',
    steps: [
      { type: 'navigate', url: 'https://app.example.com/{{path}}' },
      { type: 'type', selectors: [['#email']], value: '{{email}}' },
      { type: 'click', selectors: [['#submit']] },
      { type: 'select', selectors: [['#dept']], value: '{{dept}}' },
      {
        type: 'waitForExpression',
        expression: 'document.title === "{{title}}"',
        timeout: 5000,
      },
    ],
  };

  it('fills navigate.url, type.value, select.value, waitForExpression.expression', () => {
    const filled = fillFlow(baseFlow, {
      path: 'home',
      email: 'me@example.com',
      dept: 'eng',
      title: 'Welcome',
    });
    assert.equal((filled.steps[0] as { url: string }).url, 'https://app.example.com/home');
    assert.equal((filled.steps[1] as { value: string }).value, 'me@example.com');
    assert.equal((filled.steps[3] as { value: string }).value, 'eng');
    assert.equal(
      (filled.steps[4] as { expression: string }).expression,
      'document.title === "Welcome"',
    );
  });

  it('leaves click/press/check untouched', () => {
    const filled = fillFlow(baseFlow, {
      path: 'home',
      email: 'a',
      dept: 'b',
      title: 'c',
    });
    assert.deepEqual(filled.steps[2], baseFlow.steps[2]);
  });

  it('throws when a referenced slot is missing', () => {
    assert.throws(
      () =>
        fillFlow(baseFlow, {
          path: 'home',
          dept: 'b',
          title: 'c',
        }),
      MissingSlotError,
    );
  });

  it('returns a value that is itself a valid Flow (re-parsed)', () => {
    const filled = fillFlow(baseFlow, {
      path: 'home',
      email: 'me@example.com',
      dept: 'eng',
      title: 'Welcome',
    });
    assert.equal(filled.version, '1.0');
    assert.equal(filled.steps.length, baseFlow.steps.length);
  });

  it('does not mutate the input flow', () => {
    const original = JSON.parse(JSON.stringify(baseFlow));
    fillFlow(baseFlow, {
      path: 'home',
      email: 'a',
      dept: 'b',
      title: 'c',
    });
    assert.deepEqual(baseFlow, original);
  });
});
