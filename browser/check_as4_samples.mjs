// AS4: 追加した C 移植サンプル 2 本が、**利用者と同じ UI 操作**で選べて実際に走ることを実ブラウザで測る。
// 触るのは利用者と同じ要素だけ（プログラム選択 <select> と 走行ボタン）＝テスト専用の抜け道を作らない（CI-8）。
// 述語は二値でなく連続量（走行距離・速度の最大値）で出し、対照（未選択時との差）も併せて記録する。
import { launch, newPage, appModule, APP_URL } from './lib.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const RUN_SEC = Number(process.env.RC_RUN_SEC || 8);
const browser = await launch({ slowMo: Number(process.env.RC_SLOWMO || 0) });
const { page, errors, benign } = await newPage(browser, { width: 1440, height: 900 });
console.log(`対象 ${APP_URL} / 起動時エラー ${errors.length} 件 (想定内除外 ${benign.length} 件)\n`);

// 期待する 2 本は「配信中の programs.js」から取る（検査側に名前を写し取らない＝本体が変わっても腐らない）。
const want = await appModule(page, 'js/programs.js', (m) =>
  m.PROGRAMS.filter((p) => p.key === 'recon_racer_c' || p.key === 'comp_localize_c')
    .map((p) => ({ key: p.key, name: p.name, lang: p.lang })));
ok(want.length === 2, `配信中の PROGRAMS に C 移植 2 本が実在 — ${want.map((w) => `${w.name}(${w.lang})`).join(' / ')}`);
ok(want.every((w) => w.lang === 'c'), `2 本とも lang='c' — ${want.map((w) => w.lang).join(',')}`);

// 本番の車両カード内プログラム選択（check_tags T3 と同じ本物の要素）。
const SEL = '.cc-program';
const opts = await page.locator(SEL + ' option').allTextContents();
for (const w of want) ok(opts.some((o) => o.includes(w.name)), `プログラム選択メニューに「${w.name}」が出ている`);

for (const w of want) {
  console.log(`\n--- ${w.name} を選んで走らせる ---`);
  const before = errors.length;
  await page.selectOption(SEL, { label: opts.find((o) => o.includes(w.name)) });
  await page.waitForTimeout(600);
  // エディタに当該プログラムのソースが実際に入ったか（C 版なので `void loop()` を含む）。
  const src = await page.locator('.cc-editor').first().inputValue().catch(() => '');
  ok(src.includes('void loop()') && src.includes('['), `エディタに C ソースが入る（${src.length}字・配列 [ を含む）`);
  // 対照: 走らせる前は停止・速度 0（「いつでも走行中に見える」壊れ方の検出）。
  const st0 = ((await page.locator('#state').textContent().catch(() => '')) || '').trim();
  ok(st0 === '停止', `走行前の状態が「停止」（実 ${JSON.stringify(st0)}）`);
  await page.click('#run');
  // 状態は #state、速度は #spd（drive.mjs と同じ本番の表示要素）。
  let maxSpd = 0, moved = 0, running = 0;
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < RUN_SEC) {
    await page.waitForTimeout(500);
    const st = ((await page.locator('#state').textContent().catch(() => '')) || '').trim();
    if (st === '走行中') running++;
    const v = Number(((await page.locator('#spd').textContent().catch(() => '0')) || '0').replace(/[^\d.]/g, ''));
    if (v > maxSpd) maxSpd = v;
    if (v > 1) moved++;
  }
  await page.click('#stop');
  await page.waitForTimeout(300);
  ok(running >= 3, `走行状態が継続 — 「走行中」の観測 ${running} 回（基準 ≥3）`);
  ok(maxSpd > 10, `実際に走った — 最高速 ${maxSpd} km/h（基準 >10。0 なら「選べるが動かない」壊れ方）`);
  ok(moved >= 3, `速度>1 の観測 ${moved} 回（基準 ≥3）`);
  ok(errors.length === before, `走行中に増えたエラー 0 件（実 ${errors.length - before} 件）`);
}

console.log(`\n結果: PASS ${pass} / FAIL ${fail}`);
await browser.close();
process.exit(fail ? 1 : 0);
