// ── CONFIG ─────────────────────────────────────────────────────────
const API = '/api/admin';
const API_ST = '/api/service-types';
const API_PAYMENTS = '/api/payments';
let adminToken = localStorage.getItem('adminToken');
let adminData = JSON.parse(localStorage.getItem('adminData') || 'null');
let currentPage = 'dashboard';
let pendingBadge = 0;
let activeChatId = null;
let adminSocket = null;
let p1AlertCount = 0;
let p1AudioContext = null;
let permissionCatalog = [];
let permissionRolePresets = {};
let supportAuditFilters = {
  module: 'support',
  actor: '',
  from: '',
  to: '',
};
let withdrawalQueueState = {
  status: 'all',
  search: '',
  from: '',
  to: '',
  minAmount: '',
  maxAmount: '',
  page: 1,
  limit: 20,
};

const PERMISSIONS = {
  DASHBOARD: 'dashboard_view',
  SUPPORT_CHAT: 'support_chat',
  FINANCIAL: 'financial',
  USER_MANAGEMENT: 'user_management',
  SERVICE_MANAGEMENT: 'service_management',
  CONTENT_MANAGEMENT: 'content_management',
  COUPON_MANAGEMENT: 'coupon_management',
  PAYMENT_MANAGEMENT: 'payment_management',
  ACCESS_MANAGEMENT: 'access_management',
};

const roleFallbackPermissions = (role) => {
  if (role === 'super_admin') return ['*'];
  if (role === 'admin') {
    return [
      PERMISSIONS.DASHBOARD,
      PERMISSIONS.SUPPORT_CHAT,
      PERMISSIONS.FINANCIAL,
      PERMISSIONS.USER_MANAGEMENT,
      PERMISSIONS.SERVICE_MANAGEMENT,
      PERMISSIONS.CONTENT_MANAGEMENT,
      PERMISSIONS.COUPON_MANAGEMENT,
      PERMISSIONS.PAYMENT_MANAGEMENT,
    ];
  }
  return [PERMISSIONS.DASHBOARD, PERMISSIONS.SUPPORT_CHAT];
};

const effectivePermissions = () => {
  const fromToken = adminData?.effectivePermissions;
  if (Array.isArray(fromToken) && fromToken.length) return fromToken;
  const fromCustom = adminData?.permissions;
  if (Array.isArray(fromCustom) && fromCustom.length) return fromCustom;
  return roleFallbackPermissions(adminData?.role);
};

const hasPermission = (...perms) => {
  const permsNow = effectivePermissions();
  if (permsNow.includes('*')) return true;
  return perms.some((perm) => permsNow.includes(perm));
};

const disconnectAdminSocket = () => {
  if (adminSocket) {
    adminSocket.disconnect();
    adminSocket = null;
  }
};

const playP1AlertSound = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!p1AudioContext) p1AudioContext = new AudioCtx();
    const now = p1AudioContext.currentTime;
    [0, 0.22, 0.44].forEach((offset) => {
      const osc = p1AudioContext.createOscillator();
      const gain = p1AudioContext.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(950, now + offset);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.2, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.17);
      osc.connect(gain);
      gain.connect(p1AudioContext.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.18);
    });
  } catch {}
};

const bumpSupportNavP1Badge = () => {
  const supportItem = document.querySelector(`.nav-item[onclick="navTo('suporte')"]`);
  if (!supportItem) return;
  let badge = supportItem.querySelector('.nav-badge-p1');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'nav-badge nav-badge-p1';
    supportItem.appendChild(badge);
  }
  badge.textContent = `P1 ${p1AlertCount}`;
};

const clearSupportNavP1Badge = () => {
  p1AlertCount = 0;
  const supportItem = document.querySelector(`.nav-item[onclick="navTo('suporte')"]`);
  if (!supportItem) return;
  const badge = supportItem.querySelector('.nav-badge-p1');
  if (badge) badge.remove();
};

const notifyP1Alert = (payload = {}) => {
  p1AlertCount += 1;
  bumpSupportNavP1Badge();
  playP1AlertSound();
  const who = payload.userName || 'Profissional';
  const subject = payload.subject || 'Sem assunto';
  showAlert(`🚨 P1: ${who} abriu chamado urgente (${subject})`);

  if (typeof Notification !== 'undefined') {
    if (Notification.permission === 'granted') {
      new Notification('🚨 Suporte Prioridade 1', {
        body: `${who}: ${subject}`,
      });
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  if (currentPage === 'suporte') {
    loadSupportQueue();
    loadOperatorStatus();
    if (typeof loadSupportAuditLogs === 'function') loadSupportAuditLogs();
  }
};

const connectAdminSocket = () => {
  if (!adminToken || typeof io !== 'function' || adminSocket) return;
  adminSocket = io({ auth: { token: adminToken } });
  adminSocket.on('support_p1_alert', notifyP1Alert);
  adminSocket.on('connect_error', (err) => {
    console.warn('Socket admin indisponível:', err?.message || err);
  });
};

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

const stMultipartReq = async (method, path, formData) => {
  const r = await fetch(API_ST + path, {
    method,
    headers: { Authorization: `Bearer ${adminToken}` },
    body: formData,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || 'Erro');
  return data;
};

const paymentReq = async (method, path, body) => {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API_PAYMENTS + path, opts);
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

const withdrawalStatusBadge = (status) => {
  const map = {
    pending: ['badge-pending', '⏳ Pendente'],
    processing: ['badge-docs', '🛠️ Processando'],
    completed: ['badge-approved', '✅ Concluído'],
    cancelled: ['badge-rejected', '❌ Cancelado'],
  };
  const [cls, label] = map[status] || ['badge-ghost', status];
  return `<span class="badge ${cls}">${label}</span>`;
};

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
  connectAdminSocket();
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
    connectAdminSocket();
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
          ${hasPermission(PERMISSIONS.DASHBOARD) ? `
          <div class="nav-item ${currentPage==='dashboard'?'active':''}" onclick="navTo('dashboard')">
            <span class="icon">📊</span> Dashboard
          </div>` : ''}
          ${hasPermission(PERMISSIONS.USER_MANAGEMENT) ? `
          <div class="nav-item ${currentPage==='approvals'?'active':''}" onclick="navTo('approvals')">
            <span class="icon">🔍</span> Aprovações
            ${pendingBadge > 0 ? `<span class="nav-badge">${pendingBadge}</span>` : ''}
          </div>` : ''}
          <div class="nav-group-label">Gestão</div>
          ${hasPermission(PERMISSIONS.USER_MANAGEMENT) ? `
          <div class="nav-item ${currentPage==='users'?'active':''}" onclick="navTo('users')">
            <span class="icon">👥</span> Usuários
          </div>` : ''}
          ${hasPermission(PERMISSIONS.SUPPORT_CHAT) ? `
          <div class="nav-item ${currentPage==='suporte'?'active':''}" onclick="navTo('suporte')">
            <span class="icon">🏎️</span> Suporte Operador
          </div>
          <div class="nav-item ${currentPage==='pause-types'?'active':''}" onclick="navTo('pause-types')">
            <span class="icon">⏸️</span> Tipos de Pausa
          </div>` : ''}
          ${hasPermission(PERMISSIONS.CONTENT_MANAGEMENT) ? `
          <div class="nav-item ${currentPage==='ajuda'?'active':''}" onclick="navTo('ajuda')">
            <span class="icon">📚</span> Central de Ajuda
          </div>
          <div class="nav-item ${currentPage==='termos'?'active':''}" onclick="navTo('termos')">
            <span class="icon">📄</span> Termos de Uso
          </div>` : ''}
          ${hasPermission(PERMISSIONS.FINANCIAL) ? `
          <div class="nav-item ${currentPage==='precos'?'active':''}" onclick="navTo('precos')">
            <span class="icon">💰</span> Configurar Preços
          </div>` : ''}
          ${hasPermission(PERMISSIONS.COUPON_MANAGEMENT) ? `
          <div class="nav-item ${currentPage==='cupons'?'active':''}" onclick="navTo('cupons')">
            <span class="icon">🎟️</span> Cupons
          </div>` : ''}
          ${hasPermission(PERMISSIONS.PAYMENT_MANAGEMENT) ? `
          <div class="nav-item ${currentPage==='pagamentos'?'active':''}" onclick="navTo('pagamentos')">
            <span class="icon">💳</span> Pagamentos
          </div>` : ''}
          ${hasPermission(PERMISSIONS.FINANCIAL) ? `
          <div class="nav-item ${currentPage==='saques'?'active':''}" onclick="navTo('saques')">
            <span class="icon">🏦</span> Saques PIX
          </div>` : ''}
          ${hasPermission(PERMISSIONS.SERVICE_MANAGEMENT) || hasPermission(PERMISSIONS.ACCESS_MANAGEMENT) ? `
          <div class="nav-group-label">Configurações</div>
          ${hasPermission(PERMISSIONS.SERVICE_MANAGEMENT) ? `
          <div class="nav-item ${currentPage==='service-types'?'active':''}" onclick="navTo('service-types')">
            <span class="icon">📋</span> Profissões
          </div>` : ''}
          ${hasPermission(PERMISSIONS.ACCESS_MANAGEMENT) ? `
          <div class="nav-item ${currentPage==='admins'?'active':''}" onclick="navTo('admins')">
            <span class="icon">🛡️</span> Equipe Admin
          </div>` : ''}` : ''}
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
      const approvalItem = sidebar.querySelector(`.nav-item[onclick="navTo('approvals')"]`);
      if (approvalItem && pendingBadge > 0) {
        const existing = approvalItem.querySelector('.nav-badge');
        if (!existing) approvalItem.innerHTML += `<span class="nav-badge">${pendingBadge}</span>`;
      }
    }
  } catch {}

  renderPage();
};

const navTo = (page) => {
  const pagePermissionMap = {
    dashboard: [PERMISSIONS.DASHBOARD],
    approvals: [PERMISSIONS.USER_MANAGEMENT],
    users: [PERMISSIONS.USER_MANAGEMENT],
    suporte: [PERMISSIONS.SUPPORT_CHAT],
    ajuda: [PERMISSIONS.CONTENT_MANAGEMENT],
    termos: [PERMISSIONS.CONTENT_MANAGEMENT],
    precos: [PERMISSIONS.FINANCIAL],
    cupons: [PERMISSIONS.COUPON_MANAGEMENT],
    pagamentos: [PERMISSIONS.PAYMENT_MANAGEMENT],
    saques: [PERMISSIONS.FINANCIAL],
    'service-types': [PERMISSIONS.SERVICE_MANAGEMENT],
    'pause-types': [PERMISSIONS.SUPPORT_CHAT],
    admins: [PERMISSIONS.ACCESS_MANAGEMENT],
  };
  const required = pagePermissionMap[page] || [PERMISSIONS.DASHBOARD];
  if (!hasPermission(...required)) {
    showAlert('Você não tem acesso a este módulo');
    return;
  }

  currentPage = page;
  if (page === 'suporte') clearSupportNavP1Badge();
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const selectedItem = document.querySelector(`.nav-item[onclick="navTo('${page}')"]`);
  if (selectedItem) selectedItem.classList.add('active');
  document.getElementById('page-title').textContent = {
    dashboard: 'Dashboard',
    approvals: 'Fila de Aprovações',
    users: 'Usuários',
    suporte: 'Suporte ao Vivo',
    ajuda: 'Central de Ajuda',
    termos: 'Termos de Uso',
    precos: 'Configuração de Preços',
    cupons: 'Cupons de Desconto',
    pagamentos: 'Pagamentos & Stripe',
    saques: 'Fila de Saques PIX',
    'service-types': 'Profissões e Serviços',
    'pause-types': 'Tipos de Pausa',
    admins: 'Equipe Admin',
  }[page] || page;
  renderPage();
};

const renderPage = () => {
  const pagePermissionMap = {
    dashboard: [PERMISSIONS.DASHBOARD],
    approvals: [PERMISSIONS.USER_MANAGEMENT],
    users: [PERMISSIONS.USER_MANAGEMENT],
    suporte: [PERMISSIONS.SUPPORT_CHAT],
    ajuda: [PERMISSIONS.CONTENT_MANAGEMENT],
    termos: [PERMISSIONS.CONTENT_MANAGEMENT],
    precos: [PERMISSIONS.FINANCIAL],
    cupons: [PERMISSIONS.COUPON_MANAGEMENT],
    pagamentos: [PERMISSIONS.PAYMENT_MANAGEMENT],
    saques: [PERMISSIONS.FINANCIAL],
    'service-types': [PERMISSIONS.SERVICE_MANAGEMENT],
    'pause-types': [PERMISSIONS.SUPPORT_CHAT],
    admins: [PERMISSIONS.ACCESS_MANAGEMENT],
  };
  const required = pagePermissionMap[currentPage] || [PERMISSIONS.DASHBOARD];
  if (!hasPermission(...required)) {
    currentPage = hasPermission(PERMISSIONS.SUPPORT_CHAT) ? 'suporte' : 'dashboard';
  }
  const pages = { dashboard: renderDashboard, approvals: renderApprovals, users: renderUsers, suporte: renderSupporte, ajuda: renderHelpCenter, termos: renderTerms, precos: renderPricing, cupons: renderCoupons, pagamentos: renderPayments, saques: renderWithdrawalsQueue, 'service-types': renderServiceTypes, 'pause-types': renderPauseTypes, admins: renderAdmins };
  (pages[currentPage] || renderDashboard)();
};

const doLogout = () => {
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminData');
  disconnectAdminSocket();
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
let supportRequestSearchResults = [];

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
        <div class="support-panel-header" style="margin-top:8px;">
          <span class="support-panel-title">Chats de Serviço</span>
          <button class="btn btn-ghost btn-sm" onclick="loadServiceChats()">↻</button>
        </div>
        <div id="service-chat-list"><div class="loading-center"><div class="spinner"></div></div></div>
        <div class="support-panel-header" style="margin-top:8px;">
          <span class="support-panel-title">Buscar Serviço Contratado</span>
          <button class="btn btn-ghost btn-sm" onclick="runSupportRequestSearch()">↻</button>
        </div>
        <div style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;gap:8px;">
          <input id="support-request-q" class="form-input" placeholder="Nome, email, telefone ou ID do serviço" onkeydown="if(event.key==='Enter')runSupportRequestSearch()" />
          <div style="display:flex;gap:8px;">
            <select id="support-request-status" class="form-select" style="flex:1;">
              <option value="all">Todos status</option>
              <option value="searching">Buscando profissional</option>
              <option value="accepted">Aceito</option>
              <option value="in_progress">Em andamento</option>
              <option value="completed">Concluído</option>
              <option value="cancelled">Cancelado</option>
            </select>
            <button class="btn btn-primary btn-sm" onclick="runSupportRequestSearch()">Buscar</button>
          </div>
        </div>
        <div id="support-request-list"><div style="padding:20px 16px;color:#3D4460;font-size:12px;text-align:center;">Nenhuma busca realizada</div></div>
        <div class="support-panel-header" style="margin-top:8px;">
          <span class="support-panel-title">Auditoria (recente)</span>
          <button class="btn btn-ghost btn-sm" onclick="loadSupportAuditLogs()">↻</button>
        </div>
        <div style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;gap:8px;">
          <select id="audit-filter-module" class="form-select" onchange="applySupportAuditFilters()">
            <option value="support" ${supportAuditFilters.module === 'support' ? 'selected' : ''}>Módulo suporte</option>
            <option value="financial" ${supportAuditFilters.module === 'financial' ? 'selected' : ''}>Módulo financeiro</option>
            <option value="access" ${supportAuditFilters.module === 'access' ? 'selected' : ''}>Módulo acesso</option>
            <option value="" ${supportAuditFilters.module === '' ? 'selected' : ''}>Todos módulos</option>
          </select>
          <input id="audit-filter-actor" class="form-input" placeholder="Ator (nome, email ou ID)" value="${escHtml(supportAuditFilters.actor)}" onkeydown="if(event.key==='Enter')applySupportAuditFilters()" />
          <div style="display:flex;gap:8px;">
            <input id="audit-filter-from" type="date" class="form-input" value="${escHtml(supportAuditFilters.from)}" />
            <input id="audit-filter-to" type="date" class="form-input" value="${escHtml(supportAuditFilters.to)}" />
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-primary btn-sm" onclick="applySupportAuditFilters()">Aplicar</button>
            <button class="btn btn-ghost btn-sm" onclick="exportSupportAuditCsv()">Exportar CSV</button>
          </div>
        </div>
        <div id="support-audit-list"><div class="loading-center"><div class="spinner"></div></div></div>
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
  await loadServiceChats();
  await runSupportRequestSearch();
  await loadSupportAuditLogs();
  // Polling a cada 8s
  if (supportPollingTimer) clearInterval(supportPollingTimer);
  supportPollingTimer = setInterval(async () => {
    if (currentPage !== 'suporte') { clearInterval(supportPollingTimer); return; }
    await loadSupportQueue();
    await loadMyChats();
    await loadServiceChats();
    await loadSupportAuditLogs();
    await loadOperatorStatus();
  }, 8000);
};

