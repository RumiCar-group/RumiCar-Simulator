// wf_ao3_drivetrain.mjs — Stage AO3 受け入れゲート (リポジトリ追跡・本番フロー/実オラクル / CI-8/9/14)。
// ════════════════════════════════════════════════════════════════════════════
// AO3「駆動系 (デフ open/LSD＋車輪 ODE＋モーターブレーキ＋エンコーダ整合)」を AO_spec §2.4・§12 AO3 の
// 受け入れを「知覚→測定の翻訳」で連続量マージンの機械検査に落とす。**再実装せず 実 CarV2.step/_substep・
// lsdTorque・buildApi(本物のエンコーダ経路) を呼び、公開面 (vwF/vwR/_vw) と診断量を読む**。
//   D1 オープンデフ幾何: 開デフ (lsd=0) 駆動輪の内外輪速差 = 幾何 r·tw ±10% (差動が速度差を許す)。
//   D2 LSD: (a) lsdTorque 連続性 Tt(0)=0・奇関数・単調 (Δω→0 で Tt→0)、(b) LSD が内外輪速差を有意に縮める
//           (締める)、(c) パワーオンでヨー応答 Δr が open と有意に異なる。
//   D3 モーターブレーキ軸選択: FR=制動で後軸ロック (vwR≪vwF)・FF=前軸ロック (vwF≪vwR) を実測。
//   D4 エンコーダ整合: 本物の RC_wheel_speed(REAR/FRONT) = |car.vwR/vwF| = 軸平均 (api.js 無改変で成立)。
//   D5 数値安定 (adaptiveSub 剛性条件下の発散ゼロ): 決定論 LCG で入力を振り 6車種×3領域で全状態 有界・有限。
// いずれか失敗で非ゼロ終了。canonical f0/f1・AO1/AO2 等は別ゲートで別途緑 (v2 は guarded branch)。
// ════════════════════════════════════════════════════════════════════════════
import { CarV2, V2, lsdOf, lsdTorque } from './public/js/physics_v2.js';
import { DYN, applyRegime } from './public/js/physics_dyn.js';
import { buildApi } from './public/js/api.js';
import { CAR, CONST, CAR_TYPES } from './public/js/config.js';

let pass = 0, fail = 0; const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
const DT = 1 / 60;
function mk(type, regime) { applyRegime(regime); const c = new CarV2({ x: 0, y: 0, theta: 0, grip: 1, downhill: 0 }); c.type = type; return c; }

// ── D1. オープンデフ 内外輪速差 = 幾何 ±10% (§12) ────────────────────────────
// 開デフ (normal_fr=lsd0) の惰行左旋回。後輪 (δ=0) は各接地縦速 vcx=u∓r·tw/2 で自由転動 (差動が左右で異なる
// 速度を許す=ロックデフなら等速強制)。外内輪速差 vwRR−vwRL = r·tw (幾何) ±10%。※パワーオンでは開デフが
// 内(低荷重)輪へトルクを送り内輪が空転するため幾何より縮む=別挙動 (D2b で LSD 対比)。ここは転動の幾何を測る。
{
  const U = 30, R = 0.5;
  const c = mk('normal_fr', 'fullscale');
  const tw = V2.twFrac * CAR.width;   // fullscale スケール確定後に読む
  c.driveDir = CONST.FREE; c.steer = CONST.CENTER;   // 惰行=開デフ輪は幾何速度で自由転動
  for (let i = 0; i < 300; i++) { c.u = U; c.vlat = 0; c.r = R; c.theta = 0; c.x = 0; c.y = 0; c.step(DT); }
  const dvw = c._vw[3] - c._vw[2];   // RR(外) − RL(内)
  const geom = Math.abs(c.r) * tw;   // 幾何は実ヨー率 (課した R は step 内で自然減衰するため read 時の c.r で)
  const err = Math.abs(dvw - geom) / Math.abs(geom);
  const lsdChk = lsdOf(c.profile(), 'fr');
  console.log(`  D1 normal_fr(open lsd=${lsdChk}): 外内輪速差 vwRR−vwRL=${dvw.toFixed(4)} 幾何 |r|·tw=${geom.toFixed(4)} (r=${c.r.toFixed(3)} tw=${tw.toFixed(3)}・誤差 ${(err * 100).toFixed(1)}%)`);
  ok(lsdChk === 0, `D1: normal_fr は open デフ (lsd=0)`);
  ok(err < 0.10, `D1: オープンデフ 内外輪速差 = 幾何 r·tw ±10% (差動が幾何速度を許す・誤差 ${(err * 100).toFixed(1)}%)`);
}

