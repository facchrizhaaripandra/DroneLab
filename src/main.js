// Main loop and app flow. Fixed 1/60 s physics (accumulator) decoupled from rendering, with measured FPS.
// States: menu -> play <-> paused -> result -> menu. Everything the player sees comes from a world config.
import * as THREE from 'three';
import './hud.css';
import { STEP } from './config.js';
import { Flight, ALT_GRACE, ALT_FAIL } from './flight.js';
import { ZOOM } from './camera-model.js';
import { heatAt, HEAT_RATE, FIRE_WARN } from './fire.js';
const GIMBAL_RATE = 45; // derajat per detik, kecepatan gimbal drone konsumen (sekitar 20-100)
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
import { swathWidth } from './agri.js';
import { inspectionReport } from './scoring.js';
import { mainMenuSpec, missionSpec, resultSpec, pauseSpec, helpSpec, settingsMenuSpec, keyboardSpec, controllerSpec, stickTestSpec, graphicsSpec, sceneSpec } from './screens.js';
import { loadSceneIndex, loadScene, prepareScene, realSceneConfig } from './realworld.js';
import { loadSettings, saveSettings, sanitize, remapKey, applyPreset, markCustom } from './settings.js';
import { DEFAULT_KEYS } from './bindings.js';
import { AdaptiveQuality } from './quality.js';
import { MISSIONS, getMission, MissionRun } from './missions.js';
import { Battery } from './battery.js';
import { AabbPhysics, createPhysics } from './physics.js';
import { DroneDamage } from './damage.js';
import { createGateway } from './gateway.js';
import { events } from './events.js';

const W = 1280, H = 720; // the stage is always 16:9; the window letterboxes it
const GATEWAY_URL = import.meta.env?.VITE_GATEWAY_URL || 'http://localhost:8000';

// localStorage can throw (blocked cookies, private mode): fall back to a store that remembers nothing.
const store = (() => { try { return window.localStorage; } catch { return { getItem: () => null, setItem() {} }; } })();
let settings = loadSettings(store);
const aq = new AdaptiveQuality(); // may lower the render scale and shadows when FPS is low (never saved)
aq.setTarget(settings.graphics.targetFps);

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // soft shadow edges instead of jagged ones
renderer.toneMapping = THREE.ACESFilmicToneMapping; // filmic highlights: the sky and white roofs no longer clip
renderer.toneMappingExposure = 1.05;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 500);

function layout() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  // Render at the real on-screen resolution (capped), not at the CSS 1280x720 size.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * s * aq.effective(settings.graphics).renderScale);
  renderer.setSize(W, H);
}
window.addEventListener('resize', layout);
layout();

// ---- objects that live for the whole app ----
let config = normalizeConfig(makeMissionConfig('freeroam', 42));
let world = buildWorld(scene, config);
let physics = new AabbPhysics();   // replaced by Rapier as soon as it has loaded (see below)
physics.setStatic(world.colliders);
let sim = new Flight();
const drone = createDrone(scene);
newSim();
const chase = new FollowCamera(camera);
const input = createInput();
const autopilot = new Autopilot();
const hud = createHud(document.getElementById('hud'), config);
const menu = createMenu(stage);
const gateway = createGateway(GATEWAY_URL);

// ---- settings: save, then apply to input, graphics and hints ----
function applyGraphics() {
  world.setShadows(aq.effective(settings.graphics).shadows);
  hud.setScale(settings.graphics.hudScale);
  layout();
}
function commit() {
  saveSettings(store, settings);
  aq.reset(); // the user chose a quality on purpose: start from it again
  aq.setTarget(settings.graphics.targetFps);
  input.applySettings(settings);
  applyGraphics();
  hintDevice = ''; // rebuild the hint bar (key names may have changed)
}
input.applySettings(settings);
applyGraphics();

