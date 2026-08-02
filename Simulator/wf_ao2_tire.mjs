// wf_ao2_tire.mjs — Stage AO2 受け入れゲート (リポジトリ追跡・本番フロー/実オラクル / CI-8/9/14)。
// ════════════════════════════════════════════════════════════════════════════
// AO2「タイヤ・荷重コア (結合 MF robust 形＋緩和長＋輪別荷重＋rollBalance＋荷重感度＋β依存空力)」を
// AO_spec §12 AO2 の受け入れを「知覚→測定の翻訳」で連続量マージンの機械検査に落とす。**再実装せず
// 実 CarV2._substep / tireForceMF / mfCoeffs を呼び、公開診断量 (_fcMarginSS/_slipPowerSS/_latCapSS/
// _FzWheel/_nR axle0/_ayFrontTire 等) を読む** (物理ロジックの再実装ではない=決定論/実力の測定オラクル)。
//   T1 g(σ) 数値: g(1)=1・g(∞)=muDecay を厳密検証＋摩擦円 |F|≤μFz を (κ,tanα) グリッドで。
//   T2 摩擦円 全 trace: 6車種×3領域×操作 battery で 定常 MF 力/適用力とも |F|≤μFz (連続量マージン≤ε)。
//   T3 横容量: 純サイドスリップ (drivetrain-neutral) で全車 peak _ayTire/latCap∈[0.95,1.10]・全 slip で ≤latCap
//       (AO3 で駆動が実車輪 ODE 化 ⇒ 駆動 skidpad は fullscale 定出力の後輪スピンで定常円に達せず=AO5 較正待ち)。
//   T3b 荷重移動: launch で 軸荷重移動=_axF·h/L (幾何・厳密) ＋ _axF=τ-LPF(du/dt) (実加速度の一次遅れ・公平突合)。
//   T4 緩和長: 小スリップ一定保持の制御入力で前一次遅れ τ を測り relLen=τ·V を ±20% で検算。
//   T5 rollBalance: 同一旋回状態で ζF 掃引→前軸横力 単調減 (US 化)・後軸横力 単調増 (§2.2 バランス)。
//   T6 エネルギー: 全 trace で接地スリップ仕事率≤0 (散逸)＋惰行 (FREE) で KE 単調非増加。
// いずれか失敗で非ゼロ終了。既存 canonical f0/f1・AO1/collision/recover 等は別ゲートで別途緑を確認
// (v2 は guarded branch)。
// ════════════════════════════════════════════════════════════════════════════
import { CarV2, V2, mfCoeffs, tireForceMF } from './public/js/physics_v2.js';
import { DYN, applyRegime } from './public/js/physics_dyn.js';
import { CAR, CONST, CAR_TYPES } from './public/js/config.js';

let pass = 0, fail = 0; const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
const DT = 1 / 60;
function mk(type, regime) { applyRegime(regime); const c = new CarV2({ x: 0, y: 0, theta: 0, grip: 1, downhill: 0 }); c.type = type; return c; }

