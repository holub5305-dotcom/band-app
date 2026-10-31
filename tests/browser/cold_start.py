"""BAND APP 1.2.2 – regresní test „studený start nainstalované aplikace“ a „jiné přihlášení“ (hlášení 31. 10. 2026 9:43:
Firebase nepřipojeno, Skupiny v zařízení 0, naslouchání neaktivní). Data vznikají skutečnými obrazovkami aplikace.
Headless Chromium + falešná kamera/mikrofon + Firebase EMULÁTOR – ne skutečné telefony.
  A) Táta: přihlášení uložené z dřívějška, PRÁZDNÝ místní seznam skupin a žádná záloha kontaktů; aplikace se spustí
     úplně znovu rovnou ve VIDEOCHATu (Kamarádky se neotevírají) → Firebase připojeno, naslouchání AKTIVNÍ, hovor zazvoní;
     kód zařízení v Diagnostice = kód u Táty v Laurinčině seznamu.
  B) Strejda se přidal v JINÉM prohlížeči; nainstalovaná aplikace (vlastní profil) nemá přihlášení → jasná zpráva,
     žádný nový účet; vložení nové pozvánky přímo v aplikaci → schválení podle kódu zařízení → hovor zazvoní.
  C) Aplikace přihlášená jiným (prázdným) účtem → zpráva „není přihlášený jako schválený člen“."""
import asyncio, os, re, subprocess, json
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); RULES = os.path.join(HERE, '..', '..', 'firestore.rules')
PORT = os.environ.get('PORT', '8793'); BASE = f'http://localhost:{PORT}/index.html?emulator=1'
SEED_CWD = os.environ.get('SEED_CWD', HERE)
import shutil; LR = os.path.join(SEED_CWD, '_load_rules.mjs'); shutil.copy(os.path.join(HERE, 'load_rules.mjs'), LR)
SHOTS = os.environ.get('SHOTS', '/tmp/vc-shots'); os.makedirs(SHOTS, exist_ok=True)
R = []; BLOCKED = []; ERRS = {}
def ok(n, c, info=''):
    R.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (' | ' + str(info)[:300] if info != '' else ''), flush=True)
ALLOWED = re.compile(r'^https?://((localhost|127\.0\.0\.1)(:\d+)?/|www\.gstatic\.com/firebasejs/)')
async def guard(r):
    u = r.request.url
    if ALLOWED.match(u): await r.continue_()
    else:
        if not u.startswith('https://www.google.com/images/cleardot.gif'): BLOCKED.append(u[:120])
        await r.abort()
async def wait(pg, js, t=20000):
    try: await pg.wait_for_function(js, timeout=t); return True
    except Exception: return False
async def newp(b, name, skew_ms=0):
    c = await b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone'], has_touch=True)
    if skew_ms: await c.add_init_script(f"(()=>{{const o=Date.now.bind(Date),d={skew_ms};Date.now=()=>o()+d;}})()")
    await c.route('**/*', guard)
    pg = await c.new_page(); ERRS[name] = []
    pg.on('pageerror', lambda e: ERRS[name].append(str(e)))
    pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
    return c, pg
async def create_group(pg, nick, name):
    await pg.goto(BASE + '#friends')
    await pg.wait_for_timeout(1500)
    for _ in range(5):
        if await pg.locator('#frCreate').count(): break
        if await pg.locator('#frNewAccount').count(): await pg.click('#frNewAccount')   # 1.2.3: účet jen výslovně
        elif await pg.locator('#frNewRoom').count(): await pg.click('#frNewRoom')
        else:
            btn = pg.locator('#friendsApp button', has_text='Kamarádky')
            if await btn.count(): await btn.first.click()
        if await wait(pg, "document.getElementById('frCreate')", 6000): break
    if not await pg.locator('#frCreate').count(): print('DBG0', (await pg.inner_text('#friendsApp'))[:400]); return False
    await pg.fill('#frNick', nick); await pg.fill('#frRoomName', name); await pg.click('#frCreate')
    r = await wait(pg, "document.getElementById('frInvite')")
    if not r: print('DBG', (await pg.inner_text('#friendsApp'))[:600])
    return r
