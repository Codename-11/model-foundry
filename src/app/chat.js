import { constants, state } from './state.js';
import { escapeHtml, formatMessageContent } from './utils.js';

const HARD_DISABLED_CHAT_STATUSES = new Set(['banned', 'disabled', 'excluded', 'noauth']);

export function registerChat(app) {
  let latestChatModels = [];
  let latestChatOptionMap = new Map();

  function loadChatState() {
    try {
      const rawMessages = sessionStorage.getItem(constants.CHAT_STORAGE_KEY);
      const parsedMessages = rawMessages ? JSON.parse(rawMessages) : [];
      state.chatMessages = Array.isArray(parsedMessages)
        ? parsedMessages
          .filter(m => m && typeof m.role === 'string' && m.content != null)
          .map(m => ({
            role: String(m.role),
            content: typeof m.content === 'string' ? m.content : formatMessageContent(m.content),
            ts: typeof m.ts === 'string' ? m.ts : new Date().toISOString(),
            model: typeof m.model === 'string' && m.model.trim() ? m.model.trim() : null,
            requestedModel: typeof m.requestedModel === 'string' && m.requestedModel.trim() ? m.requestedModel.trim() : null,
            requestedProvider: typeof m.requestedProvider === 'string' && m.requestedProvider.trim() ? m.requestedProvider.trim() : null,
            requestedLane: typeof m.requestedLane === 'string' && m.requestedLane.trim() ? m.requestedLane.trim() : null,
          }))
        : [];

      const rawModel = sessionStorage.getItem(constants.CHAT_MODEL_STORAGE_KEY);
      state.chatSelectedModel = rawModel && typeof rawModel === 'string' ? rawModel : 'auto-fastest';
    } catch {
      state.chatMessages = [];
      state.chatSelectedModel = 'auto-fastest';
    }
  }

  function saveChatState() {
    try {
      sessionStorage.setItem(constants.CHAT_STORAGE_KEY, JSON.stringify(state.chatMessages));
      sessionStorage.setItem(constants.CHAT_MODEL_STORAGE_KEY, state.chatSelectedModel || 'auto-fastest');
    } catch {
      // Ignore storage failures and keep chat in-memory.
    }
  }

  function uniqueValues(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function isChatRowSelectable(model) {
    return !HARD_DISABLED_CHAT_STATUSES.has(String(model?.status || '').toLowerCase());
  }

  function getChatLaneLabel(lane) {
    return lane === 'frontier' ? 'Frontier' : 'Open / General';
  }

  function getChatStatusLabel(status) {
    switch (String(status || '').toLowerCase()) {
      case 'up':
        return 'Ready';
      case 'down':
        return 'Last ping failed';
      case 'timeout':
        return 'Timed out recently';
      case 'noauth':
        return 'Missing auth';
      case 'disabled':
        return 'Disabled';
      case 'excluded':
        return 'Excluded from routing';
      case 'banned':
        return 'Banned';
      default:
        return 'Available';
    }
  }

  function getPrimaryUnavailableReason(models) {
    const statuses = new Set((models || []).map(model => String(model?.status || '').toLowerCase()));
    if (statuses.has('noauth')) return 'Missing API key or auth';
    if (statuses.has('disabled')) return 'Disabled in provider settings';
    if (statuses.has('excluded')) return 'Excluded from routing';
    if (statuses.has('banned')) return 'Banned';
    return 'Currently unavailable';
  }

  function compareChatRows(a, b) {
    const aSelectable = Number(isChatRowSelectable(a));
    const bSelectable = Number(isChatRowSelectable(b));
    if (aSelectable !== bSelectable) return bSelectable - aSelectable;

    const aUp = Number(a?.status === 'up');
    const bUp = Number(b?.status === 'up');
    if (aUp !== bUp) return bUp - aUp;

    const aQos = Number(a?.qos) || 0;
    const bQos = Number(b?.qos) || 0;
    if (aQos !== bQos) return bQos - aQos;

    return String(a?.providerName || a?.providerKey || '').localeCompare(String(b?.providerName || b?.providerKey || ''));
  }

  function buildChatOptionMeta(modelId, models) {
    const rows = Array.isArray(models) ? models.filter(Boolean) : [];
    if (!rows.length) return null;

    const sortedRows = [...rows].sort(compareChatRows);
    const representative = sortedRows[0];
    const lane = representative?.lane === 'frontier' ? 'frontier' : 'general';
    const providerNames = uniqueValues(sortedRows.map(model => model.providerName || model.providerKey));
    const authLabels = uniqueValues(sortedRows.map(model => model.providerAuthLabel));
    const costLabels = uniqueValues(sortedRows.map(model => model.providerCostLabel));
    const selectableRows = sortedRows.filter(isChatRowSelectable);
    const disabled = selectableRows.length === 0;
    const unavailableReason = disabled ? getPrimaryUnavailableReason(sortedRows) : null;
    const statusLabel = disabled
      ? unavailableReason
      : selectableRows.some(model => model.status === 'up')
        ? 'Ready'
        : getChatStatusLabel(representative?.status);
    const providerSummary = providerNames.length <= 1
      ? (providerNames[0] || representative?.providerKey || 'Provider lane')
      : `${providerNames.length} providers`;
    const displayName = representative?.label || modelId;
    const setupHint = representative?.providerSetupHint
      || (lane === 'frontier'
        ? 'Frontier lanes usually need a paid provider key and a configured model.'
        : 'Open / general lanes may still require an API key depending on the provider.');
    const authLabel = authLabels[0] || 'Provider auth varies';
    const costLabel = costLabels[0] || null;

    return {
      value: modelId,
      displayName,
      optionLabel: `${displayName} · ${providerSummary}${disabled ? ` · ${statusLabel}` : ''}`,
      lane,
      laneLabel: getChatLaneLabel(lane),
      providerSummary,
      authLabel,
      costLabel,
      setupHint,
      disabled,
      statusLabel,
      unavailableReason,
      providerNames,
      providerCount: providerNames.length,
    };
  }

  function buildChatOptionMap(models = []) {
    const grouped = new Map();
    for (const model of models) {
      if (!model || !model.modelId) continue;
      if (!grouped.has(model.modelId)) grouped.set(model.modelId, []);
      grouped.get(model.modelId).push(model);
    }

    const optionMap = new Map();
    for (const [modelId, groupedModels] of grouped.entries()) {
      const option = buildChatOptionMeta(modelId, groupedModels);
      if (option) optionMap.set(modelId, option);
    }
    return optionMap;
  }

  function getAutoChatOption() {
    return {
      value: 'auto-fastest',
      displayName: 'Auto (Fastest Available)',
      optionLabel: 'Auto (Fastest Available)',
      lane: 'general',
      laneLabel: 'Router Default',
      providerSummary: 'Best eligible route',
      authLabel: 'Skips missing auth',
      costLabel: 'Recommended default',
      setupHint: 'ModelFoundry picks the best eligible row automatically. Missing-auth, disabled, excluded, and banned rows are skipped.',
      disabled: false,
      statusLabel: 'Ready',
      unavailableReason: null,
      providerNames: [],
      providerCount: 0,
    };
  }

  function getSelectedChatOption() {
    if (state.chatSelectedModel === 'auto-fastest') return getAutoChatOption();
    return latestChatOptionMap.get(state.chatSelectedModel) || null;
  }

  function renderChatModelMeta() {
    const metaEl = document.getElementById('chat-model-meta');
    if (!metaEl) return;

    const option = getSelectedChatOption();
    if (!option) {
      metaEl.innerHTML = '';
      return;
    }

    const chips = [
      `<span class="lane-chip ${option.lane === 'frontier' ? 'frontier' : 'general'}">${escapeHtml(option.laneLabel)}</span>`,
      option.authLabel ? `<span class="chat-model-chip">${escapeHtml(option.authLabel)}</span>` : '',
      option.costLabel ? `<span class="chat-model-chip">${escapeHtml(option.costLabel)}</span>` : '',
      option.statusLabel ? `<span class="chat-model-chip">${escapeHtml(option.statusLabel)}</span>` : '',
    ].filter(Boolean).join('');

    const providerLine = option.value === 'auto-fastest'
      ? 'Auto routing will choose the best eligible lane for each request.'
      : `Visible via ${escapeHtml(option.providerSummary)}.`;
    const resolutionLine = option.value === 'auto-fastest'
      ? 'Some routed providers may still report a more specific upstream model in the reply.'
      : 'Some virtual routes may resolve to a more specific upstream model in the reply.';
    const noteClass = option.disabled ? 'chat-model-note warn' : 'chat-model-note';

    metaEl.innerHTML = `
      <div class="chat-model-chip-row">${chips}</div>
      <div class="${noteClass}">${providerLine} ${escapeHtml(option.setupHint)} ${escapeHtml(resolutionLine)}</div>
    `;
  }

  function renderChatOption(option) {
    return `<option value="${escapeHtml(option.value)}"${option.disabled ? ' disabled' : ''}>${escapeHtml(option.optionLabel)}</option>`;
  }

  function updateChatModelOptions(models = []) {
    const select = document.getElementById('chat-model-select');
    if (!select) return;

    latestChatModels = Array.isArray(models) ? [...models] : [];
    latestChatOptionMap = buildChatOptionMap(latestChatModels);
    const previousSelection = state.chatSelectedModel || select.value || 'auto-fastest';

    const allOptions = [...latestChatOptionMap.values()].sort((a, b) => {
      if (a.lane !== b.lane) return a.lane === 'frontier' ? 1 : -1;
      if (a.disabled !== b.disabled) return Number(a.disabled) - Number(b.disabled);
      return a.displayName.localeCompare(b.displayName);
    });

    const generalOptions = allOptions.filter(option => option.lane !== 'frontier');
    const frontierOptions = allOptions.filter(option => option.lane === 'frontier');
    const html = [
      renderChatOption(getAutoChatOption()),
      generalOptions.length ? `<optgroup label="Open / General">${generalOptions.map(renderChatOption).join('')}</optgroup>` : '',
      frontierOptions.length ? `<optgroup label="Frontier">${frontierOptions.map(renderChatOption).join('')}</optgroup>` : '',
    ].filter(Boolean).join('');

    select.innerHTML = html;

    const previousOption = previousSelection === 'auto-fastest'
      ? getAutoChatOption()
      : latestChatOptionMap.get(previousSelection);
    const hasPrevious = Boolean(previousOption && !previousOption.disabled);
    state.chatSelectedModel = hasPrevious ? previousSelection : 'auto-fastest';
    select.value = state.chatSelectedModel;
    renderChatModelMeta();
    saveChatState();
  }

  function onChatModelChange() {
    const select = document.getElementById('chat-model-select');
    state.chatSelectedModel = (select && select.value) ? select.value : 'auto-fastest';
    saveChatState();
    renderChatModelMeta();
    const option = getSelectedChatOption();
    if (!option) return;
    setChatStatus(
      option.value === 'auto-fastest'
        ? 'Auto routing enabled.'
        : `Using model: ${option.displayName}`,
      'muted'
    );
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

    if (!state.chatMessages.length) {
      transcript.innerHTML = `
        <div class="chat-empty">
          Start a conversation. Press Enter to send and Shift+Enter for a newline.
        </div>
      `;
      return;
    }

    transcript.innerHTML = state.chatMessages.map(msg => {
      const role = msg && msg.role ? String(msg.role) : 'assistant';
      const roleClass = role === 'user' ? 'user' : role === 'system' ? 'system' : 'assistant';
      const content = escapeHtml(formatMessageContent(msg && msg.content != null ? msg.content : ''));
      const ts = msg && msg.ts ? new Date(msg.ts) : null;
      const tsLabel = ts && !Number.isNaN(ts.getTime())
        ? ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';
      const modelLabel = msg && typeof msg.model === 'string' && msg.model.trim() ? msg.model.trim() : '';
      const requestedModelLabel = msg && typeof msg.requestedModel === 'string' && msg.requestedModel.trim() ? msg.requestedModel.trim() : '';
      const requestedProviderLabel = msg && typeof msg.requestedProvider === 'string' && msg.requestedProvider.trim() ? msg.requestedProvider.trim() : '';
      const requestedLaneLabel = msg && typeof msg.requestedLane === 'string' && msg.requestedLane.trim() ? msg.requestedLane.trim() : '';
      const headerBits = [role];
      if (tsLabel) headerBits.push(tsLabel);
      const routeMetaHtml = role === 'assistant' && (requestedModelLabel || modelLabel)
        ? `
          <div class="chat-msg-meta">
            <div class="chat-msg-meta-chip-row">
              ${requestedLaneLabel ? `<span class="chat-msg-meta-pill">${escapeHtml(requestedLaneLabel)}</span>` : ''}
              ${requestedProviderLabel ? `<span class="chat-msg-meta-pill">${escapeHtml(requestedProviderLabel)}</span>` : ''}
            </div>
            ${requestedModelLabel ? `<div class="chat-msg-meta-row"><span class="chat-msg-meta-label">Requested route</span><span>${escapeHtml(requestedModelLabel)}</span></div>` : ''}
            ${modelLabel && modelLabel !== requestedModelLabel ? `<div class="chat-msg-meta-row"><span class="chat-msg-meta-label">Served model</span><span>${escapeHtml(modelLabel)}</span></div>` : ''}
            ${modelLabel && !requestedModelLabel ? `<div class="chat-msg-meta-row"><span class="chat-msg-meta-label">Served model</span><span>${escapeHtml(modelLabel)}</span></div>` : ''}
          </div>
        `
        : '';

      return `
        <div class="chat-msg ${roleClass}">
          <div class="chat-msg-role">${headerBits.map(part => escapeHtml(part)).join(' • ')}</div>
          ${routeMetaHtml}
          <div class="chat-msg-content">${content}</div>
        </div>
      `;
    }).join('');

    scrollChatToBottom();
  }

  function setChatInFlight(inFlight) {
    state.chatInFlight = !!inFlight;

    const sendBtn = document.getElementById('chat-send-btn');
    const clearBtn = document.getElementById('chat-clear-btn');
    const input = document.getElementById('chat-input');
    const modelSelect = document.getElementById('chat-model-select');
    const typing = document.getElementById('chat-typing-indicator');

    if (sendBtn) {
      sendBtn.disabled = state.chatInFlight;
      sendBtn.textContent = state.chatInFlight ? 'Sending...' : 'Send';
    }
    if (clearBtn) clearBtn.disabled = state.chatInFlight;
    if (input) input.disabled = state.chatInFlight;
    if (modelSelect) modelSelect.disabled = state.chatInFlight;
    if (typing) typing.style.display = state.chatInFlight ? 'flex' : 'none';
  }

  function handleChatInputKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendChatMessage();
    }
  }

  function clearChat() {
    if (state.chatInFlight) return;
    state.chatMessages = [];
    saveChatState();
    setChatStatus('Chat cleared. Starting fresh.', 'success');
    renderChatTranscript();
    const input = document.getElementById('chat-input');
    if (input) input.focus();
  }

  function buildChatRequestMessages() {
    return state.chatMessages
      .filter(m => m && typeof m.role === 'string' && m.content != null)
      .map(m => ({
        role: String(m.role),
        content: typeof m.content === 'string' ? m.content : formatMessageContent(m.content),
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
    if (state.chatInFlight) return;
    const input = document.getElementById('chat-input');
    if (!input) return;

    const content = input.value.replace(/\r\n/g, '\n').trim();
    if (!content) {
      setChatStatus('Type a message before sending.', 'error');
      return;
    }

    const selectedOption = getSelectedChatOption();
    if (selectedOption?.disabled) {
      setChatStatus(`${selectedOption.displayName} is not available: ${selectedOption.unavailableReason}.`, 'error');
      renderChatModelMeta();
      return;
    }

    const userMessage = { role: 'user', content, ts: new Date().toISOString() };
    state.chatMessages.push(userMessage);
    saveChatState();
    renderChatTranscript();
    input.value = '';
    setChatStatus('');
    setChatInFlight(true);

    try {
      const requestBody = {
        model: state.chatSelectedModel || 'auto-fastest',
        messages: buildChatRequestMessages(),
      };

      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
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
      const requestedModelLabel = selectedOption?.displayName || selectedOption?.value || state.chatSelectedModel || 'auto-fastest';
      state.chatMessages.push({
        role: 'assistant',
        content: assistantText,
        ts: new Date().toISOString(),
        model: responseModel,
        requestedModel: requestedModelLabel,
        requestedProvider: selectedOption?.providerSummary || null,
        requestedLane: selectedOption?.laneLabel || null,
      });
      saveChatState();
      renderChatTranscript();
      setChatStatus(
        responseModel && requestedModelLabel && responseModel !== requestedModelLabel
          ? `Response received. Requested ${requestedModelLabel}; upstream served ${responseModel}.`
          : 'Response received.',
        'success'
      );
    } catch (err) {
      setChatStatus(err?.message || 'Failed to send message.', 'error');
    } finally {
      setChatInFlight(false);
      renderChatModelMeta();
      if (input) input.focus();
    }
  }

  function initializeChat() {
    loadChatState();
    updateChatModelOptions(app.state.allModels);
    renderChatTranscript();
    renderChatModelMeta();
    setChatInFlight(false);
    setChatStatus('');
  }

  Object.assign(app, {
    loadChatState,
    saveChatState,
    updateChatModelOptions,
    onChatModelChange,
    setChatStatus,
    scrollChatToBottom,
    renderChatTranscript,
    renderChatModelMeta,
    setChatInFlight,
    handleChatInputKeydown,
    clearChat,
    buildChatRequestMessages,
    getAssistantTextFromResponse,
    sendChatMessage,
    initializeChat,
  });
}
