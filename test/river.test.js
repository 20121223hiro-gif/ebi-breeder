import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, advance, sendTrip, useLeaf, placeEquipment, sellMolt, T, H } from '../js/sim.js';
import { DESTS, canSend, teamBonus, planTrip, makeWild } from '../js/river.js';
import { makeShrimp } from '../js/genetics.js';
import { priceOf } from '../js/economy.js';

function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const adults = (s) => Object.values(s.shrimp).filter((x) => x.adultAt <= 0 && x.berriedAt == null);

test('行き先ごとの最低匹数と評判', () => {
  const s = newGame(0, seeded(1));
  const team = adults(s);
  assert.equal(canSend(s, 'ditch', team.slice(0, 1), 0), null);
  assert.equal(canSend(s, 'stream', team.slice(0, 1), 0), '評判 Lv2 で行けるようになります');
  s.reputation = 3;
  assert.equal(canSend(s, 'stream', team.slice(0, 1), 0), '里山の小川は 2匹以上で送ります');
  assert.equal(canSend(s, 'source', team.slice(0, 2), 0), '源流の沢は 3匹以上で送ります');
  assert.equal(canSend(s, 'source', team.slice(0, 3), 0), null);
});

test('色の得意がチーム効果になる', () => {
  const mk = (hue, extra = {}) => ({ hue, sat: 2, pat: 'n', shine: false, ...extra });
  const b = teamBonus([mk('clear'), mk('yellow'), mk('blue')]);
  assert.ok(b.none < 0);
  assert.equal(b.cards, 1);
  assert.equal(b.duration, 0.75);
  const b2 = teamBonus([mk('red', { pat: 's' })]);
  assert.equal(b2.rare, 2);
  assert.ok(b2.friend > 0);
});

test('出発→帰還: エビが水槽から消えて必ず戻り、経験が付く', () => {
  const s = newGame(0, seeded(2));
  const team = adults(s).slice(0, 1);
  assert.equal(sendTrip(s, 'ditch', team.map((x) => x.id), 0, seeded(3)), null);
  assert.ok(s.trip);
  assert.equal(s.tanks[0].shrimpIds.length, 2);
  assert.equal(team[0].away, true);
  assert.equal(sendTrip(s, 'ditch', team.map((x) => x.id), 0, seeded(3)), 'いま遠征中です');
  const ev = advance(s, DESTS.ditch.duration + 1000, seeded(4));
  const ret = ev.find((e) => e.type === 'trip_return');
  assert.ok(ret, '帰還イベントがない');
  assert.equal(s.trip, null);
  assert.equal(team[0].away, false);
  assert.ok(s.tanks[0].shrimpIds.includes(team[0].id));
  assert.equal(team[0].exp, 1 + ret.trip.cards.filter((c) => c.type === 'danger').reduce((a, c) => a + c.exp, 0));
  assert.ok(s.tripCooldown.ditch === DESTS.ditch.cooldown);
  assert.equal(canSend(s, 'ditch', team, DESTS.ditch.duration + 1000), 'まだ休ませてください');
});

test('カードの成果が反映される（お金・素材・仲間・抱卵）', () => {
  const s = newGame(0, seeded(5));
  s.reputation = 3;
  const team = adults(s);
  const rng = seeded(6);
  // 内容を固定して検証
  const trip = planTrip(s, 'source', team, 0, rng, T.life);
  trip.cards = [
    { type: 'find', yen: 300, text: '' },
    { type: 'material', item: 'wood', text: '' },
    { type: 'friend', shrimp: makeWild('source', teamBonus(team), 0, rng, { lifeMs: T.life }), text: '' },
    { type: 'mate', motherId: team.find((x) => x.sex === 'f').id, fatherGenes: { hue: ['red', 'red'], sat: [3, 3], pat: ['n', 'n'] }, fatherSat: 3, text: '' },
    { type: 'danger', exp: 2, text: '' },
  ];
  for (const sh of team) { s.tanks[0].shrimpIds = s.tanks[0].shrimpIds.filter((x) => x !== sh.id); sh.away = true; }
  s.trip = trip;
  const money = s.money;
  const ev = advance(s, trip.returnAt + 1000, seeded(7));
  const ret = ev.find((e) => e.type === 'trip_return');
  assert.equal(s.money, money + 300);
  assert.equal(s.items.wood, 1);
  assert.equal(ret.applied.friends.length, 1);
  assert.equal(Object.keys(s.shrimp).length, 4);
  const mother = s.shrimp[trip.cards[3].motherId];
  assert.ok(mother.berriedAt != null);
  assert.equal(mother.mate.name, '野生のオス');
  assert.equal(mother.hatchAt - mother.berriedAt, T.hatch);
  assert.equal(team[0].exp, 3);
});

