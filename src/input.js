// Unified input: keyboard + gamepad -> one action object -> sim.applyAction() (called from main).
// Also tracks the last-used device so the HUD can switch key hints automatically.
import { DEFAULT_KEYS, KEY_IMPULSES, PAD, PAD_IMPULSES } from './bindings.js';
import { DEFAULT_INPUT, mapSticks, keysToAction, padType, pickStickAxes, approach, HoldTracker } from './inputmap.js';
import { rampRate } from './settings.js';
import { events } from './events.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const BUTTONS = 17;

// Menu navigation (used while input.menuMode is true). Same events for keyboard and controller.
const NAV_KEYS = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right', Enter: 'ok', NumpadEnter: 'ok', Space: 'ok', Escape: 'back', Backspace: 'back',
};
const NAV_PAD = { 12: 'up', 13: 'down', 14: 'left', 15: 'right', 0: 'ok', 1: 'back', 9: 'back' };

export function createInput() {
  const keys = new Set();
  const kbd = { yaw: 0, climb: 0, strafe: 0, forward: 0 };
  const pad = { yaw: 0, climb: 0, strafe: 0, forward: 0 };
  const kbdRaw = { yaw: 0, climb: 0, strafe: 0, forward: 0 };
  const hold = new HoldTracker(0.6);
  const prev = new Array(BUTTONS).fill(false);

  const input = {
    action: { yaw: 0, climb: 0, strafe: 0, forward: 0 }, // combined, ready for sim.applyAction()
    manual: false,           // true while the player is deflecting any control
    device: 'keyboard',      // last used device: 'keyboard' | 'gamepad'
    padType: 'xbox',         // 'xbox' | 'ps' (only meaningful for gamepad)
    holdProgress: 0,         // 0..1, takeoff/land hold-to-confirm
    menuMode: false,         // true while a menu is open: only 'nav' events, the drone gets no action
    debugOn: false,          // toggled with the ` key: shows raw gamepad data in the HUD
    config: { ...DEFAULT_INPUT },
    kbd: { sensitivity: 1, rampRate: Infinity }, // keyboard sensitivity and ramp (units/s), from Settings
    rumbleOn: true,
    capture: null,           // when set, the next key press goes to this callback (key remapping)
    sticks: null,            // raw stick values LX, LY, RX, RY (for the stick test screen)
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

  // Apply a sanitized settings object (settings.js) to the live input.
  input.applySettings = (s) => {
    Object.assign(input.config, { mode: s.controller.mode, sensitivity: s.controller.sensitivity, deadzone: s.controller.deadzone, invertY: s.controller.invertY });
    input.rumbleOn = s.controller.rumble;
    input.kbd.sensitivity = s.keyboard.sensitivity;
    input.kbd.rampRate = rampRate(s.keyboard.ramp);
    input.bindings = { ...s.keyboard.keys };
    rebuild();
  };

  // Short vibration (collisions, "test vibration"). Silently does nothing on pads without a rumble motor.
  input.rumble = (strength = 0.6, ms = 150, force = false) => {
    if (!force && (!input.rumbleOn || input.device !== 'gamepad')) return;
    const gp = activePad();
    const fx = gp && gp.vibrationActuator;
    if (!fx || !fx.playEffect) return;
    try { fx.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }); } catch { /* ignore */ }
  };

  // Gamepad bookkeeping. Axis map and "last values" are per pad and reset when the pad changes.
  const sticks = [0, 0, 0, 0];
  input.sticks = sticks;
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
  let holdArmed = true;
  const emit = (name, extra) => events.emit('input', { name, ...extra });

  // Typing in the command editor must never move the drone.
  const typing = (e) => !!e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT');
  input.releaseAll = () => keys.clear();

  window.addEventListener('keydown', (e) => {
    if (input.capture) { // key remapping: swallow the key, Escape cancels
      const done = input.capture;
      input.capture = null;
      e.preventDefault();
      done(e.code === 'Escape' ? null : e.code);
      return;
    }
    if (typing(e)) return;
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    keys.add(e.code);
    if (e.code === 'Backquote') { input.debugOn = !input.debugOn; return; }
    input.device = 'keyboard';
    if (input.menuMode) {
      const dir = NAV_KEYS[e.code];
      if (dir) events.emit('nav', { dir });
      return;
    }
    const name = codeToImpulse[e.code];
    if (name && (!e.repeat || name === 'zoom_in' || name === 'zoom_out')) emit(name); // zoom boleh ditahan
  });
  window.addEventListener('wheel', (e) => { // roda mouse = zoom kamera drone
    if (input.menuMode || input.capture || typing(e) || !e.deltaY) return;
    emit(e.deltaY < 0 ? 'zoom_in' : 'zoom_out');
  }, { passive: true });
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
    keysToAction(keys, input.bindings, kbdRaw);
    const ramp = input.kbd.rampRate === Infinity ? Infinity : input.kbd.rampRate * dt, k = input.kbd.sensitivity;
    kbd.yaw = approach(kbd.yaw, kbdRaw.yaw * k, ramp);
    kbd.climb = approach(kbd.climb, kbdRaw.climb * k, ramp);
    kbd.strafe = approach(kbd.strafe, kbdRaw.strafe * k, ramp);
    kbd.forward = approach(kbd.forward, kbdRaw.forward * k, ramp);
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
          if (input.menuMode) {
            if (NAV_PAD[i]) events.emit('nav', { dir: NAV_PAD[i] });
          } else if (PAD_IMPULSES[i]) emit(PAD_IMPULSES[i]);
        }
        prev[i] = down;
      }
      padDown = gp.buttons[PAD.A] ? gp.buttons[PAD.A].pressed : false;
      padSpray = gp.buttons[PAD.RT] ? gp.buttons[PAD.RT].value > 0.5 : false;
      if (activity) input.device = 'gamepad';
    }

    // Hold-to-confirm takeoff/land (X on keyboard, A on gamepad).
    // After a menu closes, the button that confirmed it may still be down: wait for a release first.
    const rawHold = keys.has(input.bindings.takeoffLand) || padDown;
    if (input.menuMode) holdArmed = false;
    else if (!rawHold) holdArmed = true;
    const holding = rawHold && holdArmed && !input.menuMode;
    if (hold.update(dt, holding)) emit('takeoff_land');
    input.holdProgress = holding ? hold.progress : 0;

    // Hold-to-spray (G or RT). Only the state change is announced.
    input.gimbal = input.menuMode ? 0 : (keys.has(input.bindings.gimbalUp) ? 1 : 0) - (keys.has(input.bindings.gimbalDown) ? 1 : 0);
    input.gimbalRoll = input.menuMode ? 0 : (keys.has(input.bindings.gimbalRollRight) ? 1 : 0) - (keys.has(input.bindings.gimbalRollLeft) ? 1 : 0);
    const spray = !input.menuMode && (keys.has(input.bindings.spray) || padSpray);
    if (spray !== sprayOn) { sprayOn = spray; emit('spray', { on: spray }); }

    // Only the last-used device drives the drone, so a stale or drifting pad cannot fight the keyboard.
    const src = input.device === 'gamepad' ? pad : kbd;
    const a = input.action;
    a.yaw = clamp(src.yaw, -1, 1);
    a.climb = clamp(src.climb, -1, 1);
    a.strafe = clamp(src.strafe, -1, 1);
    a.forward = clamp(src.forward, -1, 1);
    if (input.menuMode) a.yaw = a.climb = a.strafe = a.forward = 0;
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