const loadServiceChats = async () => {
  const el = document.getElementById('service-chat-list');
  if (!el) return;
  try {
    const data = await req('GET', '/service-chats');
    const chats = data.chats || [];
    if (!chats.length) {
      el.innerHTML = `<div style="padding:20px 16px;color:#3D4460;font-size:12px;text-align:center;">Nenhum chat de serviço</div>`;
      return;
    }
    el.innerHTML = chats.map(ch => `
      <div class="queue-item ${ch._id === activeSupportChatId ? 'active' : ''} ${ch.priority === 'p1' ? 'priority-p1' : ''}" onclick="openServiceChatAudit('${ch._id}')">
        <div class="queue-item-name">${escHtml(ch.clientId?.name || 'Cliente')} → ${escHtml(ch.professionalId?.name || 'Profissional')}</div>
        <div class="queue-item-subject">Pedido ${escHtml(ch.requestId?._id || '')}</div>
        <div class="queue-item-meta">
          <span class="queue-badge ${ch.status === 'active' ? 'queue-badge-active' : 'badge-closed'}">${ch.status === 'active' ? '💬 Ativo' : '🔒 Encerrado'}</span>
          <span>${fmtDatetime(ch.updatedAt || ch.createdAt)}</span>
        </div>
      </div>`).join('');
  } catch {
    el.innerHTML = `<div style="padding:20px 16px;color:#3D4460;font-size:12px;text-align:center;">Erro ao carregar</div>`;
  }
};

const loadSupportAuditLogs = async () => {
  const el = document.getElementById('support-audit-list');
  if (!el) return;
  try {
    const params = new URLSearchParams();
    params.set('limit', '20');
    if (supportAuditFilters.module) params.set('module', supportAuditFilters.module);
    if (supportAuditFilters.actor) params.set('actor', supportAuditFilters.actor);
    if (supportAuditFilters.from) params.set('from', supportAuditFilters.from);
    if (supportAuditFilters.to) params.set('to', supportAuditFilters.to);
    const data = await req('GET', `/audit-logs?${params.toString()}`);
    const logs = data.logs || [];
    if (!logs.length) {
      el.innerHTML = `<div style="padding:16px;color:#3D4460;font-size:12px;text-align:center;">Sem eventos recentes</div>`;
      return;
    }
    el.innerHTML = logs.map((log) => `
      <div class="queue-item" style="cursor:default;">
        <div class="queue-item-name">${escHtml(log.message || log.action)}</div>
        <div class="queue-item-subject">${escHtml(log.actorAdminId?.name || log.actorUserId?.name || log.actorType || 'sistema')}</div>
        <div class="queue-item-meta">
          <span class="queue-badge ${log.severity === 'critical' ? 'queue-badge-p1' : 'queue-badge-active'}">${escHtml(log.severity || 'normal')}</span>
          <span>${fmtDatetime(log.createdAt)}</span>
        </div>
      </div>
    `).join('');
  } catch {
    el.innerHTML = `<div style="padding:16px;color:#FF8A80;font-size:12px;text-align:center;">Erro ao carregar auditoria</div>`;
  }
};

const applySupportAuditFilters = () => {
  supportAuditFilters = {
    module: document.getElementById('audit-filter-module')?.value || '',
    actor: (document.getElementById('audit-filter-actor')?.value || '').trim(),
    from: document.getElementById('audit-filter-from')?.value || '',
    to: document.getElementById('audit-filter-to')?.value || '',
  };
  loadSupportAuditLogs();
};

