// Main loop and app flow. Fixed 1/60 s physics (accumulator) decoupled from rendering, with measured FPS.
// States: menu -> play <-> paused -> result -> menu. Everything the player sees comes from a world config.
import * as THREE from 'three';
import './hud.css';
import { STEP } from './config.js';
import { Flight } from './flight.js';
import { buildWorld } from './world.js';
import { makeMissionConfig, normalizeConfig } from './worldconfig.js';
import { createDrone } from './drone.js';
import { FollowCamera } from './camera.js';
import { createInput } from './input.js';
import { Autopilot } from './autopilot.js';
import { buildHints } from './bindings.js';
import { createHud, PIP_VIEW, actionLabel } from './hud.js';
import { createMenu } from './ui.js';
import { createEditor } from './editor.js';
import { Commander } from './commander.js';
import { parseNatural } from './nlparse.js';
import { canSee } from './vision.js';
import { mainMenuSpec, missionSpec, resultSpec, pauseSpec, helpSpec } from './screens.js';
import { MISSIONS, getMission, MissionRun } from './missions.js';
import { Battery } from './battery.js';
import { createGateway } from './gateway.js';
import { events } from './events.js';

const W = 1280, H = 720; // the stage is always 16:9; the window letterboxes it
const GATEWAY_URL = import.meta.env?.VITE_GATEWAY_URL || 'http://localhost:8000';

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 500);

function layout() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  // Render at the real on-screen resolution (capped), not at the CSS 1280x720 size.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * s);
  renderer.setSize(W, H);
}
window.addEventListener('resize', layout);
layout();

// ---- objects that live for the whole app ----
let config = normalizeConfig(makeMissionConfig('freeroam', 42));
let world = buildWorld(scene, config);
let sim = new Flight();
const drone = createDrone(scene);
const chase = new FollowCamera(camera);
const input = createInput();
const autopilot = new Autopilot();
const hud = createHud(document.getElementById('hud'), config);
const menu = createMenu(stage);
const gateway = createGateway(GATEWAY_URL);

// Script runner: it drives the drone through applyAction() like every other input source.
const commander = new Commander({
  autopilot,
  detect: (label) => canSee(label, sim.pos, sim.yaw, config, session ? session.extraBoxes : []),
  battery: () => (session ? session.battery.level : 100),
  setGimbal: (deg) => drone.setGimbalPitch(deg),
  act(name) {
    if (name === 'pickup' || name === 'drop') {
      const run = session && session.run;
      if (!run || run.def.id !== 'm4_delivery') return `${name}: tidak ada paket di mode ini`;
      if (name === 'pickup' && run.carrying) return 'pickup: paket sudah dibawa';
      if (name === 'drop' && !run.carrying) return 'drop: tidak sedang membawa paket';
      return run.pickupDrop(sim);
    }
    toast(`${actionLabel(name)} (belum terhubung)`);
    return `${name}: belum terhubung ke sistem misi`;
  },
});
const editor = createEditor(stage, {
  onOpen: () => input.releaseAll(),
  onClose: () => {},
  onRun: (src) => runScript(src, false),
  onStep: (src) => (commander.state === 'paused' ? commander.resume() : runScript(src, true)),
  onStop: () => commander.stop('Dihentikan pemain'),
  onNatural: translate,
});
commander.onLog = (e) => editor.log(e);

function runScript(src, stepMode) {
  const r = commander.load(src, config.bounds);
  if (!r.ok) {
    for (const er of r.errors) editor.logText(`Baris ${er.line}: ${er.message}`, 'error');
    return;
  }
  autopilot.cancel();
  commander.start(stepMode);
  if (stepMode) commander.resume();
}

