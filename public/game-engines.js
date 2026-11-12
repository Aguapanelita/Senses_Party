/* Reglas aisladas de los minijuegos SENSES PARTY.
 * No dependen del DOM ni de MQTT para poder verificarse antes de conectarlas.
 */
(function (root) {
  'use strict';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const shuffled = (items, random = Math.random) => {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };

  class TapRace {
    constructor(target = 100) { this.target = target; this.reset(); }
    reset() { this.running = false; this.progress = Object.create(null); this.events = new Set(); this.winner = null; }
    start(playerIds) {
      this.reset();
      for (const id of playerIds) this.progress[id] = 0;
      this.running = Object.keys(this.progress).length > 0;
      return this.snapshot();
    }
    tap(playerId, eventId, fingers = 1) {
      if (!this.running || !(playerId in this.progress) || !eventId) return { accepted: false, reason: 'inactive' };
      const key = `${playerId}:${eventId}`;
      if (this.events.has(key)) return { accepted: false, reason: 'duplicate' };
      this.events.add(key);
      const count = clamp(Math.floor(Number(fingers) || 1), 1, 3);
      this.progress[playerId] = Math.min(this.target, this.progress[playerId] + count);
      if (this.progress[playerId] >= this.target) { this.running = false; this.winner = playerId; }
      return { accepted: true, progress: this.progress[playerId], percent: Math.round(this.progress[playerId] / this.target * 100), winner: this.winner };
    }
    snapshot() { return { running: this.running, target: this.target, progress: { ...this.progress }, winner: this.winner }; }
  }

  const TARGET_COLORS = [
    { name: 'rojo', hue: 0, tolerance: 28 }, { name: 'naranja', hue: 28, tolerance: 22 },
    { name: 'amarillo', hue: 54, tolerance: 24 }, { name: 'verde claro', hue: 95, tolerance: 32 },
    { name: 'verde', hue: 132, tolerance: 44 }, { name: 'turquesa', hue: 174, tolerance: 24 },
    { name: 'cian', hue: 195, tolerance: 22 }, { name: 'azul', hue: 222, tolerance: 28 },
    { name: 'violeta', hue: 270, tolerance: 26 }, { name: 'magenta', hue: 315, tolerance: 28 },
  ];

  class ColorHunt {
    constructor(colors = TARGET_COLORS, limit = 5, seconds = 5) { this.colors = colors; this.limit = limit; this.seconds = seconds; this.cooldownMs = 350; this.reset(); }
    reset() { this.running = false; this.players = []; this.sequence = []; this.index = -1; this.scores = Object.create(null); this.startedAt = 0; this.winner = null; }
    start(playerIds, now = 0, random = Math.random) {
      this.reset(); this.players = playerIds.slice();
      for (const id of this.players) this.scores[id] = 0;
      this.sequence = shuffled(this.colors, random).slice(0, this.limit);
      this.running = this.players.length > 0 && this.sequence.length > 0;
      this.index = this.running ? 0 : -1; this.startedAt = now;
      return this.current();
    }
    current() { return this.running ? { index: this.index, total: this.sequence.length, color: this.sequence[this.index], scores: { ...this.scores } } : null; }
    matches(sample, color) {
      const hue = Number(sample?.h), saturation = Number(sample?.s);
      if (!Number.isFinite(hue) || !Number.isFinite(saturation) || saturation < 0.18) return false;
      const distance = Math.abs(((hue - color.hue + 540) % 360) - 180);
      return distance <= color.tolerance;
    }
    advance(now) {
      this.index++; this.startedAt = now;
      if (this.index >= this.sequence.length) {
        this.running = false;
        const ranked = this.players.map(id => ({ id, score: this.scores[id] })).sort((a, b) => b.score - a.score);
        this.winner = ranked.length && ranked[0].score > 0 && (!ranked[1] || ranked[0].score !== ranked[1].score) ? ranked[0].id : null;
        return { done: true, winner: this.winner, scores: { ...this.scores } };
      }
      return { done: false, current: this.current() };
    }
    sample(playerId, values, now) {
      if (!this.running || !(playerId in this.scores) || now - this.startedAt < this.cooldownMs || now - this.startedAt >= this.seconds * 1000) return { accepted: false };
      const color = this.sequence[this.index];
      if (!this.matches(values, color)) return { accepted: false };
      this.scores[playerId]++;
      return { accepted: true, foundBy: playerId, color, ...this.advance(now) };
    }
    tick(now) {
      if (!this.running || now - this.startedAt < this.seconds * 1000) return null;
      return { expired: true, color: this.sequence[this.index], ...this.advance(now) };
    }
  }

  class NoteChallenge {
    constructor(attemptSeconds = 3) { this.attemptMs = attemptSeconds * 1000; this.reset(); }
    reset() {
      this.running = false; this.players = []; this.sounds = []; this.results = Object.create(null);
      this.soundIndex = 0; this.playerIndex = 0; this.currentId = null; this.phase = 'idle';
      this.deadline = 0; this.centsSamples = [];
    }
    start(playerIds, sounds) {
      this.reset(); this.players = playerIds.slice(); this.sounds = sounds.slice();
      for (const id of this.players) this.results[id] = Array(this.sounds.length).fill(null);
      this.running = this.players.length > 0 && this.sounds.length > 0;
      return this.running;
    }
    beginTurn(onlineIds = this.players) {
      if (!this.running) return { type: 'done', ...this.summary() };
      while (this.running && this.playerIndex < this.players.length && !onlineIds.includes(this.players[this.playerIndex])) {
        this.results[this.players[this.playerIndex]][this.soundIndex] = Infinity;
        this.advanceCursor();
      }
      if (!this.running) return { type: 'done', ...this.summary() };
      this.currentId = this.players[this.playerIndex]; this.phase = 'awaiting-sample'; this.centsSamples = [];
      return { type: 'request-sample', playerId: this.currentId, soundIndex: this.soundIndex + 1,
        soundKey: this.sounds[this.soundIndex].seed, sound: this.sounds[this.soundIndex] };
    }
    acknowledgeSample(playerId, soundKey) {
      if (!this.running || this.phase !== 'awaiting-sample' || playerId !== this.currentId || soundKey !== this.sounds[this.soundIndex].seed) return null;
      this.phase = 'sample-playing';
      return { type: 'play-host-sample', playerId, soundIndex: this.soundIndex + 1, sound: this.sounds[this.soundIndex] };
    }
    sampleFinished() {
      if (!this.running || this.phase !== 'sample-playing') return null;
      this.phase = 'ready';
      return { type: 'enable-microphone', playerId: this.currentId, soundIndex: this.soundIndex + 1, seconds: this.attemptMs / 1000 };
    }
    activateMicrophone(playerId, soundIndex, now) {
      if (!this.running || this.phase !== 'ready' || playerId !== this.currentId || Number(soundIndex) !== this.soundIndex + 1) return null;
      this.phase = 'singing'; this.deadline = now + this.attemptMs; this.centsSamples = [];
      return { type: 'sing', playerId, soundIndex: this.soundIndex + 1, seconds: this.attemptMs / 1000 };
    }
    addPitch(playerId, pitchHz, level) {
      if (!this.running || this.phase !== 'singing' || playerId !== this.currentId) return false;
      const hz = Number(pitchHz), loudness = Number(level), targetHz = Number(this.sounds[this.soundIndex].hz);
      if (!Number.isFinite(hz) || hz < 65 || hz > 900 || !Number.isFinite(loudness) || loudness < 0.025 || !(targetHz > 0)) return false;
      this.centsSamples.push(Math.abs(1200 * Math.log2(hz / targetHz)));
      return true;
    }
    tick(now) {
      if (!this.running || this.phase !== 'singing' || now < this.deadline) return null;
      const id = this.currentId, completedSoundIndex = this.soundIndex, values = this.centsSamples;
      const score = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Infinity;
      this.results[id][this.soundIndex] = score;
      this.advanceCursor();
      return { type: this.running ? 'turn-finished' : 'done', playerId: id, soundIndex: completedSoundIndex + 1,
        score, summary: this.running ? null : this.summary() };
    }
    skipCurrent(playerId) {
      if (!this.running || playerId !== this.currentId) return false;
      this.results[playerId][this.soundIndex] = Infinity; this.advanceCursor(); return true;
    }
    advanceCursor() {
      this.currentId = null; this.phase = 'between-turns'; this.deadline = 0; this.centsSamples = [];
      this.playerIndex++;
      if (this.playerIndex >= this.players.length) { this.playerIndex = 0; this.soundIndex++; }
      if (this.soundIndex >= this.sounds.length) { this.running = false; this.phase = 'done'; }
    }
    summary() {
      const ranked = this.players.map(id => {
        const values = this.results[id] || [];
        const score = values.length === this.sounds.length && values.every(Number.isFinite)
          ? values.reduce((sum, value) => sum + value, 0) / values.length : Infinity;
        return { id, score };
      }).sort((a, b) => a.score - b.score);
      const winner = ranked.length && Number.isFinite(ranked[0].score) && (!ranked[1] || !Number.isFinite(ranked[1].score) || Math.abs(ranked[0].score - ranked[1].score) >= 3) ? ranked[0].id : null;
      return { results: Object.fromEntries(this.players.map(id => [id, this.results[id].slice()])), ranked, winner };
    }
  }

  root.SensesGameEngines = Object.freeze({ TapRace, ColorHunt, NoteChallenge, TARGET_COLORS });
})(window);
