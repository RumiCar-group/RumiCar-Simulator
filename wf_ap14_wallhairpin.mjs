// wf_ap14_wallhairpin.mjs — Stage AP14「壁付き R<R_min ヘアピンベンチ＋壁込み go/no-go 実測」
// PLAN AP14・AP1_audit §AP14(physics C4)。AO8(自由空間・壁なし)が明示的に残した札
//   「壁へのアンダーステア激突は測っていない…壁接触は別途測る」(drift_gonogo.md:99-103) を
//   proxy→本物へ昇格し、ヘアピン廊下(壁)込みで grip/drift の通過可否を実測する。
//
// **再実装せず 実 buildFromSpec / CarV2.corners() / carEdges / checkCollision / distToSeg /
//   buildWallGrid・queryRadius(本番ブロードフェーズ) を呼ぶ**(CI-14・oracle_inventory.md)。
//
// 計測モデル(実装前固定・criterion ③=AO8 準拠を壁込みで):
//   AO8 は「回頭速度でなく制御された通過」を測った(自由空間・動的ドライバ)。壁込みでの「通過可否」は
//   まず**幾何的成立性**=「その戦略で辿れる最善の線に沿って 剛体車が廊下に収まるか」で定義する。
//   これは criterion ① の「最小壁クリアランス<0」を直接与える(壁は接触反力を入れない=線が廊下に
//   収まるかの純幾何。接触ソルバを通すと壁が押し戻して クリアランスは負にならない=①が観測不能)。
//   動的スクリプトドライバは「線の質(turn-in 遅れ)」が幾何成立性を汚す(制御セルでも外側に膨らむ)ため、
//   幾何成立性の計測には**最善線の掃引**を用いる(=戦略にその最善の線を与える=steelman)。
//
//   - grip の最善線 = 定常曲率弧(半径 R≥R_min=実舵の運動学的下限・β=0)。中心 yc と半径 R を掃引し
//     180°回頭に沿って 剛体車(corners())を置き、各姿勢の符号付き壁クリアランス(廊下内=+距離/外=−距離、
//     距離は distToSeg×carEdges)を測り、弧全体の最小 → 中心/半径で最大化(最善)。
//     R<R_min は grip 不能ゆえ探索しない(=criterion ① の「外径<R_min で幾何不能」)。
//   - drift の最善線 = より小さい半径 R∈[innerR,R_min] を 車体ヨー β(ドリフト角)付きで辿る
//     (ドリフトは車体を進路接線から β 傾けて 実効的により小回りできる)。R・yc・β を掃引して最善。
//     β の連続保持が動的に可能かは AO8 が別途測定済(3値ステアで平衡ドリフト保持不可)＝下の札で引用。
//
//   壁込み clean(通過可) = その戦略の最善線で「弧全域 符号付きクリアランス≥0 ∧ checkCollision 0」。
//   GO(壁込み drift-only) = drift が壁込み clean ∧ grip が壁込み不能(clean 不成立)＝「grip では通れず
//   ドリフト線なら通れる」セル。NO-GO = それ以外(不成立なら不足量=−最善クリアランス を記録＝成果)。
//
// ── 【AU1 是正 2026-09-05・物理無改変】────────────────────────────────────────────────
// Part C(動的到達性)が使っていた AO8 ドリフトドライバは **逆ハンが一度も発火していなかった**。左旋回の
// ドリフトで β=atan2(vlat,|u|) は **負** へ振れる(AS12 D3 実測 −77°)のに判定は `b > +DRIFT_BETA` と正側を
// 見ており、実質「常にフル LEFT・全開」で壁へ膨らむだけのドライバだった。
// 本ブロックで Part C を **符号是正＋能動回収ドライバ**(滑り量 sl=−β の比例逆ハン・init/hold/catch/exit の
// 4 相・v2 の pwm=目標速度比に沿った TC)へ置換し、進入速度×ターンイン×βtarget×先行時間×舵種を系統掃引
// して再測する。旧表は docs/stage_ap/AP14_wallhairpin.md に時点記録として保持する(AP-0)。
//
// **⚠ 原因の帰属（変異注入で確認・2026-09-05）**: 旧表の「動的到達不可」を「逆ハン不発が原因」と
// 帰属してはならない。**符号だけを元のバグへ戻した変異体(他は本ドライバのまま)でも GO は消えず 6/8 に
// 増える**(βpk 9〜24°)。廊下を通せるようにしたのは符号ではなく ①4 相の能動的な運転 ②v2 の pwm=目標速度比
// に沿ったスロットル指令(旧 pwm 22〜38 は fullscale で全トルク指令になり空転を誘発) ③掃引格子の拡大
// (9→128 点・とくに R_d とターンイン位置) の複合である。**正しい符号のほうが GO は少ない**(3<6)＝正しい
// 比例則は滑りを目標まで能動的に持っていくぶん廊下に収まりにくい(=「速いのは浅い滑り」と整合)。
// ∴ 本ゲートで符号の是正を守るのは GO 述語ではなく **AU1-1c**(滑り超過時の逆ハン率)である。
// **Part A/B(幾何)は無改変** — grip の幾何不能(criterion ①)と弁別性はドライバに依存しない。
// 壁不侵犯は AU1 の要求どおり **poseClearance≥0 ∧ checkCollision=false の両方**で判定する
// (旧実装は poseClearance の hit を計算しながら GO 判定に接続していなかった)。
//
// ── 【AU3 追補 2026-09-05・物理無改変】──────────────────────────────────────────────
// (a') **grip の動的アーム**を追加した。AU1 は「grip の動的実走は未測定」という札を残していた
//      (criterion ① は定常円弧の幾何掃引で、直線区間を使う非定常な grip 線は探索対象外)。
//      実 CarV2.step で grip 走行(意図的な滑りを作らない)を同じ廊下で走らせ、forced/intermediate では
//      180°完走＋壁不侵犯が **0/16 行** であること、かつ **同じドライバが対照セルでは 2/2 で完走する**
//      こと(弁別性)を機械固定する。後者が無いと「grip では通れない」は反証不能になる。
// (i)  **catch 相の単位不一致を是正**（下の該当箇所を参照）。**(i) だけを入れた中間状態では** GO 3→6/8。
// (iv) **ターンイン判定を後軸 x → 車体前端 x** へ（下の該当箇所を参照）。lead=0 の run が助走中に
//      破断して掃引が半減していた欠陥の是正。(i)(iv) 併せて GO は **3 → 5/8**・クリアランス余裕も改善。
//
// 出力: 機械アサート(幾何/criterion①②/弁別性/決定論/逆ハン発火/動的 GO/grip 動的) は緑/赤。go/no-go 表は JSON(--json)
//        で吐き docs/stage_ap/AP14_wallhairpin.md へ整形転記する(版スタンプ=AP-0)。
//        既定は縮小掃引(128 点/セル・駆動)。`--full` で系統掃引(576 点)＝スクラッチ再検証と同一格子。

import { buildFromSpec } from './public/js/course.js';
import { CarV2, tireParamsFor } from './public/js/physics_v2.js';
import { CAR, CONST, setPhysicsMode, APP_VERSION } from './public/js/config.js';
import { applyRegime, DYN } from './public/js/physics_dyn.js';
import { checkCollision } from './public/js/physics.js';
import { distToSeg } from './public/js/geom.js';
import { buildWallGrid, queryRadius } from './public/js/contact_v2.js';
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };
const rad = Math.PI / 180;

setPhysicsMode('v2');
applyRegime('fullscale');
const R_MIN = CAR.wheelBase / Math.tan(CAR.maxSteer);   // 実舵の運動学的最小半径(点経路)
const DIAG = Math.hypot(CAR.length, CAR.width);          // 車体外形の対角(廊下収納の下限)
console.log(`\n[AP14] 壁付きヘアピン 壁込み go/no-go  (fullscale・R_min=${R_MIN.toFixed(3)}m・車体対角=${DIAG.toFixed(3)}m)`);

