// コース定義の幾何検証。track コースの中心線(スムージング後)を解析し、
// 「左右に壁のある閉じた廊下」が成立するかを確認する。
//   1. 中心線の非隣接区間どうしが width 未満まで接近していないか
//      (接近していると左右の廊下が融合し壁が交差 → 道が塞がる)。これが致命的。
//   2. 隣接コーナーの折れ角が急すぎないか (内壁の折れ込みスパイク要因)。
// 各コースの「最小自己間隔 / width」と「最大コーナー角」を出力する。
import { readFileSync } from 'node:fs';

function sampleClosed(fn, n) { const p = []; for (let i = 0; i < n; i++) p.push(fn(2 * Math.PI * i / n)); return p; }
function chaikin(pts, iters) {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    const q = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = q;
  }
  return p;
}
function makeCenterline(spec) {
  const n = spec.samples || 80, cx = +(spec.cx ?? 0), cy = +(spec.cy ?? 0);
  switch (spec.shape) {
    case 'ellipse': return sampleClosed(t => [cx + spec.rx * Math.cos(t), cy + spec.ry * Math.sin(t)], n);
    case 'lobed': { const rB = +spec.rBase, amp = +spec.amp, lobes = +spec.lobes, ph = +(spec.phase || 0);
      return sampleClosed(t => { const r = rB + amp * Math.cos(lobes * t + ph); return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; }, n); }
    case 'superellipse': { const rx = +spec.rx, ry = +spec.ry, k = +(spec.k ?? 0.6), sg = v => v < 0 ? -1 : 1;
      return sampleClosed(t => { const c = Math.cos(t), s = Math.sin(t);
        return [cx + rx * sg(c) * Math.pow(Math.abs(c), k), cy + ry * sg(s) * Math.pow(Math.abs(s), k)]; }, n); }
    case 'stadium': { const L = +spec.L, rr = +spec.rr, arc = Math.max(8, Math.floor(n / 4)), pts = [];
      for (let i = 0; i <= arc; i++) { const a = -Math.PI / 2 + Math.PI * i / arc; pts.push([cx + L / 2 + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
      for (let i = 0; i <= arc; i++) { const a = Math.PI / 2 + Math.PI * i / arc; pts.push([cx - L / 2 + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
      return pts; }
    case 'polyline': return (spec.centerline || []).map(p => [+p[0], +p[1]]);
    default: return sampleClosed(t => [cx + (+spec.rx || 1) * Math.cos(t), cy + (+spec.ry || 0.7) * Math.sin(t)], n);
  }
}
// 点 p から線分 ab への最短距離
function ptSeg(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], wx = p[0] - a[0], wy = p[1] - a[1];
  const L2 = vx * vx + vy * vy || 1e-12;
  let t = (wx * vx + wy * vy) / L2; t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * vx, cy = a[1] + t * vy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}
// 閉点列の非隣接区間どうしの最小間隔 (巡回上 win 個ぶんは隣接扱いで除外)
function cycDist(i, j, n) { const d = Math.abs(i - j); return Math.min(d, n - d); }
function minSelfDist(loop, win) {
  const n = loop.length; let mn = Infinity, where = -1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      // 線分 (j, j+1) の両端が巡回上 i から win 以内なら隣接として除外
      if (cycDist(i, j, n) < win || cycDist(i, (j + 1) % n, n) < win) continue;
      const d = ptSeg(loop[i], loop[j], loop[(j + 1) % n]);
      if (d < mn) { mn = d; where = i; }
    }
  }
  return { mn, where };
}
// 各頂点の折れ角(度): 0=直進, 180=Uターン
function maxCornerAngle(loop) {
  const n = loop.length; let mx = 0, where = -1;
  for (let i = 0; i < n; i++) {
    const a = loop[(i - 1 + n) % n], p = loop[i], b = loop[(i + 1) % n];
    const v1x = p[0] - a[0], v1y = p[1] - a[1], v2x = b[0] - p[0], v2y = b[1] - p[1];
    const d = (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)) || 1e-12;
    let cos = (v1x * v2x + v1y * v2y) / d; cos = Math.max(-1, Math.min(1, cos));
    const ang = Math.acos(cos) * 180 / Math.PI;
    if (ang > mx) { mx = ang; where = i; }
  }
  return { mx, where };
}

const specs = JSON.parse(readFileSync(process.argv[2] || 'public/data/courses.json', 'utf8'));
const onlyTracks = process.argv.includes('--circuits');
let bad = 0;
for (const s of specs) {
  if (s.kind !== 'track') continue;
  if (onlyTracks && s.shape !== 'polyline') continue;
  let cl = makeCenterline(s);
  if (s.smooth) cl = chaikin(cl, s.smooth === true ? 2 : +s.smooth);
  const w = +s.width;
  // win: スムージング後の点列で「隣接」とみなす窓。元の1辺は約 2^smooth 点に展開。
  const win = Math.max(4, Math.round((s.smooth ? 2 ** (s.smooth === true ? 2 : +s.smooth) : 1) * 2));
  const { mn, where } = minSelfDist(cl, win);
  const { mx, where: cw } = maxCornerAngle(cl);
  const ratio = mn / w;
  // 致命: 自己間隔 < width (廊下が融合)。要注意: コーナー角 > 75度 (内壁折れ込み)。
  const fatal = ratio < 1.0;
  const warn = mx > 75;
  if (fatal) bad++;
  const mark = fatal ? 'NG ' : (warn ? 'warn' : 'ok ');
  console.log(`[${mark}] ${s.name.padEnd(22)} selfDist/width=${ratio.toFixed(2)} (gap=${mn.toFixed(3)}m @${where}) maxCorner=${mx.toFixed(0)}° @${cw}`);
}
console.log(`\n${bad} 件が致命的 (廊下融合の可能性)`);
