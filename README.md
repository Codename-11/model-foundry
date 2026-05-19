# ModelFoundry

ModelFoundry is an OpenAI-compatible model gateway for consolidating many model backends behind one local endpoint. It started as a fork of ModelRelay, but is now moving as its own product direction: shared provider endpoint, routing policy, health telemetry, request logs, and optional Hermes Proxy access without baking Hermes or Axiom-specific assumptions into downstream apps.

> Provenance: ModelFoundry derives from [`ellipticmarketing/modelrelay`](https://github.com/ellipticmarketing/modelrelay). See [`ACKNOWLEDGEMENTS.md`](ACKNOWLEDGEMENTS.md). Upstream PRs are now treated as inspiration/cherry-pick candidates, not an automatic product track.

## What it is

- **OpenAI-compatible API**: expose `/v1/models` and `/v1/chat/completions` for tools that accept a standard OpenAI-style base URL.
- **Provider aggregation**: route across configured public providers, local providers, and arbitrary OpenAI-compatible upstreams.
- **Dynamic discovery**: custom OpenAI-compatible endpoints can be discovered via `/v1/models`.
- **Health-aware routing**: benchmark latency/availability and route `auto-fastest` to a currently healthy candidate.
- **Dashboard**: inspect live telemetry, providers, account status, request logs, settings, setup snippets, and chat testing.
- **Hermes Proxy preset**: add a local Hermes Proxy endpoint as a normal OpenAI-compatible upstream. This is optional UX sugar, not a bespoke Hermes-only transport.
- **Deployment-friendly**: Docker source build, inbound `/v1` API-key guardrails, and persistent config under `~/.model-foundry.json` with a legacy mirror at `~/.modelrelay.json`.

## Install from source

```bash
git clone https://github.com/Codename-11/model-foundry.git
cd model-foundry
npm install
npm start
```

Then open:

```text
http://localhost:7352/
```

Router endpoint:

```text
Base URL: http://127.0.0.1:7352/v1
API key: any string unless inbound API auth is configured
Model: auto-fastest
```

## CLI

Primary commands use `model-foundry`. `modelfoundry` and `modelrelay` remain compatibility aliases while older configs/scripts migrate.

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
model-foundry config set-keys <provider> <key1,key2,...>
model-foundry config add-key <provider> <key>
model-foundry config remove-key <provider> <key|index>
model-foundry config set-maxturns <provider> <number>
```

## Docker

This repository builds from source so local ModelFoundry changes are present in the container:

```bash
docker build -t model-foundry .
docker run --rm -p 7352:7352 \
  -v "$HOME/.model-foundry:/home/node" \
  model-foundry
```

A Docker-Server compose deployment lives outside this repo under `~/docker/modelfoundry/`.

## Hermes Proxy as a provider

If `hermes proxy` is running, add it from the dashboard or with onboarding. ModelFoundry stores it as a normal OpenAI-compatible endpoint named `openai-compatible:hermes-proxy`.

Defaults:

```text
Base URL: http://127.0.0.1:8645/v1
Model fallback: gpt-5.5
Discovery: on
Auth: bearer-style by default
```

Docker-Server sets `MODELFOUNDRY_HERMES_PROXY_BASE_URL` to the host-accessible Hermes Proxy route.

## OpenAI-compatible endpoint example

Any app/tool that accepts the standard triple can point here:

```json
{
  "baseUrl": "http://127.0.0.1:7352/v1",
  "apiKey": "local-key",
  "model": "auto-fastest"
}
```

For tools with provider/model namespaces, use a ModelFoundry provider name and the `auto-fastest` model, for example `model-foundry/auto-fastest`.

## Config and logs

- Canonical config: `~/.model-foundry.json`
- Legacy compatibility mirror: `~/.modelrelay.json`
- Request log file: `~/.modelrelay-logs.json` for now, retained for compatibility
- Inbound API auth env: `MODELFOUNDRY_INBOUND_API_KEYS`
- Hermes Proxy preset env: `MODELFOUNDRY_HERMES_PROXY_BASE_URL`
- Local update test envs still accept legacy `MODELRELAY_*` names until the updater compatibility window is removed.

## Development

```bash
npm test
npm run smoke:hermes-proxy
```

Before publishing or deployment changes, verify:

```bash
npm test
git diff --check
```

## Direction

ModelFoundry is becoming a lightweight central model gateway/router, not just a free-model scout. Heavier enterprise controls such as teams, billing, quotas, audit exports, and organization-level key governance may eventually belong here or in a compatible upstream gateway tier, but the immediate goal is a clean common endpoint for apps and agent tools.
