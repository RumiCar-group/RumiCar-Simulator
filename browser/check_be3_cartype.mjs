// check_be3_cartype.mjs — BE3「投稿車種・自作車・公式レースの持ち込み車種が組込車種を上書きしない」の実ブラウザ検証
// ════════════════════════════════════════════════════════════════════════════
// 何を測るか:
//   v8.7.0 までの `registerCarType` は組込 key も置き換えていた（BD-3(b)）。改修前ツリーで再現（2026-09-24）:
//     R1 起動時: localStorage の自作車に key 'normal_fr' があると組込 FR が置き換わった（maxSpeed 1.02 → 1.9・名前も）
//     R2 runRace: 組込 key の持ち込み車種がレース後も居残り、`custom: true` が付いた
//     R3 R2 の後なら「追加」ボタンで key 'normal_fr' を追加でき、localStorage へ保存された（次の起動で R1 に合流）
//     R4 GitHub 投稿車種は BC3 の検査で止まっていた（到達しない・`check_bc3_intake` ⑥ が理由 builtin を測る）
//   本ゲートは利用者と同じ入口（localStorage に残った自作車での起動・「追加」「複製」「削除」ボタン）で測る（CI-8）。
//   R2 だけは公式レースの UI（GitHub 上の大会・記録）を通さず、ページが読み込んでいる `runRace` を
//   `race_ui.js` のゴースト対戦と同じ field 形で直接呼ぶ（上流の大会データを差し替える治具より product に近い）。
//
// 【判定の物差し（CI-14）】「組込車種が変わらない」＝ページ上の `CAR_TYPE_BY_KEY.normal_fr` が**起動直後の参照そのもの**で、
//   JSON が出荷の定義と byte 一致。「告知する」＝ログ欄に i18n の文言（言語ごとに product の `t()` で組んだもの）が
//   件数と `名前 (key)` つきで出る。**陽性対照**: 同じ localStorage に置いた正当な自作車は登録される（登録処理そのものが
//   止まって「変わらない」になっている、ではないことを先に確かめる）。
import { launch, newPage, appModule } from './lib.mjs';
import { PROGRAM_BY_KEY } from '../public/js/programs.js';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };

const FAKE = { key: 'normal_fr', name: '偽FR', maxSpeed: 1.9, accel: 2.5 };
const GOOD = { key: 'be3_ok', name: '正当な自作', maxSpeed: 1.1 };
const shipped = (page) => appModule(page, 'js/config.js', (m) => JSON.stringify(m.CAR_TYPE_BY_KEY.normal_fr));
const logText = (page) => page.evaluate(() => document.getElementById('log').textContent);
const tr = (page, key, p) => page.evaluate(async ([k, pp]) => (await import(new URL('js/i18n.js', location.href).href)).t(k, pp), [key, p]);
const lsCars = (page) => page.evaluate(() => localStorage.getItem('rumicar.customCars'));
// 1 回目の読み込みでだけ localStorage を用意する（再読込で書き戻さない）。
const seed = (lang, cars) => (p) => p.addInitScript(([l, c]) => {
  if (sessionStorage.getItem('be3.seeded')) return;
  sessionStorage.setItem('be3.seeded', '1');
  localStorage.setItem('rumicar.lang', l);
  localStorage.setItem('rumicar.customCars', JSON.stringify(c));
}, [lang, cars]);

