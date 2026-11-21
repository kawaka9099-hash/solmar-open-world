// Solmar sound: every effect and the music loop are synthesized with
// WebAudio — no audio files. All calls are safe before init and after any
// failure: a headless browser or a muted tab just plays nothing.

const NOTE_FREQ = {
  A1: 55, B1: 61.74, C2: 65.41, D2: 73.42, E2: 82.41, F2: 87.31, G2: 98,
  A2: 110, C3: 130.81, D3: 146.83, E3: 164.81, G3: 196, A3: 220, C4: 261.63,
  E4: 329.63, G4: 392, A4: 440,
};

// 32-step bass line (two bars, A minor), null = rest.
const BASS_LINE = [
  'A1', null, 'A1', null, 'C2', null, 'A1', null,
  'E2', null, 'D2', null, 'C2', null, 'B1', null,
  'A1', null, 'A1', null, 'C2', null, 'E2', null,
  'G2', null, 'E2', null, 'D2', null, 'C2', 'B1',
];
// Sparse lead plucks on the second bar.
const LEAD_LINE = [
  null, null, null, null, null, null, null, null,
  null, null, null, null, null, null, null, null,
  'A3', null, 'C4', null, 'E4', null, 'C4', null,
  'A3', null, 'G3', null, 'E3', null, 'D3', null,
];

