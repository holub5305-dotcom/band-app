import asyncio, json, re
R=[];ERRS={};BLOCKED=[];FAILED=[];NETREQ=[]
LOCALONLY = re.compile(r'^https?://(?!(localhost|127\.0\.0\.1)(:\d+)?/)')
def ok(n, c, info=''): R.append((n, bool(c), info)); print(('PASS ' if c else 'FAIL ') + n + (' | ' + str(info)[:300] if info != '' else ''), flush=True)
UD='/tmp/vc-upgrade-ud'
INIT = "window.__idbOpen=[];window.__lsW=[];(()=>{const o=indexedDB.open.bind(indexedDB);indexedDB.open=function(n,v){window.__idbOpen.push(n);return o(n,v)};const S=Storage.prototype,si=S.setItem,ri=S.removeItem,cl=S.clear;S.setItem=function(k,v){if(this===localStorage)window.__lsW.push(k);return si.call(this,k,v)};S.removeItem=function(k){if(this===localStorage)window.__lsW.push('-'+k);return ri.call(this,k)};S.clear=function(){if(this===localStorage)window.__lsW.push('CLEAR');return cl.call(this)}})();window.__played=[];const _p=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){window.__played.push(this.src||this.currentSrc);return _p.apply(this,arguments)};"
async def ctx(p, phase):
    dev = {k: v for k, v in p.devices['Pixel 7'].items() if k != 'default_browser_type'}
    c = await p.chromium.launch_persistent_context(UD, headless=True, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'], permissions=['microphone'], **dev)
    await c.add_init_script(INIT); await c.route(LOCALONLY, lambda r: (BLOCKED.append(r.request.url[:140]), asyncio.ensure_future(r.abort()))[1])
    pg = c.pages[0] if c.pages else await c.new_page(); ERRS[phase] = []
    pg.on('console', lambda m: m.type == 'error' and ERRS[phase].append(m.text)); pg.on('pageerror', lambda e: ERRS[phase].append('PAGEERROR ' + str(e)))
    pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
    pg.on('requestfailed', lambda r: FAILED.append((phase, r.url[:120], r.failure)))
    return c, pg
async def record(pg, ms=1200):
    await pg.click('#recordBtn'); await pg.wait_for_timeout(ms); await pg.click('#recordBtn')
    await pg.wait_for_function("document.getElementById('recordStatus').textContent.match(/uložena|NEBYLA/)", timeout=10000)
    return await pg.text_content('#recordStatus')
RECS = """new Promise(r=>{const q=indexedDB.open('bandapp-recordings');q.onsuccess=()=>{const g=q.result.transaction('recordings').objectStore('recordings').getAll();g.onsuccess=()=>{r(g.result.map(x=>({id:x.id,name:x.name,size:x.blob.size})));q.result.close()}}})"""
LSK = "Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]))"
async def features(pg, tag):
    st = await pg.evaluate("Promise.all(Object.values(window.BANDAPP_VOICES.voices[0].clips).map(s=>fetch(s,{cache:'no-store'}).then(r=>r.status)))")
    ok(f'{tag}: Kasandra MP3 HTTP 200', len(st) >= 18 and set(st) == {200}, (len(st), sorted(set(st))))
    await pg.evaluate('window.__played=[]'); await pg.click('text=Poslechnout učitelku'); await pg.wait_for_timeout(1200)
    pl = await pg.evaluate('window.__played'); ok(f'{tag}: Poslechnout učitelku hraje welcome.mp3 (Kasandra)', any('kasandra/welcome.mp3' in s for s in pl), pl)
    await pg.wait_for_timeout(2500); await pg.click('.tile >> nth=1'); await pg.evaluate('window.__played=[]'); await pg.click('text=Vysvětlit česky'); await pg.wait_for_timeout(1500)
    t, pl = await pg.text_content('#lessonTitle'), await pg.evaluate('window.__played')
    ok(f'{tag}: lekce Bicí + hlas', 'Bicí' in t and any('lesson-bici' in s for s in pl), (t, pl, await pg.text_content('#status')))
    await pg.click('#emOpen'); await pg.wait_for_timeout(500); ok(f'{tag}: lekce Em se otevře', await pg.is_visible('#emLesson'))
    await pg.click('#chords button:has-text("Am")'); ok(f'{tag}: hmatník (akord Am)', 'Am' in await pg.text_content('#chordTitle') and await pg.locator('#fret svg circle').count() > 0)
    r = await pg.evaluate("(()=>{try{playChord();return 'ok'}catch(e){return String(e)}})()"); ok(f'{tag}: přehrání tónů akordu', r == 'ok', r)

RECH = """new Promise(r=>{const q=indexedDB.open('bandapp-recordings');q.onsuccess=()=>{const db=q.result;const g=db.transaction('recordings').objectStore('recordings').getAll();g.onsuccess=async()=>{const out=[];for(const x of g.result){const h=await crypto.subtle.digest('SHA-256',await x.blob.arrayBuffer());const o={};for(const k of Object.keys(x).sort()){if(k!=='blob')o[k]=x[k]instanceof Date?x[k].toISOString():x[k]}o.size=x.blob.size;o.type=x.blob.type;o.sha256=[...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('');out.push(o)}db.close();r(out)}}})"""
SWREGS = "navigator.serviceWorker.getRegistrations().then(rs=>rs.map(r=>({scope:r.scope,active:r.active&&r.active.scriptURL})))"
UPDATE_FLOW = """()=>new Promise(res=>{const st=[];const t=setTimeout(()=>res(st.concat('TIMEOUT')),20000);navigator.serviceWorker.getRegistration().then(r=>{st.push('active:'+(r.active&&r.active.scriptURL.split('/').slice(-2).join('/'))+(r.installing?' installing':'')+(r.waiting?' waiting':''));const watch=w=>w.addEventListener('statechange',()=>{st.push(w.state);if(w.state==='activated'){clearTimeout(t);res(st)}});if(r.installing)watch(r.installing);if(r.waiting)watch(r.waiting);r.addEventListener('updatefound',()=>{const w=r.installing;st.push('updatefound:'+w.scriptURL.split('/').slice(-2).join('/'));watch(w)});r.update().then(()=>st.push('update-called')).catch(e=>st.push('ERR '+e))})})"""
def subset(d, keys): return {k: d.get(k) for k in keys}

async def cdp_manifest(c, pg):
    cdp = await c.new_cdp_session(pg); return await cdp.send('Page.getAppManifest'), await cdp.send('Page.getInstallabilityErrors')
BADTXT = r"""(()=>{const RX=/(^|[^\p{L}\p{N}_])(null|undefined|NaN)(?=$|[^\p{L}\p{N}_])|\[object /u;const out=[];const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){const el=n.parentElement;if(!el||/^(SCRIPT|STYLE)$/.test(el.tagName))continue;if(RX.test(n.nodeValue)&&el.checkVisibility())out.push(n.nodeValue.trim().slice(0,60))}return out})()"""
def ext_req(phase):
    return [u for (ph, u) in NETREQ if ph == phase and not re.match(r'^https?://(localhost|127\.0\.0\.1)(:\d+)?/', u) and not u.startswith(('data:', 'blob:'))]
async def ctx2(p, phase):
    c, pg = await ctx(p, phase); pg.on('request', lambda r: NETREQ.append((phase, r.url[:140]))); return c, pg
