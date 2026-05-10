# REFACTOR_REPORT — Skill Generator + Lobby WS Auto-Spawn

**Data:** 2026-05-10
**Branch:** `claude/refactor-skills-generator-ws-XjniI`
**Escopo:** transformar `agent-ask-anywhere` de "monorepo Fastify 24/7 +
extensão" em **gerador de Agent Skills** com **lobby WebSocket que
auto-spawna**.

## TL;DR — o que ficou

```
Antes:                                    Depois:
┌──────────────────────┐                 ┌──────────────────────┐
│ Fastify :7860 + LLM  │                 │ Lobby :7878          │
│ WebSocket :8765      │                 │ HTTP+WS no mesmo     │
│ secrets.json + git   │                 │ listener, lock-file  │
│ /chat /skills /etc   │                 │ /run /skills/zip     │
└──────────┬───────────┘                 └─────┬───────┬────────┘
           │                                   │       │
        Extensão                          Extensão  Skill zips
                                          (WS)      (HTTP run.js)
```

| Antes | Depois |
|---|---|
| 2 portas (HTTP 7860 + WS 8765) | 1 porta (7878) com HTTP/WS upgrade |
| Servidor 24/7 (`pnpm dev:server`) | Lobby auto-spawn detached |
| LLM orchestrator + `/chat` | Removido — skills são determinísticas |
| `secrets.json` + slot `secret` | Removido — slots são plain-text |
| `run-history` JSONL | Removido — agente do código mantém logs |
| Skills no fs (`~/.local/agent-skills`) | Skills no fs (`~/.local/share/agent-ask-anywhere/skills`) com **export como `.skill` zip plug-and-play** |
| Versionamento via git embutido | Removido — agente do código pode `git init` se quiser |
| Options page = listador | Options page = **wizard** de slots + geração de zip |

Tudo passa: `pnpm typecheck` (3/3), `pnpm lint` (57 files), `pnpm test`
(85/85), `pnpm build` (3/3).

---

## Mapa de mudanças por package

### `packages/lobby/` (renomeado de `packages/server/`)

**Removido:**
- `src/chat/routes.ts` — endpoint `/chat` do orchestrator
- `src/llm/{anthropic,extension-rpc,orchestrator,provider,tools}.ts` — todo o stack LLM
- `src/secrets.ts` — keystore JSON e `resolveSecrets`
- `src/skills/run-history.ts` — JSONL append por run
- `src/skills/routes.ts` (Fastify) — substituído por `http-routes.ts` (Node http nativo)
- `src/index.ts` (Fastify) — substituído pela versão com `http.createServer` + `ws.WebSocketServer({noServer:true})`
- `src/ws.ts` (versão antiga) — substituída pela nova com role-aware peers
- Dependências `fastify`, `@anthropic-ai/sdk`

**Adicionado:**
- `src/index.ts` — bootstrap único, HTTP+WS na porta 7878, lock-file, graceful shutdown
- `src/http-routes.ts` — handler nativo Node http (sem Fastify); endpoints `/health`, `/run`, `/skills`, `/skills/:name`, `/skills/:name/export`, `/skills/zip`, `/skills/import`
- `src/ws.ts` — WS com `peer:register` (extension/skill-client/wizard) e fallback para legacy `hello { client: 'extension' }`
- `src/run-broker.ts` — multiplex `runId` (substitui o antigo `extension-rpc.ts`)
- `src/lockfile.ts` — `O_EXCL` lock com detecção de PID órfão (`process.kill(pid, 0)`)
- `src/skills/template.ts` — gerador do zip `.skill` (SKILL.md, flow.json, run.js, lobby-bootstrap.js, meta.json, package.json, INSTALL.md), tudo com **zero deps de npm**
- `src/skills/manager.ts` — mantido, mas com dois tweaks:
  - **`SKILLS_ROOT` mudou de `~/.local/agent-skills` para `~/.local/share/agent-ask-anywhere/skills`** (XDG-friendly)
  - **`gitCommit()` removido** — versionamento volta a ser opcional do usuário

**Mantido sem mudanças:**
- `src/skills/export-import.ts` (zip-slip protection intacta)
- `src/skills/recording-buffer.ts`

