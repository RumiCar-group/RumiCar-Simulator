// check_az2_fitguard.mjs — AZ2 フィットガードの実ブラウザ検証 (headed Chrome on Xvfb)
// ════════════════════════════════════════════════════════════════════════════
// **これが AZ2 の新ロジックを実際に実行する唯一のゲート。** 卓上ゲート `wf_az2_fitguard.mjs` は
// `enforceFitRatio` が DOM 結合で node から呼べないため**判定順序の写し**を動かしており、
// product の main.js を 1 行も実行しない（層 4 レビュー 2026-09-12 の指摘）。ここでは利用者と同じ
// UI 操作だけで本物の main.js を走らせて確かめる（CI-8）。
//
// 測ること:
//   ① 「車が 1 台も置けない」コース × フルスケール領域 を選ぶと、**領域が卓上へ自動で戻る**
//   ② そのとき **無言でない**（ログに理由が 1 行出る）
//   ③ 落ち着いた先で **車が壁の中に湧かない**
//   ④ **既存コースの挙動を変えていない**: 通常のプリセットでは ④' の告知が出ず、従来の ② だけが働く
//   ⑤ **対照**: noRace の大型コースはフルスケールに留まる（= `selectOption` が本当に効いている証拠。
//      これが無いと ①③④ の「卓上だった」は "操作が効かなかっただけ" でも真になってしまう）
//   ⑥ **救済できない病的コース**（卓上でも 1 台も置けない）で、`capZeroWarn` と `capReduced` が
//      **同じ経路で両方出ない**こと（「1 台も置けません」と「最大 1 台なら走り出せます」の矛盾の禁止）
//   ⑦ JS エラー 0
//
// 【判定に使う物差しを product の変更対象から独立させる】
//   容量の判定に `capacityOf`/`fitsAllCars` を使うと、**検証対象を物差しにする循環**になる
//   （例: `capacityOf` を `Math.max(1, n)` に戻す退行が、その物差しごと嘘になるので検出できない）。
//   よって ③ は AZ2 が一切触っていない `freeSpawn` + `checkCollision` + `carEdges` で
//   「実際に置かれる位置が壁と交差するか」を直接測る。
//
// 治具は「保存コース」(localStorage `rumicar.courses`) として入れる。保存コースは実在の機能で、
// 選択経路も `selectCourse → applyCourse → enforceFitRatio('course')` と投稿コースと同一。
// 上流 GitHub に依存しないので、レート制限や未配置でぶれない。
import { launch, newPage, appModule } from './lib.mjs';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };

// 外形 18×18m・走れるのは閉じた細い廊下だけ。代理量 target=0.25×18=4.50m はフルスケールの
// 車長を「収まる」と言うが、実際には 1 台も置けない（= 投稿コースと同じ性質）。
const mkFixture = (name, gap) => ({
  name, bounds: { w: 18.0, h: 18.0 }, start: { x: 2.0, y: 9.0, theta: 0 },
  walls: [
    { x1: 1, y1: 9 - gap / 2, x2: 17, y2: 9 - gap / 2 },
    { x1: 17, y1: 9 - gap / 2, x2: 17, y2: 9 + gap / 2 },
    { x1: 17, y1: 9 + gap / 2, x2: 1, y2: 9 + gap / 2 },
    { x1: 1, y1: 9 + gap / 2, x2: 1, y2: 9 - gap / 2 },
  ],
});
const FIX_RESCUABLE = mkFixture('AZ2 狭廊下テスト', 0.30);     // 卓上なら置ける = ④' が救える
const FIX_HOPELESS  = mkFixture('AZ2 極狭廊下テスト', 0.02);   // 卓上でも置けない = ⑤ の警告経路
const NORACE_COURSE = '競技サーキット (フルスケール)';          // ① が fullscale に固定する対照

const logText = (page) => page.evaluate(() => (document.getElementById('log')?.textContent ?? ''));
const regime = (page) => page.evaluate(() => document.getElementById('regimeSel').value);

/** 保存コースとして治具を入れて読み直す（利用者が「保存」した状態と同じ）。 */
async function seed(page, courses) {
  await page.evaluate((list) => {
    const all = JSON.parse(localStorage.getItem('rumicar.courses') || '{}');
    for (const c of list) all[c.name] = c;
    localStorage.setItem('rumicar.courses', JSON.stringify(all));
  }, courses);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
}

