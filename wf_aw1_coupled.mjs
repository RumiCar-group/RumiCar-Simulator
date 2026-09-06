// wf_aw1_coupled.mjs — Stage AW1「車輪 ODE と車体加速度の同一 substep 連成（2 パス）」受け入れゲート。
// ══════════════════════════════════════════════════════════════════════════════════════
// 背景: AP13（v4.0.0）は卓上/中スケールの v2 で車輪 ODE を半陰的化して nSub を約 1/9 にしたが、陰的更新の間
// **接地速度 vcx を凍結**していた（作用素分割）。車体が減速して vcx が毎 substep 下がるのに輪が追随できず、
// **指令より小さい力しか路面へ届かない**（AV3 実測: 卓上 motor で参照解の −36%・中スケール −32%・誤差 ∝ h·kD）。
// AW1 は _substep を 2 パス（①全輪の力→車体加速度 ②同一 substep の接地速度変化 Δvcx を滑り変数の陰的更新へ）
// にして是正した。前 substep の Δvcx を使う予測子は AV3 で 4 輪制動が周期 2 振動したので**禁止**。
//
// **再実装せず 実 CarV2.step / _substep / applyRegime / V2 を呼ぶ**（CI-14。参照解も同じ製品コードの陽的経路）。
//
// 構成:
//   [A] 陽的経路（fullscale・低グリップ）の byte 不変 — 凍結値（f2/f3 は wf_ab8_bench）に加え、本ゲートが刻む
//       版付き回帰指紋（A1: 発走 20 s・全舵 8 s・motor/friction 制動の 6 ケース／A2: REVERSE 全舵 8 s の 12 ケース）。
//       改修前（v7.8.0）に採った指紋と一致すること。
//   [B] 参照解との一致 — 同じ製品コードの陽的経路（V2.siActive=false → step() が needW を課す原 explicit）を
//       参照解にして、卓上/中スケール × motor/friction の直線全制動の減速度（実終速で計算）が ±5%・実力/指令比が ±0.05。
//   [C] 安定性 — 本番 step() の実 nSub のまま _substep を計装し、洗い流し（全輪 fx ≤ 0）に到達し、到達後の ΣFx>0 substep = 0・
//       後輪 fx の符号交替率 < 5%・KE 増 0（AV3 で予測子が落ちた条件そのもの）。
//   [D] A/B 特性化（AP13 と同じ量＋停止距離）— 終速・定常旋回半径・βmax は参照解と相対 1e-3 以内、発走距離は ±2%。
//   [G] REVERSE（半陰的経路）— 静止から全舵・高速後退→全舵・高速後退→半舵（prop 128）× FF/AWD/FR × 卓上/中スケールの
//       後退速度・半径・βmax が参照解と ±2%（初版の Δvlat 陽的予測が壊した経路）。
//   [E] 旋回中制動の掃引（4 車種 × 3 装備 × 3 grip × 3 半径）で 非有限 0・摩擦円 ≤0・散逸 ≤0・κ クランプ 0
//       （_kapClampN/_kapWheel は _substep ごとの診断量なので _substep を包んで全 substep を積算する）。
//   [F] 性能 — avgNSub（卓上 normal・直線＋旋回）が AP13 の受け入れ ≤32 を維持（半陰的化の効果を失っていない）。
//
// 使い方:  node wf_aw1_coupled.mjs          # アサート緑/赤で exit 0/1
//          node wf_aw1_coupled.mjs --print  # 指紋の現在値を印字（版で物理を意図的に変えたときに刻み直す）
// ══════════════════════════════════════════════════════════════════════════════════════
import { CarV2, V2, tireParamsFor } from './public/js/physics_v2.js';
import { applyRegime, DYN } from './public/js/physics_dyn.js';
import { CAR, CONST, setPhysicsMode, APP_VERSION } from './public/js/config.js';

const PRINT = process.argv.includes('--print');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const DT = 1 / 60, deg = 180 / Math.PI;
setPhysicsMode('v2');
console.log(`\n[AW1] 車輪 ODE と車体加速度の同一 substep 連成  APP=${APP_VERSION}`);

