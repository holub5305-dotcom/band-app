(function(){
const $=id=>document.getElementById(id);const KEY='bandapp-lesson-em-done';
const STR=['E','A','D','G','H','e'];
const STRN=['E (6. struna, nejhlubší)','A (5. struna)','D (4. struna)','G (3. struna)','H (2. struna, mezinárodně B)','e (1. struna, nejvyšší)'];
const EM={frets:[0,2,2,0,0,0],fingers:[0,2,3,0,0,0]};const FN={2:'prostředníček',3:'prsteníček'};const FC={2:'#b3001b',3:'#c0c0c8'};
const STEPS=[
{t:'Krok 1 – Co je akord?',r:'„Ahoj! Já jsem Raven. Akord vzniká, když zahrajeme několik tónů současně. Dneska se naučíme E moll. Má trochu temnější zvuk a krásně se hodí do rockové hudby.“'},
{t:'Krok 2 – Jak držet akord Em?',r:'Podívej se na hmatník. Klepni na kteroukoli strunu nebo pražec a já ti vysvětlím, co tam dělat.'},
{t:'Krok 3 – Poslech akordu',r:'Klikni na „Přehrát Em“ a poslechni si, jak E moll zní. Struny zazní postupně od nejhlubší.'},
{t:'Krok 4 – Procvičování',r:'„Polož prostředníček na druhý pražec struny A a prsteníček na druhý pražec struny D. Ostatní struny nech otevřené. Zahraj pomalu všech šest strun.“'},
{t:'Krok 5 – Dokončení',r:'„Skvělá práce! Máš za sebou svůj první akord. Příště se naučíme Am.“'}];
let step=0;
function fretboard(){const X0=70,FW=90,Y0=40,SG=36;let s=`<svg id="emBoard" viewBox="0 0 470 270" role="img" aria-label="Hmatník akordu Em">`;
s+=`<rect x="${X0}" y="${Y0-12}" width="${FW*4}" height="${SG*5+24}" fill="#2b1a12"/>`;
for(let f=0;f<=4;f++){const x=X0+f*FW;s+=`<line x1="${x}" y1="${Y0-12}" x2="${x}" y2="${Y0+SG*5+12}" stroke="${f?'#8a8a92':'#e6e6ea'}" stroke-width="${f?3:8}"/>`;if(f)s+=`<text x="${x-FW/2}" y="${Y0+SG*5+38}" text-anchor="middle" fill="#c0c0c8" font-size="15">${f}. pražec</text>`}
for(let i=0;i<6;i++){const si=5-i,y=Y0+i*SG;// top = high e, bottom = low E (view as when looking down)
s+=`<line x1="${X0}" y1="${y}" x2="${X0+FW*4}" y2="${y}" stroke="#c8c8d0" stroke-width="${1+si*.5}"/>`;
s+=`<text x="${X0-38}" y="${y+5}" text-anchor="middle" fill="#f2f2f2" font-size="17" font-weight="bold">${STR[si]}</text>`;
const f=EM.frets[si];if(f===0)s+=`<circle cx="${X0-14}" cy="${y}" r="7" fill="none" stroke="#e0202f" stroke-width="2.5" data-open="${si}"/>`;
for(let fr=0;fr<=4;fr++){const x=fr?X0+(fr-1)*FW:X0-60,w=fr?FW:60;s+=`<rect class="hit" data-s="${si}" data-f="${fr}" x="${x}" y="${y-SG/2}" width="${w}" height="${SG}" fill="transparent" style="cursor:pointer"/>`}
if(f>0){const cx=X0+(f-.5)*FW;s+=`<g class="dot" data-s="${si}" data-f="${f}" data-finger="${EM.fingers[si]}" pointer-events="none"><circle cx="${cx}" cy="${y}" r="15" fill="${FC[EM.fingers[si]]}" stroke="#0a0a0a" stroke-width="2"/><text x="${cx}" y="${y+5}" text-anchor="middle" fill="${EM.fingers[si]===3?'#0a0a0a':'#fff'}" font-size="15" font-weight="bold">${EM.fingers[si]}</text></g>`}}
s+=`<text x="${X0-38}" y="${Y0+SG*5+22}" text-anchor="middle" fill="#e0202f" font-size="11">nejhlubší</text><text x="${X0-38}" y="${Y0-20}" text-anchor="middle" fill="#c0c0c8" font-size="11">nejvyšší</text></svg>`;return s}
function explain(si,fr){const need=EM.frets[si];let m=`Struna ${STRN[si]}, `+(fr?`${fr}. pražec: `:'otevřená (bez pražce): ');
if(need===0)m+=fr?'Tady nemačkej. U Em necháváš tuto strunu otevřenou – hraje volně.':'Ano! U Em tuto strunu hraješ otevřenou, nic nemačkáš.';
else if(fr===need)m+=`Tady zmáčkni – ${FN[EM.fingers[si]]} (prst ${EM.fingers[si]}).`;
else m+=`Tady ne. Na této struně patří ${FN[EM.fingers[si]]} (prst ${EM.fingers[si]}) na ${need}. pražec.`;
$('emExplain').textContent=m;document.querySelectorAll('#emBoard .hit').forEach(r=>r.setAttribute('fill',(+r.dataset.s===si&&+r.dataset.f===fr)?'rgba(224,32,47,.25)':'transparent'))}
window.bandPlayEm=function(){
  if(typeof window.bandPlayChord==='function'){
    return window.bandPlayChord(EM.frets,{label:'E moll',statusEl:'emAudioStatus'});
  }
  // Záloha, kdyby chords.js nebyl načtený (stejný Karplus–Strong + resume).
  let ctx=window.__bandEmCtx||new (window.AudioContext||window.webkitAudioContext)();window.__bandEmCtx=ctx;window.__bandEmNodes=0;
  const go=()=>{const fq=[82.41,123.47,164.81,196.00,246.94,329.63],sr=ctx.sampleRate,master=ctx.createGain();master.gain.value=.9;master.connect(ctx.destination);
  fq.forEach((f,i)=>{const len=Math.floor(sr*2.2),buf=ctx.createBuffer(1,len,sr),d=buf.getChannelData(0),N=Math.round(sr/f);const ring=new Float32Array(N);for(let k=0;k<N;k++)ring[k]=Math.random()*2-1;let p=0;for(let k=0;k<len;k++){const a=ring[p],b=ring[(p+1)%N];d[k]=a;ring[p]=.996*.5*(a+b);p=(p+1)%N}
  const src=ctx.createBufferSource(),g=ctx.createGain();src.buffer=buf;g.gain.value=.32;src.connect(g).connect(master);src.start(ctx.currentTime+.05+i*.07);window.__bandEmNodes++});$('emAudioStatus').textContent='▶ Hraje E moll…'};
  ctx.state==='suspended'?ctx.resume().then(go):go()};
function render(){const S=STEPS[step];$('emStepTitle').textContent=S.t;$('emRaven').textContent=S.r;$('emRaven').classList.remove('flash');
$('emProgress').innerHTML=STEPS.map((_,i)=>`<span class="${i<=step?'on':''}" aria-label="Krok ${i+1}">${i+1}</span>`).join('');
$('emBoardWrap').hidden=!(step===1||step===3);$('emPlayBox').hidden=!(step===2||step===3);$('emPlay').textContent=step===3?'♪ Přehrát ukázku':'♪ Přehrát Em';
$('emPractice').hidden=step!==3;$('emDone').hidden=step!==4;$('emPrev').hidden=step===0||step===4;$('emNext').hidden=step>=3;
if(step===4){const d=JSON.parse(localStorage.getItem(KEY)||'null');$('emSaved').textContent=d?`Dokončení uloženo v tomto zařízení (${new Date(d.date).toLocaleString('cs-CZ')}).`:''}}
function overview(){const d=localStorage.getItem(KEY);$('emBadge').textContent=d?'✔ Dokončeno':'';}
window.bandOpenEm=function(){step=0;const cl=$('chordLesson');if(cl)cl.hidden=true;$('emLesson').hidden=false;render();$('emLesson').scrollIntoView({behavior:'smooth'})};
$('emBoardWrap').querySelector('.fret').innerHTML=fretboard();
$('emBoard').addEventListener('click',e=>{const r=e.target.closest('.hit');if(r)explain(+r.dataset.s,+r.dataset.f)});
$('emPlay').onclick=window.bandPlayEm;$('emPrev').onclick=()=>{step--;render()};$('emNext').onclick=()=>{step++;render()};$('emNext4').onclick=$('emFinish').onclick=()=>{localStorage.setItem(KEY,JSON.stringify({done:true,date:new Date().toISOString()}));step=4;render();overview()};
$('emNext4').onclick=()=>{step=4;localStorage.setItem(KEY,JSON.stringify({done:true,date:new Date().toISOString()}));render();overview()};
$('emRepeat').onclick=()=>{const r=$('emRaven');r.classList.remove('flash');void r.offsetWidth;r.classList.add('flash');r.scrollIntoView({behavior:'smooth',block:'center'})};
$('emBack').onclick=()=>{$('emLesson').hidden=true;$('emOverview').scrollIntoView({behavior:'smooth'})};$('emAgain').onclick=()=>{step=0;render()};
overview();window.__bandEm={EM,STR}})();
