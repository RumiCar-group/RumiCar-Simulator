// check_az2_fitguard.mjs — AZ2/AZ6 フィットガードの実ブラウザ検証 (headed Chrome on Xvfb)
// ════════════════════════════════════════════════════════════════════════════
// **【AZ6・2026-09-13 で射程が変わった】** AZ2 期はここが「新ロジックを実際に実行する唯一のゲート」
// だった（卓上ゲートは判定順序の**写し**を動かしており product を 1 行も実行しなかった）。AZ6 で
// 判定を `public/js/fitguard.js` へ分離したので、**判定そのものは卓上ゲート `wf_az2_fitguard.mjs` が
// 全格子 1188 セルで実行する**。∴ ここが受け持つのは **DOM と適用側** — 領域セレクタ・carScale
// スライダーの値域・表示ラベル・ログ・スロット操作、つまり node では回せない部分である。
// （写しが無くなったので「写しが緑でも product が壊れていてよい」問題は消えたが、**DOM の値域丸め**
//   のような穴はここでしか見えない。実際 AZ6 の三重ズレはそれだった。）
//
// 測ること:
//   ① 「車が 1 台も置けない」コース × フルスケール領域 を選ぶと、**領域が卓上へ自動で戻る**
//   ② そのとき **無言でない**（ログに理由が 1 行出る）
//   ③ 落ち着いた先で **車が壁の中に湧かない**
//   ④ **既存コースの挙動を変えていない**: 通常のプリセットでは ④' の告知が出ず、従来の ② だけが働く
//   ⑤ **対照**: noRace の大型コースはフルスケールに留まる（= `selectOption` が本当に効いている証拠。
//      これが無いと ①③④ の「卓上だった」は "操作が効かなかっただけ" でも真になってしまう）
//   ⑥ **救済できない病的コース**（卓上でも 1 台も置けない）で、実態ゼロを告知しつつ
//      「最大 n 台なら走り出せます」(`capReduced`) とは**言わない**こと（矛盾する 2 行の禁止）。
//      減らす台数が無い経路なので文言は `capZeroWarnOnly`（**していない台数変更を告げない**・AZ6）。
//   ⑦ JS エラー 0
//   ⑧ **【AZ6】carScale の三重ズレが無い**: `#carScale` の value・表示ラベル・`SCALE_STATE.userK` が
//      一致し、いずれもスライダーの `min` を下回らない（旧は 0.4 へ落ちて DOM が 0.5 へ丸めていた）。
//   ⑨ **【AZ6】④' の経路で carScale が復元される**: 卓上へ戻したあと、入口のスライダー値で
//      収まるならその値のまま（旧は ③④ が先に下限まで削り、② 経路と 5 倍の不連続があった）。
//   ⑩ **【AZ6】既定の 1 台編成でも、走り出せないコースは ▶ の直前に告知される**
//      （旧は `slots.length > 1` で落ちて無言。AZ5 の申し送り）。
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
  // 既定は 1 台編成 = 減らす台数が無い経路なので、文言は capZeroWarnOnly（AZ6 で新設）。
  const zero = /1 台も置けません|Not a single car fits/.test(added);
  const reduced = /しか壁に当たらず走り出せません|can only hold/.test(added);
  const falseCount = /台から 1 台にします|Setting the field from/.test(added);
  ok(zero, '⑥ 実態ゼロを告知している（無言でない）');
  ok(!reduced, '⑥ 「最大 n 台なら走り出せます」とは言っていない（矛盾する 2 行を出さない）');
  ok(!falseCount, '⑥ 台数を変えていないのに「{was} 台から {n} 台にします」と言っていない（AZ6）');
  ok(errors.length === 0, `⑦ JS エラー 0 件${errors.length ? ' — ' + errors.slice(0, 3).join(' / ') : ''}`);
  await page.close();
}

