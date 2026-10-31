# BAND APP 1.2.4 – převod členství i ze starého záznamu

**Příčina (hlášení 31. 10. 2026 11:45):** v 1.2.3 se „Převést členství“ ukazovalo jen u ČEKAJÍCÍ žádosti
(nebo u dvojice se stejnou přezdívkou). Nainstalovaná aplikace (7DFE2E) žádnou žádost neposlala – přihlášený účet
bez skupiny neměl kam vložit pozvánku a klepnutí na odkaz na iPhonu otevře Safari (starý účet BD619B → „už jsi členem“).
Proto u schváleného „Táty“ bylo jen Chat / Odebrat / Blokovat / Předat vlastnictví.

**Změny (jen friends.js + verze, pravidla BEZE ZMĚNY):**
- Zakladatelka: u každého schváleného člena (ne sebe) „🔁 Převést na nový účet…“ – seznam čekajících žádostí s kódy
  účtu, opsání kódu z telefonu, potvrzení. Bez žádosti český návod. Volá stejné `transferMember` jako 1.2.3
  (starý záznam → „převedeno“, nic se nemaže, zprávy zůstanou).
- Účet bez skupiny (nainstalovaná aplikace): pole „📩 Mám pozvánku / nový účet – požádat o převod“ (vložit odkaz).
- Pozvánka: kód účtu tohoto telefonu + tlačítko „🔁 Mám nový účet – požádat o převod“ (běžná žádost + návod).
- SW band-app-pages-15, patička 1.2.4. Návrat na 1.1.3: band-app-pages-16.

**Testy:** tests/browser/transfer_old.py (37/37, přesný scénář; stav z 1.2.3 → aktualizace → převod), plus všechny
dosavadní sady. Headless + emulátor, ne skutečné telefony.
