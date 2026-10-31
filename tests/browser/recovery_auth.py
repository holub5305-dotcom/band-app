"""BAND APP 1.2.6 – regrese podle hlášení 31. 10. 2026 14:54: Tátův telefon (účet 7DFE2E, nainstalovaná aplikace)
ukazuje ve VIDEOCHAT → Diagnostika „Firebase nepřipojeno · Přihlášení odhlášeno · naslouchání neaktivní“, obnova
vlastním obnovovacím kódem nic nezmění a „Znovu připojit hovory“ nic neudělá; Laurinčin účet (bez obnovovacího kódu) jde.
Příčina (1.2.1–1.2.5): videochat.js bral místní značku „účet má obnovovací kód“ (recoverable-uid → lockedReason()
= 'changed') jako „odhlášeno“ i u PŘIHLÁŠENÉHO účtu → Firebase se ve VIDEOCHATu vůbec nenačetl.
TREE = strom aplikace, EXPECT=bug (1.2.5: reprodukce) nebo fixed (1.2.6).
Scénáře: kód vytvořen → restart; obnova vlastním kódem (stejné uid); ztracené přihlášení při kódu v localStorage;
obnova kódem JINÉHO účtu; výpadek sítě při obnově a při „Znovu připojit hovory“. Headless Chromium + emulátor."""
import asyncio, os, re, json, shutil, subprocess, threading, functools, http.server
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); RULES = os.path.join(HERE, '..', '..', 'firestore.rules')
TREE = os.environ.get('TREE', os.path.join(HERE, '..', '..')); EXPECT = os.environ.get('EXPECT', 'fixed')   # EXPECT=bug → reprodukce na 1.2.4
SEED_CWD = os.environ.get('SEED_CWD', HERE); LR = os.path.join(SEED_CWD, '_load_rules.mjs'); shutil.copy(os.path.join(HERE, 'load_rules.mjs'), LR)
SERVE = '/tmp/bandapp-recauth-serve'; LINK = SERVE + '/band-app'; PORT = 8799
BASE = f'http://localhost:{PORT}/band-app/index.html?emulator=1'
UDT = '/tmp/bandapp-recauth-profile'
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

DIAG = "(async()=>{const d=document.getElementById('vcDiag');if(!d)return '';d.open=true;await new Promise(r=>setTimeout(r,2500));return d.innerText})()"
def row(dg, k):
    m = re.search(re.escape(k) + r'\s*\n\s*([^\n]*)', dg); return m.group(1) if m else ''
async def vc(pg):
    await pg.goto(BASE + '#videochat'); await pg.wait_for_timeout(3000); return await pg.evaluate(DIAG)
async def make_code(pg):
    await kam(pg); await wait(pg, "document.getElementById('frAccount')"); await pg.evaluate("document.getElementById('frAccount').open=true")
    await wait(pg, "document.getElementById('frMakeCode')"); await pg.click('#frMakeCode')
    await wait(pg, "document.getElementById('frCodeValue')"); c = await pg.inner_text('#frCodeValue'); await pg.click('#frCodeDone'); return c
async def lose_auth(pg):     # přihlášení Firebase v zařízení zmizí (IndexedDB), localStorage (skupiny, kód) zůstane
    await pg.goto(f'http://localhost:{PORT}/band-app/robots.txt')
    return await pg.evaluate("new Promise(r=>{const q=indexedDB.deleteDatabase('firebaseLocalStorageDb');q.onsuccess=()=>r('ok');q.onerror=()=>r('err');q.onblocked=()=>r('blocked')})")
async def restore_kam(pg, code):  # Kamarádky → obrazovka obnovy (odhlášené zařízení) nebo Můj účet → Obnovit účet
    await kam(pg); await pg.wait_for_timeout(1500)
    if await pg.locator('#frRestoreGo').count():
        await pg.fill('#frRestoreCode', code); await pg.click('#frRestoreGo')
    else:
        if await pg.locator('#frNoAccRestore').count(): await pg.click('#frNoAccRestore'); await wait(pg, "document.getElementById('frRestoreGo')"); await pg.fill('#frRestoreCode', code); await pg.click('#frRestoreGo')
        else:
            await pg.evaluate("document.getElementById('frAccount').open=true"); await wait(pg, "document.getElementById('frRestore')")
            await pg.fill('#frRestoreCode', code); await pg.click('#frRestore')
    await pg.wait_for_timeout(3500)
    return await pg.evaluate("[...document.querySelectorAll('#frFlash,#frAccountMsg,#friendsApp .err:not([hidden]),#friendsApp [role=alert]:not([hidden])')].map(e=>e.textContent).join(' | ')")