### `packages/shared/`

**`messages.ts`:**
- Adicionado `peer:register { role: 'extension' | 'skill-client' | 'wizard', runId? }`
- `runId` agora é **obrigatório** em `flow:run`, `flow:result`, `step:result`
  (antes era optional → causava routing ambíguo no broker)
- Cliente do `hello` agora aceita `extension | lobby | skill-client | wizard` (antes: `extension | server`)

**`skill-schema.ts`:**
- Slot type `secret` removido do enum (`SlotTypeSchema = ['string', 'choice', 'dynamic']`)
- Frontmatter mantido idêntico no resto

**`flow-schema.ts`:** sem mudanças — o schema do `Flow` é o mesmo.

**`slots.ts`:** sem mudanças — `fillFlow` continua funcionando.

### `packages/extension/`

**`entrypoints/offscreen/main.ts`:**
- WS URL mudou de `ws://localhost:8765` para `ws://127.0.0.1:7878/ws`
- Envia `peer:register { role: 'extension' }` após `hello`

**`entrypoints/background.ts`:**
- HTTP base mudou de `http://127.0.0.1:7860` para `http://127.0.0.1:7878`
- `runId` em `flow:run` é tratado como obrigatório (não tem mais o fallback `run-${Date.now()}`)

**`entrypoints/popup/`:**
- Texto de status: "Connected to lobby :7878"
- Adicionado link "Open wizard / options →" que abre a options page

**`entrypoints/options/main.ts` — REESCRITO COMO WIZARD:**
- Antes: listador read-only de skills com export/import/delete
- Depois: **wizard editável** com:
  1. Inferência heurística de slot candidates a partir de `type`-steps com valor literal (heurísticas: id/name CSS selector → `slugify`; email → `email`; URL → `url`; phone → `phone`; senão `field_N`)
  2. Tabela de slots editável (nome, tipo, descrição, required, +adicionar/remover)
  3. Edição de nome (kebab-case), descrição, body do SKILL.md
  4. Read-only preview do flow.json
  5. **"Save draft"** → `PUT /skills/:name` (ou DELETE+POST se rename)
  6. **"Generate .skill (download)"** → `POST /skills/zip` → blob download
  7. Manteve "Import .skill", "Export raw zip"

### `packages/extension/lib/`

**Sem mudanças** — recorder, replay (synthetic + cdp), captcha-watch,
force-open-shadow, ax-tree continuam idênticos. A invariante
"`syntheticRunner` é self-contained" foi preservada.

### Root

- `package.json`: script `dev:server` → `dev:lobby`
- `pnpm-workspace.yaml`: sem mudanças (glob `packages/*` continua pegando o renomeado)
- `AGENTS.md`: reescrito refletindo o novo layout, invariantes e onde mexer com cuidado
- `README.md`: reescrito do zero com o fluxo "grave → wizard → baixe `.skill` → `node run.js`"
- `docs/TECHNICAL.md`: marcado como **legado** com banner; mantido por valor histórico (recorder/replay descritos lá continuam corretos)

---

## Protocolo WS — schema novo (resumo)

### Mensagens novas / alteradas

```ts
// ✨ Novo
{ type: 'peer:register', role: 'extension' | 'skill-client' | 'wizard', runId?: string }

// 🔄 runId virou required (antes optional)
{ type: 'flow:run',    runId: string, flowId: string, flow?: Flow, slots: Record<string,string> }
{ type: 'flow:result', runId: string, flowId: string, ok: boolean, error?: string, durationMs?: number }
{ type: 'step:result', runId: string, stepIdx: number, ok: boolean, error?: string, durationMs?: number }

// 🔄 client enum estendido
{ type: 'hello', client: 'extension'|'lobby'|'skill-client'|'wizard', version?: string }
```

### Multiplex no `RunBroker`
- `pendingRuns: Map<runId, { resolve, reject, steps, timer }>`
- HTTP `POST /run` cria runId, registra pendente, manda `flow:run` para a extensão
- `flow:result` da extensão resolve o promise; `step:result`s são acumulados em `pending.steps`

