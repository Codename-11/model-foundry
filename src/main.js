import './styles.css';
import { registerChat } from './app/chat.js';
import { registerLogs } from './app/logs.js';
import { registerSettings } from './app/settings.js';
import { getBenchmarkBreakdown } from '../benchmark-data.js';
import { USE_CASE_PROFILES, getProfileLabel, getUseCaseFit, inferModelCapabilities } from './app/modelProfiles.js';
import { constants, state as appState } from './app/state.js';
import { MODELS, sources } from '../sources.js';
import {
  BENCHMARK_SCORE_DESCRIPTION,
  BENCHMARK_SCORE_LABEL,
  BENCHMARK_SCORE_PROVENANCE,
  BENCHMARK_SOURCE_GROUPS,
} from './app/benchmarkMeta.js';
import {
  escapeHtml,
  formatIsoDateTime,
  formatPingHover,
  getBenchmarkDisplayValue,
  getBenchmarkSortValue,
  getBenchmarkTableDisplayValue,
  getPingAnimClass,
  getPingSpeed,
  getQosColor,
  getQosDisplayValue,
} from './app/utils.js';

    let allModels = [];
    let searchTerm = '';
    // null = default multi-sort; otherwise { col: string, dir: 'asc'|'desc' }
    let sortState = null;
    let openDrawerModelId = null;
    let openDrawerRowKey = null;
    let currentRenderedOrder = [];
    let activePinnedModelId = null; // tracks the current pinned selection key
    let activePinnedProviderKey = null;
    let activePinnedRowKeys = []; // resolved pinned rows from server/client
    let compareRowKeys = [];
    let catalogModels = [];
    let latestProviders = [];
    let catalogSearchTerm = '';
    let catalogLane = 'all';
    let catalogView = 'table';
    let catalogSort = 'best';
    let catalogProfile = 'all';
    let catalogFilterChips = new Set();
    window.isTableHovered = false;
    let metaLoaded = false;
    const PROVIDER_ERROR_MAX_AGE_MS = constants.PROVIDER_ERROR_MAX_AGE_MS;
    const MODEL_ID_ALIASES = constants.MODEL_ID_ALIASES;
    const FRONTIER_PROVIDER_KEYS = new Set(['anthropic', 'openai', 'gemini']);
    const FRONTIER_FAMILY_NAMES = ['Anthropic Claude', 'OpenAI GPT / Codex', 'Google Gemini'];

    const app = {
      state: appState,
      fetchData,
      getProviderErrorMaxAgeMs: () => PROVIDER_ERROR_MAX_AGE_MS,
      setPinningMode: mode => {
        appState.pinningMode = mode === 'exact' ? 'exact' : 'canonical';
      },
      setFilterRules: nextRules => {
        appState.filterRules = {
          minSweScore: nextRules?.minSweScore ?? null,
          excludedProviders: Array.isArray(nextRules?.excludedProviders) ? nextRules.excludedProviders : [],
        };
      },
    };
    Object.defineProperty(appState, 'allModels', {
      configurable: true,
      enumerable: true,
      get: () => allModels,
      set: value => {
        allModels = value;
      }
    });

    registerChat(app);
    registerLogs(app);
    registerSettings(app);

    const {
      clearChat,
      handleChatInputKeydown,
      initializeChat,
      onChatModelChange,
      renderChatTranscript,
      scrollChatToBottom,
      sendChatMessage,
      updateChatModelOptions,
    } = app;
    const {
      applyProviderDefaults,
      copyConfigTokenFromBox,
      deleteProviderKey,
      exportConfigTokenToBox,
      hideProviderCard,
      importConfigTokenFromBox,
      loadSettings,
      revealProviderCard,
      saveAutoUpdateSettings,
      saveFilterRules,
      setQwenLoginStatus,
      loadLogs,
      setLogsViewMode,
      startQwenOAuthLogin,
      switchSettingsPanel,
      toggleLogCard,
      toggleLogsAutoRefresh,
      toggleProviderCard,
      updateLogsPauseButton,
      updatePinningMode,
      updateProvider,
      updateProviderBaseUrl,
      updateProviderBearerAuth,
      updateProviderCatalogVisibility,
      updateProviderKey,
      updateProviderModelId,
      updateProviderPingInterval,
    } = app;



    async function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById(`tab-${tab}`).classList.add('active');

      document.getElementById('models-view').style.display = tab === 'models' ? 'block' : 'none';
      document.getElementById('catalog-view').style.display = tab === 'catalog' ? 'block' : 'none';
      document.getElementById('chat-view').style.display = tab === 'chat' ? 'block' : 'none';
      document.getElementById('logs-view').style.display = tab === 'logs' ? 'block' : 'none';
      document.getElementById('settings-view').style.display = tab === 'settings' ? 'block' : 'none';
      document.getElementById('setup-view').style.display = tab === 'setup' ? 'block' : 'none';

      if (tab === 'settings') {
        switchSettingsPanel('overview');
        loadSettings();
      } else if (tab === 'logs') {
        loadLogs(true);
      } else if (tab === 'chat') {
        renderChatTranscript();
        scrollChatToBottom();
      } else if (tab === 'catalog') {
        renderCatalog();
      }
    }

    function bindTabNavigation() {
      document.querySelectorAll('.tab[data-tab]').forEach(tab => {
        tab.addEventListener('click', () => {
          const targetTab = tab.dataset.tab;
          if (targetTab) switchTab(targetTab);
        });
      });
    }

    function getModelLane(model) {
      return FRONTIER_PROVIDER_KEYS.has(model.providerKey) ? 'frontier' : 'general';
    }

    function getLaneLabel(lane) {
      return lane === 'frontier' ? 'Frontier' : 'Open / General';
    }

    function setTelemetryLane(lane) {
      appState.telemetryLaneFilter = lane === 'frontier' ? 'frontier' : lane === 'all' ? 'all' : 'general';
      document.querySelectorAll('.telemetry-lane-btn').forEach(button => {
        const isActive = button.id === `lane-filter-${appState.telemetryLaneFilter}`;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      render(true);
    }

    function syncTelemetryTrackedToggle() {
      const toggle = document.getElementById('tracked-rows-toggle');
      if (toggle) toggle.checked = appState.telemetryShowTracked === true;
    }

    function setTelemetryTrackedVisibility(showTracked) {
      appState.telemetryShowTracked = showTracked === true;
      syncTelemetryTrackedToggle();
      render(true);
    }

    function parseContextWindow(ctx) {
      const raw = String(ctx || '').trim().toLowerCase();
      if (!raw) return 0;
      const numeric = Number.parseFloat(raw);
      if (!Number.isFinite(numeric)) return 0;
      if (raw.endsWith('m')) return numeric * 1_000_000;
      if (raw.endsWith('k')) return numeric * 1_000;
      return numeric;
    }

    function isTrackedOnlyModel(model) {
      return !model?.active && (!Array.isArray(model?.pings) || model.pings.length === 0);
    }

    function isOperationalTelemetryModel(model) {
      if (!model) return false;
      if (isTrackedOnlyModel(model)) return false;
      if (model.status === 'disabled' || model.status === 'banned' || model.status === 'excluded') return false;
      return true;
    }

    function getTelemetryDataset(models, includeTracked = appState.telemetryShowTracked === true) {
      return includeTracked ? [...models] : models.filter(isOperationalTelemetryModel);
    }

    function getAvailabilityDisplay(model) {
      if (isTrackedOnlyModel(model)) return 'Not live yet';
      if (!Number.isFinite(Number(model?.uptime))) return '—';
      return `${Number(model.uptime) || 0}%`;
    }

    function formatRouteLatency(model) {
      if (isTrackedOnlyModel(model)) return 'Not live yet';
      if (model?.status === 'noauth') return 'Needs auth';
      if (model?.status === 'disabled') return 'Disabled';
      return formatLatencyValue(model?.avg);
    }

    function getQosDisplayForModel(model) {
      if (isTrackedOnlyModel(model)) return '—';
      return String(getQosDisplayValue(model?.qos));
    }

    function getCatalogAuthKind(model) {
      const label = String(model?.providerAuthLabel || '').toLowerCase();
      if (!label) return 'required';
      if (label.includes('optional')) return 'optional';
      return 'required';
    }

    function getBenchmarkDomains(model) {
      return new Set(inferModelCapabilities(model).domains);
    }

    function getCatalogBestForTags(model) {
      const tags = [];
      const capabilities = inferModelCapabilities(model);
      const domains = new Set(capabilities.domains);
      if (domains.has('coding')) tags.push('Coding');
      if (domains.has('general')) tags.push('General use');
      if (domains.has('reasoning')) tags.push('Reasoning');
      if (capabilities.longContext) tags.push('Long context');
      if (capabilities.fast) tags.push('Fast inference');
      if ((model?.benchmarkBreakdown?.length || 0) > 0) tags.push('Benchmarked');
      if (model?.catalogSeeded) tags.push('Tracked default');
      if (capabilities.freeSignal) {
        tags.push('Free variants');
      }
      if (model?.lane === 'frontier') tags.push('Frontier paid');
      else tags.push('Open lane');
      return [...new Set(tags)].slice(0, 3);
    }

    function matchesCatalogChip(model, chip) {
      const sourceCount = model?.benchmarkBreakdown?.length || 0;
      const authKind = getCatalogAuthKind(model);
      const domains = getBenchmarkDomains(model);
      const contextWindow = parseContextWindow(model?.ctx);
      if (chip === 'active') return Boolean(model?.active);
      if (chip === 'configured') return Boolean(model?.enabled);
      if (chip === 'benchmarked') return sourceCount > 0;
      if (chip === 'missing') return sourceCount === 0;
      if (chip === 'needs-key') return authKind === 'required';
      if (chip === 'no-key') return authKind === 'optional';
      if (chip === 'coding') return domains.has('coding');
      if (chip === 'general') return domains.has('general');
      if (chip === 'reasoning') return domains.has('reasoning');
      if (chip === 'long-context') return contextWindow >= 200_000;
      return true;
    }

    function getCatalogStateLabel(model) {
      if (model?.active) return `Live now${model?.status ? ` (${model.status})` : ''}`;
      if (model?.enabled) return 'Configured, not live';
      if (model?.discovered) return 'Discovered route';
      if (model?.catalogSeeded) return 'Tracked default';
      return 'Tracked only';
    }

    function getCatalogStateClass(model) {
      if (model?.active) return 'live';
      if ((model?.benchmarkBreakdown?.length || 0) === 0) return 'missing';
      return '';
    }

    function getCatalogSortComparator(sortKey = catalogSort) {
      if (sortKey === 'benchmark') {
        return (a, b) => {
          const scoreDiff = getBenchmarkSortValue(b.intell) - getBenchmarkSortValue(a.intell);
          if (scoreDiff !== 0) return scoreDiff;
          return (b.benchmarkBreakdown?.length || 0) - (a.benchmarkBreakdown?.length || 0);
        };
      }
      if (sortKey === 'ping') {
        return (a, b) => {
          const aPing = Number.isFinite(a.avg) ? Number(a.avg) : Number.POSITIVE_INFINITY;
          const bPing = Number.isFinite(b.avg) ? Number(b.avg) : Number.POSITIVE_INFINITY;
          if (aPing !== bPing) return aPing - bPing;
          return Number(b.active) - Number(a.active);
        };
      }
      if (sortKey === 'availability') {
        return (a, b) => (Number(b.uptime) || 0) - (Number(a.uptime) || 0);
      }
      if (sortKey === 'benchmarked') {
        return (a, b) => {
          const sourceDiff = (b.benchmarkBreakdown?.length || 0) - (a.benchmarkBreakdown?.length || 0);
          if (sourceDiff !== 0) return sourceDiff;
          return getBenchmarkSortValue(b.intell) - getBenchmarkSortValue(a.intell);
        };
      }
      if (sortKey === 'az') {
        return (a, b) => String(a.label || '').localeCompare(String(b.label || ''));
      }
      return (a, b) => {
        if (catalogProfile !== 'all') {
          const profileDiff = getUseCaseFit(b, catalogProfile).score - getUseCaseFit(a, catalogProfile).score;
          if (profileDiff !== 0) return profileDiff;
        }
        const activeDiff = Number(b.active) - Number(a.active);
        if (activeDiff !== 0) return activeDiff;
        const enabledDiff = Number(b.enabled) - Number(a.enabled);
        if (enabledDiff !== 0) return enabledDiff;
        const qosDiff = (Number(b.qos) || 0) - (Number(a.qos) || 0);
        if (qosDiff !== 0) return qosDiff;
        const benchmarkDiff = (b.benchmarkBreakdown?.length || 0) - (a.benchmarkBreakdown?.length || 0);
        if (benchmarkDiff !== 0) return benchmarkDiff;
        const scoreDiff = getBenchmarkSortValue(b.intell) - getBenchmarkSortValue(a.intell);
        if (scoreDiff !== 0) return scoreDiff;
        const uptimeDiff = (Number(b.uptime) || 0) - (Number(a.uptime) || 0);
        if (uptimeDiff !== 0) return uptimeDiff;
        const aPing = Number.isFinite(a.avg) ? Number(a.avg) : Number.POSITIVE_INFINITY;
        const bPing = Number.isFinite(b.avg) ? Number(b.avg) : Number.POSITIVE_INFINITY;
        if (aPing !== bPing) return aPing - bPing;
        return String(a.label || '').localeCompare(String(b.label || ''));
      };
    }

    function getCatalogFilteredRows() {
      let rows = [...catalogModels];
      if (catalogLane !== 'all') {
        rows = rows.filter(model => model.lane === catalogLane);
      }
      if (catalogSearchTerm) {
        rows = rows.filter(model =>
          String(model.label || '').toLowerCase().includes(catalogSearchTerm)
          || String(model.modelId || '').toLowerCase().includes(catalogSearchTerm)
          || String(model.providerKey || '').toLowerCase().includes(catalogSearchTerm)
          || String(model.providerName || '').toLowerCase().includes(catalogSearchTerm)
        );
      }
      if (catalogFilterChips.size > 0) {
        rows = rows.filter(model => [...catalogFilterChips].every(chip => matchesCatalogChip(model, chip)));
      }
      return rows.sort(getCatalogSortComparator());
    }

    function syncCatalogProfileControls() {
      document.querySelectorAll('.catalog-profile-chip').forEach(button => {
        const active = button.dataset.profile === catalogProfile;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      const blurb = document.getElementById('catalog-profile-blurb');
      if (blurb) {
        const selected = USE_CASE_PROFILES.find(profile => profile.id === catalogProfile);
        blurb.textContent = selected?.description || USE_CASE_PROFILES[0].description;
      }
    }

    function setCatalogProfile(nextProfile = 'all') {
      catalogProfile = USE_CASE_PROFILES.some(profile => profile.id === nextProfile) ? nextProfile : 'all';
      syncCatalogProfileControls();
      renderCatalog();
    }

    function groupCatalogRows(rows) {
      if (catalogLane === 'all') {
        return [
          { key: 'frontier', title: 'Frontier Stack', copy: 'Direct Anthropic, OpenAI, and Gemini style lanes kept separate from the general pool.', rows: rows.filter(model => model.lane === 'frontier' && !model.discovered) },
          { key: 'general', title: 'Open / General', copy: 'Open routers, open-weight lanes, and general provider catalogs.', rows: rows.filter(model => model.lane !== 'frontier' && !model.discovered) },
          { key: 'discovered', title: 'Discovered Live Only', copy: 'Rows surfaced live that are not part of the current static catalog yet.', rows: rows.filter(model => model.discovered) },
        ].filter(group => group.rows.length > 0);
      }

      return [
        { key: 'active', title: 'Active / Configured', copy: 'Routes already configured or currently responding.', rows: rows.filter(model => (model.active || model.enabled) && !model.discovered) },
        { key: 'catalog', title: 'Tracked Catalog', copy: 'Known catalog entries that are not enabled yet.', rows: rows.filter(model => !model.active && !model.enabled && !model.discovered) },
        { key: 'discovered', title: 'Discovered Live Only', copy: 'Rows discovered dynamically outside the static catalog.', rows: rows.filter(model => model.discovered) },
      ].filter(group => group.rows.length > 0);
    }

    function getOpenDrawerModel() {
      if (openDrawerRowKey) {
        return allModels.find(model => getModelRowKey(model) === openDrawerRowKey)
          || catalogModels.find(model => getModelRowKey(model) === openDrawerRowKey)
          || null;
      }
      if (!openDrawerModelId) return null;
      return allModels.find(model => model.modelId === openDrawerModelId)
        || catalogModels.find(model => model.modelId === openDrawerModelId)
        || null;
    }

    function buildCatalogModels(liveModels, providerMap, decorateModel) {
      const liveMap = new Map(liveModels.map(model => [getModelRowKey(model), model]));
      const knownRowKeys = new Set();
      const rows = [];

      for (const [modelId, label, intell, ctx, providerKey] of MODELS) {
        const rowKey = getModelRowKey(providerKey, modelId);
        knownRowKeys.add(rowKey);
        const liveModel = liveMap.get(rowKey);

        if (liveModel) {
          rows.push({
            ...liveModel,
            active: true,
            discovered: false,
            isCatalogOnly: false,
          });
          continue;
        }

        const numericIntell = Number(intell);
        rows.push(decorateModel({
          modelId,
          label,
          intell,
          isEstimatedScore: !(Number.isFinite(numericIntell) && numericIntell > 0),
          ctx,
          providerKey,
          providerName: providerMap.get(providerKey)?.name || sources[providerKey]?.name || providerKey,
          benchmarkBreakdown: getBenchmarkBreakdown(modelId),
          active: false,
          discovered: false,
          enabled: Boolean(providerMap.get(providerKey)?.enabled),
          status: null,
          qos: 0,
          avg: null,
          uptime: 0,
          pings: [],
        }, { isCatalogOnly: true }));
      }

      for (const provider of providerMap.values()) {
        if (provider?.category !== 'frontier' || !provider?.defaultModelId) continue;
        if (provider?.catalogVisible === false) continue;
        const rowKey = getModelRowKey(provider.key, provider.defaultModelId);
        if (knownRowKeys.has(rowKey)) continue;

        knownRowKeys.add(rowKey);
        const liveModel = liveMap.get(rowKey);
        if (liveModel) {
          rows.push({
            ...liveModel,
            active: true,
            discovered: false,
            isCatalogOnly: false,
          });
          continue;
        }

        rows.push(decorateModel({
          modelId: provider.defaultModelId,
          label: provider.defaultModelLabel || provider.name,
          intell: null,
          isEstimatedScore: true,
          ctx: '',
          providerKey: provider.key,
          providerName: provider.name || provider.key,
          benchmarkBreakdown: getBenchmarkBreakdown(provider.defaultModelId),
          active: false,
          discovered: false,
          enabled: Boolean(provider.enabled),
          status: null,
          qos: 0,
          avg: null,
          uptime: 0,
          pings: [],
          providerAuthLabel: provider.authLabel || null,
          providerCostLabel: provider.costLabel || null,
          providerSetupHint: provider.setupHint || null,
          catalogSeeded: true,
        }, { isCatalogOnly: true }));
      }

      for (const liveModel of liveModels) {
        const rowKey = getModelRowKey(liveModel);
        if (knownRowKeys.has(rowKey)) continue;
        rows.push({
          ...liveModel,
          benchmarkBreakdown: Array.isArray(liveModel.benchmarkBreakdown) ? liveModel.benchmarkBreakdown : getBenchmarkBreakdown(liveModel.modelId),
          active: true,
          discovered: true,
          isCatalogOnly: false,
        });
      }

      return rows.filter(model => providerMap.get(model.providerKey)?.catalogVisible !== false);
    }

    async function fetchData() {
      try {
        if (!metaLoaded) {
          loadMeta();
        }
        const [modelsRes, configRes] = await Promise.all([
          fetch('/api/models'),
          fetch('/api/config'),
        ]);
        const data = await modelsRes.json();
        const providers = await configRes.json();
        latestProviders = Array.isArray(providers) ? providers : [];
        const providerMap = new Map(latestProviders.map(provider => [provider.key, provider]));

        // Calculate QoS for each model
        const decorateModel = (m, fallback = {}) => {
          let isRateLimited = false;
          let rateLimitResetMs = 0;
          if (m.rateLimit) {
            const now = Date.now();
            // Flag as rate-limited when the actual proxied prompt got a 429
            if (m.rateLimit.wasRateLimited === true) {
              isRateLimited = true;
              rateLimitResetMs = Math.max(
                m.rateLimit.resetRequestsAt ? Math.max(0, m.rateLimit.resetRequestsAt - now) : 0,
                m.rateLimit.resetTokensAt ? Math.max(0, m.rateLimit.resetTokensAt - now) : 0
              );
            }
            // Also flag when credits are exhausted (e.g. OpenRouter free tier).
            // Credits are an account-level balance (not a sliding window), so
            // creditRemaining <= 0 is an authoritative signal.
            if (m.rateLimit.creditLimit > 0 && m.rateLimit.creditRemaining != null && m.rateLimit.creditRemaining <= 0) {
              isRateLimited = true;
              if (m.rateLimit.creditResetAt && m.rateLimit.creditResetAt > now) {
                rateLimitResetMs = Math.max(rateLimitResetMs, m.rateLimit.creditResetAt - now);
              }
            }
          }

          const providerMeta = providerMap.get(m.providerKey) || null;
          const lane = getModelLane(m);
          return {
            ...m,
            lane,
            laneLabel: getLaneLabel(lane),
            providerName: providerMeta?.name || m.providerKey,
            providerCategory: providerMeta?.category || null,
            providerAuthLabel: providerMeta?.authLabel || null,
            providerCostLabel: providerMeta?.costLabel || null,
            providerSetupHint: providerMeta?.setupHint || null,
            enabled: providerMeta?.enabled ?? m.enabled ?? false,
            qos: m.qos || 0,
            isRateLimited,
            ...fallback,
          };
        };

        allModels = data.models.map(model => decorateModel(model));
        catalogModels = buildCatalogModels(allModels, providerMap, decorateModel);

        compareRowKeys = compareRowKeys.filter(rowKey => catalogModels.some(model => getModelRowKey(model) === rowKey));

        setActivePinnedModel(data.pinnedModelId, data.pinnedProviderKey, data.pinnedRowKeys, data.pinningMode);
        updateChatModelOptions(allModels);

        // Populate Provider Checkboxes
        app.renderProviderFilterGroup(providers);

        render(); // triggers automatic (non-user) layout pass
        renderComparePanel();
        renderCatalog();
        updateKPIs(allModels, data.best);
        renderTelemetryStatusBanner();
        if (openDrawerModelId) {
          const m = getOpenDrawerModel();
          if (m) updateDrawerContent(m);
        }
        // Live-update logs if that tab is currently active
        if (document.getElementById('logs-view').style.display !== 'none') {
          loadLogs();
        }
        // Live-update providers if that tab is currently active
        if (document.getElementById('settings-view').style.display !== 'none') {
          loadSettings();
        }
      } catch (e) {
        console.error('Fetch error:', e);
      }
    }

    async function loadMeta() {
      try {
        const res = await fetch('/api/meta');
        if (!res.ok) throw new Error('meta fetch failed');
        const meta = await res.json();
        if (!meta || !meta.version || meta.version === 'unknown') throw new Error('meta missing version');
        const versionEl = document.getElementById('dashboard-version');
        const pillEl = document.getElementById('update-pill');
        versionEl.textContent = `v${meta.version}`;

        if (meta.autoUpdate) {
          const interval = Number(meta.autoUpdate.intervalHours) > 0 ? Number(meta.autoUpdate.intervalHours) : 24;
          const state = meta.autoUpdate.enabled === false ? 'off' : 'on';
          versionEl.title = `Auto-update: ${state} (${interval}h)`;
        }

        if (pillEl) {
          if (meta.updateAvailable && meta.latestVersion) {
            pillEl.innerHTML = `<span class="update-badge" onclick="startManualUpdate('${meta.latestVersion}')">✨ Update to v${meta.latestVersion}</span>`;
            pillEl.style.display = 'inline-flex';
            pillEl.title = `Current: v${meta.version}`;
          } else {
            pillEl.style.display = 'none';
          }
        }

        metaLoaded = true;
      } catch {
        const target = document.getElementById('dashboard-version');
        if (target) target.textContent = 'Loading...';
        setTimeout(() => {
          if (!metaLoaded) loadMeta();
        }, 5000);
      }
    }

    async function startManualUpdate(targetVersion) {
      if (!confirm(`Are you sure you want to update to v${targetVersion}? The server will restart and be unavailable for about 60 seconds.`)) {
        return;
      }

      const overlay = document.getElementById('update-overlay');
      const progressBar = document.getElementById('update-progress-bar');
      const percentText = document.getElementById('update-percent-text');
      const statusText = document.getElementById('update-status-text');

      overlay.style.display = 'flex';
      
      // Start the progress animation (0 to 99% over 60 seconds)
      let progress = 1;
      const startTime = Date.now();
      const duration = 60000; // 60 seconds

      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed >= duration) {
          progress = 99;
          statusText.textContent = 'Finalizing installation...';
        } else {
          // Non-linear progress (slows down as it reaches 99%)
          progress = 1 + (98 * (1 - Math.pow(1 - elapsed / duration, 2)));
        }
        
        const rounded = Math.floor(progress);
        progressBar.style.width = `${rounded}%`;
        percentText.textContent = `${rounded}%`;
      }, 200);

      try {
        // Trigger the update on the server
        const res = await fetch('/api/autoupdate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ forceCheck: true })
        });
        
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Server rejected update request.');
        }

        const data = await res.json();
        if (data.updateResult && data.updateResult.ok === false) {
          throw new Error(data.updateResult.message);
        }

        // Now we wait for the server to come back online
        statusText.textContent = 'Update applied. Waiting for server to restart...';
        pollServerRestart(progressInterval);
        
      } catch (err) {
        clearInterval(progressInterval);
        overlay.style.display = 'none';
        alert(`Update failed: ${err.message}`);
      }
    }

    async function pollServerRestart(progressInterval) {
      const progressBar = document.getElementById('update-progress-bar');
      const percentText = document.getElementById('update-percent-text');
      const statusText = document.getElementById('update-status-text');
      let sawDowntime = false;
      let healthyResponsesAfterDowntime = 0;
      
      const checkServer = async () => {
        try {
          const res = await fetch('/api/meta', { cache: 'no-store' });
          if (res.ok) {
            const meta = await res.json();
            if (meta && meta.version) {
              if (!sawDowntime) {
                statusText.textContent = 'Waiting for current server to shut down...';
                return false;
              }

              healthyResponsesAfterDowntime += 1;
              statusText.textContent = healthyResponsesAfterDowntime >= 2
                ? 'Successfully updated! Reloading...'
                : 'Server is back. Confirming stability...';

              if (healthyResponsesAfterDowntime >= 2) {
                clearInterval(progressInterval);
                progressBar.style.width = '100%';
                percentText.textContent = '100%';
                setTimeout(() => window.location.reload(), 1500);
                return true;
              }
            }
          }
        } catch (e) {
          sawDowntime = true;
          healthyResponsesAfterDowntime = 0;
          statusText.textContent = 'Server is restarting...';
        }
        return false;
      };

      // Give the current process a brief head start to exit before probing.
      setTimeout(() => {
        const pollInterval = setInterval(async () => {
          const backOnline = await checkServer();
          if (backOnline) clearInterval(pollInterval);
        }, 2000);

        // Stop after 3 minutes total
        setTimeout(() => {
          clearInterval(pollInterval);
          clearInterval(progressInterval);
          statusText.textContent = 'Update taking longer than expected. Please refresh manually.';
          statusText.style.color = 'var(--error)';
        }, 180000);
      }, 2500);
    }

    function calculateBestModel(models) {
      const candidates = models.filter(m => m.status === 'up' && m.avg !== Infinity);
      if (candidates.length === 0) return null;

      return [...candidates].sort((a, b) => (b.qos || 0) - (a.qos || 0))[0];
    }

    function canonicalizeClientModelId(modelId) {
      const raw = typeof modelId === 'string' ? modelId.trim() : '';
      const resolved = MODEL_ID_ALIASES[raw] || raw;
      const base = resolved.replace(/(?::[a-z0-9-]+)+$/i, '');
      const unprefixed = base.includes('/') ? base.split('/').pop() : base;
      return { base, unprefixed };
    }

    function getModelRowKey(modelOrProviderKey, maybeModelId) {
      if (typeof modelOrProviderKey === 'object' && modelOrProviderKey) {
        return `${modelOrProviderKey.providerKey || ''}::${modelOrProviderKey.modelId || ''}`;
      }
      return `${modelOrProviderKey || ''}::${maybeModelId || ''}`;
    }

    function clamp(n, min, max) {
      return Math.max(min, Math.min(max, n));
    }

    function formatLatencyValue(value) {
      return value === Infinity || value == null ? 'Offline' : `${value}ms`;
    }

    function getComparedModels() {
      return compareRowKeys
        .map(rowKey => allModels.find(model => getModelRowKey(model) === rowKey)
          || catalogModels.find(model => getModelRowKey(model) === rowKey))
        .filter(Boolean);
    }

    function isCompared(model) {
      return compareRowKeys.includes(getModelRowKey(model));
    }

    function toggleCompareModel(modelId, providerKey) {
      const rowKey = getModelRowKey(providerKey, modelId);
      if (!rowKey) return;

      if (compareRowKeys.includes(rowKey)) {
        compareRowKeys = compareRowKeys.filter(key => key !== rowKey);
      } else {
        compareRowKeys = [...compareRowKeys, rowKey].slice(-4);
      }

      renderComparePanel();
      renderCatalog();
      render(true);
      if (openDrawerModelId) {
        const openModel = getOpenDrawerModel();
        if (openModel) updateDrawerContent(openModel);
      }
    }

    function clearCompareModels() {
      compareRowKeys = [];
      renderComparePanel();
      renderCatalog();
      render(true);
    }

    function buildSparklineSvg(pings = []) {
      const series = (Array.isArray(pings) ? pings : [])
        .slice(-12)
        .map(ping => {
          if (ping?.code === '200' && Number.isFinite(ping?.ms)) return Number(ping.ms);
          return null;
        });

      if (series.length === 0 || series.every(point => point == null)) {
        return `<svg class="sparkline-svg" viewBox="0 0 180 46" aria-hidden="true"><text x="90" y="25" text-anchor="middle" font-size="10" fill="#94a3b8">No recent ping data</text></svg>`;
      }

      const points = series.map(point => point == null ? null : clamp(point, 50, 5000));
      const max = Math.max(...points.filter(point => point != null));
      const min = Math.min(...points.filter(point => point != null));
      const range = Math.max(1, max - min);
      const stepX = series.length <= 1 ? 0 : 160 / (series.length - 1);

      const coords = points.map((point, index) => {
        const x = 10 + (stepX * index);
        if (point == null) return { x, y: 36, missing: true };
        const y = 36 - (((point - min) / range) * 24);
        return { x, y, missing: false };
      });

      const polyline = coords
        .filter(point => !point.missing)
        .map(point => `${point.x},${point.y}`)
        .join(' ');

      const dots = coords
        .filter(point => !point.missing)
        .map(point => `<circle class="sparkline-dot" cx="${point.x}" cy="${point.y}" r="2" fill="#2563eb"></circle>`)
        .join('');

      const areaPoints = [`10,36`, ...coords.filter(point => !point.missing).map(point => `${point.x},${point.y}`), '170,36'].join(' ');

      return `
        <svg class="sparkline-svg" viewBox="0 0 180 46" aria-hidden="true">
          <line x1="10" y1="36" x2="170" y2="36" stroke="#e7e5e4" stroke-width="1"></line>
          <polyline class="sparkline-area" fill="rgba(37,99,235,0.10)" stroke="none" points="${areaPoints}"></polyline>
          <polyline class="sparkline-line" fill="none" stroke="#2563eb" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${polyline}"></polyline>
          ${dots}
        </svg>
      `;
    }

    function renderSingleModelMetricBars(model) {
      const trackedOnly = isTrackedOnlyModel(model);
      const scoreValue = clamp(Math.round((Number(model?.intell) || 0) * 100), 0, 100);
      const qosValue = trackedOnly ? 0 : clamp(Number(model?.qos) || 0, 0, 100);
      const uptimeValue = trackedOnly ? 0 : clamp(Number(model?.uptime) || 0, 0, 100);
      const pingValue = trackedOnly ? 0 : (Number.isFinite(model?.avg) ? clamp(100 - ((Number(model.avg) / 2500) * 100), 0, 100) : 0);

      const rows = [
        { label: BENCHMARK_SCORE_LABEL, width: scoreValue, value: getBenchmarkDisplayValue(model?.intell, model?.isEstimatedScore), kind: 'score', neutral: !Number.isFinite(Number(model?.intell)) || Number(model?.intell) <= 0 },
        { label: 'QoS', width: qosValue, value: getQosDisplayForModel(model), kind: 'qos', neutral: trackedOnly },
        { label: 'Ping Health', width: pingValue, value: formatRouteLatency(model), kind: 'ping', neutral: trackedOnly || !Number.isFinite(model?.avg) },
        { label: 'Availability', width: uptimeValue, value: getAvailabilityDisplay(model), kind: 'uptime', neutral: trackedOnly },
      ];

      return rows.map(row => `
        <div class="compare-bar-row">
          <div class="compare-bar-label">${escapeHtml(row.label)}</div>
          <div class="compare-bar-track">
            <div class="compare-bar-fill ${row.neutral ? 'neutral' : getCompareBarClass(row.kind, row.kind === 'ping' ? (Number.isFinite(model?.avg) ? Number(model.avg) : 9999) : row.width)}" style="width:${row.width}%"></div>
          </div>
          <div class="compare-bar-value">${escapeHtml(String(row.value))}</div>
        </div>
      `).join('');
    }

    function getCompareBarClass(kind, value) {
      if (kind === 'ping') {
        if (value <= 400) return 'good';
        if (value <= 1200) return 'warn';
        return 'bad';
      }
      if (kind === 'uptime') {
        if (value >= 95) return 'good';
        if (value >= 85) return 'warn';
        return 'bad';
      }
      if (kind === 'score') {
        if (value >= 70) return 'good';
        if (value >= 45) return 'warn';
        return 'bad';
      }
      if (kind === 'qos') {
        if (value >= 45) return 'good';
        if (value >= 20) return 'warn';
        return 'bad';
      }
      return '';
    }

    function renderCompareMetricRows(models, metric) {
      if (!models.length) return '';

      let max = 1;
      if (metric.key === 'ping') {
        const finiteValues = models.map(model => Number(model.avg)).filter(Number.isFinite);
        max = finiteValues.length ? Math.max(...finiteValues) : 1;
      } else if (metric.key === 'intell') {
        max = 100;
      } else if (metric.key === 'uptime') {
        max = 100;
      } else {
        const values = models.map(metric.getValue).filter(Number.isFinite);
        max = values.length ? Math.max(...values) : 1;
      }

      return models.map(model => {
        const rawValue = metric.getValue(model);
        const normalizedValue = metric.key === 'ping'
          ? (Number.isFinite(rawValue) ? Math.max(0, max - rawValue) : 0)
          : rawValue;
        const barWidth = max > 0 ? clamp((normalizedValue / max) * 100, 0, 100) : 0;
        const neutral = metric.isAvailable ? !metric.isAvailable(model) : false;
        return `
          <div class="compare-bar-row">
            <div class="compare-bar-label">${escapeHtml(model.label)}</div>
            <div class="compare-bar-track">
              <div class="compare-bar-fill ${neutral ? 'neutral' : getCompareBarClass(metric.kind, Number.isFinite(rawValue) ? rawValue : 0)}" style="width:${barWidth}%"></div>
            </div>
            <div class="compare-bar-value">${escapeHtml(metric.format(model))}</div>
          </div>
        `;
      }).join('');
    }

    function getDrawerDecisionFactors(model) {
      const factors = [];
      if (typeof model.intell === 'number' && model.intell > 0) {
        factors.push(`${BENCHMARK_SCORE_LABEL} ${Math.round(model.intell * 100)}${model.isEstimatedScore ? ' (estimated)' : ''}`);
      } else {
        factors.push('No benchmark reference score yet');
      }
      if (isTrackedOnlyModel(model)) {
        factors.push('Tracked route, waiting for first live probe');
      } else if (Number.isFinite(model.avg)) {
        factors.push(`Recent ping ${model.avg}ms`);
      } else {
        factors.push('No recent successful ping');
      }
      factors.push(`Availability ${getAvailabilityDisplay(model)}`);
      if (model.isRateLimited) factors.push('Currently rate-limited');
      if (model.status === 'noauth') factors.push('Missing auth for this route');
      if (model.status === 'excluded') factors.push('Excluded by operator policy');
      if (model.status === 'disabled') factors.push('Provider disabled');
      return factors;
    }

    function renderBenchmarkSourceGroups() {
      return BENCHMARK_SOURCE_GROUPS.map(group => `
        <div class="benchmark-source-group">
          <div class="benchmark-source-group-title">${escapeHtml(group.title)}</div>
          <div class="benchmark-source-list">
            ${group.sources.map(source => `
              <a class="benchmark-source-link" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(source.shortLabel)}">
                <span>${escapeHtml(source.title)}</span>
              </a>
            `).join('')}
          </div>
        </div>
      `).join('');
    }

    function getBenchmarkBreakdownBarWidth(row) {
      const value = Number(row?.value);
      if (!Number.isFinite(value) || value <= 0) return 0;
      if (row.unit === 'elo') {
        return clamp(((value - 700) / 900) * 100, 0, 100);
      }
      if (row.unit === 'ratio') {
        return clamp(value * 100, 0, 100);
      }
      return 0;
    }

    function renderBenchmarkBreakdownChart(rows) {
      const data = Array.isArray(rows) ? rows : [];
      if (!data.length) return '';
      return `
        <div class="benchmark-breakdown-chart">
          ${data.map(row => `
            <div class="benchmark-chart-row">
              <div class="benchmark-chart-label">${escapeHtml(row.sourceTitle)}</div>
              <div class="benchmark-chart-track">
                <div class="benchmark-chart-fill" style="width:${getBenchmarkBreakdownBarWidth(row)}%"></div>
              </div>
              <div class="benchmark-chart-value">${escapeHtml(row.displayValue || String(row.value))}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    function renderModelBenchmarkBreakdown(model, maxRows = Infinity) {
      const rows = Array.isArray(model?.benchmarkBreakdown) ? model.benchmarkBreakdown.slice(0, maxRows) : [];
      if (!rows.length) {
        return `<div class="drawer-section-copy">No source-specific benchmark rows are seeded for this model yet. The current ${escapeHtml(BENCHMARK_SCORE_LABEL)} still comes from the repo-maintained reference score.</div>`;
      }

      return `
        ${renderBenchmarkBreakdownChart(rows)}
        <div class="benchmark-breakdown-list">
          ${rows.map(row => `
            <div class="benchmark-breakdown-row">
              <div>
                <div class="benchmark-breakdown-title">${escapeHtml(row.sourceTitle)}</div>
                <div class="benchmark-breakdown-meta">${escapeHtml(row.domain)}</div>
              </div>
              <div class="benchmark-breakdown-value-wrap">
                <div class="benchmark-breakdown-value">${escapeHtml(row.displayValue || String(row.value))}</div>
                ${row.url ? `<a class="benchmark-breakdown-link" href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer">Source</a>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    function syncCatalogControls() {
      document.querySelectorAll('[id^="catalog-lane-"]').forEach(button => {
        const active = button.id === `catalog-lane-${catalogLane}`;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll('[id^="catalog-view-"]').forEach(button => {
        const active = button.id === `catalog-view-${catalogView}`;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll('.catalog-filter-chip').forEach(button => {
        const key = button.dataset.filter;
        const active = key ? catalogFilterChips.has(key) : false;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      const sortSelect = document.getElementById('catalog-sort-select');
      if (sortSelect) sortSelect.value = catalogSort;
      syncCatalogProfileControls();
    }

    function setCatalogLane(nextLane = 'all') {
      catalogLane = ['all', 'general', 'frontier'].includes(nextLane) ? nextLane : 'all';
      syncCatalogControls();
      renderCatalog();
    }

    function setCatalogView(nextView = 'table') {
      catalogView = ['table', 'cards', 'compare'].includes(nextView) ? nextView : 'table';
      syncCatalogControls();
      renderCatalog();
    }

    function setCatalogSort(nextSort = 'best') {
      catalogSort = ['best', 'benchmark', 'ping', 'availability', 'benchmarked', 'az'].includes(nextSort) ? nextSort : 'best';
      syncCatalogControls();
      renderCatalog();
    }

    function toggleCatalogFilter(filterKey) {
      if (!filterKey) return;
      if (catalogFilterChips.has(filterKey)) catalogFilterChips.delete(filterKey);
      else catalogFilterChips.add(filterKey);
      syncCatalogControls();
      renderCatalog();
    }

    function clearCatalogFilters() {
      catalogFilterChips = new Set();
      syncCatalogControls();
      renderCatalog();
    }

    function handleCatalogSearch() {
      catalogSearchTerm = (document.getElementById('catalog-search-input')?.value || '').toLowerCase();
      renderCatalog();
    }

    function renderCatalogOverview() {
      const container = document.getElementById('catalog-overview');
      if (!container) return;
      const total = catalogModels.length;
      const frontier = catalogModels.filter(model => model.lane === 'frontier').length;
      const general = catalogModels.filter(model => model.lane !== 'frontier').length;
      const benchmarked = catalogModels.filter(model => (model.benchmarkBreakdown?.length || 0) > 0).length;
      const active = catalogModels.filter(model => model.active).length;

      const cards = [
        { label: 'Tracked Models', value: total, meta: `${active} active now across every known lane` },
        { label: 'Frontier Stack', value: frontier, meta: 'Direct Claude, GPT/Codex, Gemini style lanes' },
        { label: 'Open / General', value: general, meta: 'Routers, open-weight lanes, and general providers' },
        { label: 'Public Benchmarks', value: benchmarked, meta: 'Models with source-specific benchmark rows today' },
      ];

      container.innerHTML = cards.map(card => `
        <article class="catalog-overview-card">
          <div class="catalog-overview-label">${escapeHtml(card.label)}</div>
          <div class="catalog-overview-value">${escapeHtml(String(card.value))}</div>
          <div class="catalog-overview-meta">${escapeHtml(card.meta)}</div>
        </article>
      `).join('');
    }

    function renderCatalogUseCaseFit(model) {
      if (catalogProfile === 'all') return '';
      const fit = getUseCaseFit(model, catalogProfile);
      if (fit.score <= 0) return `<div class="catalog-fit-copy">No strong ${escapeHtml(getProfileLabel(catalogProfile))} signal yet.</div>`;
      return `
        <div class="catalog-fit-block">
          <div class="catalog-fit-score">${escapeHtml(getProfileLabel(catalogProfile))} fit ${fit.score}</div>
          <div class="catalog-fit-copy">${escapeHtml(fit.reasons.slice(0, 2).join(' • ') || 'General fit')}</div>
        </div>
      `;
    }

    function renderCatalogTableSection(group) {
      const rows = group.rows.map(model => {
        const sourceCount = model.benchmarkBreakdown?.length || 0;
        const bestForTags = getCatalogBestForTags(model);
        const rowKey = getModelRowKey(model);
        const isComparedRow = isCompared(model);
        const pingCaption = model.active && Number.isFinite(model.avg) ? `Ping ${model.avg}ms` : (isTrackedOnlyModel(model) ? 'Tracked, waiting for first probe' : 'No live ping yet');

        return `
          <tr class="catalog-table-row ${isComparedRow ? 'is-compared' : ''}" onclick='openDrawer(${JSON.stringify(model).replace(/'/g, "&apos;")})' style="cursor:pointer;">
            <td>
              <div class="catalog-row-actions">
                <button class="compare-row-btn ${isComparedRow ? 'active' : ''}" type="button" onclick="event.stopPropagation(); toggleCompareModel('${model.modelId}', '${model.providerKey}')" title="${isComparedRow ? 'Remove from compare' : 'Compare model'}">↔</button>
              </div>
            </td>
            <td>
              <div class="catalog-model-cell">
                <div class="catalog-model-row-top">
                  <div class="catalog-model-title">${escapeHtml(model.label)}</div>
                  <span class="lane-chip ${model.lane === 'frontier' ? 'frontier' : 'general'}">${escapeHtml(model.laneLabel)}</span>
                </div>
                <div class="catalog-model-meta">${escapeHtml(model.modelId)}</div>
                <div class="catalog-tag-row">
                  ${bestForTags.map(tag => `<span class="catalog-tag">${escapeHtml(tag)}</span>`).join('')}
                </div>
              </div>
            </td>
            <td>
              <div class="catalog-model-title">${escapeHtml(model.providerName || model.providerKey)}</div>
              <div class="catalog-model-meta">${escapeHtml(model.providerKey)}</div>
              <div class="catalog-tag-row">
                ${model.providerAuthLabel ? `<span class="catalog-tag subtle">${escapeHtml(model.providerAuthLabel)}</span>` : ''}
                ${model.providerCostLabel ? `<span class="catalog-tag subtle">${escapeHtml(model.providerCostLabel)}</span>` : ''}
              </div>
            </td>
            <td>
              <div class="catalog-model-title">${getBenchmarkDisplayValue(model.intell, model.isEstimatedScore)}</div>
              <div class="catalog-source-count">${model.isEstimatedScore ? 'Estimated ref' : 'Verified ref'}</div>
              ${renderCatalogUseCaseFit(model)}
            </td>
            <td>
              <div class="catalog-model-title">${sourceCount}</div>
              <div class="catalog-source-count">${sourceCount === 1 ? 'public row' : 'public rows'}</div>
            </td>
            <td>
              <span class="catalog-state-chip ${getCatalogStateClass(model)}">${escapeHtml(getCatalogStateLabel(model))}</span>
              <div class="catalog-model-meta" style="margin-top:6px;">${escapeHtml(pingCaption)}</div>
            </td>
            <td>
              <div class="catalog-mini-chart">
                ${buildSparklineSvg(model.pings)}
              </div>
            </td>
          </tr>
        `;
      }).join('');

      return `
        <section class="catalog-section">
          <div class="catalog-section-header">
            <div>
              <h3 class="catalog-section-title">${escapeHtml(group.title)}</h3>
              <p class="catalog-section-copy">${escapeHtml(group.copy)}</p>
            </div>
            <div class="catalog-section-count">${group.rows.length} models</div>
          </div>
          <div class="catalog-section-surface">
            <table class="catalog-table">
              <thead>
                <tr>
                  <th width="40"></th>
                  <th>Model</th>
                  <th>Provider</th>
                  <th>Benchmark Score</th>
                  <th>Public Rows</th>
                  <th>Current State</th>
                  <th width="180">Trend</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </section>
      `;
    }

    function renderCatalogCardSection(group) {
      return `
        <section class="catalog-section">
          <div class="catalog-section-header">
            <div>
              <h3 class="catalog-section-title">${escapeHtml(group.title)}</h3>
              <p class="catalog-section-copy">${escapeHtml(group.copy)}</p>
            </div>
            <div class="catalog-section-count">${group.rows.length} models</div>
          </div>
          <div class="catalog-card-grid">
            ${group.rows.map(model => {
              const sourceCount = model.benchmarkBreakdown?.length || 0;
              const compared = isCompared(model);
              return `
                <article class="catalog-card ${compared ? 'is-compared' : ''}" onclick='openDrawer(${JSON.stringify(model).replace(/'/g, "&apos;")})'>
                  <div class="catalog-card-top">
                    <div class="provider-chip-row">
                      <span class="lane-chip ${model.lane === 'frontier' ? 'frontier' : 'general'}">${escapeHtml(model.laneLabel)}</span>
                      <span class="catalog-state-chip ${getCatalogStateClass(model)}">${escapeHtml(getCatalogStateLabel(model))}</span>
                    </div>
                    <button class="compare-remove-btn" type="button" onclick="event.stopPropagation(); toggleCompareModel('${model.modelId}', '${model.providerKey}')">${compared ? 'Compared' : 'Compare'}</button>
                  </div>
                  <div>
                    <h3 class="catalog-card-title">${escapeHtml(model.label)}</h3>
                    <p class="catalog-card-subtitle">${escapeHtml(model.providerName || model.providerKey)} • ${escapeHtml(model.modelId)}</p>
                  </div>
                  <div class="catalog-tag-row">
                    ${getCatalogBestForTags(model).map(tag => `<span class="catalog-tag">${escapeHtml(tag)}</span>`).join('')}
                    ${model.providerAuthLabel ? `<span class="catalog-tag subtle">${escapeHtml(model.providerAuthLabel)}</span>` : ''}
                  </div>
                  <div class="compare-card-metrics">
                    <div class="compare-metric">
                      <div class="compare-metric-label">${escapeHtml(BENCHMARK_SCORE_LABEL)}</div>
                      <div class="compare-metric-value">${getBenchmarkDisplayValue(model.intell, model.isEstimatedScore)}</div>
                    </div>
                    <div class="compare-metric">
                      <div class="compare-metric-label">Public Rows</div>
                      <div class="compare-metric-value">${escapeHtml(String(sourceCount))}</div>
                    </div>
                    <div class="compare-metric">
                      <div class="compare-metric-label">Ping</div>
                      <div class="compare-metric-value">${escapeHtml(formatRouteLatency(model))}</div>
                    </div>
                    <div class="compare-metric">
                      <div class="compare-metric-label">Availability</div>
                      <div class="compare-metric-value">${escapeHtml(getAvailabilityDisplay(model))}</div>
                    </div>
                  </div>
                  ${renderCatalogUseCaseFit(model)}
                  <div class="sparkline-wrap">
                    ${buildSparklineSvg(model.pings)}
                    <div class="sparkline-caption">${escapeHtml(model.providerSetupHint || 'Open the drawer for setup details, benchmark provenance, and lane guidance.')}</div>
                  </div>
                  ${sourceCount > 0 ? renderBenchmarkBreakdownChart((model.benchmarkBreakdown || []).slice(0, 3)) : '<div class="catalog-empty-chart">No public benchmark rows seeded yet.</div>'}
                </article>
              `;
            }).join('')}
          </div>
        </section>
      `;
    }

    function renderCatalogCompareView(rows) {
      const compared = getComparedModels();
      if (compared.length === 0) {
        return `
          <div class="catalog-empty-state">
            <div class="catalog-empty-title">Select models to compare</div>
            <p>Use the compare controls in table or card view to pin up to four models. Compare view then gives you the side-by-side cards, loading-bar charts, and public benchmark rows in one place.</p>
            <div class="catalog-empty-actions">
              <button class="settings-provider-inline-btn" type="button" onclick="setCatalogView('cards')">Browse Cards</button>
              <button class="settings-provider-inline-btn" type="button" onclick="setCatalogView('table')">Browse Table</button>
            </div>
          </div>
        `;
      }

      return `
        <section class="catalog-section">
          <div class="catalog-section-header">
            <div>
              <h3 class="catalog-section-title">Catalog Compare</h3>
              <p class="catalog-section-copy">Compare tracked models side by side using the same benchmark, QoS, ping, and availability language used elsewhere in the dashboard.</p>
            </div>
            <div class="catalog-section-count">${compared.length} selected</div>
          </div>
          <div id="catalog-compare-panel" class="compare-panel"></div>
          <div class="catalog-compare-copy">Filtered rows available in this view: ${rows.length}. Compare keeps your current selections even if some are not active right now.</div>
        </section>
      `;
    }

    function renderCatalog() {
      const results = document.getElementById('catalog-results');
      const summary = document.getElementById('catalog-summary');
      if (!results || !summary) return;

      syncCatalogControls();
      renderCatalogOverview();

      const rows = getCatalogFilteredRows();
      const benchmarked = rows.filter(model => (model.benchmarkBreakdown?.length || 0) > 0).length;
      const active = rows.filter(model => model.active).length;
      const sortLabels = {
        best: 'Best overall',
        benchmark: 'Best benchmark',
        ping: 'Fastest live',
        availability: 'Most available',
        benchmarked: 'Most benchmarked',
        az: 'A-Z',
      };
      summary.textContent = `${rows.length} shown • ${benchmarked} benchmarked • ${active} live now • ${escapeHtml(getProfileLabel(catalogProfile))} profile • sorted by ${sortLabels[catalogSort] || 'Best overall'}`;

      if (!rows.length) {
        results.innerHTML = '<div class="catalog-empty-state"><div class="catalog-empty-title">No models match the current catalog view</div><p>Try clearing one or more chips, switching lanes, or changing the search term.</p><div class="catalog-empty-actions"><button class="settings-provider-inline-btn" type="button" onclick="clearCatalogFilters()">Clear filters</button></div></div>';
        return;
      }

      if (catalogView === 'compare') {
        results.innerHTML = renderCatalogCompareView(rows);
        renderModelComparePanel('catalog-compare-panel', getComparedModels(), {
          title: 'Catalog Comparison',
          copy: `Compare tracked models across ${escapeHtml(BENCHMARK_SCORE_LABEL)}, QoS, live ping, and availability. Catalog comparison keeps inactive but important routes visible while you decide what to configure.`,
        });
        return;
      }

      const groups = groupCatalogRows(rows);
      results.innerHTML = groups.map(group => (
        catalogView === 'cards' ? renderCatalogCardSection(group) : renderCatalogTableSection(group)
      )).join('');
    }

    function getPinnedRowKeysForSelection(modelId, providerKey = null, mode = appState.pinningMode) {
      if (!modelId) return [];
      if (mode === 'exact') return [getModelRowKey(providerKey, modelId)];

      const { unprefixed: selectedUnprefixed } = canonicalizeClientModelId(modelId);
      return allModels
        .filter(m => canonicalizeClientModelId(m.modelId).unprefixed === selectedUnprefixed)
        .map(m => getModelRowKey(m));
    }

    function syncPinnedModelUI() {
      const badge = document.getElementById('pin-badge');
      if (badge) badge.style.display = activePinnedRowKeys.length > 0 ? 'inline-block' : 'none';

      if (openDrawerModelId) {
        const openModel = getOpenDrawerModel();
        if (openModel) updateDrawerContent(openModel);
      }
    }

    function setActivePinnedModel(modelId, providerKey = null, resolvedRowKeys = null, mode = appState.pinningMode) {
      activePinnedModelId = modelId || null;
      activePinnedProviderKey = modelId ? (providerKey || null) : null;
      appState.pinningMode = mode === 'exact' ? 'exact' : 'canonical';
      activePinnedRowKeys = Array.isArray(resolvedRowKeys)
        ? [...new Set(resolvedRowKeys.filter(Boolean))]
        : getPinnedRowKeysForSelection(activePinnedModelId, activePinnedProviderKey, appState.pinningMode);
      syncPinnedModelUI();
    }

    function closeDrawer() {
      openDrawerModelId = null;
      openDrawerRowKey = null;
      const drawer = document.getElementById('drawer');
      const overlay = document.getElementById('overlay');
      if (drawer) drawer.classList.remove('open');
      if (overlay) overlay.classList.remove('active');
    }

    function updateDrawerContent(model) {
      const drawerTitle = document.getElementById('drawer-title');
      const drawerContent = document.getElementById('drawer-content');
      if (!drawerContent || !model) return;

      if (drawerTitle) drawerTitle.textContent = model.label || model.modelId;

      const compared = isCompared(model);
      const decisionFactors = getDrawerDecisionFactors(model)
        .map(factor => `<span class="drawer-explainer-pill">${escapeHtml(factor)}</span>`)
        .join('');

      const pingHistory = Array.isArray(model.pings) && model.pings.length > 0
        ? model.pings
          .slice(-8)
          .reverse()
          .map(ping => `<span class="drawer-history-chip">${escapeHtml(`${ping.code}:${ping.ms}ms`)}</span>`)
          .join('')
        : '<span style="color: var(--text-muted); font-size: 0.8rem;">No recent ping history.</span>';

      drawerContent.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:18px;">
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <span class="lane-chip ${model.lane === 'frontier' ? 'frontier' : 'general'}">${escapeHtml(model.laneLabel || getLaneLabel(model.lane))}</span>
            <span class="provider-rec-pill">${escapeHtml(model.providerKey)}</span>
            ${model.providerCostLabel ? `<span class="provider-rec-pill">${escapeHtml(model.providerCostLabel)}</span>` : ''}
            ${model.providerAuthLabel ? `<span class="provider-count-pill">${escapeHtml(model.providerAuthLabel)}</span>` : ''}
            <span class="provider-count-pill">${escapeHtml(model.status === 'noauth' ? 'No Auth' : model.status)}</span>
          </div>
          <div class="drawer-provider-note">${escapeHtml(model.providerSetupHint || (model.lane === 'frontier' ? 'Frontier lanes usually need a paid provider key plus a configured model.' : 'Open / general lanes may still require API keys depending on provider.'))}</div>
          <div class="drawer-stats-grid">
            <div class="autoupdate-stat">
              <div class="autoupdate-stat-label">QoS</div>
              <div class="autoupdate-stat-value" style="color:${isTrackedOnlyModel(model) ? 'var(--text-muted)' : getQosColor(model.qos)}">${getQosDisplayForModel(model)}</div>
            </div>
            <div class="autoupdate-stat">
              <div class="autoupdate-stat-label">${escapeHtml(BENCHMARK_SCORE_LABEL)}</div>
              <div class="autoupdate-stat-value">${getBenchmarkDisplayValue(model.intell, model.isEstimatedScore)}</div>
            </div>
            <div class="autoupdate-stat">
              <div class="autoupdate-stat-label">Ping</div>
              <div class="autoupdate-stat-value">${escapeHtml(formatRouteLatency(model))}</div>
            </div>
            <div class="autoupdate-stat">
              <div class="autoupdate-stat-label">Availability</div>
              <div class="autoupdate-stat-value">${escapeHtml(getAvailabilityDisplay(model))}</div>
            </div>
          </div>
          <div class="drawer-section">
            <div class="drawer-section-title">Why This Route Ranks Here</div>
            <div class="drawer-section-copy">Routing balances benchmark quality with current health. This route’s current decision factors are shown below.</div>
            <div class="drawer-explainer-list">${decisionFactors}</div>
          </div>
          ${catalogProfile !== 'all' ? `
          <div class="drawer-section">
            <div class="drawer-section-title">${escapeHtml(getProfileLabel(catalogProfile))} Fit</div>
            <div class="drawer-section-copy">Catalog profile scoring lets you bias the decision surface toward your current use case without changing routing automatically.</div>
            ${renderCatalogUseCaseFit(model)}
          </div>` : ''}
          <div class="drawer-section">
            <div class="drawer-section-title">Performance Snapshot</div>
            <div class="drawer-section-copy">The same loading-bar chart language used in compare mode, but focused on this one route so you can read it quickly before opening the full compare panel.</div>
            ${renderSingleModelMetricBars(model)}
          </div>
          <div class="drawer-section">
            <div class="drawer-section-title">${escapeHtml(BENCHMARK_SCORE_LABEL)}</div>
            <div class="drawer-section-copy">${escapeHtml(BENCHMARK_SCORE_DESCRIPTION)}</div>
            <div class="drawer-explainer-list">
              <span class="benchmark-source-chip">${model.isEstimatedScore ? 'Estimated / incomplete reference' : 'Verified in current score map'}</span>
              <span class="benchmark-source-chip">${escapeHtml(BENCHMARK_SCORE_PROVENANCE.currentReference.title)}</span>
              <span class="benchmark-source-chip">${escapeHtml(`${model.benchmarkBreakdown?.length || 0} public row${(model.benchmarkBreakdown?.length || 0) === 1 ? '' : 's'}`)}</span>
            </div>
            <div class="drawer-section-copy">${escapeHtml(BENCHMARK_SCORE_PROVENANCE.currentReference.summary)}</div>
            <div class="drawer-section-title">Public Benchmark Rows</div>
            ${renderModelBenchmarkBreakdown(model)}
            <div class="benchmark-source-grid">${renderBenchmarkSourceGroups()}</div>
            <div class="drawer-section-copy">${escapeHtml(BENCHMARK_SCORE_PROVENANCE.note)}</div>
          </div>
          <div class="drawer-section">
            <div class="drawer-section-title">Trend Line</div>
            <div class="sparkline-wrap">
              ${buildSparklineSvg(model.pings)}
              <div class="sparkline-caption">Recent ping history for this exact provider/model route. Use it as a quick latency trend line, not a full long-term time series.</div>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:8px;">${pingHistory}</div>
          </div>
          <div class="drawer-section">
            <div class="drawer-section-title">Model ID</div>
            <code style="display:block; padding:10px 12px; border:1px solid var(--border); border-radius:10px; background:#ffffff; word-break:break-all;">${escapeHtml(model.modelId)}</code>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button class="btn" style="background:white; color:var(--text); border:1px solid var(--border);" onclick="pingModelNow('${model.modelId}')">Ping Now</button>
            <button class="btn" style="background:white; color:var(--text); border:1px solid var(--border);" onclick="toggleCompareModel('${model.modelId}', '${model.providerKey}')">${compared ? 'Remove from Compare' : 'Compare Model'}</button>
            <button class="btn" style="background:${model.status === 'banned' ? '#ecfdf5' : '#fff1f2'}; color:${model.status === 'banned' ? '#065f46' : '#b91c1c'}; border:1px solid ${model.status === 'banned' ? '#a7f3d0' : '#fecaca'};" onclick="toggleBan('${model.modelId}', '${model.status}')">${model.status === 'banned' ? 'Unban Model' : 'Ban Model'}</button>
          </div>
        </div>
      `;
    }

    function openDrawer(model) {
      if (!model) return;
      openDrawerModelId = model.modelId;
      openDrawerRowKey = getModelRowKey(model);
      updateDrawerContent(model);
      const drawer = document.getElementById('drawer');
      const overlay = document.getElementById('overlay');
      if (drawer) drawer.classList.add('open');
      if (overlay) overlay.classList.add('active');
    }

    async function toggleBan(modelId, currentStatus) {
      const banned = currentStatus !== 'banned';
      try {
        const response = await fetch('/api/models/ban', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId, banned }),
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || `Ban request failed (${response.status}).`);
        }
        await fetchData();
      } catch (error) {
        console.error('Failed to update ban state', error);
      }
    }

    async function pingModelNow(modelId) {
      try {
        const response = await fetch('/api/models/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId }),
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || `Ping failed (${response.status}).`);
        }
        await fetchData();
      } catch (error) {
        console.error('Failed to ping model', error);
      }
    }

    function updateKPIs(models, bestModelId) {
      const telemetryModels = getTelemetryDataset(models, false);
      const upModels = telemetryModels.filter(m => m.status === 'up');
      const openLaneModels = telemetryModels.filter(m => m.lane !== 'frontier');
      const frontierModels = telemetryModels.filter(m => m.lane === 'frontier');
      const openLaneOnline = openLaneModels.filter(m => m.status === 'up');
      const frontierOnline = frontierModels.filter(m => m.status === 'up');
      const openBest = calculateBestModel(openLaneModels);
      const frontierBest = calculateBestModel(frontierModels);
      const trackedOpenCount = models.filter(m => m.lane !== 'frontier').length;
      const trackedFrontierCount = models.filter(m => m.lane === 'frontier').length;

      document.getElementById('kpi-open-best').textContent = openBest
        ? openBest.label
        : openLaneModels.length > 0
          ? 'No Open Models Online'
          : trackedOpenCount > 0
            ? 'No Open Lanes Active'
            : 'No Open Models Tracked';
      document.getElementById('kpi-frontier-best').textContent = frontierBest
        ? frontierBest.label
        : frontierModels.length > 0
          ? 'No Frontier Models Online'
          : trackedFrontierCount > 0
            ? 'No Frontier Lanes Active'
            : 'Not Configured';
      document.getElementById('kpi-open-meta').textContent = openLaneModels.length > 0
        ? `${openLaneOnline.length}/${openLaneModels.length} open telemetry rows online`
        : trackedOpenCount > 0
          ? `${trackedOpenCount} open models tracked in catalog`
          : 'No open lanes tracked yet';
      document.getElementById('kpi-frontier-meta').textContent = frontierModels.length > 0
        ? `${frontierOnline.length}/${frontierModels.length} frontier telemetry rows online`
        : trackedFrontierCount > 0
          ? `${trackedFrontierCount} frontier models tracked in catalog`
          : 'Add a frontier lane to compare it here';

      drawModelsConstellation(openLaneModels.length || trackedOpenCount || models.length, openLaneOnline.length || upModels.length);
      drawProvidersNetwork(frontierModels.length || trackedFrontierCount || models.length, frontierOnline.length || upModels.length);

      // Show the model the server is actually routing to
      const bestModel = bestModelId ? models.find(m => m.modelId === bestModelId) : null;
      document.getElementById('kpi-best').textContent = bestModel ? bestModel.label : 'No Live Route';

      drawCurrentModelAnimation(!!bestModel);
    }

    function renderTelemetryStatusBanner() {
      const banner = document.getElementById('telemetry-status-banner');
      if (!banner) return;

      const enabledProviders = latestProviders.filter(provider => provider.enabled === true);
      const configuredProviders = latestProviders.filter(provider => provider.hasKey || String(provider.baseUrl || '').trim() || String(provider.modelId || '').trim());
      const liveModels = allModels.filter(model => model.status === 'up');

      if (configuredProviders.length === 0) {
        banner.style.display = 'block';
        banner.innerHTML = `
          <div class="catalog-empty-title">No provider lanes are configured yet</div>
          <p>Live Telemetry now starts empty by design. Add a provider key or endpoint in Settings, then enable that lane to add explicit telemetry rows here.</p>
        `;
        return;
      }

      if (enabledProviders.length === 0) {
        banner.style.display = 'block';
        banner.innerHTML = `
          <div class="catalog-empty-title">Providers are configured but not enabled</div>
          <p>Configured lanes stay out of routing until you enable them. Turn on one or more provider lanes in Settings to start live telemetry and routing.</p>
        `;
        return;
      }

      if (enabledProviders.length > 0 && liveModels.length === 0) {
        banner.style.display = 'block';
        banner.innerHTML = `
          <div class="catalog-empty-title">Enabled lanes are still waiting for healthy live rows</div>
          <p>Your providers are enabled, but nothing is currently responding as <code>up</code>. Check auth, ping status, or provider errors in the drawer and Settings.</p>
        `;
        return;
      }

      banner.style.display = 'none';
      banner.innerHTML = '';
    }

    function renderModelComparePanel(containerId, comparedModels, options = {}) {
      const container = document.getElementById(containerId);
      if (!container) return;

      if (comparedModels.length === 0) {
        container.classList.add('compare-panel-empty');
        container.innerHTML = '';
        return;
      }

      container.classList.remove('compare-panel-empty');

      const compareCards = comparedModels.map(model => `
        <article class="compare-card">
          <div class="compare-card-top">
            <div>
              <div class="provider-chip-row">
                <span class="lane-chip ${model.lane === 'frontier' ? 'frontier' : 'general'}">${escapeHtml(model.laneLabel)}</span>
                <span class="provider-count-pill">${escapeHtml(model.providerKey)}</span>
              </div>
              <h3 class="compare-card-title">${escapeHtml(model.label)}</h3>
              <p class="compare-card-subtitle">${escapeHtml(model.modelId)}</p>
            </div>
            <button class="compare-remove-btn" type="button" onclick="toggleCompareModel('${model.modelId}', '${model.providerKey}')">Remove</button>
          </div>
          <div class="compare-card-metrics">
            <div class="compare-metric">
              <div class="compare-metric-label">${escapeHtml(BENCHMARK_SCORE_LABEL)}</div>
              <div class="compare-metric-value">${getBenchmarkDisplayValue(model.intell, model.isEstimatedScore)}</div>
            </div>
                    <div class="compare-metric">
                      <div class="compare-metric-label">QoS</div>
                      <div class="compare-metric-value" style="color:${isTrackedOnlyModel(model) ? 'var(--text-muted)' : getQosColor(model.qos)}">${getQosDisplayForModel(model)}</div>
                    </div>
                    <div class="compare-metric">
                      <div class="compare-metric-label">Ping</div>
                      <div class="compare-metric-value">${escapeHtml(formatRouteLatency(model))}</div>
                    </div>
                    <div class="compare-metric">
                      <div class="compare-metric-label">Availability</div>
                      <div class="compare-metric-value">${escapeHtml(getAvailabilityDisplay(model))}</div>
                    </div>
                  </div>
                  <div class="sparkline-wrap">
                    ${buildSparklineSvg(model.pings)}
            <div class="sparkline-caption">Last ${Math.min((model.pings || []).length, 12)} pings for ${escapeHtml(model.providerKey)}.</div>
          </div>
          ${renderModelBenchmarkBreakdown(model, 3)}
        </article>
      `).join('');

      const chartMetrics = [
        {
          key: 'intell',
          kind: 'score',
          title: BENCHMARK_SCORE_LABEL,
          getValue: model => Math.round((Number(model.intell) || 0) * 100),
          format: model => `${Math.round((Number(model.intell) || 0) * 100)}`,
        },
        {
          key: 'qos',
          kind: 'qos',
          title: 'QoS',
          getValue: model => Number(model.qos) || 0,
          format: model => getQosDisplayForModel(model),
          isAvailable: model => !isTrackedOnlyModel(model),
        },
        {
          key: 'ping',
          kind: 'ping',
          title: 'Avg Ping',
          getValue: model => Number.isFinite(model.avg) ? Number(model.avg) : Infinity,
          format: model => formatRouteLatency(model),
          isAvailable: model => !isTrackedOnlyModel(model) && Number.isFinite(model.avg),
        },
        {
          key: 'uptime',
          kind: 'uptime',
          title: 'Availability',
          getValue: model => Number(model.uptime) || 0,
          format: model => getAvailabilityDisplay(model),
          isAvailable: model => !isTrackedOnlyModel(model),
        },
      ];

      const chartGroups = chartMetrics.map(metric => `
        <div class="compare-chart-group">
          <div class="compare-chart-title">${escapeHtml(metric.title)}</div>
          ${renderCompareMetricRows(comparedModels, metric)}
        </div>
      `).join('');

      container.innerHTML = `
        <div class="compare-panel-header">
          <div>
            <h3 class="compare-panel-title">${escapeHtml(options.title || 'Model Comparison')}</h3>
            <p class="compare-panel-copy">${escapeHtml(options.copy || `Compare up to four routes side by side using ${BENCHMARK_SCORE_LABEL}, QoS, live ping, and availability. This is the fastest way to make routing decisions without opening each drawer one by one.`)}</p>
          </div>
          <div class="compare-panel-actions">
            <button class="settings-provider-inline-btn" type="button" onclick="clearCompareModels()">Clear compare</button>
          </div>
        </div>
        <div class="compare-panel-grid">
          <div class="compare-card-grid">${compareCards}</div>
          <div class="compare-chart-panel">
            ${chartGroups}
          </div>
        </div>
      `;
    }

    function renderComparePanel() {
      renderModelComparePanel('compare-panel', getComparedModels());
    }

    function drawModelsConstellation(total, online) {
      const svg = document.getElementById('bg-models-svg');
      if (!svg) return;

      const numStars = Math.min(total, 100);
      const numBright = Math.min(online, numStars);

      if (svg.dataset.total != numStars || svg.children.length === 0) {
        svg.setAttribute('viewBox', '0 0 240 102');
        svg.innerHTML = '';
        svg.dataset.total = numStars;

        let seed = 42;
        const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

        const points = [];
        for (let i = 0; i < numStars; i++) {
          points.push({ idx: i, x: 10 + rand() * 220, y: 10 + rand() * 82 });
        }

        for (let i = 0; i < points.length; i++) {
          let distances = points.map((p, idx) => ({ idx, d: Math.hypot(p.x - points[i].x, p.y - points[i].y) }));
          distances.sort((a, b) => a.d - b.d);
          for (let j = 1; j <= 2 && j < distances.length; j++) {
            if (distances[j].d < 60) {
              const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
              line.setAttribute('x1', points[i].x);
              line.setAttribute('y1', points[i].y);
              line.setAttribute('x2', points[distances[j].idx].x);
              line.setAttribute('y2', points[distances[j].idx].y);
              line.setAttribute('class', 'constellation-line-hidden');
              line.dataset.from = i;
              line.dataset.to = distances[j].idx;
              svg.appendChild(line);
            }
          }
        }

        points.forEach(p => {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', p.x);
          circle.setAttribute('cy', p.y);
          circle.setAttribute('r', 1);
          circle.dataset.idx = p.idx;
          circle.setAttribute('class', 'star-dim');
          circle.style.animationDelay = `${rand() * 2}s`;
          svg.appendChild(circle);
        });
      }

      // Update classes gracefully based on online count
      const stars = Array.from(svg.querySelectorAll('circle'));
      const lines = Array.from(svg.querySelectorAll('line'));

      const brightIndices = new Set();
      stars.forEach(star => {
        const isBright = parseInt(star.dataset.idx) < numBright;
        if (isBright) brightIndices.add(parseInt(star.dataset.idx));

        const wasBright = star.classList.contains('star-bright');
        if (isBright !== wasBright) {
          star.setAttribute('class', isBright ? 'star-bright' : 'star-dim');
          star.setAttribute('r', isBright ? 1.5 : 1);
        }
      });

      lines.forEach(line => {
        const fromIdx = parseInt(line.dataset.from);
        const toIdx = parseInt(line.dataset.to);
        const shouldBeVisible = brightIndices.has(fromIdx) && brightIndices.has(toIdx);
        const isVisible = line.classList.contains('constellation-line');
        if (shouldBeVisible !== isVisible) {
          line.setAttribute('class', shouldBeVisible ? 'constellation-line' : 'constellation-line-hidden');
        }
      });
    }

    function drawProvidersNetwork(total, online) {
      const svg = document.getElementById('bg-providers-svg');
      if (!svg) return;

      const numNodes = Math.min(total, 50);
      const numOnline = Math.min(online, numNodes);

      if (svg.dataset.total != numNodes || svg.children.length === 0) {
        svg.setAttribute('viewBox', '0 0 240 102');
        svg.innerHTML = '';
        svg.dataset.total = numNodes;

        let seed = 123;
        const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
        const hubX = 120, hubY = 90;

        for (let i = 0; i < numNodes; i++) {
          const x = 20 + rand() * 200;
          const y = 10 + rand() * 55;

          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', x);
          line.setAttribute('y1', y);
          line.setAttribute('x2', hubX);
          line.setAttribute('y2', hubY);
          line.setAttribute('class', 'net-link');
          line.dataset.idx = i;
          svg.appendChild(line);

          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', x);
          circle.setAttribute('cy', y);
          circle.setAttribute('r', 2);
          circle.setAttribute('class', 'net-node-dim');
          circle.dataset.idx = i;
          circle.style.transformOrigin = `${x}px ${y}px`;
          circle.style.animationDelay = `${rand() * 2}s`;
          svg.appendChild(circle);
        }

        const hub = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        hub.setAttribute('cx', hubX);
        hub.setAttribute('cy', hubY);
        hub.setAttribute('r', 4);
        hub.setAttribute('class', 'net-hub');
        svg.appendChild(hub);
      }

      // Update element classes gracefully
      const nodes = Array.from(svg.querySelectorAll('circle:not(.net-hub)'));
      const links = Array.from(svg.querySelectorAll('line'));

      nodes.forEach(node => {
        const isOnline = parseInt(node.dataset.idx) < numOnline;
        if (isOnline !== node.classList.contains('net-node-bright')) {
          node.setAttribute('class', isOnline ? 'net-node-bright' : 'net-node-dim');
          node.setAttribute('r', isOnline ? 3 : 2);
        }
      });

      links.forEach(link => {
        const isOnline = parseInt(link.dataset.idx) < numOnline;
        if (isOnline !== link.classList.contains('net-link-active')) {
          link.setAttribute('class', isOnline ? 'net-link-active' : 'net-link');
        }
      });
    }

    function drawCurrentModelAnimation(hasActiveModel) {
      const svg = document.getElementById('bg-current-svg');
      if (!svg) return;
      if (svg.children.length === 0) {
        svg.setAttribute('viewBox', '0 0 240 102');

        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        const pts = [];
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i;
          pts.push(`${120 + 40 * Math.cos(angle)},${50 + 40 * Math.sin(angle)}`);
        }
        poly.setAttribute('points', pts.join(' '));
        poly.setAttribute('class', 'current-core');
        poly.style.transformOrigin = '120px 50px';
        svg.appendChild(poly);

        const core = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        core.setAttribute('cx', 120);
        core.setAttribute('cy', 50);
        core.setAttribute('r', 16);
        core.setAttribute('class', 'current-pulse');
        svg.appendChild(core);
      }

      const elements = Array.from(svg.children);
      elements.forEach(el => {
        el.style.opacity = hasActiveModel ? '' : '0';
      });
    }

    async function pinModel(modelId, providerKey = null) {
      const previousPinnedModelId = activePinnedModelId;
      const previousPinnedProviderKey = activePinnedProviderKey;
      const previousPinnedRowKeys = [...activePinnedRowKeys];
      const previousPinningMode = appState.pinningMode;
      setActivePinnedModel(modelId || null, providerKey, null, appState.pinningMode);
      render(true);

      try {
        const res = await fetch('/api/pinned', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId: modelId || null, providerKey: modelId ? providerKey : null })
        });
        if (!res.ok) {
          throw new Error(`Pin request failed with status ${res.status}`);
        }
        const data = await res.json();
        setActivePinnedModel(data.pinnedModelId, data.pinnedProviderKey, data.pinnedRowKeys, data.pinningMode);
        await fetchData();
      } catch (e) {
        setActivePinnedModel(previousPinnedModelId, previousPinnedProviderKey, previousPinnedRowKeys, previousPinningMode);
        render(true);
        console.error('Failed to pin model', e);
      }
    }

    function toggleFilterBar() {
      const bar = document.querySelector('.filter-bar');
      bar.classList.toggle('visible');
    }

    function toggleAll(groupId) {
      const group = document.getElementById(groupId);
      const checkboxes = group.querySelectorAll('input[type="checkbox"]');
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);

      checkboxes.forEach(cb => cb.checked = !allChecked);
      render(true);
    }

    function handleSearch() {
      searchTerm = document.getElementById('search-input').value.toLowerCase();
      render(true);
    }

    function setSort(col) {
      if (sortState && sortState.col === col) {
        if (sortState.dir === 'asc') {
          sortState = { col, dir: 'desc' };
        } else {
          // third click resets to default
          sortState = null;
        }
      } else {
        sortState = { col, dir: 'asc' };
      }
      updateSortHeaders();
      render(true);
    }

    function resetSort() {
      sortState = null;
      updateSortHeaders();
      render(true);
    }

    function updateSortHeaders() {
      const cols = ['model', 'qos', 'intell', 'ping', 'availability', 'status'];
      const resetBtn = document.getElementById('sort-reset-btn');
      cols.forEach(col => {
        const th = document.getElementById(`th-${col}`);
        const arrow = document.getElementById(`arrow-${col}`);
        th.classList.remove('sort-active');
        if (sortState && sortState.col === col) {
          th.classList.add('sort-active');
          arrow.textContent = sortState.dir === 'asc' ? '↑' : '↓';
        } else {
          arrow.textContent = '↕';
        }
      });
      if (resetBtn) resetBtn.style.display = sortState ? 'inline-block' : 'none';
    }

    // Returns a comparable value for each column (lower = sorts first in asc)
    function colValue(m, col) {
      switch (col) {
        case 'status': return m.status === 'up' ? 0 : 1;
        case 'ping': return (m.avg === Infinity || m.avg === null) ? Infinity : m.avg;
        case 'availability': return m.uptime;
        case 'qos': return m.qos || 0;
        case 'intell': return getBenchmarkSortValue(m.intell);
        case 'rate': return m.isRateLimited ? 1 : 0;
        case 'health': return m.qos || 0; // fallback just in case
        case 'model': return (m.label || '').toLowerCase();
        default: return 0;
      }
    }

    // Default sort priority and direction when used as a tiebreaker.
    // dir: 1 = ascending (lower value first), -1 = descending (higher value first)
    const DEFAULT_SORT_CHAIN = [
      { col: 'status', dir: 1 },  // up (0) before down (1)
      { col: 'qos', dir: -1 },    // Highest QoS first
      { col: 'ping', dir: 1 },    // fallback tiebreaker
      { col: 'availability', dir: -1 }, // fallback tiebreaker
      { col: 'model', dir: 1 },   // alphabetical
    ];

    function compareByChain(a, b, chain) {
      for (const { col, dir } of chain) {
        const av = colValue(a, col);
        const bv = colValue(b, col);
        // Infinity always sorts last regardless of direction
        if (av === Infinity && bv === Infinity) continue;
        if (av === Infinity) return 1;
        if (bv === Infinity) return -1;
        const cmp = typeof av === 'string' ? av.localeCompare(bv) : (av - bv);
        if (cmp !== 0) return dir * cmp;
      }
      return 0;
    }

    function sortedModels(models) {
      const arr = [...models];
      if (!sortState) {
        return arr.sort((a, b) => compareByChain(a, b, DEFAULT_SORT_CHAIN));
      }

      const { col, dir } = sortState;
      const sign = dir === 'asc' ? 1 : -1;

      // Build chain: primary column first, then the remaining default columns as tiebreakers
      const tiebreakers = DEFAULT_SORT_CHAIN.filter(c => c.col !== col);

      return arr.sort((a, b) => {
        const av = colValue(a, col);
        const bv = colValue(b, col);
        // Ping: Infinity always last regardless of sort direction
        if (col === 'ping') {
          if (av === Infinity && bv === Infinity) return compareByChain(a, b, tiebreakers);
          if (av === Infinity) return 1;
          if (bv === Infinity) return -1;
        }
        const cmp = typeof av === 'string' ? av.localeCompare(bv) : (av - bv);
        if (cmp !== 0) return sign * cmp;
        return compareByChain(a, b, tiebreakers);
      });
    }

    function getVisibleTelemetryModels(models) {
      if (appState.telemetryLaneFilter === 'frontier') {
        return models.filter(m => m.lane === 'frontier');
      }
      if (appState.telemetryLaneFilter === 'general') {
        return models.filter(m => m.lane !== 'frontier');
      }
      return models;
    }

    function getTelemetryEmptyStateCopy(lane, includeTracked) {
      if (lane === 'frontier') {
        return includeTracked
          ? `No frontier rows are tracked yet. Configure ${escapeHtml(FRONTIER_FAMILY_NAMES.join(', '))} in Settings to add them here.`
          : 'No active frontier telemetry rows yet. Turn on a frontier lane in Settings, or enable "Show configured inventory" to inspect configured disabled rows here.';
      }
      if (lane === 'general') {
        return includeTracked
          ? 'No open/general rows are tracked yet. Add an open lane in Settings to seed this telemetry view.'
          : 'No active open/general telemetry rows yet. Enable an open lane in Settings, or use "Show configured inventory" to inspect configured disabled rows here.';
      }
      return includeTracked
        ? 'No telemetry rows are tracked yet.'
        : 'No active telemetry rows match the current lane and filter settings. You can enable "Show configured inventory" to inspect configured disabled rows too.';
    }

    function renderSectionRow(label, detail) {
      const tr = document.createElement('tr');
      tr.className = 'lane-section-row';
      tr.innerHTML = `<td colspan="7"><div class="lane-section-pill"><span>${escapeHtml(label)}</span><span>${escapeHtml(detail)}</span></div></td>`;
      return tr;
    }

    function render(isUserAction = false) {
      if (!isUserAction && window.isTableHovered) return;
      const tbody = document.getElementById('table-body');

      let filtered = allModels.filter(m =>
        m.label.toLowerCase().includes(searchTerm) ||
        m.providerKey.toLowerCase().includes(searchTerm) ||
        m.modelId.toLowerCase().includes(searchTerm)
      );

      const { minSweScore, excludedProviders } = appState.filterRules;
      const hasFilterRules = minSweScore != null && minSweScore > 0 || (excludedProviders && excludedProviders.length > 0);
      if (hasFilterRules) {
        filtered = filtered.map(m => {
          const isExcludedProvider = excludedProviders && excludedProviders.includes(m.providerKey);
          const isBelowMinSwe = typeof minSweScore === 'number' && typeof m.intell === 'number' && m.intell < minSweScore;
          if (isExcludedProvider || isBelowMinSwe) {
            return { ...m, status: 'excluded', _excludedReason: isExcludedProvider ? 'provider' : 'swe' };
          }
          return m;
        });
      }

      const getChecked = id => Array.from(document.querySelectorAll(`#${id} input:checked`)).map(cb => cb.value);
      const allChecked = id => document.querySelectorAll(`#${id} input`).length === document.querySelectorAll(`#${id} input:checked`).length;

      const fProv = getChecked('filter-provider-group');
      const fPing = getChecked('filter-ping-group');
      const fAvail = getChecked('filter-avail-group');
      const fStatus = getChecked('filter-status-group');

      if (!allChecked('filter-provider-group')) filtered = filtered.filter(m => fProv.includes(m.providerKey));
      if (!allChecked('filter-status-group')) filtered = filtered.filter(m => fStatus.includes(m.status));

      if (!allChecked('filter-ping-group')) {
        filtered = filtered.filter(m => {
          const p = m.avg;
          if (p === Infinity || p === null) return false;
          if (fPing.includes('fast') && p < 400) return true;
          if (fPing.includes('medium') && p >= 400 && p < 1200) return true;
          if (fPing.includes('slow') && p >= 1200) return true;
          return false;
        });
      }

      if (!allChecked('filter-avail-group')) {
        filtered = filtered.filter(m => {
          const u = m.uptime;
          if (fAvail.includes('excellent') && u >= 95) return true;
          if (fAvail.includes('good') && u >= 85 && u < 95) return true;
          if (fAvail.includes('poor') && u < 85) return true;
          return false;
        });
      }

      filtered = getVisibleTelemetryModels(filtered);
      filtered = getTelemetryDataset(filtered, appState.telemetryShowTracked === true);

      const liveSortOn = document.getElementById('live-sort-toggle').checked;
      let sorted;

      if (isUserAction || liveSortOn || currentRenderedOrder.length === 0) {
        sorted = sortedModels(filtered);
      } else {
        const orderMap = new Map(currentRenderedOrder.map((id, i) => [id, i]));
        sorted = [...filtered].sort((a, b) => {
          const idxA = orderMap.has(a.modelId) ? orderMap.get(a.modelId) : Infinity;
          const idxB = orderMap.has(b.modelId) ? orderMap.get(b.modelId) : Infinity;
          if (idxA !== Infinity && idxB !== Infinity) return idxA - idxB;
          if (idxA !== Infinity) return -1;
          if (idxB !== Infinity) return 1;
          return compareByChain(a, b, DEFAULT_SORT_CHAIN);
        });
      }

      currentRenderedOrder = sorted.map(m => m.modelId);
      tbody.innerHTML = '';

      if (sorted.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="7" class="telemetry-empty-state">${getTelemetryEmptyStateCopy(appState.telemetryLaneFilter, appState.telemetryShowTracked === true)}</td>`;
        tbody.appendChild(tr);
        return;
      }

      if (appState.telemetryLaneFilter === 'all') {
        const generalModels = sorted.filter(m => m.lane !== 'frontier');
        const frontierModels = sorted.filter(m => m.lane === 'frontier');
        const frontierDetail = appState.telemetryShowTracked === true
          ? `${frontierModels.length} tracked row${frontierModels.length !== 1 ? 's' : ''}`
          : `${frontierModels.length} active row${frontierModels.length !== 1 ? 's' : ''}`;
        const generalDetail = appState.telemetryShowTracked === true
          ? `${generalModels.length} tracked row${generalModels.length !== 1 ? 's' : ''}`
          : `${generalModels.length} active row${generalModels.length !== 1 ? 's' : ''}`;

        if (frontierModels.length > 0) {
          tbody.appendChild(renderSectionRow('Frontier Stack', frontierDetail));
          frontierModels.forEach(m => tbody.appendChild(createRow(m)));
        } else {
          tbody.appendChild(renderSectionRow('Frontier Stack', appState.telemetryShowTracked === true ? 'No tracked rows yet' : 'No active rows yet'));
          const tr = document.createElement('tr');
          tr.innerHTML = `<td colspan="7" class="telemetry-empty-state">${getTelemetryEmptyStateCopy('frontier', appState.telemetryShowTracked === true)}</td>`;
          tbody.appendChild(tr);
        }
        if (generalModels.length > 0) {
          tbody.appendChild(renderSectionRow('Open / General', generalDetail));
          generalModels.forEach(m => tbody.appendChild(createRow(m)));
        } else {
          tbody.appendChild(renderSectionRow('Open / General', appState.telemetryShowTracked === true ? 'No tracked rows yet' : 'No active rows yet'));
          const tr = document.createElement('tr');
          tr.innerHTML = `<td colspan="7" class="telemetry-empty-state">${getTelemetryEmptyStateCopy('general', appState.telemetryShowTracked === true)}</td>`;
          tbody.appendChild(tr);
        }
        return;
      }

      if (appState.telemetryLaneFilter === 'frontier' && sorted.length === 0) {
        tbody.appendChild(renderSectionRow('Frontier Stack', appState.telemetryShowTracked === true ? 'No tracked rows yet' : 'No active rows yet'));
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="7" class="telemetry-empty-state">${getTelemetryEmptyStateCopy('frontier', appState.telemetryShowTracked === true)}</td>`;
        tbody.appendChild(tr);
        return;
      }

      sorted.forEach(m => tbody.appendChild(createRow(m)));
    }

    function createRow(m) {
      const tr = document.createElement('tr');
      tr.className = m.lane === 'frontier' ? 'telemetry-row frontier' : 'telemetry-row general';
      if (isCompared(m)) tr.classList.add('is-compared');
      tr.style.opacity = m.status === 'excluded' || m.status === 'banned' ? '0.5' : '1';
      const hasPing = m.avg !== Infinity && m.avg !== null;
      const pingClass = getPingAnimClass(m.avg);
      const pingSpeed = getPingSpeed(m.avg);

      const isPinnedRow = activePinnedRowKeys.includes(getModelRowKey(m));
      const isComparedRow = isCompared(m);
      tr.innerHTML = `
          <td>
            <div style="display:flex; flex-direction:column; gap:2px; align-items:center;">
              <div class="expand-btn" onclick='openDrawer(${JSON.stringify(m).replace(/'/g, "&apos;")})'>
                <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </div>
              <div class="pin-row-btn ${isPinnedRow ? 'pinned' : ''}" onclick="pinModel('${isPinnedRow ? '' : m.modelId}', '${m.providerKey}')" title="${isPinnedRow ? 'Unpin model' : 'Pin model'}">📌</div>
              <div class="compare-row-btn ${isComparedRow ? 'active' : ''}" onclick="toggleCompareModel('${m.modelId}', '${m.providerKey}')" title="${isComparedRow ? 'Remove from compare' : 'Compare model'}">↔</div>
            </div>
          </td>
          <td style="cursor:pointer;" onclick='openDrawer(${JSON.stringify(m).replace(/'/g, "&apos;")})'>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <div style="font-weight: 600;">${m.status === 'banned' ? '🚫 ' : (m.status === 'excluded' ? '⛔ ' : '')}${m.label}</div>
              <span class="lane-chip ${m.lane === 'frontier' ? 'frontier' : 'general'}">${m.laneLabel}</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${m.providerKey}</div>
          </td>
          <td>
            <div style="font-weight: 700; color: ${getQosColor(m.qos)}">${getQosDisplayValue(m.qos)}</div>
          </td>
          <td>
            <div style="font-weight: 600;">${getBenchmarkTableDisplayValue(m.intell, m.isEstimatedScore)}</div>
            <div style="font-size:0.68rem; color:var(--text-muted); margin-top:2px;">${m.isEstimatedScore ? 'Estimated' : 'Verified ref'}</div>
            <div style="font-size:0.68rem; color:#64748b; margin-top:2px;">${(m.benchmarkBreakdown?.length || 0) > 0 ? `${m.benchmarkBreakdown.length} public row${m.benchmarkBreakdown.length === 1 ? '' : 's'}` : 'No public rows yet'}</div>
          </td>
          <td class="text-right">
            <div style="display: flex; align-items: center; gap: 8px; justify-content: flex-end;">
              <div class="ping-dot ${hasPing ? 'active ' + pingClass : ''}" style="--speed: ${pingSpeed}"></div>
              <div style="font-variant-numeric: tabular-nums; text-align:right; line-height:1.3;">
                ${hasPing
          ? `<div style="font-size:0.82rem;">${m.avg}ms</div><div style="font-size:0.7rem; color:var(--text-muted);">(${m.lastPing}ms)</div>`
          : '<span style="font-size: 0.75rem; color: var(--text-muted);">OFFLINE</span>'}
              </div>
            </div>
          </td>
          <td class="text-right">
            <div style="display: flex; align-items: center; gap: 12px; justify-content: flex-end;">
              <div class="progress-pill">
                <div class="progress-fill" style="width: ${m.uptime}%; background: ${m.uptime < 85 ? 'var(--warning)' : (m.uptime < 50 ? 'var(--error)' : 'var(--success)')}"></div>
              </div>
              <span class="uptime-text" style="font-size: 0.75rem; font-weight: 600;">${m.uptime}%</span>
              <span class="rate-icon" style="font-size:1.1rem; opacity: 1;" title="${m.isRateLimited ? 'Rate limit exceeded, waiting to reset' : 'Rate available'}">${m.isRateLimited ? '🕑' : '✅'}</span>
            </div>
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="width: 6px; height: 6px; border-radius: 50%; background: ${m.status === 'up' ? 'var(--success)' : (m.status === 'disabled' || m.status === 'banned' || m.status === 'excluded') ? 'var(--text-muted)' : 'var(--error)'}"></span>
              <span style="font-size: 0.75rem; font-weight: 500; text-transform: capitalize;">${m.status === 'noauth' ? 'No Auth' : m.status}</span>
            </div>
          </td>
        `;
      return tr;
    }

    bindTabNavigation();
    setTelemetryLane(appState.telemetryLaneFilter);
    initializeChat();
    updateLogsPauseButton();
    setInterval(fetchData, 4000);
    fetchData();
  

