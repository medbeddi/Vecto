/* ================================================================
   VECTO — Dashboard Admin · app_admin.js
   Connecté au backend via REST + Socket.IO
================================================================ */

const API = window.location.origin;
let _token = localStorage.getItem('vecto_admin_token');
let _role  = localStorage.getItem('vecto_admin_role') || 'admin';
let _socket = null;

/* ── Config tarification ─────────────────────────────────────────── */
// ≤4.5 km → 100 MRU ; sinon +2.5 MRU/tranche de 100 m
// Arrondi : .5 → arrondi inférieur (102.5→100, 112.5→110, 267.5→265)
//           autre → arrondi supérieur
function _prixPourDist(dist) {
  if (dist <= 4.5) return 100;
  // toFixed(6) élimine le bruit virgule flottante de Math.ceil
  var tranches = Math.ceil(+((dist - 4.5) / 0.1).toFixed(6));
  var prixBrut = 100 + tranches * 2.5;
  var rem = prixBrut % 5;
  if (rem === 2.5) return prixBrut - 2.5;
  if (rem === 0)   return prixBrut;
  return prixBrut + (5 - rem);
}

function _autoFillPrice(dist) {
  var priceEl = document.getElementById('cc-price');
  if (priceEl) priceEl.value = _prixPourDist(dist);
}


/* ── Compteurs de notifications ─────────────────────────────────── */
var _navBadgeCC     = 0;   // nouveaux messages Call Center (hors page active)
var _navBadgeOrders = 0;   // nouvelles commandes (hors page active)
var _currentPage    = '';  // page actuellement visible
var _inboxPollTimer = null;
var _msgPollTimer   = null;
var _renderedMsgIds = new Set();

function _updateNavBadge(id, count) {
  var el = document.getElementById(id);
  if (!el) return;
  if (count > 0) { el.textContent = count > 99 ? '99+' : count; el.style.display = 'inline-flex'; }
  else { el.style.display = 'none'; }
}

function _sendBrowserNotif(title, body, tag) {
  if (Notification.permission !== 'granted') return;
  try { new Notification(title, { body: body, tag: tag, icon: '/favicon.ico', silent: false }); } catch {}
}

function _requestNotifPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

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
    _token      = data.token;
    _role       = data.admin.role || 'admin';
    _myAdminId  = data.admin.id;
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
  _requestNotifPermission();

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

  // Charger Google Maps seulement si la clé est valide (test Geocoding avant)
  fetch(API + '/api/admin/config')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(async function (cfg) {
      if (!cfg || !cfg.googleMapsKey) return;
      try {
        var test = await fetch('https://maps.googleapis.com/maps/api/geocode/json?address=Nouakchott&key=' + cfg.googleMapsKey);
        var data = await test.json();
        // REQUEST_DENIED = billing non activé ou clé invalide → ne pas charger
        if (data.status === 'REQUEST_DENIED' || data.status === 'UNKNOWN_ERROR') return;
      } catch (e) { return; }
      // Clé vérifiée → charger Google Maps
      var s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + cfg.googleMapsKey + '&libraries=places&language=fr&callback=onGoogleMapsReady';
      s.async = true; s.defer = true;
      document.head.appendChild(s);
    })
    .catch(function () {});

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
        _role      = storedRole;
        _myAdminId = data.id;
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
    var isNew = !_activeOrders[order.deliveryId];
    // Conserver le _status déjà connu (order_taken peut l'avoir mis à jour)
    order._status = order.status || (isNew ? 'pending' : (_activeOrders[order.deliveryId]._status || 'pending'));
    _activeOrders[order.deliveryId] = order;
    renderCommandes();
    renderStatsRecent();
    // Badge + notification uniquement pour une vraie nouvelle commande
    if (isNew && _currentPage !== 'p-commandes') {
      _navBadgeOrders++;
      _updateNavBadge('nav-badge-orders', _navBadgeOrders);
    }
    if (isNew) {
      _sendBrowserNotif(
        '🛵 Nouvelle commande',
        'Course de ' + (order.clientAlias || 'Client'),
        'order-' + order.deliveryId
      );
    }
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
      status: data.status, isAvailable: data.isAvailable,
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

  // Changement de disponibilité livreur en temps réel
  _socket.on('driver_availability', function (data) {
    if (_trackingDrivers[data.driverId]) {
      _trackingDrivers[data.driverId].isAvailable = data.isAvailable;
      updateTrackingMarker(_trackingDrivers[data.driverId]);
    }
    renderTrackingList();
  });


  // Nouveau message texte WA → call center
  _socket.on('incoming_text', function (data) {
    if (_inboxSubTab === 'pending') loadInbox();
    // Si la conversation est déjà ouverte, ajouter le message en temps réel
    if (_inboxSelectedId === data.deliveryId && data.message) {
      var container = document.getElementById('cc-messages');
      if (container) {
        var msgId = data.message.id;
        if (!msgId || !_renderedMsgIds.has(msgId)) {
          if (msgId) _renderedMsgIds.add(msgId);
          container.insertAdjacentHTML('beforeend', _buildMsgBody(data.message));
          container.scrollTop = container.scrollHeight;
        }
      }
    }
    // Badge nav + notification navigateur si on n'est pas sur le CC
    if (_currentPage !== 'p-callcenter') {
      _navBadgeCC++;
      _updateNavBadge('nav-badge-cc', _navBadgeCC);
    }
    var preview = data.message && data.message.type === 'text' ? data.message.content : '🎤 Message vocal';
    _sendBrowserNotif(
      '💬 ' + (data.clientAlias || 'Client'),
      preview || 'Nouveau message',
      'msg-' + data.deliveryId
    );
  });

  // Réponse livreur → badge nav CC si on n'est pas sur le CC
  _socket.on('driver_reply_to_cc', function (data) {
    if (_ccActiveTab === 'drivers' && _selectedDriverId === data.driverId && _currentPage === 'p-callcenter') {
      appendDriverChatMessage(data.message);
    } else {
      _driverChatUnread++;
      var badge = document.getElementById('cc-driver-unread-badge');
      if (badge) { badge.textContent = _driverChatUnread; badge.style.display = 'inline-flex'; }
      if (_currentPage !== 'p-callcenter') {
        _navBadgeCC++;
        _updateNavBadge('nav-badge-cc', _navBadgeCC);
      }
      _sendBrowserNotif('💬 Livreur', data.message.content || 'Nouveau message', 'driver-' + data.driverId);
    }
  });

  // Une conversation a été prise par un autre agent CC → la retirer de notre inbox
  _socket.on('conversation_claimed', function (data) {
    if (data.claimedBy === _myAdminId) return; // c'est nous qui l'avons claimée
    if (_inboxItems[data.deliveryId]) {
      delete _inboxItems[data.deliveryId];
      // Si c'était la conversation ouverte, fermer le panneau
      if (_inboxSelectedId === data.deliveryId) {
        _inboxSelectedId = null;
        document.getElementById('cc-chat-empty').style.display = '';
        document.getElementById('cc-chat-view').style.display = 'none';
        closeLaunchPanel();
      }
      // Re-rendre la liste sans cet élément
      renderInboxList(Object.values(_inboxItems));
    }
  });

  // Une conversation a été libérée → recharger l'inbox
  _socket.on('conversation_unclaimed', function () {
    if (_inboxSubTab === 'pending') loadInbox();
  });

  // Tous les livreurs disponibles ont refusé une course
  _socket.on('all_drivers_refused', function (data) {
    // Si le panneau de lancement est ouvert pour cette course, afficher le badge
    if (_inboxSelectedId === data.deliveryId) {
      var badge = document.getElementById('cc-launch-refused-badge');
      if (badge) badge.style.display = '';
    }
    // Notification discrète dans la liste
    if (_inboxItems[data.deliveryId]) {
      _inboxItems[data.deliveryId]._allRefused = true;
      if (_inboxSubTab === 'pending') renderInboxList(Object.values(_inboxItems));
    }
  });
}

/* ================================================================
   NAVIGATION
================================================================ */
var _ccActiveTab = 'clients';
var _selectedDriverId = null;
var _selectedDriverName = null;
var _selectedDriverPhone = null;
var _driverChatUnread = 0;
var _driverMicRecorder = null;
var _driverMicChunks = [];
var _driverMsgIds = new Set();
var _driverChatPollTimer = null;
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
    'p-tracking': 'Tracking Livreurs', 'p-users': 'Utilisateurs', 'p-config': 'Configurer',
  };
  document.getElementById('page-title').textContent = titles[pageId] || '';
  _currentPage = pageId;

  // Effacer le badge de la page qu'on ouvre
  if (pageId === 'p-callcenter') {
    _navBadgeCC = 0; _updateNavBadge('nav-badge-cc', 0);
    showCCTab(_ccActiveTab);
    // Polling inbox toutes les 5s quand on est sur le CC
    if (_inboxPollTimer) clearInterval(_inboxPollTimer);
    _inboxPollTimer = setInterval(function () {
      if (_currentPage === 'p-callcenter' && _inboxSubTab === 'pending') loadInbox();
    }, 5000);
  } else {
    if (_inboxPollTimer) { clearInterval(_inboxPollTimer); _inboxPollTimer = null; }
    stopDriverChatPolling();
    stopMsgPolling();
  }
  if (pageId === 'p-commandes') {
    _navBadgeOrders = 0; _updateNavBadge('nav-badge-orders', 0);
  }
  if (pageId === 'p-tracking') {
    setTimeout(function () {
      initTrackingMap();
      loadTrackingDrivers();
    }, 100);
  }
  if (pageId === 'p-config') {
    loadConfigPage();
  }
}

/* ================================================================
   CALL CENTER — onglets Clients / Livreurs
================================================================ */

function showCCTab(tab) {
  _ccActiveTab = tab;
  var clientsPanel  = document.getElementById('cc-clients-panel');
  var driversPanel  = document.getElementById('cc-drivers-panel');
  var newcallPanel  = document.getElementById('cc-newcall-panel');
  var tabClients    = document.getElementById('cc-tab-clients');
  var tabDrivers    = document.getElementById('cc-tab-drivers');
  var tabNewcall    = document.getElementById('cc-tab-newcall');
  if (!clientsPanel) return;

  clientsPanel.style.display = tab === 'clients'  ? '' : 'none';
  driversPanel.style.display = tab === 'drivers'  ? '' : 'none';
  if (newcallPanel) newcallPanel.style.display = tab === 'newcall' ? '' : 'none';
  tabClients.classList.toggle('active', tab === 'clients');
  tabDrivers.classList.toggle('active', tab === 'drivers');
  if (tabNewcall) tabNewcall.classList.toggle('active', tab === 'newcall');

  if (tab === 'clients') {
    loadInbox();
  } else if (tab === 'drivers') {
    loadDriversChatList();
    _driverChatUnread = 0;
    var badge = document.getElementById('cc-driver-unread-badge');
    if (badge) badge.style.display = 'none';
  } else if (tab === 'newcall') {
    initNCMap();
    if (_googlePlacesReady) initNCPlaces();
    var phoneEl = document.getElementById('nc-phone');
    if (phoneEl && !phoneEl.value) phoneEl.value = '+222';
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
    var phone = (d.phone || '').replace(/'/g, "\\'");
    return '<div class="cc-inbox-item' + (isActive ? ' active' : '') + '" onclick="selectDriverChat(\'' + d.id + '\',\'' + (d.name || '').replace(/'/g, "\\'") + '\',\'' + phone + '\')">'
      + '<div class="cc-inbox-alias">' + escHtml(d.name) + '</div>'
      + '<div class="cc-inbox-preview">' + dot + ' ' + statusLabel + '</div>'
      + '</div>';
  }).join('');
}

function selectDriverChat(driverId, driverName, driverPhone) {
  _selectedDriverId   = driverId;
  _selectedDriverName = driverName;
  _selectedDriverPhone = driverPhone || null;
  _driverMsgIds = new Set();
  document.getElementById('cc-driver-chat-empty').style.display = 'none';
  document.getElementById('cc-driver-chat-view').style.display  = 'flex';
  document.getElementById('cc-driver-chat-name').textContent    = driverName;
  var callBtn = document.getElementById('cc-driver-call-btn');
  if (callBtn) callBtn.style.display = driverPhone ? 'flex' : 'none';
  loadDriversChatList();
  loadDriverChatMessages(driverId);
  startDriverChatPolling();
}

function callDriver() {
  if (!_selectedDriverPhone || !_selectedDriverId) return;
  // Enregistrer l'appel dans le chat avant d'ouvrir le téléphone
  fetch(API + '/api/admin/driver-chat/' + _selectedDriverId, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ content: 'Appel vers le livreur', type: 'call' }),
  })
    .then(function(r) { return r.json(); })
    .then(function(d) { if (d.message) appendDriverChatMessage(d.message); })
    .catch(function() {});
  window.open('tel:' + _selectedDriverPhone, '_self');
}