// ── 共通部品 ─────────────────────────────────────────────────────────────────────────
const mk = (type, tire, grip, brake) => { const c = new CarV2({ x: 0, y: 0, theta: 0, grip }); c.type = type; c.tireSet = tire; if (brake) c.brakeSet = brake; return c; };
const fp = (arr) => { let h = 2166136261; for (const v of arr) { const s = v.toString(); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } } return h.toString(16).padStart(8, '0'); };
// 直線全制動: 0.7·maxSpeed へ加速 → BRAKE → 0.2 倍まで。減速度は実終速で計算（AV3 #31）。
function straightStop(type, tire, grip, brake) {
  const c = mk(type, tire, grip, brake); c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.CENTER; c.steerAmt = null;
  const U0 = 0.7 * CAR.maxSpeed;
  for (let i = 0; i < 40000 && c.u < U0; i++) c.step(DT);
  const u0 = c.u, x0 = c.x, uEnd = 0.2 * U0;
  c.driveDir = CONST.BRAKE; c.pwm = 0;
  let sfx = 0, sfa = 0, n = 0;
  for (let i = 0; i < 40000 && c.u > uEnd; i++) { c.step(DT); n++; sfx += Math.abs(c._fxWheel.reduce((a, v) => a + v, 0)); sfa += Math.abs(c._fAppWheel.reduce((a, v) => a + v, 0)); }
  return { a: (u0 * u0 - c.u * c.u) / (2 * (c.x - x0)), dist: c.x - x0, deliver: sfx / Math.max(sfa, 1e-9), u0, n };
}
// 参照解＝同じ製品コードの陽的経路（V2.siActive=false で step() が needW を課す原 explicit・nSub 上限 256。
// AV3 で上限 4096 でも 0.1% 以内に収束することを確認済）。applyRegime が siActive を再計算するので run 後に復元する。
function withExplicit(fn) { const keep = V2.siActive; V2.siActive = false; try { return fn(); } finally { V2.siActive = keep; } }

