// 水槽の Canvas 描画。ゲーム状態は読むだけで書き換えない。
import { sprites } from './assets.js';
import { spriteKey } from './genetics.js';

const PLANTS = [
  { x: 0.08, h: 0.42, w: 0.06, c1: '#8CCB6E', c2: '#3F8F45' },
  { x: 0.2, h: 0.26, w: 0.04, c1: '#A9D67E', c2: '#4E9B4C' },
  { x: 0.84, h: 0.36, w: 0.055, c1: '#8CCB6E', c2: '#3F8F45' },
];

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
      m = { x: 0.1 + rng() * 0.8, y: 0.35 + rng() * 0.45, tx: 0, ty: 0, dir: 1, face: 1, wait: 0, bob: rng() * 6.28 };
      m.tx = m.x; m.ty = m.y;
      this.motion.set(sh.id, m);
    }
    return m;
  }

  update(dt, now) {
    const list = this.shrimpList(now);
    const alive = new Set();
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
    }
    // 位置情報は全水槽で共有しているので、消すのは「もういない個体」だけ（他の水槽の分は残す）
    for (const id of [...this.motion.keys()]) if (!alive.has(id) && !this.state?.shrimp?.[id]) this.motion.delete(id);
  }

  draw(now) {
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

    // エビ（奥の稚エビから描く）
    const list = this.shrimpList(now).sort((a, b) => (a.baby === b.baby ? 0 : a.baby ? -1 : 1));
    const baseW = w * (this.mini ? 0.3 : 0.2);
    for (const { sh, baby } of list) {
      const m = this.motionOf(sh);
      const img = sprites[spriteKey(sh)];
      const sw = baseW * (baby ? 0.5 : 1);
      const shh = sw * 0.555;
      const cx = m.x * w;
      const cy = m.y * h + Math.sin(m.bob) * 1.5;
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
