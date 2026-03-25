# 🚀 ModelFoundry

[![npm version](https://img.shields.io/npm/v/model-foundry?color=green&style=flat-square)](https://npmjs.com/package/model-foundry)
[![GitHub stars](https://img.shields.io/github/stars/Codename-11/model-foundry?style=flat-square)](https://github.com/Codename-11/model-foundry/stargazers)
[![Join Discord](https://img.shields.io/badge/Join_Discord-5865F2?style=flat-square&logo=discord)](https://discord.gg/AqX6Sawq5w)

[**Join our Discord**](https://discord.gg/AqX6Sawq5w) for discussions, feature requests, and community support.

<div align="center">
  <img src="docs/assets/dashboard.png" alt="ModelFoundry Dashboard" width="100%">
  <br/>
  <p><i>The smartest, fastest, and completely free local router for your AI coding needs.</i></p>
</div>

---

### 🔥 100% Free • Auto-Routing • 80+ Models • 11+ Providers • OpenAI-Compatible

**ModelFoundry** is an OpenAI-compatible local router that benchmarks free coding models across top providers and automatically forwards your requests to the best available model. For Axiom-Labs, it is positioned as an optional router/dashboard/comparison layer for OpenClaw and OpenCode rather than a core model replacement. 

### ✨ Why use ModelFoundry?

- 💸 **Completely Free:** Stop paying for API usage. We seamlessly provide access to robust free models.
- 🧠 **State-of-the-Art (SOTA) Models:** Out-of-the-box availability for top-tier models including **Kimi K2.5, Minimax M2.5, GLM 5, Deepseek V3.2**, and more.
- 🏢 **Reliable Providers:** We route requests securely through trusted, high-performance platforms like **NVIDIA, Groq, OpenRouter, OpenCode Zen, and Google**.
- ⚡ **Lightning Fast:** The built-in benchmark continually evaluates metrics to pick the fastest and most capable LLM for your request.
- 🔄 **OpenAI-Compatible:** A clean optional layer that works alongside your existing tools, scripts, and workflows.

## 🚀 Install via NPM

```bash
npm install -g model-foundry

# Start it
model-foundry
```

Once started, ModelFoundry is accessible at `http://localhost:7352/`.

Router endpoint:

- Base URL: `http://127.0.0.1:7352/v1`
- API key: any string
- Model: `auto-fastest` (router picks actual backend)

## 🚀 Install via Docker

### Prerequisites
- Docker Engine
- Docker Compose (the `docker compose` command)


```bash
mkdir model-foundry

cd model-foundry

curl -fsSL -o Dockerfile https://raw.githubusercontent.com/Codename-11/model-foundry/master/Dockerfile
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/Codename-11/model-foundry/master/docker-compose.yml

docker compose up -d --build
```

Once running, ModelFoundry is accessible at `http://localhost:7352/`.

## 🔌 Installing Integrations

Use `model-foundry onboard` to save provider keys and auto-configure integrations for OpenClaw or OpenCode.

```bash
model-foundry onboard
```

If you prefer manual setup, use the examples below.

## OpenCode Integration

`model-foundry onboard` can auto-configure OpenCode.

If you want manual setup, put this in `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "router": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "ModelFoundry",
      "options": {
        "baseURL": "http://127.0.0.1:7352/v1",
        "apiKey": "dummy-key"
      },
      "models": {
        "auto-fastest": {
          "name": "Auto Fastest"
        }
      }
    }
  },
  "model": "router/auto-fastest"
}
```

## OpenClaw Integration

`model-foundry onboard` can auto-configure OpenClaw.

If you want manual setup, merge this into `~/.openclaw/openclaw.json` and keep it as an optional provider/layer (not your mandatory default model) unless you explicitly want routing enabled by default:

```json
{
  "models": {
    "providers": {
      "modelfoundry": {
        "baseUrl": "http://127.0.0.1:7352/v1",
        "api": "openai-completions",
        "apiKey": "no-key",
        "models": [
          { "id": "auto-fastest", "name": "Auto Fastest" }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "openai/gpt-5.4"
      },
      "models": {
        "modelfoundry/auto-fastest": {}
      }
    }
  }
}
```

## CLI

```bash
model-foundry [--port <number>] [--log] [--ban <model1,model2>]
model-foundry onboard [--port <number>]
model-foundry install --autostart
model-foundry start --autostart
model-foundry uninstall --autostart
model-foundry status --autostart
model-foundry update
model-foundry autoupdate [--enable|--disable|--status] [--interval <hours>]
model-foundry autostart [--install|--start|--uninstall|--status]
model-foundry config export
model-foundry config import <token>

# legacy binary name remains available too:
modelrelay [--port <number>] [--log] [--ban <model1,model2>]
```

Request terminal logging is disabled by default. Use `--log` to enable it.

`model-foundry install --autostart` also triggers an immediate start attempt so you do not need a separate command after install.

During `model-foundry onboard`, you will also be prompted to enable auto-start on login.

`model-foundry update` upgrades the global npm package and, when autostart is configured, stops the background service first and starts it again after the update.

Auto-update is enabled by default. While the router is running, ModelFoundry checks npm periodically (default: every 24 hours) and applies updates automatically.

Use `model-foundry autoupdate --status` to inspect state, `model-foundry autoupdate --disable` to turn it off, and `model-foundry autoupdate --enable --interval 12` to re-enable with a custom interval.

Use `model-foundry config export` to print a transferable config token (base64url-encoded JSON), and `model-foundry config import <token>` to load it on another machine.
You can also import by stdin:

```bash
model-foundry config export | model-foundry config import
```

## Endpoints

### `/v1/chat/completions`

`POST /v1/chat/completions` is an OpenAI-compatible chat completions endpoint.

- Use `model: "auto-fastest"` to route to the best model overall
- Use a grouped model ID such as `minimax-m2.5`, `kimi-k2.5`, or `glm4.7` to route within that model group
- For grouped IDs, ModelFoundry selects the provider with the best current QoS for that group
- In the Web UI, pinned models can now use either `Canonical Group` mode (default, pins the same model across providers) or `Exact Provider Row` mode from `Settings`
- Streaming and non-streaming requests are both supported

### `/v1/models`

`GET /v1/models` returns the models exposed by the router.

- Model IDs are grouped slugs such as `minimax-m2.5`, `kimi-k2.5`, and `glm4.7`
- Each grouped ID can represent the same model across multiple providers
- When you select one of these IDs in `/v1/chat/completions`, ModelFoundry routes the request to the provider with the best current QoS for that model group
- `auto-fastest` is also exposed and routes to the best model overall

Example:

```json
{
  "object": "list",
  "data": [
    { "id": "auto-fastest", "object": "model", "owned_by": "router" },
    { "id": "minimax-m2.5", "object": "model", "owned_by": "relay" },
    { "id": "kimi-k2.5", "object": "model", "owned_by": "relay" },
    { "id": "glm4.7", "object": "model", "owned_by": "relay" }
  ]
}
```

## Config

- Router config file: `~/.modelrelay.json` (current compatibility path; rename only if you intentionally update the runtime code)
- API key env overrides:
  - `NVIDIA_API_KEY`
  - `GROQ_API_KEY`
  - `CEREBRAS_API_KEY`
  - `SAMBANOVA_API_KEY`
  - `OPENROUTER_API_KEY`
  - `OPENCODE_API_KEY`
  - `CODESTRAL_API_KEY`
  - `HYPERBOLIC_API_KEY`
  - `SCALEWAY_API_KEY`
  - `QWEN_CODE_API_KEY` (or `DASHSCOPE_API_KEY`)
  - `GOOGLE_API_KEY`

For `Qwen Code`, ModelFoundry supports both API keys and Qwen OAuth cached credentials (`~/.qwen/oauth_creds.json`).
If OAuth credentials exist, ModelFoundry will use them and refresh access tokens automatically.
You can also start OAuth directly from the Web UI Providers tab using `Login with Qwen Code`.

### Config migration (CLI + Web UI)

- In the Web UI, open `Settings` -> `Configuration Transfer` to export/copy/import a token.
- The token includes your full config (including API keys, provider toggles, pinning mode, bans, filter rules, and auto-update settings).
- Treat tokens as secrets. Anyone with the token can import your keys/settings.
- Alternative: copy the config file directly from `~/.modelrelay.json` to the other machine at the same path (`~/.modelrelay.json`).

## Troubleshooting

### Clicking the update button or running `model-foundry` won't perform an update

To trigger a manual npm update and restart the service, run:

```bash
npm i -g model-foundry@latest
model-foundry autostart --start
```

### Testing updates locally without publishing to npm

You can point the updater at a local tarball instead of the npm registry:

```bash
npm pack
MODELRELAY_UPDATE_TARBALL=./model-foundry-1.8.3.tgz pnpm start
```

If you want the Web UI to always show an update while testing, set a higher forced version:

```bash
MODELRELAY_FORCE_UPDATE_VERSION=9.9.9
```

If the tarball filename does not contain a semantic version, also set:

```bash
MODELRELAY_UPDATE_VERSION=1.8.3
```

When `MODELRELAY_UPDATE_TARBALL` is set, the Web UI update flow and `model-foundry update`
install from that tarball and bypass the normal Git checkout update block. This is for
local testing only. `MODELRELAY_FORCE_UPDATE_VERSION` only affects version detection; the
actual install still comes from the tarball path.

---

⭐️ If you find ModelFoundry useful, please consider [starring the repo](https://github.com/Codename-11/model-foundry)!
