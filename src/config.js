// Shared constants. Physics runs at a fixed step, independent from rendering.
export const STEP = 1 / 60;

export const PHYS = {
  maxSpeed: 8,        // m/s horizontal at full stick
  maxClimb: 3,        // m/s vertical at full stick
  maxYawRate: 90,     // deg/s at full stick
  tauH: 0.45,         // s, horizontal velocity lag (damping feel)
  tauV: 0.3,          // s, vertical velocity lag
  tauYaw: 0.2,        // s, yaw rate lag
  maxAccelH: 12,      // m/s^2 cap
  maxAccelV: 6,       // m/s^2 cap
  tiltMax: 15,        // deg pitch/roll at max speed
  tauTilt: 0.12,      // s, tilt smoothing
  takeoffSpeed: 2.5,  // m/s
  landSpeed: 1.5,     // m/s
  radius: 0.5,        // m, collision sphere
  maxAlt: 50,         // m, ceiling (matches takeoff(h) limit)
  mapHalf: 100,       // m, world is [-mapHalf, mapHalf] on X and Z
};
