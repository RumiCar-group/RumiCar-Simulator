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
import { checkCollision, carEdges } from './public/js/physics.js';
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
  const i = st.i;
  const room = roomAt(G, i);
  const f = clamp(latFrac, -1, 1);
  // lookahead は速度連動。狭い所（room 小）では短くして内側を舐めない。
  const j = lookaheadIdx(car, G, i);
  // 到達可能な回廊（幾何から決めた連続関数）へ指令をクランプする。
  const req = f * room;                                   // 素の要求
  const latTarget = clamp(req, G.loLat[i], G.hiLat[i]);
  const clamped = Math.abs(latTarget - req);
  const latJ = clamp(f * roomAt(G, j), G.loLat[j], G.hiLat[j]);
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
export function tougeSpecs(specs) { return specs.filter((c) => c.kind === 'touge'); }
export const CAR_KEYS = ['normal_fr', 'normal_awd', 'normal_ff'];   // FR / AWD / FF（UI 既定 3 台）
