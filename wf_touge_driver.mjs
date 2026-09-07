// wf_touge_driver.mjs — Stage AX1「峠を安定して走る基準ドライバ」の本体。
// ══════════════════════════════════════════════════════════════════════════════════════
// **library（単体実行しない・wf_run_all の EXCLUDED に明示）**。受け入れゲートは wf_ax1_touge_base.mjs。
// AX2（横位置ごとの通過可能速度）と AX3（多車・片道レース）はここを import して測定の土台にする。
//
// 何のためのものか:
//   Stage AX は「峠でブロック戦術が順位を守れるか」を測る。戦術を比べる前に **まともに走る基準**が要る。
//   2026-09-06 の予備実装（scratchpad `_touge_block.mjs`）は同一条件で所要 22〜224 秒とばらつき、多くの車が
//   完走できず、**戦術の差を測れる状態になかった**。本ファイルはその失敗を出発点に、欠陥を潰した実装である。
//
// ── 予備実装から是正した 3 点（すべて実測にもとづく）────────────────────────────────────
//  ① **中心線が道幅より粗い**。出荷の switchback 峠の `course.centerline` は 20〜29 点しかなく、点間隔は
//     実測 **最大 2.95m**（峠③）で、道幅 0.53〜0.60m より一桁粗い。この粗さのまま最近点で進行度を測ると
//     ヘアピンで破綻する。∴ **0.02m へ再標本化**する（STEP）。生の粗さが実在することはゲートが実測で固定する。
//  ② **最近点方式の進行度が別区間へ飛ぶ**。∴ **前回位置からの前方窓**で探す（trackerOf）。
//     ⚠ **起票時の根拠「峠②で中心線が 0.35m 以内に自己接近する点が 4/29」は誤りだった**。予備実装
//     `_touge_diag.mjs` が壁から中心線を再構成する際に `w[i]` と `w[walls.length/2 + i]` を組にしていたが、
//     峠の壁は「片側 28 セグメント ×2 ＋ 前後のフタ 2 枚 = 58」で片側は 29 ではなく **28**。1 本ずれた
//     中心線は本物の `course.centerline` から最大 1.538m（道幅 0.530m の約 3 倍）外れており、「4/29」は
//     その産物である。**本物の centerline では全 6 峠とも 0/29**（ゲート F-0 が両方を実測で固定する）。
//     一方で **最近点方式が壊れること自体は実データで起きる**: 架空峠(激坂) は蛇行の隣り合う山が近く、
//     廊下の**最外縁**（|lat| = 余地いっぱい）では全域最近点が弧長で 0.367m 飛ぶ（32/2535 点）。
//     ただし**出荷コースを実際に走る線の上では両方式が bit 一致**する（実測）＝前方窓の必要性は
//     この構造と、AX3 で道幅を詰め車車接触が起きて走行線が外縁へ寄ることに拠る。
//  ③ **予備実装は下り勾配を一切与えていなかった**。`new CarV2({x,y,theta})` を手組みしていたため
//     `course.start.downhill`（roadMeta）も `slot._road`（roadFrame）も渡らず、`gPlane` が早期 return して
//     **重力ゼロ**で走っていた（峠は downhill 0.69〜1.49 m/s² ＝ 一次項）。∴ 本ファイルは車もスロットも
//     **本番の makeSlot / rebuildSpawns で作る**（＝ freeSpawn・roadFrame・既定装備・LapTracker が本番と同一）。
//
// ── 走行条件（Stage AX 全体で固定・人間裁定 2026-09-06 SAX-PREP H1）──────────────────────
//   エンジン = **v2**（`integrateFleetV2`）／領域 = **卓上**。理由: AX3 の車車インパルス接触は v2 にしか
//   無く、既定 `dynamic` の車車処理は「重なる前進を取り消して car.halt()」＝触れた追走車が即停止する
//   （fleet.js:525-531）ため、ブロック戦術の測定が接触モデルの副産物になる。v2/卓上 は UI「精密 v2」で
//   選べる本番構成。**卓上の本番既定は dynamic**（config.js:448）なので、本ファイルを使った結論には
//   必ず「卓上 v2 での話」と条件をスタンプすること。
//   装備は **すべて既定**（tri 操舵・motor ブレーキ・normal タイヤ・direct ギア・quasi サス）＝ 既定
//   サンプルとの所要時間比較が装備差に汚染されない。
//
// ── 運転手の性格 ────────────────────────────────────────────────────────────────────
//   ToF プログラムではなく **全知スクリプト**（自分の座標・コース幾何を直接読む）。wf_drift_reexam Part 3 /
//   wf_touge_drift_probe と同じ steelman の型で、「ToF で読めるか」ではなく「物理的に可能か」を測る道具。
//   物理は 1 バイトも触らない（本ファイルは product を import するだけ）。
// ══════════════════════════════════════════════════════════════════════════════════════
import { buildFromSpec } from './public/js/course.js';
import { makeSlot, rebuildSpawns, integrateFleetV2 } from './public/js/fleet.js';
import { CAR, CONST, SIM, setPhysicsMode } from './public/js/config.js';
import { applyRegime, DYN } from './public/js/physics_dyn.js';
import { distToSeg } from './public/js/geom.js';
import { Car, checkCollision, carEdges } from './public/js/physics.js';
import { tireParamsFor } from './public/js/physics_v2.js';

export const STEP = 0.02;                 // 中心線の再標本化間隔 [m]（道幅 0.53m の 1/26）
export const DT = 1 / SIM.physicsHz;      // 60Hz = レース/ベンチと同一粒度
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

// Stage AX の走行条件を確定させる（呼び出し側が最初に 1 回呼ぶ）。冪等。
export function setupRegime() { setPhysicsMode('v2'); applyRegime('tabletop'); }

// ── 幾何 ────────────────────────────────────────────────────────────────────────────
// 出荷の峠は buildTouge が `centerline`（生）と、その ±hw オフセットの左右壁 ＋ 前後の 2 枚のフタを持つ。
// フタは「横の余地」ではないので半幅の計算から外す。**外し方を思い込みでなく構造で機械確認する**:
//   walls.length === 2*(centerline.length-1) + 2  （左右の開いた廊下 ＋ 前後フタ 2 枚）
// が成り立つことを確かめてから末尾 2 枚を落とす。成り立たなければ例外で止まる（黙って誤った幅を使わない）。
export function sideWallsOf(course) {
  // **`course.touge` を必ず見る**。壁の本数だけでは峠を判別できない — track 型（周回）は
  // `polyWalls` が閉じるので左右とも n 本、計 2n となり、峠の期待値 2*(n-1)+2 = 2n と**恒等的に一致**
  // してしまう（出荷の非峠 track 29 本がこの検査を素通しし、内側ループの閉じ辺 2 本が黙って落ちる）。
  if (!course.touge) throw new Error('sideWallsOf: 峠(touge)コースではない — 壁の本数だけでは判別できないので拒否する');
  const n = course.centerline.length;
  const expect = 2 * (n - 1) + 2;
  if (course.walls.length !== expect) {
    throw new Error(`sideWallsOf: 壁の構成が想定外 (walls=${course.walls.length} 期待=${expect}) — buildTouge の構造が変わった可能性`);
  }
  return course.walls.slice(0, course.walls.length - 2);
}

// 峠の道の幾何。P=0.02m 等間隔の中心線 / s=弧長 / th=接線 / kap=符号付き曲率 / hw=**実測**半幅。
// hw は「中心線点から最寄りの側壁までの距離」を既存オラクル distToSeg で測る（再実装しない・CI-14）。
// 公称 hw（spec.hw）ではなく実測にするのは、コーナー内側で廊下が公称より狭くなるため。
export function tougeGeom(course, safe = RMIN_SAFE) {
  const raw = course.centerline;
  if (!Array.isArray(raw) || raw.length < 2) throw new Error('tougeGeom: course.centerline が無い（峠コースではない）');
  const P = [];
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1], b = raw[i];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const m = Math.max(1, Math.round(d / STEP));
    for (let k = 0; k < m; k++) { const r = k / m; P.push([a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r]); }
  }
  P.push([raw[raw.length - 1][0], raw[raw.length - 1][1]]);
  const n = P.length;
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  // 接線・曲率は ±W 点の窓で取る。生の中心線は多角形（switchback のヘアピンは 8 分割の折れ線）ゆえ
  // 1 点差分だと角で無限大の曲率が立つ。窓幅 0.06m は車長 0.19m の 1/3 = 車が「感じる」尺度。
  const W = Math.max(1, Math.round(0.06 / STEP));
  const th = new Float64Array(n), kap = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - W)], b = P[Math.min(n - 1, i + W)];
    th[i] = Math.atan2(b[1] - a[1], b[0] - a[0]);
  }
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - W), hi = Math.min(n - 1, i + W), ds = s[hi] - s[lo];
    kap[i] = ds > 1e-9 ? wrap(th[hi] - th[lo]) / ds : 0;
  }
  const side = sideWallsOf(course);
  const hw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = { x: P[i][0], y: P[i][1] };
    let d = Infinity;
    for (const w of side) { const dd = distToSeg(p, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }); if (dd < d) d = dd; }
    hw[i] = d;
  }
  const G = { P, s, th, kap, hw, n, total: s[n - 1] };
  const corr = latCorridor(G, safe);                 // 舵角律速で決まる「到達可能な横位置の回廊」
  G.hiLat = corr.hi; G.loLat = corr.lo;
  return G;
}

// 旋回時に車体の外側前角が「後輪軸中心が描く円」より外へ出る量 [m]（車幅の半分を除いた超過分）。
// **基準点は後輪軸中心**である: `car.x/y` は後輪軸中心で（`physics_dyn.js` の定義）、`corners()` は
// そこから前へ `CAR.length - CAR.rearToBack`、幅 ±`CAR.width/2` に四隅を置く（`physics.js:230-239`）。
//   ICR は後輪軸線上・距離 R。外側前角は body 座標 (front, -hw) ゆえ ICR からの距離は
//   sqrt(front² + (R+hw)²) で、はみ出し = その距離 − R − hw。
// **初版は車体中心を基準に計算した 0.011m を定数 BODY_MARGIN=0.025 に埋めていた**（層 4 レビュー指摘）。
// 正しい基準では R=0.357m で 0.031m ＝ 定数では足りない。曲率から毎回求める形へ直した。
const WALL_CLEAR = 0.010;    // 壁への安全余白 [m]
export function swingOut(R) {
  const front = CAR.length - CAR.rearToBack, hw = CAR.width / 2;
  if (!(R > 0) || !Number.isFinite(R)) return 0;
  return Math.max(0, Math.hypot(front, R + hw) - R - hw);
}
// 中心線から測った「車が中心を外して置ける余地」[m]。負にはしない。
export function roomAt(G, i) {
  const ak = Math.abs(G.kap[i]);
  const R = ak > 1e-6 ? 1 / ak : Infinity;
  return Math.max(0, G.hw[i] - CAR.width / 2 - swingOut(R) - WALL_CLEAR);
}

