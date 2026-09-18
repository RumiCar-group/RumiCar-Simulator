// check_bc4_coursekey.mjs — コースの復元キーが option value に統一されていることを実ブラウザで測る (BC4)。
// ════════════════════════════════════════════════════════════════════════════
// **何の失敗を定義するゲートか** (CI-14):
//   コース一覧 (#courseSel) の option value は 3 種で書式が違う —
//     プリセット = コース名 (c.name) / 保存コース = 保存名 / 投稿コース = 'gh:<ファイル名>'。
//   一方「走行中のコース」の識別子 course.name は、投稿コースでは JSON の name であって
//   option value ではない。言語切替 (rebuildCourseList) と共有 hash (c=) がこの course.name を
//   使っていると、**投稿コースだけ**が ①言語を切り替えた瞬間に選択を失い ②共有 URL で復元できない。
//   ここでは「利用者と同じ UI 操作」で 3 種すべてを往復させ、product が決めた値だけを読んで測る。
//
// **空振りしないための要求** (決定ログ BC-5 の型):
//   ・母集団に投稿コースが **1 件以上** 居ることを数で要求する (0 件なら ✗ = 上流を見に行く合図)。
//   ・アサーションは自分が設定した値でなく product の出力 (courseSel.value / state.js の course.name /
//     location.hash) を読む。
//   ・3 種を同じ述語で回し、投稿コースだけが落ちる形を露出させる。
//
// 使い方: bash run.sh check_bc4_coursekey.mjs
import { launch, newPage, setLang, appModule } from './lib.mjs';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };

const SAVED_NAME = 'BC4 保存コース';

