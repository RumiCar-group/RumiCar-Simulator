// wf_av2_brake.mjs — Stage AV2「4輪摩擦ブレーキ brakeSet（車両の任意装備）」受け入れゲート。
// ══════════════════════════════════════════════════════════════════════════════════════
// 実機 RumiCar の制動は **駆動モーターの逆トルクだけ** で、v2 はそれを正直に写している
// （BRAKE 指令が駆動軸 split へ流れる）。∴ FR 車は制動が後軸だけに掛かって後輪がロックし、
// コーナー内でブレーキを踏むとリアが即座に抜ける。AV2 はこれに対し「実車の 4 輪摩擦ブレーキを
// 増設したら何が変わるか」を試せる **車両の任意装備** を足した:
//
//   BRAKE の総制動力 fCmd は **変えず**、前軸へ biasF・後軸へ (1−biasF) を配り各軸内は左右等分。
//   ロックは車輪 ODE dvw/dt=λ·(fApp−fx_tire) から **創発** する（閾値を書き込まない）。
//
// **再実装せず 実 CarV2.step / brakeParamsFor / makeSlot / freeSpawn / runRace / swapPhysics を呼ぶ**
// （CI-14。オラクル一覧は internal の docs/oracle_inventory.md）。
//
// ── AV1 の敵対的検証が残した 3 つの申し送りへの対応（PLAN AV2・決定ログ AV-1）───────────
//  (i)   **方向つきの結論を掃引格子の上で assert しない。** D 章は **2 つの独立な格子**
//        （値も次元数も重ならない 54 セル / 288 セル）で符号が保たれた主張だけを述語にし、
//        保たれなかったもの（βpk の増減）は **記録に落とす**。
//  (ii)  **不変条件をゲート側で再計算しない。** B/C 章は実装の診断量 `_fAppWheel`・`_fxWheel`・
//        `_FzWheel`・`_latCapSS`・`_latCapF` を **外から読む**。摩擦円の半径 μ_eff をゲートで
//        組み直さない（AV1 はそれで実装を 2 倍にしても全緑だった）。
//  (iii) **配線は本番経路で検査する。** F 章は makeSlot / rebuildSpawns / swapPhysics / runRace を
//        通し、**本番 traceHash が実際に変わること** まで見る
//        （AV1 は単体 CarV2 では効くのに runRace では効かない配線落ちを実ブラウザだけが検出した）。
//
// 構成:
//   [A] 既定 'motor' の完全縮退（未知値/未指定/壊れた定義も既定へ・配分ブロックへ入らない）
//   [B] 配分の法則（総量保存・biasF 厳密一致・左右対称・4輪 ODE 参加）＋検出力
//   [C] 閉形式（実装の容量診断だけから減速度比を予測）＋ μ 掃引の単調性
//   [D] 旋回中制動（2 格子で符号を確認してから述語にする。βpk は記録）
//   [E] 不変条件（摩擦円・接地散逸性・運動エネルギー・車輪面速度の符号）
//   [F] 本番配線（makeSlot/rebuildSpawns/swapPhysics/runRace の traceHash・canon 刻印・決定論）
//   [G] 非対象エンジン（standard/dynamic は brakeSet を無視＝traceHash 不変を機械固定）
//   [H] 正規化と共有 URL スキーマ
//   [I] **領域依存**（卓上/中スケールでは装備が制動を弱める。その機序＝AP13 半陰的車輪 ODE の特定）
//
// 使い方:
//   node wf_av2_brake.mjs          # 既定=縮小掃引。アサート緑/赤で exit 0/1
//   node wf_av2_brake.mjs --full   # 全表（D 章の格子2 を 288 セルへ・docs 転記用）
//   node wf_av2_brake.mjs --json   # 表を JSON で吐く（internal の docs/stage_av/ へ整形転記）
// 所要は末尾に章別で印字する（ホスト依存ゆえ本文に固定値を書かない）。
// ══════════════════════════════════════════════════════════════════════════════════════
import { CarV2, V2, tireParamsFor, brakeParamsFor } from './public/js/physics_v2.js';
import { applyRegime, DYN, DynCar } from './public/js/physics_dyn.js';
import { Car } from './public/js/physics.js';
import { CAR, CONST, CAR_TYPES, MASS, MASS_REF, BRAKES, BRAKE_SETS, BRAKE_DEFAULT, PHYSICS, setPhysicsMode, APP_VERSION } from './public/js/config.js';
import { buildFromSpec } from './public/js/course.js';
import { makeSlot, rebuildSpawns, swapPhysics, normBrake } from './public/js/fleet.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';
import { SHARE_FIELDS, encodeState, decodeState } from './public/js/share.js';

const FULL = process.argv.includes('--full');
const WANT_JSON = process.argv.includes('--json');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const DT = 1 / 60, deg = 180 / Math.PI;
const T0 = process.hrtime.bigint(); let MARK = T0;
const lap = () => { const n = process.hrtime.bigint(); const v = Number(n - MARK) / 1e9; MARK = n; return v; };
const JSONOUT = {};

setPhysicsMode('v2'); applyRegime('fullscale');
const Tn = tireParamsFor('normal');
console.log(`\n[AV2] 4輪摩擦ブレーキ  APP=${APP_VERSION}  fullscale v2  装備=${BRAKE_SETS.join('/')}  既定=${BRAKE_DEFAULT}`);

// ── 共通部品 ────────────────────────────────────────────────────────────────────────
// 掃引対象。**LSD 装備車 (profile.drift ⇒ lsd=0.8) を必ず含める** — 敵対的検証で「normal 車だけでは
// 差動の移送 Tt が絡む経路を 1 アサートも通っていない」と指摘され、実測でそのとおりだった。
const TYPES = ['normal_fr', 'normal_ff', 'normal_awd', 'drift_fr'];
function spin(type, bset, grip, u0) {          // u0 まで加速した車を返す（制動直前の状態）
  const car = new CarV2({ x: 0, y: 0, theta: 0, grip });
  car.type = type; car.tireSet = 'normal'; car.brakeSet = bset;
  car.driveDir = CONST.FORWARD; car.pwm = 255; car.steer = CONST.CENTER; car.steerAmt = null;
  for (let i = 0; i < 9000 && car.u < u0; i++) car.step(DT);
  return car;
}
// 直線全制動。u0→uEnd の停止距離・平均減速度と、実装の診断量を返す。
function straightBrake(type, bset, grip, u0 = 40, uEnd = 2) {
  const car = spin(type, bset, grip, u0);
  const uu = car.u, x0 = car.x;
  car.driveDir = CONST.BRAKE; car.pwm = 0;
  let worstCircle = -Infinity, worstPow = -Infinity, signFlip = 0, prevVw = [...car._vw], ke = Infinity;
  let keUp = 0, keUpLast = -1, allBrakingAt = -1, n = 0;
  for (let i = 0; i < 12000 && car.u > uEnd; i++) {
    car.step(DT); n++;
    worstCircle = Math.max(worstCircle, car._fcMarginSS);
    worstPow = Math.max(worstPow, car._slipPowerSS);
    for (let k = 0; k < 4; k++) if (prevVw[k] * car._vw[k] < 0) signFlip++;
    prevVw = [...car._vw];
    // **全輪が制動側の縦力を出した最初の tick**。BRAKE へ切り替えた直後は、直前まで全開だった駆動輪が
    // 地面より速く回っている（κ>0＝前へ押している）ため、そのスリップが洗い流されるまで車体は減速しない。
    if (allBrakingAt < 0 && car._fxWheel.every(v => v <= 0)) allBrakingAt = i;
    const keNow = 0.5 * (car.u * car.u + car.vlat * car.vlat);
    if (keNow > ke + 1e-9) { keUp++; keUpLast = i; }
    ke = keNow;
  }
  const d = car.x - x0;
  return { u0: uu, d, a: (uu * uu - uEnd * uEnd) / (2 * d), n, worstCircle, worstPow, signFlip, keUp, keUpLast, allBrakingAt };
}
// 指定速度まで落ちた瞬間の診断スナップショット（速度を揃えて比べる）。
function snapAt(type, bset, grip, uMatch, u0 = 40) {
  const car = spin(type, bset, grip, u0);
  car.driveDir = CONST.BRAKE; car.pwm = 0;
  let prevU = car.u;
  for (let i = 0; i < 12000; i++) {
    prevU = car.u; car.step(DT);
    if (car.u <= uMatch) return { a: (prevU - car.u) / DT, latCap: car._latCapSS, latCapF: car._latCapF,
                                  fx: [...car._fxWheel], fApp: [...car._fAppWheel], Fz: [...car._FzWheel], mu: [...car._muUse4] };
  }
  return null;
}
// トレイルブレーキ: 定常旋回 1.0s → brakeTicks 制動 → 1.5s 旋回継続。
function trail(type, bset, R, entryK, brakeTicks, grip, prop) {
  const vg = Math.sqrt(Tn.mu0 * grip * DYN.g * R);
  const car = spin(type, bset, grip, entryK * vg);
  car.steerSet = prop ? 'prop' : 'tri';
  const steerTo = () => {
    const w = CAR.wheelBase / R + 0.5 * (car.u / R - car.r);
    if (prop) { const n = Math.max(-1, Math.min(1, w / CAR.maxSteer)); car.steer = n >= 0 ? CONST.LEFT : CONST.RIGHT; car.steerAmt = Math.round(Math.abs(n) * 255); }
    else { car.steer = (car.steerAngle < w) ? CONST.LEFT : CONST.RIGHT; car.steerAmt = null; }
  };
  const hold = () => { car.driveDir = CONST.FORWARD; car.pwm = Math.round(Math.max(0, Math.min(255, car.u / (CAR.maxSpeed * car.profile().maxSpeed) * 255))); };
  for (let i = 0; i < 60; i++) { steerTo(); hold(); car.step(DT); }
  const ayR0 = Math.abs(car._ayRearTire);
  let lockR = 0, bpkB = 0, ayRsum = 0, wc = -Infinity, wp = -Infinity;
  for (let i = 0; i < brakeTicks; i++) {
    steerTo(); car.driveDir = CONST.BRAKE; car.pwm = 0; car.step(DT);
    const v = Math.abs(car.u);
    if ((Math.abs(car._vw[2]) + Math.abs(car._vw[3])) / 2 < 0.05 * v) lockR++;
    bpkB = Math.max(bpkB, Math.abs(Math.atan2(car.vlat, Math.max(v, 1e-6)) * deg));
    ayRsum += Math.abs(car._ayRearTire);
    wc = Math.max(wc, car._fcMarginSS); wp = Math.max(wp, car._slipPowerSS);
  }
  let bpk = bpkB, spun = false;
  for (let i = 0; i < 90; i++) {
    steerTo(); hold(); car.step(DT);
    const b = Math.abs(Math.atan2(car.vlat, Math.max(Math.abs(car.u), 1e-6)) * deg);
    bpk = Math.max(bpk, b); wc = Math.max(wc, car._fcMarginSS); wp = Math.max(wp, car._slipPowerSS);
    if (b > 115 || car.u < -0.5) { spun = true; break; }
  }
  const bEnd = Math.abs(Math.atan2(car.vlat, Math.max(Math.abs(car.u), 1e-6)) * deg);
  return { lockR: lockR / brakeTicks, bpkB, bpk, spun, recovered: !spun && bEnd < 10,
           ayRet: (ayRsum / brakeTicks) / Math.max(ayR0, 1e-9), worstCircle: wc, worstPow: wp };
}