// ── ⑧ 【AZ6】carScale の DOM・状態・ラベル・塗りの一致（**下限に実際に触れる状態で測る**）────
// 旧実装は ③④ が `Math.max(0.4, …)` まで下げる一方、`index.html` のスライダーは `min="0.5"`。
// Chromium は `csEl.value = "0.4"` を **"0.5" へ丸める**ので、状態 0.4 / DOM 0.5 / ラベル "0.4×" の
// 三重ズレが残っていた（**node では原理的に見えない＝ここでしか測れない**）。
// ⚠ **初版はこれを `FIX_RESCUABLE`（廊下 0.30m）で測っており、空振りだった**（層 4 レビュー 2026-09-13）。
//   あのセルは ④' が入口倍率 0.8 を復元して終わるので **carScale が一度も下限に触らず**、
//   「0.8 ≧ min 0.5」は下限を 0.4 に戻しても真＝何も守っていなかった。
//   ∴ **下限まで削られる `FIX_HOPELESS`（廊下 0.02m → 卓上 cs0.5 に落ち着く）**で測り直す。
{
  console.log('\n【⑧】carScale が下限まで削られた状態で DOM・状態・ラベル・塗りが一致する（AZ6）');
  const { page, errors } = await newPage(browser);
  await seed(page, [FIX_HOPELESS]);
  const before = (await logText(page)).length;
  await page.selectOption('#courseSel', FIX_HOPELESS.name);
  await page.waitForTimeout(1500);
  const added = (await logText(page)).slice(before);

  const st = await page.evaluate(async () => {
    const cfg = await import(new URL('js/config.js', location.href).href);
    const el = document.getElementById('carScale');
    const m = /([0-9.]+)%/.exec(el.style.background || '');
    return {
      min: Number(el.min), max: Number(el.max), dom: Number(el.value),
      label: document.getElementById('carScalev').textContent,
      userK: cfg.SCALE_STATE.userK,
      paintPct: m ? Number(m[1]) : null,
    };
  });
  // **前提（これが無いと「たまたま下限でなかった」を見逃す）**: このセルは実際に下限まで削られている。
  ok(/車体スケール|car scale/i.test(added) && Math.abs(st.userK - st.min) < 1e-9,
     `⑧ 前提: carScale が下限まで削られた（状態 ${st.userK} = スライダー min ${st.min}・縮小の告知あり）`);
  ok(Math.abs(st.dom - st.userK) < 1e-9,
     `⑧ スライダーの値と SCALE_STATE.userK が一致（DOM ${st.dom} / 状態 ${st.userK}）`);
  ok(st.label === st.userK.toFixed(1) + '×',
     `⑧ 表示ラベルも一致（ラベル "${st.label}" / 状態 ${st.userK.toFixed(1)}×）`);
  ok(st.userK >= st.min - 1e-9,
     `⑧ 状態がスライダーの min を下回らない（${st.userK} ≧ ${st.min}）`);
  // 4 つ目のズレ: paintRange は input イベントにしか繋がっていないので、プログラム代入では
  // 塗りが元位置に残る。fx.sync が明示的に塗り直していることを実測する。
  const expectPct = Math.round(((st.userK - st.min) / (st.max - st.min)) * 100);
  ok(st.paintPct === expectPct,
     `⑧ スライダーの塗りつぶしも追従（実測 ${st.paintPct}% / 期待 ${expectPct}%）`);
  ok(errors.length === 0, `⑦ JS エラー 0 件${errors.length ? ' — ' + errors.slice(0, 3).join(' / ') : ''}`);
  await page.close();
}

// ── ⑨ 【AZ6】④' の経路で carScale が入口の倍率へ復元される ──────────────────────────
// 旧は ③④ が先に下限まで削り、④' で卓上へ戻したあとも復元しなかったため、同じコースで
// スライダー 0.8 → 車長 0.076m ／ 2 → 0.380m と 5 倍の不連続になっていた。
{
  console.log("\n【⑨】④' で卓上へ戻したあと carScale が入口の倍率のまま（AZ6）");
  const { page, errors } = await newPage(browser);
  await seed(page, [FIX_RESCUABLE]);
  await page.selectOption('#courseSel', FIX_RESCUABLE.name);
  await page.waitForTimeout(600);
  const entry = await page.evaluate(() => document.getElementById('carScale').value);
  const added = await setRegimeAndSettle(page, 'fullscale');   // ④' を通す（→ 卓上へ戻る）

  // **前提**: このブロック単独で「④' が実際に発火した」ことを固定する
  // （②「大きすぎて入りません」で戻った場合も卓上になるので、それでは復元の検査にならない）。
  ok(/1 台も置けません|Not a single car can be placed/.test(added),
     "⑨ 前提: ④'（実態収容ゼロの救済）が発火した — ② の代理量復帰ではない");
  const st = await page.evaluate(async () => {
    const cfg = await import(new URL('js/config.js', location.href).href);
    return { dom: Number(document.getElementById('carScale').value), userK: cfg.SCALE_STATE.userK,
             label: document.getElementById('carScalev').textContent };
  });
  ok(Math.abs(st.userK - Number(entry)) < 1e-9,
     `⑨ ④' 後も入口の倍率 ${entry}× のまま（復元された。実測 ${st.userK}×）`);
  ok(Math.abs(st.dom - st.userK) < 1e-9 && st.label === st.userK.toFixed(1) + '×',
     `⑨ DOM・ラベルもそろっている（DOM ${st.dom} / ラベル "${st.label}"）`);
  ok(errors.length === 0, `⑦ JS エラー 0 件${errors.length ? ' — ' + errors.slice(0, 3).join(' / ') : ''}`);
  await page.close();
}

