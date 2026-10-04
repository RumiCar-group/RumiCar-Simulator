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
import { fitsAllCars, capacityOf } from './public/js/fleet.js';   // AZ5: 0 を返せる共有オラクル
import { PROGRAMS } from './public/js/programs.js';
import { CONST, CAR } from './public/js/config.js';   // AZ5: 車長を「走り出せたか」の物差しに使う
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

console.log('\n=== C) D12: 極小ループ・ベンチでも周回を数えられる (BH3 で武装距離を廃止＝コースを回る軌跡で測る) ===');
{
  // AK5 当時の仕組み: フィニッシュ線の正側へ armDist (固定 0.25m・極小ループは 0.5*R+ へ縮小) 離れてから武装し、負側→正側の
  //   通過を 1 周と数えた。本節は「出荷コースの armDist が 0.25 のまま」「極小ループ・ベンチでは縮小して数えられる」を測っていた。
  // BH3 (2026-10-04) で武装を廃止した (lap.js の【BH3】): 逆向きに線を通った分の「借り」が発走直後の二重計上を防ぐので要らず、
  //   残すと ①線を逆向きに戻って通り直すだけで 1 周になる ②内側の線では縮小後の武装距離にも届かず数え漏れる (BH2 実測 22 台＝
  //   ベンチの道幅 3.5 台分の 3 本)。∴ 本節の主張「極小ループ・ベンチでも周回を数えられる」は変えず、測り方を
  //   **コースを実際に回る軌跡**へ置き換えた。旧治具はフィニッシュ線の中点を法線方向に往復させるだけで、今回直した不具合
  //   そのもの (回っていないのに数える) に依存していた＝改修後は 0 周になることを下で固定する。
  // 軌跡: 中心線つきのコース (track) で、フィニッシュ線分の中点を法線方向に通り、中心線の頂点を順にたどって戻る。
  const geo = (c) => {
    const f = c.finish, ex = f.x2 - f.x1, ey = f.y2 - f.y1, len = Math.hypot(ex, ey);
    let nx = -ey / len, ny = ex / len; if (nx * f.fx + ny * f.fy < 0) { nx = -nx; ny = -ny; }   // 線分の法線 (正方向の側)
    return { mx: (f.x1 + f.x2) / 2, my: (f.y1 + f.y2) / 2, nx, ny };
  };
  // loops 周ぶん与えて、数えた周回を返す。behind=true は線の手前から発走 (最初の通過は発走の通過)。
  const circulate = (c, loops, behind = false) => {
    const g = geo(c), cl = c.centerline;
    const d = Math.min(0.01, 0.25 * Math.hypot(cl[1][0] - cl[0][0], cl[1][1] - cl[0][1]));
    const lt = new LapTracker(c, { persist: false });
    const put = (x, y) => lt.update(1 / 60, x, y, true);
    if (behind) lt.update(0, g.mx - d * g.nx, g.my - d * g.ny, true);
    put(g.mx + d * g.nx, g.my + d * g.ny);
    for (let k = 0; k < loops; k++) { for (let i = 1; i < cl.length; i++) put(cl[i][0], cl[i][1]); put(g.mx - d * g.nx, g.my - d * g.ny); put(g.mx + d * g.nx, g.my + d * g.ny); }
    return lt.laps;
  };
  let tracks = 0, benchN = 0; const bad = [];
  for (const spec of specs) {
    let c; try { c = buildFromSpec(JSON.parse(JSON.stringify(spec))); } catch (e) { continue; }
    if (!c.finish || c.touge || !Array.isArray(c.centerline)) continue;
    tracks++; if (spec.bench) benchN++;
    const n = circulate(c, 2);
    if (n !== 2) bad.push(`${c.name}: ${n}`);
  }
  ok(tracks >= 30 && benchN > 0 && bad.length === 0, `中心線つきの出荷の周回コース ${tracks} 件 (舵角限界ベンチ ${benchN} 件を含む) すべてで、中心線を 2 周して 2 周と数える (違反 ${bad.length}${bad.length ? ': ' + bad.slice(0, 3).join(' / ') : ''})`);

  // 極小ループ: 線の正側に壁が 0.25m も伸びない (v9.0.0 の固定 0.25m では永久に武装しなかった)。
  const tiny = buildFromSpec({ name: '極小ループ', kind: 'track', shape: 'ellipse', rx: 0.2, ry: 0.14, width: 0.1 });
  const f = tiny.finish; const mx = (f.x1 + f.x2) / 2, my = (f.y1 + f.y2) / 2;
  let rPlus = -Infinity;
  for (const w of tiny.walls) for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]]) { const s = (x - mx) * f.fx + (y - my) * f.fy; if (s > rPlus) rPlus = s; }
  ok(rPlus < 0.25, `極小ループ: 線の正側の壁は R+=${rPlus.toFixed(3)}m まで (<0.25)`);
  const lapsAhead = circulate(tiny, 3), lapsBehind = circulate(tiny, 3, true);
  ok(lapsAhead === 3, `極小ループを線の上から 3 周: 計上 ${lapsAhead} 周 (=3)`);
  ok(lapsBehind === 3, `極小ループを線の手前から発走して 3 周: 計上 ${lapsBehind} 周 (=3・最初の通過は発走の通過で数えない)`);
  // 内側の線 (x 半径 0.16・y 半径 0.092 の楕円): 線の先へ 0.092m までしか行かない＝v9.0.0 の武装距離 0.5*R+=0.095m に届かない。
  //   v9.0.0 は 1 周も数えなかった (＝本節が AK5 で塞いだはずの「永久に数えられない」が内側の線では残っていた)。
  {
    const cl = tiny.centerline, n = cl.length;
    let cx = 0, cy = 0; for (const q of cl) { cx += q[0]; cy += q[1]; } cx /= n; cy /= n;
    const lt = new LapTracker(tiny, { persist: false });
    const qx = cx + (mx - cx) * 0.8, qy = cy + (my - cy) * 0.8, d = 0.004;   // フィニッシュ線分を内寄り (中点から 0.04m) で通る
    let maxS = -Infinity;
    const put = (x, y) => { const s = (x - mx) * f.fx + (y - my) * f.fy; if (s > maxS) maxS = s; lt.update(1 / 60, x, y, true); };
    lt.update(0, qx + d * f.fx, qy + d * f.fy, true);
    for (let k = 0; k < 3; k++) {
      for (let i = 1; i < n; i++) { const th = 2 * Math.PI * i / n; put(cx + 0.16 * Math.cos(th), cy + 0.092 * Math.sin(th)); }
      put(qx - d * f.fx, qy - d * f.fy); put(qx + d * f.fx, qy + d * f.fy);
    }
    ok(maxS < 0.5 * rPlus && lt.laps === 3, `極小ループの内側の線を 3 周 (線の先へ最大 ${maxS.toFixed(3)}m < v9.0.0 の武装距離 ${(0.5 * rPlus).toFixed(3)}m): 計上 ${lt.laps} 周 (=3・v9.0.0 は 0 周)`);
  }
  // 旧治具 (置き換え前): フィニッシュ中点を法線方向に -k→+k→-k と 3 往復。回っていないので 0 周が正 (v9.0.0 までは 2 周と数えた)。
  const nx = f.fx, ny = f.fy; const k = 0.9 * rPlus;
  const tOld = new LapTracker(tiny, { persist: false });
  let shuttleLaps = 0;
  {
    const at = (s) => ({ x: mx + s * nx, y: my + s * ny });
    let p = at(-k); tOld.update(0, p.x, p.y, true);
    for (let lap = 0; lap < 3; lap++) {
      for (const s of [-k, -k / 2, 0.0, k / 2, k]) { p = at(s); if (tOld.update(1 / 60, p.x, p.y, true)) shuttleLaps++; }
      for (const s of [k, k / 2, -k / 2, -k]) { p = at(s); tOld.update(1 / 60, p.x, p.y, true); }
    }
  }
  ok(shuttleLaps === 0 && tOld.laps === 0, `線の中点を 3 往復するだけ (旧治具): 計上 ${tOld.laps} 周 (=0＝回っていない周回を数えない・BH3)`);
  ok(!('armDist' in tOld) && !('armed' in tOld), 'LapTracker に武装 (armDist/armed) が残っていない');
}

