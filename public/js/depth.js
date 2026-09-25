// Depth View (一人称・疑似3D前方ビュー)。選択車の視点からレイキャストで前方の壁を
// 縦ストリップ描画し、他車は「リアビュー風スプライト」を投影して重ねる。
// 横移動/旋回が分かるよう壁に世界座標グリッド縦線、床に前進で流れる横線を描く。
import { VIEW, CAR } from './config.js';
import { raySeg } from './geom.js';
import { hexRgb, shade } from './color.js';
// BE7: レイ照会 rayNearestWall は BE7 で足した名前なので**名前空間から「あれば使う」** (古い contact_v2.js が
// キャッシュに残るブラウザでも起動する・fleet.js 冒頭の BA1 の注記と同じ理由)。
import * as contactParts from './contact_v2.js';

const FOV = 72 * Math.PI / 180;  // 視野角
const MAXD = 2.8;                // 描画する最大距離 (m)
const CELL = 0.25;               // 世界グリッド間隔 (m)
// 【BE7・2026-09-25】壁の縦ストリップのレイを引く距離の上限。列は `perp = best·cos(off) < MAXD` のときだけ描くので、
// best が MAXD/cos(FOV/2) 以上の列は |off| ≤ FOV/2 のどの列でも描かれない (そのとき best の値そのものは使わない:
// 世界グリッド縦線の判定も「隣の列が描かれるとき」だけ)。∴ この距離までの最近交差だけ引けば絵は旧経路と同じ。
// 1e-6 は cos の丸めに負けない余裕。
const RAY_MAX = MAXD / Math.cos(FOV / 2) * (1 + 1e-6);

function rrect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// 他車をリアビュー (後ろ姿) のスプライトで描く。cx=画面中心x, cy=中心y, w/h=寸法。
function drawCarSprite(ctx, cx, cy, w, h, rgb, f) {
  const x0 = cx - w / 2, y0 = cy - h / 2;
  const bodyTop = y0 + h * 0.20;
  // タイヤ (左右後輪)
  ctx.fillStyle = '#0b0b0b';
  ctx.fillRect(x0 - w * 0.05, y0 + h * 0.46, w * 0.15, h * 0.5);
  ctx.fillRect(x0 + w * 0.90, y0 + h * 0.46, w * 0.15, h * 0.5);
  // ボディ (色・上明→下暗)
  const g = ctx.createLinearGradient(0, bodyTop, 0, y0 + h);
  g.addColorStop(0, shade(rgb, 0.7 + 0.5 * f)); g.addColorStop(1, shade(rgb, 0.4 + 0.3 * f));
  ctx.fillStyle = g;
  rrect(ctx, x0 + w * 0.06, bodyTop, w * 0.88, h * 0.76, Math.min(9, w * 0.14)); ctx.fill();
  ctx.lineWidth = Math.max(1.5, w * 0.02); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
  // リアウイング (翼端板付き)
  ctx.fillStyle = '#191919';
  ctx.fillRect(x0 + w * 0.02, y0, w * 0.96, h * 0.13);
  ctx.fillRect(x0 + w * 0.14, y0, w * 0.05, h * 0.22);
  ctx.fillRect(x0 + w * 0.81, y0, w * 0.05, h * 0.22);
  // テールランプ (赤・発光)
  ctx.fillStyle = '#ff3030';
  ctx.fillRect(x0 + w * 0.15, bodyTop + h * 0.18, w * 0.19, h * 0.16);
  ctx.fillRect(x0 + w * 0.66, bodyTop + h * 0.18, w * 0.19, h * 0.16);
  // ディフューザ (下部スリット)
  ctx.fillStyle = '#000';
  for (let k = 0; k < 4; k++) ctx.fillRect(x0 + w * (0.36 + k * 0.085), y0 + h * 0.82, w * 0.04, h * 0.16);
}

