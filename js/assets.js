// エビ画像の読み込み。キーは図鑑キーと同じ（r3, h_purple ...）。
import { ALL_DEX_KEYS } from './genetics.js';

export const sprites = {};
export const SPRITE_KEYS = [...ALL_DEX_KEYS, 's_berried', 's_baby'];

export function loadSprites(base = 'assets/shrimp/') {
  return Promise.all(SPRITE_KEYS.map((k) => new Promise((resolve) => {
    const im = new Image();
    im.onload = () => { sprites[k] = im; resolve(); };
    im.onerror = () => resolve();
    im.src = `${base}${k}.png`;
  })));
}
