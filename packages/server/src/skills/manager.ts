import { execSync } from 'node:child_process';
import { type Dirent, existsSync, mkdirSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  type Flow,
  FlowSchema,
  type SkillFrontmatter,
  SkillFrontmatterSchema,
} from '@agent-ask-anywhere/shared';
import chokidar, { type FSWatcher } from 'chokidar';
import matter from 'gray-matter';
import { logger } from '../logger.js';

export const SKILLS_ROOT =
  process.env.AAA_SKILLS_ROOT ?? resolve(homedir(), '.local', 'agent-skills');

export type SkillSummary = {
  name: string;
  description: string;
};

export type SkillFull = SkillSummary & {
  frontmatter: SkillFrontmatter;
  body: string;
  flow: Flow;
};

export type CreateInput = {
  name: string;
  description: string;
  flow: Flow;
  body?: string;
  slots?: SkillFrontmatter['slots'];
  metadata?: SkillFrontmatter['metadata'];
  license?: string;
};

export type UpdateInput = {
  description?: string;
  flow?: Flow;
  body?: string;
  slots?: SkillFrontmatter['slots'];
  metadata?: SkillFrontmatter['metadata'];
};

export class SkillsManager {
  private cache = new Map<string, SkillFull>();
  private listeners = new Set<(skills: SkillSummary[]) => void>();
  private watcher: FSWatcher | null = null;

  async init(): Promise<void> {
    if (!existsSync(SKILLS_ROOT)) mkdirSync(SKILLS_ROOT, { recursive: true });
    this.ensureGit();
    await this.scan();
    this.watch();
    logger.info({ root: SKILLS_ROOT, count: this.cache.size }, 'skills manager ready');
  }

  async close(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }

  private ensureGit(): void {
    try {
      execSync('git rev-parse --git-dir', { cwd: SKILLS_ROOT, stdio: 'ignore' });
    } catch {
      try {
        execSync('git init -b main', { cwd: SKILLS_ROOT, stdio: 'ignore' });
        logger.info({ root: SKILLS_ROOT }, 'git initialized in skills root');
      } catch (err) {
        logger.warn({ err: String(err) }, 'git init failed (skills will not be versioned)');
      }
    }
  }

  private async scan(): Promise<void> {
    const next = new Map<string, SkillFull>();
    let entries: Dirent[];
    try {
      entries = (await readdir(SKILLS_ROOT, { withFileTypes: true })) as unknown as Dirent[];
    } catch (err) {
      logger.warn({ err: String(err) }, 'skills root unreadable');
      this.cache = next;
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      const skill = await this.load(entry.name);
      if (skill) next.set(skill.name, skill);
    }
    this.cache = next;
  }

  private async load(name: string): Promise<SkillFull | null> {
    const dir = join(SKILLS_ROOT, name);
    const skillMdPath = join(dir, 'SKILL.md');
    const flowPath = join(dir, 'flow.json');
    try {
      const [skillRaw, flowRaw] = await Promise.all([
        readFile(skillMdPath, 'utf8'),
        readFile(flowPath, 'utf8'),
      ]);
      const parsed = matter(skillRaw);
      const fm = SkillFrontmatterSchema.safeParse(parsed.data);
      if (!fm.success) {
        logger.warn({ name, issues: fm.error.issues }, 'invalid SKILL.md frontmatter');
        return null;
      }
      const flow = FlowSchema.safeParse(JSON.parse(flowRaw));
      if (!flow.success) {
        logger.warn({ name, issues: flow.error.issues }, 'invalid flow.json');
        return null;
      }
      return {
        name: fm.data.name,
        description: fm.data.description,
        frontmatter: fm.data,
        body: parsed.content,
        flow: flow.data,
      };
    } catch (err) {
      logger.debug({ name, err: String(err) }, 'load skill failed (likely missing files)');
      return null;
    }
  }

