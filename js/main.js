// 起動・ループ・保存・遷移。ゲームのルールは sim/genetics、画面は ui に置く。
import { loadSprites } from './assets.js';
import { newGame, advance } from './sim.js';
import { load, save, wipe, logError } from './state.js';
import { createUI } from './ui.js';
import { labelOfKey, dexKey } from './genetics.js';
import { wantLabel } from './visitors.js';

const app = {
  state: null,
  clockOffset: 0,           // デバッグ用の時間ずらし
  now() { return Date.now() + this.clockOffset; },
  nav: [{ screen: 'home' }],
  current() { return this.nav[this.nav.length - 1]; },
  ui: null,
  revealQueue: [],
  revealing: false,

  go(screen, id, params) {
    const cur = this.current();
    if (['home', 'sell', 'dex', 'shop'].includes(screen)) this.nav = [{ screen, id, params }];
    else if (cur.screen === screen) this.nav[this.nav.length - 1] = { screen, id, params }; // 同じ画面内の切り替えは履歴を増やさない
    else { this.nav.push({ screen, id, params }); history.pushState({ d: this.nav.length }, ''); }
    this.ui.render();
  },
  back() {
    // 履歴と nav を揃えるため、ブラウザの戻るに任せる（popstate で pop する）
    if (this.nav.length > 1) history.back(); else this.go('home');
  },
  mutate() { save(this.state); },
  toast(msg) { this.ui.toast(msg); },

  handleEvents(events) {
    const s = this.state;
    for (const ev of events) {
      if (ev.type === 'hatch') {
        const tank = s.tanks.find((t) => t.id === ev.tankId);
        s.log.unshift({ at: ev.at, text: `${ev.motherName} の子が ${ev.babies.length}匹生まれた${ev.lost ? `（満員で ${ev.lost}匹は育たなかった）` : ''}` });
        if (ev.babies.length) this.toast(`${ev.motherName} の子が ${ev.babies.length}匹生まれた`);
        for (const key of ev.newKeys) {
          const baby = ev.babies.map((id) => s.shrimp[id]).find((b) => b && dexKey(b) === key);
          this.revealQueue.push({ key, name: baby?.name ?? s.dex[key]?.first ?? '', tankName: tank?.name ?? '', mother: ev.motherName, father: ev.fatherName });
        }
      } else if (ev.type === 'death') {
        s.log.unshift({ at: ev.at, text: `${ev.name} が死んでしまった（${ev.cause}）` });
        this.toast(`${ev.name} が死んでしまった（${ev.cause}）`);
      } else if (ev.type === 'visitor_arrive') {
        s.log.unshift({ at: ev.at, text: `${ev.name} が買いに来た：${wantLabel(ev.want)}` });
        if (this.now() - ev.at < 60000) this.toast(`${ev.name} が買いに来た：${wantLabel(ev.want)}`);
      } else if (ev.type === 'visitor_leave') {
        s.log.unshift({ at: ev.at, text: `${ev.name} が帰った（${ev.delivered}匹 渡した）` });
        if (this.now() - ev.at < 60000) this.toast(`${ev.name} が帰った`);
      } else if (ev.type === 'visitor_skip') {
        s.log.unshift({ at: ev.at, text: '汚れがひどくて客が入らなかった' });
      } else if (ev.type === 'trip_return') {
        const a = ev.applied;
        s.log.unshift({ at: ev.at, text: `遠征から帰還：¥${a.yen} ／ 素材${a.items.length} ／ 仲間${a.friends.length}${a.bucket?.length ? ` ／ バケツで${a.bucket.length}匹待機` : ''}${a.mate ? ` ／ ${a.mate}が抱卵` : ''}` });
        this.recordQueue.push(ev);
        for (const key of a.newKeys) this.revealQueue.push({ key, name: s.dex[key]?.first ?? '', tankName: '川', mother: '野生', father: '野生' });
      }
    }
    s.log = s.log.slice(0, 30);
    if (events.length) { this.mutate(); this.ui.render(); }
    this.pumpReveal();
  },
  recordQueue: [],
  // バケツから入れたときなど、後から図鑑に新しい色が加わった場合の演出
  queueNewKeys(keys) {
    const s = this.state;
    for (const key of keys ?? []) this.revealQueue.push({ key, name: s.dex[key]?.first ?? '', tankName: '川', mother: '野生', father: '野生' });
    this.pumpReveal();
  },
  pumpReveal() {
    if (this.revealing) return;
    if (this.recordQueue.length) {
      this.revealing = true;
      const ev = this.recordQueue.shift();
      this.ui.record(ev, () => { this.revealing = false; this.ui.render(); this.pumpReveal(); });
      return;
    }
    if (!this.revealQueue.length) return;
    this.revealing = true;
    const ev = this.revealQueue.shift();
    this.ui.reveal(ev, () => { this.revealing = false; this.ui.render(); this.pumpReveal(); });
  },
};

