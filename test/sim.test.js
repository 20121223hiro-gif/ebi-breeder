import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, advance, pair, pairError, feed, changeWater, addTank, moveShrimp, nextHatch, T, H, D } from '../js/sim.js';
import { sell, priceOf, sellError, isLastOfSex } from '../js/economy.js';
import { migrate } from '../js/state.js';

function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const bySex = (state, sex) => Object.values(state.shrimp).find((s) => s.sex === sex);

test('初期状態: プラケース1本、透明3匹、資金500', () => {
  const s = newGame(0, seeded(1));
  assert.equal(s.tanks.length, 1);
  assert.equal(Object.keys(s.shrimp).length, 3);
  assert.equal(s.money, 500);
  assert.equal(s.dex.h_clear.count, 3);
});

test('汚れと餌が時間で変化し、換水と餌やりで戻る', () => {
  const s = newGame(0, seeded(1));
  advance(s, 12 * H, seeded(2));
  const t = s.tanks[0];
  assert.ok(t.dirt > 0 && t.dirt < 100);
  assert.ok(t.food < 100);
  feed(t); changeWater(t);
  assert.equal(t.food, 100);
  assert.equal(t.dirt, 0);
});

test('繁殖: 条件チェックと最初の孵化は短縮', () => {
  const s = newGame(0, seeded(1));
  const m = bySex(s, 'm');
  const f = bySex(s, 'f');
  assert.equal(pairError(s, m, f, 0), null);
  assert.equal(pairError(s, f, m, 0) !== null, true);
  assert.equal(pair(s, m, f, 0), null);
  assert.equal(f.hatchAt, T.firstHatch);
  assert.equal(pair(s, m, f, 0), 'このメスは抱卵中です');
  assert.equal(nextHatch(s).id, f.id);
});

test('孵化で稚エビが増え、満員分は失われ、図鑑が更新される', () => {
  const s = newGame(0, seeded(4));
  const m = bySex(s, 'm');
  const f = bySex(s, 'f');
  pair(s, m, f, 0);
  const events = advance(s, T.firstHatch + 1000, seeded(5));
  const hatch = events.find((e) => e.type === 'hatch');
  assert.ok(hatch, '孵化イベントがない');
  assert.equal(hatch.babies.length, 3, '最初の孵化は3匹固定');
  assert.equal(hatch.lost, 0);
  assert.equal(s.tanks[0].shrimpIds.length, 6);
  assert.equal(f.berriedAt, null);
  const total = Object.values(s.dex).reduce((a, d) => a + d.count, 0);
  assert.equal(total, 3 + hatch.babies.length);
  for (const id of hatch.babies) assert.ok(s.shrimp[id].name, '名前がない');
});

test('2回目以降の孵化は8時間', () => {
  const s = newGame(0, seeded(1));
  const m = bySex(s, 'm');
  const f = bySex(s, 'f');
  pair(s, m, f, 0);
  advance(s, T.firstHatch + 1, seeded(1));
  pair(s, m, f, T.firstHatch + 1);
  assert.equal(f.hatchAt - f.berriedAt, T.hatch);
});

test('オフライン進行は24時間で打ち止め', () => {
  const s = newGame(0, seeded(1));
  advance(s, 5 * D, seeded(1));
  assert.equal(s.lastSeenAt, 5 * D);
  // 24時間分しか汚れていない（それ以上なら満員で100%になっている）
  assert.ok(s.tanks[0].dirt <= 100);
  assert.ok(Object.keys(s.shrimp).length === 3, '寿命前なのに死んでいる');
});

test('寿命で死ぬ', () => {
  const s = newGame(0, seeded(1));
  for (const sh of Object.values(s.shrimp)) sh.diesAt = 1000;
  const ev = advance(s, 20 * 60 * 1000, seeded(1));
  assert.equal(ev.filter((e) => e.type === 'death').length, 3);
  assert.equal(Object.keys(s.shrimp).length, 0);
});

test('出荷: 価格と条件、最後の♂の判定', () => {
  const s = newGame(0, seeded(1));
  const m = bySex(s, 'm');
  assert.equal(priceOf(m), 60); // 透明は元手なので安い
  assert.equal(priceOf({ hue: 'purple', sat: 2, pat: 'n', shine: false, tier: 2 }), 720);
  assert.equal(priceOf({ hue: 'red', sat: 3, pat: 'n', shine: false, tier: 3 }), 480);
  assert.equal(priceOf({ hue: 'red', sat: 3, pat: 's', shine: true, tier: 5 }), 2400);
  assert.equal(isLastOfSex(s, m), true);
  assert.equal(sellError(m, 0), null);
  const r = sell(s, [m.id], 0);
  assert.equal(r.total, 60);
  assert.equal(s.money, 560);
  assert.equal(Object.keys(s.shrimp).length, 2);
});

test('水槽の増設と移動', () => {
  const s = newGame(0, seeded(1));
  const t2 = addTank(s, 's30', 0);
  assert.equal(t2.cap, 20);
  assert.equal(t2.name, '30cm水槽 B');
  const m = bySex(s, 'm');
  assert.equal(moveShrimp(s, m, t2), null);
  assert.equal(m.tankId, t2.id);
  assert.equal(s.tanks[0].shrimpIds.length, 2);
});

test('セーブの版管理', () => {
  assert.equal(migrate(null), null);
  assert.equal(migrate({ version: 99 }), null);
  const d = migrate({ version: 1, tanks: [], shrimp: {} });
  assert.equal(d.flags.firstBreedDone, false);
});
