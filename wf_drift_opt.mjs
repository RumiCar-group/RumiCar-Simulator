// wf_drift_opt.mjs — 「自由空間＋廊下プロキシ」のコーナー実験室（**library・単体実行しない**）。
// ══════════════════════════════════════════════════════════════════════════════════════
// **これは新しいロジックではない。** `wf_drift_reexam.mjs`（Stage AU3・2026-09-05）の Part 1/Part 2 が
// 持っていた共通ドライバ部品と、Part 2 の「切替(トレイルブレーキ型)ドライバ＋乱択+局所改良の最適化器」を
// **そのまま純粋抽出**したものである（式も評価順も変えていない）。抽出の狙いは Stage AY1 が
// 「最適化器を再利用し、再実装しない」（PLAN AY1 受け入れ基準）を満たすこと。
// **抽出の前後で `wf_drift_reexam.mjs` の出力が byte 一致することを機械確認してから採用した**
// （AX1→AX2 の `driveTick`/`pursueLine` 抽出と同じ作法）。
//
// ── なぜ「設定可能」にしたのか（スケール依存の定数だけを外へ出した）─────────────────────
// 元の実装は **fullscale 専用**で、次の値が m/s・m の literal として本文に埋まっていた:
//   出口面までの距離 20m ／ 速度保持のデッドバンド 0.6 m/s ／ 指令バイアス 0.3 m/s ／
//   スロットル則の下限速度 1 m/s とバイアス 0.2 m/s ／ 後退ガード −0.5 m/s ／ 廊下逸脱の罰の重み 5。
// 卓上（長さが 1/20・最高速 0.7 m/s）でそのまま使うと、たとえばデッドバンド 0.6 m/s は
// **最高速そのものより大きい**＝ブレーキが一度も入らない、という別物のドライバになる。
// ∴ **スケールで意味が変わる値だけ**を `makeCornerLab(cfg)` の設定にし、**既定値は元の literal と同一**に
// してある（＝ `wf_drift_reexam.mjs` は設定を渡さないので 1 バイトも変わらない）。
// 無次元の値（β 目標 deg・出口姿勢の許容 10°・spin 上限 115°・進入比 entry・各ゲイン）は設定にしていない。
//
// ── 変更した点は 1 つだけ: 参照速度 vRef ────────────────────────────────────────────────
// 元は `vgrip = sqrt(μ·g·R)`（摩擦限界速度）を進入速度の基準にしていた。これは
// **摩擦限界に届く世界でしか意味を持たない**。卓上は `v* = 1.51 m/s` に対し車種最高速が 0.68 m/s で、
// 摩擦は最後まで拘束しない（＝舵角律速。AX1 の「摩擦使用率 18%」と同じ事実）。基準が届かない速度だと
// 進入比 entry が全域で飽和し、比較が成立しない。∴ **vRef = min(vgrip, 車種最高速)** とした。
// **fullscale では恒等**である。実測（2026-09-08・製品から値を取って確認。**数字を書き写して 3 か所とも
// 間違えたので実測し直した**＝層 4 レビュー指摘）: `vRefOf` を通るのは `runCornerSwitch`（Part 2/3）だけで、
// そこで使う半径は **R5 と R6.5 のみ**（Part 1 の `runCornerFree` は `wf_drift_reexam.mjs` 側に残り旧式のまま）。
// fullscale の `tireParamsFor('normal').mu0` は **1.4**（卓上は 0.8）なので v_grip は
// R5 dry 8.2867 / R5 low 6.4189 / R6.5 dry 9.4483 / R6.5 low 7.3186 m/s。
// 車種 `normal_fr` の最高速は 110 × **1.02** = **112.2 m/s**（0.97 は `normal` プロファイルの値で別物）。
// ∴ 常に v_grip < 最高速 ⇒ min は v_grip を返す。ゆえにこの変更も `wf_drift_reexam.mjs` の出力を
// 変えない（byte 一致で機械確認済）。
//
// **走行物理は 1 バイトも触らない**。再実装せず 実 buildFromSpec / CarV2.step を呼ぶ（CI-14）。
// ══════════════════════════════════════════════════════════════════════════════════════
import { CarV2, tireParamsFor } from './public/js/physics_v2.js';
import { CAR, CONST } from './public/js/config.js';
import { DYN } from './public/js/physics_dyn.js';

