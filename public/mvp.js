'use strict';
const $ = s => document.querySelector(s);
const canvas = $('#stage'), ctx = canvas.getContext('2d');
const COLORS = ['#a9ed75', '#839bff', '#ffb86e', '#f48bd0', '#73d7de', '#d6a5ff'];
const CROWN_TARGET = 5, TAPS_TO_FINISH = 6, SPIN_EVERY = 2;
const GAME_SECONDS = { tap: 30, tilt: 35, color: 30, voice: 30, cars: 40 };
const TARGET_COLORS = [
  { name: 'rojo', hue: 0, css: '#ff5263' }, { name: 'amarillo', hue: 55, css: '#ffda4f' },
  { name: 'verde', hue: 120, css: '#63e890' }, { name: 'cian', hue: 180, css: '#50d9ee' },
  { name: 'azul', hue: 220, css: '#5c8eff' }, { name: 'magenta', hue: 300, css: '#e16dff' },
];
const NOTES = [
  { name: 'Do₄', hz: 261.63 }, { name: 'Re₄', hz: 293.66 }, { name: 'Mi₄', hz: 329.63 },
  { name: 'Fa₄', hz: 349.23 }, { name: 'Sol₄', hz: 392.00 }, { name: 'La₄', hz: 440.00 },
  { name: 'Si₄', hz: 493.88 }, { name: 'Do₅', hz: 523.25 },
];
let wheelRotation = 0;
const wheelCanvas = $('#wheelCanvas'), wheelCtx = wheelCanvas.getContext('2d');
const WHEEL_LABELS = ['Sabotaje','Escudo','Nada'], WHEEL_COLORS = ['#ff6b73','#73a9ff','#7e8797'];
function drawWheel(rotation) {
  const cx=90,cy=90,r=78,sector=Math.PI*2/3; wheelCtx.clearRect(0,0,180,180);
  for(let i=0;i<3;i++){
    const start=rotation+i*sector;
    wheelCtx.beginPath();wheelCtx.moveTo(cx,cy);wheelCtx.arc(cx,cy,r,start,start+sector);wheelCtx.closePath();
    wheelCtx.fillStyle=WHEEL_COLORS[i];wheelCtx.fill();wheelCtx.strokeStyle='#111318';wheelCtx.lineWidth=3;wheelCtx.stroke();
    wheelCtx.save();wheelCtx.translate(cx,cy);wheelCtx.rotate(start+sector/2);wheelCtx.fillStyle='#101319';wheelCtx.font='bold 12px system-ui';wheelCtx.textAlign='right';wheelCtx.fillText(WHEEL_LABELS[i],r-10,4);wheelCtx.restore();
  }
  wheelCtx.fillStyle='#f3f5f8';wheelCtx.beginPath();wheelCtx.moveTo(cx-9,4);wheelCtx.lineTo(cx+9,4);wheelCtx.lineTo(cx,20);wheelCtx.closePath();wheelCtx.fill();
  wheelCtx.fillStyle='#111318';wheelCtx.beginPath();wheelCtx.arc(cx,cy,11,0,Math.PI*2);wheelCtx.fill();
}
function animateWheel(index, playerName) {
  wheelCanvas.hidden=false;
  const sector=Math.PI*2/3, desired=-Math.PI/2-(index+.5)*sector;
  let end=desired+Math.ceil((wheelRotation+5*Math.PI*2-desired)/(Math.PI*2))*(Math.PI*2);
  if(end<wheelRotation+5*Math.PI*2)end+=Math.PI*2;
  const from=wheelRotation, start=performance.now(), duration=2200;
  function frame(now){const t=clamp((now-start)/duration,0,1), eased=1-Math.pow(1-t,4);wheelRotation=from+(end-from)*eased;drawWheel(wheelRotation);if(t<1)requestAnimationFrame(frame);else $('#wheelStatus').textContent=`${playerName} · ruleta: ${WHEEL_LABELS[index]}.`;}
  requestAnimationFrame(frame);
}let tacto, room = '', mode = 'tap', running = false, championId = null;
let scores = {}, shields = {}, spinTokens = {}, pendingSabotage = {}, spinTargets = {};
let progress = {}, contacts = {}, cars = {}, completedGames = 0;
let roundStart = 0, roundEnd = 0, targetColor = TARGET_COLORS[0], targetChanged = 0, targetNote = NOTES[0];
let lastFrame = performance.now(), lastHud = 0;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = v => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(2);
function size() {
  const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
  canvas.width = r.width * d; canvas.height = r.height * d; ctx.setTransform(d, 0, 0, d, 0, 0);
}
addEventListener('resize', size); size();
function devices() { return tacto ? Object.values(tacto.devices).filter(d => d.online) : []; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function command(id, payload) {
  if (tacto?.client?.connected) tacto.client.publish(`tacto/${room}/${id}/cmd`, JSON.stringify(payload), { qos: 1 });
}
function spinState(d) {
  const canSpin = !running && !championId && (spinTokens[d.id] || 0) > 0;
  const targets = spinTargets[d.id] || [];
  command(d.id, { spinAvailable: canSpin, spinTokens: spinTokens[d.id] || 0,
    sabotagePending: !!pendingSabotage[d.id], sabotageTargets: targets });
}
function updateAllSpinStates() { for (const d of devices()) spinState(d); }
function renderPlayers() {
  const all = Object.values(tacto?.devices || {}), online = all.filter(d => d.online);
  $('#players').innerHTML = all.length ? all.map(d => {
    const c = d.ch || {}, idx = online.indexOf(d), color = COLORS[(idx < 0 ? 0 : idx) % COLORS.length];
    const pts = scores[d.id] || 0, pct = Math.round(clamp(pts / CROWN_TARGET, 0, 1) * 100);
    const shield = shields[d.id] || 0, games = mode === 'tap' ? `${Math.round((progress[d.id] || 0) * TAPS_TO_FINISH)}/${TAPS_TO_FINISH} toques`
      : mode === 'tilt' ? `${fmt(progress[d.id] || 0)} s de equilibrio`
      : mode === 'color' ? `${fmt(progress[d.id] || 0)} s de color`
      : mode === 'voice' ? `${fmt(progress[d.id] || 0)} s de nota`
      : (cars[d.id]?.alive === false ? 'fuera de la pista' : 'en pista');
    return `<article class="player ${d.online ? '' : 'off'}"><h3><span style="color:${color}">● ${esc(d.name)}</span><span>${pts}/${CROWN_TARGET} 👑</span></h3><div class="crown-meter" aria-label="${pct}% del camino a la corona"><i style="width:${pct}%;background:${color}"></i></div><p class="tiny game-progress">${games}${shield ? ` · 🛡 ${shield}` : ''}</p><div class="values"><span>Tacto X <b>${fmt(c['touch.x'])}</b></span><span>Tacto Y <b>${fmt(c['touch.y'])}</b></span><span>Giro γ <b>${fmt(c['ang.g'])}°</b></span><span>Giro β <b>${fmt(c['ang.b'])}°</b></span><span>Voz <b>${c['mic.pitch'] ? Math.round(c['mic.pitch']) + ' Hz' : '—'}</b></span><span>Cámara <b>${c['cam.sat'] > 0.25 ? 'color' : '—'}</b></span></div></article>`;
  }).join('') : '<p class="tiny">Esperando teléfonos…</p>';
  $('#scoreboard').innerHTML = online.length ? online.map((d, i) => `<div style="padding:4px;color:${COLORS[i % COLORS.length]}">${esc(d.name)} · ${scores[d.id] || 0}/${CROWN_TARGET} para la corona${shields[d.id] ? ` · 🛡 ${shields[d.id]}` : ''}</div>`).join('') : 'Sin jugadores conectados';
  $('#crownStatus').textContent = championId ? `👑 ${tacto.devices[championId]?.name || 'Campeón'}` : `👑 Corona: ${CROWN_TARGET} puntos`;
  $('#start').disabled = running || !!championId || (mode === 'cars' && online.length < 2);
  $('#mode').disabled = running;
  draw();
}
function instructions() {
  const text = {
    tap: `Cada contacto suma avance. Llega a ${TAPS_TO_FINISH} para ganar la ronda.`,
    tilt: 'Mantén el teléfono cerca del ángulo objetivo mientras cambia el viento. Gana quien sostenga la torre.',
    color: 'Activa la cámara en el teléfono y busca el color que aparece en la pantalla. El video se analiza en el móvil.',
    voice: 'Activa el micrófono y canta la nota indicada. Solo viaja el tono detectado, no el audio.',
    cars: 'Inclina el teléfono para conducir. Empuja a otros fuera de la pista; se necesitan dos jugadores.',
  };
  $('#instructions').textContent = text[mode];
  $('#modeName').textContent = ({tap:'Carrera de toques',tilt:'Torre en equilibrio',color:'Caza de colores',voice:'Acierta la nota',cars:'Carritos chocones'})[mode];
}
function start() {
  if (running || championId) return;
  const online = devices();
  if (!online.length) { $('#round').textContent = 'Conecta al menos un teléfono.'; return; }
  if (mode === 'cars' && online.length < 2) { $('#round').textContent = 'Carritos chocones necesita al menos dos jugadores.'; return; }
  running = true; roundStart = performance.now(); roundEnd = roundStart + GAME_SECONDS[mode] * 1000;
  progress = {}; for (const d of online) progress[d.id] = 0;
  if (mode === 'tap') { /* keep the current contact set so a held finger cannot create a free tap */ }
  if (mode === 'color') { targetColor = TARGET_COLORS[Math.floor(Math.random() * TARGET_COLORS.length)]; targetChanged = roundStart; }
  if (mode === 'voice') targetNote = NOTES[Math.floor(Math.random() * NOTES.length)];
  if (mode === 'cars') setupCars(online);
  $('#round').textContent = 'Ronda en curso';
  updateAllSpinStates(); renderPlayers();
}
function resetScores() {
  scores = {}; shields = {}; spinTokens = {}; pendingSabotage = {}; spinTargets = {};
  progress = {}; cars = {}; completedGames = 0; championId = null; running = false;
  $('#wheelStatus').textContent = `Cada jugador gana un giro cada ${SPIN_EVERY} juegos.`;
  $('#round').textContent = 'Campeonato reiniciado'; updateAllSpinStates(); renderPlayers();
}
$('#start').onclick = start; $('#reset').onclick = resetScores;
$('#mode').onchange = e => { mode = e.target.value; progress = {}; instructions(); renderPlayers(); };
$('#newRoom').onclick = () => {
  room = tacto.cambiarSala(Tacto.nuevaSala()); scores = {}; shields = {}; spinTokens = {};
  pendingSabotage = {}; spinTargets = {}; completedGames = 0; championId = null; progress = {}; contacts = {}; cars = {};
  showRoom(); $('#round').textContent = 'Sala nueva · listos para jugar'; renderPlayers();
};
function showRoom() {
  $('#room').textContent = `Sala ${room}`;
  const url = new URL('phone.html', new URL('.', location.href)); url.searchParams.set('sala', room);
  $('#phoneUrl').textContent = url.href;
}
function recordTap(d, m) {
  const active = new Set((Array.isArray(m?.p) ? m.p : []).map(p => String(p.i)));
  const previous = contacts[d.id] || new Set();
  let count = 0; for (const i of active) if (!previous.has(i)) count++;
  contacts[d.id] = active;
  if (running && mode === 'tap' && count) {
    progress[d.id] = Math.min(TAPS_TO_FINISH, (progress[d.id] || 0) + count);
    if (progress[d.id] >= TAPS_TO_FINISH) finishGame(d.id, 'meta');
  }
}
function onData(d, kind, m) {
  if (kind === 'touch') recordTap(d, m);
  else if (kind === 'cam' || kind === 'mic' || kind === 'motion') { /* flattened channels stay in d.ch */ }
  else if (kind === 'action' && m?.action === 'spin') spin(d.id);
  else if (kind === 'action' && m?.action === 'target') applySabotage(d.id, String(m.targetId || ''));
  renderPlayers();
}
function pickWinner(metric) {
  const ds = devices(); if (!ds.length) return null;
  const ranked = ds.map(d => ({ id:d.id, value:metric(d) })).sort((a,b)=>b.value-a.value);
  if (!ranked.length || ranked[0].value <= 0) return null;
  return ranked.length > 1 && Math.abs(ranked[0].value-ranked[1].value) < 0.02 ? null : ranked[0].id;
}
function finishGame(winnerId, reason) {
  if (!running) return;
  running = false; completedGames++;
  const winner = winnerId ? tacto.devices[winnerId] : null;
  if (winner) scores[winnerId] = (scores[winnerId] || 0) + 1;
  const reachedCrown = winner && scores[winnerId] >= CROWN_TARGET;
  if (reachedCrown) championId = winnerId;
  if (!championId && completedGames % SPIN_EVERY === 0) {
    for (const d of devices()) spinTokens[d.id] = (spinTokens[d.id] || 0) + 1;
    $('#wheelStatus').textContent = '¡Ruleta disponible! Cada jugador puede girarla desde su teléfono.';
  } else if (!championId) {
    $('#wheelStatus').textContent = `Próxima ruleta en ${SPIN_EVERY - (completedGames % SPIN_EVERY)} juego${SPIN_EVERY - (completedGames % SPIN_EVERY) === 1 ? '' : 's'}.`;
  }
  if (championId) $('#round').textContent = `👑 ${winner.name} conquistó la corona con ${scores[winnerId]} puntos`;
  else if (winner) $('#round').textContent = `${winner.name} gana · ${scores[winnerId]}/${CROWN_TARGET} hacia la corona`;
  else $('#round').textContent = `Empate · ${completedGames} juegos completados`;
  for (const d of devices()) spinState(d);
  renderPlayers();
}
function spin(id) {
  if (running || championId || !(spinTokens[id] > 0) || pendingSabotage[id]) return;
  spinTokens[id]--;
  const actor = tacto.devices[id], others = devices().filter(d => d.id !== id);
  let roll = Math.floor(Math.random() * 3); if (roll === 0 && !others.length) roll = 2; animateWheel(roll, actor?.name || 'Jugador');
  if (roll === 0 && others.length) {
    const targets = others.map(d => ({id:d.id,name:d.name}));
    pendingSabotage[id] = true; spinTargets[id] = targets;
    command(id, { spinAvailable:false, spinTokens:spinTokens[id], sabotagePending:true, sabotageTargets:targets,
      spinResult:'¡Sabotaje! Elige a quién atacar.' });
    $('#wheelStatus').textContent = `${actor?.name || 'Jugador'} obtuvo un sabotaje y elige objetivo en su teléfono.`;
  } else if (roll === 1) {
    shields[id] = (shields[id] || 0) + 1;
    command(id, { spinAvailable:spinTokens[id] > 0, spinTokens:spinTokens[id], sabotagePending:false, spinResult:'¡Escudo! Bloqueará el próximo sabotaje.' });
    $('#wheelStatus').textContent = `${actor?.name || 'Jugador'} obtuvo un escudo.`;
  } else {
    command(id, { spinAvailable:spinTokens[id] > 0, spinTokens:spinTokens[id], sabotagePending:false, spinResult:'La ruleta cayó en Nada.' });
    $('#wheelStatus').textContent = `${actor?.name || 'Jugador'} giró y no obtuvo efecto.`;
  }
  for (const d of others) spinState(d);
  renderPlayers();
}
function applySabotage(attackerId, targetId) {
  if (!pendingSabotage[attackerId] || !spinTargets[attackerId]?.some(t => t.id === targetId)) return;
  pendingSabotage[attackerId] = false; spinTargets[attackerId] = [];
  const attacker = tacto.devices[attackerId], target = tacto.devices[targetId];
  if (shields[targetId] > 0) {
    shields[targetId]--;
    command(targetId, { spinResult:`El sabotaje de ${attacker?.name || 'otro jugador'} chocó con tu escudo.` });
    command(attackerId, { spinResult:`${target?.name || 'El objetivo'} se protegió con un escudo.`, spinAvailable:spinTokens[attackerId] > 0, spinTokens:spinTokens[attackerId] });
    $('#wheelStatus').textContent = `🛡 ${target?.name || 'El objetivo'} bloqueó el sabotaje.`;
  } else {
    scores[targetId] = Math.max(0, (scores[targetId] || 0) - 1);
    command(targetId, { spinResult:`${attacker?.name || 'Otro jugador'} te saboteó: pierdes 1 punto.` });
    command(attackerId, { spinResult:`Sabotaje aplicado a ${target?.name || 'tu objetivo'}.`, spinAvailable:spinTokens[attackerId] > 0, spinTokens:spinTokens[attackerId] });
    $('#wheelStatus').textContent = `💥 ${attacker?.name || 'Un jugador'} quitó 1 punto a ${target?.name || 'otro jugador'}.`;
  }
  renderPlayers();
}
function updateRoomFromURL() {
  const q = new URLSearchParams(location.search).get('sala');
  if (q && q.length >= 4) tacto.cambiarSala(q);
  room = tacto.sala; showRoom();
}
function hueDistance(a,b) { return Math.abs(((a-b+540)%360)-180); }
function setupCars(ds) {
  cars = {};
  ds.forEach((d,i) => {
    const angle = 2*Math.PI*i/ds.length - Math.PI/2;
    cars[d.id] = { x:.5+Math.cos(angle)*.25, y:.5+Math.sin(angle)*.25, vx:0, vy:0, alive:true, cooldown:0 };
  });
}
function updateCars(dt) {
  const ds = devices();
  for (const d of ds) {
    const car = cars[d.id]; if (!car?.alive) continue;
    const gx = clamp((d.ch['ang.g'] || 0)/35,-1,1), gy = clamp((d.ch['ang.b'] || 0)/35,-1,1);
    car.vx = (car.vx + gx*dt*.9) * Math.exp(-1.15*dt);
    car.vy = (car.vy + gy*dt*.9) * Math.exp(-1.15*dt);
    car.x += car.vx*dt*.65; car.y += car.vy*dt*.65; car.cooldown = Math.max(0,car.cooldown-dt);
    if (car.x < .035 || car.x > .965 || car.y < .06 || car.y > .94) car.alive = false;
  }
  for (let i=0;i<ds.length;i++) for (let j=i+1;j<ds.length;j++) {
    const a=cars[ds[i].id], b=cars[ds[j].id]; if (!a?.alive || !b?.alive || a.cooldown || b.cooldown) continue;
    const dx=b.x-a.x, dy=b.y-a.y, dist=Math.hypot(dx,dy);
    if (dist < .075) {
      const nx=dx/(dist||1), ny=dy/(dist||1);
      a.vx-=nx*.6; a.vy-=ny*.6; b.vx+=nx*.6; b.vy+=ny*.6;
      a.x-=nx*.012; a.y-=ny*.012; b.x+=nx*.012; b.y+=ny*.012;
      a.cooldown=b.cooldown=.75;
    }
  }
  const alive=ds.filter(d=>cars[d.id]?.alive);
  if (ds.length>=2 && alive.length===1) finishGame(alive[0].id,'último en pista');
  else if (ds.length>=2 && alive.length===0) finishGame(null,'todos fuera');
}
function drawCars(ds,w,h) {
  const pad=Math.min(w,h)*.08; ctx.strokeStyle='#d8e0ef'; ctx.lineWidth=4; ctx.strokeRect(pad,pad,w-2*pad,h-2*pad);
  ctx.strokeStyle='#536171'; ctx.lineWidth=1; ctx.strokeRect(pad+12,pad+12,w-2*pad-24,h-2*pad-24);
  ds.forEach((d,i)=>{const c=cars[d.id];if(!c)return;const x=c.x*w,y=c.y*h;ctx.fillStyle=c.alive?COLORS[i%COLORS.length]:'#626976';ctx.beginPath();ctx.arc(x,y,Math.max(11,Math.min(w,h)*.025),0,Math.PI*2);ctx.fill();ctx.fillStyle='#f3f5f8';ctx.font='13px system-ui';ctx.textAlign='center';ctx.fillText(c.alive?d.name:`${d.name} · fuera`,x,y-18)});
}
function draw() {
  const w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);ctx.fillStyle='#101319';ctx.fillRect(0,0,w,h);
  const ds=devices();
  if(!ds.length){ctx.fillStyle='#a9afbb';ctx.textAlign='center';ctx.font='16px system-ui';ctx.fillText('Conecta un teléfono para comenzar',w/2,h/2);return;}
  if(mode==='cars'){drawCars(ds,w,h);return;}
  if(mode==='color'){ctx.fillStyle=targetColor.css;ctx.fillRect(w/2-44,14,88,36);ctx.fillStyle='#f3f5f8';ctx.textAlign='center';ctx.font='14px system-ui';ctx.fillText(`Busca ${targetColor.name}`,w/2,68);}
  if(mode==='voice'){
    ctx.fillStyle='#f3f5f8';ctx.textAlign='center';ctx.font='18px system-ui';ctx.fillText(`Canta ${targetNote.name} · ${targetNote.hz.toFixed(0)} Hz`,w/2,30);
    const x0=30,x1=w-30,guideY=60,targetX=x0+clamp((targetNote.hz-200)/400,0,1)*(x1-x0);
    ctx.strokeStyle='#657086';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x0,guideY);ctx.lineTo(x1,guideY);ctx.stroke();
    ctx.strokeStyle='#a9ed75';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(targetX,guideY-9);ctx.lineTo(targetX,guideY+9);ctx.stroke();
    ctx.fillStyle='#a9afbb';ctx.font='10px system-ui';ctx.textAlign='left';ctx.fillText('200 Hz',x0,guideY+19);ctx.textAlign='right';ctx.fillText('600 Hz',x1,guideY+19);
    ds.forEach((d,i)=>{const pitch=d.ch['mic.pitch'];if(pitch>0){const px=x0+clamp((pitch-200)/400,0,1)*(x1-x0);ctx.fillStyle=COLORS[i%COLORS.length];ctx.beginPath();ctx.arc(px,guideY,6,0,Math.PI*2);ctx.fill();}});
  }
  if(mode==='tilt'){
    const elapsed=(performance.now()-roundStart)/1000, wind=Math.sin(elapsed*.8)*Math.min(32,elapsed*.8), target=-wind;
    ctx.fillStyle='#f3f5f8';ctx.textAlign='center';ctx.font='14px system-ui';ctx.fillText(`Viento ${wind>=0?'→':'←'} · inclina al lado contrario (${target.toFixed(0)}°)`,w/2,34);
  }
  const row=Math.min(68,(h-90)/ds.length),top=mode==='tap'?34:76;
  ds.forEach((d,i)=>{
    const y=top+i*row+row/2,col=COLORS[i%COLORS.length];ctx.fillStyle='#242934';ctx.fillRect(24,y-11,w-48,22);ctx.strokeStyle='#515a69';ctx.strokeRect(24,y-11,w-48,22);
    let fraction=0,x=24;
    if(mode==='tap'){fraction=(progress[d.id]||0)/TAPS_TO_FINISH;ctx.fillStyle=col;ctx.fillRect(24,y-11,(w-48)*fraction,22);x=24+(w-48)*fraction;}
    else if(mode==='tilt'){fraction=clamp((progress[d.id]||0)/12,0,1);x=24+(w-48)*clamp(.5+(d.ch['ang.g']||0)/100,0,1);ctx.fillStyle='#26362a';ctx.fillRect(24+(w-48)*.5,y-11,Math.max(3,(w-48)*fraction),22);}
    else if(mode==='color'||mode==='voice'){fraction=clamp((progress[d.id]||0)/(mode==='color'?4:3),0,1);ctx.fillStyle=col;ctx.fillRect(24,y-11,(w-48)*fraction,22);x=24+(w-48)*fraction;}
    ctx.fillStyle=col;ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f3f5f8';ctx.textAlign='left';ctx.font='13px system-ui';ctx.fillText(d.name,28,y-17);
  });
}
function finishByTime() {
  if(mode==='tap') finishGame(pickWinner(d=>progress[d.id]||0),'tiempo');
  else if(mode==='tilt') finishGame(pickWinner(d=>progress[d.id]||0),'tiempo');
  else if(mode==='color') finishGame(pickWinner(d=>progress[d.id]||0),'tiempo');
  else if(mode==='voice') finishGame(pickWinner(d=>progress[d.id]||0),'tiempo');
  else finishGame(pickWinner(d=>cars[d.id]?.alive?1:0),'tiempo');
}
function tick(now) {
  const dt=Math.min(.05,(now-lastFrame)/1000);lastFrame=now;
  if(running&&now>=roundEnd){finishByTime();}
  if(running&&mode==='tilt'){
    const elapsed=(now-roundStart)/1000,wind=Math.sin(elapsed*.8)*Math.min(32,elapsed*.8),target=-wind,tolerance=Math.max(4,12-elapsed*.18);
    for(const d of devices()){
      const angle=d.ch['ang.g'];if(angle!=null&&Math.abs(angle-target)<tolerance)progress[d.id]=(progress[d.id]||0)+dt;
      if((progress[d.id]||0)>=12){finishGame(d.id,'equilibrio');break;}
    }
  }
  if(running&&mode==='color'){
    if(now-targetChanged>6500){let i;do{i=Math.floor(Math.random()*TARGET_COLORS.length)}while(TARGET_COLORS[i]===targetColor);targetColor=TARGET_COLORS[i];targetChanged=now;}
    for(const d of devices()){
      const age=performance.now()-(d.last||0),hue=d.ch['cam.hue'],sat=d.ch['cam.sat'];
      if(age<450&&hue!=null&&sat>.3&&hueDistance(hue,targetColor.hue)<22)progress[d.id]=(progress[d.id]||0)+dt;
      if((progress[d.id]||0)>=4){finishGame(d.id,'color');break;}
    }
  }
  if(running&&mode==='voice'){
    for(const d of devices()){
      const age=performance.now()-(d.last||0),pitch=d.ch['mic.pitch'],level=d.ch['mic.level'];
      const cents=pitch>0?Math.abs(12*Math.log2(pitch/targetNote.hz)):Infinity;
      if(age<400&&level>.035&&cents<.55)progress[d.id]=(progress[d.id]||0)+dt;
      if((progress[d.id]||0)>=3){finishGame(d.id,'nota');break;}
    }
  }
  if(running&&mode==='cars')updateCars(dt);
  draw();if(now-lastHud>300){lastHud=now;renderPlayers();}requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
$('#mode').value=mode;instructions();
(async()=>{
  tacto=new Tacto();updateRoomFromURL();
  tacto.on('estado',s=>{$('#connection').textContent=s;$('#connection').className='pill '+(s==='conectado'?'on':'');});
  tacto.on('datos',onData);tacto.on('dispositivo',()=>{renderPlayers();updateAllSpinStates();});
  tacto.on('rtt',d=>{const a=d.rtt.slice().sort((x,y)=>x-y);$('#latency').textContent=a.length?`Latencia ${Math.round(a[Math.floor(a.length/2)])} ms`:'';});
  tacto.on('error',e=>$('#notice').textContent=e.message||'Error de conexión');
  try{await tacto.connect();$('#notice').textContent='Conectado al broker MQTT de Tacto.';updateAllSpinStates();}
  catch(e){$('#notice').textContent='No se pudo conectar al broker: '+(e.message||e);}
  $('#wheelStatus').textContent=`Cada jugador recibe un giro cada ${SPIN_EVERY} juegos.`;renderPlayers();
})();
