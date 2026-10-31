# BAND APP – TURN worker (Cloudflare Workers Free, bez platební karty)

Malá služba, která **jen schváleným a nezablokovaným členkám** skupiny vydá adresy TURN serveru
s přihlašovacími údaji. Údaje jsou uložené **jen jako tajemství Workeru v Cloudflare** – nikdy
v aplikaci, nikdy v tomto (veřejném) repozitáři.

## Jak ověřuje
1. `Authorization: Bearer <Firebase ID token>` – podpis RS256 proti veřejným klíčům Google, `aud`/`iss` = `FIREBASE_PROJECT_ID`, `exp`, `iat`.
   Token z jiného projektu (např. produkční token na testovací worker) je odmítnut.
2. `?room=<id skupiny>` – worker se tokenem **uživatelky** zeptá Firestore na seznam členek; pravidla
   (`allow list: if isApproved(roomId)`) to povolí jen schválené/zakladatelce, která **není zablokovaná**.
   Worker proto nepotřebuje žádný servisní účet Firebase.
3. CORS jen `https://holub5305-dotcom.github.io` (BAND APP i náhled `/band-app-preview-1p/` mají stejný origin).
4. Limit žádostí na uid (`RATE_PER_10MIN`, výchozí 30 / 10 min; v paměti instance, případně vazba `RL`).
5. Odpovědi `cache-control: no-store`; žádné logy (observability vypnuta, žádné `console.*`); chyby nikdy neobsahují údaje.

## Režimy
| TURN_MODE | Tajemství | Poznámka |
|---|---|---|
| `static` (výchozí) | `TURN_USERNAME`, `TURN_PASSWORD` | ExpressTURN Free – `free.expressturn.com:3478` UDP/TCP (bez TLS/443). |
| `cloudflare` | `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` | Cloudflare Realtime TURN – vyžaduje platební metodu, **nepoužívat bez souhlasu**. |

Bez tajemství vrací `/ice` chybu **503 `not_configured`** a `GET /health` ukazuje `"configured": false`.

## API
- `GET /health` → `{ ok, service, mode, configured, project }` (bez přihlášení, bez údajů)
- `GET /ice?room=<id>` + `Authorization: Bearer <ID token>` → `{ iceServers, ttl, mode }`
- Chyby: 401 `auth`, 403 `member`/`origin`, 429 `rate`, 503 `not_configured`, 502 `turn_upstream`

## Testy
`node test-worker.mjs ./worker.js` – 32 kontrol bez sítě (oba režimy, odmítnutí cizích/neschválených/zablokovaných, únik tajemství).

## Nasazení (jen test)
Testovací worker `bandapp-turn-test` (projekt `band-app-test-9fc3e`). Tajemství zadává **jen Vladimír** v Cloudflare Dashboardu
(Workers & Pages → bandapp-turn-test → Settings → Variables and Secrets → Add → Type: Secret) nebo `npx wrangler secret put`.
Při dalším nahrání kódu přes API se posílá `keep_bindings: ["secret_text"]`, aby se tajemství nesmazala.
Produkční worker je samostatný: `bandapp-turn-prod` (`wrangler.prod.toml`, projekt `band-app-7c9ca`, vlastní tajemství zadaná majitelem) – nasazuje se až po souhlasu, viz docs/VYDANI-1.3.0.md.
