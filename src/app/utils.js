export const DEFAULT_SORT_CHAIN = [
  { col: 'status', dir: 1 },
  { col: 'qos', dir: -1 },
  { col: 'ping', dir: 1 },
  { col: 'availability', dir: -1 },
  { col: 'model', dir: 1 },
];

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function stableStringify(value) {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export function getLocalDayKey(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'invalid-day';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function simpleHash(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function normalizeMessageForHash(msg) {
  const normalized = {
    role: msg && msg.role ? String(msg.role) : 'unknown',
    name: msg && msg.name ? String(msg.name) : '',
    tool_call_id: msg && msg.tool_call_id ? String(msg.tool_call_id) : '',
    content: msg && msg.content != null ? msg.content : '',
  };
  if (msg && msg.tool_calls != null) normalized.tool_calls = msg.tool_calls;
  if (msg && msg.function_call != null) normalized.function_call = msg.function_call;
  return stableStringify(normalized);
}

export function formatMessageContent(content) {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

export function roleColor(role) {
  if (role === 'system') return 'var(--warning)';
  if (role === 'user') return 'var(--success)';
  if (role === 'assistant') return 'var(--accent)';
  if (role === 'tool') return '#8b5cf6';
  return 'var(--text-muted)';
}

export function getPingAnimClass(ms) {
  if (ms === Infinity || ms === null) return '';
  if (ms < 400) return 'anim-fast';
  if (ms < 1200) return 'anim-medium';
  return 'anim-slow';
}

export function getPingSpeed(ms) {
  if (ms === Infinity || ms === null) return '0s';
  if (ms < 400) return '3.5s';
  if (ms < 1200) return '2.5s';
  return '1.8s';
}

export function getQosDisplayValue(qos) {
  const n = Number(qos);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

export function getQosColor(qos) {
  const n = Number(qos);
  if (!Number.isFinite(n)) return 'var(--error)';
  if (n >= 45) return '#16a34a';
  if (n >= 40) return '#4ade80';
  if (n >= 20) return 'var(--warning)';
  return 'var(--error)';
}

export function getBenchmarkSortValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

export function getBenchmarkDisplayValue(value, isEstimated = false) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const pill = isEstimated ? '<span class="pill-estimate">Unknown</span>' : '';
  return `${Math.round(n * 100)}${pill}`;
}

export function getBenchmarkTableDisplayValue(value, isEstimated = false) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const score = Math.round(n * 100);
  const pill = isEstimated ? '<span class="pill-estimate">Unknown</span>' : '';
  return `${score}${pill}`;
}

export function formatIsoDateTime(value) {
  if (!value) return 'Never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Never';
  return d.toLocaleString();
}

export function formatPingHover(p) {
  const parts = [];
  const ts = p && p.ts ? formatIsoDateTime(p.ts) : null;
  if (p && p.code === '200' && typeof p.ms === 'number') {
    parts.push(`${p.ms}ms`);
  } else if (p && p.code === '000') {
    parts.push('timeout');
  } else if (p && p.code != null) {
    parts.push(`HTTP ${p.code}`);
  } else {
    parts.push('ping');
  }
  if (ts && ts !== 'Never') parts.push(ts);
  return parts.join(' • ');
}
