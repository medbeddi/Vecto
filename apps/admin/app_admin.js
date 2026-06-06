/* ================================================================
   VECTO — Dashboard Admin · app_admin.js
================================================================ */

/* ---- Utilisateurs & rôles ---- */
var USERS = [
  { login: 'admin',     password: '1234', role: 'admin'     },
  { login: 'operateur', password: '0000', role: 'operateur' },
];
var currentUser = null;

var ROLE_ACCESS = {
  admin:     ['p-stats','p-commandes','p-livreurs','p-clients','p-wallet','p-callcenter'],
  operateur: ['p-commandes','p-callcenter'],
};

var PAGE_TITLES = {
  'p-stats':      'Statistiques',
  'p-commandes':  'Commandes',
  'p-livreurs':   'Livreurs',
  'p-clients':    'Clients',
  'p-wallet':     'Wallets',
  'p-callcenter': 'Call Center',
};

/* ================================================================
   AUTH
================================================================ */
function login() {
  var loginVal = document.getElementById('login-input').value.trim();
  var passVal  = document.getElementById('password-input').value.trim();
  var user = USERS.find(function(u) { return u.login === loginVal && u.password === passVal; });
  if (!user) {
    document.getElementById('login-error').style.display = 'block';
    return;
  }
  currentUser = user;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('current-user-label').textContent = user.login + ' · ' + user.role;
  renderNav();
  renderCommandes('all');
  renderLivreurs();
  renderClients();
  renderWallet();
  showPage(ROLE_ACCESS[user.role][0]);
}

function logout() {
  currentUser = null;
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-input').value = '';
  document.getElementById('password-input').value = '';
  document.getElementById('login-error').style.display = 'none';
}

function renderNav() {
  document.querySelectorAll('.nav-item').forEach(function(item) {
    var onclick = item.getAttribute('onclick') || '';
    var match = onclick.match(/showPage\('([^']+)'\)/);
    if (match) {
      var allowed = ROLE_ACCESS[currentUser.role] || [];
      item.style.display = allowed.indexOf(match[1]) === -1 ? 'none' : 'flex';
    }
  });
}

/* ================================================================
   NAVIGATION
================================================================ */
var _ccMapInitialized = false;

function showPage(pageId) {
  if (!currentUser) return;
  var allowed = ROLE_ACCESS[currentUser.role] || [];
  if (allowed.indexOf(pageId) === -1) return;

  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });

  var page = document.getElementById(pageId);
  if (page) page.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(function(item) {
    if ((item.getAttribute('onclick') || '').includes(pageId)) item.classList.add('active');
  });

  document.getElementById('page-title').textContent = PAGE_TITLES[pageId] || '';

  if (pageId === 'p-callcenter' && !_ccMapInitialized) {
    setTimeout(function() { initCCMap(); _ccMapInitialized = true; }, 150);
  }
}

/* ================================================================
   DONNÉES
================================================================ */
var COMMANDES = [
  { id: '#001', type: 'Restaurant',  client: 'Ahmed M.',  livreur: 'Mohamed A.', prix: '150 MRU', statut: 'active'    },
  { id: '#002', type: 'Colis',       client: 'Fatima S.', livreur: 'Omar B.',    prix: '100 MRU', statut: 'done'      },
  { id: '#003', type: 'Supermarché', client: 'Sidi M.',   livreur: '—',          prix: '150 MRU', statut: 'active'    },
  { id: '#004', type: 'Restaurant',  client: 'Aisha K.',  livreur: 'Yusuf D.',   prix: '150 MRU', statut: 'done'      },
  { id: '#005', type: 'Colis',       client: 'Moussa T.', livreur: '—',          prix: '100 MRU', statut: 'cancelled' },
  { id: '#006', type: 'Restaurant',  client: 'Mariam L.', livreur: 'Ahmed S.',   prix: '150 MRU', statut: 'active'    },
];