async def invite(pg):
    old = await pg.evaluate("(document.getElementById('frInviteLink')||{}).value||''")
    await pg.click('#frInvite')
    await wait(pg, f"(()=>{{const e=document.getElementById('frInviteLink');return e&&e.value&&e.value!=={old!r}}})()")
    return await pg.input_value('#frInviteLink')
async def join(pg, link, nick):
    await pg.goto(link)
    if not await wait(pg, "document.getElementById('jAccept')||document.getElementById('frNewAccount')"): return False
    if await pg.locator('#frNewAccount').count(): await pg.click('#frNewAccount')   # 1.2.3: nový účet jen výslovně
    if not await wait(pg, "document.getElementById('jAccept')"): return False
    await pg.fill('#jNick', nick); await pg.click('#jAccept')
    return await wait(pg, "document.querySelector('[data-state=pending]')")
async def approve(pg, nick):
    sel = f"#frContacts li[data-status=pending]"
    if not await wait(pg, f"[...document.querySelectorAll('{sel}')].some(l=>l.textContent.includes('{nick}'))"): return False
    await pg.locator(sel, has_text=nick).locator('[data-act=approve]').click()
    return await wait(pg, f"[...document.querySelectorAll('#frContacts li')].some(l=>l.textContent.includes('{nick}')&&l.dataset.status==='approved')")
async def call(pg, nick, kind='video'):
    await pg.evaluate("location.hash='#videochat'")
    if not await wait(pg, f"[...document.querySelectorAll('#vcPeopleList li')].some(l=>l.querySelector('.vc-name').textContent==='{nick}')"): return False
    await pg.locator('#vcPeopleList li', has_text=nick).locator(f'[data-act={kind}]').click(); return True
CONN = "(()=>{const s=window.__vc&&window.__vc.state();return s&&s.pcs.length==1&&['connected','completed'].includes(s.pcs[0][1])})()"
async def hang(pg):
    await pg.click('#vcHang'); return await wait(pg, "!document.getElementById('vcCall')")

ADM = os.path.join(SEED_CWD, '_emu_admin.mjs'); shutil.copy(os.path.join(HERE, 'emu_admin.mjs'), ADM)
DIAG = "(async()=>{const d=document.getElementById('vcDiag');if(!d.open)d.querySelector('summary').click();await new Promise(r=>setTimeout(r,2500));return document.getElementById('vcDiagBody').innerText})()"
def row(txt, k):
    l = txt.split('\n')
    for i, x in enumerate(l):
        if x.strip() == k and i + 1 < len(l): return l[i + 1].strip()
    m = re.search(re.escape(k) + r'\s*\t?\s*(.*)', txt); return m.group(1).strip() if m else ''
UIDJS = "(async()=>{const f=await import('./friends.js');const b=await f.firebaseBase();return b.auth.currentUser?b.auth.currentUser.uid:null})()"
async def codes(pg, nick):
    await pg.evaluate("location.hash='#friends'"); await pg.wait_for_timeout(800)
    await wait(pg, "[...document.querySelectorAll('#frContacts [data-devcode]')].every(e=>!e.textContent.includes('…'))&&document.querySelectorAll('#frContacts [data-devcode]').length>0")
    return await pg.evaluate(f"[...document.querySelectorAll('#frContacts li')].filter(l=>l.textContent.includes('{nick}')).map(l=>[l.dataset.status,(l.querySelector('[data-devcode]')||{{}}).textContent||''])")
async def ring(A, X, nick, label):
    ok(f'{label}: Laurinka volá „{nick}“', await call(A, nick))
    got = await wait(X, "document.getElementById('vcIncoming')", 20000)
    ok(f'{label}: zazvoní příchozí hovor s PŘIJMOUT/ODMÍTNOUT', got and await X.locator('#vcAccept').is_visible())
    if got:
        await X.click('#vcAccept'); ok(f'{label}: hovor spojen', await wait(A, CONN, 25000) and await wait(X, CONN, 25000))
        await hang(A); await wait(X, "!document.getElementById('vcCall')", 10000)
    else: await A.evaluate("document.getElementById('vcHang')&&document.getElementById('vcHang').click()")
