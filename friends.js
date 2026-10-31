/* BAND APP – Kamarádky, verze 1.1 (na základě produkční 1p = otestovaná testovací revize 1h):
 * 1.1: změna vlastní přezdívky (stejný účet, stejné skupiny), přehlednější skupiny/kamarádky a chat pro mobil.
 * kontakty, soukromé pozvánky, textový chat a vlastní účet s obnovovacím kódem
 * (bez e-mailu, bez cizích účtů, bez jakéhokoli dohledu). Videohovory nejsou.
 * Stejný soubor slouží veřejné i testovací verzi: testovací stránka (s <meta name="bandapp-friends-ns" content="test">)
 * používá klíče „bandapp-test-friends-“ a jméno aplikace Firebase „bandapp-test-friends“; veřejná BAND APP
 * „bandapp-friends-“ a „bandapp-friends“, aby se nemíchaly.
 * Pozvánka: přezdívka + „Požádat o přijetí“ + 2 krátké řádky (soukromí, pravidla → soukromi.html).
 * Žádná zaškrtávátka, žádný souhlas se neukládá. Právní základ: plnění smlouvy = Pravidla skupiny (soukromi.html).
 * Samostatný ES modul. Neovlivňuje ostatní části aplikace (app.js, studio.js, voice.js, lesson-em.js),
 * nepoužívá jejich klíče v localStorage ani databázi nahrávek (IndexedDB „bandapp-recordings“).
 * Firebase se načítá až při otevření Kamarádek z oficiálního CDN (gstatic), pevná verze.
 * Ochrana zpráv = bezpečnostní pravidla Firestore (proti jiným uživatelkám a cizím). Zprávy NEJSOU
 * koncově šifrované – vlastník/správce projektu Firebase a Google k nim mají technický přístup. */
const FB_VERSION = '12.19.0';
const CDN = 'https://www.gstatic.com/firebasejs/' + FB_VERSION + '/';
const NS_META = typeof document !== 'undefined' && document.querySelector('meta[name="bandapp-friends-ns"]');
export const IS_TEST_BUILD = !!NS_META && NS_META.getAttribute('content') === 'test';
const LS = IS_TEST_BUILD ? 'bandapp-test-friends-' : 'bandapp-friends-';   // všechny klíče Kamarádek mají tuto předponu
const APP_NAME = IS_TEST_BUILD ? 'bandapp-test-friends' : 'bandapp-friends'; // jméno aplikace Firebase (oddělené přihlášení)
const DAY = 864e5, INVITE_MS = DAY, KEEP_MS = 30 * DAY, MAX_TEXT = 1000;
const CLOCK_MARGIN = 10 * 60e3;                      // rezerva na nepřesné hodiny v mobilu (pravidla: 30 dní podle času serveru)

const qs = new URLSearchParams(location.search);
export const isEmulator = qs.has('emulator') && ['localhost', '127.0.0.1'].includes(location.hostname);

/* ---------- malé pomocníky ---------- */
// 1h: vkládání dětí do prvku jako h() – null/undefined/false se přeskočí (replaceChildren/append by je vypsaly jako text „null“)
function fill(el, ...kids) { el.replaceChildren(...kids.flat().filter(c => c != null && c !== false).map(c => c.nodeType ? c : document.createTextNode(String(c)))); return el; }
function add(el, ...kids) { for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); return el; }
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const lsGet = (k, d) => { try { const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { } };
const lsDel = k => { try { localStorage.removeItem(LS + k); } catch (e) { } };
const pad = n => String(n).padStart(2, '0');
const fmtTime = d => d ? d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : '…';
const cleanNick = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 24);
const err = (code, message) => Object.assign(new Error(message || code), { code });

export function randomToken() {                     // 128 bitů, base64url bez "=" → 22 znaků
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const validToken = t => /^[A-Za-z0-9_-]{22}$/.test(t || '');

/* ---------- místní data (v tomto zařízení) + záloha v cloudu (users/{uid}/private/state) ----------
 * Místní kopie zůstává vždy (funguje i offline). Každá změna se označí „dirty“ a odešle do zálohy,
 * kterou smí číst a zapisovat jen tentýž účet (pravidla). */
let pushTimer = null;
function changed() { lsSet('dirty', true); clearTimeout(pushTimer); pushTimer = setTimeout(() => { if (fbReady) pushState(fbReady).catch(() => { }); }, 600); }
export const local = {
  rooms: () => lsGet('rooms', []),
  saveRoom(r) { const all = local.rooms(), i = all.findIndex(x => x.id === r.id), old = all[i]; const nr = Object.assign({}, old || {}, r);
    if (old && JSON.stringify(old) === JSON.stringify(nr)) return; if (i >= 0) all[i] = nr; else all.push(nr); lsSet('rooms', all); changed(); },
  dropRoom(id) { lsSet('rooms', local.rooms().filter(x => x.id !== id)); changed(); },
  nick: () => lsGet('nick', ''), setNick: n => { if (n !== local.nick()) { lsSet('nick', n); changed(); } },
  favs: () => lsGet('favorites', []),
  isFav: (roomId, uid) => local.favs().includes(roomId + '/' + uid),
  toggleFav(roomId, uid) { const k = roomId + '/' + uid, f = local.favs(); lsSet('favorites', f.includes(k) ? f.filter(x => x !== k) : f.concat(k)); changed(); },
  blockedNames: () => lsGet('blocked-names', {}),
  setBlockedName(uid, nick) { const m = local.blockedNames(); if (nick == null) delete m[uid]; else m[uid] = nick; lsSet('blocked-names', m); changed(); }
};
// 1g: žádný souhlas se neukládá (ani v zařízení, ani v záloze). Starší záloha s polem „consent“ se při čtení jen ignoruje.
function localState() { return { rooms: local.rooms(), nick: local.nick(), favorites: local.favs(), blockedNames: local.blockedNames() }; }
function sanitize(s) {
  const rooms = (Array.isArray(s.rooms) ? s.rooms : []).filter(r => r && typeof r.id === 'string').slice(-50)
    .map(r => { const o = { id: r.id.slice(0, 64), name: String(r.name || '').slice(0, 40), role: String(r.role || 'member').slice(0, 12) }; if (r.from) o.from = String(r.from).slice(0, 24); return o; });
  const favorites = (Array.isArray(s.favorites) ? s.favorites : []).filter(x => typeof x === 'string').slice(-500);
  const bn = {}; Object.entries(s.blockedNames || {}).slice(-200).forEach(([k, v]) => { bn[k] = String(v).slice(0, 24); });
  return { rooms, nick: cleanNick(s.nick), favorites, blockedNames: bn };
}
function applyState(s) { const x = sanitize(s); lsSet('rooms', x.rooms); lsSet('nick', x.nick); lsSet('favorites', x.favorites); lsSet('blocked-names', x.blockedNames); }
function mergeState(a, b) {
  const rooms = b.rooms.slice(); a.rooms.forEach(r => { const i = rooms.findIndex(x => x.id === r.id); if (i >= 0) rooms[i] = Object.assign({}, rooms[i], r); else rooms.push(r); });
  return { rooms, nick: a.nick || b.nick, favorites: [...new Set([...b.favorites, ...a.favorites])], blockedNames: Object.assign({}, b.blockedNames, a.blockedNames) };
}
function backupLocal(reason) {
  const s = localState(); if (!s.rooms.length && !s.favorites.length && !s.nick) return;
  try { localStorage.setItem(LS + 'backup-' + Date.now(), JSON.stringify({ reason, uid: lsGet('state-uid', null), state: s })); } catch (e) { }
}
const stateRef = fb => fb.F.doc(fb.db, 'users', fb.uid, 'private', 'state');
async function pushState(fb) {
  if (!fb.uid) return;                                   // odhlášené zařízení nic neposílá
  const s = sanitize(localState());
  await fb.F.setDoc(stateRef(fb), Object.assign(s, { updatedAt: fb.F.serverTimestamp() }));
  lsSet('state-uid', fb.uid); lsSet('dirty', false);
}
/* Sladění místní kopie a zálohy po přihlášení:
 *  - stejný účet a neodeslané změny → odeslat; stejný účet bez změn → převzít zálohu (např. z jiného prohlížeče)
 *  - data z 1. etapy bez značky účtu → sloučit a odeslat (migrace z localStorage)
 *  - jiný účet (obnova) → místní kopii zazálohovat v zařízení a převzít zálohu účtu */
export async function syncState(fb) {
  let snap; try { snap = await fb.F.getDoc(stateRef(fb)); } catch (e) { return { ok: false, error: e }; }
  const owner = lsGet('state-uid', null), dirty = lsGet('dirty', false), loc = sanitize(localState());
  const empty = !loc.rooms.length && !loc.favorites.length && !loc.nick;
  try {
    if (snap.exists()) {
      const srv = sanitize(snap.data());
      if (owner === fb.uid) { if (dirty) await pushState(fb); else applyState(srv); }
      else if (owner == null && !empty) { applyState(mergeState(loc, srv)); await pushState(fb); }
      else { if (!empty) backupLocal('jiný účet'); applyState(srv); }
    } else if (owner && owner !== fb.uid) { backupLocal('jiný účet'); applyState({}); }
    else if (!empty) await pushState(fb);                  // migrace místních dat do zálohy
    lsSet('state-uid', fb.uid); if (snap.exists() && !(owner === fb.uid && dirty)) lsSet('dirty', false);
    return { ok: true };
  } catch (e) { return { ok: false, error: e }; }
}

/* ---------- konfigurace a připojení ---------- */
let cfgp = null, fbReady = null;
function loadConfig() { return cfgp || (cfgp = import('./firebase-config.js').catch(() => ({}))); }
const DEFAULT_RECOVERY_DOMAIN = 'obnova.band-app.invalid';   // vyhrazená doména .invalid (RFC 6761) – nikomu nepatří, e-mail tam nikdy nedojde
/* Pojistka proti záměně: testovací stránka smí běžet jen s testovacím firebase-config.js (TEST_BUILD = true)
 * a veřejná BAND APP jen s veřejným (TEST_BUILD = false/chybí). Jinak se Kamarádky nespustí. */
/* Druhá pojistka podle ID projektu Firebase: testovací stránka smí jen k testovacímu projektu (ID obsahuje
 * slovo „test“, např. band-app-test-9fc3e) a veřejná BAND APP testovací projekt odmítne, i kdyby někdo
 * přepsal TEST_BUILD. Skutečný projekt proto NESMÍ mít v ID slovo „test“. Nevyplněné údaje (VLOZ_…) řeší isConfigured(). */
const TEST_PROJECT_IDS = ['band-app-test-9fc3e'];
const isTestProject = pid => TEST_PROJECT_IDS.includes(pid) || /(^|-)test(-|$)/i.test(pid);
export async function configMismatch() {
  const c = await loadConfig(); if ((c.TEST_BUILD === true) !== IS_TEST_BUILD) return true;
  const pid = String((c.firebaseConfig || {}).projectId || '');
  if (!pid || /VLOZ/.test(pid)) return false;
  return isTestProject(pid) !== IS_TEST_BUILD;
}
export async function isConfigured() {
  if (await configMismatch()) return false;
  if (isEmulator) return true;
  const c = await loadConfig(), f = c.firebaseConfig || {};
  return c.FIREBASE_CONFIGURED === true && !!f.apiKey && !!f.projectId && !/VLOZ/.test(f.apiKey + f.projectId + (f.appId || ''));
}
/* Pojistka: obnovovací kódy jsou zapnuté JEN když RECOVERY_DOMAIN_VERIFIED === true ve firebase-config.js
 * (nastaví se až po úspěšném testu ve skutečném Firebase podle REAL-FIREBASE-TEST.md). Do té doby aplikace
 * kód nevytvoří, neobnoví ani nezmění a nic takového neslibuje. Chat a pozvánky fungují dál (anonymní účet).
 * Jen v testovacím emulátoru (localhost + ?emulator=1) jde hodnotu přepsat parametrem ?rv=1 / ?rv=0. */
export async function recoveryVerified() {
  if (isEmulator && qs.has('rv')) return qs.get('rv') === '1';
  const c = await loadConfig();
  return c.RECOVERY_DOMAIN_VERIFIED === true;
}
async function requireVerified() { if (!(await recoveryVerified())) throw err('bandapp/recovery-unverified'); }
const EMU_CFG = { apiKey: 'demo-key', projectId: 'demo-bandapp', authDomain: 'demo-bandapp.firebaseapp.com', appId: '1:0:web:demo' };
/* 1h: připojení má dvě části.
 *  base()    – načte Firebase (jediná inicializace), počká na uložené přihlášení; NIKOHO nepřihlašuje.
 *  connect() – k tomu zajistí účet: když nikdo přihlášený není, založí anonymní účet – ALE jen když zařízení
 *              nemá zapamatovaný účet s obnovovacím kódem (recoverable-uid) ani ruční odhlášení (signed-out).
 *              Jinak hodí „bandapp/signed-out“ a aplikace ukáže obrazovku „Zadej nový kód“.
 *              Nový účet vznikne jen výslovně: startNewAccount() po potvrzení. */
let basep = null, anonp = null, syncedUid = null, quiet = false, lastUid = null;
export function lockedReason() { return lsGet('signed-out', false) ? 'manual' : (lsGet('recoverable-uid', null) ? 'changed' : null); }
const SIGNED_OUT_EVENT = 'bandapp-friends-signedout';
function base() {
  if (basep) return basep;
  basep = (async () => {
    const c = await loadConfig();
    const [A0, A, F] = await Promise.all([import(CDN + 'firebase-app.js'), import(CDN + 'firebase-auth.js'), import(CDN + 'firebase-firestore.js')]);
    const cfg = isEmulator ? EMU_CFG : c.firebaseConfig;
    const app = A0.getApps().find(a => a.name === APP_NAME) || A0.initializeApp(cfg, APP_NAME);
    const ac = c.APP_CHECK || {};
    if (!isEmulator && ac.siteKey) {                 // App Check musí být zapnutý dřív než Firestore
      const AC = await import(CDN + 'firebase-app-check.js');
      const provider = ac.provider === 'enterprise' ? new AC.ReCaptchaEnterpriseProvider(ac.siteKey) : new AC.ReCaptchaV3Provider(ac.siteKey);
      AC.initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
    }
    const auth = A.getAuth(app), db = F.getFirestore(app);
    if (isEmulator) { A.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); F.connectFirestoreEmulator(db, '127.0.0.1', 8080); }
    await auth.authStateReady();
    const dom = String(c.RECOVERY_EMAIL_DOMAIN || DEFAULT_RECOVERY_DOMAIN).trim().toLowerCase();
    const fb = { app, auth, db, A, A0, F, cfg, recoveryDomain: /^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom) ? dom : DEFAULT_RECOVERY_DOMAIN, get uid() { return auth.currentUser && auth.currentUser.uid; } };
    lastUid = fb.uid;
    // Odhlášení „zvenku“ (změna kódu na jiném zařízení odvolá přihlášení; Firebase to zjistí při obnově tokenu).
    A.onAuthStateChanged(auth, u => {
      if (u) { lastUid = u.uid; return; }
      if (lastUid && !quiet) { lastUid = null; syncedUid = null; try { dispatchEvent(new CustomEvent(SIGNED_OUT_EVENT, { detail: { reason: lockedReason() } })); } catch (e) { } }
      lastUid = null;
    });
    // Kontrola přihlášení účtu s kódem: při návratu do aplikace a každých 5 minut (jen viditelná stránka, online).
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkSession(); });
      setInterval(() => { if (document.visibilityState === 'visible') checkSession(); }, 5 * 60e3);
    }
    return fb;
  })();
  basep.catch(() => { basep = null; });
  return basep;
}
/* Ověří u Firebase, že přihlášení (účtu s kódem) pořád platí. Když bylo odvolané (nový kód jinde),
 * Firebase obnovu tokenu odmítne, SDK zařízení odhlásí a aplikace dostane událost → „Zadej nový kód“.
 * Vrací false, když přihlášení neplatí. Bez internetu nic nerozhoduje (true). */
export async function checkSession() {
  const fb = await (basep || Promise.resolve(null)).catch(() => null), u = fb && fb.auth.currentUser;
  if (!u) return !lockedReason();
  if (u.isAnonymous || (typeof navigator !== 'undefined' && navigator.onLine === false)) return true;
  try { await u.getIdToken(true); return true; }
  catch (e) { return !/user-token-expired|user-disabled|user-not-found|invalid-user-token|token-expired/.test((e && e.code) || ''); }
}
/* 1.2.2: Firebase BEZ přihlašování – jen načte SDK a obnoví uložené přihlášení (authStateReady).
 * Nový (anonymní) účet nikdy nezakládá; to dělá jen connect() po výslovné akci (Kamarádky, pozvánka). */
export async function firebaseBase() { return base(); }
/* „Kód účtu“ (1.2.2 „Kód zařízení“): prvních 6 znaků SHA-256(uid). Uid účtu Firebase se nikdy nemění → kód je stálý,
 * dokud se používá stejný účet (aktualizace, restart, pozvánky, obnova obnovovacím kódem). NENÍ to heslo – k přihlášení
 * nestačí; slouží jen k porovnání „je to stejný účet?“ mezi telefonem členky a seznamem u zakladatelky.
 * Krátký kód: prvních 6 znaků SHA-256(uid). Z kódu nejde uid zjistit; slouží jen k porovnání
 * „je tohle stejné přihlášení?“ mezi telefonem a seznamem členek u zakladatelky. */
export async function deviceCode(uid) {
  if (!uid) return '';
  try { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(uid)));
    return [...new Uint8Array(d)].slice(0, 3).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase(); } catch (e) { return ''; }
}
export async function connect() {
  const fb = await base();
  if (!fb.auth.currentUser) {
    if (lockedReason()) throw err('bandapp/signed-out');
    // 1.2.3: ŽÁDNÝ samovolný nový účet. Chybí-li přihlášení, aplikace to řekne a nabídne obnovu;
    // nový účet založí jen createAccount() po výslovném „Založit nový účet“.
    throw Object.assign(err('bandapp/no-account'), { knownCode: await knownAccountCode() });
  }
  return finishConnect(fb);
}
/* 1.2.3: JEDINÉ místo, kde vzniká nový (anonymní) účet – jen po výslovné akci uživatelky. Je-li už přihlášená, nic nezakládá. */
export async function createAccount() {
  const fb = await base();
  if (!fb.auth.currentUser) {
    if (lockedReason()) throw err('bandapp/signed-out');
    await (anonp || (anonp = fb.A.signInAnonymously(fb.auth).finally(() => { anonp = null; })));
  }
  const r = await finishConnect(fb);
  accountChanged();
  return r;
}
/* 1.2.3: po výslovném založení / obnově účtu dá vědět ostatním částem stránky (VIDEOCHAT začne hned naslouchat). */
function accountChanged() { try { dispatchEvent(new Event('bandapp-account')); } catch (e) { } }
/* Kód účtu, který byl na tomto zařízení přihlášený dřív (podle místní značky zálohy) – pro varování „nezakládej nový účet“. */
export async function knownAccountCode() { const u = lsGet('state-uid', null) || lsGet('recoverable-uid', null); return u ? deviceCode(u) : ''; }
async function finishConnect(fb) {
  if (syncedUid !== fb.uid) {
    syncedUid = fb.uid;
    if (hasCode(fb.auth.currentUser)) markRecoverable(fb);
    await syncState(fb);                                       // záloha kontaktů (nevadí, když selže – zkusí se příště)
    // 1.2.2: vlastní skupiny ze serveru i pro anonymní účet, když je místní seznam prázdný (jen přidá, nic nemaže).
    if (!local.rooms().length) await discoverRooms(fb);
  }
  fbReady = fb;
  return fb;
}
/* 1h: záložní nalezení vlastních skupin (když záloha users/{uid}/private/state chybí nebo neodešla).
 * Dotaz přes všechny podsbírky „members“ jen na VLASTNÍ uid – pravidla jiný dotaz nepustí.
 * Ve skutečném Firebase potřebuje jednopolní index members.uid s rozsahem „Collection group“ (firestore.indexes.json). */