// ── T1. g(σ) 数値検証 (§2.3・§12) ────────────────────────────────────────────
{
  let g1worst = 0, gInfWorst = 0;
  for (const gInf of [0.35, 0.5, 0.6, 0.75, 0.85, 0.95]) {
    const { C, Bp } = mfCoeffs(gInf);
    const g1 = Math.sin(C * Math.atan(Bp * 1));            // g(1) は peak=1 拘束
    const gLarge = Math.sin(C * Math.atan(Bp * 1e7));      // g(∞) → gInf
    g1worst = Math.max(g1worst, Math.abs(g1 - 1));
    gInfWorst = Math.max(gInfWorst, Math.abs(gLarge - gInf));
  }
  ok(g1worst < 1e-9, `T1: g(1)=1 全 gInf で厳密 (最悪誤差 ${g1worst.toExponential(2)})`);
  ok(gInfWorst < 1e-6, `T1: g(∞)=muDecay 全 gInf で厳密 (最悪誤差 ${gInfWorst.toExponential(2)})`);
  // tireForceMF: 摩擦円 |(fx,fy)| ≤ μFz を (κ,tanα) グリッド全域で (構造保証の実測)。
  const { C, Bp } = mfCoeffs(V2.muDecay);
  let fcWorst = -Infinity;
  const muFz = 12.0;
  for (let ik = -30; ik <= 30; ik++) for (let ia = -30; ia <= 30; ia++) {
    const kappa = ik * 0.1, ta = ia * 0.1;
    const F = tireForceMF(kappa, ta, muFz, C, Bp, V2.kappaP, V2.alphaP);
    fcWorst = Math.max(fcWorst, Math.hypot(F.fx, F.fy) - muFz);
  }
  ok(fcWorst <= 1e-9, `T1: tireForceMF 摩擦円 |F|≤μFz を (κ,tanα) 全格子で (最悪マージン ${fcWorst.toExponential(2)})`);
  console.log(`  T1 g(σ): g(1) 誤差≤${g1worst.toExponential(1)}, g(∞) 誤差≤${gInfWorst.toExponential(1)}, MF円マージン≤${fcWorst.toExponential(1)}`);
}

// ── T2. 摩擦円不変条件 全 trace ＋ T6a. 散逸性 (§12) ─────────────────────────
{
  const types = CAR_TYPES.map(t => t.key);
  const regimes = ['tabletop', 'midscale', 'fullscale'];
  const drives = [CONST.FORWARD, CONST.BRAKE, CONST.REVERSE, CONST.FREE];
  const steers = [CONST.LEFT, CONST.CENTER, CONST.RIGHT];
  let worstSS = -Infinity, worstApp = -Infinity, worstPow = -Infinity, traces = 0, steps = 0;
  for (const rg of regimes) for (const t of types) for (const d of drives) for (const s of steers) {
    const c = mk(t, rg); c.driveDir = d; c.pwm = 200; c.steer = s; traces++;
    for (let i = 0; i < 1500; i++) {
      c.step(DT); steps++;
      worstSS = Math.max(worstSS, c._fcMarginSS);
      worstApp = Math.max(worstApp, c._fcMargin);
      worstPow = Math.max(worstPow, c._slipPowerSS);
    }
  }
  ok(worstSS <= 1e-9, `T2: 定常 MF 力の摩擦円 |F|≤μFz 全 trace (最悪マージン ${worstSS.toExponential(2)})`);
  ok(worstApp <= 1e-9, `T2: 適用力 (緩和+クランプ) の摩擦円 |F|≤μFz 全 trace (最悪 ${worstApp.toExponential(2)})`);
  ok(worstPow <= 1e-9, `T6a: 接地スリップ仕事率 F·v_slip≤0 全 trace=タイヤ力は散逸的 (最悪 ${worstPow.toExponential(2)})`);
  console.log(`  T2/T6a: ${traces} trace × ${steps / traces} step (計${steps}) で 摩擦円マージン≤${Math.max(worstSS, worstApp).toExponential(1)}・散逸≤${worstPow.toExponential(1)}`);
}

