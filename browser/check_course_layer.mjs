// RumiCar Simulator — 静的コース層オフスクリーンキャッシュの **画素一致** ゲート (Stage AS2)
//
// 速くなったが違う絵、を出さないための検査。キャッシュ経路 (`drawCourse`) と直描き経路
// (`drawCourseLayer`) の出力を **全画素バイト比較** する。述語は再実装せず、配信中の course.js に
// 両方の絵を描かせて突き合わせる (CI-9)。
//
// 測る条件 (キャッシュの鍵が取りこぼすと必ず落ちる並び):
//   A 全 41 コース × grid 無/有         … コース内容・grid の鍵
//   B テーマ色の変更 (VIEW.bg/grid)      … テーマ切替で色だけ変わったとき
//   C 壁を**その場で書き換え** (コースエディタと同じ操作)  … 参照比較では検出できない変更
//   D view (pxPerM/大きさ) の変更        … リサイズ・コース切替
//   E 拡大 (zoom≠1) 時                   … ビットマップを引き伸ばさず直描きへ落ちること
//   F 検出力: 鍵を無視した「わざと壊した実装」なら C が落ちること (緑のまま壊れる検査を防ぐ)
//
// 使い方: bash run.sh check_course_layer.mjs
// 終了コード: 0=全項目 PASS / 1=いずれか FAIL

import { launch, newPage, report, APP_URL } from './lib.mjs';

let pass = 0, fail = 0;
const ok = (label, cond, detail) => (report(label, cond, detail) ? pass++ : fail++);

const browser = await launch();
const { page } = await newPage(browser, { width: 1440, height: 900 });
console.log(`\n== 静的コース層キャッシュの画素一致 ==\n対象: ${APP_URL}\n`);

