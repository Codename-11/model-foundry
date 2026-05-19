export const state = {
  allModels: [],
  searchTerm: '',
  sortState: null,
  openDrawerModelId: null,
  currentRenderedOrder: [],
  activePinnedModelId: null,
  activePinnedProviderKey: null,
  activePinnedRowKeys: [],
  pinningMode: 'canonical',
  telemetryLaneFilter: 'all',
  telemetryShowTracked: false,
  metaLoaded: false,
  logsViewMode: 'history',
  logsAutoRefreshPaused: false,
  qwenOauthSessionId: null,
  qwenOauthPollTimer: null,
  filterRules: { minSweScore: null, excludedProviders: [] },
  chatMessages: [],
  chatInFlight: false,
  chatSelectedModel: 'auto-fastest',
};

export const constants = {
  PROVIDER_ERROR_MAX_AGE_MS: 120 * 60_000,
  CHAT_STORAGE_KEY: 'modelfoundry-chat-v1',
  CHAT_MODEL_STORAGE_KEY: 'modelfoundry-chat-model-v1',
  MODEL_ID_ALIASES: {
    'mimo-v2-omni-free': 'xiaomi/mimo-v2-omni:free',
  },
};
