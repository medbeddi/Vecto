/* ================================================================
   VECTO — Dashboard Admin · app_admin.js
   Connecté au backend via REST + Socket.IO
================================================================ */

const API = window.location.origin;
let _token = localStorage.getItem('vecto_admin_token');
let _role  = localStorage.getItem('vecto_admin_role') || 'admin';
let _socket = null;

/* ================================================================
   AUTH
================================================================ */
async function login() {
  const email    = document.getElementById('login-input').value.trim();
  const password = document.getElementById('password-input').value.trim();
  const errEl    = document.getElementById('login-error');
  errEl.style.display = 'none';

  try {
    const res = await fetch(API + '/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) { errEl.style.display = 'block'; return; }
    const data = await res.json();
    _token = data.token;
    _role  = data.admin.role || 'admin';
    localStorage.setItem('vecto_admin_token', _token);
    localStorage.setItem('vecto_admin_name', data.admin.name);
    localStorage.setItem('vecto_admin_role', _role);
    const roleLabel = _role === 'call_center' ? 'Call Center' : 'Admin';
    document.getElementById('current-user-label').textContent = data.admin.name + ' · ' + roleLabel;
    showApp();
  } catch {
    errEl.style.display = 'block';
  }
}

function logout() {
  _token = null;
  _role  = 'admin';
  localStorage.removeItem('vecto_admin_token');
  localStorage.removeItem('vecto_admin_name');
  localStorage.removeItem('vecto_admin_role');
  if (_socket) { _socket.disconnect(); _socket = null; }
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-input').value = '';
  document.getElementById('password-input').value = '';
}

function showApp() {
  _role = localStorage.getItem('vecto_admin_role') || 'admin';

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  // Masquer les éléments réservés aux admins si rôle call_center
  document.querySelectorAll('[data-role="admin"]').forEach(function (el) {
    el.style.display = _role === 'admin' ? '' : 'none';
  });

  initSocket();

  if (_role === 'call_center') {
    showPage('p-callcenter');
    loadInbox();
    loadLivreurs();
    loadClients();
  } else {
    showPage('p-stats');
    loadStats();
    loadCommandes();
    loadLivreurs();
    loadClients();
    loadTransactions();
    loadInbox();
    loadUsers();
  }
}

/* ================================================================
   INIT
================================================================ */
document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';

  document.getElementById('password-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') login();
  });

  if (_token) {
    fetch(API + '/api/admin/me', { headers: { Authorization: 'Bearer ' + _token } })
      .then(function (r) {
        if (r.ok) return r.json();
      })
      .then(function (data) {
        if (!data) return;
        const name = data.name || localStorage.getItem('vecto_admin_name') || 'Admin';
        const storedRole = data.role || localStorage.getItem('vecto_admin_role') || 'admin';
        localStorage.setItem('vecto_admin_name', name);
        localStorage.setItem('vecto_admin_role', storedRole);
        _role = storedRole;
        const roleLabel = storedRole === 'call_center' ? 'Call Center' : 'Admin';
        document.getElementById('current-user-label').textContent = name + ' · ' + roleLabel;
        showApp();
      })
      .catch(function () {});
  }
});

/* ================================================================
   SOCKET.IO — temps réel
================================================================ */
var _activeOrders = {};

function initSocket() {
  if (typeof io === 'undefined') return;
  _socket = io(API, { auth: { token: _token } });

  _socket.on('new_order', function (order) {
    _activeOrders[order.deliveryId] = order;
    renderCommandes();
    renderStatsRecent();
  });

  _socket.on('order_taken', function (data) {
    if (_activeOrders[data.deliveryId]) {
      _activeOrders[data.deliveryId]._status = 'assigned';
      renderCommandes();
    }
  });

  // Mise à jour GPS livreur en temps réel
  _socket.on('driver_location', function (data) {
    _trackingDrivers[data.driverId] = Object.assign(_trackingDrivers[data.driverId] || {}, {
      driverId: data.driverId, name: data.name, lat: data.lat, lng: data.lng,
    });
    updateTrackingMarker(_trackingDrivers[data.driverId]);
    renderTrackingList();
  });

  // Positions initiales de tous les livreurs
  _socket.on('drivers_locations', function (list) {
    list.forEach(function (d) {
      _trackingDrivers[d.driverId] = d;
      updateTrackingMarker(d);
    });
    renderTrackingList();
  });

  // Réponse livreur → CC
  _socket.on('driver_reply_to_cc', function (data) {
    if (_ccActiveTab === 'drivers' && _selectedDriverId === data.driverId) {
      appendDriverChatMessage(data.message);
    } else {
      _driverChatUnread++;
      var badge = document.getElementById('cc-driver-unread-badge');
      if (badge) { badge.textContent = _driverChatUnread; badge.style.display = 'inline-flex'; }
    }
  });

  // Nouveau message texte WA → call center
  _socket.on('incoming_text', function (data) {
    // Mettre à jour l'inbox si la page est active
    loadInbox();
    // Si la conversation est déjà ouverte, ajouter le message en temps réel
    if (_inboxSelectedId === data.deliveryId && data.message) {
      var container = document.getElementById('cc-messages');
      if (container) {
        var div = document.createElement('div');
        div.className = 'cc-msg client';
        var body = data.message.type === 'text'
          ? escHtml(data.message.content || '')
          : '[' + data.message.type + ']';
        div.innerHTML = body + '<div class="cc-msg-time">' + fmtTime(data.message.createdAt) + '</div>';
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
      }
    }
  });
}

/* ================================================================
   NAVIGATION
================================================================ */
var _ccActiveTab = 'clients';
var _selectedDriverId = null;
var _selectedDriverName = null;
var _driverChatUnread = 0;
var _ccMapInitialized = false;

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });

  var page = document.getElementById(pageId);
  if (page) page.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(function (item) {
    if ((item.getAttribute('onclick') || '').includes(pageId)) item.classList.add('active');
  });

  var titles = {
    'p-stats': 'Statistiques', 'p-commandes': 'Commandes', 'p-livreurs': 'Livreurs',
    'p-clients': 'Clients', 'p-wallet': 'Wallets', 'p-callcenter': 'Call Center',
    'p-tracking': 'Tracking Livreurs', 'p-users': 'Utilisateurs',
  };
  document.getElementById('page-title').textContent = titles[pageId] || '';

  if (pageId === 'p-callcenter') {
    showCCTab(_ccActiveTab);
  }
  if (pageId === 'p-tracking') {
    setTimeout(function () {
      initTrackingMap();
      loadTrackingDrivers();
    }, 100);
  }
}

/* ================================================================
   CALL CENTER — onglets Clients / Livreurs
================================================================ */

