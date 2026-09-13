// check_az5_race.mjs — AZ5「収容ゼロを全経路で正直に扱う」の実ブラウザ検証 (headed Chrome on Xvfb)
// ════════════════════════════════════════════════════════════════════════════
// **これが AZ5 の UI 側を実際に実行する唯一のゲート。** 卓上ゲート `wf_az5_capzero.mjs` は
// `race_engine` / `capacity` を直接叩けるが、`enforceFitRatio` ⑥ と 4 つのレース呼び出し側は
// DOM 結合で node から呼べず、あちらは**正規表現の構造検査**で隙間を埋めているだけである
// （AZ2 の層 4 レビュー 2026-09-12 の指摘と同じ構図）。ここでは利用者と同じ UI 操作だけで
// 本物の `main.js` を走らせて確かめる（CI-8）。
//
// 測ること:
//   ① ⑥ 経路: 「置けるが実走で 1 台も走り出せない」コース × 多台 → `capZeroDriveWarn` が出て、
//      `capReduced`（「最大 n 台なら走り出せます」）は **出ない**。旧実装は driveableCapN が 0 を 1 へ
//      丸めていたので、ここで capReduced という **嘘**を出していた。
//   ② 🏁 レース: 収容 0 台のコースでは **レースを開始せず** 専用文言を出す。結果ダイアログを開かない
//      （＝ 0 台のレースを「成立した」ことにしない）。
//   ③ 📋 開催: 収まらないぶんを減らして走ったら **必ず言う**（`log.race.fitReduced`）。
//      `fitReduced` はエンジンが AK5 以来返していたのに **呼び出し側が誰も読んでいなかった**。
//   ④ 回帰＋対照: 通常のプリセットコースでは新文言が一切出ず、レースは従来どおり成立して
//      結果ダイアログが開く（＝ ②③ の「開かなかった」が "操作が効かなかっただけ" でない証拠）。
//   ⑤ JS エラー 0。
//
// 【判定の物差し】②④ は「結果ダイアログが開いたか」という **ログとは独立な UI の状態**で測る。
//   ログ文字列だけで判定すると、文言を変えただけの退行と、レースを止めた/止めなかったの違いを
//   区別できない。③ は「ログが言う台数」と「結果表の行数」を突き合わせる（2 つの独立な表面）。
//
// 【言語を固定する】判定が日本語文言に依存するので、本番 UI の `#langSel` で ja を明示する
//   （ホスト locale が ja 以外だと赤くなる既存の踏襲事故 = AZ4 の層 4 レビュー指摘）。
//
// 治具は「保存コース」(localStorage `rumicar.courses`) として入れる。保存コースは実在の機能で、
// 選択経路も `selectCourse → applyCourse → enforceFitRatio('course')` と投稿コースと同一。
// 上流 GitHub に依存しないのでレート制限や未配置でぶれない。
import { launch, newPage, appModule, setLang } from './lib.mjs';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };

