// 階級: 実績 → 審査員の試練 → 改装費で昇格
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, advance, addTank, T, H } from '../js/sim.js';
import { makeShrimp } from '../js/genetics.js';
import { deliver, matchesWant, V } from '../js/visitors.js';
import { RANKS, JUDGE, rankReqs, rankStatus, callJudge, promote, initialRank } from '../js/rank.js';
import { migrate } from '../js/state.js';

function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function addShrimp(state, { hue, sat = 1, pat = 'n', shine = false, sex = 'm' }, rng) {
  const sh = makeShrimp({ genes: { hue: [hue, hue], sat: [sat, sat], pat: [pat, pat] }, shine, sex, now: 0, adult: true, lifeMs: T.life, tankId: state.tanks[0].id }, rng);
  sh.name = `${hue}${sat}${pat}`;
  state.shrimp[sh.id] = sh;
  state.tanks[0].shrimpIds.push(sh.id);
  return sh;
}

test('新規は見習い。実績がそろうまで審査員は呼べない', () => {
  const s = newGame(0, seeded(1));
  assert.equal(s.rank, 1);
  const st = rankStatus(s, 0);
  assert.equal(st.cur.name, '見習い');
  assert.equal(st.next.name, '町のエビ屋');
  assert.equal(st.reqsOk, false);
  assert.equal(callJudge(s, 0), '実績の条件がまだそろっていません');
  assert.equal(promote(s, 0), '実績の条件がまだそろっていません');
});

test('町のエビ屋へ: 納品10回+色付き → 審査員 → 納品で合格 → 改装費で昇格', () => {
  const rng = seeded(2);
  const s = newGame(0, rng);
  s.repPoints = 10;
  s.dex.r1 = { foundAt: 0, count: 1, first: 'モモ' };
  s.money = 5000;
  s.tanks[0].cap = 20;
  assert.equal(rankStatus(s, 0).reqsOk, true);
  assert.equal(rankStatus(s, 0).trialPassed, false);
  // 普通の客がいる間は呼べない
  s.visitor = { id: 'v', name: '田中さん', arrivedAt: 0, leavesAt: V.stay, want: { hue: null, minTier: 1, count: 1, mult: 2 }, delivered: 0 };
  assert.equal(callJudge(s, 0), '客が帰ってから呼んでください');
  s.visitor = null;
  assert.equal(callJudge(s, 0), null);
  assert.equal(s.visitor.name, JUDGE.name);
  assert.equal(s.visitor.judge, 2);
  assert.equal(s.visitor.leavesAt, JUDGE.stay);
  assert.deepEqual(s.trial, { rank: 2, passed: false, calledAt: 0 });
  assert.equal(rankStatus(s, 0).judgeHere, true);
  assert.equal(callJudge(s, 0), '審査員はもう来ています');
  // 試練は ★2以上 ×2。透明や隠し色では通らない（strict）
  const clear = Object.values(s.shrimp)[0];
  assert.equal(matchesWant(clear, s.visitor.want, 0), false);
  const gold = makeShrimp({ hidden: 'gold', now: 0, adult: true, lifeMs: T.life, tankId: s.tanks[0].id }, rng);
  s.shrimp[gold.id] = gold; s.tanks[0].shrimpIds.push(gold.id);
  assert.equal(matchesWant(gold, s.visitor.want, 0), false, '審査員の★条件枠に隠し色は入らない');
  assert.equal(matchesWant(gold, { hue: null, minTier: 2, count: 1 }, 0), true, '普通の客なら隠し色も可');
  const a = addShrimp(s, { hue: 'red', sat: 2 }, rng);
  const b = addShrimp(s, { hue: 'blue', sat: 3, sex: 'f' }, rng);
  const before = s.money;
  const r = deliver(s, [clear.id, a.id, b.id], 0);
  assert.equal(r.sold.length, 2);
  assert.equal(r.done, true);
  assert.equal(s.money, before + 120 * 2 * 3 + 120 * 4 * 3);
  assert.equal(s.visitor, null);
  assert.equal(s.trial.passed, true);
  const st = rankStatus(s, 0);
  assert.equal(st.trialPassed, true);
  assert.equal(st.canPromote, true);
  // 改装費を払って昇格
  const m = s.money;
  assert.equal(promote(s, 1000), null);
  assert.equal(s.rank, 2);
  assert.equal(s.money, m - 1500);
  assert.equal(s.trial, null);
  assert.equal(rankStatus(s, 1000).cur.name, '町のエビ屋');
  assert.equal(rankStatus(s, 1000).next.name, '名の知れた店');
});