function showCCTab(tab) {
  _ccActiveTab = tab;
  var clientsPanel = document.getElementById('cc-clients-panel');
  var driversPanel = document.getElementById('cc-drivers-panel');
  var tabClients   = document.getElementById('cc-tab-clients');
  var tabDrivers   = document.getElementById('cc-tab-drivers');
  if (!clientsPanel) return;

  clientsPanel.style.display = tab === 'clients' ? '' : 'none';
  driversPanel.style.display = tab === 'drivers' ? '' : 'none';
  tabClients.classList.toggle('active', tab === 'clients');
  tabDrivers.classList.toggle('active', tab === 'drivers');

  if (tab === 'clients') {
    loadInbox();
  } else {
    loadDriversChatList();
    _driverChatUnread = 0;
    var badge = document.getElementById('cc-driver-unread-badge');
    if (badge) badge.style.display = 'none';
  }
}

function loadDriversChatList() {
  fetch(API + '/api/admin/drivers', { headers: { 'Authorization': 'Bearer ' + _token } })
    .then(function (r) { return r.json(); })
    .then(function (data) { renderDriversChatList(data.drivers || []); })
    .catch(function () {});
}

function renderDriversChatList(drivers) {
  var list = document.getElementById('cc-drivers-list');
  if (!list) return;
  if (!drivers.length) {
    list.innerHTML = '<div class="cc-inbox-empty">Aucun livreur enregistré</div>';
    return;
  }
  list.innerHTML = drivers.map(function (d) {
    var dot = d.status === 'available' ? '🟢' : d.status === 'busy' ? '🔴' : '⚫';
    var statusLabel = d.status === 'available' ? 'Disponible' : d.status === 'busy' ? 'En course' : 'Hors ligne';
    var isActive = d.id === _selectedDriverId;
    return '<div class="cc-inbox-item' + (isActive ? ' active' : '') + '" onclick="selectDriverChat(\'' + d.id + '\',\'' + (d.name || '').replace(/'/g, "\\'") + '\')">'
      + '<div class="cc-inbox-alias">' + escHtml(d.name) + '</div>'
      + '<div class="cc-inbox-preview">' + dot + ' ' + statusLabel + '</div>'
      + '</div>';
  }).join('');
}

function selectDriverChat(driverId, driverName) {
  _selectedDriverId  = driverId;
  _selectedDriverName = driverName;
  document.getElementById('cc-driver-chat-empty').style.display = 'none';
  document.getElementById('cc-driver-chat-view').style.display  = 'flex';
  document.getElementById('cc-driver-chat-name').textContent    = driverName;
  loadDriversChatList();
  loadDriverChatMessages(driverId);
}

function loadDriverChatMessages(driverId) {
  fetch(API + '/api/admin/driver-chat/' + driverId, { headers: { 'Authorization': 'Bearer ' + _token } })
    .then(function (r) { return r.json(); })
    .then(function (data) { renderDriverChatMessages(data.messages || []); })
    .catch(function () {});
}

function renderDriverChatMessages(messages) {
  var container = document.getElementById('cc-driver-messages');
  if (!container) return;
  container.innerHTML = messages.map(function (m) {
    var isOut = m.senderRole === 'admin';
    return '<div class="cc-msg-wrap ' + (isOut ? 'cc-msg-out' : 'cc-msg-in') + '">'
      + '<div class="cc-msg-bubble ' + (isOut ? 'cc-msg-bubble-out' : 'cc-msg-bubble-in') + '">'
      + '<div class="cc-msg-text">' + escHtml(m.content) + '</div>'
      + '<div class="cc-msg-time">' + fmtTime(m.createdAt) + '</div>'
      + '</div></div>';
  }).join('');
  container.scrollTop = container.scrollHeight;
}

function appendDriverChatMessage(msg) {
  var container = document.getElementById('cc-driver-messages');
  if (!container) return;
  var isOut = msg.senderRole === 'admin';
  var div = document.createElement('div');
  div.className = 'cc-msg-wrap ' + (isOut ? 'cc-msg-out' : 'cc-msg-in');
  div.innerHTML = '<div class="cc-msg-bubble ' + (isOut ? 'cc-msg-bubble-out' : 'cc-msg-bubble-in') + '">'
    + '<div class="cc-msg-text">' + escHtml(msg.content) + '</div>'
    + '<div class="cc-msg-time">' + fmtTime(msg.createdAt) + '</div>'
    + '</div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function sendDriverChatMsg() {
  var input   = document.getElementById('cc-driver-reply-input');
  var content = input ? input.value.trim() : '';
  if (!content || !_selectedDriverId) return;
  input.value = '';
  try {
    var res = await fetch(API + '/api/admin/driver-chat/' + _selectedDriverId, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ content: content }),
    });
    if (!res.ok) return;
    var data = await res.json();
    appendDriverChatMessage(data.message);
  } catch {}
}

/* ================================================================
   UTILS
================================================================ */
function authHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _token };
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtMoney(n) {
  return parseFloat(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0 }) + ' MRU';
}

function fmtPhone(raw) {
  if (!raw) return '—';
  // wa_id format: "22244123456" → "+222 44 12 34 56"
  const s = String(raw).replace(/\D/g, '');
  if (s.startsWith('222') && s.length === 11) {
    return '+222 ' + s.slice(3, 5) + ' ' + s.slice(5, 7) + ' ' + s.slice(7, 9) + ' ' + s.slice(9);
  }
  return '+' + s;
}

/* ================================================================
   STATS + GRAPHE
================================================================ */
async function loadStats() {
  try {
    const res = await fetch(API + '/api/admin/stats', { headers: authHeaders() });
    if (!res.ok) return;
    const d = await res.json();

    document.getElementById('stat-courses').textContent  = d.coursesToday;
    document.getElementById('stat-livreurs').textContent = d.activeDrivers;
    document.getElementById('stat-revenus').textContent  = fmtMoney(d.totalRevenue);
    document.getElementById('stat-clients').textContent  = d.totalClients;

    if (d.daily && d.daily.length) renderBarChart(d.daily);
  } catch {}

  renderStatsRecent();
}

function renderBarChart(daily) {
  const max = Math.max(...daily.map(d => d.count), 1);
  const bars = document.querySelectorAll('#bar-chart-wrap .bar-group');
  daily.forEach(function (d, i) {
    if (!bars[i]) return;
    const bar   = bars[i].querySelector('.bar');
    const label = bars[i].querySelector('.bar-label');
    const pct   = Math.round((d.count / max) * 100);
    if (bar)   { bar.style.height = (pct || 2) + '%'; bar.title = d.count + ' course(s)'; }
    if (label) label.textContent = d.label;
  });
}

function renderStatsRecent() {
  var tbody = document.getElementById('stats-recent-tbody');
  if (!tbody) return;
  var orders = Object.values(_activeOrders).slice(0, 6);
  if (!orders.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:20px">Aucune commande active</td></tr>';
    return;
  }
  var html = '';
  orders.forEach(function (o, i) {
    var statut = o._status === 'assigned' ? '<span class="badge badge-green">Assignée</span>'
      : o._status === 'in_progress'       ? '<span class="badge badge-orange">En route</span>'
      : '<span class="badge badge-blue">En attente</span>';
    html += '<tr>'
      + '<td style="font-weight:700;color:var(--text-2)">#' + (i + 1) + '</td>'
      + '<td>Course</td>'
      + '<td style="font-weight:600">' + (o.clientAlias || '—') + '</td>'
      + '<td>—</td><td>—</td>'
      + '<td>' + statut + '</td>'
      + '</tr>';
  });
  tbody.innerHTML = html;
}

