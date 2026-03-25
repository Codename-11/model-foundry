import './styles.css';

    let allModels = [];
    let searchTerm = '';
    // null = default multi-sort; otherwise { col: string, dir: 'asc'|'desc' }
    let sortState = null;
    let openDrawerModelId = null;
    let currentRenderedOrder = [];
    let activePinnedModelId = null; // tracks the current pinned selection key
    let activePinnedProviderKey = null;
    let activePinnedRowKeys = []; // resolved pinned rows from server/client
    let pinningMode = 'canonical';
    window.isTableHovered = false;
    let metaLoaded = false;
    let logsViewMode = 'history';
    let logsAutoRefreshPaused = false;
    const PROVIDER_ERROR_MAX_AGE_MS = 120 * 60_000;
    let qwenOauthSessionId = null;
    let qwenOauthPollTimer = null;
    let filterRules = { minSweScore: null, excludedProviders: [] };
    let chatMessages = [];
    let chatInFlight = false;
    let chatSelectedModel = 'auto-fastest';
    const CHAT_STORAGE_KEY = 'modelfoundry-chat-v1';
    const CHAT_MODEL_STORAGE_KEY = 'modelfoundry-chat-model-v1';
    const MODEL_ID_ALIASES = {
      'mimo-v2-omni-free': 'xiaomi/mimo-v2-omni:free',
    };



    async function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById(`tab-${tab}`).classList.add('active');

      document.getElementById('models-view').style.display = tab === 'models' ? 'block' : 'none';
      document.getElementById('chat-view').style.display = tab === 'chat' ? 'block' : 'none';
      document.getElementById('logs-view').style.display = tab === 'logs' ? 'block' : 'none';
      document.getElementById('settings-view').style.display = tab === 'settings' ? 'block' : 'none';
      document.getElementById('setup-view').style.display = tab === 'setup' ? 'block' : 'none';

      if (tab === 'settings') {
        loadSettings();
      } else if (tab === 'logs') {
        loadLogs(true);
      } else if (tab === 'chat') {
        renderChatTranscript();
        scrollChatToBottom();
      }
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

        // Calculate QoS for each model
        allModels = data.models.map(m => {
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

          return { ...m, qos: m.qos || 0, isRateLimited };
        });

        setActivePinnedModel(data.pinnedModelId, data.pinnedProviderKey, data.pinnedRowKeys, data.pinningMode);
        updateChatModelOptions(allModels);

        // Populate Provider Checkboxes
        renderProviderFilterGroup(providers);

        render(); // triggers automatic (non-user) layout pass
        updateKPIs(allModels, data.best);
        if (openDrawerModelId) {
          const m = allModels.find(x => x.modelId === openDrawerModelId);
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

    function getPinnedRowKeysForSelection(modelId, providerKey = null, mode = pinningMode) {
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
        const openModel = allModels.find(m => m.modelId === openDrawerModelId);
        if (openModel) updateDrawerContent(openModel);
      }
    }

    function setActivePinnedModel(modelId, providerKey = null, resolvedRowKeys = null, mode = pinningMode) {
      activePinnedModelId = modelId || null;
      activePinnedProviderKey = modelId ? (providerKey || null) : null;
      pinningMode = mode === 'exact' ? 'exact' : 'canonical';
      activePinnedRowKeys = Array.isArray(resolvedRowKeys)
        ? [...new Set(resolvedRowKeys.filter(Boolean))]
        : getPinnedRowKeysForSelection(activePinnedModelId, activePinnedProviderKey, pinningMode);
      syncPinnedModelUI();
    }

    function updateKPIs(models, bestModelId) {
      const upModels = models.filter(m => m.status === 'up');

      const allProviders = new Set(models.map(m => m.providerKey));
      const onlineProviders = new Set();
      const now = Date.now();
      models.forEach(m => {
        if (m.status === 'up' && !m.isRateLimited) {
          if (m.lastPing !== 'TIMEOUT' || m.uptime > 0) {
            onlineProviders.add(m.providerKey);
          }
        }
      });

      document.getElementById('kpi-active').textContent = upModels.length;
      document.getElementById('kpi-providers').textContent = onlineProviders.size;

      drawModelsConstellation(models.length, upModels.length);
      drawProvidersNetwork(allProviders.size, onlineProviders.size);

      // Show the model the server is actually routing to
      const bestModel = bestModelId ? models.find(m => m.modelId === bestModelId) : null;
      document.getElementById('kpi-best').textContent = bestModel ? bestModel.label : 'None Online';

      drawCurrentModelAnimation(!!bestModel);
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
      const previousPinningMode = pinningMode;
      setActivePinnedModel(modelId || null, providerKey, null, pinningMode);
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

    function render(isUserAction = false) {
      if (!isUserAction && window.isTableHovered) return; // Pause updates if hovering over table
      const tbody = document.getElementById('table-body');

      // 1. Apply Search
      let filtered = allModels.filter(m =>
        m.label.toLowerCase().includes(searchTerm) ||
        m.providerKey.toLowerCase().includes(searchTerm) ||
        m.modelId.toLowerCase().includes(searchTerm)
      );

      // 1.5. Apply Filter Rules (minSweScore, excludedProviders) - marks as excluded for display
      const { minSweScore, excludedProviders } = filterRules;
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

      // 2. Apply Checkbox Filters
      const getChecked = (id) => Array.from(document.querySelectorAll(`#${id} input:checked`)).map(cb => cb.value);
      const allChecked = (id) => document.querySelectorAll(`#${id} input`).length === document.querySelectorAll(`#${id} input:checked`).length;

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

      const liveSortOn = document.getElementById('live-sort-toggle').checked;
      let sorted;

      // When the user acts OR liveSort is checked OR it's the first paint, sort properly:
      if (isUserAction || liveSortOn || currentRenderedOrder.length === 0) {
        sorted = sortedModels(filtered);
      } else {
        // Live sort is OFF: lock elements to their previously rendered positions,
        // but allow new data updates. New models fall to bottom.
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

      const newOrderIds = sorted.map(m => m.modelId).join(',');
      const oldOrderIds = currentRenderedOrder.join(',');
      const currentRows = Array.from(tbody.rows);

      // We only recreate DOM nodes if length changed or the exact visual order shifted
      if (newOrderIds !== oldOrderIds || sorted.length !== currentRows.length) {
        tbody.innerHTML = '';
        sorted.forEach(m => tbody.appendChild(createRow(m)));
        currentRenderedOrder = sorted.map(m => m.modelId);
        return;
      }

      // Update existing rows
      sorted.forEach((m, i) => {
        const row = currentRows[i];
        const hasPing = m.avg !== Infinity && m.avg !== null;

        // Update pin button state in first cell
        const pinBtn = row.cells[0].querySelector('.pin-row-btn');
        if (pinBtn) {
          const isPinnedRow = activePinnedRowKeys.includes(getModelRowKey(m));
          pinBtn.className = 'pin-row-btn' + (isPinnedRow ? ' pinned' : '');
          pinBtn.onclick = () => pinModel(isPinnedRow ? '' : m.modelId, m.providerKey);
          pinBtn.title = isPinnedRow ? 'Unpin model' : 'Pin model';
        }

        // Update model name cell (ban status can change)
        const modelCell = row.cells[1];
        const isBannedRow = m.status === 'banned';
        const isExcludedRow = m.status === 'excluded';
        row.style.opacity = isExcludedRow || isBannedRow ? '0.5' : '1';
        modelCell.querySelector('div').firstChild.textContent = (isBannedRow ? '🚫 ' : (isExcludedRow ? '⛔ ' : '')) + m.label;
        modelCell.onclick = () => openDrawer(m);

        // Update QoS
        const qosCell = row.cells[2];
        qosCell.innerHTML = `<div style="font-weight: 700; color: ${getQosColor(m.qos)}">${getQosDisplayValue(m.qos)}</div>`;

        // Update Intell
        const intellCell = row.cells[3];
        intellCell.innerHTML = `<div style="font-weight: 600;">${getBenchmarkTableDisplayValue(m.intell, m.isEstimatedScore)}</div>`;

        // Update status dot and text
        const statusCell = row.cells[6];
        statusCell.innerHTML = `
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="width: 6px; height: 6px; border-radius: 50%; background: ${m.status === 'up' ? 'var(--success)' : (m.status === 'disabled' || m.status === 'banned' || m.status === 'excluded') ? 'var(--text-muted)' : 'var(--error)'}"></span>
              <span style="font-size: 0.75rem; font-weight: 500; text-transform: capitalize;">${m.status === 'noauth' ? 'No Auth' : m.status}</span>
            </div>
          `;

        // Update ping
        const pingCell = row.cells[4];
        const pingDot = pingCell.querySelector('.ping-dot');
        const pingTextEl = pingCell.querySelector('div[style*="text-align"]') || pingCell.querySelector('div:last-child');
        if (hasPing) {
          if (pingDot) {
            pingDot.className = 'ping-dot active ' + getPingAnimClass(m.avg);
            pingDot.style.setProperty('--speed', getPingSpeed(m.avg));
          }
          if (pingTextEl) pingTextEl.innerHTML = `<div style="font-size:0.82rem;">${m.avg}ms</div><div style="font-size:0.7rem; color:var(--text-muted);">(${m.lastPing}ms)</div>`;
        } else {
          if (pingDot) pingDot.className = 'ping-dot';
          if (pingTextEl) pingTextEl.innerHTML = '<span style="font-size: 0.75rem; color: var(--text-muted);">OFFLINE</span>';
        }

        // Update uptime and rate icon
        const uptimeCell = row.cells[5];
        const uptimeContainer = uptimeCell.querySelector('div');
        uptimeContainer.style.justifyContent = 'flex-end';
        uptimeContainer.querySelector('.progress-fill').style.width = m.uptime + '%';
        uptimeCell.querySelector('.progress-fill').style.background = m.uptime < 85 ? 'var(--warning)' : (m.uptime < 50 ? 'var(--error)' : 'var(--success)');
        uptimeCell.querySelector('.uptime-text').textContent = m.uptime + '%';

        const rateIcon = uptimeCell.querySelector('.rate-icon');
        if (rateIcon) {
          rateIcon.textContent = m.isRateLimited ? '🕑' : '✅';
          rateIcon.title = m.isRateLimited ? 'Rate limit exceeded, waiting to reset' : 'Rate available';
          rateIcon.style.opacity = '1';
        }
      });
    }

    function createRow(m) {
      const tr = document.createElement('tr');
      tr.style.opacity = m.status === 'excluded' || m.status === 'banned' ? '0.5' : '1';
      const hasPing = m.avg !== Infinity && m.avg !== null;
      const pingClass = getPingAnimClass(m.avg);
      const pingSpeed = getPingSpeed(m.avg);

      const isPinnedRow = activePinnedRowKeys.includes(getModelRowKey(m));
      tr.innerHTML = `
          <td>
            <div style="display:flex; flex-direction:column; gap:2px; align-items:center;">
              <div class="expand-btn" onclick='openDrawer(${JSON.stringify(m).replace(/'/g, "&apos;")})'>
                <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </div>
              <div class="pin-row-btn ${isPinnedRow ? 'pinned' : ''}" onclick="pinModel('${isPinnedRow ? '' : m.modelId}', '${m.providerKey}')" title="${isPinnedRow ? 'Unpin model' : 'Pin model'}">📌</div>
            </div>
          </td>
          <td style="cursor:pointer;" onclick='openDrawer(${JSON.stringify(m).replace(/'/g, "&apos;")})'>
            <div style="font-weight: 600;">${m.status === 'banned' ? '🚫 ' : (m.status === 'excluded' ? '⛔ ' : '')}${m.label}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${m.providerKey}</div>
          </td>
          <td>
            <div style="font-weight: 700; color: ${getQosColor(m.qos)}">${getQosDisplayValue(m.qos)}</div>
          </td>
          <td><div style="font-weight: 600;">${getBenchmarkTableDisplayValue(m.intell, m.isEstimatedScore)}</div></td>
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

    function getPingAnimClass(ms) {
      if (ms === Infinity || ms === null) return '';
      if (ms < 400) return 'anim-fast';
      if (ms < 1200) return 'anim-medium';
      return 'anim-slow';
    }

    function getPingSpeed(ms) {
      if (ms === Infinity || ms === null) return '0s';
      if (ms < 400) return '3.5s';
      if (ms < 1200) return '2.5s';
      return '1.8s';
    }

    function getQosDisplayValue(qos) {
      const n = Number(qos);
      if (!Number.isFinite(n)) return 0;
      return Math.round(n);
    }

    function getQosColor(qos) {
      const n = Number(qos);
      if (!Number.isFinite(n)) return 'var(--error)';
      if (n >= 45) return '#16a34a';
      if (n >= 40) return '#4ade80';
      if (n >= 20) return 'var(--warning)';
      return 'var(--error)';
    }

    function getBenchmarkSortValue(value) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return n;
    }

    function getBenchmarkDisplayValue(value, isEstimated = false) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return '—';
      const pill = isEstimated ? '<span class="pill-estimate">Unknown</span>' : '';
      return `${Math.round(n * 100)}${pill}`;
    }

    function getBenchmarkTableDisplayValue(value, isEstimated = false) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return '—';
      const score = Math.round(n * 100);
      const pill = isEstimated ? '<span class="pill-estimate">Unknown</span>' : '';
      return `${score}${pill}`;
    }

    function formatIsoDateTime(value) {
      if (!value) return 'Never';
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return 'Never';
      return d.toLocaleString();
    }

    function formatPingHover(p) {
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

    function setAutoUpdateSaveStatus(message, tone = 'muted') {
      const statusEl = document.getElementById('autoupdate-save-status');
      if (!statusEl) return;
      statusEl.className = `autoupdate-save-status${tone === 'success' ? ' success' : tone === 'error' ? ' error' : ''}`;
      statusEl.textContent = message || '';
    }

    function applyAutoUpdateState(state) {
      if (!state) return;
      const enabled = state.enabled !== false;
      const stateText = enabled ? 'On' : 'Off';

      const stateEl = document.getElementById('autoupdate-state');
      if (stateEl) stateEl.textContent = stateText;

      const pillEl = document.getElementById('autoupdate-pill');
      if (pillEl) {
        pillEl.textContent = stateText;
        pillEl.classList.remove('on', 'off');
        pillEl.classList.add(enabled ? 'on' : 'off');
      }

      const enabledInput = document.getElementById('autoupdate-enabled');
      if (enabledInput) enabledInput.checked = enabled;

      const intervalInput = document.getElementById('autoupdate-interval');
      if (intervalInput && Number.isFinite(Number(state.intervalHours)) && Number(state.intervalHours) > 0) {
        intervalInput.value = String(Number(state.intervalHours));
      }

      const lastCheckEl = document.getElementById('autoupdate-last-check');
      if (lastCheckEl) lastCheckEl.textContent = formatIsoDateTime(state.lastCheckAt);

      const lastUpdateEl = document.getElementById('autoupdate-last-update');
      if (lastUpdateEl) lastUpdateEl.textContent = formatIsoDateTime(state.lastUpdateAt);

      const lastVersionEl = document.getElementById('autoupdate-last-version');
      if (lastVersionEl) lastVersionEl.textContent = state.lastVersionApplied || 'None';

      const lastErrorEl = document.getElementById('autoupdate-last-error');
      if (lastErrorEl) {
        const msg = state.lastError || 'None';
        lastErrorEl.textContent = msg;
        lastErrorEl.classList.toggle('error', !!state.lastError);
      }
    }

    async function saveAutoUpdateSettings() {
      const enabledEl = document.getElementById('autoupdate-enabled');
      const intervalEl = document.getElementById('autoupdate-interval');
      if (!enabledEl || !intervalEl) return;

      const intervalHours = Number(intervalEl.value);
      if (!Number.isFinite(intervalHours) || intervalHours <= 0) {
        setAutoUpdateSaveStatus('Interval must be a positive number of hours.', 'error');
        return;
      }

      setAutoUpdateSaveStatus('Saving...');

      try {
        const res = await fetch('/api/autoupdate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: enabledEl.checked, intervalHours })
        });

        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || 'Failed to save auto-update settings.');
        }

        const payload = await res.json();
        const state = payload.autoUpdate || null;
        if (state) applyAutoUpdateState(state);
        setAutoUpdateSaveStatus('Saved.', 'success');
      } catch (err) {
        setAutoUpdateSaveStatus(err.message || 'Failed to save auto-update settings.', 'error');
      }
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
      pinningMode = mode;

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

    async function updatePinningMode(mode) {
      const nextMode = mode === 'exact' ? 'exact' : 'canonical';
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinningMode: nextMode })
      });
      pinningMode = nextMode;
      await loadSettings();
      await fetchData();
    }

    function renderFilterRules(filterRulesFromServer, providers) {
      const container = document.getElementById('filter-rules-container');
      if (!container || !filterRulesFromServer) return;

      // Store globally for immediate table filtering
      filterRules = {
        minSweScore: filterRulesFromServer.minSweScore,
        excludedProviders: filterRulesFromServer.excludedProviders || []
      };

      const minSweScore = filterRules.minSweScore;
      const excludedProviders = filterRules.excludedProviders || [];

      const providerCheckboxes = providers.map(p => `
        <label style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #f8fafc; border-radius: 8px; cursor: pointer; font-size: 0.875rem;">
          <input type="checkbox" class="excluded-provider-checkbox" value="${escapeHtml(p.key)}" ${excludedProviders.includes(p.key) ? 'checked' : ''}>
          ${escapeHtml(p.name)}
        </label>
      `).join('');

      container.innerHTML = `
        <div class="autoupdate-panel">
          <div style="display: flex; flex-direction: column; gap: 20px;">
            <div>
              <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.875rem;">
                Minimum SWE Score
              </label>
              <div style="display: flex; align-items: center; gap: 8px;">
                <input type="number" id="min-swe-score" min="0" max="100" step="1" value="${minSweScore !== null ? Math.round(minSweScore * 100) : ''}" placeholder="e.g. 50" style="width: 80px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 0.875rem;">
                <span style="color: var(--text-muted); font-size: 0.875rem;">%</span>
              </div>
              <p style="color: var(--text-muted); font-size: 0.78rem; margin-top: 6px;">Models with SWE% below this threshold will be excluded from pinging and routing.</p>
            </div>

            <div>
              <label style="display: block; font-weight: 600; margin-bottom: 8px; font-size: 0.875rem;">
                Excluded Providers
              </label>
              <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                ${providerCheckboxes}
              </div>
              <p style="color: var(--text-muted); font-size: 0.78rem; margin-top: 6px;">All models from these providers will be excluded from pinging and routing.</p>
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

    async function saveFilterRules() {
      const minSweInput = document.getElementById('min-swe-score');
      const minSweValue = minSweInput.value.trim();
      let minSweScore = null;
      if (minSweValue !== '') {
        const parsed = parseInt(minSweValue, 10);
        if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 100) {
          minSweScore = parsed / 100;
        }
      }

      const checkboxes = document.querySelectorAll('.excluded-provider-checkbox:checked');
      const excludedProviders = Array.from(checkboxes).map(cb => cb.value);

      try {
        const res = await fetch('/api/filter-rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minSweScore, excludedProviders })
        });
        if (!res.ok) throw new Error('Failed to save filter rules');
        const data = await res.json();
        document.getElementById('filter-rules-save-status').textContent = 'Saved!';
        setTimeout(() => {
          document.getElementById('filter-rules-save-status').textContent = '';
        }, 2000);
        fetchData();
      } catch (err) {
        document.getElementById('filter-rules-save-status').textContent = err.message || 'Failed to save.';
        document.getElementById('filter-rules-save-status').style.color = 'var(--error)';
      }
    }

    function setConfigTransferStatus(message, tone = '') {
      const statusEl = document.getElementById('config-transfer-status');
      if (!statusEl) return;
      statusEl.textContent = message || '';
      statusEl.className = `autoupdate-save-status${tone === 'success' ? ' success' : tone === 'error' ? ' error' : ''}`;
    }

    async function exportConfigTokenToBox() {
      try {
        const res = await fetch('/api/config/export');
        const payload = await res.json();
        if (!res.ok || !payload?.payload) {
          throw new Error(payload?.error || 'Failed to export settings.');
        }
        const box = document.getElementById('config-transfer-payload');
        if (box) box.value = payload.payload;
        setConfigTransferStatus('Config token exported.', 'success');
      } catch (err) {
        setConfigTransferStatus(err.message || 'Failed to export settings.', 'error');
      }
    }

    async function copyConfigTokenFromBox() {
      const box = document.getElementById('config-transfer-payload');
      const value = (box?.value || '').trim();
      if (!value) {
        setConfigTransferStatus('Nothing to copy. Export first or paste a token.', 'error');
        return;
      }

      try {
        await navigator.clipboard.writeText(value);
        setConfigTransferStatus('Copied token to clipboard.', 'success');
      } catch {
        setConfigTransferStatus('Clipboard copy failed. Please copy manually.', 'error');
      }
    }

    async function importConfigTokenFromBox() {
      const box = document.getElementById('config-transfer-payload');
      const payload = (box?.value || '').trim();
      if (!payload) {
        setConfigTransferStatus('Paste a config token before importing.', 'error');
        return;
      }

      if (!confirm('Importing will overwrite your current settings (including API keys). Continue?')) {
        return;
      }

      try {
        const res = await fetch('/api/config/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to import settings.');
        }
        setConfigTransferStatus('Config imported successfully.', 'success');
        await loadSettings();
        await fetchData();
      } catch (err) {
        setConfigTransferStatus(err.message || 'Failed to import settings.', 'error');
      }
    }

    async function loadSettings() {
      try {
        const [providersRes, autoUpdateRes, filterRulesRes, pinningRes] = await Promise.all([
          fetch('/api/config'),
          fetch('/api/autoupdate'),
          fetch('/api/filter-rules'),
          fetch('/api/pinning'),
        ]);
        const providers = await providersRes.json();
        const autoUpdate = await autoUpdateRes.json();
        const filterRules = await filterRulesRes.json();
        const pinning = await pinningRes.json();
        renderAutoUpdateSettings(autoUpdate);
        renderPinningSettings(pinning);
        renderFilterRules(filterRules, providers);
        renderProviderFilterGroup(providers);
        const container = document.getElementById('providers-container');
        container.innerHTML = '';

        providers.sort((a, b) => {
          if (a.hasKey && !b.hasKey) return -1;
          if (!a.hasKey && b.hasKey) return 1;
          return a.name.localeCompare(b.name);
        }).forEach(p => {
          const now = Date.now();
          const providerModels = allModels ? allModels.filter(m => m.providerKey === p.key) : [];
          // Count models for this provider from allModels
          const modelCount = providerModels.length;
          // Get rate limit info from a model with this provider that has rateLimit data
          const rlModel = providerModels.find(m => m.rateLimit) || null;
          const rl = rlModel?.rateLimit;
          const errorModel = providerModels
            .filter(m => {
              if (!m.lastError || m.status === 'up') return false;
              const updatedAtMs = Date.parse(m.lastError.updatedAt || '');
              return !Number.isNaN(updatedAtMs) && (now - updatedAtMs) <= PROVIDER_ERROR_MAX_AGE_MS;
            })
            .sort((a, b) => {
              const aTs = Date.parse(a.lastError.updatedAt || '');
              const bTs = Date.parse(b.lastError.updatedAt || '');
              if (Number.isNaN(aTs) && Number.isNaN(bTs)) return 0;
              if (Number.isNaN(aTs)) return 1;
              if (Number.isNaN(bTs)) return -1;
              return bTs - aTs;
            })[0] || null;
          const providerError = errorModel ? errorModel.lastError : null;

          const tokenOptional = p.supportsOptionalBearerAuth === true;
          const statusIcon = p.hasKey ? '✅' : (tokenOptional ? 'ℹ️' : '⚠️');
          const statusColor = p.hasKey ? '#065f46' : (tokenOptional ? '#1e40af' : '#92400e');
          const statusBg = p.hasKey ? '#ecfdf5' : (tokenOptional ? '#eff6ff' : '#fffbeb');
          const statusText = p.hasKey
            ? (tokenOptional ? 'API Key configured' : 'Key configured')
            : (tokenOptional ? 'API Key optional' : 'No API key');

          let rateLimitHtml = '';
          if (rl) {
            const fmtNum = n => n >= 1000 ? (n / 1000).toFixed(0) + 'k' : String(n);
            const fmtTime = ts => {
              if (!ts) return null;
              const d = new Date(ts);
              return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
            };
            const creditLine = rl.creditLimit != null
              ? `<span>Credits: <b>${fmtNum(rl.creditRemaining ?? '?')}</b> / ${fmtNum(rl.creditLimit)} remaining</span>`
              : '';
            const creditResetLine = rl.creditResetAt ? `<span>Credit reset: <b>${fmtTime(rl.creditResetAt) ?? 'unknown'}</b></span>` : '';
            rateLimitHtml = `
              <div style="margin-top:12px; padding:10px 12px; background:#f8fafc; border:1px solid var(--border); border-radius:8px; font-size:0.78rem;">
                <div style="font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:6px; font-size:0.7rem;">Rate Limits (last prompt)</div>
                <div style="display:flex; gap:16px; flex-wrap:wrap;">
                  ${rl.limitRequests != null ? `<span>Requests: <b>${fmtNum(rl.remainingRequests ?? '?')}</b> / ${fmtNum(rl.limitRequests)} remaining</span>` : ''}
                  ${rl.limitTokens != null ? `<span>Tokens: <b>${fmtNum(rl.remainingTokens ?? '?')}</b> / ${fmtNum(rl.limitTokens)} remaining</span>` : ''}
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
              <div style="margin-top:12px; padding:10px 12px; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; font-size:0.78rem; color:#7f1d1d;">
                <div style="font-weight:600; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:6px; font-size:0.7rem; color:#991b1b;">Latest Provider Error</div>
                <div style="word-break:break-word;"><b>${escapeHtml(errorModel.modelId)}</b>: ${escapeHtml(providerError.message)}</div>
                <div style="margin-top:6px; color:#b91c1c;">HTTP ${escapeHtml(providerError.code || '?')} • ${escapeHtml(errorWhen)}</div>
              </div>`;
          }

          const openAiCompatibleFieldsHtml = p.key === 'openai-compatible' ? `
            <div class="form-group" style="display:flex; gap:8px; align-items:center; margin-top:8px;">
              <input type="text" id="base-url-${p.key}" value="${escapeHtml(p.baseUrl || '')}" placeholder="https://your-endpoint.example/v1" style="flex:1;" onblur="updateProviderBaseUrl('${p.key}')">
            </div>
            <div class="form-group" style="display:flex; gap:8px; align-items:center; margin-top:8px;">
              <input type="text" id="model-id-${p.key}" value="${escapeHtml(p.modelId || '')}" placeholder="upstream-model-id" style="flex:1;" onblur="updateProviderModelId('${p.key}')">
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">Set the upstream base URL and exact model ID for this provider.</div>
          ` : '';

          const qwenAuthActionsHtml = p.key === 'qwencode' ? `
            <div style="margin-top:10px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <button onclick="startQwenOAuthLogin()" style="border:1px solid var(--border); background:#fff; cursor:pointer; padding:8px 12px; border-radius:6px; font-size:0.78rem; font-weight:600;">Login with Qwen Code</button>
              <span id="qwencode-login-status" style="font-size:0.75rem; color:var(--text-muted);"></span>
            </div>
          ` : '';

          const optionalBearerAuthHtml = (tokenOptional && p.hasKey) ? `
            <div style="margin-top:10px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <label style="display:flex; align-items:center; gap:6px; font-size:0.8rem; cursor:pointer;">
                <input type="checkbox" id="bearer-auth-${p.key}" ${p.useBearerAuth !== false ? 'checked' : ''} onchange="updateProviderBearerAuth('${p.key}')">
                Attach API Key as Bearer
              </label>
            </div>
          ` : '';

          const section = document.createElement('div');
          section.className = 'provider-section';
          section.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.75rem;">
              <div style="display:flex; align-items:center; gap:10px;">
                <span style="background:${statusBg}; color:${statusColor}; border-radius:999px; padding:2px 10px; font-size:0.75rem; font-weight:600;">${statusIcon} ${statusText}</span>
                <h3 style="margin:0; font-size:1rem;">${p.name}</h3>
                ${modelCount > 0 ? `<span style="background:#f3f2f1; color:var(--text-muted); border-radius:999px; padding:2px 8px; font-size:0.72rem; font-weight:600;">${modelCount} model${modelCount !== 1 ? 's' : ''}</span>` : ''}
                ${p.signupUrl ? `<a href="${p.signupUrl}" target="_blank" rel="noopener noreferrer" style="font-size:0.78rem; color:var(--accent); text-decoration:none; font-weight:600;">Get API key</a>` : ''}
              </div>
              <div style="display:flex; align-items:center; gap:10px;">
                <label style="display:flex; align-items:center; gap:6px; font-size:0.8rem; cursor:pointer;">
                  <input type="checkbox" id="enable-${p.key}" ${p.enabled ? 'checked' : ''} onchange="updateProvider('${p.key}')">
                  Enabled
                </label>
              </div>
            </div>
            <div class="form-group" style="display:flex; gap:8px; align-items:center;">
              <input type="password" id="key-${p.key}" placeholder="${p.hasKey ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (' + (tokenOptional ? 'API Key Configured' : 'Key Configured') + ')' : (tokenOptional ? 'Enter API Key (optional)...' : 'Enter API Key...')}" style="flex:1;" onblur="updateProviderKey('${p.key}')">
              <button onclick="const i=document.getElementById('key-${p.key}'); i.type=i.type==='password'?'text':'password'; this.textContent=i.type==='password'?'👁':'🙈';" style="border:1px solid var(--border); background:white; cursor:pointer; padding:8px 10px; border-radius:6px; font-size:0.85rem; white-space:nowrap;">👁</button>
              ${p.hasKey ? `<button onclick="deleteProviderKey('${p.key}')" style="border:1px solid #fecaca; background:#fff1f2; color:#b91c1c; cursor:pointer; padding:8px 12px; border-radius:6px; font-size:0.8rem; font-weight:600; white-space:nowrap;">Delete Key</button>` : ''}
            </div>
            <div class="form-group" style="display:flex; gap:8px; align-items:center; margin-top:8px;">
              <span style="font-size:0.75rem; color:var(--text-muted); white-space:nowrap;">Ping interval (min):</span>
              <input type="number" id="ping-interval-${p.key}" min="1" step="1" value="${p.pingIntervalMinutes || ''}" placeholder="30" style="width:70px; padding:6px 10px; border:1px solid var(--border); border-radius:6px; font-size:0.8rem;" onchange="updateProviderPingInterval('${p.key}')">
              <span style="font-size:0.75rem; color:var(--text-muted);">(default: 30)</span>
            </div>
            ${optionalBearerAuthHtml}
            ${openAiCompatibleFieldsHtml}
            ${qwenAuthActionsHtml}
            ${providerErrorHtml}
            ${rateLimitHtml}
          `;
          container.appendChild(section);
        });
      } catch (err) { console.error(err); }
    }

    async function updateProvider(key) {
      const enabled = document.getElementById(`enable-${key}`).checked;
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerKey: key, enabled })
      });
    }

    async function updateProviderKey(key) {
      const input = document.getElementById(`key-${key}`);
      const val = input.value.trim();
      if (!val) return;
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerKey: key, apiKey: val })
      });
      input.value = '';
      loadSettings();
    }

    async function deleteProviderKey(key) {
      const input = document.getElementById(`key-${key}`);
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerKey: key, apiKey: null })
      });
      if (input) input.value = '';
      await loadSettings();
      await fetchData();
    }

    async function updateProviderBaseUrl(key) {
      const input = document.getElementById(`base-url-${key}`);
      const baseUrl = input ? input.value.trim() : '';
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerKey: key, baseUrl })
      });
      await fetchData();
    }

    async function updateProviderModelId(key) {
      const input = document.getElementById(`model-id-${key}`);
      const modelId = input ? input.value.trim() : '';
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerKey: key, modelId })
      });
      await fetchData();
    }

    async function updateProviderPingInterval(key) {
      const input = document.getElementById(`ping-interval-${key}`);
      const val = input.value.trim();
      let pingIntervalMinutes = null;
      if (val !== '') {
        const parsed = parseInt(val, 10);
        if (!Number.isNaN(parsed) && parsed >= 1) {
          pingIntervalMinutes = parsed;
        }
      }
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerKey: key, pingIntervalMinutes })
      });
    }

    async function updateProviderBearerAuth(key) {
      const input = document.getElementById(`bearer-auth-${key}`);
      if (!input) return;
      const useBearerAuth = input.checked;
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerKey: key, useBearerAuth })
      });
    }

    function setQwenLoginStatus(message, isError = false) {
      const statusEl = document.getElementById('qwencode-login-status');
      if (!statusEl) return;
      statusEl.style.color = isError ? 'var(--error)' : 'var(--text-muted)';
      statusEl.textContent = message || '';
    }

    async function pollQwenOAuthLoginStatus() {
      if (!qwenOauthSessionId) return;
      try {
        const res = await fetch(`/api/qwencode/login/status?sessionId=${encodeURIComponent(qwenOauthSessionId)}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to fetch Qwen OAuth login status.');
        }

        const data = await res.json();
        if (data.status === 'authorized') {
          setQwenLoginStatus('Qwen OAuth connected.');
          if (qwenOauthPollTimer) {
            clearInterval(qwenOauthPollTimer);
            qwenOauthPollTimer = null;
          }
          qwenOauthSessionId = null;
          loadSettings();
          fetchData();
          return;
        }

        if (data.status === 'error') {
          setQwenLoginStatus(data.error || 'Qwen OAuth login failed.', true);
          if (qwenOauthPollTimer) {
            clearInterval(qwenOauthPollTimer);
            qwenOauthPollTimer = null;
          }
          qwenOauthSessionId = null;
          return;
        }

        if (data.status === 'expired') {
          setQwenLoginStatus('Qwen login session expired. Click Login again.', true);
          if (qwenOauthPollTimer) {
            clearInterval(qwenOauthPollTimer);
            qwenOauthPollTimer = null;
          }
          qwenOauthSessionId = null;
          return;
        }

        setQwenLoginStatus('Waiting for Qwen authorization...');
      } catch (err) {
        setQwenLoginStatus(err.message || 'Failed to poll Qwen OAuth status.', true);
      }
    }

    async function startQwenOAuthLogin() {
      try {
        setQwenLoginStatus('Starting Qwen OAuth login...');
        const res = await fetch('/api/qwencode/login/start', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to start Qwen OAuth login.');
        }

        qwenOauthSessionId = data.sessionId;
        if (data.verificationUriComplete) {
          window.open(data.verificationUriComplete, '_blank', 'noopener,noreferrer');
        }

        const codeSuffix = data.userCode ? ` (code: ${data.userCode})` : '';
        setQwenLoginStatus(`Complete login in browser${codeSuffix}`);

        if (qwenOauthPollTimer) clearInterval(qwenOauthPollTimer);
        const pollMs = Number(data.pollIntervalMs) > 0 ? Number(data.pollIntervalMs) : 2000;
        qwenOauthPollTimer = setInterval(pollQwenOAuthLoginStatus, pollMs);
        pollQwenOAuthLoginStatus();
      } catch (err) {
        setQwenLoginStatus(err.message || 'Failed to start Qwen OAuth login.', true);
      }
    }

    function loadChatState() {
      try {
        const rawMessages = sessionStorage.getItem(CHAT_STORAGE_KEY);
        const parsedMessages = rawMessages ? JSON.parse(rawMessages) : [];
        chatMessages = Array.isArray(parsedMessages)
          ? parsedMessages
            .filter(m => m && typeof m.role === 'string' && m.content != null)
            .map(m => ({
              role: String(m.role),
              content: typeof m.content === 'string' ? m.content : formatMessageContent(m.content),
              ts: typeof m.ts === 'string' ? m.ts : new Date().toISOString(),
              model: typeof m.model === 'string' && m.model.trim() ? m.model.trim() : null
            }))
          : [];

        const rawModel = sessionStorage.getItem(CHAT_MODEL_STORAGE_KEY);
        chatSelectedModel = rawModel && typeof rawModel === 'string' ? rawModel : 'auto-fastest';
      } catch {
        chatMessages = [];
        chatSelectedModel = 'auto-fastest';
      }
    }

    function saveChatState() {
      try {
        sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatMessages));
        sessionStorage.setItem(CHAT_MODEL_STORAGE_KEY, chatSelectedModel || 'auto-fastest');
      } catch {
        // Ignore storage failures and keep chat in-memory.
      }
    }

    function updateChatModelOptions(models = []) {
      const select = document.getElementById('chat-model-select');
      if (!select) return;

      const previousSelection = chatSelectedModel || select.value || 'auto-fastest';
      const options = [
        { value: 'auto-fastest', label: 'Auto (Fastest Available)' },
        ...models
          .filter(m => m && m.modelId)
          .sort((a, b) => (a.label || a.modelId).localeCompare(b.label || b.modelId))
          .map(m => ({
            value: m.modelId,
            label: `${m.label || m.modelId} · ${m.providerKey}`
          }))
      ];

      const deduped = [];
      const seen = new Set();
      for (const opt of options) {
        if (seen.has(opt.value)) continue;
        seen.add(opt.value);
        deduped.push(opt);
      }

      select.innerHTML = deduped
        .map(opt => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`)
        .join('');

      const hasPrevious = deduped.some(opt => opt.value === previousSelection);
      chatSelectedModel = hasPrevious ? previousSelection : 'auto-fastest';
      select.value = chatSelectedModel;
      saveChatState();
    }

    function onChatModelChange() {
      const select = document.getElementById('chat-model-select');
      chatSelectedModel = (select && select.value) ? select.value : 'auto-fastest';
      saveChatState();
      setChatStatus(`Using model: ${chatSelectedModel}`, 'muted');
    }

    function setChatStatus(message, tone = 'muted') {
      const statusEl = document.getElementById('chat-status');
      if (!statusEl) return;
      statusEl.className = `chat-status${tone === 'error' ? ' error' : tone === 'success' ? ' success' : ''}`;
      statusEl.textContent = message || '';
    }

    function scrollChatToBottom() {
      const transcript = document.getElementById('chat-transcript');
      if (!transcript) return;
      transcript.scrollTop = transcript.scrollHeight;
    }

    function renderChatTranscript() {
      const transcript = document.getElementById('chat-transcript');
      if (!transcript) return;

      if (!chatMessages.length) {
        transcript.innerHTML = `
          <div class="chat-empty">
            Start a conversation. Press Enter to send and Shift+Enter for a newline.
          </div>
        `;
        return;
      }

      transcript.innerHTML = chatMessages.map(msg => {
        const role = msg && msg.role ? String(msg.role) : 'assistant';
        const roleClass = role === 'user' ? 'user' : role === 'system' ? 'system' : 'assistant';
        const content = escapeHtml(formatMessageContent(msg && msg.content != null ? msg.content : ''));
        const ts = msg && msg.ts ? new Date(msg.ts) : null;
        const tsLabel = ts && !Number.isNaN(ts.getTime())
          ? ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';
        const modelLabel = msg && typeof msg.model === 'string' && msg.model.trim() ? msg.model.trim() : '';
        const headerBits = [role];
        if (tsLabel) headerBits.push(tsLabel);
        if (role === 'assistant' && modelLabel) headerBits.push(modelLabel);

        return `
          <div class="chat-msg ${roleClass}">
            <div class="chat-msg-role">${headerBits.map(part => escapeHtml(part)).join(' • ')}</div>
            <div class="chat-msg-content">${content}</div>
          </div>
        `;
      }).join('');

      scrollChatToBottom();
    }

    function setChatInFlight(inFlight) {
      chatInFlight = !!inFlight;

      const sendBtn = document.getElementById('chat-send-btn');
      const clearBtn = document.getElementById('chat-clear-btn');
      const input = document.getElementById('chat-input');
      const modelSelect = document.getElementById('chat-model-select');
      const typing = document.getElementById('chat-typing-indicator');

      if (sendBtn) {
        sendBtn.disabled = chatInFlight;
        sendBtn.textContent = chatInFlight ? 'Sending...' : 'Send';
      }
      if (clearBtn) clearBtn.disabled = chatInFlight;
      if (input) input.disabled = chatInFlight;
      if (modelSelect) modelSelect.disabled = chatInFlight;
      if (typing) typing.style.display = chatInFlight ? 'flex' : 'none';
    }

    function handleChatInputKeydown(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
      }
    }

    function clearChat() {
      if (chatInFlight) return;
      chatMessages = [];
      saveChatState();
      setChatStatus('Chat cleared. Starting fresh.', 'success');
      renderChatTranscript();
      const input = document.getElementById('chat-input');
      if (input) input.focus();
    }

    function buildChatRequestMessages() {
      return chatMessages
        .filter(m => m && typeof m.role === 'string' && m.content != null)
        .map(m => ({
          role: String(m.role),
          content: typeof m.content === 'string' ? m.content : formatMessageContent(m.content)
        }));
    }

    function getAssistantTextFromResponse(data) {
      const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
      const message = choice && choice.message ? choice.message : null;
      if (!message) return '';

      if (typeof message.content === 'string' && message.content.trim() !== '') {
        return message.content;
      }

      if (Array.isArray(message.content)) {
        const joined = message.content.map(part => {
          if (typeof part === 'string') return part;
          if (part && part.type === 'text' && typeof part.text === 'string') return part.text;
          return '';
        }).filter(Boolean).join('\n');
        if (joined.trim() !== '') return joined;
      }

      if (message.tool_calls) {
        return JSON.stringify(message.tool_calls, null, 2);
      }
      if (message.function_call) {
        return JSON.stringify(message.function_call, null, 2);
      }

      return '';
    }

    async function sendChatMessage() {
      if (chatInFlight) return;
      const input = document.getElementById('chat-input');
      if (!input) return;

      const content = input.value.replace(/\r\n/g, '\n').trim();
      if (!content) {
        setChatStatus('Type a message before sending.', 'error');
        return;
      }

      const userMessage = { role: 'user', content, ts: new Date().toISOString() };
      chatMessages.push(userMessage);
      saveChatState();
      renderChatTranscript();
      input.value = '';
      setChatStatus('');
      setChatInFlight(true);

      try {
        const requestBody = {
          model: chatSelectedModel || 'auto-fastest',
          messages: buildChatRequestMessages()
        };

        const res = await fetch('/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const errorMessage = data?.error?.message || data?.error || data?.message || `Chat request failed (${res.status}).`;
          throw new Error(errorMessage);
        }

        const assistantText = getAssistantTextFromResponse(data);
        if (!assistantText) {
          throw new Error('The provider returned an empty assistant response.');
        }

        const responseModel = typeof data?.model === 'string' && data.model.trim() ? data.model.trim() : null;
        chatMessages.push({ role: 'assistant', content: assistantText, ts: new Date().toISOString(), model: responseModel });
        saveChatState();
        renderChatTranscript();
        setChatStatus('Response received.', 'success');
      } catch (err) {
        setChatStatus(err?.message || 'Failed to send message.', 'error');
      } finally {
        setChatInFlight(false);
        if (input) input.focus();
      }
    }

    function initializeChat() {
      loadChatState();
      updateChatModelOptions(allModels);
      renderChatTranscript();
      setChatInFlight(false);
      setChatStatus('');
    }

    function updateLogsPauseButton() {
      const pauseBtn = document.getElementById('logs-pause-toggle');
      if (!pauseBtn) return;
      pauseBtn.textContent = logsAutoRefreshPaused ? 'Resume Live Updates' : 'Pause Live Updates';
      pauseBtn.setAttribute('aria-pressed', logsAutoRefreshPaused ? 'true' : 'false');
    }

    function toggleLogsAutoRefresh() {
      logsAutoRefreshPaused = !logsAutoRefreshPaused;
      updateLogsPauseButton();
      if (!logsAutoRefreshPaused) {
        loadLogs(true);
      }
    }

    async function loadLogs(force = false) {
      if (!force && logsAutoRefreshPaused) return;
      try {
        const res = await fetch('/api/logs');
        const logs = await res.json();
        const container = document.getElementById('logs-container');

        if (logs.length === 0) {
          container.innerHTML = '<div style="padding: 32px; text-align: center; color: var(--text-muted); background: var(--card); border: 1px solid var(--border); border-radius: 12px;">No requests have been routed yet.</div>';
          return;
        }

        if (logsViewMode === 'history') {
          renderMessageHistory(logs, container);
          return;
        }

        const expandedCards = new Set();
        document.querySelectorAll('.log-card.expanded').forEach(card => {
          expandedCards.add(card.id);
        });

        container.innerHTML = logs.map(l => {
          const date = new Date(l.timestamp);
          const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const attempts = Array.isArray(l.attempts) ? l.attempts : [];
          const retryCount = typeof l.retryCount === 'number'
            ? l.retryCount
            : Math.max(0, attempts.length - 1);
          const hadFailover = retryCount > 0;
          let statusBadge = '';
          if (l.status === '200') statusBadge = '<span style="background: #ecfdf5; color: #065f46; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600;">200 OK</span>';
          else if (l.status === 'pending') statusBadge = '<span style="background: #eff6ff; color: #1e40af; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600;">Pending...</span>';
          else statusBadge = `<span style="background: #fef2f2; color: #991b1b; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600;">${l.status}</span>`;
          const resolvedModelChip = l.resolvedModel
            ? `<span style="background:#eef2ff; color:#3730a3; padding:2px 8px; border-radius:999px; font-size:0.7rem; font-weight:700;">resolved: ${escapeHtml(l.resolvedModel)}</span>`
            : '';

          let messagesArray = Array.isArray(l.messages) ? l.messages : (typeof l.messages === 'string' ? [{ role: 'raw', content: l.messages }] : []);
          const msgHtml = messagesArray.map(m => {
            const isSystem = m.role === 'system';
            const isUser = m.role === 'user';
            const colorVar = isSystem ? 'var(--warning)' : (isUser ? 'var(--success)' : 'var(--accent)');
            let formattedContent = typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2);
            // Replace brackets with HTML entities to prevent rendering issues
            formattedContent = (formattedContent || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            return `
              <div style="margin-top: 12px; border-left: 3px solid ${colorVar}; padding-left: 12px;">
                <div style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: ${colorVar}; margin-bottom: 4px;">${m.role}</div>
                <div style="font-family: monospace; font-size: 0.8rem; white-space: pre-wrap; word-break: break-word; color: var(--text); max-height: 200px; overflow-y: auto; background: #faf9f8; padding: 8px; border-radius: 6px; border: 1px solid var(--border);">${formattedContent}</div>
              </div>
            `;
          }).join('');

          let responseHtml = '';
          if (l.response) {
            let formattedResp = l.response.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            responseHtml = `
              <div style="margin-top: 12px; border-left: 3px solid var(--accent); padding-left: 12px;">
                <div style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); margin-bottom: 4px;">ASSISTANT</div>
                <div style="font-family: monospace; font-size: 0.8rem; white-space: pre-wrap; word-break: break-word; color: var(--text); max-height: 300px; overflow-y: auto; background: #faf9f8; padding: 8px; border-radius: 6px; border: 1px solid var(--border);">${formattedResp}</div>
              </div>
            `;
          }

          let toolCallsHtml = '';
          if (l.tool_calls && l.tool_calls.length > 0) {
            const numTools = l.tool_calls.length;
            const tcStr = JSON.stringify(l.tool_calls, null, 2).replace(/</g, '&lt;').replace(/>/g, '&gt;');
            toolCallsHtml = `
              <div style="margin-top: 12px; border-left: 3px solid var(--accent); padding-left: 12px;">
                <div style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); margin-bottom: 4px;">TOOL CALLS (${numTools})</div>
                <div style="font-family: monospace; font-size: 0.8rem; white-space: pre-wrap; word-break: break-word; color: var(--text); max-height: 200px; overflow-y: auto; background: #faf9f8; padding: 8px; border-radius: 6px; border: 1px solid var(--border);">${tcStr}</div>
              </div>
            `;
          }

          let functionCallHtml = '';
          if (l.function_call) {
            const fcStr = JSON.stringify(l.function_call, null, 2).replace(/</g, '&lt;').replace(/>/g, '&gt;');
            functionCallHtml = `
              <div style="margin-top: 12px; border-left: 3px solid var(--accent); padding-left: 12px;">
                <div style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); margin-bottom: 4px;">FUNCTION CALL</div>
                <div style="font-family: monospace; font-size: 0.8rem; white-space: pre-wrap; word-break: break-word; color: var(--text); max-height: 200px; overflow-y: auto; background: #faf9f8; padding: 8px; border-radius: 6px; border: 1px solid var(--border);">${fcStr}</div>
              </div>
            `;
          }

          let errorHtml = '';
          if (l.error) {
            let formattedErr = typeof l.error === 'string' ? l.error : JSON.stringify(l.error, null, 2);
            formattedErr = formattedErr.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            errorHtml = `
              <div style="margin-top: 12px; border-left: 3px solid var(--error); padding-left: 12px;">
                <div style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--error); margin-bottom: 4px;">PROXY ERROR</div>
                <div style="font-family: monospace; font-size: 0.8rem; white-space: pre-wrap; word-break: break-word; color: #7f1d1d; max-height: 200px; overflow-y: auto; background: #fef2f2; padding: 8px; border-radius: 6px; border: 1px solid #fecaca;">${formattedErr}</div>
              </div>
            `;
          }

          let failoverHtml = '';
          if (attempts.length > 0) {
            const attemptRows = attempts.map((a, idx) => {
              const code = a && a.status ? String(a.status) : 'unknown';
              const isOk = code === '200';
              const isRetryable = !!(a && a.retryable);
              const chipBg = isOk ? '#ecfdf5' : (isRetryable ? '#fffbeb' : '#fef2f2');
              const chipFg = isOk ? '#065f46' : (isRetryable ? '#92400e' : '#991b1b');
              const model = a && a.model ? a.model : '(unknown model)';
              const provider = a && a.provider ? a.provider : '(unknown provider)';
              const duration = a && a.duration != null ? `${a.duration}ms` : 'n/a';
              const err = a && a.error
                ? `<div style="margin-top:4px; color: var(--text-muted); font-size:0.72rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${String(a.error).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`
                : '';
              return `
                <div style="padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: #faf9f8;">
                  <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                    <div style="font-size:0.78rem; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><span style="color:var(--text-muted);">#${idx + 1}</span> ${provider}/${model}</div>
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                      <span style="font-size:0.7rem; color:var(--text-muted);">${duration}</span>
                      <span style="background:${chipBg}; color:${chipFg}; padding:2px 6px; border-radius:999px; font-size:0.68rem; font-weight:700;">${code}</span>
                    </div>
                  </div>
                  ${err}
                </div>`;
            }).join('');

            failoverHtml = `
              <div style="margin-top: 12px; border-left: 3px solid ${hadFailover ? 'var(--warning)' : 'var(--accent)'}; padding-left: 12px;">
                <div style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: ${hadFailover ? 'var(--warning)' : 'var(--accent)'}; margin-bottom: 6px;">ROUTING ATTEMPTS ${hadFailover ? `(Failovers: ${retryCount})` : ''}</div>
                <div style="display:flex; flex-direction:column; gap:6px;">${attemptRows}</div>
              </div>
            `;
          }

          const logModelStatus = allModels ? (allModels.find(m => m.modelId === l.model)?.status || 'unknown') : 'unknown';
          const isBanned = logModelStatus === 'banned';
          // Use a stable unique id for toggling
          const cardId = 'log-' + l.timestamp.replace(/[^a-z0-9]/gi, '');
          const isExpanded = expandedCards.has(cardId) ? ' expanded' : '';
          return `
            <div class="log-card${isExpanded}" id="${cardId}">
              <div class="log-card-header" onclick="toggleLogCard('${cardId}')">
                <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
                  <span class="log-chevron">▶</span>
                  <div style="min-width:0;">
                    <div style="display: flex; align-items: center; gap: 10px; flex-wrap:wrap;">
                      <span style="font-weight: 600; font-size: 0.95rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${l.model}</span>
                      ${resolvedModelChip}
                      ${statusBadge}
                    </div>
                    <div style="font-size: 0.78rem; color: var(--text-muted); display: flex; gap: 10px; flex-wrap: wrap; margin-top:2px;">
                      <span>${timeStr}</span>
                      <span>•</span>
                      <span>${l.provider}</span>
                      ${hadFailover ? `<span>•</span><span style="color: var(--warning); font-weight: 600;">🔁 ${retryCount} failover${retryCount > 1 ? 's' : ''}</span>` : ''}
                      ${l.duration ? `<span>•</span><span>${l.duration}ms total</span>` : ''}
                      ${l.ttft != null && l.ttft !== l.duration ? `<span>•</span><span style="color: var(--accent);">⚡ ${l.ttft}ms TTFT</span>` : ''}
                      ${l.prompt_tokens != null || l.completion_tokens != null ? `<span>•</span><span style="color: var(--text-muted);"><span style="font-weight: 600; color: var(--text);">${l.prompt_tokens || 0}</span> in / <span style="font-weight: 600; color: var(--text);">${l.completion_tokens || 0}</span> out</span>` : ''}
                    </div>
                  </div>
                </div>
              </div>
              <div class="log-card-body">
                ${msgHtml}
                ${responseHtml}
                ${toolCallsHtml}
                ${functionCallHtml}
                ${failoverHtml}
                ${errorHtml}
                <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border); display:flex; justify-content:flex-end;">
                  <button onclick="event.stopPropagation(); toggleBan('${l.model}', '${logModelStatus}')" style="background: ${isBanned ? '#e5e7eb' : '#fef2f2'}; border: 1px solid ${isBanned ? '#d1d5db' : '#fecaca'}; padding: 6px 14px; border-radius: 6px; font-size: 0.75rem; font-weight: 600; color: ${isBanned ? '#374151' : '#991b1b'}; cursor: pointer;">${isBanned ? '✓ Unban Model' : '🚫 Ban Model'}</button>
                </div>
              </div>
            </div>
          `;
        }).join('');
      } catch (err) { console.error(err); }
    }

    function setLogsViewMode(mode) {
      logsViewMode = mode === 'history' ? 'history' : 'cards';
      const cardsBtn = document.getElementById('logs-mode-cards');
      const historyBtn = document.getElementById('logs-mode-history');
      if (cardsBtn && historyBtn) {
        cardsBtn.classList.toggle('active', logsViewMode === 'cards');
        historyBtn.classList.toggle('active', logsViewMode === 'history');
        cardsBtn.setAttribute('aria-selected', logsViewMode === 'cards' ? 'true' : 'false');
        historyBtn.setAttribute('aria-selected', logsViewMode === 'history' ? 'true' : 'false');
      }
      loadLogs(true);
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function stableStringify(value) {
      if (value == null || typeof value !== 'object') {
        return JSON.stringify(value);
      }
      if (Array.isArray(value)) {
        return '[' + value.map(stableStringify).join(',') + ']';
      }
      const keys = Object.keys(value).sort();
      return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
    }

    function getLocalDayKey(ts) {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return 'invalid-day';
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    function simpleHash(input) {
      let hash = 2166136261;
      for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16);
    }

    function normalizeMessageForHash(msg) {
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

    function formatMessageContent(content) {
      if (typeof content === 'string') return content;
      if (content == null) return '';
      try {
        return JSON.stringify(content, null, 2);
      } catch {
        return String(content);
      }
    }

    function roleColor(role) {
      if (role === 'system') return 'var(--warning)';
      if (role === 'user') return 'var(--success)';
      if (role === 'assistant') return 'var(--accent)';
      if (role === 'tool') return '#8b5cf6';
      return 'var(--text-muted)';
    }

    function renderMessageHistory(logs, container) {
      const deduped = [];
      const seen = new Set();
      let insertSeq = 0;

      const mostRecentFirst = Array.isArray(logs) ? logs : [];
      for (const l of mostRecentFirst) {
        const timestamp = l && l.timestamp ? l.timestamp : null;
        const model = l && l.model ? l.model : '(unknown model)';
        const resolvedModel = l && l.resolvedModel ? l.resolvedModel : null;
        const sourceMessages = Array.isArray(l && l.messages)
          ? [...l.messages].reverse()
          : (typeof (l && l.messages) === 'string' ? [{ role: 'raw', content: l.messages }] : []);

        if (l && l.response) {
          const assistantCandidate = { role: 'assistant', content: l.response };
          const dedupeKey = `${getLocalDayKey(timestamp)}:${simpleHash(normalizeMessageForHash(assistantCandidate))}`;
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            deduped.push({ role: 'assistant', content: l.response, timestamp, model, resolvedModel, tsMs: Date.parse(timestamp || ''), seq: insertSeq++ });
          }
        }

        if (l && l.tool_calls) {
          const toolCallsCandidate = { role: 'assistant', content: l.tool_calls };
          const dedupeKey = `${getLocalDayKey(timestamp)}:${simpleHash(normalizeMessageForHash(toolCallsCandidate))}`;
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            deduped.push({ role: 'assistant', content: l.tool_calls, timestamp, model, resolvedModel, tsMs: Date.parse(timestamp || ''), seq: insertSeq++ });
          }
        }

        if (l && l.function_call) {
          const functionCallCandidate = { role: 'assistant', content: l.function_call };
          const dedupeKey = `${getLocalDayKey(timestamp)}:${simpleHash(normalizeMessageForHash(functionCallCandidate))}`;
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            deduped.push({ role: 'assistant', content: l.function_call, timestamp, model, resolvedModel, tsMs: Date.parse(timestamp || ''), seq: insertSeq++ });
          }
        }

        for (const m of sourceMessages) {
          const role = m && m.role ? String(m.role) : 'unknown';
          const content = m && m.content != null ? m.content : '';
          const candidate = {
            role,
            content,
            name: m && m.name ? m.name : '',
            tool_call_id: m && m.tool_call_id ? m.tool_call_id : '',
            tool_calls: m && m.tool_calls ? m.tool_calls : undefined,
            function_call: m && m.function_call ? m.function_call : undefined,
          };
          const dedupeKey = `${getLocalDayKey(timestamp)}:${simpleHash(normalizeMessageForHash(candidate))}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          deduped.push({ role, content, timestamp, model, resolvedModel, tsMs: Date.parse(timestamp || ''), seq: insertSeq++ });
        }
      }

      deduped.sort((a, b) => {
        const aTs = Number.isNaN(a.tsMs) ? -Infinity : a.tsMs;
        const bTs = Number.isNaN(b.tsMs) ? -Infinity : b.tsMs;
        if (bTs !== aTs) return bTs - aTs;
        return a.seq - b.seq;
      });

      if (deduped.length === 0) {
        container.innerHTML = '<div style="padding: 24px; text-align:center; color:var(--text-muted); background: var(--card); border: 1px solid var(--border); border-radius: 12px;">No messages found in recent request logs.</div>';
        return;
      }

      container.innerHTML = deduped.map(item => {
        const role = item.role || 'unknown';
        const date = new Date(item.timestamp);
        const timeStr = Number.isNaN(date.getTime())
          ? 'Unknown time'
          : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const dateStr = Number.isNaN(date.getTime())
          ? 'Unknown date'
          : date.toLocaleDateString([], { year: 'numeric', month: 'short', day: '2-digit' });
        const content = escapeHtml(formatMessageContent(item.content));
        const badgeColor = roleColor(role);

        return `
          <div style="background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
              <span style="font-size: 0.68rem; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:${badgeColor};">${escapeHtml(role)}</span>
            </div>
            <div style="font-family: monospace; font-size: 0.8rem; white-space: pre-wrap; word-break: break-word; color: var(--text); background: #faf9f8; padding: 9px; border-radius: 7px; border: 1px solid var(--border); max-height: 240px; overflow-y:auto;">${content}</div>
            <div style="margin-top:8px; font-size: 0.74rem; color: var(--text-muted); display:flex; gap:8px; flex-wrap:wrap;">
              <span>${timeStr}</span>
              <span>•</span>
              <span>${dateStr}</span>
              <span>•</span>
              <span>${escapeHtml(item.model || '(unknown model)')}</span>
              ${item.resolvedModel ? `<span>•</span><span style="color:#3730a3;">resolved: ${escapeHtml(item.resolvedModel)}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
    }

    function toggleLogCard(id) {
      document.getElementById(id)?.classList.toggle('expanded');
    }

    function openDrawer(m) {
      openDrawerModelId = m.modelId;
      document.getElementById('drawer-title').textContent = m.label;
      updateDrawerContent(m);
      document.getElementById('drawer').classList.add('open');
      document.getElementById('overlay').classList.add('active');
    }

    function updateDrawerContent(m) {
      // Build real telemetry chart from ping history
      const pings = m.pings || [];
      const successPings = pings.filter(p => p.code === '200' && typeof p.ms === 'number');
      const maxMs = successPings.length > 0 ? Math.max(...successPings.map(p => p.ms)) : 0;
      const minMs = successPings.length > 0 ? Math.min(...successPings.map(p => p.ms)) : 0;

      let chartHtml;
      if (pings.length === 0) {
        chartHtml = `<div style="height:48px; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:0.8rem;">No data yet — collecting pings...</div>`;
      } else {
        const bars = pings.map(p => {
          const ok = p.code === '200' && typeof p.ms === 'number';
          const heightPct = ok && maxMs > 0
            ? Math.max(15, Math.round((p.ms / maxMs) * 100))
            : 15;
          const color = ok ? 'var(--success)' : 'var(--error)';
          const tip = escapeHtml(formatPingHover(p)).replace(/"/g, '&quot;');
          return `<div title="${tip}" style="flex:1; min-width:4px; height:${heightPct}%; background:${color}; border-radius:2px; opacity:0.8; cursor:default;"></div>`;
        }).join('');

        const rangeLabel = successPings.length > 0
          ? `${minMs}ms – ${maxMs}ms &nbsp;·&nbsp; ${successPings.length}/${pings.length} ok`
          : `${pings.length} ping${pings.length > 1 ? 's' : ''}, none successful`;

        chartHtml = `
          <div style="display:flex; gap:2px; height:48px; align-items:flex-end;">${bars}</div>
          <div style="margin-top:8px; font-size:0.72rem; color:var(--text-muted); display:flex; justify-content:space-between;">
            <span>${rangeLabel}</span>
            <span style="display:flex; gap:10px; align-items:center;">
              <span style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--success);"></span>ok</span>
              <span style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--error);"></span>fail</span>
            </span>
          </div>`;
      }

      const isModelPinned = activePinnedRowKeys.includes(getModelRowKey(m));
      const lastErrorHtml = m.lastError && m.lastError.message
        ? `<div style="margin: -6px 0 14px; padding: 10px 12px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #7f1d1d; font-size: 0.76rem;">
            <div style="font-weight: 700; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.68rem; color: #991b1b;">Last Ping Error</div>
            <div style="word-break: break-word;">${escapeHtml(m.lastError.message)}</div>
          </div>`
        : '';
      document.getElementById('drawer-content').innerHTML = `
        <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
          <div style="min-width:0; flex:1;">
            <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">Model ID</div>
            <div style="font-family: monospace; background: #f3f2f1; padding: 12px; border-radius: 8px; font-size: 0.875rem; word-break:break-all;">${m.modelId}</div>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px; flex-shrink:0;">
            <button onclick="pinModel('${isModelPinned ? '' : m.modelId}', '${m.providerKey}')" style="background: ${isModelPinned ? '#eff6ff' : '#f3f2f1'}; border: ${isModelPinned ? '1px solid #bfdbfe' : '1px solid transparent'}; padding: 8px 16px; border-radius: 6px; font-weight: 600; font-size: 0.75rem; color: ${isModelPinned ? '#1e40af' : 'var(--text)'}; cursor: pointer;">
              ${isModelPinned ? '📌 Unpin Model' : '📌 Pin Model'}
            </button>
            <button onclick="pingModelNow('${m.modelId}')" style="background: #ecfeff; border: 1px solid #a5f3fc; padding: 8px 16px; border-radius: 6px; font-weight: 600; font-size: 0.75rem; color: #0e7490; cursor: pointer;">
              📶 Ping Now
            </button>
            <button onclick="toggleBan('${m.modelId}', '${m.status}')" style="background: ${m.status === 'banned' ? 'var(--text-muted)' : '#fef2f2'}; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; font-size: 0.75rem; color: ${m.status === 'banned' ? '#fff' : '#991b1b'}; cursor: pointer;">
              ${m.status === 'banned' ? 'Unban Model' : 'Ban Model'}
            </button>
          </div>
        </div>
        ${lastErrorHtml}
        <div id="drawer-ping-status" style="margin: -8px 0 16px; font-size: 0.75rem; color: var(--text-muted);"></div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 32px;">
          <div style="background: #faf9f8; padding: 16px; border-radius: 12px; border: 1px solid var(--border);">
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">SWE-bench</div>
            <div style="font-weight: 700;">${getBenchmarkDisplayValue(m.intell, m.isEstimatedScore)}</div>
          </div>
          <div style="background: #faf9f8; padding: 16px; border-radius: 12px; border: 1px solid var(--border);">
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">Context</div>
            <div style="font-weight: 700;">${m.ctx || 'N/A'}</div>
          </div>
        </div>
        <div style="margin-top: auto; padding-top: 40px;">
          <h4 style="margin-bottom: 12px; font-size: 0.875rem;">Recent Telemetry <span style="font-weight:400; color:var(--text-muted);">(last ${pings.length} ping${pings.length !== 1 ? 's' : ''})</span></h4>
          ${chartHtml}
        </div>
      `;
    }

    function closeDrawer() {
      openDrawerModelId = null;
      document.getElementById('drawer').classList.remove('open');
      document.getElementById('overlay').classList.remove('active');
    }

    async function pingModelNow(modelId) {
      const statusEl = document.getElementById('drawer-ping-status');
      if (statusEl) {
        statusEl.style.color = 'var(--text-muted)';
        statusEl.textContent = 'Pinging model now...';
      }

      try {
        const res = await fetch('/api/models/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to ping model.');
        }

        if (statusEl) {
          const last = data.model && data.model.lastPing != null ? `${data.model.lastPing}ms` : 'done';
          statusEl.style.color = 'var(--success)';
          statusEl.textContent = `Ping complete (${last}).`;
        }

        await fetchData();

        if (openDrawerModelId === modelId) {
          const updatedModel = allModels ? allModels.find(r => r.modelId === modelId) : null;
          if (updatedModel) updateDrawerContent(updatedModel);
        }
      } catch (e) {
        if (statusEl) {
          statusEl.style.color = 'var(--error)';
          statusEl.textContent = e.message || 'Failed to ping model.';
        }
      }
    }

    async function toggleBan(modelId, currentStatus) {
      try {
        const isBanning = currentStatus !== 'banned';
        await fetch('/api/models/ban', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId, banned: isBanning })
        });

        // Immediately refresh telemetry data and logs
        await fetchData();
        if (typeof loadLogs === 'function') loadLogs(true);

        // Re-render drawer if it is currently open for this model
        if (openDrawerModelId === modelId) {
          const updatedModel = allModels ? allModels.find(r => r.modelId === modelId) : null;
          if (updatedModel) updateDrawerContent(updatedModel);
        }
      } catch (e) {
        console.error('Failed to toggle ban status', e);
      }
    }

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
  handleSearch,
  importConfigTokenFromBox,
  loadLogs,
  onChatModelChange,
  pinModel,
  render,
  resetSort,
  sendChatMessage,
  setLogsViewMode,
  setSort,
  toggleAll,
  toggleFilterBar,
  toggleLogsAutoRefresh,
  openDrawer,
  toggleBan,
  pingModelNow,
  saveAutoUpdateSettings,
  saveFilterRules,
  updatePinningMode,
  updateProvider,
  updateProviderKey,
  deleteProviderKey,
  updateProviderBaseUrl,
  updateProviderModelId,
  updateProviderPingInterval,
  updateProviderBearerAuth,
  startQwenOAuthLogin,
});
