/* BAND APP 1.2.0 – VIDEOCHAT: soukromé video a hlasové hovory jen pro SCHVÁLENÉ členky skupiny.
 * Samostatný ES modul. Používá stejné přihlášení a stejný Firebase jako Kamarádky (friends.js), nic v nich nemění.
 * Obraz a zvuk jdou PŘÍMO mezi telefony (WebRTC, šifrováno DTLS-SRTP). Přes Firestore jde jen signalizace
 * (kdo volá, stav, technický popis spojení SDP – příjemkyně ho hned po zpracování smaže).
 * NIC se nenahrává ani neukládá. Žádný dohled, žádné reklamy, žádné cizí knihovny.
 * Přístup hlídají pravidla Firestore na serveru (firestore.rules → /rooms/{roomId}/calls):
 * jen schválená, nezablokovaná členka téže skupiny a jen účastnice daného hovoru.
 * Omezení: hovor zazvoní jen v OTEVŘENÉ BAND APP (i na pozadí, pokud ji telefon nechá běžet).
 * Úplně zavřená aplikace (hlavně iPhone) hovor nedostane – na to by byl potřeba push server. */
import { connect, local, knownAccountCode, isConfigured, isEmulator, notifyEnabled, notifySupported, lockedReason, firebaseBase, deviceCode, validToken, errText } from './friends.js';
import { ICE_SERVERS, STATIC_TURN_SERVERS, TURN_CREDENTIALS_URL, MAX_PARTICIPANTS } from './rtc-config.js';

const RING_MS = 45e3, RING_WINDOW_MS = 60e3, CALL_TTL_MS = 3 * 3600e3, HEARTBEAT_MS = 60e3, STALE_MS = 150e3, LOST_MS = 60e3,
  NOCONN_WARN_MS = 20e3, NOCONN_END_MS = 50e3;
const NOCONN_MSG = 'Spojení se nepodařilo – zkuste Wi-Fi.';   // síť nejspíš blokuje přímé spojení (bez TURN)
const NOTIFY_TAG = 'bandapp-hovor';
export const APP_VERSION = '1.2.6';
const RETRY_MS = 15e3, START_CHECK_MS = 15e3;
const $ = id => document.getElementById(id);
const rnd = () => { const b = new Uint8Array(9); crypto.getRandomValues(b); return Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); };
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
/* Ikony (vlastní SVG, žádné cizí soubory). */
const P = {
  mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  micOff: '<path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 10V6a3 3 0 0 0-5.7-1.3"/><path d="M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.7 3M12 18v3M3 3l18 18"/>',
  cam: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="M16 10l5-3v10l-5-3z"/>',
  camOff: '<path d="M16 16v1a1 1 0 0 1-1 1H6a3 3 0 0 1-3-3V9a3 3 0 0 1 2-2.8M9 6h4a3 3 0 0 1 3 3v1l5-3v10M3 3l18 18"/>',
  flip: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><path d="M9 13a3 3 0 0 0 5.6 1.5M15 12a3 3 0 0 0-5.6-1.5M14.5 15.5V14H13M9.5 9.5V11H11"/>',
  end: '<path d="M3 15c5-5 13-5 18 0l-2.5 2.5-3-1.5v-2.5a10 10 0 0 0-7 0V16l-3 1.5z"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  leave: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>'
};
const icon = (k, label) => h('span', { class: 'vc-ic', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + P[k] + '</svg>' });
const initial = n => (String(n || '?').trim()[0] || '?').toLocaleUpperCase('cs');

function injectStyle() {
  if ($('vc-style')) return;
  document.head.append(h('style', { id: 'vc-style', text: `
.bandnav{position:sticky;top:0;z-index:50;background:#0b0b0bf2;border-bottom:1px solid #3a1a1e;backdrop-filter:blur(6px)}
.bandnav div{max-width:850px;margin:auto;display:flex;gap:6px;overflow-x:auto;padding:8px 12px;scrollbar-width:none}
.bandnav a{flex:none;color:#e6e6ea;text-decoration:none;border:1px solid #3a1a1e;border-radius:999px;padding:8px 13px;font-size:14px;background:#161616}
.bandnav a.vc-nav{border-color:#b3001b;color:#fff;background:#2a0508;font-weight:bold;letter-spacing:.5px}
.vc button{min-height:44px;min-width:44px}.vc .note{color:#c0c0c8;font-size:14px;line-height:1.5}
.vc .vc-test{display:inline-block;background:#2a2a2e;color:#ffb3ba;border:1px solid #5c1219;border-radius:999px;padding:3px 10px;font-size:12px;margin-left:6px;vertical-align:middle}
.vc .vc-rooms{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.vc .vc-rooms button.on{background:#6b0d17}
.vc ul.vc-people{list-style:none;padding:0;margin:8px 0;display:grid;gap:8px}
.vc ul.vc-people li{display:flex;align-items:center;gap:10px;background:#1d1d1f;border:1px solid #3a1a1e;border-radius:14px;padding:8px 10px}
.vc .vc-av{flex:none;width:42px;height:42px;border-radius:50%;display:grid;place-items:center;font-weight:bold;color:#fff;background:radial-gradient(circle at 30% 25%,#e0202f,#5a0a12 70%);box-shadow:0 0 0 2px #2a0508,0 0 0 3px #5c1219}
.vc .vc-name{flex:1;font-weight:bold;word-break:break-word}.vc .vc-pick{width:24px;height:24px;accent-color:#b3001b}
.vc .vc-act{display:flex;gap:6px}.vc .vc-act button,.vc .vc-callbtn{display:inline-flex;align-items:center;gap:6px;background:#2a2a2e;color:#fff;border:1px solid #8b0000;border-radius:12px;padding:8px 12px;cursor:pointer;font:inherit}
.vc .vc-callbtn.primary{background:#b3001b;border-color:#b3001b}.vc .vc-ic{display:inline-grid;width:22px;height:22px}.vc-ic svg{width:100%;height:100%}
.vc .vc-err{background:#3a070c;border:1px solid #e0202f;border-radius:12px;padding:12px;color:#ffd6d9;margin:8px 0}
.vc .vc-live{background:#2a0508;border:1px solid #b3001b;border-radius:14px;padding:10px;margin:8px 0;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.vc button[disabled]{opacity:.5;cursor:not-allowed}
#vcCall,#vcIncoming{position:fixed;inset:0;z-index:10000;background:#050505;color:#f2f2f2;font:16px system-ui,Arial;display:flex;flex-direction:column}
#vcCall .vc-top{display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top)) 14px 10px;background:linear-gradient(#000c,#0000);position:absolute;left:0;right:0;top:0;z-index:3}
#vcCall .vc-title{flex:1;min-width:0}#vcCall .vc-title b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#vcCall .vc-state{font-size:13px;color:#e8c4c8}
#vcCall .vc-stage{flex:1;position:relative;overflow:hidden;padding:8px}
#vcCall .vc-grid{display:grid;gap:8px;height:100%;grid-template-columns:1fr;grid-auto-rows:1fr;padding-top:56px;padding-bottom:96px}
#vcCall .vc-grid.n2{grid-template-columns:1fr}#vcCall .vc-grid.n3,#vcCall .vc-grid.n4{grid-template-columns:1fr 1fr}
@media (orientation:landscape){#vcCall .vc-grid.n2{grid-template-columns:1fr 1fr}#vcCall .vc-grid.n3{grid-template-columns:1fr 1fr 1fr}}
.vc-tile{position:relative;background:#141414;border:1px solid #3a1a1e;border-radius:20px;overflow:hidden;min-height:0;display:grid;place-items:center}
.vc-tile video{width:100%;height:100%;object-fit:cover;background:#000}.vc-tile.self video{transform:scaleX(-1)}.vc-tile.self.back video{transform:none}
.vc-tile .vc-avbig{width:min(34%,140px);aspect-ratio:1;border-radius:50%;display:grid;place-items:center;font-size:clamp(28px,8vw,56px);font-weight:bold;color:#fff;background:radial-gradient(circle at 30% 25%,#e0202f,#3a070c 72%);box-shadow:0 0 0 3px #2a0508,0 0 0 5px #5c1219}
.vc-tile .vc-label{position:absolute;left:10px;bottom:10px;background:#000a;border-radius:999px;padding:4px 10px;font-size:14px;display:flex;gap:6px;align-items:center;max-width:calc(100% - 20px)}
.vc-tile .vc-label .vc-ic{width:16px;height:16px;color:#ff5a66}
.vc-tile.connecting .vc-avbig{animation:vcPulse 1.6s ease-in-out infinite}
.vc-tile.connecting::after{content:attr(data-st);position:absolute;top:58%;margin-top:clamp(40px,12vw,90px);font-size:14px;color:#e8c4c8;animation:vcFade 1.6s ease-in-out infinite}
@keyframes vcPulse{0%,100%{box-shadow:0 0 0 3px #2a0508,0 0 0 5px #5c1219}50%{box-shadow:0 0 0 3px #2a0508,0 0 0 14px #b3001b55}}
@keyframes vcFade{0%,100%{opacity:.45}50%{opacity:1}}
#vcCall .vc-one{position:absolute;inset:0}#vcCall .vc-one>.vc-tile.main{position:absolute;inset:0;border-radius:0;border:0}
#vcCall .vc-pip{position:absolute;width:min(30vw,150px);aspect-ratio:3/4;right:14px;bottom:110px;z-index:4;border-radius:16px;border:2px solid #5c1219;box-shadow:0 8px 24px #000c;touch-action:none;cursor:grab}
#vcCall .vc-ctrl{position:absolute;left:0;right:0;bottom:0;z-index:5;display:flex;justify-content:center;gap:12px;padding:14px 12px calc(16px + env(safe-area-inset-bottom));background:linear-gradient(#0000,#000d)}
#vcCall .vc-ctrl button,#vcCall .vc-top button{width:56px;height:56px;border-radius:50%;border:1px solid #3a1a1e;background:#1d1d1fe6;color:#fff;display:grid;place-items:center;cursor:pointer;padding:0}
#vcCall .vc-ctrl button .vc-ic{width:26px;height:26px}#vcCall .vc-ctrl button.off{background:#f2f2f2;color:#111}
#vcCall .vc-ctrl button.vc-hang{background:#c4001f;border-color:#c4001f;width:64px}
#vcCall .vc-top button{width:44px;height:44px}#vcCall .vc-top button .vc-ic{width:22px;height:22px}
#vcCall .vc-banner{position:absolute;left:50%;transform:translateX(-50%);top:calc(64px + env(safe-area-inset-top));z-index:6;background:#2a0508;border:1px solid #e0202f;border-radius:14px;padding:8px 14px;font-size:14px;max-width:92vw;text-align:center}
#vcCall .vc-list{position:absolute;right:10px;top:calc(62px + env(safe-area-inset-top));z-index:7;background:#141414;border:1px solid #5c1219;border-radius:16px;padding:10px 14px;min-width:220px;max-width:90vw;box-shadow:0 10px 30px #000c}
#vcCall .vc-list ul{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:6px}#vcCall .vc-list li{display:flex;justify-content:space-between;gap:12px}#vcCall .vc-list small{color:#c0c0c8}
#vcCall .vc-tapsound{position:absolute;left:50%;bottom:120px;transform:translateX(-50%);z-index:6;background:#b3001b;color:#fff;border:0;border-radius:12px;padding:12px 16px;font:inherit}
.vc-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(18px + env(safe-area-inset-bottom));z-index:10001;background:#2a0508;color:#ffd6d9;border:1px solid #e0202f;border-radius:14px;padding:10px 14px;font:14px system-ui,Arial;max-width:92vw;text-align:center}
#vcIncoming{align-items:center;justify-content:center;gap:18px;background:radial-gradient(circle at 50% 30%,#3a070c,#050505 65%);text-align:center;padding:24px}
#vcIncoming .vc-avbig{width:132px;height:132px;border-radius:50%;display:grid;place-items:center;font-size:56px;font-weight:bold;background:radial-gradient(circle at 30% 25%,#e0202f,#3a070c 72%);animation:vcPulse 1.4s ease-in-out infinite}
#vcIncoming h2{margin:0;font-size:28px;word-break:break-word}#vcIncoming p{margin:0;color:#e8c4c8}
#vcIncoming .vc-ans{display:flex;gap:28px;margin-top:18px}#vcIncoming .vc-ans button{min-width:132px;min-height:60px;border-radius:999px;border:0;color:#fff;font:bold 17px system-ui,Arial;letter-spacing:1px;display:inline-flex;gap:8px;align-items:center;justify-content:center;cursor:pointer}
#vcIncoming .vc-yes{background:#1f9d4c;box-shadow:0 0 0 6px #1f9d4c33}#vcIncoming .vc-no{background:#c4001f;box-shadow:0 0 0 6px #c4001f33}#vcIncoming .vc-ic{width:24px;height:24px}
.vc-diag{margin-top:14px;font-size:13px;color:#c0c0c8}.vc-diag summary{cursor:pointer;min-height:32px;padding:4px 0}.vc-diag dl{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin:8px 0}.vc-diag dt{color:#9a9aa2}.vc-diag dd{margin:0;color:#f2f2f2;word-break:break-word}
@media (prefers-reduced-motion:reduce){.vc-tile.connecting .vc-avbig,#vcIncoming .vc-avbig,.vc-tile.connecting::after{animation:none}}
` }));
}

