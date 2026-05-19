# Frontier provider catalog

ModelFoundry keeps frontier providers separate from the free/open router pool.

This catalog is for the settings surface and onboarding flow, not for the default routed lane.

## Families

- `Anthropic Claude`
- `OpenAI GPT / Codex`
- `Google Gemini`

## Why separate them

- they are paid frontier stacks, not interchangeable router pool entries
- they should be grouped by family instead of brittle version strings
- they belong in their own section so the main router story stays simple

## Shared data endpoint

ModelFoundry exposes a catalog endpoint for the UI layer:

```bash
GET /api/provider-meta
```

The catalog returns:

- recommended routing lanes
- frontier families
- optional lanes
- advanced/custom lanes

## Frontier keys

The catalog includes these family-level auth hints:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`

## Practical framing

- keep `OpenRouter` as the main default for the router/dashboard
- use frontier families as separate settings sections or paid-stack lanes
- do not mix frontier providers into the free/open router pool by default
