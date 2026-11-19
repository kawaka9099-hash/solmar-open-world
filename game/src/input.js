// Keyboard and mouse input. Held keys are read every frame; one-shot presses
// (interact, shoot, melee, confirm, pause, mute, continue) are queued as edge
// flags and taken once by the loop, so a press between two frames is never lost
// and never counted twice. Mouse position is reported in the 1280x720 view space.
import { VIEW } from './config.js';

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);

function anyHeld(held, set) {
  for (const code of held) if (set.has(code)) return true;
  return false;
}

export function createInput(canvas) {
  const held = new Set();
  let edges = {
    interact: false, melee: false, shoot: false,
    confirm: false, pause: false, mute: false, cont: false, save: false,
  };
  let mouseViewX = VIEW.width / 2;
  let mouseViewY = VIEW.height / 2;
  let mouseDown = false;

  function toView(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / VIEW.width, rect.height / VIEW.height);
    const ox = (rect.width - VIEW.width * scale) / 2;
    const oy = (rect.height - VIEW.height * scale) / 2;
    mouseViewX = (clientX - rect.left - ox) / scale;
    mouseViewY = (clientY - rect.top - oy) / scale;
  }

  window.addEventListener('keydown', (event) => {
    if (event.repeat) {
      held.add(event.code);
      return;
    }
    held.add(event.code);
    if (event.code === 'KeyE') edges.interact = true;
    else if (event.code === 'KeyV') edges.melee = true;
    else if (event.code === 'Space' || event.code === 'Enter') edges.confirm = true;
    else if (event.code === 'KeyP' || event.code === 'Escape') edges.pause = true;
    else if (event.code === 'KeyM') edges.mute = true;
    else if (event.code === 'KeyC') edges.cont = true;
    else if (event.code === 'KeyS') edges.save = true;
    if (UP.has(event.code) || DOWN.has(event.code) || LEFT.has(event.code) || RIGHT.has(event.code) || event.code === 'Space') {
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });
  window.addEventListener('blur', () => held.clear());
  canvas.addEventListener('pointermove', (event) => toView(event.clientX, event.clientY));
  canvas.addEventListener('pointerdown', (event) => {
    toView(event.clientX, event.clientY);
    mouseDown = true;
    edges.shoot = true;
    edges.confirm = true;
  });
  canvas.addEventListener('pointerup', () => { mouseDown = false; });

  /** The frame's input: held directions plus the one-shot edges since last call. */
  function snapshot() {
    const snap = {
      up: anyHeld(held, UP),
      down: anyHeld(held, DOWN),
      left: anyHeld(held, LEFT),
      right: anyHeld(held, RIGHT),
      run: held.has('ShiftLeft') || held.has('ShiftRight'),
      handbrake: held.has('Space'),
      interact: edges.interact,
      melee: edges.melee,
      shoot: edges.shoot,
      confirm: edges.confirm,
      pause: edges.pause,
      mute: edges.mute,
      cont: edges.cont,
      save: edges.save,
      mouseDown,
      mouseViewX, mouseViewY,
    };
    edges = {
      interact: false, melee: false, shoot: false,
      confirm: false, pause: false, mute: false, cont: false, save: false,
    };
    return snap;
  }

  return { snapshot };
}
