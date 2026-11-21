// Default bindings and on-screen hint data. Phase 5 will let the user change these.

// action -> KeyboardEvent.code
export const DEFAULT_KEYS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  up: 'Space', down: 'KeyC', yawLeft: 'KeyQ', yawRight: 'KeyE',
  takeoffLand: 'KeyX',   // hold
  home: 'KeyH',
  photo: 'KeyF', record: 'KeyR', spray: 'KeyG', // spray is hold-to-spray
  pickupDrop: 'KeyP', mark: 'KeyM', thermal: 'KeyT',
  command: 'Enter', panelAI: 'Tab', addObject: 'KeyB', camera: 'KeyV', pause: 'Escape',
};

// One-shot actions fired on key press (name is what the rest of the app listens for).
export const KEY_IMPULSES = {
  home: 'home', photo: 'photo', record: 'record', pickupDrop: 'pickup_drop', mark: 'mark',
  thermal: 'thermal', command: 'command', panelAI: 'panel_ai', addObject: 'add_object',
  camera: 'camera_next', pause: 'pause',
};

// Standard-mapping gamepad button indices.
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9,
  DUP: 12, DDOWN: 13, DLEFT: 14, DRIGHT: 15,
};

// Gamepad impulses: button index -> action name.
export const PAD_IMPULSES = {
  [PAD.B]: 'home', [PAD.X]: 'photo', [PAD.DUP]: 'mark', [PAD.DLEFT]: 'record',
  [PAD.DRIGHT]: 'pickup_drop', [PAD.DDOWN]: 'thermal', [PAD.RB]: 'camera_next',
  [PAD.LB]: 'camera_prev', [PAD.START]: 'pause',
};

const FACE = {
  xbox: { A: 'A', B: 'B', X: 'X', Y: 'Y' },
  ps: { A: '✕', B: '○', X: '□', Y: '△' },
};

// Hints per context and device. Phase 3 adds mission contexts (m1..m5) next to "latihan".
const HINTS = {
  latihan: {
    keyboard: {
      left: [['WASD', 'Gerak'], [['Q', 'E'], 'Putar'], [['Spasi', 'C'], 'Naik/Turun'],
             ['X', 'Takeoff/Land (tahan)'], ['H', 'Return home']],
      right: [],
    },
    gamepad: {
      left: [['Stick kiri', 'Naik/Putar'], ['Stick kanan', 'Gerak'], ['A', 'Takeoff/Land (tahan)'], ['B', 'Return home']],
      right: [],
    },
  },
};

// Returns { left, right } for the given device; face-button names follow the controller type.
export function buildHints(context, device, type = 'xbox') {
  const set = (HINTS[context] || HINTS.latihan)[device === 'gamepad' ? 'gamepad' : 'keyboard'];
  const face = FACE[type] || FACE.xbox;
  const fix = (list) => list.map(([k, l]) => [typeof k === 'string' && face[k] ? face[k] : k, l]);
  return { left: fix(set.left), right: fix(set.right) };
}