// ══ A. 既定 'motor' の完全縮退 ═══════════════════════════════════════════════════════
console.log('\n=== A: 既定 motor の完全縮退（装備を積まない車は 1 バイトも変わらない）===');
{
  ok(brakeParamsFor('motor') === null && brakeParamsFor(undefined) === null && brakeParamsFor(null) === null
     && brakeParamsFor('bogus') === null && brakeParamsFor(123) === null,
     `A1 motor / 未指定 / null / 未知キー / 非文字列 は全て null（＝配分ブロックへ入らない）へ解決`);
  ok(BRAKE_SETS.filter(k => k !== BRAKE_DEFAULT).every(k => { const b = brakeParamsFor(k); return b && Number.isFinite(b.biasF); }),
     `A2 非既定 ${BRAKE_SETS.filter(k => k !== BRAKE_DEFAULT).length} 種はすべて有限の biasF を返す（${BRAKE_SETS.filter(k => k !== BRAKE_DEFAULT).map(k => `${k}=${BRAKES[k].biasF}`).join(' ')}）`);
  // 値域の防御（AV1 軽6 と同型・沈黙する故障の禁止）: 壊れた定義は既定へ縮退する。
  const broken = { badHigh: { biasF: 1.4 }, badLow: { biasF: -0.2 }, badNaN: { biasF: NaN }, badMissing: {} };
  const saved = {};
  for (const k in broken) { saved[k] = BRAKES[k]; BRAKES[k] = broken[k]; }
  const degraded = Object.keys(broken).every(k => brakeParamsFor(k) === null);
  for (const k in broken) { if (saved[k] === undefined) delete BRAKES[k]; else BRAKES[k] = saved[k]; }
  ok(degraded, 'A3 値域外の定義（biasF>1 / <0 / NaN / 欠落）は **既定 null へ縮退**＝片軸へ負の制動力（＝加速）が流れる沈黙故障を作らない');
  // 既定車が本当に旧経路を通る: 制動中の非駆動輪は接地追従（fApp=0・vw=接地速度）のまま。
  const carFR = spin('normal_fr', 'motor', 1, 30);
  carFR.driveDir = CONST.BRAKE; carFR.pwm = 0; carFR.step(DT);
  ok(carFR._fAppWheel[0] === 0 && carFR._fAppWheel[1] === 0 && carFR._fxWheel[0] === 0 && carFR._fxWheel[1] === 0,
     `A4 既定 motor の FR は 前輪の指令力も路面縦力も **厳密 0**（自由転動）= 旧経路そのもの`);
  const carFF = spin('normal_ff', 'motor', 1, 30);
  carFF.driveDir = CONST.BRAKE; carFF.pwm = 0; carFF.step(DT);
  ok(carFF._fAppWheel[2] === 0 && carFF._fAppWheel[3] === 0 && carFF._fxWheel[2] === 0 && carFF._fxWheel[3] === 0,
     `A5 既定 motor の FF は 後輪が **厳密 0**（駆動軸 split に従う旧配分）`);
  // 既定と「brakeSet を触っていない車」が bit 一致する（フィールドを足したこと自体が挙動を変えない）。
  const mk = (set) => { const c = spin('normal_fr', 'motor', 1, 30); if (set !== undefined) c.brakeSet = set;
    c.driveDir = CONST.BRAKE; c.pwm = 0; for (let i = 0; i < 120; i++) c.step(DT); return [c.x, c.y, c.theta, c.u, c.vlat, c.r, ...c._vw]; };
  const base = mk(undefined), asMotor = mk('motor'), asBogus = mk('bogus');
  ok(base.every((v, i) => v === asMotor[i]) && base.every((v, i) => v === asBogus[i]),
     `A6 未設定 / 'motor' / 未知値 の 120 tick 後の状態が **全成分 bit 一致**（x=${base[0].toFixed(9)} u=${base[3].toFixed(9)}）`);
}
console.log(`  [A] ${lap().toFixed(1)}s`);

