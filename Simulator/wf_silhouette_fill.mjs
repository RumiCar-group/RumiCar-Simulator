// wf_silhouette_fill.mjs — Stage AL 常設ゲート（追跡）。CI-14（知覚→測定の翻訳）。
// 利用者の知覚「車に見えない／前方形状の知覚ずれ」を、本物の solidVerts/spriteBBox/fitToFootprint を
// import した決定的グリッド（Math.random 不使用）で連続量に翻訳して表明する。再実装しない（CI-9）=
// 描画・extent ゲートと同一の car_sprite 定義を使う。
//
// 測る述語（すべて連続量マージン・設計 k=1 フレーム＝充填率は per-axis affine 不変／前縁空きは mm 直値）:
//   ① 全体充填率   = ソリッド union が衝突矩形(=fit 後の bbox)を覆う割合（"車に見えない複数塊"の指標）。
//   ② 最大連結成分 ÷ 全充填 = 一体ボディ度（分離塊だと < 1）。
//   ③ 前方30%ゾーン充填率（前方を退行させない）。
//   ④ 最悪前縁空き(mm) = 各 y で最も前の充填セルから前縁(bbox.x1)までの後退量の最大（前方知覚ずれ深さ）。
//
// 既定 sport の合格しきい値（PLAN AL1・実装前固定・CI-7）:
//   ① ≥ 95.0%  ② ≥ 90.0%  ③ ≥ 90.0%  ④ ≤ 22.0mm
// アンカー: 旧 F-1 シルエットを fixture として同一メトリクスで測り、計画時 baseline（充填85.4%・
//   前方92.8%・最悪前縁21.0mm）を再現＝メトリクス実装が計画時測定と同族であることを担保（CI-9）。

import { CAR_SPRITES, DEFAULT_SPRITE, BUILTIN_SPRITES, spriteBBox } from './public/js/car_sprite.js';

// ---- AL2 識別距離（本物のジオメトリから正規化特徴ベクトルを算出・再実装しない CI-9）----
// 当初案 (1−IoU)≥0.15 は AL1「充填≥95%」と数学的両立不能（充填≥95% ⟹ IoU≥0.90 ⟹ (1−IoU)≤0.10。
//   実測 sport 98.2% では ≤0.036）。隠れ変数＝充填≥95% ではソリッド外形が全車ほぼ矩形に固定され、
//   識別は**プロポーション/可視特徴**に宿る。ゆえに識別を正規化特徴ベクトルの L2 距離で測る（CI-5・AL-2）。
//   GC=グラスハウス中心 x／GL=同 x 長さ／WB=ホイールベース／TR=トレッド(スタンス幅)／RW=リアウイング面積
//   （いずれも sprite の実ジオメトリから bbox 正規化）。任意2組込間 L2 距離 ≥ D_MIN。
const D_MIN = 0.15; // 実装前固定（元 (1−IoU) 基準と同オーダー・CI-7）
function polyArea(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(a) / 2; }
function polyCentroidX(p) {
  let a = 0, cx = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const cr = p[j][0] * p[i][1] - p[i][0] * p[j][1]; a += cr; cx += (p[j][0] + p[i][0]) * cr; }
  a /= 2; return a ? cx / (6 * a) : (p.reduce((s, q) => s + q[0], 0) / p.length);
}
function featureVector(sprite) {
  const b = spriteBBox(sprite), W = b.x1 - b.x0, H = b.y1 - b.y0, A = W * H;
  const cp = sprite.canopy || [[0, 0]];
  let cxMin = Infinity, cxMax = -Infinity; for (const [x] of cp) { cxMin = Math.min(cxMin, x); cxMax = Math.max(cxMax, x); }
  const GC = (polyCentroidX(cp) - b.x0) / W;
  const GL = (cxMax - cxMin) / W;
  const wh = sprite.wheels, hy = sprite.wheelHalf ? sprite.wheelHalf.y : 0;
  const frontX = (wh[0][0] + wh[1][0]) / 2, rearX = (wh[2][0] + wh[3][0]) / 2;
  const WB = (frontX - rearX) / W;
  let outer = 0; for (const [, wy] of wh) outer = Math.max(outer, Math.abs(wy) + hy);
  const TR = (2 * outer) / H;
  const RW = sprite.rearWing ? polyArea(sprite.rearWing) / A : 0;
  return { v: [GC, GL, WB, TR, RW], GC, GL, WB, TR, RW };
}
function l2(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s); }

