// BC5 — タッチ端末のキャンバス操作 常設ゲート（実ブラウザ・hasTouch）。
//
// なぜ要るのか（2026-09-19 に実装前に実測した現況）:
//   タッチでは canvas に **mouse 系が 1 件も届かない**（mousedown/mousemove/mouseup/click すべて 0 件）。
//   ブラウザは 2 回目の pointermove あたりでジェスチャをページのスクロールへ持って行き pointercancel を
//   出す。∴ v8.5.0 では ①パン ②追従解除 ③車のドラッグ ④エディタの描画 のすべてがタッチで届いておらず、
//   しかも**どの常設ゲートもマウスでしか操作していなかったので全部緑のまま**だった。
//
// 検証の型（BC-5 / BC-6 の教訓を織り込む）:
//   ・**同一スペック並置**: 同じ初期状態を 2 回作り、片方をマウス、片方をタッチで**同じ座標列**を
//     なぞり、product が決めた量（pan・車の描画位置・壁の本数）が一致することを要求する。
//     「自分が設定した値を読み返す」形にしない（BC-4）。
//   ・**空振り禁止**: 「一致」だけでは両方 0 でも緑になる。変化量が 0 でないことを別に数で要求する（BC-5 ⑤）。
//   ・**ケースごとに初期状態を作り直す**。1 ページで続けて操作すると前のケースが車を動かし、次のケースの
//     「空白のつもりの点」が車の上になる（本ゲートを書く過程で実際に踏んだ）。
//   ・vt(zoom/pan) と車の描画位置は **product の描画呼び出しを計装して読む**（check_bb4_follow.mjs と同じ型。
//     式を写さない＝両方を同じ向きに間違えても気づける）。
//   ・**タップも母集団に入れる**（T6）。編集の既定モード `wall` は「掴まない＝互換 click に委ねる」設計で、
//     実測でもタッチのタップには mousedown/mouseup/click が届く。ドラッグだけを測っていると、
//     `touch-action:none` へ寄せる等で**最も使われる編集モードを壊しても全緑のまま**になる。
//   ・**併用端末の割込も母集団に入れる（T7・BD3）**。マウスとタッチは互いの番人だが、BC5 では
//     「マウス→タッチ」だけを塞いでいて、**タップの互換 mouse がマウスのジェスチャを横取りする**
//     逆向きが残っていた。T1〜T6 は片方の入力しか使わないので、この経路は全緑のまま通り抜ける。
//   ・T5 は逆向きの基準: **掴むものが無いジェスチャではページのスクロールを奪わないこと**。
//     これが無いと「canvas に touch-action:none を敷く」だけで T1〜T4 を緑にでき、
//     指でページを送れなくなる退行を検出できない。
//
//   実行: bash run.sh check_bc5_touch.mjs
import { launch, newPage, appModule, report } from './lib.mjs';

const W = 390, H = 844;          // スマホ幅（タッチ端末の実勢）
const DRAG = { dx: 44, dy: 33, steps: 8 };
const EPS = 1e-6;                // 並置比較の許容（基準を緩めるためではなく浮動小数の丸め用）
const MIN_MOVE = 2;              // 「動いた」と言うのに要る最小量 [内部 canvas px]
const MIN_MOVE_CSS = 2;          // 同上 [CSS px]。**内部 px と混ぜない**（k<1 なので同じ定数でも意味が違う・BC-8 ①）
// 空白点が車から離れているべき距離は **product の掴み半径から導く**。
// main.js:pointInCar の近傍フォールバックは `Math.hypot(...) < 0.22` ＝ **メートル**なので、
// CSS px の定数で代用すると小さいコース (pxPerM が大きい) で足りなくなる（単位の違う代理量）。
const GRAB_M = 0.22;            // main.js pointInCar の近傍フォールバック半径 [m]
const CLEAR_MIN = 40;           // それでも最低限とる距離 [CSS px]

let pass = 0, fail = 0; const fails = [];
const ok = (c, m, d = '') => { if (c) { pass++; report(m, true, d); } else { fail++; fails.push(m); report(m, false, d); } };

