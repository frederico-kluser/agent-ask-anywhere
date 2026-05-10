const SCRIPT_ID = 'aaa-force-open-shadow';
const SCRIPT_FILE = 'force-open-shadow.js';

let registeredDomains: string[] = [];

export function getRegisteredDomains(): string[] {
  return [...registeredDomains];
}

export async function syncForceOpenShadow(domains: string[]): Promise<void> {
  const unique = [...new Set(domains)].sort();
  if (sameAs(unique, registeredDomains)) return;
  registeredDomains = unique;

  try {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } catch {
    // ID may not be registered yet — fine.
  }

  if (unique.length === 0) return;

  const matches = unique.flatMap((d) => [`*://${d}/*`, `*://*.${d}/*`]);

  try {
    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        matches,
        js: [SCRIPT_FILE],
        world: 'MAIN',
        runAt: 'document_start',
        allFrames: true,
        persistAcrossSessions: true,
      },
    ]);
    console.log('[aaa/force-open-shadow] registered', { domains: unique, matches });
  } catch (err) {
    console.warn('[aaa/force-open-shadow] register failed', err);
  }
}

function sameAs(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
