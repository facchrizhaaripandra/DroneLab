// Battery model (pure). Drain rates come from config.battery so the gateway can tune them.
export const DEFAULT_BATTERY = {
  drain_idle: 0.05,   // %/s while airborne (hovering)
  drain_speed: 0.02,  // extra %/s per m/s of speed
  drain_kg: 0.05,     // extra %/s per kg of payload
};

export class Battery {
  constructor(cfg = DEFAULT_BATTERY) {
    this.cfg = { ...DEFAULT_BATTERY, ...cfg };
    this.level = 100; // percent
  }

  // Called once per physics step. Nothing drains while landed.
  step(dt, airborne, speed, payloadKg) {
    if (!airborne || this.level <= 0) return;
    const c = this.cfg;
    this.level -= (c.drain_idle + c.drain_speed * speed + c.drain_kg * payloadKg) * dt;
    if (this.level < 0) this.level = 0;
  }

  get empty() { return this.level <= 0; }
}