function loadDriverChatMessages(driverId) {
  fetch(API + '/api/admin/driver-chat/' + driverId, { headers: { 'Authorization': 'Bearer ' + _token } })
    .then(function (r) { return r.json(); })
    .then(function (data) { renderDriverChatMessages(data.messages || []); })
    .catch(function () {});
}

function _imgErr(img) {
  var span = document.createElement('span');
  span.style.cssText = 'opacity:.5;font-size:13px';
  span.textContent = 'Image non disponible';
  if (img.parentNode) img.parentNode.replaceChild(span, img);
}

function _driverMsgBubble(m) {
  var isOut = m.senderRole === 'admin';
  var type  = m.type || 'text';
  var inner = '';
  if (type === 'audio') {
    var uid = 'aud_' + m.id.replace(/-/g,'');
    inner = '<div class="cc-audio-wrap">'
          + '<button class="cc-audio-btn" onclick="toggleAudioMsg(\'' + uid + '\')">'
          + '<span class="cc-audio-icon" id="ico_' + uid + '">▶</span>'
          + '</button>'
          + '<div class="cc-audio-body">'
          + '<div class="cc-audio-wave">'
          + '<span class="cc-audio-bar h2"></span><span class="cc-audio-bar h3"></span><span class="cc-audio-bar h4"></span>'
          + '<span class="cc-audio-bar h2"></span><span class="cc-audio-bar h3"></span><span class="cc-audio-bar h1"></span>'
          + '<span class="cc-audio-bar h4"></span><span class="cc-audio-bar h3"></span><span class="cc-audio-bar h2"></span>'
          + '<span class="cc-audio-bar h1"></span><span class="cc-audio-bar h3"></span><span class="cc-audio-bar h2"></span>'
          + '</div>'
          + '<span class="cc-audio-dur" id="dur_' + uid + '">0:00</span>'
          + '</div>'
          + '</div>'
          + '<audio id="' + uid + '" src="' + escHtml(m.content) + '" preload="metadata" style="display:none"'
          + ' onloadedmetadata="(function(){var s=Math.round(this.duration)||0,el=document.getElementById(\'dur_' + uid + '\');if(el&&s>0)el.textContent=Math.floor(s/60)+\':\'+String(s%60).padStart(2,\'0\')}).call(this)"></audio>';
  } else if (type === 'image') {
    inner = '<img src="' + escHtml(m.content) + '" class="cc-msg-img" onerror="_imgErr(this)" onclick="openImgModal(this.src)" style="cursor:pointer" />';
  } else if (type === 'call') {
    return '<div class="cc-msg-wrap cc-msg-system-wrap">'
      + '<div class="cc-msg-system-bubble">📞 ' + escHtml(m.content || 'Appel') + ' · ' + fmtTime(m.createdAt) + '</div>'
      + '</div>';
  } else {
    inner = '<div class="cc-msg-text">' + escHtml(m.content) + '</div>';
  }
  var tmpAttr = (m.id && m.id.startsWith('tmp_')) ? ' data-tmpid="' + m.id + '"' : '';
  var avatar = isOut ? '' : '<img src="moto.svg" style="width:22px;height:22px;object-fit:contain;flex-shrink:0;margin-right:6px;margin-top:4px;opacity:.85" />';
  return '<div class="cc-msg-wrap ' + (isOut ? 'cc-msg-out' : 'cc-msg-in') + '"' + tmpAttr + ' style="' + (isOut ? '' : 'align-items:flex-start') + '">'
    + (isOut ? '' : avatar)
    + '<div class="cc-msg-bubble ' + (isOut ? 'cc-msg-bubble-out' : 'cc-msg-bubble-in') + '">'
    + inner
    + '<div class="cc-msg-time">' + fmtTime(m.createdAt) + '</div>'
    + '</div></div>';
}

function toggleAudioMsg(uid) {
  var audio = document.getElementById(uid);
  if (!audio) return;
  if (audio.paused) {
    document.querySelectorAll('audio').forEach(function(a) {
      if (a.id !== uid && !a.paused) {
        a.pause();
        var ic = document.getElementById('ico_' + a.id);
        if (ic) ic.textContent = '▶';
      }
    });
    audio.play().catch(function() {});
    var icon = document.getElementById('ico_' + uid);
    if (icon) icon.textContent = '⏸';
    audio.onended = function() {
      var ic2 = document.getElementById('ico_' + uid);
      if (ic2) ic2.textContent = '▶';
    };
  } else {
    audio.pause();
    var icon2 = document.getElementById('ico_' + uid);
    if (icon2) icon2.textContent = '▶';
  }
}

function renderDriverChatMessages(messages) {
  var container = document.getElementById('cc-driver-messages');
  if (!container) return;
  _driverMsgIds = new Set(messages.map(function(m) { return m.id; }));
  container.innerHTML = messages.map(_driverMsgBubble).join('');
  container.scrollTop = container.scrollHeight;
}

function appendDriverChatMessage(msg) {
  if (_driverMsgIds.has(msg.id)) return;
  var container = document.getElementById('cc-driver-messages');
  if (!container) return;
  container.insertAdjacentHTML('beforeend', _driverMsgBubble(msg));
  _driverMsgIds.add(msg.id);
  requestAnimationFrame(function() { container.scrollTop = container.scrollHeight; });
}

function startDriverChatPolling() {
  stopDriverChatPolling();
  _driverChatPollTimer = setInterval(function() {
    if (!_selectedDriverId) return;
    fetch(API + '/api/admin/driver-chat/' + _selectedDriverId, { headers: { 'Authorization': 'Bearer ' + _token } })
      .then(function(r) { return r.json(); })
      .then(function(data) { (data.messages || []).forEach(appendDriverChatMessage); })
      .catch(function() {});
  }, 5000);
}

function stopDriverChatPolling() {
  if (_driverChatPollTimer) { clearInterval(_driverChatPollTimer); _driverChatPollTimer = null; }
}

async function sendDriverChatMsg(content, type) {
  var input = document.getElementById('cc-driver-reply-input');
  if (!content) { content = input ? input.value.trim() : ''; }
  if (!type) type = 'text';
  if (!content || !_selectedDriverId) return;
  if (input) input.value = '';

  // Affichage optimiste : montrer la bulle immédiatement sans attendre l'API
  var tempId = 'tmp_' + Date.now();
  var tempMsg = { id: tempId, senderRole: 'admin', type: type, content: content, createdAt: new Date().toISOString() };
  appendDriverChatMessage(tempMsg);

  try {
    var res = await fetch(API + '/api/admin/driver-chat/' + _selectedDriverId, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ content: content, type: type }),
    });
    if (!res.ok) return;
    var data = await res.json();
    // Remplacer la bulle temporaire par le vrai message (avec l'ID réel)
    _driverMsgIds.delete(tempId);
    var tmpEl = document.querySelector('[data-tmpid="' + tempId + '"]');
    if (tmpEl) tmpEl.remove();
    appendDriverChatMessage(data.message);
  } catch {
    // En cas d'erreur, marquer la bulle temporaire
    var tmpEl2 = document.querySelector('[data-tmpid="' + tempId + '"]');
    if (tmpEl2) tmpEl2.style.opacity = '0.4';
  }
}

async function toggleDriverMic() {
  var btn = document.getElementById('cc-driver-mic-btn');
  if (_driverMicRecorder && _driverMicRecorder.state === 'recording') {
    _driverMicRecorder.stop();
    return;
  }
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _driverMicChunks = [];
    _driverMicRecorder = new MediaRecorder(stream);
    _driverMicRecorder.ondataavailable = function(e) { if (e.data.size > 0) _driverMicChunks.push(e.data); };
    _driverMicRecorder.onstop = async function() {
      btn.classList.remove('recording');
      stream.getTracks().forEach(function(t) { t.stop(); });
      var blob = new Blob(_driverMicChunks, { type: 'audio/webm' });
      var fd = new FormData();
      fd.append('file', blob, 'voice.webm');
      try {
        var r = await fetch(API + '/api/admin/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + _token }, body: fd });
        var d = await r.json();
        if (d.url) await sendDriverChatMsg(d.url, 'audio');
      } catch {}
      _driverMicRecorder = null;
    };
    _driverMicRecorder.start();
    btn.classList.add('recording');
  } catch {
    alert('Permission microphone refusée.');
  }
}

/* ================================================================
   PAGE CONFIGURER
================================================================ */
async function loadConfigPage() {
  try {
    var r = await fetch(API + '/api/admin/settings/creneau', { headers: authHeaders() });
    if (r.ok) {
      var d = await r.json();
      var el = document.getElementById('config-creneau');
      if (el) el.value = d.duree_min;
    }
  } catch {}
}

async function saveCreneauConfig() {
  var el = document.getElementById('config-creneau');
  var statusEl = document.getElementById('creneau-status');
  var val = parseInt(el ? el.value : '', 10);
  if (!val || val < 1 || val > 60) {
    if (statusEl) { statusEl.textContent = 'Valeur invalide (1–60 min).'; statusEl.style.color = '#FF3B30'; }
    return;
  }
  try {
    var r = await fetch(API + '/api/admin/settings/creneau', {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ duree_min: val }),
    });
    if (!r.ok) throw new Error();
    if (statusEl) { statusEl.textContent = 'Sauvegardé !'; statusEl.style.color = '#34C759'; }
    setTimeout(function () { if (statusEl) statusEl.textContent = ''; }, 2000);
  } catch {
    if (statusEl) { statusEl.textContent = 'Erreur réseau.'; statusEl.style.color = '#FF3B30'; }
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

  var q = ((document.getElementById('commande-search') || {}).value || '').toLowerCase();
  var orders = Object.values(_activeOrders);
  if (_currentFilter !== 'all') {
    orders = orders.filter(function (o) { return o._status === _currentFilter; });
  }
  if (q) {
    orders = orders.filter(function (o) {
      return (o.clientAlias || '').toLowerCase().includes(q)
          || (o.deliveryId || '').toLowerCase().includes(q);
    });
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
  document.getElementById('confirm-btn').onclick = async function () {
    closeModal('modal-confirm');
    try {
      const r = await fetch(API + '/api/admin/orders/' + id + '/cancel', {
        method: 'PATCH',
        headers: authHeaders(),
      });
      if (!r.ok) {
        var err = await r.json().catch(() => ({}));
        alert('Erreur : ' + (err.error || r.status));
        return;
      }
      delete _activeOrders[id];
      renderCommandes();
    } catch (e) {
      alert('Erreur réseau : ' + e.message);
    }
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
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-3);padding:24px">Aucun livreur</td></tr>';
    return;
  }
  var html = '';
  _livreurs.forEach(function (l, i) {
    html += '<tr>'
      + '<td style="font-weight:700;color:var(--text-2)">#' + (i + 1) + '</td>'
      + '<td style="font-weight:600">' + escHtml(l.name) + '</td>'
      + '<td style="color:var(--text-2);font-size:13px">' + (l.phone || '—') + '</td>'
      + '<td>' + (STATUT_LIVREUR[l.status] || '') + '</td>'
      + '<td>' + l.courses + '</td>'
      + '<td style="font-weight:600">' + fmtMoney(l.balance) + '</td>'
      + '<td>' + fmtDate(l.createdAt) + '</td>'
      + '<td style="display:flex;gap:4px;flex-wrap:wrap">'
        + '<button class="btn-table" onclick="openDriverProfile(\'' + l.id + '\')">Profil</button>'
        + '<button class="btn-table" onclick="openEditDriver(\'' + l.id + '\',' + i + ')">Modifier</button>'
        + (l.status !== 'suspended'
          ? '<button class="btn-table red" onclick="suspendLivreur(\'' + l.id + '\',' + i + ')">Suspendre</button>'
          : '<button class="btn-table" onclick="reactivateLivreur(\'' + l.id + '\',' + i + ')">Réactiver</button>')
      + '</td>'
      + '</tr>';
  });
  tbody.innerHTML = html;
}

