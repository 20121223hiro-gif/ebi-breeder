// 時間進行。DOMに触らない純粋関数。state を直接更新し、起きた出来事を events に積んで返す。
import { childOf, dexKey, pickName, makeShrimp } from './genetics.js';
import { stepVisitor, V } from './visitors.js';
import { DESTS, MATERIALS, planTrip, canSend } from './river.js';

export const H = 3600 * 1000;
export const D = 24 * H;

export const T = {
  hatch: 4 * H,          // 抱卵から孵化まで（1日1世代のテンポ）
  firstHatch: 2 * 60 * 1000, // 最初の1回だけ短縮
  grow: 12 * H,          // 稚エビが成体になるまで
  life: 10 * D,          // 寿命
  dirtFull: 48 * H,      // 満員水槽で汚れ0→100
  foodEmpty: 24 * H,     // 餌100→0
  offlineCap: 24 * H,    // オフライン進行の上限
};

export const TANK_TYPES = {
  pla: { name: 'プラケース', cap: 8, price: 800 },
  s30: { name: '30cm水槽', cap: 20, price: 3000 },
  s60: { name: '60cm水槽', cap: 60, price: 12000 },
};

// 実カレンダーの月で水温を決める。7〜9月は高め。
export function seasonTemp(date = new Date()) {
  const m = date.getMonth() + 1;
  if (m >= 7 && m <= 9) return 28;
  if (m === 12 || m <= 2) return 18;
  return 24;
}

export function isAdult(sh, now) { return now >= sh.adultAt; }

// 1水槽を dt ミリ秒進める
function stepTank(state, tank, dt, now, rng, events) {
  const shrimp = tank.shrimpIds.map((id) => state.shrimp[id]).filter(Boolean);
  const load = Math.max(0.3, shrimp.length / tank.cap);
  // 設備（流木・石・タニシ）で汚れの進みが減る。落ち葉で餌の減りが半分。
  const dirtCut = Math.min(0.5, (tank.equipment ?? []).reduce((a, e) => a + (MATERIALS[e.type]?.dirt ?? 0), 0));
  const foodMul = tank.leafUntil && now < tank.leafUntil ? 0.5 : 1;
  tank.dirt = Math.min(100, tank.dirt + (100 / T.dirtFull) * dt * load * (1 - dirtCut));
  tank.food = Math.max(0, tank.food - (100 / T.foodEmpty) * dt * Math.max(0.5, load) * foodMul);
  tank.temp = seasonTemp(new Date(now));

  for (const sh of shrimp) {
    // 寿命・汚れによる死亡
    let cause = null;
    if (now >= sh.diesAt) cause = '寿命';
    else if (tank.dirt >= 90 && rng() < 0.05 * (dt / H)) cause = '水質悪化';
    else if (tank.temp >= 30 && rng() < 0.05 * (dt / H)) cause = '高水温';
    if (cause) {
      removeShrimp(state, sh.id);
      events.push({ type: 'death', at: now, name: sh.name, cause, tankId: tank.id });
      continue;
    }
    // 孵化
    if (sh.berriedAt != null && now >= sh.hatchAt) {
      hatch(state, tank, sh, now, rng, events);
    }
  }
}

export function removeShrimp(state, id) {
  const sh = state.shrimp[id];
  if (!sh) return;
  const tank = state.tanks.find((t) => t.id === sh.tankId);
  if (tank) tank.shrimpIds = tank.shrimpIds.filter((x) => x !== id);
  delete state.shrimp[id];
}

function usedNamesIn(state, tank) {
  return tank.shrimpIds.map((id) => state.shrimp[id]?.name).filter(Boolean);
}

