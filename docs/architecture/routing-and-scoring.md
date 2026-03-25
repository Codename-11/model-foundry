# Routing, scoring, and evaluation

This project routes by combining **benchmark quality** with **live provider health**.

## Core idea

The router should not answer one question only.

- "What is the smartest model?" is incomplete.
- "What is the fastest provider?" is also incomplete.

ModelFoundry combines both so `auto-fastest` behaves like "best practical coding route right now," not merely "lowest latency at any cost."

## Inputs used in routing

### 1. Intelligence score

Model quality is sourced from `scores.js` and resolved via canonical model IDs in `sources.js`.

The score is benchmark-derived and acts as the quality anchor for each model family.

### 2. Recent latency

`getAvg()` in `lib/utils.js` computes recent average latency from successful pings inside the active ping window.

This gives the router a current speed signal instead of assuming yesterday's fastest route is still today's fastest route.

### 3. Uptime / availability

`getUptime()` and related status helpers track whether a route is actually usable.

A model with a great benchmark score is still a bad route if the provider is flaking out or returning 429s all day.

### 4. Operator constraints

Config can further shape routing:

- banned models
- excluded providers
- provider enabled/disabled state
- pinning mode (`canonical` vs `exact`)
- explicit model selection instead of `auto-fastest`

## QoS model

Routing quality is computed through `computeQoSMap()` and friends in `lib/utils.js`.

In broad terms:

- benchmark quality is normalized relative to the model set
- current latency contributes a tie-breaker / responsiveness signal
- uptime reduces effective quality for unstable routes
- only eligible routes are considered

That means a high-score model with poor availability can lose to a slightly weaker model that is consistently up and fast.

## Model grouping

ModelFoundry groups equivalent or near-equivalent model IDs across providers.

Examples:

- the same model may appear under multiple providers
- suffixes like `:free` or provider-specific runtime suffixes are normalized
- alias cleanup keeps the UI and routing logic aligned

This enables grouped model IDs such as:

- `minimax-m2.5`
- `kimi-k2.5`
- `glm4.7`

When a grouped ID is requested, ModelFoundry picks the best current provider for that model group.

## `auto-fastest`

`auto-fastest` is the top-level router lane.

Instead of locking to one model family, it ranks all eligible candidates and picks the best route overall at request time.

That makes it useful for:

- OpenClaw optional model lanes
- OpenCode router provider setup
- local scripts that just want a sane default

## Failure and retry behavior

The server contains provider-specific auth and retry logic, including optional bearer-auth handling for some providers.

Practical effect:

- temporary provider failures do not immediately invalidate the whole router concept
- auth edge cases can be retried when the provider behavior warrants it
- a provider can degrade while the rest of the router remains usable

## Score maintenance

`scores.js` is the single source of truth for benchmark-derived scores.

`model-foundry refresh-scores` plus `lib/score-fetcher.js` help identify discovered models that still need verified scores.

Related reference material:

- [Code Arena score reference](../reference/code-arena-scores.md)

## Mental model

Think of ModelFoundry as:

- **benchmarks for prior belief**
- **pings for current reality**
- **config for operator intent**
- **routing logic for final choice**

Which is a much better system than picking whichever provider is yelling "fast" the loudest.
