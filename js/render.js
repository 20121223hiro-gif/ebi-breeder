// 水槽の Canvas 描画。ゲーム状態は読むだけで書き換えない。
// 見方は2種類: 'side'(横から・従来) / 'top'(上から・エビは底を這う)。位置(motion)は両方で共有する。
import { sprites } from './assets.js';
import { spriteKey } from './genetics.js';

const PLANTS = [
  { x: 0.08, h: 0.42, w: 0.06, c1: '#8CCB6E', c2: '#3F8F45' },
  { x: 0.2, h: 0.26, w: 0.04, c1: '#A9D67E', c2: '#4E9B4C' },
  { x: 0.84, h: 0.36, w: 0.055, c1: '#8CCB6E', c2: '#3F8F45' },
];

// ---------- 見方の設定（端末内に保存。セーブデータとは別） ----------
const VIEW_KEY = 'ebi-breeder-view';
let viewMode = 'side';
try { if (localStorage.getItem(VIEW_KEY) === 'top') viewMode = 'top'; } catch { /* 使えない環境 */ }
export function getViewMode() { return viewMode; }
export function setViewMode(mode) {
  viewMode = mode === 'top' ? 'top' : 'side';
  try { localStorage.setItem(VIEW_KEY, viewMode); } catch { /* ignore */ }
  return viewMode;
}
export function toggleViewMode() { return setViewMode(viewMode === 'top' ? 'side' : 'top'); }

// ---------- 上から見たときの色（横向き画像から代表色を拾う） ----------
const tintCache = new Map();
function tintOf(key) {
  if (tintCache.has(key)) return tintCache.get(key);
  const img = sprites[key];
  let tint = { r: 200, g: 200, b: 200, a: 1 };
  if (img) {
    try {
      const c = document.createElement('canvas');
      c.width = 32; c.height = 18;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0, 32, 18);
      const d = x.getImageData(0, 0, 32, 18).data;
      let r = 0, g = 0, b = 0, n = 0, asum = 0, an = 0;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a < 10) continue;
        asum += a; an += 1;
        const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
        if (a < 90 || lum < 45 || lum > 238) continue; // 輪郭線とハイライトは除く
        const sat = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
        const wgt = 1 + sat / 64; // 鮮やかな画素を重く
        r += d[i] * wgt; g += d[i + 1] * wgt; b += d[i + 2] * wgt; n += wgt;
      }
      if (n > 0) tint = { r: r / n, g: g / n, b: b / n, a: an ? asum / an / 255 : 1 };
    } catch { /* 画像が読めない */ }
  }
  tintCache.set(key, tint);
  return tint;
}
const rgba = (t, k = 1, a = 1) => `rgba(${Math.round(Math.min(255, t.r * k))},${Math.round(Math.min(255, t.g * k))},${Math.round(Math.min(255, t.b * k))},${a})`;

