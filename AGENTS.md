# AGENTS.md — guia para agentes LLM

Briefing curto para Claude Code, Cursor, Copilot, Codex, Gemini ou qualquer
agente de codificação trabalhando neste repositório. Para humanos: comece
pelo [`README.md`](./README.md).

## TL;DR

`agent-ask-anywhere` é um **gerador de Agent Skills** com **lobby
WebSocket auto-spawn**. Monorepo pnpm em **TypeScript estrito** com três
packages:

| Package | Papel | Runtime |
|---|---|---|
| `packages/shared` | Schemas Zod (`WSMessage`, `Flow`, `SkillFrontmatter`, slots) | Browser + Node |
| `packages/lobby` | Lobby Node mínima (HTTP + WS no :7878), zip generator, fs persistence | Node 20+ |
| `packages/extension` | Extensão Chrome MV3 via WXT (background, offscreen, content, popup, options/wizard) | Chrome 116+ |

A extensão grava skills via UI (recorder + wizard de slots), persiste no
disco via lobby, e cada skill é exportada como zip plug-and-play com `run.js`
+ `lobby-bootstrap.js` (zero deps de npm). Replay é **determinístico**:
synthetic events com fallback CDP. Slots são plain-text passados pelo
agente de código que invoca a skill.

## Arquitetura em 30s

```
┌────────────────────────────────────────────────┐
│              Lobby (Node :7878)                │
│   HTTP + WS no mesmo listener                  │
│   ─ POST /run     ← skill cliente              │
│   ─ POST /skills/zip ← wizard (extensão)       │
│   ─ GET  /health  ← bootstrap                  │
│   ─ WS /ws        ← extensão (full duplex)     │
└─────────────┬───────────────────┬──────────────┘
              │ WS                │ HTTP
   ┌──────────▼─────────┐   ┌─────▼─────────────┐
   │  Chrome extension  │   │  Skill clients    │
   │  (offscreen + bg)  │   │  (run.js)         │
   └────────────────────┘   └───────────────────┘
```

- **Lobby** auto-spawn detached pela 1ª skill (`lobby-bootstrap.js` no zip).
- **Extensão** sempre conectada via WS no offscreen (MV3-safe).
- **Skills** falam HTTP-only (POST /run); lobby faz multiplex via `runId`.

## Comandos

```bash
pnpm install         # bootstrap (postinstall gera ícones via sharp)
pnpm typecheck       # tsc --noEmit em todos os packages
pnpm lint            # biome check
pnpm test            # node:test via tsx em shared/lobby
pnpm build           # build de tudo
pnpm dev:lobby       # roda a lobby (HTTP+WS :7878)
pnpm dev:extension   # WXT dev mode
```

## Layout

```
agent-ask-anywhere/
├── packages/
│   ├── shared/src/    flow-schema.ts, skill-schema.ts, messages.ts, slots.ts
│   ├── lobby/src/     index.ts, ws.ts, http-routes.ts, run-broker.ts, lockfile.ts
│   │   └── skills/    manager.ts, recording-buffer.ts, export-import.ts, template.ts
│   └── extension/
│       ├── entrypoints/  background.ts, content.ts, offscreen/, popup/, options/ (wizard)
│       └── lib/
│           ├── messaging.ts                              (Zod ExtMessage envelope)
│           ├── recorder/  recorder.ts, overlay.ts, selectors.ts, xpath.ts
│           ├── replay/    runner.ts, synthetic.ts, cdp.ts, captcha.ts, captcha-watch.ts, force-open-shadow.ts
│           └── page/      ax-tree.ts                    (textual AX tree)
└── README.md
```

## Invariantes que NÃO se quebram

1. **Zod nas bordas.** Toda mensagem WebSocket, todo body de REST, todo
   frontmatter de SKILL.md, todo flow.json passa por `safeParse` antes de
   ser usado.

2. **`runId` é obrigatório** em `flow:run`, `flow:result`, `step:result` —
   é a chave de multiplex no `RunBroker` da lobby.

3. **Selector chain do recorder filtra IDs/classes voláteis** (regex em
   `selectors.ts`: `^(ember-|react-|mui-|radix-|chakra-|css-|tw-|emotion-|sc-|jss)`).

4. **Import de `.skill` valida zip-slip** (`export-import.ts`): cada entry é
   resolvida com `path.resolve` e comparada via prefix com `safeRoot`.

5. **`syntheticRunner` (`replay/synthetic.ts`) é self-contained** — injetado
   via `chrome.scripting.executeScript({world:'MAIN'})`. **Sem closures, sem
   imports não inline.**

6. **`FlowSchema` exige selectors com pelo menos um chain de pelo menos um
   selector** — exceto em `press` e `scroll` (com x/y).

