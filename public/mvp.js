'use strict';
const $ = s => document.querySelector(s);
const canvas = $('#stage'), ctx = canvas.getContext('2d');
const COLORS = ['#a9ed75', '#839bff', '#ffb86e', '#f48bd0', '#73d7de', '#d6a5ff'];
let tacto, room = '', mode = 'tap', running = false, roundEnd = 0, winner = '';
let scores = {}, progress = {}, lastTouch = {}, balance = {}, roundTimer = 0;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = v => v == null ? '—' : Number(v).toFixed(2);
function size() {
  const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
  canvas.width = r.width * d; canvas.height = r.height * d;
  ctx.setTransform(d, 0, 0, d, 0, 0);
}
addEventListener('resize', size); size();
function devices() { return tacto ? Object.values(tacto.devices).filter(d => d.online) : []; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function onData(d, kind) {
  if (kind === 'touch') {
    const down = (d.ch['touch.down'] || 0) > 0, was = lastTouch[d.id] || false;
    if (mode === 'tap' && running && down && !was) {
      progress[d.id] = clamp((progress[d.id] || 0) + .08, 0, 1);
      if (progress[d.id] >= 1) award(d);
    }
    lastTouch[d.id] = down;
  }
  renderPlayers();
}
function renderPlayers() {
  const all = Object.values(tacto?.devices || {}), online = all.filter(d => d.online);
  $('#players').innerHTML = all.length ? all.map(d => {
    const c = d.ch || {}, idx = online.indexOf(d), color = COLORS[(idx < 0 ? 0 : idx) % COLORS.length];
    scores[d.id] ??= 0;
    return `<article class="player ${d.online ? '' : 'off'}"><h3><span style="color:${color}">● ${esc(d.name)}</span><span>${scores[d.id]} pts</span></h3><div class="values"><span>Tacto X <b>${fmt(c['touch.x'])}</b></span><span>Tacto Y <b>${fmt(c['touch.y'])}</b></span><span>Dedos <b>${fmt(c['touch.n'])}</b></span><span>Giro γ <b>${fmt(c['ang.g'])}°</b></span><span>Giro β <b>${fmt(c['ang.b'])}°</b></span><span>Aceleración X <b>${fmt(c['acc.x'])}</b></span></div></article>`;
  }).join('') : '<p class="tiny">Esperando teléfonos…</p>';
  $('#scoreboard').innerHTML = online.length ? online.map((d, i) => `<div style="padding:4px;color:${COLORS[i % COLORS.length]}">${esc(d.name)} · ${scores[d.id] || 0} puntos</div>`).join('') : 'Sin jugadores conectados';
  draw();
}
function award(d) {
  if (!running) return;
  winner = d.name; scores[d.id] = (scores[d.id] || 0) + 1; running = false;
  clearTimeout(roundTimer); $('#round').textContent = `Ganó ${winner}`; renderPlayers();
}
function start() {
  winner = ''; progress = {}; balance = {}; lastTouch = {}; running = true;
  roundEnd = performance.now() + 30000; clearTimeout(roundTimer);
  $('#round').textContent = 'Ronda en curso · 30 s';
  roundTimer = setTimeout(() => { running = false; $('#round').textContent = 'Ronda terminada'; draw(); }, 30000);
  draw();
}
function resetScores() { scores = {}; renderPlayers(); }
$('#start').onclick = start; $('#reset').onclick = resetScores;
$('#mode').onchange = e => {
  mode = e.target.value;
  $('#instructions').textContent = mode === 'tap'
    ? 'Cada toque suma avance. Al llegar a la meta, el jugador obtiene un punto.'
    : 'Inclina el teléfono a los lados para mover la barra. Mantén el indicador dentro de la zona central para sumar puntos.';
  progress = {}; balance = {}; draw();
};
$('#newRoom').onclick = () => {
  room = tacto.cambiarSala(Tacto.nuevaSala()); scores = {}; progress = {}; showRoom(); renderPlayers();
};
function showRoom() {
  $('#room').textContent = `Sala ${room}`;
  const base = new URL('.', location.href);
  const url = new URL('phone.html', base); url.searchParams.set('sala', room);
  $('#phoneUrl').textContent = url.href;
  $('#qr').hidden = true;
}
function draw() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#101319'; ctx.fillRect(0, 0, w, h);
  const ds = devices(), now = performance.now();
  if (!ds.length) {
    ctx.fillStyle = '#a9afbb'; ctx.textAlign = 'center'; ctx.font = '16px system-ui';
    ctx.fillText('Conecta un teléfono para comenzar', w / 2, h / 2); return;
  }
  const row = Math.min(68, (h - 20) / ds.length), top = 10;
  ds.forEach((d, i) => {
    const y = top + i * row + row / 2, col = COLORS[i % COLORS.length], p = progress[d.id] || 0;
    ctx.fillStyle = '#242934'; ctx.fillRect(24, y - 11, w - 48, 22);
    ctx.strokeStyle = '#515a69'; ctx.strokeRect(24, y - 11, w - 48, 22);
    let x;
    if (mode === 'tap') {
      ctx.fillStyle = col; ctx.fillRect(24, y - 11, (w - 48) * p, 22); x = 24 + (w - 48) * p;
    } else {
      const raw = d.ch['ang.g'], t = raw == null ? .5 : clamp(.5 + raw / 90, 0, 1);
      x = 24 + (w - 48) * t;
      ctx.fillStyle = '#26362a'; ctx.fillRect(24 + (w - 48) * .43, y - 11, (w - 48) * .14, 22);
    }
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f3f5f8'; ctx.textAlign = 'left'; ctx.font = '13px system-ui'; ctx.fillText(d.name, 28, y - 18);
  });
  if (running) $('#round').textContent = mode === 'tap' ? 'Ronda en curso' : `Equilibrio · ${Math.max(0, Math.ceil((roundEnd - now) / 1000))} s`;
}
let lastFrame = performance.now();
function tick(now) {
  const dt = Math.min(.05, (now - lastFrame) / 1000); lastFrame = now;
  if (running && now >= roundEnd) { running = false; $('#round').textContent = 'Ronda terminada'; }
  if (running && mode === 'tilt') {
    for (const d of devices()) {
      const angle = d.ch['ang.g'];
      balance[d.id] = angle != null && Math.abs(angle) < 8 ? (balance[d.id] || 0) + dt : 0;
      if (balance[d.id] >= 5) { scores[d.id] = (scores[d.id] || 0) + 1; balance[d.id] = 0; renderPlayers(); }
    }
  }
  draw(); requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
function updateRoomFromURL() {
  const q = new URLSearchParams(location.search).get('sala');
  if (q && q.length >= 4) tacto.cambiarSala(q);
  room = tacto.sala; showRoom();
}
(async () => {
  tacto = new Tacto(); updateRoomFromURL();
  tacto.on('estado', s => { $('#connection').textContent = s; $('#connection').className = 'pill ' + (s === 'conectado' ? 'on' : ''); });
  tacto.on('datos', onData); tacto.on('dispositivo', renderPlayers);
  tacto.on('rtt', d => { const a = d.rtt.slice().sort((x, y) => x - y); $('#latency').textContent = a.length ? `Latencia ${Math.round(a[Math.floor(a.length / 2)])} ms` : ''; });
  tacto.on('error', e => $('#notice').textContent = e.message || 'Error de conexión');
  try { await tacto.connect(); $('#notice').textContent = 'Conectado al broker MQTT de Tacto.'; }
  catch (e) { $('#notice').textContent = 'No se pudo conectar al broker: ' + (e.message || e); }
  renderPlayers();
})();
