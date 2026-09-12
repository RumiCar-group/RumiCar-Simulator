// RumiCar Simulator — 実ブラウザ 常設ゲート: エンゲージメント機能群 (Stage AS13)
//
// 背景: AS13 で足した4機能のうち、**実データが今あるのは練習側 (チャレンジ) と
//   レースのゴースト (区間比較) だけ**である。公式レース (GitHub races/) は未シードなので
//   シーズン/チャンピオンシップ・言語別ラダーの母集団は 0 件 — それを「空だから緑」と誤魔化さず、
//   ① 空のときに正直な文言が出ること ② 配信物のモジュールが到達可能で正しく動くこと、に分けて測る。
//
// ここで測るもの (「機能が使えているように見えるか」の目視の代わりになる測定述語):
//   T1 🎯 チャレンジ: ボタンが配信 UI に実在し、ダイアログが開き、母集団が配信 courses.json と一致する
//      (完走が定義されないコースの除外件数まで。**新規プロファイル = 練習記録 0 件から始まる**)
//   T2 チャレンジの実データ経路: **本番 UI で実際に1周走る**と、配信物 lap.js の loadBestRec に記録が生まれ、
//      チャレンジの完走数がちょうど 1 増えてそのコースが ✅ になる (localStorage を直接書かない=CI-8)
//   T3 ⏱ 区間比較: 本番 🏁 レース → 観戦リプレイに区間表が出る。表の数値が内部整合する
//      (理論ベスト = 各区間最速の和・● は各区間ちょうど1つ・理論ベスト ≤ 実ベストラップ)
//   T4 🏅 ランキング: 未シードでは「まだ検証済の公式記録がありません」を正直に出す (空表を作らない)
//   T5 配信物の到達性: 配信中の race_season.js が実 result 形式で選手権/言語別ラダーを算出できる
//      (schema 追加ゼロ = result.json に lang が無いまま言語別が成立することの実物確認)
//   T6 en 追従: チャレンジ・区間表の見出しが英語になる (ja 固定文言でない)
//   T7 レイアウト: 広い表 (区間・チャレンジ) を開いても本文の横はみ出しは 0
//   T8 操作中の console error / pageerror 0 (想定内の 404 は件数を明示して除外)
//
// 使い方: bash run.sh check_as13_engage.mjs   終了コード: 0=全 PASS / 1=いずれか FAIL
import { launch, newPage, setLang, report, APP_URL, overflowX } from './lib.mjs';

let pass = 0, fail = 0;
const ok = (label, cond, detail) => (report(label, cond, detail) ? pass++ : fail++);

const browser = await launch();
console.log(`\n== 実ブラウザ: エンゲージメント機能群 (AS13) ==\n対象: ${APP_URL}\n`);
const { page, errors, benign } = await newPage(browser, { width: 1440, height: 900 });

// 配信中のモジュールに答えさせる (再実装しない・CI-9 / oracle_inventory.md)。
const bestRec = (courseName, carType) => page.evaluate(async ([n, c]) => {
  const m = await import('./js/lap.js');
  return m.loadBestRec(n, c);
}, [courseName, carType]);