Object.assign(window, {
  switchTab,
  closeDrawer,
  clearChat,
  copyConfigTokenFromBox,
  exportConfigTokenToBox,
  handleChatInputKeydown,
  handleCatalogSearch,
  handleSearch,
  importConfigTokenFromBox,
  loadLogs,
  onChatModelChange,
  pinModel,
  render,
  renderCatalog,
  resetSort,
  sendChatMessage,
  setCatalogLane,
  setCatalogProfile,
  setCatalogSort,
  setCatalogView,
  setTelemetryLane,
  setLogsViewMode,
  setSort,
  toggleAll,
  toggleCatalogFilter,
  toggleCompareModel,
  toggleFilterBar,
  toggleLogsAutoRefresh,
  toggleLogCard,
  openDrawer,
  toggleBan,
  pingModelNow,
  clearCompareModels,
  saveAutoUpdateSettings,
  saveFilterRules,
  applyProviderDefaults,
  updatePinningMode,
  switchSettingsPanel,
  toggleProviderCard,
  revealProviderCard,
  hideProviderCard,
  clearCatalogFilters,
  updateProvider,
  updateProviderKey,
  deleteProviderKey,
  updateProviderBaseUrl,
  updateProviderModelId,
  updateProviderPingInterval,
  updateProviderBearerAuth,
  updateProviderCatalogVisibility,
  startQwenOAuthLogin,
});