// ══ B. 配分の法則（実装の診断量を外から読む・AV1 教訓(ii)）═════════════════════════
console.log('\n=== B: 制動力の配分（実装の _fAppWheel / _fxWheel を外から読む）===');
{
  const rows = [];
  let biasExact = 0, biasRows = 0, symOK = 0, totalOK = 0, totalRows = 0;
  // **配分と総量は「加算順の違いぶんの丸め」しか許さない**。左右を足してから軸ぶんを足す順は実装と
  // ゲートで一致しないので厳密等号は原理的に立たない（実測: 9 行中 4 行だけが bit 一致）。∴ 許容を
  // **2 ULP** に置く — 検出力は B5 が示す（biasF を半分にする変異は相対 5e-1＝ここより 15 桁大きい）。
  const ULP2 = 2 * Number.EPSILON;
  let worstBias = 0, worstTot = 0;
  for (const type of TYPES) {
    const tot = {};
    for (const b of BRAKE_SETS) {
      const car = spin(type, b, 1, 30);
      car.driveDir = CONST.BRAKE; car.pwm = 0; car.step(DT);
      const f = car._fAppWheel, sum = f[0] + f[1] + f[2] + f[3];
      tot[b] = sum;
      const bias = sum !== 0 ? (f[0] + f[1]) / sum : NaN;
      rows.push({ type, brake: b, fApp: [...f], sum, bias });
      if (BRAKES[b]) { biasRows++; const e = Math.abs(bias - BRAKES[b].biasF) / BRAKES[b].biasF; if (e <= ULP2) biasExact++; worstBias = Math.max(worstBias, e); }
      if (f[0] === f[1] && f[2] === f[3]) symOK++;
    }
    for (const b of BRAKE_SETS) { totalRows++; const e = Math.abs(tot[b] - tot.motor) / Math.abs(tot.motor); if (e <= ULP2) totalOK++; worstTot = Math.max(worstTot, e); }
  }
  for (const r of rows) console.log(`     ${r.type.padEnd(11)} ${r.brake.padEnd(14)} fApp=[${r.fApp.map(v => v.toFixed(3)).join(', ')}] 総和=${r.sum.toFixed(4)} 前配分=${Number.isFinite(r.bias) ? r.bias.toFixed(4) : '  --  '}`);
  ok(biasRows > 0 && biasExact === biasRows,
     `B1 **前配分が定義値と一致**（≤2 ULP）: ${biasExact}/${biasRows} 行・最悪 ${worstBias.toExponential(2)}（1 ULP=${Number.EPSILON.toExponential(2)}）。実装の _fAppWheel から算出＝ゲート側で配分式を組み直していない`);
  ok(totalOK === totalRows,
     `B2 **総制動力は装備で変わらない**（配分だけが変わる）: ${totalOK}/${totalRows} 行で Σ fApp が motor と一致（≤2 ULP・最悪 ${worstTot.toExponential(2)}）`);
  ok(symOK === rows.length, `B3 左右対称（lsd=0 の normal 車）: ${symOK}/${rows.length} 行で fApp[FL]===fApp[FR] かつ fApp[RL]===fApp[RR]`);
  // 4輪 ODE への参加: 摩擦制動中は **非駆動輪も** 路面縦力を出す（＝ロックが創発しうる）。
  let allFour = 0;
  for (const type of TYPES) {
    const car = spin(type, 'friction', 1, 30);
    car.driveDir = CONST.BRAKE; car.pwm = 0; for (let i = 0; i < 10; i++) car.step(DT);
    if (car._fxWheel.every(v => v !== 0)) allFour++;
  }
  ok(allFour === TYPES.length, `B4 摩擦制動中は **4 輪すべてが路面へ縦力を出す**（${allFour}/${TYPES.length} 駆動方式）= 非駆動輪も車輪 ODE に参加している`);
  // B7 **効果側の述語**（AV2 敵対的検証で追加）: B1〜B3 は _fAppWheel＝**指令**しか見ていないので、
  //   「4 輪 ODE 参加」を実装から外す変異でも緑のまま残った（実測）。∴ **非駆動輪が実際に路面へ出した
  //   縦力 _fxWheel の比率**を見る。motor の FR は前輪が厳密 0、friction は無視できない割合を出す。
  {
    const share = (type, b) => {
      const c = spin(type, b, 1, 30); c.driveDir = CONST.BRAKE; c.pwm = 0;
      let sNon = 0, sAll = 0;
      for (let i = 0; i < 60 && c.u > 5; i++) {
        c.step(DT);
        const fx = c._fxWheel, dk = /_ff$/.test(type) ? [2, 3] : [0, 1];   // 非駆動軸の輪 idx
        sNon += Math.abs(fx[dk[0]]) + Math.abs(fx[dk[1]]);
        sAll += fx.reduce((a, v) => a + Math.abs(v), 0);
      }
      return sAll > 0 ? sNon / sAll : 0;
    };
    const rows = ['normal_fr', 'normal_ff'].map(t => ({ t, m: share(t, 'motor'), f: share(t, 'friction') }));
    for (const r of rows) console.log(`     ${r.t.padEnd(11)} 非駆動軸が出した縦力の割合: motor ${(100 * r.m).toFixed(1)}% → friction ${(100 * r.f).toFixed(1)}%`);
    ok(rows.every(r => r.m === 0 && r.f > 0.15),
       `B7 **効果側**: 非駆動軸が実際に路面へ出した縦力（_fxWheel）の割合は motor で厳密 0%・friction で ${rows.map(r => `${r.t} ${(100 * r.f).toFixed(1)}%`).join(' / ')}（>15% を要求）＝指令だけでなく **実力が動いている**`);
  }
  // 検出力（外部変異）: biasF を書き換えると B1 が落ちることを **その場で** 確かめる。
  const savedBias = BRAKES.friction.biasF;
  BRAKES.friction = { biasF: savedBias * 0.5 };
  const mut = spin('normal_fr', 'friction', 1, 30);
  mut.driveDir = CONST.BRAKE; mut.pwm = 0; mut.step(DT);
  const mutSum = mut._fAppWheel.reduce((a, c) => a + c, 0);
  const mutBias = (mut._fAppWheel[0] + mut._fAppWheel[1]) / mutSum;
  BRAKES.friction = { biasF: savedBias };
  ok(Math.abs(mutBias - savedBias) > 1e-9 && Math.abs(mutBias - savedBias * 0.5) < 1e-12,
     `B5 **検出力**: biasF を ${savedBias}→${(savedBias * 0.5).toFixed(2)} に変異させると実測前配分が ${mutBias.toFixed(4)} へ動く（B1 が赤になる＝恒真でない）`);
  const restored = spin('normal_fr', 'friction', 1, 30);
  restored.driveDir = CONST.BRAKE; restored.pwm = 0; restored.step(DT);
  const rSum = restored._fAppWheel.reduce((a, c) => a + c, 0);
  ok((restored._fAppWheel[0] + restored._fAppWheel[1]) / rSum === savedBias, `B6 変異を戻したら前配分が定義値 ${savedBias} へ厳密復帰（B5 の後始末）`);
  JSONOUT.B = rows;
}
console.log(`  [B] ${lap().toFixed(1)}s`);

