import assert from 'node:assert/strict';
const W = (await import(process.argv[2])).default;
const { subtle } = globalThis.crypto;
const kp = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pub = { ...(await subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64u = b => Buffer.from(b).toString('base64url');
async function tok(claims, kid = 'k1') {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid })), p = b64u(JSON.stringify(claims));
  const sig = await subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(h + '.' + p));
  return h + '.' + p + '.' + b64u(sig);
}
const PID = 'band-app-test-9fc3e', now = Math.floor(Date.now() / 1000);
const good = { aud: PID, iss: 'https://securetoken.google.com/' + PID, sub: 'uidA', iat: now - 10, exp: now + 3000 };
let approved = new Set(['roomOK']), cfCalls = 0;
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  if (url.includes('jwk/securetoken')) return new Response(JSON.stringify({ keys: [pub] }), { headers: { 'cache-control': 'max-age=100' } });
  if (url.includes('firestore.googleapis.com')) { const room = /rooms\/([^/]+)\/members/.exec(url)[1]; return new Response('{}', { status: approved.has(room) ? 200 : 403 }); }
  if (url.includes('rtc.live.cloudflare.com')) { cfCalls++; assert.equal(o.headers.Authorization, 'Bearer SECRET'); assert.equal(JSON.parse(o.body).ttl, 14400);
    return new Response(JSON.stringify({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp'], username: 'u', credential: 'c' }] }), { status: 201 }); }
  throw new Error('unexpected ' + url);
};
const env = { TURN_KEY_ID: 'KID', TURN_KEY_API_TOKEN: 'SECRET', FIREBASE_PROJECT_ID: PID, ALLOWED_ORIGIN: 'https://holub5305-dotcom.github.io', TTL_SECONDS: '14400' };
const call = (t, room = 'roomOK', origin = 'https://holub5305-dotcom.github.io', method = 'GET') =>
  W.fetch(new Request('https://w.example/ice?room=' + room, { method, headers: { ...(t ? { Authorization: 'Bearer ' + t } : {}), Origin: origin } }), env);
let n = 0; const ok = (name, c) => { assert.ok(c, name); n++; console.log('  ✓', name); };
ok('bez tokenu 401', (await call(null)).status === 401);
ok('cizí projekt 401', (await call(await tok({ ...good, aud: 'band-app-7c9ca', iss: 'https://securetoken.google.com/band-app-7c9ca' }))).status === 401);
ok('prošlý token 401', (await call(await tok({ ...good, exp: now - 5 }))).status === 401);
ok('neznámý klíč 401', (await call(await tok(good, 'zzz'))).status === 401);
ok('podvržený podpis 401', (await call((await tok(good)).replace(/.$/, c => c === 'A' ? 'B' : 'A'))).status === 401);
ok('neschválená / cizí skupina 403', (await call(await tok(good), 'roomNO')).status === 403);
ok('neplatné id skupiny 403', (await call(await tok(good), '../x')).status === 403);
ok('cizí Origin 403', (await call(await tok(good), 'roomOK', 'https://evil.example')).status === 403);
ok('OPTIONS 204 + CORS', (await call(null, 'x', undefined, 'OPTIONS')).headers.get('Access-Control-Allow-Origin') === env.ALLOWED_ORIGIN);
ok('Cloudflare nevolán u odmítnutých', cfCalls === 0);
const r = await call(await tok(good)); const j = await r.json();
ok('schválená členka 200', r.status === 200);
ok('port 53 vyřazen, TURN údaje předány', JSON.stringify(j.iceServers) === JSON.stringify([{ urls: ['stun:stun.cloudflare.com:3478'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }]));
ok('no-store', r.headers.get('cache-control') === 'no-store');
console.log(`worker: ${n}/${n} OK`);
