// BAND APP 1.2.0 – KOMPATIBILITA s produkcí 1.1.3: stejná data jako v produkci (skupina Kamarádky, členky všech stavů,
// zprávy, pozvánky, users/{uid}/private/state) a stejné operace jako friends.js 1.1.3. Každá operace se spustí
// proti pravidlům z main (produkce 1.1.3) i z větve 1.2.0 a výsledek (povoleno/zamítnuto) musí být IDENTICKÝ.
// Spuštění: RULES_MAIN=<main firestore.rules> RULES_BRANCH=<firestore.rules větve> npx mocha prod-compat.test.mjs (emulátor 8080)
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, collectionGroup, writeBatch, serverTimestamp, Timestamp, query, where, orderBy, limit, arrayUnion } from 'firebase/firestore';

const R = { main: readFileSync(process.env.RULES_MAIN, 'utf8'), branch: readFileSync(process.env.RULES_BRANCH, 'utf8') };
const ROOM = 'kamaradky', ROOM2 = 'cizi', H = 3600e3, D = 24 * H;
const T_OK = 'AAAAAAAAAAAAAAAAAAAAAA', T_USED = 'CCCCCCCCCCCCCCCCCCCCCC', T_NEW = 'NNNNNNNNNNNNNNNNNNNNNN';
const envs = {};

async function seed(env) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const fs = ctx.firestore(), now = Date.now(), ts = ms => Timestamp.fromMillis(ms);
    await setDoc(doc(fs, `rooms/${ROOM}`), { ownerUid: 'laura', name: 'Kamarádky', createdAt: ts(now - 20 * D), blocked: ['bad'] });
    const mem = (uid, nick, status, extra = {}) => setDoc(doc(fs, `rooms/${ROOM}/members/${uid}`), { uid, nick, status, joinedAt: ts(now - 10 * D), ...extra });
    await mem('laura', 'Laurinka', 'owner');
    await mem('amy', 'Amy', 'approved', { invite: T_USED, approvedAt: ts(now - 9 * D) });
    await mem('ema', 'Ema', 'approved', { invite: 'EEEEEEEEEEEEEEEEEEEEEE', approvedAt: ts(now - 9 * D) });
    await mem('pend', 'Nová', 'pending', { invite: 'PPPPPPPPPPPPPPPPPPPPPP' });
    await mem('bad', 'Zablokovaná', 'approved');
    await setDoc(doc(fs, `rooms/${ROOM}/messages/m1`), { uid: 'amy', nick: 'Amy', text: 'ahoj holky 🎸', createdAt: ts(now - 60e3) });
    await setDoc(doc(fs, `rooms/${ROOM}/messages/m2`), { uid: 'laura', nick: 'Laurinka', text: 'zkouška v 5', createdAt: ts(now - 30e3) });
    await setDoc(doc(fs, `rooms/${ROOM}/messages/mOld`), { uid: 'amy', nick: 'Amy', text: 'stará', createdAt: ts(now - 31 * D) });
    await setDoc(doc(fs, `rooms/${ROOM2}`), { ownerUid: 'out', name: 'Cizí kapela', createdAt: ts(now), blocked: [] });
    await setDoc(doc(fs, `rooms/${ROOM2}/members/out`), { uid: 'out', nick: 'Cizí', status: 'owner', joinedAt: ts(now) });
    await setDoc(doc(fs, `invites/${T_OK}`), { roomId: ROOM, createdBy: 'laura', createdAt: ts(now), expiresAt: ts(now + 23 * H), used: false, fromNick: 'Laurinka' });
    await setDoc(doc(fs, `invites/${T_USED}`), { roomId: ROOM, createdBy: 'laura', createdAt: ts(now - D), expiresAt: ts(now + H), used: true, usedBy: 'amy' });
    await setDoc(doc(fs, `users/amy/private/state`), { rooms: [ROOM], nick: 'Amy', favorites: ['Em', 'G'], blockedNames: {}, updatedAt: ts(now) });
  });
}
const fsOf = (env, who) => who === 'anon' ? env.unauthenticatedContext().firestore() : env.authenticatedContext(who).firestore();
const state = (nick = 'Amy') => ({ rooms: [ROOM], nick, favorites: ['Em'], blockedNames: {}, updatedAt: serverTimestamp() });
const msg = (uid, nick, text = 'nová zpráva') => ({ uid, nick, text, createdAt: serverTimestamp() });
const recent = fs => query(collection(fs, `rooms/${ROOM}/messages`), where('createdAt', '>', Timestamp.fromMillis(Date.now() - 30 * D + 10 * 60e3)), orderBy('createdAt', 'desc'), limit(150));

