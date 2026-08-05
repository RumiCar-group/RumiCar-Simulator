// AS10 常設アサーションゲート: 面内重力の2軸射影 (勾配の欠陥是正) と 横勾配 (カント/バンク) を機械で守る。
// 本番フローのみ (config.gPlane/gNormal/gLatOf・fleet.roadFrame/applyRoadFrame・buildFromSpec・CarV2/DynCar・
// runRace) を呼び、判定述語を検査側へ写し取らない (CI-8/CI-9)。exit 非0 = 失敗。
//
// 設計 (docs/physics_model.md §13.9/§13.12・決定ログ AS-10):
//   ・重力は路面平面に対して **3 成分へ完全分解**される — 面内の前方 / 面内の横 / 法線。
//       fwd = g_in·cos δ, left = −g_in·sin δ, gN = √(g² − g_in²)   (δ = θ − slopeDir)
//     AP10〜v6.4.0 は **left を落とし、法線に g をそのまま使っていた** ため、モデルが持つ重力の
//     大きさが向き θ に依存して膨らんでいた (√(g²+downhill²))。**「面内重力の大きさが θ に依らない」**
//     を不変条件として検査すれば、この欠陥は構造的に再発しない。
//   ・カント = `course.bank`[度] を「最急コーナーでのバンク角」とし、他は |κ|/κmax に線形。
//     ⇒ バンクコーナーの限界速度は **v² = R·g·(μ·cos φ + sin φ)**。**比**を取れば比例定数も μ の
//     絶対値も消えるので、実装の内部式を写し取らずに検査できる (AS8 の d_max・AS9 の g* と同型)。
//
// 章立て: A 面内重力の法則 (大きさ保存・射影・法線・検出力) / B カントのプロファイル則 (最急=最大・直線=0・
//         逆走不変・逆バンク・領域不変) / C 限界速度の閉形式を比で検査 (+本番 runRace の実走差分)
//         D 既定の完全縮退 (bank 未指定=全既存コースが no-op・平地 track は road=null) / E validate_courses
//         のフィールド検査 (検出力つき) / F standard エンジンは非対象であることの機械確認
import { CAR, CONST, SIM, REGIMES, gPlane, gNormal, gLatOf } from './public/js/config.js';
import { applyRegime, DYN, DynCar } from './public/js/physics_dyn.js';
import { CarV2 } from './public/js/physics_v2.js';
import { Car } from './public/js/physics.js';
import { roadFrame, applyRoadFrame } from './public/js/fleet.js';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';
import { checkFields } from './validate_courses.mjs';
import specs from './public/data/courses.json' with { type: 'json' };

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const DT = 1 / SIM.physicsHz;
const D2R = Math.PI / 180;
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);
const prog = (k) => { const p = PROGRAMS.find((x) => x.key === k); if (!p) throw new Error('no prog ' + k); return p; };
const scratch = { fwd: 0, left: 0 };

