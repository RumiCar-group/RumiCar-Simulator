// check_be6_names.mjs — 投稿コースの入口で重さの上限と名前の取り違えを止める (BE6・2026-09-25)。
// ════════════════════════════════════════════════════════════════════════════
// 改修前 (HEAD dd3677f) に本番の入口で再現した事象を、利用者と同じ操作で「起きない」ことを確かめる
// (再現の数値は internal 決定ログ「BE6 着手前」)。卓上ゲート wf_be6_intake.mjs は上限の導出・数え方・配線を固定する。
//   ④ 名前/説明/全体が上限を超える投稿コースは一覧に載らず、理由つきで知らされる。上限ちょうどは載る。
//      区切りの無い説明文 (上限ちょうどの 3,300 字) を選んでもページが横にはみ出さない。
//   ⑤ (a) 保存名がプリセット名・`gh:` 接頭辞と同じでも、プリセット/投稿コースの項目は本物を開き、保存コースも別の項目で開ける。
//         🗑 はプリセットの項目では保存コースを消さず、保存コースの項目で消す。空白だけの名前は既定名で保存される。
//      (b) 📋→GitHub の公式開催: 出荷 66 本はすべて course=名前 (従来と同じ)・名前が別コースに当たる投稿コースは
//         ファイル名・一意な名前の投稿コースは名前・名前が別コースに当たる保存コース/編集した出荷コースは書き出さず理由を出す。
//      (c) 名前が 2 件に当たる参照は、公式レースの再検証でも旧形式の共有 URL でも解決せず「決められない」と出る。
//         ファイル名の参照は解決する。
//   ⑥ 枠を縮めて壁が枠の外に残ると、寸法変更・✔適用・保存・JSON 取込で本数つきの 1 行が出る (出ない形では出ない)。
//
// 差し替えるのは上流 (GitHub) の応答と、起動前の localStorage (保存コース) だけ。product は本物 (CI-8)。
// アサーションは自分が入れた値を読み返さない: 開いたコースは product の state.course、書き出しは product が
// ダウンロードさせた event.json、期待する文言は配信中の t() で組む (完全一致)。
//
// 使い方: bash run.sh check_be6_names.mjs
import fs from 'fs';
import { launch, newPage, appModule, overflowX, setLang } from './lib.mjs';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };

const ring = (W, H, m) => {
  const r = (x1, y1, x2, y2) => [{ x1, y1, x2, y2: y1 }, { x1: x2, y1, x2, y2 }, { x1: x2, y1: y2, x2: x1, y2 }, { x1, y1: y2, x2: x1, y2: y1 }];
  return [...r(0, 0, W, H), ...r(m, m, W - m, H - m)];
};
const mk = (name, W, H, m, extra = {}) => ({ name, bounds: { w: W, h: H }, start: { x: 0.35, y: m / 2, theta: 0 },
  finish: { x1: 0.35, y1: 0, x2: 0.35, y2: m }, walls: ring(W, H, m), ...extra });
// 上限は配信中の course.js から読む (写さない)。
const LIM_SRC = fs.readFileSync(new URL('../public/js/course.js', import.meta.url), 'utf8');
const LIM = Function(`return ${/const COURSE_LIMITS = (\{[^}]*\});/.exec(LIM_SRC)[1]};`)();
const junk = (base) => { const b = { ...base, junk: '' }; return { ...b, junk: 'j'.repeat(LIM.jsonMax - JSON.stringify(b).length + 1) }; };
const FILES = {
  'be6-long-name.json': [mk('N'.repeat(LIM.nameMax + 1), 3, 2, 0.5), 'name:size'],
  'be6-huge.json': [junk(mk('BE6 大きすぎる', 3, 2, 0.5)), '$:size'],
  'be6-edge.json': [mk('E'.repeat(LIM.nameMax), 3, 2, 0.5, { desc: 'D'.repeat(LIM.descMax) }), null],
  'be6-dupA.json': [mk('BE6 同名', 3, 2, 0.5), null],
  'be6-dupB.json': [mk('BE6 同名', 4, 3, 0.7), null],
  'be6-preset.json': [mk('オーバル', 5, 3, 0.8), null],
  'be6-empty.json': [mk('', 3.5, 2.5, 0.6), null],
  'be6-unique.json': [mk('BE6 一意', 4.5, 2.5, 0.6), null],
};
const SAVED = { 'オーバル': mk('オーバル', 6, 4, 1.0), 'gh:be6-dupA': mk('gh:be6-dupA', 5.5, 3.5, 0.9) };
const EVENTS = [['be6-amb', 'BE6 同名'], ['be6-file', 'be6-dupB']].map(([id, course]) =>
  [id, { id, title: 'BE6 ' + id, course, laps: 1, maxSec: 20, class: 'open', entryWindow: { open: '', close: '' } }]);

