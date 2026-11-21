// Keyboard and mouse input for Solmar: key state with edge detection,
// pointer-lock mouse look, and click events. The game calls endFrame() once
// per frame so "just pressed" keys and clicks fire exactly once.

export class SolmarInput {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.justPressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.clicks = 0;
    this.locked = false;

    this.onKeyDown = (e) => {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) {
        this.keys.add(e.code);
        this.justPressed.add(e.code);
      }
    };
    this.onKeyUp = (e) => {
      this.keys.delete(e.code);
    };
    this.onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this.onMouseDown = (e) => {
      if (e.button !== 0) return;
      if (this.locked) this.clicks++;
    };
    this.onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
    };
    this.onBlur = () => {
      this.keys.clear();
      this.justPressed.clear();
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  // Ask the browser to lock the pointer to the game canvas (mouse look).
  // Must be called from a user gesture; failures are silent.
  requestLock() {
    try {
      if (!this.locked) this.canvas.requestPointerLock();
    } catch { /* pointer lock is optional */ }
  }

  releaseLock() {
    try {
      if (document.pointerLockElement) document.exitPointerLock();
    } catch { /* ignore */ }
  }

  isDown(code) {
    return this.keys.has(code);
  }

  // True only on the frame the key went down.
  wasPressed(code) {
    return this.justPressed.has(code);
  }

  // True on the frame the player clicked while the pointer was locked.
  consumeClick() {
    if (this.clicks > 0) {
      this.clicks--;
      return true;
    }
    return false;
  }

  // Mouse movement since the last call, then reset.
  takeMouse() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  // Call once per frame, after the game has read this frame's input.
  endFrame() {
    this.justPressed.clear();
  }
}