// Script runner: it drives the drone through applyAction() like every other input source.
const commander = new Commander({
  autopilot,
  detect: (label) => canSee(label, sim.pos, sim.yaw, config, session ? session.extraBoxes : [], { pitch: drone.gimbal, zoom: drone.zoom, thermal }),
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
    const msg = doAction(name, arg);
    return msg ? `${name}: ${msg}` : null;
  },
});
// ---- camera and mission actions (keys, controller and scripts all end up here) ----
let thermal = false;
function setThermal(on) {
  thermal = on;
  world.setThermal(on);
  // Fake thermal camera: grey, high contrast, warm tint. (A filter on the canvas, not a real heat model.)
  renderer.domElement.style.filter = on ? 'grayscale(1) contrast(1.5) sepia(1) hue-rotate(-25deg) saturate(3.5)' : '';
}
function doAction(name, arg) {
  const run = session && session.run;
  if (name === 'thermal') { setThermal(!thermal); return thermal ? 'Mode panas nyala' : 'Mode panas mati'; }
  if (name === 'photo') {
    if (!run) {
      if (sim.mode !== 'flying') return 'terbang dulu';
      if (!drone.cameraOk) return 'kamera pecah';
      hud.flash(); return 'Foto diambil (freeroam: tidak dinilai)';
    }
    const msg = run.photo(sim, thermal);
    if (msg && msg.startsWith('Foto #')) hud.flash();
    return msg;
  }
  if (name === 'record') {
    if (!run) return 'rekam hanya dinilai di misi fotografi';
    if (arg === 'start' && run.recording) return 'sudah merekam';       // record("start") from a script must not stop a running clip
    if (arg === 'stop' && !run.recording) return 'tidak sedang merekam';
    return run.toggleRecord(sim);
  }
  if (name === 'mark') {
    if (!run) return 'tandai hanya dipakai di misi pencarian dan inspeksi';
    const msg = run.mark(sim, thermal);
    if (msg && !msg.startsWith('Tandai:') && !msg.startsWith('Tandai hanya')) {
      world.addMarker(sim.pos[0], 0, sim.pos[2]);
      session.marks.push({ x: sim.pos[0], z: sim.pos[2] });
    }
    return msg;
  }
  if (name === 'spray') {
    if (!run) return 'semprot hanya dipakai di misi penyiraman';
    return run.setSpray(arg === 'on' || arg === true, sim);
  }
  return null;
}

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
let crashTimer = 0;           // freeroam: a wrecked drone is replaced after a few seconds
let seenHits = 0;             // collisions already answered with a rumble
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

// A fresh drone: full health, damage events show up as toasts and on the model.
function newSim() {
  sim = new Flight();
  sim.damage = new DroneDamage();
  sim.wind = config.wind || null;
  const real = config.realScene; // realistic Blender scene: uneven ground and its own map limits
  sim.ground = real ? real.groundAt : null;
  sim.limits = real ? real.limits : null;
  sim.onDamage = (changes) => {
    drone.setDamage(sim.damage);
    for (const c of changes) toast(damageText(c));
  };
  drone.setDamage(sim.damage);
}
const PART_ID = ['kiri-depan', 'kanan-depan', 'kiri-belakang', 'kanan-belakang'];
function damageText(c) {
  const bad = c.state === 'broken';
  if (c.part === 'rotor') return `Baling-baling ${PART_ID[c.index]} ${bad ? 'patah!' : 'rusak'}`;
  if (c.part === 'camera') return bad ? 'Kamera pecah: PIP mati' : 'Kamera retak';
  if (c.part === 'battery') return bad ? 'Baterai bocor parah!' : 'Baterai rusak: boros';
  return bad ? 'Bodi hancur!' : 'Bodi retak';
}