const browser = await launch();
try {
const { page, errors, benign } = await newPage(browser, {
  width: W, height: H, hasTouch: true,
  before: async (p) => {
    await p.addInitScript(() => {
      try { localStorage.setItem('rumicar.lang', 'ja'); } catch (e) {}
      try { localStorage.removeItem('rumicar.follow'); } catch (e) {}
      // 観測だけ: #course への描画呼び出しを記録し、描画は product に任せる（BB3/BB4 と同じ計装）。
      window.__bc5 = null;
      const P = CanvasRenderingContext2D.prototype;
      const whoOf = () => (/at (draw[A-Za-z]+)/.exec(new Error().stack.split('\n').slice(3).join('\n')) || [])[1] || '?';
      const on = (c) => window.__bc5 && c.canvas && c.canvas.id === 'course';
      const wrap = (name, fn) => { const o = P[name]; P[name] = function (...a) {
        if (on(this)) { try { fn.call(this, this.getTransform(), whoOf(), ...a); } catch (e) { window.__bc5.push({ kind: 'spyErr', e: String(e) }); } }
        return o.apply(this, a); }; };
      const VT_WHO = ['drawCourse', 'drawCourseLayer'];
      wrap('drawImage', function (T, who) { if (who === 'drawCourse') window.__bc5.push({ kind: 'vt', zoom: T.a, panX: T.e, panY: T.f }); });
      wrap('fillRect', function (T, who) { if (VT_WHO.includes(who)) window.__bc5.push({ kind: 'vt', zoom: T.a, panX: T.e, panY: T.f }); });
      wrap('createLinearGradient', function (T, who, x0, y0, x1, y1) {
        if (who !== 'drawCar') return;
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const q = (u, v) => [T.a * u + T.c * v + T.e, T.b * u + T.d * v + T.f];
        const A = q(x0, y0), B = q(x1, y1);
        window.__bc5.push({ kind: 'body', cx: T.a * mx + T.c * my + T.e, cy: T.b * mx + T.d * my + T.f,
                            glen: Math.hypot(B[0] - A[0], B[1] - A[1]) });
      });
      // 生のイベント到達数。多くは「なぜ効かないか」を素性つきで残すためだが、
      // **T1-e と T6-e は合否に使う**（横取りされていないこと／タップに互換 mouse が届くこと）。
      window.__ev = {};
      for (const k of ['touchstart','touchmove','touchend','touchcancel','pointerdown','pointermove','pointerup','pointercancel','mousedown','mousemove','mouseup','click','contextmenu'])
        document.addEventListener(k, () => { window.__ev[k] = (window.__ev[k] || 0) + 1; }, true);
      // BD3: mouse 系の**素性**を数える。互換 mouse (タッチ由来) は sourceCapabilities.firesTouchEvents=true、
      // 実マウスは false（2026-09-20 実測）。product の見分けはこの属性 1 つに乗っているので、
      // **属性がこの環境で現に使えること**を前提として測る（使えなければ T7 は空振りになる・BD-2 ⑤）。
      window.__prov = { compat: 0, real: 0, noSC: 0 };
      for (const k of ['mousedown','mousemove','mouseup','click'])
        document.addEventListener(k, (e) => {
          const sc = e.sourceCapabilities;
          if (!sc) window.__prov.noSC++; else if (sc.firesTouchEvents) window.__prov.compat++; else window.__prov.real++;
        }, true);
    });
  },
});
const cdp = await page.context().newCDPSession(page);

// ---- 観測 -------------------------------------------------------------------
const snap = () => page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  await raf(); window.__bc5 = []; await raf();
  const all = window.__bc5; window.__bc5 = null;
  const cv = document.getElementById('course');
  const r = cv.getBoundingClientRect();
  const vt = all.filter((a) => a.kind === 'vt').pop() || null;
  const bodies = all.filter((a) => a.kind === 'body');
  const S = await import(new URL('js/state.js', location.href).href);
  const wallsN = S.course.walls.length, boundsW = S.course.bounds.w;
  return {
    vt, bodies, wallsN, boundsW,
    follow: !!document.getElementById('optFollow')?.checked,
    scrollY: window.scrollY,
    rect: { x: r.x, y: r.y, w: r.width, h: r.height }, cw: cv.width, ch: cv.height,
    spyErr: all.filter((a) => a.kind === 'spyErr').length,
  };
});
const takeEv = () => page.evaluate(() => { const e = window.__ev; window.__ev = {}; return e; });
const takeProv = () => page.evaluate(() => { const p = window.__prov; window.__prov = { compat: 0, real: 0, noSC: 0 }; return p; });

// 内部 canvas px → クライアント座標（整数へ丸める＝マウスとタッチへ**同じ**座標列を渡すため）。
const toClient = (s, cx, cy) => ({
  x: Math.round(s.rect.x + cx * (s.rect.w / s.cw)),
  y: Math.round(s.rect.y + cy * (s.rect.h / s.ch)),
});
// 掴み判定に入らないと言える距離 [CSS px]。product の値から導く:
//   近傍フォールバック GRAB_M [m] を画面へ写した長さ（pxPerM は product の描画から逆算）と、
//   車体矩形の実長 glen（矩形内でも掴めるため）の大きい方に余裕を掛ける。
const clearance = (s) => {
  const pxPerM = s.cw / s.boundsW;                       // 等倍の基準倍率（内部 canvas px / m）
  const k = s.rect.w / s.cw;                             // 内部 px → CSS px
  const zoom = s.vt ? s.vt.zoom : 1;
  const grabCss = GRAB_M * pxPerM * zoom * k;
  const glenCss = Math.max(0, ...s.bodies.map((b) => (b.glen || 0) * k));
  return Math.max(CLEAR_MIN, 2.5 * grabCss, 1.5 * glenCss);
};
// 車から clearance 以上離れたキャンバス上の点を n 個。足りなければ null（黙って近い点を使わない）。
const blankPoints = (s, n = 1) => {
  const need = clearance(s);
  const cand = [[0.5, 0.18], [0.18, 0.5], [0.82, 0.5], [0.5, 0.82], [0.18, 0.18], [0.82, 0.82], [0.5, 0.5]];
  const out = [];
  for (const [fx, fy] of cand) {
    const x = s.rect.x + s.rect.w * fx, y = s.rect.y + s.rect.h * fy;
    let minD = Infinity;
    for (const b of s.bodies) { const c = toClient(s, b.cx, b.cy); minD = Math.min(minD, Math.hypot(c.x - x, c.y - y)); }
    if (minD >= need) out.push({ x: Math.round(x), y: Math.round(y), minD, need });
    if (out.length >= n) return n === 1 ? out[0] : out;
  }
  return null;
};
const blankPoint = (s) => blankPoints(s, 1);

// ---- 入力（マウスとタッチへ **同一の座標列** を送る） -------------------------
const path = (x, y) => Array.from({ length: DRAG.steps }, (_, i) =>
  ({ x: Math.round(x + DRAG.dx * (i + 1) / DRAG.steps), y: Math.round(y + DRAG.dy * (i + 1) / DRAG.steps) }));