export async function discoverRooms(fb) {
  const { F, db } = fb; let snap;
  try { snap = await F.getDocs(F.query(F.collectionGroup(db, 'members'), F.where('uid', '==', fb.uid), F.limit(50))); }
  catch (e) { return { ok: false, error: e, added: 0 }; }
  const have = new Set(local.rooms().map(r => r.id)); let added = 0;
  for (const d of snap.docs) {
    const roomRef = d.ref.parent.parent; if (!roomRef || roomRef.parent.id !== 'rooms') continue;
    const m = d.data(); if (!local.nick() && m.nick) local.setNick(cleanNick(m.nick));
    if (have.has(roomRef.id)) continue;
    let name = '';
    if (m.status === 'owner' || m.status === 'approved') { try { const r = await F.getDoc(roomRef); if (r.exists()) name = r.data().name || ''; } catch (e) { } }
    local.saveRoom({ id: roomRef.id, name: name || 'Skupina', role: String(m.status || 'member') }); added++;
  }
  return { ok: true, added };
}

/* ---------- účet: obnovovací kód ----------
 * Účet začíná jako anonymní (Firebase Anonymous). „Vytvořit obnovovací kód“ k němu připojí přihlášení
 * e-mailem a heslem (Firebase Email/Password) – ale bez skutečného e-mailu: adresa je vymyšlená
 * (náhodné ID účtu + vyhrazená doména .invalid, kam žádný e-mail nikdy nedojde) a heslo je náhodné
 * tajemství. Obojí je zakódované v obnovovacím kódu BAND-XXXX-…; uid účtu se nemění.
 * Kód se nikam neukládá (ani do Firestore, ani do localStorage) – ukáže se jen jednou. */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';        // Crockford base32: bez I, L, O, U
const ID_LEN = 12, SECRET_LEN = 20;                     // 60 bitů ID + 100 bitů tajemství
function randB32(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return Array.from(b, x => B32[x & 31]).join(''); }   // 256/32 → bez zkreslení
export function formatCode(id, secret) { return 'BAND-' + (id + secret).match(/.{4}/g).join('-'); }
/* Tolerantní čtení: malá/velká písmena, mezery, pomlčky, tečky; O→0, I/L→1 (Crockford). */
export function parseCode(input) {
  let s = String(input || '').toUpperCase().replace(/[\s\-–—_.,:;]/g, '');
  if (s.length === ID_LEN + SECRET_LEN + 4 && s.startsWith('BAND')) s = s.slice(4);
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== ID_LEN + SECRET_LEN || ![...s].every(ch => B32.includes(ch))) return null;
  return { id: s.slice(0, ID_LEN), secret: s.slice(ID_LEN) };
}
const recoveryEmail = (fb, id) => id.toLowerCase() + '@' + fb.recoveryDomain;
const codeEmail = u => { const p = u && (u.providerData || []).find(x => x.providerId === 'password'); return p ? (p.email || (u.email || '')) : null; };
export const hasCode = u => codeEmail(u) != null;
export function accountInfo(fb) {
  const u = fb.auth.currentUser; if (!u) return { uid: null };
  const was = lsGet('recoverable-uid', null);
  return { uid: u.uid, hasCode: hasCode(u), signedOutFrom: was && was !== u.uid && !hasCode(u) ? was : null };
}
function markRecoverable(fb) { lsSet('recoverable-uid', fb.uid); }
/* Vytvoření prvního kódu: připojí k anonymnímu účtu přihlášení „ID@doména + tajemství“ (stejné uid). */
export async function createRecoveryCode() {
  await requireVerified();
  lsDel('signed-out');
  const fb = await connect(), { A } = fb, u = fb.auth.currentUser;
  if (hasCode(u)) throw err('bandapp/has-code');
  for (let i = 0; ; i++) {
    const id = randB32(ID_LEN), secret = randB32(SECRET_LEN);
    try {
      await A.linkWithCredential(u, A.EmailAuthProvider.credential(recoveryEmail(fb, id), secret));
    } catch (e) { if (i === 0 && e && e.code === 'auth/email-already-in-use') continue; throw e; }   // (prakticky nemožná) shoda ID
    markRecoverable(fb); pushState(fb).catch(() => { });
    return formatCode(id, secret);
  }
}
/* Nový kód: VŽDY jen se starým kódem. Starý kód se ověří u Firebase (reauthenticateWithCredential)
 * těsně před změnou (updatePassword). Bez starého kódu, se špatným kódem nebo s kódem jiného účtu se nic nezmění.
 * Jiná cesta ke změně kódu neexistuje (žádné „starý kód nemám“, žádné odpojení přihlášení).
 * Stejné ID, nové tajemství → starý kód přestane platit. */
export async function regenerateCode(oldCode) {
  await requireVerified();
  const old = oldCode && typeof oldCode === 'object' ? oldCode.oldCode : oldCode;
  if (old == null || !String(old).trim()) throw err('bandapp/old-code-required');
  const c = parseCode(old); if (!c) throw err('bandapp/bad-code');
  const fb = await connect(), { A } = fb, u = fb.auth.currentUser, email = codeEmail(u);
  if (email == null) throw err('bandapp/no-code');
  const id = email.split('@')[0].toUpperCase();
  if (c.id !== id) throw err('bandapp/not-this-account');
  const r = await A.reauthenticateWithCredential(u, A.EmailAuthProvider.credential(email, c.secret));
  if (!r || !r.user || r.user.uid !== u.uid || fb.auth.currentUser !== u) throw err('bandapp/not-this-account');
  const secret = randB32(SECRET_LEN);
  await A.updatePassword(u, secret);
  markRecoverable(fb);
  return formatCode(id, secret);
}
/* Obnova na jiném zařízení: přihlášení kódem → stejné uid → záloha (skupiny, hvězdičky, blokované) se stáhne.
 * 1h: nejdřív se NEzakládá anonymní účet (base() místo connect()). Když záloha chybí, skupiny se najdou
 * záložním dotazem na vlastní členství (discoverRooms). Když se přihlášení nepovede (špatný kód),
 * Firebase současné přihlášení v zařízení nezmění. */
export async function restoreAccount(input) {
  await requireVerified();
  const c = parseCode(input); if (!c) throw err('bandapp/bad-code');
  flash('');                                        // 1.2.6: staré oznámení pryč, ať se nesplete s výsledkem tohoto pokusu
  const fb = await base(), email = recoveryEmail(fb, c.id);
  if (fb.auth.currentUser && codeEmail(fb.auth.currentUser) === email) return { same: true, uid: fb.uid, code: await deviceCode(fb.uid) };
  // 1.2.6: který účet byl na zařízení dřív (přihlášený, nebo podle místní značky) – aby šlo jasně říct, komu kód patří.
  const prevCode = fb.auth.currentUser ? await deviceCode(fb.auth.currentUser.uid) : await knownAccountCode();
  try { await fb.A.signInWithEmailAndPassword(fb.auth, email, c.secret); }
  catch (e) { noteDiagErr('obnova účtu', e); throw e; }
  lsDel('signed-out'); markRecoverable(fb);
  syncedUid = fb.uid;
  const s = await syncState(fb);                    // jiný účet → místní data předchozího účtu se zazálohují v zařízení
  const d = await discoverRooms(fb);                // skupiny i bez zálohy (vlastní členství)
  fbReady = fb; accountChanged();
  const code = await deviceCode(fb.uid);
  return { uid: fb.uid, code, prevCode, other: !!prevCode && prevCode !== code, synced: s.ok, found: d.ok ? d.added : null };
}
/* 1.2.6: patří kód účtu, který je teď přihlášený? (bez přihlašování – jen porovná ID kódu s adresou účtu) */
export async function isCurrentCode(input) {
  const c = parseCode(input); if (!c) return false;
  const fb = await base().catch(() => null), u = fb && fb.auth.currentUser;
  return !!u && codeEmail(u) === recoveryEmail(fb, c.id);
}
/* 1.2.6: srozumitelný výsledek obnovy – vždy s kódem účtu, kterému obnovovací kód patří. Nic se neslučuje. */
export function restoreText(r) {
  if (!r) return '';
  if (r.same) return '✅ Obnovovací kód patří účtu ' + r.code + ' – ten už je na tomto telefonu přihlášený. Obnova není potřeba.';
  if (r.other) return '⚠️ Obnovovací kód patří účtu ' + r.code + ', ne účtu ' + r.prevCode + ', který tu byl dřív. Telefon je teď přihlášený jako ' + r.code
    + '. Nic se nesloučilo ani nesmazalo. Skupiny účtu ' + r.prevCode + ' převede jen zakladatelka (🔁 Převést na nový účet), nebo se k němu vrátíš jeho vlastním obnovovacím kódem.';
  return '✅ Přihlášeno – účet ' + r.code + ' je obnovený (stejný účet, skupiny i zprávy zůstaly).';
}
/* 1.2.6: oznámení nahoře na obrazovce, které přežije překreslení i znovunačtení stránky (do zavření tlačítkem OK). */
const FLASH_KEY = LS + 'flash';
export function flash(text) {
  try { if (text) sessionStorage.setItem(FLASH_KEY, text); else sessionStorage.removeItem(FLASH_KEY); } catch (e) { }
  showFlash();
}
function showFlash() {
  if (typeof document === 'undefined' || !document.body) return;
  let text = ''; try { text = sessionStorage.getItem(FLASH_KEY) || ''; } catch (e) { }
  const old = document.getElementById('frFlash'); if (old) old.remove();
  if (!text) return;
  const ok = h('button', { type: 'button', id: 'frFlashOk', style: 'min-height:44px;background:#b3001b;color:#fff;border:0;border-radius:10px;padding:8px 14px;font:inherit;flex:none' }, 'OK');
  const el = h('div', { id: 'frFlash', role: 'status', 'data-state': /^⚠️/.test(text) ? 'warn' : 'ok', style: 'position:fixed;left:50%;transform:translateX(-50%);top:calc(10px + env(safe-area-inset-top));z-index:10000;width:min(94vw,480px);display:flex;gap:10px;align-items:center;background:#2a0508;color:#fff;border:1px solid #e0202f;border-radius:14px;padding:10px 12px;box-shadow:0 6px 24px #000a;font:15px system-ui,Arial' },
    h('span', { style: 'flex:1', text }), ok);
  ok.addEventListener('click', () => flash(''));
  document.body.append(el);
}
if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showFlash); else setTimeout(showFlash, 0); }
const FR_KEYS = ['rooms', 'nick', 'favorites', 'blocked-names', 'state-uid', 'dirty', 'recoverable-uid', 'signed-out', 'lastread'];   // 1.1: + lastread (jen čtení v tomto zařízení)
function clearDevice(all) {
  clearTimeout(pushTimer);
  if (all) { try { Object.keys(localStorage).filter(k => k.startsWith(LS)).forEach(k => localStorage.removeItem(k)); } catch (e) { } }
  else FR_KEYS.forEach(lsDel);
  try { sessionStorage.removeItem(LS + 'join-token'); } catch (e) { }
}
/* 1h: Odhlásit z tohoto zařízení (sdílený tablet/počítač). Kamarádky z tohoto zařízení zmizí (zůstanou v účtu).
 * Účet s kódem: zařízení zůstane zamčené – zpátky jen kódem (nebo výslovně nový účet).
 * Účet BEZ kódu: po odhlášení je účet ztracený (aplikace předem varuje). */
export async function signOutDevice() {
  const fb = await base(), u = fb.auth.currentUser, had = hasCode(u);
  quiet = true;
  try {
    clearDevice(true);
    if (had) lsSet('signed-out', true);
    if (u) await fb.A.signOut(fb.auth);
  } finally { quiet = false; syncedUid = null; fbReady = null; }
  return { hadCode: had };
}
/* 1h: Nový účet jen výslovně (po potvrzení). Místní data předchozího účtu se odloží v zařízení (záloha …backup-). */
export async function startNewAccount() {
  const fb = await base();
  quiet = true;
  try { backupLocal('nový účet'); clearDevice(false); if (fb.auth.currentUser) await fb.A.signOut(fb.auth); }
  finally { quiet = false; syncedUid = null; fbReady = null; }
  return createAccount();
}
/* Má současný (jiný) účet v zařízení nějaká data? (varování před přepnutím) */
export function deviceHasData() { const s = localState(); return !!(s.rooms.length || s.favorites.length || Object.keys(s.blockedNames).length); }

/* ---------- operace s daty (pravidla ve firestore.rules je ověřují na serveru) ---------- */
export async function createRoom(name, nick) {
  const { db, F, uid } = await connect();
  const ref = F.doc(F.collection(db, 'rooms')), b = F.writeBatch(db);
  b.set(ref, { ownerUid: uid, name, createdAt: F.serverTimestamp(), blocked: [] });
  b.set(F.doc(db, 'rooms', ref.id, 'members', uid), { uid, nick, status: 'owner', joinedAt: F.serverTimestamp() });
  await b.commit();
  const r = { id: ref.id, name, role: 'owner' }; local.saveRoom(r); return r;
}
export function inviteLink(token) {
  const u = new URL('join.html', location.href); u.search = isEmulator ? '?emulator=1' : ''; u.hash = 't=' + token; return u.href;
}
export async function createInvite(roomId, fromNick) {
  const { db, F, uid } = await connect(), token = randomToken();
  const expires = Date.now() + INVITE_MS;
  await F.setDoc(F.doc(db, 'invites', token), { roomId, createdBy: uid, fromNick: cleanNick(fromNick) || 'Kamarádka', createdAt: F.serverTimestamp(), expiresAt: F.Timestamp.fromMillis(expires), used: false });
  return { token, link: inviteLink(token), expires };
}
export async function getInvite(token) {
  const { db, F } = await connect(); const s = await F.getDoc(F.doc(db, 'invites', token));
  return s.exists() ? s.data() : null;
}
/* Přijetí v transakci: Firestore zaručí, že při souběhu dvou osob uspěje jen jedna (druhá
 * transakce se zopakuje, uvidí used:true a skončí chybou „už použitá“). Je to JEDINÝ zápis do pozvánky,
 * který pozvaná osoba smí udělat (pravidla). Přijetím vzniká jen čekající členka – vstup schvaluje zakladatelka. */
export async function acceptInvite(token, roomId, nick) {
  const { db, F, uid } = await connect(), iref = F.doc(db, 'invites', token);
  // 1.2.2: kdo už ve skupině JE (stejný účet, např. po ztrátě místního seznamu), nic nezapisuje – pravidla by
  // přepis vlastního záznamu odmítla („nedostatečná oprávnění“) a schválení by se stejně nesmělo ztratit.
  const mine = await F.getDocFromServer(F.doc(db, 'rooms', roomId, 'members', uid)).catch(() => null);
  if (mine && mine.exists()) throw Object.assign(err('bandapp/already-member'), { status: String(mine.data().status || '') });
  await F.runTransaction(db, async tx => {
    const s = await tx.get(iref);
    if (!s.exists()) throw err('bandapp/invite-missing');
    const inv = s.data();
    if (inv.roomId !== roomId) throw err('bandapp/invite-room');
    if (inv.used) throw err('bandapp/invite-used');
    tx.set(F.doc(db, 'rooms', roomId, 'members', uid), { uid, nick, status: 'pending', joinedAt: F.serverTimestamp(), invite: token });
    tx.update(iref, { used: true, usedBy: uid, usedAt: F.serverTimestamp() });
  }).catch(async e => {
    // Souběh: když pozvánku mezitím použil někdo jiný, server zápis odmítne (permission-denied).
    // Zjistíme skutečný stav, aby se ukázala srozumitelná konečná zpráva.
    if (e && e.code === 'permission-denied') {
      const s = await F.runTransaction(db, tx => tx.get(iref)).catch(() => null);
      if (s && !s.exists()) throw err('bandapp/invite-missing');
      if (s && s.exists() && s.data().used && s.data().usedBy !== uid) throw err('bandapp/invite-used');
    }
    throw e;
  });
}
/* 1g: tlačítko „Odmítnout“ u pozvánky není. Odmítnutí se ani dřív nikam neposílalo – stačí stránku zavřít;
 * pozvánka sama vyprší po 24 hodinách (nebo ji zakladatelka zruší). Pravidla zápis „odmítnutí“ dál nedovolí. */
export async function revokeInvite(token) { const { db, F } = await connect(); await F.deleteDoc(F.doc(db, 'invites', token)); }
export async function watchInvites(roomId, cb, onErr) {
  const { db, F } = await connect();
  return F.onSnapshot(F.query(F.collection(db, 'invites'), F.where('roomId', '==', roomId), F.limit(50)),
    s => cb(s.docs.map(d => Object.assign({ token: d.id }, d.data()))), onErr);
}
/* 1.2.3: převod členství na nový účet (jen zakladatelka, osobně ověřeno kódem účtu z telefonu členky).
 * Starý záznam se NEMAŽE: dostane status 'replaced' + replacedBy (nový účet). Nový účet dostane stejnou přezdívku,
 * status 'approved' a replaces (starý účet). Obojí v jedné dávce – pravidla jinak převod odmítnou. */
