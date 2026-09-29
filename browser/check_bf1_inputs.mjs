// BF1 — 入力の取り違え 3 件 常設ゲート（実ブラウザ・本番 UI）。
//
// なぜ要るのか（2026-09-29 に改修前ツリー v8.8.0 で実測・数値は internal 決定ログ「BF1 結果」）:
//   (a) 矢印キーの入力欄ガードが TEXTAREA/INPUT だけだった（BE1 の層 4 E4）。<select> やダイアログ内の
//       ボタンにフォーカスがあると、矢印で**背後の車が走り**、keydown が preventDefault されるので
//       **選択肢の移動・ダイアログ本文のスクロールが奪われていた**。
//   (b) 車名を `<input class="cc-name" value="${s.name}">` に未エスケープで埋めていた（BE4 の層 4 (a)）。
//       `"` や `&amp;` を含む名前は、台数の増減で列を組み直すと別の文字列に化ける。兄弟: 車種 key も
//       `<option value="${ct.key}">` に未エスケープ（各車の車種と開催の規定車の 2 か所）。投稿車種の key は他人の文字列。
//   (c) 保存名 `__proto__` は `all[name] =` が原型の setter に渡って保存されないのに「保存しました」と出た
//       （BE6 の層 4 (g)）。兄弟: 容量超過で書けなかったときも「保存しました」と出た。自作車の key
//       `constructor` 等は「組込車種と重複」という誤った理由で断られ、投稿車種の key `__proto__` は
//       車種表 CAR_TYPE_BY_KEY の原型を差し替えていた。
//
// 測り方の型:
//   ・車が走ったかは product が描いた車の位置（drawCar のボディグラデーション・check_be1_hold と同じ観測）で測る。
//     select の既定動作は値を変えて change を起こし、コース・領域・物理の変更は車を置き直すので、
//     「押している間の変位」と「キー無しで同じ値変更をした対照との終わりの位置の差」を測る（どちらも 0.00 px）。
//     値は押し戻して元へ返す。
//   ・既定動作を奪っていないことは keydown の defaultPrevented を product のリスナの**後**に張った観測で読む。
//     空振り検出として「選択肢が現に動いた」「ダイアログ本文が現に巻き上がった」ことも数える。
//   ・母集団は表示中の <select> を**全件**（≥ 5 を要求）。数え落としを防ぐため、宛先の作れない select も数える。
//   ・保存は利用者と同じ操作（✏️ → 名前 → 💾）で行い、再読込後に一覧から選んで product の state.course と
//     保存前のコースを比べる。期待する文言は配信中の t() で組む（完全一致）。
//   実行: bash run.sh check_bf1_inputs.mjs
import { launch, newPage, appModule, report } from './lib.mjs';

const W = 1440, H = 900;
const PWM = 80;          // check_be1_hold と同じ（衝突まで距離を残す）
const MIN_MOVE = 5;      // 「走った」と言う最小量 [CSS px]
const MIN_SELECTS = 5;   // 母集団の下限（受け入れ基準）

let pass = 0, fail = 0; const fails = [];
const ok = (c, m, d = '') => { if (c) { pass++; report(m, true, d); } else { fail++; fails.push(m); report(m, false, d); } };
const f2 = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v));

