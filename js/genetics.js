// 遺伝と個体生成。DOMに触らない純粋関数だけを置く。
// 遺伝子は3対: hue(色相) / sat(発色 1..3) / pat(模様 n|s)。輝(shine)は遺伝しない突然変異。

export const HUES = ['clear', 'red', 'blue', 'yellow', 'black', 'green'];
export const HIDDEN_HUES = ['clear', 'choco', 'white', 'purple', 'gold'];
export const HUE_LETTER = { red: 'r', blue: 'b', yellow: 'y', black: 'k', green: 'g' };
export const HUE_JA = {
  clear: '透明', red: '赤', blue: '青', yellow: '黄', black: '黒', green: '緑',
  choco: 'チョコ', white: '白', purple: '紫', gold: '金',
};
export const TIER_JA = { 1: '薄', 2: '中', 3: '濃', 4: '縞', 5: '輝' };
export const TIER_MULT = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 20 };

// 名前候補。色ごとに用意し、同じ水槽内で重ならないように使う。
export const NAME_POOL = {
  red: ['モモ', 'ベニ', 'アカネ', 'イチゴ', 'サクラ', 'ヒイロ', 'アズキ', 'ウメ'],
  blue: ['ソラ', 'アオ', 'ルリ', 'ナギ', 'ウミ', 'アイ', 'ミズキ', 'コン'],
  yellow: ['ユズ', 'キナコ', 'レモン', 'ヒマワリ', 'タンポポ', 'ヤマブキ', 'カリン'],
  black: ['クロ', 'スミ', 'ヨル', 'コクトウ', 'クロマメ', 'ゴマ', 'カラス'],
  green: ['ワカバ', 'ヨモギ', 'マッチャ', 'ミドリ', 'コケ', 'メロン', 'ハッパ'],
  clear: ['ハナ', 'ユキ', 'シズク', 'ミズ', 'コオリ', 'ガラス', 'アワ', 'スイ'],
  choco: ['ショコラ', 'ココア', 'モカ', 'クルミ'],
  white: ['シロ', 'ユキミ', 'モチ', 'ダイフク'],
  purple: ['ムラサキ', 'スミレ', 'フジ', 'ブドウ'],
  gold: ['キン', 'コガネ', 'ヒカリ', 'オウゴン'],
};

let seq = 0;
export function newId(prefix = 's') {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
}

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

// 隠し色の合成判定。両親の色相アレルの組み合わせで低確率に出る。
function hiddenFromAlleles(alleles, rng) {
  const s = [...alleles].sort().join('+');
  if (s === 'blue+red' && rng() < 0.02) return 'purple';
  if (s === 'black+red' && rng() < 0.02) return 'choco';
  if (s === 'black+yellow' && rng() < 0.02) return 'gold';
  if (s === 'clear+clear' && rng() < 0.01) return 'white';
  return null;
}

// 色相の発現: 色付きが透明に対して優性。色付き同士は片方をランダムに発現。
export function expressHue(alleles, rng = Math.random) {
  const colored = alleles.filter((a) => a !== 'clear');
  if (colored.length === 0) return 'clear';
  if (colored.length === 1 || colored[0] === colored[1]) return colored[0];
  return pick(colored, rng);
}

// 発色の発現: 低い方を基準に、差があれば50%で1段上がる。
export function expressSat(alleles, rng = Math.random) {
  const [a, b] = alleles;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return lo + (hi !== lo && rng() < 0.5 ? 1 : 0);
}

export function expressPattern(alleles) {
  return alleles[0] === 's' && alleles[1] === 's' ? 's' : 'n';
}

export function tierOf(sh) {
  if (sh.shine) return 5;
  if (sh.pat === 's') return 4;
  return sh.sat;
}

export function isHidden(hue) { return HIDDEN_HUES.includes(hue); }

// 図鑑キー。本体色は 色1文字+段階、隠し色は h_色。
export function dexKey(sh) {
  if (isHidden(sh.hue)) return `h_${sh.hue}`;
  return `${HUE_LETTER[sh.hue]}${tierOf(sh)}`;
}

export function spriteKey(sh) { return dexKey(sh); }

export const ALL_DEX_KEYS = [
  ...['r', 'b', 'y', 'k', 'g'].flatMap((c) => [1, 2, 3, 4, 5].map((t) => `${c}${t}`)),
  ...HIDDEN_HUES.map((h) => `h_${h}`),
];

