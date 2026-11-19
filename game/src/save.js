// Save and load through localStorage: cash, story progress, position, health,
// wanted level, clock and pistol state. A save is only written from the pause menu
// and on mission completion, so a bad session never overwrites a good one mid-chase.
import { SAVE_KEY } from './config.js';

export function saveGame(state) {
  try {
    const data = {
      v: 1,
      cash: state.cash,
      mission: state.missions.serialize(),
      player: {
        x: state.player.x, y: state.player.y, angle: state.player.angle,
        health: state.player.health, hasPistol: state.player.hasPistol,
        ammo: state.player.ammo,
      },
      wanted: state.wanted,
      clockMinutes: state.clockMinutes,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function loadGame() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export function hasSave() {
  return loadGame() !== null;
}