/* ================================================================
   COMMANDES (actives en temps réel)
================================================================ */
var _currentFilter = 'all';

async function loadCommandes() {
  try {
    const res = await fetch(API + '/api/admin/orders/active', { headers: authHeaders() });
    if (!res.ok) return;
    const { orders } = await res.json();
    _activeOrders = {};
    for (const o of orders) {
      _activeOrders[o.id] = {
        deliveryId: o.id,
        clientAlias: o.clientAlias,
        createdAt: o.createdAt,
        _status: o.status,
      };
    }
    renderCommandes();
    renderStatsRecent();
  } catch {}
}

var STATUT_LABELS = {
  pending:     '<span class="badge badge-blue">En attente</span>',
  assigned:    '<span class="badge badge-blue">En cours</span>',
  in_progress: '<span class="badge badge-orange">En route</span>',
  done:        '<span class="badge badge-green">Livrée</span>',
  cancelled:   '<span class="badge badge-red">Annulée</span>',
};

function renderCommandes() {
  var tbody = document.getElementById('commandes-tbody');
  if (!tbody) return;

  var orders = Object.values(_activeOrders);
  if (_currentFilter !== 'all') {
    orders = orders.filter(function (o) { return o._status === _currentFilter; });
  }

  if (!orders.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-3);padding:24px">Aucune commande</td></tr>';
    return;
  }

  var html = '';
  orders.forEach(function (o, i) {
    var time = o.createdAt ? new Date(o.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—';
    var canCancel = ['pending', 'assigned'].includes(o._status);
    html += '<tr>'
      + '<td style="font-weight:700;color:var(--text-2)">#' + (i + 1) + '</td>'
      + '<td>Course</td>'
      + '<td style="font-weight:600">' + (o.clientAlias || '—') + '</td>'
      + '<td>' + time + '</td>'
      + '<td>—</td>'
      + '<td>' + (STATUT_LABELS[o._status] || '') + '</td>'
      + '<td>' + (canCancel ? '<button class="btn-table red" onclick="cancelCommande(\'' + o.deliveryId + '\')">Annuler</button>' : '—') + '</td>'
      + '</tr>';
  });
  tbody.innerHTML = html;
}

function filterCommandes(filter, btn) {
  _currentFilter = filter;
  document.querySelectorAll('.filter-pills .filter-pill').forEach(function (b) { b.classList.remove('active'); });
  btn.classList.add('active');
  renderCommandes();
}

function cancelCommande(id) {
  document.getElementById('confirm-title').textContent   = 'Annuler cette commande ?';
  document.getElementById('confirm-message').textContent = 'La commande sera marquée annulée. Cette action est irréversible.';
  document.getElementById('confirm-btn').onclick = function () {
    if (_activeOrders[id]) _activeOrders[id]._status = 'cancelled';
    renderCommandes();
    closeModal('modal-confirm');
  };
  showModal('modal-confirm');
}

/* ================================================================
   LIVREURS
================================================================ */
var _livreurs = [];
var _editDriverId = null;

async function loadLivreurs() {
  try {
    const res = await fetch(API + '/api/admin/drivers', { headers: authHeaders() });
    if (!res.ok) return;
    const { drivers } = await res.json();
    _livreurs = drivers;
    renderLivreurs();
    updateWalletStats(null); // refresh totaux wallet
  } catch {}
}

var STATUT_LIVREUR = {
  available: '<span class="badge badge-green">Disponible</span>',
  busy:      '<span class="badge badge-orange">En course</span>',
  offline:   '<span class="badge badge-grey">Hors ligne</span>',
  suspended: '<span class="badge badge-red">Suspendu</span>',
};

function renderLivreurs() {
  var tbody = document.getElementById('livreurs-tbody');
  if (!tbody) return;
  if (!_livreurs.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-3);padding:24px">Aucun livreur</td></tr>';
    return;
  }
  var html = '';
  _livreurs.forEach(function (l, i) {
    html += '<tr>'
      + '<td style="font-weight:700;color:var(--text-2)">#' + (i + 1) + '</td>'
      + '<td style="font-weight:600">' + l.name + '</td>'
      + '<td>' + (STATUT_LIVREUR[l.status] || '') + '</td>'
      + '<td>' + l.courses + '</td>'
      + '<td style="font-weight:600">' + fmtMoney(l.balance) + '</td>'
      + '<td>' + fmtDate(l.createdAt) + '</td>'
      + '<td style="display:flex;gap:4px">'
        + '<button class="btn-table" onclick="openEditDriver(\'' + l.id + '\',' + i + ')">Modifier</button>'
        + (l.status !== 'suspended'
          ? '<button class="btn-table red" onclick="suspendLivreur(\'' + l.id + '\',' + i + ')">Suspendre</button>'
          : '<button class="btn-table" onclick="reactivateLivreur(\'' + l.id + '\',' + i + ')">Réactiver</button>')
      + '</td>'
      + '</tr>';
  });
  tbody.innerHTML = html;
}

function openEditDriver(id, index) {
  _editDriverId = id;
  document.getElementById('edit-driver-name').value = _livreurs[index].name;
  showModal('modal-edit-driver');
}

async function saveDriver() {
  const name = document.getElementById('edit-driver-name').value.trim();
  if (!name) return;
  try {
    const res = await fetch(API + '/api/admin/drivers/' + _editDriverId, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ name }),
    });
    if (!res.ok) { alert('Erreur lors de la modification.'); return; }
    const idx = _livreurs.findIndex(function (l) { return l.id === _editDriverId; });
    if (idx !== -1) _livreurs[idx].name = name;
    renderLivreurs();
    closeModal('modal-edit-driver');
  } catch {
    alert('Erreur réseau.');
  }
}

function suspendLivreur(id, index) {
  document.getElementById('confirm-title').textContent   = 'Suspendre ' + _livreurs[index].name;
  document.getElementById('confirm-message').textContent = 'Le livreur ne pourra plus accepter de missions.';
  document.getElementById('confirm-btn').onclick = async function () {
    try {
      await fetch(API + '/api/admin/drivers/' + id + '/suspend', { method: 'POST', headers: authHeaders() });
      _livreurs[index].status = 'suspended';
      renderLivreurs();
    } catch {}
    closeModal('modal-confirm');
  };
  showModal('modal-confirm');
}

async function reactivateLivreur(id, index) {
  try {
    await fetch(API + '/api/admin/drivers/' + id + '/reactivate', { method: 'POST', headers: authHeaders() });
    _livreurs[index].status = 'offline';
    renderLivreurs();
  } catch {}
}

function addLivreur() {
  alert('Le livreur s\'inscrit lui-même via l\'app mobile et reçoit un SMS OTP pour valider son compte.');
  closeModal('modal-add-livreur');
}

/* ================================================================
   CLIENTS
================================================================ */
var _clients = [];

