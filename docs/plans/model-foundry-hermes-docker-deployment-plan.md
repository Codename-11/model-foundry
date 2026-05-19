# ModelFoundry Hermes Proxy Docker Deployment Plan

> **For Hermes:** Use this plan as the execution checklist for preparing the revived ModelFoundry fork, merging it to `Codename-11/model-foundry` `main`, and deploying it on Docker-Server as a Docker Compose service wired to the live Hermes Proxy model endpoint.

**Goal:** Promote ModelFoundry from a validated revival branch into a locally deployed, Docker-managed OpenAI-compatible router for Axiom testing, with Hermes Proxy configured as a downstream OpenAI-compatible provider and with enough local hardening to safely point internal apps/tools at one common endpoint.

**Architecture:** ModelFoundry remains a lightweight local model router/dashboard, not a full LiteLLM-style governance gateway. Docker-Server runs ModelFoundry in Compose from the `Codename-11/model-foundry` fork, with persistent config mounted from `~/docker/modelfoundry/config` and Hermes Proxy registered as `openai-compatible:hermes-proxy` pointing at the verified raw model endpoint (`http://host.docker.internal:8648/v1` or the Docker-host equivalent). Apps under test call ModelFoundry at `http://<docker-server>:7352/v1` using OpenAI-compatible `base_url`, `api_key`, and `model` fields.

**Tech Stack:** Node.js/Express `modelrelay@1.17.1` fork, Docker Compose under `~/docker/`, Hermes Proxy raw model endpoint, OpenAI-compatible `/v1/models` and `/v1/chat/completions`, `npm test -- --test-reporter=spec`.

---

## Current validated state

- Working branch: `revive/hermes-proxy`
- Remote fork: `Codename-11/model-foundry`
- Current remote branch ref: `2692f3136c9b87dc6989545e2e961a12977adb6e`
- Test status from revival branch: `183 passing`
- Verified Hermes Proxy model endpoint on Docker-Server during revival: `http://127.0.0.1:8648/v1`
- Known wrong endpoint during revival: `http://127.0.0.1:8645/v1` returned `/health` but not `/v1/models`, so it was Hermes webhook/API, not raw model proxy.

---

## Acceptance criteria

1. `revive/hermes-proxy` is merged into the fork's primary branch (`main` if present; otherwise confirm and use `master`).
2. The Docker image builds from the fork source, not from upstream npm `modelrelay`, so our Hermes preset/docs/scripts are present in the deployed container.
3. Docker Compose stack lives under `~/docker/modelfoundry/` on Docker-Server.
4. ModelFoundry persists config outside the container.
5. ModelFoundry exposes `/v1/models` and `/v1/chat/completions` on port `7352` for internal testing.
6. Hermes Proxy is configured as an OpenAI-compatible endpoint using the Docker-reachable raw model proxy URL.
7. Smoke tests pass from both host and container network perspectives.
8. Request logging is intentionally configured for testing; prompts/responses are not exposed publicly.
9. No public DNS or LAN-wide exposure is added unless explicitly approved later.
10. Deployment notes are added to the project docs after verification.

---

## Phase 0 — Pre-flight discovery

### Task 0.1: Confirm fork default branch and remote state

**Objective:** Avoid merging into the wrong branch name.

**Files:** none

**Commands:**

```bash
cd ~/builds/model-foundry-revival/model-foundry
git fetch origin upstream
git remote -v
gh repo view Codename-11/model-foundry --json defaultBranchRef,nameWithOwner
```

**Expected:** Default branch is identified. If it is `main`, merge to `main`; if it is `master`, merge to `master` and document that naming.

### Task 0.2: Confirm Hermes Proxy host endpoint

**Objective:** Verify the raw model endpoint before wiring Docker config.

**Commands:**

```bash
curl -fsS http://127.0.0.1:8648/health | jq .
curl -fsS http://127.0.0.1:8648/v1/models | jq '.data | length, .[0:5]'
```

**Expected:** `/v1/models` returns model data. If this fails, run `hermes proxy status` and correct the endpoint before deployment.

### Task 0.3: Confirm Docker can reach host services

**Objective:** Determine the correct URL from the ModelFoundry container to Hermes Proxy running on the host.

**Commands:**

```bash
docker run --rm --add-host=host.docker.internal:host-gateway curlimages/curl:latest \
  -fsS http://host.docker.internal:8648/v1/models | head -c 500
```