// Replace the world, the drone state and the HUD map in one place (used by every mission start).
function loadWorld(cfg) {
  world.dispose();
  config = normalizeConfig(cfg);
  world = buildWorld(scene, config);
  world.setShadows(aq.effective(settings.graphics).shadows);
  aq.holdFor(4); // a new world compiles shaders and warms caches: do not judge FPS yet
  seenHits = 0;
  physics.setStatic(world.colliders);
  newSim();
  commander.stop('Dunia diganti');
  autopilot.cancel();
  chase.ready = false;
  flightTime = 0;
  panelOpen = false;
  hud.setWorld(config);
  chase.ground = config.realScene ? config.realScene.groundAt : null;
  drone.setGround(chase.ground);
  camera.far = config.realScene ? 2500 : 500; // the mountain scene is 1 km wide
  camera.updateProjectionMatrix();
  drone.pipCamera.far = config.realScene ? 1200 : 400;
  drone.pipCamera.updateProjectionMatrix();
  setThermal(false);
  drone.setSpray(false);
  drone.setGimbalPitch(-10, true);
  drone.setZoom(1, true);
  drone.setGimbalRoll(0, true);
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
    scenes: showScenes,
    editor: () => { startFreeroam(); editor.open(); },
    settings: () => { settingsReturn = showMain; showSettings(); },
    help: () => menu.open(helpSpec({ back: showMain }, settings.keyboard.keys)),
  }));
}

// ---- settings screens ----
function setPath(path, value) { // 'keyboard.ramp' -> settings.keyboard.ramp = value (then sanitized and saved)
  const next = JSON.parse(JSON.stringify(settings));
  const [a, b] = path.split('.');
  next[a][b] = value;
  settings = sanitize(next);
  commit();
}
const settingsBack = () => showSettings();
let settingsReturn = showMain; // where "Kembali" on the settings screen goes: main menu, or the pause menu mid-flight
function showSettings() {
  menu.open(settingsMenuSpec({ keyboard: showKeyboardSettings, controller: showControllerSettings, graphics: showGraphicsSettings, back: () => settingsReturn() }));
}
let capturingAction = null;
function showKeyboardSettings() {
  const cb = {
    set: setPath,
    remap(action) {
      capturingAction = action;
      menu.refresh();
      input.capture = (code) => {
        capturingAction = null;
        if (code && code !== 'Backquote') { // Backquote stays reserved for the debug panel
          const next = JSON.parse(JSON.stringify(settings));
          next.keyboard.keys = remapKey(next.keyboard.keys, action, code);
          settings = sanitize(next);
          commit();
        }
        menu.refresh();
      };
    },
    resetKeys: () => { const next = JSON.parse(JSON.stringify(settings)); next.keyboard.keys = { ...DEFAULT_KEYS }; settings = sanitize(next); commit(); menu.refresh(); },
    back: settingsBack,
  };
  menu.open(keyboardSpec(() => settings, () => capturingAction, cb));
}
function showControllerSettings() {
  const cb = {
    set: setPath, back: settingsBack,
    test: () => menu.open(stickTestSpec({ back: showControllerSettings, rumble: () => input.rumble(0.8, 400, true), tick: drawSticks })),
  };
  menu.open(controllerSpec(() => settings, cb));
}
function showGraphicsSettings() {
  const cb = {
    set: setPath, back: settingsBack,
    preset(p) { settings = sanitize({ ...settings, graphics: applyPreset(settings.graphics, p) }); commit(); },
    setCustom(path, v) { // a manual change of resolution or shadows leaves the preset
      const next = JSON.parse(JSON.stringify(settings));
      next.graphics = markCustom(next.graphics);
      next.graphics[path.split('.')[1]] = v;
      settings = sanitize(next);
      commit();
    },
  };
  menu.open(graphicsSpec(() => settings, cb));
}

