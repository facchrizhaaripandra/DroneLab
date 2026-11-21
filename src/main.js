// Main loop: fixed 1/60 s physics (accumulator) decoupled from rendering, with measured FPS.
import * as THREE from 'three';
import './hud.css';
import { STEP } from './config.js';
import { Flight } from './flight.js';
import { makeDefaultConfig, buildWorld } from './world.js';
import { createDrone } from './drone.js';
import { FollowCamera } from './camera.js';
import { createInput } from './input.js';
import { Autopilot } from './autopilot.js';
import { buildHints } from './bindings.js';
import { createHud, PIP_VIEW, actionLabel } from './hud.js';
import { events } from './events.js';

const W = 1280, H = 720; // the stage is always 16:9; the window letterboxes it

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

const config = makeDefaultConfig(42);
const world = buildWorld(scene, config);
const sim = new Flight();
const drone = createDrone(scene);
const chase = new FollowCamera(camera);
const input = createInput();
const autopilot = new Autopilot();
const hud = createHud(document.getElementById('hud'), config);

// Discrete actions from any device arrive on the event bus.
events.on('input', (e) => {
  const now = performance.now();
  if (e.name === 'takeoff_land') {
    if (sim.mode === 'landed') { sim.takeoff(5); hud.toast('Takeoff 5 m', now); }
    else { autopilot.cancel(); sim.land(); hud.toast('Mendarat', now); }
  } else if (e.name === 'home') {
    hud.toast(autopilot.start(sim) ? 'Return home' : 'Return home: drone harus sedang terbang', now);
  } else if (e.name === 'spray') {
    hud.toast(`${actionLabel('spray')} ${e.on ? 'ON' : 'OFF'} (belum terhubung)`, now);
  } else {
    hud.toast(`${actionLabel(e.name)} (belum terhubung)`, now);
  }
});

// Timing and FPS measurement (no allocations inside the loop).
let last = performance.now();
let acc = 0;
let frames = 0, fpsTime = 0, fps = 0, msAvg = 16.7, hudTime = 0;
let flightTime = 0;
let hintDevice = '', hintType = '';
const tmpView = { x: PIP_VIEW.x, y: H - PIP_VIEW.y - PIP_VIEW.h, w: PIP_VIEW.w, h: PIP_VIEW.h };

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  const raw = dt;
  if (dt > 0.1) dt = 0.1; // tab was hidden or a long stall: do not simulate a huge step

  input.poll(dt);
  if (autopilot.active && input.manual) autopilot.cancel(); // the pilot always wins

  // Fixed-step physics. Max 5 steps per frame to avoid a spiral of death.
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 5) {
    if (autopilot.active) autopilot.step(sim);
    else sim.applyAction(input.action); // single entry point for every input source
    sim.step(STEP, world.colliders);
    world.update(sim.pos);
    if (sim.mode !== 'landed') flightTime += STEP;
    acc -= STEP;
    n++;
  }
  if (n === 5) acc = 0;

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
    hud.setHints(buildHints('latihan', hintDevice, hintType));
  }
  hudTime += raw;
  if (hudTime >= 0.1) {
    hudTime = 0;
    hud.setDebug(input.debugOn ? input.debugText() : '');
    hud.update({
      tel: sim.telemetry(), fps, ms: msAvg, battery: 100, flightTime,
      collisions: sim.collisionCount, checkpoints: world.passedCount, totalCheckpoints: world.rings.length,
      rings: world.rings,
      deviceLabel: input.device === 'gamepad' ? `Controller (${input.padType === 'ps' ? 'PlayStation' : 'Xbox'})` : 'Keyboard',
    }, now);
  }
}
requestAnimationFrame(frame);
