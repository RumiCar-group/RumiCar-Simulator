// check_bc3_intake.mjs — 壊れたコースをどの経路から入れても、理由が出てアプリが止まらない (BC3)。
// ════════════════════════════════════════════════════════════════════════════
// BB2 の検査は「投稿コースの一覧を作るとき」にしか効いていなかった。BC3 で `course.js:acceptCourseData`
// を単一の入口にし、自分のファイルを取り込む経路も全部そこへ通した。**ただし基準は取り込み元で 2 つに分ける**
// (第三者のデータ / 利用者自身のデータ。理由と実測は course.js の注記を正とする)。
// ここではそれを**利用者と同じ UI 操作**で確かめる。卓上ゲート wf_bc3_intake.mjs はソースの配線と
// 2 基準の関係を固定する。こちらは「実際に押したらどうなるか」を見る。
//
// 差し替えるのは **上流 (GitHub) の応答だけ**。product は本物がそのまま走る (CI-8)。
// 不正入力コーパスは wf_course_corpus.mjs (卓上ゲート・BB2 の実ブラウザゲートと共有＝写しを作らない)。
//
// 本ゲートが押す経路 (PLAN で着手前に固定した 8 経路):
//   ① エディタの JSON 取込 (#edImport)      … 壊れたファイル **全形** → 理由つき 1 行・編集中のコースは不変
//                                            ＋ **#edExport で書き出したファイルを読み戻せる**（往復・2026-09-18 の裁定改訂）
//   ② 保存コースの選択 (#courseSel)         … 壊れた保存コースは理由つきで拒否 / **枠を縮めた自作コースは開ける**
//   ③ データ復元 (#dataImport)              … 壊れた保存コースも byte 同値で戻る (復元では弾かない契約)
//   ④ 公式レースのコース解決 (#ofVerify)    … 同梱 courseDef が正常なら解決して検証まで進む / 壊れていれば理由が届く
//   ⑤ (④ を race_ui の verifyOfficialLocally から押している＝⑤ そのもの)
//   ⑥ 投稿車種の除外 (cars/community)       … 黙って捨てず、件数と理由を 1 行知らせる
//   ⑦ エディタからの投稿 (#edShare)         … 検査に落ちる形は、投稿する前に理由が出る (書き出しは続く)
//   ⑧ エディタの ✔適用 (#edApply)           … ② と同じ基準＝枠を縮めた状態でも適用できる (割れない)
//
// 【1 回目の BC3 で作ってしまった「見せかけの緑」を避けるための決め事】
//   ・コーパスは **slice(n) で先頭から取らない**。'drop' の全形を押し、**「大きさ」の 3 形
//     (bad-far-wall / bad-mm / bad-huge) が母集団に居ることを数で確かめてから**回す
//     (1 回目は先頭 6 形だけを押していて、BB2/BC3 の動機そのものを実ブラウザで測っていなかった)。
//   ・アサーションは **自分が設定した値を読み返さない**。拒否の確認は「product が決めた state.course」と
//     「product が戻した #courseSel の値」で測る (自分が selectOption した値を見ても必ず一致する)。
//   ・期待するログ行は**配信中の i18n の t() で組んで完全一致で比べる** (文言を写さない・BB2 と同じ型)。
//     理由 (why) も**配信中の course.js に答えさせる** (基準を写さない)。
//
// 使い方: bash run.sh check_bc3_intake.mjs
import { launch, newPage, setLang, appModule } from './lib.mjs';
import { SHAPES, SYNTAX_ONLY, expectOf } from '../wf_course_corpus.mjs';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };
const SLOT = String.fromCharCode(0);   // 差し込み値の目印 (文言に現れない文字。ソースに生の NUL を置かない)

