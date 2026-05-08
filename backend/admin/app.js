// ── CONFIG ─────────────────────────────────────────────────────────
const API = '/api/admin';
const API_ST = '/api/service-types';
let adminToken = localStorage.getItem('adminToken');
let adminData = JSON.parse(localStorage.getItem('adminData') || 'null');
let currentPage = 'dashboard';
let pendingBadge = 0;
let activeChatId = null;

// ── UTILS ──────────────────────────────────────────────────────────
const req = async (method, path, body) => {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || 'Erro');
  return data;
};

const stReq = async (method, path, body) => {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API_ST + path, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || 'Erro');
  return data;
};

const multipartReq = async (method, path, formData) => {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${adminToken}` },
    body: formData,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || 'Erro');
  return data;
};

const escHtml = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—';
const fmtDatetime = (d) => d ? new Date(d).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
const fmtCPF = (c) => c ? c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '—';

const statusBadge = (s) => {
  const map = {
    pending_documents: ['badge-docs','📄 Docs Pendentes'],
    pending_review: ['badge-pending','⏳ Em Revisão'],
    approved: ['badge-approved','✅ Aprovado'],
    rejected: ['badge-rejected','❌ Rejeitado'],
  };
  const [cls, label] = map[s] || ['badge-ghost', s];
  return `<span class="badge ${cls}">${label}</span>`;
};
const typeBadge = (t) => t === 'professional'
  ? `<span class="badge badge-professional">🔧 Profissional</span>`
  : `<span class="badge badge-client">👤 Cliente</span>`;

const showAlert = (msg, type = 'error') => {
  const existing = document.querySelector('.alert');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = `alert alert-${type}`;
  el.innerHTML = `${type === 'error' ? '⚠️' : '✅'} ${escHtml(msg)}`;
  const content = document.querySelector('.content') || document.querySelector('.login-card');
  content?.prepend(el);
  setTimeout(() => el.remove(), 4000);
};

// ── RENDER ENTRY ───────────────────────────────────────────────────
const render = () => {
  if (!adminToken) return renderLogin();
  renderLayout();
};

// ── LOGIN ──────────────────────────────────────────────────────────
const renderLogin = () => {
  document.getElementById('app').innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <div class="login-logo">
          <img src="/admin/logo.png" alt="Já!" class="login-logo-img" />
          <p>Painel Administrativo</p>
        </div>
        <h2>Entrar</h2>
        <div id="login-alert"></div>
        <div class="form-group">
          <label class="form-label">E-mail</label>
          <input id="l-email" class="form-input" type="email" placeholder="admin@ja.app" autocomplete="email" />
        </div>
        <div class="form-group">
          <label class="form-label">Senha</label>
          <input id="l-pass" class="form-input" type="password" placeholder="••••••••" autocomplete="current-password" />
        </div>
        <button class="btn btn-primary" style="width:100%;justify-content:center;padding:13px;" onclick="doLogin()">Entrar</button>
      </div>
    </div>`;
  document.getElementById('l-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
};

const doLogin = async () => {
  const email = document.getElementById('l-email').value.trim();
  const pass = document.getElementById('l-pass').value;
  if (!email || !pass) return;
  try {
    const data = await req('POST', '/login', { email, password: pass });
    adminToken = data.token;
    adminData = data.admin;
    localStorage.setItem('adminToken', adminToken);
    localStorage.setItem('adminData', JSON.stringify(adminData));
    render();
  } catch (err) {
    const el = document.getElementById('login-alert');
    el.innerHTML = `<div class="alert alert-error">⚠️ ${escHtml(err.message)}</div>`;
  }
};

// ── LAYOUT ─────────────────────────────────────────────────────────
const renderLayout = async () => {
  document.getElementById('app').innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar-logo">
          <img src="/admin/logo.png" alt="Já!" class="sidebar-logo-img" />
          <span class="sub">Admin</span>
        </div>
        <nav class="sidebar-nav">
          <div class="nav-group-label">Principal</div>
          <div class="nav-item ${currentPage==='dashboard'?'active':''}" onclick="navTo('dashboard')">
            <span class="icon">📊</span> Dashboard
          </div>
          <div class="nav-item ${currentPage==='approvals'?'active':''}" onclick="navTo('approvals')">
            <span class="icon">🔍</span> Aprovações
            ${pendingBadge > 0 ? `<span class="nav-badge">${pendingBadge}</span>` : ''}
          </div>
          <div class="nav-group-label">Gestão</div>
          <div class="nav-item ${currentPage==='users'?'active':''}" onclick="navTo('users')">
            <span class="icon">👥</span> Usuários
          </div>
          <div class="nav-item ${currentPage==='suporte'?'active':''}" onclick="navTo('suporte')">
            <span class="icon">🏎️</span> Suporte Operador
          </div>
          <div class="nav-item ${currentPage==='ajuda'?'active':''}" onclick="navTo('ajuda')">
            <span class="icon">📚</span> Central de Ajuda
          </div>
          <div class="nav-item ${currentPage==='precos'?'active':''}" onclick="navTo('precos')">
            <span class="icon">💰</span> Configurar Preços
          </div>
          ${adminData?.role === 'super_admin' ? `
          <div class="nav-group-label">Configurações</div>
          <div class="nav-item ${currentPage==='service-types'?'active':''}" onclick="navTo('service-types')">
            <span class="icon">📋</span> Profissões
          </div>
          <div class="nav-item ${currentPage==='admins'?'active':''}" onclick="navTo('admins')">
            <span class="icon">🛡️</span> Equipe Admin
          </div>` : ''}
        </nav>
        <div class="sidebar-footer">
          <div class="sidebar-user">
            <div class="avatar-sm">${(adminData?.name||'A')[0].toUpperCase()}</div>
            <div class="sidebar-user-info">
              <div class="sidebar-user-name">${escHtml(adminData?.name || 'Admin')}</div>
              <div class="sidebar-user-role">${escHtml(adminData?.role || '')}</div>
            </div>
          </div>
          <button class="btn-logout" onclick="doLogout()">⎋ Sair</button>
        </div>
      </aside>
      <main class="main">
        <div class="topbar">
          <h1 id="page-title">Dashboard</h1>
          <div class="topbar-right">
            <span style="font-size:12px;color:#3D4460;">${fmtDatetime(new Date())}</span>
          </div>
        </div>
        <div class="content" id="page-content">
          <div class="loading-center"><div class="spinner"></div></div>
        </div>
      </main>
    </div>`;

  // Carregar badge de pendentes
  try {
    const stats = await req('GET', '/stats');
    pendingBadge = stats.verification?.pendingReview || 0;
    const sidebar = document.querySelector('.sidebar-nav');
    if (sidebar) {
      const approvalItem = sidebar.querySelectorAll('.nav-item')[1];
      if (approvalItem && pendingBadge > 0) {
        const existing = approvalItem.querySelector('.nav-badge');
        if (!existing) approvalItem.innerHTML += `<span class="nav-badge">${pendingBadge}</span>`;
      }
    }
  } catch {}

  renderPage();
};

const navTo = (page) => {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const items = document.querySelectorAll('.nav-item');
  const idx = ['dashboard','approvals','users','suporte','ajuda','precos','service-types','admins'].indexOf(page);
  if (items[idx]) items[idx].classList.add('active');
  document.getElementById('page-title').textContent = {
    dashboard: 'Dashboard',
    approvals: 'Fila de Aprovações',
    users: 'Usuários',
    suporte: 'Suporte ao Vivo',
    ajuda: 'Central de Ajuda',
    precos: 'Configuração de Preços',
    'service-types': 'Profissões e Serviços',
    admins: 'Equipe Admin',
  }[page] || page;
  renderPage();
};

const renderPage = () => {
  const pages = { dashboard: renderDashboard, approvals: renderApprovals, users: renderUsers, suporte: renderSupporte, ajuda: renderHelpCenter, precos: renderPricing, 'service-types': renderServiceTypes, admins: renderAdmins };
  (pages[currentPage] || renderDashboard)();
};

const doLogout = () => {
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminData');
  adminToken = null;
  adminData = null;
  render();
};

// ── DASHBOARD ──────────────────────────────────────────────────────
const renderDashboard = async () => {
  const c = document.getElementById('page-content');
  c.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  try {
    const s = await req('GET', '/stats');
    c.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">👥</div>
          <div class="stat-label">Total de Usuários</div>
          <div class="stat-value">${s.users.total}</div>
          <div class="stat-sub">${s.users.clients} clientes · ${s.users.professionals} profissionais</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">⏳</div>
          <div class="stat-label">Aguardando Revisão</div>
          <div class="stat-value" style="color:#FFA500;">${s.verification.pendingReview}</div>
          <div class="stat-sub"><a href="#" onclick="navTo('approvals')" style="color:#FF6B00;text-decoration:none;">Ver fila →</a></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">✅</div>
          <div class="stat-label">Aprovados</div>
          <div class="stat-value" style="color:#00C853;">${s.verification.approved}</div>
          <div class="stat-sub">${s.verification.rejected} rejeitados</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🔧</div>
          <div class="stat-label">Serviços Ativos</div>
          <div class="stat-value" style="color:#64B5F6;">${s.services.active}</div>
          <div class="stat-sub">${s.services.completed} concluídos total</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">💬</div>
          <div class="stat-label">Chats Abertos</div>
          <div class="stat-value" style="color:#CE93D8;">${s.support.openChats}</div>
          <div class="stat-sub"><a href="#" onclick="navTo('chat')" style="color:#FF6B00;text-decoration:none;">Ver chats →</a></div>
        </div>
      </div>
      <div class="section-card">
        <div class="section-header"><h2>🔍 Fila de Aprovações Pendentes</h2><button class="btn btn-ghost btn-sm" onclick="navTo('approvals')">Ver todos</button></div>
        <div id="dash-approvals"><div class="loading-center"><div class="spinner"></div></div></div>
      </div>`;
    loadDashApprovals();
  } catch (err) {
    c.innerHTML = `<div class="alert alert-error">⚠️ ${escHtml(err.message)}</div>`;
  }
};

