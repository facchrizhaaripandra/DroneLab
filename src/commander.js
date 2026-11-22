// Script runtime: runs a compiled DSL program on the drone through sim.applyAction() only,
// like the keyboard, the gamepad and the autopilot. Pure JS (no Three.js). step() does not allocate.
import { parse, compile } from './dsl.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap180 = (a) => ((a + 180) % 360 + 360) % 360 - 180;
const CMD_TIMEOUT = 120;   // s per command, so a stuck goto cannot hang the script
const MAX_FREE_OPS = 500;  // jumps and counters resolved in one step (guards against runaway programs)
const INSTANT = new Set(['look', 'photo', 'record', 'spray', 'pickup', 'drop', 'mark']);

// ctx: { autopilot, detect(label)->bool, battery()->percent, act(name, arg)->message|null, setGimbal(deg) }
export class Commander {
  constructor(ctx) {
    this.ctx = ctx;
    this.state = 'idle';      // idle | running | paused | done | error
    this.stepMode = false;
    this.prog = [];
    this.counters = [];
    this.pc = 0;
    this.cur = null;          // command being executed
    this.active = null;       // { start, end, line } of the statement shown as "active"
    this.logs = [];           // [{ text, kind }] filled when events happen
    this.onLog = () => {};
    this.a = { yaw: 0, climb: 0, strafe: 0, forward: 0 };
  }

  get running() { return this.state === 'running' || this.state === 'paused'; }

  _log(text, kind = 'info') { const e = { text, kind }; this.logs.push(e); if (this.logs.length > 200) this.logs.shift(); this.onLog(e); }

  // Parse + compile. Returns { ok, errors } and does not start anything.
  load(src, bounds = 100) {
    const r = parse(src, { bounds });
    if (!r.ok) return r;
    const c = compile(r.ast);
    this.prog = c.prog;
    this.counters = new Array(c.counters).fill(0);
    return r;
  }

  start(stepMode = false) {
    this.stepMode = stepMode;
    this.pc = 0; this.cur = null; this.active = null;
    this.state = stepMode ? 'paused' : 'running';
    this._log(stepMode ? 'Mode langkah: tekan Langkah untuk tiap perintah' : 'Skrip berjalan');
  }

  // "Langkah" button: run until the next command has finished, then pause again.
  resume() { if (this.state === 'paused') this.state = 'running'; }

  stop(reason = 'Dihentikan') {
    if (!this.running) return;
    this.state = 'idle'; this.cur = null; this.active = null;
    this.ctx.autopilot.cancel();
    this._zero();
    this._log(reason, 'warn');
  }

  _zero() { const a = this.a; a.yaw = a.climb = a.strafe = a.forward = 0; }
  _fail(msg, line) { this.state = 'error'; this.cur = null; this._zero(); this._log(`Galat${line ? ` baris ${line}` : ''}: ${msg}`, 'error'); }

  // Called once per physics step while running (also safe to call otherwise: it returns at once).
  step(dt, sim) {
    if (this.state !== 'running') return;
    for (let guard = 0; guard < MAX_FREE_OPS; guard++) {
      if (!this.cur) {
        if (this.pc >= this.prog.length) { this.state = 'done'; this.active = null; this._zero(); sim.applyAction(this.a); this._log('Skrip selesai', 'ok'); return; }
        if (!this._fetch(sim)) { if (this.state !== 'running') return; continue; }
      }
      const finished = this._exec(dt, sim);
      if (this.state === 'error') { sim.applyAction(this.a); return; }
      if (!finished) { sim.applyAction(this.a); return; }
      this._log(`OK  ${this.cur.text}`, 'ok');
      this.cur = null;
      if (this.stepMode) { this.state = 'paused'; this._zero(); sim.applyAction(this.a); return; }
    }
    this._fail('terlalu banyak langkah dalam satu waktu');
  }

  // Resolve control instructions; returns true when a command was started (this.cur set).
  _fetch(sim) {
    const ins = this.prog[this.pc++];
    if (ins.op === 'rep') { this.counters[ins.id] = ins.n; return false; }
    if (ins.op === 'loop') { if (--this.counters[ins.id] > 0) this.pc = ins.to; return false; }
    if (ins.op === 'jmp') { this.pc = ins.to; return false; }
    if (ins.op === 'if') {
      const c = ins.cond;
      let ok;
      if (c.kind === 'detect') ok = this.ctx.detect(c.label);
      else {
        const b = this.ctx.battery();
        ok = c.op === '<' ? b < c.value : c.op === '>' ? b > c.value : c.op === '<=' ? b <= c.value
          : c.op === '>=' ? b >= c.value : c.op === '==' ? b === c.value : b !== c.value;
      }
      this.active = ins.node;
      this._log(`if ${c.kind === 'detect' ? `detect("${c.label}")` : `battery ${c.op} ${c.value}`} -> ${ok ? 'benar' : 'salah'}`);
      if (!ok) this.pc = ins.to;
      return false;
    }
    const n = ins.node;
    this.active = n;
    this.cur = { name: n.name, args: n.args, t: 0, started: false, line: n.line, text: `${n.name}(${n.args.map((x) => (typeof x === 'string' ? `"${x}"` : x)).join(', ')})` };
    this._log(`>>  ${this.cur.text}  (baris ${n.line})`);
    return true;
  }