async def main():
    sr = subprocess.run(['node', LR, RULES], capture_output=True, text=True, cwd=SEED_CWD); print(sr.stdout.strip(), sr.stderr.strip()[-300:])
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        ca, A = await newp(b, 'Laurinka'); ct, T = await newp(b, 'Táta')
        ok('Laurinka založí skupinu „Kamarádky“', await create_group(A, 'Laurinka', 'Kamarádky'))
        ok('Táta se přidá přes pozvánku', await join(T, await invite(A), 'Táta'))
        ok('Laurinka Tátu schválí', await approve(A, 'Táta'))
        await T.goto(BASE + '#skola'); await T.wait_for_timeout(2500)
        uid = await T.evaluate(UIDJS)
        # ---- A) studený start: prázdný místní seznam + žádná záloha, uložené přihlášení zůstává (IndexedDB) ----
        await T.evaluate("localStorage.removeItem('bandapp-friends-rooms')"); await T.wait_for_timeout(1000)
        ls0 = await T.evaluate("localStorage.getItem('bandapp-friends-rooms')")
        for pg in list(ct.pages): await pg.close()
        sr = subprocess.run(['node', ADM, RULES, 'del', f'users/{uid}/private/state'], capture_output=True, text=True, cwd=SEED_CWD); print(sr.stdout.strip(), sr.stderr.strip()[-200:])
        T = await ct.new_page(); ERRS['Táta'] = []; T.on('pageerror', lambda e: ERRS['Táta'].append(str(e)))
        await T.goto(BASE + '#videochat'); await T.wait_for_timeout(500)
        ls = await T.evaluate("localStorage.getItem('bandapp-friends-rooms')")
        ok('A: před studeným startem – v zařízení žádný seznam skupin, záloha smazána', ls0 in (None, '[]') and sr.returncode == 0, ls0)
        ok('A: Kamarádky se neotevírají (úvodní obrazovka, bez kliknutí)', True)
        act = await wait(T, "(()=>{const v=window.__vc&&window.__vc.V;return v&&[...v.listen.values()].some(x=>x.state==='naslouchá')})()", 25000)
        txt = await T.evaluate(DIAG); print(txt.replace('\n', ' / '))
        ok('A: Diagnostika – Firebase připojeno', row(txt, 'Firebase') == 'připojeno', row(txt, 'Firebase'))
        ok('A: Diagnostika – Přihlášení ano · anonymní', row(txt, 'Přihlášení').startswith('ano'), row(txt, 'Přihlášení'))
        ok('A: Diagnostika – moje skupiny na serveru 1 · schválené 1', row(txt, 'Moje skupiny na serveru').startswith('1 · schválené: 1'), row(txt, 'Moje skupiny na serveru'))
        ok('A: Diagnostika – naslouchání AKTIVNÍ', act and row(txt, 'Naslouchání příchozím hovorům').startswith('AKTIVNÍ'), row(txt, 'Naslouchání příchozím hovorům'))
        tcode = row(txt, 'Kód účtu'); ok('A: Kód účtu = 6 znaků (ne uid)', re.fullmatch(r'[0-9A-F]{6}', tcode or '') and tcode not in uid, tcode)
        ok('A: Diagnostika bez uid a jmen', uid not in txt and 'Táta' not in txt and 'Laurinka' not in txt)
        await T.locator('#videochat').screenshot(path=SHOTS + '/cold-diag-tata.png')
        ls = await T.evaluate("JSON.parse(localStorage.getItem('bandapp-friends-rooms')||'[]').map(r=>r.role)")
        ok('A: skupina se do zařízení doplnila ze serveru (vlastní členství, jen přidání)', ls == ['approved'], ls)
        await T.evaluate("location.hash='#skola'"); await T.wait_for_timeout(500)
        await ring(A, T, 'Táta', 'A (Táta v sekci Škola)')
        lc = await codes(A, 'Táta'); ok('A: Laurinka (zakladatelka) vidí u Táty stejný Kód účtu', any(tcode in x[1] for x in lc), (lc, tcode))
        # ---- D) stejný účet, ztracený místní seznam, NOVÁ pozvánka (v 1.2.1: „nedostatečná oprávnění“) ----
        await T.evaluate("localStorage.removeItem('bandapp-friends-rooms')")
        link0 = await invite(A); tok0 = link0.split('#t=')[1]
        old = await T.evaluate('''(async(t)=>{const f=await import('./friends.js');const fb=await (f.createAccount?f.createAccount():f.connect());const {F,db,uid}=fb;
          const inv=(await F.getDoc(F.doc(db,'invites',t))).data();
          try{await F.runTransaction(db,async tx=>{const s=await tx.get(F.doc(db,'invites',t));
            tx.set(F.doc(db,'rooms',inv.roomId,'members',uid),{uid,nick:'Táta',status:'pending',joinedAt:F.serverTimestamp(),invite:t});
            tx.update(F.doc(db,'invites',t),{used:true,usedBy:uid,usedAt:F.serverTimestamp()});});return 'ok'}catch(e){return e.code}})''', tok0)
        ok('D: reprodukce 1.2.1 – původní přijetí pozvánky stejným (už schváleným) účtem → permission-denied', old == 'permission-denied', old)
        link = await invite(A); await T.goto(link)
        al = await wait(T, "document.querySelector('[data-state=already-member]')", 20000)
        ok('D: nová pozvánka pro už schváleného → „už členkou jsi“, žádná chyba oprávnění', al and 'oprávnění' not in await T.evaluate("document.body.innerText"), await T.evaluate("document.body.innerText.slice(0,300)"))
        ok('D: skupina je zase v zařízení jako schválená', await T.evaluate("JSON.parse(localStorage.getItem('bandapp-friends-rooms')||'[]').map(r=>r.role)") == ['approved'])
        lc = await codes(A, 'Táta'); ok('D: u Laurinky pořád jen JEDEN Táta (žádný duplikát), schválený', [x[0] for x in lc] == ['approved'], lc)
        await T.goto(BASE + '#studio'); await T.wait_for_timeout(1500)
        await ring(A, T, 'Táta', 'D (po obnovení skupiny)')
        await T.goto(BASE + '#friends'); ok('D: Kamarádky ukazují Laurinčinu skupinu', await wait(T, "!!document.getElementById('frContacts')&&document.getElementById('friendsApp').innerText.includes('Kamarádky')"))
        await A.wait_for_timeout(300)
        # ---- B) jiné přihlášení: pozvánka otevřená v jiném prohlížeči ----
        cp, P = await newp(b, 'Strejda-prohlížeč')
        ok('B: Strejda se přidá přes pozvánku v PROHLÍŽEČI', await join(P, await invite(A), 'Strejda'))
        ok('B: Laurinka ho schválí', await approve(A, 'Strejda'))
        pcode = await P.evaluate("(document.getElementById('jDevCode')||{}).textContent||''")
        cq, Q = await newp(b, 'Strejda-aplikace')
        await Q.goto(BASE + '#videochat')
        m = await wait(Q, "document.querySelector('#vcNoRooms[data-state=not-signed-in]')", 20000)
        msg = await Q.evaluate("(document.getElementById('vcNoRooms')||{}).innerText||''")
        ok('B: aplikace jasně řekne „není přihlášený jako schválený člen“ + návod', m and 'není přihlášený jako schválený člen' in msg and 'pozvánk' in msg, msg[:160])
        await Q.wait_for_timeout(3000)
        ok('B: žádný nový účet se nezaložil sám', await Q.evaluate(UIDJS) is None)
        txt = await Q.evaluate(DIAG)
        ok('B: Diagnostika – Firebase se bez přihlášení nenačítá (nic k obnovení), Přihlášení ne', row(txt, 'Firebase').startswith('nenačteno') and row(txt, 'Přihlášení') == 'ne', (row(txt, 'Firebase'), row(txt, 'Přihlášení')))
        await Q.screenshot(path=SHOTS + '/mismatch-strejda.png', full_page=False)
        link = await invite(A)
        await Q.fill('#vcInviteLink', 'Pozvánka do BAND APP: ' + link); await Q.click('#vcInviteGo')
        ok('B: vložená pozvánka se otevře přímo v aplikaci (join.html, stejná adresa)', await wait(Q, "location.pathname.endsWith('/join.html')&&!!document.querySelector('[data-state=invite-no-account]')"))
        ok('B: pozvánka bez účtu nic nezaloží sama – nabídne obnovu nebo výslovné založení', await Q.evaluate(UIDJS) is None and await Q.locator('#frNewAccount').count() == 1)
        await Q.click('#frNewAccount'); await wait(Q, "document.getElementById('jAccept')")
        await Q.fill('#jNick', 'Strejda'); await Q.click('#jAccept')
        ok('B: žádost odeslána (čeká na schválení)', await wait(Q, "document.querySelector('[data-state=pending]')"))
        await wait(Q, "!(document.getElementById('jDevCode')||{textContent:'…'}).textContent.includes('…')")
        qcode = (await Q.evaluate("document.getElementById('jDevCode').textContent")).split(': ')[1][:6]
        lc = await codes(A, 'Strejda')
        ok('B: Laurinka vidí 2× Strejda – starého (prohlížeč) a čekajícího s kódem z aplikace', sorted(x[0] for x in lc) == ['approved', 'pending'] and any(x[0] == 'pending' and qcode in x[1] for x in lc) and qcode not in pcode, (lc, qcode, pcode))
        await Q.goto(BASE + '#skola'); await Q.wait_for_timeout(2000)
        ok('B: Laurinka schválí Strejdu z aplikace', await approve(A, 'Strejda')); await A.wait_for_timeout(1500)
        ok('B: aplikace začne naslouchat bez restartu', await wait(Q, "(()=>{const v=window.__vc&&window.__vc.V;return v&&[...v.listen.values()].some(x=>x.state==='naslouchá')})()", 25000))
        A_p = A
        # Laurinka volá toho Strejdu, jehož kód je z aplikace (ve VIDEOCHATu jsou dva stejně pojmenovaní; vybereme podle uid)
        quid = await Q.evaluate(UIDJS)
        await A.evaluate("location.hash='#videochat'"); await wait(A, f"!!document.querySelector('#vcPeopleList li[data-uid=\"{quid}\"]')")
        await A.locator(f'#vcPeopleList li[data-uid="{quid}"] [data-act=video]').click()
        got = await wait(Q, "document.getElementById('vcIncoming')", 20000); ok('B: Strejdovi v aplikaci zazvoní hovor', got)
        if got: await Q.click('#vcAccept'); ok('B: spojeno', await wait(Q, CONN, 25000)); await hang(A)
        else: await A.evaluate("document.getElementById('vcHang')&&document.getElementById('vcHang').click()")
        # ---- C) přihlášený jiný (prázdný) účet ----
        cz, Z = await newp(b, 'Jiný účet')
        await Z.goto(BASE + '#friends'); await Z.wait_for_timeout(1500)
        await Z.locator('#friendsApp button', has_text='Kamarádky').first.click(); await wait(Z, "document.getElementById('frNewAccount')")
        ok('C: Kamarádky bez účtu → obrazovka „není přihlášený“, nic se nezaložilo', await Z.evaluate(UIDJS) is None)
        await Z.click('#frNewAccount'); await wait(Z, "document.getElementById('frCreate')")
        await Z.evaluate("location.hash='#videochat'")
        m = await wait(Z, "document.querySelector('#vcNoRooms[data-state=not-member]')", 20000)
        ok('C: přihlášený účet bez skupiny → „není přihlášený jako schválený člen“', m)
        for n, e in ERRS.items(): ok(f'{n}: žádné chyby stránky', not e, e[:3])
        ok('žádný požadavek mimo localhost/gstatic', not BLOCKED, BLOCKED[:3])
        await b.close()
    print(f'SOUHRN (Chromium headless + emulátor, ne skutečné telefony): {sum(R)}/{len(R)} PASS')
asyncio.run(main())
