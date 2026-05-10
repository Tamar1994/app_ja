const API = '/api/support-system';

let token = localStorage.getItem('supportSystemToken') || '';
let me = null;
let selectedChatId = null;

const $ = (id) => document.getElementById(id);

function alertMsg(text) {
  const el = $('alert');
  el.textContent = text;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 2800);
}

async function api(path, method = 'GET', body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Falha na requisição');
  return data;
}

function setStatusBadge(status) {
  const b = $('statusBadge');
  b.textContent = status;
  b.className = 'badge';
  if (status === 'online') b.classList.add('online');
  else if (status === 'paused' || status === 'pause_scheduled') b.classList.add('paused');
  else b.classList.add('offline');
}

function renderChatItem(chat) {
  const p1 = chat.priority === 'p1' ? '<span class="badge p1">P1</span>' : '';
  return `
    <div class="item">
      <div class="between">
        <strong>${chat.userId?.name || 'Usuário'} · ${chat._id}</strong>
        ${p1}
      </div>
      <div class="muted">${chat.subject || '-'} · ${chat.status}</div>
      <div class="row" style="margin-top:8px;">
        <button onclick="selectChat('${chat._id}')">Abrir</button>
      </div>
    </div>
  `;
}

async function loadMe() {
  const data = await api('/me');
  me = data.admin;

  $('welcome').textContent = `Support System · ${me.supportRole}`;
  $('meInfo').textContent = `${me.name} (${me.email})`;
  setStatusBadge(me.supportStatus);
  $('operatorStats').textContent = `Chats ativos: ${me.activeSupportChats} · Fila: ${data.waitingCount} (${data.waitingP1Count} P1)`;
}

async function loadOperatorData() {
  const [queueData, myChatsData, couponsData, releasesData] = await Promise.all([
    api('/chats/queue'),
    api('/chats/mine'),
    api('/coupons/available'),
    api('/coupon-releases/mine'),
  ]);

  $('queueList').innerHTML = queueData.queue.length
    ? queueData.queue.map(renderChatItem).join('')
    : '<div class="muted">Fila vazia.</div>';

  $('myChatsList').innerHTML = myChatsData.chats.length
    ? myChatsData.chats.map(renderChatItem).join('')
    : '<div class="muted">Sem chats ativos.</div>';

  $('couponSelect').innerHTML = couponsData.coupons.length
    ? couponsData.coupons.map((c) => `<option value="${c._id}">${c.code} - ${c.title}</option>`).join('')
    : '<option value="">Sem cupons ativos</option>';

  $('myReleaseList').innerHTML = releasesData.releases.length
    ? releasesData.releases.map((r) => `
      <div class="item">
        <strong>${r.coupon?.code || '-'} · ${r.targetUser?.name || r.targetUser?._id}</strong>
        <div class="muted">Status: ${r.status} · Supervisor: ${r.supervisor?.name || '-'}</div>
        <div class="muted">${r.reason || ''}</div>
      </div>
    `).join('')
    : '<div class="muted">Nenhuma solicitação.</div>';
}

window.selectChat = async (chatId) => {
  selectedChatId = chatId;
  const data = await api(`/chats/${chatId}`);
  const chat = data.chat;
  const messages = (chat.messages || []).slice(-20).map((m) => `[${m.sender}] ${m.text}`).join('\n');
  $('chatDetail').innerHTML = `
    <strong>${chat.userId?.name || 'Usuário'}</strong><br/>
    <span class="muted">${chat.subject || '-'}</span>
    <pre style="white-space:pre-wrap;max-height:200px;overflow:auto;border:1px solid #e5e7eb;padding:8px;border-radius:8px;background:#f8fafc;">${messages || 'Sem mensagens.'}</pre>
  `;
};

async function loadSupervisorData() {
  const [opsData, relData] = await Promise.all([
    api('/supervisor/operators'),
    api(`/supervisor/coupon-releases?status=${$('releaseStatusFilter').value}`),
  ]);

  $('operatorsList').innerHTML = opsData.operators.length
    ? opsData.operators.map((op) => `
      <div class="item">
        <div class="between"><strong>${op.name}</strong><span class="badge ${op.supportStatus === 'online' ? 'online' : (op.supportStatus === 'paused' || op.supportStatus === 'pause_scheduled' ? 'paused' : 'offline')}">${op.supportStatus}</span></div>
        <div class="muted">Chats ativos: ${op.activeSupportChats}</div>
        <div class="muted">Pausa início: ${op.pauseStartAt || '-'} · Fim: ${op.pauseEndsAt || '-'}</div>
        <div class="muted">Atendimentos:</div>
        <div class="muted">${(op.chats || []).map((c) => `${c._id} (${c.userId?.name || 'user'})`).join(' | ') || 'Nenhum'}</div>
      </div>
    `).join('')
    : '<div class="muted">Sem operadores vinculados.</div>';

  $('supervisorReleaseList').innerHTML = relData.releases.length
    ? relData.releases.map((r) => `
      <div class="item">
        <strong>${r.coupon?.code || '-'} · ${r.targetUser?.name || r.targetUser?._id}</strong>
        <div class="muted">Operador: ${r.requestedBy?.name || '-'} · Status: ${r.status}</div>
        <div class="muted">Motivo: ${r.reason || '-'}</div>
        ${r.status === 'pending' ? `
          <div class="row" style="margin-top:8px;">
            <button class="primary" onclick="approveRelease('${r._id}')">Aprovar</button>
            <button class="danger" onclick="rejectRelease('${r._id}')">Recusar</button>
          </div>
        ` : ''}
      </div>
    `).join('')
    : '<div class="muted">Nenhuma solicitação encontrada.</div>';
}

