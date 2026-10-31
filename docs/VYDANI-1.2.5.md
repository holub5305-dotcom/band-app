# BAND APP 1.2.5 – hovory zvoní i na stránce pozvánky, poctivé „Vyzvání…“, kód účtu u kontaktů

**Hlášení 31. 10. 2026:** 7DFE2E je schválený v Laurinčině skupině, vidí staré zprávy, ale videohovor zůstane na
„Připojuji…“. Diagnostika: Firebase připojeno, 1 schválená skupina, naslouchání AKTIVNÍ, 0 příchozích.

**Skutečná příčina (reprodukováno, tests/browser/join_page_calls.py, EXPECT=bug proti stromu 1.2.4):**
návod 1.2.4 vede nainstalovanou aplikaci k vložení pozvánky „Otevřít pozvánku tady“ → aplikace přejde na
`join.html`. Po převodu/schválení se `join.html` sám změní na chat skupiny se STARÝMI zprávami – ale tahle stránka
v 1.2.4 nenačítá `videochat.js`, takže na ní NIKDO neposlouchá příchozí hovory a z ní nevede cesta zpět do aplikace.
Volající pak vidí „Videohovor · vyzvání…“ a dlaždici s textem „Připojuji…“ (CSS ukazovalo „Připojuji…“ i během
vyzvánění), po 45 s „Nikdo to nevzal.“ WebRTC/ICE se vůbec nespustí – nejde o síť, TURN ani pravidla
(založení hovoru i zápis účastnice pravidly prošly, jinak by se obrazovka hovoru neotevřela).

Druhá nalezená chyba: limit „Spojení se nepodařilo – zkuste Wi-Fi.“ (20 s / 50 s) hlídal jen existující spojení.
Přijímající strana, ke které nabídka spojení vůbec nedorazila, mohla „připojovat“ donekonečna.

Starý účet BD619B (status „převedeno“) příčinou není: VIDEOCHAT ho nenabízí a pravidla hovor na něj odmítnou (test).

**Změny (pravidla Firestore BEZE ZMĚNY, manifest a ikona beze změny):**
- `join.html` načítá `videochat.js`; `initVideochat` bez sekce VIDEOCHAT jen naslouchá (příchozí hovor a obrazovka
  hovoru se ukážou i na stránce pozvánky). Žádné nové ani tiché účty – start je stejný jako v aplikaci.
- Schválená stránka pozvánky: tlačítko „📱 Otevřít BAND APP (Kamarádky a VIDEOCHAT)“ (bez automatického přesměrování).
- Dlaždice volané: „Vyzvání…“ dokud hovor nepřijme, „Připojuji…“ až po přijetí.
- Kód účtu u každého kontaktu ve VIDEOCHATu, v záhlaví hovoru a v přehledu účastnic; konec vyzvánění:
  „Nikdo to nevzal. Hovor zazvoní jen na telefonu, kde je přihlášený účet XXXXXX a BAND APP je otevřená.“
- Limit „Spojení se nepodařilo“ platí pro každou připojenou účastnici, i bez nabídky spojení (obě strany skončí).
- Diagnostika (jen v telefonu): Stránka, Poslední odchozí hovor, Poslední příchozí hovor (kód, fáze, výsledek).
- SW band-app-pages-17, patička 1.2.5. Návrat na 1.1.3 (větev navrat-1-1-3): band-app-pages-18.

**Testy (headless Chromium/WebKit/Firefox + Firebase emulátor, NE skutečné telefony):** join_page_calls.py
(reprodukce na 1.2.4 + oprava na 1.2.5: Laurinka → Táta na join.html, Táta → Laurinka, „Táta test 2“ se zavřeným
zařízením, převedený starý účet), vc_calls.py (+ nová sada „nabídka nedorazí“), všechny dosavadní sady.