const r = await page.evaluate(async () => {
  const C = await import(new URL('js/course.js', location.href).href);
  const CFG = await import(new URL('js/config.js', location.href).href);
  await C.loadPresets();
  const built = C.PRESETS.map((f) => f());

  const mk = (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; };
  // 画素差の個数を返す (0 が一致)。差があれば最初の位置も返す。
  const diff = (a, b) => {
    const da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
    const db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
    if (da.length !== db.length) return { n: -1, at: -1 };
    let n = 0, at = -1;
    for (let i = 0; i < da.length; i += 4) {
      if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2] || da[i + 3] !== db[i + 3]) {
        n++; if (at < 0) at = i >> 2;
      }
    }
    return { n, at };
  };
  // view は本番 setView と同じ形 (hM/pxPerM/wPx/hPx)。倍率は本番の基準 VIEW.pxPerM を上限に、
  // 巨大コース (フルスケール 200m 級) では検査側でも上限辺 CAP_PX に収める。**本番 fitPxPerM も
  // VIEW.maxCanvasPx で同型に収める**ので条件の性質は同じ (キャンバスが小さいほど画素差は出にくく
  // なるわけではない=壁の重なりは倍率に依らず出る)。実際に使った倍率と最大辺は結果に出す。
  const CAP_PX = 1400;
  const scaleOf = (c) => Math.min(CFG.VIEW.pxPerM, CAP_PX / Math.max(c.bounds.w, c.bounds.h));
  const viewFor = (c, pxPerM) => ({ hM: c.bounds.h, pxPerM, wPx: c.bounds.w * pxPerM, hPx: c.bounds.h * pxPerM });

  const out = { A: [], B: null, C: null, D: null, E: null, F: null, courses: built.length, pixels: 0, maxSide: 0, capped: 0 };

  // ── A: 全コース × grid 無/有 ────────────────────────────────────────────────
  for (const c of built) {
    const s = scaleOf(c);
    if (s < CFG.VIEW.pxPerM) out.capped++;
    const v = viewFor(c, s);
    out.maxSide = Math.max(out.maxSide, v.wPx | 0, v.hPx | 0);
    for (const grid of [false, true]) {
      const a = mk(v.wPx, v.hPx), b = mk(v.wPx, v.hPx);
      C.drawCourse(a.getContext('2d'), c, v, { grid });         // キャッシュ経路
      C.drawCourseLayer(b.getContext('2d'), c, v, { grid });    // 直描き経路
      const d = diff(a, b);
      out.pixels += a.width * a.height;
      if (d.n !== 0) out.A.push(`${c.name}${grid ? '(grid)' : ''}:差${d.n}px@${d.at}`);
    }
  }

  // 以降は 1 コースで条件だけ変える (壁が最も多いもの＝最も差が出やすい)
  const c0 = built.reduce((x, y) => (x.walls.length >= y.walls.length ? x : y));
  const v0 = viewFor(c0, scaleOf(c0));
  const cmp = (label, course, view, opts) => {
    const a = mk(view.wPx, view.hPx), b = mk(view.wPx, view.hPx);
    C.drawCourse(a.getContext('2d'), course, view, opts);
    C.drawCourseLayer(b.getContext('2d'), course, view, opts);
    const d = diff(a, b);
    return { label, n: d.n, at: d.at };
  };

  // ── B: テーマ色の変更 (applyCanvasTheme が VIEW.bg/grid を書き換えるのと同じ) ──
  C.drawCourse(mk(v0.wPx, v0.hPx).getContext('2d'), c0, v0, { grid: true });  // まずキャッシュを温める
  const bg0 = CFG.VIEW.bg, grid0 = CFG.VIEW.grid;
  CFG.VIEW.bg = '#101820'; CFG.VIEW.grid = '#334455';
  out.B = cmp('theme', c0, v0, { grid: true });
  CFG.VIEW.bg = bg0; CFG.VIEW.grid = grid0;

  // ── C: 壁をその場で書き換え (コースエディタのドラッグと同じ・参照は変わらない) ──
  C.drawCourse(mk(v0.wPx, v0.hPx).getContext('2d'), c0, v0, { grid: false });
  const w0 = c0.walls[0], keep = { x1: w0.x1, y1: w0.y1, x2: w0.x2, y2: w0.y2 };
  w0.x1 += 0.08; w0.y2 -= 0.08;
  out.C = cmp('wall-mutate', c0, v0, { grid: false });
  // ここでキャッシュが古い絵を返す実装なら差が出る＝この項目が検出器そのもの
  Object.assign(w0, keep);

  // ── D: view (pxPerM) の変更 ────────────────────────────────────────────────
  out.D = cmp('view-resize', c0, viewFor(c0, scaleOf(c0) * 0.71), { grid: false });

  // ── E: 拡大 (zoom=2) 時は直描きへ落ちること ───────────────────────────────
  {
    const a = mk(v0.wPx, v0.hPx), b = mk(v0.wPx, v0.hPx);
    const ca = a.getContext('2d'), cb = b.getContext('2d');
    ca.setTransform(2, 0, 0, 2, -100, -50); cb.setTransform(2, 0, 0, 2, -100, -50);
    C.drawCourse(ca, c0, v0, { grid: false });
    C.drawCourseLayer(cb, c0, v0, { grid: false });
    const d = diff(a, b);
    out.E = { label: 'zoom=2', n: d.n, at: d.at };
  }

  // ── F: 検出力 — 鍵がコース内容を見ない実装なら C が落ちるか ────────────────
  // (本物を壊さず、同じ設計の「壁を見ない鍵」を検査側で組み、同じ手順で差が出ることを確かめる)
  {
    let stale = null;
    const badDraw = (ctx, course, view, opts) => {
      const key = [view.pxPerM, view.wPx, view.hPx, opts.grid ? 1 : 0].join('|');  // 壁の内容を見ない鍵
      if (!stale || stale.key !== key) {
        const cv = mk(view.wPx, view.hPx);
        C.drawCourseLayer(cv.getContext('2d'), course, view, opts);
        stale = { cv, key };
      }
      ctx.drawImage(stale.cv, 0, 0);
    };
    const a = mk(v0.wPx, v0.hPx), b = mk(v0.wPx, v0.hPx);
    badDraw(a.getContext('2d'), c0, v0, { grid: false });        // 温める
    const w = c0.walls[0], k2 = { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 };
    w.x1 += 0.08; w.y2 -= 0.08;
    badDraw(a.getContext('2d'), c0, v0, { grid: false });        // 壊れた実装 = 古い絵
    C.drawCourseLayer(b.getContext('2d'), c0, v0, { grid: false });
    const d = diff(a, b);
    Object.assign(w, k2);
    out.F = { label: 'broken-key', n: d.n };
  }

  // ── G: 複数キャンバスが交互に描いてもキャッシュが効くか ────────────────────────
  // 走行画面・レース結果ミニマップ・ゴースト再生は **同時に** コースを描く (race_ui.js:189/778)。
  // 保持数が 1 だと毎フレーム互いを追い出し合って全部ミス＝素の描き直しより遅くなる。
  // 画素比較では絶対に捕まらない壊れ方なので、**時間**で測る。
  {
    const vA = v0;
    const vB = viewFor(c0, scaleOf(c0) * 0.5);   // ミニマップ相当 (別サイズ=別の鍵)
    const a = mk(vA.wPx, vA.hPx), b = mk(vB.wPx, vB.hPx);
    const ca = a.getContext('2d'), cb = b.getContext('2d');
    const alt = (fn) => { const t0 = performance.now();
      for (let i = 0; i < 60; i++) { fn(ca, c0, vA); fn(cb, c0, vB); }
      return (performance.now() - t0) / 120; };
    alt(C.drawCourse);                                   // 温める
    const cached = alt(C.drawCourse);
    const direct = alt(C.drawCourseLayer);
    out.G = { cached, direct, ratio: direct / cached, walls: c0.walls.length };
  }
  return out;
});

ok(`A 全 ${r.courses} コース × grid 無/有 で画素一致`, r.A.length === 0,
   r.A.length ? r.A.slice(0, 3).join(' | ') : `${r.courses * 2} 条件・計 ${(r.pixels / 1e6).toFixed(1)}M 画素 差 0`
   + ` (最大辺 ${r.maxSide}px・上限 1400px に収めたコース ${r.capped}/${r.courses} 件)`);
ok('B テーマ色を変えたら新しい色で描かれる', r.B.n === 0, `差 ${r.B.n}px`);
ok('C 壁をその場で書き換えても追随する (エディタ操作)', r.C.n === 0, `差 ${r.C.n}px`);
ok('D view (pxPerM) 変更に追随する', r.D.n === 0, `差 ${r.D.n}px`);
ok('E 拡大時 (zoom=2) は直描きへ落ちる', r.E.n === 0, `差 ${r.E.n}px`);
ok('F 検出力: 鍵が壁を見ない実装なら C は落ちる', r.F.n > 0,
   r.F.n > 0 ? `わざと壊した実装では差 ${r.F.n}px を検出` : '壊した実装でも差 0＝検査が無意味');
ok('G 2 面を交互に描いてもキャッシュが効く (保持数 ≥2)', r.G.ratio >= 5,
   `${r.G.walls} 壁・交互 120 回: キャッシュ ${r.G.cached.toFixed(3)}ms / 直描き ${r.G.direct.toFixed(3)}ms`
   + ` = ${r.G.ratio.toFixed(1)}× (基準 ≥5×。保持数 1 なら全ミスで 1× 近辺へ落ちる)`);

await browser.close();
console.log(`\n結果: PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
