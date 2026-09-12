// check_az1_submit.mjs — AZ1 投稿導線の実ブラウザ検証 (headed Chrome on Xvfb)
// ════════════════════════════════════════════════════════════════════════════
// 受け入れ基準 (PLAN AZ1) のうち **卓上ゲートでは測れない部分** を実機で測る:
//   ① 1 クリックのユーザー操作から **download と window.open の両方** が発火する
//   ② 遷移先 URL が投稿物の大きさに依存しない (壁 366 本の実投稿相当でも同一・2,000 文字未満)
//   ③ 書き出されたファイルの中身が編集器のコースと一致する (投稿物が欠けない)
//   ④ **失敗を無言にしない**: ポップアップが塞がれても JSON 書出は成功し、ログに 1 行出る
//   ⑤ 「🌐保存」(プログラム投稿) も同じ性質を持つ
//
// デモ専用の抜け道は作らず、利用者と同じ UI 要素だけを触る (CI-8)。
//
// 【④ の「塞がれた状態」をどう作るか — 2026-09-12 に 4 方式で実測した結果】
//   ① Playwright 既定 / ② --block-new-web-contents / ③ ②+ignoreDefaultArgs(--disable-popup-blocking)
//   ④ プロファイルの content setting popups=2
//   **4 方式すべてで window.open は null を返さなかった。** Chrome は
//   **ユーザー操作由来の window.open を popup blocker で阻止しない** (意図的な設計で、
//   ポップアップブロッカーが止めるのは操作に紐づかない window.open だけ)。
//   ゆえに「Chrome で実際に塞がれた状態」はこのハーネスでは作れない。
//   一方この分岐は実在する経路である (拡張機能・企業ポリシー・他ブラウザでは塞がれうる) ので、
//   **window.open だけを null に差し替えて**再現する。差し替えるのはブラウザ API であって
//   product ではない — 走るのは main.js の本物の `if (!opened)` 分岐そのもの (CI-8 を破らない)。
import { launch, newPage, appModule, APP_URL } from './lib.mjs';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };

const UPLOAD_COURSE = 'https://github.com/RumiCar-group/RumiCar/upload/master/courses/community';
const UPLOAD_PROG   = 'https://github.com/RumiCar-group/RumiCar/upload/master/programs/community';
const BUDGET = 2000;

// 編集器へ壁 n 本のコースを入れる。**利用者と同じ経路**=「JSON 読込」の file input に
// 実ファイルを渡す (編集器 API を直接叩かない)。座標は丸めない = 編集器が持つ生の倍精度。
function synthCourse(n, name) {
  const walls = [];
  for (let i = 0; i < n; i++) {
    const a = (i * Math.PI) / 97, b = (i * Math.E) / 89;
    walls.push({ x1: 1 + Math.sin(a) / 3, y1: 1 + Math.cos(a) / 3,
                 x2: 1 + Math.sin(b) / 3, y2: 1 + Math.cos(b) / 3 });
  }
  return { name, bounds: { w: 18.36326, h: 18.70771 },
           start: { x: 4.131, y: 7.649, theta: 0.639579127024498 },
           finish: { x1: 4.04147, y1: 7.76935, x2: 4.22053, y2: 7.52865 }, walls };
}

async function openEditorWith(page, course) {
  await page.click('#editToggle');
  await page.waitForSelector('#edShare', { state: 'visible', timeout: 10000 });
  await page.setInputFiles('#edImport', {
    name: (course.name || 'c') + '.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(course, null, 2), 'utf8'),
  });
  await page.waitForTimeout(600);
}

const logText = (page) => page.evaluate(() => document.getElementById('log').textContent);

