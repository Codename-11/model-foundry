# OpenCode integration

OpenCode can use ModelFoundry as a router provider through the OpenAI-compatible endpoint.

## Fast path

```bash
model-foundry onboard
```

The onboarding flow can patch `~/.config/opencode/opencode.json` automatically.

## Manual config

Put this in `~/.config/opencode/opencode.json` or merge it into your existing config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "router": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "modelfoundry",
      "options": {
        "baseURL": "http://127.0.0.1:7352/v1",
        "apiKey": "dummy-key"
      },
      "models": {
        "auto-fastest": {
          "name": "Auto Fastest"
        }
      }
    }
  },
  "model": "router/auto-fastest"
}
```

## Why this works

OpenCode only needs a normal OpenAI-compatible provider config.
ModelFoundry handles the hard part underneath:

- provider/model health tracking
- grouped model routing
- best-route selection for `auto-fastest`

## Operational notes

- Config path: `~/.config/opencode/opencode.json`
- Router base URL: `http://127.0.0.1:7352/v1`
- Placeholder API key is fine for local use
- `router/auto-fastest` is the simplest starting point

## Practical workflow

Use OpenCode normally, but point the provider at ModelFoundry when you want:

- a single local endpoint
- easier switching across free/open models
- live routing rather than hardcoding one provider/model pair

If you later decide you hate the router's judgment, you can still pin a specific model/provider. Democracy survives.