var LIVREURS = [
  { nom: 'Mohamed A.', tel: '+222 44 12 34 56', statut: 'active',    courses: 248, note: '4.8', wallet: '1 250 MRU' },
  { nom: 'Omar B.',    tel: '+222 36 98 76 54', statut: 'active',    courses: 134, note: '4.6', wallet: '850 MRU'   },
  { nom: 'Yusuf D.',   tel: '+222 22 11 33 55', statut: 'inactive',  courses: 87,  note: '4.3', wallet: '200 MRU'   },
  { nom: 'Ahmed S.',   tel: '+222 44 55 66 77', statut: 'active',    courses: 312, note: '4.9', wallet: '2 100 MRU' },
  { nom: 'Bilal M.',   tel: '+222 33 22 11 00', statut: 'suspended', courses: 45,  note: '3.8', wallet: '0 MRU'     },
];

var CLIENTS = [
  { nom: 'Ahmed M.',   tel: '+222 36 45 67 89', commandes: 12, derniere: '20 mars 2026', statut: 'active'   },
  { nom: 'Fatima S.',  tel: '+222 44 11 22 33', commandes: 8,  derniere: '19 mars 2026', statut: 'active'   },
  { nom: 'Sidi M.',    tel: '+222 22 33 44 55', commandes: 3,  derniere: '15 mars 2026', statut: 'active'   },
  { nom: 'Aisha K.',   tel: '+222 33 44 55 66', commandes: 21, derniere: '20 mars 2026', statut: 'active'   },
  { nom: 'Moussa T.',  tel: '+222 44 55 66 77', commandes: 1,  derniere: '10 mars 2026', statut: 'inactive' },
  { nom: 'Mariam L.',  tel: '+222 55 66 77 88', commandes: 6,  derniere: '18 mars 2026', statut: 'active'   },
  { nom: 'Omar D.',    tel: '+222 66 77 88 99', commandes: 15, derniere: '20 mars 2026', statut: 'active'   },
  { nom: 'Khadija B.', tel: '+222 77 88 99 00', commandes: 2,  derniere: '5 mars 2026',  statut: 'inactive' },
  { nom: 'Yusuf A.',   tel: '+222 11 22 33 44', commandes: 9,  derniere: '17 mars 2026', statut: 'active'   },
  { nom: 'Aminata C.', tel: '+222 22 11 00 99', commandes: 4,  derniere: '12 mars 2026', statut: 'active'   },
];

var TRANSACTIONS = [
  { livreur: 'Mohamed A.', type: 'Rechargement', fournisseur: 'Bankily', montant: '+500 MRU', date: '20 mars · 10:00', statut: 'done'   },
  { livreur: 'Omar B.',    type: 'Commission',   fournisseur: '—',       montant: '-15 MRU',  date: '19 mars · 18:30', statut: 'done'   },
  { livreur: 'Ahmed S.',   type: 'Rechargement', fournisseur: 'Sedad',   montant: '+800 MRU', date: '18 mars · 09:00', statut: 'done'   },
  { livreur: 'Yusuf D.',   type: 'Rechargement', fournisseur: 'Bankily', montant: '+300 MRU', date: '17 mars · 14:00', statut: 'failed' },
  { livreur: 'Mohamed A.', type: 'Commission',   fournisseur: '—',       montant: '-10 MRU',  date: '17 mars · 11:30', statut: 'done'   },
];

var LIVREURS_ACTIFS = [
  { nom: 'Mohamed A.', lat: 18.0850, lng: -15.9650 },
  { nom: 'Omar B.',    lat: 18.0680, lng: -15.9720 },
  { nom: 'Ahmed S.',   lat: 18.0920, lng: -15.9500 },
];

/* ================================================================
   COMMANDES
================================================================ */
var STATUT_LABELS = {
  active:    '<span class="badge badge-blue">En cours</span>',
  done:      '<span class="badge badge-green">Livrée</span>',
  cancelled: '<span class="badge badge-red">Annulée</span>',
};

var currentFilter = 'all';