// ── D2. LSD 連続性＋締め＋パワーオン Δr (§12) ────────────────────────────────
{
  // (a) lsdTorque 連続性: Tt(0)=0 厳密・奇関数・|Δω| 単調・Δω→0 で連続に 0 (sign 不使用の平滑式)。
  const fAxle = 8, lsd = 1;
  ok(lsdTorque(0, fAxle, lsd) === 0, `D2a: LSD Tt(Δω=0)=0 厳密 (連続・sign 不使用)`);
  let mono = true, odd = true, prev = 0;
  for (let k = 1; k <= 40; k++) {
    const dvw = k * 0.02;
    const tp = lsdTorque(dvw, fAxle, lsd), tn = lsdTorque(-dvw, fAxle, lsd);
    if (tp < prev - 1e-12) mono = false;          // |Δω|↑ で Tt 単調増
    if (Math.abs(tp + tn) > 1e-9) odd = false;    // 奇関数
    prev = tp;
  }
  // Δω→0 で Tt→0 (連続): |Δω| を小さくすると Tt が単調に 0 へ減衰し、極小で ≈0 (跳びなし=sign 不連続でない)。
  const seq = [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6].map(d => lsdTorque(d, fAxle, lsd));
  let decays = true;
  for (let i = 1; i < seq.length; i++) if (seq[i] > seq[i - 1] + 1e-12) decays = false;
  ok(mono && odd, `D2a: LSD Tt が |Δω| に単調増＋奇関数 (粘性+トルク感応)`);
  ok(decays && seq[seq.length - 1] < 1e-3, `D2a: LSD Tt が Δω→0 で連続に 0 へ (Tt(1e-6)=${seq[seq.length - 1].toExponential(1)}→0)`);

  // (b) LSD は内外輪速差を締める: 同一の軽駆動定常旋回で drift_fr(LSD) の |Δvw| < normal_fr(open)。
  const U = 30, R = 0.5;
  function turnDvw(type) {
    const c = mk(type, 'fullscale'); c.driveDir = CONST.FORWARD; c.pwm = 75; c.steer = CONST.CENTER;
    for (let i = 0; i < 400; i++) { c.u = U; c.vlat = 0; c.r = R; c.theta = 0; c.x = 0; c.y = 0; c.step(DT); }
    return Math.abs(c._vw[3] - c._vw[2]);
  }
  const dOpen = turnDvw('normal_fr'), dLsd = turnDvw('drift_fr');
  const lockRatio = dLsd / dOpen;
  console.log(`  D2b: 内外輪速差 open=${dOpen.toFixed(4)} LSD=${dLsd.toFixed(4)} (LSD/open=${lockRatio.toFixed(3)}) lsd(drift_fr)=${lsdOf(mk('drift_fr','fullscale').profile(),'fr')}`);
  ok(lockRatio < 0.85, `D2b: LSD が内外輪速差を有意に締める (LSD/open=${lockRatio.toFixed(3)}<0.85)`);

  // (c) パワーオン Δr: 同一初期・同一操舵/駆動を自由発展させ、LSD と open で定常ヨー率 r が有意に異なる。
  // **CI-5 プローブ再調律 (AO5 較正の後続影響)**: 旧プローブ u=25/pwm=200 は AO2 seam の過大ドライブトレイン
  // (launchAccel=15) を前提に後輪空転が大きく Δr=0.51 を出していた。AO5 が v2 の駆動を軸容量へ再フィット
  // (launchAccel=7・後輪 hook-up) した結果、その点は grip 律速で空転が消え LSD の差動配分が働かず Δr→0.003 に。
  // LSD のヨー効果 (差動トラクション) 自体は健在で、**パワーオーバーが起きる操作点** (u=18/pwm=255=全開・
  // 低速タイト) では Δr=0.146 と明瞭。∴ プローブをその操作点へ移す (**閾値 0.02 は不変=緩和でなく、機構が
  // 働く点で測る**)。AO3 実装 (LSD/車輪ODE/デフ) は無改変=検証済のまま (D1/D2a/D2b/D3/D4/D5 も緑)。
  function freeYaw(type) {
    const c = mk(type, 'fullscale'); c.u = 18; c.vlat = 0; c.r = 0; c.theta = 0;
    c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.LEFT;   // 全開・パワーオーバー域 (LSD が効く)
    for (let i = 0; i < 400; i++) c.step(DT);
    return c.r;
  }
  const rOpen = freeYaw('normal_fr'), rLsd = freeYaw('drift_fr');
  const dR = Math.abs(rLsd - rOpen), rel = dR / Math.max(Math.abs(rOpen), 1e-6);
  console.log(`  D2c: パワーオン定常ヨー率 open r=${rOpen.toFixed(3)} LSD r=${rLsd.toFixed(3)} (Δr=${dR.toFixed(3)}=${(rel * 100).toFixed(0)}%)`);
  ok(dR > 0.02, `D2c: パワーオンで LSD と open のヨー率が有意に異なる (Δr=${dR.toFixed(3)}>0.02 rad/s)`);
}

