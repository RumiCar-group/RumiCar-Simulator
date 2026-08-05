// 共有幾何ユーティリティ。レイ/線分の交差判定を一元化する
// (sensors / physics / lap / depth / main で同一実装が重複していたものを集約)。

// レイ (origin o, 方向 d) と線分 (a→b) の交差距離。交差しなければ Infinity。
// AK5/D13: 縮退(0長)壁 (sx=sy=0)・ゼロ方向レイ (dx=dy=0)・共線/平行レイ は全て denom≈0 となり、
// この 1e-12 ガードが Infinity を返す=「当たらない」安全側へ落ちる (NaN/Inf*0 を作らない)。
// 縮退壁は零延長=遮蔽実体ゼロゆえ非検出が正。閾値 1e-12 はこれら全縮退を一括して安全側へ寄せる。
export function raySeg(ox, oy, dx, dy, ax, ay, bx, by) {
  const sx = bx - ax, sy = by - ay;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-12) return Infinity;   // 縮退/共線/平行 → 安全側 (Infinity)
  const t = ((ax - ox) * sy - (ay - oy) * sx) / denom; // レイ上の距離
  const u = ((ax - ox) * dy - (ay - oy) * dx) / denom; // 線分上の比
  return (t >= 0 && u >= 0 && u <= 1) ? t : Infinity;
}

// 線分 a→b と線分 c→d の交差判定。
// AK5/D13: いずれかが縮退(0長)・両者が共線/平行のとき denom≈0 となり false=「交差なし」安全側へ
// 落ちる (checkCollision は car エッジ×壁を本関数で判定するので縮退壁は遮蔽せず=零延長で正)。
export function segIntersect(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-12) return false;   // 縮退/共線/平行 → 安全側 (交差なし)
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// レイ扇 (apex O=(ox,oy)・中心単位方向 (ux,uy)・半角 cos=cosH/sin=sinH) の内側で、
// 線分 a→b 上の O に最も近い点までの距離を返す。扇内に線分が無ければ Infinity。
// out (長さ2の配列) に最近点(world 座標)を書く (Infinity のとき out は触らない)。
// VL53L0X 相当の FoV コーン測距 (Stage AM1・#27)。中心1本レイの raySeg と違い、扇内の
// 最近反射面までの距離を返すため「端点掠め貫通」(細い直線レイが凸コーナー端点の外を掠め遠い壁で
// 止まる=壁の外へ抜けて見える) が原理的に起きない。決定的 (乱数なし)・node↔browser 同値。
// 半角 < 90° の扇は凸なので、線分と扇の交わりは1本の部分線分 [lo,hi]t になる (2半平面でクリップ)。
export function coneNearest(ox, oy, ux, uy, cosH, sinH, ax, ay, bx, by, out) {
  const ex = bx - ax, ey = by - ay;
  const l2 = ex * ex + ey * ey;
  if (l2 < 1e-12) return Infinity;          // 縮退(0長)壁=遮蔽実体ゼロ=非検出 (raySeg と同じ安全側)
  // 扇の境界2方向: 中心 u を ±half 回転。plus=+half(反時計)・minus=-half(時計)。
  const px = cosH * ux - sinH * uy, py = sinH * ux + cosH * uy;   // +half 方向
  const mx = cosH * ux + sinH * uy, my = -sinH * ux + cosH * uy;  // -half 方向
  const wx = ax - ox, wy = ay - oy;         // A - O
  // P(t)=A+t(B-A) が扇内 ⟺ cross(minus,P-O)>=0 かつ cross(plus,P-O)<=0。t を [lo,hi] へ絞る。
  let lo = 0, hi = 1;
  const g0 = mx * wy - my * wx, g1 = mx * ey - my * ex;  // g(t)=g0+t*g1 >= 0
  if (Math.abs(g1) < 1e-15) { if (g0 < 0) return Infinity; }
  else { const r = -g0 / g1; if (g1 > 0) { if (r > lo) lo = r; } else if (r < hi) hi = r; }
  const h0 = px * wy - py * wx, h1 = px * ey - py * ex;  // h(t)=h0+t*h1 <= 0
  if (Math.abs(h1) < 1e-15) { if (h0 > 0) return Infinity; }
  else { const r = -h0 / h1; if (h1 > 0) { if (r < hi) hi = r; } else if (r > lo) lo = r; }
  if (lo > hi) return Infinity;             // 扇と線分は交わらない
  // [lo,hi] 上で O への最近点: dist²(t)=|w+t e|² の最小 t*=-(w·e)/|e|² を [lo,hi] へクランプ。
  let t = -(wx * ex + wy * ey) / l2;
  if (t < lo) t = lo; else if (t > hi) t = hi;
  const qx = wx + t * ex, qy = wy + t * ey; // P - O
  out[0] = ox + qx; out[1] = oy + qy;
  return Math.sqrt(qx * qx + qy * qy);
}