// ══ A. 陽的経路の byte 不変（版付き回帰指紋）══════════════════════════════════════════
console.log('\n=== A: 陽的経路（fullscale・低グリップ）の回帰指紋 ===');
{
  // 指紋は改修前（v7.8.0 の physics_v2.js）と AW1 で同一であることを実測して刻んだ（2026-09-06）。
  // 物理を意図的に変えた版では --print で刻み直す（f0〜f3 と同じ「版付き回帰記録」・AP-0）。
  const EXPECT = { 'fullscale/normal_fr/normal': '7a378380', 'fullscale/normal_fr/slip': '11a2ebe1', 'fullscale/drift_fr/normal': 'c0a27af3', 'fullscale/normal_awd/normal': '04716682', 'tabletop/normal_fr/slip': '9f8fc7a2', 'midscale/normal_fr/slip': '2f766a27' };
  // REVERSE（後退・全舵 8 s）の陽的経路指紋（敵対的レビュー #1: REVERSE は ⑧ が横速度を半陰的に積分するので独立に固定する）。
  const EXPECT_REV = { 'fullscale/normal_ff/normal': 'b92e1953', 'fullscale/normal_ff/slip': '8c73a0a5', 'fullscale/normal_awd/normal': '4188dda6', 'fullscale/normal_awd/slip': 'ea669420', 'fullscale/normal_fr/normal': 'abd1ffa7', 'fullscale/normal_fr/slip': 'c34aa80b',
                       'tabletop/normal_ff/slip': 'aa443828', 'tabletop/normal_awd/slip': '0967ef78', 'tabletop/normal_fr/slip': '77384475', 'midscale/normal_ff/slip': '078bfe48', 'midscale/normal_awd/slip': '894219dd', 'midscale/normal_fr/slip': '431da6a3' };
  const revFp = (rg, type, tire) => { applyRegime(rg); const c = mk(type, tire, 1.0); c.driveDir = CONST.REVERSE; c.pwm = 255; c.steer = CONST.LEFT; c.steerAmt = null;
    for (let i = 0; i < 480; i++) c.step(DT); return { fp: fp([c.x, c.y, c.theta, c.u, c.vlat, c.r, ...c._vw]), si: V2.siActive && tireParamsFor(tire).mu0 >= V2.siMinMu }; };
  const runFp = (rg, type, tire, grip) => {
    applyRegime(rg);
    let c = mk(type, tire, grip); c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.CENTER; let x1 = 0;
    for (let i = 0; i < 1200; i++) { c.step(DT); if (i === 59) x1 = c.x; }
    const st1 = [c.x, c.y, c.u, c.vlat, c.r, ...c._vw];
    c = mk(type, tire, grip); c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.LEFT;
    for (let i = 0; i < 480; i++) c.step(DT);
    const st2 = [c.x, c.y, c.u, c.vlat, c.r, ...c._vw];
    const stop = (b) => { const d = mk(type, tire, grip, b); d.driveDir = CONST.FORWARD; d.pwm = 255; d.steer = CONST.CENTER; const U0 = 0.7 * CAR.maxSpeed;
      for (let i = 0; i < 40000 && d.u < U0; i++) d.step(DT); const x0 = d.x; d.driveDir = CONST.BRAKE; d.pwm = 0;
      for (let i = 0; i < 40000 && d.u > 0.2 * U0; i++) d.step(DT); return [d.x, d.u, ...d._vw]; };
    return { fp: fp([...st1, ...st2, ...stop('motor'), ...stop('friction')]), si: V2.siActive && tireParamsFor(tire).mu0 * grip >= V2.siMinMu };
  };
  const cases = [['fullscale', 'normal_fr', 'normal', 1.0], ['fullscale', 'normal_fr', 'slip', 1.0], ['fullscale', 'drift_fr', 'normal', 1.0], ['fullscale', 'normal_awd', 'normal', 0.6], ['tabletop', 'normal_fr', 'slip', 1.0], ['midscale', 'normal_fr', 'slip', 1.0]];
  let match = 0;
  for (const [rg, type, tire, grip] of cases) {
    const key = `${rg}/${type}/${tire}`; const r = runFp(rg, type, tire, grip);
    if (PRINT) console.log(`     '${key}': '${r.fp}',  // si=${r.si}`);
    if (r.fp === EXPECT[key]) match++; else console.log(`     指紋不一致 ${key}: 期待 ${EXPECT[key]} 実測 ${r.fp}（半陰的=${r.si}）`);
    if (r.si) console.log(`     ⚠ ${key} は半陰的経路（siWheel=true）＝陽的経路の指紋ではない`);
  }
  ok(match === cases.length, `A1 陽的経路 ${cases.length} ケース（fullscale normal/slip/drift/awd・卓上 slip・中スケール slip）の軌跡指紋が改修前と一致（${match}/${cases.length}）＝AW1 は半陰的経路だけを変えた`);
  let matchR = 0; const keysR = Object.keys(EXPECT_REV);
  for (const key of keysR) { const [rg, type, tire] = key.split('/'); const r = revFp(rg, type, tire);
    if (PRINT) console.log(`     REV '${key}': '${r.fp}',  // si=${r.si}`);
    if (r.fp === EXPECT_REV[key]) matchR++; else console.log(`     REVERSE 指紋不一致 ${key}: 期待 ${EXPECT_REV[key]} 実測 ${r.fp}（半陰的=${r.si}）`); }
  ok(matchR === keysR.length, `A2 REVERSE（後退・全舵）の陽的経路 ${keysR.length} ケース（fullscale ff/awd/fr × normal/slip・卓上/中スケール slip）の指紋が改修前と一致（${matchR}/${keysR.length}）`);
  applyRegime('fullscale');
}

