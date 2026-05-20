# Docker Server Deployment

ModelFoundry is deployed on Docker-Server as a local-only Docker Compose service under `~/docker/modelfoundry/`.

## Layout

```text
~/model-foundry/                  # source checkout: Codename-11/model-foundry master
~/docker/modelfoundry/
  .env
  docker-compose.yml
  config/
```

`~/model-foundry/` is the source checkout. `~/docker/modelfoundry/` contains only the Compose stack, env, and persistent runtime config. `config/` is mounted as the container home, so ModelFoundry persists `config/.modelrelay.json` and log state outside the container.

## Compose

Use `deploy/docker-compose.yml` as the template for `~/docker/modelfoundry/docker-compose.yml`. It builds the local fork from `/home/bailey/model-foundry`, binds ModelFoundry to localhost and the configured LAN address, mounts persistent config at `/config`, and attaches the container to `traefik_proxy` for the Authelia-protected browser UI.

Use `deploy/.env.example` as the starting `.env`:

```env
MODELFOUNDRY_PORT=7352
MODELFOUNDRY_LAN_BIND=172.16.24.250
MODELFOUNDRY_HERMES_PROXY_BASE_URL=http://172.16.24.250:8648/v1
MODELFOUNDRY_INBOUND_API_KEYS=replace-with-random-api-key
MODELFOUNDRY_UID=1000
MODELFOUNDRY_GID=1000
```

The Hermes Proxy URL is the Docker-reachable raw model endpoint. On Docker-Server, use the explicit LAN URL (`http://172.16.24.250:8648/v1`) rather than Docker's `host.docker.internal` alias so the configured upstream matches the stable LAN address used by other clients. Port `8648` is the verified OpenAI-compatible model endpoint; `8645` answered `/health` during validation but did not serve `/v1/models`.

Set `MODELFOUNDRY_UID` and `MODELFOUNDRY_GID` to the host user that owns `~/docker/modelfoundry/config` so `.modelrelay.json` remains readable and manageable from the host.

Set `MODELFOUNDRY_INBOUND_API_KEYS` before binding the service to any non-localhost address. The live Docker-Server deployment stores a generated key in `~/docker/modelfoundry/.env` (mode `0600`) and accepts it as either `Authorization: Bearer <key>` or `X-API-Key: <key>` on `/v1/*` routes. Do not paste the live key into docs or chat.

## Smoke Tests

```bash
# Load the key into the shell without printing it.
set -a
. ~/docker/modelfoundry/.env
set +a

curl -fsS http://127.0.0.1:7352/v1/models \
  -H "Authorization: Bearer ${MODELFOUNDRY_INBOUND_API_KEYS}" \
  | jq '.data | length, .[0:10]'

curl -fsS http://172.16.24.250:7352/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${MODELFOUNDRY_INBOUND_API_KEYS}" \
  -d '{"model":"grok-4.3","messages":[{"role":"user","content":"Reply with exactly: ok"}],"temperature":0,"max_tokens":8}' | jq .

curl -N http://172.16.24.250:7352/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${MODELFOUNDRY_INBOUND_API_KEYS}" \
  -d '{"model":"grok-4.3","stream":true,"messages":[{"role":"user","content":"Count to three, one number per token."}],"max_tokens":16}'
```

## Verified Deployment

Verified on Docker-Server on 2026-05-19 from `Codename-11/model-foundry` `master` after moving the source checkout to the canonical project location.

- Stack path: `~/docker/modelfoundry/`
- Source checkout: `~/model-foundry`
- Public bindings: `127.0.0.1:7352->7352` and `172.16.24.250:7352->7352`.
- Browser UI URL: `https://modelfoundry.axiom-labs.dev/` behind Authelia (`chain-authelia`).
- Local app/API base URL: `http://127.0.0.1:7352/v1`.
- LAN app/API base URL: `http://172.16.24.250:7352/v1`.
- `/v1/*` requires the generated bearer key from `~/docker/modelfoundry/.env` (`MODELFOUNDRY_INBOUND_API_KEYS`).
- Public `/v1/*` requests through `modelfoundry.axiom-labs.dev` are intentionally intercepted by Authelia and are not a machine-client endpoint.
- Hermes upstream from the container: `http://172.16.24.250:8648/v1`
- Persistent config: `~/docker/modelfoundry/config/.modelrelay.json`

Smoke results:

- `/v1/models` without a bearer key returns `401`; with the configured key it returned 100 ModelFoundry catalog entries, including discovered Hermes models, from both localhost and LAN bindings.
- Direct Hermes host and container-network checks returned Hermes Proxy's advertised models via `/v1/models`.
- `grok-4.3` chat through ModelFoundry returned `ok`.
- `grok-4.3` streaming through ModelFoundry emitted SSE chunks and final `[DONE]`.
- The Hermes preset persisted across container restart with base URL `http://172.16.24.250:8648/v1` and API key `unused`.
- A disposable Node client using `OPENAI_BASE_URL=http://127.0.0.1:7352/v1` completed a chat request through ModelFoundry.

Hardening decision:

- Inbound API-key auth is enabled for `/v1/*` before LAN binding. Keep `~/docker/modelfoundry/.env` mode `0600` and rotate `MODELFOUNDRY_INBOUND_API_KEYS` if it is pasted into chat, logs, docs, or app configs beyond the intended client.
- Alias policy is needed before broad internal use. During smoke, `auto-fastest` was able to select a non-Hermes free provider, so apps that require Hermes should use explicit model IDs until stable aliases such as `default`, `fast`, `reasoning`, `coding`, and `hermes` exist.
- Log redaction or log-disable controls are still needed before sensitive workloads. Request logs are local and mode `0600`, but `.modelrelay-logs.json` stores request messages and response metadata.

Keep public internet machine access closed unless alias policy and logging/redaction policy are explicitly added. The Authelia route is for interactive browser UI access only; the direct `/v1` endpoint is for localhost/LAN clients with the bearer key.

## Authelia UI Route

The live Docker-Server deployment attaches the container to the external `traefik_proxy` network while retaining the localhost-only host port. Traefik reaches the app as `http://modelfoundry:7352`, and the dynamic file-provider route lives at:

```text
~/docker/1. traefik3-authelia/rules/app-modelfoundry.yaml
```

Route policy:

- Host: `modelfoundry.axiom-labs.dev`
- Middleware chain: `chain-authelia`
- Purpose: browser UI only
- Machine clients: use `http://127.0.0.1:7352/v1` from Docker-Server or `http://172.16.24.250:7352/v1` from the LAN with `Authorization: Bearer <MODELFOUNDRY_INBOUND_API_KEYS>`. Do not use the Authelia UI hostname for OpenAI-compatible clients.