// 保存コースの下地（他の保存コースが壊れないことを byte で見るための 1 本）。起動前に 1 回だけ入れる。
const ring = (w, h, m) => {
  const r = (x1, y1, x2, y2) => [{ x1, y1, x2, y2: y1 }, { x1: x2, y1, x2, y2 }, { x1: x2, y1: y2, x2: x1, y2 }, { x1, y1: y2, x2: x1, y2: y1 }];
  return [...r(0, 0, w, h), ...r(m, m, w - m, h - m)];
};
const SEED = { 'BF1 既存': { name: 'BF1 既存', bounds: { w: 3, h: 2 }, start: { x: 0.35, y: 0.25, theta: 0 }, finish: { x1: 0.35, y1: 0, x2: 0.35, y2: 0.5 }, walls: ring(3, 2, 0.5) } };
// 投稿車種（上流の応答だけを差し替える）。key は他人の文字列。
const CARS = {
  'bf1-proto.json': { key: '__proto__', name: 'BF1 原型' },
  'bf1-ctor.json': { key: 'constructor', name: 'BF1 構築' },
  'bf1-quote.json': { key: 'q"x', name: 'BF1 引用' },
  'bf1-ok.json': { key: 'bf1_ok', name: 'BF1 普通' },
};
const initScript = (seed) => {
  try {
    localStorage.setItem('rumicar.lang', 'ja'); localStorage.removeItem('rumicar.follow');
    if (!localStorage.getItem('rumicar.courses')) localStorage.setItem('rumicar.courses', seed);
  } catch (e) {}
  // 観測だけ: drawCar のボディグラデーション（ノーズ→テール）から車の描画位置を読む（check_be1_hold と同じ）。
  window.__bf1 = null;
  const P = CanvasRenderingContext2D.prototype;
  const o = P.createLinearGradient;
  P.createLinearGradient = function (x0, y0, x1, y1) {
    const g = o.call(this, x0, y0, x1, y1);
    if (window.__bf1 && this.canvas && this.canvas.id === 'course'
        && (/at (draw[A-Za-z]+)/.exec(new Error().stack.split('\n').slice(2).join('\n')) || [])[1] === 'drawCar') {
      const T = this.getTransform();
      const q = (u, v) => [T.a * u + T.c * v + T.e, T.b * u + T.d * v + T.f];
      const A = q(x0, y0), B = q(x1, y1);
      window.__bf1.push({ x: (A[0] + B[0]) / 2, y: (A[1] + B[1]) / 2 });
    }
    return g;
  };
};
async function stubCars(p) {
  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await p.route('**/cars/community/index.json*', (r) => r.fulfill(json({ generated: 'check_bf1', entries: Object.keys(CARS) })));
  await p.route(/\/cars\/community\/bf1-[a-z]+\.json(?:[?#]|$)/, (r) => {
    const n = decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop());
    return r.fulfill({ status: 200, contentType: 'text/plain', body: JSON.stringify(CARS[n]) });
  });
}

const browser = await launch();
try {
const { page, errors, benign } = await newPage(browser, {
  width: W, height: H,
  before: async (p) => { await p.addInitScript(initScript, JSON.stringify(SEED)); },
});
const line = (key, params) => appModule(page, 'js/i18n.js', `(m) => m.t(${JSON.stringify(key)}, ${JSON.stringify(params || {})})`);
const logLines = async () => (await page.evaluate(() => document.getElementById('log').textContent))
  .split('\n').map((l) => l.replace(/^\[[^\]]*\]\s*/, ''));
const countLine = async (s) => (await logLines()).filter((l) => l === s).length;

// 選択車（product が最後に描く車）の描画位置 [CSS px]。
const pose = () => page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  await raf(); window.__bf1 = []; await raf();
  const a = window.__bf1; window.__bf1 = null;
  const cv = document.getElementById('course'); const k = cv.getBoundingClientRect().width / cv.width;
  const b = a[a.length - 1];
  return b ? { x: b.x * k, y: b.y * k } : null;
});
const dist = (a, b) => (a && b ? Math.hypot(b.x - a.x, b.y - a.y) : NaN);
// keydown の観測: product のリスナ（起動時に window へ張られる）より**後**に張るので、product が
//   preventDefault したかを defaultPrevented で読める。
const watchKeys = () => page.evaluate(() => {
  window.__kd = [];
  if (!window.__kdOn) { window.__kdOn = true; window.addEventListener('keydown', (e) => {
    if (e.key.startsWith('Arrow') && window.__kd) window.__kd.push({ k: e.key, dp: e.defaultPrevented, tag: document.activeElement ? document.activeElement.tagName : '' });
  }); }
});
const takeKeys = () => page.evaluate(() => { const a = window.__kd || []; window.__kd = []; return a; });

// 出荷コースを 1 本に固定し、追従 OFF・PWM を product の UI で設定する（check_be1_hold と同じ）。
let FIXED = null;
async function fresh() {
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1300);
  if (FIXED === null) FIXED = await page.evaluate(() =>
    [...document.querySelectorAll('#courseSel option')].map((o) => o.value).filter((v) => !/^(gh:|★)/.test(v))[0] || null);
  if (FIXED) { await page.selectOption('#courseSel', FIXED); await page.waitForTimeout(700); }
  await page.evaluate((v) => {
    const f = document.getElementById('optFollow'); if (f && f.checked) f.click();
    const e = document.getElementById('pwm'); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true }));
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }, PWM);
  await page.waitForTimeout(300);
  await watchKeys();
}
// 1 回の押下: 押す → 待つ → 位置 A → 待つ → 位置 B → 離す。押している間の変位 |AB| を返す。
async function hold(key, ms = 400) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  const a = await pose();
  await page.waitForTimeout(ms);
  const b = await pose();
  await page.keyboard.up(key);
  await page.waitForTimeout(300);
  return dist(a, b);
}

