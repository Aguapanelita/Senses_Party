'use strict';
const $ = s => document.querySelector(s);
const canvas = $('#stage'), ctx = canvas.getContext('2d');
const COLORS = ['#C6FF36', '#FF4D8D', '#37D9F2', '#FF9F43', '#9A72FF', '#F9E547'];
const CROWN_TARGET = 5, TAPS_TO_FINISH = 8, SPIN_EVERY = 2;
const GAME_SECONDS = { tap: 45, tilt: 60, color: 30 };
const VOICE_CUE_SECONDS = 1.15, VOICE_ATTEMPT_SECONDS = 5, VOICE_PERMISSION_TIMEOUT = 20000, VOICE_TURN_GAP = 700;
const VOICE_REGISTERS = [{ name:'grave', min:82, max:165 }, { name:'medio', min:210, max:370 }, { name:'agudo', min:510, max:850 }];
const VOICE_WAVES = ['sine','triangle','square','sawtooth'];
const VOICE_MODIFIERS = ['vibrato','tremolo','glide','harmonic','detune','none'];
const TARGET_COLORS = [
  { name: 'rojo', hue: 0, tolerance: 28 }, { name: 'naranja', hue: 28, tolerance: 22 },
  { name: 'amarillo', hue: 54, tolerance: 24 }, { name: 'verde claro', hue: 95, tolerance: 32 },
  { name: 'verde', hue: 132, tolerance: 44 }, { name: 'turquesa', hue: 174, tolerance: 24 },
  { name: 'cian', hue: 195, tolerance: 22 }, { name: 'azul', hue: 222, tolerance: 28 },
  { name: 'violeta', hue: 270, tolerance: 26 }, { name: 'magenta', hue: 315, tolerance: 28 },
];
let boxOpenTimer = 0;
const BOX_LABELS = ['Sabotaje','Escudo','Nada'];
function animateBox(selectedIndex, resultIndex, playerName) {
  const boxes=[...document.querySelectorAll('.mystery-box')];
  boxes.forEach((box,i)=>{box.classList.toggle('open',i===selectedIndex);box.querySelector('span').textContent=i===selectedIndex?['💥','🛡','…'][resultIndex]:'?';});
  clearTimeout(boxOpenTimer);
  boxOpenTimer=setTimeout(()=>{boxes.forEach(box=>{box.classList.remove('open');box.querySelector('span').textContent='?';});},2600);
  $('#wheelStatus').textContent=`${playerName} abrió una caja: ${BOX_LABELS[resultIndex]}.`;
}
let sequenceActive=false, sequencePaused=false, sequencePhase='idle', sequenceUntil=0, sequenceBag=[], sequenceLastMode='', sequenceResult='';
const SEQUENCE_GAMES=['tap','tilt','color','voice'];
const GAME_LABELS={tap:'Carrera de toques',tilt:'Torre en equilibrio',color:'Caza de colores',voice:'Acierta la nota'};
function eligibleSequenceGames(){
  const online=devices();
  const hasMotion=online.some(d=>d.caps?.motion===true || Number.isFinite(Number(d.ch?.['ang.g'])));
  const hasCamera=online.some(d=>d.caps?.cam===true);
  return SEQUENCE_GAMES.filter(g=>g!=='tilt'||hasMotion).filter(g=>g!=='color'||hasCamera);
}
function nextSequenceMode(){
  const available=eligibleSequenceGames();
  if(!available.length)return null;
  sequenceBag=sequenceBag.filter(game=>available.includes(game));
  if(!sequenceBag.length){sequenceBag=shuffleCopy(available);if(sequenceBag.length>1&&sequenceBag[sequenceBag.length-1]===sequenceLastMode){[sequenceBag[0],sequenceBag[sequenceBag.length-1]]=[sequenceBag[sequenceBag.length-1],sequenceBag[0]];}}
  const next=sequenceBag.pop();sequenceLastMode=next;return next;
}
function sequenceRows(){return devices().slice().sort((a,b)=>(scores[b.id]||0)-(scores[a.id]||0)).map(d=>`<div class="sequence-score" style="--player-color:${playerColor(d.id)}"><span>${esc(d.name)}</span><b>${scores[d.id]||0}/${CROWN_TARGET} 👑</b></div>`).join('')||'<p class="tiny">Esperando jugadores…</p>';}
function showSequence(title,message,kicker='CAMPEONATO',showScores=true){
  $('#sequenceContinue').hidden=true;
  $('#sequenceKicker').textContent=kicker;$('#sequenceTitle').textContent=title;$('#sequenceMessage').textContent=message;$('#sequenceScores').innerHTML=showScores?sequenceRows():'';$('#sequenceOverlay').hidden=false;
}
function hideSequence(){ $('#sequenceOverlay').hidden=true; }
function prepareSequenceGame(){
  const next=nextSequenceMode();
  if(!next){sequenceActive=false;sequencePhase='idle';setRound('Activa giro y cámara en algún teléfono para incluir esos retos en la secuencia.');return;}
  mode=next;$('#mode').value=mode;instructions();renderPlayers();
  sequencePhase='instructions';sequenceUntil=performance.now()+3600;
  showSequence('Siguiente reto',`${GAME_LABELS[mode]} · ${instructionsText(mode)} · comienza en unos segundos.`,'PRÓXIMO MINIJUEGO',false);
  setRound(`Siguiente: ${GAME_LABELS[mode]}`);
}
function instructionsText(game){return ({tap:'prepárate para tocar',tilt:'activa giro y mantén un dedo en la pantalla',color:'activa la cámara y encuentra cinco colores',voice:'escucha y canta tres notas'})[game]||'';}
function startSequence(){
  if(championId)return;
  if(!devices().length){setRound('Conecta al menos un teléfono para comenzar el campeonato.');return;}
  prepareVoiceAudio();
  sequenceActive=true;sequencePaused=false;sequenceBag=[];sequenceLastMode='';
  $('#sequenceStart').disabled=true;$('#sequencePause').disabled=false;$('#sequencePause').textContent='Pausar';$('#sequenceStop').disabled=false;
  prepareSequenceGame();
}
function stopSequence(message='Campeonato detenido por el anfitrión.'){
  sequenceActive=false;sequencePaused=false;sequencePhase='idle';sequenceUntil=0;
  if(running&&mode==='color')for(const d of devices())command(d.id,{colorTarget:null});
  if(running&&mode==='voice')cancelVoiceTurn(message);
  running=false;voiceWaiting=false;voiceListening=false;voiceNextAt=0;
  $('#sequenceStart').disabled=!!championId;$('#sequencePause').disabled=true;$('#sequenceStop').disabled=true;
  hideSequence();setRound(message);updateAllSpinStates();renderPlayers();
}
function toggleSequencePause(){
  if(!sequenceActive)return;
  sequencePaused=!sequencePaused;$('#sequencePause').textContent=sequencePaused?'Reanudar':'Pausar';
  if(sequencePaused){sequencePausedAt=performance.now();setRound('Campeonato pausado · pulsa Reanudar para seguir.');}
  else{const delta=performance.now()-sequencePausedAt;if(sequencePhase!=='playing')sequenceUntil+=delta;else{roundStart+=delta;if(roundEnd)roundEnd+=delta;if(targetChanged)targetChanged+=delta;if(voiceReadyDeadline)voiceReadyDeadline+=delta;if(voiceTurnEnd)voiceTurnEnd+=delta;if(voiceSampleEnd)voiceSampleEnd+=delta;if(voiceNextAt)voiceNextAt+=delta;}setRound('Campeonato reanudado');}
}
let sequencePausedAt=0;
let tacto, room = '', mode = 'tap', running = false, championId = null;
let scores = {}, shields = {}, spinTokens = {}, pendingSabotage = {}, spinTargets = {};
let playerColors = {}, nextPlayerColor = 0;
let progress = {}, contacts = {}, tapEvents = new Set(), completedGames = 0;
let roundStart = 0, roundEnd = 0, targetColor = TARGET_COLORS[0], targetChanged = 0;
let colorSequence = [], colorIndex = -1;
let balanceNeutral = {}, balanceX = {};
let voiceSounds = [], voiceOrder = [], voiceResults = {}, voiceSamples = [], voiceSoundIndex = 0, voicePlayerIndex = 0, voiceCurrentId = null;
let voiceWaiting = false, voiceListening = false, voiceReadyDeadline = 0, voiceSingStart = 0, voiceTurnEnd = 0, voiceNextAt = 0, voiceAudioContext = null, voiceStage = 'idle', voiceSampleEnd = 0, voiceCommandRetryAt = 0, voiceCountdownUntil = 0;
let lastFrame = performance.now(), lastHud = 0;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = v => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(2);
function setRound(text) { const node=$('#roundText'); if(node)node.textContent=text; }
function size() {
  const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
  canvas.width = r.width * d; canvas.height = r.height * d; ctx.setTransform(d, 0, 0, d, 0, 0);
}
addEventListener('resize', size); size();
function devices() { return tacto ? Object.values(tacto.devices).filter(d => d.online) : []; }
function playerColor(id) { if (!playerColors[id]) { playerColors[id] = COLORS[nextPlayerColor % COLORS.length]; nextPlayerColor++; } return playerColors[id]; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function command(id, payload) {
  if (tacto?.client?.connected) tacto.client.publish(`tacto/${room}/${id}/cmd`, JSON.stringify(payload), { qos: 1 });
}
function spinState(d) {
  const canSpin = !running && !championId && (spinTokens[d.id] || 0) > 0;
  const targets = spinTargets[d.id] || [];
  command(d.id, { hostReady: true, spinAvailable: canSpin, spinTokens: spinTokens[d.id] || 0,
    sabotagePending: !!pendingSabotage[d.id], sabotageTargets: targets });
}
function updateAllSpinStates() { for (const d of devices()) spinState(d); }
function renderPlayers() {
  const all = Object.values(tacto?.devices || {}), online = all.filter(d => d.online);
  $('#players').innerHTML = all.length ? all.map(d => {
    const c = d.ch || {}, color = playerColor(d.id);
    const pts = scores[d.id] || 0, pct = Math.round(clamp(pts / CROWN_TARGET, 0, 1) * 100);
    const shield = shields[d.id] || 0, games = mode === 'tap' ? `${Math.min(TAPS_TO_FINISH, Math.round(progress[d.id] || 0))}/${TAPS_TO_FINISH} toques`
      : mode === 'tilt' ? `${fmt(progress[d.id] || 0)} s dentro de la barra`
      : mode === 'color' ? `${progress[d.id] || 0}/5 colores encontrados`
      : mode === 'voice' ? `${progress[d.id] || 0}/3 turnos · ${voiceAccuracy(d.id)}` : '';
    return `<article class="player ${d.online ? '' : 'off'}"><h3><span style="color:${color}">● ${esc(d.name)}</span><span>${pts}/${CROWN_TARGET} 👑</span></h3><div class="crown-meter" aria-label="${pct}% del camino a la corona"><i style="width:${pct}%;background:${color}"></i></div><p class="tiny game-progress">${games}${shield ? ` · 🛡 ${shield}` : ''}</p><div class="values"><span>Tacto X <b>${fmt(c['touch.x'])}</b></span><span>Tacto Y <b>${fmt(c['touch.y'])}</b></span><span>Giro γ <b>${fmt(c['ang.g'])}°</b></span><span>Giro β <b>${fmt(c['ang.b'])}°</b></span><span>Voz <b>${c['mic.pitch'] ? Math.round(c['mic.pitch']) + ' Hz' : '—'}</b></span><span>Cámara <b>${c['cam.sat'] > 0.25 ? 'color' : '—'}</b></span></div></article>`;
  }).join('') : '<p class="tiny">Esperando teléfonos…</p>';
  const ranked = online.slice().sort((a,b)=>(scores[b.id]||0)-(scores[a.id]||0));
  const topScore = ranked.length ? scores[ranked[0].id]||0 : 0;
  const leaders = topScore ? ranked.filter(d=>(scores[d.id]||0)===topScore) : [];
  const leaderId = leaders.length===1 ? leaders[0].id : null;
  $('#projectedScoreboard').innerHTML = online.length ? online.slice(0,4).map(d => `<div class="score-slot" style="--player-color:${playerColor(d.id)}"><i class="score-color"></i><span class="score-slot-copy"><span class="score-slot-name">${esc(d.name)}</span><span class="score-slot-value">${scores[d.id]||0} / ${CROWN_TARGET}</span></span>${leaderId===d.id?'<span class="score-slot-lead">LÍDER</span>':''}</div>`).join('') + (online.length>4?`<span class="score-empty">+${online.length-4} jugadores conectados</span>`:'') : '<div class="score-empty">Esperando jugadores</div>';
  $('#scoreboard').innerHTML = online.length ? online.map(d => `<div style="padding:4px;color:${playerColor(d.id)}">${esc(d.name)} · ${scores[d.id] || 0}/${CROWN_TARGET} para la corona${leaderId===d.id?' · LÍDER':''}${shields[d.id] ? ` · 🛡 ${shields[d.id]}` : ''}</div>`).join('') : 'Sin jugadores conectados';
  $('#crownStatus').textContent = championId ? `👑 ${tacto.devices[championId]?.name || 'Campeón'}` : `CORONA · ${CROWN_TARGET} PUNTOS`;
  $('#arenaTitle').innerHTML = running ? `<span class="title-accent">${esc(({tap:'CARRERA DE TOQUES',tilt:'TORRE EN EQUILIBRIO',color:'CAZA DE COLORES',voice:'ACIERTA LA NOTA'})[mode])}</span>` : `SALA <span class="title-accent">LISTA</span>`;
  $('#roomDuplicate').textContent=room.toUpperCase();
  $('#start').disabled = running || !!championId || sequenceActive;
  $('#mode').disabled = running || sequenceActive;
  draw();
}
function instructions() {
  const text = {
    tap: `Cada toque hace avanzar tu barra. Llega a ${TAPS_TO_FINISH} toques; la ronda tiene un máximo de 45 segundos.`,
    tilt: 'Durante 60 segundos, inclina el teléfono para mantener tu marcador dentro de la franja verde móvil. Suma tiempo cada instante que permanezcas dentro; gana quien acumule más.',
    color: 'La partida pide 5 colores, uno a la vez. Cada color dura hasta 5 segundos; el primero en encontrarlo suma. En el teléfono verás la cámara y solo el nombre del color.',
    voice: 'Cada jugador escucha una nota con el micrófono apagado. Cuando termina, activa el micrófono y tiene 5 segundos para imitarla. Un intento por nota; gana el promedio más acertado de las tres.',
  };
  $('#instructions').textContent = text[mode];
  $('#modeName').textContent = ({tap:'Carrera de toques',tilt:'Torre en equilibrio',color:'Caza de colores',voice:'Acierta la nota'})[mode];
  return text[mode];
}
function start() {
  if (running || championId) return;
  const online = devices();
  if (!online.length) { setRound('Conecta al menos un teléfono.'); return; }
  sequencePhase=sequenceActive?'playing':'idle';hideSequence();running = true; roundStart = performance.now(); roundEnd = mode === 'voice' ? 0 : roundStart + GAME_SECONDS[mode] * 1000;
  progress = {}; for (const d of online) progress[d.id] = 0;
  if (mode === 'tap') { /* keep the current contact set so a held finger cannot create a free tap */ }
  if (mode === 'color') { colorSequence = [...TARGET_COLORS].sort(() => Math.random() - .5).slice(0, 5); colorIndex = -1; advanceColorChallenge(); }
  if (mode === 'tilt') { balanceNeutral = {}; balanceX = {}; for (const d of online) { balanceNeutral[d.id] = d.ch['ang.g'] ?? 0; balanceX[d.id] = .5; } }
  if (mode === 'voice') {
    voiceSounds=makeVoiceSounds();voiceOrder=online.map(d=>d.id);voiceResults={};for(const d of online)voiceResults[d.id]=[null,null,null];
    voiceSamples=[];voiceSoundIndex=0;voicePlayerIndex=0;voiceCurrentId=null;voiceWaiting=false;voiceListening=false;voiceNextAt=0;voiceStage='idle';voiceSampleEnd=0;voiceCountdownUntil=0;prepareVoiceAudio();
  }
  setRound(mode === 'tilt' ? 'Equilibrio: 60 s · usa solo el giroscopio para permanecer dentro de la franja verde' : mode === 'voice' ? 'Preparando sonidos nuevos para la partida…' : mode === 'color' ? `Color 1/5: ${targetColor.name} · encuéntralo en 5 segundos` : 'Ronda en curso');
  updateAllSpinStates(); renderPlayers();
  if(mode==='voice'){
    if(sequenceActive)beginVoiceTurn();
    else{voiceStage='countdown';voiceCountdownUntil=performance.now()+3000;setRound('Acierta la nota comienza al terminar la cuenta regresiva.');}
  }
}
function resetScores() {
  if(running&&mode==='color')for(const d of devices())command(d.id,{colorTarget:null});
  if(running&&mode==='voice')cancelVoiceTurn('La partida fue reiniciada.');
  scores = {}; shields = {}; spinTokens = {}; pendingSabotage = {}; spinTargets = {};
  progress = {}; completedGames = 0; championId = null; running = false; voiceWaiting=false;voiceListening=false;voiceNextAt=0;
  stopSequence('Campeonato reiniciado');$('#wheelStatus').textContent = `Cada jugador recibe una caja cada ${SPIN_EVERY} juegos.`;
  $('#sequenceStart').disabled=false;setRound('Campeonato reiniciado'); updateAllSpinStates(); renderPlayers();
}
$('#start').onclick = start; $('#reset').onclick = resetScores;$('#sequenceStart').onclick=startSequence;$('#sequencePause').onclick=toggleSequencePause;$('#sequenceStop').onclick=()=>stopSequence();$('#sequenceContinue').onclick=()=>{hideSequence();prepareSequenceGame();};
$('#enterRoom').onclick = () => { $('#cover').classList.add('cover-dismissed'); document.body.classList.remove('cover-open'); };
$('#projectorToggle').onclick = () => document.body.classList.add('projector-mode');
$('#projectorExit').onclick = () => document.body.classList.remove('projector-mode');
const requestedView=new URLSearchParams(location.search).get('vista');
if(requestedView==='consola'||requestedView==='proyector'){
  $('#cover').classList.add('cover-dismissed');document.body.classList.remove('cover-open');
  if(requestedView==='proyector')document.body.classList.add('projector-mode');
}
$('#mode').onchange = e => { mode = e.target.value; progress = {}; instructions(); renderPlayers(); };
$('#newRoom').onclick = () => {
  if(running&&mode==='color')for(const d of devices())command(d.id,{colorTarget:null});
  if(running&&mode==='voice')cancelVoiceTurn('Sala cambiada.');
  stopSequence('Sala nueva · listos para jugar'); running=false; voiceWaiting=false; voiceListening=false; voiceNextAt=0;
  room = tacto.cambiarSala(Tacto.nuevaSala()); scores = {}; shields = {}; spinTokens = {};
  pendingSabotage = {}; spinTargets = {}; completedGames = 0; championId = null; progress = {}; contacts = {};
  $('#sequenceStart').disabled=false;showRoom(); setRound('Sala nueva · listos para jugar'); renderPlayers();
};
function showRoom() {
  $('#room').textContent = room.toUpperCase(); $('#roomDuplicate').textContent=room.toUpperCase();
  const url = new URL('phone.html', new URL('.', location.href)); url.searchParams.set('sala', room);
  $('#phoneUrl').textContent = url.href;
}
function recordTap(d, m) {
  const active = new Set((Array.isArray(m?.p) ? m.p : []).map(p => String(p.i)));
  contacts[d.id] = active;
}
function recordTapEvent(d, m) {
  const eventId=String(m?.eventId||'');
  if(!running||sequencePaused||mode!=='tap'||!eventId||tapEvents.has(eventId))return;
  tapEvents.add(eventId);if(tapEvents.size>512)tapEvents.delete(tapEvents.values().next().value);
  const count=clamp(Math.floor(Number(m.count)||1),1,5);
  progress[d.id]=Math.min(TAPS_TO_FINISH,(progress[d.id]||0)+count);
  if(progress[d.id]>=TAPS_TO_FINISH)finishGame(d.id,'meta');
}
function advanceColorChallenge(foundBy = '') {
  const previous = targetColor; colorIndex++;
  if (colorIndex >= colorSequence.length) {
    const winner = pickWinner(d => progress[d.id] || 0);
    setRound(foundBy ? `${foundBy} encontró el quinto color.` : 'Se completaron los cinco colores.');
    finishGame(winner, 'caza de cinco colores'); return;
  }
  targetColor = colorSequence[colorIndex]; targetChanged = performance.now();
  for (const d of devices()) command(d.id, { colorTarget: { name: targetColor.name } });
  $('#round').textContent = foundBy
    ? `${foundBy} encontró ${previous.name} · ahora busca ${targetColor.name} (${colorIndex + 1}/5)`
    : `Color ${colorIndex + 1}/5: ${targetColor.name} · encuéntralo en 5 segundos`;
}
function checkColorMatch(d, sample) {
  if (!running || sequencePaused || mode !== 'color' || colorIndex < 0 || colorIndex >= colorSequence.length || performance.now() - targetChanged >= 5000) return;
  const hue = Number(sample.h), saturation = Number(sample.s);
  if (!Number.isFinite(hue) || !Number.isFinite(saturation) || saturation < .18 || hueDistance(hue, targetColor.hue) > targetColor.tolerance) return;
  progress[d.id] = (progress[d.id] || 0) + 1; advanceColorChallenge(d.name);
}
function onData(d, kind, m) {
  if (kind === 'touch') recordTap(d, m);
  else if (kind === 'cam') checkColorMatch(d, m);
  else if (kind === 'mic') recordVoiceSample(d,m);
  else if (kind === 'motion') { /* flattened channels stay in d.ch */ }
  else if (kind === 'action' && m?.action === 'spin') spin(d.id, Number(m.boxIndex)||0);
  else if (kind === 'action' && m?.action === 'tap') recordTapEvent(d,m);
  else if (kind === 'action' && m?.action === 'target') applySabotage(d.id, String(m.targetId || ''));
  else if (kind === 'action' && m?.action === 'voiceSampleReady') voiceSampleReady(d.id);
  else if (kind === 'action' && m?.action === 'voiceReady') voiceReady(d.id);
  else if (kind === 'action' && m?.action === 'voiceDenied' && d.id===voiceCurrentId) skipVoiceTurn('No se autorizó el micrófono; se salta este intento.');
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
  if(mode==='voice'&&voiceCurrentId)cancelVoiceTurn('La partida terminó.');
  running = false; if(mode==='color')for(const d of devices())command(d.id,{colorTarget:null}); completedGames++;
  const winner = winnerId ? tacto.devices[winnerId] : null;
  if (winner) scores[winnerId] = (scores[winnerId] || 0) + 1;
  const reachedCrown = winner && scores[winnerId] >= CROWN_TARGET;
  if (reachedCrown) championId = winnerId;
  if (!championId && completedGames % SPIN_EVERY === 0) {
    for (const d of devices()) spinTokens[d.id] = (spinTokens[d.id] || 0) + 1;
    $('#wheelStatus').textContent = '¡Cajas disponibles! Cada jugador puede abrir una desde su teléfono.';
  } else if (!championId) {
    $('#wheelStatus').textContent = `Próximas cajas en ${SPIN_EVERY - (completedGames % SPIN_EVERY)} juego${SPIN_EVERY - (completedGames % SPIN_EVERY) === 1 ? '' : 's'}.`;
  }
  if (championId) setRound(`👑 ${winner.name} conquistó la corona con ${scores[winnerId]} puntos`);
  else if (winner) setRound(`${winner.name} gana · ${scores[winnerId]}/${CROWN_TARGET} hacia la corona`);
  else setRound(`Empate · ${completedGames} juegos completados`);
  for (const d of devices()) spinState(d);
  renderPlayers();
  if(sequenceActive){
    sequencePhase='results';sequenceResult=championId?`👑 ${winner.name} gana el campeonato con ${scores[winnerId]} puntos.`:winner?`${winner.name} gana esta ronda y queda a ${Math.max(0,CROWN_TARGET-(scores[winnerId]||0))} puntos de la corona.`:'Ronda empatada; nadie suma punto.';
    showSequence(championId?'¡Campeón!':'Resultados',sequenceResult,`RONDA ${completedGames}`,true);
    if(championId){sequenceActive=false;sequencePhase='champion';$('#sequenceStart').disabled=true;$('#sequencePause').disabled=true;$('#sequenceStop').disabled=true;$('#sequenceContinue').hidden=true;}
    else{sequenceUntil=performance.now()+4200;setRound(sequenceResult);}
  }
}
function spin(id, boxIndex=0) {
  if (running || championId || !(spinTokens[id] > 0) || pendingSabotage[id]) return;
  spinTokens[id]--;
  const actor = tacto.devices[id], others = devices().filter(d => d.id !== id);
  let roll = Math.floor(Math.random() * 3); if (roll === 0 && !others.length) roll = 2; animateBox(Math.max(0,Math.min(2,boxIndex)), roll, actor?.name || 'Jugador');
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
function balanceZoneAt(elapsed) {
  const width=.18+.34*(.5+.5*Math.sin(elapsed*.37+1));
  const desired=.5+.29*Math.sin(elapsed*.46)+.07*Math.sin(elapsed*1.21);
  return {width,center:clamp(desired,width/2,1-width/2)};
}
function drawBalance(ds,w,h) {
  const elapsed=clamp((performance.now()-roundStart)/1000,0,60), left=Math.max(0,Math.ceil(60-elapsed));
  const {center,width}=balanceZoneAt(elapsed);
  ctx.fillStyle='#f5f0e8';ctx.textAlign='center';ctx.font='bold 18px system-ui';ctx.fillText(`Equilibrio · ${left} s`,w/2,30);
  ctx.fillStyle='#b8b3c3';ctx.font='12px system-ui';ctx.fillText('Inclina el teléfono · el tiempo dentro de la franja suma puntos',w/2,51);
  const top=76,row=Math.min(70,(h-top-16)/ds.length),x0=Math.max(38,w*.1),trackW=w-2*x0;
  ds.forEach((d,i)=>{
    const y=top+i*row+row/2,col=playerColor(d.id);
    ctx.fillStyle='#242438';ctx.fillRect(x0,y-10,trackW,20);
    ctx.fillStyle='#28442e';ctx.fillRect(x0+(center-width/2)*trackW,y-13,width*trackW,26);
    ctx.strokeStyle='#536171';ctx.lineWidth=1;ctx.strokeRect(x0,y-10,trackW,20);
    const px=x0+(balanceX[d.id]??.5)*trackW;
    ctx.fillStyle=col;ctx.beginPath();ctx.arc(px,y,9,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#f5f0e8';ctx.textAlign='left';ctx.font='13px system-ui';ctx.fillText(`${d.name} · ${(progress[d.id]||0).toFixed(1)} s`,x0,y-17);
  });
}
function draw() {
  const w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);ctx.fillStyle='#11111b';ctx.fillRect(0,0,w,h);
  const ds=devices();
  if(!ds.length){ctx.fillStyle='#b8b3c3';ctx.textAlign='center';ctx.font='16px system-ui';ctx.fillText('Conecta un teléfono para comenzar',w/2,h/2);return;}
  if(mode==='tilt'){drawBalance(ds,w,h);return;}
  if(mode==='color'){ctx.fillStyle='#f5f0e8';ctx.textAlign='center';ctx.font='bold 18px system-ui';ctx.fillText(`COLOR ${Math.max(1,colorIndex+1)}/5 · ${targetColor.name.toUpperCase()}`,w/2,34);ctx.fillStyle='#b8b3c3';ctx.font='12px system-ui';ctx.fillText(`El primero en encontrarlo suma · ${Math.max(0,5-(performance.now()-targetChanged)/1000).toFixed(1)} s`,w/2,55);}
  if(mode==='voice'){drawVoice(ds,w,h);return;}
  const row=Math.min(68,(h-90)/ds.length),top=mode==='tap'?34:76;
  ds.forEach((d,i)=>{
    const y=top+i*row+row/2,col=playerColor(d.id);ctx.fillStyle='#242438';ctx.fillRect(24,y-11,w-48,22);ctx.strokeStyle='#515a69';ctx.strokeRect(24,y-11,w-48,22);
    let fraction=0,x=24;
    if(mode==='tap'){fraction=(progress[d.id]||0)/TAPS_TO_FINISH;ctx.fillStyle=col;ctx.fillRect(24,y-11,(w-48)*fraction,22);x=24+(w-48)*fraction;}
    else if(mode==='tilt'){fraction=clamp((progress[d.id]||0)/12,0,1);x=24+(w-48)*clamp(.5+(d.ch['ang.g']||0)/100,0,1);ctx.fillStyle='#26362a';ctx.fillRect(24+(w-48)*.5,y-11,Math.max(3,(w-48)*fraction),22);}
    else if(mode==='color'){fraction=clamp((progress[d.id]||0)/5,0,1);ctx.fillStyle=col;ctx.fillRect(24,y-11,(w-48)*fraction,22);x=24+(w-48)*fraction;}
    ctx.fillStyle=col;ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f5f0e8';ctx.textAlign='left';ctx.font='13px system-ui';ctx.fillText(d.name,28,y-17);
  });
}
function shuffleCopy(items) { const out=items.slice();for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out; }
function between(a,b) { return a+Math.random()*(b-a); }
function makeVoiceSounds() {
  const registers=shuffleCopy(VOICE_REGISTERS),modifiers=shuffleCopy(VOICE_MODIFIERS).slice(0,3);
  return registers.map((r,i)=>{const hz=Math.round(between(r.min,r.max)*10)/10;return {hz,register:r.name,wave:VOICE_WAVES[Math.floor(Math.random()*VOICE_WAVES.length)],modifier:modifiers[i],rate:between(3.2,8.1),depthCents:between(12,38),glideRatio:between(.62,1.55),harmonic:[2,3,4][Math.floor(Math.random()*3)],tremoloDepth:between(.04,.1),seed:Math.random().toString(36).slice(2)};});
}
function prepareVoiceAudio() { const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;try{if(!voiceAudioContext)voiceAudioContext=new AC();if(voiceAudioContext.state==='suspended')voiceAudioContext.resume().catch(()=>{});}catch(e){console.warn('Audio no disponible',e);} }
function playVoiceSound(sound) {
  const ac=voiceAudioContext;if(!ac)return;if(ac.state==='suspended')ac.resume().catch(()=>{});
  const now=ac.currentTime,duration=VOICE_CUE_SECONDS,osc=ac.createOscillator(),gain=ac.createGain();osc.type=sound.wave;
  if(sound.modifier==='glide'){osc.frequency.setValueAtTime(Math.max(40,sound.hz*sound.glideRatio),now);osc.frequency.exponentialRampToValueAtTime(sound.hz,now+duration*.7);}else osc.frequency.setValueAtTime(sound.hz,now);
  gain.gain.setValueAtTime(.0001,now);gain.gain.linearRampToValueAtTime(.13,now+.035);gain.gain.setValueAtTime(.13,now+duration*.72);gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
  osc.connect(gain);gain.connect(ac.destination);osc.start(now);osc.stop(now+duration+.02);const extras=[];
  if(sound.modifier==='vibrato'){const lfo=ac.createOscillator(),depth=ac.createGain();lfo.frequency.value=sound.rate;depth.gain.value=sound.hz*(Math.pow(2,sound.depthCents/1200)-1);lfo.connect(depth);depth.connect(osc.frequency);lfo.start(now);lfo.stop(now+duration);extras.push(lfo,depth);}
  else if(sound.modifier==='tremolo'){const lfo=ac.createOscillator(),depth=ac.createGain();lfo.frequency.value=sound.rate;depth.gain.value=sound.tremoloDepth;lfo.connect(depth);depth.connect(gain.gain);lfo.start(now);lfo.stop(now+duration);extras.push(lfo,depth);}
  else if(sound.modifier==='harmonic'||sound.modifier==='detune'){const over=ac.createOscillator(),overGain=ac.createGain();over.type=sound.modifier==='harmonic'?'sine':sound.wave;over.frequency.value=sound.hz*(sound.modifier==='harmonic'?sound.harmonic:1.01);overGain.gain.setValueAtTime(.0001,now);overGain.gain.linearRampToValueAtTime(.04,now+.04);overGain.gain.setValueAtTime(.04,now+duration*.72);overGain.gain.exponentialRampToValueAtTime(.0001,now+duration);over.connect(overGain);overGain.connect(ac.destination);over.start(now);over.stop(now+duration+.02);extras.push(over,overGain);}
  osc.onended=()=>{try{gain.disconnect();for(const n of extras)n.disconnect();}catch{}};
}
function voiceCount(id) { return progress[id]||0; }
function voiceAccuracy(id) { const vals=(voiceResults[id]||[]).filter(Number.isFinite);return vals.length?`±${Math.round(vals.reduce((s,x)=>s+x,0)/vals.length)} cents`:'—'; }
function beginVoiceTurn() {
  if(!running||mode!=='voice')return;
  while(voiceSoundIndex<voiceSounds.length&&voicePlayerIndex<voiceOrder.length&&!tacto.devices[voiceOrder[voicePlayerIndex]]?.online){const id=voiceOrder[voicePlayerIndex];voiceResults[id][voiceSoundIndex]=Infinity;progress[id]=voiceSoundIndex+1;advanceVoiceCursor();if(!running)return;}
  if(voiceSoundIndex>=voiceSounds.length){finishVoiceRound();return;}
  const id=voiceOrder[voicePlayerIndex],d=tacto.devices[id];if(!d?.online){finishVoiceRound();return;}
  voiceCurrentId=id;voiceWaiting=true;voiceListening=false;voiceSamples=[];voiceSingStart=0;voiceSampleEnd=0;voiceStage='sampleAck';voiceReadyDeadline=performance.now()+VOICE_PERMISSION_TIMEOUT;voiceCommandRetryAt=performance.now()+1200;
  command(id,{voiceTurn:{phase:'sample',soundIndex:voiceSoundIndex+1,total:3,sound:voiceSounds[voiceSoundIndex],duration:VOICE_CUE_SECONDS}});setRound(`${d.name}: escucha la nota ${voiceSoundIndex+1}/3; el micrófono está apagado.`);
}
function voiceSampleReady(id) {
  if(!running||sequencePaused||mode!=='voice'||!voiceWaiting||voiceStage!=='sampleAck'||id!==voiceCurrentId)return;
  voiceWaiting=false;voiceStage='sample';voiceCommandRetryAt=0;playVoiceSound(voiceSounds[voiceSoundIndex]);voiceSampleEnd=performance.now()+VOICE_CUE_SECONDS*1000+350;
  setRound(`${tacto.devices[id]?.name||'Jugador'}: escucha la nota ${voiceSoundIndex+1}/3.`);
}
function voiceReady(id) {
  if(!running||sequencePaused||mode!=='voice'||!voiceWaiting||voiceStage!=='userMic'||id!==voiceCurrentId)return;
  voiceWaiting=false;voiceListening=true;voiceStage='sing';voiceSingStart=performance.now();voiceTurnEnd=voiceSingStart+VOICE_ATTEMPT_SECONDS*1000;
  command(id,{voiceTurn:{phase:'sing',soundIndex:voiceSoundIndex+1,seconds:VOICE_ATTEMPT_SECONDS}});
  setRound(`${tacto.devices[id]?.name||'Jugador'}: imita la nota ${voiceSoundIndex+1}/3 durante 5 segundos.`);
}
function recordVoiceSample(d,m) {
  if(!running||sequencePaused||mode!=='voice'||!voiceListening||d.id!==voiceCurrentId)return;
  const pitch=Number(m.p),level=Number(m.l);if(!Number.isFinite(pitch)||pitch<65||pitch>900||!Number.isFinite(level)||level<.025)return;
  voiceSamples.push(Math.abs(1200*Math.log2(pitch/voiceSounds[voiceSoundIndex].hz)));
}
function advanceVoiceCursor() {
  voiceCurrentId=null;voiceWaiting=false;voiceListening=false;voiceSingStart=0;voiceSampleEnd=0;voiceCommandRetryAt=0;voiceStage='idle';voicePlayerIndex++;
  if(voicePlayerIndex>=voiceOrder.length){voicePlayerIndex=0;voiceSoundIndex++;}
  if(voiceSoundIndex>=voiceSounds.length){finishVoiceRound();return;}voiceNextAt=performance.now()+VOICE_TURN_GAP;
}
function finishVoiceTurn() {
  if(!voiceCurrentId)return;const id=voiceCurrentId,vals=voiceSamples.slice();voiceResults[id][voiceSoundIndex]=vals.length?vals.reduce((s,x)=>s+x,0)/vals.length:Infinity;progress[id]=voiceSoundIndex+1;
  const score=voiceResults[id][voiceSoundIndex],message=Number.isFinite(score)?`Intento ${voiceSoundIndex+1}/3 registrado · ${Math.round(score)} cents de desviación.`:`No se detectó una voz clara en el intento ${voiceSoundIndex+1}/3.`;
  command(id,{voiceTurn:{phase:'off',message}});advanceVoiceCursor();renderPlayers();
}
function skipVoiceTurn(message) {
  if(!voiceCurrentId)return;const id=voiceCurrentId;voiceResults[id][voiceSoundIndex]=Infinity;progress[id]=voiceSoundIndex+1;command(id,{voiceTurn:{phase:'off',message}});advanceVoiceCursor();renderPlayers();
}
function cancelVoiceTurn(message='Partida terminada.') { if(voiceCurrentId)command(voiceCurrentId,{voiceTurn:{phase:'off',message}});voiceCurrentId=null;voiceWaiting=false;voiceListening=false;voiceSingStart=0;voiceSampleEnd=0;voiceCommandRetryAt=0;voiceStage='idle';voiceNextAt=0; }
function finishVoiceRound() {
  const eligible=voiceOrder.filter(id=>(voiceResults[id]||[]).length===3&&voiceResults[id].every(Number.isFinite)).map(id=>({id,score:voiceResults[id].reduce((s,x)=>s+x,0)/3})).sort((a,b)=>a.score-b.score);
  let winner=null;if(eligible.length)winner=eligible.length>1&&Math.abs(eligible[0].score-eligible[1].score)<3?null:eligible[0].id;finishGame(winner,'tres sonidos');
}
function drawVoice(ds,w,h) {
  ctx.textAlign='center';ctx.fillStyle='#f5f0e8';ctx.font='bold 20px system-ui';ctx.fillText('Acierta el sonido · 3 sonidos únicos',w/2,34);
  const current=voiceCurrentId?tacto.devices[voiceCurrentId]:null;
    if(!running){ctx.fillStyle='#b8b3c3';ctx.font='14px system-ui';ctx.fillText('Inicia la partida para escuchar sonidos nuevos.',w/2,68);}
    else if(voiceStage==='countdown'){const n=Math.max(1,Math.ceil((voiceCountdownUntil-performance.now())/1000));ctx.fillStyle='#b8b3c3';ctx.font='bold 24px system-ui';ctx.fillText(`La primera nota suena en ${n}…`,w/2,78);}
  else if(current){ctx.fillStyle=playerColor(current.id);ctx.font='bold 17px system-ui';ctx.fillText(`${current.name} · nota ${voiceSoundIndex+1}/3`,w/2,72);let status='Preparando el turno…',fraction=0;
    if(voiceStage==='sample')status='Escucha la nota de muestra…';else if(voiceStage==='userMic')status='La nota terminó · activa el micrófono en tu teléfono';else if(voiceListening){const left=Math.max(0,(voiceTurnEnd-performance.now())/1000),live=voiceSamples.length?Math.round(voiceSamples.reduce((sum,value)=>sum+value,0)/voiceSamples.length):null;status=`¡Imita ahora! · ${left.toFixed(1)} s${live==null?'':` · ±${live} cents`}`;fraction=1-left/VOICE_ATTEMPT_SECONDS;}
    ctx.fillStyle='#b8b3c3';ctx.font='14px system-ui';ctx.fillText(status,w/2,105);ctx.fillStyle='#42415b';ctx.fillRect(28,125,w-56,16);ctx.fillStyle=playerColor(current.id);ctx.fillRect(28,125,(w-56)*clamp(fraction,0,1),16);
  }else{ctx.fillStyle='#b8b3c3';ctx.font='14px system-ui';ctx.fillText('Preparando el siguiente turno…',w/2,76);}
  const top=170,row=Math.min(48,(h-top-8)/Math.max(1,ds.length));ds.forEach((d,i)=>{const y=top+i*row;ctx.fillStyle=playerColor(d.id);ctx.textAlign='left';ctx.font='13px system-ui';ctx.fillText(`${d.name} · ${progress[d.id]||0}/3 turnos · ${voiceAccuracy(d.id)}`,28,y);});
}
function finishByTime() {
  if(mode==='tap') finishGame(pickWinner(d=>progress[d.id]||0),'tiempo');
  else if(mode==='tilt') finishGame(pickWinner(d=>progress[d.id]||0),'tiempo');
  else if(mode==='color') finishGame(pickWinner(d=>progress[d.id]||0),'tiempo');
}
function tick(now) {
  const dt=Math.min(.05,(now-lastFrame)/1000);lastFrame=now;
  if(sequenceActive&&!sequencePaused&&sequencePhase==='results'&&now>=sequenceUntil){prepareSequenceGame();}
  if(sequenceActive&&!sequencePaused&&sequencePhase==='instructions'&&now>=sequenceUntil){sequencePhase='countdown';sequenceUntil=now+3000;showSequence('Prepárate','3','CUENTA REGRESIVA',false);}
  if(sequenceActive&&!sequencePaused&&sequencePhase==='countdown'){const n=Math.max(1,Math.ceil((sequenceUntil-now)/1000));$('#sequenceTitle').textContent=String(n);if(now>=sequenceUntil){hideSequence();start();}}
  if(sequencePaused){draw();requestAnimationFrame(tick);return;}
  if(running&&roundEnd>0&&now>=roundEnd){finishByTime();}
  if(running&&mode==='tilt'){
    const elapsed=(now-roundStart)/1000,{center,width}=balanceZoneAt(elapsed);
    for(const d of devices()){
      const angle=d.ch['ang.g'];
      if(angle!=null&&performance.now()-(d.last||0)<160){
        const raw=clamp(.5+(angle-(balanceNeutral[d.id]??0))/90,0,1),prev=balanceX[d.id]??.5;
        const x=prev+(raw-prev)*(1-Math.exp(-dt*20));balanceX[d.id]=x;
        if(Math.abs(x-center)<=width/2)progress[d.id]=(progress[d.id]||0)+dt;
      }
    }
  }
  if(running&&mode==='color'&&now-targetChanged>=5000)advanceColorChallenge();
  if(running&&mode==='voice'){
    if(voiceStage==='countdown'&&now>=voiceCountdownUntil){voiceStage='idle';voiceCountdownUntil=0;beginVoiceTurn();}
    else if(voiceStage!=='countdown'){
      if(voiceWaiting&&voiceStage==='sampleAck'&&now>=voiceCommandRetryAt){command(voiceCurrentId,{voiceTurn:{phase:'sample',soundIndex:voiceSoundIndex+1,total:3,sound:voiceSounds[voiceSoundIndex],duration:VOICE_CUE_SECONDS}});voiceCommandRetryAt=now+1200;}
      if(voiceWaiting&&now>=voiceReadyDeadline)skipVoiceTurn(voiceStage==='userMic'?'No se activó el micrófono a tiempo.':'No se pudo preparar este turno.');
      if(voiceCurrentId&&voiceStage==='sample'&&now>=voiceSampleEnd){voiceStage='userMic';voiceWaiting=true;voiceReadyDeadline=now+VOICE_PERMISSION_TIMEOUT;command(voiceCurrentId,{voiceTurn:{phase:'ready',soundIndex:voiceSoundIndex+1,seconds:VOICE_ATTEMPT_SECONDS}});setRound(`${tacto.devices[voiceCurrentId]?.name||'Jugador'}: la nota terminó; activa el micrófono para comenzar.`);}
      if(voiceListening&&now>=voiceTurnEnd)finishVoiceTurn();
      if(running&&!voiceCurrentId&&voiceNextAt&&now>=voiceNextAt){voiceNextAt=0;beginVoiceTurn();}
    }
  }
  draw();if(now-lastHud>300){lastHud=now;renderPlayers();}requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
$('#mode').value=mode;instructions();
(async()=>{
  tacto=new Tacto();updateRoomFromURL();
  tacto.on('estado',s=>{$('#connection').textContent=s;$('#connection').className='pill '+(s==='conectado'?'on':'');$('#connectionDuplicate').textContent=s;$('#coverStatus').textContent=s==='conectado'?'Sala conectada · lista para jugar':s==='reconectando'?'Reconectando con Tacto…':'Sin conexión con Tacto';$('#coverLed').classList.toggle('on',s==='conectado');});
  tacto.on('datos',onData);tacto.on('dispositivo',d=>{renderPlayers();updateAllSpinStates();if(d&&running&&mode==='color')command(d.id,{colorTarget:{name:targetColor.name}});if(d&&d.id===voiceCurrentId&&!d.online)skipVoiceTurn('Jugador desconectado; se salta este intento.');});
  tacto.on('rtt',d=>{const a=d.rtt.slice().sort((x,y)=>x-y);$('#latency').textContent=a.length?`Latencia ${Math.round(a[Math.floor(a.length/2)])} ms`:'';});
  tacto.on('error',e=>$('#notice').textContent=e.message||'Error de conexión');
  try{await tacto.connect();$('#notice').textContent='Conectado al broker MQTT de Tacto.';updateAllSpinStates();}
  catch(e){$('#notice').textContent='No se pudo conectar al broker: '+(e.message||e);$('#coverStatus').textContent='No se pudo conectar con Tacto';$('#coverLed').classList.remove('on');}
  $('#wheelStatus').textContent=`Cada jugador recibe una caja cada ${SPIN_EVERY} juegos.`;renderPlayers();
})();
