// BE1 — 押したままの操作が解除される 常設ゲート（実ブラウザ・hasTouch）。
//
// なぜ要るのか（2026-09-23 に改修前ツリー v8.7.0 で実測）:
//   手動運転の「押している間だけ効く」状態 `keys[...]` は、解放イベントが 1 本しか無かった（BD-8 ⑥・BD-9）。
//   ・ボタン（mFwd/mBack/mLeft/mRight）: mouseup/mouseleave/touchend だけ。**touchcancel で離れると
//     true のまま残り、指を離しても走り続ける**（PWM 80・押下 200ms: 上下は解放後 +58〜89 px 進んで壁に衝突／
//     正しく離すと惰性 0.2〜1.1 px・衝突なし。左右は後の前進が −1.58〜−1.64 / +1.09 rad 曲がる／正しく離すと 0）。
//   ・キーボード: keyup だけ。window の blur はマウスのジェスチャしか解放しないので、**矢印を押したまま
//     別タブ・別ウィンドウへ移ると同じ症状**（上下は切替中に走って衝突・左右は上と同値）。
//   ・兄弟（同じブロックで数え上げて実測）: ボタンの右クリック（mousedown はボタンを見ないので右押下でも押下に
//     なる。Linux/mac の Chrome ではネイティブメニューが mouseup を吸い contextmenu だけが届く: +66〜69 px・衝突。
//     Windows は mouseup の後に contextmenu が来るので元から残らない）。
//     マウスで押したまま実タブ切替は**改修前から起きない**（mouseleave が一緒に届く＝H3）。合成の blur だけを
//     撃つと +66 px 走って見えるが、実入力では出ない組み合わせなので不具合の根拠にしない。
//   ・ハーネスで作れず塞いでいないもの（BD-8 ②: 変異で確かめられないガードは足さない）: visibilitychange
//     （Playwright はページを常に visible に見せる）・bfcache 復元（このページは復元されず再読込＝keys も初期化）・
//     macOS の Cmd 押下中に離したキーの keyup 欠落・ペンの pointercancel・メニュー/confirm 表示中の keyup 欠落
//     （CDP の入力はメニューを素通りして keyup が届く）。
// 測り方の型（BD-8 ①: 状態が残る向きの失敗は「後から効くか」で測る）:
//   ・同じ手順を **正しく離す対照** と **取り残す経路** の 2 本で走らせ、product が決めた量（車の描画位置・
//     向き・衝突色）を比べる。基準側も product から採る（式を写さない）。
//   ・上下は「解放時点からの変位」が対照と一致し、しばらく後に静止していること。左右は操舵だけでは車が
//     動かない（変位 0 は失敗しえない）ので、**正しく離す前進パルス**を後から入れ、その間の向きの変化で測る。
//   ・**取り残しが現に起きる経路を通ったこと**を一方向の数で押さえる（touchcancel が届き touchend は来ない、
//     blur が届き keyup は来ない、contextmenu が届き mouseup は来ない）。届かなければ「一致」は空振り。
//   ・blur は合成イベントを撃たず、**本物のタブ切替**で起こす。Playwright は既定でページのフォーカスを
//     見せかける（Emulation.setFocusEmulationEnabled）ので、そのままでは実タブ切替でも blur が 0 件
//     （実測）。見せかけを切ってから切り替える。
//   ・入力デバイスの状態は同じケースの中で戻す（BD-8 ③）。
//   実行: bash run.sh check_be1_hold.mjs
import { launch, newPage, appModule, report } from './lib.mjs';

const W = 1440, H = 900;
const PWM = 80;          // 衝突まで距離を残すため低め（既定 200 では押下中に壁へ届くことがある）
const HOLD = 200;        // 押している時間 [ms]
const MIN_MOVE = 5;      // 「押している間に動いた」と言う最小量 [CSS px]（空振り検出）
const TOL_PX = 2;        // 解放後の変位の対照との一致の許容 [CSS px]。解放から観測までの遅れの間も惰性で進むので
                         // 経路ごとに揺れる（改修前の対照: タッチ 1.09・マウス 0.18 px）。不具合の信号は 57 px 超か衝突。
const TOL_HELD = 0.3;    // 押下中の変位の一致の許容（相対）。押下時間はハーネスのタイマーで決まり、フレーム刻みで
                         // 37.41 / 40.26 / 43.09 px の 3 値を取る（最大と最小の差 15.2%＝許容 15% では偶発で赤を実測）。
                         // 押下が効かなくなる退行（0 px）や半減は分けられる。
