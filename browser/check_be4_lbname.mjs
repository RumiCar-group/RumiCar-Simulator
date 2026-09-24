// check_be4_lbname.mjs — 順位表の名前列が「実際に描く車名の幅」で組まれることを、実ブラウザで product の
// 描画呼び出しから測る (BE4)。
// ════════════════════════════════════════════════════════════════════════════
// なぜ要るか: 車名は自由入力 (main.js の .cc-name・maxlength=6) だが、順位表の列は「半角 5 文字 = 等幅
//   1 文字幅 × 5」の見積りで組まれていた (hud.js lbParts)。全角 5 文字は実幅 70px に対し見積り 35px で、
//   名前が LAP 列へ自然時 6.00px・狭い画面の詰め (BD2) で最大 20.71px 食い込んでいた (改修前の実測)。
//   あわせて旧実装の slice(0, 5) は UTF-16 の単位で切るので、絵文字の名前 (「🚗🏁😀」「ab😀😀」) を
//   サロゲートの途中で割って化けた文字を描いていた (P1 が捕まえる)。BD2 以降はこの見積りが
//   枠幅の決定にも使われる (BD-6(a))。既存の check_bc6_hudband.mjs B17 は既定の車名 (A〜F) しか描かない
//   ので、この退行を構造的に見ない。
//
// 測るもの (見た目で判定しない・CI-14。量はすべて CSS px):
//   母集団 = 車名 {既定, 半角 5, 全角 (6 文字入れて 5 文字), 混在, 絵文字, サロゲートの途中で切れる名前,
//            行ごとに幅が違う 3 台} × 画面幅 {280〜1000px (BD2 と同じ 12 標本) + 1440px} × {ja, en}
//   車名は利用者と同じ経路 (列の名前欄へ入力＝input イベント) で入れる。
//     P0 全セルで順位表が描かれ、行の中の要素の組を測れた (母集団ガード＝空集合の every で緑にしない)
//     P1 描かれた名前 = 入力欄の値の先頭 5 書記素 (見た目の 1 文字) で、孤立サロゲートを含まない
//     P2 行の中で隣り合う要素 (順位・色ドット・名前・LAP・BEST・状態) のすき間の最小 ≥ 0 (重なり 0.00px)
//     P3 順位表の枠が描かれたキャンバスの中 (四辺 0.00px)・行の文字が枠の中・キャンバスの中 (四辺 0.00px)
//     P4 順位表の文字の表示高さ ≥ 10 CSS px (BB3 H1・BD2 と同じ基準)
//     P5 半角だけの車名 (ABCDE) は既定の車名 (A) と同じ枠・同じ列位置 (＝半角の車名では組み方を変えない)
//     P6 崖までの余裕: 全角の車名で枠が詰めの下限に張り付いたときの枠幅 (画面幅 200px で product に作らせる)
//        と、支える最小の画面幅 280px の表示幅との差 > 0 (BD-5 ①。0 でなく余裕を量で残す)
//     P7 横はみ出し 0
//     P8 名前を列幅へ縮めて (fillText の maxWidth) 重なりを消していない: 横の縮め率 = 自然幅で 1・全幅で ≥ 0.97
//   ※ 列幅の上限 (全角 5 文字) を越える名前は縮めて描くが、入力欄の maxlength=6 の中では実測で上限に届かない
//     (最大は全角 5 文字の 70px) ので、この経路は母集団に無い (BE4 で script から 1 回だけ確かめた＝決定ログ)。
//   文字の箱は fillText の第 4 引数 (maxWidth) を考慮する (product が幅の上限で縮めて描いた名前を、
//   縮める前の幅で「はみ出した」と誤読しない)。
//
// 使い方: bash run.sh check_be4_lbname.mjs
import { launch, newPage, setLang, appModule, overflowX } from './lib.mjs';

