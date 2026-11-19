// The story: six jobs for fixer Marisol Vega, run as a step machine. Each step has
// a kind (steal, goto, pickup, grab, lose, shootout, escape) and a target; the game
// calls update() every frame and advance() when the player does the thing. Rewards
// are paid in cash, and the mission line is what the HUD's objective panel shows.
import { COMBAT, MISSIONS, PLACES } from './config.js';

export function createMissions() {
  let index = 0; // which mission of MISSIONS
  let step = 0; // which step of the mission
  let timer = 0; // seconds left for a timed step (0 = untimed)
  let grabTimer = 0; // vault-cracking hold time
  let failed = false;
  let done = false; // the whole story is finished
  let enemiesLeft = 0;
  let announced = false;

  function current() {
    return MISSIONS[index] || null;
  }

  function currentStep() {
    const m = current();
    return m ? m.steps[step] : null;
  }

  function objective() {
    const m = current();
    if (done) return 'Story complete — Solmar is yours. Free roam.';
    if (!m) return '';
    const s = currentStep();
    return s ? s.label : '';
  }

  function target() {
    const s = currentStep();
    if (!s) return null;
    if (s.kind === 'steal' || s.kind === 'lose') return null;
    if (s.x !== undefined) return { x: s.x, y: s.y };
    return null;
  }

  function title() {
    const m = current();
    return done ? 'Free Roam' : m ? `Mission ${m.id}: ${m.title}` : '';
  }

  function start(state) {
    const m = current();
    if (!m) return;
    timer = 0;
    grabTimer = 0;
    failed = false;
    announced = false;
    // Timed steps arm their clock when the step begins.
    const s = currentStep();
    if (s && s.seconds) timer = s.seconds;
    if (s && s.kind === 'shootout') {
      // (Re)starting on the shootout step — e.g. a save loaded mid-fight, or a
      // staged scene — fields a fresh crew; the step ends when they are all down.
      enemiesLeft = 5;
      state.spawnThugs = true;
    }
    if (m.id === 5 && !state.player.hasPistol) {
      state.player.hasPistol = true;
      state.player.ammo = Math.max(state.player.ammo, COMBAT.pistolAmmo);
    }
    state.message = `Mission ${m.id}: ${m.title} — ${m.brief}`;
    state.messageTimer = 5;
  }

  function advance(state) {
    const m = current();
    if (!m) return;
    step += 1;
    grabTimer = 0;
    const s = currentStep();
    timer = s && s.seconds ? s.seconds : 0;
    if (step >= m.steps.length) {
      state.cash += m.reward;
      state.message = `Job done! Marisol paid you $${m.reward}.`;
      state.messageTimer = 4;
      state.audioCue = 'cash';
      index += 1;
      step = 0;
      if (index >= MISSIONS.length) {
        done = true;
        state.message = 'The Solmar Heist is done. The city is yours, kid.';
        state.messageTimer = 6;
      } else {
        start(state);
      }
      return;
    }
    if (s.kind === 'shootout') {
      enemiesLeft = 5;
      state.spawnThugs = true;
    }
    state.message = s.label;
    state.messageTimer = 3;
  }

  function fail(state, reason) {
    failed = true;
    state.message = reason;
    state.messageTimer = 4;
    // Restart the current mission from its first step.
    step = 0;
    timer = 0;
    grabTimer = 0;
    state.wanted = Math.max(0, state.wanted - 1);
  }

  function update(state, dt) {
    if (done) return;
    const m = current();
    if (!m) return;
    const s = currentStep();
    if (!s) return;
    const p = state.player;

    if (timer > 0) {
      timer -= dt;
      if (timer <= 0) {
        fail(state, 'Too slow — the client walked. Marisol is giving you another shot.');
        start(state);
        return;
      }
    }

    // 'lose' completes when the heat reaches zero.
    if (s.kind === 'lose' && state.wanted === 0) {
      advance(state);
      return;
    }
    // 'grab' (the vault) completes after holding still inside the marker.
    if (s.kind === 'grab') {
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      if (d < 60) {
        grabTimer += dt;
        if (grabTimer > 3) {
          state.wanted = Math.max(state.wanted, 4);
          state.message = 'Vault cracked! RUN — the whole city heard that alarm.';
          state.messageTimer = 4;
          advance(state);
        }
      } else {
        grabTimer = Math.max(0, grabTimer - dt * 2);
      }
    }
  }

  /** The player did something the current step was waiting for. */
  function onEvent(state, event, data) {
    if (done) return;
    const s = currentStep();
    if (!s) return;
    const p = state.player;
    if (s.kind === 'steal' && event === 'steal') { advance(state); return; }
    if (s.kind === 'goto' && event === 'arrive') { advance(state); return; }
    if (s.kind === 'pickup' && event === 'pickup') { advance(state); return; }
    if (s.kind === 'escape' && event === 'arrive') { advance(state); return; }
    if (s.kind === 'shootout') {
      if (event === 'thugDown') {
        enemiesLeft -= 1;
        if (enemiesLeft <= 0) advance(state);
      }
    }
    void p;
    void data;
  }

  function serialize() {
    return { index, step, done };
  }

  function restore(data) {
    index = data.index || 0;
    step = data.step || 0;
    done = !!data.done;
    timer = 0;
    grabTimer = 0;
    failed = false;
  }

  return {
    current, currentStep, objective, target, title, start, advance, fail, update,
    onEvent, serialize, restore,
    get index() { return index; },
    get step() { return step; },
    get timer() { return timer; },
    get grabTimer() { return grabTimer; },
    get done() { return done; },
    get failed() { return failed; },
    get enemiesLeft() { return enemiesLeft; },
    get announced() { return announced; },
    set announced(v) { announced = v; },
  };
}

export { PLACES };
