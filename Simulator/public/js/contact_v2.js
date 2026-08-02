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
import { segIntersect } from './geom.js';

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
const _gridCache = new WeakMap();     // walls → Map<cell, grid>。cell 別に複数グリッドを保持 (接触=細/センサー=粗)。
function gridFor(walls, cell) {
  let m = _gridCache.get(walls);
  if (!m) { m = new Map(); _gridCache.set(walls, m); }
  let g = m.get(cell);
  if (!g) {
    g = buildWallGrid(walls, cell);
    g._vis = new Int32Array(walls.length);   // wallsNear の epoch dedup マーカ (照会ごとの Set 確保を消す)
    g._epoch = 0;
    m.set(cell, g);
  }
  return g;
}
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