// ⑥ 用の大会 1 本（上流 GitHub の応答だけを差し替える・product には触れない＝check_bc3_intake と同じ型）。
//   エントリー 1 件が自作車「軽量BE3」（key be3_light）を持ち込む。最少台数 3 に足りない分は既定の filler が埋める。
const EV_ID = 'be3-ev';
const LIGHT = { key: 'be3_light', name: '軽量BE3', maxSpeed: 1.2, accel: 1.1 };
const EVENT = { id: EV_ID, title: 'BE3 持ち込み車種のラベル', course: 'オーバル', laps: 1, maxSec: 20, class: 'open', entryWindow: { open: '', close: '' } };
const ENTRY = { name: 'Light', author: 'be3', program: { src: PROGRAM_BY_KEY.normal_fr.code, lang: 'c' }, carDef: LIGHT, submittedAt: '2026-09-01T00:00:00.000Z' };
async function stubRace(p) {
  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await p.route(/api\.github\.com\/repos\/.*\/contents\/races\?/, (r) => r.fulfill(json([{ name: EV_ID, type: 'dir', path: `races/${EV_ID}` }])));
  await p.route(new RegExp(`raw\\.githubusercontent\\.com/.*/races/${EV_ID}/event\\.json$`), (r) => r.fulfill(json(EVENT)));
  await p.route(new RegExp(`raw\\.githubusercontent\\.com/.*/races/${EV_ID}/entries/index\\.json$`), (r) => r.fulfill(json({ entries: ['a.json'] })));
  await p.route(new RegExp(`raw\\.githubusercontent\\.com/.*/races/${EV_ID}/entries/a\\.json$`), (r) => r.fulfill(json(ENTRY)));
  await p.route(new RegExp(`raw\\.githubusercontent\\.com/.*/races/${EV_ID}/result\\.json$`), (r) =>
    r.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: '404: Not Found' }));
}

