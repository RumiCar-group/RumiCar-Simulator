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
  // 教材ベンチ印 (任意・データ透過のみ・物理非干渉・AY2)。R_out < R_min を見せるために逆算した
  // コースは「舵では原理的に曲がれない」ことが主題で、完走を前提にしていない。チャレンジの完走
  // バッジ母集団から外すのに使う (challenge.js)。**表示・当たり判定・物理には一切関与しない。**
  if (spec.bench) c.bench = true;
  // 路面グリップ (任意, 1=ドライ標準, <1=ウェット)。spawn 経由で各車へ伝える。
  if (spec.grip != null) { const g = Math.max(0, +spec.grip); c.grip = g; c.start = { ...c.start, grip: g }; }
  // 路面 muDecay (任意・0..1・省略時=タイヤセット既定=旧エンジンは非参照)。§5・AO8: ピーク後の漸近
  // グリップ比 (1=滑っても食い続ける／小=ピーク後に落ちる)。grip と同型に spawn 経由で v2 車へ伝える
  // (dynamic/standard は無視=byte 不変)。値域は物理側 mfCoeffs で [0.35,0.95] にクランプ。低μ路面例:
  // ダート grip0.6×muDecay0.92 (グリップは低いが滑らせても保持しやすい)。
  if (spec.muDecay != null) { const d = +spec.muDecay; c.muDecay = d; c.start = { ...c.start, muDecay: d }; }
  // 路面種別 (任意・'paved'|'loose'・省略時=paved=掘り込みなし)。Stage AV1: ルーズ路面 (砂利/ダート/雪)
  // ではタイヤが表層へ潜って材料を押しのけるため、滑らせても横力が落ちない (むしろ深い滑り角で
  // ピークを迎える)。grip/muDecay と同型に spawn 経由で v2 車へ伝える (**dynamic/standard は非対象**＝
  // 掘り込みは「輪ごとの μ·Fz に対する比」なので単軌道近似には足す先が無い・config.js SURFACES 参照)。
  // **文字列だけを受理する** (敵対的レビュー 軽13: 旧実装の String(spec.surface) は配列を素通しし
  // `['loose']` が 'loose' として効いた。checkFields は同じ値を「文字列でない」と弾くので、自作コースだけ
  // 検査をすり抜けていた)。非文字列は未指定と同じ扱い＝掘り込み無しへ縮退する。
  if (typeof spec.surface === 'string') { const sf = spec.surface; c.surface = sf; c.start = { ...c.start, surface: sf }; }
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

