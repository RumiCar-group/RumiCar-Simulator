// contact_v2.js — Stage AO 接触 v2 (AO1: 静的壁ブロードフェーズ基盤 → AO4: インパルスソルバ)。
// ════════════════════════════════════════════════════════════════════════════
// AO4 で **掃引 CCD・壁2点マニフォールド・OBB-OBB 車車マニフォールド・法線/接線 (クーロン) インパルス
// 解決 (逐次インパルス Gauss-Seidel)・split-impulse 位置補正** を追加した (`resolveFleetContacts`)。
// これを fleet.js の `integrateFleetV2` が全車同時積分で呼ぶ (旧 `integrateSlot`=1台ずつ原子棄却 は無改変)。
// 本ファイルは車の内部 (動力学/aFrac/izK) を知らない **純粋な剛体接触ライブラリ**: 車は
// physics_v2.js の `_contactBody()`/`_setContactVel()` で剛体パラメータ (CG・世界系速度・逆質量/慣性) を
// 提供し、ソルバはこの抽象 body 配列 (fleet が組む) のみを読み書きする (カプセル化・決定論・乱数/時刻なし)。
//
// ブロードフェーズ (AO_spec §3): コース読込時に壁線分を静的一様グリッド (セル≈2×車長) へ
// 決定論的に格納 (壁 index 昇順・整数セルキー)。近傍問い合わせが O(walls) 全走査を O(近傍) へ
// 縮約する。**センサー (coneNearest) と接触 (distToSeg) の両方が同じグリッドを共用できる**
// 設計であり、AO1 の受け入れは「グリッド候補への問い合わせ結果が全壁走査と差分ゼロで一致する」
// ことの機械確認 (wf_ao1_v2)。
//
// 等価性の根拠 (ゼロ差分の証明): 各壁を「その線分の bbox が覆う全セル」へ登録し、問い合わせは
// 「AABB が覆う全セル」の壁を集める。原点から半径 R の円 (センサー maxRange 等) を含む AABB で
// 問い合わせると、距離 R 以内に反射面を持つ壁は必ず bbox が AABB と重なる→同じセルを共有→候補に
// 含まれる。AABB と分離した bbox を持つ壁は全点が R 超 (ある軸で |Δ|>R)=範囲内ヒット不可能ゆえ
// 安全に除外できる。よって coneNearest(候補)===coneNearest(全壁)、min distToSeg(候補)===全壁。
// ════════════════════════════════════════════════════════════════════════════
import { CAR, SCALE_STATE } from './config.js';
import { segIntersect, raySeg, fanDepths } from './geom.js';

// 壁グリッド構築。cell 省略時はセル寸法 = 2×車長 (AO_spec §3)。決定論的 (壁 index 昇順で push)。
// walls = [{x1,y1,x2,y2,...}]。返り値 { cell, cells:Map<"ix,iy",number[]>, walls, bounds }。
export function buildWallGrid(walls, cell) {
  const cs = cell || (2 * CAR.length);
  const cells = new Map();
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const wx0 = Math.min(w.x1, w.x2), wx1 = Math.max(w.x1, w.x2);
    const wy0 = Math.min(w.y1, w.y2), wy1 = Math.max(w.y1, w.y2);
    const ix0 = Math.floor(wx0 / cs), ix1 = Math.floor(wx1 / cs);
    const iy0 = Math.floor(wy0 / cs), iy1 = Math.floor(wy1 / cs);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        const k = ix + ',' + iy;
        let a = cells.get(k);
        if (!a) { a = []; cells.set(k, a); }
        a.push(i);   // 壁 index を昇順に push (外側 i 昇順ループ=決定論)
      }
    }
    if (wx0 < minx) minx = wx0;
    if (wy0 < miny) miny = wy0;
    if (wx1 > maxx) maxx = wx1;
    if (wy1 > maxy) maxy = wy1;
  }
  return { cell: cs, cells, walls, bounds: { minx, miny, maxx, maxy } };
}

// AABB (minx,miny)-(maxx,maxy) と重なるセルの壁 index を昇順・重複なしで返す (決定論)。
export function queryAABB(grid, minx, miny, maxx, maxy) {
  const cs = grid.cell;
  const ix0 = Math.floor(minx / cs), ix1 = Math.floor(maxx / cs);
  const iy0 = Math.floor(miny / cs), iy1 = Math.floor(maxy / cs);
  const seen = new Set();
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iy = iy0; iy <= iy1; iy++) {
      const a = grid.cells.get(ix + ',' + iy);
      if (!a) continue;
      for (const wi of a) seen.add(wi);
    }
  }
  const out = Array.from(seen);
  out.sort((x, y) => x - y);
  return out;
}

