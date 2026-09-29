// check_bf2_probekey.mjs — BF2「組込車種を上書きしても実走容量が古い答えを返す」を無くす 実ブラウザ検証
// ════════════════════════════════════════════════════════════════════════════
// 何を測るか:
//   `capacity.js` の実走容量 `driveableCapN` は、容量プローブ車 normal_fr で実際に走らせて答えを出し、覚え書きに残す。
//   改修前の鍵は (コース形状・領域・車長・上限台数・エンジン) で、**プローブ車の定義が入っていなかった**。
//   ∴ 🚗 車種 → 組込の「編集」（V3 のローカル上書き）で normal_fr の加速を 0 にしても、上書き前の答え（走り出せる）が返り、
//   ▶ で「実際に走り出せる車が 1 台もありません」の告知が出なかった（改修前ツリーで実測・internal 決定ログ「BF2 結果」）。
//   本ゲートは利用者と同じ UI 操作だけでその経路を通す（CI-8）:
//     ① オーバルで ▶（＝既定の定義で実走判定が 1 件積まれる）→ ② 🚗 で normal_fr の加速を 0 に上書き保存
//     → ③ ▶（＝ここで古い答えが返るかを測る）→ ④ 「既定に戻す」→ ⑤ ▶（＝既定の答えが覚え書きから当たる）
//
// 【判定の物差し（CI-14・check_bd1_capkey と同じ型）】
//   (a) **product の告知**: ③ で実走ゼロの告知（`log.capZeroDriveWarnOnly`）が出る。① と ⑤ では出ない。
//   (b) **独立オラクル**: ③ の時点で `capacity.js:stuckAtN`（覚え書きを通らない実走述語）が 1 台走り出せないと答え、
//       `fleet.js:capacityOf` は静的には置けると答える＝実走ゼロだけが起きている。
//   (c) **覚え書きの項目数**（`CAP_CACHE` は観測専用の口）: ③ で 1 件増える（＝鍵が変わって測り直した）・⑤ で増えない
//       （＝既定に戻すと同じ鍵に戻って当たる）。① で 1 件以上積まれていること（空振り検出）。
//   治具の前提: ①③⑤ で carScale スライダーが同じ値（鍵の他の成分が同じ＝違いはプローブ車の定義だけ）。
//
// 使い方: bash run.sh check_bf2_probekey.mjs
import { launch, newPage, appModule } from './lib.mjs';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m, d = '') => { if (c) { pass++; console.log(`  ✓ ${m}${d ? ' — ' + d : ''}`); } else { fail++; fails.push(m); console.log(`  ✗ ${m}${d ? ' — ' + d : ''}`); } };

const RE_ZERO_DRIVE = /置くことはできても実際に走り出せる車が 1 台もありません/;   // check_bd1_capkey と同じ識別子
const logText = (page) => page.evaluate(() => (document.getElementById('log')?.textContent ?? ''));
const capSize = (page) => appModule(page, 'js/capacity.js', (m) => m.CAP_CACHE.size);
const probe = (page) => appModule(page, 'js/config.js', (m) => ({ accel: m.CAR_TYPE_BY_KEY.normal_fr.accel, maxSpeed: m.CAR_TYPE_BY_KEY.normal_fr.maxSpeed }));
const scaleVal = (page) => page.evaluate(() => document.getElementById('carScale').value);
const oracles = (page) => page.evaluate(async () => {
  const [cap, fleet, state, cfg] = await Promise.all(['capacity.js', 'fleet.js', 'state.js', 'config.js'].map((f) => import(new URL('js/' + f, location.href).href)));
  return { stuck1: cap.stuckAtN(state.course, 'tabletop', 1), staticCap: fleet.capacityOf(state.course, cfg.FLEET.maxCars) };
});
// ▶ → ⏹ が有効になるまで待つ（startAuto はガードを同期に通し切ってから ⏹ を有効化する）→ ログ全文 → ⏹。
// startAuto はガードより前に clearLog() するので、ログは押す前の長さで切らず全文を読む（check_bd1_capkey と同じ理由）。
async function runAndRead(page) {
  await page.click('#run');
  await page.waitForFunction(() => document.getElementById('stop')?.disabled === false, null, { timeout: 180000 });
  const txt = await logText(page);
  await page.click('#stop');
  await page.waitForTimeout(400);
  return txt;
}