const loadDashApprovals = async () => {
  try {
    const data = await req('GET', '/approvals?limit=5');
    const el = document.getElementById('dash-approvals');
    if (!el) return;
    if (!data.users.length) { el.innerHTML = `<div class="empty"><div class="empty-icon">🎉</div><p>Nenhuma aprovação pendente!</p></div>`; return; }
    el.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Nome</th><th>Tipo</th><th>CPF</th><th>Cadastrado em</th><th></th></tr></thead>
      <tbody>${data.users.map(u => `<tr onclick="openApprovalModal('${u._id}')">
        <td><strong>${escHtml(u.name)}</strong><br/><span style="font-size:11px;color:#5C6B7A;">${escHtml(u.email)}</span></td>
        <td>${typeBadge(u.userType)}</td>
        <td>${fmtCPF(u.cpf)}</td>
        <td>${fmtDatetime(u.createdAt)}</td>
        <td><button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openApprovalModal('${u._id}')">Analisar</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  } catch {}
};

// ── APPROVALS ──────────────────────────────────────────────────────
let approvalsPage = 1;
const renderApprovals = async (page = 1) => {
  approvalsPage = page;
  const c = document.getElementById('page-content');
  c.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  try {
    const data = await req('GET', `/approvals?page=${page}&limit=15`);
    if (!data.users.length) {
      c.innerHTML = `<div class="section-card"><div class="section-header"><h2>Fila de Aprovações</h2></div><div class="empty"><div class="empty-icon">🎉</div><p>Nenhum cadastro pendente de aprovação.</p></div></div>`;
      return;
    }
    c.innerHTML = `
      <div class="section-card">
        <div class="section-header">
          <h2>Fila de Aprovações <span style="color:#FFA500;font-size:14px;">(${data.total} pendentes)</span></h2>
          <span style="font-size:12px;color:#5C6B7A;">Ordenado do mais antigo ao mais recente</span>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Nome</th><th>Tipo</th><th>CPF</th><th>Nasc.</th><th>Enviado em</th><th>Ação</th></tr></thead>
          <tbody>${data.users.map((u, i) => `<tr>
            <td style="color:#3D4460;">${(page-1)*15+i+1}</td>
            <td><strong>${escHtml(u.name)}</strong><br/><span style="font-size:11px;color:#5C6B7A;">${escHtml(u.email)}</span></td>
            <td>${typeBadge(u.userType)}</td>
            <td>${fmtCPF(u.cpf)}</td>
            <td>${fmtDate(u.birthDate)}</td>
            <td>${fmtDatetime(u.createdAt)}</td>
            <td><button class="btn btn-primary btn-sm" onclick="openApprovalModal('${u._id}')">🔍 Analisar</button></td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div class="pagination">${renderPagination(page, data.pages, 'renderApprovals')}</div>
      </div>`;
  } catch (err) {
    c.innerHTML = `<div class="alert alert-error">⚠️ ${escHtml(err.message)}</div>`;
  }
};

const openApprovalModal = async (id) => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal"><div class="modal-header"><h3>🔍 Análise de Cadastro</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div><div class="modal-body"><div class="loading-center"><div class="spinner"></div></div></div></div>`;
  document.body.appendChild(overlay);
  try {
    const u = await req('GET', `/approvals/${id}`);
    const body = overlay.querySelector('.modal-body');
    const BASE = '';
    body.innerHTML = `
      <div class="user-info-grid">
        <div class="info-item"><div class="lbl">Nome</div><div class="val">${escHtml(u.name)}</div></div>
        <div class="info-item"><div class="lbl">Tipo</div><div class="val">${u.userType === 'professional' ? '🔧 Profissional' : '👤 Cliente'}</div></div>
        <div class="info-item"><div class="lbl">E-mail</div><div class="val">${escHtml(u.email)}</div></div>
        <div class="info-item"><div class="lbl">Telefone</div><div class="val">${escHtml(u.phone)}</div></div>
        <div class="info-item"><div class="lbl">CPF</div><div class="val">${fmtCPF(u.cpf)}</div></div>
        <div class="info-item"><div class="lbl">Nascimento</div><div class="val">${fmtDate(u.birthDate)}</div></div>
        <div class="info-item"><div class="lbl">Cadastrado</div><div class="val">${fmtDatetime(u.createdAt)}</div></div>
        <div class="info-item"><div class="lbl">Status</div><div class="val">${statusBadge(u.verificationStatus)}</div></div>
      </div>
      <div class="doc-images">
        <div>
          <div class="doc-img-label">📸 Selfie</div>
          <div class="doc-img-wrap" ${u.selfieUrl ? `onclick="openImageZoom('${u.selfieUrl}')"` : ''}>
            ${u.selfieUrl
              ? `<img src="${u.selfieUrl}" alt="Selfie" /><span class="doc-img-zoom-hint">🔍 Clique para ampliar</span>`
              : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#3D4460;font-size:13px;">Sem imagem</div>'}
          </div>
        </div>
        <div>
          <div class="doc-img-label">🪪 Documento</div>
          <div class="doc-img-wrap" ${u.documentUrl ? `onclick="openImageZoom('${u.documentUrl}')"` : ''}>
            ${u.documentUrl
              ? `<img src="${u.documentUrl}" alt="Documento" /><span class="doc-img-zoom-hint">🔍 Clique para ampliar</span>`
              : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#3D4460;font-size:13px;">Sem imagem</div>'}
          </div>
        </div>
      </div>
      <div id="reject-section" style="display:none;">
        <div class="form-group">
          <label class="form-label">Motivo da Rejeição</label>
          <textarea id="reject-reason" class="form-textarea" placeholder="Descreva o motivo para rejeitar o cadastro..."></textarea>
        </div>
      </div>`;
    const footer = overlay.querySelector('.modal-footer') || (() => {
      const f = document.createElement('div'); f.className = 'modal-footer'; overlay.querySelector('.modal').appendChild(f); return f;
    })();
    footer.innerHTML = `
      <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Fechar</button>
      <button class="btn btn-danger" onclick="toggleReject(this)">❌ Rejeitar</button>
      <button class="btn btn-success" id="approve-btn" onclick="doApprove('${id}')">✅ Aprovar</button>`;
  } catch (err) {
    overlay.querySelector('.modal-body').innerHTML = `<div class="alert alert-error">⚠️ ${escHtml(err.message)}</div>`;
  }
};

const toggleReject = (btn) => {
  const section = document.getElementById('reject-section');
  const approveBtn = document.getElementById('approve-btn');
  if (section.style.display === 'none') {
    section.style.display = 'block';
    btn.textContent = '↩ Cancelar';
    approveBtn.textContent = '❌ Confirmar Rejeição';
    approveBtn.className = 'btn btn-danger';
    approveBtn.onclick = () => {
      const id = approveBtn.getAttribute('onclick').match(/'([^']+)'/)?.[1];
    };
    // Re-bind approve btn to reject
    const idMatch = approveBtn.getAttribute('onclick')?.match(/'([^']+)'/);
    if (idMatch) approveBtn.setAttribute('onclick', `doReject('${idMatch[1]}')`);
  } else {
    section.style.display = 'none';
    btn.textContent = '❌ Rejeitar';
    const idMatch = approveBtn.getAttribute('onclick')?.match(/'([^']+)'/);
    if (idMatch) {
      approveBtn.textContent = '✅ Aprovar';
      approveBtn.className = 'btn btn-success';
      approveBtn.setAttribute('onclick', `doApprove('${idMatch[1]}')`);
    }
  }
};