/* ---------- stav ---------- */
const V = { fb: null, uid: null, root: null, roomId: null, members: new Map(), memUnsub: null, callSubs: new Map(), calls: new Map(), handled: new Set(), session: null, incoming: null, err: '', iceCache: null,
  my: new Map(), mySubs: new Map(), retry: new Map(), listen: new Map(), lastErr: null, lastSnap: 0, skew: 0, starting: false, started: false, diagEl: null,
  base: null, authHooked: false, srv: new Map(), srvState: 'neznámé', srvUnsub: null, names: new Map(), code: '',
  codes: new Map(), page: '', lastOut: null, lastIn: null };
/* 1.2.1: o členství rozhoduje SERVER (vlastní záznam rooms/{id}/members/{uid}), ne místní kopie role v localStorage.
 * (Místní role se v 1.2.0 obnovovala jen při otevření skupiny v Kamarádkách – čerstvě schválená členka proto
 * příchozí hovory vůbec neposlouchala.) Dokud server neodpoví, použije se místní role jen pro zobrazení. */
const OK_ROLES = ['owner', 'approved'];
const serverOk = id => OK_ROLES.includes(V.my.get(id));
/* 1.2.2: skupiny = místní seznam + VLASTNÍ členství na serveru (dotaz members.uid == moje uid, pravidla ho dovolují),
 * takže videochat funguje i s prázdným/jiným místním seznamem. Do localStorage videochat nic nezapisuje. */
const allRooms = () => { const m = new Map(local.rooms().map(r => [r.id, r]));
  for (const [id, st] of V.srv) if (!m.has(id)) m.set(id, { id, name: V.names.get(id) || 'Skupina', role: st }); return [...m.values()]; };
const approvedRooms = () => allRooms().filter(r => V.my.has(r.id) ? serverOk(r.id) : OK_ROLES.includes(V.srv.has(r.id) ? V.srv.get(r.id) : r.role));
const nowS = () => Date.now() - V.skew;              // odhad času serveru (hodiny telefonu můžou jít napřed/pozadu)
const errCode = e => String((e && e.code) || (e && e.name) || 'neznámá').replace(/^firestore\//, '').slice(0, 40);
function noteErr(where, e) { V.lastErr = { where, code: errCode(e), at: Date.now() }; }
const myNick = roomId => { const m = V.members.get(roomId) || new Map(), me = V.fb && m.get(V.fb.uid); return (me && me.nick) || local.nick() || 'Já'; };
const nickOf = (roomId, uid) => { const m = (V.members.get(roomId) || new Map()).get(uid); return (m && m.nick) || 'Kamarádka'; };
/* 1.2.5: kód účtu (prvních 6 znaků SHA-256 z uid – stejný jako v Kamarádkách) i u kontaktů a na obrazovce hovoru,
 * aby šlo poznat, KTERÝ účet se volá (např. dva záznamy „Táta…“). Počítá se jen v telefonu. */
function codeOf(uid) {
  if (!uid) return '';
  if (V.codes.has(uid)) return V.codes.get(uid) || '';
  V.codes.set(uid, ''); deviceCode(uid).then(c => { V.codes.set(uid, c || ''); render(); if (V.session) renderCall(V.session); }).catch(() => { });
  return '';
}
/* 1.2.5: průběh posledního odchozího / příchozího hovoru jen pro Diagnostiku (v paměti, nikam se neposílá). */
function noteCall(rec, patch) { if (rec) Object.assign(rec, patch); }
const tms = t => t && t.toMillis ? t.toMillis() : 0;
const live = c => c && c.status !== 'ended' && tms(c.expiresAt) > nowS();

async function iceServers() {
  if (isEmulator) return [];                                  // automatické testy: jen místní síť, žádné cizí servery
  const base = ICE_SERVERS.concat(Array.isArray(STATIC_TURN_SERVERS) ? STATIC_TURN_SERVERS : []);
  if (!TURN_CREDENTIALS_URL) return base;                     // bez TURN: jen STUN (výchozí stav)
  if (V.iceCache && V.iceCache.until > Date.now()) return V.iceCache.list;
  try {
    const tok = await V.fb.auth.currentUser.getIdToken();
    const room = V.session ? V.session.roomId : '';
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, tm = ctl && setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(TURN_CREDENTIALS_URL + (room ? (TURN_CREDENTIALS_URL.includes('?') ? '&' : '?') + 'room=' + encodeURIComponent(room) : ''),
      { headers: { Authorization: 'Bearer ' + tok }, signal: ctl ? ctl.signal : undefined, cache: 'no-store' });
    clearTimeout(tm);
    if (!r.ok) throw new Error('turn ' + r.status);
    const j = await r.json(), extra = Array.isArray(j.iceServers) ? j.iceServers : (j.iceServers && j.iceServers.urls ? [j.iceServers] : []);
    const list = base.concat(extra);
    V.iceCache = { list, until: Date.now() + 10 * 60e3 }; return list;
  } catch (e) { return base; }                                 // služba TURN nedostupná → hovor zkusí aspoň přímé spojení
}

/* ---------- média (kamera, mikrofon) ---------- */
function videoConstraints(facing, group) {
  // Šetří baterii a data: 1:1 max 640×360 při 24 fps, skupina 480×270 při 15 fps.
  return group ? { facingMode: facing, width: { ideal: 480 }, height: { ideal: 270 }, frameRate: { ideal: 15, max: 15 } }
    : { facingMode: facing, width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 24 } };
}
const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
function mediaErr(e, what) {
  const n = (e && e.name) || '';
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'BAND APP nemá povolený přístup ' + what + '. Povol ho v nastavení prohlížeče/telefonu (u adresy BAND APP) a zkus to znovu.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Toto zařízení nemá ' + (what.includes('kame') ? 'kameru' : 'mikrofon') + ', nebo není dostupná.';
  if (n === 'NotReadableError' || n === 'AbortError') return 'Kameru nebo mikrofon právě používá jiná aplikace. Zavři ji a zkus to znovu.';
  return 'Kameru ani mikrofon se nepodařilo zapnout.';
}
/* Vrátí { stream, cam, note }. Bez mikrofonu se volat nedá; když nejde kamera, hovor pokračuje jen se zvukem. */
async function getMedia(wantVideo, group) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('nomedia'), { text: 'Tento prohlížeč neumí hovory (WebRTC). Otevři BAND APP v aktuálním Chrome nebo Safari.' });
  if (wantVideo) {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: videoConstraints('user', group) }); return { stream: s, cam: true, note: '' }; }
    catch (e) {
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: AUDIO }); return { stream: s, cam: false, note: mediaErr(e, 'ke kameře') + ' Hovor pokračuje jen se zvukem.' }; }
      catch (e2) { throw Object.assign(e2, { text: mediaErr(e2, 'k mikrofonu') }); }
    }
  }
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: AUDIO }); return { stream: s, cam: false, note: '' }; }
  catch (e) { throw Object.assign(e, { text: mediaErr(e, 'k mikrofonu') }); }
}
const stopStream = s => { if (s) s.getTracks().forEach(t => { try { t.stop(); } catch (e) { } }); };

/* ---------- Firestore cesty ---------- */
const F = () => V.fb.F, db = () => V.fb.db;
const callRef = (roomId, callId) => F().doc(db(), 'rooms', roomId, 'calls', callId);
const peerRef = (roomId, callId, uid) => F().doc(db(), 'rooms', roomId, 'calls', callId, 'peers', uid);
async function writePeer(s, state, extra) {
  const d = Object.assign({ uid: V.fb.uid, nick: myNick(s.roomId), state, cam: !!s.cam, mic: !!s.mic, epoch: s.epoch, at: F().serverTimestamp() }, extra || {});
  return F().setDoc(peerRef(s.roomId, s.callId, V.fb.uid), d);
}
async function quickPeer(roomId, callId, state) {   // odmítnutí / obsazeno bez otevření hovoru
  return F().setDoc(peerRef(roomId, callId, V.fb.uid), { uid: V.fb.uid, nick: myNick(roomId), state, cam: false, mic: false, epoch: '', at: F().serverTimestamp() });
}
async function endCall(roomId, callId) { try { await F().updateDoc(callRef(roomId, callId), { status: 'ended', endedAt: F().serverTimestamp() }); } catch (e) { } }

/* ---------- spuštění ---------- */
export async function initVideochat() {
  // 1.2.5: naslouchání příchozím hovorům běží i na stránce pozvánky (join.html). Nainstalovaná BAND APP tam po
  // otevření pozvánky zůstane i po schválení (ukazuje chat) – v 1.2.4 tam hovory vůbec nezvonily.
  // Sekce VIDEOCHAT (seznam, diagnostika) se kreslí jen v hlavní aplikaci (#videochatApp).
  if (V.inited) return; V.inited = true;
  const root = $('videochatApp');
  injectStyle();
  if (root) { root.classList.add('vc'); V.root = root; }
  V.page = root ? 'hlavní aplikace' : 'stránka pozvánky (join.html)';
  render();
  // Naslouchání příchozím hovorům běží v celé aplikaci (ne jen v sekci VIDEOCHAT) a spustí se samo,
  // jakmile je v zařízení skupina – i když se člověk do skupiny přidá nebo je schválen až po otevření aplikace.
  ensureStarted();
  setInterval(ensureStarted, START_CHECK_MS);
  addEventListener('storage', e => { if (e.key && /friends-rooms$/.test(e.key)) ensureStarted(); });
  addEventListener('hashchange', ensureStarted);
  addEventListener('bandapp-account', ensureStarted);   // 1.2.3: účet výslovně založen / obnoven
  addEventListener('focus', ensureStarted);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ensureStarted(); onVisibility(); });
  addEventListener('pagehide', () => { const s = V.session; if (s) { try { writePeer(s, 'left'); } catch (e) { } } });
  addEventListener('online', () => { ensureStarted(); const s = V.session; if (s) { banner(s, 'Internet je zpět – obnovuji spojení…', 4000); s.pcs.forEach((p, uid) => { if (!connected(p)) reconnect(s, uid); }); } });
  addEventListener('offline', () => { const s = V.session; if (s) banner(s, 'Bez internetu – hovor se obnoví, až se připojení vrátí.'); });
}
/* 1.2.2: Firebase se načte vždy, když je nastavený (obnoví uložené přihlášení, žádný nový účet).
 * – přihlášený telefon (jakýkoli účet z Kamarádek/pozvánky) → připojit a naslouchat podle členství na serveru;
 * – nepřihlášený telefon se skupinou v zařízení → jako v 1.2.1 (connect, stejně jako otevření Kamarádek);
 * – nepřihlášený bez skupin → nic nezakládá, jen srozumitelně vysvětlí, jak pozvánku otevřít tady.
 * Volá se opakovaně – je levné a idempotentní. */
