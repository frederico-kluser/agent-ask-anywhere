import type { Flow, SkillFrontmatter } from '@agent-ask-anywhere/shared';
import AdmZip from 'adm-zip';
import matter from 'gray-matter';

export type SkillBundleInput = {
  frontmatter: SkillFrontmatter;
  body: string;
  flow: Flow;
};

/**
 * Builds a plug-and-play `.skill` zip with run.js + lobby-bootstrap.js so any
 * agent of code can `node run.js '{"slot_x":"value"}'` against the local lobby.
 * The bundled clients use only Node stdlib (no npm install needed).
 */
export function buildSkillZip(input: SkillBundleInput): Buffer {
  const { frontmatter, body, flow } = input;
  const skillMd = matter.stringify(body, frontmatter as Record<string, unknown>);
  const flowJson = JSON.stringify(flow, null, 2);
  const meta = JSON.stringify(
    {
      name: frontmatter.name,
      description: frontmatter.description,
      version: frontmatter.metadata?.version ?? '1.0',
      slots: frontmatter.slots ?? [],
    },
    null,
    2,
  );

  const zip = new AdmZip();
  const root = frontmatter.name;
  zip.addFile(`${root}/SKILL.md`, Buffer.from(skillMd, 'utf8'));
  zip.addFile(`${root}/flow.json`, Buffer.from(flowJson, 'utf8'));
  zip.addFile(`${root}/meta.json`, Buffer.from(meta, 'utf8'));
  zip.addFile(`${root}/run.js`, Buffer.from(RUN_JS, 'utf8'));
  zip.addFile(`${root}/lobby-bootstrap.js`, Buffer.from(LOBBY_BOOTSTRAP_JS, 'utf8'));
  zip.addFile(`${root}/package.json`, Buffer.from(skillPackageJson(frontmatter), 'utf8'));
  zip.addFile(`${root}/INSTALL.md`, Buffer.from(INSTALL_MD, 'utf8'));
  return zip.toBuffer();
}

function skillPackageJson(fm: SkillFrontmatter): string {
  return `${JSON.stringify(
    {
      name: fm.name,
      version: fm.metadata?.version ?? '1.0.0',
      description: fm.description,
      private: true,
      bin: {
        [fm.name]: './run.js',
      },
      engines: {
        node: '>=20',
      },
    },
    null,
    2,
  )}\n`;
}

const LOBBY_BOOTSTRAP_JS = `#!/usr/bin/env node
'use strict';

// lobby-bootstrap.js — ensures a running lobby on 127.0.0.1:7878.
// If health check fails, attempts to spawn the lobby as a detached process
// (binary identified via AAA_LOBBY_BIN env var, falling back to documented
// install paths) that survives this process.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const LOBBY_HOST = process.env.AAA_LOBBY_HOST || '127.0.0.1';
const LOBBY_PORT = Number(process.env.AAA_LOBBY_PORT || 7878);
const HEALTH_TIMEOUT_MS = 1500;
const SPAWN_WAIT_MS = 8000;
const POLL_INTERVAL_MS = 250;

function checkHealth(timeoutMs = HEALTH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: LOBBY_HOST,
        port: LOBBY_PORT,
        path: '/health',
        method: 'GET',
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

function findLobbyBinary() {
  if (process.env.AAA_LOBBY_BIN && fs.existsSync(process.env.AAA_LOBBY_BIN)) {
    return process.env.AAA_LOBBY_BIN;
  }
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'aaa-lobby'),
    '/usr/local/bin/aaa-lobby',
    '/opt/homebrew/bin/aaa-lobby',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function spawnLobby(binary) {
  const logsDir = path.join(os.homedir(), '.local', 'share', 'agent-ask-anywhere');
  fs.mkdirSync(logsDir, { recursive: true });
  const out = fs.openSync(path.join(logsDir, 'lobby.out.log'), 'a');
  const err = fs.openSync(path.join(logsDir, 'lobby.err.log'), 'a');
  const child = spawn(binary, [], {
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env },
  });
  child.unref();
  return child.pid;
}

async function ensureLobby() {
  const initial = await checkHealth();
  if (initial && initial.ok) return initial;
  const binary = findLobbyBinary();
  if (!binary) {
    throw new Error(
      'agent-ask-anywhere lobby is not running and no binary was found. ' +
        'Set AAA_LOBBY_BIN or install the lobby (see INSTALL.md).',
    );
  }
  let pid;
  try {
    pid = spawnLobby(binary);
  } catch (err) {
    throw new Error('failed to spawn lobby: ' + String(err));
  }
  // Wait for /health to come up. Another skill may have won the race; either
  // way the next successful health check resolves the bootstrap.
  const deadline = Date.now() + SPAWN_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const h = await checkHealth();
    if (h && h.ok) return h;
  }
  throw new Error(
    'lobby did not become healthy within ' +
      SPAWN_WAIT_MS +
      'ms (spawned pid=' +
      String(pid) +
      ').',
  );
}

module.exports = { ensureLobby, checkHealth, LOBBY_HOST, LOBBY_PORT };
`;

