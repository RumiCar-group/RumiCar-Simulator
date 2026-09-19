// check_bb4_follow.mjs — 追従カメラとミニマップを、実ブラウザで product の描画呼び出しから測る (BB4)。
// ════════════════════════════════════════════════════════════════════════════
// 測るもの (見た目で判定しない・CI-14):
//   F) 追従カメラ (#optFollow)。走行中 (▶) に一定間隔で標本を取り、**全標本**で:
//      F1 対象車 (選択車) の画面上の中心が表示領域の**中央 40% の矩形**内にある
//         中心 = drawCar のノーズ→テールのグラデーションの中点 (BB3 の M6 と同じ点＝フットプリントの中心)。
//         対象車は main.js が ordered で最後に描く車＝記録の最後の body。
//      F2 画面上の車長 ≥ FOLLOW.minCarCss [CSS px]
//         車長は config の CAR_FOOTPRINT×carScale と、観測した変換行列の倍率から出す (BB3 と同じ定義)。
//         同じフレームのグラデーションの実長 (glen) も併記し、定義と実描画が食い違っていないか見る。
//      F3 追従 OFF に戻すと倍率が VT.max 以下へ戻り、被覆クランプ (コースが画面を覆う) が復活する
//      F4 ドラッグ (パン) と「全体表示 ⤢」で追従が解除される・＋ボタンでは解除されない
//      F5 ＋ボタンで倍率を上げても中央 40% を保つ (利用者裁定「ズームは追従を保つ」)
//      F6 VT.max=8 では届かないコースでも F2 を満たす (＝上限の引き上げが効いている) セルが実在する
//      F7 切替の説明 (ja/en) が FOLLOW.minCarCss と一致する
//      F9 追従 ON のまま編集モードへ入ると追従が解除され、倍率 ≤ VT.max・被覆クランプが復活する
//         (編集中は updateFollow を呼ばないので、解除しないと倍率 >8・パン未クランプのまま固まる)
//   N) ミニマップ (drawMinimap)。strokeRect の呼び順は ① 箱の枠 → ② 表示範囲 で固定 (hud.js の注記)。
//      N1 等倍かつ追従 OFF では 1 本も描かれない / 倍率 > 1 または追従 ON では描かれる
//      N2 ②の矩形が、同じフレームの vt (drawCourse の変換行列) から計算した表示範囲と **1 CSS px 以内**で一致
//      N3 ①の箱がメーター・タイヤ HUD・順位表の 3 部品と重ならない (BB3 の H4 と同じ述語)
//   E  JS/HTTP エラー 0
//
// 母集団: {gh:racing-course (大きいコース), オーバル (小さいコース), 出荷で最大のプリセット} × 画面 {1440×900, 390×844}
//   物理 v2・1 台・ja・既定の車体スケール。F の標本は走行中 SAMPLES 回。
//
// 使い方: bash run.sh check_bb4_follow.mjs     (RC_BB4_OUT=<path> で全セルの測定値を JSON で書き出す)
import { launch, newPage, setLang, appModule, overflowX } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const SCREENS = [[1440, 900], [390, 844]];
const SAMPLES = 8;           // 走行中に取る標本の数
const SAMPLE_MS = 180;       // 標本の間隔
const CENTER_FRAC = 0.4;     // 中央 40% の矩形
const RECT_TOL = 1.0;        // ミニマップの表示範囲の許容ずれ [CSS px]
const EPS = 0.01;            // 丸め誤差 (基準を緩めるためではない)

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };

const browser = await launch();
const cells = [];
try {
  const { page, errors, benign } = await newPage(browser, {
    before: async (p) => {
      await p.addInitScript(() => {
        try { localStorage.setItem('rumicar.lang', 'ja'); } catch (e) {}
        try { localStorage.removeItem('rumicar.follow'); } catch (e) {}   // 既定 OFF から始める
        // 観測だけ: #course への描画呼び出しを記録し、描画はそのまま product に任せる (BB3 と同じ計装)。
        window.__bb4 = null;
        const P = CanvasRenderingContext2D.prototype;
        const whoOf = () => (/at (draw[A-Za-z]+)/.exec(new Error().stack.split('\n').slice(3).join('\n')) || [])[1] || '?';
        const box = (T, pts) => {
          const q = pts.map(([u, v]) => [T.a * u + T.c * v + T.e, T.b * u + T.d * v + T.f]);
          return { x0: Math.min(...q.map((z) => z[0])), y0: Math.min(...q.map((z) => z[1])), x1: Math.max(...q.map((z) => z[0])), y1: Math.max(...q.map((z) => z[1])) };
        };
        const on = (c) => window.__bb4 && c.canvas && c.canvas.id === 'course';
        const wrap = (name, fn) => {
          const orig = P[name];
          P[name] = function (...a) {
            if (on(this)) { try { fn.call(this, this.getTransform(), whoOf(), ...a); } catch (e) { window.__bb4.push({ kind: 'spyErr', e: String(e) }); } }
            return orig.apply(this, a);
          };
        };
        // コース層を描くときの変換行列 = vt (zoom/panX/panY) そのもの。main.js は world 層を描く直前にこれを積む。
        // course.js は「恒等変換ならキャッシュ画像を drawImage・そうでなければ drawCourseLayer で直描き」の
        // 2 経路を持つので、両方から拾う (片方だけだと等倍のときしか vt を取れない)。
        const VT_WHO = ['drawCourse', 'drawCourseLayer'];
        wrap('drawImage', function (T, who) {
          if (who === 'drawCourse') window.__bb4.push({ kind: 'vt', zoom: T.a, panX: T.e, panY: T.f });
        });
        for (const name of ['fillRect', 'strokeRect']) wrap(name, function (T, who, x, y, w, h) {
          // drawCourseLayer の背景 fillRect は (0,0,view.wPx,view.hPx)＝**丸めていない** fit 済み寸法。
          // canvas.width は整数へ切り捨てられるので、ここから基準倍率を出さないと車長が 0.1% ずれる。
          if (name === 'fillRect' && VT_WHO.includes(who)) window.__bb4.push({ kind: 'vt', zoom: T.a, panX: T.e, panY: T.f, wPx: w, hPx: h });
          window.__bb4.push({ kind: 'rect', call: name, who, ...box(T, [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) });
        });
        wrap('fillText', function (T, who, txt, x, y) {
          const m = /(\d+(?:\.\d+)?)px/.exec(this.font), px = m ? +m[1] : NaN, w = this.measureText(txt).width;
          window.__bb4.push({ kind: 'text', who, ...box(T, [[x, y - px], [x + w, y - px], [x, y], [x + w, y]]) });
        });
        wrap('createLinearGradient', function (T, who, x0, y0, x1, y1) {
          if (who !== 'drawCar') return;
          const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
          const q = (u, v) => [T.a * u + T.c * v + T.e, T.b * u + T.d * v + T.f];
          const A = q(x0, y0), B = q(x1, y1);
          window.__bb4.push({ kind: 'body', cx: T.a * mx + T.c * my + T.e, cy: T.b * mx + T.d * my + T.f, glen: Math.hypot(B[0] - A[0], B[1] - A[1]) });
        });
      });
    },
  });
  await setLang(page, 'ja');
  await page.selectOption('#optPhysMode', 'v2');
  await page.waitForFunction(() => [...document.querySelectorAll('#courseSel option')].some((o) => o.value.startsWith('gh:')), null, { timeout: 30000 }).catch(() => {});

  const hasFollow = await page.evaluate(() => !!document.getElementById('optFollow'));
  ok(hasFollow, 'F0 追従カメラの切替 (#optFollow) がある');
  const FOLLOW = await appModule(page, 'js/config.js', (m) => m.FOLLOW);
  const VT = await appModule(page, 'js/config.js', (m) => m.VT);   // 追従 OFF での上下限 (ハードコピーしない)
  const VT_MAX_OLD = VT.max;

  // 1 フレームぶんの描画呼び出しを記録して、追従とミニマップの述語に要る量を返す。
  const measure = () => page.evaluate(async () => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    const cv = document.getElementById('course');
    const S = await import(new URL('js/state.js', location.href).href);
    const CFG = await import(new URL('js/config.js', location.href).href);
    await raf();
    window.__bb4 = [];
    await raf();
    const all = window.__bb4; window.__bb4 = null;
    const rect = cv.getBoundingClientRect();
    const kx = rect.width / cv.width, ky = rect.height / cv.height;
    const vt = all.filter((r) => r.kind === 'vt').pop() || null;
    const bodies = all.filter((r) => r.kind === 'body');
    // 対象車 = main.js が ordered で最後に描く車 (選択車を最前面へ)
    const tgt = bodies.length ? bodies[bodies.length - 1] : null;
    // 画面上の車長 [CSS px]: config の実寸 × 基準倍率 (pxPerM) × vt の倍率 × 表示縮尺 (BB3 と同じ定義)
    const F = CFG.CAR_FOOTPRINT, k = CFG.VIEW.carScale || 1;
    // 基準倍率は product の view.pxPerM そのもの (vt.wPx = view.wPx)。取れないとき (等倍のキャッシュ経路) だけ
    // canvas.width から近似する (切り捨てぶん僅かに小さい＝その標本では車長を厳密には測れない)。
    const exactFit = !!(vt && vt.wPx);
    const pxPerM = exactFit ? vt.wPx / S.course.bounds.w : cv.width / S.course.bounds.w;
    const zoom = vt ? vt.zoom : 1;
    const carLenCss = (F.front - F.back) * k * pxPerM * zoom * kx;
    // ミニマップ: strokeRect の呼び順 ① 箱の枠 → ② 表示範囲 (hud.js の注記)
    const mr = all.filter((r) => r.kind === 'rect' && r.who === 'drawMinimap' && r.call === 'strokeRect');
    let mini = null, miniRect = null, miniExp = null;
    if (mr.length >= 2) {
      const r0 = mr[0], r1 = mr[1];
      mini = { x: r0.x0 * kx - 0.5, y: r0.y0 * ky - 0.5, w: (r0.x1 - r0.x0) * kx + 1, h: (r0.y1 - r0.y0) * ky + 1 };
      miniRect = { x: r1.x0 * kx, y: r1.y0 * ky, w: (r1.x1 - r1.x0) * kx, h: (r1.y1 - r1.y0) * ky };
      // 期待値は **product の screenToWorld** でキャンバスの四隅を world へ戻し、コース bounds に対する
      // 比率で箱へ写して作る (main.js の式を写さない＝両方を同じ向きに間違えても気づける・CI-9)。
      const CRS = await import(new URL('js/course.js', location.href).href);
      const vw = { pxPerM, hM: S.course.bounds.h };
      const w0 = CRS.screenToWorld((0 - vt.panX) / vt.zoom, (0 - vt.panY) / vt.zoom, vw);
      const w1 = CRS.screenToWorld((cv.width - vt.panX) / vt.zoom, (cv.height - vt.panY) / vt.zoom, vw);
      const B = S.course.bounds;
      const fx = (wx) => wx / B.w, fy = (wy) => (B.h - wy) / B.h;   // world → 箱の比率 (y は上下反転)
      miniExp = {
        x: mini.x + fx(w0.x) * mini.w, y: mini.y + fy(w0.y) * mini.h,
        w: (fx(w1.x) - fx(w0.x)) * mini.w, h: (fy(w1.y) - fy(w0.y)) * mini.h,
      };
    }
    // N3: HUD の 3 部品 + ミニマップの箱 の外接矩形と、互いの重なり
    const parts = {};
    for (const r of all) {
      if (!['drawMeters', 'drawTireHud', 'drawFleetHud'].includes(r.who) || !(r.kind === 'text' || r.kind === 'rect')) continue;
      const b = parts[r.who] ||= { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
      b.x0 = Math.min(b.x0, r.x0 * kx); b.y0 = Math.min(b.y0, r.y0 * ky); b.x1 = Math.max(b.x1, r.x1 * kx); b.y1 = Math.max(b.y1, r.y1 * ky);
    }
    if (mini) parts.minimap = { x0: mini.x, y0: mini.y, x1: mini.x + mini.w, y1: mini.y + mini.h };
    const names = Object.keys(parts), overlaps = [];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const A = parts[names[i]], B = parts[names[j]];
      const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
      if (ox > 0.5 && oy > 0.5) overlaps.push(`${names[i]}×${names[j]}:${ox.toFixed(0)}×${oy.toFixed(0)}`);
    }
    return {
      course: S.course.name, cw: cv.width, ch: cv.height, cssW: rect.width, cssH: rect.height, kx,
      zoom, panX: vt ? vt.panX : null, panY: vt ? vt.panY : null,
      follow: !!document.getElementById('optFollow')?.checked,
      badge: document.getElementById('viewZoom')?.textContent,
      carN: bodies.length,
      carX: tgt ? tgt.cx * kx : null, carY: tgt ? tgt.cy * ky : null, glen: tgt ? tgt.glen * kx : null,
      // 内部キャンバス px のままの車中心。vt と pxPerM で world へ戻せる (枠外へ出た判定に使う)。
      carPxX: tgt ? tgt.cx : null, carPxY: tgt ? tgt.cy : null, pxPerM,
      carLenCss, exactFit, miniN: mr.length, mini, miniRect, miniExp,
      lbBottom: parts.drawFleetHud ? parts.drawFleetHud.y1 : null, partBox: parts,
      boundsW: S.course.bounds.w, boundsH: S.course.bounds.h,
      overlaps, parts: Object.keys(parts),
      spyErr: all.filter((r) => r.kind === 'spyErr').length,
    };
  });

  const setFollow = (on) => page.evaluate((want) => {
    const el = document.getElementById('optFollow');
    if (el && el.checked !== want) el.click();
    return !!el?.checked;
  }, on);
  // ボタンは無効なことがある (＋=上限・⤢=既に全体表示)。無効なら押さずに false を返す
  // (Playwright の click は無効なボタンで待ち続けるので、押せたかどうかを測定値として扱う)。
  const clickIfEnabled = (id) => page.evaluate((i) => {
    const b = document.getElementById(i);
    if (!b || b.disabled) return false;
    b.click(); return true;
  }, id);
  // キャンバス上の相対位置 (fx, fy) をドラッグする。
  // ⚠ page.mouse は **viewport 座標**へ実イベントを送るので、キャンバスが画面外へスクロールしていると
  //   別の要素 (または何も) を叩き、ドラッグが無かったことになる。#editToggle の click は要素を画面内へ
  //   スクロールさせるため、前のセルの操作で実際にずれる。掴む前に必ず画面内へ入れ、点が画面内だったかを
  //   測定値として返す (静かに何もしなかったのに「解除されなかった」と読むのを防ぐ)。
  const dragOnCanvas = async (fx, fy, button) => {
    await page.evaluate(() => document.getElementById('course').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(150);
    const q = await page.evaluate(([a2, b2]) => {
      const c = document.getElementById('course').getBoundingClientRect();
      const x = c.x + c.width * a2, y = c.y + c.height * b2;
      return { x, y, inView: x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight, top: document.elementFromPoint(x, y)?.id || '' };
    }, [fx, fy]);
    if (q.inView) {
      await page.mouse.move(q.x, q.y);
      await page.mouse.down(button ? { button } : {});
      await page.mouse.move(q.x + 25, q.y + 18, { steps: 4 });
      await page.mouse.up(button ? { button } : {});
    }
    await page.waitForTimeout(250);
    return q;   // { inView, top } … top==='course' なら本当にキャンバスを掴んだ
  };

  // 母集団: 大きいコース (投稿) + 小さいコース + 出荷で最大のプリセット
  // PRESETS の要素は「コースを組み立てる関数」(course.js の rebuildPresets)。本物に組み立てさせて面積で選ぶ。
  const biggest = await appModule(page, 'js/course.js', (m) => m.PRESETS
    .map((f) => { const p = (typeof f === 'function') ? f() : f; return { n: p.name, a: p.bounds.w * p.bounds.h }; })
    .sort((x, y) => y.a - x.a)[0].n);
  const allOpts = await page.evaluate(() => [...document.querySelectorAll('#courseSel option')].map((o) => o.value));
  const COURSES = [...new Set(['gh:racing-course', 'オーバル', biggest])].filter((v) => allOpts.includes(v));
  ok(COURSES.length === 3, `F/N 母集団: ${COURSES.length} コース (${COURSES.join('・')}) × 画面 ${SCREENS.length}`);

  for (const cv of COURSES) {
    await page.setViewportSize({ width: SCREENS[0][0], height: SCREENS[0][1] });
    await setFollow(false);
    await clickIfEnabled('viewReset');
    await page.selectOption('#courseSel', cv);
    await page.waitForTimeout(1500);
    for (const [W, H] of SCREENS) {
      await page.setViewportSize({ width: W, height: H });
      await page.waitForTimeout(700);   // resize デバウンス 200ms → setView

      // ① 既定 (追従 OFF・等倍)
      await setFollow(false);
      await clickIfEnabled('viewReset');
      await page.waitForTimeout(200);
      const base = await measure();

      // ⓪ 走らせる前に、**等倍のまま**追従 ON にして解除手段が生きているかを見る。
      //   倍率が上がらないコース (卓上コースの多くはデスクトップ幅で等倍のまま追従できる) では、
      //   「⤢ が disabled のまま」「左ドラッグが zoom>1 ガードで届かない」の両方が起きうる。
      await setFollow(true);
      await page.waitForTimeout(350);
      const unity = await measure();
      const resetState = await page.evaluate(() => ({ disabled: !!document.getElementById('viewReset')?.disabled }));
      const leftHit = await dragOnCanvas(0.2, 0.2);
      const afterLeftDrag = await measure();

      // ② 追従 ON で走らせ、標本を取る
      await setFollow(true);
      await page.click('#run');
      await page.waitForTimeout(500);
      const runSamples = [];
      for (let i = 0; i < SAMPLES; i++) { runSamples.push(await measure()); await page.waitForTimeout(SAMPLE_MS); }

      // ③ 追従 ON のまま ＋ を 2 回 (ズームでは追従が切れないこと・中央を保つこと)
      const zoomClicks = (await clickIfEnabled('viewIn')) + (await clickIfEnabled('viewIn'));
      await page.waitForTimeout(250);
      const zoomed = await measure();

      // ④ ドラッグ (パン) で追従が切れる。
      //   追従中は対象車がちょうど中央にいるので、中央を掴むと「車のドラッグ」になりパンにならない。
      //   中ボタン (どのモードでもパン=main.js の mousedown) で、車から離れた左上寄りを掴む。
      const panHit = await dragOnCanvas(0.2, 0.2, 'middle');
      const afterPan = await measure();

      // ⑤ 追従 ON に戻して「全体表示 ⤢」で切れる + 被覆クランプの復活
      await setFollow(true);
      await page.waitForTimeout(250);
      const followAgain = await measure();
      await clickIfEnabled('viewReset');
      await page.waitForTimeout(250);
      const afterReset = await measure();

      // ⑥ 追従 ON のまま編集モードへ入る → 解除され、従来の上限とクランプが戻る
      await setFollow(true);
      await page.waitForTimeout(300);
      const beforeEdit = await measure();
      await page.click('#editToggle');
      await page.waitForTimeout(400);
      const inEdit = await page.evaluate(() => ({
        editing: !document.getElementById('editorPanel').classList.contains('hidden'),
        follow: !!document.getElementById('optFollow')?.checked,
        badge: document.getElementById('viewZoom')?.textContent,
      }));
      await page.click('#editToggle');
      await page.waitForTimeout(400);
      const afterEdit = await measure();

      await clickIfEnabled('stop');   // 編集へ入った時点で enterEdit→stopAuto 済み＝既に無効なことがある
      await page.waitForTimeout(200);

      // ⑦ 追従 ON のまま「車を掴んで指を止める」。カメラが車を追い、車がカーソルを追うと正帰還になり、
      //   同じ画面位置で mousemove を繰り返すだけで車が走り続ける (BB4 層 4 で実測)。
      //   同じ 1 点で 6 回動かした時点と 12 回動かした時点の world 座標を比べ、動きが止まっていることと、
      //   コース枠の中にいることを測る。world は product の描画変換 (vt・pxPerM) から戻す。
      // ⚠ 停止中でも手動運転の積分は回り、勾配のあるコース (フルスケール競技場等) では車が転がる
      //   (BB3 の M1a と同じ罠)。利用者と同じ ▶ → ⏸ で一時停止し、絵と物理を止めてから掴む。
      await clickIfEnabled('run');
      await page.waitForTimeout(300);
      const dragPaused = await clickIfEnabled('pause');
      await setFollow(true);
      await page.waitForTimeout(350);
      const fixedMove = (n) => page.evaluate(async (k) => {
        const cv = document.getElementById('course');
        const R = cv.getBoundingClientRect();
        const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
        const ev = (type, x, y, buttons) => cv.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, buttons, bubbles: true }));
        const at = { x: R.x + R.width * 0.52, y: R.y + R.height * 0.51 };   // 中心から少しずらした固定点
        for (let i = 0; i < k; i++) { ev('mousemove', at.x, at.y, 1); await raf(); }
      }, n);
      await page.evaluate(() => {
        const cv = document.getElementById('course');
        const R = cv.getBoundingClientRect();
        cv.dispatchEvent(new MouseEvent('mousedown', { clientX: R.x + R.width / 2, clientY: R.y + R.height / 2, button: 0, buttons: 1, bubbles: true }));
      });
      await page.waitForTimeout(80);
      await fixedMove(6);
      const drag6 = await measure();
      await fixedMove(6);
      const drag12 = await measure();
      await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
      await page.waitForTimeout(200);
      await clickIfEnabled('stop');
      await page.waitForTimeout(150);

      // ⑧ テーマを変えるとミニマップの絵が焼き直るか。焼くときだけ VIEW.bg/VIEW.wall を読むので、
      //   キャッシュ署名にテーマ色が入っていないと**古い地色の板**が貼られ続ける。
      //   箱の中の画素を数え、テーマ変更後に「新しい地色があり、古い地色が無い」ことで測る。
      await setFollow(true);
      await page.waitForTimeout(300);
      const themeBox = (await measure()).mini;
      const themeProbe = themeBox ? await page.evaluate(async (box) => {
        const sel = document.getElementById('themeSel');
        if (!sel) return null;
        const cv = document.getElementById('course');
        const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
        const CFG = await import(new URL('js/config.js', location.href).href);
        const hex2rgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h.trim()); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
        // 箱は CSS px。内部キャンバス px へ戻して画素を読む。
        const R = cv.getBoundingClientRect();
        const sx = cv.width / R.width, sy = cv.height / R.height;
        const count = (rgb) => {
          if (!rgb) return -1;
          const x0 = Math.round((box.x + 2) * sx), y0 = Math.round((box.y + 2) * sy);
          const w = Math.max(1, Math.round((box.w - 4) * sx)), h = Math.max(1, Math.round((box.h - 4) * sy));
          const d = cv.getContext('2d').getImageData(x0, y0, w, h).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] === rgb[0] && d[i + 1] === rgb[1] && d[i + 2] === rgb[2]) n++;
          return n;
        };
        const was = sel.value;
        const other = [...sel.options].map((o) => o.value).find((v) => v !== was);
        if (!other) return null;
        for (let i = 0; i < 3; i++) await raf();
        const bgA = CFG.VIEW.bg, oldN = count(hex2rgb(bgA));
        sel.value = other; sel.dispatchEvent(new Event('change', { bubbles: true }));
        for (let i = 0; i < 5; i++) await raf();
        const bgB = CFG.VIEW.bg;
        const staleN = count(hex2rgb(bgA)), freshN = count(hex2rgb(bgB));
        sel.value = was; sel.dispatchEvent(new Event('change', { bubbles: true }));
        for (let i = 0; i < 5; i++) await raf();
        return { bgA, bgB, changed: bgA !== bgB, oldN, staleN, freshN };
      }, themeBox) : null;

      const ovX = await overflowX(page, W);
      cells.push({ opt: cv, W, H, base, unity, resetState, leftHit, afterLeftDrag, runSamples, zoomed, zoomClicks, panHit, afterPan, followAgain, afterReset, beforeEdit, inEdit, afterEdit, dragPaused, drag6, drag12, themeProbe, ovX });
      const s0 = runSamples[0];
      console.log(`  · ${cv.padEnd(20)} ${String(W).padStart(4)}: 既定 z=${base.zoom.toFixed(2)}/印${base.miniN} → 追従 z=${s0.zoom.toFixed(2)}・車長 ${s0.carLenCss.toFixed(1)}px(実${s0.glen?.toFixed(1)})・ミニマップ${s0.miniN ? '有' : '無'}・パン後 follow=${afterPan.follow}`);
    }
  }
  if (process.env.RC_BB4_OUT) writeFileSync(process.env.RC_BB4_OUT, JSON.stringify(cells, null, 1));

  const allRun = cells.flatMap((c) => c.runSamples.map((s) => ({ ...s, opt: c.opt, W: c.W })));
  const withZoom = [...allRun, ...cells.map((c) => ({ ...c.zoomed, opt: c.opt, W: c.W }))];

  // ── F: 追従カメラ ──
  const inCenter = (s) => {
    const mx = s.cssW * (1 - CENTER_FRAC) / 2, my = s.cssH * (1 - CENTER_FRAC) / 2;
    return s.carX != null && s.carX >= mx - EPS && s.carX <= s.cssW - mx + EPS && s.carY >= my - EPS && s.carY <= s.cssH - my + EPS;
  };
  const offc = withZoom.filter((s) => !inCenter(s));
  const worstOff = withZoom.reduce((a, s) => {
    const d = Math.max(Math.abs(s.carX - s.cssW / 2) / s.cssW, Math.abs(s.carY - s.cssH / 2) / s.cssH);
    return (!a || d > a.d) ? { d, s } : a;
  }, null);
  ok(withZoom.length > 0 && withZoom.every((s) => s.follow) && offc.length === 0,
    `F1 追従中の全標本 (${withZoom.length}) で対象車が表示領域の中央 ${CENTER_FRAC * 100}% 内 (外れ ${offc.length}・中心からの最大ずれ ${(worstOff ? worstOff.d * 100 : 0).toFixed(2)}% @ ${worstOff?.s.opt} ${worstOff?.s.W}: ${JSON.stringify(offc.slice(0, 3).map((s) => [s.opt, s.W, s.carX?.toFixed(0), s.carY?.toFixed(0), s.cssW.toFixed(0), s.cssH.toFixed(0)]))})`);
  const small = withZoom.filter((s) => s.carLenCss < FOLLOW.minCarCss - EPS);
  const minLen = Math.min(...withZoom.map((s) => s.carLenCss));
  ok(withZoom.length > 0 && small.length === 0,
    `F2 追従中の全標本で画面上の車長 ≥ ${FOLLOW.minCarCss} CSS px (最小 ${minLen.toFixed(2)}px・未達 ${small.length}: ${JSON.stringify(small.slice(0, 3).map((s) => [s.opt, s.W, s.carLenCss.toFixed(1), s.zoom.toFixed(2)]))})`);
  const glenBad = withZoom.filter((s) => s.glen == null || Math.abs(s.glen - s.carLenCss) > 1);
  ok(glenBad.length === 0, `F2b 車長の定義 (config×倍率) と実描画のグラデーション長が 1px 以内で一致 (食い違い ${glenBad.length}: ${JSON.stringify(glenBad.slice(0, 3).map((s) => [s.opt, s.W, s.carLenCss.toFixed(1), s.glen?.toFixed(1)]))})`);
  const capped = withZoom.filter((s) => s.zoom > FOLLOW.maxZoom + EPS);
  ok(capped.length === 0, `F2c 追従中の倍率が上限 ${FOLLOW.maxZoom} を超えない (超過 ${capped.length}・最大 ${Math.max(...withZoom.map((s) => s.zoom)).toFixed(2)})`);
  const needHi = allRun.filter((s) => s.zoom > VT_MAX_OLD + EPS);
  ok(needHi.length > 0, `F6 従来の上限 ${VT_MAX_OLD} では車長 ${FOLLOW.minCarCss}px に届かず、引き上げが効いたセルが実在する (${needHi.length} 標本・最大 ${Math.max(0, ...needHi.map((s) => s.zoom)).toFixed(2)}倍: ${JSON.stringify([...new Set(needHi.map((s) => `${s.opt}@${s.W}`))].slice(0, 4))})`);
  const panKept = cells.filter((c) => c.afterPan.follow);
  ok(panKept.length === 0, `F4a ドラッグ (パン) で追従が解除される (解除されなかった ${panKept.length}/${cells.length} セル)`);
  const resetKept = cells.filter((c) => c.afterReset.follow);
  ok(resetKept.length === 0, `F4b 「全体表示 ⤢」で追従が解除される (解除されなかった ${resetKept.length}/${cells.length} セル)`);
  const zoomLost = cells.filter((c) => !c.zoomed.follow);
  ok(zoomLost.length === 0, `F4c ＋ボタンでは追従が解除されない (解除された ${zoomLost.length}/${cells.length} セル)`);
  const zoomable = cells.filter((c) => c.zoomClicks > 0);
  const zoomUp = zoomable.filter((c) => c.zoomed.zoom <= c.runSamples[c.runSamples.length - 1].zoom + EPS);
  ok(zoomable.length > 0 && zoomUp.length === 0, `F5 追従中でも ＋ボタンで倍率が上がる (押せた ${zoomable.length}/${cells.length} セル・上がらなかった ${zoomUp.length}: ${JSON.stringify(zoomUp.slice(0, 3).map((c) => [c.opt, c.W, c.runSamples.at(-1).zoom.toFixed(2), c.zoomed.zoom.toFixed(2)]))})`);
  // F3: 追従 OFF (⤢ の後) は従来の上限以下・被覆クランプ (コースが画面を覆う=pan が [min(0,W(1-z)), 0])
  const offBad = cells.filter((c) => {
    const s = c.afterReset;
    const loX = Math.min(0, s.cw * (1 - s.zoom)), loY = Math.min(0, s.ch * (1 - s.zoom));
    return s.zoom > VT_MAX_OLD + EPS || s.panX < loX - 0.5 || s.panX > 0.5 || s.panY < loY - 0.5 || s.panY > 0.5;
  });
  ok(offBad.length === 0, `F3 追従 OFF では倍率 ≤ ${VT_MAX_OLD} かつ被覆クランプが効く (違反 ${offBad.length}: ${JSON.stringify(offBad.slice(0, 3).map((c) => [c.opt, c.W, c.afterReset.zoom.toFixed(2), c.afterReset.panX.toFixed(1), c.afterReset.panY.toFixed(1)]))})`);
  const editOn = cells.filter((c) => !c.inEdit.editing || c.inEdit.follow);
  ok(editOn.length === 0, `F9a 追従 ON のまま編集モードへ入ると追従が解除される (編集に入れなかった/解除されなかった ${editOn.length}/${cells.length}: ${JSON.stringify(editOn.slice(0, 3).map((c) => [c.opt, c.W, c.inEdit]))})`);
  const editZoom = cells.filter((c) => {
    const z = parseFloat(c.inEdit.badge);
    return !(z <= VT_MAX_OLD + EPS);
  });
  ok(editZoom.length === 0, `F9b 編集中の倍率が ≤ ${VT_MAX_OLD} へ戻る (違反 ${editZoom.length}: ${JSON.stringify(editZoom.slice(0, 3).map((c) => [c.opt, c.W, c.beforeEdit.badge, c.inEdit.badge]))})`);
  const editClamp = cells.filter((c) => {
    const s = c.afterEdit;
    const loX = Math.min(0, s.cw * (1 - s.zoom)), loY = Math.min(0, s.ch * (1 - s.zoom));
    return s.follow || s.zoom > VT_MAX_OLD + EPS || s.panX < loX - 0.5 || s.panX > 0.5 || s.panY < loY - 0.5 || s.panY > 0.5;
  });
  ok(editClamp.length === 0, `F9c 編集から戻ったあとも追従 OFF・倍率 ≤ ${VT_MAX_OLD}・被覆クランプが効く (違反 ${editClamp.length}: ${JSON.stringify(editClamp.slice(0, 3).map((c) => [c.opt, c.W, c.afterEdit.zoom.toFixed(2), c.afterEdit.panX.toFixed(1)]))})`);
  const editWasHi = cells.filter((c) => parseFloat(c.beforeEdit.badge) > VT_MAX_OLD + EPS);
  ok(editWasHi.length > 0, `F9d 編集へ入る前に倍率が ${VT_MAX_OLD} を超えていたセルが実在する=この検査が効いている (${editWasHi.length}/${cells.length}: ${JSON.stringify(editWasHi.slice(0, 3).map((c) => [c.opt, c.W, c.beforeEdit.badge]))})`);
  // F1b 「ちょうど中央」— 中央 40% は PLAN の受け入れ基準だが、実装の主張は「画面の中央に置く」。
  //      中心からのずれを 1 CSS px でゲートし、意図的に寄せる改変を落とす。
  const off1 = withZoom.filter((s) => Math.hypot(s.carX - s.cssW / 2, s.carY - s.cssH / 2) > 1);
  ok(off1.length === 0, `F1b 対象車の中心が画面の中心と 1 CSS px 以内 (最大 ${Math.max(0, ...withZoom.map((s) => Math.hypot(s.carX - s.cssW / 2, s.carY - s.cssH / 2))).toFixed(3)}px・違反 ${off1.length})`);
  // F2f 「必要以上に拡大しない」— 走行標本 (＋を押す前) では、倍率は自動で選んだ下限そのもの。
  //      よって車長はちょうど minCarCss か、下限が 1 倍未満で等倍のまま (車がもともと大きい) のどちらか。
  //      定数倍率へ退化させる改変 (例: 常に 16 倍) を落とす。
  const overZoom = allRun.filter((s) => s.carLenCss > FOLLOW.minCarCss + 0.5 && s.zoom > 1 + EPS);
  ok(overZoom.length === 0, `F2f 追従が選ぶ倍率は必要最小限 (車長 = ${FOLLOW.minCarCss}px ちょうど、または等倍のまま。超過 ${overZoom.length}: ${JSON.stringify(overZoom.slice(0, 3).map((s) => [s.opt, s.W, s.carLenCss.toFixed(1), s.zoom.toFixed(2)]))})`);
  const atCap = allRun.filter((s) => s.zoom >= FOLLOW.maxZoom - EPS);
  console.log(`  ℹ 上限 ${FOLLOW.maxZoom} 倍に張り付いた標本 ${atCap.length} (張り付くと車長が ${FOLLOW.minCarCss}px に届かない＝F2 が落ちる形。出荷母集団では 0 が期待)`);
  // F10 等倍のまま追従 ON にしたときも解除手段が生きている (⤢ が有効・左ドラッグで解除)
  const unityCells = cells.filter((c) => Math.abs(c.unity.zoom - 1) < EPS);
  const resetDead = unityCells.filter((c) => c.resetState.disabled);
  ok(unityCells.length > 0 && resetDead.length === 0,
    `F10a 等倍で追従 ON のセル (${unityCells.length}/${cells.length}) でも「全体表示 ⤢」が有効 (無効のまま ${resetDead.length}: ${JSON.stringify(resetDead.slice(0, 3).map((c) => [c.opt, c.W, c.unity.panX.toFixed(1)]))})`);
  const notOnCanvas = cells.filter((c) => !(c.leftHit.inView && c.leftHit.top === 'course') || !(c.panHit.inView && c.panHit.top === 'course'));
  ok(notOnCanvas.length === 0, `F10z ドラッグの掴み点が毎回キャンバスの上にあった (外れ ${notOnCanvas.length}/${cells.length}: ${JSON.stringify(notOnCanvas.slice(0, 3).map((c) => [c.opt, c.W, c.leftHit, c.panHit]))})`);
  const leftDead = cells.filter((c) => c.afterLeftDrag.follow);
  ok(leftDead.length === 0, `F10b 左ボタンのドラッグで追従が解除される (等倍を含む・解除されなかった ${leftDead.length}/${cells.length}: ${JSON.stringify(leftDead.slice(0, 3).map((c) => [c.opt, c.W, c.unity.zoom.toFixed(2)]))})`);
  // F3b パンで追従を切った直後も従来の上限へ戻る (⤢ の resetView に隠れない経路で測る)
  const panHi = cells.filter((c) => c.afterPan.zoom > VT_MAX_OLD + EPS);
  ok(panHi.length === 0, `F3b パンで追従を切った直後の倍率が ≤ ${VT_MAX_OLD} (違反 ${panHi.length}: ${JSON.stringify(panHi.slice(0, 3).map((c) => [c.opt, c.W, c.beforeEdit.badge, c.afterPan.zoom.toFixed(2)]))})`);
  // F11 追従 ON のまま車を掴んで指を止めても、車は走り続けず・コース枠の外へも出ない
  const world = (s) => ({
    x: ((s.carPxX - s.panX) / s.zoom) / s.pxPerM,
    y: s.boundsH - ((s.carPxY - s.panY) / s.zoom) / s.pxPerM,
  });
  const notPaused = cells.filter((c) => !c.dragPaused);
  ok(notPaused.length === 0, `F11z 車を掴む間は ▶→⏸ で積分を止められた (止められず ${notPaused.length}/${cells.length}・勾配のあるコースでは止めないと車が転がる)`);
  const runaway = cells.filter((c) => {
    const a = world(c.drag6), b = world(c.drag12);
    return Math.hypot(b.x - a.x, b.y - a.y) > 0.005;   // 5mm
  });
  ok(runaway.length === 0, `F11a 追従 ON で車を掴んで指を止めると車が止まる (6→12 回目の変位 ≤ 5mm・走り続けた ${runaway.length}/${cells.length}: ${JSON.stringify(runaway.slice(0, 3).map((c) => { const a = world(c.drag6), b = world(c.drag12); return [c.opt, c.W, (Math.hypot(b.x - a.x, b.y - a.y) * 1000).toFixed(1) + 'mm']; }))})`);
  const outside = cells.filter((c) => {
    const w = world(c.drag12);
    return w.x < -0.01 || w.y < -0.01 || w.x > c.drag12.boundsW + 0.01 || w.y > c.drag12.boundsH + 0.01;
  });
  ok(outside.length === 0, `F11b ドラッグした車がコース枠の中に留まる (枠外 ${outside.length}/${cells.length}: ${JSON.stringify(outside.slice(0, 3).map((c) => { const w = world(c.drag12); return [c.opt, c.W, w.x.toFixed(2), w.y.toFixed(2), c.drag12.boundsW, c.drag12.boundsH]; }))})`);
  // N5 テーマを変えたらミニマップの絵が焼き直る (キャッシュ署名にテーマ色が入っているか)
  const themed = cells.filter((c) => c.themeProbe && c.themeProbe.changed && c.themeProbe.oldN > 0);
  ok(themed.length > 0, `N5a テーマを切り替えてミニマップの箱を測れたセルが実在する (${themed.length}/${cells.length}・地色 ${JSON.stringify([...new Set(themed.map((c) => `${c.themeProbe.bgA}→${c.themeProbe.bgB}`))].slice(0, 2))})`);
  const stale = themed.filter((c) => c.themeProbe.staleN > 0);
  ok(stale.length === 0, `N5b テーマ変更後、ミニマップに**古い地色の画素が 1 つも残らない** (残った ${stale.length}: ${JSON.stringify(stale.slice(0, 3).map((c) => [c.opt, c.W, c.themeProbe.bgA, c.themeProbe.staleN]))})`);
  const notFresh = themed.filter((c) => c.themeProbe.freshN <= 0);
  ok(notFresh.length === 0, `N5c テーマ変更後、ミニマップが新しい地色で焼き直る (焼き直らない ${notFresh.length}: ${JSON.stringify(notFresh.slice(0, 3).map((c) => [c.opt, c.W, c.themeProbe.bgB, c.themeProbe.freshN]))})`);
  const titles = await appModule(page, 'js/i18n/messages.js', (m) => m.MESSAGES['opt.follow.title']);
  const pxRe = new RegExp(`(^|[^0-9])${FOLLOW.minCarCss}\\s?px`);
  ok(!!titles && pxRe.test(titles.ja) && pxRe.test(titles.en), `F7 切替の説明 (ja/en) が閾値 ${FOLLOW.minCarCss}px と一致 (ja「${titles?.ja?.slice(0, 36)}…」)`);

  // ── N: ミニマップ ──
  const baseCells = cells.map((c) => ({ ...c.base, opt: c.opt, W: c.W }));
  const leak = baseCells.filter((s) => s.miniN > 0);
  ok(baseCells.every((s) => !s.follow && Math.abs(s.zoom - 1) < EPS) && leak.length === 0,
    `N1a 既定 (追従 OFF・等倍) ではミニマップを 1 本も描かない (${baseCells.length} セル・描いた ${leak.length}: ${JSON.stringify(leak.slice(0, 3).map((s) => [s.opt, s.W, s.miniN]))})`);
  const shownCells = [...allRun, ...cells.map((c) => ({ ...c.zoomed, opt: c.opt, W: c.W }))];
  // ミニマップは HUD の 3 部品と重ならない右下の領域にしか置かない (BB-6)。**置ける標本では必ず出る**ことを
  // ゲートする。「置ける」= コースの縦横比を保ったまま長辺を MINI.min にした箱が、観測した空き領域に入る。
  //   空き縦幅 = 表示高さ − 余白 − (順位表の下端 + すき間)   … 順位表は layoutHud のどの分岐でも右寄せ
  //   空き横幅 = 表示幅   − 余白 − (左側の部品の右端 + すき間) … メーターと、順位表より下にあるタイヤ HUD
  // 空き領域は**観測した部品の外接矩形**から出す (位置ではなく寸法から＝配置が壊れて下へずれた退行を
  // 「入る」と取り違えない)。外接矩形は product が配置に使う値以上なので、空きは過小評価＝誤失敗しない。
  // 「置けない標本で描かない」は N3 (3 部品と重ならない) が既に担保するので、ここでは重ねて測らない。
  const MINI = await appModule(page, 'js/hud.js', (m) => m.MINI);
  const room = (s) => {
    const P = s.partBox, lbB = s.lbBottom ?? 0;
    // BC6: 狭い画面では HUD がコースの下の帯へ出る＝コース面に避けるべき部品が 1 つも無い。
    // そのときは四辺の余白だけが空き領域の境界になる (部品が無いのに「左端は 0」と置くと、
    // 空きを実際より広く見積もり、product が出さない標本を「入るのに出ない」と誤判定する)。
    const detached = !(P.drawMeters || P.drawTireHud || P.drawFleetHud);
    let left = MINI.pad, top = MINI.pad;
    if (!detached) {
      left = (P.drawMeters ? P.drawMeters.x1 : 0) + MINI.gap;
      if (P.drawTireHud && P.drawTireHud.y1 > lbB) left = Math.max(left, P.drawTireHud.x1 + MINI.gap);
      top = lbB + MINI.gap;
    }
    const long = Math.max(s.boundsW, s.boundsH);
    return {
      availW: s.cssW - MINI.pad - left, availH: s.cssH - MINI.pad - top,
      needW: MINI.min * s.boundsW / long, needH: MINI.min * s.boundsH / long,
    };
  };
  const canFit = (s) => { const r = room(s); return r.availW >= r.needW && r.availH >= r.needH; };
  const fits = shownCells.filter(canFit);
  const tight = shownCells.filter((s) => !canFit(s));
  const noMini = fits.filter((s) => s.miniN < 2);
  ok(fits.length > 0 && noMini.length === 0,
    `N1b 長辺 ${MINI.min}px の箱が入る標本 (${fits.length}/${shownCells.length}) では必ずミニマップが描かれる (欠け ${noMini.length}: ${JSON.stringify([...new Set(noMini.map((s) => `${s.opt}@${s.W}`))].slice(0, 4))})`);
  const inconsistent = cells.filter((c) => new Set(c.runSamples.map((s) => s.miniN > 0)).size > 1);
  ok(inconsistent.length === 0, `N1c 出す/出さないの決定がセル内の全標本で一貫 (ぶれた ${inconsistent.length} セル: ${JSON.stringify(inconsistent.slice(0, 3).map((c) => [c.opt, c.W]))})`);
  if (tight.length) console.log(`  ℹ 置けなかった標本: ${[...new Set(tight.map((s) => { const r = room(s); return `${s.opt}@${s.W}(空き ${r.availW.toFixed(0)}×${r.availH.toFixed(0)} < 要 ${r.needW.toFixed(0)}×${r.needH.toFixed(0)})`; }))].join('・')} ← 順位表の下に読める大きさの全体図が入らない (決定ログ)`);
  const rectBad = fits.filter((s) => {
    if (!s.miniRect || !s.miniExp) return true;
    return Math.max(Math.abs(s.miniRect.x - s.miniExp.x), Math.abs(s.miniRect.y - s.miniExp.y),
      Math.abs(s.miniRect.w - s.miniExp.w), Math.abs(s.miniRect.h - s.miniExp.h)) > RECT_TOL;
  });
  const worstRect = fits.reduce((a, s) => {
    if (!s.miniRect || !s.miniExp) return a;
    const d = Math.max(Math.abs(s.miniRect.x - s.miniExp.x), Math.abs(s.miniRect.y - s.miniExp.y), Math.abs(s.miniRect.w - s.miniExp.w), Math.abs(s.miniRect.h - s.miniExp.h));
    return (!a || d > a.d) ? { d, s } : a;
  }, null);
  ok(rectBad.length === 0,
    `N2 表示範囲の矩形が vt から計算した範囲と ${RECT_TOL} CSS px 以内で一致 (${fits.length} 標本・最大ずれ ${(worstRect ? worstRect.d : 0).toFixed(3)}px @ ${worstRect?.s.opt} ${worstRect?.s.W}・違反 ${rectBad.length}: ${JSON.stringify(rectBad.slice(0, 3).map((s) => [s.opt, s.W, s.miniRect, s.miniExp]))})`);
  const lap = [...baseCells, ...shownCells].filter((s) => s.overlaps.length > 0);
  ok(lap.length === 0, `N3 ミニマップがメーター・タイヤ HUD・順位表と重ならない (${baseCells.length + shownCells.length} 標本・重なり ${lap.length}: ${JSON.stringify(lap.slice(0, 3).map((s) => [s.opt, s.W, s.overlaps]))})`);
  const withMini = shownCells.filter((s) => s.parts.includes('minimap'));
  ok(withMini.length > 0, `N3b ミニマップが部品として測れた標本が実在する (${withMini.length}/${shownCells.length})`);
  const inexact = [...allRun].filter((s) => !s.exactFit);
  ok(inexact.length === 0, `F2d 全ての追従標本で基準倍率を product の view.pxPerM から取れた (取れず近似 ${inexact.length})`);

  const spy = [...baseCells, ...shownCells].filter((s) => s.spyErr > 0);
  ok(spy.length === 0, `N0 観測の記録で例外 0 (${spy.length} 標本)`);
  const ovx = cells.filter((c) => c.ovX > 0);
  ok(ovx.length === 0, `F8 横はみ出し 0 (${ovx.length} セル: ${JSON.stringify(ovx.slice(0, 3).map((c) => [c.opt, c.W, c.ovX]))})`);
  ok(errors.length === 0, `E JS/HTTP エラー 0 (${errors.length}: ${JSON.stringify(errors.slice(0, 3))}) / 想定内 ${benign.length}`);
} finally {
  await browser.close();
}
console.log(`\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗:\n  - ' + fails.join('\n  - ')); process.exit(1); }
console.log('結果: PASS');
