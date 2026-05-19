const PROVIDER_META = {
  openrouter: {
    category: 'recommended',
    recommendation: 'Best default',
    summary: 'Broadest general-purpose lane with OpenAI-compatible routing and free variants.',
    quickstartLabel: 'OpenRouter (Recommended)',
    quickstartDescription: 'Best general default for ModelFoundry.',
  },
  groq: {
    category: 'recommended',
    recommendation: 'Fastest single provider',
    summary: 'Best fit when you want a very fast single-provider setup instead of breadth.',
    quickstartLabel: 'Groq (Fastest single provider)',
    quickstartDescription: 'Best when latency matters more than provider breadth.',
  },
  'openai-compatible': {
    category: 'recommended',
    recommendation: 'Custom upstream',
    summary: 'Bring your own OpenAI-compatible endpoint and exact model ID.',
    quickstartLabel: 'Custom OpenAI-compatible upstream',
    quickstartDescription: 'Use your own existing OpenAI-compatible provider.',
  },
  anthropic: {
    category: 'frontier',
    recommendation: 'Claude frontier stack',
    summary: 'Direct Claude lane through Anthropic OpenAI SDK compatibility.',
  },
  openai: {
    category: 'frontier',
    recommendation: 'GPT / Codex frontier stack',
    summary: 'Direct OpenAI lane for GPT and Codex models in your paid frontier stack.',
  },
  gemini: {
    category: 'frontier',
    recommendation: 'Gemini frontier stack',
    summary: 'Direct Gemini lane through Google AI OpenAI compatibility.',
  },
  opencode: {
    category: 'optional',
    recommendation: 'OpenCode-specific',
    summary: 'Optional provider lane tied to OpenCode Zen.',
  },
  nvidia: {
    category: 'optional',
    recommendation: 'NVIDIA ecosystem',
    summary: 'Strong optional lane if you already use NVIDIA APIs.',
  },
  cerebras: {
    category: 'optional',
    recommendation: 'Optional speed lane',
    summary: 'Useful optional lane when you want another fast hosted provider.',
  },
  scaleway: {
    category: 'optional',
    recommendation: 'Optional hosted lane',
    summary: 'Useful extra hosted lane when you want more routing diversity.',
  },
  codestral: {
    category: 'optional',
    recommendation: 'Codestral lane',
    summary: 'Useful when you specifically want a Codestral route available.',
  },
  kilocode: {
    category: 'optional',
    recommendation: 'Optional auth',
    summary: 'Optional provider that can run without a key and attach bearer auth when present.',
  },
  googleai: {
    category: 'optional',
    recommendation: 'Gemma lane',
    summary: 'Optional route for Gemma-family access through Google AI.',
  },
  qwencode: {
    category: 'advanced',
    recommendation: 'OAuth setup',
    summary: 'Advanced setup that supports cached OAuth or API-key auth.',
  },
}

const FRONTIER_FAMILIES = [
  {
    key: 'anthropic',
    label: 'Claude',
    title: 'Anthropic Claude',
    family: 'Claude',
    status: 'Direct frontier lane',
    summary: 'Use Claude as a separate paid frontier lane instead of mixing it into the open/default pool.',
    connectionMode: 'native',
    currentProviderKey: 'anthropic',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    officialDocsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
  },
  {
    key: 'openai',
    label: 'OpenAI',
    title: 'OpenAI GPT / Codex',
    family: 'GPT / Codex',
    status: 'Direct frontier lane',
    summary: 'Use OpenAI directly for GPT and Codex models without hiding them behind the generic custom-upstream lane.',
    connectionMode: 'native',
    currentProviderKey: 'openai',
    apiKeyEnv: 'OPENAI_API_KEY',
    officialDocsUrl: 'https://platform.openai.com/docs/models',
  },
  {
    key: 'gemini',
    label: 'Gemini',
    title: 'Google Gemini',
    family: 'Gemini',
    status: 'Direct frontier lane',
    summary: 'Use Gemini as a dedicated frontier lane, separate from the Gemma open-model provider pool.',
    connectionMode: 'native',
    currentProviderKey: 'gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
    officialDocsUrl: 'https://ai.google.dev/gemini-api/docs/models/gemini',
  },
]

