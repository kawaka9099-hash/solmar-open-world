// Boot and the one loop: input is read every frame, the game advances in fixed
// 1/60 s steps (several in a slow frame, none in a fast one), and the renderer
// paints what is there. Screens: title, play, paused, wasted, busted.
//
// ?seed=N fixes the city. ?shot=cover|street|mission|chase (with &seed=N) stages
// that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { STEP, VIEW, WORLD } from './config.js';
import { createGame } from './game.js';
import { createInput } from './input.js';
import { createRenderer, SCREEN_BUSTED, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { createAudio } from './audio.js';
import { hasSave, loadGame, saveGame } from './save.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const game = createGame(seed);
const renderer = createRenderer(canvas);
const audio = createAudio();
const state = game.state;
// Debug hook for playtesting (read-only state inspection in the console).
window.__solmar = { state, game };

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** The camera centre the renderer uses, so mouse aim lands in the world. */
function camera() {
  const p = state.player;
  return {
    x: clamp(p.x, VIEW.width / 2, WORLD.width - VIEW.width / 2),
    y: clamp(p.y, VIEW.height / 2, WORLD.height - VIEW.height / 2),
  };
}

function runShot(name) {
  const scene = stageShot(name, game);
  let painted = 0;
  function paint() {
    renderer.draw(state, scene.screen, { hintSeconds: 0, muted: false, hasSave: false });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let hintSeconds = 14;
  let savedFlash = 0;

  function announce(message) {
    status.textContent = message;
  }

  function startNew() {
    game.state.cash = 250;
    screen = SCREEN_PLAY;
    hintSeconds = 14;
    announce('Playing. Follow the objective — Marisol is waiting.');
    audio.unlock();
  }

  function startContinue() {
    const data = loadGame();
    if (!data) { startNew(); return; }
    game.applySave(data);
    screen = SCREEN_PLAY;
    hintSeconds = 8;
    announce(`Continuing. Cash $${data.cash}.`);
    audio.unlock();
  }

  function doSave() {
    if (saveGame(state)) {
      state.message = 'Game saved.';
      state.messageTimer = 2;
    } else {
      state.message = 'Save failed — storage is off.';
      state.messageTimer = 2;
    }
    savedFlash = 2;
  }

  function handleActions(snap) {
    if (snap.mute) {
      const muted = audio.toggleMute();
      state.message = muted ? 'Sound off (M to turn back on).' : 'Sound on.';
      state.messageTimer = 1.5;
    }
    if (screen === SCREEN_TITLE) {
      if (snap.cont && hasSave()) startContinue();
      else if (snap.confirm) startNew();
      return;
    }
    if (screen === SCREEN_PLAY) {
      if (snap.pause) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      }
      return;
    }
    if (screen === SCREEN_PAUSED) {
      if (snap.pause || snap.confirm) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      } else if (snap.save) {
        doSave(); // S is the save key on the pause screen.
      }
      return;
    }
    if (screen === SCREEN_OVER || screen === SCREEN_BUSTED) {
      if (snap.confirm) {
        game.respawn(screen === SCREEN_BUSTED);
        screen = SCREEN_PLAY;
        announce('Back on the streets.');
      }
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const snap = input.snapshot();
    if (snap.confirm || snap.cont || snap.interact || snap.shoot) audio.unlock();
    handleActions(snap);

    if (screen === SCREEN_TITLE) {
      // The city idles behind the title: traffic and pedestrians keep moving.
      state.elapsed += dt;
      state.entities.stepTraffic(dt, state.player);
      state.entities.stepPeds(dt, null);
    } else if (screen === SCREEN_PLAY) {
      if (hintSeconds > 0) hintSeconds -= dt;
      if (savedFlash > 0) savedFlash -= dt;
      // Convert the mouse from view space to world space for aiming.
      const cam = camera();
      const shootX = snap.mouseViewX + cam.x - VIEW.width / 2;
      const shootY = snap.mouseViewY + cam.y - VIEW.height / 2;
      accumulator += dt;
      let firstStep = true;
      while (accumulator >= STEP) {
        game.update({ ...snap, shootX, shootY }, STEP);
        accumulator -= STEP;
        // One-shot edges fire once per frame, not once per sub-step: a slow
        // frame that catches up with two steps must not enter and then exit
        // the same car in the same frame.
        if (firstStep) {
          snap.interact = false;
          snap.melee = false;
          snap.shoot = false;
          firstStep = false;
        }
        if (state.wasted) { screen = SCREEN_OVER; break; }
        if (state.busted) { screen = SCREEN_BUSTED; break; }
      }
      // One audio cue per frame, at most.
      if (state.audioCue) {
        audio.cue(state.audioCue);
        state.audioCue = null;
      }
      const near = state.police.nearestPolice(state.player.x, state.player.y);
      audio.frame(
        state.player.car ? state.player.car.speed : 0,
        near ? near.dist : null,
        !!state.player.car,
      );
      if (state.missions.done && !state.missions.announced) {
        state.missions.announced = true;
        doSave();
      }
    }
    renderer.draw(state, screen, {
      hintSeconds: screen === SCREEN_PLAY ? hintSeconds : 0,
      muted: audio.muted,
      hasSave: hasSave(),
    });
  }

  let last = performance.now();
  let accumulator = 0; // persists across frames: fractional frame time is kept, never dropped

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Solmar. Press Enter or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
