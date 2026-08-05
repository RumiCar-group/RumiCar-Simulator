// wf_ao4_contact.mjs — Stage AO4 受け入れゲート (リポジトリ追跡・本番フロー/実オラクル / CI-8/9/14)。
// ════════════════════════════════════════════════════════════════════════════
// AO4「接触モデル v2 (CCD＋2点マニフォールド＋インパルス＋クーロン摩擦＋車車運動量交換)」を
// AO_spec §3・§12 AO4 の受け入れを「知覚→測定の翻訳」で連続量マージンの機械検査に落とす。
// **再実装せず 実 integrateFleetV2 (本番の全車同時積分経路)・resolveFleetContacts (本番の接触ソルバ)・
// CarV2._contactBody/_setContactVel (本番の剛体 IF) を呼ぶ**。数値は二値でなく連続量マージンで出す。
//   A1 掃引 CCD 貫通ゼロ: 96 m/s×薄壁×100 ポーズ を integrateFleetV2 で1フレーム→全ポーズ near 側 (貫通0)。
//   A2 貫入≤slop: 深い静的重なりを resolveFleetContacts の位置補正で slop 内へ (連続量=残貫入 m)。
//   A3 浅角こすり滑走: 惰行で壁沿いを滑走 → 純変位>車長・KE 非増加 (散逸的)・法線速度チャタ僅少。
//   M  車車運動量保存: 2車正面衝突を resolveFleetContacts → Σm·v の変化 ≤1e-6 (等大逆向きインパルス)。
//   T  T ボーン角運動量: 偏心衝突で静止車にヨー授受 (w≠0) ＋ 全角運動量 L 保存 ≤1e-6。
//   D  決定論 bit 一致: 同一接触シナリオ (integrateFleetV2 多ステップ) を2回→最終状態 完全一致。
//   F  vCrash/slop 凍結: 領域別に凍結値と一致 (fullscale≈8m/s・kV スケール不変・AO4 で数値凍結)。
//   S  スタック→recover 接続: 壁正面で前進指令→純変位不足 1.2s→RECOVER_STEER_CYCLE arm (recoverN≥1)。
// いずれか失敗で非ゼロ終了。canonical f0/f1・collision/recover ゲート (旧 integrateSlot 無改変=byte 不変) は
// 別ゲートで別途緑 (v2 は guarded branch)。本ゲートは v2 接触の物理を測る。
// ════════════════════════════════════════════════════════════════════════════
import { CarV2 } from './public/js/physics_v2.js';
import { resolveFleetContacts, buildWallGrid, slopOf, vCrashOf, V2_CONTACT } from './public/js/contact_v2.js';
import { integrateFleetV2 } from './public/js/fleet.js';
import { applyRegime } from './public/js/physics_dyn.js';
import { CAR, CONST, setPhysicsMode } from './public/js/config.js';

let pass = 0, fail = 0; const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
const DT = 1 / 60;

// 車生成 (領域適用後に寸法確定 → CAR.* を読む)。
function mk(type, regime, st) { applyRegime(regime); const c = new CarV2({ x: 0, y: 0, theta: 0, grip: 1, downhill: 0, ...st }); c.type = type || 'normal_fr'; c.reset({ x: 0, y: 0, theta: 0, grip: 1, downhill: 0, ...st }); return c; }
// 本番 integrateFleetV2 に渡す最小スロット (lap/log はテストラッパ=物理には無干渉・CI-8 のバイパスでない)。
function mkSlot(car) {
  const lap = { laps: 0, crashes: 0, touge: false, finished: false, update() { return false; }, addCrash() { this.crashes++; } };
  const logs = [];
  return { car, running: true, lap, world: { log: (m) => logs.push(m) }, logs };
}
// resolveFleetContacts に渡す剛体 body (integrateFleetV2 が組むのと同一構造。pcor=cor=静的重なり用)。
function mkBody(car) {
  const b = car._contactBody();
  return {
    car, isStatic: false, invM: b.invM, invI: b.invI, m: b.m,
    cx: b.cx, cy: b.cy, pcx: b.cx, pcy: b.cy, vx: b.vx, vy: b.vy, w: b.w,
    cor: car.corners(), pcor: car.corners(), dx: 0, dy: 0, maxAppr: 0,
  };
}
const KE = (b) => 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy) + 0.5 * (1 / b.invI) * b.w * b.w;
// 全角運動量 (原点まわり)。L = Σ [ I·w + m·(cx·vy − cy·vx) ]。等大逆向きインパルスで保存 (T 授受が創発)。
const angMom = (bs) => bs.reduce((s, b) => s + (1 / b.invI) * b.w + b.m * (b.cx * b.vy - b.cy * b.vx), 0);

