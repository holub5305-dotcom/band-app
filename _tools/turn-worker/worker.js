/* BAND APP – volitelná služba krátkodobých TURN údajů (Cloudflare Worker, bezplatný tarif).
 *
 * Co dělá: přihlášená SCHVÁLENÁ členka skupiny (ověřeno Firebase ID tokenem + pravidly Firestore)
 * dostane JSON { iceServers: [...] } s TURN údaji Cloudflare Realtime platnými jen TTL_SECONDS.
 * Nic neukládá, nic neloguje, žádné cookies, žádné sledování. Obraz/zvuk přes tuto službu NEJDE –
 * jen vydá dočasné heslo; média jdou šifrovaně (DTLS-SRTP) přes turn.cloudflare.com.
 *
 * Tajemství (nastavují se jen v Cloudflare, NIKDY do repozitáře):
 *   TURN_KEY_ID         – ID TURN klíče (Cloudflare → Realtime → TURN Server)
 *   TURN_KEY_API_TOKEN  – API token téhož TURN klíče
 * Proměnné (wrangler.toml [vars]):
 *   FIREBASE_PROJECT_ID – band-app-7c9ca (produkce) nebo band-app-test-9fc3e (test)
 *   ALLOWED_ORIGIN      – https://holub5305-dotcom.github.io
 *   TTL_SECONDS         – 14400 (4 h; hovor trvá nejvýš 3 h)
 */
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwksCache = { keys: null, until: 0 };

const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const json = (body, status, origin) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(origin) }
});
const cors = origin => ({
  'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization', 'Access-Control-Max-Age': '600', 'Vary': 'Origin'
});

async function googleKeys() {
  if (jwksCache.keys && jwksCache.until > Date.now()) return jwksCache.keys;
  const r = await fetch(JWKS_URL); if (!r.ok) throw new Error('jwks');
  const ma = /max-age=(\d+)/.exec(r.headers.get('cache-control') || ''), j = await r.json();
  jwksCache = { keys: j.keys || [], until: Date.now() + (ma ? +ma[1] : 3600) * 1000 };
  return jwksCache.keys;
}

/* Ověření Firebase ID tokenu (RS256) podle https://firebase.google.com/docs/auth/admin/verify-id-tokens */
async function verifyIdToken(token, projectId) {
  const parts = token.split('.'); if (parts.length !== 3) throw new Error('token');
  const head = JSON.parse(new TextDecoder().decode(b64u(parts[0])));
  const p = JSON.parse(new TextDecoder().decode(b64u(parts[1])));
  if (head.alg !== 'RS256' || !head.kid) throw new Error('alg');
  const jwk = (await googleKeys()).find(k => k.kid === head.kid); if (!jwk) throw new Error('kid');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  const now = Math.floor(Date.now() / 1000);
  if (!ok || p.aud !== projectId || p.iss !== 'https://securetoken.google.com/' + projectId
    || !(p.exp > now) || !(p.iat <= now + 60) || !p.sub || typeof p.sub !== 'string') throw new Error('claims');
  return p.sub;
}

/* Je to schválená (nezablokovaná) členka skupiny? Zeptáme se přímo Firestore S TOKENEM UŽIVATELKY:
 * pravidla povolí „list“ členek jen schváleným členkám (isApproved). Worker tak nepotřebuje žádný servisní účet. */
async function isApprovedMember(token, projectId, room) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(room)) return false;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/rooms/${room}/members?pageSize=1&mask.fieldPaths=status`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  return r.ok;
}

export default {
  async fetch(req, env) {
    const origin = env.ALLOWED_ORIGIN || 'https://holub5305-dotcom.github.io';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (req.method !== 'GET') return json({ error: 'method' }, 405, origin);
    const reqOrigin = req.headers.get('Origin');
    if (reqOrigin && reqOrigin !== origin) return json({ error: 'origin' }, 403, origin);
    const m = /^Bearer (.+)$/.exec(req.headers.get('Authorization') || '');
    if (!m) return json({ error: 'auth' }, 401, origin);
    const projectId = env.FIREBASE_PROJECT_ID;
    try { await verifyIdToken(m[1], projectId); } catch (e) { return json({ error: 'auth' }, 401, origin); }
    const room = new URL(req.url).searchParams.get('room') || '';
    if (!(await isApprovedMember(m[1], projectId, room))) return json({ error: 'member' }, 403, origin);

    const ttl = Math.min(Math.max(parseInt(env.TTL_SECONDS || '14400', 10) || 14400, 600), 172800);
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + env.TURN_KEY_API_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl })
    });
    if (!r.ok) return json({ error: 'turn' }, 502, origin);
    const j = await r.json();
    // Bez „trickle ICE“ (BAND APP sbírá kandidáty max. 3 s) vyřadíme port 53 – prohlížeče ho blokují a jen by se čekalo.
    const iceServers = (j.iceServers || []).map(s => ({ ...s, urls: [].concat(s.urls || []).filter(u => !/:53(\?|$)/.test(u)) }))
      .filter(s => s.urls.length);
    return json({ iceServers, ttl }, 200, origin);
  }
};