// ---- メトリクス（本物の solidVerts/spriteBBox を母集団に、設計 k=1 で決定的ラスタ）----
function rectsOfWheels(sprite) {
  const r = [];
  if (sprite.wheels && sprite.wheelHalf) {
    const { x: hx, y: hy } = sprite.wheelHalf;
    for (const [wx, wy] of sprite.wheels) r.push([[wx - hx, wy - hy], [wx + hx, wy - hy], [wx + hx, wy + hy], [wx - hx, wy + hy]]);
  }
  return r;
}
function solidPolys(sprite) {
  const polys = [];
  for (const k of sprite.solid) polys.push(sprite[k]);   // ボディ等のポリゴン部品
  for (const w of rectsOfWheels(sprite)) polys.push(w);  // タイヤ（矩形展開）
  return polys; // noseAccent（点・面積0）はラスタに無寄与のため除外
}
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// グリッドは bbox（=solidVerts の外接矩形）。fit はこの bbox を衝突矩形へ写すので、bbox を埋める割合が
// そのまま衝突矩形を埋める割合（per-axis affine 写像で充填率・連結比は不変）。前縁空きは設計 mm。
function measure(sprite, cell = 0.0004) {
  const b = spriteBBox(sprite);
  const W = b.x1 - b.x0, H = b.y1 - b.y0;
  const nx = Math.max(40, Math.round(W / cell)), ny = Math.max(20, Math.round(H / cell));
  const dx = W / nx, dy = H / ny;
  const polys = solidPolys(sprite);
  const grid = new Uint8Array(nx * ny);
  for (let iy = 0; iy < ny; iy++) {
    const y = b.y0 + (iy + 0.5) * dy;
    for (let ix = 0; ix < nx; ix++) {
      const x = b.x0 + (ix + 0.5) * dx;
      let hit = 0;
      for (const p of polys) if (inPoly(x, y, p)) { hit = 1; break; }
      grid[iy * nx + ix] = hit;
    }
  }
  // ① 全体充填率
  let filled = 0;
  for (let i = 0; i < grid.length; i++) filled += grid[i];
  const fill = filled / (nx * ny);
  // ② 最大連結成分 ÷ 全充填（4近傍 flood fill）
  const seen = new Uint8Array(nx * ny);
  let maxComp = 0;
  const stack = [];
  for (let s = 0; s < grid.length; s++) {
    if (!grid[s] || seen[s]) continue;
    let comp = 0; stack.length = 0; stack.push(s); seen[s] = 1;
    while (stack.length) {
      const c = stack.pop(); comp++;
      const cx = c % nx, cy = (c - cx) / nx;
      if (cx > 0 && grid[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; stack.push(c - 1); }
      if (cx < nx - 1 && grid[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; stack.push(c + 1); }
      if (cy > 0 && grid[c - nx] && !seen[c - nx]) { seen[c - nx] = 1; stack.push(c - nx); }
      if (cy < ny - 1 && grid[c + nx] && !seen[c + nx]) { seen[c + nx] = 1; stack.push(c + nx); }
    }
    if (comp > maxComp) maxComp = comp;
  }
  const connected = filled ? maxComp / filled : 0;
  // ③ 前方30%ゾーン充填率（x ≥ x1 - 0.3 W）
  const frontX0 = b.x1 - 0.3 * W;
  let fFilled = 0, fTotal = 0;
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const x = b.x0 + (ix + 0.5) * dx;
    if (x < frontX0) continue;
    fTotal++; fFilled += grid[iy * nx + ix];
  }
  const frontFill = fTotal ? fFilled / fTotal : 0;
  // ④ 最悪前縁空き(mm)：各 y 行で最前充填セルから前縁(b.x1)までの後退量。充填のある行のみ。
  let worstGapM = 0;
  for (let iy = 0; iy < ny; iy++) {
    let frontmostX = -Infinity;
    for (let ix = nx - 1; ix >= 0; ix--) if (grid[iy * nx + ix]) { frontmostX = b.x0 + (ix + 0.5) * dx; break; }
    if (frontmostX === -Infinity) continue;
    const gap = b.x1 - frontmostX;
    if (gap > worstGapM) worstGapM = gap;
  }
  return { bbox: b, fill, connected, frontFill, worstGapMm: worstGapM * 1000, nx, ny };
}

// ---- 旧 F-1 シルエット（baseline アンカー・本番未登録の fixture）----
const F1_REF = {
  solid: ['rearWing', 'frontWing', 'body'],
  rearWing:  [[-0.05, -0.042], [-0.03, -0.042], [-0.03, 0.042], [-0.05, 0.042]],
  frontWing: [[0.15, -0.042], [0.168, -0.042], [0.168, 0.042], [0.15, 0.042]],
  body:      [[0.17, 0], [0.135, -0.018], [0.085, -0.03], [0.0, -0.032], [-0.045, -0.024], [-0.045, 0.024], [0.0, 0.032], [0.085, 0.03], [0.135, 0.018]],
  wheelHalf: { x: 0.024, y: 0.013 },
  wheels:    [[0.125, 0.031], [0.125, -0.031], [0.0, 0.031], [0.0, -0.031]],
  noseAccent: [0.158, 0],
};

const TH = { fill: 0.95, connected: 0.90, frontFill: 0.90, worstGapMm: 22.0 };
let fail = 0;

console.log('— アンカー（旧 F-1 fixture・計画時 baseline 再現でメトリクス健全性を担保）—');
const fr = measure(F1_REF);
console.log(`  F-1: 充填=${(fr.fill * 100).toFixed(1)}%（計画 85.4%）/ 前方30%=${(fr.frontFill * 100).toFixed(1)}%（計画 92.8%）`
  + ` / 最悪前縁=${fr.worstGapMm.toFixed(1)}mm（計画 21.0mm）/ 連結=${(fr.connected * 100).toFixed(1)}%  [grid ${fr.nx}×${fr.ny}]`);
const anchorOk = Math.abs(fr.fill - 0.854) < 0.02 && Math.abs(fr.frontFill - 0.928) < 0.02 && Math.abs(fr.worstGapMm - 21.0) < 1.5;
console.log(anchorOk ? '  ✅ baseline 再現（メトリクス＝計画時測定と同族）' : '  ❌ baseline 不一致＝メトリクス定義要再確認');
if (!anchorOk) fail++;

console.log('\n— 登録シルエットの合否（しきい値: 充填≥95% / 連結≥90% / 前方30%≥90% / 最悪前縁≤22mm）—');
for (const key of Object.keys(CAR_SPRITES)) {
  const m = measure(CAR_SPRITES[key]);
  const ok = m.fill >= TH.fill && m.connected >= TH.connected && m.frontFill >= TH.frontFill && m.worstGapMm <= TH.worstGapMm;
  const mark = c => c ? '✓' : '✗';
  console.log(`  ${key}${key === DEFAULT_SPRITE ? '(既定)' : ''}: `
    + `充填=${(m.fill * 100).toFixed(1)}%${mark(m.fill >= TH.fill)} `
    + `連結=${(m.connected * 100).toFixed(1)}%${mark(m.connected >= TH.connected)} `
    + `前方30%=${(m.frontFill * 100).toFixed(1)}%${mark(m.frontFill >= TH.frontFill)} `
    + `最悪前縁=${m.worstGapMm.toFixed(1)}mm${mark(m.worstGapMm <= TH.worstGapMm)}  [grid ${m.nx}×${m.ny}]`);
  if (!ok) fail++;
}

// ---- AL2 識別距離: 6 組込の任意2組込間 L2 距離 ≥ D_MIN ----
console.log(`\n— AL2 識別距離（正規化特徴ベクトル [GC,GL,WB,TR,RW] の任意2組込間 L2 ≥ ${D_MIN}）—`);
const feats = {};
for (const key of BUILTIN_SPRITES) {
  const f = featureVector(CAR_SPRITES[key]); feats[key] = f;
  console.log(`  ${key}: GC=${f.GC.toFixed(3)} GL=${f.GL.toFixed(3)} WB=${f.WB.toFixed(3)} TR=${f.TR.toFixed(3)} RW=${f.RW.toFixed(3)}`);
}
let minD = Infinity, minPair = '';
for (let i = 0; i < BUILTIN_SPRITES.length; i++) for (let j = i + 1; j < BUILTIN_SPRITES.length; j++) {
  const a = BUILTIN_SPRITES[i], b = BUILTIN_SPRITES[j], d = l2(feats[a].v, feats[b].v);
  if (d < minD) { minD = d; minPair = `${a}↔${b}`; }
  if (d < D_MIN) { console.log(`    ✗ ${a} ↔ ${b}: L2=${d.toFixed(3)} < ${D_MIN}`); fail++; }
}
console.log(`  最小ペア距離 = ${minD.toFixed(3)}（${minPair}）／しきい値 ${D_MIN}  ${minD >= D_MIN ? '✓' : '✗'}`);

console.log('\n' + (fail === 0
  ? '✅ PASS: 全登録シルエットが充填/連結/前方/前縁を満たし（baseline アンカー一致）・6 組込の識別距離 ≥ D_MIN'
  : `❌ FAIL: ${fail} 件`));
process.exit(fail === 0 ? 0 : 1);