console.log(`■ 対象 ${W}x${H} ／ APP_VERSION ${await appModule(page, 'js/config.js', (m) => m.APP_VERSION)} ／ PWM ${PWM}`);

// ══ (a) 矢印キーの取り違え ══════════════════════════════════════════════════
console.log('\n── K0 母集団: 表示中の <select> 全件 ──');
await fresh();
ok(!!FIXED, 'K0-a 出荷コースを 1 本に固定できた', String(FIXED));
const SELECTS = await page.evaluate(() => [...document.querySelectorAll('select')]
  .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('dialog'))
  .map((el) => {
    if (el.id) return { sel: '#' + el.id, label: el.id, disabled: el.disabled };
    const col = el.closest('.carcol');
    if (col) {
      const i = [...col.parentElement.children].indexOf(col), cls = [...el.classList][0];
      return { sel: `#fleetCols > .carcol:nth-child(${i + 1}) select.${cls}`, label: `${cls}[${i}]`, disabled: el.disabled };
    }
    return { sel: null, label: el.outerHTML.slice(0, 60), disabled: el.disabled };
  }));
const addressable = SELECTS.filter((d) => d.sel && !d.disabled);
ok(SELECTS.length >= MIN_SELECTS, `K0-b 表示中の <select> ${SELECTS.length} 個（≥ ${MIN_SELECTS}）`, SELECTS.map((d) => d.label).join(', '));
ok(addressable.length === SELECTS.length, 'K0-c 全件に宛先が作れて無効化されていない（数え落とし 0）',
  SELECTS.filter((d) => !d.sel || d.disabled).map((d) => d.label).join(', ') || '0 件');

console.log('\n── K1 <select> にフォーカスして矢印を押す（全件） ──');
let movedSel = 0;
for (const d of addressable) {
  await fresh();
  const p0 = await pose();
  const st = () => page.evaluate((s) => { const el = document.querySelector(s); return el ? { v: el.value, i: el.selectedIndex, n: el.options.length } : null; }, d.sel);
  const s0 = await st();
  const order = s0.i < s0.n - 1 ? ['ArrowDown', 'ArrowUp'] : ['ArrowUp', 'ArrowDown'];
  let held = 0, lostFocus = 0; const vals = [];
  for (const key of order) {
    await page.focus(d.sel);   // change で列が作り直されてもフォーカスを同じ位置の select に戻す
    const focused = await page.evaluate((s) => document.activeElement === document.querySelector(s), d.sel);
    if (!focused) lostFocus++;
    held = Math.max(held, await hold(key));
    vals.push((await st()).v);
  }
  await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await page.waitForTimeout(300);
  const p1 = await pose();
  const kd = await takeKeys();
  const onSel = kd.filter((r) => r.tag === 'SELECT');
  const moved = vals[0] !== s0.v;
  if (moved) movedSel++;
  // 対照: 同じ値の変更をキーボードを使わずに行い (selectOption＝change)、終わった位置を比べる。select の既定動作
  //   (値の変更) は車を置き直すことがある (例: 領域を tabletop→midscale→tabletop と往復すると車体スケールが
  //   0.8→0.6 のまま戻らず 3.31 px ずれる。キー無しでも改修前後とも同じ＝矢印とは無関係)。矢印が足した変位は
  //   「キーで操作した後の位置」と「キー無しで同じ値変更をした後の位置」の差で測る (しきい値は 0.00 px のまま)。
  await fresh();
  const c0 = await pose();
  for (const v of vals) { await page.selectOption(d.sel, v); await page.waitForTimeout(1100); }
  await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await page.waitForTimeout(300);
  const c1 = await pose();
  const byKeys = dist(p1, c1);
  ok(lostFocus === 0 && onSel.length === order.length && onSel.every((r) => !r.dp) && f2(held) === '0.00' && f2(dist(p0, c0)) === '0.00' && f2(byKeys) === '0.00',
    `K1 ${d.label}: 矢印による車の変化 0.00 px（押下中・キー無しの対照との差）・keydown は既定動作を奪わない`,
    `押下中 ${f2(held)} px・対照との差 ${f2(byKeys)} px（前後 ${f2(dist(p0, p1))}・対照の前後 ${f2(dist(c0, c1))}・初期位置の差 ${f2(dist(p0, c0))}）` +
    `・keydown ${onSel.length}/${order.length} 件 defaultPrevented=${JSON.stringify(onSel.map((r) => r.dp))}` +
    `・値 ${JSON.stringify(s0.v)}→${JSON.stringify(vals)}${moved ? '（選択肢が動いた）' : ''}`);
}
ok(movedSel >= MIN_SELECTS, `K1-z 矢印で選択肢が現に動いた <select> ${movedSel} 個（≥ ${MIN_SELECTS}・既定動作が効いている証拠）`);