export async function transferMember(roomId, oldUid, newUid, typedCode) {
  const want = await deviceCode(newUid);
  if (!want || String(typedCode || '').trim().toUpperCase() !== want) throw err('bandapp/bad-transfer-code');
  const { db, F } = await connect(), b = F.writeBatch(db);
  const old = await F.getDocFromServer(F.doc(db, 'rooms', roomId, 'members', oldUid));
  if (!old.exists() || old.data().status !== 'approved') throw err('permission-denied');
  b.update(F.doc(db, 'rooms', roomId, 'members', newUid), { status: 'approved', approvedAt: F.serverTimestamp(), nick: old.data().nick, replaces: oldUid });
  b.update(F.doc(db, 'rooms', roomId, 'members', oldUid), { status: 'replaced', replacedBy: newUid, replacedAt: F.serverTimestamp() });
  await b.commit();
}
export async function approveMember(roomId, uid) { const { db, F } = await connect(); await F.updateDoc(F.doc(db, 'rooms', roomId, 'members', uid), { status: 'approved', approvedAt: F.serverTimestamp() }); }
export async function removeMember(roomId, uid) { const { db, F } = await connect(); await F.deleteDoc(F.doc(db, 'rooms', roomId, 'members', uid)); }
export async function blockMember(roomId, uid, nick) {
  const { db, F } = await connect(), b = F.writeBatch(db);
  b.update(F.doc(db, 'rooms', roomId), { blocked: F.arrayUnion(uid) });
  b.delete(F.doc(db, 'rooms', roomId, 'members', uid));
  local.setBlockedName(uid, nick || '?');          // jméno uložit předem: seznam se překreslí hned po zápisu
  try { await b.commit(); } catch (e) { local.setBlockedName(uid, null); throw e; }
}
export async function unblock(roomId, uid) { const { db, F } = await connect(); await F.updateDoc(F.doc(db, 'rooms', roomId), { blocked: F.arrayRemove(uid) }); local.setBlockedName(uid, null); }
export async function leaveRoom(roomId) { const { db, F, uid } = await connect(); await F.deleteDoc(F.doc(db, 'rooms', roomId, 'members', uid)); local.dropRoom(roomId); }
/* Předání vlastnictví schválené člence (jen zakladatelka). Původní zakladatelka zůstane běžnou členkou. */
export async function transferOwnership(roomId, newUid) {
  const { db, F, uid } = await connect(), b = F.writeBatch(db);
  b.update(F.doc(db, 'rooms', roomId), { ownerUid: newUid });
  b.update(F.doc(db, 'rooms', roomId, 'members', newUid), { status: 'owner' });
  b.update(F.doc(db, 'rooms', roomId, 'members', uid), { status: 'approved' });
  await b.commit();
}
export async function sendMessage(roomId, nick, text) {
  const { db, F, uid } = await connect();
  await F.addDoc(F.collection(db, 'rooms', roomId, 'messages'), { uid, nick, text, createdAt: F.serverTimestamp() });
}
/* ---------- 1.1: změna vlastní přezdívky ----------
 * Stejný účet (uid) i skupiny – mění se JEN pole „nick“ ve vlastních záznamech členství (pravidla: větev B),
 * v soukromé záloze a v zařízení. Staré zprávy se nepřepisují; chat ukazuje u každé zprávy AKTUÁLNÍ přezdívku
 * autorky podle seznamu členek. Proti záměně: přezdívku, kterou už má jiná členka v některé z mých skupin
 * (bez ohledu na velikost písmen a mezery), aplikace nedovolí. */
/* 1.2.3: obrazovka „tento telefon/prohlížeč není přihlášený“ – nikdy nic nezakládá sama.
 * opts: { known (kód účtu dřív přihlášeného tady), onRestore, onCreate, createLabel, invitePaste } */
export function noAccountBlock(opts) {
  const standalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
  const e2 = h('div', { class: 'err', role: 'alert', hidden: true });
  const kids = [h('h3', { 'data-state': 'no-account', id: 'frNoAccount', text: '🔐 Odhlášeno – obnov účet. Tento ' + (standalone ? 'telefon (nainstalovaná BAND APP)' : 'prohlížeč') + ' není přihlášený k účtu BAND APP' })];
  if (opts.known) kids.push(h('div', { class: 'warnbox', 'data-state': 'known-account', id: 'frKnownAccount', text: '⚠️ Tady už byl přihlášený účet s kódem ' + opts.known + ', ale přihlášení chybí. NEZAKLÁDEJ nový účet – nový účet by měl jiný kód a do skupiny by tě musela znovu pustit zakladatelka. Obnov svůj účet obnovovacím kódem, nebo používej telefon či prohlížeč, kde jsi s kódem ' + opts.known + ' přihlášená.' }));
  kids.push(h('p', { class: 'note', text: 'Máš už účet (např. ses přidala přes pozvánku)? Každý prohlížeč a nainstalovaná BAND APP mají VLASTNÍ přihlášení. Na telefonu, kde účet máš, ho zabezpeč (Kamarádky → Můj účet → 🔐 Zabezpečit účet) a tady ho obnov obnovovacím kódem. Kód účtu zůstane stejný.' }));
  const row = h('div', { class: 'row' });
  if (opts.onRestore) add(row, btn('primary', '♻️ Mám obnovovací kód', opts.onRestore, { id: 'frNoAccRestore' }));
  if (opts.onCreate) add(row, btn('secondary', opts.createLabel || '➕ Založit nový účet', async ev => {
    const b = ev.currentTarget;
    if (!confirm(opts.known ? 'POZOR: tady už byl účet s kódem ' + opts.known + '. Nový účet bude mít JINÝ kód a nebude v žádné skupině – zakladatelka ho bude muset převést nebo znovu schválit. Opravdu založit NOVÝ účet?'
      : 'Založit nový účet BAND APP v tomto ' + (standalone ? 'telefonu' : 'prohlížeči') + '? (Pokud už účet jinde máš, zvol radši „Mám obnovovací kód“.)')) return;
    b.disabled = true; e2.hidden = true;
    try { await opts.onCreate(); } catch (e) { b.disabled = false; e2.hidden = false; e2.textContent = errText(e); }
  }, { id: 'frNewAccount', 'data-act': 'create-account' }));
  kids.push(row, e2);
  return kids;
}
function prevCodeLine(uid) { const el = h('div', { class: 'fstat', 'data-prevcode': '1', text: 'předchozí kód: …' }); deviceCode(uid).then(c => { el.textContent = 'předchozí kód: ' + (c || '–'); }); return el; }
function codeLine(uid) {   // 1.2.2: jen pro zakladatelku – porovnání s „Kód účtu“ v Diagnostice hovorů u členky
  const el = h('div', { class: 'fstat', 'data-devcode': '1', text: 'Kód účtu: …' });
  deviceCode(uid).then(c => { el.textContent = 'Kód účtu: ' + (c || '–'); }); return el;
}
export const nickKey = s => cleanNick(s).toLocaleLowerCase('cs');
async function myMemberships(fb) {
  const { F, db, uid } = fb, out = new Map();
  try {
    const s = await F.getDocsFromServer(F.query(F.collectionGroup(db, 'members'), F.where('uid', '==', uid), F.limit(50)));
    s.docs.forEach(d => { const rr = d.ref.parent.parent; if (rr && rr.parent.id === 'rooms') out.set(rr.id, d.data()); });
  } catch (e) { }
  // Pojistka (kdyby dotaz přes všechny skupiny selhal): skupiny uložené v zařízení – vlastní záznam smí číst každá sama.
  for (const r of local.rooms()) {
    if (out.has(r.id)) continue;
    try { const d = await F.getDocFromServer(F.doc(db, 'rooms', r.id, 'members', uid)); if (d.exists()) out.set(r.id, d.data()); } catch (e) { }
  }
  return out;
}
/* Vrátí první shodu přezdívky s JINOU členkou ve skupinách, kde jsem schválená/zakladatelka (čekající seznam nevidí). */
async function nickConflict(fb, mem, nick) {
  const { F, db, uid } = fb, k = nickKey(nick);
  for (const [roomId, m] of mem) {
    if (!['owner', 'approved'].includes(m.status)) continue;
    const ms = await F.getDocsFromServer(F.collection(db, 'rooms', roomId, 'members'));
    const hit = ms.docs.map(d => d.data()).find(x => x && x.uid !== uid && nickKey(x.nick) === k);
    if (hit) return { roomId, nick: String(hit.nick || '') };
  }
  return null;
}
export async function changeNick(newNick) {
  const n = cleanNick(newNick);
  if (!n) throw err('bandapp/nick-empty');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw err('bandapp/offline');
  const fb = await connect(), { F, db, uid } = fb;
  const mem = await myMemberships(fb);
  const c = await nickConflict(fb, mem, n);
  if (c) { const r = local.rooms().find(x => x.id === c.roomId); throw Object.assign(err('bandapp/nick-taken'), { room: (r && r.name) || 'Skupina' }); }
  const todo = [...mem].filter(([, m]) => ['owner', 'approved', 'pending'].includes(m.status) && m.nick !== n);
  if (todo.length) {                                   // jedna dávka: buď se změní všude, nebo nikde
    const b = F.writeBatch(db);
    todo.forEach(([rid]) => b.update(F.doc(db, 'rooms', rid, 'members', uid), { nick: n }));
    await b.commit();
  }
  local.setNick(n);                                    // zařízení + soukromá záloha (users/{uid}/private/state)
  return { nick: n, rooms: todo.length, uid };
}
export async function watchMyMember(roomId, cb, onErr) {
  const { db, F, uid } = await connect();
  // Offline: prázdná odpověď z mezipaměti NEZNAMENÁ odebrání → cb(undefined) = „nevím, čekám na internet“.
  return F.onSnapshot(F.doc(db, 'rooms', roomId, 'members', uid), { includeMetadataChanges: true },
    s => cb(s.exists() ? s.data() : (s.metadata.fromCache ? undefined : null)), onErr);
}
export async function watchRoom(roomId, cb, onErr) { const { db, F } = await connect(); return F.onSnapshot(F.doc(db, 'rooms', roomId), s => cb(s.exists() ? s.data() : null), onErr); }
export async function watchMembers(roomId, cb, onErr) {
  const { db, F } = await connect();
  return F.onSnapshot(F.collection(db, 'rooms', roomId, 'members'), s => cb(s.docs.map(d => d.data())), onErr);
}
/* Jen posledních 30 dní: starší zprávy pravidla nikomu nevydají, i když ještě fyzicky existují.
 * Kdyby měl telefon hodiny o víc než 10 minut pozadu, server dotaz odmítne → zkusí se znovu s rezervou 2 dny. */
export async function watchMessages(roomId, cb, onErr) {
  const { db, F } = await connect();
  let unsub = null, stopped = false, margin = CLOCK_MARGIN;
  const start = () => {
    const q = F.query(F.collection(db, 'rooms', roomId, 'messages'), F.where('createdAt', '>', F.Timestamp.fromMillis(Date.now() - KEEP_MS + margin)), F.orderBy('createdAt', 'desc'), F.limit(150));
    unsub = F.onSnapshot(q, s => cb(s.docs.map(d => { const x = d.data({ serverTimestamps: 'estimate' }); return { id: d.id, uid: x.uid, nick: x.nick, text: x.text, at: x.createdAt ? x.createdAt.toDate() : null, pending: d.metadata.hasPendingWrites }; })
      .filter(m => !m.at || m.at.getTime() > Date.now() - KEEP_MS).reverse()),
      e => { if (!stopped && margin === CLOCK_MARGIN && e && String(e.code).includes('permission-denied')) { margin = 2 * DAY; start(); } else if (onErr) onErr(e); });
  };
  start();
  return () => { stopped = true; if (unsub) unsub(); };
}
/* ---------- 1.1: nepřečtené zprávy, upozornění v aplikaci, volitelné systémové upozornění ----------
 * Bez serveru a bez push: počítá se jen, když je BAND APP spuštěná (i na pozadí). Úplně zavřená aplikace nic nedostane.
 * Nepřečtené = zprávy JINÝCH (nikdy vlastní) novější než „přečteno do“ – čas poslední zobrazené zprávy (čas serveru),
 * uložený jen v tomto zařízení v NOVÉM klíči localStorage „bandapp-friends-lastread“ ({roomId: ms}). Do zálohy se neposílá.
 * Systémové upozornění je VYPNUTÉ, dokud ho uživatelka sama nezapne („bandapp-friends-notify“); text je obecný
 * (žádná přezdívka, skupina ani obsah zprávy – kvůli zamčené obrazovce). */