function filterLivreurs() {
  var q = (document.getElementById('livreur-search').value || '').toLowerCase();
  var tbody = document.getElementById('livreurs-tbody');
  if (!tbody) return;
  var list = q
    ? _livreurs.filter(function (l) {
        return l.name.toLowerCase().includes(q) || (l.phone && l.phone.includes(q));
      })
    : _livreurs;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-3);padding:24px">Aucun livreur trouvé</td></tr>';
    return;
  }
  var html = '';
  list.forEach(function (l, i) {
    html += '<tr>'
      + '<td style="font-weight:700;color:var(--text-2)">#' + (i + 1) + '</td>'
      + '<td style="font-weight:600">' + escHtml(l.name) + '</td>'
      + '<td style="color:var(--text-2);font-size:13px">' + (l.phone || '—') + '</td>'
      + '<td>' + (STATUT_LIVREUR[l.status] || '') + '</td>'
      + '<td>' + l.courses + '</td>'
      + '<td style="font-weight:600">' + fmtMoney(l.balance) + '</td>'
      + '<td>' + fmtDate(l.createdAt) + '</td>'
      + '<td style="display:flex;gap:4px;flex-wrap:wrap">'
        + '<button class="btn-table" onclick="openDriverProfile(\'' + l.id + '\')">Profil</button>'
        + '<button class="btn-table" onclick="openEditDriver(\'' + l.id + '\',' + _livreurs.indexOf(l) + ')">Modifier</button>'
        + (l.status !== 'suspended'
          ? '<button class="btn-table red" onclick="suspendLivreur(\'' + l.id + '\',' + _livreurs.indexOf(l) + ')">Suspendre</button>'
          : '<button class="btn-table" onclick="reactivateLivreur(\'' + l.id + '\',' + _livreurs.indexOf(l) + ')">Réactiver</button>')
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

// ── Profil complet (documents) ────────────────────────────────────────────────
var _profileDriverId = null;
var _pendingDocField = null;

async function openDriverProfile(id) {
  _profileDriverId = id;
  var titleEl = document.getElementById('profile-modal-title');
  var subEl   = document.getElementById('profile-modal-sub');
  if (titleEl) titleEl.textContent = 'Chargement…';
  if (subEl)   subEl.style.cssText = 'color:var(--text-3);font-size:13px;margin-bottom:16px';
  if (subEl)   subEl.textContent   = '';
  showModal('modal-driver-profile');
  try {
    var res = await fetch(API + '/api/admin/drivers/' + id + '/documents', { headers: authHeaders() });
    if (!res.ok) {
      var errData = await res.json().catch(function() { return {}; });
      if (titleEl) titleEl.textContent = 'Erreur ' + res.status;
      if (subEl) { subEl.style.color = '#c0392b'; subEl.textContent = errData.error || 'Impossible de charger ce profil.'; }
      return;
    }
    var data = await res.json();
    var driver = data.driver || {};
    if (titleEl) titleEl.textContent = driver.name || '—';
    if (subEl)   subEl.style.cssText = 'color:var(--text-3);font-size:13px;margin-bottom:16px';
    if (subEl)   subEl.textContent   = driver.phone || '';
    var matEl = document.getElementById('profile-matricule');
    if (matEl) matEl.value = driver.matricule || '';
    var fields = ['photo_driver', 'carte_grise_front', 'carte_grise_back', 'carte_identite_front', 'carte_identite_back', 'photo_vehicule'];
    fields.forEach(function(f) { _setDocThumb(f, driver[f]); });
  } catch (err) {
    console.error('[openDriverProfile]', err);
    if (titleEl) titleEl.textContent = 'Erreur réseau';
    if (subEl) { subEl.style.color = '#c0392b'; subEl.textContent = err && err.message ? err.message : 'Connexion impossible.'; }
  }
}

function _setDocThumb(field, url) {
  var thumb = document.getElementById('thumb-' + field);
  var ph    = document.getElementById('ph-' + field);
  if (!thumb) return;
  if (url) {
    thumb.src = url; thumb.style.display = 'block';
    if (ph) ph.style.display = 'none';
  } else {
    thumb.style.display = 'none';
    if (ph) ph.style.display = 'flex';
  }
}

function uploadDocForDriver(field) {
  _pendingDocField = field;
  var inp = document.getElementById('admin-doc-file-input');
  inp.value = '';
  inp.click();
}

async function handleAdminDocFile(input) {
  if (!input.files || !input.files[0]) return;
  var field = _pendingDocField;
  if (!field || !_profileDriverId) return;
  var file = input.files[0];
  var btn = document.querySelector('button[onclick="uploadDocForDriver(\'' + field + '\')"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Upload…'; }
  try {
    var fd = new FormData();
    fd.append('file', file);
    var upRes = await fetch(API + '/api/admin/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + _token },
      body: fd,
    });
    if (!upRes.ok) { alert('Erreur upload.'); return; }
    var { url } = await upRes.json();
    var patch = {}; patch[field] = url;
    var patchRes = await fetch(API + '/api/admin/drivers/' + _profileDriverId + '/documents', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(patch),
    });
    if (!patchRes.ok) { alert('Erreur sauvegarde.'); return; }
    _setDocThumb(field, url);
  } catch {
    alert('Erreur réseau lors de l\'upload.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg> Choisir / Photographier';
    }
  }
}

async function saveDriverProfile() {
  if (!_profileDriverId) return;
  var matricule = document.getElementById('profile-matricule').value.trim();
  var btn = document.getElementById('btn-save-driver-profile');
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    var res = await fetch(API + '/api/admin/drivers/' + _profileDriverId + '/documents', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ matricule: matricule }),
    });
    if (!res.ok) { alert('Erreur lors de l\'enregistrement.'); return; }
    closeModal('modal-driver-profile');
  } catch {
    alert('Erreur réseau.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer le matricule'; }
  }
}

async function saveDriver() {
  const name   = document.getElementById('edit-driver-name').value.trim();
  const pwdEl  = document.getElementById('edit-driver-pwd');
  const pwd    = pwdEl ? (pwdEl.value || '').replace(/\D/g, '').slice(0, 4) : '';
  if (!name) return;
  if (pwd && !/^\d{4}$/.test(pwd)) {
    alert('Mot de passe : exactement 4 chiffres.');
    return;
  }
  try {
    const res = await fetch(API + '/api/admin/drivers/' + _editDriverId, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ name }),
    });
    if (!res.ok) { alert('Erreur lors de la modification.'); return; }
    if (pwd) {
      const resPwd = await fetch(API + '/api/admin/drivers/' + _editDriverId + '/reset-password', {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ password: pwd }),
      });
      if (!resPwd.ok) { alert('Nom enregistré mais erreur lors du changement de mot de passe.'); }
    }
    const idx = _livreurs.findIndex(function (l) { return l.id === _editDriverId; });
    if (idx !== -1) _livreurs[idx].name = name;
    renderLivreurs();
    document.getElementById('edit-driver-pwd').value = '';
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

async function addLivreur() {
  var name     = (document.getElementById('add-livreur-name').value || '').trim();
  var phone    = (document.getElementById('add-livreur-phone').value || '').trim();
  var password = (document.getElementById('add-livreur-pass').value || '').trim();
  var errEl    = document.getElementById('add-livreur-error');
  errEl.style.display = 'none';
  if (!name || name.length < 2) { errEl.textContent = 'Nom trop court.'; errEl.style.display = 'block'; return; }
  if (!phone || phone.length < 8) { errEl.textContent = 'Numéro invalide.'; errEl.style.display = 'block'; return; }
  if (!password || !/^\d{4}$/.test(password)) { errEl.textContent = 'Mot de passe : exactement 4 chiffres.'; errEl.style.display = 'block'; return; }
  var btn = document.getElementById('btn-add-livreur');
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    var res = await fetch(API + '/api/admin/drivers', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name, phone, password }),
    });
    var data = await res.json();
    if (!res.ok) {
      var msg = data.error === 'PHONE_ALREADY_USED' ? 'Ce numéro est déjà utilisé.' : 'Erreur création compte.';
      errEl.textContent = msg; errEl.style.display = 'block'; return;
    }
    _livreurs.unshift(data.driver);
    renderLivreurs();
    closeModal('modal-add-livreur');
    document.getElementById('add-livreur-name').value = '';
    document.getElementById('add-livreur-phone').value = '';
    document.getElementById('add-livreur-pass').value = '';
  } catch {
    errEl.textContent = 'Erreur réseau.'; errEl.style.display = 'block';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Créer le compte'; }
  }
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
      + '<td style="font-weight:600">' + escHtml(c.alias) + '</td>'
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

var _clientDetailIndex = -1;

function voirClientDetail(index) {
  _clientDetailIndex = index;
  var c = _clients[index];
  document.getElementById('client-detail-num').textContent       = '#' + c.num;
  document.getElementById('client-detail-nom').textContent       = c.alias;
  document.getElementById('client-detail-tel').textContent       = c.phone ? fmtPhone(c.phone) : 'Non disponible';
  document.getElementById('client-detail-commandes').textContent = c.commandes + ' commandes';
  document.getElementById('client-detail-derniere').textContent  = fmtDate(c.derniere);
  document.getElementById('client-detail-statut').innerHTML      = '<span class="badge badge-green">Actif</span>';
  cancelClientNameEdit();
  showModal('modal-client-detail');
}

function editClientName() {
  var c = _clients[_clientDetailIndex];
  if (!c) return;
  document.getElementById('client-name-input').value = c.alias;
  document.getElementById('client-name-edit').style.display = 'block';
  document.getElementById('btn-edit-client-name').style.display = 'none';
  document.getElementById('client-name-input').focus();
}

function cancelClientNameEdit() {
  document.getElementById('client-name-edit').style.display = 'none';
  document.getElementById('btn-edit-client-name').style.display = '';
}

async function saveClientAlias() {
  var c = _clients[_clientDetailIndex];
  if (!c) return;
  var newAlias = (document.getElementById('client-name-input').value || '').trim();
  if (!newAlias) return;
  try {
    var res = await fetch(API + '/api/admin/clients/' + c.id + '/alias', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias: newAlias }),
    });
    if (!res.ok) { alert('Erreur lors de la sauvegarde.'); return; }
    _clients[_clientDetailIndex].alias = newAlias;
    document.getElementById('client-detail-nom').textContent = newAlias;
    cancelClientNameEdit();
    renderClients(_clients);
  } catch { alert('Erreur réseau.'); }
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
      + '<td style="font-weight:600">' + escHtml(t.driverName) + '</td>'
      + '<td>' + escHtml(t.type) + '</td>'
      + '<td>' + escHtml(t.description || '—') + '</td>'
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

/* ── Nouvel appel : état ────────────────────────────────────────── */
var _ncPickupCoords  = null;   // [lat, lng]
var _ncDropoffCoords = null;   // [lat, lng]
var _ncFoundClient   = null;   // { id, alias, phone } ou null
var _ncLeafletMap    = null;
var _ncPickupMarker  = null;
var _ncDropoffMarker = null;
var _ncDebounce      = null;
var _ncAudioUrl      = null;
var _ncRecorder      = null;
var _ncAudioChunks   = [];
var _ncIsRecording   = false;