// ══ A. 面内重力の法則 ═══════════════════════════════════════════════════════════════
console.log('\n=== A: 面内重力の 2 軸射影 (法則・不変条件・検出力) ===');
{
  // A1 平地は完全 no-op (早期 return)。全凍結 f0〜f3・正準レースがここを通る。
  let allZero = true;
  for (let i = 0; i < 64; i++) {
    gPlane(0, 0, i * 0.1, i * 0.37, scratch);
    if (scratch.fwd !== 0 || scratch.left !== 0) allZero = false;
  }
  ok(allZero, 'A1 面内成分ゼロ (平地) は任意の θ/slopeDir で fwd=left=0 の完全 no-op');

  // A2 特徴的な向きでの射影 (下り向き / 直交 / 登り向き)。
  gPlane(1.4, 0, 0, 0, scratch);
  const a2a = scratch.fwd === 1.4 && scratch.left === 0;
  gPlane(1.4, 0, 0, Math.PI / 2, scratch);
  const a2b = Math.abs(scratch.fwd) < 1e-15 && rel(scratch.left, 1.4) < 1e-15;
  gPlane(1.4, 0, 0, Math.PI, scratch);
  const a2c = rel(scratch.fwd, -1.4) < 1e-15 && Math.abs(scratch.left) < 1e-15;
  ok(a2a && a2b && a2c, 'A2 θ=slopeDir で全て前方 / 直交で全て横 (符号は車体左=世界の下り側) / 反対向きで前方に −');

  // A3 **不変条件**: 面内重力の大きさは車の向き θ に依らない (= ベクトルを完全に射影している証拠)。
  //    AP10 の欠陥 (left を落とす) はこの述語で必ず落ちる。**検出力を同梱**する。
  let worst = 0, worstBroken = 0;
  const gIn = Math.hypot(1.4, 0.9);
  for (let i = 0; i < 360; i++) {
    const th = i * D2R;
    gPlane(1.4, 0.9, th, 0.3, scratch);
    worst = Math.max(worst, rel(Math.hypot(scratch.fwd, scratch.left), gIn));
    worstBroken = Math.max(worstBroken, rel(Math.abs(scratch.fwd), gIn));   // left を捨てた実装の再現
  }
  ok(worst <= 1e-15, `A3 面内重力の大きさが θ に依らない (360 方位・最大相対差 ${worst.toExponential(2)} ≤1e-15)`);
  ok(worstBroken > 0.5, `A3' 検出力: 横成分を落とすと同じ述語が最大 ${(worstBroken * 100).toFixed(1)}% ずれて必ず落ちる`);

  // A4 法線成分: gN²+gIn² = g² (重力の大きさの保存)。平地は g の厳密恒等 (byte 不変の根拠)。
  const g = 9.81;
  ok(gNormal(g, 0, 0) === g, 'A4 平地の法線重力は g の厳密恒等 (式に入れない guarded branch=byte 不変)');
  let wN = 0;
  for (const [dh, gl] of [[1.49, 0], [0, 3.35], [1.22, 2.0], [0.69, 0.5]]) {
    const gN = gNormal(g, dh, gl);
    wN = Math.max(wN, rel(gN * gN + dh * dh + gl * gl, g * g));
  }
  ok(wN <= 1e-15, `A4' 法線²+面内² = g² (重力の大きさが保存・最大相対差 ${wN.toExponential(2)})`);

  // A5 本番の車が実際にその力を受けている (エンジン側の配線)。downhill のみ・直交向きで、
  //    1 サブステップで生じる横速度が理論値 gLeft·dt に一致すること (低速キネマブレンドを避けるため
  //    十分な速度を与える)。**車から読む** (式を検査側で組み直さない)。
  applyRegime('tabletop');
  const mkV2 = (theta, slopeDir, dh, gl) => {
    const c = new CarV2({ x: 0, y: 0, theta, grip: 1 });
    c.type = 'normal_fr'; c.downhill = dh; c.slopeDir = slopeDir; c.gLat = gl;
    c.driveDir = CONST.FREE; c.pwm = 0; c.u = 0.5 * CAR.maxSpeed;
    return c;
  };
  const c0 = mkV2(0, 0, 1.4, 0), c90 = mkV2(0, Math.PI / 2, 1.4, 0);
  c0.step(DT); c90.step(DT);
  ok(Math.abs(c90.vlat) > 1e-4 && Math.abs(c0.vlat) < Math.abs(c90.vlat),
    `A5 v2 の車が横重力を実際に受ける (直交向き vlat=${c90.vlat.toExponential(3)} ≫ 下り向き ${c0.vlat.toExponential(3)})`);
  const d0 = new DynCar({ x: 0, y: 0, theta: 0, grip: 1 }); d0.type = 'normal_fr';
  d0.downhill = 1.4; d0.slopeDir = Math.PI / 2; d0.driveDir = CONST.FREE; d0.u = 0.5 * CAR.maxSpeed;
  d0.step(DT);
  ok(Math.abs(d0.vlat) > 1e-4, `A5' dynamic エンジンでも横重力が効く (vlat=${d0.vlat.toExponential(3)})`);
}

