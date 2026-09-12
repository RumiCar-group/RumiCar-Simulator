// check_az4_race_submit.mjs — AZ4 投稿導線 (公式レース / 車種) の実ブラウザ検証
// ════════════════════════════════════════════════════════════════════════════
// AZ1 が直したのは course と program の 2 本だけだった。本ゲートは **残る 3 経路**
// (公式レースのエントリー・公式開催のイベント定義・車種) が同じ性質を持つことを実機で測る:
//   ① 1 クリックのユーザー操作から **download と window.open の両方** が発火する
//   ② 遷移先 URL が投稿物の大きさに依存しない (プログラム全文を焼き込んでも固定長)
//   ③ 書き出されたファイルの中身が UI に入れたものと一致する (投稿物が欠けない)
//   ④ **失敗を無言にしない / 嘘をつかない**: 開けなかったら「開きました」と言わない
//   ⑤ 投稿先が **上流に実在するディレクトリ** を指す (slug 化で別の場所を開かない)
//
// デモ専用の抜け道は作らず、利用者と同じ UI 要素だけを触る (CI-8)。
//
// 【上流に大会が無い状態でどう「本番フロー」を回すか】
//   `races/` は上流に存在しない (実測: /tree/master/races は 404)。大会が 1 本も無いと
//   エントリー欄そのものが出ないので、この経路は実機で一度も検証されてこなかった。
//   ここでは **GitHub 側の応答だけ** を page.route で差し替える。差し替えるのは
//   「外部サービスの返事」であって product ではない —— 走るのは
//   listOfficialRaces → fetchRace → renderOfficialDetail → submitOfficialEntry の
//   本物の経路そのもの (AZ1 で window.open だけを差し替えたのと同じ切り分け)。
//
// 【大会ディレクトリ名をわざと `Round_1` にしている理由】
//   旧 shareEntryUrl は投稿先を `slugify(event.id)` で作っていた。`event.id` は event.json の
//   **中身**で、実際の投稿先は **ディレクトリ名**。両者が食い違うと実在しない場所の投稿画面を
//   開く (=AZ-0 が潰したはずの「開いたのに投稿できない」)。slug 化されると `Round_1` は
//   `round-1` に化けるので、この 1 本で AZ4 の是正が本物かどうかが決まる。
import { launch, newPage, appModule, setLang, APP_URL } from './lib.mjs';
import { readFile } from 'node:fs/promises';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };

const GH = 'https://github.com/RumiCar-group/RumiCar';
const RACE_DIR_ID = 'Round_1';                    // わざと slug 化されない名前にする
const UPLOAD_ENTRY = `${GH}/upload/master/races/${RACE_DIR_ID}/entries`;
const UPLOAD_CARS  = `${GH}/upload/master/cars/community`;
const BUDGET = 2000;
const GH_URL_LIMIT = 6600;                        // AZ-0 実測の github.com 受理上限

// event.json の中身。**id はディレクトリ名とわざと違える** (上の理由)。
const EVENT = {
  id: 'this-id-is-not-the-directory-name',
  title: 'オーバル', course: 'オーバル', regime: 'fullscale', laps: 5, maxSec: 180,
  class: 'open', specCar: null, budget: null,
  crashRule: { rejoin: true, penaltySec: 3 },
  minField: 3, grid: 'entryOrder', interact: true, noise: false,
  engineVer: 'v8.2.0', physicsMode: 'v2',
  entryWindow: { open: '', close: '' },           // 空 = 受付中 (raceStatus → 'open')
};

/** GitHub 側の応答だけを差し替える (product には触れない)。 */
async function stubUpstreamRaces(page) {
  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  // races/ 直下の一覧 (ディレクトリ列挙なので API 経路のみ)
  await page.route(/api\.github\.com\/repos\/RumiCar-group\/RumiCar\/contents\/races\?/, (r) =>
    r.fulfill(json([{ name: RACE_DIR_ID, type: 'dir', path: `races/${RACE_DIR_ID}` }])));
  // 大会 1 本の event.json
  await page.route(new RegExp(`raw\\.githubusercontent\\.com/.*/races/${RACE_DIR_ID}/event\\.json$`), (r) =>
    r.fulfill(json(EVENT)));
  // entries は 0 件 (マニフェスト・API とも空で答える)
  await page.route(new RegExp(`raw\\.githubusercontent\\.com/.*/races/${RACE_DIR_ID}/entries/index\\.json$`), (r) =>
    r.fulfill(json({ entries: [] })));
  await page.route(new RegExp(`api\\.github\\.com/repos/.*/contents/races/${RACE_DIR_ID}/entries\\?`), (r) =>
    r.fulfill(json([])));
  // result.json は **差し替えない**。未確定 (404) はまさに上流の実状態で、本物の 404 を
  // そのまま使うのが正確。かつ lib.mjs の classify() が「races/ の 404 = 未シード」として
  // benign に分類する経路もそのまま通る (fulfill で 404 を作ると Chromium が ERR_ABORTED を
  // 出し、response ではなく requestfailed になって分類器を素通りしてしまう — 実測)。
}