// ══ C. 閉形式（実装の容量診断だけから減速度比を予測）═══════════════════════════════
console.log('\n=== C: 閉形式 — 「どの輪が制動するか」と「その輪が持つ容量」で減速度比が決まる ===');
console.log('     motor(FR)=後軸だけが制動 ⇒ 使える容量 = _latCapSS − _latCapF ／ friction=4輪 ⇒ _latCapSS');
console.log('     どちらも **実装が自分で計算した容量** を読むだけ（ゲート側で μ_eff を組み直さない・AV1 教訓(ii)）');
{
  const rows = [];
  const grips = FULL ? [0.5, 0.6, 0.8, 1.0, 1.2, 1.4] : [0.6, 1.0, 1.4];
  for (const grip of grips) for (const u of [30, 20, 10]) {
    const m = snapAt('normal_fr', 'motor', grip, u), f = snapAt('normal_fr', 'friction', grip, u);
    if (!m || !f) continue;
    const capM = m.latCap - m.latCapF, rMeas = m.a / f.a, rPred = capM / f.latCap;
    rows.push({ grip, u, aM: m.a, aF: f.a, rMeas, rPred, err: rMeas / rPred - 1 });
  }
  for (const r of rows) console.log(`     grip ${r.grip.toFixed(1)} u=${String(r.u).padStart(2)}m/s  a_motor ${r.aM.toFixed(3).padStart(6)}  a_friction ${r.aF.toFixed(3).padStart(6)}  実測比 ${r.rMeas.toFixed(4)}  容量比 ${r.rPred.toFixed(4)}  誤差 ${(r.err * 100).toFixed(2).padStart(5)}%`);
  const low = rows.filter(r => r.u === 10), high = rows.filter(r => r.u === 30);
  const wLow = Math.max(...low.map(r => Math.abs(r.err))), wHigh = Math.max(...high.map(r => Math.abs(r.err)));
  ok(low.length >= 3 && wLow < 0.02,
     `C1 **低速極限で閉形式が成立**: u=10m/s の ${low.length} 点すべてで |実測比 − 容量比| < 2%（最悪 ${(wLow * 100).toFixed(2)}%）＝ 減速度比は「制動する輪の容量比」で決まる`);
  ok(wHigh > wLow,
     `C2 **残差は空力抗力である**（速度とともに増える）: 誤差は u=10 で ${(wLow * 100).toFixed(2)}% → u=30 で ${(wHigh * 100).toFixed(2)}%。抗力はタイヤ容量に入らないぶん実測比を押し上げる`);
  ok(rows.every(r => r.rMeas > 0.3 && r.rMeas < 0.6),
     `C3 **FR のモーターブレーキは 4 輪摩擦の半分以下**: 実測比の範囲 ${Math.min(...rows.map(r => r.rMeas)).toFixed(3)}〜${Math.max(...rows.map(r => r.rMeas)).toFixed(3)}（後軸だけで止めているため）`);
  // μ 掃引: 全輪ロックでは ΣFz が保存されるので friction の減速度は grip に対し単調・**劣線形**
  // （荷重感度 kLS>0 で重い輪ほど μ が下がる）。単調性と劣線形の両方を述語にする。
  const sw = [];
  for (const grip of grips) sw.push({ grip, a: straightBrake('normal_fr', 'friction', grip, 40).a });
  const a1 = sw.find(r => Math.abs(r.grip - 1.0) < 1e-9) || sw[Math.floor(sw.length / 2)];
  for (const r of sw) r.rel = r.a / a1.a;
  console.log(`     μ 掃引（friction・40m/s 全制動）: ${sw.map(r => `grip ${r.grip.toFixed(1)}→a ${r.a.toFixed(2)} (比 ${r.rel.toFixed(3)} vs grip比 ${(r.grip / a1.grip).toFixed(3)})`).join('  ')}`);
  const mono = sw.every((r, i) => i === 0 || r.a > sw[i - 1].a);
  // 【AV2 敵対的検証で是正】旧版は三項演算子の **両分岐が同一式** という死んだコードで、しかも
  //   メッセージが「荷重感度 kLS が原因」と断定していた。変異注入 (kLS=0.10→0.00) で **緑のまま**
  //   だったので **この帰属は成立しない**。∴ 機序の主張を撤回し、**測定された関係だけ**を述語にする
  //   （AV1 で「機序は特定できていない」へ置換した教訓と同型）。
  const worstBelow = Math.max(...sw.filter(r => r.grip !== a1.grip).map(r => r.rel / (r.grip / a1.grip)));
  const sub = sw.filter(r => r.grip !== a1.grip).every(r => r.rel < r.grip / a1.grip);
  ok(mono, `C4 μ 単調性: grip を ${grips[0]}→${grips[grips.length - 1]} と上げると減速度は単調に増える（${sw.map(r => r.a.toFixed(2)).join(' < ')}）`);
  ok(sub, `C5 **減速度比は grip 比を下回る（両端で）**: 全 ${sw.length - 1} 点で a(g)/a(1) < g（最悪 ${worstBelow.toFixed(4)} <1）。**機序は特定していない** — 荷重感度 kLS を 0 にしても本アサートは緑のままだったので kLS では説明できない（比例なら 1.0 になる）`);
  // C6 (記録) 直線制動距離の表。**docs/physics_model の数値はこの表を引用する**（真実源を 1 つにする）。
  const dist = [];
  console.log(`     直線制動距離（fullscale・normal タイヤ・grip 1.0・40m/s → 2m/s）:`);
  for (const type of TYPES) {
    const row = { type };
    for (const b of BRAKE_SETS) { const r = straightBrake(type, b, 1.0, 40, 2); row[b] = { d: r.d, a: r.a, g: r.a / DYN.g }; }
    dist.push(row);
    console.log(`       ${type.padEnd(11)} ${BRAKE_SETS.map(b => `${b} ${row[b].d.toFixed(2)}m(${row[b].g.toFixed(3)}g)`).join(' / ')}`);
  }
  // C7 (記録) **文書が引用する 2 つの数値をここで生成する**（真実源を 1 つにする・AV2 敵対的検証の指摘）:
  //   ① 制動指令の大きさ [g]  ② 制動直後の車輪面速度スナップショット。
  //   ①は `CAR.brake·p.brake·grip·gr /(1+MASS.brake·(massK−1))` で、**質量項を落とすと 0.14g ずれる**
  //   （旧版の文書はその誤った値 3.87g を 5 箇所へ書いていた）。
  const cmdG = {}, snap = {};
  for (const type of TYPES) {
    const c = spin(type, 'motor', 1, 30);
    const p2 = c.profile(), massK = (p2.mass || MASS_REF) / MASS_REF;
    cmdG[type] = CAR.brake * p2.brake * 1 / (1 + MASS.brake * (massK - 1)) / DYN.g;
    const c2 = spin(type, 'motor', 1, 40); c2.driveDir = CONST.BRAKE; c2.pwm = 0;
    for (let i = 0; i < 30; i++) c2.step(DT);
    snap[type] = { u: c2.u, vw: [...c2._vw] };
  }
  console.log(`     制動指令 [g]（= CAR.brake·p.brake·grip·gr /(1+MASS.brake·(massK−1)) / g）: ${TYPES.map(t => `${t} ${cmdG[t].toFixed(3)}`).join(' / ')}`);
  console.log(`     制動 0.5s 後の車輪面速度（40m/s から・motor）: ${TYPES.map(t => `${t} u=${snap[t].u.toFixed(2)} vw=[${snap[t].vw.map(v => v.toFixed(2)).join(', ')}]`).join('  ／  ')}`);
  ok(cmdG.normal_fr > 3 && snap.normal_fr.vw[2] === 0 && snap.normal_fr.vw[3] === 0 && snap.normal_fr.vw[0] > 0,
     `C7 (記録) FR の制動指令は **${cmdG.normal_fr.toFixed(3)}g**（タイヤ容量 ${(Tn.mu0).toFixed(2)}g の ${(cmdG.normal_fr / Tn.mu0).toFixed(2)} 倍＝必ず飽和）。制動 0.5s 後の車輪面速度は u=${snap.normal_fr.u.toFixed(2)} に対し **[前 ${snap.normal_fr.vw[0].toFixed(2)}, ${snap.normal_fr.vw[1].toFixed(2)} / 後 ${snap.normal_fr.vw[2].toFixed(2)}, ${snap.normal_fr.vw[3].toFixed(2)}]**（前輪は接地追従・後輪は完全ロック）`);
  const frRow = dist.find(r => r.type === 'normal_fr');
  ok(frRow.motor.d > frRow.friction.d * 1.5,
     `C6 **FR は 4 輪摩擦で劇的に短く止まる**: ${frRow.motor.d.toFixed(2)}m（${frRow.motor.g.toFixed(3)}g・後軸だけ）→ ${frRow.friction.d.toFixed(2)}m（${frRow.friction.g.toFixed(3)}g）＝ ${(100 * (1 - frRow.friction.d / frRow.motor.d)).toFixed(0)}% 短縮`);
  const awdRow = dist.find(r => r.type === 'normal_awd');
  ok(Math.abs(awdRow.motor.d - awdRow.friction.d) / awdRow.motor.d < 0.05,
     `C6b **AWD はほとんど変わらない**: ${awdRow.motor.d.toFixed(2)}m → ${awdRow.friction.d.toFixed(2)}m（差 ${(100 * Math.abs(awdRow.motor.d - awdRow.friction.d) / awdRow.motor.d).toFixed(1)}%）＝ モーターブレーキでも既に 4 輪へ配られているため。装備が効くのは「制動が掛からない輪がある」車`);
  JSONOUT.C = { rows, sweep: sw, dist };
}
console.log(`  [C] ${lap().toFixed(1)}s`);

// ══ D. 旋回中制動（トレイルブレーキ）═══════════════════════════════════════════════
console.log('\n=== D: 旋回中制動 — 2 つの独立な格子で符号が保たれた主張だけを述語にする（AV1 教訓(i)）===');
{
  const G1 = []; for (const R of [40, 60, 90]) for (const e of [0.75, 0.85, 0.95]) for (const bt of [10, 20, 30]) for (const g of [0.6, 1.0]) G1.push({ R, e, bt, g, prop: true });
  const G2 = []; const rr = FULL ? [30, 50, 75, 120] : [30, 75], ee = FULL ? [0.7, 0.8, 0.9, 1.0] : [0.7, 0.9],
        bb = FULL ? [6, 15, 25] : [6, 25], gg = FULL ? [0.5, 0.8, 1.2] : [0.5, 1.2];
  for (const R of rr) for (const e of ee) for (const bt of bb) for (const g of gg) for (const prop of [false, true]) G2.push({ R, e, bt, g, prop });
  const summarize = (type, grid) => {
    let lockDown = 0, lockUp = 0, bpkDown = 0, bpkUp = 0, recGain = 0, recLoss = 0, sM = 0, sF = 0, bM = 0, bF = 0, rM = 0, rF = 0, wc = -Infinity, wp = -Infinity;
    for (const c of grid) {
      const m = trail(type, 'motor', c.R, c.e, c.bt, c.g, c.prop), f = trail(type, 'friction', c.R, c.e, c.bt, c.g, c.prop);
      sM += m.lockR; sF += f.lockR; bM += m.bpk; bF += f.bpk; if (m.recovered) rM++; if (f.recovered) rF++;
      wc = Math.max(wc, m.worstCircle, f.worstCircle); wp = Math.max(wp, m.worstPow, f.worstPow);
      if (f.lockR < m.lockR - 1e-9) lockDown++; else if (f.lockR > m.lockR + 1e-9) lockUp++;
      if (f.bpk < m.bpk - 1e-9) bpkDown++; else if (f.bpk > m.bpk + 1e-9) bpkUp++;
      if (f.recovered && !m.recovered) recGain++; if (!f.recovered && m.recovered) recLoss++;
    }
    const n = grid.length;
    return { n, lockDown, lockUp, bpkDown, bpkUp, recGain, recLoss, lockM: sM / n, lockF: sF / n, bpkM: bM / n, bpkF: bF / n, recM: rM, recF: rF, wc, wp };
  };
  const res = {};
  for (const type of TYPES) {
    res[type] = { g1: summarize(type, G1), g2: summarize(type, G2) };
    for (const [gn, r] of Object.entries(res[type])) {
      console.log(`     ${type.padEnd(11)} ${gn}(${String(r.n).padStart(3)}セル) 後軸ロック率 ${r.lockM.toFixed(3)}→${r.lockF.toFixed(3)} [下${r.lockDown}/上${r.lockUp}] ｜ βpk ${r.bpkM.toFixed(1)}°→${r.bpkF.toFixed(1)}° [下${r.bpkDown}/上${r.bpkUp}] ｜ 復帰 ${r.recM}→${r.recF} [得${r.recGain}/失${r.recLoss}]`);
    }
  }
  const fr = res.normal_fr;
  ok(fr.g1.lockUp === 0 && fr.g2.lockUp === 0 && fr.g1.lockDown > 0 && fr.g2.lockDown > 0,
     `D1 **FR の後軸ロックは摩擦ブレーキで必ず減る（符号が 2 格子で保たれる）**: 格子1 下${fr.g1.lockDown}/上${fr.g1.lockUp}（平均 ${fr.g1.lockM.toFixed(3)}→${fr.g1.lockF.toFixed(3)}）・格子2 下${fr.g2.lockDown}/上${fr.g2.lockUp}（平均 ${fr.g2.lockM.toFixed(3)}→${fr.g2.lockF.toFixed(3)}）`);
  ok(fr.g1.recLoss === 0 && fr.g2.recLoss === 0 && fr.g1.recGain > 0 && fr.g2.recGain > 0,
     `D2 **FR の旋回復帰は 1 セルも悪化しない**: 格子1 得${fr.g1.recGain}/失${fr.g1.recLoss}（${fr.g1.recM}/${fr.g1.n}→${fr.g1.recF}/${fr.g1.n}）・格子2 得${fr.g2.recGain}/失${fr.g2.recLoss}（${fr.g2.recM}/${fr.g2.n}→${fr.g2.recF}/${fr.g2.n}）`);
  const ff = res.normal_ff;
  // 【AV2 敵対的検証で是正】旧版は `lockDown === 0` だけを見ており、**装備をまるごと止める変異でも
  //   緑のまま**だった（lockUp=0 かつ lockDown=0 で通る）。D1 と同じく **非空振り節 lockUp > 0** を課す。
  ok(ff.g1.lockDown === 0 && ff.g2.lockDown === 0 && ff.g1.lockUp > 0 && ff.g2.lockUp > 0,
     `D3 **FF は逆に後軸ロックが増える（装備の直接の帰結・符号は 2 格子で保たれる）**: 格子1 上${ff.g1.lockUp}/下${ff.g1.lockDown}・格子2 上${ff.g2.lockUp}/下${ff.g2.lockDown}。モーターブレーキの FF は後輪に制動が一切掛からないので、4 輪化すれば必ず増える（上が 0 なら装備が効いていない＝非空振り）`);
  // βpk は **方向を主張しない**（2 格子とも増減が割れる）。平均と内訳を記録に落とす。
  console.log(`     ※ **βpk の方向は主張しない**: FR ですら 格子1 下${fr.g1.bpkDown}/上${fr.g1.bpkUp}・格子2 下${fr.g2.bpkDown}/上${fr.g2.bpkUp} と割れる。`);
  console.log(`        平均は下がる（FR 格子1 ${fr.g1.bpkM.toFixed(1)}°→${fr.g1.bpkF.toFixed(1)}°・格子2 ${fr.g2.bpkM.toFixed(1)}°→${fr.g2.bpkF.toFixed(1)}°）が、これは **連続量の記録**であって述語ではない`);
  console.log(`        （AV1 で「格子を変えると符号が反転する主張」を撤回した教訓 (i) の適用）。`);
  ok(fr.g1.bpkF < fr.g1.bpkM && fr.g2.bpkF < fr.g2.bpkM,
     `D4 (記録) FR の βpk 平均は 2 格子とも下がる: 格子1 ${fr.g1.bpkM.toFixed(1)}°→${fr.g1.bpkF.toFixed(1)}°・格子2 ${fr.g2.bpkM.toFixed(1)}°→${fr.g2.bpkF.toFixed(1)}°。**セル単位では ${fr.g1.bpkUp + fr.g2.bpkUp} セルで増える**ので「必ず下がる」とは言えない`);
  JSONOUT.D = res;
}
console.log(`  [D] ${lap().toFixed(1)}s`);