export const NOTIFY_TITLE = 'BAND APP – máš novou zprávu', NOTIFY_BODY = 'Otevři Kamarádky.', NOTIFY_TAG = 'bandapp-zprava';
const UNREAD_EVENT = 'bandapp-friends-unread', OPEN_ROOM_EVENT = 'bandapp-friends-openroom';
const NOTE = { subs: new Map(), msgs: new Map(), seen: new Map(), unread: new Map(), active: new Map(), uid: null };
const lastRead = () => { const v = lsGet('lastread', {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
const maxAt = msgs => msgs.reduce((a, m) => Math.max(a, m.at ? m.at.getTime() : 0), 0);
function markRead(roomId) {
  const t = maxAt(NOTE.msgs.get(roomId) || []), m = lastRead();
  if (t && (m[roomId] || 0) < t) { m[roomId] = t; lsSet('lastread', m); }
  recount(roomId);
}
function recount(roomId) {
  const lr = lastRead()[roomId] || 0, msgs = NOTE.msgs.get(roomId) || [];
  const n = msgs.filter(m => m.uid && m.uid !== NOTE.uid && !m.pending && m.at && m.at.getTime() > lr).length;
  if (NOTE.unread.get(roomId) !== n) { NOTE.unread.set(roomId, n); emitUnread(); }
}
export function unreadCounts() { let total = 0; const rooms = {}; NOTE.unread.forEach((n, id) => { if (NOTE.subs.has(id)) { rooms[id] = n; total += n; } }); return { total, rooms }; }
function emitUnread() {
  const u = unreadCounts();
  try {
    if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) { (u.total ? navigator.setAppBadge(u.total) : navigator.clearAppBadge()).catch(() => { }); }
  } catch (e) { }
  try { dispatchEvent(new CustomEvent(UNREAD_EVENT, { detail: u })); } catch (e) { }
}
const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
export const notifySupported = () => typeof Notification !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
export const notifyEnabled = () => lsGet('notify', false) === true;
async function systemNotify() {
  if (!notifyEnabled() || !notifySupported() || Notification.permission !== 'granted' || visible()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration(); if (!reg) return false;
    await reg.showNotification(NOTIFY_TITLE, { body: NOTIFY_BODY, tag: NOTIFY_TAG, renotify: true, icon: 'icon-192.png' });
    return true;
  } catch (e) { return false; }
}
function toast(roomId) {
  if (typeof document === 'undefined' || !visible()) return;
  const r = local.rooms().find(x => x.id === roomId), name = (r && r.name) || 'Skupina';
  let box = document.getElementById('frToast');
  if (!box) { box = h('div', { id: 'frToast', class: 'fr-toast', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const el = h('div', { class: 'fr-toast-item', 'data-room': roomId },
    h('span', { text: '💬 Nová zpráva ve skupině „' + name + '“' }),
    h('button', { type: 'button', class: 'primary', text: 'Otevřít', onclick: () => { el.remove(); try { dispatchEvent(new CustomEvent(OPEN_ROOM_EVENT, { detail: { roomId } })); } catch (e) { } } }));
  box.querySelectorAll('.fr-toast-item[data-room="' + roomId + '"]').forEach(x => x.remove());
  box.append(el); setTimeout(() => el.remove(), 6000);
}
function onRoomMsgs(roomId, msgs) {
  const first = !NOTE.seen.has(roomId), seen = NOTE.seen.get(roomId) || new Set();
  NOTE.msgs.set(roomId, msgs);
  const lr0 = lastRead();
  if (!(roomId in lr0)) { lr0[roomId] = maxAt(msgs); lsSet('lastread', lr0); }   // poprvé (i po aktualizaci z 1p): dosavadní historie se nepočítá
  const fresh = first ? [] : msgs.filter(m => !seen.has(m.id) && m.uid !== NOTE.uid && !m.pending);
  NOTE.seen.set(roomId, new Set(msgs.map(m => m.id)));
  if (NOTE.active.get(roomId) && visible()) markRead(roomId); else recount(roomId);
  if (fresh.length && !(NOTE.active.get(roomId) && visible())) { toast(roomId); systemNotify(); }
}
/* Odběr zpráv pro všechny skupiny, kde jsem schválená/zakladatelka (stejný dotaz jako chat → SDK ho sdílí). */
export async function syncNotifier() {
  let fb; try { fb = await connect(); } catch (e) { return; }
  NOTE.uid = fb.uid;
  const want = new Set(local.rooms().filter(r => r.role === 'owner' || r.role === 'approved').map(r => r.id));
  for (const [id, un] of NOTE.subs) if (!want.has(id)) { try { un(); } catch (e) { } NOTE.subs.delete(id); NOTE.unread.delete(id); NOTE.seen.delete(id); NOTE.msgs.delete(id); }
  for (const id of want) if (!NOTE.subs.has(id)) {
    NOTE.subs.set(id, () => { });
    watchMessages(id, m => onRoomMsgs(id, m), () => { const u = NOTE.subs.get(id); if (u) try { u(); } catch (e) { } NOTE.subs.delete(id); NOTE.unread.delete(id); emitUnread(); })
      .then(u => { if (NOTE.subs.has(id)) NOTE.subs.set(id, u); else u(); }).catch(() => { NOTE.subs.delete(id); });
  }
  const m = lastRead(); let pr = false; Object.keys(m).forEach(k => { if (!local.rooms().some(r => r.id === k)) { delete m[k]; pr = true; } }); if (pr) lsSet('lastread', m);
  emitUnread();
}
export function stopNotifier() { NOTE.subs.forEach(u => { try { u(); } catch (e) { } }); NOTE.subs.clear(); NOTE.unread.clear(); NOTE.seen.clear(); NOTE.msgs.clear(); emitUnread(); }
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (visible()) NOTE.active.forEach((on, id) => { if (on) markRead(id); }); });

/* 1.2.6: každá chyba přihlášení Firebase (auth/…) má za českou větou i kategorii chyby (bez tajemství), aby šlo
 * z fotky obrazovky poznat, co přesně selhalo. */
function errText(e) {
  const c = String((e && e.code) || ''), t = errText0(e);
  return c.startsWith('auth/') ? t + ' (chyba Firebase: ' + c + ')' : t;
}
function errText0(e) {
  const c = (e && e.code) || '';
  if (c === 'bandapp/invite-used') return 'Tuto pozvánku mezitím použil někdo jiný. Každá pozvánka platí jen jednou – požádej o novou.';
  if (c === 'bandapp/invite-missing') return 'Pozvánka neexistuje – byla zrušena nebo vypršela.';
  if (c === 'bandapp/bad-code') return 'Kód má špatný tvar. Obnovovací kód začíná BAND- a má dalších 32 znaků (písmena a číslice). Zkontroluj, jestli jsi ho opsala celý.';
  if (c === 'bandapp/not-this-account') return 'Tento kód nepatří k tomuto účtu.';
  if (c === 'bandapp/old-code-required') return 'Nový kód jde vytvořit jen po zadání starého kódu.';
  if (c === 'bandapp/recovery-unverified') return 'Obnovovací kód se zatím připravuje (není ověřený), proto ho teď nejde vytvořit ani použít.';
  if (c === 'bandapp/has-code') return 'Účet už obnovovací kód má. Můžeš vytvořit nový.';
  if (c === 'bandapp/no-code') return 'Účet zatím nemá obnovovací kód.';
  if (c === 'bandapp/signed-out') return CHANGED_TEXT;
  if (c === 'bandapp/nick-taken') return 'Tuto přezdívku už má jiná členka ve skupině „' + ((e && e.room) || 'Skupina') + '“. Vyber si jinou, ať si vás nikdo nesplete. Nic se nezměnilo.';
  if (c === 'bandapp/no-account') return 'Tento telefon (prohlížeč) není přihlášený k žádnému účtu BAND APP.';
  if (c === 'bandapp/bad-transfer-code') return 'Kód účtu nesouhlasí s kódem tohoto účtu – převod se neprovedl. Opiš kód z jejího telefonu (Kamarádky → Můj účet).';
  if (c === 'bandapp/already-member') return 'V této skupině už členkou jsi – pozvánku nepotřebuješ.';
  if (c === 'bandapp/nick-empty') return 'Napiš novou přezdívku (1 až 24 znaků).';
  if (c === 'bandapp/offline') return 'Přezdívku jde změnit jen s internetem. Nic se nezměnilo.';
  if (c.startsWith('bandapp/')) return 'Něco se nepovedlo. Nic se nezměnilo, zkus to znovu.';
  if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found' || c === 'auth/invalid-login-credentials' || c === 'auth/user-mismatch')
    return 'Kód nesouhlasí. Zkontroluj ho (hlavně podobné znaky) a zkus to znovu. Pokud sis mezitím vytvořila nový kód, starý už neplatí.';
  if (c === 'auth/user-token-expired' || c === 'auth/invalid-user-token') return CHANGED_TEXT;
  if (c === 'auth/too-many-requests') return 'Příliš mnoho pokusů. Firebase obnovu na chvíli zablokoval – zkus to později.';
  if (c === 'auth/user-disabled') return 'Tento účet je zablokovaný.';
  if (c === 'auth/invalid-email') return 'Firebase odmítl adresu obnovovacího účtu. Viz návod SETUP-FIREBASE.md (RECOVERY_EMAIL_DOMAIN).';
  if (c === 'auth/email-already-in-use' || c === 'auth/credential-already-in-use') return 'Kód se nepodařilo vytvořit (shoda). Zkus to znovu.';
  if (c === 'auth/provider-already-linked') return 'Účet už obnovovací kód má.';
  if (c === 'auth/weak-password' || c === 'auth/password-does-not-meet-requirements') return 'Firebase má zapnutá zvláštní pravidla pro hesla. Viz návod SETUP-FIREBASE.md (Password policy nech vypnutou).';
  if (c === 'auth/unauthorized-domain') return 'Tato adresa není ve Firebase povolená (Authorized domains). Viz návod SETUP-FIREBASE.md.';
  if (c === 'auth/operation-not-allowed' || c === 'auth/admin-restricted-operation') return 'Ve Firebase není zapnuté přihlášení Email/Password (nebo Anonymous). Viz návod SETUP-FIREBASE.md.';
  if (c === 'auth/network-request-failed' || c === 'auth/timeout') return 'Firebase teď není dostupný – zkontroluj internet (Wi-Fi nebo mobilní data) a zkus to znovu. Účet ani data se nezměnily.';
  if (c === 'auth/invalid-api-key' || c.startsWith('auth/api-key-not-valid') || c === 'auth/app-not-authorized' || c === 'auth/invalid-app-credential') return 'Firebase odmítl tuto aplikaci (nastavení projektu). Pošli správci snímek této hlášky.';
  if (c === 'auth/web-storage-unsupported') return 'Telefon nedovolí uložit přihlášení (úložiště prohlížeče je vypnuté nebo plné).';
  if (c === 'auth/quota-exceeded') return 'Firebase má teď vyčerpaný limit přihlášení. Zkus to později.';
  if (c === 'auth/internal-error') return 'Firebase hlásí vnitřní chybu. Zkus to za chvíli znovu.';
  if (c === 'auth/requires-recent-login') return 'Firebase chce čerstvé ověření. Zadej starý kód znovu.';
  if (c.includes('permission-denied')) return 'Nemáš k tomu oprávnění (možná pozvánka vypršela nebo tě zakladatelka skupiny odebrala).';
  if (c.includes('unavailable') || c.includes('network')) return 'Není připojení k internetu. Zkus to znovu.';
  if (c.includes('resource-exhausted') || c.includes('quota')) return 'Dnešní bezplatný limit je vyčerpaný. Zkus to zítra.';
  if (c.includes('failed-precondition') || c.includes('aborted')) return 'Pozvánku mezitím použil někdo jiný nebo se změnila. Zkus to znovu nebo požádej o novou.';
  if (c.startsWith('auth/')) return 'Přihlášení k Firebase se nepovedlo.';
  return 'Něco se nepovedlo. Zkus to znovu.';
}
export { errText };
/* 1.2.2: poslední chyba pozvánky/přihlášení pro „Diagnostika hovorů“ – jen kód chyby, jen v této relaci (sessionStorage). */
export function noteDiagErr(where, e) { try { sessionStorage.setItem('bandapp-diag-err', JSON.stringify({ where, code: String((e && e.code) || (e && e.name) || 'neznámá').slice(0, 40), at: Date.now() })); } catch (x) { } }

/* ---------- styl (černočervený, dotykové prvky min. 44 px) ---------- */
function injectStyle() {
  if (document.getElementById('fr-style')) return;
  document.head.append(h('style', { id: 'fr-style', text: `
.fr button{min-height:44px;min-width:44px}.fr input[type=text],.fr textarea{width:100%;padding:12px;background:#0a0a0a;color:#fff;border:1px solid #5c1219;border-radius:10px;font:inherit;min-height:44px}
.fr label.chk{display:flex;gap:10px;align-items:flex-start;padding:8px 0;min-height:44px;cursor:pointer}.fr label.chk input{width:24px;height:24px;flex:none;margin-top:2px}
.fr .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}.fr .note{color:#c0c0c8;font-size:14px;line-height:1.5}
.fr .box{background:#1d1d1f;border:1px solid #3a1a1e;border-radius:12px;padding:12px;margin:10px 0}.fr .err{background:#3a070c;border:1px solid #e0202f;border-radius:12px;padding:12px;color:#ffd6d9;margin:8px 0}
.fr .ok{color:#7fdc8f}.fr ul.fr-list{list-style:none;padding:0;margin:0;display:grid;gap:8px}.fr ul.fr-list li{background:#1d1d1f;border:1px solid #3a1a1e;border-radius:12px;padding:10px}
.fr .fname{font-weight:bold;word-break:break-word}.fr .fstat{font-size:13px;color:#e8c4c8}.fr .star{background:none;border:1px solid #5c1219;border-radius:10px;color:#777;font-size:22px;cursor:pointer}.fr .star.on{color:#ffcc33;border-color:#b3001b}
.fr .msgs{height:52vh;max-height:460px;overflow-y:auto;background:#0d0d0d;border:1px solid #3a1a1e;border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px}
.fr .msg{max-width:82%;background:#232326;border:1px solid #3a1a1e;border-radius:14px;padding:8px 12px;align-self:flex-start;word-break:break-word;white-space:pre-wrap}.fr .msg.me{align-self:flex-end;background:#5a0a12;border-color:#b3001b}
.fr .msg .who{font-size:12px;color:#e8c4c8;margin-bottom:2px}.fr .msg .when{font-size:11px;color:#9a9aa2;margin-top:2px;text-align:right}.fr .link{width:100%;font-size:13px}
.fr button[disabled]{opacity:.5;cursor:not-allowed}.fr .code{font:bold 20px/1.5 ui-monospace,Consolas,monospace;letter-spacing:1px;word-break:break-all;background:#0a0a0a;border:1px dashed #e0202f;border-radius:10px;padding:10px;color:#fff;user-select:all}.fr details.box>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:bold}.fr .warnbox{background:#2a1a05;border:1px solid #b36b00;border-radius:12px;padding:10px;color:#ffe2b3;margin:8px 0}.fr .inv{font-size:14px}.fr .tabs{display:flex;gap:6px;flex-wrap:wrap}.fr .tabs button.on{background:#6b0d17}
.fr .groups{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:8px 0 12px}
.fr .gcard{display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:left;background:#1d1d1f;color:#fff;border:1px solid #3a1a1e;border-radius:14px;padding:12px;min-height:72px;cursor:pointer;font:inherit}
.fr .gcard.on{border-color:#e0202f;background:#2a0508;box-shadow:0 0 0 1px #b3001b inset}.fr .gcard .gname{font-weight:bold;word-break:break-word}.fr .gcard .gmeta{font-size:13px;color:#c0c0c8}
.fr .gcard.new{align-items:center;justify-content:center;border-style:dashed;color:#ffb3ba}.fr .badge{display:inline-block;background:#b3001b;color:#fff;border-radius:999px;padding:1px 8px;font-size:12px;font-weight:bold}
.fr .badge.wait{background:#5a3a05;color:#ffe2b3}.fr button.big{width:100%;font-size:18px;padding:14px;min-height:54px;border-radius:12px}
.fr .ficon{flex:none;width:30px;text-align:center;font-size:20px}.fr .dup{color:#ffcc66;font-size:13px}.fr .mynick{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0}
.fr .chat{display:flex;flex-direction:column}.fr .msgs{height:min(60vh,520px);height:min(60dvh,520px);min-height:260px;max-height:none}
.fr .msg{border-radius:16px 16px 16px 4px}.fr .msg.me{border-radius:16px 16px 4px 16px}.fr .msg .who .own{color:#ffcc33}
.fr .compose{position:sticky;bottom:0;z-index:3;display:flex;gap:8px;align-items:flex-end;background:#161616;padding:8px 0 calc(8px + env(safe-area-inset-bottom));border-top:1px solid #3a1a1e;margin-top:8px}
.fr-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom));z-index:9999;display:grid;gap:8px;width:min(92vw,440px)}
.fr-toast-item{display:flex;gap:10px;align-items:center;justify-content:space-between;background:#2a0508;color:#fff;border:1px solid #e0202f;border-radius:14px;padding:10px 12px;box-shadow:0 6px 24px #000a;font:15px system-ui,Arial}
.fr-toast-item button{min-height:44px;background:#b3001b;color:#fff;border:0;border-radius:10px;padding:8px 14px;font:inherit}
.fr .badge.unread,.fr-hbadge{background:#e0202f;color:#fff;border-radius:999px;padding:1px 8px;font-size:13px;font-weight:bold;vertical-align:middle}.fr-hbadge{font-size:14px;margin-left:8px}
.fr .compose textarea{flex:1;resize:none;min-height:48px;max-height:140px;font-size:16px}.fr .compose button{min-height:48px;min-width:56px;flex:none}.fr .ccount{font-size:12px;color:#9a9aa2;text-align:right;margin:2px 0}
` }));
}
const btn = (cls, text, onclick, extra) => h('button', Object.assign({ class: cls, type: 'button', onclick }, extra || {}), text);
/* 1g: místo dlouhého poučení 2 krátké řádky; úplné informace a Pravidla skupiny jsou v soukromi.html. */
const PRIVACY = 'Zprávy vidí jen schválené členky. Nejsou koncově šifrované: technicky k nim má přístup správce aplikace a Google.';
const PRIVACY_URL = 'soukromi.html';
const privacyLink = () => h('a', { href: PRIVACY_URL, class: 'fr-plink', 'data-act': 'privacy', style: 'color:#ffb3ba' }, 'Soukromí a pravidla →');
/* Dva krátké řádky pod formulářem. lead = věta o přijetí pravidel (pozvánka: „Odesláním žádosti…“, zakladatelka: „Založením skupiny…“). */
const privacyLines = lead => [h('p', { class: 'note', 'data-privacy': '1', text: PRIVACY }), h('p', { class: 'note', 'data-rules': '1' }, lead + ' ', privacyLink())];
export { PRIVACY, PRIVACY_URL };

/* ---------- chat (sdílí ho index.html i join.html) ---------- */
export function mountChat(el, roomId, getNick, meUid) {
  // 1.1: mobilní chat – bubliny (moje vpravo), pole pro psaní přilepené dole, automatické posouvání,
  // u zpráv AKTUÁLNÍ přezdívka autorky podle seznamu členek (👑 = zakladatelka); když autorka ve skupině už není,
  // ukáže se přezdívka uložená ve zprávě.
  const list = h('div', { class: 'msgs', role: 'log', 'aria-live': 'polite', 'data-room': roomId });
  const ta = h('textarea', { rows: 1, maxlength: MAX_TEXT, placeholder: 'Napiš zprávu…', 'aria-label': 'Zpráva', enterkeyhint: 'send' });
  const count = h('div', { class: 'ccount', text: '0 / ' + MAX_TEXT });
  const err = h('div', { class: 'err', role: 'alert', hidden: true });
  const send = btn('primary', 'Odeslat ➤', null, { 'data-act': 'send', 'aria-label': 'Odeslat zprávu' });
  let msgs = [], who = new Map(), forceBottom = true, first = true;
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 140) + 'px'; };
  ta.addEventListener('input', () => { count.textContent = ta.value.length + ' / ' + MAX_TEXT; grow(); });
  const doSend = async () => {
    const text = ta.value.trim(); if (!text) return;
    if (text.length > MAX_TEXT) { err.hidden = false; err.textContent = 'Zpráva může mít nejvýš ' + MAX_TEXT + ' znaků.'; return; }
    send.disabled = true; err.hidden = true; forceBottom = true;
    try { await sendMessage(roomId, getNick(), text); ta.value = ''; count.textContent = '0 / ' + MAX_TEXT; grow(); }
    catch (e) { if (e && e.code === 'permission-denied' && !(await checkSession())) return; err.hidden = false; err.textContent = 'Zpráva se neodeslala. ' + errText(e); }
    finally { send.disabled = false; ta.focus(); }
  };
  send.addEventListener('click', doSend);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer:fine)').matches) { e.preventDefault(); doSend(); } });
  fill(el, h('div', { class: 'chat' }, list, err, h('div', { class: 'compose' }, ta, send), count,
    h('p', { class: 'note', text: 'Zprávy nejsou koncově šifrované. Starší než 30 dní se nezobrazují.' })));
  // 1.2.3: zprávy starého účtu po převodu členství patří stejné osobě (replacedBy → nový účet).
  const cur0 = uid => { let x = who.get(uid), n = 0; while (x && x.status === 'replaced' && x.replacedBy && who.get(x.replacedBy) && n++ < 5) x = who.get(x.replacedBy); return x; };
  const mine = m => m.uid === meUid || ((cur0(m.uid) || {}).uid === meUid);
  const label = m => {
    if (mine(m)) return 'Ty';
    const cur = cur0(m.uid), n = (cur && cur.nick) || m.nick || 'Kamarádka';
    return cur && cur.status === 'owner' ? n + ' 👑' : n;
  };
  const render = () => {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    fill(list, ...(msgs.length ? msgs.map(m => h('div', { class: 'msg' + (mine(m) ? ' me' : ''), 'data-id': m.id, 'data-uid': m.uid || '' },
      h('div', { class: 'who', text: label(m) }), h('div', { class: 'mtext', text: m.text == null ? '' : String(m.text) }), h('div', { class: 'when', text: m.pending ? 'odesílám…' : fmtTime(m.at) })))
      : [h('p', { class: 'note', text: 'Zatím tu nejsou žádné zprávy. Napiš první!' })]));
    if (forceBottom || first || atBottom || msgs.length < 15) { list.scrollTop = list.scrollHeight; forceBottom = false; first = false; }
  };
  let unsub = null, unsubM = null, stopped = false;
  NOTE.active.set(roomId, (NOTE.active.get(roomId) || 0) + 1);       // 1.1: otevřený chat = přečteno
  watchMembers(roomId, ms => { who = new Map(ms.filter(x => x && x.uid).map(x => [x.uid, x])); render(); }, () => { })
    .then(u => { if (stopped) u(); else unsubM = u; }).catch(() => { });
  watchMessages(roomId, m => { msgs = m; render(); if (visible()) { if (!NOTE.msgs.has(roomId) || maxAt(m) >= maxAt(NOTE.msgs.get(roomId))) NOTE.msgs.set(roomId, m); markRead(roomId); } }, async e => { if (e && e.code === 'permission-denied' && !(await checkSession())) return; err.hidden = false; err.textContent = 'Chat není dostupný. ' + errText(e); })
    .then(u => { if (stopped) u(); else unsub = u; }).catch(e => { err.hidden = false; err.textContent = errText(e); });
  return () => { stopped = true; if (unsub) unsub(); if (unsubM) unsubM(); const n = (NOTE.active.get(roomId) || 1) - 1; if (n > 0) NOTE.active.set(roomId, n); else NOTE.active.delete(roomId); };
}

/* 1.1: „🔔 Upozornění na zprávy“ – výchozí stav VYPNUTO. Oprávnění se žádá jen po klepnutí. */
const NOTIFY_LIMIT = 'Upozornění přijde jen tehdy, když je BAND APP spuštěná (i na pozadí). Když je aplikace úplně zavřená, upozornění nepřijde. V upozornění není přezdívka, skupina ani text zprávy – jen „' + NOTIFY_TITLE + '“.';
const NOTIFY_DENIED = 'Upozornění jsou v prohlížeči zakázaná. Povolit je můžeš takto: v Chromu klepni na ikonu vedle adresy (zámek) → Oprávnění → Oznámení → Povolit. U nainstalované aplikace: Nastavení telefonu → Aplikace → BAND APP (nebo Chrome) → Oznámení. Pak sem přepínač zapni znovu.';
function notifyPanel() {
  const body = h('div'), box = h('details', { class: 'box', id: 'frNotify' }, h('summary', { text: '🔔 Upozornění na zprávy' }), body);
  const render = () => {
    const sup = notifySupported(), perm = sup ? Notification.permission : 'unsupported', on = notifyEnabled() && perm === 'granted';
    const t = btn(on ? 'primary' : 'secondary', on ? '🔔 Upozornění: ZAPNUTO' : '🔕 Upozornění: VYPNUTO', async () => {
      if (on) { lsSet('notify', false); return render(); }
      if (!sup) return render();
      let p = Notification.permission;
      // Jen po klepnutí. Když je oprávnění zablokované, prohlížeč odpoví hned „denied“ bez okna.
      if (p !== 'granted') { t.disabled = true; try { p = await Notification.requestPermission(); } catch (e) { p = Notification.permission; } }
      lsSet('notify', p === 'granted'); render();
      if (p !== 'granted') { const w = document.getElementById('frNotifyDenied'); if (w) w.hidden = false; }
    }, { id: 'frNotifyToggle', 'aria-pressed': String(on), disabled: !sup });
    fill(body, h('p', { class: 'note', text: 'V aplikaci uvidíš počet nepřečtených zpráv u skupin a krátké oznámení „Nová zpráva ve skupině …“ vždy. Tady můžeš navíc zapnout upozornění telefonu.' }),
      h('div', { class: 'row' }, t),
      !sup ? h('p', { class: 'warnbox', 'data-state': 'notify-unsupported', text: 'Tento prohlížeč upozornění neumí. (Na iPhonu fungují jen v BAND APP přidané na plochu, iOS 16.4 a novější.)' }) : null,
      h('p', { class: 'warnbox', id: 'frNotifyDenied', 'data-state': 'notify-denied', hidden: perm !== 'denied', text: NOTIFY_DENIED }),
      h('p', { class: 'note', 'data-state': 'notify-limit', text: NOTIFY_LIMIT }));
  };
  render(); return box;
}

