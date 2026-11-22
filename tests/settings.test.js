import test from 'node:test';
import assert from 'node:assert/strict';

const handlers = {};
globalThis.window = { addEventListener: (t, f) => { (handlers[t] ||= []).push(f); } };
let pads = [];
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });

const { createInput } = await import('../src/input.js');
const S = await import('../src/settings.js');
const { DEFAULT_KEYS, buildHints, keyLabel } = await import('../src/bindings.js');
const { approach } = await import('../src/inputmap.js');
const { stepList, stepNum, keyboardSpec, controllerSpec, graphicsSpec } = await import('../src/screens.js');

const fire = (type, ev) => (handlers[type] || []).forEach((f) => f({ preventDefault() {}, ...ev }));
const fakeStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), raw: m }; };

test('defaults are valid and sanitize() repairs garbage without throwing', () => {
  assert.deepEqual(S.sanitize(S.DEFAULT_SETTINGS), S.DEFAULT_SETTINGS);
  assert.deepEqual(S.sanitize(null), S.DEFAULT_SETTINGS);
  assert.deepEqual(S.sanitize('x'), S.DEFAULT_SETTINGS);
  const bad = S.sanitize({
    keyboard: { sensitivity: 99, ramp: 'fast', keys: { forward: 5, bogus: 'KeyZ', left: 'KeyL' } },
    controller: { mode: 3, sensitivity: -1, deadzone: 'a', invertY: 'yes', rumble: null },
    graphics: { preset: 'ultra', targetFps: 144, renderScale: 5, shadows: 1, hudScale: 2 },
  });
  assert.equal(bad.keyboard.sensitivity, 1);
  assert.equal(bad.keyboard.ramp, 5);
  assert.equal(bad.keyboard.keys.forward, 'KeyW');   // not a string: default
  assert.equal(bad.keyboard.keys.left, 'KeyL');      // valid change kept
  assert.ok(!('bogus' in bad.keyboard.keys));
  assert.equal(bad.controller.mode, 2);
  assert.equal(bad.controller.sensitivity, 0.5);
  assert.equal(bad.controller.deadzone, 0.15);
  assert.equal(bad.graphics.targetFps, 60);
  assert.equal(bad.graphics.renderScale, 1);
  assert.equal(bad.graphics.hudScale, 1);
});

test('duplicate key codes are rejected (all keys back to defaults)', () => {
  const s = S.sanitize({ keyboard: { keys: { forward: 'KeyZ', back: 'KeyZ' } } });
  assert.deepEqual(s.keyboard.keys, DEFAULT_KEYS);
});

test('settings survive a "reload": save to storage, load again, same values; broken storage falls back to defaults', () => {
  const st = fakeStorage();
  const s = S.sanitize({ ...S.DEFAULT_SETTINGS, controller: { ...S.DEFAULT_SETTINGS.controller, mode: 1, deadzone: 0.25, invertY: true },
    keyboard: { ...S.DEFAULT_SETTINGS.keyboard, keys: S.remapKey(DEFAULT_KEYS, 'photo', 'KeyJ'), ramp: 2 }, graphics: { ...S.DEFAULT_SETTINGS.graphics, targetFps: 30, hudScale: 0.9 } });
  assert.equal(S.saveSettings(st, s), true);
  assert.deepEqual(S.loadSettings(st), s);
  st.setItem(S.STORAGE_KEY, '{not json');
  assert.deepEqual(S.loadSettings(st), S.DEFAULT_SETTINGS);
  assert.deepEqual(S.loadSettings({ getItem() { throw new Error('blocked'); } }), S.DEFAULT_SETTINGS);
  assert.equal(S.saveSettings({ setItem() { throw new Error('full'); } }, s), false);
});

test('remapKey swaps with the action that already uses the key, so codes stay unique', () => {
  const k = S.remapKey(DEFAULT_KEYS, 'photo', 'KeyW');
  assert.equal(k.photo, 'KeyW');
  assert.equal(k.forward, 'KeyF');
  assert.equal(new Set(Object.values(k)).size, Object.keys(k).length);
  assert.equal(S.remapKey(DEFAULT_KEYS, 'photo', 'KeyJ').photo, 'KeyJ');
});

test('presets set their own values; a manual change makes the preset custom', () => {
  const g = S.applyPreset(S.DEFAULT_SETTINGS.graphics, 'low');
  assert.deepEqual([g.preset, g.renderScale, g.shadows], ['low', 0.6, false]);
  assert.equal(S.markCustom(g).preset, 'custom');
  assert.equal(S.sanitize({ graphics: { preset: 'custom', renderScale: 0.7, shadows: false } }).graphics.renderScale, 0.7);
});

test('key labels and hints follow the bindings', () => {
  assert.equal(keyLabel('Space'), 'Spasi');
  assert.equal(keyLabel('KeyJ'), 'J');
  assert.equal(keyLabel('ArrowUp'), '↑');
  assert.equal(buildHints('freeroam', 'keyboard').left[0][0], 'WASD');
  const keys = S.remapKey(S.remapKey(DEFAULT_KEYS, 'forward', 'ArrowUp'), 'addObject', 'KeyO');
  const h = buildHints('freeroam', 'keyboard', 'xbox', keys);
  assert.match(h.left[0][0], /↑/);
  assert.ok(h.right.some(([k, l]) => k === 'O' && l === 'Objek'));
});