// ── 治具（寸法は卓上・carScale 1 の CAR 0.190×0.080 m を前提に選定。実測で性質を確認済み）──────
// (1) 袋小路の部屋: 静的には 3 台置けるが、実走では 1 台も車長ぶん動けない（⑥ 経路の母体）。
//     奥行 1.7×車長 = 前方 0.5 車長は空く（fitsAllCars の driveable 判定を満たす）が車長ぶんは走れない。
//     幅 4×車幅 = 横に複数台並べられる（静的 capN ≥ 2 ＝ ⑥ に入る条件）。
const ROOM_X = 1.7 * 0.190, ROOM_Y = 4.0 * 0.080;
const FIX_ROOM = {
  name: 'AZ5 袋小路テスト',
  bounds: { w: ROOM_X + 0.2, h: ROOM_Y + 0.2 },
  start: { x: 0.5 * 0.190 + 0.005, y: ROOM_Y / 2, theta: 0 },
  walls: [
    { x1: 0, y1: 0, x2: ROOM_X, y2: 0 }, { x1: ROOM_X, y1: 0, x2: ROOM_X, y2: ROOM_Y },
    { x1: ROOM_X, y1: ROOM_Y, x2: 0, y2: ROOM_Y }, { x1: 0, y1: ROOM_Y, x2: 0, y2: 0 },
  ],
};
// 閉じた廊下。gap と長さで収容台数を決める。finish を持たせないと `raceableCourse()` が先に止める。
const corridor = (name, len, gap) => {
  const xa = 1.0, xb = 1.0 + len, yc = 9.0;
  return {
    name, bounds: { w: 18, h: 18 }, start: { x: xa + 0.15, y: yc, theta: 0 },
    finish: { x1: xa + 0.05, y1: yc - gap / 2, x2: xa + 0.05, y2: yc + gap / 2, fx: 1, fy: 0 },
    walls: [
      { x1: xa, y1: yc - gap / 2, x2: xb, y2: yc - gap / 2 },
      { x1: xb, y1: yc - gap / 2, x2: xb, y2: yc + gap / 2 },
      { x1: xb, y1: yc + gap / 2, x2: xa, y2: yc + gap / 2 },
      { x1: xa, y1: yc + gap / 2, x2: xa, y2: yc - gap / 2 },
    ],
  };
};
// (2) 収容 0 台（卓上でも置けない極狭）＋ finish。🏁 が NO_ROOM で止まる母体。
const FIX_NOROOM = corridor('AZ5 収容ゼロテスト', 1.0, 0.02);
// (3) 収容 2 台（静的 capacityOf=2 を実測済み）＋ finish。📋 の補充 3 台で 1 台減る母体。
const FIX_REDUCE = corridor('AZ5 減台テスト', 0.8, 0.12);

const logText = (page) => page.evaluate(() => (document.getElementById('log')?.textContent ?? ''));
// **結果ダイアログが開くのを待つ。** レースは発走演出 (3-2-1-GO) を挟むので、ログの静止で判定すると
//   演出中に抜けてしまう。②「開かない」は `waitForFunction` のタイムアウトで示す。
//   ⚠ **④ が同じ予算で真になることは、② の予算の十分性を保証しない**（層 4 レビュー 軽-8）:
//   ④ の母体は正常プリセット（ガードは数 ms）、② の母体は `freeSpawn` が廊下 BFS へ落ちる病的コースで、
//   `waitForFunction` はメインスレッドが同期処理でブロックされている間ポーリングできない。
//   ∴ ②「開かない」は**単独では弱い**ので、`RE.raceNoRoom`（開始しなかった旨のログ）と**併せて**判定する。
const RACE_DLG_MS = 25000;
const waitRaceDlg = (page, ms = RACE_DLG_MS) =>
  page.waitForFunction(() => !!document.getElementById('dlgRace')?.open, null, { timeout: ms })
      .then(() => true).catch(() => false);

/** 保存コースとして治具を入れて読み直す（利用者が「保存」した状態と同じ）。 */
async function seed(page, courses) {
  await page.evaluate((list) => {
    const all = JSON.parse(localStorage.getItem('rumicar.courses') || '{}');
    for (const c of list) all[c.name] = c;
    localStorage.setItem('rumicar.courses', JSON.stringify(all));
  }, courses);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await setLang(page, 'ja');
  await page.waitForTimeout(300);
}

/** ログが増えて静止するまで待つ（⑥ は実走プローブを回すので所要が読めない＝固定待ちにしない）。 */
async function settle(page, before, quietMs = 1200, timeout = 90000) {
  // **quietMs を実際に使う（層 4 レビュー 軽-7 是正）。** 初版は本体に 1200 を直書きしており、
  //   呼び出し側が渡す 800 が黙って無視されていた＝引数が嘘をついていた。
  await page.waitForFunction(({ n, q }) => {
    const len = (document.getElementById('log')?.textContent ?? '').length;
    window.__az5 = window.__az5 || {};
    if (window.__az5.len !== len) { window.__az5.len = len; window.__az5.at = Date.now(); return false; }
    return len >= n && Date.now() - (window.__az5.at || 0) > q;
  }, { n: before, q: quietMs }, { timeout }).catch(() => {});
  await page.waitForTimeout(300);
  return (await logText(page)).slice(before);
}

