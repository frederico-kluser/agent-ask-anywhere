import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TEST_ROOT = mkdtempSync(join(tmpdir(), 'aaa-test-'));

// Set BEFORE the rest of the test imports so module-scope reads of these
// env vars (manager.SKILLS_ROOT, secrets.SECRETS_FILE) pick them up.
process.env.AAA_SKILLS_ROOT = TEST_ROOT;
process.env.AAA_SECRETS_FILE = join(TEST_ROOT, 'secrets.json');
process.env.LOG_LEVEL = 'silent';
