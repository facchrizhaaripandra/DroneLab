// User settings (pure JS). Stored in localStorage as JSON; every load goes through sanitize(),
// so a hand-edited or old file can never put the app in a broken state.
import { DEFAULT_KEYS, keyLabel } from './bindings.js';

export const STORAGE_KEY = 'dronelab.settings.v1';

// Keyboard acceleration levels: how fast a key press ramps to full deflection (units per second).
export const RAMP_LEVELS = [2, 4, 8, 16, Infinity];
export const RAMP_NAMES = ['Sangat lembut', 'Lembut', 'Sedang', 'Cepat', 'Instan'];

// Graphics presets only set the values below; changing one of them by hand makes the preset "custom".
export const PRESETS = {
  low: { renderScale: 0.6, shadows: false },
  medium: { renderScale: 0.8, shadows: true },
  high: { renderScale: 1, shadows: true },
};
export const PRESET_NAMES = { low: 'Rendah', medium: 'Sedang', high: 'Tinggi', custom: 'Kustom' };

export const DEFAULT_SETTINGS = {
  keyboard: { keys: { ...DEFAULT_KEYS }, sensitivity: 1, ramp: 5 },           // ramp: level 1..5
  controller: { mode: 2, sensitivity: 1, deadzone: 0.15, invertY: false, rumble: true },
  graphics: { preset: 'medium', targetFps: 60, renderScale: 0.8, shadows: true, hudScale: 1, autoQuality: false },
};

const num = (v, lo, hi, dflt) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);
const bool = (v, dflt) => (typeof v === 'boolean' ? v : dflt);

// Turn anything (parsed JSON, undefined, garbage) into a complete, valid settings object.
export function sanitize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const k = r.keyboard || {}, c = r.controller || {}, g = r.graphics || {};
  const d = DEFAULT_SETTINGS;

  // Keys: only known actions, string codes, and no code used twice (otherwise back to the defaults).
  const keys = { ...DEFAULT_KEYS };
  if (k.keys && typeof k.keys === 'object') {
    for (const a of Object.keys(DEFAULT_KEYS)) if (typeof k.keys[a] === 'string' && k.keys[a]) keys[a] = k.keys[a];
  }
  if (new Set(Object.values(keys)).size !== Object.keys(keys).length) Object.assign(keys, DEFAULT_KEYS);

  const preset = pick(g.preset, ['low', 'medium', 'high', 'custom'], d.graphics.preset);
  const base = PRESETS[preset] || {};
  return {
    keyboard: {
      keys,
      sensitivity: num(k.sensitivity, 0.3, 1, d.keyboard.sensitivity),
      ramp: Math.round(num(k.ramp, 1, 5, d.keyboard.ramp)),
    },
    controller: {
      mode: pick(c.mode, [1, 2], d.controller.mode),
      sensitivity: num(c.sensitivity, 0.5, 1.5, d.controller.sensitivity),
      deadzone: num(c.deadzone, 0.05, 0.3, d.controller.deadzone),
      invertY: bool(c.invertY, d.controller.invertY),
      rumble: bool(c.rumble, d.controller.rumble),
    },
    graphics: {
      preset,
      targetFps: pick(g.targetFps, [30, 60], d.graphics.targetFps),
      renderScale: num(g.renderScale, 0.5, 1, base.renderScale ?? d.graphics.renderScale),
      shadows: bool(g.shadows, base.shadows ?? d.graphics.shadows),
      hudScale: pick(g.hudScale, [0.8, 0.9, 1], d.graphics.hudScale),
      autoQuality: bool(g.autoQuality, d.graphics.autoQuality), // lower quality by itself when FPS is low (off = never)
    },
  };
}

export function loadSettings(storage) {
  try { return sanitize(JSON.parse(storage.getItem(STORAGE_KEY))); } catch { return sanitize(null); }
}

export function saveSettings(storage, s) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(s)); return true; } catch { return false; } // private mode or full disk
}

// Give `action` the key `code`. If another action already uses it, the two swap, so codes stay unique.
export function remapKey(keys, action, code) {
  const out = { ...keys };
  const other = Object.keys(out).find((a) => a !== action && out[a] === code);
  if (other) out[other] = out[action];
  out[action] = code;
  return out;
}

// Choose a preset: it overwrites its own values. Changing a value by hand calls markCustom().
export function applyPreset(g, preset) {
  return { ...g, preset, ...PRESETS[preset] };
}
export function markCustom(g) { return { ...g, preset: 'custom' }; }

export function rampRate(level) { return RAMP_LEVELS[level - 1]; }

export { keyLabel };
