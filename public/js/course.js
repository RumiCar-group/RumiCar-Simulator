// コース定義と描画。データ駆動 (複数プリセット + コースエディタ対応)。
// 壁は線分 {x1,y1,x2,y2} (メートル) の配列。
// コース = { name, walls[], start{x,y,theta}, finish{x1,y1,x2,y2,fx,fy}, bounds{w,h} }
//   finish.fx/fy = 周回を計上する正方向ベクトル (省略時は start.theta から導出)。
import { VIEW, GRID } from './config.js';

function rect(x1, y1, x2, y2) {
  return [
    { x1, y1, x2: x2, y2: y1 },
    { x1: x2, y1, x2, y2 },
    { x1: x2, y1: y2, x2: x1, y2 },
    { x1, y1: y2, x2: x1, y2: y1 },
  ];
}

// 始点方位から正方向ベクトルを補完
function withForward(course) {
  if (course.finish && (course.finish.fx == null || course.finish.fy == null)) {
    const th = course.start.theta || 0;
    course.finish.fx = Math.cos(th);
    course.finish.fy = Math.sin(th);
  }
  return course;
}

// 外周矩形 + 内側の島で一様幅 m の周回廊下を作る
function ring(W, H, m) {
  return [...rect(0, 0, W, H), ...rect(m, m, W - m, H - m)];
}

// 廊下に突き出すシケイン壁 (1 本)。side で出す位置と向きを指定。
// 'top'/'bot'/'right'/'left' = 外壁から、'*Isl' = 内側の島から。depth は廊下幅 m に対する比。
function post(side, pos, W, H, m, depth = 0.55) {
  const d = depth * m;
  switch (side) {
    case 'top':     return { x1: pos, y1: H, x2: pos, y2: H - d };
    case 'topIsl':  return { x1: pos, y1: H - m, x2: pos, y2: H - m + d };
    case 'bot':     return { x1: pos, y1: 0, x2: pos, y2: d };
    case 'botIsl':  return { x1: pos, y1: m, x2: pos, y2: m - d };
    case 'right':    return { x1: W, y1: pos, x2: W - d, y2: pos };
    case 'rightIsl': return { x1: W - m, y1: pos, x2: W - m + d, y2: pos };
    case 'left':     return { x1: 0, y1: pos, x2: d, y2: pos };
    case 'leftIsl':  return { x1: m, y1: pos, x2: m - d, y2: pos };
    default: return { x1: pos, y1: 0, x2: pos, y2: 0 };
  }
}

// 周回コースを 1 行で定義。下側廊下に start とフィニッシュラインを置く。
function loopCourse(name, W, H, m, extra = []) {
  const sx = Math.max(0.4, m * 0.7);
  return withForward({
    name,
    walls: [...ring(W, H, m), ...extra],
    bounds: { w: W, h: H },
    start: { x: sx, y: m / 2, theta: 0 },
    finish: { x1: sx, y1: 0, x2: sx, y2: m },
  });
}

// ===== 中心線オフセット方式 (曲線/多角形コース) =====
// 閉じた点列を線分壁に変換。
function polyWalls(pts) {
  const w = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    w.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
  }
  return w;
}

// 周期関数 fn(t) を [0,2π) で n 点サンプリングして閉曲線を得る。
function sampleClosed(fn, n) {
  const p = [];
  for (let i = 0; i < n; i++) p.push(fn(2 * Math.PI * i / n));
  return p;
}

// 閉じた点列を Chaikin 法で角を丸める (iters 回)。粗い点列 → なめらかな曲線。
function chaikin(pts, iters) {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    const q = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = q;
  }
  return p;
}