async function dragTouch(x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (const q of path(x, y)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [q] }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(350);
}
async function dragMouse(x, y) {
  await page.mouse.move(x, y); await page.mouse.down();
  for (const q of path(x, y)) { await page.mouse.move(q.x, q.y); await page.waitForTimeout(16); }
  await page.mouse.up();
  await page.waitForTimeout(350);
}
// BD3: タッチのタップ 1 回（実タッチ入力）。押して離すだけ＝互換 mouse が出る経路（BC-8 ③）。
async function tapTouch(x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
}
// BD3: マウスのドラッグ。tapPt を渡すと**途中で 1 回タップを割り込ませる**（同じ座標列・同じ手数のまま）。
async function dragMouseTap(x, y, tapPt) {
  await page.mouse.move(x, y); await page.mouse.down();
  const pts = path(x, y);
  for (let i = 0; i < pts.length; i++) {
    await page.mouse.move(pts[i].x, pts[i].y); await page.waitForTimeout(16);
    if (tapPt && i === Math.floor(pts.length / 2)) await tapTouch(tapPt.x, tapPt.y);
  }
  await page.mouse.up();
  await page.waitForTimeout(350);
}

// ---- 初期状態を作り直す ------------------------------------------------------
// 出荷コースを 1 本に固定し（投稿コースの取得に左右されない）、指定の準備を通す。
let FIXED_COURSE = null;
async function fresh(prep) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1300);
  await page.evaluate(() => window.scrollTo(0, 0));
  if (FIXED_COURSE === null) {
    FIXED_COURSE = await page.evaluate(() =>
      [...document.querySelectorAll('#courseSel option')].map((o) => o.value).filter((v) => !/^(gh:|own:)/.test(v))[0] || null);
  }
  if (FIXED_COURSE) { await page.selectOption('#courseSel', FIXED_COURSE); await page.waitForTimeout(700); }
  if (prep) await prep();
  await page.waitForTimeout(300);
  await takeEv(); await takeProv();
  return snap();
}
const zoomIn = (n) => page.evaluate((k) => { for (let i = 0; i < k; i++) { const b = document.getElementById('viewIn'); if (b && !b.disabled) b.click(); } }, n);
const setFollow = (on) => page.evaluate((w) => { const e = document.getElementById('optFollow'); if (e && e.checked !== w) e.click(); }, on);
const enterEditDraw = () => page.evaluate(() => {
  document.getElementById('editToggle').click();
  const r = document.querySelector('input[name=emode][value=draw]');
  if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
});

// 同じ初期状態を 2 回作り、片方をマウス・片方をタッチで同じ座標列をなぞって、前後の観測を返す。
async function bothWays(prep, pick, after) {
  const out = {};
  for (const how of ['mouse', 'touch']) {
    const s0 = await fresh(prep);
    const p = pick(s0);
    if (!p) { out[how] = { skip: true, s0 }; continue; }
    await (how === 'mouse' ? dragMouse : dragTouch)(p.x, p.y);
    const ev = await takeEv();
    if (after) await after();   // ドラッグの結果を product 自身に確定させる手順 (✔適用 等)
    out[how] = { s0, s1: await snap(), ev, p };
  }
  return out;
}

console.log(`■ 対象 ${W}x${H} hasTouch=true ／ APP_VERSION ${await appModule(page, 'js/config.js', (m) => m.APP_VERSION)}`);

// ── T0 前提 ------------------------------------------------------------------
{
  const s = await fresh(null);
  ok(!!s.vt, 'T0-a vt(zoom/pan) を product の描画から読めている', s.vt ? `zoom=${s.vt.zoom.toFixed(3)}` : '取得不可');
  ok(s.bodies.length > 0, 'T0-b 車が描かれている（車ドラッグの母集団がある）', `${s.bodies.length} 台`);
  ok(s.spyErr === 0, 'T0-c 計装の例外 0 件', `${s.spyErr} 件`);
  ok(!!FIXED_COURSE, 'T0-d 出荷コースを 1 本に固定できた', String(FIXED_COURSE));
}

// ── T1 パン（拡大中・空白点） -------------------------------------------------
{
  const r = await bothWays(async () => { await setFollow(false); await zoomIn(3); }, blankPoint);
  const d = (o) => o.skip ? null : { x: o.s1.vt.panX - o.s0.vt.panX, y: o.s1.vt.panY - o.s0.vt.panY };
  const dm = d(r.mouse), dt = d(r.touch);
  ok(!!dm && !!dt, 'T1-a 車から離れた空白点を取れた', dm && dt ? `車まで ${r.touch.p.minD.toFixed(0)}px` : '空白点なし＝検証不能');
  if (dm && dt) {
    ok(Math.hypot(dm.x, dm.y) > MIN_MOVE, 'T1-b マウスでパンが動く（空振り検出）', `Δ=(${dm.x.toFixed(2)}, ${dm.y.toFixed(2)})`);
    ok(Math.hypot(dt.x, dt.y) > MIN_MOVE, 'T1-c タッチでパンが動く', `Δ=(${dt.x.toFixed(2)}, ${dt.y.toFixed(2)})`);
    ok(Math.abs(dt.x - dm.x) < EPS && Math.abs(dt.y - dm.y) < EPS, 'T1-d タッチのパン量がマウスと一致',
      `touch-mouse=(${(dt.x - dm.x).toExponential(1)}, ${(dt.y - dm.y).toExponential(1)})`);
    // `!(undefined > 0)` は true なので、計装が死んで空の {} でも緑になってしまう。
    // 「イベントが現に届いている」ことを同じ判定で要求して片側の弱さを塞ぐ。
    ok((r.touch.ev.pointerdown > 0) && !(r.touch.ev.pointercancel > 0),
      'T1-e ジェスチャがスクロールへ横取りされない（pointerdown>0 かつ pointercancel 0）', JSON.stringify(r.touch.ev));
  }
}

// ── T2 追従解除（追従 ON・空白点） --------------------------------------------
{
  const r = await bothWays(async () => { await setFollow(true); }, blankPoint);
  if (!r.mouse.skip && !r.touch.skip) {
    ok(r.mouse.s0.follow && r.touch.s0.follow, 'T2-a 操作前は追従 ON（母集団の確認）',
      `mouse=${r.mouse.s0.follow} touch=${r.touch.s0.follow}`);
    ok(r.mouse.s1.follow === false, 'T2-b マウスのドラッグで追従が解除される（既存挙動）');
    ok(r.touch.s1.follow === false, 'T2-c タッチのドラッグで追従が解除される');
  } else ok(false, 'T2 空白点なし＝検証不能');
}

