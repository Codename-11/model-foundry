# ModelFoundry Revival Strategy

## Purpose

This branch revives the `Codename-11/model-foundry` fork on top of current upstream `ellipticmarketing/modelrelay` instead of merging the stale fork directly. The target is a lightweight, general OpenAI-compatible router/dashboard with an optional local Hermes Proxy preset.

## Baseline

- Local branch: `revive/hermes-proxy`
- Branch base: `upstream/master` at `081e9a8` (`Add verified scores for new free models`)
- Baseline package: `modelrelay@1.17.1`
- Baseline verification: `npm test -- --test-reporter=spec` passed with 178 tests.

## Fork Delta Triage

| Commit | Original purpose | Decision | Rationale |
|---|---|---|---|
| `d05e074` | Rebrand project as ModelFoundry | Keep partially | Preserve the fork identity in docs/UI notes, but avoid package/binary renames that increase npm and updater risk. |
| `b115c7a` | Add ModelFoundry compatibility and OpenClaw lane | Rebuild selectively | Current upstream already supports OpenClaw/OpenCode onboarding and has newer provider logic. Rebuild only local Hermes Proxy/OpenClaw compatibility that still adds value. |
| `0d9f999` | Move detailed guides into `docs/` | Keep as targeted docs only | Avoid wholesale README/docs churn while upstream docs are current. Add focused revival and Hermes Proxy integration docs instead. |
| `9b6e980` | Migrate dashboard to Vite | Defer | Upstream dashboard changed substantially and the current goal is endpoint/preset support, not frontend replatforming. Revive Vite only as a separate project if the dashboard becomes strategic. |

## Design Decision

Use upstream's existing `openai-compatible:<id>` multi-endpoint support and `/v1/models` discovery. Hermes Proxy is already OpenAI-compatible, so ModelFoundry does not need a Hermes-specific transport. The implementation should provide a preset that fills the same generic endpoint fields a user could enter manually:

```json
{
  "id": "hermes-proxy",
  "name": "Hermes Proxy",
  "baseUrl": "http://127.0.0.1:8645/v1",
  "modelId": "gpt-5.5",
  "apiKey": "unused",
  "enabled": true,
  "discoverModels": true
}
```

## Public/Private Boundary

- Public defaults remain generic and OpenAI-compatible.
- Hermes Proxy is an optional local preset, not a hard dependency.
- Do not add Axiom domains, private auth paths, account names, or deployment assumptions.
- Do not expose Hermes Proxy or ModelFoundry publicly in this pass.

## Validation Log

- Baseline upstream tests: `npm test -- --test-reporter=spec` — passed, 178 tests.
- Preset/config tests after implementation: `npm test -- --test-reporter=spec` — passed, 181 tests.
- Server/UI/onboarding tests after implementation: `npm test -- --test-reporter=spec` — passed, 182 tests.
- Smoke script/package tests: `npm test -- --test-reporter=spec` — passed, 183 tests.
- Syntax checks: `node --check lib/server.js`, `node --check lib/onboard.js`, and `node --check scripts/smoke-hermes-proxy.mjs` — passed.
- Local port check on Docker-Server:
  - `http://127.0.0.1:8645/health` returned `{"status":"ok","platform":"webhook"}`, but `http://127.0.0.1:8645/v1/models` returned HTTP 404. Port 8645 was therefore not the local Hermes Proxy model endpoint during validation.
  - `http://127.0.0.1:8648/health` returned Hermes OAuth Router health with authentication ready, and `http://127.0.0.1:8648/v1/models` returned 5 models.
