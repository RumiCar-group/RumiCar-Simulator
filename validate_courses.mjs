// コース定義の幾何検証。track コースを**本番の生成器 (public/js/course.js の buildFromSpec) で組み**、
// 出来上がった壁で「左右に壁のある閉じた廊下」が成立するかを確認する (BM3・2026-10-17)。
// 中心線・壁・道幅 (widthVary を含む) はすべて生成器の出力から取る＝生成の手写しを持たない
// (旧版は sampleClosed/chaikin/makeCenterline を複製し widthVary を見ていなかった)。
//
// 壁の並び (course.js buildTrack を正とする): walls = [外側オフセットの輪 n 本, 内側オフセットの輪 n 本]。
//   輪 A = walls[0..n-1] (中心線の左)、輪 B = walls[n..2n-1] (中心線の右)。A[i]・B[i] は中心線の点 i を
//   法線方向に ±幅/2 ずらした点なので、|A[i]−B[i]| が点 i の道幅 (widthVary 込み)。左右どちらが島側かは
//   中心線の向きで決まるので、判定は A/B の名前に依存させない (島＝中心線の内側で測る)。
//   この並びが崩れたら (輪が閉じない・中心線と本数が違う・A[i] と B[i] の中点が中心線の点 i でない・座標が
//   非有限) 判定せず例外にし、CLI は「判定不能」＝NG にする (黙って誤判定しない)。
//
// 判定 (連続量を出す。旧判定の「中心線の自己間隔 < width」は隣接の窓を点の個数で取っていたため、
//   点が密なコースで同じ側の数点先を「非隣接」と数え、出荷 track の半数以上を NG と出していた):
//   致命 1. 外×内の交差 … 輪 A の壁と輪 B の壁が交わる本数。交われば壁が廊下を横切る＝道が塞がる。
//   致命 2. 最狭 < 車幅 … 輪 A と輪 B の最短距離 [m] が車幅 (config.js CAR_FOOTPRINT の全幅。fitguard が
//          領域を fullscale へ切り替える noRace の大型コース (短辺 ≥ FIT.bigCourseMinDim) だけは
//          REGIMES.fullscale と卓上の長さ比で拡大) 未満＝車が通れない所がある。
//          最短の 2 点を結ぶ線分はほかの壁と交わらない (交われば交点の方が近い) ので、輪 A・B が入れ子の
//          廊下ならこの線分は廊下を横に切る＝周回する車は必ずここを通る。外×内の交差が無くても、外側どうしが
//          重なる U 字などで起きる (例: 幅 0.5 の U 字の切り欠き 0.05 → 最狭 0.012 m)。既定の車の大きさで
//          判定する (fitguard が車を縮める場合でも、既定の車で通れないコースは壊れているとみなす)。
//   致命 3. 島/width   … 中心線の内側で、どの区間の廊下 (中心線から局所の幅/2 以内) にも入らない最大円の
//          直径 ÷ 平均の道幅。≤0 は島が残らない＝向かい合う区間の廊下どうしが重なって融合している
//          (例: 幅が廊下の間隔より広い楕円。楕円なら (2·ry − width)/width)。この形は壁が交差せず、壁だけを
//          見れば周回もできることがある (幅 1.6 の楕円: 輪 A は裏返って閉じた小さな島になり、最狭 1.3 m で
//          車はその周りを回れる)。それでも致命にするのは「中心線から幅/2 の廊下が向かい合う区間どうしで
//          重なる＝設計した廊下が成立していない」という中心線モデルの定義による (受け入れ基準が名指しした
//          融合の例)。壁の上で通れなくなる事象は致命 1・2 が受け持つ。
//   要注意 同じ輪の交差 … 同じ輪の壁どうし (隣接を除く) の交差数。急な角で内側の壁が折れ込む形
//          (オフセットが曲率半径を超える)。道は塞がらないので致命にしない。部分的な括れ (島が 2 つに
//          分かれる) や外側どうしの重なりもここに出る。**既知の限界**: 島が 2 つに分かれる括れ (例: lobed の
//          くびれの直径 < 幅) は島が残るので致命にならず、要注意 (同じ輪の交差) にだけ出る。急な角の折れ込み
//          も「局所的な廊下の重なり」で、両者を壁の形だけで分ける閾値は置いていない (置くと出荷の折れ込みを
//          致命にするか、括れを見逃すかの選択になる)。要注意のコースは最小間隔/width と合わせて目で確かめる。
//   参考   最小間隔/width … 輪 A と輪 B の最短距離 ÷ その 2 点の道幅の平均。1 なら全幅が残っている。
//          折れ込みや角での狭まりで 1 を下回る (比そのものは致命にしない。致命は上の 2 の絶対値で判定)。
//          括弧内は輪 A・B の最短距離そのもの [m] と車幅 (widthVary で意図して狭めた所は比が 1 のまま、
//          こちらに出る)。
// 各回の実行で、故意に融合・閉塞させた対照の spec を同じ判定に通し、致命と出ることを確かめる
// (検出力の自己検査。致命と出なければ判定が壊れているので exit 1)。
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
// AV1: 路面種別の許容値は **config.js の SURFACES を単一真実源**にする (AS10 の BANK_KINDS のような
// ローカル複製にすると、装備を足したときに検査側だけ取り残されて「知らない値を素通しする」)。
import { SURFACES, CAR_FOOTPRINT, REGIMES } from './public/js/config.js';
import { buildFromSpec } from './public/js/course.js';
import { FIT } from './public/js/fitguard.js';

