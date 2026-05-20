# ModelFoundry — Dev Log

## 2026-05-19 — Explicit telemetry onboarding and dark-mode sweep

### Summary

Completed a second UI pass focused on making ModelFoundry feel intentionally empty on first run instead of auto-populating live/default model telemetry. Blank installs now start with zero telemetry rows until a provider is explicitly configured or enabled; configured discovery providers such as Hermes Proxy still populate dynamically from their upstream catalogs.

### What changed

- Reworked server telemetry seeding so static model rows are only added for explicitly configured providers.
- Preserved discovery-driven provider behavior for Hermes Proxy/OpenAI-compatible endpoints, OpenRouter, KiloCode, OpenCode, and Ollama.
- Updated Live Telemetry copy from "tracked/disabled" toward "configured inventory" and explicit provider activation.
- Extended dark-mode coverage for drawers, provider quickstart cards, request-log payload panels, catalog/profile chips, auto-update status pills, and inline-generated controls.
- Fixed the slide-over drawer mobile leak by using transform-based off-canvas positioning with hidden inactive state.
- Tightened mobile telemetry controls so search/filter/header controls remain inside the viewport while the dense table scrolls horizontally.

### Verification

- Blank-install smoke (`HOME=/tmp/modelfoundry-blank-home`, provider env cleared) → `/api/models` returned 0 rows.
- Configured Hermes Proxy smoke on dev port 7353 → 17 discovered rows from `openai-compatible:hermes-proxy`.
- Playwright dark-mode audit over telemetry, filters, tracked/configured rows, drawer, catalog, chat, logs, settings overview/providers/open/frontier/routing/advanced, setup, and mobile widths → 0 light-background candidates.
- `pnpm test` → 218 passed.
- `pnpm build` → passed.
- `git diff --check` → passed.

## 2026-05-19 — Dark-mode completion audit

### Summary

Ran a Playwright dark-mode audit across the primary ModelFoundry app surfaces and closed remaining light-theme holdouts in shared UI surfaces, settings cards, catalog controls, chat controls, logs toggles, and inline-style fallbacks.

### What changed

- Added dark surface/control tokens to `src/styles.css`.
- Added a final dark-mode completion pass covering catalog, telemetry, chat, logs, settings, frontier/open provider cards, and inline-generated controls.
- Normalized lingering white inputs, textareas, pills, switches, table headers, help cards, and provider cards to the dark token stack.

### Verification

- Playwright audit over models, catalog, chat, logs, settings overview/providers/open/frontier/routing/advanced, and setup → 0 light-background candidates.
- Visual spot-check screenshots for telemetry, chat, and settings/open views after the fix.
- `npm test` → 218 passed.
- `npm run build` → passed.
- `git diff --check` → passed.

## 2026-05-19 — Use LAN Hermes Proxy URL and rediscover GPT-5.5

### Summary

Switched the Docker-Server deployment away from Docker's `host.docker.internal` alias for Hermes Proxy and onto the stable LAN endpoint `http://172.16.24.250:8648/v1`. The missing `gpt-5.5` model was traced to Hermes Proxy's routed adapter advertising a stale synthetic model list, not to ModelFoundry discovery.

### What changed

- Updated source deployment defaults in `deploy/docker-compose.yml` and `deploy/.env.example`.
- Updated live stack config in `~/docker/modelfoundry/docker-compose.yml`, `~/docker/modelfoundry/.env`, and the persisted ModelFoundry config mirrors under `~/docker/modelfoundry/config/`.
- Updated Hermes Proxy integration/deployment docs to use the LAN upstream URL.
- Updated system/project references in `~/SYSTEM.md` and Obsidian.
- Patched Hermes Proxy separately so its `/v1/models` routed adapter includes `gpt-5.5` from the Codex catalog.

### Verification

- `npm test` → 218 passed.
- Restarted `hermes-proxy.service`; `/v1/models` on `http://172.16.24.250:8648` now advertises 17 text/chat models from authenticated Hermes Proxy adapters, including `gpt-5.5`.
- Recreated `modelfoundry`; container env now has `MODELFOUNDRY_HERMES_PROXY_BASE_URL=http://172.16.24.250:8648/v1`.
- Refreshed `openai-compatible:hermes-proxy` in deployed ModelFoundry; discovery returned the current Hermes Proxy catalog including `gpt-5.5`.
- `/v1/models` through ModelFoundry includes `gpt-5.5`.