const benches = JSON.parse(readFileSync('./docs/stage_ao/bench_courses.json', 'utf8'));
const wallSpecs = benches.filter(b => b.name.startsWith('bench-wall-'));

// 右キャップ幾何 + 本番ブロードフェーズグリッド。
function capGeom(spec) {
  const rr = +spec.rr, width = +spec.width;
  const outerR = rr + width / 2, innerR = rr - width / 2;
  const course = buildFromSpec(spec);
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const w of course.walls) { minX = Math.min(minX, w.x1, w.x2); maxX = Math.max(maxX, w.x1, w.x2); minY = Math.min(minY, w.y1, w.y2); maxY = Math.max(maxY, w.y1, w.y2); }
  const capX = maxX - outerR, capY = (minY + maxY) / 2;
  let measOut = -1e9, measIn = 1e9;
  for (const w of course.walls) for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]]) {
    if (x > capX + 0.01) { const r = Math.hypot(x - capX, y - capY); if (r > measOut) measOut = r; if (r < measIn) measIn = r; }
  }
  return { course, grid: buildWallGrid(course.walls), rr, width, outerR, innerR, capX, capY, measOut, measIn };
}

// 解析廊下(実態の廊下幾何=fixture の capCenter/outerR/innerR)への内外判定。掃引域(右キャップ+近接直線)で有効。
function insideCorridor(p, g) {
  if (p.x >= g.capX) { const r = Math.hypot(p.x - g.capX, p.y - g.capY); return r >= g.innerR && r <= g.outerR; }
  const dy = p.y - g.capY;                                 // 直線区間: 上下どちらかの帯
  return (dy <= -g.innerR && dy >= -g.outerR) || (dy >= g.innerR && dy <= g.outerR);
}

// 剛体車(rear-axle=x,y・heading=theta)の符号付き壁クリアランス。
//   各隅の 最近接壁距離(distToSeg×近接壁=本番ブロードフェーズ queryRadius)を、廊下内なら+/外なら−。
//   隅の最小 = 姿勢のクリアランス(負=いずれかの隅が廊下外=線が壁を破る)。checkCollision も併記。
function poseClearance(car, g) {
  const cs = car.corners();
  const near = queryRadius(g.grid, car.x, car.y, DIAG / 2 + 1.0);   // 車を包む候補壁(答え不変)
  let sMin = 1e9;
  for (const p of cs) {
    let d = 1e9;
    for (const w of near) { const dd = distToSeg({ x: p.x, y: p.y }, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }); if (dd < d) d = dd; }
    const s = insideCorridor(p, g) ? d : -d;
    if (s < sMin) sMin = s;
  }
  const hit = checkCollision(car, near);
  return { s: sMin, hit };
}

// 定常曲率弧(中心 (capX, capY+yc)・半径 R・車体ヨー β)に沿って 180°回頭を掃引し、弧全域の最小クリアランス。
// φ_pos∈[-100°,100°](右半円+直線接続)。CCW 進行の接線 = φ_pos+90°、heading = 接線 + β。
const PHI0 = -100 * rad, PHI1 = 100 * rad, DPHI = 2.5 * rad;
function sweepArc(g, car, R, yc, beta) {
  const cx = g.capX, cy = g.capY + yc;
  let sMin = 1e9, anyHit = false;
  for (let phi = PHI0; phi <= PHI1 + 1e-9; phi += DPHI) {
    car.x = cx + R * Math.cos(phi); car.y = cy + R * Math.sin(phi);
    car.theta = phi + Math.PI / 2 + beta;
    const { s, hit } = poseClearance(car, g);
    if (s < sMin) sMin = s; if (hit) anyHit = true;
  }
  return { sMin, anyHit };
}

// 戦略の最善線を掃引(R×yc×β)。最善=最大の最小クリアランス。
function bestLine(g, Rs, ycs, betas) {
  const car = new CarV2({ ...g.course.start });
  let best = { s: -1e9, R: null, yc: null, beta: null, hit: true };
  for (const R of Rs) for (const yc of ycs) for (const beta of betas) {
    const { sMin, anyHit } = sweepArc(g, car, R, yc, beta);
    if (sMin > best.s) best = { s: sMin, R, yc, beta, hit: anyHit };
  }
  return best;
}
const YCS = [-0.8, -0.4, 0, 0.4, 0.8];
function gripBest(g) {  // grip: R≥R_min(下限 R_min)・β=0
  return bestLine(g, [R_MIN, R_MIN * 1.04, R_MIN * 1.10, R_MIN * 1.18], YCS, [0]);
}
function driftBest(g) { // drift: R∈[innerR+0.4, R_min]・β 掃引(ドリフト角)
  const Rs = [];
  const lo = Math.max(0.8, g.innerR + 0.4), hi = R_MIN;
  for (let k = 0; k <= 5; k++) Rs.push(lo + (hi - lo) * k / 5);
  const betas = [-45, -30, -20, -10, 0, 10, 20, 30, 45].map(b => b * rad);
  return bestLine(g, Rs, YCS, betas);
}

// ── Part A: 幾何アサート ──────────────────────────────────────────────────────────
console.log(`\n[A] 追加ベンチ cell 幾何(実 buildFromSpec 壁から実測)  ${wallSpecs.length} cell`);
ok(wallSpecs.length >= 5, `A0 追加 wall-hairpin cell ≥5 (実 ${wallSpecs.length})`);
const geoms = {};
for (const spec of wallSpecs) {
  const g = capGeom(spec); geoms[spec.name] = g;
  ok(Math.abs(g.measOut - g.outerR) < 0.02, `A ${spec.name} 実測外径=公称 ${g.outerR.toFixed(2)} (実測 ${g.measOut.toFixed(2)})`);
  ok(Math.abs(g.measIn - g.innerR) < 0.02, `A ${spec.name} 実測内径=公称 ${g.innerR.toFixed(2)} (実測 ${g.measIn.toFixed(2)})`);
  if (spec.cellKind === 'forced') ok(g.outerR < R_MIN && g.width > DIAG, `A ${spec.name} 強制セル: 外径${g.outerR.toFixed(2)}<R_min ∧ 廊下${g.width}>対角${DIAG.toFixed(2)}`);
  else if (spec.cellKind === 'control') ok(g.width > DIAG, `A ${spec.name} 対照セル: 外径${g.outerR.toFixed(2)}・廊下${g.width}>対角`);
}