// 個体を1匹作る。genes を与えれば発現を計算、与えなければ透明★1。
export function makeShrimp(opts, rng = Math.random) {
  const now = opts.now ?? Date.now();
  const genes = opts.genes ?? { hue: ['clear', 'clear'], sat: [1, 1], pat: ['n', 'n'] };
  const hidden = opts.hidden ?? null;
  const hue = hidden ?? expressHue(genes.hue, rng);
  if (hidden) genes.hue = [hidden, hidden];
  const sat = expressSat(genes.sat, rng);
  const pat = expressPattern(genes.pat);
  const shine = !!opts.shine;
  const sh = {
    id: newId(),
    name: opts.name ?? '',
    sex: opts.sex ?? (rng() < 0.5 ? 'm' : 'f'),
    genes,
    hue, sat, pat, shine,
    tier: 0,
    bornAt: now,
    adultAt: opts.adult ? now : now + (opts.growMs ?? 0),
    diesAt: now + (opts.lifeMs ?? 0),
    berriedAt: null,
    hatchAt: null,
    mate: null,
    tankId: opts.tankId ?? null,
  };
  sh.tier = tierOf(sh);
  return sh;
}

function copyAllele(parentAlleles, kind, rng) {
  let a = pick(parentAlleles, rng);
  if (kind === 'hue') {
    // 色相の突然変異: 5%で別の色へ
    if (rng() < 0.05) a = pick(HUES, rng);
  } else if (kind === 'sat') {
    if (rng() < 0.08) a = Math.max(1, Math.min(3, a + (rng() < 0.5 ? -1 : 1)));
  } else if (kind === 'pat') {
    if (a === 'n' && rng() < 0.04) a = 's';
  }
  return a;
}

// 両親から子を1匹作る。mother/father は genes と sat を持つ。
export function childOf(mother, father, opts = {}, rng = Math.random) {
  const hueAlleles = [copyAllele(mother.genes.hue, 'hue', rng), copyAllele(father.genes.hue, 'hue', rng)];
  const genes = {
    hue: hueAlleles,
    sat: [copyAllele(mother.genes.sat, 'sat', rng), copyAllele(father.genes.sat, 'sat', rng)],
    pat: [copyAllele(mother.genes.pat, 'pat', rng), copyAllele(father.genes.pat, 'pat', rng)],
  };
  // 隠し色の親同士はそのまま固定化される
  const hidden = hiddenFromAlleles(hueAlleles, rng);
  const shine = mother.sat === 3 && father.sat === 3 && rng() < 0.03;
  return makeShrimp({ ...opts, genes, hidden, shine }, rng);
}

// 繁殖画面の予想。n回サンプリングして図鑑キーごとの割合を返す。輝は除外。
export function predictChildren(mother, father, n = 400, rng = Math.random) {
  const count = {};
  for (let i = 0; i < n; i += 1) {
    const c = childOf(mother, father, { now: 0 }, rng);
    if (c.shine) { c.shine = false; c.tier = tierOf(c); }
    const k = dexKey(c);
    count[k] = (count[k] || 0) + 1;
  }
  return Object.entries(count)
    .map(([key, c]) => ({ key, p: c / n }))
    .sort((a, b) => b.p - a.p);
}

export function labelOf(sh) {
  if (isHidden(sh.hue)) return HUE_JA[sh.hue];
  return `${HUE_JA[sh.hue]} ★${tierOf(sh)}`;
}

export function labelOfKey(key) {
  if (key.startsWith('h_')) return HUE_JA[key.slice(2)];
  const letter = key[0];
  const hue = Object.keys(HUE_LETTER).find((h) => HUE_LETTER[h] === letter);
  return `${HUE_JA[hue]} ★${key[1]} ${TIER_JA[key[1]]}`;
}

// 名前を付ける。同じ水槽内の既存名を避け、尽きたら番号を足す。
export function pickName(hue, usedNames, rng = Math.random) {
  const pool = NAME_POOL[hue] ?? NAME_POOL.clear;
  const free = pool.filter((n) => !usedNames.includes(n));
  if (free.length) return pick(free, rng);
  let i = 2;
  const base = pick(pool, rng);
  while (usedNames.includes(`${base}${i}`)) i += 1;
  return `${base}${i}`;
}