/* 1.1: „✏️ Změnit přezdívku“ – sdílí ho index.html i join.html. */
function nickEditor(getCurrent, onDone) {
  const box = h('div', { class: 'box', id: 'frNickBox', 'data-state': 'nick-edit', hidden: true });
  const open = () => {
    const inp = h('input', { type: 'text', id: 'frNewNick', maxlength: 24, value: getCurrent() || '', autocomplete: 'nickname', 'aria-label': 'Nová přezdívka' });
    const e2 = h('div', { class: 'err', role: 'alert', hidden: true }), msg = h('p', { class: 'note', role: 'status', id: 'frNickMsg' });
    const save = btn('primary', '💾 Uložit přezdívku', async () => {
      e2.hidden = true; msg.textContent = '';
      const n = cleanNick(inp.value);
      if (!n) { e2.hidden = false; e2.textContent = errText({ code: 'bandapp/nick-empty' }); return; }
      if (n === cleanNick(getCurrent())) { box.hidden = true; return; }
      save.disabled = true; msg.textContent = 'Ukládám…';
      try { const r = await changeNick(n); box.hidden = true; fill(box); if (onDone) onDone(r); }
      catch (e) { msg.textContent = ''; e2.hidden = false; e2.textContent = errText(e); save.disabled = false; }
    }, { id: 'frNickSave' });
    fill(box, h('label', { for: 'frNewNick', text: 'Nová přezdívka (1–24 znaků, ne celé jméno)' }), inp,
      h('p', { class: 'note', text: 'Účet, skupiny, kamarádky i zprávy zůstanou. U tvých zpráv se ostatním ukáže nová přezdívka. Nesmí být stejná jako přezdívka jiné členky.' }),
      e2, msg, h('div', { class: 'row' }, save, btn('secondary', 'Zrušit', () => { box.hidden = true; fill(box); }, { id: 'frNickCancel' })));
    box.hidden = false; inp.focus(); inp.select();
  };
  const button = btn('secondary', '✏️ Změnit přezdívku', () => { if (box.hidden) open(); else { box.hidden = true; fill(box); } }, { id: 'frNickEdit' });
  return { button, box };
}

/* =====================================================================
   Můj účet: obnovovací kód (index.html)
   ===================================================================== */
