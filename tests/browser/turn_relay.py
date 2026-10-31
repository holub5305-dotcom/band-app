"""BAND APP 1.3.0 – videohovory přes TURN (relay) s MÍSTNÍM coturnem a místní náhradou služby TURN (turn_mock.py).
4 samostatné procesy headless Chromia (falešná kamera/mikrofon) + Firebase EMULÁTOR. Nic skutečného, žádné cizí servery.
„Přímá cesta zablokovaná“ = iceTransportPolicy 'relay' (testovací přepínač jen v emulátoru) – telefon smí jen přes TURN.
Scénáře: přímé spojení (TURN k dispozici), 1:1 video oběma směry přes relay, jen zvuk přes relay, skupina 4 přes relay,
coturn vypnutý uprostřed hovoru (hláška + obnova po zapnutí), zavěšení z obou stran, selhání služby TURN (503 / timeout).
NE skutečné telefony ani skutečné mobilní sítě."""
import asyncio, json, os, re, secrets, shutil, signal, subprocess, time, urllib.request
from playwright.async_api import async_playwright
BASE = 'http://localhost:8793/index.html?emulator=1'; MOCK = 'http://localhost:8794'
HERE = os.path.dirname(os.path.abspath(__file__)); RULES = os.path.join(HERE, '..', '..', 'firestore.rules')
SEED_CWD = os.environ.get('SEED_CWD', HERE); SEED = os.path.join(SEED_CWD, '_seed_turn.mjs'); shutil.copy(os.path.join(HERE, 'seed.mjs'), SEED)
TUSER, TPASS = 'bt' + secrets.token_hex(4), secrets.token_hex(16)   # jen pro místní coturn, při každém běhu jiné
R = []; BLOCKED = []; ERRS = {}
def ok(n, c, info=''):
    R.append((n, bool(c), str(info)[:500])); print(('PASS ' if c else 'FAIL ') + n + (' | ' + str(info)[:500] if info != '' else ''), flush=True)
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
def box_ip():   # coturn musí poslouchat na skutečném rozhraní – Chromium neposílá TURN z běžných socketů na loopback
    out = subprocess.run(['ip', '-4', 'route', 'get', '1.1.1.1'], capture_output=True, text=True).stdout
    m = re.search(r'src (\d+\.\d+\.\d+\.\d+)', out); return m.group(1) if m else '127.0.0.1'
IP = box_ip()
COTURN = {'p': None}
def coturn_start():
    COTURN['p'] = subprocess.Popen(['turnserver', '-n', '--listening-ip=127.0.0.1', '--listening-ip=' + IP, '--relay-ip=' + IP, '--listening-port=3478', '--lt-cred-mech',
        '--user=%s:%s' % (TUSER, TPASS), '--realm=bandapp.test', '--allow-loopback-peers', '--no-cli', '--no-tls', '--no-dtls',
        '--min-port=49160', '--max-port=49460', '--log-file=stdout', '--simple-log', '--no-software-attribute'],
        stdout=open('/tmp/coturn-test.log', 'a'), stderr=subprocess.STDOUT)
    time.sleep(1.0)
def coturn_stop():
    if COTURN['p']: COTURN['p'].send_signal(signal.SIGKILL); COTURN['p'].wait(); COTURN['p'] = None
def mock(path): return json.loads(urllib.request.urlopen(MOCK + path, timeout=15).read() or b'null')
STATS = """(async()=>{const s=window.__vc&&__vc.V.session;if(!s)return null;const out=[];
 for(const [u,e] of s.pcs){const r=await e.pc.getStats();const o={ice:e.pc.iceConnectionState,fIn:0,vIn:0,aIn:0,aSamp:0,vOut:0,aOut:0,pair:'',relay:e.relay,cap:e.cap};let sel='';const pairs=[];
  r.forEach(x=>{if(x.type==='inbound-rtp'&&x.kind==='video'){o.vIn+=x.bytesReceived||0;o.fIn+=x.framesDecoded||0}
   if(x.type==='inbound-rtp'&&x.kind==='audio'){o.aIn+=x.bytesReceived||0;o.aSamp+=x.totalSamplesReceived||0}
   if(x.type==='outbound-rtp'&&x.kind==='video'){o.vOut+=x.bytesSent||0}
   if(x.type==='outbound-rtp'&&x.kind==='audio'){o.aOut+=x.bytesSent||0}
   if(x.type==='transport'&&x.selectedCandidatePairId)sel=x.selectedCandidatePairId; if(x.type==='candidate-pair')pairs.push(x)});
  const pr=(sel&&r.get(sel))||pairs.find(x=>x.nominated&&x.state==='succeeded'); if(pr){const l=r.get(pr.localCandidateId),m=r.get(pr.remoteCandidateId);o.pair=(l&&l.candidateType)+'-'+(m&&m.candidateType)}
  out.push(o)}
 return {pcs:out,at:Date.now()}})()"""