// ── ⑩ 【AZ6】既定の 1 台編成でも「走り出せない」が ▶ の直前に告知される ──────────────
// AZ5 の申し送り: ⑥ は `slots.length > 1` で落ちるので、静的には置けるが 1 台も走り出せない
// コースを既定（1 台）で開いても**無言**だった（🏁 も `capacityOf(course,1)=1` なので NO_ROOM に
// ならず「0台完走 / 1台リタイア」だけが出る）。AZ6 は発走直前 (reason==='race') に 1 台ぶんの
// 実走プローブを払って告知する。**利用者の操作（▶ を押す）だけで確かめる。**
{
  console.log('\n【⑩】静的には置けるが 1 台も走り出せないコース → ▶ の直前に告知（AZ6）');
  const { page, errors } = await newPage(browser);
  // 卓上の実寸から「閉じた部屋 幅 4×車幅 × 奥行 1.7×車長」を作る（AZ5 と同じ治具の作り方）。
  const room = await page.evaluate(async () => {
    const cfg = await import(new URL('js/config.js', location.href).href);
    const L = cfg.CAR.length / cfg.SCALE_STATE.userK, W = cfg.CAR.width / cfg.SCALE_STATE.userK;
    const X = 1.7 * L, Y = 4 * W;
    return { name: 'AZ6 動けない部屋', bounds: { w: X, h: Y }, start: { x: X / 2, y: Y / 2, theta: 0 },
      walls: [{ x1: 0, y1: 0, x2: X, y2: 0 }, { x1: X, y1: 0, x2: X, y2: Y },
              { x1: X, y1: Y, x2: 0, y2: Y }, { x1: 0, y1: Y, x2: 0, y2: 0 }] };
  });
  await seed(page, [room]);
  await page.selectOption('#courseSel', room.name);
  await page.waitForTimeout(800);

  const nCars = await page.evaluate(() => document.querySelectorAll('#fleetCols .carcol').length);
  ok(nCars === 1, `⑩ 前提: 既定の 1 台編成のまま（実測 ${nCars} 台）`);
  ok(!/走り出せる車が 1 台もありません|not one of them can actually pull away/.test(await logText(page)),
     '⑩ 前提: コース選択の時点では告知していない（コース閲覧に実走コストを払わない）');

  // **差分で見ない。** `startAuto` は先頭で `clearLog()` を呼ぶのでログは短くなる（前の長さで
  // slice すると必ず空文字になる＝検査が何も見ない。初版で実際にそうなった）。走行開始後の
  // 全文をそのまま見る。
  await page.click('#run');                // ▶ 自動走行（startAuto → enforceFitRatio('race')）
  await page.waitForTimeout(2500);
  const added = await logText(page);
  ok(/▶|Started/.test(added), '⑩ 前提: ▶ が実際に走行を開始した（クリックが効いている）');
  ok(/走り出せる車が 1 台もありません|not one of them can actually pull away/.test(added),
     '⑩ ▶ の直前に「実際に走り出せる車が 1 台もありません」と告知された（既定編成でも無言でない）');
  ok(!/台から 1 台にします|Setting the field from/.test(added),
     '⑩ 台数を変えていないので「{was} 台から {n} 台にします」とは言わない');
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
