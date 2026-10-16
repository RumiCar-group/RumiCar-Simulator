// check_bl4_escape.mjs — BL4 車種表と編集フォームのエスケープの実ブラウザ検証 (headed Chrome on Xvfb)
// ════════════════════════════════════════════════════════════════════════════
// 受け入れ基準 (PLAN BL4) のうち **卓上ゲート (wf_bl1_ui.mjs G 章) では測れない部分** を実機で測る:
//   ① 自作車 (localStorage rumicar.customCars) の数値欄に HTML を入れて保存した状態で 🚗 車種 を開くと、
//      車種表 (#carParamTable) に img 要素が生成されず、値は文字列のまま見える
//   ② 一覧の「編集」で編集フォーム (#carForm) に読み込むと、value 属性から抜け出さず (img 要素 0・
//      属性値が元の文字列のまま)、onerror が発火しない (page.on('dialog') の alert 0 件)
//   ③ 出荷車種 (custom/community 印の無い車種) の行の textContent が、是正前の書き方
//      (`${ct[c] != null ? ct[c] : '-'}`・`grip ${ct.drift.grip}`) で配信中の CAR_TYPES から作った文字列と一致する
//      (＝正常値の表示は是正前と同一。車種の値はページが現に読み込んでいる config.js に答えさせる)
//
// 自作車の保存はブラウザの localStorage に直接置く (addInitScript・goto より前)。アプリの「追加」ボタンは
// validateCarDef が数値でない値を拒否するので、この形の自作車は「古い版で保存した・手で書き換えた・バックアップから
// 戻した」経路でだけ生まれる。読み込み (initCarCrud の registerCarType)・描画 (renderCarParamTable・renderCarForm) は
// product そのもの (CI-8)。
//
// 是正前 (8248a58・v10.3.0) は ① で img 要素が生成され onerror の alert が出る・② で value 属性から抜け出す＝赤。
// 使い方: cd browser && bash run.sh check_bl4_escape.mjs
import { launch, newPage, appModule } from './lib.mjs';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };

// 攻撃の文字列 (onerror は alert を出す＝page.on('dialog') で数える)。
const BREAKOUT = '"><img src=x onerror=alert(1)>';   // value="…" からの抜け出し (car_crud.js carNumRow)
const TEXTNODE = '<img src=x onerror=alert(2)>';     // 表のセル (car_crud.js renderCarParamTable)
const EVIL = { key: 'bl4_evil', name: 'BL4 evil', mass: BREAKOUT, accel: TEXTNODE, drift: { grip: TEXTNODE, trigger: 'power' } };

const browser = await launch();
const dialogs = [];
const { page, errors, benign } = await newPage(browser, {
  width: 1440,
  before: async (p) => {
    p.on('dialog', (d) => { dialogs.push(`${d.type()}: ${d.message()}`); d.dismiss().catch(() => {}); });
    await p.addInitScript((evil) => {
      try { localStorage.setItem('rumicar.customCars', JSON.stringify([evil])); } catch (e) {}
    }, EVIL);
  },
});

await page.click('#helpCars');
await page.waitForSelector('#carParamTable table', { state: 'attached', timeout: 10000 });
await page.waitForTimeout(500);   // onerror は画像の読み込み失敗で非同期に発火する

console.log('\n① 車種表 (#carParamTable)');
const tbl = await page.evaluate(() => {
  const wrap = document.getElementById('carParamTable');
  const rows = [...wrap.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => td.textContent));
  return { imgs: wrap.querySelectorAll('img').length, rows, head: rows[0] };
});
const evilRow = tbl.rows.find((r) => r[0] && r[0].includes('BL4 evil'));
ok(tbl.imgs === 0, `車種表に img 要素が無い (実 ${tbl.imgs})`);
ok(!!evilRow, `自作車の行がある (${evilRow ? evilRow.length + ' セル' : '無し'})`);
if (evilRow) {
  const col = (name) => evilRow[tbl.head.indexOf(name)];
  ok(col('mass') === BREAKOUT, `mass のセルは文字列のまま見える (textContent=${JSON.stringify(col('mass'))})`);
  ok(col('accel') === TEXTNODE, `accel のセルは文字列のまま見える (textContent=${JSON.stringify(col('accel'))})`);
  ok(col('drift') === 'grip ' + TEXTNODE, `drift のセルは文字列のまま見える (textContent=${JSON.stringify(col('drift'))})`);
}

