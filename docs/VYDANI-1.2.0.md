# BAND APP 1.2.0 (VIDEOCHAT) – vydání jako přímá aktualizace 1.1.3

**Stav: připraveno, NENASAZENO.** PR #6 není sloučený, pravidla produkce (band-app-7c9ca) nejsou změněná.
Nasazení jen po výslovném schválení vlastníka.

## Co se aktualizuje
- Stejná adresa `https://holub5305-dotcom.github.io/band-app/`, stejný manifest (`id "./"`, `start_url "./index.html"`,
  `scope "./"`, název, ikony – soubor `manifest.webmanifest` je beze změny proti 1.1.3).
- Service worker: `band-app-pages-10` → `band-app-pages-11`. Maže jen vlastní staré mezipaměti `band-app-pages-*`;
  localStorage, nahrávky (IndexedDB), přihlášení Firebase ani jiné weby na doméně nemaže.
- Nainstalovaná BAND APP se aktualizuje sama (při dalším otevření s internetem). Nic se neodinstalovává, nic se nepřeinstalovává.

## Pořadí vydání (každý krok jen se souhlasem)
1. **Pravidla do produkce** (staré klienty 1.1.3 to neovlivní – přibývá jen blok `/rooms/{id}/calls`, ostatní je beze změny):
   ```
   cd band-app            # větev band-app-1-2-0-videochat
   npx firebase-tools deploy --only firestore:rules --project band-app-7c9ca
   ```
   Ověření: Firebase konzole → Firestore → Pravidla → obsahuje `match /calls/{callId}`.
2. **Sloučit PR #6** do `main` (GitHub Pages zveřejní během ~1–2 min).
3. **Ověřit Pages**: `https://holub5305-dotcom.github.io/band-app/sw.js` obsahuje `CACHE=PREFIX+'11'`,
   `/band-app/videochat.js` vrací 200; na telefonu otevřít BAND APP (s internetem), zavřít a znovu otevřít →
   v patičce „BAND APP 1.2.0“ a v menu VIDEOCHAT; Kamarádky, nahrávky a lekce na místě.

Proč v tomto pořadí: 1.2.0 bez nových pravidel by hovory nemohla založit (server by je odmítl); 1.1.3 s novými
pravidly funguje beze změny (ověřeno testem `tests/prod-compat.test.mjs`: 266 kombinací operace × uživatelka,
výsledky main vs. 1.2.0 identické).

## Návrat na 1.1.3 (rollback) bez ztráty dat
- Záloha: tag `v1.1.3` a větev `zaloha-main-1-1-3` (= commit d027083, produkce 1.1.3).
- Připravená větev `navrat-1-1-3`: soubory aplikace z 1.1.3, SW `band-app-pages-12` (vyšší číslo → telefony si
  návrat stáhnou jako běžnou aktualizaci). Data (localStorage, nahrávky, skupiny, zprávy) zůstanou – ověřeno testem
  1.1.3 → 1.2.0 → návrat.
- Postup: otevřít PR `navrat-1-1-3` → `main` a sloučit. Nic dalšího.
- Pravidla pro hovory **mohou v produkci zůstat** – 1.1.3 je nepoužívá a ostatní kolekce nemění. Kdyby je přesto
  bylo třeba vrátit: `docs/rules-backup-7c9ca-1.1.3.rules` (přesná kopie živých pravidel 7c9ca přečtená 31. 10. 2026,
  sha256 b76b04c9…, shodná s `firestore.rules` v 1.1.3) nasadit stejným příkazem jako v kroku 1.

## TURN
Výchozí stav bez TURN (jen STUN). Když se spojení nenaváže, aplikace po 20 s ukáže „Spojení se nepodařilo –
zkuste Wi-Fi.“ a 1:1 hovor po 50 s ukončí. Volitelné zapnutí zdarma: `_tools/turn-worker/README.md`.

## Testy (automatické, NE skutečné telefony) – výsledky 31. 10. 2026
- Pravidla (emulátor, `tests/*.test.mjs`): 73 stávajících (projdou na main i na 1.2.0) + 36 hovorů + 39 kompatibilita
  s produkčními daty (266 kombinací shodných) – vše PASS.
- Prohlížeč Chromium headless, falešná kamera/mikrofon, emulátor: `tests/browser/vc_calls.py` 42/42.
- Aktualizace 1.1.3 → 1.2.0 → návrat na stejné adrese se zachováním dat: `tests/browser/upgrade_rollback.py` 50/50.
- ENGINE test jader WebKit 26.6 a Firefox 155 (headless, ne skutečné Safari/iPhone/Android): `tests/browser/engines.py` 29/29.
- Služba TURN: `node _tools/turn-worker/test-worker.mjs $PWD/_tools/turn-worker/worker.js` 13/13.
