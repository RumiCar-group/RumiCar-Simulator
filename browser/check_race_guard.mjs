// RumiCar Simulator — 実ブラウザ 常設ゲート: 「完走できないレースを開始させない」(AS3 構造是正 ii)
//
// 背景 (決定ログ AS-3): ゴールライン (finish) を持たない開けたコース (『ドリフト広場』『競技グラウンド』)
//   では lap.js が周回を **原理的に** 計上できない。それでも 🏁 レースは開始でき、全車が時間切れ DNF に
//   なるだけだった。main.js の raceableCourse() が開始を止め、理由をログに出すようにした。
//
// ここで測るもの (人が「レースが始まらないこと」を目視する代わりの測定述語):
//   T1 finish 線なしコースで 🏁 を押しても **レース結果ダイアログが開かない**・ログに理由が出る (ja)
//   T2 同じことを en でも (i18n 差し替えが効いている＝ja 固定文言でない)
//   T3 **対照**: ふつうのコース (オーバル) では 🏁 でレース結果が開く
//                (＝「いつも止める」壊れ方を検出する。ガードが効きすぎていないことの証拠)
//   T4 finish 線を持たないコースの集合が配信中のデータでも 2 件であること (増減の検出)
//   T5 操作中の console error / pageerror 0 (想定内の 404 は件数を明示して除外)
//
// 使い方: bash run.sh check_race_guard.mjs   終了コード: 0=全 PASS / 1=いずれか FAIL
import { launch, newPage, appModule, setLang, report, APP_URL } from './lib.mjs';

let pass = 0, fail = 0;
const ok = (label, cond, detail) => (report(label, cond, detail) ? pass++ : fail++);

const browser = await launch();
console.log(`\n== 実ブラウザ: 完走できないレースを開始させないこと (AS3) ==\n対象: ${APP_URL}\n`);
const { page, errors, benign } = await newPage(browser, { width: 1440, height: 900 });

// 述語は再実装しない: 「finish 線を持たないコース」は配信中の course.js/courses.json に答えさせる (CI-9)。
const noFinish = await page.evaluate(async () => {
  const [{ buildFromSpec }, specs] = await Promise.all([
    import('./js/course.js'),
    fetch('./data/courses.json').then((r) => r.json()),
  ]);
  return specs.map((s) => ({ name: s.name, hasFinish: !!buildFromSpec(s).finish }))
    .filter((c) => !c.hasFinish).map((c) => c.name);
});
ok('T4 finish 線なしコースは 2 件', noFinish.length === 2, `実測=[${noFinish.join(', ')}]`);

const logText = () => page.locator('#log').innerText();
const raceOpen = () => page.locator('#dlgRace').evaluate((d) => d.open);

async function pickCourse(name) {
  await page.selectOption('#courseSel', { value: name });
  await page.waitForTimeout(300);
}
async function clickRace() {
  await page.locator('#raceRun').click();
  await page.waitForTimeout(1500);
}

// ── T1: finish 線なしコース (ja) ────────────────────────────────────────────
await setLang(page, 'ja');
const target = noFinish[0];
await pickCourse(target);
const before = await logText();
await clickRace();
const afterJa = (await logText()).slice(before.length);
ok('T1 finish 線なしコースで 🏁 → レース結果が開かない', (await raceOpen()) === false, `course="${target}"`);
ok('T1 ログに理由 (コース名込み) が出る',
  afterJa.includes(target) && /レース|開催できません/.test(afterJa), `追加ログ="${afterJa.trim().slice(0, 120)}"`);

// ── T2: 同じことを en で ────────────────────────────────────────────────────
await setLang(page, 'en');
await page.waitForTimeout(300);
const beforeEn = await logText();
await clickRace();
const afterEn = (await logText()).slice(beforeEn.length);
ok('T2 en でも開始せず、英語の理由が出る (ja 固定文言でない)',
  (await raceOpen()) === false && /finish line|cannot be held/i.test(afterEn),
  `追加ログ="${afterEn.trim().slice(0, 120)}"`);

// ── T6: 📋 開催 (closeAndRace) 側にも同じガードが効く ──────────────────────
const beforeEv = await logText();
await page.locator('#eventOpen').click();         // 開催ダイアログを開く
await page.waitForTimeout(400);
await page.locator('#evRace').click();            // 締切してレース
await page.waitForTimeout(1200);
const afterEv = (await logText()).slice(beforeEv.length);
// この時点の表示言語は T2 で en。言語非依存に「開始していない」＋「理由が出ている」で判定する。
ok('T6 📋 開催でも finish 線なしコースは開始しない',
  (await raceOpen()) === false && /no finish line|ゴールライン/.test(afterEv),
  `追加ログ="${afterEv.trim().slice(0, 100)}"`);
if (await page.locator('#dlgEvent').evaluate((d) => d.open)) {
  await page.locator('#dlgEvent .docdlg-x').click();
  await page.waitForTimeout(300);
}

// ── T3: 対照 — ふつうのコースではレースが成立する ──────────────────────────
// 観戦リプレイ(自動)が ON だと結果ダイアログの前に全車ゴースト再生が入るため、対照では OFF にする
// (どちらも本番 UI のトグル。テスト専用の分岐は作らない=CI-8)。
const normal = 'オーバル';
await page.locator('#raceWatch').uncheck();
await pickCourse(normal);
await page.locator('#raceRun').click();
let opened = false;
try { await page.waitForFunction(() => document.getElementById('dlgRace').open, null, { timeout: 30000 }); opened = true; } catch { opened = false; }
ok('T3 対照: ふつうのコース (オーバル) では 🏁 でレース結果が開く', opened === true,
  `course="${normal}" dlgRace.open=${opened}`);
if (opened) { await page.locator('#dlgRace .docdlg-x').click(); await page.waitForTimeout(300); }

// ── T5: エラー 0 ────────────────────────────────────────────────────────────
ok('T5 console error / pageerror 0', errors.length === 0,
  `errors=${errors.length}${errors.length ? ' :: ' + errors.slice(0, 3).join(' | ') : ''} / 想定内として除外した応答=${benign.length} 件`);

await browser.close();
console.log(`\n合計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.error('FAIL: レース開始ガードが期待どおりでない'); process.exit(1); }
console.log('OK: 完走できないレースは開始せず理由を表示し、ふつうのコースは従来どおり開催できる');
