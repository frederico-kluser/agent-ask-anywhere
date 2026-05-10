# AGENTS.md — guia para agentes LLM

Briefing curto para Claude Code, Cursor, Copilot, Codex, Gemini ou qualquer
agente de codificação trabalhando neste repositório. Para humanos: comece
pelo [`README.md`](./README.md). Para profundidade técnica:
[`docs/TECHNICAL.md`](./docs/TECHNICAL.md).

## TL;DR

`agent-ask-anywhere` é uma plataforma de browser automation híbrida
(determinístico + LLM). Monorepo pnpm em **TypeScript estrito** com três
packages:

| Package | Papel | Runtime |
|---|---|---|
| `packages/shared` | Schemas Zod compartilhados (`WSMessage`, `Flow`, `SkillFrontmatter`, slots) | Browser + Node |
| `packages/server` | Fastify (REST :7860) + WebSocket (:8765) + LLM orchestrator + skills manager | Node 20+ |
| `packages/extension` | Extensão Chrome MV3 via WXT (background, offscreen, content, popup, options) | Chrome 116+ |

A extensão grava skills via UI, persiste no servidor, e replay é
determinístico (`synthetic` events, fallback `CDP`) com fallback agentic (LLM
com tool calling) quando passos falham.

## Comandos

Sempre rode na raiz:

```bash
pnpm install         # bootstrap (postinstall gera ícones via sharp)
pnpm typecheck       # tsc --noEmit em todos os packages (precisa passar)
pnpm lint            # biome check (precisa passar)
pnpm test            # node:test via tsx em shared/server
pnpm build           # build de tudo
pnpm dev:server      # roda servidor (precisa de ANTHROPIC_API_KEY p/ /chat)
pnpm dev:extension   # WXT dev mode
```

## Layout

```
agent-ask-anywhere/
├── packages/
│   ├── shared/src/    flow-schema.ts, skill-schema.ts, messages.ts, slots.ts
│   ├── server/src/    index.ts, ws.ts, secrets.ts
│   │   ├── chat/      routes.ts                       (POST /chat → orchestrator)
│   │   ├── llm/       provider.ts, anthropic.ts, tools.ts, orchestrator.ts, extension-rpc.ts
│   │   └── skills/    manager.ts, routes.ts, recording-buffer.ts, run-history.ts, export-import.ts
│   └── extension/
│       ├── entrypoints/  background.ts, content.ts, offscreen/, popup/, options/
│       └── lib/
│           ├── messaging.ts                              (Zod ExtMessage envelope)
│           ├── recorder/  recorder.ts, overlay.ts, selectors.ts, xpath.ts
│           ├── replay/    runner.ts, synthetic.ts, cdp.ts, captcha.ts, captcha-watch.ts, force-open-shadow.ts
│           └── page/      ax-tree.ts                    (textual AX tree p/ LLM)
├── docs/TECHNICAL.md
├── AGENTS.md (este arquivo)
└── README.md
```

## Invariantes que NÃO se quebram

1. **Zod nas bordas.** Toda mensagem WebSocket, todo body de REST, todo
   frontmatter de SKILL.md, todo flow.json passa por `safeParse` antes de
   ser usado. Não confie em `unknown` chegando do mundo externo.

2. **Slot `secret` é resolvido em `secrets.ts → resolveSecrets`** (server-side).
   O LLM **nunca** recebe o valor; ele aparece apenas no `slots` que vai para
   a extensão via `flow:run`. Qualquer mudança no orchestrator que vaze
   secret no `tool_use.input` ou `tool_result` é uma regressão de segurança.

3. **Selector chain do recorder filtra IDs/classes voláteis** (regex em
   `selectors.ts`: `^(ember-|react-|mui-|radix-|chakra-|css-|tw-|emotion-|sc-|jss)`).
   Adicione novos prefixos quando descobrir mais frameworks; nunca relaxe a
   filtragem.

4. **Import de `.skill` valida zip-slip** (`export-import.ts`): cada entry é
   resolvida com `path.resolve` e comparada via prefix com `safeRoot` (skills
   root + `path.sep`). Não substitua essa lógica por uma regex.

5. **`syntheticRunner` (`replay/synthetic.ts`) é self-contained** — injetado
   via `chrome.scripting.executeScript({world:'MAIN'})`, que serializa via
   `Function.prototype.toString`. **Sem closures, sem imports não inline.**
   Quem editar essa função tem que verificar que o output continua
   self-contained.

6. **`FlowSchema` exige selectors com pelo menos um chain de pelo menos um
   selector** — exceto em `press` (sem selector = usa `document.activeElement`)
   e `scroll` (com x/y).

7. **Manifest `key` (`.extension-key.txt`) é uma chave RSA pública** —
   commitada de propósito para CRX-ID estável. Não remova.

8. **Conexão Node↔Extensão = WebSocket localhost via offscreen document.**
   Service worker MV3 morre; o offscreen mantém o JS vivo. Heartbeat 20s,
   exponential backoff de reconnect (1s → 30s).

9. **Replay tem dois modos coexistindo:** synthetic (default, rápido) e CDP
   via `chrome.debugger` (fallback automático para "element not found", ou
   forçado via `step.useCDP: true`). Mantenha os dois.