console.log('\n=== D) D8: レース fit ガード — 領域/コース不一致の超過は減・capacity は素通し ===');
{
  // 領域/コース不一致 (フルスケール車=巨大 を小さなオーバルに6台): 静的に収まらない → fit ガードが減らす。
  // **【AZ5・2026-09-12】ここは 2 ケースに分かれる。** 旧ゲートは `小オーバル` (2.4×1.5m を fullscale) 1 本だけを
  //   見て `fitReduced > 0` を要求していたが、この治具は実態収容が **0 台**で、旧 fit ガードは
  //   `while (nFit > 1 …)` の構文ゆえ 0 を表現できず **1 台へ丸めて走らせていた** (その 1 台は netMax 0.000m ＝
  //   一切動けない)。AZ5 で 0 は NO_ROOM になったので、「減らす」ケースと「走らせない」ケースを**両方**固定する
  //   (旧アサートを緩めたのではなく、治具を 1 本足して意図を分けた ＝ CI-7 の厳格化)。
  // (D-1) 実態収容 1..5 台 → **減らして走る** (従来の D8 の意図そのもの)。
  const midOval = buildFromSpec({ name: '中オーバル', kind: 'track', shape: 'ellipse', rx: 12, ry: 8, width: 6 });
  // **寸法は領域に依存する。** runRace は内部で applyRegime してから fit ガードを評価し、finally で元へ戻す。
  //   ∴ runRace の外で capacityOf を測るときは **自分で領域を合わせる**。旧コードの `staticFit6` は
  //   「fullscale 適用後の CAR で評価される」とコメントしていたが実際は現在の領域 (卓上) で評価しており、
  //   その値は一度も使われていなかったので誰も気づかなかった (2026-09-12 AZ5 で実測・変数ごと置換)。
  const capAtFullscale = (c) => { applyRegime('fullscale'); const v = capacityOf(c, 6); applyRegime('tabletop'); return v; };
  const capMid = capAtFullscale(midOval);   // 実測 5
  const mm = runRace({ course: midOval, regime: 'fullscale', laps: 1, maxSec: 3, field: field('normal_fr', 6), crashRule: { rejoin: true, penaltySec: 3 } });
  ok(capMid >= 1 && capMid < 6, `治具 中オーバル (fullscale): 実態収容 ${capMid} 台 (1..5 = 「減らす」ケースの母体)`);
  ok(mm.fitReduced === 6 - capMid, `不一致 (fullscale×中オーバル×6台): fit ガードが ${mm.fitReduced}台 削減 (= 6-${capMid}・発走団子を防ぐ)`);
  // (D-2) 実態収容 0 台 → **走らせず NO_ROOM を投げる** (AZ5)。1 台へ丸めて「走った」ことにしない。
  const smallOval = buildFromSpec({ name: '小オーバル', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
  ok(capAtFullscale(smallOval) === 0, `治具 小オーバル (fullscale): 実態収容 0 台 (「走らせない」ケースの母体)`);
  let threw = null;
  try { runRace({ course: smallOval, regime: 'fullscale', laps: 1, maxSec: 3, field: field('normal_fr', 6), crashRule: { rejoin: true, penaltySec: 3 } }); }
  catch (e) { threw = e; }
  ok(threw !== null && threw.code === 'NO_ROOM', `収容 0 台: runRace が NO_ROOM で停止 (code=${threw && threw.code})=0 台のレースを成立させない`);
  // 旧挙動が実際に壊れていたことの測定 (1 台へ丸めた場合に、その 1 台が動けるか)。
  const one = runRace({ course: smallOval, regime: 'fullscale', laps: 1, maxSec: 3, field: field('normal_fr', 1), crashRule: { rejoin: true, penaltySec: 3 }, trackNet: true, fitGuard: false });
  // CAR.length も領域依存なので、比較する車長は **そのレースが走った領域 (fullscale)** の値で測る。
  applyRegime('fullscale'); const lenFS = CAR.length; applyRegime('tabletop');
  ok(one.netMax[0] < lenFS, `旧挙動の反証: 1 台へ丸めてもその車は ${one.netMax[0].toFixed(4)}m しか動けない (< fullscale 車長 ${lenFS.toFixed(3)}m)`);
  // capacity (実態容量を測る側) は fitGuard:false で素通し=団子を先に潰さない=AK7 を壊さない。
  // **収容 0 台でも NO_ROOM を投げない** (投げると AK7 が実態容量を測れなくなる)。
  const cap = runRace({ course: smallOval, regime: 'fullscale', laps: 1, maxSec: 3, field: field('normal_fr', 6), crashRule: { rejoin: true, penaltySec: 3 }, trackNet: true, fitGuard: false });
  ok(cap.fitReduced === 0, `capacity 経路 (fitGuard:false): fitReduced=0=素通し (収容 0 台でも投げない=実態容量を測れる=AK7 保全)`);
}

console.log('\n' + (fails === 0 ? '────────── AK5 周辺正常化ゲート: 全パス ○ ──────────' : `────────── AK5 ゲート: ✗ ${fails} 件 NG ──────────`));
process.exit(fails === 0 ? 0 : 1);