function hatch(state, tank, mother, now, rng, events) {
  const father = mother.mate;
  mother.berriedAt = null;
  mother.hatchAt = null;
  mother.mate = null;
  if (!father) return;
  // 最初の孵化だけ3匹固定（定員内に収めて「育たなかった」を出さない）
  let base = tank.dirt > 60 ? 2 + Math.floor(rng() * 3) : 4 + Math.floor(rng() * 5);
  if (!state.flags.firstHatchDone) { base = 3; state.flags.firstHatchDone = true; }
  // 見守りの正解数だけ孵化数が増える（最大+3）
  const careOk = (mother.eggCare ?? []).filter((c) => c === 'ok').length;
  base += Math.min(3, careOk);
  mother.eggCare = null;
  const babies = [];
  const lost = [];
  const newKeys = [];
  for (let i = 0; i < base; i += 1) {
    const baby = childOf(mother, father, { now, growMs: T.grow, lifeMs: T.life, tankId: tank.id }, rng);
    if (tank.shrimpIds.length >= tank.cap) { lost.push(baby); continue; }
    baby.name = pickName(baby.hue, usedNamesIn(state, tank), rng);
    state.shrimp[baby.id] = baby;
    tank.shrimpIds.push(baby.id);
    babies.push(baby);
    const key = dexKey(baby);
    if (!state.dex[key]) {
      state.dex[key] = { foundAt: now, count: 0, first: baby.name };
      newKeys.push(key);
    }
    state.dex[key].count += 1;
  }
  events.push({
    type: 'hatch', at: now, tankId: tank.id, motherName: mother.name, fatherName: father.name,
    babies: babies.map((b) => b.id), lost: lost.length, newKeys, careOk,
  });
}

// ---------- 抱卵の見守り ----------
// 抱卵期間を4段階に分け、各段階で1回だけ世話を選べる。正解なら孵化数+1。
export const EGG_STAGES = [
  { name: '黄色い卵', hint: '産みたての卵は水質に敏感。汚れているなら静かに換水、きれいなら隠れ家で落ち着かせる' },
  { name: '茶色い卵', hint: '餌が多すぎると水が傷む。餌が十分あるなら控え、少ないなら隠れ家で体力を温存' },
  { name: '目が見える卵', hint: '水温が高いと卵が弱る。28℃以上なら換水で冷ます、それ以下なら餌を控えて水をきれいに' },
  { name: '透明な卵', hint: '孵化間近。稚エビの隠れ家が要る。ただし汚れが60%以上なら先に換水' },
];
export const EGG_CHOICES = { water: 'そっと換水', food: '餌を控える', shelter: '隠れ家を置く' };

export function eggStage(sh, now) {
  if (sh.berriedAt == null) return -1;
  const span = (sh.hatchAt - sh.berriedAt) / 4;
  return Math.max(0, Math.min(3, Math.floor((now - sh.berriedAt) / span)));
}

export function eggAnswer(stage, tank) {
  switch (stage) {
    case 0: return tank.dirt >= 40 ? 'water' : 'shelter';
    case 1: return tank.food >= 60 ? 'food' : 'shelter';
    case 2: return tank.temp >= 28 ? 'water' : 'food';
    default: return tank.dirt >= 60 ? 'water' : 'shelter';
  }
}

export function careEgg(state, sh, choice, now) {
  const stage = eggStage(sh, now);
  if (stage < 0) return { error: '抱卵中ではありません' };
  if (!sh.eggCare) sh.eggCare = [null, null, null, null];
  if (sh.eggCare[stage]) return { error: 'この段階はもう世話をしました' };
  const tank = state.tanks.find((t) => t.id === sh.tankId);
  const answer = eggAnswer(stage, tank);
  const correct = choice === answer;
  sh.eggCare[stage] = correct ? 'ok' : 'ng';
  // 世話の副作用は小さく（換水を選んだら実際に少し換水、餌を控えたら少し減る）
  if (choice === 'water') tank.dirt = Math.max(0, tank.dirt - 15);
  if (choice === 'food') tank.food = Math.max(0, tank.food - 10);
  // 3段階正解で母親の遺伝子が全部わかる
  const okCount = sh.eggCare.filter((c) => c === 'ok').length;
  if (okCount >= 3) sh.geneKnown = true;
  return { stage, correct, answer, okCount };
}

// state を now まで進める。オフライン分は上限つき。
export function advance(state, now, rng = Math.random) {
  const events = [];
  let t = state.lastSeenAt ?? now;
  if (now - t > T.offlineCap) t = now - T.offlineCap;
  const step = 10 * 60 * 1000;
  while (t < now) {
    const dt = Math.min(step, now - t);
    t += dt;
    for (const tank of state.tanks) stepTank(state, tank, dt, t, rng, events);
    stepVisitor(state, t, rng, events);
    if (state.trip && t >= state.trip.returnAt) returnTrip(state, t, rng, events);
  }
  state.lastSeenAt = now;
  return events;
}