async function searchNCClient() {
  var phone = (document.getElementById('nc-phone')?.value || '').trim();
  if (!phone) return;
  var banner = document.getElementById('nc-client-banner');
  var aliasEl = document.getElementById('nc-client-alias');
  var subEl   = document.getElementById('nc-client-sub');
  var dotEl   = document.getElementById('nc-client-dot');
  if (banner) banner.style.display = 'none';
  try {
    var res = await fetch(API + '/api/admin/clients/search?phone=' + encodeURIComponent(phone), { headers: authHeaders() });
    var data = await res.json();
    if (data.found) {
      _ncFoundClient = data.client;
      if (aliasEl) aliasEl.textContent = data.client.alias;
      if (subEl)   subEl.textContent   = 'Client existant · ' + (data.client.phone || phone);
      if (dotEl)   dotEl.style.background = '#34C759';
    } else {
      _ncFoundClient = null;
      if (aliasEl) aliasEl.textContent = 'Nouveau client';
      if (subEl)   subEl.textContent   = 'Sera créé avec ce numéro : ' + phone;
      if (dotEl)   dotEl.style.background = '#FF9500';
    }
    if (banner) banner.style.display = 'flex';
  } catch {
    if (aliasEl) aliasEl.textContent = 'Erreur réseau';
    if (subEl)   subEl.textContent   = '';
    if (banner)  banner.style.display = 'flex';
  }
}

function clearNCClient() {
  _ncFoundClient = null;
  var phoneEl = document.getElementById('nc-phone');
  if (phoneEl) phoneEl.value = '+222';
  var banner = document.getElementById('nc-client-banner');
  if (banner) banner.style.display = 'none';
}

function debounceNCMap() {
  if (_googlePlacesReady) return;  // Google Places gère les coords
  clearTimeout(_ncDebounce);
  _ncDebounce = setTimeout(updateNCMap, 700);
}

async function updateNCMap() {
  var pickup  = (document.getElementById('nc-pickup')?.value  || '').trim();
  var dropoff = (document.getElementById('nc-dropoff')?.value || '').trim();
  async function geocode(addr) {
    try {
      var r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=mr&q=' + encodeURIComponent(addr));
      var d = await r.json();
      return d[0] ? [parseFloat(d[0].lat), parseFloat(d[0].lon)] : null;
    } catch { return null; }
  }
  if (pickup)  { var c = await geocode(pickup);  if (c) { _ncPickupCoords  = c; _autoFillNCPrice(); refreshNCMapMarkers(); } }
  if (dropoff) { var c2 = await geocode(dropoff); if (c2) { _ncDropoffCoords = c2; _autoFillNCPrice(); refreshNCMapMarkers(); } }
}

function _autoFillNCPrice() {
  if (!_ncPickupCoords || !_ncDropoffCoords) return;
  _routeDistKm(_ncPickupCoords, _ncDropoffCoords, function(distKm) {
    var priceEl = document.getElementById('nc-price');
    if (priceEl && !priceEl.value) priceEl.value = _prixPourDist(distKm);
  });
}

/* ── Vocal Nouvel appel ─────────────────────────────────────────── */
function selectNCAudio(url) {
  _ncAudioUrl = url;
  var preview = document.getElementById('nc-audio-preview');
  var player  = document.getElementById('nc-audio-player');
  if (preview) preview.style.display = 'block';
  if (player)  player.src = url;
}

function clearNCAudio() {
  _ncAudioUrl = null;
  var preview = document.getElementById('nc-audio-preview');
  var player  = document.getElementById('nc-audio-player');
  if (preview) preview.style.display = 'none';
  if (player)  player.src = '';
}

async function toggleNCRecording() {
  if (_ncIsRecording) { stopNCRecording(); } else { await startNCRecording(); }
}

async function startNCRecording() {
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _ncAudioChunks = [];
    var mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    _ncRecorder = new MediaRecorder(stream, { mimeType });
    _ncRecorder.ondataavailable = function (e) { if (e.data.size > 0) _ncAudioChunks.push(e.data); };
    _ncRecorder.onstop = async function () {
      stream.getTracks().forEach(function (t) { t.stop(); });
      await uploadNCAudio(new Blob(_ncAudioChunks, { type: mimeType }));
    };
    _ncRecorder.start();
    _ncIsRecording = true;
    var btn = document.getElementById('nc-rec-btn');
    if (btn) { btn.classList.add('recording'); btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:#FF3B30"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0012 6.32V20h-3v2h8v-2h-3v-2.68A7 7 0 0019 11h-2z"/></svg> 🔴 Arrêter l\'enregistrement'; }
  } catch { alert('Microphone non accessible.'); }
}

function stopNCRecording() {
  if (_ncRecorder && _ncIsRecording) {
    _ncRecorder.stop();
    _ncIsRecording = false;
    var btn = document.getElementById('nc-rec-btn');
    if (btn) { btn.classList.remove('recording'); btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0012 6.32V20h-3v2h8v-2h-3v-2.68A7 7 0 0019 11h-2z"/></svg> Enregistrer un vocal'; }
  }
}

async function uploadNCAudio(blob) {
  var btn = document.getElementById('nc-rec-btn');
  if (btn) btn.disabled = true;
  try {
    var form = new FormData();
    form.append('file', blob, 'vocal_nc_' + Date.now() + '.webm');
    var upRes = await fetch(API + '/api/upload-public', { method: 'POST', body: form });
    if (!upRes.ok) { alert('Erreur upload audio'); return; }
    var upData = await upRes.json();
    selectNCAudio(upData.url);
  } catch { alert('Erreur réseau.'); }
  finally { if (btn) btn.disabled = false; }
}

var _ncGoogleMap          = null;
var _ncGoogleMarkP        = null;
var _ncGoogleMarkD        = null;
var _ncDirectionsRenderer = null;
var _ncOsrmPolyline       = null;

function initNCMap() {
  var mapEl = document.getElementById('nc-mini-map');
  if (!mapEl) return;
  if (_useGoogleMaps && window.google) {
    if (_ncGoogleMap) return;
    var nouakchott = { lat: 18.0735, lng: -15.9582 };
    _ncGoogleMap = new google.maps.Map(mapEl, { zoom: 12, center: nouakchott, disableDefaultUI: true });
    google.maps.event.addListenerOnce(_ncGoogleMap, 'tilesloaded', function() {
      if (_useGoogleMaps && !_googlePlacesReady) initGooglePlaces();
    });
    return;
  }
  if (_ncLeafletMap) return;
  var nouakchott = [18.0735, -15.9582];
  _ncLeafletMap = L.map(mapEl, { zoomControl: false, dragging: false, scrollWheelZoom: false, tap: false })
    .setView(nouakchott, 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '' }).addTo(_ncLeafletMap);
}

function refreshNCMapMarkers() {
  if (_useGoogleMaps && _ncGoogleMap && window.google) {
    var iconG = { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#34C759', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 };
    var iconR = { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#FF3B30', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 };
    if (_ncPickupCoords) {
      var pos = { lat: _ncPickupCoords[0], lng: _ncPickupCoords[1] };
      if (_ncGoogleMarkP) _ncGoogleMarkP.setPosition(pos);
      else _ncGoogleMarkP = new google.maps.Marker({ position: pos, map: _ncGoogleMap, icon: iconG });
    }
    if (_ncDropoffCoords) {
      var pos2 = { lat: _ncDropoffCoords[0], lng: _ncDropoffCoords[1] };
      if (_ncGoogleMarkD) _ncGoogleMarkD.setPosition(pos2);
      else _ncGoogleMarkD = new google.maps.Marker({ position: pos2, map: _ncGoogleMap, icon: iconR });
    }
    if (_ncPickupCoords && _ncDropoffCoords) {
      if (!_ncDirectionsRenderer) {
        _ncDirectionsRenderer = new google.maps.DirectionsRenderer({
          suppressMarkers: true,
          polylineOptions: { strokeColor: '#1976D2', strokeOpacity: 0.85, strokeWeight: 4 },
        });
        _ncDirectionsRenderer.setMap(_ncGoogleMap);
      }
      new google.maps.DirectionsService().route({
        origin: { lat: _ncPickupCoords[0], lng: _ncPickupCoords[1] },
        destination: { lat: _ncDropoffCoords[0], lng: _ncDropoffCoords[1] },
        travelMode: google.maps.TravelMode.DRIVING,
      }, function(result, status) {
        if (status === 'OK') _ncDirectionsRenderer.setDirections(result);
      });
      var bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: _ncPickupCoords[0],  lng: _ncPickupCoords[1] });
      bounds.extend({ lat: _ncDropoffCoords[0], lng: _ncDropoffCoords[1] });
      _ncGoogleMap.fitBounds(bounds, 24);
    } else if (_ncPickupCoords)  { _ncGoogleMap.setCenter({ lat: _ncPickupCoords[0],  lng: _ncPickupCoords[1]  }); _ncGoogleMap.setZoom(14); }
    else if (_ncDropoffCoords)   { _ncGoogleMap.setCenter({ lat: _ncDropoffCoords[0], lng: _ncDropoffCoords[1] }); _ncGoogleMap.setZoom(14); }
    return;
  }
  if (!_ncLeafletMap) return;
  var iconG = L.divIcon({ className: '', html: '<div style="width:12px;height:12px;border-radius:50%;background:#34C759;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>', iconSize: [12,12], iconAnchor: [6,6] });
  var iconR = L.divIcon({ className: '', html: '<div style="width:12px;height:12px;border-radius:50%;background:#FF3B30;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>', iconSize: [12,12], iconAnchor: [6,6] });
  if (_ncPickupCoords) {
    if (_ncPickupMarker) _ncLeafletMap.removeLayer(_ncPickupMarker);
    _ncPickupMarker = L.marker(_ncPickupCoords, { icon: iconG }).addTo(_ncLeafletMap);
  }
  if (_ncDropoffCoords) {
    if (_ncDropoffMarker) _ncLeafletMap.removeLayer(_ncDropoffMarker);
    _ncDropoffMarker = L.marker(_ncDropoffCoords, { icon: iconR }).addTo(_ncLeafletMap);
  }
  if (_ncPickupCoords && _ncDropoffCoords) {
    _ncLeafletMap.fitBounds([_ncPickupCoords, _ncDropoffCoords], { padding: [24, 24] });
    var url = 'https://router.project-osrm.org/route/v1/driving/'
      + _ncPickupCoords[1] + ',' + _ncPickupCoords[0] + ';'
      + _ncDropoffCoords[1] + ',' + _ncDropoffCoords[0]
      + '?overview=full&geometries=geojson';
    fetch(url).then(function(r) { return r.json(); }).then(function(data) {
      if (_ncOsrmPolyline) _ncLeafletMap.removeLayer(_ncOsrmPolyline);
      if (data.routes && data.routes[0]) {
        _ncOsrmPolyline = L.geoJSON(data.routes[0].geometry, {
          style: { color: '#1976D2', weight: 4, opacity: 0.85 }
        }).addTo(_ncLeafletMap);
      }
    }).catch(function() {});
  } else if (_ncPickupCoords)  { _ncLeafletMap.setView(_ncPickupCoords,  14); }
  else if (_ncDropoffCoords)   { _ncLeafletMap.setView(_ncDropoffCoords, 14); }
}

function initNCPlaces() {
  _attachPlaces(document.getElementById('nc-pickup'), function(coords, addr) {
    _ncPickupCoords = coords;
    refreshNCMapMarkers();
    _autoFillNCPrice();
  });
  _attachPlaces(document.getElementById('nc-dropoff'), function(coords, addr) {
    _ncDropoffCoords = coords;
    refreshNCMapMarkers();
    _autoFillNCPrice();
  });
}

