import { onIncoming } from '../../lib/messaging.js';

const HTTP = 'http://127.0.0.1:7860';

type SkillSummary = { name: string; description: string };
type SkillFull = SkillSummary & {
  frontmatter: {
    slots?: Array<{
      name: string;
      type: string;
      description: string;
      required?: boolean;
    }>;
    metadata?: Record<string, unknown>;
  };
  body: string;
  flow: { version: string; title: string; steps: unknown[] };
};
type Run = { runId: string };

const filterEl = document.getElementById('filter') as HTMLInputElement | null;
const listEl = document.getElementById('skill-list') as HTMLUListElement | null;
const detailEl = document.getElementById('detail') as HTMLElement | null;
const importInput = document.getElementById('import-input') as HTMLInputElement | null;
const statusEl = document.getElementById('server-status');

let allSkills: SkillSummary[] = [];
let activeName: string | null = null;

async function loadSkills(): Promise<void> {
  try {
    const r = await fetch(`${HTTP}/skills`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    allSkills = (await r.json()) as SkillSummary[];
    renderList();
    setStatus('connected');
  } catch (err) {
    setStatus(`server offline (${String(err)})`);
    allSkills = [];
    renderList();
  }
}

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function renderList(): void {
  if (!listEl) return;
  const filter = filterEl?.value.trim().toLowerCase() ?? '';
  const filtered = allSkills.filter(
    (s) =>
      !filter ||
      s.name.toLowerCase().includes(filter) ||
      s.description.toLowerCase().includes(filter),
  );
  listEl.innerHTML = '';
  for (const s of filtered) {
    const li = document.createElement('li');
    li.dataset.name = s.name;
    if (s.name === activeName) li.classList.add('active');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = s.name;
    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = s.description;
    li.append(name, desc);
    li.addEventListener('click', () => {
      activeName = s.name;
      void renderDetail(s.name);
      renderList();
    });
    listEl.append(li);
  }
  if (filtered.length === 0) {
    const li = document.createElement('li');
    li.style.opacity = '0.55';
    li.textContent = filter ? 'no matches' : 'no skills installed';
    listEl.append(li);
  }
}

async function renderDetail(name: string): Promise<void> {
  if (!detailEl) return;
  detailEl.innerHTML = '<p class="empty">Loading…</p>';
  try {
    const [skillResp, runsResp] = await Promise.all([
      fetch(`${HTTP}/skills/${encodeURIComponent(name)}`),
      fetch(`${HTTP}/skills/${encodeURIComponent(name)}/history`),
    ]);
    if (!skillResp.ok) throw new Error(`skill: HTTP ${skillResp.status}`);
    const skill = (await skillResp.json()) as SkillFull;
    const runs = runsResp.ok ? ((await runsResp.json()) as Run[]) : [];
    detailEl.innerHTML = '';

    const headRow = document.createElement('div');
    headRow.className = 'head-row';
    const headLeft = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.textContent = skill.name;
    headLeft.append(h2);
    const desc = document.createElement('p');
    desc.className = 'desc';
    desc.textContent = skill.description;
    headLeft.append(desc);
    headRow.append(headLeft);
    const headRight = document.createElement('div');
    const exportBtn = document.createElement('a');
    exportBtn.className = 'btn';
    exportBtn.href = `${HTTP}/skills/${encodeURIComponent(name)}/export`;
    exportBtn.textContent = 'Export';
    exportBtn.download = `${name}.skill`;
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => void onDelete(skill.name));
    headRight.append(exportBtn, ' ', delBtn);
    headRow.append(headRight);
    detailEl.append(headRow);

    const slotsTitle = document.createElement('h3');
    slotsTitle.textContent = `Slots (${skill.frontmatter.slots?.length ?? 0})`;
    detailEl.append(slotsTitle);
    const slotsUl = document.createElement('ul');
    slotsUl.className = 'slots';
    for (const slot of skill.frontmatter.slots ?? []) {
      const li = document.createElement('li');
      const typeSpan = document.createElement('span');
      typeSpan.className = 'slot-type';
      typeSpan.textContent = slot.type;
      const nameSpan = document.createElement('strong');
      nameSpan.textContent = slot.name;
      li.append(typeSpan, ' ', nameSpan);
      if (slot.required) {
        li.append(' ');
        const req = document.createElement('span');
        req.className = 'slot-required';
        req.textContent = '*';
        li.append(req);
      }
      const text = document.createElement('div');
      text.style.opacity = '0.7';
      text.style.marginTop = '2px';
      text.textContent = slot.description;
      li.append(text);
      slotsUl.append(li);
    }
    if ((skill.frontmatter.slots?.length ?? 0) === 0) {
      const li = document.createElement('li');
      li.style.opacity = '0.55';
      li.textContent = 'no slots';
      slotsUl.append(li);
    }
    detailEl.append(slotsUl);

    const flowTitle = document.createElement('h3');
    flowTitle.textContent = `Flow (${skill.flow.steps.length} steps)`;
    detailEl.append(flowTitle);
    const flowPre = document.createElement('pre');
    flowPre.textContent = JSON.stringify(skill.flow, null, 2);
    detailEl.append(flowPre);

    const runsTitle = document.createElement('h3');
    runsTitle.textContent = `Recent runs (${runs.length})`;
    detailEl.append(runsTitle);
    const runsUl = document.createElement('ul');
    runsUl.className = 'runs';
    for (const r of runs.slice(0, 20)) {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = `${HTTP}/skills/${encodeURIComponent(name)}/history/${encodeURIComponent(r.runId)}`;
      link.textContent = r.runId;
      link.target = '_blank';
      link.rel = 'noopener';
      li.append(link);
      runsUl.append(li);
    }
    if (runs.length === 0) {
      const li = document.createElement('li');
      li.style.opacity = '0.55';
      li.textContent = 'no runs yet';
      runsUl.append(li);
    }
    detailEl.append(runsUl);
  } catch (err) {
    detailEl.innerHTML = `<p class="empty">Failed to load: ${String(err)}</p>`;
  }
}

async function onDelete(name: string): Promise<void> {
  if (!confirm(`Delete skill "${name}"? This is versioned in git inside ~/.local/agent-skills/.`)) {
    return;
  }
  try {
    const r = await fetch(`${HTTP}/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    activeName = null;
    if (detailEl) detailEl.innerHTML = '<p class="empty">Skill deleted.</p>';
    await loadSkills();
  } catch (err) {
    alert(`Delete failed: ${String(err)}`);
  }
}

importInput?.addEventListener('change', async () => {
  const file = importInput.files?.[0];
  if (!file) return;
  const buf = await file.arrayBuffer();
  try {
    const r = await fetch(`${HTTP}/skills/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: buf,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    importInput.value = '';
    await loadSkills();
  } catch (err) {
    alert(`Import failed: ${String(err)}`);
  }
});

filterEl?.addEventListener('input', renderList);

onIncoming((msg) => {
  if (msg.type === 'skills:updated') {
    void loadSkills();
  }
});

void loadSkills();
setInterval(() => void loadSkills(), 30_000);