// ===== 投稿コースの形式検査 (BB2・2026-09-15) =====
// 上流の courses/community/ は投稿の中身を検査しない (index.json は一覧を作るだけ)。normalizeCourse は
// 形が正しい前提で書かれているので、壊れた JSON を渡すと例外 (`null`・walls が配列でない・壁に null) か、
// NaN の寸法で描画エラーを出し続ける (起票時の実測で 1.5 秒に 92 件)。ここで「normalizeCourse に渡してよい形か」
// だけを判定する。**DOM に触れない純関数** (常設ゲート wf_bb2_course_check.mjs が同じ関数を node で呼ぶ)。
//
// 戻り値: 合格なら null、不合格なら**最初に見つけた問題の箇所** ('$'・'walls[3].x1'・'walls:size' 等)。
// 形の決め方 (実装前に固定・internal 決定ログ「BB2 着手前の固定」と、層 4 レビュー後の改訂):
//   ・省略できる項目は undefined と null を「無い」とみなす (finish の無いコースをエディタで開いて書き出すと finish: null になる)
//   ・walls は必須の配列 (空配列は可＝エディタで壁を全消去した状態も正規の出力)。各要素は x1,y1,x2,y2 が有限数
//   ・bounds はあれば w,h が有限の正数／start はあれば x,y,theta が有限数／finish はあれば x1..y2 が有限数、fx/fy はあれば有限数
//   ・name / name_en はあれば文字列で、空でないなら空白以外を含む (空白だけだと一覧のラベルが空になる。
//     空文字はエディタが名前欄を空白だけにしたときに出す正規の出力で、一覧はファイル名に落ちる)。desc / desc_en はあれば文字列
//   ・数値は typeof 'number' かつ有限 (数字の文字列は通さない。エディタは数で書き出すので、文字列を許すと
//     '1.5' と 'abc' の線引きを normalizeCourse の `+` 任せにすることになる)
// 大きさの上限 (層 4 レビュー 2026-09-15 で判明・実測): 形が正しくても、壁の座標が遠い (x=1e17 の短い壁 1 本) と
// 壁グリッドの走査が終わらず、実投稿を mm と m で取り違えた (×1000) だけでメモリが尽きた。グリッドは壁の外接矩形が
// 覆うセルを全部埋めるので、bounds 1000 m に対角の壁 1 本でも 1,082 万セル・23 秒かかる。∴ **出荷コースで動くと
// 実証されている範囲**に収める (数値は wf_bb2_course_check.mjs F) が出荷全コースに対して余裕を測る)。
// **守るのは事故 (単位の取り違え・迷い込んだ遠い壁・桁違いの寸法) まで** (2026-09-15 利用者裁定)。わざと作った重い形
// (櫛形の壁で配置探索を広げる・長い壁を大量に並べる等) は上限内でも重くなりうる。上流の投稿は PR のレビューを経て入る:
//   ・bounds (無ければ normalizeCourse の既定 3×2) の各辺が COURSE_LIMITS.bMin〜bMax m (出荷 0.907〜748.36 m)
//   ・壁の端点・start・finish の端点が bounds の外側 margin (長辺×5%) 以内 (出荷の最大は 0%・上流の投稿 racing-course は 0.63%)
//   ・壁が占めるグリッドのセル数 (セル cell m・壁グリッドと同じ数え方) の合計が maxCells 以下 (出荷の最大 685,643)
//   ・壁の本数が maxWalls 以下 (出荷の最大 960。セル数だけだと短い壁を 150 万本並べた数十 MB の投稿が通る)
// 検査しないもの: diff・bench・beginner 等の表示用メタ (壊れていても normalizeCourse が無害に扱う)。
const COURSE_LIMITS = { bMin: 0.5, bMax: 1000, margin: 0.05, cell: 0.1, maxCells: 1500000, maxWalls: 20000 };
// ── 取り込み元でわける 2 つの基準 (BC3・2026-09-18) ──────────────────────────────
// 上の基準は「上流の投稿＝第三者のデータ」向けで、**拒否しても利用者は何も失わない**ことが前提だった。
// BC3 で同じ検査を全経路へ広げたとき、これをそのまま**利用者自身の保存コース**へ当てると、正規の操作で
// 作ったコースが二度と開けなくなる (実測 2026-09-18・出荷 66/66 本で再現・why=walls[0].x1 等。復旧は 🗑 削除のみ):
//   コースエディタは枠 bounds を ED_DIM_MIN=1 m まで縮められ (main.js の applyEditDims)、縮めても壁は
//   動かさず、保存 (#edSave) は無検査。∴「枠の外に壁がある保存コース」は事故ではなく**正規の中間状態**。
// ∴ 基準を 2 つに分ける。違うのは **座標が収まるべき窓の広さだけ**で、他の検査はすべて共通:
//   ・checkCourseData    … 他人へ配るものの基準 (投稿コース・大会の同梱 courseDef・これから投稿する形)。
//                          窓 = 枠 bounds ± margin。BB2 から**挙動不変**。誰の一覧にも載せない判断をここでする。
//   ・checkOwnCourseData … 利用者が自分で開くものの基準 (保存コースの選択・エディタの ✔適用・
//                          エディタへの JSON 取込)。窓 = 「枠 ± margin」と「絶対値 ≤ bMax」の**和集合**
//                          ＝ std の窓を必ず含む。
// **JSON 取込 (#edImport) が own なのは 2026-09-18 の改訂**: 当初は「手元にファイルが残るから投稿基準で
//   拒否してよい」としていたが、#edExport / #edSave が無検査なので、枠を縮めて書き出したファイルは投稿基準
//   では必ず落ちる (出荷 66/66 本で実測)。**残っても開けないファイルは失ったのと同じ**なので own へ改めた。
// own でも絶対上限を外せない理由 (実測 2026-09-18・本物の contact_v2.js:buildWallGrid): 壁グリッドは
//   `for (let ix = ix0; ix <= ix1; ix++)` で壁の外接矩形が覆うセルを埋めるが、|ix| が 2^53 を超えると
//   **ix++ が値を変えなくなり、この for が終わらない**。bounds 3×2 に x=1e17 の短い壁を 1 本混ぜた実測で
//   55 秒走り続けたあと RangeError で落ちた (セル数の上限では捕まらない。短い壁のセル数は 1 だから)。
//   ∴ 遠い壁は「自分のデータ」でも受け取れない。上限 1000 m (=bMax) は正規データを 1 本も落とさない
//   (出荷 66 本の座標の絶対値は最大 748.18 m=競技サーキット (フルスケール)・実測 2026-09-18)。
// 構造の検査・壁の本数・bounds の 0.5〜1000 m・セル数の上限は**両者で同一**。
export function checkCourseData(data) { return checkCourse(data, false); }
export function checkOwnCourseData(data) { return checkCourse(data, true); }
function checkCourse(data, own) {
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const absent = (v) => v === undefined || v === null;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!isObj(data)) return '$';
  if (!Array.isArray(data.walls)) return 'walls';
  for (let i = 0; i < data.walls.length; i++) {
    const w = data.walls[i];
    if (!isObj(w)) return `walls[${i}]`;
    for (const k of ['x1', 'y1', 'x2', 'y2']) if (!num(w[k])) return `walls[${i}].${k}`;
  }
  if (!absent(data.bounds)) {
    if (!isObj(data.bounds)) return 'bounds';
    for (const k of ['w', 'h']) if (!(num(data.bounds[k]) && data.bounds[k] > 0)) return `bounds.${k}`;
  }
  if (!absent(data.start)) {
    if (!isObj(data.start)) return 'start';
    for (const k of ['x', 'y', 'theta']) if (!num(data.start[k])) return `start.${k}`;
  }
  if (!absent(data.finish)) {
    if (!isObj(data.finish)) return 'finish';
    for (const k of ['x1', 'y1', 'x2', 'y2']) if (!num(data.finish[k])) return `finish.${k}`;
    for (const k of ['fx', 'fy']) if (!absent(data.finish[k]) && !num(data.finish[k])) return `finish.${k}`;
  }
  for (const k of ['name', 'name_en']) {
    if (!absent(data[k]) && !(typeof data[k] === 'string' && (data[k] === '' || data[k].trim() !== ''))) return k;
  }
  for (const k of ['desc', 'desc_en']) {
    if (!absent(data[k]) && typeof data[k] !== 'string') return k;
  }
  // ── 大きさ (形の検査を全部通ったものだけ・normalizeCourse と同じ既定を使う) ──
  const L = COURSE_LIMITS;
  if (data.walls.length > L.maxWalls) return 'walls:size';
  const bw = absent(data.bounds) ? 3.0 : data.bounds.w, bh = absent(data.bounds) ? 2.0 : data.bounds.h;
  if (!(bw >= L.bMin && bw <= L.bMax)) return 'bounds.w';
  if (!(bh >= L.bMin && bh <= L.bMax)) return 'bounds.h';
  // **2 つの基準が分かれるのはここだけ**: 第三者のデータは枠との包含まで見る / 自分のデータは
  // 「枠との包含 **または** 枠に依らない絶対上限 bMax」の**どちらかに収まれば通す**。
  // ⚠ own を「絶対上限だけ」にしてはならない (2026-09-18 の層 4 レビューで実測): 枠が bMax/1.05 = 952.38 m
  //   を超えると、枠＋margin の窓 (bw×1.05) が絶対上限 1000 m を追い越すため、**own のほうが std より
  //   厳しくなる**帯ができる (実測: bounds 960 m に x=1005 m の壁 → std 合格・own 拒否)。そこへ落ちた
  //   保存コースは二度と開けない＝BC3 が直したはずの事故が上端で再現する。和集合にすれば
  //   **own ⊇ std が構成上の性質**になり、母集団の中身に依らず成り立つ (wf_bc3_intake B1)。
  const m = L.margin * Math.max(bw, bh);
  const loX = own ? Math.min(-m, -L.bMax) : -m, hiX = own ? Math.max(bw + m, L.bMax) : bw + m;
  const loY = own ? Math.min(-m, -L.bMax) : -m, hiY = own ? Math.max(bh + m, L.bMax) : bh + m;
  const outX = (v) => v < loX || v > hiX;
  const outY = (v) => v < loY || v > hiY;
  for (let i = 0; i < data.walls.length; i++) {
    const w = data.walls[i];
    if (outX(w.x1)) return `walls[${i}].x1`;
    if (outY(w.y1)) return `walls[${i}].y1`;
    if (outX(w.x2)) return `walls[${i}].x2`;
    if (outY(w.y2)) return `walls[${i}].y2`;
  }
  if (!absent(data.start)) { if (outX(data.start.x)) return 'start.x'; if (outY(data.start.y)) return 'start.y'; }
  if (!absent(data.finish)) {
    const f = data.finish;
    if (outX(f.x1)) return 'finish.x1'; if (outY(f.y1)) return 'finish.y1';
    if (outX(f.x2)) return 'finish.x2'; if (outY(f.y2)) return 'finish.y2';
  }
  let cells = 0;
  for (const w of data.walls) {
    const nx = Math.floor(Math.max(w.x1, w.x2) / L.cell) - Math.floor(Math.min(w.x1, w.x2) / L.cell) + 1;
    const ny = Math.floor(Math.max(w.y1, w.y2) / L.cell) - Math.floor(Math.min(w.y1, w.y2) / L.cell) + 1;
    cells += nx * ny;
    if (cells > L.maxCells) return 'walls:size';
  }
  return null;
}