## Convenções de código

- **TypeScript estrito** (`noUncheckedIndexedAccess`, `noImplicitOverride`,
  `verbatimModuleSyntax`). Imports relativos com `.js` mesmo apontando para
  `.ts` — exigência do `verbatimModuleSyntax`.
- **Biome** (não Prettier nem ESLint). Aspas simples, semicolons, trailing
  comma `all`, line width 100.
- **Sem `any` implícito.** `noExplicitAny` está em `warn`, mas evite mesmo
  assim.
- **Sem dependências nativas novas** sem discussão (`keytar`, `node-pty`,
  `better-sqlite3`). Trade-off de portabilidade ja foi pago em `secrets.json`.
- **Logs via `pino`** (server) ou `console.log('[aaa/<area>]', ...)`
  (extensão).

## Onde mexer com cuidado

| Arquivo | Risco | Por quê |
|---|---|---|
| `secrets.ts` | 🔴 alto | Vazamento de secret = breach. Tem `chmod 0600` defensivo. |
| `export-import.ts` | 🔴 alto | Zip-slip = RCE arbitrário fora de `~/.local/agent-skills`. |
| `synthetic.ts` | 🟡 médio | Função serializada; closure quebra silenciosamente. |
| `cdp.ts` | 🟡 médio | Banner amarelo "está debugando" inevitável; comportamento sensível a versão do Chrome. |
| `force-open-shadow.js` | 🟡 médio | Monkey patch frágil; sites com fingerprinting podem detectar. |
| `manager.ts:gitCommit` | 🟢 baixo | `execSync` com mensagem JSON-quoted; não passe input do usuário sem escape. |

## Como adicionar um novo step type

1. Adicione um `z.object({ type: z.literal('foo'), ... ...BaseStep })` no
   `packages/shared/src/flow-schema.ts`.
2. Trate o caso em `packages/extension/lib/replay/synthetic.ts:act` (se
   aplicável).
3. Trate o caso em `packages/extension/lib/replay/cdp.ts:executeViaCdp`.
4. Se o step tem string com slots (URL, value), adicione em
   `packages/shared/src/slots.ts:fillStep`.
5. Adicione um teste em `packages/shared/test/flow-schema.test.ts`.
6. Atualize `docs/TECHNICAL.md` (tabela de step types).

## Como adicionar um novo tipo de slot

1. Adicione no enum `SlotTypeSchema` em
   `packages/shared/src/skill-schema.ts`.
2. Se a resolução é server-side, trate em `packages/server/src/secrets.ts`
   ou crie um análogo (ex: `dynamic` poderia chamar JS no servidor).
3. Atualize prompt no `orchestrator.ts:SYSTEM_PROMPT_BASE` se o LLM precisa
   saber lidar com ele.
4. Adicione testes em `packages/shared/test/skill-schema.test.ts`.

## Como rodar localmente sem ANTHROPIC_API_KEY

Tudo continua funcionando. `/chat` responde 503. Use a extensão para gravar
e replay manual via `POST /skills/:name` ou via WS `flow:run`.

## Variáveis de ambiente

| Var | Default | Uso |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Habilita `/chat` |
| `AAA_LLM_MODEL` | `claude-sonnet-4-5` | Override do modelo |
| `AAA_SKILLS_ROOT` | `~/.local/agent-skills` | Onde skills moram (útil em testes) |
| `AAA_SECRETS_FILE` | `~/.config/agent-ask-anywhere/secrets.json` | Keystore (idem) |
| `HTTP_PORT` | `7860` | Fastify |
| `WS_PORT` | `8765` | WebSocket |
| `LOG_LEVEL` | `info` | pino |

## Don'ts

- ❌ Não adicione um step que faça `eval(userInput)` — `waitForExpression`
  já é o limite, e só roda em CDP quando a CSP bloqueia `unsafe-eval`.
- ❌ Não logue `slots` no servidor (pode conter secret); só `Object.keys(slots)`.
- ❌ Não use `path.join` para validar entries do zip; use `path.resolve` +
  startsWith do safeRoot com separador.
- ❌ Não chame `git config --global` em lugar nenhum — o `manager.ts` usa
  `git -c user.name=... -c user.email=...` por commit, sem alterar config
  do usuário.
- ❌ Não introduza state do recorder fora de `recorder.ts` — typing buffer,
  flush, special keys ficam todos lá.

## Do's

- ✅ Quando for editar `messages.ts`, atualize **ambos** os lados (server e
  extensão) na mesma PR.
- ✅ Para qualquer regex de validação que o usuário pode disparar, escreva
  um teste positivo + negativo.
- ✅ Use `runId` em todo `step:result` e `flow:result` — `extension-rpc.ts`
  agrupa por `runId` para permitir runs concorrentes.
- ✅ Em `synthetic.ts`, ao adicionar um step type, lembre que **não há
  acesso a closures** — funções helper têm que estar dentro do
  `syntheticRunner`.

## Memória rápida ("se eu esquecer só uma coisa…")

> **Tudo que cruza fronteira passa por Zod. Slot `secret` nunca toca o LLM.
> Imports com `.js`. `synthetic.ts` é uma função sem closures.**
