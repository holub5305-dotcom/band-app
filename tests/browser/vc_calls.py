"""BAND APP 1.2.0 – AUTOMATICKÝ test videochatu v headless Chromiu (falešná kamera/mikrofon) proti Firebase EMULÁTORU.
Nejde o test na skutečných telefonech. Skutečné servery Firebase jsou zablokované (povolený jen localhost + gstatic CDN se SDK)."""
import asyncio, json, re, subprocess, sys, time
from playwright.async_api import async_playwright
BASE = 'http://localhost:8793/index.html?emulator=1'
import os
HERE = os.path.dirname(os.path.abspath(__file__)); RULES = os.path.join(HERE, '..', '..', 'firestore.rules')
# Spuštění: firebase emulators:start --only auth,firestore --project demo-bandapp; statický server repozitáře na :8793; npm i @firebase/rules-unit-testing firebase
# (seed.mjs potřebuje node_modules – cwd = složka s node_modules, viz SEED_CWD)
SHOTS = os.environ.get('SHOTS', '/tmp/vc-shots'); os.makedirs(SHOTS, exist_ok=True)
SEED_CWD = os.environ.get('SEED_CWD', HERE)
import shutil; SEED = os.path.join(SEED_CWD, '_seed_vc.mjs'); shutil.copy(os.path.join(HERE, 'seed.mjs'), SEED)  # ESM hledá balíčky vedle skriptu
R = []; BLOCKED = []; ERRS = {}
def ok(n, c, info=''):
    R.append((n, bool(c), str(info)[:300])); print(('PASS ' if c else 'FAIL ') + n + (' | ' + str(info)[:300] if info != '' else ''), flush=True)
ALLOWED = re.compile(r'^https?://((localhost|127\.0\.0\.1)(:\d+)?/|www\.gstatic\.com/firebasejs/)')
CLEARDOT = 'https://www.google.com/images/cleardot.gif'  # test připojení uvnitř Firestore SDK (žádná data)
async def guard(r):
    u = r.request.url
    if ALLOWED.match(u): await r.continue_()
    else:
        if not u.startswith(CLEARDOT): BLOCKED.append(u[:120])
        await r.abort()