const exportSupportAuditCsv = () => {
  const params = new URLSearchParams();
  params.set('limit', '2000');
  if (supportAuditFilters.module) params.set('module', supportAuditFilters.module);
  if (supportAuditFilters.actor) params.set('actor', supportAuditFilters.actor);
  if (supportAuditFilters.from) params.set('from', supportAuditFilters.from);
  if (supportAuditFilters.to) params.set('to', supportAuditFilters.to);
  const url = `${API}/audit-logs/export.csv?${params.toString()}`;
  fetch(url, {
    headers: { Authorization: `Bearer ${adminToken}` },
  }).then(async (response) => {
    if (!response.ok) {
      let message = 'Erro ao exportar auditoria';
      try {
        const data = await response.json();
        message = data?.message || message;
      } catch {}
      throw new Error(message);
    }
    return response.blob();
  }).then((blob) => {
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    showAlert('CSV da auditoria exportado com sucesso', 'success');
  }).catch((err) => {
    showAlert(err.message || 'Erro ao exportar auditoria');
  });
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
      const p1Label = data.waitingP1Count > 0 ? ` · ${data.waitingP1Count} P1` : '';
      queueCount.textContent = `${data.waitingCount} na fila${p1Label}`;
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
      <div class="queue-item ${ch._id === activeSupportChatId ? 'active' : ''} ${ch.priority === 'p1' ? 'priority-p1' : ''}" onclick="openSupportChat('${ch._id}','queue')">
        <div class="queue-item-name">${escHtml(ch.userId?.name || 'Usuário')}</div>
        <div class="queue-item-subject">${escHtml(ch.subject || 'Sem assunto')}</div>
        <div class="queue-item-meta">
          <span class="queue-badge ${ch.priority === 'p1' ? 'queue-badge-p1' : 'queue-badge-wait'}">${ch.priority === 'p1' ? '🚨 P1' : '⏳ Aguardando'}</span>
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
      <div class="queue-item ${ch._id === activeSupportChatId ? 'active' : ''} ${ch.priority === 'p1' ? 'priority-p1' : ''}" onclick="openSupportChat('${ch._id}','my')">
        <div class="queue-item-name">${escHtml(ch.userId?.name || 'Usuário')}</div>
        <div class="queue-item-subject">${escHtml(ch.subject || 'Sem assunto')}</div>
        <div class="queue-item-meta">
          <span class="queue-badge ${ch.priority === 'p1' ? 'queue-badge-p1' : 'queue-badge-active'}">${ch.priority === 'p1' ? '🚨 P1 em andamento' : '💬 Em andamento'}</span>
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
    const isP1 = chat.priority === 'p1';
    main.style.display = 'flex';
    main.style.flexDirection = 'column';
    main.innerHTML = `
      <div class="chat-header">
        <div>
          <div style="font-weight:700;font-size:15px;">${escHtml(chat.userId?.name || 'Usuário')}</div>
          <div style="font-size:12px;color:#5C6B7A;">${escHtml(chat.userId?.email || '')} · <strong>Assunto:</strong> ${escHtml(chat.subject || '—')}</div>
          ${isP1 ? `<div style="font-size:12px;color:#FF8A80;margin-top:6px;"><strong>Emergência:</strong> ${escHtml(chat.emergencyContext || 'Sem contexto adicional')}</div>` : ''}
          ${chat.relatedServiceRequestId ? `<div style="font-size:12px;color:#FFB199;margin-top:4px;"><strong>Serviço vinculado:</strong> ${escHtml(chat.relatedServiceRequestId)}</div>` : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          ${isP1 ? `<span class="badge queue-badge-p1">🚨 Prioridade 1</span>` : ''}
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
    await loadServiceChats();
    await loadOperatorStatus();
  } catch (err) { showAlert(err.message); }
};

const openServiceChatAudit = async (id) => {
  activeSupportChatId = id;
  document.querySelectorAll('.queue-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll(`.queue-item[onclick*="${id}"]`).forEach(el => el.classList.add('active'));
  const main = document.getElementById('support-chat-main');
  if (!main) return;
  main.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  try {
    const data = await req('GET', `/service-chats/${id}`);
    const chat = data.chat;
    main.style.display = 'flex';
    main.style.flexDirection = 'column';
    main.innerHTML = `
      <div class="chat-header">
        <div>
          <div style="font-weight:700;font-size:15px;">${escHtml(chat.clientId?.name || 'Cliente')}</div>
          <div style="font-size:12px;color:#5C6B7A;">${escHtml(chat.clientId?.email || '')} · <strong>Assunto:</strong> ${escHtml(chat.subject || '—')}</div>
          ${isP1 ? `<div style="font-size:12px;color:#FF8A80;margin-top:6px;"><strong>Emergência:</strong> ${escHtml(chat.emergencyContext || 'Sem contexto adicional')}</div>` : ''}
          ${chat.relatedServiceRequestId ? `<div style="font-size:12px;color:#FFB199;margin-top:4px;"><strong>Serviço vinculado:</strong> ${escHtml(chat.relatedServiceRequestId)}</div>` : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span class="badge ${chat.status === 'active' ? 'badge-approved' : 'badge-closed'}">${chat.status === 'active' ? 'Ativo' : 'Encerrado'}</span>
        </div>
      </div>
      <div class="chat-messages" id="support-msgs" style="flex:1;overflow-y:auto;">
        ${chat.messages.length === 0 ? `<div class="empty"><div class="empty-icon">💬</div><p>Nenhuma mensagem trocada.</p></div>` :
          chat.messages.map(m => `
          <div>
            <div class="msg ${m.sender === 'professional' ? 'msg-support' : 'msg-user'}"><strong>${m.sender === 'professional' ? 'Profissional' : 'Cliente'}:</strong> ${escHtml(m.text)}</div>
            <div class="msg-time" style="text-align:${m.sender==='professional'?'right':'left'};color:#5C6B7A;">${fmtDatetime(m.createdAt)}</div>
          </div>`).join('')}
      </div>`;
    const msgs = document.getElementById('support-msgs');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  } catch (err) {
    main.innerHTML = `<div class="alert alert-error" style="margin:16px;">⚠️ ${escHtml(err.message)}</div>`;
  }
};

const supportRequestStatusLabel = (status) => {
  const map = {
    searching: 'Buscando profissional',
    accepted: 'Aceito',
    in_progress: 'Em andamento',
    completed: 'Concluído',
    cancelled: 'Cancelado',
  };
  return map[status] || status || '—';
};

const runSupportRequestSearch = async () => {
  const listEl = document.getElementById('support-request-list');
  if (!listEl) return;
  const q = document.getElementById('support-request-q')?.value?.trim() || '';
  const status = document.getElementById('support-request-status')?.value || 'all';
  listEl.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  try {
    const query = `/support/requests/search?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&limit=30`;
    const data = await req('GET', query);
    supportRequestSearchResults = data.items || [];
    if (!supportRequestSearchResults.length) {
      listEl.innerHTML = `<div style="padding:20px 16px;color:#3D4460;font-size:12px;text-align:center;">Nenhum serviço encontrado</div>`;
      return;
    }
    listEl.innerHTML = supportRequestSearchResults.map((item) => `
      <div class="queue-item" onclick="openSupportRequestDetails('${item._id}')">
        <div class="queue-item-name">#${escHtml(String(item._id).slice(-8))} · ${escHtml(item.client?.name || 'Cliente')}</div>
        <div class="queue-item-subject">${escHtml(item.client?.email || 'Sem e-mail')} ${item.client?.phone ? `· ${escHtml(item.client.phone)}` : ''}</div>
        <div class="queue-item-meta">
          <span class="queue-badge ${item.status === 'cancelled' ? 'badge-closed' : 'queue-badge-active'}">${escHtml(supportRequestStatusLabel(item.status))}</span>
          <span>${fmtDatetime(item.createdAt)}</span>
        </div>
      </div>`).join('');
  } catch (err) {
    listEl.innerHTML = `<div style="padding:20px 16px;color:#FF8A80;font-size:12px;text-align:center;">${escHtml(err.message)}</div>`;
  }
};

const openSupportRequestDetails = async (id) => {
  const main = document.getElementById('support-chat-main');
  if (!main) return;
  let item = supportRequestSearchResults.find((r) => r._id === id);
  if (!item) {
    try {
      const data = await req('GET', `/support/requests/search?q=${encodeURIComponent(id)}&status=all&limit=1`);
      item = (data.items || [])[0];
    } catch {}
  }
  if (!item) {
    showAlert('Serviço não encontrado');
    return;
  }
  const canCancel = !!item?.supportActions?.canCancel;
  const canRefund = !!item?.supportActions?.canRefund;
  main.style.display = 'flex';
  main.style.flexDirection = 'column';
  main.innerHTML = `
    <div class="chat-header">
      <div>
        <div style="font-weight:700;font-size:15px;">Serviço #${escHtml(String(item._id))}</div>
        <div style="font-size:12px;color:#5C6B7A;">Cliente: ${escHtml(item.client?.name || '—')} · Profissional: ${escHtml(item.professional?.name || 'Não atribuído')}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="badge ${item.status === 'cancelled' ? 'badge-closed' : 'badge-approved'}">${escHtml(supportRequestStatusLabel(item.status))}</span>
      </div>
    </div>
    <div style="padding:16px 20px;overflow:auto;display:flex;flex-direction:column;gap:10px;">
      <div style="font-size:13px;color:#B0B8D0;"><strong>Contato cliente:</strong> ${escHtml(item.client?.email || '—')} ${item.client?.phone ? `· ${escHtml(item.client.phone)}` : ''}</div>
      <div style="font-size:13px;color:#B0B8D0;"><strong>Contato profissional:</strong> ${escHtml(item.professional?.email || '—')} ${item.professional?.phone ? `· ${escHtml(item.professional.phone)}` : ''}</div>
      <div style="font-size:13px;color:#B0B8D0;"><strong>Pagamento:</strong> ${escHtml(item.payment?.status || '—')} · ${escHtml(item.payment?.method || '—')} ${item.payment?.transactionId ? `· TX ${escHtml(item.payment.transactionId)}` : ''}</div>
      <div style="font-size:13px;color:#B0B8D0;"><strong>Valor:</strong> ${fmtMoney(item.pricing?.final ?? item.pricing?.estimated ?? 0)}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;">
        <button class="btn btn-danger" ${canCancel ? '' : 'disabled'} onclick="supportCancelRequest('${item._id}')">Cancelar serviço</button>
        <button class="btn btn-warning" ${canRefund ? '' : 'disabled'} onclick="supportRefundRequest('${item._id}')">Solicitar estorno</button>
      </div>
      <div style="font-size:11px;color:#5C6B7A;">Use cancelamento para interromper o serviço. Use estorno para devolver pagamento (automático em Stripe cartão quando possível).</div>
    </div>`;
};

const supportCancelRequest = async (id) => {
  const reason = prompt('Motivo do cancelamento (opcional):', 'Cancelado pelo suporte');
  if (reason === null) return;
  try {
    await req('PATCH', `/support/requests/${id}/cancel`, { reason });
    showAlert('Serviço cancelado com sucesso', 'success');
    await runSupportRequestSearch();
    await loadSupportQueue();
  } catch (err) {
    showAlert(err.message);
  }
};

const supportRefundRequest = async (id) => {
  const reason = prompt('Motivo do estorno (opcional):', 'Solicitação de estorno via suporte');
  if (reason === null) return;
  try {
    const res = await req('PATCH', `/support/requests/${id}/refund`, { reason });
    showAlert(res.message || 'Estorno processado', 'success');
    await runSupportRequestSearch();
  } catch (err) {
    showAlert(err.message);
  }
};

// ── TERMOS DE USO ─────────────────────────────────────────────────
const renderTerms = async () => {
  const c = document.getElementById('page-content');
  c.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  try {
    const data = await req('GET', '/terms');
    c.innerHTML = `
      <div class="section-card">
        <div class="section-header">
          <h2>📄 Termos de Uso</h2>
          <span style="font-size:12px;color:#5C6B7A;">Última atualização: ${data.updatedAt ? fmtDatetime(data.updatedAt) : '—'}</span>
        </div>
        <div style="margin-bottom:12px;font-size:13px;color:#5C6B7A;">
          Escreva o texto completo dos termos de uso. O conteúdo será exibido no aplicativo quando o usuário tocar em "Termos de uso".
        </div>
        <div class="form-group">
          <label class="form-label">Conteúdo dos Termos</label>
          <textarea id="terms-content" class="form-textarea" style="min-height:400px;font-family:monospace;font-size:13px;" placeholder="Digite aqui o texto dos termos de uso...">${escHtml(data.content || '')}</textarea>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:16px;gap:12px;">
          <button class="btn btn-ghost" onclick="renderTerms()">↺ Descartar alterações</button>
          <button class="btn btn-primary" onclick="saveTerms()">💾 Salvar Termos</button>
        </div>
      </div>`;
  } catch (err) {
    c.innerHTML = `<div class="alert alert-error">⚠️ ${escHtml(err.message)}</div>`;
  }
};

const saveTerms = async () => {
  const content = document.getElementById('terms-content')?.value;
  if (content === undefined) return;
  try {
    await req('PATCH', '/terms', { content });
    showAlert('Termos de uso salvos com sucesso!', 'success');
    renderTerms();
  } catch (err) {
    showAlert(err.message);
  }
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
    const [{ config }, stData] = await Promise.all([
      req('GET', '/pricing'),
      stReq('GET', '/'),
    ]);
    const serviceTypes = (stData.serviceTypes || []).sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
    const serviceBasePrices = config.serviceBasePrices || {};

    const serviceRows = serviceTypes.length
      ? serviceTypes.map((st) => {
        const custom = serviceBasePrices[st.slug] !== undefined && serviceBasePrices[st.slug] !== null;
        const value = custom ? Number(serviceBasePrices[st.slug]) : Number(config.basePricePerHour || 35);
        return `
          <tr>
            <td>
              <strong>${escHtml(st.name)}</strong>
              <div style="font-size:12px;color:#7A84A0;margin-top:3px">slug: ${escHtml(st.slug)}</div>
            </td>
            <td>
              <span class="badge ${st.status === 'enabled' ? 'badge-approved' : 'badge-rejected'}">
                ${st.status === 'enabled' ? 'Ativo' : 'Desativado'}
              </span>
            </td>
            <td>
              <input
                id="pr-svc-${escHtml(st.slug)}"
                data-service-price="1"
                data-slug="${escHtml(st.slug)}"
                type="number"
                class="form-input"
                value="${value}"
                min="1"
                max="1000"
                step="1"
                style="max-width:160px"
              />
            </td>
            <td style="font-size:12px;color:#7A84A0">
              ${custom ? 'Preço personalizado' : 'Usando base global'}
            </td>
          </tr>`;
      }).join('')
      : `<tr><td colspan="4" style="text-align:center;color:#7A84A0">Nenhum tipo de serviço cadastrado.</td></tr>`;

    c.innerHTML = `
      <div class="section-header">
        <h2>💰 Configuração de Preços</h2>
      </div>
      <div style="display:grid;grid-template-columns:1fr;gap:18px;max-width:1040px">
        <div class="section-card">
          <div class="section-header"><h2>Parâmetros Globais</h2></div>
          <div style="padding:18px 22px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Preço base por hora (R$)</label>
              <input id="pr-base" type="number" class="form-input" value="${config.basePricePerHour}" min="10" max="1000" step="1" />
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Taxa da plataforma (%)</label>
              <input id="pr-fee" type="number" class="form-input" value="${config.platformFeePercent}" min="0" max="50" step="0.5" />
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Adicional com produtos (R$/h)</label>
              <input id="pr-surcharge" type="number" class="form-input" value="${config.productsSurcharge}" min="0" max="200" step="1" />
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Mínimo de horas</label>
              <input id="pr-min" type="number" class="form-input" value="${config.minHours}" min="1" max="12" />
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Máximo de horas</label>
              <input id="pr-max" type="number" class="form-input" value="${config.maxHours}" min="2" max="24" />
            </div>
            <div class="form-group" style="margin-bottom:0;grid-column:1 / -1">
              <label class="form-label">Opções de horas (separado por vírgula)</label>
              <input id="pr-options" type="text" class="form-input" value="${config.hoursOptions.join(', ')}" placeholder="2, 3, 4, 5, 6, 8" />
            </div>
          </div>
        </div>

        <div class="section-card">
          <div class="section-header">
            <h2>Preço Base por Tipo de Serviço</h2>
            <span style="font-size:12px;color:#7A84A0">Se não alterar, usa o preço global</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Serviço</th>
                  <th>Status</th>
                  <th>Preço Base (R$/h)</th>
                  <th>Regra</th>
                </tr>
              </thead>
              <tbody>${serviceRows}</tbody>
            </table>
          </div>
        </div>

        <div class="section-card">
          <div class="section-header"><h2>Pré-visualização</h2></div>
          <div style="padding:18px 22px;display:flex;flex-direction:column;gap:8px">
            <div id="pr-preview" style="font-size:14px;color:#B0B8D0;line-height:1.7">—</div>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn btn-primary" onclick="savePricing()">Salvar configurações</button>
        </div>
      </div>`;

    // Preview dinâmico
    const updatePreview = () => {
      const base = parseFloat(document.getElementById('pr-base').value) || 35;
      const fee = parseFloat(document.getElementById('pr-fee').value) || 15;
      const s = parseFloat(document.getElementById('pr-surcharge').value) || 5;
      const firstServiceInput = document.querySelector('[data-service-price="1"]');
      const serviceName = firstServiceInput?.closest('tr')?.querySelector('strong')?.textContent || 'Serviço selecionado';
      const servicePrice = firstServiceInput ? (parseFloat(firstServiceInput.value) || base) : base;
      const priceWith = servicePrice + s;
      const total4 = servicePrice * 4;
      document.getElementById('pr-preview').innerHTML =
        '<b>' + escHtml(serviceName) + '</b><br>' +
        'Sem produtos: R$ ' + servicePrice + '/h → 4h = <b>R$ ' + total4.toFixed(2) + '</b><br>' +
        'Com produtos do prof.: R$ ' + priceWith + '/h → 4h = <b>R$ ' + (priceWith * 4).toFixed(2) + '</b><br>' +
        'Taxa plataforma: ' + fee + '% = R$ ' + (total4 * fee / 100).toFixed(2) +
        ' (prof. recebe R$ ' + (total4 * (1 - fee / 100)).toFixed(2) + ')';
    };
    ['pr-base', 'pr-fee', 'pr-surcharge'].forEach(id =>
      document.getElementById(id).addEventListener('input', updatePreview));
    document.querySelectorAll('[data-service-price="1"]').forEach(el => {
      el.addEventListener('input', updatePreview);
    });
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
  const serviceBasePrices = {};

  document.querySelectorAll('[data-service-price="1"]').forEach((el) => {
    const slug = el.getAttribute('data-slug');
    const n = parseFloat(el.value);
    if (slug && Number.isFinite(n) && n > 0) {
      serviceBasePrices[slug] = n;
    }
  });

  const hoursOptions = optStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
  if (!Number.isFinite(base) || base < 10 || !Number.isFinite(fee) || fee < 0 || minH < 1 || maxH < 2 || hoursOptions.length === 0) {
    showAlert('Verifique os valores inseridos.'); return;
  }
  if (minH > maxH) {
    showAlert('Mín. horas não pode ser maior que Máx. horas.'); return;
  }
  try {
    await req('PATCH', '/pricing', {
      basePricePerHour: base,
      serviceBasePrices,
      platformFeePercent: fee,
      productsSurcharge: surcharge,
      minHours: minH,
      maxHours: maxH,
      hoursOptions,
    });
    showAlert('Configurações salvas com sucesso!', 'success');
  } catch (err) { showAlert(err.message); }
};

// ── CUPONS ─────────────────────────────────────────────────────────
const fmtMoney = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
const COUPONS_PAGE_SIZE = 10;

const couponDiscountLabel = (c) => {
  if (c.usageScope === 'professional_reward') {
    if (c.professionalRewardType === 'fixed_bonus') {
      return `Bônus profissional ${fmtMoney(c.professionalRewardValue || 0)}`;
    }
    if (c.professionalRewardType === 'platform_fee_discount') {
      return `- ${Number(c.professionalRewardValue || 0)} p.p. da taxa`;
    }
    return 'Incentivo profissional';
  }
  if (c.discountType === 'percent') {
    const cap = c.maxDiscount ? ` (máx. ${fmtMoney(c.maxDiscount)})` : '';
    return `${c.discountValue}%${cap}`;
  }
  return fmtMoney(c.discountValue);
};

const couponScenarioLabel = (c) => {
  if (c.usageScope === 'professional_reward') {
    const firstService = c.professionalFirstServiceOnly ? ' (1o servico)' : '';
    if (c.professionalRewardType === 'fixed_bonus') {
      return `Profissional: bonus ${fmtMoney(c.professionalRewardValue || 0)}${firstService}`;
    }
    if (c.professionalRewardType === 'platform_fee_discount') {
      return `Profissional: taxa -${Number(c.professionalRewardValue || 0)} p.p.${firstService}`;
    }
    return `Profissional: incentivo${firstService}`;
  }

  const firstOrder = c.firstOrderOnly ? '1o pedido' : 'pedido livre';
  if (c.distributionType === 'clients') return `Cliente: ${firstOrder}`;
  if (c.distributionType === 'professionals') return `Profissional (checkout): ${firstOrder}`;
  return `Checkout: ${firstOrder}`;
};

const distributionLabel = (c) => {
  const map = {
    none: 'Somente por código',
    all: 'Todos os usuários',
    clients: 'Apenas clientes',
    professionals: 'Apenas profissionais',
    specific: `Usuários específicos (${(c.specificUsers || []).length})`,
  };
  return map[c.distributionType] || c.distributionType;
};

const couponValidityLabel = (coupon) => {
  const now = new Date();
  const startsAt = coupon.startsAt ? new Date(coupon.startsAt) : null;
  const endsAt = coupon.endsAt ? new Date(coupon.endsAt) : null;
  const status = !coupon.isActive
    ? 'Inativo'
    : startsAt && startsAt > now
      ? 'Agendado'
      : endsAt && endsAt < now
        ? 'Expirado'
        : 'Vigente';

  const range = `${startsAt ? fmtDatetime(startsAt) : 'Sem início'} → ${endsAt ? fmtDatetime(endsAt) : 'Sem fim'}`;
  return { status, range };
};

const getCouponSortValue = (coupon, sortBy) => {
  switch (sortBy) {
    case 'code':
      return coupon.code || '';
    case 'title':
      return coupon.title || '';
    case 'discount':
      return Number(coupon.discountValue || 0);
    case 'uses':
      return Number(coupon.metrics?.totalUsed || 0);
    case 'claims':
      return Number(coupon.metrics?.totalClaimed || 0);
    case 'endsAt':
      return coupon.endsAt ? new Date(coupon.endsAt).getTime() : Number.MAX_SAFE_INTEGER;
    case 'createdAt':
    default:
      return coupon.createdAt ? new Date(coupon.createdAt).getTime() : 0;
  }
};

const sortCoupons = (coupons, sortBy, sortDir) => {
  const factor = sortDir === 'asc' ? 1 : -1;
  return [...coupons].sort((left, right) => {
    const a = getCouponSortValue(left, sortBy);
    const b = getCouponSortValue(right, sortBy);
    if (typeof a === 'string' || typeof b === 'string') {
      return String(a).localeCompare(String(b), 'pt-BR') * factor;
    }
    return ((a > b) - (a < b)) * factor;
  });
};

const renderCouponTableRows = (coupons) => {
  if (!coupons.length) {
    return `<tr><td colspan="8" style="text-align:center;color:#7A84A0">Nenhum cupom encontrado com os filtros atuais.</td></tr>`;
  }

  return coupons.map(cp => `
    <tr>
      <td>
        <strong>${escHtml(cp.code)}</strong>
        <div style="font-size:12px;color:#7A84A0;margin-top:3px">${escHtml(cp.title)}</div>
      </td>
      <td>${escHtml(couponDiscountLabel(cp))}</td>
      <td style="font-size:12px;color:#7A84A0">
        <div>Min: ${fmtMoney(cp.minOrderValue || 0)}</div>
        <div>${cp.stackable ? 'Combinável' : 'Não combinável'}</div>
        <div>${cp.firstOrderOnly ? 'Somente 1º pedido' : 'Pedido livre'}</div>
        <div style="margin-top:4px;color:#9DC4FF;">${escHtml(couponScenarioLabel(cp))}</div>
      </td>
      <td style="font-size:12px;color:#7A84A0">
        <div>${escHtml(couponValidityLabel(cp).status)}</div>
        <div>${escHtml(couponValidityLabel(cp).range)}</div>
      </td>
      <td>${escHtml(distributionLabel(cp))}</td>
      <td style="font-size:12px;color:#7A84A0">
        <div>${cp.metrics?.totalUsed || 0} usos</div>
        <div>${cp.metrics?.totalClaimed || 0} na carteira</div>
      </td>
      <td>
        <span class="badge ${cp.isActive ? 'badge-approved' : 'badge-rejected'}">${cp.isActive ? 'Ativo' : 'Inativo'}</span>
      </td>
      <td class="td-actions">
        <button class="btn btn-ghost btn-sm" onclick='openEditCouponModal(${JSON.stringify(cp).replace(/'/g, '&#39;')})'>✏️</button>
        <button class="btn btn-primary btn-sm" onclick='openDistributeCouponModal(${JSON.stringify(cp).replace(/'/g, '&#39;')})'>🎯</button>
        <button class="btn btn-danger btn-sm" onclick="toggleCoupon('${cp._id}')">${cp.isActive ? 'Desativar' : 'Ativar'}</button>
      </td>
    </tr>
  `).join('');
};

const renderCouponPagination = (totalItems, currentPage, pageSize) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const prevDisabled = currentPage <= 1 ? 'disabled' : '';
  const nextDisabled = currentPage >= totalPages ? 'disabled' : '';

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 18px;border-top:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:12px;color:#7A84A0;">Página ${currentPage} de ${totalPages}</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn-ghost btn-sm" onclick="changeCouponsPage(-1)" ${prevDisabled}>Anterior</button>
        <button class="btn btn-ghost btn-sm" onclick="changeCouponsPage(1)" ${nextDisabled}>Próxima</button>
      </div>
    </div>
  `;
};

