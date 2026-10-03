// check_bh1_ranklist.mjs — BH1「🏅 ランキング: 大会一覧が届く前に開いたとき・eventId が重複したとき」の実ブラウザ検証
// ════════════════════════════════════════════════════════════════════════════
// 何を測るか:
//   ② 公式記録の集計は「大会一覧 (contents/races) → 各大会の詳細」の順に読む。改修前は、一覧が届く前に 🏅 を開くと
//      空の一覧で集計して「読み終えた」印を立て、一覧が届いても「再読込」を押すまで「まだ検証済の公式記録がありません」の
//      ままだった (起動時の「記録が抜かれています」も出なかった)。一覧の取得に失敗したとき (レート制限など) も同じ文言で
//      「記録が無い」と言い切っていた。🏆 公式レースのダイアログにも同じ形があった (届く前に開くと「まだありません」が残る)。
//   ③ 👻 あなた vs 世界ベスト は記録の eventId で大会を引いていた。eventId は event.json / result.json の**中身**で、
//      大会のディレクトリ名と違って重複も欠落もしうる。重複すると最初の大会 (別のコース・別のエントリー) で走り、
//      欠落すると「リプレイできる軌跡がありません」になった。ドライバーの「参加」・選手権の「n 戦」も eventId で数えていた。
// 本ゲートは利用者と同じ UI (起動 → 🏅 / 🏆 → 👻) だけで通す (CI-8)。差し替えるのは上流の応答 (遅らせる・失敗させる・
//   治具の大会を返す) と起動前の localStorage (自分の GitHub 名) だけ。期待する文言は配信中の t() で組む (写さない)。
//   (A) 一覧が届く前に 🏅 を開く → 「読み込み中」のまま待ち、届いたら再読込なしで集計が出る (再読込の後と同じ行)。
//       起動時の打破通知は 1 回・一覧の読込の 1 行も 1 回。
//   (A2) 起動処理が一覧を取りに行くより前に 🏅 を開いても同じ (出荷コースの読込を止めておく)。
//   (A3) 一覧は届いたが各大会の詳細を取得している途中で 🏅 を開く → 同じ取得に相乗りする (詳細を二重に取りに行かない)。
//   (B) 一覧の取得に失敗 (403) → 「記録がありません」と言い切らず取得できていないと出す。開き直しでは API を使わず、
//       「再読込」で回復する。
//   (C) 🏆 公式レースを一覧が届く前に開く → 「読み込み中」→ 届いたら大会を選べる。
//   (D) eventId が同じでコースが違う 2 大会・eventId の無い大会 → 👻 は世界ベストの記録が出たその大会のコース・エントリーで
//       走る。「参加」「n 戦」は大会ごとに数える。eventId が重複しない大会は従来どおり。
//   (B2) 失敗の種類を変えても同じ (通信の中断・壊れた JSON・配列でない 200)。
//   (E) 一覧は取得できたが各大会の詳細を取得できない (全部・1 件) → 「記録がありません」と言い切らず、欠けていると出す。
//       壊れた result.json が 1 件あっても集計は止まらない。
//   (R) 取得が重なったとき: 詳細の取得中に 🏆 の「再読込」が失敗しても読めた集計を倒さない／「再読込」の連打で応答が
//       逆順に届いても最後に始めた取得で決まる／取得中の「再読込」に追い越された古い取得は集計を上書きしない。
//   (S) 🏆 で応答の遅い大会を選んだ直後に別の大会を選ぶ → 遅れて届いた前の大会が画面を上書きしない。「再読込」の連打も同じ。
//   (R4) 起動時の打破通知を待つ間に 🏆 で「再読込」しても通知は 1 回出る。大会の顔ぶれが同じなら詳細を取り直さない。
//   (M) races/ が未作成 (404＝大会がまだ無い正常な状態) → 従来どおりの文言 (取得失敗とは区別する)。その後に大会ができて
//       🏆 の「再読込」で一覧を取り直すと、次に 🏅 を開いたときに集計が読み直される。
// 使い方: bash run.sh check_bh1_ranklist.mjs
import { launch, appModule, APP_URL } from './lib.mjs';
import { PROGRAMS } from '../public/js/programs.js';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m, d = '') => { if (c) { pass++; console.log(`  ✓ ${m}${d ? ' — ' + d : ''}`); } else { fail++; fails.push(m); console.log(`  ✗ ${m}${d ? ' — ' + d : ''}`); } };
const J = (x) => JSON.stringify(x);

// ── 治具 ────────────────────────────────────────────────────────────────────
const ring = (W, H, m) => {
  const r = (x1, y1, x2, y2) => [{ x1, y1, x2, y2: y1 }, { x1: x2, y1, x2, y2 }, { x1: x2, y1: y2, x2: x1, y2 }, { x1, y1: y2, x2: x1, y2: y1 }];
  return [...r(0, 0, W, H), ...r(m, m, W - m, H - m)];
};
const mk = (name, W, H, m) => ({ name, bounds: { w: W, h: H }, start: { x: 0.35, y: m / 2, theta: 0 },
  finish: { x1: 0.35, y1: 0, x2: 0.35, y2: m }, walls: ring(W, H, m) });
