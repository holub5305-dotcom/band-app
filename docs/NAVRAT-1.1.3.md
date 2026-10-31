# NÁVRAT na BAND APP 1.1.3 (jen v nouzi, jen se souhlasem)

Tato větev vrací **soubory aplikace** na 1.1.3 (commit d027083) a zvyšuje mezipaměť na `band-app-pages-16`,
(Po vydání 1.2.4 / pages-15 je návrat na `band-app-pages-16`.)
aby si telefony návrat stáhly jako běžnou aktualizaci. Data se NEMAŽOU: localStorage, nahrávky (IndexedDB),
přihlášení, skupiny a zprávy zůstávají (ověřeno testem `tests/browser/upgrade_rollback.py`).

- Odebráno: `videochat.js`, `rtc-config.js`; `index.html` a `sw.js` = 1.1.3 (+ pages-16).
- Ponecháno: `firestore.rules` (odpovídá živým pravidlům po vydání 1.2.3 – blok hovorů a větve převodu členství
  mohou v Firebase zůstat; 1.1.3 je nepoužívá. Převedený starý účet zůstane bez přístupu i v 1.1.3), `docs/`, `tests/`, `_tools/`.
- Použití: PR `navrat-1-1-3` → `main`, sloučit. Pravidla Firebase není třeba měnit.