// 世話
export function feed(tank) { tank.food = 100; }
export function changeWater(tank) { tank.dirt = Math.max(0, tank.dirt - 70); }

// 繁殖の条件チェック。問題なければ null、あれば理由を返す。
// ---------- 川への遠征 ----------
export function sendTrip(state, destId, ids, now, rng = Math.random) {
  const team = ids.map((id) => state.shrimp[id]).filter(Boolean);
  const err = canSend(state, destId, team, now);
  if (err) return err;
  const trip = planTrip(state, destId, team, now, rng, T.life);
  for (const sh of team) {
    const tank = state.tanks.find((t) => t.id === sh.tankId);
    if (tank) tank.shrimpIds = tank.shrimpIds.filter((x) => x !== sh.id);
    sh.away = true;
  }
  state.trip = trip;
  state.tripCooldown = state.tripCooldown ?? {};
  state.tripCooldown[destId] = now + DESTS[destId].cooldown;
  return null;
}

function tankWithSpace(state, prefer) {
  if (prefer && prefer.shrimpIds.length < prefer.cap) return prefer;
  return state.tanks.find((t) => t.shrimpIds.length < t.cap) ?? null;
}

function returnTrip(state, now, rng, events) {
  const trip = state.trip;
  state.trip = null;
  const home = state.tanks.find((t) => t.id === trip.tankId) ?? state.tanks[0];
  // チームを戻す（満員でも必ず戻る）
  for (const id of trip.ids) {
    const sh = state.shrimp[id];
    if (!sh) continue;
    sh.away = false;
    sh.tankId = home.id;
    if (!home.shrimpIds.includes(id)) home.shrimpIds.push(id);
    sh.exp = (sh.exp ?? 0) + 1;
  }
  state.items = state.items ?? {};
  const applied = { yen: 0, items: [], friends: [], stayed: [], mate: null, newKeys: [] };
  for (const c of trip.cards) {
    if (c.type === 'find') { state.money += c.yen; applied.yen += c.yen; }
    else if (c.type === 'material' || (c.type === 'danger' && c.item)) {
      state.items[c.item] = (state.items[c.item] ?? 0) + 1;
      applied.items.push(c.item);
      if (c.type === 'danger') for (const id of trip.ids) if (state.shrimp[id]) state.shrimp[id].exp += c.exp;
    } else if (c.type === 'danger') {
      for (const id of trip.ids) if (state.shrimp[id]) state.shrimp[id].exp += c.exp;
    } else if (c.type === 'friend') {
      const tank = tankWithSpace(state, home);
      const wild = c.shrimp;
      wild.bornAt = now - 3 * D;
      wild.adultAt = now;
      wild.diesAt = now + T.life;
      if (!wild.boss) wild.name = pickName(wild.hue, Object.values(state.shrimp).map((x) => x.name), rng);
      if (!tank) {
        // 満員: バケツで待機して、プレイヤーに対処を選ばせる
        state.bucket = state.bucket ?? [];
        if (state.bucket.length >= bucketCap(state)) { applied.stayed.push(wild.name || '仲間'); c.stayed = true; continue; }
        state.bucket.push(wild);
        c.bucket = true;
        applied.bucket = applied.bucket ?? [];
        applied.bucket.push(wild.name);
        continue;
      }
      addWildToTank(state, wild, tank, now, applied);
      c.tankName = tank.name;
    } else if (c.type === 'mate') {
      const mother = state.shrimp[c.motherId];
      if (mother && mother.berriedAt == null) {
        mother.berriedAt = now;
        mother.hatchAt = now + T.hatch;
        mother.mate = { name: '野生のオス', genes: c.fatherGenes, sat: c.fatherSat };
        mother.eggCare = [null, null, null, null];
        applied.mate = mother.name;
      }
    }
  }
  events.push({ type: 'trip_return', at: now, trip, applied });
  // 記録をあとから見返せるように残す
  state.lastTrip = { trip, applied, at: now };
}