async function ensureStarted() {
  // 1.2.6: přihlášení zmizelo (odvolané / ztracené) → zastavit naslouchání a ukázat „odhlášeno – obnov účet“.
  if (V.fb && !V.fb.auth.currentUser) { stopAllRooms(); V.fb = null; V.started = false; V.uid = null; V.code = ''; }
  if (V.fb) { syncRooms(); return; }
  if (V.starting) return;
  V.starting = true;
  try {
    // 1.2.6 OPRAVA: dřív tu bylo „if (lockedReason() || …) return“. lockedReason() je ale jen MÍSTNÍ značka „tento
    // telefon měl účet s obnovovacím kódem“ (recoverable-uid) – nastaví se, jakmile si člověk kód vytvoří nebo účet
    // obnoví. VIDEOCHAT pak Firebase vůbec nenačetl (Firebase „nepřipojeno“, Přihlášení „odhlášeno“, naslouchání
    // neaktivní) i u PŘIHLÁŠENÉHO účtu. Rozhoduje jen skutečné přihlášení Firebase (auth.currentUser).
    if (!(await isConfigured())) { render(); return; }
    // Telefon, který se nikdy nepřihlásil (žádné uložené přihlášení Firebase) a nemá skupinu: Firebase ani App Check
    // se vůbec nenačítají (stejně jako v 1.1.3 bez otevření Kamarádek) – jen se zobrazí návod.
    if (!V.base && !local.rooms().length && !lockedReason() && (await persistedAuth()) === false) { V.noAuth = true; render(); return; }
    V.noAuth = false;
    if (!V.base) {
      try { V.base = await firebaseBase(); } catch (e) { noteErr('Firebase', e); V.authErr = { code: errCode(e), at: Date.now() }; V.err = 'Videochat se teď nepřipojil (zkontroluj internet).'; render(); return; }
      if (!V.authHooked) { V.authHooked = true; try { V.base.A.onAuthStateChanged(V.base.auth, () => { setTimeout(ensureStarted, 0); }); } catch (e) { } }
    }
    const u = V.base.auth.currentUser;
    V.code = u ? await deviceCode(u.uid) : '';
    if (!u && !local.rooms().length && !lockedReason()) { render(); return; }
    // 1.2.3: skupiny v zařízení, ale přihlášení chybí → žádný nový účet (connect() ho už nikdy nezaloží), jen vysvětlit.
    if (!u) { V.lost = await knownAccountCode(); noteErr('přihlášení', { code: lockedReason() ? 'bandapp/signed-out' : 'bandapp/no-account' }); render(); return; }
    V.lost = null;
    try { V.fb = await connect(); } catch (e) { noteErr('připojení', e); V.authErr = { code: errCode(e), at: Date.now() }; V.err = 'Videochat se teď nepřipojil (zkontroluj internet).'; render(); return; }
    V.code = await deviceCode(V.fb.uid);
    V.err = ''; V.started = true; syncRooms();
  } catch (e) { noteErr('start', e); render(); }
  finally { V.starting = false; }
}
/* Je v zařízení uložené přihlášení Firebase? (IndexedDB „firebaseLocalStorageDb“, klíč firebase:authUser:…)
 * true/false; null = nejde zjistit (pak se Firebase načte normálně). Nic nezapisuje a nezakládá. */
async function persistedAuth() {
  try {
    if (!indexedDB || !indexedDB.databases) return null;
    const dbs = await indexedDB.databases();
    if (!dbs.some(d => d.name === 'firebaseLocalStorageDb')) return false;
    return await new Promise(res => {
      const rq = indexedDB.open('firebaseLocalStorageDb');
      rq.onerror = () => res(null);
      rq.onsuccess = () => { const d = rq.result;
        try { if (!d.objectStoreNames.contains('firebaseLocalStorage')) { d.close(); return res(false); }
          const k = d.transaction('firebaseLocalStorage', 'readonly').objectStore('firebaseLocalStorage').getAllKeys();
          k.onsuccess = () => { d.close(); res(k.result.some(x => String(x).startsWith('firebase:authUser:'))); };
          k.onerror = () => { d.close(); res(null); };
        } catch (e) { try { d.close(); } catch (x) { } res(null); } };
    });
  } catch (e) { return null; }
}
/* Vlastní členství na serveru (živě): nové schválení / nová skupina se projeví bez restartu. */
function watchServerRooms() {
  const uid = V.uid; if (V.srvUnsub || V.srvRetry || !uid) return;
  V.srvState = 'načítá';
  try {
    V.srvUnsub = F().onSnapshot(F().query(F().collectionGroup(db(), 'members'), F().where('uid', '==', uid), F().limit(50)), { includeMetadataChanges: true }, snap => {
      if (V.uid !== uid) return;
      const m = new Map();
      snap.docs.forEach(d => { const rr = d.ref.parent.parent; if (rr && rr.parent.id === 'rooms') m.set(rr.id, String(d.data().status || '')); });
      if (snap.metadata && snap.metadata.fromCache && !m.size && V.srvState !== 'ok') return;   // čekáme na odpověď serveru
      V.srv = m; V.srvState = 'ok'; V.lastSnap = Date.now();
      for (const [id, st] of m) if (OK_ROLES.includes(st) && !V.names.has(id) && !local.rooms().some(r => r.id === id)) {
        V.names.set(id, 'Skupina');
        F().getDoc(F().doc(db(), 'rooms', id)).then(r => { if (r.exists() && r.data().name) { V.names.set(id, String(r.data().name).slice(0, 40)); render(); } }).catch(() => { });
      }
      syncRooms();
    }, e => {
      noteErr('moje skupiny', e); V.srvState = 'chyba (' + errCode(e) + ')';
      if (V.srvUnsub) { try { V.srvUnsub(); } catch (x) { } } V.srvUnsub = null;
      V.srvRetry = setTimeout(() => { V.srvRetry = null; if (V.uid === uid) watchServerRooms(); }, RETRY_MS); render();
    });
  } catch (e) { noteErr('moje skupiny', e); V.srvState = 'chyba (' + errCode(e) + ')'; V.srvUnsub = null; }
}
function stopAllRooms() {
  for (const id of [...new Set([...V.mySubs.keys(), ...V.callSubs.keys()])]) dropRoom(id);
  V.my.clear(); V.retry.forEach(t => clearTimeout(t)); V.retry.clear();
  if (V.srvUnsub) { try { V.srvUnsub(); } catch (e) { } } V.srvUnsub = null; clearTimeout(V.srvRetry); V.srvRetry = null; V.srv = new Map(); V.srvState = 'neznámé';
}
function dropRoom(id) {
  const u = V.mySubs.get(id); if (u) { try { u(); } catch (e) { } V.mySubs.delete(id); }
  unwatchRoom(id); V.my.delete(id); V.listen.delete(id);
}
function syncRooms() {
  if (!V.fb) return;
  const uid = V.fb.uid;
  if (uid !== V.uid) { stopAllRooms(); V.uid = uid; V.code = ''; if (uid) deviceCode(uid).then(c => { V.code = c; }); }   // jiný účet / odhlášení → vše znovu
  if (!uid) { render(); return; }
  watchServerRooms();
  const want = new Set(allRooms().map(r => r.id));                   // skupiny v zařízení i na serveru, i „čekající“
  for (const id of [...V.mySubs.keys()]) if (!want.has(id)) dropRoom(id);
  for (const id of want) if (!V.mySubs.has(id) && !V.retry.has(id)) watchMe(id);
  const ok = approvedRooms().map(r => r.id);
  if (!V.roomId || !ok.includes(V.roomId)) V.roomId = ok[0] || null;
  render();
}
/* Vlastní záznam členky (pravidla: get vlastního záznamu smí vždy). Schválená/zakladatelka → poslouchat hovory. */
function watchMe(roomId) {
  const uid = V.uid;
  V.mySubs.set(roomId, F().onSnapshot(F().doc(db(), 'rooms', roomId, 'members', uid), d => {
    if (V.uid !== uid) return;
    const st = d.exists() ? String(d.data().status || '') : null;
    V.my.set(roomId, st);
    if (OK_ROLES.includes(st)) { if (!V.callSubs.has(roomId)) watchRoom(roomId); }
    else { unwatchRoom(roomId); V.listen.set(roomId, { state: st === 'pending' ? 'čeká na schválení' : 'není členkou', at: Date.now() }); }
    syncRoomsLight();
  }, e => {
    noteErr('členství', e); V.listen.set(roomId, { state: 'chyba', code: errCode(e), at: Date.now() });
    const u = V.mySubs.get(roomId); if (u) { try { u(); } catch (x) { } } V.mySubs.delete(roomId);
    retryLater(roomId); render();
  }));
}
function retryLater(roomId) {
  if (V.retry.has(roomId)) return;
  V.retry.set(roomId, setTimeout(() => { V.retry.delete(roomId); syncRooms(); }, RETRY_MS));
}
function syncRoomsLight() { const ok = approvedRooms().map(r => r.id); if (!V.roomId || !ok.includes(V.roomId)) V.roomId = ok[0] || null; render(); }
function unwatchRoom(roomId) {
  const u = V.callSubs.get(roomId); if (!u) return;
  u.forEach(f => { try { f(); } catch (e) { } }); V.callSubs.delete(roomId); V.members.delete(roomId);
  for (const k of [...V.calls.keys()]) if (k.startsWith(roomId + '/')) V.calls.delete(k);
}
function watchRoom(roomId) {
  const subs = []; V.callSubs.set(roomId, subs);
  V.listen.set(roomId, { state: 'připojuje se', at: Date.now() });
  subs.push(F().onSnapshot(F().collection(db(), 'rooms', roomId, 'members'), s => {
    const m = new Map(); s.docs.forEach(d => m.set(d.id, d.data())); V.members.set(roomId, m); render(); checkMembers();
  }, e => { noteErr('členky', e); V.members.delete(roomId); render(); }));
  // Jen hovory, kde jsem účastnice (pravidla jiný dotaz nepustí: participants array-contains vlastní uid).
  let first = true;
  subs.push(F().onSnapshot(F().query(F().collection(db(), 'rooms', roomId, 'calls'), F().where('participants', 'array-contains', V.uid)), { includeMetadataChanges: false }, s => {
    V.lastSnap = Date.now(); V.listen.set(roomId, { state: 'naslouchá', at: Date.now() });
    for (const [k, c] of V.calls) if (c.roomId === roomId) V.calls.delete(k);
    s.docs.forEach(d => V.calls.set(roomId + '/' + d.id, Object.assign({ id: d.id, roomId }, d.data({ serverTimestamps: 'estimate' }))));
    // Hovor, který přibyl až po prvním načtení (a přišel ze serveru), je čerstvý – zazvoní bez ohledu na hodiny telefonu.
    const fresh = !first && !s.metadata.fromCache;
    s.docChanges().forEach(ch => {
      if (ch.type === 'removed') return;
      const c = V.calls.get(roomId + '/' + ch.doc.id);
      if (fresh && ch.type === 'added' && c && c.createdBy !== V.uid && tms(c.createdAt)) V.skew = Date.now() - tms(c.createdAt) - 300;
      onCallDoc(c, fresh && ch.type === 'added');
    });
    if (!s.metadata.fromCache) first = false;
    sweep(roomId); render();
  }, e => {
    // Dřív se chyba tiše zahodila. Teď se zapíše do diagnostiky a naslouchání se za chvíli obnoví.
    noteErr('hovory', e); V.listen.set(roomId, { state: 'chyba', code: errCode(e), at: Date.now() });
    unwatchRoom(roomId); V.listen.set(roomId, { state: 'chyba', code: errCode(e), at: Date.now() });
    const u = V.mySubs.get(roomId); if (u) { try { u(); } catch (x) { } } V.mySubs.delete(roomId);
    retryLater(roomId); render();
  }));
}
/* Úklid: ukončené a prošlé hovory smaže (vlastní záznam účastnice + hovor). Nic dalšího se neuchovává. */
function sweep(roomId) {
  for (const c of V.calls.values()) {
    if (c.roomId !== roomId || live(c) || (V.session && V.session.callId === c.id)) continue;
    if (V.handled.has('sweep/' + c.id)) continue; V.handled.add('sweep/' + c.id);
    F().deleteDoc(peerRef(roomId, c.id, V.fb.uid)).catch(() => { }).then(() => F().deleteDoc(callRef(roomId, c.id))).catch(() => { });
  }
}

