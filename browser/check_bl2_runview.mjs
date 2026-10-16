// check_bl2_runview.mjs — BL2 走行中の設定変更で止めたときの表示（■・コード表示）の実ブラウザ検証 (headed Chrome on Xvfb)
// ════════════════════════════════════════════════════════════════════════════
// 受け入れ基準 (PLAN BL2) のうち **卓上ゲート (wf_bl1_ui.mjs B 章の配線検査) では測れない部分** を実機で測る:
//   ① ▶ で走らせた後に、走行を止める設定変更 9 経路 (コース選択・タイヤ・ギア比・サス自由度・操舵サーボ・
//      制動装置・タイヤ摩耗・物理エンジン・領域) の change を本番の UI 操作 (selectOption／click) で発火し、
//      各々で ■ (#stop) が無効・▶ (#run) が有効・全列の .cc-editor が表示・.cc-code が非表示
//      ＝「停止した見た目」に戻ることを経路ごとに 1 行で出す。▶ で再開できることは次の経路の前提
//      (走行中の見た目になること) と最後の ▶ で測る。
//   ② 走っていないときに同じ 9 経路を change しても表示が変わらない (是正前と同じ・対照)。
//   ③ 操作の間に JS エラーが 0 件。
//
// 是正前 (ad5ddd1〜b649a95・v10.3.0) は 9 経路が `running = false; paused = false; syncButtons();` だけで止めて
// `setRunView(false)` を通らないため、① の .cc-editor 表示／.cc-code 非表示が全経路で赤
// (コード表示のまま固定・テキストエリアは隠れたまま・■ は無効＝押して戻す手段が無い)。② は是正前も緑。
// 見た目の判定は class だけでなく getComputedStyle の display でも測る (.hidden の CSS が効いているか)。
// 使い方: cd browser && bash run.sh check_bl2_runview.mjs
import { launch, newPage, appModule } from './lib.mjs';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };

const browser = await launch();
const { page, errors, benign } = await newPage(browser, { width: 1440 });

// 状態表示の文言はページが現に読み込んでいる i18n の t() に答えさせる (再実装しない)。
const ST = await appModule(page, 'js/i18n.js', (m) => ({ run: m.t('hud.st.run'), stop: m.t('hud.st.stop'), crash: m.t('hud.st.crash') }));

// 見た目の測定: ボタン 3 つ・全列のエディタ／コード表示 (class と computed display の両方)・HUD の状態語。
const view = () => page.evaluate(() => {
  const shown = (el) => !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';
  const cols = [...document.querySelectorAll('#fleetCols .carcol')];
  return {
    run: document.getElementById('run').disabled,
    stop: document.getElementById('stop').disabled,
    pause: document.getElementById('pause').disabled,
    cols: cols.length,
    editorShown: cols.filter((c) => shown(c.querySelector('.cc-editor'))).length,
    codeShown: cols.filter((c) => shown(c.querySelector('.cc-code'))).length,
    state: (document.getElementById('state').textContent || '').trim(),
  };
});
const fmt = (v) => `■disabled=${v.stop} ▶disabled=${v.run} 列${v.cols} エディタ表示${v.editorShown} コード表示${v.codeShown} 状態「${v.state}」`;
const isStoppedView = (v) => v.stop === true && v.run === false && v.pause === true && v.cols > 0 && v.editorShown === v.cols && v.codeShown === 0;
const isRunningView = (v) => v.stop === false && v.run === true && v.cols > 0 && v.editorShown === 0 && v.codeShown === v.cols;