export function tripRemain(state, now) { return state.trip ? state.trip.returnAt - now : 0; }

function addWildToTank(state, wild, tank, now, applied) {
  wild.tankId = tank.id;
  state.shrimp[wild.id] = wild;
  tank.shrimpIds.push(wild.id);
  applied?.friends.push(wild.name);
  const key = dexKey(wild);
  if (!state.dex[key]) { state.dex[key] = { foundAt: now, count: 0, first: wild.name }; applied?.newKeys.push(key); }
  state.dex[key].count += 1;
  if (wild.boss) state.flags.bossCaught = (state.flags.bossCaught ?? 0) + 1;
}

// ---------- バケツ（満員で入れられなかった仲間の待機所） ----------
export function bucketCap(state) { return 3 + (state.gear?.bucket ? 1 : 0); }

// 空きのある水槽に入れる
export function bucketPlace(state, index, tank, now) {
  const wild = state.bucket?.[index];
  if (!wild) return 'バケツにいません';
  if (tank.shrimpIds.length >= tank.cap) return 'その水槽は満員です';
  state.bucket.splice(index, 1);
  const applied = { friends: [], newKeys: [] };
  addWildToTank(state, wild, tank, now, applied);
  return { newKeys: applied.newKeys };
}

// 水槽のエビを川に放して、代わりにバケツの仲間を入れる
export function bucketSwap(state, index, shrimpId, now) {
  const wild = state.bucket?.[index];
  const out = state.shrimp[shrimpId];
  if (!wild) return 'バケツにいません';
  if (!out) return 'そのエビがいません';
  if (out.berriedAt != null) return '抱卵中のエビは放せません';
  if (out.away) return '遠征中のエビは放せません';
  const tank = state.tanks.find((t) => t.id === out.tankId);
  removeShrimp(state, shrimpId);
  state.bucket.splice(index, 1);
  const applied = { friends: [], newKeys: [] };
  addWildToTank(state, wild, tank, now, applied);
  return { released: out.name, newKeys: applied.newKeys };
}

// 川に返す
export function bucketRelease(state, index) {
  if (!state.bucket?.[index]) return 'バケツにいません';
  const [w] = state.bucket.splice(index, 1);
  return { released: w.name };
}

// ---------- 素材の使用 ----------
export function useLeaf(state, tank, now) {
  if ((state.items?.leaf ?? 0) < 1) return '落ち葉がありません';
  state.items.leaf -= 1;
  tank.leafUntil = Math.max(tank.leafUntil ?? 0, now) + 24 * H;
  return null;
}
export function placeEquipment(state, tank, item) {
  if (!MATERIALS[item]?.slot) return '設備スロットには置けません';
  if ((state.items?.[item] ?? 0) < 1) return `${MATERIALS[item].name}がありません`;
  tank.equipment = tank.equipment ?? [];
  if (tank.equipment.length >= 3) return '設備スロットがいっぱいです';
  state.items[item] -= 1;
  tank.equipment.push({ type: item });
  return null;
}
export function removeEquipment(state, tank, index) {
  const e = tank.equipment?.[index];
  if (!e) return '設備がありません';
  tank.equipment.splice(index, 1);
  state.items[e.type] = (state.items[e.type] ?? 0) + 1;
  return null;
}
export function sellMolt(state) {
  if ((state.items?.molt ?? 0) < 5) return '脱皮殻が5個必要です';
  state.items.molt -= 5;
  state.money += 300;
  return null;
}

export function pairError(state, male, female, now) {
  if (!male || !female) return '♂と♀を選んでください';
  if (male.sex !== 'm' || female.sex !== 'f') return '♂と♀の組み合わせにしてください';
  if (male.tankId !== female.tankId) return '同じ水槽の個体を選んでください';
  if (!isAdult(male, now) || !isAdult(female, now)) return '両方とも成体である必要があります';
  if (female.berriedAt != null) return 'このメスは抱卵中です';
  const tank = state.tanks.find((t) => t.id === female.tankId);
  if (tank && tank.food < 20) return '餌が足りません。先に餌やりを';
  return null;
}