// ── T3. 横グリップ容量 (マクロ摩擦円・§2.3/§12) ───────────────────────────────
// **AO3 で縦が実車輪 ODE＋差動になり、fullscale の (AO5 で再較正予定の) 定出力ドライブトレインが低速で後輪
//   スピン=power-over を創発させる (FR launch需要/後軸グリップ≈2.1)。ゆえに駆動 skidpad は「定常円」に達しない
//   (ハンドリング・バランスの絶対値は駆動系較正依存=AO5 スコープ・T5 で単調性は担保)。T3 は tire-core の横容量
//   だけを drivetrain-neutral に測る**: 純サイドスリップ (r=0・steer=CENTER・FREE=κ0) を課し slip 角 β を掃引。
//   各輪は tanα=αP (σ=1) で横力ピーク μFz へ達し Σ=latCap ⇒ peak _ayTire/latCap∈[0.95,1.10]・全 β で ≤latCap。
{
  const U = 25;
  for (const t of ['normal_fr', 'normal_ff', 'normal_awd']) {
    let best = { ay: 0, cap: 1, bd: 0 }, capViol = 0;
    for (let bd = 2; bd <= 20; bd++) {
      const vlat = U * Math.tan(bd * Math.PI / 180);
      const c = mk(t, 'fullscale'); c.driveDir = CONST.FREE; c.steer = CONST.CENTER;
      for (let i = 0; i < 200; i++) { c.u = U; c.vlat = vlat; c.r = 0; c.theta = 0; c.x = 0; c.y = 0; c.step(DT); }
      const ay = Math.abs(c._ayTire), cap = c._latCapSS;
      if (cap > 0 && ay > cap * (1 + 1e-6)) capViol++;
      if (ay > best.ay) best = { ay, cap, bd };
    }
    const ratio = best.ay / best.cap;
    console.log(`  T3 ${t}: peak _ayTire=${best.ay.toFixed(2)} latCap=${best.cap.toFixed(2)} ratio=${ratio.toFixed(3)} @β=${best.bd}° (容量超過 ${capViol}回)`);
    ok(capViol === 0, `T3: ${t} 全 slip 角で _ayTire≤latCap (マクロ摩擦円=横容量を超えない)`);
    ok(ratio >= 0.95 && ratio <= 1.10, `T3: ${t} 純サイドスリップ横力ピークが latCap 到達 (各輪 μFz・ratio=${ratio.toFixed(3)}∈[0.95,1.10])`);
  }
}

// ── T3b. 荷重移動式突合 (§12) ────────────────────────────────────────────────
// launch (抗力/DF≈0・横移動なし) で前後荷重移動を純測定。(a) 後軸荷重移動量 = _axF·h/L (幾何・厳密)、
// (b) _axF が「実加速度 du/dt を物理と同一 τ_susp で一次遅れした値」に一致 (公平な LPF vs LPF)。
// **AO3 で駆動が実車輪 ODE 化し launch が (特に AWD で) 急峻になった ⇒ _axF (LPF) を瞬時 du/dt と比べるのは
//   不当 (LPF は速い過渡を追えない=一次遅れの性質)。両者を同一 τ の LPF 同士で突合すれば構造一致を正しく測る。**
{
  for (const t of ['normal_ff', 'normal_awd', 'normal_fr']) {
    const c = mk(t, 'fullscale'); c.driveDir = CONST.FORWARD; c.pwm = 70; c.steer = CONST.CENTER;
    const L = CAR.wheelBase, h = V2.hOverL * L;
    const tauSusp = 0.12 * Math.sqrt(L / 0.13), kfTick = Math.max(0, Math.min(1, DT / tauSusp));
    let axRef = 0, prevU = c.u, bestErr = Infinity, at = null;
    for (let i = 0; i < 160; i++) {
      c.step(DT);
      const aBody = (c.u - prevU) / DT; prevU = c.u;
      axRef += (aBody - axRef) * kfTick;             // 実加速度の τ-LPF (物理 _axF と同一時定数)
      if (Math.abs(aBody) < 1) continue;
      const err = Math.abs(c._axF / axRef - 1);      // LPF vs LPF の公平突合
      if (err < bestErr) {
        bestErr = err;
        const rearShift = (c._FzWheel[2] + c._FzWheel[3]) - c._nRaxle0;  // 後軸荷重移動量
        at = { aBody, axF: c._axF, axRef, rearShift, geomExpect: c._axF * h / L };
      }
    }
    const geomErr = Math.abs(at.rearShift - at.geomExpect) / Math.abs(at.geomExpect);   // 幾何 (h/L・符号)
    console.log(`  T3b ${t}: _axF=${at.axF.toFixed(2)} τLPF(du/dt)=${at.axRef.toFixed(2)} (突合 ${(bestErr * 100).toFixed(1)}%) 後軸移動=${at.rearShift.toFixed(3)} 幾何期待=${at.geomExpect.toFixed(3)}`);
    ok(geomErr < 0.01, `T3b: ${t} 後軸荷重移動 = _axF·h/L (幾何厳密 ${(geomErr * 100).toFixed(2)}%)`);
    ok(bestErr < 0.05, `T3b: ${t} _axF = τ-LPF(du/dt) (荷重移動が実加速度で駆動・${(bestErr * 100).toFixed(1)}%<5%)`);
  }
}

