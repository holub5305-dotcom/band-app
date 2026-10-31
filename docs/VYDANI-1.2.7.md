# BAND APP 1.2.7 – diagnostika spojení WebRTC (obraz, zvuk, ICE, kandidáti, přehrávání)

**Hlášení 31. 10. 2026 (1.2.6, skutečné telefony):** Firebase připojeno, účet 7DFE2E funguje, příchozí videohovor jde
přijmout. Po přijetí se Tátovi zapne kamera, ale Laurinka (12E970) ho vůbec nevidí ani neslyší. Není známo, jestli
Táta vidí/slyší ji, ani na jakých sítích telefony byly (Wi-Fi / mobilní data).

## Co jsme prověřili (bez oprav naslepo)
Audit kódu `videochat.js` (1.2.6) + pokusy v emulátoru:
- **Výměna SDP:** nabízí vždy účastnice s nižším uid (žádná kolize nabídek); odpovídající strana `setRemoteDescription(offer)`
  → přidá své stopy do transceiverů z nabídky (`sendrecv` + `replaceTrack`) → `createAnswer` → `setLocalDescription`;
  odpověď se zapíše a nabízející ji použije jen ve stavu `have-local-offer` se stejným `sid`. Pořadí je správné.
- **Stopy:** kamera a mikrofon se zapnou PŘED vyjednáním (při přijetí hovoru), takže odpověď stopy obsahuje
  (ověřeno: odchozí bajty a snímky rostou u volající i volané).
- **ICE kandidáti:** bez „trickle“ – kandidáti jsou přímo v SDP (sběr max. 3 s), takže nemohou přijít „před
  vzdáleným popisem“. Pravidla Firestore volané zápis odpovědi povolují: **živá produkční pravidla band-app-7c9ca
  (přečtena 31. 10., jen čtení) jsou totožná s `firestore.rules`** v repozitáři, se kterými testy běží.
- **Přehrávání:** vzdálené `<video>` (playsinline, autoplay, ne ztlumené) – při odmítnutí `play()` se ukáže tlačítko.
- **Reprodukce:** nový test `tests/browser/media_2way.py` – DVA samostatné procesy Chromium, falešná kamera
  a mikrofon, BEZ úlevy pro automatické přehrávání. Na kódu **1.2.6 (EXPECT=bug, strom produkce) 13/13 PASS**:
  obraz (framesDecoded roste, videoWidth>0, video hraje) i zvuk (bytesReceived a totalSamplesReceived rostou)
  přichází **oběma směry**, pro volající i volanou, pro obě pořadí nabízející/odpovídající.

**Závěr:** v kódu se chyba přenosu médií NEPROKÁZALA. Když spojení vznikne, obraz i zvuk tečou oběma směry.
Nejpravděpodobnější příčina na skutečných telefonech je síť: aplikace má jen STUN (bez TURN). Pokud je aspoň
jeden telefon na mobilních datech (CGNAT/symetrický NAT, často IPv6/IPv4 mix) nebo Wi-Fi bez „hairpinu“,
ICE spojení nevznikne → **žádný obraz ani zvuk oběma směry**, zatímco místní kamera svítí. To ale bez nové
diagnostiky z telefonů nejde dokázat – proto 1.2.7 přináší diagnostiku, ne slepou opravu.

## Změny (pravidla Firestore, manifest a ikona BEZE ZMĚNY; účty a data nedotčené)
- **🛠 Diagnostika spojení během hovoru** (tlačítko 🛠 nahoře na obrazovce hovoru), pro každou kamarádku:
  verdikt česky, Signalizace (signalingState + kdo nabízí), Sběr kandidátů, ICE, Spojení (connectionState),
  Kandidáti – jen TYPY (host/srflx/relay) místní i od kamarádky, Vybraná cesta (např. host ↔ srflx),
  Přichází obraz (ano/ne, snímky, kB, stav stopy), Přichází zvuk, Odchází obraz/zvuk, Přehrávání (hraje /
  zablokováno – klepni / čeká na data), chyba signalizace; Můj telefon: TURN ano/ne, Kamera a Mikrofon
  (oprávnění + stav stopy), Internet. **Žádné IP adresy, uid ani obsah hovoru.** Nic se nikam neposílá.
- **Verdikty:** „✅ Spojeno – přenos běží oběma směry“, „❌ Spojení se nepodařilo navázat (ICE selhalo) – pravděpodobně
  mobilní síť bez TURN serveru…“, „⚠️ Obraz přichází, ale přehrávání je zablokováno – klepni na ▶️“,
  „⚠️ Spojeno, ale nepřichází zvuk/obraz / neodchází můj obraz…“, „⚠️ Nabídka spojení nedorazila (signalizace)“.
- **Diagnostika hovorů** v sekci VIDEOCHAT: nové řádky „TURN server“, „Probíhající hovor – média“ a
  **„Poslední hovor – média“** (souhrn po skončení hovoru: ICE, cesta, kandidáti, přijaté snímky/zvuk, odeslané kB,
  přehrávání, verdikt).
- Hláška po 20 s bez spojení (a konec 1:1 po 50 s) rozlišuje: nabídka dorazila, ale ICE selhalo → „Spojení se nepodařilo
  navázat (ICE selhalo) – pravděpodobně mobilní síť bez TURN serveru. Zkuste obě stejnou Wi-Fi.“; nabídka nedorazila →
  dosavadní „Spojení se nepodařilo – zkuste Wi-Fi.“
- Chyby při zpracování nabídky/odpovědi se už nespolknou – jsou vidět v diagnostice.
- Zablokované přehrávání: tlačítko „▶️ Klepni pro spuštění obrazu a zvuku“ (spustí všechna pozastavená videa; když
  se to nepovede, napíše proč). Tlačítko i hlášky jsou nad panelem diagnostiky.
- TURN: aplikace ho dál umí (`rtc-config.js` – `TURN_CREDENTIALS_URL` nebo `STATIC_TURN_SERVERS`), **zůstává vypnutý**;
  diagnostika ukáže, jestli se TURN údaje načetly.
- SW band-app-pages-21, patička 1.2.7. Návrat na 1.1.3 (větev navrat-1-1-3): band-app-pages-22.

## TURN (jen informace – nic se nezakládá ani neplatí)
Cloudflare Realtime TURN: prvních 1 000 GB/měsíc zdarma (sdíleno s Realtime SFU), pak 0,05 USD/GB; hovor 1:1 přes TURN
cca 0,3–0,5 GB/h. Hotová služba je v `_tools/turn-worker/` (vydá krátkodobé údaje jen schválené člence). Postup
v `_tools/turn-worker/README.md` – vyžaduje účet Cloudflare (založí si ho uživatel sám) a jeho schválení.

## Testy (headless Chromium/Firefox + Firebase emulátor, NE skutečné telefony ani mobilní sítě)
media_2way.py (bug na 1.2.6: 13/13; fixed: obousměrný přenos v obou rolích + diagnostika během hovoru, souhrn
posledního hovoru, zablokované přehrávání → tlačítko, simulované selhání ICE → jasná hláška a „kandidáti místní 0“)
+ všechny dosavadní sady (pravidla, upgrade 1.1.3/1.2.6 → 1.2.7 a návrat, přihlášení, obnova, hovory, Firefox).
