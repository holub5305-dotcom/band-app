"""BAND APP 1.2.5 – regrese podle hlášení 31. 10. 2026 13:17: „7DFE2E je schválený, vidím staré zprávy, ale videohovor
se nepřipojí (Připojuji…)“. Skutečný stav telefonů: Tátova NAINSTALOVANÁ aplikace otevřela pozvánku v aplikaci (1.2.4 →
join.html), požádala o převod, zakladatelka převedla členství – a aplikace ZŮSTALA na stránce pozvánky (join.html),
která ukazuje chat se starými zprávami, ale NENAČÍTÁ videochat.js → žádné naslouchání hovorům → u volající jen „vyzvání…“.
Navíc ve skupině je další schválený testovací účet („Táta test 2“), jehož zařízení není otevřené.
TREE = strom aplikace, EXPECT=bug (1.2.4: reprodukce – nezazvoní) nebo fixed (1.2.5).
Headless Chromium + emulátor, ne skutečné telefony."""
import asyncio, os, re, json, shutil, subprocess, threading, functools, http.server
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); RULES = os.path.join(HERE, '..', '..', 'firestore.rules')
TREE = os.environ.get('TREE', os.path.join(HERE, '..', '..')); EXPECT = os.environ.get('EXPECT', 'fixed')   # EXPECT=bug → reprodukce na 1.2.4
SEED_CWD = os.environ.get('SEED_CWD', HERE); LR = os.path.join(SEED_CWD, '_load_rules.mjs'); shutil.copy(os.path.join(HERE, 'load_rules.mjs'), LR)
SERVE = '/tmp/bandapp-joincall-serve'; LINK = SERVE + '/band-app'; PORT = 8798
BASE = f'http://localhost:{PORT}/band-app/index.html?emulator=1'
UDT = '/tmp/bandapp-joincall-profile'
FAKE = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']
R = []; BLOCKED = []; ERRS = {}
def ok(n, c, info=''):
    R.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (' | ' + str(info)[:300] if info != '' else ''), flush=True)
ALLOWED = re.compile(r'^(https?://((localhost|127\.0\.0\.1)(:\d+)?/|www\.gstatic\.com/firebasejs/)|data:|blob:)')
async def guard(r):
    u = r.request.url
    if ALLOWED.match(u): await r.continue_()
    else:
        if not u.startswith('https://www.google.com/images/cleardot.gif'): BLOCKED.append(u[:120])
        await r.abort()
