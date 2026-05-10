import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import AdmZip from 'adm-zip';
import { SKILLS_ROOT, type SkillsManager } from './manager.js';

export async function exportSkillZip(name: string): Promise<Buffer | null> {
  const dir = join(SKILLS_ROOT, name);
  const zip = new AdmZip();
  try {
    await addDirToZip(zip, dir, name);
    return zip.toBuffer();
  } catch {
    return null;
  }
}

async function addDirToZip(zip: AdmZip, dir: string, prefix: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries as Array<{
    name: string;
    isDirectory: () => boolean;
    isFile: () => boolean;
  }>) {
    const sub = join(dir, entry.name);
    if (entry.isDirectory()) {
      await addDirToZip(zip, sub, `${prefix}/${entry.name}`);
    } else if (entry.isFile()) {
      const buf = await readFile(sub);
      zip.addFile(`${prefix}/${entry.name}`, buf);
    }
  }
}

export async function importSkillZip(
  buffer: Buffer,
  mgr: SkillsManager,
): Promise<{ name: string }> {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (entries.length === 0) throw new Error('empty zip');
  const top = entries[0]?.entryName.split('/')[0];
  if (!top || !/^[a-z][a-z0-9-]*$/.test(top)) {
    throw new Error(`invalid skill name in zip: ${top}`);
  }
  const dir = join(SKILLS_ROOT, top);
  // Resolve to a canonical absolute path with trailing separator so any escape
  // attempt (e.g. entryName = "../../etc/passwd") is detected via prefix match.
  const safeRoot = resolve(dir) + sep;
  await mkdir(dir, { recursive: true });

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (!entry.entryName.startsWith(`${top}/`) && entry.entryName !== top) {
      throw new Error(`zip entry outside skill root: ${entry.entryName}`);
    }
    const rel = entry.entryName.slice(top.length + 1);
    if (!rel || rel.includes('\0')) {
      throw new Error(`invalid zip entry name: ${entry.entryName}`);
    }
    const target = resolve(dir, rel);
    if (!target.startsWith(safeRoot)) {
      throw new Error(`zip slip rejected: ${entry.entryName} → ${target}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.getData());
  }
  await mgr.init();
  return { name: top };
}
