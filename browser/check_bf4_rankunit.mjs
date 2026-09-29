// check_bf4_rankunit.mjs — BF4「ランキング・シーズンの集計単位」の実ブラウザ検証
// ════════════════════════════════════════════════════════════════════════════
// 何を測るか:
//   公式記録のランキング (🏅) はクラス×コースで枠を作る。改修前は枠の鍵が `event.course` の**文字列**だったので、
//   ① 同じ投稿コースでも名前で開催した大会とファイル名で開催した大会が別の枠になり、見出しにファイル名が出た
//   ② コース定義を同梱した大会 (course がオブジェクト) は `String()` で `[object Object]` の 1 枠に束ねられた
//      (別々の同梱コースの記録が 1 つの表に並び、👻 あなた vs 世界ベスト は「ゴースト無し」になった)
//   (BE-6 ② (a)・改修前ツリーで実測)。BF4 は枠の鍵を「再検証が走らせるコースの形」(練習記録の鍵と同じ `practiceCourseId`) にした。
// 本ゲートは利用者と同じ UI (起動 → 🏅 ランキング → 👻) だけで通す (CI-8)。差し替えるのは上流の応答と起動前の
//   localStorage (自分の GitHub 名) だけ。期待する文言は配信中の t() で組む (写さない)。
//   (1) 投稿一覧を読めているとき: 名前参照・ファイル名参照・名前だけ違う同じ形の投稿は 1 枠 (見出しは表示名)。
//       出荷『オーバル』と name『オーバル』の投稿 (形が違う) は別の枠。同梱 def は def ごとに枠 (同じ def は 1 枠・鍵の
//       並びが違っても同じ)、見出しに `[object Object]` が出ない。世界ベスト (👻)・抜かれている (⚔)・言語別の帯が新しい枠に従う。
//   (2) 投稿一覧を読めていないとき: 投稿コースの参照は従来どおり文字列で束ねる (勝手にまとめない・落ちない)。
//   (3) en: 出荷コースの見出しは英名、同梱 def の注記も英語。
//   (4) 投稿一覧が届く前に 🏅 を開いた: 届いたら開いたまま今の枠で描き直す。起動時の打破通知は一覧を読み終えてから出る。
//   層 4 の指摘から: 形の違う同名の投稿 2 本は見出しにファイル名が添わる (改修前はファイル名で見分けられた)・検査で断られた
//   同梱 def も注記つき (出荷『オーバル』と同じ見出しにしない)・(2b) 一覧の一部だけ読めた ('partial') ときも投稿コースの参照は
//   まとめない (読めた分だけで解決すると取り違えうる)・(5) 一覧の取得が止まっても打破通知は出る (待つのは最長 10 秒)。
// 使い方: bash run.sh check_bf4_rankunit.mjs
import { launch, newPage, appModule, setLang, APP_URL } from './lib.mjs';
import { PROGRAMS } from '../public/js/programs.js';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m, d = '') => { if (c) { pass++; console.log(`  ✓ ${m}${d ? ' — ' + d : ''}`); } else { fail++; fails.push(m); console.log(`  ✗ ${m}${d ? ' — ' + d : ''}`); } };

// ── 治具 ────────────────────────────────────────────────────────────────────
const ring = (W, H, m) => {
  const r = (x1, y1, x2, y2) => [{ x1, y1, x2, y2: y1 }, { x1: x2, y1, x2, y2 }, { x1: x2, y1: y2, x2: x1, y2 }, { x1, y1: y2, x2: x1, y2: y1 }];
  return [...r(0, 0, W, H), ...r(m, m, W - m, H - m)];
};
const mk = (name, W, H, m) => ({ name, bounds: { w: W, h: H }, start: { x: 0.35, y: m / 2, theta: 0 },
  finish: { x1: 0.35, y1: 0, x2: 0.35, y2: m }, walls: ring(W, H, m) });