async function loadClients() {
  try {
    const res = await fetch(API + '/api/admin/clients', { headers: authHeaders() });
    if (!res.ok) return;
    const { clients } = await res.json();
    _clients = clients;
    renderClients(_clients);
  } catch {}
}

function renderClients(data) {
  var tbody = document.getElementById('clients-tbody');
  if (!tbody) return;
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:24px">Aucun client trouvé</td></tr>';
    return;
  }
  var html = '';
  data.forEach(function (c, i) {
    var phone = c.phone ? fmtPhone(c.phone) : '<span style="color:var(--text-3)">—</span>';
    html += '<tr>'
      + '<td style="font-weight:700;color:var(--text-2)">#' + c.num + '</td>'
      + '<td style="font-weight:600">' + c.alias + '</td>'
      + '<td>' + phone + '</td>'
      + '<td style="font-weight:600">' + c.commandes + '</td>'
      + '<td>' + fmtDate(c.derniere) + '</td>'
      + '<td><button class="btn-table" onclick="voirClientDetail(' + i + ')">Voir</button></td>'
      + '</tr>';
  });
  tbody.innerHTML = html;
}

function filterClients() {
  var q = document.getElementById('client-search').value.toLowerCase();
  renderClients(_clients.filter(function (c) {
    return c.alias.toLowerCase().includes(q) || (c.phone && c.phone.includes(q));
  }));
}

function voirClientDetail(index) {
  var c = _clients[index];
  document.getElementById('client-detail-num').textContent      = '#' + c.num;
  document.getElementById('client-detail-nom').textContent      = c.alias;
  document.getElementById('client-detail-tel').textContent      = c.phone ? fmtPhone(c.phone) : 'Non disponible';
  document.getElementById('client-detail-commandes').textContent = c.commandes + ' commandes';
  document.getElementById('client-detail-derniere').textContent  = fmtDate(c.derniere);
  document.getElementById('client-detail-statut').innerHTML      = '<span class="badge badge-green">Actif</span>';
  showModal('modal-client-detail');
}

/* ================================================================
   WALLET
================================================================ */
var _transactions = [];

async function loadTransactions() {
  try {
    const res = await fetch(API + '/api/admin/transactions', { headers: authHeaders() });
    if (!res.ok) return;
    const { transactions } = await res.json();
    _transactions = transactions;
    renderWallet(transactions);
    updateWalletStats(transactions);
  } catch {}
}

function renderWallet(transactions) {
  var tbody = document.getElementById('wallet-tbody');
  if (!tbody) return;
  if (!transactions.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:24px">Aucune transaction</td></tr>';
    return;
  }
  var html = '';
  transactions.forEach(function (t, i) {
    var positive = parseFloat(t.amount) > 0;
    var color  = positive ? '#1a7a35' : '#b86800';
    var sign   = positive ? '+' : '';
    var badge  = t.status === 'completed'
      ? '<span class="badge badge-green">Validé</span>'
      : t.status === 'pending'
        ? '<span class="badge badge-orange">En attente</span>'
        : '<span class="badge badge-red">Échoué</span>';
    html += '<tr>'
      + '<td style="font-weight:700;color:var(--text-2)">#' + (i + 1) + '</td>'
      + '<td style="font-weight:600">' + t.driverName + '</td>'
      + '<td>' + t.type + '</td>'
      + '<td>' + (t.description || '—') + '</td>'
      + '<td style="font-weight:700;color:' + color + '">' + sign + fmtMoney(t.amount) + '</td>'
      + '<td>' + fmtDate(t.createdAt) + '</td>'
      + '<td>' + badge + '</td>'
      + '</tr>';
  });
  tbody.innerHTML = html;
}

function updateWalletStats(transactions) {
  var totalWallet = _livreurs.reduce(function (s, l) { return s + l.balance; }, 0);
  var el1 = document.getElementById('wallet-stat-total');
  if (el1) el1.textContent = fmtMoney(totalWallet);

  if (!transactions) return;
  var weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  var rechargesWeek = transactions
    .filter(function (t) { return t.type === 'recharge' && t.status === 'completed' && new Date(t.createdAt) >= weekAgo; })
    .reduce(function (s, t) { return s + Math.abs(parseFloat(t.amount)); }, 0);
  var commissionsWeek = transactions
    .filter(function (t) { return t.type === 'commission' && t.status === 'completed' && new Date(t.createdAt) >= weekAgo; })
    .reduce(function (s, t) { return s + Math.abs(parseFloat(t.amount)); }, 0);

  var el2 = document.getElementById('wallet-stat-recharges');
  var el3 = document.getElementById('wallet-stat-commissions');
  if (el2) el2.textContent = fmtMoney(rechargesWeek);
  if (el3) el3.textContent = fmtMoney(commissionsWeek);
}

/* ================================================================
   CALL CENTER
================================================================ */
var _selectedType = 'restaurant';
var _ccDepartLocation = null;
var _ccDestLocation   = null;

function selectType(type) {
  _selectedType = type;
  ['restaurant', 'supermarche', 'colis'].forEach(function (t) {
    var btn = document.getElementById('cc-type-' + t);
    if (btn) btn.classList.remove('active');
  });
  var btn = document.getElementById('cc-type-' + type);
  if (btn) btn.classList.add('active');
}

function searchClient() {
  var phone = document.getElementById('cc-phone').value.trim();
  if (!phone) return;
  var banner = document.getElementById('cc-client-info');
  banner.style.display = 'flex';
  document.getElementById('cc-client-name').textContent = 'Client · ' + phone;
}

function calcDistanceCC() {
  if (!_ccDepartLocation || !_ccDestLocation) return null;
  var lat1 = _ccDepartLocation.lat(), lng1 = _ccDepartLocation.lng();
  var lat2 = _ccDestLocation.lat(),   lng2 = _ccDestLocation.lng();
  var R = 6371;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  var dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  var prix = dist <= 5.5 ? 100 : 150;
  document.getElementById('cc-prix').textContent = prix + ' MRU';
  document.getElementById('cc-prix-detail').textContent =
    dist.toFixed(1) + ' km — ' + (dist <= 5.5 ? 'Zone courte (≤ 5,5 km)' : 'Zone longue (> 5,5 km)');
  return { dist: dist, prix: prix };
}

