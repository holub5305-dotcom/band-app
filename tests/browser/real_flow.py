"""BAND APP – AUTOMATICKÝ end-to-end test příchozích hovorů s daty vytvořenými SKUTEČNÝMI obrazovkami aplikace
(Kamarádky: založení skupiny, pozvánka, join.html, schválení) – žádné ruční vkládání localStorage ani databáze.
Headless Chromium + falešná kamera/mikrofon + Firebase EMULÁTOR. Nejde o test na skutečných telefonech.
Scénáře (podle hlášení z 31. 10. 2026 – příchozí hovor se tátovi nezobrazil):
  1) Táta se přidá přes pozvánku, Laurinka ho schválí, Táta aplikaci NEOBNOVÍ a je v sekci Škola → hovor musí zazvonit.
  2) Táta přepíná sekce (Akordy, Studio) → další hovor musí zazvonit.
  3) Skupina „Kamarádky“ není poslední v seznamu (Kamarádky otevřou jinou skupinu) + čerstvě schválený.
  4) Hodiny volaného telefonu jdou o 3 minuty napřed → hovor musí zazvonit.
  5) Diagnostika hovorů: stav naslouchání, poslední chyba, verze, počet příchozích – bez uid/jmen."""
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
        if await pg.locator('#frNewRoom').count(): await pg.click('#frNewRoom')
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
async def main():
    sr = subprocess.run(['node', LR, RULES], capture_output=True, text=True, cwd=SEED_CWD); print(sr.stdout.strip(), sr.stderr.strip()[-300:])
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        ca, A = await newp(b, 'Laurinka'); cb, B = await newp(b, 'Táta')
        ok('Laurinka založí skupinu „Kamarádky“ v sekci Kamarádky', await create_group(A, 'Laurinka', 'Kamarádky'))
        link = await invite(A); ok('Laurinka vytvoří pozvánku', 'join.html' in link)
        ok('Táta otevře pozvánku (join.html) a požádá o přijetí jako „Táta“', await join(B, link, 'Táta'))
        await B.goto(BASE); await B.wait_for_timeout(1500)
        rl = await B.evaluate("JSON.parse(localStorage.getItem('bandapp-friends-rooms')||'[]').map(r=>r.role)")
        ok('Táta otevře BAND APP; v zařízení má skupinu jako „pending“ (skutečný stav po pozvánce)', rl == ['pending'], rl)
        await B.evaluate("location.hash='#skola'"); await B.evaluate("document.getElementById('skola').scrollIntoView()")
        ok('Laurinka Tátu schválí (Táta aplikaci neobnovuje, je ve Škole)', await approve(A, 'Táta'))
        await A.wait_for_timeout(1500)
        # ---- 1) čerstvě schválený, nečinný v jiné sekci ----
        ok('Laurinka vidí „Táta“ ve VIDEOCHATu a zahájí videohovor', await call(A, 'Táta'))
        got = await wait(B, "document.getElementById('vcIncoming')", 20000)
        ok('1) Tátovi (bez obnovení, sekce Škola) zazvoní příchozí hovor s PŘIJMOUT/ODMÍTNOUT', got and await B.locator('#vcAccept').is_visible() and await B.locator('#vcDecline').is_visible())
        await B.screenshot(path=SHOTS + '/real-incoming-tata.png')
        if got:
            nm = await B.evaluate("vcInName.textContent"); ok('  volající je „Laurinka“', nm == 'Laurinka', nm)
            await B.click('#vcAccept'); ok('  hovor spojen', await wait(A, CONN, 25000) and await wait(B, CONN, 25000))
            ok('  zavěšení', await hang(A) and await wait(B, "!document.getElementById('vcCall')", 10000))
        else:
            await A.evaluate("document.getElementById('vcHang')&&document.getElementById('vcHang').click()")
        # ---- 2) přepínání sekcí ----
        for sec in ['akordy', 'studio', 'friends', 'skola']:
            await B.evaluate(f"location.hash='#{sec}'"); await B.wait_for_timeout(400)
        await A.wait_for_timeout(1500)
        ok('Laurinka volá znovu (hlasový hovor)', await call(A, 'Táta', 'audio'))
        got = await wait(B, "document.getElementById('vcIncoming')", 20000)
        ok('2) po přepínání sekcí Tátovi znovu zazvoní (hlasový)', got)
        if got:
            await B.click('#vcDecline'); ok('  Táta odmítne → Laurinčin hovor skončí', await wait(A, "!document.getElementById('vcCall')", 15000))
        else:
            await A.evaluate("document.getElementById('vcHang')&&document.getElementById('vcHang').click()")
        # ---- 5) diagnostika (Táta) ----
        await B.evaluate("location.hash='#videochat'"); await B.wait_for_timeout(300)
        has = await B.locator('#vcDiag').count()
        ok('5) Diagnostika hovorů je v sekci VIDEOCHAT (sbalená)', has == 1 and not await B.locator('#vcDiagBody').is_visible())
        if has:
            await B.click('#vcDiag summary'); await B.wait_for_timeout(2500)
            txt = await B.inner_text('#vcDiagBody'); print(txt)
            uids = await B.evaluate("(async()=>{const f=await import('./friends.js');const fb=await f.connect();return [fb.uid, JSON.parse(localStorage.getItem('bandapp-friends-rooms'))[0].id]})()")
            ok('  ukazuje naslouchání, chybu, verzi a příchozí hovory', all(k in txt for k in ['Naslouchání', 'Poslední chyba', 'Verze', 'Příchozí']) and re.search(r'BAND APP 1\.2\.[1-9]', txt), txt.replace('\n', ' / '))
            ok('  žádné uid, ID skupiny ani přezdívky', not any(x and x in txt for x in uids + ['Laurinka', 'Táta', 'Kamarádky']))
            await B.locator('#videochat').screenshot(path=SHOTS + '/diag-tata.png')
        # ---- 3) druhá skupina: Kamarádky nejsou poslední; nový člen C ----
        cc, C = await newp(b, 'Zoe')
        ok('Zoe si založí vlastní skupinu „Kapela Zoe“', await create_group(C, 'Zoe', 'Kapela Zoe'))
        await A.evaluate("location.hash='#friends'"); await A.wait_for_timeout(300)
        link2 = await invite(A)
        print('link2 differs', link2 != link)
        await C.goto(link2)
        if not await wait(C, "document.getElementById('jAccept')"): print('DBGJ', (await C.inner_text('body'))[:500])
        await C.fill('#jNick', 'Zoe'); await C.click('#jAccept'); await wait(C, "document.querySelector('[data-state=pending]')")
        await C.goto(BASE + '#skola'); await C.wait_for_timeout(1500)
        roles = await C.evaluate("JSON.parse(localStorage.getItem('bandapp-friends-rooms')).map(r=>r.role)"); print('Zoe rooms', roles)
        ok('Laurinka schválí Zoe', await approve(A, 'Zoe'))
        await A.wait_for_timeout(1500)
        ok('Laurinka volá Zoe', await call(A, 'Zoe'))
        got = await wait(C, "document.getElementById('vcIncoming')", 20000)
        ok('3) Zoe (Kamarádky nejsou její poslední skupina, bez obnovení) zazvoní hovor', got, roles)
        if got: await C.click('#vcDecline'); await wait(A, "!document.getElementById('vcCall')", 15000)
        else: await A.evaluate("document.getElementById('vcHang')&&document.getElementById('vcHang').click()")
        await cc.close()
        # ---- 4) hodiny o 3 minuty napřed (stejný účet Táta v novém kontextu by byl jiný účet → nový člen D) ----
        cd, D = await newp(b, 'Ema', skew_ms=180000)
        link3 = await invite(A)
        ok('Ema (hodiny +3 min) se přidá přes pozvánku', await join(D, link3, 'Ema'))
        await D.goto(BASE + '#skola'); await D.wait_for_timeout(1500)
        ok('Laurinka schválí Emu', await approve(A, 'Ema')); await A.wait_for_timeout(1500)
        ok('Laurinka volá Emu', await call(A, 'Ema'))
        got = await wait(D, "document.getElementById('vcIncoming')", 20000)
        ok('4) Emě s hodinami +3 min zazvoní hovor', got)
        if got: await D.click('#vcDecline'); await wait(A, "!document.getElementById('vcCall')", 15000)
        else: await A.evaluate("document.getElementById('vcHang')&&document.getElementById('vcHang').click()")
        # ---- po obnovení stránky dál funguje ----
        await B.reload(); await B.evaluate("location.hash='#studio'"); await B.wait_for_timeout(2500)
        ok('Laurinka volá Tátu po obnovení jeho aplikace', await call(A, 'Táta'))
        got = await wait(B, "document.getElementById('vcIncoming')", 20000); ok('Tátovi po obnovení zazvoní', got)
        if got: await B.click('#vcAccept'); ok('  spojeno', await wait(B, CONN, 25000)); await hang(B)
        for n, e in ERRS.items(): ok(f'{n}: žádné chyby stránky', not e, e[:3])
        ok('žádný požadavek mimo localhost/gstatic', not BLOCKED, BLOCKED[:3])
        await b.close()
    print(f'SOUHRN (Chromium headless + emulátor, ne skutečné telefony): {sum(R)}/{len(R)} PASS')
asyncio.run(main())