const ACTORS = ['laura', 'amy', 'pend', 'bad', 'out', 'newbie', 'anon'];
const OPS = {
  'rooms get Kamarádky': fs => getDoc(doc(fs, `rooms/${ROOM}`)),
  'rooms list': fs => getDocs(collection(fs, 'rooms')),
  'rooms create (nová skupina + zakladatelka)': (fs, me) => { const b = writeBatch(fs); b.set(doc(fs, 'rooms/nova'), { ownerUid: me, name: 'Nová', createdAt: serverTimestamp(), blocked: [] }); b.set(doc(fs, `rooms/nova/members/${me}`), { uid: me, nick: 'Já', status: 'owner', joinedAt: serverTimestamp() }); return b.commit(); },
  'rooms rename': fs => updateDoc(doc(fs, `rooms/${ROOM}`), { name: 'Kamarádky 2' }),
  'rooms block amy': fs => updateDoc(doc(fs, `rooms/${ROOM}`), { blocked: arrayUnion('amy') }),
  'rooms transfer to amy': (fs, me) => { const b = writeBatch(fs); b.update(doc(fs, `rooms/${ROOM}`), { ownerUid: 'amy' }); b.update(doc(fs, `rooms/${ROOM}/members/amy`), { status: 'owner' }); b.update(doc(fs, `rooms/${ROOM}/members/${me}`), { status: 'approved' }); return b.commit(); },
  'rooms delete': fs => deleteDoc(doc(fs, `rooms/${ROOM}`)),
  'members get own': (fs, me) => getDoc(doc(fs, `rooms/${ROOM}/members/${me}`)),
  'members get amy': fs => getDoc(doc(fs, `rooms/${ROOM}/members/amy`)),
  'members list': fs => getDocs(collection(fs, `rooms/${ROOM}/members`)),
  'members collectionGroup own (obnova skupin)': (fs, me) => getDocs(query(collectionGroup(fs, 'members'), where('uid', '==', me))),
  'members change own nick': (fs, me) => updateDoc(doc(fs, `rooms/${ROOM}/members/${me}`), { nick: 'Nová přezdívka' }),
  'members approve pend': fs => updateDoc(doc(fs, `rooms/${ROOM}/members/pend`), { status: 'approved', approvedAt: serverTimestamp() }),
  'members remove amy': fs => deleteDoc(doc(fs, `rooms/${ROOM}/members/amy`)),
  'members leave (delete own)': (fs, me) => deleteDoc(doc(fs, `rooms/${ROOM}/members/${me}`)),
  'members join via invite': (fs, me) => { const b = writeBatch(fs); b.set(doc(fs, `rooms/${ROOM}/members/${me}`), { uid: me, nick: 'Nováček', status: 'pending', joinedAt: serverTimestamp(), invite: T_OK }); b.update(doc(fs, `invites/${T_OK}`), { used: true, usedBy: me, usedAt: serverTimestamp() }); return b.commit(); },
  'members self-approve': (fs, me) => updateDoc(doc(fs, `rooms/${ROOM}/members/${me}`), { status: 'approved' }),
  'messages recent query (30 dní)': fs => getDocs(recent(fs)),
  'messages get m1': fs => getDoc(doc(fs, `rooms/${ROOM}/messages/m1`)),
  'messages get 31 dní stará': fs => getDoc(doc(fs, `rooms/${ROOM}/messages/mOld`)),
  'messages send (správná přezdívka)': async (fs, me) => { const nick = { laura: 'Laurinka', amy: 'Amy', pend: 'Nová', bad: 'Zablokovaná' }[me] || 'X'; return setDoc(doc(fs, `rooms/${ROOM}/messages/n-${me}`), msg(me, nick)); },
  'messages send (cizí přezdívka)': (fs, me) => setDoc(doc(fs, `rooms/${ROOM}/messages/f-${me}`), msg(me, 'Laurinka')),
  'messages send 1001 znaků': (fs, me) => setDoc(doc(fs, `rooms/${ROOM}/messages/l-${me}`), msg(me, 'Amy', 'x'.repeat(1001))),
  'messages edit m1': fs => updateDoc(doc(fs, `rooms/${ROOM}/messages/m1`), { text: 'upraveno' }),
  'messages delete m1 (Amy)': fs => deleteDoc(doc(fs, `rooms/${ROOM}/messages/m1`)),
  'messages delete m2 (Laurinka)': fs => deleteDoc(doc(fs, `rooms/${ROOM}/messages/m2`)),
  'invites get': fs => getDoc(doc(fs, `invites/${T_OK}`)),
  'invites list (zakladatelka)': fs => getDocs(query(collection(fs, 'invites'), where('roomId', '==', ROOM))),
  'invites create': (fs, me) => setDoc(doc(fs, `invites/${T_NEW}`), { roomId: ROOM, createdBy: me, createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 23 * H), used: false, fromNick: 'Laurinka' }),
  'invites delete': fs => deleteDoc(doc(fs, `invites/${T_OK}`)),
  'users/private get own': (fs, me) => getDoc(doc(fs, `users/${me}/private/state`)),
  'users/private get amy': fs => getDoc(doc(fs, `users/amy/private/state`)),
  'users/private set own': (fs, me) => setDoc(doc(fs, `users/${me}/private/state`), state()),
  'users/private set extra key': (fs, me) => setDoc(doc(fs, `users/${me}/private/state`), { ...state(), x: 1 }),
  'users/private delete own': (fs, me) => deleteDoc(doc(fs, `users/${me}/private/state`)),
  'users root read': (fs, me) => getDoc(doc(fs, `users/${me}`)),
  'cizí skupina get': fs => getDoc(doc(fs, `rooms/${ROOM2}`)),
  'cizí skupina messages': fs => getDocs(collection(fs, `rooms/${ROOM2}/messages`)),
};

