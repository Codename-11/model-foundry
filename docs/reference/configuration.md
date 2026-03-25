# Configuration and operations

## Config files

### Router config

- canonical: `~/.model-foundry.json`
- legacy mirror: `~/.modelrelay.json`

The config stores provider API keys, provider enable/disable state, bans, update settings, and related routing controls.

### Integration targets

- OpenClaw: `~/.openclaw/openclaw.json`
- OpenCode: `~/.config/opencode/opencode.json`

## API key environment variables

ModelFoundry can read provider keys from environment variables instead of persisted config.

- `NVIDIA_API_KEY`
- `GROQ_API_KEY`
- `CEREBRAS_API_KEY`
- `OPENCODE_API_KEY`
- `OPENROUTER_API_KEY`
- `OPENAI_COMPATIBLE_API_KEY`
- `CODESTRAL_API_KEY`
- `SCALEWAY_API_KEY`
- `QWEN_CODE_API_KEY`
- `DASHSCOPE_API_KEY` (Qwen fallback)
- `KILOCODE_API_KEY`
- `GOOGLE_API_KEY`

Additional OpenAI-compatible provider env vars:

- `OPENAI_COMPATIBLE_BASE_URL`
- `OPENAI_COMPATIBLE_MODEL`

## Config transfer

Use config transfer when moving a setup between machines:

```bash
model-foundry config export
model-foundry config import <token>
```

Or pipe it directly:

```bash
model-foundry config export | model-foundry config import
```

Treat the token as a secret because it can include API keys.

## Autostart

Platform-specific autostart support is implemented in `lib/autostart.js`.

### Linux

Uses a user-level systemd unit:

- file: `~/.config/systemd/user/modelrelay.service`

### macOS

Uses a LaunchAgent:

- file: `~/Library/LaunchAgents/io.modelfoundry.autostart.plist`

### Windows

Uses a startup script in the user's Startup folder.

## Auto-update

Auto-update is enabled by default unless disabled in config.

Commands:

```bash
model-foundry autoupdate --status
model-foundry autoupdate --disable
model-foundry autoupdate --enable --interval 12
```

Operationally:

- updates install through npm
- if autostart is configured, ModelFoundry manages stop/start behavior around the update flow
- source checkouts intentionally block the normal npm self-update path

## Provider behavior notes

A few provider behaviors matter operationally:

- some providers support optional bearer auth behavior
- Qwen Code can use OAuth cached credentials from `~/.qwen/oauth_creds.json`
- grouped model IDs and aliases are normalized before routing
- bans and provider exclusions affect candidate eligibility before ranking

## Troubleshooting quick hits

### Router runs but clients cannot connect

Check:

- correct port
- base URL is `http://127.0.0.1:<port>/v1`
- client is using any placeholder API key if it requires one

### Config changes seem ignored

Check both:

- env vars overriding file config
- whether you edited the canonical file or only the legacy mirror

### Update path says source installs cannot auto-update

That is expected for a Git checkout.
Use `git pull` for source-based installs.

### Need to inspect current router-exposed models

```bash
curl http://127.0.0.1:7352/v1/models
```
