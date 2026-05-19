const CODING_HINTS = /(code|coder|codex|codestral|devstral|software|swe|program)/i
const REASONING_HINTS = /(reason|thinking|r1|qwq|o1|o3|opus|logic)/i
const GENERAL_HINTS = /(assistant|chat|general|help|instruct|gpt|claude|gemini)/i

export const USE_CASE_PROFILES = [
  {
    id: 'all',
    title: 'All',
    description: 'Show every tracked model without a use-case preference.',
  },
  {
    id: 'coding',
    title: 'Coding',
    description: 'Bias toward coding benchmarks, strong benchmark coverage, and useful routing quality.',
  },
  {
    id: 'fast-chat',
    title: 'Fast Chat',
    description: 'Bias toward low latency and open/general routes that are easier to keep online.',
  },
  {
    id: 'long-context',
    title: 'Long Context',
    description: 'Bias toward large context windows and broad general-purpose usage.',
  },
  {
    id: 'frontier-quality',
    title: 'Frontier Quality',
    description: 'Bias toward direct frontier lanes with higher-quality model families.',
  },
  {
    id: 'cheap-open',
    title: 'Cheap Open Lane',
    description: 'Bias toward open/general lanes, free variants, and optional auth setups.',
  },
]

function parseContextWindow(ctx) {
  const raw = String(ctx || '').trim().toLowerCase()
  if (!raw) return 0
  const numeric = Number.parseFloat(raw)
  if (!Number.isFinite(numeric)) return 0
  if (raw.endsWith('m')) return numeric * 1_000_000
  if (raw.endsWith('k')) return numeric * 1_000
  return numeric
}

function getBenchmarkDomains(model) {
  const domains = new Set((model?.benchmarkBreakdown || []).map(row => row.domain).filter(Boolean))
  const haystack = `${model?.label || ''} ${model?.modelId || ''}`.toLowerCase()
  if (domains.size === 0) {
    if (CODING_HINTS.test(haystack)) domains.add('coding')
    if (REASONING_HINTS.test(haystack)) domains.add('reasoning')
    if (domains.size === 0 || GENERAL_HINTS.test(haystack)) domains.add('general')
  }
  return domains
}

export function inferModelCapabilities(model) {
  const domains = getBenchmarkDomains(model)
  const contextWindow = parseContextWindow(model?.ctx)
  const isFast = Number.isFinite(model?.avg) && Number(model.avg) <= 400
  const hasFreeSignal = String(model?.providerCostLabel || '').toLowerCase().includes('free')
    || String(model?.modelId || '').includes(':free')
    || String(model?.providerAuthLabel || '').toLowerCase().includes('optional')

  return {
    domains: [...domains],
    contextWindow,
    fast: isFast,
    longContext: contextWindow >= 200_000,
    frontier: model?.lane === 'frontier',
    open: model?.lane !== 'frontier',
    freeSignal: hasFreeSignal,
    benchmarkCoverage: model?.benchmarkBreakdown?.length || 0,
  }
}

export function getUseCaseFit(model, profileId = 'all') {
  const capabilities = inferModelCapabilities(model)
  if (profileId === 'all') {
    return { score: 0, reasons: [] }
  }

  let score = 0
  const reasons = []
  const benchmarkScore = Number(model?.intell) || 0
  const qos = Number(model?.qos) || 0
  const uptime = Number(model?.uptime) || 0
  const avg = Number.isFinite(model?.avg) ? Number(model.avg) : null

  if (profileId === 'coding') {
    if (capabilities.domains.includes('coding')) {
      score += 35
      reasons.push('Coding benchmark signal')
    }
    score += Math.round(benchmarkScore * 45)
    score += Math.min(20, capabilities.benchmarkCoverage * 8)
    if (qos > 0) score += Math.min(20, Math.round(qos / 4))
  } else if (profileId === 'fast-chat') {
    if (avg != null) {
      score += Math.max(0, 50 - Math.round(avg / 25))
      reasons.push('Low recent latency')
    }
    if (capabilities.open) {
      score += 12
      reasons.push('Open / general lane')
    }
    score += Math.min(25, Math.round(uptime / 4))
  } else if (profileId === 'long-context') {
    if (capabilities.longContext) {
      score += 50
      reasons.push('Long context window')
    }
    score += Math.min(25, Math.round(capabilities.contextWindow / 10000))
    score += Math.round(benchmarkScore * 20)
  } else if (profileId === 'frontier-quality') {
    if (capabilities.frontier) {
      score += 35
      reasons.push('Direct frontier lane')
    }
    score += Math.round(benchmarkScore * 50)
    score += Math.min(15, capabilities.benchmarkCoverage * 6)
  } else if (profileId === 'cheap-open') {
    if (capabilities.open) {
      score += 24
      reasons.push('Open / general lane')
    }
    if (capabilities.freeSignal) {
      score += 28
      reasons.push('Free or optional-auth signal')
    }
    if (avg != null) score += Math.max(0, 20 - Math.round(avg / 80))
    score += Math.min(15, Math.round(uptime / 8))
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons,
  }
}

export function getProfileLabel(profileId = 'all') {
  return USE_CASE_PROFILES.find(profile => profile.id === profileId)?.title || 'All'
}
