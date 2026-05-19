import { constants, state } from './state.js';
import {
  escapeHtml,
  formatMessageContent,
  getLocalDayKey,
  normalizeMessageForHash,
  roleColor,
  simpleHash,
} from './utils.js';

export function registerLogs(app) {
  function updateLogsPauseButton() {
    const pauseBtn = document.getElementById('logs-pause-toggle');
    if (!pauseBtn) return;
    pauseBtn.textContent = state.logsAutoRefreshPaused ? 'Resume Live Updates' : 'Pause Live Updates';
    pauseBtn.setAttribute('aria-pressed', state.logsAutoRefreshPaused ? 'true' : 'false');
  }

  async function loadLogs(force = false) {
    if (!force && state.logsAutoRefreshPaused) return;
    try {
      const res = await fetch('/api/logs');
      const logs = await res.json();
      const container = document.getElementById('logs-container');

      if (logs.length === 0) {
        container.innerHTML = '<div style="padding: 32px; text-align: center; color: var(--text-muted); background: var(--card); border: 1px solid var(--border); border-radius: 12px;">No requests have been routed yet.</div>';
        return;
      }

      if (state.logsViewMode === 'history') {
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

        const messagesArray = Array.isArray(l.messages) ? l.messages : (typeof l.messages === 'string' ? [{ role: 'raw', content: l.messages }] : []);
        const msgHtml = messagesArray.map(m => {
          const isSystem = m.role === 'system';
          const isUser = m.role === 'user';
          const colorVar = isSystem ? 'var(--warning)' : (isUser ? 'var(--success)' : 'var(--accent)');
          let formattedContent = typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2);
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

        const logModelStatus = app.state.allModels ? (app.state.allModels.find(m => m.modelId === l.model)?.status || 'unknown') : 'unknown';
        const isBanned = logModelStatus === 'banned';
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
    } catch (err) {
      console.error(err);
    }
  }

  function setLogsViewMode(mode) {
    state.logsViewMode = mode === 'history' ? 'history' : 'cards';
    const cardsBtn = document.getElementById('logs-mode-cards');
    const historyBtn = document.getElementById('logs-mode-history');
    if (cardsBtn && historyBtn) {
      cardsBtn.classList.toggle('active', state.logsViewMode === 'cards');
      historyBtn.classList.toggle('active', state.logsViewMode === 'history');
      cardsBtn.setAttribute('aria-selected', state.logsViewMode === 'cards' ? 'true' : 'false');
      historyBtn.setAttribute('aria-selected', state.logsViewMode === 'history' ? 'true' : 'false');
    }
    loadLogs(true);
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

  Object.assign(app, {
    loadLogs,
    setLogsViewMode,
    toggleLogsAutoRefresh() {
      state.logsAutoRefreshPaused = !state.logsAutoRefreshPaused;
      updateLogsPauseButton();
      if (!state.logsAutoRefreshPaused) {
        loadLogs(true);
      }
    },
    updateLogsPauseButton,
    toggleLogCard,
  });
}