// 同梱コース 3 本は縦横比がすべて違う (👻 の地図の縦横比でどのコースを走ったかを測る)。
const DEF_1 = mk('BH1 第1', 4, 3, 0.6), DEF_2 = mk('BH1 第2', 6, 2.5, 0.6), DEF_3 = mk('BH1 無名', 5, 3.5, 0.6);
const prog = (key) => { const p = PROGRAMS.find((x) => x.key === key); return { src: p.code, lang: p.lang || 'c' }; };
// dir＝上流のディレクトリ名 (一意)。id＝event.json の id と result.json の eventId (中身。重複・欠落しうる)。
// order＝[著者, 総合 ms, 車種]。プログラムはその車種向けの出荷サンプル。zed は同じ eventId の 2 大会に違う車種で出ている (どちらのエントリーで走ったかを凡例で測る)。
// 規則も 2 大会で変えてある: 前の大会は制限 8 秒 (この大きさのコースでは 1 周もできない)、後ろの大会は 2 周・制限 60 秒
// (1 周は走り切れる)。👻 の区間表に完了した周回が出るかどうかで、どちらの大会の規則で走ったかを測る
// (どの車が走り切るかは車種とプログラム次第なので、車は問わず「完了した周回が 1 つでもあるか」で測る)。
const RACES = [
  { dir: 'bh1-a', id: 'bh1-a', course: 'オーバル', order: [['alice', 10000], ['bob', 11000]] },
  { dir: 'bh1-b', id: 'bh1-b', course: 'オーバル', order: [['bob', 9500], ['carol', 12000]] },
  { dir: 'bh1-dup1', id: 'bh1-dup', course: DEF_1, order: [['zed', 20000, 'normal_fr']] },
  { dir: 'bh1-dup2', id: 'bh1-dup', course: DEF_2, laps: 2, maxSec: 60, order: [['zed', 15000, 'normal_awd'], ['yan', 16000]] },
  { dir: 'bh1-noid', id: null, course: DEF_3, order: [['ned', 18000]] },
];
const EVENTS = Object.fromEntries(RACES.map(({ dir, id, course, order, laps = 1, maxSec = 8 }, k) => {
  const event = { title: 'BH1 ' + dir, course, class: 'open', regime: 'tabletop', laps, maxSec, entryWindow: { open: '', close: '' } };
  if (id != null) event.id = id;
  const entries = order.map(([a, , car], i) => ({ name: a + '-car', author: a, program: prog(car || 'normal_fr'), carType: car || 'normal_fr', submittedAt: `2026-01-01T00:00:0${i}Z` }));
  const result = { engineVer: 'v9.0.0', class: 'open', course, regime: 'tabletop', laps,
    finishers: order.map(([a, ms, car], i) => ({ rank: i + 1, name: a + '-car', author: a, carType: car || 'normal_fr', totalTimeMs: ms, bestLapMs: ms, penaltiesSec: 0 })),
    dnf: [], grid: [], verifyHash: 'bh1v' + k, computedAt: '2026-10-03T00:00:00Z' };
  if (id != null) result.eventId = id;
  return [dir, { event, entries, result }];
}));
const N_RACES = RACES.length;
const N_BOARDS = 4;   // オーバル (2 大会が 1 枠)・同梱 3 本

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const until = async (cond, ms = 30000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 50)); } return true; };

// ctl: 上流の応答を操作する。
//   mode   … 大会一覧 (contents/races) の応答。'ok'|'fail'(403)|'miss'(404)|'offline'(通信の中断)|'badjson'(壊れた JSON)|'notarray'(配列でない 200)
//   hold   … あれば、一覧の応答を解決まで返さない
//   script … 一覧の要求 1 回ごとの上書き [{ mode, hold, ids }] (先頭から 1 つずつ使う。ids＝返す大会のディレクトリ名)
//   hits   … 一覧の API を引いた回数。details … 各大会の event.json を取りに来た回数 (大会ごと)
//   detail(dir, file, n) … 各大会のファイルの応答の上書き。{ hold } 解決まで返さない / { abort:true } 通信の中断 /
//                          { status } その状態コード / { body } その中身。n＝その大会の event.json の何回目の要求か
//   courses … あれば、出荷コース (data/courses.json) の応答を解決まで返さない
//   community … あれば、投稿コースの一覧の応答を解決まで返さない (起動時の打破通知は、この一覧の決着を最長 10 秒待つ)
async function boot(browser, ctl, { me = 'alice' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.addInitScript((who) => { try { localStorage.setItem('rumicar.lang', 'ja'); localStorage.setItem('rumicar.author', who); } catch (e) {} }, me);
  await page.route('**/courses/community/index.json*', async (r) => { if (ctl.community) await ctl.community.promise; return r.fulfill(json({ generated: 'check_bh1', entries: [] })); });
  if (ctl.courses) await page.route('**/data/courses.json*', async (r) => { await ctl.courses.promise; return r.continue(); });
  await page.route(/api\.github\.com\/repos\/.*\/contents\/races\?/, async (r) => {
    ctl.hits = (ctl.hits || 0) + 1;
    const step = (ctl.script && ctl.script.length) ? ctl.script.shift() : {};   // 応答の中身は要求が出た時点で決める
    const mode = step.mode || ctl.mode, hold = step.hold || ctl.hold, ids = step.ids || Object.keys(EVENTS);
    if (hold) await hold.promise;
    if (mode === 'fail') return r.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"API rate limit exceeded (check_bh1)"}' });
    if (mode === 'miss') return r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
    if (mode === 'offline') return r.abort();
    if (mode === 'badjson') return r.fulfill({ status: 200, contentType: 'application/json', body: '[{"name":' });
    if (mode === 'notarray') return r.fulfill(json({ name: 'races', type: 'file' }));
    return r.fulfill(json(ids.map((id) => ({ name: id, type: 'dir', path: `races/${id}` }))));
  });
  await page.route(/raw\.githubusercontent\.com\/.*\/races\/bh1-[A-Za-z0-9]+\//, async (r) => {
    const m = /\/races\/([^/]+)\/(.+)$/.exec(decodeURIComponent(new URL(r.request().url()).pathname));
    const ev = m && EVENTS[m[1]];
    if (!ev) return r.fulfill({ status: 404, contentType: 'text/plain', body: '404: Not Found' });
    ctl.details = ctl.details || {};
    if (m[2] === 'event.json') ctl.details[m[1]] = (ctl.details[m[1]] || 0) + 1;
    const act = ctl.detail ? ctl.detail(m[1], m[2], ctl.details[m[1]] || 0) : null;
    if (act && act.hold) await act.hold.promise;
    if (act && act.abort) return r.abort();
    if (act && act.status) return r.fulfill({ status: act.status, contentType: 'text/plain', body: 'check_bh1' });
    if (act && act.body !== undefined) return r.fulfill(json(act.body));
    if (m[2] === 'event.json') return r.fulfill(json(ev.event));
    if (m[2] === 'result.json') return r.fulfill(json(ev.result));
    if (m[2] === 'entries/index.json') return r.fulfill(json({ entries: ev.entries.map((e) => e.author + '.json') }));
    const e = /^entries\/(.+)\.json$/.exec(m[2]);
    const en = e && ev.entries.find((x) => x.author === e[1]);
    return en ? r.fulfill(json(en)) : r.fulfill({ status: 404, contentType: 'text/plain', body: '404: Not Found' });
  });
  // 応答を止めている間は networkidle にならないので load で進める (lib の newPage は使わない)。
  await page.goto(new URL('', APP_URL.endsWith('/') ? APP_URL : APP_URL + '/').href, { waitUntil: 'load', timeout: 45000 });
  const t = (key, params) => appModule(page, 'js/i18n.js', `(m) => m.t(${J(key)}, ${J(params || {})})`);
  const hasKey = (key) => appModule(page, 'js/i18n.js', `(m) => m.hasKey(${J(key)})`);
  const tk = async (key, params) => ((await hasKey(key)) ? t(key, params) : `(未定義のキー ${key})`);
  return { page, errs, t, tk };
}
const text = (page, id) => page.evaluate((i) => document.getElementById(i).textContent.replace(/\s+/g, ' ').trim(), id);
const logText = (page) => page.evaluate(() => document.getElementById('log').textContent);
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
const closeAll = (page) => page.evaluate(() => { for (const id of ['dlgGhost', 'dlgRankings', 'dlgOfficial']) { const d = document.getElementById(id); if (d.open) d.close(); } });