test('審査員が24時間で帰ると試練は不合格のまま。呼び直せる', () => {
  const rng = seeded(3);
  const s = newGame(0, rng);
  s.repPoints = 10;
  s.dex.r1 = { foundAt: 0, count: 1, first: 'モモ' };
  assert.equal(callJudge(s, 0), null);
  const ev = advance(s, JUDGE.stay + 1000, rng);
  assert.ok(ev.some((e) => e.type === 'visitor_leave' && e.name === JUDGE.name));
  assert.equal(rankStatus(s, JUDGE.stay + 1000).trialPassed, false);
  // 普通の客が来ていなければ再び呼べる
  s.visitor = null;
  assert.equal(callJudge(s, JUDGE.stay + 2000), null);
});

test('改装費が足りないと昇格できない。伝説は試練も改装費もなし', () => {
  const rng = seeded(4);
  const s = newGame(0, rng);
  s.repPoints = 10;
  s.dex.r1 = { foundAt: 0, count: 1, first: 'モモ' };
  s.money = 100;
  s.trial = { rank: 2, passed: true };
  assert.equal(promote(s, 0), 'コインが足りません');
  assert.equal(rankStatus(s, 0).canPromote, false);
  // 伝説
  s.rank = 5;
  s.trial = null;
  for (const k of ['r', 'b', 'y', 'k', 'g']) for (const t of [1, 2, 3, 4, 5]) s.dex[`${k}${t}`] = { foundAt: 0, count: 1, first: 'x' };
  for (const h of ['clear', 'choco', 'white', 'purple', 'gold']) s.dex[`h_${h}`] = { foundAt: 0, count: 1, first: 'x' };
  let st = rankStatus(s, 0);
  assert.equal(st.next.name, '伝説');
  assert.equal(st.reqsOk, false, '虹色がまだ');
  s.flags.legendBorn = { at: 0, name: 'ニジ', id: 'x', mother: 'a', father: 'b' };
  st = rankStatus(s, 0);
  assert.equal(st.reqsOk, true);
  assert.equal(st.judge, null);
  assert.equal(st.fee, 0);
  assert.equal(st.trialPassed, true);
  assert.equal(st.canPromote, true);
  assert.equal(promote(s, 0), null);
  assert.equal(s.rank, 6);
  assert.equal(s.money, 100);
  assert.equal(rankStatus(s, 0).next, null);
  assert.equal(promote(s, 0), 'これ以上の階級はありません');
});

test('古いセーブは実績から階級を決める（図鑑コンプ・★5あり → 全国の名人）', () => {
  const s = newGame(0, seeded(5));
  delete s.rank;
  delete s.trial;
  s.repPoints = 250;
  for (const k of ['r', 'b', 'y', 'k', 'g']) for (const t of [1, 2, 3, 4, 5]) s.dex[`${k}${t}`] = { foundAt: 0, count: 1, first: 'x' };
  for (const h of ['clear', 'choco', 'white', 'purple', 'gold']) s.dex[`h_${h}`] = { foundAt: 0, count: 1, first: 'x' };
  addTank(s, 'pla', 0);
  assert.equal(initialRank(s), 5);
  const d = migrate(JSON.parse(JSON.stringify(s)));
  assert.equal(d.rank, 5);
  assert.equal(d.trial, null);
  // 中盤のセーブ: 納品50回・★3が2色・水槽2本 → 名の知れた店
  const mid = newGame(0, seeded(6));
  delete mid.rank;
  mid.repPoints = 50;
  mid.dex.r1 = mid.dex.r3 = mid.dex.b3 = { foundAt: 0, count: 1, first: 'x' };
  addTank(mid, 'pla', 0);
  assert.equal(initialRank(mid), 3);
  assert.equal(rankReqs(mid, 4)[0].cur, 50);
});
