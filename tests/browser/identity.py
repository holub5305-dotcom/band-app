"""BAND APP 1.2.3 – AUTOMATICKÝ test STÁLÉ IDENTITY (kód účtu) – headless Chromium + Firebase EMULÁTOR, ne skutečné telefony.
Ověřuje: kód účtu = prvních 6 znaků SHA-256(uid účtu Firebase) se nemění při aktualizaci 1.2.2 → 1.2.3 (stejná adresa),
restartu prohlížeče, staré i nové pozvánce, ztrátě místního seznamu, přepínání sekcí; zakladatelka vidí stejný kód;
aplikace nikde sama nezakládá účet; obnova obnovovacím kódem na jiném „zařízení“ (stejné uid, žádné duplicitní členství);
převod členství zakladatelkou (kód z telefonu, starý záznam se jen označí, zprávy zůstanou, hovor zazvoní novému účtu).
Spuštění: OLD=<strom 1.2.2> NEW=<strom 1.2.3> SEED_CWD=<složka s node_modules>; emulátor auth 9099 + firestore 8080."""
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
    src = open(os.path.join(NEW, 'friends.js')).read()
    ok('statická kontrola: signInAnonymously je v kódu JEN jednou, a to v createAccount (výslovné „Založit účet“)',
       src.count('signInAnonymously') == 1 and src.index('signInAnonymously') > src.index('export async function createAccount') and src.index('signInAnonymously') < src.index('export async function createAccount') + 900
       and all('signInAnonymously' not in open(os.path.join(NEW, f)).read() for f in os.listdir(NEW) if f.endswith(('.js', '.html')) and f != 'friends.js'))
    async with async_playwright() as p:
        b = await p.chromium.launch(args=FAKE)
        ca, A = await newp(b, 'Laurinka'); ct, T = await persistent(p)
        # ===== 1.2.2 (současná produkce): skupina + Táta přes pozvánku =====
        ok('1.2.2: Laurinka založí skupinu', await create_group(A, 'Laurinka', 'Kamarádky'))
        ok('1.2.2: Táta se přidá přes pozvánku', await join(T, await invite(A), 'Táta')); ok('1.2.2: Laurinka ho schválí', await approve(A, 'Táta'))
        uT = await T.evaluate(UIDJS); cT = await T.evaluate(CODEJS)
        room = (await T.evaluate(ROOMS) or [''])[0].split(':')[0] or (await A.evaluate(ROOMS))[0].split(':')[0]
        lc = await codes(A, 'Táta'); ok('1.2.2: Laurinka vidí u Táty jeho kód účtu', len(lc) == 1 and cT in lc[0][2], (lc, cT))
        # ===== aktualizace na 1.2.3 na stejné adrese =====
        point(NEW)
        for pg in (A, T):
            await pg.goto(BASE); await pg.wait_for_timeout(800); fl = await pg.evaluate(UPDATE_FLOW); await pg.reload(); await pg.wait_for_timeout(1500)
        ok(f'{NEWV}: Táta – SW aktualizace na band-app-pages-{NEWC}', await T.evaluate('caches.keys()') == [f'band-app-pages-{NEWC}'], await T.evaluate('caches.keys()'))
        ok(f'{NEWV}: patička {NEWV}', f'BAND APP {NEWV}' in await T.evaluate('document.body.innerText'))
        ok('aktualizace: stejné uid i kód účtu', await T.evaluate(UIDJS) == uT and await T.evaluate(CODEJS) == cT)
        await kam(T); ui = await mycode_ui(T); ok('aktualizace: Kamarádky → Můj účet ukazuje „Kód účtu: ' + str(cT) + '“', cT in ui and 'Kód účtu' in ui and 'Není to heslo' in ui, ui[:160])
        lc = await codes(A, 'Táta'); ok('aktualizace: Laurinka vidí STEJNÝ kód, pořád jeden Táta', len(lc) == 1 and cT in lc[0][2] and lc[0][0] == 'approved', lc)
        await ring(A, T, uT, 'po aktualizaci')
        # ===== restart prohlížeče (trvalý profil) =====
        await ct.close(); ct, T = await persistent(p); await T.goto(BASE + '#skola'); await T.wait_for_timeout(2500)
        ok('restart: stejné uid i kód účtu', await T.evaluate(UIDJS) == uT and await T.evaluate(CODEJS) == cT)
        for h in ('#akordy', '#studio', '#videochat', '#friends', '#skola'): await T.evaluate(f"location.hash='{h}'"); await T.wait_for_timeout(500)
        ok('přepínání sekcí: stejné uid', await T.evaluate(UIDJS) == uT)
        # ===== nová pozvánka pro už schváleného + ztracený místní seznam =====
        await T.evaluate("localStorage.removeItem('bandapp-friends-rooms')")
        await T.goto(await invite(A)); al = await wait(T, "document.querySelector('[data-state=already-member]')", 20000)
        ok('nová pozvánka: „už členkou jsi“, stejné uid, žádný duplikát', al and await T.evaluate(UIDJS) == uT and len(await codes(A, 'Táta')) == 1)
        await T.evaluate("localStorage.removeItem('bandapp-friends-rooms')"); await kam(T)
        ok('ztracený místní seznam: skupina se vrátí ze serveru, stejné uid', await wait(T, f"JSON.stringify({ROOMS}).includes('{room}')", 20000) and await T.evaluate(UIDJS) == uT)
        # ===== nikde se nezakládá účet sám =====
        cf, F = await newp(b, 'Nový prohlížeč')
        await F.goto(BASE + '#friends'); await F.wait_for_timeout(2000); ok('bez účtu: Kamarádky (úvod) nic nezaloží', await F.evaluate(UIDJS) is None)
        await F.goto(BASE + '#videochat'); await F.wait_for_timeout(3000); ok('bez účtu: VIDEOCHAT nic nezaloží', await F.evaluate(UIDJS) is None)
        await kam(F); ok('bez účtu: Kamarádky → obrazovka „není přihlášený“ (obnovit / výslovně založit)', await wait(F, "!!document.querySelector('#frNoAccount[data-state=no-account]')&&!!document.getElementById('frNewAccount')&&!!document.getElementById('frNoAccRestore')") and await F.evaluate(UIDJS) is None)
        await F.goto(await invite(A)); ok('bez účtu: pozvánka nic nezaloží, nabídne obnovu/založení', await wait(F, "!!document.querySelector('[data-state=invite-no-account]')") and await F.evaluate(UIDJS) is None)
        cg, G = await newp(b, 'Ztracené přihlášení'); await G.goto(BASE); await G.wait_for_timeout(800)
        await G.evaluate(f"localStorage.setItem('bandapp-friends-rooms',JSON.stringify([{{id:'{room}',name:'Kamarádky',role:'approved'}}]));localStorage.setItem('bandapp-friends-state-uid',JSON.stringify('{uT}'))")
        await G.goto('about:blank'); await G.goto(BASE + '#videochat'); lost = await wait(G, f"(document.getElementById('vcLostAccount')||{{textContent:''}}).textContent.includes('{cT}')", 20000)
        ok('ztracené přihlášení (skupiny v zařízení, účet ne): VIDEOCHAT varuje s kódem ' + cT + ', nic nezaloží', lost and await G.evaluate(UIDJS) is None)
        await G.goto('about:blank'); await kam(G); ok('ztracené přihlášení: Kamarádky varují se známým kódem, nic nezaloží', await wait(G, f"(document.getElementById('frKnownAccount')||{{textContent:''}}).textContent.includes('{cT}')") and await G.evaluate(UIDJS) is None)
        # ===== nesoulad kódů (jako BD619B / 7DFE2E): nainstalovaná aplikace má jiný (prázdný) účet → obnova kódem =====
        cpp, P = await newp(b, 'Táta – nainstalovaná aplikace'); await kam(P); await wait(P, "document.getElementById('frNewAccount')"); await P.click('#frNewAccount')
        await wait(P, "document.getElementById('frCreate')"); uP = await P.evaluate(UIDJS); cP = await P.evaluate(CODEJS)
        ok('nesoulad zreprodukován: druhé přihlášení = jiný účet a jiný kód (' + str(cP) + ' ≠ ' + str(cT) + ')', uP and uP != uT and cP != cT)
        await kam(T); await wait(T, "document.getElementById('frAccount')"); await T.evaluate("document.getElementById('frAccount').open=true")
        await wait(T, "document.getElementById('frMakeCode')"); await T.click('#frMakeCode')
        await wait(T, "document.getElementById('frCodeValue')"); rcode = await T.inner_text('#frCodeValue'); await T.click('#frCodeDone')
        ok('Zabezpečit účet: obnovovací kód vytvořen, uid i kód účtu beze změny', re.match(r'BAND-', rcode) and await T.evaluate(UIDJS) == uT and await T.evaluate(CODEJS) == cT)
        await P.evaluate("document.getElementById('frAccount').open=true"); await wait(P, "document.getElementById('frRestoreCode')")
        await P.fill('#frRestoreCode', 'BAND-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA'); await P.click('#frRestore'); await P.wait_for_timeout(2500)
        ok('obnova špatným kódem: nic se nezmění', await P.evaluate(UIDJS) == uP)
        await kam(P); await P.evaluate("document.getElementById('frAccount').open=true"); await wait(P, "document.getElementById('frRestoreCode')")
        await P.fill('#frRestoreCode', rcode.lower().replace('-', ' ')); await P.click('#frRestore')
        ok('obnova správným kódem: STEJNÉ uid jako v prohlížeči', await until(P, UIDJS, uT))
        ok('obnova: kód účtu teď sedí (' + str(await P.evaluate(CODEJS)) + ')', await P.evaluate(CODEJS) == cT)
        ok('obnova: skupina je zpět v zařízení jako schválená', await wait(P, f"JSON.stringify({ROOMS}).includes('{room}:approved')", 20000))
        lc = await codes(A, 'Táta'); ok('obnova: u Laurinky pořád JEDEN Táta se stejným kódem (žádné duplicitní členství)', len(lc) == 1 and cT in lc[0][2], lc)
        await T.goto('about:blank'); await P.goto(BASE + '#studio'); await P.wait_for_timeout(2500)
        await ring(A, P, uT, 'po obnově (druhé zařízení)')
        # ===== převod členství (ztracené všechno, žádný obnovovací kód po ruce) =====
        await T.goto(BASE); await T.wait_for_timeout(1200)
        ok('starý účet pošle zprávu', await T.evaluate(f"import('./friends.js').then(f=>f.sendMessage('{room}','Táta','Zpráva ze starého účtu')).then(()=>'ok',e=>e.code||String(e))") == 'ok')
        cn, N = await newp(b, 'Táta – nový účet'); ok('nový účet: pozvánka → výslovně „Založit“ → žádost „Táta“', await join(N, await invite(A), 'Táta'))
        uN = await N.evaluate(UIDJS); cN = await N.evaluate(CODEJS)
        lc = await codes(A, 'Táta'); ok('zakladatelka vidí 2× Táta s OBĚMA kódy', sorted(x[0] for x in lc) == ['approved', 'pending'] and any(cT in x[2] for x in lc) and any(cN in x[2] for x in lc), lc)
        ok('varování o stejné přezdívce', await A.locator('#frContacts [data-dup]').count() == 2)
        li = A.locator(f'#frContacts li[data-uid="{uN}"]'); await li.locator('[data-act=transfer-open]').click()
        ok('převod: předvybraný starý účet je Táta (stejná přezdívka)', await li.locator('select[data-transfer-from]').input_value() == uT)
        bad = 'AAAAAA' if cN != 'AAAAAA' else 'BBBBBB'
        await li.locator('[data-transfer-code]').fill(bad); await li.locator('[data-act=transfer-go]').click(); await A.wait_for_timeout(1500)
        lc = await codes(A, 'Táta'); ok('převod se ŠPATNÝM kódem odmítnut, nic se nezměnilo', sorted(x[0] for x in lc) == ['approved', 'pending'], lc)
        li = A.locator(f'#frContacts li[data-uid="{uN}"]')
        if not await li.locator('[data-transfer-code]').is_visible(): await li.locator('[data-act=transfer-open]').click()
        await li.locator('[data-transfer-code]').fill(cN.lower()); await li.locator('[data-act=transfer-go]').click()
        done = await wait(A, f"!!document.querySelector('#frContacts li[data-uid=\"{uT}\"][data-status=replaced]')&&!!document.querySelector('#frContacts li[data-uid=\"{uN}\"][data-status=approved]')")
        ok('převod správným kódem: nový účet schválen, starý označen „převedeno“ (NEsmazán)', done)
        lc = await codes(A, 'Táta'); ok('po převodu: jediný aktivní Táta (nový kód), starý jako „předchozí kód“', [x[0] for x in lc if x[0] != 'replaced'] == ['approved'] and any(x[0] == 'replaced' and cT in x[2] for x in lc), lc)
        rp = await A.evaluate(f"(document.querySelector('#frContacts li[data-uid=\"{uT}\"] [data-replaced]')||{{textContent:''}}).textContent")
        ok('převedený záznam ukazuje „převedeno na: Táta · kód ' + str(cN) + '“', cN in rp, rp)
        await kam(N); await wait(N, "document.getElementById('frOpenChat')"); await N.click('#frOpenChat')
        await wait(N, "[...document.querySelectorAll('.msgs .msg')].some(m=>m.textContent.includes('Zpráva ze starého účtu'))", 20000)
        mine = await N.evaluate("[...document.querySelectorAll('.msgs .msg.me')].map(m=>m.textContent)")
        ok('nový účet vidí starou zprávu jako SVOU (stejná osoba)', any('Zpráva ze starého účtu' in x for x in mine), mine[:3])
        await kam(P); ok('starý účet (druhé zařízení) ukáže „členství převedeno“ a ztratí přístup', await wait(P, "!!document.querySelector('[data-state=replaced]')"))
        deny = await P.evaluate(f"import('./friends.js').then(f=>f.transferMember('{room}','{uN}','{uT}','{cT}')).then(()=>'ok',e=>e.code||String(e))")
        ok('člen (ne zakladatelka) převod přímo přes SDK neudělá', deny != 'ok', deny)
        await N.goto(BASE + '#skola'); await N.wait_for_timeout(2500); await ring(A, N, uN, 'po převodu (nový účet)')
        ok('VIDEOCHAT u Laurinky: starý účet už není mezi volatelnými', await A.locator(f'#vcPeopleList li[data-uid="{uT}"]').count() == 0)
        for n, e in ERRS.items(): ok(f'{n}: žádné chyby stránky', not e, e[:3])
        ok('žádný požadavek mimo localhost/gstatic', not BLOCKED, BLOCKED[:3])
        await ct.close(); await b.close()
    srv.shutdown()
    print(f'SOUHRN (Chromium headless + emulátor, ne skutečné telefony): {sum(R)}/{len(R)} PASS')
asyncio.run(main())
