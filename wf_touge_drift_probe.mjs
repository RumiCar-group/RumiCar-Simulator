// wf_touge_drift_probe.mjs — 将来の「峠ドリフト」Stage 用に保存する実測プローブ (2026-07-05 利用者指示「ペンディング・将来用に保存」・PROGRESS AO-17/AO-18)。
// 発端=利用者質問「タイト連続・180°ヘアピン・オーバースピード進入でドリフト優位は出ないか」の実測プローブ。
// wf_ao8_gonogo.mjs (常設ゲート・無改変) のドライバを複製し 3 点を拡張:
//   ① 回頭角 90° → {90°, 180°} (ヘアピン折返し=回頭需要2倍でドリフトの「素早い回頭」が償却されるか)
//   ② drift 進入倍率 {1.15, 1.4}×v_grip (「限界以上で侵入」の度合いを掃引)
//   ③ 総合時間 = セクター通過 + 出口直線 20m 走破 (出口速度の価値を機械的に算入=「総合的に高速で抜ける」)
// 判定・車・路面・タイヤ・積分は AO8 と同一 (実 buildFromSpec / CarV2.step)。
//
// 【AU1 是正 2026-09-05・物理無改変】ドリフトドライバの **逆ハンが一度も発火していなかった** のを直した。
//   左旋回のドリフトでは β=atan2(vlat,|u|) が **負** へ振れる (AS12 D3 の実測 −77°) のに、判定は
//   `b > +DRIFT_BETA` と **正側** を見ていたため、カウンター分岐にも catch 分岐の減舵側にも一度も入らず、
//   実質「常にフル LEFT・全開」のドライバだった (出口安定化 `be < -15 → LEFT` も向きが逆)。
//   是正は AS12 arm B と同型 = 滑り量 sl=−β を基準にした比例則 + 3値への理想デューティ量子化。
//   旧ドライバで採った表は `docs/stage_ao/drift_gonogo.md`/`docs/stage_ap/*` に **時点記録として保持**する (AP-0)。
//   本ファイルは AU1 で probe (アサート無し) から **常設ゲート** へ昇格した (wf_run_all の GATES 収載)。
import { buildFromSpec } from './public/js/course.js';
import { CarV2, tireParamsFor } from './public/js/physics_v2.js';
import { CAR, CONST, setPhysicsMode, APP_VERSION } from './public/js/config.js';
import { applyRegime, DYN } from './public/js/physics_dyn.js';
import { readFileSync } from 'fs';

const DT = 1 / 60, deg = 180 / Math.PI;
const beta = (c) => Math.atan2(c.vlat, Math.max(Math.abs(c.u), 1e-6)) * deg;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

setPhysicsMode('v2');
applyRegime('fullscale');
const Tn = tireParamsFor('normal');
const Rmin = CAR.wheelBase / Math.tan(CAR.maxSteer);
const benches = JSON.parse(readFileSync('./docs/stage_ao/bench_courses.json', 'utf8'));

const SPIN_LIM = 115, REGRIP_BETA = 35, TIMEOUT = 1800, DRIFT_BETA = 35, EXIT_RUN_M = 20;
const GAINS = { kp: 0.05, kd: 0.002 };          // AS12 arm B/C と同一 (kpD/kdD)
const MX = CAR.maxSteer;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  \u2713 ' + m); } else { fail++; console.log('  \u2717 ' + m); } };
// 逆ハン(目標舵角が旋回と逆符号)の発火計測 — AS12 D2 『一度も発火しない』の **逆述語**。
let counterFire = 0, counterTick = 0, wantMin = 0, steerMinReached = 0;   // wantMin=**指令**目標の最小 / steerMinReached=**到達**舵角の最小
// **検出力のある逆ハン述語**: 「実測の滑りが *そのtickの目標* を超えているとき、逆ハンを当てているか」。
//   滑りの真値は beta(car) から取る(ドライバ内部の符号変数を使わない)ので、符号を取り違えた実装では
//   比例則が滑りを *増やす* 向きに舵を出し、この比率が 0 付近へ落ちる = 変異注入で赤くなる。
//   (単なる `counterFire > 0` は一時的な正βで簡単に満たされ検出力が無い — 実測で確認済)
let deepTick = 0, deepCounter = 0;
function noteCounter(car, tgt, applied) {
  const trueSlip = -beta(car);              // 左旋回ドリフトで正になる滑り量(真値)
  if (trueSlip > tgt + 4) { deepTick++; if (applied < 0) deepCounter++; }
}
// 3値(tri)への理想デューティ量子化。norm は [-1,1] (正=LEFT)。AS12 arm B と同一。
function applySteer(car, norm) {
  const n = Math.max(-1, Math.min(1, norm));            // 印加値 (クランプ後) — 記録もこの値で行う
  car.steer = (car.steerAngle < n * MX) ? CONST.LEFT : CONST.RIGHT; car.steerAmt = null;
  return n;
}