/* ---------- příchozí hovor ---------- */
async function onCallDoc(c, fresh) {
  if (!c || !V.fb || c.createdBy === V.fb.uid || !live(c)) return;
  if (V.handled.has(c.id) || (V.incoming && V.incoming.id === c.id) || (V.session && V.session.callId === c.id)) return;
  if (c.status !== 'ringing' && c.status !== 'active') return;
  if (!fresh && nowS() - tms(c.createdAt) > RING_WINDOW_MS) return;  // starší hovor jen v seznamu „Probíhající hovory“
  V.handled.add(c.id);
  let mine = null; try { const s = await F().getDoc(peerRef(c.roomId, c.id, V.fb.uid)); mine = s.exists() ? s.data() : null; } catch (e) { }
  if (mine) return;                                                   // už vyřízeno (třeba na jiném zařízení)
  const s = V.session;
  if (s) {
    // Obě si zavolaly současně: vyhraje hovor s menším ID, druhý se zruší (žádné dvojité hovory).
    const same = s.outgoing && s.participants.length === 2 && c.participants.length === 2 && c.participants.includes(s.participants.find(u => u !== V.fb.uid));
    if (same && !s.anyJoined && c.id < s.callId) { await hangup(s, true); acceptCall(c); return; }
    if (same) return;
    quickPeer(c.roomId, c.id, 'busy').catch(() => { }); return;       // jsem v jiném hovoru → „obsazeno“
  }
  V.incoming = c;
  V.lastIn = { at: Date.now(), callId: c.id, code: V.codes.get(c.createdBy) || '', phase: 'zazvonil', result: 'zvoní' };
  if (!V.lastIn.code) { const rec = V.lastIn; deviceCode(c.createdBy).then(x => { rec.code = x; }).catch(() => { }); }
  showIncoming(c);
}
function showIncoming(c) {
  closeIncoming(true);
  const who = c.nick || nickOf(c.roomId, c.createdBy), video = c.kind === 'video';
  const others = c.participants.length - 1;
  const el = h('div', { id: 'vcIncoming', role: 'alertdialog', 'aria-label': 'Příchozí hovor' },
    h('div', { class: 'vc-avbig', text: initial(who) }),
    h('h2', { id: 'vcInName', text: who }),
    h('p', { id: 'vcInKind', text: (video ? '📹 Příchozí videohovor' : '📞 Příchozí hlasový hovor') + (others > 1 ? ' · skupinový (' + (others + 1) + ' účastnice)' : '') }),
    h('div', { class: 'vc-ans' },
      h('button', { type: 'button', class: 'vc-no', id: 'vcDecline', onclick: () => declineCall(c) }, icon('end'), 'ODMÍTNOUT'),
      h('button', { type: 'button', class: 'vc-yes', id: 'vcAccept', onclick: () => acceptCall(c) }, icon(video ? 'cam' : 'phone'), 'PŘIJMOUT')));
  document.body.append(el);
  ring(true);
  if (document.visibilityState === 'hidden') systemNotify();
  V.incomingTimer = setTimeout(() => { if (V.incoming && V.incoming.id === c.id) { V.incoming = null; if (V.lastIn && V.lastIn.callId === c.id) V.lastIn.result = 'nepřijato (vypršelo)'; closeIncoming(); render(); } }, Math.max(RING_MS, RING_WINDOW_MS - (nowS() - tms(c.createdAt))));
}
function closeIncoming(keep) { const e = $('vcIncoming'); if (e) e.remove(); ring(false); clearTimeout(V.incomingTimer); if (!keep) closeNotification(); }
async function declineCall(c) {
  V.incoming = null; closeIncoming();
  if (V.lastIn && V.lastIn.callId === c.id) V.lastIn.result = 'odmítnuto';
  try { await quickPeer(c.roomId, c.id, 'declined'); } catch (e) { }
  render();
}
async function acceptCall(c) {
  V.incoming = null; closeIncoming();
  await joinCall(c, c.kind === 'video');
}
/* Systémové upozornění jen když je BAND APP na pozadí a uživatelka si upozornění sama zapnula v Kamarádkách.
 * Text je obecný (bez přezdívky – kvůli zamčené obrazovce). */
async function systemNotify() {
  try {
    if (!notifyEnabled() || !notifySupported() || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.getRegistration(); if (!reg) return;
    await reg.showNotification('BAND APP – příchozí hovor', { body: 'Volá ti kamarádka. Otevři BAND APP.', tag: NOTIFY_TAG, renotify: true, requireInteraction: true, icon: 'icon-192.png', vibrate: [300, 200, 300, 200, 300] });
  } catch (e) { }
}
async function closeNotification() { try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) (await reg.getNotifications({ tag: NOTIFY_TAG })).forEach(n => n.close()); } catch (e) { } }
/* Jemné vyzvánění (vlastní tón přes Web Audio, žádný soubor) + vibrace, kde to telefon umí. */
function ring(on) {
  clearInterval(V.ringTimer); V.ringTimer = null;
  if (!on) { try { navigator.vibrate && navigator.vibrate(0); } catch (e) { } return; }
  const beep = () => {
    try {
      const ctx = V.ac || (V.ac = new (window.AudioContext || window.webkitAudioContext)());
      if (ctx.state === 'suspended') ctx.resume().catch(() => { });
      [0, .28].forEach(d => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = 660; g.gain.setValueAtTime(0, ctx.currentTime + d); g.gain.linearRampToValueAtTime(.12, ctx.currentTime + d + .03); g.gain.linearRampToValueAtTime(0, ctx.currentTime + d + .22); o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + .25); });
    } catch (e) { }
    try { navigator.vibrate && navigator.vibrate([250, 150, 250]); } catch (e) { }
  };
  beep(); V.ringTimer = setInterval(beep, 2200);
}

/* ---------- zahájení / připojení ---------- */
async function startCall(roomId, others, video) {
  V.err = '';
  if (V.session) { V.err = 'Už jsi v hovoru.'; render(); return; }
  others = [...new Set(others)].filter(u => u && u !== V.fb.uid).slice(0, MAX_PARTICIPANTS - 1);
  if (!others.length) return;
  const parts = [V.fb.uid, ...others], key = [...parts].sort().join(',');
  // Žádné duplicitní hovory: probíhající hovor se stejnými účastnicemi → připojit se do něj.
  const dup = [...V.calls.values()].find(c => c.roomId === roomId && live(c) && [...c.participants].sort().join(',') === key);
  if (dup) return joinCall(dup, video);
  let media; try { media = await getMedia(video, parts.length > 2); } catch (e) { V.err = e.text || mediaErr(e, 'k mikrofonu'); render(); return; }
  const ref = F().doc(F().collection(db(), 'rooms', roomId, 'calls'));
  const call = { createdBy: V.fb.uid, nick: myNick(roomId), kind: video ? 'video' : 'audio', mode: parts.length === 2 ? 'direct' : 'group', participants: parts, status: 'ringing', createdAt: F().serverTimestamp(), expiresAt: F().Timestamp.fromMillis(Date.now() + CALL_TTL_MS) };
  try { await F().setDoc(ref, call); }
  catch (e) { stopStream(media.stream); V.err = /permission/.test(e && e.code) ? 'Hovor nejde zahájit – volat smí jen schválené členky skupiny (a jen schváleným členkám).' : 'Hovor se nepodařilo zahájit. Zkontroluj internet.'; render(); return; }
  V.handled.add(ref.id);
  V.lastOut = { at: Date.now(), callId: ref.id, code: others.length === 1 ? (V.codes.get(others[0]) || await deviceCode(others[0]).catch(() => '')) : others.length + ' účastnice', phase: 'vyzvání', result: 'probíhá' };
  await enterSession(Object.assign({ id: ref.id, roomId }, call, { createdAt: F().Timestamp.now() }), media, true);
}
async function joinCall(c, video) {
  V.err = ''; V.handled.add(c.id);
  if (V.session) { if (V.session.callId === c.id) return; V.err = 'Už jsi v jiném hovoru.'; render(); return; }
  let media; try { media = await getMedia(video, c.participants.length > 2); }
  catch (e) { V.err = e.text || mediaErr(e, 'k mikrofonu'); try { await quickPeer(c.roomId, c.id, 'declined'); } catch (x) { } render(); return; }
  await enterSession(c, media, false);
}

/* ---------- hovor ---------- */
async function enterSession(c, media, outgoing) {
  const s = V.session = {
    roomId: c.roomId, callId: c.id, call: c, kind: c.kind, mode: c.mode, participants: c.participants.slice(), outgoing,
    stream: media.stream, cam: media.cam, mic: true, facing: 'user', epoch: rnd(), peers: new Map(), pcs: new Map(), seen: new Map(), firstTry: new Map(), everConn: new Set(),
    sent: [], unsubs: [], started: Date.now(), anyJoined: false, ended: false, hiddenPaused: false, lastBeat: 0
  };
  s.diag = outgoing ? (V.lastOut && V.lastOut.callId === c.id ? V.lastOut : null)
    : (V.lastIn && V.lastIn.callId === c.id ? V.lastIn : (V.lastIn = { at: Date.now(), callId: c.id, code: '', phase: 'připojení k hovoru', result: 'probíhá' }));
  if (!outgoing) { noteCall(s.diag, { phase: 'přijato', result: 'probíhá' }); if (!s.diag.code) deviceCode(c.createdBy).then(x => { s.diag.code = x; }).catch(() => { }); }
  buildCallUI(s);
  try { navigator.mediaDevices.enumerateDevices().then(d => { s.multiCam = d.filter(x => x.kind === 'videoinput').length > 1; renderCall(s); }).catch(() => { }); } catch (e) { }
  if (media.note) banner(s, media.note, 7000);
  try { await writePeer(s, 'joined'); }
  catch (e) { banner(s, 'Do hovoru se nejde připojit (už skončil, nebo k němu nemáš přístup).'); setTimeout(() => teardown(s, ''), 2500); return; }
  if (!outgoing && c.status === 'ringing') F().updateDoc(callRef(s.roomId, s.callId), { status: 'active' }).catch(() => { });
  s.unsubs.push(F().onSnapshot(callRef(s.roomId, s.callId), d => {
    if (s.ended) return;
    if (!d.exists()) return teardown(s, 'Hovor skončil.');
    s.call = Object.assign({ id: d.id, roomId: s.roomId }, d.data({ serverTimestamps: 'estimate' }));
    if (s.call.status === 'ended') teardown(s, 'Hovor skončil.');
  }, () => teardown(s, 'Přístup k hovoru skončil.')));
  s.unsubs.push(F().onSnapshot(F().collection(db(), 'rooms', s.roomId, 'calls', s.callId, 'peers'), snap => {
    if (s.ended) return;
    snap.docs.forEach(d => { if (d.id !== V.fb.uid) { s.peers.set(d.id, d.data()); s.seen.set(d.id, Date.now()); } });
    onPeers(s);
  }, () => { }));
  s.unsubs.push(F().onSnapshot(F().query(F().collection(db(), 'rooms', s.roomId, 'calls', s.callId, 'signals'), F().where('to', '==', V.fb.uid)), snap => {
    snap.docChanges().forEach(ch => { if (ch.type === 'added') onSignal(s, ch.doc.id, ch.doc.data()); });
  }, () => { }));
  s.tick = setInterval(() => tick(s), 5e3);
  render();
}
function onPeers(s) {
  for (const uid of s.participants) {
    if (uid === V.fb.uid) continue;
    const p = s.peers.get(uid);
    if (!p) continue;
    if (p.state === 'joined') {
      if (!s.anyJoined) noteCall(s.diag, { phase: 'přijato' });
      s.anyJoined = true;
      if (!s.firstTry.has(uid)) s.firstTry.set(uid, Date.now());   // 1.2.5: odtud se počítá limit „Spojení se nepodařilo“
      const cur = s.pcs.get(uid);
      if (V.fb.uid < uid && (!cur || cur.remoteEpoch !== p.epoch)) makeOffer(s, uid, p.epoch);
    } else closePeer(s, uid);
    if (s.mode === 'direct' && (p.state === 'declined' || p.state === 'busy')) { noteCall(s.diag, { result: p.state === 'busy' ? 'obsazeno' : 'odmítnuto' }); banner(s, p.state === 'busy' ? 'Kamarádka je zrovna v jiném hovoru.' : 'Hovor byl odmítnut.'); setTimeout(() => hangup(s, true), 1800); }
    else if (s.mode === 'direct' && p.state === 'left' && s.anyJoined) hangup(s, true, 'Hovor skončil.');
  }
  if (s.mode === 'group' && s.anyJoined && !othersAlive(s).length && [...s.peers.values()].every(p => p.state !== 'joined')) hangup(s, true, 'Všechny odešly – hovor skončil.');
  renderCall(s);
}
const othersAlive = s => s.participants.filter(u => u !== V.fb.uid && (s.peers.get(u) || {}).state === 'joined' && Date.now() - (s.seen.get(u) || 0) < STALE_MS);
const connected = p => p && p.pc && ['connected', 'completed'].includes(p.pc.iceConnectionState);

