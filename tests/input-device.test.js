// Integration test for createInput() with a fake window and fake gamepad (no browser needed).
import test from 'node:test';
import assert from 'node:assert/strict';

const handlers = {};
globalThis.window = { addEventListener: (t, f) => { (handlers[t] ||= []).push(f); } };
let pads = [];
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });

const { createInput } = await import('../src/input.js');
const { events } = await import('../src/events.js');

const fire = (type, ev) => (handlers[type] || []).forEach((f) => f({ preventDefault() {}, ...ev }));
const btn = (pressed = false, value = pressed ? 1 : 0) => ({ pressed, value });
function makePad(over = {}) {
  const buttons = Array.from({ length: 17 }, () => btn());
  return { connected: true, id: 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)', axes: [0, 0, 0, 0], buttons, ...over };
}

test('keyboard and gamepad both reach the same action; device and hints switch without reload', () => {
  const input = createInput();
  const seen = [];
  events.on('input', (e) => seen.push(e.name));

  // keyboard: W + E
  fire('keydown', { code: 'KeyW' }); fire('keydown', { code: 'KeyE' });
  input.poll(1 / 60);
  assert.equal(input.device, 'keyboard');
  assert.deepEqual(input.action, { forward: 1, yaw: 1, climb: 0, strafe: 0 });
  fire('keyup', { code: 'KeyW' }); fire('keyup', { code: 'KeyE' });

  // gamepad appears (centered), then the right stick goes up (Mode 2 -> forward)
  pads = [makePad()];
  input.poll(1 / 60);
  assert.equal(input.device, 'keyboard'); // a resting pad does not steal control
  pads = [makePad({ axes: [0, 0, 0, -1] })];
  input.poll(1 / 60);
  assert.equal(input.device, 'gamepad');
  assert.equal(input.action.forward, 1);
  assert.equal(input.padType, 'xbox');

  // stick returns to center, then keyboard again
  pads = [makePad()];
  input.poll(1 / 60);
  fire('keydown', { code: 'KeyD' });
  input.poll(1 / 60);
  assert.equal(input.device, 'keyboard');
  fire('keyup', { code: 'KeyD' });

  // PlayStation pad is detected
  const PS = 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';
  pads = [makePad({ id: PS })]; // new pad id: first poll only primes
  input.poll(1 / 60);
  pads = [makePad({ id: PS, axes: [1, 0, 0, 0] })];
  input.poll(1 / 60);
  assert.equal(input.padType, 'ps');
  assert.equal(input.action.yaw, 1);
  pads = [];
  input.poll(1 / 60);
  assert.equal(input.manual, false);
  assert.ok(Array.isArray(seen));
});

test('hold X (keyboard) or A (gamepad) emits takeoff_land once; a tap does not', () => {
  const input = createInput();
  const seen = [];
  events.on('input', (e) => { if (e.name === 'takeoff_land') seen.push(1); });

  fire('keydown', { code: 'KeyX' });
  for (let i = 0; i < 20; i++) input.poll(1 / 60); // 0.33 s
  assert.ok(input.holdProgress > 0.4 && input.holdProgress < 0.7);
  fire('keyup', { code: 'KeyX' });
  input.poll(1 / 60);
  assert.equal(seen.length, 0);

  const pad = makePad(); pad.buttons[0] = btn(true); pads = [pad];
  for (let i = 0; i < 60; i++) input.poll(1 / 60); // 1 s
  assert.equal(seen.length, 1);
  pads = [];
  input.poll(1 / 60);
});

test('button impulses: B home, X photo, RT spray on/off', () => {
  const input = createInput();
  const seen = [];
  events.on('input', (e) => seen.push(e.name + (e.on === undefined ? '' : ':' + e.on)));
  const pad = makePad(); pads = [pad];
  input.poll(1 / 60);
  pad.buttons[1] = btn(true); pad.buttons[2] = btn(true); pad.buttons[7] = btn(true);
  input.poll(1 / 60);
  pad.buttons[1] = btn(); pad.buttons[2] = btn(); pad.buttons[7] = btn();
  input.poll(1 / 60);
  assert.ok(seen.includes('home') && seen.includes('photo'));
  assert.ok(seen.includes('spray:true') && seen.includes('spray:false'));
  pads = [];
});

