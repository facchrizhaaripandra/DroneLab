// Fixed HUD (basis 1280x720). DOM is built once; update() only changes text and a few styles.
// Positions are identical for keyboard and controller; only the hint bar changes.

// Rect (stage px) where the drone camera is rendered under the transparent PIP panel.
export const PIP_VIEW = { x: 954, y: 468, w: 254, h: 140 };

const ACTION_LABELS = {
  photo: 'Foto', record: 'Rekam', mark: 'Tandai', pickup_drop: 'Ambil / lepas', thermal: 'Mode panas',
  camera_next: 'Kamera berikutnya', camera_prev: 'Kamera sebelumnya', command: 'Perintah teks',
  panel_ai: 'Panel AI', add_object: 'Tambah objek', pause: 'Jeda', spray: 'Semprot',
};
export const actionLabel = (name) => ACTION_LABELS[name] || name;

const MAP = { size: 148, scale: 0.67 }; // px per meter on the minimap (world is 200 m wide)

// Flight modes as the pilot reads them (the sim keeps its English ids).
const MODE_LABEL = { landed: 'Di darat', takeoff: 'Lepas landas', flying: 'Terbang', landing: 'Mendarat', crashed: 'Jatuh' };
// Minimap palette (dark, matches the glass panels).
const MM = { bg: '#13222d', grid: 'rgba(190,220,240,0.06)', block: '#4f6575', obstacle: '#ff8a1f', tree: '#2f6b4a', text: '#8fa3b1' };