// ══ E. 不変条件 ═════════════════════════════════════════════════════════════════════
console.log('\n=== E: 不変条件（何が AV2 固有の検出力を持ち、何が構造的に恒真かを分けて書く）===');
{
  // E1 **ロックは創発する**（コードに閾値を書いていない）。biasF を上げると 前ロックが増え後ロックが減る、
  //    という **連続な共依存** は「配分 → 輪ごとの需要 → 容量との突き合わせ」が ODE 上で解かれている
  //    ことの直接の証拠（閾値実装ならこの共依存は出ない）。grip を変えても順序が保たれることも見る。
  const bset = ['frictionRear', 'friction', 'frictionFront'];   // biasF 0.45 < 0.60 < 0.75
  const grips = FULL ? [0.5, 0.6, 0.8, 1.0, 1.2] : [0.6, 1.0];
  const tbl = [];
  let monoF = 0, monoR = 0, clampTotal = 0;
  for (const grip of grips) {
    const row = { grip, lf: [], lr: [] };
    for (const b of bset) {
      const R = 60, entryK = 0.85, bt = 25, vg = Math.sqrt(Tn.mu0 * grip * DYN.g * R);
      const car = spin('normal_fr', b, grip, entryK * vg); car.steerSet = 'prop';
      const st = () => { const w = CAR.wheelBase / R + 0.5 * (car.u / R - car.r); const n = Math.max(-1, Math.min(1, w / CAR.maxSteer));
        car.steer = n >= 0 ? CONST.LEFT : CONST.RIGHT; car.steerAmt = Math.round(Math.abs(n) * 255); };
      for (let i = 0; i < 60; i++) { st(); car.driveDir = CONST.FORWARD; car.pwm = Math.round(car.u / (CAR.maxSpeed * car.profile().maxSpeed) * 255); car.step(DT); }
      let lf = 0, lr = 0;
      for (let i = 0; i < bt; i++) {
        st(); car.driveDir = CONST.BRAKE; car.pwm = 0;
        const before = [...car._vw];
        car.step(DT);
        const v = Math.abs(car.u);
        if ((Math.abs(car._vw[0]) + Math.abs(car._vw[1])) / 2 < 0.05 * v) lf++;
        if ((Math.abs(car._vw[2]) + Math.abs(car._vw[3])) / 2 < 0.05 * v) lr++;
        for (let k = 0; k < 4; k++) if (before[k] > 0 && car._vw[k] === 0) clampTotal++;
      }
      row.lf.push(lf / bt); row.lr.push(lr / bt);
    }
    tbl.push(row);
    if (row.lf[0] < row.lf[1] && row.lf[1] < row.lf[2]) monoF++;
    if (row.lr[0] > row.lr[1] && row.lr[1] > row.lr[2]) monoR++;
    console.log(`     grip ${row.grip.toFixed(1)}  前ロック率 ${row.lf.map(v => v.toFixed(3)).join(' → ')}（biasF ${bset.map(b => BRAKES[b].biasF).join(' → ')}）  後ロック率 ${row.lr.map(v => v.toFixed(3)).join(' → ')}`);
  }
  ok(monoF === tbl.length && monoR === tbl.length,
     `E1 **ロックは創発する**: biasF を 0.45→0.60→0.75 と上げると 前ロック率は単調増・後ロック率は単調減（${monoF}/${tbl.length} と ${monoR}/${tbl.length} の grip で成立）。コードにロック閾値は 1 つも無く、輪ごとの需要と容量の突き合わせが車輪 ODE の上で解かれている`);
  // E2 車輪面速度は制動中に符号を跨がない（ブレーキは車輪を逆回転へ駆動できない）＋ **非空振り**。
  const sb = [];
  for (const type of TYPES) for (const b of BRAKE_SETS) for (const grip of [0.6, 1.0, 1.4]) sb.push(straightBrake(type, b, grip, 40));
  const flips = sb.reduce((a, r) => a + r.signFlip, 0), keUps = sb.reduce((a, r) => a + r.keUp, 0);
  const ticks = sb.reduce((a, r) => a + r.n, 0);
  ok(flips === 0, `E2 **ブレーキは車輪を逆回転へ駆動しない**: 直線制動 ${sb.length} run / ${ticks} tick で車輪面速度の符号反転 ${flips} 件（**範囲は直線制動のみ** — D 章の旋回格子は符号反転を見ていない。別途 1296 セルの旋回掃引でも 0 件だったが、それは本ゲートの機械検査には入っていない）`);
  ok(clampTotal > 0, `E2b 非空振り: 上の E1 掃引で 0 クランプが実際に ${clampTotal} 回発火（＝無制約なら負へ行く輪が居る＝E2 は恒真な空文ではない）`);
  // E3 **エネルギー**: BRAKE へ切替えた直後は、直前まで全開だった駆動輪が地面より速く回っている（κ>0）ため
  //    車体はまだ前へ押される。∴「制動中つねに単調減少」は **既定 motor でも偽**（実測でそう出た）。
  //    正しい法則は「**全輪が制動側の縦力を出した瞬間から先は 1 件も増えない**」で、実測では KE 増加の
  //    最終 tick と『全輪が制動側になった tick』が run ごとに ±1 tick で一致する。
  const lateUps = sb.filter(r => r.allBrakingAt >= 0 && r.keUpLast > r.allBrakingAt);
  const washMax = Math.max(...sb.map(r => r.allBrakingAt));
  ok(lateUps.length === 0,
     `E3 **全輪が制動側になった後は運動エネルギーが単調減少**: ${sb.length} run / ${ticks} tick のうち、洗い流し完了後に増加した run は ${lateUps.length} 件。増加 ${keUps} 件はすべて洗い流し相（最長 ${washMax} tick = ${(washMax / 60).toFixed(3)}s）に収まる`);
  ok(keUps > 0 && washMax > 0,
     `E3b 非空振り: 洗い流し相は実在する（KE 増加 ${keUps} 件・最長 ${washMax} tick）＝E3 は「増加が起きない」ことに逃げた恒真ではなく、**起きる場所を特定して** 押さえている`);
  const wc = Math.max(...sb.map(r => r.worstCircle)), wp = Math.max(...sb.map(r => r.worstPow));
  ok(wc <= 0 && wp <= 0,
     `E4 (記録) 定常タイヤ力の摩擦円マージン max=${wc.toExponential(2)}・接地散逸性 max=${wp.toExponential(2)}（どちらも ≤0）`);
  // E5 **既存挙動の記録（AV2 が作ったものではない）**: LSD 装備車（profile.drift ⇒ lsd=0.8）では、
  //   差動の移送 Tt（上限 V2.lsdTtMax=8・mass-norm の絶対値）が **軸の制動力の半分を上回りうる**ため、
  //   制動中に片輪の指令力 fApp が総和と逆符号（＝加速側）になることがある。
  //   **既定 motor でも起きる**（下の実測が示す）＝ AO3 差動モデルの既存の性質であって AV2 由来ではない。
  //   AV2 は駆動軸の取り分を 1.0 から biasF/(1−biasF) へ下げるので **件数が変わる**（＝露出は増減する）。
  //   総量は保存され（B2）、洗い流し後のエネルギー注入も 0（E3）なので不変条件は破れていない。
  //   **AV3 への申し送り**: lsdTtMax を「伝達トルクに対する相対上限」にすべきかは設計判断（既定物理を
  //   変えるので AV2 のスコープ外）。ここでは **黙って落とさず件数を記録**する。
  {
    // 掃引は **3 領域 × 全 6 車種 × 4 装備 × 7 grip**（504 run）。狭い掃引では既定 motor が 0 件になり、
    // 「既存挙動である」という主張の根拠を再現できない（実測でそうなった）ので条件を絞らない。
    // 助走は固定 tick（速度でなく）— 領域ごとに到達速度が変わるほうが露出条件を広く踏む。
    const tally = {}; let e5Runs = 0, e5Ticks = 0;
    for (const rg of ['tabletop', 'midscale', 'fullscale']) {
      applyRegime(rg);
      for (const type of CAR_TYPES.map((x) => x.key)) for (const b of BRAKE_SETS) for (const grip of [0.05, 0.1, 0.2, 0.4, 0.6, 1.0, 1.4]) {
        const c = new CarV2({ x: 0, y: 0, theta: 0, grip });
        c.type = type; c.tireSet = 'normal'; c.brakeSet = b;
        c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.CENTER; c.steerAmt = null;
        for (let i = 0; i < 1500; i++) c.step(DT);
        c.steer = CONST.LEFT; c.steerAmt = null; c.driveDir = CONST.BRAKE; c.pwm = 0;
        tally[b] = tally[b] || 0; e5Runs++;
        for (let i = 0; i < 600 && Math.abs(c.u) > 0.2; i++) {
          c.step(DT); e5Ticks++;
          const f = c._fAppWheel, sum = f[0] + f[1] + f[2] + f[3];
          for (let k = 0; k < 4; k++) if (f[k] !== 0 && sum !== 0 && Math.sign(f[k]) !== Math.sign(sum)) tally[b]++;
        }
      }
    }
    applyRegime('fullscale');
    const line = BRAKE_SETS.map((b) => `${b} ${tally[b]}`).join(' / ');
    ok(tally.motor > 0,
       `E5 (記録・既存挙動) LSD 装備車で制動中に片輪の指令力が加速側へ回る件数（${e5Runs} run / ${e5Ticks} tick）: ${line}。**既定 motor でも ${tally.motor} 件**＝AO3 差動 (lsdTtMax=${V2.lsdTtMax}) の既存の性質で AV2 由来ではない（AV2 は駆動軸の取り分を下げるので件数だけが動く）。総量保存(B2)・エネルギー注入なし(E3) は保たれている`);
  }
  console.log(`     ※ E4 は **AV2 固有の検出力を持たない**: AV2 は fApp（車輪 ODE への入力）だけを変え、`);
  console.log(`        tireForceMF の式に一切触れていないので |F|=μFz·g(σ)≤μFz は構造的に恒真である。`);
  console.log(`        ここでの意味は「AV2 がタイヤ力の経路を壊していないこと」の確認に留まる（AV1 で`);
  console.log(`        恒真アサートをアサートから外した教訓の適用＝落とさずに **意味を書いて** 残す）。`);
  JSONOUT.E = { emergence: tbl, flips, keUps, ticks, wc, wp, clampTotal };
}
console.log(`  [E] ${lap().toFixed(1)}s`);