// ══ B. 参照解との一致 ═══════════════════════════════════════════════════════════════
console.log('\n=== B: 参照解（同じ製品コードの陽的経路）との一致 ===');
{
  const rows = []; let okA = 0, okD = 0;
  for (const rg of ['tabletop', 'midscale']) {
    applyRegime(rg);
    for (const b of ['motor', 'friction']) {
      const cur = straightStop('normal_fr', 'normal', 1.0, b);
      const ref = withExplicit(() => straightStop('normal_fr', 'normal', 1.0, b));
      const errA = cur.a / ref.a - 1, dD = cur.deliver - ref.deliver;
      rows.push({ rg, b, cur, ref, errA, dD });
      if (Math.abs(errA) <= 0.05) okA++; if (Math.abs(dD) <= 0.05) okD++;
      console.log(`     ${rg.padEnd(9)} ${b.padEnd(9)} a: AW1 ${cur.a.toFixed(3)} / 参照 ${ref.a.toFixed(3)} (${(100 * errA).toFixed(1)}%)  実力/指令: ${cur.deliver.toFixed(3)} / ${ref.deliver.toFixed(3)}  距離 ${cur.dist.toFixed(4)} / ${ref.dist.toFixed(4)} m  u0 ${cur.u0.toFixed(3)}/${ref.u0.toFixed(3)}`);
    }
  }
  applyRegime('fullscale');
  // B1 の ±5% は単独では AV3 の前 substep 予測子（motor −4.8%）を弾けない。予測子の弁別は B2（実力/指令 0.192）と C1（周期 2 振動）が担う（レビュー #7）。
  ok(okA === 4, `B1 **参照解との減速度差 ±5% 以内**（卓上/中スケール × motor/friction の 4 条件すべて・最悪 ${(100 * Math.max(...rows.map(r => Math.abs(r.errA)))).toFixed(1)}%）。AP13（v4.0.0〜v7.8.0）は卓上 motor で −36% だった`);
  ok(okD === 4, `B2 実力/指令比が参照解と ±0.05 以内（4 条件・最悪 ${Math.max(...rows.map(r => Math.abs(r.dD))).toFixed(3)}）`);
  // 非空振り: 参照解と AW1 は別の積分経路を通っている（同一実装の写しでない）＝nSub が桁違いに違うことで確認する。
  // applyRegime は siActive を再計算するので、withExplicit の **外** で領域を設定してから数える（初版は中で呼び直して同じ経路を数えていた）。
  const countSub = (fn) => { const c = mk('normal_fr', 'normal', 1.0); const o = c._substep.bind(c); let n = 0; c._substep = (h, sc) => { n++; o(h, sc); };
    c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.LEFT; for (let i = 0; i < 60; i++) fn(c); return n / 60; };
  applyRegime('tabletop');
  const nsCur = countSub((c) => c.step(DT)), nsRef = withExplicit(() => countSub((c) => c.step(DT)));
  applyRegime('fullscale');
  ok(nsRef > 4 * nsCur, `B3 非空振り: 参照解は原 explicit（avgNSub ${nsRef.toFixed(1)}）・AW1 は半陰的（${nsCur.toFixed(1)}）＝別の積分経路を比べている`);
}