console.log('\n── K2 showModal で開いたダイアログの中のボタンにフォーカスして矢印を押す ──');
for (const [opener, id] of [['#helpUsage', 'dlgUsage'], ['#helpSpec', 'dlgSpec'], ['#helpCars', 'dlgCars']]) {
  await fresh();
  const p0 = await pose();
  await page.click(opener); await page.waitForTimeout(500);
  const modal = await page.evaluate((i) => document.getElementById(i).matches(':modal'), id);
  await page.focus(`#${id} .docdlg-x`);
  // 本文を巻き上げる要素（ダイアログ自身か子孫で、縦に溢れていて overflow が auto/scroll のもの）。
  const scTop = () => page.evaluate((i) => {
    const dlg = document.getElementById(i);
    const els = [dlg, ...dlg.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY));
    return els.length ? els.map((e) => e.scrollTop).reduce((a, b) => a + b, 0) : null;
  }, id);
  const t0 = await scTop();
  const hd = await hold('ArrowDown');
  const t1 = await scTop();
  const hu = await hold('ArrowUp');
  const kd = await takeKeys();
  const p1 = await pose();
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  const closed = await page.evaluate((i) => !document.getElementById(i).open, id);
  ok(modal, `K2-${id}-a ${id} は showModal で開いた（:modal）`);
  ok(kd.length === 2 && kd.every((r) => !r.dp) && f2(hd) === '0.00' && f2(hu) === '0.00' && f2(dist(p0, p1)) === '0.00',
    `K2-${id}-b ダイアログ内のボタンで矢印: 車の変化 0.00 px・既定動作を奪わない`,
    `押下中 ↓${f2(hd)}/↑${f2(hu)} px・前後 ${f2(dist(p0, p1))} px・defaultPrevented=${JSON.stringify(kd.map((r) => r.dp))}`);
  if (t0 != null) ok(t1 > t0, `K2-${id}-c 矢印↓で本文が巻き上がる（既定動作が効いている証拠）`, `scrollTop ${t0}→${t1}`);
  else console.log(`  - K2-${id}-c 本文が溢れていない（巻き上げの証拠は測らない）`);
  // ダイアログを閉じた後は、また矢印で走る（ガードが残らない）。
  const q0 = await pose();
  const hr = await hold('ArrowUp');
  const q1 = await pose();
  ok(closed && hr > 0 && dist(q0, q1) > MIN_MOVE, `K2-${id}-d 閉じた後は矢印で走る（ガードが残らない）`, `閉じた=${closed}・押下中 ${f2(hr)} px・前後 ${f2(dist(q0, q1))} px`);
}

console.log('\n── K3 回帰: フォーカスが body・canvas・ボタンのときは矢印で走る ──');
for (const where of ['body', 'canvas', 'button']) {
  await fresh();
  if (where === 'canvas') {
    const b = await page.evaluate(() => { const r = document.getElementById('course').getBoundingClientRect(); return { x: r.x + 12, y: r.y + 12 }; });
    await page.mouse.click(b.x, b.y); await page.waitForTimeout(200);
  } else if (where === 'button') await page.focus('#helpUsage');
  const ae = await page.evaluate(() => document.activeElement.tagName + (document.activeElement.id ? '#' + document.activeElement.id : ''));
  const p0 = await pose();
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(1000); await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(300);
  const p1 = await pose();
  const kd = await takeKeys();
  ok(dist(p0, p1) > MIN_MOVE && kd.length === 1 && kd[0].dp === true,
    `K3-${where} フォーカス ${ae} で ArrowUp 1 秒: 前進する（keydown は車が取る）`, `前進 ${f2(dist(p0, p1))} px・defaultPrevented=${JSON.stringify(kd.map((r) => r.dp))}`);
}