// ── 進行度（前方窓・単調）────────────────────────────────────────────────────────────
// `mode:'window'` = 前回インデックスから [-0.10m, +0.60m] だけ探す（既定・本番用）。
// `mode:'nearest'` = 全域から最近点を探す（予備実装の方式）。ゲート F-3 が「出荷コースの走行線上では
//                    両方式が bit 一致する」ことを実測で示すために呼ぶ。本番の測定では使わない。
export function trackerOf(G, mode = 'window') {
  let idx = null;
  const back = Math.round(0.10 / STEP), fwd = Math.round(0.60 / STEP);
  return function track(x, y) {
    let lo = 0, hi = G.n - 1;
    if (mode === 'window' && idx != null) { lo = Math.max(0, idx - back); hi = Math.min(G.n - 1, idx + fwd); }
    let best = lo, bd = Infinity;
    for (let i = lo; i <= hi; i++) {
      const d = (G.P[i][0] - x) ** 2 + (G.P[i][1] - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    idx = best;
    const c = Math.cos(G.th[best]), sn = Math.sin(G.th[best]);
    return { i: best, s: G.s[best], lat: -sn * (x - G.P[best][0]) + c * (y - G.P[best][1]) };
  };
}

// ── 速度プロファイル ────────────────────────────────────────────────────────────────
// 卓上の峠は **摩擦律速ではなく舵角律速**（実測: μg=7.85 m/s² に対し v_max=0.7・R=0.35 の横加速度は
// 1.4 m/s² ＝ 使用率 18%。一方 R_min = wheelBase/tan(maxSteer) = 0.292m で、ヘアピン R=0.35m は
// 幾何的にぎりぎり）。∴ 上限は ①摩擦円 ②**曲率を追える舵角** ③車種最高速 の 3 つで決め、
// そこから **制動距離で後退伝播**する。下り勾配は制動能力から差し引く（重力ぶん止まりにくい）。
// **ペース係数 pace**: 上限曲線に一律で掛ける係数。なぜ要るか —
//   pace=1.0（＝物理上限）で走らせると、この全知ドライバは出荷の ToF サンプルより **18.9〜35.7% 速い**
//   （実測 2026-09-06・同一条件 v2/卓上/単車/rejoin ON。比 0.643〜0.811・±30% 帯を 5/18 セルで外れる）。
//   それ自体は「全知・60Hz・
//   速度プロファイル」が買った差で正しいのだが、**基準ドライバは戦術を比べるための土台**であり、
//   利用者が実際に見るペース（＝出荷プログラムのペース）から外れた動作点で測ると、AX3 の
//   「ブロックのコスト/利得」が現実と別の点での話になる。∴ 既定ペースは出荷サンプルへ較正する。
//   AX2 が「その横位置を通ったときの**最大**通過速度」を測るときは pace=1 を明示指定する。
export const PACE_DEFAULT = 0.74;   // 較正値（下の受け入れゲートが 18 セルで帯内を機械確認する）
export function speedProfile(G, car, course, pace = PACE_DEFAULT) {
  const p = car.profile();
  const maxV = CAR.maxSpeed * p.maxSpeed;
  const mu = tireParamsFor(car.tireSet || 'normal').mu0 * (car.grip || 1);
  const aLat = 0.75 * mu * DYN.g;                       // 摩擦円の 75% までを使う（余裕を残す）
  const Rmin = CAR.wheelBase / Math.tan(CAR.maxSteer);
  const dh = +(course.downhill || 0);
  // 制動能力: モーターブレーキは駆動軸のみなので公称 CAR.brake を丸ごとは使えない。実効 45% と見て
  // 下り重力を引く。下限 0.25 m/s²（完全に止まれない設定にはしない）。
  const aBrk = Math.max(0.25, 0.45 * CAR.brake * p.brake - dh);
  const v = new Float64Array(G.n);
  for (let i = 0; i < G.n; i++) {
    const k = Math.abs(G.kap[i]);
    const R = k > 1e-6 ? 1 / k : 1e9;
    let lim = maxV;
    // 摩擦円の制限。**卓上・既定 pace では一度も拘束しない**（実測 2026-09-06: この行を外しても
    // 18 セルの所要が bit 一致）。pace=1 や領域を変えたときに効く保険として残す。
    lim = Math.min(lim, Math.sqrt(aLat * Math.max(R, 0.02)));
    // 舵角律速: 追える最小半径 Rmin より内側の曲率は「曲がりきれない」→ 速度を落として
    // 車体スリップ角と内側へのはみ出しで回る余地を作る（Rmin/R が 1 を超えるほど厳しく絞る）。
    // 舵角律速の減速。**卓上・既定 pace での寄与は小さい**（実測: 外すと 3/18 セルが最大 0.28% 変わる）。
    if (R < Rmin) lim = Math.min(lim, maxV * Math.max(0.35, R / Rmin));
    v[i] = lim * pace;
  }
  for (let i = G.n - 2; i >= 0; i--) {
    const ds = G.s[i + 1] - G.s[i];
    // 制動距離の後退伝播。**卓上・既定 pace での寄与は小さい**（実測: 外すと 3/18 セルが最大 0.09% 変わる）。
    v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * aBrk * ds));
  }
  return { v, maxV, aBrk, aLat, Rmin };
}

// ── 到達可能な横位置（舵角律速のクランプ）────────────────────────────────────────────
// **実測（2026-09-06・峠② normal_ff・latFrac=+0.5）**: ヘアピン内側を指令すると舵が +0.419rad
// （フルロック）に飽和したまま車は指令と逆側へ 0.216m 流れた。原因はドライバの追従不良ではなく
// **幾何**である — 峠②のヘアピンは κ=2.80 (R=0.357m)、内側へ 0.10m 寄ると実効半径が 0.257m となり
// **R_min = wheelBase/tan(maxSteer) = 0.292m を下回って曲がりきれない**。
// ∴ 目標横位置は「その曲率で到達できる範囲」へクランプする。クランプは隠さず **測定値として報告**する
//   （AX2 の「その横位置は到達不能」という結論の一次データになる。CI-14: 代理量でなく実態）。
//   符号: κ>0 = 左旋回 = 内側は +lat 側（曲率中心が左法線側）。κ<0 はその鏡像。
// **回廊は tick ごとに計算せず、幾何から決まる連続関数として 1 回だけ作る**。
// 最初の実装は「現在地〜lookahead の窓の最小値」を毎 tick 取ったが、窓の出入りで**目標そのものが
// 階段状に跳ね**、追従誤差 p95 が 0.157m → 0.317m へ悪化した（実測 2026-09-06）。追えない目標を
// 与えて「追えていない」と測るのは測定として無意味。∴ ① 局所曲率から生の回廊を作り
// ② 先読み窓の min/max で**先に絞り**（コーナー手前から寄せ始める）③ 移動平均で平滑する。
export const RMIN_SAFE = 1.06;   // R_min への安全率（飽和ぎりぎりで走らせない）
const CORR_WIN = 0.30;           // 先読みして絞り始める距離 [m]
const CORR_SM = 0.20;            // 平滑窓（片側）[m]
export function latCorridor(G, safe = RMIN_SAFE) {
  const Rmin = CAR.wheelBase / Math.tan(CAR.maxSteer);
  const n = G.n, hi0 = new Float64Array(n), lo0 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const room = roomAt(G, i), k = G.kap[i], ak = Math.abs(k);
    const c = ak > 1e-6 ? 1 / ak - Rmin * safe : Infinity;
    hi0[i] = (k > 0) ? Math.min(room, c) : room;      // κ>0=左旋回: 内側(+lat)が舵角律速
    lo0[i] = (k < 0) ? Math.max(-room, -c) : -room;   // κ<0=右旋回: 内側(-lat)が舵角律速
  }
  // ② 先読み窓の min/max（前方 CORR_WIN・後方は 1/3 だけ引きずる＝出口で急に開かない）
  const wf = Math.round(CORR_WIN / STEP), wb = Math.round(CORR_WIN / (3 * STEP));
  const hi1 = new Float64Array(n), lo1 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let h = Infinity, l = -Infinity;
    for (let q = Math.max(0, i - wb); q <= Math.min(n - 1, i + wf); q++) { if (hi0[q] < h) h = hi0[q]; if (lo0[q] > l) l = lo0[q]; }
    hi1[i] = h; lo1[i] = l;
  }
  // ③ 移動平均で平滑（目標が連続になる＝追える線になる）
  const ws = Math.round(CORR_SM / STEP);
  const hi = new Float64Array(n), lo = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sh = 0, sl = 0, m = 0;
    for (let q = Math.max(0, i - ws); q <= Math.min(n - 1, i + ws); q++) { sh += hi1[q]; sl += lo1[q]; m++; }
    // **平滑は「絞る方向にだけ」効かせる**。単純な移動平均だと窓 min の谷（＝最も厳しい曲率の点）で
    // 平均が谷より大きくなり、回廊が広がり戻る。初版はこれで実効安全率が 1.06 ではなく **0.916**
    // （＝指令しうる最内線の実効半径が R_min を 8% 下回る）になっていた（層 4 レビュー指摘・実測）。
    // min/max を取れば連続性は保ったまま、窓 min を上回らないことが保証される。
    hi[i] = Math.min(sh / m, hi1[i]); lo[i] = Math.max(sl / m, lo1[i]);
    if (lo[i] > hi[i]) { const mid = (lo[i] + hi[i]) / 2; lo[i] = mid; hi[i] = mid; }   // 左右とも厳しい S 字
  }
  return { hi, lo };
}

// ── 1 tick の指令 ──────────────────────────────────────────────────────────────────
// 操舵 = 純追跡（lookahead 点を横へ latTarget だけずらす）＋ 3 値サーボの理想デューティ量子化。
//   既定サーボ steerSet='tri' は LEFT/CENTER/RIGHT の 3 値しか受けないので、目標舵角に対して
//   「今の実舵角が足りなければ LEFT、行き過ぎなら RIGHT」の bang-bang を打つ（AP14/AU1 と同型）。
// 速度 = pwm は **目標速度比**（v2 の fCmd は (pwm/255·maxV − u) に比例。memory rumicar-v2-pwm-is-target-speed）。
//   超過が大きいときだけ BRAKE を足す。FR のモーターブレーキは後軸ロックなので、既に横滑りしている
//   ときは踏まない（リアが抜けてスピンする）。
const LD0 = 0.09, LD_K = 0.22, LD_MIN = 0.07, LD_MAX = 0.30;   // lookahead [m]

