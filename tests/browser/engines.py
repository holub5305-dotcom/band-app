"""BAND APP 1.2.0 – ENGINE testy: jádra WebKit (Safari) a Gecko (Firefox) v Playwright HEADLESS na Linuxu.
NEJDE o skutečné Safari na iPhonu ani o skutečné telefony (jiný systém, jiné kodeky, jiná oprávnění, žádný hardware).
Ověřuje: načtení stránky, SW, VIDEOCHAT UI, getUserMedia s falešnými zařízeními (kde je podporováno),
a hovor Chromium ↔ jádro (video i hlas) proti Firebase EMULÁTORU. Server repozitáře na :8793, emulátor 8080/9099."""
import asyncio, json, os, re, shutil, subprocess, sys
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); RULES = os.path.join(HERE, '..', '..', 'firestore.rules')
SEED_CWD = os.environ['SEED_CWD']; SEED = os.path.join(SEED_CWD, '_seed_vc.mjs'); shutil.copy(os.path.join(HERE, 'seed.mjs'), SEED)
VER = os.environ.get('APPV', '1.2.1')
URL = 'http://localhost:8793/index.html?emulator=1'
FAKE = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']
R = []
def ok(n, c, info=''):
    R.append((n, bool(c), str(info)[:300])); print(('PASS ' if c else 'FAIL ') + n + (' | ' + str(info)[:300] if info != '' else ''), flush=True)
def note(n, info): R.append((n, None, str(info)[:300])); print('INFO ' + n + ' | ' + str(info)[:300], flush=True)
ALLOW = ('http://localhost', 'http://127.0.0.1', 'https://www.gstatic.com/firebasejs/', 'data:', 'blob:')
BLOCKED = []
async def guard(r):
    u = r.request.url
    if u.startswith(ALLOW): await r.continue_()
    else:
        if not u.startswith(('https://www.google.com/images/cleardot.gif', 'https://apis.google.com/js/api.js')): BLOCKED.append(u[:100])
        await r.abort()
async def wait(pg, js, t=30000):
    try: await pg.wait_for_function(js, timeout=t); return True
    except Exception: return False
