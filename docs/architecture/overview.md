# Architecture overview

ModelFoundry has two main jobs:

1. expose a local OpenAI-compatible router
2. maintain a dashboard + routing view across many free/open model providers

## High-level flow

```text
Client (OpenClaw / OpenCode / scripts)
  -> ModelFoundry local endpoint (/v1/chat/completions)
  -> provider/model selection
  -> upstream provider request
  -> normalized response back to client
```

At the same time, the dashboard process continuously tracks provider health and model quality signals so routing decisions are not blind.

## Main pieces

### CLI entrypoint

`bin/modelrelay.js`

Responsibilities:

- parse CLI args
- run onboarding/setup flows
- manage autostart and auto-update commands
- launch the server/router path
- expose config transfer and score refresh commands

### Router + dashboard server

`lib/server.js`

Responsibilities:

- serve the Web UI
- expose OpenAI-compatible endpoints
- discover dynamic provider model lists
- ping providers and track health
- compute routing candidates
- proxy requests and normalize failures/retries
- manage dashboard settings state and update UX

### Model catalog and benchmark inputs

- `sources.js` defines provider sources, model lists, aliases, and label cleanup
- `scores.js` stores benchmark-derived model intelligence scores
- `lib/score-fetcher.js` finds models that still need verified scores

### Routing and ranking logic

`lib/utils.js`

Responsibilities:

- latency averaging
- verdict/uptime calculations
- ranking eligible models
- model grouping/canonicalization helpers
- routing filters and selection helpers

### Config and setup

- `lib/config.js` handles canonical config storage and transfer tokens
- `lib/onboard.js` builds guided integration setup for OpenClaw and OpenCode
- `lib/autostart.js` manages login-time startup behavior across OSes
- `lib/update.js` handles npm update flows and service restart behavior
- `lib/qwencodeAuth.js` handles Qwen OAuth device flow support

## Runtime behavior

ModelFoundry keeps a blended view of:

- **quality**: benchmark-based intelligence score for a model family
- **speed**: recent ping/response latency
- **availability**: current up/down state and recent uptime
- **operator intent**: bans, pinning mode, provider enable/disable state, manual config

That means it is not just picking the fastest endpoint. It is trying to pick the best practical route for coding work right now.

## UI + API relationship

The dashboard and router are the same local service.

- the **UI** is for inspection, config, and manual control
- the **API** is for OpenAI-compatible client traffic

That shared process is why onboarding, config transfer, provider settings, pinning, and update state all show up in both operational docs and architecture docs.

## Compatibility notes

- canonical config lives at `~/.model-foundry.json`
- a legacy mirror is still written to `~/.modelrelay.json`
- legacy binary alias `modelrelay` still exists

So the project is evolving names without instantly breaking older setups. A little messy, but usefully messy.