// ── T3 車のドラッグ（等倍・追従 OFF・車の中心） --------------------------------
{
  // 対象車 = product が最後に描く車（＝選択車。BB4 と同じ定義）。その描画中心を掴む。
  const pickCar = (s) => { const b = s.bodies[s.bodies.length - 1]; return b ? toClient(s, b.cx, b.cy) : null; };
  const r = await bothWays(async () => { await setFollow(false); }, pickCar);
  const d = (o) => {
    if (o.skip) return null;
    const a = o.s0.bodies[o.s0.bodies.length - 1], b = o.s1.bodies[o.s1.bodies.length - 1];
    return (a && b) ? { x: b.cx - a.cx, y: b.cy - a.cy } : null;
  };
  const dm = d(r.mouse), dt = d(r.touch);
  ok(!!dm && !!dt, 'T3-a 対象車の描画位置を前後で取れた');
  if (dm && dt) {
    ok(Math.hypot(dm.x, dm.y) > MIN_MOVE, 'T3-b マウスで車が動く（空振り検出）', `Δ=(${dm.x.toFixed(2)}, ${dm.y.toFixed(2)})`);
    ok(Math.hypot(dt.x, dt.y) > MIN_MOVE, 'T3-c タッチで車が動く', `Δ=(${dt.x.toFixed(2)}, ${dt.y.toFixed(2)})`);
    ok(Math.abs(dt.x - dm.x) < 1 && Math.abs(dt.y - dm.y) < 1, 'T3-d タッチの移動量がマウスと一致（1px 未満）',
      `touch-mouse=(${(dt.x - dm.x).toFixed(3)}, ${(dt.y - dm.y).toFixed(3)})`);
  }
}

// ── T4 エディタの描画（連続描画モード） ----------------------------------------
// ⚠ 壁の本数は **state.js の course** で数える。エディタは `new CourseEditor(course)` で
//   **深いコピー**を持ち (course_editor.js:56)、`#edApply` (applyEdit) が loadCourse で
//   確定させるまで state 側は 1 本も増えない。本ゲートを書く過程で、確定させずに数えて
//   「マウスでもタッチでも +0 本」という**対象の取り違え**を実際に踏んだ (BC-4 の型)。
//   ∴ 本番フローどおり ✔適用まで通してから数える (CI-8)。
{
  const r = await bothWays(enterEditDraw, blankPoint,
    () => page.evaluate(() => document.getElementById('edApply').click()).then(() => page.waitForTimeout(600)));
  const d = (o) => o.skip ? null : o.s1.wallsN - o.s0.wallsN;
  const dm = d(r.mouse), dt = d(r.touch);
  ok(dm !== null && dt !== null, 'T4-a 描画の始点を取れた');
  if (dm !== null && dt !== null) {
    ok(dm > 0, 'T4-b マウスのドラッグで壁が増える（空振り検出）', `+${dm} 本`);
    ok(dt > 0, 'T4-c タッチのドラッグで壁が増える', `+${dt} 本`);
    ok(dt === dm, 'T4-d 増えた本数がマウスと一致', `touch=+${dt} / mouse=+${dm}`);
  }
}

// ── T6 タップで置く編集モード（既定 = wall）がタッチで動く --------------------------
// ドラッグと違い、タップでは互換 mouse イベントが届く（実測）。BC5 は「掴んだときだけ preventDefault」
// なので**この経路を奪っていない**はずだが、奪う実装（touch-action:none 等）へ寄せても T1〜T5 は
// 全緑のままなので、ここで別に固定する。既定モードは index.html の checked 属性が決める。
{
  const res = {};
  for (const how of ['mouse', 'touch']) {
    const s0 = await fresh(() => page.evaluate(() => document.getElementById('editToggle').click()));
    const mode = await page.evaluate(() => document.querySelector('input[name=emode]:checked')?.value);
    const pts = blankPoints(s0, 2);
    if (!pts) { res[how] = { skip: true, mode }; continue; }
    for (const q of pts) {
      if (how === 'mouse') { await page.mouse.move(q.x, q.y); await page.mouse.down(); await page.mouse.up(); }
      else {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: q.x, y: q.y }] });
        await page.waitForTimeout(60);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      await page.waitForTimeout(250);
    }
    const ev = await takeEv();
    await page.evaluate(() => document.getElementById('edApply').click());
    await page.waitForTimeout(600);
    res[how] = { mode, d: (await snap()).wallsN - s0.wallsN, ev, pts };
  }
  ok(!res.mouse.skip && !res.touch.skip, 'T6-a 車から離れた 2 点を取れた');
  if (!res.mouse.skip && !res.touch.skip) {
    ok(res.touch.mode === 'wall', 'T6-b 既定の編集モードは wall（母集団の確認）', String(res.touch.mode));
    ok(res.mouse.d > 0, 'T6-c マウスの 2 クリックで壁が増える（空振り検出）', `+${res.mouse.d} 本`);
    ok(res.touch.d > 0, 'T6-d タッチの 2 タップで壁が増える', `+${res.touch.d} 本`);
    ok(res.touch.d === res.mouse.d, 'T6-e 増えた本数がマウスと一致', `touch=+${res.touch.d} / mouse=+${res.mouse.d}`);
    ok(res.touch.ev.click > 0 && res.touch.ev.mousedown > 0,
      'T6-f タップでは互換 mouse イベントが届いている（この経路を奪っていない）', JSON.stringify(res.touch.ev));
  }
}