const renderCouponsTableState = () => {
  const filtered = window.__couponFilteredList || [];
  const currentPage = window.__couponCurrentPage || 1;
  const totalPages = Math.max(1, Math.ceil(filtered.length / COUPONS_PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  window.__couponCurrentPage = safePage;

  const start = (safePage - 1) * COUPONS_PAGE_SIZE;
  const paged = filtered.slice(start, start + COUPONS_PAGE_SIZE);

  const tbody = document.getElementById('coupons-tbody');
  const count = document.getElementById('coupon-filter-count');
  const pagination = document.getElementById('coupon-pagination');
  if (tbody) tbody.innerHTML = renderCouponTableRows(paged);
  if (count) count.textContent = `${filtered.length} de ${(window.__couponList || []).length}`;
  if (pagination) pagination.innerHTML = renderCouponPagination(filtered.length, safePage, COUPONS_PAGE_SIZE);
};

const applyCouponFilters = () => {
  const coupons = window.__couponList || [];
  const search = (document.getElementById('coupon-search')?.value || '').trim().toLowerCase();
  const status = document.getElementById('coupon-status-filter')?.value || 'all';
  const distribution = document.getElementById('coupon-distribution-filter')?.value || '';
  const discountType = document.getElementById('coupon-discount-filter')?.value || 'all';
  const stacking = document.getElementById('coupon-stacking-filter')?.value || 'all';
  const validity = document.getElementById('coupon-validity-filter')?.value || 'all';
  const sortBy = document.getElementById('coupon-sort-by')?.value || 'createdAt';
  const sortDir = document.getElementById('coupon-sort-dir')?.value || 'desc';
  const now = new Date();

  const filtered = coupons.filter((coupon) => {
    const matchesSearch = !search
      || coupon.code?.toLowerCase().includes(search)
      || coupon.title?.toLowerCase().includes(search)
      || coupon.description?.toLowerCase().includes(search);
    const matchesStatus = status === 'all'
      || (status === 'active' && coupon.isActive)
      || (status === 'inactive' && !coupon.isActive);
    const matchesDistribution = !distribution || coupon.distributionType === distribution;
    const matchesDiscountType = discountType === 'all' || coupon.discountType === discountType;
    const matchesStacking = stacking === 'all'
      || (stacking === 'stackable' && coupon.stackable)
      || (stacking === 'single' && !coupon.stackable);
    const startsAt = coupon.startsAt ? new Date(coupon.startsAt) : null;
    const endsAt = coupon.endsAt ? new Date(coupon.endsAt) : null;
    const validityState = !coupon.isActive
      ? 'inactive'
      : startsAt && startsAt > now
        ? 'scheduled'
        : endsAt && endsAt < now
          ? 'expired'
          : 'valid';
    const matchesValidity = validity === 'all' || validityState === validity;

    return matchesSearch && matchesStatus && matchesDistribution && matchesDiscountType && matchesStacking && matchesValidity;
  });

  window.__couponFilteredList = sortCoupons(filtered, sortBy, sortDir);
  window.__couponCurrentPage = 1;
  renderCouponsTableState();
};

const changeCouponsPage = (direction) => {
  const filtered = window.__couponFilteredList || [];
  const totalPages = Math.max(1, Math.ceil(filtered.length / COUPONS_PAGE_SIZE));
  const nextPage = Math.min(totalPages, Math.max(1, (window.__couponCurrentPage || 1) + direction));
  window.__couponCurrentPage = nextPage;
  renderCouponsTableState();
};

const resetCouponFilters = () => {
  const defaults = {
    'coupon-search': '',
    'coupon-status-filter': 'all',
    'coupon-distribution-filter': '',
    'coupon-discount-filter': 'all',
    'coupon-stacking-filter': 'all',
    'coupon-validity-filter': 'all',
    'coupon-sort-by': 'createdAt',
    'coupon-sort-dir': 'desc',
  };
  Object.entries(defaults).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
  applyCouponFilters();
};

const renderCoupons = async () => {
  const c = document.getElementById('page-content');
  c.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  try {
    const [{ coupons }, usersData] = await Promise.all([
      req('GET', '/coupons'),
      req('GET', '/users?limit=200'),
    ]);
    window.__couponUsers = usersData.users || [];
    window.__couponList = coupons || [];

    c.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;gap:10px;flex-wrap:wrap;">
        <p style="color:#7A84A0;font-size:13px;max-width:760px;">Crie cupons com limite total/por usuário, escolha distribuição (todos, clientes, profissionais ou específicos) e configure se o cupom pode ser combinado com outros.</p>
        <button class="btn btn-primary" onclick="openNewCouponModal()">+ Novo Cupom</button>
      </div>

      <div class="section-card">
        <div class="section-header">
          <h2>Filtros</h2>
          <button class="btn btn-ghost btn-sm" onclick="resetCouponFilters()">Limpar</button>
        </div>
        <div style="padding:18px 22px;">
          <div class="search-row" style="margin-bottom:0;">
            <input id="coupon-search" class="form-input" placeholder="Buscar por código, título ou descrição" />
            <select id="coupon-status-filter" class="form-select">
              <option value="all">Todos status</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
            </select>
            <select id="coupon-distribution-filter" class="form-select">
              <option value="">Toda distribuição</option>
              <option value="none">Somente código</option>
              <option value="all">Todos os usuários</option>
              <option value="clients">Clientes</option>
              <option value="professionals">Profissionais</option>
              <option value="specific">Específicos</option>
            </select>
            <select id="coupon-discount-filter" class="form-select">
              <option value="all">Todo desconto</option>
              <option value="percent">Percentual</option>
              <option value="fixed">Valor fixo</option>
            </select>
            <select id="coupon-stacking-filter" class="form-select">
              <option value="all">Toda regra</option>
              <option value="stackable">Combinável</option>
              <option value="single">Não combinável</option>
            </select>
          </div>
        </div>
      </div>

      <div class="section-card">
        <div class="section-header">
          <h2>Cupons cadastrados (<span id="coupon-filter-count">${coupons.length} de ${coupons.length}</span>)</h2>
        </div>
        <div class="table-wrap"><table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Desconto</th>
              <th>Regra</th>
              <th>Validade</th>
              <th>Distribuição</th>
              <th>Uso</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody id="coupons-tbody">${renderCouponTableRows(coupons)}</tbody>
        </table></div>
        <div id="coupon-pagination">${renderCouponPagination(coupons.length, 1, COUPONS_PAGE_SIZE)}</div>
      </div>
    `;

    const filterHost = document.querySelector('.search-row');
    if (filterHost) {
      filterHost.insertAdjacentHTML('beforeend', `
        <select id="coupon-validity-filter" class="form-select">
          <option value="all">Toda validade</option>
          <option value="valid">Vigentes</option>
          <option value="scheduled">Agendados</option>
          <option value="expired">Expirados</option>
          <option value="inactive">Inativos</option>
        </select>
        <select id="coupon-sort-by" class="form-select">
          <option value="createdAt">Ordenar por criação</option>
          <option value="endsAt">Ordenar por vencimento</option>
          <option value="code">Ordenar por código</option>
          <option value="title">Ordenar por título</option>
          <option value="discount">Ordenar por desconto</option>
          <option value="uses">Ordenar por usos</option>
          <option value="claims">Ordenar por resgates</option>
        </select>
        <select id="coupon-sort-dir" class="form-select">
          <option value="desc">Maior primeiro</option>
          <option value="asc">Menor primeiro</option>
        </select>
      `);
    }

    ['coupon-search', 'coupon-status-filter', 'coupon-distribution-filter', 'coupon-discount-filter', 'coupon-stacking-filter', 'coupon-validity-filter', 'coupon-sort-by', 'coupon-sort-dir']
      .forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener(id === 'coupon-search' ? 'input' : 'change', applyCouponFilters);
      });

    window.__couponFilteredList = sortCoupons(coupons, 'createdAt', 'desc');
    window.__couponCurrentPage = 1;
    renderCouponsTableState();
  } catch (err) {
    c.innerHTML = `<div class="empty-state"><p>${escHtml(err.message)}</p></div>`;
  }
};

const openNewCouponModal = () => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:680px;">
      <div class="modal-header"><h3>🎟️ Novo Cupom</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <div class="modal-body" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group" style="grid-column:1 / -1;"><label class="form-label">Título</label><input id="cp-title" class="form-input" placeholder="Ex: 20% OFF Primeira Limpeza" /></div>
        <div class="form-group" style="grid-column:1 / -1;"><label class="form-label">Descrição</label><input id="cp-description" class="form-input" placeholder="Texto exibido na carteira" /></div>
        <div class="form-group"><label class="form-label">Tipo de desconto</label>
          <select id="cp-discount-type" class="form-select">
            <option value="percent">Percentual (%)</option>
            <option value="fixed">Valor fixo (R$)</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Valor do desconto</label><input id="cp-discount-value" type="number" class="form-input" value="10" min="0" step="0.5" /></div>
        <div class="form-group"><label class="form-label">Desconto máximo (R$)</label><input id="cp-max-discount" type="number" class="form-input" placeholder="Opcional" min="0" step="0.5" /></div>
        <div class="form-group"><label class="form-label">Pedido mínimo (R$)</label><input id="cp-min-order" type="number" class="form-input" value="0" min="0" step="0.5" /></div>
        <div class="form-group"><label class="form-label">Limite total de uso</label><input id="cp-max-total" type="number" class="form-input" placeholder="Opcional" min="1" step="1" /></div>
        <div class="form-group"><label class="form-label">Limite por usuário</label><input id="cp-max-user" type="number" class="form-input" value="1" min="1" step="1" /></div>
        <div class="form-group"><label class="form-label">Início (opcional)</label><input id="cp-start" type="datetime-local" class="form-input" /></div>
        <div class="form-group"><label class="form-label">Fim (opcional)</label><input id="cp-end" type="datetime-local" class="form-input" /></div>
        <div class="form-group"><label class="form-label">Distribuição inicial</label>
          <select id="cp-distribution" class="form-select">
            <option value="none">Somente por código</option>
            <option value="all">Todos os usuários</option>
            <option value="clients">Clientes</option>
            <option value="professionals">Profissionais</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Escopo de uso</label>
          <select id="cp-usage-scope" class="form-select">
            <option value="checkout">Desconto no checkout</option>
            <option value="professional_reward">Incentivo para profissional</option>
          </select>
        </div>
        <div class="form-group" style="display:flex;align-items:flex-end;gap:14px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#B0B8D0;"><input type="checkbox" id="cp-first-order-only" /> Somente primeiro pedido</label>
        </div>
        <div class="form-group"><label class="form-label">Tipo incentivo profissional</label>
          <select id="cp-pro-reward-type" class="form-select">
            <option value="none">Nenhum</option>
            <option value="fixed_bonus">Bônus fixo (R$)</option>
            <option value="platform_fee_discount">Redução da taxa (pontos percentuais)</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Valor incentivo profissional</label><input id="cp-pro-reward-value" type="number" class="form-input" value="0" min="0" step="0.5" /></div>
        <div class="form-group" style="display:flex;align-items:flex-end;gap:14px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#B0B8D0;"><input type="checkbox" id="cp-pro-first-service" /> Somente primeiro serviço do profissional</label>
        </div>
        <div class="form-group" style="display:flex;align-items:flex-end;gap:14px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#B0B8D0;"><input type="checkbox" id="cp-stackable" /> Pode combinar com outro cupom</label>
        </div>
        <div class="form-group"><label class="form-label">Código personalizado</label><input id="cp-code" class="form-input" placeholder="Ex: BEMVINDO20" /></div>
        <div class="form-group" style="display:flex;align-items:flex-end;"><label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#B0B8D0;"><input type="checkbox" id="cp-auto-code" checked /> Gerar código automático</label></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="createCoupon()">Criar cupom</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
};

const createCoupon = async () => {
  const payload = {
    title: document.getElementById('cp-title').value.trim(),
    description: document.getElementById('cp-description').value.trim(),
    discountType: document.getElementById('cp-discount-type').value,
    discountValue: parseFloat(document.getElementById('cp-discount-value').value),
    maxDiscount: document.getElementById('cp-max-discount').value || null,
    minOrderValue: parseFloat(document.getElementById('cp-min-order').value || '0'),
    maxTotalUses: document.getElementById('cp-max-total').value || null,
    maxUsesPerUser: parseInt(document.getElementById('cp-max-user').value || '1'),
    startsAt: document.getElementById('cp-start').value || null,
    endsAt: document.getElementById('cp-end').value || null,
    distributionType: document.getElementById('cp-distribution').value,
    usageScope: document.getElementById('cp-usage-scope').value,
    firstOrderOnly: document.getElementById('cp-first-order-only').checked,
    professionalRewardType: document.getElementById('cp-pro-reward-type').value,
    professionalRewardValue: parseFloat(document.getElementById('cp-pro-reward-value').value || '0'),
    professionalFirstServiceOnly: document.getElementById('cp-pro-first-service').checked,
    stackable: document.getElementById('cp-stackable').checked,
    autoCode: document.getElementById('cp-auto-code').checked,
    code: document.getElementById('cp-code').value.trim(),
  };

  if (!payload.title || !Number.isFinite(payload.discountValue)) {
    showAlert('Preencha título e valor de desconto.');
    return;
  }

  try {
    await req('POST', '/coupons', payload);
    document.querySelector('.modal-overlay')?.remove();
    showAlert('Cupom criado com sucesso!', 'success');
    renderCoupons();
  } catch (err) {
    showAlert(err.message);
  }
};

const openEditCouponModal = (coupon) => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:680px;">
      <div class="modal-header"><h3>✏️ Editar Cupom</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <div class="modal-body" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group" style="grid-column:1 / -1;"><label class="form-label">Título</label><input id="cpe-title" class="form-input" value="${escHtml(coupon.title)}" /></div>
        <div class="form-group" style="grid-column:1 / -1;"><label class="form-label">Descrição</label><input id="cpe-description" class="form-input" value="${escHtml(coupon.description || '')}" /></div>
        <div class="form-group"><label class="form-label">Código</label><input id="cpe-code" class="form-input" value="${escHtml(coupon.code)}" /></div>
        <div class="form-group"><label class="form-label">Tipo</label>
          <select id="cpe-discount-type" class="form-select">
            <option value="percent" ${coupon.discountType === 'percent' ? 'selected' : ''}>Percentual</option>
            <option value="fixed" ${coupon.discountType === 'fixed' ? 'selected' : ''}>Valor fixo</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Valor desconto</label><input id="cpe-discount-value" type="number" class="form-input" value="${coupon.discountValue}" /></div>
        <div class="form-group"><label class="form-label">Máx. desconto</label><input id="cpe-max-discount" type="number" class="form-input" value="${coupon.maxDiscount || ''}" /></div>
        <div class="form-group"><label class="form-label">Pedido mínimo</label><input id="cpe-min-order" type="number" class="form-input" value="${coupon.minOrderValue || 0}" /></div>
        <div class="form-group"><label class="form-label">Limite total</label><input id="cpe-max-total" type="number" class="form-input" value="${coupon.maxTotalUses || ''}" /></div>
        <div class="form-group"><label class="form-label">Limite por usuário</label><input id="cpe-max-user" type="number" class="form-input" value="${coupon.maxUsesPerUser || 1}" /></div>
        <div class="form-group"><label class="form-label">Início</label><input id="cpe-start" type="datetime-local" class="form-input" value="${coupon.startsAt ? new Date(coupon.startsAt).toISOString().slice(0,16) : ''}" /></div>
        <div class="form-group"><label class="form-label">Fim</label><input id="cpe-end" type="datetime-local" class="form-input" value="${coupon.endsAt ? new Date(coupon.endsAt).toISOString().slice(0,16) : ''}" /></div>
        <div class="form-group"><label class="form-label">Escopo de uso</label>
          <select id="cpe-usage-scope" class="form-select">
            <option value="checkout" ${(coupon.usageScope || 'checkout') === 'checkout' ? 'selected' : ''}>Desconto no checkout</option>
            <option value="professional_reward" ${(coupon.usageScope || 'checkout') === 'professional_reward' ? 'selected' : ''}>Incentivo para profissional</option>
          </select>
        </div>
        <div class="form-group" style="display:flex;align-items:flex-end;"><label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#B0B8D0;"><input type="checkbox" id="cpe-first-order-only" ${coupon.firstOrderOnly ? 'checked' : ''} /> Somente primeiro pedido</label></div>
        <div class="form-group"><label class="form-label">Tipo incentivo profissional</label>
          <select id="cpe-pro-reward-type" class="form-select">
            <option value="none" ${coupon.professionalRewardType === 'none' ? 'selected' : ''}>Nenhum</option>
            <option value="fixed_bonus" ${coupon.professionalRewardType === 'fixed_bonus' ? 'selected' : ''}>Bônus fixo (R$)</option>
            <option value="platform_fee_discount" ${coupon.professionalRewardType === 'platform_fee_discount' ? 'selected' : ''}>Redução da taxa (pontos percentuais)</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Valor incentivo profissional</label><input id="cpe-pro-reward-value" type="number" class="form-input" value="${coupon.professionalRewardValue || 0}" /></div>
        <div class="form-group" style="display:flex;align-items:flex-end;"><label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#B0B8D0;"><input type="checkbox" id="cpe-pro-first-service" ${coupon.professionalFirstServiceOnly ? 'checked' : ''} /> Somente primeiro serviço do profissional</label></div>
        <div class="form-group" style="display:flex;align-items:flex-end;"><label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#B0B8D0;"><input type="checkbox" id="cpe-stackable" ${coupon.stackable ? 'checked' : ''} /> Pode combinar com outro cupom</label></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="updateCoupon('${coupon._id}')">Salvar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
};

const updateCoupon = async (id) => {
  const payload = {
    title: document.getElementById('cpe-title').value.trim(),
    description: document.getElementById('cpe-description').value.trim(),
    code: document.getElementById('cpe-code').value.trim(),
    discountType: document.getElementById('cpe-discount-type').value,
    discountValue: parseFloat(document.getElementById('cpe-discount-value').value),
    maxDiscount: document.getElementById('cpe-max-discount').value || null,
    minOrderValue: parseFloat(document.getElementById('cpe-min-order').value || '0'),
    maxTotalUses: document.getElementById('cpe-max-total').value || null,
    maxUsesPerUser: parseInt(document.getElementById('cpe-max-user').value || '1'),
    startsAt: document.getElementById('cpe-start').value || null,
    endsAt: document.getElementById('cpe-end').value || null,
    usageScope: document.getElementById('cpe-usage-scope').value,
    firstOrderOnly: document.getElementById('cpe-first-order-only').checked,
    professionalRewardType: document.getElementById('cpe-pro-reward-type').value,
    professionalRewardValue: parseFloat(document.getElementById('cpe-pro-reward-value').value || '0'),
    professionalFirstServiceOnly: document.getElementById('cpe-pro-first-service').checked,
    stackable: document.getElementById('cpe-stackable').checked,
  };
  try {
    await req('PATCH', `/coupons/${id}`, payload);
    document.querySelector('.modal-overlay')?.remove();
    showAlert('Cupom atualizado!', 'success');
    renderCoupons();
  } catch (err) {
    showAlert(err.message);
  }
};

const openDistributeCouponModal = (coupon) => {
  const users = window.__couponUsers || [];
  const selectedSet = new Set((coupon.specificUsers || []).map((u) => (u._id || u).toString()));
  const userRows = users.map((u) => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;color:#B0B8D0;">
      <input type="checkbox" class="cpd-user" value="${u._id}" ${selectedSet.has(u._id) ? 'checked' : ''} />
      <span>${escHtml(u.name)} · ${escHtml(u.email)} (${u.userType})</span>
    </label>
  `).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:760px;">
      <div class="modal-header"><h3>🎯 Distribuir Cupom ${escHtml(coupon.code)}</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:12px;">
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Distribuição</label>
          <select id="cpd-distribution" class="form-select" onchange="toggleSpecificUsersBlock(this.value)">
            <option value="none" ${coupon.distributionType === 'none' ? 'selected' : ''}>Somente por código</option>
            <option value="all" ${coupon.distributionType === 'all' ? 'selected' : ''}>Todos os usuários</option>
            <option value="clients" ${coupon.distributionType === 'clients' ? 'selected' : ''}>Somente clientes</option>
            <option value="professionals" ${coupon.distributionType === 'professionals' ? 'selected' : ''}>Somente profissionais</option>
            <option value="specific" ${coupon.distributionType === 'specific' ? 'selected' : ''}>Usuários específicos</option>
          </select>
        </div>
        <div id="cpd-specific-wrap" style="max-height:260px;overflow:auto;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px;display:${coupon.distributionType === 'specific' ? 'block' : 'none'};">
          ${userRows || '<p style="color:#7A84A0;">Nenhum usuário disponível.</p>'}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="saveCouponDistribution('${coupon._id}')">Salvar distribuição</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
};

const toggleSpecificUsersBlock = (distributionType) => {
  const block = document.getElementById('cpd-specific-wrap');
  if (!block) return;
  block.style.display = distributionType === 'specific' ? 'block' : 'none';
};

const saveCouponDistribution = async (couponId) => {
  const distributionType = document.getElementById('cpd-distribution').value;
  const selectedUsers = Array.from(document.querySelectorAll('.cpd-user:checked')).map((el) => el.value);
  if (distributionType === 'specific' && selectedUsers.length === 0) {
    showAlert('Selecione pelo menos um usuário para distribuição específica.');
    return;
  }
  try {
    await req('PATCH', `/coupons/${couponId}/distribute`, { distributionType, userIds: selectedUsers });
    document.querySelector('.modal-overlay')?.remove();
    showAlert('Distribuição atualizada!', 'success');
    renderCoupons();
  } catch (err) {
    showAlert(err.message);
  }
};

const toggleCoupon = async (id) => {
  try {
    await req('PATCH', `/coupons/${id}/toggle`);
    showAlert('Status do cupom atualizado.', 'success');
    renderCoupons();
  } catch (err) {
    showAlert(err.message);
  }
};

// ── PAUSE TYPES ─────────────────────────────────────────────────────────

const renderPauseTypes = async () => {
  const c = document.getElementById('page-content');
  c.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  try {
    const data = await req('GET', '/pause-types');
    const types = data.pauseTypes || [];
    c.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:16px;">
        <button class="btn btn-primary" onclick="openNewPauseTypeModal()">+ Novo Tipo de Pausa</button>
      </div>
      <div class="section-card">
        <div class="section-header"><h2>Tipos de Pausa (${types.length})</h2></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Nome</th><th>Duração</th><th>Ordem</th><th>Status</th><th>Ação</th></tr></thead>
          <tbody>${types.length ? types.map(pt => `<tr>
            <td><strong>${escHtml(pt.name)}</strong></td>
            <td>${pt.durationMinutes} min</td>
            <td>${pt.order}</td>
            <td><span class="badge ${pt.isActive ? 'badge-approved' : 'badge-rejected'}">${pt.isActive ? 'Ativo' : 'Inativo'}</span></td>
            <td style="display:flex;gap:6px;">
              <button class="btn btn-ghost btn-sm" onclick="openEditPauseTypeModal(${JSON.stringify(JSON.stringify(pt))})">Editar</button>
              <button class="btn btn-danger btn-sm" onclick="deletePauseType('${pt._id}')">Excluir</button>
            </td>
          </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:#7A84A0;">Nenhum tipo de pausa cadastrado.</td></tr>'}</tbody>
        </table></div>
      </div>`;
  } catch (err) {
    c.innerHTML = `<div class="alert alert-error">⚠️ ${escHtml(err.message)}</div>`;
  }
};

const openNewPauseTypeModal = () => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">
    <div class="modal-header"><h3>➕ Novo Tipo de Pausa</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Nome</label><input id="npt-name" class="form-input" placeholder="Ex: Pausa Almoço" /></div>
      <div class="form-group"><label class="form-label">Duração (minutos)</label><input id="npt-duration" class="form-input" type="number" min="1" max="480" value="60" /></div>
      <div class="form-group"><label class="form-label">Ordem de exibição</label><input id="npt-order" class="form-input" type="number" value="0" /></div>
      <div class="form-group" style="display:flex;align-items:center;gap:8px;">
        <input id="npt-active" type="checkbox" checked />
        <label for="npt-active" class="form-label" style="margin:0;">Ativo</label>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
      <button class="btn btn-primary" onclick="createPauseType()">Criar</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
};

const createPauseType = async () => {
  const name = document.getElementById('npt-name').value.trim();
  const durationMinutes = Number(document.getElementById('npt-duration').value);
  const order = Number(document.getElementById('npt-order').value || 0);
  const isActive = !!document.getElementById('npt-active').checked;
  if (!name || !durationMinutes) { showAlert('Preencha nome e duração.'); return; }
  try {
    await req('POST', '/pause-types', { name, durationMinutes, order, isActive });
    document.querySelector('.modal-overlay')?.remove();
    showAlert('Tipo de pausa criado!', 'success');
    renderPauseTypes();
  } catch (err) { showAlert(err.message); }
};

const openEditPauseTypeModal = (ptJson) => {
  const pt = JSON.parse(ptJson);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">
    <div class="modal-header"><h3>✏️ Editar Tipo de Pausa</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Nome</label><input id="ept-name" class="form-input" value="${escHtml(pt.name)}" /></div>
      <div class="form-group"><label class="form-label">Duração (minutos)</label><input id="ept-duration" class="form-input" type="number" min="1" max="480" value="${pt.durationMinutes}" /></div>
      <div class="form-group"><label class="form-label">Ordem de exibição</label><input id="ept-order" class="form-input" type="number" value="${pt.order}" /></div>
      <div class="form-group" style="display:flex;align-items:center;gap:8px;">
        <input id="ept-active" type="checkbox" ${pt.isActive ? 'checked' : ''} />
        <label for="ept-active" class="form-label" style="margin:0;">Ativo</label>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
      <button class="btn btn-primary" onclick="savePauseType('${pt._id}')">Salvar</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
};

const savePauseType = async (id) => {
  const name = document.getElementById('ept-name').value.trim();
  const durationMinutes = Number(document.getElementById('ept-duration').value);
  const order = Number(document.getElementById('ept-order').value || 0);
  const isActive = !!document.getElementById('ept-active').checked;
  if (!name || !durationMinutes) { showAlert('Preencha nome e duração.'); return; }
  try {
    await req('PATCH', `/pause-types/${id}`, { name, durationMinutes, order, isActive });
    document.querySelector('.modal-overlay')?.remove();
    showAlert('Tipo de pausa atualizado!', 'success');
    renderPauseTypes();
  } catch (err) { showAlert(err.message); }
};

const deletePauseType = async (id) => {
  if (!confirm('Excluir este tipo de pausa?')) return;
  try {
    await req('DELETE', `/pause-types/${id}`);
    showAlert('Excluído.', 'success');
    renderPauseTypes();
  } catch (err) { showAlert(err.message); }
};

// ── ADMINS ─────────────────────────────────────────────────────────
const adminPermissionLabel = (key) => {
  const found = permissionCatalog.find((p) => p.key === key);
  return found?.label || key;
};

const rolePresetPermissions = (role) => {
  if (role === 'super_admin') return [];
  return permissionRolePresets?.[role] || [];
};

const renderPermissionChecks = (selected = []) => {
  const set = new Set(selected || []);
  return permissionCatalog.map((perm) => `
    <label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;color:#B0B8D0;">
      <input type="checkbox" class="perm-check" value="${perm.key}" ${set.has(perm.key) ? 'checked' : ''} />
      <span>${escHtml(perm.label)}</span>
    </label>
  `).join('');
};

const readSelectedPermissions = () => Array.from(document.querySelectorAll('.perm-check:checked')).map((el) => el.value);

const setPermissionChecks = (permissionKeys = []) => {
  const set = new Set(permissionKeys || []);
  document.querySelectorAll('.perm-check').forEach((el) => {
    el.checked = set.has(el.value);
  });
};

const applyRolePresetChecks = (roleSelectId, lockRole = false) => {
  const role = document.getElementById(roleSelectId)?.value || 'support';
  const preset = rolePresetPermissions(role);
  setPermissionChecks(preset);
  const isSuper = role === 'super_admin';
  document.querySelectorAll('.perm-check').forEach((el) => {
    el.disabled = isSuper || lockRole;
  });
};

const supportSupervisorsOptionsHtml = (selectedId = '') => {
  const admins = Object.values(window.__adminsById || {});
  const supervisors = admins.filter((a) => a.role === 'support' && a.supportRole === 'supervisor' && a.isActive);
  const options = supervisors.map((s) => `<option value="${s._id}" ${String(selectedId || '') === String(s._id) ? 'selected' : ''}>${escHtml(s.name)} (${escHtml(s.email)})</option>`).join('');
  return `<option value="">Selecione um supervisor</option>${options}`;
};

const toggleSupportFieldsVisibility = (roleSelectId, supportRoleSelectId, supervisorWrapperId) => {
  const role = document.getElementById(roleSelectId)?.value;
  const supportRole = document.getElementById(supportRoleSelectId)?.value;
  const wrapper = document.getElementById(supervisorWrapperId);
  const supportRoleWrap = document.getElementById(`${supportRoleSelectId}-wrap`);

  if (supportRoleWrap) supportRoleWrap.style.display = role === 'support' ? 'block' : 'none';
  if (wrapper) {
    wrapper.style.display = role === 'support' && supportRole === 'operator' ? 'block' : 'none';
  }
};

const renderAdmins = async () => {
  const c = document.getElementById('page-content');
  c.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  try {
    const [admins, permsData] = await Promise.all([
      req('GET', '/admins'),
      req('GET', '/access/permissions'),
    ]);
    permissionCatalog = permsData.permissions || [];
    permissionRolePresets = permsData.rolePresets || {};
    window.__adminsById = Object.fromEntries((admins || []).map((a) => [a._id, a]));
    c.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:16px;">
        <button class="btn btn-primary" onclick="openNewAdminModal()">+ Novo Admin</button>
      </div>
      <div class="section-card">
        <div class="section-header"><h2>Equipe Administrativa (${admins.length})</h2></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Acessos</th><th>Status</th><th>Criado em</th><th>Ação</th></tr></thead>
          <tbody>${admins.map(a => `<tr>
            <td><div style="display:flex;align-items:center;gap:8px;"><div class="avatar-sm">${a.name[0]}</div><strong>${escHtml(a.name)}</strong></div></td>
            <td>${escHtml(a.email)}</td>
            <td><span class="badge ${a.role==='super_admin'?'badge-approved':a.role==='admin'?'badge-pending':'badge-docs'}">${a.role}${a.role==='support' ? `/${a.supportRole || 'operator'}` : ''}</span></td>
            <td style="max-width:260px;font-size:12px;color:#7A84A0;">${(a.effectivePermissions || a.permissions || []).includes('*') ? 'Acesso total' : (a.effectivePermissions || a.permissions || []).map(adminPermissionLabel).join(', ') || 'Sem permissões'}</td>
            <td><span class="badge ${a.isActive?'badge-approved':'badge-rejected'}">${a.isActive?'Ativo':'Inativo'}</span></td>
            <td>${fmtDate(a.createdAt)}</td>
            <td style="display:flex;gap:6px;flex-wrap:wrap;">
              <button class="btn btn-ghost btn-sm" onclick="openEditAdminAccessModalById('${a._id}')">Acessos</button>
              ${a._id !== adminData?.id ? `<button class="btn btn-danger btn-sm" onclick="deleteAdmin('${a._id}')">Remover</button>` : '<span style="color:#3D4460;font-size:12px;">Você</span>'}
            </td>
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
        <select id="na-role" class="form-select" onchange="applyRolePresetChecks('na-role');toggleSupportFieldsVisibility('na-role','na-support-role','na-supervisor-wrap')">
          <option value="support">Suporte</option>
          <option value="admin">Admin</option>
          <option value="super_admin">Super Admin</option>
        </select>
      </div>
      <div class="form-group" id="na-support-role-wrap"><label class="form-label">Tipo de usuário de suporte</label>
        <select id="na-support-role" class="form-select" onchange="toggleSupportFieldsVisibility('na-role','na-support-role','na-supervisor-wrap')">
          <option value="operator" selected>Operador</option>
          <option value="supervisor">Supervisor</option>
        </select>
      </div>
      <div class="form-group" id="na-supervisor-wrap"><label class="form-label">Supervisor responsável</label>
        <select id="na-support-supervisor" class="form-select">${supportSupervisorsOptionsHtml('')}</select>
      </div>
      <div class="form-group" style="display:flex;align-items:center;gap:8px;">
        <input id="na-apply-preset" type="checkbox" checked />
        <label for="na-apply-preset" class="form-label" style="margin:0;">Aplicar preset do perfil automaticamente</label>
      </div>
      <div class="form-group">
        <label class="form-label">Permissões</label>
        <div style="max-height:180px;overflow:auto;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px;">${renderPermissionChecks()}</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
      <button class="btn btn-primary" onclick="createAdmin()">Criar Membro</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  applyRolePresetChecks('na-role');
  toggleSupportFieldsVisibility('na-role', 'na-support-role', 'na-supervisor-wrap');
};

const createAdmin = async () => {
  const name = document.getElementById('na-name').value.trim();
  const email = document.getElementById('na-email').value.trim();
  const password = document.getElementById('na-pass').value;
  const role = document.getElementById('na-role').value;
  const permissions = readSelectedPermissions();
  const applyRolePreset = !!document.getElementById('na-apply-preset')?.checked;
  const supportRole = document.getElementById('na-support-role')?.value || 'operator';
  const supportSupervisor = document.getElementById('na-support-supervisor')?.value || '';
  if (!name || !email || !password) { alert('Preencha todos os campos.'); return; }
  if (role === 'support' && supportRole === 'operator' && !supportSupervisor) {
    alert('Para operador é obrigatório selecionar um supervisor.');
    return;
  }
  try {
    await req('POST', '/admins', {
      name,
      email,
      password,
      role,
      permissions,
      applyRolePreset,
      supportRole,
      supportSupervisor: supportSupervisor || null,
    });
    document.querySelector('.modal-overlay')?.remove();
    showAlert('Membro criado com sucesso!', 'success');
    renderAdmins();
  } catch (err) { showAlert(err.message); }
};

const openEditAdminAccessModal = (admin) => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const selected = admin.permissions || [];
  overlay.innerHTML = `<div class="modal" style="max-width:620px;">
    <div class="modal-header"><h3>🛡️ Acessos de ${escHtml(admin.name)}</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Perfil</label>
        <select id="ea-role" class="form-select" onchange="applyRolePresetChecks('ea-role');toggleSupportFieldsVisibility('ea-role','ea-support-role','ea-supervisor-wrap')">
          <option value="support" ${admin.role === 'support' ? 'selected' : ''}>Suporte</option>
          <option value="admin" ${admin.role === 'admin' ? 'selected' : ''}>Admin</option>
          <option value="super_admin" ${admin.role === 'super_admin' ? 'selected' : ''}>Super Admin</option>
        </select>
      </div>
      <div class="form-group" style="display:flex;align-items:center;gap:8px;">
        <input id="ea-active" type="checkbox" ${admin.isActive ? 'checked' : ''} />
        <label for="ea-active" class="form-label" style="margin:0;">Usuário ativo</label>
      </div>
      <div class="form-group" id="ea-support-role-wrap"><label class="form-label">Tipo de usuário de suporte</label>
        <select id="ea-support-role" class="form-select" onchange="toggleSupportFieldsVisibility('ea-role','ea-support-role','ea-supervisor-wrap')">
          <option value="operator" ${admin.supportRole === 'operator' ? 'selected' : ''}>Operador</option>
          <option value="supervisor" ${admin.supportRole === 'supervisor' ? 'selected' : ''}>Supervisor</option>
        </select>
      </div>
      <div class="form-group" id="ea-supervisor-wrap"><label class="form-label">Supervisor responsável</label>
        <select id="ea-support-supervisor" class="form-select">${supportSupervisorsOptionsHtml(admin.supportSupervisor || '')}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Permissões</label>
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
          <button class="btn btn-ghost btn-sm" onclick="applyRolePresetChecks('ea-role')">Aplicar preset</button>
        </div>
        <div style="max-height:220px;overflow:auto;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px;">${renderPermissionChecks(selected)}</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveAdminAccess('${admin._id}')">Salvar acessos</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  applyRolePresetChecks('ea-role', admin.role === 'super_admin');
  toggleSupportFieldsVisibility('ea-role', 'ea-support-role', 'ea-supervisor-wrap');
};

const openEditAdminAccessModalById = (id) => {
  const admin = window.__adminsById?.[id];
  if (!admin) {
    showAlert('Admin não encontrado para edição');
    return;
  }
  openEditAdminAccessModal(admin);
};

const saveAdminAccess = async (id) => {
  const role = document.getElementById('ea-role').value;
  const isActive = !!document.getElementById('ea-active').checked;
  const permissions = readSelectedPermissions();
  const supportRole = document.getElementById('ea-support-role')?.value || 'operator';
  const supportSupervisor = document.getElementById('ea-support-supervisor')?.value || '';
  if (role === 'support' && supportRole === 'operator' && !supportSupervisor) {
    showAlert('Operador deve ter supervisor vinculado.');
    return;
  }
  try {
    await req('PATCH', `/admins/${id}/access`, {
      role,
      isActive,
      permissions,
      supportRole,
      supportSupervisor: supportSupervisor || null,
    });
    document.querySelector('.modal-overlay')?.remove();
    showAlert('Acessos atualizados com sucesso!', 'success');
    renderAdmins();
  } catch (err) {
    showAlert(err.message);
  }
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

// ── PAGAMENTOS / STRIPE ────────────────────────────────────────────
const renderPayments = async () => {
  const c = document.getElementById('page-content');
  c.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  try {
    const [data, coraWebhookData] = await Promise.all([
      req('GET', '/stripe-config'),
      paymentReq('GET', '/cora/webhook/endpoints').catch(() => null),
    ]);
    const isProd = data.mode === 'production';
    const canSwitchToProd = data.hasProdKeys;
    const isSuperAdmin = adminData?.role === 'super_admin';
    const webhookUrl = coraWebhookData?.webhookUrl || '';
    const suggestedEvents = coraWebhookData?.suggestedEvents || [];

    c.innerHTML = `
      ${isProd ? `
      <div style="background:#b71c1c;color:#fff;border-radius:12px;padding:16px 24px;margin-bottom:24px;display:flex;align-items:center;gap:12px;font-weight:600;font-size:15px;">
        <span style="font-size:24px;">⚠️</span>
        MODO PRODUÇÃO ATIVO — Transações reais serão cobradas dos clientes!
      </div>` : ''}

      <div class="card" style="max-width:580px;">
        <h3 style="margin:0 0 6px;font-size:18px;color:#1A1A2E;">Modo de Pagamento Stripe</h3>
        <p style="color:#666;margin:0 0 24px;font-size:14px;">
          Controla qual par de chaves é usado para processar pagamentos.
          Somente super_admin pode alterar este modo.
        </p>

        <div style="display:flex;gap:16px;margin-bottom:24px;">
          <div onclick="${isSuperAdmin ? "setStripeMode('test')" : ''}"
               style="flex:1;border:2px solid ${!isProd?'#FF6B00':'#e0e0e0'};border-radius:12px;padding:20px;cursor:${isSuperAdmin?'pointer':'default'};background:${!isProd?'#fff8f4':'#fafafa'};transition:all .2s;">
            <div style="font-size:28px;margin-bottom:8px;">🧪</div>
            <div style="font-weight:700;font-size:16px;color:${!isProd?'#FF6B00':'#888'};">TESTE</div>
            <div style="font-size:12px;color:#999;margin-top:4px;">Chaves sk_test / pk_test</div>
            <div style="font-size:12px;color:#999;">Nenhuma cobrança real</div>
            ${!isProd ? `<div style="margin-top:10px;display:inline-block;background:#FF6B00;color:#fff;border-radius:20px;padding:3px 12px;font-size:12px;font-weight:600;">● ATIVO</div>` : ''}
            <div style="margin-top:8px;font-size:12px;color:${data.hasTestKeys?'#2e7d32':'#c62828'};">${data.hasTestKeys?'✓ Chaves configuradas':'✗ Chaves não encontradas'}</div>
          </div>

          <div onclick="${isSuperAdmin && canSwitchToProd ? "setStripeMode('production')" : ''}"
               style="flex:1;border:2px solid ${isProd?'#b71c1c':'#e0e0e0'};border-radius:12px;padding:20px;cursor:${isSuperAdmin && canSwitchToProd?'pointer':'default'};background:${isProd?'#fff8f8':'#fafafa'};transition:all .2s;${!canSwitchToProd?'opacity:0.5;':''}" >
            <div style="font-size:28px;margin-bottom:8px;">🚀</div>
            <div style="font-weight:700;font-size:16px;color:${isProd?'#b71c1c':'#888'};">PRODUÇÃO</div>
            <div style="font-size:12px;color:#999;margin-top:4px;">Chaves sk_live / pk_live</div>
            <div style="font-size:12px;color:#999;">Cobranças reais</div>
            ${isProd ? `<div style="margin-top:10px;display:inline-block;background:#b71c1c;color:#fff;border-radius:20px;padding:3px 12px;font-size:12px;font-weight:600;">● ATIVO</div>` : ''}
            <div style="margin-top:8px;font-size:12px;color:${data.hasProdKeys?'#2e7d32':'#c62828'};">${data.hasProdKeys?'✓ Chaves configuradas':'✗ Chaves não encontradas no servidor'}</div>
          </div>
        </div>

        ${!isSuperAdmin ? `<div style="background:#fff3e0;border:1px solid #FF6B00;border-radius:8px;padding:12px 16px;font-size:13px;color:#e65100;">
          🔒 Apenas super_admin pode alterar o modo de pagamento.
        </div>` : ''}

        ${data.updatedBy ? `
        <div style="margin-top:16px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;padding-top:12px;">
          Última alteração por <strong>${escHtml(data.updatedBy)}</strong>
          ${data.updatedAt ? ' em ' + new Date(data.updatedAt).toLocaleString('pt-BR') : ''}
        </div>` : ''}
      </div>

      <div class="card" style="max-width:580px;margin-top:20px;background:#f9f9fb;">
        <h4 style="margin:0 0 10px;font-size:15px;color:#1A1A2E;">📋 Como configurar as chaves de produção</h4>
        <ol style="margin:0;padding-left:20px;color:#555;font-size:13px;line-height:1.8;">
          <li>Acesse o <strong>Render Dashboard</strong> → Serviço backend → <em>Environment</em></li>
          <li>Adicione as variáveis:<br>
            <code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;">STRIPE_SECRET_KEY_PROD</code> = sk_live_...<br>
            <code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;">STRIPE_PUBLISHABLE_KEY_PROD</code> = pk_live_...
          </li>
          <li>Salve e aguarde o redeploy automático</li>
          <li>Volte aqui e ative o modo <strong>PRODUÇÃO</strong></li>
        </ol>
      </div>

      <div class="card" style="max-width:760px;margin-top:20px;">
        <h3 style="margin:0 0 6px;font-size:18px;color:#1A1A2E;">🔔 Webhook Cora PIX</h3>
        <p style="color:#666;margin:0 0 16px;font-size:14px;">
          Use esta URL no Cora Web para receber eventos de pagamento PIX e liberar o pedido automaticamente no app.
        </p>

        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">URL webhook</label>
          <input id="cora-webhook-url" class="form-input" value="${escHtml(webhookUrl)}" readonly />
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
          <button class="btn btn-primary" onclick="copyCoraWebhookUrl()">Copiar URL webhook</button>
          <button id="btn-register-cora-webhook" class="btn btn-ghost" onclick="registerCoraInvoicePaidWebhook()">Registrar endpoint invoice.paid</button>
        </div>

        <div style="font-size:12px;color:#666;line-height:1.7;">
          <strong>Eventos sugeridos:</strong>
          ${suggestedEvents.length
    ? suggestedEvents.map((e) => `<code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;margin-right:6px;">${escHtml(`${e.resource}.${e.trigger}`)}</code>`).join('')
    : '<code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;">invoice.paid</code>'}
        </div>
      </div>
    `;
  } catch (err) {
    c.innerHTML = `<div class="card"><p style="color:#c62828;">Erro ao carregar configuração Stripe: ${escHtml(err.message)}</p></div>`;
  }
};

const renderWithdrawalsQueue = async () => {
  const c = document.getElementById('page-content');
  c.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;

  try {
    const withdrawalParams = new URLSearchParams();
    Object.entries(withdrawalQueueState).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') return;
      withdrawalParams.set(key, String(value));
    });

    const withdrawalsData = await req('GET', `/withdrawals?${withdrawalParams.toString()}`);
    const withdrawals = withdrawalsData.withdrawals || [];
    const counters = withdrawalsData.counters || {};
    const totalItems = withdrawalsData.total || 0;
    const currentPageNum = withdrawalsData.page || 1;
    const totalPages = withdrawalsData.pages || 1;

    withdrawalQueueState.page = currentPageNum;

    const withdrawalRows = withdrawals.length
      ? withdrawals.map((w) => `
        <tr>
          <td>
            <strong>${escHtml(w.professional?.name || 'Profissional')}</strong>
            <div style="font-size:12px;color:#7A84A0;margin-top:2px;">${escHtml(w.professional?.email || '')}</div>
          </td>
          <td>${fmtMoney(w.amount || 0)}</td>
          <td>${fmtCPF(w.pixKeyCpfSnapshot)}</td>
          <td>${fmtDatetime(w.requestedAt)}</td>
          <td>${withdrawalStatusBadge(w.status)}</td>
          <td>
            ${w.transferProofUrl
    ? `<a href="${escHtml(w.transferProofUrl)}" target="_blank" style="font-size:12px;color:#9DC4FF;text-decoration:none;">Ver comprovante</a>`
    : '<span style="font-size:12px;color:#7A84A0;">Sem comprovante</span>'}
          </td>
          <td class="td-actions">
            ${(w.status === 'pending' || w.status === 'processing')
    ? `<button class="btn btn-ghost btn-sm" onclick="setWithdrawalStatus('${w._id}','processing')">Processar</button>
               <button class="btn btn-primary btn-sm" onclick="setWithdrawalStatus('${w._id}','completed')">Concluir</button>
               <button class="btn btn-danger btn-sm" onclick="setWithdrawalStatus('${w._id}','cancelled')">Cancelar</button>`
    : '<span style="font-size:12px;color:#7A84A0;">Finalizado</span>'}
            <label class="btn btn-ghost btn-sm" style="cursor:pointer;">
              📎 Comprovante
              <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" style="display:none;" onchange="uploadWithdrawalProof('${w._id}', this)" />
            </label>
          </td>
        </tr>
      `).join('')
      : `<tr><td colspan="7" style="text-align:center;color:#7A84A0;">Nenhuma solicitação de saque encontrada.</td></tr>`;

    const queuePagination = renderPagination(currentPageNum, totalPages, 'changeWithdrawalsPage');

    c.innerHTML = `
      <div class="section-card" style="margin-top:0;">
        <div class="section-header">
          <h2>🏦 Fila de Saques PIX (manual)</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <span class="badge badge-pending">Pendentes: ${counters.pending || 0}</span>
            <span class="badge badge-docs">Processando: ${counters.processing || 0}</span>
            <span class="badge badge-approved">Concluídos: ${counters.completed || 0}</span>
            <span class="badge badge-rejected">Cancelados: ${counters.cancelled || 0}</span>
          </div>
        </div>
        <div style="padding:0 22px 14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Status</label>
            <select id="wd-filter-status" class="form-select" onchange="applyWithdrawalFilters()">
              <option value="all" ${withdrawalQueueState.status === 'all' ? 'selected' : ''}>Todos</option>
              <option value="pending" ${withdrawalQueueState.status === 'pending' ? 'selected' : ''}>Pendentes</option>
              <option value="processing" ${withdrawalQueueState.status === 'processing' ? 'selected' : ''}>Processando</option>
              <option value="completed" ${withdrawalQueueState.status === 'completed' ? 'selected' : ''}>Concluídos</option>
              <option value="cancelled" ${withdrawalQueueState.status === 'cancelled' ? 'selected' : ''}>Cancelados</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Buscar (nome/e-mail/CPF)</label>
            <input id="wd-filter-search" class="form-input" value="${escHtml(withdrawalQueueState.search)}" placeholder="Ex: Maria ou 123.456..." />
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">De</label>
            <input id="wd-filter-from" type="date" class="form-input" value="${escHtml(withdrawalQueueState.from)}" />
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Até</label>
            <input id="wd-filter-to" type="date" class="form-input" value="${escHtml(withdrawalQueueState.to)}" />
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Valor mínimo (R$)</label>
            <input id="wd-filter-min" type="number" min="0" step="0.01" class="form-input" value="${escHtml(withdrawalQueueState.minAmount)}" />
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Valor máximo (R$)</label>
            <input id="wd-filter-max" type="number" min="0" step="0.01" class="form-input" value="${escHtml(withdrawalQueueState.maxAmount)}" />
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Itens por página</label>
            <select id="wd-filter-limit" class="form-select" onchange="applyWithdrawalFilters()">
              <option value="10" ${String(withdrawalQueueState.limit) === '10' ? 'selected' : ''}>10</option>
              <option value="20" ${String(withdrawalQueueState.limit) === '20' ? 'selected' : ''}>20</option>
              <option value="50" ${String(withdrawalQueueState.limit) === '50' ? 'selected' : ''}>50</option>
            </select>
          </div>
          <div style="display:flex;align-items:flex-end;gap:8px;">
            <button class="btn btn-primary" onclick="applyWithdrawalFilters()">Filtrar</button>
            <button class="btn btn-ghost" onclick="clearWithdrawalFilters()">Limpar</button>
          </div>
        </div>
        <div style="padding:0 22px 16px;color:#7A84A0;font-size:12px;">
          Ordem fixa da fila: mais antigo para mais novo (horário da solicitação). O valor é debitado da carteira no momento da solicitação. Comprovante anexado aqui é interno e não é exibido ao profissional.
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Profissional</th>
                <th>Valor</th>
                <th>CPF (chave PIX)</th>
                <th>Solicitado em</th>
                <th>Status</th>
                <th>Comprovante</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>${withdrawalRows}</tbody>
          </table>
        </div>
        <div style="padding:12px 22px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
          <div style="font-size:12px;color:#7A84A0;">${totalItems} item(ns) · página ${currentPageNum} de ${totalPages}</div>
          <div class="pagination">${queuePagination}</div>
        </div>
      </div>
    `;
  } catch (err) {
    c.innerHTML = `<div class="card"><p style="color:#c62828;">Erro ao carregar fila de saques: ${escHtml(err.message)}</p></div>`;
  }
};

window.setStripeMode = async (mode) => {
  const modeLabel = mode === 'production' ? 'PRODUÇÃO' : 'TESTE';
  const isProd = mode === 'production';
  const confirmed = confirm(
    isProd
      ? `⚠️ ATENÇÃO!\n\nVocê está prestes a ativar o modo PRODUÇÃO.\n\nIsso significa que os clientes serão cobrados com cartão/PIX real.\n\nTem certeza?`
      : `Deseja voltar para o modo TESTE?\n\nPagamentos deixarão de ser reais.`
  );
  if (!confirmed) return;
  try {
    await req('PATCH', '/stripe-config', { mode });
    alert('Modo alterado para ' + modeLabel + ' com sucesso!');
    renderPayments();
  } catch (err) {
    alert('Erro ao alterar modo: ' + (err.message || 'Tente novamente'));
  }
};

window.copyCoraWebhookUrl = async () => {
  const input = document.getElementById('cora-webhook-url');
  const value = input?.value?.trim();
  if (!value) {
    showAlert('URL de webhook ainda não disponível.');
    return;
  }

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      input.removeAttribute('readonly');
      input.select();
      document.execCommand('copy');
      input.setAttribute('readonly', 'readonly');
    }
    showAlert('URL de webhook copiada com sucesso.', 'success');
  } catch {
    showAlert('Não foi possível copiar automaticamente.');
  }
};

window.registerCoraInvoicePaidWebhook = async () => {
  const input = document.getElementById('cora-webhook-url');
  const button = document.getElementById('btn-register-cora-webhook');
  const url = input?.value?.trim();

  if (!url) {
    showAlert('URL webhook inválida.');
    return;
  }

  if (button) button.disabled = true;
  try {
    const response = await paymentReq('POST', '/cora/webhook/register', {
      url,
      resource: 'invoice',
      trigger: 'paid',
    });
    const endpointId = response?.endpoint?.id;
    showAlert(endpointId ? `Endpoint registrado na Cora (id ${endpointId}).` : 'Endpoint invoice.paid registrado na Cora.', 'success');
    renderPayments();
  } catch (err) {
    showAlert(err.message || 'Erro ao registrar endpoint na Cora.');
  } finally {
    if (button) button.disabled = false;
  }
};

window.applyWithdrawalFilters = () => {
  const statusEl = document.getElementById('wd-filter-status');
  const searchEl = document.getElementById('wd-filter-search');
  const fromEl = document.getElementById('wd-filter-from');
  const toEl = document.getElementById('wd-filter-to');
  const minEl = document.getElementById('wd-filter-min');
  const maxEl = document.getElementById('wd-filter-max');
  const limitEl = document.getElementById('wd-filter-limit');

  withdrawalQueueState = {
    ...withdrawalQueueState,
    status: statusEl ? statusEl.value : 'all',
    search: searchEl ? searchEl.value.trim() : '',
    from: fromEl ? fromEl.value : '',
    to: toEl ? toEl.value : '',
    minAmount: minEl ? minEl.value : '',
    maxAmount: maxEl ? maxEl.value : '',
    limit: limitEl ? parseInt(limitEl.value, 10) || 20 : 20,
    page: 1,
  };

  renderWithdrawalsQueue();
};

window.clearWithdrawalFilters = () => {
  withdrawalQueueState = {
    status: 'all',
    search: '',
    from: '',
    to: '',
    minAmount: '',
    maxAmount: '',
    page: 1,
    limit: 20,
  };
  renderWithdrawalsQueue();
};

window.changeWithdrawalsPage = (page) => {
  withdrawalQueueState = {
    ...withdrawalQueueState,
    page: Math.max(1, parseInt(page, 10) || 1),
  };
  renderWithdrawalsQueue();
};

window.setWithdrawalStatus = async (id, status) => {
  const labelMap = {
    processing: 'marcar como em processamento',
    completed: 'marcar como concluído',
    cancelled: 'cancelar e estornar saldo',
  };
  const confirmed = confirm(`Deseja ${labelMap[status] || 'atualizar este saque'}?`);
  if (!confirmed) return;
  const internalNote = prompt('Observação interna (opcional):', '') || '';
  try {
    await req('PATCH', `/withdrawals/${id}/status`, { status, internalNote });
    showAlert('Status do saque atualizado.', 'success');
    renderWithdrawalsQueue();
  } catch (err) {
    showAlert(err.message);
  }
};

window.uploadWithdrawalProof = async (id, inputEl) => {
  const file = inputEl?.files?.[0];
  if (!file) return;
  try {
    const fd = new FormData();
    fd.append('proof', file);
    await multipartReq('POST', `/withdrawals/${id}/proof`, fd);
    showAlert('Comprovante anexado.', 'success');
    renderWithdrawalsQueue();
  } catch (err) {
    showAlert(err.message);
  }
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
        ${types.length ? types.map(t => renderServiceTypeCard(t)).join('') : '<p style="color:#5C6B7A;">Nenhum profissão cadastrada. Use o botão acima ou <b>Inicializar seed</b> no dashboard.</p>'}
      </div>`;
  } catch (err) {
    c.innerHTML = `<div class="alert alert-error">⚠️ ${escHtml(err.message)}</div>`;
  }
};

const renderServiceTypeCard = (t) => `
  <div class="service-type-card" id="stc-${t._id}">
    <div class="service-type-icon">${t.imageUrl ? `<img src="${escHtml(t.imageUrl)}" alt="${escHtml(t.name)}" class="service-type-icon-img" />` : (t.icon || '🔧')}</div>
    <div class="service-type-info">
      <div class="service-type-name">${escHtml(t.name)}</div>
      <div class="service-type-desc">${escHtml(t.description || '')}</div>
      <div style="font-size:12px;color:#7A84A0;margin-top:4px;">Campos customizados: ${(Array.isArray(t.checkoutFields) ? t.checkoutFields.length : 0)}</div>
      <div style="font-size:12px;color:#7A84A0;margin-top:4px;">Faixa de horas: ${Number.isFinite(Number(t.minHours)) ? Number(t.minHours) : 2}h - ${Number.isFinite(Number(t.maxHours)) ? Number(t.maxHours) : 12}h</div>
      <div style="font-size:12px;color:#7A84A0;margin-top:2px;">Opções: ${Array.isArray(t.hoursOptions) && t.hoursOptions.length ? t.hoursOptions.join(', ') : '2, 3, 4, 5, 6, 8'}h</div>
      <div style="font-size:12px;color:#7A84A0;margin-top:2px;">Valor/min: ${Number.isFinite(Number(t.pricePerMinute)) && Number(t.pricePerMinute) > 0 ? `R$ ${Number(t.pricePerMinute).toFixed(2)}` : 'padrão global'} · Taxa plataforma: ${Number.isFinite(Number(t.platformFeePercent)) ? `${Number(t.platformFeePercent)}%` : 'padrão global'}</div>
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

const buildOptionsString = (options) => {
  if (!Array.isArray(options) || !options.length) return '';
  return options
    .map((opt) => {
      const label = String(opt.label || '').trim();
      const value = String(opt.value || '').trim();
      const impact = Number(opt.priceImpact || 0);
      if (!label || !value) return null;
      return `${label}:${value}:${impact}`;
    })
    .filter(Boolean)
    .join(', ');
};

const buildCheckoutFieldRows = (fields = []) => {
  if (!Array.isArray(fields) || !fields.length) {
    return `<div class="stf-empty" style="font-size:12px;color:#7A84A0;">Nenhum campo adicional. Clique em "Adicionar campo".</div>`;
  }

  return fields
    .map((field, idx) => `
      <div class="stf-row" style="border:1px solid #E8EAF0;border-radius:12px;padding:10px;margin-bottom:8px;background:#FAFBFF;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <input class="form-input stf-key" placeholder="chave (ex: dogs_count)" value="${escHtml(field.key || '')}" />
          <input class="form-input stf-label" placeholder="rótulo (ex: Quantos cães?)" value="${escHtml(field.label || '')}" />
          <select class="form-select stf-type">
            <option value="number" ${(field.inputType || '') === 'number' ? 'selected' : ''}>Número</option>
            <option value="boolean" ${(field.inputType || '') === 'boolean' ? 'selected' : ''}>Sim/Não</option>
            <option value="text" ${(field.inputType || '') === 'text' ? 'selected' : ''}>Texto</option>
            <option value="select" ${(field.inputType || '') === 'select' ? 'selected' : ''}>Seleção</option>
          </select>
          <input class="form-input stf-placeholder" placeholder="placeholder" value="${escHtml(field.placeholder || '')}" />
          <input class="form-input stf-default" placeholder="valor padrão" value="${escHtml(field.defaultValue ?? '')}" />
          <input class="form-input stf-min" type="number" placeholder="mín" value="${field.min ?? ''}" />
          <input class="form-input stf-max" type="number" placeholder="máx" value="${field.max ?? ''}" />
          <input class="form-input stf-step" type="number" placeholder="passo" value="${field.step ?? 1}" />
          <input class="form-input stf-order" type="number" placeholder="ordem" value="${field.sortOrder ?? idx}" />
          <input class="form-input stf-options" style="grid-column:1 / span 2" placeholder="opções select: label:valor:impacto, label2:valor2:impacto" value="${escHtml(buildOptionsString(field.options))}" />
        </div>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:8px;">
          <label style="display:flex;gap:6px;align-items:center;font-size:12px;"><input type="checkbox" class="stf-required" ${field.required ? 'checked' : ''}/> Obrigatório</label>
          <label style="display:flex;gap:6px;align-items:center;font-size:12px;"><input type="checkbox" class="stf-pricing-enabled" ${field.pricingEnabled ? 'checked' : ''}/> Afeta preço</label>
          <select class="form-select stf-pricing-mode" style="max-width:170px;">
            <option value="add_total" ${(field.pricingMode || 'add_total') === 'add_total' ? 'selected' : ''}>Soma no total</option>
            <option value="add_per_hour" ${(field.pricingMode || '') === 'add_per_hour' ? 'selected' : ''}>Soma por hora</option>
          </select>
          <input class="form-input stf-pricing-amount" type="number" step="0.01" placeholder="valor impacto" style="max-width:140px;" value="${Number(field.pricingAmount || 0)}" />
          <button class="btn btn-ghost btn-sm" type="button" onclick="this.closest('.stf-row').remove();refreshCheckoutFieldEmptyState()">Remover</button>
        </div>
      </div>`)
    .join('');
};

const refreshCheckoutFieldEmptyState = () => {
  document.querySelectorAll('.stf-fields-list').forEach((listEl) => {
    const hasRows = listEl.querySelector('.stf-row');
    const empty = listEl.querySelector('.stf-empty');
    if (hasRows && empty) empty.remove();
    if (!hasRows && !empty) {
      const div = document.createElement('div');
      div.className = 'stf-empty';
      div.style.cssText = 'font-size:12px;color:#7A84A0;';
      div.textContent = 'Nenhum campo adicional. Clique em "Adicionar campo".';
      listEl.appendChild(div);
    }
  });
};

const addCheckoutFieldRow = (listId) => {
  const listEl = document.getElementById(listId);
  if (!listEl) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildCheckoutFieldRows([{ inputType: 'number', step: 1, pricingMode: 'add_total', pricingAmount: 0 }]);
  const row = wrapper.querySelector('.stf-row');
  if (!row) return;
  listEl.appendChild(row);
  refreshCheckoutFieldEmptyState();
};

const slugifyFieldKey = (raw) => String(raw || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

const parseOptionsInput = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return [];

  return text
    .split(',')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const parts = chunk.split(':').map((p) => p.trim());
      const label = parts[0] || '';
      const value = parts[1] || slugifyFieldKey(label);
      const priceImpact = Number(parts[2] || 0);
      return { label, value, priceImpact: Number.isFinite(priceImpact) ? priceImpact : 0 };
    })
    .filter((opt) => opt.label && opt.value);
};

const collectCheckoutFields = (listId) => {
  const listEl = document.getElementById(listId);
  if (!listEl) return [];
  const rows = Array.from(listEl.querySelectorAll('.stf-row'));
  const fields = [];

  rows.forEach((row, idx) => {
    const keyRaw = row.querySelector('.stf-key')?.value || '';
    const key = slugifyFieldKey(keyRaw);
    const label = (row.querySelector('.stf-label')?.value || '').trim();
    const inputType = row.querySelector('.stf-type')?.value || 'text';
    const required = !!row.querySelector('.stf-required')?.checked;
    const placeholder = (row.querySelector('.stf-placeholder')?.value || '').trim();
    const defaultRaw = (row.querySelector('.stf-default')?.value || '').trim();
    const minRaw = (row.querySelector('.stf-min')?.value || '').trim();
    const maxRaw = (row.querySelector('.stf-max')?.value || '').trim();
    const stepRaw = (row.querySelector('.stf-step')?.value || '').trim();
    const sortOrderRaw = (row.querySelector('.stf-order')?.value || '').trim();
    const optionsRaw = (row.querySelector('.stf-options')?.value || '').trim();
    const pricingEnabled = !!row.querySelector('.stf-pricing-enabled')?.checked;
    const pricingMode = row.querySelector('.stf-pricing-mode')?.value || 'add_total';
    const pricingAmountRaw = (row.querySelector('.stf-pricing-amount')?.value || '').trim();

    if (!key && !label) return;
    if (!key || !label) throw new Error('Cada campo customizado precisa de chave e rótulo.');

    let defaultValue = defaultRaw;
    if (inputType === 'number') {
      defaultValue = defaultRaw === '' ? null : Number(defaultRaw);
      if (defaultRaw !== '' && !Number.isFinite(defaultValue)) {
        throw new Error(`Valor padrão inválido no campo ${label}`);
      }
    } else if (inputType === 'boolean') {
      defaultValue = defaultRaw === 'true' || defaultRaw === '1' || defaultRaw.toLowerCase() === 'sim';
    } else if (!defaultRaw) {
      defaultValue = null;
    }

    const min = minRaw === '' ? null : Number(minRaw);
    const max = maxRaw === '' ? null : Number(maxRaw);
    const step = stepRaw === '' ? 1 : Number(stepRaw);
    const sortOrder = sortOrderRaw === '' ? idx : Number(sortOrderRaw);
    const pricingAmount = pricingAmountRaw === '' ? 0 : Number(pricingAmountRaw);

    if ((minRaw !== '' && !Number.isFinite(min)) || (maxRaw !== '' && !Number.isFinite(max))) {
      throw new Error(`Mín/Máx inválido no campo ${label}`);
    }
    if (!Number.isFinite(step) || step <= 0) {
      throw new Error(`Passo inválido no campo ${label}`);
    }
    if (!Number.isFinite(pricingAmount)) {
      throw new Error(`Impacto de preço inválido no campo ${label}`);
    }

    const options = inputType === 'select' ? parseOptionsInput(optionsRaw) : [];
    if (inputType === 'select' && options.length === 0) {
      throw new Error(`Campo ${label} precisa de opções (label:valor:impacto).`);
    }

    fields.push({
      key,
      label,
      inputType,
      required,
      placeholder,
      defaultValue,
      min,
      max,
      step,
      options,
      pricingEnabled,
      pricingMode,
      pricingAmount,
      sortOrder,
    });
  });

  const keys = new Set();
  fields.forEach((f) => {
    if (keys.has(f.key)) throw new Error(`Chave duplicada: ${f.key}`);
    keys.add(f.key);
  });

  return fields;
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
      <div class="form-group"><label class="form-label">Ícone fallback (Ionicon/emoji)</label><input id="st-icon" class="form-input" placeholder="ex: briefcase-outline" /></div>
      <div class="form-group"><label class="form-label">Upload do ícone (PNG/WEBP transparente)</label><input id="st-image" class="form-input" type="file" accept=".png,.webp" /></div>
      <div class="form-group"><label class="form-label">Status</label>
        <select id="st-status" class="form-select">
          <option value="enabled">Ativo (aparece no app)</option>
          <option value="disabled" selected>Desativado</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Faixa mínima de horas</label><input id="st-min-hours" class="form-input" type="number" min="1" step="1" value="2" /></div>
      <div class="form-group"><label class="form-label">Faixa máxima de horas</label><input id="st-max-hours" class="form-input" type="number" min="1" step="1" value="12" /></div>
      <div class="form-group"><label class="form-label">Opções de duração (horas)</label><input id="st-hours-options" class="form-input" placeholder="2,3,4" value="2,3,4,5,6,8" /></div>
      <div class="form-group"><label class="form-label">Valor por minuto (R$)</label><input id="st-price-minute" class="form-input" type="number" min="0.01" step="0.01" placeholder="Ex: 0.90" /></div>
      <div class="form-group"><label class="form-label">Taxa da plataforma (%)</label><input id="st-platform-fee" class="form-input" type="number" min="0" max="100" step="0.1" placeholder="Ex: 15" /></div>
      <div class="form-group">
        <label class="form-label">Campos customizados do formulário</label>
        <div class="stf-fields-list" id="st-fields-list">${buildCheckoutFieldRows([])}</div>
        <button class="btn btn-ghost btn-sm" type="button" onclick="addCheckoutFieldRow('st-fields-list')">+ Adicionar campo</button>
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
  const minHours = parseInt(document.getElementById('st-min-hours').value || '2', 10);
  const maxHours = parseInt(document.getElementById('st-max-hours').value || '12', 10);
  const hoursOptionsRaw = (document.getElementById('st-hours-options').value || '').trim();
  const pricePerMinuteRaw = (document.getElementById('st-price-minute').value || '').trim();
  const platformFeeRaw = (document.getElementById('st-platform-fee').value || '').trim();
  const imageFile = document.getElementById('st-image').files?.[0] || null;
  if (!name || !slug) { alert('Nome e slug são obrigatórios.'); return; }
  if (!Number.isFinite(minHours) || !Number.isFinite(maxHours) || minHours < 1 || maxHours < minHours) {
    showAlert('Faixa de horas inválida.');
    return;
  }

  const hoursOptions = hoursOptionsRaw
    .split(',')
    .map((chunk) => parseInt(chunk.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= minHours && n <= maxHours);
  if (!hoursOptions.length) {
    showAlert('Informe ao menos uma opção de duração dentro da faixa de horas.');
    return;
  }

  const pricePerMinute = pricePerMinuteRaw === '' ? null : Number(pricePerMinuteRaw);
  if (pricePerMinuteRaw !== '' && (!Number.isFinite(pricePerMinute) || pricePerMinute <= 0)) {
    showAlert('Valor por minuto inválido.');
    return;
  }

  const platformFeePercent = platformFeeRaw === '' ? null : Number(platformFeeRaw);
  if (platformFeeRaw !== '' && (!Number.isFinite(platformFeePercent) || platformFeePercent < 0 || platformFeePercent > 100)) {
    showAlert('Taxa da plataforma inválida. Use valor entre 0 e 100.');
    return;
  }

  try {
    const checkoutFields = collectCheckoutFields('st-fields-list');
    const formData = new FormData();
    formData.append('name', name);
    formData.append('slug', slug);
    formData.append('description', description);
    formData.append('icon', icon);
    formData.append('status', status);
    formData.append('minHours', String(minHours));
    formData.append('maxHours', String(maxHours));
    formData.append('hoursOptions', JSON.stringify(Array.from(new Set(hoursOptions)).sort((a, b) => a - b)));
    if (pricePerMinute !== null) formData.append('pricePerMinute', String(pricePerMinute));
    if (platformFeePercent !== null) formData.append('platformFeePercent', String(platformFeePercent));
    formData.append('checkoutFields', JSON.stringify(checkoutFields));
    if (imageFile) formData.append('iconFile', imageFile);
    await stMultipartReq('POST', '', formData);
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
      <div class="form-group"><label class="form-label">Ícone fallback (Ionicon/emoji)</label><input id="ste-icon" class="form-input" value="${escHtml(t.icon||'')}" /></div>
      <div class="form-group"><label class="form-label">Ícone atual</label><div style="font-size:12px;color:#7A84A0;">${t.imageUrl ? `Arquivo enviado: ${escHtml(t.imageUrl)}` : 'Nenhum arquivo enviado'}</div></div>
      <div class="form-group"><label class="form-label">Trocar ícone (PNG/WEBP transparente)</label><input id="ste-image" class="form-input" type="file" accept=".png,.webp" /></div>
      <div class="form-group"><label class="form-label">Ordem de exibição</label><input id="ste-order" class="form-input" type="number" value="${t.sortOrder||0}" /></div>
      <div class="form-group"><label class="form-label">Status</label>
        <select id="ste-status" class="form-select">
          <option value="enabled" ${t.status==='enabled'?'selected':''}>Ativo</option>
          <option value="disabled" ${t.status==='disabled'?'selected':''}>Desativado</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Faixa mínima de horas</label><input id="ste-min-hours" class="form-input" type="number" min="1" step="1" value="${Number.isFinite(Number(t.minHours)) ? Number(t.minHours) : 2}" /></div>
      <div class="form-group"><label class="form-label">Faixa máxima de horas</label><input id="ste-max-hours" class="form-input" type="number" min="1" step="1" value="${Number.isFinite(Number(t.maxHours)) ? Number(t.maxHours) : 12}" /></div>
      <div class="form-group"><label class="form-label">Opções de duração (horas)</label><input id="ste-hours-options" class="form-input" value="${escHtml(Array.isArray(t.hoursOptions) && t.hoursOptions.length ? t.hoursOptions.join(',') : '2,3,4,5,6,8')}" /></div>
      <div class="form-group"><label class="form-label">Valor por minuto (R$)</label><input id="ste-price-minute" class="form-input" type="number" min="0.01" step="0.01" value="${Number.isFinite(Number(t.pricePerMinute)) ? Number(t.pricePerMinute) : ''}" placeholder="padrão global" /></div>
      <div class="form-group"><label class="form-label">Taxa da plataforma (%)</label><input id="ste-platform-fee" class="form-input" type="number" min="0" max="100" step="0.1" value="${Number.isFinite(Number(t.platformFeePercent)) ? Number(t.platformFeePercent) : ''}" placeholder="padrão global" /></div>
      <div class="form-group">
        <label class="form-label">Campos customizados do formulário</label>
        <div class="stf-fields-list" id="ste-fields-list">${buildCheckoutFieldRows(t.checkoutFields || [])}</div>
        <button class="btn btn-ghost btn-sm" type="button" onclick="addCheckoutFieldRow('ste-fields-list')">+ Adicionar campo</button>
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
  const minHours = parseInt(document.getElementById('ste-min-hours').value || '2', 10);
  const maxHours = parseInt(document.getElementById('ste-max-hours').value || '12', 10);
  const hoursOptionsRaw = (document.getElementById('ste-hours-options').value || '').trim();
  const pricePerMinuteRaw = (document.getElementById('ste-price-minute').value || '').trim();
  const platformFeeRaw = (document.getElementById('ste-platform-fee').value || '').trim();
  const imageFile = document.getElementById('ste-image').files?.[0] || null;
  if (!Number.isFinite(minHours) || !Number.isFinite(maxHours) || minHours < 1 || maxHours < minHours) {
    showAlert('Faixa de horas inválida.');
    return;
  }

  const hoursOptions = hoursOptionsRaw
    .split(',')
    .map((chunk) => parseInt(chunk.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= minHours && n <= maxHours);
  if (!hoursOptions.length) {
    showAlert('Informe ao menos uma opção de duração dentro da faixa de horas.');
    return;
  }

  const pricePerMinute = pricePerMinuteRaw === '' ? null : Number(pricePerMinuteRaw);
  if (pricePerMinuteRaw !== '' && (!Number.isFinite(pricePerMinute) || pricePerMinute <= 0)) {
    showAlert('Valor por minuto inválido.');
    return;
  }

  const platformFeePercent = platformFeeRaw === '' ? null : Number(platformFeeRaw);
  if (platformFeeRaw !== '' && (!Number.isFinite(platformFeePercent) || platformFeePercent < 0 || platformFeePercent > 100)) {
    showAlert('Taxa da plataforma inválida. Use valor entre 0 e 100.');
    return;
  }

  try {
    const checkoutFields = collectCheckoutFields('ste-fields-list');
    const formData = new FormData();
    formData.append('name', name);
    formData.append('description', description);
    formData.append('icon', icon);
    formData.append('sortOrder', sortOrder);
    formData.append('status', status);
    formData.append('minHours', String(minHours));
    formData.append('maxHours', String(maxHours));
    formData.append('hoursOptions', JSON.stringify(Array.from(new Set(hoursOptions)).sort((a, b) => a - b)));
    if (pricePerMinute !== null) formData.append('pricePerMinute', String(pricePerMinute));
    if (platformFeePercent !== null) formData.append('platformFeePercent', String(platformFeePercent));
    formData.append('checkoutFields', JSON.stringify(checkoutFields));
    if (imageFile) formData.append('iconFile', imageFile);
    await stMultipartReq('PATCH', `/${id}`, formData);
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
