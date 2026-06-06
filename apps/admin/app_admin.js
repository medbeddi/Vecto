/* ================================================================
   VECTO — Dashboard Admin · app_admin.js
   Connecté au backend via REST + Socket.IO
================================================================ */

const API = window.location.origin;
let _token = localStorage.getItem('vecto_admin_token');
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
    localStorage.setItem('vecto_admin_token', _token);
    document.getElementById('current-user-label').textContent = data.admin.name + ' · admin';
    showApp();
  } catch {
    errEl.style.display = 'block';
  }
}

function logout() {
  _token = null;
  localStorage.removeItem('vecto_admin_token');
  if (_socket) { _socket.disconnect(); _socket = null; }
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-input').value = '';
  document.getElementById('password-input').value = '';
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  initSocket();
  showPage('p-stats');
  loadStats();
  loadCommandes();
  loadLivreurs();
  loadClients();
  loadTransactions();
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
    fetch(API + '/api/admin/orders/active', { headers: { Authorization: 'Bearer ' + _token } })
      .then(function (r) {
        if (r.ok) {
          const stored = localStorage.getItem('vecto_admin_name') || 'Admin';
          document.getElementById('current-user-label').textContent = stored + ' · admin';
          showApp();
        }
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
  });

  _socket.on('order_taken', function (data) {
    if (_activeOrders[data.deliveryId]) {
      _activeOrders[data.deliveryId]._status = 'assigned';
      renderCommandes();
    }
  });
}

/* ================================================================
   NAVIGATION
================================================================ */
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
  };
  document.getElementById('page-title').textContent = titles[pageId] || '';

  if (pageId === 'p-callcenter' && !_ccMapInitialized) {
    setTimeout(function () { initCCMap(); _ccMapInitialized = true; }, 150);
  }
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