const RUN_JS = `#!/usr/bin/env node
'use strict';

// run.js — executes this skill's flow against the local lobby. Reads slots
// from argv[2] (JSON object) or from AAA_SLOTS_JSON env var. On exit code 0
// the run completed successfully; non-zero indicates failure with the error
// printed to stderr.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { ensureLobby, LOBBY_HOST, LOBBY_PORT } = require('./lobby-bootstrap.js');

const RUN_TIMEOUT_MS = Number(process.env.AAA_RUN_TIMEOUT_MS || 5 * 60 * 1000);

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function postRun(payload) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = http.request(
      {
        host: LOBBY_HOST,
        port: LOBBY_PORT,
        path: '/run',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
        },
        timeout: RUN_TIMEOUT_MS + 5000,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (err) {
            reject(new Error('invalid JSON from lobby: ' + raw.slice(0, 200)));
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error('lobby returned ' + res.statusCode + ': ' + (parsed.error || raw)));
            return;
          }
          resolve(parsed);
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('run request timeout'));
    });
    req.write(body);
    req.end();
  });
}

(async () => {
  let slots = {};
  const argv = process.argv[2];
  if (argv) {
    try {
      slots = JSON.parse(argv);
    } catch (err) {
      console.error('invalid slots JSON in argv: ' + String(err));
      process.exit(2);
    }
  } else if (process.env.AAA_SLOTS_JSON) {
    try {
      slots = JSON.parse(process.env.AAA_SLOTS_JSON);
    } catch (err) {
      console.error('invalid slots JSON in AAA_SLOTS_JSON: ' + String(err));
      process.exit(2);
    }
  }

  const meta = readJson(path.join(__dirname, 'meta.json'));
  const flow = readJson(path.join(__dirname, 'flow.json'));

  // Validate required slots before bothering the lobby.
  const missing = [];
  for (const slot of meta.slots || []) {
    if (slot.required !== false && !(slot.name in slots)) missing.push(slot.name);
  }
  if (missing.length > 0) {
    console.error('missing required slots: ' + missing.join(', '));
    process.exit(2);
  }

  try {
    await ensureLobby();
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(3);
  }

  let result;
  try {
    // Pass timeoutMs so the lobby honors the same deadline this client
    // expects; otherwise the lobby falls back to its own default (5min)
    // which can disagree with AAA_RUN_TIMEOUT_MS.
    result = await postRun({
      flowId: meta.name,
      flow,
      slots,
      timeoutMs: RUN_TIMEOUT_MS,
    });
  } catch (err) {
    console.error('run failed: ' + String(err.message || err));
    process.exit(4);
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\\n');
  process.exit(result && result.ok ? 0 : 1);
})();
`;

const INSTALL_MD = `# Installing this skill

This skill talks to a local **lobby** on \`127.0.0.1:7878\` that the
\`agent-ask-anywhere\` Chrome extension also connects to. The lobby is a tiny
Node.js process; it auto-spawns on first \`run.js\` if it isn't running.

## Prerequisites

1. **Node 20+** on your PATH.
2. **agent-ask-anywhere extension** installed in Chrome (\`chrome://extensions\`).
3. **lobby binary** — either:
   - Set \`AAA_LOBBY_BIN\` to the absolute path of the lobby entry script, or
   - Drop the lobby executable in \`~/.local/bin/aaa-lobby\` (chmod +x).

## Running

\`\`\`bash
# install nothing (no npm dependencies); just run with Node
node run.js '{"slot_a":"hello","slot_b":"world"}'
\`\`\`

The lobby will be auto-spawned (detached) the first time, so the next call is
instant. Slots are validated against \`meta.json\` before contacting the lobby.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| \`AAA_LOBBY_HOST\` | \`127.0.0.1\` | Override lobby host (advanced) |
| \`AAA_LOBBY_PORT\` | \`7878\` | Override lobby port |
| \`AAA_LOBBY_BIN\` | — | Absolute path to lobby executable |
| \`AAA_SLOTS_JSON\` | — | Alternative to argv[2] for passing slots |
| \`AAA_RUN_TIMEOUT_MS\` | \`300000\` | Per-run timeout (5min default) |

## Exit codes

- 0: success
- 1: flow ran but ended with \`ok=false\`
- 2: invalid slots / argv
- 3: lobby unreachable & not spawnable (binary not found)
- 4: HTTP/network error during run
`;
