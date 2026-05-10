# Guia Técnico — agent-ask-anywhere

Este documento é o **guia técnico completo** do projeto. Para instruções de
uso, leia o [`README.md`](../README.md). Para as regras invioláveis que um
agente LLM precisa saber antes de tocar no código,
[`AGENTS.md`](../AGENTS.md).

---

## Índice

1. [Visão geral](#1-visão-geral)
2. [Arquitetura](#2-arquitetura)
3. [Fluxo de mensagens](#3-fluxo-de-mensagens)
4. [Schemas Zod (shared)](#4-schemas-zod-shared)
5. [Recorder — captura no DOM](#5-recorder--captura-no-dom)
6. [Replay engine](#6-replay-engine)
7. [Persistência como Agent Skills](#7-persistência-como-agent-skills)
8. [Slots e secrets](#8-slots-e-secrets)
9. [LLM orchestrator](#9-llm-orchestrator)
10. [REST API](#10-rest-api)
11. [Run history](#11-run-history)
12. [Modelo de segurança](#12-modelo-de-segurança)
13. [Decisões e trade-offs](#13-decisões-e-trade-offs)
14. [Limitações conhecidas](#14-limitações-conhecidas)
15. [Caveats descobertos pós-implementação](#15-caveats-descobertos-pós-implementação)
16. [Troubleshooting profundo](#16-troubleshooting-profundo)

---

## 1. Visão geral

`agent-ask-anywhere` resolve o problema de **automação web confiável + flexível**
combinando dois modos:

- **Determinístico:** o usuário grava um fluxo clicando, gera um `flow.json`
  com cadeia de seletores, e o replay reexecuta em milissegundos sem chamar
  LLM.
- **Agentic:** quando um passo falha (selector mudou, página mudou de
  layout), o orchestrator pode invocar `get_page_state`, inspecionar o DOM
  textualizado, e raciocinar sobre próximos passos via tool calling.

Skills são salvas no formato **Agent Skills** da Anthropic
(`SKILL.md` com frontmatter YAML + `flow.json`), versionadas em git no
diretório `~/.local/agent-skills/`.

## 2. Arquitetura

```
┌──────────────────────────────────────────────────────────────────────┐
│ Chrome MV3 Extension                                                 │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────┐       │
│  │ background │ │  offscreen   │ │   content    │ │  popup   │       │
│  │ (SW)       │←│  (WS bridge) │ │ (recorder UI)│ │ options  │       │
│  └────────────┘ └──────────────┘ └──────────────┘ └──────────┘       │
│        │               ↕ WebSocket :8765                             │
└────────┼─────────────────────────────────────────────────────────────┘
         │
         │ chrome.scripting (synthetic, MAIN world)
         │ chrome.debugger (CDP fallback)
         ↓
   [Active tab DOM]

┌──────────────────────────────────────────────────────────────────────┐
│ Node.js server                                                       │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────┐           │
│  │ Fastify :7860  │  │ ws server :8765 │  │ Skills mgr   │           │
│  │ (REST + chat)  │  │ Heartbeat 20s   │  │ (filesystem +│           │
│  │                │  │ Zod-typed       │  │  chokidar +  │           │
│  └────────────────┘  └─────────────────┘  │  git auto)   │           │
│         │                    │             └──────────────┘           │
│         ↓                    ↓                                        │
│  ┌─────────────────┐  ┌─────────────────┐                            │
│  │ Orchestrator    │  │ ExtensionRpc    │                            │
│  │ (Anthropic SDK +│  │ (run/page state │                            │
│  │  3 tools + slot │  │  request/reply  │                            │
│  │  resolution)    │  │  com timeout)   │                            │
│  └─────────────────┘  └─────────────────┘                            │
│         │                                                             │
│         ↓                                                             │
│  ┌─────────────────┐                                                 │
│  │ secrets.json    │  ~/.config/agent-ask-anywhere/                  │
│  │ (chmod 0600)    │                                                 │
│  └─────────────────┘                                                 │
└──────────────────────────────────────────────────────────────────────┘
```

### Por que offscreen + WebSocket?

Service workers MV3 morrem após ~30s de inatividade. Native Messaging exige
um host instalado fora do Chrome (atrito de UX). A solução é um
**offscreen document** com `reasons:['BLOBS']` que mantém o JS global vivo,
hospedando uma WebSocket persistente para `localhost:8765`.

## 3. Fluxo de mensagens

### Recording

```
content.recorder ──[step:recorded]──→ background ──[ws:outgoing]──→
  offscreen ──ws──→ server.ws ──→ recording-buffer.push()

popup [Stop] ──→ background ──→ offscreen ──ws[record:stop]──→
  server.ws ──→ buffer.stop() ──→ skills-manager.create() ──→
  fs.writeFile(SKILL.md, flow.json) ──→ git commit ──→
  chokidar.onChange ──→ ws.broadcast[skills:updated] ──→
  options.loadSkills()
```

### Replay (via REST `/chat`)

```
client → POST /chat {message:"..."}
  → orchestrator.handle()
    → llm.chat(messages, tools=[run_skill, list_skills, get_page_state])
    → tool_use: run_skill {skill_name, slots}
    → resolveSecrets(frontmatter, slots)  // adiciona secrets server-side
    → rpc.runFlow(...) ──[flow:run]──→ extension
                                          ↓
                                       background.handleFlowRun
                                          ↓
                                       runner.runFlow (synthetic+CDP fallback)
                                          ↓
                          ──[step:result × N, flow:result]──→ server
                                          ↓
                                       rpc.completeRun()
    → llm.chat(toolResult)
    → end_turn / next iteration (max 10)
  → return {text, iterations}
```

### Page state (recovery)

```
orchestrator → tool_use: get_page_state
  → rpc.getPageState() ──[page:get-state {requestId}]──→ extension
                                          ↓
                                       generateAxText(document.body)
                                          ↓
                          ──[page:state {requestId, axTree}]──→ server
                                          ↓
                                       resolve(...)
  → tool_result {url, title, ax_tree}
```

## 4. Schemas Zod (shared)

Todo dado que cruza fronteira passa por `safeParse`. Referência rápida:

### `WSMessage` (`messages.ts`)

`hello` · `ping`/`pong` · `record:start`/`record:stop` · `step:recorded` ·
`flow:run` (com `runId`, `flow`, `slots`) · `flow:result` · `step:result`
(com `runId` opcional) · `skills:updated` · `page:get-state` · `page:state`
· `error`.

### `Step` e `Flow` (`flow-schema.ts`)

Discriminated union por `type`:

| Tipo | Campos | Notas |
|---|---|---|
| `navigate` | `url` | Validado como URL |
| `click` / `dblclick` / `hover` | `selectors` | `SelectorChain = string[][]` (pelo menos 1×1) |
| `type` | `selectors`, `value`, `slot?` | `value` aceita `{{slot}}` |
| `press` | `key`, `selectors?` | Sem selector → activeElement |
| `select` | `selectors`, `value` | `value` aceita `{{slot}}` |
| `check` / `uncheck` | `selectors` | |
| `scroll` | `selectors?`, `x?`, `y?` | scrollIntoView ou window.scrollTo |
| `waitForElement` | `selectors`, `timeout=10000` | |
| `waitForExpression` | `expression`, `timeout=10000` | `expression` aceita `{{slot}}` |

Todos os steps aceitam: `description?`, `allowAgenticFallback?`, `useCDP?`.

### `SkillFrontmatter` (`skill-schema.ts`)

```yaml
name: kebab-case            # ^[a-z][a-z0-9-]*$
description: string min 10
license: string             # default 'MIT'
metadata:
  version: string           # default '1.0'
  flow_engine: string       # default 'browser-extension-v1'
  force_open_shadow: [host] # opcional, ver §6
  idempotent: bool          # opcional
slots:
  - name: snake_case        # ^[a-z][a-z0-9_]*$
    type: string|choice|dynamic|secret
    description: string
    required: bool          # default true
    enum: [string]          # opcional (p/ choice)
    default: string         # opcional
```

### `slots.ts`

`fillString(template, slots)` — replace `{{slot_name}}` com `slots[name]`.
Lança `MissingSlotError` se a chave não existe.

`fillFlow(flow, slots)` — aplica `fillString` recursivamente em
`navigate.url`, `type.value`, `select.value`, `waitForExpression.expression`.
Outros tipos passam intactos. Re-valida via `FlowSchema.parse` no fim
(invariante: o output continua um Flow válido).

## 5. Recorder — captura no DOM

`packages/extension/lib/recorder/`:

- **`overlay.ts`** — Web Component com Shadow DOM `mode:'closed'` para
  evitar que o site sobrescreva os estilos do highlight. Mostra retângulo
  laranja sobre o elemento sob o mouse + tooltip com selector primário e
  XPath.
- **`recorder.ts`** — registra listeners em `mousemove`/`click`/`input`/
  `keydown`/`change` em **capture phase** com `composedPath()` para
  atravessar shadow DOM aberta. Em `click`, chama
  `e.preventDefault()`/`e.stopPropagation()` para não disparar o
  comportamento real durante a gravação. Buffer de typing com debounce de
  300 ms — emite um único `type` step por sequência.
- **`selectors.ts`** — gera o **chain de seletores** com a ordem de
  estabilidade decrescente:
  1. `data-testid` / `data-test` / `data-tid` (se presente)
  2. `#id` se o id não casa `^(ember|react-|mui-|radix-|chakra-|css-|tw-|emotion-|sc-)`
  3. `aria/<role>[name="..."]`
  4. `text="..."` (apenas para tags com texto curto: button, a, span, label)
  5. CSS via `@medv/finder` filtrando classes voláteis com a mesma regex
  6. `xpath=...` como rede de segurança final
- **`xpath.ts`** — gera XPath relativo enumerando irmãos do mesmo tag.

O content script é registrado com `allFrames: true` + `matchAboutBlank: true`
+ `runAt: document_idle` para cobrir iframes de mesma origem.

## 6. Replay engine

`packages/extension/lib/replay/`:

### Pipeline (`runner.ts`)

```
runFlow:
  fillFlow(flow, slots)               # MissingSlotError → flow:result fail
  for each step:
    awaitCaptchaResolve(tabId)        # bloqueia até captcha clear (5min max)
    runStep(tabId, step):
      if step.useCDP === true:
        execute via CDP
      else:
        synthetic = runSynthetic()
        if synthetic.error == 'element not found':
          fall through to CDP
        else:
          return synthetic
    emit step:result {runId, stepIdx, ok, error, durationMs}
    if !ok: emit flow:result fail and break
    if step.type == 'navigate': waitForTabReady() + sleep(600ms)
  emit flow:result ok
```

Badge da extensão alterna `RUN` (verde) durante execução / `REC` (vermelho)
durante gravação.

### Modo synthetic (`synthetic.ts`)

Função self-contained injetada via
`chrome.scripting.executeScript({world:'MAIN', allFrames:true})`. Roda em
todos os frames; o primeiro que resolver o selector executa.

- `pierceQuery(root, sel)` — atravessa shadow roots **abertos** recursivamente
- `xpathFind(xp)` — `document.evaluate`
- `ariaFind('button[name="Send"]')` — itera candidatos por role implícito ou explícito
- `textFind('"...")` — match por `innerText.trim()` em tags textuais
- Para `type`, usa
  `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set?.call(el, value)`
  para fazer o React/Vue notarem a mudança (vs. `el.value = ...` direto que
  não dispara o setter sintetizado pelo framework).

### Modo CDP (`cdp.ts`)

`chrome.debugger.attach()` → `Runtime.evaluate` para localizar o elemento via
`getBoundingClientRect()`, depois `Input.dispatchMouseEvent` /
`Input.insertText` / `Input.dispatchKeyEvent` para gerar input real ao nível
do navegador (sobrevive a anti-bot que cheque eventos sintéticos vs. nativos).

**Jitter humano:**

- Mouse: curva Bezier de 4 control points × 5 sub-moves, com delay
  randomizado de 8–24 ms entre moves
- Click: 30–80 ms entre move final e mousePressed; 40–110 ms entre press e
  release
- Type: 40–120 ms entre teclas
- Press: 20–60 ms entre keyDown e keyUp

### Force-open shadow DOM (`force-open-shadow.ts` + `public/force-open-shadow.js`)

Para sites com `attachShadow({mode:'closed'})`, registramos um content script
em `world:'MAIN'`, `runAt:'document_start'`, `allFrames:true` que faz monkey
patch em `Element.prototype.attachShadow` forçando `mode:'open'`. O patch
camufla `toString()` para não vazar nas heurísticas mais bobas, mas não
sobrevive a fingerprinting sério.

A lista de domínios vem de `frontmatter.metadata.force_open_shadow` em cada
skill — `background.ts` agrega e re-registra via `syncForceOpenShadow()` a
cada `skills:updated`.

### Captcha (`captcha.ts`, `captcha-watch.ts`)

Heurísticas de detecção: iframes do reCAPTCHA / hCaptcha / Turnstile,
elementos `[id^="cf-chl-"]`, `div.g-recaptcha[data-sitekey]`. Quando
detectado:

1. Notifica o usuário via `chrome.notifications`
2. Faz polling de 2 s no DOM até o captcha sumir
3. Timeout de 5 min — se não sumir, falha o flow com `captcha block`

## 7. Persistência como Agent Skills

`packages/server/src/skills/`:

### Layout em disco

```
~/.local/agent-skills/
├── .git/                       # auto-init no boot do servidor
├── .history/                   # JSONL de runs (ver §11)
├── send-teams-message/
│   ├── SKILL.md                # frontmatter YAML + body markdown
│   ├── flow.json               # ver §4
│   └── assets/                 # opcional, ex.: screenshots
├── reply-jira-ticket/
└── draft-2026-05-10t14-23-45/  # auto-saved da gravação
```

### `SkillsManager`

- `init()` — cria o root, faz `git init -b main`, escaneia, monta watcher
- `scan()` — `readdir` filtrando dirs `.*`, lê `SKILL.md` + `flow.json`,
  parse via Zod, popula cache em memória
- Watcher (`chokidar`, depth 3) — reescaneia 200 ms após qualquer change
  (debounce); emite `skills:updated` para clientes WS
- `create/update/delete` — escreve em disco, faz `git add -A` +
  `git commit -m '<op>: <name>' --allow-empty` com `user.name`/`user.email`
  por commit (sem alterar config global)
- `gitCommit` — mensagem é JSON-quoted via `JSON.stringify` para evitar
  injection no shell do `execSync`

### Frontmatter via `gray-matter`

Lê com `matter(skillRaw)`, parse em `SkillFrontmatterSchema`, escreve com
`matter.stringify(body, fm)`. O body markdown sob o frontmatter é livre —
costuma ser uma descrição do "quando usar" e exemplos.

### Recording buffer (`recording-buffer.ts`)

Uma instância **por conexão WS**. `start()` zera o buffer. Cada
`step:recorded` faz `StepSchema.safeParse(rawStep)` — steps inválidos são
descartados com warn. `stop()` cria uma skill `draft-<iso-ts>` se houver
≥1 step. `abort()` é chamado em `ws.close()`.

## 8. Slots e secrets

### Tipos

| Tipo | Resolução | Exemplo |
|---|---|---|
| `string` | LLM preenche da mensagem do usuário | nome do destinatário |
| `choice` | LLM escolhe de `enum` | `["alta", "média", "baixa"]` |
| `dynamic` | LLM preenche com expressão derivada | data atual, CWD |
| `secret` | **Server-side**, nunca toca o LLM | API key, token |

### Resolução (`secrets.ts`)

```ts
async function resolveSecrets(fm, slotsFromLLM):
  result = { ...slotsFromLLM }
  for slot in fm.slots:
    if slot.type !== 'secret': continue
    value = await getSecret(slot.name)
    if value === null:
      if slot.required: throw
      else: continue
    result[slot.name] = value
  return result
```

`getSecret(name)` lê (com cache) `~/.config/agent-ask-anywhere/secrets.json`,
um JSON `{slot_name: value}`. Na primeira leitura, se o modo do arquivo não
for `0o600` ou `0o400`, faz `chmod 0600` defensivamente — evita o footgun
clássico de `0644 world-readable`.

O LLM declara apenas `slots: {recipient: "joao"}`; o servidor adiciona
`slots: {recipient: "joao", api_token: "sk-..."}` antes de mandar para a
extensão. Resultado: o secret nunca aparece em
`tool_use.input` nem em `tool_result.content` — invariante crítica.

## 9. LLM orchestrator

`packages/server/src/llm/`:

- **`provider.ts`** — interface `LLMProvider.chat()` para permitir trocar de
  Anthropic por OpenAI/Gemini/local sem mexer no orchestrator.
- **`anthropic.ts`** — implementação com `@anthropic-ai/sdk`. Modelo default
  `claude-sonnet-4-5`, override via `AAA_LLM_MODEL`. System prompt enviado
  com `cache_control: {type: 'ephemeral'}` — usa **prompt caching** para
  amortizar o catalog de skills entre turns.
- **`tools.ts`** — três tools com `input_schema` JSON Schema:
  - `run_skill(skill_name, slots, dry_run?)` — executa skill
  - `list_skills()` — devolve `[{skill_name, description, slots}]`
  - `get_page_state()` — devolve URL + title + AX tree
- **`orchestrator.ts`** — agent loop com **`MAX_ITERATIONS = 10`**. Para
  cada iteração: chama LLM, coleta `tool_use` blocks, dispatcha, anexa
  `tool_result`, repete até `stop_reason === 'end_turn'` ou sem tool calls.
- **`extension-rpc.ts`** — bridge request/response sobre WS. Cada `runFlow`
  gera um `runId` único; pending map resolve quando chega `flow:result`
  com o mesmo `runId`. Timeout default: 90 s (run), 8 s (page state).

### System prompt

```
You are an assistant that helps the user automate tasks in their browser via
"Agent Skills".

When the user requests an action:
1. If you don't recall the available skills, call list_skills first.
2. Choose the matching skill and fill its slots from the user's request.
3. Call run_skill with skill_name + slots map. Slot type 'secret' is resolved
   server-side; never put secrets in tool input.
4. If the call fails, you may call get_page_state to inspect the live UI before
   trying a recovery action.

Be concise. If a request is ambiguous, ask one short follow-up question instead
of guessing.

Installed skills:
<catalog injetado dinamicamente>
```

## 10. REST API

Base: `http://127.0.0.1:7860`. Body limit: 5 MB.

| Método | Path | Descrição |
|---|---|---|
| `GET` | `/health` | `{ok, wsClients, skillCount, llm, version}` |
| `GET` | `/skills` | Lista summary `[{name, description}]` |
| `GET` | `/skills/:name` | Skill completo (`frontmatter`, `body`, `flow`) |
| `POST` | `/skills` | Body: `{name, description, flow, body?, slots?, metadata?, license?}` |
| `PUT` | `/skills/:name` | Body parcial: `{description?, flow?, body?, slots?, metadata?}` |
| `DELETE` | `/skills/:name` | Remove + `git commit` |
| `GET` | `/skills/:name/export` | `Content-Type: application/zip`, `.skill` (zip) |
| `POST` | `/skills/import` | Body: zip raw OU `{zip: base64}` |
| `GET` | `/skills/:name/history` | `[{runId, size}]` desc por runId |
| `GET` | `/skills/:name/history/:runId` | `application/x-ndjson` (JSONL bruto) |
| `POST` | `/chat` | Body: `{message: string}` → `{text, iterations}` |

### Validação

- `name` em `:name` valida `^[a-z][a-z0-9-]*$`
- `runId` valida `^[a-zA-Z0-9_-]+$`
- `description` mínimo 10 chars
- `flow` valida via `FlowSchema`
- `slots`/`metadata` validam parcial via `SkillFrontmatterSchema.shape`

Erros: `400` invalid, `404` not found, `409` exists, `500` internal,
`503` LLM not configured.

## 11. Run history

`packages/server/src/skills/run-history.ts`:

Cada `flow:run` gera um `runId = run-<timestamp>-<random>`. Para cada run,
`~/.local/agent-skills/.history/<flowId>/<runId>.jsonl` registra:

```jsonl
{"event":"start","flowId":"send-teams-message","ts":"2026-05-10T14:23:45.123Z"}
{"event":"step","stepIdx":0,"ok":true,"durationMs":234,"ts":"..."}
{"event":"step","stepIdx":1,"ok":true,"durationMs":120,"ts":"..."}
{"event":"step","stepIdx":2,"ok":false,"error":"element not found","durationMs":10000,"ts":"..."}
{"event":"end","ok":false,"error":"step #2 (click): element not found","durationMs":10380,"ts":"..."}
```

`list(flowId)` retorna runs ordenados desc pelo timestamp embutido no
`runId`. `read(flowId, runId)` retorna o JSONL bruto (Content-Type
`application/x-ndjson`) — útil para `jq` ou inspeção offline.

Steps que chegam **sem** `runId` (clientes legados) são fan-out para todos
os pendings ativos (lossy sob concorrência, mas o orchestrator atual roda
serial).

## 12. Modelo de segurança

### Boundaries de confiança

```
[usuário]    ──→  [REST :7860]   ←Zod
[LLM remoto] ──→  [orchestrator] ←tools schema
[browser]    ──→  [WS :8765]     ←Zod
[disco]      ──→  [SKILL.md/flow]←Zod (frontmatter+flow)
[zip upload] ──→  [import]       ←path resolve + prefix check
```

### Threats e mitigações

| Threat | Mitigação |
|---|---|
| LLM exfiltrar secret via tool_use | `resolveSecrets` adiciona o valor **depois** do tool_use, na mensagem WS |
| LLM injection via descrição de skill | Prompt cacheado é estático após boot; catalog é só `name + description`, sem body markdown |
| Zip slip no import | `path.resolve` + `.startsWith(safeRoot + sep)` |
| Path traversal em `:name` | Regex `^[a-z][a-z0-9-]*$` em params do Fastify |
| Shell injection no `git commit -m` | `JSON.stringify(message)` antes do `execSync` |
| `secrets.json` world-readable | `chmod 0600` defensivo na primeira leitura |
| WebSocket externo se conectando | Server faz `host: '127.0.0.1'`, WS bind no localhost |
| CSP `unsafe-eval` bloqueando `new Function()` | Auto-fallback para CDP em `waitForExpression` |
| Cross-origin iframe | Content script com `allFrames:true`; CDP `Target.attachToTarget` para OOPIF |

### Manifesto da extensão

`key` (`.extension-key.txt`) é uma **chave RSA pública**. Garante CRX-ID
estável entre máquinas. Pode commitar — não tem nada secreto embarcado.

Permissões pedidas: `scripting`, `storage`, `tabs`, `activeTab`, `debugger`,
`offscreen`, `webNavigation`, `notifications`, `alarms`. Justificativa:
`debugger` é o único "amplo" — necessário para CDP fallback; o Chrome avisa
o usuário com banner amarelo enquanto anexado.

## 13. Decisões e trade-offs

1. **Comunicação Node↔Extensão = WebSocket localhost.** Sem polling, sem
   Native Messaging (que exigiria um host instalado fora do Chrome).
2. **Service worker mantido vivo via offscreen document.** Padrão de
   comunidade — a doc oficial avisa que WebSocket no offscreen "isn't
   supported and very unlikely to be", mas funciona porque o offscreen
   mantém o JS global vivo. Risco controlado.
3. **Synthetic + CDP coexistindo.** Synthetic é rápido e não trigga banner;
   CDP é robusto contra anti-bot. Auto-fallback em "element not found".
4. **Self-healing via chain de selectors** ordenado por estabilidade — não
   um único "best" selector que pode quebrar.
5. **LLM não no caminho feliz.** O agent loop só é invocado em `/chat`. O
   replay direto via `flow:run` não chama LLM — barato, rápido, idempotente.
6. **Slots tipados.** Em vez de aceitar qualquer string, declarar `enum`
   p/ `choice` e `secret` p/ injeção server-side dá mais determinismo no
   tool calling.
7. **Filesystem como storage** em vez de SQLite ou Anthropic Skills cloud.
   Versionável em git, editável com qualquer editor, exportável como zip
   sem export proprietário.
8. **Biome** em vez de Prettier+ESLint. Decisão estética + perf.
9. **`secrets.json`** em vez de `keytar` (OS keychain). Trade-off: perdemos
   integração nativa, ganhamos zero dependência nativa.
10. **`@anthropic-ai/sdk`** em vez de chamar a API REST direto. Vale o custo
    para ter prompt caching + tool use + types.

## 14. Limitações conhecidas

- **Cloudflare Turnstile / hCaptcha enterprise:** modo manual obrigatório.
  A extensão pausa, notifica via `chrome.notifications`, e retoma depois
  que o usuário resolve.
- **Apps em canvas/WebGL** (Figma, Google Maps): sem DOM acionável, fora
  de escopo. CDP `Input.dispatchMouseEvent` por coordenadas funciona em
  alguns casos, mas sem `getBoundingClientRect` confiável.
- **Iframes cross-origin com `sandbox="allow-scripts"`:** content script
  não roda; CDP `Target.attachToTarget` em OOPIF contorna parcialmente.
- **Step-through debugger UI:** não implementado nesta versão. Inspeção
  offline via `GET /skills/:name/history/:runId` (JSONL).
- **Múltiplos navegadores:** o offscreen + WS é por extensão, por perfil.
  Skill compartilhada entre máquinas exige importar via Options.

## 15. Caveats descobertos pós-implementação

Itens que merecem ciência do operador, descobertos em revisão crítica e
pesquisa:

- **Offscreen + WebSocket é padrão de comunidade, não API oficial.** A doc
  da Chrome avisa "WebSockets aren't a supported use for the Offscreen API
  and are very unlikely to be" — funciona porque o offscreen document
  mantém o JS global vivo, mas Google pode mudar. O `reasons:['BLOBS']` é
  pragmático (Chrome não valida que o offscreen *de fato* manipule blobs).
- **Banner amarelo "está debugando este navegador"** aparece sempre que o
  CDP é anexado. Sem flag `--silent-debugger-extension-api` no Chrome ou
  instalação por group policy, o usuário vê. Aceito para uso pessoal.
- **`waitForExpression` em modo synthetic usa `new Function(...)`** que é
  bloqueado por CSP `unsafe-eval` em sites como Gmail, GitHub. Nesses
  casos cai automaticamente para CDP (`Runtime.evaluate` é privilegiado).
- **`chrome.scripting.executeScript({func, world:'MAIN'})`** serializa a
  função via `Function.prototype.toString` e re-eval'a no contexto da
  página. O `syntheticRunner` é self-contained (sem closures, sem imports
  referenciados); bundlers que injetem helpers no body quebrariam isso
  silenciosamente.
- **`@types/node@^20.14.10` em runtime Node 24** gera ruído no readdir
  com `withFileTypes:true` (Dirent<NonSharedBuffer>). Workaround com cast
  está em `manager.ts:scan`.
- **WXT 0.19.16 está atrás da 0.20.x.** Bump é seguro mas não obrigatório.
- **Closed shadow DOM hook é "monkey patch brittle"** (palavras do whatwg).
  Sites com fingerprinting podem detectar comparando
  `Element.prototype.attachShadow.length` e `toString()` original.

## 16. Troubleshooting profundo

### "Servidor não vê a extensão" (`/health` mostra `wsClients: 0`)

1. Confirme que o offscreen subiu: em `chrome://extensions/`, vá em
   detalhes da extensão → **Inspect views: offscreen.html**. O console
   deve mostrar `[aaa/offscreen] WS open`.
2. Se ficar em loop de retry, cheque se a porta `8765` está ocupada por
   outro processo: `lsof -i :8765`.
3. Em ambientes corporativos, antivírus podem bloquear WS local. Teste
   com `node -e "new (require('ws').WebSocket)('ws://localhost:8765')"`.

### "step:result não aparece no /history"

1. O `runId` precisa estar presente no `step:result`. Clientes antigos
   sem `runId` ainda funcionam, mas a história agrupa por `runId` ativo.
2. Cheque `~/.local/agent-skills/.history/<flowId>/`. Se não existir,
   nenhum `flow:run` foi processado — provavelmente erro ANTES do
   `rpc.runFlow`.

### "LLM chama run_skill com slot que não existe"

Aumente o detalhamento das `slots[].description` no SKILL.md — o LLM
escolhe baseado em description. Se ainda assim errar, adicione `enum`
para forçar escolha entre N opções.

### "Replay funciona uma vez e quebra na segunda"

Selector capturado pode ter sido um id auto-gerado. Inspecione o `flow.json`:
se algum selector tem padrão `react-12345` ou similar, o filtro do recorder
não pegou. Adicione o prefix em `selectors.ts` (`UNSTABLE_ID` /
`UNSTABLE_CLASS`) e re-grave.

### "Closed shadow DOM ainda não abre"

1. Verifique que o domínio está em `frontmatter.metadata.force_open_shadow`
   da skill.
2. Recarregue a extensão (a registração de content script é persistente
   após `registerContentScripts`, mas pode falhar silenciosamente).
3. Cheque o console da página: deve aparecer
   `[aaa/force-open-shadow] active` no document_start.
4. Para fingerprinting agressivo, considere mover para CDP (que tem acesso
   privilegiado mesmo a closed shadow via `DOM.getDocument` + `pierceTo`
   flag).

### "Captcha detectado mas o flow não retoma"

Verifique se o iframe de fato sumiu — alguns sites mantêm o iframe oculto
após resolução. Se for o caso, adicione um seletor mais específico em
`captcha.ts:probes`. O timeout máximo é 5 min (`TIMEOUT_MS`).

### Logs

- **Servidor:** `pino-pretty` em dev (`LOG_LEVEL=info` default,
  `LOG_LEVEL=debug` para detalhes).
- **Background:** `chrome://extensions/` → **Service worker** (link na
  extensão). Reabra antes de cada teste — fecha automaticamente após
  inatividade.
- **Offscreen:** **Inspect views: offscreen.html** na mesma página.
- **Content script:** DevTools da página alvo (F12).
- **Replay:** `[aaa/replay] step #N click → ok (synthetic, 234ms)` no
  console do background.

### Reset completo

```bash
# para o servidor
# desinstale a extensão de chrome://extensions
rm -rf ~/.local/agent-skills
rm -rf ~/.config/agent-ask-anywhere
pnpm install
pnpm dev:server
pnpm dev:extension
# recarregue a extensão
```

---

## Apêndice A — versões testadas

- Node 20.18.x
- pnpm 11.0.9
- Chrome 116, 124, 130 (estável); Edge 124 (parcial)
- Linux (Ubuntu 22.04, Pop!_OS 22.04), macOS 14
- Anthropic SDK 0.95.x
- WXT 0.19.16

## Apêndice B — variáveis de ambiente

| Var | Default | Descrição |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Habilita `/chat` |
| `AAA_LLM_MODEL` | `claude-sonnet-4-5` | Override do modelo Anthropic |
| `AAA_SKILLS_ROOT` | `~/.local/agent-skills` | Onde skills moram (sobrescrever em testes) |
| `AAA_SECRETS_FILE` | `~/.config/agent-ask-anywhere/secrets.json` | Keystore |
| `HTTP_PORT` | `7860` | Porta REST |
| `WS_PORT` | `8765` | Porta WebSocket |
| `LOG_LEVEL` | `info` | `pino` (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) |
| `NODE_ENV` | — | `production` desabilita pino-pretty |