async function stub(p, savedJson, { communityFail = false, missFile = null } = {}) {
  await p.addInitScript((s) => { try { localStorage.setItem('rumicar.lang', 'ja'); if (s) localStorage.setItem('rumicar.courses', s); } catch (e) {} }, savedJson);
  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  if (communityFail) {
    // 一覧の取得失敗 (レート制限・障害): マニフェストも API も 500 を返す (lib.mjs の classify で想定内にならない＝errors に数える)。
    await p.route('**/courses/community/index.json*', (r) => r.fulfill({ status: 500, contentType: 'text/plain', body: 'be6 fail' }));
    await p.route(/api\.github\.com\/repos\/.*\/contents\/courses\/community/, (r) => r.fulfill({ status: 500, contentType: 'text/plain', body: 'be6 fail' }));
  } else await p.route('**/courses/community/index.json*', (r) => r.fulfill(json({ generated: 'check_be6', entries: Object.keys(FILES) })));
  await p.route(/\/courses\/community\/be6-[a-zA-Z-]+\.json(?:[?#]|$)/, (r) => {
    const n = decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop());
    // missFile: 目録には載っているのに本体の取得だけが失敗する投稿 (層 4 の 3 回目の再現条件)。
    if (n === missFile) return r.fulfill({ status: 500, contentType: 'text/plain', body: 'be6 fail' });
    return r.fulfill({ status: 200, contentType: 'text/plain', body: JSON.stringify(FILES[n][0]) });
  });
  await p.route(/api\.github\.com\/repos\/.*\/contents\/races\?/, (r) =>
    r.fulfill(json(EVENTS.map(([id]) => ({ name: id, type: 'dir', path: `races/${id}` })))));
  for (const [id, ev] of EVENTS) {
    await p.route(new RegExp(`raw\\.githubusercontent\\.com/.*/races/${id}/event\\.json$`), (r) => r.fulfill(json(ev)));
    await p.route(new RegExp(`raw\\.githubusercontent\\.com/.*/races/${id}/entries/index\\.json$`), (r) => r.fulfill(json({ entries: [] })));
    await p.route(new RegExp(`raw\\.githubusercontent\\.com/.*/races/${id}/result\\.json$`), (r) =>
      r.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: '404: Not Found' }));
  }
}