### Race-free auto-spawn
1. `lobby-bootstrap.js` faz `GET /health` (timeout 1.5s)
2. Se 200 OK → retorna; senão tenta achar binário (`AAA_LOBBY_BIN` → `~/.local/bin/aaa-lobby` → `/usr/local/bin/aaa-lobby` → `/opt/homebrew/bin/aaa-lobby`)
3. `spawn(binary, [], { detached: true, stdio: ['ignore', out, err] }); child.unref()`
4. Polling em `/health` por até 8s (250ms intervalo)
5. **No lobby:** `acquireLock(port)` usa `O_EXCL`; se `EEXIST` e PID alive ≠ próprio → `LockFileBusyError` (e o lobby duplicado faz `process.exit(0)` cleanly, deixando o vencedor da corrida ativo)

---

## Decisões fora do plano original (e por quê)

O tutorial original sugeria implementar tudo via **WebSocket puro** —
inclusive os skill clients. Eu **mudei para HTTP-only para skill clients**
(WS continua para a extensão, full-duplex). Razões:

1. **Zero deps de npm no zip da skill.** Node 22+ tem WebSocket nativo,
   mas Node 20 (mínimo do projeto) não — exigiria empacotar `ws` ou
   escrever um cliente WS manualmente. HTTP nativo é trivial.
2. **Modelo "request/response" da skill é fire-and-wait.** Não há
   benefício real em manter um socket aberto para cada `node run.js`.
   `POST /run` long-poll resolve quando `flow:result` chega — mesma
   semântica, código muito menor.
3. **Multiplex segue funcionando** — `RunBroker` mantém um `Map<runId>`
   exatamente como antes; quem é o "consumer" do promise é o handler
   HTTP, não outro peer WS.

Outras decisões pragmáticas:

| Plano original | O que fiz | Motivo |
|---|---|---|
| Fastify migrado para porta 7878 | Substituí Fastify por Node `http.createServer` | Removeu dependência grande e simplificou o upgrade WS no mesmo listener |
| Slot `secret` mantido como opt-in | Removido completamente | Plano disse explicitamente "secrets.json deletado" e o LLM-vazio não tem usuário do slot secret |
| `notifications`/`alarms` permissions removidas | Mantidas | Nenhuma feature usa, mas mudar manifest exige re-prompt do user; deixei pra fase posterior |
| Wizard como app SPA separado | Wizard reusa a Options page MV3 | Reduz superfície de código; a UI já tinha a infra de `chrome.runtime.onMessage` + WS bridge |
| Detecção de slots LLM-driven | Heurística (id/name + email/url/phone regex + counter) | Sem LLM no projeto, heurística é suficiente como ponto de partida; usuário ajusta |
| `force_open_shadow` re-registrado pela extensão | Mantido como antes | A extensão continua agregando `metadata.force_open_shadow` de todas as skills via `skills:updated` event — fluxo preservado |
| `secrets.test.ts` e `run-history.test.ts` apagados | Apagados sem substituto | Funcionalidade removida; não há o que testar |
| Tests de manager preservavam git assertions | Já não tinham; `gitCommit` foi removido | Manager test passou intocado |

### Caveats e o que **não** está coberto nesta entrega

1. **Endpoint `/agentic-replay` (LLM fallback) — não foi reintroduzido.**
   Se você quiser de volta, dá pra montar um plugin opt-in lendo
   `ANTHROPIC_API_KEY` no boot. Fora do escopo desta refatoração.
2. **Ainda não há binary distribution do lobby.** Para usar o
   auto-spawn, é preciso ou definir `AAA_LOBBY_BIN` apontando pra
   `packages/lobby/src/index.ts` (com tsx instalado globalmente) ou
   gerar um binário com `pkg`/`bun build --compile`. O `INSTALL.md`
   dentro do zip explica.
3. **Wizard não mostra preview do SKILL.md renderizado.** É um
   `<textarea>` cru. Adicionar marked/markdown-it é trivial mas não
   urgente.
4. **HTTP `/skills/import` em base64** ainda não foi exposto pela UI;
   só raw zip via `POST /skills/import` Content-Type `application/zip`.
   A UI já usa esse modo.