// 線分 a, b が端点以外で交わるか (端点の接触・同一直線上の重なりは数えない)
function segCross(a, b) {
  const d = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = d(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1), d2 = d(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  const d3 = d(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1), d4 = d(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
// 点 (px,py) から線分 (ax,ay)-(bx,by) への最短距離と、最近点の線分上の位置 t∈[0,1]
function ptSeg(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const L2 = vx * vx + vy * vy || 1e-12;
  let t = (wx * vx + wy * vy) / L2; t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(px - (ax + t * vx), py - (ay + t * vy)), t };
}
// 点が閉多角形 pts ([[x,y],...]) の内側か (偶奇規則)
function inside(px, py, pts) {
  let r = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) r = !r;
  }
  return r;
}

// track の spec 1 件を本番の生成器で組んで判定する。戻り値は連続量と判定。
export function judgeTrack(spec) {
  const c = buildFromSpec(spec);
  const W = c.walls, cl = c.centerline, n = W.length / 2;
  const nm = spec && spec.name ? spec.name : '(no name)';
  if (!Number.isInteger(n) || n < 3 || !Array.isArray(cl) || cl.length !== n) {
    throw new Error(`${nm}: course.js の track の壁の並びが想定 (中心線 n 点 → 壁 2n 本) と違う (壁 ${W.length} 本・中心線 ${cl && cl.length} 点)`);
  }
  for (const q of W) if (![q.x1, q.y1, q.x2, q.y2].every(Number.isFinite)) throw new Error(`${nm}: 壁の座標が有限でない (width などの欠落・非数)`);
  for (const off of [0, n]) for (let i = 0; i < n; i++) {
    const a = W[off + i], b = W[off + (i + 1) % n];
    if (a.x2 !== b.x1 || a.y2 !== b.y1) throw new Error(`${nm}: course.js の track の壁が輪として閉じていない (walls[${off + i}]→walls[${off + (i + 1) % n}])`);
  }
  {
    let span = 0; for (const [x, y] of cl) span = Math.max(span, Math.abs(x), Math.abs(y));
    const eps = 1e-9 * (1 + span);
    for (let i = 0; i < n; i++) {
      if (Math.abs((W[i].x1 + W[n + i].x1) / 2 - cl[i][0]) > eps || Math.abs((W[i].y1 + W[n + i].y1) / 2 - cl[i][1]) > eps)
        throw new Error(`${nm}: course.js の track の壁 walls[${i}]・walls[${n + i}] の中点が中心線の点 ${i} と一致しない (添字の並びが想定と違う)`);
    }
  }
  // 道幅 (生成器の出力そのもの): 点 i の左右の壁点の距離
  const w = []; for (let i = 0; i < n; i++) w.push(Math.hypot(W[i].x1 - W[n + i].x1, W[i].y1 - W[n + i].y1));
  const wMean = w.reduce((s, v) => s + v, 0) / n, wMin = Math.min(...w);

  // 交差: 外×内 (全組) と 同じ輪 (隣接＝端点を共有する組を除く)
  let cross = 0, fold = 0;
  for (let i = 0; i < 2 * n; i++) for (let j = i + 1; j < 2 * n; j++) {
    const same = (i < n) === (j < n);
    if (same) { const di = Math.abs((i % n) - (j % n)); if (di <= 1 || di === n - 1) continue; }
    if (segCross(W[i], W[j])) { if (same) fold++; else cross++; }
  }

  // 最小間隔: 輪 A の各点 → 輪 B の各線分、輪 B の各点 → 輪 A の各線分 (交差が無ければ線分どうしの最短距離に等しい)。
  // gapR = 距離 ÷ その 2 点の道幅の平均 の最小、gapM = 距離そのものの最小 [m] (widthVary の狭所はこちらに出る)
  let gapR = Infinity, gapM = Infinity;
  for (const [X, Y] of [[0, n], [n, 0]]) for (let i = 0; i < n; i++) {
    const px = W[X + i].x1, py = W[X + i].y1;
    for (let j = 0; j < n; j++) {
      const s = W[Y + j], { d, t } = ptSeg(px, py, s.x1, s.y1, s.x2, s.y2);
      const wl = (w[i] + w[j] * (1 - t) + w[(j + 1) % n] * t) / 2;
      if (d / wl < gapR) gapR = d / wl;
      if (d < gapM) gapM = d;
    }
  }
  if (cross > 0) { gapR = 0; gapM = 0; }

  // 島: 中心線の内側の点 q について clear(q) = min_k (q と中心線の線分 k の距離 − その位置の幅/2)。
  // clear>0 の点は どの区間の廊下にも入らない＝島の上。max clear を分枝限定で求める (clear は 1-Lipschitz
  // なので、セル中心の値 + 半対角 がセル内の上界。中心が外側のセルの内側の点は境界＝中心線から半対角以内
  // なので clear ≤ 半対角 − 最小の幅/2。中心から中心線までが半対角より遠い外側のセルは丸ごと外＝捨てる)。
  // 許容誤差 tol = max(平均の道幅/400, 外接矩形の辺 × 1e-5)。島/width の誤差は 2·tol/平均の道幅 以下で、
  // 普通は 0.005 (表示 2 桁)。道幅が外接矩形の辺の 1/40 より細いコースだけ下限が効いて誤差が大きくなる
  // (幅 0 や極小で分割が終わらないようにするための下限。誤差は島/width を小さく見る側にだけ出る)。
  // widthVary では幅/2 の補間が射影位置で変わるので clear の Lipschitz 定数は 1 + max|Δ(幅/2)|/線分長 (=Lc)
  // になる。上界は 中心の値 + Lc·半対角 で取る。分割の前に最初の格子を全部評価して best を内側の実測値で
  // 始める (best=−∞ のまま深く潜ると、外側のセルまで面で分割して評価回数が爆発する＝BM3 層4 2 回目)。
  // 評価回数の上限 MAX_EVAL は安全弁 (実測 2026-10-17: 出荷 track の最大 13,468 回・長さ 40 m の競技場形や
  // rx 30 m の楕円でも 15 万回以下。当たったら例外＝判定不能と原因を出す)。
  // 速さのため、線分は親セルで最小だった線分の近くから順に見て、途中の最小が min(best, best+tol−Lc·半対角) 以下に
  // なった時点で打ち切る (途中の最小は真の最小以上なので、打ち切ったセルは best を更新せず、上界は過大側＝
  // 余分に分割するだけ)。結果の best は真の最大から tol 以内 (下側) に入る。
  const clear = (qx, qy, k0, stopAt) => {
    let m = Infinity, arg = k0;
    for (let s = 0; s < n; s++) {
      const k = (k0 + ((s & 1) ? (s + 1) >> 1 : n - (s >> 1))) % n;   // k0, k0+1, k0-1, k0+2, ...
      const a = cl[k], b = cl[(k + 1) % n], { d, t } = ptSeg(qx, qy, a[0], a[1], b[0], b[1]);
      const v = d - (w[k] * (1 - t) + w[(k + 1) % n] * t) / 2;
      if (v < m) { m = v; arg = k; if (m <= stopAt) break; }
    }
    return { m, arg };
  };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of cl) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  let Lc = 1;
  for (let k = 0; k < n; k++) {
    const a = cl[k], b = cl[(k + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > 0) Lc = Math.max(Lc, 1 + Math.abs(w[(k + 1) % n] - w[k]) / 2 / L);
  }
  const ext = Math.max(x1 - x0, y1 - y0);
  const tol = Math.max(wMean / 400, ext * 1e-5), G = 32, h0 = ext / G || tol;
  const MAX_EVAL = 5e7; let nEval = 0;
  // 中心線の折れ線までの距離が r 以下か (外側のセルが境界をまたぐか)
  const nearCl = (qx, qy, r) => {
    for (let k = 0; k < n; k++) { const a = cl[k], b = cl[(k + 1) % n]; if (ptSeg(qx, qy, a[0], a[1], b[0], b[1]).d <= r) return true; }
    return false;
  };
  let best = -Infinity; const stack = [];
  for (let gx = 0; gx < G; gx++) for (let gy = 0; gy < G; gy++) {
    const qx = x0 + (gx + 0.5) * h0, qy = y0 + (gy + 0.5) * h0;
    const ins = inside(qx, qy, cl), e = ins ? clear(qx, qy, 0, -Infinity) : null;
    if (e && e.m > best) best = e.m;
    stack.push([qx, qy, h0, e ? e.arg : 0, ins, e ? e.m : NaN]);
  }
  while (stack.length) {
    let [qx, qy, h, k0, ins, v] = stack.pop();
    const r = h * Math.SQRT1_2;
    if (++nEval > MAX_EVAL) throw new Error(`${nm}: 島の探索が評価 ${MAX_EVAL} 回の上限に達した (形が極端に細長いか細かい)`);
    let ub, arg = k0;
    if (ins === undefined) ins = inside(qx, qy, cl);
    if (ins) {
      if (Number.isNaN(v) || v === undefined) {
        const e = clear(qx, qy, k0, Math.min(best, best + tol - Lc * r));
        if (e.m > best) best = e.m;
        v = e.m; arg = e.arg;
      }
      ub = v + Lc * r;
    } else ub = nearCl(qx, qy, r) ? r - wMin / 2 : -Infinity;
    if (ub > best + tol && r > tol) { const q = h / 4; stack.push([qx - q, qy - q, h / 2, arg], [qx + q, qy - q, h / 2, arg], [qx - q, qy + q, h / 2, arg], [qx + q, qy + q, h / 2, arg]); }
  }
  const islandR = Number.isFinite(best) && wMean > 0 ? 2 * best / wMean : -Infinity;

  // 車幅: 既定の車 (CAR_FOOTPRINT＝carScale に依らない設計寸法)。fitguard.js settleScale ① と同じ条件
  // (noRace かつ bounds の短辺 ≥ FIT.bigCourseMinDim) のときだけアプリは領域を fullscale へ切り替えるので、
  // そのときだけ長さ比 (REGIMES.fullscale.L / tabletop.L) で拡大する。それ以外は卓上の車のまま測る。
  const minDim = c.bounds ? Math.min(c.bounds.w, c.bounds.h) : 0;
  const fullscale = spec.noRace === true && minDim >= FIT.bigCourseMinDim;
  const carW = 2 * CAR_FOOTPRINT.hw * (fullscale ? REGIMES.fullscale.L / REGIMES.tabletop.L : 1);

  const why = [];
  if (cross > 0) why.push('外壁と内壁が交わる (道が塞がる)');
  if (!(gapM >= carW)) why.push(`最狭 ${gapM.toFixed(3)}m が車幅 ${carW.toFixed(3)}m 未満 (車が通れない)`);
  if (!(islandR > 0)) why.push('島が残らない (向かい合う区間の廊下が重なる＝融合)');
  return { name: nm, walls: W.length, cross, fold, gapR, gapM, carW, islandR, wMean, nEval, fatal: why.length > 0, warn: fold > 0, why };
}