// ===== 取り込み経路の単一入口 (BC3・2026-09-18) =====
// BB2 までは checkCourseData を呼ぶのは投稿コースの一覧作り (main.js の loadCommunityCourses) **1 箇所だけ**で、
// 自分のファイルを取り込む経路 (エディタの JSON 取込・保存コースの選択・✔適用・公式レースの同梱 courseDef) は
// 素通りだった。BB2 が上限を足した理由 (遠い壁 1 本で壁グリッドの走査が終わらない・mm/m の取り違えでメモリが
// 尽きる) は取り込み元に依らないので、**検査 → 正規化を 1 つの関数にまとめて**全経路をここに通す。
//
// opts.own = true で「利用者自身のデータ」の基準 (checkOwnCourseData) を使う。経路ごとの割り当ては
// main.js の acceptCourse の注記と internal の経路表を正とする。
// 戻り値: { ok, why, course }。合格なら ok=true・course=normalizeCourse(data)（**従来の出力と同値**＝
// 公式レースの決定論を変えない）、不合格なら ok=false・why=検査が返した箇所 ('walls[3].x1' 等)・course=null。
// **例外を投げない** (呼び出し側は「理由を 1 行知らせて、それまでの状態を保つ」だけでよい＝アプリが止まらない)。
// DOM に触れない純関数 (常設ゲート wf_bc3_intake.mjs が同じ関数を node で呼ぶ＝写しを作らない・CI-9)。
//
// ⚠ **呼び出し側は名前空間 import (`import * as courseParts`) で受けること。** 名前付き import にすると、
// 古い course.js をキャッシュに持つブラウザでモジュールグラフ全体が落ちる (BA1 で実測・wf_bb2_course_check E)。
// BC1 で JS に Cache-Control: no-cache を付けたが、それ以前に入ったキャッシュが抜けるまでは名前付きにしない。
export function acceptCourseData(data, opts) {
  const why = checkCourse(data, !!(opts && opts.own));
  if (why) return { ok: false, why, course: null };
  return { ok: true, why: null, course: normalizeCourse(data) };
}

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
  // 教材ベンチ印も透過 (buildFromSpec 側と対称にしておく。落とすと保存/投稿を経た瞬間に印が消える)。
  if (data.bench) c.bench = true;
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
