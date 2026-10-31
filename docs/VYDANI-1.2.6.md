# BAND APP 1.2.6 – VIDEOCHAT u účtu s obnovovacím kódem, srozumitelné chyby přihlášení

**Hlášení 31. 10. 2026 (po 1.2.5):** Tátův telefon (Android, nainstalovaná BAND APP, účet 7DFE2E) – VIDEOCHAT →
Diagnostika: Firebase „nepřipojeno“, Přihlášení „odhlášeno“, naslouchání „neaktivní“. Obnova uloženým obnovovacím
kódem nic nezměnila, „Znovu připojit hovory“ nic viditelného neudělalo. Laurinčin účet 12E970 funguje.

**Skutečná příčina (reprodukováno: tests/browser/recovery_auth.py, EXPECT=bug proti stromu 1.2.5):**
`videochat.js` → `ensureStarted()` začínal podmínkou `if (lockedReason() || …) return`. `lockedReason()` ale není
stav přihlášení – je to jen MÍSTNÍ značka v localStorage „tento telefon měl účet s obnovovacím kódem“
(`bandapp-friends-recoverable-uid`), která se nastaví, jakmile si člověk kód vytvoří (Kamarádky → Můj účet →
🔐 Zabezpečit účet) nebo účet kódem obnoví. Od té chvíle VIDEOCHAT Firebase vůbec nenačetl, ačkoli byl účet
v Kamarádkách normálně přihlášený (Můj účet ukazoval správně 7DFE2E). Diagnostika navíc psala „odhlášeno“ podle
stejné značky. Obnova vlastním kódem tedy NIC nezměnila (správně: „účet už je přihlášený“, stejné uid) a značku
jen potvrdila; „Znovu připojit hovory“ volalo stejné `ensureStarted()`, které hned skončilo.
Laurinka kód nevytvořila → značku nemá → u ní vše jde. Chyba je v kódu od 1.2.2 (1.2.1 měla podobnou podmínku), projevila se až od 1.2.3,
kdy se obnovovací kódy v produkci zapnuly.

Vyloučeno (důkazy): Firebase je v aplikaci inicializovaný JEDNOU (`friends.js` → `base()`, jméno aplikace
„bandapp-friends“, výchozí perzistence IndexedDB); `videochat.js` i `join.html` používají tutéž instanci přes
`firebaseBase()`/`connect()`. Konfigurace produkčního projektu band-app-7c9ca (jen veřejná čtení, žádná uživatelská
data): povolené domény obsahují holub5305-dotcom.github.io; poskytovatel Email/Password je zapnutý (přihlášení
s neexistující adresou vrací INVALID_LOGIN_CREDENTIALS, ne OPERATION_NOT_ALLOWED); API klíč s refererem github.io
přijat. Nic v konzoli Firebase se měnit nemusí.

**Změny (pravidla Firestore BEZE ZMĚNY, manifest a ikona beze změny, žádný nový ani tichý účet, nic se nemaže):**
- VIDEOCHAT rozhoduje podle skutečného přihlášení Firebase (`auth.currentUser`), ne podle místní značky.
  Když přihlášení zmizí, zastaví naslouchání a ukáže „🔒 Odhlášeno – obnov účet XXXXXX“.
- Diagnostika: „Přihlášení“ podle skutečného stavu („odhlášeno – obnov účet (dřív účet XXXXXX)“), „Kód účtu“ jen
  u přihlášeného účtu, nový řádek „Chyba přihlášení“ (česky + kategorie chyby Firebase, bez tajemství).
- „Znovu připojit hovory“: viditelně ověří přihlášení u Firebase (obnova tokenu), znovu zapne naslouchání a napíše
  výsledek („✅ Přihlášeno – účet XXXXXX. Naslouchání hovorům: AKTIVNÍ“ / „⚠️ Odhlášeno – obnov účet …“ /
  „… Spojení s Firebase ale selhalo: … (chyba Firebase: auth/network-request-failed)“).
- Každá chyba přihlášení (auth/…) v Kamarádkách, v obnově účtu a v Diagnostice: česká věta + „(chyba Firebase: kód)“.
  Nové texty pro auth/network-request-failed, invalid-api-key, app-not-authorized, web-storage-unsupported, …
- Obnova účtu vždy řekne, KOMU kód patří: „Obnovovací kód patří účtu XXXXXX – ten už je přihlášený“ /
  „Přihlášeno – účet XXXXXX je obnovený“ / „⚠️ Obnovovací kód patří účtu XXXXXX, ne účtu YYYYYY, který tu byl dřív …
  Nic se nesloučilo ani nesmazalo; převod dělá jen zakladatelka“. Oznámení přežije překreslení i znovunačtení stránky.
- Odhlášený telefon nikdy neukazuje kód jako přihlášený: Kamarádky „🔒 Odhlášeno – obnov účet XXXXXX“ (dřív
  zavádějící „Tvůj kód byl změněn na jiném zařízení“ i při ztraceném přihlášení).
- Obnova vlastním kódem na už přihlášeném účtu se zbytečně neptá „přepnout účet?“.
- SW band-app-pages-19, patička 1.2.6. Návrat na 1.1.3 (větev navrat-1-1-3): band-app-pages-20.

**Testy (headless Chromium/Firefox + Firebase emulátor, NE skutečné telefony):** recovery_auth.py
(bug na 1.2.5: reprodukce; fixed: kód vytvořen → restart → připojeno + hovory oběma směry; obnova vlastním kódem;
ztracené přihlášení při kódu v localStorage; špatný kód; výpadek sítě při obnově i „Znovu připojit“; kód jiného
účtu bez sloučení; členství beze změny) + všechny dosavadní sady.
