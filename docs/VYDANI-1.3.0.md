# BAND APP 1.3.0 – videohovory i přes mobilní data (TURN přes Cloudflare Worker, ExpressTURN Free)

**Stav: připraveno, NEVYDÁNO.** Vydává se jen po výslovném konečném souhlasu (Táta), v pořadí níže.
Běžná aktualizace na místě: stejná adresa `/band-app/`, stejný `manifest.webmanifest` (sha256 51957276…3ef),
stejná ikona, **pravidla Firestore beze změny**. Účty (uid Firebase, Kód účtu = prvních 6 znaků SHA-256(uid),
např. 7DFE2E / 12E970), skupiny, zprávy, nahrávky (IndexedDB), lekce a nastavení (localStorage) se nemění.
Žádné placené služby: Cloudflare Workers Free + ExpressTURN Free (bez platební karty). Hovory se nenahrávají.

## Proč
1.2.7 diagnostika ukázala: bez TURN serveru se spojení mezi telefony na různých sítích (mobilní data, CGNAT)
nenaváže. 1.3.0 přidává TURN – přenosový server, přes který jde šifrovaný obraz/zvuk (DTLS-SRTP), když přímá
cesta nejde.

## Jak (bezpečnost údajů)
- Jméno a heslo ExpressTURN jsou **jen tajemství (Secret) Cloudflare Workeru** – nikdy v aplikaci ani na GitHubu.
  Zadává je jen majitel (Dashboard nebo `wrangler secret put`), nikdo jiný je nevidí.
- Aplikace si je při zazvonění/zahájení hovoru vyžádá z `https://bandapp-turn-prod.holub5305.workers.dev/ice`
  s přihlašovacím tokenem Firebase. Worker ověří podpis tokenu (projekt band-app-7c9ca) a **členství**: zeptá se
  Firestore s tokenem uživatelky na seznam členek skupiny – pravidla to dovolí jen schválené/zakladatelce, která
  není zablokovaná (`allow list: if isApproved(roomId)`, beze změny; test `tests/rules/worker-membership.test.mjs`).
  Neschválená, zablokovaná, převedená, cizí ani nepřihlášená údaje nedostane. Jen z původu
  `https://holub5305-dotcom.github.io`, odpovědi `no-store`, nic se neloguje, limit žádostí na uid.
- Omezení: schválené členky údaje během hovoru v telefonu mají (u pevných údajů ExpressTURN nejde jinak).

## Změny v aplikaci (`videochat.js`, `rtc-config.js`, `sw.js`, `index.html`)
- TURN údaje se načtou při zazvonění/zahájení (cache ≤10 min na skupinu, neúspěch 20 s, timeout 5 s).
- Čekání na „relay“ kandidáta max. 8 s (bez TURN jako dřív 3 s).
- ICE restart: odpojeno > 5 s, návrat online, změna sítě (Wi-Fi ↔ data).
- Přes TURN menší obraz: 1:1 400 kb/s, skupina 250 kb/s (přímo 650/350), zvuk 40 kb/s.
- 🛠 Diagnostika: „Cesta: přímé spojení / přes TURN (relay)“, „Limit obrazu“, „TURN kandidát (relay)“.
- Hláška „TURN nedostupný – zkuste Wi-Fi.“ jen když se spojení nenaváže a TURN nefunguje.
- **Bezpečný návrat k chování 1.2.7:** když Worker neexistuje, nemá tajemství (503), neodpovídá nebo je
  nedostupný, hovor jede jen přes STUN/přímé spojení přesně jako 1.2.7 (testy 6 v `turn_relay.py`).
- SW `band-app-pages-23`, patička „BAND APP 1.3.0“.

## Pořadí vydání (až po konečném souhlasu)
1. Nasadit prázdný produkční Worker: `cd _tools/turn-worker && npx wrangler deploy -c wrangler.prod.toml`
   (Workers Free, bez tajemství; `/health` → `configured:false`, `/ice` → 401/403/503 → aplikace = 1.2.7).
2. Táta vloží tajemství `TURN_USERNAME` a `TURN_PASSWORD` do Workeru **bandapp-turn-prod** (stejný postup jako
   u bandapp-turn-test). Kontrola: `https://bandapp-turn-prod.holub5305.workers.dev/health` → `"configured":true`.
3. Sloučit PR 1.3.0 do `main` (GitHub Pages nasadí ~1 min).
4. Ověřit produkci: patička 1.3.0, SW pages-23, manifest sha beze změny, Firebase band-app-7c9ca, žádné
   změny pravidel; na telefonech: otevřít BAND APP → aktualizace sama (případně zavřít a znovu otevřít) →
   účet, skupiny, zprávy, nahrávky na místě → hovor Wi-Fi ↔ data → 🛠 „Cesta“.

## Návrat (kdyby cokoli nefungovalo)
- **Rychlé vypnutí TURN bez nového vydání:** smazat tajemství ve Workeru nebo Worker vypnout → aplikace jede jako 1.2.7.
- **Návrat souborů na 1.1.3:** větev `navrat-1-1-3-p24` (soubory 1.1.3, SW `band-app-pages-24`, data beze změny)
  – připravena, neslučovaná. Test `upgrade_rollback.py` (1.2.7 → 1.3.0 → návrat) ji ověřuje.
- **Návrat na 1.2.7:** `git revert` sloučení PR 1.3.0 + zvýšit SW na `band-app-pages-24` (aby se telefony aktualizovaly).

## Testy (emulátor + Chromium/Firefox headless, NE skutečné telefony)
Výsledky 31. 10. 2026: pravidla 73/73, 36/36, 19/19, prod-compat 39/39, **worker-membership 8/8** (produkční
pravidla main = beze změny); turn-worker 32/32; recovery_auth bug 17/17 + fixed 44/44 (1× v plné sadě časový
výpadek kliknutí při vytížení stroje, opakování 44/44); media_2way 33/33; join_page_calls bug 18/18 + fixed 27/27;
vc_calls 44/44; **upgrade_rollback se seedovanými daty (zprávy, 2 nahrávky IndexedDB SHA-256, skupina, lekce,
oblíbené, přezdívka, uid + Kód účtu): 1.1.3 → 1.3.0 → návrat 51/51, 1.2.6 → 1.3.0 → návrat 51/51,
1.2.7 → 1.3.0 → návrat (pages-24) 51/51** – localStorage bit po bitu stejné, nahrávky stejné, stejné uid a Kód účtu,
manifest identický; real_flow 32/32, cold_start 45/45, identity 53/53, transfer_old 37/37, Firefox 15/15 (2 INFO);
turn_relay (místní coturn, 4 Chromium): 57/57 a po přidání scénáře „služba nedostupná → jako 1.2.7“ 61/62
(jediné selhání: kontrola dosažitelnosti coturnu v 1. scénáři těsně po jeho spuštění při vytížení stroje;
relay scénáře 2, 4, 5 prošly). Živě (testovací projekt): Worker vrací TURN údaje schválené zakladatelce
(200, TURN UDP+TCP), cizí skupině 403, bez tokenu 401. WebKit v tomto prostředí není.

## Co bez telefonů ověřit nejde
Skutečný přenos přes ExpressTURN (prostředí testů propouští jen HTTP(S) – TCP/UDP 3478 neprojde), mobilní sítě
a operátoři, iOS Safari/WebKit, chování telefonu na pozadí. Proto doporučený test v NÁHLEDU 1.3.0
(`/band-app-preview-1p/`, testovací projekt, oddělená data) na obou telefonech PŘED vydáním.