function toSpeed(car, U) {
  car.steer = CONST.CENTER; car.driveDir = CONST.FORWARD; car.pwm = 255;
  for (let i = 0; i < 8000 && car.u < U; i++) car.step(DT);
}
function holdSpeed(car, U) {
  const e = U - car.u;
  if (e > 0.15) { car.driveDir = CONST.FORWARD; car.pwm = Math.min(255, 30 + e * 25); }
  else if (e < -0.4) { car.driveDir = CONST.BRAKE; car.pwm = 0; }
  else { car.driveDir = CONST.FORWARD; car.pwm = 22; }
}

// AO8 runCorner + ①角度パラメータ化 ②進入基底パラメータ化 ③出口 20m 直線走破の総合時間。
function runCorner(course, R, drive, strat, entryMul, headGate, driftEntryBase) {
  const car = new CarV2({ ...course.start, x: 0, y: 0, theta: 0 });
  car.type = (drive === 'fr') ? 'normal_fr' : 'normal_awd';
  car.tireSet = 'normal';
  const muEff = Tn.mu0 * (car.grip || 1);
  const vgrip = Math.sqrt(muEff * DYN.g * R);
  const vEntry = (strat === 'grip' ? 0.9 : driftEntryBase) * vgrip * entryMul;
  toSpeed(car, vEntry);

  let head = 0, prevTheta = car.theta, betaPk = 0, spun = false, done = false, steps = 0;
  let brakePulse = (strat === 'drift' && drive === 'fr') ? 9 : 0;
  let gSteer = CONST.CENTER, prevSl = -beta(car);
  for (let i = 0; i < TIMEOUT; i++) {
    if (strat === 'grip') {
      const rStar = car.u / R;
      if (car.r < rStar * 0.98) gSteer = CONST.LEFT;
      else if (car.r > rStar * 1.02) gSteer = CONST.CENTER;
      car.steer = gSteer;
      holdSpeed(car, vEntry);
    } else {
      // drift = 回転フェーズ (滑り 35°保持) → 回収フェーズ (catch): 残り回頭に比例して滑り目標を 35→0 へ
      // 絞り、カウンター(逆ハン)＋スロットル調整で後輪の摩擦円を横グリップへ返す。
      // 【AU1 是正】滑り量 sl = −β。左旋回ドリフトで β は負ゆえ sl が正の「滑り量」になる (AS12 D3)。
      //   旧実装は signed β を正側の閾値と比べていたため逆ハン分岐に一度も入らなかった。
      const sl = -beta(car), sld = (sl - prevSl) / DT;
      const remaining = headGate - head;
      // 予見的回収: 実ドライバー同様「ヨーレート×先行時間」で catch 開始を決める (角度残でなく
      // ヨー角運動量基準)。現ヨーレートのまま先行時間 T_LEAD 走ると目標を超える、が合図。
      const T_LEAD = 0.9;                            // カウンターが効き始めるまでの先行時間 (s)
      const catchNow = remaining < Math.max(Math.abs(car.r), 0.5) * T_LEAD;
      let want, slTgtNow = DRIFT_BETA;
      const braking = brakePulse > 0;      // 分岐前に確定（brakePulse-- が同じ tick で 1→0 になるため）
      if (brakePulse > 0) { want = MX; car.driveDir = CONST.BRAKE; car.pwm = 0; brakePulse--; }
      else if (catchNow) {
        const slTgt = Math.max(0, Math.min(DRIFT_BETA, 60 * remaining));  // 残回頭に応じ滑り目標を絞る
        slTgtNow = slTgt;
        want = (GAINS.kp * (slTgt - sl) - GAINS.kd * sld) * MX;
        car.driveDir = CONST.FORWARD;
        car.pwm = (sl > slTgt + 4) ? 30 : (sl < slTgt - 4 ? 200 : 140);   // 旧実装と同じスロットル水準
      } else {
        want = (GAINS.kp * (DRIFT_BETA - sl) - GAINS.kd * sld) * MX;
        car.driveDir = CONST.FORWARD; car.pwm = 255;                      // counter中も全開=uを補給
      }
      const applied = applySteer(car, want / MX);     // クランプ後の実印加 (norm)
      counterTick++; if (applied < 0) counterFire++;  // 逆ハン = 印加目標舵角が旋回(LEFT)と逆符号
      if (applied < wantMin) wantMin = applied;
      if (!braking) noteCounter(car, slTgtNow, applied);   // ブレーキ相(全開LEFT が正しい)は除外
      prevSl = sl;
    }
    car.step(DT); steps++;
    if (strat === 'drift' && car.steerAngle / MX < steerMinReached) steerMinReached = car.steerAngle / MX;
    head += wrap(car.theta - prevTheta); prevTheta = car.theta;
    const b = Math.abs(beta(car)); if (b > betaPk) betaPk = b;
    if (b > SPIN_LIM) { spun = true; break; }
    if (head >= headGate) { done = true; break; }
  }
  const tGate = steps * DT, exitU = car.u;

  // ③ 出口: そのまま新ヘディング方向へ全開直線 20m。ドリフト車は再グリップ回復も物理任せ
  //   (滑っている間は加速が乗らない=出口速度の価値/回復コストが総合時間に自動算入)。
  let tTotal = null, exitSpun = false;
  if (done && !spun) {
    const x0 = car.x, y0 = car.y, hx = Math.cos(car.theta), hy = Math.sin(car.theta);
    let k = 0, prevSlExit = -beta(car);
    for (; k < TIMEOUT; k++) {
      // 出口も棒立ちの全開でなく安定化制御 (残滑りがあれば逆ハン+スロットル調整で収束させてから全開)。
      // 【AU1 是正】旧実装は be<-15 (=左旋回ドリフトの残滑り) で LEFT を当てており **向きが逆**だった。
      const sl = -beta(car), sld = (sl - prevSlExit) / DT; prevSlExit = sl;
      if (Math.abs(sl) > 15) {
        const want = (GAINS.kp * (0 - sl) - GAINS.kd * sld) * MX;   // 滑り 0 へ能動回収
        applySteer(car, want / MX); car.driveDir = CONST.FORWARD; car.pwm = 80;
      } else { car.steer = CONST.CENTER; car.steerAmt = null; car.driveDir = CONST.FORWARD; car.pwm = 255; }
      car.step(DT);
      if (Math.abs(beta(car)) > SPIN_LIM) { exitSpun = true; break; }
      const s = (car.x - x0) * hx + (car.y - y0) * hy;
      if (s >= EXIT_RUN_M) break;
    }
    if (!exitSpun && k < TIMEOUT) tTotal = tGate + (k + 1) * DT;
  }
  const clean = done && !spun && !exitSpun && tTotal != null;
  return { tGate, tTotal, exitU, betaPk, spun: spun || exitSpun, clean, vgrip, vEntry };
}