// 投稿コース: bf4-course と bf4-copy は名前だけが違う同じ形。bf4-oval は出荷『オーバル』と同じ名前で形が違う。
// bf4-dupa と bf4-dupb は同じ名前で形が違う (名前だけではどちらか言えない)。
const FILES = {
  'bf4-course.json': mk('BF4 コース', 3, 2, 0.5),
  'bf4-copy.json': mk('BF4 コピー', 3, 2, 0.5),
  'bf4-oval.json': mk('オーバル', 5, 3, 0.8),
  'bf4-dupa.json': mk('BF4 同名', 3.5, 2, 0.5),
  'bf4-dupb.json': mk('BF4 同名', 4, 2.5, 0.5),
};
const DEF_A = mk('BF4 同梱A', 4, 3, 0.6);
const DEF_A2 = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(DEF_A))).reverse());   // 同じ def・鍵の並びだけ違う
const DEF_B = mk('BF4 同梱B', 4.5, 2.5, 0.6);
// 検査で断られる同梱 def (枠から遠く離れた壁)。名前は出荷コースと同じ。
const DEF_BAD = { ...mk('オーバル', 3, 2, 0.5) }; DEF_BAD.walls = [...DEF_BAD.walls, { x1: 50, y1: 50, x2: 51, y2: 50 }];
const prog = (key) => { const p = PROGRAMS.find((x) => x.key === key); return { src: p.code, lang: p.lang || 'c' }; };
const PROG = { c: prog('normal_fr'), py: prog('py_normal_fr'), js: { src: '// bf4 (走らせない)', lang: 'js' } };
const LANG = { alice: 'c', bob: 'py', carol: 'c', hana: 'js', dave: 'c', ivan: 'c', erin: 'c', frank: 'c', gina: 'c', kei: 'c', leo: 'c', mia: 'c' };
// [id, course, [[著者, 総合 ms], …]]。bob は bf4-name で 2 位・bf4-file で 1 位 (9.5 s)＝同じ形の枠なら世界ベスト。
const RACES = [
  ['bf4-name', 'BF4 コース', [['alice', 10000], ['bob', 11000]]],
  ['bf4-file', 'bf4-course', [['bob', 9500], ['carol', 12000]]],
  ['bf4-copy', 'BF4 コピー', [['hana', 13000]]],
  ['bf4-defA', DEF_A, [['dave', 20000]]],
  ['bf4-defA2', DEF_A2, [['ivan', 19000]]],
  ['bf4-defB', DEF_B, [['erin', 21000]]],
  ['bf4-preset', 'オーバル', [['frank', 15000]]],
  ['bf4-fake', 'bf4-oval', [['gina', 14000]]],
  ['bf4-dupa', 'bf4-dupa', [['kei', 16000]]],
  ['bf4-dupb', 'bf4-dupb', [['leo', 17000]]],
  ['bf4-defbad', DEF_BAD, [['mia', 18000]]],
];
const EVENTS = Object.fromEntries(RACES.map(([id, course, order]) => {
  const event = { id, title: 'BF4 ' + id, course, class: 'open', regime: 'tabletop', laps: 1, maxSec: 8, entryWindow: { open: '', close: '' } };
  const entries = order.map(([a], i) => ({ name: a + '-car', author: a, program: PROG[LANG[a]], carType: 'normal_fr', submittedAt: `2026-01-01T00:00:0${i}Z` }));
  // 正準ツール (wf_official_result.mjs buildResult) と同じく result.course = event.course (同梱 def はオブジェクトのまま)。
  const result = { eventId: id, engineVer: 'v8.8.0', class: 'open', course, regime: 'tabletop', laps: 1,
    finishers: order.map(([a, ms], i) => ({ rank: i + 1, name: a + '-car', author: a, carType: 'normal_fr', totalTimeMs: ms, bestLapMs: ms, penaltiesSec: 0 })),
    dnf: [], grid: [], verifyHash: 'bf4' + id.length.toString(16) + id.slice(-2), computedAt: '2026-09-29T00:00:00Z' };
  return [id, { event, entries, result }];
}));

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
// me: 自分の GitHub 名。missFile: 目録には載るが本体の取得が 500 (＝'partial')。hangFile: 本体の応答が返らない (一覧が決着しない)。
async function stub(p, { communityFail = false, me = 'alice', missFile = null, hangFile = null } = {}) {
  await p.addInitScript((who) => { try { localStorage.setItem('rumicar.lang', 'ja'); localStorage.setItem('rumicar.author', who); } catch (e) {} }, me);
  const names = [...Object.keys(FILES), ...[missFile, hangFile].filter(Boolean)];
  if (communityFail) {
    await p.route('**/courses/community/index.json*', (r) => r.fulfill({ status: 500, contentType: 'text/plain', body: 'bf4 fail' }));
    await p.route(/api\.github\.com\/repos\/.*\/contents\/courses\/community/, (r) => r.fulfill({ status: 500, contentType: 'text/plain', body: 'bf4 fail' }));
  } else await p.route('**/courses/community/index.json*', (r) => r.fulfill(json({ generated: 'check_bf4', entries: names })));
  await p.route(/\/courses\/community\/bf4-[a-z]+\.json(?:[?#]|$)/, async (r) => {
    const n = decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop());
    if (n === missFile) return r.fulfill({ status: 500, contentType: 'text/plain', body: 'bf4 fail' });
    if (n === hangFile) return new Promise(() => {});   // 返さない
    return r.fulfill({ status: 200, contentType: 'text/plain', body: JSON.stringify(FILES[n]) });
  });
  await p.route(/api\.github\.com\/repos\/.*\/contents\/races\?/, (r) => r.fulfill(json(Object.keys(EVENTS).map((id) => ({ name: id, type: 'dir', path: `races/${id}` })))));
  await p.route(/raw\.githubusercontent\.com\/.*\/races\/bf4-[A-Za-z0-9]+\//, (r) => {
    const m = /\/races\/([^/]+)\/(.+)$/.exec(decodeURIComponent(new URL(r.request().url()).pathname));
    const ev = m && EVENTS[m[1]];
    if (!ev) return r.fulfill({ status: 404, contentType: 'text/plain', body: '404: Not Found' });
    if (m[2] === 'event.json') return r.fulfill(json(ev.event));
    if (m[2] === 'result.json') return r.fulfill(json(ev.result));
    if (m[2] === 'entries/index.json') return r.fulfill(json({ entries: ev.entries.map((e) => e.author + '.json') }));
    const e = /^entries\/(.+)\.json$/.exec(m[2]);
    const en = e && ev.entries.find((x) => x.author === e[1]);
    return en ? r.fulfill(json(en)) : r.fulfill({ status: 404, contentType: 'text/plain', body: '404: Not Found' });
  });
}

