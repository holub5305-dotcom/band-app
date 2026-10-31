// BAND APP 1.2.0 – testy pravidel VIDEOCHATU (Firestore emulator + @firebase/rules-unit-testing). Jen emulátor, žádný skutečný projekt.
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, serverTimestamp, Timestamp } from 'firebase/firestore';
const RULES = readFileSync(process.env.RULES || new URL('../firestore.rules', import.meta.url), 'utf8');
let env; const R = 'roomA', R2 = 'roomB', H = 3600e3;
const db = uid => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const NICK = { owner: 'Laurinka', amy: 'Amy', zoe: 'Zoe', eva: 'Eva', pend: 'Pending', bad: 'Bad', out: 'Cizí' };
const callData = (by, parts, extra = {}) => ({ createdBy: by, nick: NICK[by], kind: 'video', mode: parts.length === 2 ? 'direct' : 'group', participants: parts, status: 'ringing', createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 2 * H), ...extra });
const peer = (uid, extra = {}) => ({ uid, nick: NICK[uid], state: 'joined', cam: true, mic: true, epoch: 'e1', at: serverTimestamp(), ...extra });
const sig = (from, to, extra = {}) => ({ from, to, type: 'offer', sid: 's1', sdp: 'v=0', createdAt: serverTimestamp(), ...extra });
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-bandapp-calls', firestore: { rules: RULES, host: '127.0.0.1', port: 8080 } }); });
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const fs = ctx.firestore(), now = Timestamp.now();
    await setDoc(doc(fs, `rooms/${R}`), { ownerUid: 'owner', name: 'Kapela', createdAt: now, blocked: ['bad'] });
    for (const [u, st] of [['owner', 'owner'], ['amy', 'approved'], ['zoe', 'approved'], ['eva', 'approved'], ['pend', 'pending'], ['bad', 'approved']])
      await setDoc(doc(fs, `rooms/${R}/members/${u}`), { uid: u, nick: NICK[u], status: st, joinedAt: now });
    await setDoc(doc(fs, `rooms/${R2}`), { ownerUid: 'out', name: 'Cizí', createdAt: now, blocked: [] });
    await setDoc(doc(fs, `rooms/${R2}/members/out`), { uid: 'out', nick: 'Cizí', status: 'owner', joinedAt: now });
    await setDoc(doc(fs, `rooms/${R}/calls/c1`), { ...callData('owner', ['owner', 'amy']), createdAt: now });
    await setDoc(doc(fs, `rooms/${R}/calls/g1`), { ...callData('owner', ['owner', 'amy', 'zoe']), createdAt: now });
    await setDoc(doc(fs, `rooms/${R}/calls/old`), { ...callData('owner', ['owner', 'amy']), createdAt: Timestamp.fromMillis(Date.now() - 5 * H), expiresAt: Timestamp.fromMillis(Date.now() - H) });
    await setDoc(doc(fs, `rooms/${R}/calls/end`), { ...callData('owner', ['owner', 'amy']), createdAt: now, status: 'ended', endedAt: now });
    await setDoc(doc(fs, `rooms/${R}/calls/c1/signals/s1`), { ...sig('owner', 'amy'), createdAt: now });
    await setDoc(doc(fs, `rooms/${R}/calls/c1/peers/owner`), { ...peer('owner'), at: now });
  });
});
const C = (fs, id = 'n1') => doc(fs, `rooms/${R}/calls/${id}`);
describe('vytvoření hovoru', () => {
  it('schválená členka založí 1:1 hovor se schválenou', () => assertSucceeds(setDoc(C(db('amy')), callData('amy', ['amy', 'zoe']))));
  it('zakladatelka založí skupinový hovor (4 účastnice)', () => assertSucceeds(setDoc(C(db('owner')), callData('owner', ['owner', 'amy', 'zoe', 'eva']))));
  it('5 účastnic → odmítnuto (limit mesh 4)', () => assertFails(setDoc(C(db('owner')), callData('owner', ['owner', 'amy', 'zoe', 'eva', 'pend']))));
  it('čekající nesmí volat', () => assertFails(setDoc(C(db('pend')), callData('pend', ['pend', 'amy']))));
  it('nesmí se volat čekající', () => assertFails(setDoc(C(db('amy')), callData('amy', ['amy', 'pend']))));
  it('zablokovaná nesmí volat', () => assertFails(setDoc(C(db('bad')), callData('bad', ['bad', 'amy']))));
  it('nesmí se volat zablokovaná', () => assertFails(setDoc(C(db('amy')), callData('amy', ['amy', 'bad']))));
  it('cizí (členka jiné skupiny) nesmí volat ani přizvat cizí', async () => { await assertFails(setDoc(C(db('out')), callData('out', ['out', 'amy']))); await assertFails(setDoc(C(db('amy')), callData('amy', ['amy', 'out']))); });
  it('nepřihlášená nesmí', () => assertFails(setDoc(C(anon()), callData('amy', ['amy', 'zoe']))));
  it('nesmí se vydávat za jinou (createdBy / přezdívka)', async () => { await assertFails(setDoc(C(db('amy')), callData('zoe', ['amy', 'zoe']))); await assertFails(setDoc(C(db('amy')), { ...callData('amy', ['amy', 'zoe']), nick: 'Laurinka' })); });
  it('volající musí být účastnice; bez opakování', async () => { await assertFails(setDoc(C(db('amy')), callData('amy', ['zoe', 'eva']))); await assertFails(setDoc(C(db('amy')), callData('amy', ['amy', 'amy']))); });
  it('platnost max 4 h, stav ringing, režim podle počtu, žádná další pole', async () => {
    await assertFails(setDoc(C(db('amy')), callData('amy', ['amy', 'zoe'], { expiresAt: Timestamp.fromMillis(Date.now() + 5 * H) })));
    await assertFails(setDoc(C(db('amy')), callData('amy', ['amy', 'zoe'], { status: 'active' })));
    await assertFails(setDoc(C(db('amy')), callData('amy', ['amy', 'zoe'], { mode: 'group' })));
    await assertFails(setDoc(C(db('amy')), callData('amy', ['amy', 'zoe'], { record: true })));
    await assertFails(setDoc(C(db('amy')), callData('amy', ['amy', 'zoe'], { kind: 'screen' })));
  });
});
describe('čtení hovoru', () => {
  it('účastnice čte hovor; dotaz na vlastní hovory projde', async () => {
    await assertSucceeds(getDoc(C(db('amy'), 'c1')));
    await assertSucceeds(getDocs(query(collection(db('amy'), `rooms/${R}/calls`), where('participants', 'array-contains', 'amy'))));
  });
  it('schválená NEúčastnice hovor nepřečte ani nevypíše', async () => {
    await assertFails(getDoc(C(db('zoe'), 'c1')));
    await assertFails(getDocs(collection(db('zoe'), `rooms/${R}/calls`)));
  });
  it('čekající, zablokovaná, cizí, nepřihlášená nepřečtou nic', async () => {
    for (const f of [db('pend'), db('bad'), db('out'), anon()]) {
      await assertFails(getDoc(C(f, 'c1')));
      await assertFails(getDocs(query(collection(f, `rooms/${R}/calls`), where('participants', 'array-contains', 'amy'))));
    }
  });
  it('účastnice, kterou zakladatelka zablokovala během hovoru, ztratí přístup', async () => {
    await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), `rooms/${R}`), { blocked: ['bad', 'amy'] }));
    await assertFails(getDoc(C(db('amy'), 'c1')));
    await assertFails(setDoc(doc(db('amy'), `rooms/${R}/calls/c1/peers/amy`), peer('amy')));
  });
});
describe('stav hovoru', () => {
  it('účastnice: ringing → active → ended', async () => { await assertSucceeds(updateDoc(C(db('amy'), 'c1'), { status: 'active' })); await assertSucceeds(updateDoc(C(db('amy'), 'c1'), { status: 'ended', endedAt: serverTimestamp() })); });
  it('ukončený hovor už nejde znovu otevřít', () => assertFails(updateDoc(C(db('amy'), 'end'), { status: 'active' })));
  it('prošlý hovor nejde aktivovat (jen ukončit)', async () => { await assertFails(updateDoc(C(db('amy'), 'old'), { status: 'active' })); await assertSucceeds(updateDoc(C(db('amy'), 'old'), { status: 'ended', endedAt: serverTimestamp() })); });
  it('nejde měnit účastnice ani jiná pole', async () => { await assertFails(updateDoc(C(db('amy'), 'c1'), { participants: ['owner', 'amy', 'zoe'] })); await assertFails(updateDoc(C(db('amy'), 'c1'), { kind: 'audio' })); });
  it('neúčastnice nesmí měnit stav', () => assertFails(updateDoc(C(db('zoe'), 'c1'), { status: 'ended', endedAt: serverTimestamp() })));
  it('mazání: jen ukončený/prošlý a jen účastnice', async () => {
    await assertFails(deleteDoc(C(db('amy'), 'c1')));
    await assertFails(deleteDoc(C(db('zoe'), 'end')));
    await assertSucceeds(deleteDoc(C(db('amy'), 'end')));
    await assertSucceeds(deleteDoc(C(db('owner'), 'old')));
  });
});
describe('účastnice v hovoru (peers)', () => {
  it('účastnice zapíše svůj stav (připojení, kamera/mikrofon, odmítnutí, odchod)', async () => {
    const r = doc(db('amy'), `rooms/${R}/calls/c1/peers/amy`);
    await assertSucceeds(setDoc(r, peer('amy')));
    await assertSucceeds(setDoc(r, peer('amy', { cam: false, mic: false })));
    await assertSucceeds(setDoc(r, peer('amy', { state: 'left' })));
    await assertSucceeds(setDoc(doc(db('zoe'), `rooms/${R}/calls/g1/peers/zoe`), peer('zoe', { state: 'declined' })));
  });
  it('nejde zapsat cizí záznam ani se vydávat', async () => {
    await assertFails(setDoc(doc(db('amy'), `rooms/${R}/calls/c1/peers/owner`), peer('owner')));
    await assertFails(setDoc(doc(db('amy'), `rooms/${R}/calls/c1/peers/amy`), peer('amy', { nick: 'Laurinka' })));
  });
  it('neúčastnice / čekající / cizí se do hovoru nepřipojí', async () => {
    await assertFails(setDoc(doc(db('zoe'), `rooms/${R}/calls/c1/peers/zoe`), peer('zoe')));
    await assertFails(setDoc(doc(db('pend'), `rooms/${R}/calls/c1/peers/pend`), peer('pend')));
    await assertFails(setDoc(doc(db('out'), `rooms/${R}/calls/c1/peers/out`), peer('out')));
  });
  it('do ukončeného nebo prošlého hovoru se nejde připojit (odejít ano)', async () => {
    await assertFails(setDoc(doc(db('amy'), `rooms/${R}/calls/end/peers/amy`), peer('amy')));
    await assertFails(setDoc(doc(db('amy'), `rooms/${R}/calls/old/peers/amy`), peer('amy')));
    await assertSucceeds(setDoc(doc(db('amy'), `rooms/${R}/calls/old/peers/amy`), peer('amy', { state: 'left' })));
  });
  it('stav čtou jen účastnice', async () => {
    await assertSucceeds(getDocs(collection(db('amy'), `rooms/${R}/calls/c1/peers`)));
    for (const f of [db('zoe'), db('pend'), db('out'), anon()]) await assertFails(getDocs(collection(f, `rooms/${R}/calls/c1/peers`)));
  });
});
describe('signalizace (SDP)', () => {
  const S = (fs, id = 'x') => doc(fs, `rooms/${R}/calls/c1/signals/${id}`);
  it('účastnice pošle nabídku/odpověď jiné účastnici', async () => { await assertSucceeds(setDoc(S(db('amy')), sig('amy', 'owner', { type: 'answer' }))); });
  it('nejde poslat sobě, neúčastnici, za jinou, jiný typ, ani do ukončeného/prošlého hovoru', async () => {
    await assertFails(setDoc(S(db('amy')), sig('amy', 'amy')));
    await assertFails(setDoc(S(db('amy')), sig('amy', 'zoe')));
    await assertFails(setDoc(S(db('amy')), sig('owner', 'amy')));
    await assertFails(setDoc(S(db('amy')), sig('amy', 'owner', { type: 'media', blob: 'x' })));
    await assertFails(setDoc(doc(db('amy'), `rooms/${R}/calls/end/signals/x`), sig('amy', 'owner')));
    await assertFails(setDoc(doc(db('amy'), `rooms/${R}/calls/old/signals/x`), sig('amy', 'owner')));
    await assertFails(setDoc(S(db('amy')), sig('amy', 'owner', { sdp: 'x'.repeat(30001) })));
  });
  it('neúčastnice / čekající / cizí signalizaci neposílají ani nečtou', async () => {
    for (const u of ['zoe', 'pend', 'out']) { await assertFails(setDoc(S(db(u)), sig(u, 'owner'))); await assertFails(getDoc(S(db(u), 's1'))); }
    await assertFails(getDocs(collection(db('zoe'), `rooms/${R}/calls/c1/signals`)));
  });
  it('příjemkyně čte jen zprávy pro sebe a smaže je; signalizace nejde upravit', async () => {
    await assertSucceeds(getDocs(query(collection(db('amy'), `rooms/${R}/calls/c1/signals`), where('to', '==', 'amy'))));
    await assertFails(getDocs(collection(db('amy'), `rooms/${R}/calls/c1/signals`)));
    await assertFails(updateDoc(S(db('amy'), 's1'), { sdp: 'v=1' }));
    await assertSucceeds(deleteDoc(S(db('amy'), 's1')));
  });
});