const SCAN = [280, 300, 320, 360, 390, 414, 480, 540, 600, 700, 820, 1000];   // BD2 と同じ標本
const WIDTHS = [...SCAN, 1440];
const H = 844;
const COURSE = 'オーバル';
const TEXT_MIN = 10, EPS = 0.01;
// typed = 各列の名前欄に入れる値 (null = 欄を空にする＝product が既定の車名 A〜F に戻す)。台数は typed の長さ。
const SAMPLES = [
  { key: 'def', typed: [null] },
  { key: 'half5', typed: ['ABCDE'] },
  { key: 'full5', typed: ['全角の車名六'] },         // 6 文字 (maxlength) 入れて 5 文字が描かれる
  { key: 'mixed', typed: ['Aあ1い2う'] },
  { key: 'emoji', typed: ['🚗🏁😀'] },               // 6 UTF-16 単位 = 3 書記素
  { key: 'surr', typed: ['ab😀😀'] },                 // 旧 slice(0,5) は 2 つ目の絵文字の途中で切る
  { key: 'rows', typed: ['ABCDE', '全角の車名六', '🚗🏁😀'] },   // 列は最も広い名前に合わせる
];

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };

const browser = await launch();
const cells = [];
try {
  const { page, errors, benign } = await newPage(browser, {
    width: 1440, height: H,
    before: async (p) => {
      await p.addInitScript(() => {
        try { localStorage.setItem('rumicar.lang', 'ja'); } catch (e) {}
        try { localStorage.removeItem('rumicar.follow'); } catch (e) {}
        // 観測だけ: 順位表の描画呼び出し (fillText・arc・strokeRect) を記録し、描画は product のまま。
        window.__be4 = null;
        const P = CanvasRenderingContext2D.prototype;
        const whoOf = () => (/at (draw[A-Za-z]+)/.exec(new Error().stack.split('\n').slice(3).join('\n')) || [])[1] || '?';
        const box = (T, pts) => {
          const q = pts.map(([u, v]) => [T.a * u + T.c * v + T.e, T.b * u + T.d * v + T.f]);
          return { x0: Math.min(...q.map((z) => z[0])), y0: Math.min(...q.map((z) => z[1])), x1: Math.max(...q.map((z) => z[0])), y1: Math.max(...q.map((z) => z[1])) };
        };
        const on = (c) => window.__be4 && c.canvas && (c.canvas.id === 'course' || c.canvas.id === 'hudBand');
        const wrap = (name, fn) => {
          const orig = P[name];
          P[name] = function (...a) {
            if (on(this)) { const who = whoOf(); if (who === 'drawFleetHud') { try { fn.call(this, this.getTransform(), ...a); } catch (e) { window.__be4.push({ kind: 'spyErr', e: String(e) }); } } }
            return orig.apply(this, a);
          };
        };
        wrap('fillText', function (T, txt, x, y, maxW) {
          const m = /(\d+(?:\.\d+)?)px/.exec(this.font), px = m ? +m[1] : NaN;
          const w0 = this.measureText(txt).width, w = maxW != null ? Math.min(w0, maxW) : w0;
          window.__be4.push({ kind: 'text', cv: this.canvas.id, px, sx: Math.hypot(T.a, T.b), sy: Math.hypot(T.c, T.d),
            text: String(txt), ratio: w0 > 0 ? w / w0 : 1, ...box(T, [[x, y - px], [x + w, y - px], [x, y], [x + w, y]]) });
        });
        wrap('arc', function (T, x, y, r) {
          window.__be4.push({ kind: 'dot', cv: this.canvas.id, ...box(T, [[x - r, y - r], [x + r, y + r]]) });
        });
        wrap('strokeRect', function (T, x, y, w, h) {
          window.__be4.push({ kind: 'frame', cv: this.canvas.id, ...box(T, [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) });
        });
      });
    },
  });
  await page.waitForFunction(() => [...document.querySelectorAll('#courseSel option')].some((o) => o.value === 'オーバル'), null, { timeout: 30000 });
  await page.selectOption('#courseSel', COURSE);
  await page.waitForTimeout(1300);

  // 1 回の測定: raf 2 回ぶんの順位表の描画呼び出しを CSS px へ直して返す。
  const measure = () => page.evaluate(async () => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    await raf(); window.__be4 = []; await raf(); await raf();
    const all = window.__be4; window.__be4 = null;
    const cv = document.getElementById('course'), bd = document.getElementById('hudBand');
    const bandOn = !!(bd && !bd.hidden);
    const rc = cv.getBoundingClientRect(), rb = bandOn ? bd.getBoundingClientRect() : null;
    const SC = {
      course: { kx: rc.width / cv.width, ky: rc.height / cv.height, w: rc.width, h: rc.height },
      hudBand: bandOn ? { kx: rb.width / bd.width, ky: rb.height / bd.height, w: rb.width, h: rb.height } : null,
    };
    // 記録はキャンバスの内部 px。描かれたキャンバスの縮尺で CSS px へ直す。
    const recs = all.filter((r) => r.kind !== 'spyErr').map((r) => {
      const S = SC[r.cv] || SC.course;
      return { ...r, x0: r.x0 * S.kx, x1: r.x1 * S.kx, y0: r.y0 * S.ky, y1: r.y1 * S.ky, cw: S.w, ch: S.h,
        hCss: r.kind === 'text' ? Math.min(r.px * r.sx * S.kx, r.px * r.sy * S.ky) : null };
    });
    // 行 = 色ドット (arc) を挟む 順位→ドット→名前→LAP→BEST→状態 の並び。drawFleetHud はこの順で 1 行を描く。
    // ⚠ 2 フレームぶん入るので、ベースラインで束ねず**記録順のまま**ドットの前後と「同じベースラインで x が右へ進む」
    //   隣接ペアだけを見る (BD-5 ④)。
    const gaps = [], names = [];
    let nameLap = 0;
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (r.kind === 'dot') {
        const a = recs[i - 1], b = recs[i + 1];
        if (a && a.kind === 'text') gaps.push({ g: r.x0 - a.x1, pair: 'rank|dot' });
        if (b && b.kind === 'text') { gaps.push({ g: b.x0 - r.x1, pair: 'dot|name' }); names.push({ text: b.text, ratio: b.ratio }); }
        // 名前｜LAP の組はベースラインの条件に頼らず直接取る (下の汎用の組は条件で黙って外れうる)。
        const c = recs[i + 2];
        if (b && b.kind === 'text' && c && c.kind === 'text') { gaps.push({ g: c.x0 - b.x1, pair: 'name|LAP' }); nameLap++; }
        continue;
      }
      const b = recs[i + 1];
      if (r.kind !== 'text' || !b || b.kind !== 'text') continue;
      if (Math.abs(r.y1 - b.y1) > 0.5 || b.x0 <= r.x0) continue;
      gaps.push({ g: b.x0 - r.x1, pair: `${r.text.slice(0, 8)}|${b.text.slice(0, 8)}` });
    }
    const frames = recs.filter((r) => r.kind === 'frame');
    const fr = frames[0] || null;
    const texts = recs.filter((r) => r.kind === 'text');
    const out = (r, L, R, T, B) => Math.max(0, L - r.x0, r.x1 - R, T - r.y0, r.y1 - B);
    const frameOut = frames.length ? Math.max(...frames.map((f) => out(f, 0, f.cw, 0, f.ch))) : null;
    // 行の文字 (見出し・注記を含む) が枠の中 / キャンバスの中。枠はフレームごとに同じ位置なので最初の 1 つで足りる。
    const inFrame = fr ? Math.max(0, ...texts.map((r) => out(r, fr.x0, fr.x1, fr.y0, fr.y1))) : null;
    const inCanvas = texts.length ? Math.max(...texts.map((r) => out(r, 0, r.cw, 0, r.ch))) : null;
    // 1 行目の列位置 (枠の左端から)。P5 で既定の車名と比べる。
    const row1 = (() => {
      const i = recs.findIndex((r) => r.kind === 'dot');
      if (i < 1 || !fr) return null;
      const seq = recs.slice(i - 1, i + 5);   // 順位・ドット・名前・LAP・BEST・状態
      return seq.map((r) => +(r.x0 - fr.x0).toFixed(3));
    })();
    const minGap = gaps.length ? gaps.reduce((a, g) => (g.g < a.g ? g : a)) : null;
    return {
      bandOn, cssW: rc.width, spyErr: all.filter((r) => r.kind === 'spyErr').length,
      nText: texts.length, nGap: gaps.length, minGap, names: [...new Set(names.map((n) => n.text))], nName: names.length, nameLap,
      minRatio: names.length ? Math.min(...names.map((n) => n.ratio)) : null,
      frame: fr ? { x0: fr.x0, x1: fr.x1, w: fr.x1 - fr.x0 } : null, frameOut, inFrame, inCanvas,
      minTxtH: texts.length ? Math.min(...texts.map((r) => r.hCss)) : null, row1,
    };
  });

  // 台数を n にし、各列の名前欄へ利用者と同じ経路で入力する (fill = フォーカス→値の置き換え→input イベント)。
  // 返り値は入力欄に実際に残った値 (maxlength が効いた後)。
  const setNames = async (typed) => {
    for (let k = 0; k < 8; k++) {
      const n = await page.locator('#fleetCols .carcol').count();
      if (n === typed.length) break;
      if (n < typed.length) await page.click('#carAdd');
      else await page.locator('#fleetCols .carcol').last().locator('.cc-del').click();
      await page.waitForTimeout(300);
    }
    const vals = [];
    for (let i = 0; i < typed.length; i++) {
      const el = page.locator(`#fleetCols .carcol[data-idx="${i}"] .cc-name`);
      await el.fill(typed[i] == null ? '' : typed[i]);
      vals.push(await el.inputValue());
    }
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    return vals;
  };
  const defNames = await appModule(page, 'js/config.js', (m) => m.FLEET.names);
  const seg = (s) => page.evaluate((x) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(x), (g) => g.segment).slice(0, 5).join(''), s);

  for (const lang of ['ja', 'en']) {
    await page.setViewportSize({ width: 1440, height: H });
    await setLang(page, lang);
    for (const sm of SAMPLES) {
      await page.setViewportSize({ width: 1440, height: H });
      await page.waitForTimeout(300);
      const vals = await setNames(sm.typed.map((x) => x));
      const want = [];
      for (let i = 0; i < vals.length; i++) want.push(vals[i] === '' ? defNames[i] : await seg(vals[i]));
      for (const W of WIDTHS) {
        await page.setViewportSize({ width: W, height: H });
        await page.waitForTimeout(600);   // resize デバウンス 200ms → setView
        const m = await measure();
        m.lang = lang; m.key = sm.key; m.W = W; m.vals = vals; m.want = want; m.ovX = await overflowX(page, W);
        cells.push(m);
      }
      const cs = cells.filter((c) => c.lang === lang && c.key === sm.key);
      console.log(`  · ${lang} ${sm.key.padEnd(5)} 入力 ${JSON.stringify(vals)} → 描画 ${JSON.stringify(cs[0].names)}・すき間の最小 ${Math.min(...cs.map((c) => c.minGap ? c.minGap.g : Infinity)).toFixed(2)}px・枠 ${Math.min(...cs.map((c) => c.frame ? c.frame.w : Infinity)).toFixed(1)}〜${Math.max(...cs.map((c) => c.frame ? c.frame.w : 0)).toFixed(1)}px`);
    }
  }

  // ── P0 母集団 ──
  const want = SAMPLES.length * WIDTHS.length * 2;
  // 名前｜LAP の組が「描いた名前の数」だけ取れていること (2 フレーム分なので行数 × 2 以上)。
  const bad0 = cells.filter((c) => !c.frame || c.nName < c.vals.length * 2 || c.nameLap !== c.nName || c.spyErr > 0);
  ok(cells.length === want && bad0.length === 0,
    `P0 母集団: 車名 ${SAMPLES.length} 種 × 画面幅 ${WIDTHS.length} × {ja,en} = ${cells.length}/${want} セルで順位表が描かれ、全行の「名前｜LAP」の組を測れた (組 ${cells.reduce((a, c) => a + c.nameLap, 0)}・欠け ${bad0.length}: ${JSON.stringify(bad0.slice(0, 3).map((c) => [c.lang, c.key, c.W, !!c.frame, c.nName, c.nameLap, c.spyErr]))})`);
  // ── P1 描かれた名前 ──
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  // 右の空白は画素を出さないので比べない (改修前は padEnd(5) で空白を足して描いていた)。
  const norm = (a) => [...new Set(a.map((x) => x.trimEnd()))].sort().join('\u0000');
  const bad1 = cells.filter((c) => c.names.some((n) => lone.test(n)) || norm(c.want) !== norm(c.names));
  ok(bad1.length === 0,
    `P1 描かれた名前 = 入力欄の値の先頭 5 書記素・孤立サロゲート 0 (違反 ${bad1.length}/${cells.length}: ${JSON.stringify(bad1.slice(0, 3).map((c) => [c.lang, c.key, c.W, c.want, c.names]))})`);
  // ── P2 行の中の重なり ──
  const bad2 = cells.filter((c) => c.minGap && c.minGap.g < 0);
  const gMin = cells.filter((c) => c.minGap).reduce((a, c) => (!a || c.minGap.g < a.minGap.g ? c : a), null);
  ok(cells.length > 0 && bad2.length === 0,
    `P2 行の中で隣り合う要素が重ならない (違反 ${bad2.length}/${cells.length}・すき間の最小 ${gMin ? gMin.minGap.g.toFixed(2) : '—'}px「${gMin?.minGap.pair}」@ ${gMin?.lang} ${gMin?.key} ${gMin?.W}: ${JSON.stringify(bad2.slice(0, 4).map((c) => [c.lang, c.key, c.W, c.minGap.g.toFixed(2), c.minGap.pair]))})`);
  for (const k of SAMPLES.map((s) => s.key)) {
    const cs = cells.filter((c) => c.key === k && c.minGap);
    console.log(`  ℹ ${k.padEnd(5)} すき間の最小 自然幅 (1440) ${Math.min(...cs.filter((c) => c.W === 1440).map((c) => c.minGap.g)).toFixed(2)}px / 全幅 ${Math.min(...cs.map((c) => c.minGap.g)).toFixed(2)}px`);
  }
  // ── P3 はみ出し ──
  const bad3 = cells.filter((c) => !(c.frameOut <= EPS && c.inFrame <= EPS && c.inCanvas <= EPS));
  ok(cells.length > 0 && bad3.length === 0,
    `P3 枠がキャンバスの中・行の文字が枠の中とキャンバスの中 (四辺 0.00px・違反 ${bad3.length}・最大 枠 ${Math.max(0, ...cells.map((c) => c.frameOut ?? 0)).toFixed(2)} / 文字→枠 ${Math.max(0, ...cells.map((c) => c.inFrame ?? 0)).toFixed(2)} / 文字→キャンバス ${Math.max(0, ...cells.map((c) => c.inCanvas ?? 0)).toFixed(2)} px: ${JSON.stringify(bad3.slice(0, 3).map((c) => [c.lang, c.key, c.W, c.frameOut?.toFixed(2), c.inFrame?.toFixed(2), c.inCanvas?.toFixed(2)]))})`);
  // ── P4 文字の大きさ ──
  const bad4 = cells.filter((c) => !(c.minTxtH >= TEXT_MIN - EPS));
  ok(cells.length > 0 && bad4.length === 0,
    `P4 順位表の文字 ≥ ${TEXT_MIN} CSS px (最小 ${Math.min(...cells.map((c) => c.minTxtH ?? Infinity)).toFixed(2)}px・違反 ${bad4.length})`);
  // ── P5 半角の車名は既定の組み方のまま ──
  const pairs = cells.filter((c) => c.key === 'half5').map((c) => [c, cells.find((d) => d.key === 'def' && d.lang === c.lang && d.W === c.W)]);
  const bad5 = pairs.filter(([a, b]) => !b || !a.frame || !b.frame || Math.abs(a.frame.x0 - b.frame.x0) > EPS || Math.abs(a.frame.w - b.frame.w) > EPS
    || !a.row1 || !b.row1 || a.row1.length !== b.row1.length || a.row1.some((x, i) => Math.abs(x - b.row1[i]) > EPS));
  ok(pairs.length === SCAN.length * 2 + 2 && bad5.length === 0,
    `P5 半角 5 文字の車名は既定の車名と同じ枠・同じ列位置 (${pairs.length} 組・違反 ${bad5.length}: ${JSON.stringify(bad5.slice(0, 3).map(([a, b]) => [a.lang, a.W, a.frame?.w.toFixed(2), b?.frame?.w.toFixed(2), a.row1, b?.row1]))})`);
  const ovx = cells.filter((c) => c.ovX > 0);
  ok(ovx.length === 0, `P7 横はみ出し 0 (${ovx.length} セル)`);
  // ── P8 名前を縮めて逃げていない ──
  //   重なりは「列を広げる」でも「名前を列幅へ縮めて描く」(fillText の maxWidth) でも 0 になる。後者は全角が
  //   半分の幅に潰れて読めないので、母集団 (どれも全角 5 文字の上限以内) では縮めないことを求める。
  //   自然幅 (1440) は 1.000 ちょうど。詰めた画面はフォントが小数 px になり字送りの丸めで数 % 縮みうるので 0.97 まで。
  const natSq = cells.filter((c) => c.W === 1440 && c.minRatio !== 1);
  const allSq = cells.filter((c) => !(c.minRatio >= 0.97));
  ok(cells.length > 0 && natSq.length === 0 && allSq.length === 0,
    `P8 名前は縮めずに描かれる (横の縮め率の最小 ${Math.min(...cells.map((c) => c.minRatio ?? 0)).toFixed(3)}・自然幅で縮めた ${natSq.length}・0.97 未満 ${allSq.length}: ${JSON.stringify([...natSq, ...allSq].slice(0, 3).map((c) => [c.lang, c.key, c.W, c.minRatio]))})`);

  // ── P6 崖までの余裕 (全角の車名・行ごとに幅が違う編成) ──
  for (const lang of ['ja', 'en']) {
    await page.setViewportSize({ width: 1440, height: H });
    await setLang(page, lang);
    await setNames(SAMPLES.find((s) => s.key === 'rows').typed);
    await page.setViewportSize({ width: 200, height: H }); await page.waitForTimeout(600);
    const tiny = await measure();
    await page.setViewportSize({ width: SCAN[0], height: H }); await page.waitForTimeout(600);
    const atMin = await measure();
    const floorW = tiny.frame ? tiny.frame.w : null;
    const rightPad = atMin.frame ? atMin.cssW - atMin.frame.x1 : null;
    const margin = floorW != null && rightPad != null ? atMin.cssW - (floorW + rightPad) : null;
    ok(margin != null && margin > 0,
      `P6 ${lang} 全角を含む車名で、支える最小の画面幅 ${SCAN[0]}px (表示幅 ${atMin.cssW.toFixed(1)}px) から崖までの余裕 ${margin == null ? '—' : margin.toFixed(1)}px > 0 (枠幅の下限 ${floorW == null ? '—' : floorW.toFixed(2)}px ＝ 画面幅 200px で product が作る枠・右余白 ${rightPad == null ? '—' : rightPad.toFixed(1)}px → 左へ出はじめる表示幅 ≈ ${floorW == null || rightPad == null ? '—' : (floorW + rightPad).toFixed(1)}px)`);
  }
  await setLang(page, 'ja');
  ok(errors.length === 0, `E JS/HTTP エラー 0 (${errors.length}: ${JSON.stringify(errors.slice(0, 3))}) / 想定内 ${benign.length}`);
} finally {
  await browser.close();
}
console.log(`\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗:\n  - ' + fails.join('\n  - ')); process.exit(1); }
console.log('結果: PASS');