// Natural language: local parser first, then the LLM through the gateway. Never throws.
async function translate(text) {
  const local = parseNatural(text);
  if (local) { editor.logText(`Terjemahan lokal: ${local.script.split('\n').length} perintah`, 'ok'); return local; }
  editor.logText('Menghubungi server AI...');
  const ctx = { pose: { pos: sim.pos.slice(), yaw: sim.yaw }, battery: Math.round(session ? session.battery.level : 100), mission_id: session && session.def ? session.def.id : 'freeroam' };
  const r = await gateway.command(text, ctx);
  refreshGatewayLabel();
  if (!r.ok) { editor.logText(`${r.message}. Hanya perintah umum (naik, mendarat, putar 360, ...) yang bisa dipakai tanpa AI.`, 'warn'); return null; }
  editor.logText(`Terjemahan ${r.source === 'llm' ? 'LLM' : 'lokal'}${(r.warnings || []).length ? `: ${r.warnings.join('; ')}` : ''}`, 'ok');
  return r;
}

// ---- app state ----
let state = 'menu';           // menu | play | paused | result
let session = null;           // { kind: 'mission' | 'freeroam', def, run, runId, battery, extra }
let panelOpen = false;
const assist = [              // freeroam side panel toggles (not connected to the AI server yet)
  { label: 'Deteksi objek', on: false }, { label: 'Jalur A*', on: false },
  { label: 'Auto-hindari', on: false }, { label: 'Auto-pilot', on: false },
];
let hintContext = 'latihan', hintDevice = '', hintType = '';
let flightTime = 0;
const toast = (text) => hud.toast(text, performance.now());

function setMenuMode(on) { input.menuMode = on; }
function refreshGatewayLabel() {
  hud.setGateway(gateway.mode === 'online' ? 'Tersambung' : 'Mode lokal (stub)');
  hud.setAi(gateway.ai ? 'Server AI terhubung' : 'AI offline');
}
gateway.check().then(refreshGatewayLabel);
setInterval(() => gateway.check().then(refreshGatewayLabel), 10000); // the gateway or the AI may come and go

// Replace the world, the drone state and the HUD map in one place (used by every mission start).
function loadWorld(cfg) {
  world.dispose();
  config = normalizeConfig(cfg);
  world = buildWorld(scene, config);
  sim = new Flight();
  commander.stop('Dunia diganti');
  autopilot.cancel();
  chase.ready = false;
  flightTime = 0;
  panelOpen = false;
  hud.setWorld(config);
}

// ---- screens ----
const cbMain = () => showMain();
function showMain() {
  editor.close(); commander.stop('Kembali ke menu');
  state = 'menu'; setMenuMode(true); hud.setVisible(false);
  menu.open(mainMenuSpec({
    quickStart: () => startMission(getMission('latihan_terbang')),
    missions: showMissions,
    freeroam: startFreeroam,
    editor: () => { startFreeroam(); editor.open(); },
    help: () => menu.open(helpSpec({ back: showMain })),
  }));
}

async function showMissions() {
  await gateway.check();
  refreshGatewayLabel();
  menu.open(missionSpec(MISSIONS, gateway.mode, { start: startMission, back: showMain }));
}

function enterPlay(context, title) {
  menu.close(); setMenuMode(false); state = 'play'; hud.setVisible(true);
  hintContext = context; hintDevice = ''; // force the hint bar to rebuild
  hud.setTitle(title);
  hud.setPanel(false, assist);
}

async function startMission(def) {
  menu.open({ title: 'Memuat misi...', subtitle: def.title, items: [] });
  let cfg, runId = null;
  if (def.tier === 'utama') {
    const r = await gateway.startRun({ mission_id: def.id, variant: 'kota', player: 'pemain' });
    cfg = r.config; runId = r.run_id;
    refreshGatewayLabel();
  } else {
    cfg = makeMissionConfig(def.id, 42);
  }
  loadWorld(cfg);
  const run = new MissionRun(def.id, config, (type, e) => { if (runId) gateway.event(runId, e); });
  session = { kind: 'mission', def, run, runId, battery: new Battery(config.battery), extraBoxes: [] };
  enterPlay(def.id === 'm4_delivery' ? 'delivery' : 'latihan', def.title);
}