// 以下 3 つは `driveTick` から**純粋に抽出**した部品（式も順序もそのまま。AX2 のコーナー局所測定が
// 同じ追従則を再実装しないため＝CI-14）。抽出後に AX1 ゲートの出力が byte 一致することを確認済み。
export function lookaheadIdx(car, G, i) {
  const Ld = clamp(LD0 + LD_K * Math.abs(car.u), LD_MIN, LD_MAX);
  return Math.min(G.n - 1, i + Math.round(Ld / STEP));
}
// 純追跡の厳密式 δ = atan(2·L·sin(e)/dist) ＋ 3 値サーボ（tri）の理想デューティ量子化。
export function pursueLine(car, G, j, latJ) {
  const tx = G.P[j][0] - Math.sin(G.th[j]) * latJ, ty = G.P[j][1] + Math.cos(G.th[j]) * latJ;
  const e = wrap(Math.atan2(ty - car.y, tx - car.x) - car.theta);
  const dist = Math.max(0.03, Math.hypot(tx - car.x, ty - car.y));
  const want = clamp(Math.atan2(2 * CAR.wheelBase * Math.sin(e), dist), -CAR.maxSteer, CAR.maxSteer);
  car.steerAmt = null;                                  // tri（既定サーボ）= 3 値のみ
  car.steer = (car.steerAngle < want) ? CONST.LEFT : CONST.RIGHT;
  return want;
}
// 目標速度 vT の保持。pwm は **目標速度比**（memory rumicar-v2-pwm-is-target-speed）。超過が大きいときだけ
// BRAKE を足す。FR のモーターブレーキは後軸ロックなので、既に横滑りしているときは踏まない。
export function holdTo(car, vT) {
  const beta = Math.abs(Math.atan2(car.vlat, Math.max(Math.abs(car.u), 1e-6))) * 180 / Math.PI;
  if (car.u > vT + 0.06 && beta < 20) { car.driveDir = CONST.BRAKE; car.pwm = 0; }
  else { car.driveDir = CONST.FORWARD; car.pwm = Math.max(0, Math.min(255, Math.round(vT / (CAR.maxSpeed * car.profile().maxSpeed) * 255))); }
}

export function driveTick(car, G, prof, st, latFrac) {
  // AX3 で「横位置の目標が道の位置ごとに変わる」形が要るため、本体を driveTickFn へ純粋抽出した。
  // 定数 latFrac は「どの位置でも同じ値を返す関数」として渡す＝式も評価順も従来と同一（AX1/AX2 ゲートの
  // 出力が抽出の前後で byte 一致することを確認済み。AX2 の lookaheadIdx/pursueLine/holdTo 抽出と同じ作法）。
  return driveTickFn(car, G, prof, st, () => latFrac);
}
// latFn(i) → その中心線インデックスでの横位置比 latFrac∈[-1,1]（+ = 中心線の左）。
export function driveTickFn(car, G, prof, st, latFn) {
  const i = st.i;
  const room = roomAt(G, i);
  const f = clamp(latFn(i), -1, 1);
  // lookahead は速度連動。狭い所（room 小）では短くして内側を舐めない。
  const j = lookaheadIdx(car, G, i);
  // 到達可能な回廊（幾何から決めた連続関数）へ指令をクランプする。
  const req = f * room;                                   // 素の要求
  const latTarget = clamp(req, G.loLat[i], G.hiLat[i]);
  const clamped = Math.abs(latTarget - req);
  const fj = clamp(latFn(j), -1, 1);
  const latJ = clamp(fj * roomAt(G, j), G.loLat[j], G.hiLat[j]);
  const want = pursueLine(car, G, j, latJ);
  const vT = prof.v[i];
  holdTo(car, vT);
  return { latTarget, latReq: req, clamped, room, want, vT };
}

// ── 単車走行（本番の makeSlot / rebuildSpawns / integrateFleetV2 / LapTracker を使う）──────
// 返り値はすべて **測定述語の材料**（形容詞を返さない・CI-14）。
//   finished  : LapTracker（touge 分岐）が立てたゴール成立フラグ ＝ 完走の正
//   t         : lap.totalTime（ゴール時点で凍結）
//   crashed / recoverArms : 壁で止まったか・後退復帰が何回 arm したか
//   latErrMed / latErrP95 : |実横位置 − 目標横位置| の中央値 / 95 パーセンタイル（過渡 0.5s を除く）
//   nonMono   : 進行度が 1 tick で 0.05m 以上戻った回数（trackerOf の方式の健全性）
// `road:false` は **計測アーム**（本番の既定は true）。予備実装が `slot._road` を渡さずに走らせていた
// ことの影響を、ゲートが差分で示すために置く（wf_drift_reexam の `--brake=` と同型の比較アーム）。
export function runTouge({ spec, carType, latFrac = 0, mode = 'window', maxSec = 90, recover = true, pace = PACE_DEFAULT, safe = RMIN_SAFE, road = true, onTick = null }) {
  const course = buildFromSpec(spec);
  const G = tougeGeom(course, safe);
  const slot = makeSlot({ i: 0, lang: 'c', src: '', course, slotCount: 1, logFor: () => (() => {}) });
  slot.carType = carType; slot.car.type = carType;
  rebuildSpawns([slot], course, null);
  slot.car.reset(slot.spawn);
  slot.lap.reset(course, { carType, persist: false });   // 練習記録 localStorage に触らない（公式と同じ扱い）
  if (!road) slot._road = null;    // 計測アームのみ（既定 true では makeSlot/rebuildSpawns が入れた値のまま）
  slot.running = true;
  const car = slot.car;
  const prof = speedProfile(G, car, course, pace);
  const track = trackerOf(G, mode);
  const errs = [], errsFree = [], errsBind = [];
  let recoverArms = 0, prevRec = 0, nonMono = 0, prevS = null, t = 0, maxRecoverN = 0;
  let clampTicks = 0, clampMax = 0, driveTicks = 0, steerSatTicks = 0;
  // **壁接触の実測**。v2 × recover=true では `car.crashed` は構造的に立たない
  // （`fleet.js:635` の分岐が `!recover` で守られている）ので、「壁で止まっていない」を crashed で
  // 測るアサートは恒真になる（層 4 レビュー指摘）。∴ 製品のオラクル `checkCollision` を毎 tick 呼び、
  // 接触 tick 数と、車体四隅から側壁までの最小クリアランスを連続量で出す（CI-14・再実装しない）。
  const side = sideWallsOf(course);
  let contactTicks = 0, minClear = Infinity;
  const maxTicks = Math.round(maxSec / DT);
  let ticks = 0;
  for (; ticks < maxTicks; ticks++) {
    const st = track(car.x, car.y);
    if (prevS != null && st.s - prevS < -0.05) nonMono++;
    prevS = st.s;
    const cmd = driveTick(car, G, prof, st, latFrac);
    driveTicks++;
    if (cmd.clamped > 1e-9) { clampTicks++; if (cmd.clamped > clampMax) clampMax = cmd.clamped; }
    if (Math.abs(cmd.want) > CAR.maxSteer - 1e-9) steerSatTicks++;
    if (onTick) onTick({ tick: ticks, t, car, st, cmd, G, prof });
    integrateFleetV2([slot], DT, course.walls, recover, false);
    t += DT;
    if (checkCollision(car, course.walls)) contactTicks++;
    for (const e of carEdges(car)) {
      const a = { x: e.x1, y: e.y1 }, b = { x: e.x2, y: e.y2 };
      for (const w of side) {
        const wa = { x: w.x1, y: w.y1 }, wb = { x: w.x2, y: w.y2 };
        const d = Math.min(distToSeg(a, wa, wb), distToSeg(b, wa, wb), distToSeg(wa, a, b), distToSeg(wb, a, b));
        if (d < minClear) minClear = d;
      }
    }
    if (car.recoverT > prevRec + 1e-9) recoverArms++;
    prevRec = car.recoverT;
    if ((car.recoverN || 0) > maxRecoverN) maxRecoverN = car.recoverN;
    if (t > 0.5) {
      const e = Math.abs(st.lat - cmd.latTarget);
      errs.push(e);
      (cmd.clamped > 1e-9 ? errsBind : errsFree).push(e);   // 回廊が拘束した tick と、していない tick を分ける
    }
    if (slot.lap.finished) break;
    if (car.crashed) break;
  }
  const qOf = (arr) => { arr.sort((a, b) => a - b); return (f) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * f))] : null); };
  const q = qOf(errs), qF = qOf(errsFree), qB = qOf(errsBind);
  return {
    course, G, prof,
    finished: !!slot.lap.finished,
    t: slot.lap.finished ? slot.lap.lastLap : null,
    crashed: !!car.crashed,
    recoverArms, maxRecoverN, nonMono, ticks,
    contactTicks, minClear: Number.isFinite(minClear) ? minClear : null,
    latErrMed: q(0.5), latErrP95: q(0.95), latErrN: errs.length,
    // 回廊が拘束していない tick（＝指令した横位置が到達可能）だけの誤差 / 拘束した tick だけの誤差。
    // 合否は上の全 tick 中央値（より厳しい側）で採る。下は「どこで外れたか」を切り分ける診断値。
    latFreeMed: qF(0.5), latFreeP95: qF(0.95), latFreeN: errsFree.length,
    latBindMed: qB(0.5), latBindP95: qB(0.95), latBindN: errsBind.length,
    // 「その横位置は到達不能だった」の一次データ（AX2 が使う）。隠さず数で出す。
    clampFrac: driveTicks ? clampTicks / driveTicks : 0, clampMax,
    steerSatFrac: driveTicks ? steerSatTicks / driveTicks : 0,
    endX: car.x, endY: car.y, endTheta: car.theta, endU: car.u,
    // 走行条件の実測（ゲートが「本当にその条件で走ったか」を構造で確かめるための返り値）
    roadActive: !!slot._road, engine: car.engine, steerSet: car.steerSet, tireSet: car.tireSet,
    brakeSet: car.brakeSet, gearSet: car.gearSet, suspSet: car.suspSet, downhill: +(course.downhill || 0),
  };
}

