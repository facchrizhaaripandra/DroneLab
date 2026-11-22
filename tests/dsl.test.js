import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, compile, SAMPLE_SCRIPT, MAX_STATEMENTS } from '../src/dsl.js';
import { Commander } from '../src/commander.js';
import { Autopilot } from '../src/autopilot.js';
import { Flight } from '../src/flight.js';
import { parseNatural } from '../src/nlparse.js';
import { canSee } from '../src/vision.js';
import { makeMissionConfig } from '../src/worldconfig.js';

const msgs = (src) => parse(src).errors.map((e) => e.message).join(' | ');

test('DSL accepts the spec examples (one-liner and the multi-line inspection script)', () => {
  assert.equal(parse(SAMPLE_SCRIPT).ok, true);
  const multi = 'takeoff(10);\nrepeat(4) {\n  photo();\n  rotate(90);\n  move(maju, 15);\n}\nif (detect("defect")) { mark(); photo(); }\nreturn_home();';
  const r = parse(multi);
  assert.equal(r.ok, true, msgs(multi));
  assert.equal(r.ast[1].line, 2);
  assert.equal(parse('if (battery < 30) { land(); } else { hover(1); }').ok, true);
  assert.equal(parse('record("start"); spray("off"); goto(1, 2, 10); look(-45); rotate(-90);').ok, true);
});

test('DSL rejects everything outside the table, with a line number', () => {
  assert.match(msgs('foo();'), /tidak dikenal/);
  assert.match(msgs('takeoff(99);'), /di luar batas/);
  assert.match(msgs('takeoff(0);'), /di luar batas/);
  assert.match(msgs('hover(0.1);'), /di luar batas/);
  assert.match(msgs('rotate(721);'), /di luar batas/);
  assert.match(msgs('look(31);'), /di luar batas/);
  assert.match(msgs('move(atas, 3);'), /salah satu dari/);
  assert.match(msgs('move(maju, 101);'), /di luar batas/);
  assert.match(msgs('goto(101, 0);'), /di luar batas peta/);
  assert.match(msgs('repeat(21) { photo(); }'), /1 sampai 20/);
  assert.match(msgs('repeat(2.5) { photo(); }'), /bilangan bulat/);
  assert.match(msgs('if (detect("cat")) { photo(); }'), /tidak dikenal/);
  assert.match(msgs('if (x > 3) { photo(); }'), /Kondisi tidak dikenal/);
  assert.match(msgs('detect("person");'), /hanya boleh/);
  assert.match(msgs('photo()'), /";"/);
  assert.match(msgs('takeoff(5, 6);'), /";"|"\)"/);
  assert.match(msgs('x = 5;'), /tidak dikenal|Diharapkan/);
  assert.match(msgs('while (1) { photo(); }'), /tidak dikenal/);
  assert.match(msgs(''), /kosong/);
  assert.equal(parse('photo();\nland();\nfoo();').errors[0].line, 3);
});

test('limit is 60 statements (not lines): 60 ok on one line, 61 rejected', () => {
  assert.equal(parse('photo(); '.repeat(MAX_STATEMENTS)).ok, true);
  assert.match(msgs('photo(); '.repeat(MAX_STATEMENTS + 1)), /maksimal 60/);
});

test('compile turns repeat and if/else into jumps', () => {
  const { prog, counters } = compile(parse('repeat(2) { photo(); } if (battery < 5) { land(); } else { hover(1); }').ast);
  assert.equal(counters, 1);
  assert.deepEqual(prog.map((i) => i.op), ['rep', 'cmd', 'loop', 'if', 'cmd', 'jmp', 'cmd']);
});

// ---- runtime, against the real flight model ----
function rig(over = {}) {
  const sim = new Flight();
  const logs = [], acts = [];
  const ap = new Autopilot();
  const cmd = new Commander({
    autopilot: ap, detect: over.detect || (() => false), battery: over.battery || (() => 100),
    act: (n, a) => { acts.push(a === undefined ? n : `${n}:${a}`); return null; }, setGimbal: (d) => acts.push(`look:${d}`),
  });
  cmd.onLog = (e) => logs.push(e.text);
  const run = (seconds, stopWhen = () => cmd.state === 'done' || cmd.state === 'error') => {
    for (let i = 0; i < seconds * 60 && !stopWhen(); i++) { cmd.step(1 / 60, sim); sim.step(1 / 60, []); }
  };
  return { sim, cmd, logs, acts, run };
}

test('the spec sample script runs to the end on the real flight model and marks the active statement', () => {
  const { sim, cmd, logs, run } = rig({ detect: () => true });
  assert.equal(cmd.load(SAMPLE_SCRIPT).ok, true);
  cmd.start();
  const seen = new Set();
  run(120, () => { if (cmd.active) seen.add(cmd.active.start); return cmd.state === 'done' || cmd.state === 'error'; });
  assert.equal(cmd.state, 'done', logs.join('\n'));
  assert.equal(sim.mode, 'landed');
  assert.ok(Math.hypot(sim.pos[0] - 5, sim.pos[2] - 2) < 1.5, `ended at ${sim.pos}`);
  assert.ok(seen.size >= 5, 'each statement was highlighted at some point');
  assert.ok(logs.some((l) => l.includes('hover(3)')), 'detect true -> hover ran');
  assert.ok(logs.filter((l) => l.startsWith('OK')).length >= 5);
});

