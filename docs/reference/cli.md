# CLI reference

## Primary commands

```bash
model-foundry [--port <number>] [--log] [--ban <model1,model2>]
model-foundry onboard [--port <number>]
model-foundry install --autostart
model-foundry start --autostart
model-foundry uninstall --autostart
model-foundry status --autostart
model-foundry update
model-foundry refresh-scores
model-foundry config export
model-foundry config import <token>
model-foundry autoupdate [--enable|--disable|--status] [--interval <hours>]
model-foundry autostart [--install|--start|--uninstall|--status]
```

Legacy alias:

```bash
modelrelay
```

## Flags

- `--port <number>`: router HTTP port, default `7352`
- `--log`: enable request payload logging in terminal
- `--no-log`: disable request payload logging (legacy override)
- `--ban <ids>`: comma-separated model IDs to keep banned
- `--onboard`: same as `onboard`
- `--help`, `-h`: show help

### Autostart flags

- `--autostart`
- `--install`
- `--start`
- `--uninstall`
- `--status`

### Auto-update flags

- `--enable`
- `--disable`
- `--interval <hours>`

## Common examples

### Start router on the default port

```bash
model-foundry
```

### Start router on a custom port

```bash
model-foundry --port 8080
```

### Start with terminal request logging

```bash
model-foundry --log
```

### Guided integration onboarding

```bash
model-foundry onboard
```

### Enable start-on-login

```bash
model-foundry install --autostart
```

### Inspect autostart state

```bash
model-foundry status --autostart
```

### Disable automatic npm update checks

```bash
model-foundry autoupdate --disable
```

### Export config for transfer to another machine

```bash
model-foundry config export
```

### Import config from stdin

```bash
model-foundry config export | model-foundry config import
```

## API endpoints

### `POST /v1/chat/completions`

OpenAI-compatible chat completions endpoint.

Typical model values:

- `auto-fastest`
- grouped model slugs like `minimax-m2.5`, `kimi-k2.5`, `glm4.7`

### `GET /v1/models`

Returns the models exposed by the router.

## Notes

- request logging is off by default
- the project still supports the legacy `modelrelay` binary name
- `refresh-scores` is intended to surface models missing verified benchmark scores