// ── コーナーの同定（AX2/AX3 が共有する定義）──────────────────────────────────────────
// **コーナー = |κ| がしきい値以上の連続区間**。しきい値は「R ≤ 1.0m」= κ ≥ 1.0 とする
//   （出荷 6 峠の中心線 minR は 0.278〜0.636m ＝ どの峠にもコーナーが立つ最小のしきい値。
//    これより厳しくすると架空峠(緩斜面) の minR=0.636m が 1 本も拾えなくなる）。
//   切れ目 0.10m 以内は同じコーナーとして結合し、**車長 0.19m に満たない区間は捨てる**
//   （車が姿勢を作れない長さの「コーナー」は測定単位にならない）。
// 返す各コーナーは 到達可能性・通過速度・区間所要の測定単位になる。
export const CORNER_KAPPA = 1.0;
export function cornersOf(G, kappaTh = CORNER_KAPPA) {
  const runs = []; let st = -1;
  for (let i = 0; i < G.n; i++) {
    const hi = Math.abs(G.kap[i]) >= kappaTh;
    if (hi && st < 0) st = i;
    // 終端は「まだ閾値を満たしている最後の点」。閾値を割った最初の点まで含めると系統的に
    //   1 標本（0.02m）長くなる（層 4 レビュー指摘・実測 20/20 コーナーで該当）。
    if ((!hi || i === G.n - 1) && st >= 0) { runs.push([st, hi ? i : i - 1]); st = -1; }
  }
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && G.s[r[0]] - G.s[last[1]] < 0.10) last[1] = r[1]; else merged.push([...r]);
  }
  const out = [];
  for (const [a, b] of merged) {
    if (G.s[b] - G.s[a] < CAR.length) continue;
    let kMax = 0, sign = 0, hwMin = Infinity;
    for (let i = a; i <= b; i++) {
      const k = G.kap[i];
      if (Math.abs(k) > kMax) { kMax = Math.abs(k); sign = Math.sign(k); }
      if (G.hw[i] < hwMin) hwMin = G.hw[i];
    }
    out.push({ i0: a, i1: b, s0: G.s[a], s1: G.s[b], len: G.s[b] - G.s[a],
      kMax, sign, R: 1 / kMax, hwMin, usable: hwMin - CAR.width / 2 });
  }
  return out;
}

// 横位置 lat（+lat = 中心線の左）が、符号付き曲率 sign・半径 R のコーナーで **幾何だけから**
// 到達可能とみなせるか（舵角律速のみ。道幅・車体余白は見ない）。**判定には使わない** —
// AX2 は実走で到達可能性を決め、この式は「代理量がどれだけ外すか」の比較にだけ使う（CI-14）。
export function latReachable(lat, R, sign, safe = 1) {
  const latIn = sign > 0 ? lat : -lat;      // κ>0 = 左旋回 = 内側は +lat 側
  return (R - latIn) >= (CAR.wheelBase / Math.tan(CAR.maxSteer)) * safe;
}

// ── コーナー局所の測定（AX2「その横位置を通ったときの最大通過速度」の実行器）───────────
// **なぜコーナー局所か**: 20 コーナー × 横位置 7 × 速度の二分探索 を毎回コース全体で走らせると
//   実行時間が桁違いになる（ゲートとして常設できない）。コーナーの手前 RUNUP から出口までだけを
//   走らせる。**使うものは本番と同一**（buildFromSpec の壁・makeSlot のスロットと路面フレーム・
//   integrateFleetV2・checkCollision）で、違うのは **開始位置と開始速度＝初期条件だけ**である
//   （wf_touge_drift_probe / wf_ao8 の `toSpeed` が原点へ置き直すのと同型）。
// **初速は与えず、静止から助走で作る**（`car.u` を直接書くと車輪速 `_vw` が 0 のままで
//   t=0 に「ロックしたまま滑っている」状態になり、測ろうとしている物理と別物になる）。
//   助走 0.6m の妥当性は **実測**で確かめる（v2 の駆動力は目標との差に比例する一次遅れなので、
//   等加速度の式 v²/2a では根拠にならない）。実測: 到達可能点の入口速度は指令の 0.995〜1.071 倍。
//   実際に入口で目標速度に乗ったかは戻り値 `vEntry` で呼び出し側が確かめること（空振り防止）。
const CORNER_RUNUP = 0.6, CORNER_EXIT = 0.15;
export function runCornerLine({ spec, carType, corner, latAbs, speed, maxSec = 20, course = null, G = null, road = true }) {
  const crs = course || buildFromSpec(spec);
  const geo = G || tougeGeom(crs);
  const slot = makeSlot({ i: 0, lang: 'c', src: '', course: crs, slotCount: 1, logFor: () => (() => {}) });
  slot.carType = carType; slot.car.type = carType;
  rebuildSpawns([slot], crs, null);
  // 開始インデックス = コーナー入口の CORNER_RUNUP 手前
  let iStart = corner.i0;
  while (iStart > 0 && geo.s[corner.i0] - geo.s[iStart] < CORNER_RUNUP) iStart--;
  const x0 = geo.P[iStart][0] - Math.sin(geo.th[iStart]) * latAbs;
  const y0 = geo.P[iStart][1] + Math.cos(geo.th[iStart]) * latAbs;
  slot.car.reset({ ...slot.spawn, x: x0, y: y0, theta: geo.th[iStart] });   // 路面属性(downhill/grip)は spawn のまま
  if (!road) slot._road = null;      // 計測アーム（既定 true では makeSlot/rebuildSpawns が入れた値のまま）
  slot.lap.reset(crs, { carType, persist: false });
  slot.running = true;
  const car = slot.car, side = sideWallsOf(crs);
  const track = trackerOf(geo, 'window');
  const iEnd = Math.min(geo.n - 1, corner.i1 + Math.round(CORNER_EXIT / STEP));
  const errs = [];
  // **接触は全 tick で見る**。コーナー窓の中だけで見ていた初版は、助走 0.6m の区間で壁へめり込んだ
  //   走行を「接触 0」として通していた（層 4 レビュー・実測 3 件が 9 tick ずつめり込んでいた）。
  //   `contactIn` はコーナー窓内だけの内訳（診断用）。
  let t = 0, tIn = null, tOut = null, vEntry = null, contact = 0, contactIn = 0, arms = 0, prevRec = 0, minClear = Infinity;
  let reached = false, ticks = 0;
  const maxTicks = Math.round(maxSec / DT);
  for (; ticks < maxTicks; ticks++) {
    const st = track(car.x, car.y);
    if (st.i >= corner.i0 && tIn == null) { tIn = t; vEntry = car.u; }
    if (st.i >= iEnd) { tOut = t; reached = true; break; }
    const j = lookaheadIdx(car, geo, st.i);
    pursueLine(car, geo, j, latAbs);
    holdTo(car, speed);
    integrateFleetV2([slot], DT, crs.walls, true, false);
    t += DT;
    if (car.recoverT > prevRec + 1e-9) arms++;
    prevRec = car.recoverT;
    const hitNow = checkCollision(car, crs.walls);
    if (hitNow) contact++;
    if (st.i >= corner.i0 - Math.round(0.10 / STEP) && st.i <= iEnd) {
      errs.push(Math.abs(st.lat - latAbs));
      if (hitNow) contactIn++;
      for (const e of carEdges(car)) {
        const a = { x: e.x1, y: e.y1 }, b = { x: e.x2, y: e.y2 };
        for (const w of side) {
          const wa = { x: w.x1, y: w.y1 }, wb = { x: w.x2, y: w.y2 };
          const d = Math.min(distToSeg(a, wa, wb), distToSeg(b, wa, wb), distToSeg(wa, a, b), distToSeg(wb, a, b));
          if (d < minClear) minClear = d;
        }
      }
    }
  }
  errs.sort((a, b) => a - b);
  return {
    reached, contact, contactIn, arms, ticks, roadActive: !!slot._road,
    vEntry, secT: (reached && tIn != null) ? tOut - tIn : null,
    latMed: errs.length ? errs[Math.floor(errs.length * 0.5)] : null,
    latP95: errs.length ? errs[Math.min(errs.length - 1, Math.floor(errs.length * 0.95))] : null,
    minClear: Number.isFinite(minClear) ? minClear : null, nErr: errs.length,
  };
}

// 峠コースの spec を courses.json から取り出す（呼び出し側の重複を避ける）。
// **AX3 の派生峠（`derivedFrom` 持ち・道幅を詰めた狭路版）は含めない** — AX1/AX2 のゲートは「出荷の峠 6 本 × …」を
// 前提に母集団を数えており、派生を混ぜると 18 セルが 72 セルになり D-0/D-3/D-5 が意味を変える（wf_run_all で実測・赤）。
// 派生が要るときは derivedTougeSpecs() を使う。
export function tougeSpecs(specs) { return specs.filter((c) => c.kind === 'touge' && !c.derivedFrom); }
export function derivedTougeSpecs(specs) { return specs.filter((c) => c.kind === 'touge' && !!c.derivedFrom); }
export const CAR_KEYS = ['normal_fr', 'normal_awd', 'normal_ff'];   // FR / AWD / FF（UI 既定 3 台）

// ══════════════════════════════════════════════════════════════════════════════════════
// Stage AX3 — 多車・片道レースでのブロック戦術の測定（道幅比の掃引を含む）。受け入れゲートは wf_ax3_block.mjs。
// ══════════════════════════════════════════════════════════════════════════════════════
// ── 設計時に実測で決めた前提（2026-09-07・卓上 v2・normal_fr・装備既定）───────────────────────
//  ・**卓上 v2 normal では持続ドリフトは成立しない**: 自由空間で全開＋フル舵を 1.5 秒当てても |β| は 11〜12° で
//    頭打ち（ヨー角速度は舵角律速 u/R_min ≈ 2.5 rad/s で飽和。μg=7.85 に対し accel=2.5 ゆえパワーオーバーは出ない）。
//    後軸ロック（FR の BRAKE）で β は一時的に 18〜28° に振れるが 0.2〜0.3 秒で **停止** する。
//    ∴ 戦術 `drift` は「コーナー入口で後軸ロック＋フル舵で姿勢を崩し、内側を占有する」の意味に**限定**して実装し、
//    実際に出た |β| のピークと「滑って走っていた tick の割合」を測定値として返す（できたと言い張らない）。
//  ・戦術 `sideways`（横向き）は滑りでは作れない（上記）ので **停止→3 点旋回で車体を道に対し ψ 度傾ける→保持** で
//    作る。実測（峠②ヘアピン・solo）: ψ=30°/45° を壁接触 0 で作れるが、所要は 21.3s → 35〜40s。ψ=60° は復帰不能。
//  ・本番 `freeSpawn` は峠のスタート背後 0.14m がフタ壁なので **4 台目以降を前方に置く**（実測: 峠②で 2〜3 台目は横並び、
//    4 台目以降 s=0.80/0.80/1.02m）。台数によって先頭＝スロット 0 にならないため、AD1 の本番経路 `rebuildSpawns(slots, course, grid)` に **中心線上の等間隔グリッド**
//    を渡す（先頭が最前・以降が後方）。グリッド点は checkCollision で壁交差 0 を確かめる。
//  ・車種は全車 `normal_fr`（AX2 の代表車種・先頭と追走を同条件に）。先頭のペースは PACE_DEFAULT（出荷サンプル較正）、
//    追走は paceRatio 倍（>1 でないと「順位を守れるか」が測れない）。pace>1 は holdTo の pwm クランプで車種最高速に飽和。
import { CAR_FOOTPRINT } from './public/js/config.js';
import { applyStartGate } from './public/js/fleet.js';
import { slopOf } from './public/js/contact_v2.js';