// ══ B. カントのプロファイル則 ═════════════════════════════════════════════════════════
console.log('\n=== B: カント (bank) の道追従プロファイル ===');
// 検査台: 定半径の円 track (最急=どこでも同じ) と、直線＋ヘアピンを持つ峠 (最急/直線の差が出る)。
const ovalSpec = (bank) => ({ name: 'AS10 円 (検査用)', kind: 'track', shape: 'ellipse', rx: 1.0, ry: 1.0, samples: 96, width: 0.5, ...(bank !== undefined ? { bank } : {}) });
const tougeSpec = (bank) => ({ ...specs.find((s) => s.kind === 'touge' && s.style !== 'winding'), name: 'AS10 峠 (検査用)', ...(bank !== undefined ? { bank } : {}) });
{
  const g = DYN.g;
  // B1 bank 未指定 / 0 は完全 no-op (roadFrame が null か gLat が全点 0)。
  const flatOval = buildFromSpec(ovalSpec(undefined));
  ok(roadFrame(flatOval) === null, 'B1 bank 未指定の平坦 track は roadFrame=null (毎サブステップの処理に一切入らない)');
  const rfT0 = roadFrame(buildFromSpec(tougeSpec(0)));
  const car0 = new Car({ x: 0, y: 0, theta: 0 });
  let maxG0 = 0;
  for (const p of rfT0.cl) { car0.x = p[0]; car0.y = p[1]; applyRoadFrame(car0, rfT0); maxG0 = Math.max(maxG0, Math.abs(car0.gLat)); }
  ok(maxG0 === 0, 'B1\' 峠 (downhill≠0) でも bank=0 なら gLat は全点で厳密 0');

  // B2 最急コーナーで |gLat| = g·sin(bank)・直線で 0。円は曲率一定ゆえ全点で最大。
  const BANK = 18;
  const rfOv = roadFrame(buildFromSpec(ovalSpec(BANK)));
  const expect = g * Math.sin(BANK * D2R);
  let mn = Infinity, mx = -Infinity;
  const carP = new Car({ x: 0, y: 0, theta: 0 });
  for (const p of rfOv.cl) { carP.x = p[0]; carP.y = p[1]; applyRoadFrame(carP, rfOv); mn = Math.min(mn, carP.gLat); mx = Math.max(mx, carP.gLat); }
  ok(rel(mx, expect) < 0.02 && mn > 0, `B2 定曲率の円は全点で最大バンク: gLat∈[${mn.toFixed(4)},${mx.toFixed(4)}] ≈ g·sin${BANK}°=${expect.toFixed(4)}`);
  const rfTg = roadFrame(buildFromSpec(tougeSpec(BANK)));
  let tgMax = 0, tgMin = Infinity;
  for (const p of rfTg.cl) { carP.x = p[0]; carP.y = p[1]; applyRoadFrame(carP, rfTg); tgMax = Math.max(tgMax, Math.abs(carP.gLat)); tgMin = Math.min(tgMin, Math.abs(carP.gLat)); }
  ok(rel(tgMax, expect) < 0.02 && tgMin < 0.05 * expect,
    `B2' 峠は最急ヘアピンで最大 (${tgMax.toFixed(4)}≈${expect.toFixed(4)})・直線でほぼ 0 (${tgMin.toFixed(4)})`);

  // B3 **逆走不変**: 中心線を反転しても世界系でのバンク方向は同じ (実在のバンクと同じ性質)。
  //    接線が反転すると「左」も反転するが、符号付き曲率も反転するため積 (=世界ベクトル) は不変。
  //    **照会点は頂点を避ける**: 頂点はちょうど隣り合う 2 セグメントから等距離で、最近傍探索が
  //    タイ (同点) になる。タイの決着は走査順で決まるので進行方向を反転すると別のセグメントが選ばれ、
  //    接線が 1 セグメント分 (96 角形で 3.75°) ずれる。これは AP11 から続く「区分定数の slopeDir」の
  //    解像度そのものであってカントの非対称性ではない — 下の B3'' でその大きさを実測して記録する。
  const revSpec = { name: 'AS10 円 逆', kind: 'track', shape: 'polyline', width: 0.5,
    centerline: buildFromSpec(ovalSpec(undefined)).centerline.slice().reverse(), bank: BANK };
  const rfRev = roadFrame(buildFromSpec(revSpec));
  const cA = new Car({ x: 0, y: 0, theta: 0 }), cB = new Car({ x: 0, y: 0, theta: 0 });
  const bankVecDiff = (pts) => {
    let worst = 0;
    for (const p of pts) {
      cA.x = cB.x = p[0]; cA.y = cB.y = p[1];
      applyRoadFrame(cA, rfOv); applyRoadFrame(cB, rfRev);
      // 世界系のバンク方向 = slopeDir の左 90° 向きに gLat。逆走では slopeDir が π ずれ gLat の符号も
      // 反転する ⇒ 世界ベクトルは同じになるはず。ベクトルの差で比べる。
      const angA = cA.slopeDir + Math.PI / 2, angB = cB.slopeDir + Math.PI / 2;
      const vx = Math.cos(angA) * cA.gLat - Math.cos(angB) * cB.gLat;
      const vy = Math.sin(angA) * cA.gLat - Math.sin(angB) * cB.gLat;
      worst = Math.max(worst, Math.hypot(vx, vy));
    }
    return worst;
  };
  const mids = [], verts = rfOv.cl;
  for (let i = 0; i < rfOv.nSeg; i++) { const a = rfOv.cl[i], b = rfOv.cl[(i + 1) % rfOv.n]; mids.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); }
  const dMid = bankVecDiff(mids), dVert = bankVecDiff(verts);
  ok(dMid / expect < 1e-9,
    `B3 逆走不変: セグメント内部 (${mids.length} 中点) で世界系バンクベクトルの差は ${dMid.toExponential(2)} (相対 ${(dMid / expect).toExponential(2)} = 倍精度ノイズ)`);
  // 頂点のタイのずれは「接線が 1 セグメント分回る」ことの厳密な帰結: 等長 2 ベクトルが角 Δ=2π/nSeg
  // 開くときの差は 2E·sin(Δ/2)。**この予測値と一致すること**を検査する (=ずれの正体を確定させる。
  // 「小さいから見逃す」ではなく「大きさが構造から予測できる」で閉じる)。
  const predVert = 2 * expect * Math.sin(Math.PI / rfOv.nSeg);
  ok(rel(dVert, predVert) < 1e-6,
    `B3'' 頂点のタイのずれは接線 1 セグメント分 (${(360 / rfOv.nSeg).toFixed(2)}°) の厳密な帰結: 実測 ${dVert.toFixed(6)} = 予測 2E·sin(π/n)=${predVert.toFixed(6)} (AP11 由来の区分定数 slopeDir の解像度であってカントの非対称ではない)`);

  // B4 負値 = 逆バンク (符号が反転するだけ・大きさは同じ)。
  const rfNeg = roadFrame(buildFromSpec(ovalSpec(-BANK)));
  let worstNeg = 0;
  for (const p of rfOv.cl) {
    cA.x = cB.x = p[0]; cA.y = cB.y = p[1];
    applyRoadFrame(cA, rfOv); applyRoadFrame(cB, rfNeg);
    worstNeg = Math.max(worstNeg, Math.abs(cA.gLat + cB.gLat));
  }
  ok(worstNeg <= 1e-15, `B4 負値は厳密な符号反転 (逆バンク・最大残差 ${worstNeg.toExponential(2)})`);

  // B5 **領域不変** (AS7 申し送り(ii)「新しい閾値/量を足したら崖を測る」への応答)。
  //    gLat/g = sin(bank)·(κ/κmax) は無次元・幾何のみ ⇒ 領域で変わりようがない。実測で確かめる。
  const vals = [];
  for (const r of ['tabletop', 'midscale', 'fullscale']) {
    applyRegime(r);
    const rf = roadFrame(buildFromSpec(ovalSpec(BANK)));
    const c = new Car({ x: rf.cl[0][0], y: rf.cl[0][1], theta: 0 });
    applyRoadFrame(c, rf);
    vals.push(c.gLat / DYN.g);
  }
  const spread = Math.max(...vals) - Math.min(...vals);
  ok(spread <= 1e-15, `B5 領域不変: gLat/g = ${vals.map((v) => v.toFixed(9)).join(' / ')} 振れ ${spread.toExponential(2)} (崖なし)`);
  applyRegime('tabletop');
}