// 原点 (ox,oy) から半径 r の円を包む AABB の候補壁「オブジェクト」配列 (readAll/distToSeg にそのまま渡せる)。
// センサー: r = maxRange (+ センサー原点オフセット余裕) / 接触: r = 車半対角 + slop。
export function queryRadius(grid, ox, oy, r) {
  const idx = queryAABB(grid, ox - r, oy - r, ox + r, oy + r);
  const out = new Array(idx.length);
  for (let i = 0; i < idx.length; i++) out[i] = grid.walls[idx[i]];
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// ブロードフェーズ配線の共有点 (AP6)。センサー (readAll/readRear)・v1 衝突 (checkCollision)・v2 接触
// (resolveFleetContacts) が同じ course.walls を渡す限り **グリッドを共用** する。
// **セル寸法は照会サイズに合わせて2種類持つ** (AP6 実測): 接触/衝突は「車サイズ」照会ゆえ細セル
// (=2×車長) が最適だが、センサーは「レンジ(卓上2m〜fullscale150m)」照会ゆえ細セルだと照会 AABB が
// 数百〜千のセルを跨ぎ全走査より遅い → **粗セル(=maxM)** にするとセル走査が O(1)(≈9セル) に収まる。
// 候補=全壁の等価性はセル寸法に依らない (本ファイル冒頭の零差分証明) ため、どちらのセルでも結果 byte は
// 不変 (性能のみ影響)。グリッドは (walls, cell) ごとにキャッシュし、regime 変化で cell が変わると作り直す
// (卓上グリッドを fullscale で使い回してセル走査が爆発するのを防ぐ)。
// 【BE7・2026-09-25】**1 つの壁配列が持つグリッドは直近に使った GRID_CACHE_MAX 個まで**。旧実装はセル寸法ごとに
//   作ったグリッドを全部持ち続けた。細セルは 2×車長なので、車体スケールのスライダーを動かすたびに新しいセル寸法の
//   グリッドが積み上がる (実測・改修前: 1000 m の水平壁 149 本の投稿コースで 0.5→4.0 を掃くと 1 段あたり 50〜200 MB
//   増え、node 既定ヒープ 2,198 MB で cs2.7 のとき OOM)。同時に使うセル寸法は 2 つ (接触/衝突の細セル・センサーの
//   粗セル) なので 3 個あれば入れ替わりで作り直しは起きない。追い出したグリッドは同じ (walls, cell) で呼ばれれば
//   同じ手順で作り直され、中身 (セルの壁 index の並び) は同一＝照会の答えも並びも変わらない (buildWallGrid は決定論)。
//   呼び出し側がグリッドを掴んだまま追い出されても、その呼び出しの中では元のグリッドがそのまま使える (不変オブジェクト)。
export const GRID_CACHE_MAX = 3;
const _gridCache = new WeakMap();     // walls → [{ cell, g }]。先頭が直近に使ったもの (最大 GRID_CACHE_MAX 個)。
function gridFor(walls, cell) {
  let list = _gridCache.get(walls);
  if (!list) { list = []; _gridCache.set(walls, list); }
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.cell === cell) {
      if (i > 0) { list.splice(i, 1); list.unshift(e); }   // 直近へ (先頭なら何もしない＝同じセル寸法が続く照会は探索 1 回)
      return e.g;
    }
  }
  const g = buildWallGrid(walls, cell);
  g._vis = new Int32Array(walls.length);   // wallsNear の epoch dedup マーカ (照会ごとの Set 確保を消す)
  g._epoch = 0;
  let entries = 0;
  for (const a of g.cells.values()) entries += a.length;
  g._fill = g.cells.size ? entries / g.cells.size : 0;   // BE7: 空でないセル 1 つあたりの平均登録数 (anyWallNearSeg の前判定)
  list.unshift({ cell, g });
  if (list.length > GRID_CACHE_MAX) list.length = GRID_CACHE_MAX;   // 最も長く使っていないものを捨てる
  return g;
}
// 壁配列 walls がいま保持しているグリッドの個数 (BE7)。**読むだけ**の口で、判定・照会には使わない。
// 常設ゲート wf_be7_heavy.mjs が「掃引の後も GRID_CACHE_MAX 以下」を product の実体で数えるために export する
// (roadFrame 等と同じ「検査側へ述語を写し取らない」ための export・CI-9)。
export function wallGridCount(walls) { const list = _gridCache.get(walls); return list ? list.length : 0; }
// 接触/衝突用グリッド (細セル=2×車長)。fleet.js の resolveFleetContacts・physics.js の checkCollision が使う。
export function wallGridFor(walls) { return gridFor(walls, 2 * CAR.length); }

// 壁数がこれ未満のコースはブロードフェーズを配線せず従来の全走査を使う (AP6 受け入れ④)。小コースでは
// グリッド構築/照会のオーバヘッドが線形走査の利得を上回るため。中央値コース=180 壁ゆえ実コースは殆ど
// グリッド経路、極小の合成/治具コースのみ従来経路。
export const WALL_BP_MIN = 32;

// 照会 AABB (中心 cx,cy・半径 r) がグリッド全域 (=コース全壁の外接矩形) を覆うか。覆うなら全壁が候補に
// なる (照会しても全壁が返る) ので、走査/確保を省いて元配列をそのまま返せる。
function coversBounds(g, cx, cy, r) {
  const b = g.bounds;
  return cx - r <= b.minx && cy - r <= b.miny && cx + r >= b.maxx && cy + r >= b.maxy;
}

