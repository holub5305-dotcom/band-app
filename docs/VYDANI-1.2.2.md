# BAND APP 1.2.2 – přihlášení, skupiny ze serveru a opakovaná pozvánka

Aktualizace na místě (stejná adresa, ikonka, manifest i data). Mezipaměť `band-app-pages-13` (maže jen `band-app-pages-*`).
Návrat na 1.1.3 po 1.2.2: větev `navrat-1-1-3` s `band-app-pages-14`. Pravidla Firestore beze změny (nenasazovala se).

## Příčina
1. Seznam skupin se v telefonu držel jen v místní paměti (localStorage). Když se seznam ztratil (účet a schválení
   na serveru zůstaly), 1.1.3 Kamarádky skupiny u běžného (anonymního) účtu znovu nedohledaly a 1.2.1 VIDEOCHAT se
   bez místního seznamu k Firebase vůbec nepřipojil → „Firebase nepřipojeno“, 0 skupin, žádná chyba, žádné hovory.
2. Nová pozvánka pro **stejný, už schválený účet** končila „nedostatečná oprávnění“: přijetí pozvánky přepisovalo
   vlastní existující záznam člena na „čeká“, a to pravidla (správně) zakazují. Reprodukováno v emulátoru.

## Oprava (`friends.js`, `videochat.js`, `sw.js`, `index.html`)
- Po připojení s prázdným místním seznamem se skupiny dohledají na serveru podle vlastního účtu (i u anonymního).
- VIDEOCHAT po studeném startu sám inicializuje Firebase s uloženým přihlášením (bez otevření Kamarádek), živě načítá
  vlastní členství ze serveru a podle něj naslouchá hovorům; chybějící skupiny v telefonu jen doplní (nic nemaže).
- Telefon bez uloženého přihlášení: Firebase ani App Check se nenačítají, žádný účet se nezakládá; VIDEOCHAT jasně
  vysvětlí „Tento telefon není přihlášený jako schválený člen skupiny“ a nabídne pole pro vložení nové pozvánky.
- Pozvánka pro účet, který už ve skupině je: nic se nezapisuje, skupina se obnoví v telefonu, hláška
  „V této skupině už členkou jsi – pozvánku nepotřebuješ“. Žádný duplikát, pozvánka zůstane nepoužitá.
- Diagnostika: Přihlášení (ano/ne + typ), Kód zařízení (prvních 6 znaků SHA-256 účtu), moje skupiny na serveru,
  poslední chyba (jen kód, včetně chyb pozvánky z této relace). Zakladatelka vidí stejný kód u každého člena.
- Starý záznam při novém účtu se nikdy nemaže automaticky – zakladatelka ho může ručně odebrat.

## Testy (emulátor + headless prohlížeče, ne skutečné telefony)
`tests/browser/cold_start.py` (studený start bez Kamarádek, ztracený seznam, opakovaná pozvánka, stará stejná přezdívka)
+ všechny předchozí sady (pravidla, worker, vc_calls, upgrade_rollback, engines, real_flow).
