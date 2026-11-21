// Solmar — game/src/save.js
// Local save: progress lives in the browser's localStorage so a player can
// close the tab and pick up their story later. One small JSON object under
// a versioned key; anything the game does not recognise is ignored, so an
// old or damaged save can never break the boot.
//
// Saved: cash, pistol ammo, the next mission index, which missions are
// done, and whether the story is finished. The wanted level, the player's
// position and any live mission are deliberately NOT saved — every session
// starts clean on the streets of Solmar.

const SAVE_KEY = 'solmar-save-v1';

export class SaveManager {
  hasSave() {
    try {
      return window.localStorage.getItem(SAVE_KEY) !== null;
    } catch (err) {
      return false;
    }
  }

  save(data) {
    const payload = {
      version: 1,
      savedAt: Date.now(),
      money: Math.max(0, Math.floor(data.money || 0)),
      ammoMag: Math.max(0, Math.floor(data.ammoMag || 0)),
      ammoReserve: Math.max(0, Math.floor(data.ammoReserve || 0)),
      missionIndex: Math.max(0, Math.floor(data.missionIndex || 0)),
      completed: Array.isArray(data.completed) ? data.completed.slice() : [],
      storyComplete: !!data.storyComplete,
    };
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      return true;
    } catch (err) {
      return false;
    }
  }

  load() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(SAVE_KEY);
    } catch (err) {
      return null;
    }
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || data.version !== 1) return null;
      return {
        money: typeof data.money === 'number' ? data.money : 50,
        ammoMag: typeof data.ammoMag === 'number' ? data.ammoMag : 12,
        ammoReserve: typeof data.ammoReserve === 'number' ? data.ammoReserve : 48,
        missionIndex: typeof data.missionIndex === 'number' ? data.missionIndex : 0,
        completed: Array.isArray(data.completed) ? data.completed : [],
        storyComplete: !!data.storyComplete,
      };
    } catch (err) {
      return null;
    }
  }

  clear() {
    try {
      window.localStorage.removeItem(SAVE_KEY);
    } catch (err) {
      // A save that cannot be removed is harmless; the next save overwrites it.
    }
  }
}