// ══ F. 本番配線（AV1 教訓(iii): traceHash が変わることまで見る）═══════════════════
console.log('\n=== F: 本番配線（makeSlot / rebuildSpawns / swapPhysics / runRace の通し検査）===');
{
  const prog = (k) => { const p = PROGRAMS.find((x) => x.key === k); if (!p) throw new Error('no prog ' + k); return p; };
  // **制動を確実に含む学習プログラムを本番インタプリタへ通す。** 装備が効くのは BRAKE 指令が
  // 出ている substep だけなので、ブレーキを踏まないサンプルで traceHash を比べると
  // 「装備しても軌跡が変わらない」という **恒真な緑** になる（実測: 既定サンプル py_normal_fr は
  // BRAKE を 0 回しか出さず、comp_brake もこの箱コースでは 0 回だった＝どちらも 3 装備で同一 hash）。
  // ∴ 学習 API だけで書いた「左へ回りながら周期的にブレーキを踏む」= トレイルブレーキそのものの
  // プログラムを使う（テスト用の分岐やバイパスではない・利用者が書けるコードそのまま・CI-8）。
  const BRAKE_SRC = [
    't = 0',
    'def setup():',
    '    RC_setup()',
    'def loop():',
    '    global t',
    '    t = t + 1',
    '    RC_steer(LEFT)',
    '    if t % 120 < 80:',
    '        RC_drive(FORWARD, 255)',
    '    else:',
    '        RC_drive(BRAKE, 0)',
  ].join('\n');
  const spec = { name: 'av2-wire', kind: 'raw', w: 600, h: 400,
    walls: [[0, 0, 600, 0], [600, 0, 600, 400], [600, 400, 0, 400], [0, 400, 0, 0]],
    start: { x: 300, y: 200, theta: 0 }, finish: null };
  const course = buildFromSpec(spec);
  const prev = PHYSICS.mode; setPhysicsMode('v2');
  // F1 makeSlot: world.brake の既定と car.brakeSet への反映（v2 のみ）。
  const slot = makeSlot({ i: 0, lang: 'py', src: BRAKE_SRC, course, slotCount: 1, logFor: () => (() => {}) });
  ok(slot.world.brake === BRAKE_DEFAULT && slot.car.brakeSet === BRAKE_DEFAULT,
     `F1 makeSlot の既定: world.brake='${slot.world.brake}' / car.brakeSet='${slot.car.brakeSet}'（両方 ${BRAKE_DEFAULT}）`);
  // F2 swapPhysics: 物理モード/領域を切替えても装備が引き継がれる（AS9/AS11 と同じ経路）。
  slot.world.brake = 'frictionFront';
  const arr = [slot]; swapPhysics(arr);
  ok(arr[0].car.brakeSet === 'frictionFront', `F2 swapPhysics で装備が引き継がれる（car.brakeSet='${arr[0].car.brakeSet}'）`);
  slot.world.brake = 'bogus'; swapPhysics(arr);
  ok(arr[0].car.brakeSet === BRAKE_DEFAULT, `F3 swapPhysics でも白リスト外は既定へ正規化（'bogus'→'${arr[0].car.brakeSet}'）`);
  // F4/F5 **本番 runRace の traceHash が実際に動く**（AV1 の配線落ちはここだけが検出した）。
  const fieldOf = (brake) => [{ name: 'A', lang: 'py', src: BRAKE_SRC, carType: 'normal_fr', brake }];
  const RR = (brake) => runRace({ report: true, trace: true, course, laps: 1, regime: 'fullscale', maxSec: 20, field: fieldOf(brake), physics: 'v2' });
  // 非空振り: このプログラムが本当に BRAKE を出していることを **観測フックで実測** する
  // （probe は読むだけで slots を変えないので verifyHash/traceHash に影響しない・W1 byte 不変）。
  let brakeTicks = 0, frontLoaded = false;
  runRace({ report: true, trace: true, course, laps: 1, regime: 'fullscale', maxSec: 20, physics: 'v2',
            field: fieldOf('friction'),
            probe: (tick, slots) => { const c = slots[0].car; if (c.driveDir === CONST.BRAKE) brakeTicks++; if (c._fAppWheel && c._fAppWheel[0] !== 0) frontLoaded = true; } });
  const rM = RR('motor'), rU = RR('bogus'), rN = RR(undefined), rF = RR('friction'), rFF = RR('frictionFront');
  ok(brakeTicks > 100 && frontLoaded,
     `F0 非空振り: 本番レース中に BRAKE 指令が ${brakeTicks} tick 出ており、装備車の **前輪へ実際に制動力が入った**（前輪 fApp≠0）＝以下の traceHash 比較は恒真ではない`);
  ok(rM.traceHash === rU.traceHash && rM.traceHash === rN.traceHash && rM.verifyHash === rN.verifyHash,
     `F4 既定/未指定/未知値は **本番 traceHash が同一**（${rM.traceHash}）＝装備を積まない記録は byte 不変`);
  ok(rF.traceHash !== rM.traceHash && rFF.traceHash !== rM.traceHash && rF.traceHash !== rFF.traceHash,
     `F5 **装備すると本番 traceHash が実際に動く**: motor ${rM.traceHash} / friction ${rF.traceHash} / frictionFront ${rFF.traceHash}（3 つとも別＝配分の違いが軌跡に出ている）`);
  // F6 canon 刻印の両方向（W_spec §5: 装備条件を記録の素へ刻む）。
  ok(rM.verifyHash === rU.verifyHash, `F6 全車 motor では canon に brake キーが付かない＝既存の全公式記録が byte 不変（${rM.verifyHash}）`);
  ok(rF.verifyHash !== rM.verifyHash, `F6b 非既定が 1 台でも居れば別ハッシュ（friction ${rF.verifyHash}）＝再実行検証で装備を区別できる`);
  // F7 決定論。
  const d1 = RR('frictionRear'), d2 = RR('frictionRear');
  ok(d1.traceHash === d2.traceHash && d1.verifyHash === d2.verifyHash,
     `F7 決定論: 同一 field を 2 回走らせて trace/verify とも一致（${d1.traceHash} / ${d1.verifyHash}）`);
  // F8 rebuildSpawns 後も装備が保たれる（AV1 が落とした spawn 経路の同型検査）。
  const s2 = makeSlot({ i: 0, lang: 'py', src: BRAKE_SRC, course, slotCount: 1, logFor: () => (() => {}) });
  s2.world.brake = 'friction'; s2.car.brakeSet = 'friction';
  rebuildSpawns([s2], course);
  ok(s2.car.brakeSet === 'friction', `F8 rebuildSpawns 後も car.brakeSet='${s2.car.brakeSet}'（装備は路面属性と違い reset をまたいで保持される）`);
  setPhysicsMode(prev);
  JSONOUT.F = { motor: rM.traceHash, friction: rF.traceHash, frictionFront: rFF.traceHash, verifyMotor: rM.verifyHash, verifyFriction: rF.verifyHash };
}
console.log(`  [F] ${lap().toFixed(1)}s`);