export const AX3 = {
  WIDTH_LEVELS: [4.5, 3.0, 2.0],   // 派生コースの道幅（車幅の何台分か・実車の峠 ≈ 2 台分）。現行は各峠の hw そのまま
  DESC_STAMP: '2026-09-07',        // 派生コースの desc に刻む「追加時の実測」の日付（ゲート H-0c が desc 全文を再生成して照合する）
  NEAR_FRAC: 0.5,       // 「接近」とみなす車体間距離 = NEAR_FRAC × slop（追走の指令間隙 M_SIDE は slop と同値なので、指令どおりの
                        //   並走を接近に数えないよう slop の半分＝0.01m より内側だけを接近とする。層 4 レビュー 2 巡目 重要-A）
  SPACING: 0.25,        // グリッドの車間（弧長）[m]＝1.3 車長（spawnSep 0.221m を超える）
  S_TAIL: 0.20,         // 最後尾の位置（弧長）[m]。先頭 = S_TAIL + (N−1)·SPACING
  W_PASS: 0.60,         // 追走が「前に車がいる」とみなす前方距離 [m]
  D_FOLLOW: 0.35,       // 塞がれているとき速度を合わせ始める距離 [m]（1.8 車長）
  M_SIDE: 0.02,         // 横に並ぶときの車体余白 [m]
  K_FOLLOW: 2.0,        // 追従則の距離ゲイン [1/s]
  D_SAFE: 0.06,         // 追従の車間余白 [m]（車長に足す）
  T_ROT: 5.0,           // `sideways` の 3 点旋回の時間上限 [s]（狭路で目標角に届かないときは到達した角で保持へ。
                        //   実測 2026-09-07・内側回転: 3s では 30° 到達 42%・5s で 71%）
  PRE_RACE: 0.30,       // `race` がコーナーの内側へ寄り始める手前距離 [m]（ドライバの lookahead 上限と同じ）
  WALL_MARGIN: 0.04,    // 走行線が壁側に残す余白 [m]（= 0.5×車幅 = AX1 の追従許容。追従の揺れで壁を擦らない。race/inside 共通）
  ROT_DIR: 'in',        // `sideways` の 3 点旋回の向き: 'in'=鼻を内壁側へ振りテールを道へ張り出す（採用）／'out'=鼻を外へ振る。
                        //   実測 2026-09-07（峠 6 × 幅 3 × 反復 6 = 108 レース・ペース比 1.35）: 'out' は 30° 到達 100% だが
                        //   行き過ぎて ψ 平均 111°・復帰で外壁に刺さり DNF 34/108・先頭 1 位 6/108。'in' は ψ 平均 38°・DNF 2〜3・1 位 26/108。
  D_TRIG: 0.50,         // `sideways` を発動する追走の後方距離 [m]
  PSI_TARGET: 35 * Math.PI / 180,   // `sideways` の目標姿勢角（道の接線に対して）
  PSI_RESUME: 15 * Math.PI / 180,   // 復帰完了とみなす姿勢角
  T_HOLD: 1.5,          // `sideways` の保持時間上限 [s]
  ROT_PWM: 90,          // 3 点旋回の pwm（目標速度比 90/255 ≈ 0.25 m/s）
  ROT_CLEAR: 0.015,     // 3 点旋回で前後を切り替える壁クリアランス [m]
  // `drift` の定数は solo 掃引（峠 6 × 道幅 現行/3.0 = 12 セル・brake {3,6,9} × β {10,15,25}）で「完走 12/12 かつ recover 0 の
  // 組の中で滑走 tick 割合が最大」の組を採った（2026-09-07: brake=3/β=25 → driftFrac 8.0%・βpk 平均 28.3°・spinAbort 2）。
  DRIFT_BRAKE_TICKS: 3, // コーナー入口の後軸ロック tick 数（6 以上は recover が出る組が増え、9 tick は停止する）
  DRIFT_BETA: 25,       // 滑り角目標 [deg]
  DRIFT_SPIN: 50,       // これを超える |β| はスピンとみなし保持相を打ち切る [deg]（打ち切り回数は spinAborts で返す）
  DRIFT_KP: 0.05, DRIFT_KD: 0.002,   // 逆ハン比例則（wf_touge_drift_probe GAINS と同一）
  DRIFT_PRE: 0.10,      // コーナー入口の何 m 手前でブレーキを当てるか
  // 派生コースで「多車レースなのに発走できない車が出る」既知の制限（AX4・2026-09-07 に本番オラクル runRace/driveableCapN で実測）。
  //   狭路では前方に置かれた車が give-up し、AK7 の発走順次化で後続が永久 held になる。driveableCapN は cap=4 を返すので
  //   ライブは n=3 のレースを許す＝**利用者から見える挙動**。利用者裁定（2026-09-07）は「公開に残す＋コース説明に注記」。
  //   **ここが単一真実源**: (a) derivedTougeSpec が desc/desc_en の注記を作り、(b) wf_recover_model.mjs の既知例外リストが
  //   同じ配列から名前を導く。2 箇所に書くと必ずドリフトする（RATELIMIT-1 の教訓「同じ門を全経路に通す」）。
  //   base=元の峠名 / widthCars=道幅水準 / n=発生する出走台数 / stuck=動けない台数 / okN=起きないと実測した台数（n≤cap の範囲）
  KNOWN_STUCK: [{ base: '架空峠 ロング・ワインディング(激坂)', widthCars: 2.0, n: 3, stuck: 2, okN: [2, 4] }],
};
export const TACTICS = ['race', 'inside', 'sideways', 'drift'];

// 道幅を車幅 widthCars 台分へ詰めた派生コースの spec を作る。中心線（rows/dy/…）は変えず hw だけ替える＝コーナーの
// R も downhill も同一で、変わるのは壁だけ。公開 courses.json に載せる形（name_en/desc/desc_en/diff）まで作る。
// `derivedFrom`/`widthCars` は機械識別用のメタ（buildFromSpec は未知フィールドを無視する）。
// descCompl = 追加時に本番既定（dynamic・既定 3 サンプル・干渉あり・rejoin OFF＝wf_as3_samples と同条件）で測った
// 完走台数（正直に書く・PLAN AX3）。省略時は文言を出さない。stamp = その実測の日付（AX3.DESC_STAMP）。
export function derivedTougeSpec(base, widthCars, descCompl = null, stamp = null) {
  const hw = +(widthCars * CAR_FOOTPRINT.hw).toFixed(4);   // 半幅 = 台数 × 車幅/2（CAR_FOOTPRINT.hw = 設計車幅/2 = 0.04）
  const lv = (widthCars % 1 === 0) ? String(widthCars) : widthCars.toFixed(1);
  const room = +(2 * hw - 2 * (2 * CAR_FOOTPRINT.hw)).toFixed(3);   // 横に 2 台並ぶ余地 [m]
  const ja = `${base.name}〔道幅 ${lv} 台分〕`;
  const en = `${base.name_en} [${lv}-Car Width]`;
  // 完走数は日付でスタンプする（版でスタンプすると「その版のリリース物に含まれる」と読めるが、追加時点の版は既にタグ済で
  //   この派生を含まない＝層 4 レビュー 軽-13）。
  const complJa = descCompl != null ? `追加時${stamp ? '（' + stamp + '）' : ''}の実測: 既定 3 サンプル中 ${descCompl} 台が完走。` : '';
  const complEn = descCompl != null ? ` At the time of addition${stamp ? ' (' + stamp + ')' : ''}, ${descCompl} of the 3 built-in samples finished.` : '';
  // 多車レースの既知の制限（AX3.KNOWN_STUCK が単一真実源）。該当しない派生コースでは空文字。
  const ks0 = AX3.KNOWN_STUCK.find((e) => e.base === base.name && e.widthCars === widthCars);
  const ks = ks0 && ks0.okN && ks0.okN.length ? ks0 : null;   // okN が空だと「（…では起きません）」が空文になる（層 4 レビュー #2 軽-5）
  const stuckJa = ks ? `【多車レースの既知の制限】${ks.n} 台で走らせると、前方に置かれた車が狭路で走行を諦め、後続 ${ks.stuck} 台が発走待ちのまま一度も動きません（${stamp ? stamp + ' 実測。' : ''}${ks.okN.map((v) => v + ' 台').join('・')}では起きません）。` : '';
  const stuckEn = ks ? ` [Known limitation in multi-car races] With exactly ${ks.n} cars, the car placed ahead gives up on the narrow road and the ${ks.stuck} cars behind it stay in the starting queue, never moving at all (${stamp ? 'measured ' + stamp + '; ' : ''}this does not happen with ${ks.okN.join(' or ')} cars).` : '';
  const descJa = `${base.desc}【狭路版】実車の峠に近い道幅比（車幅 ${lv} 台分＝${(2 * hw).toFixed(2)}m）まで壁を寄せた派生コース。` +
    (room <= 0 ? '横に 2 台並ぶ余地は 0＝追い越しは幾何的に不可能。' : `横に 2 台並ぶ余地は ${room.toFixed(2)}m。`) +
    `出荷の既定サンプルは完走しにくい。${complJa}${stuckJa}`;
  const descEn = `${base.desc_en} [Narrow variant] Walls moved in to a road-width ratio close to a real mountain pass (${lv} car widths = ${(2 * hw).toFixed(2)} m).` +
    (room <= 0 ? ' No room for two cars abreast: overtaking is geometrically impossible.' : ` Room for two abreast: ${room.toFixed(2)} m.`) +
    ` The built-in sample programs struggle to finish.${complEn}${stuckEn}`;
  return { ...base, name: ja, name_en: en, hw, desc: descJa, desc_en: descEn, diff: 5, derivedFrom: base.name, widthCars };
}
// 横に 2 台並ぶ幾何的余地 [m]（負なら並べない）。道幅 − 2×車幅。
export function roomForTwo(spec) { return 2 * spec.hw - 2 * CAR.width; }

