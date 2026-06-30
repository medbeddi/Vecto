/* ================================================================
   Twilio Voice SDK — appels in-app pour le Centre d'Appels (CC)
================================================================ */

let _voiceDevice = null;
let _activeCall = null;
let _incomingCall = null;

async function initVoiceSDK() {
  if (typeof Twilio === 'undefined' || !Twilio.Device) {
    console.warn('[voice] Twilio Voice SDK non chargé');
    return;
  }
  try {
    const res = await fetch(API + '/api/calls/token', { headers: authHeaders() });
    if (!res.ok) {
      console.warn('[voice] token indisponible (Twilio non configuré ?)');
      return;
    }
    const { token } = await res.json();

    _voiceDevice = new Twilio.Device(token, { logLevel: 'error' });

    _voiceDevice.on('incoming', (call) => {
      _incomingCall = call;
      _showIncomingCallUI(call);
      call.on('cancel', _hideCallUI);
      call.on('disconnect', _hideCallUI);
      call.on('reject', _hideCallUI);
    });

    _voiceDevice.on('tokenWillExpire', async () => {
      try {
        const r = await fetch(API + '/api/calls/token', { headers: authHeaders() });
        const { token: fresh } = await r.json();
        _voiceDevice.updateToken(fresh);
      } catch {}
    });

    await _voiceDevice.register();
    console.info('[voice] CC enregistré pour recevoir des appels');
  } catch (err) {
    console.error('[voice] init échouée:', err.message);
  }
}

// ── Appel sortant (CC → driver ou client) ─────────────────────────────────
async function callIdentity(to, label) {
  if (!_voiceDevice) { alert('Le système d\'appel n\'est pas prêt.'); return; }
  if (_activeCall) { alert('Un appel est déjà en cours.'); return; }
  try {
    _activeCall = await _voiceDevice.connect({ params: { To: to } });
    _showActiveCallUI(label, 'Appel en cours…');
    _activeCall.on('accept', () => _showActiveCallUI(label, 'En communication'));
    _activeCall.on('disconnect', _hideCallUI);
    _activeCall.on('cancel', _hideCallUI);
    _activeCall.on('reject', _hideCallUI);
    _activeCall.on('error', _hideCallUI);
  } catch (err) {
    alert('Appel impossible : ' + err.message);
  }
}

function _acceptIncoming() {
  if (!_incomingCall) return;
  _incomingCall.accept();
  _activeCall = _incomingCall;
  _incomingCall = null;
  _showActiveCallUI(_activeCall.parameters?.From || 'Appelant', 'En communication');
}

function _rejectIncoming() {
  if (!_incomingCall) return;
  _incomingCall.reject();
  _incomingCall = null;
  _hideCallUI();
}

function _hangUpCall() {
  if (_activeCall) _activeCall.disconnect();
  _activeCall = null;
  _hideCallUI();
}

function _toggleMuteCall() {
  if (!_activeCall) return;
  const muted = !_activeCall.isMuted();
  _activeCall.mute(muted);
  const btn = document.getElementById('voice-mute-btn');
  if (btn) btn.classList.toggle('active', muted);
}

// ── UI minimaliste : bandeau d'appel flottant ──────────────────────────────
function _ensureCallBar() {
  let bar = document.getElementById('voice-call-bar');
  if (bar) return bar;
  bar = document.createElement('div');
  bar.id = 'voice-call-bar';
  bar.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1A1A1A;color:#fff;'
    + 'border-radius:16px;padding:16px 20px;box-shadow:0 8px 24px rgba(0,0,0,.3);z-index:9999;'
    + 'display:none;min-width:260px;font-family:inherit';
  document.body.appendChild(bar);
  return bar;
}

function _showActiveCallUI(label, status) {
  const bar = _ensureCallBar();
  bar.innerHTML = '<div style="font-weight:700;margin-bottom:4px">' + escHtml(label) + '</div>'
    + '<div style="font-size:13px;color:#AAA;margin-bottom:12px">' + escHtml(status) + '</div>'
    + '<div style="display:flex;gap:10px">'
    + '<button id="voice-mute-btn" onclick="_toggleMuteCall()" style="flex:1;padding:8px;border-radius:8px;border:none;background:#333;color:#fff;cursor:pointer">🎙️ Muet</button>'
    + '<button onclick="_hangUpCall()" style="flex:1;padding:8px;border-radius:8px;border:none;background:#FF3B30;color:#fff;cursor:pointer">📞 Raccrocher</button>'
    + '</div>';
  bar.style.display = 'block';
}

function _showIncomingCallUI(call) {
  const from = (call.parameters && call.parameters.From) || 'Appelant inconnu';
  const bar = _ensureCallBar();
  bar.innerHTML = '<div style="font-weight:700;margin-bottom:4px">📲 Appel entrant</div>'
    + '<div style="font-size:13px;color:#AAA;margin-bottom:12px">' + escHtml(from) + '</div>'
    + '<div style="display:flex;gap:10px">'
    + '<button onclick="_rejectIncoming()" style="flex:1;padding:8px;border-radius:8px;border:none;background:#FF3B30;color:#fff;cursor:pointer">Refuser</button>'
    + '<button onclick="_acceptIncoming()" style="flex:1;padding:8px;border-radius:8px;border:none;background:#34C759;color:#fff;cursor:pointer">Répondre</button>'
    + '</div>';
  bar.style.display = 'block';
}

function _hideCallUI() {
  const bar = document.getElementById('voice-call-bar');
  if (bar) bar.style.display = 'none';
  _activeCall = null;
}