const doApprove = async (id) => {
  if (!confirm('Confirmar aprovação deste cadastro?')) return;
  try {
    await req('PATCH', `/approvals/${id}/approve`);
    document.querySelector('.modal-overlay')?.remove();
    showAlert('Cadastro aprovado! E-mail enviado ao usuário.', 'success');
    renderApprovals(approvalsPage);
  } catch (err) {
    showAlert(err.message);
  }
};

const doReject = async (id) => {
  const reason = document.getElementById('reject-reason')?.value?.trim();
  if (!reason) { alert('Informe o motivo da rejeição.'); return; }
  try {
    await req('PATCH', `/approvals/${id}/reject`, { reason });
    document.querySelector('.modal-overlay')?.remove();
    showAlert('Cadastro rejeitado. E-mail enviado ao usuário.', 'success');
    renderApprovals(approvalsPage);
  } catch (err) {
    showAlert(err.message);
  }
};

// ── USERS ──────────────────────────────────────────────────────────
let usersPage = 1, usersSearch = '', usersType = '', usersStatus = '';
const renderUsers = async (page = 1) => {
  usersPage = page;
  const c = document.getElementById('page-content');
  if (page === 1) c.innerHTML = `
    <div class="search-row" style="margin-bottom:16px;">
      <input id="u-search" class="form-input" placeholder="🔍 Buscar por nome ou e-mail..." value="${escHtml(usersSearch)}" oninput="usersSearch=this.value" onkeydown="if(event.key==='Enter')renderUsers(1)" />
      <select id="u-type" class="form-select" onchange="usersType=this.value;renderUsers(1)">
        <option value="">Todos os tipos</option>
        <option value="client" ${usersType==='client'?'selected':''}>Clientes</option>
        <option value="professional" ${usersType==='professional'?'selected':''}>Profissionais</option>
      </select>
      <select id="u-status" class="form-select" onchange="usersStatus=this.value;renderUsers(1)">
        <option value="">Todos os status</option>
        <option value="pending_documents" ${usersStatus==='pending_documents'?'selected':''}>Docs Pendentes</option>
        <option value="pending_review" ${usersStatus==='pending_review'?'selected':''}>Em Revisão</option>
        <option value="approved" ${usersStatus==='approved'?'selected':''}>Aprovados</option>
        <option value="rejected" ${usersStatus==='rejected'?'selected':''}>Rejeitados</option>
      </select>
      <button class="btn btn-primary" onclick="renderUsers(1)">Buscar</button>
    </div>
    <div id="users-table"><div class="loading-center"><div class="spinner"></div></div></div>`;
  try {
    const params = new URLSearchParams({ page, limit: 20, search: usersSearch, type: usersType, status: usersStatus });
    const data = await req('GET', `/users?${params}`);
    const el = document.getElementById('users-table') || c;
    if (!data.users.length) { el.innerHTML = `<div class="section-card"><div class="empty"><div class="empty-icon">👥</div><p>Nenhum usuário encontrado.</p></div></div>`; return; }
    el.innerHTML = `<div class="section-card">
      <div class="section-header"><h2>Usuários <span style="color:#5C6B7A;font-size:14px;">(${data.total} encontrados)</span></h2></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Nome</th><th>Tipo</th><th>Status</th><th>Ativo</th><th>Cadastro</th><th>Ação</th></tr></thead>
        <tbody>${data.users.map(u => `<tr>
          <td><strong>${escHtml(u.name)}</strong><br/><span style="font-size:11px;color:#5C6B7A;">${escHtml(u.email)}</span></td>
          <td>${typeBadge(u.userType)}</td>
          <td>${statusBadge(u.verificationStatus)}</td>
          <td><span class="${u.isActive ? 'badge badge-approved' : 'badge badge-rejected'}">${u.isActive ? '✓ Ativo' : '✗ Inativo'}</span></td>
          <td>${fmtDate(u.createdAt)}</td>
          <td><button class="btn btn-ghost btn-sm" onclick="toggleUserActive('${u._id}', this)">${u.isActive ? '🚫 Desativar' : '✅ Ativar'}</button></td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div class="pagination">${renderPagination(page, data.pages, 'renderUsers')}</div>
    </div>`;
  } catch (err) {
    showAlert(err.message);
  }
};

const toggleUserActive = async (id, btn) => {
  try {
    const res = await req('PATCH', `/users/${id}/toggle-active`);
    showAlert(res.message, 'success');
    renderUsers(usersPage);
  } catch (err) { showAlert(err.message); }
};

// ── SUPORTE OPERADOR ───────────────────────────────────────────────
let activeSupportChatId = null;
let supportPollingTimer = null;

const renderSupporte = async () => {
  const c = document.getElementById('page-content');
  c.style.padding = '0';
  c.innerHTML = `
    <div style="padding:20px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div class="operator-bar" id="operator-bar">
        <div class="status-dot offline" id="op-dot"></div>
        <div>
          <div class="status-label" id="op-status-label">Offline</div>
          <div class="status-sub" id="op-status-sub">Fique online para receber atendimentos</div>
        </div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:12px;">
          <span id="op-queue-count" style="font-size:12px;color:#FFA500;"></span>
          <button class="btn-toggle-online go-online" id="op-toggle-btn" onclick="toggleOperatorStatus()">🟢 Ficar Online</button>
        </div>
      </div>
    </div>
    <div class="support-layout">
      <div class="support-panel">
        <div class="support-panel-header">
          <span class="support-panel-title">Fila de Espera</span>
          <button class="btn btn-ghost btn-sm" onclick="loadSupportQueue()">↻</button>
        </div>
        <div id="support-queue-list"><div class="loading-center"><div class="spinner"></div></div></div>
        <div class="support-panel-header" style="margin-top:8px;">
          <span class="support-panel-title">Meus Atendimentos</span>
          <button class="btn btn-ghost btn-sm" onclick="loadMyChats()">↻</button>
        </div>
        <div id="support-my-list"><div class="loading-center"><div class="spinner"></div></div></div>
      </div>
      <div id="support-chat-main" style="display:flex;align-items:center;justify-content:center;color:#3D4460;font-size:14px;">
        <div style="text-align:center;">
          <div style="font-size:48px;margin-bottom:12px;">🎧</div>
          <p>Selecione um atendimento para começar</p>
        </div>
      </div>
    </div>`;
  await loadOperatorStatus();
  await loadSupportQueue();
  await loadMyChats();
  // Polling a cada 8s
  if (supportPollingTimer) clearInterval(supportPollingTimer);
  supportPollingTimer = setInterval(async () => {
    if (currentPage !== 'suporte') { clearInterval(supportPollingTimer); return; }
    await loadSupportQueue();
    await loadMyChats();
    await loadOperatorStatus();
  }, 8000);
};

const loadOperatorStatus = async () => {
  try {
    const data = await req('GET', '/support/status');
    const dot = document.getElementById('op-dot');
    const label = document.getElementById('op-status-label');
    const sub = document.getElementById('op-status-sub');
    const btn = document.getElementById('op-toggle-btn');
    const queueCount = document.getElementById('op-queue-count');
    if (!dot) return;
    const isOnline = data.supportStatus === 'online';
    dot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
    label.textContent = isOnline ? `Online · ${data.activeSupportChats || 0}/5 atendimentos` : 'Offline';
    sub.textContent = isOnline ? 'Você está recebendo atendimentos' : 'Fique online para receber atendimentos';
    btn.textContent = isOnline ? '⚫ Ficar Offline' : '🟢 Ficar Online';
    btn.className = `btn-toggle-online ${isOnline ? 'go-offline' : 'go-online'}`;
    if (data.waitingCount > 0) {
      queueCount.textContent = `${data.waitingCount} na fila`;
    } else {
      queueCount.textContent = '';
    }
  } catch {}
};

const toggleOperatorStatus = async () => {
  const btn = document.getElementById('op-toggle-btn');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    const data = await req('PATCH', '/support/toggle-status');
    showAlert(data.message, 'success');
    await loadOperatorStatus();
    await loadSupportQueue();
    await loadMyChats();
  } catch (err) {
    showAlert(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
};

const loadSupportQueue = async () => {
  const el = document.getElementById('support-queue-list');
  if (!el) return;
  try {
    const data = await req('GET', '/support/queue');
    const queue = data.queue || [];
    if (!queue.length) {
      el.innerHTML = `<div style="padding:20px 16px;color:#3D4460;font-size:12px;text-align:center;">Fila vazia</div>`;
      return;
    }
    el.innerHTML = queue.map(ch => `
      <div class="queue-item ${ch._id === activeSupportChatId ? 'active' : ''}" onclick="openSupportChat('${ch._id}','queue')">
        <div class="queue-item-name">${escHtml(ch.userId?.name || 'Usuário')}</div>
        <div class="queue-item-subject">${escHtml(ch.subject || 'Sem assunto')}</div>
        <div class="queue-item-meta">
          <span class="queue-badge queue-badge-wait">⏳ Aguardando</span>
          <span>${fmtDatetime(ch.queuedAt)}</span>
        </div>
      </div>`).join('');
  } catch {}
};

const loadMyChats = async () => {
  const el = document.getElementById('support-my-list');
  if (!el) return;
  try {
    const data = await req('GET', '/support/my-chats');
    const chats = data.chats || [];
    if (!chats.length) {
      el.innerHTML = `<div style="padding:20px 16px;color:#3D4460;font-size:12px;text-align:center;">Nenhum atendimento ativo</div>`;
      return;
    }
    el.innerHTML = chats.map(ch => `
      <div class="queue-item ${ch._id === activeSupportChatId ? 'active' : ''}" onclick="openSupportChat('${ch._id}','my')">
        <div class="queue-item-name">${escHtml(ch.userId?.name || 'Usuário')}</div>
        <div class="queue-item-subject">${escHtml(ch.subject || 'Sem assunto')}</div>
        <div class="queue-item-meta">
          <span class="queue-badge queue-badge-active">💬 Em andamento</span>
          <span>${fmtDatetime(ch.assignedAt)}</span>
        </div>
      </div>`).join('');
  } catch {}
};

const openSupportChat = async (id, context) => {
  activeSupportChatId = id;
  // Refresh highlights
  document.querySelectorAll('.queue-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll(`.queue-item[onclick*="${id}"]`).forEach(el => el.classList.add('active'));
  const main = document.getElementById('support-chat-main');
  if (!main) return;
  main.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  try {
    const data = await req('GET', `/support/chats/${id}`);
    const chat = data.chat;
    const isWaiting = chat.status === 'waiting';
    const isClosed = chat.status === 'closed';
    main.style.display = 'flex';
    main.style.flexDirection = 'column';
    main.innerHTML = `
      <div class="chat-header">
        <div>
          <div style="font-weight:700;font-size:15px;">${escHtml(chat.userId?.name || 'Usuário')}</div>
          <div style="font-size:12px;color:#5C6B7A;">${escHtml(chat.userId?.email || '')} · <strong>Assunto:</strong> ${escHtml(chat.subject || '—')}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          ${isWaiting ? `<span class="badge" style="background:rgba(255,165,0,0.15);color:#FFA500;">⏳ Na Fila</span>` : ''}
          ${!isClosed ? `<button class="btn btn-danger btn-sm" onclick="closeSupportChat('${id}')">🔒 Encerrar</button>` : `<span class="badge badge-closed">Encerrado</span>`}
        </div>
      </div>
      <div class="chat-messages" id="support-msgs" style="flex:1;overflow-y:auto;">
        ${chat.messages.length === 0 ? `<div class="empty"><div class="empty-icon">💬</div><p>Nenhuma mensagem ainda.</p></div>` :
          chat.messages.map(m => `
          <div>
            <div class="msg ${m.sender === 'support' ? 'msg-support' : 'msg-user'}">${escHtml(m.text)}</div>
            <div class="msg-time" style="text-align:${m.sender==='support'?'right':'left'};color:#5C6B7A;">${fmtDatetime(m.createdAt)}</div>
          </div>`).join('')}
      </div>
      ${!isClosed ? `
      <div class="chat-input-row">
        <input id="support-msg-input" class="form-input" placeholder="Responder..." onkeydown="if(event.key==='Enter')sendSupportMsg('${id}')" />
        <button class="btn btn-primary" onclick="sendSupportMsg('${id}')">Enviar</button>
      </div>` : ''}`;
    const msgs = document.getElementById('support-msgs');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  } catch (err) {
    if (main) main.innerHTML = `<div class="alert alert-error" style="margin:16px;">⚠️ ${escHtml(err.message)}</div>`;
  }
};

const sendSupportMsg = async (id) => {
  const input = document.getElementById('support-msg-input');
  const text = input?.value?.trim();
  if (!text) return;
  input.value = '';
  try {
    await req('POST', `/support/chats/${id}/message`, { text });
    openSupportChat(id, 'my');
    loadMyChats();
  } catch (err) { showAlert(err.message); }
};

const closeSupportChat = async (id) => {
  if (!confirm('Encerrar este atendimento?')) return;
  try {
    await req('PATCH', `/support/chats/${id}/close`);
    activeSupportChatId = null;
    const main = document.getElementById('support-chat-main');
    if (main) {
      main.style.flexDirection = '';
      main.innerHTML = `<div style="text-align:center;color:#3D4460;"><div style="font-size:48px;margin-bottom:12px;">🎧</div><p>Atendimento encerrado. Selecione outro.</p></div>`;
    }
    showAlert('Atendimento encerrado!', 'success');
    await loadMyChats();
    await loadSupportQueue();
    await loadOperatorStatus();
  } catch (err) { showAlert(err.message); }
};

// ── CENTRAL DE AJUDA ───────────────────────────────────────────────
let helpExpandedTopics = new Set();

const renderHelpCenter = async () => {
  const c = document.getElementById('page-content');
  c.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  try {
    const data = await req('GET', '/help');
    const topics = data.topics || [];
    c.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
        <button class="btn btn-primary" onclick="openNewTopicModal()">+ Novo Tópico</button>
      </div>
      <div id="help-topics-container">
        ${topics.length ? topics.map(t => renderHelpTopicCard(t)).join('') : '<div class="empty"><div class="empty-icon">📚</div><p>Nenhum tópico cadastrado. Crie o primeiro!</p></div>'}
      </div>`;
  } catch (err) {
    c.innerHTML = `<div class="alert alert-error">⚠️ ${escHtml(err.message)}</div>`;
  }
};

