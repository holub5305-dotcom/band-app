/* BAND APP 1.2.0 (TEST) – nastavení spojení VIDEOCHATU (WebRTC). Tyto údaje NEJSOU tajné.
 *
 * STUN = veřejný bezplatný server Google. Jen pomůže telefonu zjistit vlastní veřejnou adresu;
 *        obraz ani zvuk přes něj NEJDE. Nic se neukládá.
 * TURN = přenosový server pro sítě, kde přímé spojení nejde (část mobilních operátorů, firemní/školní Wi-Fi).
 *        ZATÍM ŽÁDNÝ – vyžaduje schválení (placená nebo vlastní služba). Bez TURN se některé hovory nemusí spojit.
 *        Přes TURN jde obraz a zvuk dál šifrovaně (DTLS-SRTP) – provozovatel TURN ho nevidí ani neslyší.
 *        NIKDY sem nevkládej trvalé uživatelské jméno a heslo TURN: soubor je veřejný. Správně jsou krátkodobé
 *        údaje (platné cca 1 h), které vydá malá služba – viz TURN_CREDENTIALS_URL.
 */
export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
];
/* Budoucí rozšíření (po schválení): adresa služby, která přihlášené člence vrátí JSON { iceServers: [...] }
 * s krátkodobými TURN údaji. Prázdné = TURN vypnutý. */
export const TURN_CREDENTIALS_URL = '';
/* Skupinový hovor = přímé propojení každé s každou (mesh). Nad 4 účastnice by telefony a mobilní data nestačily
 * (pravidla Firestore víc než 4 nepustí). Pro větší skupiny by byl potřeba server SFU – jen po schválení. */
export const MAX_PARTICIPANTS = 4;
