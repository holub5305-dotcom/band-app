// Jen EMULÁTOR (demo-bandapp): vyprázdní databázi a nahraje pravidla z větve. Žádná data se nevkládají –
// skupiny, pozvánky a schválení vytváří test přes skutečné obrazovky aplikace (stejný tvar dat jako u uživatelek).
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
const env = await initializeTestEnvironment({ projectId: 'demo-bandapp', firestore: { rules: readFileSync(process.argv[2], 'utf8'), host: '127.0.0.1', port: 8080 } });
await env.clearFirestore(); console.log('rules loaded'); process.exit(0);
