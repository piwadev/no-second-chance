// Persistence. In the desktop launcher a preload bridge (window.nscNative) stores the save as a file in
// %APPDATA%\NoSecondChance\saves (never touched by updates, rotating backups). In a browser: localStorage.
const KEY = 'nsc_save_v1';
const N = typeof window !== 'undefined' ? window.nscNative : null;
const ls = {
  get() { try { return localStorage.getItem(KEY); } catch { return null; } },
  set(t) { try { localStorage.setItem(KEY, t); return true; } catch { return false; } },
  del() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
};
export const storage = {
  native: !!N,
  load() {
    if (!N) return ls.get();
    let t = null; try { t = N.loadSave(); } catch { /* bridge error */ }
    if (t) return t;
    const old = ls.get(); if (old) { try { N.saveSync(old, 'migrated-from-localstorage'); } catch { /* ignore */ } return old; }
    return null;
  },
  save(text) { if (N) { try { return !!N.saveSync(text); } catch { return false; } } return ls.set(text); },
  remove() { if (N) { try { N.resetSave(); } catch { /* ignore */ } } ls.del(); },
  info() { return N && N.info ? N.info() : null; },
};
export const DEFAULT_SAVE = () => ({ v: 1, game: 'nsc', settings: { sens: 2.0, fov: 90, volume: 0.7, invert: false, quality: 'high', difficulty: 'normal' }, career: { matches: 0, wins: 0, kills: 0, deaths: 0, rescues: 0, rounds: 0 } });
export function loadSave() {
  const d = DEFAULT_SAVE(); try { const t = storage.load(); if (!t) return d; const j = JSON.parse(t); if (!j || j.game !== 'nsc') return d; return { ...d, ...j, settings: { ...d.settings, ...(j.settings || {}) }, career: { ...d.career, ...(j.career || {}) } }; } catch { return d; }
}
export function writeSave(s) { return storage.save(JSON.stringify(s)); }
export const buildInfo = { version: '' };
fetch('version.json').then(r => (r.ok ? r.json() : null)).then(j => { if (j) { buildInfo.version = j.version; const el = document.getElementById('verLabel'); if (el) el.textContent = 'v' + j.version; } }).catch(() => {});