async function newPc(s, uid) {
  const pc = new RTCPeerConnection({ iceServers: await iceServers(), bundlePolicy: 'max-bundle' });
  const entry = { pc, sid: '', remoteEpoch: '', stream: new MediaStream(), state: 'new', lostAt: 0, offerer: V.fb.uid < uid };
  if (!s.firstTry.has(uid)) s.firstTry.set(uid, Date.now());
  pc.ontrack = e => { if (!entry.stream.getTracks().includes(e.track)) entry.stream.addTrack(e.track); e.track.onunmute = () => renderCall(s); e.track.onmute = () => renderCall(s); renderCall(s); };
  pc.oniceconnectionstatechange = () => {
    const st = pc.iceConnectionState; entry.state = st;
    noteCall(s.diag, Object.assign({ phase: 'ICE: ' + st }, (st === 'connected' || st === 'completed') ? { result: 'spojeno' } : {}));
    if (st === 'connected' || st === 'completed') { entry.lostAt = 0; entry.restarts = 0; s.everConn.add(uid); if (s.noConnWarned) { s.noConnWarned = false; banner(s, 'Spojeno.', 2500); } }
    else if ((st === 'disconnected' || st === 'failed') && !entry.lostAt) entry.lostAt = Date.now();
    if (st === 'failed') reconnect(s, uid);
    renderCall(s);
  };
  return entry;
}
function attachLocal(s, entry, fromOffer) {
  const pc = entry.pc, a = s.stream.getAudioTracks()[0] || null, v = s.stream.getVideoTracks()[0] || null;
  let ta, tv;
  if (fromOffer) { const ts = pc.getTransceivers(); ta = ts.find(t => t.receiver.track.kind === 'audio'); tv = ts.find(t => t.receiver.track.kind === 'video'); }
  // Vždy audio i video kanál (sendrecv) – kameru jde zapnout i v hlasovém hovoru bez nového vyjednávání.
  if (!ta) ta = pc.addTransceiver('audio', { direction: 'sendrecv' }); else ta.direction = 'sendrecv';
  if (!tv) tv = pc.addTransceiver('video', { direction: 'sendrecv' }); else tv.direction = 'sendrecv';
  ta.sender.replaceTrack(a).catch(() => { }); tv.sender.replaceTrack(v).catch(() => { });
  entry.audio = ta.sender; entry.video = tv.sender;
}
function limitBitrate(s, entry) {
  const cap = (sender, max) => { try { const p = sender.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}]; p.encodings[0].maxBitrate = max; sender.setParameters(p).catch(() => { }); } catch (e) { } };
  cap(entry.video, s.participants.length > 2 ? 350e3 : 650e3); cap(entry.audio, 40e3);
}
/* Bez „trickle ICE“: počká na sesbírání kandidátů (max 3 s) a pošle jedinou zprávu – méně zápisů do databáze. */
const gathered = pc => new Promise(r => { if (pc.iceGatheringState === 'complete') return r(); const t = setTimeout(r, 3000); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); r(); } }); });
async function sendSignal(s, to, type, sid, sdp) {
  const ref = F().doc(F().collection(db(), 'rooms', s.roomId, 'calls', s.callId, 'signals'));
  s.sent.push(ref); return F().setDoc(ref, { from: V.fb.uid, to, type, sid, sdp, createdAt: F().serverTimestamp() });
}
async function makeOffer(s, uid, epoch) {
  if (s.ended) return;
  closePeer(s, uid);
  const entry = await newPc(s, uid); entry.sid = rnd(); entry.remoteEpoch = epoch; s.pcs.set(uid, entry);
  attachLocal(s, entry, false);
  try {
    await entry.pc.setLocalDescription(await entry.pc.createOffer());
    limitBitrate(s, entry);
    await gathered(entry.pc);
    if (s.ended || s.pcs.get(uid) !== entry) return;
    await sendSignal(s, uid, 'offer', entry.sid, entry.pc.localDescription.sdp);
    if (!connected(entry)) noteCall(s.diag, { phase: 'nabídka odeslána' });
  } catch (e) { noteCall(s.diag, { phase: 'nabídka selhala (' + errCode(e) + ')' }); entry.lostAt = entry.lostAt || Date.now(); }
  renderCall(s);
}
async function onSignal(s, id, d) {
  F().deleteDoc(F().doc(db(), 'rooms', s.roomId, 'calls', s.callId, 'signals', id)).catch(() => { });   // zpracováno → hned smazat
  if (s.ended || !s.participants.includes(d.from)) return;
  try {
    if (d.type === 'offer') {
      closePeer(s, d.from);
      const entry = await newPc(s, d.from); entry.sid = d.sid; entry.remoteEpoch = (s.peers.get(d.from) || {}).epoch || ''; s.pcs.set(d.from, entry);
      await entry.pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
      attachLocal(s, entry, true);
      await entry.pc.setLocalDescription(await entry.pc.createAnswer());
      limitBitrate(s, entry);
      await gathered(entry.pc);
      if (s.ended || s.pcs.get(d.from) !== entry) return;
      await sendSignal(s, d.from, 'answer', d.sid, entry.pc.localDescription.sdp);
      if (!connected(entry)) noteCall(s.diag, { phase: 'nabídka přijata, odpověď odeslána' });
    } else if (d.type === 'answer') {
      const entry = s.pcs.get(d.from);
      if (entry && entry.sid === d.sid && entry.pc.signalingState === 'have-local-offer') { await entry.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp }); if (!connected(entry)) noteCall(s.diag, { phase: 'odpověď přijata' }); }
    }
  } catch (e) { }
  renderCall(s);
}
/* Obnova spojení po výpadku: nabízející strana pošle novou nabídku (nové ICE), druhá strana o ni požádá
 * změnou svého „epoch“ (nabízející pak nabídne znovu). */
function reconnect(s, uid) {
  if (s.ended || !navigator.onLine) return;
  const entry = s.pcs.get(uid), p = s.peers.get(uid);
  if (!p || p.state !== 'joined') return;
  if (entry && Date.now() - (entry.lastRestart || 0) < 8e3) return;
  if (entry) entry.lastRestart = Date.now();
  if (V.fb.uid < uid) makeOffer(s, uid, p.epoch).then(() => { const e = s.pcs.get(uid); if (e) e.lastRestart = Date.now(); });
  else { s.epoch = rnd(); writePeer(s, 'joined').catch(() => { }); }
}
function closePeer(s, uid) {
  const e = s.pcs.get(uid); if (!e) return;
  s.pcs.delete(uid); try { e.pc.ontrack = e.pc.oniceconnectionstatechange = null; e.pc.close(); } catch (x) { }
  e.stream.getTracks().forEach(t => { try { t.stop(); } catch (x) { } });
}
function tick(s) {
  if (s.ended) return;
  const now = Date.now();
  if (now - s.lastBeat > HEARTBEAT_MS) { s.lastBeat = now; writePeer(s, 'joined').catch(() => { }); }   // „jsem tu“ (1× za minutu)
  if (!s.anyJoined && now - s.started > RING_MS) {
    const c = s.mode === 'direct' ? codeOf(s.participants.find(u => u !== V.fb.uid)) : '';
    noteCall(s.diag, { result: 'nikdo nepřijal' });
    hangup(s, true, 'Nikdo to nevzal. Hovor zazvoní jen na telefonu, kde je přihlášený účet' + (c ? ' ' + c : '') + ' a BAND APP je otevřená.'); return;
  }
  // Spojení se vůbec nenavázalo (signalizace funguje, ale síť nepustí obraz/zvuk – typicky bez TURN na mobilních datech):
  // po 20 s jasná hláška, 1:1 hovor po 50 s skončí se stejnou hláškou (žádné nekonečné „připojuji…“).
  // 1.2.5: platí pro KAŽDOU připojenou účastnici – i když nabídka spojení vůbec nedorazila (dřív se hlídaly jen
  // existující spojení, takže přijímající strana bez nabídky mohla „připojovat“ donekonečna).
  for (const uid of s.participants) {
    if (uid === V.fb.uid) continue;
    const p = s.peers.get(uid), e = s.pcs.get(uid);
    if (!connected(e) && !s.everConn.has(uid) && p && p.state === 'joined' && navigator.onLine) {
      const waited = now - (s.firstTry.get(uid) || now);
      if (waited > NOCONN_WARN_MS && !s.noConnWarned) { s.noConnWarned = true; banner(s, NOCONN_MSG); }
      if (waited > NOCONN_END_MS && s.mode === 'direct') { noteCall(s.diag, { result: 'spojení se nenavázalo (' + (e ? 'ICE ' + e.pc.iceConnectionState : 'nabídka nedorazila') + ')' }); hangup(s, true, NOCONN_MSG); return; }
    }
  }
  for (const [uid, e] of s.pcs) {
    if (!connected(e) && e.lostAt && now - e.lostAt > 6e3) reconnect(s, uid);
    const stale = now - (s.seen.get(uid) || 0) > STALE_MS;
    if (!connected(e) && e.lostAt && now - e.lostAt > LOST_MS && stale) {
      closePeer(s, uid); s.peers.set(uid, Object.assign({}, s.peers.get(uid), { state: 'left' }));
      if (s.mode === 'direct') { hangup(s, true, 'Spojení se nepodařilo obnovit. Hovor skončil. ' + NOCONN_MSG); return; }
    }
  }
  if (s.mode === 'direct' && s.anyJoined && !s.pcs.size && now - (s.seen.get(s.participants.find(u => u !== V.fb.uid)) || 0) > STALE_MS) { hangup(s, true, 'Spojení se nepodařilo obnovit. Hovor skončil.'); return; }
  renderCall(s);
}
/* Kontrola členství během hovoru: kdo přestal být schválenou členkou (odebrání, zablokování), je odpojena. */
function checkMembers() {
  const s = V.session; if (!s) return;
  const m = V.members.get(s.roomId); if (!m) return;
  const room = m;
  if (!room.size) return;
  if (!room.has(V.fb.uid) || !['owner', 'approved'].includes(room.get(V.fb.uid).status)) { teardown(s, 'Už nejsi schválenou členkou skupiny – hovor skončil.'); return; }
  for (const uid of s.participants) if (uid !== V.fb.uid && (!room.has(uid) || !['owner', 'approved'].includes(room.get(uid).status))) closePeer(s, uid);
}

