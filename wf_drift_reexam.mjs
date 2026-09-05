// wf_drift_reexam.mjs — Stage AU3「ドリフト再検証プローブの常設ゲート化」(2026-09-05・物理無改変)。
// ══════════════════════════════════════════════════════════════════════════════════════
// 2026-09-04 の会話ベース再調査(決定ログ AU-0)で使ったスクラッチ 3 本を統合・追跡化したもの。
// スクラッチは internal `tools/drift_reexam_2026-09-04/` に一次ログごと保全してある。
//
// 構成(PLAN AU3 の改訂スコープ・壁付きは再実装しない):
//   Part 1  自由空間＋廊下プロキシ … grip/drift とも系統掃引の最良 clean を比べる(旧 drift_reexam.mjs Part1)
//   Part 2  切替(トレイルブレーキ型)最適化 … スロットルで後輪スリップ率を制御する「ドリフト⇄グリップ切替」
//           ドライバをランダム探索＋局所改良で最適化し、grip も同予算で最適化して比べる(旧 drift_stage2.mjs)
//   Part 3  2 台走行 … 実 integrateFleetV2(掃引 CCD＋インパルス接触)で先頭/後続を走らせ、
//           ブロック戦術のコストを測る(旧 drift_race2.mjs)
//   ※ **壁付きヘアピンは `wf_ap14_wallhairpin.mjs` が常設ゲート化済**(AU1 が Part C を置換)。二重実装と
//     実行時間の二重計上を避けるため本ゲートでは再実装しない。docs へ転記するときは 2 本の --json を並べる。
//
// **再実装せず 実 buildFromSpec / CarV2.step / integrateFleetV2 / LapTracker / carEdges / distToSeg を呼ぶ**
// (CI-14。オラクル一覧は internal の docs/oracle_inventory.md)。走行物理は 1 バイトも触らない。
//
// ── スクラッチから是正した点(AU-0 の敵対的レビュー指摘＋AU1 の持ち越し) ─────────────────
//  ① import を相対パスへ(スクラッチはホスト絶対パス)。相互 import も解消し 1 ファイル自己完結。
//  ② **catch 相の滑り目標の単位**: `catchGain * remaining * deg` → `catchGain * remaining`。
//     remaining は rad・catchGain は deg/rad ゆえ旧式は次元が deg²/rad で不整合、数値でも残 0.33° を切るまで
//     絞りが効かない no-op だった(AU1 の実測札)。touge/AP15 の `60*remaining` に合わせて同族を揃えた
//     (AU3 持ち越し(i))。∴ **本ゲートの数値はスクラッチのログとは一致しない**(ドライバが変わったため)。
//  ③ **後退ガードの計数**: β=atan2(vlat,|u|) は分母が |u| ゆえ u<0 で意味を失うため、u<−0.5 を spin として
//     打ち切る。**この打ち切り自体はスクラッチにも既にある**(drift_reexam.mjs:112 / drift_stage2.mjs:69)。
//     本ゲートで新規なのは「何 run が後退で落ちたか」の**計数**で、持ち越し(ii)の是正が空振りしていない
//     ことを P1-3 で機械固定するために足した(AP15/touge 側は本当に新規の追加＝そちらが持ち越し(ii)の本体)。
//  ④ **Part 2 見出しの `lead`→`tLead` 誤記**: スクラッチ Part2 は見出しに `lead` と書いて `tLead` を印字して
//     いた(AU-0 の敵対的レビュー指摘③)。本ゲートは印字する値と見出しを一致させる。
//  ⑤ **2 台走行の順位ラベル**: スクラッチの `order` は `(sL−sF) mod LAP < LAP/2` で判定しており、周回差が
//     あると誤る(実測: mirror で netAhead=+496m=先頭が前なのに "F ahead" と表示)。**netAhead の符号**を正とする。
//
//  ⑥ スクラッチには無い**追加のアーム**(いずれも測定を増やすもので、既存の測り方は変えていない):
//     ・Part2 の**深さ制約アーム**(`scoreDeep`)＝「実際に深く滑る clean 解」の中での最良を同予算で探す
//     ・Part3 の **`slowcap` モード**＝side の「準備の減速」だけを行い横は向かないアーム(参考値)
//     ・Part3 の既定路面を low → **dry**(スクラッチ `drift_race2.mjs` は SURF 既定 low)、周回 4 → **3**(既定のみ)
//     ・スクラッチの診断出力(`gateT`・`fastestAny`・非 clean の内訳)は落とした(常設ゲートでは表が主)
//  ⑦ Part3 の**進行度の基準**を spawn 実測へ(下の C-2 コメント参照)。スクラッチは初期 s に生の
//     `s0-gapM` を入れており、netAhead に定数バイアスと後続車の幻ラップが入っていた。
//
// 使い方:
//   node wf_drift_reexam.mjs           # 既定=縮小掃引。アサート緑/赤で exit 0/1
//   node wf_drift_reexam.mjs --full    # 全表(Part1 36セル系統掃引ほか)。docs 転記用
//   node wf_drift_reexam.mjs --json    # 表を JSON で吐く(internal の docs/stage_au/reexam_result.md へ整形転記)
// 所要は末尾に Part 別で印字する(ホスト依存ゆえ本文に固定値を書かない)。
// ══════════════════════════════════════════════════════════════════════════════════════
import { buildFromSpec } from './public/js/course.js';
import { CarV2, tireParamsFor, V2 } from './public/js/physics_v2.js';
import { CAR, CONST, setPhysicsMode, APP_VERSION } from './public/js/config.js';
import { applyRegime, DYN } from './public/js/physics_dyn.js';
import { integrateFleetV2 } from './public/js/fleet.js';
import { LapTracker } from './public/js/lap.js';
import { carEdges } from './public/js/physics.js';
import { distToSeg } from './public/js/geom.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FULL = process.argv.includes('--full');
const WANT_JSON = process.argv.includes('--json');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const DT = 1 / 60, deg = 180 / Math.PI, rad = Math.PI / 180;
const beta = (c) => Math.atan2(c.vlat, Math.max(Math.abs(c.u), 1e-6)) * deg;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const benches = JSON.parse(readFileSync(join(ROOT, 'docs', 'stage_ao', 'bench_courses.json'), 'utf8'));

setPhysicsMode('v2'); applyRegime('fullscale');
const Tn = tireParamsFor('normal');
const R_MIN = CAR.wheelBase / Math.tan(CAR.maxSteer);
const HALF_W_CAR = CAR.width / 2;
console.log(`\n[AU3] ドリフト再検証プローブ  APP=${APP_VERSION}  fullscale v2  R_min=${R_MIN.toFixed(3)}m  車体 ${CAR.length}x${CAR.width}m`);
console.log(`  掃引: ${FULL ? '系統(--full・docs 転記用)' : '既定 縮小'}   ドライバ=AU3(符号是正＋catch 単位是正＋後退ガード)`);

// ── 共通ドライバ部品(AP14/AP15/touge と同型) ──────────────────────────────────────────
// v2 の pwm は「目標速度 = pwm/255·maxV」(physics_v2.js)。低 pwm でも全トルク指令になりうるので、
// 速度指令は必ず目標速度比で出す(memory `rumicar-v2-pwm-is-target-speed`)。
const maxVOf = (car) => CAR.maxSpeed * car.profile().maxSpeed;
const pwmFor = (car, U) => Math.max(0, Math.min(255, Math.round(U / maxVOf(car) * 255)));
function holdSpeed(car, U) {
  const e = U - car.u;
  if (e < -0.6) { car.driveDir = CONST.BRAKE; car.pwm = 0; }
  else { car.driveDir = CONST.FORWARD; car.pwm = pwmFor(car, U + 0.3); }
}
// 簡易トラクション制御(車輪エンコーダ vwR のみ使用)。駆動軸スリップ率が maxSlip を超えたら絞る。
function tcPwm(car, full, maxSlip) {
  const s = (car.vwR - Math.abs(car.u)) / Math.max(Math.abs(car.u), 1);
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
  return car;
}
// 助走で U まで上げてから原点へ戻す(速度状態は保持)。意図線の中心 (0,R) と整合させる。
function toSpeed(car, U) {
  car.steer = CONST.CENTER; car.steerAmt = null; car.driveDir = CONST.FORWARD; car.pwm = 255;
  for (let i = 0; i < 8000 && car.u < U; i++) car.step(DT);
  car.x = 0; car.y = 0; car.theta = 0;
}

