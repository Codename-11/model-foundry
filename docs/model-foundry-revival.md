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
