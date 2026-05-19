# Hermes Proxy Integration

ModelFoundry/modelrelay can use Hermes Proxy as a normal OpenAI-compatible upstream endpoint. There is no custom Hermes transport in this integration; the preset writes the same `openai-compatible:<id>` config shape that a user could create manually.

## What each layer does

- **Hermes Proxy** is a raw model endpoint. It forwards OpenAI-compatible `/v1/models` and `/v1/chat/completions` requests through Hermes-managed OAuth-backed subscriptions.
- **Hermes API Server** is different: it runs the full Hermes agent backend with tools, memory, skills, session state, and platform routing. Do not point ModelFoundry at the API Server and expect raw model routing.
- **ModelFoundry/modelrelay** is a router, dashboard, and benchmarking layer. It can route to free public providers, arbitrary OpenAI-compatible endpoints, and optionally a local Hermes Proxy.

## Add from the dashboard

Open **Settings → OpenAI-Compatible endpoints** and click **Add Hermes Proxy**. The preset creates:

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

If your Hermes Proxy listens on a different local port, edit the endpoint's base URL after adding it.

For Docker deployments, the preset also honors `MODELFOUNDRY_HERMES_PROXY_BASE_URL`. Docker-Server uses:

```env
MODELFOUNDRY_HERMES_PROXY_BASE_URL=http://host.docker.internal:8648/v1
```

That value points containers at the verified raw Hermes Proxy model endpoint. On Docker-Server, port `8645` responded to `/health` during validation but did not serve `/v1/models`.

## Add during onboarding

`modelrelay onboard` asks whether to configure the local Hermes Proxy endpoint. If accepted, it writes `openai-compatible:hermes-proxy` with the preset above. It does not start Hermes Proxy for you.

Start Hermes Proxy separately, for example:

```bash
hermes proxy start --provider auto --host 127.0.0.1 --port 8645
```

## Smoke test

Run the included smoke script:

```bash
npm run smoke:hermes-proxy
```

To test a different port:

```bash
HERMES_PROXY_BASE_URL=http://127.0.0.1:8648/v1 npm run smoke:hermes-proxy
```

To also exercise a quota-using chat completion route:

```bash
HERMES_PROXY_BASE_URL=http://127.0.0.1:8648/v1 \
HERMES_PROXY_SMOKE_CHAT=1 \
HERMES_PROXY_SMOKE_MODEL=grok-4.3 \
npm run smoke:hermes-proxy
```

The script intentionally prints only status codes, counts, and short model samples. It does not print bearer tokens or full upstream response bodies.

## Docker-Server deployment

The canonical local deployment path is `~/docker/modelfoundry/`, with ModelFoundry exposed at `http://127.0.0.1:7352/v1` and persistent config mounted from `~/docker/modelfoundry/config`.

See [`docs/deployment/docker-server.md`](../deployment/docker-server.md) for the Compose template and smoke-test commands.

## Security note

Do not expose Hermes Proxy on a LAN or public interface without real network and authentication controls. Local Hermes Proxy accepts placeholder bearer values at the OpenAI-compatible layer and attaches the real local upstream credential when it forwards requests.
