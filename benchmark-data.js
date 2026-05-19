import { canonicalizeModelId, resolveAliasedModelId } from './sources.js'

export const BENCHMARK_BREAKDOWN_SOURCES = {
  'code-arena': {
    title: 'Code Arena',
    domain: 'coding',
    unit: 'elo',
    url: 'https://docs.lmarena.ai/',
  },
  humaneval: {
    title: 'HumanEval',
    domain: 'coding',
    unit: 'ratio',
    url: 'https://github.com/openai/human-eval',
  },
  livecodebench: {
    title: 'LiveCodeBench',
    domain: 'coding',
    unit: 'ratio',
    url: 'https://livecodebench.github.io/',
  },
}

const BENCHMARK_BREAKDOWN_DATA = {
  'z-ai/glm5': [
    { sourceKey: 'code-arena', value: 1546 },
  ],
  'moonshotai/kimi-k2.5': [
    { sourceKey: 'code-arena', value: 1465 },
  ],
  'z-ai/glm4.7': [
    { sourceKey: 'code-arena', value: 1445 },
  ],
  'qwen/qwen3.5-397b-a17b': [
    { sourceKey: 'code-arena', value: 1445 },
  ],
  'deepseek-ai/deepseek-v3.2': [
    { sourceKey: 'code-arena', value: 1410 },
  ],
  'stepfun-ai/step-3.5-flash': [
    { sourceKey: 'code-arena', value: 1385 },
  ],
  'minimax/minimax-m2.5': [
    { sourceKey: 'code-arena', value: 1118 },
  ],
  'openai/gpt-oss-120b': [
    { sourceKey: 'code-arena', value: 1040 },
  ],
  'qwen/qwen3-coder': [
    { sourceKey: 'code-arena', value: 530 },
  ],
  'qwen/qwen3-235b-a22b': [
    { sourceKey: 'humaneval', value: 0.718 },
    { sourceKey: 'livecodebench', value: 0.707 },
  ],
  'qwen/qwen3-32b': [
    { sourceKey: 'livecodebench', value: 0.657 },
  ],
  'meta/llama-4-maverick-17b-128e-instruct': [
    { sourceKey: 'humaneval', value: 0.612 },
    { sourceKey: 'livecodebench', value: 0.434 },
  ],
  'meta/llama-4-scout-17b-16e-instruct': [
    { sourceKey: 'humaneval', value: 0.503 },
    { sourceKey: 'livecodebench', value: 0.328 },
  ],
  'qwen/qwen2.5-coder-32b-instruct': [
    { sourceKey: 'humaneval', value: 0.572 },
    { sourceKey: 'livecodebench', value: 0.314 },
  ],
  'qwen/qwq-32b': [
    { sourceKey: 'livecodebench', value: 0.634 },
  ],
  'microsoft/phi-3.5-mini-instruct': [
    { sourceKey: 'humaneval', value: 0.485 },
  ],
  'microsoft/phi-4-mini-instruct': [
    { sourceKey: 'humaneval', value: 0.640 },
  ],
  'google/gemma-2-9b-it': [
    { sourceKey: 'humaneval', value: 0.366 },
  ],
  'gemma-3-4b-it': [
    { sourceKey: 'humaneval', value: 0.756 },
    { sourceKey: 'livecodebench', value: 0.126 },
  ],
  'gemma-3-12b-it': [
    { sourceKey: 'humaneval', value: 0.838 },
    { sourceKey: 'livecodebench', value: 0.246 },
  ],
  'gemma-3-27b-it': [
    { sourceKey: 'humaneval', value: 0.890 },
    { sourceKey: 'livecodebench', value: 0.297 },
  ],
  'deepseek-ai/deepseek-r1-distill-qwen-32b': [
    { sourceKey: 'livecodebench', value: 0.572 },
  ],
  'deepseek-ai/deepseek-r1-distill-qwen-14b': [
    { sourceKey: 'livecodebench', value: 0.531 },
  ],
  'deepseek-ai/deepseek-r1-distill-qwen-7b': [
    { sourceKey: 'livecodebench', value: 0.376 },
  ],
  'deepseek-ai/deepseek-r1-distill-llama-8b': [
    { sourceKey: 'livecodebench', value: 0.396 },
  ],
  'deepseek-ai/deepseek-v3.1': [
    { sourceKey: 'livecodebench', value: 0.564 },
  ],
  'nvidia/llama-3.1-nemotron-ultra-253b-v1': [
    { sourceKey: 'livecodebench', value: 0.663 },
  ],
}

function formatBenchmarkValue(sourceKey, value) {
  const source = BENCHMARK_BREAKDOWN_SOURCES[sourceKey]
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  if (source?.unit === 'elo') return `${Math.round(numeric)} ELO`
  if (source?.unit === 'ratio') return `${(numeric * 100).toFixed(1)}%`
  return String(numeric)
}

function buildBreakdownLookup() {
  const lookup = new Map()

  for (const [modelId, rows] of Object.entries(BENCHMARK_BREAKDOWN_DATA)) {
    const resolved = resolveAliasedModelId(modelId)
    const { base, unprefixed } = canonicalizeModelId(resolved)
    const keys = new Set([modelId, resolved, base, unprefixed].filter(Boolean))
    const normalizedRows = rows
      .map(row => {
        const source = BENCHMARK_BREAKDOWN_SOURCES[row.sourceKey]
        if (!source) return null
        return {
          ...row,
          sourceTitle: source.title,
          domain: source.domain,
          unit: source.unit,
          url: source.url,
          displayValue: formatBenchmarkValue(row.sourceKey, row.value),
        }
      })
      .filter(Boolean)

    for (const key of keys) {
      if (!lookup.has(key)) lookup.set(key, normalizedRows)
    }
  }

  return lookup
}

const BENCHMARK_BREAKDOWN_LOOKUP = buildBreakdownLookup()

export function getBenchmarkBreakdown(modelId) {
  const raw = typeof modelId === 'string' ? modelId.trim() : ''
  if (!raw) return []
  const resolved = resolveAliasedModelId(raw)
  const { base, unprefixed } = canonicalizeModelId(resolved)
  const rows = BENCHMARK_BREAKDOWN_LOOKUP.get(raw)
    || BENCHMARK_BREAKDOWN_LOOKUP.get(resolved)
    || BENCHMARK_BREAKDOWN_LOOKUP.get(base)
    || BENCHMARK_BREAKDOWN_LOOKUP.get(unprefixed)
    || []
  return rows.map(row => ({ ...row }))
}