function initCCMap() {
  var mapEl = document.getElementById('cc-map');
  if (!mapEl || typeof google === 'undefined') return;

  var nouakchott = { lat: 18.0735, lng: -15.9582 };
  var bounds = new google.maps.LatLngBounds(
    new google.maps.LatLng(17.9500, -16.0800),
    new google.maps.LatLng(18.2000, -15.8500)
  );
  var map = new google.maps.Map(mapEl, { zoom: 13, center: nouakchott, disableDefaultUI: true, zoomControl: true });
  window._ccMap = map;

  var nbEl = document.getElementById('cc-nb-livreurs');
  var actifs = _livreurs.filter(function (l) { return l.status === 'available'; });
  if (nbEl) nbEl.textContent = actifs.length + ' livreur(s) disponible(s)';

  var markerDepart = null, markerDest = null;
  var iconVert  = { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: '#34C759', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 };
  var iconRouge = { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: '#FF3B30', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 };

  var dsvc  = new google.maps.DirectionsService();
  var drend = new google.maps.DirectionsRenderer({
    suppressMarkers: true,
    polylineOptions: { strokeColor: '#1A1A1A', strokeOpacity: .75, strokeWeight: 4 },
  });
  drend.setMap(map);

  function tracerRoute() {
    if (!_ccDepartLocation || !_ccDestLocation) return;
    dsvc.route({ origin: _ccDepartLocation, destination: _ccDestLocation, travelMode: google.maps.TravelMode.DRIVING },
      function (result, status) { if (status === 'OK') drend.setDirections(result); });
  }

  var acDepart = new google.maps.places.Autocomplete(
    document.getElementById('cc-depart'),
    { componentRestrictions: { country: 'mr' }, bounds: bounds, strictBounds: true, fields: ['geometry', 'name'] }
  );
  acDepart.addListener('place_changed', function () {
    var place = acDepart.getPlace();
    if (!place.geometry) return;
    _ccDepartLocation = place.geometry.location;
    if (markerDepart) markerDepart.setPosition(_ccDepartLocation);
    else markerDepart = new google.maps.Marker({ position: _ccDepartLocation, map: map, icon: iconVert });
    map.panTo(_ccDepartLocation); calcDistanceCC(); tracerRoute();
  });

  var acDest = new google.maps.places.Autocomplete(
    document.getElementById('cc-destination'),
    { componentRestrictions: { country: 'mr' }, bounds: bounds, strictBounds: true, fields: ['geometry', 'name'] }
  );
  acDest.addListener('place_changed', function () {
    var place = acDest.getPlace();
    if (!place.geometry) return;
    _ccDestLocation = place.geometry.location;
    if (markerDest) markerDest.setPosition(_ccDestLocation);
    else markerDest = new google.maps.Marker({ position: _ccDestLocation, map: map, icon: iconRouge });
    map.panTo(_ccDestLocation); calcDistanceCC(); tracerRoute();
  });
}

async function createCommande() {
  var result = calcDistanceCC();
  var noteEl = document.querySelector('#p-callcenter .textarea-field');
  var description = noteEl ? noteEl.value.trim() : '';
  if (!description) {
    var typeLabel = _selectedType === 'restaurant' ? 'Livraison restaurant'
      : _selectedType === 'supermarche' ? 'Livraison supermarché' : 'Livraison colis';
    description = typeLabel;
    if (result) description += ' · ' + result.dist.toFixed(1) + ' km · ' + result.prix + ' MRU';
  }

  try {
    const res = await fetch(API + '/api/admin/broadcast', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ description, mediaType: 'text' }),
    });
    if (!res.ok) { alert('Erreur lors de la création de la commande.'); return; }
    const data = await res.json();
    alert('Commande créée — ' + data.delivery.clientAlias + '\nVisible par tous les livreurs disponibles.');
    if (noteEl) noteEl.value = '';
    showPage('p-commandes');
    loadCommandes();
  } catch {
    alert('Erreur réseau.');
  }
}

/* ================================================================
   MODALS
================================================================ */
function showModal(id) {
  var m = document.getElementById(id);
  if (m) m.classList.add('open');
}
function closeModal(id) {
  var m = document.getElementById(id);
  if (m) m.classList.remove('open');
}

/* ================================================================
   CALL CENTER — INBOX (conversations WhatsApp en attente)
================================================================ */
var _inboxSelectedId = null;
var _inboxItems = {};
var _currentMessages = [];

async function loadInbox() {
  try {
    var res = await fetch(API + '/api/admin/inbox', { headers: authHeaders() });
    if (!res.ok) return;
    var data = await res.json();
    renderInboxList(data.inbox || []);
  } catch {}
}

function renderInboxList(items) {
  var list = document.getElementById('cc-inbox-list');
  if (!list) return;

  _inboxItems = {};
  items.forEach(function (item) { _inboxItems[item.id] = item; });

  if (!items.length) {
    list.innerHTML = '<div class="cc-inbox-empty">Aucune conversation en attente</div>';
    return;
  }

  list.innerHTML = items.map(function (item) {
    var preview = item.lastMessage
      ? (item.lastMessage.type === 'text' ? (item.lastMessage.content || '') : '[' + item.lastMessage.type + ']')
      : 'Nouveau contact';
    var time = item.lastMessage ? fmtTime(item.lastMessage.createdAt) : fmtTime(item.createdAt);
    var active = item.id === _inboxSelectedId ? ' active' : '';
    return '<div class="cc-inbox-item' + active + '" onclick="openConversation(\'' + item.id + '\')">'
      + '<div class="cc-inbox-alias">' + escHtml(item.clientAlias) + '</div>'
      + '<div class="cc-inbox-preview">' + escHtml(preview.slice(0, 60)) + '</div>'
      + '<div class="cc-inbox-time">' + time + '</div>'
      + '</div>';
  }).join('');
}

async function openConversation(deliveryId) {
  _inboxSelectedId = deliveryId;
  var item = _inboxItems[deliveryId];

  // Mettre en évidence la ligne
  document.querySelectorAll('.cc-inbox-item').forEach(function (el) { el.classList.remove('active'); });
  var clicked = document.querySelector('.cc-inbox-item[onclick*="' + deliveryId + '"]');
  if (clicked) clicked.classList.add('active');

  // Afficher le panneau chat
  document.getElementById('cc-chat-empty').style.display = 'none';
  var chatView = document.getElementById('cc-chat-view');
  chatView.style.display = 'flex';
  document.getElementById('cc-chat-client-name').textContent = item ? item.clientAlias : '—';

  // Charger les messages
  await loadMessages(deliveryId);
}

async function loadMessages(deliveryId) {
  try {
    var res = await fetch(API + '/api/admin/inbox/' + deliveryId + '/messages', { headers: authHeaders() });
    if (!res.ok) return;
    var data = await res.json();
    renderMessages(data.messages || []);
  } catch {}
}

function renderMessages(messages) {
  _currentMessages = messages;
  var container = document.getElementById('cc-messages');
  if (!container) return;

  if (!messages.length) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-3);font-size:13px;padding:20px">Aucun message</div>';
    return;
  }

  container.innerHTML = messages.map(function (m) {
    var side = (m.sender_role === 'admin') ? 'admin' : 'client';
    var body = '';
    if (m.type === 'text') {
      body = escHtml(m.content || '');
    } else if (m.type === 'audio') {
      body = m.content
        ? '<audio controls src="' + escHtml(m.content) + '" style="max-width:220px;display:block"></audio>'
        : '[Message vocal]';
      // Bouton "Transférer aux livreurs" sur les vocaux du client
      if (side === 'client' && m.content) {
        body += '<button class="cc-forward-btn" onclick="forwardAudioToDrivers(\'' + escHtml(m.content) + '\')" title="Utiliser ce vocal comme message de course">'
          + '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 004 4h12"/></svg>'
          + 'Transférer aux livreurs</button>';
      }
    } else if (m.type === 'image') {
      body = m.content
        ? '<img src="' + escHtml(m.content) + '" style="max-width:200px;border-radius:8px" />'
        : '[Image]';
    } else if (m.type === 'location') {
      var meta = m.meta || {};
      body = 'Localisation : ' + (meta.label || (meta.lat + ', ' + meta.lng));
    } else {
      body = '[' + m.type + ']';
    }
    return '<div class="cc-msg ' + side + '">'
      + body
      + '<div class="cc-msg-time">' + fmtTime(m.createdAt) + '</div>'
      + '</div>';
  }).join('');

  container.scrollTop = container.scrollHeight;
}