setPhysicsMode('v2');

// ── A1. 掃引 CCD: 96 m/s×薄壁×100 ポーズ 貫通ゼロ (§12 AO4) ───────────────────
// fullscale で薄壁の near 側に置き 96 m/s で1フレーム進める。CCD＋位置補正が無ければ 1/60×96≈1.6m 貫通する。
// 全ポーズで car 四隅が near 側 (x ≤ WX+slop) に残る=貫通0。最大貫入 (maxCornerX−WX) の連続量も出す。
{
  applyRegime('fullscale'); setPhysicsMode('v2');
  const slop = slopOf();
  const WX = 0;
  const walls = [{ x1: WX, y1: -1000, x2: WX, y2: 1000 }];   // 薄い縦壁 (長い=区間端の縁効果なし)
  const front = CAR.length - CAR.rearToBack;
  let tunnels = 0, maxPen = -Infinity, minDisp = Infinity;
  for (let pi = 0; pi < 100; pi++) {
    const yoff = ((pi % 10) - 4.5) * CAR.length * 0.4;              // 壁沿い横位置 (10)
    const ang = (Math.floor(pi / 10) - 4.5) * 0.02;                // 進入角 ±0.09rad (10)
    const c = mk('normal_fr', 'fullscale', { x: WX - 0.1 - front * Math.cos(ang), y: yoff, theta: ang });
    c.driveDir = CONST.FREE; c.pwm = 0; c.u = 96; c.vlat = 0; c.r = 0;
    const slot = mkSlot(c);
    const x0 = c.x;
    integrateFleetV2([slot], DT, walls, false, false);
    const maxX = Math.max(...c.corners().map(p => p.x));
    const pen = maxX - WX;                                          // >slop = 貫通 (far 側)
    if (pen > slop) tunnels++;
    if (pen > maxPen) maxPen = pen;
    if (c.x - x0 < minDisp) minDisp = c.x - x0;                     // 実際に前進したか (壁で止まる=小)
  }
  console.log(`  A1 96m/s×薄壁×100: 貫通(far側)=${tunnels} 最大貫入=${maxPen.toFixed(4)}m (slop=${slop.toFixed(3)}m) 最小純変位=${minDisp.toFixed(3)}m`);
  ok(tunnels === 0, `A1: 96m/s×薄壁×100ポーズ 貫通ゼロ (掃引 CCD＋位置補正・far 側残 ${tunnels}台)`);
  ok(maxPen <= slop, `A1: 最大貫入 ≤ slop (${maxPen.toFixed(4)}≤${slop.toFixed(3)}m)`);
}