// 決まった位置に砂利を散らす（毎フレーム同じ配置）
function seeded(n) { let s = n * 9301 + 49297; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

export class TankView {
  constructor(canvas, { mini = false, motion = null } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mini = mini;
    // motion を共有すると画面を作り直しても位置が飛ばない
    this.motion = motion ?? new Map();
    this.state = null;
    this.tank = null;
    this.selectedId = null;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (this.canvas.width !== w * this.dpr || this.canvas.height !== h * this.dpr) {
      this.canvas.width = w * this.dpr;
      this.canvas.height = h * this.dpr;
    }
    this.w = w;
    this.h = h;
  }

  setTank(state, tank) { this.state = state; this.tank = tank; }

  shrimpList(now) {
    if (!this.state || !this.tank) return [];
    return this.tank.shrimpIds.map((id) => this.state.shrimp[id]).filter(Boolean).map((sh) => ({
      sh, baby: now < sh.adultAt,
    }));
  }

  motionOf(sh, rng = Math.random) {
    let m = this.motion.get(sh.id);
    if (!m) {
      m = { x: 0.1 + rng() * 0.8, y: 0.35 + rng() * 0.45, tx: 0, ty: 0, dir: 1, face: 1, ang: rng() * 6.28, wait: 0, bob: rng() * 6.28 };
      m.tx = m.x; m.ty = m.y;
      this.motion.set(sh.id, m);
    }
    if (m.ang == null) m.ang = m.dir > 0 ? 0 : Math.PI;
    return m;
  }

  // 上から見たときの床の位置（横向きの y 0.3〜0.82 を床全体 0.1〜0.9 に広げる）
  topPos(m) { return { x: m.x, y: 0.1 + ((m.y - 0.3) / 0.52) * 0.8 }; }

  // 上から見た流木（中心 0.58,0.66・少し傾き）の上にいるか。横からの表示でも同じ個体を流木の上に乗せる
  onWood(m) {
    const p = this.topPos(m);
    if (p.x < 0.37 || p.x > 0.79) return false;
    const woodY = 0.66 - 0.224 * (p.x - 0.58) * (this.w / this.h);
    return Math.abs(p.y - woodY) < 0.05;
  }

  update(dt, now) {
    const list = this.shrimpList(now);
    const alive = new Set();
    const aspect = (this.h / this.w) * (0.8 / 0.52);
    for (const { sh, baby } of list) {
      alive.add(sh.id);
      const m = this.motionOf(sh);
      m.bob += dt * 2;
      // 向きはゆっくり変わる（0.4秒ほどで反転）
      m.face += (m.dir - m.face) * Math.min(1, dt * 6);
      if (m.wait > 0) { m.wait -= dt; continue; }
      const dx = m.tx - m.x;
      const dy = m.ty - m.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.01) {
        // 近場を目指すことが多く、たまに遠くへ
        const far = Math.random() < 0.3;
        m.tx = far ? 0.08 + Math.random() * 0.84 : Math.max(0.08, Math.min(0.92, m.x + (Math.random() - 0.5) * 0.3));
        m.ty = far ? 0.3 + Math.random() * 0.52 : Math.max(0.3, Math.min(0.82, m.y + (Math.random() - 0.5) * 0.2));
        m.wait = 1 + Math.random() * 4;
        continue;
      }
      // 画面幅の2.5%/秒（稚エビは少し速い）。実物のゆっくりした歩きに合わせる
      const speed = (baby ? 0.04 : 0.025) * dt;
      m.x += (dx / dist) * speed;
      m.y += (dy / dist) * speed;
      if (Math.abs(dx) > 0.01) m.dir = dx > 0 ? 1 : -1;
      // 上から見たときの進行方向（這っている向き）。ゆっくり旋回する
      const target = Math.atan2(dy * aspect, dx);
      let diff = target - m.ang;
      while (diff > Math.PI) diff -= 6.2832;
      while (diff < -Math.PI) diff += 6.2832;
      m.ang += diff * Math.min(1, dt * 3);
    }
    // 位置情報は全水槽で共有しているので、消すのは「もういない個体」だけ（他の水槽の分は残す）
    for (const id of [...this.motion.keys()]) if (!alive.has(id) && !this.state?.shrimp?.[id]) this.motion.delete(id);
  }

  draw(now) {
    if (viewMode === 'top') this.drawTop(now);
    else this.drawSide(now);
  }

  // ---------- 横から（従来） ----------
  drawSide(now) {
    const { ctx, w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 水
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#6FBFCF');
    g.addColorStop(0.55, '#3A8A99');
    g.addColorStop(1, '#2C6771');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // 水草
    for (const p of PLANTS) {
      const px = p.x * w;
      const ph = p.h * h;
      const pw = p.w * w;
      const pg = ctx.createLinearGradient(0, h - ph, 0, h);
      pg.addColorStop(0, p.c1);
      pg.addColorStop(1, p.c2);
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.moveTo(px - pw / 2, h * 0.9);
      ctx.quadraticCurveTo(px - pw, h * 0.9 - ph * 0.6, px, h * 0.9 - ph);
      ctx.quadraticCurveTo(px + pw, h * 0.9 - ph * 0.6, px + pw / 2, h * 0.9);
      ctx.fill();
    }
    // 流木
    ctx.save();
    ctx.translate(w * 0.58, h * 0.84);
    ctx.rotate(-0.1);
    ctx.fillStyle = '#6E4B2E';
    ctx.beginPath();
    ctx.roundRect(-w * 0.23, -h * 0.04, w * 0.46, h * 0.08, 6);
    ctx.fill();
    ctx.restore();
    // 砂利
    ctx.fillStyle = '#B99A6B';
    ctx.fillRect(0, h * 0.88, w, h * 0.12);
    ctx.fillStyle = '#8F7449';
    for (let x = 6; x < w; x += 22) { ctx.beginPath(); ctx.arc(x, h * 0.92, 1.6, 0, 6.28); ctx.fill(); }
    ctx.fillStyle = '#D6BB8A';
    for (let x = 16; x < w; x += 22) { ctx.beginPath(); ctx.arc(x, h * 0.96, 1.6, 0, 6.28); ctx.fill(); }

    // エビは底を這う。motion の y は「奥行き」(0.3=奥, 0.82=手前)。奥の個体から描き、手前ほど少し大きく低い位置に
    const list = this.shrimpList(now).sort((a, b) => this.motionOf(a.sh).y - this.motionOf(b.sh).y);
    const baseW = w * (this.mini ? 0.3 : 0.2);
    for (const { sh, baby } of list) {
      const m = this.motionOf(sh);
      const img = sprites[spriteKey(sh)];
      const depth = Math.max(0, Math.min(1, (m.y - 0.3) / 0.52));
      const sw = baseW * (0.8 + depth * 0.28) * (baby ? 0.5 : 1);
      const shh = sw * 0.555;
      const cx = m.x * w;
      // 足元の高さ: 砂利の上（手前ほど下）。流木の上にいる個体は流木の上面に乗せる
      // 流木は右上がりに少し傾いているので、上面の高さは x で変わる
      const foot = this.onWood(m) ? h * 0.80 - 0.0998 * (cx - w * 0.58) : h * (0.87 + depth * 0.11);
      const cy = foot - shh * 0.5;
      m.box = { x: cx - sw * 0.7, y: cy - shh * 0.7, w: sw * 1.4, h: shh * 1.4 };
      ctx.save();
      ctx.translate(cx, cy);
      const face = m.face ?? m.dir;
      ctx.scale(Math.abs(face) < 0.05 ? (face < 0 ? -0.05 : 0.05) : face, 1);
      if (this.selectedId === sh.id) {
        ctx.strokeStyle = 'rgba(255,255,255,.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, sw * 0.62, shh * 0.8, 0, 0, 6.28);
        ctx.stroke();
      }
      ctx.shadowColor = 'rgba(0,0,0,.25)';
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 1;
      if (img) ctx.drawImage(img, -sw / 2, -shh / 2, sw, shh);
      else { ctx.fillStyle = '#ccc'; ctx.fillRect(-sw / 2, -shh / 2, sw, shh); }
      ctx.shadowColor = 'transparent';
      // 抱卵の卵
      if (sh.berriedAt != null) {
        ctx.fillStyle = '#C9D64A';
        ctx.strokeStyle = '#8A9A20';
        ctx.lineWidth = 0.6;
        const r = Math.max(1.2, sw * 0.03);
        for (let i = 0; i < 9; i += 1) {
          const ex = -sw * 0.18 + (i % 5) * r * 1.8 + (i >= 5 ? r * 0.9 : 0);
          const ey = shh * 0.22 + (i >= 5 ? r * 1.6 : 0);
          ctx.beginPath(); ctx.arc(ex, ey, r, 0, 6.28); ctx.fill(); ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  // ---------- 上から（エビは底を這う） ----------
  drawTop(now) {
    const { ctx, w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 砂利の床
    ctx.fillStyle = '#B99A6B';
    ctx.fillRect(0, 0, w, h);
    const rnd = seeded(7);
    const n = Math.round((w * h) / (this.mini ? 260 : 220));
    for (let i = 0; i < n; i += 1) {
      const x = rnd() * w;
      const y = rnd() * h;
      const r = 1.2 + rnd() * 1.6;
      ctx.fillStyle = rnd() < 0.5 ? '#8F7449' : '#D6BB8A';
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill();
    }
    // 水の色味（上から覗いた感じ）
    ctx.fillStyle = 'rgba(70,160,175,.22)';
    ctx.fillRect(0, 0, w, h);
    const lg = ctx.createRadialGradient(w * 0.35, h * 0.3, 0, w * 0.35, h * 0.3, Math.max(w, h) * 0.8);
    lg.addColorStop(0, 'rgba(255,255,255,.14)');
    lg.addColorStop(1, 'rgba(0,30,40,.16)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, w, h);
    // 流木（上から）
    ctx.save();
    ctx.translate(w * 0.58, h * 0.66);
    ctx.rotate(-0.22);
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.beginPath(); ctx.roundRect(-w * 0.23 + 3, -h * 0.045 + 4, w * 0.46, h * 0.09, 8); ctx.fill();
    ctx.fillStyle = '#6E4B2E';
    ctx.beginPath(); ctx.roundRect(-w * 0.23, -h * 0.045, w * 0.46, h * 0.09, 8); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.14)';
    ctx.beginPath(); ctx.roundRect(-w * 0.2, -h * 0.03, w * 0.4, h * 0.025, 4); ctx.fill();
    ctx.restore();
    // 水草（上から見た葉の束）。横向きでの位置に合わせて、奥側と手前に置く
    const tops = [
      { x: PLANTS[0].x, y: 0.24, r: PLANTS[0].h * 0.42 },
      { x: PLANTS[1].x, y: 0.78, r: PLANTS[1].h * 0.42 },
      { x: PLANTS[2].x, y: 0.3, r: PLANTS[2].h * 0.42 },
    ];
    for (let i = 0; i < tops.length; i += 1) {
      const p = tops[i];
      const cx = p.x * w;
      const cy = p.y * h;
      const rr = p.r * Math.min(w, h) * (this.mini ? 1.15 : 1);
      ctx.fillStyle = 'rgba(0,0,0,.15)';
      ctx.beginPath(); ctx.arc(cx + 2, cy + 3, rr * 0.9, 0, 6.28); ctx.fill();
      for (let k = 0; k < 6; k += 1) {
        const a = (k / 6) * 6.28 + i;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.fillStyle = PLANTS[i].c2;
        ctx.beginPath(); ctx.ellipse(rr * 0.55, 0, rr * 0.55, rr * 0.28, 0, 0, 6.28); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = PLANTS[i].c1;
      ctx.beginPath(); ctx.arc(cx, cy, rr * 0.36, 0, 6.28); ctx.fill();
    }
    // 水槽のふち
    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    ctx.lineWidth = this.mini ? 3 : 5;
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);

    // エビ（手前＝画面下ほど後に描く）
    const list = this.shrimpList(now).sort((a, b) => this.motionOf(a.sh).y - this.motionOf(b.sh).y);
    const baseL = w * (this.mini ? 0.3 : 0.2);
    for (const { sh, baby } of list) {
      const m = this.motionOf(sh);
      const p = this.topPos(m);
      const L = baseL * (baby ? 0.5 : 1);
      const cx = p.x * w;
      const cy = p.y * h;
      m.box = { x: cx - L * 0.6, y: cy - L * 0.6, w: L * 1.2, h: L * 1.2 };
      this.drawShrimpTop(sh, m, cx, cy, L, baby);
    }
  }

  // 上から見たエビ1匹。+x が進行方向、ang で回す
  drawShrimpTop(sh, m, cx, cy, L, baby) {
    const { ctx } = this;
    const key = spriteKey(sh);
    const t = tintOf(key);
    const body = rgba(t);
    const dark = rgba(t, 0.6);
    const light = rgba(t, 1.35, 0.55);
    // 透明・★1は体が透けて見える
    const alpha = key === 'h_clear' ? 0.62 : /1$/.test(key) ? 0.78 : 0.96;
    ctx.save();
    ctx.translate(cx, cy);
    if (this.selectedId === sh.id) {
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 0, L * 0.62, L * 0.62, 0, 0, 6.28); ctx.stroke();
    }
    ctx.rotate(m.ang ?? 0);
    // 影
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.beginPath(); ctx.ellipse(L * 0.02, L * 0.06, L * 0.5, L * 0.16, 0, 0, 6.28); ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = dark;
    // 触角（長く前へ）
    ctx.lineWidth = Math.max(0.7, L * 0.018);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(L * 0.46, s * L * 0.05);
      ctx.quadraticCurveTo(L * 0.8, s * L * 0.02, L * 1.0, s * L * 0.3);
      ctx.stroke();
    }
    // 脚
    ctx.lineWidth = Math.max(0.7, L * 0.02);
    for (let i = 0; i < 4; i += 1) {
      const x = L * (0.04 + i * 0.09);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x, s * L * 0.12);
        ctx.quadraticCurveTo(x + L * 0.05, s * L * 0.19, x + L * 0.02, s * L * 0.24);
        ctx.stroke();
      }
    }
    // 尾扇
    ctx.lineWidth = Math.max(0.8, L * 0.022);
    ctx.fillStyle = body;
    for (const s of [-1, 0, 1]) {
      ctx.save();
      ctx.translate(-L * 0.46, 0);
      ctx.rotate(s * 0.45);
      ctx.beginPath(); ctx.ellipse(-L * 0.08, 0, L * 0.11, L * 0.045, 0, 0, 6.28); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // 腹の節（尾側から頭へ重ねる）
    const segs = [
      { x: -0.38, rx: 0.08, ry: 0.06 },
      { x: -0.28, rx: 0.085, ry: 0.075 },
      { x: -0.17, rx: 0.09, ry: 0.09 },
      { x: -0.05, rx: 0.1, ry: 0.105 },
    ];
    for (const s of segs) {
      ctx.beginPath(); ctx.ellipse(s.x * L, 0, s.rx * L, s.ry * L, 0, 0, 6.28); ctx.fill(); ctx.stroke();
    }
    // 頭胸部
    ctx.beginPath(); ctx.ellipse(L * 0.2, 0, L * 0.27, L * 0.14, 0, 0, 6.28); ctx.fill(); ctx.stroke();
    // 額角（先端）
    ctx.beginPath(); ctx.moveTo(L * 0.44, -L * 0.03); ctx.lineTo(L * 0.55, 0); ctx.lineTo(L * 0.44, L * 0.03); ctx.closePath(); ctx.fill(); ctx.stroke();
    // 背中のハイライト
    ctx.strokeStyle = light;
    ctx.lineWidth = Math.max(1, L * 0.04);
    ctx.beginPath(); ctx.moveTo(-L * 0.4, -L * 0.02); ctx.quadraticCurveTo(-L * 0.05, -L * 0.06, L * 0.38, -L * 0.03); ctx.stroke();
    // 目（左右）
    const er = Math.max(1.2, L * 0.035);
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#1E1A1A';
      ctx.beginPath(); ctx.arc(L * 0.4, s * L * 0.11, er, 0, 6.28); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(L * 0.4 + er * 0.35, s * L * 0.11 - er * 0.35, er * 0.35, 0, 6.28); ctx.fill();
    }
    // 抱卵の卵（腹の両脇）
    if (sh.berriedAt != null) {
      ctx.fillStyle = '#C9D64A';
      ctx.strokeStyle = '#8A9A20';
      ctx.lineWidth = 0.6;
      const r = Math.max(1.2, L * 0.03);
      for (let i = 0; i < 5; i += 1) {
        for (const s of [-1, 1]) {
          ctx.beginPath(); ctx.arc(-L * 0.36 + i * r * 1.9, s * (L * 0.09 + (i % 2) * r * 0.6), r, 0, 6.28); ctx.fill(); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // タップ位置に一番近いエビ（当たり判定は見た目より大きめ）
  hitTest(px, py) {
    let best = null;
    let bestD = Infinity;
    for (const [id, m] of this.motion) {
      const b = m.box;
      if (!b) continue;
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
        const d = Math.hypot(px - (b.x + b.w / 2), py - (b.y + b.h / 2));
        if (d < bestD) { bestD = d; best = id; }
      }
    }
    return best;
  }
}
