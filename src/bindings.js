// Default bindings and on-screen hint data. The user can change the keys in Settings (settings.js).

// action -> KeyboardEvent.code
export const DEFAULT_KEYS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  up: 'Space', down: 'KeyC', yawLeft: 'KeyQ', yawRight: 'KeyE',
  takeoffLand: 'KeyX',   // hold
  home: 'KeyH',
  photo: 'KeyF', record: 'KeyR', spray: 'KeyG', // spray is hold-to-spray
  pickupDrop: 'KeyP', mark: 'KeyM', thermal: 'KeyT',
  command: 'Enter', panelAI: 'Tab', addObject: 'KeyB', camera: 'KeyV', pause: 'Escape',
  zoomIn: 'Equal', zoomOut: 'Minus', // juga roda mouse
  gimbalUp: 'ArrowUp', gimbalDown: 'ArrowDown', gimbalRollLeft: 'BracketLeft', gimbalRollRight: 'BracketRight', gimbalReset: 'Home', // arah kamera, drone tetap diam
};

// One-shot actions fired on key press (name is what the rest of the app listens for).
export const KEY_IMPULSES = {
  home: 'home', photo: 'photo', record: 'record', pickupDrop: 'pickup_drop', mark: 'mark',
  thermal: 'thermal', command: 'command', panelAI: 'panel_ai', addObject: 'add_object',
  camera: 'camera_next', pause: 'pause', zoomIn: 'zoom_in', zoomOut: 'zoom_out', gimbalReset: 'gimbal_reset',
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
  [PAD.LB]: 'camera_prev', [PAD.START]: 'pause', [PAD.BACK]: 'zoom_cycle', [PAD.Y]: 'gimbal_cycle',
};

const FACE = {
  xbox: { A: 'A', B: 'B', X: 'X', Y: 'Y' },
  ps: { A: '✕', B: '○', X: '□', Y: '△' },
};

// Short on-screen label for a KeyboardEvent.code.
const NAMED = { Space: 'Spasi', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', Backspace: 'Backspace' };
export function keyLabel(code) {
  if (NAMED[code]) return NAMED[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

// Hints per context and device. Contexts: latihan (also used by the other practice missions),
// delivery (M4), freeroam, sar (M1), foto (M2), agri (M3), inspeksi (M5). Labels are short so they fit in the 1152 px bar. Key names follow the bindings.
function kbBase(b) {
  const L = (a) => keyLabel(b[a]);
  const move = [b.forward, b.left, b.back, b.right].join() === 'KeyW,KeyA,KeyS,KeyD' ? 'WASD' : [L('forward'), L('left'), L('back'), L('right')].join(' ');
  return [[move, 'Gerak'], [[L('yawLeft'), L('yawRight')], 'Putar'], [[L('up'), L('down')], 'Naik/Turun'], [L('takeoffLand'), 'Takeoff/Land (tahan)'], [L('home'), 'Home']];
}
const PAD_BASE = [['Stick kiri', 'Naik/Putar'], ['Stick kanan', 'Gerak'], ['A', 'Takeoff/Land (tahan)'], ['B', 'Home']];
const kbRight = {
  latihan: (L) => [[L('pause'), 'Jeda']],
  delivery: (L) => [[L('pickupDrop'), 'Ambil/Lepas'], [L('camera'), 'Kamera'], [L('pause'), 'Jeda']],
  freeroam: (L) => [[L('addObject'), 'Objek'], [L('camera'), 'Kamera'], [L('panelAI'), 'Panel'], [L('pause'), 'Jeda']],
  sar: (L) => [[L('mark'), 'Tandai'], [L('thermal'), 'Panas'], [L('photo'), 'Foto'], [L('pause'), 'Jeda']],
  foto: (L) => [[L('photo'), 'Foto'], [L('record'), 'Rekam'], [L('camera'), 'Kamera'], [L('pause'), 'Jeda']],
  agri: (L) => [[L('spray'), 'Semprot (tahan)'], [L('camera'), 'Kamera'], [L('pause'), 'Jeda']],
  inspeksi: (L) => [[L('photo'), 'Foto'], [L('mark'), 'Tandai'], [L('camera'), 'Kamera'], [L('pause'), 'Jeda']],
};
const PAD_RIGHT = {
  latihan: [['LB', 'Kamera'], ['RB', 'Kamera']],
  delivery: [['D-pad ►', 'Ambil/Lepas'], ['RB', 'Kamera']],
  freeroam: [['RB', 'Kamera']],
  sar: [['D-pad ▲', 'Tandai'], ['D-pad ▼', 'Panas'], ['X', 'Foto']],
  foto: [['X', 'Foto'], ['D-pad ◄', 'Rekam'], ['RB', 'Kamera']],
  agri: [['RT', 'Semprot (tahan)'], ['RB', 'Kamera']],
  inspeksi: [['X', 'Foto'], ['D-pad ▲', 'Tandai'], ['RB', 'Kamera']],
};

// Returns { left, right } for the given device; face-button names follow the controller type.
export function buildHints(context, device, type = 'xbox', bindings = DEFAULT_KEYS) {
  const ctx = kbRight[context] ? context : 'latihan';
  const face = FACE[type] || FACE.xbox;
  const fix = (list) => list.map(([k, l]) => [typeof k === 'string' && face[k] ? face[k] : k, l]);
  if (device === 'gamepad') return { left: fix(PAD_BASE), right: fix(PAD_RIGHT[ctx]) };
  const L = (a) => keyLabel(bindings[a]);
  return { left: kbBase(bindings), right: kbRight[ctx](L) };
}