const renderHelpTopicCard = (t) => `
  <div class="help-topic-card" id="htc-${t._id}">
    <div class="help-topic-header" onclick="toggleHelpTopic('${t._id}')">
      <div class="help-topic-icon">${t.icon || '❓'}</div>
      <div style="flex:1;">
        <div class="help-topic-title">${escHtml(t.name || t.title)}</div>
        <div style="font-size:12px;color:#5C6B7A;">${escHtml(t.description || '')}</div>
      </div>
      <div class="help-topic-count">${(t.items||[]).length} itens</div>
      <span style="margin-left:8px;color:#3D4460;font-size:12px;">${helpExpandedTopics.has(t._id) ? '▲' : '▼'}</span>
      <div style="display:flex;gap:6px;margin-left:12px;" onclick="event.stopPropagation()">
        <button class="btn btn-ghost btn-sm" onclick='openEditTopicModal(${JSON.stringify(t)})'>✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteHelpTopic('${t._id}')">🗑️</button>
        <button class="btn btn-primary btn-sm" onclick="openAddItemModal('${t._id}')">+ Item</button>
      </div>
    </div>
    ${helpExpandedTopics.has(t._id) ? `
    <div class="help-topic-body">
      ${(t.items||[]).length === 0
        ? '<div style="padding:16px 20px;color:#3D4460;font-size:13px;">Nenhum item. Adicione uma pergunta e resposta.</div>'
        : (t.items||[]).map(item => `
          <div class="help-item-row">
            <div class="help-item-q">
              <div class="help-item-question">❓ ${escHtml(item.question)}</div>
              <div class="help-item-answer">${escHtml(item.answer)}</div>
              <div class="help-item-ratings">👍 ${item.ratings?.helpful||0} &nbsp;👎 ${item.ratings?.notHelpful||0}</div>
            </div>
            <div class="help-item-actions">
              <button class="btn btn-ghost btn-sm" onclick='openEditItemModal("${t._id}",${JSON.stringify(item)})'>✏️</button>
              <button class="btn btn-danger btn-sm" onclick="deleteHelpItem('${t._id}','${item._id}')">🗑️</button>
            </div>
          </div>`).join('')}
    </div>` : ''}
  </div>`;