// 検出力の対照 (本番の生成器で組む)。expectFatal=true は致命と出なければ判定が壊れている。
// expectFatal=false は境界の手前 (致命にしてはいけない) の対照。
export const CONTROLS = [
  { expectFatal: true, why: '幅 1.6 > 廊下の間隔 2·ry=1.5 の楕円 (島が裏返る・壁は交差しない)',
    spec: { name: '対照: 幅が廊下の間隔より広い楕円', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 1.6, samples: 80 } },
  { expectFatal: true, why: '幅 0.6 > 半円の直径 0.5 の競技場形 (直線の廊下どうしが重なる)',
    spec: { name: '対照: 幅が折返しの直径より広い競技場形', kind: 'track', shape: 'stadium', L: 2.0, rr: 0.25, width: 0.6 } },
  { expectFatal: true, why: '中心線が自分と交わる 8 の字 (交点で壁が廊下を横切る)',
    spec: { name: '対照: 中心線が交わる 8 の字', kind: 'track', shape: 'polyline', width: 0.4, smooth: 2,
      centerline: [[0, 0], [3, 3], [3, 0], [0, 3]] } },
  { expectFatal: true, why: '外側どうしが重なる U 字 (切り欠き 0.05・壁は外×内で交差しない・島は残る・最狭 < 車幅)',
    spec: { name: '対照: 外側が重なって細る U 字', kind: 'track', shape: 'polyline', width: 0.5,
      centerline: [[0, 0], [4, 0], [4, 3], [2.05, 3], [2.05, 1], [2, 1], [2, 3], [0, 3]] } },
  { expectFatal: false, why: '同じ U 字で切り欠き 0.6 (最狭 0.144 m ≥ 車幅・同じ輪の交差も無い)',
    spec: { name: '対照: 切り欠きが広い U 字', kind: 'track', shape: 'polyline', width: 0.5,
      centerline: [[0, 0], [4, 0], [4, 3], [2.6, 3], [2.6, 1], [2, 1], [2, 3], [0, 3]] } },
  { expectFatal: false, why: '幅 1.4 < 廊下の間隔 1.5 の楕円 (島が残る・両端は折れ込む)',
    spec: { name: '対照: 幅が廊下の間隔より狭い楕円', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 1.4, samples: 80 } },
];

