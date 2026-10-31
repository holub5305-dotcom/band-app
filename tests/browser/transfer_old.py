"""BAND APP 1.2.4 – E2E přesně podle hlášení z 31. 10. 2026 11:45: zakladatelka vidí schváleného „Tátu“ (starý účet,
kód jako BD619B); Tátova nainstalovaná aplikace je JINÝ přihlášený účet bez členství (kód jako 7DFE2E). U starého
záznamu v 1.2.3 nebylo „Převést“. 1.2.4: zakladatelka u STARÉHO záznamu → „🔁 Převést na nový účet…“ → návod / výběr
žádosti + opsaný kód. Data vznikají skutečnými obrazovkami, pravidla = firestore.rules (= živá produkční).
Headless Chromium + emulátor, ne skutečné telefony. OLD = strom 1.2.3 (telefony s 1.2.3 v mezipaměti), NEW = 1.2.4."""
import asyncio, os, re, json, shutil, subprocess, threading, functools, http.server
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); RULES = os.path.join(HERE, '..', '..', 'firestore.rules')
OLD, NEW = os.environ['OLD'], os.environ.get('NEW', os.path.join(HERE, '..', '..'))
NEWV, NEWC = os.environ.get('NEWV', '1.2.4'), os.environ.get('NEWC', '15')
SEED_CWD = os.environ.get('SEED_CWD', HERE); LR = os.path.join(SEED_CWD, '_load_rules.mjs'); shutil.copy(os.path.join(HERE, 'load_rules.mjs'), LR)
SERVE = '/tmp/bandapp-identity-serve'; LINK = SERVE + '/band-app'; PORT = 8797
BASE = f'http://localhost:{PORT}/band-app/index.html?emulator=1'
UDT = '/tmp/bandapp-identity-tata-profile'
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

