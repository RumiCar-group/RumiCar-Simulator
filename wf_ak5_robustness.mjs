// Stage AK5 周辺正常化ゲート (常設・追跡): D8/D12/D13/D14 を **本物のオラクル** で構造検査する。
// 設計: AK5 の4項目はいずれも「出荷コンテンツでは潜在 (latent) =既に安全/byte 不変」で、改修は
//   ① 既定/正準を厳密 no-op に保ち (byte/verifyHash 不変)、② 潜在の隅 (利用者の極小ループ・領域/コース
//   不一致の超過配置・縮退壁・荷重 NaN隅) を堅牢に閉じる。本ゲートは ①②の両方を機械検査する (CI-14)。
//   検出力 (detection power) も併せて示す: 旧挙動を同オラクルで再現し「直っていること」を二値でなく示す。
import fs from 'node:fs';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { LapTracker } from './public/js/lap.js';
import { applyRegime, DynCar } from './public/js/physics_dyn.js';
import { raySeg, segIntersect, distToSeg } from './public/js/geom.js';
import { fitsAllCars } from './public/js/fleet.js';
import { PROGRAMS } from './public/js/programs.js';
import { CONST } from './public/js/config.js';
import { FROZEN } from './wf_frozen.mjs';   // AP3: 凍結値は中央マニフェスト経由

let fails = 0;
const ok = (cond, label) => { console.log(`  ${cond ? '○' : '✗'} ${label}`); if (!cond) fails++; };
const prog = (k) => { const p = PROGRAMS.find((x) => x.key === k); return { src: p.code, lang: 'c', carType: p.carType }; };
const field = (k, n) => Array.from({ length: n }, () => { const p = prog(k); return { name: 'C', lang: p.lang, src: p.src, carType: p.carType }; });
// 正準 f0/f1 と同一の異種フィールド (wf_ab8_bench と完全一致させ verifyHash を照合)。
const canonField = (...keys) => keys.map((k, i) => { const p = prog(k); return { name: 'C' + i, lang: p.lang, src: p.src, carType: p.carType, rear: false, encoder: false }; });
const specs = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
const oval = buildFromSpec({ name: 'オーバル', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });

// === 0) D8 正準 no-op を最初に検証する (pristine 状態=wf_ab8_bench と同条件)。 ===
// runRace は regime=null だと applyRegime を呼ばない=現 CAR 状態を継ぐため、領域を触る前に評価する。
console.log('=== 0) D8: 正準レース fit ガード=no-op・verifyHash 不変 (pristine) ===');
{
  const r3 = runRace({ report: true, course: oval, laps: 3, field: canonField('normal_fr', 'normal_awd', 'normal_ff'), crashRule: { rejoin: false, penaltySec: 3 } });
  const r2 = runRace({ report: true, course: oval, laps: 2, field: canonField('normal_ff', 'normal_fr'), crashRule: { rejoin: true, penaltySec: 3 } });
  ok(r3.fitReduced === 0 && r3.verifyHash === FROZEN.f0, `正準 f0 (oval×3 fr/awd/ff): fitReduced=0・verify=${r3.verifyHash} (=${FROZEN.f0} AM1)`);
  ok(r2.fitReduced === 0 && r2.verifyHash === FROZEN.f1, `正準 f1 (oval×2 ff/fr rejoin): fitReduced=0・verify=${r2.verifyHash} (=${FROZEN.f1} AM1)`);
  ok(fitsAllCars(oval, 6) === true, '審判共用: fitsAllCars(oval,6)=true (=出荷卓上は減らさない=既定 no-op の根拠)');
}

console.log('\n=== A) D13: 縮退(0長)壁/共線/平行レイ → 安全側 (Infinity/false・NaN無し) ===');
{
  const finOrInf = (v) => Number.isFinite(v) || v === Infinity;
  const r1 = raySeg(0, 0, 1, 0, 2, 2, 2, 2);   // 0長セグ
  const r2 = raySeg(0, 0, 0, 0, 1, -1, 1, 1);  // 0方向レイ
  const r3 = raySeg(0, 0, 1, 0, 1, 0, 5, 0);   // 共線
  const r4 = raySeg(0, 0, 1, 0, 3, -1, 3, 1);  // 正常ヒット (sanity)
  ok(r1 === Infinity && !Number.isNaN(r1), `raySeg 0長セグ → Infinity (${r1})`);
  ok(r2 === Infinity, `raySeg 0方向レイ → Infinity (${r2})`);
  ok(r3 === Infinity, `raySeg 共線 → Infinity (${r3})`);
  ok(Math.abs(r4 - 3) < 1e-9 && finOrInf(r4), `raySeg 正常ヒット=3 (${r4})`);
  ok(segIntersect({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 1 }) === false, 'segIntersect 0長 → false');
  ok(segIntersect({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }) === false, 'segIntersect 共線 → false');
  const dp = distToSeg({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 });
  ok(Number.isFinite(dp) && Math.abs(dp - Math.SQRT2) < 1e-9, `distToSeg(a==b) → 点距離 ${dp.toFixed(4)} (有限)`);
}

