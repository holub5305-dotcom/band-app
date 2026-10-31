/* BAND APP – nastavení Kamarádek pro SKUTEČNOU (veřejnou) BAND APP, produkční projekt Firebase band-app-7c9ca.
 * ⚠️ Sem patří jen údaje PRODUKČNÍHO projektu band-app-7c9ca. Nikdy ne testovacího projektu (band-app-test-…):
 *    pojistka ve friends.js veřejnou aplikaci s testovacím projektem nespustí.
 *
 * Tyto údaje NEJSOU tajné: Firebase je navrhl tak, aby byly vidět ve webové stránce.
 * Data před jinými uživatelkami a cizími chrání bezpečnostní pravidla (firestore.rules) a App Check, ne tento soubor.
 * Zprávy nejsou koncově šifrované: vlastník/správce projektu Firebase a Google k nim mají technický přístup.
 * Obnovovací kódy sem NEPATŘÍ – nikam se neukládají.
 * NIKDY sem nevkládej heslo, soukromý klíč, tajný klíč reCAPTCHA ani "service account" JSON.
 *
 * ✅ VYPLNĚNO (1p-final, 18. 10. 2026): webová konfigurace produkčního projektu band-app-7c9ca
 *    (doplněno nástrojem tools/fill-config.sh; shoda s webConfig projektu ověřena jen čtením).
 *    Kamarádky se připojí k Firebase teprve, když je uživatelka otevře. Zbytek BAND APP funguje jako dřív.
 *    Obnovovací kód: od 1.2.3 ZAPNUTÝ (RECOVERY_DOMAIN_VERIFIED níže).
 */
export const FIREBASE_CONFIGURED = true;

/* Veřejná BAND APP = false. Neměň. (Testovací balíček má true; aplikace odmítne běžet, když se soubory spletou.) */
export const TEST_BUILD = false;

export const firebaseConfig = {
  apiKey: "AIzaSyAj1r6xgNHi4VzReqKOkxMOzv2uYfXmzUo",
  authDomain: "band-app-7c9ca.firebaseapp.com",
  projectId: "band-app-7c9ca",
  storageBucket: "band-app-7c9ca.firebasestorage.app",
  messagingSenderId: "604912868883",
  appId: "1:604912868883:web:9f62d14ecf25ba6a7c29e6"
};

/* App Check (ochrana proti zneužití cizími skripty). Volitelné.
 * siteKey: veřejný klíč webu z reCAPTCHA (v3) nebo reCAPTCHA Enterprise. Prázdné = vypnuto.
 * provider: 'v3' nebo 'enterprise'. Tajný klíč reCAPTCHA se vkládá jen do Firebase konzole, NIKDY sem.
 * 1p: VYPNUTO. App Check zatím nebyl vyzkoušen ani na testovacím projektu; reCAPTCHA posílá údaje Googlu
 * (cookie), což by se muselo doplnit do soukromi.html. Postup: nejdřív test, pak jen sledovat, až potom vynutit. */
export const APP_CHECK = {
  siteKey: "",
  provider: "v3"
};

/* Obnovovací kód – technicky přihlášení Email/Password s vymyšlenou adresou účtu
 * (náhodné ID + doména níže). Na adresu se nikdy nic neposílá.
 *
 * RECOVERY_DOMAIN_VERIFIED – pojistka. S false aplikace kód nevytvoří, neobnoví ani nezmění
 * („Připravuje se – zatím neověřeno“); chat a pozvánky fungují dál (anonymní účet).
 * Na testovacím projektu je adresa ověřená (18. 10. 2026). Na produkčním projektu band-app-7c9ca zatím NE:
 * nastavení projektu (ochrana výčtu účtů, povolené vytváření účtů) se mohou lišit. Proto 1p = false.
 * Na true se přepne až po krátkém skriptovaném testu na band-app-7c9ca (1 účet, hned smazaný – jen s výslovným
 * souhlasem), nebo dřív, pokud se tak výslovně rozhodneš (DEPLOY.md, krok 4).
 *
 * RECOVERY_EMAIL_DOMAIN: "obnova.band-app.invalid" (.invalid je celosvětově vyhrazená, nikomu nepatří).
 * Doménu měň JEN PŘED vytvořením prvního skutečného kódu – po změně by dřív vytvořené kódy přestaly fungovat. */
export const RECOVERY_EMAIL_DOMAIN = "obnova.band-app.invalid";
/* 1.2.3 (31. 10. 2026): ZAPNUTO. Ověřeno jen veřejnými čteními bez založení účtu: poskytovatel Email/Password je
 * v band-app-7c9ca zapnutý, zásady hesla min. 6 znaků (kód má 20), povolené domény obsahují holub5305-dotcom.github.io.
 * Kód připojí přihlášení k STÁVAJÍCÍMU účtu (linkWithCredential) → uid i „Kód účtu“ zůstávají stejné. */
export const RECOVERY_DOMAIN_VERIFIED = true;
