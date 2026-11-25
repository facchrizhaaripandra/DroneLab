import test from 'node:test';
import assert from 'node:assert/strict';
import { moveFocus } from '../src/ui.js';
import { mainMenuSpec, missionSpec, resultSpec, pauseSpec } from '../src/screens.js';
import { MISSIONS, getMission } from '../src/missions.js';

const noop = () => {};

test('moveFocus skips disabled items and wraps around', () => {
  const items = [{}, { enabled: false }, {}, { enabled: false }];
  assert.equal(moveFocus(items, 0, 1), 2);
  assert.equal(moveFocus(items, 2, 1), 0);
  assert.equal(moveFocus(items, 0, -1), 2);
  assert.equal(moveFocus([{ enabled: false }], 0, 1), 0);
});

test('main menu has the six spec entries; all entries are enabled', () => {
  const s = mainMenuSpec({ quickStart: noop, missions: noop, freeroam: noop, scenes: noop, editor: noop, settings: noop, help: noop });
  assert.deepEqual(s.items.map((i) => i.label), ['Mulai', 'Misi', 'Freeroam', 'Peta realistis', 'Editor perintah', 'Pengaturan', 'Bantuan']);
  assert.ok(s.items.every((i) => i.enabled !== false));
});

test('mission list: every mission playable, one entry per variant', () => {
  const s = missionSpec(MISSIONS, 'stub', { start: noop, back: noop });
  const playable = s.items.filter((i) => i.enabled !== false && i.label !== 'Kembali');
  assert.equal(playable.length, 19); // 3 latihan + 16 varian utama: M1, M2, M5 masing-masing 2 peta realistis + 2 acak, M3 dan M4 masing-masing 1 + 1 acak
  assert.ok(playable.some((i) => /sawah \(peta realistis\)/.test(i.label)) && playable.some((i) => /lahan \(acak\)/.test(i.label)));
  assert.match(s.subtitle, /lokal/);
  assert.match(missionSpec(MISSIONS, 'online', { start: noop, back: noop }).subtitle, /resmi/);
});

test('result screen shows the breakdown, labels provisional vs official, and escapes text', () => {
  const res = { score: 78, grade: 'silver', breakdown: [{ name: '<b>x</b>', points: 10, max: 20, note: 'a & b' }] };
  const local = resultSpec(getMission('m4_delivery'), 'completed', res, false, { retry: noop, missions: noop, main: noop });
  assert.match(local.body, /sementara/);
  assert.ok(!local.body.includes('<b>x</b>'));
  assert.match(local.body, /&lt;b&gt;/);
  assert.match(resultSpec(getMission('m4_delivery'), 'completed', res, true, {}).body, /resmi/);
  assert.match(resultSpec(getMission('m4_delivery'), 'completed', null, false, {}).body, /tidak tersedia/);
  assert.equal(pauseSpec({ resume: noop, retry: noop, main: noop }).items.length, 3);
});

test('pause menu offers the settings while the game is paused', () => {
  const noop = () => {};
  let opened = false;
  const s = pauseSpec({ resume: noop, retry: noop, main: noop, settings: () => { opened = true; } });
  assert.deepEqual(s.items.map((i) => i.label), ['Lanjut', 'Ulangi', 'Pengaturan', 'Menu utama']);
  s.items[2].action();
  assert.equal(opened, true);
});