// 中心 (cx,cy)・半径 r の円を包む AABB の候補壁を返す (AP6)。cell=使うグリッドのセル寸法 (接触は 2×車長・
// センサーは maxM を渡す)。壁数<32 (WALL_BP_MIN) か、照会がコース全域を覆う (卓上センサー=レンジがコースを
// 覆う) ときは **元の walls 配列をそのまま返す** (全走査と byte 同値・確保ゼロ)。それ以外はグリッド照会。
//   **性能**: queryRadius (Set+Array.from+sort=3確保/照会) は S3 実測で自己時間 1 位=利得を食い潰したため、
//   本関数は (1) epoch マーカ配列 g._vis で dedup=**Set 確保なし** (2) **sort なし**=昇順 index に整列しない
//   の2点で確保/計算を削る。整列を外せるのは candidate の用途が **最小距離 (センサー mm) / 交差有無 (衝突
//   bool)** ＝ **走査順に依らず結果不変** だから (mm は同値・bool は同値。順序が効くのは同一距離 tie 時の
//   hit 描画点だけ=学習/判定/verifyHash 非参照)。候補は毎回 1 本の右サイズ配列に push (呼び出し側は保持せず
//   即消費)。等価性 (mm/bool=全走査) は専用ゲート _ap6_equiv で 41 コース全数実測。
export function wallsNear(walls, cx, cy, r, cell) {
  const n = walls.length;
  if (n < WALL_BP_MIN) return walls;
  const g = gridFor(walls, cell);
  if (coversBounds(g, cx, cy, r)) return walls;
  const cs = g.cell, cells = g.cells, gw = g.walls, vis = g._vis;
  const ix0 = Math.floor((cx - r) / cs), ix1 = Math.floor((cx + r) / cs);
  const iy0 = Math.floor((cy - r) / cs), iy1 = Math.floor((cy + r) / cs);
  const ep = ++g._epoch;
  const out = [];
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iy = iy0; iy <= iy1; iy++) {
      const a = cells.get(ix + ',' + iy);
      if (!a) continue;
      for (let k = 0; k < a.length; k++) {
        const wi = a[k];
        if (vis[wi] === ep) continue;   // この照会で既出 (bbox が複数セルに跨る壁) は 1 回だけ
        vis[wi] = ep;
        out.push(gw[wi]);
      }
    }
  }
  return out;
}

