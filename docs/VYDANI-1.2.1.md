# BAND APP 1.2.1 – oprava příchozích hovorů

Aktualizace na místě (stejná adresa, ikonka, manifest i data). Mezipaměť `band-app-pages-12` (maže jen `band-app-pages-*`).
Návrat na 1.1.3 po 1.2.1: větev `navrat-1-1-3` s `band-app-pages-13`.

## Příčina
VIDEOCHAT začal naslouchat příchozím hovorům jen jednou, při spuštění aplikace, a jen ve skupinách,
které měl telefon v paměti uložené jako „schválené“. Kdo byl pozvaný, měl v telefonu uloženo „čeká na schválení“
a po schválení se tento údaj sám neaktualizoval – telefon proto hovory vůbec neposlouchal (a chyby se nikde neukazovaly).
Stejně tak volající, která skupinu založila až po otevření aplikace.

## Oprava (jen `videochat.js`, `sw.js`, `index.html`; pravidla Firestore beze změny)
- Naslouchání běží v celé aplikaci (v každé sekci) a řídí se stavem členství na serveru (vlastní dokument člena),
  ne zastaralým údajem v telefonu. Po schválení se spustí samo, bez restartu.
- Kontrola a obnova každých 15 s a při návratu do aplikace, změně sekce, připojení k internetu; chyby se zaznamenají.
- Tolerance posunutých hodin telefonu (nový hovor zazvoní i při odchylce hodin).
- Service worker: soubory aplikace se vždy ověří u serveru (`no-cache`), offline mezipaměť se plní čerstvými soubory.
- „🛠 Diagnostika hovorů“ dole v sekci VIDEOCHAT (rozbalit klepnutím): verze, mezipaměť, stav naslouchání,
  poslední chyba (jen kód), počet čekajících hovorů. Žádná jména, e-maily, uid ani obsah zpráv; nic se neodesílá.

## Testy (emulátor + headless prohlížeče, ne skutečné telefony)
`tests/browser/real_flow.py` – skutečný průběh přes UI (založení skupiny, pozvánka, join.html, schválení bez obnovení,
příjemce v jiné sekci, druhá skupina, posunuté hodiny). Na 1.2.0 selže (reprodukce chyby), na 1.2.1 projde.