const toggleHelpTopic = (id) => {
  if (helpExpandedTopics.has(id)) helpExpandedTopics.delete(id);
  else helpExpandedTopics.add(id);
  renderHelpCenter();
};

const openNewTopicModal = () => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">
    <div class="modal-header"><h3>📚 Novo Tópico de Ajuda</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Título</label><input id="ht-title" class="form-input" placeholder="ex: Pagamentos" /></div>
      <div class="form-group"><label class="form-label">Descrição</label><input id="ht-desc" class="form-input" placeholder="Breve descrição do tópico" /></div>
      <div class="form-group"><label class="form-label">Ícone (emoji)</label><input id="ht-icon" class="form-input" placeholder="ex: 💳" /></div>
      <div class="form-group"><label class="form-label">Ordem</label><input id="ht-order" class="form-input" type="number" value="0" /></div>
      <div class="form-group"><label class="form-label">Status</label>
        <select id="ht-active" class="form-select">
          <option value="true" selected>Ativo (visível no app)</option>
          <option value="false">Inativo</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
      <button class="btn btn-primary" onclick="createHelpTopic()">Criar Tópico</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
};

const createHelpTopic = async () => {
  const title = document.getElementById('ht-title').value.trim();
  const description = document.getElementById('ht-desc').value.trim();
  const icon = document.getElementById('ht-icon').value.trim();
  const sortOrder = parseInt(document.getElementById('ht-order').value) || 0;
  const isActive = document.getElementById('ht-active').value === 'true';
  if (!title) { alert('Título é obrigatório'); return; }
  try {
    await req('POST', '/help', { title, description, icon, sortOrder, isActive });
    document.querySelector('.modal-overlay')?.remove();
    showAlert('Tópico criado!', 'success');
    renderHelpCenter();
  } catch (err) { showAlert(err.message); }
};