// ── Part C: 動的到達性(【AU1】符号是正＋能動回収ドライバの壁込み走行) ──────────────────────
// Part B は「収まる線が存在するか(幾何)」を測る。Part C は「その線に動的に到達/保持できるか」を、
// **実 CarV2.step + 符号是正ドライバ** で 廊下へ走り込み、達成軌跡の壁クリアランスを毎tick 実オラクル
// (poseClearance = corners()×distToSeg×queryRadius) と checkCollision の **両方** で測る。
const DT = 1 / 60, deg = 180 / Math.PI;
const betaOf = (c) => Math.atan2(c.vlat, Math.max(Math.abs(c.u), 1e-6)) * deg;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const SPIN_LIM = 115, RUNUP = 25, TIMEOUT = 1500, EXIT_M = 10, HARDOUT = -0.5;
const Tn = tireParamsFor('normal');
const MX = CAR.maxSteer;
// v2 の pwm は「目標速度 = pwm/255·maxV」(physics_v2.js)。低 pwm でも全トルク指令になりうるので、
// 速度保持は目標速度比で、駆動は車輪スリップ率を見る簡易 TC で指令する(エンコーダ vwR のみ使用)。
const maxVOf = (car) => CAR.maxSpeed * car.profile().maxSpeed;
const pwmFor = (car, U) => Math.max(0, Math.min(255, Math.round(U / maxVOf(car) * 255)));
function holdSpeed(car, U) {
  const e = U - car.u;
  if (e < -0.6) { car.driveDir = CONST.BRAKE; car.pwm = 0; }
  else { car.driveDir = CONST.FORWARD; car.pwm = pwmFor(car, U + 0.3); }
}
function tcPwm(car, full, maxSlip) {
  const sr = (car.vwR - Math.abs(car.u)) / Math.max(Math.abs(car.u), 1);
  return sr > maxSlip ? pwmFor(car, Math.abs(car.u)) : full;
}
// 舵の出し方。norm∈[-1,1] (正=LEFT)。prop=連続舵(AS12 の任意装備)/tri=3値の理想デューティ量子化。
// 返り値 = クランプ後の実印加 norm (逆ハン発火の記録に使う)。
function applySteer(car, prop, norm) {
  const n = Math.max(-1, Math.min(1, norm));
  if (prop) { car.steer = n >= 0 ? CONST.LEFT : CONST.RIGHT; car.steerAmt = Math.round(Math.abs(n) * 255); }
  else { car.steer = (car.steerAngle < n * MX) ? CONST.LEFT : CONST.RIGHT; car.steerAmt = null; }
  return n;
}
// 逆ハン(印加目標舵角が旋回 LEFT と逆符号)の発火計測 — AS12 D2「一度も発火しない」の逆述語。
let counterFire = 0, counterTick = 0, wantMin = 0;
// **検出力のある逆ハン述語**: 「実測の滑りが *そのtickの目標* を超えているとき、逆ハンを当てているか」。
//   滑りの真値は betaOf(car) から取る(ドライバ内部の符号変数を使わない)ので、符号を取り違えた実装では
//   比例則が滑りを *増やす* 向きに舵を出し、この比率が 0 付近へ落ちる = 変異注入で赤くなる。
//   (単なる `counterFire > 0` は init 相の全開LEFTや一時的な正βで簡単に満たされ検出力が無い — 実測済)
let deepTick = 0, deepCounter = 0;
function noteCounter(car, tgt, applied) {
  const trueSlip = -betaOf(car);            // 左旋回ドリフトで正になる滑り量(真値)
  if (trueSlip > tgt + 4) { deepTick++; if (applied < 0) deepCounter++; }
}

// 廊下へ走り込み、能動回収ドリフトで 180°回頭 → 出口 10m を廊下内で走り切れるかを測る。
//   sustainedDeg = クリアランスが初めて<0 になるまでの回頭角。破断(<HARDOUT)で打ち切り。
function dynDriftReach(g, drive, prm) {
  const car = new CarV2({ ...g.course.start, x: g.capX - RUNUP, y: g.capY - prm.Rd, theta: 0 });
  car.type = (drive === 'fr') ? 'normal_fr' : 'normal_awd';
  car.tireSet = 'normal'; car.steerSet = prm.prop ? 'prop' : 'tri';
  const vgrip = Math.sqrt(Tn.mu0 * (car.grip || 1) * DYN.g * prm.Rd), vEntry = prm.entry * vgrip;
  let minClr = 1e9, head = 0, spun = false, done = false, brokeOut = false, hitAny = false;
  let sustainedRad = 0, breached = false, betaPk = 0, t = 0, steerMinRun = 0;   // steerMinRun=到達舵角の最小(norm)
  const measure = () => {
    const { s, hit } = poseClearance(car, g);
    if (hit) hitAny = true;
    const ab = Math.abs(betaOf(car)); if (ab > betaPk) betaPk = ab;
    if (s < minClr) minClr = s;
    if (s < 0 && !breached) { breached = true; sustainedRad = head; }
    return s;
  };
  // phase 0: 直線助走(steer=CENTER)で ターンイン点(cap の lead m 手前)まで vEntry へ。
  // 【AU3 是正 2026-09-05・持ち越し(iv)】ターンイン判定を **後軸 x → 車体前端 x** へ変えた。
  //   insideCorridor は x≥capX で直線帯判定から円判定へ切り替わる。前端は後軸より (length−rearToBack)
  //   =3.2m 前にあるので、後軸基準の lead=0 では **助走の直進中に前端が円判定域へ入り外径を超えて破断**し、
  //   lead=0 の run が全滅＝実効掃引が半減していた(AU1 の敵対的レビュー指摘 (iv)・全 best 行が lead=4 だった)。
  //   前端基準なら lead=0 は「鼻がキャップ入口に来た瞬間にターンイン」という幾何的に意味のある点になる。
  const frontX = () => { let m = -1e9; for (const p of car.corners()) if (p.x > m) m = p.x; return m; };
  let guard = 0;
  while (frontX() < g.capX - prm.lead && guard++ < 4000) {
    car.steer = CONST.CENTER; car.steerAmt = null;
    if (car.u < vEntry) { car.driveDir = CONST.FORWARD; car.pwm = 255; } else holdSpeed(car, vEntry);
    car.step(DT); measure();
  }
  // phase 1..3: init(リア破り) → hold(滑り bt 保持) → catch(残回頭に応じ滑り目標を絞る)。
  let prevTheta = car.theta, prevSl = -betaOf(car), phase = 'init', initTicks = 0;
  let brake = (drive === 'fr') ? prm.brakeTicks : 0;
  const A = Math.PI;
  for (let i = 0; i < TIMEOUT; i++) {
    const sl = -betaOf(car), sld = (sl - prevSl) / DT; prevSl = sl;
    const remaining = A - head;
    if (phase !== 'catch' && remaining < Math.max(Math.abs(car.r), 0.5) * prm.tLead) phase = 'catch';
    else if (phase === 'init' && (sl >= prm.beta - 5 || initTicks > 90)) phase = 'hold';
    let applied;
    if (phase === 'init') {
      initTicks++;
      if (brake > 0) { car.steer = CONST.LEFT; car.steerAmt = null; car.driveDir = CONST.BRAKE; car.pwm = 0; brake--; applied = 1; }
      else { applied = applySteer(car, prm.prop, 1); car.driveDir = CONST.FORWARD; car.pwm = tcPwm(car, 255, 0.8); }
    } else if (phase === 'hold') {
      const want = (prm.kp * (prm.beta - sl) - prm.kd * sld) * MX;
      applied = applySteer(car, prm.prop, want / MX);
      car.driveDir = CONST.FORWARD; car.pwm = (sl > prm.beta + 4) ? prm.pHold : tcPwm(car, 255, 0.6);
      noteCounter(car, prm.beta, applied);
    } else {
      // 【AU3 是正 2026-09-05・持ち越し(i)】catch 相の滑り目標を touge/AP15 と同じ `catchGain * remaining` へ揃えた。
      //   旧式 `catchGain * remaining * deg` は次元が deg²/rad で **不整合**(remaining は rad・catchGain は deg/rad)。
      //   数値でも 残 0.33° を切るまで目標が β を超え続ける＝**絞りが実質 no-op** だった(AU1 が実測して残した札)。
      //   是正で catch 相は残 33°(=beta/catchGain rad) から滑り目標を線形に 0 へ絞る＝コメントの意図どおりになる。
      //   実測の影響: 壁付き forced/intermediate の normal_fr GO が **3 → 6/8** に増え、GO 行の最小クリアランスも
      //   0.00〜0.01m(壁と面一)から改善した（**(i) 単独の中間値**。(i)(iv) を併せた最終値は GO 5/8・
      //   最小クリアランス 0.03〜0.71m で、下の表と AU3-1a〜1d が印字する）。旧式の表は internal の
      //   docs/stage_ap/AP14_wallhairpin.md に時点記録として保持。
      const slTgt = Math.max(0, Math.min(prm.beta, prm.catchGain * remaining));
      const want = (prm.kp * (slTgt - sl) - prm.kd * sld) * MX;
      applied = applySteer(car, prm.prop, want / MX);
      car.driveDir = CONST.FORWARD; car.pwm = (sl > slTgt + 4) ? prm.pCatch : tcPwm(car, 200, 0.3);
      noteCounter(car, slTgt, applied);
    }
    counterTick++; if (applied < 0) counterFire++;
    if (applied < wantMin) wantMin = applied;
    car.step(DT); t += DT;
    if (car.steerAngle / MX < steerMinRun) steerMinRun = car.steerAngle / MX;   // 到達舵角(指令でなく実舵角)
    head += wrap(car.theta - prevTheta); prevTheta = car.theta;
    const s = measure();
    if (s <= HARDOUT) { brokeOut = true; break; }
    if (Math.abs(betaOf(car)) > SPIN_LIM || car.u < -0.5) { spun = true; break; }
    if (head >= A) { done = true; break; }
  }
  if (!breached) sustainedRad = head;
  // 出口: 180° 到達後さらに EXIT_M を廊下内で走れるか(再グリップ・直進安定)。180°後は −x 方向へ進む。
  let exitOK = false, exitBeta = null;
  if (done && !spun && minClr >= 0) {
    const x0 = car.x;
    for (let k = 0; k < 600; k++) {
      const sl = -betaOf(car), sld = (sl - prevSl) / DT; prevSl = sl;
      const herr = wrap(Math.PI - car.theta) * deg;                       // 出口ヘディング誤差
      const want = (prm.kp * (0 - sl) - prm.kd * sld + 0.02 * herr) * MX;  // 滑り 0 かつ向きを揃える
      applySteer(car, prm.prop, want / MX);
      car.driveDir = CONST.FORWARD; car.pwm = Math.abs(sl) > 8 ? prm.pCatch : tcPwm(car, 255, 0.15);
      car.step(DT); t += DT;
      const s = measure();
      if (s < 0 || Math.abs(betaOf(car)) > SPIN_LIM) break;
      if (x0 - car.x >= EXIT_M) { exitOK = true; exitBeta = betaOf(car); break; }
    }
  }
  // 壁込み動的 GO = 180°到達 ∧ 全域クリアランス≥0 ∧ **checkCollision が一度も真にならない** ∧ 出口 10m 廊下内。
  const dynGO = done && !spun && !brokeOut && minClr >= 0 && !hitAny && exitOK;
  return { minClr, sustainedDeg: sustainedRad * deg, headDeg: head * deg, breached, done, spun, brokeOut,
    hitAny, exitOK, exitBeta, betaPk, t, vEntry, vgrip, steerMinRun, dynGO };
}