export function pair(state, male, female, now) {
  const err = pairError(state, male, female, now);
  if (err) return err;
  const ms = state.flags.firstBreedDone ? T.hatch : T.firstHatch;
  female.berriedAt = now;
  female.hatchAt = now + ms;
  female.mate = { name: male.name, genes: JSON.parse(JSON.stringify(male.genes)), sat: male.sat };
  female.eggCare = [null, null, null, null];
  state.flags.firstBreedDone = true;
  return null;
}

export function moveShrimp(state, sh, tank) {
  if (tank.shrimpIds.length >= tank.cap) return 'その水槽は満員です';
  const from = state.tanks.find((t) => t.id === sh.tankId);
  if (from) from.shrimpIds = from.shrimpIds.filter((x) => x !== sh.id);
  tank.shrimpIds.push(sh.id);
  sh.tankId = tank.id;
  return null;
}

export function addTank(state, type, now) {
  const def = TANK_TYPES[type];
  const idx = state.tanks.length;
  const tank = {
    id: `t${idx + 1}`,
    type,
    name: `${def.name} ${String.fromCharCode(65 + idx)}`,
    cap: def.cap,
    dirt: 0,
    food: 100,
    temp: seasonTemp(new Date(now)),
    equipment: [],
    shrimpIds: [],
  };
  state.tanks.push(tank);
  return tank;
}

// ---------- 水槽のアップグレード（中のエビと設備はそのまま、新品と同額） ----------
export const UPGRADE_PATH = { pla: 's30', s30: 's60' };

// アップグレードできるか。{ to, price } か { error }
export function upgradeInfo(state, tank) {
  const to = UPGRADE_PATH[tank.type];
  if (!to) return { error: 'これ以上大きくできません' };
  const def = TANK_TYPES[to];
  if (to === 's60' && (state.reputation ?? 1) < 5) return { to, price: def.price, error: '評判 Lv5 で解放されます' };
  if (state.money < def.price) return { to, price: def.price, error: 'コインが足りません' };
  return { to, price: def.price };
}

export function upgradeTank(state, tank, now) {
  const info = upgradeInfo(state, tank);
  if (info.error) return info.error;
  const def = TANK_TYPES[info.to];
  state.money -= info.price;
  const letter = tank.name.trim().slice(-1);
  tank.type = info.to;
  tank.cap = def.cap;
  tank.name = `${def.name} ${/^[A-Z]$/.test(letter) ? letter : String.fromCharCode(65 + state.tanks.indexOf(tank))}`;
  tank.dirt = Math.round(tank.dirt / 2);   // 水が増えて薄まる
  tank.upgradedAt = now;
  return null;
}

// 次に起きる孵化（最も早いもの）
export function nextHatch(state) {
  let best = null;
  for (const sh of Object.values(state.shrimp)) {
    if (sh.hatchAt != null && (!best || sh.hatchAt < best.hatchAt)) best = sh;
  }
  return best;
}

// 初期状態
export function newGame(now = Date.now(), rng = Math.random) {
  const state = {
    version: 1,
    createdAt: now,
    lastSeenAt: now,
    money: 500,
    reputation: 1,
    repPoints: 0,
    visitor: null,
    nextVisitorAt: now + V.firstDelay,
    trip: null,
    tripCooldown: {},
    items: {},
    gear: {},
    bucket: [],
    tanks: [],
    shrimp: {},
    dex: {},
    flags: { firstBreedDone: false, firstHatchDone: false },
    log: [],
  };
  const tank = addTank(state, 'pla', now);
  const starters = [
    { sex: 'm', name: 'ハナ' },
    { sex: 'f', name: 'ユキ' },
    { sex: 'f', name: 'シズク' },
  ];
  for (const s of starters) {
    const sh = makeShrimp({ ...s, now, adult: true, lifeMs: T.life, tankId: tank.id }, rng);
    state.shrimp[sh.id] = sh;
    tank.shrimpIds.push(sh.id);
    const key = dexKey(sh);
    state.dex[key] = state.dex[key] || { foundAt: now, count: 0, first: sh.name };
    state.dex[key].count += 1;
  }
  return state;
}
