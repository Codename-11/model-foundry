#!/usr/bin/env node

const DEFAULT_BASE_URL = 'http://127.0.0.1:8648/v1'
const DEFAULT_MODEL = 'gpt-5.5'
const REQUEST_TIMEOUT_MS = 15_000

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/g, '')
}

function buildHealthUrl(baseUrl) {
  const trimmed = stripTrailingSlash(baseUrl || DEFAULT_BASE_URL)
  if (trimmed.endsWith('/v1')) return `${trimmed.slice(0, -3)}/health`
  return `${trimmed}/health`
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal })
    const text = await resp.text()
    let body = null
    if (text) {
      try { body = JSON.parse(text) } catch { body = null }
    }
    return { ok: resp.ok, status: resp.status, body }
  } finally {
    clearTimeout(timeout)
  }
}

function summarizeModels(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : []
  const ids = data.map((item) => item && item.id).filter(Boolean)
  return { count: ids.length, sample: ids.slice(0, 5) }
}

async function main() {
  const baseUrl = stripTrailingSlash(process.env.HERMES_PROXY_BASE_URL || DEFAULT_BASE_URL)
  const healthUrl = process.env.HERMES_PROXY_HEALTH_URL || buildHealthUrl(baseUrl)
  const apiKey = process.env.HERMES_PROXY_API_KEY || 'unused'
  const model = process.env.HERMES_PROXY_SMOKE_MODEL || DEFAULT_MODEL
  const headers = { Authorization: `Bearer ${apiKey}` }

  console.log(`Hermes Proxy smoke: ${baseUrl}`)

  const health = await fetchJson(healthUrl)
  if (!health.ok) {
    throw new Error(`health check failed: HTTP ${health.status}`)
  }
  console.log(`✓ health: HTTP ${health.status}`)

  const models = await fetchJson(`${baseUrl}/models`, { headers })
  if (!models.ok) {
    throw new Error(`/models failed: HTTP ${models.status}`)
  }
  const modelSummary = summarizeModels(models.body)
  console.log(`✓ models: ${modelSummary.count} discovered${modelSummary.sample.length ? ` (${modelSummary.sample.join(', ')})` : ''}`)

  if (process.env.HERMES_PROXY_SMOKE_CHAT === '1') {
    const chat = await fetchJson(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
        max_tokens: 8,
        temperature: 0,
      }),
    })
    if (!chat.ok) {
      throw new Error(`/chat/completions failed: HTTP ${chat.status}`)
    }
    const content = chat.body?.choices?.[0]?.message?.content || ''
    console.log(`✓ chat completions: HTTP ${chat.status}${content ? ` (${String(content).slice(0, 32)})` : ''}`)
  } else {
    console.log('ℹ chat completions skipped; set HERMES_PROXY_SMOKE_CHAT=1 to enable quota-using smoke')
  }
}

main().catch((err) => {
  console.error(`✗ Hermes Proxy smoke failed: ${err?.message || err}`)
  process.exitCode = 1
})
