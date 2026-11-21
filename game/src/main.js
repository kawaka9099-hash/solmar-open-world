// Solmar bootstrap: build the game on the #scene element and let it run.
// Query flags (for headless playtests, not part of normal play):
//   ?fx=low        shadows off, pixel ratio 1 (fast software rendering)
//   ?autostart=1   start a new game without waiting for the menu
import { SolmarGame } from './game.js';

const params = new URLSearchParams(window.location.search);
const host = document.getElementById('scene');
const game = new SolmarGame(host, { lowFx: params.get('fx') === 'low' });

// A second handle for tests and the console.
window.__solmarGame = game;