GUM = """navigator.mediaDevices.getUserMedia({audio:true,video:true}).then(s=>{const r=s.getTracks().map(t=>t.kind+':'+t.readyState);s.getTracks().forEach(t=>t.stop());return r.join(',')},e=>'ERR '+e.name+': '+e.message)"""
CONN = "(()=>{const s=window.__vc&&window.__vc.state();return s&&s.pcs.length==1&&['connected','completed'].includes(s.pcs[0][1])&&/%s:live/.test(s.pcs[0][2])})()"
async def engine(p, chrome, bt, label):
    errs = []
    kw = {}
    if bt.name == 'firefox': kw['firefox_user_prefs'] = {'media.navigator.streams.fake': True, 'media.navigator.permission.disabled': True, 'media.autoplay.default': 0}
    b = await bt.launch(**kw)
    try: c = await b.new_context(permissions=['camera', 'microphone'], viewport={'width': 390, 'height': 844})
    except Exception as e:
        note(f'{label}: oprávnění camera/microphone v Playwright nepodporována', str(e)[:120]); c = await b.new_context(viewport={'width': 390, 'height': 844})
    await c.route('**/*', guard)
    pg = await c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
    await pg.goto(URL); await pg.wait_for_timeout(1500)
    ok(f'{label}: stránka se načte, menu VIDEOCHAT, patička ' + VER, await pg.locator('nav.bandnav a[href="#videochat"]').count() == 1 and 'BAND APP ' + VER in await pg.inner_text('.footer'))
    sw = await pg.evaluate("navigator.serviceWorker?navigator.serviceWorker.ready.then(r=>!!r.active).catch(e=>String(e)):'none'")
    ok(f'{label}: service worker aktivní', sw is True, sw)
    vt = await pg.inner_text('#videochat'); ok(f'{label}: sekce VIDEOCHAT vykreslena', 'Soukromé video a hlasové hovory' in vt, vt[:100])
    ok(f'{label}: WebRTC API (RTCPeerConnection, getUserMedia, replaceTrack)', await pg.evaluate("!!(window.RTCPeerConnection&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia&&RTCRtpSender.prototype.replaceTrack)"))
    g = await pg.evaluate(GUM)
    gum_ok = 'audio:live' in g and 'video:live' in g
    if gum_ok: ok(f'{label}: getUserMedia s falešnou kamerou a mikrofonem', True, g)
    else: note(f'{label}: getUserMedia s falešnými zařízeními v tomto headless jádru NEPODPOROVÁNO', g)
    uid = await pg.evaluate("import('./friends.js').then(async m=>{if(m.createAccount) await m.createAccount(); return m.connect()}).then(f=>f.uid)")
    ok(f'{label}: přihlášení Firebase (emulátor)', bool(uid), uid)
    # protistrana Chromium
    cc = await chrome.new_context(permissions=['camera', 'microphone']); await cc.route('**/*', guard)
    A = await cc.new_page(); A.on('pageerror', lambda e: errs.append('chromium ' + str(e)))
    await A.goto(URL); uA = await A.evaluate("import('./friends.js').then(async m=>{if(m.createAccount) await m.createAccount(); return m.connect()}).then(f=>f.uid)")
    room = 'engine-' + bt.name
    seed = {'room': room, 'name': 'Kamarádky', 'owner': uA, 'members': [{'uid': uA, 'nick': 'Laurinka', 'status': 'owner'}, {'uid': uid, 'nick': 'Amy', 'status': 'approved'}]}
    subprocess.run(['node', SEED, RULES, json.dumps(seed)], capture_output=True, text=True, cwd=SEED_CWD)
    for x, role, nick in ((A, 'owner', 'Laurinka'), (pg, 'approved', 'Amy')):
        await x.evaluate(f"localStorage.setItem('bandapp-friends-rooms', JSON.stringify([{{id:'{room}',name:'Kamarádky',role:'{role}'}}]));localStorage.setItem('bandapp-friends-nick', JSON.stringify('{nick}'))")
        await x.reload()
    ok(f'{label}: seznam členek k volání', await wait(pg, "document.querySelectorAll('#vcPeopleList li').length===1") and await wait(A, "document.querySelectorAll('#vcPeopleList li').length===1"))
    await pg.locator('#videochat').screenshot(path=os.path.join(os.environ.get('SHOTS', '/tmp'), f'engine-{bt.name}.png'))
    if gum_ok:
        await A.click(f'#vcPeopleList li[data-uid="{uid}"] [data-act=video]')
        ok(f'{label}: příchozí videohovor z Chromia', await wait(pg, "document.getElementById('vcIncoming')"))
        await pg.click('#vcAccept')
        ok(f'{label}: videohovor Chromium ↔ {bt.name} spojen, obraz oběma směry', await wait(A, CONN % 'video') and await wait(pg, CONN % 'video'), await pg.evaluate("window.__vc&&window.__vc.state()"))
        ok(f'{label}: obraz z Chromia se vykresluje', await wait(pg, "(()=>{const v=document.querySelector('#vcCall .main video');return v&&!v.hidden&&v.videoWidth>0})()", 15000))
        await pg.click('#vcCam'); ok(f'{label}: vypnutí kamery → Chromium vidí avatar', await wait(A, "(()=>{const t=document.querySelector('#vcCall .main');return t&&t.querySelector('video').hidden})()", 15000))
        await pg.click('#vcHang'); ok(f'{label}: zavěšení ukončí hovor oběma', await wait(A, "!__vc.state()") and await wait(pg, "!__vc.state()"))
        await pg.wait_for_timeout(4500)
        await pg.click(f'#vcPeopleList li[data-uid="{uA}"] [data-act=audio]')
        await wait(A, "document.getElementById('vcIncoming')"); await A.click('#vcAccept')
        ok(f'{label}: hlasový hovor {bt.name} → Chromium spojen', await wait(A, CONN % 'audio') and await wait(pg, CONN % 'audio'))
        await A.click('#vcHang'); await wait(pg, "!__vc.state()")
    else:
        await A.click(f'#vcPeopleList li[data-uid="{uid}"] [data-act=video]')
        ok(f'{label}: příchozí hovor se zobrazí i bez kamery', await wait(pg, "document.getElementById('vcIncoming')"))
        await pg.click('#vcAccept'); await pg.wait_for_timeout(1500)
        msg = await pg.evaluate("(document.querySelector('#videochatApp .vc-err')||document.getElementById('videochatApp')).innerText")
        ok(f'{label}: bez přístupu ke kameře srozumitelná česká hláška, bez pádu', not errs and re.search(r'kame|mikrofon|přístup', msg, re.I), msg[:160])
        await A.wait_for_timeout(1000)
        try: await A.click('#vcHang', timeout=3000)
        except Exception: pass
    # WebKit hlásí přerušené dlouhé dotazování Firestore na emulátor (127.0.0.1:8080/...Listen/channel) při reloadu/ukončení
    # jako „due to access control checks“ – jde o síťové spojení s emulátorem, ne o chybu aplikace; vypisujeme zvlášť.
    emu = [e for e in errs if '127.0.0.1:8080/google.firestore' in e and 'access control checks' in e]
    if emu: note(f'{label}: přerušená spojení s emulátorem Firestore (WebKit hláška, ne chyba aplikace)', len(emu))
    rest = [e for e in errs if e not in emu]
    ok(f'{label}: žádné chyby stránky (aplikace)', not rest, rest[:3])
    await cc.close(); await b.close()
async def main():
    async with async_playwright() as p:
        chrome = await p.chromium.launch(args=FAKE)
        for bt, label in ((p.webkit, 'ENGINE WebKit'), (p.firefox, 'ENGINE Firefox')):
            v = await bt.launch(); note(f'{label}: verze jádra', v.version); await v.close()
            await engine(p, chrome, bt, label)
        await chrome.close()
    ok('žádný požadavek mimo localhost/gstatic', not BLOCKED, BLOCKED[:5])
    n = [r for r in R if r[1] is not None]
    print('\nSOUHRN (ENGINE, ne skutečná zařízení): %d/%d PASS, %d INFO' % (sum(1 for r in n if r[1]), len(n), sum(1 for r in R if r[1] is None)))
asyncio.run(main())