// ── T5 掴むものが無いときはページのスクロールを奪わない -------------------------
// （等倍・追従 OFF・非編集・空白点 ＝ product が何も掴まない状態）
{
  const s0 = await fresh(async () => { await setFollow(false); });
  const p = blankPoint(s0);
  if (!p) ok(false, 'T5 空白点なし＝検証不能');
  else {
    ok(Math.abs(s0.vt.zoom - 1) < 1e-9 && !s0.follow, 'T5-a 等倍・追従 OFF（掴むものが無い条件）', `zoom=${s0.vt.zoom.toFixed(3)}`);
    const canScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    // 上方向へ払う＝ページを下へ送る。
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
    for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y - 12 * i }] }); await page.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(500);
    const s1 = await snap();
    ok(canScroll > 50, 'T5-b ページに送る余地がある（母集団の確認）', `${canScroll}px`);
    ok(s1.scrollY > s0.scrollY, 'T5-c 指でページを送れる（キャンバスがジェスチャを奪わない）', `scrollY ${s0.scrollY} → ${s1.scrollY}`);
    // ⚠ ここで「pan が動かないこと」を測ってはならない — **原理的に失敗しえない**。
    //   clampPan (main.js:127-134) は zoom=1 で loX=min(0, w*(1-1))=0 となり
    //   panX = max(0, min(0, panX)) = 0 に固定する。追従 OFF なら pan を書く非 clamp 経路も無い。
    //   ∴ キャンバスがジェスチャを奪ってパンしたとしても Δ は 0 で、合否を分けられない（実測で確認）。
    //   代わりに「何も掴んでいないこと」を、車の描画位置が動いていないことで測る（これは失敗しうる）。
    const moved = s0.bodies.length && s1.bodies.length
      ? Math.hypot(s1.bodies[s1.bodies.length - 1].cx - s0.bodies[s0.bodies.length - 1].cx,
                   s1.bodies[s1.bodies.length - 1].cy - s0.bodies[s0.bodies.length - 1].cy) : NaN;
    ok(Number.isFinite(moved) && moved < MIN_MOVE, 'T5-d このとき車を掴んでいない（車が動かない）',
      Number.isFinite(moved) ? `Δ=${moved.toFixed(2)}px（車まで ${p.minD.toFixed(0)}px / 要 ${p.need.toFixed(0)}px）` : '車を取得できず');
  }
}