// ── コーナーの「側」の前計算 ──────────────────────────────────────────────────────────
// sideNext[i] = i が属する／次に来るコーナーの旋回符号（+1=左旋回=内側は +lat）。最後のコーナーを過ぎたら 0。
// distNext[i] = 次のコーナー入口までの弧長（コーナー内は 0）。inCorner[i] = コーナー番号 or −1。
export function cornerMap(G, corners) {
  const n = G.n, sideNext = new Int8Array(n), distNext = new Float64Array(n), inCorner = new Int16Array(n).fill(-1);
  let k = 0;
  for (let i = 0; i < n; i++) {
    while (k < corners.length && corners[k].i1 < i) k++;
    if (k >= corners.length) { sideNext[i] = 0; distNext[i] = Infinity; continue; }
    const c = corners[k];
    sideNext[i] = c.sign;
    distNext[i] = i >= c.i0 ? 0 : G.s[c.i0] - G.s[i];
    if (i >= c.i0 && i <= c.i1) inCorner[i] = k;
  }
  return { sideNext, distNext, inCorner };
}
// 先頭の走行線: `race` = 手前 PRE_RACE から次コーナーの内側へ f だけ寄る／`inside` = 次コーナーの内側いっぱい（前コーナーの
// 出口から。最後のコーナーを過ぎたら中心線＝ゴールまでの直線ではブロックしない。「いっぱい」は下の壁余白ぶん内側）。
// **道幅 2.0 台分では room ≤ WALL_MARGIN なので k(i)=0 となり、race/inside/sideways/drift の基準線がすべて中心線に縮退する**
// （層 4 重要-1）。ゲートはこの水準の inside 条件を「判定不能（線が同一）」として別枠で数える。
// **どの走行線も壁側に追従誤差ぶんの余白 WALL_MARGIN を残す**（room は壁余白 0.01m しか持たないので、f=1.0 をそのまま
// 指令すると追従の揺れで壁を擦り復帰ループに落ちる＝実測: 架空峠(緩斜面) の内側線 solo が 10.8s → 57.9s）。余白は
// race/inside に一様に掛ける（片方だけ掛けると「inside が race より外側」という定義上の逆転が狭路で起きる＝実測）。
// 舵角律速で決まる回廊の端（峠②のヘアピン）は driveTickFn のクランプがそのまま守る（壁ではないので余白不要）。
// 返り値は driveTickFn が roomAt(G,i) に掛ける比なので、有効余地 (room − WALL_MARGIN) / room を掛けて返す。
export function lineFn(kind, f, cm, G = null) {
  const k = (i) => { const room = G ? roomAt(G, i) : 0; return room > 1e-6 ? Math.max(0, (room - AX3.WALL_MARGIN) / room) : 0; };
  if (kind === 'inside') return (i) => cm.sideNext[i] * k(i);
  return (i) => (cm.distNext[i] <= AX3.PRE_RACE ? cm.sideNext[i] * f * k(i) : 0);
}

// 中心線上の等間隔グリッド（AD1 の本番経路 rebuildSpawns(slots, course, grid) へ渡す）。
// index 0 が先頭（最前）。latStart は追走（index≥1）の横位置（余地に対する比）。
// **置いた車体が壁に入らず・前の車と重ならず・実車間 ≥ MIN_SEP になるまで、弧長を STEP ずつ後ろへずらす**。
//   層 4 レビュー（致命-1/重要-3）: 弧長で等間隔に置くだけだと (a) 6 台目が架空峠(激坂)〔2 台分〕の壁に埋まった状態で
//   発走し（--full の A-2 が gridHit 108 で赤）、(b) 曲線の内側へ寄せると実車間が 0.25·(1−lat·κ) に縮んで車体が重なる
//   （緩斜面・6 台・lat=−0.5 で実測）。本番 freeSpawn は壁と重なりを見るが、grid を渡すと丸ごとバイパスされる
//   （fleet.js rebuildSpawns）ので、ここで製品オラクル checkCollision/carEdges で見る。返り値の `shift` は後退させた合計弧長 [m]。
export function gridOnCenterline(G, nCars, latStart = 0, walls = null) {
  const poseAt = (j, lat) => ({ x: G.P[j][0] - Math.sin(G.th[j]) * lat, y: G.P[j][1] + Math.cos(G.th[j]) * lat, theta: G.th[j] });
  const minSep = Math.hypot(CAR.length, CAR.width) + 0.015;   // = fleet.js spawnSep()（非 export なので式を写す・carScale に追随）
  // 先頭の弧長 lead から前→後ろへ置く。後退が必要になった車の分だけ後続もずれる（累積 shift）。**最後尾が S_TAIL より
  // 手前に落ちたら（スタート背後のフタ壁へ入る）、その不足分だけ先頭を前へ出して置き直す**（層 4 レビュー 2 巡目 致命-A:
  // 初版は shift を後続へ累積するだけで先頭を動かさず、架空峠(激坂)〔2 台分〕の 6 台目がフタ壁の中に置かれた）。
  let lead = AX3.S_TAIL + (nCars - 1) * AX3.SPACING;
  for (let attempt = 0; attempt < 50; attempt++) {
    const grid = [], placed = [];
    let shift = 0, short = false;
    for (let i = 0; i < nCars; i++) {
      const sPos = lead - i * AX3.SPACING - shift;
      let j = 0; while (j < G.n - 1 && G.s[j] < sPos) j++;
      let done = false;
      for (let guard = 0; guard < 400; guard++) {
        const lat = i === 0 ? 0 : clamp(latStart * roomAt(G, j), G.loLat[j], G.hiLat[j]);
        const g = poseAt(j, lat);
        const car = new Car(g);
        const wallHit = walls ? checkCollision(car, walls) : false;
        const tooClose = placed.some((q) => Math.hypot(q.x - g.x, q.y - g.y) < minSep || checkCollision(car, [], carEdges(new Car(q))));
        if (G.s[j] < AX3.S_TAIL - 1e-9) { short = true; break; }             // S_TAIL より手前には置かない（フタ壁側・受理前に検査）
        if (!wallHit && !tooClose) { grid.push(g); placed.push(g); done = true; break; }
        j--; shift += STEP;                                                   // 1 標本（0.02m）だけ後ろへ
      }
      if (!done) { short = true; break; }
    }
    if (!short) return Object.assign(grid, { shift, lead });
    lead += Math.max(STEP, AX3.SPACING);   // 最後尾が S_TAIL を割った: 先頭を前へ出して置き直す
    if (lead > G.total * 0.5) break;       // 先頭がコースの半分より先には置かない（ゴール直前に湧く grid を返さない・3 巡目 軽-5）
  }
  // 置けない（道が短すぎる・台数が多すぎる）: 無言で freeSpawn へ落ちる（rebuildSpawns の grid[i]=undefined）より例外で止める
  throw new Error(`gridOnCenterline: ${nCars} 台を S_TAIL=${AX3.S_TAIL}m 以降に壁交差・重なりなしで置けない`);
}

const beta = (c) => Math.atan2(c.vlat, Math.max(Math.abs(c.u), 1e-6)) * 180 / Math.PI;
// 3 値サーボへの理想デューティ量子化（norm∈[-1,1]・正=LEFT）。wf_touge_drift_probe の applySteer と同一。
function steerNorm(car, norm) {
  const n = clamp(norm, -1, 1);
  car.steer = (car.steerAngle < n * CAR.maxSteer) ? CONST.LEFT : CONST.RIGHT; car.steerAmt = null;
  return n;
}
function minWallClear(car, side) {
  let m = Infinity;
  for (const e of carEdges(car)) {
    const a = { x: e.x1, y: e.y1 }, b = { x: e.x2, y: e.y2 };
    for (const w of side) {
      const wa = { x: w.x1, y: w.y1 }, wb = { x: w.x2, y: w.y2 };
      const d = Math.min(distToSeg(a, wa, wb), distToSeg(b, wa, wb), distToSeg(wa, a, b), distToSeg(wb, a, b));
      if (d < m) m = d;
    }
  }
  return m;
}