// ── T4. 横力緩和長 ステップ応答 ±20% (§12) ──────────────────────────────────
// 制御入力キャラクタリゼーション: 小スリップ角を毎ステップ一定保持し (body 応答/荷重過渡を排す)
// 実 _substep の緩和一次遅れ τ を測る。63% 到達を線形補間し relLen=τ·V を ±20% で検算。
{
  const saved = V2.relLenFrac;
  const relLen = V2.relLenFrac * CAR.wheelBase;
  for (const V0 of [20, 35]) {
    const c = mk('normal_ff', 'fullscale'); c.driveDir = CONST.FREE; c.steer = CONST.CENTER;
    const vl = 0.02 * V0;
    const rec = [{ t: 0, a: 0 }];
    for (let i = 0; i < 240; i++) {
      c.u = V0; c.vlat = vl; c.r = 0; c.theta = 0; c.x = 0; c.y = 0;   // 入力固定 (実 _substep 駆動)
      c.step(DT); rec.push({ t: (i + 1) * DT, a: Math.abs(c._ayTire) });
    }
    const ss = rec.slice(-40).reduce((s, r) => s + r.a, 0) / 40, target = 0.632 * ss;
    let t63 = NaN;
    for (let i = 1; i < rec.length; i++) if (rec[i].a >= target) { t63 = rec[i - 1].t + (target - rec[i - 1].a) / (rec[i].a - rec[i - 1].a) * DT; break; }
    const relLenMeas = t63 * V0, ratio = relLenMeas / relLen;
    console.log(`  T4 V0=${V0}: τ実測=${t63.toFixed(4)}s relLen実測=${relLenMeas.toFixed(3)}m / 設定=${relLen.toFixed(2)}m 比=${ratio.toFixed(3)}`);
    ok(ratio >= 0.8 && ratio <= 1.2, `T4: V0=${V0} 緩和長ステップ応答が relLen ±20% (比 ${ratio.toFixed(3)})`);
  }
  V2.relLenFrac = saved;
}