const browser = await launch();
try {
  const { page, errors, benign } = await newPage(browser, {
    before: async (p) => { await p.addInitScript(() => { try { localStorage.setItem('rumicar.lang', 'ja'); } catch (e) {} }); },
  });

  const selValue = () => page.evaluate(() => document.getElementById('courseSel').value);
  const optValues = () => page.evaluate(() => [...document.querySelectorAll('#courseSel option')].map((o) => o.value));
  const courseName = () => appModule(page, 'js/state.js', (m) => m.course && m.course.name);
  // 共有 hash の c= を product が書いたまま読む (share.js の書式に合わせて復号する)。
  const hashCourse = () => page.evaluate(() => {
    const h = location.hash.replace(/^#!?/, '');
    for (const kv of h.split('&')) {
      const i = kv.indexOf('=');
      if (i > 0 && kv.slice(0, i) === 'c') { try { return decodeURIComponent(kv.slice(i + 1)); } catch (e) { return kv.slice(i + 1); } }
    }
    return null;
  });
  const fullHash = () => page.evaluate(() => location.hash);
  const optLabels = () => page.evaluate(() => [...document.querySelectorAll('#courseSel option')].map((o) => o.textContent));
  const appOrigin = () => page.evaluate(() => location.origin + location.pathname + location.search);
  const logText = () => page.evaluate(() => document.getElementById('log').textContent);
  // ⚠ hash だけが違う URL への goto は **同一ドキュメント内のハッシュ変更**になり、ページが読み直されない
  //   (前の状態が残ったまま「復元できた」ように見える＝偽の緑。改修前の実測で実際に踏んだ)。
  //   別ドキュメントを必ず挟んで、起動経路を頭から通す。localStorage は同一オリジンなので保存コースは残る。
  const openFresh = async (u) => {
    await page.goto('about:blank');
    await page.goto(u, { waitUntil: 'networkidle', timeout: 45000 });
  };

  // ── 母集団 ────────────────────────────────────────────────────────────────
  await page.waitForFunction(() => [...document.querySelectorAll('#courseSel option')].some((o) => o.value.startsWith('gh:')),
    null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  const opts0 = await optValues();
  const ghKeys = opts0.filter((v) => v.startsWith('gh:'));
  const presetKey = opts0.find((v) => !v.startsWith('gh:'));
  ok(ghKeys.length >= 1, `母集団: 投稿コースが一覧に ${ghKeys.length} 件 (0 件だと以降が空振りする)${ghKeys.length ? ' ' + JSON.stringify(ghKeys) : ' ／ ログ末尾: ' + JSON.stringify((await logText()).slice(-300))}`);
  ok(typeof presetKey === 'string' && presetKey.length > 0, `母集団: プリセットが一覧にある (${JSON.stringify(presetKey)})`);
  if (!ghKeys.length || !presetKey) throw new Error('母集団が揃わないため以降を実行しない (上流/配信を確認すること)');

  // ── 保存コースを本番 UI で 1 本作る (localStorage 直書きしない = CI-8) ──────────
  await page.click('#editToggle');
  await page.fill('#edName', SAVED_NAME);
  await page.click('#edSave');
  await page.waitForTimeout(300);
  await page.click('#editToggle');      // 編集を閉じる
  await page.waitForTimeout(300);
  const opts1 = await optValues();
  ok(opts1.includes(SAVED_NAME), `保存コースが一覧に入った (value=${JSON.stringify(SAVED_NAME)})`);

  // ── 3 種を同じ述語で往復させる ───────────────────────────────────────────────
  const targets = [
    { kind: 'プリセット', key: presetKey },
    { kind: '保存コース', key: SAVED_NAME },
    { kind: '投稿コース', key: ghKeys[0] },
  ];
  const shareUrls = [];
  for (const tg of targets) {
    console.log(`\n── ${tg.kind} ${JSON.stringify(tg.key)} ──`);
    await page.selectOption('#courseSel', tg.key);
    await page.waitForTimeout(1800);   // フィット判定が落ち着くまで
    const v0 = await selValue(), n0 = await courseName();
    ok(v0 === tg.key && typeof n0 === 'string' && n0.length > 0,
      `${tg.kind}: 選択が適用 (value=${JSON.stringify(v0)}・course.name=${JSON.stringify(n0)})`);

    // ① 言語切替で選択が保持される (走行中のコースも動かない)
    // ⚠ 「変わらないこと」だけを見ると **空振りする**: 言語切替の rebuildCourseList を丸ごと
    //   削除しても <select> は再構築されず value も course.name も不変で緑になる。
    //   ∴ 「一覧が実際に作り直された」証拠 (ラベルが現在言語へ変わった) を同じ往復で併せて要求する。
    const labJa = await optLabels();
    await setLang(page, 'en');
    const labEn = await optLabels();
    ok(labEn.length === labJa.length && JSON.stringify(labEn) !== JSON.stringify(labJa),
      `${tg.kind}: 言語切替で一覧が実際に作り直された (件数 ${labJa.length}→${labEn.length}・ラベル変化 ${JSON.stringify(labEn) !== JSON.stringify(labJa)})`);
    const vEn = await selValue(), nEn = await courseName();
    ok(vEn === tg.key, `${tg.kind}: ja→en で選択が保持される (value=${JSON.stringify(vEn)} / 期待 ${JSON.stringify(tg.key)})`);
    ok(nEn === n0, `${tg.kind}: ja→en で走行中のコースが変わらない (course.name=${JSON.stringify(nEn)})`);
    await setLang(page, 'ja');
    const vJa = await selValue(), nJa = await courseName();
    ok(vJa === tg.key, `${tg.kind}: en→ja で選択が保持される (value=${JSON.stringify(vJa)} / 期待 ${JSON.stringify(tg.key)})`);
    ok(nJa === n0, `${tg.kind}: en→ja で走行中のコースが変わらない (course.name=${JSON.stringify(nJa)})`);

    // ② 共有 hash には option value が載る
    const hc = await hashCourse();
    ok(hc === tg.key, `${tg.kind}: 共有 hash の c= が option value (c=${JSON.stringify(hc)} / 期待 ${JSON.stringify(tg.key)})`);
    shareUrls.push({ ...tg, name: n0, url: (await appOrigin()) + (await fullHash()) });
  }

  // ── ③ 共有 URL を開き直して復元されるか (同一プロファイル = 保存コースも見える) ────
  for (const tg of shareUrls) {
    console.log(`\n── 共有 URL 復元: ${tg.kind} ──`);
    await openFresh(tg.url);
    // 投稿コースは一覧に載るまで待つ必要がある (起動時の復元より後に読み込まれる)
    await page.waitForFunction((k) => document.getElementById('courseSel').value === k, tg.key, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const v = await selValue(), n = await courseName();
    ok(v === tg.key, `${tg.kind}: 共有 URL で選択が復元 (value=${JSON.stringify(v)} / 期待 ${JSON.stringify(tg.key)})`);
    ok(n === tg.name, `${tg.kind}: 共有 URL で走行中のコースが復元 (course.name=${JSON.stringify(n)} / 期待 ${JSON.stringify(tg.name)})`);
  }

  // ── ④ 後方互換: 旧い共有 URL (コース名で書かれたもの) が引き続き開ける ───────────
  const base = await appOrigin();
  const gh = shareUrls.find((t) => t.kind === '投稿コース');
  const pre = shareUrls.find((t) => t.kind === 'プリセット');
  for (const old of [
    { label: '旧形式・プリセット名', name: pre.name, wantName: pre.name, wantKey: pre.key },
    { label: '旧形式・投稿コースの JSON 名', name: gh.name, wantName: gh.name, wantKey: gh.key },
  ]) {
    console.log(`\n── ${old.label} ──`);
    const u = `${base}#v=1&c=${encodeURIComponent(old.name)}&lg=ja`;
    await openFresh(u);
    await page.waitForFunction((k) => document.getElementById('courseSel').value === k, old.wantKey, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const n = await courseName(), v = await selValue();
    ok(n === old.wantName, `${old.label}: 旧 URL でコースが復元 (course.name=${JSON.stringify(n)} / 期待 ${JSON.stringify(old.wantName)}・value=${JSON.stringify(v)})`);
  }

  // ── ⑤ 遅延復元が利用者の操作を上書きしないこと ──────────────────────────────
  // 投稿コースは起動時の共有復元より後に読み込まれるため、復元は後追いになる。その窓の中で
  // 利用者が手を動かしたら、**後から来た復元は何もしてはいけない**。ここでは最も失うものが大きい
  // 「✔適用 (エディタの結果を走行中へ反映)」を窓の中で行い、その結果が生き残ることを測る。
  // 一覧取得を故意に遅らせて窓を作る。キャッシュは product 自身の clearListCache() で外す。
  console.log('\n── ⑤ 読込中に ✔適用 → 遅延復元が上書きしないか ──');
  await appModule(page, 'js/loader.js', (m) => m.clearListCache());
  const DELAY_RE = /courses\/community\/index\.json/;
  await page.route(DELAY_RE, async (route) => { await new Promise((r) => setTimeout(r, 6000)); await route.continue(); });
  await page.goto('about:blank');
  // networkidle だと遅延させた取得を待ってしまい窓が消えるので domcontentloaded で入る。
  await page.goto(gh.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2500);        // 起動ランダムが適用され、共有コースが保留に入るまで
  const beforeApply = await courseName();
  ok(typeof beforeApply === 'string' && beforeApply.length > 0 && beforeApply !== gh.name,
    `⑤ 前提: 読込中はまだ共有コースになっていない (course.name=${JSON.stringify(beforeApply)} / 共有元 ${JSON.stringify(gh.name)})`);
  await page.click('#editToggle');
  await page.waitForTimeout(250);
  await page.click('#edApply');           // 名前は変えない = 一覧に同名の option が残る条件
  await page.waitForTimeout(500);
  const applied = await courseName();
  ok(applied === beforeApply, `⑤ 前提: ✔適用で走行中のコース名は変わらない (course.name=${JSON.stringify(applied)})`);
  await page.waitForFunction(() => [...document.querySelectorAll('#courseSel option')].some((o) => o.value.startsWith('gh:')),
    null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const afterLoad = await courseName();
  ok(afterLoad === applied,
    `⑤ 読込中に ✔適用したら遅延復元は上書きしない (course.name=${JSON.stringify(afterLoad)} / 期待 ${JSON.stringify(applied)}・共有元 ${JSON.stringify(gh.name)})`);
  await page.unroute(DELAY_RE);

  // ── ⑥ 見つからない共有コースは理由が 1 行出る (無言失敗にしない・AF2 の受け入れ基準) ────
  console.log('\n── ⑥ 見つからない共有コースの通知 ──');
  const missHead = await appModule(page, 'js/i18n.js', (m) => m.t('log.share.course.missing', { name: '\u0000' }).split('\u0000')[0]);
  ok(missHead.length > 5, `⑥ 通知の書き出しを配信中の t() から取得 (${JSON.stringify(missHead)})`);
  await openFresh(`${base}#v=1&c=${encodeURIComponent('存在しないコース BC4 検証用')}&lg=ja`);
  const notified = await page.waitForFunction((h) => document.getElementById('log').textContent.includes(h),
    missHead, { timeout: 30000 }).then(() => true).catch(() => false);
  ok(notified, `⑥ 見つからない共有コースの理由が 1 行出る (書き出し ${JSON.stringify(missHead)}・ログ末尾 ${JSON.stringify((await logText()).slice(-300))})`);

  ok(errors.length === 0, `JS/HTTP エラー 0 (${errors.length}: ${JSON.stringify(errors.slice(0, 3))}) / 想定内 ${benign.length}`);
} finally {
  await browser.close();
}
console.log(`\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗:\n  - ' + fails.join('\n  - ')); process.exit(1); }
console.log('結果: PASS');