// ── 母集団 (順序に依らない選び方) ───────────────────────────────────────────────
// JSON として読める 'drop' の形すべて。JSON 文法エラーは JSON.parse の話＝別の行になるので外す。
// std 側は ⑦ (投稿前の警告) の母集団。① と ② は own 側を押す。
const DROP_STD = SHAPES.filter((s) => expectOf(s, 'std') === 'drop' && !SYNTAX_ONLY.includes(s[0]));
// own では通る形 (＝枠を縮めた自作コース類)。これが ② で開けることが BC3 の回帰オラクル。
const OWN_KEEP = SHAPES.filter((s) => expectOf(s, 'std') === 'drop' && expectOf(s, 'own') === 'keep');
// own でも落ちる形 (② で拒否されるべきもの)。
const OWN_DROP = SHAPES.filter((s) => expectOf(s, 'own') === 'drop' && !SYNTAX_ONLY.includes(s[0]));
const KEEP = SHAPES.find((s) => expectOf(s, 'std') === 'keep');
// 「大きさ」の形 — BB2/BC3 の動機そのもの。母集団に居ないなら、このゲートは動機を測っていない。
const SIZE_SHAPES = ['bad-far-wall.json', 'bad-mm.json', 'bad-huge.json'];

// 壊れた投稿車種 (⑥)。理由の印は main.js の badCars と同じ語。
const BAD_CARS = [
  ['bad-nokey.json', { name: 'BAD key が無い' }, 'key/name'],
  ['bad-noname.json', { key: 'bc3_noname' }, 'key/name'],
  ['bad-builtin.json', { key: 'normal_fr', name: 'BAD 組込 key' }, 'builtin'],
];

// ④ 用の大会 2 本。course は**同梱 courseDef** (= resolveRaceCourse の object 分岐を通る唯一の形)。
// 正常な方は「廊下 1 周・finish つき」の最小コース。壊れた方はコーパスの遠い壁 (own でも落ちる形)。
function ringWalls(W, H, m) {
  const rect = (x1, y1, x2, y2) => [{ x1, y1, x2, y2: y1 }, { x1: x2, y1, x2, y2 }, { x1: x2, y1: y2, x2: x1, y2 }, { x1, y1: y2, x2: x1, y2: y1 }];
  return [...rect(0, 0, W, H), ...rect(m, m, W - m, H - m)];
}
const GOOD_DEF = {
  name: 'BC3 検証用 (同梱 courseDef)', bounds: { w: 3, h: 2 },
  start: { x: 0.35, y: 0.25, theta: 0 }, finish: { x1: 0.35, y1: 0, x2: 0.35, y2: 0.5 },
  walls: ringWalls(3, 2, 0.5),
};
const BAD_DEF = JSON.parse(SHAPES.find((s) => s[0] === 'bad-far-wall.json')[1]);
const EVENTS = [
  ['bc3-good', { id: 'bc3-good', title: 'BC3 正常な同梱 courseDef', course: GOOD_DEF, laps: 1, maxSec: 20, class: 'open', entryWindow: { open: '', close: '' } }],
  ['bc3-bad', { id: 'bc3-bad', title: 'BC3 壊れた同梱 courseDef', course: BAD_DEF, laps: 1, maxSec: 20, class: 'open', entryWindow: { open: '', close: '' } }],
];

/** 上流 (GitHub) の cars/community と races の応答だけを差し替える。product には触れない。 */
async function stubUpstream(page) {
  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  // ⑥ 投稿車種
  await page.route(/raw\.githubusercontent\.com\/.*\/cars\/community\/index\.json$/, (r) =>
    r.fulfill(json({ entries: BAD_CARS.map(([n]) => n) })));
  await page.route(/api\.github\.com\/repos\/.*\/contents\/cars\/community\?/, (r) =>
    r.fulfill(json(BAD_CARS.map(([n]) => ({ name: n, type: 'file', path: `cars/community/${n}`,
      download_url: `https://raw.githubusercontent.com/RumiCar-group/RumiCar/master/cars/community/${n}` })))));
  for (const [n, def] of BAD_CARS) {
    await page.route(new RegExp(`raw\\.githubusercontent\\.com/.*/cars/community/${n.replace('.', '\\.')}$`), (r) =>
      r.fulfill(json(def)));
  }
  // ④ 公式レース: races/ の一覧はディレクトリ一覧なので GitHub API 経路だけ (loader.js listDirCached)。
  await page.route(/api\.github\.com\/repos\/.*\/contents\/races\?/, (r) =>
    r.fulfill(json(EVENTS.map(([id]) => ({ name: id, type: 'dir', path: `races/${id}` })))));
  for (const [id, ev] of EVENTS) {
    await page.route(new RegExp(`raw\\.githubusercontent\\.com/.*/races/${id}/event\\.json$`), (r) => r.fulfill(json(ev)));
    await page.route(new RegExp(`raw\\.githubusercontent\\.com/.*/races/${id}/entries/index\\.json$`), (r) => r.fulfill(json({ entries: [] })));
    // 締切前の大会は result.json が無い = 上流は本物の 404 を返す (lib.mjs の classify が想定内に分類する形)。
    // 空ボディで fulfill すると ERR_ABORTED になり「requestfailed」として数えられてしまうので、本物と同じ形で返す。
    await page.route(new RegExp(`raw\\.githubusercontent\\.com/.*/races/${id}/result\\.json$`), (r) =>
      r.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: '404: Not Found' }));
  }
}