// ══════════════════════════════════════════════════════════════════════════════════════
// Part 1: 自由空間＋廊下プロキシ
//   意図線 = 中心 C=(lead,R) の左回り弧。回頭 A の出口点 P、出口方向 e。
//   廊下プロキシ: 弧区間は |dist(CG,C)−R| ≤ W/2−車半幅、出口区間は |横ずれ| ≤ 同。
//   clean = P+20m 面を通過 ∧ 廊下不侵犯 ∧ 通過時 |β|≤10° ∧ 向き誤差≤10° ∧ u≥0.5·v_grip ∧ spin/後退なし。
//   総合時間 = 弧開始〜P+20m 面通過。GO = 総合時間比 ≤0.98 ∧ 進入±10% で 3/3 clean(頑健)。
// ══════════════════════════════════════════════════════════════════════════════════════
const SPIN_LIM = 115, EXIT_M = 20, TMO = 1800;
let p1Reversed = 0, p1Runs = 0;    // 後退ガードの発火計数(空振り防止・持ち越し(ii)の検出力)
function runCornerFree(course, R, W, type, strat, prm) {
  const prop = prm.prop, mx = CAR.maxSteer;
  const car = mkCar(course, type, prop);
  const vgrip = Math.sqrt(Tn.mu0 * (car.grip || 1) * DYN.g * R);
  const vEntry = prm.entry * vgrip;
  toSpeed(car, vEntry);
  const A = prm.ang * rad, lead = prm.lead || 0, Cx = lead, Cy = R;
  const Px = lead + R * Math.sin(A), Py = R - R * Math.cos(A);
  const ex = Math.cos(A), ey = Math.sin(A), nx = -Math.sin(A), ny = Math.cos(A);
  const lim = W / 2 - HALF_W_CAR;
  let head = 0, prevTh = car.theta, betaPk = 0, spun = false, reversed = false, viol = 0, t = 0, done = false;
  let phase = 'init', prevSl = -beta(car), initTicks = 0;
  let brake = (strat === 'drift' && /_fr$/.test(type)) ? prm.brakeTicks : 0;
  let gSteer = CONST.CENTER, exitU = null, exitBeta = null, exitHead = null, gated = false;
  p1Runs++;
  for (let i = 0; i < TMO; i++) {
    const cgx = car.x, cgy = car.y;                  // 後輪軸基準
    let prog = (cgx - Px) * ex + (cgy - Py) * ey;
    // 180° では出口面が始点側にも伸びるため、回頭 3/4 以降でしかゲートを有効にしない。
    if (!gated) { if (head >= 0.75 * A && prog >= 0) gated = true; else prog = -1; }
    const lat = (cgx - Px) * nx + (cgy - Py) * ny;
    if (prog < 0) { const dev = (cgx < Cx) ? Math.abs(cgy) : Math.abs(Math.hypot(cgx - Cx, cgy - Cy) - R); if (dev > lim) viol = Math.max(viol, dev - lim); }
    else if (Math.abs(lat) > lim) viol = Math.max(viol, Math.abs(lat) - lim);
    if (prog >= EXIT_M) { done = true; exitU = car.u; exitBeta = beta(car); exitHead = wrap(car.theta - A) * deg; break; }
    const sl = -beta(car), sld = (sl - prevSl) / DT; prevSl = sl;
    const remaining = A - head;
    if (strat === 'grip') {
      if (prog >= 0) {   // 出口: 向きを A へ合わせつつ全開
        const herr = wrap(A - car.theta); applySteer(car, prop, prm.kpG * 4 * herr / mx);
        car.driveDir = CONST.FORWARD; car.pwm = tcPwm(car, 255, 0.15);
      } else if (prop) { const want = CAR.wheelBase / R + prm.kpG * (car.u / R - car.r); applySteer(car, true, want / mx); holdSpeed(car, vEntry); }
      else { const rStar = car.u / R; if (car.r < rStar * 0.98) gSteer = CONST.LEFT; else if (car.r > rStar * 1.02) gSteer = CONST.CENTER; car.steer = gSteer; car.steerAmt = null; holdSpeed(car, vEntry); }
    } else {
      const bt = prm.beta;
      if (prog >= 0) phase = 'exit';
      else if (phase !== 'exit' && phase !== 'catch' && remaining < Math.max(Math.abs(car.r), 0.5) * prm.tLead) phase = 'catch';
      else if (phase === 'init' && (sl >= bt - 5 || initTicks > 90)) phase = 'hold';
      if (phase === 'init') {
        initTicks++;
        if (brake > 0) { car.steer = CONST.LEFT; car.steerAmt = null; car.driveDir = CONST.BRAKE; car.pwm = 0; brake--; }
        else { applySteer(car, prop, 1); car.driveDir = CONST.FORWARD; car.pwm = tcPwm(car, 255, 0.8); }
      } else if (phase === 'hold') {
        const want = (prm.kp * (bt - sl) - prm.kd * sld) * mx; applySteer(car, prop, want / mx);
        car.driveDir = CONST.FORWARD; car.pwm = (sl > bt + 4) ? prm.pHold : tcPwm(car, 255, 0.6);
      } else if (phase === 'catch') {
        // 【AU3 是正(i)】残回頭に応じて滑り目標を絞る。remaining は rad・catchGain は deg/rad(=60)。
        const btc = Math.max(0, Math.min(bt, prm.catchGain * remaining));
        const want = (prm.kp * (btc - sl) - prm.kd * sld) * mx; applySteer(car, prop, want / mx);
        car.driveDir = CONST.FORWARD; car.pwm = (sl > btc + 4) ? prm.pCatch : tcPwm(car, 200, 0.3);
      } else {   // exit: 滑り 0 へ能動回収しつつ向きを A へ
        const herr = wrap(A - car.theta) * deg;
        const want = (prm.kp * (0 - sl) - prm.kd * sld + 0.02 * herr) * mx; applySteer(car, prop, want / mx);
        car.driveDir = CONST.FORWARD; car.pwm = (Math.abs(sl) > 8) ? prm.pCatch : tcPwm(car, 255, 0.15);
      }
    }
    car.step(DT); t += DT;
    head += wrap(car.theta - prevTh); prevTh = car.theta;
    const ab = Math.abs(beta(car)); if (ab > betaPk) betaPk = ab;
    if (ab > SPIN_LIM || car.u < -0.5) { if (car.u < -0.5) { reversed = true; p1Reversed++; } spun = true; break; }   // 【AU3 是正(iii)】後退ガード
  }
  const clean = done && !spun && viol === 0 && Math.abs(exitBeta) <= 10 && Math.abs(exitHead) <= 10 && exitU >= 0.5 * vgrip;
  return { t: done ? t : null, clean, spun, reversed, viol, betaPk, exitU, exitBeta, exitHead, vgrip, vEntry, done };
}
function gridGripFree(ang) {
  const entries = FULL ? [0.75, 0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1] : [0.75, 0.85, 0.95, 1.05, 1.1];
  const kpGs = FULL ? [0.2, 0.45, 0.8] : [0.45];
  const leads = FULL ? [0, 2, 4, 6] : [0, 4];
  const out = [];
  for (const prop of [false, true]) for (const entry of entries) for (const kpG of kpGs) for (const lead of leads)
    out.push({ prop, entry, ang, kpG, lead });
  return out;
}
function gridDriftFree(ang, type) {
  const entries = FULL ? [0.85, 1.0, 1.15, 1.3] : [0.85, 1.0, 1.15];
  // 【AU3 是正・敵対的レビュー C-1】縮小格子から β=35 と pCatch=110 を落としていたため、
  //   **既定掃引では --full が見つける唯一の GO(β=35・pCatch=110)を構造的に見つけられなかった**。
  //   既定と --full で結論が反転する(既定 GO=0 / --full GO=1)のはゲートとして壊れているので戻す。
  //   実行時間は Part1 のセル集合を絞って相殺する(下の P1_CORNERS/P1_TYPES)。
  //   縮小の β は {15, 35}。35 は --full の唯一の GO(R5/low/180/normal_fr・entry 0.85・tLead 0.5・
  //   pCatch 110・lead 4・brake 25・連続舵)を再現するのに必須、15 は浅い側の代表。25 は既定実行の
  //   3 分制約のため落とした(--full では 15/25/35/45 を掃引する)。
  const bts = FULL ? [15, 25, 35, 45] : [15, 35];
  const tLeads = FULL ? [0.5, 1.0] : [0.5, 1.0];
  const pCatches = FULL ? [30, 110, 200] : [30, 110];
  const leads = [0, 4];   // 縮小でも lead は落とさない: 最良 drift 行の多くが lead=4 側に出る(実測)
  const brakes = /_fr$/.test(type) ? (FULL ? [4, 9, 25] : [4, 25]) : (FULL ? [0, 6, 12] : [0, 12]);
  const out = [];
  for (const prop of [false, true]) for (const entry of entries) for (const beta of bts) for (const tLead of tLeads)
    for (const pCatch of pCatches) for (const lead of leads) for (const brakeTicks of brakes)
      out.push({ prop, entry, ang, beta, tLead, pCatch, brakeTicks, lead, kp: 0.06, kd: 0.002, pHold: 110, catchGain: 60 });
  return out;
}
function sweepFree(course, R, W, type, ang, strat) {
  const grid = strat === 'grip' ? gridGripFree(ang) : gridDriftFree(ang, type);
  let best = null, cleanN = 0;
  for (const prm of grid) {
    const r = runCornerFree(course, R, W, type, strat, prm);
    if (r.clean) { cleanN++; if (!best || r.t < best.t) best = { ...prm, ...r }; }
  }
  let robust = null;
  if (best && strat === 'drift') {
    robust = 1 + [0.9, 1.1].map(m => runCornerFree(course, R, W, type, 'drift', { ...best, entry: best.entry * m })).filter(r => r.clean).length;
  }
  return { best, cleanN, n: grid.length, robust };
}

