// Solmar — game/src/input.js
// Keyboard + mouse state for the whole game. One Input object owns the
// listeners; the game loop reads it every frame and calls endFrame() once
// per tick so edge-triggered keys (just pressed) work exactly once.
//
// Keys: WASD move/drive, Shift sprint, Space jump / handbrake,
// E enter or exit a car, F punch, R reload, M mute, P pause, Esc releases
// the pointer lock. Mouse: click to shoot, pointer lock for looking.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();        // codes currently held down
    this.pressed = new Set();     // codes pressed since the last endFrame()
    this.mouseDX = 0;             // accumulated look deltas since last frame
    this.mouseDY = 0;
    this.mouseDown = false;       // left button held
    this.mouseClicked = false;    // left button went down since last frame
    this.locked = false;          // pointer lock active
    this.enabled = true;          // set false while menus are open

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      if (e.code === 'Space') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onMouseDown = (e) => {
      if (e.button !== 0) return;
      this.mouseDown = true;
      this.mouseClicked = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.mouseDown = false;
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
    };
    this._onBlur = () => {
      this.keys.clear();
      this.mouseDown = false;
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('pointerlockchange', this._onLockChange);
    window.addEventListener('blur', this._onBlur);
  }

  isDown(code) {
    return this.keys.has(code);
  }

  // True only on the frame the key went down.
  justPressed(code) {
    return this.pressed.has(code);
  }

  // WASD / arrow movement as a normalised -1..1 pair (x = strafe, y = forward).
  moveAxis() {
    let x = 0;
    let y = 0;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) y += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) y -= 1;
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  }

  get sprint() { return this.isDown('ShiftLeft') || this.isDown('ShiftRight'); }
  get jump() { return this.justPressed('Space'); }
  get interact() { return this.justPressed('KeyE'); }
  get punch() { return this.justPressed('KeyF'); }
  get reload() { return this.justPressed('KeyR'); }
  get pause() { return this.justPressed('KeyP'); }
  get mute() { return this.justPressed('KeyM'); }
  get shoot() { return this.mouseDown; }
  get shootPressed() { return this.mouseClicked; }

  requestLock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (err) {
      // Pointer lock may be unavailable (headless, iframe); the game
      // still plays with keyboard-only steering.
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // Call once at the end of every frame.
  endFrame() {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseClicked = false;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    window.removeEventListener('blur', this._onBlur);
  }
}