const LONG = 900;        // 陽性対照の長押し [ms]（タッチの長押し contextmenu のしきい値 約 500ms を越える）
const STEER_MIN = 0.5;   // 操舵が効いたと言う向きの変化 [rad]（改修前の取り残しで 1.09〜1.64）
const TOL_TH = 1e-6;     // 向きの一致 [rad]（対照は厳密に 0。不具合の信号は 1 rad 超）

let pass = 0, fail = 0; const fails = [];
const ok = (c, m, d = '') => { if (c) { pass++; report(m, true, d); } else { fail++; fails.push(m); report(m, false, d); } };

const browser = await launch();
try {
const { page, errors, benign } = await newPage(browser, {
  width: W, height: H, hasTouch: true,
  before: async (p) => {
    await p.addInitScript(() => {
      try { localStorage.setItem('rumicar.lang', 'ja'); localStorage.removeItem('rumicar.follow'); } catch (e) {}
      // 観測だけ: drawCar のボディグラデーション（ノーズ→テール）から車の描画位置・向き・衝突色を読む。
      window.__be1 = null;
      const P = CanvasRenderingContext2D.prototype;
      const o = P.createLinearGradient;
      P.createLinearGradient = function (x0, y0, x1, y1) {
        const g = o.call(this, x0, y0, x1, y1);
        if (window.__be1 && this.canvas && this.canvas.id === 'course'
            && (/at (draw[A-Za-z]+)/.exec(new Error().stack.split('\n').slice(2).join('\n')) || [])[1] === 'drawCar') {
          const T = this.getTransform();
          const q = (u, v) => [T.a * u + T.c * v + T.e, T.b * u + T.d * v + T.f];
          const A = q(x0, y0), B = q(x1, y1);
          const rec = { x: (A[0] + B[0]) / 2, y: (A[1] + B[1]) / 2, th: Math.atan2(A[1] - B[1], A[0] - B[0]), c0: null };
          window.__be1.push(rec);
          const ac = g.addColorStop.bind(g);
          g.addColorStop = (off, col) => { if (off === 0) rec.c0 = col; return ac(off, col); };
        }
        return g;
      };
      // イベントは**届いた先ごと**に数える（`種類@id`）。window 全体で数えると、ボタン以外に落ちた押下や
      //   要素の blur でも「経路を通った証拠」が立ってしまう（層 4 の指摘 D2/C4）。blur は window 自身だけ。
      window.__ev = {};
      const at = (e) => (e.target === window ? 'window' : (e.target && (e.target.id || e.target.nodeName)) || '?');
      for (const k of ['blur', 'focus', 'keydown', 'keyup', 'touchstart', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'mouseleave', 'contextmenu'])
        window.addEventListener(k, (e) => { if ((k === 'blur' || k === 'focus') && e.target !== window) return;
          const n = `${k}@${at(e)}`; window.__ev[n] = (window.__ev[n] || 0) + 1; }, true);
      // ⚠ mouseleave は**その要素か祖先にリスナがあるときだけ**配送される（実測: product の mouseleave を外すと
      //   window のキャプチャでも 0 件になり、「経路を通った証拠」が product のリスナの有無に依存した）。
      //   計測用のリスナをボタン自身に張り、到達を product と独立に数える（数えるだけ・既定動作は変えない）。
      document.addEventListener('DOMContentLoaded', () => {
        for (const id of ['mFwd', 'mBack', 'mLeft', 'mRight']) {
          const el = document.getElementById(id);
          if (el) el.addEventListener('mouseleave', () => { const n = `mouseleave!${id}`; window.__ev[n] = (window.__ev[n] || 0) + 1; });
        }
      });
    });
  },
});
const cdp = await page.context().newCDPSession(page);
const bcdp = await browser.newBrowserCDPSession();
const self = (await cdp.send('Target.getTargetInfo')).targetInfo;

// 選択車（product が最後に描く車）の描画位置 [CSS px]・向き・衝突色。
const pose = () => page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  await raf(); window.__be1 = []; await raf();
  const a = window.__be1; window.__be1 = null;
  const cv = document.getElementById('course'); const k = cv.getBoundingClientRect().width / cv.width;
  const b = a[a.length - 1];
  return b ? { x: b.x * k, y: b.y * k, th: b.th, crash: b.c0 === '#ffc0c0' } : null;
});
const takeEv = () => page.evaluate(() => { const e = window.__ev; window.__ev = {}; return e; });
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const dAng = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