function startFreeroam() {
  loadWorld(makeMissionConfig('freeroam', 42));
  session = { kind: 'freeroam', def: null, run: null, runId: null, battery: new Battery(config.battery), extra: 0, extraBoxes: [] };
  enterPlay('freeroam', 'Freeroam');
}

function pauseGame() {
  editor.close();
  state = 'paused'; setMenuMode(true);
  menu.open(pauseSpec({
    resume: () => { menu.close(); setMenuMode(false); state = 'play'; last = performance.now(); },
    retry: () => (session.kind === 'mission' ? startMission(session.def) : startFreeroam()),
    main: showMain,
  }));
}

async function endMission() {
  editor.close(); commander.stop('Misi berakhir');
  state = 'result'; setMenuMode(true);
  const run = session.run, level = Math.round(session.battery.level);
  const fin = { t_ms: run.tMs, battery: level, reason: run.reason };
  let res = null, official = false;
  if (session.runId) {
    res = await gateway.finish(session.runId, fin);
    official = gateway.official && !res.offline;
    if (res.offline) res = null;
  }
  if (!res) res = run.result(level); // practice missions, or a gateway that dropped out: provisional score
  menu.open(resultSpec(session.def, run.reason, res, official, {
    retry: () => startMission(session.def),
    missions: showMissions,
    main: showMain,
  }));
}

