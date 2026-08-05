// wf_sprite_extent.mjs — Stage AH 常設ゲート（追跡）。GitHub #26 §4/§7-6・CI-14。Stage AL で一般化。
// 「車が壁を跨いで見える」という知覚主張を、構造的不変条件「描画スプライト ⊆ 衝突フットプリント」へ
// 翻訳して表明する。症状（壁越え）をコース×台数×スケールで総当たりするのでなく、症状を不可能にする
// 不変条件を O(頂点数) で証明する。衝突フットプリントは物理/配置(AG1)が必ず壁から離すので、不変条件が
// 成り立てば視覚の壁越えは「いかなるコース・スケール・配置・走行中でも」起きない。
// ① 構造（主）: 全登録シルエット × steer sweep（前輪 ±maxSteer）で fit 後の全ソリッド頂点 ⊆ フットプリント
//    を表明（実描画と同一の car_sprite を使用。steer 適用 = drawCar が前輪 wheels[0],[1] を回転して描くのと同じ）。
// ② 経験（裏取り・CI-9）: 実 freeSpawn 配置で fit 後スプライト（steered hull）の壁越え=0 を既定+ストレスで確認。
import fs from 'fs';
import { CAR_SPRITES, DEFAULT_SPRITE, spriteBBox, fitToFootprint } from './public/js/car_sprite.js';
import { buildFromSpec } from './public/js/course.js';
import { freeSpawn, fitsAllCars } from './public/js/fleet.js';
import { setRegimeScale, setCarScale, FLEET, REGIMES, VIEW, CAR_FOOTPRINT, CAR } from './public/js/config.js';

const F = CAR_FOOTPRINT, N = FLEET.maxCars, EPS = 1e-9;
const MAXSTEER = CAR.maxSteer;                 // 実舵角ロック（±maxSteer・スケール非依存）
const STEERS = [];                             // steer sweep（描画 drawCar の steerAngle が取り得る範囲）
const STEPS = 16;
for (let i = 0; i <= STEPS; i++) STEERS.push(-MAXSTEER + (2 * MAXSTEER) * i / STEPS);
let fail = 0;

// 前輪 wheels[0],[1] を steer 角で回転した4隅を含む「steer 適用ソリッド頂点」（drawCar と同一の写像順序）。
function steeredSolidVerts(sprite, steer) {
  const v = [];
  for (const k of sprite.solid) v.push(...sprite[k]);
  if (sprite.wheels && sprite.wheelHalf) {
    const { x: hx, y: hy } = sprite.wheelHalf;
    sprite.wheels.forEach(([wx, wy], i) => {
      const ang = i < 2 ? steer : 0, ca = Math.cos(ang), sa = Math.sin(ang); // [0],[1]=前輪(操舵)
      for (const [dx, dy] of [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]]) v.push([wx + dx * ca - dy * sa, wy + dx * sa + dy * ca]);
    });
  }
  if (sprite.noseAccent) v.push(sprite.noseAccent);
  return v;
}

// ① 構造的不変条件: 各シルエット × steer sweep で fit 後ソリッド頂点 ⊆ フットプリント
console.log('① 構造的不変条件: 各シルエット × steer sweep（前輪 ±maxSteer）で fit(ソリッド頂点) ⊆ 衝突フットプリント');
console.log(`  maxSteer = ±${(MAXSTEER * 180 / Math.PI).toFixed(0)}°・sweep ${STEERS.length} 本・footprint x[${F.back},${F.front}] y[±${F.hw}]`);
for (const key of Object.keys(CAR_SPRITES)) {
  const sprite = CAR_SPRITES[key], bbox = spriteBBox(sprite);
  let worstOut = 0, minClr = Infinity, outside = 0, nverts = 0;
  for (const steer of STEERS) for (const [lx, ly] of steeredSolidVerts(sprite, steer)) {
    const [fx, fy] = fitToFootprint(lx, ly, F, bbox);
    const clr = Math.min(fx - F.back, F.front - fx, fy + F.hw, F.hw - fy);   // 内側距離（負=外）= はみ出しマージン
    minClr = Math.min(minClr, clr);
    const out = Math.max(F.back - fx, fx - F.front, -F.hw - fy, fy - F.hw, 0);
    worstOut = Math.max(worstOut, out);
    if (out > EPS) outside++;
    nverts++;
  }
  console.log(`  ${key}${key === DEFAULT_SPRITE ? '(既定)' : ''}: 頂点 ${nverts}・外=${outside}・最小内側マージン=${(minClr * 1000).toFixed(2)}mm・最大はみ出し=${(worstOut * 1000).toExponential(2)}mm(設計k=1)`);
  if (outside > 0) { console.log(`    ❌ FAIL: ${key} に footprint 外の頂点あり`); fail++; }
}
if (fail === 0) console.log('  ✅ PASS: 全シルエット × 全 steer で描画 ⊆ 衝突フットプリント（構造的に壁越え不可）');