// Stick test: two circles with the raw stick positions and the deadzone ring (redrawn at ~10 Hz).
function drawSticks(menuEl) {
  const cv = menuEl.querySelector('#stk');
  if (!cv) return;
  const g = cv.getContext('2d'), R = 60, dz = settings.controller.deadzone;
  g.clearRect(0, 0, cv.width, cv.height);
  const s = input.sticks || [0, 0, 0, 0];
  [[135, s[0], s[1], 'Kiri'], [405, s[2], s[3], 'Kanan']].forEach(([cx, x, y, label]) => {
    g.strokeStyle = '#1f1f1f'; g.lineWidth = 2; g.beginPath(); g.arc(cx, 75, R, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#9a9a94'; g.lineWidth = 1; g.beginPath(); g.arc(cx, 75, R * dz, 0, Math.PI * 2); g.stroke();
    g.fillStyle = Math.hypot(x, y) > dz ? '#1c7a4a' : '#d64545';
    g.beginPath(); g.arc(cx + x * R, 75 + y * R, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5a5a56'; g.font = '14px system-ui, sans-serif'; g.fillText(label, cx - 16, 12);
  });
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

const HINT_CONTEXT = { m4_delivery: 'delivery', m1_sar: 'sar', m2_foto: 'foto', m3_agri: 'agri', m5_inspeksi: 'inspeksi' };
async function startMission(def, variant) {
  variant = variant || (def.variants && def.variants[0]) || undefined;
  menu.open({ title: 'Memuat misi...', subtitle: def.title, items: [] });
  let cfg, runId = null;
  if (def.tier === 'utama') {
    const r = await gateway.startRun({ mission_id: def.id, variant: variant || 'kota', player: 'pemain' });
    cfg = r.config; runId = r.run_id;
    refreshGatewayLabel();
  } else {
    cfg = makeMissionConfig(def.id, 42);
  }
  loadWorld(cfg);
  const run = new MissionRun(def.id, config, (type, e) => { if (runId) gateway.event(runId, e); });
  run.onNotice = toast;
  session = { kind: 'mission', def, variant, run, runId, battery: new Battery(config.battery), extraBoxes: [], marks: [] };
  enterPlay(HINT_CONTEXT[def.id] || 'latihan', variant && def.variants && def.variants.length > 1 ? `${def.title} (${variant})` : def.title);
}

function startFreeroam() {
  loadWorld(makeMissionConfig('freeroam', 42));
  session = { kind: 'freeroam', def: null, run: null, runId: null, battery: new Battery(config.battery), extra: 0, extraBoxes: [], marks: [] };
  enterPlay('freeroam', 'Freeroam');
}

// ---- realistic Blender scenes (freeroam) ----
async function showScenes() {
  menu.open({ title: 'Peta realistis', subtitle: 'Memuat daftar...', items: [] });
  const list = await loadSceneIndex();
  menu.open(sceneSpec(list, { start: startRealScene, back: showMain }));
}

async function startRealScene(entry) {
  const title = entry.title;
  menu.open({ title: 'Memuat peta...', subtitle: `${title} (${entry.glb_mb} MB)`, items: [] });
  let prepared;
  try {
    const loaded = await loadScene(entry.id, (p) => {
      const sub = document.querySelector('#stage .card .sub');
      if (sub) sub.textContent = `${title}: ${Math.round(p * 100)}%`;
    });
    prepared = prepareScene(loaded);
  } catch (err) {
    console.warn('Scene failed to load:', err);
    menu.open({ title: 'Peta gagal dimuat', subtitle: `${title}: ${err && err.message ? err.message : err}`, items: [{ label: 'Kembali', action: showScenes }], onBack: showScenes });
    return;
  }
  loadWorld(realSceneConfig(makeMissionConfig('freeroam', 42), prepared));
  session = { kind: 'freeroam', def: null, run: null, runId: null, battery: new Battery(config.battery), extra: 0, extraBoxes: [], marks: [], scene: entry };
  enterPlay('freeroam', title);
}

function pauseGame() {
  editor.close();
  state = 'paused'; setMenuMode(true);
  menu.open(pauseSpec({
    resume: () => { menu.close(); setMenuMode(false); state = 'play'; last = performance.now(); },
    retry: () => (session.kind === 'mission' ? startMission(session.def, session.variant) : session.scene ? startRealScene(session.scene) : startFreeroam()),
    settings: () => { settingsReturn = pauseGame; showSettings(); }, // the game stays paused underneath
    finish: session.kind === 'mission' && session.def.tier === 'utama' ? () => { session.run.endNow(); endMission(); } : null,
    main: showMain,
  }));
}

async function endMission() {
  editor.close(); commander.stop('Misi berakhir');
  state = 'result'; setMenuMode(true); hud.setVisible(false); // the score card stands alone (no empty camera frame behind it)
  const run = session.run, level = Math.round(session.battery.level);
  const fin = { t_ms: run.tMs, battery: level, reason: run.reason };
  let res = null, official = false;
  if (session.runId) {
    res = await gateway.finish(session.runId, fin);
    official = gateway.official && !res.offline;
    if (res.offline) res = null;
  }
  if (!res) res = run.result(level); // practice missions, or a gateway that dropped out: provisional score
  if (session.def.id === 'm5_inspeksi' && !res.report) { // the inspection report: from the gateway when it has one, else from our own log
    const remote = session.runId && official ? await gateway.report(session.runId) : null;
    res = { ...res, report: remote || inspectionReport(config, run.log) };
  }
  drone.setSpray(false); setThermal(false);
  menu.open(resultSpec(session.def, run.reason, res, official, {
    retry: () => startMission(session.def, session.variant),
    missions: showMissions,
    main: showMain,
  }));
}

// ---- discrete input events ----
events.on('input', (e) => {
  if (state !== 'play') return;
  if (e.name === 'takeoff_land') {
    if (sim.mode === 'landed') toast(sim.takeoff(5) ? 'Takeoff 5 m' : 'Drone terlalu rusak untuk lepas landas');
    else { autopilot.cancel(); sim.land(); toast('Mendarat'); }
  } else if (e.name === 'home') {
    toast(autopilot.start(sim) ? 'Return home' : 'Return home: drone harus sedang terbang');
  } else if (e.name === 'pause') {
    pauseGame();
  } else if (e.name === 'camera_next' || e.name === 'camera_prev') {
    toast(chase.cycle(e.name === 'camera_next' ? 1 : -1).label);
  } else if (e.name === 'gimbal_reset') {
    drone.setGimbalPitch(0); drone.setGimbalRoll(0); toast('Kamera lurus');
  } else if (e.name === 'gimbal_cycle') {
    const g = drone.gimbalTarget, steps = [0, -30, -45, -90];
    const next = steps.find((v) => v < g - 1) ?? 0; // turun bertahap, lalu kembali lurus
    drone.setGimbalPitch(next); toast(`Kamera ${next}°`);
  } else if (e.name === 'zoom_in' || e.name === 'zoom_out' || e.name === 'zoom_cycle') {
    const z = drone.zoom;
    if (e.name === 'zoom_cycle') drone.setZoom(ZOOM.presets.find((p) => p > z + 0.01) || ZOOM.presets[0]);
    else drone.setZoom(z * (e.name === 'zoom_in' ? 1.12 : 1 / 1.12));
  } else if (e.name === 'pickup_drop') {
    const msg = session.run && session.run.pickupDrop(sim);
    toast(msg || 'Tidak ada paket di mode ini');
  } else if (e.name === 'add_object') {
    if (session.kind !== 'freeroam') { toast('Tambah objek hanya di freeroam'); return; }
    const yaw = (sim.yaw * Math.PI) / 180;
    const b = world.addBox(sim.pos[0] + Math.sin(yaw) * 8, sim.pos[2] - Math.cos(yaw) * 8);
    if (b) { physics.add(world.colliders[world.colliders.length - 1]); hud.addMapBox(b); session.extra++; session.extraBoxes.push(b); toast('Objek ditambah'); } else toast('Batas objek tercapai');
  } else if (e.name === 'panel_ai') {
    if (session.kind !== 'freeroam') { toast('Panel hanya di freeroam'); return; }
    panelOpen = !panelOpen;
    hud.setPanel(panelOpen, assist);
  } else if (e.name === 'command') {
    if (editor.isOpen) editor.close(); else editor.open();
  } else if (e.name === 'spray') {
    const msg = doAction('spray', e.on);
    if (msg) toast(msg);
  } else if (['photo', 'record', 'mark', 'thermal'].includes(e.name)) {
    const msg = doAction(e.name);
    if (msg) toast(msg);
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

// ?export=1 opens the dataset exporter instead of the menu (exporter.js is loaded only then).
let exporting = false;
if (new URLSearchParams(location.search).get('export') === '1') {
  import('./exporter.js').then((m) => m.openExporter({
    stage, renderer, scene, drone,
    hud, loadWorld, getWorld: () => world, getConfig: () => config,
    setExporting: (on) => { exporting = on; },
    restore() { exporting = false; setThermal(false); drone.group.visible = true; layout(); },
  }));
} else showMain();

// ---- timing and FPS (no allocations inside the loop, except the 10 Hz HUD/telemetry tick) ----
let last = performance.now();
let lastDraw = last;
let acc = 0;
let frames = 0, fpsTime = 0, fps = 0, msAvg = 16.7, hudTime = 0;
const tmpView = { x: PIP_VIEW.x, y: H - PIP_VIEW.y - PIP_VIEW.h, w: PIP_VIEW.w, h: PIP_VIEW.h };

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  const raw = dt;
  if (exporting) return; // the exporter renders by itself
  if (dt > 0.1) dt = 0.1; // tab was hidden or a long stall: do not simulate a huge step
  fpsTime += raw;
  hudTime += raw;

  input.poll(dt);
  if (autopilot.active && input.manual) autopilot.cancel(); // the pilot always wins
  if (commander.running && input.manual) commander.stop('Dibatalkan: pilot menggerakkan kontrol');

  // Fixed-step physics, only while playing. Max 5 steps per frame to avoid a spiral of death.
  if (state === 'play') {
    if (input.gimbalRoll) drone.nudgeGimbalRoll(input.gimbalRoll * GIMBAL_RATE * dt);
    if (input.gimbal) drone.nudgeGimbal(input.gimbal * GIMBAL_RATE * dt); // drone tetap diam, hanya kamera yang bergerak
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) {
      if (commander.state === 'running') commander.step(STEP, sim);
      else if (commander.state === 'paused') { /* step mode: hold still until the next Langkah */ }
      else if (autopilot.active) autopilot.step(sim);
      else sim.applyAction(input.action); // single entry point for every input source
      sim.step(STEP, physics);
      world.update(sim.pos);
      fireStep(STEP);
      if (sim.collisionCount > seenHits) { seenHits = sim.collisionCount; input.rumble(0.7, 150); }
      const airborne = sim.mode !== 'landed';
      const run = session.run;
      if (session.kind === 'mission') {
        session.battery.step(STEP, airborne, Math.hypot(sim.vel[0], sim.vel[1], sim.vel[2]), run.payloadKg, sim.damage.fx.drainMul);
        run.step(STEP, sim, session.battery.level, world.passedCount, world.rings.length);
      } else if (airborne) flightTime += STEP;
      if (session.kind === 'freeroam' && sim.mode === 'crashed') {
        crashTimer += STEP;
        if (crashTimer > 3) { crashTimer = 0; seenHits = 0; newSim(); commander.stop('Drone hancur'); toast('Drone baru siap di pad'); }
      }
      acc -= STEP;
      n++;
      if (run && run.done) { endMission(); break; }
    }
    if (n === 5) acc = 0;
  }

  // Target FPS 30: physics and input still run every frame, but only every other frame is drawn.
  const drawFps = state === 'play' ? settings.graphics.targetFps : Math.min(30, settings.graphics.targetFps); // menus do not need 60
  if (drawFps < 60 && now - lastDraw < 1000 / drawFps - 4) return;
  const drawDt = Math.min((now - lastDraw) / 1000, 0.1);
  lastDraw = now;

  // Render with interpolation between the last two physics states.
  const alpha = acc / STEP;
  drone.update(sim, alpha, drawDt);
  if (state === 'menu') orbitCamera(now / 1000); // main menu backdrop: a slow orbit around the drone
  else chase.update(drone.group.position, sim.prevYaw + (sim.yaw - sim.prevYaw) * alpha, drawDt);
  world.followLight(drone.group.position.x, drone.group.position.z);
  world.tick(now / 1000);
  // Mode "Kamera depan drone": layar penuh = gambar kamera drone (sama dengan popup), popup disembunyikan.
  const fpv = (state === 'play' || state === 'paused') && chase.mode.id === 'fpv';
  hud.setPipVisible(!fpv);
  hud.setZoom(drone.zoom, fpv, drone.gimbal, drone.gimbalRoll);
  if (session && session.run) { session.run.zoom = drone.zoom; session.run.gimbal = drone.gimbal; session.run.gimbalRoll = drone.gimbalRoll; }
  if (fpv) {
    const pc = drone.pipCamera;
    if (drone.cameraOk) {
      renderer.render(scene, pc); // panggung selalu 16:9, sama dengan aspek kamera drone
    } else { renderer.setClearColor(0x050505, 1); renderer.clear(); renderer.setClearColor(0x000000, 1); } // kamera rusak: layar mati
  } else renderer.render(scene, camera);

  // Second pass for the PIP drone camera: same scene, small scissored viewport. Only while the HUD is shown.
  if (!fpv && (state === 'play' || state === 'paused')) {
    renderer.shadowMap.autoUpdate = false; // the shadow map from the main pass is still valid: skip a second shadow pass
    renderer.setScissorTest(true);
    renderer.setViewport(tmpView.x, tmpView.y, tmpView.w, tmpView.h);
    renderer.setScissor(tmpView.x, tmpView.y, tmpView.w, tmpView.h);
    if (drone.cameraOk) renderer.render(scene, drone.pipCamera);
    else { renderer.setClearColor(0x050505, 1); renderer.clear(); renderer.setClearColor(0x000000, 1); } // broken camera: dead feed
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.shadowMap.autoUpdate = true;
  }

  // FPS over 0.5 s windows; HUD text refreshes 10 times per second.
  frames++;
  msAvg += (drawDt * 1000 - msAvg) * 0.05;
  if (fpsTime >= 0.5) {
    fps = frames / fpsTime;
    // Only when the player turned it on: otherwise the chosen quality never changes during play.
    if (state === 'play' && settings.graphics.autoQuality && aq.sample(fps, fpsTime, settings.graphics)) { // 2 s below the limit: one step down
      applyGraphics();
      toast(`FPS rendah: kualitas diturunkan otomatis (${aq.name})`);
    }
    frames = 0; fpsTime = 0;
  }

  hud.setHold(input.holdProgress);
  if (input.device !== hintDevice || input.padType !== hintType) { // rebuild hints only on change
    hintDevice = input.device; hintType = input.padType;
    hud.setHints(buildHints(hintContext, hintDevice, hintType, input.bindings));
  }
  if (hudTime >= 0.1) {
    hudTime = 0;
    if (menu.isOpen) menu.tick();
    hud.setDebug(input.debugOn ? input.debugText() : '');
    editor.sync(commander.state, commander.active);
    if (state === 'play' || state === 'paused') updateHud(now);
  }
}

// Panas api: peringatan jika dekat, kerusakan jika terkena. Zona api misi M1 punya hitungan sendiri (missions.js),
// jadi kerusakan di sini hanya untuk peta realistis; peringatannya berlaku di mana saja ada api.
let fireHeat = { level: 0, near: Infinity }, heatAcc = 0;
function fireStep(dt) {
  const list = world.fireHazards;
  if (!list || !list.length) { fireHeat.level = 0; fireHeat.near = Infinity; return; }
  fireHeat = heatAt(list, sim.pos[0], sim.pos[1], sim.pos[2]);
  if (!config.realScene || !sim.damage || sim.mode === 'crashed' || fireHeat.level <= 0) { heatAcc = 0; return; }
  heatAcc += dt * fireHeat.level;
  if (heatAcc >= 0.25) {
    const ch = sim.damage.burn(HEAT_RATE * heatAcc);
    heatAcc = 0;
    if (ch.length && sim.onDamage) sim.onDamage(ch);
  }
}

function updateHud(now) {
  const run = session.run;
  const tel = sim.telemetry();
  const level = session.battery.level;
  hud.update({
    tel, rotors: sim.damage.rotors, fps, ms: msAvg, quality: aq.level ? aq.name : '', battery: level,
    flightTime: run ? run.t : flightTime,
    collisions: sim.collisionCount,
    goalText: run ? run.text || 'Lepas landas (tahan X / A)' : `Terbang bebas · objek ditambah: ${session.extra}`,
    progress: run ? run.progress : 0,
    rings: world.rings,
    marks: session.marks,
    deviceLabel: input.device === 'gamepad' ? `Controller (${input.padType === 'ps' ? 'PlayStation' : 'Xbox'})` : 'Keyboard',
  }, now);
  hud.setFireWarn(fireHeat.level > 0 || fireHeat.near < FIRE_WARN ? fireHeat : null);
  hud.setAltWarn(sim.overTime > 0 && sim.mode !== 'landed' && sim.mode !== 'crashed' ? { t: sim.overTime, grace: ALT_GRACE, fail: ALT_FAIL } : null);
  hud.setBadges({ rec: run && run.recording, thermal, spray: run && run.spraying });
  if (run) {
    if (run.spraying && sim.mode !== 'flying') run.setSpray(false, sim); // landed or crashed: the nozzle closes
    drone.setSpray(run.spraying);
    if (run.spraying) drone.setSprayWidth(swathWidth(sim.pos[1]));
    if (run.agri && run.agri.total !== lastDose && now - lastPaint > 500) { lastDose = run.agri.total; lastPaint = now; world.setFieldDose(run.agri); }
  }
  if (state === 'play' && run) { // 10 Hz telemetry frame: to the gateway (and the local log for the provisional score)
    const frame = {
      t_ms: run.tMs, pos: tel.pos.slice(), vel: tel.vel.slice(), yaw: tel.yaw, roll: tel.roll, pitch: tel.pitch, gimbal: drone.gimbal,
      battery: Math.round(level), payload_kg: run.payloadKg, spraying: run.spraying, collision: tel.collision,
    };
    run.sample(frame);
    if (session.runId) gateway.telemetry(frame);
  }
}
let lastDose = -1, lastPaint = 0;

// Menu backdrop camera: circles the parked drone low and slow, so the title sits over a living scene.
const _orbitLook = new THREE.Vector3();
function orbitCamera(t) {
  const p = drone.group.position, a = t * 0.07 + 0.6;
  const r = 7.5 + Math.sin(t * 0.13) * 1.2;
  camera.up.set(0, 1, 0);
  camera.position.set(p.x + Math.cos(a) * r, p.y + 2.4 + Math.sin(t * 0.21) * 0.6, p.z + Math.sin(a) * r);
  _orbitLook.set(p.x - Math.sin(a) * 1.6, p.y + 0.9, p.z + Math.cos(a) * 1.6); // aim a bit to the side: drone right of the menu
  camera.lookAt(_orbitLook);
  chase.ready = false; // snap back to the chase view when play starts
}
requestAnimationFrame(frame);

// Rapier loads in the background (WASM); until then, and if it fails, the AABB physics keeps working.
createPhysics().then((p) => {
  p.setStatic(world.colliders);
  physics = p;
  console.info(`Physics: ${p.kind}`);
});