// ── T1: チャレンジの実在・母集団 ─────────────────────────────────────────
await setLang(page, 'ja');
{
  ok('T1-a 🎯 チャレンジ ボタンが配信 UI に実在', await page.locator('#chalOpen').count() === 1);
  await page.click('#chalOpen');
  await page.waitForTimeout(400);
  ok('T1-b ダイアログが開く', await page.locator('#dlgChallenge').evaluate((d) => d.open));

  // 母集団を配信中の challenge.js + course.js + courses.json で独立に求め、DOM の表示と突き合わせる。
  const truth = await page.evaluate(async () => {
    const [ch, co] = await Promise.all([import('./js/challenge.js'), import('./js/course.js')]);
    const built = co.PRESETS.map((f) => f());
    // 母集団は **isChallengeCourse**（= isCompletable かつ bench でない）。UI と同じ述語を使う。
    // AY2 (ed255eb) が `bench` 印つきコース 7 本を入れた時点で `isCompletable`(64) と UI(57) が
    // 割れていたのに、この検査は古い述語のままだった＝AY2 以降ずっと赤。実測で確定して是正:
    //   courses.json 66 本 / isCompletable 64 / bench 7 / 64-7 = 57 = UI 表示。
    // `excluded` は「完走が定義されないコース」(2 本) のままでよい（UI もそちらを表示する）。
    return { total: built.filter(ch.isChallengeCourse).length, excluded: built.filter((c) => !ch.isCompletable(c)).length,
      all: built.length, bench: built.filter((c) => c.bench).length };
  });
  const totalTxt = (await page.locator('#chalBody .chal-total').innerText()).trim();
  ok('T1-c 母集団 = 完走が定義されるコースだけ (配信 courses.json 由来)',
    totalTxt.includes(`/ ${truth.total}`), `表示="${totalTxt}" / 配信物の実測 total=${truth.total} (全 ${truth.all}・完走定義なし ${truth.excluded}・ベンチ ${truth.bench})`);
  ok('T1-d 除外件数を黙らず表示する (沈黙截断の禁止)',
    (await page.locator('#chalBody').innerText()).includes(String(truth.excluded)), `除外 ${truth.excluded} 件`);
  ok('T1-e 新規プロファイルは完走 0 から始まる (前回の記録が漏れていない)',
    /完走\s*0\s*\//.test(totalTxt), totalTxt);
  const badges = await page.locator('#chalBody .chal-badge').count();
  const got = await page.locator('#chalBody .chal-badge.got').count();
  ok('T1-f バッジが並び、記録 0 のうちは1つも取得されていない', badges > 0 && got === 0, `バッジ ${badges} 件・取得 ${got} 件`);
  const rows = await page.locator('#chalBody tr.chal-done, #chalBody tr.chal-todo').count();
  ok('T1-g コース別の一覧が母集団と同数', rows === truth.total, `行 ${rows} / ${truth.total}`);
  ok('T7-a チャレンジを開いても横はみ出し 0', (await overflowX(page, 1440)) === 0);
  await page.locator('#dlgChallenge .docdlg-x').click();
  await page.waitForTimeout(200);
}

// ── T2: 実データ経路 — 本番 UI で実際に1周走り、練習記録→チャレンジ反映を確かめる ────
// localStorage を直接書かない。利用者と同じ操作 (コース選択→▶→周回) だけで記録を作る (CI-8)。
{
  // いちばんやさしい ★1 🔰 のコースを UI から選ぶ (ラベルのサフィックスは main.js courseListSuffix)。
  const opts = await page.$$eval('#courseSel option', (os) => os.map((o) => ({ v: o.value, t: o.textContent })));
  const easy = opts.find((o) => /★1/.test(o.t) && /🔰/.test(o.t)) || opts[0];
  await page.selectOption('#courseSel', easy.v);
  await page.waitForTimeout(800);
  const carType = await page.evaluate(() => {
    const s = document.querySelector('.cc-cartype, select[id^="ct"]');
    return s ? s.value : null;
  });
  const before = await bestRec(easy.v, carType);
  ok('T2-a 走る前は練習記録が無い', before === null, `course="${easy.v}" car=${carType} rec=${JSON.stringify(before)}`);

  await page.click('#run');
  const t0 = Date.now();
  let rec = null;
  while ((Date.now() - t0) < 90_000) {          // 1 周できるまで待つ (卓上 ★1 なら数十秒)
    await page.waitForTimeout(1000);
    rec = await bestRec(easy.v, carType);
    if (rec) break;
  }
  await page.click('#stop');
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  ok('T2-b 本番 UI で走ると配信物 lap.js に練習記録が生まれる',
    !!(rec && rec.t > 0), `${secs}s で ${rec ? `t=${rec.t.toFixed(2)}s ver=${rec.ver}` : '記録できず'} (course="${easy.v}")`);

  if (rec) {
    await page.click('#chalOpen');
    await page.waitForTimeout(400);
    const totalTxt = (await page.locator('#chalBody .chal-total').innerText()).trim();
    ok('T2-c チャレンジの完走数がちょうど 1 増える', /完走\s*1\s*\//.test(totalTxt), totalTxt);
    const doneRows = await page.locator('#chalBody tr.chal-done').count();
    ok('T2-d ✅ になった行はちょうど 1 行', doneRows === 1, `chal-done ${doneRows} 行`);
    const doneTxt = doneRows ? await page.locator('#chalBody tr.chal-done').first().innerText() : '';
    ok('T2-e ✅ になったのは実際に走ったコース', doneTxt.includes(easy.v.replace(/^gh:/, '')) ||
      doneTxt.includes((easy.t || '').split('  ')[0].trim()), `行="${doneTxt.replace(/\s+/g, ' ').slice(0, 80)}"`);
    ok('T2-f 「はじめの一歩」バッジを取得', await page.locator('#chalBody .chal-badge.got').count() >= 1);
    await page.locator('#dlgChallenge .docdlg-x').click();
    await page.waitForTimeout(200);
  } else {
    fail += 4; console.log('  ✗ T2-c〜f: 記録が作れなかったため未実施 (沈黙截断せず失敗として数える)');
  }
}

// ── T3: 区間比較 — 本番 🏁 レース → 観戦リプレイの区間表 ───────────────────
{
  await page.click('#carAdd');                     // 2 台にして「区間最速の保持者」を意味あるものにする
  await page.waitForTimeout(400);
  await page.fill('#raceLaps', '3');
  await page.click('#raceRun');
  await page.waitForTimeout(6000);                 // レース計算 + 観戦リプレイの発走演出
  const ghostOpen = await page.locator('#dlgGhost').evaluate((d) => d.open).catch(() => false);
  ok('T3-a 🏁 レース後に観戦リプレイが開く', ghostOpen === true);
  const sectTxt = await page.locator('#ghostSectors').innerText().catch(() => '');
  ok('T3-b 区間別 並走比較が描画される', /区間別/.test(sectTxt), sectTxt.split('\n')[0] || '(空)');
  ok('T3-c 間引きの限界を正直に明記している', /目安/.test(sectTxt) && /最後の 1 周/.test(sectTxt));

  // 表の数値が内部整合するか (DOM から読み取って検算する = 表示が主張していることを測る)
  const grid = await page.$$eval('#ghostSectors table tbody tr', (trs) =>
    trs.map((tr) => ({ cls: tr.className, cells: [...tr.querySelectorAll('td')].map((td) => td.innerText.trim()) })));
  const num = (s) => { const m = /(-?\d+(?:\.\d+)?)s/.exec(s || ''); return m ? +m[1] : null; };
  const carRows = grid.filter((r) => !/sect-theo/.test(r.cls));
  const theoRow = grid.find((r) => /sect-theo/.test(r.cls));
  ok('T3-d 車の行が 2 台ぶん出る', carRows.length === 2, `行 ${carRows.length}`);
  if (theoRow && carRows.length) {
    const K = carRows[0].cells.length - 3;         // 車名 + K区間 + ベストラップ + 周
    const bests = Array.from({ length: K }, (_, j) => num(theoRow.cells[j + 1]));
    const sum = bests.reduce((a, b) => a + b, 0);
    const theo = num(theoRow.cells[K + 1]);
    ok('T3-e 理論ベスト = 各区間最速の和 (表示が内部整合)',
      Math.abs(sum - theo) <= 0.011 * K, `Σ=${sum.toFixed(2)}s 表示=${theo}s (K=${K}・表示は小数2桁丸め)`);
    const lapBests = carRows.map((r) => num(r.cells[K + 1])).filter((v) => v != null);
    ok('T3-f 理論ベスト ≤ 実ベストラップ (定義どおり)', theo <= Math.min(...lapBests) + 1e-9,
      `理論 ${theo}s ≤ 実ベスト ${Math.min(...lapBests)}s`);
    for (let j = 0; j < K; j++) {
      const marks = carRows.filter((r) => /●/.test(r.cells[j + 1])).length;
      ok(`T3-g S${j + 1} の区間最速 ● はちょうど 1 台`, marks === 1, `● ${marks} 件`);
    }
    // 各区間の最速表示が、車の行の最小値と一致する (● の付け方が正しい)
    for (let j = 0; j < K; j++) {
      const vals = carRows.map((r) => num(r.cells[j + 1])).filter((v) => v != null);
      ok(`T3-h S${j + 1} の理論ベスト値 = 全車の最小`, Math.abs(Math.min(...vals) - bests[j]) < 1e-9,
        `min=${Math.min(...vals)}s 表示=${bests[j]}s`);
    }
  } else { fail++; console.log('  ✗ T3-e〜h: 理論ベスト行が無く検算できない'); }
  ok('T7-b 区間表を開いても横はみ出し 0', (await overflowX(page, 1440)) === 0);
  await page.locator('#dlgGhost .docdlg-x').click();
  await page.waitForTimeout(600);
  // 観戦を閉じると結果ダイアログが出る (AB10 の連結)。次の操作のため閉じる。
  for (const id of ['dlgRace', 'dlgResult']) {
    const d = page.locator('#' + id);
    if (await d.count() && await d.evaluate((x) => x.open).catch(() => false)) {
      await page.locator(`#${id} .docdlg-x`).click().catch(() => {});
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
}

// ── T4: ランキング (公式は未シード = 実データ 0 件) ────────────────────────
{
  await page.click('#rankOpen');
  await page.waitForTimeout(2500);                 // GitHub 取得 (未シードなら 404 → benign)
  const body = await page.locator('#rankBody').innerText();
  ok('T4-a 未シードでは「まだ検証済の公式記録がありません」を正直に出す',
    /検証済の公式記録がありません/.test(body), body.replace(/\s+/g, ' ').slice(0, 90));
  ok('T4-b 空の選手権表や空の言語別表を作らない',
    !/チャンピオンシップ/.test(body) && !/言語別ラダー/.test(body));
  await page.locator('#dlgRankings .docdlg-x').click();
  await page.waitForTimeout(200);
}

// ── T9: 未シードのままでは **描画コードが一度も走らない** ので、上流を seeded mock にして
//        本番の取得→集計→描画の通し経路を通す。アプリのコードは一切変えない (ネットワーク層の
//        差し替えだけ＝テスト用の分岐やバイパスを作らない・CI-8)。W6 の検証と同じ型。
{
  const repo = await page.evaluate(async () => (await import('./js/loader.js')).COURSE_REPO
    || (await import('./js/config.js')).COURSE_REPO);
  const owner = repo.owner, name = repo.repo, branch = repo.branch;
  const COURSE = '競技サーキット (フルスケール)';
  const mkResult = (id, order) => ({
    eventId: id, engineVer: 'v7.3.0', class: 'open', course: COURSE, regime: 'fullscale', laps: 3,
    finishers: order.map((a, i) => ({ rank: i + 1, name: a + '-car', author: a, carType: 'normal_fr',
      totalTimeMs: 30000 + i * 1500, bestLapMs: 10000 + i * 500, penaltiesSec: 0 })),
    dnf: [{ name: 'carol-car', author: 'carol', carType: 'normal_ff', lapsCompleted: 1, reason: 'timeout' }],
    grid: [], verifyHash: 'abcd' + id.slice(-1), computedAt: '2026-08-05T00:00:00Z',
  });
  const LANGS = { alice: 'py', bob: 'c', carol: 'c' };
  const mkEntries = (who) => who.map((a, i) => ({ name: a + '-car', author: a,
    program: { src: '// ' + a, lang: LANGS[a] }, carType: 'normal_fr', submittedAt: `2026-01-0${i + 1}T00:00:00Z` }));
  const EVENTS = {
    r1: { event: { id: 'r1', title: '第1戦', season: '2026', class: 'open', course: COURSE, regime: 'fullscale', laps: 3 },
      entries: mkEntries(['alice', 'bob', 'carol']), result: mkResult('r1', ['alice', 'bob']) },
    r2: { event: { id: 'r2', title: '第2戦', season: '2026', class: 'open', course: COURSE, regime: 'fullscale', laps: 3 },
      entries: mkEntries(['alice', 'bob', 'carol']), result: mkResult('r2', ['bob', 'alice']) },
  };
  const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**://api.github.com/**', (route) => {
    const u = decodeURIComponent(route.request().url());
    if (u.includes(`/contents/races?ref=${branch}`)) return json(route, Object.keys(EVENTS).map((id) => ({ name: id, type: 'dir', path: 'races/' + id })));
    const m = /\/contents\/races\/([^/?]+)\/entries\?/.exec(u);
    if (m && EVENTS[m[1]]) return json(route, EVENTS[m[1]].entries.map((e, i) => ({ type: 'file', name: `${e.author}.json`,
      download_url: `https://raw.githubusercontent.com/${owner}/${name}/${branch}/races/${m[1]}/entries/${e.author}.json` })));
    return route.continue();
  });
  await page.route('**://raw.githubusercontent.com/**', (route) => {
    const u = decodeURIComponent(route.request().url());
    const m = /\/races\/([^/]+)\/(event|result)\.json$/.exec(u);
    if (m && EVENTS[m[1]]) return json(route, EVENTS[m[1]][m[2] === 'event' ? 'event' : 'result']);
    const e = /\/races\/([^/]+)\/entries\/([^/]+)\.json$/.exec(u);
    if (e && EVENTS[e[1]]) return json(route, EVENTS[e[1]].entries.find((x) => x.author === e[2]) || {});
    return route.continue();
  });

  await page.click('#rankOpen');
  await page.waitForTimeout(600);
  await page.click('#rankReload');
  await page.waitForTimeout(2500);
  const body = await page.locator('#rankBody').innerText();

  ok('T9-a 取得→集計→描画の通し経路が通る (空表示でなくなる)', !/検証済の公式記録がありません/.test(body));
  ok('T9-b 🏆 チャンピオンシップ節が描画される', /チャンピオンシップ/.test(body));
  ok('T9-c 配点を画面に明記している (黙って配らない)', /10-8-6-5-4-3-2-1/.test(body), '配点表示');
  // alice/bob は 1-2 位と 2-1 位 = 完全同点 ⇒ 王者を立てず「同点」を出すのが正しい (race_season.tie)
  ok('T9-d 完全同点は王者を立てず「同点」と正直に出す', /同点で並んでおり/.test(body),
    (/👑[^\n]*/.exec(body) || ['(👑 行なし)'])[0].slice(0, 60));
  ok('T9-e リタイアは 0 点だが出走に数える (carol の行が出る)', /carol/.test(body));
  ok('T9-f 🗣 言語別ラダー節が描画される', /言語別ラダー/.test(body));
  ok('T9-g 言語別に C と Python が並ぶ', /Python/.test(body) && /\bC\b/.test(body));
  ok('T9-h 言語不明 (補充車等) の除外件数を出す or 0 件で出さない',
    !/言語を特定できない/.test(body) || /言語を特定できない記録 \d+ 件/.test(body));
  ok('T9-i クラス別ラダーの言語別 👑 帯が出る', (await page.locator('#rankBody .rank-langchip').count()) >= 2,
    `chip ${await page.locator('#rankBody .rank-langchip').count()} 件`);
  ok('T7-c ランキング (選手権＋言語別) を開いても横はみ出し 0', (await overflowX(page, 1440)) === 0);
  await page.locator('#dlgRankings .docdlg-x').click();
  await page.waitForTimeout(200);
  await page.unroute('**://api.github.com/**');
  await page.unroute('**://raw.githubusercontent.com/**');
}

// ── T5: 配信物の到達性 — 配信中の race_season.js が実 result 形式で動く ─────────
{
  const r = await page.evaluate(async () => {
    const [L, S] = await Promise.all([import('./js/race_ladder.js'), import('./js/race_season.js')]);
    // W_spec §6 の result schema そのまま (lang は**持たない**)。言語は entries から引く。
    const mk = (id, season, order, langs) => ({
      event: { id, season, class: 'open', course: 'C', laps: 3 },
      entries: order.map((a, i) => ({ name: a + '-car', author: a, program: { src: '', lang: langs[a] },
        carType: 'normal_fr', submittedAt: `2026-01-01T00:00:0${i}Z` })),
      result: { eventId: id, class: 'open', course: 'C', laps: 3, verifyHash: 'deadbeef',
        finishers: order.map((a, i) => ({ rank: i + 1, name: a + '-car', author: a, carType: 'normal_fr',
          totalTimeMs: 10000 + i * 1000, bestLapMs: 10000 + i * 1000, penaltiesSec: 0 })), dnf: [] },
    });
    const races = [mk('r1', '2026', ['alice', 'bob'], { alice: 'py', bob: 'c' }),
                   mk('r2', '2026', ['alice', 'bob'], { alice: 'py', bob: 'c' })];
    const agg = L.aggregate(races);
    const ch = S.championships(agg.records, agg.dnfs);
    const lb = S.langBoards(agg.records);
    const hasLang = races.some((x) => JSON.stringify(x.result).includes('"lang"'));
    return { champion: ch[0] && ch[0].champion && ch[0].champion.author, pts: ch[0] && ch[0].champion.points,
      langs: lb.boards.map((b) => b.lang).sort(), resultHasLang: hasLang, points: S.POINTS_DEFAULT.join('-') };
  });
  ok('T5-a 配信中の race_season.js が選手権を算出できる',
    r.champion === 'alice' && r.pts === 20, `champion=${r.champion} pts=${r.pts} (配点 ${r.points})`);
  ok('T5-b 配信中の race_season.js が言語別ラダーを作れる', JSON.stringify(r.langs) === '["c","py"]', `langs=${r.langs}`);
  ok('T5-c result.json 側に lang を持たせずに言語別が成立している (schema 追加ゼロ)', r.resultHasLang === false);
}

// ── T6: en 追従 ───────────────────────────────────────────────────────────
{
  await setLang(page, 'en');
  await page.click('#chalOpen');
  await page.waitForTimeout(400);
  const en = await page.locator('#dlgChallenge').innerText();
  ok('T6-a チャレンジが英語になる', /Challenges/.test(en) && /Progress by difficulty/.test(en) && !/難度別/.test(en),
    en.replace(/\s+/g, ' ').slice(0, 70));
  ok('T6-b バッジ文言も英語', /cleared|First steps/.test(en));
  await page.locator('#dlgChallenge .docdlg-x').click();
  await page.waitForTimeout(200);
  await page.click('#rankOpen');
  await page.waitForTimeout(1500);
  // T9 で集計済みのラダーがキャッシュに残っているので、**選手権/言語別の描画そのもの**が英語になるかを測る
  // (空表示のまま「Rankings があれば緑」にすると、新規2節が ja 固定でも通ってしまう)。
  const enRank = await page.locator('#dlgRankings').innerText();
  ok('T6-c 🏆 チャンピオンシップ節が英語になる', /Championship \(season\)/.test(enRank) && !/チャンピオンシップ/.test(enRank),
    enRank.replace(/\s+/g, ' ').slice(0, 70));
  ok('T6-d 🗣 言語別ラダー節が英語になる', /Ladders by language/.test(enRank) && !/言語別ラダー/.test(enRank));
  ok('T6-e 同点の注記も英語', !/同点で並んでおり/.test(enRank));
  await page.locator('#dlgRankings .docdlg-x').click();
  await setLang(page, 'ja');
}

// ── T8: エラー ────────────────────────────────────────────────────────────
ok('T8 操作中の console error / pageerror 0', errors.length === 0,
  `errors=${errors.length} (想定内除外 ${benign.length} 件)${errors.length ? ' → ' + errors[0] : ''}`);

console.log(`\n[結果] PASS ${pass} / FAIL ${fail}`);
await browser.close();
process.exit(fail ? 1 : 0);
