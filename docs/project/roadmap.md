# Roadmap

This is a documentation roadmap, not a promise registry carved into stone.

## Current strengths

- OpenAI-compatible local routing
- dashboard for provider/model visibility
- benchmark-informed model quality scoring
- OpenClaw and OpenCode onboarding support
- config transfer and background service support

## Near-term docs/product clarity goals

### 1. Sharpen the product story

Keep clarifying that ModelFoundry is:

- a **router**
- a **dashboard**
- a **comparison layer**

And not a magical replacement for all model selection judgment.

### 2. Better routing transparency

Potential improvements:

- show routing rationale more explicitly in the UI
- expose why a provider/model lost a ranking decision
- make pinning and grouping behavior easier to understand at a glance

### 3. Benchmark maintenance workflow

Potential improvements:

- better provenance tracking for scores
- clearer docs around score freshness and sourcing
- a tighter workflow for newly discovered models missing verified scores

### 4. Integration hardening

Potential improvements:

- richer OpenClaw examples for optional routed lanes
- more presets for local AI toolchains using OpenAI-compatible clients
- clearer migration notes for older `modelrelay` installs

### 5. Operational polish

Potential improvements:

- stronger troubleshooting docs
- clearer update/autostart platform notes
- additional examples for Docker and LAN access workflows

## Longer-term ideas

- deeper provider-specific diagnostics
- richer exportable routing telemetry
- smarter UI surfacing for instability, throttling, and fallback behavior
- easier benchmarking/reference maintenance without stuffing the repo root with giant markdown blobs

That last one was not theoretical, to be fair.