function renderCommandes(filter) {
  var tbody = document.getElementById('commandes-tbody');
  if (!tbody) return;
  var data = filter === 'all' ? COMMANDES : COMMANDES.filter(function(c) { return c.statut === filter; });
  var html = '';
  data.forEach(function(c) {
    html += '<tr>'
      + '<td style="font-weight:600">' + c.id + '</td>'
      + '<td>' + c.type + '</td>'
      + '<td>' + c.client + '</td>'
      + '<td>' + c.livreur + '</td>'
      + '<td style="font-weight:600">' + c.prix + '</td>'
      + '<td>' + (STATUT_LABELS[c.statut] || '') + '</td>'
      + '<td>' + (c.statut === 'active' ? '<button class="btn-table red" onclick="cancelCommande(\'' + c.id + '\')">Annuler</button>' : '—') + '</td>'
      + '</tr>';
  });
  tbody.innerHTML = html;
}

function filterCommandes(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-pills .filter-pill').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  renderCommandes(filter);
}

function cancelCommande(id) {
  document.getElementById('confirm-title').textContent   = 'Annuler la commande ' + id;
  document.getElementById('confirm-message').textContent = 'Cette action est irréversible.';
  document.getElementById('confirm-btn').onclick = function() {
    var c = COMMANDES.find(function(x) { return x.id === id; });
    if (c) c.statut = 'cancelled';
    renderCommandes(currentFilter);
    closeModal('modal-confirm');
  };
  showModal('modal-confirm');
}

/* ================================================================
   LIVREURS
================================================================ */
var STATUT_LIVREUR = {
  active:    '<span class="badge badge-green">Actif</span>',
  inactive:  '<span class="badge badge-grey">Inactif</span>',
  suspended: '<span class="badge badge-red">Suspendu</span>',
};

function renderLivreurs() {
  var tbody = document.getElementById('livreurs-tbody');
  if (!tbody) return;
  var html = '';
  LIVREURS.forEach(function(l, i) {
    html += '<tr>'
      + '<td style="font-weight:600">' + l.nom + '</td>'
      + '<td>' + l.tel + '</td>'
      + '<td>' + (STATUT_LIVREUR[l.statut] || '') + '</td>'
      + '<td>' + l.courses + '</td>'
      + '<td>★ ' + l.note + '</td>'
      + '<td style="font-weight:600">' + l.wallet + '</td>'
      + '<td>' + (l.statut !== 'suspended'
          ? '<button class="btn-table red" onclick="suspendLivreur(' + i + ')">Suspendre</button>'
          : '<button class="btn-table" onclick="reactivateLivreur(' + i + ')">Réactiver</button>') + '</td>'
      + '</tr>';
  });
  tbody.innerHTML = html;
}

function suspendLivreur(index) {
  document.getElementById('confirm-title').textContent   = 'Suspendre ' + LIVREURS[index].nom;
  document.getElementById('confirm-message').textContent = 'Le livreur ne pourra plus accepter de missions.';
  document.getElementById('confirm-btn').onclick = function() {
    LIVREURS[index].statut = 'suspended';
    renderLivreurs();
    closeModal('modal-confirm');
  };
  showModal('modal-confirm');
}

function reactivateLivreur(index) {
  LIVREURS[index].statut = 'active';
  renderLivreurs();
}

function addLivreur() {
  alert('Compte livreur créé ! Un SMS OTP sera envoyé au numéro renseigné.');
  closeModal('modal-add-livreur');
}