window.approveRelease = async (id) => {
  try {
    await api(`/supervisor/coupon-releases/${id}/approve`, 'PATCH', { note: 'Aprovado pelo supervisor' });
    alertMsg('Solicitação aprovada.');
    await loadSupervisorData();
  } catch (e) { alertMsg(e.message); }
};

window.rejectRelease = async (id) => {
  try {
    const note = prompt('Motivo da recusa:', '');
    await api(`/supervisor/coupon-releases/${id}/reject`, 'PATCH', { note: note || '' });
    alertMsg('Solicitação recusada.');
    await loadSupervisorData();
  } catch (e) { alertMsg(e.message); }
};

async function searchRequests() {
  const q = $('reqSearch').value.trim();
  const status = $('reqStatus').value;
  const data = await api(`/requests/search?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}`);
  $('reqList').innerHTML = data.items.length
    ? data.items.map((r) => `
      <div class="item">
        <strong>${r._id}</strong>
        <div class="muted">Status: ${r.status} · Cliente: ${r.client?.name || '-'} · Profissional: ${r.professional?.name || '-'}</div>
        <div class="muted">Criado em: ${r.createdAt}</div>
      </div>
    `).join('')
    : '<div class="muted">Nenhum serviço encontrado.</div>';
}

async function renderApp() {
  await loadMe();
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');

  const operator = me.supportRole === 'operator';
  $('operatorView').classList.toggle('hidden', !operator);
  $('supervisorView').classList.toggle('hidden', operator);

  if (operator) {
    await loadOperatorData();
  } else {
    await loadSupervisorData();
  }
}

async function doLogin() {
  try {
    const data = await api('/login', 'POST', {
      email: $('email').value.trim(),
      password: $('password').value,
    });
    token = data.token;
    localStorage.setItem('supportSystemToken', token);
    await renderApp();
  } catch (e) { alertMsg(e.message); }
}

function bindEvents() {
  $('loginBtn').addEventListener('click', doLogin);

  $('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('supportSystemToken');
    location.reload();
  });

  $('goOnlineBtn')?.addEventListener('click', async () => {
    try { await api('/operator/go-online', 'PATCH'); await renderApp(); } catch (e) { alertMsg(e.message); }
  });

  $('pauseBtn')?.addEventListener('click', async () => {
    try {
      await api('/operator/request-pause', 'PATCH', { durationMinutes: Number($('pauseMinutes').value || 10) });
      await renderApp();
    } catch (e) { alertMsg(e.message); }
  });

  $('cancelPauseBtn')?.addEventListener('click', async () => {
    try { await api('/operator/cancel-pause', 'PATCH'); await renderApp(); } catch (e) { alertMsg(e.message); }
  });

  $('endPauseBtn')?.addEventListener('click', async () => {
    try { await api('/operator/end-pause', 'PATCH'); await renderApp(); } catch (e) { alertMsg(e.message); }
  });

  $('sendMsgBtn')?.addEventListener('click', async () => {
    if (!selectedChatId) return alertMsg('Selecione um chat.');
    try {
      await api(`/chats/${selectedChatId}/message`, 'POST', { text: $('msgText').value });
      $('msgText').value = '';
      await window.selectChat(selectedChatId);
      await loadOperatorData();
    } catch (e) { alertMsg(e.message); }
  });

  $('closeChatBtn')?.addEventListener('click', async () => {
    if (!selectedChatId) return alertMsg('Selecione um chat.');
    try {
      await api(`/chats/${selectedChatId}/close`, 'PATCH');
      selectedChatId = null;
      $('chatDetail').textContent = 'Selecione um chat para ver detalhes.';
      await renderApp();
    } catch (e) { alertMsg(e.message); }
  });

  $('reqSearchBtn')?.addEventListener('click', searchRequests);

  $('requestCouponBtn')?.addEventListener('click', async () => {
    try {
      await api('/coupon-releases/request', 'POST', {
        couponId: $('couponSelect').value,
        targetUserId: $('targetUserId').value.trim(),
        reason: $('couponReason').value.trim(),
      });
      $('targetUserId').value = '';
      $('couponReason').value = '';
      alertMsg('Solicitação enviada para supervisor.');
      await loadOperatorData();
    } catch (e) { alertMsg(e.message); }
  });

  $('reloadReleasesBtn')?.addEventListener('click', loadSupervisorData);
  $('releaseStatusFilter')?.addEventListener('change', loadSupervisorData);
}

bindEvents();

if (token) {
  renderApp().catch(() => {
    localStorage.removeItem('supportSystemToken');
    token = '';
  });
}