console.log('\n③ 出荷車種の行の表示は是正前の書き方と同一');
const want = await appModule(page, 'js/config.js', (m) => {
  const cols = ['mass', 'accel', 'brake', 'maxSpeed', 'spin', 'us', 'os', 'powerUs', 'powerOs'];
  return m.CAR_TYPES.filter((ct) => !ct.custom && !ct.community).map((ct) => ({
    key: ct.key,
    cells: cols.map((c) => String(ct[c] != null ? ct[c] : '-')).concat([ct.drift ? `grip ${ct.drift.grip}` : '—']),
  }));
});
const shipped = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('#carParamTable button.car-ovr-edit')];
  return btns.map((b) => { const tr = b.closest('tr'); return { key: b.dataset.key, cells: [...tr.children].slice(1, 11).map((td) => td.textContent) }; });
});
ok(want.length === 6 && shipped.length === 6, `出荷車種 6 種 (config ${want.length}・表 ${shipped.length})`);
let same = 0;
for (const w of want) {
  const s = shipped.find((x) => x.key === w.key);
  const eq = !!s && JSON.stringify(s.cells) === JSON.stringify(w.cells);
  if (eq) same++;
  else ok(false, `出荷車種 ${w.key}: 表 ${JSON.stringify(s && s.cells)} / 是正前の書き方 ${JSON.stringify(w.cells)}`);
}
ok(same === want.length, `出荷車種の行 ${same}/${want.length} 行が是正前の書き方と一致 (値: ${want.map((w) => w.key + '=' + w.cells.join('|')).join(' ; ')})`);

console.log('\n② 編集フォーム (#carForm) — 自作車の一覧の「編集」');
await page.click('#customCarList button.carlist-edit[data-key="bl4_evil"]');
await page.waitForTimeout(500);
const form = await page.evaluate(() => {
  const f = document.getElementById('carForm');
  const num = document.getElementById('cf_num_mass');
  const rng = f.querySelector('input.cf-range[data-num="cf_num_mass"]');
  const acc = document.getElementById('cf_num_accel');
  const grip = document.getElementById('cf_num_grip');
  return {
    imgs: f.querySelectorAll('img').length,
    inputs: f.querySelectorAll('input').length,
    massAttr: num ? num.getAttribute('value') : null,
    massRangeAttr: rng ? rng.getAttribute('value') : null,
    accelAttr: acc ? acc.getAttribute('value') : null,
    gripAttr: grip ? grip.getAttribute('value') : null,
    keyVal: document.getElementById('cf_key') ? document.getElementById('cf_key').value : null,
  };
});
ok(form.imgs === 0, `編集フォームに img 要素が無い (実 ${form.imgs})`);
ok(form.keyVal === 'bl4_evil', `編集フォームに自作車を読み込んだ (key=${JSON.stringify(form.keyVal)})`);
ok(form.massAttr === BREAKOUT, `mass の数値入力の value 属性は元の文字列のまま (抜け出さない・実 ${JSON.stringify(form.massAttr)})`);
ok(form.massRangeAttr === BREAKOUT, `mass のスライダーの value 属性は元の文字列のまま (実 ${JSON.stringify(form.massRangeAttr)})`);
ok(form.accelAttr === TEXTNODE && form.gripAttr === TEXTNODE, `accel・drift.grip の value 属性も元の文字列のまま (accel ${JSON.stringify(form.accelAttr)}・grip ${JSON.stringify(form.gripAttr)})`);
// 数値欄 13＋drift 7 の (スライダー＋数値) 40・key/name 2・drift の ON/OFF と brakeDrift の checkbox 2 = 44
ok(form.inputs === 44, `入力欄の数が設計どおり (13＋7 項目×2・key/name・checkbox 2＝44・実 ${form.inputs})`);

await page.waitForTimeout(300);
ok(dialogs.length === 0, `onerror が発火しない (alert ${dialogs.length} 件${dialogs.length ? ': ' + dialogs.join(' | ') : ''})`);
ok(errors.length === 0, `JS エラー・HTTP 異常 0 件 (実測 ${errors.length}${errors.length ? ': ' + errors.join(' | ') : ''})`);
if (benign.length) console.log(`  (想定内として除外した応答 ${benign.length} 件: ${benign.slice(0, 3).join(' | ')}${benign.length > 3 ? ' …' : ''})`);
await browser.close();

const line = '─'.repeat(64);
console.log('\n' + line);
console.log('BL4 車種表・編集フォームのエスケープ 実ブラウザゲート');
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log(line); for (const m of fails) console.log('  ✗ ' + m); }
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
