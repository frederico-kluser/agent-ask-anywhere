import { onIncoming } from '../../lib/messaging.js';

const HTTP = 'http://127.0.0.1:7878';

type SkillSummary = { name: string; description: string };
type SlotDef = {
  name: string;
  type: 'string' | 'choice' | 'dynamic' | 'secret';
  description: string;
  required?: boolean;
  enum?: string[];
  default?: string;
};
type Step = {
  type: string;
  url?: string;
  selectors?: string[][];
  value?: string;
  key?: string;
  expression?: string;
};
type Flow = { version: string; title: string; steps: Step[] };
type SkillFull = SkillSummary & {
  frontmatter: {
    name: string;
    description: string;
    license?: string;
    slots?: SlotDef[];
    metadata?: { force_open_shadow?: string[]; [k: string]: unknown };
  };
  body: string;
  flow: Flow;
};

const filterEl = document.getElementById('filter') as HTMLInputElement | null;
const listEl = document.getElementById('skill-list') as HTMLUListElement | null;
const detailEl = document.getElementById('detail') as HTMLElement | null;
const importInput = document.getElementById('import-input') as HTMLInputElement | null;
const statusEl = document.getElementById('server-status');

let allSkills: SkillSummary[] = [];
let activeName: string | null = null;
let activeDraft: SkillFull | null = null;