export class SolmarAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.noiseBuffer = null;
    this.musicOn = true;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenLfo = null;
    this.musicTimer = null;
    this.nextStep = 0;
    this.stepIndex = 0;
    this.bpm = 104;
  }

  // Must be called from a user gesture (the start button). Safe to call twice.
  init() {
    if (this.ctx) {
      this.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.32;
      this.musicBus.connect(this.master);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.9;
      this.sfxBus.connect(this.master);
      // One second of white noise, reused by every noise-based sound.
      const len = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.startEngine();
      this.startSiren();
      this.startMusic();
    } catch {
      this.ctx = null;
    }
  }

  resume() {
    try {
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    } catch { /* muted is fine */ }
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.musicBus) this.musicBus.gain.value = on ? 0.32 : 0;
  }

  // ---- primitives -------------------------------------------------------

  tone(freq, dur, type, vol, when = 0, slideTo = null) {
    if (!this.ctx) return;
    try {
      const t0 = this.ctx.currentTime + when;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(this.sfxBus);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch { /* ignore */ }
  }

  noise(dur, vol, filterFreq, when = 0, type = 'lowpass') {
    if (!this.ctx) return;
    try {
      const t0 = this.ctx.currentTime + when;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = filterFreq;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxBus);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    } catch { /* ignore */ }
  }

  // ---- one-shots ----------------------------------------------------------

  shot() {
    this.noise(0.14, 0.7, 1800, 0, 'highpass');
    this.tone(160, 0.12, 'square', 0.28, 0, 55);
  }

  punch() {
    this.noise(0.09, 0.5, 500);
    this.tone(120, 0.09, 'sine', 0.4, 0, 60);
  }

  crash(strength) {
    const v = Math.min(1, 0.25 + strength * 0.6);
    this.noise(0.3, v, 700);
    this.tone(90, 0.22, 'sine', 0.5 * v, 0, 40);
  }

  pickup() {
    this.tone(660, 0.09, 'sine', 0.3);
    this.tone(990, 0.14, 'sine', 0.3, 0.08);
  }

  coin() {
    this.tone(880, 0.08, 'triangle', 0.3);
    this.tone(1320, 0.18, 'triangle', 0.28, 0.07);
  }

  click() {
    this.tone(1200, 0.04, 'square', 0.12);
  }

  explosion() {
    this.noise(0.9, 0.9, 400);
    this.tone(70, 0.8, 'sine', 0.7, 0, 28);
    this.noise(0.4, 0.5, 2500, 0.05, 'highpass');
  }

  missionPass() {
    const notes = ['A3', 'C4', 'E4', 'A4'];
    notes.forEach((n, i) => this.tone(NOTE_FREQ[n], 0.22, 'triangle', 0.3, i * 0.11));
  }

  missionFail() {
    this.tone(NOTE_FREQ.E3, 0.3, 'sawtooth', 0.22, 0, NOTE_FREQ.C3);
    this.tone(NOTE_FREQ.C3, 0.45, 'sawtooth', 0.22, 0.22, NOTE_FREQ.A2);
  }

  busted() {
    this.tone(520, 0.16, 'square', 0.25);
    this.tone(392, 0.3, 'square', 0.25, 0.16);
  }

  wasted() {
    [NOTE_FREQ.A2, NOTE_FREQ.F2, NOTE_FREQ.D2, NOTE_FREQ.A1].forEach((f, i) =>
      this.tone(f, 0.4, 'sawtooth', 0.22, i * 0.28));
  }

  // ---- continuous sounds ---------------------------------------------------

  startEngine() {
    try {
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 420;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.sfxBus);
      this.engineOsc.start();
    } catch { /* ignore */ }
  }

  // speed01: 0..1 of the car's top speed. Call every frame while driving.
  setEngine(on, speed01) {
    if (!this.ctx || !this.engineGain || !this.engineOsc) return;
    try {
      const t = this.ctx.currentTime;
      this.engineGain.gain.setTargetAtTime(on ? 0.045 + speed01 * 0.05 : 0, t, 0.08);
      this.engineOsc.frequency.setTargetAtTime(52 + speed01 * 165, t, 0.06);
      this.engineFilter.frequency.setTargetAtTime(380 + speed01 * 900, t, 0.1);
    } catch { /* ignore */ }
  }

  startSiren() {
    try {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.value = 820;
      this.sirenLfo = this.ctx.createOscillator();
      this.sirenLfo.type = 'square';
      this.sirenLfo.frequency.value = 0.85;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 130;
      this.sirenLfo.connect(lfoGain);
      lfoGain.connect(this.sirenOsc.frequency);
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.sfxBus);
      this.sirenOsc.start();
      this.sirenLfo.start();
    } catch { /* ignore */ }
  }

  setSiren(on) {
    if (!this.ctx || !this.sirenGain) return;
    try {
      this.sirenGain.gain.setTargetAtTime(on ? 0.05 : 0, this.ctx.currentTime, 0.2);
    } catch { /* ignore */ }
  }

  // ---- procedural music ----------------------------------------------------

  startMusic() {
    if (this.musicTimer !== null) return;
    this.nextStep = this.ctx.currentTime + 0.1;
    this.stepIndex = 0;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 40);
  }

  scheduleMusic() {
    if (!this.ctx) return;
    const stepDur = 60 / this.bpm / 4;
    while (this.nextStep < this.ctx.currentTime + 0.18) {
      const i = this.stepIndex % 32;
      const when = this.nextStep - this.ctx.currentTime;
      this.playStep(i, when, stepDur);
      this.nextStep += stepDur;
      this.stepIndex++;
    }
  }

  playStep(i, when, stepDur) {
    if (!this.musicOn) return;
    try {
      const t0 = this.ctx.currentTime + Math.max(0, when);
      // Kick on the beat.
      if (i % 4 === 0) this.musicTone(120, 0.16, 'sine', 0.5, t0, 42);
      // Hat on the off-beats.
      if (i % 4 === 2) this.musicNoise(0.05, 0.12, 7000, t0);
      // Snare-ish noise on 2 and 4 of each bar.
      if (i % 16 === 4 || i % 16 === 12) this.musicNoise(0.12, 0.18, 1800, t0);
      // Bass line.
      const bass = BASS_LINE[i];
      if (bass) this.musicTone(NOTE_FREQ[bass], stepDur * 1.8, 'triangle', 0.34, t0);
      // Lead pluck.
      const lead = LEAD_LINE[i];
      if (lead) this.musicTone(NOTE_FREQ[lead], 0.22, 'square', 0.07, t0);
    } catch { /* ignore */ }
  }

  musicTone(freq, dur, type, vol, t0, slideTo = null) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(this.musicBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  musicNoise(dur, vol, filterFreq, t0) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }
}
