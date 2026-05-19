# Docker Server Deployment

ModelFoundry is deployed on Docker-Server as a local-only Docker Compose service under `~/docker/modelfoundry/`.

## Layout

```text
~/docker/modelfoundry/
  .env
  docker-compose.yml
  config/
  src/
```

`src/` is a checkout of `Codename-11/model-foundry` on the primary branch. `config/` is mounted as the container home, so ModelFoundry persists `config/.modelrelay.json` and log state outside the container.

## Compose

Use `deploy/docker-compose.yml` as the template for `~/docker/modelfoundry/docker-compose.yml`. It builds the local fork from `./src`, binds ModelFoundry to `127.0.0.1:7352`, and mounts persistent config at `/config`.

Use `deploy/.env.example` as the starting `.env`:

```env
MODELFOUNDRY_PORT=7352
MODELFOUNDRY_HERMES_PROXY_BASE_URL=http://host.docker.internal:8648/v1
MODELFOUNDRY_UID=1000
MODELFOUNDRY_GID=1000
```

The Hermes Proxy URL is the Docker-reachable raw model endpoint. On Docker-Server, `8648` is the verified OpenAI-compatible model endpoint; `8645` answered `/health` during validation but did not serve `/v1/models`.

Set `MODELFOUNDRY_UID` and `MODELFOUNDRY_GID` to the host user that owns `~/docker/modelfoundry/config` so `.modelrelay.json` remains readable and manageable from the host.

## Smoke Tests

```bash
curl -fsS http://127.0.0.1:7352/v1/models | jq '.data | length, .[0:10]'

curl -fsS http://127.0.0.1:7352/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer test' \
  -d '{"model":"grok-4.3","messages":[{"role":"user","content":"Reply with exactly: ok"}],"temperature":0,"max_tokens":8}' | jq .

curl -N http://127.0.0.1:7352/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer test' \
  -d '{"model":"grok-4.3","stream":true,"messages":[{"role":"user","content":"Count to three, one number per token."}],"max_tokens":16}'
```

## Verified Deployment

Verified on Docker-Server on 2026-05-19 from `Codename-11/model-foundry` `master` at `00b0015`.

- Stack path: `~/docker/modelfoundry/`
- Source checkout: `~/docker/modelfoundry/src`
- Public binding: `127.0.0.1:7352->7352`
- ModelFoundry base URL: `http://127.0.0.1:7352/v1`
- Hermes upstream from the container: `http://host.docker.internal:8648/v1`
- Persistent config: `~/docker/modelfoundry/config/.modelrelay.json`

Smoke results:

- `/v1/models` returned 100 ModelFoundry catalog entries, including discovered Hermes models.
- Direct Hermes host and container-network checks returned 5 models: `grok-4.3`, `grok-4.20-reasoning`, `gpt-5.4`, `gpt-5.4-mini`, and `gpt-5.3-codex`.
- `grok-4.3` chat through ModelFoundry returned `ok`.
- `grok-4.3` streaming through ModelFoundry emitted SSE chunks and final `[DONE]`.
- The Hermes preset persisted across container restart with base URL `http://host.docker.internal:8648/v1` and API key `unused`.
- A disposable Node client using `OPENAI_BASE_URL=http://127.0.0.1:7352/v1` completed a chat request through ModelFoundry.

Hardening decision:

- Inbound auth is deferred while the service is bound to `127.0.0.1` only.
- Alias policy is needed before broad internal use. During smoke, `auto-fastest` was able to select a non-Hermes free provider, so apps that require Hermes should use explicit model IDs until stable aliases such as `default`, `fast`, `reasoning`, `coding`, and `hermes` exist.
- Log redaction or log-disable controls are needed before sensitive workloads. Request logs are local and mode `0600`, but `.modelrelay-logs.json` stores request messages and response metadata.

Keep the service bound to localhost unless inbound auth, alias policy, and logging/redaction policy are explicitly added.
