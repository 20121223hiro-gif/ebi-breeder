// 画面（DOM）。state の読み書きは app 経由で行い、時間進行は sim に任せる。
import {
  HUE_JA, TIER_JA, TIER_MULT, HUE_LETTER, isHidden, tierOf, dexKey, spriteKey, labelOfKey,
  predictChildren, ALL_DEX_KEYS, pickName,
} from './genetics.js';
import {
  T, TANK_TYPES, isAdult, feed, changeWater, pair, pairError, moveShrimp, addTank, nextHatch,
  eggStage, careEgg, EGG_STAGES, EGG_CHOICES,
  sendTrip, useLeaf, placeEquipment, removeEquipment, sellMolt,
  bucketPlace, bucketSwap, bucketRelease,
} from './sim.js';
import { priceOf, sellError, isLastOfSex, sell, fmtCoin, coinHtml } from './economy.js';
import { wantLabel, matchesWant, visitorPrice, deliver } from './visitors.js';
import { DESTS, MATERIALS, ROLE_JA, canSend, teamBonus, tripSummary } from './river.js';
import { TankView, getViewMode, toggleViewMode } from './render.js';
import { sprites } from './assets.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 水槽画面のボタンは assets/icons/*.png（Higgsfield製のイラスト）
const sp = (key, w, extra = '') => `<i class="sp ${extra}" style="width:${w}px;background-image:url(assets/shrimp/${key}.png)"></i>`;

export function fmtRemain(ms) {
  if (ms <= 0) return 'まもなく';
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `あと ${m}分`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return mm ? `あと ${h}時間${mm}分` : `あと ${h}時間`;
  const d = Math.floor(h / 24);
  return `あと ${d}日${h % 24 ? `${h % 24}時間` : ''}`;
}

function ageDays(sh, now) { return Math.floor((now - sh.bornAt) / 86400000); }

function chipsOf(sh) {
  const hue = sh.hue;
  const hueChip = isHidden(hue)
    ? `<span class="chip gray">${HUE_JA[hue]}</span>`
    : `<span class="chip ${hue === 'blue' ? 'blue' : hue === 'red' ? 'red' : 'gray'}">${HUE_JA[hue]}</span>`;
  const t = tierOf(sh);
  const tierChip = isHidden(hue) ? '<span class="chip star">隠し色</span>' : `<span class="chip star">★${t} ${TIER_JA[t]}</span>`;
  const extra = (sh.boss ? '<span class="chip amber">ヌシ</span>' : sh.wild ? '<span class="chip gray">ワイルド</span>' : '')
    + ((sh.exp ?? 0) >= 5 ? '<span class="chip">川帰り</span>' : '');
  return hueChip + tierChip + extra;
}