const openEditTopicModal = (t) => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">
    <div class="modal-header"><h3>✏️ Editar Tópico</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Título</label><input id="ht-etitle" class="form-input" value="${escHtml(t.title||t.name)}" /></div>
      <div class="form-group"><label class="form-label">Descrição</label><input id="ht-edesc" class="form-input" value="${escHtml(t.description||'')}" /></div>
      <div class="form-group"><label class="form-label">Ícone</label><input id="ht-eicon" class="form-input" value="${escHtml(t.icon||'')}" /></div>
      <div class="form-group"><label class="form-label">Ordem</label><input id="ht-eorder" class="form-input" type="number" value="${t.sortOrder||0}" /></div>
      <div class="form-group"><label class="form-label">Status</label>
        <select id="ht-eactive" class="form-select">
          <option value="true" ${t.isActive!==false?'selected':''}>Ativo</option>
          <option value="false" ${t.isActive===false?'selected':''}>Inativo</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
      <button class="btn btn-primary" onclick="updateHelpTopic('${t._id}')">Salvar</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
};

const updateHelpTopic = async (id) => {
  const title = document.getElementById('ht-etitle').value.trim();
  const description = document.getElementById('ht-edesc').value.trim();
  const icon = document.getElementById('ht-eicon').value.trim();
  const sortOrder = parseInt(document.getElementById('ht-eorder').value) || 0;
  const isActive = document.getElementById('ht-eactive').value === 'true';
  try {
    await req('PATCH', `/help/${id}`, { title, description, icon, sortOrder, isActive });
    document.querySelector('.modal-overlay')?.remove();
    showAlert('Tópico atualizado!', 'success');
    renderHelpCenter();
  } catch (err) { showAlert(err.message); }
};

const deleteHelpTopic = async (id) => {
  if (!confirm('Excluir este tópico e todos os itens?')) return;
  try {
    await req('DELETE', `/help/${id}`);
    showAlert('Tópico removido.', 'success');
    renderHelpCenter();
  } catch (err) { showAlert(err.message); }
};

const openAddItemModal = (topicId) => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">
    <div class="modal-header"><h3>➕ Nova Pergunta & Resposta</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Pergunta</label><input id="hi-question" class="form-input" placeholder="Como faço para...?" /></div>
      <div class="form-group"><label class="form-label">Resposta</label><textarea id="hi-answer" class="form-textarea" placeholder="A resposta completa..."></textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
      <button class="btn btn-primary" onclick="createHelpItem('${topicId}')">Adicionar</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
};

const createHelpItem = async (topicId) => {
  const question = document.getElementById('hi-question').value.trim();
  const answer = document.getElementById('hi-answer').value.trim();
  if (!question || !answer) { alert('Preencha pergunta e resposta'); return; }
  try {
    await req('POST', `/help/${topicId}/items`, { question, answer });
    document.querySelector('.modal-overlay')?.remove();
    helpExpandedTopics.add(topicId);
    showAlert('Pergunta adicionada!', 'success');
    renderHelpCenter();
  } catch (err) { showAlert(err.message); }
};

const openEditItemModal = (topicId, item) => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">
    <div class="modal-header"><h3>✏️ Editar Pergunta</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Pergunta</label><input id="hi-equestion" class="form-input" value="${escHtml(item.question)}" /></div>
      <div class="form-group"><label class="form-label">Resposta</label><textarea id="hi-eanswer" class="form-textarea">${escHtml(item.answer)}</textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
      <button class="btn btn-primary" onclick="updateHelpItem('${topicId}','${item._id}')">Salvar</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
};

const updateHelpItem = async (topicId, itemId) => {
  const question = document.getElementById('hi-equestion').value.trim();
  const answer = document.getElementById('hi-eanswer').value.trim();
  try {
    await req('PATCH', `/help/${topicId}/items/${itemId}`, { question, answer });
    document.querySelector('.modal-overlay')?.remove();
    showAlert('Item atualizado!', 'success');
    renderHelpCenter();
  } catch (err) { showAlert(err.message); }
};

const deleteHelpItem = async (topicId, itemId) => {
  if (!confirm('Remover esta pergunta?')) return;
  try {
    await req('DELETE', `/help/${topicId}/items/${itemId}`);
    showAlert('Item removido.', 'success');
    renderHelpCenter();
  } catch (err) { showAlert(err.message); }
};