const FRONTIER_FAMILY_MAP = Object.fromEntries(FRONTIER_FAMILIES.map(family => [family.key, family]))

const DEFAULT_META = {
  category: 'advanced',
  recommendation: 'Advanced',
  summary: 'Advanced provider lane for custom or power-user setups.',
}

const PROVIDER_SETUP_META = {
  openrouter: {
    authLabel: 'API key required',
    costLabel: 'Free variants',
    setupHint: 'Best default for most setups. OpenRouter still needs its own API key even when you use :free variants.',
  },
  groq: {
    authLabel: 'API key required',
    costLabel: 'Optional hosted',
    setupHint: 'Fast hosted lane. Add a Groq key, then enable it when you want a low-latency general lane.',
  },
  cerebras: {
    authLabel: 'API key required',
    costLabel: 'Optional hosted',
    setupHint: 'Hosted general lane that needs a Cerebras API key before it can participate in routing.',
  },
  nvidia: {
    authLabel: 'API key required',
    costLabel: 'Optional hosted',
    setupHint: 'Hosted NVIDIA lane. Add your NIM API key first, then enable it when you want it in the general pool.',
  },
  openai: {
    defaultBaseUrl: 'https://api.openai.com/v1/',
    defaultModelId: 'gpt-5.1',
    defaultModelLabel: 'GPT-5.1',
    authLabel: 'API key required',
    costLabel: 'Frontier paid',
    setupHint: 'Direct paid OpenAI lane. Add an OpenAI API key and leave the model blank to use the recommended default.',
  },
  anthropic: {
    defaultBaseUrl: 'https://api.anthropic.com/v1/',
    defaultModelId: 'claude-sonnet-4-20250514',
    defaultModelLabel: 'Claude Sonnet 4',
    authLabel: 'API key required',
    costLabel: 'Frontier paid',
    setupHint: 'Direct paid Claude lane. Add an Anthropic API key and leave the model blank to use the recommended default.',
  },
  gemini: {
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModelId: 'gemini-2.5-pro',
    defaultModelLabel: 'Gemini 2.5 Pro',
    authLabel: 'API key required',
    costLabel: 'Frontier paid',
    setupHint: 'Direct paid Gemini lane. Add a Gemini or Google AI key and leave the model blank to use the recommended default.',
  },
  'openai-compatible': {
    defaultBaseUrl: '',
    defaultModelId: '',
    authLabel: 'Depends on upstream',
    costLabel: 'Custom upstream',
    setupHint: 'Bring your own OpenAI-compatible endpoint. You choose the URL, auth, and exact model ID.',
  },
  opencode: {
    authLabel: 'API key optional',
    costLabel: 'Optional hosted',
    setupHint: 'Can work without a key and attach bearer auth when present.',
  },
  kilocode: {
    authLabel: 'API key optional',
    costLabel: 'Optional hosted',
    setupHint: 'Can run without a key, or use bearer auth when you add one.',
  },
  googleai: {
    authLabel: 'API key required',
    costLabel: 'Optional hosted',
    setupHint: 'Gemma/open-model lane through Google AI. This is separate from the paid Gemini frontier lane.',
  },
  qwencode: {
    authLabel: 'OAuth or API key',
    costLabel: 'OAuth setup',
    setupHint: 'Use cached Qwen OAuth credentials or add an API key directly.',
  },
  codestral: {
    authLabel: 'API key required',
    costLabel: 'Optional hosted',
    setupHint: 'Hosted Codestral lane. Add a key, then enable it when you want it in routing.',
  },
  scaleway: {
    authLabel: 'API key required',
    costLabel: 'Optional hosted',
    setupHint: 'Hosted general lane. Add a Scaleway key first, then enable it when you want extra diversity.',
  },
}

const DEFAULT_SETUP_META = {
  defaultBaseUrl: null,
  defaultModelId: null,
  defaultModelLabel: null,
  authLabel: 'API key required',
  costLabel: 'Optional hosted',
  setupHint: 'Add an API key first, then enable this lane when you want it participating in routing.',
}

