# Acknowledgements

ModelFoundry began as a fork of [`ellipticmarketing/modelrelay`](https://github.com/ellipticmarketing/modelrelay), an MIT-licensed OpenAI-compatible local router/dashboard for free coding models.

We keep the original MIT license and preserve the commit history. The project direction has diverged toward a standalone central model gateway/router with optional Hermes Proxy integration and deployment-oriented controls.

Compatibility notes:

- The legacy `modelrelay` CLI alias remains available for older scripts.
- `~/.modelrelay.json` remains a compatibility mirror of the canonical `~/.model-foundry.json` config.
- Upstream ModelRelay changes should be reviewed and cherry-picked deliberately when they fit ModelFoundry's gateway direction.