const browser = await launch();
try {
  const { page, errors, benign } = await newPage(browser, {
    before: async (p) => { await p.addInitScript(() => { try { localStorage.setItem('rumicar.lang', 'ja'); localStorage.removeItem('rumicar.carOverrides'); } catch (e) {} }); },
  });
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.type()); d.accept(); });   // 「既定に戻す」の確認 (confirm)
  await page.selectOption('#courseSel', 'オーバル'); await page.waitForTimeout(700);
  const def0 = await probe(page);

  console.log('\n── ① 既定の定義で ▶ ──');
  const s0 = await capSize(page), k1 = await scaleVal(page);
  const t1 = await runAndRead(page);
  const s1 = await capSize(page);
  ok(s1 >= s0 + 1, '① ▶ で実走判定が覚え書きに積まれた（空振り検出）', `項目数 ${s0}→${s1}`);
  ok(!RE_ZERO_DRIVE.test(t1), '① 既定の定義では実走ゼロの告知が出ない');

  console.log('\n── ② 🚗 で normal_fr の加速を 0 に上書き保存（V3） ──');
  await page.click('#helpCars'); await page.waitForTimeout(400);
  await page.click('#carParamTable .car-ovr-edit[data-key="normal_fr"]'); await page.waitForTimeout(300);
  await page.evaluate(() => { const e = document.getElementById('cf_num_accel'); e.value = '0'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#carOvrSaveBtn'); await page.waitForTimeout(300);
  const def1 = await probe(page);
  ok(def1.accel === 0 && def0.accel > 0, '② 上書きが product の車種表に入った（normal_fr の accel）', `${def0.accel} → ${def1.accel}`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  console.log('\n── ③ 上書き後に ▶ ──');
  const k3 = await scaleVal(page);
  const t3 = await runAndRead(page);
  const s3 = await capSize(page);
  const o3 = await oracles(page);
  ok(k3 === k1, '③ 治具の前提: carScale が ① と同じ（違いはプローブ車の定義だけ）', `${k1} / ${k3}`);
  ok(o3.stuck1 === 1 && o3.staticCap >= 1, '③ 独立オラクル: 実走では 1 台も走り出せず、静的には置ける（実走ゼロだけが起きている）', JSON.stringify(o3));
  ok(RE_ZERO_DRIVE.test(t3), '③ product の告知: 実走ゼロ（log.capZeroDriveWarnOnly）が出る（古い答えを返さない）');
  ok(s3 === s1 + 1, '③ 覚え書きの鍵が変わって測り直した（項目が 1 件増える）', `項目数 ${s1}→${s3}`);

  console.log('\n── ④ 既定に戻す → ⑤ ▶ ──');
  await page.click('#helpCars'); await page.waitForTimeout(400);
  await page.click('#carParamTable .car-ovr-reset[data-key="normal_fr"]'); await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const def4 = await probe(page);
  ok(dialogs.length === 1 && dialogs[0] === 'confirm', '④ 「既定に戻す」の確認が 1 回出た（本番の経路を通った）', JSON.stringify(dialogs));
  ok(def4.accel === def0.accel && def4.maxSpeed === def0.maxSpeed, '④ 既定に戻った', `accel ${def4.accel}`);
  const k5 = await scaleVal(page);
  const t5 = await runAndRead(page);
  const s5 = await capSize(page);
  ok(k5 === k1, '⑤ 治具の前提: carScale が ① と同じ', `${k1} / ${k5}`);
  ok(!RE_ZERO_DRIVE.test(t5), '⑤ 既定に戻すと実走ゼロの告知は出ない');
  ok(s5 === s3, '⑤ 既定の定義の答えが覚え書きから当たる（項目が増えない）', `項目数 ${s3}→${s5}`);

  console.log(`\n除外した想定内の応答: ${benign.length} 件`);
  ok(errors.length === 0, 'ページ側のエラー 0 件', errors.slice(0, 3).join(' / ') || '0 件');
} finally { await browser.close(); }
console.log(`\n${'─'.repeat(60)}\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗: ' + fails.join(' / ')); process.exitCode = 1; }
else console.log('結果: PASS (組込車種を上書きすると実走容量を測り直し、既定に戻すと覚え書きが当たる)');