async def retry(pg):
    await pg.evaluate("document.getElementById('vcDiag').open=true"); await wait(pg, "document.getElementById('vcDiagRetry')")
    await pg.click('#vcDiagRetry'); await pg.wait_for_timeout(4000)
    return await pg.evaluate("(document.getElementById('vcRetryMsg')||{textContent:''}).textContent"), await pg.evaluate(DIAG)

async def main():
    shutil.rmtree(UDT, ignore_errors=True); point(TREE)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Hd, directory=SERVE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    sr = subprocess.run(['node', LR, RULES], capture_output=True, text=True, cwd=SEED_CWD); ok('emulátor: pravidla z větve nahrána', 'rules loaded' in sr.stdout, sr.stderr.strip()[-300:])
    fixed = EXPECT == 'fixed'
    async with async_playwright() as p:
        b = await p.chromium.launch(args=FAKE)
        ca, A = await newp(b, 'Laurinka')
        ok('Laurinka založí skupinu', await create_group(A, 'Laurinka', 'Kamarádky'))
        uA = await A.evaluate(UIDJS)
        cpp, P = await persistent(p)
        ok('Táta (nainstalovaná aplikace) se přidá a je schválen', await join(P, await invite(A), 'Táta') and await approve(A, 'Táta'))
        uP = await P.evaluate(UIDJS); cP = await P.evaluate(CODEJS)
        await P.goto(BASE + '#videochat'); await wait(P, "!!document.getElementById('vcDiag')")
        for _ in range(15):
            dg = await P.evaluate(DIAG)
            if 'AKTIVNÍ' in row(dg, 'Naslouchání příchozím hovorům'): break
        ok('výchozí stav: Tátův VIDEOCHAT připojený a naslouchá (bez obnovovacího kódu)', row(dg, 'Firebase') == 'připojeno' and 'AKTIVNÍ' in row(dg, 'Naslouchání příchozím hovorům'), row(dg, 'Firebase') + ' / ' + row(dg, 'Naslouchání příchozím hovorům'))
        rcode = await make_code(P)
        ok('Táta si vytvoří obnovovací kód (Kamarádky → Můj účet)', rcode.startswith('BAND-'))
        ok('vytvoření kódu nezmění uid', await P.evaluate(UIDJS) == uP)
        await P.goto('about:blank'); await P.wait_for_timeout(500)
        dg = await vc(P)
        await kam(P); acct = await mycode_ui(P)
        ok(f'Kamarádky → Můj účet: Kód účtu {cP} (Firebase je SKUTEČNĚ přihlášený)', cP in acct and await P.evaluate(UIDJS) == uP, acct[:80])
        await P.goto(BASE + '#videochat'); await P.wait_for_timeout(3000); dg = await P.evaluate(DIAG)
        f, a, n = row(dg, 'Firebase'), row(dg, 'Přihlášení'), row(dg, 'Naslouchání příchozím hovorům')
        # Laurinka volá Tátu
        await A.goto(BASE + '#videochat'); await wait(A, f"!!document.querySelector('#vcPeopleList li[data-uid=\"{uP}\"] [data-act=video]:not([disabled])')")
        await A.locator(f'#vcPeopleList li[data-uid="{uP}"] [data-act=video]').click()
        rang = await wait(P, "document.getElementById('vcIncoming')", 25000)
        if not fixed:
            ok('REPRODUKCE 1.2.5: po vytvoření kódu VIDEOCHAT „Firebase nepřipojeno“', f == 'nepřipojeno', f)
            ok('REPRODUKCE 1.2.5: „Přihlášení odhlášeno“, přestože Firebase přihlášený je', a.startswith('odhlášeno'), a)
            ok('REPRODUKCE 1.2.5: naslouchání neaktivní', n.startswith('neaktivní'), n)
            ok('REPRODUKCE 1.2.5: hovor od Laurinky NEZAZVONÍ', not rang)
            await A.evaluate("document.getElementById('vcHang')&&document.getElementById('vcHang').click()")
            msg = await restore_kam(P, rcode)
            ok('REPRODUKCE 1.2.5: obnova vlastním kódem = „už je přihlášený“ (stejné uid, nic se nezmění)', 'už je na tomto zařízení přihlášený' in msg and await P.evaluate(UIDJS) == uP, msg)
            await P.goto(BASE + '#videochat'); await P.wait_for_timeout(2500)
            await P.evaluate("document.getElementById('vcDiag').open=true"); await wait(P, "document.getElementById('vcDiagRetry')"); await P.click('#vcDiagRetry'); await P.wait_for_timeout(3000)
            dg = await P.evaluate(DIAG)
            ok('REPRODUKCE 1.2.5: po obnově i po „Znovu připojit hovory“ pořád nepřipojeno / odhlášeno', row(dg, 'Firebase') == 'nepřipojeno' and row(dg, 'Přihlášení').startswith('odhlášeno'), row(dg, 'Firebase') + ' / ' + row(dg, 'Přihlášení'))
            ok('REPRODUKCE 1.2.5: „Znovu připojit hovory“ nic viditelného neohlásí', not await P.locator('#vcRetryMsg').count())
        else:
            ok('1.2.6: po vytvoření kódu a restartu VIDEOCHAT „Firebase připojeno“', f == 'připojeno', f)
            ok(f'1.2.6: Přihlášení „ano · obnovovací kód“, Kód účtu {cP}', a.startswith('ano') and 'obnovovací kód' in a and row(dg, 'Kód účtu') == cP, a)
            ok('1.2.6: naslouchání AKTIVNÍ', 'AKTIVNÍ' in n, n)
            ok('1.2.6: hovor Laurinka → Táta ZAZVONÍ', rang)
            if rang:
                await P.click('#vcAccept'); ok('1.2.6: hovor Laurinka → Táta spojen', await wait(A, CONN, 25000) and await wait(P, CONN, 25000))
                await A.click('#vcHang'); await wait(P, "!document.getElementById('vcCall')", 10000)
            else: await A.evaluate("document.getElementById('vcHang')&&document.getElementById('vcHang').click()")
            await A.goto(BASE + '#studio')
            if await wait(P, f"!!document.querySelector('#vcPeopleList li[data-uid=\"{uA}\"] [data-act=video]:not([disabled])')"):
                await P.locator(f'#vcPeopleList li[data-uid="{uA}"] [data-act=video]').click()
                g = await wait(A, "document.getElementById('vcIncoming')", 25000); ok('1.2.6: Táta → Laurinka zazvoní', g)
                if g: await A.click('#vcAccept'); ok('1.2.6: hovor Táta → Laurinka spojen', await wait(P, CONN, 25000)); await P.click('#vcHang'); await wait(A, "!document.getElementById('vcCall')", 10000)
            else: ok('1.2.6: Táta vidí Laurinku', False)
            # „Znovu připojit hovory“ – viditelný pokus a výsledek
            await P.goto(BASE + '#videochat'); await P.wait_for_timeout(2500)
            m, dg = await retry(P)
            ok(f'1.2.6: „Znovu připojit hovory“ ohlásí výsledek (přihlášeno, kód {cP}, naslouchání)', cP in m and 'Přihlášeno' in m and 'AKTIVNÍ' in m, m)
            # obnova vlastním kódem, když už přihlášený je
            msg = await restore_kam(P, rcode)
            ok(f'1.2.6: obnova vlastním kódem → „kód patří účtu {cP}, už přihlášený“, stejné uid', cP in msg and 'už' in msg and await P.evaluate(UIDJS) == uP, msg)
            # výpadek sítě (auth emulátor nedostupný) při „Znovu připojit“
            await cpp.route('http://127.0.0.1:9099/**', lambda r: r.abort())
            await P.goto(BASE + '#videochat'); await P.wait_for_timeout(2500)
            m, dg = await retry(P)
            ok('1.2.6: „Znovu připojit“ bez spojení s Firebase ohlásí kategorii chyby (auth/network-request-failed)', 'auth/network-request-failed' in m, m)
            ok('1.2.6: výpadek sítě účet NEODHLÁSÍ (stejné uid)', await P.evaluate(UIDJS) == uP)
            await cpp.unroute('http://127.0.0.1:9099/**')
            # ===== přihlášení se ztratí, místní data (skupiny, značka kódu) zůstanou =====
            ok('ztráta přihlášení (IndexedDB firebaseLocalStorageDb smazána)', await lose_auth(P) == 'ok')
            await kam(P); await P.wait_for_timeout(2500)
            t = await P.evaluate("document.getElementById('friendsApp').innerText")
            ok('1.2.6: Kamarádky NEukazují kód účtu jako přihlášený, ale „odhlášeno – obnov účet“', 'odhlášeno – obnov účet' in t.lower() and not await P.locator('#frMyAccountCode').count(), t[:200])
            ok(f'1.2.6: Kamarádky řeknou, který účet tu byl ({cP})', cP in t, t[:300])
            ok('1.2.6: žádný nový účet nevznikl', await P.evaluate(UIDJS) is None)
            await P.goto(BASE + '#videochat'); await P.wait_for_timeout(3000); dg = await P.evaluate(DIAG)
            ok('1.2.6: VIDEOCHAT: Přihlášení „odhlášeno – obnov účet“, Kód účtu NE jako přihlášený', 'odhlášeno – obnov účet' in row(dg, 'Přihlášení') and row(dg, 'Kód účtu') in ('–', ''), row(dg, 'Přihlášení') + ' / ' + row(dg, 'Kód účtu'))
            m, dg = await retry(P)
            ok(f'1.2.6: „Znovu připojit“ při odhlášení ohlásí „odhlášeno – obnov účet“ + dřívější kód {cP}, nic nezaloží', 'odhlášeno – obnov účet' in m.lower() and cP in m and await P.evaluate(UIDJS) is None, m)
            # výpadek sítě při obnově kódem
            await cpp.route('http://127.0.0.1:9099/**', lambda r: r.abort())
            msg = await restore_kam(P, rcode)
            ok('1.2.6: obnova bez spojení → česká hláška + kategorie auth/network-request-failed', 'auth/network-request-failed' in msg and 'internet' in msg.lower(), msg)
            await cpp.unroute('http://127.0.0.1:9099/**')
            # špatný kód (správný tvar)
            msg = await restore_kam(P, 'BAND-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA')
            ok('1.2.6: neplatný kód → „Kód nesouhlasí“ + kategorie auth/…', 'Kód nesouhlasí' in msg and 'auth/' in msg, msg)
            ok('1.2.6: neplatný kód nic nepřihlásí', await P.evaluate(UIDJS) is None)
            # správná obnova
            msg = await restore_kam(P, rcode)
            ok(f'1.2.6: obnova kódem → STEJNÉ uid (kód {cP}), žádný nový účet', await P.evaluate(UIDJS) == uP, msg)
            ok(f'1.2.6: obnova ohlásí „Přihlášeno – účet {cP}“', cP in msg, msg)
            await A.goto(BASE + '#studio'); await P.goto(BASE + '#videochat'); await P.wait_for_timeout(3500); dg = await P.evaluate(DIAG)
            ok('1.2.6: po obnově VIDEOCHAT připojený a naslouchá', row(dg, 'Firebase') == 'připojeno' and 'AKTIVNÍ' in row(dg, 'Naslouchání příchozím hovorům'), row(dg, 'Firebase') + ' / ' + row(dg, 'Naslouchání příchozím hovorům'))
            await A.goto(BASE + '#videochat'); await wait(A, f"!!document.querySelector('#vcPeopleList li[data-uid=\"{uP}\"] [data-act=video]:not([disabled])')")
            await A.locator(f'#vcPeopleList li[data-uid="{uP}"] [data-act=video]').click()
            g = await wait(P, "document.getElementById('vcIncoming')", 25000); ok('1.2.6: po obnově hovor Laurinka → Táta zazvoní', g)
            if g: await P.click('#vcAccept'); ok('1.2.6: a spojí se', await wait(A, CONN, 25000)); await A.click('#vcHang'); await wait(P, "!document.getElementById('vcCall')", 10000)
            # ===== obnovovací kód JINÉHO účtu =====
            cx, X = await newp(b, 'Táta test 2')
            ok('„Táta test 2“ (jiný účet) se přidá a je schválen', await join(X, await invite(A), 'Táta test 2') and await approve(A, 'Táta test 2'))
            uX = await X.evaluate(UIDJS); cX = await X.evaluate(CODEJS); xcode = await make_code(X); await cx.close()
            ok('ztráta přihlášení podruhé', await lose_auth(P) == 'ok')
            msg = await restore_kam(P, xcode)
            ok(f'1.2.6: kód jiného účtu → jasně „obnovovací kód patří účtu {cX}“ (ne {cP})', f'patří účtu {cX}' in msg and cP in msg, msg)
            ok('1.2.6: kód jiného účtu přihlásí jen ten účet (žádné sloučení, žádný nový účet)', await P.evaluate(UIDJS) == uX)
            await kam(A); cl = await codes(A, 'Táta')
            ok('1.2.6: členství beze změny – Táta i Táta test 2 dál schválení, nic převedeno ani smazáno', sorted(x[0] for x in cl) == ['approved', 'approved'] and {x[1] for x in cl} == {uP, uX}, cl)
            ok('návrat: lose_auth', await lose_auth(P) == 'ok')
            msg = await restore_kam(P, rcode); ok(f'zpět vlastním kódem → uid {cP}', await P.evaluate(UIDJS) == uP, msg)
            room = (await A.evaluate(ROOMS))[0].split(':')[0]
            n = await P.evaluate(f"import('./friends.js').then(async f=>{{await f.connect();return new Promise(r=>{{f.watchMessages('{room}',m=>r(m.length),e=>r('ERR '+e.code))}})}})")
            ok('Tátovy skupiny dostupné i po všech obnovách', isinstance(n, int), n)
        for nme, e in ERRS.items(): ok(f'{nme}: žádné chyby stránky', not e, e[:3])
        ok('žádný požadavek mimo localhost/gstatic', not BLOCKED, BLOCKED[:3])
        await cpp.close(); await b.close()
    srv.shutdown()
    print(f'SOUHRN (Chromium headless + emulátor, ne skutečné telefony): {sum(R)}/{len(R)} PASS', flush=True)
    raise SystemExit(0 if all(R) else 1)

asyncio.run(main())