// 線分 (ax,ay)-(bx,by) について test(ax, ay, bx, by, wall) が真になる壁が 1 本でもあるか (BE7・2026-09-25)。
// fleet.js の見通し判定 (freeSpawn の廊下判定・廊下 BFS の 1 歩) が test=segHitWall で呼ぶ。**答えは全壁を順に
// test した結果と同じ** (「1 本でも真なら真」は走査順に依らない)。候補の決め方:
//   test は「線分・壁それぞれの長さの tol 倍まで端の外」の交点も真にしうるとする (segHitWall は 1e-7。呼び出し側は
//   その 10 倍を渡す)。すると交点は線分の中点から (0.5+tol)×線分長 以内、かつ壁の外接矩形から tol×壁長 以内にある。
//   壁長は全壁の外接矩形 (grid.bounds) の対角 D 以下なので、半径 r = (0.5+tol)×線分長 + tol×D の円を包む AABB が
//   触れるセルに、真になりうる壁は必ず登録されている (wallsNear と同じ等価性の議論)。
// 速い方を選ぶだけの分岐 (どれを通っても答えは同じ):
//   ・壁 < WALL_BP_MIN・照会がコース全域を覆う・照会するセルが多い (長い見通し線を小さいセルで引く) ときは全走査。
//     セル 1 つの照会は文字列キー＋Map 引きなので、セル数 × SEG_CELL_COST が壁数以上なら全走査の方が安い。
//   ・候補の延べ本数 (セルごとの登録数の和) か、その見込み (照会セル数×空でないセルの平均登録数) が壁数の半分以上
//     なら全走査 (大きい車でセルがコースを覆うほど粗いとき。
//     候補 1 本の test は epoch 印の読み書きが乗るぶん全走査の 1 本より重い。候補配列を作ってから全部を走査する
//     初版は、出荷コース (ウェットテクニカル midscale cs2.9 でセル 2.2 m・コース全体が 4 セル) で 45% 遅くなった)。
//   ・それ以外は候補をその場で test (配列を作らない・複数セルに跨る壁は epoch 印で 1 回だけ)。
const SEG_CELL_COST = 16;
export function anyWallNearSeg(walls, ax, ay, bx, by, tol, cell, test) {
  const n = walls.length;
  if (n >= WALL_BP_MIN) {
    const g = gridFor(walls, cell), b = g.bounds;
    const r = (0.5 + tol) * Math.hypot(bx - ax, by - ay) + tol * Math.hypot(b.maxx - b.minx, b.maxy - b.miny);
    const cx = 0.5 * (ax + bx), cy = 0.5 * (ay + by);
    if (r >= 0 && !coversBounds(g, cx, cy, r)) {   // r が NaN (非有限の入力) なら全走査
      const cs = g.cell, cells = g.cells;
      const ix0 = Math.floor((cx - r) / cs), ix1 = Math.floor((cx + r) / cs);
      const iy0 = Math.floor((cy - r) / cs), iy1 = Math.floor((cy + r) / cs);
      const nc = (ix1 - ix0 + 1) * (iy1 - iy0 + 1);
      // 前判定 (Map を引く前): 見込みの候補数 (セル数×平均登録数) が壁数の半分以上なら候補限定は割に合わない。
      if (nc * SEG_CELL_COST < n && 2 * nc * g._fill < n) {
        const arrs = [];
        let tot = 0;
        for (let ix = ix0; ix <= ix1; ix++) {
          for (let iy = iy0; iy <= iy1; iy++) {
            const a = cells.get(ix + ',' + iy);
            if (a) { arrs.push(a); tot += a.length; }
          }
        }
        if (2 * tot < n) {
          const vis = g._vis, gw = g.walls, ep = ++g._epoch;
          for (let j = 0; j < arrs.length; j++) {
            const a = arrs[j];
            for (let k = 0; k < a.length; k++) {
              const wi = a[k];
              if (vis[wi] === ep) continue;
              vis[wi] = ep;
              if (test(ax, ay, bx, by, gw[wi])) return true;
            }
          }
          return false;
        }
      }
    }
  }
  for (let i = 0; i < n; i++) if (test(ax, ay, bx, by, walls[i])) return true;
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
// 描画用のレイ照会 (BE7・2026-09-25)。**描画専用** (hud.js のセンサー扇・depth.js の深度ビュー)。
// 測距 (sensors.js の coneNearest)・衝突・接触・verifyHash には使わない (AQ-1 の fanDepths と同じ扱い)。
// 旧経路は 1 本のレイごとに到達範囲の全壁へ raySeg を回していた。センサーの到達範囲は卓上 2 m・深度ビューは 2.8 m
// で卓上コースの大半を覆うため、粗セルの候補限定でも壁の本数に比例した (実測・改修前: 卓上楕円を壁 20,000 本で
// 描いた投稿コースで 6 台走らせると 1 フレーム 119.6 ms。同じ形を 960 本で描くと 19.9 ms)。
// ここではレイが通るセルを近い順に辿り (セル寸法 cell のグリッド・DDA)、見つかった最近交差がそのセルの出口より
// 手前なら打ち切る。値は**全壁走査の最小と同じ**: 交差点 P は壁の外接矩形に入る → 壁は P を含むセルに登録されて
// いる → レイはそのセルを P の手前か P で通る。打ち切った時点の最小 best はそのセルの出口より手前にあり、以降の
// セルの交差はすべて出口より先 (＝best より遠い)。各壁の t は旧経路と同じ raySeg に同じ引数で計算する (同じ double)。
// 打ち切りは出口の (1−1e-9) 倍より手前のときだけにして、出口の丸めで 1 セル早く止まらないようにしてある。
// 戻り値: 最近交差の t (レイの方向ベクトルの長さ単位) が tMax 未満ならその値、無ければ Infinity。
// 格子線の上をなぞるレイの扱い (丸めの境目・層 4 レビューで 2 型の反例): 交点が格子線のちょうど上にある壁は、
// 丸めしだいで線の片側のセルにだけ登録されうる。DDA が線の反対側のセルを通らないと見落とす。
//   ① 角: DDA は格子の角をかすめるとき x 側・y 側のどちらか一方のセルを通って斜めへ進む (反例: 端点が角から 1 ulp
//      内側の壁で、全壁走査 0.3948 に対し Infinity)。∴ x 境界と y 境界への到達がほぼ同時 (差が相対 1e-9 以内) なら
//      角の両隣のセルも見てから斜めへ進む。
//   ② 軸にほぼ平行なレイが格子線の上を走る: DDA はその軸の行 (列) を変えない (反例: 水平なレイが y=m·cs の上を通り、
//      端点が線から 1〜2 ulp 下の行にずれた壁を見落とした。車の向きがちょうど 0 のとき中央センサーの扇の中心方向は
//      厳密に水平)。∴ レイの到達範囲 tMax でその成分の動く距離が 1e-9 以内 (＝ほぼ平行) で、原点が格子線から 1e-9
//      以内なら、**その格子線の両側の 2 行 (列)** を通るセルごとに見る。行は DDA の今の行でなく線そのもので決める
//      (原点が線のちょうど上で成分が -1e-16 だと、DDA は t=0 で隣の行へ移る＝今の行を基準にすると線の反対側を外す)。
// 割に合わないときは全走査 (答えは同じ・速い方を選ぶだけ・層 4 レビューが出荷コースで最大 3 倍の遅れを実測した):
//   ・通りうるセル数 (2×⌈tMax/cell⌉+2) × RAY_CELL_COST が壁数以上 (壁の少ない・疎なコース。空セルの照会＝文字列キー＋
//     Map 引きが全走査より重い)。
//   ・壁のあるセル RAY_HIT_CELLS 個ぶんの登録数 (空でないセルの平均 × 3) が壁数の半分以上 (セルがコース全体を
//     覆うほど粗いとき。候補が結局ほぼ全壁になり、dedupe の印の読み書きのぶん全走査より重い)。閉じたコースのレイは
//     多くの場合、最初の数個の壁のあるセルで当たって打ち切るので、通りうる全セルで見積もると過大 (実測: 壁 20,000 本の
//     楕円で全走査を選んでしまい、深度ビューが改修前と同じ重さに戻った)。
const RAY_CELL_COST = 16, RAY_HIT_CELLS = 3;
function rayWorthGrid(n, tMax, cell) {
  return n >= WALL_BP_MIN && (2 * Math.ceil(tMax / cell) + 2) * RAY_CELL_COST < n;   // NaN・Infinity は偽＝全走査
}
function rayCell(g, ix, iy, ep, ox, oy, dx, dy, best) {
  const a = g.cells.get(ix + ',' + iy);
  if (!a) return best;
  const vis = g._vis, gw = g.walls;
  for (let k = 0; k < a.length; k++) {
    const wi = a[k];
    if (vis[wi] === ep) continue;   // この照会で既に見た壁 (複数セルに跨る壁) は 1 回だけ
    vis[wi] = ep;
    const w = gw[wi];
    const t = raySeg(ox, oy, dx, dy, w.x1, w.y1, w.x2, w.y2);
    if (t < best) best = t;
  }
  return best;
}
function rayScanAll(walls, ox, oy, dx, dy, tMax) {
  let best = Infinity;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const t = raySeg(ox, oy, dx, dy, w.x1, w.y1, w.x2, w.y2);
    if (t < best) best = t;
  }
  return best < tMax ? best : Infinity;
}
// レイ照会 (グリッド経路) が割に合うか (上の 2 条件)。depth.js が 1 フレームに 1 回だけ呼んで、割に合わなければ
// BE7 前と同じ全走査を自分の中で回す (列ごとの関数呼び出しの固定費も払わない＝壁の少ないコースで遅くしない)。
export function rayGridWorth(walls, tMax, cell) {
  const n = walls.length;
  if (!rayWorthGrid(n, tMax, cell)) return false;   // 小コース・疎なコース
  return 2 * RAY_HIT_CELLS * gridFor(walls, cell)._fill < n;   // セルが粗い
}
export function rayNearestWall(walls, ox, oy, dx, dy, tMax, cell) {
  let best = Infinity;
  if (!rayGridWorth(walls, tMax, cell)) return rayScanAll(walls, ox, oy, dx, dy, tMax);
  const g = gridFor(walls, cell);
  const cs = g.cell;
  const ep = ++g._epoch;
  let ix = Math.floor(ox / cs), iy = Math.floor(oy / cs);
  const sx = dx > 0 ? 1 : (dx < 0 ? -1 : 0), sy = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
  // ② 軸にほぼ平行なレイが格子線の上を走るとき、その線の両側の行 (列) を見る (上の注記)。
  const epsY = 1e-9 * (1 + Math.abs(oy)), epsX = 1e-9 * (1 + Math.abs(ox));
  const lineY = Math.round(oy / cs), lineX = Math.round(ox / cs);
  const onLineY = Math.abs(dy) * tMax <= epsY && Math.abs(oy - lineY * cs) <= epsY;
  const onLineX = Math.abs(dx) * tMax <= epsX && Math.abs(ox - lineX * cs) <= epsX;
  for (;;) {
    best = rayCell(g, ix, iy, ep, ox, oy, dx, dy, best);
    if (onLineY) { best = rayCell(g, ix, lineY - 1, ep, ox, oy, dx, dy, best); best = rayCell(g, ix, lineY, ep, ox, oy, dx, dy, best); }
    if (onLineX) { best = rayCell(g, lineX - 1, iy, ep, ox, oy, dx, dy, best); best = rayCell(g, lineX, iy, ep, ox, oy, dx, dy, best); }
    // このセルの出口 (次の x 境界・y 境界の早い方)。境界はセル番号から毎回計算する (足し込みの丸めを溜めない)。
    const tnx = sx > 0 ? ((ix + 1) * cs - ox) / dx : (sx < 0 ? (ix * cs - ox) / dx : Infinity);
    const tny = sy > 0 ? ((iy + 1) * cs - oy) / dy : (sy < 0 ? (iy * cs - oy) / dy : Infinity);
    const tExit = tnx < tny ? tnx : tny;
    // `!(tExit < tMax)` は NaN (原点が非有限) でも抜ける形 (NaN との比較は偽＝無限ループにしない)。
    if (!(tExit < tMax) || best < tExit * (1 - 1e-9)) break;
    if (Math.abs(tnx - tny) <= 1e-9 * (1 + tExit)) {   // 角をかすめる: 両隣のセルも見てから斜めへ
      best = rayCell(g, ix + sx, iy, ep, ox, oy, dx, dy, best);
      best = rayCell(g, ix, iy + sy, ep, ox, oy, dx, dy, best);
      ix += sx; iy += sy;
    } else if (tnx < tny) ix += sx; else iy += sy;
  }
  return best < tMax ? best : Infinity;
}