// ── A2. 貫入 ≤ slop: 深い静的重なりを位置補正が slop 内へ (§12 AO4) ───────────
// 車の前端を壁の far 側へ 0.5車長 めり込ませ (掃引でなく静的重なり)、resolveFleetContacts の split-impulse
// 位置補正のみで貫入が slop 以下へ収束するか。連続量=補正後の残貫入 (m)。
{
  applyRegime('fullscale'); setPhysicsMode('v2');
  const slop = slopOf();
  const WX = 0;
  const walls = [{ x1: WX, y1: -1000, x2: WX, y2: 1000 }];
  const grid = buildWallGrid(walls);
  const c = mk('normal_fr', 'fullscale', { x: WX - 0.5 * CAR.length, y: 0, theta: 0 });   // 中心 near 側・前端が far へ
  c.u = 0; c.vlat = 0; c.r = 0;
  const penBefore = Math.max(...c.corners().map(p => p.x)) - WX;
  const b = mkBody(c);
  resolveFleetContacts([b], grid, walls, 1, false);
  const penAfter = Math.max(...c.corners().map(p => p.x + b.dx)) - WX;   // dx=位置補正の並進 (剛体=四隅も同一並進)
  console.log(`  A2 静的重なり: 補正前貫入=${penBefore.toFixed(4)}m → 補正後=${penAfter.toFixed(4)}m (slop=${slop.toFixed(3)}m・押出Δ=${b.dx.toFixed(4)}m)`);
  ok(penBefore > slop, `A2: 前提=補正前は slop 超のめり込み (${penBefore.toFixed(3)}m)`);
  ok(penAfter <= slop, `A2: 位置補正後の残貫入 ≤ slop (${penAfter.toFixed(4)}≤${slop.toFixed(3)}m)`);
}

// ── A3. 浅角こすり滑走: 純変位>車長・KE 非増加・法線チャタ僅少 (§12 AO4) ────────
// 壁 (y=0・near 側=+y) の上を、わずかに壁向き (−y) の惰行で滑走。接触は法線 KE を吸い (e=0)、摩擦が接線を
// 削り、位置補正が押し出す。惰行 (駆動なし) なので KE は全ステップ単調非増加のはず。壁沿いに車長超 滑走。
// チャタ: 法線速度 vn の符号反転回数 (バウンドすると +/− 振動する) が僅少 (安定こすり)。
{
  applyRegime('fullscale'); setPhysicsMode('v2');
  const walls = [{ x1: -1000, y1: 0, x2: 1000, y2: 0 }];   // 水平壁 (near 側 +y)
  const hw = CAR.width / 2;
  const c = mk('normal_fr', 'fullscale', { x: 0, y: hw + 0.02, theta: -0.05 });   // わずかに下向き (壁へ)
  c.driveDir = CONST.FREE; c.pwm = 0; c.u = 30; c.vlat = 0; c.r = 0;
  const slot = mkSlot(c);
  const x0 = c.x;
  let keProblem = 0, signFlips = 0, prevVnSign = 0, prevKE = Infinity, contacted = false;
  const N = 150;   // 2.5s
  for (let i = 0; i < N; i++) {
    integrateFleetV2([slot], DT, walls, false, false);
    const cth = Math.cos(c.theta), sth = Math.sin(c.theta);
    const vx = c.u * cth - c.vlat * sth, vy = c.u * sth + c.vlat * cth;
    const ke = 0.5 * (c.profile().mass) * (vx * vx + vy * vy);
    if (ke > prevKE * (1 + 1e-6) + 1e-9) keProblem++;   // 非増加違反
    prevKE = ke;
    const vn = vy;   // 法線 (+y) 成分。こすり中は ≈0 (バウンドなら符号振動)
    const minY = Math.min(...c.corners().map(p => p.y));
    if (minY < hw * 0.5) contacted = true;              // 壁に十分接触した
    const sgn = Math.abs(vn) > 0.05 ? Math.sign(vn) : 0;
    if (sgn !== 0 && prevVnSign !== 0 && sgn !== prevVnSign) signFlips++;
    if (sgn !== 0) prevVnSign = sgn;
  }
  const netDx = c.x - x0;
  console.log(`  A3 こすり滑走: 純変位=${netDx.toFixed(3)}m (車長=${CAR.length.toFixed(2)}m) KE非増加違反=${keProblem}/${N} 法線符号反転=${signFlips} 接触=${contacted}`);
  ok(contacted, `A3: 前提=車が壁に接触した`);
  ok(netDx > CAR.length, `A3: 壁沿い純変位 > 車長 (${netDx.toFixed(2)}>${CAR.length.toFixed(2)}m・滑走した)`);
  ok(keProblem === 0, `A3: 接触こすり中 KE 非増加 (惰行=散逸的・違反 ${keProblem}/${N})`);
  ok(signFlips <= 5, `A3: 法線速度チャタ僅少 (符号反転 ${signFlips}≤5・安定こすり)`);
}