async function loadSkills(): Promise<void> {
  try {
    const r = await fetch(`${HTTP}/skills`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    allSkills = (await r.json()) as SkillSummary[];
    renderList();
    setStatus('lobby connected');
  } catch (err) {
    setStatus(`lobby offline (${String(err)})`);
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
    li.textContent = filter ? 'no matches' : 'no drafts yet — record one from the popup';
    listEl.append(li);
  }
}

async function renderDetail(name: string): Promise<void> {
  if (!detailEl) return;
  detailEl.innerHTML = '<p class="empty">Loading…</p>';
  try {
    const r = await fetch(`${HTTP}/skills/${encodeURIComponent(name)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    activeDraft = (await r.json()) as SkillFull;
    renderWizard(activeDraft);
  } catch (err) {
    detailEl.innerHTML = `<p class="empty">Failed to load: ${String(err)}</p>`;
  }
}

/**
 * Heuristically detect candidate slots: every `type`-step with a non-trivial
 * literal value becomes a candidate. The user can accept/reject and rename.
 */
function inferSlotCandidates(skill: SkillFull): SlotDef[] {
  const seen = new Set<string>(skill.frontmatter.slots?.map((s) => s.name) ?? []);
  const candidates: SlotDef[] = [...(skill.frontmatter.slots ?? [])];
  let counter = 0;
  for (const step of skill.flow.steps) {
    if (step.type !== 'type') continue;
    const value = step.value ?? '';
    if (!value || value.length === 0) continue;
    if (value.startsWith('{{') && value.endsWith('}}')) continue;
    counter += 1;
    let base = guessSlotName(value, step.selectors) || `field_${counter}`;
    if (seen.has(base)) {
      let i = 2;
      while (seen.has(`${base}_${i}`)) i += 1;
      base = `${base}_${i}`;
    }
    seen.add(base);
    candidates.push({
      name: base,
      type: 'string',
      description: `value typed at step (was: ${truncate(value, 40)})`,
      required: true,
    });
  }
  return candidates;
}

function guessSlotName(value: string, selectors?: string[][]): string {
  const head = selectors?.[0]?.[0] ?? '';
  // Try inferring from a CSS selector like input#email or [name="email"]
  const idMatch = head.match(/#([a-z][a-z0-9_-]*)/i);
  if (idMatch?.[1]) return slugify(idMatch[1]);
  const nameMatch = head.match(/name=["']([^"']+)["']/);
  if (nameMatch?.[1]) return slugify(nameMatch[1]);
  if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(value)) return 'email';
  if (/^https?:\/\//i.test(value)) return 'url';
  if (/^\+?\d[\d\s().-]{6,}$/.test(value)) return 'phone';
  return '';
}

function slugify(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function renderWizard(skill: SkillFull): void {
  if (!detailEl) return;
  const slotCandidates = inferSlotCandidates(skill);

  detailEl.innerHTML = '';
  const form = document.createElement('form');
  form.className = 'wizard';
  form.addEventListener('submit', (e) => e.preventDefault());

  // Step 1: identity
  const headRow = document.createElement('div');
  headRow.className = 'head-row';
  const headLeft = document.createElement('div');
  const h2 = document.createElement('h2');
  h2.textContent = `Skill: ${skill.name}`;
  headLeft.append(h2);
  headRow.append(headLeft);
  const headRight = document.createElement('div');
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-danger';
  delBtn.textContent = 'Delete draft';
  delBtn.addEventListener('click', () => void onDelete(skill.name));
  headRight.append(delBtn);
  headRow.append(headRight);
  form.append(headRow);

  form.append(field('Skill name (kebab-case)', input('name', skill.name, 'send-message')));
  form.append(
    field(
      'Description',
      textarea('description', skill.description, 'min 10 chars — what does this skill do?'),
    ),
  );

  // Step 2: slots
  const slotsTitle = document.createElement('h3');
  slotsTitle.textContent = 'Slots';
  form.append(slotsTitle);
  const slotsHint = document.createElement('p');
  slotsHint.className = 'hint';
  slotsHint.textContent =
    'Each slot becomes a `{{name}}` placeholder in the flow. Slot values are passed at runtime via run.js argv.';
  form.append(slotsHint);
  const slotsContainer = document.createElement('div');
  slotsContainer.id = 'slots-container';
  for (const slot of slotCandidates) appendSlotRow(slotsContainer, slot);
  form.append(slotsContainer);
  const addSlotBtn = document.createElement('button');
  addSlotBtn.type = 'button';
  addSlotBtn.className = 'btn';
  addSlotBtn.textContent = '+ Add slot';
  addSlotBtn.addEventListener('click', () =>
    appendSlotRow(slotsContainer, {
      name: '',
      type: 'string',
      description: '',
      required: true,
    }),
  );
  form.append(addSlotBtn);

  // Step 3: flow preview (read-only)
  const flowTitle = document.createElement('h3');
  flowTitle.textContent = `Flow (${skill.flow.steps.length} steps)`;
  form.append(flowTitle);
  const flowPre = document.createElement('pre');
  flowPre.textContent = JSON.stringify(skill.flow, null, 2);
  form.append(flowPre);

  // Step 4: body / SKILL.md
  const bodyTitle = document.createElement('h3');
  bodyTitle.textContent = 'SKILL.md body';
  form.append(bodyTitle);
  const bodyTa = document.createElement('textarea');
  bodyTa.id = 'body';
  bodyTa.rows = 8;
  bodyTa.value = skill.body;
  form.append(bodyTa);

  // Step 5: actions
  const actions = document.createElement('div');
  actions.className = 'wizard-actions';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn';
  saveBtn.textContent = 'Save draft';
  saveBtn.addEventListener('click', () => void onSave(form, skill));

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'btn btn-primary';
  downloadBtn.textContent = 'Generate .skill (download)';
  downloadBtn.addEventListener('click', () => void onGenerate(form, skill));

  actions.append(saveBtn, downloadBtn);
  form.append(actions);

  const exportLink = document.createElement('a');
  exportLink.href = `${HTTP}/skills/${encodeURIComponent(skill.name)}/export`;
  exportLink.textContent = 'Or export raw zip (no slot rewrites)';
  exportLink.className = 'link';
  exportLink.download = `${skill.name}.skill`;
  form.append(exportLink);

  detailEl.append(form);
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(span, control);
  return wrap;
}

function input(id: string, value: string, placeholder: string): HTMLInputElement {
  const el = document.createElement('input');
  el.id = id;
  el.type = 'text';
  el.value = value;
  el.placeholder = placeholder;
  return el;
}

function textarea(id: string, value: string, placeholder: string): HTMLTextAreaElement {
  const el = document.createElement('textarea');
  el.id = id;
  el.value = value;
  el.placeholder = placeholder;
  el.rows = 3;
  return el;
}

function appendSlotRow(container: HTMLElement, slot: SlotDef): void {
  const row = document.createElement('div');
  row.className = 'slot-row';
  row.dataset.slot = '1';
  row.append(
    slotInput('name', slot.name, 'snake_case_name'),
    slotSelect('type', slot.type),
    slotInput('description', slot.description, 'what is this slot for?'),
    slotCheckbox('required', slot.required ?? true),
  );
  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'slot-remove';
  rm.textContent = '×';
  rm.addEventListener('click', () => row.remove());
  row.append(rm);
  container.append(row);
}

function slotInput(field: string, value: string, placeholder: string): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'text';
  el.dataset.field = field;
  el.value = value;
  el.placeholder = placeholder;
  return el;
}

function slotSelect(field: string, value: string): HTMLSelectElement {
  const el = document.createElement('select');
  el.dataset.field = field;
  for (const t of ['string', 'choice', 'dynamic']) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    if (t === value) opt.selected = true;
    el.append(opt);
  }
  return el;
}

function slotCheckbox(field: string, value: boolean): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'slot-required-toggle';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.dataset.field = field;
  cb.checked = value;
  wrap.append(cb, document.createTextNode(' required'));
  return wrap;
}

function readSlotsFromForm(form: HTMLFormElement): SlotDef[] {
  const slots: SlotDef[] = [];
  const rows = form.querySelectorAll<HTMLElement>('[data-slot="1"]');
  for (const row of rows) {
    const name = (row.querySelector<HTMLInputElement>('[data-field="name"]')?.value ?? '').trim();
    if (!name) continue;
    const type =
      (row.querySelector<HTMLSelectElement>('[data-field="type"]')?.value as SlotDef['type']) ??
      'string';
    const description =
      row.querySelector<HTMLInputElement>('[data-field="description"]')?.value ?? '';
    const required =
      row.querySelector<HTMLInputElement>('[data-field="required"]')?.checked ?? true;
    slots.push({ name, type, description, required });
  }
  return slots;
}

function rewriteFlowWithSlots(flow: Flow, slots: SlotDef[]): Flow {
  // Replace literal values in `type` steps with `{{slot}}` placeholders.
  // For deterministic mapping we walk type-steps in order and pair with the
  // slots in order; that's how the wizard generates them.
  const slotQueue = slots.filter((s) => !s.name.startsWith('_'));
  let i = 0;
  const newSteps = flow.steps.map((step) => {
    if (step.type !== 'type' || !step.value) return step;
    const slot = slotQueue[i];
    i += 1;
    if (!slot) return step;
    if (step.value.startsWith('{{') && step.value.endsWith('}}')) return step;
    return { ...step, value: `{{${slot.name}}}` };
  });
  return { ...flow, steps: newSteps };
}

async function onSave(form: HTMLFormElement, skill: SkillFull): Promise<void> {
  const newName = (form.querySelector<HTMLInputElement>('#name')?.value ?? '').trim();
  const description = (form.querySelector<HTMLTextAreaElement>('#description')?.value ?? '').trim();
  const body = form.querySelector<HTMLTextAreaElement>('#body')?.value ?? skill.body;
  const slots = readSlotsFromForm(form);
  const flow = rewriteFlowWithSlots(skill.flow, slots);
  if (!validate(newName, description)) return;

  if (newName !== skill.name) {
    await fetch(`${HTTP}/skills/${encodeURIComponent(skill.name)}`, {
      method: 'DELETE',
    });
    const r = await fetch(`${HTTP}/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, description, flow, slots, body }),
    });
    if (!r.ok) {
      alert(`Save failed: HTTP ${r.status} ${await r.text()}`);
      return;
    }
    activeName = newName;
  } else {
    const r = await fetch(`${HTTP}/skills/${encodeURIComponent(skill.name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, flow, slots, body }),
    });
    if (!r.ok) {
      alert(`Save failed: HTTP ${r.status} ${await r.text()}`);
      return;
    }
  }
  await loadSkills();
  if (activeName) await renderDetail(activeName);
}

async function onGenerate(form: HTMLFormElement, skill: SkillFull): Promise<void> {
  const newName = (form.querySelector<HTMLInputElement>('#name')?.value ?? '').trim();
  const description = (form.querySelector<HTMLTextAreaElement>('#description')?.value ?? '').trim();
  const body = form.querySelector<HTMLTextAreaElement>('#body')?.value ?? skill.body;
  const slots = readSlotsFromForm(form);
  const flow = rewriteFlowWithSlots(skill.flow, slots);
  if (!validate(newName, description)) return;
  try {
    const resp = await fetch(`${HTTP}/skills/zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, description, flow, slots, body }),
    });
    if (!resp.ok) {
      alert(`Generate failed: HTTP ${resp.status} ${await resp.text()}`);
      return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${newName}.skill`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    alert(`Generate failed: ${String(err)}`);
  }
}

function validate(name: string, description: string): boolean {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    alert('Skill name must be kebab-case (a-z, 0-9, -).');
    return false;
  }
  if (description.length < 10) {
    alert('Description must be at least 10 characters.');
    return false;
  }
  return true;
}

async function onDelete(name: string): Promise<void> {
  if (!confirm(`Delete draft "${name}"? This is irreversible.`)) {
    return;
  }
  try {
    const r = await fetch(`${HTTP}/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    activeName = null;
    activeDraft = null;
    if (detailEl) detailEl.innerHTML = '<p class="empty">Draft deleted.</p>';
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
