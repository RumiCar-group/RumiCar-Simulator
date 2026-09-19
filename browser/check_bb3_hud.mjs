// check_bb3_hud.mjs — HUD の文字とマーカーの「画面上の大きさ」を、実ブラウザで product の描画呼び出しから測る (BB3)。
// ════════════════════════════════════════════════════════════════════════════
// 測るもの (見た目で判定しない・CI-14):
//   H) コース表示キャンバス (#course) と計器パネルの帯 (#hudBand・BC6) に描かれる**全ての文字**の表示高さ [CSS px]
//        = ctx.font の px × その時点の変換行列の倍率 × **そのキャンバスの**表示縮尺 (getBoundingClientRect の幅 / canvas.width)
//        BC6 以降、HUD は「コース表示域に収まらなければ帯へ」出るので、両方を観測しないと
//        「HUD が描かれなかった」と誤読する (置き場所は H3b が判定する)。
//      fillText を観測するだけ (描画は product のまま)。メーター・順位表・タイヤ HUD・距離ラベルを全部含める。
//      基準: 全セルの最小 ≥ 10 CSS px。どの HUD も一度も描かれなかったセルは測れていないので ✗。
//      H3: 画面固定 HUD の文字の箱が**描かれたキャンバス**の上・右・下から出ない (BC6 以降は全画面でゲート。
//          改修前は表示高さ 81px 級のキャンバスに読める大きさの HUD が入らず、390/320 幅は情報表示に留めていた)
//      H3c: 左へ出るのは「順位表の最小枠 (hud.js LB.wMin=268) が表示幅を超える」ときの順位表だけ。
//          320px 幅級の画面では表示幅が 256 CSS px しかなく構造的に 12px 切れる (BC6 以前からの性質・
//          BC6 が直した「下端の切れ」とは別の軸)。枠が入る表示幅では 0 をゲートする。
//      H3b: HUD 3 部品が 1 枚のキャンバスに揃い、置き場所が広い画面＝コース・狭い画面＝帯 (#hudBand)
//      H4: メーター・タイヤ HUD・順位表の 3 部品 (各部品の文字の箱と塗り/枠の矩形の外接矩形) が互いに重ならない
//          (全画面でゲート。別のキャンバスに描かれた部品どうしは重なりようがないので比べない)
//   M) 車の位置マーカー: 静止させた (▶→⏸) 場面で、マーカー ON と OFF の 2 枚の画素差の外接矩形 [CSS px]
//        基準: 表示される条件 (車の表示長さ < 閾値) のセルで外接径の最小 ≥ 12 CSS px・最大/最小 ≤ 1.25 (縮尺に依らず一定)
//              表示されない条件のセルでは画素差 0 (大きく見えている車には何も足さない＝ON と OFF で同じ絵)
//              OFF と OFF の画素差 0 (上の差がマーカーだけであることの対照)
//      M6: マーカー (drawCarMarkers の arc) の中心が、同じフレームの車体 (drawCar のノーズ→テールのグラデーションの中点＝
//          フットプリントの中心) と 1 CSS px 以内で 1 対 1 に対応する。ズーム・パンの掛け忘れや後輪軸を中心にする誤りを落とす。
//      ※ マーカーが車体 (drawCar) の寸法を変えないことは、drawCar 自体の差分が 0 であること (git diff) で担保する (このゲートは測らない)。
// 母集団: 出荷の全プリセット + 上流の投稿コース (gh:) × 画面 {1440×900, 1920×1080, 390×844}。
// 物理モードは v2 (タイヤ HUD が出る＝HUD の種類が最大)・距離ラベル ON (選択車)・1 台・ja・ズーム 1。
//   V) 変種: 英語 UI・台数を上限まで追加・タイヤ摩耗 ON (見出しが長い)・連続舵 (注記に装備が付く)・＋ボタン 2 回でズーム
//      × {racing-course, オーバル, 390 幅で表示高さが最も低いコース} × 4 画面 (3 画面＋320×568) で H1・H3・H4・H5・M6 を測り、
//      変種が本当に効いたか (英語の見出し・摩耗の見出し・装備の注記・＋ボタンが上限で無効) も確かめる。
//
// 使い方: bash run.sh check_bb3_hud.mjs          (RC_BB3_OUT=<path> で全セルの測定値を JSON で書き出す)
//         RC_BB3_ONLY=<数> で先頭 N コースだけ・RC_BB3_MATCH=<正規表現> で名前が合うコースだけ (試走用。全件でないと母集団の行が ✗)
import { launch, newPage, setLang, appModule, overflowX } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const SCREENS = [[1440, 900], [1920, 1080], [390, 844]];
const TEXT_MIN = 10, MARK_MIN = 12, MARK_SPREAD = 1.25;
const EPS = 0.01;   // 表示高さの丸め誤差 (10px の文字 × 倍率 × 表示縮尺 が 9.99999… と測れる) — 基準を緩めるためではない
const V_SCREENS = [...SCREENS, [320, 568]];   // 変種は 320 幅も (狭い画面の縦積み ② の経路)

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };

// BC6 以降、HUD は「コースの上に収まらないなら、コースの下の帯 (#hudBand) に描く」ので、**どの画面幅でも**
// HUD はそれを描いたキャンバスに収まる。ゆえに旧 H3b (「表示高さが必要高さ以上のセルだけ、はみ出し 0 を求める」
// という部分適用) は不要になり、H3 を全幅のゲートへ昇格した。必要高さの述語は product の hud.js `hudNeedH` が
// 単一真実源として持つ (ゲートは置き場所そのものを測るので、その式を写さない)。

const browser = await launch();
const cells = [];
try {
  const { page, errors, benign } = await newPage(browser, {
    before: async (p) => {
      await p.addInitScript(() => {
        try { localStorage.setItem('rumicar.lang', 'ja'); } catch (e) {}
        // 観測だけ: #course への描画呼び出しを記録し、描画はそのまま product に任せる。
        //   fillText … font・変換・文字の箱 / fillRect・strokeRect … HUD 部品の矩形 / arc … マーカーの輪 /
        //   createLinearGradient … drawCar の車体 (ノーズ→テール) の中点＝車の中心
        window.__bb3 = null;
        const P = CanvasRenderingContext2D.prototype;
        const whoOf = () => (/at (draw[A-Za-z]+)/.exec(new Error().stack.split('\n').slice(3).join('\n')) || [])[1] || '?';
        const box = (T, pts) => {
          const q = pts.map(([u, v]) => [T.a * u + T.c * v + T.e, T.b * u + T.d * v + T.f]);
          return { x0: Math.min(...q.map((z) => z[0])), y0: Math.min(...q.map((z) => z[1])), x1: Math.max(...q.map((z) => z[0])), y1: Math.max(...q.map((z) => z[1])) };
        };
        // BC6: HUD はコースの上か、狭い画面ではコースの下の帯 (#hudBand) に描かれる。**両方**を観測する
        // (片方だけ見ると、HUD が移ったときに「描かれなかった」と読み、はみ出しも見落とす)。
        const on = (c) => window.__bb3 && c.canvas && (c.canvas.id === 'course' || c.canvas.id === 'hudBand');
        const wrap = (name, fn) => {
          const orig = P[name];
          P[name] = function (...a) {
            if (on(this)) { try { fn.call(this, this.getTransform(), whoOf(), ...a); } catch (e) { window.__bb3.push({ kind: 'spyErr', e: String(e) }); } }
            return orig.apply(this, a);
          };
        };
        wrap('fillText', function (T, who, txt, x, y) {
          const m = /(\d+(?:\.\d+)?)px/.exec(this.font), px = m ? +m[1] : NaN, w = this.measureText(txt).width;
          window.__bb3.push({ kind: 'text', cv: this.canvas.id, who, px, sx: Math.hypot(T.a, T.b), sy: Math.hypot(T.c, T.d), text: String(txt).slice(0, 120),
            ...box(T, [[x, y - px], [x + w, y - px], [x, y], [x + w, y]]) });
        });
        for (const name of ['fillRect', 'strokeRect']) wrap(name, function (T, who, x, y, w, h) {
          window.__bb3.push({ kind: 'rect', cv: this.canvas.id, who, ...box(T, [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) });
        });
        wrap('arc', function (T, who, x, y, r) {
          if (who !== 'drawCarMarkers') return;
          window.__bb3.push({ kind: 'marker', cx: T.a * x + T.c * y + T.e, cy: T.b * x + T.d * y + T.f, r: r * Math.hypot(T.a, T.b) });
        });
        wrap('createLinearGradient', function (T, who, x0, y0, x1, y1) {
          if (who !== 'drawCar') return;
          const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
          window.__bb3.push({ kind: 'body', cx: T.a * mx + T.c * my + T.e, cy: T.b * mx + T.d * my + T.f });
        });
      });
    },
  });
  await setLang(page, 'ja');

  // v2 (タイヤ HUD を出す)・距離ラベル ON
  await page.selectOption('#optPhysMode', 'v2');
  await page.evaluate(() => { const c = document.getElementById('optLabels'); if (c && !c.checked) c.click(); });
  await page.waitForFunction(() => [...document.querySelectorAll('#courseSel option')].some((o) => o.value.startsWith('gh:')), null, { timeout: 30000 }).catch(() => {});
  const allOpts = await page.evaluate(() => [...document.querySelectorAll('#courseSel option')]
    .filter((o) => !o.textContent.startsWith('★ ')).map((o) => ({ v: o.value, label: o.textContent })));
  const presetN = await appModule(page, 'js/course.js', (m) => m.PRESETS.length);
  const ghN = allOpts.filter((o) => o.v.startsWith('gh:')).length;
  const only = Number(process.env.RC_BB3_ONLY || 0);
  const match = process.env.RC_BB3_MATCH ? new RegExp(process.env.RC_BB3_MATCH) : null;   // 試走用 (全件でないと母集団の行が ✗)
  const opts = (match ? allOpts.filter((o) => match.test(o.v)) : allOpts).slice(0, only > 0 ? only : undefined);
  ok(presetN > 0 && ghN > 0 && allOpts.length === presetN + ghN && opts.length === allOpts.length, `母集団: プリセット ${presetN} + 投稿 ${ghN} = ${allOpts.length} コース × 画面 ${SCREENS.length}${opts.length !== allOpts.length ? ` (試走指定で ${opts.length} だけ＝常設の判定にならない)` : ''}`);
  const hasMarker = await page.evaluate(() => !!document.getElementById('optCarMarker'));
  const markerLabel = await appModule(page, 'js/i18n.js', (m) => ({ tire: m.t('hud.tire'), lb: m.t('hud.lb.header') }));

  // 1 フレームぶんの描画呼び出しを記録する。product の frame() は rAF の先頭で次の rAF を予約するので、
  // こちらの rAF コールバックは同じティックの product の描画の後に走る＝[開始, 終了) の間に render がちょうど 1 回入る。
  const measure = (screen) => page.evaluate(async ([W, H]) => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    const cv = document.getElementById('course');
    const S = await import(new URL('js/state.js', location.href).href);
    const CFG = await import(new URL('js/config.js', location.href).href);
    await raf();
    window.__bb3 = [];
    await raf();
    const all = window.__bb3; window.__bb3 = null;
    const bd = document.getElementById('hudBand');
    const bandOn = !!(bd && !bd.hidden);
    const rect = cv.getBoundingClientRect();
    const rectB = bandOn ? bd.getBoundingClientRect() : null;
    // BC6: 文字も矩形も「描かれたキャンバス」の縮尺で CSS px へ直す (course は縮小表示されうる・帯は 1:1)。
    const SC = {
      course: { kx: rect.width / cv.width, ky: rect.height / cv.height, w: cv.width, h: cv.height },
      hudBand: bandOn ? { kx: rectB.width / bd.width, ky: rectB.height / bd.height, w: bd.width, h: bd.height } : null,
    };
    const sc = (r) => SC[r.cv] || SC.course;
    const kx = SC.course.kx, ky = SC.course.ky;   // 車体・マーカー・距離ラベルは course にしか描かれない
    const rec = all.filter((r) => r.kind === 'text');
    const hs = rec.map((r) => ({ h: Math.min(r.px * r.sx * sc(r).kx, r.px * r.sy * sc(r).ky), text: r.text }));
    // 画面固定 HUD の文字で、箱が**そのキャンバス**の外へ出ているもの (切れて読めない)。距離ラベルは壁際で外へ出うるので別に数える。
    const outside = (r) => { const S2 = sc(r); return r.x0 < -0.5 || r.y0 < -0.5 || r.x1 > S2.w + 0.5 || r.y1 > S2.h + 0.5; };
    const hudRec = rec.filter((r) => r.who !== 'drawSensors');
    const hudOut = hudRec.filter(outside).map((r) => r.text);
    // BC6: 辺ごとの最大はみ出し量 [CSS px] と、はみ出した描き手。左だけは「順位表の最小枠 (LB.wMin) が
    // 表示幅を超える」ときに構造的に出る (320 幅・BC6 以前からの性質) ので、他の 3 辺と分けて判定する。
    const ovr = (r) => { const S2 = sc(r); return { l: Math.max(0, -(r.x0 * S2.kx)), r: Math.max(0, r.x1 * S2.kx - S2.w), t: Math.max(0, -(r.y0 * S2.ky)), b: Math.max(0, r.y1 * S2.ky - S2.h) }; };
    const outSide = { l: 0, r: 0, t: 0, b: 0 }; const outWho = new Set();
    for (const r of hudRec) { const o = ovr(r); for (const k of ['l', 'r', 't', 'b']) outSide[k] = Math.max(outSide[k], o[k]); if (outside(r)) outWho.add(r.who); }
    let min = null; for (const x of hs) if (!min || x.h < min.h) min = x;
    // H4: 部品ごとの外接矩形 (CSS px) と、部品どうしの重なり
    const parts = {};
    for (const r of all) {
      if (!['drawMeters', 'drawTireHud', 'drawFleetHud'].includes(r.who) || !(r.kind === 'text' || r.kind === 'rect')) continue;
      const S2 = sc(r);
      const b = parts[r.who] ||= { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9, cv: r.cv };
      b.x0 = Math.min(b.x0, r.x0 * S2.kx); b.y0 = Math.min(b.y0, r.y0 * S2.ky); b.x1 = Math.max(b.x1, r.x1 * S2.kx); b.y1 = Math.max(b.y1, r.y1 * S2.ky);
    }
    const names = Object.keys(parts), overlaps = [];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const A = parts[names[i]], B = parts[names[j]];
      if (A.cv !== B.cv) continue;   // BC6: 別のキャンバスに描かれた部品どうしは重なりようがない
      const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
      if (ox > 0.5 && oy > 0.5) overlaps.push(`${names[i]}×${names[j]}:${ox.toFixed(0)}×${oy.toFixed(0)}`);
    }
    // M6: マーカーの中心 ↔ 車体の中心 (CSS px)
    const markers = all.filter((r) => r.kind === 'marker').map((r) => ({ x: r.cx * kx, y: r.cy * ky, r: r.r * kx }));
    const bodies = all.filter((r) => r.kind === 'body').map((r) => ({ x: r.cx * kx, y: r.cy * ky }));
    // マーカーと車体は main.js で同じ ordered の順に描かれる＝i 番目どうしが同じ車 (1 対 1 を順番で確かめる)
    let worstDist = 0;
    markers.forEach((mk, i) => { const b = bodies[i]; worstDist = Math.max(worstDist, b ? Math.hypot(b.x - mk.x, b.y - mk.y) : Infinity); });
    const F = CFG.CAR_FOOTPRINT, k = CFG.VIEW.carScale || 1;
    const pxPerM = cv.width / S.course.bounds.w;
    const lenCss = (F.front - F.back) * k * pxPerM * kx;
    return {
      W, H, course: S.course.name, cw: cv.width, ch: cv.height, cssW: rect.width, cssH: rect.height, kx,
      zoom: document.getElementById('viewZoom')?.textContent,
      n: rec.length, minH: min ? min.h : null, minText: min ? min.text : null,
      hudN: hudRec.length, hudOutN: hudOut.length, hudOut: [...new Set(hudOut)].slice(0, 6),
      labelN: rec.filter((r) => r.who === 'drawSensors').length,
      labelH: rec.filter((r) => r.who === 'drawSensors').map((r) => Math.min(r.px * r.sx * kx, r.px * r.sy * ky)),
      whoUnknown: rec.filter((r) => r.who === '?').length,
      spyErr: all.filter((r) => r.kind === 'spyErr').length,
      noteLines: rec.filter((r) => r.who === 'drawFleetHud' && r.px <= 12).length,
      parts: Object.keys(parts), overlaps, partBox: parts,
      bandOn, hudCv: [...new Set(Object.values(parts).map((b) => b.cv))].sort(),
      outSide, outWho: [...outWho].sort(), lbW: parts.drawFleetHud ? parts.drawFleetHud.x1 - parts.drawFleetHud.x0 : null,
      markerN: markers.length, bodyN: bodies.length, markerWorstDist: worstDist, markerR: markers.length ? markers[0].r : null,
      texts: [...new Set(rec.map((r) => r.text))].slice(0, 80),
      carLenCss: lenCss, carWidCss: 2 * F.hw * k * pxPerM * kx,
    };
  }, screen);

  // マーカー: ON/OFF の画素差 (マーカー機能がまだ無い版では測らない)
  const markerDiff = () => page.evaluate(async () => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    const cv = document.getElementById('course'), el = document.getElementById('optCarMarker');
    const snap = async () => { for (let i = 0; i < 3; i++) await raf(); return cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; };
    const bbox = (a, b) => {
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
          const p = i >> 2, x = p % cv.width, y = (p / cv.width) | 0; n++;
          if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
        }
      }
      return n ? { n, w: x1 - x0 + 1, h: y1 - y0 + 1 } : { n: 0, w: 0, h: 0 };
    };
    // 場面を止める: 停止中でも手動運転の積分は回り、勾配のあるコース (峠) では車が転がる (実測: 対照の差が 46 セルで出た)。
    // 利用者と同じ ▶ → ⏸ で一時停止にする (一時停止中は積分もプログラムも進まない＝静止した絵)。
    document.getElementById('run').click();
    await raf(); await raf();
    const pauseBtn = document.getElementById('pause');
    const paused = !pauseBtn.disabled && (pauseBtn.click(), true);
    const was = el.checked;
    if (el.checked) el.click();
    const off1 = await snap(), off2 = await snap();
    el.click();
    const on = await snap();
    if (el.checked !== was) el.click();
    document.getElementById('stop').click();
    const k = cv.getBoundingClientRect().width / cv.width;
    const ctl = bbox(off1, off2), d = bbox(off1, on);
    return { paused, ctlN: ctl.n, n: d.n, wCss: d.w * k, hCss: d.h * k };
  });

  for (const o of opts) {
    await page.setViewportSize({ width: SCREENS[0][0], height: SCREENS[0][1] });
    await page.selectOption('#courseSel', o.v);
    await page.waitForTimeout(1500);
    for (const [W, H] of SCREENS) {
      await page.setViewportSize({ width: W, height: H });
      await page.waitForTimeout(600);   // resize のデバウンス 200ms → setView
      const m = await measure([W, H]);
      m.opt = o.v;
      m.hasTire = m.texts.includes(markerLabel.tire);
      m.hasLb = m.texts.includes(markerLabel.lb);
      m.hasMeter = m.texts.includes('Distance');
      m.ovX = await overflowX(page, W);
      if (hasMarker) m.marker = await markerDiff();
      cells.push(m);
    }
    const last = cells.slice(-SCREENS.length);
    console.log(`  · ${o.v.padEnd(22)} ` + last.map((c) => `${c.W}:${c.minH == null ? '—' : c.minH.toFixed(1)}px/車${c.carLenCss.toFixed(1)}px${c.marker ? `/印${c.marker.n ? Math.max(c.marker.wCss, c.marker.hCss).toFixed(1) : 0}` : ''}`).join('  '));
  }
  if (process.env.RC_BB3_OUT) writeFileSync(process.env.RC_BB3_OUT, JSON.stringify(cells, null, 1));

  // ── H: 文字の表示高さ ──
  const measured = cells.filter((c) => c.minH != null);
  const unmeasured = cells.filter((c) => !(c.hasMeter && c.hasLb && c.hasTire));
  ok(unmeasured.length === 0, `H0 全セルでメーター・順位表・タイヤ HUD が描かれた (欠け ${unmeasured.length}: ${JSON.stringify(unmeasured.slice(0, 3).map((c) => [c.opt, c.W, c.hasMeter, c.hasLb, c.hasTire]))})`);
  const worst = measured.reduce((a, c) => (!a || c.minH < a.minH ? c : a), null);
  ok(worst && worst.minH >= TEXT_MIN - EPS, `H1 文字の表示高さの最小 ≥ ${TEXT_MIN} CSS px (最小 ${worst ? worst.minH.toFixed(2) : '—'}px「${worst?.minText}」@ ${worst?.opt} ${worst?.W}×${worst?.H}・${measured.length} セル)`);
  const unk = cells.filter((c) => c.whoUnknown > 0 || c.labelN === 0);
  ok(unk.length === 0, `H0b 全セルで距離ラベルが描かれ、全ての文字の描き手が分かる (欠け/不明 ${unk.length})`);
  for (const [W, H] of SCREENS) {
    const cs = cells.filter((c) => c.W === W);
    const tot = cs.reduce((a, c) => a + c.hudN, 0), out = cs.reduce((a, c) => a + c.hudOutN, 0);
    // BC6: 全幅でゲート。狭い画面では HUD が帯へ出るので、**下が切れる**理由が無くなった。
    //   左だけは別 (下の H3c)。順位表の最小枠 LB.wMin が表示幅を超える画面 (320 幅級) では右詰めの枠が
    //   左へ出る — これは BC6 以前からの性質で、BC6 が直した「下端の切れ」とは別の軸。
    const bad = cs.filter((c) => c.outSide.t > 0.5 || c.outSide.r > 0.5 || c.outSide.b > 0.5);
    ok(bad.length === 0, `H3 ${W}×${H}: 画面固定 HUD の文字が**描かれたキャンバス**の上・右・下から出ない (はみ出す文字 ${out}/${tot}・違反 ${bad.length}/${cs.length} セル・最大 上 ${Math.max(...cs.map((c) => c.outSide.t)).toFixed(1)}/右 ${Math.max(...cs.map((c) => c.outSide.r)).toFixed(1)}/下 ${Math.max(...cs.map((c) => c.outSide.b)).toFixed(1)} px: ${JSON.stringify(bad.slice(0, 3).map((c) => [c.opt, Math.round(c.cssW), Math.round(c.cssH), c.outSide, c.hudOut]))})`);
    const lbad = cs.filter((c) => c.outSide.l > 0.5 && (c.outWho.join() !== 'drawFleetHud' || c.lbW == null || c.cssW >= c.lbW + 24 - 0.5));
    ok(lbad.length === 0, `H3c ${W}×${H}: 左へ出るのは「順位表の枠 (${cs[0].lbW?.toFixed(0)}px) が表示幅 (${Math.round(cs[0].cssW)}px) に入らない」ときの順位表だけ (違反 ${lbad.length}/${cs.length}・左の最大 ${Math.max(...cs.map((c) => c.outSide.l)).toFixed(1)}px: ${JSON.stringify(lbad.slice(0, 3).map((c) => [c.opt, c.outSide.l.toFixed(1), c.outWho]))})`);
    // 置き場所: 狭い画面 (メーターと順位表が横に並ばない) では帯・広い画面ではコース。3 部品が別々のキャンバスへ
    // 散らばっていないことも求める (散らばると H4 の重なり検査が両方で空振りする)。
    const split = cs.filter((c) => c.hudCv.length !== 1);
    const placed = cs.filter((c) => (W >= 1000 ? c.hudCv[0] === 'course' : c.hudCv[0] === 'hudBand'));
    ok(split.length === 0 && placed.length === cs.length,
      `H3b ${W}×${H}: HUD 3 部品が 1 枚のキャンバスに揃って描かれ、置き場所が ${W >= 1000 ? 'コース' : '帯 (#hudBand)'} (散らばり ${split.length}・置き場所違い ${cs.length - placed.length}: ${JSON.stringify(cs.filter((c) => c.hudCv.length !== 1 || !(W >= 1000 ? c.hudCv[0] === 'course' : c.hudCv[0] === 'hudBand')).slice(0, 3).map((c) => [c.opt, c.hudCv, c.bandOn]))})`);
  }
  const lap = cells.filter((c) => c.overlaps.length > 0);
  ok(lap.length === 0, `H4 メーター・タイヤ HUD・順位表が互いに重ならない (全 ${cells.length} セル・重なり ${lap.length}: ${JSON.stringify(lap.slice(0, 3).map((c) => [c.opt, c.W, c.overlaps]))})`);
  const spy = cells.filter((c) => c.spyErr > 0);
  ok(spy.length === 0, `H0c 観測の記録で例外 0 (${spy.length} セル)`);
  const ovx = cells.filter((c) => c.ovX > 0);
  ok(ovx.length === 0, `H2 横はみ出し 0 (${ovx.length} セル: ${JSON.stringify(ovx.slice(0, 3).map((c) => [c.opt, c.W, c.ovX]))})`);

  // ── M: マーカー ──
  ok(hasMarker, 'M0 位置マーカーの切替 (#optCarMarker) がある');
  if (hasMarker) {
    const unpaused = cells.filter((c) => !c.marker.paused);
    ok(unpaused.length === 0, `M1a 画素差を撮る間は ▶→⏸ で一時停止できた (できなかった ${unpaused.length} セル)`);
    const noisy = cells.filter((c) => c.marker.ctlN !== 0);
    ok(noisy.length === 0, `M1 対照: OFF と OFF の画素差 0 (${noisy.length} セル: ${JSON.stringify(noisy.slice(0, 3).map((c) => [c.opt, c.W, c.marker.ctlN]))})`);
    const MOD = await appModule(page, 'js/hud.js', (m) => m.MARKER);
    const shown = cells.filter((c) => c.carLenCss < MOD.showBelowCss);
    const hidden = cells.filter((c) => c.carLenCss >= MOD.showBelowCss);
    const sz = shown.map((c) => Math.max(c.marker.wCss, c.marker.hCss));
    const mn = Math.min(...sz), mx = Math.max(...sz);
    ok(shown.length > 0 && shown.every((c) => c.marker.n > 0), `M2 車の表示長さ < ${MOD.showBelowCss}px のセル (${shown.length}) で全てマーカーが描かれる (描かれない ${shown.filter((c) => !c.marker.n).length})`);
    ok(shown.length > 0 && mn >= MARK_MIN, `M3 マーカーの外接径の最小 ≥ ${MARK_MIN} CSS px (最小 ${mn.toFixed(2)} / 最大 ${mx.toFixed(2)})`);
    ok(shown.length > 0 && mx / mn <= MARK_SPREAD, `M4 縮尺に依らず一定: 最大/最小 ${(mx / mn).toFixed(3)} ≤ ${MARK_SPREAD}`);
    const drawnCells = cells.filter((c) => c.markerN > 0);
    const mism = drawnCells.filter((c) => c.markerN !== c.bodyN || c.markerWorstDist > 1);
    ok(drawnCells.length > 0 && mism.length === 0, `M6 マーカーの中心が同じフレームの車体の中心と 1 CSS px 以内・台数一致 (${drawnCells.length} セル・最大ずれ ${Math.max(0, ...drawnCells.map((c) => c.markerWorstDist)).toFixed(3)}px・不一致 ${mism.length}: ${JSON.stringify(mism.slice(0, 3).map((c) => [c.opt, c.W, c.markerN, c.bodyN, c.markerWorstDist.toFixed(2)]))})`);
    const decide = cells.filter((c) => (c.markerN > 0) !== (c.carLenCss < MOD.showBelowCss));
    ok(decide.length === 0, `M2b 静止前のフレームでも「車長 < ${MOD.showBelowCss}px ⇔ マーカーを描く」(食い違い ${decide.length}: ${JSON.stringify(decide.slice(0, 3).map((c) => [c.opt, c.W, c.carLenCss.toFixed(1), c.markerN]))})`);
    const titles = await appModule(page, 'js/i18n/messages.js', (m) => m.MESSAGES ? m.MESSAGES['opt.carMarker.title'] : null);
    const pxRe = new RegExp(`(^|[^0-9])${MOD.showBelowCss}\\s?px`);
    ok(!!titles && pxRe.test(titles.ja) && pxRe.test(titles.en), `M7 切替の説明 (ja/en) が閾値 ${MOD.showBelowCss}px と一致 (ja「${titles?.ja?.slice(0, 40)}…」)`);
    const leak = hidden.filter((c) => c.marker.n !== 0);
    ok(leak.length === 0, `M5 車の表示長さ ≥ ${MOD.showBelowCss}px のセル (${hidden.length}) では画素差 0 (差あり ${leak.length}: ${JSON.stringify(leak.slice(0, 3).map((c) => [c.opt, c.W, c.carLenCss.toFixed(1)]))})`);
  }
  // ── V: 変種 (英語・台数上限・摩耗 ON・連続舵・ズーム) ──
  if (hasMarker) {
    console.log('\n── V 変種 ──');
    const phone = cells.filter((c) => c.W === 390).reduce((a, c) => (!a || c.cssH < a.cssH ? c : a), null);
    const vOpts = [...new Set(['gh:racing-course', 'オーバル', phone && phone.opt].filter(Boolean))].filter((v) => allOpts.some((o) => o.v === v));
    await page.setViewportSize({ width: SCREENS[0][0], height: SCREENS[0][1] });
    await setLang(page, 'en');
    await page.evaluate(() => { const w = document.getElementById('optWear'); if (w && !w.checked) w.click(); });
    await page.selectOption('#optSteer', 'prop');
    const EN = await appModule(page, 'js/i18n/messages.js', (m) => ({ lb: m.MESSAGES['hud.lb.header'].en, wear: m.MESSAGES['hud.tire.wear'].en, prop: m.MESSAGES['hud.lb.steer.prop'].en }));
    const maxCars = await appModule(page, 'js/config.js', (m) => m.FLEET.maxCars);
    const vcells = [];
    for (const v of vOpts) {
      await page.setViewportSize({ width: SCREENS[0][0], height: SCREENS[0][1] });
      await page.selectOption('#courseSel', v);
      await page.waitForTimeout(1500);
      for (let i = 0; i < 10; i++) { const d = await page.evaluate(() => { const b = document.getElementById('carAdd'); if (!b || b.disabled) return true; b.click(); return false; }); if (d) break; await page.waitForTimeout(300); }
      await page.waitForTimeout(800);
      const capped = await page.evaluate(() => document.getElementById('carAdd').disabled);
      for (const [W, H] of V_SCREENS) {
        await page.setViewportSize({ width: W, height: H });
        await page.waitForTimeout(600);
        await page.click('#viewIn'); await page.click('#viewIn');
        await page.waitForTimeout(200);
        const m = await measure([W, H]);
        m.opt = v; m.ovX = await overflowX(page, W); m.capped = capped;
        const allText = m.texts.join('').replace(/\s/g, '');   // 注記は折り返しで行が分かれる (空白で切れる) ので空白を除いてつなぐ
        m.isEn = m.texts.includes(EN.lb); m.isWear = m.texts.includes(EN.wear); m.hasProp = allText.includes(EN.prop.replace(/\s/g, ''));
        vcells.push(m);
        console.log(`  · ${v.padEnd(22)} ${W}: 台数 ${m.bodyN}・倍率 ${m.zoom}・文字最小 ${m.minH?.toFixed(1)}px・注記 ${m.noteLines} 行・印 ${m.markerN}・重なり ${m.overlaps.length}・はみ出し ${m.hudOutN}`);
      }
    }
    const vw = vcells.reduce((a, c) => (!a || c.minH < a.minH ? c : a), null);
    ok(vcells.length === vOpts.length * V_SCREENS.length && vcells.every((c) => c.bodyN >= 2 && c.zoom !== '1.0×' && c.labelN > 0), `V0 変種を測れた (${vcells.length} セル・全セルで複数台・ズーム ≠1・距離ラベルあり: 台数 ${JSON.stringify([...new Set(vcells.map((c) => c.bodyN))])}・倍率 ${JSON.stringify([...new Set(vcells.map((c) => c.zoom))])})`);
    ok(vcells.every((c) => c.isEn && c.isWear && c.hasProp), `V0b 変種が効いている: 英語の見出し・摩耗 ON の見出し「${EN.wear}」・連続舵の注記「${EN.prop}」が全セルに描かれた (欠け ${vcells.filter((c) => !(c.isEn && c.isWear && c.hasProp)).length}: ${JSON.stringify(vcells.filter((c) => !(c.isEn && c.isWear && c.hasProp)).slice(0, 4).map((c) => [c.opt, c.W, c.isEn, c.isWear, c.hasProp]))})`);
    ok(vcells.every((c) => c.capped && c.bodyN >= 2), `V0c 台数はそのコースの上限まで追加 (＋ボタンが無効になった・全体の上限 ${maxCars}・コースごとの実台数 ${JSON.stringify(vOpts.map((v) => [v, vcells.find((c) => c.opt === v)?.bodyN]))})`);
    ok(vw && vw.minH >= TEXT_MIN - EPS, `V-H1 文字の表示高さの最小 ≥ ${TEXT_MIN} CSS px (最小 ${vw?.minH?.toFixed(2)}px「${vw?.minText}」@ ${vw?.opt} ${vw?.W})`);
    const vl = vcells.filter((c) => c.overlaps.length);
    ok(vl.length === 0, `V-H4 部品どうしが重ならない (重なり ${vl.length}: ${JSON.stringify(vl.slice(0, 3).map((c) => [c.opt, c.W, c.overlaps]))})`);
    const vo = vcells.filter((c) => c.outSide.t > 0.5 || c.outSide.r > 0.5 || c.outSide.b > 0.5);
    ok(vo.length === 0, `V-H3 変種でも HUD の文字が**描かれたキャンバス**の上・右・下から出ない (対象 ${vcells.length} セル・違反 ${vo.length}・最大 上 ${Math.max(...vcells.map((c) => c.outSide.t)).toFixed(1)}/右 ${Math.max(...vcells.map((c) => c.outSide.r)).toFixed(1)}/下 ${Math.max(...vcells.map((c) => c.outSide.b)).toFixed(1)} px: ${JSON.stringify(vo.slice(0, 3).map((c) => [c.opt, c.W, c.hudCv, c.outSide, c.hudOut]))})`);
    const vLeft = vcells.filter((c) => c.outSide.l > 0.5 && (c.outWho.join() !== 'drawFleetHud' || c.lbW == null || c.cssW >= c.lbW + 24 - 0.5));
    ok(vLeft.length === 0, `V-H3c 変種でも左へ出るのは「順位表の枠が表示幅に入らない」ときの順位表だけ (違反 ${vLeft.length}/${vcells.length}・左の最大 ${Math.max(...vcells.map((c) => c.outSide.l)).toFixed(1)}px: ${JSON.stringify(vLeft.slice(0, 3).map((c) => [c.opt, c.W, c.outSide.l.toFixed(1), c.outWho, c.lbW?.toFixed(0), c.cssW.toFixed(0)]))})`);
    console.log(`  ℹ V-H3 左の出方: ${[...new Set(vcells.map((c) => `${c.W}=${c.outSide.l.toFixed(0)}px(枠 ${c.lbW?.toFixed(0)}/表示 ${c.cssW.toFixed(0)})`))].join('・')}`);
    const vsplit = vcells.filter((c) => c.hudCv.length !== 1);
    ok(vsplit.length === 0, `V-H3b 変種でも HUD 3 部品が 1 枚のキャンバスに揃う (散らばり ${vsplit.length}: ${JSON.stringify(vsplit.slice(0, 3).map((c) => [c.opt, c.W, c.hudCv]))})`);
    console.log(`  ℹ V-H3 置き場所: ${[...new Set(vcells.map((c) => `${c.W}=${c.hudCv.join('+')}`))].join('・')}`);
    const vm = vcells.filter((c) => c.markerN > 0);
    const vmm = vm.filter((c) => c.markerN !== c.bodyN || c.markerWorstDist > 1);
    ok(vm.length > 0 && vmm.length === 0, `V-M6 ズーム中も全車のマーカー中心が車体中心と 1 CSS px 以内 (${vm.length} セル・最大ずれ ${Math.max(0, ...vm.map((c) => c.markerWorstDist)).toFixed(3)}px・不一致 ${vmm.length})`);
    // 距離ラベルは画面上 11px 固定 (ズームしても大きくならない＝textScale が hs/zoom であることの検出。hs のままならズーム倍に膨らむ)
    const lh = vcells.flatMap((c) => c.labelH);
    ok(lh.length > 0 && Math.min(...lh) >= 10.5 && Math.max(...lh) <= 11.5, `V-H5 ズーム中の距離ラベルの表示高さが 11±0.5 CSS px (${lh.length} 個・${Math.min(...lh).toFixed(2)}〜${Math.max(...lh).toFixed(2)}px)`);
    const vx = vcells.filter((c) => c.ovX > 0);
    ok(vx.length === 0, `V-H2 横はみ出し 0 (${vx.length})`);
    console.log(`  ℹ 注記の行数 (折り返しの経路を通ったか): ${JSON.stringify([...new Set(vcells.map((c) => c.noteLines))])}`);
  }
  ok(errors.length === 0, `E JS/HTTP エラー 0 (${errors.length}: ${JSON.stringify(errors.slice(0, 3))}) / 想定内 ${benign.length}`);
} finally {
  await browser.close();
}
console.log(`\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗:\n  - ' + fails.join('\n  - ')); process.exit(1); }
console.log('結果: PASS');