/* ================================================================
   STATS
================================================================ */
async function loadStats() {
  try {
    const res = await fetch(API + '/api/admin/stats', { headers: authHeaders() });
    if (!res.ok) return;
    const d = await res.json();

    document.getElementById('stat-courses').textContent     = d.coursesToday;
    document.getElementById('stat-livreurs').textContent    = d.activeDrivers;
    document.getElementById('stat-revenus').textContent     = fmtMoney(d.totalRevenue);
    document.getElementById('stat-clients').textContent     = d.totalClients;
  } catch {}

  // Tableau récent basé sur les commandes déjà chargées
  renderStatsRecent();
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
  orders.forEach(function (o) {
    var statut = o._status === 'assigned' ? '<span class="badge badge-green">Assignée</span>'
      : '<span class="badge badge-blue">En attente</span>';
    html += '<tr>'
      + '<td style="font-family:monospace;font-size:12px;color:var(--text-2)">' + o.deliveryId.slice(0, 8) + '…</td>'
      + '<td>Course</td>'
      + '<td style="font-weight:600">' + (o.clientAlias || '—') + '</td>'
      + '<td>—</td>'
      + '<td>—</td>'
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
  orders.forEach(function (o) {
    var time = o.createdAt ? new Date(o.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—';
    var canCancel = ['pending', 'assigned'].includes(o._status);
    html += '<tr>'
      + '<td style="font-family:monospace;font-size:12px;color:var(--text-2)">' + o.deliveryId.slice(0, 8) + '…</td>'
      + '<td>Course</td>'
      + '<td style="font-weight:600">' + (o.clientAlias || '—') + '</td>'
      + '<td>—</td>'
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
    // Mise à jour locale immédiate, le backend le fera via le driver
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

async function loadLivreurs() {
  try {
    const res = await fetch(API + '/api/admin/drivers', { headers: authHeaders() });
    if (!res.ok) return;
    const { drivers } = await res.json();
    _livreurs = drivers;
    renderLivreurs();
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
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:24px">Aucun livreur</td></tr>';
    return;
  }
  var html = '';
  _livreurs.forEach(function (l, i) {
    html += '<tr>'
      + '<td style="font-weight:600">' + l.name + '</td>'
      + '<td>' + (STATUT_LIVREUR[l.status] || '') + '</td>'
      + '<td>' + l.courses + '</td>'
      + '<td style="font-weight:600">' + fmtMoney(l.balance) + '</td>'
      + '<td>' + fmtDate(l.createdAt) + '</td>'
      + '<td>' + (l.status !== 'suspended'
          ? '<button class="btn-table red" onclick="suspendLivreur(\'' + l.id + '\',' + i + ')">Suspendre</button>'
          : '<button class="btn-table" onclick="reactivateLivreur(\'' + l.id + '\',' + i + ')">Réactiver</button>') + '</td>'
      + '</tr>';
  });
  tbody.innerHTML = html;
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
  alert('Fonctionnalité à venir : le livreur s\'inscrit lui-même via l\'app et reçoit un SMS OTP.');
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
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:24px">Aucun client trouvé</td></tr>';
    return;
  }
  var html = '';
  data.forEach(function (c, i) {
    html += '<tr>'
      + '<td style="font-weight:600">' + c.alias + '</td>'
      + '<td style="font-weight:600">' + c.commandes + '</td>'
      + '<td>' + fmtDate(c.derniere) + '</td>'
      + '<td>' + fmtDate(c.createdAt) + '</td>'
      + '<td><button class="btn-table" onclick="voirClientDetail(' + i + ')">Voir</button></td>'
      + '</tr>';
  });
  tbody.innerHTML = html;
}

function filterClients() {
  var q = document.getElementById('client-search').value.toLowerCase();
  renderClients(_clients.filter(function (c) {
    return c.alias.toLowerCase().includes(q);
  }));
}

function voirClientDetail(index) {
  var c = _clients[index];
  document.getElementById('client-detail-nom').textContent       = c.alias;
  document.getElementById('client-detail-tel').textContent       = '(Masqué — vie privée)';
  document.getElementById('client-detail-commandes').textContent = c.commandes + ' commandes';
  document.getElementById('client-detail-derniere').textContent  = fmtDate(c.derniere);
  document.getElementById('client-detail-statut').innerHTML      = '<span class="badge badge-green">Actif</span>';
  showModal('modal-client-detail');
}

/* ================================================================
   WALLET
================================================================ */
async function loadTransactions() {
  try {
    const res = await fetch(API + '/api/admin/transactions', { headers: authHeaders() });
    if (!res.ok) return;
    const { transactions } = await res.json();
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
  transactions.forEach(function (t) {
    var positive = t.amount > 0;
    var color  = positive ? '#1a7a35' : '#b86800';
    var sign   = positive ? '+' : '';
    var badge  = t.status === 'completed'
      ? '<span class="badge badge-green">Validé</span>'
      : t.status === 'pending'
        ? '<span class="badge badge-orange">En attente</span>'
        : '<span class="badge badge-red">Échoué</span>';
    html += '<tr>'
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
  var weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  var rechargesWeek = transactions
    .filter(function (t) { return t.type === 'recharge' && t.status === 'completed' && new Date(t.createdAt) >= weekAgo; })
    .reduce(function (s, t) { return s + parseFloat(t.amount); }, 0);
  var commissionsWeek = transactions
    .filter(function (t) { return t.type === 'commission' && t.status === 'completed' && new Date(t.createdAt) >= weekAgo; })
    .reduce(function (s, t) { return s + Math.abs(parseFloat(t.amount)); }, 0);

  var el1 = document.getElementById('wallet-stat-total');
  var el2 = document.getElementById('wallet-stat-recharges');
  var el3 = document.getElementById('wallet-stat-commissions');
  if (el1) el1.textContent = fmtMoney(totalWallet);
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
  // Affiche juste le numéro — les clients sont des pseudos WA
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

var LIVREURS_ACTIFS_MAP = [];

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

  // Placer les livreurs disponibles sur la carte (depuis _livreurs si coords disponibles)
  var nbEl = document.getElementById('cc-nb-livreurs');
  var actifs = _livreurs.filter(function (l) { return l.status === 'available'; });
  if (nbEl) nbEl.textContent = actifs.length + ' livreur(s) disponible(s)';

  var iwLivreur = new google.maps.InfoWindow();
  LIVREURS_ACTIFS_MAP.forEach(function (l) {
    var marker = new google.maps.Marker({
      position: { lat: l.lat, lng: l.lng }, map: map, title: l.nom,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#34C759', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
    });
    marker.addListener('click', function () {
      iwLivreur.setContent('<div style="font-family:sans-serif;padding:4px 2px"><b>' + l.nom + '</b><br><span style="color:#1a7a35;font-size:12px">● Disponible</span></div>');
      iwLivreur.open(map, marker);
    });
  });

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
    map.panTo(_ccDepartLocation);
    calcDistanceCC(); tracerRoute();
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
    map.panTo(_ccDestLocation);
    calcDistanceCC(); tracerRoute();
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
      body: JSON.stringify({ description: description, mediaType: 'text' }),
    });
    if (!res.ok) { alert('Erreur lors de la création de la commande.'); return; }
    const data = await res.json();
    alert('Commande créée ! ID : ' + data.delivery.clientAlias + '\nElle est maintenant visible par tous les livreurs disponibles.');
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
