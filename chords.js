/* BAND APP 1.1 – společný přehrávač kytarových akordů + slovník + lekce (kromě Em, ta zůstává v lesson-em.js).
   Jedna sdílená AudioContext, vždy resume() po klepnutí. Bez externích knihoven. */
(function(){
'use strict';
const BASE=[82.41,110,146.83,196,246.94,329.63]; // E2 A2 D3 G3 B3 E4
const STR=['E','A','D','G','H','e'];
const STRN=['E (6. struna, nejhlubší)','A (5. struna)','D (4. struna)','G (3. struna)','H (2. struna, mezinárodně B)','e (1. struna, nejvyšší)'];
const FN={1:'ukazováček',2:'prostředníček',3:'prsteníček',4:'malíček'};
const FC={1:'#e0202f',2:'#b3001b',3:'#c0c0c8',4:'#8a8a92'};

/** @type {AudioContext|null} */
let sharedCtx=null;
window.__bandChordPlayLog=[];

function getCtx(){
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!AC)return null;
  if(!sharedCtx||sharedCtx.state==='closed')sharedCtx=new AC();
  window.__bandChordCtx=sharedCtx;
  return sharedCtx;
}

function freqHz(stringIdx,fret){
  if(fret<0)return null;
  return BASE[stringIdx]*Math.pow(2,fret/12);
}

function freqsFromFrets(frets){
  const out=[];
  frets.forEach((f,i)=>{const hz=freqHz(i,f);if(hz!=null)out.push({i,f,hz})});
  return out;
}

/** Karplus–Strong pluck, stejný princip jako bandPlayEm. */
function pluck(ctx,hz,when,gainVal,dur){
  const sr=ctx.sampleRate,len=Math.floor(sr*(dur||2.2)),buf=ctx.createBuffer(1,len,sr),d=buf.getChannelData(0);
  const N=Math.max(2,Math.round(sr/hz));
  const ring=new Float32Array(N);
  for(let k=0;k<N;k++)ring[k]=Math.random()*2-1;
  let p=0;
  for(let k=0;k<len;k++){
    const a=ring[p],b=ring[(p+1)%N];
    d[k]=a;ring[p]=.996*.5*(a+b);p=(p+1)%N;
  }
  const src=ctx.createBufferSource(),g=ctx.createGain();
  src.buffer=buf;g.gain.value=gainVal;
  src.connect(g).connect(ctx.destination);
  src.start(when);
  return src;
}

/**
 * Přehrát akord podle pražců [-1|0|1..].
 * opts: {power?:boolean, statusEl?:HTMLElement|string, label?:string}
 */
window.bandPlayChord=function(frets,opts){
  opts=opts||{};
  const ctx=getCtx();
  const log={t:Date.now(),frets:frets.slice(),ok:false,reason:null,nodes:0,resumed:false};
  window.__bandChordPlayLog.push(log);
  if(window.__bandChordPlayLog.length>80)window.__bandChordPlayLog.shift();
  function st(msg){
    const el=typeof opts.statusEl==='string'?document.getElementById(opts.statusEl):opts.statusEl;
    if(el)el.textContent=msg;
    const s=document.getElementById('status');if(s&&!el)s.textContent=msg;
  }
  if(!ctx){log.reason='no-AudioContext';st('Toto zařízení nepodporuje Web Audio – akord nelze přehrát.');return Promise.resolve(false)}
  const go=()=>{
    const notes=freqsFromFrets(frets);
    if(!notes.length){log.reason='all-muted';st('Tento akord nemá žádnou znějící strunu.');return false}
    const power=!!opts.power||notes.length<=3;
    const masterGain=power?.42:.32;
    const delay=power?.065:.075;
    notes.forEach((n,i)=>{
      pluck(ctx,n.hz,ctx.currentTime+.04+i*delay,masterGain,power?1.8:2.2);
      log.nodes++;
    });
    log.ok=true;log.hz=notes.map(n=>+n.hz.toFixed(2));
    window.__bandEmNodes=log.nodes; // kompatibilita s Em testy
    st('▶ Hraje '+(opts.label||'akord')+'…');
    return true;
  };
  if(ctx.state==='suspended'){
    log.resumed=true;
    return ctx.resume().then(()=>{go();return log.ok}).catch(e=>{log.reason='resume-fail';st('Zvuk se nepodařilo spustit. Klepni znovu.');return false});
  }
  go();
  return Promise.resolve(log.ok);
};

window.bandChordFreqs=freqsFromFrets;
window.bandChordBase=BASE.slice();

/* —— Slovník akordů —— */
const CHORDS={
  Em:{id:'Em',name:'Em',title:'E moll',say:'é moll',group:'basic',frets:[0,2,2,0,0,0],fingers:[0,2,3,0,0,0],power:false,
    desc:'E moll: prostředníček na druhý pražec struny A, prsteníček na druhý pražec struny D. Zahraj všech šest strun.',
    tip:'Em je ideální první rockový akord – temnější zvuk, všechny struny zní.',
    voiceId:'chord-Em',num:1},
  E:{id:'E',name:'E',title:'E dur',say:'é dur',group:'basic',frets:[0,2,2,1,0,0],fingers:[0,2,3,1,0,0],power:false,
    desc:'E dur: ukazováček na první pražec struny G, prostředníček na druhý pražec A, prsteníček na druhý pražec D. Zahraj všech šest strun.',
    tip:'E dur je jasnější než Em. Přidej ukazováček na G a zní to veseleji.',
    voiceId:'chord-E',num:2},
  Am:{id:'Am',name:'Am',title:'A moll',say:'á moll',group:'basic',frets:[-1,0,2,2,1,0],fingers:[0,0,2,3,1,0],power:false,
    desc:'A moll: nehraj tlustou strunu E. Ukazováček na první pražec struny H, prostředníček na druhý pražec D, prsteníček na druhý pražec G.',
    tip:'Am: tlustou E tlum palcem nebo ji vůbec nebrnkej. Zní smutně a krásně.',
    voiceId:'chord-Am',num:3},
  A:{id:'A',name:'A',title:'A dur',say:'á dur',group:'basic',frets:[-1,0,2,2,2,0],fingers:[0,0,2,1,3,0],power:false,
    desc:'A dur: nehraj tlustou E. Prostředníček na druhý pražec D, ukazováček na druhý pražec G, prsteníček na druhý pražec H. Tenká e otevřená.',
    tip:'A dur: tři prsty vedle sebe na druhém pražci. Tlustou E nech.',
    voiceId:'chord-A',num:4},
  C:{id:'C',name:'C',title:'C dur',say:'cé dur',group:'basic',frets:[-1,3,2,0,1,0],fingers:[0,3,2,0,1,0],power:false,
    desc:'C dur: prsteníček na třetí pražec A, prostředníček na druhý pražec D, ukazováček na první pražec H. Tlustou E nehraj.',
    tip:'C dur: roztáhni prsty – prsteníček na A, prostředníček na D, ukazováček na H.',
    voiceId:'chord-C',num:5},
  D:{id:'D',name:'D',title:'D dur',say:'dé dur',group:'basic',frets:[-1,-1,0,2,3,2],fingers:[0,0,0,1,3,2],power:false,
    desc:'D dur: hraj od struny D. Ukazováček na druhý pražec G, prsteníček na třetí pražec H a prostředníček na druhý pražec tenké e.',
    tip:'D dur: trojúhelník tří prstů. E a A nech – hraj jen od D nahoru.',
    voiceId:'chord-D',num:6},
  Dm:{id:'Dm',name:'Dm',title:'D moll',say:'dé moll',group:'basic',frets:[-1,-1,0,2,3,1],fingers:[0,0,0,2,3,1],power:false,
    desc:'D moll: hraj od struny D. Ukazováček na první pražec tenké e, prostředníček na druhý pražec G, prsteníček na třetí pražec H.',
    tip:'Dm je melancholický. Oproti D dur má ukazováček na prvním pražci e.',
    voiceId:'chord-Dm',num:7},
  G:{id:'G',name:'G',title:'G dur',say:'gé dur',group:'basic',frets:[3,2,0,0,0,3],fingers:[2,1,0,0,0,3],power:false,
    desc:'G dur: prostředníček na třetí pražec tlusté E, ukazováček na druhý pražec A a prsteníček na třetí pražec tenké e.',
    tip:'G dur: prostředníček a ukazováček dole, prsteníček nahoře na tenké e.',
    voiceId:'chord-G',num:8},
  F:{id:'F',name:'F',title:'F dur (barre)',say:'ef dur',group:'basic',frets:[1,3,3,2,1,1],fingers:[1,3,4,2,1,1],power:false,
    desc:'F dur (barre): ukazováček položí napříč všechny struny na prvním pražci. Prostředníček na druhý pražec G, prsteníček na třetí A, malíček na třetí D.',
    tip:'F je barre – ukazováček drží celý první pražec. Chce to cvik, nespěchej.',
    voiceId:'chord-F',num:9},
  B7:{id:'B7',name:'B7',title:'B7',say:'bé sedm',group:'basic',frets:[-1,2,1,2,0,2],fingers:[0,2,1,3,0,4],power:false,
    desc:'B7: nehraj tlustou E. Prostředníček na druhý pražec A, ukazováček na první pražec D, prsteníček na druhý pražec G, malíček na druhý pražec tenké e. H otevřená.',
    tip:'B7 zní bluesově. Čtyři prsty, H nech otevřenou.',
    voiceId:'chord-B7',num:10},
  E5:{id:'E5',name:'E5',title:'E5 (power)',say:'é pět',group:'power',frets:[0,2,2,-1,-1,-1],fingers:[0,1,3,0,0,0],power:true,
    desc:'Power akord E5: otevřená tlustá E, ukazováček na druhém pražci A a prsteníček na druhém pražci D. Ostatní struny tlum.',
    tip:'E5 je základ rocku – jen tři tóny, silný a čistý zvuk.',
    voiceId:'chord-E5',num:11},
  A5:{id:'A5',name:'A5',title:'A5 (power)',say:'á pět',group:'power',frets:[-1,0,2,2,-1,-1],fingers:[0,0,1,3,0,0],power:true,
    desc:'Power akord A5: otevřená A, ukazováček na druhém pražci D, prsteníček na druhém pražci G. Tlustou E a tenké struny tlum.',
    tip:'A5: stejný tvar jako E5, jen o strunu výš.',
    voiceId:'chord-A5',num:12},
  D5:{id:'D5',name:'D5',title:'D5 (power)',say:'dé pět',group:'power',frets:[-1,-1,0,2,3,-1],fingers:[0,0,0,1,3,0],power:true,
    desc:'Power akord D5: otevřená D, ukazováček na druhém pražci G, prsteníček na třetím pražci H. Ostatní struny tlum.',
    tip:'D5: dva prsty, ostrý rockový zvuk od struny D.',
    voiceId:'chord-D5',num:13},
  G5:{id:'G5',name:'G5',title:'G5 (power)',say:'gé pět',group:'power',frets:[3,5,5,-1,-1,-1],fingers:[1,3,4,0,0,0],power:true,
    desc:'Power akord G5: ukazováček na třetím pražci tlusté E, prsteníček na pátém A, malíček na pátém D. Ostatní struny tlum.',
    tip:'G5: stejný tvar jako E5, posunutý na 3. pražec.',
    voiceId:'chord-G5',num:14},
  C5:{id:'C5',name:'C5',title:'C5 (power)',say:'cé pět',group:'power',frets:[-1,3,5,5,-1,-1],fingers:[0,1,3,4,0,0],power:true,
    desc:'Power akord C5: ukazováček na třetím pražci A, prsteníček na pátém D, malíček na pátém G. Ostatní struny tlum.',
    tip:'C5: tvar A5 posunutý na 3. pražec.',
    voiceId:'chord-C5',num:15},
  F5:{id:'F5',name:'F5',title:'F5 (power)',say:'ef pět',group:'power',frets:[1,3,3,-1,-1,-1],fingers:[1,3,4,0,0,0],power:true,
    desc:'Power akord F5: ukazováček na prvním pražci tlusté E, prsteníček na třetím A, malíček na třetím D. Ostatní struny tlum.',
    tip:'F5: tvar E5 posunutý na 1. pražec – snadnější než celé F barre.',
    voiceId:'chord-F5',num:16}
};
window.BAND_CHORDS=CHORDS;
window.BAND_CHORD_ORDER=['Em','E','Am','A','C','D','Dm','G','F','B7','E5','A5','D5','G5','C5','F5'];

/** Diagram: svislé struny E…e, × muted, ○ open, čísla prstů. */
window.bandDrawChordDiagram=function(c,opts){
  opts=opts||{};
  const frets=c.frets,fingers=c.fingers||[];
  const maxF=Math.max(4,...frets.filter(f=>f>0));
  const rows=Math.max(5,maxF);
  const W=520,H=42+rows*34+20;
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Diagram akordu ${c.name}">`;
  for(let i=0;i<6;i++){
    const x=80+i*68;
    s+=`<line x1="${x}" y1="42" x2="${x}" y2="${42+rows*34}" stroke="#c8c8d0" stroke-width="${2.8-i*.35}"/>`;
    s+=`<text x="${x}" y="20" text-anchor="middle" fill="#e6e6ea" font-size="14">${STR[i]}</text>`;
    const f=frets[i];
    if(f<0)s+=`<text x="${x}" y="37" text-anchor="middle" fill="#ff6b6b" font-size="18" font-weight="bold">×</text>`;
    else if(f===0)s+=`<circle cx="${x}" cy="32" r="6" fill="none" stroke="#e0202f" stroke-width="2"/>`;
    else{
      const cy=42+(f-.5)*34;
      const fi=fingers[i]||'';
      const fill=FC[fi]||'#b3001b';
      const tc=fi===3?'#0a0a0a':'#fff';
      s+=`<circle cx="${x}" cy="${cy}" r="13" fill="${fill}"/><text x="${x}" y="${cy+5}" text-anchor="middle" fill="${tc}" font-size="13" font-weight="bold">${fi}</text>`;
    }
  }
  for(let f=0;f<=rows;f++)s+=`<line x1="80" y1="${42+f*34}" x2="420" y2="${42+f*34}" stroke="#8a8a92" stroke-width="${f===0?5:1}"/>`;
  if(c.power)s+=`<text x="450" y="60" fill="#e0202f" font-size="12">power</text>`;
  s+='</svg>';
  return s;
};

/** Interaktivní hmatník (jako Em lekce), view shora e…E. */
window.bandDrawInteractiveBoard=function(c,svgId){
  const frets=c.frets,fingers=c.fingers||[];
  const maxF=Math.max(4,...frets.filter(f=>f>0));
  const nFrets=Math.max(4,maxF);
  const X0=70,FW=90,Y0=40,SG=36;
  let s=`<svg id="${svgId||'chordBoard'}" viewBox="0 0 ${70+FW*nFrets+40} ${Y0+SG*5+50}" role="img" aria-label="Hmatník akordu ${c.name}">`;
  s+=`<rect x="${X0}" y="${Y0-12}" width="${FW*nFrets}" height="${SG*5+24}" fill="#2b1a12"/>`;
  for(let f=0;f<=nFrets;f++){
    const x=X0+f*FW;
    s+=`<line x1="${x}" y1="${Y0-12}" x2="${x}" y2="${Y0+SG*5+12}" stroke="${f?'#8a8a92':'#e6e6ea'}" stroke-width="${f?3:8}"/>`;
    if(f)s+=`<text x="${x-FW/2}" y="${Y0+SG*5+38}" text-anchor="middle" fill="#c0c0c8" font-size="15">${f}. pražec</text>`;
  }
  for(let i=0;i<6;i++){
    const si=5-i,y=Y0+i*SG;
    s+=`<line x1="${X0}" y1="${y}" x2="${X0+FW*nFrets}" y2="${y}" stroke="#c8c8d0" stroke-width="${1+si*.5}"/>`;
    s+=`<text x="${X0-38}" y="${y+5}" text-anchor="middle" fill="#f2f2f2" font-size="17" font-weight="bold">${STR[si]}</text>`;
    const f=frets[si];
    if(f<0)s+=`<text x="${X0-14}" y="${y+6}" text-anchor="middle" fill="#ff6b6b" font-size="16" font-weight="bold">×</text>`;
    else if(f===0)s+=`<circle cx="${X0-14}" cy="${y}" r="7" fill="none" stroke="#e0202f" stroke-width="2.5"/>`;
    for(let fr=0;fr<=nFrets;fr++){
      const x=fr?X0+(fr-1)*FW:X0-60,w=fr?FW:60;
      s+=`<rect class="hit" data-s="${si}" data-f="${fr}" x="${x}" y="${y-SG/2}" width="${w}" height="${SG}" fill="transparent" style="cursor:pointer"/>`;
    }
    if(f>0){
      const cx=X0+(f-.5)*FW,fi=fingers[si],fill=FC[fi]||'#b3001b',tc=fi===3?'#0a0a0a':'#fff';
      s+=`<g class="dot" pointer-events="none"><circle cx="${cx}" cy="${y}" r="15" fill="${fill}" stroke="#0a0a0a" stroke-width="2"/><text x="${cx}" y="${y+5}" text-anchor="middle" fill="${tc}" font-size="15" font-weight="bold">${fi||''}</text></g>`;
    }
  }
  s+=`<text x="${X0-38}" y="${Y0+SG*5+22}" text-anchor="middle" fill="#e0202f" font-size="11">nejhlubší</text>`;
  s+=`<text x="${X0-38}" y="${Y0-20}" text-anchor="middle" fill="#c0c0c8" font-size="11">nejvyšší</text></svg>`;
  return s;
};

window.bandExplainFret=function(c,si,fr){
  const need=c.frets[si],fi=c.fingers[si];
  let m=`Struna ${STRN[si]}, `+(fr?`${fr}. pražec: `:'otevřená (bez pražce): ');
  if(need<0)m+=fr?'Tady nic nemačkej – tuhle strunu u '+c.name+' vůbec nehraj (×).':'Ano – tuhle strunu u '+c.name+' nehraj (ztlum).';
  else if(need===0)m+=fr?'Tady nemačkej. U '+c.name+' necháváš tuto strunu otevřenou.':'Ano! U '+c.name+' tuto strunu hraješ otevřenou.';
  else if(fr===need)m+=`Tady zmáčkni – ${FN[fi]||('prst '+fi)} (prst ${fi}).`;
  else if(need>0)m+=`Tady ne. Na této struně patří ${FN[fi]||('prst '+fi)} na ${need}. pražec.`;
  else m+='—';
  return m;
};

/* —— Generic lesson (ne Em) —— */
function doneKey(id){return 'bandapp-lesson-'+id.toLowerCase()+'-done'}

function stepsFor(c){
  return [
    {t:'Krok 1 – Seznámení s '+c.name,r:'Ahoj! Já jsem Raven. Dneska si ukážeme akord '+(c.say||c.title)+' ('+c.name+'). '+c.tip},
    {t:'Krok 2 – Hmatník',r:'Podívej se na hmatník. Klepni na strunu nebo pražec a já ti řeknu, co tam dělat. × = nehrát, ○ = otevřená, číslo = který prst.'},
    {t:'Krok 3 – Poslech',r:'Klepni na „Přehrát '+c.name+'“ a poslechni si zvuk. Struny zazní postupně od nejhlubší.'},
    {t:'Krok 4 – Procvičování',r:c.desc},
    {t:'Krok 5 – Hotovo',r:'Skvělá práce! Akord '+c.name+' máš za sebou. Můžeš se vrátit na přehled a vybrat další.'}
  ];
}

let lessonId=null,lessonStep=0,lessonChord=null;

function lessonRender(){
  const c=lessonChord,S=stepsFor(c)[lessonStep];
  const $=id=>document.getElementById(id);
  $('clTitle').textContent='Lekce – '+c.title+' ('+c.name+')';
  $('clStepTitle').textContent=S.t;
  $('clRaven').textContent=S.r;
  $('clProgress').innerHTML=stepsFor(c).map((_,i)=>`<span class="${i<=lessonStep?'on':''}" aria-label="Krok ${i+1}">${i+1}</span>`).join('');
  $('clBoardWrap').hidden=!(lessonStep===1||lessonStep===3);
  $('clPlayBox').hidden=!(lessonStep===2||lessonStep===3);
  $('clPlay').textContent=lessonStep===3?'♪ Přehrát ukázku':'♪ Přehrát '+c.name;
  $('clPractice').hidden=lessonStep!==3;
  $('clDone').hidden=lessonStep!==4;
  $('clPrev').hidden=lessonStep===0||lessonStep===4;
  $('clNext').hidden=lessonStep>=3;
  if(lessonStep===4){
    const d=JSON.parse(localStorage.getItem(doneKey(c.id))||'null');
    $('clSaved').textContent=d?`Dokončení uloženo v tomto zařízení (${new Date(d.date).toLocaleString('cs-CZ')}).`:'';
  }
  // hlas: Kasandra clip pokud existuje
  if(lessonStep===0&&c.voiceId&&typeof window.ravenSay==='function'){
    try{window.ravenSay(c.voiceId)}catch(e){}
  }
}

function fillBoard(){
  const wrap=document.querySelector('#clBoardWrap .fret');
  if(!wrap||!lessonChord)return;
  wrap.innerHTML=window.bandDrawInteractiveBoard(lessonChord,'clBoard');
  const board=document.getElementById('clBoard');
  if(board)board.onclick=e=>{
    const r=e.target.closest('.hit');if(!r)return;
    document.getElementById('clExplain').textContent=window.bandExplainFret(lessonChord,+r.dataset.s,+r.dataset.f);
    board.querySelectorAll('.hit').forEach(h=>h.setAttribute('fill',(+h.dataset.s===+r.dataset.s&&+h.dataset.f===+r.dataset.f)?'rgba(224,32,47,.25)':'transparent'));
  };
  // legend
  const leg=document.getElementById('clLegend');
  if(leg){
    const used=[...new Set(lessonChord.fingers.filter(Boolean))];
    leg.innerHTML=used.map(f=>`<span><i style="background:${FC[f]}"></i>${f} = ${FN[f]}</span>`).join('')+
      '<span><i style="border:2px solid #e0202f"></i>otevřená</span><span style="color:#ff6b6b">× nehrát</span>';
  }
}

window.bandOpenChordLesson=function(id){
  const c=CHORDS[id];if(!c)return;
  if(id==='Em'&&typeof window.bandOpenEm==='function'){window.bandOpenEm();return}
  lessonId=id;lessonChord=c;lessonStep=0;
  const em=document.getElementById('emLesson');if(em)em.hidden=true;
  const panel=document.getElementById('chordLesson');if(!panel)return;
  panel.hidden=false;fillBoard();lessonRender();
  panel.scrollIntoView({behavior:'smooth'});
};

function markDone(){
  if(!lessonChord)return;
  localStorage.setItem(doneKey(lessonChord.id),JSON.stringify({done:true,date:new Date().toISOString()}));
  lessonStep=4;lessonRender();overviewBadges();
}

function overviewBadges(){
  window.BAND_CHORD_ORDER.forEach(id=>{
    const el=document.getElementById(id==='Em'?'emBadge':('badge-'+id));
    if(!el)return;
    if(id==='Em'){el.textContent=localStorage.getItem('bandapp-lesson-em-done')?'✔ Dokončeno':'';return}
    el.textContent=localStorage.getItem(doneKey(id))?'✔ Dokončeno':'';
  });
}

function buildOverview(){
  const ul=document.getElementById('chordLessons');if(!ul)return;
  const basic=window.BAND_CHORD_ORDER.filter(id=>CHORDS[id].group==='basic');
  const power=window.BAND_CHORD_ORDER.filter(id=>CHORDS[id].group==='power');
  function row(id,n){
    const c=CHORDS[id];
    const open=id==='Em'?'bandOpenEm()':`bandOpenChordLesson('${id}')`;
    const bid=id==='Em'?' id="emOpen"':'';
    const badgeId=id==='Em'?'emBadge':('badge-'+id);
    return `<li><span class="num">${n}</span><span class="name">${c.name} – ${c.title} <span class="badge" id="${badgeId}"></span></span><button class="primary"${bid} onclick="${open}">Otevřít lekci</button></li>`;
  }
  let html='<li class="group-label" style="opacity:1;border-color:#8b0000"><span class="name" style="font-weight:bold;color:#e0202f">Základní akordy</span></li>';
  basic.forEach((id,i)=>html+=row(id,i+1));
  html+='<li class="group-label" style="opacity:1;border-color:#8b0000"><span class="name" style="font-weight:bold;color:#e0202f">Rockové power akordy</span></li>';
  power.forEach((id,i)=>html+=row(id,basic.length+i+1));
  ul.innerHTML=html;
  overviewBadges();
}

function wireLessonUi(){
  const $=id=>document.getElementById(id);
  if(!$('clPlay'))return;
  $('clPlay').onclick=()=>{
    if(!lessonChord)return;
    window.bandPlayChord(lessonChord.frets,{power:lessonChord.power,label:lessonChord.name,statusEl:'clAudioStatus'});
  };
  $('clPrev').onclick=()=>{lessonStep--;lessonRender()};
  $('clNext').onclick=()=>{lessonStep++;lessonRender()};
  $('clNext4').onclick=()=>{lessonStep=4;markDone()};
  $('clFinish').onclick=markDone;
  $('clBack').onclick=()=>{$('chordLesson').hidden=true;$('emOverview').scrollIntoView({behavior:'smooth'})};
  $('clAgain').onclick=()=>{lessonStep=0;lessonRender()};
  $('clRepeat').onclick=()=>{
    const r=$('clRaven');r.classList.remove('flash');void r.offsetWidth;r.classList.add('flash');
    if(lessonChord&&lessonChord.voiceId&&typeof window.ravenSay==='function')try{window.ravenSay(lessonChord.voiceId)}catch(e){}
    else if(typeof window.speak==='function')window.speak(r.textContent);
  };
}

function init(){
  buildOverview();
  wireLessonUi();
  overviewBadges();
  // Po lesson-em: sjednotit badge Em
  setTimeout(overviewBadges,0);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();

window.__bandChords={CHORDS,BASE,freqsFromFrets,doneKey,getCtx};
})();
