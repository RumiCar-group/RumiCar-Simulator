// RumiCar Simulator — 実ブラウザ 常設スモークゲート
//
// 目的: これまで「本サーバーにブラウザが無い」ことを理由に人間へ委ねてきた
//       目視必須札のうち、機械で測れる部分を測定述語へ翻訳する (CI-14)。
//       残る「人にどう映るか」だけを札として明示的に残す。
//
// 測るもの:
//   A 版バッジ = 配信中 config.js の APP_VERSION と一致  … PLAN.md:1653 / PROGRESS.md:105 の札ⓐ
//   B CHANGELOG ポップアップが hover で開き、先頭行が現行版・本文が非空 (ja) … 同 札ⓑ
//   C en へ切替えると本文が英語版(noteEn)へ差し替わる (ja と異なる)          … 同 札ⓑ
//   D pageerror 0 / console error 0 (想定内の 404 は件数を明示して除外)
//   E 横方向のはみ出し 0 px を複数幅で (UI-FIX-1 の回帰監視)
//
// 使い方: bash run.sh check_smoke.mjs
// 終了コード: 0=全項目 PASS / 1=いずれか FAIL

import { launch, newPage, appModule, setLang, overflowX, report, APP_URL } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const WIDTHS = [1920, 1440, 1366, 1280, 1024, 768, 420];
let pass = 0, fail = 0;
const ok = (label, cond, detail) => (report(label, cond, detail) ? pass++ : fail++);

const browser = await launch();
console.log(`\n== 実ブラウザ(headed Chrome on Xvfb) スモーク ==\n対象: ${APP_URL}\n`);

// ── A/B/C/D: 版バッジと CHANGELOG ────────────────────────────────────────────
const { page, errors, benign } = await newPage(browser, { width: 1440, height: 900 });

// 述語は再実装せず、ページが現に読んでいる config.js に答えさせる (CI-9)
const ver = await appModule(page, 'js/config.js', (m) => m.APP_VERSION);
// CHANGELOG は Stage AS2 で changelog.js へ分離 (起動 critical path から外し、ポップアップを
// 組むときにだけ動的 import する)。ここでも配信中の本物に答えさせる。
const changelogLen = await appModule(page, 'js/changelog.js', (m) => m.CHANGELOG.length);

const badge = (await page.locator('#appVer').first().innerText()).trim().split('\n')[0].trim();
ok('A 版バッジ = 配信中の APP_VERSION', badge === ver, `badge="${badge}" APP_VERSION="${ver}"`);

await page.hover('#appVer');
await page.waitForTimeout(300);
const popVisible = await page.locator('.ver-pop').first().isVisible();
const headJa = (await page.locator('.ver-pop-head').first().textContent() ?? '').trim();
const rowsJa = await page.locator('.ver-pop-row').count();
const topV = (await page.locator('.ver-pop-row .ver-pop-v').first().textContent() ?? '').trim();
const noteJa = (await page.locator('.ver-pop-row .ver-pop-note').first().textContent() ?? '').trim();
ok('B CHANGELOG ポップアップが hover で開く', popVisible, `head="${headJa}" 行数=${rowsJa}/${changelogLen}`);
ok('B 先頭行が現行版・本文非空 (ja)', topV === ver && noteJa.length > 0,
   `v="${topV}" note=${noteJa.length}字`);
await page.screenshot({ path: SHOTS + 'changelog_ja.png' });

await setLang(page, 'en');
await page.hover('#appVer');
await page.waitForTimeout(300);
const headEn = (await page.locator('.ver-pop-head').first().textContent() ?? '').trim();
const noteEn = (await page.locator('.ver-pop-row .ver-pop-note').first().textContent() ?? '').trim();
ok('C en で本文が英語版へ差し替わる', noteEn.length > 0 && noteEn !== noteJa,
   `head="${headEn}" note=${noteEn.length}字 (ja と${noteEn === noteJa ? '同一' : '別'})`);
await page.screenshot({ path: SHOTS + 'changelog_en.png' });

ok('D pageerror / console error 0', errors.length === 0,
   errors.length ? errors.slice(0, 5).join(' | ') : `想定内として除外 ${benign.length} 件`);
await page.close();

// ── E: 横はみ出し / 各幅のエラー（別々に判定する。混ぜると失敗の意味が読めない）──
const over = [], errAt = [];
let benignTotal = 0;
for (const w of WIDTHS) {
  const { page: p, errors: e, benign: b } = await newPage(browser, { width: w, height: 900 });
  const px = await overflowX(p, w);
  if (px > 0) over.push(`${w}px→+${px}px`);
  if (e.length) errAt.push(`${w}px:${e[0].slice(0, 90)}`);
  benignTotal += b.length;
  if (w === 1440) await p.screenshot({ path: SHOTS + 'app_1440.png' });
  await p.close();
}
ok(`E1 横はみ出し 0 (${WIDTHS.length}幅)`, over.length === 0, over.length ? over.join(' ') : '全幅 0px');
ok(`E2 各幅でエラー 0 (${WIDTHS.length}幅)`, errAt.length === 0,
   errAt.length ? errAt.join(' | ') : `想定内として除外 計${benignTotal}件`);

await browser.close();
console.log(`\n結果: PASS ${pass} / FAIL ${fail}   スクリーンショット: browser/shots/`);
console.log('目視必須の残り: 札の文字やレイアウトが「人にとって読みやすいか」は機械化しない。');
process.exit(fail === 0 ? 0 : 1);
