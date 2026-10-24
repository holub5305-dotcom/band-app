const instruments=[['🎸','Elektrická kytara','Začneme laděním E A D G H e, rytmem a jednoduchými riffy. U power akordů hraješ obvykle dva nebo tři tóny.'],['🥁','Bicí','Začni pravidelným počítáním jedna, dva, tři, čtyři. Kopák zahraj na první a třetí dobu, virbl na druhou a čtvrtou.'],['🎸','Baskytara','Basa propojuje rytmus bicích s harmonií. Začni střídáním tónů E a A v pravidelném tempu.'],['🎹','Klavír','Najdi prostřední C. Stupnice C dur používá bílé klávesy C D E F G A H C.'],['🎤','Zpěv','Nejdřív uvolni ramena a dýchej klidně. Pak zazpívej jeden pohodlný tón bez tlačení na hlas.']];
let current=0,selected='Em';const $=id=>document.getElementById(id);
function speak(s){if(!('speechSynthesis' in window)){ $('status').textContent='Toto zařízení nepodporuje hlasové čtení.';return;}speechSynthesis.cancel();let u=new SpeechSynthesisUtterance(s);u.lang='cs-CZ';u.rate=.88;const voices=speechSynthesis.getVoices();const cz=voices.filter(v=>v.lang.toLowerCase().startsWith('cs'));u.voice=cz.find(v=>/female|woman|zuzana|vlasta/i.test(v.name))||cz[0]||null;speechSynthesis.speak(u)}
function showInstrument(i){current=i;document.querySelectorAll('.tile').forEach((b,n)=>b.classList.toggle('selected',n===i));$('lessonTitle').textContent=instruments[i][0]+' '+instruments[i][1];$('lesson').textContent=instruments[i][2];$('status').textContent='Lekce je připravena.'}function readLesson(){speak(instruments[current][2])}
$('instruments').innerHTML=instruments.map((v,i)=>`<button class="tile" onclick="showInstrument(${i})">${v[0]}<br>${v[1]}</button>`).join('');showInstrument(0);
// Akordy a přehrávač: chords.js (BAND_CHORDS, bandPlayChord). -1 = ztlumená struna.
function chords(){return window.BAND_CHORDS||{}}
function chordList(){return window.BAND_CHORD_ORDER || Object.keys(chords())}
$('chords').innerHTML = (()=>{
  const ord=chordList(), basic=ord.filter(k=>chords()[k]&&chords()[k].group!=='power'), power=ord.filter(k=>chords()[k]&&chords()[k].group==='power');
  let h='<span class="muted" style="width:100%;margin:4px 0 2px">Základní</span>';
  h+=basic.map(k=>`<button class="secondary" onclick="showChord('${k}')">${k}</button>`).join('');
  h+='<span class="muted" style="width:100%;margin:8px 0 2px">Power</span>';
  h+=power.map(k=>`<button class="secondary" onclick="showChord('${k}')">${k}</button>`).join('');
  return h;
})();
function showChord(k){
  selected=k;const c=chords()[k];if(!c)return;
  $('chordTitle').textContent='Akord '+c.name+' – '+c.title;
  $('chordDesc').textContent=c.desc;
  if(window.bandDrawChordDiagram)$('fret').innerHTML=window.bandDrawChordDiagram(c);
  else{
    let s='<svg viewBox="0 0 520 245" role="img" aria-label="Diagram akordu '+k+'">';
    for(let i=0;i<6;i++){let x=80+i*68;s+=`<line x1="${x}" y1="42" x2="${x}" y2="212" stroke="#c8c8d0" stroke-width="${2.8-i*.35}"/><text x="${x}" y="20" text-anchor="middle" fill="#e6e6ea" font-size="14">${['E','A','D','G','H','e'][i]}</text>`;let f=c.frets[i];if(f<0)s+=`<text x="${x}" y="37" text-anchor="middle" fill="#ff6b6b">×</text>`;else if(f===0)s+=`<circle cx="${x}" cy="32" r="6" fill="none" stroke="#e0202f" stroke-width="2"/>`;else{s+=`<circle cx="${x}" cy="${42+(f-.5)*34}" r="13" fill="#b3001b"/><text x="${x}" y="${47+(f-.5)*34}" text-anchor="middle" fill="white" font-size="13">${c.fingers[i]||''}</text>`}}
    for(let f=0;f<=5;f++)s+=`<line x1="80" y1="${42+f*34}" x2="420" y2="${42+f*34}" stroke="#8a8a92" stroke-width="${f===0?5:1}"/>`;
    s+='</svg>';$('fret').innerHTML=s;
  }
}
function readChord(){
  const c=chords()[selected];if(!c)return;
  if(c.voiceId&&typeof window.ravenSay==='function'&&window.ravenSay(c.voiceId))return;
  if(typeof window.speak==='function')window.speak(c.desc);else speak(c.desc);
}
showChord('Em');
function playChord(){
  const c=chords()[selected];if(!c)return;
  if(typeof window.bandPlayChord==='function'){
    window.bandPlayChord(c.frets,{power:!!c.power,label:c.name,statusEl:'status'});
  }else{
    $('status').textContent='Přehrávač akordů není načtený.';
  }
}
// Nahrávací studio je v studio.js (trvalé ukládání do IndexedDB).
const key='bandapp-favorites';function renderFavorites(){let items=JSON.parse(localStorage.getItem(key)||'[]');$('favorites').replaceChildren(...items.map((v,i)=>{let p=document.createElement('p'),a=document.createElement('a'),b=document.createElement('button');a.href=v.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=v.name;a.style.color='#ff5a66';b.textContent=' ×';b.className='secondary';b.onclick=()=>{items.splice(i,1);localStorage.setItem(key,JSON.stringify(items));renderFavorites()};p.append(a,' ',b);return p}))}$('favoriteForm').onsubmit=e=>{e.preventDefault();let name=$('favName').value.trim(),url=$('favUrl').value.trim();if(!/^https?:\/\//i.test(url))return;let items=JSON.parse(localStorage.getItem(key)||'[]');items.push({name,url});localStorage.setItem(key,JSON.stringify(items));e.target.reset();renderFavorites()};renderFavorites();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
