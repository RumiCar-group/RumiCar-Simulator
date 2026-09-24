// check_be2_practicekey.mjs — BE2「練習ベストを『コース名』でなく『コースの形』で引く」の実ブラウザ検証
// ════════════════════════════════════════════════════════════════════════════
// 何を測るか:
//   v8.7.0 までの練習ベストは `rumicar.practice.<コース名>::<車種>` で引かれていた（BD-3(a)）。
//   ∴ **保存コースの壁だけを編集して同じ名前で ✔適用すると、別レイアウトのベストが HUD の BEST に出た**
//   （改修前ツリーで再現 2026-09-24: オーバルの写しで 1 周 00:13.60 → 隅に壁を 1 本足して ✔適用 → HUD が 00:13.60 を描いた）。
//   本ゲートは利用者と同じ UI 操作だけでその経路を通す（CI-8）:
//     ① 保存コースを選んで ▶ で 1 周（記録は product が書く）→ ② 壁を 1 本引いて同名で ✔適用
//     → ③ 元に戻して ✔適用（形が同じなら記録が戻る）→ ④ 別名で保存して選ぶ（改名しても記録は残る）
//     → ⑤ 再読込して選び直す（指紋が再読込を跨いで同じ）→ ⑥ v8.7.0 形式の旧記録の扱い
//
// 【判定の物差し（CI-14）】知覚「別のコースのベストが出る」を、**HUD が実際に描いた文字列**へ翻訳する:
//   `CanvasRenderingContext2D.prototype.fillText` に計測用の記録を挟み（描画はそのまま通す）、操作後に
//   描かれた `mm:ss.cc` 形式の文字列の集合を採る。HUD の順位表は BEST 欄にだけこの形式を描く（`hud.js`
//   `drawFleetHud`・現在ラップは描かない）ので、集合＝BEST 欄の表示。**陽性対照**として ① の直後に
//   記録そのものが描かれていることを先に確かめる（計測が空振りしていれば ② の「出ない」は無意味）。
//
// 【⑥ だけ localStorage に書く理由】v8.7.0 の product はもう無いので、旧形式の記録は現行の product が ① で
//   書いた値（`cond` ごと）を凍結した旧キーの書式 `rumicar.practice.<名前>::<車種>` へ置いて作る。
//   治具のコースはオーバルの壁・スタート・フィニッシュを写したものなので、その値の `cond.courseHash` は
//   出荷コース「オーバル」と一致する（＝出荷コースの旧記録として正当に採られる条件を満たす）。
import { launch, newPage, appModule, setLang } from './lib.mjs';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };

const NAME = 'BE2 形テスト', RENAMED = 'BE2 形テスト（改名）', PRESET = 'オーバル', OLD_VER = 'v8.6.0';
const EDIT = [[0.05, 0.05], [0.10, 0.05]];   // コースの外の隅（オーバルの壁は x,y ≥ 0.18）に 1 本
const HOOK = () => {
  const orig = CanvasRenderingContext2D.prototype.fillText;
  window.__ft = new Set();
  CanvasRenderingContext2D.prototype.fillText = function (txt, ...r) {
    try { window.__ft.add(String(txt)); } catch (e) { /* 計測のみ */ }
    return orig.call(this, txt, ...r);
  };
};

/** 描画をいったん空にして、しばらく描かせてから描かれた文字列を採る。 */
async function drawn(page, ms = 1200) {
  await page.evaluate(() => window.__ft.clear());
  await page.waitForTimeout(ms);
  return page.evaluate(() => [...window.__ft]);
}
const times = (arr) => arr.filter((s) => /^(\d\d:\d\d\.\d\d|--:--\.--)$/.test(s));
const liveCourse = (page) => appModule(page, 'js/state.js', (m) => ({ name: m.course.name, walls: m.course.walls.length }));

async function clickWorld(page, X, Y) {
  const pt = await page.evaluate(async ([x, y]) => {
    const st = await import(new URL('js/state.js', location.href).href);
    const cv = document.getElementById('course'); cv.scrollIntoView({ block: 'center' });
    const r = cv.getBoundingClientRect(); const s = cv.width / st.course.bounds.w;
    return { x: r.left + x * s * r.width / cv.width, y: r.top + (st.course.bounds.h - y) * s * r.height / cv.height };
  }, [X, Y]);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(150);
}
async function selectCourse(page, name) {
  await page.selectOption('#courseSel', name);
  await page.waitForTimeout(1500);
}