const T0 = process.hrtime.bigint(); let tP1 = 0, tP2 = 0, tP3 = 0;
const lap = () => { const n = process.hrtime.bigint(); const v = Number(n - MARK) / 1e9; MARK = n; return v; };
let MARK = T0;
console.log(`\n[Part 1] 自由空間＋廊下プロキシ。grip/drift とも系統掃引の最良 clean。ratio=drift/grip。robust=最良 drift の進入±10% clean 数/3`);
console.log(`corner       surf ang car        | grip t  entry 舵 | drift t entry  β tLead  pC 舵 βpk | ratio robust | 判定`);
// 縮小は「最タイト半径 R5 と最大半径 R8」×「乾燥/低μ」×「90°/180°」×normal_fr = 8 セル。
// R5/低μ/180°/normal_fr（--full が唯一の GO を出すセル）を必ず含む集合であることが要件。
// drift_fr(LSD 車) と normal_awd は --full 側で見る（どちらも GO を出さない＝結論を左右しない）。
const P1_CORNERS = FULL ? [['hairpin-R5', 5, 6], ['hairpin-R6.5', 6.5, 6], ['hairpin-R8', 8, 7]]
                        : [['hairpin-R5', 5, 6], ['hairpin-R8', 8, 7]];
const P1_TYPES = FULL ? ['normal_fr', 'normal_awd', 'drift_fr'] : ['normal_fr'];
const table1 = [];
for (const [ck, R, W] of P1_CORNERS) for (const sfx of ['dry', 'low']) {
  const course = buildFromSpec(benches.find(b => b.name === `bench-${ck}-${sfx}`));
  for (const ang of [90, 180]) for (const type of P1_TYPES) {
    const g = sweepFree(course, R, W, type, ang, 'grip'), d = sweepFree(course, R, W, type, ang, 'drift');
    const gb = g.best, db = d.best;
    const ratio = (gb && db) ? db.t / gb.t : null;
    const GO = ratio != null && ratio <= 0.98 && d.robust === 3;
    const f = (v) => v == null ? '  DNF' : v.toFixed(2).padStart(5);
    console.log(`${ck.padEnd(12)} ${sfx.padEnd(4)} ${String(ang).padStart(3)} ${type.padEnd(10)} | ${f(gb && gb.t)} ${gb ? gb.entry.toFixed(2) : '  -  '} ${gb ? (gb.prop ? 'P' : 'T') : '-'} | ${f(db && db.t)} ${db ? db.entry.toFixed(2) : '  -  '} ${db ? String(db.beta).padStart(2) : ' -'} ${db ? db.tLead.toFixed(1).padStart(4) : '  - '} ${db ? String(db.pCatch).padStart(3) : '  -'} ${db ? (db.prop ? 'P' : 'T') : '-'} ${db ? String(Math.round(db.betaPk)).padStart(3) : '  -'} | ${ratio != null ? ratio.toFixed(3) : '  -  '} ${d.robust != null ? d.robust + '/3' : ' - '} | ${GO ? 'GO' : 'NO-GO'}  (drift clean ${d.cleanN}/${d.n}, grip clean ${g.cleanN}/${g.n})`);
    table1.push({ corner: ck, surf: sfx, ang, type,
      grip_t: gb ? +gb.t.toFixed(4) : null, grip_entry: gb ? gb.entry : null, grip_cleanN: g.cleanN, grip_n: g.n,
      drift_t: db ? +db.t.toFixed(4) : null, drift_entry: db ? db.entry : null, drift_beta: db ? db.beta : null,
      drift_tLead: db ? db.tLead : null, drift_pCatch: db ? db.pCatch : null, drift_bpk: db ? +db.betaPk.toFixed(2) : null,
      drift_lead: db ? db.lead : null, drift_brakeTicks: db ? db.brakeTicks : null, drift_steer: db ? (db.prop ? 'prop' : 'tri') : null,
      grip_steer: gb ? (gb.prop ? 'prop' : 'tri') : null, grip_lead: gb ? gb.lead : null,
      drift_cleanN: d.cleanN, drift_n: d.n, robust: d.robust,
      ratio: ratio != null ? +ratio.toFixed(4) : null, verdict: GO ? 'GO' : 'NO-GO' });
  }
}
tP1 = lap();
// Part1 集計時点のスナップショット（(d) 決定論ブロックが後で 2 run 追加するため、
// アサートのメッセージと JSON で値が食い違わないよう固定する）。
const p1RunsAtTable = p1Runs, p1ReversedAtTable = p1Reversed;
const p1Go = table1.filter(r => r.verdict === 'GO').length;
const p1DriftClean = table1.reduce((a, r) => a + r.drift_cleanN, 0);
const p1GripClean = table1.reduce((a, r) => a + r.grip_cleanN, 0);
console.log(`  GO = ${p1Go} / ${table1.length} セル（drift clean 合計 ${p1DriftClean} / grip clean 合計 ${p1GripClean}）`);