// ══ (b) 車名・車種 key のエスケープ ═════════════════════════════════════════
console.log('\n── K4 車名を入れて台数を増減する（列の組み直し） ──');
const colInfo = () => page.evaluate(() => {
  const col = document.querySelector('#fleetCols > .carcol');
  return { v: col.querySelector('.cc-name').value, n: col.querySelectorAll('*').length, cols: document.querySelectorAll('#fleetCols > .carcol').length };
});
let base = null;
for (const nm of ['ABC', 'a"b', '<b>x', '&amp;', "'q"]) {
  await fresh();
  await page.fill('#fleetCols > .carcol:nth-child(1) .cc-name', nm);
  const mark = () => page.evaluate(() => { document.querySelector('#fleetCols > .carcol .cc-name').__bf1 = 1; });
  const fresh1 = () => page.evaluate(() => !document.querySelector('#fleetCols > .carcol .cc-name').__bf1);   // 作り直された
  await mark();
  await page.evaluate(() => document.getElementById('carAdd').click()); await page.waitForTimeout(300);
  const up = { ...(await colInfo()), rebuilt: await fresh1() };
  await mark();
  await page.evaluate(() => document.querySelector('#fleetCols > .carcol:nth-child(2) .cc-del').click()); await page.waitForTimeout(300);
  const dn = { ...(await colInfo()), rebuilt: await fresh1() };
  if (base === null) base = { up, dn };   // 平易な名前（最初）が基準
  ok(up.rebuilt && dn.rebuilt && up.cols === 2 && dn.cols === 1 && up.v === nm && dn.v === nm && up.n === base.up.n && dn.n === base.dn.n,
    `K4 車名 ${JSON.stringify(nm)}: 増やしても減らしても value が入力と完全一致・列の子要素数は平易な名前と同じ`,
    `増 ${JSON.stringify(up.v)}（子 ${up.n}/${base.up.n}・${up.cols} 列・作り直し ${up.rebuilt}） 減 ${JSON.stringify(dn.v)}（子 ${dn.n}/${base.dn.n}・${dn.cols} 列・作り直し ${dn.rebuilt}）`);
}

// ══ (c) 保存名・車種 key ═══════════════════════════════════════════════════
console.log('\n── K5 保存コースの名前（✏️ → 名前 → 💾 → 再読込 → 一覧から開く） ──');
const shape = () => appModule(page, 'js/state.js', (m) => JSON.stringify({ name: m.course.name, b: m.course.bounds, s: m.course.start,
  f: m.course.finish && [m.course.finish.x1, m.course.finish.y1, m.course.finish.x2, m.course.finish.y2], w: m.course.walls }));