7. **Manifest `key` (`.extension-key.txt`) é uma chave RSA pública** —
   commitada de propósito para CRX-ID estável.

8. **Conexão Node↔Extensão = WebSocket localhost via offscreen document.**
   Service worker MV3 morre; o offscreen mantém o JS vivo. Heartbeat 20s,
   exponential backoff de reconnect (1s → 30s).

9. **Replay tem dois modos coexistindo:** synthetic (default, rápido) e CDP
   via `chrome.debugger` (fallback automático para "element not found", ou
   forçado via `step.useCDP: true`).

10. **Lock-file da lobby** (`lockfile.ts`): `O_EXCL` no spawn evita
    duplicação; check de `process.kill(pid, 0)` para detectar lobbies
    órfãs e remover lock antigo.

11. **Skill zips têm zero deps de npm.** `run.js` e `lobby-bootstrap.js` só
    usam `node:http`, `node:fs`, `node:child_process`, `node:os`, `node:path`.

## Convenções de código

- **TypeScript estrito** (`noUncheckedIndexedAccess`, `noImplicitOverride`,
  `verbatimModuleSyntax`). Imports relativos com `.js`.
- **Biome** (não Prettier nem ESLint). Aspas simples, semicolons, trailing
  comma `all`, line width 100.
- **Sem `any` implícito.**
- **Logs via `pino`** (lobby) ou `console.log('[aaa/<area>]', ...)` (extensão).

## Onde mexer com cuidado

| Arquivo | Risco | Por quê |
|---|---|---|
| `lobby/src/skills/export-import.ts` | 🔴 alto | Zip-slip = RCE. |
| `lobby/src/skills/template.ts` | 🟡 médio | `run.js`/`lobby-bootstrap.js` são strings literais; teste após editar. |
| `lobby/src/lockfile.ts` | 🟡 médio | Race em spawn pode causar duplicate lobbies. |
| `extension/lib/replay/synthetic.ts` | 🟡 médio | Função serializada; closure quebra silenciosamente. |
| `extension/lib/replay/cdp.ts` | 🟡 médio | Banner amarelo "está debugando" inevitável. |
| `force-open-shadow.js` | 🟡 médio | Monkey patch frágil. |

## Como adicionar um novo step type

1. Adicione `z.object({ type: z.literal('foo'), ... ...BaseStep })` em
   `packages/shared/src/flow-schema.ts`.
2. Trate o caso em `packages/extension/lib/replay/synthetic.ts:act`.
3. Trate em `packages/extension/lib/replay/cdp.ts:executeViaCdp`.
4. Se tem string com slots (URL, value), adicione em
   `packages/shared/src/slots.ts:fillStep`.
5. Teste em `packages/shared/test/flow-schema.test.ts`.

## Como adicionar um novo tipo de slot

1. Adicione no enum `SlotTypeSchema` em
   `packages/shared/src/skill-schema.ts`.
2. Adicione testes em `packages/shared/test/skill-schema.test.ts`.

## Variáveis de ambiente

| Var | Default | Uso |
|---|---|---|
| `AAA_LOBBY_HOST` | `127.0.0.1` | Host da lobby |
| `AAA_LOBBY_PORT` | `7878` | Porta única (HTTP+WS) |
| `AAA_SKILLS_ROOT` | `~/.local/share/agent-ask-anywhere/skills` | Onde skills moram |
| `AAA_LOBBY_LOCK` | `~/.local/share/agent-ask-anywhere/lobby.lock` | Lock-file |
| `AAA_LOBBY_BIN` | — | Path absoluto p/ binário da lobby (skills usam) |
| `LOG_LEVEL` | `info` | pino |

## Don'ts

- ❌ Não adicione um step que faça `eval(userInput)` — `waitForExpression`
  já é o limite.
- ❌ Não use `path.join` para validar entries do zip; use `path.resolve` +
  startsWith do safeRoot com separador.
- ❌ Não introduza state do recorder fora de `recorder.ts`.
- ❌ Não adicione deps de npm ao zip da skill — `run.js` precisa rodar com
  só Node stdlib.
- ❌ Não bloqueie a thread do main da lobby; chamadas devem ser async.

## Do's

- ✅ Quando for editar `messages.ts`, atualize **ambos** os lados (lobby e
  extensão) na mesma PR.
- ✅ Para qualquer regex de validação que o usuário pode disparar, escreva
  um teste positivo + negativo.
- ✅ Use `runId` em todo `step:result`/`flow:result` — `RunBroker` agrupa
  por `runId` para permitir runs concorrentes.

## Memória rápida ("se eu esquecer só uma coisa…")

> **Tudo que cruza fronteira passa por Zod. `runId` é a chave de multiplex.
> Imports com `.js`. `synthetic.ts` é uma função sem closures. Skills zip
> não têm deps de npm.**
