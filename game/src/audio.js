// All sound is synthesised with WebAudio — no audio files. Engine hum follows the
// car's speed, sirens wail when police are near, gunshots are noise bursts, and a
// simple bass-and-hat loop keeps the city moving. Created on the first user gesture;
// M toggles mute.
export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let musicTimer = null;
  let musicStep = 0;
  let muted = false;
  let started = false;

  // A minor-key bassline the loop walks, with a hat on the off-beats.
  const BASS = [55, 0, 55, 0, 65.41, 0, 49, 0, 55, 0, 55, 0, 82.41, 0, 73.42, 0];
  const STEP_MS = 190;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      // Engine: two detuned saws through a lowpass, pitch follows speed.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc2 = ctx.createOscillator();
      engineOsc2.type = 'square';
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      engineOsc.connect(filter);
      engineOsc2.connect(filter);
      filter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      engineOsc2.start();
      // Siren: a square that alternates between two tones.
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'square';
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      started = true;
      return true;
    } catch {
      return false;
    }
  }

  function unlock() {
    if (ensure() && ctx.state === 'suspended') ctx.resume();
    if (ctx && !musicTimer) {
      musicTimer = window.setInterval(() => {
        if (muted || !ctx) return;
        const step = musicStep % 16;
        musicStep += 1;
        const freq = BASS[step];
        if (freq > 0) {
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.value = freq;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.16, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
          osc.connect(g);
          g.connect(master);
          osc.start();
          osc.stop(ctx.currentTime + 0.24);
        }
        if (step % 2 === 1) {
          // Hat: a short burst of highpassed noise.
          const len = 0.03;
          const buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
          const data = buf.getChannelData(0);
          for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          const hp = ctx.createBiquadFilter();
          hp.type = 'highpass';
          hp.frequency.value = 6000;
          const g = ctx.createGain();
          g.gain.value = 0.05;
          src.connect(hp);
          hp.connect(g);
          g.connect(master);
          src.start();
        }
      }, STEP_MS);
    }
  }

  function blip(freq, dur, type, vol, slideTo) {
    if (!ctx || muted) return;
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.2, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(g);
    g.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  function noiseBurst(dur, vol, lowpass) {
    if (!ctx || muted) return;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass || 1200;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start();
  }

  /** One-shot cues the game raises by setting state.audioCue. */
  function cue(name) {
    if (!ctx || muted) return;
    if (name === 'shot') noiseBurst(0.14, 0.5, 900);
    else if (name === 'melee') noiseBurst(0.1, 0.25, 500);
    else if (name === 'hurt') blip(160, 0.18, 'sawtooth', 0.2, 70);
    else if (name === 'thugDown') { blip(520, 0.12, 'square', 0.15); blip(780, 0.16, 'square', 0.15); }
    else if (name === 'pickup') { blip(660, 0.09, 'sine', 0.2); setTimeout(() => blip(990, 0.14, 'sine', 0.2), 90); }
    else if (name === 'cash') { blip(880, 0.1, 'sine', 0.2); setTimeout(() => blip(1174, 0.1, 'sine', 0.2), 100); setTimeout(() => blip(1568, 0.18, 'sine', 0.2), 200); }
    else if (name === 'carjack') blip(220, 0.2, 'sawtooth', 0.2, 110);
    else if (name === 'busted') { blip(440, 0.4, 'square', 0.2, 220); }
    else if (name === 'wasted') { blip(330, 0.5, 'sawtooth', 0.25, 55); }
  }

  /** Continuous sounds, called every frame: engine by speed, siren by police distance. */
  function frame(speed, policeDist, inCar) {
    if (!ctx || muted) return;
    const target = inCar ? Math.min(0.14, 0.03 + Math.abs(speed) / 560 * 0.12) : 0;
    engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
    const base = 42 + Math.abs(speed) / 560 * 95;
    engineOsc.frequency.setTargetAtTime(base, ctx.currentTime, 0.08);
    engineOsc2.frequency.setTargetAtTime(base * 1.5 + 3, ctx.currentTime, 0.08);
    if (policeDist !== null && policeDist < 900) {
      const vol = Math.max(0, 0.09 * (1 - policeDist / 900));
      sirenGain.gain.setTargetAtTime(vol, ctx.currentTime, 0.2);
      sirenOsc.frequency.setTargetAtTime((Math.floor(ctx.currentTime * 1.6) % 2 === 0) ? 720 : 960, ctx.currentTime, 0.05);
    } else {
      sirenGain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    }
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.5;
    return muted;
  }

  return {
    unlock, cue, frame, toggleMute,
    get started() { return started; },
    get muted() { return muted; },
  };
}
