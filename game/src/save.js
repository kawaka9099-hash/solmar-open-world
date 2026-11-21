// Solmar saves: progress, cash, ammo and position in localStorage.
// Everything is wrapped in try/catch — a browser that refuses storage
// just plays without saving.

const SAVE_KEY = 'solmar-save-v1';

export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}

export function writeSave(data) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch { /* ignore */ }
}

// A one-line summary for the Continue button on the start screen.
export function saveSummary() {
  const data = loadSave();
  if (!data) return null;
  const when = data.savedAt ? new Date(data.savedAt) : null;
  return {
    money: data.money ?? 0,
    mission: data.nextMission ?? 1,
    date: when ? when.toLocaleDateString() : '',
  };
}