// 🏅 のクラス別ラダー (👻 ボタンを持つ枠) を読む。見出しは「<クラス> — <コース>」の <コース>。
const readBoards = (page) => page.evaluate(() => [...document.querySelectorAll('#rankBody .rank-vsworld')].map((btn) => {
  const head = btn.parentElement, board = head.parentElement;
  const txt = head.textContent.replace(btn.textContent, '');
  const sep = ' — ';
  return { label: txt.slice(txt.indexOf(sep) + sep.length).trim(), key: btn.dataset.course,
    authors: [...board.querySelectorAll('table tbody tr')].map((tr) => tr.children[2].textContent.trim()),
    chips: [...board.querySelectorAll('.rank-langchip')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()) };
}));
async function openRank(page) {
  await page.evaluate(() => { const d = document.getElementById('dlgRankings'); if (d.open) d.close(); });
  await page.click('#rankOpen');
  await page.waitForFunction(() => document.querySelectorAll('#rankBody .rank-vsworld').length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(300);
  return readBoards(page);
}
// 枠 (著者の集合で特定) の 👻 を押し、ゴースト対戦が開いたか・凡例 (誰と走ったか) を返す。
async function vsWorld(page, hasAuthor) {
  const boards = await openRank(page);
  const i = boards.findIndex((b) => b.authors.includes(hasAuthor));
  if (i < 0) return { found: false };
  const logBefore = await page.evaluate(() => document.getElementById('log').textContent.length);
  await page.locator('#rankBody .rank-vsworld').nth(i).click();
  // 開いた (成功) か、ログが 1 行増えた (「ゴースト無し」等) まで待つ。
  await page.waitForFunction((n) => document.getElementById('dlgGhost').open
    || document.getElementById('log').textContent.length > n, logBefore, { timeout: 60000 });
  await page.waitForTimeout(600);
  const r = await page.evaluate((n) => ({ ghost: document.getElementById('dlgGhost').open,
    legend: document.getElementById('ghostLegend').textContent, log: document.getElementById('log').textContent.slice(n) }), logBefore);
  await page.evaluate(() => { for (const id of ['dlgGhost', 'dlgRankings']) { const d = document.getElementById(id); if (d.open) d.close(); } });
  await page.waitForTimeout(300);
  return { found: true, ...r };
}

const browser = await launch();
try {
  // ── (1) 投稿一覧を読めている ───────────────────────────────────────────────
  console.log('\n── (1) 投稿一覧を読めているとき ──');
  {
    const { page, errors, benign } = await newPage(browser, { before: (p) => stub(p) });
    await page.waitForFunction(() => [...document.querySelectorAll('#courseSel option')].some((o) => o.value === 'gh:bf4-course'), null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const t = (key, params) => appModule(page, 'js/i18n.js', `(m) => m.t(${JSON.stringify(key)}, ${JSON.stringify(params || {})})`);
    const hasKey = (key) => appModule(page, 'js/i18n.js', `(m) => m.hasKey(${JSON.stringify(key)})`);
    const cls = await t('event.class.open');
    // 同じ形に束ねた別名は符号単位の昇順で ' / ' に並ぶ (環境の locale に依らない順)。
    const MERGED = ['🌐 BF4 コース', '🌐 BF4 コピー'].sort().join(' / ');
    const bundled = async (name) => ((await hasKey('rank.course.bundled')) ? t('rank.course.bundled', { name }) : `(未定義のキー rank.course.bundled) ${name}`);
    const DUPA = '🌐 BF4 同名 (bf4-dupa)', DUPB = '🌐 BF4 同名 (bf4-dupb)';
    const WANT = [MERGED, await bundled('BF4 同梱A'), await bundled('BF4 同梱B'), 'オーバル', '🌐 オーバル', DUPA, DUPB, await bundled('オーバル')];

    // 起動時の打破通知 (alice の記録 10.0 s は、同じ形の枠では bob の 9.5 s に抜かれている)。
    const startLog = await page.evaluate(() => document.getElementById('log').textContent);
    const beatenLine = await t('log.w6.beaten', { course: MERGED, cls, who: 'bob', gap: '0.50' });
    ok(startLog.includes(beatenLine), '(1) 起動時の打破通知が同じ形の枠で出る (alice 10.0 s は bob 9.5 s に抜かれている)', JSON.stringify(beatenLine));

    const boards = await openRank(page);
    console.log('    枠: ' + JSON.stringify(boards.map((b) => [b.label, b.authors.join(',')])));
    ok(boards.every((b) => !b.label.includes('[object Object]') && !String(b.key).includes('[object Object]')),
      '(1) 見出し・枠の鍵に [object Object] が無い', JSON.stringify(boards.map((b) => b.key)));
    ok(boards.length === WANT.length, `(1) 枠の数 = ${WANT.length} (同じ形 3 参照で 1・同梱 A/A'/B で 2・出荷/同名投稿で 2・同名の投稿 2・断られた同梱 1)`, `実測 ${boards.length}`);
    const byAuthor = (a) => boards.find((b) => b.authors.includes(a));
    const m = byAuthor('alice');
    ok(!!m && ['alice', 'bob', 'carol', 'hana'].every((a) => m.authors.includes(a)) && m.authors.length === 5,
      '(1) 名前参照・ファイル名参照・名前だけ違う同じ形の投稿の記録が 1 枠に並ぶ (5 行)', m ? m.authors.join(',') : '(枠なし)');
    ok(!!m && m.label === MERGED, '(1) その見出しはコースの表示名 (ファイル名を出さない)', m ? JSON.stringify(m.label) : '');
    ok(!!m && m.authors[0] === 'bob', '(1) その枠の 👑 は bob (9.5 s・ファイル名参照の大会)', m ? m.authors[0] : '');
    const a = byAuthor('dave'), b = byAuthor('erin');
    ok(!!a && a.authors.includes('ivan') && !a.authors.includes('erin') && !!b && b.authors.length === 1,
      '(1) 同梱 def は def ごとに枠 (同じ def は鍵の並びが違っても 1 枠・別の def は混ざらない)', `A=${a && a.authors} B=${b && b.authors}`);
    ok(!!a && a.label === WANT[1] && !!b && b.label === WANT[2], '(1) 同梱 def の見出しは def の名前＋同梱の注記', `${a && JSON.stringify(a.label)} / ${b && JSON.stringify(b.label)}`);
    const pf = byAuthor('frank'), fk = byAuthor('gina');
    ok(!!pf && !!fk && pf !== fk && pf.authors.length === 1 && fk.authors.length === 1,
      '(1) 出荷『オーバル』と name『オーバル』の投稿 (形が違う) は別の枠', `出荷=${pf && pf.authors} 投稿=${fk && fk.authors}`);
    ok(!!pf && pf.label === 'オーバル' && !!fk && fk.label === '🌐 オーバル', '(1) 見出しで出荷と投稿を見分けられる', `${pf && JSON.stringify(pf.label)} / ${fk && JSON.stringify(fk.label)}`);
    const da = byAuthor('kei'), db = byAuthor('leo');
    ok(!!da && !!db && da !== db && da.label === DUPA && db.label === DUPB,
      '(1) 形の違う同名の投稿 2 本は別の枠で、見出しにファイル名が添わる (名前だけではどちらか言えない)', `${da && JSON.stringify(da.label)} / ${db && JSON.stringify(db.label)}`);
    const bad = byAuthor('mia');
    ok(!!bad && !!pf && bad !== pf && bad.label === WANT[7] && bad.label !== pf.label,
      '(1) 検査で断られた同梱 def (名前は出荷と同じ) も注記つきの見出しで、出荷コースの枠と見分けられる', bad ? JSON.stringify(bad.label) : '');
    ok(JSON.stringify(boards.map((x) => x.label).sort()) === JSON.stringify([...WANT].sort()), '(1) 見出しの集合が期待どおり', JSON.stringify(boards.map((x) => x.label)));

    // 言語別の帯 (同じ枠の中の言語ごとの最速と件数)。
    const chips = m ? m.chips : [];
    ok(chips.length === 3 && chips.some((c) => c.startsWith('C 👑 alice-car') && /n=2$/.test(c)) &&
       chips.some((c) => c.startsWith('Python 👑 bob-car') && /n=2$/.test(c)) && chips.some((c) => c.startsWith('JAVASCRIPT') || c.startsWith('JavaScript')),
      '(1) 言語別の帯が同じ形の枠で数える (C: alice n=2・Python: bob n=2・JavaScript)', JSON.stringify(chips));

    // ⚔ あなたの記録 vs 世界ベスト (ダイアログ内)。
    const beatenRows = await page.evaluate(() => [...document.querySelectorAll('#rankBody .rank-beaten li')].map((li) => li.textContent));
    ok(beatenRows.length === 1 && beatenRows[0].startsWith(MERGED + ' (') && beatenRows[0].includes('bob'),
      '(1) ⚔ 抜かれている記録は同じ形の枠の 1 件 (見出しと同じ名前で出る)', JSON.stringify(beatenRows));
    await page.evaluate(() => document.getElementById('dlgRankings').close());

    // 👻 あなた vs 世界ベスト: 世界ベストの記録を新しい枠で引き、そのコースで走らせる。
    const g1 = await vsWorld(page, 'alice');
    ok(g1.found && g1.ghost && g1.legend.includes('bob-car'), '(1) 同じ形の枠の 👻 は bob (ファイル名参照の大会の記録) と走る', JSON.stringify(g1.legend || g1.log || ''));
    const g2 = await vsWorld(page, 'dave');
    ok(g2.found && g2.ghost && g2.legend.includes('ivan-car'), '(1) 同梱 def の枠の 👻 は、その def の世界ベスト (ivan) と走る (「ゴースト無し」にならない)', JSON.stringify(g2.legend || g2.log || ''));

    // ── (3) en ──
    console.log('\n── (3) en ──');
    await setLang(page, 'en');
    const en = await openRank(page);
    const enB = await (async () => ((await hasKey('rank.course.bundled')) ? t('rank.course.bundled', { name: 'BF4 同梱A' }) : '(未定義のキー)'))();
    ok(en.some((x) => x.label === 'Oval') && !en.some((x) => x.label === 'オーバル'), '(3) 出荷コースの見出しは英名 (Oval)', JSON.stringify(en.map((x) => x.label)));
    ok(en.some((x) => x.label === enB) && /[A-Za-z]/.test(enB.replace('BF4', '')), '(3) 同梱 def の注記も英語', JSON.stringify(enB));
    await page.evaluate(() => document.getElementById('dlgRankings').close());
    await setLang(page, 'ja');

    console.log(`\n除外した想定内の応答: ${benign.length} 件`);
    ok(errors.length === 0, '(1) ページ側のエラー 0 件', errors.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }

  // ── (2) 投稿一覧を読めていない ─────────────────────────────────────────────
  console.log('\n── (2) 投稿一覧を読めていないとき ──');
  {
    const { page, errors } = await newPage(browser, { before: (p) => stub(p, { communityFail: true }) });
    await page.waitForTimeout(2500);
    const boards = await openRank(page);
    console.log('    枠: ' + JSON.stringify(boards.map((b) => [b.label, b.authors.join(',')])));
    const byAuthor = (a) => boards.find((b) => b.authors.includes(a));
    const n = byAuthor('alice'), f = byAuthor('bob'), c = byAuthor('hana');
    ok(!!n && !!c && n !== c && n.label === 'BF4 コース' && c.label === 'BF4 コピー' && boards.filter((b) => b.label === 'bf4-course').length === 1,
      '(2) 投稿コースの参照は文字列ごとの枠のまま (名前・ファイル名・別名を勝手にまとめない)', JSON.stringify(boards.map((b) => b.label)));
    ok(!!f && boards.filter((b) => b.authors.includes('bob')).length === 2, '(2) bob の 2 記録は別々の枠 (従来どおり)');
    ok(boards.every((b) => !b.label.includes('[object Object]')), '(2) 見出しに [object Object] が無い');
    const a = byAuthor('dave'), b = byAuthor('erin');
    ok(!!a && a.authors.includes('ivan') && !!b && a !== b, '(2) 同梱 def は投稿一覧に依らず def ごとの枠', `A=${a && a.authors} B=${b && b.authors}`);
    ok(boards.length === 10, '(2) 枠の数 = 10 (文字列 3＋同梱 2＋出荷 1＋ファイル名 3＋断られた同梱 1)', `実測 ${boards.length}`);
    const unexpected = errors.filter((e) => !/http 500 .*(courses\/community\/index\.json|contents\/courses\/community)/.test(e));
    ok(unexpected.length === 0, '(2) 仕込んだ 500 以外のページ側のエラー 0 件', unexpected.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }

  // ── (2b) 投稿一覧の一部だけ読めた ('partial') ─────────────────────────────────
  // 目録には載っているのに本体の取得が 1 件だけ失敗する。読めた投稿は一覧に並ぶ (communityCourses は空でない) ので、
  // 'ok' 以外で解決しない分岐 (main.js raceCourseUnit) が無いと、読めた分だけで名前・ファイル名を解決してまとめてしまう
  // (取得に失敗した投稿が同じ名前を持っていれば、他の人の一覧では名前は決まらない＝officialCourseRef と同じ基準)。
  // (2) の 'failed' と (4) の 'pending' は一覧が空なので、この分岐を測れるのはここだけ (層 4 の指摘)。
  console.log('\n── (2b) 投稿一覧の一部だけ読めたとき ──');
  {
    const { page, errors } = await newPage(browser, { before: (p) => stub(p, { missFile: 'bf4-miss.json' }) });
    await page.waitForFunction(() => [...document.querySelectorAll('#courseSel option')].some((o) => o.value === 'gh:bf4-course'), null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const boards = await openRank(page);
    console.log('    枠: ' + JSON.stringify(boards.map((b) => [b.label, b.authors.join(',')])));
    const byAuthor = (a) => boards.find((b) => b.authors.includes(a));
    ok(!!byAuthor('alice') && byAuthor('alice').label === 'BF4 コース' && boards.filter((b) => b.authors.includes('bob')).length === 2 && boards.length === 10,
      '(2b) 読めた投稿が一覧に並んでいても、一部を読めていなければ投稿コースの参照は文字列の枠のまま (10 枠)', JSON.stringify(boards.map((b) => b.label)));
    const unexpected = errors.filter((e) => !/http 500 .*bf4-miss\.json/.test(e));
    ok(unexpected.length === 0, '(2b) 仕込んだ 500 以外のページ側のエラー 0 件', unexpected.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }

  // ── (4) 投稿一覧が届く前に 🏅 を開いた ─────────────────────────────────────
  // 一覧の目録の応答を止めておき、🏅 を開いてから届ける。開いている間に一覧が届いたら今の枠で描き直すこと、
  // 起動時の打破通知は一覧を読み終えてから出ること (到着順で通知の有無が変わらない) を測る。
  // 目録の応答が止まっている間は networkidle にならないので、lib の newPage (networkidle 待ち) は使わず load で進める。
  console.log('\n── (4) 投稿一覧が届く前に 🏅 を開いたとき ──');
  {
    let release;
    const held = new Promise((r) => { release = r; });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
    // 自分は carol (bf4-file で 12.0 s)。文字列の枠でも bob (9.5 s) に抜かれている＝一覧を待たずに出すと「bf4-course」の枠で
    // 通知が出てしまう (待っていることを測れる。alice は文字列の枠では抜かれていないので測れない＝層 4 の指摘)。
    await stub(page, { me: 'carol' });
    await page.route('**/courses/community/index.json*', async (r) => { await held; return r.fulfill(json({ generated: 'check_bf4', entries: Object.keys(FILES) })); });
    await page.goto(new URL('', APP_URL.endsWith('/') ? APP_URL : APP_URL + '/').href, { waitUntil: 'load', timeout: 45000 });
    const t = (key, params) => appModule(page, 'js/i18n.js', `(m) => m.t(${JSON.stringify(key)}, ${JSON.stringify(params || {})})`);
    // 大会一覧の読込を待ってから開く (一覧より先に開くと空の集計が残る＝BF4 の範囲外の既存の事象・決定ログへ)。
    const racesLine = await t('log.ghRacesLoaded', { n: Object.keys(EVENTS).length });
    await page.waitForFunction((s) => document.getElementById('log').textContent.includes(s), racesLine, { timeout: 30000 });
    const pre = await openRank(page);   // 公式記録の詳細の読込を待って描く (投稿コースの一覧はまだ届いていない)
    const listed = await page.evaluate(() => [...document.querySelectorAll('#courseSel option')].some((o) => o.value.startsWith('gh:bf4')));
    ok(!listed && pre.length === 10 && pre.some((b) => b.label === 'bf4-course'),
      '(4) 一覧が届く前は投稿コースの参照を文字列の枠で描く (10 枠)', JSON.stringify(pre.map((b) => b.label)));
    const MERGED = ['🌐 BF4 コース', '🌐 BF4 コピー'].sort().join(' / ');
    const beatenLine = await t('log.w6.beaten', { course: MERGED, cls: await t('event.class.open'), who: 'bob', gap: '2.50' });
    const logPre = await page.evaluate(() => document.getElementById('log').textContent);
    ok(!logPre.includes('⚔'), '(4) 一覧が届く前は打破通知を出さない (枠が決まっていない)', logPre.includes('⚔') ? '出ている' : '出ていない');
    release();
    await page.waitForFunction(() => [...document.querySelectorAll('#courseSel option')].some((o) => o.value === 'gh:bf4-course'), null, { timeout: 30000 });
    await page.waitForTimeout(800);
    const open = await page.evaluate(() => document.getElementById('dlgRankings').open);
    const post = await readBoards(page);
    ok(open && post.length === 8 && post.some((b) => b.label === MERGED), '(4) 開いたまま一覧が届くと、同じ形の枠で描き直す (8 枠)', JSON.stringify(post.map((b) => b.label)));
    const logPost = await page.evaluate(() => document.getElementById('log').textContent);
    ok(logPost.includes(beatenLine), '(4) 一覧を読み終えてから打破通知が同じ形の枠で出る', JSON.stringify(beatenLine));
    ok(errs.length === 0, '(4) ページ側の例外・console error 0 件', errs.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }

  // ── (5) 投稿一覧の取得が止まった ───────────────────────────────────────────
  // 本体 1 件の応答が返らない (fetch にタイムアウトが無いので一覧が決着しない)。打破通知が永久に出ないことにならず、
  // 待つのは最長 10 秒 (main.js の起動処理)・その時点の状態 (一覧未読＝投稿コースは文字列の枠) で出ることを測る。
  console.log('\n── (5) 投稿一覧の取得が止まったとき ──');
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await stub(page, { me: 'carol', hangFile: 'bf4-hang.json' });
    await page.goto(new URL('', APP_URL.endsWith('/') ? APP_URL : APP_URL + '/').href, { waitUntil: 'load', timeout: 45000 });
    const t = (key, params) => appModule(page, 'js/i18n.js', `(m) => m.t(${JSON.stringify(key)}, ${JSON.stringify(params || {})})`);
    const racesLine = await t('log.ghRacesLoaded', { n: Object.keys(EVENTS).length });
    await page.waitForFunction((s) => document.getElementById('log').textContent.includes(s), racesLine, { timeout: 30000 });
    const t0 = Date.now();
    const line = await t('log.w6.beaten', { course: 'bf4-course', cls: await t('event.class.open'), who: 'bob', gap: '2.50' });
    let got = true;
    try { await page.waitForFunction((s) => document.getElementById('log').textContent.includes(s), line, { timeout: 25000 }); } catch (e) { got = false; }
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    const listed = await page.evaluate(() => [...document.querySelectorAll('#courseSel option')].some((o) => o.value.startsWith('gh:bf4')));
    ok(got && !listed, '(5) 一覧が決着しなくても打破通知は出る (一覧未読の枠＝bf4-course)', `大会一覧の読込から ${sec} s・一覧に投稿コース ${listed ? 'あり' : 'なし'}`);
    ok(errs.length === 0, '(5) ページ側の例外 0 件', errs.slice(0, 3).join(' / ') || '0 件');
    await page.close();
  }
} finally { await browser.close(); }
console.log(`\n${'─'.repeat(60)}\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗: ' + fails.join(' / ')); process.exitCode = 1; }
else console.log('結果: PASS (ランキングの枠は再検証が走らせるコースの形で決まる)');