// スペックから中心線 (閉じた点列) を生成。shape で形を選ぶ。
// samples を小さくすると直線辺の多角形、大きくするとなめらかな曲線になる。
function makeCenterline(spec) {
  const n = spec.samples || 80;
  const cx = +(spec.cx ?? 0), cy = +(spec.cy ?? 0);
  switch (spec.shape) {
    case 'ellipse':       // 楕円 / (samples 小で) 多角形: 八角=8 六角=6 ダイヤ=4 五角=5
      return sampleClosed(t => [cx + spec.rx * Math.cos(t), cy + spec.ry * Math.sin(t)], n);
    case 'lobed': {       // 花弁/くびれ形: r = rBase + amp·cos(lobes·t + phase)
      const rBase = +spec.rBase, amp = +spec.amp, lobes = +spec.lobes, phase = +(spec.phase || 0);
      return sampleClosed(t => {
        const r = rBase + amp * Math.cos(lobes * t + phase);
        return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
      }, n);
    }
    case 'superellipse': {// 角丸四角 (k<1) など
      const rx = +spec.rx, ry = +spec.ry, k = +(spec.k ?? 0.6);
      const sg = v => (v < 0 ? -1 : 1);
      return sampleClosed(t => {
        const c = Math.cos(t), s = Math.sin(t);
        return [cx + rx * sg(c) * Math.pow(Math.abs(c), k), cy + ry * sg(s) * Math.pow(Math.abs(s), k)];
      }, n);
    }
    case 'stadium': {     // 競技場形 (直線2 + 半円2)。L=直線長, rr=半幅
      const L = +spec.L, rr = +spec.rr, arc = Math.max(8, Math.floor(n / 4)), pts = [];
      for (let i = 0; i <= arc; i++) { const a = -Math.PI / 2 + Math.PI * i / arc; pts.push([cx + L / 2 + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
      for (let i = 0; i <= arc; i++) { const a = Math.PI / 2 + Math.PI * i / arc; pts.push([cx - L / 2 + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
      return pts;
    }
    case 'polyline':      // 明示的な中心線 (点列)。smooth で角を丸める
      return (spec.centerline || []).map(p => [+p[0], +p[1]]);
    default:
      return sampleClosed(t => [cx + (+spec.rx || 1) * Math.cos(t), cy + (+spec.ry || 0.7) * Math.sin(t)], n);
  }
}

// 中心線を法線方向に ±width/2 オフセットして内外 2 本の壁 (一定幅の周回路) を得る。
function offsetTrack(pts, width) {
  const n = pts.length, A = [], B = [];
  const wAt = typeof width === 'function' ? width : () => width;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
    const nx = -ty, ny = tx;
    const hw = wAt(i, 2 * Math.PI * i / n) / 2;
    A.push([p[0] + nx * hw, p[1] + ny * hw]);
    B.push([p[0] - nx * hw, p[1] - ny * hw]);
  }
  return { outer: A, inner: B };
}

// 生成したコースを左下マージン位置へ平行移動し、bounds を内容に合わせる。
function fitAndPlace(course, margin = 0.18) {
  const xs = [], ys = [];
  for (const w of course.walls) { xs.push(w.x1, w.x2); ys.push(w.y1, w.y2); }
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const maxX = Math.max(...xs), maxY = Math.max(...ys);
  const dx = margin - minX, dy = margin - minY;
  course.walls = course.walls.map(w => ({ x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy }));
  course.start = { ...course.start, x: course.start.x + dx, y: course.start.y + dy };
  if (course.centerline) course.centerline = course.centerline.map(p => [p[0] + dx, p[1] + dy]);
  if (course.finish) course.finish = {
    ...course.finish, x1: course.finish.x1 + dx, y1: course.finish.y1 + dy,
    x2: course.finish.x2 + dx, y2: course.finish.y2 + dy,
  };
  course.bounds = { w: (maxX - minX) + 2 * margin, h: (maxY - minY) + 2 * margin };
  return withForward(course);
}

// track 型: 中心線 + 幅 → 内外の壁。start/finish 省略時は中心線先頭から自動導出。
// width は数値、または widthVary {amp,freq,phase} で道幅を周期変化 (狭所テスト用)。
function buildTrack(spec) {
  let cl = makeCenterline(spec);
  if (spec.smooth) cl = chaikin(cl, spec.smooth === true ? 2 : +spec.smooth);
  const base = +spec.width;
  const v = spec.widthVary;
  const widthFn = v
    ? (i, t) => Math.max(0.3, base + (+v.amp) * Math.cos((+v.freq) * t + (+(v.phase || 0))))
    : base;
  const { outer, inner } = offsetTrack(cl, widthFn);
  const walls = [...polyWalls(outer), ...polyWalls(inner)];
  let start = spec.start, finish = spec.finish;
  if (!start) {
    const p = cl[0], b = cl[1 % cl.length], a = cl[cl.length - 1];
    start = { x: p[0], y: p[1], theta: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }
  if (!finish) finish = { x1: outer[0][0], y1: outer[0][1], x2: inner[0][0], y2: inner[0][1] };
  // AS10: 中心線をコースへ持たせる (カント gLat の道追従に使う。track は閉ループ)。fitAndPlace が
  // 平行移動して car.x/y と同一世界系に揃える。**追加のみ**で既存の参照は無し (elev3d の立体プレビューは
  // main.js が `c.touge && c.elev` で門番するので track では点かない)。
  const c = fitAndPlace({ name: spec.name || 'トラック', walls, start, finish, centerline: cl });
  c.bank = +(spec.bank || 0);          // 横勾配 (カント)[度]・未指定=0=完全 no-op (AS10)
  return c;
}

// ===== annulus 型: 外周と内周を独立した形状で定義 (角度サンプリング) =====
// 内外で形状が異なる/道幅が場所により変化するコースを作れる。
// 各境界は radiusByAngle で θ→半径 を与える: circle(r)/ellipse(rx,ry)/square(s=半辺)/
// rect(hx,hy=半幅)/ngon(R,n,phi)/superellipse(rx,ry,p)/lobed(rBase,amp,lobes,phase)。
function radiusByAngle(shape) {
  const t = shape.type;
  if (t === 'circle') { const r = +shape.r; return () => r; }
  if (t === 'ellipse') { const a = +shape.rx, b = +shape.ry; return th => (a * b) / Math.hypot(b * Math.cos(th), a * Math.sin(th)); }
  if (t === 'square') { const s = +shape.s; return th => s / Math.max(Math.abs(Math.cos(th)), Math.abs(Math.sin(th))); }
  if (t === 'rect') { const hx = +shape.hx, hy = +shape.hy; return th => Math.min(hx / (Math.abs(Math.cos(th)) || 1e-9), hy / (Math.abs(Math.sin(th)) || 1e-9)); }
  if (t === 'ngon') { const R = +shape.R, n = +shape.n, phi = +(shape.phi || 0), seg = 2 * Math.PI / n; return th => { const a = ((th - phi) % seg + seg) % seg - seg / 2; return R * Math.cos(Math.PI / n) / Math.cos(a); }; }
  if (t === 'superellipse') { const rx = +shape.rx, ry = +shape.ry, p = +(shape.p || 4); return th => Math.pow(Math.pow(Math.abs(Math.cos(th) / rx), p) + Math.pow(Math.abs(Math.sin(th) / ry), p), -1 / p); }
  if (t === 'lobed') { const rB = +shape.rBase, amp = +shape.amp, lobes = +shape.lobes, ph = +(shape.phase || 0); return th => rB + amp * Math.cos(lobes * th + ph); }
  const r = +(shape.r || 1); return () => r;
}

function buildAnnulus(spec) {
  const n = +(spec.samples || 96);
  const outerR = radiusByAngle(spec.outer), innerR = radiusByAngle(spec.inner);
  const outer = [], inner = [];
  for (let i = 0; i < n; i++) {
    const th = 2 * Math.PI * i / n;
    outer.push([outerR(th) * Math.cos(th), outerR(th) * Math.sin(th)]);
    inner.push([innerR(th) * Math.cos(th), innerR(th) * Math.sin(th)]);
  }
  const walls = [...polyWalls(outer), ...polyWalls(inner)];
  const a0 = +(spec.startAngle ?? 0);
  const oR = outerR(a0), iR = innerR(a0), midR = (oR + iR) / 2;
  const c = Math.cos(a0), s = Math.sin(a0);
  const start = { x: midR * c, y: midR * s, theta: a0 + Math.PI / 2 };
  const finish = { x1: oR * c, y1: oR * s, x2: iR * c, y2: iR * s };
  return fitAndPlace({ name: spec.name || 'アニュラス', walls, start, finish });
}

// ===== 峠 (touge) 型: スタート→ゴールの下り道 =====
// 周回ではなく、頂上(start)から麓(goal=finish)まで降りる。course.downhill で下り重力。
//   style 既定 'switchback' = 連続ヘアピン (rows 段の折返し)
//   style 'winding'         = 長い連続カーブ (架空峠。緩いS字が延々と続く serpentine)
// course.elev = 総高低差[m] (表示・立体プレビュー用)。course.centerline = 中心線(立体描画用)。
function tougeCenterline(spec) {
  const cl = [];
  if (spec.style === 'winding') {
    const N = +(spec.samples || 96), spanX = +spec.spanX, amp = +spec.amp, waves = +spec.waves, yMid = +(spec.yMid || 1.2);
    for (let i = 0; i <= N; i++) { const t = i / N; cl.push([t * spanX, yMid + amp * Math.sin(t * waves * Math.PI)]); }
    // 末尾に直線の助走を付ける (ゴールラインを端壁の手前・直線部に置いて確実に通過させる)
    const b1 = cl[cl.length - 2], b0 = cl[cl.length - 1];
    let dx = b0[0] - b1[0], dy = b0[1] - b1[1]; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    for (let k = 1; k <= 6; k++) cl.push([b0[0] + dx * 0.09 * k, b0[1] + dy * 0.09 * k]);
    return cl;
  }
  // switchback (既定)
  const rows = +spec.rows, xL = +spec.xL, xR = +spec.xR, dy = +spec.dy, yTop = +spec.yTop, arcN = +(spec.arcN || 8);
  for (let r = 0; r < rows; r++) {
    const y = yTop - r * dy;
    const ltr = r % 2 === 0;
    const a = ltr ? xL : xR, b = ltr ? xR : xL;
    cl.push([a, y], [b, y]);
    if (r < rows - 1) {
      const cx = b, cy = y - dy / 2, R = dy / 2, out = ltr ? 1 : -1;
      for (let i = 1; i < arcN; i++) { const t = (i / arcN) * Math.PI; cl.push([cx + out * R * Math.sin(t), cy + R * Math.cos(t)]); }
    }
  }
  return cl;
}
function buildTouge(spec) {
  const hw = +spec.hw;
  const cl = tougeCenterline(spec);
  const left = [], right = [];
  for (let i = 0; i < cl.length; i++) {
    const p = cl[i], a = cl[Math.max(0, i - 1)], b = cl[Math.min(cl.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
    const nx = -ty, ny = tx;
    left.push([p[0] + nx * hw, p[1] + ny * hw]); right.push([p[0] - nx * hw, p[1] - ny * hw]);
  }
  const walls = [...polyWalls(left).slice(0, left.length - 1), ...polyWalls(right).slice(0, right.length - 1)];
  // polyWalls は閉じるため、開いた廊下にするには最後の閉じ辺を除く → 上で slice
  const e = cl.length - 1;
  walls.push({ x1: left[0][0], y1: left[0][1], x2: right[0][0], y2: right[0][1] });   // スタート背後のフタ
  walls.push({ x1: left[e][0], y1: left[e][1], x2: right[e][0], y2: right[e][1] });   // ゴール先のフタ
  // スタート(頂上)はフタから少し前進。ゴールライン(麓)はゴール手前に張る。
  const th0 = Math.atan2(cl[1][1] - cl[0][1], cl[1][0] - cl[0][0]);
  const start = { x: cl[0][0] + Math.cos(th0) * 0.14, y: cl[0][1] + Math.sin(th0) * 0.14, theta: th0, downhill: +(spec.downhill || 0) };
  // ゴールラインは端壁から「距離で正確に」約0.35m手前へ補間して置く (端壁回避で止まる前に確実に通過させる)。
  // 旧実装は中心線の「点」単位で遡っており、switchback の直線部は端点しか無いため一歩で数 m 飛び、
  // ラインが最終ヘアピン出口に張られていた。そこは上段ヘアピンの膨らみと同じ x のため、アンダーで
  // 大きく膨らむ車がライン延長面を線分の外で横切り、通過ゲート (prev.s<0→s>=0) が消費されて
  // 二度とゴール判定されない事故が起きていた (未ゴールのまま走り続ける車の原因)。
  let remain = 0.35, gi = e, q = [cl[e][0], cl[e][1]];
  while (gi > 0) {
    const a = cl[gi - 1], b = cl[gi];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (seg >= remain) { const t = remain / seg; q = [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t]; break; }
    remain -= seg; gi--; q = [a[0], a[1]];
  }
  const thG = Math.atan2(cl[e][1] - q[1], cl[e][0] - q[0]);
  const gnx = -Math.sin(thG) * hw, gny = Math.cos(thG) * hw;
  const finish = { x1: q[0] + gnx, y1: q[1] + gny, x2: q[0] - gnx, y2: q[1] - gny, fx: Math.cos(thG), fy: Math.sin(thG) };
  const c = fitAndPlace({ name: spec.name || '峠', walls, start, finish, centerline: cl });
  c.touge = true;
  c.downhill = +(spec.downhill || 0);
  c.bank = +(spec.bank || 0);          // 横勾配 (カント)[度]・未指定=0=完全 no-op (AS10)
  c.elev = +(spec.elev || 0);          // 総高低差[m] (表示・立体プレビュー用)
  return c;
}

// ===== データ駆動コース =====
// コースは public/data/courses.json (唯一の編集元) で定義し、起動時に loadPresets() で読み込む。
// course.js はスペック(データ)からコースを生成するエンジンに徹する。
//   track   型: { name, kind:'track', shape, ...形状, width, samples?, smooth?, widthVary? } ← 曲線/多角形/可変幅
//     shape='ellipse'(rx,ry) / 'lobed'(rBase,amp,lobes,phase) / 'superellipse'(rx,ry,k)
//            / 'stadium'(L,rr) / 'polyline'(centerline[[x,y]...])。samples 小=多角形, smooth=角丸め
//   annulus 型: { name, kind:'annulus', outer:{type,...}, inner:{type,...}, samples?, startAngle? }
//            ← 外周と内周を独立形状で定義 (内外で形が違う/道幅が変化するコース)
//   loop    型: { name, kind:'loop', W, H, m, chicanes?: [[side,pos,depth?], ...] } ← 矩形リング
//   raw     型: { name, kind:'raw', bounds:{w,h}, walls:[...], start, finish }
//   desc: 任意。コースの狙い (テスト観点) を表す説明文。選択時にログ表示。
//
// スペック 1 個から走行可能なコースオブジェクトを生成する。
export function buildFromSpec(spec) {
  let c;
  if (spec.kind === 'track') c = buildTrack(spec);
  else if (spec.kind === 'annulus') c = buildAnnulus(spec);
  else if (spec.kind === 'touge') c = buildTouge(spec);
  else if (spec.kind === 'raw') {
    c = withForward({
      name: spec.name || 'カスタム',
      walls: (spec.walls || []).map(w => ({ x1: +w.x1, y1: +w.y1, x2: +w.x2, y2: +w.y2 })),
      bounds: { w: +(spec.bounds?.w || 3.0), h: +(spec.bounds?.h || 2.0) },
      start: { x: +(spec.start?.x ?? 0.3), y: +(spec.start?.y ?? 0.3), theta: +(spec.start?.theta ?? 0) },
      finish: spec.finish ? {
        x1: +spec.finish.x1, y1: +spec.finish.y1, x2: +spec.finish.x2, y2: +spec.finish.y2,
        fx: spec.finish.fx, fy: spec.finish.fy,
      } : null,
    });
  } else {
    // 既定: 矩形リング。chicanes = [[side, pos, depth?], ...]
    const W = +spec.W, H = +spec.H, m = +spec.m;
    const extra = (spec.chicanes || []).map(
      e => post(e[0], +e[1], W, H, m, e[2] == null ? 0.55 : +e[2])
    );
    c = loopCourse(spec.name, W, H, m, extra);
  }
  if (spec.desc) c.desc = spec.desc;
  // コース名/説明の英語 (任意・表示専用のデータ透過)。識別子は c.name (ja) のまま=
  // 公式記録/コース選択キーを壊さず、表示時に getLang()==='en' なら name_en/desc_en を使う (AB4)。
  if (spec.name_en) c.name_en = spec.name_en;
  if (spec.desc_en) c.desc_en = spec.desc_en;
  // フルスケール設計コース印 (任意・データ透過のみ・物理非干渉)。領域自動切替の判定に使う (Q1)。
  if (spec.noRace) c.noRace = true;
  // 難易度 ★(1-5) / 入門フラグ (任意・表示専用のデータ透過・物理非干渉)。コース選択前の難易度
  // バッジ表示と起動ランダムの入門プール限定に使う (AB5・PX-021/022)。推奨領域は noRace を真実源
  // とする (重複フィールドを作らない)。
  if (spec.diff != null) c.diff = +spec.diff;
  if (spec.beginner) c.beginner = true;
  // 路面グリップ (任意, 1=ドライ標準, <1=ウェット)。spawn 経由で各車へ伝える。
  if (spec.grip != null) { const g = Math.max(0, +spec.grip); c.grip = g; c.start = { ...c.start, grip: g }; }
  // 路面 muDecay (任意・0..1・省略時=タイヤセット既定=旧エンジンは非参照)。§5・AO8: ピーク後の漸近
  // グリップ比 (1=滑っても食い続ける／小=ピーク後に落ちる)。grip と同型に spawn 経由で v2 車へ伝える
  // (dynamic/standard は無視=byte 不変)。値域は物理側 mfCoeffs で [0.35,0.95] にクランプ。低μ路面例:
  // ダート grip0.6×muDecay0.92 (グリップは低いが滑らせても保持しやすい)。
  if (spec.muDecay != null) { const d = +spec.muDecay; c.muDecay = d; c.start = { ...c.start, muDecay: d }; }
  return c;
}

// JSON 読込失敗時の組込みフォールバック (中核 4 コース)。通常は courses.json が全コースを供給する。
// RumiCar は左右の壁に追従して走るため、フォールバックも必ず内外2本の壁をもつ閉廊下にする
// (外周だけの「オープン」コースは不適なので置かない)。
const FALLBACK_SPECS = [
  { name: 'リング', kind: 'raw', bounds: { w: 3.0, h: 2.0 },
    walls: [...rect(0, 0, 3.0, 2.0), ...rect(0.85, 0.65, 2.15, 1.35)],
    start: { x: 0.42, y: 0.32, theta: 0 }, finish: { x1: 0.42, y1: 0.04, x2: 0.42, y2: 0.61 } },
  { name: 'オーバル', kind: 'track', shape: 'ellipse', rx: 1.20, ry: 0.75, width: 0.55, samples: 80 },
  { name: 'ヘアピン', kind: 'track', shape: 'stadium', L: 1.7, rr: 0.55, width: 0.48 },
  { name: '90度サーキット', kind: 'track', shape: 'superellipse', rx: 1.15, ry: 0.85, k: 0.5, width: 0.55, samples: 100 },
];

// プリセット = 「呼ぶとコースを生成する関数」の配列。
// 起動時は FALLBACK_SPECS で同期的に埋め、loadPresets() が courses.json で置き換える。
// 配列は import 側でライブ参照されるため、中身を in-place で差し替える (再代入しない)。
export const PRESETS = [];
function rebuildPresets(specs) {
  PRESETS.length = 0;
  for (const s of specs) PRESETS.push(() => buildFromSpec(s));
}
rebuildPresets(FALLBACK_SPECS);

// data/courses.json を読み込んで PRESETS を差し替える。失敗時は組込みフォールバックを維持。
// コースの追加・変更は courses.json の編集のみ (再ビルド/再起動不要、ページ再読込で反映)。
export async function loadPresets(url = 'data/courses.json') {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const specs = await res.json();
    if (!Array.isArray(specs) || specs.length === 0) throw new Error('空または配列でない');
    rebuildPresets(specs);
  } catch (e) {
    console.warn('courses.json 読込失敗、組込み既定を使用:', e.message);
  }
  return PRESETS;
}

export function presetByName(name) {
  for (const f of PRESETS) { const c = f(); if (c.name === name) return c; }
  return null;
}

export function defaultCourse() { return buildFromSpec(FALLBACK_SPECS[0]); }

// 任意データ (エディタ/JSON) をコースとして正規化
export function normalizeCourse(data) {
  const c = {
    name: data.name || 'カスタム',
    walls: (data.walls || []).map(w => ({ x1: +w.x1, y1: +w.y1, x2: +w.x2, y2: +w.y2 })),
    bounds: { w: +(data.bounds?.w || 3.0), h: +(data.bounds?.h || 2.0) },
    start: {
      x: +(data.start?.x ?? 0.3), y: +(data.start?.y ?? 0.3),
      theta: +(data.start?.theta ?? 0),
    },
    finish: data.finish ? {
      x1: +data.finish.x1, y1: +data.finish.y1, x2: +data.finish.x2, y2: +data.finish.y2,
      fx: data.finish.fx, fy: data.finish.fy,
    } : null,
  };
  if (data.desc) c.desc = data.desc; // 説明文 (投稿コース等) を保持
  // 投稿/保存コースが name_en/desc_en を持てば透過 (持たなければ原文フォールバック=AB4)。
  if (data.name_en) c.name_en = data.name_en;
  if (data.desc_en) c.desc_en = data.desc_en;
  // 投稿/保存コースが難易度/入門メタを持てば透過 (任意・表示専用・AB5)。
  if (data.diff != null) c.diff = +data.diff;
  if (data.beginner) c.beginner = true;
  return withForward(c);
}

// ===== 座標変換 =====
// view.pxPerM (setView が設定。大コースはフィットで縮小) を優先。未設定時は基準 VIEW.pxPerM。
export function worldToScreen(p, view) {
  // y 上向き(物理) → 画面 y 下向き
  const s = (view && view.pxPerM) || VIEW.pxPerM;
  return { x: p.x * s, y: (view.hM - p.y) * s };
}

export function screenToWorld(px, py, view) {
  const s = (view && view.pxPerM) || VIEW.pxPerM;
  return { x: px / s, y: view.hM - py / s };
}

export function snap(v) { return Math.round(v / GRID.step) * GRID.step; }

// ===== 描画 =====
// ── 静的コース層のオフスクリーンキャッシュ (Stage AS2) ────────────────────────────
// 壁・グリッド・フィニッシュラインは「走行中ひとつも動かない」層なのに毎フレーム引き直していた。
// 実測 (本番モジュール・実コースデータ・canvas 856x883): 最も壁の多い『ウェットテクニカル (雨)』
// 960 壁で **2.44ms/フレーム** (grid 有 3.36ms)＝60fps の予算 16.7ms の約 15%。同じ絵になる条件が
// 続く間はオフスクリーンへ 1 度だけ描いて貼るだけにすると **0.015ms** (実測・約 160 倍速)。
//
// 正しさの担保 (「速いが違う絵」を出さないための設計):
//   ① **恒等変換のときだけ**使う。zoom/pan 中にビットマップを貼ると線が引き伸ばされて画素が変わる
//      (拡大時はベクタで引き直すのが正)。→ 変換行列を実際に読んで判定する。
//   ② 鍵には「描画結果を変えうるものを全部」入れる: コースの実内容 (壁/フィニッシュ/bounds を
//      走査した指紋。コースエディタは walls を**その場で書き換える**ので参照比較では検出できない)、
//      view (pxPerM/wPx/hPx/hM)、grid の有無、テーマで変わる色 (VIEW.bg/grid はテーマ切替で書き換わる)、
//      壁の太さ、グリッド間隔。
//   ③ 画素一致は常設ゲート `browser/check_course_layer.mjs` が実ブラウザで直接検証する
//      (キャッシュ経路と直描き経路の ImageData を全画素比較・検出力テスト付き)。
//
// 保持数が 1 でない理由: コースを描くキャンバスは **同時に 3 つ**ありうる — 走行画面 (main.js:render)、
// レース結果のミニマップ、ゴースト再生 (race_ui.js:189/778)。ゴースト再生中は走行画面の rAF も回るので、
// 1 つしか持たないと毎フレーム互いを追い出し合って**必ずキャッシュミス**になり、素の描き直しより遅くなる。
// 直近 3 つを MRU で保持し、あふれたら**キャンバスを使い回して**確保し直す (編集中の連続ミスでも新規確保しない)。
const LAYERS = [];        // [{ cv, key }] 先頭が最直近
const LAYER_MAX = 3;

// コースの実内容の指紋。walls は 1000 本規模なので文字列化せず整数ハッシュで畳む (実測 0.02ms 未満)。
function courseFingerprint(c) {
  let h = 0x811c9dc5;
  const mix = (v) => { h = Math.imul(h ^ ((v * 1e4) | 0), 0x01000193) >>> 0; };
  for (const w of c.walls) { mix(w.x1); mix(w.y1); mix(w.x2); mix(w.y2); }
  const f = c.finish;
  if (f) { mix(f.x1); mix(f.y1); mix(f.x2); mix(f.y2); } else mix(-1);
  mix(c.bounds.w); mix(c.bounds.h);
  return c.walls.length + ':' + h;
}

function layerKey(c, view, opts) {
  return [
    courseFingerprint(c),
    view.pxPerM, view.wPx, view.hPx, view.hM,
    opts.grid ? 1 : 0,
    VIEW.bg, VIEW.grid, VIEW.wall, VIEW.wallWidth, VIEW.finish, VIEW.finishAlt, GRID.step,
  ].join('|');
}

export function drawCourse(ctx, course, view, opts = {}) {
  // 恒等変換か? (render は zoom/pan を ctx へ乗せてから呼ぶ。既定は zoom=1/pan=0=恒等)
  const m = ctx.getTransform ? ctx.getTransform() : null;
  const identity = !!m && m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
  if (!identity || typeof document === 'undefined') { drawCourseLayer(ctx, course, view, opts); return; }
  const key = layerKey(course, view, opts);
  const i = LAYERS.findIndex((L) => L.key === key);
  if (i < 0) {
    const cv = LAYERS.length >= LAYER_MAX ? LAYERS.pop().cv : document.createElement('canvas');
    cv.width = view.wPx; cv.height = view.hPx;   // 代入は内容クリアも兼ねる (前の絵が残らない)
    drawCourseLayer(cv.getContext('2d'), course, view, opts);
    LAYERS.unshift({ cv, key });
  } else if (i > 0) {
    LAYERS.unshift(LAYERS.splice(i, 1)[0]);      // 使ったものを最直近へ
  }
  ctx.drawImage(LAYERS[0].cv, 0, 0);
}

/** 静的コース層をその場で描く (キャッシュを通さない正の経路)。画素一致ゲートの比較対象でもある。 */
export function drawCourseLayer(ctx, course, view, opts = {}) {
  ctx.save();
  ctx.fillStyle = VIEW.bg;
  ctx.fillRect(0, 0, view.wPx, view.hPx);
  if (opts.grid) drawGrid(ctx, course, view);
  if (course.finish) drawFinish(ctx, course.finish, view);
  ctx.strokeStyle = VIEW.wall;
  ctx.lineWidth = VIEW.wallWidth;
  ctx.lineCap = 'round';
  for (const w of course.walls) {
    const a = worldToScreen({ x: w.x1, y: w.y1 }, view);
    const b = worldToScreen({ x: w.x2, y: w.y2 }, view);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGrid(ctx, course, view) {
  ctx.save();
  ctx.strokeStyle = VIEW.grid;
  ctx.lineWidth = 1;
  for (let x = 0; x <= course.bounds.w + 1e-9; x += GRID.step) {
    const a = worldToScreen({ x, y: 0 }, view), b = worldToScreen({ x, y: course.bounds.h }, view);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  for (let y = 0; y <= course.bounds.h + 1e-9; y += GRID.step) {
    const a = worldToScreen({ x: 0, y }, view), b = worldToScreen({ x: course.bounds.w, y }, view);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
}

export function drawFinish(ctx, finish, view) {
  const a = worldToScreen({ x: finish.x1, y: finish.y1 }, view);
  const b = worldToScreen({ x: finish.x2, y: finish.y2 }, view);
  ctx.save();
  // チェッカー風の破線でフィニッシュラインを描く
  ctx.lineWidth = 6;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const seg = 8;
  for (let d = 0; d < len; d += seg) {
    ctx.strokeStyle = (Math.floor(d / seg) % 2 === 0) ? VIEW.finish : VIEW.finishAlt;
    const x1 = a.x + ux * d, y1 = a.y + uy * d;
    const dd = Math.min(seg, len - d);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + ux * dd, y1 + uy * dd); ctx.stroke();
  }
  ctx.restore();
}