ST = 'window.__vc && window.__vc.state()'
async def wait(pg, js, t=20000):
    try: await pg.wait_for_function(js, timeout=t); return True
    except Exception as e: return False
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        P = {}
        for name, vp in [('A', {'width': 390, 'height': 844}), ('B', {'width': 412, 'height': 915}), ('C', {'width': 1280, 'height': 800}), ('D', {'width': 390, 'height': 844})]:
            c = await b.new_context(viewport=vp, permissions=['camera', 'microphone'], has_touch=name != 'C')
            await c.route('**/*', guard)
            pg = await c.new_page(); ERRS[name] = []
            pg.on('pageerror', lambda e, n=name: ERRS[n].append(str(e)))
            pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
            await pg.goto(BASE); await pg.wait_for_timeout(800)
            uid = await pg.evaluate("import('./friends.js').then(async m=>{if(m.createAccount) await m.createAccount(); return m.connect()}).then(f=>f.uid)")
            P[name] = {'c': c, 'pg': pg, 'uid': uid}
        A, B, C, D = (P[k]['pg'] for k in 'ABCD'); U = {k: P[k]['uid'] for k in 'ABCD'}
        room = 'roomTest1'
        seed = {'room': room, 'owner': U['A'], 'members': [{'uid': U['A'], 'nick': 'Laurinka', 'status': 'owner'}, {'uid': U['B'], 'nick': 'Amy', 'status': 'approved'}, {'uid': U['C'], 'nick': 'Zoe', 'status': 'approved'}, {'uid': U['D'], 'nick': 'Čekající', 'status': 'pending'}]}
        _sr = subprocess.run(['node', SEED, RULES, json.dumps(seed)], capture_output=True, text=True, cwd=SEED_CWD); print(_sr.stdout.strip(), _sr.stderr.strip()[-500:])
        for k, role, nick in [('A', 'owner', 'Laurinka'), ('B', 'approved', 'Amy'), ('C', 'approved', 'Zoe'), ('D', 'pending', 'Čekající')]:
            pg = P[k]['pg']
            await pg.evaluate(f"localStorage.setItem('bandapp-friends-rooms', JSON.stringify([{{id:'{room}',name:'Kapela',role:'{role}'}}]));localStorage.setItem('bandapp-friends-nick', JSON.stringify('{nick}'))")
            await pg.reload(); await pg.wait_for_timeout(500)
        for k in 'ABC': ok(f'{k}: VIDEOCHAT v navigaci + seznam schválených členek', await wait(P[k]['pg'], "document.querySelectorAll('#vcPeopleList li').length===2") and await P[k]['pg'].locator('nav.bandnav a[href=\"#videochat\"]').count() == 1)
        names = await A.evaluate("[...document.querySelectorAll('#vcPeopleList .vc-name')].map(e=>e.textContent)")
        ok('A: čekající členka NENÍ v nabídce k volání', names == ['Amy', 'Zoe'], names)
        await A.locator('#videochat').screenshot(path=SHOTS+'/section-A.png')
        # ---------- 1) videohovor 1:1 ----------
        await A.click(f'#vcPeopleList li[data-uid="{U["B"]}"] [data-act=video]')
        ok('B: příchozí videohovor (přezdívka, druh, PŘIJMOUT/ODMÍTNOUT)', await wait(B, "document.getElementById('vcIncoming')"))
        inc = await B.evaluate("({n:vcInName.textContent,k:vcInKind.textContent,y:vcAccept.textContent,no:vcDecline.textContent,yc:getComputedStyle(vcAccept).backgroundColor,nc:getComputedStyle(vcDecline).backgroundColor})")
        ok('  obsah příchozího hovoru', inc['n'] == 'Laurinka' and 'videohovor' in inc['k'] and 'PŘIJMOUT' in inc['y'] and 'ODMÍTNOUT' in inc['no'] and inc['yc'] == 'rgb(31, 157, 76)' and inc['nc'] == 'rgb(196, 0, 31)', inc)
        await B.screenshot(path=SHOTS+'/incoming-B.png')
        await A.screenshot(path=SHOTS+'/ringing-A.png')
        await B.click('#vcAccept')
        conn = "(()=>{const s=window.__vc.state();return s&&s.pcs.length==%d&&s.pcs.every(p=>['connected','completed'].includes(p[1])&&/video:live/.test(p[2])&&/audio/.test(p[2]))})()"
        ok('1:1 video: spojeno A↔B, přichází obraz i zvuk', await wait(A, conn % 1, 25000) and await wait(B, conn % 1, 25000), await A.evaluate(ST))
        await A.wait_for_timeout(1500)
        lay = await A.evaluate("({pip:!!document.querySelector('#vcCall .vc-pip video'),main:!!document.querySelector('#vcCall .vc-one .main'),vid:(()=>{const v=document.querySelector('#vcCall .main video');return v&&!v.hidden&&v.videoWidth})()})")
        ok('1:1 rozložení: hlavní video přes obrazovku + malé vlastní okno', lay['pip'] and lay['main'] and lay['vid'], lay)
        box0 = await A.locator('#vcCall .vc-pip').bounding_box()
        await A.mouse.move(box0['x'] + 30, box0['y'] + 30); await A.mouse.down(); await A.mouse.move(60, 160, steps=5); await A.mouse.up()
        box1 = await A.locator('#vcCall .vc-pip').bounding_box()
        ok('vlastní okno jde přesunout', abs(box1['x'] - box0['x']) > 50, (box0, box1))
        await A.screenshot(path=SHOTS+'/call-1to1-A.png'); await B.screenshot(path=SHOTS+'/call-1to1-B.png')
        # ---------- 4) mikrofon a kamera ----------
        await B.click('#vcMic')
        ok('B vypne mikrofon (track disabled) → A vidí ikonu ztlumení', await wait(B, "__vc.state().mic===false&&__vc.state().tracks.some(t=>t==='audio:live:false')") and await wait(A, "__vc.state().peers.some(p=>p[3]===false)"))
        await B.click('#vcCam')
        ok('B vypne kameru (kamera opravdu zastavená) → A vidí avatar s přezdívkou', await wait(B, "__vc.state().cam===false&&!__vc.state().tracks.some(t=>t.startsWith('video'))") and await wait(A, "(()=>{const t=document.querySelector('#vcCall .main');return t&&t.querySelector('video').hidden&&!t.querySelector('.vc-avbig').hidden&&t.querySelector('.vc-avbig').textContent==='A'})()"))
        await A.screenshot(path=SHOTS+'/cam-off-A.png')
        await B.click('#vcCam'); await B.click('#vcMic')
        ok('B znovu zapne kameru i mikrofon → A znovu vidí obraz', await wait(B, "__vc.state().cam&&__vc.state().mic") and await wait(A, "(()=>{const v=document.querySelector('#vcCall .main video');return v&&!v.hidden&&v.videoWidth>0})()", 15000))
        # ---------- 6) výpadek a obnova ----------
        await P['B']['c'].set_offline(True); await B.wait_for_timeout(4000)
        st_off = await B.evaluate("document.getElementById('vcState').textContent")
        await P['B']['c'].set_offline(False); await B.evaluate("dispatchEvent(new Event('online'))")
        await B.wait_for_timeout(2500)
        await B.click('#vcMic')
        ok('výpadek internetu (Firestore offline 4 s) → hovor drží, signalizace po obnově funguje', 'bez internetu' in st_off and await wait(A, "__vc.state()&&__vc.state().peers.some(p=>p[3]===false)", 20000), st_off)
        await B.click('#vcMic')
        # simulované přerušení spojení WebRTC na obou stranách → obnova novou nabídkou (ICE restart)
        for who in (A, B):
            await who.evaluate("(()=>{const s=__vc.V.session;for(const [u,e] of s.pcs){e.pc.close();e.lostAt=Date.now()-7000;e.lastRestart=0}})()")
            ok(('A (nabízející)' if who is A else 'B (odpovídající)') + ': přerušené spojení se samo obnoví', await wait(A, conn % 1, 30000) and await wait(B, conn % 1, 30000), await who.evaluate(ST))
        # ---------- ukončení 1:1 + uvolnění kamery ----------
        await A.evaluate("window.__t=__vc.V.session.stream.getTracks()"); await B.evaluate("window.__t=__vc.V.session.stream.getTracks()")
        await A.click('#vcHang')
        ok('ukončení 1:1: hovor skončí oběma', await wait(A, "!__vc.state()&&!document.getElementById('vcCall')") and await wait(B, "!__vc.state()&&!document.getElementById('vcCall')"))
        ok('kamera a mikrofon uvolněné (všechny stopy ended) na obou stranách', await A.evaluate("__t.every(t=>t.readyState==='ended')") and await B.evaluate("__t.every(t=>t.readyState==='ended')"))
        await A.wait_for_timeout(4500)
        # ---------- 5) odmítnutí ----------
        await A.click(f'#vcPeopleList li[data-uid="{U["C"]}"] [data-act=video]')
        ok('C: příchozí hovor', await wait(C, "document.getElementById('vcIncoming')"))
        await C.click('#vcDecline')
        ok('odmítnutí: C zavře výzvu, A hovor skončí s hláškou', await wait(C, "!document.getElementById('vcIncoming')&&!__vc.state()") and await wait(A, "!__vc.state()", 15000))
        await A.wait_for_timeout(4500)
        # ---------- 2) hlasový hovor ----------
        await B.click(f'#vcPeopleList li[data-uid="{U["A"]}"] [data-act=audio]')
        ok('A: příchozí HLASOVÝ hovor od Amy', await wait(A, "document.getElementById('vcIncoming')&&vcInName.textContent==='Amy'&&/hlasový/.test(vcInKind.textContent)"))
        await A.click('#vcAccept')
        aconn = "(()=>{const s=window.__vc.state();return s&&s.pcs.length==1&&['connected','completed'].includes(s.pcs[0][1])&&/audio:live/.test(s.pcs[0][2])})()"
        ok('hlasový hovor: spojeno, bez kamery (žádná video stopa), avatar místo obrazu', await wait(A, aconn, 25000) and await wait(B, aconn, 25000) and await A.evaluate("!__vc.state().tracks.some(t=>t.startsWith('video'))&&!__vc.state().cam") and await A.evaluate("(()=>{const t=document.querySelector('#vcCall .main');return t&&t.querySelector('video').hidden&&!t.querySelector('.vc-avbig').hidden})()"))
        await A.screenshot(path=SHOTS+'/voice-A.png')
        await A.click('#vcCam')
        ok('v hlasovém hovoru jde zapnout kamera (bez nového vyjednávání) → B vidí obraz', await wait(B, "(()=>{const v=document.querySelector('#vcCall .main video');return v&&!v.hidden&&v.videoWidth>0})()", 15000))
        await B.click('#vcHang')
        ok('hlasový hovor ukončen oběma', await wait(A, "!__vc.state()") and await wait(B, "!__vc.state()"))
        await A.wait_for_timeout(4500)
        # ---------- 3) skupinový hovor (3) ----------
        await A.check(f'#vcPeopleList li[data-uid="{U["B"]}"] .vc-pick'); await A.check(f'#vcPeopleList li[data-uid="{U["C"]}"] .vc-pick')
        await A.click('#vcGroupVideo')
        ok('B a C: příchozí skupinový videohovor', await wait(B, "document.getElementById('vcIncoming')&&/skupinový/.test(vcInKind.textContent)") and await wait(C, "document.getElementById('vcIncoming')"))
        await B.click('#vcAccept'); await C.click('#vcAccept')
        ok('skupina: každá má 2 spojení s obrazem', all([await wait(x, conn % 2, 30000) for x in (A, B, C)]), [await x.evaluate(ST) for x in (A, B, C)])
        await A.wait_for_timeout(1500)
        g = await C.evaluate("({grid:!!document.querySelector('#vcCall .vc-grid.n3'),tiles:document.querySelectorAll('#vcCall .vc-grid .vc-tile').length,vids:[...document.querySelectorAll('#vcCall .vc-grid video')].filter(v=>!v.hidden&&v.videoWidth>0).length})")
        ok('skupina: mřížka 3 dlaždic, všechny s obrazem', g['grid'] and g['tiles'] == 3 and g['vids'] == 3, g)
        await A.click('#vcPeople'); lst = await A.evaluate("[...document.querySelectorAll('#vcList li')].map(l=>l.textContent)")
        ok('přehled účastnic hovoru', len(lst) == 3 and any('Amy' in x and 'v hovoru' in x for x in lst), lst)
        await A.screenshot(path=SHOTS+'/group-A.png'); await C.screenshot(path=SHOTS+'/group-C-desktop.png')
        await C.click('#vcHang')
        ok('C opustí skupinový hovor → A a B pokračují (hovor neskončil)', await wait(C, "!__vc.state()") and await wait(A, conn % 1, 20000) and await wait(B, conn % 1, 20000))
        await A.click('#vcHang')
        ok('poslední odchod ukončí skupinový hovor', await wait(A, "!__vc.state()") and await wait(B, "!__vc.state()", 20000))
        # ---------- 7) síť nepustí přímé spojení (simulace mobilních dat bez TURN) ----------
        await A.wait_for_timeout(4500)
        NOICE = "(()=>{if(window.__noIce)return;window.__noIce=1;const O=window.RTCPeerConnection;window.RTCPeerConnection=function(c){return new O(Object.assign({},c||{},{iceServers:[],iceTransportPolicy:'relay'}))};window.RTCPeerConnection.prototype=O.prototype})()"
        await A.evaluate(NOICE); await B.evaluate(NOICE)
        await A.click(f'#vcPeopleList li[data-uid="{U["B"]}"] [data-act=video]')
        await wait(B, "document.getElementById('vcIncoming')"); await B.click('#vcAccept')
        MSG = 'Spojení se nepodařilo – zkuste Wi-Fi'
        ok('bez možnosti spojení: po ~20 s hláška „Spojení se nepodařilo – zkuste Wi-Fi.“ (obě strany)', await wait(A, "(()=>{const b=document.querySelector('#vcCall .vc-banner');return b&&!b.hidden&&b.textContent.includes('%s')})()" % MSG, 35000) and await wait(B, "(()=>{const b=document.querySelector('#vcCall .vc-banner');return b&&!b.hidden&&b.textContent.includes('%s')})()" % MSG, 35000))
        await A.screenshot(path=SHOTS+'/noconn-A.png')
        ok('bez možnosti spojení: 1:1 hovor po ~50 s skončí se stejnou hláškou, kamera uvolněná', await wait(A, "!__vc.state()&&document.getElementById('videochatApp').innerText.includes('%s')" % MSG, 45000) and await wait(B, "!__vc.state()", 20000))
        await A.reload(); await B.reload(); await A.wait_for_timeout(1500)
        await wait(A, "document.querySelectorAll('#vcPeopleList li').length===2"); await wait(B, "document.querySelectorAll('#vcPeopleList li').length===2")
        # ---------- 7b) 1.2.5: nabídka spojení vůbec nedorazí (ICE se nikdy nespustí) → OBĚ strany jasně skončí ----------
        # (1.2.4: limit hlídal jen existující spojení – přijímající strana bez nabídky „připojovala“ donekonečna.)
        NOOFFER = "(()=>{RTCPeerConnection.prototype.createOffer=function(){return new Promise(()=>{})}})()"
        await A.evaluate(NOOFFER); await B.evaluate(NOOFFER)
        await A.click(f'#vcPeopleList li[data-uid="{U["B"]}"] [data-act=video]')
        await wait(B, "document.getElementById('vcIncoming')"); await B.click('#vcAccept')
        ok('nabídka nedorazí: po ~20 s hláška u OBOU stran', await wait(A, "(()=>{const b=document.querySelector('#vcCall .vc-banner');return b&&!b.hidden&&b.textContent.includes('%s')})()" % MSG, 35000) and await wait(B, "(()=>{const b=document.querySelector('#vcCall .vc-banner');return b&&!b.hidden&&b.textContent.includes('%s')})()" % MSG, 35000))
        endA = await wait(A, "!__vc.state()", 50000); endB = await wait(B, "!__vc.state()", 20000)
        txt = await A.evaluate("document.getElementById('videochatApp').innerText") + await B.evaluate("document.getElementById('videochatApp').innerText")
        ok('nabídka nedorazí: hovor po ~50 s skončí u obou (žádné nekonečné „Připojuji…“), s hláškou', endA and endB and MSG in txt, txt[-200:])
        await A.reload(); await B.reload(); await A.wait_for_timeout(1500)
        await wait(A, "document.querySelectorAll('#vcPeopleList li').length===2"); await wait(B, "document.querySelectorAll('#vcPeopleList li').length===2")
        # ---------- 8) neschválená ----------
        nr = await D.evaluate("(document.getElementById('vcNoRooms')||{}).textContent||''")
        ok('čekající: VIDEOCHAT nenabízí volání', ('jen pro schválené' in nr or 'čeká na schválení' in nr) and await D.locator('#vcPeopleList').count() == 0, nr)
        deny = await D.evaluate("""(async()=>{const fb=await (await import('./friends.js')).connect();const F=fb.F,db=fb.db,out={};
          const t=async(k,f)=>{try{await f();out[k]='ALLOWED'}catch(e){out[k]=e.code}};
          await t('create',()=>F.setDoc(F.doc(F.collection(db,'rooms','%s','calls')),{createdBy:fb.uid,nick:'Čekající',kind:'video',mode:'direct',participants:[fb.uid,'%s'],status:'ringing',createdAt:F.serverTimestamp(),expiresAt:F.Timestamp.fromMillis(Date.now()+3600e3)}));
          await t('list',()=>F.getDocs(F.query(F.collection(db,'rooms','%s','calls'),F.where('participants','array-contains',fb.uid))));
          await t('listAll',()=>F.getDocs(F.collection(db,'rooms','%s','calls')));
          return out})()""" % (room, U['A'], room, room))
        ok('čekající: server odmítne založit hovor i číst hovory', all(v == 'permission-denied' for v in deny.values()), deny)
        # ---------- 9/10) původní funkce + data ----------
        for k in 'AB':
            pg = P[k]['pg']
            fr = await pg.evaluate("document.getElementById('friendsApp').innerText")
            ok(f'{k}: Kamarádky (soukromý chat) se načtou se skupinou', 'Kapela' in fr, fr[:120])
        await A.click('#chords button:has-text("Am")')
        ok('Škola akordů funguje (Am)', 'Am' in await A.text_content('#chordTitle'))
        await A.click('#emOpen'); ok('Lekce Em s Raven se otevře', await A.is_visible('#emLesson'))
        await A.screenshot(path=SHOTS+'/home-A.png', full_page=False)
        for k in 'ABCD': ok(f'{k}: žádné chyby stránky', not ERRS[k], ERRS[k])
        ok('žádný požadavek mimo localhost/gstatic (produkce nedotčena)', not BLOCKED, BLOCKED[:5])
        await b.close()
    print('\nSOUHRN: %d/%d PASS' % (sum(1 for r in R if r[1]), len(R)))
    json.dump(R, open(os.path.join(SHOTS, 'vc_calls_result.json'), 'w'), ensure_ascii=False, indent=1)
asyncio.run(main())