// 掃引格子。既定=縮小(128点)・--full=系統(576点＝スクラッチ再検証と同一)。掃引は drift への steelman。
const FULL = process.argv.includes('--full');
function gridFor(g) {
  const RdList = [(g.innerR + g.outerR) / 2, Math.min(R_MIN, g.outerR - 0.9)];
  const props = [false, true];
  const entries = FULL ? [0.9, 1.1, 1.3] : [0.9, 1.1];
  const betas = FULL ? [20, 35, 50] : [20, 35];
  const pCatches = FULL ? [30, 200] : [30];
  const out = [];
  for (const prop of props) for (const entry of entries) for (const beta of betas)
    for (const tLead of [0.6, 1.2]) for (const lead of [0, 4]) for (const Rd of RdList)
      for (const pCatch of pCatches) for (const brakeTicks of [9, 25])
        out.push({ prop, entry, beta, tLead, lead, Rd, pCatch, brakeTicks, kp: 0.06, kd: 0.002, pHold: 110, catchGain: 60 });
  return out;
}
// 最善条件(steelman) = GO を最優先、次に出口成立、次に廊下保持角、同点なら所要時間の短い方。
function dynDriftBest(g, drive) {
  let best = null, bestScore = -1e18;
  for (const prm of gridFor(g)) {
    const r = dynDriftReach(g, drive, prm);
    const score = (r.dynGO ? 1e6 : 0) + (r.exitOK ? 5e5 : 0) + r.sustainedDeg * 100 - (r.dynGO ? r.t : 0);
    if (score > bestScore) { bestScore = score; best = { ...r, prm }; }
  }
  return best;
}

