/* BAND APP 1.2.0 – nastavení spojení VIDEOCHATU (WebRTC). Tento soubor je VEŘEJNÝ – nepatří sem žádná tajemství.
 *
 * STUN = veřejný bezplatný server Google. Jen pomůže telefonu zjistit vlastní veřejnou adresu;
 *        obraz ani zvuk přes něj NEJDE. Nic se neukládá.
 * TURN = přenosový server pro sítě, kde přímé spojení nejde (část mobilních operátorů, firemní/školní Wi-Fi).
 *        VÝCHOZÍ STAV: ŽÁDNÝ TURN. Aplikace funguje jen se STUN; když se spojení nenaváže,
 * *        ukáže „Spojení se nepodařilo navázat (ICE selhalo) – pravděpodobně mobilní síť bez TURN serveru…“ (1.2.7).
 *        Přes TURN jde obraz a zvuk dál šifrovaně (DTLS-SRTP) – provozovatel TURN ho nevidí ani neslyší.
 *
 * Volitelné zapnutí TURN (jen po schválení, viz _tools/turn-worker/README.md):
 *   TURN_CREDENTIALS_URL – adresa malé služby (Cloudflare Worker), která PŘIHLÁŠENÉ člence vrátí
 *                          JSON { iceServers: [...] } s KRÁTKODOBÝMI TURN údaji (platné cca 1 h).
 *                          Při chybě/nedostupnosti služby se hovor zkusí bez TURN (jen STUN).
 *   STATIC_TURN_SERVERS  – pevné záznamy iceServers (např. vlastní server). NIKDY sem nevkládej trvalé
 *                          jméno a heslo k placenému účtu – soubor si může přečíst kdokoli.
 */
export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
];
export const STATIC_TURN_SERVERS = [];
export const TURN_CREDENTIALS_URL = '';   // např. 'https://bandapp-turn.<účet>.workers.dev/ice'
/* Skupinový hovor = přímé propojení každé s každou (mesh). Nad 4 účastnice by telefony a mobilní data nestačily
 * (pravidla Firestore víc než 4 nepustí). Pro větší skupiny by byl potřeba server SFU – jen po schválení. */
export const MAX_PARTICIPANTS = 4;
