# OpenClaw integration

ModelFoundry is a good fit for OpenClaw as an **optional routed lane**, not necessarily as your default primary model.

## Recommended approach

Keep your usual primary model untouched, then add ModelFoundry as an available provider/model lane.

That gives you:

- optional routed usage when you want it
- easy fallbacks if the router is down
- a clean separation between local routing experiments and your main production defaults

## Fast path

```bash
model-foundry onboard
```

The onboarding flow can patch OpenClaw config automatically when the target config is plain JSON.

## Manual config

Merge this into `~/.openclaw/openclaw.json`:

```json
{
  "models": {
    "providers": {
      "modelfoundry": {
        "baseUrl": "http://127.0.0.1:7352/v1",
        "api": "openai-completions",
        "apiKey": "no-key",
        "models": [
          { "id": "auto-fastest", "name": "Auto Fastest" }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "openai/gpt-5.4"
      },
      "models": {
        "modelfoundry/auto-fastest": {}
      }
    }
  }
}
```

## Why this shape

The provider definition tells OpenClaw to treat ModelFoundry like an OpenAI-compatible upstream.

The `agents.defaults.models` lane makes the routed model available without forcing it to replace your primary default.

## What onboarding actually does

`lib/onboard.js`:

- creates/updates `models.providers.modelfoundry`
- ensures `modelfoundry/auto-fastest` exists as a selectable lane
- leaves your primary model alone unless you already pointed it at the legacy router lane

## Operational notes

- Router base URL: `http://127.0.0.1:7352/v1`
- API key: any placeholder string works for local OpenAI-compatible clients
- Best default routed model: `auto-fastest`
- Config path: `~/.openclaw/openclaw.json`

## Good use cases in OpenClaw

- an alternate model lane for agents doing broad coding tasks
- local experimentation with free/open model routing
- dashboard-assisted provider visibility before choosing a route manually

## Less good use cases

- replacing a known-good primary production model without testing first
- assuming routing makes every provider equally reliable
- pretending benchmark scores remove the need for model-specific judgment

They do not. Nice try, though.