5. **Lock-file órfão depois de SIGKILL** ainda gera 1.5s de latência
   na primeira skill seguinte (timeout do health check + remoção do
   lock). Aceitável.
6. **Concorrência multi-extensão.** O broker faz broadcast pra todas
   as extensões conectadas; se duas instâncias do Chrome conectarem,
   ambas vão executar o mesmo flow. Em prática só haverá uma — mas
   não há lock explícito.

---

## Anatomia do zip gerado (final)

```
my-skill/
├── SKILL.md             # frontmatter YAML + body markdown
├── flow.json            # FlowSchema-compliant (com {{slots}})
├── meta.json            # { name, description, version, slots[] }
├── run.js               # entry point Node — POST /run via http nativo
├── lobby-bootstrap.js   # ensureLobby() — health check + spawn detached
├── package.json         # bin map; engines node>=20; sem deps
└── INSTALL.md           # docs de prerequisites + exit codes + env vars
```

`run.js` exit codes:
- `0`: success
- `1`: flow ran mas `ok=false`
- `2`: invalid slots / argv
- `3`: lobby unreachable & não-spawnável (binário não achado)
- `4`: HTTP/network error durante run

---

## Como testar manualmente o end-to-end (smoke test)

```bash
# Terminal 1 — lobby
pnpm dev:lobby

# Terminal 2 — extensão
pnpm dev:extension

# Carregue a extensão em chrome://extensions, popup deve mostrar
# "Connected to lobby :7878". Grave um fluxo simples.

# Terminal 3 — gere a skill via wizard (Options) e baixe my-skill.skill
unzip my-skill.skill -d /tmp
node /tmp/my-skill/run.js '{"slot_a":"value"}'
```

Validações já feitas neste branch:
- ✅ `GET /health` retorna `{"ok":true,"version":"1.0.0",...}`
- ✅ `POST /skills/zip` produz zip de 4756 bytes com 7 arquivos
- ✅ `node --check run.js` e `node --check lobby-bootstrap.js` passam (Node JS válido)
- ✅ `node run.js` sem lobby + sem `AAA_LOBBY_BIN` → exit 3 + mensagem clara
- ✅ `node run.js` com lobby up mas sem extensão → exit 4 + "no extension connected to lobby"
- ✅ Lock-file: stale PID detectado e removido; live PID throws `LockFileBusyError`
- ✅ `pnpm typecheck` clean (3/3 packages)
- ✅ `pnpm lint` clean (57 files)
- ✅ `pnpm test` clean (85/85 tests)
- ✅ `pnpm build` clean (extension chrome-mv3 219KB total, lobby compile, shared compile)

---

---

## Audit pass #1 (post-merge fixes)

Após o primeiro commit, fiz uma **revisão crítica** procurando por falhas
e pesquisei na internet sobre quirks de MV3 (Private Network Access,
chrome.offscreen reasons, SW fetch a localhost). Encontrei e corrigi
estes problemas:

### Bugs encontrados