/* ================================================================
   CLIENTS
================================================================ */
function renderClients(data) {
  var tbody = document.getElementById('clients-tbody');
  if (!tbody) return;
  var html = '';
  (data || CLIENTS).forEach(function(c, i) {
    var badge = c.statut === 'active'
      ? '<span class="badge badge-green">Actif</span>'
      : '<span class="badge badge-grey">Inactif</span>';
    html += '<tr>'
      + '<td style="font-weight:600">' + c.nom + '</td>'
      + '<td>' + c.tel + '</td>'
      + '<td style="font-weight:600">' + c.commandes + '</td>'
      + '<td>' + c.derniere + '</td>'
      + '<td>' + badge + '</td>'
      + '<td><button class="btn-table" onclick="voirClientDetail(' + i + ')">Voir détail</button></td>'
      + '</tr>';
  });
  tbody.innerHTML = html || '<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:24px">Aucun client trouvé</td></tr>';
}

function filterClients() {
  var q = document.getElementById('client-search').value.toLowerCase();
  renderClients(CLIENTS.filter(function(c) {
    return c.nom.toLowerCase().includes(q) || c.tel.includes(q);
  }));
}

function voirClientDetail(index) {
  var c = CLIENTS[index];
  document.getElementById('client-detail-nom').textContent       = c.nom;
  document.getElementById('client-detail-tel').textContent       = c.tel;
  document.getElementById('client-detail-commandes').textContent = c.commandes + ' commandes';
  document.getElementById('client-detail-derniere').textContent  = c.derniere;
  document.getElementById('client-detail-statut').innerHTML =
    c.statut === 'active'
      ? '<span class="badge badge-green">Actif</span>'
      : '<span class="badge badge-grey">Inactif</span>';
  showModal('modal-client-detail');
}

/* ================================================================
   WALLET
================================================================ */
function renderWallet() {
  var tbody = document.getElementById('wallet-tbody');
  if (!tbody) return;
  var html = '';
  TRANSACTIONS.forEach(function(t) {
    var color  = t.montant.startsWith('+') ? '#1a7a35' : '#b86800';
    var badge  = t.statut === 'done'
      ? '<span class="badge badge-green">Validé</span>'
      : '<span class="badge badge-red">Échoué</span>';
    html += '<tr>'
      + '<td style="font-weight:600">' + t.livreur + '</td>'
      + '<td>' + t.type + '</td>'
      + '<td>' + t.fournisseur + '</td>'
      + '<td style="font-weight:700;color:' + color + '">' + t.montant + '</td>'
      + '<td>' + t.date + '</td>'
      + '<td>' + badge + '</td>'
      + '</tr>';
  });
  tbody.innerHTML = html;
}

/* ================================================================
   CALL CENTER
================================================================ */
var selectedType = 'restaurant';
var _ccDepartLocation = null;
var _ccDestLocation   = null;

function selectType(type) {
  selectedType = type;
  ['restaurant','supermarche','colis'].forEach(function(t) {
    var btn = document.getElementById('cc-type-' + t);
    if (btn) btn.classList.remove('active');
  });
  var btn = document.getElementById('cc-type-' + type);
  if (btn) btn.classList.add('active');
}

function searchClient() {
  var phone = document.getElementById('cc-phone').value;
  if (!phone) return;
  var banner = document.getElementById('cc-client-info');
  banner.style.display = 'flex';
  document.getElementById('cc-client-name').textContent = 'Ahmed M. — ' + phone;
}

function calcDistanceCC() {
  if (!_ccDepartLocation || !_ccDestLocation) return null;
  var lat1 = _ccDepartLocation.lat(), lng1 = _ccDepartLocation.lng();
  var lat2 = _ccDestLocation.lat(),   lng2 = _ccDestLocation.lng();
  var R = 6371;
  var dLat = (lat2-lat1) * Math.PI/180;
  var dLng = (lng2-lng1) * Math.PI/180;
  var a = Math.sin(dLat/2)*Math.sin(dLat/2) +
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
    Math.sin(dLng/2)*Math.sin(dLng/2);
  var dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  var prix = dist <= 5.5 ? 100 : 150;
  document.getElementById('cc-prix').textContent = prix + ' MRU';
  document.getElementById('cc-prix-detail').textContent =
    dist.toFixed(1) + ' km — ' + (dist <= 5.5 ? 'Zone courte (≤ 5,5 km)' : 'Zone longue (> 5,5 km)');
  return { dist: dist, prix: prix };
}

