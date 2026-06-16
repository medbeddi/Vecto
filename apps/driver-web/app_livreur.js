/* ================================================================
   VECTO — Livreur v2 · app_livreur.js
   Même structure que l'original — données réelles via backend
================================================================ */

// ── Config (change l'URL si nécessaire) ───────────────────────────────────────
var API_BASE = 'https://online-fairly-forget-bloggers.trycloudflare.com';

// ── State ─────────────────────────────────────────────────────────────────────
var currentTab    = 's-courses';
var currentChatId = null;
var token         = localStorage.getItem('vecto_token');
var driverInfo    = JSON.parse(localStorage.getItem('vecto_driver') || 'null');
var phoneState    = localStorage.getItem('vecto_phone') || '';
var dialCode      = '+222';
var otpCode       = '';
var socket        = null;
var otpInterval   = null;
var dispo         = true;

// Remplace les faux tableaux — maintenant remplis depuis l'API
var COURSES      = [];   // commandes disponibles
var ACTIVE_CHATS = [];   // courses actives du driver

// ── Navigation ────────────────────────────────────────────────────────────────
function go(screenId) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  var t = document.getElementById(screenId);
  if (!t) return;
  t.classList.add('active');
  if (screenId === 's-chat' && currentChatId !== null) {
    renderChatMessages(currentChatId);
    setTimeout(scrollChatToBottom, 50);
  }
}

function setTab(el, screenId) {
  currentTab = screenId;
  go(screenId);
  document.querySelectorAll('.bnav .bni').forEach(function(b) {
    var oc = b.getAttribute('onclick') || '';
    b.classList.toggle('active', oc.includes("'" + screenId + "'"));
  });
  if (screenId === 's-courses') renderCourses();
  if (screenId === 's-chats')   renderChatList();
  updateBadges();
}

// ── Dispo ─────────────────────────────────────────────────────────────────────
function applyDispoUI(isAvailable) {
  var t = document.getElementById('toggle-dispo');
  var l = document.getElementById('dispo-label');
  if (t) t.classList.toggle('active', isAvailable);
  if (l) l.textContent = isAvailable ? 'Disponible' : 'Indisponible';
}

async function toggleDispo() {
  var next = !dispo;
  applyDispoUI(next);
  dispo = next;
  try {
    await apiFetch('/api/drivers/me/availability', {
      method: 'PATCH',
      body: JSON.stringify({ isAvailable: next })
    });
    if (!next) { COURSES = []; renderCourses(); }
    else { loadAvailableDeliveries(); }
  } catch (e) {
    // Rollback UI on error
    dispo = !next;
    applyDispoUI(dispo);
    console.warn('toggleDispo error:', e);
  }
}

// ── API helper ────────────────────────────────────────────────────────────────
async function apiFetch(path, opts) {
  var headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (opts && opts.headers) Object.assign(headers, opts.headers);
  var res = await fetch(API_BASE + path, Object.assign({}, opts, { headers: headers }));
  var data = await res.json().catch(function() { return {}; });
  if (!res.ok) throw { code: data.error || 'ERROR', status: res.status };
  return data;
}

function showErr(id, msg) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  AUTH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function toggleDialPicker() {
  var p = document.getElementById('dial-picker');
  if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
}
function selectDial(dial) {
  dialCode = dial;
  var el = document.getElementById('login-dial');
  if (el) el.textContent = dial + ' ▾';
  var p = document.getElementById('dial-picker');
  if (p) p.style.display = 'none';
}

async function handleContinue() {
  var local = (document.getElementById('login-phone').value || '').replace(/\D/g, '');
  if (local.length < 6) { showErr('login-error', 'Numéro trop court'); return; }
  phoneState = dialCode + local;
  showErr('login-error', '');
  var btn = document.getElementById('btn-continue');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳'; }
  try {
    var data = await apiFetch('/api/auth/check', { method: 'POST', body: JSON.stringify({ phone: phoneState }) });
    if (data.exists) {
      var el = document.getElementById('pw-phone-display');
      if (el) el.textContent = phoneState;
      go('s-password');
    } else {
      await apiFetch('/api/otp/send', { method: 'POST', body: JSON.stringify({ phone: phoneState }) });
      var otpEl = document.getElementById('otp-phone-display');
      if (otpEl) otpEl.textContent = phoneState;
      resetOtpBoxes();
      startOtpTimer();
      go('s-otp');
    }
  } catch (e) {
    showErr('login-error', 'Erreur réseau. Vérifiez la connexion.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Continuer →'; }
  }
}