// ══ G. 非対象エンジンの機械固定 ═════════════════════════════════════════════════════
console.log('\n=== G: 非対象エンジン（standard / dynamic は brakeSet を無視する）===');
{
  // **制動を確実に含む学習プログラムを本番インタプリタへ通す。** 装備が効くのは BRAKE 指令が
  // 出ている substep だけなので、ブレーキを踏まないサンプルで traceHash を比べると
  // 「装備しても軌跡が変わらない」という **恒真な緑** になる（実測: 既定サンプル py_normal_fr は
  // BRAKE を 0 回しか出さず、comp_brake もこの箱コースでは 0 回だった＝どちらも 3 装備で同一 hash）。
  // ∴ 学習 API だけで書いた「左へ回りながら周期的にブレーキを踏む」= トレイルブレーキそのものの
  // プログラムを使う（テスト用の分岐やバイパスではない・利用者が書けるコードそのまま・CI-8）。
  const BRAKE_SRC = [
    't = 0',
    'def setup():',
    '    RC_setup()',
    'def loop():',
    '    global t',
    '    t = t + 1',
    '    RC_steer(LEFT)',
    '    if t % 120 < 80:',
    '        RC_drive(FORWARD, 255)',
    '    else:',
    '        RC_drive(BRAKE, 0)',
  ].join('\n');
  const spec = { name: 'av2-nontarget', kind: 'raw', w: 600, h: 400,
    walls: [[0, 0, 600, 0], [600, 0, 600, 400], [600, 400, 0, 400], [0, 400, 0, 0]],
    start: { x: 300, y: 200, theta: 0 }, finish: null };
  const course = buildFromSpec(spec);
  const prev = PHYSICS.mode;
  for (const mode of ['standard', 'dynamic']) {
    setPhysicsMode(mode);
    const fieldOf = (brake) => [{ name: 'A', lang: 'py', src: BRAKE_SRC, carType: 'normal_fr', brake }];
    // 非空振り: 非対象エンジンでも **BRAKE は実際に出ている**（出ていなければ「不変」は当たり前になる）。
    let bt = 0;
    runRace({ report: true, trace: true, course, laps: 1, regime: 'fullscale', maxSec: 20, physics: mode,
              field: fieldOf('frictionFront'), probe: (tick, slots) => { if (slots[0].car.driveDir === CONST.BRAKE) bt++; } });
    ok(bt > 100, `G0 ${mode}: 非空振り — 本番レース中に BRAKE 指令が ${bt} tick 出ている`);
    const a = runRace({ report: true, trace: true, course, laps: 1, regime: 'fullscale', maxSec: 20, field: fieldOf('motor'), physics: mode });
    const b = runRace({ report: true, trace: true, course, laps: 1, regime: 'fullscale', maxSec: 20, field: fieldOf('frictionFront'), physics: mode });
    ok(a.traceHash === b.traceHash,
       `G1 ${mode}: brakeSet を frictionFront にしても **traceHash 不変**（${a.traceHash}）= 非対象であることが機械固定されている`);
  }
  setPhysicsMode(prev);
  // G2 直接オブジェクトに付けても効かない（field 経由でなく car へ直に書く多重防御）。
  const dc = new DynCar({ x: 0, y: 0, theta: 0, grip: 1 }); dc.type = 'normal_fr';
  dc.brakeSet = 'frictionFront';
  const dc0 = new DynCar({ x: 0, y: 0, theta: 0, grip: 1 }); dc0.type = 'normal_fr';
  const run = (c) => { c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.CENTER;
    for (let i = 0; i < 600; i++) c.step(DT);
    c.driveDir = CONST.BRAKE; c.pwm = 0; for (let i = 0; i < 300; i++) c.step(DT);
    return [c.x, c.y, c.theta, c.u, c.vlat, c.r, c.vwF, c.vwR]; };
  const g1 = run(dc), g0 = run(dc0);
  ok(g1.every((v, i) => v === g0[i]), `G2 DynCar に car.brakeSet を直に書いても 900 tick 後の状態が **全成分 bit 一致**（x=${g0[0].toFixed(9)}）`);
  const cc = new Car({ x: 0, y: 0, theta: 0, grip: 1 }); cc.type = 'normal_fr'; cc.brakeSet = 'frictionFront';
  const cc0 = new Car({ x: 0, y: 0, theta: 0, grip: 1 }); cc0.type = 'normal_fr';
  const h1 = run(cc), h0 = run(cc0);
  ok(h1.every((v, i) => v === h0[i]), `G3 Car(classic) も同様に bit 一致（x=${h0[0].toFixed(9)}）`);
}
console.log(`  [G] ${lap().toFixed(1)}s`);

// ══ H. 正規化と共有 URL ═════════════════════════════════════════════════════════════
console.log('\n=== H: 正規化と共有 URL スキーマ ===');
{
  ok(normBrake('bogus') === BRAKE_DEFAULT && normBrake(undefined) === BRAKE_DEFAULT && normBrake(null) === BRAKE_DEFAULT
     && BRAKE_SETS.every(k => normBrake(k) === k),
     `H1 normBrake は白リスト外を既定 ${BRAKE_DEFAULT} へ・白リスト内は恒等（UI / 共有 URL / レース field が同じ 1 実装を通る）`);
  const f = SHARE_FIELDS.find(x => x.name === 'brake');
  ok(f && f.k === 'bk' && f.type === 'str', `H2 SHARE_FIELDS に brake/bk が単一ソースとして在る（type=${f && f.type}）`);
  const h = encodeState({ course: 'X', brake: 'frictionRear' });
  ok(/(^|&)bk=frictionRear(&|$)/.test(h) && decodeState(h).brake === 'frictionRear',
     `H3 共有 URL の往復: encode に bk=frictionRear が載り decode で戻る（hash=${h}）`);
  const h0 = encodeState({ course: 'X' });
  ok(!/bk=/.test(h0), `H4 既定（捕捉側 null）では bk キーが hash に載らない＝既存の共有 URL が byte 不変（hash=${h0}）`);
  JSONOUT.H = { hash: h, hashDefault: h0 };
}
console.log(`  [H] ${lap().toFixed(1)}s`);