export const DT = 1 / 60, deg = 180 / Math.PI, rad = Math.PI / 180;
export const beta = (c) => Math.atan2(c.vlat, Math.max(Math.abs(c.u), 1e-6)) * deg;
export const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// 既定値 = `wf_drift_reexam.mjs`（AU3）の literal そのもの。**変更するとその領域での測定が変わる**ので、
// 値を渡すときは「なぜその値か」を呼び出し側に書くこと。
export const LAB_DEFAULTS = {
  exitM: 20,          // 出口面までの距離 [m]（clean の判定面）
  tmo: 1800,          // 1 run の tick 上限（30s @60Hz）
  runupTicks: 8000,   // 助走 toSpeed の tick 上限
  spinLim: 115,       // |β| がこれを超えたら制御喪失 [deg]（無次元・領域非依存）
  brakeBand: 0.6,     // 速度保持: 超過がこれを超えたら BRAKE [m/s]
  speedBias: 0.3,     // 速度保持: 目標速度比 pwm に足す上乗せ [m/s]
  throttleFloorU: 1,  // スロットル則(throttleSlip)の速度下限 [m/s]
  throttleBias: 0.2,  // スロットル則の上乗せ [m/s]
  tcFloorU: 1,        // 簡易 TC のスリップ率分母の下限 [m/s]
  revU: -0.5,         // 後退ガード: u がこれを下回ったら打ち切り [m/s]
  arFloorU: 0.5,      // 後軸スリップ角の分母の下限 [m/s]
  violW: 5,           // score の廊下逸脱の罰の重み [1/m]（逸脱量 [m] に掛ける）
  brakeSet: null,     // AV2 の任意装備。null なら car.brakeSet を一切書かない（既定装備）
};