// 経路: [見出し, 要素 id, 種別]。select は現在値と違う option を選ぶ (本番の UI 操作＝change が 1 回発火する)。
const PATHS = [
  ['(a) コース選択', 'courseSel', 'select'],
  ['(b) タイヤ', 'optTire', 'select'],
  ['(b2) ギア比', 'optGear', 'select'],
  ['(b3) サス自由度', 'optSusp', 'select'],
  ['(b4) 操舵サーボ', 'optSteer', 'select'],
  ['(b5) 制動装置', 'optBrake', 'select'],
  ['(b6) タイヤ摩耗', 'optWear', 'checkbox'],
  ['(c) 物理エンジン', 'optPhysMode', 'select'],
  ['(d) 走行領域', 'regimeSel', 'select'],
];
async function fire(id, kind) {
  if (kind === 'checkbox') { await page.click('#' + id); return await page.evaluate((i) => String(document.getElementById(i).checked), id); }
  const next = await page.evaluate((i) => {
    const s = document.getElementById(i);
    const vals = [...s.options].filter((o) => !o.disabled && o.value !== '').map((o) => o.value);
    const k = vals.indexOf(s.value);
    return vals[(k + 1) % vals.length];
  }, id);
  await page.selectOption('#' + id, next);
  return next;
}

// 列が複数あっても全列が戻ることを測るため、本番の ＋ ボタンで 2 台にしてから始める (既定は 1 台)。
await page.click('#carAdd');
await page.waitForTimeout(300);

console.log(`\n② 対照: 走っていないときの change（表示が変わらない）`);
{
  const v0 = await view();
  ok(v0.cols >= 2, `＋ で 2 台以上にした（列 ${v0.cols}）`);
  ok(isStoppedView(v0), `走らせる前は停止の見た目（${fmt(v0)}）`);
  for (const [label, id, kind] of PATHS) {
    const to = await fire(id, kind);
    await page.waitForTimeout(250);
    const v = await view();
    ok(isStoppedView(v), `停止中 ${label} → ${to}: 停止の見た目のまま（${fmt(v)}）`);
  }
}

console.log(`\n① 走行中の change（停止の見た目に戻り ▶ で再開できる）`);
for (const [label, id, kind] of PATHS) {
  await page.click('#run');
  await page.waitForTimeout(400);
  const vr = await view();
  ok(isRunningView(vr), `${label} の前提: ▶ で走行中の見た目（${fmt(vr)}）`);
  const to = await fire(id, kind);
  await page.waitForTimeout(300);
  const v = await view();
  ok(v.stop === true, `走行中 ${label} → ${to}: ■ が無効（停止済み）`);
  ok(v.run === false, `走行中 ${label} → ${to}: ▶ が有効（再開できる）`);
  ok(v.cols > 0 && v.editorShown === v.cols, `走行中 ${label} → ${to}: 全列の .cc-editor が表示（${v.editorShown}/${v.cols}）`);
  ok(v.codeShown === 0, `走行中 ${label} → ${to}: .cc-code が非表示（表示 ${v.codeShown}/${v.cols}）`);
  ok(v.state === ST.stop || v.state === ST.crash, `走行中 ${label} → ${to}: HUD の状態が停止（「${v.state}」）`);
}
{
  await page.click('#run');
  await page.waitForTimeout(400);
  const vr = await view();
  ok(isRunningView(vr), `最後の経路の後も ▶ で走行中の見た目に戻る（${fmt(vr)}）`);
  await page.click('#stop');
  await page.waitForTimeout(250);
  const vs = await view();
  ok(isStoppedView(vs), `■ で停止の見た目（${fmt(vs)}）`);
}

ok(errors.length === 0, `JS エラー 0 件 (実測 ${errors.length}${errors.length ? ': ' + errors.join(' | ') : ''})`);
if (benign.length) console.log(`  (想定内として除外した応答 ${benign.length} 件: ${benign.slice(0, 3).join(' | ')}${benign.length > 3 ? ' …' : ''})`);
await browser.close();

const line = '─'.repeat(64);
console.log('\n' + line);
console.log('BL2 走行中の設定変更の停止表示 実ブラウザゲート');
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log(line); for (const m of fails) console.log('  ✗ ' + m); }
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