// ---- discrete input events ----
events.on('input', (e) => {
  if (state !== 'play') return;
  if (e.name === 'takeoff_land') {
    if (sim.mode === 'landed') { sim.takeoff(5); toast('Takeoff 5 m'); }
    else { autopilot.cancel(); sim.land(); toast('Mendarat'); }
  } else if (e.name === 'home') {
    toast(autopilot.start(sim) ? 'Return home' : 'Return home: drone harus sedang terbang');
  } else if (e.name === 'pause') {
    pauseGame();
  } else if (e.name === 'camera_next' || e.name === 'camera_prev') {
    toast(chase.cycle(e.name === 'camera_next' ? 1 : -1).label);
  } else if (e.name === 'pickup_drop') {
    const msg = session.run && session.run.pickupDrop(sim);
    toast(msg || 'Tidak ada paket di mode ini');
  } else if (e.name === 'add_object') {
    if (session.kind !== 'freeroam') { toast('Tambah objek hanya di freeroam'); return; }
    const yaw = (sim.yaw * Math.PI) / 180;
    const b = world.addBox(sim.pos[0] + Math.sin(yaw) * 8, sim.pos[2] - Math.cos(yaw) * 8);
    if (b) { hud.addMapBox(b); session.extra++; session.extraBoxes.push(b); toast('Objek ditambah'); } else toast('Batas objek tercapai');
  } else if (e.name === 'panel_ai') {
    if (session.kind !== 'freeroam') { toast('Panel hanya di freeroam'); return; }
    panelOpen = !panelOpen;
    hud.setPanel(panelOpen, assist);
  } else if (e.name === 'command') {
    if (editor.isOpen) editor.close(); else editor.open();
  } else if (e.name === 'spray') {
    toast(`${actionLabel('spray')} ${e.on ? 'ON' : 'OFF'} (belum terhubung)`);
  } else {
    toast(`${actionLabel(e.name)} (belum terhubung)`);
  }
});
window.addEventListener('keydown', (e) => { // panel toggles 1-4 (keyboard only for now)
  if (state !== 'play' || !panelOpen || !/^Digit[1-4]$/.test(e.code) || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  const a = assist[Number(e.code.slice(5)) - 1];
  a.on = !a.on;
  hud.setPanel(true, assist);
});

showMain();

// ---- timing and FPS (no allocations inside the loop, except the 10 Hz HUD/telemetry tick) ----
let last = performance.now();
let acc = 0;
let frames = 0, fpsTime = 0, fps = 0, msAvg = 16.7, hudTime = 0;
const tmpView = { x: PIP_VIEW.x, y: H - PIP_VIEW.y - PIP_VIEW.h, w: PIP_VIEW.w, h: PIP_VIEW.h };

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  const raw = dt;
  if (dt > 0.1) dt = 0.1; // tab was hidden or a long stall: do not simulate a huge step

  input.poll(dt);
  if (autopilot.active && input.manual) autopilot.cancel(); // the pilot always wins
  if (commander.running && input.manual) commander.stop('Dibatalkan: pilot menggerakkan kontrol');

  // Fixed-step physics, only while playing. Max 5 steps per frame to avoid a spiral of death.
  if (state === 'play') {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) {
      if (commander.state === 'running') commander.step(STEP, sim);
      else if (commander.state === 'paused') { /* step mode: hold still until the next Langkah */ }
      else if (autopilot.active) autopilot.step(sim);
      else sim.applyAction(input.action); // single entry point for every input source
      sim.step(STEP, world.colliders);
      world.update(sim.pos);
      const airborne = sim.mode !== 'landed';
      const run = session.run;
      if (session.kind === 'mission') {
        session.battery.step(STEP, airborne, Math.hypot(sim.vel[0], sim.vel[1], sim.vel[2]), run.payloadKg);
        run.step(STEP, sim, session.battery.level, world.passedCount, world.rings.length);
      } else if (airborne) flightTime += STEP;
      acc -= STEP;
      n++;
      if (run && run.done) { endMission(); break; }
    }
    if (n === 5) acc = 0;
  }

  // Render with interpolation between the last two physics states.
  const alpha = acc / STEP;
  drone.update(sim, alpha, dt);
  chase.update(drone.group.position, sim.prevYaw + (sim.yaw - sim.prevYaw) * alpha, dt);
  world.followLight(drone.group.position.x, drone.group.position.z);
  renderer.render(scene, camera);

  // Second pass for the PIP drone camera: same scene, small scissored viewport.
  renderer.setScissorTest(true);
  renderer.setViewport(tmpView.x, tmpView.y, tmpView.w, tmpView.h);
  renderer.setScissor(tmpView.x, tmpView.y, tmpView.w, tmpView.h);
  renderer.render(scene, drone.pipCamera);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);

  // FPS over 0.5 s windows; HUD text refreshes 10 times per second.
  frames++;
  fpsTime += raw;
  msAvg += (raw * 1000 - msAvg) * 0.05;
  if (fpsTime >= 0.5) { fps = frames / fpsTime; frames = 0; fpsTime = 0; }

  hud.setHold(input.holdProgress);
  if (input.device !== hintDevice || input.padType !== hintType) { // rebuild hints only on change
    hintDevice = input.device; hintType = input.padType;
    hud.setHints(buildHints(hintContext, hintDevice, hintType));
  }
  hudTime += raw;
  if (hudTime >= 0.1) {
    hudTime = 0;
    hud.setDebug(input.debugOn ? input.debugText() : '');
    editor.sync(commander.state, commander.active);
    if (state === 'play' || state === 'paused') updateHud(now);
  }
}

function updateHud(now) {
  const run = session.run;
  const tel = sim.telemetry();
  const level = session.battery.level;
  hud.update({
    tel, fps, ms: msAvg, battery: level,
    flightTime: run ? run.t : flightTime,
    collisions: sim.collisionCount,
    goalText: run ? run.text || 'Lepas landas (tahan X / A)' : `Terbang bebas · objek ditambah: ${session.extra}`,
    progress: run ? run.progress : 0,
    rings: world.rings,
    deviceLabel: input.device === 'gamepad' ? `Controller (${input.padType === 'ps' ? 'PlayStation' : 'Xbox'})` : 'Keyboard',
  }, now);
  if (state === 'play' && session.runId) { // official runs: 10 Hz telemetry to the gateway
    gateway.telemetry({
      t_ms: run.tMs, pos: tel.pos, vel: tel.vel, yaw: tel.yaw, roll: tel.roll, pitch: tel.pitch,
      battery: Math.round(level), payload_kg: run.payloadKg, spraying: false, collision: tel.collision,
    });
  }
}
requestAnimationFrame(frame);