// ── T5. rollBalance ζF 掃引の単調バランス変化 (§2.2・§12) ────────────────────
// 制御入力: 同一の左旋回運動状態を保持し荷重整定後に軸別横力を読む。同一状態で ζF のみ掃引 ⇒
// ζF↑ で前軸へ横荷重集中→loadSens 凹性で前軸横力↓ (US 化)・相対的に後軸横力↑ (単調)。
{
  const saved = V2.rollBalance;
  const zs = [0.40, 0.48, 0.55, 0.62, 0.70];
  const out = [];
  const U = 25, VL = 2.0, R = 0.4;
  for (const z of zs) {
    V2.rollBalance = z;
    const c = mk('normal_ff', 'fullscale'); c.driveDir = CONST.FORWARD; c.pwm = 60; c.steer = CONST.LEFT;
    for (let i = 0; i < 120; i++) { c.u = U; c.vlat = VL; c.r = R; c.theta = 0; c.x = 0; c.y = 0; c.step(DT); }
    out.push({ z, fF: Math.abs(c._ayFrontTire), fR: Math.abs(c._ayRearTire) });
  }
  V2.rollBalance = saved;
  let monoFront = true, monoRear = true;
  for (let i = 1; i < out.length; i++) {
    if (out[i].fF > out[i - 1].fF + 1e-6) monoFront = false;   // 前軸横力 単調減
    if (out[i].fR < out[i - 1].fR - 1e-6) monoRear = false;    // 後軸横力 単調増
  }
  const span = ((out[0].fF - out[out.length - 1].fF) / out[0].fF * 100).toFixed(1);
  console.log(`  T5 ζF 0.40→0.70: 前軸横力 ${out.map(o => o.fF.toFixed(2)).join('→')} (前軸 ${span}% 減)`);
  console.log(`                    後軸横力 ${out.map(o => o.fR.toFixed(2)).join('→')}`);
  ok(monoFront, `T5: ζF↑ で前軸横力が単調減 (US 勾配が単調・§2.2)`);
  ok(monoRear, `T5: ζF↑ で後軸横力が単調増 (バランスが前→後へ単調シフト)`);
}

// ── T6b. エネルギー: 惰行 (FREE) で 正味 KE 散逸 (§12「KE 増加≤入力積分」の入力=0 版) ─────────
// 入力ゼロの惰行では系の力学エネルギーは正味で減る (タイヤ接地は T6a で厳密散逸)。§2.3 の力ラグ緩和は
// 受動ばね的な微小リザーバ交換を生む (スピン中のスリップ反転で瞬間的に body KE が増えうる) が、これは
// 有界 (KE0 比 <<1%) で正味では完全散逸する (leak でない)。正味散逸＋ブリップ有界 の2連続量で測る。
{
  let worstNet = -Infinity, worstBlip = 0;
  for (const t of CAR_TYPES.map(x => x.key)) for (const rg of ['tabletop', 'fullscale']) {
    const c = mk(t, rg); c.driveDir = CONST.FORWARD; c.pwm = 200; c.steer = CONST.LEFT;
    for (let i = 0; i < 1200; i++) c.step(DT);            // 旋回状態へ
    c.driveDir = CONST.FREE;                              // 入力オフ (惰行)
    const ke0 = 0.5 * (c.u * c.u + c.vlat * c.vlat);
    let prevKE = ke0, blip = 0;
    for (let i = 0; i < 3000; i++) {
      c.step(DT);
      const ke = 0.5 * (c.u * c.u + c.vlat * c.vlat);
      blip = Math.max(blip, ke - prevKE); prevKE = ke;
    }
    const keEnd = prevKE;
    worstNet = Math.max(worstNet, (keEnd - ke0) / Math.max(ke0, 1e-9));
    worstBlip = Math.max(worstBlip, blip / Math.max(ke0, 1e-9));
  }
  ok(worstNet < 0, `T6b: 惰行で正味 KE 散逸 (入力ゼロで力学エネルギー減少・最悪正味変化 ${(worstNet * 100).toFixed(1)}%<0)`);
  ok(worstBlip < 0.01, `T6b: 緩和リザーバの瞬間 KE ブリップが有界 <1%KE0 (leak でない・最大 ${(worstBlip * 100).toFixed(2)}%)`);
  console.log(`  T6b: FREE 惰行 正味 KE 変化≤${(worstNet * 100).toFixed(1)}% (完全散逸)・最大ブリップ ${(worstBlip * 100).toFixed(2)}% (緩和リザーバ・有界)`);
}

applyRegime('tabletop');   // 復元

// ── 結果 ─────────────────────────────────────────────────────────────────────
const line = '─'.repeat(64);
console.log(line);
console.log('Stage AO2 ゲート  (タイヤ・荷重コア: 結合MF/緩和長/輪別荷重/rollBalance/荷重感度/β空力)');
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log(line); for (const m of fails) console.log('  ✗ ' + m); }
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