// car=視点車。walls=壁線分。cars=[{x,y,theta,color}] 他車。
export function drawDepthView(ctx, W, H, car, walls, cars) {
  const wallRgb = hexRgb(VIEW.wall);
  const horizon = H / 2;
  const wallProj = H * 0.5, floorProj = H * 0.30;
  const maxHH = H * 0.30; // 壁の高さ上限 (近い壁でも床・天井が隠れないように)
  const ox = car.x, oy = car.y, th = car.theta;

  // 空・床
  let g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, '#0a0c12'); g.addColorStop(1, '#1b2230');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, horizon);
  g = ctx.createLinearGradient(0, horizon, 0, H);
  g.addColorStop(0, '#2b2f38'); g.addColorStop(1, '#15171c');
  ctx.fillStyle = g; ctx.fillRect(0, horizon, W, H - horizon);

  // 床の横グリッド (前進で手前へ流れる)
  const fwd = ox * Math.cos(th) + oy * Math.sin(th);
  const frac = ((fwd % CELL) + CELL) % CELL;
  ctx.lineWidth = 1;
  for (let k = 0; k < 26; k++) {
    const d = (CELL - frac) + k * CELL;
    if (d <= 0.05) continue; if (d > MAXD) break;
    const y = horizon + floorProj / d;
    if (y > H) break;
    ctx.strokeStyle = `rgba(180,200,230,${(0.16 * (1 - d / MAXD)).toFixed(3)})`;
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
  }

  // 壁の縦ストリップ + 世界グリッド縦線
  // 【BE7】壁の最近交差はレイ照会 (contact_v2.js rayNearestWall・細セル=2×車長のグリッドをレイが通る順に辿る) で引く。
  //   旧経路は 240 列それぞれで全壁へ raySeg を回し、壁の本数に比例した (壁 20,000 本の投稿コースで 1 フレームの大半)。
  //   RAY_MAX より先の交差は Infinity で返る (上の注記のとおり描かれない)。古い contact_v2.js のときは従来の全走査。
  //   レイ照会が割に合わないコース (壁が少ない・セルが粗い) は、判定を 1 フレームに 1 回だけして従来の全走査のまま
  //   (contact_v2.js rayGridWorth)。列ごとに呼ぶと、壁の少ない出荷コースで固定費のぶん遅くなる (層 4 レビューで実測)。
  const nearFn = typeof contactParts.rayNearestWall === 'function' ? contactParts.rayNearestWall : null;
  const worthFn = typeof contactParts.rayGridWorth === 'function' ? contactParts.rayGridWorth : null;
  const cellM = 2 * CAR.length;
  const near = nearFn && worthFn && worthFn(walls, RAY_MAX, cellM) ? nearFn : null;
  const cols = Math.min(W, 240), cw = W / cols;
  const cells = new Array(cols);
  for (let c = 0; c < cols; c++) {
    const off = -FOV / 2 + FOV * (c / (cols - 1));
    const ang = th + off, dx = Math.cos(ang), dy = Math.sin(ang);
    let best = Infinity;
    if (near) best = near(walls, ox, oy, dx, dy, RAY_MAX, cellM);
    else for (const w of walls) { const t = raySeg(ox, oy, dx, dy, w.x1, w.y1, w.x2, w.y2); if (t < best) best = t; }
    cells[c] = { off, perp: best * Math.cos(off), hx: ox + dx * best, hy: oy + dy * best };
  }
  for (let c = 0; c < cols; c++) {
    const cell = cells[c];
    if (!(cell.perp < MAXD)) continue;
    let hh = wallProj / Math.max(0.08, cell.perp); if (hh > maxHH) hh = maxHH;
    const top = horizon - hh, ht = 2 * hh, f = 1 - cell.perp / MAXD;
    ctx.fillStyle = shade(wallRgb, 0.25 + 0.75 * f);
    ctx.fillRect(c * cw, top, cw + 1, ht);
    const prev = cells[c - 1];
    if (prev && prev.perp < MAXD) {
      const crossed = Math.floor(cell.hx / CELL) !== Math.floor(prev.hx / CELL)
        || Math.floor(cell.hy / CELL) !== Math.floor(prev.hy / CELL);
      if (crossed) { ctx.fillStyle = `rgba(0,0,0,${(0.18 + 0.22 * f).toFixed(3)})`; ctx.fillRect(c * cw, top, Math.max(1, cw * 0.6), ht); }
    }
  }

  // 他車をリアビュー スプライトで重ねる (遠い順に)。壁に隠れていれば描かない。
  const ch = Math.cos(th), sh = Math.sin(th);
  const list = [];
  for (const o of cars) {
    const rx = o.x - ox, ry = o.y - oy;
    const dist = Math.hypot(rx, ry);
    if (dist < 0.02 || dist > MAXD) continue;
    let rel = Math.atan2(rx * (-sh) + ry * ch, rx * ch + ry * sh); // 視線基準の左右角
    if (Math.abs(rel) > FOV / 2 + 0.12) continue;
    // 遮蔽判定: 車中心方向の最近接壁が車より手前なら隠れている
    // (BE7: dist ≤ MAXD なので MAXD までの最近交差だけ引けば判定は旧経路と同じ。それより先は Infinity＝隠さない)
    const dx = Math.cos(th + rel), dy = Math.sin(th + rel);
    let wd = Infinity;
    if (near) wd = near(walls, ox, oy, dx, dy, MAXD, cellM);
    else for (const w of walls) { const t = raySeg(ox, oy, dx, dy, w.x1, w.y1, w.x2, w.y2); if (t < wd) wd = t; }
    if (wd < dist - 0.03) continue;
    list.push({ rel, dist, rgb: hexRgb(o.color) });
  }
  list.sort((a, b) => b.dist - a.dist);
  for (const o of list) {
    const perp = Math.max(0.12, o.dist * Math.cos(o.rel));
    const sx = W * (o.rel + FOV / 2) / FOV;
    const w = Math.max(6, (wallProj * (CAR.width / 0.08) * 0.34) / perp); // 車幅基準
    const h = w * 0.6;
    // タイヤ接地線を、その距離の床ライン (floorProj/perp) に合わせて「地面に乗せる」
    let baseY = horizon + floorProj / perp;
    if (baseY > H) baseY = H;
    const cy = baseY - h / 2;
    drawCarSprite(ctx, sx, cy, w, h, o.rgb, 1 - perp / MAXD);
  }

  // 地平線 + 枠
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, horizon + 0.5); ctx.lineTo(W, horizon + 0.5); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
}