const savedRaw = () => page.evaluate(() => localStorage.getItem('rumicar.courses'));
const others = (raw, skip) => { const o = JSON.parse(raw || '{}'); return Object.keys(o).filter((k) => !skip.includes(k)).map((k) => k + '=' + JSON.stringify(o[k])).join('\n'); };
const NAMES = ['BF1 普通', '__proto__', 'constructor', 'toString', 'hasOwnProperty'];
for (const nm of NAMES) {
  await fresh();
  const want = JSON.parse(await shape()); want.name = nm;
  const before = await savedRaw();
  await page.click('#editToggle'); await page.waitForTimeout(300);
  await page.evaluate((n) => { document.getElementById('edName').value = n; document.getElementById('edSave').click(); }, nm);
  await page.waitForTimeout(400);
  const said = await countLine(await line('log.courseSaved', { name: nm }));
  const after = await savedRaw();
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1300);
  const opt = await page.evaluate((n) => { const o = [...document.querySelectorAll('#courseSel option')].find((x) => x.textContent === '★ ' + n); return o ? o.value : null; }, nm);
  let got = null;
  if (opt != null) {
    await page.evaluate((x) => { const s = document.getElementById('courseSel'); s.value = x; s.dispatchEvent(new Event('change')); }, opt);
    await page.waitForTimeout(400);
    got = await shape();
  }
  const same = got === JSON.stringify(want);
  // 述語: 「保存しました」を出すのは、再読込後に一覧に出て同じ形で開ける場合だけ（出さないなら理由を 1 行）。
  ok(said === 1 && opt != null && same, `K5 保存名 ${JSON.stringify(nm)}: 「保存しました」1 行 ⇒ 再読込後に一覧に出て同じ形で開ける`,
    `保存しました ${said} 行・一覧 ${opt != null ? JSON.stringify(opt) : 'なし'}・同じ形 ${same}`);
  ok(others(before, NAMES) === others(after, NAMES), `K5 保存名 ${JSON.stringify(nm)}: 他の保存コースの JSON は保存の前後で byte 一致`);
}
{
  // 兄弟: 保存容量が尽きて書けなかったときは「保存しました」を出さず、失敗の 1 行だけを出す。
  await fresh();
  const filled = await page.evaluate(() => {
    let n = 0;
    for (let size = 1 << 20; size >= 1; size >>= 1) {
      const chunk = 'x'.repeat(size);
      for (;;) { try { localStorage.setItem('rumicar.zzbf1fill' + n, chunk); n++; } catch (e) { break; } }
    }
    return n;
  });
  const nm = 'BF1 満杯';
  await page.click('#editToggle'); await page.waitForTimeout(300);
  await page.evaluate((n) => { document.getElementById('edName').value = n; document.getElementById('edSave').click(); }, nm);
  await page.waitForTimeout(400);
  const said = await countLine(await line('log.courseSaved', { name: nm }));
  const failed = await countLine(await line('store.saveFail', { what: await line('store.what.course') }));
  const stored = await page.evaluate((n) => Object.prototype.hasOwnProperty.call(JSON.parse(localStorage.getItem('rumicar.courses') || '{}'), n), nm);
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('rumicar.zzbf1fill')) localStorage.removeItem(k); });
  await page.click('#editToggle').catch(() => {});
  ok(filled > 0 && !stored && said === 0 && failed === 1, 'K5-full 容量が尽きて書けないときは「保存しました」を出さず失敗を 1 行',
    `詰め物 ${filled} 個・保存された ${stored}・保存しました ${said} 行・失敗 ${failed} 行`);
}

console.log('\n── K6 自作車の key（🚗 車種 → JSON → この車種を追加 → 再読込） ──');
const RES = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];
{
  await fresh();
  await page.click('#helpCars'); await page.waitForTimeout(400);
  const add = async (def) => {
    await page.evaluate((j) => { document.getElementById('carJsonInput').value = j; document.getElementById('carAddBtn').click(); }, JSON.stringify(def));
    await page.waitForTimeout(200);
    return page.evaluate(() => document.getElementById('carAddMsg').textContent);
  };
  for (const k of RES) {
    const msg = await add({ key: k, name: 'BF1 ' + k });
    const want = await line('cars.add.errReservedKey', { key: k });
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem('rumicar.customCars') || '[]').some((c) => c.key === key), k);
    ok(msg === want && !stored, `K6 自作車 key ${JSON.stringify(k)}: 追加せず、正しい理由を出す`, `表示 ${JSON.stringify(msg)}`);
  }
  for (const k of ['bf1_car', 'k"x']) {
    const msg = await add({ key: k, name: 'BF1 ' + k });
    ok(msg === await line('cars.add.added', { name: 'BF1 ' + k }), `K6 自作車 key ${JSON.stringify(k)}: 追加できる`, JSON.stringify(msg));
  }
  {
    // 兄弟: 保存容量が尽きて書けないときは「追加しました」を出さず、失敗を出す (再読込で消える車種を追加済みと言わない)。
    const filled = await page.evaluate(() => {
      let n = 0;
      for (let size = 1 << 20; size >= 1; size >>= 1) { const c = 'x'.repeat(size); for (;;) { try { localStorage.setItem('rumicar.zzbf1fill' + n, c); n++; } catch (e) { break; } } }
      return n;
    });
    const msg = await add({ key: 'bf1_full', name: 'BF1 満杯' });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('rumicar.customCars') || '[]').some((c) => c.key === 'bf1_full'));
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('rumicar.zzbf1fill')) localStorage.removeItem(k); });
    const want = await line('store.saveFail', { what: await line('store.what.car') });
    // 登録も戻る＝車種メニュー (各車の車種・車種表) に居残らない（一覧は localStorage から描くので食い違わない）。
    const inMenu = await page.evaluate(() => [...document.querySelectorAll('.cc-cartype option')].some((o) => o.value === 'bf1_full'));
    const inTable = await appModule(page, 'js/config.js', (m) => Object.prototype.hasOwnProperty.call(m.CAR_TYPE_BY_KEY, 'bf1_full'));
    ok(filled > 0 && !stored && msg === want && !inMenu && !inTable, 'K6-full 容量が尽きて書けないときは「追加しました」を出さず失敗を出し、登録も戻す',
      `詰め物 ${filled} 個・保存された ${stored}・メニュー ${inMenu}・車種表 ${inTable}・表示 ${JSON.stringify(msg)}`);
  }
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1300);
  const cart = await page.evaluate(() => [...document.querySelectorAll('#fleetCols > .carcol:nth-child(1) .cc-cartype option')].map((o) => o.value));
  await page.click('#eventOpen'); await page.waitForTimeout(400);
  const spec = await page.evaluate(() => [...document.querySelectorAll('#evSpecCar option')].map((o) => o.value));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  for (const k of ['bf1_car', 'k"x'])
    ok(cart.includes(k) && spec.includes(k), `K6 再読込後の自作車 ${JSON.stringify(k)}: 各車の車種・開催の規定車の選択肢の value が key と完全一致`,
      `車種 ${cart.includes(k)}・規定車 ${spec.includes(k)}`);
  // 片づけ（次の再読込に自作車を残さない）
  await page.evaluate(() => localStorage.removeItem('rumicar.customCars'));
}

