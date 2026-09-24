// 買い付け客。1〜2時間おきに来て40分で帰る。条件に合うエビを相場より高く買う。DOMに触らない。
import { HUES, HUE_JA, HUE_LETTER, TIER_JA, isHidden, tierOf } from './genetics.js';
import { priceOf, sellError } from './economy.js';
import { removeShrimp } from './sim.js';

const MIN = 60 * 1000;
export const V = {
  stay: 40 * MIN,          // 滞在時間
  gapMin: 60 * MIN,        // 次の客まで（最短）
  gapMax: 120 * MIN,       // 次の客まで（最長）
  firstDelay: 5 * MIN,     // 新規ゲーム開始から最初の客まで
};

export const VISITOR_NAMES = [
  '田中さん', 'アクアショップの店長', '小学生のけんた', '近所のおばあちゃん', '水草マニアの佐藤さん',
  '写真家の山本さん', 'ビオトープ好きの中村さん', '理科の先生', 'カフェのマスター', '大学生のみさき',
];

// 評判Lvの閾値（納品ポイント）
export const REP_THRESHOLDS = [0, 5, 12, 20, 30];
export function repLevel(points) {
  let lv = 1;
  for (let i = 1; i < REP_THRESHOLDS.length; i += 1) if (points >= REP_THRESHOLDS[i]) lv = i + 1;
  return lv;
}

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

// プレイヤーが「持っていそうな色」と「一歩先の色」から希望を作る
export function genWant(state, rng) {
  const s = state;
  const known = new Set();
  for (const key of Object.keys(s.dex)) {
    if (key.startsWith('h_')) known.add(key.slice(2));
    else known.add(Object.keys(HUE_LETTER).find((h) => HUE_LETTER[h] === key[0]));
  }
  const owned = Object.values(s.shrimp);
  const rep = s.reputation ?? 1;
  let hue = null;
  let minTier = 1;
  const r = rng();
  if (r < 0.35) {
    hue = null; // 色を問わない
    minTier = rep >= 3 ? 2 : 1;
  } else if (r < 0.8) {
    // 持っている色から
    const cand = owned.filter((sh) => !isHidden(sh.hue)).map((sh) => sh.hue);
    hue = cand.length ? pick(cand, rng) : null;
    const tiers = owned.filter((sh) => sh.hue === hue).map((sh) => tierOf(sh));
    const maxT = tiers.length ? Math.max(...tiers) : 1;
    minTier = Math.max(1, Math.min(maxT, rep >= 4 ? 3 : 2));
  } else {
    // 一歩先（未発見の色や段階）。目標になる
    const unknownHues = HUES.filter((h) => h !== 'clear' && !known.has(h));
    hue = unknownHues.length && rng() < 0.5 ? pick(unknownHues, rng) : (owned.length ? pick(owned, rng).hue : 'red');
    if (hue === 'clear') hue = 'red';
    minTier = Math.min(4, rep + 1);
  }
  let count = hue === null ? 2 + Math.floor(rng() * 3) : 1 + Math.floor(rng() * 2);
  if (hue === null) {
    // 色を問わない客は、手持ちの「渡せる成体」数を超えて要求しない（段階の条件も含めて数える）
    const adults = owned.filter((sh) => sh.adultAt <= (s.lastSeenAt ?? 0) && sh.berriedAt == null && !sh.away
      && (isHidden(sh.hue) ? (sh.hue !== 'clear' || minTier <= 1) : tierOf(sh) >= minTier)).length;
    count = Math.max(1, Math.min(count, adults));
  }
  const mult = 1.5 + minTier * 0.4 + (hue ? 0.3 : 0) + rng() * 0.3; // 1.5〜3.3
  return { hue, minTier, count, mult: Math.round(mult * 10) / 10 };
}

export function newVisitor(state, now, rng) {
  return {
    id: `v${now.toString(36)}`,
    name: pick(VISITOR_NAMES, rng),
    arrivedAt: now,
    leavesAt: now + V.stay,
    want: genWant(state, rng),
    delivered: 0,
  };
}

export function wantLabel(want) {
  const hue = want.hue ? HUE_JA[want.hue] : 'どの色でも';
  const tier = want.minTier > 1 ? ` ★${want.minTier}${TIER_JA[want.minTier]}以上` : '';
  return `${hue}${tier} ×${want.count}匹`;
}

export function matchesWant(sh, want, now) {
  if (sellError(sh, now)) return false;
  if (sh.hue === 'clear') return want.hue === null && want.minTier <= 1;
  if (isHidden(sh.hue)) return want.hue === null; // 隠し色はどの色でも枠で買ってもらえる
  if (want.hue && sh.hue !== want.hue) return false;
  return tierOf(sh) >= want.minTier;
}

export function visitorPrice(sh, visitor) { return Math.round(priceOf(sh) * visitor.want.mult); }

// 時間を進めたときの客の到着・退店。sim.advance から呼ぶ。
export function stepVisitor(state, t, rng, events) {
  if (state.nextVisitorAt == null) state.nextVisitorAt = t + V.firstDelay;
  const v = state.visitor;
  if (v && t >= v.leavesAt) {
    state.visitor = null;
    events.push({ type: 'visitor_leave', at: t, name: v.name, delivered: v.delivered });
  }
  if (!state.visitor && t >= state.nextVisitorAt) {
    const dirty = state.tanks.some((tk) => tk.dirt >= 80);
    if (dirty) {
      // 汚れた店には来ない。30分後にもう一度
      state.nextVisitorAt = t + 30 * MIN;
      events.push({ type: 'visitor_skip', at: t });
    } else {
      state.visitor = newVisitor(state, t, rng);
      state.nextVisitorAt = t + V.gapMin + rng() * (V.gapMax - V.gapMin);
      events.push({ type: 'visitor_arrive', at: t, name: state.visitor.name, want: state.visitor.want });
    }
  }
}

// 客に渡す。合う個体だけ受け取り、資金と評判を更新。
export function deliver(state, ids, now) {
  const v = state.visitor;
  if (!v) return { total: 0, sold: [], error: '客がいません' };
  let total = 0;
  const sold = [];
  for (const id of ids) {
    const sh = state.shrimp[id];
    if (!sh || !matchesWant(sh, v.want, now)) continue;
    if (v.delivered + sold.length >= v.want.count) break;
    total += visitorPrice(sh, v);
    sold.push(sh.name);
    removeShrimp(state, id);
  }
  if (!sold.length) return { total: 0, sold, error: '条件に合うエビがありません' };
  state.money += total;
  v.delivered += sold.length;
  state.repPoints = (state.repPoints ?? 0) + sold.length;
  const before = state.reputation;
  state.reputation = repLevel(state.repPoints);
  const done = v.delivered >= v.want.count;
  if (done) state.visitor = null;
  return { total, sold, done, levelUp: state.reputation > before ? state.reputation : null };
}
