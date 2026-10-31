# BAND APP – volitelný TURN (Cloudflare Realtime, bezplatný tarif)

**Výchozí stav: TURN je VYPNUTÝ.** BAND APP 1.2.0 funguje jen se STUN. Většina hovorů na Wi-Fi se spojí;
na některých mobilních sítích nebo školních/firemních Wi-Fi se přímé spojení nenaváže a aplikace po 20 s
ukáže „Spojení se nepodařilo – zkuste Wi-Fi.“ (1:1 hovor po 50 s skončí se stejnou hláškou).

Tato složka (začíná podtržítkem, takže ji GitHub Pages **nezveřejňuje**) obsahuje hotovou malou službu, která
přihlášené **schválené** člence vydá TURN údaje platné jen 4 h. Nic neukládá ani neloguje; obraz a zvuk
jdou dál šifrovaně (DTLS-SRTP) – Cloudflare je nevidí ani neslyší.

## Cena
- Cloudflare Workers Free: 100 000 požadavků/den zdarma (BAND APP pošle ~1 požadavek na hovor).
- Cloudflare Realtime TURN: prvních **1 000 GB/měsíc zdarma**, potom 0,05 USD/GB. Hovor 1:1 přes TURN
  spotřebuje cca 0,3–0,5 GB/h, takže rodinné použití se do limitu vejde s velkou rezervou.
  TURN se použije jen tam, kde přímé spojení nejde.
- Pokud Cloudflare při zapnutí Realtime požádá o platební kartu, **zastav se a rozhodni** – bez karty a
  bez schválení nic nezapínej.

## Postup (jen po schválení, ~15 minut)
1. Účet Cloudflare (zdarma): https://dash.cloudflare.com/sign-up
2. Dashboard → **Realtime** → **TURN Server** → *Create* → pojmenuj „bandapp“. Zobrazí se
   **Turn Token ID** a **API Token** – API token se ukáže jen jednou, ulož si ho (správce hesel).
3. Na počítači s Node.js:
   ```
   cd _tools/turn-worker
   npx wrangler login
   npx wrangler secret put TURN_KEY_ID          # vlož Turn Token ID
   npx wrangler secret put TURN_KEY_API_TOKEN   # vlož API Token
   npx wrangler deploy
   ```
   Wrangler vypíše adresu, např. `https://bandapp-turn.<účet>.workers.dev`.
4. Zkouška (musí vrátit 401 – bez přihlášení nic nedostaneš):
   `curl -i https://bandapp-turn.<účet>.workers.dev/ice`
5. Nejdřív v **testovacím náhledu**: v `rtc-config.js` náhledu nastav
   `TURN_CREDENTIALS_URL = 'https://bandapp-turn.<účet>.workers.dev/ice'` a vyzkoušej hovor na mobilních datech.
6. Pro produkci změň ve `wrangler.toml` `FIREBASE_PROJECT_ID = "band-app-7c9ca"`, znovu `npx wrangler deploy`
   (nebo nasaď druhý Worker), a stejnou adresu vlož do `rtc-config.js` v produkční větvi (běžná aktualizace
   aplikace; SW cache je třeba zvýšit o 1).

## Bezpečnost
- Údaje dostane jen držitelka platného Firebase ID tokenu daného projektu, která je ve skupině `room`
  schválená a nezablokovaná (ověřuje přímo Firestore svými pravidly).
- CORS jen pro `https://holub5305-dotcom.github.io`.
- Údaje vyprší po `TTL_SECONDS` (4 h). Odebrání TURN klíče v Cloudflare vše okamžitě zneplatní.
- Vypnutí: `TURN_CREDENTIALS_URL = ''` v `rtc-config.js` (aplikace se vrátí ke STUN) nebo `npx wrangler delete`.
