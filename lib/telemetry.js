export const MAX_PERSISTED_PINGS = 120
export const MAX_PERSISTED_TELEMETRY_ROWS = 600

export function getTelemetryRowKey(providerKey, modelId) {
  return `${providerKey || ''}::${modelId || ''}`
}

function normalizePingEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const code = entry.code == null ? null : String(entry.code)
  const ts = Number(entry.ts)
  const rawMs = entry.ms
  const ms = Number.isFinite(Number(rawMs)) ? Number(rawMs) : (rawMs === 'TIMEOUT' ? 'TIMEOUT' : null)
  if (!code) return null
  if (!Number.isFinite(ts) || ts <= 0) return null
  if (ms == null) return null
  return { code, ms, ts }
}

function normalizeErrorEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const code = entry.code == null ? null : String(entry.code)
  const message = typeof entry.message === 'string' ? entry.message : null
  const updatedAt = typeof entry.updatedAt === 'string' ? entry.updatedAt : null
  if (!code && !message && !updatedAt) return null
  return { code, message, updatedAt }
}

function normalizeTelemetryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const providerKey = typeof entry.providerKey === 'string' ? entry.providerKey : ''
  const modelId = typeof entry.modelId === 'string' ? entry.modelId : ''
  if (!providerKey || !modelId) return null

  const pings = Array.isArray(entry.pings)
    ? entry.pings.map(normalizePingEntry).filter(Boolean).slice(-MAX_PERSISTED_PINGS)
    : []

  return {
    providerKey,
    modelId,
    status: entry.status == null ? null : String(entry.status),
    httpCode: entry.httpCode == null ? null : String(entry.httpCode),
    pings,
    lastPingAt: Number.isFinite(Number(entry.lastPingAt)) ? Number(entry.lastPingAt) : 0,
    lastModelResponseAt: Number.isFinite(Number(entry.lastModelResponseAt)) ? Number(entry.lastModelResponseAt) : 0,
    lastError: normalizeErrorEntry(entry.lastError),
    rateLimit: entry.rateLimit && typeof entry.rateLimit === 'object' ? { ...entry.rateLimit } : null,
  }
}

export function normalizeTelemetryPayload(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.rows)
      ? payload.rows
      : []

  const map = new Map()
  for (const row of rows) {
    const normalized = normalizeTelemetryEntry(row)
    if (!normalized) continue
    map.set(getTelemetryRowKey(normalized.providerKey, normalized.modelId), normalized)
  }
  return map
}

export function snapshotTelemetryRow(row) {
  if (!row?.providerKey || !row?.modelId) return null
  const pings = Array.isArray(row.pings)
    ? row.pings.map(normalizePingEntry).filter(Boolean).slice(-MAX_PERSISTED_PINGS)
    : []

  const hasUsefulTelemetry = pings.length > 0
    || Number(row.lastPingAt) > 0
    || Number(row.lastModelResponseAt) > 0
    || !!row.lastError
    || !!row.rateLimit
    || (typeof row.status === 'string' && row.status !== 'pending')

  if (!hasUsefulTelemetry) return null

  return {
    providerKey: row.providerKey,
    modelId: row.modelId,
    status: row.status || null,
    httpCode: row.httpCode == null ? null : String(row.httpCode),
    pings,
    lastPingAt: Number.isFinite(Number(row.lastPingAt)) ? Number(row.lastPingAt) : 0,
    lastModelResponseAt: Number.isFinite(Number(row.lastModelResponseAt)) ? Number(row.lastModelResponseAt) : 0,
    lastError: normalizeErrorEntry(row.lastError),
    rateLimit: row.rateLimit && typeof row.rateLimit === 'object' ? { ...row.rateLimit } : null,
  }
}

export function serializeTelemetryMap(telemetryMap) {
  const rows = Array.from(telemetryMap.values())
    .map(normalizeTelemetryEntry)
    .filter(Boolean)
    .sort((a, b) => {
      const aTs = Math.max(a.lastModelResponseAt || 0, a.lastPingAt || 0)
      const bTs = Math.max(b.lastModelResponseAt || 0, b.lastPingAt || 0)
      return bTs - aTs
    })
    .slice(0, MAX_PERSISTED_TELEMETRY_ROWS)

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    rows,
  }
}

export function applyPersistedTelemetry(row, telemetryEntry) {
  if (!row || !telemetryEntry) return row
  row.pings = Array.isArray(telemetryEntry.pings) ? telemetryEntry.pings.map(entry => ({ ...entry })) : []
  row.status = telemetryEntry.status || row.status
  row.httpCode = telemetryEntry.httpCode || null
  row.lastPingAt = Number(telemetryEntry.lastPingAt) || 0
  row.lastModelResponseAt = Number(telemetryEntry.lastModelResponseAt) || 0
  row.lastError = telemetryEntry.lastError ? { ...telemetryEntry.lastError } : null
  row.rateLimit = telemetryEntry.rateLimit ? { ...telemetryEntry.rateLimit } : null
  return row
}