// 出荷コースを 1 本に固定し、追従 OFF・PWM を product の UI で設定する。
let FIXED = null;
async function fresh() {
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1300);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  if (FIXED === null) FIXED = await page.evaluate(() =>
    [...document.querySelectorAll('#courseSel option')].map((o) => o.value).filter((v) => !/^(gh:|own:)/.test(v))[0] || null);
  if (FIXED) { await page.selectOption('#courseSel', FIXED); await page.waitForTimeout(700); }
  await page.evaluate((v) => {
    const f = document.getElementById('optFollow'); if (f && f.checked) f.click();
    const e = document.getElementById('pwm'); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true }));
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }, PWM);
  await page.waitForTimeout(300); await takeEv();
}
const BTN = { ArrowUp: 'mFwd', ArrowDown: 'mBack', ArrowLeft: 'mLeft', ArrowRight: 'mRight' };
async function centerOf(id) {
  await page.evaluate((i) => document.getElementById(i).scrollIntoView({ block: 'center' }), id);
  await page.waitForTimeout(150);
  return page.evaluate((i) => { const b = document.getElementById(i).getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; }, id);
}
// 本物のタブ切替: 同じウィンドウに別タブを開いて前面へ → 元のタブへ戻す（合成の blur を撃たない）。
async function tabSwitch() {
  const t = await bcdp.send('Target.createTarget', { url: 'about:blank', browserContextId: self.browserContextId, newWindow: false, background: false });
  await page.waitForTimeout(500);
  await bcdp.send('Target.activateTarget', { targetId: self.targetId });
  await bcdp.send('Target.closeTarget', { targetId: t.targetId });
  await page.waitForTimeout(200);
}
const mouse = (type, c, button, buttons) => cdp.send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button, buttons, clickCount: 1 });

// 1 ケース: 押す → 離す（release）→ 観測。how = touch | mouse | rmouse | key | keyInInput
async function runCase(key, how, release) {
  await fresh();
  const p0 = await pose();
  let c = null;
  if (how === 'touch') { c = await centerOf(BTN[key]); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [c] }); }
  else if (how === 'mouse' || how === 'rmouse') {
    c = await centerOf(BTN[key]);
    await mouse('mouseMoved', { x: c.x - 3, y: c.y }, 'none', 0); await mouse('mouseMoved', c, 'none', 0);
    await mouse('mousePressed', c, how === 'rmouse' ? 'right' : 'left', how === 'rmouse' ? 2 : 1);
  } else if (how === 'keyInInput') { await page.focus('#pwm'); await page.keyboard.down(key); }
  else await page.keyboard.down(key);
  if (release === 'posctl') {
    // 陽性対照（層 4 の指摘 D1/B1）: 操舵を押したまま長押しのしきい値（約 500ms）を越えて待ち、押したまま
    // 前進パルスを入れる → 曲がること。押下がボタンに届いていない・長押しで押下が切れる、のどちらでも赤。
    const a = await pose();
    await page.waitForTimeout(LONG);
    await page.keyboard.down('ArrowUp'); await page.waitForTimeout(500); await page.keyboard.up('ArrowUp');
    await page.waitForTimeout(300);
    const b = await pose();
    const evLong = await takeEv();
    if (how === 'touch') await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await page.keyboard.up(key);
    return { dth: dAng(a.th, b.th), pulse: dist(a, b), evLong };
  }
  await page.waitForTimeout(HOLD);
  const pHeld = await pose();
  const evPress = await takeEv();
  // 離す
  if (release === 'proper') {
    if (how === 'touch') await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else if (how === 'mouse') await mouse('mouseReleased', c, 'left', 0);
    else await page.keyboard.up(key);
  } else if (release === 'touchcancel') await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  else if (release === 'tabswitch') await tabSwitch();
  else if (release === 'leave') {
    // ボタンを押したままポインタだけボタンの外へ（mouseup は送らない）＝既存の mouseleave の経路。
    await mouse('mouseMoved', { x: c.x, y: c.y - 120 }, 'left', 1); await page.waitForTimeout(100);
  }
  // release === 'menu': 右押下で contextmenu だけが届いた状態のまま（ネイティブメニューが mouseup を吸う）
  const ev = await takeEv();
  const pRel = await pose();
  const out = { held: dist(p0, pHeld), ev, evPress };
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    await page.waitForTimeout(1500);
    const a = await pose(); await page.waitForTimeout(800); const b = await pose();
    Object.assign(out, { fromRel: dist(pRel, b), late: dist(a, b), crash: b.crash });
  } else {
    // 操舵だけでは車は動かない。正しく離す前進パルス（keydown→keyup）を入れて向きの変化で測る。
    await page.waitForTimeout(300);
    const a = await pose();
    await page.keyboard.down('ArrowUp'); await page.waitForTimeout(500); await page.keyboard.up('ArrowUp');
    await page.waitForTimeout(1500);
    const b = await pose();
    Object.assign(out, { dth: dAng(a.th, b.th), pulse: dist(a, b), crash: b.crash });
  }
  // 入力デバイスの状態を戻す（BD-8 ③）。
  if ((how === 'key' || how === 'keyInInput') && release !== 'proper') await page.keyboard.up(key);
  if ((how === 'mouse' && release !== 'proper') || how === 'rmouse') await mouse('mouseReleased', c, how === 'rmouse' ? 'right' : 'left', 0);
  if (how === 'rmouse') { await page.keyboard.press('Escape'); await page.waitForTimeout(100); }   // 開いたメニューを閉じる（D4）
  if (how === 'touch' && release === 'tabswitch') await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return out;
}
const f2 = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v));
const f4 = (v) => (typeof v === 'number' ? v.toFixed(4) : String(v));

