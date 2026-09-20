// 保存と読み込み。IndexedDB を使い、使えなければ localStorage に落とす。
// セーブデータには version を持たせ、古い形式は migrate で変換する。
const DB_NAME = 'ebi-breeder';
const STORE = 'save';
const KEY = 'main';
const LS_KEY = 'ebi-breeder:save';
export const SAVE_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no idb')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function migrate(data) {
  if (!data || typeof data !== 'object') return null;
  const d = { ...data };
  if (!d.version) d.version = 1;
  // 将来: if (d.version === 1) { ...変換...; d.version = 2; }
  if (d.version !== SAVE_VERSION) return null;
  if (!d.flags) d.flags = { firstBreedDone: false, firstHatchDone: false };
  if (!d.dex) d.dex = {};
  if (!d.log) d.log = [];
  if (d.repPoints == null) d.repPoints = 0;
  if (d.visitor === undefined) d.visitor = null;
  if (d.nextVisitorAt === undefined) d.nextVisitorAt = null;
  if (d.trip === undefined) d.trip = null;
  if (!d.tripCooldown) d.tripCooldown = {};
  if (!d.items) d.items = {};
  if (!d.gear) d.gear = {};
  if (!d.bucket) d.bucket = [];
  return d;
}

export async function load() {
  let raw = null;
  try { raw = await idbGet(); } catch { /* IndexedDB が使えない */ }
  if (!raw) {
    try { raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { raw = null; }
  }
  return migrate(raw);
}

let lastGood = null;
let timer = null;
export function save(state, { immediate = false } = {}) {
  const run = async () => {
    timer = null;
    const snapshot = JSON.parse(JSON.stringify(state));
    try {
      await idbSet(snapshot);
      lastGood = snapshot;
    } catch {
      try { localStorage.setItem(LS_KEY, JSON.stringify(snapshot)); lastGood = snapshot; } catch (e) { logError(e); }
    }
  };
  if (immediate) return run();
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, 500);
  return Promise.resolve();
}

export function lastGoodSave() { return lastGood; }

export async function wipe() {
  try { await idbSet(null); } catch { /* ignore */ }
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

// 未捕捉エラーを10件まで残す（外部サービスは使わない）
const ERR_KEY = 'ebi-breeder:errors';
export function logError(err) {
  try {
    const list = JSON.parse(localStorage.getItem(ERR_KEY) || '[]');
    list.unshift({ at: new Date().toISOString(), msg: String(err && err.stack ? err.stack : err) });
    localStorage.setItem(ERR_KEY, JSON.stringify(list.slice(0, 10)));
  } catch { /* ignore */ }
}
export function readErrors() {
  try { return JSON.parse(localStorage.getItem(ERR_KEY) || '[]'); } catch { return []; }
}