**Expected:** Container can reach Hermes Proxy via `host.docker.internal:8648`. If not, use the Docker bridge gateway IP or run Hermes Proxy on a shared Docker network.

---

## Phase 1 — Finalize code before merge

### Task 1.1: Fix Dockerfile to build this fork, not npm upstream

**Objective:** Ensure Docker deploy includes fork changes.

**Files:**
- Modify: `Dockerfile`
- Test: `test/test.js` if helper behavior is added; otherwise Docker build smoke is enough.

**Current problem:** Existing Dockerfile runs `npm install -g modelrelay`, which installs upstream from npm and discards the fork branch.

**Implementation shape:**

```dockerfile
FROM node:24-alpine

RUN apk add --no-cache ca-certificates
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY bin/ ./bin/
COPY lib/ ./lib/
COPY public/ ./public/
COPY scripts/ ./scripts/
COPY sources.js scores.js README.md LICENSE ./

ENV NODE_ENV=production
ENV HOME=/config
EXPOSE 7352

ENTRYPOINT ["node", "bin/modelrelay.js"]
CMD ["--port", "7352", "--no-log"]
```

**Verification:**

```bash
docker build -t modelfoundry:local .
docker run --rm modelfoundry:local --help || true
```

### Task 1.2: Add deployment compose template

**Objective:** Provide a production-ish local Compose file that can be copied to `~/docker/modelfoundry/`.

**Files:**
- Create or modify: `deploy/docker-compose.yml`
- Create: `deploy/.env.example`

**Compose shape:**

```yaml
services:
  modelfoundry:
    build:
      context: .
    container_name: modelfoundry
    restart: unless-stopped
    ports:
      - "127.0.0.1:${MODELFOUNDRY_PORT:-7352}:7352"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      NODE_ENV: production
      HOME: /config
      MODELFOUNDRY_HERMES_PROXY_BASE_URL: ${MODELFOUNDRY_HERMES_PROXY_BASE_URL:-http://host.docker.internal:8648/v1}
    volumes:
      - ./config:/config
```

**Note:** Bind to `127.0.0.1` first. Add reverse proxy or LAN exposure only after inbound auth/logging hardening is implemented and approved.

**Verification:**

```bash
docker compose -f deploy/docker-compose.yml config
```

### Task 1.3: Allow Hermes preset base URL override

**Objective:** Keep public default generic while deployment can set the Docker-reachable Hermes Proxy URL.

**Files:**
- Modify: `lib/config.js`
- Modify: `test/test.js`

**Behavior:** `buildHermesProxyEndpointPreset()` should prefer `process.env.MODELFOUNDRY_HERMES_PROXY_BASE_URL` when set, falling back to `http://127.0.0.1:8645/v1`.

**Test first:**

```js
test('Hermes Proxy preset honors MODELFOUNDRY_HERMES_PROXY_BASE_URL', () => {
  const previous = process.env.MODELFOUNDRY_HERMES_PROXY_BASE_URL
  process.env.MODELFOUNDRY_HERMES_PROXY_BASE_URL = 'http://host.docker.internal:8648/v1'
  try {
    const preset = buildHermesProxyEndpointPreset()
    assert.equal(preset.baseUrl, 'http://host.docker.internal:8648/v1')
  } finally {
    if (previous == null) delete process.env.MODELFOUNDRY_HERMES_PROXY_BASE_URL
    else process.env.MODELFOUNDRY_HERMES_PROXY_BASE_URL = previous
  }
})
```

**Verification:**

```bash
npm test -- --test-reporter=spec
```

### Task 1.4: Add local inbound auth only if exposing beyond localhost

**Objective:** Keep first deployment safe without overbuilding.

**Decision:** For localhost-only Docker binding, defer inbound auth. If we need LAN/reverse-proxy exposure, add `MODELFOUNDRY_API_KEY` before exposing.

**If needed later:** Require `Authorization: Bearer $MODELFOUNDRY_API_KEY` on `/v1/*` and mutating `/api/*` routes, then add tests.

---

## Phase 2 — Merge to fork primary branch

### Task 2.1: Run final local verification

**Commands:**

