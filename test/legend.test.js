// 伝説（虹色）: ★5輝を5色そろえた店で★5同士を組むと1匹だけ生まれる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, advance, pair, legendStatus, T } from '../js/sim.js';
import { makeShrimp, dexKey, tierOf, isHidden, COLOR_HUES, ALL_DEX_KEYS, labelOf } from '../js/genetics.js';
import { sellError, priceOf } from '../js/economy.js';
import { matchesWant, genWant } from '../js/visitors.js';

function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function addShine(state, hue, sex, rng) {
  const sh = makeShrimp({ genes: { hue: [hue, hue], sat: [3, 3], pat: ['n', 'n'] }, shine: true, sex, now: 0, adult: true, lifeMs: T.life, tankId: state.tanks[0].id }, rng);
  sh.name = `${hue}-${sex}`;
  state.shrimp[sh.id] = sh;
  state.tanks[0].shrimpIds.push(sh.id);
  return sh;
}

test('虹色: 条件判定と誕生は1回きり、出荷できない', () => {
  const rng = seeded(11);
  const s = newGame(0, rng);
  s.flags.firstBreedDone = true;
  s.flags.firstHatchDone = true;
  s.tanks[0].cap = 30;
  // 4色だけでは足りない
  const m = addShine(s, 'red', 'm', rng);
  const f = addShine(s, 'blue', 'f', rng);
  addShine(s, 'yellow', 'm', rng);
  addShine(s, 'black', 'f', rng);
  let st = legendStatus(s, m, f, 0);
  assert.equal(st.pairOk, true);
  assert.deepEqual(st.missing, ['green']);
  assert.equal(st.ready, false);
  // 5色そろう。ただし稚エビ・遠征中は数えない
  const g = addShine(s, 'green', 'm', rng);
  g.adultAt = T.grow;
  assert.equal(legendStatus(s, m, f, 0).ready, false, '稚エビの★5は数えない');
  g.adultAt = 0;
  g.away = true;
  assert.equal(legendStatus(s, m, f, 0).ready, false, '遠征中の★5は数えない');
  g.away = false;
  st = legendStatus(s, m, f, 0);
  assert.equal(st.ready, true);
  assert.equal(st.hues.length, 5);
  // ★5でない相手では条件を満たさない
  const plain = makeShrimp({ genes: { hue: ['red', 'red'], sat: [3, 3], pat: ['n', 'n'] }, sex: 'm', now: 0, adult: true, lifeMs: T.life, tankId: s.tanks[0].id }, rng);
  s.shrimp[plain.id] = plain; s.tanks[0].shrimpIds.push(plain.id);
  assert.equal(legendStatus(s, plain, f, 0).ready, false);

  // 組む → 卵に印が付く → 孵化で虹色が1匹
  assert.equal(pair(s, m, f, 0), null);
  assert.equal(f.legend, true);
  const ev = advance(s, T.hatch + 1000, rng);
  const h = ev.find((e) => e.type === 'hatch');
  assert.ok(h.legendId, '虹色が生まれる');
  const rb = s.shrimp[h.legendId];
  assert.equal(rb.hue, 'rainbow');
  assert.equal(dexKey(rb), 'h_rainbow');
  assert.ok(ALL_DEX_KEYS.includes('h_rainbow'));
  assert.equal(isHidden(rb.hue), true);
  assert.equal(tierOf(rb), 1);
  assert.equal(labelOf(rb), '虹');
  assert.ok(h.newKeys.includes('h_rainbow'));
  assert.equal(h.newKeys[0], 'h_rainbow', '演出は虹色が最初');
  assert.ok(s.dex.h_rainbow && s.dex.h_rainbow.count === 1);
  assert.equal(s.flags.legendBorn.name, rb.name);
  assert.equal(s.flags.legendBorn.id, rb.id);
  assert.ok(h.babies.length >= 2, '普通の子も一緒に生まれる');
  assert.equal(f.legend, false);
  // 出荷・客への納品はできない。価格は正の数（不変条件用）
  rb.adultAt = 0;
  assert.equal(sellError(rb, T.hatch + 1000), '伝説のエビは出荷できません');
  assert.equal(matchesWant(rb, { hue: null, minTier: 1, count: 1 }, T.hatch + 1000), false);
  assert.ok(priceOf(rb) > 0);
  // 虹色の子は虹色にならない（遺伝しない）
  assert.ok(!rb.genes.hue.includes('rainbow'));
  // 客は虹色を名指しで頼まない（売れないため）
  const vr = seeded(3);
  for (let i = 0; i < 300; i += 1) assert.notEqual(genWant(s, vr).hue, 'rainbow');

  // 2回目は生まれない
  const m2 = addShine(s, 'red', 'm', rng);
  const f2 = addShine(s, 'blue', 'f', rng);
  assert.equal(legendStatus(s, m2, f2, T.hatch + 1000).born, true);
  assert.equal(legendStatus(s, m2, f2, T.hatch + 1000).ready, false);
  pair(s, m2, f2, T.hatch + 1000);
  assert.equal(f2.legend, false);
  const ev2 = advance(s, T.hatch * 2 + 2000, rng);
  const h2 = ev2.find((e) => e.type === 'hatch');
  assert.equal(h2.legendId, null);
  assert.equal(Object.values(s.shrimp).filter((x) => x.hue === 'rainbow').length, 1);
});

test('虹色: 満員の水槽でも必ず生まれる', () => {
  const rng = seeded(5);
  const s = newGame(0, rng);
  s.flags.firstBreedDone = true;
  s.flags.firstHatchDone = true;
  for (const hue of COLOR_HUES) addShine(s, hue, hue === 'blue' ? 'f' : 'm', rng);
  const m = Object.values(s.shrimp).find((x) => x.shine && x.sex === 'm');
  const f = Object.values(s.shrimp).find((x) => x.shine && x.sex === 'f');
  // 定員いっぱいにする
  while (s.tanks[0].shrimpIds.length < s.tanks[0].cap) addShine(s, 'red', 'm', rng);
  assert.equal(pair(s, m, f, 0), null);
  const ev = advance(s, T.hatch + 1000, rng);
  const h = ev.find((e) => e.type === 'hatch');
  assert.ok(h.legendId);
  assert.equal(s.shrimp[h.legendId].tankId, s.tanks[0].id);
  assert.ok(h.lost > 0, '普通の子は満員で失われる');
});