// ── 多車・片道レース ───────────────────────────────────────────────────────────────────
// 返り値はすべて測定述語の材料（CI-14）。
//   rank[]/t[]/finished[] : 各車の着順（到達時刻順・未完走は末尾）・到達時刻・完走
//   leaderRank / leaderT  : 先頭（index 0）の着順と到達時刻
//   contacts              : 車車の重なりが 1 組以上あった tick 数（製品オラクル checkCollision・carEdges）
//   leaderContact         : 先頭が他車と重なっていた tick 数
//   leaderNear            : 先頭の車体が他車の車体から NEAR_FRAC×slop（=0.01m）より内側にあった tick 数（重なり無しの接近。追走の
//                           指令間隙 0.02m での並走は含めない）
//   recoverArms           : 全車の後退復帰 arm 回数
//   nonMono / nonMonoLeader : 進行度が 1 tick で 0.05m 以上逆行した回数（全車合計／うち先頭。trackerOf の健全性。AX1 F-2 と同じ述語）
//   gapAtFinish           : 先頭がゴールした瞬間の、まだゴールしていない直後の車との弧長差 [m]（抜かれていれば負・後続がゴール済のみなら null）
//   gridHit / gridShift   : グリッドの壁交差＋車車重なりの件数（0 が正常）／等間隔から後ろへずらした合計弧長 [m]
//   chaseRule             : 追走（cat and mouse）の実ルールでの判定 'lead'（先頭が 1 車長以上の差でゴール）/
//                           'caught'（1 位だが 1 車長未満）/ 'passed'（抜かれた）
//   tactic 計測: psiMax（sideways 到達姿勢角 rad）・blocks（発動回数）・betaPk（drift の |β| ピーク deg）・
//                driftFrac（コーナー内で |β|≥15° かつ u≥0.1 だった tick の割合）・occ（先頭のコーナー内の内側占有率
//                = 到達可能な回廊 [lo,hi] に対する相対位置 sign·(lat−mid)/half の平均。+1 = 回廊の内側端・−1 = 外側端）・
//                occStraight（直線区間で次コーナーの内側へどれだけ寄っているか = sideNext·lat/room の平均。race は手前 0.30m
//                まで 0・inside は余地いっぱい≈1 − 0.04/room）
export function runTougeRace({ spec, nCars = 2, tactic = 'race', fRace = 0.75, paceL = PACE_DEFAULT, paceRatio = 1.15,
                               delay = 0.5, latStart = 0, carType = 'normal_fr', maxSec = 90, course = null, G = null, corners = null,
                               chaserFRace = null }) {
  const crs = course || buildFromSpec(spec);
  const geo = G || tougeGeom(crs);
  const cs = corners || cornersOf(geo);
  const cm = cornerMap(geo, cs);
  const side = sideWallsOf(crs);
  const slots = [];
  for (let i = 0; i < nCars; i++) {
    const s = makeSlot({ i, lang: 'c', src: '', course: crs, slotCount: nCars, logFor: () => (() => {}) });
    s.carType = carType; s.car.type = carType; slots.push(s);
  }
  const grid = gridOnCenterline(geo, nCars, latStart, crs.walls);
  rebuildSpawns(slots, crs, grid);
  for (const s of slots) { s.car.reset(s.spawn); s.lap.reset(crs, { carType, persist: false }); s.running = true; }
  // グリッドの健全性: 壁交差 と 車車の重なり（製品オラクル checkCollision / carEdges）を数える（0 が正常）。
  let gridHit = 0;
  for (let a = 0; a < nCars; a++) {
    if (checkCollision(slots[a].car, crs.walls)) gridHit++;
    for (let b = a + 1; b < nCars; b++) if (checkCollision(slots[a].car, [], carEdges(slots[b].car))) gridHit++;
  }
  const gridShift = grid.shift, gridLead = grid.lead;
  const profL = speedProfile(geo, slots[0].car, crs, paceL);
  const profF = speedProfile(geo, slots[0].car, crs, paceL * paceRatio);
  const trk = slots.map(() => trackerOf(geo, 'window'));
  const lineL = lineFn(tactic === 'race' ? 'race' : 'inside', fRace, cm, geo);   // inside/sideways/drift は内側線を基本にする
  const lineF = lineFn('race', chaserFRace != null ? chaserFRace : fRace, cm, geo);
  // 戦術の状態
  const L = slots[0].car;
  const st = { phase: 'drive', lastCorner: -1, holdT: 0, rotT: 0, blocks: 0, psiMax: 0, betaPk: 0, driftTicks: 0, cornerTicks: 0,
               brake: 0, driftCorner: -1, prevSl: 0, occSum: 0, occN: 0, strSum: 0, strN: 0, spinAborts: 0 };
  let t = 0, ticks = 0, contacts = 0, leaderContact = 0, leaderNear = 0, recoverArms = 0, nonMono = 0, nonMonoLeader = 0;
  const prevRec = new Float64Array(nCars), prevS = new Float64Array(nCars).fill(NaN);
  const slop = slopOf();   // v2 接触ソルバのめり込み許容（卓上 0.02m）。この距離まで近づくとインパルスを交換している
  const nearD = AX3.NEAR_FRAC * slop;   // 「接近」の閾値（指令間隙 M_SIDE=0.02 の並走は含めない）
  const finishT = new Array(nCars).fill(null);
  let gapAtFinish = null, passedBeforeFinish = false;
  const maxTicks = Math.round(maxSec / DT);
  const pos = new Array(nCars);
  for (; ticks < maxTicks; ticks++) {
    // 本番の発走順次化（AK7）＋ 明示の発走遅延（追走 k 台目は k·delay 秒後に発走）
    applyStartGate(slots, true);
    for (let i = 1; i < nCars; i++) if (t < i * delay) slots[i].car.held = true;
    for (let i = 0; i < nCars; i++) {
      pos[i] = trk[i](slots[i].car.x, slots[i].car.y);
      // 進行度の逆行（AX1 F-2 と同じ述語）。3 点旋回（後退・回頭）で trackerOf の前方窓が破綻していないかを数える。
      if (Number.isFinite(prevS[i]) && finishT[i] == null && pos[i].s - prevS[i] < -0.05) { nonMono++; if (i === 0) nonMonoLeader++; }
      prevS[i] = pos[i].s;
    }
    // ── 先頭 ──
    if (slots[0].running) {
      const p0 = pos[0], i0 = p0.i;
      const psi = wrap(L.theta - geo.th[i0]);
      const ci = cm.inCorner[i0];
      // 直後の追走との距離（弧長）: 後方 D_TRIG 以内に車がいるか
      let nearBehind = Infinity;
      for (let k = 1; k < nCars; k++) { const d = p0.s - pos[k].s; if (d > 0 && d < nearBehind) nearBehind = d; }
      // 内側占有率 = 到達可能な回廊 [lo,hi] に対する相対位置（内側端=+1・外側端=−1）。**回廊は中心線に対して非対称**
      // （峠②の R=0.298m ≈ R_min ヘアピンでは回廊全体が中心線の外側に寄る＝「到達可能な最内」がほぼ中心線）ので、
      // 中心線基準の内外ではなく回廊基準で測る。
      if (ci >= 0) {
        st.cornerTicks++;
        const lo = geo.loLat[i0], hi = geo.hiLat[i0], half = (hi - lo) / 2;
        if (half > 1e-6) { st.occSum += clamp(cs[ci].sign * (p0.lat - (lo + hi) / 2) / half, -2, 2); st.occN++; }
      } else if (cm.sideNext[i0] !== 0) {
        // 直線区間（次コーナーの手前）での「次コーナーの内側への寄り」= sideNext·lat / room（+1 = 余地いっぱい内側）。
        // **race と inside の差はここにしか無い**（峠①②③のヘアピンは R≈R_min で回廊が舵角律速の一点に絞られ、コーナー内では
        // race も inside も同じ回廊端にクランプされる＝層 4 レビュー重要-1 の観察）。
        const room = roomAt(geo, i0);
        if (room > 1e-6) { st.strSum += clamp(cm.sideNext[i0] * p0.lat / room, -2, 2); st.strN++; }
      }
      if (tactic === 'sideways') {
        if (st.phase === 'drive') {
          if (ci >= 0 && ci !== st.lastCorner && nearBehind < AX3.D_TRIG) { st.phase = 'stop'; st.lastCorner = ci; st.blocks++; st.holdT = 0; }
          else driveTickFn(L, geo, profL, p0, lineL);
        }
        if (st.phase === 'stop') {
          L.driveDir = CONST.BRAKE; L.pwm = 0; L.steer = cm.sideNext[i0] >= 0 ? CONST.LEFT : CONST.RIGHT; L.steerAmt = null;
          if (Math.abs(L.u) < 0.02 && Math.abs(L.vlat) < 0.02) { st.phase = 'rotF'; st.rotT = 0; }
        } else if (st.phase === 'rotF' || st.phase === 'rotR') {
          // 3 点旋回: 前進＋一方の舵 と 後退＋逆の舵 は同じ向きに回頭する。ROT_DIR='in'（既定）は前進で鼻を内壁側へ振り
          // テールを道へ張り出す（内壁にすぐ当たるので前後を切り替えながら回す。'out' は行き過ぎて復帰不能＝AX3 定数の注記）。
          const inner = (cs[st.lastCorner].sign > 0) ? CONST.LEFT : CONST.RIGHT;
          const outer = inner === CONST.LEFT ? CONST.RIGHT : CONST.LEFT;
          const fwdSteer = AX3.ROT_DIR === 'out' ? outer : inner;
          const fwd = st.phase === 'rotF';
          L.driveDir = fwd ? CONST.FORWARD : CONST.REVERSE; L.pwm = AX3.ROT_PWM;
          L.steer = fwd ? fwdSteer : (fwdSteer === CONST.LEFT ? CONST.RIGHT : CONST.LEFT); L.steerAmt = null;
          if (minWallClear(L, side) < AX3.ROT_CLEAR) st.phase = fwd ? 'rotR' : 'rotF';
          st.rotT += DT;
          if (Math.abs(psi) >= AX3.PSI_TARGET || st.rotT >= AX3.T_ROT) { st.phase = 'hold'; st.holdT = 0; }
        } else if (st.phase === 'hold') {
          L.driveDir = CONST.BRAKE; L.pwm = 0; st.holdT += DT;
          // 追走が後方 D_TRIG×1.5 以内に居なくなった（抜かれた／離れた）か、保持時間を使い切ったら復帰
          if (st.holdT >= AX3.T_HOLD || !(nearBehind < AX3.D_TRIG * 1.5)) st.phase = 'resume';
        } else if (st.phase === 'resume') {
          // 復帰も **同じ速度則 holdTo（プロファイル）**（初版は 0.30 m/s の上限を掛けていた＝「同一ペース」の主張と食い違い・層 4 重要-6）
          const j = lookaheadIdx(L, geo, i0); pursueLine(L, geo, j, clamp(lineL(j) * roomAt(geo, j), geo.loLat[j], geo.hiLat[j]));
          holdTo(L, profL.v[i0]);
          if (Math.abs(psi) < AX3.PSI_RESUME) st.phase = 'drive';
        }
        if (st.phase !== 'drive' && Math.abs(psi) > st.psiMax) st.psiMax = Math.abs(psi);
      } else if (tactic === 'drift') {
        const sgn = cm.sideNext[i0] || 1;
        const sl = -sgn * beta(L), sld = (sl - st.prevSl) / DT; st.prevSl = sl;
        // コーナー入口 DRIFT_PRE 手前で後軸ロック＋フル舵（コーナーごとに 1 回）
        if (st.phase === 'drive' && ci < 0 && cm.distNext[i0] <= AX3.DRIFT_PRE && st.driftCorner !== (cm.inCorner[Math.min(geo.n - 1, i0 + Math.round(AX3.DRIFT_PRE / STEP) + 1)])) {
          st.phase = 'brake'; st.brake = AX3.DRIFT_BRAKE_TICKS; st.driftCorner = cm.inCorner[Math.min(geo.n - 1, i0 + Math.round(AX3.DRIFT_PRE / STEP) + 1)];
        }
        if (st.phase === 'brake') {
          L.driveDir = CONST.BRAKE; L.pwm = 0; L.steer = sgn > 0 ? CONST.LEFT : CONST.RIGHT; L.steerAmt = null;
          if (--st.brake <= 0) st.phase = 'hold';
        } else if (st.phase === 'hold') {
          if (ci < 0 && cm.distNext[i0] > AX3.DRIFT_PRE) st.phase = 'drive';   // コーナーを抜けた
          else {
            // 残り区間が短くなったら滑り目標を絞る（catch）。残弧長 / |u| が 0.5s を切ったら 0 へ。
            const remain = ci >= 0 ? geo.s[cs[ci].i1] - p0.s : Infinity;
            const bt = (remain / Math.max(Math.abs(L.u), 0.05) < 0.5) ? 0 : AX3.DRIFT_BETA;
            const want = AX3.DRIFT_KP * (bt - sl) - AX3.DRIFT_KD * sld;
            // 純追跡の内側線に、滑り制御の逆ハン成分を足す（内側の占有を保ちながら姿勢を制御）
            const j = lookaheadIdx(L, geo, i0);
            const latJ = clamp(lineL(j) * roomAt(geo, j), geo.loLat[j], geo.hiLat[j]);
            const tx = geo.P[j][0] - Math.sin(geo.th[j]) * latJ, ty = geo.P[j][1] + Math.cos(geo.th[j]) * latJ;
            const e = wrap(Math.atan2(ty - L.y, tx - L.x) - L.theta);
            const dist = Math.max(0.03, Math.hypot(tx - L.x, ty - L.y));
            const pursue = Math.atan2(2 * CAR.wheelBase * Math.sin(e), dist) / CAR.maxSteer;
            steerNorm(L, pursue + sgn * want);
            // 速度は **他の戦術と同じ holdTo（速度プロファイル・超過時は BRAKE）** で守る。滑り過多のときだけ駆動を絞る。
            // 初版は AU1 の自由空間ドライバと同じ pwm=255（全開）で保持し、二版は pwm をプロファイル比にしたが BRAKE を
            // 使わなかったため下り重力で上限を超え、どちらも `inside` より 5〜7s 速い「別の動作点」になっていた
            // （実測 2026-09-07）。戦術の比較は同一ペース・同一の速度則で行う。FR の BRAKE は後軸ロック＝滑りの機構そのもの。
            if (sl > bt + 4) { L.driveDir = CONST.FORWARD; L.pwm = 60; }
            else holdTo(L, profL.v[i0]);
            if (Math.abs(beta(L)) > AX3.DRIFT_SPIN && Math.abs(L.u) >= 0.1) { st.phase = 'drive'; st.spinAborts++; }   // スピン防止: 姿勢制御を諦めて追従へ
          }
        }
        if (st.phase === 'drive') driveTickFn(L, geo, profL, p0, lineL);
        const ab = Math.abs(beta(L)); if (ci >= 0 && ab > st.betaPk && Math.abs(L.u) >= 0.1) st.betaPk = ab;
        if (ci >= 0 && ab >= 15 && Math.abs(L.u) >= 0.1) st.driftTicks++;
      } else {
        driveTickFn(L, geo, profL, p0, lineL);
      }
    }
    // ── 追走（全車同じ規則。前方 W_PASS 以内の車を避けて空いている側から抜く。塞がれたら速度を合わせる）──
    for (let k = 1; k < nCars; k++) {
      const s = slots[k]; if (!s.running) continue;
      const car = s.car, pk = pos[k], ik = pk.i;
      const j = lookaheadIdx(car, geo, ik);
      const lo = geo.loLat[j], hi = geo.hiLat[j];
      let target = clamp(lineF(j) * roomAt(geo, j), lo, hi);
      let vT = profF.v[ik], blocked = false;
      // 前方の車を近い順に見る。**相手の実効横幅は姿勢角込み**（道に対して ψ 傾いた車体は 車長·|sinψ| + 車幅·|cosψ| の幅を
      // 占める。`sideways` の先頭は ψ≈38° で 0.10m でなく 0.17m 幅。層 4 重要-5: 点＋車幅で扱うと横向きの先頭にだけ楽観だった）
      const ahead = [];
      for (let m = 0; m < nCars; m++) {
        if (m === k || finishT[m] != null) continue;
        const d = pos[m].s - pk.s;
        if (d > 0 && d < AX3.W_PASS) {
          const psiO = wrap(slots[m].car.theta - geo.th[pos[m].i]);
          const halfW = 0.5 * (CAR.length * Math.abs(Math.sin(psiO)) + CAR.width * Math.abs(Math.cos(psiO)));
          // 帯の中心は **車体中心**（後輪軸中心から前へ (車長−後端)/2 − 後端/2 = 0.065m）。ψ だけ傾くと横へ 0.065·sinψ ずれる
          // （層 4 レビュー 2 巡目 重要-B: 幅だけ姿勢角込みにして中心を後輪軸のままにすると片側 0.04m 過小になる）。
          const cOff = ((CAR.length - CAR.rearToBack) - CAR.rearToBack) / 2;
          const latC = pos[m].lat + cOff * Math.sin(psiO);
          ahead.push({ m, d, lat: latC, u: slots[m].car.u, halfW });
        }
      }
      ahead.sort((a, b) => a.d - b.d);
      // 横位置は道の Frenet 座標（各車の弧長点での法線成分）で比べる＝「同じ車線か」の意味。異なる弧長点の法線は
      // ヘアピンで向きが変わるが、車線の占有はこの座標で定義される（層 4 レビュー 2 巡目 重要-F への回答・設計どおり）。
      for (const o of ahead) {
        const need = CAR.width / 2 + o.halfW + AX3.M_SIDE;
        if (Math.abs(target - o.lat) >= need) continue;             // その車とは横にずれている＝干渉しない
        const c1 = o.lat + need, c2 = o.lat - need;
        const ok1 = c1 <= hi, ok2 = c2 >= lo;
        if (ok1 && ok2) target = (Math.abs(c1 - target) <= Math.abs(c2 - target)) ? c1 : c2;
        else if (ok1) target = c1;
        else if (ok2) target = c2;
        else { blocked = true; }
        if (blocked) break;
      }
      if (ahead.length) {
        // 追従則: 塞がれている／同じ帯に居るときは、前車の速度に「車間の余り × K」を足した速度へ寄せる
        // （距離比例＝60Hz の離散制御で追突と急停止を繰り返さない）。dSafe = 車長 + 余白。
        const o = ahead[0];
        const sameLane = Math.abs(pk.lat - o.lat) < CAR.width / 2 + o.halfW + AX3.M_SIDE;
        if ((blocked && o.d < AX3.D_FOLLOW) || (sameLane && o.d < AX3.D_FOLLOW)) {
          vT = Math.min(vT, Math.max(0, o.u + AX3.K_FOLLOW * (o.d - (CAR.length + AX3.D_SAFE))));
        }
      }
      pursueLine(car, geo, j, target);
      holdTo(car, vT);
    }
    // **ゴールした車はコースから外す**（実レースの「ゴール後はコースアウト」相当）。峠はゴール線の 0.35m 先が
    // 端壁で、惰行で止まった車がそこに残ると後続がゴール線の手前で詰まり（実測: 3 台分幅で N=4 が全員タイムアウト）、
    // 着順の測定そのものが壊れる。ゴール済の車は着順にもう影響しないので物理からも外す。
    const active = slots.filter((s, i) => finishT[i] == null);
    integrateFleetV2(active, DT, crs.walls, true, true);
    t += DT;
    // 計測（ゴール済の車は対象外）。重なり（ポリゴン交差）に加えて、**先頭が他車の slop（0.02m）以内に近づいた tick** も数える —
    // v2 の接触ソルバは slop 手前からインパルスを交換し位置補正で押し戻すので、押し戻され切った接触は交差 0 になる（層 4 重要-4）。
    let any = false, lead = false, near = false;
    for (let a = 0; a < nCars; a++) {
      if (finishT[a] != null) continue;
      const ea = carEdges(slots[a].car);
      for (let b = a + 1; b < nCars; b++) {
        if (finishT[b] != null) continue;
        if (checkCollision(slots[b].car, [], ea)) { any = true; if (a === 0) lead = true; }
        if (a === 0 && !near) {
          const eb = carEdges(slots[b].car);
          let dmin = Infinity;
          for (const pp of ea) for (const q of eb) {
            const P1 = { x: pp.x1, y: pp.y1 }, P2 = { x: pp.x2, y: pp.y2 }, Q1 = { x: q.x1, y: q.y1 }, Q2 = { x: q.x2, y: q.y2 };
            const d = Math.min(distToSeg(P1, Q1, Q2), distToSeg(P2, Q1, Q2), distToSeg(Q1, P1, P2), distToSeg(Q2, P1, P2));
            if (d < dmin) dmin = d;
          }
          if (dmin < nearD) near = true;
        }
      }
    }
    if (any) contacts++;
    if (lead) leaderContact++;
    if (near) leaderNear++;
    for (let a = 0; a < nCars; a++) {
      const car = slots[a].car;
      if (car.recoverT > prevRec[a] + 1e-9) recoverArms++;
      prevRec[a] = car.recoverT;
      if (finishT[a] == null && slots[a].lap.finished) {
        finishT[a] = slots[a].lap.lastLap;
        if (a === 0) {
          // 先頭のゴール時点: **まだゴールしていない**直後の車との弧長差（ゴール済の車は物理から外れ位置が凍結しているので除く）。
          // 既に誰かがゴール済なら抜かれている（passed）。
          passedBeforeFinish = finishT.some((v, m) => m !== 0 && v != null);
          let g = Infinity; for (let m = 1; m < nCars; m++) { if (finishT[m] != null) continue; const d = pos[0].s - pos[m].s; if (d < g) g = d; }
          gapAtFinish = Number.isFinite(g) ? g : null;
        }
      }
    }
    if (finishT.every((v) => v != null)) break;
  }
  // 着順: 到達時刻昇順（未完走は末尾・index 順）
  const order = [...Array(nCars).keys()].sort((a, b) => {
    const ta = finishT[a], tb = finishT[b];
    if (ta == null && tb == null) return a - b;
    if (ta == null) return 1; if (tb == null) return -1;
    return (ta - tb) || (a - b);
  });
  const rank = new Array(nCars); order.forEach((idx, r) => { rank[idx] = r + 1; });
  const leaderT = finishT[0];
  const chaseRule = nCars === 1 ? 'solo' : leaderT == null ? 'dnf' : (passedBeforeFinish || rank[0] !== 1) ? 'passed' : (gapAtFinish != null && gapAtFinish >= CAR.length) ? 'lead' : 'caught';
  return {
    nCars, tactic, finished: finishT.map((v) => v != null), t: finishT, rank, leaderRank: rank[0], leaderT,
    bestChaserT: finishT.slice(1).filter((v) => v != null).sort((a, b) => a - b)[0] ?? null,
    contacts, leaderContact, leaderNear, recoverArms, nonMono, nonMonoLeader, gapAtFinish, chaseRule, ticks, gridHit, gridShift, gridLead,
    psiMax: st.psiMax, blocks: st.blocks, betaPk: st.betaPk,
    driftFrac: st.cornerTicks ? st.driftTicks / st.cornerTicks : 0, spinAborts: st.spinAborts,
    occ: st.occN ? st.occSum / st.occN : null,
    occStraight: st.strN ? st.strSum / st.strN : null,
    endPhase: st.phase,
  };
}
