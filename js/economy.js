// 価格と売買。DOMに触らない。
import { TIER_MULT, isHidden, tierOf } from './genetics.js';
import { removeShrimp, isAdult } from './sim.js';

export const BASE_PRICE = 120;

export function priceOf(sh) {
  let p;
  if (sh.hue === 'clear') p = BASE_PRICE * 0.5; // 透明は元手なので安い
  else if (isHidden(sh.hue)) p = BASE_PRICE * 6;
  else p = BASE_PRICE * TIER_MULT[tierOf(sh)];
  if (sh.wild) p *= 0.7;                 // ワイルドは売るより繁殖向き
  if ((sh.exp ?? 0) >= 5) p *= 1.2;      // 称号「川帰り」
  if (sh.boss) p *= 3;
  return Math.round(p);
}

// 出荷できない理由。できれば null。
export function sellError(sh, now) {
  if (sh.away) return '遠征中は出荷できません';
  if (!isAdult(sh, now)) return '稚エビは出荷できません';
  if (sh.berriedAt != null) return '抱卵中は出荷できません';
  return null;
}

// 水槽内でその個体が最後の♂/♀かどうか（繁殖が止まる警告用）
export function isLastOfSex(state, sh) {
  const tank = state.tanks.find((t) => t.id === sh.tankId);
  if (!tank) return false;
  return !tank.shrimpIds.some((id) => id !== sh.id && state.shrimp[id]?.sex === sh.sex);
}

export function sell(state, ids, now) {
  let total = 0;
  const sold = [];
  for (const id of ids) {
    const sh = state.shrimp[id];
    if (!sh || sellError(sh, now)) continue;
    total += priceOf(sh);
    sold.push(sh.name);
    removeShrimp(state, id);
  }
  state.money += total;
  return { total, sold };
}

// 通貨は「コイン」。数字はそのまま（レートは変えない）。画面用はメダルの絵付き、確認ダイアログ・トースト・ログ用は文字だけ
export function fmtCoin(n) { return `${Math.round(n).toLocaleString('ja-JP')}コイン`; }
export function coinHtml(n) { return `<span class="coin"><img src="assets/icons/coin.png" alt="コイン">${Math.round(n).toLocaleString('ja-JP')}</span>`; }
