// Fixed HUD (basis 1280x720). DOM is built once; update() only changes text and a few styles.
// Positions are identical for keyboard and controller; only the hint bar changes.

// Rect (stage px) where the drone camera is rendered under the transparent PIP panel.
export const PIP_VIEW = { x: 954, y: 468, w: 254, h: 140 };

const ACTION_LABELS = {
  photo: 'Foto', record: 'Rekam', mark: 'Tandai', pickup_drop: 'Ambil / lepas', thermal: 'Mode panas',
  gimbal_reset: 'Kamera lurus', gimbal_cycle: 'Sudut kamera', zoom_in: 'Zoom masuk', zoom_out: 'Zoom keluar', zoom_cycle: 'Zoom', camera_next: 'Kamera berikutnya', camera_prev: 'Kamera sebelumnya', command: 'Perintah teks',
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
      <div class="row mono"><span>ANGIN</span><span><b id="t-wa" class="warrow">↑</b> <span id="t-wind"></span></span></div>
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
    <div id="pip" class="panel"><div class="hole"></div><div class="tag">Kamera drone<span id="zoomtag"></span></div></div>
    <div id="zoomfs" class="panel"></div>
    <div id="side" class="panel"><h2>Asisten AI</h2><div id="side-rows"></div><p class="muted">Belum terhubung ke server AI (Fase 4). Tombol 1-4 mengganti pilihan.</p></div>
    <div id="hint" class="panel"></div>
    <div id="altwarn" class="panel"></div>
    <div id="firewarn" class="panel"></div>
    <div id="waterwarn" class="panel"></div>
    <div id="badges"></div>
    <div id="flash"></div>
    <div id="toast" class="panel"></div>
    <div id="hold"><b>Tahan</b></div>
    <pre id="dbg" class="panel mono"></pre>`;
  const $ = (id) => root.querySelector('#' + id);
  const el = {
    alt: $('t-alt'), spd: $('t-spd'), bat: $('t-bat'), wind: $('t-wind'), warrow: $('t-wa'), dmg: $('t-dmg'), main: $('g-main'), bar: $('g-bar'),
    time: $('g-time'), hit: $('g-hit'), mode: $('g-mode'), ctl: $('s-ctl'), fps: $('s-fps'),
    title: $('g-title'), gw: $('s-gw'), ai: $('s-ai'), side: $('side'), sideRows: $('side-rows'),
    hint: $('hint'), toast: $('toast'), hold: $('hold'), dbg: $('dbg'), badges: $('badges'), zoomtag: $('zoomtag'), zoomfs: $('zoomfs'), altwarn: $('altwarn'), firewarn: $('firewarn'), waterwarn: $('waterwarn'), flash: $('flash'),
  };

  // Minimap: static layer (buildings, obstacles, pad, mission spots) drawn once per world at full world size;
  // each update shows a 296 px window of it centred on the drone (it scrolls on large maps, so the drone never
  // leaves it). The window stops at the world edge, so a world that fits (the 200 m one) does not scroll at all.
  const mm = $('mm').getContext('2d');
  const S = MAP.scale * 2, C = 148, VIEW = 296;
  const stat = document.createElement('canvas');
  const sc = stat.getContext('2d');
  let O = C, half = C / S; // pixel of world (0, 0) on the static layer; world half-size in metres
  const rect = (b) => sc.fillRect(O + (b.x - b.w / 2) * S, O + (b.z - b.d / 2) * S, b.w * S, b.d * S);
  let mission = null;
  function drawStatic(cfg) {
    mission = cfg.mission || null;
    half = Math.max(C / S, (cfg.bounds || 100) + 10);
    O = Math.ceil(half * S);
    stat.width = stat.height = 2 * O;
    const N = stat.width;
    sc.fillStyle = MM.bg; sc.fillRect(0, 0, N, N);
    sc.strokeStyle = MM.grid; sc.lineWidth = 1; // 20 m grid gives scale
    for (let g = O % (20 * S); g < N; g += 20 * S) { sc.beginPath(); sc.moveTo(g, 0); sc.lineTo(g, N); sc.moveTo(0, g); sc.lineTo(N, g); sc.stroke(); }
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
      sc.fillStyle = '#3f6b3a'; sc.fillRect(O + f.min[0] * S, O + f.min[1] * S, (f.max[0] - f.min[0]) * S, (f.max[1] - f.min[1]) * S);
      for (const r of mission.noSpray) {
        sc.fillStyle = r.kind === 'river' ? '#7fb4e0' : 'rgba(214,69,69,0.55)';
        sc.fillRect(O + r.min[0] * S, O + r.min[1] * S, (r.max[0] - r.min[0]) * S, (r.max[1] - r.min[1]) * S);
      }
    }
    if (mission && mission.fires) { // M1: the search area, fire zones and the safe point (victims are NOT drawn)
      sc.strokeStyle = '#5a5a56'; sc.setLineDash([6, 4]); sc.lineWidth = 1;
      sc.strokeRect(O + mission.area.min[0] * S, O + mission.area.min[1] * S, (mission.area.max[0] - mission.area.min[0]) * S, (mission.area.max[1] - mission.area.min[1]) * S);
      sc.setLineDash([]);
      sc.fillStyle = 'rgba(214,69,69,0.5)';
      for (const f of mission.fires) { sc.beginPath(); sc.arc(O + f.x * S, O + f.z * S, f.r * S, 0, Math.PI * 2); sc.fill(); }
      sc.fillStyle = '#2ea66b'; sc.beginPath(); sc.arc(O + mission.safe.x * S, O + mission.safe.z * S, 6, 0, Math.PI * 2); sc.fill();
    }
    if (mission && mission.landmarks) { // M2: subjects of the shot list
      sc.fillStyle = '#7a4fd0';
      for (const l of mission.landmarks) { sc.beginPath(); sc.arc(O + l.x * S, O + l.z * S, 5, 0, Math.PI * 2); sc.fill(); }
    }
    if (mission && mission.structure) { // M5: the structure (defects are not drawn)
      const st = mission.structure;
      sc.fillStyle = '#7a4fd0'; sc.fillRect(O + (st.x - st.w / 2) * S, O + (st.z - st.d / 2) * S, st.w * S, st.d * S);
    }
    if (mission && mission.noFly) {
      sc.fillStyle = 'rgba(214,69,69,0.45)';
      for (const z of mission.noFly) sc.fillRect(O + z.min[0] * S, O + z.min[1] * S, (z.max[0] - z.min[0]) * S, (z.max[1] - z.min[1]) * S);
      for (const [spot, color] of [[mission.pickup, '#ffc247'], [mission.drop, '#3ccf8e']]) {
        if (!spot) continue; // only M4 has pickup/drop; normalizeConfig gives every mission an empty noFly list
        sc.fillStyle = color; sc.beginPath(); sc.arc(O + spot.x * S, O + spot.z * S, 6, 0, Math.PI * 2); sc.fill();
        sc.strokeStyle = '#05090c'; sc.lineWidth = 1; sc.stroke();
      }
    }
    sc.strokeStyle = '#eef3f6'; sc.lineWidth = 2; // home pad
    sc.beginPath(); sc.arc(O, O, 7, 0, Math.PI * 2); sc.stroke();
    sc.fillStyle = '#eef3f6'; sc.font = '700 10px Bahnschrift, system-ui, sans-serif'; sc.textAlign = 'center'; sc.fillText('H', C, O + 3.5); sc.textAlign = 'left';
  }
  drawStatic(config);

  let toastUntil = 0;
  let lastAlt = '', lastFire = '', lastWater = '', lastWindRel = -1;
  let pipOn = true;
  let lastZoom = '', lastZoomFull = null;
  const pipEl = root.querySelector('#pip');
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
    // Peringatan batas ketinggian: null = aman; {t, grace, fail} = detik di atas batas.
    setAltWarn(w) {
      let key = '';
      if (w) key = w.t <= w.grace ? `w${Math.ceil(w.grace - w.t)}` : `d${Math.floor(w.fail - w.t)}`;
      if (key === lastAlt) return;
      lastAlt = key;
      el.altwarn.style.display = w ? 'block' : 'none';
      if (!w) return;
      const danger = w.t > w.grace;
      el.altwarn.classList.toggle('danger', danger);
      el.altwarn.textContent = danger
        ? `Motor dan baterai rusak. Turun sekarang! Drone gagal dalam ${Math.max(0, Math.floor(w.fail - w.t))} detik`
        : `Di atas batas ketinggian. Turun dalam ${Math.ceil(w.grace - w.t)} detik`;
    },
    // Peringatan api: null = aman; {near, level} = jarak ke inti api (m) dan tingkat panas 0..1.
    setFireWarn(w) {
      const key = !w ? '' : w.level > 0 ? 'hot' : `n${Math.ceil(w.near)}`;
      if (key === lastFire) return;
      lastFire = key;
      el.firewarn.style.display = w ? 'block' : 'none';
      if (!w) return;
      const hot = w.level > 0;
      el.firewarn.classList.toggle('danger', hot);
      el.firewarn.textContent = hot ? 'Terkena panas api! Drone rusak. Menjauh sekarang' : `Terlalu dekat api (${Math.ceil(w.near)} m). Menjauh`;
    },
    // Air: w = null | { h: tinggi di atas air (m), wet: bagian terendam ('baling-baling', 'kamera') atau '' }.
    setWaterWarn(w) {
      const key = !w ? '' : w.wet ? `w${w.wet}` : `h${Math.ceil(w.h)}`;
      if (key === lastWater) return;
      lastWater = key;
      el.waterwarn.style.display = w ? 'block' : 'none';
      if (!w) return;
      el.waterwarn.classList.toggle('danger', !!w.wet);
      el.waterwarn.textContent = w.wet ? `${w.wet} kena air! Naik sekarang` : `Di atas air (${Math.ceil(w.h)} m). Jangan turun lebih rendah`;
    },
    // Sudut gimbal dan zoom kamera drone: di label popup, dan di atas layar saat layar penuh (mode kamera depan).
    setZoom(z, full, pitch = -10, roll = 0) {
      const zt = z > 1.02 ? `${z.toFixed(1).replace(/\.0$/, '')}x` : '';
      const pt = `${Math.round(pitch)}°`.replace('-', '−');
      const rt = Math.round(roll) ? ` · ${Math.round(roll) > 0 ? '↻' : '↺'}${Math.abs(Math.round(roll))}°` : '';
      const t = `${pt}${rt}${zt ? ` · ${zt}` : ''}`;
      if (t === lastZoom && full === lastZoomFull) return;
      lastZoom = t; lastZoomFull = full;
      el.zoomtag.textContent = ` · ${t}`;
      el.zoomfs.textContent = `Kamera ${t}`;
      el.zoomfs.style.display = full ? 'block' : 'none';
    },
    // Popup kamera drone disembunyikan di mode kamera depan (layar penuh sudah gambar kamera itu).
    setPipVisible(on) {
      if (on === pipOn) return;
      pipOn = on;
      pipEl.style.visibility = on ? '' : 'hidden';
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
      // Angin: kecepatan saat ini (dengan hembusan); panah = arah tiupan relatif terhadap hidung drone (↑ = searah maju).
      const wv = s.windVel ? Math.hypot(s.windVel[0], s.windVel[1]) : 0;
      put(el.wind, s.wind && s.wind.speed >= 0.3 ? `${wv.toFixed(1)} m/s` : 'tenang');
      const rel = s.wind ? Math.round((((s.wind.dir - t.yaw) % 360) + 360) % 360 / 5) * 5 : 0;
      if (rel !== lastWindRel) { lastWindRel = rel; el.warrow.style.transform = `rotate(${rel}deg)`; }
      el.wind.classList.toggle('low', !!s.wind && s.wind.speed >= 8);
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

      // window centre follows the drone, clamped so the window stays on the map
      const lim = half - C / S;
      const cx = Math.min(lim, Math.max(-lim, t.pos[0])), cz = Math.min(lim, Math.max(-lim, t.pos[2]));
      const toX = (x) => C + (x - cx) * S, toZ = (z) => C + (z - cz) * S;
      mm.fillStyle = MM.bg; mm.fillRect(0, 0, VIEW, VIEW);
      mm.drawImage(stat, O + cx * S - C, O + cz * S - C, VIEW, VIEW, 0, 0, VIEW, VIEW);
      for (let i = 0; i < s.rings.length; i++) {
        const g = s.rings[i];
        mm.fillStyle = g.passed ? '#3ccf8e' : '#ffc247';
        mm.beginPath(); mm.arc(toX(g.x), toZ(g.z), 4, 0, Math.PI * 2); mm.fill();
      }
      if (s.marks) { // marks the pilot placed (found victims, marked defects)
        mm.fillStyle = '#d64545';
        for (let i = 0; i < s.marks.length; i++) { mm.beginPath(); mm.arc(toX(s.marks[i].x), toZ(s.marks[i].z), 4, 0, Math.PI * 2); mm.fill(); }
      }
      mm.fillStyle = MM.text; mm.font = '400 18px Bahnschrift, system-ui, sans-serif'; mm.fillText('Peta mini', 12, 26);
      mm.save();
      // the arrow sits at the centre; near the world edge it moves off-centre, and it is kept inside the panel
      mm.translate(Math.min(VIEW - 10, Math.max(10, toX(t.pos[0]))), Math.min(VIEW - 10, Math.max(10, toZ(t.pos[2]))));
      mm.rotate((t.yaw * Math.PI) / 180);
      mm.fillStyle = '#ff8a1f'; mm.strokeStyle = '#05090c'; mm.lineWidth = 1.5;
      mm.beginPath(); mm.moveTo(0, -10); mm.lineTo(7, 8); mm.lineTo(0, 4); mm.lineTo(-7, 8); mm.closePath(); mm.fill(); mm.stroke();
      mm.restore();
    },
  };
}