console.log('\n=== B) D14: フルスケール latLoadK — 極端駆動でも状態が有限 (NaN隅=n→0&tF=0 は床で到達不能) ===');
{
  applyRegime('fullscale');
  const finite = (c) => [c.x, c.y, c.theta, c.u, c.vlat, c.r, c.v].every(Number.isFinite);
  // (1) 直線 max ブレーキ: tF≈0 (操舵なし=横力ゼロ) かつ nF→0.1*g 床へ (荷重前移動) = D14 の隅そのもの。
  const c1 = new DynCar({ x: 0, y: 0, theta: 0 });
  c1.steer = CONST.CENTER; c1.driveDir = CONST.FORWARD; c1.pwm = 255;
  for (let i = 0; i < 300; i++) c1.step(1 / 60);   // 高速まで加速
  const vTop = c1.u;
  c1.driveDir = CONST.BRAKE; c1.pwm = 255;
  for (let i = 0; i < 120; i++) c1.step(1 / 60);   // 直線 max ブレーキ (nF→床・tF≈0)
  ok(finite(c1) && vTop > 5, `直線max加速→maxブレーキ: 状態有限 (vTop=${vTop.toFixed(1)} u=${c1.u.toFixed(3)})`);
  // (2) 加速→ブレーキ+操舵 (複合の極端荷重移動)
  const c2 = new DynCar({ x: 0, y: 0, theta: 0 });
  c2.steer = CONST.CENTER; c2.driveDir = CONST.FORWARD; c2.pwm = 255;
  for (let i = 0; i < 300; i++) c2.step(1 / 60);
  c2.driveDir = CONST.BRAKE; c2.steer = CONST.LEFT; c2.pwm = 255;
  for (let i = 0; i < 200; i++) c2.step(1 / 60);
  ok(finite(c2), `加速→ブレーキ+全舵: 状態有限 (u=${c2.u.toFixed(3)} r=${c2.r.toFixed(3)} β=${Math.atan2(c2.vlat, Math.abs(c2.u) + 1e-9).toFixed(3)})`);
  // 検出力: D14 の隅 (n=0, t=0) は旧式 t/n=0/0=NaN・新式 t/max(n,1e-9)=0/1e-9=0 (有限)。床がこれを構造的に閉じる。
  const oldGm = (t, n) => Math.max(0.5, 1 - 0.05 * (t / n) ** 2);
  const newGm = (t, n) => Math.max(0.5, 1 - 0.05 * (t / Math.max(n, 1e-9)) ** 2);
  ok(Number.isNaN(oldGm(0, 0)) && Number.isFinite(newGm(0, 0)), `検出力: 隅(0,0) 旧=NaN→新=有限 (旧 ${oldGm(0, 0)} / 新 ${newGm(0, 0)})`);
  ok(newGm(2.0, 0.981) === oldGm(2.0, 0.981), '実荷重 (n≥0.981) では旧=新 (床は no-op=byte 不変)');
  applyRegime(null);
}