const CHANGED_TEXT = 'Tvůj kód byl změněn na jiném zařízení. Zadej nový kód.';
const LOST_TEXT = 'Bez kódu účet obnovit nejde. Aplikace žádný jiný způsob obnovy nemá. Můžeš si založit nový účet a požádat zakladatelku skupiny o novou pozvánku.';
const UNVERIFIED_TEXT = 'Obnova účtu kódem se teprve ověřuje a zatím není zapnutá. Do té doby platí: když smažeš data prohlížeče, odinstaluješ aplikaci nebo vyměníš telefon, přijdeš o tento účet, skupinu i kontakty a obnovit je nepůjde. Chat a pozvánky fungují normálně.';
const LIMIT_TEXT = 'Důležité: kód je jediný klíč k tvému účtu, aplikace žádný jiný způsob obnovy nemá. Když ztratíš kód a zároveň přijdeš o telefon nebo smažeš data prohlížeče, účet v aplikaci obnovit nepůjde. Pak založíš novou skupinu a kamarádky pozveš znovu.';
function downloadCode(code) {
  const text = 'BAND APP – obnovovací kód\r\n\r\n' + code + '\r\n\r\nVytvořen: ' + fmtTime(new Date()) + '\r\n\r\n'
    + 'Použití: BAND APP → Kamarádky → Můj účet → Obnovit účet → vlož tento kód.\r\n'
    + 'Nikomu ho neposílej. Kdo ho zná, dostane se do tvého účtu. Když vytvoříš nový kód, tento přestane platit.\r\n';
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = h('a', { href: url, download: 'band-app-obnovovaci-kod.txt', style: 'display:none' });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30e3);
}
/* 1h: „Kód nemám“ – jen poctivý text, žádná akce, žádné obejití. */
function lostCode() {
  const box = h('div', { class: 'warnbox', id: 'frLostText', 'data-state': 'lost-code', hidden: true, text: LOST_TEXT });
  const b = btn('secondary', 'Kód nemám', () => { box.hidden = !box.hidden; }, { id: 'frLostCode', 'aria-expanded': 'false' });
  b.addEventListener('click', () => b.setAttribute('aria-expanded', String(!box.hidden)));
  return [h('div', { class: 'row' }, b), box];
}
/* Potvrzení před přepnutím na účet z kódu, když je v zařízení přihlášený jiný účet s daty. */
function confirmSwitch(fb) {
  const u = fb && fb.auth.currentUser; if (!u || !deviceHasData()) return true;
  if (!hasCode(u)) return confirm('Pozor: na tomto zařízení je jiný účet Kamarádek, který NEMÁ obnovovací kód. Po přepnutí se k němu už nedostaneš (jeho skupiny a kontakty se tu ztratí). Opravdu přepnout na účet z kódu?');
  return confirm('Na tomto zařízení je přihlášený jiný účet. Přepnout na účet z kódu? (K současnému účtu se vrátíš jeho vlastním kódem.)');
}
function accountPanel(onRestored, onSignedOut) {
  const body = h('div', { id: 'frAccountBody' }, h('p', { class: 'note', text: 'Načítám…' }));
  const box = h('details', { class: 'box', id: 'frAccount' }, h('summary', { text: '🔐 Můj účet: kód účtu, zabezpečení a obnova' }), body);
  let loaded = false;
  // Kód se ukáže jen jednou; z obrazovky zmizí po „Hotovo“. Nikam se neukládá.
  const showCode = (code, isNew) => {
    // 1h: místo zaškrtávátka jedno tlačítko „Zapsala jsem si ho“ (s potvrzením – kód se znovu neukáže).
    const msg = h('p', { class: 'note', role: 'status' });
    const done = btn('primary', 'Zapsala jsem si ho', () => { if (!confirm('Máš kód opravdu zapsaný? Znovu ho už neuvidíš.')) return; code = ''; render(); }, { id: 'frCodeDone' });
    fill(body, 
      h('div', { class: 'warnbox', 'data-state': 'show-code' },
        h('strong', { text: isNew ? '🔑 Tvůj NOVÝ obnovovací kód' : '🔑 Tvůj obnovovací kód' }),
        h('p', { class: 'code', id: 'frCodeValue', text: code }),
        h('p', { text: 'Ukáže se jen teď. Opiš si ho na papír a schovej. Nikomu ho neposílej a nefoť – kdo ho zná, dostane se do tvého účtu.' + (isNew ? ' Starý kód už neplatí.' : '') })),
      h('div', { class: 'row' },
        btn('secondary', '📋 Kopírovat', async () => { try { await navigator.clipboard.writeText(code); msg.textContent = 'Zkopírováno. Ulož ho na bezpečné místo (ne do zprávy kamarádce).'; } catch (e) { msg.textContent = 'Kód opiš ručně.'; } }, { id: 'frCodeCopy' }),
        btn('secondary', '💾 Stáhnout jako soubor', () => { downloadCode(code); msg.textContent = 'Soubor band-app-obnovovaci-kod.txt je ve Stažených souborech.'; }, { id: 'frCodeDownload' })),
      msg, h('p', { class: 'note', text: LIMIT_TEXT }), h('div', { class: 'row' }, done));
    box.open = true;
  };
  const render = async () => {
    let fb; try { fb = await connect(); } catch (e) { fill(body, h('div', { class: e && e.code === 'bandapp/no-account' ? 'note' : 'err', role: 'alert', 'data-state': e && e.code, text: e && e.code === 'bandapp/no-account' ? errText(e) + ' Účet obnovíš obnovovacím kódem (♻️ Mám obnovovací kód).' : 'Nepodařilo se připojit. ' + errText(e) })); loaded = false; return; }
    const info = accountInfo(fb), msg = h('div', { role: 'status', class: 'note', id: 'frAccountMsg' }), e2 = h('div', { class: 'err', role: 'alert', hidden: true });
    const showE = e => { e2.hidden = false; e2.textContent = errText(e); };
    const myCode = h('p', { class: 'note', id: 'frMyAccountCode', 'data-account-code': '', text: 'Kód účtu: …' });
    deviceCode(fb.uid).then(c => { myCode.dataset.accountCode = c; myCode.textContent = 'Kód účtu: ' + c + ' – stejný kód vidí zakladatelka skupiny u tvého jména. Je stálý (aktualizace, restart, pozvánky ho nezmění). Není to heslo: k přihlášení nestačí.'; });
    if (!(await recoveryVerified())) {
      // Pojistka: dokud není ve skutečném Firebase ověřené, že obnova funguje, nic se neslibuje a nic nejde spustit.
      fill(body, myCode, h('div', { class: 'warnbox', 'data-state': 'unverified' },
        h('strong', { text: '🔐 Obnovovací kód: Připravuje se – zatím neověřeno' }),
        h('p', { text: UNVERIFIED_TEXT })),
        h('div', { class: 'row' }, btn('secondary', '🔑 Vytvořit obnovovací kód (připravuje se)', null, { id: 'frMakeCode', disabled: true }),
          btn('secondary', '♻️ Obnovit účet (připravuje se)', null, { id: 'frRestore', disabled: true })));
      return;
    }
    const rem = document.getElementById('frNoCode'); if (rem && info.hasCode) rem.hidden = true;
    const kids = [myCode];
    if (info.signedOutFrom) kids.push(h('div', { class: 'warnbox', 'data-signedout': '1', text: '⚠️ Tento telefon už není přihlášený do tvého účtu s obnovovacím kódem (například protože sis na jiném telefonu vytvořila nový kód). Zadej svůj platný obnovovací kód níže v „Obnovit účet“.' }));
    if (info.hasCode) {
      // Nový kód VŽDY jen se starým kódem (ověří se u Firebase těsně před změnou). Žádná jiná cesta.
      const regen = h('div', { id: 'frRegen' });
      const askOld = () => {
        const old = h('input', { type: 'text', id: 'frOldCode', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'BAND-…', 'aria-label': 'Starý obnovovací kód' });
        const go = btn('primary', 'Ověřit starý kód a vytvořit nový', async () => {
          e2.hidden = true;
          if (!old.value.trim()) return showE({ code: 'bandapp/old-code-required' });
          if (!parseCode(old.value)) return showE({ code: 'bandapp/bad-code' });
          if (!confirm('Vytvořit nový obnovovací kód? Starý kód přestane platit.')) return;
          go.disabled = true;
          try { const c = await regenerateCode(old.value); old.value = ''; showCode(c, true); }
          catch (e) { go.disabled = false; showE(e); }
        }, { id: 'frOldCodeGo' });
        fill(regen, h('p', { class: 'note', text: 'Nový kód jde vytvořit jen se starým kódem. Zadej svůj současný obnovovací kód:' }), old,
          h('div', { class: 'row' }, go, btn('secondary', 'Zrušit', () => { fill(regen); e2.hidden = true; }, { id: 'frOldCodeCancel' })));
        old.focus();
      };
      kids.push(h('p', { class: 'ok', 'data-state': 'has-code', text: '✅ Tvůj účet má obnovovací kód.' }),
        h('p', { class: 'note', text: 'Na novém telefonu (nebo po smazání dat) otevři Kamarádky → Můj účet → Obnovit účet a zadej kód. Vrátí se skupina, kamarádky, hvězdičky, blokované kontakty i historie zpráv (posledních 30 dní).' }),
        h('p', { class: 'note', text: 'Myslíš si, že kód někdo viděl? Vytvoř nový – k tomu potřebuješ starý kód. Starý kód tím přestane platit. Telefony, které už jsou do účtu přihlášené, se nemusí odhlásit hned.' }),
        h('div', { class: 'row' }, btn('secondary', '🔄 Vytvořit nový kód', askOld, { id: 'frNewCode' })), regen);
    } else {
      kids.push(h('div', { class: 'warnbox', 'data-state': 'no-code', text: '⚠️ Zatím nemáš obnovovací kód. Když se smažou data prohlížeče, aplikace se odinstaluje nebo vyměníš telefon, přijdeš o skupinu i kontakty.' }),
        h('p', { class: 'note', text: 'Obnovovací kód je tvůj soukromý klíč k účtu. Nepotřebuješ e-mail ani telefonní číslo. Bez kódu se do tvého účtu v aplikaci nikdo jiný nepřihlásí.' }),
        h('div', { class: 'row' }, btn('primary', '🔐 Zabezpečit účet (vytvořit obnovovací kód)', async ev => {
          const b = ev.currentTarget; b.disabled = true; e2.hidden = true;
          try { showCode(await createRecoveryCode(), false); } catch (e) { showE(e); b.disabled = false; }
        }, { id: 'frMakeCode' })));
    }
    const inp = h('input', { type: 'text', id: 'frRestoreCode', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'BAND-XXXX-XXXX-…', 'aria-label': 'Obnovovací kód' });
    kids.push(h('hr', { style: 'border-color:#3a1a1e' }),
      h('strong', { text: '♻️ Obnovit účet' }),
      h('p', { class: 'note', text: 'Nový telefon nebo smazaná data? Zadej svůj obnovovací kód. Velikost písmen, mezery ani pomlčky nevadí.' }), inp,
      h('div', { class: 'row' }, btn('secondary', '♻️ Obnovit účet', async ev => {
        const b = ev.currentTarget; e2.hidden = true;
        if (!parseCode(inp.value)) return showE({ code: 'bandapp/bad-code' });
        if (!(await isCurrentCode(inp.value)) && !confirmSwitch(fb)) return;
        b.disabled = true;
        try {
          const r = await restoreAccount(inp.value); inp.value = ''; flash(restoreText(r));
          if (!r.same && onRestored) return onRestored();
          await render(); const m = document.getElementById('frAccountMsg'); if (m) m.textContent = restoreText(r);
        }
        catch (e) { showE(e); b.disabled = false; }
      }, { id: 'frRestore' })),
      h('p', { class: 'note', text: LIMIT_TEXT }), e2, msg, ...lostCode());
    // 1h: sdílené zařízení – odhlášení (bez kódu = ztráta účtu, proto výrazné varování).
    const out = btn('secondary', '🚪 Odhlásit z tohoto zařízení', async ev => {
      const b = ev.currentTarget, withCode = accountInfo(fb).hasCode;
      if (!confirm(withCode ? 'Odhlásit z tohoto zařízení? Kamarádky odsud zmizí. Vrátíš se jen se svým obnovovacím kódem.'
        : 'POZOR: tvůj účet NEMÁ obnovovací kód. Po odhlášení o něj přijdeš navždy – skupiny, kamarádky ani zprávy už neuvidíš. Opravdu odhlásit?')) return;
      b.disabled = true; e2.hidden = true;
      try { await signOutDevice(); if (onSignedOut) onSignedOut(); else location.reload(); } catch (e) { b.disabled = false; showE(e); }
    }, { id: 'frSignOut' });
    kids.push(h('hr', { style: 'border-color:#3a1a1e' }), h('strong', { text: '🚪 Sdílené zařízení' }),
      h('p', { class: 'note', 'data-signout-note': info.hasCode ? 'has-code' : 'no-code', text: info.hasCode ? 'Používáš společný tablet nebo počítač? Po odhlášení tu Kamarádky nezůstanou.' : '⚠️ Účet nemá obnovovací kód – po odhlášení bys o něj přišla. Nejdřív si vytvoř kód.' }),
      h('div', { class: 'row' }, out));
    fill(body, ...kids);
  };
  box.addEventListener('toggle', () => { if (box.open && !loaded) { loaded = true; render(); } });
  box.openNow = () => { box.open = true; if (!loaded) { loaded = true; render(); } box.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return box;
}
/* Připomínka, dokud účet nemá obnovovací kód (jen když je už připojeno).
 * Dokud obnova není ověřená (RECOVERY_DOMAIN_VERIFIED), upozorní poctivě, že ztráta dat = ztráta účtu. */
/* Věta o obnově se ukáže jen když je obnova ověřená (jinak nic neslibujeme). */
function recoveryNote(text) {
  const p = h('p', { class: 'note', hidden: true, 'data-recovery-note': '1', text });
  recoveryVerified().then(v => { p.hidden = !v; });
  return p;
}
function codeReminder(panel) {
  const el = h('div', { class: 'warnbox', id: 'frNoCode', hidden: true });
  if (fbReady) {
    const i = accountInfo(fbReady);
    if (!i.hasCode) {
      el.hidden = false;
      add(el, h('span', { text: '⚠️ Bez obnovovacího kódu při výměně telefonu, odinstalování aplikace nebo smazání dat prohlížeče přijdeš o účet, skupinu i kontakty. ' }));
      recoveryVerified().then(v => {
        if (!v) { el.dataset.state = 'unverified'; el.firstChild.textContent = '⚠️ Obnovovací kód se zatím připravuje (neověřeno). Do té doby: když se smažou data prohlížeče, aplikace se odinstaluje nebo vyměníš telefon, přijdeš o účet, skupinu i kontakty – obnovit je zatím nepůjde.'; return; }
        if (i.signedOutFrom) el.firstChild.textContent = '⚠️ Tento telefon už není přihlášený do tvého účtu s kódem. Obnov ho svým kódem. ';
        add(el, btn('secondary', i.signedOutFrom ? '♻️ Obnovit účet' : '🔑 Vytvořit kód', () => panel.openNow(), { id: 'frNoCodeGo' }));
      });
    }
  }
  return el;
}

/* =====================================================================
   Sekce Kamarádky v index.html
   ===================================================================== */
const STATUS_TEXT = { owner: 'zakladatelka skupiny', approved: 'schválená členka', pending: 'čeká na schválení – zatím nevidí zprávy', replaced: 'převedeno na nový účet – tento starý účet už do skupiny nemá přístup' };
const STATUS_ICON = { owner: '👑', approved: '✔', pending: '⏳', replaced: '↪️' };
const REPLACED_TEXT = '↪️ Členství tohoto účtu bylo převedeno na nový účet. Tento (starý) účet už do skupiny nemá přístup – skupinu používej tam, kde je nový účet. Zprávy zůstaly ve skupině.';
const czCount = (n, one, few, many) => n + ' ' + (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
/* 1.1: počty pro kartičky skupin (jen kde smím seznam členek číst = schválená/zakladatelka). Paměť jen pro tuto stránku. */
const roomStats = new Map();
async function loadRoomStats(roomId) {
  try { const { db, F } = await connect(); const s = await F.getDocs(F.collection(db, 'rooms', roomId, 'members')); const ms = s.docs.map(d => d.data());
    const st = { members: ms.filter(m => m && !['pending', 'replaced'].includes(m.status)).length, pending: ms.filter(m => m && m.status === 'pending').length }; roomStats.set(roomId, st); return st; }
  catch (e) { return null; }
}
async function initIndex(root) {
  injectStyle(); root.classList.add('fr');
  if (await configMismatch()) {
    fill(root, h('div', { class: 'err', role: 'alert', 'data-state': 'config-mismatch', text: IS_TEST_BUILD
      ? 'Tato TESTOVACÍ stránka má nahraný veřejný firebase-config.js (nebo údaje projektu, který není testovací). Kamarádky jsou vypnuté – nahraj testovací firebase-config.js (TEST_BUILD = true, testovací projekt).'
      : 'Do veřejné BAND APP byl nahraný testovací firebase-config.js (nebo údaje testovacího projektu Firebase). Kamarádky jsou vypnuté – nahraj veřejný firebase-config.js. Zbytek BAND APP funguje normálně.' }));
    return;
  }
  if (!(await isConfigured())) {
    fill(root, h('p', { class: 'muted', 'data-state': 'unconfigured', text: 'Kamarádky zatím nejsou nastavené.' }),
      h('p', { class: 'note', text: 'Soukromé pozvánky a chat se zapnou podle návodu SETUP-FIREBASE.md. Zbytek BAND APP funguje normálně.' }));
    return;
  }
  const S = { roomId: null, unsubs: [], chatOff: null, members: [], room: null, my: null, invites: [], onUnread: null };
  // 1.1: celkový počet nepřečtených u nadpisu Kamarádek (a na ikoně aplikace, kde to systém umí).
  const head = document.querySelector('#friends > h2'), hb = h('span', { class: 'fr-hbadge', id: 'frUnreadTotal', hidden: true });
  if (head) head.append(hb);
  addEventListener(UNREAD_EVENT, e => { const u = e.detail || unreadCounts(); hb.hidden = !u.total; hb.textContent = u.total ? '💬 ' + u.total : ''; if (S.onUnread) S.onUnread(u); });
  addEventListener(OPEN_ROOM_EVENT, e => { const id = e.detail && e.detail.roomId; if (!id || !local.rooms().some(r => r.id === id)) return; showRoom(id, true); root.scrollIntoView({ block: 'start' }); });
  const stopAll = () => { S.unsubs.forEach(u => { try { u(); } catch (e) { } }); S.unsubs = []; if (S.chatOff) { S.chatOff(); S.chatOff = null; } };
  const showErr = (box, e) => { box.hidden = false; box.textContent = typeof e === 'string' ? e : errText(e); };
  const afterSignOut = () => { stopAll(); stopNotifier(); if (lockedReason()) restoreScreen('manual'); else intro(); };
  // 1h: odhlášení zvenku (kód změněn na jiném zařízení) → žádný nový anonymní účet, jen obrazovka „Zadej nový kód“.
  addEventListener(SIGNED_OUT_EVENT, () => { if (!lockedReason()) return; stopAll(); stopNotifier(); restoreScreen(lockedReason()); });
  /* 1h: obnova účtu kódem jako samostatná obrazovka.
   *  mode 'restore' – „Mám obnovovací kód“ (úvod / nové zařízení)
   *  mode 'changed' – zařízení bylo odhlášené, protože se kód změnil jinde (nebo účet přestal platit)
   *  mode 'manual'  – zařízení bylo odhlášené tlačítkem „Odhlásit z tohoto zařízení“ */
  async function restoreScreen(mode) {
    stopAll();
    const verified = await recoveryVerified();
    const inp = h('input', { type: 'text', id: 'frRestoreCode', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'BAND-XXXX-XXXX-…', 'aria-label': 'Obnovovací kód' });
    const e2 = h('div', { class: 'err', role: 'alert', hidden: true });
    const go = btn('primary', '♻️ Obnovit účet', async () => {
      e2.hidden = true;
      if (!parseCode(inp.value)) { e2.hidden = false; e2.textContent = errText({ code: 'bandapp/bad-code' }); return; }
      let fb = null; try { fb = await base(); } catch (e) { }
      if (mode === 'restore' && !confirmSwitch(fb)) return;
      go.disabled = true;
      try { const r = await restoreAccount(inp.value); inp.value = ''; flash(restoreText(r)); open(); }
      catch (e) { go.disabled = false; e2.hidden = false; e2.textContent = errText(e); }
    }, { id: 'frRestoreGo', disabled: !verified });
    const fresh = btn('secondary', 'Začít znovu s novým účtem', async () => {
      if (!confirm('Založit na tomto zařízení NOVÝ účet? Skupiny a kamarádky z tvého účtu tu neuvidíš – vrátíš se k nim jen s obnovovacím kódem. Do nové skupiny potřebuješ novou pozvánku.')) return;
      fresh.disabled = true;
      try { await startNewAccount(); open(); } catch (e) { fresh.disabled = false; e2.hidden = false; e2.textContent = errText(e); }
    }, { id: 'frFreshAccount' });
    // 1.2.6: „changed“ = zařízení má značku účtu s kódem, ale přihlášení Firebase chybí. Příčinou může být nový kód
    // na jiném zařízení, ale i ztracené přihlášení v telefonu – proto obecně „Odhlášeno – obnov účet“ + který účet to byl.
    const known = await knownAccountCode();
    const head = mode === 'changed' ? [h('h3', { 'data-state': 'code-changed', text: '🔒 Odhlášeno – obnov účet' + (known ? ' ' + known : '') }),
      h('p', { class: 'note', text: 'Tento telefon už není přihlášený' + (known ? ' k účtu ' + known : '') + '. Stává se to po vytvoření nového kódu na jiném zařízení nebo když telefon smaže uložené přihlášení. Tvoje skupiny, kamarádky a zprávy jsou v pořádku – vrátíš se k nim svým (nejnovějším) obnovovacím kódem. Nový účet nezakládej.' })]
      : mode === 'manual' ? [h('h3', { 'data-state': 'signed-out', text: '🔒 Jsi z tohoto zařízení odhlášená.' }),
      h('p', { class: 'note', text: 'Zpátky se dostaneš jen se svým obnovovacím kódem.' })]
      : [h('h3', { 'data-state': 'restore', text: '♻️ Mám obnovovací kód' }),
      h('p', { class: 'note', text: 'Zadej svůj obnovovací kód. Velikost písmen, mezery ani pomlčky nevadí.' })];
    fill(root, ...head, verified ? null : h('div', { class: 'warnbox', 'data-state': 'unverified', text: UNVERIFIED_TEXT }),
      h('label', { for: 'frRestoreCode', id: 'frRestoreLabel', text: mode === 'changed' ? 'Nový obnovovací kód' : 'Obnovovací kód' }), inp, e2, h('div', { class: 'row' }, go, mode === 'restore' ? btn('secondary', 'Zpět', () => intro(), { id: 'frRestoreBack' }) : null),
      ...lostCode(), mode === 'restore' ? null : h('div', { class: 'row' }, fresh));
    inp.focus();
  }

  async function noAccount(known) {
    stopAll();
    const verified = await recoveryVerified();
    const inp = h('input', { type: 'url', id: 'frInviteLinkIn', placeholder: 'Mám pozvánku: vlož odkaz (…join.html#t=…)', autocomplete: 'off', 'aria-label': 'Odkaz pozvánky' });
    const go = btn('secondary', '✉️ Otevřít pozvánku tady', () => { const mm = /[#&]t=([A-Za-z0-9_-]{22})/.exec(inp.value || ''); if (mm) location.href = 'join.html' + location.search + '#t=' + mm[1]; }, { id: 'frInviteLinkGo' });
    fill(root, ...noAccountBlock({ known, onRestore: verified ? () => restoreScreen('restore') : null,
      onCreate: async () => { await createAccount(); open(); }, createLabel: known ? '➕ Přesto založit NOVÝ účet' : '➕ Založit můj účet pro Kamarádky' }),
      h('label', { for: 'frInviteLinkIn', text: 'Dostala jsi pozvánku? Otevři ji přímo tady (ne v prohlížeči):' }), inp, h('div', { class: 'row' }, go),
      h('p', { class: 'note' }, privacyLink()));
  }
  function intro() {
    const b = btn('primary', '👯 Otevřít Kamarádky', async () => { b.disabled = true; await open(); b.disabled = false; });
    const has = btn('secondary', '♻️ Mám obnovovací kód', () => restoreScreen('restore'), { id: 'frHaveCode', hidden: true });
    recoveryVerified().then(v => { has.hidden = !v; });
    fill(root, h('p', { text: 'Soukromý chat s kamarádkami, které sama pozveš a schválíš.' }), h('div', { class: 'row' }, b, has),
      h('p', { class: 'note' }, privacyLink()),
      accountPanel(() => open(), afterSignOut));
  }
  async function open() {
    stopAll();
    fill(root, h('p', { class: 'muted', text: 'Připojuji Kamarádky…' }));
    try { await connect(); } catch (e) {
      if (e && e.code === 'bandapp/signed-out') return restoreScreen(lockedReason() || 'changed');
      if (e && e.code === 'bandapp/no-account') return noAccount(e.knownCode);
      fill(root, h('div', { class: 'err', role: 'alert', text: 'Kamarádky se nepodařilo připojit. Potřebují internet. Ostatní části BAND APP fungují dál.' }), btn('secondary', '↻ Zkusit znovu', open));
      return;
    }
    const rooms = local.rooms();
    if (!rooms.length) return createForm();
    showRoom(rooms.some(r => r.id === S.roomId) ? S.roomId : rooms[rooms.length - 1].id);
  }
  /* 1.2.4: přihlášený účet bez skupiny (typicky nainstalovaná aplikace) – pozvánku vložit sem, ne klepnout v Safari. */
  function inviteJoinBox() {
    const inp = h('input', { type: 'url', id: 'frJoinLinkIn', placeholder: 'Vlož odkaz pozvánky (…join.html#t=…)', autocomplete: 'off', 'aria-label': 'Odkaz pozvánky' });
    const e = h('div', { class: 'err', role: 'alert', hidden: true });
    const go = btn('primary', '✉️ Otevřít pozvánku tady', () => { const mm = /[#&]t=([A-Za-z0-9_-]{22})(?![A-Za-z0-9_-])/.exec(inp.value || ''); if (!mm) { e.hidden = false; e.textContent = 'Tohle nevypadá jako odkaz pozvánky BAND APP.'; return; } location.href = 'join.html' + location.search + '#t=' + mm[1]; }, { id: 'frJoinLinkGo' });
    return h('div', { class: 'box', id: 'frJoinBox', 'data-state': 'join-or-transfer' }, h('strong', { text: '📩 Mám pozvánku / nový účet – požádat o převod' }),
      h('p', { class: 'note', text: 'Dostala jsi pozvánku do skupiny? Nebo už ve skupině jsi, ale s jiným přihlášením (jiný telefon, Safari, smazaná data)? Zkopíruj odkaz pozvánky a vlož ho SEM – klepnutí na odkaz ve zprávě ho na iPhonu otevře v Safari, což je jiné přihlášení. Zakladatelka pak tvoje členství převede na tento účet (podle kódu účtu).' }),
      inp, e, h('div', { class: 'row' }, go));
  }
  function haveCodeBtn() {
    const b = btn('secondary', '♻️ Mám obnovovací kód', () => restoreScreen('restore'), { id: 'frHaveCode', hidden: true });
    recoveryVerified().then(v => { b.hidden = !v; }); return h('div', { class: 'row' }, b);
  }
  function createForm(cancelable) {
    stopAll();
    const nick = h('input', { type: 'text', maxlength: 24, id: 'frNick', placeholder: 'Tvoje přezdívka', value: local.nick() });
    const name = h('input', { type: 'text', maxlength: 40, id: 'frRoomName', placeholder: 'Název skupiny, např. Moje kapela', value: 'Moje kapela' });
    const err = h('div', { class: 'err', role: 'alert', hidden: true });
    // 1g: žádné zaškrtávátko ani souhlas – jen přezdívka a název skupiny.
    const go = btn('primary', 'Založit soukromou skupinu', async () => {
      const n = cleanNick(nick.value), r = name.value.trim().slice(0, 40);
      if (!n || !r) return showErr(err, 'Vyplň přezdívku i název skupiny.');
      go.disabled = true;
      try { local.setNick(n); const room = await createRoom(r, n); showRoom(room.id); } catch (e) { showErr(err, e); go.disabled = false; }
    }, { id: 'frCreate' });
    const panel = accountPanel(() => open(), afterSignOut);
    fill(root, codeReminder(panel), inviteJoinBox(), h('h3', { text: 'Založ si soukromou skupinu' }),
      h('label', { for: 'frNick', text: 'Přezdívka (ne celé jméno)' }), nick, h('label', { for: 'frRoomName', text: 'Název skupiny' }), name, err, h('div', { class: 'row' }, go, cancelable && btn('secondary', 'Zpět', () => open())),
      ...privacyLines('Založením skupiny přijímáš pravidla skupiny.'),
      recoveryNote('Máš už účet z jiného zařízení?'), haveCodeBtn(), panel);
  }
  function showRoom(roomId, autoChat) {
    stopAll(); S.roomId = roomId; S.members = []; S.room = null; S.my = null; S.membersOn = false; S.invites = []; S.invOn = false; S.invDetails = null;
    const info = local.rooms().find(r => r.id === roomId) || { id: roomId, name: 'Skupina', role: 'member' };
    // 1.1: kartičky skupin (název, počet členek, odznak čekajících) místo řady tlačítek.
    const groups = h('div', { class: 'groups', id: 'frGroups', role: 'list' });
    const cardMeta = new Map();
    const metaText = (r, st) => {
      if (r.role === 'pending') return [h('span', { class: 'badge wait', text: '⏳ čekáš na schválení' })];
      if (!st) return [h('span', { text: r.role === 'owner' ? '👑 zakladatelka' : '✔ členka' })];
      return [h('span', { text: czCount(st.members, 'členka', 'členky', 'členek') }), r.role === 'owner' && st.pending ? h('span', { class: 'badge', 'data-pending': String(st.pending), text: '⏳ ' + st.pending + ' čeká' }) : null];
    };
    const renderGroups = () => {
      fill(groups, ...local.rooms().map(r => {
        const meta = h('span', { class: 'gmeta' }, ...metaText(r, roomStats.get(r.id))), un = h('span', { class: 'gunread' }); cardMeta.set(r.id, { meta, r, un });
        return h('button', { type: 'button', class: 'gcard' + (r.id === roomId ? ' on' : ''), role: 'listitem', 'data-room': r.id, 'aria-current': r.id === roomId ? 'true' : null, onclick: () => { if (r.id !== roomId) showRoom(r.id); } },
          h('span', { class: 'gname', text: (r.role === 'owner' ? '👑 ' : '') + (r.name || 'Skupina') }), meta, un);
      }), h('button', { type: 'button', class: 'gcard new', id: 'frNewRoom', onclick: () => createForm(true) }, '＋ Nová skupina'));
      local.rooms().forEach(r => { if (r.id !== roomId && r.role !== 'pending' && !roomStats.has(r.id)) loadRoomStats(r.id).then(st => { const c = cardMeta.get(r.id); if (st && c && S.roomId === roomId) fill(c.meta, ...metaText(c.r, st)); }); });
    };
    const updateCard = () => {
      const c = cardMeta.get(roomId); if (!c || !S.membersOn) return;
      const st = { members: S.members.filter(m => !['pending', 'replaced'].includes(m.status)).length, pending: S.members.filter(m => m.status === 'pending').length };
      roomStats.set(roomId, st); c.r = Object.assign({}, c.r, { role: (S.my && S.my.status) || c.r.role }); fill(c.meta, ...metaText(c.r, st));
    };
    renderGroups();
    S.onUnread = u => cardMeta.forEach((c, id) => { const n = u.rooms[id] || 0; fill(c.un, n ? h('span', { class: 'badge unread', 'data-unread': String(n), text: '💬 ' + n + (n === 1 ? ' nová' : ' nové') }) : null); });
    S.onUnread(unreadCounts()); syncNotifier();
    const title = h('h3', { id: 'frRoomTitle', text: info.name || 'Skupina' });
    const err = h('div', { class: 'err', role: 'alert', hidden: true });
    const inviteBox = h('div', { class: 'box', id: 'frInviteBox', hidden: true });
    const invList = h('div', { id: 'frInvites' });
    const quick = h('div', { class: 'row', id: 'frQuick' });
    const contacts = h('ul', { class: 'fr-list', id: 'frContacts' });
    const contactsTitle = h('h4', { id: 'frContactsTitle', text: 'Moje kamarádky' });
    const blockedBox = h('div', { id: 'frBlocked' });
    const chatWrap = h('div', { id: 'frChat', hidden: true });
    const statusP = h('p', { class: 'fstat', id: 'frMyStatus' });
    const nickSpan = h('span', { id: 'frMyNick' });
    const ned = nickEditor(() => (S.my && S.my.nick) || local.nick(), r => { nickSpan.textContent = 'Tvoje přezdívka: ' + r.nick; nickMsg.textContent = '✅ Přezdívka změněna na „' + r.nick + '“.'; });
    const nickMsg = h('span', { class: 'ok', role: 'status', id: 'frNickDone' });
    const nickRow = h('div', { class: 'mynick', hidden: true }, nickSpan, ned.button, nickMsg);
    const panel = accountPanel(() => open(), afterSignOut);
    fill(root, codeReminder(panel), h('h4', { text: 'Moje skupiny' }), groups, title, statusP, nickRow, ned.box, err, quick, inviteBox, invList, contactsTitle, contacts, blockedBox, chatWrap,
      h('p', { class: 'note', text: 'Kontakty, hvězdičky a blokované jsou uložené v tomto zařízení a navíc v záloze tvého účtu ve Firebase. V aplikaci ji může číst jen tvůj účet (koncově šifrovaná ale není).' }),
      recoveryNote('Na jiný telefon je přeneseš obnovovacím kódem (Můj účet → Obnovit účet).'),
      notifyPanel(), panel);
    const role = () => S.my && S.my.status;
    const isMgr = () => role() === 'owner';
    const canChat = () => ['owner', 'approved'].includes(role());

    const openChat = () => {
      if (!canChat()) return showErr(err, 'Chat se otevře, až tě zakladatelka skupiny schválí.');
      chatWrap.hidden = false; if (S.chatOff) S.chatOff();
      fill(chatWrap, h('h4', { text: '💬 Chat skupiny „' + (info.name || 'Skupina') + '“' }));
      const c = h('div'); add(chatWrap, c);
      connect().then(fb => { S.chatOff = mountChat(c, roomId, () => (S.my && S.my.nick) || local.nick(), fb.uid); });
      chatWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const makeInvite = async (b) => {
      if (b) b.disabled = true; err.hidden = true;
      try {
        const inv = await createInvite(roomId, (S.my && S.my.nick) || local.nick());
        const link = h('input', { type: 'text', class: 'link', readonly: true, value: inv.link, id: 'frInviteLink', 'aria-label': 'Odkaz pozvánky', onfocus: e => e.target.select() });
        const msg = h('p', { class: 'note', role: 'status' });
        const copy = async () => { try { await navigator.clipboard.writeText(inv.link); msg.textContent = 'Odkaz je zkopírovaný. Vlož ho kamarádce do zprávy.'; } catch (e) { link.focus(); link.select(); msg.textContent = 'Odkaz označ a zkopíruj ručně.'; } };
        const share = async () => {
          if (navigator.share) { try { await navigator.share({ title: 'Pozvánka do BAND APP', text: 'Pozvánka do mé soukromé skupiny v BAND APP (platí 24 hodin):', url: inv.link }); msg.textContent = 'Pozvánka odeslána.'; return; } catch (e) { if (e && e.name === 'AbortError') return; } }
          copy();
        };
        inviteBox.hidden = false;
        fill(inviteBox, h('strong', { text: '✉️ Nová pozvánka je připravená' }),
          h('p', { class: 'note', text: 'Platí 24 hodin a jen jednou. Pošli ji jen kamarádce, kterou znáš. Do skupiny ji pustíš až ty (✔ Schválit).' }),
          link, h('div', { class: 'row' }, btn('primary', '📤 Sdílet', share, { id: 'frInviteShare' }), btn('secondary', '📋 Kopírovat', copy, { id: 'frInviteCopy' })), msg);
        inviteBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        share();                                         // 1.1: rovnou otevře sdílení (Messenger, WhatsApp…); bez něj zkopíruje odkaz
      } catch (e) { showErr(err, e); } finally { if (b) b.disabled = false; }
    };
    const renderQuick = () => {
      const r = role(), q = [];
      if (isMgr()) q.push(btn('primary big', '➕ Pozvat kamarádku', e => makeInvite(e.currentTarget), { id: 'frInvite' }));
      if (canChat()) q.push(btn('primary', '💬 Chat skupiny', openChat, { id: 'frOpenChat' }));
      if (r === 'approved' || r === 'pending') q.push(btn('secondary', 'Opustit skupinu', async () => { if (!confirm('Opravdu chceš opustit tuto skupinu?')) return; try { await leaveRoom(roomId); open(); } catch (e) { showErr(err, e); } }));
      fill(quick, ...q);
    };
    /* Stav pozvánek pro zakladatelku: otevřená / použitá (kým a jestli čeká na schválení) / vypršela.
     * Odmítnutí se na server nezapisuje, takže se tu neukazuje – neodmítnutá pozvánka sama vyprší. */
    const invState = (i, now) => {
      if (i.used) {
        const m = S.members.find(x => x.uid === i.usedBy), bl = ((S.room && S.room.blocked) || []).includes(i.usedBy);
        if (m && m.status === 'pending') return { k: 'used-pending', t: 'použila ji „' + (m.nick || 'Kamarádka') + '“ – čeká na tvoje schválení. Neznáš ji? Odmítni nebo zablokuj ji v seznamu níže a pošli novou pozvánku.' };
        if (m) return { k: 'used-member', t: 'použila ji „' + (m.nick || 'Kamarádka') + '“ – ' + (m.status === 'owner' ? 'zakladatelka' : 'schválená členka') };
        if (bl) return { k: 'used-blocked', t: 'použila ji „' + (local.blockedNames()[i.usedBy] || 'neznámá') + '“ – zablokovaná' };
        return { k: 'used-gone', t: 'použitá – osoba už ve skupině není' };
      }
      const exp = Math.min(i.expiresAt ? i.expiresAt.toMillis() : 0, i.createdAt ? i.createdAt.toMillis() + INVITE_MS : Infinity);
      if (exp > now) return { k: 'open', t: 'otevřená – čeká na kamarádku (platí do ' + fmtTime(new Date(exp)) + ')' };
      return { k: 'expired', t: 'vypršela (nikdo ji nepoužil)' };
    };
    const renderInvites = () => {
      if (!isMgr()) { fill(invList); return; }
      const now = Date.now();
      const list = S.invites.slice().sort((a, b) => ((b.createdAt && b.createdAt.toMillis()) || now) - ((a.createdAt && a.createdAt.toMillis()) || now)).slice(0, 8);
      if (!list.length) { fill(invList); return; }
      if (!S.invDetails) { S.invSummary = h('summary'); S.invUl = h('ul', { class: 'fr-list' }); S.invDetails = h('details', { class: 'box' }, S.invSummary, S.invUl); }
      S.invSummary.textContent = '✉️ Moje pozvánky (' + list.length + ')';
      const del = async (i, q) => { if (!confirm(q)) return false; try { await revokeInvite(i.token); return true; } catch (e) { showErr(err, e); return false; } };
      fill(S.invUl, ...list.map(i => { const st = invState(i, now); return h('li', { class: 'inv', 'data-token': i.token, 'data-inv': st.k },
          h('div', { text: fmtTime(i.createdAt ? i.createdAt.toDate() : new Date()) + ' – ' + st.t }),
          h('div', { class: 'row' },
            st.k === 'open' ? btn('secondary', 'Zrušit', () => del(i, 'Zrušit tuto pozvánku? Odkaz přestane fungovat.'), { 'data-act': 'revoke' }) : null,
            st.k === 'open' ? btn('secondary', 'Zrušit a vytvořit novou', async e => { const b = e.currentTarget; if (await del(i, 'Zrušit tuto pozvánku a vytvořit novou? Starý odkaz přestane fungovat.')) makeInvite(b); }, { 'data-act': 'reissue' }) : null,
            st.k !== 'open' ? btn('secondary', 'Smazat ze seznamu', () => del(i, 'Smazat tuto pozvánku ze seznamu? (Kamarádky ve skupině to neovlivní.)'), { 'data-act': 'delete' }) : null)); }));
      if (!invList.contains(S.invDetails)) fill(invList, S.invDetails);
    };

    const renderContacts = () => {
      const meUid = S.uid, mgr = isMgr();
      const others = S.members.filter(m => m.uid !== meUid && (mgr || m.status !== 'replaced'));
      // 1.1: zakladatelka vidí čekající nahoře (čekají na její rozhodnutí); jinak hvězdičky, zakladatelka, členky.
      const rank = m => m.status === 'pending' ? (mgr ? -1 : 2) : m.status === 'owner' ? 0 : m.status === 'replaced' ? 3 : 1;
      others.sort((a, b) => (rank(a) - rank(b)) || (local.isFav(roomId, b.uid) - local.isFav(roomId, a.uid)) || String(a.nick || '').localeCompare(String(b.nick || ''), 'cs'));
      // Stejná přezdívka jako jiná členka (např. pokus vydávat se za někoho) → viditelné upozornění.
      const keys = new Map(); S.members.filter(m => m.status !== 'replaced').forEach(m => { const k = nickKey(m.nick); keys.set(k, (keys.get(k) || 0) + 1); });
      const pend = others.filter(m => m.status === 'pending').length;
      contactsTitle.textContent = 'Moje kamarádky (' + others.filter(m => !['pending', 'replaced'].includes(m.status)).length + ')' + (mgr && pend ? ' · ⏳ ' + pend + ' čeká na schválení' : '');
      updateCard();
      if (!others.length) { fill(contacts, h('li', { class: 'note', text: mgr ? 'Zatím tu nikdo není. Klepni na „➕ Pozvat kamarádku“.' : 'Zatím tu nikdo další není.' })); }
      else fill(contacts, ...others.map(m => {
        const fav = local.isFav(roomId, m.uid), pending = m.status === 'pending';
        const star = btn('star' + (fav ? ' on' : ''), fav ? '★' : '☆', () => { local.toggleFav(roomId, m.uid); renderContacts(); }, { 'aria-label': fav ? 'Odebrat z oblíbených' : 'Označit jako oblíbenou', 'aria-pressed': String(fav) });
        let act = h('div', { class: 'row' });
        if (pending && mgr) add(act, btn('primary', '✔ Schválit', async () => { try { await approveMember(roomId, m.uid); } catch (e) { showErr(err, e); } }, { 'data-act': 'approve' }));
        if (['approved', 'owner'].includes(m.status) && canChat()) add(act, btn('secondary', '💬 Chat', openChat, { 'data-act': 'chat' }));
        if (mgr && ['pending', 'approved'].includes(m.status)) {
          add(act, btn('secondary', pending ? '✖ Odmítnout' : '➖ Odebrat', async () => { if (!confirm('Opravdu odebrat „' + (m.nick || 'Kamarádka') + '“ ze skupiny?')) return; try { await removeMember(roomId, m.uid); } catch (e) { showErr(err, e); } }, { 'data-act': pending ? 'reject' : 'remove' }));
          add(act, btn('secondary', '⛔ Blokovat', async () => { if (!confirm('Zablokovat „' + (m.nick || 'Kamarádka') + '“? Už se nebude moct vrátit ani s novou pozvánkou.')) return; try { await blockMember(roomId, m.uid, m.nick); } catch (e) { showErr(err, e); } }, { 'data-act': 'block' }));
        }
        if (mgr && m.status === 'approved') add(act, btn('secondary', '👑 Předat vlastnictví', async () => {
          if (!confirm('Předat vlastnictví skupiny „' + (m.nick || 'Kamarádka') + '“? Ty zůstaneš běžnou členkou a už nebudeš moct zvát, schvalovat ani blokovat.')) return;
          try { await transferOwnership(roomId, m.uid); } catch (e) { showErr(err, e); }
        }, { 'data-act': 'transfer' }));
        const dup = m.status !== 'replaced' && keys.get(nickKey(m.nick)) > 1;
        const ownerUid = S.room && S.room.ownerUid;
        // 1.2.3: převod členství z dřívějšího účtu (ztracené přihlášení) – jen zakladatelka, osobně s kódem účtu.
        const cands = mgr && ['pending', 'approved'].includes(m.status) && m.uid !== ownerUid
          ? S.members.filter(x => x.status === 'approved' && x.uid !== m.uid && x.uid !== ownerUid && x.uid !== meUid) : [];
        let tbox = null;
        if (cands.length && (pending || dup)) {
          tbox = h('div', { class: 'box', 'data-transfer-box': '1', hidden: true });
          add(act, btn('secondary', '🔁 Převést členství z dřívějšího účtu…', () => { tbox.hidden = !tbox.hidden; }, { 'data-act': 'transfer-open' }));
          const same = cands.filter(x => nickKey(x.nick) === nickKey(m.nick));
          const sel = h('select', { 'data-transfer-from': '1', 'aria-label': 'Dřívější účet' }, ...(same.length ? same : cands).concat(same.length ? cands.filter(x => !same.includes(x)) : []).map(x => {
            const o = h('option', { value: x.uid, text: (x.nick || 'Kamarádka') + ' · kód …' }); deviceCode(x.uid).then(c => { o.textContent = (x.nick || 'Kamarádka') + ' · předchozí kód ' + c; }); return o; }));
          const code = h('input', { type: 'text', 'data-transfer-code': '1', maxlength: 6, autocomplete: 'off', autocapitalize: 'characters', placeholder: 'např. 7DFE2E', 'aria-label': 'Kód účtu z jejího telefonu' });
          const terr = h('div', { class: 'err', role: 'alert', hidden: true });
          fill(tbox, h('p', { class: 'note', text: 'Použij jen OSOBNĚ: stůj vedle ní, ať ti na svém telefonu ukáže Kamarádky → Můj účet → „Kód účtu“ (nebo VIDEOCHAT → Diagnostika). Opiš ho sem – musí sedět s kódem této žádosti. Starý záznam se nesmaže, jen se označí jako převedený; zprávy zůstanou.' }),
            h('label', { text: 'Dřívější účet (přezdívka · předchozí kód):' }), sel, h('label', { text: 'Kód účtu z jejího telefonu:' }), code, terr,
            h('div', { class: 'row' }, btn('primary', '🔁 Převést členství', async ev => {
              const b = ev.currentTarget; terr.hidden = true;
              const from = S.members.find(x => x.uid === sel.value);
              if (!confirm('Převést členství „' + ((from && from.nick) || 'Kamarádka') + '“ na tento účet? Starý účet ztratí přístup do skupiny (záznam zůstane jako „převedeno“).')) return;
              b.disabled = true;
              try { await transferMember(roomId, sel.value, m.uid, code.value); } catch (e) { b.disabled = false; showErr(terr, e); }
            }, { 'data-act': 'transfer-go' })));
        }
        // 1.2.4: převod i ze STARÉHO schváleného záznamu (zakladatelka → „Převést na nový účet…“). Nový účet musí
        // mít čekající žádost (pozvánka otevřená v nové aplikaci); kód z jejího telefonu se opisuje osobně.
        if (mgr && m.status === 'approved' && m.uid !== ownerUid && m.uid !== meUid) {
          const obox = h('div', { class: 'box', 'data-move-box': '1', hidden: true });
          add(act, btn('secondary', '🔁 Převést na nový účet…', () => { obox.hidden = !obox.hidden; }, { 'data-act': 'move-open' }));
          const reqs = S.members.filter(x => x.status === 'pending' && x.uid !== m.uid);
          const who = m.nick || 'Kamarádka';
          if (!reqs.length) {
            fill(obox, h('p', { class: 'note', 'data-move-none': '1', text: 'Zatím tu není žádná nová žádost, na kterou jde členství „' + who + '“ převést. Postup: 1) Klepni nahoře na „➕ Pozvat kamarádku“ a pošli „' + who + '“ NOVOU pozvánku. 2) „' + who + '“ odkaz zkopíruje a vloží v NAINSTALOVANÉ BAND APP (Kamarádky → „Mám pozvánku / nový účet – požádat o převod“), zadá přezdívku a klepne na „Požádat o převod“. (Klepnutí na odkaz ve zprávě ho na iPhonu otevře v Safari – to je jiné přihlášení.) 3) Pak tady znovu otevři „🔁 Převést na nový účet…“, vyber žádost a opiš kód účtu z jejího telefonu.' }));
          } else {
            const osel = h('select', { 'data-move-to': '1', 'aria-label': 'Nová žádost' }, ...reqs.slice().sort((a, b) => (nickKey(b.nick) === nickKey(m.nick)) - (nickKey(a.nick) === nickKey(m.nick))).map(x => {
              const o = h('option', { value: x.uid, text: (x.nick || 'Kamarádka') + ' · kód …' }); deviceCode(x.uid).then(c => { o.textContent = (x.nick || 'Kamarádka') + ' · kód účtu ' + c; }); return o; }));
            const ocode = h('input', { type: 'text', 'data-move-code': '1', maxlength: 6, autocomplete: 'off', autocapitalize: 'characters', placeholder: 'např. 7DFE2E', 'aria-label': 'Kód účtu z jejího telefonu' });
            const oerr = h('div', { class: 'err', role: 'alert', hidden: true });
            fill(obox, h('p', { class: 'note', text: 'Jen OSOBNĚ: ať ti „' + who + '“ na svém (novém) telefonu ukáže Kamarádky → Můj účet → „Kód účtu“ (nebo VIDEOCHAT → Diagnostika). Vyber žádost se STEJNÝM kódem a kód opiš. Starý záznam se nesmaže, jen se označí „převedeno“; zprávy zůstanou. Nový účet dostane přezdívku „' + who + '“.' }),
              h('label', { text: 'Nová žádost (přezdívka · kód účtu):' }), osel, h('label', { text: 'Kód účtu z jejího telefonu:' }), ocode, oerr,
              h('div', { class: 'row' }, btn('primary', '🔁 Převést členství', async ev => {
                const b = ev.currentTarget; oerr.hidden = true;
                if (!confirm('Převést členství „' + who + '“ na vybraný nový účet? Starý účet ztratí přístup do skupiny (záznam zůstane jako „převedeno“).')) return;
                b.disabled = true;
                try { await transferMember(roomId, m.uid, osel.value, ocode.value); } catch (e) { b.disabled = false; showErr(oerr, e); }
              }, { 'data-act': 'move-go' })));
          }
          tbox = tbox ? h('div', {}, tbox, obox) : obox;
        }
        if (m.status === 'replaced') { act = h('div', { class: 'row' }); }
        const repl = m.status === 'replaced' && mgr ? h('div', { class: 'fstat', 'data-replaced': '1', text: 'převedeno na: …' }) : null;
        if (repl) { const nw = S.members.find(x => x.uid === m.replacedBy); deviceCode(m.replacedBy).then(c => { repl.textContent = 'převedeno na: ' + ((nw && nw.nick) || 'nový účet') + ' · kód ' + c; }); }
        return h('li', { 'data-uid': m.uid, 'data-status': m.status }, h('div', { class: 'row', style: 'margin:0' },
          h('span', { class: 'ficon', 'aria-hidden': 'true', text: STATUS_ICON[m.status] || '•' }),
          h('div', { style: 'flex:1;min-width:0' }, h('div', { class: 'fname', text: (m.nick || 'Kamarádka') + (m.status === 'owner' ? ' 👑' : '') }),
            h('div', { class: 'fstat', text: STATUS_TEXT[m.status] || 'členka' }),
            dup ? h('div', { class: 'dup', 'data-dup': '1', text: '⚠️ Stejnou přezdívku má i jiná členka – ověř si, kdo to je.' }) : null,
            mgr ? (m.status === 'replaced' ? prevCodeLine(m.uid) : codeLine(m.uid)) : null, repl), m.status === 'replaced' ? null : star), act, tbox);
      }));
      const bl = (S.room && S.room.blocked) || [];
      if (mgr && bl.length) { const names = local.blockedNames(); fill(blockedBox, h('h4', { text: 'Zablokované' }), h('ul', { class: 'fr-list' }, ...bl.map(u => h('li', {}, h('span', { text: (names[u] || 'neznámá') + ' ' }), btn('secondary', 'Odblokovat', async () => { try { await unblock(roomId, u); } catch (e) { showErr(err, e); } }))))); }
      else fill(blockedBox);
    };

    connect().then(async fb => {
      S.uid = fb.uid;
      // Když server začne odmítat čtení (např. mě odebrali nebo předali vlastnictví), ověříme vlastní záznam přímo.
      const recheck = async e => {
        if (S.roomId !== roomId) return;
        if (!e || e.code !== 'permission-denied') return showErr(err, e);
        if (!(await checkSession())) return;            // 1h: přihlášení odvolané → událost → „Zadej nový kód“
        // Čtení přes transakci jde vždy přímo na server (nezávisle na živých odběrech, které už mohly být odmítnuté).
        try { const s = await fb.F.runTransaction(fb.db, tx => tx.get(fb.F.doc(fb.db, 'rooms', roomId, 'members', fb.uid))); if (!s.exists()) { stopAll(); return onMy(null); } onMy(s.data()); }
        catch (e2) { showErr(err, e); }
      };
      const onMy = my => {
        const prev = role(); S.my = my || null;
        if (my === undefined) { statusP.textContent = 'Jsi offline. Kamarádky se připojí, až bude internet. Ostatní části BAND APP fungují dál.'; return; }
        if (my && my.status === 'replaced') { if (info.role !== 'replaced') { info.role = 'replaced'; local.saveRoom({ id: roomId, role: 'replaced' }); syncNotifier(); } my = null; S.my = null; statusP.dataset.state = 'replaced'; statusP.textContent = REPLACED_TEXT; nickRow.hidden = true; ned.box.hidden = true; err.hidden = true; fill(blockedBox); inviteBox.hidden = true; fill(contacts); fill(quick); fill(invList); chatWrap.hidden = true; if (S.chatOff) { S.chatOff(); S.chatOff = null; } return; }
        if (!my) { statusP.textContent = 'V této skupině už nejsi členkou.'; nickRow.hidden = true; ned.box.hidden = true; err.hidden = true; fill(blockedBox); inviteBox.hidden = true; fill(contacts); fill(quick); fill(invList); chatWrap.hidden = true; if (S.chatOff) { S.chatOff(); S.chatOff = null; } return; }
        if (info.role !== my.status) { info.role = my.status; local.saveRoom({ id: roomId, role: my.status }); syncNotifier(); }
        if (prev !== my.status) { renderQuick(); if (!canChat() && S.chatOff) { S.chatOff(); S.chatOff = null; chatWrap.hidden = true; } }
        if (autoChat && canChat() && !S.chatOff) { autoChat = false; openChat(); }
        nickRow.hidden = false; nickSpan.textContent = 'Tvoje přezdívka: ' + (my.nick || local.nick() || 'Kamarádka');
        if (my.nick && cleanNick(my.nick) !== local.nick() && !local.nick()) local.setNick(cleanNick(my.nick));
        if (my.status === 'pending') { statusP.textContent = '⏳ Čekáš na schválení zakladatelkou skupiny.'; return; }
        statusP.textContent = my.status === 'owner' ? '👑 Jsi zakladatelka této skupiny.' : '✔ Jsi členkou této skupiny.';
        if (!S.membersOn) {
          S.membersOn = true;
          watchMembers(roomId, ms => { S.members = ms; renderContacts(); renderInvites(); }, recheck).then(u => S.unsubs.push(u));
          watchRoom(roomId, r => { S.room = r; if (r && r.name && r.name !== info.name) { info.name = r.name; title.textContent = r.name; local.saveRoom({ id: roomId, name: r.name }); } renderContacts(); renderInvites(); }, recheck).then(u => S.unsubs.push(u));
        }
        if (isMgr() && !S.invOn) { S.invOn = true; watchInvites(roomId, l => { S.invites = l; renderInvites(); }, () => { }).then(u => S.unsubs.push(u)); }
        renderContacts(); renderInvites();
      };
      S.unsubs.push(await watchMyMember(roomId, onMy, recheck));
    }).catch(e => showErr(err, e));
  }

  // 1h: zařízení si pamatuje účet s kódem (nebo ruční odhlášení) → nejdřív zjistit, jestli je pořád přihlášené.
  if (local.rooms().length || lockedReason()) open(); else intro();
}

/* =====================================================================
   join.html – pozvánka pro kamarádku bez instalace
   ===================================================================== */
async function initJoin(root) {
  injectStyle(); root.classList.add('fr');
  addEventListener('hashchange', () => { if (/(?:^|[#&])t=/.test(location.hash)) location.reload(); });   // další odkaz otevřený ve stejné kartě
  const say = (cls, text, state) => fill(root, h('div', { class: cls, role: 'status', 'data-state': state, text }));
  // 1h: odhlášené zařízení (kód změněn jinde / ruční odhlášení) – žádný nový účet; obnova je v BAND APP → Kamarádky.
  const signedOut = () => fill(root, h('div', { class: 'err', role: 'alert', 'data-state': 'signed-out', text: lockedReason() === 'manual' ? 'Jsi z tohoto zařízení odhlášená. Zpátky se dostaneš jen s obnovovacím kódem.' : 'Odhlášeno – obnov účet. Tento telefon není přihlášený ke svému účtu (nový kód na jiném zařízení nebo ztracené přihlášení). Zadej svůj obnovovací kód v BAND APP → Kamarádky.' }),
    h('a', { href: 'index.html' + location.search + '#friends', class: 'note', style: 'color:#ffb3ba', id: 'jRestoreLink', text: 'Zadat kód v BAND APP → Kamarádky' }));
  addEventListener(SIGNED_OUT_EVENT, () => { if (lockedReason()) signedOut(); });
  let token = '';
  const m = /(?:^|[#&])t=([^&]+)/.exec(location.hash);
  if (m) { token = decodeURIComponent(m[1]); try { sessionStorage.setItem(LS + 'join-token', token); } catch (e) { } history.replaceState(null, '', location.pathname + location.search); }
  else { try { token = sessionStorage.getItem(LS + 'join-token') || ''; } catch (e) { } }

  if (await configMismatch()) return say('err', 'Tato stránka a soubor firebase-config.js k sobě nepatří (testovací × veřejná verze). Pozvánky jsou vypnuté.', 'config-mismatch');
  if (!(await isConfigured())) return say('note', 'Kamarádky zatím nejsou nastavené.', 'unconfigured');
  const myRooms = local.rooms().filter(r => r.role !== 'owner');
  if (!token && myRooms.length) return roomView(myRooms[myRooms.length - 1]);
  const dropToken = () => { try { sessionStorage.removeItem(LS + 'join-token'); } catch (e) { } };
  if (!validToken(token)) { dropToken(); return say('err', 'Odkaz pozvánky je neplatný. Požádej kamarádku o nový.', 'invalid'); }

  say('note', 'Ověřuji pozvánku…', 'loading');
  let fb, inv;
  try { fb = await connect(); inv = await getInvite(token); }
  catch (e) {
    noteDiagErr('pozvánka', e); if (e && e.code === 'bandapp/signed-out') return signedOut();
    // 1.2.3: nepřihlášený prohlížeč/aplikace → žádný samovolný účet; nabídnout obnovu nebo výslovně nový účet.
    if (e && e.code === 'bandapp/no-account') return joinNoAccount(e.knownCode); return fill(root, h('div', { class: 'err', role: 'alert', 'data-state': 'error', text: 'Pozvánku se nepodařilo ověřit. ' + errText(e) }), btn('secondary', '↻ Zkusit znovu', () => location.reload())); }
  // 1.2.2: tento účet už ve skupině je (třeba schválený dřív) → žádná nová žádost, jen obnovit skupinu v zařízení.
  const roomOf = inv ? inv.roomId : null;
  if (roomOf) {
    const mine = await fb.F.getDocFromServer(fb.F.doc(fb.db, 'rooms', roomOf, 'members', fb.uid)).catch(() => null);
    if (mine && mine.exists()) {
      dropToken(); const st = String(mine.data().status || 'member');
      const r = Object.assign({}, local.rooms().find(x => x.id === roomOf) || { id: roomOf, name: '', from: inv.fromNick }, { role: st }); local.saveRoom(r);
      return roomView(r, 'V této skupině už členkou jsi (stejný účet jako dřív) – pozvánku nepotřebuješ. Skupina je zase v BAND APP.');
    }
  }
  if (!inv) { dropToken(); return say('err', 'Pozvánka neexistuje – byla zrušena nebo už vypršela.', 'missing'); }
  if (inv.used) {
    if (inv.usedBy === fb.uid) { const r = local.rooms().find(x => x.id === inv.roomId) || { id: inv.roomId, name: '', role: 'member', from: inv.fromNick }; local.saveRoom(r); return roomView(r); }
    dropToken(); return say('err', 'Tato pozvánka už byla použita. Každá pozvánka platí jen jednou.', 'used');
  }
  const exp = inv.expiresAt && inv.expiresAt.toMillis();
  if (!exp || exp <= Date.now()) { dropToken(); return say('err', 'Pozvánka vypršela. Požádej o novou.', 'expired'); }

  // 1g: jediná obrazovka – přezdívka + „Požádat o přijetí“. Žádné zaškrtávátko, nic dalšího se neukládá.
  const nick = h('input', { type: 'text', id: 'jNick', maxlength: 24, placeholder: 'Tvoje přezdívka', value: local.nick(), autocomplete: 'nickname' });
  const err = h('div', { class: 'err', role: 'alert', hidden: true });
  let asTransfer = false;
  const accept = btn('primary', 'Požádat o přijetí', async () => {
    const n = cleanNick(nick.value);
    if (!n) { err.hidden = false; err.textContent = 'Napiš svou přezdívku.'; return; }
    accept.disabled = true; err.hidden = true;
    try {
      try { await acceptInvite(token, inv.roomId, n); }
      catch (e) { if (!(e && e.code === 'bandapp/already-member')) throw e; dropToken(); const r = { id: inv.roomId, name: '', role: e.status || 'member', from: inv.fromNick }; local.saveRoom(r); return roomView(r, errText(e)); }
      local.setNick(n); const r = { id: inv.roomId, name: '', role: 'pending', from: inv.fromNick }; local.saveRoom(r);
      dropToken();
      roomView(r, asTransfer ? 'Žádost o převod odeslána. Ukaž zakladatelce OSOBNĚ svůj kód účtu ' + (await deviceCode(fb.uid)) + ' – ona u tvého dřívějšího záznamu klepne na „🔁 Převést na nový účet…“ a kód opíše.' : undefined);
    } catch (e) {
      noteDiagErr('pozvánka', e); err.hidden = false; err.textContent = 'Žádost se nepodařilo odeslat. ' + errText(e);
      const final = ['bandapp/invite-used', 'bandapp/invite-missing'].includes(e && e.code);
      accept.disabled = final;
      if (final) dropToken();
    }
  }, { id: 'jAccept' });
  // 1.2.4: stejná žádost, jen s návodem pro převod (pravidla beze změny – převod pak potvrdí zakladatelka osobně kódem).
  const askMove = btn('secondary', '🔁 Mám nový účet – požádat o převod', () => { asTransfer = true; accept.click(); }, { id: 'jTransfer' });
  const myCode = h('p', { class: 'note', id: 'jMyCode', text: 'Kód účtu tohoto telefonu: …' }); deviceCode(fb.uid).then(c => { myCode.textContent = 'Kód účtu tohoto telefonu: ' + c; });
  fill(root, 
    h('h2', { id: 'jTitle', 'data-state': 'invite' }, '✉️ Pozvánka od „', h('span', { text: inv.fromNick || 'kamarádka' }), '“'),
    h('label', { for: 'jNick', text: 'Tvoje přezdívka (ne celé jméno)' }), nick,
    err, h('div', { class: 'row' }, accept),
    h('p', { class: 'note', text: 'Už ve skupině jsi, ale s jiným přihlášením (jiný telefon, Safari, smazaná data)? Napiš STEJNOU přezdívku a klepni na „Požádat o převod“. Zakladatelka pak u tvého dřívějšího záznamu převede členství na tento účet. Nic se nesmaže.' }),
    myCode, h('div', { class: 'row' }, askMove),
    ...privacyLines('Odesláním žádosti přijímáš pravidla skupiny.'));

  async function joinNoAccount(known) {
    const verified = await recoveryVerified();
    const standalone = matchMedia('(display-mode: standalone)').matches;
    const inp = h('input', { type: 'text', id: 'jRestoreCode', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'BAND-XXXX-XXXX-…', 'aria-label': 'Obnovovací kód', hidden: true });
    const e3 = h('div', { class: 'err', role: 'alert', hidden: true });
    const rgo = btn('primary', '♻️ Obnovit účet', async () => {
      e3.hidden = true; if (!parseCode(inp.value)) { e3.hidden = false; e3.textContent = errText({ code: 'bandapp/bad-code' }); return; }
      rgo.disabled = true;
      try { const r = await restoreAccount(inp.value); inp.value = ''; flash(restoreText(r)); location.reload(); } catch (e) { rgo.disabled = false; e3.hidden = false; e3.textContent = errText(e); }
    }, { id: 'jRestoreGo', hidden: true });
    const copy = btn('secondary', '📋 Zkopírovat odkaz pozvánky', async () => { try { await navigator.clipboard.writeText(location.origin + location.pathname + location.search + '#t=' + token); copy.textContent = '✅ Zkopírováno – vlož ho v BAND APP'; } catch (e) { } }, { id: 'jCopyInvite' });
    fill(root, h('h2', { id: 'jTitle', 'data-state': 'invite-no-account' }, '✉️ Pozvánka do BAND APP'),
      standalone ? null : h('div', { class: 'warnbox', 'data-state': 'browser-not-app', text: '📱 Máš BAND APP nainstalovanou na ploše? Pak pozvánku otevři V NÍ, ne tady v prohlížeči – prohlížeč má jiné přihlášení, takže by ti hovory v aplikaci nechodily. Zkopíruj odkaz a v BAND APP ho vlož (VIDEOCHAT nebo Kamarádky → „Otevřít pozvánku tady“).' }),
      standalone || !token ? null : h('div', { class: 'row' }, copy),
      ...noAccountBlock({ known,
        onRestore: verified ? () => { inp.hidden = false; rgo.hidden = false; inp.focus(); } : null,
        onCreate: async () => { await createAccount(); location.reload(); },
        createLabel: known ? '➕ Přesto založit NOVÝ účet' : (standalone ? '➕ Jsem tu poprvé – založit účet a pokračovat' : '➕ Jsem tu poprvé – založit účet v tomto prohlížeči') }),
      inp, h('div', { class: 'row' }, rgo), e3);
  }
  function joinCode(uid) {   // 1.2.2: stejný kód vidí zakladatelka u členky a člen v BAND APP → Diagnostika hovorů
    const el = h('p', { class: 'note', id: 'jDevCode', text: 'Kód účtu: …' });
    deviceCode(uid).then(c => { el.textContent = 'Kód účtu: ' + (c || '–') + (matchMedia('(display-mode: standalone)').matches ? ' (nainstalovaná BAND APP)' : ' (tento prohlížeč)'); }); return el;
  }
  function roomView(r, notice) {
    fill(root, h('p', { class: 'note', text: 'Načítám…' }));
    const noticeEl = () => notice ? h('div', { class: 'note', id: 'jAlready', 'data-state': /^Žádost o převod/.test(notice) ? 'transfer-requested' : 'already-member', text: '✅ ' + notice }) : null;
    // 1.1: „cur“ = vždy POSLEDNÍ stav vlastního záznamu (dřív si chat pamatoval přezdívku z prvního načtení).
    let chatOff = null, roomName = '', cur = null, asP = null;
    const ned = nickEditor(() => (cur && cur.nick) || local.nick(), () => { });
    connect().then(fb => watchMyMember(r.id, my => {
      if (my === undefined) { if (!chatOff) say('note', 'Jsi offline. Kamarádky se připojí, až bude internet.', 'offline'); return; }
      if (!my) { if (chatOff) { chatOff(); chatOff = null; } local.dropRoom(r.id); return say('err', 'V této skupině nejsi (nebo už nejsi) členkou.', 'removed'); }
      if (r.role !== my.status) { r.role = my.status; local.saveRoom({ id: r.id, role: my.status }); }
      if (my.status === 'replaced') { if (chatOff) { chatOff(); chatOff = null; } return say('err', REPLACED_TEXT, 'replaced'); }
      cur = my;
      if (my.status === 'pending') return fill(root, h('h2', { text: '⏳ Čekáš na schválení' }), h('p', { 'data-state': 'pending', text: 'Až tě ' + (r.from || 'zakladatelka skupiny') + ' schválí, otevře se tady chat. Stránku si ulož do záložek.' }),
        h('p', { class: 'note', id: 'jMyNick', text: 'Tvoje přezdívka: ' + (my.nick || 'Kamarádka') }), noticeEl(), joinCode(fb.uid), h('div', { class: 'row' }, ned.button), ned.box);
      if (my.status === 'owner') {
        if (chatOff) { chatOff(); chatOff = null; }
        return fill(root, h('h2', { text: '👑 Jsi zakladatelka skupiny' }),
          h('p', { 'data-state': my.status, text: 'Správu skupiny najdeš v BAND APP v sekci Kamarádky.' }), h('a', { href: 'index.html' + location.search + '#friends', class: 'note', style: 'color:#ffb3ba', text: 'Otevřít BAND APP → Kamarádky' }));
      }
      const asText = () => 'Jsi členkou jako „' + (my.nick || 'Kamarádka') + '“. Stránku si ulož do záložek, ať se sem snadno vrátíš.';
      if (chatOff) { if (asP) asP.textContent = asText(); return; }
      const chat = h('div'), title = h('h2', { id: 'jRoomTitle', text: '💬 ' + (r.name || 'Skupina') });
      asP = h('p', { class: 'note', 'data-state': 'approved', id: 'jMyNick', text: asText() });
      // 1.2.5: cesta zpět do aplikace. Nainstalovaná BAND APP tu po otevření pozvánky zůstávala (hovory se volají
      // z BAND APP → VIDEOCHAT). Příchozí hovory zvoní i tady (stránka teď načítá videochat.js). Žádné automatické přesměrování.
      const openApp = h('div', { class: 'row', style: 'margin:8px 0' }, btn('primary', '📱 Otevřít BAND APP (Kamarádky a VIDEOCHAT)', () => { location.href = 'index.html' + location.search + '#videochat'; }, { id: 'jOpenApp' }));
      const callNote = h('p', { class: 'note', id: 'jCallNote', text: 'Videohovory: volat můžeš v BAND APP → VIDEOCHAT. Příchozí hovor zazvoní i na této stránce, když je otevřená.' });
      fill(root, title, asP, noticeEl(), openApp, callNote, joinCode(fb.uid), h('div', { class: 'row' }, ned.button), ned.box, chat,
        h('div', { class: 'row' },
          btn('secondary', 'Opustit skupinu', async () => { if (!confirm('Opravdu chceš opustit skupinu?')) return; try { await leaveRoom(r.id); } catch (e) { } })));
      chatOff = mountChat(chat, r.id, () => (cur && cur.nick) || my.nick, fb.uid);
      fb.F.getDoc(fb.F.doc(fb.db, 'rooms', r.id)).then(s => { if (s.exists()) { roomName = s.data().name || 'Skupina'; title.textContent = '💬 ' + roomName; local.saveRoom({ id: r.id, name: roomName }); } }).catch(() => { });
    }, async e => { if (e && e.code === 'permission-denied' && !(await checkSession())) return; say('err', errText(e), 'error'); })).catch(e => { if (e && e.code === 'bandapp/signed-out') return signedOut(); if (e && e.code === 'bandapp/no-account') return joinNoAccount(e.knownCode); say('err', errText(e), 'error'); });
  }
}

/* ---------- start ---------- */
function start() {
  const a = document.getElementById('friendsApp'), j = document.getElementById('joinApp');
  try { if (a) initIndex(a).catch(() => { a.textContent = 'Kamarádky se nepodařilo načíst.'; }); if (j) initJoin(j).catch(() => { j.textContent = 'Pozvánku se nepodařilo načíst.'; }); } catch (e) { }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