console.log(`■ 対象 ${W}x${H} hasTouch=true ／ APP_VERSION ${await appModule(page, 'js/config.js', (m) => m.APP_VERSION)} ／ PWM ${PWM}・押下 ${HOLD}ms`);

// ── H0 前提（層 4 の指摘 D5）: 「走り続けた」の判定は衝突色（drawCar の '#ffc0c0'）と静止に乗っている。
//   v2 は法線接近速度が閾値を超えたときだけ衝突になり、遅く壁へ押し付けられると色が出ない。本ゲートが
//   測ったのは既定の dynamic なので、エンジンとコースを前提として固定する（変われば黙って通さず赤）。
{
  await fresh();
  const mode = await appModule(page, 'js/config.js', (m) => m.PHYSICS.mode);
  ok(mode === 'dynamic', 'H0-a エンジンは既定の dynamic（衝突色・静止で判定する前提）', `mode=${mode}`);
  ok(!!FIXED, 'H0-b 出荷コースを 1 本に固定できた', String(FIXED));
}

// 比較: 取り残す経路 t が対照 c と同じ結果になること（＋経路を通った証拠 via）。
function judge(id, label, key, c, t, via) {
  // 左右は操舵だけで車が動かないので -a は上下だけ（左右の空振り検出は -d の前進パルスが担う）。
  if (key === 'ArrowUp' || key === 'ArrowDown')
    ok(c.held > MIN_MOVE, `${id}-a ${label}: 押している間に車が動く（対照・空振り検出）`, `押下中 ${f2(c.held)} px`);
  ok(via.ok, `${id}-b ${label}: 取り残しの経路を通った（一方向の数）`, via.detail);
  ok(Math.abs(t.held - c.held) <= Math.max(0.5, TOL_HELD * c.held), `${id}-c ${label}: 押している間の変位は対照と一致（相対 ${TOL_HELD * 100}%）`, `対照 ${f2(c.held)} / 経路 ${f2(t.held)} px`);
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    ok(!c.crash && c.late === 0, `${id}-d ${label}: 対照は解放後に止まる（衝突なし・静止）`, `解放後 ${f4(c.fromRel)} px・静止後の変位 ${f4(c.late)}・衝突 ${c.crash}`);
    ok(!t.crash && t.late === 0 && Math.abs(t.fromRel - c.fromRel) < TOL_PX,
      `${id}-e ${label}: 解放後の変位が対照と一致し静止する（走り続けない）`,
      `経路 ${f4(t.fromRel)} px（静止後 ${f4(t.late)}・衝突 ${t.crash}） / 対照 ${f4(c.fromRel)} px`);
  } else {
    ok(c.pulse > MIN_MOVE && Math.abs(c.dth) < TOL_TH, `${id}-d ${label}: 対照の前進パルスは直進する（空振り検出）`, `移動 ${f2(c.pulse)} px・向き ${f4(c.dth)} rad`);
    ok(Math.abs(t.dth - c.dth) < TOL_TH && t.pulse > MIN_MOVE,
      `${id}-e ${label}: 後の前進が曲がらない（操舵が残っていない）`,
      `経路 向き ${f4(t.dth)} rad・移動 ${f2(t.pulse)} px / 対照 ${f4(c.dth)} rad・${f2(c.pulse)} px`);
  }
}