const browser = await launch();
try {
  const { page, errors, benign } = await newPage(browser, { before: (p) => stub(p, JSON.stringify(SAVED)) });
  await page.waitForFunction(() => [...document.querySelectorAll('#courseSel option')].some((o) => o.value.startsWith('gh:')), null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const line = (key, params) => appModule(page, 'js/i18n.js', `(m) => m.t(${JSON.stringify(key)}, ${JSON.stringify(params || {})})`);
  const logLines = async () => (await page.evaluate(() => document.getElementById('log').textContent))
    .split('\n').map((l) => l.replace(/^\[[^\]]*\]\s*/, ''));
  const countLine = async (s) => (await logLines()).filter((l) => l === s).length;
  const cur = () => appModule(page, 'js/state.js', (m) => ({ name: m.course.name, walls: m.course.walls.length, b: `${m.course.bounds.w}x${m.course.bounds.h}` }));
  const pick = async (v) => { await page.evaluate((x) => { const s = document.getElementById('courseSel'); s.value = x; s.dispatchEvent(new Event('change')); }, v); await page.waitForTimeout(350); };
  const opts = () => page.evaluate(() => [...document.querySelectorAll('#courseSel option')].map((o) => ({ v: o.value, l: o.textContent })));

  // ── 母集団 (空振りしないことを先に数で確かめる) ──────────────────────────────
  console.log('\n── 母集団 ──');
  const presets = await appModule(page, 'js/course.js', (m) => m.PRESETS.map((f) => f().name));
  ok(presets.length === 66, `出荷コース ${presets.length} 本 (66)`);
  const o0 = await opts();
  const listed = Object.keys(FILES).filter((f) => o0.some((o) => o.v === 'gh:' + f.replace(/\.json$/, '')));
  const wantListed = Object.keys(FILES).filter((f) => FILES[f][1] === null);
  ok(JSON.stringify(listed) === JSON.stringify(wantListed), `一覧に載った投稿コース ${listed.length}/${Object.keys(FILES).length} = 上限の内側の ${wantListed.length} 本 (${listed.join(',')})`);

  console.log('\n── ④ 名前/説明/全体の大きさの上限 ──');
  {
    const whys = await page.evaluate((files) => import(new URL('js/course.js', location.href).href).then((m) =>
      Object.fromEntries(Object.entries(files).map(([f, [d]]) => [f, m.checkCourseData(d)]))), FILES);
    for (const [f, [, want]] of Object.entries(FILES)) ok(whys[f] === want, `${f}: 配信中の検査の答え ${whys[f]} (期待 ${want})`);
    const bad = Object.entries(FILES).filter(([, [, w]]) => w);
    const items = bad.map(([f, [, w]]) => `${f} (${w})`).join(', ');
    const want = await line('log.ghCoursesBad', { n: bad.length, items });
    ok((await countLine(want)) === 1, `除外の告知が 1 行・件数と理由つき (${JSON.stringify(want.slice(0, 90))}…)`);
    await pick('gh:be6-edge');
    const c = await cur();
    ok(c.name.length === LIM.nameMax, `上限ちょうどの名前 (${LIM.nameMax} 字) のコースは開ける`);
    ok((await overflowX(page, 1440)) === 0, `区切りの無い説明文 ${LIM.descMax} 字を選んでもページが横にはみ出さない (${await overflowX(page, 1440)}px)`);
    const dw = await page.evaluate(() => document.getElementById('courseDesc').scrollWidth - document.getElementById('courseDesc').clientWidth);
    ok(dw <= 0, `説明欄の中身が欄の幅に収まる (はみ出し ${dw}px)`);
  }

  console.log('\n── ⑤(a) 保存名がプリセット名・gh: と同じ ──');
  {
    const o = await opts();
    const vals = o.map((x) => x.v);
    ok(new Set(vals).size === vals.length, `option value が重複しない (${vals.length} 項目)`);
    const savedOpt = o.find((x) => x.l === '★ オーバル'), savedGh = o.find((x) => x.l === '★ gh:be6-dupA');
    ok(!!savedOpt && savedOpt.v !== 'オーバル', `保存『オーバル』は別の値の項目になる (${savedOpt && savedOpt.v})`);
    ok(!!savedGh && savedGh.v !== 'gh:be6-dupA', `保存『gh:be6-dupA』は投稿コースの値を奪わない (${savedGh && savedGh.v})`);
    const pw = await appModule(page, 'js/course.js', (m) => m.presetByName('オーバル').walls.length);
    await pick('オーバル');
    ok((await cur()).walls === pw, `プリセット『オーバル』の項目でプリセットが開く (壁 ${(await cur()).walls} = ${pw})`);
    await pick(savedOpt.v);
    ok((await cur()).b === '6x4', `保存『オーバル』の項目で保存コースが開く (${(await cur()).b})`);
    await pick('gh:be6-dupA');
    ok((await cur()).b === '3x2', `投稿 gh:be6-dupA の項目で投稿コースが開く (${(await cur()).b})`);
    await pick(savedGh.v);
    ok((await cur()).b === '5.5x3.5', `保存『gh:be6-dupA』の項目で保存コースが開く (${(await cur()).b})`);
  }

  console.log('\n── ⑤(b) 📋→GitHub の公式開催が書く course ──');
  await page.evaluate(() => { window.open = () => null; });
  await page.click('#eventOpen'); await page.waitForTimeout(400);
  const host = async () => {
    const dl = page.waitForEvent('download', { timeout: 4000 }).catch(() => null);
    await page.evaluate(() => { document.getElementById('evMsg').textContent = ''; document.getElementById('evShare').click(); });
    const d = await dl;
    const msg = await page.evaluate(() => document.getElementById('evMsg').textContent);
    if (!d) return { course: undefined, msg };
    return { course: JSON.parse(fs.readFileSync(await d.path(), 'utf8')).course, msg };
  };
  {
    let same = 0; const diff = [];
    for (const n of presets) {
      await pick(n);
      const r = await host();
      if (r.course === n) same++; else diff.push(`${n}→${JSON.stringify(r.course)}`);
    }
    ok(same === presets.length, `出荷 ${presets.length} 本すべて course=名前 (従来と同じ) ${same}/${presets.length} ${diff.slice(0, 3).join(' ')}`);
    for (const [key, want] of [['gh:be6-preset', 'be6-preset'], ['gh:be6-dupB', 'be6-dupB'], ['gh:be6-dupA', 'be6-dupA'], ['gh:be6-empty', 'be6-empty'], ['gh:be6-unique', 'BE6 一意']]) {
      await pick(key);
      const r = await host();
      ok(r.course === want, `投稿 ${key} (name=${JSON.stringify(FILES[key.slice(3) + '.json'][0].name)}) → course=${JSON.stringify(r.course)} (期待 ${JSON.stringify(want)})`);
    }
    const savedV = (await opts()).find((x) => x.l === '★ オーバル').v;
    await pick(savedV);
    let r = await host();
    ok(r.course === undefined && r.msg === await line('event.share.courseClash', { name: 'オーバル' }),
      `保存『オーバル』(プリセットと同名) は書き出さず理由を出す (${JSON.stringify(r.msg.slice(0, 40))})`);
    // 出荷コースをエディタで開いて名前を変えずに ✔適用 (中心線などが外れて形が変わる＝BE2 の実測で 61/66 本)。
    await pick('オーバル');
    await page.keyboard.press('Escape');
    await page.click('#editToggle'); await page.waitForTimeout(300);
    await page.click('#edApply'); await page.waitForTimeout(500);
    await page.click('#eventOpen'); await page.waitForTimeout(400);
    r = await host();
    ok(r.course === undefined && r.msg === await line('event.share.courseClash', { name: 'オーバル' }),
      `出荷『オーバル』を ✔適用した編集結果は書き出さず理由を出す (${JSON.stringify(r.msg.slice(0, 40))})`);
    await page.keyboard.press('Escape');
    // 層 4 (2026-09-25) の再現条件: 同名の投稿コースを ✔適用すると一覧のどれでもなくなり (currentCourseKey='')、
    // 改修の 1 回目は名前 "BE6 同名" を黙って書き出した (他の人の再検証は必ず解決しない参照)。2 回目は同じ形なのに止めた。
    //   無変更の ✔適用 → 同じ形の投稿のファイル名 / 枠を変えて ✔適用 (どの投稿とも違う形) → 書き出さず理由を出す。
    await pick('gh:be6-dupA');
    await page.click('#editToggle'); await page.waitForTimeout(300);
    await page.click('#edApply'); await page.waitForTimeout(500);
    await page.click('#eventOpen'); await page.waitForTimeout(400);
    r = await host();
    ok(r.course === 'be6-dupA', `同名の投稿コースを無変更で ✔適用した結果はファイル名 (course=${JSON.stringify(r.course)})`);
    await page.keyboard.press('Escape');
    await page.click('#editToggle'); await page.waitForTimeout(300);
    await page.evaluate(() => { document.getElementById('edW').value = '3.5'; document.getElementById('edH').value = '2.5'; document.getElementById('edSize').click(); });
    await page.waitForTimeout(300);
    await page.click('#edApply'); await page.waitForTimeout(500);
    await page.click('#eventOpen'); await page.waitForTimeout(400);
    r = await host();
    ok(r.course === undefined && r.msg === await line('event.share.courseClash', { name: 'BE6 同名' }),
      `同名の投稿コースの枠を変えて ✔適用した結果は書き出さず理由を出す (course=${JSON.stringify(r.course)})`);
    await page.keyboard.press('Escape');
  }

  console.log('\n── ⑤(c) 名前が 2 件に当たる参照 (公式レースの再検証) ──');
  {
    await page.click('#officialOpen'); await page.waitForTimeout(2500);
    const note = () => page.evaluate(() => (document.getElementById('ofVerifyNote')?.textContent ?? ''));
    await page.selectOption('#ofRace', 'be6-amb'); await page.waitForTimeout(1200);
    await page.click('#ofVerify'); await page.waitForTimeout(2500);
    ok((await note()).includes(await line('official.verify.noCourse', { name: 'BE6 同名' })), '名前 "BE6 同名" (2 件) の大会は解決しない');
    ok((await countLine(await line('log.courseAmbiguous', { name: 'BE6 同名', n: 2 }))) >= 1, '「決められない」理由が 1 行届く');
    ok(await page.evaluate(() => !document.getElementById('dlgRace').open), '名前が 2 件に当たる大会で結果ダイアログを開かない (どちらかで走らせていない)');
    await page.evaluate(() => { const d = document.getElementById('dlgRace'); if (d.open) d.close(); });
    await page.selectOption('#ofRace', 'be6-file'); await page.waitForTimeout(1200);
    await page.click('#ofVerify'); await page.waitForTimeout(20000);
    ok(!(await note()).includes(await line('official.verify.noCourse', { name: 'be6-dupB' })), 'ファイル名 "be6-dupB" の大会は解決不可と出ない');
    const refHead = (await line('official.verify.refOnly', { hash: '\u0000' })).split('\u0000')[0];
    ok(refHead.length > 3 && (await note()).includes(refHead), `ファイル名の大会は検証まで進んで verifyHash が出る (${JSON.stringify((await note()).slice(0, 60))})`);
    ok(await page.evaluate(() => !!document.getElementById('dlgRace').open), 'ファイル名の大会は結果ダイアログが開く (走った)');
    await page.click('[data-close="dlgRace"]').catch(() => {});
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }

  console.log('\n── ⑥ 枠の外に残った壁の告知 ──');
  {
    await pick('オーバル');
    const n = await appModule(page, 'js/course.js', (m) => { const c = m.normalizeCourse(JSON.parse(JSON.stringify(m.presetByName('オーバル')))); return m.wallsOutsideFrame({ ...c, bounds: { w: 1, h: 1 } }); });
    const want = await line('log.edWallsOutside', { n });
    ok(n > 0, `出荷『オーバル』を 1×1 m へ縮めると枠の外に壁が ${n} 本 (配信中の数え方)`);
    const before = await countLine(want);
    await page.click('#editToggle'); await page.waitForTimeout(300);
    await page.evaluate(() => { document.getElementById('edW').value = '1'; document.getElementById('edH').value = '1'; document.getElementById('edSize').click(); });
    await page.waitForTimeout(300);
    ok((await countLine(want)) === before + 1, '寸法を縮めた瞬間に本数つきの 1 行');
    await page.evaluate(() => { document.getElementById('edName').value = '   '; document.getElementById('edSave').click(); });
    await page.waitForTimeout(300);
    ok((await countLine(want)) === before + 2, '保存でも 1 行');
    const defName = await line('ed.name.default');
    const keys = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('rumicar.courses') || '{}')));
    ok(keys.includes(defName) && !keys.includes(''), `空白だけの名前は既定名『${defName}』で保存される (保存名 ${JSON.stringify(keys)})`);
    await page.click('#edApply'); await page.waitForTimeout(500);
    ok((await countLine(want)) === before + 3, '✔適用でも 1 行');
    // JSON 取込: 同じ形をファイルで入れる
    await page.click('#editToggle'); await page.waitForTimeout(300);
    const body = await appModule(page, 'js/course.js', (m) => { const c = m.normalizeCourse(JSON.parse(JSON.stringify(m.presetByName('オーバル')))); return JSON.stringify({ name: 'BE6 取込', bounds: { w: 1, h: 1 }, start: c.start, finish: c.finish, walls: c.walls }); });
    await page.setInputFiles('#edImport', { name: 'be6-import.json', mimeType: 'application/json', buffer: Buffer.from(body) });
    await page.waitForTimeout(500);
    ok((await countLine(want)) === before + 4, 'JSON 取込でも 1 行');
    // 出ない形: 枠の中に全部ある出荷コースを ✔適用しても出ない
    await page.click('#editToggle').catch(() => {}); await page.waitForTimeout(200);
    const l0 = (await logLines()).length;
    await pick(presets.find((x) => x !== 'オーバル'));
    await page.click('#editToggle'); await page.waitForTimeout(300);
    await page.click('#edApply'); await page.waitForTimeout(400);
    const after = (await logLines()).slice(l0);
    const head = (await line('log.edWallsOutside', { n: 999 })).split('999')[0];
    ok(!after.some((l) => l.startsWith(head)), '枠の中に全部ある形では出ない');
  }

  console.log('\n── ⑤(a) 保存コースを ✔適用した後の走行中コースの値 ──');
  {
    const v = (await opts()).find((x) => x.l === '★ オーバル').v;
    await pick(v);
    await page.click('#editToggle'); await page.waitForTimeout(300);
    await page.click('#edApply'); await page.waitForTimeout(500);
    // ✔適用は共有 hash を更新しないので、ここで hash を読むと直前に選んだ値の読み返しになる (1 回目に作った見せかけの緑)。
    // 走行中コースの値 (currentCourseKey) を使う経路＝言語切替 (一覧の作り直しと hash の更新) を通してから測る。
    await setLang(page, 'en'); await setLang(page, 'ja');
    const sv = await page.evaluate(() => document.getElementById('courseSel').value);
    const hc = await appModule(page, 'js/share.js', (m) => m.decodeState(location.hash.slice(1)).course);
    ok(sv === v, `保存『オーバル』を ✔適用して言語を切り替えても一覧は保存コースを指す (${sv} = ${v})`);
    ok(hc === v, `その共有 URL も保存コースの値を指す (${hc} = ${v}・プリセット『オーバル』ではない)`);
    ok((await cur()).b === '6x4', `走っているのは保存コースのまま (${(await cur()).b})`);
  }

  console.log('\n── ⑤(a) 逃がし対象の名前を初めて保存 → その項目が選ばれ、🗑 はそれだけを消す ──');
  {
    // 層 4 の 2 回目 (2026-09-25) の実測: 1 回目の実装は一覧を作り直す前に値を引いたので、初めて保存した『★オーバル』で
    // 保存コース『オーバル』の項目 (値 ★オーバル) が選ばれ、続けて 🗑 を押すと『オーバル』が消えた。
    const other = presets.find((x) => x !== 'オーバル');
    for (const nm of ['★オーバル', other]) {
      await page.click('#editToggle'); await page.waitForTimeout(300);
      await page.evaluate((n) => { document.getElementById('edName').value = n; document.getElementById('edSave').click(); }, nm);
      await page.waitForTimeout(300);
      const sel = await page.evaluate(() => { const s = document.getElementById('courseSel'); return s.options[s.selectedIndex].textContent; });
      ok(sel === '★ ' + nm, `初めて保存した『${nm}』の項目が選ばれる (選択: ${sel})`);
      await page.click('#edDelete'); await page.waitForTimeout(300);
      const saved = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('rumicar.courses') || '{}')));
      ok(!saved.includes(nm) && saved.includes('オーバル'), `続けて 🗑 → 『${nm}』だけが消え、保存『オーバル』は残る (${JSON.stringify(saved)})`);
      await page.click('#editToggle'); await page.waitForTimeout(300);
    }
  }

  console.log('\n── ⑤(a) 🗑 と保存コース ──');
  {
    // 🗑 はエディタのパネルにある (利用者と同じく、エディタを開いてから押す)。
    const del = async () => { await page.click('#editToggle'); await page.waitForTimeout(300); await page.click('#edDelete'); await page.waitForTimeout(300); await page.click('#editToggle'); await page.waitForTimeout(300); };
    await pick('オーバル');
    await del();
    let saved = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('rumicar.courses') || '{}')));
    ok(saved.includes('オーバル'), 'プリセット『オーバル』の項目で 🗑 を押しても同名の保存コースは消えない');
    ok((await countLine(await line('log.presetNoDelete'))) >= 1, 'プリセットは消せないと出る');
    const v = (await opts()).find((x) => x.l === '★ オーバル').v;
    await pick(v);
    await del();
    saved = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('rumicar.courses') || '{}')));
    ok(!saved.includes('オーバル') && saved.includes('gh:be6-dupA'), `保存『オーバル』の項目で 🗑 を押すとその保存コースだけ消える (${JSON.stringify(saved)})`);
  }
  ok(errors.length === 0, `全体の JS/HTTP エラー 0 (${errors.length}: ${JSON.stringify(errors.slice(0, 3))}) / 想定内 ${benign.length}`);

  console.log('\n── ⑤(b) 投稿コースの一覧を読めていないときの公式開催 ──');
  {
    // 層 4 の 2 回目の実測: 一覧の取得を失敗させると、同名の投稿コースがある保存コースの名前を書き出した
    // (他の人の一覧ではその名前が投稿コースに当たる)。一覧を読めていなければ、保存コース等の名前は書かない。
    const pg = await newPage(browser, { before: (p) => stub(p, JSON.stringify({ 'BE6 一意': mk('BE6 一意', 6, 4, 1.0) }), { communityFail: true }) });
    const P = pg.page;
    await P.waitForTimeout(1500);
    const failLine = await appModule(P, 'js/i18n.js', (m) => m.t('log.ghCoursesFail'));
    const lines = (await P.evaluate(() => document.getElementById('log').textContent)).split('\n').map((l) => l.replace(/^\[[^\]]*\]\s*/, ''));
    ok(lines.includes(failLine), '母集団: 投稿コースの一覧の取得に失敗している (告知が出ている)');
    await P.evaluate(() => { window.open = () => null; });
    const pk = async (v) => { await P.evaluate((x) => { const s = document.getElementById('courseSel'); s.value = x; s.dispatchEvent(new Event('change')); }, v); await P.waitForTimeout(350); };
    const hs = async () => {
      const dl = P.waitForEvent('download', { timeout: 4000 }).catch(() => null);
      await P.evaluate(() => { document.getElementById('evMsg').textContent = ''; document.getElementById('evShare').click(); });
      const d = await dl; const msg = await P.evaluate(() => document.getElementById('evMsg').textContent);
      return { course: d ? JSON.parse(fs.readFileSync(await d.path(), 'utf8')).course : undefined, msg };
    };
    await P.click('#eventOpen'); await P.waitForTimeout(400);
    await pk('BE6 一意');
    let r = await hs();
    const want = await appModule(P, 'js/i18n.js', (m) => m.t('event.share.courseUnknown', { name: 'BE6 一意' }));
    ok(r.course === undefined && r.msg === want, `一覧を読めていないと保存コースの名前は書き出さず理由を出す (course=${JSON.stringify(r.course)})`);
    await pk('オーバル');
    r = await hs();
    ok(r.course === 'オーバル', `出荷コースは一覧を読めていなくても従来どおり名前を書く (course=${JSON.stringify(r.course)})`);
    const unexpected = pg.errors.filter((e) => !/be6 fail|http 500 .*courses\/community/.test(e));
    ok(unexpected.length === 0, `自分で起こした 500 以外の JS/HTTP エラー 0 (${JSON.stringify(unexpected.slice(0, 2))})`);
    await P.close();
  }
  {
    // 一部だけ読めた: 目録は取れたが、保存コースと同じ名前の投稿 (be6-unique.json・name『BE6 一意』) の本体だけが 500。
    // 取得できた人の環境ではその名前は投稿コースに当たるので、名前を書いてはならない (層 4 の 3 回目の実測で書いていた)。
    const pg = await newPage(browser, { before: (p) => stub(p, JSON.stringify({ 'BE6 一意': mk('BE6 一意', 6, 4, 1.0) }), { missFile: 'be6-unique.json' }) });
    const P = pg.page;
    await P.waitForFunction(() => [...document.querySelectorAll('#courseSel option')].some((o) => o.value.startsWith('gh:')), null, { timeout: 30000 });
    await P.waitForTimeout(500);
    const vals = await P.evaluate(() => [...document.querySelectorAll('#courseSel option')].map((o) => o.value));
    ok(!vals.includes('gh:be6-unique') && vals.includes('gh:be6-dupA'), '母集団: 目録は読めて、be6-unique だけが一覧に無い');
    await P.evaluate(() => { window.open = () => null; });
    await P.click('#eventOpen'); await P.waitForTimeout(400);
    await P.evaluate(() => { const s = document.getElementById('courseSel'); s.value = 'BE6 一意'; s.dispatchEvent(new Event('change')); });
    await P.waitForTimeout(350);
    const dl = P.waitForEvent('download', { timeout: 4000 }).catch(() => null);
    await P.evaluate(() => { document.getElementById('evMsg').textContent = ''; document.getElementById('evShare').click(); });
    const d = await dl; const msg = await P.evaluate(() => document.getElementById('evMsg').textContent);
    const course = d ? JSON.parse(fs.readFileSync(await d.path(), 'utf8')).course : undefined;
    const want = await appModule(P, 'js/i18n.js', (m) => m.t('event.share.courseUnknown', { name: 'BE6 一意' }));
    ok(course === undefined && msg === want, `本体の取得に欠けがあると保存コースの名前は書き出さず理由を出す (course=${JSON.stringify(course)})`);
    const unexpected = pg.errors.filter((e) => !/be6-unique\.json/.test(e));
    ok(unexpected.length === 0, `自分で起こした 500 以外の JS/HTTP エラー 0 (${JSON.stringify(unexpected.slice(0, 2))})`);
    await P.close();
  }

  console.log('\n── ⑤(a) 保存コースの値は保存した順番に依らない ──');
  {
    const A = mk('オーバル', 6, 4, 1.0), B = mk('★オーバル', 5, 3, 0.8);
    const maps = [];
    for (const order of [[['オーバル', A], ['★オーバル', B]], [['★オーバル', B], ['オーバル', A]]]) {
      const pg = await newPage(browser, { before: (p) => stub(p, JSON.stringify(Object.fromEntries(order))) });
      await pg.page.waitForTimeout(300);
      maps.push(await pg.page.evaluate(() => JSON.stringify([...document.querySelectorAll('#courseSel option')].filter((o) => o.textContent.startsWith('★ ')).map((o) => [o.textContent, o.value]).sort())));
      await pg.page.close();
    }
    ok(maps[0] === maps[1], `保存の順番を入れ替えても 項目→値 が同じ (${maps[0]})`);
    ok(JSON.parse(maps[0]).length === 2 && new Set(JSON.parse(maps[0]).map(([, v]) => v)).size === 2, '2 つの保存コースが別の値を持つ');
  }

  console.log('\n── ⑤(c) 旧形式の共有 URL (投稿コースを名前で書いたもの) ──');
  for (const [ref, wantB, amb] of [['BE6 同名', null, true], ['be6-dupB', '4x3', false]]) {
    const hash = await appModule(page, 'js/share.js', `(m) => m.encodeState({ course: ${JSON.stringify(ref)} })`);
    const pg = await newPage(browser, { path: '#' + hash, before: (p) => stub(p, null) });
    await pg.page.waitForFunction(() => [...document.querySelectorAll('#courseSel option')].some((o) => o.value.startsWith('gh:')), null, { timeout: 30000 });
    await pg.page.waitForTimeout(800);
    const c = await appModule(pg.page, 'js/state.js', (m) => `${m.course.bounds.w}x${m.course.bounds.h}`);
    const lines = (await pg.page.evaluate(() => document.getElementById('log').textContent)).split('\n').map((l) => l.replace(/^\[[^\]]*\]\s*/, ''));
    if (amb) {
      const want = await appModule(pg.page, 'js/i18n.js', `(m) => m.t('log.courseAmbiguous', { name: ${JSON.stringify(ref)}, n: 2 })`);
      ok(lines.includes(want), `共有 URL の "${ref}" は「決められない」と出る`);
      ok(c !== '3x2' && c !== '4x3', `共有 URL の "${ref}" で同名のどちらも開かない (${c})`);
    } else {
      ok(c === wantB, `共有 URL の "${ref}" (ファイル名) はそのコースを開く (${c})`);
    }
    ok(pg.errors.length === 0, `共有 URL "${ref}" で JS/HTTP エラー 0 (${JSON.stringify(pg.errors.slice(0, 2))})`);
    await pg.page.close();
  }
} finally {
  await browser.close();
}
console.log(`\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗:\n  - ' + fails.join('\n  - ')); process.exit(1); }
console.log('結果: PASS');