// センサー扇の方向別終端 (hud.js drawSensors の描画) をレイ照会で求める (BE7)。**geom.js の fanDepths に全壁を
// 渡したときと同じ値**を返す: 方向の組み立ては fanDepths と同じ式・同じ順で、各方向の値は「maxM・壁の最近交差
// (maxM 未満だけ)・他車エッジ (extra) の最近交差」の最小。常設ゲート wf_fan_render.mjs (C) が出荷全コースで
// fanDepths(全壁) と byte 比較し、wf_be7_heavy.mjs が重いコースで同じ比較をする。**描画専用** (上の注記)。
// wallsNear(walls, cx, cy, r, cell) が返す候補の本数の上限 (配列を作らずに数える。複数セルに跨る壁は重複して数える)。
function nearCount(walls, cx, cy, r, cell) {
  const n = walls.length;
  if (n < WALL_BP_MIN) return n;
  const g = gridFor(walls, cell);
  if (coversBounds(g, cx, cy, r)) return n;
  const cs = g.cell;
  const ix0 = Math.floor((cx - r) / cs), ix1 = Math.floor((cx + r) / cs);
  const iy0 = Math.floor((cy - r) / cs), iy1 = Math.floor((cy + r) / cs);
  let tot = 0;
  for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) { const a = g.cells.get(ix + ',' + iy); if (a) tot += a.length; }
  return tot;
}
export function fanDepthsNear(walls, ox, oy, ux, uy, halfRad, n, maxM, extra, out, cell) {
  // レイ照会が割に合わないとき (rayWorthGrid が偽) は、BE7 前の hud.js と同じ経路 (粗セル候補＋fanDepths) で引く。
  // 比べる本数は壁の総数でなく**粗セル候補の本数** (旧経路が実際に走査する本数)。広くて壁の疎なコースでは候補が
  // 近くの数十本に絞られ、総数で比べると旧経路より遅い DDA を選んでしまう (層 4 レビュー 2 回目: 競技サーキットを
  // 卓上 cs0.8 で 2.35 倍)。本数は候補の配列を作らずに粗セルの登録数の和で見積もる (重複を含む＝多めに数える。
  // 配列を作ると壁 20,000 本の楕円で扇が 1.9→4.7 ms に重くなった)。
  if (!rayWorthGrid(nearCount(walls, ox, oy, maxM + 1e-6, maxM), maxM, cell))
    return fanDepths(ox, oy, ux, uy, halfRad, n, maxM, wallsNear(walls, ox, oy, maxM + 1e-6, maxM), extra, out);
  for (let k = 0; k <= n; k++) {
    const a = -halfRad + (2 * halfRad) * (k / n);
    const ca = Math.cos(a), sa = Math.sin(a);
    const dx = ca * ux - sa * uy, dy = sa * ux + ca * uy;
    let d = maxM;
    const tw = rayNearestWall(walls, ox, oy, dx, dy, maxM, cell);
    if (tw < d) d = tw;
    if (extra) for (const w of extra) { const t = raySeg(ox, oy, dx, dy, w.x1, w.y1, w.x2, w.y2); if (t < d) d = t; }
    out[k] = d;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 接触ソルバ (AO4・AO_spec §3)。逐次インパルス (Gauss-Seidel)・クーロン摩擦・split-impulse。
// ════════════════════════════════════════════════════════════════════════════

// 接触定数 (AO_spec §3)。反発 e (壁0=めり込み反発なし・車車0.1)・摩擦 μc=muFrac×grip・反復回数。
export const V2_CONTACT = {
  eWall: 0.0,        // 壁の反発係数 (めり込み跳ね返りなし=こすり滑走を素直に)
  eCar: 0.1,         // 車車の反発係数 (わずかに弾く=団子で完全に食いつかない)
  muFrac: 0.5,       // クーロン摩擦係数 = muFrac × course.grip (§3「μc=0.5×grip」)
  velIters: 4,       // 速度インパルスの Gauss-Seidel 反復 (§3「4回固定」)
  posIters: 8,       // split-impulse 位置補正パス (§3 基本2・96m/s 貫通ゼロ保証で 8 に増・0.2⁸≈2.5e-6 残)
  posFrac: 0.8,      // 位置補正の緩和率 (per pass)
  posBias: 0.1,      // 位置補正の近接側マージン (slop 比・貫入を slop 手前へ寄せ far-side 残さない)
  vCrashFrac: 0.073, // クラッシュ閾値 = vCrashFrac × CAR.maxSpeed (fullscale≈8m/s・領域スケール不変)
  restFrac: 0.5,     // これ (×vCrash) 未満の接近には反発を適用しない (静止接触のジッタ防止)
};

// slop = めり込み許容 (§3「0.02×regimeK m」)。regimeK は領域の長さスケール=幾何と一緒に伸びる。
export function slopOf() { return 0.02 * SCALE_STATE.regimeK; }
// クラッシュ判定の法線接近速度閾値 (§3・AO4 で数値凍結)。CAR.maxSpeed は applyRegime で領域スケール化
// (卓上0.7→fullscale≈110 m/s) されるため fullscale≈8m/s・卓上≈0.051m/s と自動で縮尺 (kV 相当)。
export function vCrashOf() { return V2_CONTACT.vCrashFrac * CAR.maxSpeed; }

// 点 (px,py) が凸4隅ポリゴン cor 内か (符号一貫の外積・巻き向き非依存)。SAT の接触点抽出/防御に使う。
function pointInCorners(px, py, cor) {
  let pos = false, neg = false;
  for (let i = 0; i < 4; i++) {
    const a = cor[i], b = cor[(i + 1) % 4];
    const cr = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (cr > 1e-12) pos = true; else if (cr < -1e-12) neg = true;
    if (pos && neg) return false;
  }
  return true;
}

// 点 P を線分 (ax,ay)-(bx,by) 上の最近点へ射影 (掃引貫通で範囲外の隅の接触点用)。
function projSeg(P, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
  if (l2 < 1e-12) return { x: ax, y: ay };
  let t = ((P.x - ax) * ex + (P.y - ay) * ey) / l2;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + t * ex, y: ay + t * ey };
}

// 壁マニフォールド (車 OBB × 壁線分)。隅の符号付き距離 (near 側+)・区間内判定・掃引 CCD で接触を作り、
// **深い2点** (平行こすりのジッタ抑制・§3) を out へ push する。B=body・wall={x1,y1,x2,y2}・bi=body index。
function wallManifold(B, wall, slop, out, bi) {
  const ax = wall.x1, ay = wall.y1, bx = wall.x2, by = wall.y2;
  let dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return;                 // 縮退(0長)壁=遮蔽実体ゼロ (geom.js と同じ安全側)
  dx /= len; dy /= len;
  let nx = -dy, ny = dx;                   // 法線候補 ⟂ 壁
  // near 側 = 車が「入ってきた側」= 前ステップ CG 側 (掃引貫通しても正しい向きを保つ)。
  let side = (B.pcx - ax) * nx + (B.pcy - ay) * ny;
  if (Math.abs(side) < 1e-9) side = (B.cx - ax) * nx + (B.cy - ay) * ny;
  if (side < 0) { nx = -nx; ny = -ny; }
  let c0 = null, c1 = null;                // 深い2点
  for (let ci = 0; ci < 4; ci++) {
    const P = B.cor[ci];
    const sNow = (P.x - ax) * nx + (P.y - ay) * ny;    // 壁ラインへの符号付き距離 (near 側+)
    const proj = (P.x - ax) * dx + (P.y - ay) * dy;    // 壁方向への射影
    const within = proj >= -slop && proj <= len + slop;
    let crossed = false;                                // 掃引 CCD: 前隅→現隅 が壁線分を横切ったか
    if (B.pcor) {
      const Q = B.pcor[ci];
      crossed = segIntersect({ x: Q.x, y: Q.y }, { x: P.x, y: P.y }, { x: ax, y: ay }, { x: bx, y: by });
    }
    if ((sNow < slop && within) || crossed) {
      const cp = within ? { x: P.x, y: P.y } : projSeg(P, ax, ay, bx, by);
      const c = { ptx: cp.x, pty: cp.y, nx, ny, pen: -sNow, a: bi, b: -1 };   // pen=貫入 (−sNow・負=near 側)
      if (!c0 || c.pen > c0.pen) { c1 = c0; c0 = c; }
      else if (!c1 || c.pen > c1.pen) { c1 = c; }
    }
  }
  if (c0) out.push(c0);
  if (c1) out.push(c1);
}

// 車車マニフォールド (OBB-OBB・SAT)。最小重なり軸=法線・重なり量=貫入。接触点は相互に相手内へ入った頂点。
function obbManifold(A, B, slop, out, ia, ib) {
  const ca = A.cor, cb = B.cor;
  const axes = [                                        // 各 box の辺法線 (2軸ずつ・平行冗長は無害)
    { x: -(ca[1].y - ca[0].y), y: ca[1].x - ca[0].x },
    { x: -(ca[2].y - ca[1].y), y: ca[2].x - ca[1].x },
    { x: -(cb[1].y - cb[0].y), y: cb[1].x - cb[0].x },
    { x: -(cb[2].y - cb[1].y), y: cb[2].x - cb[1].x },
  ];
  let minOv = Infinity, nx = 0, ny = 0;
  for (const a of axes) {
    const l = Math.hypot(a.x, a.y); if (l < 1e-9) continue;
    const ux = a.x / l, uy = a.y / l;
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const p of ca) { const d = p.x * ux + p.y * uy; if (d < amin) amin = d; if (d > amax) amax = d; }
    for (const p of cb) { const d = p.x * ux + p.y * uy; if (d < bmin) bmin = d; if (d > bmax) bmax = d; }
    const ov = Math.min(amax, bmax) - Math.max(amin, bmin);
    if (ov <= 0) return;                                // 分離軸あり=非接触
    if (ov < minOv) { minOv = ov; nx = ux; ny = uy; }
  }
  if ((A.cx - B.cx) * nx + (A.cy - B.cy) * ny < 0) { nx = -nx; ny = -ny; }   // n を B→A へ向ける
  const pts = [];
  for (const p of ca) if (pointInCorners(p.x, p.y, cb)) pts.push({ x: p.x, y: p.y });
  for (const p of cb) if (pointInCorners(p.x, p.y, ca)) pts.push({ x: p.x, y: p.y });
  if (!pts.length) pts.push({ x: 0.5 * (A.cx + B.cx), y: 0.5 * (A.cy + B.cy) });   // 防御 (深貫入で頂点抽出漏れ)
  for (let i = 0; i < pts.length && i < 2; i++) {
    out.push({ ptx: pts[i].x, pty: pts[i].y, nx, ny, pen: minOv, a: ia, b: ib });
  }
}

