/* BAND APP v5.1 – hlas učitelky Raven: předem nahrané české ženské hlasy (voices-data.js, záloha audio/voices.json),
   přehrává se jen po kliknutí. Záloha: systémový hlas jen pokud je rozpoznaně ženský český (logika v4).
   Mužský hlas se nikdy nepoužije. */
(function(){
const KEY='bandapp-voice5';
const FEM=/zuzana|vlasta|iveta|google\s*(č|c)e(š|s)tina|cs-cz-x-jfs|female|woman|žena|zena/i;
const MAL=/jakub|anton(í|i)n|\bmale\b|\bman\b|muž|muz/i;
function gender(v){const n=(v.name+' '+(v.voiceURI||''));if(/female|woman/i.test(n))return 'f';if(MAL.test(n))return 'm';if(FEM.test(n))return 'f';return 'u'}
const hasSS=()=>'speechSynthesis' in window&&'SpeechSynthesisUtterance' in window;
function sysFemale(){if(!hasSS())return null;return speechSynthesis.getVoices().filter(v=>/^cs([-_]|$)/i.test(v.lang||'')).find(v=>gender(v)==='f')||null}
let M=null,audio=null;const norm=s=>(s||'').replace(/\s+/g,' ').trim();
function useManifest(j){M=j;M.voices=(M.voices||[]).filter(v=>v.gender==='female');return M}
/* v5.1: seznam hlasů je vložený ve voices-data.js – žádný fetch (ten přes file:// v Brave/Chrome selže). */
if(window.BANDAPP_VOICES)useManifest(window.BANDAPP_VOICES);
const ready=M?Promise.resolve(M):fetch('audio/voices.json').then(r=>r.json()).then(j=>{useManifest(j);fill();return M}).catch(()=>{fill();return null});
function st(t){const e=document.getElementById('status');if(e)e.textContent=t}
function voice(){if(!M||!M.voices.length)return null;let s=null;try{s=localStorage.getItem(KEY)}catch(e){}return M.voices.find(v=>v.id===s)||M.voices[0]}
function idFor(text){if(!M)return null;const n=norm(text);for(const k in M.texts)if(norm(M.texts[k])===n)return k;return null}
function stop(){if(audio){audio.pause();audio.currentTime=0}if(hasSS())speechSynthesis.cancel()}
function playClip(v,id){const src=v&&v.clips[id];if(!src)return false;stop();if(!audio){audio=new Audio();audio.addEventListener('error',()=>st('Nahrávku hlasu se nepodařilo načíst ('+(audio.getAttribute('src')||'')+'). Zkontroluj, že je rozbalená celá složka band-app včetně složky audio.'))}
 audio.src=src;window.__bandLastClip=src;
 let p;try{p=audio.play()}catch(e){st('Nahrávku se nepodařilo přehrát: '+e.message);return true}
 if(p&&p.catch)p.catch(e=>{if(e&&e.name==='AbortError')return;st(e&&e.name==='NotAllowedError'?'Prohlížeč zablokoval přehrání zvuku. Klikni prosím na tlačítko znovu.':'Nahrávku se nepodařilo přehrát: '+(e&&e.message||e))});return true}
const NOVOICE='Pro tento text Raven nemá nahraný hlas a zařízení nenabízí český ženský hlas, proto ho nečte nahlas. Text si můžeš přečíst na obrazovce.';
window.speak=function(text){
 const go=()=>{const v=voice(),id=idFor(text);if(v&&id&&playClip(v,id)){st('Raven mluví hlasem '+v.name+'.');return}
  const f=sysFemale();if(f){stop();const u=new SpeechSynthesisUtterance(text);u.lang='cs-CZ';u.rate=.9;u.voice=f;speechSynthesis.speak(u);return}
  st(NOVOICE)};
 M?go():ready.then(go)};
window.ravenSay=function(id){return M?playClip(voice(),id):false};
function fill(){const box=document.getElementById('voiceList'),info=document.getElementById('voiceInfo');if(!box)return;
 if(!M||!M.voices.length){box.innerHTML='';info.textContent='Nahrané hlasy se nepodařilo načíst. Text lekce zůstává k přečtení na obrazovce.';return}
 const cur=voice();box.innerHTML='';M.voices.forEach(v=>{const row=document.createElement('div');row.className='vrow';row.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:6px 0';
  row.innerHTML=`<label style="flex:1 1 200px;display:flex;gap:8px;align-items:center;cursor:pointer"><input type="radio" name="ravenVoice" value="${v.id}" ${cur.id===v.id?'checked':''}> <span><strong></strong> <span class="muted">(český ženský hlas)</span></span></label><button class="secondary" type="button">▶ Vyzkoušet</button>`;
  row.querySelector('strong').textContent=v.name;
  row.querySelector('input').onclick=row.querySelector('input').onchange=()=>{try{localStorage.setItem(KEY,v.id)}catch(e){}fill()};
  row.querySelector('button').onclick=()=>playClip(v,v.sample||'sample');box.appendChild(row)});
 info.textContent='Raven mluví hlasem: '+cur.name+'. Další ženské hlasy přibudou, až budou nahrané se souhlasem.';
 const cr=document.getElementById('voiceCredit');if(cr)cr.textContent=M.voices.map(v=>v.credit).join(' • ')}
function panel(){if(document.getElementById('voicePanel'))return;
 const s=document.createElement('section');s.className='panel';s.id='voicePanel';
 s.innerHTML='<h2>🎙️ Hlas Raven</h2><p class="muted">Vyber český ženský hlas, kterým bude Raven mluvit. Hlasy jsou nahrané přímo v aplikaci a fungují i bez internetu. Hlas zazní jen po kliknutí.</p><div id="voiceList"></div><p class="muted" id="voiceInfo" style="margin-bottom:0"></p>';
 const hero=document.querySelector('.hero');hero&&hero.parentNode?hero.parentNode.insertBefore(s,hero.nextSibling):document.body.appendChild(s);
 const f=document.querySelector('.footer');if(f&&!document.getElementById('voiceCredit')){const p=document.createElement('div');p.id='voiceCredit';p.style.marginTop='6px';f.appendChild(p)}
 fill()}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',panel):panel();
window.__bandVoice={gender,voice,idFor,stop,ready:()=>ready};
})();