```bash
cd ~/builds/model-foundry-revival/model-foundry
git status --short
npm test -- --test-reporter=spec
node --check lib/server.js
node --check lib/onboard.js
node --check scripts/smoke-hermes-proxy.mjs
docker build -t modelfoundry:merge-candidate .
```

**Expected:** Clean or only intentional plan/deploy changes; tests pass.

### Task 2.2: Merge branch into fork default branch

**Commands if default branch is `main`:**

```bash
git checkout main
git pull origin main
git merge --no-ff revive/hermes-proxy -m "Merge Hermes Proxy ModelFoundry revival"
git push origin main
```

**Commands if default branch is `master`:**

```bash
git checkout master
git pull origin master
git merge --no-ff revive/hermes-proxy -m "Merge Hermes Proxy ModelFoundry revival"
git push origin master
```

**Verification:**

```bash
git ls-remote --heads origin main master
gh repo view Codename-11/model-foundry --json defaultBranchRef
```

---

## Phase 3 — Deploy on Docker-Server

### Task 3.1: Create Docker stack directory

**Objective:** Follow Docker-Server convention: project services under `~/docker/`, not systemd.

**Commands:**

```bash
mkdir -p ~/docker/modelfoundry/config
cd ~/docker/modelfoundry
```

### Task 3.2: Clone/update deploy source

**Option A: deploy directly from repo checkout under `~/docker/modelfoundry/src`:**

```bash
cd ~/docker/modelfoundry
if [ ! -d src/.git ]; then
  git clone https://github.com/Codename-11/model-foundry.git src
fi
cd src
git fetch origin
git checkout main || git checkout master
git pull --ff-only origin $(git branch --show-current)
```

**Option B: copy from build checkout:** acceptable for first smoke, but repo checkout is preferred for repeatable updates.

### Task 3.3: Write deployment `.env`

**File:** `~/docker/modelfoundry/.env`

```env
MODELFOUNDRY_PORT=7352
MODELFOUNDRY_HERMES_PROXY_BASE_URL=http://host.docker.internal:8648/v1
```

Do not put upstream provider secrets here unless needed for specific tests.

### Task 3.4: Write Docker Compose file

**File:** `~/docker/modelfoundry/docker-compose.yml`

```yaml
services:
  modelfoundry:
    build:
      context: ./src
    container_name: modelfoundry
    restart: unless-stopped
    ports:
      - "127.0.0.1:${MODELFOUNDRY_PORT:-7352}:7352"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      NODE_ENV: production
      HOME: /config
      MODELFOUNDRY_HERMES_PROXY_BASE_URL: ${MODELFOUNDRY_HERMES_PROXY_BASE_URL:-http://host.docker.internal:8648/v1}
    volumes:
      - ./config:/config
```

### Task 3.5: Build and start

**Commands:**

```bash
cd ~/docker/modelfoundry
docker compose config
docker compose build modelfoundry
docker compose up -d modelfoundry
docker compose ps
docker logs --tail 80 modelfoundry
```

**Expected:** Container is `Up`; logs show ModelFoundry/modelrelay listening on `7352`.

---

## Phase 4 — Configure Hermes Proxy in ModelFoundry

### Task 4.1: Add Hermes Proxy preset through API

**Commands:**

```bash
curl -fsS -X POST http://127.0.0.1:7352/api/openai-compatible/endpoints/presets/hermes-proxy \
  -H 'Content-Type: application/json' \
  -d '{"overwrite":true}' | jq .
```

**Expected:** Success response.

### Task 4.2: Verify persisted config

**Commands:**

```bash
jq '.providers["openai-compatible:hermes-proxy"], .apiKeys["openai-compatible:hermes-proxy"]' \
  ~/docker/modelfoundry/config/.modelrelay.json
```

**Expected:** Base URL is `http://host.docker.internal:8648/v1`; API key is placeholder `unused`; discovery is enabled.

### Task 4.3: Force container restart and confirm persistence

**Commands:**

```bash
cd ~/docker/modelfoundry
docker compose restart modelfoundry
sleep 3
curl -fsS http://127.0.0.1:7352/api/config | jq '.providers["openai-compatible:hermes-proxy"]'
```

---

## Phase 5 — End-to-end smoke testing

### Task 5.1: Verify ModelFoundry model list

**Commands:**

```bash
curl -fsS http://127.0.0.1:7352/v1/models | jq '.data | length, .[0:10]'
```

