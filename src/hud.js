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
      <div class="row mono"><span>BAT</span><span id="t-bat"></span></div></div>
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
    <div id="toast" class="panel"></div>
    <div id="hold"><b>Tahan</b></div>
    <pre id="dbg" class="panel mono"></pre>`;
  const $ = (id) => root.querySelector('#' + id);
  const el = {
    alt: $('t-alt'), spd: $('t-spd'), bat: $('t-bat'), main: $('g-main'), bar: $('g-bar'),
    time: $('g-time'), hit: $('g-hit'), mode: $('g-mode'), ctl: $('s-ctl'), fps: $('s-fps'),
    title: $('g-title'), gw: $('s-gw'), ai: $('s-ai'), side: $('side'), sideRows: $('side-rows'),
    hint: $('hint'), toast: $('toast'), hold: $('hold'), dbg: $('dbg'),
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
    sc.fillStyle = '#e9e7e2'; sc.fillRect(0, 0, 296, 296);
    sc.fillStyle = '#9aa0a8';
    for (const b of cfg.buildings) rect(b);
    sc.fillStyle = '#d9822b';
    for (const b of cfg.obstacles) rect(b);
    if (mission) {
      sc.fillStyle = 'rgba(214,69,69,0.45)';
      for (const z of mission.noFly) sc.fillRect(C + z.min[0] * S, C + z.min[1] * S, (z.max[0] - z.min[0]) * S, (z.max[1] - z.min[1]) * S);
      for (const [spot, color] of [[mission.pickup, '#f5b700'], [mission.drop, '#2ea66b']]) {
        sc.fillStyle = color; sc.beginPath(); sc.arc(C + spot.x * S, C + spot.z * S, 6, 0, Math.PI * 2); sc.fill();
        sc.strokeStyle = '#1f1f1f'; sc.lineWidth = 1; sc.stroke();
      }
    }
    sc.fillStyle = '#fff'; sc.strokeStyle = '#1f1f1f'; sc.lineWidth = 2;
    sc.beginPath(); sc.arc(C, C, 6, 0, Math.PI * 2); sc.fill(); sc.stroke();
    sc.fillStyle = '#5a5a56'; sc.font = '600 16px system-ui, sans-serif'; sc.fillText('Peta mini', 8, 20);
  }
  drawStatic(config);

  let toastUntil = 0;
  let lastHold = -1;
  let lastMode = '';

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
    addMapBox(b) { sc.fillStyle = '#d9822b'; rect(b); },
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
      el.hold.style.background = `conic-gradient(#1f1f1f ${p * 100}%, #ddd 0)`;
    },
    // runs ~10 times per second
    // `put` writes a text only when it changed, so the browser does not redo layout 10 times a second for nothing.
    update(s, now) {
      const t = s.tel;
      put(el.alt, `${t.alt.toFixed(1)} m`);
      put(el.spd, `${t.speed.toFixed(1)} m/s`);
      put(el.bat, `${Math.round(s.battery)}%`);
      put(el.main, s.goalText);
      el.bar.style.width = `${s.progress * 100}%`;
      put(el.time, `Waktu ${fmtTime(s.flightTime)}`);
      put(el.hit, `Tabrakan ${s.collisions}`);
      if (t.mode !== lastMode) { lastMode = t.mode; el.mode.textContent = t.mode; }
      put(el.ctl, s.deviceLabel);
      put(el.fps, `${s.fps.toFixed(0)} (${s.ms.toFixed(1)} ms)${s.quality ? ` · ${s.quality}` : ''}`);
      if (now > toastUntil) el.toast.style.opacity = '0';

      mm.drawImage(stat, 0, 0);
      for (let i = 0; i < s.rings.length; i++) {
        const g = s.rings[i];
        mm.fillStyle = g.passed ? '#2ea66b' : '#f5b700';
        mm.beginPath(); mm.arc(C + g.x * S, C + g.z * S, 4, 0, Math.PI * 2); mm.fill();
      }
      mm.save();
      mm.translate(C + t.pos[0] * S, C + t.pos[2] * S);
      mm.rotate((t.yaw * Math.PI) / 180);
      mm.fillStyle = '#1f1f1f';
      mm.beginPath(); mm.moveTo(0, -9); mm.lineTo(6, 7); mm.lineTo(-6, 7); mm.closePath(); mm.fill();
      mm.restore();
    },
  };
}