// ── M. 車車 運動量保存 ≤1e-6 (§12 AO4) ───────────────────────────────────────
// 追突 (A 速い後車が B 遅い前車へ・総運動量 ≠0 で保存を意味あるものに) を resolveFleetContacts (壁なし・
// interact)。Σ m·v が接触解決前後で保存 (等大逆向きインパルス=作用反作用)。相対誤差の連続量で出す。
{
  applyRegime('fullscale'); setPhysicsMode('v2');
  const A = mk('normal_fr', 'fullscale', { x: -1.5, y: 0, theta: 0 }); A.u = 25; A.vlat = 0; A.r = 0;
  const B = mk('normal_fr', 'fullscale', { x: 1.5, y: 0, theta: 0 }); B.u = 5; B.vlat = 0; B.r = 0;
  const bs = [mkBody(A), mkBody(B)];
  const p0x = bs.reduce((s, b) => s + b.m * b.vx, 0), p0y = bs.reduce((s, b) => s + b.m * b.vy, 0);
  const v0 = bs[0].vx;
  resolveFleetContacts(bs, null, [], 1, true);
  const p1x = bs.reduce((s, b) => s + b.m * b.vx, 0), p1y = bs.reduce((s, b) => s + b.m * b.vy, 0);
  const p0 = Math.hypot(p0x, p0y) || 1;
  const relErr = Math.hypot(p1x - p0x, p1y - p0y) / p0;
  const interacted = Math.abs(bs[0].vx - v0) > 1e-6;
  console.log(`  M 車車運動量: Σmv 前=(${p0x.toFixed(1)},${p0y.toFixed(1)}) 後=(${p1x.toFixed(1)},${p1y.toFixed(1)}) 相対誤差=${relErr.toExponential(2)} 接触=${interacted}`);
  ok(interacted, `M: 前提=2車が接触しインパルスが作用した`);
  ok(relErr <= 1e-6, `M: 車車 運動量保存 相対誤差 ≤1e-6 (${relErr.toExponential(2)})`);
}

// ── T. T ボーン 角運動量授受＋全 L 保存 ≤1e-6 (§12 AO4) ───────────────────────
// A が +x 移動で静止 B の後端へ **偏心** (横 0.3車幅ずれ)・**浅い x 貫入** (x 重なり<y 重なり=SAT 最小軸が x=
// A 速度に正対) で衝突。偏心接触ゆえ B にヨー (w≠0) が授受される。全角運動量 L (原点まわり) は等大逆向き
// インパルス (同一接触点) ゆえ保存。連続量=L 相対誤差＋B のヨー獲得量。
{
  applyRegime('fullscale'); setPhysicsMode('v2');
  const A = mk('normal_fr', 'fullscale', { x: 0.25 - CAR.length, y: 0.3 * CAR.width, theta: 0 }); A.u = 25; A.vlat = 0; A.r = 0;
  const B = mk('normal_fr', 'fullscale', { x: 0, y: 0, theta: 0 }); B.u = 0; B.vlat = 0; B.r = 0;
  const bs = [mkBody(A), mkBody(B)];
  const L0 = angMom(bs);
  resolveFleetContacts(bs, null, [], 1, true);
  const L1 = angMom(bs);
  const Lrel = Math.abs(L1 - L0) / (Math.abs(L0) + 1e-9);
  const bw = Math.abs(bs[1].w);
  console.log(`  T Tボーン: L 前=${L0.toFixed(3)} 後=${L1.toFixed(3)} 相対誤差=${Lrel.toExponential(2)} B獲得ヨー |w|=${bw.toExponential(3)}`);
  ok(bw > 1e-4, `T: 偏心衝突で静止 B にヨーが授受された (|w|=${bw.toExponential(2)}>0)`);
  ok(Lrel <= 1e-6, `T: 全角運動量 L 保存 相対誤差 ≤1e-6 (${Lrel.toExponential(2)})`);
}

