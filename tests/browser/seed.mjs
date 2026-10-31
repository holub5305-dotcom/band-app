// Naplní EMULÁTOR (projekt demo-bandapp) testovací skupinou a nahraje do něj pravidla z větve. Nic skutečného.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
const [, , rulesPath, json] = process.argv; const S = JSON.parse(json);
const env = await initializeTestEnvironment({ projectId: 'demo-bandapp', firestore: { rules: readFileSync(rulesPath, 'utf8'), host: '127.0.0.1', port: 8080 } });
await env.clearFirestore();
await env.withSecurityRulesDisabled(async ctx => {
  const fs = ctx.firestore(), now = Timestamp.now();
  await setDoc(doc(fs, `rooms/${S.room}`), { ownerUid: S.owner, name: 'Kapela', createdAt: now, blocked: [] });
  for (const m of S.members) await setDoc(doc(fs, `rooms/${S.room}/members/${m.uid}`), { uid: m.uid, nick: m.nick, status: m.status, joinedAt: now });
  await setDoc(doc(fs, `rooms/${S.room}/messages/m1`), { uid: S.owner, nick: 'Laurinka', text: 'Ahoj holky, zkouška 🎸', createdAt: now });
});
console.log('seeded');
process.exit(0);