function initCCMap() {
  var mapEl = document.getElementById('cc-map');
  if (!mapEl) return;
  var nouakchott = { lat: 18.0735, lng: -15.9582 };
  var bounds = new google.maps.LatLngBounds(
    new google.maps.LatLng(17.9500, -16.0800),
    new google.maps.LatLng(18.2000, -15.8500)
  );
  var map = new google.maps.Map(mapEl, {
    zoom: 13, center: nouakchott, disableDefaultUI: true, zoomControl: true,
  });
  window._ccMap = map;

  var iwLivreur = new google.maps.InfoWindow();
  LIVREURS_ACTIFS.forEach(function(l) {
    var marker = new google.maps.Marker({
      position: { lat: l.lat, lng: l.lng }, map: map, title: l.nom,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#34C759', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
    });
    marker.addListener('click', function() {
      iwLivreur.setContent('<div style="font-family:sans-serif;padding:4px 2px"><div style="font-weight:700;font-size:13px">' + l.nom + '</div><div style="font-size:12px;margin-top:3px;color:#1a7a35">● Disponible</div></div>');
      iwLivreur.open(map, marker);
    });
  });

  var nbEl = document.getElementById('cc-nb-livreurs');
  if (nbEl) nbEl.textContent = LIVREURS_ACTIFS.length + ' livreurs disponibles sur la carte';

  var markerDepart = null, markerDest = null;
  var iconVert  = { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: '#34C759', fillOpacity:1, strokeColor:'#fff', strokeWeight:2 };
  var iconRouge = { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: '#FF3B30', fillOpacity:1, strokeColor:'#fff', strokeWeight:2 };

  var dsvc = new google.maps.DirectionsService();
  var drend = new google.maps.DirectionsRenderer({
    suppressMarkers: true,
    polylineOptions: { strokeColor: '#1A1A1A', strokeOpacity: .75, strokeWeight: 4 }
  });
  drend.setMap(map);

  function tracerRoute() {
    if (!_ccDepartLocation || !_ccDestLocation) return;
    dsvc.route({ origin: _ccDepartLocation, destination: _ccDestLocation, travelMode: google.maps.TravelMode.DRIVING },
      function(result, status) { if (status === 'OK') drend.setDirections(result); });
  }

  var acDepart = new google.maps.places.Autocomplete(
    document.getElementById('cc-depart'),
    { componentRestrictions: { country: 'mr' }, bounds: bounds, strictBounds: true, fields: ['geometry','name'] }
  );
  acDepart.addListener('place_changed', function() {
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
    { componentRestrictions: { country: 'mr' }, bounds: bounds, strictBounds: true, fields: ['geometry','name'] }
  );
  acDest.addListener('place_changed', function() {
    var place = acDest.getPlace();
    if (!place.geometry) return;
    _ccDestLocation = place.geometry.location;
    if (markerDest) markerDest.setPosition(_ccDestLocation);
    else markerDest = new google.maps.Marker({ position: _ccDestLocation, map: map, icon: iconRouge });
    map.panTo(_ccDestLocation);
    calcDistanceCC(); tracerRoute();
  });
}

function createCommande() {
  if (!_ccDepartLocation || !_ccDestLocation) {
    alert('Veuillez sélectionner les deux adresses.');
    return;
  }
  var result = calcDistanceCC();
  var newId = '#00' + (COMMANDES.length + 1);
  COMMANDES.unshift({
    id: newId,
    type: selectedType === 'restaurant' ? 'Restaurant' : selectedType === 'supermarche' ? 'Supermarché' : 'Colis',
    client: document.getElementById('cc-client-name').textContent || 'Client',
    livreur: '—',
    prix: result ? result.prix + ' MRU' : '150 MRU',
    statut: 'active',
  });
  alert('Commande ' + newId + ' créée et publiée !');
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
   INIT
================================================================ */
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
});