test('controller turned off: control returns to the keyboard immediately and the drone stops', () => {
  const input = createInput();
  pads = [makePad()];
  input.poll(1 / 60);
  pads = [makePad({ axes: [0, 0, 0, -1] })];
  input.poll(1 / 60);
  assert.equal(input.device, 'gamepad');
  assert.equal(input.action.forward, 1);

  pads = []; // browser stops reporting the pad
  input.poll(1 / 60);
  assert.equal(input.device, 'keyboard');
  assert.equal(input.action.forward, 0);
  assert.equal(input.manual, false);
});

test('gamepaddisconnected event also switches to the keyboard, even if stale data is still reported', () => {
  const input = createInput();
  pads = [makePad()];
  input.poll(1 / 60);
  pads = [makePad({ axes: [0, 0, 0, -1] })];
  input.poll(1 / 60);
  assert.equal(input.device, 'gamepad');
  fire('gamepaddisconnected', {});
  assert.equal(input.device, 'keyboard');
  pads = [];
});

test('a frozen pad value does not steal control after a key press (only changes count as activity)', () => {
  const input = createInput();
  pads = [makePad()];
  input.poll(1 / 60);
  pads = [makePad({ axes: [0, 0, 0, -1] })];
  input.poll(1 / 60);
  assert.equal(input.device, 'gamepad');
  fire('keydown', { code: 'KeyA' });
  for (let i = 0; i < 10; i++) input.poll(1 / 60); // same frozen stick value every frame
  assert.equal(input.device, 'keyboard');
  assert.equal(input.action.strafe, -1);
  assert.equal(input.action.forward, 0);
  fire('keyup', { code: 'KeyA' });
  pads = [];
});

test('non-standard pad whose axes[3] rests at -1 (trigger): right stick is NOT stuck forward', () => {
  const input = createInput();
  // DirectInput-style DualShock: [LX, LY, RX, L2, R2, RY, hat]; triggers rest at -1, hat beyond 1.
  const rest = [0, 0, 0, -1, -1, 0, 3.2857];
  pads = [makePad({ mapping: '', id: 'Wireless Controller (Vendor: 054c Product: 09cc)', axes: rest })];
  input.poll(1 / 60);
  input.poll(1 / 60);
  assert.equal(input.manual, false);
  assert.equal(input.action.forward, 0);
  // push the real right stick up (axes[5] = -1)
  pads = [makePad({ mapping: '', id: 'Wireless Controller (Vendor: 054c Product: 09cc)', axes: [0, 0, 0, -1, -1, -1, 3.2857] })];
  input.poll(1 / 60);
  assert.equal(input.device, 'gamepad');
  assert.equal(input.action.forward, 1);
  pads = [];
});

test('menuMode: keys and pad buttons become nav events, drone gets no action, no takeoff after closing the menu', () => {
  const input = createInput();
  const nav = [], seen = [];
  events.on('nav', (e) => nav.push(e.dir));
  events.on('input', (e) => seen.push(e.name));
  input.menuMode = true;
  fire('keydown', { code: 'ArrowDown' }); fire('keydown', { code: 'Enter' }); fire('keydown', { code: 'Escape' });
  fire('keydown', { code: 'KeyW' });
  input.poll(1 / 60);
  assert.deepEqual(nav, ['down', 'ok', 'back', 'up']);
  assert.deepEqual(input.action, { forward: 0, yaw: 0, climb: 0, strafe: 0 });
  fire('keyup', { code: 'KeyW' });

  pads = [makePad()];
  input.poll(1 / 60);
  const a = makePad(); a.buttons[0] = btn(true); a.buttons[13] = btn(true);
  pads = [a];
  input.poll(1 / 60);
  assert.deepEqual(nav.slice(4), ['ok', 'down'].sort((x, y) => nav.slice(4).indexOf(x) - nav.slice(4).indexOf(y)));
  // menu closes while A is still held: 1 s later there must be no takeoff_land
  const before = seen.filter((n) => n === 'takeoff_land').length;
  input.menuMode = false;
  for (let i = 0; i < 60; i++) input.poll(1 / 60);
  assert.equal(seen.filter((n) => n === 'takeoff_land').length, before);
  // release, then a real hold works again
  pads = [makePad()];
  input.poll(1 / 60);
  const held = makePad(); held.buttons[0] = btn(true);
  pads = [held];
  for (let i = 0; i < 45; i++) input.poll(1 / 60);
  assert.equal(seen.filter((n) => n === 'takeoff_land').length, before + 1);
  pads = [];
});