function evalStrat(course, R, drive, strat, headGate, driftEntryBase) {
  const runs = [0.9, 1.0, 1.1].map(m => runCorner(course, R, drive, strat, m, headGate, driftEntryBase));
  const cleanRuns = runs.filter(r => r.clean);
  return {
    tBest: cleanRuns.length ? Math.min(...cleanRuns.map(r => r.tTotal)) : null,
    tGateBest: cleanRuns.length ? Math.min(...cleanRuns.map(r => r.tGate)) : null,
    cleanN: cleanRuns.length,
    betaPk: Math.max(...runs.map(r => r.betaPk)),
    exitU: runs[1].exitU, vgrip: runs[1].vgrip,
  };
}

console.log(`\n[touge] 峠ドリフトプローブ  APP=${APP_VERSION}  R_min=${Rmin.toFixed(3)}m  総合時間=セクター+出口直線${EXIT_RUN_M}m  (drift は進入基底 1.15/1.40 の良い方)`);
console.log(`  ドライバ=AU1 符号是正版 (滑り量 sl=−β の比例逆ハン・3値理想デューティ量子化)。旧「逆ハン不発」版の表は docs 側に時点記録として保持。`);
console.log(`corner        surf drive ang | grip: tGate tTot exitU cln | drift: tGate tTot exitU bpk base cln | ratio(tot) 判定`);
const table = [];
for (const cn of [{ key: 'hairpin-R5', R: 5 }, { key: 'hairpin-R6.5', R: 6.5 }, { key: 'hairpin-R8', R: 8 }]) {
  for (const sf of [{ key: 'dry', suffix: '-dry' }, { key: 'low', suffix: '-low' }]) {
    const spec = benches.find(b => b.name === `bench-${cn.key}${sf.suffix}`);
    const course = buildFromSpec(spec);
    for (const drive of ['fr', 'awd']) {
      for (const ang of [90, 180]) {
        const hg = ang * Math.PI / 180;
        const g = evalStrat(course, cn.R, drive, 'grip', hg, null);
        // drift: 進入基底 1.15 と 1.40 を両方試し、clean 最良を採る (「限界以上で侵入」掃引)
        const d115 = evalStrat(course, cn.R, drive, 'drift', hg, 1.15);
        const d140 = evalStrat(course, cn.R, drive, 'drift', hg, 1.40);
        const d = (d140.tBest != null && (d115.tBest == null || d140.tBest < d115.tBest)) ? { ...d140, base: '1.40' } : { ...d115, base: '1.15' };
        const ratio = (d.tBest != null && g.tBest != null) ? d.tBest / g.tBest : null;
        const verdict = (ratio != null && ratio <= 0.98 && d.cleanN === 3) ? 'GO' : 'NO-GO';
        const f = (v, w = 5) => v != null ? v.toFixed(2).padStart(w) : ' DNF '.padStart(w);
        console.log(`${cn.key.padEnd(13)} ${sf.key}  ${drive.padEnd(3)} ${String(ang).padStart(3)} | ${f(g.tGateBest)} ${f(g.tBest)} ${g.exitU.toFixed(1).padStart(5)} ${g.cleanN}/3 | ${f(d.tGateBest)} ${f(d.tBest)} ${d.exitU.toFixed(1).padStart(5)} ${String(Math.round(d.betaPk)).padStart(3)} ${d.base} ${d.cleanN}/3 | ${ratio != null ? ratio.toFixed(2).padStart(6) : '   -- '} ${verdict}`);
        table.push({ corner: cn.key, surf: sf.key, drive, ang,
          grip_tGate: g.tGateBest != null ? +g.tGateBest.toFixed(4) : null, grip_tTot: g.tBest != null ? +g.tBest.toFixed(4) : null, grip_cleanN: g.cleanN,
          drift_tGate: d.tGateBest != null ? +d.tGateBest.toFixed(4) : null, drift_tTot: d.tBest != null ? +d.tBest.toFixed(4) : null,
          drift_bpk: +d.betaPk.toFixed(4), drift_base: d.base, drift_cleanN: d.cleanN,
          ratio: ratio != null ? +ratio.toFixed(4) : null, verdict });
      }
    }
  }
}
const goN = table.filter(r => r.verdict === 'GO').length;
console.log(`\n  GO=${goN} / ${table.length} セル (ヘアピン3×路面2×駆動2×回頭2)`);