/* Ukončit (1:1) / opustit (skupina). Skupinový hovor pro ostatní pokračuje; poslední odcházející ho ukončí. */
async function hangup(s, endForAll, msg) {
  if (!s || s.ended) return;
  const last = s.mode === 'direct' || !othersAlive(s).length;
  teardown(s, msg || '');
  try { await writePeer(s, 'left'); } catch (e) { }
  if (endForAll && last || s.mode === 'direct') await endCall(s.roomId, s.callId);
}
function teardown(s, msg) {
  if (s.ended) return; s.ended = true;
  clearInterval(s.tick);
  s.unsubs.forEach(u => { try { u(); } catch (e) { } }); s.unsubs = [];
  [...s.pcs.keys()].forEach(uid => closePeer(s, uid));
  stopStream(s.stream); s.stream = null;                         // kamera i mikrofon se uvolní (kontrolka zhasne)
  s.sent.forEach(r => F().deleteDoc(r).catch(() => { }));         // nedoručená signalizace se smaže
  const ui = $('vcCall'); if (ui) ui.remove();
  if (V.session === s) V.session = null;
  V.err = msg || ''; render();
  noteCall(s.diag, s.diag && s.diag.result === 'probíhá' ? { result: msg ? msg.replace(/\.$/, '') : 'ukončeno' } : {});
  if (!V.root && msg) toast(msg);                                 // stránka pozvánky nemá sekci VIDEOCHAT → krátká hláška
  setTimeout(() => sweep(s.roomId), 3000);                       // ukončený hovor se z databáze smaže
}
function toast(text) {
  const old = document.querySelector('.vc-toast'); if (old) old.remove();
  const t = h('div', { class: 'vc-toast', role: 'status', id: 'vcToast', text }); document.body.append(t); setTimeout(() => t.remove(), 12e3);
}
function onVisibility() {
  const s = V.session; if (!s || s.ended) return;
  // Úspora baterie: na pozadí se kamera zastaví (zvuk běží dál), po návratu se znovu zapne.
  if (document.visibilityState === 'hidden' && s.cam) { s.hiddenPaused = true; setCam(s, false, true); }
  else if (document.visibilityState === 'visible' && s.hiddenPaused) { s.hiddenPaused = false; setCam(s, true, true); }
}

/* ---------- ovládání ---------- */
function setMic(s, on) { s.mic = on; s.stream.getAudioTracks().forEach(t => t.enabled = on); writePeer(s, 'joined').catch(() => { }); renderCall(s); }
async function setCam(s, on, auto) {
  if (s.ended) return;
  if (!on) {
    s.stream.getVideoTracks().forEach(t => { t.stop(); s.stream.removeTrack(t); });   // kamera opravdu vypnutá (kontrolka zhasne)
    s.pcs.forEach(e => e.video && e.video.replaceTrack(null).catch(() => { }));
    s.cam = false;
  } else {
    try {
      const ns = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(s.facing, s.participants.length > 2) });
      const t = ns.getVideoTracks()[0]; if (s.ended) { t.stop(); return; }
      s.stream.getVideoTracks().forEach(x => { x.stop(); s.stream.removeTrack(x); });
      s.stream.addTrack(t); s.pcs.forEach(e => e.video && e.video.replaceTrack(t).catch(() => { }));
      s.cam = true;
    } catch (e) { if (!auto) banner(s, mediaErr(e, 'ke kameře'), 6000); s.cam = false; }
  }
  if (!auto || !s.hiddenPaused) writePeer(s, 'joined').catch(() => { });
  renderCall(s);
}
async function flipCam(s) {
  if (!s.cam) return;
  const want = s.facing === 'user' ? 'environment' : 'user';
  try {
    const ns = await navigator.mediaDevices.getUserMedia({ video: videoConstraints({ exact: want }, s.participants.length > 2) });
    const t = ns.getVideoTracks()[0];
    s.stream.getVideoTracks().forEach(x => { x.stop(); s.stream.removeTrack(x); });
    s.stream.addTrack(t); s.pcs.forEach(e => e.video && e.video.replaceTrack(t).catch(() => { }));
    s.facing = want; renderCall(s);
  } catch (e) { banner(s, 'Druhá kamera není na tomto zařízení dostupná.', 4000); }
}
function banner(s, text, ms) {
  const ui = $('vcCall'); if (!ui) return;
  let b = ui.querySelector('.vc-banner'); if (!b) { b = h('div', { class: 'vc-banner', role: 'status', 'aria-live': 'polite' }); ui.append(b); }
  b.textContent = text; b.hidden = false; clearTimeout(b._t); if (ms) b._t = setTimeout(() => { b.hidden = true; }, ms);
}

/* ---------- obrazovka hovoru ---------- */
function buildCallUI(s) {
  const old = $('vcCall'); if (old) old.remove();
  const ui = h('div', { id: 'vcCall', role: 'dialog', 'aria-label': 'Hovor' },
    h('div', { class: 'vc-top' }, h('div', { class: 'vc-title' }, h('b', { id: 'vcTitle' }), h('span', { class: 'vc-state', id: 'vcState' })),
      h('button', { type: 'button', id: 'vcPeople', 'aria-label': 'Účastnice hovoru', title: 'Účastnice hovoru', onclick: () => { s.showList = !s.showList; renderCall(s); } }, icon('users'))),
    h('div', { class: 'vc-stage', id: 'vcStage' }),
    h('div', { class: 'vc-ctrl' },
      h('button', { type: 'button', id: 'vcMic', onclick: () => setMic(s, !s.mic) }),
      h('button', { type: 'button', id: 'vcCam', onclick: () => setCam(s, !s.cam) }),
      h('button', { type: 'button', id: 'vcFlip', 'aria-label': 'Přepnout přední/zadní kameru', title: 'Přepnout kameru', onclick: () => flipCam(s) }, icon('flip')),
      h('button', { type: 'button', id: 'vcHang', class: 'vc-hang', onclick: () => hangup(s, true) })));
  document.body.append(ui);
  s.tiles = new Map();
  renderCall(s);
}
function tileFor(s, uid) {
  let t = s.tiles.get(uid);
  if (!t) {
    const self = uid === V.fb.uid;
    const v = h('video', { autoplay: true, playsinline: true }); v.playsInline = true; if (self) v.muted = true;
    const av = h('div', { class: 'vc-avbig' }), lab = h('div', { class: 'vc-label' });
    const el = h('div', { class: 'vc-tile' + (self ? ' self' : ''), 'data-uid': uid }, v, av, lab);
    t = { el, v, av, lab }; s.tiles.set(uid, t);
  }
  return t;
}
function setStream(v, st) { if (v.srcObject !== st) { v.srcObject = st; } if (st && v.paused) v.play().catch(() => showTapSound()); }
function showTapSound() {
  const ui = $('vcCall'); if (!ui || ui.querySelector('.vc-tapsound')) return;
  const b = h('button', { type: 'button', class: 'vc-tapsound', text: '🔊 Klepni pro zapnutí zvuku', onclick: () => { ui.querySelectorAll('video').forEach(v => v.play().catch(() => { })); b.remove(); } });
  ui.append(b);
}
const STATE_TXT = { joined: 'v hovoru', declined: 'odmítla', busy: 'v jiném hovoru', left: 'odešla' };
function renderCall(s) {
  const ui = $('vcCall'); if (!ui || s.ended) return;
  const me = V.fb.uid, others = s.participants.filter(u => u !== me);
  const active = others.filter(u => (s.peers.get(u) || {}).state === 'joined');
  const anyConn = [...s.pcs.values()].some(connected);
  const oc = s.mode === 'direct' ? codeOf(others[0]) : '';
  $('vcTitle').textContent = s.mode === 'direct' ? nickOf(s.roomId, others[0]) + (oc ? ' · kód ' + oc : '') : 'Skupinový hovor · ' + (active.length + 1) + '/' + s.participants.length;
  $('vcState').textContent = (s.kind === 'video' ? '📹 Videohovor' : '📞 Hlasový hovor') + ' · ' + (anyConn ? 'spojeno' : (s.anyJoined ? 'připojuji…' : (s.outgoing ? 'vyzvání…' : 'připojuji…'))) + (navigator.onLine ? '' : ' · bez internetu');
  const mic = $('vcMic'), cam = $('vcCam'), hang = $('vcHang'), flip = $('vcFlip');
  mic.replaceChildren(icon(s.mic ? 'mic' : 'micOff')); mic.classList.toggle('off', !s.mic); mic.setAttribute('aria-label', s.mic ? 'Vypnout mikrofon' : 'Zapnout mikrofon'); mic.title = mic.getAttribute('aria-label'); mic.setAttribute('aria-pressed', String(!s.mic));
  cam.replaceChildren(icon(s.cam ? 'cam' : 'camOff')); cam.classList.toggle('off', !s.cam); cam.setAttribute('aria-label', s.cam ? 'Vypnout kameru' : 'Zapnout kameru'); cam.title = cam.getAttribute('aria-label'); cam.setAttribute('aria-pressed', String(!s.cam));
  flip.hidden = !s.cam || s.multiCam === false;   // jen když má zařízení přední i zadní kameru
  const group = s.mode === 'group';
  hang.replaceChildren(icon(group ? 'leave' : 'end')); hang.setAttribute('aria-label', group ? 'Opustit hovor' : 'Ukončit hovor'); hang.title = hang.getAttribute('aria-label');
  // dlaždice
  const stage = $('vcStage'), shown = [me, ...(active.length ? active : others.slice(0, s.mode === 'direct' ? 1 : 0))];
  const pip = active.length <= 1 && !(group && active.length === 0 && others.length > 1);
  for (const uid of shown) {
    const t = tileFor(s, uid), self = uid === me, p = self ? { nick: myNick(s.roomId), cam: s.cam, mic: s.mic } : (s.peers.get(uid) || { nick: nickOf(s.roomId, uid), cam: s.kind === 'video', mic: true });
    const e = self ? null : s.pcs.get(uid), st = self ? s.stream : e && e.stream;
    const vt = st && st.getVideoTracks().find(x => x.readyState === 'live' && !x.muted);
    const showVid = !!(p.cam && vt);
    setStream(t.v, st || null); t.v.hidden = !showVid; t.av.hidden = showVid; t.av.textContent = initial(p.nick || nickOf(s.roomId, uid));
    t.el.classList.toggle('connecting', !self && !connected(e));
    // 1.2.5: poctivý stav – dokud volaná hovor nepřijala, „Vyzvání…“ (dřív tu bylo „Připojuji…“ i při vyzvánění).
    const ps = !self && s.peers.get(uid);
    t.el.dataset.st = self || connected(e) ? '' : ps && ps.state === 'joined' ? 'Připojuji…' : ps && STATE_TXT[ps.state] ? STATE_TXT[ps.state] : (s.outgoing ? 'Vyzvání…' : 'Připojuji…');
    t.el.classList.toggle('back', self && s.facing !== 'user');
    t.lab.replaceChildren(p.mic === false ? icon('micOff') : '', document.createTextNode((self ? 'Ty' : (p.nick || nickOf(s.roomId, uid))) + (self || connected(e) ? '' : (e && e.lostAt ? ' · obnovuji…' : ''))));
  }
  for (const [uid, t] of s.tiles) if (!shown.includes(uid)) { t.v.srcObject = null; t.el.remove(); s.tiles.delete(uid); }
  if (pip) {
    let one = stage.querySelector('.vc-one'); if (!one) { stage.replaceChildren(one = h('div', { class: 'vc-one' })); }
    const other = shown.find(u => u !== me), mainT = other ? tileFor(s, other) : null, selfT = tileFor(s, me);
    if (mainT) { mainT.el.className = mainT.el.className.replace(/\bvc-pip\b/, '') ; mainT.el.classList.add('main'); if (mainT.el.parentNode !== one) one.append(mainT.el); }
    selfT.el.classList.remove('main'); selfT.el.classList.add('vc-pip'); if (selfT.el.parentNode !== one) one.append(selfT.el);
    makeDraggable(selfT.el);
  } else {
    let g = stage.querySelector('.vc-grid'); if (!g) stage.replaceChildren(g = h('div', { class: 'vc-grid' }));
    g.className = 'vc-grid n' + Math.min(4, shown.length);
    shown.forEach(uid => { const t = tileFor(s, uid); t.el.classList.remove('vc-pip', 'main'); t.el.style.left = t.el.style.top = ''; if (t.el.parentNode !== g) g.append(t.el); });
  }
  // přehled účastnic
  let list = ui.querySelector('.vc-list');
  if (s.showList) {
    if (!list) { list = h('div', { class: 'vc-list', id: 'vcList' }); ui.append(list); }
    list.replaceChildren(h('b', { text: 'Účastnice hovoru' }), h('ul', {}, h('li', {}, h('span', { text: myNick(s.roomId) + ' (ty)' }), h('small', { text: 'v hovoru' })),
      others.map(u => { const p = s.peers.get(u); return h('li', { 'data-uid': u }, h('span', { text: ((p && p.nick) || nickOf(s.roomId, u)) + (codeOf(u) ? ' · ' + codeOf(u) : '') }), h('small', { text: p ? (p.state === 'joined' && !connected(s.pcs.get(u)) ? 'připojuje se…' : STATE_TXT[p.state] || '') : 'vyzvání…' })); })));
  } else if (list) list.remove();
}
function makeDraggable(el) {
  if (el._drag) return; el._drag = true;
  let sx, sy, ox, oy, on = false;
  el.addEventListener('pointerdown', e => { if (!el.classList.contains('vc-pip')) return; on = true; el.setPointerCapture(e.pointerId); const r = el.getBoundingClientRect(); sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; });
  el.addEventListener('pointermove', e => {
    if (!on) return; const W = innerWidth, H = innerHeight, r = el.getBoundingClientRect();
    const x = Math.max(6, Math.min(W - r.width - 6, ox + e.clientX - sx)), y = Math.max(6, Math.min(H - r.height - 6, oy + e.clientY - sy));
    el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
  });
  const up = () => { on = false; }; el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}