// ── D. 決定論 bit 一致 (§12 AO4) ─────────────────────────────────────────────
// 2車が接触するシナリオを integrateFleetV2 で 60 ステップ走らせ、最終状態 (x,y,theta,u,vlat,r) が2回で完全一致。
// (乱数/時刻なし・body index 昇順・接触は生成順の固定 Gauss-Seidel=node 上で bit 決定論)。
{
  function run() {
    applyRegime('fullscale'); setPhysicsMode('v2');
    const walls = [{ x1: -1000, y1: -5, x2: 1000, y2: -5 }];
    const A = mk('normal_fr', 'fullscale', { x: -2, y: 0, theta: 0 }); A.driveDir = CONST.FORWARD; A.pwm = 200; A.u = 5;
    const B = mk('drift_fr', 'fullscale', { x: 2, y: 0.3, theta: Math.PI }); B.driveDir = CONST.FORWARD; B.pwm = 200; B.u = 5;
    const sA = mkSlot(A), sB = mkSlot(B);
    for (let i = 0; i < 60; i++) integrateFleetV2([sA, sB], DT, walls, true, true);
    return [A, B].map(c => [c.x, c.y, c.theta, c.u, c.vlat, c.r]);
  }
  const r1 = JSON.stringify(run()), r2 = JSON.stringify(run());
  ok(r1 === r2, `D: 接触シナリオ (60step×2車) 決定論 bit 一致 (最終状態完全一致)`);
  console.log(`  D 決定論: 2回一致=${r1 === r2}`);
}

// ── F. vCrash/slop 凍結 (§3・AO4 で数値凍結) ─────────────────────────────────
// 領域別に vCrash=vCrashFrac×CAR.maxSpeed・slop=0.02×regimeK を凍結値と照合。fullscale≈8m/s (§3)。
// kV スケール不変性: fullscale/tabletop 比 = CAR.maxSpeed 比 (速度は Froude で一緒に伸びる)。
{
  applyRegime('tabletop'); const vcT = vCrashOf(), spT = slopOf();
  applyRegime('fullscale'); const vcF = vCrashOf(), spF = slopOf();
  console.log(`  F 凍結: tabletop vCrash=${vcT.toFixed(4)}m/s slop=${spT.toFixed(3)}m / fullscale vCrash=${vcF.toFixed(3)}m/s slop=${spF.toFixed(2)}m`);
  ok(Math.abs(vcT - 0.0511) < 1e-4, `F: tabletop vCrash 凍結=0.0511 m/s (実 ${vcT.toFixed(4)})`);
  ok(Math.abs(spT - 0.02) < 1e-6, `F: tabletop slop 凍結=0.020 m (実 ${spT.toFixed(4)})`);
  ok(Math.abs(vcF - 8.03) < 1e-2, `F: fullscale vCrash 凍結≈8.03 m/s=§3「≈8m/s」(実 ${vcF.toFixed(3)})`);
  ok(Math.abs(spF - 0.40) < 1e-3, `F: fullscale slop 凍結=0.40 m (実 ${spF.toFixed(3)})`);
  ok(V2_CONTACT.eWall === 0 && Math.abs(V2_CONTACT.eCar - 0.1) < 1e-9 && Math.abs(V2_CONTACT.muFrac - 0.5) < 1e-9,
    `F: 接触定数 凍結 (壁 e=0・車車 e=0.1・μc=0.5×grip)`);
}