// コーナー実験室を作る。**呼ぶ前に setPhysicsMode/applyRegime を済ませておくこと**
// （Tn と車幅を生成時にスナップショットする＝元実装が module 先頭で捉えていたのと同じ時点）。
export function makeCornerLab(cfg = {}) {
  const C = { ...LAB_DEFAULTS, ...cfg };
  const Tn = tireParamsFor('normal');
  const HALF_W_CAR = CAR.width / 2;
  // 廊下プロキシの許容ずれ。**runCornerSwitch が実際に使う関数そのもの**を外へ出す。
  // 呼び出し側（AY1 の A-3）が式を書き写して照合すると、ここを変異させても検査が緑のままになる
  // （層 4 レビュー指摘）。同じ関数を呼ばせることで変異に反応させる。
  const limOf = (W) => W / 2 - HALF_W_CAR;

  // ── 共通ドライバ部品(AP14/AP15/touge と同型) ────────────────────────────────────────
  // v2 の pwm は「目標速度 = pwm/255·maxV」(physics_v2.js)。低 pwm でも全トルク指令になりうるので、
  // 速度指令は必ず目標速度比で出す(memory `rumicar-v2-pwm-is-target-speed`)。
  const maxVOf = (car) => CAR.maxSpeed * car.profile().maxSpeed;
  const pwmFor = (car, U) => Math.max(0, Math.min(255, Math.round(U / maxVOf(car) * 255)));
  function holdSpeed(car, U) {
    const e = U - car.u;
    if (e < -C.brakeBand) { car.driveDir = CONST.BRAKE; car.pwm = 0; }
    else { car.driveDir = CONST.FORWARD; car.pwm = pwmFor(car, U + C.speedBias); }
  }
  // 簡易トラクション制御(車輪エンコーダ vwR のみ使用)。駆動軸スリップ率が maxSlip を超えたら絞る。
  function tcPwm(car, full, maxSlip) {
    const s = (car.vwR - Math.abs(car.u)) / Math.max(Math.abs(car.u), C.tcFloorU);
    return s > maxSlip ? pwmFor(car, Math.abs(car.u)) : full;
  }
  // 舵。norm∈[-1,1](正=LEFT)。prop=連続舵(AS12 の任意装備)/tri=3値の理想デューティ量子化。
  function applySteer(car, prop, norm) {
    const n = Math.max(-1, Math.min(1, norm));
    if (prop) { car.steer = n >= 0 ? CONST.LEFT : CONST.RIGHT; car.steerAmt = Math.round(Math.abs(n) * 255); }
    else { car.steer = (car.steerAngle < n * CAR.maxSteer) ? CONST.LEFT : CONST.RIGHT; car.steerAmt = null; }
    return n;
  }
  function mkCar(course, type, prop, x = 0, y = 0, th = 0) {
    const car = new CarV2({ ...course.start, x, y, theta: th });
    car.type = type; car.tireSet = 'normal'; car.steerSet = prop ? 'prop' : 'tri';
    if (C.brakeSet) car.brakeSet = C.brakeSet;   // AV2: 未指定なら書かない = AU3 と byte 不変
    return car;
  }
  // 助走で U まで上げてから原点へ戻す(速度状態は保持)。意図線の中心 (0,R) と整合させる。
  function toSpeed(car, U) {
    car.steer = CONST.CENTER; car.steerAmt = null; car.driveDir = CONST.FORWARD; car.pwm = 255;
    for (let i = 0; i < C.runupTicks && car.u < U; i++) car.step(DT);
    car.x = 0; car.y = 0; car.theta = 0;
  }
  // スロットル則 = 「駆動輪の目標面速度 = u·(1+κ*)」を pwm(=目標速度比) で指令。
  function throttleSlip(car, kStar, floorU = C.throttleFloorU) {
    const u = Math.max(Math.abs(car.u), floorU);
    car.driveDir = CONST.FORWARD; car.pwm = pwmFor(car, u * (1 + kStar) + C.throttleBias);
  }

  // 進入速度の基準。**fullscale では vgrip と恒等**（上のヘッダの実測を参照）。
  const vRefOf = (car, R) => Math.min(Math.sqrt(Tn.mu0 * (car.grip || 1) * DYN.g * R), maxVOf(car));

  // ── 決定論 PRNG (mulberry32) — ランダム探索も再現可能にする ──────────────────────────
  let _rs = 0x12345678;
  const rnd = () => { _rs = (_rs + 0x6D2B79F5) >>> 0; let t = _rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const lerp = (a, b, r) => a + (b - a) * r;

  const stats = { runs: 0, reversed: 0 };

  // ── 切替(トレイルブレーキ型)ドライバ 1 run ────────────────────────────────────────────
  //   意図線 = 中心 C=(lead,R) の左回り弧。回頭 A の出口点 P、出口方向 e。
  //   廊下プロキシ: 弧区間は |dist(CG,C)−R| ≤ W/2−車半幅、出口区間は |横ずれ| ≤ 同。
  //   ⇒ **この上側の境界 R + (W/2 − 車半幅) が「廊下の外径 R_out」の定義そのもの**（AY1 が使う）。
  //   clean = P+exitM 面を通過 ∧ 廊下不侵犯 ∧ 通過時 |β|≤10° ∧ 向き誤差≤10° ∧ u≥0.5·vRef ∧ spin/後退なし。
  function runCornerSwitch(course, R, W, type, strat, p) {
    const prop = !!p.prop, mx = CAR.maxSteer;
    const car = mkCar(course, type, prop);
    const vgrip = vRefOf(car, R);
    const vEntry = p.entry * vgrip;
    toSpeed(car, vEntry);
    // 【AY1 追加 2026-09-07】**進入の横オフセット** y0（廊下の中で、どの高さから直線に入るか）。
    //   `toSpeed` が必ず (0,0,0) へ戻すので、元の実装は y0=0 に固定されていた。すると意図線 C=(lead,R) と
    //   同心の円が引けず（実舵の下限 R_min で回ると achieved 円の中心が C から R_min−R だけずれる）、
    //   舵で通せる条件が幾何の `R + usable ≥ R_min` ではなく **`R + usable/2 ≥ R_min`** に狭まる
    //   （AY1 が実測で確認: W=0.16 の境界 1.0727 ≒ 1 + usable/(2·R_min) = 1.0685）。
    //   y0 = R − R_min を選べば achieved 円が C と同心になり、幾何どおりの条件に戻る。
    //   **grip / drift の両方の探索空間に同じ 1 次元として与える**（片側だけ有利にしない）。
    //   `p.y0` を渡さなければ 0 ＝ **既存の呼び出し（wf_drift_reexam）は 1 バイトも変わらない**。
    car.y = p.y0 || 0;
    const A = p.ang * rad, lead = p.lead || 0, Cx = lead, Cy = R;
    const Px = lead + R * Math.sin(A), Py = R - R * Math.cos(A);
    const ex = Math.cos(A), ey = Math.sin(A), nx = -Math.sin(A), ny = Math.cos(A);
    const lim = limOf(W);
    let head = 0, prevTh = car.theta, betaPk = 0, spun = false, reversed = false, viol = 0, t = 0, done = false, gated = false;
    let phase = 'init', prevSl = -beta(car), initTicks = 0, brake = (strat === 'drift') ? (p.brakeTicks | 0) : 0;
    let exitU = null, exitBeta = null, exitHead = null, uMin = 1e9, arPk = 0;
    stats.runs++;
    for (let i = 0; i < C.tmo; i++) {
      const cgx = car.x, cgy = car.y;
      let prog = (cgx - Px) * ex + (cgy - Py) * ey;
      if (!gated) { if (head >= 0.75 * A && prog >= 0) gated = true; else prog = -1; }
      const lat = (cgx - Px) * nx + (cgy - Py) * ny;
      if (prog < 0) { const dev = (cgx < Cx) ? Math.abs(cgy) : Math.abs(Math.hypot(cgx - Cx, cgy - Cy) - R); if (dev > lim) viol = Math.max(viol, dev - lim); }
      else if (Math.abs(lat) > lim) viol = Math.max(viol, Math.abs(lat) - lim);
      if (prog >= C.exitM) { done = true; exitU = car.u; exitBeta = beta(car); exitHead = wrap(car.theta - A) * deg; break; }
      const sl = -beta(car), sld = (sl - prevSl) / DT; prevSl = sl;
      const remaining = A - head;
      if (strat === 'grip') {
        if (prog >= 0) { const herr = wrap(A - car.theta); applySteer(car, prop, p.kpG * 4 * herr / mx); throttleSlip(car, p.kExit); }
        else {
          if (prop) applySteer(car, true, (CAR.wheelBase / R + p.kpG * (car.u / R - car.r)) / mx);
          else { const rStar = car.u / R; car.steer = (car.r < rStar * 0.98) ? CONST.LEFT : (car.r > rStar * 1.02 ? CONST.CENTER : car.steer); car.steerAmt = null; }
          const e = vEntry - car.u;   // 速度保持(トレイルブレーキは entry<1 に含意)
          if (e < -C.brakeBand) { car.driveDir = CONST.BRAKE; car.pwm = 0; } else { car.driveDir = CONST.FORWARD; car.pwm = pwmFor(car, vEntry + C.speedBias); }
        }
      } else {
        const bt = p.beta;
        if (prog >= 0) phase = 'exit';
        else if (phase !== 'exit' && phase !== 'catch' && remaining < Math.max(Math.abs(car.r), 0.5) * p.tLead) phase = 'catch';
        else if (phase === 'init' && (sl >= bt - 5 || initTicks > 90)) phase = 'hold';
        if (phase === 'init') {
          initTicks++;
          if (brake > 0) { car.steer = CONST.LEFT; car.steerAmt = null; car.driveDir = CONST.BRAKE; car.pwm = 0; brake--; }
          else { applySteer(car, prop, 1); throttleSlip(car, p.kInit); }
        } else if (phase === 'hold') {
          const want = (p.kp * (bt - sl) - p.kd * sld) * mx; applySteer(car, prop, want / mx);
          throttleSlip(car, sl > bt + 4 ? p.kHoldLo : p.kHold);
        } else if (phase === 'catch') {
          // 【AU3 是正(i)】単位を揃えた残回頭ベースの絞り(deg 掛けなし)。
          const btc = Math.max(0, Math.min(bt, p.catchGain * remaining));
          const want = (p.kp * (btc - sl) - p.kd * sld) * mx; applySteer(car, prop, want / mx);
          throttleSlip(car, sl > btc + 4 ? p.kCatchLo : p.kCatch);
        } else {
          const herr = wrap(A - car.theta) * deg;
          const want = (p.kp * (0 - sl) - p.kd * sld + 0.02 * herr) * mx; applySteer(car, prop, want / mx);
          throttleSlip(car, Math.abs(sl) > 8 ? p.kCatchLo : p.kExit);
        }
      }
      car.step(DT); t += DT;
      head += wrap(car.theta - prevTh); prevTh = car.theta;
      const ab = Math.abs(beta(car)); if (ab > betaPk) betaPk = ab; if (car.u < uMin) uMin = car.u;
      // 後軸スリップ角(車体 β とは別物・「後輪をどれだけ滑らせているか」の直接指標)。
      const bb = 0.45 * CAR.wheelBase;
      const ar = Math.abs(Math.atan2(car.vlat - bb * car.r, Math.max(Math.abs(car.u), C.arFloorU)) * deg); if (ar > arPk) arPk = ar;
      if (ab > C.spinLim || car.u < C.revU) { if (car.u < C.revU) { reversed = true; stats.reversed++; } spun = true; break; }
    }
    const clean = done && !spun && viol === 0 && Math.abs(exitBeta) <= 10 && Math.abs(exitHead) <= 10 && exitU >= 0.5 * vgrip;
    return { t: done ? t : null, clean, spun, reversed, viol, betaPk, arPk, exitU, exitBeta, exitHead, vgrip, vEntry, uMin };
  }

  const GRIP_SPACE = { entry: [0.7, 1.15], kpG: [0.1, 1.0], lead: [0, 6], kExit: [0.02, 0.3], prop: [0, 1] };
  const DRIFT_SPACE = { entry: [0.8, 1.5], beta: [10, 50], tLead: [0.3, 1.5], lead: [0, 6], brakeTicks: [0, 30], kp: [0.02, 0.12], kd: [0, 0.005],
    catchGain: [30, 90], kInit: [0.1, 1.0], kHold: [0.05, 0.8], kHoldLo: [-0.1, 0.2], kCatch: [0.02, 0.4], kCatchLo: [-0.1, 0.1], kExit: [0.02, 0.3], prop: [0, 1] };
  const sample = (sp) => { const o = {}; for (const k in sp) { const [a, b] = sp[k]; o[k] = k === 'prop' ? (rnd() < 0.5 ? 0 : 1) : (k === 'brakeTicks' ? Math.round(lerp(a, b, rnd())) : lerp(a, b, rnd())); } return o; };
  const perturb = (sp, p, f) => { const o = { ...p }; for (const k in sp) { const [a, b] = sp[k]; if (k === 'prop') { if (rnd() < 0.15) o[k] = 1 - o[k]; continue; } let v = p[k] + (b - a) * f * (rnd() * 2 - 1); v = Math.max(a, Math.min(b, v)); o[k] = k === 'brakeTicks' ? Math.round(v) : v; } return o; };
  // 目的: clean なら t、非 clean なら連続的な罰(廊下逸脱量・spin・出口姿勢)＝探索が clean 側へ近づける。
  function score(r) {
    if (r.clean) return r.t;
    let pen = 100; if (r.t != null) pen = 20 + r.t;
    pen += C.violW * r.viol + (r.spun ? 30 : 0);
    if (r.exitBeta != null) pen += 0.2 * Math.max(0, Math.abs(r.exitBeta) - 10) + 0.2 * Math.max(0, Math.abs(r.exitHead) - 10);
    return pen;
  }
  // 【AU3】深さ制約アーム: 「実際に深く滑っている(βpk≥DEEP_MIN)clean 解」の中での最良を探す。
  function scoreDeep(r) {
    if (r.clean && r.betaPk >= DEEP_MIN) return r.t;
    if (r.clean) return 20 + r.t + 0.3 * (DEEP_MIN - r.betaPk);   // clean だが浅い＝深さ不足の連続罰
    return score(r);
  }
  // 【AY1 追加 2026-09-08・層 4 レビュー指摘】**深さ強制アーム**。
  //   `scoreDeep` は **clean 解が 1 つも無いセルでは `score` に完全退化する**（上の 3 行目）。
  //   AY1 が「舵で通れない廊下は滑らせても通れない」を主張する 12 セルはまさに clean 0 なので、
  //   そこでは深さ制約アームが無制約アームの bit 同一な複製になり、**滑っていない走行**（後軸スリップ角
  //   ピーク 2〜3°）を根拠に「滑らせても通れない」と言っていた。∴ **非 clean にも深さを報酬する**目的関数を
  //   別に置く。clean を諦めて深さを買う形なので `scoreDeep` とは別物＝**`wf_drift_reexam.mjs` は使わない**
  //   （既存の数値は 1 バイトも動かない）。
  //   罰の設計: 深く滑れているほど小さく、そのうえで廊下逸脱が小さいほど小さい。深さ不足 1° あたりの
  //   重みは廊下逸脱 1 標本ぶん（violW）と釣り合う大きさにして、**深さを優先しつつ廊下も見る**。
  function scoreForceDeep(r) {
    if (r.clean && r.betaPk >= DEEP_MIN) return r.t;              // 深くて clean なら時間で競う
    const shortfall = Math.max(0, DEEP_MIN - r.betaPk);           // 深さ不足 [deg]
    return 100 + 2 * shortfall + C.violW * r.viol + (r.spun ? 10 : 0);
  }
  // grip/drift とも **同じ予算・同じ手続き**で最適化する（片側だけ強く探索しない）。
  // `spaces` は既定で上の 2 空間。領域が違うと意味を失う範囲（lead は [m]・entry の上限は
  // vRef が最高速に張り付く卓上では 1.0 超が到達不能）だけを呼び出し側が差し替えられるようにしてある。
  function optimize(course, R, W, type, strat, ang, nRand, nLocal, seed, scoreFn = score, spaces = null) {
    // nRand=0 だと局所改良相が best=null を触って落ちる（層 4 レビュー指摘・現行の予算では到達しないが
    // 予算を絞る改造で踏む）。**黙って落ちるより先に止める**。
    if (!(nRand >= 1)) throw new Error(`optimize: nRand は 1 以上が要る（受領 ${nRand}）`);
    // `spaces` を片側だけ渡すと、もう片方が **fullscale の既定空間**（lead [0,6]m 等）へ黙って戻る。
    // 「片側だけ有利にしない」を型で守れないので、渡すなら両方を要求する（層 4 レビュー指摘）。
    if (spaces && !(spaces.grip && spaces.drift)) throw new Error('optimize: spaces は grip/drift の両方を渡すこと（片側だけだと他方が fullscale 既定へ戻る）');
    _rs = seed >>> 0;
    const sp = strat === 'grip' ? ((spaces && spaces.grip) || GRIP_SPACE) : ((spaces && spaces.drift) || DRIFT_SPACE);
    let best = null;
    const evalP = (p) => { const r = runCornerSwitch(course, R, W, type, strat, { ...p, ang }); const sc = scoreFn(r); if (!best || sc < best.sc) best = { sc, p, r }; return sc; };
    for (let i = 0; i < nRand; i++) evalP(sample(sp));
    let f = 0.25;
    for (let i = 0; i < nLocal; i++) { const cand = perturb(sp, best.p, f); const before = best.sc; evalP(cand); if (best.sc >= before) f = Math.max(0.03, f * 0.97); }
    // ⚠ **進入 ±10% の +10% 側は、vRef が車種最高速に張り付く領域（卓上）では entry ≥ 1/1.1 の解に対して
    //   no-op になる**（助走が同じ終端速度へ収束するので run が bit 一致する。層 4 レビュー指摘・実測確認済）。
    //   ここは `wf_drift_reexam.mjs` と共有するので式は変えない。**該当する行を呼び出し側が印字する**
    //   （AY1 の D-3）ことで、頑健性 3/3 が水増しでないかを読み手が確かめられるようにしてある。
    const rob = [0.9, 1.1].map(m => runCornerSwitch(course, R, W, type, strat, { ...best.p, ang, entry: best.p.entry * m })).filter(r => r.clean).length + (best.r.clean ? 1 : 0);
    return { ...best, robust: rob };
  }

  return { cfg: C, Tn, HALF_W_CAR, limOf, maxVOf, pwmFor, holdSpeed, tcPwm, applySteer, mkCar, toSpeed,
           throttleSlip, vRefOf, rnd, stats, runCornerSwitch, GRIP_SPACE, DRIFT_SPACE,
           sample, perturb, score, scoreDeep, scoreForceDeep, optimize };
}

// 深さ制約アームの定数（`wf_drift_reexam.mjs` のアサートが参照する）。
export const DEEP_MIN = 20;
// 深い解が浅い最適解より「実際に」どれだけ遅いか の下限（単なる `deep_t ≥ drift_t` は最適化の恒等式に近い）。
export const MARGIN_MIN = 1.05;
