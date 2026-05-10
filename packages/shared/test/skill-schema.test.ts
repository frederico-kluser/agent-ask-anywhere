import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { SkillFrontmatterSchema, SlotSchema } from '../src/skill-schema.js';

describe('SlotSchema', () => {
  it('parses a minimal slot', () => {
    const r = SlotSchema.safeParse({
      name: 'recipient',
      type: 'string',
      description: 'who to send to',
    });
    assert.equal(r.success, true);
    if (r.success) assert.equal(r.data.required, true);
  });

  it('rejects slot name in kebab-case', () => {
    const r = SlotSchema.safeParse({
      name: 'my-slot',
      type: 'string',
      description: 'x',
    });
    assert.equal(r.success, false);
  });

  it('rejects slot name starting with a digit', () => {
    const r = SlotSchema.safeParse({ name: '1foo', type: 'string', description: 'x' });
    assert.equal(r.success, false);
  });

  it('accepts snake_case with digits', () => {
    const r = SlotSchema.safeParse({
      name: 'amount_2',
      type: 'string',
      description: 'x',
    });
    assert.equal(r.success, true);
  });

  it('accepts the three slot types', () => {
    for (const type of ['string', 'choice', 'dynamic']) {
      const r = SlotSchema.safeParse({ name: 's', type, description: 'x' });
      assert.equal(r.success, true, `type ${type} should parse`);
    }
  });

  it('rejects the legacy "secret" slot type (removed in 1.0 lobby refactor)', () => {
    const r = SlotSchema.safeParse({ name: 's', type: 'secret', description: 'x' });
    assert.equal(r.success, false);
  });

  it('rejects unknown slot type', () => {
    const r = SlotSchema.safeParse({ name: 's', type: 'magic', description: 'x' });
    assert.equal(r.success, false);
  });
});

describe('SkillFrontmatterSchema', () => {
  it('parses a frontmatter with sane defaults', () => {
    const r = SkillFrontmatterSchema.safeParse({
      name: 'send-message',
      description: 'sends a message somewhere',
    });
    assert.equal(r.success, true);
    if (r.success) {
      assert.equal(r.data.license, 'MIT');
      assert.deepEqual(r.data.slots, []);
      assert.deepEqual(r.data.metadata, {});
    }
  });

  it('rejects too-short description', () => {
    const r = SkillFrontmatterSchema.safeParse({
      name: 'send',
      description: 'short',
    });
    assert.equal(r.success, false);
  });

  it('rejects PascalCase or snake_case skill names', () => {
    for (const name of ['SendMessage', 'send_message', '-send', '1send', 'Send']) {
      const r = SkillFrontmatterSchema.safeParse({
        name,
        description: 'aaaaaaaaaa',
      });
      assert.equal(r.success, false, `${name} should be rejected`);
    }
  });

  it('accepts kebab-case names', () => {
    for (const name of ['send-message', 'a', 'a-b-c-d']) {
      const r = SkillFrontmatterSchema.safeParse({
        name,
        description: 'aaaaaaaaaa',
      });
      assert.equal(r.success, true, `${name} should be accepted`);
    }
  });

  it('keeps metadata.force_open_shadow when provided', () => {
    const r = SkillFrontmatterSchema.safeParse({
      name: 'send',
      description: 'aaaaaaaaaa',
      metadata: { force_open_shadow: ['teams.microsoft.com'] },
    });
    assert.equal(r.success, true);
    if (r.success) assert.deepEqual(r.data.metadata.force_open_shadow, ['teams.microsoft.com']);
  });

  it('keeps slots array intact', () => {
    const r = SkillFrontmatterSchema.safeParse({
      name: 'send',
      description: 'aaaaaaaaaa',
      slots: [{ name: 'recipient', type: 'string', description: 'who' }],
    });
    assert.equal(r.success, true);
    if (r.success) assert.equal(r.data.slots.length, 1);
  });
});