async function handleLogin() {
  var pw = (document.getElementById('pw-input').value || '');
  if (!pw) { showErr('pw-error', 'Entrez votre mot de passe'); return; }
  showErr('pw-error', '');
  var btn = document.getElementById('btn-login');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳'; }
  try {
    var data = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ phone: phoneState, password: pw }) });
    onAuthSuccess(data);
  } catch (e) {
    showErr('pw-error', e.code === 'INVALID_CREDENTIALS' ? 'Mot de passe incorrect.' : 'Erreur de connexion.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Se connecter'; }
  }
}

function handleOtpNext() {
  var boxes = document.querySelectorAll('#otp-boxes .otp-box');
  otpCode = Array.from(boxes).map(function(b) { return b.value; }).join('');
  if (otpCode.length < 4) return;
  go('s-setup');
}

async function handleSetup() {
  var name    = (document.getElementById('setup-name').value || '').trim();
  var pass    = (document.getElementById('setup-pass').value || '');
  var confirm = (document.getElementById('setup-confirm').value || '');
  if (name.length < 2)  { showErr('setup-error', 'Nom trop court'); return; }
  if (pass.length < 6)  { showErr('setup-error', 'Mot de passe : 6 caractères minimum'); return; }
  if (pass !== confirm) { showErr('setup-error', 'Les mots de passe ne correspondent pas'); return; }
  showErr('setup-error', '');
  var btn = document.getElementById('btn-setup');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳'; }
  try {
    var data = await apiFetch('/api/otp/verify/driver', {
      method: 'POST',
      body: JSON.stringify({ phone: phoneState, code: otpCode, name: name, password: pass })
    });
    onAuthSuccess(data);
  } catch (e) {
    var msg = 'Erreur de vérification.';
    if (e.code === 'INVALID_OR_EXPIRED_CODE') msg = 'Code OTP incorrect ou expiré.';
    if (e.code === 'PASSWORD_REQUIRED')       msg = 'Mot de passe requis.';
    showErr('setup-error', msg);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Créer mon compte'; }
  }
}

async function syncDispoFromServer() {
  try {
    var data = await apiFetch('/api/drivers/me');
    dispo = !!data.driver.isAvailable;
    applyDispoUI(dispo);
  } catch (e) { console.warn('syncDispo:', e); }
}

function onAuthSuccess(data) {
  token = data.accessToken;
  driverInfo = data.driver;
  localStorage.setItem('vecto_token', token);
  localStorage.setItem('vecto_driver', JSON.stringify(driverInfo));
  localStorage.setItem('vecto_phone', phoneState);
  updateMenuProfile();
  connectSocket();
  syncDispoFromServer();
  loadAvailableDeliveries();
  loadActiveDeliveries();
  loadDocuments();
  go('s-courses');
}

function handleLogout() {
  if (!confirm('Se déconnecter ?')) return;
  if (socket) socket.disconnect();
  apiFetch('/api/auth/logout', { method: 'POST' }).catch(function() {});
  token = null; driverInfo = null;
  localStorage.removeItem('vecto_token');
  localStorage.removeItem('vecto_driver');
  localStorage.removeItem('vecto_phone');
  COURSES = []; ACTIVE_CHATS = []; currentChatId = null;
  go('s-login');
}

