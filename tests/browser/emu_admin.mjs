// Jen EMULÁTOR (demo-bandapp): smaže jeden dokument bez pravidel – v testu simuluje telefon BEZ zálohy kontaktů
// (users/{uid}/private/state), aby se ověřilo načtení skupin přímo ze serveru. Ve skutečném Firebase se nepoužívá.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
const [, , rulesPath, cmd, path] = process.argv;
const env = await initializeTestEnvironment({ projectId: 'demo-bandapp', firestore: { rules: readFileSync(rulesPath, 'utf8'), host: '127.0.0.1', port: 8080 } });
if (cmd === 'del') await env.withSecurityRulesDisabled(async c => { await c.firestore().doc(path).delete(); });
console.log('ok', cmd, path.replace(/[^/]+/g, '…').length); process.exit(0);