/* ---------- sekce VIDEOCHAT ---------- */
/* 1.2.2: srozumitelné vysvětlení, proč tady hovory nejsou, + bezpečná cesta: otevřít pozvánku PŘÍMO v této BAND APP. */
function inviteToken(v) { v = String(v || '').trim(); const m = /[#&?]t=([A-Za-z0-9_-]{22})(?![A-Za-z0-9_-])/.exec(v); const t = m ? m[1] : v; return validToken(t) ? t : ''; }
function notMember(kind) {
  const out = [];
  if (kind === 'pending') {
    out.push(h('div', { class: 'note', id: 'vcNoRooms', 'data-state': 'pending', text: '⏳ Tento telefon čeká na schválení ve skupině. Až tě zakladatelka v Kamarádkách schválí, hovory se tady zapnou samy (bez restartu).' }));
    if (V.code) out.push(h('p', { class: 'note', id: 'vcMyCode', text: 'Kód účtu: ' + V.code + ' – zakladatelka ho uvidí u tvé žádosti.' }));
    return out;
  }
  out.push(h('div', { class: 'vc-err', role: 'alert', id: 'vcNoRooms', 'data-state': kind === 'signed-out' ? 'not-signed-in' : 'not-member' },
    h('strong', { text: 'Tento telefon není přihlášený jako schválený člen skupiny.' }),
    h('p', { text: kind === 'signed-out'
      ? 'Tahle BAND APP zatím není přihlášená k žádnému účtu. Pokud ses do skupiny přidal(a) přes odkaz pozvánky v prohlížeči nebo v jiné aplikaci, je to jiné přihlášení než tady – proto ti sem hovory nechodí. Nejlepší je účet tam zabezpečit (Kamarádky → Můj účet → 🔐 Zabezpečit účet) a tady ho obnovit obnovovacím kódem – kód účtu zůstane stejný.'
      : 'Tahle BAND APP je přihlášená, ale v žádné skupině tu nejsi. Pokud ses přidal(a) přes odkaz pozvánky v prohlížeči nebo v jiné aplikaci, je to jiné přihlášení než tady.' }),
    h('p', { text: 'Jinak: požádej zakladatelku skupiny o NOVOU pozvánku a vlož odkaz sem. Pozvánka se otevře přímo v této BAND APP; zakladatelka pak osobně převede tvoje členství na tento účet (podle kódu účtu). Nic se nesmaže.' })));
  if (V.code) out.push(h('p', { class: 'note', id: 'vcMyCode', text: 'Kód účtu: ' + V.code }));
  if (V.lost) out.push(h('div', { class: 'vc-err', id: 'vcLostAccount', 'data-state': 'lost-session', text: '⚠️ Tady byl dřív přihlášený účet s kódem ' + V.lost + ', ale přihlášení chybí. Nezakládej nový účet: obnov ho v Kamarádkách (♻️ Mám obnovovací kód), nebo používej telefon/prohlížeč, kde jsi přihlášená.' }));
  const inp = h('input', { type: 'url', id: 'vcInviteLink', placeholder: 'Vlož odkaz pozvánky (…join.html#t=…)', autocomplete: 'off', 'aria-label': 'Odkaz pozvánky' });
  const err = h('div', { class: 'vc-err', role: 'alert', hidden: true });
  const go = h('button', { type: 'button', class: 'vc-callbtn primary', id: 'vcInviteGo', onclick: () => {
    const t = inviteToken(inp.value);
    if (!t) { err.hidden = false; err.textContent = 'Tohle nevypadá jako odkaz pozvánky BAND APP.'; return; }
    location.href = 'join.html' + location.search + '#t=' + encodeURIComponent(t);   // stejná adresa a rozsah → zůstává v nainstalované aplikaci
  } }, 'Otevřít pozvánku tady');
  out.push(h('div', { class: 'vc-act', style: 'flex-wrap:wrap' }, inp, go), err);
  return out;
}
function render() {
  const root = V.root; if (!root) return;
  const kids = [];
  kids.push(h('p', { class: 'note' }, 'Soukromé video a hlasové hovory jen pro schválené členky tvé skupiny. Obraz a zvuk jdou přímo mezi vámi (šifrovaně), nic se nenahrává ani neukládá.'));
  if (V.err) kids.push(h('div', { class: 'vc-err', role: 'alert', id: 'vcErr', text: V.err }));
  const rooms = approvedRooms();
  if (!V.fb) {
    const out = (V.noAuth || (V.base && !V.base.auth.currentUser));
    if (out && lockedReason()) { kids.push(h('div', { class: 'vc-err', role: 'alert', 'data-state': 'signed-out', id: 'vcSignedOut', text: '🔒 Odhlášeno – obnov účet' + (V.lost ? ' ' + V.lost : '') + '. Tento telefon není přihlášený k Firebase, proto hovory nezvoní. Kamarádky → ♻️ Mám obnovovací kód → zadej svůj obnovovací kód. Nový účet nezakládej.' })); put(root, kids); return; }
    if (out) { kids.push(...notMember('signed-out')); put(root, kids); return; }
    kids.push(h('p', { class: 'note', 'data-state': 'no-rooms', id: 'vcNoRooms', text: rooms.length ? 'Videochat se připojuje…' : (lockedReason() && !V.base ? 'Ověřuji přihlášení…' : lockedReason() ? 'Tento telefon je v Kamarádkách odhlášený. Přihlas se tam znovu obnovovacím kódem – potom se zapnou i hovory.' : 'Videochat je jen pro schválené členky skupiny. Nejdřív se přidej do skupiny v sekci Kamarádky (a počkej na schválení).') }));
    put(root, kids); return;
  }
  if (!rooms.length) {
    if (V.srvState !== 'ok' && V.srvState.indexOf('chyba') !== 0 && !allRooms().length) { kids.push(h('p', { class: 'note', id: 'vcNoRooms', 'data-state': 'loading', text: 'Načítám tvoje skupiny…' })); put(root, kids); return; }
    const pend = allRooms().some(r => (V.my.has(r.id) ? V.my.get(r.id) : (V.srv.get(r.id) || r.role)) === 'pending');
    kids.push(...notMember(pend ? 'pending' : 'none')); put(root, kids); return;
  }
  if (rooms.length > 1) kids.push(h('div', { class: 'vc-rooms' }, rooms.map(r => h('button', { type: 'button', class: 'secondary' + (r.id === V.roomId ? ' on' : ''), onclick: () => { V.roomId = r.id; render(); } }, r.name || 'Skupina'))));
  const roomId = V.roomId, mem = V.members.get(roomId);
  // probíhající hovory (k návratu po výpadku nebo pro skupinový hovor, který už běží)
  const lives = [...V.calls.values()].filter(c => c.roomId === roomId && live(c) && (!V.session || V.session.callId !== c.id));
  lives.forEach(c => kids.push(h('div', { class: 'vc-live', 'data-call': c.id },
    h('span', { text: (c.kind === 'video' ? '📹 ' : '📞 ') + (c.mode === 'group' ? 'Skupinový hovor' : 'Hovor') + ' – volá ' + (c.createdBy === V.fb.uid ? 'ty' : (c.nick || nickOf(roomId, c.createdBy))) }),
    h('button', { type: 'button', class: 'vc-callbtn primary', 'data-act': 'rejoin', disabled: !!V.session, onclick: () => joinCall(c, c.kind === 'video') }, 'Připojit se'))));
  if (!mem) { kids.push(h('p', { class: 'note', text: 'Načítám členky…' })); put(root, kids); return; }
  // Zablokované členky nemají záznam (zakladatelka ho blokováním smaže) – nabízí se jen schválené.
  const people = [...mem.values()].filter(m => m.uid !== V.fb.uid && (m.status === 'owner' || m.status === 'approved')).sort((a, b) => String(a.nick).localeCompare(String(b.nick), 'cs'));
  if (!people.length) { kids.push(h('p', { class: 'note', text: 'Ve skupině zatím není žádná další schválená členka.' })); put(root, kids); return; }
  const picked = V.picked || (V.picked = new Set());
  const busy = !!V.session;
  kids.push(h('ul', { class: 'vc-people', id: 'vcPeopleList' }, people.map(m => h('li', { 'data-uid': m.uid },
    h('input', { type: 'checkbox', class: 'vc-pick', 'aria-label': 'Vybrat do skupinového hovoru: ' + m.nick, checked: picked.has(m.uid), onchange: e => { if (e.target.checked) { if (picked.size >= MAX_PARTICIPANTS - 1) { e.target.checked = false; V.err = 'Skupinový hovor je nejvýš pro ' + MAX_PARTICIPANTS + ' (ty + 3 kamarádky).'; render(); return; } picked.add(m.uid); } else picked.delete(m.uid); V.err = ''; render(); } }),
    h('span', { class: 'vc-av', text: initial(m.nick) }), h('span', { class: 'vc-who', style: 'flex:1;min-width:0' }, h('span', { class: 'vc-name', style: 'display:block', text: m.nick }),
      h('small', { class: 'vc-code', 'data-code': codeOf(m.uid), style: 'display:block;color:#c0c0c8;font-size:12px', text: codeOf(m.uid) ? 'kód účtu ' + codeOf(m.uid) : '' })),
    h('span', { class: 'vc-act' },
      h('button', { type: 'button', 'data-act': 'video', 'aria-label': 'Videohovor s ' + m.nick, title: 'Videohovor', disabled: busy, onclick: () => startCall(roomId, [m.uid], true) }, icon('cam')),
      h('button', { type: 'button', 'data-act': 'audio', 'aria-label': 'Hlasový hovor s ' + m.nick, title: 'Hlasový hovor', disabled: busy, onclick: () => startCall(roomId, [m.uid], false) }, icon('phone')))))));
  const sel = [...picked].filter(u => people.some(p => p.uid === u));
  kids.push(h('div', { class: 'vc-act', style: 'flex-wrap:wrap' },
    h('button', { type: 'button', class: 'vc-callbtn primary', id: 'vcGroupVideo', disabled: busy || sel.length < 2, onclick: () => startCall(roomId, sel, true) }, icon('cam'), 'Skupinový videohovor'),
    h('button', { type: 'button', class: 'vc-callbtn', id: 'vcGroupAudio', disabled: busy || sel.length < 2, onclick: () => startCall(roomId, sel, false) }, icon('phone'), 'Skupinový hlasový')));
  kids.push(h('p', { class: 'note' }, 'Pro skupinový hovor zaškrtni 2–3 kamarádky (max. ' + MAX_PARTICIPANTS + ' včetně tebe).'));
  kids.push(h('p', { class: 'note', id: 'vcCodeHint' }, 'Kód účtu u jména je stejný jako v Kamarádkách → Můj účet na jejím telefonu. Tvůj kód: ' + (V.code || '…') + '.'));
  kids.push(h('p', { class: 'note' }, 'Hovor zazvoní, jen když má kamarádka BAND APP otevřenou (i na pozadí, pokud ji telefon nechá běžet). Úplně zavřená aplikace – hlavně na iPhonu – hovor nedostane.'));
  put(root, kids);
}


/* ---------- Diagnostika hovorů (1.2.1) ----------
 * Sbalený panel dole v sekci VIDEOCHAT. Ukazuje jen technický stav – žádná uid, e-maily, jména, názvy skupin
 * ani obsah zpráv – a nikam nic neposílá (vše zůstává v telefonu). */
function put(root, kids) { root.replaceChildren(...kids, diagEl()); }
function diagEl() {
  if (V.diagEl) return V.diagEl;
  const body = h('div', { id: 'vcDiagBody', class: 'vc-diag-body' });
  const el = h('details', { id: 'vcDiag', class: 'vc-diag' }, h('summary', { text: '🛠 Diagnostika hovorů' }), body);
  el.addEventListener('toggle', () => { clearInterval(V.diagTimer); if (el.open) { fillDiag(); V.diagTimer = setInterval(fillDiag, 2000); } });
  return (V.diagEl = el);
}
const callRow = r => r ? 'před ' + ago(r.at) + ' · kód ' + (r.code || '…') + ' · ' + r.phase + ' · ' + r.result : 'žádný (od otevření aplikace)';
const ago = t => t ? Math.max(0, Math.round((Date.now() - t) / 1000)) + ' s' : '–';
/* 1.2.6: „Přihlášení“ podle SKUTEČNÉHO stavu Firebase (dřív stačila místní značka účtu s kódem → „odhlášeno“ i u přihlášeného). */
const OUT_TEXT = () => 'odhlášeno – obnov účet' + (V.lost ? ' (dřív účet ' + V.lost + ')' : '') + ': Kamarádky → ♻️ Mám obnovovací kód';
function authText() {
  const u = V.base && V.base.auth.currentUser;
  if (!V.base) return V.starting ? 'ověřuje se…' : V.noAuth ? 'ne' : lockedReason() ? OUT_TEXT() : '–';
  if (!u) return lockedReason() || V.lost ? OUT_TEXT() : 'ne';
  const pr = (u.providerData || []).map(p => p.providerId);
  return 'ano · ' + (u.isAnonymous ? 'anonymní' : pr.includes('password') ? 'obnovovací kód (e-mail)' : pr.includes('google.com') ? 'Google' : 'jiný');
}
async function fillDiag() {
  const el = V.diagEl; if (!el || !el.open) return;
  let cache = '–', sw = 'ne';
  try { cache = (await caches.keys()).filter(k => k.startsWith('band-app-pages-')).join(', ') || 'žádná'; } catch (e) { }
  try { sw = navigator.serviceWorker && navigator.serviceWorker.controller ? 'ano' : 'ne'; } catch (e) { }
  const rooms = local.rooms(), st = [...V.my.values()];  // „Skupiny v zařízení“ = jen místní seznam
  const appr = st.filter(x => OK_ROLES.includes(x)).length, pend = st.filter(x => x === 'pending').length;
  const ls = [...V.listen.values()], on = ls.filter(x => x.state === 'naslouchá').length;
  const states = {}; ls.forEach(x => { const k = x.state + (x.code ? ' (' + x.code + ')' : ''); states[k] = (states[k] || 0) + 1; });
  const pendingIn = [...V.calls.values()].filter(c => live(c) && c.status === 'ringing' && c.createdBy !== V.uid && (!V.handled.has(c.id) || (V.incoming && V.incoming.id === c.id))).length;
  let e = V.lastErr;
  try { const j = JSON.parse(sessionStorage.getItem('bandapp-diag-err') || 'null'); if (j && j.code && (!e || j.at > e.at)) e = j; } catch (x) { }
  const rows = [
    ['Verze aplikace', 'BAND APP ' + APP_VERSION],
    ['Mezipaměť (service worker)', cache + ' · řídí stránku: ' + sw],
    ['Internet', navigator.onLine === false ? 'offline' : 'online'],
    ['Firebase', (V.fb || V.base) ? 'připojeno' : V.noAuth ? 'nenačteno – telefon není přihlášený (není co obnovit)' : (V.starting ? 'připojuje se' : 'nepřipojeno')],
    ['Přihlášení', authText()],
    ['Kód účtu', (V.base && V.base.auth.currentUser && V.code) || '–'],
    ['Chyba přihlášení', V.authErr ? errText(V.authErr) + ', před ' + ago(V.authErr.at) : 'žádná'],
    ['Moje skupiny na serveru', V.srvState === 'ok' ? String(V.srv.size) + ' · schválené: ' + [...V.srv.values()].filter(x => OK_ROLES.includes(x)).length + ' · čeká: ' + [...V.srv.values()].filter(x => x === 'pending').length : V.srvState],
    ['Skupiny v zařízení', String(rooms.length) + ' · schválené podle serveru: ' + appr + (pend ? ' · čeká na schválení: ' + pend : '')],
    ['Naslouchání příchozím hovorům', (on ? 'AKTIVNÍ' : 'neaktivní') + ' (' + on + ' z ' + appr + ')' + (Object.keys(states).length ? ' · ' + Object.entries(states).map(([k, v]) => k + ': ' + v).join(', ') : '')],
    ['Poslední zpráva o hovorech', 'před ' + ago(V.lastSnap)],
    ['Příchozí hovory čekající', String(pendingIn) + (V.incoming ? ' (právě zvoní)' : '')],
    ['Poslední chyba', e ? e.code + ' – ' + e.where + ', před ' + ago(e.at) : 'žádná'],
    ['Hodiny telefonu', Math.abs(V.skew) > 2000 ? 'odchylka cca ' + Math.round(V.skew / 1000) + ' s (aplikace ji vyrovná)' : 'v pořádku'],
    ['Stránka', V.page || '–'],
    ['Poslední odchozí hovor', callRow(V.lastOut)],
    ['Poslední příchozí hovor', callRow(V.lastIn)],
    ['Upozornění', typeof Notification === 'undefined' ? 'nepodporováno' : Notification.permission === 'granted' ? 'povolena' : 'nepovolena']
  ];
  el.querySelector('#vcDiagBody').replaceChildren(h('dl', {}, ...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
    h('div', { class: 'vc-act' }, h('button', { type: 'button', class: 'secondary', id: 'vcDiagRetry', disabled: !!V.retrying, onclick: retryAuth }, V.retrying ? '⏳ Připojuji…' : '↻ Znovu připojit hovory')),
    V.retryMsg ? h('p', { class: V.retryMsg.startsWith('✅') ? 'note' : 'vc-err', role: 'status', id: 'vcRetryMsg', 'data-state': V.retryState || '', text: V.retryMsg }) : null,
    h('p', { class: 'note', text: 'Bez osobních údajů – nic se nikam neodesílá. Při potížích pošli tátovi/správci snímek této tabulky.' }));
}
/* 1.2.6: „Znovu připojit hovory“ – viditelně: ověří přihlášení u Firebase (obnova tokenu), znovu spustí naslouchání
 * a napíše výsledek. Nikdy nezakládá nový účet a nic nemaže. */
async function retryAuth() {
  if (V.retrying) return;
  V.retrying = true; V.retryMsg = '⏳ Ověřuji přihlášení u Firebase a znovu zapínám naslouchání hovorům…'; V.retryState = 'working'; fillDiag();
  let warn = null;
  try {
    if (!V.base) { try { V.base = await firebaseBase(); } catch (e) { V.authErr = { code: errCode(e), at: Date.now() }; throw e; }
      if (!V.authHooked) { V.authHooked = true; try { V.base.A.onAuthStateChanged(V.base.auth, () => { setTimeout(ensureStarted, 0); }); } catch (e) { } } }
    await V.base.auth.authStateReady();
    const u = V.base.auth.currentUser;
    if (u) { try { await u.getIdToken(true); V.authErr = null; } catch (e) { V.authErr = { code: errCode(e), at: Date.now() }; noteErr('přihlášení', e); warn = e; } }
    stopAllRooms(); V.lastErr = null; V.uid = null;
    if (V.fb && V.fb.auth.currentUser) syncRooms(); else await ensureStarted();
    if (!V.base.auth.currentUser) {
      V.lost = V.lost || await knownAccountCode();
      V.retryState = 'signed-out';
      V.retryMsg = '⚠️ Odhlášeno – obnov účet' + (V.lost ? ' ' + V.lost : '') + '. Telefon není přihlášený k Firebase' + (warn ? ' (' + errText(warn) + ')' : '') + '. Kamarádky → ♻️ Mám obnovovací kód. Nový účet se nezakládá, nic se nemaže.';
    } else {
      for (let i = 0; i < 20 && V.fb; i++) { if ([...V.listen.values()].some(x => x.state === 'naslouchá')) break; await new Promise(r => setTimeout(r, 500)); }
      const on = [...V.listen.values()].filter(x => x.state === 'naslouchá').length, code = V.code || await deviceCode(V.base.auth.currentUser.uid);
      V.retryState = warn ? 'error' : on ? 'ok' : 'no-listen';
      V.retryMsg = (warn ? '⚠️ ' : on ? '✅ ' : '⚠️ ') + 'Přihlášeno – účet ' + code + '. Naslouchání hovorům: ' + (on ? 'AKTIVNÍ (' + on + ')' : 'neaktivní' + (V.srvState === 'ok' && !approvedRooms().length ? ' – účet nemá schválenou skupinu' : ''))
        + (warn ? '. Spojení s Firebase ale selhalo: ' + errText(warn) : '') + '.';
    }
  } catch (e) {
    V.retryState = 'error'; V.retryMsg = '❌ Připojení selhalo: ' + errText(e) + (String((e && e.code) || '').startsWith('auth/') ? '' : ' (kód chyby: ' + errCode(e) + ')');
  } finally { V.retrying = false; render(); fillDiag(); }
}
/* Jen pro automatické testy v emulátoru (localhost + ?emulator=1): náhled do stavu. Ve skutečné aplikaci neexistuje. */
if (isEmulator) window.__vc = { V, startCall: (...a) => startCall(...a), state: () => { const s = V.session; return s && { callId: s.callId, mode: s.mode, cam: s.cam, mic: s.mic, tracks: s.stream ? s.stream.getTracks().map(t => t.kind + ':' + t.readyState + ':' + t.enabled) : [], pcs: [...s.pcs].map(([u, e]) => [u, e.pc.iceConnectionState, e.stream.getTracks().map(t => t.kind + ':' + (t.muted ? 'muted' : 'live')).join(',')]), peers: [...s.peers].map(([u, p]) => [u, p.state, p.cam, p.mic]) }; } };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initVideochat()); else initVideochat();