// ── D3. モーターブレーキ 軸選択 (§12) ────────────────────────────────────────
// 巡航後 BRAKE。FR=駆動軸(後)のみ逆トルク ⇒ 後輪ロック (vwR≪vwF=非駆動前輪は接地追従)。FF=逆。
{
  function brakeAxle(type) {
    const c = mk(type, 'fullscale'); c.u = 30; c.vlat = 0; c.r = 0; c.theta = 0;
    c.driveDir = CONST.FORWARD; c.pwm = 180; c.steer = CONST.CENTER;
    for (let i = 0; i < 120; i++) c.step(DT);        // 巡航へ (両軸 vw≈u)
    c.driveDir = CONST.BRAKE; c.pwm = 0;
    for (let i = 0; i < 30; i++) c.step(DT);          // 制動 (完全停止前)
    return { u: c.u, vwF: Math.abs(c.vwF), vwR: Math.abs(c.vwR) };
  }
  const fr = brakeAxle('normal_fr'), ff = brakeAxle('normal_ff');
  console.log(`  D3 FR 制動: u=${fr.u.toFixed(1)} vwF=${fr.vwF.toFixed(1)}(非駆動前) vwR=${fr.vwR.toFixed(1)}(駆動後=ロック)`);
  console.log(`  D3 FF 制動: u=${ff.u.toFixed(1)} vwF=${ff.vwF.toFixed(1)}(駆動前=ロック) vwR=${ff.vwR.toFixed(1)}(非駆動後)`);
  ok(fr.vwR < 0.7 * fr.vwF, `D3: FR 制動=後軸(駆動)ロック vwR≪vwF (${fr.vwR.toFixed(1)}<0.7·${fr.vwF.toFixed(1)})`);
  ok(ff.vwF < 0.7 * ff.vwR, `D3: FF 制動=前軸(駆動)ロック vwF≪vwR (${ff.vwF.toFixed(1)}<0.7·${ff.vwR.toFixed(1)})`);
}