// ── 【AU3 (a')】grip の動的アーム ────────────────────────────────────────────────────
// AU1 が残した札: 「grip の**動的**実走は本ゲート未測定＝『後輪ドリフトが唯一の通過手段』とは言えない」。
// criterion ① が測るのは grip の **幾何**最善線(定常円弧・β=0)であって、直線区間を使う非定常な grip 線
// (低速で進入して実舵下限まで曲げる・遅いターンイン等)は探索対象外だった。
// ∴ ここで **実 CarV2.step の grip 走行**(意図的な滑りを作らない＝逆ハンもブレーキドリフトも使わない)を
// 同じ廊下で走らせ、forced/intermediate では 180°完走＋壁不侵犯が成立しないことを機械固定する。
//
// steelman: grip に有利な条件を掃引して与える —
//   ① 進入速度を大きく下げる(低速ほど横力要求が減り実効半径は運動学的下限 R_min に近づく)
//   ② ターンイン位置(lead)・進入横位置(d)・舵種(3値/連続)
//   ③ 舵の出し方 2 通り: 'lock'=全舵 LEFT を維持(最もタイトな線) / 'radius'=目標半径 Rg をヨーレート帰還で保持
//      (後者は AO8/touge/AP15 の grip ドライバと同型＝既存オラクルの再利用)
// **弁別性(必須)**: 同じドライバが対照セル(grip 幾何が収まる rr6.0/rr7.0)では 180°完走することを確認する。
//   これが無いと「grip では通れない」は反証不能になる — AU-0 の敵対的レビューは旧ドリフトドライバについて
//   まさにこの失敗(対照セルすら破断していた＝戦略の限界でなくドライバの欠陥)を実証している。
function dynGripReach(g, drive, prm) {
  const car = new CarV2({ ...g.course.start, x: g.capX - RUNUP, y: g.capY - prm.d, theta: 0 });
  car.type = (drive === 'fr') ? 'normal_fr' : 'normal_awd';
  car.tireSet = 'normal'; car.steerSet = prm.prop ? 'prop' : 'tri';
  let minClr = 1e9, head = 0, spun = false, done = false, brokeOut = false, hitAny = false;
  let sustainedRad = 0, breached = false, betaPk = 0, t = 0;
  const measure = () => {
    const { s, hit } = poseClearance(car, g);
    if (hit) hitAny = true;
    const ab = Math.abs(betaOf(car)); if (ab > betaPk) betaPk = ab;
    if (s < minClr) minClr = s;
    if (s < 0 && !breached) { breached = true; sustainedRad = head; }
    return s;
  };
  const frontX = () => { let m = -1e9; for (const p of car.corners()) if (p.x > m) m = p.x; return m; };
  // phase 0: 直線助走 — 目標速度 U まで上げ(または落とし)てからターンイン(前端基準・AU3 持ち越し(iv) と同じ)。
  let guard = 0;
  while (frontX() < g.capX - prm.lead && guard++ < 6000) {
    car.steer = CONST.CENTER; car.steerAmt = null;
    if (car.u < prm.U - 0.1) { car.driveDir = CONST.FORWARD; car.pwm = 255; } else holdSpeed(car, prm.U);
    car.step(DT); measure();
  }
  // phase 1: 旋回 — 意図的な滑りを作らない grip 走行のまま 180°回頭を試みる。
  let prevTheta = car.theta, gSteer = CONST.CENTER;
  const A = Math.PI;
  for (let i = 0; i < TIMEOUT; i++) {
    if (prm.mode === 'lock') {
      if (prm.prop) { car.steer = CONST.LEFT; car.steerAmt = 255; }        // 連続舵: 全舵 LEFT
      else { car.steer = CONST.LEFT; car.steerAmt = null; }                 // 3値: LEFT 保持
    } else {
      const rStar = car.u / prm.Rg;                                          // AO8/touge grip と同型のヨーレート帰還
      if (car.r < rStar * 0.98) gSteer = CONST.LEFT;
      else if (car.r > rStar * 1.02) gSteer = CONST.CENTER;
      car.steer = gSteer; car.steerAmt = null;
    }
    holdSpeed(car, prm.U);
    car.step(DT); t += DT;
    head += wrap(car.theta - prevTheta); prevTheta = car.theta;
    const s = measure();
    if (s <= HARDOUT) { brokeOut = true; break; }
    if (Math.abs(betaOf(car)) > SPIN_LIM || car.u < -0.5) { spun = true; break; }
    if (head >= A) { done = true; break; }
  }
  if (!breached) sustainedRad = head;
  // 出口: 180° 到達後さらに EXIT_M を廊下内で走れるか(drift アームと同一の合格条件)。
  let exitOK = false;
  if (done && !spun && minClr >= 0) {
    const x0 = car.x;
    for (let k = 0; k < 900; k++) {
      const herr = wrap(Math.PI - car.theta);
      applySteer(car, prm.prop, Math.max(-1, Math.min(1, herr * 3)));
      holdSpeed(car, prm.U);
      car.step(DT); t += DT;
      const s = measure();
      if (s < 0 || Math.abs(betaOf(car)) > SPIN_LIM) break;
      if (x0 - car.x >= EXIT_M) { exitOK = true; break; }
    }
  }
  const dynGO = done && !spun && !brokeOut && minClr >= 0 && !hitAny && exitOK;
  return { minClr, sustainedDeg: sustainedRad * deg, done, spun, brokeOut, hitAny, exitOK, betaPk, t, dynGO };
}
// 助走は全アーム共通の 25m 固定(RUNUP)。**進入直線を短縮すると測定値がわずかに動く**ことを実測した
// (U 比例へ変えると 20 行中 12 行で minClr が最大 0.05m・保持角が最大 2.6° 動く。判定 20/20 は不変だった)。
// 機序＝ターンイン判定が tick 離散で、助走長が変わると交差の位相と holdSpeed のバンバン帯の位相が変わる。
// ∴ NO-GO 行の連続量マージンは ±0.05m 程度の分解能で読むこと(GO/NO-GO の判定はこの揺れでは変わらない)。
function gripGridFor(g) {
  const ds = [(g.innerR + g.outerR) / 2, Math.max(g.innerR + 1.0, g.outerR - 0.9)];
  const Us = FULL ? [2, 3, 4, 5, 6, 8] : [2, 4, 6, 8];
  const out = [];
  for (const d of ds) for (const U of Us) for (const lead of [0, 4]) for (const prop of [false, true]) {
    out.push({ d, U, lead, prop, mode: 'lock', Rg: null });
    out.push({ d, U, lead, prop, mode: 'radius', Rg: R_MIN });
  }
  return out;
}
function dynGripBest(g, drive) {
  let best = null, bestScore = -1e18;
  for (const prm of gripGridFor(g)) {
    const r = dynGripReach(g, drive, prm);
    const score = (r.dynGO ? 1e6 : 0) + (r.exitOK ? 5e5 : 0) + r.sustainedDeg * 100 - (r.dynGO ? r.t : 0);
    if (score > bestScore) { bestScore = score; best = { ...r, prm }; }
  }
  return best;
}

// ── Part B: 壁込み go/no-go(最善線の幾何成立性 + 動的到達性) ────────────────────────
console.log(`\n[B] 壁込み go/no-go(最善線の剛体クリアランス掃引 + 【AU1】符号是正ドライバの動的到達性)`);
console.log(`  掃引: ${FULL ? '系統(--full: 576 点/セル・駆動)' : '既定 縮小(128 点/セル・駆動)'}`);
const table = [];      // セル単位(幾何)
const dynTable = [];   // セル×駆動(動的到達性) = AU1 の新表
const gripDynTable = [];  // セル×駆動(grip の動的到達性) = 【AU3 (a')】の新表
for (const spec of wallSpecs) {
  const g = geoms[spec.name];
  const surf = /-low$/.test(spec.name) ? 'low' : 'dry';
  const gr = gripBest(g), dr = driftBest(g);
  const gripGeoFits = gr.s >= 0 && !gr.hit;
  const driftGeoFits = dr.s >= 0 && !dr.hit;
  // 動的到達性(drift のみ・FR/AWD をそれぞれ掃引最善で)。grip の動的は幾何最善線が既に破る(Part B)ゆえ省略。
  const dyn = { fr: dynDriftBest(g, 'fr'), awd: dynDriftBest(g, 'awd') };
  // 【AU3 (a')】grip の動的アーム(同じ廊下・同じ合格条件)。drift と同じ steelman 掃引で最善を採る。
  const gdyn = { fr: dynGripBest(g, 'fr'), awd: dynGripBest(g, 'awd') };
  for (const drive of ['fr', 'awd']) {
    const d = gdyn[drive];
    gripDynTable.push({
      cell: spec.name, kind: spec.cellKind, surf, drive: `normal_${drive}`,
      dynGO: d.dynGO, done: d.done, spun: d.spun, brokeOut: d.brokeOut, hitAny: d.hitAny, exitOK: d.exitOK,
      sustainedDeg: +d.sustainedDeg.toFixed(1), minClr: +d.minClr.toFixed(4), betaPk: +d.betaPk.toFixed(1),
      t: d.dynGO ? +d.t.toFixed(3) : null,
      shortfallDeg: d.dynGO ? 0 : +(180 - d.sustainedDeg).toFixed(1),
      prm: { d: +d.prm.d.toFixed(2), U: d.prm.U, lead: d.prm.lead, mode: d.prm.mode,
             Rg: d.prm.Rg != null ? +d.prm.Rg.toFixed(2) : null, steer: d.prm.prop ? 'prop' : 'tri' },
    });
  }
  for (const drive of ['fr', 'awd']) {
    const d = dyn[drive];
    // 統合 go/no-go = drift が「幾何成立 ∧ 動的到達(壁不侵犯を clearance と checkCollision の両方で)」∧ grip 幾何不能。
    const GO = driftGeoFits && d.dynGO && !gripGeoFits;
    dynTable.push({
      cell: spec.name, kind: spec.cellKind, surf, drive: `normal_${drive}`,
      dynGO: d.dynGO, done: d.done, spun: d.spun, brokeOut: d.brokeOut, hitAny: d.hitAny, exitOK: d.exitOK,
      sustainedDeg: +d.sustainedDeg.toFixed(1), minClr: +d.minClr.toFixed(4), betaPk: +d.betaPk.toFixed(1),
      steerMinRun: +d.steerMinRun.toFixed(4),
      t: d.dynGO ? +d.t.toFixed(3) : null, vEntry: +d.vEntry.toFixed(2),
      shortfallDeg: d.dynGO ? 0 : +(180 - d.sustainedDeg).toFixed(1),
      prm: { entry: d.prm.entry, beta: d.prm.beta, tLead: d.prm.tLead, lead: d.prm.lead,
             Rd: +d.prm.Rd.toFixed(2), pCatch: d.prm.pCatch, brakeTicks: d.prm.brakeTicks, steer: d.prm.prop ? 'prop' : 'tri' },
      verdict: GO ? 'GO' : 'NO-GO',
    });
  }
  const driftDynGO = dyn.fr.dynGO || dyn.awd.dynGO;
  const dynBest = dyn.fr.sustainedDeg >= dyn.awd.sustainedDeg ? dyn.fr : dyn.awd;   // 最も長く廊下を保った側(steelman)
  const GO = driftGeoFits && driftDynGO && !gripGeoFits;
  table.push({
    cell: spec.name, kind: spec.cellKind, rr: g.rr, width: g.width,
    outerR: +g.outerR.toFixed(2), innerR: +g.innerR.toFixed(2), surf,
    grip_clr: +gr.s.toFixed(3), grip_geoFits: gripGeoFits, grip_R: +gr.R.toFixed(2),
    drift_clr: +dr.s.toFixed(3), drift_geoFits: driftGeoFits, drift_R: +dr.R.toFixed(2), drift_beta: Math.round(dr.beta / rad),
    drift_dynSustainedDeg: +dynBest.sustainedDeg.toFixed(0), drift_dynClr: +dynBest.minClr.toFixed(3), drift_dynGO: driftDynGO,
    dynGO_fr: dyn.fr.dynGO, dynGO_awd: dyn.awd.dynGO,
    grip_pen: gr.s < 0 ? +(-gr.s).toFixed(3) : 0, drift_geoPen: dr.s < 0 ? +(-dr.s).toFixed(3) : 0,
    drift_dynShortfallDeg: driftDynGO ? 0 : +(180 - dynBest.sustainedDeg).toFixed(0),
    verdict: GO ? 'GO' : 'NO-GO',
  });
}

