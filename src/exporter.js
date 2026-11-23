// Dataset export page (open the simulator with ?export=1). Renders many worlds from many camera poses,
// saves 640x360 JPEGs with YOLO label files and a manifest, all in one ZIP download. Needs a browser (WebGL).
// The planning and the ground-truth boxes are in dataset.js (tested in Node); this file only draws and saves.
import * as THREE from 'three';
import { CAM } from './camera-model.js';
import { SIZE, CLASSES, datasetObjects, labelFrame, yoloLines, planDataset, poseFor, makeZip } from './dataset.js';
import { makeMissionConfig } from './worldconfig.js';
import { smokeBlocks } from './vision.js';

const DEG = Math.PI / 180;
const THERMAL_FILTER = 'grayscale(1) contrast(1.5) sepia(1) hue-rotate(-25deg) saturate(3.5)'; // same look as the game's thermal mode
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// ctx: { stage, renderer, scene, drone, hud, loadWorld(cfg), getWorld(), getConfig(), setExporting(bool), restore() }
export function openExporter(ctx) {
  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#e9e7e2;font-family:system-ui,sans-serif;color:#1f1f1f;z-index:20';
  panel.innerHTML = `<div style="width:620px;background:#fff;border:1px solid #1f1f1f;padding:24px 28px">
    <h1 style="margin:0 0 4px;font-size:28px">Ekspor dataset YOLO</h1>
    <p style="margin:0 0 14px;color:#5a5a56">Merender dunia misi dari banyak sudut kamera, menyimpan gambar 640×360 dan kotak kebenaran dasar dalam satu berkas ZIP.</p>
    <label style="display:block;margin:8px 0">Jumlah gambar <input id="ex-n" type="number" value="200" min="8" max="5000" style="width:90px;font-size:16px"></label>
    <label style="display:block;margin:8px 0">Seed rencana <input id="ex-seed" type="number" value="7" style="width:90px;font-size:16px"></label>
    <label style="display:block;margin:8px 0"><input id="ex-th" type="checkbox" checked> Sertakan sekitar 10% gambar mode panas</label>
    <div style="margin:14px 0"><button id="ex-go" style="font-size:18px;padding:8px 18px">Mulai</button> <button id="ex-stop" style="font-size:18px;padding:8px 18px" disabled>Berhenti</button></div>
    <div id="ex-log" style="font:14px ui-monospace,Consolas,monospace;white-space:pre-wrap;min-height:90px;border:1px solid #bdbbb5;padding:8px"></div></div>`;
  ctx.stage.appendChild(panel);
  const $ = (id) => panel.querySelector('#' + id);
  const log = (t) => { $('ex-log').textContent = t; };
  let stop = false, busy = false;
  $('ex-stop').onclick = () => { stop = true; };
  $('ex-go').onclick = async () => {
    if (busy) return;
    busy = true; stop = false; $('ex-go').disabled = true; $('ex-stop').disabled = false;
    try { await run(Number($('ex-n').value), Number($('ex-seed').value), $('ex-th').checked); }
    catch (e) { log(`Galat: ${e.message || e}`); console.error(e); }
    ctx.restore();
    busy = false; $('ex-go').disabled = false; $('ex-stop').disabled = true;
  };

  async function run(count, seed, withThermal) {
    const plan = planDataset({ count, seed });
    const cam = new THREE.PerspectiveCamera(CAM.vfov, CAM.aspect, 0.1, 500);
    cam.rotation.order = 'YXZ';
    const flat = document.createElement('canvas');
    flat.width = SIZE.w; flat.height = SIZE.h;
    const g = flat.getContext('2d');
    const files = [], manifest = [], perClass = Object.fromEntries(CLASSES.map((c) => [c, 0]));
    ctx.setExporting(true);
    ctx.drone.group.visible = false;
    ctx.hud.setVisible(false);
    ctx.renderer.setPixelRatio(1);
    ctx.renderer.setSize(SIZE.w, SIZE.h, false);
    let saved = 0, w = 0;
    for (const world of plan) {
      if (stop) break;
      const cfg = makeMissionConfig(world.mission, world.seed, world.variant);
      ctx.loadWorld(cfg);
      ctx.drone.group.visible = false;
      const config = ctx.getConfig(), wd = ctx.getWorld(), objs = datasetObjects(config);
      const classes = [...new Set(objs.map((o) => o.label))];
      let i = 0;
      for (const shot of world.shots) {
        const cls = classes[shot.k % classes.length];
        const pool = objs.filter((o) => o.label === cls);
        const target = pool[(shot.k >> 3) % pool.length];
        const pose = poseFor(target, shot);
        const thermal = withThermal && shot.thermal;
        const labels = labelFrame(pose, objs, { blocked: thermal ? null : (o) => smokeBlocks(config, pose.pos, o) });
        if (!labels.length) continue; // frames without any object are skipped
        wd.setShadows(shot.shadows); wd.setSun(shot.sunAz, shot.sunEl); wd.followLight(pose.pos[0], pose.pos[2]); wd.setThermal(thermal);
        cam.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
        cam.rotation.set(pose.pitch * DEG, -pose.yaw * DEG, 0);
        ctx.renderer.render(ctx.scene, cam);
        g.filter = thermal ? THERMAL_FILTER : 'none'; // draw right after render, in the same task, so the WebGL canvas is still valid
        g.drawImage(ctx.renderer.domElement, 0, 0, SIZE.w, SIZE.h);
        const blob = await new Promise((r) => flat.toBlob(r, 'image/jpeg', 0.9));
        const name = `${world.split}/${world.mission}_${world.variant || 'kota'}_${world.seed}_${i++}`;
        files.push({ name: `images/${name}.jpg`, data: new Uint8Array(await blob.arrayBuffer()) });
        files.push({ name: `labels/${name}.txt`, data: yoloLines(labels) });
        manifest.push({ file: `images/${name}.jpg`, split: world.split, mission: world.mission, variant: world.variant || null, seed: world.seed, thermal,
          pose: { pos: pose.pos.map((v) => Math.round(v * 100) / 100), yaw: Math.round(pose.yaw * 10) / 10, pitch: Math.round(pose.pitch * 10) / 10 }, sun: { az: shot.sunAz, el: shot.sunEl }, labels });
        for (const l of labels) perClass[l.cls]++;
        saved++;
      }
      w++;
      log(`Dunia ${w} dari ${plan.length} · gambar tersimpan ${saved}\n${CLASSES.map((c) => `${c}: ${perClass[c]}`).join('  ')}`);
      await nextFrame(); // let the page breathe and the Stop button work
    }
    files.push({ name: 'classes.txt', data: CLASSES.join('\n') + '\n' });
    files.push({ name: 'data.yaml', data: `path: .\ntrain: images/train\nval: images/val\ntest: images/test\nnc: ${CLASSES.length}\nnames: [${CLASSES.join(', ')}]\n` });
    files.push({ name: 'manifest.json', data: JSON.stringify({ api_version: '1', classes: CLASSES, size: SIZE, count: saved, per_class: perClass, plan_seed: seed, items: manifest }, null, 1) });
    files.push({ name: 'README.txt', data: 'DroneLab3D dataset.\nimages/<split>/*.jpg 640x360, labels/<split>/*.txt in YOLO format (class cx cy w h, normalized).\nSplit by world seed: test seeds (3000-3499) never appear in train (1000-1499) or val (2000-2499).\nBoxes come from projected bounding boxes of the world objects (not pixel-tight), objects hidden by smoke are not labeled in normal mode.\n' });
    const zip = makeZip(files);
    const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'dronelab-dataset.zip'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    log(`${stop ? 'Dihentikan. ' : ''}Selesai: ${saved} gambar, ${(zip.length / 1e6).toFixed(1)} MB (dronelab-dataset.zip).\n${CLASSES.map((c) => `${c}: ${perClass[c]}`).join('  ')}`);
  }
}