const browser = await launch();
try {
  // 出荷の定義（何も置かない起動）
  let SHIP;
  {
    const { page } = await newPage(browser, { before: seed('ja', []) });
    SHIP = await shipped(page);
    ok(JSON.parse(SHIP).maxSpeed === 1.02 && !JSON.parse(SHIP).custom, `基準: 出荷の normal_fr（maxSpeed ${JSON.parse(SHIP).maxSpeed}）`);
    await page.close();
  }

  for (const lang of ['ja', 'en']) {
    console.log(`\n【① 起動時の自作車（${lang}）】localStorage に key 'normal_fr' と正当な自作車を置いて起動`);
    const { page, errors, benign } = await newPage(browser, { before: seed(lang, [FAKE, GOOD]) });
    const raw0 = await lsCars(page);
    ok((await shipped(page)) === SHIP, '① 組込 normal_fr は出荷の定義のまま（JSON byte 一致）');
    const good = await appModule(page, 'js/config.js', (m) => { const t = m.CAR_TYPE_BY_KEY.be3_ok; return t ? { s: t.maxSpeed, c: !!t.custom } : null; });
    ok(!!good && good.s === 1.1 && good.c, `① 陽性対照: 同じ保存データの正当な自作車は登録された（${JSON.stringify(good)}）`);
    const want = await tr(page, 'log.customCarsBuiltin', { n: 1, items: `${FAKE.name} (${FAKE.key})` });
    const log = await logText(page);
    ok(want.length > 20 && !want.startsWith('log.') && log.includes(want), `① 理由つきで告知した（${JSON.stringify(want.slice(0, 60))}…）`);
    ok((await lsCars(page)) === raw0 && JSON.parse(raw0).length === 2, '① 保存データは消さない（localStorage byte 不変・2 件）');

    // 一覧に残り、「複製」で別 key として救える・「削除」で片づけられる
    await page.click('#helpCars'); await page.waitForTimeout(400);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#customCarList .ckey')].map((e) => e.textContent));
    ok(rows.includes('normal_fr') && rows.includes('be3_ok'), `① 自作車の一覧に残る（${JSON.stringify(rows)}）`);
    if (lang === 'ja') {
      await page.click('#customCarList .carlist-dup[data-key="normal_fr"]'); await page.waitForTimeout(300);
      const copy = await appModule(page, 'js/config.js', (m) => { const t = m.CAR_TYPE_BY_KEY.normal_fr_copy; return t ? { s: t.maxSpeed, a: t.accel } : null; });
      ok(!!copy && copy.s === 1.9 && copy.a === 2.5, `① 「複製」で別 key（normal_fr_copy）として同じ値を使える（${JSON.stringify(copy)}）`);
      ok((await shipped(page)) === SHIP, '① 複製しても組込 normal_fr は出荷のまま');
      page.once('dialog', (d) => d.accept());
      await page.click('#customCarList .carlist-del[data-key="normal_fr"]'); await page.waitForTimeout(300);
      const after = JSON.parse(await lsCars(page)).map((c) => c.key);
      ok(!after.includes('normal_fr') && after.includes('normal_fr_copy'), `① 「削除」で保存データから片づく（${JSON.stringify(after)}）`);
      ok((await shipped(page)) === SHIP, '① 削除しても組込 normal_fr は消えない');

      console.log('\n【② 公式レースの持ち込み車種】ゴースト対戦と同じ field 形で runRace（持ち込みあり → 同じ field で持ち込みなし）');
      // 物差し: 持ち込みの定義（maxSpeed 1.9）が結果に効く長さ（30 秒）で走らせる。5 秒では誰も周回しないので、定義を
      //   無視しても同じ verifyHash になる（層 4 の指摘・node で実測）。凍結値は改修前ツリー（HEAD 82683cf）を新しい
      //   node プロセスで走らせた値: 持ち込みあり a0cac838・持ち込みなし 2af3e008。
      const r = await page.evaluate(async (f) => {
        const [cfg, re, co, pr] = await Promise.all(['config.js', 'race_engine.js', 'course.js', 'programs.js'].map((x) => import(new URL('js/' + x, location.href).href)));
        const p = pr.PROGRAM_BY_KEY.normal_fr;
        const before = cfg.CAR_TYPE_BY_KEY.normal_fr;
        const def = { ...JSON.parse(JSON.stringify(before)), maxSpeed: f.maxSpeed };
        const field = (cd) => [{ name: 'you', lang: p.lang, src: p.code, carType: 'normal_fr' },
          { name: 'rec', lang: p.lang, src: p.code, carType: 'normal_fr', carDef: cd }];
        const run = (cd) => re.runRace({ course: co.presetByName('オーバル'), laps: 1, maxSec: 30, interact: false, field: field(cd) }).verifyHash;
        const vh = run(def);
        const same = cfg.CAR_TYPE_BY_KEY.normal_fr === before;
        return { same, vh, vhNoDef: run(undefined) };
      }, FAKE);
      ok(r.same, '② レース後、組込 normal_fr は起動直後の参照そのもの');
      ok(r.vh === 'a0cac838', `② レース中は持ち込みの定義で走る（verifyHash ${r.vh}・改修前ツリーの実測 a0cac838 と一致）`);
      ok(r.vhNoDef === '2af3e008' && r.vhNoDef !== r.vh,
        `② 直後の持ち込みなしのレースは改修前ツリーの単独実行と同じ ${r.vhNoDef}（2af3e008）＝前のレースの定義が居残らない・物差しが定義の差を見分ける`);
      ok((await shipped(page)) === SHIP, '② レース後も出荷の定義（JSON byte 一致）');

      console.log('\n【③ 追加ボタン】② の後に key "normal_fr" を追加しようとする（改修前はここで保存まで進んだ）');
      const raw3 = await lsCars(page);
      await page.fill('#carJsonInput', JSON.stringify(FAKE));
      await page.click('#carAddBtn'); await page.waitForTimeout(300);
      const msg = await page.evaluate(() => document.getElementById('carAddMsg').textContent);
      ok(msg === await tr(page, 'cars.add.errDupKey', { key: 'normal_fr' }), `③ 理由つきで拒否（${JSON.stringify(msg)}）`);
      ok((await lsCars(page)) === raw3, '③ 保存データへ書かない（localStorage byte 不変）');
      ok((await shipped(page)) === SHIP, '③ 組込 normal_fr は出荷のまま');

      console.log('\n【④ 自作車の更新は従来どおり】同じ key で値を変えて「追加」');
      await page.fill('#carJsonInput', JSON.stringify({ ...GOOD, maxSpeed: 0.95 }));
      await page.click('#carAddBtn'); await page.waitForTimeout(300);
      const upd = await appModule(page, 'js/config.js', (m) => m.CAR_TYPE_BY_KEY.be3_ok.maxSpeed);
      const saved = JSON.parse(await lsCars(page)).find((c) => c.key === 'be3_ok');
      ok(upd === 0.95 && saved && saved.maxSpeed === 0.95, `④ 更新が車種表と保存データの両方に入る（車種表 ${upd}・保存 ${saved && saved.maxSpeed}）`);
    }
    ok(errors.length === 0, `⑤ JS/HTTP エラー 0 件（${errors.length}${errors.length ? ': ' + JSON.stringify(errors.slice(0, 3)) : ''}）／想定内 ${benign.length}`);
    await page.close();
  }

  console.log('\n【⑥ 公式レースの再実行検証（本番 UI）】持ち込みの自作車の名前が結果表とゴーストの凡例に出る');
  console.log('   （利用者の手元に同じ key の自作車「私の車」がある＝レース中は持ち込みの定義で走り、レース後は手元の定義に戻る）');
  {
    const MINE = { key: LIGHT.key, name: '私の車', maxSpeed: 0.8 };
    const { page, errors, benign } = await newPage(browser, { before: async (p) => { await seed('ja', [MINE])(p); await stubRace(p); } });
    await page.click('#officialOpen'); await page.waitForTimeout(2500);
    const opts = await page.evaluate(() => [...document.querySelectorAll('#ofRace option')].map((o) => o.value));
    ok(opts.includes(EV_ID), `⑥ 大会が一覧に出る（${JSON.stringify(opts)}）`);
    await page.selectOption('#ofRace', EV_ID); await page.waitForTimeout(1500);
    await page.click('#ofVerify');
    await page.waitForFunction(() => document.getElementById('dlgRace').open, null, { timeout: 60000 }).catch(() => {});
    const res = await page.evaluate(() => document.getElementById('raceResults').textContent);
    ok(await page.evaluate(() => document.getElementById('dlgRace').open), '⑥ 検証が走って結果ダイアログが開いた（空振りでない）');
    ok(res.includes('Light'), '⑥ 陽性対照: 持ち込みのエントリー Light が結果表にいる');
    ok(res.includes(LIGHT.name) && !res.includes(LIGHT.key) && !res.includes(MINE.name),
      `⑥ 結果表の車種は走った定義の名前「${LIGHT.name}」で出る（key ${LIGHT.key} の生文字列でも、手元の同じ key の「${MINE.name}」でもない）`);
    const back = await appModule(page, 'js/config.js', (m) => { const t = m.CAR_TYPE_BY_KEY.be3_light; return t ? { n: t.name, s: t.maxSpeed } : null; });
    ok(!!back && back.n === MINE.name && back.s === MINE.maxSpeed, `⑥ レース後、車種表の ${LIGHT.key} は利用者の自作車に戻っている（${JSON.stringify(back)}）＝名前は field から引いている`);
    await page.click('#raceGhost'); await page.waitForTimeout(800);
    const leg = await page.evaluate(() => document.getElementById('ghostLegend').textContent);
    ok(leg.includes(LIGHT.name) && !leg.includes(LIGHT.key) && !leg.includes(MINE.name), `⑥ 👻 ゴーストの凡例も走った定義の名前で出る（${JSON.stringify(leg.slice(0, 120))}）`);
    ok(errors.length === 0, `⑥ JS/HTTP エラー 0 件（${errors.length}${errors.length ? ': ' + JSON.stringify(errors.slice(0, 3)) : ''}）／想定内 ${benign.length}`);
    await page.close();
  }
} finally {
  await browser.close();
}

const line = '─'.repeat(64);
console.log('\n' + line);
console.log('BE3 組込車種の保護 実ブラウザゲート');
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log(line); for (const m of fails) console.log('  ✗ ' + m); }
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