test('ワイルド個体は遺伝子が非公開で、★4以上は出ない', () => {
  const rng = seeded(8);
  const b = teamBonus([]);
  for (let i = 0; i < 300; i += 1) {
    const w = makeWild('source', b, 0, rng, { lifeMs: T.life });
    assert.equal(w.geneKnown, false);
    assert.equal(w.wild, true);
    assert.ok(w.tier <= 3, `tier=${w.tier}`);
    assert.equal(w.pat, 'n');
    assert.equal(w.shine, false);
  }
  const boss = makeWild('source', b, 0, rng, { boss: true, lifeMs: T.life });
  assert.equal(boss.sat, 3);
  assert.deepEqual(boss.genes.pat, ['n', 's']);
});

test('素材の使用: 落ち葉・設備・脱皮殻', () => {
  const s = newGame(0, seeded(1));
  const t = s.tanks[0];
  s.items = { leaf: 1, wood: 1, snail: 1, stone: 1, molt: 5 };
  assert.equal(useLeaf(s, t, 0), null);
  assert.equal(t.leafUntil, 24 * H);
  assert.equal(useLeaf(s, t, 0), '落ち葉がありません');
  assert.equal(placeEquipment(s, t, 'wood'), null);
  assert.equal(placeEquipment(s, t, 'snail'), null);
  assert.equal(placeEquipment(s, t, 'stone'), null);
  assert.equal(placeEquipment(s, t, 'wood'), '流木がありません');
  assert.equal(sellMolt(s), null);
  assert.equal(s.money, 800);
  // 設備ありは汚れが遅い
  const s2 = newGame(0, seeded(1));
  advance(s, 12 * H, seeded(2));
  advance(s2, 12 * H, seeded(2));
  assert.ok(s.tanks[0].dirt < s2.tanks[0].dirt);
  assert.ok(s.tanks[0].food > s2.tanks[0].food, '落ち葉で餌が長持ち');
});

test('価格: ワイルドは7割、川帰りは1.2倍', () => {
  const red3 = makeShrimp({ genes: { hue: ['red', 'red'], sat: [3, 3], pat: ['n', 'n'] }, now: 0 }, seeded(1));
  assert.equal(priceOf(red3), 480);
  assert.equal(priceOf({ ...red3, wild: true }), 336);
  assert.equal(priceOf({ ...red3, exp: 5 }), 576);
});

test('満員なら仲間はバケツで待機し、入れる・入れ替える・返すを選べる', async () => {
  const { bucketPlace, bucketSwap, bucketRelease, addTank } = await import('../js/sim.js');
  const s = newGame(0, seeded(9));
  s.reputation = 3;
  const t = s.tanks[0];
  // 水槽を満員にする
  while (t.shrimpIds.length < t.cap) {
    const x = makeShrimp({ now: 0, adult: true, lifeMs: T.life, tankId: t.id }, seeded(t.shrimpIds.length));
    s.shrimp[x.id] = x; t.shrimpIds.push(x.id);
  }
  const team = adults(s).slice(0, 1);
  const trip = planTrip(s, 'ditch', team, 0, seeded(1), T.life);
  trip.cards = [{ type: 'friend', shrimp: makeWild('stream', teamBonus(team), 0, seeded(2), { lifeMs: T.life }), text: '' }];
  t.shrimpIds = t.shrimpIds.filter((x) => x !== team[0].id); team[0].away = true; s.trip = trip;
  // 帰還時、送ったエビが戻って満員 → バケツへ
  const ev = advance(s, trip.returnAt + 1000, seeded(3));
  const ret = ev.find((e) => e.type === 'trip_return');
  assert.equal(ret.applied.bucket.length, 1);
  assert.equal(s.bucket.length, 1);
  assert.equal(t.shrimpIds.length, t.cap);
  // 入れる: 満員なので失敗
  assert.equal(bucketPlace(s, 0, t, 0), 'その水槽は満員です');
  // 入れ替える: 水槽のエビを放してバケツの仲間を入れる
  const outId = t.shrimpIds[0];
  const r = bucketSwap(s, 0, outId, 0);
  assert.ok(r.released);
  assert.equal(s.bucket.length, 0);
  assert.equal(s.shrimp[outId], undefined);
  assert.equal(t.shrimpIds.length, t.cap);
  assert.ok(t.shrimpIds.some((id) => s.shrimp[id].wild));
  // 返す
  s.bucket.push(makeWild('ditch', teamBonus([]), 0, seeded(4), { lifeMs: T.life }));
  assert.ok(bucketRelease(s, 0).released !== undefined);
  assert.equal(s.bucket.length, 0);
  // 水槽を買えば入れられる
  s.bucket.push(makeWild('ditch', teamBonus([]), 0, seeded(5), { lifeMs: T.life }));
  const t2 = addTank(s, 'pla', 0);
  assert.deepEqual(Object.keys(bucketPlace(s, 0, t2, 0)), ['newKeys']);
  assert.equal(t2.shrimpIds.length, 1);
});
