/* BAND APP – nahrávací studio: trvalé ukládání nahrávek do IndexedDB (oddělené od mezipaměti PWA i localStorage). */
(function(){
const DB_NAME='bandapp-recordings',DB_VER=1,STORE='recordings';
const $=id=>document.getElementById(id);
let dbp=null,recorder=null,stream=null,chunks=[],startedAt=0,playUrl=null;const urls=new Set();
function openDB(){if(dbp)return dbp;dbp=new Promise((res,rej)=>{if(!('indexedDB'in window))return rej(Error('Úložiště IndexedDB není v tomto prohlížeči dostupné.'));const r=indexedDB.open(DB_NAME,DB_VER);
 r.onupgradeneeded=()=>{const db=r.result;let st;/* Jen vytváří, co chybí – nikdy nic nemaže. */
  if(!db.objectStoreNames.contains(STORE))st=db.createObjectStore(STORE,{keyPath:'id'});else st=r.transaction.objectStore(STORE);
  if(!st.indexNames.contains('createdAt'))st.createIndex('createdAt','createdAt')};
 r.onsuccess=()=>{const db=r.result;db.onversionchange=()=>{db.close();dbp=null};res(db)};r.onerror=()=>rej(r.error);r.onblocked=()=>rej(Error('Databázi blokuje jiná otevřená karta s BAND APP. Zavři ji a zkus to znovu.'))});dbp.catch(()=>{dbp=null});return dbp}
function tx(mode,fn){return openDB().then(db=>new Promise((res,rej)=>{let t,out;try{t=db.transaction(STORE,mode);out=fn(t.objectStore(STORE))}catch(e){return rej(e)}
 t.oncomplete=()=>res(out&&'result'in out?out.result:undefined);t.onerror=()=>rej(t.error||(out&&out.error));t.onabort=()=>rej(t.error||Error('Zápis byl přerušen.'))}))}
const getAll=()=>tx('readonly',s=>s.getAll()),putRec=r=>tx('readwrite',s=>s.put(r)),delRec=id=>tx('readwrite',s=>s.delete(id)),getRec=id=>tx('readonly',s=>s.get(id));
const uid=()=>crypto.randomUUID?crypto.randomUUID():'r-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
const pad=n=>String(n).padStart(2,'0');
const fmtDate=t=>{const d=new Date(t);return d.getDate()+'. '+(d.getMonth()+1)+'. '+d.getFullYear()+' '+pad(d.getHours())+':'+pad(d.getMinutes())};
const fmtDur=ms=>{const s=Math.max(0,Math.round(ms/1000));return Math.floor(s/60)+':'+pad(s%60)};
const ext=m=>{m=(m||'').toLowerCase();return m.includes('mp4')||m.includes('aac')||m.includes('m4a')?'m4a':m.includes('ogg')?'ogg':m.includes('mpeg')?'mp3':m.includes('wav')?'wav':'webm'};
const safe=n=>(n||'nahravka').replace(/[\\/:*?"<>|]+/g,'-').trim().slice(0,80)||'nahravka';
function mkUrl(b){const u=URL.createObjectURL(b);urls.add(u);return u}function freeUrl(u){if(u&&urls.has(u)){URL.revokeObjectURL(u);urls.delete(u)}}
function download(blob,name,mime){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=safe(name)+'.'+ext(mime||blob.type);document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000)}
function status(t){$('recordStatus').textContent=t}
function showError(msg,blob,name,mime){const e=$('recordError');e.replaceChildren();const p=document.createElement('p');p.style.margin='0 0 8px';p.textContent=msg;e.append(p);
 if(blob){const b=document.createElement('button');b.className='primary';b.textContent='💾 Stáhnout nahrávku do zařízení';b.onclick=()=>download(blob,name,mime);e.append(b)}e.hidden=false}
function errText(e){const n=e&&e.name||'';if(n==='QuotaExceededError'||/quota/i.test(e&&e.message||''))return'Nahrávku se nepodařilo uložit, protože v zařízení není dost místa. Stáhni si ji prosím, ať o ni nepřijdeš, a uvolni místo (třeba smazáním starých nahrávek).';return'Nahrávku se nepodařilo uložit do aplikace ('+(e&&(e.message||n)||'neznámá chyba')+'). Stáhni si ji prosím, ať o ni nepřijdeš.'}
function decodeDur(blob){return new Promise(res=>{const a=document.createElement('audio');let done=false;const fin=v=>{if(!done){done=true;a.removeAttribute('src');a.load();URL.revokeObjectURL(u);res(v)}};const u=URL.createObjectURL(blob);a.preload='metadata';
 a.onloadedmetadata=()=>{if(a.duration===Infinity){a.ondurationchange=()=>{if(isFinite(a.duration))fin(a.duration*1000)};a.currentTime=1e7}else fin(isFinite(a.duration)?a.duration*1000:0)};a.onerror=()=>fin(0);setTimeout(()=>fin(0),3000);a.src=u})}
async function render(){let list;try{list=await getAll()}catch(e){$('recEmpty').hidden=false;$('recEmpty').textContent='Seznam nahrávek se nepodařilo načíst: '+(e.message||e);return}
 list.sort((a,b)=>b.createdAt-a.createdAt);const ul=$('recList');ul.replaceChildren(...list.map(item));$('recEmpty').hidden=list.length>0;if(list.length)$('recEmpty').textContent='Zatím tu nejsou žádné nahrávky.';storageInfo()}
function btn(t,cls,fn,label){const b=document.createElement('button');b.className=cls;b.textContent=t;b.setAttribute('aria-label',label);b.onclick=fn;return b}
function item(r){const li=document.createElement('li');li.dataset.id=r.id;const n=document.createElement('div');n.className='rname';n.textContent=r.name;const m=document.createElement('div');m.className='rmeta';m.textContent=fmtDate(r.createdAt)+' • '+fmtDur(r.durationMs);const act=document.createElement('div');act.className='actions';
 act.append(btn('▶️ Přehrát','primary',()=>play(r.id),'Přehrát '+r.name),btn('💾 Stáhnout','secondary',()=>getRec(r.id).then(x=>x&&download(x.blob,x.name,x.mimeType)),'Stáhnout '+r.name),btn('✏️ Přejmenovat','secondary',()=>rename(r.id),'Přejmenovat '+r.name),btn('🗑️ Smazat','secondary',()=>remove(r.id),'Smazat '+r.name));li.append(n,m,act);return li}
async function play(id){try{const r=await getRec(id);if(!r)return render();const p=$('playback');freeUrl(playUrl);playUrl=mkUrl(r.blob);p.src=playUrl;p.style.display='block';status('Přehrávám: '+r.name);await p.play()}catch(e){status('Nahrávku se nepodařilo přehrát: '+(e.message||e))}}
async function rename(id){try{const r=await getRec(id);if(!r)return;const n=prompt('Nový název nahrávky:',r.name);if(n===null)return;const t=n.trim().slice(0,100);if(!t)return;r.name=t;await putRec(r);status('Nahrávka přejmenována.');render()}catch(e){status('Přejmenování se nepodařilo: '+(e.message||e))}}
async function remove(id){if(!confirm('Opravdu chceš tuto nahrávku smazat? Tuto akci nelze vrátit zpět.'))return;try{await delRec(id);const p=$('playback');if(playUrl){p.pause();p.removeAttribute('src');p.style.display='none';freeUrl(playUrl);playUrl=null}status('Nahrávka smazána.');render()}catch(e){status('Nahrávku se nepodařilo smazat: '+(e.message||e))}}
async function storageInfo(){try{if(navigator.storage&&navigator.storage.estimate){const e=await navigator.storage.estimate();if(e.quota)$('recStorage').textContent='Využité místo aplikace: '+(e.usage/1048576).toFixed(1)+' MB z přibližně '+(e.quota/1048576).toFixed(0)+' MB dostupných.'}}catch(_){}}
async function save(blob,mime,durMs){const now=Date.now(),d=new Date(now);const rec={id:uid(),name:'Nahrávka '+fmtDate(now),createdAt:now,durationMs:Math.round(durMs),mimeType:mime,size:blob.size,blob};
 try{const dd=await decodeDur(blob);if(dd>0)rec.durationMs=Math.round(dd)}catch(_){}
 try{await putRec(rec);status('Nahrávka uložena');$('recordError').hidden=true;render();try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(_){}}
 catch(e){status('Nahrávka NEBYLA uložena.');showError(errText(e),blob,rec.name,mime)}}
window.toggleRecording=async function(){if(recorder&&recorder.state==='recording'){recorder.stop();$('recordBtn').textContent='● Spustit nahrávání';status('Ukládám nahrávku…');return}
 try{if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||!window.MediaRecorder)throw Error('Nahrávání není v tomto prohlížeči dostupné.');$('recordError').hidden=true;
 stream=await navigator.mediaDevices.getUserMedia({audio:true});recorder=new MediaRecorder(stream);chunks=[];const rc=recorder;
 rc.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
 rc.onstop=()=>{const dur=Date.now()-startedAt,mime=rc.mimeType||(chunks[0]&&chunks[0].type)||'audio/webm',blob=new Blob(chunks,{type:mime});stream&&stream.getTracks().forEach(t=>t.stop());if(!blob.size){status('Nahrávka je prázdná, nic se neuložilo. Zkus to prosím znovu.');return}save(blob,mime,dur)};
 rc.start();startedAt=Date.now();$('recordBtn').textContent='■ Zastavit nahrávání';status('Nahrávání probíhá...')}catch(e){status(e.message||String(e))}};
window.addEventListener('pagehide',()=>{urls.forEach(u=>URL.revokeObjectURL(u));urls.clear()});
render();
})();
