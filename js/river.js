// 川への遠征。エビ自身が出かけて、拾い物・素材・仲間・経験を持ち帰る。帰還率は100%。DOMに触らない。
import { HUES, HUE_JA, makeShrimp, pickName, tierOf, isHidden } from './genetics.js';

const MIN = 60 * 1000;
const H = 60 * MIN;

export const DESTS = {
  ditch: { name: '近所の用水路', minTeam: 1, duration: 30 * MIN, cooldown: 1 * H, rep: 1, cards: 4,
    p: { none: 0.30, find: 0.25, material: 0.20, friend: 0.20, danger: 0.05 }, mate: 0.15, boss: 0,
    findYen: [30, 80], hiddenGene: 0.10, friendTier: [0.70, 0.25, 0.05, 0], desc: '落ち葉と小さな拾い物。仲間は透明が中心' },
  stream: { name: '里山の小川', minTeam: 2, duration: 2 * H, cooldown: 4 * H, rep: 2, cards: 5,
    p: { none: 0.20, find: 0.25, material: 0.25, friend: 0.25, danger: 0.05 }, mate: 0.25, boss: 0,
    findYen: [80, 200], hiddenGene: 0.30, friendTier: [0.45, 0.35, 0.15, 0.04], desc: '流木や貝。色付きの仲間、隠し色の保因者' },
  source: { name: '源流の沢', minTeam: 3, duration: 6 * H, cooldown: 12 * H, rep: 3, cards: 6,
    p: { none: 0.10, find: 0.20, material: 0.25, friend: 0.35, danger: 0.10 }, mate: 0.35, boss: 0.03,
    findYen: [200, 600], hiddenGene: 0.60, friendTier: [0.20, 0.35, 0.30, 0.12], desc: '★3や縞の保因者。たまにヌシがついてくる' },
};

export const MATERIALS = {
  leaf: { name: '落ち葉', desc: '水槽に入れると24時間、餌の減りが半分', slot: false },
  wood: { name: '流木', desc: '設備スロットに置くと汚れの進みが −10%', slot: true, dirt: 0.10 },
  stone: { name: '丸い石', desc: '設備スロットに置くと汚れの進みが −10%', slot: true, dirt: 0.10 },
  snail: { name: 'タニシ', desc: '設備スロットに置くと苔を食べて汚れの進みが −15%', slot: true, dirt: 0.15 },
  molt: { name: '脱皮殻', desc: '5個で ¥300 に売れる', slot: false },
};

export const FINDS = ['きれいな石', 'ビー玉', '古い貝殻', '陶器のかけら', '川砂利'];

// 色ごとの得意
export const ROLE_JA = {
  clear: 'ハズレが減る', red: '同じ色の仲間が寄る', blue: '帰りが早い', yellow: 'カードが増える',
  black: '拾い物が増える', green: '危険で素材を拾う', choco: '拾い物が増える', white: 'ハズレが減る', purple: '仲間が寄る', gold: '拾い物が増える',
};

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }
function weighted(table, rng) {
  const total = Object.values(table).reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (const [k, v] of Object.entries(table)) { r -= v; if (r <= 0) return k; }
  return Object.keys(table)[0];
}

// 派遣チームの効果をまとめる
export function teamBonus(team) {
  const b = { none: 0, find: 0, friend: 0, cards: 0, duration: 1, green: 0, rare: 1, colors: [], expBonus: 0 };
  for (const sh of team) {
    const k = 1 + 0.1 * (tierOf(sh) - 1);
    const hue = sh.hue;
    if (hue === 'clear' || hue === 'white') b.none -= 0.08 * k;
    else if (hue === 'red' || hue === 'purple') b.friend += 0.08 * k;
    else if (hue === 'blue') b.duration *= 0.75;
    else if (hue === 'yellow') b.cards += 1;
    else if (hue === 'black' || hue === 'choco' || hue === 'gold') b.find += 0.08 * k;
    else if (hue === 'green') b.green += 1;
    if (!isHidden(hue)) b.colors.push(hue);
    if (sh.pat === 's' || sh.shine) b.rare *= 2;
    b.expBonus += Math.min(8, sh.exp ?? 0) * 0.005;
  }
  b.cards = Math.min(2, b.cards);
  b.duration = Math.max(0.5, b.duration);
  return b;
}

export function canSend(state, destId, team, now) {
  const d = DESTS[destId];
  if (!d) return '行き先がありません';
  if (state.trip) return 'いま遠征中です';
  if ((state.reputation ?? 1) < d.rep) return `評判 Lv${d.rep} で行けるようになります`;
  const cd = state.tripCooldown?.[destId] ?? 0;
  if (now < cd) return 'まだ休ませてください';
  if (team.length < d.minTeam) return `${d.name}は ${d.minTeam}匹以上で送ります`;
  if (team.length > 3) return '送れるのは3匹までです';
  for (const sh of team) {
    if (now < sh.adultAt) return `${sh.name} はまだ稚エビです`;
    if (sh.berriedAt != null) return `${sh.name} は抱卵中です`;
  }
  return null;
}

