// Unified input: keyboard + gamepad -> one action object -> sim.applyAction() (called from main).
// Also tracks the last-used device so the HUD can switch key hints automatically.
import { DEFAULT_KEYS, KEY_IMPULSES, PAD, PAD_IMPULSES } from './bindings.js';
import { DEFAULT_INPUT, mapSticks, keysToAction, padType, pickStickAxes, HoldTracker } from './inputmap.js';
import { events } from './events.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const BUTTONS = 17;

export function createInput() {
  const keys = new Set();
  const kbd = { yaw: 0, climb: 0, strafe: 0, forward: 0 };
  const pad = { yaw: 0, climb: 0, strafe: 0, forward: 0 };
  const hold = new HoldTracker(0.6);
  const prev = new Array(BUTTONS).fill(false);

  const input = {
    action: { yaw: 0, climb: 0, strafe: 0, forward: 0 }, // combined, ready for sim.applyAction()
    manual: false,           // true while the player is deflecting any control
    device: 'keyboard',      // last used device: 'keyboard' | 'gamepad'
    padType: 'xbox',         // 'xbox' | 'ps' (only meaningful for gamepad)
    holdProgress: 0,         // 0..1, takeoff/land hold-to-confirm
    debugOn: false,          // toggled with the ` key: shows raw gamepad data in the HUD
    config: { ...DEFAULT_INPUT },
    bindings: { ...DEFAULT_KEYS },
    poll,
  };

  // code -> impulse name, rebuilt if bindings change (Phase 5).
  let codeToImpulse = {};
  function rebuild() {
    codeToImpulse = {};
    for (const [act, name] of Object.entries(KEY_IMPULSES)) codeToImpulse[input.bindings[act]] = name;
  }
  rebuild();
  input.rebuild = rebuild;

  // Gamepad bookkeeping. Axis map and "last values" are per pad and reset when the pad changes.
  const sticks = [0, 0, 0, 0];
  const lastAxes = new Array(32).fill(0);
  let axisMap = [0, 1, 2, 3];
  let padIndex = -1, padId = '', primed = false;

  // Controller gone (turned off, unplugged): forget it and hand control back to the keyboard now.
  function dropPad() {
    padIndex = -1; padId = ''; primed = false;
    prev.fill(false);
    if (input.device === 'gamepad') input.device = 'keyboard';
  }
  window.addEventListener('gamepaddisconnected', dropPad);

  let sprayOn = false;
  const emit = (name, extra) => events.emit('input', { name, ...extra });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    keys.add(e.code);
    if (e.code === 'Backquote') { input.debugOn = !input.debugOn; return; }
    input.device = 'keyboard';
    const name = codeToImpulse[e.code];
    if (name && !e.repeat) emit(name);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  function activePad() {
    if (!navigator.getGamepads) return null;
    const list = navigator.getGamepads();
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].connected) return list[i];
    return null;
  }

  // Called once per rendered frame (dt in seconds).
  function poll(dt) {
    keysToAction(keys, input.bindings, kbd);
    pad.yaw = pad.climb = pad.strafe = pad.forward = 0;

    const gp = activePad();
    let padDown = false, padSpray = false;
    if (!gp) {
      if (padIndex !== -1 || input.device === 'gamepad') dropPad();
    } else {
      if (gp.index !== padIndex || gp.id !== padId) { // new pad: decide which axes are the sticks
        padIndex = gp.index; padId = gp.id; primed = false;
        axisMap = pickStickAxes(gp.axes, gp.mapping);
      }
      input.padType = padType(gp.id);

      // "Activity" means something CHANGED (axis moved or button pressed). A value that merely sits
      // at some offset (drift, stale data) never counts, so it cannot steal control from the keyboard.
      let activity = false;
      const n = Math.min(gp.axes.length, lastAxes.length);
      for (let i = 0; i < n; i++) {
        const v = gp.axes[i];
        if (primed && Math.abs(v - lastAxes[i]) > 0.03) activity = true;
        lastAxes[i] = v;
      }
      primed = true;

      for (let k = 0; k < 4; k++) sticks[k] = gp.axes[axisMap[k]] || 0;
      mapSticks(sticks, input.config, pad);

      for (let i = 0; i < BUTTONS && i < gp.buttons.length; i++) {
        const down = gp.buttons[i].pressed;
        if (down && !prev[i]) {
          activity = true;
          const name = PAD_IMPULSES[i];
          if (name) emit(name);
        }
        prev[i] = down;
      }
      padDown = gp.buttons[PAD.A] ? gp.buttons[PAD.A].pressed : false;
      padSpray = gp.buttons[PAD.RT] ? gp.buttons[PAD.RT].value > 0.5 : false;
      if (activity) input.device = 'gamepad';
    }

    // Hold-to-confirm takeoff/land (X on keyboard, A on gamepad).
    const holding = keys.has(input.bindings.takeoffLand) || padDown;
    if (hold.update(dt, holding)) emit('takeoff_land');
    input.holdProgress = holding ? hold.progress : 0;

    // Hold-to-spray (G or RT). Only the state change is announced.
    const spray = keys.has(input.bindings.spray) || padSpray;
    if (spray !== sprayOn) { sprayOn = spray; emit('spray', { on: spray }); }

    // Only the last-used device drives the drone, so a stale or drifting pad cannot fight the keyboard.
    const src = input.device === 'gamepad' ? pad : kbd;
    const a = input.action;
    a.yaw = clamp(src.yaw, -1, 1);
    a.climb = clamp(src.climb, -1, 1);
    a.strafe = clamp(src.strafe, -1, 1);
    a.forward = clamp(src.forward, -1, 1);
    input.manual = Math.abs(a.yaw) + Math.abs(a.climb) + Math.abs(a.strafe) + Math.abs(a.forward) > 0.05;
  }

  // Text for the debug panel (only called while debugOn, ~10 times per second).
  input.debugText = () => {
    const gp = activePad();
    if (!gp) return 'Gamepad: tidak terdeteksi\nPerangkat aktif: ' + input.device;
    return `Gamepad: ${gp.id}\nmapping: ${gp.mapping || '(non-standar)'}\n` +
      `axes: ${Array.from(gp.axes, (v) => v.toFixed(2)).join(' ')}\n` +
      `sumbu stick (LX,LY,RX,RY): ${axisMap.join(',')}\nPerangkat aktif: ${input.device}`;
  };

  return input;
}