// ══ C. 限界速度の閉形式を「比」で検査 ══════════════════════════════════════════════════
console.log('\n=== C: バンクコーナーの限界速度 v²=R·g·(μ·cosφ + sinφ) を比で検査 ===');
{
  // 本番の車が「今そこで出せる横グリップ容量」は car._latCapSS (Σμ_i·Fz_i) が毎ステップ実測して持つ
  // (AO2 の不変条件オラクル)。μ の絶対値も比例定数も **比を取れば消える** ので、実装の内部式を
  // 検査側へ写し取らずに閉形式を検査できる。
  //   v_max² = R·(容量 + 面内重力の内向き成分) = R·(μ·gN + g·sinφ)
  //   ⇒ v_max(φ)²/v_max(0)² = gN/g + g·sinφ/(μ·g) = cosφ + sinφ/μ
  // すなわち検査は 2 本に分解できる: ① 容量が cosφ 倍に縮む ② 内向き重力が g·sinφ。
  applyRegime('tabletop');
  const g = DYN.g;
  const capAt = (gl) => {
    const c = new CarV2({ x: 0, y: 0, theta: 0, grip: 1 });
    c.type = 'normal_fr'; c.tireSet = 'normal'; c.gLat = gl; c.downhill = 0; c.slopeDir = 0;
    c.driveDir = CONST.FREE; c.pwm = 0; c.u = 0;
    c.step(DT);
    return c._latCapSS;
  };
  const cap0 = capAt(0);
  const mu = cap0 / g;                       // **本番の車から実測した μ** (定数を検査側に書かない)
  console.log(`     基準: 横グリップ容量 ${cap0.toFixed(6)} m/s² ⇒ 実効 μ=${mu.toFixed(6)} (卓上 normal)`);
  let worstC = 0;
  const rows = [];
  for (const phi of [5, 10, 15, 20, 25, 30]) {
    const gl = g * Math.sin(phi * D2R);
    const capPhi = capAt(gl);
    const ratioMeas = capPhi / cap0 + gl / cap0;               // 実測 (v_max² の比)
    const ratioPred = Math.cos(phi * D2R) + Math.sin(phi * D2R) / mu;  // 閉形式
    const e = rel(ratioMeas, ratioPred);
    worstC = Math.max(worstC, e);
    rows.push(`     φ=${String(phi).padStart(2)}°  容量比 ${(capPhi / cap0).toFixed(6)} (=cosφ ${Math.cos(phi * D2R).toFixed(6)})  v²比 実測 ${ratioMeas.toFixed(6)} / 閉形式 ${ratioPred.toFixed(6)}  相対差 ${e.toExponential(2)}`);
  }
  rows.forEach((r) => console.log(r));
  ok(worstC < 1e-12, `C1 限界速度の閉形式が 6 バンク角すべてで一致 (最大相対差 ${worstC.toExponential(2)})`);

  // C2 **検出力**: 法線荷重の cos 因子を落とした実装 (gN=g) では容量比が 1 のままになり、閉形式との
  //    差が φ=30° で 13.4% 出る。緑が検査の鈍さでないことを実測で示す。
  const brokenErr = rel(1 + Math.sin(30 * D2R) / mu, Math.cos(30 * D2R) + Math.sin(30 * D2R) / mu);
  ok(brokenErr > 0.02, `C2 検出力: 法線の cosφ を落とすと φ=30° で ${(brokenErr * 100).toFixed(1)}% ずれて必ず落ちる`);

  // C3 **同一プログラムのコーナリング限界速度の変化 (本番 runRace)** — ③' の実走側。定半径コーナーを
  //    持つ stadium で既定サンプル `normal_fr` を走らせ、**バンク角を掃引**して連続量 (周回時間・平均
  //    通過速度) の動きを測る。単一の 0/1 比較でなく掃引の**単調性**で述べる (Stage AS 共通の測定作法)。
  const runOval = (bank) => {
    const c = buildFromSpec({ name: 'AS10 バンク検査オーバル', kind: 'track', shape: 'stadium', L: 1.6, rr: 0.62, samples: 120, width: 0.42, ...(bank ? { bank } : {}) });
    const p = prog('normal_fr');
    let vMax = 0, vSum = 0, n = 0;
    const r = runRace({
      course: c, regime: 'tabletop', laps: 3, interact: false,
      field: [{ name: 'fr', lang: p.lang || 'c', src: p.code, carType: 'normal_fr' }],
      probe: (tick, slots) => { const car = slots[0].car; if (car.crashed) return; const v = Math.abs(car.u); vMax = Math.max(vMax, v); vSum += v; n++; },
    });
    return { bank, fin: r.finishers.length, ms: r.finishers[0] ? Math.round(r.finishers[0].totalTimeMs) : null, vMax, vAvg: n ? vSum / n : 0, hash: r.verifyHash };
  };
  const SWEEP = [0, 2, 4, 6, 10];
  const sw = SWEEP.map(runOval);
  for (const s of sw) console.log(`     bank=${String(s.bank).padStart(2)}°  完走 ${s.fin}  周回 ${s.ms}ms  平均 ${s.vAvg.toFixed(4)} m/s  hash ${s.hash}`);
  ok(sw[0].hash !== sw[SWEEP.length - 1].hash, 'C3 同一コース・同一プログラムでもバンクの有無で走りが変わる (verifyHash が別)');
  const monoV = sw.every((s, i) => i === 0 || s.vAvg > sw[i - 1].vAvg);
  const monoT = sw.every((s, i) => i === 0 || (s.ms != null && s.ms < sw[i - 1].ms));
  ok(monoV && monoT,
    `C3' 0→10° の掃引で平均通過速度が単調増加・周回時間が単調減少 (${sw[0].ms}→${sw[sw.length - 1].ms}ms = ${((sw[sw.length - 1].ms / sw[0].ms - 1) * 100).toFixed(2)}%・平均 ${sw[0].vAvg.toFixed(4)}→${sw[sw.length - 1].vAvg.toFixed(4)} m/s)`);

  // C3'' **法則と走りは別物** (AS9 の「lap の交差点は容量の交差点と一致しない」と同型)。閉形式の限界速度
  //    は φ=atan(1/μ)≈51° まで単調に上がり続けるが、**プログラムが使えるとは限らない**。20° では
  //    内向きの重力 (g·sin20°=3.36 m/s²) が 3 値操舵の修正より速く車を内側へ寄せ、実走は完走しなくなる。
  //    「限界が上がる」と「速く走れる」を分けて記録する (代理量でなく実態・CI-14)。
  const over = runOval(20);
  const limAt = (phi) => Math.cos(phi * D2R) + Math.sin(phi * D2R) / mu;   // v_max² の比 (C1 の閉形式)
  console.log(`     bank=20°  完走 ${over.fin}  周回 ${over.ms}ms  平均 ${over.vAvg.toFixed(4)} m/s   ← 過バンク`);
  console.log(`     閉形式の限界速度比: 10°→${limAt(10).toFixed(4)} / 20°→${limAt(20).toFixed(4)} / 51°(最大)→${limAt(Math.atan(1 / mu) / D2R).toFixed(4)}`);
  ok(limAt(20) > limAt(10) && over.vAvg < sw[SWEEP.length - 1].vAvg,
    `C3'' 過バンク: 閉形式の限界は 20° の方が高い (${limAt(10).toFixed(4)}→${limAt(20).toFixed(4)}) のに実走は遅く/完走しない (平均 ${sw[sw.length - 1].vAvg.toFixed(4)}→${over.vAvg.toFixed(4)}) = 限界の上昇をプログラムが使えていない`);
}