- Smoke script without chat: `HERMES_PROXY_BASE_URL=http://127.0.0.1:8648/v1 node scripts/smoke-hermes-proxy.mjs` — passed; discovered `grok-4.3`, `grok-4.20-reasoning`, `gpt-5.4`, `gpt-5.4-mini`, and `gpt-5.3-codex`.
- Chat smoke with requested `gpt-5.5`: `HERMES_PROXY_BASE_URL=http://127.0.0.1:8648/v1 HERMES_PROXY_SMOKE_CHAT=1 HERMES_PROXY_SMOKE_MODEL=gpt-5.5 node scripts/smoke-hermes-proxy.mjs` — failed with HTTP 403 because the local proxy did not advertise `gpt-5.5` during validation.
- Chat smoke with discovered model: `HERMES_PROXY_BASE_URL=http://127.0.0.1:8648/v1 HERMES_PROXY_SMOKE_CHAT=1 HERMES_PROXY_SMOKE_MODEL=grok-4.3 node scripts/smoke-hermes-proxy.mjs` — passed with HTTP 200 and response `ok`.
- ModelFoundry local app/API smoke: started `node bin/modelrelay.js --port 17352 --no-log` with isolated `HOME=/tmp/model-foundry-smoke-home`; `POST /api/openai-compatible/endpoints/presets/hermes-proxy` returned success; `GET /api/config` showed `openai-compatible:hermes-proxy` with base URL `http://127.0.0.1:8645/v1`, model `gpt-5.5`, and discovery enabled. The temporary smoke server was stopped after validation.

## Branch Summary

Branch `revive/hermes-proxy` is based on upstream `ellipticmarketing/modelrelay/master` at `081e9a8`. It adds seven fork commits:

1. `40fb911` — document the upstream-based ModelFoundry revival strategy.
2. `2b39fa7` — add light ModelFoundry fork branding without package/binary renames.
3. `7920397` — add the Hermes Proxy endpoint preset helper and tests.
4. `cfc3f33` — expose the preset through server API, dashboard UI, and onboarding.
5. `6292e1e` — add the Hermes Proxy smoke script and integration docs.
6. `7a976c1` — record local Hermes Proxy integration validation.
7. final recommendation commit — add the deploy/no-deploy recommendation.

## Risks and Known Gaps

- The preset default remains `http://127.0.0.1:8645/v1` for generic local use, but Docker deployments can set `MODELFOUNDRY_HERMES_PROXY_BASE_URL`. Docker-Server's live Hermes OAuth Router was on `http://127.0.0.1:8648/v1` during validation. Port 8645 was a Hermes webhook/API service and returned 404 for `/v1/models`.
- Local Hermes Proxy advertised `grok-4.3`, `grok-4.20-reasoning`, `gpt-5.4`, `gpt-5.4-mini`, and `gpt-5.3-codex`; it did not advertise `gpt-5.5` during validation. Chat smoke passed with `grok-4.3` and failed with `gpt-5.5`/`gpt-5.4-mini` at HTTP 403.
- The Vite dashboard migration from the stale fork remains intentionally deferred.
- ModelFoundry/modelrelay remains a lightweight local router/dashboard. It does not provide the team/key/quota/cost governance expected from a production central gateway.

## Docker Deployment Decision

Deploy this branch as a localhost-only Docker service for internal Axiom testing. The Docker image now builds from the fork checkout instead of installing upstream `modelrelay` from npm, and the Docker-Server deployment wires the Hermes Proxy preset to `http://host.docker.internal:8648/v1`.

## Docker-Server Deployment Result

Deployment completed on 2026-05-19 from the fork primary branch `master`.

- Merge commit: `ac9ead3` (`Merge Hermes Proxy ModelFoundry revival`)
- Deployment hardening commit: `00b0015` (`Run ModelFoundry container as the host user`)
- Stack path: `~/docker/modelfoundry/`
- Local OpenAI-compatible endpoint: `http://127.0.0.1:7352/v1`
- Hermes raw model upstream from Docker: `http://host.docker.internal:8648/v1`

Smoke tests passed for `/v1/models`, direct host/container Hermes connectivity, non-streaming chat, streaming chat with `[DONE]`, config persistence across restart, and a disposable env-configured client. The first pass remains localhost-only. Inbound auth can wait, but alias policy and log redaction are the next practical hardening items before multiple internal apps rely on this endpoint.

## Next Action

Keep ModelFoundry bound to `127.0.0.1:7352` until inbound auth, stable alias policy, and prompt/response log redaction are deliberately added.
