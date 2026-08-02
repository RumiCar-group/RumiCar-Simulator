// 共有カラーユーティリティ (hud / depth で重複していた変換を集約)。

// '#rrggbb' → [r,g,b]。不正値は壁色に近い赤系へフォールバック。
export function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [158, 27, 27];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// [r,g,b] を係数 f で明暗 (0.12〜1.2 にクランプ) して 'rgb(...)' 文字列に。
export function shade(rgb, f) {
  const k = Math.max(0.12, Math.min(1.2, f));
  return `rgb(${Math.min(255, Math.round(rgb[0] * k))},${Math.min(255, Math.round(rgb[1] * k))},${Math.min(255, Math.round(rgb[2] * k))})`;
}

// '#rrggbb' を係数 f で暗くして 'rgb(...)' に (グラデーション陰用)。
export function darkenHex(hex, f) { return shade(hexRgb(hex), f); }