// ── Stage AS10: フィールド検査 (スキーマ) ─────────────────────────────────────────────
// 本スクリプトは長らく「track の幾何」だけを見ており、**フィールドの妥当性検査を1つも持たなかった**
// (峠は `kind!=='track'` で丸ごと素通り)。AS10 で `bank` (横勾配・カント[度]) を足すにあたり、値域と
// 適用可能な kind を機械検査する土台をここに置く。フィールドエラーは exit 1 を起こす。
// (AS10 当時は幾何の NG を表示のみにしていた＝旧判定が走行可能なコースまで NG にしていたため。BM3 で
// 判定を壁の実態に置き換えて出荷コースの NG が無くなったので、幾何の致命も exit 1 にした。上の「判定」参照)
//
// bank の意味 (course.js / physics_v2.js / physics_dyn.js を正とする):
//   ・`bank` [度] = **そのコースの最急コーナーでのバンク角**。他の地点は局所曲率に線形比例する。
//   ・正 = 路面がカーブ外側へ持ち上がる (旋回を助ける)。負 = 逆バンク。
//   ・中心線を持つ kind (`track` / `touge`) のみ有効。`annulus`/`raw`/`loop` は中心線が無いので非対応。
const BANK_KINDS = ['track', 'touge'];
const BANK_MAX_DEG = 45;   // |bank|>45° は面内重力が法線荷重を上回り「停まっていても滑り落ちる」領域
// surface の意味 (course.js / config.js SURFACES / physics_v2.js tireForceMF を正とする):
//   ・`surface` = 路面種別。'paved' (既定・省略時) / 'loose' (砂利・ダート・雪＝掘り込み項あり)。
//   ・**bank と違い kind を選ばない**: 中心線ではなくタイヤ力の式に効くので、全 kind で有効。
//   ・精密 v2 エンジンでのみ効く (dynamic/standard は無視)。これは検査ではなく仕様 (📐 仕様に明記)。
const SURFACE_KEYS = Object.keys(SURFACES);
export function checkFields(specs) {
  const errs = [];
  for (const s of specs) {
    const nm = s && s.name ? s.name : '(no name)';
    if (s == null || typeof s !== 'object') { errs.push(`${nm}: コース定義がオブジェクトでない`); continue; }
    // ── surface (AV1) ── bank と独立に検査する (どちらか一方だけを持つコースがありうる)。
    if (s.surface !== undefined) {
      const sf = s.surface;
      if (typeof sf !== 'string') errs.push(`${nm}: surface は文字列でなければならない: ${JSON.stringify(sf)}`);
      else if (!SURFACE_KEYS.includes(sf)) errs.push(`${nm}: surface="${sf}" は未知の路面種別 (${SURFACE_KEYS.join('/')} のみ)`);
    }
    // ── bank (AS10) ──
    if (s.bank === undefined) continue;                       // 未指定 = 0 = 完全 no-op (既存の全コース)
    const b = s.bank;
    if (typeof b !== 'number' || !Number.isFinite(b)) { errs.push(`${nm}: bank は有限の数値 (度) でなければならない: ${JSON.stringify(b)}`); continue; }
    if (Math.abs(b) > BANK_MAX_DEG) errs.push(`${nm}: bank=${b}° が上限 ±${BANK_MAX_DEG}° を超えている (停止中でも滑り落ちる領域)`);
    const kind = s.kind || 'loop';
    if (!BANK_KINDS.includes(kind)) errs.push(`${nm}: kind="${kind}" は bank 非対応 (中心線を持つ ${BANK_KINDS.join('/')} のみ)`);
  }
  return errs;
}

