// Solmar — game/src/audio.js
// Procedural WebAudio sound: everything is synthesised in code, no audio
// files. Call ensure() from a user gesture (click / key press) first;
// browsers block AudioContext creation before interaction.
//
// API:
//   const sfx = new SoundEngine();
//   sfx.ensure();                 // create/resume the context
//   sfx.setEngine(rpm01, load01)  // continuous engine hum while driving
//   sfx.gunshot(); sfx.siren(on); sfx.pickup(); sfx.click();
//   sfx.footstep(); sfx.crash(intensity); sfx.reload();
//   sfx.setMusic(true/false); sfx.setMuted(true/false);
//   sfx.update(dt)                // call every frame (siren + music clock)

import { CONFIG } from './config.js';

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.engineOsc = null;
    this.engineOsc2 = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenOn = false;
    this.sirenPhase = 0;
    this.muted = false;
    this.musicOn = false;
    this.musicTimer = 0;
    this.musicStep = 0;
    // A slow, sunny chord loop: Am — F — C — G, one soft pad per bar.
    this.musicChords = [
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 261.63],
      [196.0, 246.94, 329.63],
      [164.81, 196.0, 246.94],
    ];
    this.musicBass = [110.0, 87.31, 130.81, 98.0];
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : CONFIG.audio.masterVolume;
    this.master.connect(this.ctx.destination);

    // Engine: two detuned sawtooth oscillators through a low-pass filter.
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'sawtooth';
    this.engineOsc2.frequency.value = 55.7;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
    this.engineOsc2.start();

    // Siren: a sine oscillator whose pitch we sweep in update().
    this.sirenOsc = this.ctx.createOscillator();
    this.sirenOsc.type = 'sine';
    this.sirenOsc.frequency.value = 700;
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.master);
    this.sirenOsc.start();

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = CONFIG.audio.musicVolume;
    this.musicGain.connect(this.master);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : CONFIG.audio.masterVolume;
  }

  // rpm01: 0..1 engine speed, load01: 0..1 throttle. Call every frame.
  setEngine(rpm01, load01) {
    if (!this.ctx) return;
    const rpm = Math.max(0, Math.min(1, rpm01));
    const target = load01 > 0.02 ? CONFIG.audio.engineVolume * (0.35 + 0.65 * rpm) : 0.0;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(target, t, 0.08);
    this.engineOsc.frequency.setTargetAtTime(48 + rpm * 130, t, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(48.6 + rpm * 131, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(320 + rpm * 900 + load01 * 500, t, 0.08);
  }

  siren(on) {
    this.sirenOn = on;
    if (!this.ctx) return;
    this.sirenGain.gain.setTargetAtTime(
      on ? CONFIG.audio.sirenVolume : 0,
      this.ctx.currentTime,
      0.15,
    );
  }

  setMusic(on) {
    this.musicOn = on;
    this.musicStep = 0;
    this.musicTimer = 0;
  }

  update(dt) {
    if (!this.ctx) return;
    // Siren wail: alternate 660 / 880 Hz every 0.45 s.
    if (this.sirenOn) {
      this.sirenPhase += dt;
      const hi = Math.floor(this.sirenPhase / 0.45) % 2 === 0;
      this.sirenOsc.frequency.setTargetAtTime(
        hi ? 880 : 660,
        this.ctx.currentTime,
        0.06,
      );
    }
    // Music: one soft pad chord per 2.4 s bar, plus a low bass note.
    if (this.musicOn) {
      this.musicTimer -= dt;
      if (this.musicTimer <= 0) {
        this.musicTimer = 2.4;
        const chord = this.musicChords[this.musicStep % this.musicChords.length];
        const bass = this.musicBass[this.musicStep % this.musicBass.length];
        this.musicStep += 1;
        const t0 = this.ctx.currentTime + 0.02;
        for (const f of chord) this._padNote(f, t0, 2.4, 0.05);
        this._padNote(bass, t0, 2.4, 0.09);
        // A light tick on the beat, like a soft hi-hat.
        this._tick(t0 + 0.6);
        this._tick(t0 + 1.8);
      }
    }
  }

  _padNote(freq, t0, dur, vol) {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.4);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    o.connect(g);
    g.connect(this.musicGain);
    o.start(t0);
    o.stop(t0 + dur + 0.1);
  }

  _tick(t0) {
    const len = 0.05;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    src.connect(f);
    f.connect(g);
    g.connect(this.musicGain);
    src.start(t0);
  }

  // One-shot effects -------------------------------------------------------

  _noiseBurst(dur, filterFreq, vol, type = 'lowpass') {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0);
  }

  _tone(freq, dur, vol, type = 'sine', slideTo = null) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo !== null) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  gunshot() {
    this._noiseBurst(0.14, 1800, 0.5);
    this._tone(140, 0.09, 0.35, 'square', 60);
  }

  punch() {
    this._noiseBurst(0.08, 500, 0.4);
  }

  footstep() {
    this._noiseBurst(0.05, 300, 0.12);
  }

  crash(intensity) {
    this._noiseBurst(0.25, 700, Math.min(0.7, 0.2 + intensity * 0.5));
    this._tone(90, 0.2, 0.3, 'sawtooth', 40);
  }

  pickup() {
    this._tone(880, 0.09, 0.22, 'sine');
    setTimeout(() => this._tone(1318, 0.14, 0.22, 'sine'), 90);
  }

  click() {
    this._tone(1200, 0.04, 0.15, 'square');
  }

  reload() {
    this._tone(500, 0.05, 0.2, 'square');
    setTimeout(() => this._tone(700, 0.05, 0.2, 'square'), 140);
  }

  success() {
    this._tone(523, 0.12, 0.22, 'sine');
    setTimeout(() => this._tone(659, 0.12, 0.22, 'sine'), 110);
    setTimeout(() => this._tone(784, 0.2, 0.22, 'sine'), 220);
  }

  fail() {
    this._tone(220, 0.25, 0.2, 'sawtooth', 110);
  }
}