// ── 機械アサート (AU1 で probe → 常設ゲート化) ────────────────────────────────────────
console.log(`\n[アサート]`);
// T1: 逆ハン(目標舵角が旋回と逆符号)が **実際に発火する** — AS12 D2「一度も発火しない」の逆述語。
ok(counterFire > 0 && counterTick > 3000,
   `T1 逆ハン発火: ${counterFire}/${counterTick} tick で目標舵角が旋回と逆符号 (指令目標舵角の最大逆舵 ${(wantMin * 100).toFixed(0)}% of 全舵) ⇒ 符号是正が効いている`);
// T1b: 単なる量子化ディザではなく **有意な逆ハン** が出ている (全舵の半分以上の逆舵に到達)。
// ⚠ T1/T1b は **符号バグに対する検出力が弱い**（AP14 では変異体でも緑になった実績）。符号の是正を守るのは T1c。
ok(wantMin <= -0.5, `T1b 逆ハンの深さ: **指令**目標舵角の最大逆舵 ${(wantMin * 100).toFixed(0)}% / **到達**舵角の最小 ${(steerMinReached * 100).toFixed(0)}% of 全舵`);
{
  const deepRatio = deepTick ? deepCounter / deepTick : 0;
  ok(deepTick >= 200 && deepRatio >= 0.8,
     `T1c **検出力のある逆ハン述語**: 滑りが目標超過の ${deepTick} tick 中 ${deepCounter} (${(deepRatio * 100).toFixed(1)}%) で逆ハン ⇒ 比例則が滑りを減らす向きに効いている`);
}
// T2: β の符号 — 通常の左旋回は正・ドリフトは負 (AS12 D3 と同じ機序をこのゲートでも実測固定)。
{
  const c = buildFromSpec(benches.find(b => b.name === 'bench-hairpin-R8-dry'));
  const car = new CarV2({ ...c.start, x: 0, y: 0, theta: 0 }); car.type = 'normal_fr'; car.tireSet = 'normal';
  toSpeed(car, 8);
  for (let i = 0; i < 120; i++) { car.steer = CONST.LEFT; car.steerAmt = null; holdSpeed(car, 8); car.step(DT); }
  const bTurn = beta(car);
  const c2 = buildFromSpec(benches.find(b => b.name === 'bench-hairpin-R8-low'));
  const car2 = new CarV2({ ...c2.start, x: 0, y: 0, theta: 0 }); car2.type = 'normal_fr'; car2.tireSet = 'normal';
  toSpeed(car2, 1.15 * Math.sqrt(Tn.mu0 * (car2.grip || 1) * DYN.g * 8));
  let bMin = 0;
  for (let i = 0; i < 120; i++) {
    if (i < 9) { car2.steer = CONST.LEFT; car2.driveDir = CONST.BRAKE; car2.pwm = 0; }
    else { car2.steer = CONST.LEFT; car2.driveDir = CONST.FORWARD; car2.pwm = 255; }
    car2.steerAmt = null; car2.step(DT); if (beta(car2) < bMin) bMin = beta(car2);
  }
  // ⚠ 定常旋回の β の符号は **速度依存**(tangent speed 前後で反転・R8-dry で約 12 m/s)。結論を支えるのは
  //   第2連言 bMin<-30 のほう。第1連言は「低速(U=8 m/s)では正」という限定つきの記述として残す。
  ok(bTurn > 0 && bMin < -30, `T2 β の符号: 低速(U=8)の定常左旋回は正 (+${bTurn.toFixed(2)}°) / ドリフトは負 (${bMin.toFixed(1)}°) ⇒ 正側閾値 \`β>+35\` は発火しない`);
}
// T3: 決定論 — 同一セルを2回走らせて bit 一致 (表全体の md5 一致は外部で 2 回実行して照合する)。
{
  const c = buildFromSpec(benches.find(b => b.name === 'bench-hairpin-R5-low'));
  const a = runCorner(c, 5, 'fr', 'drift', 1.0, Math.PI, 1.15);
  const b = runCorner(c, 5, 'fr', 'drift', 1.0, Math.PI, 1.15);
  ok(a.tGate === b.tGate && a.betaPk === b.betaPk && a.exitU === b.exitU && a.clean === b.clean,
     `T3 決定論: 同一セル2回 bit 一致 (tGate=${a.tGate}/${b.tGate} betaPk=${a.betaPk.toFixed(6)}/${b.betaPk.toFixed(6)})`);
}

if (process.argv.includes('--json')) {
  console.log('===JSON===');
  console.log(JSON.stringify({ appVersion: APP_VERSION, driver: 'AU1-sign-corrected', R_min: +Rmin.toFixed(4),
    counterFire, counterTick, wantMin: +wantMin.toFixed(4), steerMinReached: +steerMinReached.toFixed(4),
    deepTick, deepCounter, deepRatio: deepTick ? +(deepCounter / deepTick).toFixed(4) : 0,
    table, goN, total: table.length }, null, 0));
}

console.log(`\n[結果] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