// ── T7 マウスのジェスチャ中にタッチのタップが割り込んでも飛ばない（BD3） -------------
// なぜ要るか（2026-09-20 に改修前ツリーで実測）: タップの**互換 mouse**（sourceCapabilities.firesTouchEvents
//   = true）が panLast を押下点から**タップ点へ掴み直し**、続く互換 mouseup が panning を落としていた。
//   パン: 基準 -40.00 → 割込 +80.00 ＝ **差 120.00 CSS px**／車ドラッグ: 基準 (123.80, 80.16) →
//   割込 (-336.38, -215.26)／エディタの連続描画: 基準 +8 本 → 割込 **+0 本**（ストロークごと消える）。
//   **BC5 前の HEAD と同値＝既存の不具合**で、射程はタッチとマウスを併用できる端末。
// 測り方の型:
//   ・**同一手順を割込なし／割込ありの 2 本**走らせ、product が決めた量（pan・車の描画位置）を比べる。
//     「割込ありが割込なしと一致する」を基準にすると、**基準側も product から採る**ので式を写さない。
//   ・単位は **CSS px**（内部 canvas px は実行ごとに解像度が変わる・BC-8 ①）。倍率は zoom>1（BC-8 ②：
//     等倍では clampPan が pan を 0 に固定するので、パンの差を測る検査が原理的に失敗しえなくなる）。
//   ・**割込が現に届いたこと**を一方向の数で押さえる（BD-2 ④）。タップが canvas に落ちず素通りしても
//     「一致」は真になるので、互換 mouse の到達数が 0 でないことを同じ判定で要求する。
//   ・product の見分けが乗っている属性が**この環境で現に使えること**も前提として測る（T7-a）。
{
  // (1) パン（拡大中・空白点）: 割込なし → 割込あり の順に、同じ座標列で 2 本。
  const runPan = async (withTap) => {
    const s0 = await fresh(async () => { await setFollow(false); await zoomIn(3); });
    const pts = blankPoints(s0, 2);
    if (!pts || pts.length < 2) return null;
    await dragMouseTap(pts[0].x, pts[0].y, withTap ? pts[1] : null);
    const s1 = await snap(); const k = s0.rect.w / s0.cw;   // 内部 canvas px → CSS px
    return { dx: (s1.vt.panX - s0.vt.panX) * k, dy: (s1.vt.panY - s0.vt.panY) * k,
             prov: await takeProv(), zoom: s0.vt.zoom, k, sx: pts[0].x, sy: pts[0].y, follow: s0.follow };
  };
  const base = await runPan(false), itr = await runPan(true);
  ok(!!base && !!itr, 'T7-x パンの割込なし／ありを 2 本とも実行できた（空白点 2 点）');
  if (base && itr) {
    ok(itr.prov.compat > 0 && itr.prov.real > 0,
      'T7-a 互換 mouse と実マウスを素性で見分けられる環境である（前提の測定）',
      `割込あり: 互換 ${itr.prov.compat} 件 / 実マウス ${itr.prov.real} 件 / 属性なし ${itr.prov.noSC} 件`);
    ok(base.prov.compat === 0, 'T7-b 割込なしでは互換 mouse が 1 件も出ていない（対照の純度）', `互換 ${base.prov.compat} 件`);
    ok(base.zoom > 1 + 1e-9 && Math.abs(itr.zoom - base.zoom) < 1e-9,
      'T7-c 2 本とも同じ倍率で拡大中に測っている（等倍では pan の差が原理的に出ない・BC-8 ②）',
      `base zoom=${base.zoom.toFixed(3)} / itr zoom=${itr.zoom.toFixed(3)}`);
    // **対照が同じ初期状態から始まったこと**を測る（別々の reload で作るので、押下点・CSS 換算係数・
    // 追従の状態が食い違うと「一致」の比較そのものが成り立たない。黙って通さない）。
    ok(base.sx === itr.sx && base.sy === itr.sy && Math.abs(base.k - itr.k) < 1e-12
       && base.follow === false && itr.follow === false,
      'T7-w 2 本が同じ初期状態から始まっている（押下点・CSS換算・追従）',
      `押下点 base=(${base.sx},${base.sy}) itr=(${itr.sx},${itr.sy}) / k base=${base.k.toFixed(4)} itr=${itr.k.toFixed(4)} / follow ${base.follow}/${itr.follow}`);
    ok(Math.hypot(base.dx, base.dy) > MIN_MOVE_CSS, 'T7-d 割込なしでパンが動く（空振り検出）',
      `Δ=(${base.dx.toFixed(2)}, ${base.dy.toFixed(2)}) CSS px`);
    // クランプ飽和の除外: pan が上下限に張り付くと base も itr も同値になり、やはり失敗しえない検査になる。
    // 入力どおりに動いた（＝張り付いていない）ことを product の pan で確かめる。
    ok(Math.abs(base.dx - DRAG.dx) < 0.5 && Math.abs(base.dy - DRAG.dy) < 0.5,
      'T7-v pan がクランプに張り付いていない（入力量どおり動いた）',
      `入力=(${DRAG.dx}, ${DRAG.dy}) / pan=(${base.dx.toFixed(2)}, ${base.dy.toFixed(2)}) CSS px`);
    ok(Math.abs(itr.dx - base.dx) < EPS && Math.abs(itr.dy - base.dy) < EPS,
      'T7-e タップが割り込んでもパン量が割込なしと一致（BD3 の本体）',
      `割込=(${itr.dx.toFixed(2)}, ${itr.dy.toFixed(2)}) / 基準=(${base.dx.toFixed(2)}, ${base.dy.toFixed(2)}) CSS px ／ 差=${(itr.dx - base.dx).toFixed(2)}`);
  }
  // (2) 車のドラッグ（等倍・追従 OFF）: 同じ割込を掛けても掴んでいる車が飛ばない。
  const runCar = async (withTap) => {
    const s0 = await fresh(async () => { await setFollow(false); });
    const b = s0.bodies[s0.bodies.length - 1];
    // ⚠ blankPoints(s, 1) は**配列ではなく点そのもの**を返す (n===1 ? out[0] : out)。
    //   blank[0] と書くと undefined ＝ タップを 1 回も撃たないまま「一致」が真になる
    //   （T7-f の一方向カウントが実際にこの空振りを捕まえた・BD-2 ④）。単数は blankPoint を使う。
    const blank = blankPoint(s0);
    if (!b || !blank) return null;
    const p = toClient(s0, b.cx, b.cy);
    await dragMouseTap(p.x, p.y, withTap ? blank : null);
    const s1 = await snap();
    const a = s0.bodies[s0.bodies.length - 1], c = s1.bodies[s1.bodies.length - 1];
    if (!a || !c) return null;
    return { dx: c.cx - a.cx, dy: c.cy - a.cy, prov: await takeProv(), sx: p.x, sy: p.y, x0: a.cx, y0: a.cy };
  };
  const cb = await runCar(false), ci = await runCar(true);
  ok(!!cb && !!ci, 'T7-y 車ドラッグの割込なし／ありを 2 本とも実行できた');
  if (cb && ci) {
    ok(ci.prov.compat > 0, 'T7-f 車ドラッグ中にも割込が現に届いている（経路を通った証拠）', `互換 ${ci.prov.compat} 件`);
    ok(cb.sx === ci.sx && cb.sy === ci.sy && Math.abs(cb.x0 - ci.x0) < 1 && Math.abs(cb.y0 - ci.y0) < 1,
      'T7-z 2 本が同じ車・同じ掴み点から始まっている（1px 閾値の比較が成り立つ前提）',
      `掴み点 base=(${cb.sx},${cb.sy}) itr=(${ci.sx},${ci.sy}) / 初期位置差=(${(ci.x0 - cb.x0).toFixed(2)}, ${(ci.y0 - cb.y0).toFixed(2)}) 内部px`);
    ok(Math.hypot(cb.dx, cb.dy) > MIN_MOVE, 'T7-g 割込なしで車が動く（空振り検出）', `Δ=(${cb.dx.toFixed(2)}, ${cb.dy.toFixed(2)}) 内部px`);
    ok(Math.abs(ci.dx - cb.dx) < 1 && Math.abs(ci.dy - cb.dy) < 1,
      'T7-h タップが割り込んでも車の移動量が割込なしと一致（1px 未満・兄弟）',
      `割込=(${ci.dx.toFixed(2)}, ${ci.dy.toFixed(2)}) / 基準=(${cb.dx.toFixed(2)}, ${cb.dy.toFixed(2)})`);
  }
  // (3) エディタの連続描画（edDrawing は panning/dragSlot とは別の第 3 の状態・onCanvasUp の分岐も別）。
  //     改修前はストロークが**丸ごと消えて +0 本**になっていたので、被害が最大の経路として母集団に入れる。
  const runDraw = async (withTap) => {
    const s0 = await fresh(enterEditDraw);
    const pts = blankPoints(s0, 2);
    if (!pts || pts.length < 2) return null;
    await dragMouseTap(pts[0].x, pts[0].y, withTap ? pts[1] : null);
    await page.evaluate(() => document.getElementById('edApply').click());   // 本番フローで確定（BC5 T4 と同じ）
    await page.waitForTimeout(700);
    return { d: (await snap()).wallsN - s0.wallsN, prov: await takeProv(), sx: pts[0].x, sy: pts[0].y };
  };
  const db = await runDraw(false), di = await runDraw(true);
  ok(!!db && !!di, 'T7-u エディタ連続描画の割込なし／ありを 2 本とも実行できた');
  if (db && di) {
    ok(db.sx === di.sx && db.sy === di.sy, 'T7-i 2 本が同じ始点から描いている', `base=(${db.sx},${db.sy}) itr=(${di.sx},${di.sy})`);
    ok(di.prov.compat > 0, 'T7-j 描画中にも割込が現に届いている（経路を通った証拠）', `互換 ${di.prov.compat} 件`);
    ok(db.d > 0, 'T7-k 割込なしで壁が増える（空振り検出）', `+${db.d} 本`);
    ok(di.d === db.d, 'T7-l タップが割り込んでも増えた本数が割込なしと一致（兄弟）', `割込=+${di.d} / 基準=+${db.d} 本`);
  }
}