async function sendReply() {
  if (!_inboxSelectedId) return;
  var input = document.getElementById('cc-reply-input');
  var text = (input.value || '').trim();
  if (!text) return;

  input.value = '';
  try {
    var res = await fetch(API + '/api/admin/inbox/' + _inboxSelectedId + '/reply', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ text: text }),
    });
    if (!res.ok) { alert('Erreur lors de l\'envoi.'); return; }
    // Ajouter localement sans recharger
    var container = document.getElementById('cc-messages');
    var div = document.createElement('div');
    div.className = 'cc-msg admin';
    div.innerHTML = escHtml(text) + '<div class="cc-msg-time">maintenant</div>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  } catch {
    alert('Erreur réseau.');
  }
}

function openLaunchPanel() {
  if (!_inboxSelectedId) return;
  // Reset état audio
  _forwardedAudioUrl = null;
  var preview = document.getElementById('cc-launch-audio-preview');
  var player  = document.getElementById('cc-launch-audio-player');
  if (preview) preview.style.display = 'none';
  if (player)  player.src = '';
  document.getElementById('cc-launch-status').textContent = '';
  document.getElementById('cc-launch-status').className = 'cc-launch-status';
  document.getElementById('cc-launch-panel').style.display = 'flex';
  document.querySelector('.cc-inbox-layout').classList.add('launch-open');
  populateLaunchAudios();
  setTimeout(function () {
    initMiniMap();
    setTimeout(function () { if (_miniMap) _miniMap.invalidateSize(); }, 200);
  }, 300);
}

function closeLaunchPanel() {
  document.getElementById('cc-launch-panel').style.display = 'none';
  document.querySelector('.cc-inbox-layout').classList.remove('launch-open');
  if (_launchIsRecording) stopLaunchRecording();
}

/* ── Mini-carte Leaflet dans le panneau de lancement ─────────────────── */
var _miniMap = null, _miniMarkerA = null, _miniMarkerB = null, _miniPolyline = null;
var _miniMapReady = false;
var _miniMapDebounce = null;

function initMiniMap() {
  var el = document.getElementById('cc-mini-map');
  if (!el || typeof L === 'undefined') return;
  if (_miniMapReady) return;

  _miniMap = L.map('cc-mini-map', { zoomControl: true, attributionControl: false })
    .setView([18.0735, -15.9582], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(_miniMap);
  _miniMapReady = true;
}

function debounceMiniMap() {
  clearTimeout(_miniMapDebounce);
  _miniMapDebounce = setTimeout(updateMiniMap, 900);
}

async function updateMiniMap() {
  if (!_miniMapReady) { initMiniMap(); if (!_miniMapReady) return; }
  var pickup  = (document.getElementById('cc-pickup')?.value  || '').trim();
  var dropoff = (document.getElementById('cc-dropoff')?.value || '').trim();
  if (!pickup && !dropoff) return;

  async function geocode(addr) {
    try {
      var r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(addr + ', Mauritanie'));
      var d = await r.json();
      if (d.length) return [parseFloat(d[0].lat), parseFloat(d[0].lon)];
    } catch {}
    return null;
  }

  var dotA = pickup  ? await geocode(pickup)  : null;
  var dotB = dropoff ? await geocode(dropoff) : null;

  var greenIcon = L.divIcon({ className: '', html: '<div style="width:14px;height:14px;background:#34C759;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>', iconSize: [14,14], iconAnchor: [7,7] });
  var redIcon   = L.divIcon({ className: '', html: '<div style="width:14px;height:14px;background:#FF3B30;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>', iconSize: [14,14], iconAnchor: [7,7] });

  if (dotA) {
    if (_miniMarkerA) { _miniMarkerA.setLatLng(dotA); }
    else { _miniMarkerA = L.marker(dotA, { icon: greenIcon }).addTo(_miniMap); }
  }
  if (dotB) {
    if (_miniMarkerB) { _miniMarkerB.setLatLng(dotB); }
    else { _miniMarkerB = L.marker(dotB, { icon: redIcon }).addTo(_miniMap); }
  }

  if (dotA && dotB) {
    if (_miniPolyline) { _miniPolyline.setLatLngs([dotA, dotB]); }
    else { _miniPolyline = L.polyline([dotA, dotB], { color: '#1A1A1A', weight: 3, opacity: 0.7, dashArray: '6 4' }).addTo(_miniMap); }
    _miniMap.fitBounds([dotA, dotB], { padding: [24, 24] });
  } else if (dotA) {
    _miniMap.setView(dotA, 14);
  } else if (dotB) {
    _miniMap.setView(dotB, 14);
  }
}

/* ── Enregistrement vocal admin ───────────────────────────────────────── */
var _mediaRecorder = null;
var _audioChunks   = [];
var _isRecording   = false;

async function toggleRecording() {
  if (_isRecording) { stopRecording(); } else { await startRecording(); }
}

async function startRecording() {
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _audioChunks = [];
    var mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    _mediaRecorder = new MediaRecorder(stream, { mimeType });
    _mediaRecorder.ondataavailable = function (e) { if (e.data.size > 0) _audioChunks.push(e.data); };
    _mediaRecorder.onstop = async function () {
      stream.getTracks().forEach(function (t) { t.stop(); });
      var blob = new Blob(_audioChunks, { type: mimeType });
      await uploadAndSendAudio(blob);
    };
    _mediaRecorder.start();
    _isRecording = true;
    var btn = document.getElementById('cc-mic-btn');
    if (btn) { btn.classList.add('recording'); btn.title = 'Arrêter l\'enregistrement'; }
    // Timer visuel dans l'input
    var input = document.getElementById('cc-reply-input');
    if (input) { input.placeholder = '🔴 Enregistrement en cours…'; input.disabled = true; }
  } catch (e) {
    alert('Microphone non accessible. Vérifiez les permissions du navigateur.');
  }
}

function stopRecording() {
  if (_mediaRecorder && _isRecording) {
    _mediaRecorder.stop();
    _isRecording = false;
    var btn = document.getElementById('cc-mic-btn');
    if (btn) { btn.classList.remove('recording'); btn.title = 'Enregistrer un vocal'; }
    var input = document.getElementById('cc-reply-input');
    if (input) { input.placeholder = 'Répondre au client…'; input.disabled = false; }
  }
}