// ── CLI 実行部 (直接起動されたときだけ走る) ───────────────────────────────────────────
// AS10: `checkFields` を常設ゲートから import できるようにするため、CLI の副作用 (読込・出力・
// process.exit) を main ガードで包む。`node validate_courses.mjs [path] [--circuits]`。
// 終了コード: 幾何の致命・対照の検出漏れ・フィールドエラーのいずれかで 1。
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const path = process.argv.slice(2).find(a => !a.startsWith('--')) || 'public/data/courses.json';
  const specs = JSON.parse(readFileSync(path, 'utf8'));
  const onlyTracks = process.argv.includes('--circuits');
  const line = (r) => `${r.name.padEnd(22)} 外×内の交差=${r.cross} 島/width=${r.islandR.toFixed(2)} 最小間隔/width=${r.gapR.toFixed(2)} (最狭 ${r.gapM.toFixed(3)}m/車幅 ${r.carW.toFixed(2)}m) 同じ輪の交差=${r.fold}`;
  let bad = 0, warn = 0;
  for (const s of specs) {
    if (s.kind !== 'track') continue;
    if (onlyTracks && s.shape !== 'polyline') continue;
    let r;
    try { r = judgeTrack(s); }
    catch (e) { bad++; console.log(`[NG ] ${String(s.name ?? '(no name)').padEnd(22)} 判定不能: ${e.message}`); continue; }
    if (r.fatal) bad++; else if (r.warn) warn++;
    const mark = r.fatal ? 'NG ' : (r.warn ? 'warn' : 'ok ');
    console.log(`[${mark}] ${line(r)}${r.fatal ? '  ← ' + r.why.join('・') : ''}`);
  }
  console.log(`\n${bad} 件が致命的 (道が塞がる・車幅より細い・廊下が融合・判定不能) / ${warn} 件が要注意 (同じ輪の壁の折れ込み)`);

  // 検出力の対照: 故意に壊した spec が致命と出るか (出なければ判定が壊れている)
  let ctlBad = 0;
  console.log('\n検出力の対照 (本番の生成器で組んだ spec):');
  for (const k of CONTROLS) {
    const r = judgeTrack(k.spec), ok = r.fatal === k.expectFatal;
    if (!ok) ctlBad++;
    console.log(`  [${ok ? 'ok ' : 'NG '}] 期待=${k.expectFatal ? '致命' : '致命でない'} 判定=${r.fatal ? '致命' : (r.warn ? '要注意' : 'ok')}  ${k.why}\n         ${line(r)}`);
  }

  // フィールド検査 (AS10)
  const fieldErrs = checkFields(specs);
  console.log(`\nフィールド検査 (bank / surface ほか): ${fieldErrs.length === 0 ? 'OK (0 件)' : fieldErrs.length + ' 件のエラー'}`);
  for (const e of fieldErrs) console.error(`  [NG ] ${e}`);
  if (bad > 0 || ctlBad > 0 || fieldErrs.length > 0) process.exit(1);
}
