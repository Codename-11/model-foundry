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
```

The Hermes Proxy URL is the Docker-reachable raw model endpoint. On Docker-Server, `8648` is the verified OpenAI-compatible model endpoint; `8645` answered `/health` during validation but did not serve `/v1/models`.

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

Keep the service bound to localhost unless inbound auth, alias policy, and logging/redaction policy are explicitly added.
