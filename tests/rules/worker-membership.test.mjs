// BAND APP 1.3.0 – dotaz TURN Workeru na členství (list rooms/{room}/members, limit 1) proti pravidlům.
// Worker se ptá Firestore S TOKENEM UŽIVATELKY; projde jen schválená/zakladatelka, která není zablokovaná.
// Jen emulátor, žádný skutečný projekt. RULES=…/firestore.rules (main = produkční pravidla, beze změny).
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, setDoc, getDocs, collection, query, limit, Timestamp } from 'firebase/firestore';
const RULES = readFileSync(process.env.RULES, 'utf8');
let env; const R = 'roomW';
const q = (fs, room = R) => getDocs(query(collection(fs, `rooms/${room}/members`), limit(1)));
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-bandapp-worker', firestore: { rules: RULES, host: '127.0.0.1', port: 8080 } }); });
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const fs = ctx.firestore(), now = Timestamp.now();
    await setDoc(doc(fs, `rooms/${R}`), { ownerUid: 'owner', name: 'Kamarádky', createdAt: now, blocked: ['bad'] });
    for (const [u, st] of [['owner', 'owner'], ['amy', 'approved'], ['pend', 'pending'], ['bad', 'approved'], ['old', 'replaced']])
      await setDoc(doc(fs, `rooms/${R}/members/${u}`), { uid: u, nick: u, status: st, joinedAt: now, ...(st === 'pending' ? { invite: 'x'.repeat(22) } : {}) });
  });
});
describe('TURN worker – ověření členství (1.3.0)', () => {
  it('zakladatelka → povoleno', async () => { await assertSucceeds(q(env.authenticatedContext('owner').firestore())); });
  it('schválená členka → povoleno', async () => { await assertSucceeds(q(env.authenticatedContext('amy').firestore())); });
  it('čekající (neschválená) → odmítnuto', async () => { await assertFails(q(env.authenticatedContext('pend').firestore())); });
  it('zablokovaná → odmítnuto', async () => { await assertFails(q(env.authenticatedContext('bad').firestore())); });
  it('převedený starý účet → odmítnuto', async () => { await assertFails(q(env.authenticatedContext('old').firestore())); });
  it('cizí přihlášená osoba → odmítnuto', async () => { await assertFails(q(env.authenticatedContext('stranger').firestore())); });
  it('nepřihlášená → odmítnuto', async () => { await assertFails(q(env.unauthenticatedContext().firestore())); });
  it('neexistující skupina → odmítnuto', async () => { await assertFails(q(env.authenticatedContext('amy').firestore(), 'neni')); });
});