// ── T8/T9 マウスのジェスチャが取り残されてもタッチが死なない（BD3 の層 4 で自分が作り込んだ退行） ──
// なぜ要るか: BD3 の見分けは「マウスがジェスチャを持っている間、互換 mouse を落とす」形だが、
//   落としすぎると **mouseDragging が true のまま残り、touchstart が恒久的に return してタッチが死ぬ**。
//   初版（2026-09-20）で実際に 2 通り作り込み、どちらも改修前ツリーでは起きなかった:
//   T8 純タッチ端末: touchstart では掴まなかったタップが、互換 mousedown の時点では掴む状態
//      （指を置いたまま拡大した等）になると、その互換 mouseup まで落として解放が消えていた。
//      実測: 後続のタッチパン 0.00 CSS px（改修前ツリー 40.00）。
//   T9 実マウスの mouseup 取りこぼし（ウィンドウ外で離す・タブ切替）: 改修前は「タップの互換 mousedown が
//      mouseDragging を計算し直す」ことで偶然復帰していた。実測: 取りこぼし後のタッチ 2 タップで
//      壁 +0 本（改修前ツリー +1 本）。
// どちらも**状態が残る向き**の失敗なので、「一致」ではなく **後からタッチが効くか**で測る。
{
  // --- T8: 指を置いたまま product の拡大ボタンで掴む条件を成立させ、離してから普通にタッチでパンする。
  const s0 = await fresh(async () => { await setFollow(false); });
  const p = blankPoint(s0);
  if (!p) ok(false, 'T8 空白点なし＝検証不能');
  else {
    ok(Math.abs(s0.vt.zoom - 1) < 1e-9, 'T8-a 等倍から始める（この時点では何も掴まない）', `zoom=${s0.vt.zoom.toFixed(3)}`);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
    await page.waitForTimeout(150);
    await zoomIn(3);                                   // 指を置いたまま倍率を上げる（product の操作）
    await page.waitForTimeout(300);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
    const s1 = await snap();
    const prov = await takeProv();
    ok(s1.vt.zoom > 1 + 1e-9, 'T8-b 指を置いたまま拡大できた（再現経路を通った）', `zoom=${s1.vt.zoom.toFixed(3)}`);
    ok(prov.compat > 0, 'T8-c このタップで互換 mouse が現に出ている（掴まなかった＝譲った証拠）', `互換 ${prov.compat} 件`);
    const before = await snap();
    await dragTouch(p.x, p.y);
    const after = await snap(); const k = before.rect.w / before.cw;
    const d = { x: (after.vt.panX - before.vt.panX) * k, y: (after.vt.panY - before.vt.panY) * k };
    ok(Math.hypot(d.x, d.y) > MIN_MOVE_CSS, 'T8-d その後もタッチでパンできる（タッチが死んでいない）',
      `Δ=(${d.x.toFixed(2)}, ${d.y.toFixed(2)}) CSS px`);
  }
}
{
  // --- T9: 実マウスの mouseup を取りこぼした状態を CDP の実入力で作る（mouseReleased を送らず、
  //     ボタン無しの mouseMoved だけを届ける＝「ウィンドウの外で離して戻ってきた」）。その後タッチで壁を置く。
  const s0 = await fresh(async () => { await setFollow(false); await zoomIn(3); });
  const pts = blankPoints(s0, 3);
  if (!pts || pts.length < 3) ok(false, 'T9 空白点 3 点を取れず＝検証不能');
  else {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[0].x, y: pts[0].y, button: 'none', buttons: 0 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0].x, y: pts[0].y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[0].x + 10, y: pts[0].y + 8, button: 'left', buttons: 1 });
    await page.waitForTimeout(150);
    const sHeld = await snap(); const k = s0.rect.w / s0.cw;
    ok(Math.hypot((sHeld.vt.panX - s0.vt.panX) * k, (sHeld.vt.panY - s0.vt.panY) * k) > MIN_MOVE_CSS,
      'T9-a 実マウスがジェスチャを掴んでいる（母集団の確認）',
      `Δ=(${((sHeld.vt.panX - s0.vt.panX) * k).toFixed(2)}, ${((sHeld.vt.panY - s0.vt.panY) * k).toFixed(2)}) CSS px`);
    // mouseReleased を送らない＝取りこぼし。ボタン無しの実マウス移動だけを届ける。
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[0].x + 30, y: pts[0].y + 20, button: 'none', buttons: 0 });
    await page.waitForTimeout(200);
    // ⚠ 判定は **タッチのパン**（touchstart 経路）で行う。詰まりで実際に塞がるのは
    //   `if (mouseDragging) return;` の touchstart であって、タップの点置きは click 経路で生き残る
    //   （初版はタップで測っていたため、解放を外す変異でも緑のままだった＝空振りを実測して直した）。
    const before = await snap();
    await dragTouch(pts[1].x, pts[1].y);
    const after = await snap();
    const d = { x: (after.vt.panX - before.vt.panX) * k, y: (after.vt.panY - before.vt.panY) * k };
    ok(Math.hypot(d.x, d.y) > MIN_MOVE_CSS, 'T9-b mouseup 取りこぼしの後もタッチでパンできる（復帰できている）',
      `Δ=(${d.x.toFixed(2)}, ${d.y.toFixed(2)}) CSS px`);
    // ⚠ **入力デバイスの状態を戻す**。取りこぼしは page 側に作るのが目的で、CDP に押しっぱなしの
    //   ボタンを残すと後続ブロックの page.mouse.move が届かなくなる（実測で T10 の母集団が空振りした）。
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pts[0].x + 30, y: pts[0].y + 20, button: 'left', buttons: 0, clickCount: 1 });
    await page.waitForTimeout(150);
  }
}