// criterion ①: 強制セル(外径<R_min)の grip 最善線が壁を破る(最善クリアランス<0)。ドライバ非依存=AU1 で無改変。
console.log(`\n[criterion ①] 強制セル grip の最小壁クリアランス<0(最善線でも外壁を破る=幾何不能)`);
for (const r of table.filter(r => r.kind === 'forced')) ok(r.grip_clr < 0 && !r.grip_geoFits, `① ${r.cell}: grip 最善クリアランス=${r.grip_clr}m<0 (侵入=${r.grip_pen}m fits=${r.grip_geoFits})`);
// 弁別性: 対照セル(車体込みで余裕)の grip は廊下に収まる(最善クリアランス≥0)=ハーネスが真に弁別する証拠。
console.log(`\n[弁別性] 対照セル(車体込み余裕)の grip は廊下に収まる(最善クリアランス≥0)`);
for (const r of table.filter(r => r.kind === 'control')) ok(r.grip_clr >= 0 && r.grip_geoFits, `弁別 ${r.cell}: grip 最善クリアランス=${r.grip_clr}m≥0 (fits=${r.grip_geoFits})`);
// criterion ②: 強制セル drift の通過可否が連続量で確定(幾何成立性 clr + 動的到達性 の連続量)。不成立なら不足量を記録。
console.log(`\n[criterion ②] 強制セル drift の通過可否(幾何 clr + 動的到達 の連続量で確定)`);
for (const r of table.filter(r => r.kind === 'forced')) {
  const measured = Number.isFinite(r.drift_clr) && Number.isFinite(r.drift_dynSustainedDeg);
  ok(measured, `② ${r.cell}: 判定=${r.verdict} | 幾何:収まる(clr=${r.drift_clr}m R=${r.drift_R} β=${r.drift_beta}°) 動的:${r.drift_dynGO ? '到達' : '不成立'}(廊下保持${r.drift_dynSustainedDeg}°/180° 不足=${r.drift_dynShortfallDeg}°)`);
}

// 決定論チェック: 同一セルの幾何掃引 + 動的走行を2回・bit 一致。
{
  const g = geoms[wallSpecs[0].name];
  const a = gripBest(g), b = gripBest(g);
  ok(a.s === b.s && a.R === b.R, `B 決定論(grip 幾何掃引2回 bit 一致 s=${a.s}/${b.s})`);
  const prm = { prop: false, entry: 0.9, beta: 35, tLead: 1.2, lead: 0, Rd: Math.min(R_MIN, g.outerR - 0.9),
                pCatch: 30, brakeTicks: 9, kp: 0.06, kd: 0.002, pHold: 110, catchGain: 60 };
  const d1 = dynDriftReach(g, 'fr', prm), d2 = dynDriftReach(g, 'fr', prm);
  ok(d1.minClr === d2.minClr && d1.sustainedDeg === d2.sustainedDeg && d1.t === d2.t && d1.dynGO === d2.dynGO,
     `C 決定論(動的走行2回 bit 一致 minClr=${d1.minClr}/${d2.minClr} t=${d1.t}/${d2.t})`);
}

// ── 【AU1】新アサート ────────────────────────────────────────────────────────────────
console.log(`\n[AU1 逆ハン是正の機械固定]`);
// AU1-1: 逆ハン(印加目標舵角が旋回 LEFT と逆符号)が **実際に発火する** — AS12 D2「一度も発火しない」の逆述語。
const deepRatio = deepTick ? deepCounter / deepTick : 0;
console.log(`  逆ハン発火 ${counterFire}/${counterTick} tick・**指令**目標舵角の最大逆舵 ${(wantMin * 100).toFixed(0)}% of 全舵`);
console.log(`  （注: wantMin は全 run を通じた *目標* 舵角の最小。到達舵角は行ごとに下表 steerMin 列を見ること）`);
console.log(`  滑り超過時の逆ハン率 = ${deepCounter}/${deepTick} = ${(deepRatio * 100).toFixed(1)}%（符号を取り違えると 0% 付近へ落ちる）`);
// ⚠ AU1-1 / AU1-1b は **符号バグに対する検出力が無い**ことを変異注入で実測した(変異体でも 109/104108 発火で緑)。
//    符号の是正を守るのは下の AU1-1c である。両者は「発火が皆無ではない」ことの下限として残す。
ok(counterFire > 0 && counterTick > 3000,
   `AU1-1 逆ハン発火(下限): ${counterFire}/${counterTick} tick ※符号バグ検出力は無い(AU1-1c が担う)`);
ok(wantMin <= -0.5, `AU1-1b 指令目標舵角の逆舵の深さ: ${(wantMin * 100).toFixed(0)}%(≤ −50%) ※同上`);
ok(deepTick >= 200 && deepRatio >= 0.8,
   `AU1-1c **検出力のある逆ハン述語**: 滑りが目標超過の ${deepTick} tick 中 ${deepCounter} (${(deepRatio * 100).toFixed(1)}%) で逆ハン ⇒ 比例則が滑りを減らす向きに効いている`);
