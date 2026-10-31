"""BAND APP 1.2.7 – SKUTEČNÝ obousměrný přenos obrazu a zvuku ve videohovoru (headless Chromium, falešná kamera
a mikrofon, Firebase EMULÁTOR). Dvě SAMOSTATNÉ instance prohlížeče (dva procesy = dva „telefony“), BEZ přepínače
--autoplay-policy (platí běžné pravidlo automatického přehrávání jako v Chrome pro Android).
Měří přes getStats: příchozí video framesDecoded roste, příchozí audio bytesReceived/totalSamplesReceived roste,
vzdálené <video> má videoWidth>0 a hraje (není pozastavené, není ztlumené) – OBA směry, pro volající i volanou,
pro obě pořadí nabízející/odpovídající (rozhoduje pořadí uid). EXPECT=fixed navíc kontroluje diagnostiku 1.2.7
a simulaci selhání ICE (žádní kandidáti → jasná hláška). NE skutečné telefony ani skutečné mobilní sítě."""
import asyncio, json, os, re, shutil, subprocess
from playwright.async_api import async_playwright
BASE = 'http://localhost:8793/index.html?emulator=1'
HERE = os.path.dirname(os.path.abspath(__file__)); RULES = os.path.join(HERE, '..', '..', 'firestore.rules')
EXPECT = os.environ.get('EXPECT', 'fixed')
SEED_CWD = os.environ.get('SEED_CWD', HERE); SEED = os.path.join(SEED_CWD, '_seed_media.mjs'); shutil.copy(os.path.join(HERE, 'seed.mjs'), SEED)
R = []; BLOCKED = []; ERRS = {}
def ok(n, c, info=''):
    R.append((n, bool(c), str(info)[:400])); print(('PASS ' if c else 'FAIL ') + n + (' | ' + str(info)[:400] if info != '' else ''), flush=True)
ALLOWED = re.compile(r'^https?://((localhost|127\.0\.0\.1)(:\d+)?/|www\.gstatic\.com/firebasejs/)')
async def guard(r):
    u = r.request.url
    if ALLOWED.match(u): await r.continue_()
    else:
        if 'cleardot' not in u: BLOCKED.append(u[:120])
        await r.abort()
async def wait(pg, js, t=20000):
    try: await pg.wait_for_function(js, timeout=t); return True
    except Exception: return False
STATS = """(async()=>{const s=window.__vc&&__vc.V.session;if(!s)return null;const out=[];
 for(const [u,e] of s.pcs){const r=await e.pc.getStats();const o={ice:e.pc.iceConnectionState,conn:e.pc.connectionState,sig:e.pc.signalingState,fIn:0,vIn:0,aIn:0,aSamp:0,vOut:0,aOut:0,fEnc:0};
  r.forEach(x=>{if(x.type==='inbound-rtp'&&x.kind==='video'){o.vIn+=x.bytesReceived||0;o.fIn+=x.framesDecoded||0}
   if(x.type==='inbound-rtp'&&x.kind==='audio'){o.aIn+=x.bytesReceived||0;o.aSamp+=x.totalSamplesReceived||0}
   if(x.type==='outbound-rtp'&&x.kind==='video'){o.vOut+=x.bytesSent||0;o.fEnc+=x.framesEncoded||0}
   if(x.type==='outbound-rtp'&&x.kind==='audio'){o.aOut+=x.bytesSent||0}});out.push(o)}
 const v=document.querySelector('#vcCall .main video');
 return {pcs:out,vw:v?v.videoWidth:-1,paused:v?v.paused:null,hidden:v?v.hidden:null,muted:v?v.muted:null,tracks:v&&v.srcObject?v.srcObject.getTracks().map(t=>t.kind+':'+t.readyState+':'+(t.muted?'m':'u')):[]}})()"""
async def media_ok(pg, label):
    a = await pg.evaluate(STATS); await pg.wait_for_timeout(3000); b = await pg.evaluate(STATS)
    if not a or not b or not a['pcs'] or not b['pcs']: return False, {'a': a, 'b': b}
    p0, p1 = a['pcs'][0], b['pcs'][0]
    good = (p1['fIn'] > p0['fIn'] and p1['aIn'] > p0['aIn'] and p1['aSamp'] > p0['aSamp'] and p1['vOut'] > p0['vOut'] and p1['aOut'] > p0['aOut']
            and b['vw'] > 0 and b['paused'] is False and b['hidden'] is False and b['muted'] is False and p1['ice'] in ('connected', 'completed'))
    return good, {'before': p0, 'after': p1, 'vw': b['vw'], 'paused': b['paused'], 'muted': b['muted'], 'tracks': b['tracks']}