const browser = await launch();
try {
  const { page, errors, benign } = await newPage(browser, {
    before: async (p) => {
      await p.addInitScript(() => { try { localStorage.setItem('rumicar.lang', 'ja'); } catch (e) {} });
      await stubUpstream(p);
    },
  });
  await setLang(page, 'ja');

  const logLines = async () => (await page.evaluate(() => document.getElementById('log').textContent))
    .split('\n').map((l) => l.replace(/^\[[^\]]*\]\s*/, ''));
  // product が決めた「今走っているコース」の指紋。自分が入れた値ではないので読み返しにならない。
  const courseFp = () => appModule(page, 'js/state.js', (m) => (m.course
    ? `${m.course.name}|w=${m.course.walls.length}|b=${m.course.bounds.w}x${m.course.bounds.h}` : '(none)'));
  // 同じ指紋を、配信中の normalizeCourse に data から作らせたもの (「この保存コースが開けた」の照合先)。
  const expectFp = (data) => page.evaluate((d) => import(new URL('js/course.js', location.href).href).then((m) => {
    const c = m.normalizeCourse(JSON.parse(JSON.stringify(d)));
    return `${c.name}|w=${c.walls.length}|b=${c.bounds.w}x${c.bounds.h}`;
  }), data);
  const selValue = () => page.evaluate(() => document.getElementById('courseSel').value);
  // 共有 URL が現に指しているコース名を、配信中の share.js に解かせる (自前で hash を読まない)。
  const hashCourse = () => page.evaluate(() => import(new URL('js/share.js', location.href).href)
    .then((m) => { const st = m.decodeState(location.hash); return st ? (st.course ?? null) : null; }));
  // 配信中の course.js に答えさせて理由を得る (基準を写さない)。own=true で保存コースの基準。
  const whyOf = (body, own) => page.evaluate(
    (a) => import(new URL('js/course.js', location.href).href)
      .then((m) => (a.own ? m.checkOwnCourseData : m.checkCourseData)(JSON.parse(a.b))), { b: body, own: !!own });
  // 配信中の i18n で期待する 1 行を組む。
  const line = (key, params) => page.evaluate(
    (a) => import(new URL('js/i18n.js', location.href).href).then((m) => m.t(a.key, a.params)), { key, params });
  // 差し込み値を SLOT にして、値に依らない前後の固定部分を得る。
  const parts = async (key, slot) => (await line(key, slot)).split(SLOT);

  // ── 母集団の検分 (先に数で確かめる。ここが空振りだと以降が全部「見せかけの緑」になる) ──
  console.log('\n── 母集団 ──');
  ok(DROP_STD.length >= 15, `'drop'(投稿基準) の形が ${DROP_STD.length} 件 (15 件以上・slice で切っていない)`);
  ok(SIZE_SHAPES.every((f) => OWN_DROP.some(([n]) => n === f)),
    `「大きさ」の形 ${SIZE_SHAPES.join(' / ')} が ①② で押す母集団に居る (BB2/BC3 の動機そのもの)`);
  ok(OWN_KEEP.length >= 2, `①② で「開けなければならない」形 (枠を縮めた自作コース類) が ${OWN_KEEP.length} 件`);
  ok(OWN_DROP.length >= 15, `①② で拒否すべき形が ${OWN_DROP.length} 件 (15 件以上)`);
  ok(DROP_STD.length > OWN_DROP.length,
    `投稿基準のほうが厳しい: drop(std) ${DROP_STD.length} 件 > drop(own) ${OWN_DROP.length} 件 = 2 基準が実は同じ、ではない`);

  // ── ⑥ 投稿車種の除外を黙って捨てない ────────────────────────────────────
  console.log('\n── ⑥ 投稿車種の除外 (cars/community) ──');
  {
    const [head] = await parts('log.ghCarsBad', { n: SLOT, items: '' });
    const lines = await logLines();
    const hit = lines.find((l) => l.startsWith(head));
    ok(head.length > 3 && !!hit, `⑥ 除外を件数つきで告知する (告知の書き出し ${JSON.stringify(head)})`);
    for (const [n, , why] of BAD_CARS) {
      const label = n.replace(/\.json$/i, '');   // loader.js の listCommunityCars が拡張子を落とす
      ok(!!hit && hit.includes(`${label} (${why})`), `⑥ ${label} が理由 (${why}) つきで出る`);
    }
    const carOpts = await page.evaluate(() =>
      [...document.querySelectorAll('.carcol select')].flatMap((s) => [...s.options].map((o) => o.value)));
    ok(!carOpts.includes('bc3_noname'), '⑥ 壊れた投稿車種は車種メニューに入らない');
  }

  // ── ① エディタの JSON 取込 ────────────────────────────────────────────────
  console.log('\n── ① エディタの JSON 取込 (#edImport) ──');
  await page.click('#editToggle');
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => !document.getElementById('editorPanel').classList.contains('hidden')), '① エディタが開く');
  {
    // 編集中のコースが差し替わっていないことは **エディタ側の表示**で測る。state.course は ① では元々
    // 動かないので、そこを見ると「必ず通るアサーション」になる (1 回目の BC3 はこれを取り違えていた)。
    // #edDims と #edName はどちらも product が editor.course から書く値。
    const edState = () => page.evaluate(() =>
      document.getElementById('edDims').textContent + '|' + document.getElementById('edName').value);
    // ① は own 基準（2026-09-18 の裁定改訂）。拒否されるのは own でも落ちる形だけ。
    for (const [file, body] of OWN_DROP) {
      const e0 = errors.length;
      const before = await edState();
      await page.setInputFiles('#edImport', { name: file, mimeType: 'application/json', buffer: Buffer.from(body) });
      await page.waitForTimeout(350);
      const why = await whyOf(body, true);
      const want = await line('log.courseBad', { name: file, why });
      ok((await logLines()).includes(want), `① ${file}: 理由つきで拒否 (why=${JSON.stringify(why)})`);
      ok(await edState() === before, `① ${file}: 編集中のコースが差し替わっていない (${JSON.stringify(before)})`);
      ok(errors.length === e0, `① ${file}: 新しい JS/HTTP エラー 0 (${errors.length - e0})`);
    }
    // own で通る形（枠を縮めた自作コース類）は**読み込めなければならない**。投稿基準だと全部落ちる形なので、
    // ここが緑であることが「① を own にした」ことの直接の証拠になる。
    const [headK] = await parts('log.courseJsonLoaded', { name: SLOT });
    for (const [file, body] of OWN_KEEP) {
      const e0 = errors.length;
      const before = await edState();
      const nK = (await logLines()).filter((l) => l.startsWith(headK)).length;
      await page.setInputFiles('#edImport', { name: file, mimeType: 'application/json', buffer: Buffer.from(body) });
      await page.waitForTimeout(500);
      const n1 = (await logLines()).filter((l) => l.startsWith(headK)).length;
      ok(n1 === nK + 1, `① ${file}: 枠の外に壁がある自作コースでも取り込める（投稿基準なら落ちる形・読込の行 ${nK} → ${n1}）`);
      ok(await edState() !== before, `① ${file}: 編集中のコースが実際に入れ替わる (${JSON.stringify(before)} → ${JSON.stringify(await edState())})`);
      ok(errors.length === e0, `① ${file}: 新しい JS/HTTP エラー 0 (${errors.length - e0})`);
    }
    // 正常なファイルは従来どおり読み込めること (検査を足して「何も入らない」にしていない)
    {
      const [kf, kb] = KEEP;
      const e0 = errors.length;
      const before = await edState();
      const [headBefore] = await parts('log.courseJsonLoaded', { name: SLOT });
      const nLoadBefore = (await logLines()).filter((l) => l.startsWith(headBefore)).length;
      await page.setInputFiles('#edImport', { name: kf, mimeType: 'application/json', buffer: Buffer.from(kb) });
      await page.waitForTimeout(700);
      const [head] = await parts('log.courseJsonLoaded', { name: SLOT });
      const n1 = (await logLines()).filter((l) => l.startsWith(head)).length;
      ok(n1 === nLoadBefore + 1, `① 正常なファイル ${kf} は従来どおり読み込める (読込の行 ${nLoadBefore} → ${n1})`);
      ok(await edState() !== before, `① 正常なファイルでは編集中のコースが実際に入れ替わる (${JSON.stringify(before)} → ${JSON.stringify(await edState())})`);
      ok(errors.length === e0, `① 正常なファイルで新しい JS/HTTP エラー 0 (${errors.length - e0})`);
    }
  }

  // ── ⑦ エディタからの投稿 / ⑧ ✔適用 ────────────────────────────────────────
  // 枠 (#edW/#edH) を縮めると壁が枠の外へ出る。= エディタだけで到達できる「投稿しても誰の一覧にも
  // 載らない」形であり、同時に「**自分では開けなければならない**」形でもある。
  console.log('\n── ⑦ エディタからの投稿 (#edShare) / ⑧ ✔適用 (#edApply) ──');
  {
    const e0 = errors.length;
    // ① の最後に読み込んだファイルは壁 0 本なので、走行中のコースで開き直して編集対象を戻す。
    await page.click('#editToggle'); await page.waitForTimeout(300);   // 閉じる
    await page.click('#editToggle'); await page.waitForTimeout(500);   // 走行中のコースで開き直す
    const geom = await appModule(page, 'js/state.js', (m) => ({
      n: m.course ? m.course.walls.length : 0,
      maxX: m.course && m.course.walls.length ? Math.max(...m.course.walls.flatMap((w) => [w.x1, w.x2])) : 0,
    }));
    const SHRUNK = 1, margin = 0.05 * SHRUNK;   // 第三者向け基準の margin = 長辺 × 5%
    ok(geom.n > 0 && geom.maxX > SHRUNK + margin,
      `⑦⑧ 前提: 枠を ${SHRUNK} m へ縮めれば第三者向け基準には落ちる形になる (壁 ${geom.n} 本・最大 x=${geom.maxX.toFixed(2)} m > 許容 ${(SHRUNK + margin).toFixed(2)} m)`);
    await page.fill('#edW', String(SHRUNK)); await page.dispatchEvent('#edW', 'change');
    await page.fill('#edH', String(SHRUNK)); await page.dispatchEvent('#edH', 'change');
    await page.fill('#edName', 'BC3 枠を縮めた自作');
    await page.waitForTimeout(400);
    const [dimHead] = await parts('log.edDims', { w: SLOT, h: '' });
    ok((await logLines()).some((l) => l.startsWith(dimHead)), '⑦⑧ 枠の変更が実際に適用された');

    // ⑦ 投稿しようとすると、投稿する前に理由が出る。書き出しは止めない。
    const [subHead] = await parts('log.courseSubmitBad', { why: SLOT });
    const dl = page.waitForEvent('download', { timeout: 10000 }).then((d) => d.suggestedFilename()).catch(() => null);
    await page.click('#edShare');
    await page.waitForTimeout(1500);
    ok(subHead.length > 3 && (await logLines()).some((l) => l.startsWith(subHead)),
      `⑦ 検査に落ちる形は投稿する前に理由が出る (告知の書き出し ${JSON.stringify(subHead)})`);
    ok((await dl) !== null, '⑦ 告知を出してもファイルの書き出しは続く (ダウンロードが始まる)');

    // ①往復 **書き出し → 取り込み**。枠を縮めた状態を #edExport で実ファイルに落とし、そのファイルを
    // #edImport で読み戻す。product の書き出し物をそのまま product に食わせるので、基準の非対称
    // (localStorage なら開けてファイルなら開けない) があればここで必ず赤になる。
    {
      const eb = errors.length;
      const [badHead0] = await parts('log.courseBad', { name: SLOT, why: '' });
      const [loadHead] = await parts('log.courseJsonLoaded', { name: SLOT });
      // **件数の差**で測る。`some(startsWith)` だと、この前の取り込みで出た行が残っているせいで
      // 読み戻しが拒否されても緑のままになる (変異 M5 で実測した「見せかけの緑」)。
      const count = async (head) => (await logLines()).filter((l) => l.startsWith(head)).length;
      const nBad0 = await count(badHead0), nLoad0 = await count(loadHead);
      const exp = page.waitForEvent('download', { timeout: 10000 });
      await page.click('#edExport');
      const dlFile = await exp.catch(() => null);
      const path = dlFile ? await dlFile.path() : null;
      ok(!!path, `①往復 #edExport がファイルを書き出す (${dlFile ? dlFile.suggestedFilename() : 'なし'})`);
      if (path) {
        const dimsBefore = await page.evaluate(() => document.getElementById('edDims').textContent);
        await page.setInputFiles('#edImport', path);
        await page.waitForTimeout(700);
        const nLoad1 = await count(loadHead), nBad1 = await count(badHead0);
        ok(nLoad1 === nLoad0 + 1, `①往復 書き出したファイルを #edImport で読み戻せる (読込の行 ${nLoad0} → ${nLoad1})`);
        ok(nBad1 === nBad0, `①往復 読み戻しで取り込み拒否の行が増えていない (${nBad0} → ${nBad1})`);
        ok(await page.evaluate(() => document.getElementById('edDims').textContent) === dimsBefore,
          `①往復 読み戻した枠が書き出したときと同じ (${dimsBefore})`);
      }
      ok(errors.length === eb, `①往復 新しい JS/HTTP エラー 0 (${errors.length - eb})`);
    }

    // ⑧ 同じ形を ✔適用 すると **通る** (② と同じ基準＝割れない)。product が決めた state.course で測る。
    const [badHead] = await parts('log.courseBad', { name: SLOT, why: '' });
    const nBadBefore = (await logLines()).filter((l) => l.startsWith(badHead)).length;
    await page.click('#edApply');
    await page.waitForTimeout(1200);
    const fpAfter = await courseFp();
    ok(/\|b=1x1$/.test(fpAfter), `⑧ 枠を縮めた自作コースは ✔適用 で通る (走行中のコース: ${fpAfter})`);
    ok((await logLines()).filter((l) => l.startsWith(badHead)).length === nBadBefore,
      '⑧ ✔適用 で取り込み拒否の行が増えていない');
    ok(errors.length === e0, `⑦⑧ 新しい JS/HTTP エラー 0 (${errors.length - e0})`);
  }

  // ── ③ データ復元 → ② 保存コースの選択 ───────────────────────────────────
  // 復元は生の文字列を byte 同値で戻すのが契約 (data_backup.js) なので、壊れたコースはここでは弾かない。
  // 「弾かないが、選んだときに受け止める」という設計そのものを測る。
  console.log('\n── ③ データ復元 (#dataImport) → ② 保存コースの選択 ──');
  {
    const e0 = errors.length;
    const saved = {};
    for (const [f, b] of OWN_DROP) saved['BC3D ' + f] = JSON.parse(b);     // 選んだら拒否されるべき形
    for (const [f, b] of OWN_KEEP) saved['BC3K ' + f] = JSON.parse(b);     // 選んだら開けなければならない形
    saved['BC3K ' + KEEP[0]] = JSON.parse(KEEP[1]);                        // 正常な保存コースも 1 本
    const envelope = JSON.stringify({ format: 'rumicar-backup', version: 1, app: '', count: 1,
      data: { 'rumicar.courses': JSON.stringify(saved) } });
    page.on('dialog', (d) => d.accept());          // 復元の確認ダイアログ
    await page.setInputFiles('#dataImport', { name: 'bc3-backup.json', mimeType: 'application/json', buffer: Buffer.from(envelope) });
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(3000);
    ok(errors.length === e0, `③ 復元してから再読込しても JS/HTTP エラー 0 (${errors.length - e0}: ${JSON.stringify(errors.slice(e0, e0 + 2))})`);
    const opts = await page.evaluate(() => [...document.querySelectorAll('#courseSel option')].map((o) => o.value));
    const restored = Object.keys(saved).filter((n) => opts.includes(n));
    ok(restored.length === Object.keys(saved).length,
      `③ 復元した保存コースが全件一覧に出る (${restored.length}/${Object.keys(saved).length}) = 復元は byte 同値で弾かない`);

    // ②-a 拒否されるべき形
    for (const [file] of OWN_DROP) {
      const name = 'BC3D ' + file;
      const body = JSON.stringify(saved[name]);
      const fpBefore = await courseFp();
      const selBefore = await selValue();
      const eb = errors.length;
      await page.selectOption('#courseSel', name);
      await page.waitForTimeout(800);
      const why = await whyOf(body, true);          // 保存コースの基準 (own) で理由を得る
      const want = await line('log.courseBad', { name, why });
      ok((await logLines()).includes(want), `② ${name}: 理由つきで拒否 (why=${JSON.stringify(why)})`);
      ok(await courseFp() === fpBefore, `② ${name}: 走行中のコースが差し替わっていない (${fpBefore})`);
      // **product が戻した値**を見る (自分が選んだ値ではない＝読み返しにならない)。
      // 見ているのは「利用者がいま行った選択が取り消されたか」で、「走行中のコースと一致するか」ではない
      // (rebuildCourseList を引数無しで呼ぶ経路では、拒否の前から両者は一致しない＝BC3 の関与外)。
      const selAfter = await selValue();
      ok(selAfter === selBefore, `② ${name}: 選択が取り消され直前の option へ戻る (${selBefore})`);
      ok(selAfter !== name, `② ${name}: courseSel が拒否したコースを指したままにならない`);
      const hc = await hashCourse();
      ok(hc !== name, `② ${name}: 共有 URL が拒否したコースを指していない (hash の course=${JSON.stringify(hc)})`);
      ok(errors.length === eb, `② ${name}: 新しい JS/HTTP エラー 0 (${errors.length - eb})`);
    }
    // ②-b **開けなければならない形** (BC3 の回帰オラクル: 1 回目はここで出荷 66/66 本が開けなくなった)
    for (const [file] of OWN_KEEP.concat([KEEP])) {
      const name = 'BC3K ' + file;
      const fpBefore = await courseFp();
      const eb = errors.length;
      await page.selectOption('#courseSel', name);
      await page.waitForTimeout(1200);
      const fpAfter = await courseFp();
      const want = await expectFp(saved[name]);
      ok(fpAfter === want, `② ${name}: 枠の外に壁がある自作コースでも開ける (走行中: ${fpAfter} / 期待 ${want} / 直前 ${fpBefore})`);
      ok(await selValue() === name, `② ${name}: 選択が保持される`);
      ok(errors.length === eb, `② ${name}: 新しい JS/HTTP エラー 0 (${errors.length - eb})`);
    }
    // 拒否のあとも本体が動く (▶ で走り出す)
    const runLabel = await appModule(page, 'js/i18n.js', (m) => m.t('hud.st.run'));
    await page.click('#run');
    await page.waitForTimeout(3000);
    ok(await page.evaluate(() => document.getElementById('state').textContent) === runLabel,
      '② 拒否のあとも ▶ で走り出す (アプリが止まっていない)');
    await page.click('#stop');
    await page.waitForTimeout(500);
  }

  // ── ④⑤ 公式レースのコース解決 (同梱 courseDef) ───────────────────────────────
  // **ここが「④ を実際に実行する」唯一のゲート。** 卓上の wf_official_result は course を
  // buildFromSpec から作るので resolveRaceCourse を 1 度も通らない (実測 2026-09-18)。
  console.log('\n── ④⑤ 公式レースのコース解決 (#ofVerify) ──');
  {
    const e0 = errors.length;
    await page.click('#officialOpen');
    await page.waitForTimeout(2500);
    const raceOpts = await page.evaluate(() => [...document.querySelectorAll('#ofRace option')].map((o) => o.value));
    ok(EVENTS.every(([id]) => raceOpts.includes(id)), `④ 大会 ${EVENTS.length} 本が一覧に出る (${JSON.stringify(raceOpts)})`);
    const noteTxt = () => page.evaluate(() => (document.getElementById('ofVerifyNote')?.textContent ?? ''));

    // (a) 壊れた同梱 courseDef → 解決できず、理由が利用者に届く
    {
      await page.selectOption('#ofRace', 'bc3-bad');
      await page.waitForTimeout(1500);
      const why = await whyOf(JSON.stringify(BAD_DEF), false);
      const want = await line('log.courseBad', { name: BAD_DEF.name, why });
      const noCourseTxt = await line('official.verify.noCourse', { name: BAD_DEF.name });
      await page.click('#ofVerify');
      await page.waitForTimeout(2500);
      ok((await noteTxt()).includes(noCourseTxt), '④ 壊れた同梱 courseDef は解決できないと出る');
      ok((await logLines()).includes(want), `④ 解決できない理由が 1 行届く (why=${JSON.stringify(why)})`);
      ok(await page.evaluate(() => !document.getElementById('dlgRace').open), '④ 壊れた courseDef で結果ダイアログを開かない');
      ok(errors.length === e0, `④ 壊れた courseDef で新しい JS/HTTP エラー 0 (${errors.length - e0})`);
    }
    // (b) 正常な同梱 courseDef → 解決して検証まで進む (＝経路が素通りでなく現に通っている)
    {
      const e1 = errors.length;
      await page.selectOption('#ofRace', 'bc3-good');
      await page.waitForTimeout(1500);
      await page.click('#ofVerify');
      await page.waitForTimeout(20000);
      const note = await noteTxt();
      const [refHead] = await parts('official.verify.refOnly', { hash: SLOT });
      ok(!note.includes(await line('official.verify.noCourse', { name: GOOD_DEF.name })),
        '④ 正常な同梱 courseDef は解決できる (解決不可の注記が出ない)');
      ok(refHead.length > 3 && note.includes(refHead), `④ 検証まで進んで verifyHash が出る (注記: ${JSON.stringify(note.slice(0, 80))})`);
      ok(await page.evaluate(() => !!document.getElementById('dlgRace').open), '④ 正常な courseDef では結果ダイアログが開く');
      // 解決されたコースが **従来の normalizeCourse と byte 同値**。現状の acceptCourseData は本体が
      // normalizeCourse そのものなので構成上自明で、値があるのは契約の固定のほう (卓上ゲートの A) と同じ断り)。
      // 「決定論を変えない」の実体は、**この経路を通して verifyHash が現に出た**こと (1 つ上の行) で見る。
      const same = await page.evaluate((def) => import(new URL('js/course.js', location.href).href).then((m) =>
        JSON.stringify(m.acceptCourseData(JSON.parse(JSON.stringify(def)), { own: false }).course)
        === JSON.stringify(m.normalizeCourse(JSON.parse(JSON.stringify(def))))), GOOD_DEF);
      ok(same, '④ 入口を通したコースは normalizeCourse の出力と byte 同値 (入口の契約)');
      ok(errors.length === e1, `④ 正常な courseDef で新しい JS/HTTP エラー 0 (${errors.length - e1})`);
      await page.click('[data-close="dlgRace"]').catch(() => {});
      await page.waitForTimeout(400);
    }
  }

  ok(errors.length === 0, `全体の JS/HTTP エラー 0 (${errors.length}: ${JSON.stringify(errors.slice(0, 3))}) / 想定内 ${benign.length}`);
} finally {
  await browser.close();
}
console.log(`\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗:\n  - ' + fails.join('\n  - ')); process.exit(1); }
console.log('結果: PASS');
