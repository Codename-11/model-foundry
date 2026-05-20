import { state } from './state.js';
import { escapeHtml, formatIsoDateTime } from './utils.js';

export function registerSettings(app) {
  const SETTINGS_PANEL_IDS = ['overview', 'providers', 'open', 'frontier', 'routing', 'advanced'];
  const PROVIDER_GROUP_META = {
    open: {
      title: 'Open / General',
      description: 'Default routing lane, open-model access, and broad hosted providers.',
    },
    frontier: {
      title: 'Frontier Stack',
      description: 'Direct paid-model lanes for Claude, OpenAI GPT/Codex, and Gemini.',
    },
    custom: {
      title: 'Custom / Advanced',
      description: 'Bring-your-own endpoint flows, OAuth lanes, and power-user setup paths.',
    },
  };
  let activeSettingsPanel = 'overview';
  const expandedProviderKeys = new Set();
  const revealedProviderKeys = new Set();
  let latestProviders = [];

  function setInlineStatus(elementId, message, tone = 'muted') {
    const element = document.getElementById(elementId);
    if (!element) return;
    element.className = `autoupdate-save-status${tone === 'success' ? ' success' : tone === 'error' ? ' error' : ''}`;
    element.textContent = message || '';
  }

  function setQwenLoginStatus(message, tone = 'muted') {
    setInlineStatus('qwencode-login-status', message, tone);
  }

  function setConfigTransferStatus(message, tone = 'muted') {
    setInlineStatus('config-transfer-status', message, tone);
  }

  function clearQwenOauthPollTimer() {
    if (state.qwenOauthPollTimer) {
      window.clearTimeout(state.qwenOauthPollTimer);
      state.qwenOauthPollTimer = null;
    }
  }

  function scheduleQwenOauthStatusPoll(delayMs = 2000) {
    clearQwenOauthPollTimer();
    state.qwenOauthPollTimer = window.setTimeout(() => {
      void pollQwenOauthStatus();
    }, Math.max(1000, Number(delayMs) || 2000));
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || data?.message || `Request failed (${response.status}).`);
    }
    return data;
  }

  async function refreshSettingsAndModels() {
    await Promise.all([
      loadSettings(),
      app.fetchData(),
    ]);
  }

  function isProviderConfigured(provider) {
    return Boolean(
      provider?.hasKey
      || String(provider?.baseUrl || '').trim()
      || String(provider?.modelId || '').trim()
    );
  }

  function isProviderVisible(provider) {
    return provider?.enabled === true || isProviderConfigured(provider) || revealedProviderKeys.has(provider?.key);
  }

  function getProviderLaneGroup(provider) {
    if (provider?.category === 'frontier') return 'frontier';
    if (provider?.key === 'openai-compatible' || provider?.category === 'advanced') return 'custom';
    return 'open';
  }

  function getProviderLaneGroupOrder(provider) {
    const order = ['open', 'frontier', 'custom'];
    const index = order.indexOf(getProviderLaneGroup(provider));
    return index === -1 ? order.length : index;
  }

  function getProviderLaneLabel(provider) {
    if (provider?.category === 'frontier') return 'Frontier';
    if (provider?.category === 'advanced') return 'Advanced';
    return 'Open / General';
  }

  function getProviderStatusMeta(provider) {
    const tokenOptional = provider.supportsOptionalBearerAuth === true;
    const statusIcon = provider.hasKey ? 'Configured' : (tokenOptional ? 'Optional' : 'Missing');
    const statusColor = provider.hasKey ? 'var(--success)' : (tokenOptional ? 'var(--accent-strong)' : '#fcd34d');
    const statusBg = provider.hasKey ? 'rgba(52, 211, 153, 0.14)' : (tokenOptional ? 'rgba(38, 179, 252, 0.16)' : 'rgba(251, 191, 36, 0.12)');
    const statusText = provider.hasKey
      ? (tokenOptional ? 'API key configured' : 'Key configured')
      : (tokenOptional ? 'API key optional' : 'No API key');

    return {
      statusBg,
      statusColor,
      statusIcon,
      statusText,
      tokenOptional,
    };
  }

  function getProviderAccessMeta(provider) {
    const requiresKey = provider?.supportsOptionalBearerAuth !== true && provider?.key !== 'qwencode';
    const authLabel = provider?.authLabel || (provider?.supportsOptionalBearerAuth === true ? 'API key optional' : 'API key required');
    const costLabel = provider?.costLabel || (getProviderLaneGroup(provider) === 'frontier' ? 'Frontier paid' : 'Optional hosted');
    const hint = provider?.setupHint || (requiresKey
      ? 'Add a key first, then enable this lane when you want it in routing.'
      : 'Enable this lane only when you want it participating in routing.');

    return {
      authLabel,
      costLabel,
      hint,
      requiresKey,
    };
  }

  async function applyProviderDefaults(providerKey) {
    const provider = latestProviders.find(item => item.key === providerKey);
    if (!provider) return;

    const payload = { providerKey };
    if (provider.defaultBaseUrl) payload.baseUrl = provider.defaultBaseUrl;
    if (provider.defaultModelId) payload.modelId = provider.defaultModelId;
    if (provider.hasKey || provider.supportsOptionalBearerAuth === true || provider.key === 'qwencode') {
      payload.enabled = true;
    }

    try {
      await postJson('/api/config', payload);
      await refreshSettingsAndModels();
    } catch (err) {
      console.error(err);
      window.alert(err?.message || 'Failed to apply provider defaults.');
    }
  }

  async function updateProviderCatalogVisibility(providerKey, nextValue = null) {
    try {
      const input = document.getElementById(`catalog-visible-${providerKey}`);
      const catalogVisible = nextValue == null ? (input?.checked !== false) : nextValue !== false;
      await postJson('/api/config', { providerKey, catalogVisible });
      await refreshSettingsAndModels();
    } catch (err) {
      console.error(err);
      window.alert(err?.message || 'Failed to update catalog visibility.');
    }
  }

  function getProviderRuntimeMeta(providerModels, providerErrorMaxAgeMs) {
    const now = Date.now();
    const modelCount = providerModels.length;
    const rlModel = providerModels.find(model => model.rateLimit) || null;
    const rateLimit = rlModel?.rateLimit || null;
    const errorModel = providerModels
      .filter(model => {
        if (!model.lastError || model.status === 'up') return false;
        const updatedAtMs = Date.parse(model.lastError.updatedAt || '');
        return !Number.isNaN(updatedAtMs) && (now - updatedAtMs) <= providerErrorMaxAgeMs;
      })
      .sort((a, b) => {
        const aTs = Date.parse(a.lastError.updatedAt || '');
        const bTs = Date.parse(b.lastError.updatedAt || '');
        if (Number.isNaN(aTs) && Number.isNaN(bTs)) return 0;
        if (Number.isNaN(aTs)) return 1;
        if (Number.isNaN(bTs)) return -1;
        return bTs - aTs;
      })[0] || null;

    return {
      errorModel,
      modelCount,
      providerError: errorModel?.lastError || null,
      rateLimit,
    };
  }

  function switchSettingsPanel(panelId = 'overview') {
    const nextPanel = SETTINGS_PANEL_IDS.includes(panelId) ? panelId : 'overview';
    activeSettingsPanel = nextPanel;
    SETTINGS_PANEL_IDS.forEach(id => {
      const input = document.getElementById(`settings-tab-${id}`);
      if (input) input.checked = id === nextPanel;
    });
  }

  function toggleProviderCard(providerKey) {
    if (!providerKey) return;
    if (expandedProviderKeys.has(providerKey)) {
      expandedProviderKeys.delete(providerKey);
    } else {
      expandedProviderKeys.add(providerKey);
      revealedProviderKeys.add(providerKey);
    }

    const card = document.querySelector(`[data-provider-card="${providerKey}"]`);
    if (!card) return;

    const expanded = expandedProviderKeys.has(providerKey);
    card.classList.toggle('is-collapsed', !expanded);
    const button = card.querySelector('.settings-provider-card-header');
    if (button) button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    const toggleLabel = card.querySelector('.settings-provider-card-toggle');
    if (toggleLabel) toggleLabel.textContent = expanded ? 'Hide' : 'Open';
  }

  function revealProviderCard(providerKey) {
    if (!providerKey) return;
    revealedProviderKeys.add(providerKey);
    expandedProviderKeys.add(providerKey);
    switchSettingsPanel('providers');
    void loadSettings();
  }

  function hideProviderCard(providerKey) {
    if (!providerKey) return;
    revealedProviderKeys.delete(providerKey);
    expandedProviderKeys.delete(providerKey);
    void loadSettings();
  }

  function renderAutoUpdateSettings(autoUpdate) {
    const container = document.getElementById('autoupdate-container');
    if (!container || !autoUpdate) return;

    const enabled = autoUpdate.enabled !== false;
    const interval = Number(autoUpdate.intervalHours) > 0 ? Number(autoUpdate.intervalHours) : 24;
    const stateText = enabled ? 'On' : 'Off';

    container.innerHTML = `
      <div class="autoupdate-panel">
        <div class="autoupdate-header">
          <div>
            <h3 class="autoupdate-title">Auto-Update</h3>
            <div class="autoupdate-subtitle">Keep ModelFoundry fresh automatically with periodic npm checks and safe background restarts.</div>
          </div>
          <span id="autoupdate-pill" class="autoupdate-status-pill ${enabled ? 'on' : 'off'}">${stateText}</span>
        </div>

        <div class="autoupdate-controls">
          <label class="autoupdate-toggle-label">
            <input type="checkbox" id="autoupdate-enabled" ${enabled ? 'checked' : ''}>
            Enable auto-update
          </label>

          <label class="autoupdate-interval-label">
            Interval (hours)
            <input id="autoupdate-interval" type="number" min="1" step="1" value="${interval}">
          </label>

          <button class="btn" onclick="saveAutoUpdateSettings()">Save Changes</button>
          <span id="autoupdate-save-status" class="autoupdate-save-status"></span>
        </div>

        <div class="autoupdate-stats-grid">
          <div class="autoupdate-stat">
            <div class="autoupdate-stat-label">State</div>
            <div id="autoupdate-state" class="autoupdate-stat-value">${stateText}</div>
          </div>
          <div class="autoupdate-stat">
            <div class="autoupdate-stat-label">Last Check</div>
            <div id="autoupdate-last-check" class="autoupdate-stat-value">${formatIsoDateTime(autoUpdate.lastCheckAt)}</div>
          </div>
          <div class="autoupdate-stat">
            <div class="autoupdate-stat-label">Last Update</div>
            <div id="autoupdate-last-update" class="autoupdate-stat-value">${formatIsoDateTime(autoUpdate.lastUpdateAt)}</div>
          </div>
          <div class="autoupdate-stat">
            <div class="autoupdate-stat-label">Last Version</div>
            <div id="autoupdate-last-version" class="autoupdate-stat-value">${autoUpdate.lastVersionApplied || 'None'}</div>
          </div>
          <div class="autoupdate-stat" style="grid-column:1 / -1;">
            <div class="autoupdate-stat-label">Last Error</div>
            <div id="autoupdate-last-error" class="autoupdate-stat-value${autoUpdate.lastError ? ' error' : ''}">${escapeHtml(autoUpdate.lastError || 'None')}</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderPinningSettings(pinningState) {
    const container = document.getElementById('pinning-settings-container');
    if (!container) return;

    const mode = pinningState?.pinningMode === 'exact' ? 'exact' : 'canonical';
    app.setPinningMode(mode);

    container.innerHTML = `
      <div class="autoupdate-panel">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap;">
          <div>
            <h3 style="margin:0; font-size:1rem;">Pinned Model Scope</h3>
            <div style="margin-top:6px; color:var(--text-muted); font-size:0.82rem;">Canonical pins route to the best matching provider for that model family. Exact pins lock to the specific provider row you clicked.</div>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <label style="display:flex; align-items:flex-start; gap:8px; cursor:pointer; background:${mode === 'canonical' ? '#eff6ff' : '#fff'}; border:1px solid ${mode === 'canonical' ? '#bfdbfe' : 'var(--border)'}; border-radius:10px; padding:10px 12px; max-width:320px;">
              <input type="radio" name="pinning-mode" value="canonical" ${mode === 'canonical' ? 'checked' : ''} onchange="updatePinningMode('canonical')">
              <span>
                <span style="display:block; font-weight:700; font-size:0.82rem;">Canonical Group</span>
                <span style="display:block; color:var(--text-muted); font-size:0.76rem; margin-top:3px;">Default. Pin the same model across providers and route to the best available match.</span>
              </span>
            </label>
            <label style="display:flex; align-items:flex-start; gap:8px; cursor:pointer; background:${mode === 'exact' ? '#eff6ff' : '#fff'}; border:1px solid ${mode === 'exact' ? '#bfdbfe' : 'var(--border)'}; border-radius:10px; padding:10px 12px; max-width:320px;">
              <input type="radio" name="pinning-mode" value="exact" ${mode === 'exact' ? 'checked' : ''} onchange="updatePinningMode('exact')">
              <span>
                <span style="display:block; font-weight:700; font-size:0.82rem;">Exact Provider Row</span>
                <span style="display:block; color:var(--text-muted); font-size:0.76rem; margin-top:3px;">Pin only the exact provider/model row you clicked.</span>
              </span>
            </label>
          </div>
        </div>
      </div>
    `;
  }

  function renderFilterRules(filterRulesFromServer, providers) {
    const container = document.getElementById('filter-rules-container');
    if (!container || !filterRulesFromServer) return;

    const nextRules = {
      minSweScore: filterRulesFromServer.minSweScore,
      excludedProviders: filterRulesFromServer.excludedProviders || [],
    };
    app.setFilterRules(nextRules);

    const minSweScore = nextRules.minSweScore;
    const excludedProviders = nextRules.excludedProviders || [];

    const providerCheckboxes = providers.map(p => `
      <label style="display:flex; align-items:center; gap:8px; padding:8px 12px; background:#f8fafc; border-radius:8px; cursor:pointer; font-size:0.875rem;">
        <input type="checkbox" class="excluded-provider-checkbox" value="${escapeHtml(p.key)}" ${excludedProviders.includes(p.key) ? 'checked' : ''}>
        ${escapeHtml(p.name)}
      </label>
    `).join('');

    container.innerHTML = `
      <div class="autoupdate-panel">
        <div style="display:flex; flex-direction:column; gap:20px;">
          <div>
            <label style="display:block; font-weight:600; margin-bottom:6px; font-size:0.875rem;">
              Minimum Benchmark Score
            </label>
            <div style="display:flex; align-items:center; gap:8px;">
              <input type="number" id="min-swe-score" min="0" max="100" step="1" value="${minSweScore !== null ? Math.round(minSweScore * 100) : ''}" placeholder="e.g. 50" style="width:80px; padding:8px 12px; border:1px solid var(--border); border-radius:8px; font-size:0.875rem;">
              <span style="color:var(--text-muted); font-size:0.875rem;">%</span>
            </div>
            <p style="color:var(--text-muted); font-size:0.78rem; margin-top:6px;">Models with Benchmark Score below this threshold will be excluded from pinging and routing.</p>
          </div>

          <div>
            <label style="display:block; font-weight:600; margin-bottom:8px; font-size:0.875rem;">
              Excluded Providers
            </label>
            <div style="display:flex; flex-wrap:wrap; gap:8px;">
              ${providerCheckboxes}
            </div>
            <p style="color:var(--text-muted); font-size:0.78rem; margin-top:6px;">All models from these providers will be excluded from pinging and routing.</p>
          </div>

          <div>
            <button class="btn" onclick="saveFilterRules()">Save Filter Rules</button>
            <span id="filter-rules-save-status" class="autoupdate-save-status"></span>
          </div>
        </div>
      </div>
    `;
  }

  function renderProviderFilterGroup(providerConfigs) {
    const providerGroup = document.getElementById('filter-provider-group');
    if (!providerGroup) return;

    const selected = new Set(Array.from(providerGroup.querySelectorAll('input:checked')).map(cb => cb.value));
    const enabledProviders = (providerConfigs || []).filter(p => p.enabled);

    providerGroup.innerHTML = enabledProviders
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(p => `<label class="cb-label"><input type="checkbox" value="${escapeHtml(p.key)}" checked onchange="render(true)"> ${escapeHtml(p.name)}</label>`)
      .join('');

    providerGroup.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = selected.size === 0 || selected.has(cb.value);
    });
  }

  function renderFrontierSection(providerCatalog) {
    const frontierSection = providerCatalog?.sections?.find(section => section.id === 'frontier');
    const container = document.getElementById('frontier-container');
    if (!container) return;

    if (!frontierSection || !Array.isArray(frontierSection.families) || frontierSection.families.length === 0) {
      container.innerHTML = `
        <div class="frontier-empty">
          <h4>Frontier Stack</h4>
          <p>Claude, OpenAI GPT/Codex, and Gemini belong in a separate visibility lane from the open/free router pool.</p>
        </div>
      `;
      return;
    }

    const cards = frontierSection.families.map(item => {
      const stateLabel = item.configured || item.availableInConfig ? 'Configured' : (item.status || 'Available');
      const laneLabel = item.currentProviderKey
        ? `Managed via ${item.currentProviderKey}`
        : 'Comparison / visibility lane';
      const docsHtml = item.officialDocsUrl
        ? `<a class="frontier-link" href="${escapeHtml(item.officialDocsUrl)}" target="_blank" rel="noopener noreferrer">Official docs</a>`
        : '';

      return `
        <article class="frontier-card${item.configured ? ' configured' : ''}">
          <div class="frontier-card-top">
            <div>
              <div class="frontier-family">${escapeHtml(item.family || item.label || item.title)}</div>
              <h4>${escapeHtml(item.title || item.label || item.key)}</h4>
            </div>
            <div class="frontier-state${item.configured ? ' configured' : ''}">${escapeHtml(stateLabel)}</div>
          </div>
          <p>${escapeHtml(item.summary || '')}</p>
          <div class="frontier-meta">
            <span>${escapeHtml(laneLabel)}</span>
            ${item.apiKeyEnv ? `<span>Env: <code>${escapeHtml(item.apiKeyEnv)}</code></span>` : ''}
          </div>
          ${docsHtml}
        </article>
      `;
    }).join('');

    container.innerHTML = `
      <section class="frontier-section">
        <div class="provider-group-header">
          <h3>${escapeHtml(frontierSection.title)}</h3>
          <p>${escapeHtml(frontierSection.description || '')}</p>
        </div>
        <div class="frontier-grid">${cards}</div>
      </section>
    `;
  }

  function renderOpenSection(providers) {
    const container = document.getElementById('open-container');
    if (!container) return;

    const openProviders = (Array.isArray(providers) ? providers : [])
      .filter(provider => getProviderLaneGroup(provider) === 'open')
      .sort((a, b) => {
        if (a.isRecommendedDefault && !b.isRecommendedDefault) return -1;
        if (!a.isRecommendedDefault && b.isRecommendedDefault) return 1;
        const enabledDiff = Number(b.enabled === true) - Number(a.enabled === true);
        if (enabledDiff !== 0) return enabledDiff;
        const configuredDiff = Number(isProviderConfigured(b)) - Number(isProviderConfigured(a));
        if (configuredDiff !== 0) return configuredDiff;
        return a.name.localeCompare(b.name);
      });

    if (!openProviders.length) {
      container.innerHTML = `
        <div class="frontier-empty">
          <h4>Open / General Pool</h4>
          <p>Recommended first-run lanes, open-model hosts, and general router providers will appear here.</p>
        </div>
      `;
      return;
    }

    const cards = openProviders.map(provider => {
      const accessMeta = getProviderAccessMeta(provider);
      const stateLabel = provider.enabled
        ? 'Enabled'
        : isProviderConfigured(provider)
          ? 'Configured'
          : 'Available';
      const stateClass = provider.enabled || isProviderConfigured(provider) ? ' configured' : '';
      const docsHtml = provider.signupUrl
        ? `<a class="frontier-link" href="${escapeHtml(provider.signupUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(accessMeta.requiresKey ? 'Get API key' : 'Provider docs')}</a>`
        : '';

      return `
        <article class="frontier-card${stateClass}">
          <div class="frontier-card-top">
            <div>
              <div class="frontier-family">${escapeHtml(provider.isRecommendedDefault ? 'Best default' : 'Open / General')}</div>
              <h4>${escapeHtml(provider.name)}</h4>
            </div>
            <div class="frontier-state${stateClass}">${escapeHtml(stateLabel)}</div>
          </div>
          <p>${escapeHtml(provider.summary || '')}</p>
          <div class="frontier-meta">
            <span>${escapeHtml(accessMeta.authLabel)}</span>
            <span>${escapeHtml(accessMeta.costLabel)}</span>
            <span>${escapeHtml(provider.enabled ? 'Participating in routing' : 'Not active until enabled')}</span>
          </div>
          <p class="settings-provider-guidance">${escapeHtml(accessMeta.hint)}</p>
          <div class="settings-provider-card-actions">
            <button class="settings-provider-inline-btn" type="button" onclick="revealProviderCard('${provider.key}')">Open in Providers</button>
          </div>
          ${docsHtml}
        </article>
      `;
    }).join('');

    container.innerHTML = `
      <section class="frontier-section">
        <div class="provider-group-header">
          <h3>Open / General Pool</h3>
          <p>These are the default router lanes for most setups. Some expose free or open-model access, but many still require their own provider key.</p>
        </div>
        <div class="frontier-grid">${cards}</div>
      </section>
    `;
  }

  function renderSettingsOverview(providers) {
    const container = document.getElementById('settings-overview-container');
    if (!container) return;

    const activeProviders = providers.filter(isProviderVisible);
    const frontierCount = activeProviders.filter(provider => provider.category === 'frontier').length;
    const openCount = activeProviders.filter(provider => provider.category !== 'frontier').length;
    const defaultProvider = providers.find(provider => provider.isRecommendedDefault) || providers.find(provider => provider.category === 'recommended');
    const allModels = Array.isArray(app.state.allModels) ? app.state.allModels : [];
    const healthyModels = allModels.filter(model => model.status === 'up').length;
    const healthLabel = allModels.length > 0 ? `${healthyModels}/${allModels.length} models up` : 'Waiting for telemetry';

    container.innerHTML = `
      <article class="settings-overview-card settings-overview-card-primary">
        <div class="settings-overview-kicker">Quick setup</div>
        <h3>Start with one lane, expand later</h3>
        <p>${activeProviders.length > 0 ? 'Configured lanes stay in the active list while everything else moves into the add-provider rail.' : 'Start with one provider lane first, then add optional or frontier lanes after routing is stable.'}</p>
        <div class="settings-overview-actions">
          <button class="settings-overview-link" type="button" onclick="switchSettingsPanel('providers')">Manage providers</button>
          <button class="settings-overview-link" type="button" onclick="switchSettingsPanel('routing')">Review routing</button>
          <button class="settings-overview-link" type="button" onclick="switchTab('setup')">Run onboarding</button>
        </div>
      </article>
      <article class="settings-overview-card">
        <div class="settings-overview-kicker">Default lane</div>
        <h3>${escapeHtml(defaultProvider?.name || 'OpenRouter')}</h3>
        <p>${escapeHtml(defaultProvider?.summary || 'Recommended first-run provider lane for most ModelFoundry setups.')}</p>
      </article>
      <article class="settings-overview-card">
        <div class="settings-overview-kicker">Active lanes</div>
        <h3>${activeProviders.length}</h3>
        <p>${openCount} open/general lane${openCount !== 1 ? 's' : ''} and ${frontierCount} frontier lane${frontierCount !== 1 ? 's' : ''} currently visible.</p>
      </article>
      <article class="settings-overview-card">
        <div class="settings-overview-kicker">Live health</div>
        <h3>${escapeHtml(healthLabel)}</h3>
        <p>${allModels.length > 0 ? 'Health reflects the current telemetry snapshot across your routed provider rows.' : 'Telemetry appears here after the router has pinged or served model rows.'}</p>
      </article>
      <article class="settings-overview-card">
        <div class="settings-overview-kicker">Advanced</div>
        <h3>Operations and transfer tools</h3>
        <p>Auto-update and config export/import stay in a lower-frequency panel instead of crowding the API key flow.</p>
        <div class="settings-overview-actions">
          <button class="settings-overview-link" type="button" onclick="switchSettingsPanel('open')">Open general lane</button>
          <button class="settings-overview-link" type="button" onclick="switchSettingsPanel('advanced')">Open advanced</button>
          <button class="settings-overview-link" type="button" onclick="switchSettingsPanel('frontier')">Open frontier</button>
        </div>
      </article>
    `;
  }

  function buildProviderSettingsCard(provider, providerModels, providerErrorMaxAgeMs) {
    const { statusBg, statusColor, statusIcon, statusText, tokenOptional } = getProviderStatusMeta(provider);
    const accessMeta = getProviderAccessMeta(provider);
    const { errorModel, modelCount, providerError, rateLimit } = getProviderRuntimeMeta(providerModels, providerErrorMaxAgeMs);

    let rateLimitHtml = '';
    if (rateLimit) {
      const fmtNum = value => value >= 1000 ? `${(value / 1000).toFixed(0)}k` : String(value);
      const fmtTime = value => {
        if (!value) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
      };
      const creditLine = rateLimit.creditLimit != null
        ? `<span>Credits: <b>${fmtNum(rateLimit.creditRemaining ?? '?')}</b> / ${fmtNum(rateLimit.creditLimit)} remaining</span>`
        : '';
      const creditResetLine = rateLimit.creditResetAt
        ? `<span>Credit reset: <b>${fmtTime(rateLimit.creditResetAt) ?? 'unknown'}</b></span>`
        : '';
      rateLimitHtml = `
        <div class="settings-provider-note">
          <div class="settings-provider-note-label">Rate limits (last prompt)</div>
          <div style="display:flex; gap:16px; flex-wrap:wrap;">
            ${rateLimit.limitRequests != null ? `<span>Requests: <b>${fmtNum(rateLimit.remainingRequests ?? '?')}</b> / ${fmtNum(rateLimit.limitRequests)} remaining</span>` : ''}
            ${rateLimit.limitTokens != null ? `<span>Tokens: <b>${fmtNum(rateLimit.remainingTokens ?? '?')}</b> / ${fmtNum(rateLimit.limitTokens)} remaining</span>` : ''}
            ${creditLine}
            ${creditResetLine}
          </div>
        </div>`;
    }

    let providerErrorHtml = '';
    if (providerError && providerError.message) {
      const errorUpdated = providerError.updatedAt ? new Date(providerError.updatedAt) : null;
      const errorWhen = errorUpdated && !Number.isNaN(errorUpdated.getTime())
        ? errorUpdated.toLocaleString()
        : 'unknown time';
      providerErrorHtml = `
        <div class="settings-provider-note settings-provider-note-error">
          <div class="settings-provider-note-label settings-provider-note-label-error">Latest provider error</div>
          <div style="word-break:break-word;"><b>${escapeHtml(errorModel.modelId)}</b>: ${escapeHtml(providerError.message)}</div>
          <div style="margin-top:6px; color:#b91c1c;">HTTP ${escapeHtml(providerError.code || '?')} | ${escapeHtml(errorWhen)}</div>
        </div>`;
    }

    const configurableModelFieldsHtml = provider.baseUrl !== null || provider.modelId !== null ? `
      <div class="form-group" style="display:flex; gap:8px; align-items:center; margin-top:8px;">
        <input type="text" id="base-url-${provider.key}" name="base-url-${provider.key}" value="${escapeHtml(provider.baseUrl || '')}" placeholder="${escapeHtml(provider.defaultBaseUrl || 'https://your-endpoint.example/v1')}" autocomplete="url" style="flex:1;" onblur="updateProviderBaseUrl('${provider.key}')">
      </div>
      <div class="form-group" style="display:flex; gap:8px; align-items:center; margin-top:8px;">
        <input type="text" id="model-id-${provider.key}" name="model-id-${provider.key}" value="${escapeHtml(provider.modelId || '')}" placeholder="${escapeHtml(provider.defaultModelId || 'upstream-model-id')}" autocomplete="off" style="flex:1;" onblur="updateProviderModelId('${provider.key}')">
      </div>
      <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">Leave these blank to use the recommended endpoint/model defaults when available.</div>
      ${(provider.defaultBaseUrl || provider.defaultModelId) ? `<div class="settings-provider-card-actions"><button class="settings-provider-inline-btn" type="button" onclick="applyProviderDefaults('${provider.key}')">Use recommended defaults</button></div>` : ''}
    ` : '';

    const qwenAuthActionsHtml = provider.key === 'qwencode' ? `
      <div style="margin-top:10px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <button onclick="startQwenOAuthLogin()" style="border:1px solid var(--border); background:var(--surface-control); color:var(--text); cursor:pointer; padding:8px 12px; border-radius:6px; font-size:0.78rem; font-weight:600;">Login with Qwen Code</button>
        <span id="qwencode-login-status" class="autoupdate-save-status"></span>
      </div>
    ` : '';

    const optionalBearerAuthHtml = tokenOptional ? `
      <div style="margin-top:10px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <label style="display:flex; align-items:center; gap:6px; font-size:0.8rem; cursor:pointer;">
          <input type="checkbox" id="bearer-auth-${provider.key}" ${provider.useBearerAuth !== false ? 'checked' : ''} onchange="updateProviderBearerAuth('${provider.key}')">
          Attach API key as bearer
        </label>
      </div>
    ` : '';

    return `
      <div class="provider-section-top">
        <div class="provider-section-heading">
          <div class="provider-chip-row">
            <span style="background:${statusBg}; color:${statusColor}; border-radius:999px; padding:2px 10px; font-size:0.75rem; font-weight:600;">${statusIcon} ${statusText}</span>
            <span class="provider-rec-pill">${escapeHtml(getProviderLaneLabel(provider))}</span>
            <span class="provider-rec-pill">${escapeHtml(accessMeta.authLabel)}</span>
            <span class="provider-count-pill">${escapeHtml(accessMeta.costLabel)}</span>
            ${provider.isRecommendedDefault ? '<span class="provider-rec-pill provider-rec-pill-primary">Best default</span>' : ''}
            ${modelCount > 0 ? `<span class="provider-count-pill">${modelCount} model${modelCount !== 1 ? 's' : ''}</span>` : ''}
          </div>
          <div class="provider-title-row">
            <h3>${escapeHtml(provider.name)}</h3>
            ${provider.signupUrl ? `<a href="${provider.signupUrl}" target="_blank" rel="noopener noreferrer" class="provider-link">Get API key</a>` : ''}
          </div>
          <p class="provider-summary">${escapeHtml(provider.summary || '')}</p>
          <p class="settings-provider-guidance">${escapeHtml(accessMeta.hint)}</p>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <label style="display:flex; align-items:center; gap:6px; font-size:0.8rem; cursor:pointer;">
            <input type="checkbox" id="enable-${provider.key}" ${provider.enabled ? 'checked' : ''} onchange="updateProvider('${provider.key}')">
            Enabled
          </label>
        </div>
      </div>
      <div class="form-group" style="display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-top:8px;">
        <label style="display:flex; align-items:center; gap:6px; font-size:0.8rem; cursor:pointer;">
          <input type="checkbox" id="catalog-visible-${provider.key}" ${provider.catalogVisible !== false ? 'checked' : ''} onchange="updateProviderCatalogVisibility('${provider.key}')">
          Show in catalog
        </label>
        <span style="font-size:0.75rem; color:var(--text-muted);">Catalog visibility is separate from routing. Keep this on if you want the lane tracked even when it is disabled.</span>
      </div>
      <div class="form-group" style="display:flex; gap:8px; align-items:center;">
        <input type="password" id="key-${provider.key}" name="key-${provider.key}" placeholder="${provider.hasKey ? 'Configured key is hidden' : (tokenOptional ? 'Enter API key (optional)...' : 'Enter API key...')}" autocomplete="new-password" style="flex:1;" onblur="updateProviderKey('${provider.key}')">
        <button onclick="const input=document.getElementById('key-${provider.key}'); input.type=input.type==='password'?'text':'password'; this.textContent=input.type==='password'?'Show':'Hide';" style="border:1px solid var(--border); background:var(--surface-control); color:var(--text); cursor:pointer; padding:8px 10px; border-radius:6px; font-size:0.75rem; white-space:nowrap;">Show</button>
        ${provider.hasKey ? `<button onclick="deleteProviderKey('${provider.key}')" style="border:1px solid rgba(251, 113, 133, 0.34); background:rgba(251, 113, 133, 0.12); color:#fda4af; cursor:pointer; padding:8px 12px; border-radius:6px; font-size:0.8rem; font-weight:600; white-space:nowrap;">Delete key</button>` : ''}
      </div>
      <div class="form-group" style="display:flex; gap:8px; align-items:center; margin-top:8px;">
        <span style="font-size:0.75rem; color:var(--text-muted); white-space:nowrap;">Ping interval (min):</span>
        <input type="number" id="ping-interval-${provider.key}" name="ping-interval-${provider.key}" min="1" step="1" value="${provider.pingIntervalMinutes || ''}" placeholder="30" autocomplete="off" style="width:70px; padding:6px 10px; border:1px solid var(--border); border-radius:6px; font-size:0.8rem;" onchange="updateProviderPingInterval('${provider.key}')">
        <span style="font-size:0.75rem; color:var(--text-muted);">(default: 30)</span>
      </div>
      ${optionalBearerAuthHtml}
      ${configurableModelFieldsHtml}
      ${qwenAuthActionsHtml}
      ${providerErrorHtml}
      ${rateLimitHtml}
    `;
  }

  function buildProviderShell(provider, providerModels, providerErrorMaxAgeMs) {
    const { statusBg, statusColor, statusText } = getProviderStatusMeta(provider);
    const accessMeta = getProviderAccessMeta(provider);
    const { modelCount, providerError } = getProviderRuntimeMeta(providerModels, providerErrorMaxAgeMs);
    const modelLabel = provider.modelId
      ? provider.modelId
      : modelCount > 0
        ? `${modelCount} discovered model${modelCount !== 1 ? 's' : ''}`
        : 'No model selected';
    const healthLabel = providerError?.message
      ? 'Needs attention'
      : modelCount > 0
        ? `${modelCount} live model${modelCount !== 1 ? 's' : ''}`
        : provider.enabled
          ? 'Enabled, awaiting ping'
          : isProviderConfigured(provider)
            ? 'Configured, disabled'
            : 'Not configured';
    const expanded = expandedProviderKeys.has(provider.key);
    const allowHide = revealedProviderKeys.has(provider.key) && !provider.enabled && !isProviderConfigured(provider);

    return `
      <article class="settings-provider-card${expanded ? '' : ' is-collapsed'}" data-provider-card="${escapeHtml(provider.key)}">
        <button class="settings-provider-card-header" type="button" onclick="toggleProviderCard('${provider.key}')" aria-expanded="${expanded ? 'true' : 'false'}">
          <div class="settings-provider-card-header-main">
            <div class="provider-chip-row">
              <span style="background:${statusBg}; color:${statusColor}; border-radius:999px; padding:2px 10px; font-size:0.75rem; font-weight:600;">${escapeHtml(statusText)}</span>
              <span class="provider-rec-pill">${escapeHtml(getProviderLaneLabel(provider))}</span>
              <span class="provider-rec-pill">${escapeHtml(accessMeta.authLabel)}</span>
              <span class="provider-count-pill">${escapeHtml(accessMeta.costLabel)}</span>
              ${provider.isRecommendedDefault ? '<span class="provider-rec-pill provider-rec-pill-primary">Best default</span>' : ''}
              ${provider.recommendation ? `<span class="provider-count-pill">${escapeHtml(provider.recommendation)}</span>` : ''}
            </div>
            <div class="settings-provider-card-title-row">
              <h3>${escapeHtml(provider.name)}</h3>
              <span class="settings-provider-card-toggle">${expanded ? 'Hide' : 'Open'}</span>
            </div>
            <p class="provider-summary">${escapeHtml(provider.summary || '')}</p>
          </div>
          <div class="settings-provider-card-meta">
            <span>${escapeHtml(modelLabel)}</span>
            <span>${escapeHtml(healthLabel)}</span>
            <span>${provider.enabled ? 'Enabled' : 'Disabled'}</span>
          </div>
        </button>
        <div class="settings-provider-card-body">
          ${buildProviderSettingsCard(provider, providerModels, providerErrorMaxAgeMs)}
          ${allowHide ? `<div class="settings-provider-card-actions"><button class="settings-provider-inline-btn" type="button" onclick="hideProviderCard('${provider.key}')">Hide this card</button></div>` : ''}
        </div>
      </article>
    `;
  }

  function renderAddProviderPicker(hiddenProviders) {
    const container = document.getElementById('add-provider-container');
    if (!container) return;

    if (!hiddenProviders.length) {
      container.innerHTML = `
        <div class="settings-add-provider-card settings-add-provider-card-empty">
          <div class="settings-add-provider-header">
            <div>
              <div class="settings-overview-kicker">Add provider</div>
              <h3>All providers already visible</h3>
            </div>
          </div>
          <p>Configured or revealed lanes are already in the active list. Hide a temporary card there if you want a shorter workspace again.</p>
        </div>
      `;
      return;
    }

    const sectionsHtml = Object.entries(PROVIDER_GROUP_META)
      .map(([groupKey, meta]) => {
        const providers = hiddenProviders.filter(provider => getProviderLaneGroup(provider) === groupKey);
        if (!providers.length) return '';
        const cards = providers.map(provider => `
          <article class="settings-add-provider-option">
            <div class="settings-add-provider-option-top">
              <div>
                <h4>${escapeHtml(provider.name)}</h4>
                <p>${escapeHtml(provider.summary || '')}</p>
                <div class="settings-provider-guidance">${escapeHtml(getProviderAccessMeta(provider).hint)}</div>
              </div>
              <button class="settings-provider-inline-btn" type="button" onclick="revealProviderCard('${provider.key}')">Add</button>
            </div>
            <div class="settings-add-provider-chip-row">
              <span class="settings-add-provider-chip">${escapeHtml(getProviderLaneLabel(provider))}</span>
              <span class="settings-add-provider-chip">${escapeHtml(getProviderAccessMeta(provider).authLabel)}</span>
              <span class="settings-add-provider-chip">${escapeHtml(getProviderAccessMeta(provider).costLabel)}</span>
            </div>
          </article>
        `).join('');

        return `
          <section class="settings-add-provider-group">
            <div class="provider-group-header">
              <h3>${escapeHtml(meta.title)}</h3>
              <p>${escapeHtml(meta.description)}</p>
            </div>
            <div class="settings-add-provider-list">${cards}</div>
          </section>
        `;
      })
      .filter(Boolean)
      .join('');

    container.innerHTML = `
      <div class="settings-add-provider-card">
        <div class="settings-add-provider-header">
          <div>
            <div class="settings-overview-kicker">Add provider</div>
            <h3>Bring providers into the active list only when you need them</h3>
            <p>Unconfigured lanes stay here until you explicitly add one to the working set.</p>
          </div>
          <div class="settings-add-provider-summary">
            <span class="settings-add-provider-summary-count">${hiddenProviders.length}</span>
            <span>available</span>
          </div>
        </div>
        <div class="settings-add-provider-groups">${sectionsHtml}</div>
      </div>
    `;
  }

  async function loadSettings() {
    try {
      const [providersRes, autoUpdateRes, filterRulesRes, pinningRes, providerMetaRes] = await Promise.all([
        fetch('/api/config'),
        fetch('/api/autoupdate'),
        fetch('/api/filter-rules'),
        fetch('/api/pinning'),
        fetch('/api/provider-meta'),
      ]);

      const providers = await providersRes.json();
      const autoUpdate = await autoUpdateRes.json();
      const filterRules = await filterRulesRes.json();
      const pinning = await pinningRes.json();
      const providerCatalog = providerMetaRes.ok ? await providerMetaRes.json().catch(() => null) : null;
      latestProviders = Array.isArray(providers) ? providers : [];

      renderAutoUpdateSettings(autoUpdate);
      renderPinningSettings(pinning);
      renderFilterRules(filterRules, providers);
      renderProviderFilterGroup(providers);
      renderOpenSection(providers);
      renderFrontierSection(providerCatalog);
      renderSettingsOverview(providers);

      const container = document.getElementById('providers-container');
      if (!container) return;

      const visibleProviders = providers
        .filter(isProviderVisible)
        .sort((a, b) => {
          const laneGroupDiff = getProviderLaneGroupOrder(a) - getProviderLaneGroupOrder(b);
          if (laneGroupDiff !== 0) return laneGroupDiff;
          const enabledDiff = Number(b.enabled === true) - Number(a.enabled === true);
          if (enabledDiff !== 0) return enabledDiff;
          const configuredDiff = Number(isProviderConfigured(b)) - Number(isProviderConfigured(a));
          if (configuredDiff !== 0) return configuredDiff;
          if (a.isRecommendedDefault && !b.isRecommendedDefault) return -1;
          if (!a.isRecommendedDefault && b.isRecommendedDefault) return 1;
          return a.name.localeCompare(b.name);
        });
      const hiddenProviders = providers
        .filter(provider => !isProviderVisible(provider))
        .sort((a, b) => {
          const laneGroupDiff = getProviderLaneGroupOrder(a) - getProviderLaneGroupOrder(b);
          if (laneGroupDiff !== 0) return laneGroupDiff;
          if (a.isRecommendedDefault && !b.isRecommendedDefault) return -1;
          if (!a.isRecommendedDefault && b.isRecommendedDefault) return 1;
          return a.name.localeCompare(b.name);
        });
      const recommendedCards = providers
        .filter(provider => provider.category === 'recommended')
        .map(provider => `
          <div class="provider-quickstart-card${provider.isRecommendedDefault ? ' primary' : ''}">
            <div class="provider-quickstart-kicker">${escapeHtml(provider.recommendation || 'Recommended')}</div>
            <h4>${escapeHtml(provider.name)}</h4>
            <p>${escapeHtml(provider.summary || '')}</p>
          </div>
        `)
        .join('');
      const providerErrorMaxAgeMs = app.getProviderErrorMaxAgeMs();
      const visibleGroupSectionsHtml = Object.entries(PROVIDER_GROUP_META)
        .map(([groupKey, meta]) => {
          const groupedProviders = visibleProviders.filter(provider => getProviderLaneGroup(provider) === groupKey);
          if (!groupedProviders.length) return '';
          const cards = groupedProviders.map(provider => {
            const providerModels = app.state.allModels ? app.state.allModels.filter(model => model.providerKey === provider.key) : [];
            return buildProviderShell(provider, providerModels, providerErrorMaxAgeMs);
          }).join('');
          return `
            <section class="provider-group settings-provider-group">
              <div class="provider-group-header">
                <h3>${escapeHtml(meta.title)}</h3>
                <p>${escapeHtml(meta.description)}</p>
              </div>
              <div class="provider-group-body">${cards}</div>
            </section>
          `;
        })
        .filter(Boolean)
        .join('');
      const providerCardsHtml = visibleProviders.length > 0
        ? visibleGroupSectionsHtml
        : `
          <div class="settings-provider-empty">
            <h4>No active providers yet</h4>
            <p>No provider lanes are enabled by default on a blank setup. Add one from the rail, configure its credentials if needed, then enable it when you want it in routing.</p>
          </div>
        `;

      container.innerHTML = `
        <div class="provider-quickstart">
          <div class="provider-quickstart-header">
            <div>
              <h3 class="provider-quickstart-title">Quick Start Recommendation</h3>
              <p class="provider-quickstart-copy">OpenRouter is the best default for most ModelFoundry setups. Blank installs do not enable providers automatically, so add one lane, configure its auth, then enable it intentionally.</p>
            </div>
            <div class="provider-quickstart-badge">Default: OpenRouter</div>
          </div>
          <div class="provider-quickstart-grid">${recommendedCards}</div>
        </div>
        <section class="provider-group">
          <div class="provider-group-header">
            <h3>Active Lanes</h3>
            <p>Configured, enabled, or explicitly revealed providers stay here. Cards are grouped by lane type so open/general and frontier setups do not blur together.</p>
          </div>
          <div class="provider-group-body">${providerCardsHtml}</div>
        </section>
      `;

      renderAddProviderPicker(hiddenProviders);
      switchSettingsPanel(activeSettingsPanel);
    } catch (err) {
      console.error(err);
    }
  }

  async function saveAutoUpdateSettings() {
    try {
      setInlineStatus('autoupdate-save-status', 'Saving...');
      const enabled = document.getElementById('autoupdate-enabled')?.checked !== false;
      const intervalHours = Number(document.getElementById('autoupdate-interval')?.value || 24);
      const data = await postJson('/api/autoupdate', { enabled, intervalHours });
      renderAutoUpdateSettings(data.autoUpdate || data);
      setInlineStatus('autoupdate-save-status', 'Auto-update settings saved.', 'success');
    } catch (err) {
      setInlineStatus('autoupdate-save-status', err?.message || 'Failed to save auto-update settings.', 'error');
    }
  }

  async function saveFilterRules() {
    try {
      setInlineStatus('filter-rules-save-status', 'Saving...');
      const minSweInput = document.getElementById('min-swe-score');
      const rawMinSwe = minSweInput ? minSweInput.value.trim() : '';
      const minSweScore = rawMinSwe === '' ? null : (Number(rawMinSwe) / 100);
      const excludedProviders = Array.from(document.querySelectorAll('.excluded-provider-checkbox:checked')).map(input => input.value);
      const data = await postJson('/api/filter-rules', { minSweScore, excludedProviders });
      app.setFilterRules({
        minSweScore: data.minSweScore,
        excludedProviders: data.excludedProviders || [],
      });
      setInlineStatus('filter-rules-save-status', 'Filter rules saved.', 'success');
      await app.fetchData();
    } catch (err) {
      setInlineStatus('filter-rules-save-status', err?.message || 'Failed to save filter rules.', 'error');
    }
  }

  async function updatePinningMode(mode) {
    try {
      app.setPinningMode(mode);
      await postJson('/api/config', { pinningMode: mode });
      await refreshSettingsAndModels();
    } catch (err) {
      console.error(err);
      await loadSettings();
      setConfigTransferStatus(err?.message || 'Failed to update pinning mode.', 'error');
    }
  }

  async function updateProvider(providerKey) {
    const enabled = document.getElementById(`enable-${providerKey}`)?.checked === true;
    try {
      await postJson('/api/config', { providerKey, enabled });
      await refreshSettingsAndModels();
    } catch (err) {
      console.error(err);
      await loadSettings();
      window.alert(err?.message || 'Failed to update provider.');
    }
  }

  async function updateProviderKey(providerKey) {
    const input = document.getElementById(`key-${providerKey}`);
    if (!input) return;

    const apiKey = input.value.trim();
    if (!apiKey) return;

    try {
      await postJson('/api/config', { providerKey, apiKey });
      input.value = '';
      await refreshSettingsAndModels();
      if (providerKey === 'qwencode') {
        setQwenLoginStatus('API key saved.', 'success');
      }
    } catch (err) {
      console.error(err);
      if (providerKey === 'qwencode') {
        setQwenLoginStatus(err?.message || 'Failed to save Qwen credentials.', 'error');
      } else {
        window.alert(err?.message || 'Failed to save provider key.');
      }
    }
  }

  async function deleteProviderKey(providerKey) {
    if (!window.confirm(`Delete the saved key for ${providerKey}?`)) return;

    try {
      await postJson('/api/config', { providerKey, apiKey: '' });
      if (providerKey === 'qwencode') {
        clearQwenOauthPollTimer();
        state.qwenOauthSessionId = null;
        setQwenLoginStatus('Saved key removed.', 'success');
      }
      await refreshSettingsAndModels();
    } catch (err) {
      console.error(err);
      window.alert(err?.message || 'Failed to delete provider key.');
    }
  }

  async function updateProviderBaseUrl(providerKey) {
    const value = document.getElementById(`base-url-${providerKey}`)?.value?.trim() || '';
    try {
      await postJson('/api/config', { providerKey, baseUrl: value });
      await refreshSettingsAndModels();
    } catch (err) {
      console.error(err);
      window.alert(err?.message || 'Failed to save base URL.');
    }
  }

  async function updateProviderModelId(providerKey) {
    const value = document.getElementById(`model-id-${providerKey}`)?.value?.trim() || '';
    try {
      await postJson('/api/config', { providerKey, modelId: value });
      await refreshSettingsAndModels();
    } catch (err) {
      console.error(err);
      window.alert(err?.message || 'Failed to save model ID.');
    }
  }

  async function updateProviderPingInterval(providerKey) {
    const rawValue = document.getElementById(`ping-interval-${providerKey}`)?.value?.trim() || '';
    const pingIntervalMinutes = rawValue === '' ? null : Number(rawValue);
    try {
      await postJson('/api/config', { providerKey, pingIntervalMinutes });
      await refreshSettingsAndModels();
    } catch (err) {
      console.error(err);
      window.alert(err?.message || 'Failed to save ping interval.');
    }
  }

  async function updateProviderBearerAuth(providerKey) {
    const useBearerAuth = document.getElementById(`bearer-auth-${providerKey}`)?.checked !== false;
    try {
      await postJson('/api/config', { providerKey, useBearerAuth });
      await refreshSettingsAndModels();
    } catch (err) {
      console.error(err);
      window.alert(err?.message || 'Failed to update bearer auth.');
    }
  }

  async function pollQwenOauthStatus() {
    if (!state.qwenOauthSessionId) return;

    try {
      const response = await fetch(`/api/qwencode/login/status?sessionId=${encodeURIComponent(state.qwenOauthSessionId)}`, {
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || `Qwen login status failed (${response.status}).`);
      }

      if (data.status === 'authorized') {
        clearQwenOauthPollTimer();
        state.qwenOauthSessionId = null;
        setQwenLoginStatus('Qwen login authorized.', 'success');
        await refreshSettingsAndModels();
        return;
      }

      if (data.status === 'expired') {
        clearQwenOauthPollTimer();
        state.qwenOauthSessionId = null;
        setQwenLoginStatus('Qwen login expired. Start again.', 'error');
        return;
      }

      if (data.status === 'error') {
        clearQwenOauthPollTimer();
        state.qwenOauthSessionId = null;
        setQwenLoginStatus(data.error || 'Qwen login failed.', 'error');
        return;
      }

      const codeSuffix = data.userCode ? ` Code: ${data.userCode}` : '';
      setQwenLoginStatus(`Waiting for Qwen authorization.${codeSuffix}`);
      scheduleQwenOauthStatusPoll(data.pollIntervalMs);
    } catch (err) {
      clearQwenOauthPollTimer();
      state.qwenOauthSessionId = null;
      setQwenLoginStatus(err?.message || 'Failed to poll Qwen login.', 'error');
    }
  }

  async function startQwenOAuthLogin() {
    try {
      clearQwenOauthPollTimer();
      setQwenLoginStatus('Starting Qwen login...');
      const data = await postJson('/api/qwencode/login/start', {});
      state.qwenOauthSessionId = data.sessionId || null;
      if (data.verificationUriComplete) {
        window.open(data.verificationUriComplete, '_blank', 'noopener');
      }
      const codeSuffix = data.userCode ? ` Code: ${data.userCode}` : '';
      setQwenLoginStatus(`Finish login in the opened browser tab.${codeSuffix}`);
      scheduleQwenOauthStatusPoll(data.pollIntervalMs);
    } catch (err) {
      clearQwenOauthPollTimer();
      state.qwenOauthSessionId = null;
      setQwenLoginStatus(err?.message || 'Failed to start Qwen login.', 'error');
    }
  }

  async function exportConfigTokenToBox() {
    try {
      const response = await fetch('/api/config/export');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || `Export failed (${response.status}).`);
      }
      const textarea = document.getElementById('config-transfer-payload');
      if (textarea) textarea.value = data.payload || '';
      setConfigTransferStatus('Configuration exported.', 'success');
    } catch (err) {
      setConfigTransferStatus(err?.message || 'Failed to export configuration.', 'error');
    }
  }

  async function copyConfigTokenFromBox() {
    const textarea = document.getElementById('config-transfer-payload');
    const payload = textarea?.value?.trim() || '';
    if (!payload) {
      setConfigTransferStatus('Nothing to copy yet.', 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(payload);
      setConfigTransferStatus('Configuration token copied.', 'success');
    } catch {
      if (textarea) {
        textarea.focus();
        textarea.select();
      }
      setConfigTransferStatus('Clipboard write failed. Token selected for manual copy.', 'error');
    }
  }

  async function importConfigTokenFromBox() {
    const textarea = document.getElementById('config-transfer-payload');
    const payload = textarea?.value?.trim() || '';
    if (!payload) {
      setConfigTransferStatus('Paste a configuration token first.', 'error');
      return;
    }

    try {
      setConfigTransferStatus('Importing...');
      const data = await postJson('/api/config/import', { payload });
      const providerCount = Number(data.importedProviders) || 0;
      const keyCount = Number(data.importedApiKeys) || 0;
      setConfigTransferStatus(`Imported ${providerCount} providers and ${keyCount} API keys.`, 'success');
      await refreshSettingsAndModels();
    } catch (err) {
      setConfigTransferStatus(err?.message || 'Failed to import configuration.', 'error');
    }
  }

  Object.assign(app, {
    applyProviderDefaults,
    copyConfigTokenFromBox,
    deleteProviderKey,
    exportConfigTokenToBox,
    hideProviderCard,
    importConfigTokenFromBox,
    loadSettings,
    revealProviderCard,
    renderAutoUpdateSettings,
    renderFilterRules,
    renderPinningSettings,
    renderProviderFilterGroup,
    saveAutoUpdateSettings,
    saveFilterRules,
    setQwenLoginStatus,
    startQwenOAuthLogin,
    switchSettingsPanel,
    toggleProviderCard,
    updatePinningMode,
    updateProvider,
    updateProviderBaseUrl,
    updateProviderBearerAuth,
    updateProviderCatalogVisibility,
    updateProviderKey,
    updateProviderModelId,
    updateProviderPingInterval,
  });
}