async function createCallCourse() {
  var phone    = (document.getElementById('nc-phone')?.value  || '').trim();
  var pickup   = (document.getElementById('nc-pickup')?.value  || '').trim();
  var dropoff  = (document.getElementById('nc-dropoff')?.value || '').trim();
  var priceRaw = (document.getElementById('nc-price')?.value   || '').trim();
  var statusEl = document.getElementById('nc-status');

  if (!pickup || !dropoff) {
    if (statusEl) { statusEl.textContent = 'Veuillez renseigner les adresses de départ et d\'arrivée.'; statusEl.style.color = '#FF3B30'; }
    return;
  }
  var price = priceRaw ? parseFloat(priceRaw) : null;
  if (price !== null && (isNaN(price) || price < 0)) {
    if (statusEl) { statusEl.textContent = 'Tarif invalide.'; statusEl.style.color = '#FF3B30'; }
    return;
  }

  if (statusEl) { statusEl.textContent = 'Création en cours…'; statusEl.style.color = 'var(--text-3)'; }

  try {
    var res = await fetch(API + '/api/admin/call-course', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        phone:            phone || undefined,
        pickupAddress:    pickup,
        dropoffAddress:   dropoff,
        price:            price,
        audioUrl:         _ncAudioUrl || undefined,
        pickupLat:        _ncPickupCoords  ? _ncPickupCoords[0]  : undefined,
        pickupLng:        _ncPickupCoords  ? _ncPickupCoords[1]  : undefined,
        dropoffLat:       _ncDropoffCoords ? _ncDropoffCoords[0] : undefined,
        dropoffLng:       _ncDropoffCoords ? _ncDropoffCoords[1] : undefined,
      }),
    });
    if (!res.ok) {
      var err = {}; try { err = await res.json(); } catch {}
      if (statusEl) { statusEl.textContent = 'Erreur : ' + (err.error || res.status); statusEl.style.color = '#FF3B30'; }
      return;
    }
    var data = await res.json();
    if (statusEl) {
      statusEl.innerHTML = '<span style="color:#34C759;font-weight:600">Course créée —</span> '
        + escHtml(data.delivery.clientAlias) + ' · envoyée aux livreurs disponibles.';
    }
    // Réinitialiser le formulaire
    ['nc-pickup','nc-dropoff','nc-price'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
    var phoneEl = document.getElementById('nc-phone'); if (phoneEl) phoneEl.value = '+222';
    _ncPickupCoords = null; _ncDropoffCoords = null; _ncFoundClient = null;
    clearNCAudio();
    if (_ncIsRecording) stopNCRecording();
    if (_ncPickupMarker  && _ncLeafletMap) { _ncLeafletMap.removeLayer(_ncPickupMarker);  _ncPickupMarker  = null; }
    if (_ncDropoffMarker && _ncLeafletMap) { _ncLeafletMap.removeLayer(_ncDropoffMarker); _ncDropoffMarker = null; }
    if (_ncOsrmPolyline  && _ncLeafletMap) { _ncLeafletMap.removeLayer(_ncOsrmPolyline);  _ncOsrmPolyline  = null; }
    if (_ncDirectionsRenderer) { _ncDirectionsRenderer.setMap(null); _ncDirectionsRenderer = null; }
    var banner = document.getElementById('nc-client-banner'); if (banner) banner.style.display = 'none';
  } catch {
    if (statusEl) { statusEl.textContent = 'Erreur réseau.'; statusEl.style.color = '#FF3B30'; }
  }
}