// ══ C. 安定性（AV3 で予測子が落ちた条件）═══════════════════════════════════════════
console.log('\n=== C: 本番 nSub のままの substep 計装（ΣFx>0・後輪 fx 符号交替・KE 増）===');
{
  const rows = []; let allOk = true;
  for (const rg of ['tabletop', 'midscale']) {
    applyRegime(rg);
    for (const b of ['motor', 'friction']) {
      const c = mk('normal_fr', 'normal', 1.0, b); c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.CENTER; c.steerAmt = null;
      const U0 = 0.7 * CAR.maxSpeed; for (let i = 0; i < 40000 && c.u < U0; i++) c.step(DT);
      c.driveDir = CONST.BRAKE; c.pwm = 0;
      let n = 0, sumPos = 0, flips = 0, prevRs = 0, keUp = 0, prevKE = Infinity, washed = false, washAt = -1, posAfterWash = 0;
      const o = c._substep.bind(c);
      c._substep = (h, sc) => { o(h, sc); n++; const fx = c._fxWheel, s = fx[0] + fx[1] + fx[2] + fx[3];
        if (!washed && fx.every(v => v <= 0)) { washed = true; washAt = n; }
        if (s > 1e-9) { sumPos++; if (washed) posAfterWash++; }
        const rs = Math.sign(fx[2] + fx[3]); if (prevRs !== 0 && rs !== 0 && rs !== prevRs) flips++; if (rs !== 0) prevRs = rs;
        const ke = 0.5 * (c.u * c.u + c.vlat * c.vlat); if (washed && ke > prevKE + 1e-12) keUp++; prevKE = ke; };
      let ticks = 0; while (c.u > 0.2 * U0 && ticks < 40000) { c.step(DT); ticks++; }
      const flipRate = flips / Math.max(n, 1);
      rows.push({ rg, b, n, sumPos, posAfterWash, flips, flipRate, keUp, washed, washAt });
      // washed === true を課す（レビュー #7: 洗い流し未到達なら「洗い流し後 …=0」が空虚に真になる）
      if (!(washed && posAfterWash === 0 && flipRate < 0.05 && keUp === 0)) allOk = false;
      console.log(`     ${rg.padEnd(9)} ${b.padEnd(9)} substeps=${n}  洗い流し到達 substep ${washAt}  ΣFx>0: ${sumPos}（洗い流し後 ${posAfterWash}）  後輪fx符号交替 ${flips} (${(100 * flipRate).toFixed(1)}%)  洗い流し後 KE 増 ${keUp}`);
    }
  }
  applyRegime('fullscale');
  ok(allOk, `C1 **4 条件すべてで 洗い流し（全輪 fx ≤ 0）に到達し（substep ${rows.map(r => r.washAt).join('/')}）、到達後の ΣFx>0 = 0・後輪 fx 符号交替率 < 5%・KE 増 0**（AV3 の前 substep 予測子は同条件で 22%・83%・21 だった）`);
  ok(rows.every(r => r.sumPos >= 1), `C2 非空振り: 洗い流し相（BRAKE 直後に駆動輪の κ>0 が洗われるまで ΣFx>0）が各条件 1 substep 以上ある（${rows.map(r => r.sumPos).join('/')}）＝ΣFx の符号を実際に見ている`);
}

// ══ D. A/B 特性化（AP13 と同じ量＋停止距離）═══════════════════════════════════════
console.log('\n=== D: 終速・定常旋回半径・βmax・発走距離（参照解と突合）===');
{
  const charac = () => { const c1 = mk('normal_fr', 'normal', 1.0); c1.driveDir = CONST.FORWARD; c1.pwm = 255; c1.steer = CONST.CENTER; let x1 = 0;
    for (let i = 0; i < 1200; i++) { c1.step(DT); if (i === 59) x1 = c1.x; }
    const c2 = mk('normal_fr', 'normal', 1.0); c2.driveDir = CONST.FORWARD; c2.pwm = 255; c2.steer = CONST.LEFT; let bmax = 0;
    for (let i = 0; i < 480; i++) { c2.step(DT); if (i > 240) bmax = Math.max(bmax, Math.abs(Math.atan2(c2.vlat, Math.max(Math.abs(c2.u), 1e-6)))); }
    return { vTerm: c1.u, launch: x1, R: Math.abs(c2.u / c2.r), bmax: bmax * deg }; };
  let allOk = true;
  for (const rg of ['tabletop', 'midscale']) {
    applyRegime(rg);
    const cur = charac(), ref = withExplicit(charac);
    const rel = (a, b) => Math.abs(a / b - 1);
    const good = rel(cur.vTerm, ref.vTerm) < 1e-3 && rel(cur.R, ref.R) < 1e-3 && rel(cur.bmax, ref.bmax) < 1e-3 && rel(cur.launch, ref.launch) < 0.02;
    if (!good) allOk = false;
    console.log(`     ${rg.padEnd(9)} 終速 ${cur.vTerm.toFixed(4)}/${ref.vTerm.toFixed(4)}  定常半径 ${cur.R.toFixed(4)}/${ref.R.toFixed(4)}  βmax ${cur.bmax.toFixed(2)}°/${ref.bmax.toFixed(2)}°  発走 1s ${cur.launch.toFixed(4)}/${ref.launch.toFixed(4)} (${(100 * (cur.launch / ref.launch - 1)).toFixed(2)}%)`);
  }
  applyRegime('fullscale');
  ok(allOk, `D1 終速・定常旋回半径・βmax は参照解と相対 1e-3 以内、発走 1 s の距離は ±2% 以内（AP13 は発走が参照解比 −9%＝加速側も過小伝達だった）`);
}