// 扇 (apex O=(ox,oy)・中心単位方向 (ux,uy)・半角 halfRad) を n 等分した n+1 方向 (k=0..n が
// -half→+half) について、各方向の「最初の反射面までの距離」(segs/extra の raySeg 最小・maxM
// クランプ) を out[k] に書き、out を返す。描画専用 (Stage AQ・GitHub #30): 測距の正 (coneNearest=
// 扇内最近) には一切触れない。扇内最近点は必ずいずれかの方向線上にあるため各 depth ≥ coneNearest
// 距離で、密な n では min(out) ≈ coneNearest (wf_fan_render.mjs が全コースで機械確認)。
export function fanDepths(ox, oy, ux, uy, halfRad, n, maxM, segs, extra, out) {
  for (let k = 0; k <= n; k++) {
    const a = -halfRad + (2 * halfRad) * (k / n);
    const ca = Math.cos(a), sa = Math.sin(a);
    const dx = ca * ux - sa * uy, dy = sa * ux + ca * uy;
    let d = maxM;
    for (const w of segs) { const t = raySeg(ox, oy, dx, dy, w.x1, w.y1, w.x2, w.y2); if (t < d) d = t; }
    if (extra) for (const w of extra) { const t = raySeg(ox, oy, dx, dy, w.x1, w.y1, w.x2, w.y2); if (t < d) d = t; }
    out[k] = d;
  }
  return out;
}

// 扇を n 等分した n+1 方向について、各方向の「最初の反射面までの距離」に加えて、
// **その面への入射角の cos** と **標的の種別** (0=壁 / 1=他車エッジ / -1=反射面なし) を返す
// (Stage AS8 の ToF 光学モデル専用)。fanDepths と同じ走査だが、反射信号レート
// S ∝ ρ·cosθ/d² を組み立てるのに要る2つを併せて供給する。決定的 (乱数なし)。
// 反射面が無い方向は outD[k]=maxM・outC[k]=0・outK[k]=-1 (=無反射=信号0) にする。
// 法線 n=(ey,-ex)/|e| ゆえ cos(入射角)=|dir·n|=|dx·ey-dy·ex|/|e|。
export function fanHits(ox, oy, ux, uy, halfRad, n, maxM, segs, extra, outD, outC, outK) {
  for (let k = 0; k <= n; k++) {
    const a = n === 0 ? 0 : -halfRad + (2 * halfRad) * (k / n);
    const ca = Math.cos(a), sa = Math.sin(a);
    const dx = ca * ux - sa * uy, dy = sa * ux + ca * uy;
    let d = maxM, kind = -1, ex = 0, ey = 0;
    for (const w of segs) {
      const t = raySeg(ox, oy, dx, dy, w.x1, w.y1, w.x2, w.y2);
      if (t < d) { d = t; kind = 0; ex = w.x2 - w.x1; ey = w.y2 - w.y1; }
    }
    if (extra) for (const w of extra) {
      const t = raySeg(ox, oy, dx, dy, w.x1, w.y1, w.x2, w.y2);
      if (t < d) { d = t; kind = 1; ex = w.x2 - w.x1; ey = w.y2 - w.y1; }
    }
    outD[k] = d; outK[k] = kind;
    const el = Math.sqrt(ex * ex + ey * ey);
    outC[k] = (kind >= 0 && el > 1e-9) ? Math.abs(dx * ey - dy * ex) / el : 0;
  }
  return outD;
}

// 点 p から線分 a→b までの最短距離。
export function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