test('if/else follows the condition; repeat runs the block n times; instant commands reach the context', () => {
  const a = rig({ detect: () => false });
  a.cmd.load('takeoff(3); repeat(3) { photo(); } if (detect("person")) { mark(); } else { record("start"); } look(-30); land();');
  a.cmd.start();
  a.run(60);
  assert.equal(a.cmd.state, 'done');
  assert.deepEqual(a.acts, ['photo', 'photo', 'photo', 'record:start', 'look:-30']);
  const b = rig({ detect: () => true, battery: () => 10 });
  b.cmd.load('takeoff(3); if (detect("person")) { mark(); } if (battery < 30) { spray("on"); } if (battery > 30) { drop(); } land();');
  b.cmd.start();
  b.run(60);
  assert.deepEqual(b.acts, ['mark', 'spray:on']);
});

test('rotate turns by the given angle (relative), both ways', () => {
  const { sim, cmd, run } = rig();
  cmd.load('takeoff(5); rotate(90); rotate(-45); rotate(360);');
  cmd.start();
  run(60);
  assert.equal(cmd.state, 'done');
  assert.ok(Math.abs(sim.yaw - 405) < 3, `yaw ${sim.yaw}`);
});

test('move goes where it says, relative to the heading', () => {
  const { sim, cmd, run } = rig();
  cmd.load('takeoff(5); move(maju, 10); move(kanan, 6); move(naik, 5); move(turun, 3);');
  cmd.start();
  run(90);
  assert.equal(cmd.state, 'done');
  assert.ok(Math.abs(sim.pos[2] + 10) < 1 && Math.abs(sim.pos[0] - 6) < 1, `pos ${sim.pos.map((v) => v.toFixed(1))}`);
  assert.ok(Math.abs(sim.pos[1] - 7) < 1, `alt ${sim.pos[1]}`);
});

test('step mode runs one command per press; stop halts and zeroes the drone input', () => {
  const { sim, cmd, run, logs } = rig();
  cmd.load('takeoff(4); hover(1); land();');
  cmd.start(true);
  assert.equal(cmd.state, 'paused');
  run(5, () => false);                       // paused: nothing happens
  assert.equal(sim.mode, 'landed');
  cmd.resume(); run(30, () => cmd.state === 'paused');
  assert.equal(cmd.state, 'paused');
  assert.equal(sim.mode, 'flying');
  assert.equal(logs.filter((l) => l.startsWith('OK')).length, 1);
  cmd.resume(); run(5, () => cmd.state === 'paused');
  cmd.resume();
  run(1, () => false);
  cmd.stop('Dihentikan pemain');
  assert.equal(cmd.state, 'idle');
  assert.deepEqual(cmd.a, { yaw: 0, climb: 0, strafe: 0, forward: 0 });
});

test('flight commands on the ground fail with a clear error instead of hanging', () => {
  const { cmd, run, logs } = rig();
  cmd.load('move(maju, 5);');
  cmd.start();
  run(2);
  assert.equal(cmd.state, 'error');
  assert.match(logs.join('\n'), /takeoff\(\) dulu/);
});

test('return_home flies back and lands', () => {
  const { sim, cmd, run } = rig();
  cmd.load('takeoff(5); goto(20, 10); return_home();');
  cmd.start();
  run(150);
  assert.equal(cmd.state, 'done');
  assert.equal(sim.mode, 'landed');
  assert.ok(Math.hypot(sim.pos[0], sim.pos[2]) < 2);
});

test('natural language: common phrases parse locally and give valid DSL; unknown phrases return null', () => {
  const ok = (t) => { const r = parseNatural(t); assert.ok(r, t); assert.equal(parse(r.script).ok, true, r.script); return r.script; };
  assert.equal(ok('naik 5 meter'), 'move(naik, 5);');
  assert.equal(ok('Mendarat'), 'land();');
  assert.equal(ok('putar 360'), 'rotate(360);');
  assert.equal(ok('putar kiri 45 derajat'), 'rotate(-45);');
  assert.equal(ok('lepas landas 10 meter'), 'takeoff(10);');
  assert.equal(ok('maju 12, lalu foto, kemudian pulang'), 'move(maju, 12);\nphoto();\nreturn_home();');
  assert.equal(ok('melayang 2,5 detik'), 'hover(2.5);');
  assert.equal(ok('mulai rekam dan berhenti rekam'), 'record("start");\nrecord("stop");');
  assert.equal(parseNatural('foto hotel dari tiga sudut'), null);
  assert.equal(parseNatural('naik lalu terbangkan pesawat ke bulan'), null);
  assert.equal(parseNatural('   '), null);
  assert.match(parseNatural('naik 500').script, /500/); // out of range is caught later by the DSL validator
  assert.equal(parse(parseNatural('naik 500').script).ok, false);
});

test('local vision: view cone, range and the labels this world can show', () => {
  const cfg = makeMissionConfig('m4_delivery', 42);
  const d = cfg.mission.drop;
  const yawToDrop = (Math.atan2(d.x, -d.z) * 180) / Math.PI;
  const near = [d.x * 0.5, 5, d.z * 0.5];
  assert.equal(canSee('dropzone', near, yawToDrop, cfg), true);
  assert.equal(canSee('dropzone', near, yawToDrop + 180, cfg), false);
  assert.equal(canSee('person', near, yawToDrop, cfg), false);
  const b = cfg.buildings[0];
  assert.equal(canSee('building', [b.x, 5, b.z + 10], 0, cfg), true);
  assert.equal(canSee('obstacle', [0, 5, 0], 0, { ...cfg, obstacles: [] }, [{ x: 0, z: -10 }]), true);
});