// ══════════════════════════════════════════════════════════════════════════════════════
// Part 2: 切替(トレイルブレーキ型)ドライバの最適化
//   スロットル則 = 「駆動輪の目標面速度 = u·(1+κ*)」を pwm(=目標速度比) で指令 → 車輪 ODE が κ≈κ* へ寄る。
//   κ*>0 で後輪を意図的に滑らせ(パワースライド)、κ*≈0 で再グリップ = **アクセルでドリフト⇄グリップを切替**。
//   grip 側も **同じ予算** で最適化して最良 clean 同士を比べる(片側だけ強く探索しない)。
//   条件 3 種: base / power2x(駆動力×2＝実車ドリフト車は駆動力 > 後輪グリップ) / loose(ルーズ路面近似)。
//   ※ エンジンは無改変。V2 holder と bench spec を **実行時に上書き**して感度を測り、各セル前に applyRegime で戻す。
// ══════════════════════════════════════════════════════════════════════════════════════
// 決定論 PRNG (mulberry32) — ランダム探索も再現可能にする。
let _rs = 0x12345678;
const rnd = () => { _rs = (_rs + 0x6D2B79F5) >>> 0; let t = _rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const lerp = (a, b, r) => a + (b - a) * r;
function throttleSlip(car, kStar, floorU = 1) {
  const u = Math.max(Math.abs(car.u), floorU);
  car.driveDir = CONST.FORWARD; car.pwm = pwmFor(car, u * (1 + kStar) + 0.2);
}
let p2Reversed = 0, p2Runs = 0;
function runCornerSwitch(course, R, W, type, strat, p) {
  const prop = !!p.prop, mx = CAR.maxSteer;
  const car = mkCar(course, type, prop);
  const vgrip = Math.sqrt(Tn.mu0 * (car.grip || 1) * DYN.g * R);
  const vEntry = p.entry * vgrip;
  toSpeed(car, vEntry);
  const A = p.ang * rad, lead = p.lead || 0, Cx = lead, Cy = R;
  const Px = lead + R * Math.sin(A), Py = R - R * Math.cos(A);
  const ex = Math.cos(A), ey = Math.sin(A), nx = -Math.sin(A), ny = Math.cos(A);
  const lim = W / 2 - HALF_W_CAR;
  let head = 0, prevTh = car.theta, betaPk = 0, spun = false, reversed = false, viol = 0, t = 0, done = false, gated = false;
  let phase = 'init', prevSl = -beta(car), initTicks = 0, brake = (strat === 'drift') ? (p.brakeTicks | 0) : 0;
  let exitU = null, exitBeta = null, exitHead = null, uMin = 1e9, arPk = 0;
  p2Runs++;
  for (let i = 0; i < TMO; i++) {
    const cgx = car.x, cgy = car.y;
    let prog = (cgx - Px) * ex + (cgy - Py) * ey;
    if (!gated) { if (head >= 0.75 * A && prog >= 0) gated = true; else prog = -1; }
    const lat = (cgx - Px) * nx + (cgy - Py) * ny;
    if (prog < 0) { const dev = (cgx < Cx) ? Math.abs(cgy) : Math.abs(Math.hypot(cgx - Cx, cgy - Cy) - R); if (dev > lim) viol = Math.max(viol, dev - lim); }
    else if (Math.abs(lat) > lim) viol = Math.max(viol, Math.abs(lat) - lim);
    if (prog >= EXIT_M) { done = true; exitU = car.u; exitBeta = beta(car); exitHead = wrap(car.theta - A) * deg; break; }
    const sl = -beta(car), sld = (sl - prevSl) / DT; prevSl = sl;
    const remaining = A - head;
    if (strat === 'grip') {
      if (prog >= 0) { const herr = wrap(A - car.theta); applySteer(car, prop, p.kpG * 4 * herr / mx); throttleSlip(car, p.kExit); }
      else {
        if (prop) applySteer(car, true, (CAR.wheelBase / R + p.kpG * (car.u / R - car.r)) / mx);
        else { const rStar = car.u / R; car.steer = (car.r < rStar * 0.98) ? CONST.LEFT : (car.r > rStar * 1.02 ? CONST.CENTER : car.steer); car.steerAmt = null; }
        const e = vEntry - car.u;   // 速度保持(トレイルブレーキは entry<1 に含意)
        if (e < -0.6) { car.driveDir = CONST.BRAKE; car.pwm = 0; } else { car.driveDir = CONST.FORWARD; car.pwm = pwmFor(car, vEntry + 0.3); }
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
    const ar = Math.abs(Math.atan2(car.vlat - bb * car.r, Math.max(Math.abs(car.u), 0.5)) * deg); if (ar > arPk) arPk = ar;
    if (ab > SPIN_LIM || car.u < -0.5) { if (car.u < -0.5) { reversed = true; p2Reversed++; } spun = true; break; }
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
  pen += 5 * r.viol + (r.spun ? 30 : 0);
  if (r.exitBeta != null) pen += 0.2 * Math.max(0, Math.abs(r.exitBeta) - 10) + 0.2 * Math.max(0, Math.abs(r.exitHead) - 10);
  return pen;
}
// 【AU3】深さ制約アーム: 「実際に深く滑っている(βpk≥DEEP_MIN)clean 解」の中での最良を探す。
//   狙い＝「速いのは浅い滑り」を **浅い最適解が選ばれた** という事実だけで言うと過大主張になる
//   (変異注入で確認: 目的関数が深さを報酬すると βpk 23° で grip より 9% 速い解が見つかる＝深くても
//    grip には勝てる)。∴ 正しい主張は「**深い解は浅い最適解より遅い**」であり、それを直接測る。
const DEEP_MIN = 20;
// 深い解が浅い最適解より「実際に」どれだけ遅いか の下限（単なる `deep_t ≥ drift_t` は最適化の恒等式に近い）。
const MARGIN_MIN = 1.05;
function scoreDeep(r) {
  if (r.clean && r.betaPk >= DEEP_MIN) return r.t;
  if (r.clean) return 20 + r.t + 0.3 * (DEEP_MIN - r.betaPk);   // clean だが浅い＝深さ不足の連続罰
  return score(r);
}
function optimize(course, R, W, type, strat, ang, nRand, nLocal, seed, scoreFn = score) {
  _rs = seed >>> 0;
  const sp = strat === 'grip' ? GRIP_SPACE : DRIFT_SPACE;
  let best = null;
  const evalP = (p) => { const r = runCornerSwitch(course, R, W, type, strat, { ...p, ang }); const sc = scoreFn(r); if (!best || sc < best.sc) best = { sc, p, r }; return sc; };
  for (let i = 0; i < nRand; i++) evalP(sample(sp));
  let f = 0.25;
  for (let i = 0; i < nLocal; i++) { const cand = perturb(sp, best.p, f); const before = best.sc; evalP(cand); if (best.sc >= before) f = Math.max(0.03, f * 0.97); }
  const rob = [0.9, 1.1].map(m => runCornerSwitch(course, R, W, type, strat, { ...best.p, ang, entry: best.p.entry * m })).filter(r => r.clean).length + (best.r.clean ? 1 : 0);
  return { ...best, robust: rob };
}
function setVariant(v) { applyRegime('fullscale'); if (v === 'power2x') { V2.launchAccel *= 2; V2.wheelPower *= 2; } }
function courseFor(ck, sfx, v) {
  const spec = { ...benches.find(b => b.name === `bench-${ck}-${sfx}`) };
  if (v === 'loose') { spec.grip = 0.6; spec.muDecay = 0.95; }   // 低μ＋ピーク後ほぼ平坦(ルーズ路面の「滑っても食う」近似の上限)
  return buildFromSpec(spec);
}

// 縮小予算は「既定実行 3 分以内」の受け入れ基準に合わせて決めてある(Part1 の格子を C-1 是正で広げた
// ぶん、Part2 の予算を一律に絞って相殺した)。grip:drift の予算比は --full と同じに保つ(片側だけ強く
// 探索しない)。所要は末尾に Part 別で印字するので、環境が変わったらそこを見て調整すること。
const P2_BUDGET = FULL ? { gr: 120, gl: 80, dr: 200, dl: 120 } : { gr: 36, gl: 23, dr: 56, dl: 33 };
const P2_VARIANTS = FULL ? ['base', 'power2x', 'loose'] : ['base', 'power2x'];
const P2_CELLS = FULL ? [['hairpin-R5', 5, 6], ['hairpin-R6.5', 6.5, 6]] : [['hairpin-R5', 5, 6], ['hairpin-R6.5', 6.5, 6]];
console.log(`\n[Part 2] 切替(トレイルブレーキ型)ドライバの最適化。grip も同予算で最適化。予算 rand ${P2_BUDGET.dr} + local ${P2_BUDGET.dl} (drift) / ${P2_BUDGET.gr}+${P2_BUDGET.gl} (grip)`);
console.log(`variant  corner       surf ang car       | grip t  entry rob | drift t entry  β brk kHold kCatch 舵 rob βpk αr | ratio | 判定`);
const table2 = [];
for (const v of P2_VARIANTS) for (const [ck, R, W] of P2_CELLS) for (const sfx of ['dry', 'low']) for (const ang of [90, 180]) {
  if (v === 'loose' && sfx === 'dry') continue;                    // ルーズ路面は低μ側でのみ意味がある
  if (!FULL && v === 'power2x' && sfx === 'dry') continue;         // 縮小: power2x は低μ 4 行に絞る
  setVariant(v);
  const course = courseFor(ck, sfx, v);
  const type = 'normal_fr';
  const g = optimize(course, R, W, type, 'grip', ang, P2_BUDGET.gr, P2_BUDGET.gl, 11);
  const d = optimize(course, R, W, type, 'drift', ang, P2_BUDGET.dr, P2_BUDGET.dl, 7);
  // 深さ制約アーム(全条件)。同じ予算・同じシードで「深く滑る最良解」を探す。power2x(駆動力×2)は
  // 「駆動力を上げれば深いドリフトが速くなるのでは」という反論そのものなので、必ず含める。
  const dp = optimize(course, R, W, type, 'drift', ang, P2_BUDGET.dr, P2_BUDGET.dl, 7, scoreDeep);
  const dpt = (dp && dp.r.clean && dp.r.betaPk >= DEEP_MIN) ? dp.r.t : null;
  const gt = g.r.clean ? g.r.t : null, dt = d.r.clean ? d.r.t : null;
  const ratio = (gt && dt) ? dt / gt : null;
  const GO = ratio != null && ratio <= 0.98 && d.robust === 3;
  const f = (x) => x == null ? '  DNF' : x.toFixed(2).padStart(5);
  console.log(`${v.padEnd(8)} ${ck.padEnd(12)} ${sfx.padEnd(4)} ${String(ang).padStart(3)} ${type.padEnd(9)} | ${f(gt)} ${g.p.entry.toFixed(2)}  ${g.robust}/3 | ${f(dt)} ${d.p.entry.toFixed(2)} ${d.p.beta.toFixed(0).padStart(2)} ${String(d.p.brakeTicks).padStart(3)} ${d.p.kHold.toFixed(2)}  ${d.p.kCatch.toFixed(2)}  ${d.p.prop ? 'P' : 'T'} ${d.robust}/3 ${d.r.betaPk.toFixed(0).padStart(3)} ${d.r.arPk.toFixed(0).padStart(3)} | ${ratio != null ? ratio.toFixed(3) : '  -  '} | ${GO ? 'GO' : 'NO-GO'}`);
  table2.push({ variant: v, corner: ck, surf: sfx, ang, type,
    grip_t: gt != null ? +gt.toFixed(4) : null, grip_robust: g.robust,
    drift_t: dt != null ? +dt.toFixed(4) : null, drift_robust: d.robust,
    drift_beta: +d.p.beta.toFixed(2), drift_bpk: +d.r.betaPk.toFixed(2), drift_arPk: +d.r.arPk.toFixed(2),
    deep_t: dpt != null ? +dpt.toFixed(4) : null, deep_bpk: dp ? +dp.r.betaPk.toFixed(2) : null,
    ratio: ratio != null ? +ratio.toFixed(4) : null, verdict: GO ? 'GO' : 'NO-GO' });
  if (dp) console.log(`         └ 深さ制約(βpk≥${DEEP_MIN}°)の最良: ${dpt != null ? dpt.toFixed(2) + 's (βpk ' + dp.r.betaPk.toFixed(0) + '°' + (dt ? '・浅い最適解比 ' + (dpt / dt).toFixed(3) + '倍' : '・浅い最適解が DNF ゆえ比なし') + (gt ? '・grip 比 ' + (dpt / gt).toFixed(3) : '') + ')' : '成立せず(clean かつ βpk≥' + DEEP_MIN + '° の解が見つからない・最良 βpk ' + dp.r.betaPk.toFixed(0) + '°)'}`);
}
tP2 = lap();
applyRegime('fullscale');   // Part 2 の実行時上書きを必ず戻してから Part 3 へ

// ══════════════════════════════════════════════════════════════════════════════════════
// Part 3: 2 台走行(ブロック戦術のコスト)
//   実 buildFromSpec の stadium(直線＋ヘアピン R8・幅 7m)を **実 integrateFleetV2**(掃引 CCD＋インパルス接触・
//   車車相互作用 ON・rejoin(recover) ON)で走らせる。先頭 L と後続 F は同一車種・同一駆動力。
//   スクリプト運転手は **全知**(相手の位置・速度を直接読む)＝ ToF のみのプログラムより遥かに強い steelman。
//     L='race'   … 中心線＋レーシング速度(ブロックなし)
//     L='mirror' … 後続が 25m 以内なら後続の横位置を鏡写しに塞ぐ(実レースの「一手」規則を無視した連続ブロック)
//     L='side'   … ヘアピン内で意図的に横向き(後輪ロック→パワースライド)になり車幅で廊下を塞ぐ
//     F          … 中心線追従＋先行が 20m 以内なら空いている側へ寄って並走/追い抜き。塞がれたら減速して追従。
//   計測: 各車ラップタイム・最終順位(進行度 s の純差)・接触 tick・recover 発火・最接近距離。
// ══════════════════════════════════════════════════════════════════════════════════════
function mkStadium(surf) {
  const spec = benches.find(b => b.name === `bench-hairpin-R8-${surf}`);
  const course = buildFromSpec(spec);
  const rr = spec.rr, W = spec.width;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const w of course.walls) { minX = Math.min(minX, w.x1, w.x2); maxX = Math.max(maxX, w.x1, w.x2); minY = Math.min(minY, w.y1, w.y2); maxY = Math.max(maxY, w.y1, w.y2); }
  const outerR = rr + W / 2, capY = (minY + maxY) / 2, capXR = maxX - outerR, capXL = minX + outerR;
  const straightLen = capXR - capXL, capLen = Math.PI * rr, LAP = 2 * straightLen + 2 * capLen;
  // 中心線: s=0 を下側直線の左端から +x へ、右キャップを CCW、上側直線を −x、左キャップを CCW。
  const centerAt = (s) => {
    s = ((s % LAP) + LAP) % LAP;
    if (s < straightLen) return { x: capXL + s, y: capY - rr, th: 0, k: 0 };
    s -= straightLen;
    if (s < capLen) { const a = -Math.PI / 2 + s / rr; return { x: capXR + rr * Math.cos(a), y: capY + rr * Math.sin(a), th: a + Math.PI / 2, k: 1 / rr }; }
    s -= capLen;
    if (s < straightLen) return { x: capXR - s, y: capY + rr, th: Math.PI, k: 0 };
    s -= straightLen;
    const a = Math.PI / 2 + s / rr; return { x: capXL + rr * Math.cos(a), y: capY + rr * Math.sin(a), th: a + Math.PI / 2, k: 1 / rr };
  };
  const progressOf = (x, y) => {
    let best = 1e9, bs = 0;
    for (let s = 0; s < LAP; s += 0.5) { const c = centerAt(s); const d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < best) { best = d; bs = s; } }
    for (let s = bs - 0.5; s <= bs + 0.5; s += 0.05) { const c = centerAt(s); const d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < best) { best = d; bs = s; } }
    return ((bs % LAP) + LAP) % LAP;
  };
  const inCap = (s) => { s = ((s % LAP) + LAP) % LAP; return (s > straightLen && s < straightLen + capLen) || (s > 2 * straightLen + capLen); };
  const mu = Tn.mu0 * (spec.grip || 1), aLat = 0.75 * mu * DYN.g, aBrk = 3.5, VMAX = 32;
  const vTarget = (s, lateralR) => {   // 前方 80m の曲率から許容速度・制動距離で後退伝播
    let v = VMAX;
    for (let d = 80; d >= 0; d -= 1) { const c = centerAt(s + d); const Rl = c.k > 0 ? Math.max(1, 1 / c.k + lateralR) : 1e9; const vc = c.k > 0 ? Math.sqrt(aLat * Rl) : VMAX; v = Math.min(vc, Math.sqrt(v * v + 2 * aBrk * 1)); }
    return v;
  };
  return { course, rr, W, capY, capXL, capXR, straightLen, capLen, LAP, centerAt, progressOf, inCap, vTarget, VMAX };
}
function race(S, modeL, laps, gapM) {
  const latOf = (car, s) => { const c = S.centerAt(s); return -(car.x - c.x) * Math.sin(c.th) + (car.y - c.y) * Math.cos(c.th); };
  const steerTo = (car, s, latTarget, Ld) => {   // 純追跡操舵(3値・デューティ)＋横オフセット
    const c = S.centerAt(s + Ld), nx = -Math.sin(c.th), ny = Math.cos(c.th);
    const err = wrap(Math.atan2((c.y + ny * latTarget) - car.y, (c.x + nx * latTarget) - car.x) - car.theta);
    applySteer(car, false, err * 2.0 / CAR.maxSteer);
  };
  // FR の BRAKE は後軸ロック(モーターブレーキ)ゆえコーナー内・ターンイン直前では踏まない(リアが抜ける)。
  const speedTo = (car, vT, s) => {
    const e = vT - car.u, nearCap = S.inCap(s) || S.inCap(s + 10);
    if (e < -1.0 && !nearCap) { car.driveDir = CONST.BRAKE; car.pwm = 0; }
    else if (e < -0.3 && nearCap) { car.driveDir = CONST.FREE; car.pwm = 0; }
    else { car.driveDir = CONST.FORWARD; car.pwm = pwmFor(car, Math.min(vT, car.u + 6) + 0.3); }
  };
  const mkSlot = (x, y, th) => {
    const car = new CarV2({ ...S.course.start, x, y, theta: th }); car.type = 'normal_fr'; car.tireSet = 'normal';
    return { car, lap: new LapTracker(S.course, { persist: false }), world: { log: () => {} }, running: true, _road: null, spawn: { x, y, theta: th } };
  };
  const s0 = 5, cL = S.centerAt(s0), cF = S.centerAt(s0 - gapM);
  const L = mkSlot(cL.x, cL.y, cL.th), F = mkSlot(cF.x, cF.y, cF.th);
  const slots = [L, F];
  let contacts = 0, minGap = 1e9, prevRecL = 0, prevRecF = 0, recArms = 0;
  const lapT = { L: [], F: [] }, lapStart = { L: 0, F: 0 };
  // 【AU3 是正・敵対的レビュー C-2】進行度の基準は **spawn 位置を progressOf で実測した値**にする。
  //   旧実装(スクラッチ由来)は `sF` の初期値に生の `s0 - gapM`(= −1)を入れていた。実際の F は
  //   progressOf で s = LAP−1 = 169.25 に居るので、(a) `netAhead = lapsL·LAP+sL − (lapsF·LAP+sF)` に
  //   **−164.25 m の定数バイアス**が乗り(t=0 で L が 6m 前なのに −164.25 と出る)、(b) 次 tick で
  //   `lastSF` が 169.25 になり **F が約 1m 走っただけで lapsF++**（幻ラップ・偽の 0.2 秒ラップが
  //   平均ラップに混ざる）。どちらも基準を引くことで根治する。
  const baseL = S.progressOf(L.car.x, L.car.y), baseF = S.progressOf(F.car.x, F.car.y);
  let sL = baseL, sF = baseF, lapsL = 0, lapsF = 0, t = 0, lastSL = baseL, lastSF = baseF;
  let wrapL = 0, wrapF = 0;   // s が LAP を巻き戻った回数（走行距離の復元用）
  for (let i = 0; i < 60 * 240; i++) {
    sL = S.progressOf(L.car.x, L.car.y); sF = S.progressOf(F.car.x, F.car.y);
    // ラップは **spawn からの走行距離** で数える。s の巻き戻りだけで数えると、spawn 位置が s=0 の
    // 直前(F は s=169.25=LAP−1)にある車は **約 1m 走っただけで 1 周扱い**になる（幻ラップ。旧実装では
    // 0.2 秒の偽ラップが平均ラップへ混ざり、F の平均を 43s → 29s へ押し下げていた）。
    if (lastSL > S.LAP * 0.8 && sL < S.LAP * 0.2) wrapL++;
    if (lastSF > S.LAP * 0.8 && sF < S.LAP * 0.2) wrapF++;
    lastSL = sL; lastSF = sF;
    const travL = wrapL * S.LAP + sL - baseL, travF = wrapF * S.LAP + sF - baseF;
    const nL = Math.floor(travL / S.LAP), nF = Math.floor(travF / S.LAP);
    if (nL > lapsL) { lapsL = nL; lapT.L.push(t - lapStart.L); lapStart.L = t; }
    if (nF > lapsF) { lapsF = nF; lapT.F.push(t - lapStart.F); lapStart.F = t; }
    const dLF = ((sL - sF) % S.LAP + S.LAP) % S.LAP;   // F から見た L の前方距離(弧長)
    const latL = latOf(L.car, sL), latF = latOf(F.car, sF);
    const room = S.W / 2 - CAR.width / 2 - 0.4;
    if (modeL === 'race') { steerTo(L.car, sL, 0, 8); speedTo(L.car, S.vTarget(sL, 0), sL); }
    else if (modeL === 'mirror') {
      const tgt = (dLF < 25 && dLF > 0) ? Math.max(-room, Math.min(room, latF)) : 0;
      steerTo(L.car, sL, tgt, 8); speedTo(L.car, S.vTarget(sL, tgt), sL);
    } else {   // side / slowcap
      // 【AU3】'slowcap' = side の**準備の減速だけ**を行い、横向きにはならないアーム。
      //   横向きブロックのコストは「キャップ手前で速度を落とすこと」と「実際に横を向くこと」の
      //   2 つに分かれる。両者を分けないと『ブロックそのもののコスト』を測れない
      //   (実測: ブロックを無効化しても減速ぶんの +6.0s/周 が残り、述語が赤くならなかった)。
      if (modeL === 'side' && S.inCap(sL) && dLF < 40) {
        const sl = -beta(L.car);
        if (sl < 35) { L.car.steer = CONST.LEFT; L.car.steerAmt = null; if (L.car.u > 7) { L.car.driveDir = CONST.BRAKE; L.car.pwm = 0; } else { L.car.driveDir = CONST.FORWARD; L.car.pwm = pwmFor(L.car, Math.max(L.car.u, 1) * 1.8); } }
        else { applySteer(L.car, false, 0.06 * (45 - sl)); L.car.driveDir = CONST.FORWARD; L.car.pwm = pwmFor(L.car, Math.max(L.car.u, 1) * 1.3); }
      } else { steerTo(L.car, sL, 0, 8); speedTo(L.car, Math.min(S.vTarget(sL, 0), S.inCap(sL + 15) ? 9 : S.VMAX), sL); }
    }
    let latT = 0, vF = S.vTarget(sF, 0);
    if (dLF > 0 && dLF < 20) {
      latT = (latL >= 0 ? -1 : 1) * room;                                        // L が左寄りなら右へ
      if (dLF < 5.5 && Math.abs(latL - latF) < CAR.width + 0.5) vF = Math.min(vF, Math.max(0, L.car.u - 0.5));   // 追突回避=追従
    }
    steerTo(F.car, sF, latT, 8); speedTo(F.car, vF, sF);
    integrateFleetV2(slots, DT, S.course.walls, true, true); t += DT;
    const eL = carEdges(L.car), eF = carEdges(F.car);
    let g = 1e9;
    for (const a of eL) for (const b of eF) g = Math.min(g, distToSeg({ x: a.x1, y: a.y1 }, { x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }), distToSeg({ x: b.x1, y: b.y1 }, { x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }));
    if (g < minGap) minGap = g; if (g < 0.03) contacts++;
    if (L.car.recoverT > prevRecL + 1e-9) recArms++; if (F.car.recoverT > prevRecF + 1e-9) recArms++;
    prevRecL = L.car.recoverT; prevRecF = F.car.recoverT;
    if (lapsL >= laps && lapsF >= laps) break;
  }
  // 各車の「spawn からの走行距離」の差 = 純リード。基準を引くので初期配置のオフセットが残らない。
  const netAhead = (wrapL * S.LAP + sL - baseL) - (wrapF * S.LAP + sF - baseF);
  const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  // 【AU3 是正(v)】順位は netAhead の符号で判定する。スクラッチの `(sL−sF) mod LAP < LAP/2` は
  //   周回差があると誤る(実測: mirror で netAhead>0 なのに "F ahead" と表示していた)。
  return { lapsL, lapsF, avgL: avg(lapT.L), avgF: avg(lapT.F), contacts, recArms, minGap, netAhead, order: netAhead >= 0 ? 'L ahead' : 'F ahead', t };
}
const P3_LAPS = FULL ? 4 : 3;
const P3_SURFS = FULL ? ['dry', 'low'] : ['dry'];
console.log(`\n[Part 3] 2 台走行(実 integrateFleetV2・接触/rejoin ON)。周回数=${P3_LAPS}・初期間隔 6m。順位は netAhead の符号。`);
const table3 = [];
for (const surf of P3_SURFS) {
  const S = mkStadium(surf);
  console.log(`  stadium(直線${S.straightLen.toFixed(0)}m・R${S.rr}・幅${S.W}) surf=${surf} LAP=${S.LAP.toFixed(1)}m`);
  for (const mode of ['race', 'mirror', 'slowcap', 'side']) {
    const r = race(S, mode, P3_LAPS, 6);
    console.log(`   L=${mode.padEnd(6)} | 周回 L/F ${r.lapsL}/${r.lapsF}  平均ラップ L ${r.avgL != null ? r.avgL.toFixed(2) : '  -  '} F ${r.avgF != null ? r.avgF.toFixed(2) : '  -  '} | ${r.order} (net ${r.netAhead.toFixed(1)}m) | 接触 tick ${r.contacts} recover ${r.recArms} minGap ${r.minGap.toFixed(2)} | t=${r.t.toFixed(1)}s`);
    table3.push({ surf, mode, lapsL: r.lapsL, lapsF: r.lapsF,
      avgLapL: r.avgL != null ? +r.avgL.toFixed(4) : null, avgLapF: r.avgF != null ? +r.avgF.toFixed(4) : null,
      contacts: r.contacts, recArms: r.recArms, minGap: +r.minGap.toFixed(4), netAhead: +r.netAhead.toFixed(2), order: r.order });
  }
}

tP3 = lap();
console.log(`\n  所要: Part1 ${tP1.toFixed(1)}s ／ Part2 ${tP2.toFixed(1)}s ／ Part3 ${tP3.toFixed(1)}s`);

// ══════════════════════════════════════════════════════════════════════════════════════
// 機械アサート — PLAN AU3 の受け入れ基準 (b)(c)(d) ＋ Part 1 の主結論。
//   ※ (a')「壁付きでは grip の実走も 180°完走できない」は **`wf_ap14_wallhairpin.mjs` の AU3-1a/1b/1c** が担う
//     (壁付きを二重実装しないため)。本ゲートの対象外。
//   ※ 逆ハンの符号に対する検出力は AP14/touge の `AU1-1c`/`T1c` が担う(AU1 の変異注入で確認済)。
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[アサート]`);

// ── Part 1: 自由空間＋廊下プロキシに drift-only の窓はあるか ──────────────────────────
// 【AU3 是正・敵対的レビュー C-1】当初は `GO === 0` を主張していたが、**--full では GO=1/36** が出る
//   （最タイト R5・低μ・180°・normal_fr で、β=35 目標の滑り(βpk 27°)が grip より 11.9% 速く、
//    進入±10% でも 3/3 clean）。既定掃引が β=35/pCatch=110 を落としていたため見えていなかっただけで、
//   「窓は無い」は **偽**。∴ 述語は「窓の存在と、その窓がどこに限られるか」を測る形に置き換えた。
{
  const ratios = table1.filter(r => r.ratio != null).map(r => r.ratio);
  const minRatio = ratios.length ? Math.min(...ratios) : null;
  const goRows = table1.filter(r => r.verdict === 'GO');
  const fast = table1.filter(r => r.ratio != null && r.ratio <= 0.98);
  const tightest = P1_CORNERS[0][0];   // 掃引した中で最も小さい旋回半径のコーナー
  console.log(`  Part1: 総合時間比の最小 = ${minRatio != null ? minRatio.toFixed(3) : '--'}（GO 閾値 0.98）・比が出た行 ${ratios.length}/${table1.length}`);
  console.log(`         速さの条件(比≤0.98)を満たす行 = ${fast.length}（${fast.map(r => r.ratio.toFixed(3)).join('/') || 'なし'}）／そのうち GO(進入±10% でも 3/3 clean) = ${goRows.length}`);
  for (const r of goRows) console.log(`         GO: ${r.corner}/${r.surf}/${r.ang}°/${r.type}  grip ${r.grip_t}s → drift ${r.drift_t}s（比 ${r.ratio.toFixed(3)}）  勝ち筋の全パラメータ = entry ${r.drift_entry} / β目標 ${r.drift_beta}° / tLead ${r.drift_tLead} / pCatch ${r.drift_pCatch} / lead ${r.drift_lead} / brake ${r.drift_brakeTicks} / 舵 ${r.drift_steer} → βpk ${r.drift_bpk.toFixed(0)}°`);
  ok(table1.length === (FULL ? 36 : 8), `P1-0 Part1 のセル数 ${table1.length}（${FULL ? '系統 36' : '縮小 8'}）`);
  // 窓は存在する。そして **どこにでも開くわけではない**: 最タイト半径 × 低μ × 180° × FR に限られる。
  const confined = goRows.every(r => r.corner === tightest && r.surf === 'low' && r.ang === 180 && r.type === 'normal_fr');
  ok(goRows.length >= 1 && confined,
     `P1-1 **自由空間の drift-only 窓は存在するが、最タイト半径×低μ×180°×FR に限られる**: GO=${goRows.length}/${table1.length}（${goRows.map(r => `${r.corner}/${r.surf}/${r.ang}/${r.type}`).join(' ')}）`);
  // 速さだけでは足りない＝頑健性が実際に効いている（速い行が GO 行より多い）。
  ok(fast.length > goRows.length,
     `P1-1b **速さだけでは窓にならない**: 比≤0.98 の行 ${fast.length} に対し 進入±10% でも崩れない行は ${goRows.length}（差 ${fast.length - goRows.length} 行は単発では ${fast.length ? ((1 - Math.min(...fast.map(r => r.ratio))) * 100).toFixed(0) : '--'}% まで速いのに頑健でない）`);
  // 非空振り: 両戦略とも clean 解を持つ行が十分ある（片方が全滅なら比較になっていない）。
  ok(p1DriftClean > 0 && p1GripClean > 0 && ratios.length >= 4,
     `P1-2 非空振り: drift clean ${p1DriftClean} 件・grip clean ${p1GripClean} 件・両者が揃った行 ${ratios.length}/${table1.length}（≥4 を要求）`);
  ok(p1Reversed > 0,
     `P1-3 後退ガードの検出力: ${p1RunsAtTable} run 中 ${p1ReversedAtTable} run が u<−0.5 で打ち切られた ⇒ 持ち越し(ii)の計数は空振りしていない`);
}

// ── (b) 切替(トレイルブレーキ型)最適化 ────────────────────────────────────────────────
{
  const rows = table2.filter(r => r.ratio != null);
  const base = table2.filter(r => r.variant === 'base' && r.ratio != null);
  const baseWin = base.filter(r => r.ratio <= 0.98);
  const wins = rows.filter(r => r.ratio < 1.0);
  const winsDeep = wins.filter(r => r.drift_bpk > 15);
  const deep = rows.filter(r => r.drift_bpk > 15);
  const p2Go = table2.filter(r => r.verdict === 'GO').length;
  console.log(`  Part2: 全 ${table2.length} 行（比が出た ${rows.length}）・切替が grip より速い行 ${wins.length}・そのうち βpk>15° は ${winsDeep.length}`);
  console.log(`         ※ Part2 の 判定列(GO条件・参考) は Part1 と同じ式だが **意味が違う** — 切替型は grip に勝つのが前提なので`);
  console.log(`            GO が出ても異常ではない（実測 ${p2Go} 行）。Part2 で検査しているのは下の b1/b2/b3/b4 である。`);
  console.log(`         βpk 一覧 = ${rows.map(r => `${r.variant[0]}${r.corner.replace('hairpin-', '')}/${r.surf}/${r.ang}:${r.drift_bpk.toFixed(0)}°@${r.ratio.toFixed(2)}`).join('  ')}`);
  // (b) 前半 — 切替型は grip 最適化に勝つ。
  // 【AU3 是正・敵対的レビュー由来の実測】「base 8 行すべて」は **予算依存で偽になる**（乱択+局所改良は
  //   予算に対して単調でない。実測: 縮小予算では 8/8 が ≤0.98 だが --full では R5/low/180 が 1.005）。
  //   ∴ 「大半の行で勝つ」を下限つきで固定する（実測 縮小 8/8・--full 7/8）。
  ok(base.length >= 6 && baseWin.length >= base.length - 1,
     `AU3-b1 base 条件 ${base.length} 行中 **${baseWin.length} 行**で 切替の最良 clean ≤ grip の最良 clean×0.98（比 ${base.map(r => r.ratio.toFixed(3)).join('/')}）⇒ トレイルブレーキ型は grip 最適化に勝つ`);
  // (b) 後半 — 最適化が選んだ最良解は浅い。
  ok(wins.length > 0 && winsDeep.length === 0,
     `AU3-b2 **最適解は浅い滑り**: grip より速い ${wins.length} 行の βpk は最大 ${wins.length ? Math.max(...wins.map(r => r.drift_bpk)).toFixed(1) : '--'}°(≤15°)。βpk>15° の行 ${deep.length} 件は ${deep.length ? '比 ' + deep.map(r => r.ratio.toFixed(3)).join('/') + ' ＝ 勝てていない' : '（この掃引では出現せず）'}`);
  console.log(`         ※ b2 が言うのは「**最適解が浅い**」であって「深い滑りでは grip に勝てない」ではない`);
  console.log(`            (変異注入で確認済: 目的関数が深さを報酬すると βpk 23° で grip より 9% 速い解が見つかる)。`);
  // b3 は b1/b2 が空振りしないことの保証。**必要なのは「全行」ではなく「b1 が見る base が揃っていること」と
  //   「b2 が見る勝ち行が十分あること」**。全行要求は予算とホストに脆い（実測: 予算を 17% 落とすと 12→10 行）。
  ok(base.length === table2.filter(r => r.variant === 'base').length && wins.length >= 5,
     `AU3-b3 非空振り: base ${base.length}/${table2.filter(r => r.variant === 'base').length} 行で比が出ており（b1 の対象が欠けていない）、勝ち行 ${wins.length} 件（≥5・b2 の対象）。比が出た行は全体で ${rows.length}/${table2.length}`);
  // (b) 本体 — **深い滑りは浅い最適解より速くならない**。
  // 【AU3 是正・敵対的レビュー I-1】単に `deep_t ≥ drift_t` を問うのは **ほぼ恒等式**だった。
  //   深さ制約集合は clean 集合の部分集合で、両アームは同一シードゆえ乱択相の探索点が一致する。
  //   ∴ 乱択相終了時点で `t(deep best) ≥ t(all best)` が構造的に保証され、物理を変えても偽にならない
  //   （実測: 比較相手の予算だけ 60%落とす変異で b1/b2/b3 が赤になっても b4 は緑のままだった）。
  //   ∴ **実マージン**（何倍遅いか）に下限を課す。等号は「無制約の最適解自体が深かった」行なので除く。
  const deepRows = table2.filter(r => r.deep_t != null && r.drift_t != null);
  const noDeep = table2.filter(r => r.deep_t == null);
  const strictly = deepRows.filter(r => r.deep_t > r.drift_t);                       // 無制約の最適解が浅かった行
  const margin = deepRows.filter(r => r.deep_t >= MARGIN_MIN * r.drift_t);           // 実マージン付きで遅い行
  console.log(`  Part2 深さ制約(βpk≥${DEEP_MIN}°): 成立 ${deepRows.length} 行 / 不成立 ${noDeep.length} 行・浅い最適解比 = ${deepRows.map(r => (r.deep_t / r.drift_t).toFixed(3)).join(' / ') || '--'}`);
  console.log(`         深さ制約の解と grip の比 = ${deepRows.filter(r => r.grip_t != null).map(r => (r.deep_t / r.grip_t).toFixed(3)).join(' / ') || '--'}（1 未満なら「深くても grip には勝てる」ことになる）`);
  ok(deepRows.length >= 3 && strictly.length === deepRows.length - deepRows.filter(r => r.deep_t === r.drift_t).length
     && margin.length >= Math.ceil(deepRows.length * 0.6),
     `AU3-b4 **深い滑りは浅い最適解より速くならない（実マージン付き）**: 成立 ${deepRows.length} 行のうち ${margin.length} 行が浅い最適解の ${MARGIN_MIN} 倍以上遅い（≥${Math.ceil(deepRows.length * 0.6)} を要求）。残りは比 ${deepRows.filter(r => r.deep_t < MARGIN_MIN * r.drift_t).map(r => (r.deep_t / r.drift_t).toFixed(3)).join('/') || 'なし'}（1.000 は無制約の最適解自体が深かった行）`);
  const deepBeatsGrip = deepRows.filter(r => r.grip_t != null && r.deep_t < r.grip_t);
  ok(deepRows.length > 0,
     `AU3-b5 (記録) 深さ制約の解が grip を上回る行 = ${deepBeatsGrip.length}/${deepRows.length}（${deepBeatsGrip.map(r => `${r.variant}/${r.corner}/${r.surf}/${r.ang}:${(r.deep_t / r.grip_t).toFixed(3)}`).join(' ') || 'なし'}）⇒ 「深い滑りは grip に勝てない」とは言えない。言えるのは「最速解は浅い」(b2)＋「深い解は浅い最適解を超えない」(b4)`);
}

// ── (c) 2 台走行のブロックコスト ─────────────────────────────────────────────────────
{
  const dry = table3.filter(r => r.surf === 'dry');
  const pick = (m) => dry.find(r => r.mode === m) || null;
  const rc = pick('race'), sd = pick('side'), mr = pick('mirror'), sc = pick('slowcap');
  const lapOK = (r) => r && r.avgLapL != null;
  const f2 = (x) => x == null ? '  --  ' : x.toFixed(2);
  console.log(`  Part3(dry): 先頭平均ラップ race ${f2(rc && rc.avgLapL)}s / mirror ${f2(mr && mr.avgLapL)}s / slowcap ${f2(sc && sc.avgLapL)}s / side ${f2(sd && sd.avgLapL)}s`);
  const cost = (lapOK(sd) && lapOK(rc)) ? sd.avgLapL - rc.avgLapL : null;
  const costPrep = (lapOK(sc) && lapOK(rc)) ? sc.avgLapL - rc.avgLapL : null;
  const costTurn = (lapOK(sd) && lapOK(sc)) ? sd.avgLapL - sc.avgLapL : null;
  console.log(`         横向きブロックの総コスト ${cost != null ? '+' + cost.toFixed(2) + 's/周 (+' + (100 * cost / rc.avgLapL).toFixed(0) + '%)' : '--'}`);
  // 【AU3 是正・敵対的レビュー I-5＋自分の --full 実測】`slowcap`(同じ減速をするが横は向かない)との差を
  //   「横を向くこと自体のコスト」と名づけるのは **統制されていない**。slowcap はキャップ内の速度則が side と
  //   違い、接触 tick が side の 35 倍・recover 発火が 4.6 倍になる。実際に 3 周では +0.82s、4 周(--full)では
  //   −0.11s と **符号が反転**した。∴ 分解は主張せず、**参考値として印字するだけ**にする。
  console.log(`         参考: 減速だけのアーム(slowcap)との内訳 = 準備の減速 ${costPrep != null ? (costPrep >= 0 ? '+' : '') + costPrep.toFixed(2) : '--'}s ／ 残差 ${costTurn != null ? (costTurn >= 0 ? '+' : '') + costTurn.toFixed(2) : '--'}s`);
  console.log(`            ※ slowcap は接触/recover の条件が side と揃っていないため、残差を「横を向くこと自体のコスト」と読んではならない`);
  console.log(`            （実測: 既定 3 周で残差 +0.82s・--full 4 周で −0.11s と符号が反転する＝測定の揺れに埋もれる）`);
  ok(cost != null && cost > 0,
     `AU3-c1 **横向きブロックは自分が遅くなる**: dry の先頭平均ラップ side ${f2(sd.avgLapL)}s > race ${f2(rc.avgLapL)}s（+${cost.toFixed(2)}s/周・+${(100 * cost / rc.avgLapL).toFixed(0)}%）`);
  ok(rc != null && sd != null && rc.netAhead > 0 && sd.netAhead < 0,
     `AU3-c2 **結果として抜かれる**: race では先頭が前のまま(net ${rc ? rc.netAhead.toFixed(0) : '--'}m) / side では後続が前へ出る(net ${sd ? sd.netAhead.toFixed(0) : '--'}m)`);
  ok(rc != null && rc.lapsL >= P3_LAPS && rc.lapsF >= 2,
     `AU3-c3 非空振り: race で先頭 ${rc ? rc.lapsL : '--'} 周・後続 ${rc ? rc.lapsF : '--'} 周を実走している（≥2 周を要求＝幻ラップ 1 周では通らない）`);
}

// ── (d) 決定論 ───────────────────────────────────────────────────────────────────────
{
  const [ck, R, W] = P1_CORNERS[0];
  const c1 = buildFromSpec(benches.find(b => b.name === `bench-${ck}-dry`));
  const dprm = { prop: false, entry: 1.0, ang: 180, beta: 25, tLead: 1.0, pCatch: 30, brakeTicks: 9, lead: 0, kp: 0.06, kd: 0.002, pHold: 110, catchGain: 60 };
  const a1 = runCornerFree(c1, R, W, 'normal_fr', 'drift', dprm);
  const a2 = runCornerFree(c1, R, W, 'normal_fr', 'drift', dprm);
  ok(a1.t === a2.t && a1.clean === a2.clean && a1.betaPk === a2.betaPk,
     `AU3-d1 決定論(Part1 同一パラメータ2回 bit 一致 t=${a1.t == null ? 'DNF' : a1.t.toFixed(6)} βpk=${a1.betaPk.toFixed(6)})`);
  setVariant('base');
  const o1 = optimize(c1, R, W, 'normal_fr', 'drift', 180, 12, 8, 7);
  const o2 = optimize(c1, R, W, 'normal_fr', 'drift', 180, 12, 8, 7);
  ok(o1.sc === o2.sc && o1.p.beta === o2.p.beta && o1.robust === o2.robust,
     `AU3-d2 決定論(Part2 ランダム探索は固定シードで再現・score=${o1.sc.toFixed(6)}/${o2.sc.toFixed(6)} β=${o1.p.beta.toFixed(4)})`);
  const S = mkStadium('dry');
  const r1 = race(S, 'side', 2, 6), r2 = race(S, 'side', 2, 6);
  ok(r1.netAhead === r2.netAhead && r1.contacts === r2.contacts && r1.avgL === r2.avgL,
     `AU3-d3 決定論(Part3 同一モード2回 bit 一致 net=${r1.netAhead.toFixed(6)} 接触=${r1.contacts})`);
}

if (WANT_JSON) {
  console.log('===JSON===');
  console.log(JSON.stringify({ appVersion: APP_VERSION, gate: 'AU3-drift-reexam', sweep: FULL ? 'full' : 'reduced',
    R_min: +R_MIN.toFixed(4), p1Runs: p1RunsAtTable, p1Reversed: p1ReversedAtTable, p2Runs, p2Reversed,
    part1: table1, part2: table2, part3: table3,
    p1Go, p1Total: table1.length }, null, 0));
}

console.log(`\n[結果] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
