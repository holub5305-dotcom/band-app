/* BAND APP – služba TURN údajů (Cloudflare Worker, bezplatný tarif Workers Free).
 *
 * Co dělá: přihlášená SCHVÁLENÁ a NEZABLOKOVANÁ členka skupiny (ověřeno Firebase ID tokenem
 * + pravidly Firestore s jejím vlastním tokenem) dostane JSON { iceServers: [...] }.
 * Nic neukládá, nic neloguje (žádný výpis do logu), žádné cookies. Obraz/zvuk přes tuto službu NEJDE –
 * jen vydá přístup k TURN; média jdou šifrovaně (DTLS-SRTP) přes TURN server.
 *
 * Režimy (proměnná TURN_MODE):
 *   'static'     (výchozí) – ExpressTURN Free apod.: pevné jméno/heslo uložené JEN jako tajemství Workeru
 *                  TURN_USERNAME, TURN_PASSWORD (Cloudflare → Workers & Pages → worker → Settings →
 *                  Variables and Secrets → typ Secret). NIKDY do repozitáře ani do aplikace.
 *                  TURN_URLS (proměnná) = seznam turn: adres oddělených čárkou.
 *   'cloudflare' (vypnuto) – Cloudflare Realtime TURN (krátkodobé údaje); tajemství TURN_KEY_ID,
 *                  TURN_KEY_API_TOKEN. Vyžaduje platební metodu u Cloudflare – NEPOUŽÍVAT bez souhlasu.
 * Další proměnné:
 *   FIREBASE_PROJECT_ID – band-app-test-9fc3e (testovací worker) / band-app-7c9ca (produkční, později)
 *   ALLOWED_ORIGIN      – https://holub5305-dotcom.github.io
 *   TTL_SECONDS         – jak dlouho si aplikace smí údaje držet (výchozí 14400 = 4 h)
 *   RATE_PER_10MIN      – max. žádostí na uid za 10 min (výchozí 30)
 * Volitelná vazba RL (Workers Rate Limiting); bez ní platí orientační limit v paměti instance.
 */
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const DEFAULT_TURN_URLS = 'turn:free.expressturn.com:3478?transport=udp,turn:free.expressturn.com:3478?transport=tcp';
const STUN = { urls: ['stun:stun.cloudflare.com:3478'] };
let jwksCache = { keys: null, until: 0 };
const rlMem = new Map();

const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const cors = origin => ({
  'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization', 'Access-Control-Max-Age': '600', 'Vary': 'Origin'
});
const json = (body, status, origin, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...cors(origin), ...extra }
});
/* Chyby jsou pevné kódy + česká věta. Nikdy neobsahují token, jméno ani heslo. */
const ERR = {
  method: 'Nepovolená metoda.', origin: 'Nepovolený původ požadavku.', auth: 'Nepřihlášeno nebo neplatné přihlášení.',
  member: 'Nejsi schválená členka této skupiny.', rate: 'Příliš mnoho žádostí, zkus to za chvíli.',
  not_configured: 'TURN není nastaven (chybí tajemství TURN_USERNAME / TURN_PASSWORD).',
  turn_upstream: 'Služba TURN neodpověděla.', config: 'Chybné nastavení workeru.'
};
const fail = (code, status, origin, extra) => json({ error: code, message: ERR[code] }, status, origin, extra);

async function googleKeys() {
  if (jwksCache.keys && jwksCache.until > Date.now()) return jwksCache.keys;
  const r = await fetch(JWKS_URL); if (!r.ok) throw new Error('jwks');
  const ma = /max-age=(\d+)/.exec(r.headers.get('cache-control') || ''), j = await r.json();
  jwksCache = { keys: j.keys || [], until: Date.now() + Math.min(ma ? +ma[1] : 3600, 21600) * 1000 };
  return jwksCache.keys;
}

/* Ověření Firebase ID tokenu (RS256) podle https://firebase.google.com/docs/auth/admin/verify-id-tokens */
async function verifyIdToken(token, projectId) {
  if (!projectId || token.length > 4096) throw new Error('cfg');
  const parts = token.split('.'); if (parts.length !== 3) throw new Error('token');
  const head = JSON.parse(new TextDecoder().decode(b64u(parts[0])));
  const p = JSON.parse(new TextDecoder().decode(b64u(parts[1])));
  if (head.alg !== 'RS256' || !head.kid) throw new Error('alg');
  const jwk = (await googleKeys()).find(k => k.kid === head.kid); if (!jwk) throw new Error('kid');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  const now = Math.floor(Date.now() / 1000);
  if (!ok || p.aud !== projectId || p.iss !== 'https://securetoken.google.com/' + projectId
    || !(p.exp > now) || !(p.iat <= now + 60) || !(p.auth_time === undefined || p.auth_time <= now + 60)
    || !p.sub || typeof p.sub !== 'string' || p.sub.length > 128) throw new Error('claims');
  return p.sub;
}

