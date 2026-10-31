// BAND APP 1.2.3 – testy pravidel PŘEVODU ČLENSTVÍ (Firestore emulátor). Jen emulátor, žádný skutečný projekt.
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';
const RULES = readFileSync(process.env.RULES, 'utf8');
let env; const R = 'roomA', H = 3600e3;
const db = uid => env.authenticatedContext(uid).firestore();
const M = (fs, u) => doc(fs, `rooms/${R}/members/${u}`);
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-bandapp-ident', firestore: { rules: RULES, host: '127.0.0.1', port: 8080 } }); });
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const fs = ctx.firestore(), now = Timestamp.now();
    await setDoc(doc(fs, `rooms/${R}`), { ownerUid: 'owner', name: 'Kamarádky', createdAt: now, blocked: ['bad'] });
    for (const [u, nick, st] of [['owner', 'Laurinka', 'owner'], ['tataOld', 'Táta', 'approved'], ['tataNew', 'Táta', 'pending'], ['amy', 'Amy', 'approved'], ['pend2', 'Cizí', 'pending'], ['bad', 'Bad', 'pending']])
      await setDoc(M(fs, u), { uid: u, nick, status: st, joinedAt: now, ...(st === 'pending' ? { invite: 'x'.repeat(22) } : {}) });
    await setDoc(doc(fs, `rooms/${R}/messages/m1`), { uid: 'tataOld', nick: 'Táta', text: 'ahoj', createdAt: now });
  });
});
const transfer = (by, oldU = 'tataOld', newU = 'tataNew', o = {}) => {
  const fs = db(by), b = writeBatch(fs);
  if (!o.skipNew) b.update(M(fs, newU), { status: 'approved', approvedAt: serverTimestamp(), nick: o.nick || 'Táta', replaces: o.replaces || oldU, ...(o.newExtra || {}) });
  if (!o.skipOld) b.update(M(fs, oldU), { status: o.oldStatus || 'replaced', replacedBy: o.replacedBy || newU, replacedAt: serverTimestamp(), ...(o.oldExtra || {}) });
  return b.commit();
};
describe('převod členství (1.2.3)', () => {
  it('zakladatelka převede schválené členství na čekající nový účet (jedna dávka)', async () => {
    await assertSucceeds(transfer('owner'));
    const o = (await getDoc(M(db('owner'), 'tataOld'))).data(), n = (await getDoc(M(db('owner'), 'tataNew'))).data();
    if (o.status !== 'replaced' || o.replacedBy !== 'tataNew' || n.status !== 'approved' || n.replaces !== 'tataOld' || n.nick !== 'Táta') throw new Error('stav');
  });
  it('po převodu: nový účet čte staré zprávy, starý účet už ne (záznam ani zprávy se nesmazaly)', async () => {
    await transfer('owner');
    await assertSucceeds(getDoc(doc(db('tataNew'), `rooms/${R}/messages/m1`)));
    await assertFails(getDoc(doc(db('tataOld'), `rooms/${R}/messages/m1`)));
    await assertSucceeds(getDoc(M(db('tataOld'), 'tataOld')));                         // vlastní záznam vidí (status „převedeno“)
    await assertFails(setDoc(doc(db('tataOld'), `rooms/${R}/messages/x`), { uid: 'tataOld', nick: 'Táta', text: 'x', createdAt: serverTimestamp() }));
  });
  it('převedený účet nejde znovu schválit běžným schválením ani si změnit přezdívku', async () => {
    await transfer('owner');
    await assertFails(updateDoc(M(db('owner'), 'tataOld'), { status: 'approved', approvedAt: serverTimestamp() }));
    await assertFails(updateDoc(M(db('tataOld'), 'tataOld'), { nick: 'Táta2' }));
  });
  it('NE-zakladatelka (schválená členka) převod udělat nesmí', () => assertFails(transfer('amy')));
  it('nový účet si převod nesmí udělat sám', () => assertFails(transfer('tataNew')));
  it('starý účet převod udělat nesmí', () => assertFails(transfer('tataOld')));
  it('jen jedna polovina (bez označení starého) → odmítnuto', () => assertFails(transfer('owner', 'tataOld', 'tataNew', { skipOld: true })));
  it('jen označení starého (bez nového) → odmítnuto', () => assertFails(transfer('owner', 'tataOld', 'tataNew', { skipNew: true })));
  it('jiná přezdívka než starý účet → odmítnuto', () => assertFails(transfer('owner', 'tataOld', 'tataNew', { nick: 'Někdo' })));
  it('nový účet, který ve skupině není (nemá záznam) → odmítnuto', () => assertFails(transfer('owner', 'tataOld', 'cizi')));
  it('převod na zablokovaný účet → odmítnuto', () => assertFails(transfer('owner', 'tataOld', 'bad')));
  it('převod ZE zakladatelky → odmítnuto', () => assertFails(transfer('owner', 'owner', 'tataNew', { nick: 'Laurinka' })));
  it('převod ze ČEKAJÍCÍ (neschválené) → odmítnuto', () => assertFails(transfer('owner', 'pend2', 'tataNew', { nick: 'Cizí' })));
  it('nesouhlasící odkazy (replacedBy jinam) → odmítnuto', () => assertFails(transfer('owner', 'tataOld', 'tataNew', { replacedBy: 'amy' })));
  it('převod nemůže přidat jiná pole (např. status owner, uid)', async () => {
    await assertFails(transfer('owner', 'tataOld', 'tataNew', { newExtra: { uid: 'x' } }));
    await assertFails(transfer('owner', 'tataOld', 'tataNew', { oldExtra: { nick: 'X' } }));
  });
  it('čekající nový účet bez převodu nic nečte ani nevolá', async () => {
    await assertFails(getDoc(doc(db('tataNew'), `rooms/${R}/messages/m1`)));
    await assertFails(setDoc(doc(db('tataNew'), `rooms/${R}/calls/c`), { createdBy: 'tataNew', nick: 'Táta', kind: 'video', mode: 'direct', participants: ['tataNew', 'owner'], status: 'ringing', createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + H) }));
  });
  it('převedený (starý) účet nejde volat a nemůže volat', async () => {
    await transfer('owner');
    await assertFails(setDoc(doc(db('owner'), `rooms/${R}/calls/c`), { createdBy: 'owner', nick: 'Laurinka', kind: 'video', mode: 'direct', participants: ['owner', 'tataOld'], status: 'ringing', createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + H) }));
    await assertSucceeds(setDoc(doc(db('owner'), `rooms/${R}/calls/c2`), { createdBy: 'owner', nick: 'Laurinka', kind: 'video', mode: 'direct', participants: ['owner', 'tataNew'], status: 'ringing', createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + H) }));
  });
  it('běžné schválení čekající dál funguje (beze změny)', () => assertSucceeds(updateDoc(M(db('owner'), 'tataNew'), { status: 'approved', approvedAt: serverTimestamp() })));
  it('zakladatelka může převedený záznam jen ručně odebrat (nic se nemaže samo)', async () => { await transfer('owner'); await assertSucceeds(deleteDoc(M(db('owner'), 'tataOld'))); });
});