async def main():
    shutil.rmtree(UDT, ignore_errors=True); point(OLD)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Hd, directory=SERVE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    sr = subprocess.run(['node', LR, RULES], capture_output=True, text=True, cwd=SEED_CWD); print(sr.stdout.strip(), sr.stderr.strip()[-300:])
    async with async_playwright() as p:
        b = await p.chromium.launch(args=FAKE)
        ca, A = await newp(b, 'Laurinka'); ct, T = await persistent(p)
        # ===== stav jako na telefonech (1.2.3) =====
        ok('1.2.3: Laurinka založí skupinu', await create_group(A, 'Laurinka', 'Kamarádky'))
        ok('1.2.3: Táta (Safari) se přidá přes pozvánku', await join(T, await invite(A), 'Táta')); ok('1.2.3: Laurinka ho schválí', await approve(A, 'Táta'))
        uA = await A.evaluate(UIDJS); uT = await T.evaluate(UIDJS); cT = await T.evaluate(CODEJS)
        room = (await A.evaluate(ROOMS))[0].split(':')[0]
        ok('starý účet pošle zprávu', await T.evaluate(f"import('./friends.js').then(f=>f.sendMessage('{room}','Táta','Ahoj ze Safari')).then(()=>'ok',e=>e.code||String(e))") == 'ok')
        cz, Z = await newp(b, 'Zoe'); ok('Zoe (běžná členka) se přidá a je schválena', await join(Z, await invite(A), 'Zoe') and await approve(A, 'Zoe'))
        cpp, P = await newp(b, 'Táta – nainstalovaná aplikace'); await kam(P); await wait(P, "document.getElementById('frNewAccount')"); await P.click('#frNewAccount')
        await wait(P, "document.getElementById('frCreate')"); uP = await P.evaluate(UIDJS); cP = await P.evaluate(CODEJS)
        ok(f'nainstalovaná aplikace = jiný přihlášený účet bez členství ({cP} ≠ {cT})', uP and uP != uT and cP != cT and await P.evaluate(ROOMS) == [])
        lc = await codes(A, 'Táta')
        ok('1.2.3 (reprodukce): u schváleného Táty jen Chat/Odebrat/Blokovat/Předat – žádný převod', len(lc) == 1 and await A.locator(f'#frContacts li[data-uid="{uT}"] [data-act^=transfer-open], #frContacts li[data-uid="{uT}"] [data-act=move-open]').count() == 0,
           await A.evaluate(f"[...document.querySelectorAll('#frContacts li[data-uid=\"{uT}\"] button')].map(b=>b.textContent)"))
        # ===== aktualizace 1.2.3 → 1.2.4 (mezipaměť) =====
        point(NEW)
        for pg in (A, P, T):
            await pg.goto(BASE); await pg.wait_for_timeout(800); await pg.evaluate(UPDATE_FLOW); await pg.reload(); await pg.wait_for_timeout(1500)
            ok(f'{NEWV}: aktualizace z mezipaměti 1.2.3 → band-app-pages-{NEWC}, patička {NEWV}', await pg.evaluate('caches.keys()') == [f'band-app-pages-{NEWC}'] and f'BAND APP {NEWV}' in await pg.evaluate('document.body.innerText'), await pg.evaluate('caches.keys()'))
        ok('aktualizace: uid beze změny (zakladatelka, Táta, aplikace)', await A.evaluate(UIDJS) == uA and await T.evaluate(UIDJS) == uT and await P.evaluate(UIDJS) == uP)
        # ===== bez žádosti → návod =====
        await kam(A); await wait(A, f"!!document.querySelector('#frContacts li[data-uid=\"{uT}\"] [data-act=move-open]')")
        li = A.locator(f'#frContacts li[data-uid="{uT}"]')
        ok('zakladatelka: u STARÉHO schváleného Táty je „🔁 Převést na nový účet…“', await li.locator('[data-act=move-open]').count() == 1)
        ok('Zoe (ne zakladatelka) tlačítko převodu nevidí', (await kam(Z)) is None and await wait(Z, "document.querySelectorAll('#frContacts li').length>0") and await Z.locator('[data-act=move-open],[data-act=transfer-open]').count() == 0)
        await li.locator('[data-act=move-open]').click()
        g = await li.locator('[data-move-none]').inner_text() if await li.locator('[data-move-none]').count() else ''
        ok('bez čekající žádosti: český návod (nová pozvánka → vložit v nainstalované aplikaci → Požádat o převod)', 'NOVOU pozvánku' in g and 'NAINSTALOVANÉ' in g and 'Požádat o převod' in g, g[:200])
        # ===== Táta v aplikaci: vložit pozvánku → požádat o převod =====
        link = await invite(A)
        await kam(P); ok('aplikace (účet bez skupiny): pole „Mám pozvánku / nový účet – požádat o převod“', await wait(P, "!!document.getElementById('frJoinBox')"))
        await P.fill('#frJoinLinkIn', 'Pozvánka do BAND APP: ' + link); await P.click('#frJoinLinkGo')
        ok('pozvánka se otevře přímo v aplikaci (join.html)', await wait(P, "location.pathname.endsWith('/join.html')&&!!document.getElementById('jTransfer')"))
        await wait(P, "!document.getElementById('jMyCode').textContent.includes('…')")
        ok(f'pozvánka ukazuje kód účtu tohoto telefonu ({cP})', cP in await P.inner_text('#jMyCode'))
        await P.fill('#jNick', 'Táta'); await P.click('#jTransfer')
        ok('„Požádat o převod“ → čekající žádost + návod s kódem', await wait(P, "!!document.querySelector('[data-state=transfer-requested]')") and cP in await P.evaluate("(document.querySelector('[data-state=transfer-requested]')||{textContent:''}).textContent"))
        ok('aplikace nic dalšího nezaložila (stejné uid)', await P.evaluate(UIDJS) == uP)
        # ===== zakladatelka u STARÉHO záznamu =====
        await kam(A); await wait(A, f"!!document.querySelector('#frContacts li[data-uid=\"{uP}\"][data-status=pending]')")
        li = A.locator(f'#frContacts li[data-uid="{uT}"]'); await li.locator('[data-act=move-open]').click()
        await wait(A, f"[...document.querySelectorAll('#frContacts li[data-uid=\"{uT}\"] select[data-move-to] option')].some(o=>o.textContent.includes('{cP}'))")
        ok(f'seznam žádostí u starého Táty: „Táta · kód účtu {cP}“ předvybraná', await li.locator('select[data-move-to]').input_value() == uP and cP in await li.locator('select[data-move-to]').inner_text())
        zd = await Z.evaluate(f"import('./friends.js').then(f=>f.transferMember('{room}','{uT}','{uP}','{cP}')).then(()=>'ok',e=>e.code||String(e))")
        ok('běžná členka (Zoe) převod přes SDK neudělá', zd != 'ok', zd)
        bad = 'AAAAAA' if cP != 'AAAAAA' else 'BBBBBB'
        await li.locator('[data-move-code]').fill(bad); await li.locator('[data-act=move-go]').click(); await A.wait_for_timeout(1500)
        lc = await codes(A, 'Táta'); ok('špatný kód → odmítnuto, nic se nezměnilo', sorted(x[0] for x in lc) == ['approved', 'pending'], lc)
        li = A.locator(f'#frContacts li[data-uid="{uT}"]')
        if not await li.locator('[data-move-code]').is_visible(): await li.locator('[data-act=move-open]').click()
        await li.locator('[data-move-code]').fill(cP.lower()); await li.locator('[data-act=move-go]').click()
        ok('správný kód → převedeno', await wait(A, f"!!document.querySelector('#frContacts li[data-uid=\"{uT}\"][data-status=replaced]')&&!!document.querySelector('#frContacts li[data-uid=\"{uP}\"][data-status=approved]')"))
        lc = await codes(A, 'Táta')
        ok(f'jediný aktivní Táta s kódem {cP}; starý {cT} jako „převedeno“ (nesmazán)', [x for x in lc if x[0] != 'replaced'] and len([x for x in lc if x[0] != 'replaced']) == 1 and cP in [x for x in lc if x[0] != 'replaced'][0][2] and any(x[0] == 'replaced' and cT in x[2] for x in lc), lc)
        # ===== Táta v aplikaci =====
        await P.goto(BASE + '#friends'); await kam(P)
        ok('Táta v aplikaci vidí skupinu jako schválený', await wait(P, f"JSON.stringify({ROOMS}).includes('{room}:approved')", 20000) and await wait(P, "document.getElementById('frOpenChat')"))
        await P.click('#frOpenChat'); await wait(P, "[...document.querySelectorAll('.msgs .msg')].some(m=>m.textContent.includes('Ahoj ze Safari'))", 20000)
        ok('stará zpráva ze Safari je vidět a patří Tátovi („Ty“)', await P.evaluate("[...document.querySelectorAll('.msgs .msg.me')].some(m=>m.textContent.includes('Ahoj ze Safari'))"))
        ok(f'Kamarádky → Můj účet ukazuje {cP}', cP in await mycode_ui(P))
        await kam(T); ok('starý účet (Safari) ukazuje „členství převedeno“', await wait(T, "!!document.querySelector('[data-state=replaced]')"))
        await T.goto('about:blank')
        await P.goto(BASE + '#skola'); await P.wait_for_timeout(2500); await ring(A, P, uP, 'Laurinka → Táta')
        await A.goto(BASE + '#studio'); await A.wait_for_timeout(1500); await ring(P, A, uA, 'Táta → Laurinka')
        for n, e in ERRS.items(): ok(f'{n}: žádné chyby stránky', not e, e[:3])
        ok('žádný požadavek mimo localhost/gstatic', not BLOCKED, BLOCKED[:3])
        await ct.close(); await b.close()
    srv.shutdown()
    print(f'SOUHRN (Chromium headless + emulátor, ne skutečné telefony): {sum(R)}/{len(R)} PASS')
asyncio.run(main())