const browser = await launch();
try {
  const { page, errors, benign } = await newPage(browser, { before: (p) => p.addInitScript(HOOK) });
  await setLang(page, 'ja');

  // ── 治具: 出荷コース「オーバル」の壁・枠・スタート・フィニッシュを写した保存コース（保存コースは実在の機能）──
  const fx = await page.evaluate(async ([name, preset]) => {
    const co = await import(new URL('js/course.js', location.href).href);
    const c = co.presetByName(preset);
    return { name, bounds: c.bounds, start: c.start, finish: c.finish, walls: c.walls };
  }, [NAME, PRESET]);
  await page.evaluate((c) => {
    const all = JSON.parse(localStorage.getItem('rumicar.courses') || '{}');
    all[c.name] = c; localStorage.setItem('rumicar.courses', JSON.stringify(all));
  }, fx);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await setLang(page, 'ja');

  console.log('\n【① 走ってベストを作る】保存コースを選び ▶ で 1 周（記録は product の lap.js が書く）');
  await selectCourse(page, NAME);
  const car = await page.evaluate(() => document.querySelector('.cc-cartype, select[id^="ct"]')?.value);
  const rec = () => page.evaluate(async (ct) => {
    const [m, st] = await Promise.all([import(new URL('js/lap.js', location.href).href), import(new URL('js/state.js', location.href).href)]);
    return m.loadBestRec(st.course, ct);
  }, car);
  ok((await rec()) === null, `① 走る前は記録なし（車種 ${car}）`);
  await page.click('#run');
  const t0 = Date.now(); let r1 = null;
  while (Date.now() - t0 < 120000) { await page.waitForTimeout(1000); r1 = await rec(); if (r1) break; }
  await page.click('#stop');
  await page.waitForTimeout(600);
  ok(!!(r1 && r1.t > 0), `① 1 周して記録ができた（t=${r1 && r1.t}・${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  const T = await page.evaluate(async (t) => (await import(new URL('js/lap.js', location.href).href)).fmtTime(t).slice(0, 8), r1 ? r1.t : 0);
  const keys1 = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('rumicar.practice')));
  ok(keys1.length === 1 && keys1[0].startsWith('rumicar.practiceShape.'),
    `① 記録は形の鍵に 1 件だけ書かれた（${JSON.stringify(keys1)}）＝名前の鍵には書かない`);
  const d1 = times(await drawn(page));
  ok(d1.includes(T), `① 陽性対照: HUD の BEST にその記録 ${T} が描かれている（描かれた時刻 ${JSON.stringify(d1)}）`);

  console.log('\n【② 本件】壁を 1 本引いて、名前を変えずに ✔適用');
  await page.click('#editToggle'); await page.waitForTimeout(400);
  const mode = await page.evaluate(() => document.querySelector('input[name=emode]:checked')?.value);
  ok(mode === 'wall', `② 編集モードは「壁」（${JSON.stringify(mode)}）`);
  for (const [x, y] of EDIT) await clickWorld(page, x, y);
  await page.click('#edApply'); await page.waitForTimeout(800);
  const c2 = await liveCourse(page);
  ok(c2.name === NAME && c2.walls === fx.walls.length + 1,
    `② 同名のまま壁が 1 本増えた（name=${JSON.stringify(c2.name)}・壁 ${fx.walls.length} → ${c2.walls} 本）＝違うのは壁だけ`);
  const d2 = times(await drawn(page));
  ok(!d2.includes(T), `② 別レイアウトの記録 ${T} を HUD の BEST に描かない（描かれた時刻 ${JSON.stringify(d2)}）`);
  ok(d2.includes('--:--.--'), '② BEST は「記録なし」（--:--.--）を描く＝HUD は描かれている（空振りでない）');
  ok((await rec()) === null, '② 配信中の loadBestRec も、このコースの記録は無いと答える');

  console.log('\n【③ 兄弟（逆向き）】元に戻して ✔適用すると、形が同じなので記録が戻る');
  await page.click('#editToggle'); await page.waitForTimeout(400);
  await page.click('#edUndo'); await page.waitForTimeout(200);
  await page.click('#edApply'); await page.waitForTimeout(800);
  const c3 = await liveCourse(page);
  ok(c3.walls === fx.walls.length, `③ 壁が ${c3.walls} 本に戻った`);
  const d3 = times(await drawn(page));
  ok(d3.includes(T), `③ 記録 ${T} が HUD に戻る（描かれた時刻 ${JSON.stringify(d3)}）＝✔適用のたびに記録を失わない`);

  console.log('\n【④ 改名】別名で保存して選ぶ（形は同じ）→ 記録は残る');
  await page.click('#editToggle'); await page.waitForTimeout(400);
  await page.fill('#edName', RENAMED);
  await page.click('#edSave'); await page.waitForTimeout(400);
  await page.click('#editToggle'); await page.waitForTimeout(300);
  await selectCourse(page, RENAMED);
  const c4 = await liveCourse(page);
  ok(c4.name === RENAMED, `④ 走行コースは改名したもの（${JSON.stringify(c4.name)}）`);
  const d4 = times(await drawn(page));
  ok(d4.includes(T), `④ 名前を変えても記録 ${T} が出る（描かれた時刻 ${JSON.stringify(d4)}）`);

  console.log('\n【⑤ 再読込】ページを読み直して元の保存コースを選ぶ（指紋が再読込を跨いで同じ）');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await setLang(page, 'ja');
  await selectCourse(page, NAME);
  const d5 = times(await drawn(page));
  ok(d5.includes(T), `⑤ 再読込後も記録 ${T} が出る（描かれた時刻 ${JSON.stringify(d5)}）`);

  console.log('\n【⑥ 旧形式（v8.7.0 まで）の記録】出荷コースでは出る・自作コースでは出さない・どちらも消さない');
  const legacy = await page.evaluate(([name, preset, car, ver]) => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('rumicar.practiceShape.'));
    const val = JSON.parse(localStorage.getItem(k)); val.ver = ver;
    const raw = JSON.stringify(val);
    localStorage.removeItem(k);                                            // 新形式を消して旧形式だけにする
    localStorage.setItem('rumicar.practice.' + preset + '::' + car, raw);  // 出荷コース名の旧キー
    localStorage.setItem('rumicar.practice.' + name + '::' + car, raw);    // 自作コース名の旧キー
    return raw;
  }, [NAME, PRESET, car, OLD_VER]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await setLang(page, 'ja');
  await selectCourse(page, PRESET);
  const d6 = await drawn(page);
  ok(times(d6).includes(T), `⑥ 出荷コース「${PRESET}」: 旧形式の記録 ${T} が出る（損失なし・描かれた時刻 ${JSON.stringify(times(d6))}）`);
  ok(d6.some((s) => s.includes(`(当時 ${OLD_VER})`)), `⑥ 旧版の記録なので「(当時 ${OLD_VER})」を併記する（hud.js の版スタンプ表示を壊していない）`);
  await selectCourse(page, NAME);
  const d6b = times(await drawn(page));
  ok(!d6b.includes(T), `⑥ 自作コース「${NAME}」: 形を確かめられない旧記録は出さない（描かれた時刻 ${JSON.stringify(d6b)}）`);
  const kept = await page.evaluate(([name, preset, car]) => [localStorage.getItem('rumicar.practice.' + preset + '::' + car), localStorage.getItem('rumicar.practice.' + name + '::' + car)], [NAME, PRESET, car]);
  ok(kept[0] === legacy && kept[1] === legacy, '⑥ 旧キーは 2 件とも byte 不変で残っている（表示しないだけで消さない）');

  ok(errors.length === 0, `⑦ JS/HTTP エラー 0 件（${errors.length}${errors.length ? ': ' + JSON.stringify(errors.slice(0, 3)) : ''}）／想定内 ${benign.length}`);
  await page.close();
} finally {
  await browser.close();
}

const line = '─'.repeat(64);
console.log('\n' + line);
console.log('BE2 練習ベストの鍵（コースの形）実ブラウザゲート');
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log(line); for (const m of fails) console.log('  ✗ ' + m); }
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