async def main():
    async with async_playwright() as p:
        args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
        P = {}
        for name in 'AB':
            br = await p.chromium.launch(args=args)   # samostatný proces = samostatný „telefon“
            c = await br.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone'], has_touch=True)
            await c.route('**/*', guard); pg = await c.new_page(); ERRS[name] = []
            pg.on('pageerror', lambda e, n=name: ERRS[n].append(str(e))); pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
            await pg.goto(BASE); await pg.wait_for_timeout(800)
            uid = await pg.evaluate("import('./friends.js').then(async m=>{if(m.createAccount) await m.createAccount(); return m.connect()}).then(f=>f.uid)")
            P[name] = {'b': br, 'c': c, 'pg': pg, 'uid': uid}
        A, B = P['A']['pg'], P['B']['pg']; U = {k: P[k]['uid'] for k in 'AB'}
        room = 'roomMedia1'
        seed = {'room': room, 'owner': U['A'], 'members': [{'uid': U['A'], 'nick': 'Laurinka', 'status': 'owner'}, {'uid': U['B'], 'nick': 'Táta', 'status': 'approved'}]}
        sr = subprocess.run(['node', SEED, RULES, json.dumps(seed)], capture_output=True, text=True, cwd=SEED_CWD); print(sr.stdout.strip(), sr.stderr.strip()[-300:])
        for k, role, nick in [('A', 'owner', 'Laurinka'), ('B', 'approved', 'Táta')]:
            pg = P[k]['pg']
            await pg.evaluate(f"localStorage.setItem('bandapp-friends-rooms', JSON.stringify([{{id:'{room}',name:'Kapela',role:'{role}'}}]));localStorage.setItem('bandapp-friends-nick', JSON.stringify('{nick}'))")
            await pg.reload(); await pg.wait_for_timeout(500)
        for k in 'AB': await wait(P[k]['pg'], "document.querySelectorAll('#vcPeopleList li').length===1")
        low = 'A' if U['A'] < U['B'] else 'B'
        print('nabízející (nižší uid):', low)
        for caller, callee in (('A', 'B'), ('B', 'A')):
            C1, C2 = P[caller]['pg'], P[callee]['pg']
            role = 'volající nabízí' if caller == low else 'volaná nabízí'
            await C1.click(f'#vcPeopleList li[data-uid="{U[callee]}"] [data-act=video]')
            ok(f'{caller}→{callee}: příchozí videohovor', await wait(C2, "document.getElementById('vcIncoming')"))
            await C2.click('#vcAccept')
            conn = "(()=>{const s=__vc.state();return s&&s.pcs.length==1&&['connected','completed'].includes(s.pcs[0][1])})()"
            ok(f'{caller}→{callee} ({role}): ICE spojeno na obou stranách', await wait(C1, conn, 25000) and await wait(C2, conn, 25000))
            await C1.wait_for_timeout(2500)
            g1, i1 = await media_ok(C1, caller); g2, i2 = await media_ok(C2, callee)
            ok(f'{caller}→{callee} ({role}): VOLAJÍCÍ {caller} přijímá obraz (snímky dekódované, videoWidth>0) i zvuk a sama odesílá', g1, i1)
            ok(f'{caller}→{callee} ({role}): VOLANÁ {callee} přijímá obraz i zvuk a sama odesílá (přijatý hovor)', g2, i2)
            if EXPECT == 'fixed':
                await C1.click('#vcDiagBtn'); await C2.click('#vcDiagBtn')
                for who, pg in ((caller, C1), (callee, C2)):
                    ok(f'{who}: diagnostika během hovoru ukazuje stav spojení', await wait(pg, "(()=>{const t=(document.getElementById('vcCallDiag')||{}).innerText||'';return /Signalizace\\s*stable/.test(t)&&/ICE\\s*(connected|completed)/.test(t)&&/Spojení \\(connectionState\\)\\s*connected/.test(t)&&/Přichází obraz/.test(t)&&/snímků/.test(t)&&/Vybraná cesta\\s*host/.test(t)&&/TURN\\s*ne/.test(t)})()", 15000),
                       (await pg.evaluate("(document.getElementById('vcCallDiag')||{}).innerText||''"))[:900])
                    txt = await pg.evaluate("(document.getElementById('vcCallDiag')||{}).innerText||''")
                    ok(f'{who}: diagnostika neukazuje IP adresy ani uid', not re.search(r'\b\d{1,3}(\.\d{1,3}){3}\b|[0-9a-f]{4}:[0-9a-f]{0,4}:|\.local\b', txt) and U['A'] not in txt and U['B'] not in txt, txt[:300])
                    ok(f'{who}: verdikt „Obraz i zvuk oběma směry“', '✅' in txt and 'oběma směry' in txt, txt[-300:])
                await C1.click('#vcDiagBtn')
            await C1.click('#vcHang')
            ok(f'{caller}→{callee}: hovor ukončen u obou', await wait(C1, "!__vc.state()") and await wait(C2, "!__vc.state()", 15000))
            if EXPECT == 'fixed':
                await C2.evaluate("document.getElementById('vcDiag').open=true")
                ok(f'{callee}: Diagnostika – souhrn posledního hovoru (ICE, cesta, obraz/zvuk)', await wait(C2, "(()=>{const t=document.getElementById('vcDiagBody').innerText;return /Poslední hovor – média/.test(t)&&/ICE connected|ICE completed/.test(t)&&/cesta host/.test(t)&&/přišlo snímků [1-9]/.test(t)})()", 8000),
                   (await C2.evaluate("document.getElementById('vcDiagBody').innerText"))[-700:])
                await C2.evaluate("document.getElementById('vcDiag').open=false")
            await C1.wait_for_timeout(4500)
        if EXPECT == 'fixed':
            # ---------- přehrávání zablokované (autoplay) → tlačítko „klepni“ a hláška ----------
            await A.click(f'#vcPeopleList li[data-uid="{U["B"]}"] [data-act=video]'); await wait(B, "document.getElementById('vcIncoming')")
            await B.click('#vcAccept'); await wait(A, conn, 25000); await wait(B, conn, 25000); await A.wait_for_timeout(1500)
            await A.evaluate("(()=>{const v=document.querySelector('#vcCall .main video');v.pause();HTMLMediaElement.prototype.__p=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){return Promise.reject(Object.assign(new Error('blocked'),{name:'NotAllowedError'}))};})()")
            await A.click('#vcDiagBtn')
            ok('zablokované přehrávání: tlačítko „klepni“ + diagnostika „Obraz přichází, ale přehrávání je zablokováno – klepni“', await wait(A, "!!document.querySelector('#vcCall .vc-tapsound')&&/přehrávání je zablokováno/.test((document.getElementById('vcCallDiag')||{}).innerText||'')", 12000),
               (await A.evaluate("(document.getElementById('vcCallDiag')||{}).innerText||''"))[-400:])
            await A.evaluate("(()=>{HTMLMediaElement.prototype.play=HTMLMediaElement.prototype.__p})()")
            await A.click('#vcCall .vc-tapsound')
            ok('po klepnutí se přehrávání rozběhne (video hraje)', await wait(A, "(()=>{const v=document.querySelector('#vcCall .main video');return v&&!v.paused&&!document.querySelector('#vcCall .vc-tapsound')})()", 8000))
            await A.click('#vcHang'); await wait(B, "!__vc.state()", 15000); await A.wait_for_timeout(4500)
            # ---------- selhání ICE: žádný kandidát (jako síť bez přímé cesty a bez TURN) ----------
            NOICE = "(()=>{if(window.__noIce)return;window.__noIce=1;const O=window.RTCPeerConnection;window.RTCPeerConnection=function(c){return new O(Object.assign({},c||{},{iceServers:[],iceTransportPolicy:'relay'}))};window.RTCPeerConnection.prototype=O.prototype})()"
            await A.evaluate(NOICE); await B.evaluate(NOICE)
            await B.click(f'#vcPeopleList li[data-uid="{U["A"]}"] [data-act=video]'); await wait(A, "document.getElementById('vcIncoming')"); await A.click('#vcAccept')
            await A.click('#vcDiagBtn')
            ICEMSG = 'Spojení se nepodařilo navázat (ICE selhalo)'
            ok('selhání ICE: po ~20 s jasná hláška na obou stranách', await wait(A, "(()=>{const b=document.querySelector('#vcCall .vc-banner');return b&&!b.hidden&&b.textContent.includes('%s')})()" % ICEMSG, 35000) and await wait(B, "(()=>{const b=document.querySelector('#vcCall .vc-banner');return b&&!b.hidden&&b.textContent.includes('%s')})()" % ICEMSG, 10000),
               await A.evaluate("(document.querySelector('#vcCall .vc-banner')||{}).textContent"))
            t = await A.evaluate("(document.getElementById('vcCallDiag')||{}).innerText||''")
            ok('selhání ICE: diagnostika – kandidáti 0, TURN ne, vysvětlení', 'místní 0' in t and 'TURN' in t and ICEMSG in t, t[:900])
            ok('selhání ICE: hovor po ~50 s skončí, souhrn posledního hovoru v Diagnostice', await wait(A, "!__vc.state()", 50000) and await wait(B, "!__vc.state()", 20000))
            await A.evaluate("document.getElementById('vcDiag').open=true")
            ok('souhrn: „ICE“ a „kandidáti místní 0“', await wait(A, "(()=>{const t=document.getElementById('vcDiagBody').innerText;return /Poslední hovor – média/.test(t)&&/kandidáti místní 0/.test(t)})()", 6000), (await A.evaluate("document.getElementById('vcDiagBody').innerText"))[-600:])
        if any((not c) and n.startswith(('selhání ICE', 'souhrn')) for n, c, _ in R):   # ladění: průběh hovorů z Diagnostiky
            for k, P in (('A', A), ('B', B)): print('DIAG', k, (await P.evaluate("(document.getElementById('vcDiagBody')||{}).innerText||''"))[-1500:].replace('\n', ' | '))
        for k in 'AB': ok(f'{k}: žádné chyby stránky', not ERRS[k], ERRS[k])
        ok('žádný požadavek mimo localhost/gstatic', not BLOCKED, BLOCKED[:5])
        for k in 'AB': await P[k]['b'].close()
    print('\nSOUHRN (%s; 2 samostatné procesy Chromium + emulátor, ne skutečné telefony): %d/%d PASS' % (EXPECT, sum(1 for r in R if r[1]), len(R)))
asyncio.run(main())