async def flows(pg, video=True, secs=4):
    a = await pg.evaluate(STATS); await pg.wait_for_timeout(secs * 1000); b = await pg.evaluate(STATS)
    if not a or not b or not b['pcs'] or len(a['pcs']) != len(b['pcs']): return False, {'a': a, 'b': b}
    res = []
    for p0, p1 in zip(a['pcs'], b['pcs']):
        good = p1['ice'] in ('connected', 'completed') and p1['aIn'] > p0['aIn'] and p1['aSamp'] > p0['aSamp'] and p1['aOut'] > p0['aOut']
        if video: good = good and p1['fIn'] > p0['fIn'] and p1['vOut'] > p0['vOut']
        kbps = round((p1['vOut'] - p0['vOut']) * 8 / ((b['at'] - a['at']) / 1000) / 1000)
        res.append({'ok': good, 'pair': p1['pair'], 'relay': p1['relay'], 'cap': p1['cap'], 'vOutKbps': kbps, 'fIn+': p1['fIn'] - p0['fIn'], 'aIn+': p1['aIn'] - p0['aIn']})
    return all(x['ok'] for x in res), res
CONN = "(()=>{const s=__vc.state();return s&&s.pcs.length==%d&&s.pcs.every(p=>['connected','completed'].includes(p[1]))})()"
DIAG = "(document.getElementById('vcCallDiag')||{}).innerText||''"
BANNER = "(()=>{const b=document.querySelector('#vcCall .vc-banner');return b&&!b.hidden?b.textContent:''})()"
async def main():
    coturn_start()
    env = dict(os.environ, MOCK_TURN_USER=TUSER, MOCK_TURN_PASS=TPASS, MOCK_TURN_HOST=IP + ':3478')
    mk = subprocess.Popen(['python3', os.path.join(HERE, 'turn_mock.py'), '8794'], env=env); time.sleep(0.8)
    try:
        async with async_playwright() as p:
            args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
            P = {}
            for name in 'ABCD':
                br = await p.chromium.launch(args=args)
                c = await br.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone'], has_touch=True)
                await c.route('**/*', guard); pg = await c.new_page(); ERRS[name] = []
                pg.on('pageerror', lambda e, n=name: ERRS[n].append(str(e))); pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
                await pg.goto(BASE); await pg.wait_for_timeout(800)
                uid = await pg.evaluate("import('./friends.js').then(async m=>{if(m.createAccount) await m.createAccount(); return m.connect()}).then(f=>f.uid)")
                P[name] = {'b': br, 'pg': pg, 'uid': uid}
            A, B, C, D = (P[k]['pg'] for k in 'ABCD'); U = {k: P[k]['uid'] for k in 'ABCD'}
            room = 'roomTurn1'; nicks = {'A': 'Laurinka', 'B': 'Amy', 'C': 'Zoe', 'D': 'Mia'}
            seed = {'room': room, 'owner': U['A'], 'members': [{'uid': U[k], 'nick': nicks[k], 'status': 'owner' if k == 'A' else 'approved'} for k in 'ABCD']}
            sr = subprocess.run(['node', SEED, RULES, json.dumps(seed)], capture_output=True, text=True, cwd=SEED_CWD); print(sr.stdout.strip(), sr.stderr.strip()[-300:])
            for k in 'ABCD':
                pg = P[k]['pg']
                await pg.evaluate(f"localStorage.setItem('bandapp-friends-rooms', JSON.stringify([{{id:'{room}',name:'Kapela',role:'{'owner' if k == 'A' else 'approved'}'}}]));localStorage.setItem('bandapp-friends-nick', JSON.stringify('{nicks[k]}'));localStorage.setItem('bandapp-test-turn-url','{MOCK}/ice')")
                await pg.reload(); await pg.wait_for_timeout(500)
            for k in 'ABCD': await wait(P[k]['pg'], "document.querySelectorAll('#vcPeopleList li').length===3")
            async def relay_only(on, who='ABCD'):
                for k in who: await P[k]['pg'].evaluate("localStorage.%s" % ("setItem('bandapp-test-relay-only','1')" if on else "removeItem('bandapp-test-relay-only')"))
            async def reset_cache(who='ABCD'):
                for k in who: await P[k]['pg'].evaluate("__vc.V.iceCache=null;__vc.V.turn=null")
            async def call(x, y, kind='video'):
                X, Y = P[x]['pg'], P[y]['pg']
                await X.click(f'#vcPeopleList li[data-uid="{U[y]}"] [data-act={kind}]')
                rang = await wait(Y, "document.getElementById('vcIncoming')")
                n0 = len(mock('/_log'))
                await Y.wait_for_timeout(700)
                pre = [r for r in mock('/_log')]
                await Y.click('#vcAccept')
                return rang, pre
            async def ended(*pgs, t=20000): return all([await wait(x, "!__vc.state()", t) for x in pgs])
            # ---------- 1) přímé spojení, TURN k dispozici ----------
            rang, log = await call('A', 'B')
            ok('1 přímé: B zvoní', rang)
            ok('1 přímé: TURN údaje se načetly už při zazvonění/zahájení (A i B, s room a Bearer tokenem)', any(r['uid'] == U['A'] and r['room'] == room and r['bearer'] for r in log) and any(r['uid'] == U['B'] and r['room'] == room and r['bearer'] for r in log), log[-4:])
            ok('1 přímé: spojeno na obou stranách', await wait(A, CONN % 1, 25000) and await wait(B, CONN % 1, 25000))
            await A.wait_for_timeout(2500)
            g, i = await flows(A); ok('1 přímé: A obraz+zvuk oběma směry, cesta host (ne relay), limit 650 kb/s', g and all(x['pair'].startswith('host') and x['relay'] is False and x['cap'] == 650000 for x in i), i)
            st = await A.evaluate("__vc.state().pcs[0][3]"); ok('1 přímé: TURN je dosažitelný (sesbírán relay kandidát z místního coturnu)', st['turn'] and st['cand']['relay'] > 0 and not st['noRelay'], st)
            await A.click('#vcDiagBtn'); t = await A.evaluate(DIAG)
            ok('1 přímé: diagnostika „Cesta: přímé spojení“ + TURN ano', 'Cesta: přímé spojení' in t and re.search(r'TURN\s*ano · údaje načtené', t), t[:700])
            ok('1 přímé: diagnostika neukazuje TURN jméno/heslo ani adresy', TUSER not in t and TPASS not in t and not re.search(r'\b\d{1,3}(\.\d{1,3}){3}\b', t), t[:300])
            await A.click('#vcDiagBtn')
            await A.click('#vcHang'); ok('1 přímé: zavěsila VOLAJÍCÍ → konec u obou', await ended(A, B)); await A.wait_for_timeout(4000)
            # ---------- 2) přímá cesta zablokovaná → 1:1 video přes relay ----------
            await relay_only(True, 'AB')
            rang, _ = await call('B', 'A'); ok('2 relay: A zvoní', rang)
            ok('2 relay: spojeno přes TURN na obou stranách', await wait(A, CONN % 1, 30000) and await wait(B, CONN % 1, 30000))
            await A.wait_for_timeout(5000)
            for k, pg in (('A', A), ('B', B)):
                g, i = await flows(pg, True, 5)
                ok(f'2 relay: {k} přijímá obraz+zvuk a odesílá, cesta relay-relay, limit 400 kb/s', g and all(x['pair'] == 'relay-relay' and x['relay'] is True and x['cap'] == 400000 for x in i), i)
                ok(f'2 relay: {k} skutečný odchozí tok obrazu ≤ ~450 kb/s', all(0 < x['vOutKbps'] <= 450 for x in i), i)
            await B.click('#vcDiagBtn'); t = await B.evaluate(DIAG)
            ok('2 relay: diagnostika „Cesta: přes TURN (relay)“ + limit 400 kb/s', 'Cesta: přes TURN (relay)' in t and '400 kb/s' in t, t[:800])
            ok('2 relay: diagnostika bez TURN jména/hesla', TUSER not in t and TPASS not in t)
            await B.click('#vcDiagBtn')
            await A.click('#vcHang'); ok('2 relay: zavěsila PŘIJÍMAJÍCÍ → konec u obou', await ended(A, B)); await A.wait_for_timeout(4000)
            # ---------- 3) jen zvuk přes relay ----------
            rang, _ = await call('A', 'B', 'audio'); ok('3 zvuk: B zvoní', rang)
            ok('3 zvuk: spojeno', await wait(A, CONN % 1, 30000) and await wait(B, CONN % 1, 30000)); await A.wait_for_timeout(3000)
            for k, pg in (('A', A), ('B', B)):
                g, i = await flows(pg, False, 4); ok(f'3 zvuk: {k} zvuk oběma směry přes relay', g and all(x['pair'] == 'relay-relay' for x in i), i)
            await B.click('#vcHang'); ok('3 zvuk: konec u obou', await ended(A, B)); await A.wait_for_timeout(4000)
            # ---------- 4) coturn vypnutý uprostřed hovoru ----------
            rang, _ = await call('A', 'B'); ok('4 výpadek: B zvoní', rang)
            ok('4 výpadek: spojeno přes relay', await wait(A, CONN % 1, 30000) and await wait(B, CONN % 1, 30000)); await A.wait_for_timeout(3000)
            coturn_stop(); t0 = time.time()
            okA = await wait(A, BANNER + ".includes('TURN nedostupný – zkuste Wi-Fi')", 90000); okB = await wait(B, BANNER + ".includes('TURN nedostupný – zkuste Wi-Fi')", 30000)
            ok('4 výpadek: po vypnutí coturnu hláška „TURN nedostupný – zkuste Wi-Fi“ u obou (s)', okA and okB, round(time.time() - t0))
            await A.click('#vcDiagBtn'); await wait(A, "(" + DIAG + ").includes('ne – TURN nedostupný')", 30000); t = await A.evaluate(DIAG)
            ok('4 výpadek: diagnostika – relay kandidát ne', 'TURN kandidát (relay)' in t and 'ne – TURN nedostupný' in t, t[:900])
            await A.click('#vcDiagBtn')
            ok('4 výpadek: hovor neskončil sám (čeká na obnovu)', bool(await A.evaluate("!!__vc.state()")) and bool(await B.evaluate("!!__vc.state()")))
            coturn_start(); t0 = time.time()
            rec = await wait(A, CONN % 1, 90000) and await wait(B, CONN % 1, 30000)
            ok('4 výpadek: po zapnutí coturnu se spojení samo obnoví (ICE restart) (s)', rec, round(time.time() - t0)); await A.wait_for_timeout(3000)
            g, i = await flows(B); ok('4 výpadek: po obnově zase obraz+zvuk přes relay', g and all(x['pair'] == 'relay-relay' for x in i), i)
            await B.click('#vcHang'); ok('4 výpadek: konec u obou', await ended(A, B)); await A.wait_for_timeout(4000)
            # ---------- 5) skupina 4 přes relay ----------
            await relay_only(True)
            for k in 'BCD': await A.check(f'#vcPeopleList li[data-uid="{U[k]}"] .vc-pick')
            await A.click('#vcGroupVideo')
            ok('5 skupina: B, C, D zvoní', all([await wait(x, "document.getElementById('vcIncoming')") for x in (B, C, D)]))
            for x in (B, C, D): await x.click('#vcAccept')
            ok('5 skupina: každá má 3 spojení (spojeno)', all([await wait(x, CONN % 3, 45000) for x in (A, B, C, D)]), [await x.evaluate("__vc.state()&&__vc.state().pcs.map(p=>p[1])") for x in (A, B, C, D)])
            await A.wait_for_timeout(5000)
            for k in 'ABCD':
                g, i = await flows(P[k]['pg'], True, 5)
                ok(f'5 skupina: {k} obraz+zvuk ze všech 3, vše přes relay, limit 250 kb/s', g and len(i) == 3 and all(x['pair'] == 'relay-relay' and x['cap'] == 250000 for x in i), i)
            await D.click('#vcHang'); ok('5 skupina: D odešla → ostatní pokračují (2 spojení)', await ended(D) and all([await wait(x, CONN % 2, 25000) for x in (A, B, C)]))
            for x in (C, B): await x.click('#vcHang')
            ok('5 skupina: poslední odchod ukončí hovor u všech', await ended(A, B, C, t=25000)); await A.wait_for_timeout(4000)
            # ---------- 6) služba TURN selže ----------
            await relay_only(False); mock('/_mode?m=503'); await reset_cache()
            rang, _ = await call('A', 'B'); ok('6 služba 503: B zvoní', rang)
            ok('6 služba 503: náhradní přímé spojení funguje', await wait(A, CONN % 1, 30000) and await wait(B, CONN % 1, 30000))
            await A.click('#vcDiagBtn'); await wait(A, "(" + DIAG + ").includes('Cesta: přímé spojení')", 15000); t = await A.evaluate(DIAG)
            ok('6 služba 503: diagnostika „TURN … nedostupný (TURN na serveru není nastavený)“ + Cesta přímé', 'nedostupný (TURN na serveru není nastavený)' in t and 'Cesta: přímé spojení' in t, t[:900])
            await A.click('#vcDiagBtn'); await A.click('#vcHang'); ok('6 služba 503: konec u obou', await ended(A, B)); await A.wait_for_timeout(4000)
            await relay_only(True, 'AB'); await reset_cache()
            rang, _ = await call('B', 'A')
            ok('6 služba 503 + jen relay: hláška „TURN nedostupný – zkuste Wi-Fi“ u obou', await wait(A, BANNER + ".includes('TURN nedostupný – zkuste Wi-Fi')", 45000) and await wait(B, BANNER + ".includes('TURN nedostupný – zkuste Wi-Fi')", 20000),
               [await A.evaluate(BANNER), await B.evaluate(BANNER)])
            ok('6 služba 503 + jen relay: 1:1 hovor po ~50 s sám skončí', await ended(A, B, t=60000)); await A.wait_for_timeout(4000)
            await relay_only(False, 'AB'); mock('/_mode?m=slow'); await reset_cache(); t0 = time.time()
            rang, _ = await call('A', 'B')
            ok('6 služba neodpovídá (timeout 5 s): náhradní přímé spojení', await wait(A, CONN % 1, 40000) and await wait(B, CONN % 1, 30000), round(time.time() - t0))
            ok('6 timeout: diagnostika „služba neodpověděla včas“', 'služba neodpověděla včas' in await A.evaluate("__vc.V.turn&&__vc.V.turn.text||''"))
            await A.click('#vcHang'); ok('6 timeout: konec u obou', await ended(A, B)); mock('/_mode?m=ok')
            # ---------- bezpečnost ----------
            for k in 'ABCD':
                pg = P[k]['pg']
                dump = await pg.evaluate("JSON.stringify(Object.assign({},localStorage))+JSON.stringify(Object.assign({},sessionStorage))+document.body.innerText")
                ok(f'{k}: TURN jméno/heslo nikde v úložišti ani na stránce', TUSER not in dump and TPASS not in dump)
                ok(f'{k}: žádné chyby stránky', not ERRS[k], ERRS[k][:3])
            ok('žádný požadavek mimo localhost/gstatic', not BLOCKED, BLOCKED[:5])
            lg = mock('/_log'); ok('všechny žádosti na službu TURN nesly přihlášení (Bearer) a room', all(r['bearer'] and r['room'] == room for r in lg), len(lg))
            for k in 'ABCD': await P[k]['b'].close()
    finally:
        coturn_stop(); mk.terminate()
    print('\nSOUHRN (4 procesy Chromium + emulátor + místní coturn, ne skutečné telefony/sítě): %d/%d PASS' % (sum(1 for r in R if r[1]), len(R)))
asyncio.run(main())