export function getProviderMeta(providerKey) {
  return PROVIDER_META[providerKey] || getFrontierFamilyMeta(providerKey) || DEFAULT_META
}

export function getProviderSetupMeta(providerKey) {
  return {
    ...DEFAULT_SETUP_META,
    ...(PROVIDER_SETUP_META[providerKey] || {}),
  }
}

export function getProviderCategoryRank(category) {
  if (category === 'recommended') return 0
  if (category === 'frontier') return 1
  if (category === 'optional') return 2
  return 3
}

export function getRecommendedProviderKey() {
  return 'openrouter'
}

export function getQuickstartProviderChoices() {
  return [
    {
      value: 'openrouter',
      label: PROVIDER_META.openrouter.quickstartLabel,
      description: PROVIDER_META.openrouter.quickstartDescription,
    },
    {
      value: 'groq',
      label: PROVIDER_META.groq.quickstartLabel,
      description: PROVIDER_META.groq.quickstartDescription,
    },
    {
      value: 'openai-compatible',
      label: PROVIDER_META['openai-compatible'].quickstartLabel,
      description: PROVIDER_META['openai-compatible'].quickstartDescription,
    },
    {
      value: 'advanced',
      label: 'Advanced: configure multiple providers',
      description: 'Walk the full provider list and optional integrations.',
    },
  ]
}

export function parseQuickstartProviderChoice(answer) {
  const raw = String(answer || '').trim().toLowerCase()
  if (!raw || raw === '1' || raw === 'openrouter') return 'openrouter'
  if (raw === '2' || raw === 'groq') return 'groq'
  if (raw === '3' || raw === 'openai-compatible' || raw === 'openai' || raw === 'custom') return 'openai-compatible'
  if (raw === '4' || raw === 'advanced') return 'advanced'
  return 'openrouter'
}

export function getFrontierFamilies() {
  return FRONTIER_FAMILIES.map(item => ({
    ...item,
    label: item.label || item.title,
  }))
}

export function getFrontierFamilyMeta(providerKey) {
  const family = FRONTIER_FAMILY_MAP[providerKey]
  return family ? { ...family, label: family.label || family.title } : null
}

export function buildProviderCatalog(config = null) {
  const isFamilyConfigured = family => {
    if (family.currentProviderKey && config?.apiKeys?.[family.currentProviderKey]) return true
    if (family.apiKeyEnv && process.env[family.apiKeyEnv]) return true
    if (family.currentProviderKey === 'gemini' && process.env.GOOGLE_API_KEY) return true
    return false
  }

  return {
    version: 1,
    recommendedDefault: getRecommendedProviderKey(),
    sections: [
      {
        id: 'recommended',
        title: 'Recommended',
        description: 'Best first-run lanes for most setups.',
        providers: Object.entries(PROVIDER_META)
          .filter(([, meta]) => meta.category === 'recommended')
          .map(([key, meta]) => ({ key, ...meta })),
      },
      {
        id: 'frontier',
        title: 'Frontier',
        description: 'Claude, OpenAI GPT/Codex, and Gemini should be shown separately from the free/open router pool.',
        families: getFrontierFamilies().map(family => ({
          ...family,
          configured: isFamilyConfigured(family),
          availableInConfig: family.currentProviderKey
            ? !!config?.providers?.[family.currentProviderKey] || !!config?.apiKeys?.[family.currentProviderKey]
            : false,
        })),
      },
      {
        id: 'optional',
        title: 'Optional Lanes',
        description: 'Useful add-ons once the main path is working.',
        providers: Object.entries(PROVIDER_META)
          .filter(([, meta]) => meta.category === 'optional')
          .map(([key, meta]) => ({ key, ...meta })),
      },
      {
        id: 'advanced',
        title: 'Advanced',
        description: 'Power-user or custom setups.',
        providers: Object.entries(PROVIDER_META)
          .filter(([, meta]) => meta.category === 'advanced')
          .map(([key, meta]) => ({ key, ...meta })),
      },
    ],
  }
}