console.log('\n── K7 投稿車種の key（上流の応答を差し替え・他人の文字列） ──');
{
  const b = await newPage(browser, { width: W, height: H, before: async (p) => { await p.addInitScript(initScript, JSON.stringify(SEED)); await stubCars(p); } });
  const pg = b.page;
  const loaded = await pg.waitForFunction(() => [...document.querySelectorAll('.cc-cartype option')].some((o) => o.value === 'bf1_ok'), null, { timeout: 30000 }).then(() => true, () => false);
  ok(loaded, 'K7-0 投稿車種の読み込みが起きた（普通の key が選択肢に並ぶ＝空振り検出）');
  await pg.waitForTimeout(500);
  const proto = await appModule(pg, 'js/config.js', (m) => Object.getPrototypeOf(m.CAR_TYPE_BY_KEY) === Object.prototype);
  const own = await appModule(pg, 'js/config.js', (m) => ['__proto__', 'constructor'].filter((k) => Object.prototype.hasOwnProperty.call(m.CAR_TYPE_BY_KEY, k)));
  const vals = await pg.evaluate(() => [...document.querySelectorAll('#fleetCols > .carcol:nth-child(1) .cc-cartype option')].map((o) => o.value));
  const log = (await pg.evaluate(() => document.getElementById('log').textContent));
  ok(proto && own.length === 0, 'K7-a 投稿車種 key "__proto__"・"constructor" は車種表に入らない（原型は Object.prototype のまま）', `原型 ${proto}・自分のプロパティ ${JSON.stringify(own)}`);
  ok(/bf1-proto \(reserved\)/.test(log) && /bf1-ctor \(reserved\)/.test(log), 'K7-b 入れなかった投稿車種は理由つきで告知される（reserved）');
  ok(vals.includes('q"x') && vals.includes('bf1_ok'), 'K7-c 投稿車種 key "q\\"x" の選択肢の value が key と完全一致（普通の key も並ぶ）', JSON.stringify(vals.filter((v) => /q|bf1/.test(v))));
  ok(b.errors.length === 0, 'K7-z 投稿車種ページのエラー 0 件', b.errors.slice(0, 3).join(' / ') || '0 件');
  await pg.close();
}