  // Runs one command for one physics step. Returns true when it is finished.
  _exec(dt, sim) {
    const c = this.cur, a = this.a, ar = c.args;
    this._zero();
    c.t += dt;
    if (c.t > CMD_TIMEOUT) { this._fail(`${c.name} melebihi ${CMD_TIMEOUT} detik`, c.line); return false; }

    if (INSTANT.has(c.name)) {
      if (c.name === 'look') this.ctx.setGimbal(ar[0]);
      else {
        const msg = this.ctx.act(c.name, ar[0]);
        if (msg) this._log(msg);
      }
      return true;
    }

    if (c.name === 'takeoff') {
      if (!c.started) { c.started = true; if (sim.mode === 'landed') sim.takeoff(ar[0]); }
      if (sim.mode === 'flying') {
        const e = ar[0] - sim.pos[1];
        a.climb = clamp(e * 0.8, -1, 1);
        return Math.abs(e) < 0.4 && Math.abs(sim.vel[1]) < 0.5;
      }
      return false; // taking off (or landing): wait
    }
    if (c.name === 'land') {
      if (sim.mode === 'landed') return true;
      if (!c.started) { c.started = true; sim.land(); }
      return false;
    }
    if (c.name === 'hover') return c.t >= ar[0];
    if (c.name === 'return_home') {
      if (!c.started) {
        c.started = true;
        if (sim.mode === 'landed') return true;
        if (!this.ctx.autopilot.start(sim)) { this._fail('return_home butuh drone yang sedang terbang', c.line); return false; }
      }
      this.ctx.autopilot.step(sim);
      const ap = this.ctx.autopilot._a; // the autopilot decided this step's action
      a.yaw = ap.yaw; a.climb = ap.climb; a.strafe = ap.strafe; a.forward = ap.forward;
      return !this.ctx.autopilot.active && sim.mode === 'landed';
    }

    // Everything below needs a flying drone.
    if (sim.mode === 'landed') { this._fail(`${c.name} butuh drone terbang: pakai takeoff() dulu`, c.line); return false; }
    if (sim.mode !== 'flying') return false;

    if (c.name === 'rotate') {
      if (!c.started) { c.started = true; c.target = sim.yaw + ar[0]; }
      const err = c.target - sim.yaw;
      a.yaw = clamp(err / 30, -1, 1);
      return Math.abs(err) < 2 && Math.abs(sim.yawRate) < 10;
    }

    // goto and move share one controller: reach (tx, ty, tz).
    if (!c.started) {
      c.started = true;
      const y = sim.yaw * DEG, fx = Math.sin(y), fz = -Math.cos(y);
      c.holdYaw = sim.yaw;
      if (c.name === 'goto') { c.tx = ar[0]; c.tz = ar[1]; c.ty = ar.length > 2 ? ar[2] : sim.pos[1]; }
      else {
        const m = ar[1], d = ar[0];
        const f = d === 'maju' ? m : d === 'mundur' ? -m : 0;
        const r = d === 'kanan' ? m : d === 'kiri' ? -m : 0;
        c.tx = sim.pos[0] + fx * f + Math.cos(y) * r;
        c.tz = sim.pos[2] + fz * f + Math.sin(y) * r;
        c.ty = clamp(sim.pos[1] + (d === 'naik' ? m : d === 'turun' ? -m : 0), 0.5, 50);
      }
    }
    const ex = c.tx - sim.pos[0], ez = c.tz - sim.pos[2], ey = c.ty - sim.pos[1];
    const dist = Math.hypot(ex, ez);
    a.climb = clamp(ey * 0.8, -1, 1);
    if (c.name === 'goto' && dist > 3) { // far: face the target and fly straight at it
      const err = wrap180(Math.atan2(ex, -ez) / DEG - sim.yaw);
      a.yaw = clamp(err / 30, -1, 1);
      a.forward = clamp(dist / 6, 0, 1) * Math.max(0, Math.cos(err * DEG));
    } else { // near (and for move): keep the heading and correct with body-frame errors
      const y = sim.yaw * DEG;
      a.forward = clamp((ex * Math.sin(y) - ez * Math.cos(y)) / 4, -1, 1);
      a.strafe = clamp((ex * Math.cos(y) + ez * Math.sin(y)) / 4, -1, 1);
      a.yaw = c.name === 'move' ? clamp(wrap180(c.holdYaw - sim.yaw) / 30, -1, 1) : 0;
    }
    const speed = Math.hypot(sim.vel[0], sim.vel[2]);
    return dist < (c.name === 'goto' ? 1.0 : 0.6) && Math.abs(ey) < 0.6 && speed < 1.2;
  }
}