/** 領域セレクタを操作し、**ガードが落ち着くまで**待つ（固定待ちにしない）。 */
async function setRegimeAndSettle(page, value) {
  const before = (await logText(page)).length;
  await page.selectOption('#regimeSel', value);
  // 落ち着き = ログが増えて 1 秒以上静止する（④' は fitsAllCars を回すので時間が読めない）。
  await page.waitForFunction((n) => {
    const el = document.getElementById('log');
    const len = (el?.textContent ?? '').length;
    window.__az2 = window.__az2 || {};
    if (window.__az2.len !== len) { window.__az2.len = len; window.__az2.at = Date.now(); return false; }
    return len >= n && Date.now() - (window.__az2.at || 0) > 1000;
  }, before, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(300);
  return (await logText(page)).slice(before);
}

/**
 * ③ の物差し（AZ2 が触っていないオラクルだけを使う）。
 * 現在のライブな車体寸法で、このコースに 1 台目を置いたら壁と交差するか。
 */
async function spawnHitsWall(page, spec) {
  return page.evaluate(async (s) => {
    const [fleet, course, physics] = await Promise.all([
      import(new URL('js/fleet.js', location.href).href),
      import(new URL('js/course.js', location.href).href),
      import(new URL('js/physics.js', location.href).href),
    ]);
    const c = course.normalizeCourse(s);
    const sp = fleet.freeSpawn(c, [], 0);
    return physics.checkCollision(new physics.Car(sp), c.walls);
  }, spec);
}
const liveCarLen = (page) => appModule(page, 'js/config.js', (m) => m.CAR.length);

const browser = await launch();

// ── ⑤ 対照: selectOption('#regimeSel','fullscale') が本当に効くことを先に示す ────────────
{
  console.log('\n【⑤ 対照】noRace の大型コースはフルスケールに留まる（操作が効いている証拠）');
  const { page, errors } = await newPage(browser);
  await page.selectOption('#courseSel', NORACE_COURSE);
  await page.waitForTimeout(800);
  const reg = await regime(page);
  ok(reg === 'fullscale', `「${NORACE_COURSE}」は fullscale に固定される（実測 regime=${reg}）`);
  ok(errors.length === 0, `⑦ JS エラー 0 件${errors.length ? ' — ' + errors.slice(0, 3).join(' / ') : ''}`);
  await page.close();
}

// ── ①②③ 救済できる治具 × フルスケール ────────────────────────────────────────────
{
  console.log('\n【①②③】1 台も置けないコース × フルスケール領域 → 卓上へ自動復帰');
  const { page, errors } = await newPage(browser);
  await seed(page, [FIX_RESCUABLE]);

  const opts = await page.evaluate(() => [...document.getElementById('courseSel').options].map(o => o.value));
  ok(opts.includes(FIX_RESCUABLE.name), `治具コースが一覧に出た（保存コース経路・選択肢 ${opts.length} 件）`);

  await page.selectOption('#courseSel', FIX_RESCUABLE.name);
  await page.waitForTimeout(600);
  ok(await regime(page) === 'tabletop', '治具コース選択直後の領域 = 卓上（既定のまま）');
  ok(await spawnHitsWall(page, FIX_RESCUABLE) === false, '選択直後は壁の中に湧いていない（前提の確認）');

  const added = await setRegimeAndSettle(page, 'fullscale');
  const reg = await regime(page);
  ok(reg === 'tabletop', `① フルスケールを選んでも領域が卓上へ自動で戻った（実測 regime=${reg}）`);
  ok(/1 台も置けません|Not a single car can be placed/.test(added),
     '② 無言でない: 「1 台も置けない」旨と理由がログに出た');
  ok(!/置けません \(壁に当たらず.*台にします|Setting the field from/.test(added),
     '② 救済できたので capN=0 の警告は出ていない');

  const len = await liveCarLen(page);
  ok(await spawnHitsWall(page, FIX_RESCUABLE) === false,
     `③ 落ち着いた先で車は壁の中に湧かない（独立オラクル freeSpawn+checkCollision・実効車長 ${len.toFixed(3)}m）`);
  ok(len < 0.3, `③ 実効車長が卓上相当に戻っている（${len.toFixed(3)}m）`);
  ok(errors.length === 0, `⑦ JS エラー 0 件${errors.length ? ' — ' + errors.slice(0, 3).join(' / ') : ''}`);
  await page.close();
}

// ── ④ 既存コースの挙動は変わっていない ──────────────────────────────────────────
{
  console.log('\n【④】通常のプリセットコース × フルスケール（既存挙動の回帰）');
  const { page, errors } = await newPage(browser);
  const first = await page.evaluate(() => document.getElementById('courseSel').options[0].value);
  await page.selectOption('#courseSel', first);
  await page.waitForTimeout(500);

  const added = await setRegimeAndSettle(page, 'fullscale');
  const reg = await regime(page);
  ok(reg === 'tabletop', `「${first}」でも従来どおり卓上へ戻る（② の代理量による復帰・regime=${reg}）`);
  ok(/大きすぎて入りません|too small for the full-scale/.test(added),
     '④ 出るのは従来の ② の文言（代理量による復帰）');
  ok(!/1 台も置けません|Not a single car can be placed/.test(added),
     "④ ④' の文言は出ない = 既存コースでは新しい救済が発火していない");
  ok(errors.length === 0, `⑦ JS エラー 0 件${errors.length ? ' — ' + errors.slice(0, 3).join(' / ') : ''}`);
  await page.close();
}

// ── ⑥ 救済できない病的コース: 矛盾する 2 行を出さない ────────────────────────────
{
  console.log('\n【⑥】卓上でも 1 台も置けないコース → 警告は出るが、矛盾する 2 行にはならない');
  const { page, errors } = await newPage(browser);
  await seed(page, [FIX_HOPELESS]);

  const before = (await logText(page)).length;
  await page.selectOption('#courseSel', FIX_HOPELESS.name);
  await page.waitForTimeout(1500);
  const added = (await logText(page)).slice(before);

  ok(await spawnHitsWall(page, FIX_HOPELESS) === true,
     '⑥ 前提: このコースは卓上でも車が壁と交差する（救済不能であることの確認）');
  const zero = /台にしますが|Setting the field from/.test(added);
  const reduced = /しか壁に当たらず走り出せません|can only hold/.test(added);
  ok(zero, '⑥ 実態ゼロを告知している（無言でない）');
  ok(!reduced, '⑥ 「最大 n 台なら走り出せます」とは言っていない（矛盾する 2 行を出さない）');
  ok(!(zero && reduced), '⑥ capZeroWarn と capReduced が同時に出ていない');
  ok(errors.length === 0, `⑦ JS エラー 0 件${errors.length ? ' — ' + errors.slice(0, 3).join(' / ') : ''}`);
  await page.close();
}

await browser.close();

const line = '─'.repeat(64);
console.log('\n' + line);
console.log('AZ2 フィットガード 実ブラウザゲート');
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log(line); for (const m of fails) console.log('  ✗ ' + m); }
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