console.log('\n=== C) D12: lap 武装距離 — 出荷コースは 0.25 不変・極小ループは到達可能な閾値で計上 ===');
{
  // 出荷の全 (非峠) コースで armDist===0.25 (=arming byte 不変)。峠は touge 分岐で armDist 未使用。
  // AY2 (2026-09-08): 舵角限界ベンチ (`bench` 持ち) は **本節が用意した縮小機構そのものの対象**＝極小ループで、
  //   0.25 のままだと永久に武装せず 1 周も計上できない (下の「極小ループ」検査と同じ現象)。∴ 0.25 不変の対象からは
  //   外し、**代わりに「縮小が効いていること」を積極的に検査する** (枠を緩めるのではなく別の述語を足す)。
  //   既存コースの verifyHash 不変はベンチが末尾追加ゆえ影響を受けない。
  let nonTougeChanged = 0, built = 0, benchN = 0, benchShrunk = 0, benchMin = Infinity, benchMax = -Infinity;
  for (const spec of specs) {
    let c; try { c = buildFromSpec(JSON.parse(JSON.stringify(spec))); } catch (e) { continue; }
    if (!c.finish || !c.walls) continue;
    built++;
    const lt = new LapTracker(c, { persist: false });
    if (spec.bench) {
      benchN++;
      if (lt.armDist > 0 && lt.armDist < 0.25) benchShrunk++;
      benchMin = Math.min(benchMin, lt.armDist); benchMax = Math.max(benchMax, lt.armDist);
      continue;
    }
    if (!c.touge && lt.armDist !== 0.25) nonTougeChanged++;
  }
  ok(nonTougeChanged === 0, `非峠の出荷コース ${built - benchN} 件 (ベンチ ${benchN} 件を除く) すべて armDist===0.25 (arming byte 不変・違反 ${nonTougeChanged})`);
  ok(benchN > 0 && benchShrunk === benchN,
    `舵角限界ベンチ ${benchN} 件すべてで armDist が 0<x<0.25 へ縮小 (実測 ${benchMin === Infinity ? '--' : benchMin.toFixed(4)}〜${benchMax === -Infinity ? '--' : benchMax.toFixed(4)}・縮小 ${benchShrunk}/${benchN}) ` +
    `= 極小ループでも周回を計上できる (0.25 固定なら 0 周のまま=下の検出力検査と同じ現象)`);
  const ovalLt = new LapTracker(oval, { persist: false });
  ok(ovalLt.armDist === 0.25, `正準オーバル armDist===0.25 (厳密・verifyHash 不変の根拠)`);

  // 極小ループ: R+<0.25 → 固定0.25では永久に武装せず=0周。AK5 で 0.5*R+ へ縮小し計上できる。
  const tiny = buildFromSpec({ name: '極小ループ', kind: 'track', shape: 'ellipse', rx: 0.2, ry: 0.14, width: 0.1 });
  const f = tiny.finish; const mx = (f.x1 + f.x2) / 2, my = (f.y1 + f.y2) / 2;
  let rPlus = -Infinity;
  for (const w of tiny.walls) for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]]) { const s = (x - mx) * f.fx + (y - my) * f.fy; if (s > rPlus) rPlus = s; }
  const tNew = new LapTracker(tiny, { persist: false });
  const tOld = new LapTracker(tiny, { persist: false }); tOld.armDist = 0.25;   // 旧挙動を同オラクルで再現 (検出力)
  ok(rPlus < 0.25 && tNew.armDist < 0.25, `極小ループ R+=${rPlus.toFixed(3)}<0.25 → 新 armDist=${tNew.armDist.toFixed(3)} (縮小)`);
  // 共通の周回軌跡: フィニッシュ中点を法線方向に -k→+k→-k と往復 (3周分)。各 -k→+k で線分中点を負→正に通過。
  const nx = f.fx, ny = f.fy; const k = 0.9 * rPlus;
  const feed = (lt) => {
    let laps = 0;
    const at = (s) => ({ x: mx + s * nx, y: my + s * ny });
    let p = at(-k); lt.update(0, p.x, p.y, true);
    for (let lap = 0; lap < 3; lap++) {
      for (const s of [-k, -k / 2, 0.0, k / 2, k]) { p = at(s); if (lt.update(1 / 60, p.x, p.y, true)) laps++; }
      for (const s of [k, k / 2, -k / 2, -k]) { p = at(s); lt.update(1 / 60, p.x, p.y, true); }
    }
    return laps;
  };
  const lapsNew = feed(tNew), lapsOld = feed(tOld);
  // 3周分の往復のうち初回は「武装(arm)」に費やされ計上されない (実 LapTracker のヒステリシス仕様)=2計上が正。
  ok(lapsNew >= 2, `極小ループ 新挙動=計上 ${lapsNew}周 (≥2=武装して数えられる・初回は arm)`);
  ok(lapsOld === 0, `検出力: 旧挙動 (armDist=0.25) =計上 ${lapsOld}周 (=0=固定閾値では永久に数えられない)`);
}

console.log('\n=== D) D8: レース fit ガード — 領域/コース不一致の超過は減・capacity は素通し ===');
{
  // 領域/コース不一致 (フルスケール車=巨大 を小オーバルに6台): 静的に収まらない → fit ガードが減らす。
  const smallOval = buildFromSpec({ name: '小オーバル', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
  const staticFit6 = fitsAllCars(smallOval, 6);   // fullscale 適用後の CAR で評価される
  const mm = runRace({ course: smallOval, regime: 'fullscale', laps: 1, maxSec: 3, field: field('normal_fr', 6), crashRule: { rejoin: true, penaltySec: 3 } });
  ok(mm.fitReduced > 0, `不一致 (fullscale×小オーバル×6台): fit ガードが ${mm.fitReduced}台 削減 (発走団子を防ぐ)`);
  // capacity (実態容量を測る側) は fitGuard:false で素通し=団子を先に潰さない=AK7 を壊さない。
  const cap = runRace({ course: smallOval, regime: 'fullscale', laps: 1, maxSec: 3, field: field('normal_fr', 6), crashRule: { rejoin: true, penaltySec: 3 }, trackNet: true, fitGuard: false });
  ok(cap.fitReduced === 0, `capacity 経路 (fitGuard:false): fitReduced=0=素通し (実態容量を測れる=AK7 保全)`);
}

console.log('\n' + (fails === 0 ? '────────── AK5 周辺正常化ゲート: 全パス ○ ──────────' : `────────── AK5 ゲート: ✗ ${fails} 件 NG ──────────`));
process.exit(fails === 0 ? 0 : 1);