// ── D4. エンコーダ整合 = 本物の RC_wheel_speed が軸平均 (api.js 無改変・§12) ──────
// buildApi (本番エンコーダ経路) を CarV2 に張り、RC_wheel_speed(REAR/FRONT) が |car.vwR/vwF| = 軸平均 _vw に
// 一致することを実測 (fullscale=DYN.wheelDyn 有効ゆえ vw を返す)。api.js は car.vwF/vwR を読むだけ=無改変。
{
  const c = mk('normal_fr', 'fullscale');
  const world = { car: c, walls: [], start: { x: 0, y: 0, theta: 0, grip: 1, downhill: 0 }, encoder: true, log: () => {} };
  const api = buildApi(world);
  c.driveDir = CONST.FORWARD; c.pwm = 150; c.steer = CONST.LEFT;
  for (let i = 0; i < 200; i++) { c.u = Math.max(c.u, 8); c.r = 0.4; c.step(DT); }
  const encR = api.RC_wheel_speed(CONST.REAR), encF = api.RC_wheel_speed(CONST.FRONT);
  const avgR = Math.abs(0.5 * (c._vw[2] + c._vw[3])), avgF = Math.abs(0.5 * (c._vw[0] + c._vw[1]));
  console.log(`  D4: RC_wheel_speed REAR=${encR.toFixed(3)} =|vwR|=${Math.abs(c.vwR).toFixed(3)} =軸平均|_vw[2,3]|=${avgR.toFixed(3)} / FRONT=${encF.toFixed(3)} =軸平均=${avgF.toFixed(3)}`);
  ok(Math.abs(encR - Math.abs(c.vwR)) < 1e-9 && Math.abs(encF - Math.abs(c.vwF)) < 1e-9, `D4: RC_wheel_speed = |car.vwR/vwF| (api.js 無改変で成立)`);
  ok(Math.abs(Math.abs(c.vwR) - avgR) < 1e-9 && Math.abs(Math.abs(c.vwF) - avgF) < 1e-9, `D4: vwF/vwR = 左右輪 _vw の軸平均 (エンコーダ=軸平均)`);
}

// ── D5. 数値安定 = adaptiveSub 剛性条件下で発散ゼロ (決定論 LCG fuzz・§12) ───────
// 決定論 LCG で driveDir/steer/pwm/grip を振り、全 6車種×3領域で 車体・車輪の全状態が 有限・有界。
// (車輪 ODE の陽的発散を step() の adaptiveSub＋κ クランプが抑える=最終防波堤の実証)。
{
  let seed = 20260702 >>> 0;
  const rnd = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
  const dirs = [CONST.FORWARD, CONST.REVERSE, CONST.BRAKE, CONST.FREE];
  const strs = [CONST.LEFT, CONST.CENTER, CONST.RIGHT];
  let worstU = 0, worstVw = 0, worstR = 0, nonFinite = 0, steps = 0, cars = 0;
  for (const t of CAR_TYPES.map(x => x.key)) for (const rg of ['tabletop', 'midscale', 'fullscale']) {
    const c = mk(t, rg); c.grip = 0.6 + 0.4 * rnd(); cars++;
    for (let i = 0; i < 2000; i++) {
      if (i % 12 === 0) { c.driveDir = dirs[(rnd() * dirs.length) | 0]; c.steer = strs[(rnd() * strs.length) | 0]; c.pwm = (rnd() * 255) | 0; }
      c.step(DT); steps++;
      const fin = Number.isFinite(c.u) && Number.isFinite(c.vlat) && Number.isFinite(c.r) &&
        Number.isFinite(c.x) && Number.isFinite(c.y) && c._vw.every(Number.isFinite) &&
        Number.isFinite(c.vwF) && Number.isFinite(c.vwR);
      if (!fin) nonFinite++;
      worstU = Math.max(worstU, Math.abs(c.u));
      worstR = Math.max(worstR, Math.abs(c.r));
      worstVw = Math.max(worstVw, ...c._vw.map(Math.abs));
    }
  }
  console.log(`  D5: ${cars}車 (6×3領域) × 2000step (計${steps}) fuzz — 非有限 ${nonFinite} / 最大|u|=${worstU.toFixed(1)} 最大|r|=${worstR.toFixed(1)} 最大|vw|=${worstVw.toFixed(1)}`);
  ok(nonFinite === 0, `D5: 全 fuzz step で 状態が有限 (NaN/Inf ゼロ・非有限 ${nonFinite})`);
  ok(worstU < 200 && worstVw < 600 && worstR < 100, `D5: 全状態 有界 (|u|<200・|vw|<600・|r|<100 ⇒ 車輪 ODE 発散ゼロ)`);
}

applyRegime('tabletop');   // 復元

// ── 結果 ─────────────────────────────────────────────────────────────────────
const line = '─'.repeat(64);
console.log(line);
console.log('Stage AO3 ゲート  (駆動系: デフ open/LSD＋車輪 ODE＋モーターブレーキ＋エンコーダ)');
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log(line); for (const m of fails) console.log('  ✗ ' + m); }
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