  private watch(): void {
    let timer: NodeJS.Timeout | null = null;
    this.watcher = chokidar.watch(SKILLS_ROOT, {
      ignored: (p: string) => p.includes(`${SKILLS_ROOT}/.git`),
      ignoreInitial: true,
      depth: 3,
    });
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void this.scan().then(() => this.notify());
      }, 200);
    };
    this.watcher.on('add', onChange);
    this.watcher.on('change', onChange);
    this.watcher.on('unlink', onChange);
    this.watcher.on('addDir', onChange);
    this.watcher.on('unlinkDir', onChange);
  }

  private notify(): void {
    const list = this.list();
    for (const cb of this.listeners) {
      try {
        cb(list);
      } catch (err) {
        logger.warn({ err: String(err) }, 'skill listener threw');
      }
    }
  }

  onChange(cb: (skills: SkillSummary[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  list(): SkillSummary[] {
    return [...this.cache.values()].map((s) => ({
      name: s.name,
      description: s.description,
    }));
  }

  get(name: string): SkillFull | undefined {
    return this.cache.get(name);
  }

  async create(input: CreateInput): Promise<SkillFull> {
    const fm = SkillFrontmatterSchema.parse({
      name: input.name,
      description: input.description,
      license: input.license ?? 'MIT',
      metadata: input.metadata ?? {},
      slots: input.slots ?? [],
    });
    const dir = join(SKILLS_ROOT, fm.name);
    await mkdir(dir, { recursive: true });
    const md = matter.stringify(input.body ?? defaultBody(fm), fm as Record<string, unknown>);
    await writeFile(join(dir, 'SKILL.md'), md, 'utf8');
    await writeFile(join(dir, 'flow.json'), JSON.stringify(input.flow, null, 2), 'utf8');
    this.gitCommit(`add: ${fm.name}`);
    await this.scan();
    this.notify();
    const created = this.cache.get(fm.name);
    if (!created) throw new Error(`skill ${fm.name} did not load after create`);
    return created;
  }

  async update(name: string, patch: UpdateInput): Promise<SkillFull | null> {
    const current = this.cache.get(name);
    if (!current) return null;
    const fm: SkillFrontmatter = {
      ...current.frontmatter,
      description: patch.description ?? current.frontmatter.description,
      slots: patch.slots ?? current.frontmatter.slots,
      metadata: patch.metadata ?? current.frontmatter.metadata,
    };
    const body = patch.body ?? current.body;
    const flow = patch.flow ?? current.flow;
    const dir = join(SKILLS_ROOT, name);
    const md = matter.stringify(body, fm as Record<string, unknown>);
    await writeFile(join(dir, 'SKILL.md'), md, 'utf8');
    await writeFile(join(dir, 'flow.json'), JSON.stringify(flow, null, 2), 'utf8');
    this.gitCommit(`update: ${name}`);
    await this.scan();
    this.notify();
    return this.cache.get(name) ?? null;
  }

  async delete(name: string): Promise<boolean> {
    if (!this.cache.has(name)) return false;
    const dir = join(SKILLS_ROOT, name);
    await rm(dir, { recursive: true, force: true });
    this.gitCommit(`remove: ${name}`);
    this.cache.delete(name);
    this.notify();
    return true;
  }

  private gitCommit(message: string): void {
    try {
      execSync('git add -A', { cwd: SKILLS_ROOT, stdio: 'ignore' });
      const safeMsg = JSON.stringify(message);
      execSync(
        `git -c user.name=agent-ask-anywhere -c user.email=ext@local commit -m ${safeMsg} --allow-empty`,
        { cwd: SKILLS_ROOT, stdio: 'ignore' },
      );
    } catch {
      // ignore (e.g., nothing to commit, or git unavailable)
    }
  }
}

function defaultBody(fm: SkillFrontmatter): string {
  const slotLines =
    fm.slots && fm.slots.length > 0
      ? fm.slots
          .map(
            (s) => `- \`${s.name}\` (${s.type}${s.required ? ', required' : ''}): ${s.description}`,
          )
          .join('\n')
      : '_no slots_';
  return `# ${fm.name}\n\n${fm.description}\n\n## Slots\n\n${slotLines}\n`;
}