function fmtTime(sec) {
  const s = Math.floor(sec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function createHud(root, config) {
  const put = (node, text) => { if (node.textContent !== text) node.textContent = text; };
  root.innerHTML = `
    <div id="telem" class="panel"><h2>Telemetri</h2>
      <div class="row mono"><span>ALT</span><span id="t-alt"></span></div>
      <div class="row mono"><span>SPD</span><span id="t-spd"></span></div>
      <div class="row mono"><span>BAT</span><span id="t-bat"></span></div>
      <div class="row"><span>Baling</span><span id="t-dmg" class="dmg"></span></div></div>
    <div id="goal" class="panel"><h1 id="g-title">Latihan terbang</h1>
      <div class="big" id="g-main"></div><div class="bar"><i id="g-bar"></i></div>
      <div class="meta mono"><span id="g-time"></span><span id="g-hit"></span><span id="g-mode"></span></div></div>
    <div id="status" class="panel"><h2>Status</h2>
      <div class="row"><span>Gateway</span><span id="s-gw" class="muted">...</span></div>
      <div class="row"><span>AI</span><span id="s-ai" class="muted">...</span></div>
      <div class="row"><span>Kontrol</span><span id="s-ctl"></span></div>
      <div class="row"><span>FPS</span><span class="mono" id="s-fps"></span></div></div>
    <div id="minimap" class="panel"><canvas id="mm" width="296" height="296"></canvas></div>
    <div id="pip" class="panel"><div class="hole"></div><div class="tag">Kamera drone</div></div>
    <div id="side" class="panel"><h2>Asisten AI</h2><div id="side-rows"></div><p class="muted">Belum terhubung ke server AI (Fase 4). Tombol 1-4 mengganti pilihan.</p></div>
    <div id="hint" class="panel"></div>
    <div id="badges"></div>
    <div id="flash"></div>
    <div id="toast" class="panel"></div>
    <div id="hold"><b>Tahan</b></div>
    <pre id="dbg" class="panel mono"></pre>`;
  const $ = (id) => root.querySelector('#' + id);
  const el = {
    alt: $('t-alt'), spd: $('t-spd'), bat: $('t-bat'), dmg: $('t-dmg'), main: $('g-main'), bar: $('g-bar'),
    time: $('g-time'), hit: $('g-hit'), mode: $('g-mode'), ctl: $('s-ctl'), fps: $('s-fps'),
    title: $('g-title'), gw: $('s-gw'), ai: $('s-ai'), side: $('side'), sideRows: $('side-rows'),
    hint: $('hint'), toast: $('toast'), hold: $('hold'), dbg: $('dbg'), badges: $('badges'), flash: $('flash'),
  };

  // Minimap: static layer (buildings, obstacles, pad, mission spots) drawn once per world; dynamic layer each update.
  const mm = $('mm').getContext('2d');
  const S = MAP.scale * 2, C = 148;
  const stat = document.createElement('canvas');
  stat.width = stat.height = 296;
  const sc = stat.getContext('2d');
  const rect = (b) => sc.fillRect(C + (b.x - b.w / 2) * S, C + (b.z - b.d / 2) * S, b.w * S, b.d * S);
  let mission = null;
  function drawStatic(cfg) {
    mission = cfg.mission || null;
    sc.fillStyle = MM.bg; sc.fillRect(0, 0, 296, 296);
    sc.strokeStyle = MM.grid; sc.lineWidth = 1; // 20 m grid gives scale
    for (let g = C % (20 * S); g < 296; g += 20 * S) { sc.beginPath(); sc.moveTo(g, 0); sc.lineTo(g, 296); sc.moveTo(0, g); sc.lineTo(296, g); sc.stroke(); }
    sc.fillStyle = MM.tree;
    for (const t of cfg.trees || []) rect(t);
    sc.fillStyle = MM.block;
    for (const b of cfg.buildings) rect(b);
    sc.fillStyle = MM.obstacle;
    for (const b of cfg.obstacles) rect(b);
    sc.fillStyle = MM.block;
    for (const b of cfg.solids || []) if (!b.hidden) rect(b);
    for (const b of cfg.mapBoxes || []) rect(b); // realistic scenes: footprints of tall colliders
    if (mission && mission.field) { // M3: field, house and river
      const f = mission.field;
      sc.fillStyle = '#3f6b3a'; sc.fillRect(C + f.min[0] * S, C + f.min[1] * S, (f.max[0] - f.min[0]) * S, (f.max[1] - f.min[1]) * S);
      for (const r of mission.noSpray) {
        sc.fillStyle = r.kind === 'river' ? '#7fb4e0' : 'rgba(214,69,69,0.55)';
        sc.fillRect(C + r.min[0] * S, C + r.min[1] * S, (r.max[0] - r.min[0]) * S, (r.max[1] - r.min[1]) * S);
      }
    }
    if (mission && mission.fires) { // M1: the search area, fire zones and the safe point (victims are NOT drawn)
      sc.strokeStyle = '#5a5a56'; sc.setLineDash([6, 4]); sc.lineWidth = 1;
      sc.strokeRect(C + mission.area.min[0] * S, C + mission.area.min[1] * S, (mission.area.max[0] - mission.area.min[0]) * S, (mission.area.max[1] - mission.area.min[1]) * S);
      sc.setLineDash([]);
      sc.fillStyle = 'rgba(214,69,69,0.5)';
      for (const f of mission.fires) { sc.beginPath(); sc.arc(C + f.x * S, C + f.z * S, f.r * S, 0, Math.PI * 2); sc.fill(); }
      sc.fillStyle = '#2ea66b'; sc.beginPath(); sc.arc(C + mission.safe.x * S, C + mission.safe.z * S, 6, 0, Math.PI * 2); sc.fill();
    }
    if (mission && mission.landmarks) { // M2: subjects of the shot list
      sc.fillStyle = '#7a4fd0';
      for (const l of mission.landmarks) { sc.beginPath(); sc.arc(C + l.x * S, C + l.z * S, 5, 0, Math.PI * 2); sc.fill(); }
    }
    if (mission && mission.structure) { // M5: the structure (defects are not drawn)
      const st = mission.structure;
      sc.fillStyle = '#7a4fd0'; sc.fillRect(C + (st.x - st.w / 2) * S, C + (st.z - st.d / 2) * S, st.w * S, st.d * S);
    }
    if (mission && mission.noFly) {
      sc.fillStyle = 'rgba(214,69,69,0.45)';
      for (const z of mission.noFly) sc.fillRect(C + z.min[0] * S, C + z.min[1] * S, (z.max[0] - z.min[0]) * S, (z.max[1] - z.min[1]) * S);
      for (const [spot, color] of [[mission.pickup, '#ffc247'], [mission.drop, '#3ccf8e']]) {
        if (!spot) continue; // only M4 has pickup/drop; normalizeConfig gives every mission an empty noFly list
        sc.fillStyle = color; sc.beginPath(); sc.arc(C + spot.x * S, C + spot.z * S, 6, 0, Math.PI * 2); sc.fill();
        sc.strokeStyle = '#05090c'; sc.lineWidth = 1; sc.stroke();
      }
    }
    sc.strokeStyle = '#eef3f6'; sc.lineWidth = 2; // home pad
    sc.beginPath(); sc.arc(C, C, 7, 0, Math.PI * 2); sc.stroke();
    sc.fillStyle = '#eef3f6'; sc.font = '700 10px Bahnschrift, system-ui, sans-serif'; sc.textAlign = 'center'; sc.fillText('H', C, C + 3.5); sc.textAlign = 'left';
    sc.fillStyle = MM.text; sc.font = '400 18px Bahnschrift, system-ui, sans-serif'; sc.fillText('Peta mini', 12, 26);
  }
  drawStatic(config);

  let toastUntil = 0;
  let lastHold = -1;
  let lastMode = '';
  let lastDmg = '';
  let lastBadges = '';

  function setHints(h) {
    const item = ([k, l]) => {
      const ks = (Array.isArray(k) ? k : [k]).map((x) => `<span class="key">${x}</span>`).join('');
      return `<span class="item">${ks}<span>${l}</span></span>`;
    };
    el.hint.innerHTML = h.left.map(item).join('') + '<span class="sp"></span>' + h.right.map(item).join('');
  }

  return {
    setHints,
    // New world (mission start): redraw the static minimap layer.
    setWorld: drawStatic,
    addMapBox(b) { sc.fillStyle = MM.obstacle; rect(b); },
    // Badges (REC, thermal, spraying) and the photo flash.
    setBadges(b) {
      const key = `${b.rec ? 1 : 0}${b.thermal ? 1 : 0}${b.spray ? 1 : 0}`;
      if (key === lastBadges) return;
      lastBadges = key;
      el.badges.innerHTML = (b.rec ? '<b class="rec">● REC</b>' : '') + (b.thermal ? '<b class="thermal">MODE PANAS</b>' : '') + (b.spray ? '<b class="spray">MENYEMPROT</b>' : '');
    },
    flash() { el.flash.classList.remove('go'); void el.flash.offsetWidth; el.flash.classList.add('go'); },
    // HUD size (graphics setting): shrinks the whole layer toward the center, so it never leaves the screen.
    setScale(s) { root.style.transform = `scale(${s})`; root.style.transformOrigin = 'center'; },
    setVisible(on) { root.style.visibility = on ? 'visible' : 'hidden'; },
    setTitle(t) { el.title.textContent = t; },
    setGateway(text) { el.gw.textContent = text; },
    setAi(text) { el.ai.textContent = text; },
    // Side panel (Tab). items: [{label, on}] -> rows "1 Label  ON/OFF"
    setPanel(open, items) {
      el.side.style.display = open ? 'block' : 'none';
      if (!open) return;
      el.sideRows.innerHTML = items.map((it, i) =>
        `<div class="row"><span><span class="key">${i + 1}</span> ${it.label}</span><b>${it.on ? 'ON' : 'OFF'}</b></div>`).join('');
    },
    setDebug(text) {
      el.dbg.style.display = text ? 'block' : 'none';
      if (text) el.dbg.textContent = text;
    },
    toast(text, now) {
      el.toast.textContent = text;
      el.toast.style.opacity = '1';
      toastUntil = now + 1800;
    },
    // cheap: runs every frame, writes the DOM only when the value changes
    setHold(p) {
      const q = Math.round(p * 20);
      if (q === lastHold) return;
      lastHold = q;
      el.hold.style.display = q > 0 ? 'flex' : 'none';
      el.hold.style.background = `conic-gradient(#ff8a1f ${p * 100}%, rgba(255,255,255,0.2) 0)`;
    },
    // runs ~10 times per second
    // `put` writes a text only when it changed, so the browser does not redo layout 10 times a second for nothing.
    update(s, now) {
      const t = s.tel;
      put(el.alt, `${t.alt.toFixed(1)} m`);
      put(el.spd, `${t.speed.toFixed(1)} m/s`);
      put(el.bat, `${Math.round(s.battery)}%`);
      const bc = s.battery < 15 ? 'crit' : s.battery < 30 ? 'low' : '';
      if (el.bat.className !== bc) el.bat.className = bc;
      if (s.rotors) { // 4 squares (FL FR / RL RR), colour by health; rewritten only when a value changed
        const key = s.rotors.map((h) => Math.round(h * 10)).join();
        if (key !== lastDmg) {
          lastDmg = key;
          el.dmg.innerHTML = s.rotors.map((h) => `<i style="background:${h > 0.65 ? '#3ccf8e' : h > 0.05 ? '#ffc247' : '#ff5a4e'}" title="${Math.round(h * 100)}%"></i>`).join('');
        }
      }
      put(el.main, s.goalText);
      el.main.style.fontSize = s.goalText.length > 70 ? '15px' : s.goalText.length > 40 ? '18px' : '';
      el.bar.style.width = `${s.progress * 100}%`;
      put(el.time, `Waktu ${fmtTime(s.flightTime)}`);
      put(el.hit, `Tabrakan ${s.collisions}`);
      if (t.mode !== lastMode) { lastMode = t.mode; el.mode.textContent = MODE_LABEL[t.mode] || t.mode; }
      put(el.ctl, s.deviceLabel);
      put(el.fps, `${s.fps.toFixed(0)} (${s.ms.toFixed(1)} ms)${s.quality ? ` · ${s.quality}` : ''}`);
      if (now > toastUntil) el.toast.style.opacity = '0';

      mm.drawImage(stat, 0, 0);
      for (let i = 0; i < s.rings.length; i++) {
        const g = s.rings[i];
        mm.fillStyle = g.passed ? '#3ccf8e' : '#ffc247';
        mm.beginPath(); mm.arc(C + g.x * S, C + g.z * S, 4, 0, Math.PI * 2); mm.fill();
      }
      if (s.marks) { // marks the pilot placed (found victims, marked defects)
        mm.fillStyle = '#d64545';
        for (let i = 0; i < s.marks.length; i++) { mm.beginPath(); mm.arc(C + s.marks[i].x * S, C + s.marks[i].z * S, 4, 0, Math.PI * 2); mm.fill(); }
      }
      mm.save();
      mm.translate(C + t.pos[0] * S, C + t.pos[2] * S);
      mm.rotate((t.yaw * Math.PI) / 180);
      mm.fillStyle = '#ff8a1f'; mm.strokeStyle = '#05090c'; mm.lineWidth = 1.5;
      mm.beginPath(); mm.moveTo(0, -10); mm.lineTo(7, 8); mm.lineTo(0, 4); mm.lineTo(-7, 8); mm.closePath(); mm.fill(); mm.stroke();
      mm.restore();
    },
  };
}
