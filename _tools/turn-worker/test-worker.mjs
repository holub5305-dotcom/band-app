/* Testy workeru: node test-worker.mjs ./worker.js   (žádná síť – vše je podvržené) */
import assert from 'node:assert/strict';
const W = (await import(new URL(process.argv[2] || './worker.js', import.meta.url))).default;
const { subtle } = globalThis.crypto;
const kp = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pub = { ...(await subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64u = b => Buffer.from(b).toString('base64url');
async function tok(claims, kid = 'k1') {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid })), p = b64u(JSON.stringify(claims));
  const sig = await subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(h + '.' + p));
  return h + '.' + p + '.' + b64u(sig);
}
const PID = 'band-app-test-9fc3e', ORIGIN = 'https://holub5305-dotcom.github.io', now = Math.floor(Date.now() / 1000);
const claims = sub => ({ aud: PID, iss: 'https://securetoken.google.com/' + PID, sub, iat: now - 10, exp: now + 3000 });
// Podvržená Firestore pravidla: list členek povolí jen schválené nezablokované (jako isApproved v firestore.rules).
const approved = { roomOK: new Set(['uidA', 'uidRate']), roomB: new Set([]) };   // uidBlocked je v roomOK zablokovaná → 403
const uidOf = t => JSON.parse(Buffer.from(t.split('.')[1], 'base64url')).sub;
let cfCalls = 0, fsCalls = 0;
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  if (url.includes('jwk/securetoken')) return new Response(JSON.stringify({ keys: [pub] }), { headers: { 'cache-control': 'max-age=100' } });
  if (url.includes('firestore.googleapis.com')) {
    fsCalls++;
    assert.ok(url.startsWith(`https://firestore.googleapis.com/v1/projects/${PID}/`), 'Firestore dotaz jen na nastavený projekt');
    const room = /rooms\/([^/]+)\/members/.exec(url)[1], uid = uidOf(o.headers.Authorization.slice(7));
    return new Response('{}', { status: approved[room] && approved[room].has(uid) ? 200 : 403 });
  }
  if (url.includes('rtc.live.cloudflare.com')) {
    cfCalls++; assert.equal(o.headers.Authorization, 'Bearer CFSECRET'); assert.equal(JSON.parse(o.body).ttl, 14400);
    return new Response(JSON.stringify({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp'], username: 'u', credential: 'c' }] }), { status: 201 });
  }
  throw new Error('neočekávaná síť ' + url);
};
const SECRET_USER = 'ETURN-USER-xyz', SECRET_PW = 'ETURN-PASS-9f8e7d';
const base = { FIREBASE_PROJECT_ID: PID, ALLOWED_ORIGIN: ORIGIN, TTL_SECONDS: '14400' };
const envStatic = { ...base, TURN_USERNAME: SECRET_USER, TURN_PASSWORD: SECRET_PW };
const envNoSecrets = { ...base };
const envCF = { ...base, TURN_MODE: 'cloudflare', TURN_KEY_ID: 'KID', TURN_KEY_API_TOKEN: 'CFSECRET' };
const call = (env, t, { room = 'roomOK', origin = ORIGIN, method = 'GET', path = '/ice' } = {}) =>
  W.fetch(new Request('https://w.example' + path + '?room=' + room, { method, headers: { ...(t ? { Authorization: 'Bearer ' + t } : {}), ...(origin ? { Origin: origin } : {}) } }), env);
let n = 0; const ok = (name, c) => { assert.ok(c, name); n++; console.log('  ✓', name); };
const bodies = [];
const st = async (p, code) => { const r = await p; const txt = await r.text(); bodies.push(txt); return r.status === code && r.headers.get('cache-control') === 'no-store'; };

const good = await tok(claims('uidA'));
console.log('— společné kontroly (režim static) —');
ok('bez tokenu 401', await st(call(envStatic, null), 401));
ok('cizí projekt (produkční token na test worker) 401', await st(call(envStatic, await tok({ ...claims('uidA'), aud: 'band-app-7c9ca', iss: 'https://securetoken.google.com/band-app-7c9ca' })), 401));
ok('cizí iss 401', await st(call(envStatic, await tok({ ...claims('uidA'), iss: 'https://evil.example/' + PID })), 401));
ok('prošlý token 401', await st(call(envStatic, await tok({ ...claims('uidA'), exp: now - 5 })), 401));
ok('token z budoucnosti 401', await st(call(envStatic, await tok({ ...claims('uidA'), iat: now + 3600 })), 401));
ok('neznámý klíč 401', await st(call(envStatic, await tok(claims('uidA'), 'zzz')), 401));
ok('podvržený podpis 401', await st(call(envStatic, good.replace(/.$/, c => c === 'A' ? 'B' : 'A')), 401));
ok('nesmyslný token 401', await st(call(envStatic, 'abc'), 401));
ok('neschválená (čekající) členka 403', await st(call(envStatic, await tok(claims('uidPending'))), 403));
ok('zablokovaná členka 403', await st(call(envStatic, await tok(claims('uidBlocked'))), 403));
ok('cizí skupina 403', await st(call(envStatic, good, { room: 'roomB' }), 403));
ok('neplatné id skupiny 403 (bez dotazu do Firestore)', await (async () => { const b = fsCalls; const r = await st(call(envStatic, good, { room: '..%2Fx' }), 403); return r && fsCalls === b; })());
ok('cizí Origin 403', await st(call(envStatic, good, { origin: 'https://evil.example' }), 403));
ok('POST 405', await st(call(envStatic, good, { method: 'POST' }), 405));
ok('OPTIONS 204 + CORS jen pro BAND APP', (await call(envStatic, null, { method: 'OPTIONS' })).headers.get('Access-Control-Allow-Origin') === ORIGIN);
ok('chybí FIREBASE_PROJECT_ID → 500, nic nevydá', await st(call({ ...envStatic, FIREBASE_PROJECT_ID: '' }, good), 500));

console.log('— režim static (ExpressTURN) —');
let r = await call(envStatic, good); let txt = await r.text(); let j = JSON.parse(txt);
ok('schválená členka 200 + no-store', r.status === 200 && r.headers.get('cache-control') === 'no-store');
ok('STUN Cloudflare + 2 TURN adresy ExpressTURN s údaji', JSON.stringify(j.iceServers) === JSON.stringify([
  { urls: ['stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:free.expressturn.com:3478?transport=udp', 'turn:free.expressturn.com:3478?transport=tcp'], username: SECRET_USER, credential: SECRET_PW }]));
ok('mode static, ttl 14400', j.mode === 'static' && j.ttl === 14400);
r = await call({ ...envStatic, TURN_URLS: 'turns:relay.example:443?transport=tcp, javascript:alert(1) ,turn:x.example:3478' }, good); j = await r.json();
ok('TURN_URLS: neplatné adresy vyřazeny', JSON.stringify(j.iceServers[1].urls) === JSON.stringify(['turns:relay.example:443?transport=tcp', 'turn:x.example:3478']));
r = await call(envNoSecrets, good); txt = await r.text(); bodies.push(txt);
ok('bez tajemství → 503 not_configured (srozumitelně)', r.status === 503 && JSON.parse(txt).error === 'not_configured');
ok('bez tajemství, nepřihlášená → 401 (stav se neprozradí bez přihlášení kromě /health)', await st(call(envNoSecrets, null), 401));
r = await call(envNoSecrets, null, { path: '/health' }); j = await r.json();
ok('/health: configured=false, bez údajů', r.status === 200 && j.configured === false && j.mode === 'static');
r = await call(envStatic, null, { path: '/health' }); txt = await r.text();
ok('/health s tajemstvím: configured=true a NEobsahuje jméno ani heslo', JSON.parse(txt).configured === true && !txt.includes(SECRET_USER) && !txt.includes(SECRET_PW));
ok('Cloudflare Realtime se v režimu static nevolá', cfCalls === 0);

console.log('— limit žádostí —');
const rateTok = await tok(claims('uidRate')); const envRate = { ...envStatic, RATE_PER_10MIN: '3' };
const codes = []; for (let i = 0; i < 5; i++) codes.push((await call(envRate, rateTok)).status);
ok('4. a 5. žádost téhož uid → 429', JSON.stringify(codes) === JSON.stringify([200, 200, 200, 429, 429]));
let rlKey = null; const envRL = { ...envStatic, RL: { limit: async ({ key }) => { rlKey = key; return { success: false }; } } };
ok('vazba RL (Workers Rate Limiting) použita, klíč = uid', await st(call(envRL, good), 429) && rlKey === 'u:uidA');

console.log('— režim cloudflare (vypnutý, jen kód) —');
r = await call(envCF, good); j = await r.json();
ok('Cloudflare: 200, port 53 vyřazen', r.status === 200 && JSON.stringify(j.iceServers) === JSON.stringify([{ urls: ['stun:stun.cloudflare.com:3478'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }]));
ok('Cloudflare bez klíčů → 503', await st(call({ ...base, TURN_MODE: 'cloudflare' }, good), 503));
ok('Cloudflare se nevolá pro odmítnuté', await (async () => { const b = cfCalls; await call(envCF, await tok(claims('uidBlocked'))); await call(envCF, null); return cfCalls === b; })());

console.log('— tajemství nikdy v chybách —');
const leak = bodies.filter(b => b.includes(SECRET_USER) || b.includes(SECRET_PW) || b.includes('CFSECRET') || b.includes(good.slice(20, 60)));
ok(`žádná z ${bodies.length} chybových odpovědí neobsahuje jméno/heslo/token`, leak.length === 0);
const src = (await import('node:fs')).readFileSync(new URL(process.argv[2] || './worker.js', import.meta.url), 'utf8');
ok('worker nic neloguje (žádné console.*)', !/console\./.test(src));
console.log(`worker: ${n}/${n} OK`);
