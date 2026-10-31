# NÁVRAT na BAND APP 1.1.3 (jen v nouzi, jen se souhlasem)

Tato větev vrací **soubory aplikace** na 1.1.3 (commit d027083) a zvyšuje mezipaměť na `band-app-pages-12`,
aby si telefony návrat stáhly jako běžnou aktualizaci. Data se NEMAŽOU: localStorage, nahrávky (IndexedDB),
přihlášení, skupiny a zprávy zůstávají (ověřeno testem `tests/browser/upgrade_rollback.py`).

- Odebráno: `videochat.js`, `rtc-config.js`; `index.html` a `sw.js` = 1.1.3 (+ pages-12).
- Ponecháno: `firestore.rules` (odpovídá živým pravidlům po vydání 1.2.0 – blok hovorů může v Firebase zůstat,
  1.1.3 ho nepoužívá a ostatní kolekce nemění), `docs/`, `tests/`, `_tools/`.
- Použití: PR `navrat-1-1-3` → `main`, sloučit. Pravidla Firebase není třeba měnit.
