![banner](./banner.png)

# agent-ask-anywhere

**Skill generator** com **lobby WebSocket auto-spawn**. Grave um fluxo
clicando na página, edite no wizard, baixe um `.skill` (zip plug-and-play).
Qualquer agente de código (Claude Code, Cursor, Codex, etc.) pode rodar a
skill com `node run.js` — a primeira chamada acorda a lobby local
automaticamente; chamadas seguintes são instantâneas.

> **Status:** v1.0 — refatoração para arquitetura "skill generator" feita.
> Veja [`AGENTS.md`](./AGENTS.md) se você for um agente LLM trabalhando no
> repo, e [`REFACTOR_REPORT.md`](./REFACTOR_REPORT.md) para o que mudou
> nesta versão.

---

## Arquitetura em 30s

```
┌────────────────────────────────────────────────┐
│              Lobby (Node :7878)                │
│   HTTP + WS no mesmo listener                  │
│   ─ POST /run     ← skill cliente              │
│   ─ POST /skills/zip ← wizard (extensão)       │
│   ─ GET  /health  ← bootstrap                  │
└─────────────┬───────────────────┬──────────────┘
              │ WS (full duplex)  │ HTTP
   ┌──────────▼─────────┐   ┌─────▼─────────────┐
   │  Chrome extension  │   │  Skill clients    │
   │  (offscreen + bg)  │   │  (run.js)         │
   └────────────────────┘   └───────────────────┘
```

- A **lobby** é um processo Node mínimo. Auto-spawn detached na primeira
  chamada de qualquer skill (via `lobby-bootstrap.js` no zip).
- A **extensão** mantém um WebSocket aberto com a lobby (offscreen
  document, MV3-safe) e executa fluxos com synthetic events / CDP.
- Cada **skill** é um zip `.skill` plug-and-play com `run.js`,
  `flow.json`, `SKILL.md`, `lobby-bootstrap.js`, `meta.json`,
  `package.json`, `INSTALL.md` — sem `npm install`.

Multiplexação por `runId`: várias skills podem rodar concorrentemente
porque cada `flow:run`/`flow:result` carrega o mesmo `runId`.

---

## Como começar

### Requisitos

- **Node.js 20+** (use o `.nvmrc`: `nvm use`)
- **pnpm 11+** (`corepack enable && corepack prepare pnpm@11.0.9 --activate`)
- **Chrome 116+** (precisa de `chrome.offscreen`)

### Instalação

```bash
git clone <este-repo> agent-ask-anywhere
cd agent-ask-anywhere
pnpm install
```

### Rodando localmente (dev)

Abra **dois terminais**:

```bash
# terminal 1 — lobby (HTTP + WebSocket no :7878)
pnpm dev:lobby
```

```bash
# terminal 2 — extensão (WXT em modo dev)
pnpm dev:extension
```

Carregue a extensão no Chrome:

1. `chrome://extensions/` → ative **Developer mode**
2. **Load unpacked** → aponte para `packages/extension/.output/chrome-mv3/`
3. Quando o popup mostrar **"Connected to lobby :7878"**, está pronto.

---

## Usando

### 1. Gravar uma skill

1. Clique no ícone da extensão → **● Start recording**
2. Faça o fluxo na página (clicks, typing, navegação são gravados)
3. **■ Stop recording** — um draft é salvo em
   `~/.local/share/agent-ask-anywhere/skills/draft-<timestamp>/`

### 2. Refinar e exportar via wizard

1. Abra **Options → Skill wizard** (link no popup)
2. Selecione o draft. O wizard sugere slots automaticamente para cada
   `type`-step com valor literal — você pode renomeá-los, alterar tipo
   (`string` / `choice` / `dynamic`), marcar/desmarcar required, ou
   adicionar/remover.
3. Edite nome (kebab-case), descrição, `SKILL.md` body.
4. **Generate .skill (download)** — emite um zip plug-and-play.
   **Save draft** salva no fs sem baixar.

### 3. Rodar a skill via agente de código

Distribua o zip; descompacte; execute:

```bash
node my-skill/run.js '{"recipient":"joao","message":"hello"}'
```

Na primeira chamada o `lobby-bootstrap.js` checa `:7878/health`. Se a
lobby não estiver de pé, ele tenta spawnar via `AAA_LOBBY_BIN` ou
`~/.local/bin/aaa-lobby`. Veja `INSTALL.md` no zip para detalhes.

---

## Variáveis de ambiente

| Var | Default | Uso |
|---|---|---|
| `AAA_LOBBY_HOST` | `127.0.0.1` | Host da lobby |
| `AAA_LOBBY_PORT` | `7878` | Porta única (HTTP+WS) |
| `AAA_SKILLS_ROOT` | `~/.local/share/agent-ask-anywhere/skills` | Onde drafts/skills moram |
| `AAA_LOBBY_LOCK` | `~/.local/share/agent-ask-anywhere/lobby.lock` | Lock-file para spawn race |
| `AAA_LOBBY_BIN` | — | Caminho absoluto para o binário da lobby (skills usam) |
| `AAA_RUN_TIMEOUT_MS` | `300000` | Timeout por run (5min) |
| `LOG_LEVEL` | `info` | pino |

---

## Resolução de problemas

| Problema | Causa provável | O que fazer |
|---|---|---|
| Popup "Disconnected" | Lobby não rodando | `pnpm dev:lobby` (ou skill auto-spawna na 1ª chamada) |
| `run.js` exit 3 | Lobby binário não encontrado | Defina `AAA_LOBBY_BIN` ou copie a lobby pra `~/.local/bin/aaa-lobby` |
| `run.js` exit 4 com 503 | Lobby up mas extensão desconectada | Recarregue a extensão; cheque popup |
| Lock-file órfão depois de `kill -9` | SIGKILL não roda exit-handler | Próxima skill detecta via `process.kill(pid,0)` e remove |
| Captcha bloqueando | Heurística pausou o fluxo | Resolva manualmente, replay retoma (timeout 5min) |

---

## Comandos

```bash
pnpm install
pnpm dev:lobby       # roda a lobby (HTTP+WS :7878)
pnpm dev:extension   # WXT dev mode
pnpm typecheck       # tsc --noEmit em todos os packages
pnpm lint            # biome check
pnpm test            # node:test em shared/lobby
pnpm build           # build de tudo
```

---

## Licença

[MIT](./LICENSE) — use, modifique, redistribua. Apenas mantenha o aviso de
copyright.