// ── CONFIGURAÇÃO DE PREÇOS ────────────────────────────────────────
const renderPricing = async () => {
  const c = document.getElementById('page-content');
  c.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  try {
    const { config } = await req('GET', '/pricing');
    c.innerHTML = `
      <div class="section-header">
        <h2>💰 Configuração de Preços</h2>
      </div>
      <div class="card" style="max-width:520px">
        <div class="card-body" style="display:flex;flex-direction:column;gap:18px">
          <div>
            <label style="font-weight:600;font-size:13px;color:#666;display:block;margin-bottom:6px">Preço base por hora (R$)</label>
            <input id="pr-base" type="number" class="input" value="${config.basePricePerHour}" min="10" max="500" step="1" />
          </div>
          <div>
            <label style="font-weight:600;font-size:13px;color:#666;display:block;margin-bottom:6px">Taxa da plataforma (%)</label>
            <input id="pr-fee" type="number" class="input" value="${config.platformFeePercent}" min="0" max="50" step="0.5" />
          </div>
          <div>
            <label style="font-weight:600;font-size:13px;color:#666;display:block;margin-bottom:6px">Adicional quando profissional traz produtos (R$/h)</label>
            <input id="pr-surcharge" type="number" class="input" value="${config.productsSurcharge}" min="0" max="50" step="1" />
          </div>
          <div style="display:flex;gap:12px">
            <div style="flex:1">
              <label style="font-weight:600;font-size:13px;color:#666;display:block;margin-bottom:6px">Mín. horas</label>
              <input id="pr-min" type="number" class="input" value="${config.minHours}" min="1" max="6" />
            </div>
            <div style="flex:1">
              <label style="font-weight:600;font-size:13px;color:#666;display:block;margin-bottom:6px">Máx. horas</label>
              <input id="pr-max" type="number" class="input" value="${config.maxHours}" min="4" max="24" />
            </div>
          </div>
          <div>
            <label style="font-weight:600;font-size:13px;color:#666;display:block;margin-bottom:6px">Opções de horas (separado por vírgula)</label>
            <input id="pr-options" type="text" class="input" value="${config.hoursOptions.join(', ')}" placeholder="2, 3, 4, 5, 6, 8" />
          </div>
          <div style="background:#fff8f5;border:1.5px solid #FF6B0030;border-radius:12px;padding:16px">
            <div style="font-weight:700;color:#FF6B00;margin-bottom:4px">📊 Exemplo</div>
            <div id="pr-preview" style="font-size:14px;color:#444">—</div>
          </div>
          <button class="btn btn-primary" onclick="savePricing()" style="align-self:flex-start">Salvar configurações</button>
        </div>
      </div>`;

    // Preview dinâmico
    const updatePreview = () => {
      const base = parseFloat(document.getElementById('pr-base').value) || 35;
      const fee = parseFloat(document.getElementById('pr-fee').value) || 15;
      const s = parseFloat(document.getElementById('pr-surcharge').value) || 5;
      const priceWith = base + s;
      const total4 = base * 4;
      document.getElementById('pr-preview').innerHTML =
        \`Sem produtos: R$ \${base}/h → 4h = <b>R$ \${total4.toFixed(2)}</b><br>
         Com produtos do prof.: R$ \${priceWith}/h → 4h = <b>R$ \${(priceWith*4).toFixed(2)}</b><br>
         Taxa plataforma: \${fee}% = R$ \${(total4*fee/100).toFixed(2)} (prof. recebe R$ \${(total4*(1-fee/100)).toFixed(2)})\`;
    };
    ['pr-base','pr-fee','pr-surcharge'].forEach(id =>
      document.getElementById(id).addEventListener('input', updatePreview));
    updatePreview();
  } catch (err) { c.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`; }
};

const savePricing = async () => {
  const base = parseFloat(document.getElementById('pr-base').value);
  const fee = parseFloat(document.getElementById('pr-fee').value);
  const surcharge = parseFloat(document.getElementById('pr-surcharge').value);
  const minH = parseInt(document.getElementById('pr-min').value);
  const maxH = parseInt(document.getElementById('pr-max').value);
  const optStr = document.getElementById('pr-options').value;
  const hoursOptions = optStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
  if (!base || base < 10 || !fee || minH < 1 || maxH < 2 || hoursOptions.length === 0) {
    showAlert('Verifique os valores inseridos.'); return;
  }
  try {
    await req('PATCH', '/pricing', { basePricePerHour: base, platformFeePercent: fee, productsSurcharge: surcharge, minHours: minH, maxHours: maxH, hoursOptions });
    showAlert('Configurações salvas com sucesso!', 'success');
  } catch (err) { showAlert(err.message); }
};

// ── ADMINS ─────────────────────────────────────────────────────────
const renderAdmins = async () => {
  const c = document.getElementById('page-content');
  c.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  try {
    const admins = await req('GET', '/admins');
    c.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:16px;">
        <button class="btn btn-primary" onclick="openNewAdminModal()">+ Novo Admin</button>
      </div>
      <div class="section-card">
        <div class="section-header"><h2>Equipe Administrativa (${admins.length})</h2></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th><th>Criado em</th><th>Ação</th></tr></thead>
          <tbody>${admins.map(a => `<tr>
            <td><div style="display:flex;align-items:center;gap:8px;"><div class="avatar-sm">${a.name[0]}</div><strong>${escHtml(a.name)}</strong></div></td>
            <td>${escHtml(a.email)}</td>
            <td><span class="badge ${a.role==='super_admin'?'badge-approved':a.role==='admin'?'badge-pending':'badge-docs'}">${a.role}</span></td>
            <td><span class="badge ${a.isActive?'badge-approved':'badge-rejected'}">${a.isActive?'Ativo':'Inativo'}</span></td>
            <td>${fmtDate(a.createdAt)}</td>
            <td>${a._id !== adminData?.id ? `<button class="btn btn-danger btn-sm" onclick="deleteAdmin('${a._id}')">Remover</button>` : '<span style="color:#3D4460;font-size:12px;">Você</span>'}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`;
  } catch (err) {
    c.innerHTML = `<div class="alert alert-error">⚠️ ${escHtml(err.message)}</div>`;
  }
};

const openNewAdminModal = () => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">
    <div class="modal-header"><h3>➕ Novo Membro da Equipe</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Nome</label><input id="na-name" class="form-input" placeholder="Nome completo" /></div>
      <div class="form-group"><label class="form-label">E-mail</label><input id="na-email" class="form-input" type="email" placeholder="email@ja.app" /></div>
      <div class="form-group"><label class="form-label">Senha</label><input id="na-pass" class="form-input" type="password" placeholder="Mínimo 8 caracteres" /></div>
      <div class="form-group"><label class="form-label">Perfil</label>
        <select id="na-role" class="form-select">
          <option value="support">Suporte</option>
          <option value="admin">Admin</option>
          <option value="super_admin">Super Admin</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
      <button class="btn btn-primary" onclick="createAdmin()">Criar Membro</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
};

const createAdmin = async () => {
  const name = document.getElementById('na-name').value.trim();
  const email = document.getElementById('na-email').value.trim();
  const password = document.getElementById('na-pass').value;
  const role = document.getElementById('na-role').value;
  if (!name || !email || !password) { alert('Preencha todos os campos.'); return; }
  try {
    await req('POST', '/admins', { name, email, password, role });
    document.querySelector('.modal-overlay')?.remove();
    showAlert('Membro criado com sucesso!', 'success');
    renderAdmins();
  } catch (err) { showAlert(err.message); }
};

const deleteAdmin = async (id) => {
  if (!confirm('Remover este membro permanentemente?')) return;
  try {
    await req('DELETE', `/admins/${id}`);
    showAlert('Membro removido.', 'success');
    renderAdmins();
  } catch (err) { showAlert(err.message); }
};

// ── PAGINATION ─────────────────────────────────────────────────────
const renderPagination = (page, pages, fn) => {
  if (pages <= 1) return '';
  let html = '';
  for (let i = 1; i <= pages; i++) {
    html += `<button class="page-btn ${i===page?'active':''}" onclick="${fn}(${i})">${i}</button>`;
  }
  return html;
};

// ── IMAGE ZOOM ─────────────────────────────────────────────────────
const openImageZoom = (url) => {
  const existing = document.querySelector('.zoom-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.className = 'zoom-overlay';
  overlay.onclick = () => overlay.remove();
  overlay.innerHTML = `
    <button class="zoom-close-btn" onclick="this.closest('.zoom-overlay').remove()">✕</button>
    <img src="${escHtml(url)}" alt="Imagem ampliada" onclick="event.stopPropagation()" />`;
  document.body.appendChild(overlay);
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
  });
};

// ── SERVICE TYPES ──────────────────────────────────────────────────
const renderServiceTypes = async () => {
  const c = document.getElementById('page-content');
  c.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  try {
    const data = await stReq('GET', '');
    const types = data.serviceTypes || [];
    c.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <p style="color:#5C6B7A;font-size:13px;">Gerencie quais profissões estão disponíveis para cadastro no aplicativo.</p>
        <button class="btn btn-primary" onclick="openNewServiceTypeModal()">+ Nova Profissão</button>
      </div>
      <div class="service-type-grid" id="st-grid">
        ${types.length ? types.map(t => renderServiceTypeCard(t)).join('') : '<p style="color:#5C6B7A;">Nenhuma profissão cadastrada. Use o botão acima ou <b>Inicializar seed</b> no dashboard.</p>'}
      </div>`;
  } catch (err) {
    c.innerHTML = `<div class="alert alert-error">⚠️ ${escHtml(err.message)}</div>`;
  }
};

const renderServiceTypeCard = (t) => `
  <div class="service-type-card" id="stc-${t._id}">
    <div class="service-type-icon">${t.icon || '🔧'}</div>
    <div class="service-type-info">
      <div class="service-type-name">${escHtml(t.name)}</div>
      <div class="service-type-desc">${escHtml(t.description || '')}</div>
      <div class="service-type-toggle">
        <label class="toggle-switch" title="${t.status === 'enabled' ? 'Desativar' : 'Ativar'} profissão">
          <input type="checkbox" ${t.status === 'enabled' ? 'checked' : ''} onchange="toggleServiceType('${t._id}', this.checked)" />
          <div class="toggle-track"><div class="toggle-thumb"></div></div>
          <span style="font-size:12px;color:${t.status === 'enabled' ? '#00C853' : '#5C6B7A'};">
            ${t.status === 'enabled' ? 'Ativo no app' : 'Desativado'}
          </span>
        </label>
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" style="align-self:flex-start;flex-shrink:0;" onclick='openEditServiceTypeModal(${JSON.stringify(t)})'>✏️</button>
  </div>`;

const toggleServiceType = async (id, enabled) => {
  try {
    await stReq('PATCH', `/${id}`, { status: enabled ? 'enabled' : 'disabled' });
    renderServiceTypes();
  } catch (err) {
    showAlert(err.message);
    renderServiceTypes();
  }
};

const openNewServiceTypeModal = () => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">
    <div class="modal-header"><h3>➕ Nova Profissão</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Nome</label><input id="st-name" class="form-input" placeholder="ex: Diarista" /></div>
      <div class="form-group"><label class="form-label">Slug (identificador único)</label><input id="st-slug" class="form-input" placeholder="ex: diarista" /></div>
      <div class="form-group"><label class="form-label">Descrição</label><input id="st-desc" class="form-input" placeholder="Breve descrição" /></div>
      <div class="form-group"><label class="form-label">Ícone (emoji)</label><input id="st-icon" class="form-input" placeholder="ex: 🧹" /></div>
      <div class="form-group"><label class="form-label">Status</label>
        <select id="st-status" class="form-select">
          <option value="enabled">Ativo (aparece no app)</option>
          <option value="disabled" selected>Desativado</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
      <button class="btn btn-primary" onclick="createServiceType()">Criar Profissão</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
};

const createServiceType = async () => {
  const name = document.getElementById('st-name').value.trim();
  const slug = document.getElementById('st-slug').value.trim().toLowerCase().replace(/\s+/g, '-');
  const description = document.getElementById('st-desc').value.trim();
  const icon = document.getElementById('st-icon').value.trim();
  const status = document.getElementById('st-status').value;
  if (!name || !slug) { alert('Nome e slug são obrigatórios.'); return; }
  try {
    await stReq('POST', '', { name, slug, description, icon, status });
    document.querySelector('.modal-overlay')?.remove();
    showAlert('Profissão criada!', 'success');
    renderServiceTypes();
  } catch (err) { showAlert(err.message); }
};

const openEditServiceTypeModal = (t) => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">
    <div class="modal-header"><h3>✏️ Editar Profissão</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Nome</label><input id="ste-name" class="form-input" value="${escHtml(t.name)}" /></div>
      <div class="form-group"><label class="form-label">Descrição</label><input id="ste-desc" class="form-input" value="${escHtml(t.description||'')}" /></div>
      <div class="form-group"><label class="form-label">Ícone (emoji)</label><input id="ste-icon" class="form-input" value="${escHtml(t.icon||'')}" /></div>
      <div class="form-group"><label class="form-label">Ordem de exibição</label><input id="ste-order" class="form-input" type="number" value="${t.sortOrder||0}" /></div>
      <div class="form-group"><label class="form-label">Status</label>
        <select id="ste-status" class="form-select">
          <option value="enabled" ${t.status==='enabled'?'selected':''}>Ativo</option>
          <option value="disabled" ${t.status==='disabled'?'selected':''}>Desativado</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
      <button class="btn btn-danger btn-sm" onclick="deleteServiceType('${t._id}')">Excluir</button>
      <button class="btn btn-primary" onclick="updateServiceType('${t._id}')">Salvar</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
};

const updateServiceType = async (id) => {
  const name = document.getElementById('ste-name').value.trim();
  const description = document.getElementById('ste-desc').value.trim();
  const icon = document.getElementById('ste-icon').value.trim();
  const sortOrder = parseInt(document.getElementById('ste-order').value) || 0;
  const status = document.getElementById('ste-status').value;
  try {
    await stReq('PATCH', `/${id}`, { name, description, icon, sortOrder, status });
    document.querySelector('.modal-overlay')?.remove();
    showAlert('Profissão atualizada!', 'success');
    renderServiceTypes();
  } catch (err) { showAlert(err.message); }
};

const deleteServiceType = async (id) => {
  if (!confirm('Excluir esta profissão permanentemente?')) return;
  try {
    await stReq('DELETE', `/${id}`);
    document.querySelector('.modal-overlay')?.remove();
    showAlert('Profissão excluída.', 'success');
    renderServiceTypes();
  } catch (err) { showAlert(err.message); }
};

// ── INIT ───────────────────────────────────────────────────────────
render();
