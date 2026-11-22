// Adaptive quality (pure JS). If FPS stays below the threshold for 2 s, lower the quality one step.
// It never changes the saved settings: it only caps what the renderer uses. It never raises the quality
// by itself (that would make the quality jump up and down); changing a graphics setting resets it.

export const LADDER = [
  { name: 'Penuh', scale: 1, shadows: true },
  { name: 'Sedang', scale: 0.8, shadows: true },
  { name: 'Rendah', scale: 0.6, shadows: false },
  { name: 'Minimum', scale: 0.5, shadows: false },
];

export class AdaptiveQuality {
  constructor({ threshold = 30, seconds = 2, cooldown = 3 } = {}) {
    this.threshold = threshold;
    this.seconds = seconds;
    this.cooldown = cooldown; // s to ignore samples after a drop or a world load (shaders compile, caches warm up)
    this.level = 0;
    this.below = 0;
    this.hold = 0;
  }

  // The 30 FPS target mode runs at about 30, so the limit there is 90% of the target.
  setTarget(targetFps) { this.threshold = Math.min(30, targetFps * 0.9); }
  holdFor(seconds) { this.hold = Math.max(this.hold, seconds); this.below = 0; }
  reset() { this.level = 0; this.below = 0; this.hold = 0; }
  get name() { return LADDER[this.level].name; }

  // What the renderer should use, given the user's graphics settings.
  effective(g) {
    const l = LADDER[this.level];
    return { renderScale: Math.min(g.renderScale, l.scale), shadows: g.shadows && l.shadows };
  }

  // Feed one FPS measurement covering `dt` seconds. Returns true when the quality was just lowered.
  sample(fps, dt, g) {
    if (this.hold > 0) { this.hold -= dt; return false; }
    if (fps >= this.threshold) { this.below = 0; return false; }
    this.below += dt;
    if (this.below < this.seconds || this.level >= LADDER.length - 1) return false;
    const before = this.effective(g);
    do { this.level++; } while (this.level < LADDER.length - 1 && same(before, this.effective(g))); // skip steps that change nothing
    this.below = 0;
    this.hold = this.cooldown;
    return !same(before, this.effective(g));
  }
}

const same = (a, b) => a.renderScale === b.renderScale && a.shadows === b.shadows;