// 文言の識別子（ja）。同じ経路から出る別メッセージと取り違えないよう、互いに排他な部分文字列を使う。
const RE = {
  capZeroDrive: /置くことはできても実際に走り出せる車が 1 台もありません/,
  capZeroStatic: /車を 1 台も置けません \(壁に当たらず/,
  capReduced: /しか壁に当たらず走り出せません/,
  raceNoRoom: /車を 1 台も配置できないため、レースを開始しませんでした/,
  raceFitReduced: /台に減らして走りました/,
  raceErr: /レース実行エラー/,
};

const browser = await launch();

// ── ④ 回帰＋対照: 通常コースは従来どおり ─────────────────────────────────────────
{
  console.log('\n【④ 回帰＋対照】通常のプリセットコース × 🏁 レース（新文言は出ない・結果は開く）');
  const { page, errors } = await newPage(browser);
  await setLang(page, 'ja');
  await page.evaluate(() => { const c = document.getElementById('raceWatch'); if (c && c.checked) c.click(); });
  const first = await page.evaluate(() => document.getElementById('courseSel').options[0].value);
  await page.selectOption('#courseSel', first);
  await page.waitForTimeout(600);
  const before = (await logText(page)).length;
  await page.click('#raceRun');
  const opened = await waitRaceDlg(page);
  const added = (await logText(page)).slice(before);
  ok(opened === true, `対照: 「${first}」のレースは成立し結果ダイアログが ${RACE_DLG_MS}ms 以内に開く（＝ #raceRun の操作が効いている証拠）`);
  ok(!RE.raceNoRoom.test(added), '④ 収容ゼロの文言は出ない（既存コースで新しい停止が発火していない）');
  ok(!RE.raceFitReduced.test(added), '④ 減台の文言は出ない（既存コースで台数が減っていない）');
  ok(!RE.raceErr.test(added), '④ レース実行エラーも出ていない');
  ok(errors.length === 0, `⑤ JS エラー 0 件${errors.length ? ' — ' + errors.slice(0, 3).join(' / ') : ''}`);
  await page.close();
}

// ── ① ⑥ 経路: 実走の収容ゼロを capReduced と言い換えない ────────────────────────
{
  console.log('\n【①】置けるが実走で 1 台も走り出せないコース × 多台 → 実走ゼロとして告知する');
  const { page, errors } = await newPage(browser);
  await seed(page, [FIX_ROOM]);

  // ⑥ は slots.length > 1 のときだけ実走プローブを回す。先に 1 台足してから治具コースを選ぶ。
  await page.click('#carAdd');
  await page.waitForTimeout(600);
  const nCars = await page.evaluate(() => document.querySelectorAll('#fleetCols .carcol').length);
  ok(nCars >= 2, `前提: 車両を ${nCars} 台にした（⑥ は多台のときだけ実走で測る）`);

  const before = (await logText(page)).length;
  await page.selectOption('#courseSel', FIX_ROOM.name);
  const added = await settle(page, before);

  ok(RE.capZeroDrive.test(added), '① 実走ゼロを告知している（「置くことはできても走り出せる車が 1 台もありません」）');
  ok(!RE.capReduced.test(added), '① 「最大 n 台なら走り出せます」とは言っていない（旧実装が 0→1 の丸めで出していた嘘）');
  ok(!RE.capZeroStatic.test(added), '① 静的ゼロの文言では言い換えていない（理由が違うものを同じ文言にしない）');
  // 独立確認: 静的には置ける（= 静的ゼロではない）ことを、AZ5 が触っていない freeSpawn/checkCollision で測る。
  const staticOk = await page.evaluate(async (s) => {
    const [fleet, course, physics] = await Promise.all([
      import(new URL('js/fleet.js', location.href).href),
      import(new URL('js/course.js', location.href).href),
      import(new URL('js/physics.js', location.href).href),
    ]);
    const c = course.normalizeCourse(s);
    const sp = fleet.freeSpawn(c, [], 0);
    return !physics.checkCollision(new physics.Car(sp), c.walls);
  }, FIX_ROOM);
  ok(staticOk === true, '① 独立オラクル: 1 台目は壁と交差せず置ける（＝ 静的ゼロではない・実走ゼロだけが起きている）');
  ok(errors.length === 0, `⑤ JS エラー 0 件${errors.length ? ' — ' + errors.slice(0, 3).join(' / ') : ''}`);
  await page.close();
}

// ── ② 🏁 レース: 収容 0 台では走らせない ───────────────────────────────────────
{
  console.log('\n【②】収容 0 台のコース × 🏁 レース → 開始せず、結果ダイアログを開かない');
  const { page, errors } = await newPage(browser);
  await seed(page, [FIX_NOROOM]);
  await page.evaluate(() => { const c = document.getElementById('raceWatch'); if (c && c.checked) c.click(); });
  await page.selectOption('#courseSel', FIX_NOROOM.name);
  await settle(page, (await logText(page)).length, 800, 60000);

  const before = (await logText(page)).length;
  await page.click('#raceRun');
  const opened = await waitRaceDlg(page);   // ④ と同じ予算。成立するレースならこの中で必ず開く。
  const added = (await logText(page)).slice(before);

  ok(RE.raceNoRoom.test(added), '② 収容 0 台としてレースを開始しなかった旨がログに出た');
  ok(!RE.raceErr.test(added), '② 技術メッセージ（レース実行エラー）で濁していない');
  ok(opened === false, `② 結果ダイアログが ${RACE_DLG_MS}ms 待っても開かない（0 台のレースを成立させない）`);
  ok(errors.length === 0, `⑤ JS エラー 0 件${errors.length ? ' — ' + errors.slice(0, 3).join(' / ') : ''}`);
  await page.close();
}

// ── ③ 📋 開催: 減らして走ったら必ず言う ──────────────────────────────────────────
{
  console.log('\n【③】収容 2 台のコース × 📋 開催（補充 3 台）→ 減らして走ったことを告知する');
  const { page, errors } = await newPage(browser);
  await seed(page, [FIX_REDUCE]);
  await page.evaluate(() => { const c = document.getElementById('raceWatch'); if (c && c.checked) c.click(); });
  await page.selectOption('#courseSel', FIX_REDUCE.name);
  await settle(page, (await logText(page)).length, 800, 60000);

  await page.click('#eventOpen');
  await page.waitForTimeout(600);
  await page.fill('#evLaps', '1');
  const before = (await logText(page)).length;
  await page.click('#evRace');
  const opened = await waitRaceDlg(page);
  const added = (await logText(page)).slice(before);

  ok(opened === true, '③ レース自体は成立して結果ダイアログが開く（減台であって中止ではない）');
  ok(RE.raceFitReduced.test(added), '③ 減らして走ったことがログに出た（fitReduced を呼び出し側が読んでいる）');
  // **2 つの独立な数を突き合わせる。** 告知の台数は `field.length - res.fitReduced`（エンジンが減らした数）、
  //   完了行の台数は `res.finishers.length + res.dnf.length`（実際に走った車の数）。別の値から計算されるので、
  //   一致することが「告知がログだけの飾りでない」ことの証拠になる。
  const m = added.match(/(\d+) 台に減らして走りました/);
  const said = m ? Number(m[1]) : null;
  const d = added.match(/レース終了: (\d+)台完走 \/ (\d+)台リタイア/);
  const ran = d ? Number(d[1]) + Number(d[2]) : null;
  ok(said !== null && said >= 1, `③ 告知が台数を述べている（${said} 台）`);
  ok(ran !== null && ran === said, `③ 実際に走った台数 ${ran}（完走+リタイア）が告知の ${said} 台と一致`);
  ok(errors.length === 0, `⑤ JS エラー 0 件${errors.length ? ' — ' + errors.slice(0, 3).join(' / ') : ''}`);
  await page.close();
}

await browser.close();

const line = '─'.repeat(64);
console.log('\n' + line);
console.log('AZ5 収容ゼロ 実ブラウザゲート');
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log(line); for (const m of fails) console.log('  ✗ ' + m); }
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