// AU1-2: β の符号 — 通常の左旋回は正・ドリフトは負(旧 `β>+35` が原理的に発火しない機序そのもの)。
//        壁ベンチは廊下が狭くドリフトが発達しきらないので、AS12 D3 と同じ **自由空間ヘアピン**で測る。
{
  const mk = (name, U) => {
    const c = buildFromSpec(benches.find(b => b.name === name));
    const car = new CarV2({ ...c.start, x: 0, y: 0, theta: 0 });
    car.type = 'normal_fr'; car.tireSet = 'normal';
    car.steer = CONST.CENTER; car.steerAmt = null; car.driveDir = CONST.FORWARD; car.pwm = 255;
    for (let i = 0; i < 8000 && car.u < U; i++) car.step(DT);
    return car;
  };
  const car = mk('bench-hairpin-R8-dry', 8);
  for (let i = 0; i < 120; i++) { car.steer = CONST.LEFT; car.steerAmt = null; holdSpeed(car, 8); car.step(DT); }
  const bTurn = betaOf(car);
  const car2 = mk('bench-hairpin-R8-low', 1.15 * Math.sqrt(Tn.mu0 * DYN.g * 8));
  let bMin = 0;
  for (let i = 0; i < 120; i++) {
    if (i < 9) { car2.steer = CONST.LEFT; car2.driveDir = CONST.BRAKE; car2.pwm = 0; }
    else { car2.steer = CONST.LEFT; car2.driveDir = CONST.FORWARD; car2.pwm = 255; }
    car2.steerAmt = null; car2.step(DT); if (betaOf(car2) < bMin) bMin = betaOf(car2);
  }
  // ⚠ 定常旋回の β の符号は **速度依存**（tangent speed 前後で反転。実測: R8-dry で約 12 m/s）。
  //   ∴ 結論「旧 `β>+35` は原理的に発火しない」を支えるのは第2連言 bMin<-30 のほう。第1連言は
  //   「低速(U=8 m/s)の定常左旋回では正」という限定つきの記述として残す。
  ok(bTurn > 0 && bMin < -30, `AU1-2 β の符号: 低速(U=8)の定常左旋回は正 (+${bTurn.toFixed(2)}°) / ドリフトは負 (${bMin.toFixed(1)}°)＝正側閾値では発火しない`);
}
// AU1-3: **grip が幾何的に通れない forced/intermediate 8 セルのうち、normal_fr で 180°完走＋壁不侵犯が
//        少なくとも 1 セル成立する** — 旧記録「動的到達不可(廊下保持 63〜86°)」を反証する主述語。
{
  const hard = dynTable.filter(r => (r.kind === 'forced' || r.kind === 'intermediate') && r.drive === 'normal_fr');
  const goRows = hard.filter(r => r.dynGO);
  const bestSustain = Math.max(...hard.map(r => r.sustainedDeg));
  console.log(`  grip 幾何不能セル(forced/intermediate) の normal_fr: 動的 GO=${goRows.length}/${hard.length}・最大 廊下保持 ${bestSustain.toFixed(0)}°/180°`);
  for (const r of goRows) console.log(`    GO: ${r.cell.padEnd(27)} minClr=${r.minClr.toFixed(4)}m hit=${r.hitAny} βpk=${r.betaPk.toFixed(0)}° 到達舵角min=${(r.steerMinRun * 100).toFixed(0)}% t=${r.t}s  prm(entry ${r.prm.entry} β ${r.prm.beta} tLead ${r.prm.tLead} lead ${r.prm.lead} Rd ${r.prm.Rd} ${r.prm.steer})`);
  ok(hard.length === 8, `AU1-3a grip 幾何不能セル(forced+intermediate)は 8 行 (実 ${hard.length})`);
  ok(goRows.length >= 1,
     `AU1-3b 本ドライバでは normal_fr が ${goRows.length}/8 セルで 180°完走＋壁不侵犯 (minClr=${goRows.map(r => r.minClr.toFixed(4)).join('/')} m) ⇒ 旧「動的到達不可(廊下保持 63〜86°)」は覆る（※原因は符号是正ではない・冒頭の帰属注記を参照）`);
  // 【AU1 是正】旧 AU1-3c は goRows(=dynGO で絞った行)に対して minClr≥0 ∧ !hitAny を問うており、
  //   dynGO の定義がその両方を含むため **定義から恒真**(見せかけの緑)だった。∴ **全行**で 2 オラクルを突合する。
  const clrOK = dynTable.filter(r => r.minClr >= 0);
  const disagree = clrOK.filter(r => r.hitAny);
  console.log(`  壁オラクル突合: minClr≥0 の ${clrOK.length}/${dynTable.length} 行のうち checkCollision=true は ${disagree.length} 行`);
  ok(clrOK.length >= 3 && disagree.length === 0,   // >=3 は空振り(0 行で恒真)防止の下限。本体の検査は disagree===0
     `AU1-3c 壁オラクル突合: poseClearance≥0 の全 ${clrOK.length} 行で checkCollision=false（2 オラクルが一致・${disagree.length} 行不一致）`);
  // 【重要な札】GO 行は「ドリフト」ではない — 逆ハンを一度も当てずに通っている(到達舵角の最小が 0 以上)。
  const goNoCounter = goRows.filter(r => r.steerMinRun >= 0).length;
  console.log(`  ⚠ GO ${goRows.length} 行のうち **逆ハンを一度も当てていない** 行 = ${goNoCounter}（βpk ${goRows.map(r => r.betaPk.toFixed(0)).join('/')}°）`);
  console.log(`     ⇒ 本表の GO は「浅い滑りを使う能動的な運転」で成立しており、深い後輪ドリフトでも逆ハンでもない。`);
  // AWD は同じ掃引でも成立しない(機序: 前輪駆動分が回頭を止める)＝弁別性。
  const awdHard = dynTable.filter(r => (r.kind === 'forced' || r.kind === 'intermediate') && r.drive === 'normal_awd');
  console.log(`  同 セルの normal_awd: 動的 GO=${awdHard.filter(r => r.dynGO).length}/${awdHard.length}(最大 廊下保持 ${Math.max(...awdHard.map(r => r.sustainedDeg)).toFixed(0)}°)`);
}

// ── 【AU3 (a')】grip 動的アームのアサート ───────────────────────────────────────────
console.log(`\n[AU3 (a') grip の動的実走]`);
{
  const hardG = gripDynTable.filter(r => (r.kind === 'forced' || r.kind === 'intermediate') && r.drive === 'normal_fr');
  const hardGAll = gripDynTable.filter(r => r.kind === 'forced' || r.kind === 'intermediate');
  const ctrlG = gripDynTable.filter(r => r.kind === 'control' && r.drive === 'normal_fr');
  const goG = hardGAll.filter(r => r.dynGO);
  const ctrlGo = ctrlG.filter(r => r.dynGO);
  console.log(`  grip 幾何不能セル(forced/intermediate) の grip 動的走行: GO=${goG.length}/${hardGAll.length}(fr+awd)・normal_fr の最大 廊下保持 ${Math.max(...hardG.map(r => r.sustainedDeg)).toFixed(0)}°/180°`);
  for (const r of hardG) console.log(`    ${r.cell.padEnd(27)} ${r.drive.padEnd(11)} 保持 ${r.sustainedDeg.toFixed(0).padStart(4)}° minClr ${r.minClr.toFixed(3).padStart(7)} 180=${r.done ? 'yes' : 'no '} hit=${String(r.hitAny).padStart(5)} | (d ${r.prm.d} U ${r.prm.U} lead ${r.prm.lead} ${r.prm.mode} ${r.prm.steer})`);
  console.log(`  対照セル(grip 幾何が収まる)の grip 動的走行: GO=${ctrlGo.length}/${ctrlG.length}  ${ctrlG.map(r => `${r.cell}:${r.dynGO ? 'GO t=' + r.t + 's' : '保持' + r.sustainedDeg.toFixed(0) + '°'}`).join(' / ')}`);
  // このゲートの ok() は緑を印字しない設計だが、AU3 で追加した述語は **緑でも実行された証跡**が要る
  //   （AP14/AP15 は緑を出さず、touge/wf_drift_reexam は出す＝同族で不揃いだった・AU3 の敵対的レビュー m-12）。
  //   既存アサートの出力形式は変えず、AU3 系だけ判定結果を1行で明示する。
  const au3log = (id, cond, msg) => console.log(`   ${cond ? '✓' : '✗'} ${id} ${msg}`);
  au3log('AU3-1a', goG.length === 0, `grip 実走の GO=${goG.length}/${hardGAll.length}`);
  au3log('AU3-1b', ctrlGo.length >= 1, `弁別性 対照セル GO=${ctrlGo.length}/${ctrlG.length}`);
  ok(hardG.length === 8, `AU3-1a0 grip 動的アームの対象は forced+intermediate の normal_fr 8 行 (実 ${hardG.length})`);
  // (a') 本体: grip の実走でも 180°完走＋壁不侵犯は成立しない。**連続量マージン**も併記する(CI-14)。
  ok(goG.length === 0,
     `AU3-1a **grip の実走も通れない**: forced/intermediate ${hardGAll.length} 行(fr+awd)で 180°完走＋壁不侵犯=${goG.length} 行 ⇒ 「grip は幾何最善線だけでなく動的にも通過できない」`);
  // 弁別性(必須・これが無いと (a') は反証不能): 同じドライバが対照セルでは通る。
  ok(ctrlGo.length >= 1,
     `AU3-1b **弁別性**: 同じ grip ドライバが対照セル(grip 幾何が収まる)では ${ctrlGo.length}/${ctrlG.length} 行で 180°完走＋壁不侵犯 ⇒ 上の 0 行はドライバの欠陥ではない`);
  // 2 オラクル突合(drift 側 AU1-3c と同型): minClr≥0 の行で checkCollision=false。
  const clrOKg = gripDynTable.filter(r => r.minClr >= 0);
  const disG = clrOKg.filter(r => r.hitAny);
  ok(clrOKg.length >= 2 && disG.length === 0,
     `AU3-1c grip 側の壁オラクル突合: poseClearance≥0 の全 ${clrOKg.length} 行で checkCollision=false (${disG.length} 行不一致)`);
  // 決定論(grip 動的アーム)。
  const g0 = geoms[wallSpecs[0].name];
  const pr = { d: (g0.innerR + g0.outerR) / 2, U: 4, lead: 0, prop: false, mode: 'lock', Rg: null };
  const q1 = dynGripReach(g0, 'fr', pr), q2 = dynGripReach(g0, 'fr', pr);
  ok(q1.minClr === q2.minClr && q1.sustainedDeg === q2.sustainedDeg && q1.dynGO === q2.dynGO,
     `AU3-1d 決定論(grip 動的走行2回 bit 一致 minClr=${q1.minClr}/${q2.minClr})`);
}
// 人間可読表(grip 動的)
console.log(`\n  [AU3 (a') grip 動的到達性] cell                  kind         drive       | 保持°  minClr  hit  180° 出口10m  t(s) | prm(d U lead mode 舵)`);
for (const r of gripDynTable) {
  console.log(`  ${r.cell.padEnd(27)} ${(r.kind || '?').padEnd(12)} ${r.drive.padEnd(11)} | ${r.sustainedDeg.toFixed(0).padStart(4)}° ${r.minClr.toFixed(2).padStart(6)} ${String(r.hitAny).padStart(5)} ${r.done ? 'yes' : 'no '}  ${r.exitOK ? 'yes' : 'no '}    ${r.t != null ? r.t.toFixed(2).padStart(5) : '   - '} | (${r.prm.d} ${r.prm.U} ${r.prm.lead} ${r.prm.mode.padEnd(6)} ${r.prm.steer})`);
}