// fit 後スプライト凸包（描画と同一の写像・steer sweep の最大外形）をワールド座標へ。経験確認用。
function fittedHullLocal(sprite) {
  const bbox = spriteBBox(sprite);
  const pts = [];
  for (const steer of STEERS) for (const [x, y] of steeredSolidVerts(sprite, steer)) pts.push(fitToFootprint(x, y, F, bbox));
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop(); return lo.concat(up);
}
const HULL = fittedHullLocal(CAR_SPRITES[DEFAULT_SPRITE]);
function world(cp) {
  const c = Math.cos(cp.theta || 0), s = Math.sin(cp.theta || 0), k = VIEW.carScale;
  return HULL.map(([x, y]) => ({ x: cp.x + (x * k) * c - (y * k) * s, y: cp.y + (x * k) * s + (y * k) * c }));
}
function segInt(p, q, a, b) { const d = (o, u, v) => (u.x - o.x) * (v.y - o.y) - (u.y - o.y) * (v.x - o.x); return ((d(a, b, p) > 0) !== (d(a, b, q) > 0)) && ((d(p, q, a) > 0) !== (d(p, q, b) > 0)); }
function crosses(P, walls) { for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; for (const w of walls) if (segInt(p, q, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 })) return true; } return false; }

const specs = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
const kL = r => REGIMES[r].L / REGIMES.tabletop.L;
const BASE = 0.19, effLen = (r, u) => BASE * kL(r) * u;
const place = c => { const occ = []; for (let i = 0; i < N; i++) occ.push(freeSpawn(c, occ, i)); return occ; };
function visCross(course) { let n = 0; for (const sp of place(course)) if (crosses(world(sp), course.walls)) n++; return n; }
// AG1 後の実到達スケール（main.js enforceFitRatio と同ロジック）。視覚確認はユーザが実際に出せる状態で行う。
function applyNewGuard(course, regime0, userK0) {
  const minDim = Math.min(course.bounds.w, course.bounds.h), target = 0.25 * minDim, noRace = course.noRace === true;
  let regime = regime0, userK = userK0;
  if (noRace && minDim >= 50 && regime !== 'fullscale') regime = 'fullscale';
  if (!noRace && regime === 'fullscale' && effLen(regime, userK) > target) regime = 'tabletop';
  if (effLen(regime, userK) > target) { const l1 = effLen(regime, userK) / userK; userK = Math.max(0.4, Math.floor((target / l1) * 10) / 10); }
  setRegimeScale(kL(regime)); setCarScale(userK);
  if (userK > 0.4 + 1e-9 && !fitsAllCars(course, N)) while (userK > 0.4 + 1e-9 && !fitsAllCars(course, N)) { userK = Math.max(0.4, Math.round((userK - 0.1) * 10) / 10); setCarScale(userK); }
  return userK;
}

// ② 経験的確認: ユーザが実際に出せる状態（既定 + AG1 ガード後の最大スケール）で fit 後スプライト（steered hull）の壁越え=0
console.log('\n② 経験的裏取り（実 freeSpawn 配置・fit 後スプライト steered hull・ユーザ到達状態）');
let defCross = 0;
for (const s of specs) { const c = buildFromSpec(s); applyNewGuard(c, 'tabletop', 0.8); if (visCross(c) > 0) defCross++; }
console.log(`  既定(tabletop,0.8) 壁越えコース = ${defCross} / ${specs.length}  （Stage AH 前は 14/41）`);
if (defCross > 0) fail++;
for (const name of ['タイト市街地 (簡易)', 'トライアングル']) {
  const spec = specs.find(s => s.name === name); if (!spec) continue;
  const c = buildFromSpec(spec); const uk = applyNewGuard(c, 'tabletop', 4);  // 最大スケール → AG1 が自動縮小
  const n = visCross(c);
  console.log(`  ${name}（最大スケール→AG1後 userK=${uk.toFixed(1)}）壁越え台数 = ${n} / ${N}`);
  if (n > 0) fail++;
}

console.log('\n' + (fail === 0
  ? '✅ PASS: 描画 ⊆ 衝突フットプリント（全シルエット×steer 構造）＋ 実配置で視覚壁越え 0（既定・ストレス）'
  : `❌ FAIL: ${fail} 件`));
process.exit(fail === 0 ? 0 : 1);