const logText = (page) => page.evaluate(() => document.getElementById('log').textContent);
const msgText = (page, id) => page.evaluate((i) => document.getElementById(i).textContent, id);

/** 選択中の大会を開き、エントリー欄が出るところまで進める。 */
async function openOfficialWithRace(page) {
  await page.click('#officialOpen');
  await page.waitForSelector('#ofRace', { state: 'visible', timeout: 10000 });
  await page.waitForFunction(
    () => document.querySelectorAll('#ofRace option').length > 1, null, { timeout: 15000 });
  await page.selectOption('#ofRace', RACE_DIR_ID);
  await page.waitForSelector('#ofEntry:not([hidden])', { timeout: 15000 });
}

// ══ ① 本番 (ポップアップが通る) ═══════════════════════════════════════════════
{
  const browser = await launch();
  const { page, errors } = await newPage(browser, { width: 1440 });
  const ver = await appModule(page, 'js/config.js', (m) => m.APP_VERSION);
  console.log(`\n[本番経路] APP_VERSION=${ver}  ${APP_URL}`);
  // 下の判定は日本語の文言を見る。既定言語は navigator.language 由来なので、ホストの locale が
  // ja でない環境では en になり、product が正しくてもゲートが赤くなる。**本番 UI の言語切替**
  // (#langSel) を通して ja に固定する — テスト専用の抜け道ではなく利用者と同じ操作 (CI-8)。
  await setLang(page, 'ja');

  await stubUpstreamRaces(page);
  // 最初の goto は route を入れる前なので、races/ の 404 が localStorage の一覧キャッシュへ
  // 「未作成」として記録されている (TTL_MISS = 1 時間)。消してから読み直さないと、
  // 差し替えた応答が使われず大会一覧が空のままになる (v7.4.0 の RATELIMIT-1 で入った仕様)。
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* 無効でも続行 */ } });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // ── 1-A. 公式レースへのエントリー ──────────────────────────────────────────
  await openOfficialWithRace(page);
  await page.fill('#ofName', 'ゲート検証車');
  await page.fill('#ofAuthor', 'Octo Cat!');            // slug 化されるべき側

  const dlP = page.waitForEvent('download', { timeout: 15000 });
  const popP = page.waitForEvent('popup', { timeout: 15000 });
  await page.click('#ofSubmit');                        // ← 1 クリックだけ
  const [dl, pop] = await Promise.all([dlP, popP]);

  const url = pop.url();
  ok(!!dl, 'entry: 1 クリックで download が発火した');
  ok(!!pop, 'entry: 同じ 1 クリックで新しいタブが開いた');
  ok(url === UPLOAD_ENTRY, `entry: 遷移先が races/${RACE_DIR_ID}/entries の投稿ページ (実測 ${url})`);
  ok(!/round-1/.test(url),
     `entry: 大会ディレクトリ名が slug 化されていない (旧実装は event.id を slug 化して別の場所を開いた): ${url}`);
  ok(url.length < BUDGET, `entry: 遷移先 URL ${url.length} 文字 < ${BUDGET}`);
  ok(!/[?&#]/.test(url), 'entry: 遷移先 URL にクエリ/フラグメントが無い');
  ok(dl.suggestedFilename() === 'octo-cat.json',
     `entry: 保存名が author の slug (期待 octo-cat.json / 実測 ${dl.suggestedFilename()})`);

  const entryBody = await readFile(await dl.path(), 'utf8');
  const entry = JSON.parse(entryBody);
  ok(entry.name === 'ゲート検証車' && entry.author === 'Octo Cat!',
     'entry: 入力した車両名/GitHub アカウントがそのまま入っている (slug は保存名だけ)');
  ok(typeof entry.program === 'object' && (entry.program.src || '').length > 100,
     `entry: プログラム全文が焼き込まれている (実測 ${(entry.program && entry.program.src || '').length} 文字)`);
  ok(entry.carDef && typeof entry.carDef === 'object' && Object.keys(entry.carDef).length > 3,
     `entry: 車種 def が同梱されている (実測 ${entry.carDef ? Object.keys(entry.carDef).length : 0} キー)`);
  ok(!('custom' in (entry.carDef || {})) && !('community' in (entry.carDef || {})),
     'entry: 車種 def から runtime フラグ (custom/community) が落ちている');
  // **旧方式ならこの投稿物が URL に載っていた**。回帰の重さを連続量で残す (CI-14)。
  // ⚠ `oldLen > url.length` は 7080 > 76 で**常に真**＝何も判定していないのに
  // 「上限の 1.1 倍」と語ってしまっていた (層 4 レビュー指摘)。**閾値と比べる** 2 本に分ける。
  const oldLen = `${GH}/new/master/races/x/entries?filename=a.json&value=`.length
               + encodeURIComponent(entryBody).length;
  ok(oldLen > GH_URL_LIMIT,
     `entry: 旧方式ならこの投稿物は URL 長 ${oldLen} 文字＝受理上限 ${GH_URL_LIMIT} の ${(oldLen / GH_URL_LIMIT).toFixed(1)} 倍で開けなかった`);
  ok(url.length < BUDGET,
     `entry: 現行の遷移先は ${url.length} 文字＝予算 ${BUDGET} 内 (投稿物の大きさに依存しない)`);

  const ofMsg = await msgText(page, 'ofMsg');
  ok(/ダウンロードを開始しました/.test(ofMsg), `entry: 書き出しを知らせている (実測 ${JSON.stringify(ofMsg)})`);
  ok(/開いた GitHub のページ/.test(ofMsg), 'entry: 開けたときは「開いた GitHub のページ」と案内する');
  ok(!/開けませんでした/.test(ofMsg), 'entry: 開けたのに「開けませんでした」と言っていない');
  await pop.close();
  await page.click('#dlgOfficial .close, #dlgOfficial [data-close]').catch(() => {});
  await page.evaluate(() => document.getElementById('dlgOfficial').close());

  // ── 1-B. 公式開催 (イベント定義) ───────────────────────────────────────────
  await page.click('#eventOpen');
  await page.waitForSelector('#evShare', { state: 'visible', timeout: 10000 });
  const dlP2 = page.waitForEvent('download', { timeout: 15000 });
  const popP2 = page.waitForEvent('popup', { timeout: 15000 });
  await page.click('#evShare');
  const [dl2, pop2] = await Promise.all([dlP2, popP2]);

  const url2 = pop2.url();
  ok(dl2.suggestedFilename() === 'event.json',
     `event: 保存名は event.json 固定 (実測 ${dl2.suggestedFilename()})`);
  ok(/^https:\/\/github\.com\/RumiCar-group\/RumiCar\/upload\/master\/races\/[^/?#]+$/.test(url2),
     `event: 遷移先が races/<大会> の投稿ページ (実測 ${url2})`);
  ok(url2.length < BUDGET, `event: 遷移先 URL ${url2.length} 文字 < ${BUDGET}`);
  ok(!/[?&#]/.test(url2), 'event: 遷移先 URL にクエリ/フラグメントが無い');
  const ev = JSON.parse(await readFile(await dl2.path(), 'utf8'));
  ok(ev.id && ev.laps > 0 && ev.engineVer === ver,
     `event: 定義の中身が揃っている (id=${ev.id} laps=${ev.laps} engineVer=${ev.engineVer})`);
  ok(url2.endsWith('/' + encodeURIComponent(ev.id)),
     `event: 遷移先ディレクトリが書き出した定義の id と一致 (${url2} / id=${ev.id})`);
  const evMsg = await msgText(page, 'evMsg');
  ok(/ダウンロードを開始しました/.test(evMsg), `event: 書き出しを知らせている (実測 ${JSON.stringify(evMsg)})`);
  ok(!/開けませんでした/.test(evMsg), 'event: 開けたのに「開けませんでした」と言っていない');
  await pop2.close();
  await page.evaluate(() => document.getElementById('dlgEvent').close());

  // ── 1-C. 車種 ─────────────────────────────────────────────────────────────
  // 名前を長くする: 旧 shareCarUrl は「原理的に膨らまない」と書かれていたが、
  // key/name は利用者入力なので実測 1,000 文字で 9,639 文字＝上限超過だった。
  const longName = 'あ'.repeat(1000);
  await page.click('#helpCars');
  await page.waitForSelector('#carShareBtn', { state: 'visible', timeout: 10000 });
  await page.fill('#carJsonInput', JSON.stringify({ key: 'gate_car', name: longName, mass: 1000 }));
  const dlP3 = page.waitForEvent('download', { timeout: 15000 });
  const popP3 = page.waitForEvent('popup', { timeout: 15000 });
  await page.click('#carShareBtn');
  const [dl3, pop3] = await Promise.all([dlP3, popP3]);

  const url3 = pop3.url();
  ok(url3 === UPLOAD_CARS, `car: 遷移先が cars/community の投稿ページ (実測 ${url3})`);
  ok(url3.length < BUDGET, `car: 車種名 1,000 文字でも遷移先 URL ${url3.length} 文字 < ${BUDGET} (旧方式は 9,639 文字＝上限超過)`);
  ok(dl3.suggestedFilename() === 'gate-car.json',
     `car: 保存名が key の slug (期待 gate-car.json / 実測 ${dl3.suggestedFilename()})`);
  const carDef = JSON.parse(await readFile(await dl3.path(), 'utf8'));
  ok(carDef.name === longName, `car: 1,000 文字の名前が欠けずに書き出された (実測 ${carDef.name.length} 文字)`);
  const carMsg = await msgText(page, 'carAddMsg');
  // **兄弟の entry/event と同じ語彙を要求する**。以前はここだけ「保存しました」を要求しており、
  // 「a.click() の完了は測れない＝保存できたとは言えない」(main.js の設計) と矛盾する文言を
  // ゲートが固定してしまっていた (層 4 レビュー指摘)。
  ok(/ダウンロードを開始しました/.test(carMsg), `car: 書き出しを知らせている (実測 ${JSON.stringify(carMsg).slice(0, 80)})`);
  ok(!/開けませんでした/.test(carMsg), 'car: 開けたのに「開けませんでした」と言っていない');
  await pop3.close();

  ok(errors.length === 0, `JS エラー 0 件 (実測 ${errors.length}${errors.length ? ': ' + errors.join(' | ') : ''})`);
  await browser.close();
}

// ══ ② ポップアップが塞がれた状態 (window.open が null を返す環境の再現) ═══════
// Chrome は**ユーザー操作由来の window.open を popup blocker で阻止しない** (AZ1 で 4 方式を
// 実測して確認済み)。この分岐は拡張機能・企業ポリシー・他ブラウザで実在するので、
// **ブラウザ API だけ**を差し替えて再現する。走るのは main.js の本物の `if (!opened)` 分岐。
{
  const browser = await launch();
  const { page } = await newPage(browser, { width: 1440 });
  await page.addInitScript(() => { window.open = () => null; });
  await stubUpstreamRaces(page);
  // 最初の goto は route を入れる前なので、races/ の 404 が localStorage の一覧キャッシュへ
  // 「未作成」として記録されている (TTL_MISS = 1 時間)。消してから読み直さないと、
  // 差し替えた応答が使われず大会一覧が空のままになる (v7.4.0 の RATELIMIT-1 で入った仕様)。
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* 無効でも続行 */ } });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  console.log('\n[ポップアップ阻止下 (window.open→null で再現)]');
  await setLang(page, 'ja');          // 上のブロックと同じ理由 (判定が日本語文言を見るため)

  ok(await page.evaluate(() => window.open('x', '_blank') === null),
     '前提: この文脈では window.open が null を返す');

  await openOfficialWithRace(page);
  await page.fill('#ofName', '阻止検証車');
  await page.fill('#ofAuthor', 'octocat');
  const before = (await logText(page)).length;
  const dlP = page.waitForEvent('download', { timeout: 15000 });
  let popped = false;
  page.once('popup', () => { popped = true; });
  await page.click('#ofSubmit');
  const dl = await dlP;                    // ←これが通ることが「JSON 書出だけは必ず成功」
  await page.waitForTimeout(1200);

  ok(!!dl, '阻止下でも download は発火した (投稿物は手元に残る)');
  const entry = JSON.parse(await readFile(await dl.path(), 'utf8'));
  ok(entry.author === 'octocat' && (entry.program.src || '').length > 100,
     '阻止下でも投稿物は完全 (author とプログラム全文が入っている)');
  ok(!popped, '阻止下で新しいタブは開かなかった (前提の確認)');

  const ofMsg = await msgText(page, 'ofMsg');
  ok(/開けませんでした/.test(ofMsg), `阻止下: 開けなかったことを言っている (実測 ${JSON.stringify(ofMsg)})`);
  // **ここが AZ4 の本丸**: 旧実装は window.open の戻り値を見ず、必ず「開きました」と言っていた。
  ok(!/開いた GitHub のページ/.test(ofMsg),
     '阻止下: 「開いた GitHub のページ」とは言っていない (開いていないのに開いたと言わない)');
  const added = (await logText(page)).slice(before);
  ok(added.includes(UPLOAD_ENTRY),
     `阻止下: 開くべき URL がログに出ている (無言で諦めていない): ${UPLOAD_ENTRY}`);
  ok(/ブロック/.test(added), '阻止下: ポップアップ阻止の可能性を通知している');
  await browser.close();
}

const line = '─'.repeat(64);
console.log('\n' + line);
console.log('AZ4 投稿導線 (公式レース / 車種) 実ブラウザゲート');
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log(line); for (const m of fails) console.log('  ✗ ' + m); }
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