/* Schválená a nezablokovaná členka? Zeptáme se Firestore S TOKENEM UŽIVATELKY: pravidla povolí „list“
 * členek jen když isApproved(roomId) = status owner/approved A uid není v rooms/{room}.blocked.
 * Worker tak nepotřebuje žádný servisní účet ani tajný klíč Firebase. */
async function isApprovedMember(token, projectId, room) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(room)) return false;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/rooms/${room}/members?pageSize=1&mask.fieldPaths=status`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  return r.status === 200;
}

async function allowRate(env, uid) {
  const limit = Math.max(parseInt(env.RATE_PER_10MIN || '30', 10) || 30, 1);
  if (env.RL && typeof env.RL.limit === 'function') {
    try { const { success } = await env.RL.limit({ key: 'u:' + uid }); return success; } catch (e) { /* padá na paměť */ }
  }
  const now = Date.now(), win = 600000, e = rlMem.get(uid);
  if (rlMem.size > 5000) rlMem.clear();
  if (!e || now - e.t > win) { rlMem.set(uid, { t: now, n: 1 }); return true; }
  e.n++; return e.n <= limit;
}

function staticIceServers(env) {
  const u = env.TURN_USERNAME, c = env.TURN_PASSWORD;
  if (!u || !c) return null;
  const urls = String(env.TURN_URLS || DEFAULT_TURN_URLS).split(',').map(s => s.trim())
    .filter(s => /^turns?:[A-Za-z0-9.-]+(:\d{1,5})?(\?transport=(udp|tcp))?$/.test(s));
  if (!urls.length) return [];
  return [STUN, { urls, username: String(u), credential: String(c) }];
}

async function cloudflareIceServers(env, ttl) {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return null;
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.TURN_KEY_API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl })
  });
  if (!r.ok) throw new Error('upstream');
  const j = await r.json();
  // Bez „trickle ICE“ vyřadíme port 53 – prohlížeče ho blokují a jen by se čekalo.
  return (j.iceServers || []).map(s => ({ ...s, urls: [].concat(s.urls || []).filter(u => !/:53(\?|$)/.test(u)) }))
    .filter(s => s.urls.length);
}

const mode = env => (env.TURN_MODE || 'static').toLowerCase();
const configured = env => mode(env) === 'cloudflare' ? !!(env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) : !!(env.TURN_USERNAME && env.TURN_PASSWORD);

export default {
  async fetch(req, env) {
    const origin = env.ALLOWED_ORIGIN || 'https://holub5305-dotcom.github.io';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors(origin), 'cache-control': 'no-store' } });
    if (req.method !== 'GET') return fail('method', 405, origin);
    const reqOrigin = req.headers.get('Origin');
    if (reqOrigin && reqOrigin !== origin) return fail('origin', 403, origin);
    const path = new URL(req.url).pathname;
    // Stav bez přihlášení: jen zda je TURN nastaven (žádné údaje, žádná jména).
    if (path === '/health') return json({ ok: true, service: 'bandapp-turn', mode: mode(env), configured: configured(env), project: env.FIREBASE_PROJECT_ID || null }, 200, origin);

    const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(req.headers.get('Authorization') || '');
    if (!m) return fail('auth', 401, origin);
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) return fail('config', 500, origin);
    let uid;
    try { uid = await verifyIdToken(m[1], projectId); } catch (e) { return fail('auth', 401, origin); }
    if (!(await allowRate(env, uid))) return fail('rate', 429, origin, { 'retry-after': '600' });
    const room = new URL(req.url).searchParams.get('room') || '';
    let member = false;
    try { member = await isApprovedMember(m[1], projectId, room); } catch (e) { member = false; }
    if (!member) return fail('member', 403, origin);

    const ttl = Math.min(Math.max(parseInt(env.TTL_SECONDS || '14400', 10) || 14400, 600), 172800);
    let iceServers;
    try {
      iceServers = mode(env) === 'cloudflare' ? await cloudflareIceServers(env, ttl) : staticIceServers(env);
    } catch (e) { return fail('turn_upstream', 502, origin); }
    if (!iceServers) return fail('not_configured', 503, origin);
    if (!iceServers.length) return fail('config', 500, origin);
    return json({ iceServers, ttl, mode: mode(env) }, 200, origin);
  }
};