function _haversineKm(ptA, ptB) {
  var R = 6371, dLat = (ptB[0]-ptA[0])*Math.PI/180, dLng = (ptB[1]-ptA[1])*Math.PI/180;
  var a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(ptA[0]*Math.PI/180)*Math.cos(ptB[0]*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function _routeDistKm(ptA, ptB, cb) {
  if (_useGoogleMaps && window.google) {
    new google.maps.DirectionsService().route({
      origin: { lat: ptA[0], lng: ptA[1] },
      destination: { lat: ptB[0], lng: ptB[1] },
      travelMode: google.maps.TravelMode.DRIVING,
    }, function(result, status) {
      if (status === 'OK' && result.routes[0] && result.routes[0].legs[0]) {
        cb(result.routes[0].legs[0].distance.value / 1000);
      } else {
        cb(_haversineKm(ptA, ptB));
      }
    });
  } else {
    fetch('https://router.project-osrm.org/route/v1/driving/' + ptA[1]+','+ptA[0]+';'+ptB[1]+','+ptB[0] + '?overview=false')
      .then(function(r) { return r.json(); })
      .then(function(data) { cb(data.routes && data.routes[0] ? data.routes[0].distance / 1000 : _haversineKm(ptA, ptB)); })
      .catch(function() { cb(_haversineKm(ptA, ptB)); });
  }
}

async function calcDistanceCC() {
  if (!_ccDepartLocation || !_ccDestLocation) return null;
  var ptA = [_ccDepartLocation.lat(), _ccDepartLocation.lng()];
  var ptB = [_ccDestLocation.lat(), _ccDestLocation.lng()];
  return new Promise(function(resolve) {
    _routeDistKm(ptA, ptB, function(distKm) {
      var prix = _prixPourDist(distKm);
      _autoFillPrice(distKm);
      resolve({ dist: distKm, prix: prix });
    });
  });
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
  var result = await calcDistanceCC();
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
  if (!m) { console.error('[showModal] element not found:', id); return; }
  m.classList.add('open');
  m.style.display = 'flex';
}
function closeModal(id) {
  var m = document.getElementById(id);
  if (!m) return;
  m.classList.remove('open');
  m.style.display = '';
}

/* ================================================================
   CALL CENTER — INBOX (conversations WhatsApp en attente + archivées)
================================================================ */
/* ── Barre de progression livraison ──────────────────────────────── */
function renderDeliveryProgress(status) {
  var bar = document.getElementById('cc-delivery-progress');
  if (!bar) return;

  if (status === 'cancelled') {
    bar.innerHTML = '<div class="cc-prog-cancelled">❌ Course annulée</div>';
    return;
  }

  var steps = ['Reçue', 'Assignée', 'En livraison', 'Livrée'];
  var stepIdx = { pending: 0, assigned: 1, in_progress: 2, done: 3 }[status] ?? 0;

  bar.innerHTML = steps.map(function(label, i) {
    var filled = i < stepIdx;
    var current = i === stepIdx;
    var dotClass = filled ? 'cc-prog-dot done' : current ? 'cc-prog-dot current' : 'cc-prog-dot';
    var labelClass = filled ? 'cc-prog-label done' : current ? 'cc-prog-label current' : 'cc-prog-label';
    var lineHtml = i > 0
      ? '<div class="cc-prog-line' + (filled || current ? ' done' : '') + '"></div>'
      : '';
    return '<div class="cc-prog-wrap">'
      + lineHtml
      + '<div class="cc-prog-step">'
      + '<div class="' + dotClass + '"></div>'
      + '<span class="' + labelClass + '">' + label + '</span>'
      + '</div>'
      + '</div>';
  }).join('');
}

var _inboxSelectedId = null;
var _inboxItems      = {};   // conversations en attente (admin_queue)
var _archivedItems   = {};   // conversations archivées (done/cancelled)
var _currentMessages = [];
var _inboxSubTab     = 'pending';   // 'pending' | 'archived'
var _myAdminId       = null;        // id de l'agent connecté (rempli au login)

function showInboxSubTab(tab) {
  _inboxSubTab = tab;
  document.getElementById('cc-sub-tab-pending').classList.toggle('active', tab === 'pending');
  document.getElementById('cc-sub-tab-archived').classList.toggle('active', tab === 'archived');

  // Fermer la conversation courante si on change d'onglet
  _inboxSelectedId = null;
  document.getElementById('cc-chat-empty').style.display = '';
  document.getElementById('cc-chat-view').style.display = 'none';
  closeLaunchPanel();

  if (tab === 'pending') loadInbox();
  else loadArchivedInbox();
}

function refreshCurrentInboxTab() {
  if (_inboxSubTab === 'archived') loadArchivedInbox();
  else loadInbox();
}

async function loadInbox() {
  try {
    var res = await fetch(API + '/api/admin/inbox', { headers: authHeaders() });
    if (!res.ok) return;
    var data = await res.json();
    renderInboxList(data.inbox || []);
  } catch {}
}

async function loadArchivedInbox() {
  var list = document.getElementById('cc-inbox-list');
  if (list) list.innerHTML = '<div class="cc-inbox-empty">Chargement…</div>';
  try {
    var res = await fetch(API + '/api/admin/inbox/archived', { headers: authHeaders() });
    if (!res.ok) return;
    var data = await res.json();
    renderArchivedList(data.archived || []);
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
    // Badge "Moi" si cette convo est claimée par l'agent courant
    var claimedBadge = item.claimedBy && item.claimedBy === _myAdminId
      ? ' <span style="font-size:10px;background:#007AFF;color:#fff;padding:1px 5px;border-radius:10px;font-weight:700">Moi</span>'
      : '';
    var displayName = item.clientPhone ? 'Client +' + item.clientPhone : escHtml(item.clientAlias);
    return '<div class="cc-inbox-item' + active + '" onclick="openConversation(\'' + item.id + '\')">'
      + '<div class="cc-inbox-alias">' + displayName + claimedBadge + '</div>'
      + '<div class="cc-inbox-preview">' + escHtml(preview.slice(0, 60)) + '</div>'
      + '<div class="cc-inbox-time">' + time + '</div>'
      + '</div>';
  }).join('');
}

function renderArchivedList(items) {
  var list = document.getElementById('cc-inbox-list');
  if (!list) return;

  _archivedItems = {};
  items.forEach(function (item) { _archivedItems[item.id] = item; });

  if (!items.length) {
    list.innerHTML = '<div class="cc-inbox-empty">Aucune conversation archivée</div>';
    return;
  }

  list.innerHTML = items.map(function (item) {
    var preview = item.lastMessage
      ? (item.lastMessage.type === 'text' ? (item.lastMessage.content || '') : '[' + item.lastMessage.type + ']')
      : '—';
    var time = item.doneAt ? fmtTime(item.doneAt) : fmtTime(item.createdAt);
    var active = item.id === _inboxSelectedId ? ' active' : '';
    var badgeClass = item.status === 'done' ? 'done' : 'cancelled';
    var badgeLabel = item.status === 'done' ? 'Livré' : 'Annulé';
    return '<div class="cc-inbox-item archived' + active + '" onclick="openArchivedConversation(\'' + item.id + '\')">'
      + '<div class="cc-inbox-alias">' + escHtml(item.clientAlias)
      + ' <span class="cc-inbox-status-badge ' + badgeClass + '">' + badgeLabel + '</span></div>'
      + '<div class="cc-inbox-preview">' + escHtml(preview.slice(0, 60)) + '</div>'
      + '<div class="cc-inbox-time">' + time + '</div>'
      + '</div>';
  }).join('');
}

async function openConversation(deliveryId) {
  _inboxSelectedId = deliveryId;
  var item = _inboxItems[deliveryId];

  // Claim la conversation (verrouillage)
  fetch(API + '/api/admin/inbox/' + deliveryId + '/claim', {
    method: 'POST', headers: authHeaders(),
  }).catch(function () {});

  // Mettre en évidence la ligne
  document.querySelectorAll('.cc-inbox-item').forEach(function (el) { el.classList.remove('active'); });
  var clicked = document.querySelector('.cc-inbox-item[onclick*="' + deliveryId + '"]');
  if (clicked) clicked.classList.add('active');

  // Afficher le panneau chat (avec bouton Lancer — convo active)
  document.getElementById('cc-chat-empty').style.display = 'none';
  var chatView = document.getElementById('cc-chat-view');
  chatView.style.display = 'flex';
  var nameEl = document.getElementById('cc-chat-client-name');
  if (nameEl) nameEl.textContent = item
    ? (item.clientPhone ? 'Client +' + item.clientPhone : item.clientAlias)
    : '—';
  // Réactiver le bouton Lancer (désactivé pour les archives)
  var launchBtn = document.querySelector('.cc-chat-topbar .btn-danger');
  if (launchBtn) launchBtn.style.display = '';

  // Barre de progression
  renderDeliveryProgress(item ? (item.status || 'pending') : 'pending');

  // Charger les messages et démarrer le polling
  await loadMessages(deliveryId);
  startMsgPolling(deliveryId);
}

async function openArchivedConversation(deliveryId) {
  _inboxSelectedId = deliveryId;
  var item = _archivedItems[deliveryId];
  stopMsgPolling(); // archives are read-only, no polling needed

  document.querySelectorAll('.cc-inbox-item').forEach(function (el) { el.classList.remove('active'); });
  var clicked = document.querySelector('.cc-inbox-item[onclick*="' + deliveryId + '"]');
  if (clicked) clicked.classList.add('active');

  document.getElementById('cc-chat-empty').style.display = 'none';
  var chatView = document.getElementById('cc-chat-view');
  chatView.style.display = 'flex';
  document.getElementById('cc-chat-client-name').textContent = item ? item.clientAlias : '—';
  // Cacher le bouton "Lancer la course" pour les archives (read-only)
  var launchBtn = document.querySelector('.cc-chat-topbar .btn-danger');
  if (launchBtn) launchBtn.style.display = 'none';

  // Barre de progression
  renderDeliveryProgress(item ? (item.status || 'done') : 'done');

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

function _buildMsgBody(m) {
  var side = (m.sender_role === 'admin') ? 'admin' : 'client';
  var body = '';
  if (m.type === 'text') {
    body = escHtml(m.content || '');
  } else if (m.type === 'audio') {
    body = m.content
      ? '<audio controls src="' + escHtml(m.content) + '" style="max-width:220px;display:block"></audio>'
      : '[Message vocal]';
    if (side === 'client' && m.content) {
      body += '<button class="cc-forward-btn" onclick="forwardAudioToDrivers(\'' + escHtml(m.content) + '\')" title="Utiliser ce vocal comme message de course">'
        + '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 004 4h12"/></svg>'
        + 'Transférer aux livreurs</button>';
    }
  } else if (m.type === 'image') {
    body = m.content
      ? '<img src="' + escHtml(m.content) + '" style="max-width:200px;border-radius:8px;cursor:pointer" onerror="_imgErr(this)" onclick="openImgModal(this.src)" />'
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
}

function renderMessages(messages) {
  _currentMessages = messages;
  _renderedMsgIds.clear();
  var container = document.getElementById('cc-messages');
  if (!container) return;

  if (!messages.length) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-3);font-size:13px;padding:20px">Aucun message</div>';
    return;
  }

  container.innerHTML = messages.map(function (m) {
    if (m.id) _renderedMsgIds.add(m.id);
    return _buildMsgBody(m);
  }).join('');

  container.scrollTop = container.scrollHeight;
}

function startMsgPolling(deliveryId) {
  stopMsgPolling();
  _msgPollTimer = setInterval(async function () {
    if (!_inboxSelectedId) return;
    try {
      var res = await fetch(API + '/api/admin/inbox/' + _inboxSelectedId + '/messages', { headers: authHeaders() });
      if (!res.ok) return;
      var data = await res.json();
      var msgs = data.messages || [];
      var container = document.getElementById('cc-messages');
      if (!container) return;
      var hasNew = false;
      msgs.forEach(function (m) {
        if (m.id && !_renderedMsgIds.has(m.id)) {
          _renderedMsgIds.add(m.id);
          container.insertAdjacentHTML('beforeend', _buildMsgBody(m));
          hasNew = true;
        }
      });
      if (hasNew) container.scrollTop = container.scrollHeight;
    } catch {}
  }, 2000);
}

function stopMsgPolling() {
  if (_msgPollTimer) { clearInterval(_msgPollTimer); _msgPollTimer = null; }
  _renderedMsgIds.clear();
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
    var data = await res.json();
    // Ajouter localement sans recharger
    var container = document.getElementById('cc-messages');
    var div = document.createElement('div');
    div.className = 'cc-msg admin';
    div.innerHTML = escHtml(text) + '<div class="cc-msg-time">maintenant</div>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    if (data.message && data.message.id) _renderedMsgIds.add(data.message.id);
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
  // Réinitialiser le champ description
  var desc = document.getElementById('cc-description');
  if (desc) desc.value = '';
  // Afficher le nom du client
  var item = _inboxItems[_inboxSelectedId];
  var clientNameEl = document.getElementById('cc-launch-client-name');
  if (clientNameEl) clientNameEl.textContent = item ? item.clientAlias : '—';
  // Masquer le badge "Tous refusé" au départ
  var refusedBadge = document.getElementById('cc-launch-refused-badge');
  if (refusedBadge) refusedBadge.style.display = 'none';
  // Reset état carte mini (route + marqueurs)
  _mmPickupCoords = null; _mmDropoffCoords = null;
  if (_mmDirectionsRenderer) { _mmDirectionsRenderer.setMap(null); _mmDirectionsRenderer = null; }
  if (_mmOsrmPolyline && _leafletMiniMap) { _leafletMiniMap.removeLayer(_mmOsrmPolyline); _mmOsrmPolyline = null; }
  document.getElementById('cc-launch-panel').style.display = 'flex';
  document.querySelector('.cc-inbox-layout').classList.add('launch-open');
  // Initialiser/rafraîchir la mini-carte après la fin de la transition CSS (250ms)
  setTimeout(initMiniMap, 300);
}

function closeLaunchPanel() {
  document.getElementById('cc-launch-panel').style.display = 'none';
  document.querySelector('.cc-inbox-layout').classList.remove('launch-open');
  if (_launchIsRecording) stopLaunchRecording();
}

/* ── Maps (Google Maps en priorité, Leaflet en fallback) ─────────────── */
var _useGoogleMaps    = false;
var _googleMiniMap    = null;
var _googleFullMap    = null;
var _leafletMiniMap   = null;
var _leafletFullMap   = null;
var _mmPickupMarker   = null;
var _mmDropoffMarker  = null;
var _fsPickupMarker   = null;
var _fsDropoffMarker  = null;
var _mmPickupCoords   = null;   // [lat, lng]
var _mmDropoffCoords  = null;   // [lat, lng]
var _mmDebounce       = null;
var _googlePlacesReady = false;
var _mmClickMode      = 'pickup';  // 'pickup' | 'dropoff'
var _fsDirectionsRenderer = null;
var _fsOsrmPolyline   = null;
var _mmDirectionsRenderer = null;
var _mmOsrmPolyline   = null;
var _MAP_TILES = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

function _gll(coords) { return coords ? { lat: coords[0], lng: coords[1] } : null; }

function _gMarkerIcon(color) {
  return { path: google.maps.SymbolPath.CIRCLE, scale: 9,
           fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2.5 };
}

function _fitGoogle(map, ptA, ptB) {
  if (!map) return;
  if (ptA && ptB) {
    var b = new google.maps.LatLngBounds();
    b.extend(_gll(ptA)); b.extend(_gll(ptB));
    map.fitBounds(b, { top: 40, right: 40, bottom: 40, left: 40 });
  } else if (ptA || ptB) { map.setCenter(_gll(ptA || ptB)); map.setZoom(14); }
}

/* ── Rafraîchir les marqueurs sur tous les cartes actives ────────── */
function refreshMapMarkers() {
  var ptA = _mmPickupCoords;
  var ptB = _mmDropoffCoords;

  if (_useGoogleMaps) {
    // Mini-map Google
    if (_mmPickupMarker)  _mmPickupMarker.setMap(null);
    if (_mmDropoffMarker) _mmDropoffMarker.setMap(null);
    _mmPickupMarker  = (ptA && _googleMiniMap) ? new google.maps.Marker({ position: _gll(ptA), map: _googleMiniMap, icon: _gMarkerIcon('#34C759') }) : null;
    _mmDropoffMarker = (ptB && _googleMiniMap) ? new google.maps.Marker({ position: _gll(ptB), map: _googleMiniMap, icon: _gMarkerIcon('#FF3B30') }) : null;
    _fitGoogle(_googleMiniMap, ptA, ptB);
    // Fullscreen Google
    if (_fsPickupMarker)  _fsPickupMarker.setMap(null);
    if (_fsDropoffMarker) _fsDropoffMarker.setMap(null);
    _fsPickupMarker  = (ptA && _googleFullMap) ? new google.maps.Marker({ position: _gll(ptA), map: _googleFullMap, icon: _gMarkerIcon('#34C759') }) : null;
    _fsDropoffMarker = (ptB && _googleFullMap) ? new google.maps.Marker({ position: _gll(ptB), map: _googleFullMap, icon: _gMarkerIcon('#FF3B30') }) : null;
    _fitGoogle(_googleFullMap, ptA, ptB);
  } else if (typeof L !== 'undefined') {
    var mkG = function() { return L.divIcon({ className:'', iconSize:[14,14], iconAnchor:[7,7], html:'<div style="width:14px;height:14px;border-radius:50%;background:#34C759;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>' }); };
    var mkR = function() { return L.divIcon({ className:'', iconSize:[14,14], iconAnchor:[7,7], html:'<div style="width:14px;height:14px;border-radius:50%;background:#FF3B30;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>' }); };
    var _applyL = function(map, pA, pB, mA, mB) {
      if (!map) return { a: null, b: null };
      if (mA) map.removeLayer(mA); if (mB) map.removeLayer(mB);
      var nA = pA ? L.marker(pA, { icon: mkG() }).addTo(map) : null;
      var nB = pB ? L.marker(pB, { icon: mkR() }).addTo(map) : null;
      if (pA && pB) map.fitBounds(L.latLngBounds([pA, pB]).pad(0.35));
      else if (pA || pB) map.setView(pA || pB, 14);
      map.invalidateSize(true);
      return { a: nA, b: nB };
    };
    var r1 = _applyL(_leafletMiniMap, ptA, ptB, _mmPickupMarker, _mmDropoffMarker);
    _mmPickupMarker = r1.a; _mmDropoffMarker = r1.b;
    var r2 = _applyL(_leafletFullMap, ptA, ptB, _fsPickupMarker, _fsDropoffMarker);
    _fsPickupMarker = r2.a; _fsDropoffMarker = r2.b;
  }
  if (ptA && ptB) {
    renderMiniMapRoute();
    var modal = document.getElementById('modal-map-fullscreen');
    if (modal && modal.style.display !== 'none') renderModalRoute();
    // Calcul automatique du prix selon la distance routière réelle
    _routeDistKm(ptA, ptB, function(distKm) { _autoFillPrice(distKm); });
  }
}

/* ── Init mini-carte ─────────────────────────────────────────────── */
function initMiniMap() {
  var el = document.getElementById('cc-mini-map');
  if (!el) return;
  if (_useGoogleMaps && window.google) {
    if (_googleMiniMap) {
      google.maps.event.trigger(_googleMiniMap, 'resize');
      if (_mmPickupCoords || _mmDropoffCoords) refreshMapMarkers();
      else _googleMiniMap.setCenter({ lat: 18.0735, lng: -15.9582 });
    } else {
      _googleMiniMap = new google.maps.Map(el, {
        center: { lat: 18.0735, lng: -15.9582 }, zoom: 12,
        disableDefaultUI: true, gestureHandling: 'none',
      });
      // Attacher Places seulement après chargement réussi des tuiles
      google.maps.event.addListenerOnce(_googleMiniMap, 'tilesloaded', function() {
        if (_useGoogleMaps && !_googlePlacesReady) initGooglePlaces();
      });
      if (_mmPickupCoords || _mmDropoffCoords) setTimeout(refreshMapMarkers, 300);
    }
  } else if (typeof L !== 'undefined') {
    if (_leafletMiniMap) {
      _leafletMiniMap.invalidateSize(true);
      if (_mmPickupCoords || _mmDropoffCoords) refreshMapMarkers();
      else _leafletMiniMap.setView([18.0735, -15.9582], 12);
    } else {
      _leafletMiniMap = L.map(el, { zoomControl: false, attributionControl: false }).setView([18.0735, -15.9582], 12);
      L.tileLayer(_MAP_TILES, { maxZoom: 19 }).addTo(_leafletMiniMap);
      setTimeout(function() { _leafletMiniMap.invalidateSize(true); }, 100);
    }
  }
}

/* ── Google Maps + Places ────────────────────────────────────────── */

// Appelé par Google Maps quand la clé est invalide ou billing non activé
window.gm_authFailure = function() {
  _useGoogleMaps = false;
  _googlePlacesReady = false; // réactiver Nominatim
  _googleMiniMap = null; _googleFullMap = null;
  _mmPickupMarker = null; _mmDropoffMarker = null;
  _fsPickupMarker = null; _fsDropoffMarker = null;

  // Supprimer les overlays Google Places (les "!") des inputs
  document.querySelectorAll('.pac-container').forEach(function(el) { el.remove(); });
  // Réinitialiser les inputs pour enlever les widgets Google Places
  ['cc-pickup', 'cc-dropoff', 'modal-pickup-input', 'modal-dropoff-input'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var val = el.value;
    var clone = el.cloneNode(true);
    clone.value = val;
    el.parentNode.replaceChild(clone, el);
  });
  // Rattacher les listeners debounceMiniMap sur les inputs principaux
  var pu = document.getElementById('cc-pickup');
  var dr = document.getElementById('cc-dropoff');
  if (pu) pu.addEventListener('input', debounceMiniMap);
  if (dr) dr.addEventListener('input', debounceMiniMap);

  // Réinitialiser en Leaflet
  setTimeout(initMiniMap, 100);
};

