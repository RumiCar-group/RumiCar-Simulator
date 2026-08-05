// 本番 UI を実際に操作して走らせる。VNC で人が見ている前で動かすことを想定した台本。
//
// これは「見せるためのデモ」であると同時に、**本番フローそのものの操作**でもある
// (CI-8: テスト用の分岐やバイパスを作らない)。触るのは利用者と同じ UI 要素だけ。
//
//   bash vnc.sh start
//   RC_SLOWMO=400 bash run.sh drive.mjs      # 人が追える速さで
//   RC_COURSE="峠" RC_RUN_SEC=20 bash run.sh drive.mjs
//
// 終わってもウィンドウは開いたままにする (人が続けて触れるように)。RC_HOLD_MIN で調整。

import { launch, newPage, APP_URL } from './lib.mjs';

const RUN_SEC = Number(process.env.RC_RUN_SEC || 15);
const HOLD_MIN = Number(process.env.RC_HOLD_MIN || 60);
const WANT = process.env.RC_COURSE || '';

const browser = await launch({ slowMo: Number(process.env.RC_SLOWMO || 400) });
const { page, errors, benign } = await newPage(browser, { width: 1440, height: 900 });
console.log(`対象 ${APP_URL} / 起動時エラー ${errors.length} 件 (想定内除外 ${benign.length} 件)\n`);

// ── ① コースを選ぶ（利用者と同じ <select> を操作する）────────────────────────
const courses = await page.locator('#courseSel option').allTextContents();
console.log(`コース ${courses.length} 件`);
const pick = (WANT && courses.find((c) => c.includes(WANT))) || courses[Math.min(18, courses.length - 1)];
await page.selectOption('#courseSel', { label: pick });
await page.waitForTimeout(800);
console.log(`  選択: ${pick}`);
const desc = (await page.locator('#courseDesc').textContent().catch(() => '') || '').trim();
if (desc) console.log(`  説明: ${desc.slice(0, 60)}`);

// ── ② 走らせる ───────────────────────────────────────────────────────────────
await page.click('#run');
console.log(`\n走行開始 — ${RUN_SEC} 秒サンプリング`);

let maxSpd = 0;
const t0 = Date.now();
while ((Date.now() - t0) / 1000 < RUN_SEC) {
  await page.waitForTimeout(1000);
  const state = (await page.locator('#state').textContent().catch(() => '') || '').trim();
  const spd = Number((await page.locator('#spd').textContent().catch(() => '0') || '0').replace(/[^\d.]/g, ''));
  if (spd > maxSpd) maxSpd = spd;
  console.log(`  ${String(Math.round((Date.now() - t0) / 1000)).padStart(2)}s  状態=${state}  速度=${spd} km/h`);
}

await page.click('#stop');
console.log(`\n停止。最高速 ${maxSpd} km/h`);

// ── ③ 言語を切り替えて戻す（UI が追従することを目で見る）─────────────────────
await page.selectOption('#langSel', 'en');
await page.waitForTimeout(1200);
console.log(`英語表示: 走行ボタン="${(await page.locator('#run').textContent() || '').trim()}"`);
await page.selectOption('#langSel', 'ja');
await page.waitForTimeout(1200);
console.log(`日本語表示: 走行ボタン="${(await page.locator('#run').textContent() || '').trim()}"`);

console.log(`\n実行中に増えたエラー: ${errors.length} 件${errors.length ? ' → ' + errors[0] : ''}`);
console.log(`このまま ${HOLD_MIN} 分開いておきます（VNC からそのまま操作できます）。`);

const close = async () => { try { await browser.close(); } catch {} process.exit(0); };
process.on('SIGINT', close); process.on('SIGTERM', close);
page.on('close', close);
setTimeout(close, HOLD_MIN * 60_000);