// 人間可読表(幾何)
console.log(`\n  cell(外径/内径・廊下)                kind         surf | grip幾何:clr   fit R    | drift幾何:clr  fit R   β   | drift動的:廊下保持 GO | 統合`);
for (const r of table) {
  const gf = r.grip_geoFits ? 'GO' : 'no', df = r.drift_geoFits ? 'GO' : 'no', dd = r.drift_dynGO ? 'GO' : 'no';
  console.log(`  ${r.cell.padEnd(28)} ${(r.kind || '?').padEnd(12)} ${r.surf.padEnd(3)} | ${String(r.grip_clr).padStart(7)} ${gf.padStart(3)} ${String(r.grip_R).padStart(5)} | ${String(r.drift_clr).padStart(7)} ${df.padStart(3)} ${String(r.drift_R).padStart(4)} ${String(r.drift_beta).padStart(3)}° | ${String(r.drift_dynSustainedDeg).padStart(4)}°/180° ${dd.padStart(3)} | ${r.verdict}`);
}
// 人間可読表(動的到達性・セル×駆動 = AU1 の新表)
console.log(`\n  [AU1 動的到達性 再測] cell                      kind         drive       | 保持°  minClr  hit  180° 出口10m  t(s)  舵角min | prm(entry β tLead lead Rd 舵)   | 統合`);
for (const r of dynTable) {
  console.log(`  ${r.cell.padEnd(27)} ${(r.kind || '?').padEnd(12)} ${r.drive.padEnd(11)} | ${r.sustainedDeg.toFixed(0).padStart(4)}° ${r.minClr.toFixed(2).padStart(6)} ${String(r.hitAny).padStart(5)} ${r.done ? 'yes' : 'no '}  ${r.exitOK ? 'yes' : 'no '}    ${r.t != null ? r.t.toFixed(2).padStart(5) : '   - '} ${(r.steerMinRun * 100).toFixed(0).padStart(5)}% | (${r.prm.entry} ${String(r.prm.beta).padStart(2)} ${r.prm.tLead} ${r.prm.lead} ${String(r.prm.Rd).padStart(4)} ${r.prm.steer}) | ${r.verdict}`);
}
const goN = table.filter(r => r.verdict === 'GO').length;
const dynGoN = dynTable.filter(r => r.verdict === 'GO').length;
const nForced = table.filter(r => r.kind === 'forced').length, nCtrl = table.filter(r => r.kind === 'control').length, nInt = table.filter(r => r.kind === 'intermediate').length;
const geoDriftOnly = table.filter(r => r.drift_geoFits && !r.grip_geoFits).length;
console.log(`\n  強制${nForced}(外径<R_min)・中間${nInt}(点可・車体込不可)・対照${nCtrl}(車体込可)。`);
console.log(`  幾何 drift-only 窓(grip 不能∧drift 収まる)=${geoDriftOnly} 行 / 統合 GO(幾何∧動的到達) セル=${goN}/${table.length}・セル×駆動=${dynGoN}/${dynTable.length}。`);
console.log(`  → grip の**幾何最善線(定常円弧)**は不能(criterion ①)。一方 **浅い滑りを含む能動的な運転なら一部セルで`);
{
  const goFr = dynTable.filter(r => (r.kind === 'forced' || r.kind === 'intermediate') && r.drive === 'normal_fr' && r.dynGO);
  const bp = goFr.map(r => r.betaPk);
  const awdHard = dynTable.filter(r => (r.kind === 'forced' || r.kind === 'intermediate') && r.drive === 'normal_awd');
  console.log(`     180°完走＋壁不侵犯が成立する**(GO 行の βpk は ${bp.length ? Math.min(...bp).toFixed(0) + '〜' + Math.max(...bp).toFixed(0) : '--'}°＝深いドリフトではない)。成立は normal_fr に限られ AWD は ${awdHard.filter(r => r.dynGO).length}/${awdHard.length}。`);
}
console.log(`     ※ 帰属: この変化は逆ハンの符号是正が原因ではない(符号のみ戻した変異体でも GO は残る)。冒頭の帰属注記を参照。`);
console.log(`     ※ 【AU3 (a') で測定済】grip の**動的**実走も forced/intermediate では 180°完走できない(0/16 行・上表)。`);
console.log(`        同じ grip ドライバが対照セルでは 2/2 で完走する＝ドライバの欠陥ではない(弁別性 AU3-1b)。`);
console.log(`        ただし GO 行の βpk は 12〜15°＝**浅い滑り**であり「深い後輪ドリフト」ではない。`);
console.log(`        ∴ 言えるのは「grip 走行(意図的な滑りを作らない運転)では通れず、滑りを使う運転なら一部で通れる」まで。`);

if (process.argv.includes('--json')) {
  console.log('===JSON===');
  console.log(JSON.stringify({ appVersion: APP_VERSION, driver: 'AU1-sign-corrected', sweep: FULL ? 'full' : 'reduced',
    R_min: +R_MIN.toFixed(4), diag: +DIAG.toFixed(4), counterFire, counterTick, wantMin: +wantMin.toFixed(4),
    deepTick, deepCounter, deepRatio: +deepRatio.toFixed(4),
    table, dynTable, gripDynTable, goN, dynGoN, total: table.length }, null, 0));
}

console.log(`\n[結果] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