// ══ G. REVERSE（半陰的経路）が参照解と一致 ═══════════════════════════════════════════════
// 【敵対的レビュー #1 で追加・検証者の残指摘で拡張】初版は Δvcx の横成分に陽的 ay·dt を使っており、⑧ が横速度を半陰的に積分する
//   REVERSE では予測誤差が滑りへ入り続けた。乖離は定常後退旋回（静止から全舵）の 後退速度 +7%・半径 +5% にとどまらず、
//   **高速後退（直進 4 s）から全舵に入る条件では卓上 FF で R +427%・AWD +331%（βmax 0.40° 対 参照 1.08°）・中スケール AWD +251%**、
//   半舵（prop 128）で −6%〜+17% だった（FR は後輪駆動で δ=0 ゆえ無影響＝機序の裏付け）。是正後は ⑧ と同じ式で Δvlat を予測し、
//   全セルで参照解と一致する。u・R は操舵後 5〜8 s の平均。βmax は高速後退→操舵では操舵後 8 s 全体の max |atan2(vlat,|u|)|
//   （初版が壊した進入過渡そのもの）、静止から全舵では 5〜8 s の定常窓で取る＝静止発進の最初の 1〜2 tick（|u| < uBlend1 の
//   ⑨ キネマティックブレンド域・β は小さい u の比で条件が悪い）は半陰的/陽的で元々一致せず（v7.8.0 は参照解の +60%・AW1 は −1〜−30%・
//   |u| > uBlend1 に限れば AW1 は ≤2.7%・v7.8.0 は ≤7.2%）、AW1 の退行ではないので記録に留める（下の「静止発進過渡」行）。
console.log('\n=== G: REVERSE（静止から全舵・高速後退→全舵・高速後退→半舵 × FF/AWD/FR × 卓上/中スケール）が参照解と一致 ===');
{
  const SCEN = [['steady', 0, 'tri', null], ['fastFull', 240, 'tri', null], ['fastHalf', 240, 'prop', 128]];
  const revRun = (type, pre, ss, amt) => { const c = mk(type, 'normal', 1.0); c.steerSet = ss; c.driveDir = CONST.REVERSE; c.pwm = 255; c.steer = CONST.CENTER; c.steerAmt = null;
    for (let i = 0; i < pre; i++) c.step(DT);
    c.steer = CONST.LEFT; c.steerAmt = amt; let uS = 0, rS = 0, n = 0, bmax = 0, bLaunch = 0; const bFrom = pre > 0 ? 0 : 300;
    for (let i = 0; i < 480; i++) { c.step(DT); const b = Math.abs(Math.atan2(c.vlat, Math.max(Math.abs(c.u), 1e-6))); if (i >= bFrom) bmax = Math.max(bmax, b); else bLaunch = Math.max(bLaunch, b); if (i >= 300) { uS += c.u; rS += c.r; n++; } }
    return { u: uS / n, R: Math.abs(uS / n) / Math.max(Math.abs(rS / n), 1e-9), bmax: bmax * deg, bLaunch: bLaunch * deg }; };
  let allOk = true, worst = 0, cells = 0; const launch = [];
  for (const rg of ['tabletop', 'midscale']) {
    applyRegime(rg);
    for (const [name, pre, ss, amt] of SCEN) for (const type of ['normal_ff', 'normal_awd', 'normal_fr']) {
      const cur = revRun(type, pre, ss, amt), ref = withExplicit(() => revRun(type, pre, ss, amt)); cells++;
      const e = [Math.abs(cur.u / ref.u - 1), Math.abs(cur.R / ref.R - 1), Math.abs(cur.bmax / ref.bmax - 1)]; const w = Math.max(...e); worst = Math.max(worst, w); if (w > 0.02) allOk = false;
      if (pre === 0) launch.push(`${rg}/${type} ${cur.bLaunch.toFixed(2)}°/${ref.bLaunch.toFixed(2)}°`);
      console.log(`     ${rg.padEnd(9)} ${name.padEnd(8)} ${type.padEnd(10)} u ${cur.u.toFixed(4)}/${ref.u.toFixed(4)}  R ${cur.R.toFixed(4)}/${ref.R.toFixed(4)}  βmax${pre > 0 ? '(進入 8 s)' : '(定常 5〜8 s)'} ${cur.bmax.toFixed(3)}°/${ref.bmax.toFixed(3)}°  (差 ${e.map(v => (100 * v).toFixed(2) + '%').join(' / ')})`);
    }
  }
  console.log(`     静止発進過渡（操舵後 0〜5 s の βmax・|u| < uBlend1 の ⑨ ブレンド域を含む・記録のみ）: ${launch.join('  ')}`);
  applyRegime('fullscale');
  ok(allOk, `G1 REVERSE ${cells} セル（静止から全舵・高速後退→全舵・高速後退→半舵 × FF/AWD/FR × 卓上/中スケール）の後退速度・半径・βmax が参照解と ±2% 以内（最悪 ${(100 * worst).toFixed(2)}%。初版は定常で +7%/+5%・高速後退→全舵で R +331〜427%）`);
}

