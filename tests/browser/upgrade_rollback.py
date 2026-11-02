"""BAND APP: 1.1.3 (produkce, band-app-pages-10) → 1.2.0 (band-app-pages-11) → NÁVRAT 1.1.3 (band-app-pages-12)
na STEJNÉ adrese /band-app/ v JEDNOM trvalém profilu Chromu (Pixel 7) se skupinou Kamarádky ve Firebase EMULÁTORU.
Ověřuje: data bit po bitu (localStorage, nahrávky SHA-256), stejné přihlášení (uid), manifest (identita PWA),
SW aktualizace, zprávy čtení/zápis, VIDEOCHAT (falešná kamera), původní funkce. AUTOMATICKÝ test, ne skutečný telefon.
Spuštění: emulátor (auth 9099, firestore 8080, demo-bandapp); OLD/NEW/ROLL = složky s 1.1.3 / 1.2.0 / návratem."""
import asyncio, json, os, shutil, subprocess, sys, time
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import upgrade_helpers as H
from upgrade_helpers import ok
OLD, NEW, ROLL = os.environ['OLD'], os.environ['NEW'], os.environ['ROLL']
# Verze nové aplikace a čísla mezipamětí (výchozí = vydání 1.2.0; pro 1.2.1: NEWV=1.2.1 NEWC=12 ROLLC=13)
NEWV, NEWC, ROLLC = os.environ.get('NEWV', '1.2.0'), os.environ.get('NEWC', '11'), os.environ.get('ROLLC', '12')
# Výchozí stará verze = 1.1.3 (pages-10, bez VIDEOCHATU). Pro 1.2.7 → 1.3.0: OLDV=1.2.7 OLDC=21.
OLDV, OLDC = os.environ.get('OLDV', '1.1.3'), os.environ.get('OLDC', '10')
# Kód účtu (např. 7DFE2E) = prvních 6 znaků SHA-256(uid) – počítá ho friends.js; musí být před i po aktualizaci stejný.
CODE = "import('./friends.js').then(m=>m.deviceCode?m.deviceCode(%s):'')"
SEED_CWD = os.environ['SEED_CWD']; SEED = os.path.join(SEED_CWD, '_seed_vc.mjs'); shutil.copy(os.path.join(HERE, 'seed.mjs'), SEED)
SERVE = os.environ.get('SERVE', '/tmp/bandapp-serve'); LINK = SERVE + '/band-app'; PORT = 8796
BASE = f'http://localhost:{PORT}/band-app/'; URL = BASE + 'index.html?emulator=1'
UD = '/tmp/bandapp-upgrade-rollback-profile'
FAKE = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']
ALLOW = ('http://localhost', 'http://127.0.0.1', 'https://www.gstatic.com/firebasejs/', 'data:', 'blob:')
BLOCKED = []; ERRS = []; PH = ['1.1.3']
# apis.google.com/js/api.js = pomocný iframe Firebase Auth SDK (stejně v 1.1.3 i 1.2.0); v testu blokovaný, mimo síť nic nejde.
AUTH_IFRAME = 'https://apis.google.com/js/api.js'
async def guard(r):
    u = r.request.url
    if u.startswith(ALLOW): await r.continue_()
    else:
        if not u.startswith('https://www.google.com/images/cleardot.gif'): BLOCKED.append((PH[0], u[:60]))
        await r.abort()
def point(t):
    os.makedirs(SERVE, exist_ok=True)
    if os.path.lexists(LINK): os.unlink(LINK)
    os.symlink(t, LINK)
async def openA(p):
    dev = {k: v for k, v in p.devices['Pixel 7'].items() if k != 'default_browser_type'}
    c = await p.chromium.launch_persistent_context(UD, headless=True, args=FAKE, permissions=['camera', 'microphone'], **dev)
    await c.route('**/*', guard); await c.add_init_script(H.INIT)
    pg = c.pages[0] if c.pages else await c.new_page()
    pg.on('pageerror', lambda e: ERRS.append(str(e))); pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
    return c, pg
