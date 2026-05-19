# OAuth subscription gateway references

This note tracks external projects worth studying when ModelFoundry needs deeper CLI/OAuth subscription support beyond plain API-key and OpenAI-compatible upstream routing.

## Primary candidate: BYOKEY

- Repo: <https://github.com/AprilNEA/BYOKEY>
- Snapshot checked: GitHub API reported default branch `master`, 104 stars, updated `2026-05-19T06:39:50Z`.
- Positioning from README: “Turn AI subscriptions into standard API endpoints” and “Expose any provider as OpenAI- or Anthropic-compatible API — locally or in the cloud.”
- Useful implementation ideas:
  - Multi-format OpenAI/Anthropic-compatible endpoint layer.
  - OAuth login flows including PKCE, device-code, and auth-code patterns.
  - SQLite token persistence under a local app state directory.
  - Raw API-key passthrough fallback for providers where OAuth is not appropriate.
  - YAML config with hot reload.

## How ModelFoundry should use this

Use BYOKEY as a reference design for subscription-backed gateway ergonomics, not as an immediate runtime dependency. ModelFoundry already has the right adapter shape for this layer:

1. Providers expose OpenAI-compatible model discovery and chat completion routes.
2. OAuth/subscription ownership should live behind a provider wrapper, e.g. Hermes Proxy or another local gateway.
3. ModelFoundry should keep generic transport code and specialize metadata/auth/discovery per provider key.
4. Any OAuth implementation should keep tokens out of ModelFoundry config unless ModelFoundry itself owns the OAuth lifecycle.

## Provider caveats

- OpenAI/Codex and Anthropic subscription bridging have public reference projects, but terms and stability vary. Treat them as operator-controlled local integrations.
- Grok/xAI subscription bridging has fewer public, mature references. Hermes Proxy remains the preferred local source of truth for xAI OAuth-backed access in this environment.
- If ModelFoundry adds its own OAuth flows later, implement provider-specific review gates and secret storage rather than copying tokens from CLI configs ad hoc.