// ══ D. 既定の完全縮退 ═════════════════════════════════════════════════════════════════
console.log('\n=== D: 既定 (bank 未指定) の完全縮退 ===');
{
  applyRegime('tabletop');
  // D1 出荷 41 コースは 1 件も bank を持たない ⇒ course.bank===0。
  const withBank = specs.filter((s) => s.bank !== undefined);
  ok(withBank.length === 0, `D1 出荷 ${specs.length} コースに bank を持つものは 0 件 (${withBank.map((s) => s.name).join(',') || 'なし'})`);
  // D2 平地コース (峠以外) は roadFrame=null ⇒ 毎サブステップの処理に一切入らない。
  const nonTouge = specs.filter((s) => s.kind !== 'touge');
  const nulls = nonTouge.filter((s) => roadFrame(buildFromSpec(s)) === null).length;
  ok(nulls === nonTouge.length, `D2 非峠 ${nonTouge.length} コースすべてで roadFrame=null (完全 no-op)`);
  // D3 峠は downhill≠0 ゆえ従来どおりフレームを持つが gLat は常に 0 (=AP11 の挙動そのまま)。
  const touge = specs.filter((s) => s.kind === 'touge');
  let tougeAllZero = true, tougeFrames = 0;
  const probe = new Car({ x: 0, y: 0, theta: 0 });
  for (const s of touge) {
    const rf = roadFrame(buildFromSpec(s));
    if (!rf) continue;
    tougeFrames++;
    for (const p of rf.cl) { probe.x = p[0]; probe.y = p[1]; applyRoadFrame(probe, rf); if (probe.gLat !== 0) tougeAllZero = false; }
  }
  ok(tougeFrames === touge.length && tougeAllZero, `D3 峠 ${tougeFrames}/${touge.length} 件はフレームを持ち gLat は全点で厳密 0`);
  // D4 gLatOf は bank===0 で厳密 0 を返す (式に入れない guarded branch)。
  let z = true;
  for (let i = -20; i <= 20; i++) if (gLatOf(9.81, 0, i / 20) !== 0) z = false;
  ok(z, 'D4 gLatOf(bank=0) は任意の曲率で厳密 0 (guarded branch)');
}