export function createUI(app) {
  const root = document.getElementById('app');
  const views = [];          // 現在画面の TankView
  const motion = new Map();  // 位置の共有
  let sheetId = null;        // 個体カードを開いている個体
  let modal = null;          // 一時モーダルの描画関数

  const S = () => app.state;
  const now = () => app.now();
  const tankOf = (id) => S().tanks.find((t) => t.id === id);
  const shrimpIn = (tank) => tank.shrimpIds.map((id) => S().shrimp[id]).filter(Boolean);

  // ---------- 共通パーツ ----------
  function top() {
    const s = S();
    const day = Math.floor((now() - s.createdAt) / 86400000) + 1;
    return `<div class="top"><span class="money">${coinHtml(s.money)}</span><span class="rep">評判 <b>Lv${s.reputation}</b></span><span class="mute">${day}日目</span></div>`;
  }
  function tabs(active) {
    const s = S();
    const sellable = !!s.visitor || Object.values(s.shrimp).some((sh) => !sellError(sh, now()) && !isHidden(sh.hue) && tierOf(sh) >= 3);
    const newDex = Object.values(s.dex).some((d) => d.count === 1 && now() - d.foundAt < 3600000);
    const t = (id, label, dot) => `<button class="tab ${active === id ? 'on' : ''}" data-go="${id}"><i class="${dot ? 'dot' : ''}"></i>${label}</button>`;
    return `<div class="tabs">${t('home', '店舗')}${t('sell', '出荷', sellable)}${t('dex', '図鑑', newDex)}${t('shop', 'ショップ')}</div>`;
  }
  function gauge(label, v, unit, warn, bad, key) {
    const cls = v >= bad ? 'bad' : v >= warn ? 'warn' : '';
    const col = v >= bad ? 'color:var(--red)' : v >= warn ? 'color:var(--amber-ink)' : '';
    return `<div class="gauge" data-g="${key}"><span class="lab">${label}</span><div class="bar"><i class="${cls}" style="width:${Math.round(v)}%"></i></div><span class="val" style="${col}">${Math.round(v)}${unit}</span></div>`;
  }

  // ---------- 画面: 店舗 ----------
  function urgent() {
    const s = S();
    for (const t of s.tanks) {
      if (t.dirt >= 80) return { cls: 'red', text: `${t.name} の汚れが ${Math.round(t.dirt)}%。換水してください`, go: ['tank', t.id] };
    }
    for (const t of s.tanks) {
      if (t.food < 20) return { cls: '', text: `${t.name} の餌が切れそうです`, go: ['tank', t.id] };
      if (t.dirt >= 60) return { cls: '', text: `${t.name} の汚れが ${Math.round(t.dirt)}%`, go: ['tank', t.id] };
    }
    const cnt = Object.values(s.shrimp).filter((sh) => !sellError(sh, now()) && !isHidden(sh.hue) && tierOf(sh) >= 3).length;
    if (cnt >= 3) return { cls: 'teal', text: `★3以上のエビが ${cnt}匹います。出荷でコインにできます`, go: ['sell'] };
    return null;
  }

  function home() {
    const s = S();
    const u = urgent();
    const tiles = s.tanks.map((t) => {
      const list = shrimpIn(t);
      const berried = list.filter((sh) => sh.berriedAt != null).length;
      const badge = berried ? `<span class="badge">抱卵 ${berried}</span>`
        : t.dirt >= 60 ? `<span class="badge amber">汚れ ${Math.round(t.dirt)}%</span>`
          : t.food < 20 ? '<span class="badge amber">餌が少ない</span>' : '';
      return `<button class="tile" data-go="tank" data-id="${t.id}">${badge}<div class="name">${esc(t.name)}</div><canvas data-tank="${t.id}"></canvas>
        <div class="row small"><span class="grow">${list.length} / ${t.cap}匹</span><span class="mute">${t.temp}℃</span></div><div class="fill"><i style="width:${(list.length / t.cap) * 100}%"></i></div></button>`;
    }).join('');
    const v = s.visitor;
    const vcard = v
      ? `<button class="alert teal" data-go="sell" data-id="visitor"><span class="grow"><b>${esc(v.name)}</b> が買いに来ています<br>${wantLabel(v.want)} ／ 相場の ${v.want.mult}倍<br><span class="small">${v.delivered} / ${v.want.count}匹 渡した ／ <span data-remain="${v.leavesAt}">${fmtRemain(v.leavesAt - now())}</span>で帰ります</span></span><span>›</span></button>`
      : `<div class="panel small mute">次の客：${s.nextVisitorAt > now() ? `<b style="color:var(--ink)" data-remain="${s.nextVisitorAt}">${fmtRemain(s.nextVisitorAt - now())}</b>` : '汚れが80%以上の水槽があると客は来ません'}</div>`;
    // 抱卵中のエビを全部（孵化が近い順）
    const berried = Object.values(s.shrimp).filter((sh) => sh.hatchAt != null).sort((a, b) => a.hatchAt - b.hatchAt);
    const hatchRows = berried.slice(0, 6).map((sh) => {
      const c = sh.eggCare ?? [];
      const ok = c.filter((x) => x === 'ok').length;
      const done = c.filter(Boolean).length;
      const stage = eggStage(sh, now());
      const canCare = stage >= 0 && !c[stage];
      return `<button class="hatch-row" data-go="tank" data-id="${sh.tankId}"><span class="grow">${esc(tankOf(sh.tankId)?.name ?? '')} の <b>${esc(sh.name)}</b> <b style="color:var(--ink)" data-remain="${sh.hatchAt}">${fmtRemain(sh.hatchAt - now())}</b></span><span class="chip ${canCare ? 'star' : 'gray'}">見守り ${done}/4${ok ? `・正解${ok}` : ''}${canCare ? ' ●' : ''}</span></button>`;
    }).join('');
    const hatchMore = berried.length > 6 ? `<div class="small mute" style="text-align:center">ほか ${berried.length - 6}匹</div>` : '';
    const tr = s.trip;
    const tcard = tr
      ? `<div class="alert" style="background:#E4EEF7;color:var(--blue-ink)"><span class="grow">🏞 ${tr.ids.map((id) => esc(s.shrimp[id]?.name ?? '')).join('・')} が ${DESTS[tr.dest].name} へ遠征中<br><span class="small">帰還まで <span data-remain="${tr.returnAt}">${fmtRemain(tr.returnAt - now())}</span></span></span></div>`
      : s.lastTrip
        ? `<button class="panel small row" data-act="lasttrip"><img src="assets/icons/chest_closed.png" alt="" style="width:28px;height:28px;object-fit:contain"><span class="grow">前回の遠征記録をもう一度見る<br><span class="mute">${DESTS[s.lastTrip.trip.dest].name} ／ ${new Date(s.lastTrip.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></span><span>›</span></button>`
        : '';
    const bk = s.bucket ?? [];
    const bcard = bk.length
      ? `<button class="alert" data-go="bucket"><span class="grow">🪣 バケツで <b>${bk.map((w) => esc(w.name)).join('・')}</b> が待っています<br><span class="small">水槽が満員です。入れる・入れ替える・川に返すを選んでください</span></span><span>›</span></button>`
      : '';
    root.innerHTML = `${top()}<div class="body">
      ${u ? `<button class="alert ${u.cls}" data-go="${u.go[0]}" data-id="${u.go[1] ?? ''}"><span class="grow">${u.cls === 'red' ? '⚠ ' : ''}${esc(u.text)}</span><span>›</span></button>` : ''}
      ${bcard}
      ${tcard}
      ${vcard}
      <div class="grid2">${tiles}<button class="tile empty" data-go="shop"><div><img src="assets/icons/pla.png" alt="" style="width:64px;height:64px;object-fit:contain;display:block;margin:0 auto 4px;opacity:.8">水槽を増設<br><span class="chip" style="margin-top:6px">${coinHtml(TANK_TYPES.pla.price)}〜</span></div></button></div>
      <div class="panel small" style="margin-top:auto;display:flex;flex-direction:column;gap:4px">${berried.length ? `<div class="row mute" style="font-weight:700"><span class="grow">孵化の予定 ${berried.length}匹</span><span>● は世話できる段階</span></div>${hatchRows}${hatchMore}` : '<span class="mute">まだ抱卵中のエビはいません。水槽で ♂×♀ を組みましょう</span>'}</div>
    </div>${tabs('home')}`;
    mountCanvases(true);
    const lt = root.querySelector('[data-act="lasttrip"]');
    if (lt) lt.onclick = () => replayRecord();
  }

  // 前回の遠征記録を見返す（成果は反映済みなので表示だけ）
  function replayRecord() {
    const s = S();
    if (!s.lastTrip) return;
    const ev = { trip: s.lastTrip.trip, applied: s.lastTrip.applied, _walked: true, replay: true };
    app.revealing = true;
    record(ev, () => { app.revealing = false; render(); });
  }

  // ---------- 画面: 水槽詳細 ----------
  function tank(id) {
    const t = tankOf(id);
    if (!t) { app.go('home'); return; }
    const list = shrimpIn(t);
    const s = S();
    const switcher = s.tanks.length > 1
      ? `<div class="chips tank-switch">${s.tanks.map((x) => `<button class="chip ${x.id === t.id ? '' : 'off'}" data-go="tank" data-id="${x.id}">${esc(x.name)} <span class="mute" style="font-weight:400">${x.shrimpIds.length}/${x.cap}</span></button>`).join('')}</div>`
      : '';
    const idx = s.tanks.findIndex((x) => x.id === t.id);
    const prev = s.tanks[idx - 1];
    const next = s.tanks[idx + 1];
    const arrows = s.tanks.length > 1
      ? `<button class="tank-arrow left ${prev ? '' : 'off'}" ${prev ? `data-go="tank" data-id="${prev.id}"` : ''} aria-label="前の水槽">‹</button><button class="tank-arrow right ${next ? '' : 'off'}" ${next ? `data-go="tank" data-id="${next.id}"` : ''} aria-label="次の水槽">›</button>`
      : '';
    root.innerHTML = `<div class="head"><button class="back" data-back>‹</button>${esc(t.name)}<span class="cnt">${list.length} / ${t.cap}匹</span></div>
    <div class="body">
      ${switcher}
      <div style="position:relative"><canvas class="tank-canvas" data-tank="${t.id}"></canvas>${arrows}<span class="chip" style="position:absolute;left:10px;top:10px;background:rgba(255,255,255,.85)">${list.length ? 'エビをタップで個体カード' : 'エビがいません'}</span><button class="view-btn" data-act="view" aria-label="${getViewMode() === 'top' ? '横から見る' : '上から見る'}" title="${getViewMode() === 'top' ? '横から見る' : '上から見る'}"><img src="assets/icons/view_${getViewMode() === 'top' ? 'side' : 'top'}.png" alt=""></button></div>
      <div class="panel" style="display:flex;flex-direction:column;gap:7px">
        ${gauge('汚れ', t.dirt, '%', 60, 80, 'dirt')}
        <div class="gauge" data-g="food"><span class="lab">餌</span><div class="bar"><i class="${t.food < 20 ? 'bad' : t.food < 60 ? 'warn' : ''}" style="width:${Math.round(t.food)}%"></i></div><span class="val" style="${t.food < 20 ? 'color:var(--red)' : t.food < 60 ? 'color:var(--amber-ink)' : ''}">${t.food < 20 ? '少' : t.food < 60 ? '中' : '十分'}</span></div>
        <div class="gauge"><span class="lab">水温</span><div class="bar"><i class="${t.temp >= 29 ? 'bad' : t.temp >= 28 ? 'warn' : ''}" style="width:${(t.temp / 35) * 100}%"></i></div><span class="val">${t.temp}℃</span></div>
      </div>
      <div class="row small mute" style="padding:0 2px"><span class="grow">設備 ${(t.equipment ?? []).length} / 3</span>${t.leafUntil && t.leafUntil > now() ? `<span class="chip">落ち葉 <span data-remain="${t.leafUntil}">${fmtRemain(t.leafUntil - now())}</span></span>` : ''}</div>
      <div class="slots">${[0, 1, 2].map((i) => { const e = (t.equipment ?? [])[i]; return e ? `<button class="slot pic" data-eq="${i}"><img src="assets/icons/${e.type}.png" alt="">${MATERIALS[e.type].name}</button>` : '<button class="slot add" data-eq="add">＋ 追加</button>'; }).join('')}</div>
      <div class="icon-btns" style="margin-top:auto">
        <button class="ibtn" data-act="feed" aria-label="餌やり" title="餌やり"><img src="assets/icons/feed.png" alt=""></button>
        <button class="ibtn" data-act="water" aria-label="換水" title="換水"><img src="assets/icons/water.png" alt=""></button>
        <button class="ibtn" data-go="river" data-id="${t.id}" aria-label="川へ送る" title="川へ送る"><img src="assets/icons/river.png" alt=""></button>
        <button class="ibtn primary" data-go="breed" data-id="${t.id}" aria-label="繁殖ペアを組む" title="繁殖ペアを組む"><img src="assets/icons/breed.png" alt=""></button>
      </div>
    </div>${tabs('home')}`;
    root.querySelectorAll('[data-eq]').forEach((b) => { b.onclick = () => openSlotModal(t, b.dataset.eq); });
    mountCanvases(false);
    const view = views[0];
    if (view) {
      view.canvas.addEventListener('click', (e) => {
        const r = view.canvas.getBoundingClientRect();
        const hit = view.hitTest(e.clientX - r.left, e.clientY - r.top);
        if (hit) openSheet(hit);
      });
    }
    root.querySelector('[data-act="view"]').onclick = () => { const v = toggleViewMode(); app.toast(v === 'top' ? '上から見ています' : '横から見ています'); render(); };
    root.querySelector('[data-act="feed"]').onclick = () => { feed(t); app.mutate(); app.toast('餌をあげた'); render(); };
    root.querySelector('[data-act="water"]').onclick = () => { changeWater(t); app.mutate(); app.toast('換水した'); render(); };
    if (sheetId) openSheet(sheetId);
  }

  function geneCell(kind, allele, sh) {
    const s = S();
    let known = false;
    if (sh.geneKnown) {
      const label = kind === 'hue' ? HUE_JA[allele] : kind === 'sat' ? TIER_JA[allele] : (allele === 's' ? '縞' : 'なし');
      return `<span class="a">${label}</span>`;
    }
    if (kind === 'hue') {
      known = allele === 'clear' || isHidden(allele)
        ? !!s.dex[`h_${allele}`]
        : ALL_DEX_KEYS.some((k) => k[0] === HUE_LETTER[allele] && s.dex[k]);
      return known ? `<span class="a">${HUE_JA[allele]}</span>` : '<span class="a q">？</span>';
    }
    if (kind === 'sat') {
      known = isHidden(sh.hue) ? true : !!s.dex[`${HUE_LETTER[sh.hue]}${allele}`] || allele <= sh.sat;
      return known ? `<span class="a">${TIER_JA[allele]}</span>` : '<span class="a q">？</span>';
    }
    known = allele === 'n' || ALL_DEX_KEYS.some((k) => k.endsWith('4') && s.dex[k]);
    return known ? `<span class="a">${allele === 's' ? '縞' : 'なし'}</span>` : '<span class="a q">？</span>';
  }

  function openSheet(id) {
    const sh = S().shrimp[id];
    if (!sh) { sheetId = null; return; }
    sheetId = id;
    closeSheet(false);
    const view = views[0];
    if (view) view.selectedId = id;
    const t = tankOf(sh.tankId);
    const adult = isAdult(sh, now());
    const status = sh.berriedAt != null
      ? `<div class="panel" style="background:var(--red-soft);color:#8A2E22;font-weight:700;font-size:12px">抱卵中 — 孵化まで <span data-remain="${sh.hatchAt}">${fmtRemain(sh.hatchAt - now())}</span></div>`
      : !adult ? `<div class="panel" style="background:var(--amber-soft);color:var(--amber-ink);font-weight:700;font-size:12px">稚エビ — 成体まで <span data-remain="${sh.adultAt}">${fmtRemain(sh.adultAt - now())}</span></div>` : '';
    const sellErr = sellError(sh, now());
    const leftDays = Math.max(0, Math.ceil((sh.diesAt - now()) / 86400000));
    const lifeTxt = leftDays <= 3 ? `<span style="color:var(--amber-ink);font-weight:700">寿命まで あと${leftDays}日</span>` : `寿命まで あと${leftDays}日`;
    let eggHtml = '';
    if (sh.berriedAt != null) {
      const stage = eggStage(sh, now());
      const care = sh.eggCare ?? [null, null, null, null];
      const ok = care.filter((c) => c === 'ok').length;
      const done = !!care[stage];
      const span = (sh.hatchAt - sh.berriedAt) / 4;
      const nextAt = sh.berriedAt + span * (stage + 1);
      const segs = EGG_STAGES.map((st, i) => `<span class="egg-seg ${i < stage ? 'past' : i === stage ? 'cur' : ''} ${care[i] || ''}">${st.name}</span>`).join('');
      eggHtml = `<div class="panel" style="display:flex;flex-direction:column;gap:6px;background:var(--star)">
        <div class="row small" style="font-weight:700"><span class="grow">抱卵の見守り（正解で孵化数 +1）</span><span class="mute">正解 ${ok} / 4</span></div>
        <div class="egg-bar">${segs}</div>
        <div class="small"><b>${EGG_STAGES[stage].name}</b>：${EGG_STAGES[stage].hint}</div>
        <div class="small mute">いま：汚れ ${Math.round(t.dirt)}% ／ 餌 ${t.food < 20 ? '少' : t.food < 60 ? '中' : '十分'} ／ 水温 ${t.temp}℃</div>
        <div class="btns">${Object.entries(EGG_CHOICES).map(([k, l]) => `<button class="btn sec ${done ? 'off' : ''}" data-egg="${k}">${l}</button>`).join('')}</div>
        ${done ? `<div class="small ${care[stage] === 'ok' ? '' : 'mute'}">この段階は世話済み（${care[stage] === 'ok' ? '正解！' : 'はずれ'}）。次の段階まで <span data-remain="${nextAt}">${fmtRemain(nextAt - now())}</span></div>` : `<div class="small mute">段階が変わるまで <span data-remain="${nextAt}">${fmtRemain(nextAt - now())}</span></div>`}
      </div>`;
    }
    const html = `<div class="dim" data-close></div><div class="sheet">
      <div class="row">${sp(spriteKey(sh), 110)}<div class="grow">
        <button class="name-btn" data-act="rename">${esc(sh.name)} <span style="color:${sh.sex === 'f' ? 'var(--red)' : 'var(--blue-ink)'}">${sh.sex === 'f' ? '♀' : '♂'}</span><span class="pen">✎</span></button>
        <div class="row" style="gap:4px;flex-wrap:wrap">${chipsOf(sh)}</div>
        <div class="small mute">生後 ${ageDays(sh, now())}日 ／ ${lifeTxt} ／ ${esc(t?.name ?? '')}${(sh.exp ?? 0) ? ` ／ 遠征 ${sh.exp}回` : ''}</div>
      </div></div>
      ${status}
      ${eggHtml}
      <div class="small mute" style="font-weight:700">遺伝子</div>
      <div class="gene">
        <span class="k">色相</span>${geneCell('hue', sh.genes.hue[0], sh)}${geneCell('hue', sh.genes.hue[1], sh)}
        <span class="k">発色</span>${geneCell('sat', sh.genes.sat[0], sh)}${geneCell('sat', sh.genes.sat[1], sh)}
        <span class="k">模様</span>${geneCell('pat', sh.genes.pat[0], sh)}${geneCell('pat', sh.genes.pat[1], sh)}
      </div>
      <div class="small mute">「？」は図鑑でその色・段階を発見すると開示されます。縞は劣性なので両親が持っていると子に出ます。</div>
      <div class="btns">
        <button class="btn sec ${sellErr ? 'off' : ''}" data-act="sell">出荷 ${coinHtml(priceOf(sh))}</button>
        <button class="btn sec" data-act="move">別の水槽へ</button>
        <button class="btn ${adult && sh.berriedAt == null ? '' : 'off'}" data-act="breed">繁殖に使う</button>
      </div>
    </div>`;
    const wrap = document.createElement('div');
    wrap.id = 'sheet';
    wrap.innerHTML = html;
    root.appendChild(wrap);
    wrap.querySelector('[data-close]').onclick = () => closeSheet();
    wrap.querySelector('[data-act="rename"]').onclick = () => {
      const n = window.prompt('名前を変える', sh.name);
      if (n && n.trim()) { sh.name = n.trim().slice(0, 8); app.mutate(); openSheet(id); }
    };
    wrap.querySelector('[data-act="sell"]').onclick = () => {
      if (sellErr) return;
      const warn = isLastOfSex(S(), sh) ? `\n※ ${t?.name ?? ''} で最後の${sh.sex === 'm' ? '♂' : '♀'}です。売ると繁殖できなくなります。` : '';
      if (!window.confirm(`${sh.name} を ${fmtCoin(priceOf(sh))} で出荷しますか？${warn}`)) return;
      const r = sell(S(), [id], now());
      app.mutate();
      app.toast(`${r.sold[0]} を出荷 +${fmtCoin(r.total)}`);
      coinFx(r.total);
      sheetId = null;
      render();
    };
    wrap.querySelector('[data-act="move"]').onclick = () => openMoveModal(sh);
    wrap.querySelectorAll('[data-egg]').forEach((b) => {
      b.onclick = () => {
        const r = careEgg(S(), sh, b.dataset.egg, now());
        if (r.error) { app.toast(r.error); return; }
        app.mutate();
        app.toast(r.correct ? `正解！ 卵が元気になった（孵化数 +1）` : `うーん、変化なし（正解は「${EGG_CHOICES[r.answer]}」）`);
        openSheet(id);
      };
    });
    wrap.querySelector('[data-act="breed"]').onclick = () => {
      if (!adult || sh.berriedAt != null) return;
      sheetId = null;
      app.go('breed', sh.tankId, { [sh.sex]: sh.id });
    };
  }
  function closeSheet(clear = true) {
    const w = document.getElementById('sheet');
    if (w) w.remove();
    if (clear) { sheetId = null; if (views[0]) views[0].selectedId = null; }
  }

  // 設備スロット・素材の使用
  function openSlotModal(t, which) {
    const s = S();
    const items = s.items ?? {};
    if (which !== 'add') {
      const e = t.equipment[Number(which)];
      openModal(`<h3>${MATERIALS[e.type].name}</h3><div class="panel small">${MATERIALS[e.type].desc}</div><button class="btn sec" data-act="rm">倉庫に戻す</button>`, (box) => {
        box.querySelector('[data-act="rm"]').onclick = () => { removeEquipment(s, t, Number(which)); app.mutate(); closeModal(); render(); };
      });
      return;
    }
    const rows = Object.entries(MATERIALS).map(([k, m]) => {
      const n = items[k] ?? 0;
      const usable = k === 'leaf' ? n > 0 : m.slot ? n > 0 && (t.equipment ?? []).length < 3 : false;
      return `<button class="li ${usable ? '' : 'off'}" data-item="${k}"><img class="li-pic" src="assets/icons/${k}.png" alt=""><div class="nm">${m.name} <span class="chip gray">×${n}</span><small>${m.desc}</small></div><span class="pr">${k === 'leaf' ? '入れる' : m.slot ? '置く' : '—'}</span></button>`;
    }).join('');
    openModal(`<h3>倉庫の素材</h3>${rows}<div class="small mute">素材はエビを川へ送ると持ち帰ります。</div>`, (box) => {
      box.querySelectorAll('[data-item]').forEach((b) => {
        b.onclick = () => {
          const k = b.dataset.item;
          const err = k === 'leaf' ? useLeaf(s, t, now()) : placeEquipment(s, t, k);
          if (err) { app.toast(err); return; }
          app.mutate(); closeModal(); app.toast(`${MATERIALS[k].name}を${k === 'leaf' ? '入れた' : '置いた'}`); render();
        };
      });
    });
  }

  // ---------- 画面: 川へ送る ----------
  let riverSel = new Set();
  let riverDest = 'ditch';
  function river(tankId) {
    const s = S();
    const t = tankOf(tankId);
    if (!t) { app.go('home'); return; }
    const cands = shrimpIn(t).filter((sh) => isAdult(sh, now()) && sh.berriedAt == null);
    for (const id of [...riverSel]) if (!cands.some((c) => c.id === id)) riverSel.delete(id);
    const team = [...riverSel].map((id) => s.shrimp[id]);
    const destCards = Object.entries(DESTS).map(([k, d]) => {
      const locked = (s.reputation ?? 1) < d.rep;
      const cd = s.tripCooldown?.[k] ?? 0;
      const cooling = now() < cd;
      const on = riverDest === k;
      return `<button class="li ${on ? 'sel' : ''} ${locked ? 'off' : ''}" data-dest="${k}"><span class="cb ${on ? 'on' : ''}"></span><div class="nm">${d.name} <span class="chip gray">${d.minTeam}匹〜</span><small>${fmtRemain(d.duration).replace('あと ', '')}で帰還 ／ ${d.desc}${locked ? ` ／ <span style="color:var(--red)">評判Lv${d.rep}で解放</span>` : cooling ? ` ／ <span style="color:var(--amber-ink)">次は <span data-remain="${cd}">${fmtRemain(cd - now())}</span></span>` : ''}</small></div></button>`;
    }).join('');
    const rows = cands.map((sh) => `<button class="li" data-sh="${sh.id}"><span class="cb ${riverSel.has(sh.id) ? 'on' : ''}"></span>${sp(spriteKey(sh), 40)}<div class="nm">${esc(sh.name)}<small>${labelOfKey(dexKey(sh))} ／ ${sh.sex === 'm' ? '♂' : '♀'} ／ 得意：${ROLE_JA[sh.hue] ?? ''}${(sh.exp ?? 0) ? ` ／ 遠征 ${sh.exp}回` : ''}</small></div></button>`).join('');
    const b = teamBonus(team);
    const effects = [];
    if (b.none < 0) effects.push('ハズレが減る');
    if (b.friend > 0) effects.push('仲間が寄る');
    if (b.duration < 1) effects.push(`帰りが早い（−${Math.round((1 - b.duration) * 100)}%）`);
    if (b.cards > 0) effects.push(`カード +${b.cards}`);
    if (b.find > 0) effects.push('拾い物が増える');
    if (b.green > 0) effects.push('危険でも素材を拾う');
    if (b.rare > 1) effects.push('レアな仲間が寄りやすい');
    if (team.some((sh) => sh.sex === 'f')) effects.push('♀は野生の♂と出会って抱卵することがある');
    const err = canSend(s, riverDest, team, now());
    const d = DESTS[riverDest];
    const tr = s.trip;
    const tripCard = tr
      ? `<div class="alert" style="background:#E4EEF7;color:var(--blue-ink)"><span class="grow">🏞 ${tr.ids.map((id) => esc(s.shrimp[id]?.name ?? '')).join('・')} が ${DESTS[tr.dest].name} へ遠征中<br><span class="small">帰還まで <b data-remain="${tr.returnAt}">${fmtRemain(tr.returnAt - now())}</b>。帰ってきたら次を送れます</span></span></div>`
      : '';
    const errText = err === 'いま遠征中です' && tr ? `いま遠征中です（帰還まで <span data-remain="${tr.returnAt}">${fmtRemain(tr.returnAt - now())}</span>）` : err;
    root.innerHTML = `<div class="head"><button class="back" data-back>‹</button>川へ送る<span class="cnt">${esc(t.name)}</span></div>
    <div class="body">
      ${tripCard}
      <div class="small mute" style="font-weight:700;padding:0 2px">行き先</div>
      ${destCards}
      <div class="small mute" style="font-weight:700;padding:0 2px">送るエビ（最大3匹）</div>
      ${rows || '<div class="empty">送れる成体がいません</div>'}
      <div class="panel"><div class="row small" style="font-weight:700"><span class="grow">チームの効果</span><span class="mute">${team.length}匹</span></div><div class="small ${effects.length ? '' : 'mute'}">${effects.length ? effects.join(' ／ ') : 'エビを選ぶと表示されます'}</div></div>
      <div class="sticky" style="flex-direction:column;align-items:stretch;gap:6px">
        <button class="btn ${err ? 'off' : ''}" data-act="go">出発 — ${fmtRemain(Math.round(d.duration * b.duration)).replace('あと ', '')}で帰還</button>
        <div class="small mute" style="text-align:center">${errText ?? '帰ってくるまで水槽から離れます。必ず帰ってきます'}</div>
      </div>
    </div>${tabs('home')}`;
    root.querySelectorAll('[data-dest]').forEach((el) => { el.onclick = () => { if (el.classList.contains('off')) return; riverDest = el.dataset.dest; river(tankId); }; });
    root.querySelectorAll('[data-sh]').forEach((el) => {
      el.onclick = () => {
        const id = el.dataset.sh;
        if (riverSel.has(id)) riverSel.delete(id);
        else if (riverSel.size >= 3) { app.toast('送れるのは3匹までです'); return; }
        else riverSel.add(id);
        river(tankId);
      };
    });
    root.querySelector('[data-act="go"]').onclick = () => {
      if (err) return;
      const ids = [...riverSel];
      const e = sendTrip(s, riverDest, ids, now());
      if (e) { app.toast(e); return; }
      riverSel = new Set();
      app.mutate();
      const teamShrimp = ids.map((id) => s.shrimp[id]).filter(Boolean);
      departScene(teamShrimp, riverDest, () => app.go('home'));
    };
  }

  // ---------- 画面: バケツ（満員で入れられなかった仲間の対処） ----------
  function bucket() {
    const s = S();
    const bk = s.bucket ?? [];
    if (!bk.length) { app.go('home'); return; }
    const spaceTanks = s.tanks.filter((t) => t.shrimpIds.length < t.cap);
    const rows = bk.map((w, i) => `<div class="panel" style="display:flex;flex-direction:column;gap:8px">
        <div class="row">${sp(spriteKey(w), 90)}<div class="grow"><div style="font-weight:700;font-size:15px">${esc(w.name)} <span style="color:${w.sex === 'f' ? 'var(--red)' : 'var(--blue-ink)'}">${w.sex === 'f' ? '♀' : '♂'}</span></div><div class="row" style="gap:4px;flex-wrap:wrap">${chipsOf(w)}</div><div class="small mute">遺伝子は「？」。見た目より中身が良いことがあります</div></div></div>
        <div class="btns">
          <button class="btn ${spaceTanks.length ? '' : 'off'}" data-act="place" data-i="${i}">水槽に入れる</button>
          <button class="btn sec" data-act="swap" data-i="${i}">入れ替える</button>
          <button class="btn sec" data-act="release" data-i="${i}">川に返す</button>
        </div>
      </div>`).join('');
    root.innerHTML = `<div class="head"><button class="back" data-back>‹</button>バケツ<span class="cnt">${bk.length}匹 待機中</span></div>
    <div class="body">
      <div class="alert"><span class="grow">${spaceTanks.length ? `空きのある水槽：${spaceTanks.map((t) => `${esc(t.name)}（${t.cap - t.shrimpIds.length}匹分）`).join('、')}` : 'すべての水槽が満員です。枠を空けるか、入れ替えるか、川に返してください'}</span></div>
      ${rows}
      <div class="panel" style="display:flex;flex-direction:column;gap:6px">
        <div class="small mute" style="font-weight:700">枠を空ける</div>
        <div class="btns"><button class="btn sec" data-go="sell">水槽のエビを出荷する</button><button class="btn sec" data-go="shop">水槽を買う</button></div>
        <div class="small mute">出荷や購入のあと、ホームの「バケツ」から戻ってきて「水槽に入れる」を押してください。</div>
      </div>
    </div>${tabs('home')}`;
    root.querySelectorAll('[data-act="place"]').forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.i);
        if (!spaceTanks.length) return;
        openModal(`<h3>${esc(bk[i].name)} を入れる水槽</h3>${spaceTanks.map((t) => `<button class="li" data-tank="${t.id}"><div class="nm">${esc(t.name)}<small>${t.shrimpIds.length} / ${t.cap}匹</small></div><span class="pr">›</span></button>`).join('')}`, (box) => {
          box.querySelectorAll('[data-tank]').forEach((tb) => {
            tb.onclick = () => {
              const r = bucketPlace(s, i, tankOf(tb.dataset.tank), now());
              if (typeof r === 'string') { app.toast(r); return; }
              app.mutate(); closeModal(); app.toast('水槽に入れた'); app.queueNewKeys(r.newKeys); bucket();
            };
          });
        });
      };
    });
    root.querySelectorAll('[data-act="swap"]').forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.i);
        const cands = Object.values(s.shrimp).filter((x) => !x.away && x.berriedAt == null);
        openModal(`<h3>どのエビを川に放しますか</h3><div class="small mute">放したエビは戻りません。代わりに ${esc(bk[i].name)} がその水槽に入ります。</div>${cands.length ? cands.map((x) => `<button class="li" data-sh="${x.id}">${sp(spriteKey(x), 40)}<div class="nm">${esc(x.name)}<small>${labelOfKey(dexKey(x))} ／ ${x.sex === 'm' ? '♂' : '♀'} ／ ${esc(tankOf(x.tankId)?.name ?? '')}${isLastOfSex(s, x) ? ' ／ <span style="color:var(--amber-ink)">最後の' + (x.sex === 'm' ? '♂' : '♀') + '</span>' : ''}</small></div><span class="pr">${coinHtml(priceOf(x))}</span></button>`).join('') : '<div class="empty">放せるエビがいません</div>'}`, (box) => {
          box.querySelectorAll('[data-sh]').forEach((sb) => {
            sb.onclick = () => {
              const x = s.shrimp[sb.dataset.sh];
              if (!window.confirm(`${x.name} を川に放して、${bk[i].name} を入れますか？`)) return;
              const r = bucketSwap(s, i, x.id, now());
              if (typeof r === 'string') { app.toast(r); return; }
              app.mutate(); closeModal(); app.toast(`${r.released} を川に放して入れ替えた`); app.queueNewKeys(r.newKeys); bucket();
            };
          });
        });
      };
    });
    root.querySelectorAll('[data-act="release"]').forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.i);
        if (!window.confirm(`${bk[i].name} を川に返しますか？`)) return;
        const r = bucketRelease(s, i);
        if (typeof r === 'string') { app.toast(r); return; }
        app.mutate(); app.toast(`${r.released} を川に返した`); bucket();
      };
    });
  }

  // ---------- 演出: 出発（エビが楽しそうに歩く3秒） ----------
  // returning=true のときは帰り道（右から左へ、仲間が後ろに続く）
  function departScene(team, destId, done, { returning = false, friends = [] } = {}) {
    const d = DESTS[destId];
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const total = reduced ? 1.2 : 3.0;
    const el = document.createElement('div');
    el.className = 'depart';
    const names = team.map((sh) => esc(sh.name)).join('・');
    const title = returning ? `${d.name}から帰ってきた！` : `${d.name}へ出発！`;
    const sub = returning ? (friends.length ? `${names} が ${friends.map((f) => esc(f.name || '仲間')).join('・')} を連れて帰ってきた` : `${names} がただいま`) : `${names} が歩いていく`;
    el.innerHTML = `<canvas></canvas><div class="dp-cap"><div class="dp-t">${title}</div><div class="dp-s">${sub}</div></div>`;
    root.appendChild(el);
    const c = el.querySelector('canvas');
    const ctx = c.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const walkers = returning ? [...team, ...friends] : team;
    const imgs = walkers.map((sh) => sprites[spriteKey(sh)]);
    const notes = ['♪', '♫', '♥', '☀'];
    let start = null;
    let raf = 0;
    let finished = false;
    const finish = () => { if (finished) return; finished = true; cancelAnimationFrame(raf); el.remove(); done(); };
    el.onclick = finish;
    function frame(ts) {
      if (!start) start = ts;
      const t = (ts - start) / 1000;
      const r = el.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 空
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#BFE3F2'); sky.addColorStop(0.55, '#E9F5F8'); sky.addColorStop(0.56, '#8CC46E'); sky.addColorStop(1, '#5E9E4C');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
      // 雲（ゆっくり流れる）
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      for (let i = 0; i < 3; i += 1) {
        const cx = ((i * 0.37 + t * 0.02) % 1.2 - 0.1) * w;
        const cy = h * (0.12 + i * 0.08);
        ctx.beginPath(); ctx.ellipse(cx, cy, 34, 12, 0, 0, 6.28); ctx.ellipse(cx + 22, cy - 6, 22, 12, 0, 0, 6.28); ctx.ellipse(cx - 20, cy - 4, 18, 10, 0, 0, 6.28); ctx.fill();
      }
      // 遠くの山
      ctx.fillStyle = '#A9CFA0';
      ctx.beginPath(); ctx.moveTo(0, h * 0.56); ctx.quadraticCurveTo(w * 0.25, h * 0.38, w * 0.5, h * 0.56); ctx.quadraticCurveTo(w * 0.75, h * 0.42, w, h * 0.56); ctx.fill();
      // 川（右下へ流れる帯、きらめき）
      ctx.fillStyle = '#5FB0C8';
      ctx.beginPath(); ctx.moveTo(0, h * 0.86); ctx.quadraticCurveTo(w * 0.5, h * 0.78, w, h * 0.9); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      for (let i = 0; i < 12; i += 1) { const sx = ((i * 0.09 + t * 0.15) % 1) * w; const sy = h * (0.86 + Math.sin(i) * 0.03); ctx.fillRect(sx, sy, 10, 2); }
      // 土の道
      ctx.fillStyle = '#C9A46A';
      ctx.beginPath(); ctx.moveTo(0, h * 0.7); ctx.quadraticCurveTo(w * 0.5, h * 0.66, w, h * 0.72); ctx.lineTo(w, h * 0.8); ctx.quadraticCurveTo(w * 0.5, h * 0.75, 0, h * 0.78); ctx.fill();
      // エビたち（左から右へ、ぴょこぴょこ）
      const prog = Math.min(1, t / total);
      const spw = Math.min(110, w * 0.26);
      const sph = spw * 0.555;
      walkers.forEach((sh, i) => {
        const isFriend = i >= team.length;
        const scale = isFriend ? 0.8 : 1;
        // 行きは左→右、帰りは右→左
        const xf = spw * 0.6 + (w + spw) * prog - i * spw * 0.9;
        const x = returning ? w - xf : xf;
        const hop = Math.abs(Math.sin(t * 7 + i * 1.3)) * 10;
        const y = h * 0.735 - i * 6 - hop;
        const tilt = Math.sin(t * 7 + i * 1.3) * 0.12;
        ctx.save();
        ctx.translate(x, y);
        if (returning) ctx.scale(-1, 1);
        ctx.rotate(-tilt);
        ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 3;
        const img = imgs[i];
        if (img) ctx.drawImage(img, -spw * scale / 2, -sph * scale / 2, spw * scale, sph * scale);
        ctx.restore();
        // 音符・ハート
        const k = Math.floor(t * 1.5 + i) % notes.length;
        const nt = (t * 1.5 + i) % 1;
        ctx.fillStyle = `rgba(220,80,60,${1 - nt})`;
        ctx.font = '700 18px sans-serif';
        ctx.fillText(notes[k], x + spw * 0.25, y - sph * 0.7 - nt * 24);
      });
      if (t < total + 0.2) raf = requestAnimationFrame(frame);
      else finish();
    }
    raf = requestAnimationFrame(frame);
    // 裏に回って描画が止まっても必ず閉じる
    setTimeout(finish, (total + 0.6) * 1000);
  }

  // ---------- 演出: 遠征記録の開封 ----------
  function record(ev, done) {
    const s = S();
    const trip = ev.trip;
    // まず「帰ってきた」演出（3秒）、そのあと記録カード
    if (!ev._walked) {
      ev._walked = true;
      const team = trip.ids.map((id) => s.shrimp[id]).filter(Boolean);
      const friends = trip.cards.filter((c) => c.type === 'friend' && !c.stayed).map((c) => c.shrimp);
      departScene(team, trip.dest, () => record(ev, done), { returning: true, friends });
      return;
    }
    const d = DESTS[trip.dest];
    const names = trip.ids.map((id) => s.shrimp[id]?.name ?? '').join('・');
    const el = document.createElement('div');
    el.className = 'record';
    const cardHtml = trip.cards.map((c, i) => {
      let front = '';
      if (c.type === 'find') front = `<div class="rc-ico"><img src="assets/icons/coin.png" alt="コイン"></div><div class="rc-t">${esc(c.item)}</div><div class="rc-s">+${coinHtml(c.yen)}</div>`;
      else if (c.type === 'material' || (c.type === 'danger' && c.item)) front = `<div class="rc-ico">🍂</div><div class="rc-t">${MATERIALS[c.item].name}</div><div class="rc-s">倉庫へ</div>`;
      else if (c.type === 'friend') front = `${sp(spriteKey(c.shrimp), 90)}<div class="rc-t">${c.boss ? 'ヌシ！' : `${esc(c.shrimp.name || '仲間')}`}</div><div class="rc-s">${c.stayed ? 'バケツも満杯で川に残った' : c.bucket ? `${labelOfKey(dexKey(c.shrimp))} ／ 水槽が満員なのでバケツで待機` : `${labelOfKey(dexKey(c.shrimp))} ／ ${esc(c.tankName ?? '')}へ`}</div>`;
      else if (c.type === 'mate') front = `<div class="rc-ico">🥚</div><div class="rc-t">野生の♂と出会った</div><div class="rc-s">${esc(s.shrimp[c.motherId]?.name ?? '')} が抱卵</div>`;
      else if (c.type === 'danger') front = `<div class="rc-ico">🐟</div><div class="rc-t">メダカに追われた</div><div class="rc-s">逃げ切った（経験 +${c.exp}）</div>`;
      else front = `<div class="rc-ico">💤</div><div class="rc-t">何もなし</div><div class="rc-s">${esc(c.text)}</div>`;
      return `<button class="rc" data-i="${i}"><div class="rc-in"><div class="rc-back"><img class="chest" src="assets/icons/chest_closed.png" alt=""><span class="tap">タップ</span></div><div class="rc-front"><img class="chest-open" src="assets/icons/chest_open.png" alt="">${front}</div></div></button>`;
    }).join('');
    const sum = tripSummary(trip);
    el.innerHTML = `<div class="rec-head"><div class="ttl">遠征記録 — ${d.name}${ev.replay ? '（見返し）' : ''}</div><div class="sub">${esc(names)} が帰ってきた。宝箱をタップして開けよう</div></div>
      <div class="rc-grid">${cardHtml}</div>
      <div class="rec-sum panel small">まとめ：${coinHtml(sum.yen)} ／ 素材 ${sum.materials} ／ 仲間 ${sum.friends}${sum.mate ? ' ／ 抱卵あり' : ''}</div>
      <button class="btn red" data-act="close">閉じる</button>`;
    root.appendChild(el);
    let opened = 0;
    el.querySelectorAll('.rc').forEach((b) => {
      b.onclick = () => { if (b.classList.contains('open')) return; b.classList.add('open'); opened += 1; if (opened === trip.cards.length) el.querySelector('.rec-sum').classList.add('show'); };
    });
    el.querySelector('[data-act="close"]').onclick = () => { el.remove(); done(); };
  }

  function openMoveModal(sh) {
    const s = S();
    const others = s.tanks.filter((t) => t.id !== sh.tankId);
    openModal(`<h3>${esc(sh.name)} を移す水槽</h3>${others.length ? others.map((t) => `<button class="li ${t.shrimpIds.length >= t.cap ? 'off' : ''}" data-tank="${t.id}"><div class="nm">${esc(t.name)}<small>${t.shrimpIds.length} / ${t.cap}匹</small></div><span class="pr">›</span></button>`).join('') : '<div class="empty">他の水槽がありません。ショップで増設できます</div>'}`, (box) => {
      box.querySelectorAll('[data-tank]').forEach((b) => {
        b.onclick = () => {
          const err = moveShrimp(s, sh, tankOf(b.dataset.tank));
          if (err) { app.toast(err); return; }
          app.mutate();
          closeModal();
          sheetId = null;
          app.toast(`${sh.name} を移した`);
          render();
        };
      });
    });
  }

  // ---------- 画面: 繁殖 ----------
  let breedSel = { m: null, f: null };
  function breed(tankId, pre) {
    const t = tankOf(tankId);
    if (!t) { app.go('home'); return; }
    if (pre) breedSel = { m: pre.m ?? breedSel.m, f: pre.f ?? breedSel.f };
    const s = S();
    const m = s.shrimp[breedSel.m];
    const f = s.shrimp[breedSel.f];
    if (m && m.tankId !== t.id) breedSel.m = null;
    if (f && f.tankId !== t.id) breedSel.f = null;
    const mm = s.shrimp[breedSel.m];
    const ff = s.shrimp[breedSel.f];
    const slot = (sex, sh) => sh
      ? `<button class="pslot" data-pick="${sex}"><span class="sex ${sex}">${sex === 'm' ? '♂ オス' : '♀ メス'}</span>${sp(spriteKey(sh), 84)}<span class="id">${esc(sh.name)}</span><div class="row" style="gap:3px">${chipsOf(sh)}</div><span class="small mute">変更 ›</span></button>`
      : `<button class="pslot empty" data-pick="${sex}"><span class="sex ${sex}">${sex === 'm' ? '♂ オス' : '♀ メス'}</span><span>タップして選ぶ</span></button>`;
    let probs = '';
    if (mm && ff) {
      const pred = predictChildren(ff, mm, 400);
      let unknown = 0;
      const rows = [];
      for (const { key, p } of pred) {
        if (s.dex[key]) rows.push(`<div class="prob">${sp(key, 30)}<span class="lab">${labelOfKey(key).replace(/ (薄|中|濃|縞|輝)$/, '')}</span><div class="bar"><i style="width:${Math.round(p * 100)}%"></i></div><span class="pc">${Math.round(p * 100)}%</span></div>`);
        else unknown += p;
      }
      if (unknown > 0.005) rows.push(`<div class="prob"><span class="sw">?</span><span class="lab mute">未発見</span><div class="bar"><i class="q" style="width:${Math.round(unknown * 100)}%"></i></div><span class="pc mute">${Math.round(unknown * 100)}%</span></div>`);
      probs = `<div class="panel" style="display:flex;flex-direction:column;gap:6px"><div class="row small" style="font-weight:700"><span class="grow">子の予想（1回で 4〜8匹）</span></div>${rows.join('')}<div class="small mute">★5 は濃×濃の子にごく稀に。確率は表示しません。</div></div>`;
    }
    const err = pairError(s, mm, ff, now());
    const conds = [
      ['同じ水槽', mm && ff ? mm.tankId === ff.tankId : null],
      ['両方とも成体', mm && ff ? isAdult(mm, now()) && isAdult(ff, now()) : null],
      ['抱卵中でない', ff ? ff.berriedAt == null : null],
      ['餌が足りている', t.food >= 20],
    ].map(([l, ok]) => `<span class="${ok === null ? '' : ok ? 'ok' : 'ng'}">${l}</span>`).join('');
    const ms = s.flags.firstBreedDone ? T.hatch : T.firstHatch;
    root.innerHTML = `<div class="head"><button class="back" data-back>‹</button>繁殖ペアを組む<span class="cnt">${esc(t.name)}</span></div>
    <div class="body">
      <div class="pair">${slot('m', mm)}<span class="x">×</span>${slot('f', ff)}</div>
      ${probs}
      <div class="panel"><div class="cond">${conds}</div></div>
      <div style="margin-top:auto;display:flex;flex-direction:column;gap:6px">
        <button class="btn red ${err ? 'off' : ''}" data-act="pair">ペア成立 — 孵化まで ${fmtRemain(ms).replace('あと ', '')}</button>
        <div class="small mute" style="text-align:center">${err ?? (s.flags.firstBreedDone ? '寝る前に組むと朝に生まれます' : '最初の1回だけ孵化が早まります')}</div>
      </div>
    </div>${tabs('home')}`;
    root.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => openPickModal(t, b.dataset.pick); });
    root.querySelector('[data-act="pair"]').onclick = () => {
      if (err) return;
      const e = pair(s, mm, ff, now());
      if (e) { app.toast(e); return; }
      app.mutate();
      app.toast(`${ff.name} が抱卵した`);
      breedSel = { m: null, f: null };
      app.back();
    };
  }
  function openPickModal(t, sex) {
    const s = S();
    const cands = shrimpIn(t).filter((sh) => sh.sex === sex);
    openModal(`<h3>${sex === 'm' ? '♂ オス' : '♀ メス'}を選ぶ</h3>${cands.length ? cands.map((sh) => {
      const bad = !isAdult(sh, now()) ? '稚エビ' : sh.berriedAt != null ? '抱卵中' : '';
      return `<button class="li ${bad ? 'off' : ''}" data-sh="${sh.id}">${sp(spriteKey(sh), 40)}<div class="nm">${esc(sh.name)}<small>${labelOfKey(dexKey(sh))} ／ 生後${ageDays(sh, now())}日${bad ? ` ／ <span style="color:var(--red)">${bad}</span>` : ''}</small></div><span class="pr">›</span></button>`;
    }).join('') : `<div class="empty">この水槽に${sex === 'm' ? 'オス' : 'メス'}がいません</div>`}`, (box) => {
      box.querySelectorAll('[data-sh]').forEach((b) => {
        b.onclick = () => { breedSel[sex] = b.dataset.sh; closeModal(); breed(t.id); };
      });
    });
  }

  // ---------- 画面: 出荷 ----------
  let sellSel = new Set();
  let sellTank = 'all';
  function sellScreen() {
    const s = S();
    const v = s.visitor;
    const vmode = app.current().id === 'visitor' && !!v; // 客に渡すモード
    const remainCount = vmode ? v.want.count - v.delivered : Infinity;
    const priceFn = (sh) => (vmode ? visitorPrice(sh, v) : priceOf(sh));
    const errFn = (sh) => {
      const e = sellError(sh, now());
      if (e || !vmode) return e;
      return matchesWant(sh, v.want, now()) ? null : '希望に合いません';
    };
    const all = Object.values(s.shrimp).filter((sh) => sellTank === 'all' || sh.tankId === sellTank);
    const list = all.sort((a, b) => (errFn(a) ? 1 : 0) - (errFn(b) ? 1 : 0) || priceFn(b) - priceFn(a));
    for (const id of [...sellSel]) if (!s.shrimp[id] || errFn(s.shrimp[id])) sellSel.delete(id);
    const total = [...sellSel].reduce((a, id) => a + priceFn(s.shrimp[id]), 0);
    const rows = list.map((sh) => {
      const err = errFn(sh);
      const last = !err && isLastOfSex(s, sh) ? `<span class="chip amber">最後の${sh.sex === 'm' ? '♂' : '♀'}</span>` : '';
      const rare = !err && tierOf(sh) >= 4 ? '<span class="chip amber">貴重</span>' : '';
      return `<button class="li ${err ? 'off' : ''}" data-sh="${sh.id}"><span class="cb ${sellSel.has(sh.id) ? 'on' : ''}"></span>${sp(spriteKey(sh), 40)}<div class="nm">${esc(sh.name)}<small>${labelOfKey(dexKey(sh))} ／ ${sh.sex === 'm' ? '♂' : '♀'} ／ ${esc(tankOf(sh.tankId)?.name ?? '')}${err ? ` ／ <span style="color:var(--red)">${err.replace('は出荷できません', '')}</span>` : ''} ${last}${rare}</small></div><span class="pr">${err ? '—' : coinHtml(priceFn(sh))}</span></button>`;
    }).join('');
    const header = vmode
      ? `<div class="alert teal"><span class="grow"><b>${esc(v.name)}</b>：${wantLabel(v.want)} ／ 相場の ${v.want.mult}倍<br><span class="small">あと ${remainCount}匹 ／ <span data-remain="${v.leavesAt}">${fmtRemain(v.leavesAt - now())}</span>で帰ります</span></span><button class="chip off" data-mode="free">自由出荷へ</button></div>`
      : `<div class="row small" style="font-weight:700;padding:0 2px"><span class="grow" style="white-space:nowrap">自由出荷</span><span class="mute" style="text-align:right">相場：${[1, 2, 3, 4].map((t) => `★${t} ${coinHtml(120 * TIER_MULT[t])}`).join(' ／ ')}</span></div>${v ? `<button class="alert teal" data-mode="visitor"><span class="grow"><b>${esc(v.name)}</b> が待っています：${wantLabel(v.want)}（相場の ${v.want.mult}倍）</span><span>›</span></button>` : ''}`;
    root.innerHTML = `${top()}<div class="body">
      ${header}
      <div class="chips"><button class="chip ${sellTank === 'all' ? '' : 'off'}" data-tank="all">すべて</button>${s.tanks.map((t) => `<button class="chip ${sellTank === t.id ? '' : 'off'}" data-tank="${t.id}">${esc(t.name)}</button>`).join('')}</div>
      ${rows || '<div class="empty">出荷できるエビがいません</div>'}
      <div class="sticky"><div class="grow"><div style="font-weight:700">選択 ${sellSel.size}匹${vmode ? ` / ${remainCount}` : ''}</div><div class="small mute">合計 ${coinHtml(total)}</div></div><button class="btn ${sellSel.size ? '' : 'off'}" data-act="sell">${vmode ? '客に渡す' : '出荷する'}</button></div>
    </div>${tabs('sell')}`;
    root.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); sellSel = new Set(); app.go('sell', b.dataset.mode === 'visitor' ? 'visitor' : undefined); }; });
    root.querySelectorAll('[data-tank]').forEach((b) => { b.onclick = () => { sellTank = b.dataset.tank; sellScreen(); }; });
    root.querySelectorAll('[data-sh]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.sh;
        if (errFn(s.shrimp[id])) return;
        if (sellSel.has(id)) sellSel.delete(id);
        else if (sellSel.size < remainCount) sellSel.add(id);
        else { app.toast(`客が欲しいのは あと${remainCount}匹です`); return; }
        sellScreen();
      };
    });
    root.querySelector('[data-act="sell"]').onclick = () => {
      if (!sellSel.size) return;
      if (vmode) {
        const r = deliver(s, [...sellSel], now());
        sellSel = new Set();
        if (r.error) { app.toast(r.error); sellScreen(); return; }
        app.mutate();
        app.toast(`${v.name} に ${r.sold.length}匹 +${fmtCoin(r.total)}${r.levelUp ? ` ／ 評判 Lv${r.levelUp} に！` : ''}`);
        coinFx(r.total);
        if (r.done) app.go('home'); else sellScreen();
        return;
      }
      const names = [...sellSel].map((id) => s.shrimp[id]);
      const lastWarn = names.filter((sh) => isLastOfSex(s, sh)).map((sh) => sh.name);
      const rareWarn = names.filter((sh) => tierOf(sh) >= 4).map((sh) => sh.name);
      let msg = `${sellSel.size}匹を ${fmtCoin(total)} で出荷しますか？`;
      if (lastWarn.length) msg += `\n※ 水槽で最後の♂/♀: ${lastWarn.join('、')}`;
      if (rareWarn.length) msg += `\n※ ★4以上の貴重な個体: ${rareWarn.join('、')}`;
      if (!window.confirm(msg)) return;
      const r = sell(s, [...sellSel], now());
      sellSel = new Set();
      app.mutate();
      app.toast(`${r.sold.length}匹を出荷 +${fmtCoin(r.total)}`);
      coinFx(r.total);
      sellScreen();
    };
  }

  // ---------- 画面: 図鑑 ----------
  function dex() {
    const s = S();
    const found = ALL_DEX_KEYS.filter((k) => s.dex[k]).length;
    const cell = (k) => {
      const d = s.dex[k];
      const isNew = d && d.count === 1 && now() - d.foundAt < 3600000;
      return `<button class="c ${d ? (k.endsWith('5') ? 't5' : '') : 'q'}" data-key="${k}">${sp(k, 0, d ? '' : 'silhouette').replace('width:0px', 'width:92%')}${isNew ? '<span class="badge" style="top:2px;right:3px;font-size:8px;padding:1px 4px">NEW</span>' : ''}</button>`;
    };
    const rowsHtml = [['r', '赤'], ['b', '青'], ['y', '黄'], ['k', '黒'], ['g', '緑']].map(([c, ja]) => `<span class="rh">${ja}</span>${[1, 2, 3, 4, 5].map((t) => cell(`${c}${t}`)).join('')}`).join('');
    const hidden = ['clear', 'choco', 'white', 'purple', 'gold'].map((h) => `<button class="hc ${s.dex[`h_${h}`] ? '' : 'q'}" data-key="h_${h}">${sp(`h_${h}`, 0, s.dex[`h_${h}`] ? '' : 'silhouette').replace('width:0px', 'width:88%')}</button>`).join('');
    root.innerHTML = `<div class="top"><span style="font-weight:700;font-size:16px">図鑑</span><span class="rep"><b style="color:var(--teal)">${found}</b> / ${ALL_DEX_KEYS.length} 種</span></div>
    <div class="body">
      <div class="dex"><span></span>${[1, 2, 3, 4, 5].map((t) => `<span class="h"><b>★${t}</b>${TIER_JA[t]}</span>`).join('')}${rowsHtml}</div>
      <div class="panel" style="display:flex;flex-direction:column;gap:6px"><div class="row small" style="font-weight:700"><span class="grow">隠し色</span><span class="mute">${['clear', 'choco', 'white', 'purple', 'gold'].filter((h) => s.dex[`h_${h}`]).length} / 5</span></div><div class="hidden-row">${hidden}</div><div class="small mute">ヒント：赤と青、赤と黒、黄と黒の子に、ごく稀に…</div></div>
      <div class="panel small mute">段階の出し方：薄×薄は薄、濃×濃で濃が固定。縞は両親が持っているときだけ。輝は濃×濃の子に稀に出て、遺伝しません。</div>
    </div>${tabs('dex')}`;
    root.querySelectorAll('[data-key]').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.key;
        const d = s.dex[k];
        openModal(`<h3>${labelOfKey(k)}</h3><div style="text-align:center;padding:6px">${sp(k, 220, d ? '' : 'silhouette')}</div>${d ? `<div class="panel small">発見日：${new Date(d.foundAt).toLocaleDateString('ja-JP')}（最初の1匹：${esc(d.first)}）<br>これまでに ${d.count}匹 生まれた<br>出荷価格：${coinHtml(k.startsWith('h_') ? 720 : 120 * TIER_MULT[k[1]])}</div>` : '<div class="panel small mute">まだ発見していません。' + hintFor(k) + '</div>'}`);
      };
    });
  }
  function hintFor(k) {
    if (k.startsWith('h_')) return '特定の色同士の子に、ごく稀に。';
    const t = Number(k[1]);
    if (t === 1) return 'この色の個体が生まれれば登録されます。';
    if (t === 2) return '薄×薄の子は半分ほどが中になります。';
    if (t === 3) return '中×中、または中×濃から。';
    if (t === 4) return '縞の遺伝子を持つ親同士から。';
    return '濃×濃の子に、ごく稀に。';
  }

  // ---------- 画面: ショップ ----------
  function shop() {
    const s = S();
    const item = (type) => {
      const d = TANK_TYPES[type];
      const locked = type === 's60' && s.reputation < 5;
      const cant = s.money < d.price;
      return `<div class="item"><span class="ic pic"><img src="assets/icons/${type}.png" alt=""></span><div class="nm">${d.name}<small>${d.cap}匹まで${locked ? ' ／ 評判Lv5で解放' : ''}</small></div><button class="buy ${locked || cant ? 'off' : ''}" data-buy="${type}">${locked ? 'Lv5' : coinHtml(d.price)}</button></div>`;
    };
    root.innerHTML = `<div class="top"><span style="font-weight:700;font-size:16px">ショップ</span><span class="money" style="font-weight:700">${coinHtml(s.money)}</span></div>
    <div class="body">
      <div class="small mute" style="font-weight:700;padding:0 2px">水槽</div>
      ${item('pla')}${item('s30')}${item('s60')}
      <div class="small mute" style="font-weight:700;padding:4px 2px 0">遠征の道具</div>
      <div class="item"><span class="ic pic"><img src="assets/icons/bucket.png" alt=""></span><div class="nm">大きいバケツ<small>連れて帰れる仲間が +1匹</small></div><button class="buy ${s.gear?.bucket ? 'off' : s.money < 1200 ? 'off' : ''}" data-gear="bucket">${s.gear?.bucket ? '購入済み' : coinHtml(1200)}</button></div>
      <div class="small mute" style="font-weight:700;padding:4px 2px 0">倉庫</div>
      <div class="stock">${Object.entries(MATERIALS).map(([k, m]) => `<div class="stock-item ${(s.items?.[k] ?? 0) ? '' : 'none'}"><img src="assets/icons/${k}.png" alt=""><span class="n">×${s.items?.[k] ?? 0}</span><span class="l">${m.name}</span></div>`).join('')}</div>
      <div class="item"><span class="ic pic"><img src="assets/icons/molt.png" alt=""></span><div class="nm">脱皮殻を売る<small>5個で ${coinHtml(300)}（所持 ${s.items?.molt ?? 0}）</small></div><button class="buy ${(s.items?.molt ?? 0) < 5 ? 'off' : ''}" data-act="molt">売る</button></div>
      <div class="small mute" style="font-weight:700;padding:4px 2px 0">セーブデータ</div>
      <div class="panel" style="display:flex;flex-direction:column;gap:6px"><div class="small mute">別のスマホやPCへ水槽を引き継ぐときに使います。</div><div class="btns"><button class="btn sec" data-act="export">書き出す</button><button class="btn sec" data-act="import">読み込む</button></div></div>
      <div class="panel small mute" style="margin-top:auto">★3以上の親は売っていません。濃・縞・輝は自分で繁殖して出します。</div>
    </div>${tabs('shop')}`;
    root.querySelector('[data-act="export"]').onclick = () => openSaveModal('export');
    root.querySelector('[data-act="import"]').onclick = () => openSaveModal('import');
    root.querySelector('[data-gear="bucket"]').onclick = () => {
      if (s.gear?.bucket || s.money < 1200) return;
      if (!window.confirm('大きいバケツを 1,200コイン で購入しますか？')) return;
      s.money -= 1200; s.gear = { ...(s.gear ?? {}), bucket: true }; app.mutate(); app.toast('大きいバケツを買った'); shop(); coinFx(-1200);
    };
    root.querySelector('[data-act="molt"]').onclick = () => { const e = sellMolt(s); if (e) { app.toast(e); return; } app.mutate(); app.toast('脱皮殻を売った +300コイン'); shop(); coinFx(300); };
    root.querySelectorAll('[data-buy]').forEach((b) => {
      b.onclick = () => {
        const type = b.dataset.buy;
        const d = TANK_TYPES[type];
        if (s.money < d.price) return;
        if (!window.confirm(`${d.name} を ${fmtCoin(d.price)} で購入しますか？`)) return;
        s.money -= d.price;
        const t = addTank(s, type, now());
        app.mutate();
        app.toast(`${t.name} を設置した`); coinFx(-d.price);
        shop();
      };
    });
  }

  // ---------- セーブの書き出し・読み込み ----------
  function openSaveModal(mode) {
    if (mode === 'export') {
      const text = app.exportSave();
      openModal(`<h3>セーブを書き出す</h3><div class="small mute">この文字列を全部コピーして、別の端末の「読み込む」に貼り付けてください。</div>
        <textarea class="save-box" readonly>${esc(text)}</textarea>
        <button class="btn" data-act="copy">コピーする</button><div class="small mute" id="copy-msg" style="text-align:center"></div>`, (box) => {
        const ta = box.querySelector('textarea');
        ta.onclick = () => ta.select();
        box.querySelector('[data-act="copy"]').onclick = async () => {
          try { await navigator.clipboard.writeText(text); box.querySelector('#copy-msg').textContent = 'コピーしました'; }
          catch { ta.select(); box.querySelector('#copy-msg').textContent = '選択したので長押しでコピーしてください'; }
        };
      });
      return;
    }
    openModal(`<h3>セーブを読み込む</h3><div class="small" style="color:var(--red);font-weight:700">いまの水槽は上書きされます。</div>
      <textarea class="save-box" placeholder="ここに貼り付け"></textarea>
      <button class="btn red" data-act="load">読み込んで置き換える</button>`, (box) => {
      box.querySelector('[data-act="load"]').onclick = async () => {
        const text = box.querySelector('textarea').value.trim();
        if (!text) { app.toast('貼り付けてください'); return; }
        if (!window.confirm('いまのセーブを置き換えます。よろしいですか？')) return;
        const err = await app.importSave(text);
        if (err) app.toast(err);
      };
    });
  }

  // ---------- 演出: 新色発見 ----------
  function reveal(ev, done) {
    const s = S();
    const key = ev.key;
    const found = ALL_DEX_KEYS.filter((k) => s.dex[k]).length;
    const t5 = key.endsWith('5');
    const el = document.createElement('div');
    el.className = `reveal ${t5 ? 't5' : ''}`;
    el.innerHTML = `<div class="ray"></div><div class="ttl">${t5 ? '伝説のエビが生まれた！' : '新しい色が生まれた！'}</div>${sp(key, 0).replace('width:0px', 'width:min(72%,300px)')}<div class="nm">${labelOfKey(key)}${ev.name ? ` — ${esc(ev.name)}` : ''}</div>
      <div class="row" style="gap:4px;position:relative;justify-content:center"><span class="chip star">${found} / ${ALL_DEX_KEYS.length} 種目</span></div>
      <div class="sub">${esc(ev.tankName ?? '')} の ${esc(ev.mother ?? '')} と ${esc(ev.father ?? '')} の子</div>
      <button class="btn red">図鑑に登録する</button><div class="sub" style="font-weight:700">画面をタップでスキップ</div>`;
    root.appendChild(el);
    const close = () => { el.remove(); done(); };
    el.querySelector('.btn').onclick = (e) => { e.stopPropagation(); close(); };
    el.onclick = close;
  }

  // ---------- モーダル / トースト ----------
  function openModal(html, bind) {
    closeModal();
    const m = document.createElement('div');
    m.className = 'modal';
    m.id = 'modal';
    m.innerHTML = `<div class="box">${html}</div>`;
    m.onclick = (e) => { if (e.target === m) closeModal(); };
    root.appendChild(m);
    if (bind) bind(m.querySelector('.box'));
    modal = m;
  }
  function closeModal() { if (modal) { modal.remove(); modal = null; } }
  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 2300);
  }

  // コインの増減演出（3秒）。増: メダルの雨 / 減: 回って吸い込まれる。操作は邪魔しない
  function coinFx(delta) {
    const d = Math.round(delta);
    if (!d) return;
    root.querySelectorAll('.coinfx').forEach((e) => e.remove());
    const kind = d > 0 ? 'get' : 'spend';
    const el = document.createElement('div');
    el.className = `coinfx ${kind}`;
    el.innerHTML = `<div class="fx-flash"></div><img class="fx-pic" src="assets/fx/coin_${kind}.png" alt=""><div class="fx-delta">${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString('ja-JP')}</div>`;
    const n = 14;
    for (let i = 0; i < n; i += 1) {
      const p = document.createElement('img');
      p.src = 'assets/icons/coin.png';
      p.className = 'fx-pt';
      let x, y, w, dur;
      if (kind === 'get') { x = (Math.random() - 0.5) * 280; y = 60 + Math.random() * 90; w = Math.random() * 1.6; dur = 1 + Math.random() * 0.5; }
      else { const a = (i / n) * 6.28; const r = 60 + Math.random() * 90; x = Math.cos(a) * r; y = Math.sin(a) * r - 30; w = 1.3 + Math.random() * 0.8; dur = 0.6 + Math.random() * 0.4; }
      p.style.setProperty('--x', `${x}px`);
      p.style.setProperty('--y', `${y}px`);
      p.style.setProperty('--r', `${(Math.random() - 0.5) * 720}deg`);
      p.style.setProperty('--w', `${w}s`);
      p.style.setProperty('--d', `${dur}s`);
      el.appendChild(p);
    }
    // 呼び出し元が直後に画面を作り直す（shop()/sellScreen() など）ので、その後に載せる
    setTimeout(() => { root.appendChild(el); setTimeout(() => el.remove(), 3000); }, 0);
  }

  // ---------- Canvas の取り付け ----------
  function mountCanvases(mini) {
    views.length = 0;
    root.querySelectorAll('canvas[data-tank]').forEach((c) => {
      const v = new TankView(c, { mini, motion });
      v.setTank(S(), tankOf(c.dataset.tank));
      views.push(v);
    });
  }

  // ---------- ルーティング ----------
  function render() {
    const cur = app.current();
    closeModal();
    closeSheet(false);
    if (cur.screen !== 'tank') sheetId = null;
    // 演出（新色発見・遠征記録）は画面を作り直しても残す
    const overlays = [...root.querySelectorAll('.reveal, .record, .depart, .coinfx')];
    switch (cur.screen) {
      case 'tank': tank(cur.id); break;
      case 'breed': breed(cur.id, cur.params); break;
      case 'river': river(cur.id); break;
      case 'bucket': bucket(); break;
      case 'sell': sellScreen(); break;
      case 'dex': dex(); break;
      case 'shop': shop(); break;
      default: home();
    }
    for (const el of overlays) root.appendChild(el);
  }

  root.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) { app.go(go.dataset.go, go.dataset.id || undefined); return; }
    const back = e.target.closest('[data-back]');
    if (back) app.back();
  });

  // 1秒ごとの軽い更新（残り時間・ゲージ）。DOMは作り直さない。
  function refresh() {
    const n = now();
    root.querySelectorAll('[data-remain]').forEach((el) => { el.textContent = fmtRemain(Number(el.dataset.remain) - n); });
    const cur = app.current();
    if (cur.screen === 'tank') {
      const t = tankOf(cur.id);
      if (!t) return;
      const g = root.querySelector('[data-g="dirt"]');
      if (g) {
        const v = Math.round(t.dirt);
        g.querySelector('i').style.width = `${v}%`;
        g.querySelector('i').className = v >= 80 ? 'bad' : v >= 60 ? 'warn' : '';
        g.querySelector('.val').textContent = `${v}%`;
      }
    }
  }

  // 毎フレーム: 水槽の描画
  function frame(dt) {
    const n = now();
    for (const v of views) { v.resize(); v.update(dt, n); v.draw(n); }
  }

  return { render, refresh, frame, toast, coinFx, reveal, record, replayRecord, motion };
}
