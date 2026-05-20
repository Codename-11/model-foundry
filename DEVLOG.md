# ModelFoundry — Dev Log

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
- Restarted `hermes-proxy.service`; `/v1/models` on `http://172.16.24.250:8648` now advertises `gpt-5.5`.
- Recreated `modelfoundry`; container env now has `MODELFOUNDRY_HERMES_PROXY_BASE_URL=http://172.16.24.250:8648/v1`.
- Refreshed `openai-compatible:hermes-proxy` in deployed ModelFoundry; discovery returned 10 Hermes Proxy models including `gpt-5.5`.
- `/v1/models` through ModelFoundry includes `gpt-5.5`.
