# Hermes Agent integration

ModelFoundry is a good fit for Hermes Agent as an **optional OpenAI-compatible model lane**. Keep your normal Hermes provider/profile setup intact, then point a profile at ModelFoundry only when you want benchmark-aware routing, dashboard telemetry, or a shared local router for multiple tools.

Reference Hermes configuration docs: <https://hermes-agent.nousresearch.com/docs/user-guide/configuration>

## Recommended approach

1. Start ModelFoundry:

   ```bash
   model-foundry
   ```

2. Configure Hermes Agent with Hermes' own config CLI:

   ```bash
   hermes config set model.provider custom
   hermes config set model.base_url http://127.0.0.1:7352/v1
   hermes config set model.api_key no-key
   hermes config set model.default auto-fastest
   ```

3. Verify the lane:

   ```bash
   hermes chat -q "Say hi through ModelFoundry" -Q
   ```

Use `hermes --profile <name> config set ...` if you want this only on a dedicated Hermes profile instead of your default profile.

## Hermes Proxy as a ModelFoundry upstream

Hermes Proxy is separate from Hermes Agent's tool/memory/session API. It exposes raw OpenAI-compatible model endpoints backed by Hermes-managed OAuth subscriptions.

Start it separately:

```bash
hermes proxy start --provider auto --host 127.0.0.1 --port 8648
```

Then add it in ModelFoundry from **Settings → OpenAI-Compatible endpoints → Add Hermes Proxy**. Leave the model blank unless you are intentionally pinning a discovered `/v1/models` result.

For Docker deployments:

```env
MODELFOUNDRY_HERMES_PROXY_BASE_URL=http://172.16.24.250:8648/v1
MODELFOUNDRY_HERMES_PROXY_API_KEY=unused
MODELFOUNDRY_HERMES_PROXY_MODEL=
```

On Docker-Server, use the stable LAN URL above rather than Docker's `host.docker.internal` alias so containers and LAN clients resolve the same upstream. Keep `MODELFOUNDRY_HERMES_PROXY_MODEL` blank unless a non-discovering client needs a pinned fallback; ModelFoundry should prefer Hermes Proxy `/v1/models` discovery.

## Why use ModelFoundry with Hermes?

- Route multiple OpenAI-compatible upstreams through one local endpoint.
- Compare direct provider lanes and Hermes Proxy-discovered models in one dashboard.
- Keep OAuth subscriptions centralized in Hermes Proxy while keeping ModelFoundry's transport generic.
- Use `auto-fastest` or explicit model IDs depending on whether you want routing or a pinned lane.

## Security notes

- ModelFoundry's inbound API key defaults to “any string” for local use. Add network/auth controls before exposing it beyond localhost.
- Hermes Proxy bearer tokens are placeholders at the local proxy boundary; Hermes attaches the real upstream OAuth credential.
- Keep secrets in `.env` or the relevant app config; do not paste OAuth tokens into docs.