| # | Bug | Severidade | Fix |
|---|---|---|---|
| 1 | `lockfile.ts` registrava handlers de `SIGINT`/`SIGTERM` que faziam `process.exit(0)`. Isso curtocircuitava o shutdown gracioso de `index.ts` (`httpServer.close()`), abortando in-flight requests. | 🔴 alto | Removidos os handlers de signal do `lockfile.ts`. Mantido apenas `process.on('exit', release)` como rede de proteção. O caller em `index.ts` chama `release()` no shutdown. |
| 2 | `httpServer.on('upgrade')` rejeitava URLs com query string (`req.url !== '/ws'` falha em `/ws?token=…`). | 🟡 médio | Parse via `new URL(req.url, 'http://...').pathname` antes do match. |
| 3 | Wizard rename fazia `DELETE` → `POST` sem pre-check; se o `POST` falhasse (ex.: nome já existe), o draft original era **perdido**. | 🔴 alto | Adicionado pre-check em `allSkills` por conflito; em caso de falha do POST, tenta `restore` com os dados originais. |
| 4 | `template.ts` já passava `timeoutMs` mas sem comentário explicando — risco de regressão silenciosa em refactors futuros. | 🟢 baixo | Adicionado comentário documentando o invariante. |
| 5 | `offscreen/main.ts`: listeners do `ws` antigo continuavam vivos após reconnect, podendo agendar reconnects duplicados se o `close` chegasse atrasado. | 🟡 médio | Cada handler captura o socket original via closure e early-returns se `ws !== sock` (não é mais o socket atual). |
| 6 | `chrome.offscreen.createDocument({ reasons: ['BLOBS'] })`: BLOBS funciona mas é semanticamente errado (é pra `Blob`/`createObjectURL`). Pesquisa em `developer.chrome.com/docs/extensions/reference/api/offscreen` confirma que **só `AUDIO_PLAYBACK` tem auto-terminate de 30s**, mas reasons mismatched podem ser policiados em versões futuras. | 🟢 baixo | Trocado para `WORKERS` (mais idiomático para "JS keep-alive em background"). |
| 7 | Permissões `notifications` e `alarms` no manifest não eram usadas — adiciona prompt de instalação sem ganho. | 🟢 baixo | Removidas. |
| 8 | Descrição do manifest ainda mencionava "Browser automation híbrida (determinístico + LLM)" — desatualizado. | 🟢 baixo | Atualizado para "Skill generator com lobby WebSocket auto-spawn". |

### Pesquisa MV3 (verificações que **NÃO** precisaram de fix)

- **Private Network Access (Chrome 124+) / Local Network Access (Chrome 138+ opt-in, ~141 enforcement):** confirmado que extensões com `host_permissions` cobrindo o IP privado **estão exemptas** dos prompts de PNA/LNA (oficial: developer.chrome.com/blog/local-network-access). Setup atual está correto. Workaround se um dia bater: o lobby pode emitir `Access-Control-Allow-Private-Network: true` na preflight.
- **SW fetch a `http://127.0.0.1`:** sem restrição. Loopback é tratado como secure origin em MV3. `host_permissions: ['<all_urls>']` cobre. Default CSP `connect-src` permite localhost.
- **Offscreen + WebSocket:** documentação explícita de Chrome diz que `AUDIO_PLAYBACK` é o único reason com lifetime cap. Outros (incluindo `BLOBS` e `WORKERS`) **não auto-terminam**. Ambos funcionariam, mas `WORKERS` é mais semanticamente alinhado.

### Novos testes

- `test/template.test.ts`: **`node --check`** real via `execFileSync` no `run.js` e `lobby-bootstrap.js` gerados (catch syntax error que regex não pega) + verificação de `module.exports = { ensureLobby, ... }`
- `test/run-broker.test.ts`: 5 cenários do RunBroker — peer registration, no-extension rejection, **multiplex de 2 runs concorrentes resolvendo out-of-order**, timeout cleanup, unregister.

Total de testes: **85 → 92** (+7).

### Validação final pós-fix

- ✅ `pnpm typecheck` — 3/3 packages
- ✅ `pnpm lint` — 58 files (1 a mais — arquivo de teste novo)
- ✅ `pnpm test` — 92/92 (54 shared + 38 lobby)
- ✅ `pnpm build` — extension chrome-mv3 219.58KB (era 219.03KB; +0.55KB do código de wizard atomicidade)

---

## Próximos passos sugeridos (fora desta PR)

1. **Empacotar lobby como single-file binary** (`pkg lobby/dist/index.js -t node20-linux-x64`) e drop em `~/.local/bin/aaa-lobby` no postinstall opcional.
2. **Wizard step 2: preview SKILL.md renderizado** com `marked` (já tem `gray-matter`, é meio passo).
3. **Reintroduzir LLM como opt-in** via `POST /agentic-replay` se `ANTHROPIC_API_KEY` setada. Mantém cleanup atual e não mexe no zip da skill.
4. **Logs de run no `~/.local/share/agent-ask-anywhere/runs/`** — opcional, só append se `AAA_KEEP_RUN_LOGS=1`.
5. **Firefox compat** — checar `browser.offscreen` (não existe ainda); usar `background.persistent: true` ou alternativa.