**Expected:** Includes `auto-fastest` and discovered/merged model IDs.

### Task 5.2: Verify direct Hermes Proxy from host

**Commands:**

```bash
cd ~/docker/modelfoundry/src
HERMES_PROXY_BASE_URL=http://127.0.0.1:8648/v1 npm run smoke:hermes-proxy
```

**Expected:** Health/models pass.

### Task 5.3: Verify direct Hermes Proxy from container network

**Commands:**

```bash
docker run --rm --add-host=host.docker.internal:host-gateway curlimages/curl:latest \
  -fsS http://host.docker.internal:8648/v1/models | jq '.data | length'
```

**Expected:** Non-zero model count.

### Task 5.4: Verify ModelFoundry chat route

**Commands:**

```bash
curl -fsS http://127.0.0.1:7352/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer test' \
  -d '{
    "model": "auto-fastest",
    "messages": [{"role":"user","content":"Reply with exactly: ok"}],
    "temperature": 0,
    "max_tokens": 8
  }' | jq .
```

**Expected:** OpenAI-compatible response. If `auto-fastest` chooses a non-Hermes route and we need Hermes-specific validation, request a discovered Hermes model ID from `/v1/models`.

### Task 5.5: Verify streaming route

**Commands:**

```bash
curl -N http://127.0.0.1:7352/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer test' \
  -d '{
    "model": "auto-fastest",
    "stream": true,
    "messages": [{"role":"user","content":"Count to three, one number per token."}],
    "max_tokens": 16
  }'
```

**Expected:** SSE-style streamed chunks and final `[DONE]` if upstream supports standard streaming.

---

## Phase 6 — Testing usage

### Task 6.1: Point one disposable app/tool at ModelFoundry

**Config shape:**

```env
OPENAI_BASE_URL=http://127.0.0.1:7352/v1
OPENAI_API_KEY=test
OPENAI_MODEL=auto-fastest
```

**Expected:** App can use ModelFoundry without knowing Hermes/OpenRouter/provider-specific details.

### Task 6.2: Capture issues as follow-up tasks

Track only observed needs, not speculative gateway bloat:

- inbound auth if exposing beyond localhost
- prompt/response log redaction controls
- stable aliases: `default`, `fast`, `reasoning`, `coding`, `hermes`
- Hermes endpoint wrong-port detector
- provider capability metadata for tools/JSON/vision

---

## Phase 7 — Post-deploy docs

### Task 7.1: Update project docs

**Files:**
- Modify: `docs/integrations/hermes-proxy.md`
- Modify: `docs/model-foundry-revival.md`
- Optional: add `docs/deployment/docker-server.md`

**Content:**

- canonical Docker deployment path: `~/docker/modelfoundry/`
- canonical local ModelFoundry endpoint: `http://127.0.0.1:7352/v1`
- canonical Hermes Proxy upstream from container: `http://host.docker.internal:8648/v1`
- explicit note that `8645` is not the raw model endpoint on Docker-Server unless Hermes config changes
- smoke-test commands and expected results

### Task 7.2: Add Homepage service only after stable

If testing succeeds and user wants it visible, add Homepage entry. Do not expose public DNS until inbound auth/logging policy is handled.

---

## Rollback

```bash
cd ~/docker/modelfoundry
docker compose down
# Config remains in ./config for inspection.
```

If merged code needs reverting:

```bash
cd ~/docker/modelfoundry/src
git log --oneline --max-count=5
git revert <merge_commit_sha>
git push origin $(git branch --show-current)
docker compose build modelfoundry
docker compose up -d modelfoundry
```

---

## Execution goal paragraph

Execute `docs/plans/model-foundry-hermes-docker-deployment-plan.md` to finalize the revived ModelFoundry fork as our lightweight internal OpenAI-compatible model router: merge the validated `revive/hermes-proxy` branch into `Codename-11/model-foundry`'s primary branch, fix the Docker build so it runs our fork instead of upstream npm, deploy the service under `~/docker/modelfoundry/` on Docker-Server with persistent config and Hermes Proxy wired through the verified raw model endpoint on `8648`, then smoke-test `/v1/models`, `/v1/chat/completions`, streaming, config persistence, and one disposable app/tool using `OPENAI_BASE_URL=http://127.0.0.1:7352/v1` before deciding whether further hardening like inbound auth, alias policy, and log redaction is needed.