// ══ E. validate_courses のフィールド検査 ══════════════════════════════════════════════
console.log('\n=== E: validate_courses.mjs の bank フィールド検査 ===');
{
  ok(checkFields(specs).length === 0, `E1 出荷 ${specs.length} コースはフィールドエラー 0 件`);
  const bad = [
    { name: 'x1', kind: 'track', bank: 90 },        // 値域外
    { name: 'x2', kind: 'raw', bank: 5 },           // 非対応 kind (中心線なし)
    { name: 'x3', kind: 'track', bank: 'すごい' },   // 非数値
    { name: 'x4', kind: 'touge', bank: NaN },       // 非有限
  ];
  const errs = checkFields(bad);
  ok(errs.length === 4, `E2 検出力: 不正 4 件をすべて検出 (${errs.length}/4)`);
  ok(checkFields([{ name: 'ok1', kind: 'track', bank: 20 }, { name: 'ok2', kind: 'touge', bank: -8 }, { name: 'ok3', kind: 'annulus' }]).length === 0,
    'E3 正常値 (track +20° / touge −8° / bank 無し annulus) は 0 件');
}

// ══ F. standard エンジンは非対象 (④' の正直な明記を機械で固定) ═══════════════════════════
console.log('\n=== F: standard (クラシック) エンジンはカントを解釈しない ===');
{
  applyRegime('tabletop');
  // Car は横速度 vlat を持たないスカラー速度モデル。gLat を与えても軌跡が変わらないことを実測し、
  // 「非対応」を推測でなく機械で固定する (docs/physics_model.md §13.12 の記述と対応)。
  const mk = (gl) => { const c = new Car({ x: 0, y: 0, theta: 0 }); c.type = 'normal_fr'; c.gLat = gl; c.downhill = 0; c.slopeDir = 0; c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.CENTER; return c; };
  const s0 = mk(0), s1 = mk(3.0);
  for (let i = 0; i < 120; i++) { s0.step(DT); s1.step(DT); }
  ok(s0.x === s1.x && s0.y === s1.y && s0.theta === s1.theta,
    `F1 standard は gLat を無視 (120 step 後の座標が厳密一致 x=${s0.x.toFixed(6)})`);
  // 対照: 同条件で dynamic は変わる (=「どのエンジンも無視する」という壊れ方を検出する)。
  const mkD = (gl) => { const c = new DynCar({ x: 0, y: 0, theta: 0, grip: 1 }); c.type = 'normal_fr'; c.gLat = gl; c.downhill = 0; c.slopeDir = 0; c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.CENTER; return c; };
  const d0 = mkD(0), d1 = mkD(3.0);
  for (let i = 0; i < 120; i++) { d0.step(DT); d1.step(DT); }
  ok(d0.y !== d1.y, `F2 対照: dynamic は同じ入力で横へ動く (Δy=${(d1.y - d0.y).toExponential(3)})`);
  // v2 も同様 (対照2)。
  const mkV = (gl) => { const c = new CarV2({ x: 0, y: 0, theta: 0, grip: 1 }); c.type = 'normal_fr'; c.gLat = gl; c.downhill = 0; c.slopeDir = 0; c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.CENTER; return c; };
  const v0 = mkV(0), v1 = mkV(3.0);
  for (let i = 0; i < 120; i++) { v0.step(DT); v1.step(DT); }
  ok(v0.y !== v1.y, `F3 対照: v2 も同じ入力で横へ動く (Δy=${(v1.y - v0.y).toExponential(3)})`);
}

console.log(`\n合計: PASS ${pass} / FAIL ${fail}`);
if (fail > 0) { console.error('FAIL: AS10 ゲート不合格'); process.exit(1); }
console.log('OK: AS10 ゲート合格');
