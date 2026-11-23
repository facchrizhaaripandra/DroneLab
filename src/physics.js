// Physics layer behind one small interface, so Flight does not care which engine runs:
//   setStatic(boxes)  replace all static colliders        add(box)  add one collider
//   resolve(prev, pos, vel, radius, out)  move-and-collide, returns true on contact
//   raycast(origin, dir, maxDist)  distance to the first collider or -1
// AabbPhysics is plain math (always works). Rapier is used when it loads; if it ever
// throws, we drop back to AABB for the rest of the session instead of crashing the sim.
import { resolveSphereBoxes } from './collision.js';

export class AabbPhysics {
  constructor() { this.kind = 'aabb'; this.boxes = []; }
  setStatic(boxes) { this.boxes = boxes; }
  add(box) { if (!this.boxes.includes(box)) this.boxes.push(box); }
  resolve(prev, pos, vel, radius, out) { return resolveSphereBoxes(pos, vel, radius, this.boxes, out); }
  raycast(o, d, max) {
    let best = Infinity;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      let t0 = 0, t1 = max;
      for (let a = 0; a < 3 && t0 <= t1; a++) {
        if (Math.abs(d[a]) < 1e-9) {
          if (o[a] < b.min[a] || o[a] > b.max[a]) t1 = -1;
        } else {
          let ta = (b.min[a] - o[a]) / d[a], tb = (b.max[a] - o[a]) / d[a];
          if (ta > tb) { const s = ta; ta = tb; tb = s; }
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
        }
      }
      if (t0 <= t1 && t0 < best) best = t0;
    }
    return best === Infinity ? -1 : best;
  }
}

// RAPIER = the initialised @dimforge/rapier3d-compat module (passed in so tests can fake it).
export function createRapierPhysics(RAPIER) {
  const fallback = new AabbPhysics();
  const self = { kind: 'rapier' };
  let world = null, controller = null, player = null, playerRadius = 0;
  let statics = [];
  let boxes = [];

  const fail = (err) => {
    console.warn('Rapier failed, using AABB physics:', err);
    self.kind = 'aabb';
    fallback.setStatic(boxes);
  };
  const makeWorld = () => {
    world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    controller = world.createCharacterController(0.01);
    player = null;
    playerRadius = 0;
  };
  const addCollider = (b) => {
    const c = RAPIER.ColliderDesc.cuboid((b.max[0] - b.min[0]) / 2, (b.max[1] - b.min[1]) / 2, (b.max[2] - b.min[2]) / 2)
      .setTranslation((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    statics.push(world.createCollider(c));
  };

  self.setStatic = (list) => {
    boxes = list;
    fallback.setStatic(list);
    if (self.kind !== 'rapier') return;
    try {
      if (!world) makeWorld();
      for (const c of statics) world.removeCollider(c, false);
      statics = [];
      for (const b of list) addCollider(b);
      world.step(); // refreshes the query pipeline so rays and the controller see the new boxes
    } catch (e) { fail(e); }
  };
  self.add = (box) => {
    if (!boxes.includes(box)) boxes.push(box);
    fallback.setStatic(boxes);
    if (self.kind !== 'rapier') return;
    try { if (!world) makeWorld(); addCollider(box); world.step(); } catch (e) { fail(e); }
  };

  self.resolve = (prev, pos, vel, radius, out) => {
    if (self.kind !== 'rapier') return fallback.resolve(prev, pos, vel, radius, out);
    try {
      if (!world) makeWorld();
      if (!player || playerRadius !== radius) {
        if (player) world.removeCollider(player, false);
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
        player = world.createCollider(RAPIER.ColliderDesc.ball(radius), body);
        playerRadius = radius;
      }
      const dx = pos[0] - prev[0], dy = pos[1] - prev[1], dz = pos[2] - prev[2];
      player.setTranslation({ x: prev[0], y: prev[1], z: prev[2] });
      controller.computeColliderMovement(player, { x: dx, y: dy, z: dz });
      const m = controller.computedMovement();
      // What the engine removed from our move = push along the surface normal.
      const rx = dx - m.x, ry = dy - m.y, rz = dz - m.z;
      const rl = Math.hypot(rx, ry, rz);
      pos[0] = prev[0] + m.x; pos[1] = prev[1] + m.y; pos[2] = prev[2] + m.z;
      if (out) out.speed = 0;
      if (rl < 1e-6) return false;
      const nx = -rx / rl, ny = -ry / rl, nz = -rz / rl;
      const vn = vel[0] * nx + vel[1] * ny + vel[2] * nz;
      if (vn < 0) {
        if (out) { out.speed = -vn; out.nx = nx; out.ny = ny; out.nz = nz; }
        vel[0] -= vn * nx; vel[1] -= vn * ny; vel[2] -= vn * nz;
      }
      return true;
    } catch (e) {
      fail(e);
      return fallback.resolve(prev, pos, vel, radius, out);
    }
  };

  self.raycast = (o, d, max) => {
    if (self.kind !== 'rapier' || !world) return fallback.raycast(o, d, max);
    try {
      const ray = new RAPIER.Ray({ x: o[0], y: o[1], z: o[2] }, { x: d[0], y: d[1], z: d[2] });
      const hit = world.castRay(ray, max, true, undefined, undefined, player || undefined);
      if (!hit) return -1;
      return hit.timeOfImpact ?? hit.toi ?? -1;
    } catch (e) { fail(e); return fallback.raycast(o, d, max); }
  };
  return self;
}

// Loads Rapier (WASM) and returns the Rapier adapter; any problem returns plain AABB.
export async function createPhysics() {
  try {
    const mod = await import('@dimforge/rapier3d-compat');
    const RAPIER = mod.default || mod;
    await RAPIER.init();
    return createRapierPhysics(RAPIER);
  } catch (e) {
    console.warn('Rapier not available, using AABB physics:', e && e.message);
    return new AabbPhysics();
  }
}
