# ModelFoundry

ModelFoundry is Axiom-Labs' OpenAI-compatible optional model router, dashboard, and comparison layer for OpenClaw, OpenCode, and adjacent local AI workflows.
It combines benchmark-informed model quality with live provider health, then routes requests through a single local endpoint without forcing you to replace your primary paid model stack.

<div align="center">
  <img src="docs/assets/dashboard.png" alt="ModelFoundry Dashboard" width="100%">
</div>

## Why it exists

- **One local endpoint** for many providers
- **OpenAI-compatible API** for existing tools and scripts
- **Automatic routing** based on quality + latency + uptime
- **Live dashboard and comparison layer** for informed model decisions
- **Optional provider lane** for OpenClaw and OpenCode instead of a hard stack replacement

## Product position

ModelFoundry is best treated as:

- an **optional provider lane**
- a **router**
- a **dashboard**
- a **comparison layer**

It is not meant to replace your main paid stack by default.

## Quick start

### Install with npm

```bash
npm install -g model-foundry
model-foundry
```

Then open:

- Dashboard: `http://localhost:7352/`
- API base URL: `http://127.0.0.1:7352/v1`
- API key: any string
- Default routed model: `auto-fastest`

### Run with Docker

```bash
mkdir model-foundry
cd model-foundry
curl -fsSL -o Dockerfile https://raw.githubusercontent.com/Codename-11/model-foundry/master/Dockerfile
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/Codename-11/model-foundry/master/docker-compose.yml

docker compose up -d --build
```

## Core CLI

```bash
model-foundry [--port <number>] [--log] [--ban <model1,model2>]
model-foundry onboard [--port <number>]
model-foundry install --autostart
model-foundry start --autostart
model-foundry uninstall --autostart
model-foundry status --autostart
model-foundry update
model-foundry refresh-scores
model-foundry autoupdate [--enable|--disable|--status] [--interval <hours>]
model-foundry config export
model-foundry config import <token>
```

Legacy binary alias:

```bash
modelrelay
```

## Integrations

Run onboarding for guided setup:

```bash
model-foundry onboard
```

The quick-start path now recommends `OpenRouter` as the default first provider, with `Groq` as the fast single-provider option and `OpenAI-Compatible` as the bring-your-own-upstream path.

Manual docs:

- [OpenClaw integration](docs/integrations/openclaw.md)
- [OpenCode integration](docs/integrations/opencode.md)
- [Frontier provider catalog](docs/integrations/frontier.md)

## Docs

- [Documentation index](docs/README.md)
- [Architecture overview](docs/architecture/overview.md)
- [Routing, scoring, and evaluation](docs/architecture/routing-and-scoring.md)
- [Configuration and operations](docs/reference/configuration.md)
- [CLI reference](docs/reference/cli.md)
- [Roadmap](docs/project/roadmap.md)
- [Code Arena score reference](docs/reference/code-arena-scores.md)

## OpenAI-compatible endpoints

### `POST /v1/chat/completions`

Use `model: "auto-fastest"` to let the router choose the current best backend.
You can also target grouped model IDs such as `minimax-m2.5`, `kimi-k2.5`, or `glm4.7` and let ModelFoundry choose the best provider for that model family.

### `GET /v1/models`

Returns the router-exposed model list, including grouped slugs and `auto-fastest`.

## Config basics

- Canonical config path: `~/.model-foundry.json`
- Legacy compatibility mirror: `~/.modelrelay.json`
- Request logging is off by default; enable with `--log`
- Config transfer is supported with `model-foundry config export` / `import`

Supported API key env vars include:

- `NVIDIA_API_KEY`
- `GROQ_API_KEY`
- `CEREBRAS_API_KEY`
- `OPENROUTER_API_KEY`
- `OPENCODE_API_KEY`
- `OPENAI_COMPATIBLE_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `CODESTRAL_API_KEY`
- `SCALEWAY_API_KEY`
- `QWEN_CODE_API_KEY` or `DASHSCOPE_API_KEY`
- `KILOCODE_API_KEY`
- `GOOGLE_API_KEY`

The frontend can also use the shared frontier catalog endpoint:

- `GET /api/provider-meta`

## Development

Install deps:

```bash
npm install
```

Run the backend and Vite frontend together:

```bash
npm run dev
```

That gives you:

- Vite frontend: `http://localhost:5173/`
- Router/backend API: `http://127.0.0.1:7352/`

Build the production frontend bundle:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Production/server mode serves the built `dist/` app automatically when it exists.

## Project

- GitHub: https://github.com/Codename-11/model-foundry
- Organization: Axiom-Labs