async function outcome(env, who, op) {
  await seed(env);
  try { await OPS[op](fsOf(env, who), who); return 'ALLOW'; }
  catch (e) { if (/permission|PERMISSION_DENIED/i.test(String(e && (e.code || e.message)))) return 'DENY'; return 'ERROR:' + (e.code || e.message); }
}

describe('Produkční data 1.1.3: pravidla main vs. 1.2.0 musí rozhodnout STEJNĚ', function () {
  this.timeout(600e3);
  const res = { main: {}, branch: {} };
  before(async () => {
    envs.main = await initializeTestEnvironment({ projectId: 'demo-compat-main', firestore: { rules: R.main, host: '127.0.0.1', port: 8080 } });
    envs.branch = await initializeTestEnvironment({ projectId: 'demo-compat-branch', firestore: { rules: R.branch, host: '127.0.0.1', port: 8080 } });
    for (const op of Object.keys(OPS)) for (const who of ACTORS) for (const k of ['main', 'branch']) res[k][op + ' | ' + who] = await outcome(envs[k], who, op);
  });
  after(async () => { await envs.main.cleanup(); await envs.branch.cleanup(); });
  for (const op of Object.keys(OPS)) it(op + ' – stejné pro ' + ACTORS.join('/'), () => {
    for (const who of ACTORS) assert.equal(res.branch[op + ' | ' + who], res.main[op + ' | ' + who], `${op} | ${who}`);
  });
  it('kontrola smysluplnosti: schválená čte a píše, zablokovaná/cizí/nepřihlášená ne', () => {
    const b = res.branch;
    assert.equal(b['messages recent query (30 dní) | amy'], 'ALLOW');
    assert.equal(b['messages send (správná přezdívka) | amy'], 'ALLOW');
    assert.equal(b['members change own nick | amy'], 'ALLOW');
    assert.equal(b['members approve pend | laura'], 'ALLOW');
    assert.equal(b['users/private set own | amy'], 'ALLOW');
    assert.equal(b['rooms create (nová skupina + zakladatelka) | newbie'], 'ALLOW');
    assert.equal(b['members join via invite | newbie'], 'ALLOW');
    for (const w of ['bad', 'out', 'anon', 'pend']) assert.equal(b['messages recent query (30 dní) | ' + w], 'DENY', w);
    assert.equal(b['messages get 31 dní stará | amy'], 'DENY');
    const n = Object.keys(b).length, allow = Object.values(b).filter(v => v === 'ALLOW').length;
    assert.ok(!Object.values(b).some(v => v.startsWith('ERROR')) && !Object.values(res.main).some(v => v.startsWith('ERROR')));
    console.log(`      ${n} kombinací (operace × uživatelka), povoleno ${allow}, zamítnuto ${n - allow} – v main i 1.2.0 identicky`);
  });
});
