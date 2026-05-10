import './setup-tmpdir.js';
import { strict as assert } from 'node:assert';
import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { before, describe, it } from 'node:test';
import type { SkillFrontmatter } from '@agent-ask-anywhere/shared';
import { getSecret, resolveSecrets } from '../src/secrets.js';

const SECRETS_FILE = process.env.AAA_SECRETS_FILE!;

describe('secrets', () => {
  before(() => {
    mkdirSync(dirname(SECRETS_FILE), { recursive: true });
    writeFileSync(
      SECRETS_FILE,
      JSON.stringify({ api_token: 'sk-secret-123', optional_token: 'opt-456' }),
      'utf8',
    );
    if (process.platform !== 'win32') chmodSync(SECRETS_FILE, 0o644);
  });

  it('getSecret reads a known key', async () => {
    const v = await getSecret('api_token');
    assert.equal(v, 'sk-secret-123');
  });

  it('getSecret returns null for unknown key', async () => {
    const v = await getSecret('does_not_exist');
    assert.equal(v, null);
  });

  it('chmods the secrets file to 0600 on first read', () => {
    if (process.platform === 'win32') return;
    const mode = statSync(SECRETS_FILE).mode & 0o777;
    assert.equal(mode, 0o600, `expected 0600, got ${mode.toString(8)}`);
  });

  it('resolveSecrets fills required secret slots and leaves user slots untouched', async () => {
    const fm: SkillFrontmatter = {
      name: 'send',
      description: 'aaaaaaaaaa',
      license: 'MIT',
      metadata: {},
      slots: [
        { name: 'recipient', type: 'string', description: 'who', required: true },
        { name: 'api_token', type: 'secret', description: 'token', required: true },
      ],
    };
    const slotsFromLLM: Record<string, string> = { recipient: 'joao' };
    const filled = await resolveSecrets(fm, slotsFromLLM);
    assert.equal(filled.recipient, 'joao');
    assert.equal(filled.api_token, 'sk-secret-123');
  });

  it('resolveSecrets does NOT mutate the LLM-supplied slot map', async () => {
    const fm: SkillFrontmatter = {
      name: 'send',
      description: 'aaaaaaaaaa',
      license: 'MIT',
      metadata: {},
      slots: [{ name: 'api_token', type: 'secret', description: 't', required: true }],
    };
    const slotsFromLLM: Record<string, string> = {};
    await resolveSecrets(fm, slotsFromLLM);
    assert.equal(
      'api_token' in slotsFromLLM,
      false,
      'secret leaked back into LLM-visible slot object',
    );
  });

  it('resolveSecrets throws when a required secret is missing', async () => {
    const fm: SkillFrontmatter = {
      name: 'send',
      description: 'aaaaaaaaaa',
      license: 'MIT',
      metadata: {},
      slots: [{ name: 'missing_token', type: 'secret', description: 't', required: true }],
    };
    await assert.rejects(() => resolveSecrets(fm, {}), /missing_token/);
  });

  it('resolveSecrets skips missing optional secrets', async () => {
    const fm: SkillFrontmatter = {
      name: 'send',
      description: 'aaaaaaaaaa',
      license: 'MIT',
      metadata: {},
      slots: [{ name: 'missing_token', type: 'secret', description: 't', required: false }],
    };
    const filled = await resolveSecrets(fm, { unrelated: 'x' });
    assert.equal('missing_token' in filled, false);
    assert.equal(filled.unrelated, 'x');
  });

  it('resolveSecrets ignores non-secret slots even if they share names with secrets', async () => {
    const fm: SkillFrontmatter = {
      name: 'send',
      description: 'aaaaaaaaaa',
      license: 'MIT',
      metadata: {},
      slots: [{ name: 'recipient', type: 'string', description: 'who', required: true }],
    };
    const filled = await resolveSecrets(fm, { recipient: 'joao' });
    assert.equal(filled.recipient, 'joao');
    assert.equal(Object.keys(filled).length, 1);
  });
});
