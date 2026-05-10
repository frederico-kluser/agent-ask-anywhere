import { chmod, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { SkillFrontmatter } from '@agent-ask-anywhere/shared';
import { logger } from './logger.js';

const SECRETS_FILE =
  process.env.AAA_SECRETS_FILE ??
  resolve(homedir(), '.config', 'agent-ask-anywhere', 'secrets.json');

let cache: Record<string, string> | null = null;

async function loadAll(): Promise<Record<string, string>> {
  if (cache) return cache;
  try {
    const info = await stat(SECRETS_FILE);
    // World-readable secrets are a footgun. Tighten to user-only on first read.
    const mode = info.mode & 0o777;
    if (mode !== 0o600 && mode !== 0o400) {
      try {
        await chmod(SECRETS_FILE, 0o600);
        logger.warn(
          { file: SECRETS_FILE, prevMode: mode.toString(8) },
          'tightened secrets file mode to 0600',
        );
      } catch (err) {
        logger.warn({ err: String(err) }, 'failed to chmod secrets file');
      }
    }
    const raw = await readFile(SECRETS_FILE, 'utf8');
    cache = JSON.parse(raw) as Record<string, string>;
    return cache;
  } catch {
    cache = {};
    return cache;
  }
}

export async function getSecret(name: string): Promise<string | null> {
  const all = await loadAll();
  return all[name] ?? null;
}

/**
 * Resolve secret slots server-side. The LLM never sees secret values —
 * frontmatter declares slot type 'secret' and we substitute here.
 * Throws if a required secret slot is missing from the keystore.
 */
export async function resolveSecrets(
  fm: SkillFrontmatter,
  slotsFromLLM: Record<string, string>,
): Promise<Record<string, string>> {
  const result: Record<string, string> = { ...slotsFromLLM };
  for (const slot of fm.slots ?? []) {
    if (slot.type !== 'secret') continue;
    const value = await getSecret(slot.name);
    if (value === null) {
      if (slot.required) {
        throw new Error(`secret slot "${slot.name}" not found in keystore (${SECRETS_FILE})`);
      }
      continue;
    }
    result[slot.name] = value;
    logger.debug({ slot: slot.name }, 'secret slot resolved');
  }
  return result;
}