// ══ E. 旋回中制動の掃引（不変条件）══════════════════════════════════════════════════
console.log('\n=== E: 旋回中制動の掃引（4 車種 × 3 装備 × 3 grip × 3 半径・卓上）===');
{
  applyRegime('tabletop'); const Tn = tireParamsFor('normal');
  let bad = 0, wc = -Infinity, wp = -Infinity, runs = 0, clampHits = 0, rMax = 0, kapMax = 0, revClamp = 0, revRuns = 0, nSubE = 0, nSubR = 0, revKapMax = 0;
  for (const type of ['normal_fr', 'normal_ff', 'normal_awd', 'drift_fr']) for (const b of ['motor', 'friction', 'frictionRear']) for (const grip of [0.6, 1.0, 1.4]) for (const Rk of [6, 10, 16]) {
    const R = Rk * CAR.wheelBase, vg = Math.sqrt(Tn.mu0 * grip * DYN.g * R);
    const c = mk(type, 'normal', grip, b); c.steerSet = 'prop'; c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.CENTER; c.steerAmt = null;
    for (let i = 0; i < 9000 && c.u < 0.85 * vg; i++) c.step(DT);
    const st = () => { const w = CAR.wheelBase / R + 0.5 * (c.u / R - c.r); const n = Math.max(-1, Math.min(1, w / CAR.maxSteer)); c.steer = n >= 0 ? CONST.LEFT : CONST.RIGHT; c.steerAmt = Math.round(Math.abs(n) * 255); };
    runs++;
    for (let i = 0; i < 60; i++) { st(); c.driveDir = CONST.FORWARD; c.pwm = Math.round(Math.max(0, Math.min(255, c.u / (CAR.maxSpeed * c.profile().maxSpeed) * 255))); c.step(DT); }
    // κ クランプの発火とその κ は **実装の診断量**（_kapClampN・_kapWheel）を読む（レビュー #5: u ベースの代理量は前輪の vcx と別物）。
    // どちらも _substep ごとにリセット/上書きされる量なので、step() 後に読むと最終 substep しか見えない（レビュー #6: 1/nSub サンプリングで
    // 到達 |κ| は 1.009 と 2 倍過小・REVERSE の発火数は 1/14 だった）。∴ _substep を包んで制動＋再加速の **全 substep** を積算する。
    const o = c._substep.bind(c); c._substep = (h, sc) => { o(h, sc); clampHits += c._kapClampN; for (let k = 0; k < 4; k++) kapMax = Math.max(kapMax, Math.abs(c._kapWheel[k])); nSubE++; };
    for (let i = 0; i < 25; i++) { st(); c.driveDir = CONST.BRAKE; c.pwm = 0; c.step(DT); if (!Number.isFinite(c.u)) bad++; wc = Math.max(wc, c._fcMarginSS); wp = Math.max(wp, c._slipPowerSS); rMax = Math.max(rMax, Math.abs(c.r)); }
    for (let i = 0; i < 90; i++) { st(); c.driveDir = CONST.FORWARD; c.pwm = 200; c.step(DT); if (!Number.isFinite(c.u)) bad++; wc = Math.max(wc, c._fcMarginSS); rMax = Math.max(rMax, Math.abs(c.r)); }
  }
  // REVERSE（後退・全舵/半舵・4 車種・3 grip）: κ クランプは実際に発火しうる操作域なので、不変条件（非有限・摩擦円・散逸）だけを課し発火数は記録。
  for (const type of ['normal_fr', 'normal_ff', 'normal_awd', 'drift_fr']) for (const grip of [0.6, 1.0, 1.4]) for (const amt of [255, 128]) {
    const c = mk(type, 'normal', grip); c.steerSet = 'prop'; c.driveDir = CONST.REVERSE; c.pwm = 255; c.steer = CONST.LEFT; c.steerAmt = amt; revRuns++;
    const o = c._substep.bind(c); c._substep = (h, sc) => { o(h, sc); revClamp += c._kapClampN; for (let k = 0; k < 4; k++) revKapMax = Math.max(revKapMax, Math.abs(c._kapWheel[k])); nSubR++; };
    for (let i = 0; i < 300; i++) { c.step(DT); if (!Number.isFinite(c.u) || !Number.isFinite(c.r)) bad++; wc = Math.max(wc, c._fcMarginSS); wp = Math.max(wp, c._slipPowerSS); }
  }
  applyRegime('fullscale');
  ok(bad === 0 && wc <= 1e-9 && wp <= 1e-9 && clampHits === 0, `E1 制動 ${runs} run（制動＋再加速 ${nSubE} substep を積算）: 非有限 ${bad}・定常摩擦円 max ${wc.toExponential(1)}・散逸 max ${wp.toExponential(1)}・実装の κ クランプ発火 ${clampHits}（到達 |κ| max ${kapMax.toFixed(3)} < kappaClamp ${V2.kappaClamp}）・|r|max ${rMax.toFixed(2)}／REVERSE ${revRuns} run（${nSubR} substep）: 非有限 0・不変条件維持（κ クランプ発火 ${revClamp} 回・到達 |κ| max ${revKapMax.toFixed(3)}＝記録・後退全舵では発火しうる）`);
}

// ══ F. 性能（半陰的化の効果を失っていない）═══════════════════════════════════════════
console.log('\n=== F: avgNSub（卓上 normal・直線＋旋回・AP13 受け入れ ≤32）===');
{
  applyRegime('tabletop');
  const c = mk('normal_fr', 'normal', 1.0); const o = c._substep.bind(c); let n = 0; c._substep = (h, sc) => { n++; o(h, sc); };
  c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.CENTER; for (let i = 0; i < 120; i++) c.step(DT);
  c.steer = CONST.LEFT; for (let i = 0; i < 120; i++) c.step(DT);
  c.driveDir = CONST.BRAKE; c.pwm = 0; for (let i = 0; i < 60; i++) c.step(DT);
  const avg = n / 300;
  applyRegime('fullscale');
  ok(avg <= 32, `F1 avgNSub = ${avg.toFixed(1)}（直線 120 tick＋全舵 120 tick＋制動 60 tick）≤ 32＝AP13 の nSub 削減は保たれている（AW1 は nSub を変えない）`);
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`AW1 連成ゲート: PASS ${pass} / FAIL ${fail}`);
console.log(`${'─'.repeat(60)}`);
process.exit(fail ? 1 : 0);
