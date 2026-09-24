import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expressHue, expressSat, expressPattern, tierOf, dexKey, childOf, makeShrimp,
  predictChildren, pickName, ALL_DEX_KEYS, labelOfKey,
} from '../js/genetics.js';

// 決定的な乱数（テスト用）
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('色付きは透明に対して優性', () => {
  assert.equal(expressHue(['clear', 'clear']), 'clear');
  assert.equal(expressHue(['red', 'clear']), 'red');
  assert.equal(expressHue(['clear', 'blue']), 'blue');
  assert.equal(expressHue(['red', 'red']), 'red');
});

test('色付き同士はどちらかが出る', () => {
  const rng = seeded(3);
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) seen.add(expressHue(['red', 'blue'], rng));
  assert.deepEqual([...seen].sort(), ['blue', 'red']);
});

test('発色は低い方を基準に最大1段上がる', () => {
  assert.equal(expressSat([2, 2]), 2);
  assert.equal(expressSat([1, 3], () => 0.9), 1);
  assert.equal(expressSat([1, 3], () => 0.1), 2);
});

test('縞は劣性', () => {
  assert.equal(expressPattern(['n', 's']), 'n');
  assert.equal(expressPattern(['s', 's']), 's');
});

test('段階と図鑑キー', () => {
  assert.equal(dexKey({ hue: 'red', sat: 3, pat: 'n', shine: false }), 'r3');
  assert.equal(dexKey({ hue: 'red', sat: 3, pat: 's', shine: false }), 'r4');
  assert.equal(dexKey({ hue: 'blue', sat: 1, pat: 's', shine: true }), 'b5');
  assert.equal(dexKey({ hue: 'purple', sat: 2, pat: 'n', shine: false }), 'h_purple');
  assert.equal(tierOf({ sat: 2, pat: 'n', shine: false }), 2);
  assert.equal(ALL_DEX_KEYS.length, 30);
  assert.equal(labelOfKey('r4'), '赤 ★4 縞');
  assert.equal(labelOfKey('h_gold'), '金');
});

test('保因者同士で縞が約25%出る', () => {
  const rng = seeded(7);
  const m = makeShrimp({ genes: { hue: ['red', 'red'], sat: [2, 2], pat: ['n', 's'] }, now: 0 }, rng);
  const f = makeShrimp({ genes: { hue: ['red', 'red'], sat: [2, 2], pat: ['n', 's'] }, now: 0 }, rng);
  let stripes = 0;
  const n = 2000;
  for (let i = 0; i < n; i += 1) if (childOf(m, f, { now: 0 }, rng).pat === 's') stripes += 1;
  const rate = stripes / n;
  assert.ok(rate > 0.2 && rate < 0.36, `rate=${rate}`);
});

test('輝は濃×濃の子にだけ出て、遺伝しない', () => {
  const rng = seeded(11);
  const m = makeShrimp({ genes: { hue: ['red', 'red'], sat: [3, 3], pat: ['n', 'n'] }, now: 0 }, rng);
  const f = makeShrimp({ genes: { hue: ['red', 'red'], sat: [3, 3], pat: ['n', 'n'] }, now: 0 }, rng);
  let shine = 0;
  for (let i = 0; i < 3000; i += 1) if (childOf(m, f, { now: 0 }, rng).shine) shine += 1;
  assert.ok(shine > 40 && shine < 150, `shine=${shine}`);
  const low = makeShrimp({ genes: { hue: ['red', 'red'], sat: [1, 1], pat: ['n', 'n'] }, now: 0 }, rng);
  for (let i = 0; i < 500; i += 1) assert.equal(childOf(low, f, { now: 0 }, rng).shine, false);
});

test('赤×青から稀に紫が出て、紫同士は固定化される', () => {
  const rng = seeded(5);
  const m = makeShrimp({ genes: { hue: ['red', 'red'], sat: [2, 2], pat: ['n', 'n'] }, now: 0 }, rng);
  const f = makeShrimp({ genes: { hue: ['blue', 'blue'], sat: [2, 2], pat: ['n', 'n'] }, now: 0 }, rng);
  let purple = null;
  for (let i = 0; i < 3000 && !purple; i += 1) {
    const c = childOf(m, f, { now: 0 }, rng);
    if (c.hue === 'purple') purple = c;
  }
  assert.ok(purple, '紫が出なかった');
  assert.deepEqual(purple.genes.hue, ['purple', 'purple']);
  const p2 = { ...purple, sex: 'f' };
  let fixed = 0;
  for (let i = 0; i < 200; i += 1) if (childOf(p2, purple, { now: 0 }, rng).hue === 'purple') fixed += 1;
  assert.ok(fixed > 170, `fixed=${fixed}`);
});

test('予想は確率の合計が1で輝を含まない', () => {
  const rng = seeded(2);
  const m = makeShrimp({ genes: { hue: ['red', 'blue'], sat: [3, 3], pat: ['n', 'n'] }, now: 0 }, rng);
  const f = makeShrimp({ genes: { hue: ['red', 'blue'], sat: [3, 3], pat: ['n', 'n'] }, now: 0 }, rng);
  const pred = predictChildren(m, f, 500, rng);
  const sum = pred.reduce((a, b) => a + b.p, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(!pred.some((x) => x.key.endsWith('5')));
});

test('名前は水槽内で重ならない', () => {
  const rng = seeded(9);
  const used = [];
  for (let i = 0; i < 12; i += 1) {
    const n = pickName('red', used, rng);
    assert.ok(!used.includes(n), n);
    used.push(n);
  }
});

test('透明・隠し色は縞や輝の遺伝子を持っていても★1扱い', () => {
  assert.equal(tierOf({ hue: 'clear', sat: 2, pat: 's', shine: false }), 1);
  assert.equal(tierOf({ hue: 'purple', sat: 3, pat: 's', shine: true }), 1);
  assert.equal(dexKey({ hue: 'clear', sat: 2, pat: 's', shine: false }), 'h_clear');
  assert.equal(tierOf({ hue: 'red', sat: 2, pat: 's', shine: false }), 4);
});