function onGoogleMapsReady() {
  _useGoogleMaps = true;
  // Ne PAS attacher Places ici — on attend que la carte charge ses tuiles
  // pour confirmer que la clé est valide (sinon gm_authFailure fire avant)
  setTimeout(function() {
    _googleMiniMap = null;
    _mmPickupMarker = null; _mmDropoffMarker = null;
  }, 150);
}

// Bounding box Nouakchott : ~17.90 N–18.30 N, 16.10 W–15.75 W
var _NKT_BOUNDS = null;
function _getNktBounds() {
  if (!_NKT_BOUNDS && window.google)
    _NKT_BOUNDS = new google.maps.LatLngBounds(
      new google.maps.LatLng(17.90, -16.10),
      new google.maps.LatLng(18.30, -15.75)
    );
  return _NKT_BOUNDS;
}

function _attachPlaces(inputEl, onSelect) {
  if (!inputEl || inputEl._acDone) return;
  inputEl._acDone = true;
  var ac = new google.maps.places.Autocomplete(inputEl, {
    componentRestrictions: { country: 'mr' },
    bounds: _getNktBounds(),
    strictBounds: false,
    fields: ['geometry', 'formatted_address'],
  });
  ac.addListener('place_changed', function() {
    var p = ac.getPlace();
    if (p && p.geometry) onSelect([p.geometry.location.lat(), p.geometry.location.lng()], p.formatted_address || inputEl.value);
  });
}

function initGooglePlaces() {
  if (!window.google || !google.maps || !google.maps.places) return;
  _googlePlacesReady = true;
  _attachPlaces(document.getElementById('cc-pickup'), function(coords, addr) {
    _mmPickupCoords = coords;
    var mpi = document.getElementById('modal-pickup-input'); if (mpi) mpi.value = addr || document.getElementById('cc-pickup').value;
    refreshMapMarkers();
  });
  _attachPlaces(document.getElementById('cc-dropoff'), function(coords, addr) {
    _mmDropoffCoords = coords;
    var mdi = document.getElementById('modal-dropoff-input'); if (mdi) mdi.value = addr || document.getElementById('cc-dropoff').value;
    refreshMapMarkers();
  });
  // Champs du panel "Nouvel appel"
  initNCPlaces();
}

function _initModalPlaces() {
  if (!window.google || !google.maps || !google.maps.places) return;
  _attachPlaces(document.getElementById('modal-pickup-input'), function(coords, addr) {
    _mmPickupCoords = coords;
    document.getElementById('cc-pickup').value = addr || document.getElementById('modal-pickup-input').value;
    refreshMapMarkers();
  });
  _attachPlaces(document.getElementById('modal-dropoff-input'), function(coords, addr) {
    _mmDropoffCoords = coords;
    document.getElementById('cc-dropoff').value = addr || document.getElementById('modal-dropoff-input').value;
    refreshMapMarkers();
  });
  // Sync frappe vers champs principaux
  var mpi = document.getElementById('modal-pickup-input');
  var mdi = document.getElementById('modal-dropoff-input');
  if (mpi && !mpi._syncDone) { mpi._syncDone = true; mpi.addEventListener('input', function() { document.getElementById('cc-pickup').value = this.value; if (!this.value.trim()) { _mmPickupCoords = null; refreshMapMarkers(); } }); }
  if (mdi && !mdi._syncDone) { mdi._syncDone = true; mdi.addEventListener('input', function() { document.getElementById('cc-dropoff').value = this.value; if (!this.value.trim()) { _mmDropoffCoords = null; refreshMapMarkers(); } }); }
}

/* ── Geocodage Nominatim (fallback sans Google Maps) ─────────────── */
function debounceMiniMap() {
  var pickup  = (document.getElementById('cc-pickup')?.value  || '').trim();
  var dropoff = (document.getElementById('cc-dropoff')?.value || '').trim();
  if (!pickup  && _mmPickupCoords)  { _mmPickupCoords  = null; refreshMapMarkers(); }
  if (!dropoff && _mmDropoffCoords) { _mmDropoffCoords = null; refreshMapMarkers(); }
  if (_googlePlacesReady) return;
  clearTimeout(_mmDebounce);
  _mmDebounce = setTimeout(updateMiniMap, 700);
}

async function updateMiniMap() {
  var pickup  = (document.getElementById('cc-pickup')?.value  || '').trim();
  var dropoff = (document.getElementById('cc-dropoff')?.value || '').trim();
  if (!pickup && !dropoff) return;
  async function geocode(addr) {
    try {
      var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1'
        + '&viewbox=-16.10,18.30,-15.75,17.90&bounded=1'
        + '&q=' + encodeURIComponent(addr + ', Nouakchott, Mauritanie');
      var r = await fetch(url);
      var d = await r.json();
      if (d.length) return [parseFloat(d[0].lat), parseFloat(d[0].lon)];
      // fallback sans bounded si rien trouvé dans le bbox
      var r2 = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(addr + ', Mauritanie'));
      var d2 = await r2.json();
      if (d2.length) return [parseFloat(d2[0].lat), parseFloat(d2[0].lon)];
    } catch {}
    return null;
  }
  if (pickup)  _mmPickupCoords  = await geocode(pickup);  else _mmPickupCoords  = null;
  if (dropoff) _mmDropoffCoords = await geocode(dropoff); else _mmDropoffCoords = null;
  refreshMapMarkers();
}

/* ── Modal carte — clic sur la carte + route optimisée ──────────── */
function setMapClickMode(mode) {
  _mmClickMode = mode;
  ['pickup', 'dropoff'].forEach(function(m) {
    var btn = document.getElementById('mm-mode-' + m);
    if (btn) btn.classList.toggle('active', m === mode);
  });
}

function _attachFullMapClick() {
  if (_useGoogleMaps && _googleFullMap && !_googleFullMap._clickDone) {
    _googleFullMap._clickDone = true;
    google.maps.event.addListener(_googleFullMap, 'click', function(e) {
      _setModalPoint(e.latLng.lat(), e.latLng.lng());
    });
  } else if (!_useGoogleMaps && _leafletFullMap && !_leafletFullMap._clickDone) {
    _leafletFullMap._clickDone = true;
    _leafletFullMap.on('click', function(e) {
      _setModalPoint(e.latlng.lat, e.latlng.lng);
    });
  }
}

function _setModalPoint(lat, lng) {
  var isPickup = _mmClickMode === 'pickup';
  var coordsLabel = lat.toFixed(5) + ', ' + lng.toFixed(5);
  if (isPickup) {
    _mmPickupCoords = [lat, lng];
    var mpi = document.getElementById('modal-pickup-input');
    var pu  = document.getElementById('cc-pickup');
    if (mpi) mpi.value = coordsLabel;
    if (pu)  pu.value  = coordsLabel;
    if (!_mmDropoffCoords) setMapClickMode('dropoff');
  } else {
    _mmDropoffCoords = [lat, lng];
    var mdi = document.getElementById('modal-dropoff-input');
    var dr  = document.getElementById('cc-dropoff');
    if (mdi) mdi.value = coordsLabel;
    if (dr)  dr.value  = coordsLabel;
  }
  refreshMapMarkers();
  renderModalRoute();
  // Reverse geocode en arrière-plan pour remplacer les coords par une adresse
  _reverseGeocode(lat, lng, function(addr) {
    if (!addr) return;
    var inputId = isPickup ? 'modal-pickup-input' : 'modal-dropoff-input';
    var mainId  = isPickup ? 'cc-pickup' : 'cc-dropoff';
    var inp = document.getElementById(inputId); if (inp) inp.value = addr;
    var mai = document.getElementById(mainId);  if (mai) mai.value = addr;
  });
}

async function _reverseGeocode(lat, lng, cb) {
  if (_useGoogleMaps && window.google && google.maps.Geocoder) {
    var gc = new google.maps.Geocoder();
    gc.geocode({ location: { lat: lat, lng: lng } }, function(results, status) {
      cb(status === 'OK' && results[0] ? results[0].formatted_address : null);
    });
  } else {
    try {
      var r = await fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng);
      var d = await r.json();
      cb(d.display_name || null);
    } catch (e) { cb(null); }
  }
}

function renderMiniMapRoute() {
  var ptA = _mmPickupCoords;
  var ptB = _mmDropoffCoords;
  if (!ptA || !ptB) return;

  if (_useGoogleMaps && _googleMiniMap) {
    if (!_mmDirectionsRenderer) {
      _mmDirectionsRenderer = new google.maps.DirectionsRenderer({
        suppressMarkers: true,
        polylineOptions: { strokeColor: '#1976D2', strokeOpacity: 0.85, strokeWeight: 4 },
      });
      _mmDirectionsRenderer.setMap(_googleMiniMap);
    }
    new google.maps.DirectionsService().route({
      origin: { lat: ptA[0], lng: ptA[1] },
      destination: { lat: ptB[0], lng: ptB[1] },
      travelMode: google.maps.TravelMode.DRIVING,
    }, function(result, status) {
      if (status === 'OK') _mmDirectionsRenderer.setDirections(result);
    });
  } else if (_leafletMiniMap) {
    var url = 'https://router.project-osrm.org/route/v1/driving/'
      + ptA[1] + ',' + ptA[0] + ';' + ptB[1] + ',' + ptB[0]
      + '?overview=full&geometries=geojson';
    fetch(url).then(function(r) { return r.json(); }).then(function(data) {
      if (_mmOsrmPolyline) _leafletMiniMap.removeLayer(_mmOsrmPolyline);
      if (data.routes && data.routes[0]) {
        _mmOsrmPolyline = L.geoJSON(data.routes[0].geometry, {
          style: { color: '#1976D2', weight: 4, opacity: 0.85 }
        }).addTo(_leafletMiniMap);
      }
    }).catch(function() {});
  }
}

function renderModalRoute() {
  var ptA = _mmPickupCoords;
  var ptB = _mmDropoffCoords;
  if (!ptA || !ptB) return;

  if (_useGoogleMaps && _googleFullMap) {
    if (!_fsDirectionsRenderer) {
      _fsDirectionsRenderer = new google.maps.DirectionsRenderer({
        suppressMarkers: true,
        polylineOptions: { strokeColor: '#1976D2', strokeOpacity: 0.85, strokeWeight: 5 },
      });
      _fsDirectionsRenderer.setMap(_googleFullMap);
    }
    new google.maps.DirectionsService().route({
      origin: { lat: ptA[0], lng: ptA[1] },
      destination: { lat: ptB[0], lng: ptB[1] },
      travelMode: google.maps.TravelMode.DRIVING,
    }, function(result, status) {
      if (status === 'OK') _fsDirectionsRenderer.setDirections(result);
    });
  } else if (_leafletFullMap) {
    var url = 'https://router.project-osrm.org/route/v1/driving/'
      + ptA[1] + ',' + ptA[0] + ';' + ptB[1] + ',' + ptB[0]
      + '?overview=full&geometries=geojson';
    fetch(url).then(function(r) { return r.json(); }).then(function(data) {
      if (_fsOsrmPolyline) _leafletFullMap.removeLayer(_fsOsrmPolyline);
      if (data.routes && data.routes[0]) {
        _fsOsrmPolyline = L.geoJSON(data.routes[0].geometry, {
          style: { color: '#1976D2', weight: 5, opacity: 0.85 }
        }).addTo(_leafletFullMap);
      }
    }).catch(function() {});
  }
}