{
  // --- T10: 右クリックで掴むと（onCanvasDown はボタンを見ない）ネイティブメニューが mouseup を吸う。
  //     実測（2026-09-20）: 右押下後 cursor='grabbing' のまま contextmenu だけが届く。改修前はタップの
  //     互換 mousedown が偶然 mouseDragging を計算し直して復帰していた（壁 +1 本）が、初版の BD3 では
  //     +0 本＝タッチが死んだ。contextmenu を「そのジェスチャが終わった証拠」として扱うことで塞いだ。
  // ⚠ 掴むのは**等倍**で行う。拡大してから車を掴もうとすると、その車が canvas の矩形の外へ出ていて
  //   マウスのイベントが 1 件も届かないことがある（実測で母集団が空振りした）。倍率は掴んだあとに
  //   product の拡大ボタン（マウス不要）で上げる。
  const s0 = await fresh(async () => { await setFollow(false); });
  const b = s0.bodies[s0.bodies.length - 1];
  const p0 = b ? toClient(s0, b.cx, b.cy) : null;
  const inRect = p0 && p0.x > s0.rect.x + 4 && p0.x < s0.rect.x + s0.rect.w - 4
                    && p0.y > s0.rect.y + 4 && p0.y < s0.rect.y + s0.rect.h - 4;
  if (!b || !inRect) ok(false, 'T10 掴める車が canvas の矩形内に無い＝検証不能', JSON.stringify({ p0, rect: s0.rect }));
  else {
    const p = p0;
    // ⚠ hover も**このブロックと同じ CDP セッション**から送る。先行ブロックでタッチや CDP のマウスを
    //   撃ったあとでは page.mouse.move が canvas に 1 件も届かないことを実測した（hover 到達 {} ＝空振り）。
    //   同じ座標への move は発火しないので、位置を変えてから本命の点へ動かす。
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x - 6, y: p.y - 6, button: 'none', buttons: 0 });
    await page.waitForTimeout(80);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 });
    await page.waitForTimeout(150);
    // 「掴める点か」はホバーの cursor で測る（product の出力）。**押下後の cursor で測ってはならない** —
    //   contextmenu で解放する実装では、読めるころには既に 'default' へ戻っている（実測で一度赤にした）。
    const hover = await page.evaluate(() => document.getElementById('course').style.cursor);
    const hoverEv = await takeEv();
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'right', buttons: 2, clickCount: 1 });
    await page.waitForTimeout(250);
    const ev = await takeEv();
    ok(hover === 'grab' && hoverEv.mousemove > 0, 'T10-a 押下点は product が掴める点である（母集団の確認）',
      `hover cursor=${hover || '(未設定)'} / hover 到達 ${JSON.stringify(hoverEv)}`);
    ok(ev.contextmenu > 0 && !(ev.mouseup > 0), 'T10-b メニューが出て mouseup が来ない（再現経路を通った）', JSON.stringify(ev));
    // 掴んだまま product の拡大ボタンで倍率を上げ（マウス不要）、タッチのパンで測る
    //   （T9 と同じ理由で touchstart 経路を使う。等倍では clampPan が pan を 0 に固定する・BC-8 ②）。
    await zoomIn(3); await page.waitForTimeout(400);
    const sz = await snap();
    const bp = blankPoints(sz, 1);
    if (!bp) { ok(false, 'T10 拡大後に空白点を取れず＝検証不能'); }
    else {
    ok(sz.vt.zoom > 1 + 1e-9, 'T10-b2 掴んだまま拡大できた（タッチのパンが測れる倍率）', `zoom=${sz.vt.zoom.toFixed(3)}`);
    const before = await snap();
    await dragTouch(bp.x, bp.y);
    const after = await snap(); const k = before.rect.w / before.cw;
    const d = { x: (after.vt.panX - before.vt.panX) * k, y: (after.vt.panY - before.vt.panY) * k };
    ok(Math.hypot(d.x, d.y) > MIN_MOVE_CSS, 'T10-c 右クリックで掴んだままでもタッチでパンできる（復帰できている）',
      `Δ=(${d.x.toFixed(2)}, ${d.y.toFixed(2)}) CSS px`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'right', buttons: 0, clickCount: 1 });
    }
  }
}

console.log(`\n除外した想定内の応答: ${benign.length} 件`);
ok(errors.length === 0, `ページ側のエラー 0 件`, errors.length ? errors.slice(0, 5).join(' / ') : '0 件');
console.log(`\n${'─'.repeat(60)}\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗: ' + fails.join(' / ')); process.exitCode = 1; }
else console.log('結果: PASS (タッチでのパン・追従解除・車ドラッグ・エディタ描画が届き、掴まないジェスチャはページへ譲る。\n        併用端末でタップが割り込んでもマウスのジェスチャが飛ばず、マウスのジェスチャが取り残されてもタッチが死なない)');
} finally { await browser.close(); }
