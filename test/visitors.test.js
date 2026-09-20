import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, advance, pair, careEgg, eggStage, eggAnswer, T, H } from '../js/sim.js';
import { V, matchesWant, deliver, repLevel, wantLabel, visitorPrice } from '../js/visitors.js';
import { makeShrimp } from '../js/genetics.js';

function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const bySex = (state, sex) => Object.values(state.shrimp).find((s) => s.sex === sex);

test('客は5分後に来て40分で帰り、次は1〜2時間後', () => {
  const s = newGame(0, seeded(1));
  let ev = advance(s, V.firstDelay + 1000, seeded(2));
  assert.ok(ev.some((e) => e.type === 'visitor_arrive'));
  assert.ok(s.visitor);
  const arrived = s.visitor.arrivedAt;
  ev = advance(s, arrived + V.stay + 1000, seeded(3));
  assert.ok(ev.some((e) => e.type === 'visitor_leave'));
  assert.equal(s.visitor, null);
  assert.ok(s.nextVisitorAt >= arrived + V.gapMin && s.nextVisitorAt <= arrived + V.gapMax);
});

test('汚れ80%以上の店には客が来ない', () => {
  const s = newGame(0, seeded(1));
  s.tanks[0].dirt = 85;
  const ev = advance(s, V.firstDelay + 1000, seeded(2));
  assert.ok(ev.some((e) => e.type === 'visitor_skip'));
  assert.equal(s.visitor, null);
});

test('希望に合う個体だけ受け取り、資金と評判が増える', () => {
  const s = newGame(0, seeded(1));
  advance(s, V.firstDelay + 1000, seeded(2));
  s.visitor.want = { hue: null, minTier: 1, count: 2, mult: 2 };
  const ids = Object.keys(s.shrimp);
  const before = s.money;
  const r = deliver(s, ids, s.lastSeenAt);
  assert.equal(r.sold.length, 2);
  assert.equal(r.total, 60 * 2 * 2);
  assert.equal(s.money, before + 240);
  assert.equal(s.repPoints, 2);
  assert.equal(r.done, true);
  assert.equal(s.visitor, null);
  assert.equal(Object.keys(s.shrimp).length, 1);
});

test('色と段階の条件判定', () => {
  const red3 = makeShrimp({ genes: { hue: ['red', 'red'], sat: [3, 3], pat: ['n', 'n'] }, now: 0, adult: true, lifeMs: T.life }, seeded(1));
  const clear = makeShrimp({ now: 0, adult: true, lifeMs: T.life }, seeded(1));
  assert.equal(matchesWant(red3, { hue: 'red', minTier: 2, count: 1 }, 0), true);
  assert.equal(matchesWant(red3, { hue: 'blue', minTier: 1, count: 1 }, 0), false);
  assert.equal(matchesWant(red3, { hue: 'red', minTier: 4, count: 1 }, 0), false);
  assert.equal(matchesWant(clear, { hue: null, minTier: 1, count: 1 }, 0), true);
  assert.equal(matchesWant(clear, { hue: null, minTier: 2, count: 1 }, 0), false);
  assert.equal(wantLabel({ hue: 'red', minTier: 3, count: 2 }), '赤 ★3濃以上 ×2匹');
  assert.equal(visitorPrice(red3, { want: { mult: 2.5 } }), 1200);
});

test('評判レベルの閾値', () => {
  assert.equal(repLevel(0), 1);
  assert.equal(repLevel(5), 2);
  assert.equal(repLevel(12), 3);
  assert.equal(repLevel(31), 5);
});

test('抱卵の見守り: 4段階、各1回、正解で孵化数が増える', () => {
  const s = newGame(0, seeded(4));
  const m = bySex(s, 'm');
  const f = bySex(s, 'f');
  pair(s, m, f, 0);
  const span = T.firstHatch / 4;
  assert.equal(eggStage(f, 0), 0);
  assert.equal(eggStage(f, span * 2 + 1), 2);
  const t = s.tanks[0];
  // 段階0: 汚れ0 → 隠れ家が正解
  assert.equal(eggAnswer(0, t), 'shelter');
  let r = careEgg(s, f, 'shelter', 0);
  assert.equal(r.correct, true);
  assert.equal(careEgg(s, f, 'water', 0).error, 'この段階はもう世話をしました');
  // 段階1: 餌100 → 控えるが正解
  r = careEgg(s, f, 'food', span + 1);
  assert.equal(r.correct, true);
  // 段階2: 水温28 → 換水が正解
  t.temp = 28;
  r = careEgg(s, f, 'water', span * 2 + 1);
  assert.equal(r.correct, true);
  assert.equal(f.geneKnown, true, '3正解で遺伝子が開示される');
  // 段階3: わざと不正解
  r = careEgg(s, f, 'food', span * 3 + 1);
  assert.equal(r.correct, false);
  const ev = advance(s, T.firstHatch + 1000, seeded(5));
  const hatch = ev.find((e) => e.type === 'hatch');
  assert.equal(hatch.careOk, 3);
  assert.equal(hatch.babies.length + hatch.lost, 3 + 3, '最初の3匹 + 正解3（定員超過分は lost）');
  assert.equal(f.eggCare, null);
});
