// オフラインでも遊べるようにするサービスワーカー。
// 画像はキャッシュ優先、HTML/JS/CSS はネットワーク優先（更新をすぐ反映）。
const CACHE = 'ebi-breeder-v4';
const ASSETS = [
  ".",
  "index.html",
  "css/style.css",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "js/assets.js",
  "js/economy.js",
  "js/genetics.js",
  "js/main.js",
  "js/render.js",
  "js/river.js",
  "js/sim.js",
  "js/state.js",
  "js/ui.js",
  "js/visitors.js",
  "assets/shrimp/b1.png",
  "assets/shrimp/b2.png",
  "assets/shrimp/b3.png",
  "assets/shrimp/b4.png",
  "assets/shrimp/b5.png",
  "assets/shrimp/g1.png",
  "assets/shrimp/g2.png",
  "assets/shrimp/g3.png",
  "assets/shrimp/g4.png",
  "assets/shrimp/g5.png",
  "assets/shrimp/h_choco.png",
  "assets/shrimp/h_clear.png",
  "assets/shrimp/h_gold.png",
  "assets/shrimp/h_purple.png",
  "assets/shrimp/h_white.png",
  "assets/shrimp/k1.png",
  "assets/shrimp/k2.png",
  "assets/shrimp/k3.png",
  "assets/shrimp/k4.png",
  "assets/shrimp/k5.png",
  "assets/shrimp/r1.png",
  "assets/shrimp/r2.png",
  "assets/shrimp/r3.png",
  "assets/shrimp/r4.png",
  "assets/shrimp/r5.png",
  "assets/shrimp/s_baby.png",
  "assets/shrimp/s_berried.png",
  "assets/shrimp/y1.png",
  "assets/shrimp/y2.png",
  "assets/shrimp/y3.png",
  "assets/shrimp/y4.png",
  "assets/shrimp/y5.png",
  "assets/icons/breed.png",
  "assets/icons/bucket.png",
  "assets/icons/chest_closed.png",
  "assets/icons/chest_open.png",
  "assets/icons/feed.png",
  "assets/icons/leaf.png",
  "assets/icons/molt.png",
  "assets/icons/pla.png",
  "assets/icons/river.png",
  "assets/icons/s30.png",
  "assets/icons/s60.png",
  "assets/icons/snail.png",
  "assets/icons/stone.png",
  "assets/icons/water.png",
  "assets/icons/wood.png",
  "assets/icons/view_side.png",
  "assets/icons/view_top.png",
  "assets/icons/coin.png",
  "assets/fx/coin_get.png",
  "assets/fx/coin_spend.png"
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  const isCode = /\.(html|js|css|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');
  if (isCode) {
    // ネットワーク優先。失敗したらキャッシュ
    e.respondWith(fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request)));
  } else {
    // 画像はキャッシュ優先
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    })));
  }
});
