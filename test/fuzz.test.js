// ランダム操作で長時間回して、壊れないこと（不変条件）を確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, advance, pair, pairError, feed, changeWater, addTank, moveShrimp, sendTrip, careEgg, eggStage,
  bucketPlace, bucketSwap, bucketRelease, useLeaf, placeEquipment, removeEquipment, sellMolt, upgradeTank, upgradeInfo, T, H,
} from '../js/sim.js';
import { sell, sellError, priceOf } from '../js/economy.js';
import { deliver, matchesWant } from '../js/visitors.js';
import { tierOf, dexKey, ALL_DEX_KEYS, isHidden } from '../js/genetics.js';
import { migrate } from '../js/state.js';

function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function checkInvariants(s, label) {
  // 各エビは「1つの水槽」か「遠征中」か「バケツ」のどれか
  const inTanks = new Map();
  for (const t of s.tanks) {
    assert.ok(t.shrimpIds.length <= Math.max(t.cap, t.shrimpIds.length), label);
    for (const id of t.shrimpIds) {
      assert.ok(s.shrimp[id], `${label}: 水槽に存在しないエビ ${id}`);
      assert.equal(s.shrimp[id].tankId, t.id, `${label}: tankId不一致 ${id}`);
      assert.ok(!inTanks.has(id), `${label}: 2つの水槽にいる ${id}`);
      inTanks.set(id, t.id);
    }
  }
  const tripIds = new Set(s.trip?.ids ?? []);
  for (const [id, sh] of Object.entries(s.shrimp)) {
    if (sh.away) assert.ok(tripIds.has(id), `${label}: away なのに遠征にいない ${sh.name}`);
    else assert.ok(inTanks.has(id), `${label}: どの水槽にもいない ${sh.name}`);
    assert.ok(Number.isFinite(sh.adultAt) && Number.isFinite(sh.diesAt), label);
    assert.ok(tierOf(sh) >= 1 && tierOf(sh) <= 5, label);
    assert.ok(ALL_DEX_KEYS.includes(dexKey(sh)), `${label}: 図鑑キー不正 ${dexKey(sh)}`);
    assert.ok(priceOf(sh) > 0 && Number.isFinite(priceOf(sh)), label);
    if (sh.berriedAt != null) assert.ok(sh.hatchAt > sh.berriedAt && sh.mate, label);
    if (isHidden(sh.hue)) assert.equal(tierOf(sh), 1, `${label}: 隠し色の段階`);
  }
  assert.ok(Number.isFinite(s.money) && s.money >= 0, `${label}: 資金 ${s.money}`);
  for (const t of s.tanks) {
    assert.ok(t.dirt >= 0 && t.dirt <= 100 && t.food >= 0 && t.food <= 100, `${label}: ゲージ範囲`);
    assert.ok((t.equipment ?? []).length <= 3, label);
  }
  for (const [k, v] of Object.entries(s.items ?? {})) assert.ok(v >= 0, `${label}: 素材 ${k} が負`);
  // セーブ→読み込みが通る
  const back = migrate(JSON.parse(JSON.stringify(s)));
  assert.ok(back && Object.keys(back.shrimp).length === Object.keys(s.shrimp).length, label);
}

test('ランダム操作を30日分回しても不変条件が崩れない', () => {
  const rng = seeded(2024);
  const s = newGame(0, rng);
  s.money = 20000;
  let now = 0;
  const shr = () => Object.values(s.shrimp);
  for (let step = 0; step < 30 * 24 * 2; step += 1) { // 30分刻みで30日
    now += 30 * 60 * 1000;
    advance(s, now, rng);
    const list = shr();
    const r = rng();
    try {
      if (r < 0.12) {
        const m = list.find((x) => x.sex === 'm' && !x.away && x.adultAt <= now);
        const f = list.find((x) => x.sex === 'f' && !x.away && x.adultAt <= now && x.berriedAt == null && m && x.tankId === m.tankId);
        if (m && f && !pairError(s, m, f, now)) pair(s, m, f, now);
      } else if (r < 0.2) {
        for (const t of s.tanks) { if (rng() < 0.7) feed(t); if (rng() < 0.5) changeWater(t); }
      } else if (r < 0.28) {
        const b = list.find((x) => x.berriedAt != null && eggStage(x, now) >= 0);
        if (b) careEgg(s, b, ['water', 'food', 'shelter'][Math.floor(rng() * 3)], now);
      } else if (r < 0.36) {
        const sellable = list.filter((x) => !sellError(x, now));
        if (sellable.length > 4) sell(s, sellable.slice(0, 1 + Math.floor(rng() * 3)).map((x) => x.id), now);
      } else if (r < 0.42 && s.visitor) {
        const ok = list.filter((x) => matchesWant(x, s.visitor.want, now));
        if (ok.length) deliver(s, ok.map((x) => x.id), now);
      } else if (r < 0.52 && !s.trip) {
        const dest = ['ditch', 'stream', 'source'][Math.floor(rng() * 3)];
        const t = s.tanks[Math.floor(rng() * s.tanks.length)];
        const team = t.shrimpIds.map((id) => s.shrimp[id]).filter((x) => x.adultAt <= now && x.berriedAt == null).slice(0, 3);
        sendTrip(s, dest, team.map((x) => x.id), now, rng);
      } else if (r < 0.58) {
        if (s.tanks.length < 4 && s.money > 1000) { s.money -= 800; addTank(s, 'pla', now); }
      } else if (r < 0.64) {
        const x = list.find((y) => !y.away && y.berriedAt == null);
        const t = s.tanks[Math.floor(rng() * s.tanks.length)];
        if (x && t.id !== x.tankId) moveShrimp(s, x, t);
      } else if (r < 0.72 && s.bucket?.length) {
        const k = rng();
        const t = s.tanks.find((y) => y.shrimpIds.length < y.cap);
        if (k < 0.4 && t) bucketPlace(s, 0, t, now);
        else if (k < 0.7) { const out = list.find((y) => !y.away && y.berriedAt == null); if (out) bucketSwap(s, 0, out.id, now); }
        else bucketRelease(s, 0);
      } else if (r < 0.8) {
        const t = s.tanks[Math.floor(rng() * s.tanks.length)];
        const items = ['leaf', 'wood', 'stone', 'snail'];
        const it = items[Math.floor(rng() * items.length)];
        if (it === 'leaf') useLeaf(s, t, now); else if (rng() < 0.7) placeEquipment(s, t, it); else removeEquipment(s, t, 0);
        sellMolt(s);
      } else if (r < 0.85) {
        const t = s.tanks[Math.floor(rng() * s.tanks.length)];
        if (!upgradeInfo(s, t).error) upgradeTank(s, t, now);
      }
    } catch (e) {
      throw new Error(`step ${step}: 操作中に例外 ${e.stack}`);
    }
    checkInvariants(s, `step ${step} (day ${(now / (24 * H)).toFixed(1)})`);
  }
  // 30日回して何かは起きているはず
  assert.ok(Object.keys(s.dex).length >= 1);
  assert.ok(s.log !== undefined);
});
