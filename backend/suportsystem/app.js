/* =============================================================
   JÁ! Support System — app.js
   ============================================================= */

const API = '/api/support-system';
let token = localStorage.getItem('ss_token') || null;
let me = null;
let activeChat = null;
let pollTimer = null;
let countdownTimer = null;
let pauseTypes = [];
let unlockTargetId = null;

/* ── UTILS ──────────────────────────────────────────────────── */
function $(id) { return document.getElementById(id); }
function show(id) { const el = $(id); if (el) el.classList.remove('hidden'); }
function hide(id) { const el = $(id); if (el) el.classList.add('hidden'); }

function showAlert(msg, type = 'info') {
  const el = $('alert');
  el.textContent = msg;
  el.style.display = 'block';
  el.style.borderColor = type === 'error' ? 'var(--red)' : type === 'success' ? 'var(--green)' : 'var(--border)';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || res.statusText), { data, status: res.status });
  return data;
}

function avatarColor(name) {
  const colors = ['av-orange', 'av-blue', 'av-green', 'av-purple'];
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h += name.charCodeAt(i);
  return colors[h % colors.length];
}

function initials(name) {
  if (!name) return '?';
  const parts = name.split(' ').filter(Boolean);
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

function fmt(date) {
  if (!date) return '';
  return new Date(date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtSeconds(secs) {
  const abs = Math.abs(secs);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return (secs < 0 ? '-' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

/* ── LOGIN ──────────────────────────────────────────────────── */
$('loginBtn').addEventListener('click', doLogin);
$('password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const email = $('email').value.trim();
  const password = $('password').value;
  const errEl = $('loginError');
  errEl.style.display = 'none';
  $('loginBtn').disabled = true;
  try {
    const data = await apiFetch('/login', { method: 'POST', body: { email, password } });
    token = data.token;
    localStorage.setItem('ss_token', token);
    await renderApp();
  } catch (err) {
    errEl.textContent = err.data?.message || 'E-mail ou senha inválidos.';
    errEl.style.display = 'block';
  } finally {
    $('loginBtn').disabled = false;
  }
}

/* ── TOPBAR ─────────────────────────────────────────────────── */
function renderTopbar() {
  const name = me.name || me.email || '?';
  $('topbarName').textContent = name;
  $('topbarRoleLabel').textContent = me.supportRole === 'supervisor' ? '🔷 Supervisor' : '🟠 Operador';
  const av = $('topbarAvatar');
  av.textContent = initials(name);
  av.className = 'av ' + avatarColor(name);

  const dot = $('topbarStatusDot');
  dot.className = me.supportStatus === 'online' ? 'online'
                : me.supportStatus === 'paused' || me.supportStatus === 'pause_requested' ? 'paused'
                : 'offline';

  const center = $('topbarCenter');
  if (me.supportRole === 'supervisor') {
    center.innerHTML = '<span style="font-size:15px;font-weight:700;color:var(--accent);">⚡ Central de Supervisão</span>';
    return;
  }

  // Operator topbar center
  if (me.supportStatus === 'offline') {
    center.innerHTML = `<button class="btn-green" id="goOnlineBtn" style="font-size:13px;padding:9px 22px;">▶ Ir Online</button>`;
    $('goOnlineBtn').addEventListener('click', goOnline);
  } else if (me.supportStatus === 'online') {
    center.innerHTML = `<button class="btn-accent" id="openPauseBtn" style="font-size:13px;padding:9px 22px;">⏸ Inserir Pausa</button>`;
    $('openPauseBtn').addEventListener('click', () => show('pauseModal'));
  } else if (me.supportStatus === 'pause_requested') {
    center.innerHTML = `
      <span class="pause-label">PAUSA AGENDADA</span>
      <button class="btn-ghost" id="cancelPauseReqBtn" style="font-size:12px;padding:7px 14px;">✖ Cancelar</button>`;
    $('cancelPauseReqBtn').addEventListener('click', () => show('cancelPauseModal'));
  } else if (me.supportStatus === 'paused') {
    const locked = me.pauseLockedBySupervisor;
    const secs = me.pauseSecondsRemaining !== undefined ? me.pauseSecondsRemaining : null;
    center.innerHTML = `
      <span class="pause-label">EM PAUSA${locked ? ' 🔒' : ''}</span>
      <span id="topbarTimer" class="t-normal">--:--</span>
      ${!locked ? `<button class="btn-green" id="endPauseBtn" style="font-size:12px;padding:7px 14px;">▶ Retornar</button>` : ''}`;
    if (secs !== null) startOperatorCountdown(secs);
    if (!locked) {
      $('endPauseBtn').addEventListener('click', endPause);
    }
  }
}

function startOperatorCountdown(initialSecs) {
  clearInterval(countdownTimer);
  let secs = initialSecs;
  function tick() {
    const el = $('topbarTimer');
    if (!el) { clearInterval(countdownTimer); return; }
    el.textContent = fmtSeconds(secs);
    el.className = secs > 120 ? 't-normal' : secs > 0 ? 't-warn' : 't-danger';
    secs--;
  }
  tick();
  countdownTimer = setInterval(tick, 1000);
}

/* ── GO ONLINE / PAUSE ──────────────────────────────────────── */
async function goOnline() {
  try {
    await apiFetch('/operator/go-online', { method: 'PATCH' });
    await refreshMe();
  } catch (err) { showAlert(err.message, 'error'); }
}

async function endPause() {
  try {
    await apiFetch('/operator/end-pause', { method: 'PATCH' });
    await refreshMe();
  } catch (err) {
    if (err.data?.locked) { showAlert('⛔ Pausa bloqueada pelo supervisor. Aguarde desbloqueio.', 'error'); }
    else showAlert(err.message, 'error');
  }
}

/* ── LOAD ME ────────────────────────────────────────────────── */
async function loadMe() {
  const data = await apiFetch('/me');
  me = data;
}

async function refreshMe() {
  await loadMe();
  renderTopbar();
}

/* ── PAUSE MODAL ────────────────────────────────────────────── */
async function loadPauseTypes() {
  try {
    const data = await apiFetch('/pause-types');
    pauseTypes = data;
    const sel = $('pauseTypeSelect');
    sel.innerHTML = data.length
      ? data.map(pt => `<option value="${pt._id}">${pt.name} (${pt.durationMinutes} min)</option>`).join('')
      : '<option disabled>Nenhum tipo de pausa configurado</option>';
  } catch (e) { /* silent */ }
}

/* ── OPERATOR DATA ──────────────────────────────────────────── */
async function loadOperatorData() {
  try {
    const [chatsData, queueData, couponsData, releasesData] = await Promise.allSettled([
      apiFetch('/chats/mine'),
      apiFetch('/queue'),
      apiFetch('/coupons'),
      apiFetch('/releases/mine'),
    ]);

    const chats  = chatsData.status  === 'fulfilled' ? chatsData.value  : [];
    const queue  = queueData.status  === 'fulfilled' ? queueData.value  : [];
    const coupons = couponsData.status === 'fulfilled' ? couponsData.value : [];
    const releases = releasesData.status === 'fulfilled' ? releasesData.value : [];

    // My chats
    const myList = $('myChatsList');
    $('myChatsCount').textContent = chats.length;
    if (!chats.length) {
      myList.innerHTML = '<div class="muted" style="padding:16px;text-align:center;">Sem atendimentos ativos</div>';
    } else {
      myList.innerHTML = chats.map(c => renderChatItem(c)).join('');
      myList.querySelectorAll('.chat-item').forEach(el => {
        el.addEventListener('click', () => selectChat(el.dataset.id, chats));
      });
    }

    // Queue
    const qList = $('queueList');
    $('queueCount').textContent = queue.length;
    if (!queue.length) {
      qList.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">Fila vazia</div>';
    } else {
      qList.innerHTML = queue.map(q => `
        <div class="chat-item" style="cursor:default;">
          <div class="av-sm">${initials(q.user?.name)}</div>
          <div class="chat-item-info">
            <div class="chat-item-name">${q.user?.name || 'Usuário'}</div>
            <div class="chat-item-preview">${q.lastMessage || 'Aguardando...'}</div>
          </div>
        </div>`).join('');
    }

    // Coupons
    const couponSel = $('couponSelect');
    if (coupons.length) {
      couponSel.innerHTML = '<option value="">Selecione um cupom</option>' +
        coupons.map(c => `<option value="${c._id}">${c.code} — ${c.description || ''}</option>`).join('');
    } else {
      couponSel.innerHTML = '<option disabled>Nenhum cupom disponível</option>';
    }

    // My releases
    const relList = $('myReleaseList');
    if (!releases.length) {
      relList.innerHTML = '<div class="muted" style="font-size:12px;text-align:center;">Sem solicitações</div>';
    } else {
      relList.innerHTML = releases.slice(0, 8).map(r => `
        <div class="release-chip">
          <strong>${r.coupon?.code || '—'}</strong>
          <span class="${r.status === 'approved' ? 'chip-approved' : r.status === 'rejected' ? 'chip-rejected' : 'chip-pending'}">
            ${r.status === 'approved' ? '✓ Aprovado' : r.status === 'rejected' ? '✗ Recusado' : '⏳ Pendente'}
          </span>
        </div>`).join('');
    }

    // Re-select active chat if still open
    if (activeChat) {
      const still = chats.find(c => c._id === activeChat);
      if (still) selectChat(still._id, chats);
    }
  } catch (err) { console.error('loadOperatorData', err); }
}

function renderChatItem(c) {
  const name = c.user?.name || c.user?.email || 'Usuário';
  const preview = c.lastMessage?.text || '';
  const isActive = activeChat === c._id;
  return `<div class="chat-item${isActive ? ' active' : ''}" data-id="${c._id}">
    <div class="av-sm" style="background:var(--accent2);">${initials(name)}</div>
    <div class="chat-item-info">
      <div class="chat-item-name">${name} ${c.unread ? `<span class="badge badge-p1">${c.unread}</span>` : ''}</div>
      <div class="chat-item-preview">${preview}</div>
    </div>
  </div>`;
}

async function selectChat(id, chatsList) {
  activeChat = id;
  // Mark active styling
  document.querySelectorAll('.chat-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });
  hide('chatEmpty');
  $('chatConversation').style.display = 'flex';

  const chat = (chatsList || []).find(c => c._id === id);
  const name = chat?.user?.name || chat?.user?.email || 'Usuário';

  // Header
  const header = $('chatHeader');
  const colorClass = avatarColor(name);
  header.innerHTML = `
    <div class="av ${colorClass}">${initials(name)}</div>
    <div class="chat-header-info">
      <h3>${name}</h3>
      <p>${chat?.serviceRequest?.serviceType?.name || ''} · #${(id || '').slice(-6)}</p>
    </div>`;

  // Load messages
  try {
    const msgs = await apiFetch(`/chats/${id}/messages`);
    renderMessages(msgs);
  } catch (e) { console.error('selectChat messages', e); }
}

function renderMessages(msgs) {
  const area = $('chatMessages');
  if (!msgs.length) { area.innerHTML = '<div class="muted" style="text-align:center;padding:20px;">Sem mensagens ainda</div>'; return; }
  area.innerHTML = msgs.map(m => {
    const isOp = m.sender === 'support';
    return `<div class="msg-block${isOp ? ' me' : ''}">
      <div class="msg-sender${isOp ? ' me' : ''}">${isOp ? 'Você' : 'Cliente'} · ${fmt(m.createdAt)}</div>
      <div class="bubble ${isOp ? 'op' : 'user'}">${escHtml(m.text)}</div>
    </div>`;
  }).join('');
  area.scrollTop = area.scrollHeight;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── SUPERVISOR DATA ────────────────────────────────────────── */
async function loadSupervisorData() {
  try {
    const [opsData, relData, queueData] = await Promise.allSettled([
      apiFetch('/supervisor/operators'),
      apiFetch('/releases', { method: 'GET' }),
      apiFetch('/queue'),
    ]);

    const ops = opsData.status === 'fulfilled' ? opsData.value : [];
    const releases = relData.status === 'fulfilled' ? relData.value : [];
    const queue = queueData.status === 'fulfilled' ? queueData.value : [];

    // KPIs
    const online = ops.filter(o => o.supportStatus === 'online').length;
    const paused = ops.filter(o => o.supportStatus === 'paused' || o.supportStatus === 'pause_requested').length;
    const overdue = ops.filter(o => (o.pauseSecondsRemaining !== undefined && o.pauseSecondsRemaining < 0)).length;
    const activeChats = ops.reduce((sum, o) => sum + (o.activeSupportChats || 0), 0);
    $('kpiActiveChats').textContent = activeChats;
    $('kpiQueue').textContent = queue.length;
    $('kpiOnlineOps').textContent = online;
    $('kpiTotalOps').textContent = `de ${ops.length} no total`;
    $('kpiPausedOps').textContent = paused;
    $('kpiOverdueOps').textContent = overdue + ' atrasados';

    // Operator cards (dashboard + operators tab)
    const dashCards = renderOpCards(ops, false);
    const detailCards = renderOpCards(ops, true);
    $('operatorsListDash').innerHTML = dashCards || '<div class="muted">Nenhum operador</div>';
    $('operatorsList').innerHTML = detailCards || '<div class="muted">Nenhum operador</div>';

    // Releases table
    renderReleasesTable(releases, $('releaseStatusFilter').value || 'pending');
  } catch (err) { console.error('loadSupervisorData', err); }
}

function renderOpCards(ops, detailed) {
  if (!ops.length) return '';
  return ops.map(op => {
    const paused = op.supportStatus === 'paused' || op.supportStatus === 'pause_requested';
    const secs = paused && op.pauseSecondsRemaining !== undefined ? op.pauseSecondsRemaining : null;
    const overdue = secs !== null && secs < 0;
    const nearEnd = secs !== null && secs >= 0 && secs <= 120;
    const locked = op.pauseLockedBySupervisor;
    const borderClass = locked || (overdue) ? 'danger-border' : nearEnd ? 'warn-border' : '';
    const name = op.name || op.email;
    const col = avatarColor(name);

    let statusBadge = '';
    if (op.supportStatus === 'online') statusBadge = '<span class="badge badge-online">Online</span>';
    else if (op.supportStatus === 'paused') statusBadge = '<span class="badge badge-paused">Em Pausa</span>';
    else if (op.supportStatus === 'pause_requested') statusBadge = '<span class="badge badge-paused">Pausa Aguardando</span>';
    else statusBadge = '<span class="badge badge-offline">Offline</span>';

    let timerHtml = '';
    if (paused && secs !== null) {
      const tClass = secs > 120 ? 't-normal' : secs > 0 ? 't-warn' : 't-danger';
      timerHtml = `<div class="op-pause-row">
        <div>
          <div class="muted" style="font-size:10px;margin-bottom:2px;">${locked ? '🔒 BLOQUEADO' : 'RESTANTE'}</div>
          <div class="op-timer ${tClass}" data-op-timer="${op._id}" data-secs="${secs}">${fmtSeconds(secs)}</div>
        </div>
        ${locked ? `<button class="btn-accent" onclick="openUnlockModal('${op._id}','${escHtml(name)}')" style="font-size:11px;padding:6px 12px;">🔓 Desbloquear</button>` : ''}
      </div>`;
    }

    const tmaStr = op.avgHandlingTimeSeconds != null
      ? Math.round(op.avgHandlingTimeSeconds / 60) + ' min TMA'
      : '—';

    let statsHtml = '';
    if (detailed) {
      statsHtml = `<div class="op-stats">
        <div class="op-stat"><div class="op-stat-label">Atend. Ativos</div><div class="op-stat-value">${op.activeSupportChats || 0}</div></div>
        <div class="op-stat"><div class="op-stat-label">TMA Médio</div><div class="op-stat-value" style="font-size:15px;">${tmaStr}</div></div>
      </div>`;
    }

    return `<div class="op-card ${borderClass}">
      <div class="op-card-head">
        <div class="av ${col}" style="width:42px;height:42px;font-size:15px;">${initials(name)}</div>
        <div class="op-card-info">
          <h4>${escHtml(name)}</h4>
          <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">${statusBadge} <span class="muted">${tmaStr}</span></div>
        </div>
      </div>
      ${statsHtml}
      ${timerHtml}
    </div>`;
  }).join('');
}

function startSupervisorCountdowns() {
  clearInterval(window._svCountdown);
  window._svCountdown = setInterval(() => {
    document.querySelectorAll('[data-op-timer]').forEach(el => {
      let secs = parseInt(el.dataset.secs, 10);
      secs--;
      el.dataset.secs = secs;
      el.textContent = fmtSeconds(secs);
      el.className = 'op-timer ' + (secs > 120 ? 't-normal' : secs > 0 ? 't-warn' : 't-danger');
    });
  }, 1000);
}

function renderReleasesTable(releases, statusFilter) {
  const tbody = $('supervisorReleaseList');
  const filtered = statusFilter === 'all' ? releases : releases.filter(r => r.status === statusFilter);
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px;">Nenhuma solicitação encontrada</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(r => {
    const stClass = r.status === 'approved' ? 'st-approved' : r.status === 'rejected' ? 'st-rejected' : 'st-pending';
    const stLabel = r.status === 'approved' ? '✓ Aprovado' : r.status === 'rejected' ? '✗ Recusado' : '⏳ Pendente';
    const actions = r.status === 'pending'
      ? `<div class="tbl-actions">
           <button class="btn-green" style="font-size:11px;padding:5px 10px;" onclick="approveRelease('${r._id}',true)">Aprovar</button>
           <button class="btn-danger" style="font-size:11px;padding:5px 10px;" onclick="approveRelease('${r._id}',false)">Recusar</button>
         </div>`
      : '<span class="muted">—</span>';
    return `<tr>
      <td>${escHtml(r.coupon?.code || '—')}</td>
      <td>${escHtml(r.targetUser?.name || r.targetUserId || '—')}</td>
      <td>${escHtml(r.operator?.name || '—')}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(r.reason || '—')}</td>
      <td class="${stClass}">${stLabel}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');
}

async function approveRelease(id, approve) {
  try {
    await apiFetch(`/releases/${id}/${approve ? 'approve' : 'reject'}`, { method: 'PATCH' });
    showAlert(approve ? 'Liberação aprovada!' : 'Liberação recusada.', 'success');
    loadSupervisorData();
  } catch (err) { showAlert(err.message, 'error'); }
}

/* ── SUPERVISOR TAB SWITCH ──────────────────────────────────── */
function svTab(name) {
  ['dashboard', 'operators', 'releases'].forEach(t => {
    $('tab-' + t).classList.toggle('active', t === name);
    const panel = $('svPanel-' + t);
    if (panel) panel.classList.toggle('hidden', t !== name);
  });
}
window.svTab = svTab;
window.loadSupervisorData = loadSupervisorData;

/* ── UNLOCK MODAL ───────────────────────────────────────────── */
function openUnlockModal(operatorId, operatorName) {
  unlockTargetId = operatorId;
  $('unlockModalMsg').textContent = `Desbloqueie a pausa de "${operatorName}" inserindo sua senha de supervisor.`;
  $('unlockPassword').value = '';
  show('unlockModal');
}
window.openUnlockModal = openUnlockModal;

$('unlockCancelBtn').addEventListener('click', () => hide('unlockModal'));
$('unlockConfirmBtn').addEventListener('click', async () => {
  const pwd = $('unlockPassword').value;
  if (!pwd) { showAlert('Informe sua senha.', 'error'); return; }
  $('unlockConfirmBtn').disabled = true;
  try {
    await apiFetch(`/supervisor/operators/${unlockTargetId}/unlock-pause`, { method: 'PATCH', body: { supervisorPassword: pwd } });
    hide('unlockModal');
    showAlert('Operador desbloqueado com sucesso!', 'success');
    loadSupervisorData();
  } catch (err) {
    showAlert(err.data?.message || 'Senha incorreta.', 'error');
  } finally {
    $('unlockConfirmBtn').disabled = false;
  }
});

/* ── PAUSE CONFIRM ──────────────────────────────────────────── */
$('cancelPauseModalBtn').addEventListener('click', () => hide('pauseModal'));
$('confirmPauseBtn').addEventListener('click', async () => {
  const pauseTypeId = $('pauseTypeSelect').value;
  if (!pauseTypeId) { showAlert('Selecione um tipo de pausa.', 'error'); return; }
  $('confirmPauseBtn').disabled = true;
  try {
    await apiFetch('/operator/request-pause', { method: 'PATCH', body: { pauseTypeId } });
    hide('pauseModal');
    showAlert('Pausa agendada!', 'success');
    await refreshMe();
  } catch (err) {
    showAlert(err.data?.message || 'Erro ao solicitar pausa.', 'error');
  } finally {
    $('confirmPauseBtn').disabled = false;
  }
});

/* ── CANCEL PAUSE MODAL ─────────────────────────────────────── */
$('cancelPauseNoBtn').addEventListener('click', () => hide('cancelPauseModal'));
$('cancelPauseYesBtn').addEventListener('click', async () => {
  $('cancelPauseYesBtn').disabled = true;
  try {
    await apiFetch('/operator/cancel-pause', { method: 'PATCH' });
    hide('cancelPauseModal');
    showAlert('Pausa cancelada!', 'success');
    await refreshMe();
  } catch (err) {
    showAlert(err.data?.message || 'Erro.', 'error');
  } finally {
    $('cancelPauseYesBtn').disabled = false;
  }
});

/* ── LOGOUT ─────────────────────────────────────────────────── */
$('logoutBtn').addEventListener('click', () => {
  token = null;
  localStorage.removeItem('ss_token');
  me = null;
  clearInterval(pollTimer);
  clearInterval(countdownTimer);
  clearInterval(window._svCountdown);
  hide('appView');
  show('loginView');
  $('loginView').style.display = 'flex';
});

/* ── SEND MESSAGE ───────────────────────────────────────────── */
$('sendMsgBtn').addEventListener('click', sendMsg);
$('msgText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });

async function sendMsg() {
  const text = $('msgText').value.trim();
  if (!text || !activeChat) return;
  $('msgText').value = '';
  try {
    await apiFetch(`/chats/${activeChat}/messages`, { method: 'POST', body: { text } });
    const msgs = await apiFetch(`/chats/${activeChat}/messages`);
    renderMessages(msgs);
  } catch (err) { showAlert(err.message, 'error'); }
}

/* ── CLOSE CHAT ─────────────────────────────────────────────── */
$('closeChatBtn').addEventListener('click', async () => {
  if (!activeChat) return;
  if (!confirm('Encerrar este atendimento?')) return;
  try {
    await apiFetch(`/chats/${activeChat}/close`, { method: 'PATCH' });
    activeChat = null;
    hide('chatConversation');
    show('chatEmpty');
    showAlert('Atendimento encerrado.', 'success');
    loadOperatorData();
  } catch (err) { showAlert(err.message, 'error'); }
});

/* ── SERVICE SEARCH ─────────────────────────────────────────── */
$('reqSearchBtn').addEventListener('click', searchServices);
$('reqSearch').addEventListener('keydown', e => { if (e.key === 'Enter') searchServices(); });

async function searchServices() {
  const query = $('reqSearch').value.trim();
  const status = $('reqStatus').value;
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (status !== 'all') params.set('status', status);
  try {
    const results = await apiFetch('/requests?' + params);
    const list = $('reqList');
    if (!results.length) {
      list.innerHTML = '<div class="muted" style="text-align:center;padding:10px;">Nenhum resultado</div>';
      $('serviceActionsPanel').style.display = 'none';
      return;
    }
    list.innerHTML = results.map(r => `
      <div class="result-card" data-id="${r._id}" onclick="selectService('${r._id}','${escHtml(r.serviceType?.name || r._id)}')">
        <h4>${escHtml(r.serviceType?.name || 'Serviço')} <span class="badge badge-active" style="font-size:10px;">${escHtml(r.status)}</span></h4>
        <p>${escHtml(r.user?.name || r.user?.email || '?')} · #${r._id.slice(-6)}</p>
      </div>`).join('');
  } catch (err) { showAlert(err.message, 'error'); }
}

let selectedServiceId = null;
function selectService(id, label) {
  selectedServiceId = id;
  $('serviceActionsTitle').textContent = 'SERVIÇO: ' + label.slice(0, 20);
  $('serviceActionsPanel').style.display = 'block';
  $('openBackofficeBtn').onclick = () => {
    showAlert('Backoffice: funcionalidade externa.', 'info');
  };
  $('cancelServiceBtn').onclick = async () => {
    if (!confirm('Encerrar serviço #' + id.slice(-6) + '?')) return;
    try {
      await apiFetch('/requests/' + id + '/cancel', { method: 'PATCH' });
      showAlert('Serviço encerrado.', 'success');
      $('serviceActionsPanel').style.display = 'none';
      searchServices();
    } catch (err) { showAlert(err.message, 'error'); }
  };
}
window.selectService = selectService;
window.approveRelease = approveRelease;

/* ── COUPON REQUEST ─────────────────────────────────────────── */
$('requestCouponBtn').addEventListener('click', async () => {
  const couponId = $('couponSelect').value;
  const targetUserId = $('targetUserId').value.trim();
  const reason = $('couponReason').value.trim();
  if (!couponId) { showAlert('Selecione um cupom.', 'error'); return; }
  if (!targetUserId) { showAlert('Informe o ID do usuário.', 'error'); return; }
  if (!reason) { showAlert('Informe o motivo.', 'error'); return; }
  $('requestCouponBtn').disabled = true;
  try {
    await apiFetch('/releases', { method: 'POST', body: { couponId, targetUserId, reason } });
    showAlert('Solicitação enviada para o supervisor!', 'success');
    $('couponSelect').value = '';
    $('targetUserId').value = '';
    $('couponReason').value = '';
    loadOperatorData();
  } catch (err) { showAlert(err.data?.message || err.message, 'error'); }
  finally { $('requestCouponBtn').disabled = false; }
});

/* ── RELEASES FILTER ────────────────────────────────────────── */
$('releaseStatusFilter').addEventListener('change', () => loadSupervisorData());
$('reloadReleasesBtn').addEventListener('click', () => loadSupervisorData());

/* ── RENDER APP ─────────────────────────────────────────────── */
async function renderApp() {
  await loadMe();
  hide('loginView');
  show('appView');
  $('appView').classList.remove('hidden');

  renderTopbar();

  if (me.supportRole === 'supervisor') {
    show('supervisorView');
    hide('operatorView');
    loadSupervisorData();
    startSupervisorCountdowns();
    // Poll every 30s
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      loadSupervisorData();
    }, 30000);
  } else {
    show('operatorView');
    hide('supervisorView');
    await loadPauseTypes();
    loadOperatorData();
    // Poll every 10s
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      await refreshMe();
      loadOperatorData();
    }, 10000);
  }
}

/* ── BOOT ───────────────────────────────────────────────────── */
(async () => {
  if (token) {
    try {
      await renderApp();
    } catch (e) {
      token = null;
      localStorage.removeItem('ss_token');
      // loginView is shown by default
    }
  }
})();
