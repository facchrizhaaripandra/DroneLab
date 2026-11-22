import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQuality, LADDER } from '../src/quality.js';

const G = { renderScale: 1, shadows: true };
const feed = (q, fps, seconds, g = G, step = 0.5) => {
  let fired = 0;
  for (let t = 0; t < seconds; t += step) if (q.sample(fps, step, g)) fired++;
  return fired;
};

test('FPS below 30 for 2 s lowers quality one step; shorter dips do not', () => {
  const q = new AdaptiveQuality();
  assert.equal(feed(q, 25, 1.5), 0);
  feed(q, 60, 0.5);                       // recovered: the timer restarts
  assert.equal(feed(q, 25, 1.5), 0);
  assert.equal(feed(q, 25, 0.5), 1);      // 2 s in a row
  assert.equal(q.level, 1);
  assert.deepEqual(q.effective(G), { renderScale: 0.8, shadows: true });
});

test('after a drop there is a cooldown, then it can step down again until the minimum', () => {
  const q = new AdaptiveQuality();
  feed(q, 20, 2);
  assert.equal(q.level, 1);
  assert.equal(feed(q, 20, 2.5), 0);      // 3 s cooldown (2.5 s fed so far) + needs 2 s below
  const drops = feed(q, 20, 60);
  assert.equal(q.level, LADDER.length - 1);
  assert.equal(drops, 2);
  assert.equal(q.effective(G).shadows, false);
  assert.equal(feed(q, 5, 30), 0);        // already at the bottom
});

test('steps that change nothing for the user settings are skipped', () => {
  const low = { renderScale: 0.6, shadows: false };
  const q = new AdaptiveQuality();
  feed(q, 20, 2, low);
  assert.equal(q.level, 3);               // Sedang and Rendah already equal the user setting: jump to Minimum
  assert.deepEqual(q.effective(low), { renderScale: 0.5, shadows: false });
  // user already at the lowest possible: nothing to lower, no false alarm
  const min = { renderScale: 0.5, shadows: false };
  const r = new AdaptiveQuality();
  assert.equal(feed(r, 10, 20, min), 0);
});

test('target 30 uses a lower limit; reset() and holdFor() work', () => {
  const q = new AdaptiveQuality();
  q.setTarget(30);
  assert.equal(q.threshold, 27);
  assert.equal(feed(q, 29.5, 10), 0);     // a healthy 30 FPS cap is not "slow"
  assert.equal(feed(q, 20, 2), 1);
  q.reset();
  assert.equal(q.level, 0);
  q.setTarget(60);
  q.holdFor(3);
  assert.equal(feed(q, 10, 3), 0);        // ignored while holding (world just loaded)
  assert.equal(feed(q, 10, 2), 1);
});