// ── OTP boxes ─────────────────────────────────────────────────────────────────
function otpInput(el, idx) {
  var clean = el.value.replace(/\D/g, '').slice(-1);
  el.value = clean;
  el.classList.toggle('filled', !!clean);
  if (clean && idx < 3) {
    var next = document.querySelectorAll('#otp-boxes .otp-box')[idx + 1];
    if (next) next.focus();
  }
  var all = Array.from(document.querySelectorAll('#otp-boxes .otp-box')).map(function(b) { return b.value; }).join('');
  var btn = document.getElementById('btn-otp-next');
  if (btn) btn.disabled = all.length < 4;
}
function otpKey(e, idx) {
  if (e.key === 'Backspace') {
    var boxes = document.querySelectorAll('#otp-boxes .otp-box');
    if (!boxes[idx].value && idx > 0) {
      boxes[idx - 1].focus(); boxes[idx - 1].value = ''; boxes[idx - 1].classList.remove('filled');
    }
  }
}
function resetOtpBoxes() {
  document.querySelectorAll('#otp-boxes .otp-box').forEach(function(b) { b.value = ''; b.classList.remove('filled'); });
  var btn = document.getElementById('btn-otp-next'); if (btn) btn.disabled = true;
}
function startOtpTimer() {
  if (otpInterval) clearInterval(otpInterval);
  var t = 60;
  var wrap = document.getElementById('otp-resend-wrap');
  if (wrap) wrap.innerHTML = 'Renvoyer dans <strong id="otp-timer">60</strong>s';
  otpInterval = setInterval(function() {
    t--;
    var el = document.getElementById('otp-timer'); if (el) el.textContent = t;
    if (t <= 0) {
      clearInterval(otpInterval);
      var w = document.getElementById('otp-resend-wrap');
      if (w) w.innerHTML = '<span style="cursor:pointer;text-decoration:underline" onclick="resendOtp()">Renvoyer le code</span>';
    }
  }, 1000);
}
async function resendOtp() {
  try {
    await apiFetch('/api/otp/send', { method: 'POST', body: JSON.stringify({ phone: phoneState }) });
    resetOtpBoxes(); startOtpTimer();
  } catch (e) { alert('Impossible de renvoyer le code.'); }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SOCKET.IO — remplace simulateClientReply()
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function connectSocket() {
  if (socket) socket.disconnect();
  socket = io(API_BASE, { auth: { token: token }, transports: ['websocket', 'polling'] });

  socket.on('new_order', function(data) {
    if (COURSES.find(function(c) { return c.id === data.deliveryId; })) return;
    COURSES.push({
      id: String(data.deliveryId), client: data.clientAlias, initiale: (data.clientAlias || '?')[0].toUpperCase(),
      pickupAddress: data.pickupAddress || null, dropoffAddress: data.dropoffAddress || null,
      price: data.price || null,
      time: 'à l\'instant', duration: '0:05', accepted: false, refused: false,
      waves: genWaves(15), realMessage: data.message
    });
    renderCourses();
  });

  socket.on('order_taken', function(data) {
    COURSES = COURSES.filter(function(c) { return c.id !== data.deliveryId; });
    renderCourses();
  });

  socket.on('client_message', function(msg) {
    var chat = ACTIVE_CHATS.find(function(c) { return c.id === currentChatId; });
    if (!chat) return;
    var m = {
      type: msg.type, from: 'client',
      text: msg.content || '',
      duration: '0:05',
      waves: msg.type === 'audio' ? genWaves(12) : null,
      meta: msg.meta,
      time: getTime()
    };
    chat.messages.push(m);
    chat.lastMsg  = msg.type === 'text' ? msg.content : '🎤 Vocal';
    chat.lastTime = getTime();
    if (currentChatId && document.getElementById('s-chat').classList.contains('active')) {
      renderChatMessages(currentChatId);
      renderChatList();
      setTimeout(scrollChatToBottom, 30);
    } else {
      chat.unread++; renderChatList(); updateBadges();
    }
  });

  socket.on('delivery_cancelled', function(data) {
    if (currentChatId === data.deliveryId) {
      alert('Cette course a été annulée.');
    }
    ACTIVE_CHATS = ACTIVE_CHATS.filter(function(c) { return c.id !== data.deliveryId; });
    renderChatList();
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DONNÉES COURSES — remplace le faux tableau COURSES = [...]
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function loadAvailableDeliveries() {
  try {
    var data = await apiFetch('/api/deliveries/available');
    COURSES = (data.deliveries || []).map(function(d) {
      return {
        id: String(d.id), client: d.clientAlias, initiale: (d.clientAlias || '?')[0].toUpperCase(),
        pickupAddress: d.pickupAddress || null, dropoffAddress: d.dropoffAddress || null,
        price: d.price || null,
        time: fmtRelTime(d.createdAt), duration: '0:05',
        accepted: false, refused: false, waves: genWaves(15), realMessage: null
      };
    });
    renderCourses();
  } catch (e) { console.warn('loadAvailable:', e); }
}

async function loadActiveDeliveries() {
  try {
    var data = await apiFetch('/api/deliveries/mine');
    ACTIVE_CHATS = (data.deliveries || []).map(function(d) {
      return {
        id: String(d.id), client: d.clientAlias, initiale: (d.clientAlias || '?')[0].toUpperCase(),
        status: d.status, messages: [], unread: 0, lastMsg: 'Course active', lastTime: ''
      };
    });
    renderChatList(); updateBadges();
  } catch (e) { console.warn('loadMine:', e); }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  RENDER COURSES — même structure que l'original
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function renderCourses() {
  var container = document.getElementById('courses-list');
  var empty     = document.getElementById('courses-empty');
  var countEl   = document.getElementById('courses-count');
  if (!container) return;
  var available = COURSES.filter(function(c) { return !c.accepted && !c.refused; });
  if (available.length === 0) {
    container.innerHTML = '';
    if (empty)   empty.style.display = 'flex';
    if (countEl) countEl.textContent = 'Aucune disponible';
    return;
  }
  if (empty)   empty.style.display = 'none';
  if (countEl) countEl.textContent = available.length + ' disponible' + (available.length > 1 ? 's' : '');
  container.innerHTML = available.map(buildCourseCard).join('');
}

function buildCourseCard(c) {
  var bars = c.waves.map(function(h) {
    return '<div class="vocal-bar" style="height:' + h + '%"></div>';
  }).join('');

  var priceBadge = c.price
    ? '<span class="course-price-badge">' + c.price + ' MRU</span>'
    : '';

  var route = '';
  if (c.pickupAddress || c.dropoffAddress) {
    route = '<div class="course-route">'
      + '<div class="route-point">'
      +   '<div class="route-dot pickup"></div>'
      +   '<span class="route-addr">' + escHtml(c.pickupAddress || '—') + '</span>'
      + '</div>'
      + '<div class="route-point">'
      +   '<div class="route-dot delivery"></div>'
      +   '<span class="route-addr">' + escHtml(c.dropoffAddress || '—') + '</span>'
      + '</div>'
      + '</div>';
  }

  return '<div class="course-card" id="course-card-' + c.id + '">'
    + '<div class="course-card-body">'
    + '<div class="course-card-header">'
    +   '<div class="course-client-avatar">' + c.initiale + '</div>'
    +   '<div class="course-client-info">'
    +     '<div class="course-client-name-row">'
    +       '<span class="course-client-name">' + escHtml(c.client) + '</span>'
    +       priceBadge
    +     '</div>'
    +     '<div class="course-time">' + escHtml(c.time) + '</div>'
    +   '</div>'
    + '</div>'
    + '<div class="vocal-bubble">'
    +   '<button class="vocal-play-btn" onclick="playVocal(\'' + c.id + '\',this)">'
    +     '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'
    +   '</button>'
    +   '<div class="vocal-waveform">' + bars + '</div>'
    +   '<span class="vocal-duration">' + escHtml(c.duration || '0:05') + '</span>'
    + '</div>'
    + route
    + '<div class="course-actions">'
    +   '<button class="btn-refuse" onclick="refuserCourse(\'' + c.id + '\')">Refuser</button>'
    +   '<button class="btn-accept" id="accept-' + c.id + '" onclick="accepterCourse(\'' + c.id + '\')">'
    +     '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>Accepter'
    +   '</button>'
    + '</div>'
    + '</div>'
    + '</div>';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ACCEPT / REFUSE — remplace la logique locale par API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function accepterCourse(id) {
  var course = COURSES.find(function(c) { return c.id === id; });
  if (!course) return;
  var btn = document.getElementById('accept-' + id);
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳'; }
  try {
    var data = await apiFetch('/api/deliveries/' + id + '/accept', { method: 'POST' });
    course.accepted = true;
    var existing = ACTIVE_CHATS.find(function(a) { return a.id === id; });
    if (!existing) {
      ACTIVE_CHATS.push({
        id: id, client: course.client, initiale: course.initiale,
        status: data.delivery ? data.delivery.status : 'assigned',
        messages: [], unread: 0, lastMsg: '🎤 Vocal', lastTime: 'maintenant'
      });
    }
    renderCourses(); renderChatList(); updateBadges();
    openChat(id);
  } catch (e) {
    course.accepted = false;
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>Accepter'; }
    alert(e.code === 'ALREADY_TAKEN' ? 'Cette course a déjà été prise.' : 'Erreur lors de l\'acceptation.');
  }
}

function refuserCourse(id) {
  var course = COURSES.find(function(c) { return c.id === id; });
  if (course) course.refused = true;
  var card = document.getElementById('course-card-' + id);
  if (card) {
    card.style.opacity = '0'; card.style.transform = 'translateX(40px)'; card.style.transition = 'opacity .3s, transform .3s';
    setTimeout(renderCourses, 300);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  STATUT COURSE — boutons En route / Terminé / Annuler
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function updateStatus(newStatus) {
  if (currentChatId === null) return;
  var chat = ACTIVE_CHATS.find(function(c) { return c.id === currentChatId; });
  if (!chat) return;
  try {
    await apiFetch('/api/deliveries/' + currentChatId + '/status', {
      method: 'POST',
      body: JSON.stringify({ status: newStatus })
    });
    chat.status = newStatus;
    var sub = document.getElementById('chat-header-sub');
    if (sub) sub.textContent = STATUS_LABELS[newStatus] || newStatus;
    updateStatusBar(newStatus);
    if (newStatus === 'done' || newStatus === 'cancelled') {
      var removedId = currentChatId;
      currentChatId = null;
      ACTIVE_CHATS = ACTIVE_CHATS.filter(function(c) { return c.id !== removedId; });
      renderChatList(); updateBadges();
      go('s-chats');
      setTab(null, 's-chats');
    }
  } catch (e) {
    alert('Erreur lors de la mise à jour du statut.');
  }
}

function updateStatusBar(status) {
  var bar        = document.getElementById('status-bar');
  var btnEnroute = document.getElementById('btn-enroute');
  var btnDone    = document.getElementById('btn-done');
  var btnCancel  = document.getElementById('btn-cancel');
  if (!bar) return;
  var active = status === 'assigned' || status === 'in_progress';
  bar.style.display   = active ? 'flex' : 'none';
  if (btnEnroute) btnEnroute.style.display = status === 'assigned'    ? 'flex' : 'none';
  if (btnDone)    btnDone.style.display    = status === 'in_progress' ? 'flex' : 'none';
  if (btnCancel)  btnCancel.style.display  = active                   ? 'flex' : 'none';
}

// ─── Play vocal (animation — même que l'original) ────────────────────────────
var _playingId = null, _playInterval = null, _playStep = 0;

function playVocal(courseId, btn) {
  if (_playingId === courseId) {
    clearInterval(_playInterval); _playingId = null;
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    var card = document.getElementById('course-card-' + courseId);
    if (card) card.querySelectorAll('.vocal-bar').forEach(function(b) { b.classList.remove('active'); });
    return;
  }
  clearInterval(_playInterval); _playingId = courseId; _playStep = 0;
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
  var card = document.getElementById('course-card-' + courseId);
  if (!card) return;
  var bars = card.querySelectorAll('.vocal-bar');
  _playInterval = setInterval(function() {
    bars.forEach(function(b, i) { b.classList.toggle('active', i <= _playStep); });
    _playStep++;
    if (_playStep >= bars.length) {
      clearInterval(_playInterval); _playingId = null;
      btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
      bars.forEach(function(b) { b.classList.remove('active'); });
    }
  }, 120);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CHAT LIST — même structure que l'original
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function renderChatList() {
  var container = document.getElementById('chats-list');
  var empty     = document.getElementById('chats-empty');
  var countEl   = document.getElementById('active-count');
  if (!container) return;
  if (ACTIVE_CHATS.length === 0) {
    container.innerHTML = '';
    if (empty)   empty.style.display = 'flex';
    if (countEl) countEl.textContent = '0 active';
    return;
  }
  if (empty)   empty.style.display = 'none';
  if (countEl) countEl.textContent = ACTIVE_CHATS.length + ' active' + (ACTIVE_CHATS.length > 1 ? 's' : '');
  var html = '';
  ACTIVE_CHATS.forEach(function(chat) {
    html += '<div class="chat-list-item" onclick="openChat(\'' + chat.id + '\')">'
      + '<div class="chat-list-avatar">' + chat.initiale + '<div class="chat-online-dot"></div></div>'
      + '<div class="chat-list-info"><div class="chat-list-name">' + escHtml(chat.client) + '</div><div class="chat-list-last">' + escHtml(chat.lastMsg || '') + '</div></div>'
      + '<div class="chat-list-right"><div class="chat-list-time">' + (chat.lastTime || '') + '</div>'
      + (chat.unread > 0 ? '<div class="chat-unread">' + chat.unread + '</div>' : '') + '</div>'
      + '</div>';
  });
  container.innerHTML = html;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OPEN CHAT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function openChat(chatId) {
  var chat = ACTIVE_CHATS.find(function(c) { return c.id === chatId; });
  if (!chat) return;
  currentChatId = chatId; chat.unread = 0;
  document.getElementById('chat-avatar').textContent      = chat.initiale;
  document.getElementById('chat-header-name').textContent = chat.client;
  document.getElementById('chat-header-sub').textContent  = STATUS_LABELS[chat.status] || 'En cours';
  updateStatusBar(chat.status);
  go('s-chat');
  // Charger messages depuis l'API
  if (chat.messages.length === 0) {
    try {
      var data = await apiFetch('/api/deliveries/' + chatId + '/messages');
      chat.messages = (data.messages || []).map(function(m) {
        return {
          type: m.type, from: m.sender_role || m.senderRole,
          text: m.content || '', duration: '0:05',
          waves: m.type === 'audio' ? genWaves(12) : null,
          meta: m.meta, time: fmtMsgTime(m.createdAt || m.created_at)
        };
      });
    } catch (e) {}
  }
  renderChatMessages(chatId);
  setTimeout(scrollChatToBottom, 100);
  if (socket) socket.emit('join_room', { deliveryId: chatId });
  updateBadges(); renderChatList();
}

var STATUS_LABELS = { pending: 'En attente', assigned: 'Acceptée', in_progress: 'En route', done: 'Terminée', cancelled: 'Annulée' };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  RENDER MESSAGES — même structure que l'original
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function renderChatMessages(chatId) {
  var chat = ACTIVE_CHATS.find(function(c) { return c.id === chatId; });
  if (!chat) return;
  var container = document.getElementById('chat-messages');
  if (!container) return;
  var html = '<div class="chat-date-sep"><span>Aujourd\'hui</span></div>';
  chat.messages.forEach(function(msg) {
    var isOut = msg.from === 'driver';
    var wc = 'msg-wrap ' + (isOut ? 'out' : 'in');
    if (msg.type === 'text') {
      html += '<div class="' + wc + '"><div class="bubble">' + escHtml(msg.text || '') + '</div><div class="msg-time">' + msg.time + '</div></div>';
    } else if (msg.type === 'vocal' || msg.type === 'audio') {
      var bars = (msg.waves || genWaves(12)).map(function(h) { return '<div class="bwave-bar" style="height:' + h + '%"></div>'; }).join('');
      html += '<div class="' + wc + '"><div class="bubble bubble-vocal">'
        + '<button class="bubble-play" onclick="playBubbleVocal(this)"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>'
        + '<div class="bubble-wave">' + bars + '</div>'
        + '<span class="bubble-dur">' + (msg.duration || '0:05') + '</span>'
        + '</div><div class="msg-time">' + msg.time + '</div></div>';
    } else if (msg.type === 'image') {
      var src = msg.text || (msg.content || '');
      html += '<div class="' + wc + '"><div class="bubble bubble-image"><img src="' + escHtml(src) + '" alt="Photo"/></div><div class="msg-time">' + msg.time + '</div></div>';
    } else if (msg.type === 'location') {
      var meta = msg.meta || {};
      var lat = meta.lat, lng = meta.lng;
      var href = lat ? 'https://maps.google.com/?q=' + lat + ',' + lng : '#';
      html += '<div class="' + wc + '"><div class="bubble bubble-location" onclick="window.open(\'' + href + '\',\'_blank\')" style="cursor:pointer">'
        + '<svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>'
        + '<div><div class="bubble-loc-text">Ma position</div><div class="bubble-loc-sub">' + (lat ? lat.toFixed(4) + ', ' + lng.toFixed(4) : 'Position partagée') + '</div></div>'
        + '</div><div class="msg-time">' + msg.time + '</div></div>';
    }
  });
  container.innerHTML = html;
}

function genWaves(n) { var a = []; for (var i = 0; i < n; i++) a.push(Math.floor(Math.random() * 70) + 20); return a; }
function scrollChatToBottom() { var c = document.getElementById('chat-messages'); if (c) c.scrollTop = c.scrollHeight; }
function getTime() { var n = new Date(); return ('0' + n.getHours()).slice(-2) + ':' + ('0' + n.getMinutes()).slice(-2); }
function fmtRelTime(iso) { if (!iso) return 'maintenant'; try { var d = Date.now() - new Date(iso).getTime(); if (d < 60000) return 'à l\'instant'; return 'Il y a ' + Math.floor(d / 60000) + ' min'; } catch (e) { return ''; } }
function fmtMsgTime(iso) { if (!iso) return getTime(); try { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ─── Play vocal in chat (même que l'original) ─────────────────────────────────
function playBubbleVocal(btn) {
  var wave = btn.parentElement.querySelector('.bubble-wave');
  var bars = wave ? wave.querySelectorAll('.bwave-bar') : [];
  var step = 0;
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
  var iv = setInterval(function() {
    bars.forEach(function(b, i) { b.style.opacity = i <= step ? '1' : '0.3'; });
    step++;
    if (step >= bars.length) {
      clearInterval(iv);
      btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
      bars.forEach(function(b) { b.style.opacity = '1'; });
    }
  }, 130);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SEND MESSAGES — remplace les faux envois par API réelle
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function sendText() {
  var input = document.getElementById('chat-text-input');
  var text  = input ? input.value.trim() : '';
  if (!text || currentChatId === null) return;
  var chat = ACTIVE_CHATS.find(function(c) { return c.id === currentChatId; });
  if (!chat) return;
  input.value = ''; toggleSendMic();
  var msg = { type: 'text', from: 'driver', text: text, time: getTime() };
  chat.messages.push(msg); chat.lastMsg = text; chat.lastTime = getTime();
  renderChatMessages(currentChatId); renderChatList();
  setTimeout(scrollChatToBottom, 30);
  try {
    await apiFetch('/api/deliveries/' + currentChatId + '/message', { method: 'POST', body: JSON.stringify({ type: 'text', content: text }) });
  } catch (e) {
    chat.messages.pop(); input.value = text;
    renderChatMessages(currentChatId);
    alert('Message non envoyé. Réessayez.');
  }
}

function sendImage() {
  if (currentChatId === null) return;
  alert('Upload d\'image disponible depuis l\'app mobile.');
}

async function sendLocation() {
  if (currentChatId === null) return;
  if (!navigator.geolocation) { alert('Géolocalisation non supportée.'); return; }
  navigator.geolocation.getCurrentPosition(async function(pos) {
    var lat = pos.coords.latitude, lng = pos.coords.longitude;
    var chat = ACTIVE_CHATS.find(function(c) { return c.id === currentChatId; });
    if (!chat) return;
    try {
      await apiFetch('/api/deliveries/' + currentChatId + '/message', {
        method: 'POST',
        body: JSON.stringify({ type: 'location', meta: { lat: lat, lng: lng, label: 'Ma position' } })
      });
      chat.messages.push({ type: 'location', from: 'driver', meta: { lat: lat, lng: lng }, time: getTime() });
      chat.lastMsg = '📍 Position'; chat.lastTime = getTime();
      renderChatMessages(currentChatId); renderChatList(); setTimeout(scrollChatToBottom, 30);
    } catch (e) { alert('Erreur envoi position.'); }
  }, function() { alert('Position non disponible.'); });
}

// ─── Voice recording (simulé — micro non dispo en web) ───────────────────────
var _isRecording = false, _recordTimer = null;

function startVoice() {
  _isRecording = true;
  var bar = document.querySelector('.chat-input-bar');
  if (bar) bar.classList.add('recording');
  _recordTimer = setTimeout(stopVoice, 8000);
}

function stopVoice() {
  if (!_isRecording) return;
  _isRecording = false; clearTimeout(_recordTimer);
  var bar = document.querySelector('.chat-input-bar');
  if (bar) bar.classList.remove('recording');
  alert('Enregistrement vocal disponible depuis l\'app mobile.');
}

// ─── Send / mic toggle ────────────────────────────────────────────────────────
function toggleSendMic() {
  var input   = document.getElementById('chat-text-input');
  var sendBtn = document.getElementById('chat-send-btn');
  var micBtn  = document.getElementById('chat-mic-btn');
  if (!input || !sendBtn || !micBtn) return;
  var hasText = input.value.trim().length > 0;
  sendBtn.style.display = hasText ? 'flex' : 'none';
  micBtn.style.display  = hasText ? 'none' : 'flex';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  BADGES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function updateBadges() {
  var total = ACTIVE_CHATS.reduce(function(a, c) { return a + (c.unread || 0); }, 0);
  ['badge-chats', 'badge-chats2'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.style.display = total > 0 ? 'flex' : 'none';
    el.textContent   = total;
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PROFIL — même que l'original
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function updateMenuProfile() {
  if (!driverInfo) return;
  var n = driverInfo.name || 'Driver';
  var el = document.getElementById('menu-avatar');       if (el) el.textContent = n[0].toUpperCase();
  var nm = document.getElementById('menu-name');         if (nm) nm.textContent = n;
  var dn = document.getElementById('display-name');      if (dn) dn.textContent = n;
  var dp = document.getElementById('display-phone');     if (dp) dp.textContent = phoneState;
  var en = document.getElementById('edit-name');         if (en) en.value = n;
  var ep = document.getElementById('edit-phone');        if (ep) ep.value = phoneState;
}

function toggleEdit(show) {
  document.getElementById('profile-view').style.display = show ? 'none' : 'block';
  document.getElementById('profile-edit').style.display = show ? 'block' : 'none';
}

function saveProfile() {
  var name  = document.getElementById('edit-name').value.trim();
  var phone = document.getElementById('edit-phone').value.trim();
  if (name)  document.getElementById('display-name').textContent = name;
  if (phone) document.getElementById('display-phone').textContent = phone;
  toggleEdit(false);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DOCUMENTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

var _pendingDocField = null;
var _docsData = {};

var DOC_FIELDS = ['photo_driver', 'carte_grise_front', 'carte_grise_back', 'carte_identite_front', 'carte_identite_back', 'photo_vehicule'];

async function loadDocuments() {
  if (!token) return;
  try {
    var data = await apiFetch('/api/drivers/me');
    var driver = data.driver || {};
    _docsData = driver;
    DOC_FIELDS.forEach(function(f) { _setDocRowThumb(f, driver[f]); });
    var mat = document.getElementById('d-matricule');
    if (mat) mat.value = driver.matricule || '';
    var sub = document.getElementById('docs-status-sub');
    if (sub) {
      var filled = DOC_FIELDS.filter(function(f) { return !!driver[f]; }).length;
      sub.textContent = filled + '/' + DOC_FIELDS.length + ' documents ajoutés';
    }
  } catch (e) {}
}

function _setDocRowThumb(field, url) {
  var thumb = document.getElementById('d-thumb-' + field);
  var ph    = document.getElementById('d-ph-' + field);
  var hint  = document.getElementById('d-hint-' + field);
  if (url) {
    if (thumb) { thumb.src = url; thumb.style.display = 'block'; }
    if (ph)    ph.style.display = 'none';
    if (hint)  hint.textContent = 'Appuyer pour modifier';
  } else {
    if (thumb) thumb.style.display = 'none';
    if (ph)    ph.style.display = 'flex';
    if (hint)  hint.textContent = 'Appuyer pour ajouter';
  }
}

function uploadDocField(field) {
  _pendingDocField = field;
  var inp = document.getElementById('d-file-input');
  inp.value = '';
  inp.click();
}

async function handleDocFile(input) {
  if (!input.files || !input.files[0]) return;
  var field = _pendingDocField;
  if (!field || !token) return;
  var file = input.files[0];
  var hint = document.getElementById('d-hint-' + field);
  if (hint) hint.textContent = '⏳ Upload…';
  try {
    var fd = new FormData();
    fd.append('file', file);
    var upRes = await fetch(API_BASE + '/api/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: fd,
    });
    if (!upRes.ok) { if (hint) hint.textContent = 'Erreur upload'; return; }
    var { url } = await upRes.json();
    var patch = {}; patch[field] = url;
    await apiFetch('/api/drivers/me/documents', { method: 'PATCH', body: JSON.stringify(patch) });
    _docsData[field] = url;
    _setDocRowThumb(field, url);
    var sub = document.getElementById('docs-status-sub');
    if (sub) {
      var filled = DOC_FIELDS.filter(function(f) { return !!_docsData[f]; }).length;
      sub.textContent = filled + '/' + DOC_FIELDS.length + ' documents ajoutés';
    }
  } catch (e) {
    if (hint) hint.textContent = 'Erreur — réessayer';
  }
}

async function saveMatricule() {
  var mat = (document.getElementById('d-matricule').value || '').trim().toUpperCase();
  if (!mat) return;
  try {
    await apiFetch('/api/drivers/me/documents', { method: 'PATCH', body: JSON.stringify({ matricule: mat }) });
    _docsData.matricule = mat;
    alert('Immatriculation enregistrée : ' + mat);
  } catch (e) {
    alert('Erreur enregistrement.');
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  WALLET — même que l'original
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function selectProvider(p) {
  ['bankily', 'sedad'].forEach(function(x) { var b = document.getElementById('btn-' + x); if (b) b.classList.remove('active'); });
  var a = document.getElementById('btn-' + p); if (a) a.classList.add('active');
}

function validerRechargement() {
  var m = document.getElementById('wallet-montant').value;
  if (!m || parseInt(m) < 100) { alert('Montant minimum : 100 MRU.'); return; }
  alert('Rechargement de ' + m + ' MRU en cours de validation…');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  INIT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
document.addEventListener('DOMContentLoaded', function() {
  if (token && driverInfo) {
    // Déjà connecté — aller directement aux courses
    updateMenuProfile();
    connectSocket();
    syncDispoFromServer();
    loadAvailableDeliveries();
    loadActiveDeliveries();
    loadDocuments();
    go('s-courses');
  } else {
    go('s-login');
  }
  var input = document.getElementById('chat-text-input');
  if (input) { input.addEventListener('input', toggleSendMic); toggleSendMic(); }
});