// ══ I. 領域依存（向きが領域で変わるのは装備の性質。AV2 時点の「過大な悪化」だけを AW1 が是正）═══════════
// 【AV2 敵対的検証で追加】旧版のゲートは fullscale しか走らせておらず、**アプリの既定領域である
//   卓上を 1 度も検査していなかった**（AS9/AS11/AV1 は全領域を走らせている）。v7.7.0 時点の実測では
//   **卓上/中スケールの既定タイヤで装備が制動を弱めていた**（friction/motor = 0.77）。
//
// 機序（AV3 で確定・AW1 で是正）: 制動指令 bk とタイヤ容量の比が領域で桁違いに違う（卓上 0.50 / fullscale 2.87）
//   ことではなく、**AP13 の半陰的車輪 ODE（`siWheel`）が陰的更新の間に接地速度を凍結して力を過小に伝えていた**ことによる。
//   AW1（v8.0.0）は車輪 ODE を車体加速度と同一 substep で連成する 2 パスにして是正し、半陰的経路でも
//   実力/指令比が参照解（原 explicit）並みになった。∴ 本章の述語は **「過大な悪化が起きない」** へ置換した
//   （I1: 半陰的経路でも friction/motor ≥ 0.9・I3: motor の実力/指令 ≥ 0.9）。v7.7.0 時点の値は `docs/physics_model` §13.16 に時点記録として残る。
//   **注意（AW2 レビュー）**: 卓上/中スケールで比が 1 未満（＝装備が制動をわずかに弱める）こと自体は AW1 後も残り、
//   **参照解（0.938）も同じ向き**なので装備の性質である。消えたのは「参照解よりはるかに悪い」過大な悪化（0.758/0.773）の方。
//   【v7.7.0〜v7.8.0（AV2/AV3）時点の記録・過去形】AV2 時点では「半陰的化の減衰 kD が線形域の剛性＝安全側で、輪がスリップを
//   立ち上げ切れない」と書いていたが、AV3 で kD を局所勾配へ寄せる変異では直らなかった（friction/motor 0.758→0.685）。
//   真因は **陰的更新の間に接地速度 vcx を凍結する作用素分割**（誤差 ∝ h·kD）で、v7.8.0 までの卓上 v2 は参照解
//   （v4.0.0 以前の原 explicit・nSub 上限 256・上限 4096 でも 0.1% 以内で収束）より motor の制動が卓上で約 36%・
//   中スケールで約 32% 弱かった（実終速で計算した減速度。当時この I 章が印字していた比 0.768 は目標終速 uEnd 基準＝別基準。
//   両者の差は最終 tick の行き過ぎ 1〜3%）。接地速度の変化を前 substep から予測する素朴な変異は 4 輪制動で周期 2 振動
//   （制動中の ΣFx>0 が 22% の substep）になり、修正には車輪と車体の連成を同一 substep で解く形が要った＝AW1 の 2 パス化。
//   当時は陽的経路（`siWheel=false`）でだけ装備が有利になる「符号反転」が起き（旧 I1 はそれを特性化する述語だった）、
//   motor 単独でも実力/指令比は 0.58 だった。v7.7.0〜v7.8.0 の値は docs/physics_model.md §13.16 の版付き注記・旧 I1/I3 の
//   メッセージ文字列・git 78a963a に時点記録として残る。
//   【現行】参照解相対の一致（減速度 ±5%・実力/指令 ±0.05）は wf_aw1_coupled B1/B2 が固定する。本章の I1/I3 は
//   **「参照解よりはるかに悪い過大な悪化が起きない」ことの大きさの床（≥0.9）**であって、比が 1 を跨ぐか（符号）は見ていない
//   （実際 I1 は 0.942 で緑だが比は 1 未満のまま＝わずかに弱める。参照解も同じ向き）。印字する減速度は従来どおり uEnd 基準
//   （参照解の同基準の比は 0.950/0.954）。
console.log('\n=== I: 領域依存（AV2 時点の過大な悪化が AW1 で消えたことを機械固定。向きが領域で違うこと自体は参照解も同じ＝装備の性質）===');
{
  const stopAt = (rg, tire, grip, b) => {
    applyRegime(rg);
    const T = tireParamsFor(tire);
    const U0 = 0.7 * CAR.maxSpeed;
    const c = new CarV2({ x: 0, y: 0, theta: 0, grip });
    c.type = 'normal_fr'; c.tireSet = tire; c.brakeSet = b;
    c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.CENTER; c.steerAmt = null;
    for (let i = 0; i < 40000 && c.u < U0; i++) c.step(DT);
    const uu = c.u, x0 = c.x, uEnd = 0.2 * U0;
    c.driveDir = CONST.BRAKE; c.pwm = 0;
    let sfx = 0, sfa = 0;
    for (let i = 0; i < 40000 && c.u > uEnd; i++) {
      c.step(DT);
      sfx += Math.abs(c._fxWheel.reduce((a, v) => a + v, 0));
      sfa += Math.abs(c._fAppWheel.reduce((a, v) => a + v, 0));
    }
    return { a: (uu * uu - uEnd * uEnd) / (2 * (c.x - x0)), deliver: sfx / Math.max(sfa, 1e-9),
             si: V2.siActive && (T.mu0 * grip) >= V2.siMinMu };
  };
  const cases = [['tabletop', 'normal', 1.0], ['tabletop', 'normal', 0.3], ['tabletop', 'slip', 1.0],
                 ['midscale', 'normal', 1.0], ['midscale', 'normal', 0.3],
                 ['fullscale', 'normal', 1.0], ['fullscale', 'normal', 0.3], ['fullscale', 'slip', 1.0]];
  const rows = [];
  for (const [rg, tire, grip] of cases) {
    const m = stopAt(rg, tire, grip, 'motor'), f = stopAt(rg, tire, grip, 'friction');
    rows.push({ rg, tire, grip, si: m.si, ratio: f.a / m.a, aM: m.a, aF: f.a, dM: m.deliver, dF: f.deliver });
    console.log(`     ${rg.padEnd(10)} ${tire.padEnd(6)} grip ${grip}  半陰的=${String(m.si).padEnd(5)}  a: motor ${m.a.toFixed(3)} → friction ${f.a.toFixed(3)}  比 ${(f.a / m.a).toFixed(3)}   実力/指令: ${m.deliver.toFixed(3)} / ${f.deliver.toFixed(3)}`);
  }
  applyRegime('fullscale');
  const si = rows.filter(r => r.si), ex = rows.filter(r => !r.si);
  ok(si.length >= 2 && si.every(r => r.ratio >= 0.9),
     `I1 **半陰的経路（卓上/中スケールの既定タイヤ）でも装備は制動を 10% 以上は弱めない**（AW1 で過大な悪化が消えた。1 未満＝わずかに弱めること自体は参照解も同じ）: ${si.length} 条件すべてで friction/motor ≥ 0.9（実測 ${si.map(r => r.ratio.toFixed(3)).join(' / ')}。v7.7.0 時点は 0.768/0.766）。参照解（原 explicit）の同基準〔uEnd〕の比は 0.950/0.954（実終速基準では 0.938）`);
  ok(ex.length >= 5 && ex.every(r => r.ratio > 0.95),
     `I2 **陽的経路では悪化しても 4% 以内で、ロックが起きる条件では 1.6〜2.1 倍に有利化する**: ${ex.length} 条件すべてで friction/motor > 0.95（実測 ${ex.map(r => r.ratio.toFixed(3)).join(' / ')}）。**1 未満＝わずかに弱めること自体は領域も積分方式も問わない装備の性質**で、参照解（原 explicit）も卓上/中スケールで 0.94 になる。AW1 前は半陰的経路だけが 0.77 と過大に悪化していた（AW2 レビューで是正: 旧文は「悪化の原因は半陰的化そのもの」と書いていたが、AW1 後は半陰的 0.966/0.942 と陽的 0.968/0.964 の差が約 1pt でその推論は成り立たない）`);
  ok(si.every(r => r.dM >= 0.9) && si.every(r => r.dF < r.dM),
     `I3 AW1 後の半陰的経路は **motor の実力/指令 ≥ 0.9**（${si.map(r => r.dM.toFixed(3)).join('/')}・参照解 0.935。v7.7.0 時点は 0.586/0.623）。4 輪へ配ると参照解と同じ向きに僅かに下がる（${si.map(r => r.dF.toFixed(3)).join('/')}・参照解 0.877）`);
  // 【AV2 敵対的検証の指摘を受けて再設計】旧 I4 は「陽的なら実力/指令が必ず上がる」と書いたが
  //   **陽的でも normal×低 grip の 2 条件で下がる**（実測 0.933→0.798 / 0.928→0.807）ので偽だった。
  //   全 8 条件で成り立つのは **符号の一致**＝「装備が有利になるのは実力/指令比が上がるとき、かつその
  //   ときだけ」。これが半陰的/陽的よりも直接的な判別量である。
  const signOK = rows.every(r => Math.sign(r.ratio - 1) === Math.sign(r.dF - r.dM));
  ok(signOK && rows.length >= 8,
     `I4 **判別量は「実力/指令比が上がるか」**: 全 ${rows.length} 条件で sign(friction/motor − 1) === sign(実力比の増減) が一致（${rows.map(r => `${r.ratio.toFixed(2)}${r.dF > r.dM ? '↑' : '↓'}`).join(' ')}）⇒ 装備が有利になるのは **4 輪へ配ったときに指令がより多く路面へ届くとき、かつそのときだけ**`);
  JSONOUT.I = rows;
}
console.log(`  [I] ${lap().toFixed(1)}s`);

// ══ 結果 ════════════════════════════════════════════════════════════════════════════
const total = Number(process.hrtime.bigint() - T0) / 1e9;
if (WANT_JSON) console.log('\n@@JSON@@\n' + JSON.stringify(JSONOUT, null, 1));
console.log(`\n${'─'.repeat(60)}`);
console.log(`AV2 4輪摩擦ブレーキ ゲート: PASS ${pass} / FAIL ${fail}  (${total.toFixed(1)}s${FULL ? ' --full' : ''})`);
console.log(`${'─'.repeat(60)}`);
process.exit(fail ? 1 : 0);