MSGS = """(async()=>{const f=await import('./friends.js');const out=await new Promise((res,rej)=>{let u;f.watchMessages('%s',m=>{res(m.map(x=>x.text));setTimeout(()=>u&&u(),0)},rej).then(x=>u=x)});return out})()"""
SEND = "import('./friends.js').then(f=>f.sendMessage('%s','Laurinka','%s')).then(()=>'ok',e=>e.code||String(e))"
UID = "import('./friends.js').then(async m=>{if(m.createAccount) await m.createAccount(); return m.connect()}).then(f=>f.uid)"
IDBN = "indexedDB.databases().then(d=>d.map(x=>x.name).sort())"
async def wait(pg, js, t=25000):
    try: await pg.wait_for_function(js, timeout=t); return True
    except Exception: return False
async def msgs(pg, room):
    try: return await asyncio.wait_for(pg.evaluate(MSGS % room), 15)
    except Exception as e: return 'ERR ' + str(e)[:120]
async def main():
    shutil.rmtree(UD, ignore_errors=True); point(OLD)
    srv = subprocess.Popen(['python3', os.path.join(HERE, 'srv.py'), str(PORT)], cwd=SERVE); time.sleep(1)
    room = 'kamaradky1'
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=FAKE)
            cB = await b.new_context(permissions=['camera', 'microphone'], viewport={'width': 412, 'height': 915}); await cB.route('**/*', guard)
            B = await cB.new_page(); B.on('pageerror', lambda e: ERRS.append('B ' + str(e)))
            await B.goto(URL); uB = await B.evaluate(UID)
            # ================= 1.1.3 =================
            cA, A = await openA(p); await A.goto(URL); await A.wait_for_function("navigator.serviceWorker.ready.then(()=>true)"); await A.reload(); await A.wait_for_timeout(1200)
            ok(OLDV + ': řízeno band-app-pages-' + OLDC, await A.evaluate('caches.keys()') == ['band-app-pages-' + OLDC], await A.evaluate('caches.keys()'))
            uA = await A.evaluate(UID); code0 = await A.evaluate(CODE % json.dumps(uA)); print('kód účtu před aktualizací:', code0)
            seed = {'room': room, 'name': 'Kamarádky', 'owner': uA, 'members': [{'uid': uA, 'nick': 'Laurinka', 'status': 'owner'}, {'uid': uB, 'nick': 'Amy', 'status': 'approved'}],
                    'messages': [{'uid': uA, 'nick': 'Laurinka', 'text': 'Ahoj holky 🎸', 'ago': 120000}, {'uid': uB, 'nick': 'Amy', 'text': 'Čau, zkouška v pět?', 'ago': 60000}]}
            sr = subprocess.run(['node', SEED, os.path.join(NEW, 'firestore.rules'), json.dumps(seed)], capture_output=True, text=True, cwd=SEED_CWD); print(sr.stdout.strip(), sr.stderr[-300:])
            await A.evaluate(f"localStorage.setItem('bandapp-friends-rooms', JSON.stringify([{{id:'{room}',name:'Kamarádky',role:'owner'}}]));localStorage.setItem('bandapp-friends-nick', JSON.stringify('Laurinka'))")
            await A.reload(); await A.wait_for_timeout(1500)
            ok(OLDV + ': Kamarádky zobrazeny', await wait(A, "document.getElementById('friendsApp').innerText.includes('Kamarádky')"))
            m = await msgs(A, room); ok(OLDV + ': zprávy skupiny čitelné', m == ['Ahoj holky 🎸', 'Čau, zkouška v pět?'] or sorted(m) == sorted(['Ahoj holky 🎸', 'Čau, zkouška v pět?']), m)
            ok(OLDV + ': odeslání zprávy', await A.evaluate(SEND % (room, 'Před aktualizací')) == 'ok')
            ok(OLDV + ': nahrávka 1', 'uložena' in await H.record(A, 1500)); await A.wait_for_timeout(300); ok(OLDV + ': nahrávka 2', 'uložena' in await H.record(A, 900))
            await A.fill('#favName', 'Ghost'); await A.fill('#favUrl', 'https://open.spotify.com/artist/x'); await A.click('#favoriteForm button')
            await A.evaluate("localStorage.setItem('bandapp-lesson-em-done', JSON.stringify({done:true,date:'2026-10-30'}))")
            ok(OLDV + ': VIDEOCHAT v menu ' + ('ne' if OLDC == '10' else 'ano'), (await A.locator('nav.bandnav a[href="#videochat"]').count() == 0) == (OLDC == '10'))
            await A.wait_for_timeout(2000)
            m0 = await H.cdp_manifest(cA, A); ls0 = await A.evaluate(H.LSK); r0 = await A.evaluate(H.RECH); idb0 = await A.evaluate(IDBN)
            ok(OLDV + ': výchozí data (2 nahrávky, oblíbené, lekce, přezdívka, skupina)', len(r0) == 2 and {'bandapp-favorites', 'bandapp-lesson-em-done', 'bandapp-friends-rooms', 'bandapp-friends-nick'} <= set(ls0), sorted(ls0))
            await cA.close()
            # ================= 1.2.0 na stejné adrese =================
            point(NEW); PH[0] = NEWV
            cA, A = await openA(p); await A.goto(URL); await A.wait_for_timeout(800)
            flow = await A.evaluate(H.UPDATE_FLOW); ok(NEWV + ': SW aktualizace → activated', flow[-1] == 'activated', flow)
            ck = await A.evaluate('caches.keys()'); ok(NEWV + ': jen band-app-pages-11 (pages-10 smazána)', ck == ['band-app-pages-' + NEWC], ck)
            await A.reload(); await A.wait_for_timeout(2000)
            ls1 = await A.evaluate(H.LSK); diff = [k for k in ls0 if ls1.get(k) != ls0[k]]
            ok(NEWV + ': localStorage – všechny původní klíče bit po bitu stejné', not diff, {'změněné': diff, 'nové': sorted(set(ls1) - set(ls0))})
            ok(NEWV + ': nahrávky bit po bitu stejné (SHA-256)', await A.evaluate(H.RECH) == r0)
            idb1 = await A.evaluate(IDBN); ok(NEWV + ': databáze IndexedDB zachované', set(idb0) <= set(idb1), (idb0, idb1))
            ok(NEWV + ': stejné přihlášení (uid)', await A.evaluate(UID) == uA)
            c1 = await A.evaluate(CODE % json.dumps(uA)); ok(NEWV + ': stejný kód účtu (' + str(c1) + ')', bool(code0) == (OLDC != '10') and c1 == (code0 or c1) and len(c1) == 6, (code0, c1))
            m1 = await H.cdp_manifest(cA, A); ok(NEWV + ': manifest identický (id, start_url, scope, název, ikony)', m1[0].get('data') == m0[0].get('data') and m1[0].get('url') == m0[0].get('url') and not m1[1].get('installabilityErrors'), m1[0].get('url'))
            ok(NEWV + ': patička „BAND APP 1.2.0“, menu VIDEOCHAT', 'BAND APP ' + NEWV in await A.inner_text('.footer') and await A.locator('nav.bandnav a[href="#videochat"]').count() == 1)
            ok(NEWV + ': Kamarádky zobrazeny', await wait(A, "document.getElementById('friendsApp').innerText.includes('Kamarádky')"))
            m = await msgs(A, room); ok(NEWV + ': všechny 3 zprávy čitelné', isinstance(m, list) and len(m) == 3 and 'Před aktualizací' in m, m)
            ok(NEWV + ': odeslání zprávy jako dřív', await A.evaluate(SEND % (room, 'Po aktualizaci')) == 'ok')
            await H.features(A, NEWV)
            # videohovor A (aktualizovaná instalace) ↔ B
            await B.reload(); await B.wait_for_timeout(800)
            await B.evaluate(f"localStorage.setItem('bandapp-friends-rooms', JSON.stringify([{{id:'{room}',name:'Kamarádky',role:'approved'}}]));localStorage.setItem('bandapp-friends-nick', JSON.stringify('Amy'))")
            await B.reload()
            ok(NEWV + ': VIDEOCHAT nabízí Amy', await wait(A, "[...document.querySelectorAll('#vcPeopleList .vc-name')].some(e=>e.textContent==='Amy')") and await wait(B, "document.querySelectorAll('#vcPeopleList li').length===1"))
            await A.click(f'#vcPeopleList li[data-uid="{uB}"] [data-act=video]')
            await wait(B, "document.getElementById('vcIncoming')"); await B.click('#vcAccept')
            conn = "(()=>{const s=window.__vc&&window.__vc.state();return s&&s.pcs.length==1&&['connected','completed'].includes(s.pcs[0][1])&&/video:live/.test(s.pcs[0][2])})()"
            ok(NEWV + ': videohovor po aktualizaci spojen (obraz+zvuk)', await wait(A, conn) and await wait(B, conn))
            await A.click('#vcHang'); ok(NEWV + ': hovor ukončen', await wait(A, "!__vc.state()") and await wait(B, "!__vc.state()"))
            ok(NEWV + ': nová nahrávka', 'uložena' in await H.record(A, 900))
            await A.wait_for_timeout(2000)
            ls1 = await A.evaluate(H.LSK); r1 = await A.evaluate(H.RECH); idb1 = await A.evaluate(IDBN)
            ok(NEWV + ': 3 nahrávky, původní 2 beze změny', len(r1) == 3 and all(x in r1 for x in r0))
            await cA.close()
            # ================= NÁVRAT na 1.1.3 (band-app-pages-12) =================
            point(ROLL); PH[0] = 'návrat'
            cA, A = await openA(p); await A.goto(URL); await A.wait_for_timeout(800)
            flow = await A.evaluate(H.UPDATE_FLOW); ok('návrat: SW aktualizace → activated', flow[-1] == 'activated', flow)
            ck = await A.evaluate('caches.keys()'); ok('návrat: jen band-app-pages-12 (pages-11 smazána)', ck == ['band-app-pages-' + ROLLC], ck)
            await A.reload(); await A.wait_for_timeout(2000)
            ls2 = await A.evaluate(H.LSK); diff = [k for k in ls1 if ls2.get(k) != ls1[k]]
            ok('návrat: localStorage bit po bitu stejné jako v 1.2.0', not diff, {'změněné': diff})
            ok('návrat: původní data ze staré verze stále stejná', not [k for k in ls0 if ls2.get(k) != ls0[k]])
            ok('návrat: 3 nahrávky bit po bitu stejné', await A.evaluate(H.RECH) == r1)
            ok('návrat: databáze IndexedDB zachované', set(idb1) <= set(await A.evaluate(IDBN)))
            ok('návrat: stejné přihlášení (uid)', await A.evaluate(UID) == uA)
            m2 = await H.cdp_manifest(cA, A); ok('návrat: manifest identický', m2[0].get('data') == m0[0].get('data'))
            ok('návrat (1.1.3): menu bez VIDEOCHATU, videochat.js se nenačítá', await A.locator('nav.bandnav a[href="#videochat"]').count() == 0 and not await A.evaluate("[...document.scripts].some(s=>/videochat/.test(s.src))"))
            m = await msgs(A, room); ok('návrat: všechny 4 zprávy čitelné', isinstance(m, list) and len(m) == 4, m)
            ok('návrat: odeslání zprávy', await A.evaluate(SEND % (room, 'Po návratu')) == 'ok')
            await H.features(A, 'návrat')
            await cA.close(); await b.close()
            ok('žádné chyby stránky', not ERRS, ERRS[:5])
            other = [x for x in BLOCKED if not x[1].startswith(AUTH_IFRAME)]
            ok('žádný požadavek mimo localhost/gstatic (kromě pomocného iframe Firebase Auth, blokováno)', not other, other[:5])
            ok('iframe Firebase Auth jen tam, kde už ho volala 1.1.3 (ne nový v 1.2.0)', not BLOCKED or any(x[0] == '1.1.3' for x in BLOCKED), sorted(set(x[0] for x in BLOCKED)))
    finally:
        srv.kill()
    print('\nSOUHRN: %d/%d PASS' % (sum(1 for r in H.R if r[1]), len(H.R)))
asyncio.run(main())