/* ── Modal carte plein écran ─────────────────────────────────────── */
function openMapModal() {
  var pickup  = (document.getElementById('cc-pickup')?.value  || '').trim();
  var dropoff = (document.getElementById('cc-dropoff')?.value || '').trim();
  var mpi = document.getElementById('modal-pickup-input');
  var mdi = document.getElementById('modal-dropoff-input');
  if (mpi) mpi.value = pickup;
  if (mdi) mdi.value = dropoff;

  document.getElementById('modal-map-fullscreen').style.display = 'flex';

  // Réinitialiser le mode clic au départ (pickup si pas encore défini, sinon dropoff)
  setMapClickMode(_mmPickupCoords ? 'dropoff' : 'pickup');

  setTimeout(function() {
    if (_useGoogleMaps && window.google) {
      var el = document.getElementById('cc-map-fullscreen');
      if (!el) return;
      if (_googleFullMap) {
        google.maps.event.trigger(_googleFullMap, 'resize');
        if (_mmPickupCoords || _mmDropoffCoords) refreshMapMarkers();
        else _googleFullMap.setCenter({ lat: 18.0735, lng: -15.9582 });
      } else {
        _googleFullMap = new google.maps.Map(el, {
          center: { lat: 18.0735, lng: -15.9582 }, zoom: 12,
        });
        _initModalPlaces();
        if (_mmPickupCoords || _mmDropoffCoords) setTimeout(refreshMapMarkers, 300);
      }
      _initModalPlaces();
      _attachFullMapClick();
      if (_mmPickupCoords && _mmDropoffCoords) renderModalRoute();
    } else if (typeof L !== 'undefined') {
      var el2 = document.getElementById('cc-map-fullscreen');
      if (!el2) return;
      if (_leafletFullMap) {
        _leafletFullMap.invalidateSize(true);
        if (_mmPickupCoords || _mmDropoffCoords) refreshMapMarkers();
      } else {
        _leafletFullMap = L.map(el2, { zoomControl: true, attributionControl: true }).setView([18.0735, -15.9582], 12);
        L.tileLayer(_MAP_TILES, { maxZoom: 19, attribution: '© OpenStreetMap contributors © CARTO' }).addTo(_leafletFullMap);
        _leafletFullMap.invalidateSize(true);
        if (_mmPickupCoords || _mmDropoffCoords) setTimeout(refreshMapMarkers, 300);
      }
      _attachFullMapClick();
      if (_mmPickupCoords && _mmDropoffCoords) setTimeout(renderModalRoute, 350);
      // Sync champs modaux → principaux pour Nominatim
      var mpi2 = document.getElementById('modal-pickup-input');
      var mdi2 = document.getElementById('modal-dropoff-input');
      if (mpi2 && !mpi2._syncDone) { mpi2._syncDone = true; mpi2.addEventListener('input', function() { document.getElementById('cc-pickup').value = this.value; debounceMiniMap(); }); }
      if (mdi2 && !mdi2._syncDone) { mdi2._syncDone = true; mdi2.addEventListener('input', function() { document.getElementById('cc-dropoff').value = this.value; debounceMiniMap(); }); }
    }
  }, 80);
}

function cancelMapModal() {
  document.getElementById('modal-map-fullscreen').style.display = 'none';
}

function confirmMapModal() {
  var mpi = document.getElementById('modal-pickup-input');
  var mdi = document.getElementById('modal-dropoff-input');
  if (mpi && mpi.value.trim()) document.getElementById('cc-pickup').value  = mpi.value;
  if (mdi && mdi.value.trim()) document.getElementById('cc-dropoff').value = mdi.value;
  document.getElementById('modal-map-fullscreen').style.display = 'none';
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
    var replyData = await res.json();

    var container = document.getElementById('cc-messages');
    if (container) {
      var div = document.createElement('div');
      div.className = 'cc-msg admin';
      div.innerHTML = '<audio controls src="' + escHtml(upData.url) + '" style="max-width:220px"></audio>'
        + '<div class="cc-msg-time">maintenant</div>';
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
      if (replyData.message && replyData.message.id) _renderedMsgIds.add(replyData.message.id);
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
  if (price !== null && (isNaN(price) || price < 0 || price > 999999)) {
    alert('Tarif invalide (max 999 999 MRU).');
    return;
  }

  var description;

  var statusEl = document.getElementById('cc-launch-status');
  statusEl.textContent = 'Lancement en cours…';
  statusEl.className = 'cc-launch-status';

  try {
    var res = await fetch(API + '/api/admin/inbox/' + _inboxSelectedId + '/launch', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        pickupAddress: pickup,
        dropoffAddress: dropoff,
        price: price,
        description: description,
        forwardedAudioUrl: _forwardedAudioUrl || undefined,
        pickupLat: _mmPickupCoords ? _mmPickupCoords[0] : undefined,
        pickupLng: _mmPickupCoords ? _mmPickupCoords[1] : undefined,
        dropoffLat: _mmDropoffCoords ? _mmDropoffCoords[0] : undefined,
        dropoffLng: _mmDropoffCoords ? _mmDropoffCoords[1] : undefined,
      }),
    });
    if (!res.ok) {
      var errBody = {};
      try { errBody = await res.json(); } catch {}
      var msg = res.status === 409 ? 'Déjà lancée (statut invalide).'
              : res.status === 404 ? 'Course introuvable.'
              : 'Erreur serveur (' + (errBody.error || res.status) + ').';
      statusEl.textContent = msg;
      statusEl.className = 'cc-launch-status error';
      return;
    }
    statusEl.textContent = 'Course envoyée aux livreurs !';
    statusEl.className = 'cc-launch-status success';

    // Fermer le panneau + la conversation après lancement
    setTimeout(function () {
      closeLaunchPanel();
      _forwardedAudioUrl = null;
      _inboxSelectedId   = null;
      document.getElementById('cc-chat-empty').style.display = '';
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

function clearLaunchAudio() {
  _forwardedAudioUrl = null;
  var preview = document.getElementById('cc-launch-audio-preview');
  var player  = document.getElementById('cc-launch-audio-player');
  if (preview) preview.style.display = 'none';
  if (player)  player.src = '';
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
    _forwardedAudioUrl = upData.url;
    var preview = document.getElementById('cc-launch-audio-preview');
    var player  = document.getElementById('cc-launch-audio-player');
    if (preview) preview.style.display = 'block';
    if (player)  player.src = upData.url;
  } catch { alert('Erreur réseau.'); }
  finally { if (btn) { btn.disabled = false; } }
}

function forwardAudioToDrivers(audioUrl) {
  openLaunchPanel();
  setTimeout(function () {
    _forwardedAudioUrl = audioUrl;
    var preview = document.getElementById('cc-launch-audio-preview');
    var player  = document.getElementById('cc-launch-audio-player');
    if (preview) preview.style.display = 'block';
    if (player)  player.src = audioUrl;
  }, 350);
}

function fmtTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '--:--';
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

function trackingIcon(driver) {
  var status = driver.status || 'offline';
  var isAvailable = driver.isAvailable !== false;
  var color = status === 'busy' ? '#FF9500' : isAvailable ? '#34C759' : '#AEAEB2';
  var html = '<div style="position:relative;display:flex;flex-direction:column;align-items:center;width:28px">'
    + '<img src="moto.svg" style="width:28px;height:50px;object-fit:contain;filter:drop-shadow(0 2px 6px rgba(0,0,0,.45))" />'
    + '<div style="width:9px;height:9px;border-radius:50%;background:' + color + ';border:2px solid #fff;'
    + 'margin-top:-4px;box-shadow:0 0 0 2px ' + color + '66,0 1px 4px rgba(0,0,0,.3)"></div>'
    + '</div>';
  return L.divIcon({
    className: '',
    html: html,
    iconSize: [28, 62],
    iconAnchor: [14, 62],
    popupAnchor: [0, -64],
  });
}

function trackingPopupContent(driver) {
  var statusLabel = driver.status === 'busy' ? 'En course' : driver.status === 'available' ? 'En ligne' : 'Hors ligne';
  var dispoBadge = driver.isAvailable !== false
    ? '<span style="background:#34C759;color:#fff;font-size:11px;padding:2px 7px;border-radius:10px;font-weight:600">Disponible</span>'
    : '<span style="background:#AEAEB2;color:#fff;font-size:11px;padding:2px 7px;border-radius:10px;font-weight:600">Indisponible</span>';
  return '<div style="min-width:140px;font-family:sans-serif">'
    + '<div style="font-weight:700;font-size:14px;margin-bottom:5px">🛵 ' + escHtml(driver.name) + '</div>'
    + dispoBadge
    + '<div style="color:#666;font-size:12px;margin-top:5px">' + statusLabel + '</div>'
    + '</div>';
}

function updateTrackingMarker(driver) {
  if (!_trackingMap) return;
  if (_trackingMarkers[driver.driverId]) {
    _trackingMarkers[driver.driverId]
      .setLatLng([driver.lat, driver.lng])
      .setIcon(trackingIcon(driver))
      .getPopup()?.setContent(trackingPopupContent(driver));
  } else {
    var marker = L.marker([driver.lat, driver.lng], { icon: trackingIcon(driver) })
      .addTo(_trackingMap)
      .bindPopup(trackingPopupContent(driver));
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
    var isAvailable = d.isAvailable !== false;
    var isBusy = d.status === 'busy';
    var dotClass = isBusy ? 'busy' : d.lat ? 'online' : 'offline';
    var statusLabel = isBusy ? 'En course' : d.lat ? 'En ligne' : 'Hors ligne';
    var dispoBadge = isBusy
      ? '<span style="background:#FF9500;color:#fff;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;margin-left:4px">En course</span>'
      : isAvailable
        ? '<span style="background:#34C759;color:#fff;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;margin-left:4px">Disponible</span>'
        : '<span style="background:#AEAEB2;color:#fff;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;margin-left:4px">Indisponible</span>';
    var active = _trackingSelected === d.driverId ? ' active' : '';
    return '<div class="tracking-item' + active + '" onclick="focusDriver(\'' + d.driverId + '\')">'
      + '<div style="font-size:20px;margin-right:4px">🛵</div>'
      + '<div style="flex:1">'
      + '<div class="tracking-item-name">' + escHtml(d.name) + dispoBadge + '</div>'
      + '<div class="tracking-item-status">' + statusLabel + '</div>'
      + '</div>'
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
      _trackingDrivers[d.id] = { driverId: d.id, name: d.name, status: d.status, isAvailable: d.isAvailable, lat: d.lat, lng: d.lng, lastSeen: d.lastSeen };
      if (d.lat && d.lng) updateTrackingMarker(_trackingDrivers[d.id]);
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
      + '<td style="display:flex;gap:6px">'
      + '<button class="btn btn-ghost btn-sm" onclick="openChangePasswordModal(\'' + u.id + '\',\'' + escHtml(u.name) + '\')">MDP</button>'
      + '<button class="btn btn-ghost btn-sm" style="color:#FF3B30" onclick="deleteUser(\'' + u.id + '\',\'' + escHtml(u.name) + '\')">Supprimer</button>'
      + '</td>'
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

var _changePwdUserId = null;

function openChangePasswordModal(id, name) {
  _changePwdUserId = id;
  document.getElementById('change-pwd-user-name').textContent = name;
  document.getElementById('change-pwd-new').value = '';
  document.getElementById('change-pwd-confirm').value = '';
  document.getElementById('change-pwd-error').style.display = 'none';
  showModal('modal-change-password');
}

async function saveUserPassword() {
  var newPwd     = document.getElementById('change-pwd-new').value;
  var confirmPwd = document.getElementById('change-pwd-confirm').value;
  var errEl      = document.getElementById('change-pwd-error');
  errEl.style.display = 'none';
  if (!newPwd || newPwd.length < 6) {
    errEl.textContent = 'Le mot de passe doit contenir au moins 6 caractères.';
    errEl.style.display = 'block';
    return;
  }
  if (newPwd !== confirmPwd) {
    errEl.textContent = 'Les mots de passe ne correspondent pas.';
    errEl.style.display = 'block';
    return;
  }
  try {
    var res = await fetch(API + '/api/admin/users/' + _changePwdUserId + '/password', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPwd }),
    });
    if (!res.ok) {
      errEl.textContent = 'Erreur lors de la sauvegarde.';
      errEl.style.display = 'block';
      return;
    }
    closeModal('modal-change-password');
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


function openImgModal(src) {
  var modal = document.getElementById('img-modal');
  var img   = document.getElementById('img-modal-src');
  var dl    = document.getElementById('img-modal-dl');
  if (!modal || !img) return;
  img.src = src;
  if (dl) dl.href = src;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeImgModal() {
  var modal = document.getElementById('img-modal');
  if (!modal) return;
  modal.style.display = 'none';
  document.body.style.overflow = '';
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeImgModal();
});