// ── S. スタック→recover 接続 (§12 AO4) ───────────────────────────────────────
// 壁正面へ前進指令 (pwm 大) で押し続ける=法線で全て止まり純変位が伸びない → 1.2s 後に既存 RECOVER_STEER_CYCLE
// を arm (recoverN≥1)。recover ON なので crashed にはしない (rejoin=「こすり継続」)。
{
  applyRegime('fullscale'); setPhysicsMode('v2');
  const WX = 0.3;
  const walls = [{ x1: WX, y1: -1000, x2: WX, y2: 1000 }];   // 正面の縦壁
  const c = mk('normal_fr', 'fullscale', { x: WX - 0.6 * CAR.length, y: 0, theta: 0 });
  c.driveDir = CONST.FORWARD; c.pwm = 200; c.u = 0;
  const slot = mkSlot(c);
  let armed = 0;
  for (let i = 0; i < 120; i++) {   // 2.0s (>STUCK_WINDOW=1.2s)
    integrateFleetV2([slot], DT, walls, true, true);
    if ((c.recoverN || 0) >= 1) armed = c.recoverN;
  }
  console.log(`  S スタック→recover: recoverN=${c.recoverN || 0} crashed=${c.crashed} recover log=${slot.logs.length}`);
  ok(!c.crashed, `S: recover(rejoin) ON では壁こすりでクラッシュしない`);
  ok((c.recoverN || 0) >= 1, `S: 前進指令下 純変位不足 1.2s で RECOVER_STEER_CYCLE を arm (recoverN=${c.recoverN || 0}≥1)`);
}

// ── S2. 静的障害物 (crashed/held=invM0) × 走行車 が body index 順に依らず解決 (AO13 監査回帰) ──
// AO13 の横断監査で発見: ペア収集が「低 index が静的」のとき接触を生成せず、高 index の走行車が事故車を
// すり抜けていた (鏡像 index は正常=順序依存バグ)。static 同士のみ除外に修正。両順序で遮断を機械検証する。
{
  applyRegime('fullscale'); setPhysicsMode('v2');
  const run = (staticFirst) => {
    const wreck = mk('normal_fr', 'fullscale', { x: 0, y: 0, theta: 0 });
    wreck.crashed = true;                                   // fleet が invM=0 の静的障害物として組む本番条件
    const runner = mk('normal_fr', 'fullscale', { x: -1.5 * CAR.length, y: 0, theta: 0 });
    runner.u = 10;
    const slots = staticFirst ? [mkSlot(wreck), mkSlot(runner)] : [mkSlot(runner), mkSlot(wreck)];
    let minGap = Infinity;
    for (let i = 0; i < 90; i++) {
      integrateFleetV2(slots, DT, [], false, true);
      minGap = Math.min(minGap, Math.abs(runner.x - wreck.x));
    }
    return { passed: runner.x > wreck.x + 0.5 * CAR.length, minGap };
  };
  const a = run(true), b = run(false);
  console.log(`  S2 静的×走行 index 対称: static@0 minGap=${a.minGap.toFixed(2)} / static@1 minGap=${b.minGap.toFixed(2)} (車長 ${CAR.length.toFixed(2)})`);
  ok(!a.passed, `S2: 低 index 静的障害物を高 index 走行車がすり抜けない (minGap=${a.minGap.toFixed(2)})`);
  ok(!b.passed, `S2: 高 index 静的障害物を低 index 走行車がすり抜けない (minGap=${b.minGap.toFixed(2)})`);
  ok(a.minGap > 0.8 * CAR.length && b.minGap > 0.8 * CAR.length,
     `S2: 両順序とも車長級の間隔で遮断 (${a.minGap.toFixed(2)}/${b.minGap.toFixed(2)} > 0.8×${CAR.length.toFixed(2)})`);
}

setPhysicsMode('dynamic');   // 後始末: 既定へ戻す (他ゲート/live に漏らさない)

console.log('────────────────────────────────────────────────────────────────');
console.log('Stage AO4 ゲート  (接触 v2: CCD＋マニフォールド＋インパルス＋摩擦＋運動量交換)');
console.log('────────────────────────────────────────────────────────────────');
if (fail) { console.log(`  FAIL ${fail} 件:`); for (const f of fails) console.log('   - ' + f); }
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
console.log('────────────────────────────────────────────────────────────────');
console.log(`結果: ${fail ? 'FAIL' : 'PASS'}`);
process.exit(fail ? 1 : 0);