// 🏅 のクラス別ラダー (👻 ボタンを持つ枠)。rows は行の全文 (「再読込」の前後で同じ行かを比べる)。
const readBoards = (page) => page.evaluate(() => [...document.querySelectorAll('#rankBody .rank-vsworld')].map((btn) => {
  const head = btn.parentElement, board = head.parentElement;
  const txt = head.textContent.replace(btn.textContent, '');
  const sep = ' — ';
  return { label: txt.slice(txt.indexOf(sep) + sep.length).trim(),
    authors: [...board.querySelectorAll('table tbody tr')].map((tr) => tr.children[2].textContent.trim()),
    rows: [...board.querySelectorAll('table tbody tr')].map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()) };
}));
const boardsShown = (page, ms) => page.waitForFunction(() => document.querySelectorAll('#rankBody .rank-vsworld').length > 0, null, { timeout: ms }).then(() => true, () => false);
const brief = (b) => J(b.map((x) => [x.label, x.authors.join(',')]));
// 見出しが label を含む枠の 👻 を押し、開いたゴースト対戦の中身 (コース名・地図の縦横・凡例) を返す。
async function vsWorld(page, label) {
  await closeAll(page);
  await page.click('#rankOpen');
  if (!(await boardsShown(page, 30000))) return { found: false };
  const boards = await readBoards(page);
  const i = boards.findIndex((b) => b.label.includes(label));
  if (i < 0) return { found: false };
  const logBefore = (await logText(page)).length;
  await page.locator('#rankBody .rank-vsworld').nth(i).click();
  await page.waitForFunction((n) => document.getElementById('dlgGhost').open || document.getElementById('log').textContent.length > n, logBefore, { timeout: 60000 }).catch(() => {});   // 待ち切れなくても落とさない (下の検査が赤で報告する)
  await page.waitForTimeout(500);
  const r = await page.evaluate((n) => {
    const cv = document.getElementById('ghostMap');
    return { ghost: document.getElementById('dlgGhost').open, w: cv.width, h: cv.height,
      course: (document.querySelector('#ghostMeta td') || { textContent: '' }).textContent.trim(),
      legend: [...document.querySelectorAll('#ghostLegend .ghost-leg')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
      // 区間表 (再生開始時に 1 回だけ作る事後解析) の [車名, 完了した周回数]。1 周も完了していなければ表が無い＝[]。
      laps: [...document.querySelectorAll('#ghostSectors table tbody tr:not(.sect-theo)')].map((tr) => [tr.children[0].textContent.trim(), +tr.lastElementChild.textContent]),
      log: document.getElementById('log').textContent.slice(n).trim() };
  }, logBefore);
  await closeAll(page);
  await page.waitForTimeout(300);
  return { found: true, ...r };
}
const ONCE = J(Object.fromEntries(RACES.map((x) => [x.dir, 1])));   // 各大会の詳細を 1 回ずつ取りに来た
const aspectOf = (def) => def.bounds.w / def.bounds.h;
const sameAspect = (g, def) => g.h > 0 && Math.abs(g.w / g.h - aspectOf(def)) < 0.02;

const browser = await launch();
try {
  // ── (A) 一覧が届く前に 🏅 を開く ───────────────────────────────────────────
  console.log('\n── (A) 大会一覧が届く前に 🏅 を開いたとき ──');
  {
    const ctl = { mode: 'ok', hold: deferred() };
    const { page, errs, t } = await boot(browser, ctl);
    ok(await until(() => ctl.hits >= 1), '(A) 起動処理が大会一覧を取りに行った (応答は止めてある)', `一覧の API ${ctl.hits || 0} 回`);
    const LOADING = await t('rank.loading'), EMPTY = await t('rank.empty');
    await page.click('#rankOpen');
    await page.waitForTimeout(600);
    const b0 = await text(page, 'rankBody');
    ok(b0 === LOADING && b0 !== EMPTY, '(A) 一覧が届く前は「読み込み中」と出す (「記録がありません」と言い切らない)', J(b0.slice(0, 40)));
    await page.click('#rankYouSave');             // 開いている間の描き直し (「記憶」) でも空の集計にしない
    await page.waitForTimeout(300);
    const b0b = await text(page, 'rankBody');
    ok(b0b === LOADING, '(A) 読み込み中に描き直しても「読み込み中」のまま', J(b0b.slice(0, 40)));
    ctl.hold.resolve();
    const shown = await boardsShown(page, 15000);
    const b1 = await readBoards(page);
    ok(shown && b1.length === N_BOARDS, `(A) 一覧が届くと「再読込」を押さずに集計が出る (${N_BOARDS} 枠)`,
      shown ? brief(b1) : '届いた後の表示: ' + J((await text(page, 'rankBody')).slice(0, 40)));
    // 起動時の打破通知 (alice 10.0 s は同じコースの bob 9.5 s に抜かれている)。出るのは一覧と詳細を読んだ後。
    const beatenLine = await t('log.w6.beaten', { course: 'オーバル', cls: await t('event.class.open'), who: 'bob', gap: '0.50' });
    await page.waitForFunction((s) => document.getElementById('log').textContent.includes(s), beatenLine, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);              // 二重に出るなら、遅れて来る 2 回目もここで数に入る
    const log1 = await logText(page);
    ok(count(log1, beatenLine) === 1 && count(log1, '⚔') === 1, '(A) 起動時の打破通知は一覧が届いてから 1 回だけ出る', `${count(log1, beatenLine)} 回 (⚔ ${count(log1, '⚔')} 個)`);
    ok(count(log1, await t('log.ghRacesLoaded', { n: N_RACES })) === 1, '(A) 一覧の読込の 1 行は 1 回だけ', `一覧の API ${ctl.hits} 回`);
    // 起動処理と 🏅 が同時に求めても、各大会の詳細は 1 回ずつしか取りに行かない。
    ok(J(ctl.details) === J(Object.fromEntries(Object.keys(EVENTS).map((d) => [d, 1]))), '(A) 各大会の詳細の取得は 1 回ずつ (起動処理と 🏅 で二重にならない)', J(ctl.details || {}));
    // 「再読込」の後と同じ行か。
    const hits0 = ctl.hits;
    await page.click('#rankReload');
    await until(() => ctl.hits > hits0);
    await page.waitForFunction(() => document.getElementById('rankMsg').textContent === '' && document.querySelectorAll('#rankBody .rank-vsworld').length > 0, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(300);
    const b2 = await readBoards(page);
    ok(b2.length === N_BOARDS && J(b1) === J(b2), '(A) 再読込なしで出た行は「再読込」の後と一致する', `再読込の前 ${b1.length} 枠・後 ${b2.length} 枠`);
    await closeAll(page);

    // 同じ一覧を使う 🏆 公式レースは従来どおり (大会を選ぶと詳細が出る)。
    await page.click('#officialOpen');
    await page.waitForTimeout(400);
    const opts = await page.evaluate(() => [...document.querySelectorAll('#ofRace option')].map((o) => o.value));
    ok(J(opts) === J(['', ...Object.keys(EVENTS)]) && (await text(page, 'ofDetail')) === await t('official.pickHint'),
      '(A) 🏆 公式レースの選択欄に全大会が並ぶ (従来どおり)', J(opts));
    await page.selectOption('#ofRace', 'bh1-a');
    await page.waitForFunction(() => document.querySelectorAll('#ofDetail table.race-tab').length >= 2, null, { timeout: 15000 }).catch(() => {});
    const det = await page.evaluate(() => [...document.querySelectorAll('#ofDetail table.race-tab')].map((tb) => tb.querySelectorAll('tbody tr').length));
    ok(J(det) === J([2, 2]), '(A) 🏆 大会を選ぶとエントリー 2 件・公式結果 2 行が出る (従来どおり)', J(det));
    await closeAll(page);

    // ── (D) eventId の重複・欠落 ──
    console.log('\n── (D) eventId が重複・欠落した大会の 👻・参加数 ──');
    const carName = (key) => page.evaluate((k) => { const o = document.querySelector(`#fleetCols .cc-cartype option[value="${k}"]`); return o ? o.textContent.trim() : ''; }, key);
    const FR = await carName('normal_fr'), AWD = await carName('normal_awd');
    const g2 = await vsWorld(page, 'BH1 第2');
    const zed2 = g2.found && g2.legend ? (g2.legend.find((x) => x.startsWith('zed-car')) || '') : '';
    ok(g2.found && g2.ghost && g2.course.includes('BH1 第2') && sameAspect(g2, DEF_2),
      '(D) eventId が重複: 👻 は世界ベストの記録が出た大会 (後ろの大会) のコースで走る (コース名・地図の縦横比)',
      g2.found ? `コース ${J(g2.course)}・地図 ${g2.w}×${g2.h} (第2=${aspectOf(DEF_2).toFixed(2)}・第1=${aspectOf(DEF_1).toFixed(2)})${g2.ghost ? '' : '・ログ ' + J(g2.log.slice(0, 60))}` : '(枠なし)');
    ok(!!FR && !!AWD && FR !== AWD && zed2.includes(AWD) && !zed2.includes(FR),
      '(D) eventId が重複: 👻 の相手はその大会のエントリー (zed の車種は後ろの大会のもの)', J(zed2) + ` (第2=${AWD}・第1=${FR})`);
    const lapsMax = (g) => Math.max(0, ...(g.laps || []).map((x) => x[1]));
    ok(g2.found && lapsMax(g2) >= 1, '(D) eventId が重複: 👻 はその大会の規則で走る (後ろの大会の制限 60 秒なら 1 周を走り切る・前の大会の 8 秒ではできない)',
      `区間表の周回 ${J(g2.laps || [])}`);
    const g1 = await vsWorld(page, 'BH1 第1');
    const zed1 = g1.found && g1.legend ? (g1.legend.find((x) => x.startsWith('zed-car')) || '') : '';
    ok(g1.found && g1.ghost && g1.course.includes('BH1 第1') && sameAspect(g1, DEF_1) && zed1.includes(FR) && lapsMax(g1) === 0,
      '(D) eventId が重複: 前の大会の枠は前の大会のコース・エントリー・規則 (8 秒＝1 周もできない) で走る', g1.found ? `${J(g1.course)}・${g1.w}×${g1.h}・${J(zed1)}・周回 ${J(g1.laps)}` : '(枠なし)');
    const g3 = await vsWorld(page, 'BH1 無名');
    ok(g3.found && g3.ghost && g3.course.includes('BH1 無名') && sameAspect(g3, DEF_3) && g3.legend.some((x) => x.startsWith('ned-car')),
      '(D) eventId が無い大会の枠でも 👻 が走る (「軌跡がありません」にならない)', g3.found ? (g3.ghost ? `${J(g3.course)}・${g3.w}×${g3.h}` : 'ログ ' + J(g3.log.slice(0, 60))) : '(枠なし)');
    const g0 = await vsWorld(page, 'オーバル');
    ok(g0.found && g0.ghost && g0.course === 'オーバル' && g0.legend.some((x) => x.startsWith('bob-car')),
      '(D) eventId が重複しない大会は従来どおり (オーバルの世界ベスト bob と走る)', g0.found ? `${J(g0.course)}・${J(g0.legend)}` : '(枠なし)');
    // 「参加」(ドライバー表の 5 列目) と選手権の「n 戦」は大会ごとに数える。
    await page.click('#rankOpen');
    await boardsShown(page, 30000);
    const drv = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('#rankBody > table.race-tab')];
      const last = tabs[tabs.length - 1];
      return Object.fromEntries([...last.querySelectorAll('tbody tr')].map((tr) => [tr.children[0].textContent.trim().split(/\s/)[0], tr.children[4].textContent.trim()]));
    });
    ok(drv.zed === '2' && drv.bob === '2' && drv.ned === '1', '(D) ドライバーの「参加」は大会ごとに数える (zed は同じ eventId の 2 大会で 2)', J(drv));
    const body = await text(page, 'rankBody');
    ok(body.includes(await t('season.events', { n: N_RACES })), `(D) 選手権の出走大会数は大会ごとに数える (${N_RACES} 戦)`,
      J((body.match(/🏆[^🏆]{0,40}/) || [''])[0]));
    await closeAll(page);
    ok(errs.length === 0, '(A)(D) ページ側の例外・console error 0 件', errs.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }

  // ── (A2) 起動処理より前に 🏅 を開く ────────────────────────────────────────
  // 出荷コースの読込を止めておく＝起動処理はまだ大会一覧を取りに行っていない。ここで 🏅 を開くと、開いた側が一覧を取りに行く。
  // 後から走る起動処理が同じ取得に相乗りすること (一覧の API・読込の 1 行・打破通知が 1 回ずつ) を測る。
  console.log('\n── (A2) 起動処理が一覧を取りに行く前に 🏅 を開いたとき ──');
  {
    const ctl = { mode: 'ok', hold: deferred(), courses: deferred() };
    const { page, errs, t } = await boot(browser, ctl);
    await page.waitForTimeout(800);
    const before = ctl.hits || 0;
    let clicked = true;
    try { await page.click('#rankOpen', { timeout: 5000 }); } catch (e) { clicked = false; }
    // 押せないなら、この順序は利用者にも起きない＝この場面の検査は空振りになる。黙って通さず赤にして見直しを促す。
    ok(clicked, '(A2) 起動処理の前でも 🏅 を押せる (押せなくなったらこの場面の検査を見直す)');
    if (!clicked) { ctl.courses.resolve(); ctl.hold.resolve(); } else {
      await page.waitForTimeout(600);
      ok(before === 0 && (await text(page, 'rankBody')) === await t('rank.loading'), '(A2) 起動処理より前に開いても「読み込み中」と出す', `開く前の一覧の API ${before} 回・開いた後 ${ctl.hits || 0} 回`);
      ctl.courses.resolve();
      await page.waitForTimeout(1500);              // 起動処理が走り、同じ一覧を取りに来る
      ctl.hold.resolve();
      const shown = await boardsShown(page, 15000);
      const b = await readBoards(page);
      ok(shown && b.length === N_BOARDS, '(A2) 一覧が届くと「再読込」を押さずに集計が出る', shown ? brief(b) : '届いた後の表示: ' + J((await text(page, 'rankBody')).slice(0, 40)));
      const beatenLine = await t('log.w6.beaten', { course: 'オーバル', cls: await t('event.class.open'), who: 'bob', gap: '0.50' });
      await page.waitForFunction((s) => document.getElementById('log').textContent.includes(s), beatenLine, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const lg = await logText(page);
      ok(ctl.hits === 1 && count(lg, await t('log.ghRacesLoaded', { n: N_RACES })) === 1 && count(lg, beatenLine) === 1
        && J(ctl.details) === J(Object.fromEntries(Object.keys(EVENTS).map((d) => [d, 1]))),
        '(A2) 起動処理は同じ取得に相乗りする (一覧の API・読込の 1 行・打破通知・各大会の詳細が 1 回ずつ)',
        `API ${ctl.hits} 回・読込の行 ${count(lg, await t('log.ghRacesLoaded', { n: N_RACES }))} 回・打破通知 ${count(lg, beatenLine)} 回・詳細 ${J(ctl.details || {})}`);
    }
    ok(errs.length === 0, '(A2) ページ側の例外・console error 0 件', errs.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }

  // ── (A3) 詳細の取得中に 🏅 を開く ──────────────────────────────────────────
  console.log('\n── (A3) 各大会の詳細を取得している途中で 🏅 を開いたとき ──');
  {
    const dh = deferred();
    const ctl = { mode: 'ok', detail: (dir, file) => (file === 'event.json' ? { hold: dh } : null) };
    const { page, errs, t } = await boot(browser, ctl);
    ok(await until(() => J(ctl.details || {}) === ONCE), '(A3) 起動処理が全大会の詳細を取りに行った (応答は止めてある)', J(ctl.details || {}));
    await page.click('#rankOpen');
    await page.waitForTimeout(800);
    ok((await text(page, 'rankBody')) === await t('rank.loading'), '(A3) 詳細が届く前は「読み込み中」と出す', J((await text(page, 'rankBody')).slice(0, 40)));
    ok(J(ctl.details) === ONCE, '(A3) 🏅 を開いても詳細を取り直しに行かない (進行中の取得に相乗り)', J(ctl.details));
    dh.resolve();
    const shown = await boardsShown(page, 15000);
    await page.waitForTimeout(1000);
    ok(shown && (await readBoards(page)).length === N_BOARDS && J(ctl.details) === ONCE, '(A3) 届くと集計が出る・詳細の取得は 1 回ずつのまま', J(ctl.details));
    await closeAll(page);
    ok(errs.length === 0, '(A3) ページ側の例外・console error 0 件', errs.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }

  // ── (B) 一覧の取得に失敗 ───────────────────────────────────────────────────
  console.log('\n── (B) 大会一覧の取得に失敗したとき (403) ──');
  {
    const ctl = { mode: 'fail' };
    const { page, errs, t, tk } = await boot(browser, ctl);
    const failLine = await t('log.ghRacesFail');
    await page.waitForFunction((s) => document.getElementById('log').textContent.includes(s), failLine, { timeout: 30000 }).catch(() => {});
    const FAIL = await tk('official.listFail'), EMPTY = await t('rank.empty');
    await page.click('#rankOpen');
    await page.waitForTimeout(800);
    const b0 = await text(page, 'rankBody');
    ok(b0 === FAIL && b0 !== EMPTY, '(B) 🏅 は「記録がありません」と言い切らず、一覧を取得できていないと出す', J(b0.slice(0, 50)));
    await closeAll(page);
    await page.click('#officialOpen');
    await page.waitForTimeout(400);
    const o0 = await text(page, 'ofDetail');
    ok(o0 === FAIL && o0 !== await t('official.none'), '(B) 🏆 も「races/ が未作成」と言い切らず、一覧を取得できていないと出す', J(o0.slice(0, 50)));
    await closeAll(page);
    await page.click('#rankOpen');
    await page.waitForTimeout(800);
    ok(ctl.hits === 1 && (await text(page, 'rankBody')) === FAIL, '(B) 開き直しでは一覧の API を使わない (取り直すのは「再読込」)', `一覧の API ${ctl.hits} 回`);
    ctl.mode = 'ok';                               // 復帰
    await page.click('#rankReload');
    const shown = await boardsShown(page, 30000);
    const b1 = await readBoards(page);
    ok(shown && b1.length === N_BOARDS && ctl.hits === 2, '(B) 「再読込」で回復して集計が出る', shown ? brief(b1) : J((await text(page, 'rankBody')).slice(0, 40)));
    await closeAll(page);
    await page.click('#rankOpen');
    await page.waitForTimeout(600);
    ok((await readBoards(page)).length === N_BOARDS && ctl.hits === 2, '(B) 回復した後は開き直しても集計が出る (取り直さない)', `一覧の API ${ctl.hits} 回`);
    await closeAll(page);
    ok(errs.length === 0, '(B) ページ側の例外・console error 0 件', errs.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }

  // ── (B2) 失敗の種類 ───────────────────────────────────────────────────────
  console.log('\n── (B2) 一覧の取得の失敗の種類 (通信の中断・壊れた JSON・配列でない 200) ──');
  for (const mode of ['offline', 'badjson', 'notarray']) {
    const ctl = { mode };
    const { page, errs, t, tk } = await boot(browser, ctl);
    await page.waitForFunction((s) => document.getElementById('log').textContent.includes(s), await t('log.ghRacesFail'), { timeout: 30000 }).catch(() => {});
    await page.click('#rankOpen');
    await page.waitForTimeout(800);
    const b0 = await text(page, 'rankBody');
    ok(b0 === await tk('official.listFail'), `(B2) ${mode}: 🏅 は一覧を取得できていないと出す`, J(b0.slice(0, 40)));
    await closeAll(page);
    // 配列でない 200 を「0 件の一覧」として覚えない (覚えると TTL の間「まだありません」のままになる)。
    const cached = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('rcsim.ghlist.') && /:d:races$/.test(k)).length);
    ok(cached === 0, `(B2) ${mode}: 失敗した一覧を覚えない (復帰したらすぐ拾う)`, `一覧のキャッシュ ${cached} 件`);
    ok(errs.length === 0, `(B2) ${mode}: ページ側の例外・console error 0 件`, errs.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }

  // ── (E) 詳細を取得できない・壊れた結果 ─────────────────────────────────────
  console.log('\n── (E) 一覧は取得できたが、各大会の詳細を取得できない・結果が壊れているとき ──');
  {
    // 全大会の event.json が通信の中断 (オフライン相当)。その後に復帰して「再読込」。
    const ctl = { mode: 'ok', detail: (dir, file) => (file === 'event.json' ? { abort: true } : null) };
    const { page, errs, t, tk } = await boot(browser, ctl);
    await until(() => J(ctl.details || {}) === ONCE);
    await page.waitForTimeout(800);
    await page.click('#rankOpen');
    await page.waitForTimeout(800);
    const b0 = await text(page, 'rankBody');
    ok(b0 === await tk('rank.partial', { n: N_RACES }) && b0 !== await t('rank.empty'),
      `(E) 全大会の詳細を取得できない: 「記録がありません」と言い切らず、${N_RACES} 件を取得できなかったと出す`, J(b0.slice(0, 50)));
    ctl.detail = null;
    await page.click('#rankReload');
    const shown = await boardsShown(page, 30000);
    await page.waitForTimeout(300);
    ok(shown && (await readBoards(page)).length === N_BOARDS && !(await page.evaluate(() => !!document.querySelector('#rankBody .rank-partialnote'))),
      '(E) 復帰して「再読込」すると集計が出る (欠けの注記は消える)');
    await closeAll(page);
    ok(errs.length === 0, '(E) ページ側の例外・console error 0 件', errs.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }
  {
    // 1 件だけ取得できない (bh1-noid が 500)・1 件は result.json が壊れている (bh1-b の finishers が配列でない)。
    const broken = { ...EVENTS['bh1-b'].result, finishers: { rank: 1 } };
    const ctl = { mode: 'ok', detail: (dir, file) => (dir === 'bh1-noid' && file === 'event.json' ? { status: 500 }
      : (dir === 'bh1-b' && file === 'result.json' ? { body: broken } : null)) };
    const { page, errs, tk } = await boot(browser, ctl);
    await until(() => J(ctl.details || {}) === ONCE);
    await page.click('#rankOpen');
    const shown = await boardsShown(page, 15000);
    await page.waitForTimeout(300);
    const b = await readBoards(page);
    const note = await page.evaluate(() => { const n = document.querySelector('#rankBody .rank-partialnote'); return n ? n.textContent.trim() : ''; });
    ok(shown && b.length === N_BOARDS - 1 && !b.some((x) => x.label.includes('BH1 無名')) && note === await tk('rank.partial', { n: 1 }),
      '(E) 1 件だけ取得できない: 残りの集計を出し、1 件が欠けていると出す', shown ? `${brief(b)}・注記 ${J(note.slice(0, 30))}` : J((await text(page, 'rankBody')).slice(0, 40)));
    const oval = b.find((x) => x.label === 'オーバル');
    ok(shown && !!oval && J(oval.authors) === J(['alice', 'bob']), '(E) 壊れた result.json が 1 件あっても集計は止まらない (その大会の行だけが無い)', oval ? J(oval.authors) : '(枠なし)');
    await closeAll(page);
    ok(errs.length === 0, '(E) ページ側の例外・console error 0 件 (壊れた結果・500 を含む)', errs.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }

  // ── (R) 取得が重なったとき ─────────────────────────────────────────────────
  console.log('\n── (R) 取得が重なったとき (取得中の「再読込」・連打・逆順の応答) ──');
  {
    // R1: 起動処理が詳細を取得している途中で、🏆 の「再読込」が失敗する (403)。読めた集計は倒さない・打破通知も出る。
    const dh = deferred();
    const ctl = { mode: 'ok', detail: (dir, file) => (file === 'event.json' ? { hold: dh } : null) };
    const { page, errs, t, tk } = await boot(browser, ctl);
    await until(() => J(ctl.details || {}) === ONCE);
    await page.click('#officialOpen');
    await page.waitForTimeout(300);
    ctl.mode = 'fail';
    await page.click('#ofReload');
    await until(() => ctl.hits >= 2);
    await page.waitForFunction((s) => document.getElementById('ofDetail').textContent.trim() === s, await tk('official.listFail'), { timeout: 15000 }).catch(() => {});
    ok((await text(page, 'ofDetail')) === await tk('official.listFail'), '(R1) 🏆 の「再読込」が失敗すると、取得できていないと出す', J((await text(page, 'ofDetail')).slice(0, 40)));
    await closeAll(page);
    dh.resolve();
    const beatenLine = await t('log.w6.beaten', { course: 'オーバル', cls: await t('event.class.open'), who: 'bob', gap: '0.50' });
    await page.waitForFunction((s) => document.getElementById('log').textContent.includes(s), beatenLine, { timeout: 15000 }).catch(() => {});
    await page.click('#rankOpen');
    const shown = await boardsShown(page, 10000);
    ok(shown && (await readBoards(page)).length === N_BOARDS && J(ctl.details) === ONCE,
      '(R1) 詳細の取得中に一覧の取り直しが失敗しても、読めた集計はそのまま出る', shown ? `詳細 ${J(ctl.details)}` : J((await text(page, 'rankBody')).slice(0, 40)));
    ok(count(await logText(page), beatenLine) === 1, '(R1) 起動時の打破通知も 1 回出る', `${count(await logText(page), beatenLine)} 回`);
    await closeAll(page);
    ok(errs.length === 0, '(R1) ページ側の例外・console error 0 件', errs.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }
  {
    // R2: 🏅 の「再読込」を続けて 2 回。1 回目の応答 (大会 1 件だけの古い一覧) が 2 回目 (全大会) より後に届く。
    const ctl = { mode: 'ok' };
    const { page, errs } = await boot(browser, ctl);
    await page.click('#rankOpen');
    await boardsShown(page, 30000);
    const late = deferred();
    ctl.script = [{ hold: late, ids: ['bh1-a'] }, {}];
    const h0 = ctl.hits;
    await page.click('#rankReload');
    await until(() => ctl.hits === h0 + 1);
    await page.click('#rankReload');
    await until(() => ctl.hits === h0 + 2);
    // 2 回目 (全大会) が決着するのを待つ (2 回目の続きが「読み込み中」の表示を消す。1 回目の続きは応答待ちで止まっている)。
    const second = await page.waitForFunction(() => document.getElementById('rankMsg').textContent === '', null, { timeout: 30000 }).then(() => true, () => false);
    ok(second, '(R2) 2 回目の「再読込」が、1 回目の応答を待たずに決着する');
    late.resolve();                               // 1 回目 (古い一覧) が遅れて届く
    await page.waitForTimeout(2000);
    const b = await readBoards(page);
    ok(b.length === N_BOARDS && (await text(page, 'rankMsg')) === '', '(R2) 「再読込」の連打で応答が逆順に届いても、最後に始めた取得 (全大会) で決まる', brief(b));
    await closeAll(page);
    await page.click('#officialOpen');
    await page.waitForTimeout(300);
    const opts = await page.evaluate(() => [...document.querySelectorAll('#ofRace option')].map((o) => o.value));
    ok(J(opts) === J(['', ...Object.keys(EVENTS)]), '(R2) 🏆 の選択欄も全大会 (遅れて届いた古い一覧で上書きされない)', J(opts));
    await closeAll(page);
    ok(errs.length === 0, '(R2) ページ側の例外・console error 0 件', errs.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }
  {
    // R3: 起動処理の詳細の取得 (大会 1 件だけの一覧・応答は止めてある) を、「再読込」(全大会) が追い越す。
    //     追い越された古い取得が後から決着しても、集計を上書きしない。
    const dh = deferred();
    const ctl = { mode: 'ok', script: [{ ids: ['bh1-a'] }], detail: (dir, file, n) => (dir === 'bh1-a' && file === 'event.json' && n === 1 ? { hold: dh } : null) };
    const { page, errs } = await boot(browser, ctl);
    await until(() => (ctl.details || {})['bh1-a'] === 1);
    await page.click('#rankOpen');
    await page.waitForTimeout(500);
    await page.click('#rankReload');
    const shown = await boardsShown(page, 30000);
    await page.waitForTimeout(500);
    const b1 = await readBoards(page);
    dh.resolve();                                 // 追い越された古い取得が決着する
    await page.waitForTimeout(2000);
    const b2 = await readBoards(page);
    ok(shown && b1.length === N_BOARDS && J(b2) === J(b1), '(R3) 「再読込」に追い越された古い取得は、後から決着しても集計を上書きしない', `決着前 ${b1.length} 枠・後 ${b2.length} 枠`);
    await closeAll(page);
    ok(errs.length === 0, '(R3) ページ側の例外・console error 0 件', errs.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }

  // ── (S) 🏆 で大会を続けて選ぶ ──────────────────────────────────────────────
  console.log('\n── (S) 🏆 で応答の遅い大会を選んだ直後に別の大会を選んだとき ──');
  {
    const ctl = { mode: 'ok' };
    const { page, errs, t } = await boot(browser, ctl);
    await page.click('#rankOpen');                // 起動時の詳細の取得が済むのを待つ (以降の event.json は 🏆 の選択だけ)
    await boardsShown(page, 30000);
    await closeAll(page);
    const dh = deferred();
    ctl.detail = (dir, file) => (dir === 'bh1-a' && file === 'event.json' ? { hold: dh } : null);
    await page.click('#officialOpen');
    await page.waitForTimeout(300);
    await page.selectOption('#ofRace', 'bh1-a');
    await page.waitForTimeout(300);
    await page.selectOption('#ofRace', 'bh1-dup2');
    const titleOf = () => page.evaluate(() => { const td = document.querySelector('#ofDetail .race-metatab td'); return td ? td.textContent.trim() : ''; });
    await page.waitForFunction(() => !!document.querySelector('#ofDetail .race-metatab td'), null, { timeout: 15000 }).catch(() => {});
    const t1 = await titleOf();
    dh.resolve();                                 // 先に選んだ大会の応答が遅れて届く
    await page.waitForTimeout(1500);
    const t2 = await titleOf();
    ok(t1 === 'BH1 bh1-dup2' && t2 === 'BH1 bh1-dup2' && (await page.evaluate(() => document.getElementById('ofRace').value)) === 'bh1-dup2',
      '(S) 遅れて届いた前の大会が、後から選んだ大会の詳細を上書きしない', `届く前 ${J(t1)}・届いた後 ${J(t2)}`);
    await closeAll(page);
    ok(errs.length === 0, '(S) ページ側の例外・console error 0 件', errs.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }

  {
    // S2: 🏆 の「再読込」を続けて 2 回 (1 回目の応答が後に届く)。2 回目が決着してから大会を選ぶ。遅れて決着した
    //     1 回目の続きが、選択と詳細を消さない・選択欄を古い一覧 (大会 1 件) に戻さない。
    const ctl = { mode: 'ok' };
    const { page, errs } = await boot(browser, ctl);
    await page.click('#rankOpen');
    await boardsShown(page, 30000);
    await closeAll(page);
    await page.click('#officialOpen');
    await page.waitForTimeout(300);
    const late = deferred();
    ctl.script = [{ hold: late, ids: ['bh1-a'] }, {}];
    const h0 = ctl.hits;
    await page.click('#ofReload');
    await until(() => ctl.hits === h0 + 1);
    await page.click('#ofReload');
    await until(() => ctl.hits === h0 + 2);
    await page.waitForFunction(() => document.getElementById('ofMsg').textContent === '' && document.querySelectorAll('#ofRace option').length > 2, null, { timeout: 30000 }).catch(() => {});
    await page.selectOption('#ofRace', 'bh1-b');
    await page.waitForFunction(() => !!document.querySelector('#ofDetail .race-metatab td'), null, { timeout: 15000 }).catch(() => {});
    late.resolve();
    await page.waitForTimeout(1500);
    const st = await page.evaluate(() => ({ sel: document.getElementById('ofRace').value, n: document.querySelectorAll('#ofRace option').length,
      title: (document.querySelector('#ofDetail .race-metatab td') || { textContent: '' }).textContent.trim() }));
    ok(st.sel === 'bh1-b' && st.n === N_RACES + 1 && st.title === 'BH1 bh1-b', '(S2) 🏆 の「再読込」の連打: 遅れて決着した古い取り直しが、選択・詳細・選択欄を上書きしない', J(st));
    await closeAll(page);
    ok(errs.length === 0, '(S2) ページ側の例外・console error 0 件', errs.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }

  // ── (R4) 🏆 の「再読込」と起動時の打破通知 ─────────────────────────────────
  // 起動時の打破通知は投稿コースの一覧の決着を待つ (最長 10 秒)。その間に 🏆 で「再読込」(成功・大会の顔ぶれは同じ) しても、
  // 通知は 1 回出る・詳細を取り直しに行かない (詳細の取得は大会ごとに API を使いうる)。
  // 2 回目以降の詳細の応答は止めてある＝もし取り直しを始める実装なら、その取得は決着しないまま通知の番が来る。
  console.log('\n── (R4) 起動時の打破通知を待つ間に 🏆 で「再読込」したとき ──');
  {
    const never = deferred();
    const ctl = { mode: 'ok', community: deferred(), detail: (dir, file, n) => (file === 'event.json' && n >= 2 ? { hold: never } : null) };
    const { page, errs, t } = await boot(browser, ctl);
    await until(() => J(ctl.details || {}) === ONCE);
    await page.waitForTimeout(1000);              // 起動時の詳細の取得が済む (投稿コースの一覧は止めてある＝打破通知はまだ)
    const beatenLine = await t('log.w6.beaten', { course: 'オーバル', cls: await t('event.class.open'), who: 'bob', gap: '0.50' });
    ok(count(await logText(page), beatenLine) === 0, '(R4) 投稿コースの一覧が決着する前は、打破通知はまだ出ていない');
    await page.click('#officialOpen');
    await page.waitForTimeout(300);
    await page.click('#ofReload');
    await until(() => ctl.hits >= 2);
    await page.waitForFunction(() => document.getElementById('ofMsg').textContent === '', null, { timeout: 15000 }).catch(() => {});
    await closeAll(page);
    await page.waitForTimeout(500);
    ctl.community.resolve();
    await page.waitForFunction((s) => document.getElementById('log').textContent.includes(s), beatenLine, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);
    ok(count(await logText(page), beatenLine) === 1, '(R4) 🏆 で「再読込」した後でも、起動時の打破通知は 1 回出る', `${count(await logText(page), beatenLine)} 回`);
    await page.click('#rankOpen');
    const shown = await boardsShown(page, 10000);
    ok(shown && (await readBoards(page)).length === N_BOARDS && J(ctl.details) === ONCE,
      '(R4) 大会の顔ぶれが同じなら、🏆 の「再読込」の後に 🏅 を開いても詳細を取り直さない', shown ? `詳細 ${J(ctl.details)}` : J((await text(page, 'rankBody')).slice(0, 40)));
    never.resolve();
    await closeAll(page);
    ok(errs.length === 0, '(R4) ページ側の例外・console error 0 件', errs.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }

  // ── (C) 一覧が届く前に 🏆 を開く ───────────────────────────────────────────
  console.log('\n── (C) 大会一覧が届く前に 🏆 公式レースを開いたとき ──');
  {
    const ctl = { mode: 'ok', hold: deferred() };
    const { page, errs, t } = await boot(browser, ctl);
    await until(() => ctl.hits >= 1);
    await page.click('#officialOpen');
    await page.waitForTimeout(500);
    const o0 = await text(page, 'ofDetail');
    ok(o0 === await t('official.loading'), '(C) 一覧が届く前は「読み込み中」と出す (「まだありません」と言い切らない)', J(o0.slice(0, 40)));
    ctl.hold.resolve();
    await page.waitForFunction(() => document.querySelectorAll('#ofRace option').length > 1, null, { timeout: 10000 }).catch(() => {});
    const opts = await page.evaluate(() => [...document.querySelectorAll('#ofRace option')].map((o) => o.value));
    ok(J(opts) === J(['', ...Object.keys(EVENTS)]) && (await text(page, 'ofDetail')) === await t('official.pickHint'),
      '(C) 一覧が届くと「再読込」を押さずに大会を選べる', `選択肢 ${opts.length - 1} 件・${J((await text(page, 'ofDetail')).slice(0, 30))}`);
    await closeAll(page);
    await page.click('#rankOpen');
    const shown = await boardsShown(page, 30000);
    ok(shown && (await readBoards(page)).length === N_BOARDS, '(C) その後に 🏅 を開くと集計が出る');
    await closeAll(page);
    ok(errs.length === 0, '(C) ページ側の例外・console error 0 件', errs.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }

  // ── (M) races/ が未作成 (404) ──────────────────────────────────────────────
  // 大会がまだ無い正常な状態。取得失敗とは区別し、従来どおりの文言を出す (改修の前後で同じ)。
  console.log('\n── (M) races/ が未作成のとき (404) ──');
  {
    const ctl = { mode: 'miss' };
    const { page, errs, t } = await boot(browser, ctl);
    await page.waitForFunction((s) => document.getElementById('log').textContent.includes(s), await t('log.ghRacesFail'), { timeout: 30000 }).catch(() => {});
    await page.click('#rankOpen');
    await page.waitForTimeout(800);
    const b0 = await text(page, 'rankBody');
    ok(b0 === await t('rank.empty'), '(M) 🏅 は従来どおり「まだ検証済の公式記録がありません」', J(b0.slice(0, 40)));
    await closeAll(page);
    await page.click('#officialOpen');
    await page.waitForTimeout(400);
    const o0 = await text(page, 'ofDetail');
    ok(o0 === await t('official.none'), '(M) 🏆 は従来どおり「公式レースはまだありません」', J(o0.slice(0, 40)));
    await closeAll(page);
    ok(ctl.hits === 1, '(M) 一覧の API は 1 回だけ', `${ctl.hits} 回`);
    // その後に大会ができた: 🏆 の「再読込」で一覧を取り直すと、次に 🏅 を開いたときに集計が読み直される (🏅 側の「再読込」は要らない)。
    ctl.mode = 'ok';
    await page.click('#officialOpen');
    await page.waitForTimeout(300);
    await page.click('#ofReload');
    await page.waitForFunction(() => document.querySelectorAll('#ofRace option').length > 1, null, { timeout: 15000 }).catch(() => {});
    const opts = await page.evaluate(() => [...document.querySelectorAll('#ofRace option')].map((o) => o.value));
    await closeAll(page);
    await page.click('#rankOpen');
    const shown = await boardsShown(page, 15000);
    ok(opts.length === N_RACES + 1 && shown && (await readBoards(page)).length === N_BOARDS && ctl.hits === 2,
      '(M) 大会ができた後に 🏆 で「再読込」すると、🏅 も読み直されて集計が出る', `🏆 の選択肢 ${opts.length - 1} 件・🏅 ${shown ? '集計あり' : J((await text(page, 'rankBody')).slice(0, 30))}・一覧の API ${ctl.hits} 回`);
    await closeAll(page);
    ok(errs.length === 0, '(M) ページ側の例外・console error 0 件', errs.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }
} finally { await browser.close(); }
console.log(`\n${'─'.repeat(60)}\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗: ' + fails.join(' / ')); process.exitCode = 1; }
else console.log('結果: PASS (ランキングは大会一覧の決着を待ち、👻 は記録が出た大会で走る)');