// ── H1 ボタンの touchcancel（4 個） ─────────────────────────────────────────────
for (const key of Object.keys(BTN)) {
  const c = await runCase(key, 'touch', 'proper'), t = await runCase(key, 'touch', 'touchcancel');
  judge(`H1-${BTN[key]}`, `${BTN[key]} を touchcancel で離す`, key, c, t,
    { ok: t.evPress[`touchstart@${BTN[key]}`] > 0 && t.ev[`touchcancel@${BTN[key]}`] > 0 && !Object.keys(t.ev).some((k) => k.startsWith('touchend@')),
      detail: `押下 ${JSON.stringify(t.evPress)} / 解放 ${JSON.stringify(t.ev)}` });
}
// ── H2 キーボードの矢印を押したまま別タブへ（本物の blur・4 個） ──────────────────
for (const key of Object.keys(BTN)) {
  const c = await runCase(key, 'key', 'proper'), t = await runCase(key, 'key', 'tabswitch');
  judge(`H2-${key}`, `${key} を押したまま別タブへ`, key, c, t,
    { ok: t.evPress['keydown@BODY'] > 0 && t.ev['blur@window'] > 0 && !Object.keys(t.ev).some((k) => k.startsWith('keyup@')),
      detail: `押下 ${JSON.stringify(t.evPress)} / 解放 ${JSON.stringify(t.ev)}` });
}
// ── H3 兄弟: マウスでボタンを押したまま別タブへ（mouseup が来ない） ──────────────────
// 改修前から**起きない**（実測: 実タブ切替では blur と一緒に mouseleave が届き、既存の mouseleave が解放する）。
// 合成の blur だけを撃つと +66 px 走り続けて見えるが、それは実入力では出ない組み合わせ。ここでは実タブ切替で
// 「mouseleave が現に届き、走り続けない」ことを固定する。⚠ ここでは blur の全解放も同時に効くので、
// **mouseleave のリスナを外しても H3 は緑のまま**（層 4 の指摘 C1/D3）。mouseleave 単独の経路は H6 が守る。
{
  const c = await runCase('ArrowUp', 'mouse', 'proper'), t = await runCase('ArrowUp', 'mouse', 'tabswitch');
  judge('H3', 'mFwd をマウスで押したまま別タブへ', 'ArrowUp', c, t,
    { ok: t.evPress['mousedown@mFwd'] > 0 && t.ev['blur@window'] > 0 && t.ev['mouseleave!mFwd'] > 0 && !Object.keys(t.ev).some((k) => k.startsWith('mouseup@')),
      detail: `押下 ${JSON.stringify(t.evPress)} / 解放 ${JSON.stringify(t.ev)}` });
}
// ── H4 兄弟: ボタンの右クリック（contextmenu だけが届き mouseup が来ない） ─────────────
// 右押下は「押している間」が 0 になりうる（contextmenu は押下直後に届く）ので、押下中の一致（-c）は測らず、
// 後から効かないこと（-e）だけを左ボタンの対照と比べる。
for (const key of ['ArrowUp', 'ArrowLeft']) {
  const c = await runCase(key, 'mouse', 'proper'), t = await runCase(key, 'rmouse', 'menu');
  const id = `H4-${BTN[key]}`, label = `${BTN[key]} を右クリック`;
  // contextmenu は押した直後に届く（押下中の区間に入る）ので、押下中と離した後の両方を数える。
  const all = {}; for (const e of [t.evPress, t.ev]) for (const [k, v] of Object.entries(e)) all[k] = (all[k] || 0) + v;
  ok(all[`mousedown@${BTN[key]}`] > 0 && all[`contextmenu@${BTN[key]}`] > 0 && !Object.keys(all).some((k) => k.startsWith('mouseup@')),
    `${id}-b ${label}: ボタンに右押下と contextmenu が届き mouseup は来ない（経路の証拠）`, JSON.stringify(all));
  ok(key === 'ArrowUp' ? (c.held > MIN_MOVE && !c.crash && c.late === 0) : (c.pulse > MIN_MOVE && Math.abs(c.dth) < TOL_TH),
    `${id}-d ${label}: 左ボタンの対照は押下が効き、離すと止まる／直進する（空振り検出）`,
    key === 'ArrowUp' ? `押下中 ${f2(c.held)} px・静止後 ${f4(c.late)}・衝突 ${c.crash}` : `移動 ${f2(c.pulse)} px・向き ${f4(c.dth)} rad`);
  if (key === 'ArrowUp') ok(!t.crash && t.late === 0 && t.fromRel <= c.fromRel + TOL_PX,
    `${id}-e ${label}: 右クリックの後に走り続けない`, `経路 解放後 ${f4(t.fromRel)} px（静止後 ${f4(t.late)}・衝突 ${t.crash}） / 左の対照 ${f4(c.fromRel)} px`);
  else ok(Math.abs(t.dth - c.dth) < TOL_TH && t.pulse > MIN_MOVE,
    `${id}-e ${label}: 右クリックの後の前進が曲がらない`, `経路 向き ${f4(t.dth)} rad・移動 ${f2(t.pulse)} px / 対照 ${f4(c.dth)} rad・${f2(c.pulse)} px`);
}
// ── H6 既存経路: マウスで押したままポインタだけボタンの外へ（mouseleave 単独で離れる） ──────────
// H3 では blur の全解放が同時に効くので mouseleave の回帰を捕まえられない。blur の無い経路で単独に固定する。
{
  const c = await runCase('ArrowUp', 'mouse', 'proper'), t = await runCase('ArrowUp', 'mouse', 'leave');
  judge('H6', 'mFwd をマウスで押したままボタンの外へ', 'ArrowUp', c, t,
    { ok: t.evPress['mousedown@mFwd'] > 0 && t.ev['mouseleave!mFwd'] > 0 && !t.ev['blur@window'] && !Object.keys(t.ev).some((k) => k.startsWith('mouseup@')),
      detail: `押下 ${JSON.stringify(t.evPress)} / 解放 ${JSON.stringify(t.ev)}` });
}
// ── H7 陽性対照: 操舵ボタン・操舵キーを長押しして、押したままの前進が曲がる（層 4 の指摘 D1/B1） ──────
// H1/H2/H4 の左右は「対照も経路も曲がらない」で緑になるので、押下が届いていない配置でも緑になりうる。
// ここで同じ入口の押下が現に操舵を効かせることを、長押しのしきい値を越える時間で確かめる
// （タッチの長押しで contextmenu が出て押下が途中で切れる退行もここで赤になる）。
for (const how of ['touch', 'key']) for (const key of ['ArrowLeft', 'ArrowRight']) {
  const r = await runCase(key, how, 'posctl');
  const id = `H7-${how}-${key}`;
  const cm = Object.keys(r.evLong).filter((k) => k.startsWith('contextmenu@'));
  ok(Math.abs(r.dth) > STEER_MIN && r.pulse > MIN_MOVE && cm.length === 0,
    `${id} ${how === 'touch' ? BTN[key] + ' を' : key + ' を'} ${LONG}ms 押したままの前進が曲がる（押下が届き長押しで切れない）`,
    `向き ${f4(r.dth)} rad・移動 ${f2(r.pulse)} px・長押し中の contextmenu ${cm.length} 件`);
}
// ── H5 入力欄にフォーカスがあるときは矢印を捕捉しない（既存の分岐を壊さない） ────────────
{
  const t = await runCase('ArrowUp', 'keyInInput', 'proper');
  ok(t.ev['keyup@pwm'] > 0, 'H5-a 入力欄で矢印を押して離した（経路の証拠）', JSON.stringify(t.ev));
  ok(t.held === 0 && t.fromRel === 0, 'H5-b 入力欄にフォーカスがあると車は動かない', `押下中 ${f4(t.held)} px・解放後 ${f4(t.fromRel)} px`);
}

console.log(`\n除外した想定内の応答: ${benign.length} 件`);
ok(errors.length === 0, 'ページ側のエラー 0 件', errors.length ? errors.slice(0, 5).join(' / ') : '0 件');
console.log(`\n${'─'.repeat(60)}\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗: ' + fails.join(' / ')); process.exitCode = 1; }
else console.log('結果: PASS (手動運転のボタン・矢印キーは touchcancel・タブ切替・右クリックで離れても走り続けない)');
} finally { await browser.close(); }