async function boot() {
  window.addEventListener('error', (e) => logError(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => logError(e.reason));

  await loadSprites();
  let state = await load();
  if (!state) { state = newGame(Date.now()); await save(state, { immediate: true }); }
  app.state = state;
  app.ui = createUI(app);
  history.replaceState({ d: 1 }, '');
  window.addEventListener('popstate', () => { if (app.nav.length > 1) { app.nav.pop(); app.ui.render(); } });

  // 離れていた分を進める
  app.handleEvents(advance(state, app.now()));
  app.ui.render();

  // ループ: 描画は毎フレーム、時間進行と表示更新は1秒ごと。裏に回ったら止める。
  let last = performance.now();
  let acc = 0;
  let raf = 0;
  function loop(ts) {
    const dt = Math.min(0.1, (ts - last) / 1000);
    last = ts;
    app.ui.frame(dt);
    acc += dt;
    if (acc >= 1) {
      acc = 0;
      app.handleEvents(advance(state, app.now()));
      app.ui.refresh();
    }
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; save(state, { immediate: true }); }
    else if (!raf) { last = performance.now(); app.handleEvents(advance(state, app.now())); app.ui.render(); raf = requestAnimationFrame(loop); }
  });
  window.addEventListener('pagehide', () => save(state, { immediate: true }));

  // デバッグ用フック
  window.__ebi = {
    app,
    get state() { return app.state; },
    skip(ms) { app.clockOffset += ms; app.handleEvents(advance(app.state, app.now())); app.ui.render(); },
    hours(h) { this.skip(h * 3600000); },
    async reset() { await wipe(); location.reload(); },
    // 宝箱の演出をすぐ確認する（成果は反映しない見本）
    async demoChest() {
      const { planTrip } = await import('./river.js');
      const s = app.state;
      const team = Object.values(s.shrimp).slice(0, 2);
      if (!team.length) return 'エビがいません';
      const trip = planTrip(s, 'stream', team, app.now(), Math.random);
      app.revealing = true;
      app.ui.record({ trip, applied: {}, _walked: true, replay: true }, () => { app.revealing = false; app.ui.render(); });
      return 'demo';
    },
    keyLabel: labelOfKey,
  };
}

// PWA: 公開先（https）でだけサービスワーカーを登録。localhost では登録しない（キャッシュ事故防止）
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && location.protocol === 'https:' && !isLocal) {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    // 新しい版が来たら次回起動で反映される。いま知らせる
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) app.toast?.('新しいバージョンがあります。開き直すと反映されます');
      });
    });
  }).catch(() => {});
}

boot().catch((e) => {
  logError(e);
  document.getElementById('app').innerHTML = `<div class="loading" style="flex-direction:column;gap:10px;padding:20px;text-align:center">読み込みに失敗しました<br><small>${String(e).slice(0, 200)}</small><button class="btn" style="width:auto" onclick="location.reload()">再読み込み</button></div>`;
});