// body 接触点 (ptx,pty) での世界系点速度 (v_cg + ω×r) を返す。r=(ptx−cx, pty−cy)。
function pointVel(bd, rx, ry) { return { vx: bd.vx - bd.w * ry, vy: bd.vy + bd.w * rx }; }

// 全車同時の接触解決 (AO4 の心臓)。bodies=fleet が組む剛体配列 (dynamic は invM>0・crashed/held は static
// invM=0)。grid=壁ブロードフェーズ (null なら walls 全走査)。grip=course.grip。interact=車車 ON。
// 返り値なし。bodies の vx,vy,w (速度インパルス) と dx,dy (位置補正の並進・fleet が car.x/y へ加算) と
// maxAppr (その解決での最大法線接近速度=クラッシュ判定材料) を **その場で更新** する。決定論 (乱数/時刻なし・
// body index 昇順・車車 i<j 昇順・接触は生成順の固定 Gauss-Seidel)。運動量保存: 各インパルスは接触点で
// 大きさ等しく向き逆に A/B へ適用=Σmv 厳密保存・角運動量も同点対の逆向き対で保存 (T ボーン授受が創発)。
export function resolveFleetContacts(bodies, grid, walls, grip, interact) {
  const slop = slopOf();
  const mu = V2_CONTACT.muFrac * (grip || 1);
  const restCut = V2_CONTACT.restFrac * vCrashOf();
  const n = bodies.length;

  // ── 1. 接触の収集 (壁: 各 dynamic body のブロードフェーズ近傍 / 車車: interact 時の i<j 全ペア) ──
  const contacts = [];
  for (let bi = 0; bi < n; bi++) {
    const B = bodies[bi];
    if (B.invM <= 0) continue;             // static (crashed/held) は壁と接触しても動かない=壁接触不要
    let cand;
    if (grid) {
      // 掃引を覆う照会円: 現 CG 中心・半径 = 車半対角 + 今ステップ変位 + slop。
      const disp = Math.hypot(B.cx - B.pcx, B.cy - B.pcy);
      const reach = 0.5 * Math.hypot(CAR.length, CAR.width) + disp + slop + CAR.length;
      cand = queryRadius(grid, B.cx, B.cy, reach);
    } else cand = walls;
    for (const w of cand) wallManifold(B, w, slop, contacts, bi);
  }
  if (interact) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (bodies[i].invM <= 0 && bodies[j].invM <= 0) continue; // static 同士のみ除外 (少なくとも片方 dynamic なら index 順に依らず解決)
        obbManifold(bodies[i], bodies[j], slop, contacts, i, j);
      }
    }
  }
  if (!contacts.length) return;

  // ── 2. 前計算 (レバー腕・実効質量 kn/kt・初期接近速度 vn0→反発目標＋maxAppr) ──
  for (const c of contacts) {
    const A = bodies[c.a], Bd = c.b < 0 ? null : bodies[c.b];
    const rax = c.ptx - A.cx, ray = c.pty - A.cy;
    const rbx = Bd ? c.ptx - Bd.cx : 0, rby = Bd ? c.pty - Bd.cy : 0;
    c.rax = rax; c.ray = ray; c.rbx = rbx; c.rby = rby;
    const rnA = rax * c.ny - ray * c.nx, rnB = rbx * c.ny - rby * c.nx;
    const invMB = Bd ? Bd.invM : 0, invIB = Bd ? Bd.invI : 0;
    c.kn = A.invM + invMB + rnA * rnA * A.invI + rnB * rnB * invIB;
    const tx = -c.ny, ty = c.nx;
    const rtA = rax * ty - ray * tx, rtB = rbx * ty - rby * tx;
    c.kt = A.invM + invMB + rtA * rtA * A.invI + rtB * rtB * invIB;
    const vpa = pointVel(A, rax, ray);
    const vpb = Bd ? pointVel(Bd, rbx, rby) : { vx: 0, vy: 0 };
    const vn0 = (vpa.vx - vpb.vx) * c.nx + (vpa.vy - vpb.vy) * c.ny;
    c.e = c.b < 0 ? V2_CONTACT.eWall : V2_CONTACT.eCar;
    c.restTarget = (vn0 < -restCut) ? -c.e * vn0 : 0;         // 硬い接近のみ反発 (静止接触ジッタ防止)
    c.Pn = 0; c.Pt = 0;
    const appr = -vn0;                                        // 法線接近速度 (>0=接近)
    if (appr > A.maxAppr) A.maxAppr = appr;
    if (Bd && appr > Bd.maxAppr) Bd.maxAppr = appr;
  }

  // ── 3. 速度インパルス (逐次インパルス・Gauss-Seidel velIters・累積 Pn で摩擦は μ·Pn クランプ) ──
  for (let it = 0; it < V2_CONTACT.velIters; it++) {
    for (const c of contacts) {
      const A = bodies[c.a], Bd = c.b < 0 ? null : bodies[c.b];
      // 法線
      let vpa = pointVel(A, c.rax, c.ray);
      let vpb = Bd ? pointVel(Bd, c.rbx, c.rby) : { vx: 0, vy: 0 };
      const vn = (vpa.vx - vpb.vx) * c.nx + (vpa.vy - vpb.vy) * c.ny;
      let dPn = (-vn + c.restTarget) / c.kn;
      const newPn = Math.max(0, c.Pn + dPn); dPn = newPn - c.Pn; c.Pn = newPn;
      let Jx = dPn * c.nx, Jy = dPn * c.ny;
      A.vx += Jx * A.invM; A.vy += Jy * A.invM; A.w += (c.rax * Jy - c.ray * Jx) * A.invI;
      if (Bd) { Bd.vx -= Jx * Bd.invM; Bd.vy -= Jy * Bd.invM; Bd.w -= (c.rbx * Jy - c.rby * Jx) * Bd.invI; }
      // 接線 (クーロン: |Pt| ≤ μ·Pn)
      const tx = -c.ny, ty = c.nx;
      vpa = pointVel(A, c.rax, c.ray);
      vpb = Bd ? pointVel(Bd, c.rbx, c.rby) : { vx: 0, vy: 0 };
      const vt = (vpa.vx - vpb.vx) * tx + (vpa.vy - vpb.vy) * ty;
      let dPt = -vt / c.kt;
      const maxPt = mu * c.Pn;
      const newPt = Math.max(-maxPt, Math.min(maxPt, c.Pt + dPt)); dPt = newPt - c.Pt; c.Pt = newPt;
      Jx = dPt * tx; Jy = dPt * ty;
      A.vx += Jx * A.invM; A.vy += Jy * A.invM; A.w += (c.rax * Jy - c.ray * Jx) * A.invI;
      if (Bd) { Bd.vx -= Jx * Bd.invM; Bd.vy -= Jy * Bd.invM; Bd.w -= (c.rbx * Jy - c.rby * Jx) * Bd.invI; }
    }
  }

  // ── 4. split-impulse 位置補正 (速度に触れず並進のみ・貫入を slop 内へ。掃引貫通も 0.2⁸ で near 側へ) ──
  const target = -V2_CONTACT.posBias * slop;               // 貫入 pen をこの値 (<0=near 側 slop×bias) まで押す
  for (let it = 0; it < V2_CONTACT.posIters; it++) {
    for (const c of contacts) {
      const A = bodies[c.a], Bd = c.b < 0 ? null : bodies[c.b];
      const sepA = A.dx * c.nx + A.dy * c.ny;
      const sepB = Bd ? Bd.dx * c.nx + Bd.dy * c.ny : 0;
      const pen = c.pen - (sepA - sepB);                    // 現在の貫入 (並進で n 方向へ動いた分だけ減る)
      const corr = V2_CONTACT.posFrac * (pen - target);
      if (corr <= 0) continue;
      const invMB = Bd ? Bd.invM : 0;
      const kM = A.invM + invMB;
      if (kM <= 0) continue;
      const cA = corr * (A.invM / kM), cB = corr * (invMB / kM);
      A.dx += cA * c.nx; A.dy += cA * c.ny;
      if (Bd) { Bd.dx -= cB * c.nx; Bd.dy -= cB * c.ny; }
    }
  }
}