test('approach() ramps, clamps and supports instant', () => {
  assert.equal(approach(0, 1, 0.25), 0.25);
  assert.equal(approach(0.9, 1, 0.25), 1);
  assert.equal(approach(0, -1, Infinity), -1);
  assert.equal(approach(1, 0, 0.5), 0.5);
});

test('applySettings reaches the live input: remapped key, sensitivity, ramp, controller options, persisted mode', () => {
  const input = createInput();
  const s = S.sanitize({ ...S.DEFAULT_SETTINGS,
    keyboard: { keys: S.remapKey(DEFAULT_KEYS, 'forward', 'KeyI'), sensitivity: 0.5, ramp: 2 },
    controller: { mode: 1, sensitivity: 1.2, deadzone: 0.3, invertY: true, rumble: false } });
  input.applySettings(s);
  fire('keydown', { code: 'KeyW' });
  input.poll(1 / 60);
  assert.equal(input.action.forward, 0);          // old key no longer works
  fire('keyup', { code: 'KeyW' });
  fire('keydown', { code: 'KeyI' });
  input.poll(1 / 60);
  assert.ok(input.action.forward > 0 && input.action.forward < 0.1, `ramp: ${input.action.forward}`); // 4 units/s * 1/60
  for (let i = 0; i < 120; i++) input.poll(1 / 60);
  assert.equal(input.action.forward, 0.5);        // sensitivity caps the deflection
  fire('keyup', { code: 'KeyI' });
  assert.deepEqual([input.config.mode, input.config.deadzone, input.config.invertY, input.rumbleOn], [1, 0.3, true, false]);
});

test('instant ramp with zero dt does not produce NaN', () => {
  const input = createInput();
  fire('keydown', { code: 'KeyW' });
  input.poll(0);
  assert.equal(input.action.forward, 1);
  fire('keyup', { code: 'KeyW' });
});

test('key capture: next key goes to the callback (Escape gives null) and is not treated as a flight key', () => {
  const input = createInput();
  const got = [];
  input.capture = (c) => got.push(c);
  fire('keydown', { code: 'KeyJ' });
  assert.deepEqual(got, ['KeyJ']);
  assert.equal(input.capture, null);
  input.capture = (c) => got.push(c);
  fire('keydown', { code: 'Escape' });
  assert.deepEqual(got, ['KeyJ', null]);
});

test('rumble only fires on a gamepad with the option on; pads without a motor are ignored', () => {
  const input = createInput();
  const calls = [];
  const pad = { connected: true, id: 'x', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    vibrationActuator: { playEffect: (t, o) => calls.push([t, o.duration]) } };
  pads = [pad];
  input.poll(1 / 60);
  input.rumble(0.5, 100);                 // keyboard is still the active device
  assert.equal(calls.length, 0);
  input.rumble(0.5, 100, true);           // forced (test button)
  assert.deepEqual(calls, [['dual-rumble', 100]]);
  pad.buttons[0] = { pressed: true, value: 1 };
  input.poll(1 / 60);
  assert.equal(input.device, 'gamepad');
  input.rumble(0.5, 120);
  assert.equal(calls.length, 2);
  input.rumbleOn = false;
  input.rumble(0.5, 120);
  assert.equal(calls.length, 2);
  pads = [{ ...pad, vibrationActuator: undefined }];
  input.rumble(0.5, 120, true);           // no actuator: no error
  pads = [];
});

test('settings screens: values step, clamp and write through the callbacks', () => {
  assert.equal(stepList([30, 60], 60, 1), 30);
  assert.equal(stepNum(0.5, 0.3, 1, 0.1, -1), 0.4);
  assert.equal(stepNum(0.3, 0.3, 1, 0.1, -1), 0.3);
  const calls = [];
  const cb = { set: (p, v) => calls.push([p, v]), remap() {}, resetKeys() {}, back() {}, test() {}, preset: (p) => calls.push(['preset', p]), setCustom: (p, v) => calls.push(['custom', p, v]) };
  const get = () => S.DEFAULT_SETTINGS;
  const kb = keyboardSpec(get, () => 'photo', cb);
  kb.items[0].step(-1); kb.items[1].step(-1);
  assert.deepEqual(calls, [['keyboard.sensitivity', 0.9], ['keyboard.ramp', 4]]);
  assert.match(kb.items.find((i) => i.label === 'Foto').note, /tekan tombol/);
  const c = controllerSpec(get, cb);
  c.items[0].step(1); c.items[3].step(1); c.items[2].step(-1);
  assert.deepEqual(calls.slice(2), [['controller.mode', 1], ['controller.invertY', true], ['controller.deadzone', 0.1]]);
  const g = graphicsSpec(get, cb);
  g.items[0].step(1); g.items[2].step(-1); g.items[3].step(1);
  assert.deepEqual(calls.slice(5), [['preset', 'high'], ['custom', 'graphics.renderScale', 0.7], ['custom', 'graphics.shadows', false]]);
});