console.log('\n── K8 矢印を押したまま <select> へ移る（キーリピートが select に届く） ──');
// keys: 押したままにするキー（後ろほど後から押す）。キーリピートは最後に押したキーにだけ来る。
for (const held of [['ArrowUp'], ['ArrowUp', 'ArrowLeft']]) {
  await fresh();
  // 間隔は壁に届く前に測れる長さにする（改修前は押し続けると 1 秒余りで壁に当たって止まり、「止まった」が空振りする）。
  for (const k of held) await page.keyboard.down(k);
  await page.waitForTimeout(300);
  const a = await pose();
  await page.focus('#themeSel');
  const v0 = await page.evaluate(() => document.getElementById('themeSel').value);
  const last = held[held.length - 1];
  await page.keyboard.down(last);        // 押したままの 2 回目の keydown＝キーリピート (repeat: true)
  await page.waitForTimeout(250);        // 惰性が止まるまで（BE1 の実測で惰性は 0.2〜1.1 px）
  const b = await pose(); await page.waitForTimeout(300); const c = await pose();
  for (const k of held.slice().reverse()) await page.keyboard.up(k);
  await page.waitForTimeout(200);
  const kd = await takeKeys();
  const rep = kd.filter((r) => r.tag === 'SELECT');
  await page.evaluate((v) => { const s = document.getElementById('themeSel'); if (s.value !== v) { s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); } }, v0);
  ok(dist(a, b) > 0 && rep.length === 1 && !rep[0].dp && f2(dist(b, c)) === '0.00',
    `K8 body で ${held.join('+')} を押したまま select へ移ると、キーリピートで車は止まり（走り続けない）既定動作も奪わない`,
    `移る前後 ${f2(dist(a, b))} px・止まった後の 300ms ${f2(dist(b, c))} px・select の keydown ${rep.length} 件 defaultPrevented=${JSON.stringify(rep.map((r) => r.dp))}`);
}

console.log('\n── K9 共有 URL に原型の名前（他人が送れるリンク） ──');
for (const [k, v] of [['car', 'constructor'], ['p', 'constructor'], ['rg', 'toString'], ['car', '__proto__']]) {
  const b = await newPage(browser, { width: W, height: H, path: `#v=1&${k}=${v}`, before: async (p) => { await p.addInitScript(initScript, JSON.stringify(SEED)); } });
  const st = await b.page.evaluate(() => ({ cart: document.querySelector('.cc-cartype').value, prog: document.querySelector('.cc-program').value, rg: document.getElementById('regimeSel').value }));
  ok(b.errors.length === 0 && st.cart !== '' && st.prog !== '' && st.rg !== '', `K9 #${k}=${v}: 例外 0 件・車種/プログラム/領域の選択が空にならない`,
    `${b.errors.slice(0, 2).join(' / ') || '例外 0 件'}・車種 ${JSON.stringify(st.cart)}・プログラム ${JSON.stringify(st.prog)}・領域 ${JSON.stringify(st.rg)}`);
  await b.page.close();
}

console.log('\n── K10 取込等で localStorage に入った自作車の key が原型の名前（起動時の登録） ──');
{
  const b = await newPage(browser, { width: W, height: H, before: async (p) => { await p.addInitScript(() => {
    try { localStorage.setItem('rumicar.lang', 'ja');
      if (!sessionStorage.getItem('bf1k10')) { sessionStorage.setItem('bf1k10', '1');
        localStorage.setItem('rumicar.customCars', JSON.stringify([{ key: '__proto__', name: 'BF1 原型' }, { key: 'toString', name: 'BF1 文字' }, { key: 'bf1_k10', name: 'BF1 普通' }])); } } catch (e) {}
  }); } });
  const proto = await appModule(b.page, 'js/config.js', (m) => Object.getPrototypeOf(m.CAR_TYPE_BY_KEY) === Object.prototype);
  const own = await appModule(b.page, 'js/config.js', (m) => ['__proto__', 'toString', 'bf1_k10'].filter((k) => Object.prototype.hasOwnProperty.call(m.CAR_TYPE_BY_KEY, k)));
  ok(proto && JSON.stringify(own) === '["bf1_k10"]' && b.errors.length === 0, 'K10 起動時の登録でも原型の名前は車種表に入らない（普通の key は入る）',
    `原型 ${proto}・自分のプロパティ ${JSON.stringify(own)}・例外 ${b.errors.length} 件`);
  await b.page.close();
}

console.log(`\n除外した想定内の応答: ${benign.length} 件`);
ok(errors.length === 0, 'ページ側のエラー 0 件', errors.length ? errors.slice(0, 5).join(' / ') : '0 件');
console.log(`\n${'─'.repeat(60)}\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗: ' + fails.join(' / ')); process.exitCode = 1; }
else console.log('結果: PASS (select/ダイアログで矢印が車を動かさない・車名と車種 key が化けない・保存できない名前で「保存しました」と出ない)');
} finally { await browser.close(); }