async function uploadAndSendAudio(blob) {
  if (!_inboxSelectedId) return;
  try {
    var form = new FormData();
    form.append('file', blob, 'vocal_admin_' + Date.now() + '.webm');
    var upRes = await fetch(API + '/api/upload-public', { method: 'POST', body: form });
    if (!upRes.ok) { alert('Erreur upload audio'); return; }
    var upData = await upRes.json();

    var res = await fetch(API + '/api/admin/inbox/' + _inboxSelectedId + '/reply-audio', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ audioUrl: upData.url }),
    });
    if (!res.ok) { alert('Erreur envoi vocal'); return; }

    var container = document.getElementById('cc-messages');
    if (container) {
      var div = document.createElement('div');
      div.className = 'cc-msg admin';
      div.innerHTML = '<audio controls src="' + escHtml(upData.url) + '" style="max-width:220px"></audio>'
        + '<div class="cc-msg-time">maintenant</div>';
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    }
  } catch { alert('Erreur réseau lors de l\'envoi du vocal.'); }
}

async function launchCourse() {
  if (!_inboxSelectedId) return;
  var pickup  = (document.getElementById('cc-pickup').value || '').trim();
  var dropoff = (document.getElementById('cc-dropoff').value || '').trim();
  var priceRaw = (document.getElementById('cc-price').value || '').trim();
  var price = priceRaw ? parseFloat(priceRaw) : null;
  if (!pickup || !dropoff) {
    alert('Veuillez renseigner les adresses de départ et d\'arrivée.');
    return;
  }

  var statusEl = document.getElementById('cc-launch-status');
  statusEl.textContent = 'Lancement en cours…';
  statusEl.className = 'cc-launch-status';

  try {
    var res = await fetch(API + '/api/admin/inbox/' + _inboxSelectedId + '/launch', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ pickupAddress: pickup, dropoffAddress: dropoff, price: price, forwardedAudioUrl: _forwardedAudioUrl || undefined }),
    });
    if (!res.ok) {
      statusEl.textContent = 'Erreur lors du lancement.';
      statusEl.className = 'cc-launch-status error';
      return;
    }
    statusEl.textContent = 'Course envoyée aux livreurs !';
    statusEl.className = 'cc-launch-status success';

    // Retirer la conversation de l'inbox après lancement
    setTimeout(function () {
      closeLaunchPanel();
      _inboxSelectedId = null;
      _forwardedAudioUrl = null;
      document.getElementById('cc-chat-empty').style.display = 'flex';
      document.getElementById('cc-chat-view').style.display = 'none';
      loadInbox();
    }, 1500);
  } catch {
    statusEl.textContent = 'Erreur réseau.';
    statusEl.className = 'cc-launch-status error';
  }
}

/* ── Sélection / enregistrement vocal pour le lancement ──────────────── */
var _forwardedAudioUrl = null;
var _launchRecorder    = null;
var _launchAudioChunks = [];
var _launchIsRecording = false;

function populateLaunchAudios() {
  var listEl = document.getElementById('cc-launch-audio-list');
  if (!listEl) return;
  var clientAudios = _currentMessages.filter(function (m) {
    return m.sender_role !== 'admin' && m.type === 'audio' && m.content;
  });
  if (!clientAudios.length) { listEl.innerHTML = ''; return; }

  listEl.innerHTML = '<div style="font-size:12px;color:var(--text-3);margin-bottom:5px">Vocaux du client :</div>'
    + clientAudios.map(function (m, i) {
      return '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;background:var(--bg);border-radius:8px;padding:6px 8px;border:1.5px solid var(--border)">'
        + '<input type="radio" name="launch-audio" value="' + escHtml(m.content) + '" onchange="selectLaunchAudio(this.value)" />'
        + '<audio src="' + escHtml(m.content) + '" controls style="flex:1;height:28px"></audio>'
        + '<span style="font-size:11px;color:var(--text-3);flex-shrink:0">' + fmtTime(m.createdAt) + '</span>'
        + '</label>';
    }).join('');
}

function selectLaunchAudio(url) {
  _forwardedAudioUrl = url;
  var preview = document.getElementById('cc-launch-audio-preview');
  var player  = document.getElementById('cc-launch-audio-player');
  if (preview) preview.style.display = 'block';
  if (player)  player.src = url;
}

function clearLaunchAudio() {
  _forwardedAudioUrl = null;
  var preview = document.getElementById('cc-launch-audio-preview');
  var player  = document.getElementById('cc-launch-audio-player');
  if (preview) preview.style.display = 'none';
  if (player)  player.src = '';
  document.querySelectorAll('[name="launch-audio"]').forEach(function (r) { r.checked = false; });
}

async function toggleLaunchRecording() {
  if (_launchIsRecording) { stopLaunchRecording(); } else { await startLaunchRecording(); }
}

async function startLaunchRecording() {
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _launchAudioChunks = [];
    var mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    _launchRecorder = new MediaRecorder(stream, { mimeType });
    _launchRecorder.ondataavailable = function (e) { if (e.data.size > 0) _launchAudioChunks.push(e.data); };
    _launchRecorder.onstop = async function () {
      stream.getTracks().forEach(function (t) { t.stop(); });
      await uploadLaunchAudio(new Blob(_launchAudioChunks, { type: mimeType }));
    };
    _launchRecorder.start();
    _launchIsRecording = true;
    var btn = document.getElementById('cc-launch-rec-btn');
    if (btn) { btn.classList.add('recording'); btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:#FF3B30"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0012 6.32V20h-3v2h8v-2h-3v-2.68A7 7 0 0019 11h-2z"/></svg> 🔴 Arrêter l\'enregistrement'; }
  } catch { alert('Microphone non accessible.'); }
}

function stopLaunchRecording() {
  if (_launchRecorder && _launchIsRecording) {
    _launchRecorder.stop();
    _launchIsRecording = false;
    var btn = document.getElementById('cc-launch-rec-btn');
    if (btn) { btn.classList.remove('recording'); btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0012 6.32V20h-3v2h8v-2h-3v-2.68A7 7 0 0019 11h-2z"/></svg> Enregistrer un nouveau vocal'; }
  }
}

async function uploadLaunchAudio(blob) {
  var btn = document.getElementById('cc-launch-rec-btn');
  if (btn) btn.disabled = true;
  try {
    var form = new FormData();
    form.append('file', blob, 'vocal_launch_' + Date.now() + '.webm');
    var upRes = await fetch(API + '/api/upload-public', { method: 'POST', body: form });
    if (!upRes.ok) { alert('Erreur upload audio'); return; }
    var upData = await upRes.json();
    // Décocher les radios client
    document.querySelectorAll('[name="launch-audio"]').forEach(function (r) { r.checked = false; });
    selectLaunchAudio(upData.url);
  } catch { alert('Erreur réseau.'); }
  finally { if (btn) { btn.disabled = false; } }
}

function forwardAudioToDrivers(audioUrl) {
  openLaunchPanel();
  setTimeout(function () {
    selectLaunchAudio(audioUrl);
    document.querySelectorAll('[name="launch-audio"]').forEach(function (r) {
      if (r.value === audioUrl) r.checked = true;
    });
  }, 350);
}

function fmtTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  var now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ================================================================
   TRACKING — Carte GPS des livreurs
================================================================ */
var _trackingMap      = null;
var _trackingMarkers  = {};  // driverId → L.Marker
var _trackingDrivers  = {};  // driverId → { name, status, lat, lng, lastSeen }
var _trackingSelected = null;

function initTrackingMap() {
  if (_trackingMap) return;
  var mapEl = document.getElementById('tracking-map');
  if (!mapEl || typeof L === 'undefined') return;

  // Centré sur Nouakchott, Mauritanie par défaut
  _trackingMap = L.map('tracking-map').setView([18.08, -15.97], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  }).addTo(_trackingMap);
}

