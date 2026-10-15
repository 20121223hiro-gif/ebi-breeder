// ブリーダーの階級（成り上がり）。DOMに触らない純粋関数。
// 実績の条件を満たす → 審査員を呼んで注文を納める（試練） → 改装費を払って昇格、の順。
import { ALL_DEX_KEYS, COLOR_HUES, HUE_LETTER } from './genetics.js';

const H = 3600 * 1000;

export const RANKS = [
  { lv: 1, name: '見習い', place: '軒先の箱' },
  { lv: 2, name: '町のエビ屋', place: '小さな店', fee: 1500, judge: { minTier: 2, count: 2 } },
  { lv: 3, name: '名の知れた店', place: '看板のある店', fee: 6000, judge: { minTier: 3, count: 3 } },
  { lv: 4, name: '県の名人', place: '専門店', fee: 20000, judge: { minTier: 4, count: 2 } },
  { lv: 5, name: '全国の名人', place: 'ブリーダーハウス', fee: 50000, judge: { minTier: 4, count: 3 } },
  { lv: 6, name: '伝説', place: '虹色の額縁がある店', fee: 0, judge: null },
];
export const JUDGE = { name: '審査員の大野さん', stay: 24 * H, mult: 3 };

const colorKeys = ALL_DEX_KEYS.filter((k) => !k.startsWith('h_'));
const dexCount = (state) => colorKeys.filter((k) => state.dex[k]).length + ['clear', 'choco', 'white', 'purple', 'gold'].filter((h) => state.dex[`h_${h}`]).length;
const huesWithTier = (state, t) => COLOR_HUES.filter((h) => state.dex[`${HUE_LETTER[h]}${t}`]).length;
const hiddenFound = (state) => ['choco', 'white', 'purple', 'gold'].filter((h) => state.dex[`h_${h}`]).length;
const req = (label, cur, need) => ({ label, cur, need, ok: cur >= need });

// 階級 lv に上がるための実績（審査員・改装費は含まない）
export function rankReqs(state, lv) {
  const rp = state.repPoints ?? 0;
  switch (lv) {
    case 2: return [req('客への納品', rp, 10), req('色付きのエビを生ませる', colorKeys.some((k) => state.dex[k]) ? 1 : 0, 1)];
    case 3: return [req('客への納品', rp, 40), req('★3濃を出した色', huesWithTier(state, 3), 2), req('水槽の本数', state.tanks.length, 2)];
    case 4: return [req('客への納品', rp, 100), req('★4縞を出した色', huesWithTier(state, 4), 1), req('隠し色の発見', hiddenFound(state), 2)];
    case 5: return [req('客への納品', rp, 200), req('図鑑', dexCount(state), 25), req('★5輝を出した色', huesWithTier(state, 5), 1)];
    case 6: return [req('図鑑', dexCount(state), 30), req('虹色のエビ', state.flags?.legendBorn ? 1 : 0, 1)];
    default: return [];
  }
}

export function rankOf(state) { return Math.max(1, Math.min(RANKS.length, state.rank ?? 1)); }

// 画面用のまとめ。next が null なら最上位
export function rankStatus(state, now) {
  const rank = rankOf(state);
  const cur = RANKS[rank - 1];
  const next = RANKS[rank] ?? null;
  if (!next) return { rank, cur, next: null, reqs: [], reqsOk: true, judge: null, fee: 0, trialPassed: true, judgeHere: false, canPromote: false };
  const reqs = rankReqs(state, next.lv);
  const reqsOk = reqs.every((r) => r.ok);
  const v = state.visitor;
  const judgeHere = !!(v && v.judge === next.lv);
  const trialPassed = !next.judge || (state.trial?.rank === next.lv && state.trial.passed);
  const canPromote = reqsOk && trialPassed && state.money >= next.fee;
  return { rank, cur, next, reqs, reqsOk, judge: next.judge, fee: next.fee, trialPassed, judgeHere, canPromote };
}

// 審査員を呼ぶ。普通の客がいる間は呼べない
export function callJudge(state, now) {
  const st = rankStatus(state, now);
  if (!st.next) return 'これ以上の階級はありません';
  if (!st.reqsOk) return '実績の条件がまだそろっていません';
  if (!st.judge) return 'この階級に試練はありません';
  if (st.trialPassed) return '試練はもう合格しています';
  if (state.visitor && !state.visitor.judge) return '客が帰ってから呼んでください';
  if (state.visitor) return '審査員はもう来ています';
  state.visitor = {
    id: `j${now.toString(36)}`,
    name: JUDGE.name,
    judge: st.next.lv,
    arrivedAt: now,
    leavesAt: now + JUDGE.stay,
    want: { hue: null, minTier: st.judge.minTier, count: st.judge.count, mult: JUDGE.mult, strict: true },
    delivered: 0,
  };
  state.trial = { rank: st.next.lv, passed: false, calledAt: now };
  return null;
}

// 改装費を払って昇格
export function promote(state, now) {
  const st = rankStatus(state, now);
  if (!st.next) return 'これ以上の階級はありません';
  if (!st.reqsOk) return '実績の条件がまだそろっていません';
  if (!st.trialPassed) return '先に審査員の試練に合格してください';
  if (state.money < st.fee) return 'コインが足りません';
  state.money -= st.fee;
  state.rank = st.next.lv;
  state.trial = null;
  state.rankedAt = now;
  return null;
}

// 古いセーブの階級を実績から決める（審査員・改装費は免除）。伝説は虹色が生まれていなければ5まで
export function initialRank(state) {
  let lv = 1;
  for (let next = 2; next <= RANKS.length; next += 1) {
    if (!rankReqs(state, next).every((r) => r.ok)) break;
    lv = next;
  }
  return lv;
}
