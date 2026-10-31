# BAND APP 1.2.3 – stálý kód účtu, žádné samovolné účty, obnova a převod členství

Aktualizace na místě (stejná adresa, ikonka, manifest i data). Mezipaměť `band-app-pages-14` (maže jen `band-app-pages-*`).
Návrat na 1.1.3 po 1.2.3: větev `navrat-1-1-3` s `band-app-pages-15`. Pravidla Firestore: přidány JEN dvě větve převodu
členství (zálohy živých pravidel před nasazením v `docs/rules-backup-*-1.2.2.rules`).

## Příčina nesouladu kódů (např. BD619B / 7DFE2E)
Kód je otisk účtu Firebase (prvních 6 znaků SHA-256 z uid) – sám se nikdy nemění. Rozdílné kódy = DVA různé účty.
Do 1.2.2 aplikace při otevření Kamarádek **potichu založila nový anonymní účet**, kdykoli v daném prohlížeči nikdo
nebyl přihlášený. Na iPhonu má Safari a nainstalovaná BAND APP každý své vlastní přihlášení: pozvánka otevřená
v Safari → schválený účet je v Safari; Kamarádky otevřené v nainstalované aplikaci → druhý, prázdný účet s jiným kódem.

## Oprava
- `signInAnonymously` je v celé aplikaci jen na jednom místě: `createAccount()` za výslovným tlačítkem
  „➕ Založit účet“ (s varováním, pokud zařízení dřív patřilo jinému účtu: „byl tu účet s kódem X“).
  Kamarádky, VIDEOCHAT i pozvánka bez přihlášení jen vysvětlí situaci a nabídnou obnovu.
- „Kód účtu“ (dřív „Kód zařízení“) v Kamarádky → Můj účet, ve VIDEOCHAT → Diagnostika, na pozvánce a u zakladatelky
  u každé členky. Kód není heslo – jen pro porovnání.
- „🔐 Zabezpečit účet“ = obnovovací kód (z 1.1.3) je nyní zapnutý i v produkci: k tomuto účtu se připojí přihlášení
  náhodné ID + 100bitové tajemství (linkWithCredential → stejné uid, stejný kód). „♻️ Mám obnovovací kód“ na jiném
  telefonu / v jiném prohlížeči přihlásí STEJNÝ účet → stejné členství, žádný duplikát. Bez e-mailu, bez Googlu.
  Poskytovatel E-mail/heslo i povolená doména holub5305-dotcom.github.io ověřeny veřejným API (bez zakládání účtů).
- „🔁 Převést členství z dřívějšího účtu“ (jen zakladatelka, osobně): u nové žádosti zvolí starý záznam a opíše kód účtu
  z telefonu členky. Nový účet dostane stejnou přezdívku a schválení, starý záznam se NEMAŽE – označí se „převedeno“
  (předchozí kód zůstane vidět) a ztratí přístup. Staré zprávy se novému účtu ukazují jako jeho vlastní.
- Varování u stejné přezdívky ukazuje u obou záznamů jejich kód účtu.

## Pravidla
Dvě nové větve `members` update (jen `isOwner`), zapisované v JEDNÉ dávce: nový účet (čekající/schválený, ne zakladatelka,
ne zablokovaný) → `approved` + `replaces` + přezdívka shodná se starým schváleným účtem; starý → `replaced` + `replacedBy`.
Obě strany se navzájem kontrolují (`getAfter`). Převedený účet nic nečte, nevolá ani se nedá znovu schválit.

## Testy (emulátor + headless prohlížeče, ne skutečné telefony)
`tests/rules/identity-rules.test.mjs`, `tests/browser/identity.py` + všechny předchozí sady.
