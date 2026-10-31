// Naplní EMULÁTOR (projekt demo-bandapp) testovací skupinou a nahraje do něj pravidla z větve. Nic skutečného.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
const [, , rulesPath, json] = process.argv; const S = JSON.parse(json);
const env = await initializeTestEnvironment({ projectId: 'demo-bandapp', firestore: { rules: readFileSync(rulesPath, 'utf8'), host: '127.0.0.1', port: 8080 } });
await env.clearFirestore();
await env.withSecurityRulesDisabled(async ctx => {
  const fs = ctx.firestore(), now = Timestamp.now();
  await setDoc(doc(fs, `rooms/${S.room}`), { ownerUid: S.owner, name: S.name || 'Kapela', createdAt: now, blocked: [] });
  for (const m of S.members) await setDoc(doc(fs, `rooms/${S.room}/members/${m.uid}`), { uid: m.uid, nick: m.nick, status: m.status, joinedAt: now });
  const msgs = S.messages || [{ uid: S.owner, nick: 'Laurinka', text: 'Ahoj holky, zkouška 🎸', ago: 0 }];
  for (const [i, m] of msgs.entries()) await setDoc(doc(fs, `rooms/${S.room}/messages/m${i + 1}`), { uid: m.uid, nick: m.nick, text: m.text, createdAt: Timestamp.fromMillis(Date.now() - (m.ago || 0)) });
});
console.log('seeded');
process.exit(0);