// ワイルド個体を作る。見た目は地味でも遺伝子に色や縞を隠し持つことがある。
export function makeWild(dest, bias, now, rng, opts = {}) {
  const d = DESTS[dest];
  const tierIdx = weighted({ 0: d.friendTier[0], 1: d.friendTier[1], 2: d.friendTier[2], 3: d.friendTier[3] }, rng);
  const colored = HUES.filter((h) => h !== 'clear');
  let hue = bias.colors.length && rng() < 0.6 ? pick(bias.colors, rng) : pick(colored, rng);
  let sat = 1;
  const genes = { hue: ['clear', 'clear'], sat: [1, 1], pat: ['n', 'n'] };
  if (tierIdx === '0') { hue = 'clear'; }
  else { sat = Number(tierIdx); genes.hue = [hue, rng() < 0.5 ? hue : 'clear']; genes.sat = [sat, Math.max(1, sat - (rng() < 0.5 ? 1 : 0))]; }
  // 隠し持つ遺伝子
  if (rng() < d.hiddenGene * bias.rare) {
    const r = rng();
    if (r < 0.5) genes.hue[1] = pick(colored, rng);
    else if (r < 0.85) genes.pat[1] = 's';
    else genes.sat[1] = 3;
  }
  if (opts.boss) { hue = pick(colored, rng); sat = 3; genes.hue = [hue, hue]; genes.sat = [3, 3]; genes.pat = ['n', 's']; }
  const sh = makeShrimp({ genes, now, adult: true, lifeMs: opts.lifeMs, sex: opts.sex }, rng);
  // 発現は表向きの値に固定（隠し遺伝子は見た目に出ない）
  sh.hue = hue === 'clear' ? 'clear' : (genes.hue.includes(hue) ? hue : sh.hue);
  sh.sat = sat;
  sh.tier = tierOf(sh);
  sh.wild = true;
  sh.geneKnown = false;
  if (opts.boss) { sh.boss = true; sh.name = 'ヌシ'; }
  return sh;
}

// 出発時にカードを生成する（帰還時にそのまま適用する）
export function planTrip(state, destId, team, now, rng = Math.random, lifeMs = 10 * 24 * H) {
  const d = DESTS[destId];
  const b = teamBonus(team);
  const p = { ...d.p };
  p.none = Math.max(0.05, p.none + b.none);
  p.find += b.find;
  p.friend += b.friend;
  const n = d.cards + b.cards;
  const cards = [];
  let friends = 0;
  const maxFriends = team.length + (state.gear?.bucket ? 1 : 0);
  for (let i = 0; i < n; i += 1) {
    let type = weighted(p, rng);
    if (type === 'friend' && friends >= maxFriends) type = 'material';
    if (type === 'none') cards.push({ type, text: pick(['流木の下で休んでいた', '何も見つからなかった', '水草をつついて過ごした'], rng) });
    else if (type === 'find') {
      const yen = Math.round((d.findYen[0] + rng() * (d.findYen[1] - d.findYen[0])) / 10) * 10;
      cards.push({ type, item: pick(FINDS, rng), yen, text: `${pick(FINDS, rng)}を見つけた` });
    } else if (type === 'material') {
      const table = destId === 'ditch' ? { leaf: 5, molt: 3, stone: 1, snail: 1 } : destId === 'stream' ? { leaf: 2, wood: 3, stone: 2, snail: 2, molt: 1 } : { wood: 3, stone: 2, snail: 3, molt: 2 };
      const item = weighted(table, rng);
      cards.push({ type, item, text: `${MATERIALS[item].name}を持ち帰った` });
    } else if (type === 'friend') {
      friends += 1;
      const wild = makeWild(destId, b, now, rng, { lifeMs });
      cards.push({ type, shrimp: wild, text: `${wild.hue === 'clear' ? '透明' : HUE_JA[wild.hue]}の仲間がついてきた` });
    } else if (type === 'danger') {
      const extra = b.green > 0 ? weighted({ leaf: 2, snail: 1, wood: 1 }, rng) : null;
      cards.push({ type, exp: 2, item: extra, text: extra ? `メダカに追われたが、緑が擬態して${MATERIALS[extra].name}まで拾ってきた` : 'メダカに追われたが逃げ切った（経験 +2）' });
    }
  }
  // メスがいれば「野生のオスと出会った」
  const females = team.filter((sh) => sh.sex === 'f');
  if (females.length && rng() < d.mate) {
    const mother = pick(females, rng);
    const father = makeWild(destId, { ...b, colors: [] }, now, rng, { sex: 'm', lifeMs });
    cards.push({ type: 'mate', motherId: mother.id, fatherGenes: father.genes, fatherSat: father.sat, text: `${mother.name} が野生のオスと出会って抱卵した` });
  }
  // ヌシ
  if (d.boss && rng() < d.boss * b.rare) {
    const boss = makeWild(destId, b, now, rng, { boss: true, lifeMs });
    cards.push({ type: 'friend', shrimp: boss, boss: true, text: 'ヌシがついてきた！' });
  }
  return {
    dest: destId,
    ids: team.map((sh) => sh.id),
    tankId: team[0].tankId,
    departAt: now,
    returnAt: now + Math.round(d.duration * b.duration),
    cards,
  };
}

export function tripSummary(trip) {
  const yen = trip.cards.filter((c) => c.type === 'find').reduce((a, c) => a + c.yen, 0);
  const friends = trip.cards.filter((c) => c.type === 'friend').length;
  const materials = trip.cards.filter((c) => (c.type === 'material' || c.type === 'danger') && c.item).length;
  const mate = trip.cards.some((c) => c.type === 'mate');
  return { yen, friends, materials, mate };
}

export function nameFor(sh, used, rng) { return pickName(sh.hue, used, rng); }