function trackingIcon(status) {
  var color = status === 'available' ? '#34C759' : status === 'busy' ? '#FF9500' : '#AEAEB2';
  return L.divIcon({
    className: '',
    html: '<div style="background:' + color + ';width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function updateTrackingMarker(driver) {
  if (!_trackingMap) return;
  if (_trackingMarkers[driver.driverId]) {
    _trackingMarkers[driver.driverId]
      .setLatLng([driver.lat, driver.lng])
      .setIcon(trackingIcon(driver.status || 'available'))
      .getPopup()?.setContent('<b>' + escHtml(driver.name) + '</b><br>Statut : ' + (driver.status || '—'));
  } else {
    var marker = L.marker([driver.lat, driver.lng], { icon: trackingIcon(driver.status || 'available') })
      .addTo(_trackingMap)
      .bindPopup('<b>' + escHtml(driver.name) + '</b><br>Statut : ' + (driver.status || '—'));
    _trackingMarkers[driver.driverId] = marker;
  }
}

function renderTrackingList() {
  var list = document.getElementById('tracking-list');
  if (!list) return;
  var search = (document.getElementById('tracking-search')?.value || '').toLowerCase();
  var drivers = Object.values(_trackingDrivers).filter(function (d) {
    return !search || d.name.toLowerCase().includes(search);
  });

  if (!drivers.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-3);font-size:13px">'
      + (search ? 'Aucun résultat' : 'Aucun livreur en ligne') + '</div>';
    return;
  }

  list.innerHTML = drivers.map(function (d) {
    var dotClass = d.status === 'busy' ? 'busy' : d.lat ? 'online' : 'offline';
    var statusLabel = d.status === 'available' ? 'Disponible' : d.status === 'busy' ? 'En course' : 'Hors ligne';
    var active = _trackingSelected === d.driverId ? ' active' : '';
    return '<div class="tracking-item' + active + '" onclick="focusDriver(\'' + d.driverId + '\')">'
      + '<div class="tracking-dot ' + dotClass + '"></div>'
      + '<div><div class="tracking-item-name">' + escHtml(d.name) + '</div>'
      + '<div class="tracking-item-status">' + statusLabel + '</div></div>'
      + '</div>';
  }).join('');
}

function filterTrackingList() {
  renderTrackingList();
}

function focusDriver(driverId) {
  _trackingSelected = driverId;
  var d = _trackingDrivers[driverId];
  if (d && d.lat && _trackingMap) {
    _trackingMap.setView([d.lat, d.lng], 15);
    _trackingMarkers[driverId]?.openPopup();
  }
  renderTrackingList();
}

async function loadTrackingDrivers() {
  try {
    var res = await fetch(API + '/api/admin/drivers/locations', { headers: authHeaders() });
    if (!res.ok) return;
    var data = await res.json();
    (data.drivers || []).forEach(function (d) {
      _trackingDrivers[d.id] = { driverId: d.id, name: d.name, status: d.status, lat: d.lat, lng: d.lng, lastSeen: d.lastSeen };
      updateTrackingMarker(_trackingDrivers[d.id]);
    });
    renderTrackingList();
  } catch {}
}

/* ================================================================
   UTILISATEURS (admin / call center)
================================================================ */
var _users = [];

async function loadUsers() {
  try {
    var res = await fetch(API + '/api/admin/users', { headers: authHeaders() });
    if (!res.ok) return;
    var data = await res.json();
    _users = data.users || [];
    renderUsers();
  } catch {}
}

function renderUsers() {
  var tbody = document.getElementById('users-tbody');
  if (!tbody) return;
  if (!_users.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-3);padding:20px">Aucun utilisateur</td></tr>';
    return;
  }
  var html = '';
  _users.forEach(function (u, i) {
    var roleTag = u.role === 'call_center'
      ? '<span class="badge badge-blue">Call Center</span>'
      : '<span class="badge badge-green">Admin</span>';
    html += '<tr>'
      + '<td style="color:var(--text-3)">' + (i + 1) + '</td>'
      + '<td style="font-weight:600">' + escHtml(u.name) + '</td>'
      + '<td style="color:var(--text-2)">' + escHtml(u.email) + '</td>'
      + '<td>' + roleTag + '</td>'
      + '<td style="color:var(--text-3)">' + escHtml(u.createdByName || '—') + '</td>'
      + '<td style="color:var(--text-3)">' + fmtDate(u.createdAt) + '</td>'
      + '<td><button class="btn btn-ghost btn-sm" style="color:#FF3B30" onclick="deleteUser(\'' + u.id + '\',\'' + escHtml(u.name) + '\')">Supprimer</button></td>'
      + '</tr>';
  });
  tbody.innerHTML = html;
}

async function createUser() {
  var name     = document.getElementById('new-user-name').value.trim();
  var email    = document.getElementById('new-user-email').value.trim();
  var password = document.getElementById('new-user-password').value;
  var role     = document.getElementById('new-user-role').value;
  var errEl    = document.getElementById('add-user-error');
  errEl.style.display = 'none';

  if (!name || !email || !password) {
    errEl.textContent = 'Tous les champs sont requis.';
    errEl.style.display = 'block';
    return;
  }

  try {
    var res = await fetch(API + '/api/admin/users', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name, email, password, role }),
    });
    if (res.status === 409) {
      errEl.textContent = 'Cet email est déjà utilisé.';
      errEl.style.display = 'block';
      return;
    }
    if (!res.ok) {
      errEl.textContent = 'Erreur lors de la création.';
      errEl.style.display = 'block';
      return;
    }
    var data = await res.json();
    _users.push(data.user);
    renderUsers();
    closeModal('modal-add-user');
    document.getElementById('new-user-name').value = '';
    document.getElementById('new-user-email').value = '';
    document.getElementById('new-user-password').value = '';
    document.getElementById('new-user-role').value = 'call_center';
  } catch {
    errEl.textContent = 'Erreur réseau.';
    errEl.style.display = 'block';
  }
}

function deleteUser(id, name) {
  document.getElementById('confirm-title').textContent   = 'Supprimer ' + name + ' ?';
  document.getElementById('confirm-message').textContent = 'Ce compte sera définitivement supprimé.';
  document.getElementById('confirm-btn').onclick = async function () {
    try {
      await fetch(API + '/api/admin/users/' + id, { method: 'DELETE', headers: authHeaders() });
      _users = _users.filter(function (u) { return u.id !== id; });
      renderUsers();
      closeModal('modal-confirm');
    } catch {}
  };
  showModal('modal-confirm');
}
