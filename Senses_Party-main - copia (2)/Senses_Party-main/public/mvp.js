'use strict';
const $ = s => document.querySelector(s);
const canvas = $('#stage'), ctx = canvas.getContext('2d');
const COLORS = ['#C6FF36', '#FF4D8D', '#37D9F2', '#FF9F43', '#9A72FF', '#F9E547'];
const CROWN_TARGET = 5, TAPS_TO_FINISH = 100, SPIN_EVERY = 3;
const tapRace = new SensesGameEngines.TapRace(TAPS_TO_FINISH);
const GAME_SECONDS = { tilt: 60, color: 30 };
const VOICE_CUE_SECONDS = 1.15, VOICE_ATTEMPT_SECONDS = 3, VOICE_PERMISSION_TIMEOUT = 10000, VOICE_TURN_GAP = 700;
const COLOR_COUNTDOWN_MS = 5000;      // tiempo para activar la cámara antes de la Caza de colores (modo individual)
const MOTION_FRESH_MS = 5000;         // el giro cuenta como "funcionando" si llegaron datos en los últimos 5 s
const RESULTS_MS = 4200, RESULTS_WITH_BOXES_MS = 8000; // duración de la pantalla de resultados del campeonato
const VOICE_REGISTERS = [{ name:'grave', min:82, max:165 }, { name:'medio', min:210, max:370 }, { name:'agudo', min:510, max:850 }];
const VOICE_WAVES = ['sine','triangle','square','sawtooth'];
const VOICE_MODIFIERS = ['vibrato','tremolo','glide','harmonic','detune','none'];
const TARGET_COLORS = SensesGameEngines.TARGET_COLORS;
const colorHunt = new SensesGameEngines.ColorHunt(TARGET_COLORS, 5, 5);
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
  const online=devices(), now=performance.now();
  // Giro: solo si de verdad llegaron datos hace poco (un computador puede decir que tiene giro sin enviar nada).
  const hasMotion=online.some(d=>now-(d.seen?.motion||0)<MOTION_FRESH_MS);
  // Cámara: basta con que el teléfono PUEDA usarla; se le pedirá activarla antes de empezar.
  const hasCamera=online.some(canUseCamera);
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
  if(!next){stopSequence('No hay minijuegos disponibles: conecta un teléfono para continuar.');return;}
  mode=next;$('#mode').value=mode;instructions();renderPlayers();
  if(mode==='color')requestCameras(); // así los jugadores activan la cámara durante las instrucciones
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
  if(mode==='color')for(const d of devices())command(d.id,{colorTarget:null}); // también cierra el aviso de cámara si el reto no alcanzó a empezar
  if(running&&mode==='voice')cancelVoiceTurn(message);
  running=false;voiceWaiting=false;voiceListening=false;voiceNextAt=0;colorCountdownUntil=0;
  $('#sequenceStart').disabled=!!championId;$('#sequencePause').disabled=true;$('#sequenceStop').disabled=true;
  hideSequence();setRound(message);updateAllSpinStates();renderPlayers();
}
function toggleSequencePause(){
  if(!sequenceActive)return;
  sequencePaused=!sequencePaused;$('#sequencePause').textContent=sequencePaused?'Reanudar':'Pausar';
  updateAllSpinStates();
  if(sequencePaused){sequencePausedAt=performance.now();setRound('Campeonato pausado · pulsa Reanudar para seguir.');}
  else{const delta=performance.now()-sequencePausedAt;if(sequencePhase!=='playing')sequenceUntil+=delta;else{roundStart+=delta;if(roundEnd)roundEnd+=delta;if(targetChanged)targetChanged+=delta;if(colorHunt.running)colorHunt.startedAt+=delta;if(colorCountdownUntil)colorCountdownUntil+=delta;if(voiceCountdownUntil)voiceCountdownUntil+=delta;if(voiceReadyDeadline)voiceReadyDeadline+=delta;if(voiceTurnEnd)voiceTurnEnd+=delta;if(voiceSampleEnd)voiceSampleEnd+=delta;if(voiceNextAt)voiceNextAt+=delta;if(voiceChallenge.phase==='singing')voiceChallenge.deadline+=delta;}setRound('Campeonato reanudado');}
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
const voiceChallenge = new SensesGameEngines.NoteChallenge(VOICE_ATTEMPT_SECONDS);
let lastFrame = performance.now(), lastHud = 0;
let hudDirty = false;          // "hay datos nuevos": los paneles se redibujan en tick(), no con cada mensaje
let colorCountdownUntil = 0;   // cuenta regresiva para activar la cámara (Caza de colores en modo individual)
let infoBase = '';             // dirección de red real del servidor (de /info), para el enlace de los teléfonos
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = v => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(2);
function setRound(text) { const node=$('#roundText'); if(node)node.textContent=text; }
function size() {
  const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
  const w = Math.round(r.width * d), h = Math.round(r.height * d);
  if (canvas.width === w && canvas.height === h) return; // mismo tamaño: no reiniciar el canvas (eso provoca un parpadeo)
  canvas.width = w; canvas.height = h; ctx.setTransform(d, 0, 0, d, 0, 0);
}
// Cambia el HTML de un elemento SOLO si el contenido es distinto. Reescribir un panel igual
// obliga al navegador a recalcular la página y produce pequeños tirones en la animación.
function setHTML(sel, html) { const el = $(sel); if (el && el._html !== html) { el.innerHTML = html; el._html = html; } }
addEventListener('resize', size); size();
// ResizeObserver avisa cada vez que la caja del escenario cambia de tamaño (modo proyección, textos que crecen…),
// no solo cuando cambia la ventana. Así el dibujo nunca queda estirado ni cortado.
if (window.ResizeObserver) new ResizeObserver(size).observe(canvas.parentElement);
function devices() { return tacto ? Object.values(tacto.devices).filter(d => d.online) : []; }
function playerColor(id) { if (!playerColors[id]) { playerColors[id] = COLORS[nextPlayerColor % COLORS.length]; nextPlayerColor++; } return playerColors[id]; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function command(id, payload) {
  if (tacto?.client?.connected) tacto.client.publish(`tacto/${room}/${id}/cmd`, JSON.stringify(payload), { qos: 1 });
}
// ¿Puede este teléfono usar la cámara? (camAvail lo informa el control; cam = ya la tiene encendida)
function canUseCamera(d) { return d.caps?.cam === true || d.caps?.camAvail === true; }
// Pide a todos los teléfonos que muestren el botón "Activar cámara".
function requestCameras() { for (const d of devices()) command(d.id, { camRequest: true }); }
function spinState(d) {
  const canSpin = !running && !championId && (spinTokens[d.id] || 0) > 0;
  const targets = spinTargets[d.id] || [];
  command(d.id, { hostReady: true, spinAvailable: canSpin, spinTokens: spinTokens[d.id] || 0,
    sabotagePending: !!pendingSabotage[d.id], sabotageTargets: targets,
    tapMode: running && !sequencePaused && mode === 'tap', tapProgress: progress[d.id] || 0, tapTarget: TAPS_TO_FINISH });
}
function updateAllSpinStates() { for (const d of devices()) spinState(d); }
function renderPlayers() {
  const all = Object.values(tacto?.devices || {}), online = all.filter(d => d.online);
  // el panel de sensores (que es pesado de reconstruir) solo se actualiza si está abierto
  if ($('.sensor-details')?.open) setHTML('#players', all.length ? all.map(d => {
    const c = d.ch || {}, color = playerColor(d.id);
    const pts = scores[d.id] || 0, pct = Math.round(clamp(pts / CROWN_TARGET, 0, 1) * 100);
    const shield = shields[d.id] || 0, games = mode === 'tap' ? `${Math.min(TAPS_TO_FINISH, Math.round(progress[d.id] || 0))}/${TAPS_TO_FINISH} toques`
      : mode === 'tilt' ? `${fmt(progress[d.id] || 0)} s dentro de la barra`
      : mode === 'color' ? `${progress[d.id] || 0}/5 colores encontrados`
      : mode === 'voice' ? `${progress[d.id] || 0}/3 turnos · ${voiceAccuracy(d.id)}` : '';
    return `<article class="player ${d.online ? '' : 'off'}"><h3><span style="color:${color}">● ${esc(d.name)}</span><span>${pts}/${CROWN_TARGET} 👑</span></h3><div class="crown-meter" aria-label="${pct}% del camino a la corona"><i style="width:${pct}%;background:${color}"></i></div><p class="tiny game-progress">${games}${shield ? ` · 🛡 ${shield}` : ''}</p><div class="values"><span>Tacto X <b>${fmt(c['touch.x'])}</b></span><span>Tacto Y <b>${fmt(c['touch.y'])}</b></span><span>Giro γ <b>${fmt(c['ang.g'])}°</b></span><span>Giro β <b>${fmt(c['ang.b'])}°</b></span><span>Voz <b>${c['mic.pitch'] ? Math.round(c['mic.pitch']) + ' Hz' : '—'}</b></span><span>Cámara <b>${c['cam.sat'] > 0.25 ? 'color' : '—'}</b></span></div></article>`;
  }).join('') : '<p class="tiny">Esperando teléfonos…</p>');
  const ranked = online.slice().sort((a,b)=>(scores[b.id]||0)-(scores[a.id]||0));
  const topScore = ranked.length ? scores[ranked[0].id]||0 : 0;
  const leaders = topScore ? ranked.filter(d=>(scores[d.id]||0)===topScore) : [];
  const leaderId = leaders.length===1 ? leaders[0].id : null;
  setHTML('#projectedScoreboard', online.length ? online.slice(0,4).map(d => `<div class="score-slot" style="--player-color:${playerColor(d.id)}"><i class="score-color"></i><span class="score-slot-copy"><span class="score-slot-name">${esc(d.name)}</span><span class="score-slot-value">${scores[d.id]||0} / ${CROWN_TARGET}</span></span>${leaderId===d.id?'<span class="score-slot-lead">LÍDER</span>':''}</div>`).join('') + (online.length>4?`<span class="score-empty">+${online.length-4} jugadores conectados</span>`:'') : '<div class="score-empty">Esperando jugadores</div>');
  setHTML('#scoreboard', online.length ? online.map(d => `<div style="padding:4px;color:${playerColor(d.id)}">${esc(d.name)} · ${scores[d.id] || 0}/${CROWN_TARGET} para la corona${leaderId===d.id?' · LÍDER':''}${shields[d.id] ? ` · 🛡 ${shields[d.id]}` : ''}</div>`).join('') : 'Sin jugadores conectados');
  $('#crownStatus').textContent = championId ? `👑 ${tacto.devices[championId]?.name || 'Campeón'}` : `CORONA · ${CROWN_TARGET} PUNTOS`;
  setHTML('#arenaTitle', running ? `<span class="title-accent">${esc(({tap:'CARRERA DE TOQUES',tilt:'TORRE EN EQUILIBRIO',color:'CAZA DE COLORES',voice:'ACIERTA LA NOTA'})[mode])}</span>` : `SALA <span class="title-accent">LISTA</span>`);
  $('#roomDuplicate').textContent=room.toUpperCase();
  $('#start').disabled = running || !!championId || sequenceActive;
  $('#mode').disabled = running || sequenceActive;
  hudDirty = false; // el canvas ya se dibuja en cada cuadro dentro de tick()
}
function instructions() {
  const text = {
    tap: `Cada toque hace avanzar tu barra. Llega a ${TAPS_TO_FINISH} toques para ganar. Usa todos los dedos que quieras: cada dedo nuevo suma un toque.`,
    tilt: 'Durante 60 segundos, inclina el teléfono para mantener tu marcador dentro de la franja verde móvil. Suma tiempo cada instante que permanezcas dentro; gana quien acumule más.',
    color: 'La partida pide 5 colores, uno a la vez. Cada color dura hasta 5 segundos; el primero en encontrarlo suma. En el teléfono verás la cámara y solo el nombre del color.',
    voice: 'Cada jugador escucha la nota con el micrófono apagado. Cuando su nombre se ilumina, activa el micrófono y tiene 3 segundos para imitarla. Un intento por nota; gana el promedio más acertado de las tres.',
  };
  $('#instructions').textContent = text[mode];
  $('#modeName').textContent = ({tap:'Carrera de toques',tilt:'Torre en equilibrio',color:'Caza de colores',voice:'Acierta la nota'})[mode];
  return text[mode];
}
// Inicia el minijuego elegido. Devuelve true si pudo empezar y false si no
// (así el campeonato sabe que debe pausar o pasar a otro reto en vez de quedarse pegado).
function start() {
  if (running || championId) return false;
  const online = devices();
  if (!online.length) { setRound('Conecta al menos un teléfono.'); return false; }
  if(mode==='color'&&!online.some(canUseCamera)){
    setRound('Ningún control puede usar la cámara (ábrelo con el enlace HTTPS) · se omite Caza de colores.');
    return false;
  }
  sequencePhase=sequenceActive?'playing':'idle';hideSequence();running = true; roundStart = performance.now(); roundEnd = mode === 'tilt' ? roundStart + GAME_SECONDS.tilt * 1000 : 0;
  progress = {}; for (const d of online) progress[d.id] = 0;
  if (mode === 'tap') {
    progress = tapRace.start(online.map(d => d.id)).progress; tapShown = {}; tapFlash = {};
    for (const d of online) command(d.id, { tapMode: true, tapProgress: 0, tapTarget: TAPS_TO_FINISH, reset: true });
  }
  if (mode === 'color') {
    colorHunt.reset(); colorIndex = -1; requestCameras();
    // En el campeonato la cámara ya se pidió durante las instrucciones; en modo individual damos 5 s.
    if (sequenceActive) beginColorHunt(); else colorCountdownUntil = performance.now() + COLOR_COUNTDOWN_MS;
  }
  if (mode === 'tilt') { balanceNeutral = {}; balanceX = {}; for (const d of online) { balanceNeutral[d.id] = sampleGamma(d.id) ?? d.ch['ang.g'] ?? 0; balanceX[d.id] = .5; } }
  if (mode === 'voice') {
    voiceSounds=makeVoiceSounds();voiceOrder=online.map(d=>d.id);voiceChallenge.start(voiceOrder,voiceSounds);voiceResults=voiceChallenge.results;
    voiceSamples=[];voiceSoundIndex=0;voicePlayerIndex=0;voiceCurrentId=null;voiceWaiting=false;voiceListening=false;voiceNextAt=0;voiceStage='idle';voiceSampleEnd=0;voiceCountdownUntil=0;prepareVoiceAudio();
    for(const d of online)command(d.id,{voiceTurn:{phase:'waiting',message:'Espera a que tu nombre se ilumine para activar el micrófono.'}});
  }
  if (mode !== 'color') setRound(mode === 'tilt' ? 'Equilibrio: 60 s · usa solo el giroscopio para permanecer dentro de la franja verde' : mode === 'voice' ? 'Preparando sonidos nuevos para la partida…' : mode === 'tap' ? 'Carrera de toques: ¡el primero en llegar a 100 toques gana!' : 'Ronda en curso');
  else if (colorCountdownUntil) setRound('Caza de colores: activen la cámara en sus teléfonos · empieza en 5 segundos');
  updateAllSpinStates(); renderPlayers();
  if(mode==='voice'){
    if(sequenceActive)beginVoiceTurn();
    else{voiceStage='countdown';voiceCountdownUntil=performance.now()+3000;setRound('Acierta la nota comienza al terminar la cuenta regresiva.');}
  }
  return true;
}
// Arranca de verdad la búsqueda de colores (después de la cuenta regresiva, si la hubo).
function beginColorHunt() {
  colorCountdownUntil = 0;
  const players = devices(), state = colorHunt.start(players.map(d => d.id), performance.now());
  if (!state) { finishGame(null, 'sin jugadores'); return; }
  colorSequence = colorHunt.sequence.slice(); colorIndex = state.index; targetColor = state.color; targetChanged = colorHunt.startedAt;
  roundEnd = performance.now() + GAME_SECONDS.color * 1000;
  for (const d of players) command(d.id, { colorTarget: { name: targetColor.name } });
  setRound(`Color 1/5: ${targetColor.name} · encuéntralo en 5 segundos`);
}
// Qué hacer si el campeonato intenta iniciar un reto y no puede.
function sequenceStartFailed() {
  if (!sequenceActive) return;
  if (!devices().length) { // sin jugadores: pausamos en vez de reintentar sin fin
    sequencePaused = true; sequencePausedAt = performance.now(); $('#sequencePause').textContent = 'Reanudar';
    sequencePhase = 'instructions'; sequenceUntil = performance.now() + 3600;
    showSequence('Esperando jugadores', 'Conecta al menos un teléfono y pulsa Reanudar.', 'CAMPEONATO EN PAUSA', false);
    setRound('Campeonato en pausa · no hay teléfonos conectados.');
    return;
  }
  prepareSequenceGame(); // hay jugadores pero este reto no se puede jugar: pasamos al siguiente
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
  // Si la pantalla está abierta como "localhost", ese enlace no les sirve a los teléfonos
  // ("localhost" significa "este mismo equipo"): usamos la dirección de red que entrega el servidor.
  const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
  const base = isLocal && infoBase ? new URL(infoBase.replace(/\/?$/, '/')) : new URL('.', location.href);
  const url = new URL('phone.html', base); url.searchParams.set('sala', room);
  $('#phoneUrl').textContent = url.href;
  const qr = $('#qr'); // el servidor genera el QR en /qr.svg; si no existe (p. ej. GitHub Pages) se oculta
  qr.onload = () => { qr.hidden = false; }; qr.onerror = () => { qr.hidden = true; };
  qr.src = 'qr.svg?u=' + encodeURIComponent(url.href);
}
function recordTap(d, m) {
  const active = new Set((Array.isArray(m?.p) ? m.p : []).map(p => String(p.i)));
  contacts[d.id] = active;
}
function recordTapEvent(d, m) {
  const eventId=String(m?.eventId||'');
  if(!running||sequencePaused||mode!=='tap')return;
  tapRace.join(d.id); // si llegó tarde o se reconectó, se suma a la carrera en vez de ignorar sus toques
  const result=tapRace.tap(d.id,eventId,m?.count);
  if(!result.accepted)return;
  progress[d.id]=result.progress;tapFlash[d.id]=performance.now();
  command(d.id,{tapMode:tapRace.running,tapProgress:result.progress,tapTarget:TAPS_TO_FINISH});
  if(result.winner)finishGame(result.winner,'100 toques');
}
function checkColorMatch(d, sample) {
  if (!running || sequencePaused || mode !== 'color') return;
  const result=colorHunt.sample(d.id,sample,performance.now());
  if(!result.accepted)return;
  progress={...result.scores};
  if(result.done){setRound(`${d.name} encontró el quinto color.`);finishGame(result.winner,'caza de cinco colores');return;}
  colorIndex=result.current.index;targetColor=result.current.color;targetChanged=colorHunt.startedAt;
  for(const player of devices())command(player.id,{colorTarget:{name:targetColor.name}});
  setRound(`${d.name} encontró ${result.color.name} · ahora busca ${targetColor.name} (${colorIndex+1}/5)`);
}
function onData(d, kind, m) {
  if (kind === 'touch') recordTap(d, m);
  else if (kind === 'cam') checkColorMatch(d, m);
  else if (kind === 'mic') recordVoiceSample(d,m);
  else if (kind === 'motion') recordMotion(d, m); // además de d.ch, guardamos el giro con su hora para interpolarlo
  else if (kind === 'action' && m?.action === 'spin') spin(d.id, Number(m.boxIndex)||0);
  else if (kind === 'action' && m?.action === 'tap') recordTapEvent(d,m);
  else if (kind === 'action' && m?.action === 'target') applySabotage(d.id, String(m.targetId || ''));
  else if (kind === 'action' && m?.action === 'voiceReady') voiceReady(d.id,Number(m.soundIndex));
  else if (kind === 'action' && m?.action === 'voiceDenied' && d.id===voiceCurrentId && Number(m.soundIndex)===voiceSoundIndex+1) skipVoiceTurn('No se autorizó el micrófono; se salta este intento.');
  hudDirty = true; // solo marcamos; tick() redibuja los paneles como máximo unas 6 veces por segundo
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
  const boxesAvailable = !championId && completedGames % SPIN_EVERY === 0;
  if (boxesAvailable) {
    for (const d of devices()) spinTokens[d.id] = (spinTokens[d.id] || 0) + 1;
    $('#wheelStatus').textContent = '¡Cajas disponibles! Cada jugador puede abrir una desde su teléfono.';
  } else if (!championId) {
    $('#wheelStatus').textContent = `Próximas cajas en ${SPIN_EVERY - (completedGames % SPIN_EVERY)} juego${SPIN_EVERY - (completedGames % SPIN_EVERY) === 1 ? '' : 's'}.`;
  }
  if (boxesAvailable) setRound('Hora de probar tu suerte');
  else if (championId) setRound(`👑 ${winner.name} conquistó la corona con ${scores[winnerId]} puntos`);
  else if (winner) setRound(`${winner.name} gana · ${scores[winnerId]}/${CROWN_TARGET} hacia la corona`);
  else setRound(`Empate · ${completedGames} juegos completados`);
  for (const d of devices()) spinState(d);
  renderPlayers();
  if(sequenceActive){
    sequencePhase='results';sequenceResult=championId?`👑 ${winner.name} gana el campeonato con ${scores[winnerId]} puntos.`:winner?`${winner.name} gana esta ronda y queda a ${Math.max(0,CROWN_TARGET-(scores[winnerId]||0))} puntos de la corona.`:'Ronda empatada; nadie suma punto.';
    showSequence(boxesAvailable?'Hora de probar tu suerte':championId?'¡Campeón!':'Resultados',boxesAvailable?`${sequenceResult} Abre una de tus 3 cajas desde tu teléfono.`:sequenceResult,boxesAvailable?`CAJAS SORPRESA · RONDA ${completedGames}`:`RONDA ${completedGames}`,true);
    if(championId){sequenceActive=false;sequencePhase='champion';$('#sequenceStart').disabled=true;$('#sequencePause').disabled=true;$('#sequenceStop').disabled=true;$('#sequenceContinue').hidden=true;}
    else{
      // si alguien tiene cajas sorpresa, damos más tiempo para abrirlas antes del siguiente reto
      const boxesWaiting=devices().some(d=>(spinTokens[d.id]||0)>0);
      sequenceUntil=performance.now()+(boxesWaiting?RESULTS_WITH_BOXES_MS:RESULTS_MS);setRound(sequenceResult);
    }
  }
}
function spin(id, boxIndex=0) {
  if (running || championId || !(spinTokens[id] > 0) || pendingSabotage[id]) return;
  spinTokens[id]--;
  const actor = tacto.devices[id], others = devices().filter(d => d.id !== id);
  const draw = Math.random(), roll = draw < 0.25 ? 0 : draw < 0.30 ? 1 : 2;
  const result = roll === 0 && !others.length ? 2 : roll;
  animateBox(Math.max(0,Math.min(2,boxIndex)), result, actor?.name || 'Jugador');
  if (result === 0) {
    const targets = others.map(d => ({id:d.id,name:d.name}));
    pendingSabotage[id] = true; spinTargets[id] = targets;
    command(id, { spinAvailable:false, spinTokens:spinTokens[id], sabotagePending:true, sabotageTargets:targets,
      spinResult:'Muejeje, escoge un jugador al que sabotear' });
    $('#wheelStatus').textContent = `${actor?.name || 'Jugador'} obtuvo un sabotaje y elige objetivo en su teléfono.`;
  } else if (result === 1) {
    shields[id] = (shields[id] || 0) + 1;
    command(id, { spinAvailable:spinTokens[id] > 0, spinTokens:spinTokens[id], sabotagePending:false, spinResult:'Enhorabuena, estas salvado' });
    $('#wheelStatus').textContent = `${actor?.name || 'Jugador'} obtuvo un escudo.`;
  } else {
    command(id, { spinAvailable:spinTokens[id] > 0, spinTokens:spinTokens[id], sabotagePending:false, spinResult:"Nada, buena suerte c':" });
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
// ---------- Búfer de interpolación del giro (Torre en equilibrio) ----------
// Por la red, los datos de giro llegan a ráfagas (varios juntos y luego una pausa). Si el marcador
// sigue ese ritmo, da tirones. Solución típica de los juegos en red: cada dato trae la hora en que el
// sensor lo midió (m.t); guardamos los últimos datos y mostramos el movimiento con un pequeño retraso
// fijo, calculando los puntos intermedios entre dos mediciones. Así el movimiento sale continuo.
const MOTION_DELAY_MS = 120;   // retraso de reproducción: absorbe las ráfagas de la red
const motionBuf = {};          // id del jugador -> { samples: [{t, g}], off }
function recordMotion(d, m) {
  if (!Array.isArray(m?.a)) return;
  const t = Number(m.t), gamma = Number(m.a[2]);
  if (!Number.isFinite(t) || !Number.isFinite(gamma)) return;
  const b = (motionBuf[d.id] ||= { samples: [], off: null });
  const last = b.samples[b.samples.length - 1];
  if (last && t <= last.t) return; // dato repetido o que llegó desordenado
  // "off" = diferencia entre el reloj de la pantalla y el del celular (incluye el viaje por la red).
  // Nos quedamos con la menor (el mensaje que llegó más rápido) y la dejamos subir muy despacio
  // por si alguno de los relojes se ajusta.
  const off = Date.now() - t;
  b.off = b.off == null ? off : Math.min(off, b.off + 0.1);
  b.samples.push({ t, g: gamma });
  if (b.samples.length > 90) b.samples.shift();
}
function sampleGamma(id) { // giro γ del jugador en este instante, interpolado entre dos mediciones
  const b = motionBuf[id]; if (!b || !b.samples.length) return null;
  const s = b.samples, at = Date.now() - b.off - MOTION_DELAY_MS; // la "hora del celular" que vamos a mostrar
  if (at <= s[0].t) return s[0].g;
  for (let i = s.length - 1; i > 0; i--) {
    if (s[i - 1].t <= at) {
      if (at >= s[i].t) return s[i].g; // aún no llega un dato más nuevo: mantenemos el último
      const k = (at - s[i - 1].t) / (s[i].t - s[i - 1].t);
      return s[i - 1].g + (s[i].g - s[i - 1].g) * k;
    }
  }
  return s[s.length - 1].g;
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
// ---------- Carrera de toques: dibujo en la pantalla principal ----------
// Por cada jugador: nombre, "tacto: true/false" con los dedos apoyados en vivo,
// y una barra con el porcentaje de 0 % a 100 % (toques del jugador / 100).
let tapShown = {}, tapFlash = {}; // tapShown = avance que se DIBUJA (sigue suavemente al real); tapFlash = hora del último toque aceptado
function updateTapShown(dt) { // se llama en cada cuadro desde tick(): desliza la barra hacia el valor real
  for (const d of devices()) {
    const target = clamp((progress[d.id] || 0) / TAPS_TO_FINISH, 0, 1), shown = tapShown[d.id] ?? target;
    tapShown[d.id] = Math.abs(target - shown) < .001 ? target : shown + (target - shown) * (1 - Math.exp(-dt * 14));
  }
}
function drawTapRace(ds,w,h) {
  const now=performance.now();
  ctx.fillStyle='#f5f0e8';ctx.textAlign='center';ctx.font='bold 18px system-ui';ctx.fillText(`CARRERA DE TOQUES · EL PRIMERO EN LLEGAR A ${TAPS_TO_FINISH} GANA`,w/2,34);
  ctx.fillStyle='#b8b3c3';ctx.font='12px system-ui';ctx.fillText(running?'¡Toca tu teléfono lo más rápido que puedas! Cada dedo nuevo suma un toque':'Toca tu teléfono para probar que tu tacto llega · luego pulsa "Iniciar ronda"',w/2,55);
  const top=74,row=Math.min(84,(h-top-8)/ds.length),x0=24,barW=w-48,barH=Math.min(30,row*.42);
  ds.forEach((d,i)=>{
    const y=top+i*row,col=playerColor(d.id);
    const fingers=Math.max(0,Math.round(Number(d.ch['touch.n'])||0)),touching=fingers>0;
    const shown=tapShown[d.id]??0,pct=Math.round(shown*100);
    const flash=Math.max(0,1-(now-(tapFlash[d.id]||0))/220); // 1 justo al tocar → 0 en 220 ms
    // fila superior: nombre a la izquierda, estado del tacto a la derecha
    ctx.textAlign='left';ctx.fillStyle='#f5f0e8';ctx.font='bold 14px system-ui';ctx.fillText(d.name,x0,y+16);
    ctx.textAlign='right';ctx.font='bold 12px ui-monospace,monospace';
    ctx.fillStyle=touching?'#C6FF36':'#77748c';
    ctx.fillText(touching?`TACTO: TRUE · ${fingers} DEDO${fingers>1?'S':''}`:'TACTO: FALSE',w-x0,y+16);
    // barra de avance
    const by=y+24;
    ctx.fillStyle='#242438';ctx.fillRect(x0,by,barW,barH);
    ctx.fillStyle=col;ctx.fillRect(x0,by,barW*shown,barH);
    if(flash>0){ctx.fillStyle=`rgba(255,255,255,${.35*flash})`;ctx.fillRect(x0,by,barW*shown,barH);} // brillo con cada toque
    ctx.lineWidth=touching?2:1;ctx.strokeStyle=touching?'#C6FF36':'#515a69';ctx.strokeRect(x0,by,barW,barH);
    // porcentaje grande dentro de la barra
    ctx.textAlign='right';ctx.font=`bold ${Math.round(barH*.62)}px system-ui`;
    ctx.fillStyle=shown>.85?'#11111b':'#f5f0e8';ctx.fillText(`${pct}%`,x0+barW-10,by+barH*.72);
  });
}
function draw() {
  const w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);ctx.fillStyle='#11111b';ctx.fillRect(0,0,w,h);
  const ds=devices();
  if(!ds.length){ctx.fillStyle='#b8b3c3';ctx.textAlign='center';ctx.font='16px system-ui';ctx.fillText('Conecta un teléfono para comenzar',w/2,h/2);return;}
  if(mode==='tilt'){drawBalance(ds,w,h);return;}
  if(mode==='color'&&running&&colorCountdownUntil){
    const n=Math.max(1,Math.ceil((colorCountdownUntil-performance.now())/1000));
    ctx.fillStyle='#f5f0e8';ctx.textAlign='center';ctx.font='bold 18px system-ui';ctx.fillText('CAZA DE COLORES · ACTIVEN LA CÁMARA',w/2,34);
    ctx.fillStyle='#b8b3c3';ctx.font='12px system-ui';ctx.fillText(`Toca "Activar cámara" en tu teléfono · empieza en ${n} s`,w/2,55);
  }else if(mode==='color'){ctx.fillStyle='#f5f0e8';ctx.textAlign='center';ctx.font='bold 18px system-ui';ctx.fillText(`COLOR ${Math.max(1,colorIndex+1)}/5 · ${targetColor.name.toUpperCase()}`,w/2,34);ctx.fillStyle='#b8b3c3';ctx.font='12px system-ui';ctx.fillText(`El primero en encontrarlo suma · ${Math.max(0,5-(performance.now()-targetChanged)/1000).toFixed(1)} s`,w/2,55);}
  if(mode==='tap'){drawTapRace(ds,w,h);return;}
  if(mode==='voice'){drawVoice(ds,w,h);return;}
  const row=Math.min(68,(h-90)/ds.length),top=76;
  ds.forEach((d,i)=>{
    const y=top+i*row+row/2,col=playerColor(d.id);ctx.fillStyle='#242438';ctx.fillRect(24,y-11,w-48,22);ctx.strokeStyle='#515a69';ctx.strokeRect(24,y-11,w-48,22);
    let fraction=0,x=24;
    if(mode==='tap'){fraction=(progress[d.id]||0)/TAPS_TO_FINISH;ctx.fillStyle=col;ctx.fillRect(24,y-11,(w-48)*fraction,22);x=24+(w-48)*fraction;}
    else if(mode==='tilt'){fraction=clamp((progress[d.id]||0)/12,0,1);x=24+(w-48)*clamp(.5+(d.ch['ang.g']||0)/100,0,1);ctx.fillStyle='#26362a';ctx.fillRect(24+(w-48)*.5,y-11,Math.max(3,(w-48)*fraction),22);}
    else if(mode==='color'){fraction=clamp((progress[d.id]||0)/5,0,1);ctx.fillStyle=col;ctx.fillRect(24,y-11,(w-48)*fraction,22);x=24+(w-48)*fraction;}
    ctx.fillStyle=col;ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f5f0e8';ctx.textAlign='left';ctx.font='13px system-ui';ctx.fillText(d.name,28,y-17);
    if(mode==='tap'){ctx.fillStyle=col;ctx.textAlign='right';ctx.font='bold 12px system-ui';ctx.fillText(`${Math.round(clamp(fraction,0,1)*100)}%`,w-28,y-17);}
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
function voiceAccuracy(id) {
  const vals = voiceResults[id] || [];
  const valid = vals.filter(v => v !== null && Number.isFinite(v));
  const failed = vals.filter(v => v === Infinity).length;
  if (!valid.length && !failed) return '—';
  if (!valid.length && failed) return `${failed} fallido${failed > 1 ? 's' : ''}`;
  const avg = Math.round(valid.reduce((s, x) => s + x, 0) / valid.length);
  return `±${avg} cents${failed ? ` (${failed} fallido)` : ''}`;
}
function beginVoiceTurn() {
  if(!running||mode!=='voice')return;
  const turn=voiceChallenge.beginTurn(devices().map(d=>d.id));voiceResults=voiceChallenge.results;
  if(turn.type==='done'){finishVoiceRound();return;}
  const d=tacto.devices[turn.playerId];voiceCurrentId=turn.playerId;voiceSoundIndex=turn.soundIndex-1;voicePlayerIndex=voiceOrder.indexOf(turn.playerId);
  voiceWaiting=false;voiceListening=false;voiceSamples=[];voiceSingStart=0;
  voiceStage='sample';
  voiceSampleEnd=performance.now()+VOICE_CUE_SECONDS*1000+350;
  playVoiceSound(turn.sound);
  command(turn.playerId,{voiceTurn:{phase:'sample',soundIndex:turn.soundIndex,total:3}});
  for(const other of devices()) {
    if(other.id!==turn.playerId) command(other.id,{voiceTurn:{phase:'waiting',message:`${d?.name||'Jugador'} está escuchando la nota ${turn.soundIndex}/3.`}});
  }
  setRound(`${d?.name||'Jugador'}: escucha la nota ${turn.soundIndex}/3 en la pantalla; el micrófono está apagado.`);
}
function voiceReady(id,soundIndex) {
  if(!running||sequencePaused||mode!=='voice'||!voiceWaiting||voiceStage!=='userMic'||id!==voiceCurrentId)return;
  const singStart=performance.now(),turn=voiceChallenge.activateMicrophone(id,soundIndex,singStart);if(!turn)return;
  voiceWaiting=false;voiceListening=true;voiceStage='sing';voiceSingStart=singStart;voiceTurnEnd=singStart+VOICE_ATTEMPT_SECONDS*1000;
  command(id,{voiceTurn:{phase:'sing',soundIndex:turn.soundIndex,seconds:turn.seconds}});
  setRound(`${tacto.devices[id]?.name||'Jugador'}: imita la nota ${turn.soundIndex}/3 durante 3 segundos.`);
}
function recordVoiceSample(d,m) {
  if(!running||sequencePaused||mode!=='voice'||!voiceListening||d.id!==voiceCurrentId)return;
  if(voiceChallenge.addPitch(d.id,m.p,m.l))voiceSamples=voiceChallenge.centsSamples;
}
function finishVoiceTurn() {
  if(!voiceCurrentId)return;const id=voiceCurrentId,result=voiceChallenge.tick(performance.now());if(!result)return;voiceResults=voiceChallenge.results;progress[id]=result.soundIndex;
  const score=voiceResults[id][voiceSoundIndex],message=Number.isFinite(score)?`Intento ${voiceSoundIndex+1}/3 registrado · ${Math.round(score)} cents de desviación.`:`No se detectó una voz válida en el intento ${voiceSoundIndex+1}/3 (intento fallido).`;
  command(id,{voiceTurn:{phase:'waiting',message:'Turno terminado. Espera a que tu nombre vuelva a iluminarse.'}});
  voiceCurrentId=null;voiceWaiting=false;voiceListening=false;voiceSingStart=0;voiceStage='idle';voiceNextAt=performance.now()+VOICE_TURN_GAP;
  setRound(message);
  if(result.type==='done'){voiceNextAt=0;finishVoiceRound();}renderPlayers();
}
function skipVoiceTurn(message) {
  if(!voiceCurrentId)return;const id=voiceCurrentId;voiceChallenge.skipCurrent(id);voiceResults=voiceChallenge.results;progress[id]=voiceSoundIndex+1;
  command(id,{voiceTurn:{phase:'waiting',message:`${message} Espera a que vuelva a iluminarse tu nombre.`}});
  voiceCurrentId=null;voiceWaiting=false;voiceListening=false;voiceSingStart=0;voiceSampleEnd=0;voiceCommandRetryAt=0;voiceStage='idle';voiceNextAt=performance.now()+VOICE_TURN_GAP;
  setRound(`${message} Pasando al siguiente turno.`);
  if(!voiceChallenge.running){voiceNextAt=0;finishVoiceRound();}renderPlayers();
}
function cancelVoiceTurn(message='Partida terminada.') { for(const id of voiceOrder)command(id,{voiceTurn:{phase:'off',message}});voiceChallenge.reset();voiceCurrentId=null;voiceWaiting=false;voiceListening=false;voiceSingStart=0;voiceSampleEnd=0;voiceCommandRetryAt=0;voiceStage='idle';voiceNextAt=0;voiceCountdownUntil=0; }
function finishVoiceRound() {
  const result=voiceChallenge.summary();voiceResults=voiceChallenge.results;
  for(const id of voiceOrder)command(id,{voiceTurn:{phase:'off',message:'Las tres notas terminaron.'}});
  finishGame(result.winner,'promedio de tres notas');
}
function drawVoice(ds,w,h) {
  ctx.textAlign='center';ctx.fillStyle='#f5f0e8';ctx.font='bold 20px system-ui';ctx.fillText('Acierta el sonido · 3 sonidos únicos',w/2,34);
  const current=voiceCurrentId?tacto.devices[voiceCurrentId]:null;
    if(!running){ctx.fillStyle='#b8b3c3';ctx.font='14px system-ui';ctx.fillText('Inicia la partida para escuchar sonidos nuevos.',w/2,68);}
    else if(voiceStage==='countdown'){const n=Math.max(1,Math.ceil((voiceCountdownUntil-performance.now())/1000));ctx.fillStyle='#b8b3c3';ctx.font='bold 24px system-ui';ctx.fillText(`La primera nota suena en ${n}…`,w/2,78);}
  else if(current){ctx.fillStyle=playerColor(current.id);ctx.font='bold 17px system-ui';ctx.fillText(`${current.name} · nota ${voiceSoundIndex+1}/3`,w/2,72);let status='Preparando el turno…',fraction=0;
    if(voiceStage==='sample')status='Escucha la nota de muestra…';else if(voiceStage==='userMic')status=`${current.name}: activa el micrófono ahora · quedan ${Math.max(0,Math.ceil((voiceReadyDeadline-performance.now())/1000))} s`;else if(voiceListening){const left=Math.max(0,(voiceTurnEnd-performance.now())/1000),live=voiceSamples.length?Math.round(voiceSamples.reduce((sum,value)=>sum+value,0)/voiceSamples.length):null;status=`${current.name} canta · ${left.toFixed(1)} s${live==null?'':` · ±${live} cents`}`;fraction=1-left/VOICE_ATTEMPT_SECONDS;}
    ctx.fillStyle='#b8b3c3';ctx.font='14px system-ui';ctx.fillText(status,w/2,105);ctx.fillStyle='#42415b';ctx.fillRect(28,125,w-56,16);ctx.fillStyle=playerColor(current.id);ctx.fillRect(28,125,(w-56)*clamp(fraction,0,1),16);
  }else{ctx.fillStyle='#b8b3c3';ctx.font='14px system-ui';ctx.fillText('Preparando el siguiente turno…',w/2,76);}
  const top=170,row=Math.min(48,(h-top-8)/Math.max(1,ds.length));ds.forEach((d,i)=>{const y=top+i*row,ready=d.id===voiceCurrentId&&voiceStage==='userMic',singing=d.id===voiceCurrentId&&voiceListening,active=ready||singing,col=playerColor(d.id);if(active){ctx.fillStyle=ready?'#c6ff3624':'#ffffff12';ctx.fillRect(18,y-17,w-36,36);ctx.strokeStyle=ready?'#C6FF36':'#ffffff55';ctx.lineWidth=1;ctx.strokeRect(18,y-17,w-36,36);}ctx.fillStyle=col;ctx.textAlign='left';ctx.font=active?'bold 14px system-ui':'13px system-ui';ctx.fillText(`${d.name} · ${progress[d.id]||0}/3 turnos · ${voiceAccuracy(d.id)}`,28,y);if(active){ctx.textAlign='right';ctx.fillStyle=ready?'#C6FF36':'#f5f0e8';ctx.font='bold 11px system-ui';ctx.fillText(ready?'ACTIVA MICRÓFONO':'EN TURNO',w-28,y);}});
}
function finishByTime() {
  if(mode==='tilt') finishGame(pickWinner(d=>progress[d.id]||0),'tiempo');
  else if(mode==='color') finishGame(pickWinner(d=>progress[d.id]||0),'tiempo');
}
function tick(now) {
  const dt=Math.min(.05,(now-lastFrame)/1000);lastFrame=now;
  if(sequenceActive&&!sequencePaused&&sequencePhase==='results'&&now>=sequenceUntil){prepareSequenceGame();}
  if(sequenceActive&&!sequencePaused&&sequencePhase==='instructions'&&now>=sequenceUntil){sequencePhase='countdown';sequenceUntil=now+3000;showSequence('Prepárate','3','CUENTA REGRESIVA',false);}
  if(sequenceActive&&!sequencePaused&&sequencePhase==='countdown'){const n=Math.max(1,Math.ceil((sequenceUntil-now)/1000));$('#sequenceTitle').textContent=String(n);if(now>=sequenceUntil){hideSequence();if(!start())sequenceStartFailed();}}
  if(mode==='tap')updateTapShown(dt); // barras de la carrera: avance suave
  if(sequencePaused){draw();requestAnimationFrame(tick);return;}
  if(running&&roundEnd>0&&now>=roundEnd){finishByTime();}
  if(running&&mode==='tilt'){
    const elapsed=(now-roundStart)/1000,{center,width}=balanceZoneAt(elapsed);
    for(const d of devices()){
      const angle=sampleGamma(d.id); // giro interpolado (ver "Búfer de interpolación del giro")
      // Se acepta mientras hayan llegado datos de giro en los últimos 600 ms.
      if(angle!=null&&now-(d.seen?.motion||0)<600){
        const raw=clamp(.5+(angle-(balanceNeutral[d.id]??0))/90,0,1),prev=balanceX[d.id]??.5;
        // La interpolación ya da un movimiento continuo; este suavizado corto solo quita el temblor del sensor.
        const x=prev+(raw-prev)*(1-Math.exp(-dt*25));balanceX[d.id]=x;
        if(Math.abs(x-center)<=width/2)progress[d.id]=(progress[d.id]||0)+dt;
      }
    }
  }
  if(running&&mode==='color'&&colorCountdownUntil&&now>=colorCountdownUntil)beginColorHunt();
  if(running&&mode==='color'&&!colorCountdownUntil){
    const expired=colorHunt.tick(now);
    if(expired){progress={...expired.scores};if(expired.done){setRound('Terminó la búsqueda del quinto color.');finishGame(expired.winner,'caza de cinco colores');}
      else{colorIndex=expired.current.index;targetColor=expired.current.color;targetChanged=colorHunt.startedAt;for(const d of devices())command(d.id,{colorTarget:{name:targetColor.name}});setRound(`Se agotaron 5 segundos · ahora busca ${targetColor.name} (${colorIndex+1}/5)`);}}
  }
  if(running&&mode==='voice'){
    if(voiceStage==='countdown'&&now>=voiceCountdownUntil){voiceStage='idle';voiceCountdownUntil=0;beginVoiceTurn();}
    else if(voiceStage!=='countdown'){
      if(voiceCurrentId&&voiceStage==='sample'&&now>=voiceSampleEnd){
        voiceChallenge.sampleFinished();
        voiceStage='userMic';
        voiceWaiting=true;
        voiceReadyDeadline=now+VOICE_PERMISSION_TIMEOUT;
        command(voiceCurrentId,{voiceTurn:{phase:'ready',soundIndex:voiceSoundIndex+1,seconds:VOICE_ATTEMPT_SECONDS}});
        setRound(`${tacto.devices[voiceCurrentId]?.name||'Jugador'}: activa el micrófono en tu teléfono para cantar.`);
      }
      if(voiceWaiting&&now>=voiceReadyDeadline){
        skipVoiceTurn('No se activó el micrófono a tiempo; intento fallido.');
      }
      if(voiceListening&&now>=voiceTurnEnd)finishVoiceTurn();
      if(running&&!voiceCurrentId&&voiceNextAt&&now>=voiceNextAt){voiceNextAt=0;beginVoiceTurn();}
    }
  }
  draw();
  // Paneles HTML: se redibujan solo si hay datos nuevos (máx. ~6 veces/s) y, por si acaso, al menos 1 vez por segundo.
  // Durante un minijuego, máximo 2 veces por segundo, para que la animación del escenario no dé tirones.
  const hudEvery=running?500:150;
  if((hudDirty&&now-lastHud>hudEvery)||now-lastHud>1000){lastHud=now;renderPlayers();}
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
$('#mode').value=mode;instructions();
(async()=>{
  tacto=new Tacto();updateRoomFromURL();
  tacto.on('estado',s=>{$('#connection').textContent=s;$('#connection').className='pill '+(s==='conectado'?'on':'');$('#connectionDuplicate').textContent=s;$('#coverStatus').textContent=s==='conectado'?'Sala conectada · lista para jugar':s==='reconectando'?'Reconectando con Tacto…':'Sin conexión con Tacto';$('#coverLed').classList.toggle('on',s==='conectado');});
  tacto.on('datos',onData);
  tacto.on('dispositivo',d=>{
    hudDirty=true;
    // Respondemos solo al teléfono que avisó su estado (antes se escribía a TODOS cada vez).
    if(!d){updateAllSpinStates();return;}
    if(d.online)spinState(d);
    if(d.online&&running&&mode==='color'){
      if(colorCountdownUntil)command(d.id,{camRequest:true});
      else command(d.id,{colorTarget:{name:targetColor.name}});
    }
    if(d.id===voiceCurrentId&&!d.online)skipVoiceTurn('Jugador desconectado; se salta este intento.');
  });
  // dirección de red real del servidor, para armar el enlace y el QR de los teléfonos
  fetch('info',{cache:'no-store'}).then(r=>r.json()).then(i=>{if(i&&i.baseUrl){infoBase=i.baseUrl;showRoom();}}).catch(()=>{});
  tacto.on('rtt',d=>{const a=d.rtt.slice().sort((x,y)=>x-y);$('#latency').textContent=a.length?`Latencia ${Math.round(a[Math.floor(a.length/2)])} ms`:'';});
  tacto.on('error',e=>$('#notice').textContent=e.message||'Error de conexión');
  try{await tacto.connect();$('#notice').textContent='Conectado al broker MQTT de Tacto.';updateAllSpinStates();}
  catch(e){$('#notice').textContent='No se pudo conectar al broker: '+(e.message||e);$('#coverStatus').textContent='No se pudo conectar con Tacto';$('#coverLed').classList.remove('on');}
  $('#wheelStatus').textContent=`Cada jugador recibe una caja cada ${SPIN_EVERY} juegos.`;renderPlayers();
})();