// ── 本番 (ポップアップが通る) ────────────────────────────────────────────────
{
  const browser = await launch();
  const { page, errors } = await newPage(browser, { width: 1440 });
  const ver = await appModule(page, 'js/config.js', (m) => m.APP_VERSION);
  console.log(`\n[本番経路] APP_VERSION=${ver}  ${APP_URL}`);

  for (const nWalls of [8, 366]) {
    const src = synthCourse(nWalls, `ゲート検証コース${nWalls}`);
    await openEditorWith(page, src);
    const before = (await logText(page)).length;

    const dlP = page.waitForEvent('download', { timeout: 15000 });
    const popP = page.waitForEvent('popup', { timeout: 15000 });
    await page.click('#edShare');                       // ← 1 クリックだけ
    const [dl, pop] = await Promise.all([dlP, popP]);

    const url = pop.url();
    ok(!!dl, `壁 ${nWalls} 本: 1 クリックで download が発火した`);
    ok(!!pop, `壁 ${nWalls} 本: 同じ 1 クリックで新しいタブが開いた`);
    ok(url === UPLOAD_COURSE, `壁 ${nWalls} 本: 遷移先が投稿ページ (実測 ${url})`);
    ok(url.length < BUDGET, `壁 ${nWalls} 本: 遷移先 URL ${url.length} 文字 < ${BUDGET}`);
    ok(!/[?&#]/.test(url), `壁 ${nWalls} 本: 遷移先 URL にクエリ/フラグメントが無い`);

    const path = await dl.path();
    const body = await (await import('node:fs/promises')).readFile(path, 'utf8');
    let back = null; try { back = JSON.parse(body); } catch (e) { /* 下で落ちる */ }
    // **期待値と厳密に比べる**。以前は `|| /\.json$/` を付けていたため右辺が左辺を殺し、
    // 日本語コース名が時刻フォールバックへ落ちる劣化 (B-5) を「.json だから合格」で通していた。
    // slugify は ASCII 英数以外を落とすので `ゲート検証コース366` → `366.json` が正しい期待値。
    ok(dl.suggestedFilename() === `${nWalls}.json`,
       `壁 ${nWalls} 本: 保存名が期待どおり (期待 ${nWalls}.json / 実測 ${dl.suggestedFilename()})`);
    ok(back && back.walls && back.walls.length === nWalls,
       `壁 ${nWalls} 本: 書き出した JSON の壁数が一致 (実測 ${back && back.walls && back.walls.length})`);
    ok(back && JSON.stringify(back.walls) === JSON.stringify(src.walls),
       `壁 ${nWalls} 本: 壁座標が原本と完全一致 (丸め落ちが無い・${body.length} 文字)`);
    ok(body.length > (nWalls > 100 ? 6600 : 0),
       `壁 ${nWalls} 本: 投稿物 ${body.length} 文字 (旧方式ならこれが URL に載った)`);

    const added = (await logText(page)).slice(before);
    ok(/ダウンロードを開始しました/.test(added), `壁 ${nWalls} 本: 書き出しを知らせる 1 行が出た`);
    ok(!/ブロック/.test(added), `壁 ${nWalls} 本: ポップアップ阻止の通知は出ていない`);
    ok(/開いた GitHub のページ/.test(added), `壁 ${nWalls} 本: 開けたときは「開いた GitHub のページ」と案内する`);
    await pop.close();
    await page.click('#editToggle');                    // 編集器を閉じて次へ
    await page.waitForTimeout(300);
  }

  // ⑤ プログラム投稿 (車カードの 🌐保存 = 利用者が最初に押す経路)。
  // 名前入力の prompt は利用者と同じく「入力して OK」で応じる。
  page.on('dialog', (d) => d.accept('gate-prog'));
  const beforeP = (await logText(page)).length;
  const dlP2 = page.waitForEvent('download', { timeout: 15000 });
  const popP2 = page.waitForEvent('popup', { timeout: 15000 });
  await page.click('.cc-share');
  const [dl2, pop2] = await Promise.all([dlP2, popP2]);
  ok(pop2.url() === UPLOAD_PROG, `プログラム: 遷移先が programs/community の投稿ページ (実測 ${pop2.url()})`);
  ok(pop2.url().length < BUDGET, `プログラム: 遷移先 URL ${pop2.url().length} 文字 < ${BUDGET}`);
  ok(/\.(ino|py|js)$/.test(dl2.suggestedFilename()), `プログラム: 保存名の拡張子 (実測 ${dl2.suggestedFilename()})`);
  const prog = await (await import('node:fs/promises')).readFile(await dl2.path(), 'utf8');
  ok(prog.length > 100, `プログラム: 本文 ${prog.length} 文字が書き出された`);
  ok(/ダウンロードを開始しました/.test((await logText(page)).slice(beforeP)), 'プログラム: 書き出しを知らせる 1 行が出た');
  await pop2.close();

  ok(errors.length === 0, `JS エラー 0 件 (実測 ${errors.length}${errors.length ? ': ' + errors.join(' | ') : ''})`);
  await browser.close();
}

// ── ④ ポップアップが塞がれた状態 (window.open が null を返す環境の再現) ─────────
{
  const browser = await launch();
  const { page } = await newPage(browser, { width: 1440 });
  // ページ側の window.open を「常に阻止される」実装へ差し替える。goto より前に入れる。
  await page.addInitScript(() => { window.open = () => null; });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  console.log('\n[ポップアップ阻止下 (window.open→null で再現)]');
  await openEditorWith(page, synthCourse(366, '阻止検証'));
  const before = (await logText(page)).length;

  const blocked = await page.evaluate(() => window.open('x', '_blank') === null);
  ok(blocked, '前提: この文脈では window.open が null を返す');

  const dlP = page.waitForEvent('download', { timeout: 15000 });
  let popped = false;
  page.once('popup', () => { popped = true; });
  await page.click('#edShare');
  const dl = await dlP;                     // ←ここが通ることが「JSON 書出だけは必ず成功」
  await page.waitForTimeout(1200);
  const added = (await logText(page)).slice(before);

  ok(!!dl, '阻止下でも download は発火した (投稿物は手元に残る)');
  const body = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
  ok(JSON.parse(body).walls.length === 366, `阻止下でも投稿物は完全 (壁 ${JSON.parse(body).walls.length} 本・${body.length} 文字)`);
  ok(!popped, '阻止下で新しいタブは開かなかった (前提の確認)');
  ok(/ダウンロードを開始しました/.test(added), '阻止下でも書き出しを知らせる 1 行が出た');
  ok(added.includes(UPLOAD_COURSE),
     '阻止下: 開くべき URL がログに出ている (無言で諦めていない)');
  ok(/ブロック/.test(added), '阻止下: ポップアップ阻止の可能性を通知している');
  // **矛盾する 2 行を出さない**: 開けていないのに「開いた GitHub のページに」と言わないこと。
  ok(!/開いた GitHub のページ/.test(added),
     '阻止下: 「開いた GitHub のページ」とは言っていない (矛盾する案内を出さない)');
  ok(/自分で開き/.test(added), '阻止下: 自分で開くよう案内している');
  await browser.close();
}

const line = '─'.repeat(64);
console.log('\n' + line);
console.log('AZ1 投稿導線 実ブラウザゲート');
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log(line); for (const m of fails) console.log('  ✗ ' + m); }
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
