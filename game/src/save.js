// Solmar — game/src/save.js
// Versioned localStorage save for Solmar: cash, ammo, mission progress and
// story completion. Nothing here touches the network. A damaged or foreign
// save is ignored and the game starts fresh instead of crashing.

export const SAVE_KEY = 'solmar-save-v1';
export const SAVE_VERSION = 1;

export function defaultSave() {
  return {
    version: SAVE_VERSION,
    money: 50,
    ammo: 12,
    reserve: 48,
    missionIndex: 0,
    completed: [],
    storyDone: false,
  };
}

// Read the save, or null when there is none / it is unreadable.
export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || data.version !== SAVE_VERSION) return null;
    const base = defaultSave();
    return {
      ...base,
      money: Number.isFinite(data.money) ? Math.max(0, Math.floor(data.money)) : base.money,
      ammo: Number.isFinite(data.ammo) ? Math.max(0, Math.floor(data.ammo)) : base.ammo,
      reserve: Number.isFinite(data.reserve) ? Math.max(0, Math.floor(data.reserve)) : base.reserve,
      missionIndex: Number.isFinite(data.missionIndex) ? Math.max(0, Math.floor(data.missionIndex)) : base.missionIndex,
      completed: Array.isArray(data.completed) ? data.completed.filter((n) => Number.isInteger(n)) : [],
      storyDone: data.storyDone === true,
    };
  } catch (_err) {
    return null;
  }
}

// Persist the given state. Returns true on success.
export function writeSave(state) {
  try {
    const data = {
      version: SAVE_VERSION,
      money: Math.max(0, Math.floor(state.money)),
      ammo: Math.max(0, Math.floor(state.ammo)),
      reserve: Math.max(0, Math.floor(state.reserve)),
      missionIndex: Math.max(0, Math.floor(state.missionIndex)),
      completed: Array.isArray(state.completed) ? state.completed : [],
      storyDone: state.storyDone === true,
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (_err) {
    return false;
  }
}

export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch (_err) {
    // Storage unavailable: nothing to clear.
  }
}
