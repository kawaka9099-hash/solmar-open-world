// Solmar — game/src/save.js
// Versioned localStorage save: cash, ammo, mission progress and health.
// Everything is JSON behind one key; a damaged or foreign save is ignored
// instead of crashing the game.

export const SAVE_KEY = 'solmar-save-v1';
export const SAVE_VERSION = 1;

export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== SAVE_VERSION) return null;
    if (typeof data.money !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

export function writeSave(data) {
  try {
    const payload = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      money: Math.max(0, Math.floor(data.money ?? 0)),
      ammoMag: Math.max(0, Math.floor(data.ammoMag ?? 0)),
      ammoReserve: Math.max(0, Math.floor(data.ammoReserve ?? 0)),
      health: Math.max(0, Math.min(100, Math.floor(data.health ?? 100))),
      missionIndex: Math.max(0, Math.floor(data.missionIndex ?? 0)),
      completed: Array.isArray(data.completed) ? data.completed.slice(0, 6) : [],
      storyDone: !!data.storyDone,
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // Storage may be unavailable (private mode); the game plays on without it.
  }
}