class Hd(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        if 'If-Modified-Since' in self.headers: del self.headers['If-Modified-Since']
        return super().send_head()
    def end_headers(self): self.send_header('Cache-Control', 'no-cache'); super().end_headers()
    def log_message(self, *a): pass
def point(t):
    os.makedirs(SERVE, exist_ok=True)
    if os.path.lexists(LINK): os.unlink(LINK)
    os.symlink(os.path.abspath(t), LINK)
async def wait(pg, js, t=20000):
    try: await pg.wait_for_function(js, timeout=t); return True
    except Exception: return False
def hook(pg, name):
    ERRS.setdefault(name, []); pg.on('pageerror', lambda e: ERRS[name].append(str(e))); pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
async def newp(b, name):
    c = await b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone'], has_touch=True)
    await c.route('**/*', guard); pg = await c.new_page(); hook(pg, name); return c, pg
async def persistent(p):
    c = await p.chromium.launch_persistent_context(UDT, headless=True, args=FAKE, permissions=['camera', 'microphone'], viewport={'width': 390, 'height': 844})
    await c.route('**/*', guard); pg = c.pages[0] if c.pages else await c.new_page(); hook(pg, 'Táta'); return c, pg
UIDJS = "(async()=>{const f=await import('./friends.js');const b=await f.firebaseBase();return b.auth.currentUser?b.auth.currentUser.uid:null})()"
CODEJS = "(async()=>{const f=await import('./friends.js');const b=await f.firebaseBase();return b.auth.currentUser?await f.deviceCode(b.auth.currentUser.uid):null})()"
ROOMS = "JSON.parse(localStorage.getItem('bandapp-friends-rooms')||'[]').map(r=>r.id+':'+r.role)"
UPDATE_FLOW = """()=>new Promise(res=>{const st=[];const t=setTimeout(()=>res(st.concat('TIMEOUT')),20000);navigator.serviceWorker.getRegistration().then(r=>{const watch=w=>w.addEventListener('statechange',()=>{st.push(w.state);if(w.state==='activated'){clearTimeout(t);res(st)}});if(r.installing)watch(r.installing);if(r.waiting)watch(r.waiting);r.addEventListener('updatefound',()=>watch(r.installing));r.update().catch(e=>st.push('ERR '+e))})})"""
async def kam(pg):   # otevři Kamarádky (případně úvodní tlačítko)
    await pg.goto(BASE + '#friends'); await pg.wait_for_timeout(1200)
    btn = pg.locator('#friendsApp button', has_text='Kamarádky')
    if not await pg.locator('#frContacts,#frCreate,#frNoAccount,#frNewRoom').count() and await btn.count(): await btn.first.click()
async def create_group(pg, nick, name):
    await kam(pg)
    for _ in range(5):
        if await pg.locator('#frCreate').count(): break
        if await pg.locator('#frNewAccount').count(): await pg.click('#frNewAccount')
        elif await pg.locator('#frNewRoom').count(): await pg.click('#frNewRoom')
        else:
            btn = pg.locator('#friendsApp button', has_text='Kamarádky')
            if await btn.count(): await btn.first.click()
        if await wait(pg, "document.getElementById('frCreate')", 6000): break
    await pg.fill('#frNick', nick); await pg.fill('#frRoomName', name); await pg.click('#frCreate')
    return await wait(pg, "document.getElementById('frInvite')")
async def invite(pg):
    await kam(pg); await wait(pg, "document.getElementById('frInvite')")
    old = await pg.evaluate("(document.getElementById('frInviteLink')||{}).value||''")
    await pg.click('#frInvite')
    await wait(pg, f"(()=>{{const e=document.getElementById('frInviteLink');return e&&e.value&&e.value!=={old!r}}})()")
    return (await pg.input_value('#frInviteLink')).replace('/index.html', '/').replace(f'localhost:{PORT}/band-app/join.html', f'localhost:{PORT}/band-app/join.html')
async def join(pg, link, nick):
    await pg.goto(link)
    if not await wait(pg, "document.getElementById('jAccept')||document.getElementById('frNewAccount')"): return False
    if await pg.locator('#frNewAccount').count(): await pg.click('#frNewAccount')
    if not await wait(pg, "document.getElementById('jAccept')"): return False
    await pg.fill('#jNick', nick); await pg.click('#jAccept')
    return await wait(pg, "document.querySelector('[data-state=pending]')")
async def approve(pg, nick):
    await kam(pg); sel = "#frContacts li[data-status=pending]"
    if not await wait(pg, f"[...document.querySelectorAll('{sel}')].some(l=>l.textContent.includes('{nick}'))"): return False
    await pg.locator(sel, has_text=nick).locator('[data-act=approve]').click()
    return await wait(pg, f"[...document.querySelectorAll('#frContacts li')].some(l=>l.textContent.includes('{nick}')&&l.dataset.status==='approved')")
async def codes(pg, nick):   # co vidí zakladatelka: [(status, uid, text kódu)]
    await kam(pg); await wait(pg, "document.querySelectorAll('#frContacts li').length>0")
    await wait(pg, "[...document.querySelectorAll('#frContacts [data-devcode],#frContacts [data-prevcode]')].every(e=>!e.textContent.includes('…'))")
    return await pg.evaluate(f"[...document.querySelectorAll('#frContacts li')].filter(l=>l.querySelector('.fname').textContent.startsWith('{nick}')).map(l=>[l.dataset.status,l.dataset.uid,(l.querySelector('[data-devcode],[data-prevcode]')||{{}}).textContent||''])")
async def mycode_ui(pg):     # „Kód účtu“ v Kamarádky → Můj účet
    await wait(pg, "document.getElementById('frAccount')")
    await pg.evaluate("document.getElementById('frAccount').open=true")
    await wait(pg, "(document.getElementById('frMyAccountCode')||{textContent:''}).textContent.match(/[0-9A-F]{6}/)")
    return await pg.evaluate("(document.getElementById('frMyAccountCode')||{textContent:''}).textContent")
CONN = "(()=>{const s=window.__vc&&window.__vc.state();return s&&s.pcs.length==1&&['connected','completed'].includes(s.pcs[0][1])})()"
async def ring(A, X, uid, label):
    await A.goto(BASE + '#videochat')
    if not await wait(A, f"!!document.querySelector('#vcPeopleList li[data-uid=\"{uid}\"]')"): ok(f'{label}: Laurinka vidí volaného ve VIDEOCHATu', False); return
    await A.locator(f'#vcPeopleList li[data-uid="{uid}"] [data-act=video]').click()
    got = await wait(X, "document.getElementById('vcIncoming')", 25000); ok(f'{label}: zazvoní příchozí hovor', got)
    if got:
        await X.click('#vcAccept'); ok(f'{label}: hovor spojen', await wait(A, CONN, 25000))
        await A.click('#vcHang'); await wait(X, "!document.getElementById('vcCall')", 10000)
    else:
        print('DBG', label, await X.evaluate("(()=>{const v=window.__vc&&window.__vc.V;return v?JSON.stringify({uid:v.uid,fb:!!v.fb,noAuth:v.noAuth,listen:[...v.listen.entries()],err:v.err,last:v.lastErr}):'no __vc'})()"), X.url)
        await A.evaluate("document.getElementById('vcHang')&&document.getElementById('vcHang').click()")
async def until(pg, js, want, t=20):
    for _ in range(t * 2):
        if await pg.evaluate(js) == want: return True
        await pg.wait_for_timeout(500)
    return False


STATE = "(()=>{const s=window.__vc&&window.__vc.state();return s?JSON.stringify(s):''})()"
async def main():
    shutil.rmtree(UDT, ignore_errors=True); point(TREE)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Hd, directory=SERVE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    sr = subprocess.run(['node', LR, RULES], capture_output=True, text=True, cwd=SEED_CWD); ok('emulátor: pravidla z větve nahrána', 'rules loaded' in sr.stdout, sr.stderr.strip()[-300:])
    fixed = EXPECT == 'fixed'
    async with async_playwright() as p:
        b = await p.chromium.launch(args=FAKE)
        ca, A = await newp(b, 'Laurinka'); ct, T = await newp(b, 'Táta – starý účet (prohlížeč)')
        ok('Laurinka založí skupinu', await create_group(A, 'Laurinka', 'Kamarádky'))
        ok('starý Táta (prohlížeč) se přidá a je schválen', await join(T, await invite(A), 'Táta') and await approve(A, 'Táta'))
        uA = await A.evaluate(UIDJS); uT = await T.evaluate(UIDJS); cT = await T.evaluate(CODEJS); cA = await A.evaluate(CODEJS)
        room = (await A.evaluate(ROOMS))[0].split(':')[0]
        ok('starý účet pošle zprávu', await T.evaluate(f"import('./friends.js').then(f=>f.sendMessage('{room}','Táta','Ahoj ze Safari')).then(()=>'ok',e=>e.code||String(e))") == 'ok')
        cx, X = await newp(b, 'Táta test 2 (zavřené zařízení)')
        ok('další schválený testovací účet „Táta test 2“', await join(X, await invite(A), 'Táta test 2') and await approve(A, 'Táta test 2'))
        uX = await X.evaluate(UIDJS); cX = await X.evaluate(CODEJS); await cx.close()     # jeho zařízení teď není otevřené
        # ===== Tátova nainstalovaná aplikace: nový účet → vložit pozvánku → požádat o převod (přesně podle 1.2.4 návodu) =====
        cpp, P = await persistent(p); await kam(P); await wait(P, "document.getElementById('frNewAccount')"); await P.click('#frNewAccount')
        await wait(P, "document.getElementById('frCreate')"); uP = await P.evaluate(UIDJS); cP = await P.evaluate(CODEJS)
        link = await invite(A)
        await kam(P); await wait(P, "!!document.getElementById('frJoinBox')")
        await P.fill('#frJoinLinkIn', link); await P.click('#frJoinLinkGo')
        ok('pozvánka otevřena v aplikaci (join.html)', await wait(P, "location.pathname.endsWith('/join.html')&&!!document.getElementById('jTransfer')"))
        await P.fill('#jNick', 'Táta'); await P.click('#jTransfer')
        ok('žádost o převod odeslána, aplikace čeká na stránce pozvánky', await wait(P, "!!document.querySelector('[data-state=transfer-requested]')"))
        await kam(A); await wait(A, f"!!document.querySelector('#frContacts li[data-uid=\"{uP}\"][data-status=pending]')")
        li = A.locator(f'#frContacts li[data-uid="{uT}"]'); await li.locator('[data-act=move-open]').click()
        await wait(A, f"[...document.querySelectorAll('#frContacts li[data-uid=\"{uT}\"] select[data-move-to] option')].some(o=>o.textContent.includes('{cP}'))")
        await li.locator('[data-move-code]').fill(cP); await li.locator('[data-act=move-go]').click()
        ok(f'zakladatelka převedla starého Tátu ({cT}) na {cP}', await wait(A, f"!!document.querySelector('#frContacts li[data-uid=\"{uT}\"][data-status=replaced]')&&!!document.querySelector('#frContacts li[data-uid=\"{uP}\"][data-status=approved]')"))
        await T.goto('about:blank')
        # ===== Táta NIKAM neodchází: aplikace dál ukazuje join.html (živě se přepne na schválený chat) =====
        seen = await wait(P, "location.pathname.endsWith('/join.html')&&[...document.querySelectorAll('.msgs .msg')].some(m=>m.textContent.includes('Ahoj ze Safari'))", 25000)
        ok('Tátova aplikace (stále join.html) ukazuje schválený chat se STARÝMI zprávami – jako v hlášení', seen, P.url)
        # ===== Laurinka volá Tátu =====
        await A.goto(BASE + '#videochat')
        ok('VIDEOCHAT u Laurinky: Táta (nový účet) i „Táta test 2“ v seznamu, převedený starý účet NE',
           await wait(A, f"!!document.querySelector('#vcPeopleList li[data-uid=\"{uP}\"]')&&!!document.querySelector('#vcPeopleList li[data-uid=\"{uX}\"]')") and await A.locator(f'#vcPeopleList li[data-uid="{uT}"]').count() == 0)
        if fixed:
            ok(f'1.2.5: u kontaktů je kód účtu (Táta {cP}, Táta test 2 {cX})', await wait(A, f"(document.querySelector('#vcPeopleList li[data-uid=\"{uP}\"]')||{{textContent:''}}).textContent.includes('{cP}')&&(document.querySelector('#vcPeopleList li[data-uid=\"{uX}\"]')||{{textContent:''}}).textContent.includes('{cX}')"))
        await A.locator(f'#vcPeopleList li[data-uid="{uP}"] [data-act=video]').click()
        rang = await wait(P, "document.getElementById('vcIncoming')", 25000)
        st = await A.evaluate("(document.getElementById('vcState')||{textContent:''}).textContent")
        if not fixed:
            ok('REPRODUKCE 1.2.4: Tátova aplikace na join.html hovor NEDOSTANE (nezazvoní)', not rang)
            ok('REPRODUKCE 1.2.4: u Laurinky „vyzvání…“ a dlaždice „Připojuji…“ (jako na fotce)', 'vyzvání' in st, st)
            ok('REPRODUKCE 1.2.4: join.html nenačítá videochat.js', not await P.evaluate("[...document.scripts].some(s=>s.src.includes('videochat.js'))"))
            await A.evaluate("document.getElementById('vcHang')&&document.getElementById('vcHang').click()")
        else:
            ok('1.2.5: Tátova aplikace na stránce pozvánky ZAZVONÍ', rang, st)
            if rang:
                await P.click('#vcAccept'); ok('1.2.5: hovor Laurinka → Táta (join.html) spojen', await wait(A, CONN, 25000) and await wait(P, CONN, 25000))
                await A.click('#vcHang'); await wait(P, "!document.getElementById('vcCall')", 10000)
            ok('1.2.5: na stránce pozvánky je tlačítko „Otevřít BAND APP (Kamarádky a VIDEOCHAT)“', await wait(P, "!!document.getElementById('jOpenApp')", 8000))
            # Táta → Laurinka (z aplikace) a diagnostika příchozích u Laurinky
            await P.click('#jOpenApp'); await wait(P, "location.pathname.endsWith('/index.html')", 10000)
            await P.goto(BASE + '#videochat'); await A.goto(BASE + '#studio'); await A.wait_for_timeout(2000)
            if await wait(P, f"!!document.querySelector('#vcPeopleList li[data-uid=\"{uA}\"]')"):
                await P.locator(f'#vcPeopleList li[data-uid="{uA}"] [data-act=video]').click()
                g = await wait(A, "document.getElementById('vcIncoming')", 25000); ok('1.2.5: Táta → Laurinka zazvoní', g)
                if g: await A.click('#vcAccept'); ok('1.2.5: hovor Táta → Laurinka spojen', await wait(P, CONN, 25000)); await P.click('#vcHang'); await wait(A, "!document.getElementById('vcCall')", 10000)
            else: ok('1.2.5: Táta vidí Laurinku ve VIDEOCHATu', False)
            await A.goto(BASE + '#videochat'); await A.evaluate("document.getElementById('vcDiag').open=true"); await A.wait_for_timeout(2500)
            dg = await A.inner_text('#vcDiag')
            ok(f'1.2.5: diagnostika volané (Laurinka) ukazuje poslední příchozí hovor od kódu {cP}', 'Poslední příchozí hovor' in dg and cP in dg, dg[-400:])
            # ===== Laurinka volá „Táta test 2“, jehož zařízení není otevřené =====
            await wait(A, f"!!document.querySelector('#vcPeopleList li[data-uid=\"{uX}\"] [data-act=video]:not([disabled])')")
            await A.locator(f'#vcPeopleList li[data-uid="{uX}"] [data-act=video]').click()
            await wait(A, "!!document.getElementById('vcCall')")
            await A.wait_for_timeout(1500)
            hdr = await A.inner_text('#vcCall .vc-top'); tile = await A.evaluate("(document.querySelector('#vcCall .vc-tile.connecting')||{dataset:{}}).dataset.st||''")
            ok(f'1.2.5: obrazovka hovoru ukazuje kód volaného ({cX}) a stav „vyzvání“', cX in hdr and 'vyzvání' in hdr, hdr)
            ok('1.2.5: dlaždice volaného při vyzvánění NEpíše „Připojuji…“, ale „Vyzvání…“', tile.startswith('Vyzvání'), tile)
            ended = await wait(A, "!document.getElementById('vcCall')", 60000)
            msg = await A.evaluate("(document.getElementById('vcErr')||{textContent:''}).textContent")
            ok(f'1.2.5: po 45 s jasný konec „Nikdo to nevzal“ s kódem {cX} (žádné nekonečné čekání)', ended and 'Nikdo to nevzal' in msg and cX in msg, msg)
            await A.evaluate("document.getElementById('vcDiag').open=true"); await A.wait_for_timeout(2500); dg = await A.inner_text('#vcDiag')
            ok('1.2.5: diagnostika volající ukazuje poslední odchozí hovor (kód + výsledek)', 'Poslední odchozí hovor' in dg and cX in dg and 'nikdo nepřijal' in dg, dg[-500:])
            # ===== převedený starý účet nejde volat (pravidla) =====
            r = await A.evaluate(f"(async()=>{{const st=await window.__vc.startCall('{room}',['{uT}'],false);return window.__vc.V.err||''}})()")
            ok('převedený starý účet nejde volat (pravidla odmítnou)', 'schválené' in r, r)
            await A.evaluate("document.getElementById('vcHang')&&document.getElementById('vcHang').click()")
        for n, e in ERRS.items(): ok(f'{n}: žádné chyby stránky', not e, e[:3])
        ok('žádný požadavek mimo localhost/gstatic', not BLOCKED, BLOCKED[:3])
        await cpp.close(); await b.close()
    srv.shutdown()
    print(f'SOUHRN ({EXPECT}; Chromium headless + emulátor, ne skutečné telefony): {sum(R)}/{len(R)} PASS')
asyncio.run(main())
