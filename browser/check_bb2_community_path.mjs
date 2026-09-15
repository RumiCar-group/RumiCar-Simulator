// check_bb2_community_path.mjs — 投稿コースの正常経路を、上流の実データで最後まで通す (BB2)。
// ════════════════════════════════════════════════════════════════════════════
// 一覧 (上流の index.json) → 投稿コースを選ぶ → ▶ 走行開始 → 🏁 レース → 結果ダイアログ、を利用者と同じ UI 操作だけで行い、
// その間の JS エラーが 0 であることを見る。応答の差し替えは一切しない (CI-8)。
//
// ⚠ 上流に本当に壊れた投稿が入ると、product が正しく除外していても ① が赤になる (＝上流を見に行く合図として扱う)。
// ⚠ **上流に依存する**: RumiCar-group/RumiCar の courses/community/ を本物で読む。
//   ・一覧は raw.githubusercontent.com の index.json から読む (loader.js の listDirCached)。raw には未認証 API の
//     60 回/時の制限が無いので、通常このゲートはレート制限に掛からない。
//   ・index.json が取れないと loader は GitHub API へ落ち、API がレート制限 (403) だと一覧は空になる。そのときは
//     アプリが「取得できませんでした」の 1 行を出す (Q1[B])。**このゲートはそれを緑にしない**: 投稿コースが 1 件も
//     一覧に出なければ ✗ とし、ログの該当行を添えて「上流に届いていない」ことを示す。時間をおいて再実行すること。
//   ・上流の投稿が増えても、全件が一覧に出ることと、全件で ▶/🏁 が通ることを見る (件数は固定しない)。
//
// 使い方: bash run.sh check_bb2_community_path.mjs
import { launch, newPage, setLang, appModule } from './lib.mjs';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };

let upstream = null;
const browser = await launch();
try {
  const { page, errors, benign } = await newPage(browser, {
    // 差し替えではなく「上流が何を返したか」を記録するだけ (応答はそのまま通す)
    before: async (p) => {
      await p.addInitScript(() => { try { localStorage.setItem('rumicar.lang', 'ja'); } catch (e) {} });   // 起動時のログを ja で書かせる
      p.on('response', async (r) => {
        if (/\/courses\/community\/index\.json/.test(r.url()) && r.ok()) {
          try { const j = await r.json(); upstream = (Array.isArray(j) ? j : j.entries).map((n) => (typeof n === 'string' ? n : n.name)); } catch (e) { /* 記録失敗は下の ✗ で出る */ }
        }
      });
    },
  });
  await setLang(page, 'ja');
  const logText = () => page.evaluate(() => document.getElementById('log').textContent);

  // ① 一覧
  await page.waitForFunction(() => [...document.querySelectorAll('#courseSel option')].some((o) => o.value.startsWith('gh:')), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  const gh = await page.evaluate(() => [...document.querySelectorAll('#courseSel option')].filter((o) => o.value.startsWith('gh:')).map((o) => ({ v: o.value, label: o.textContent })));
  const log0 = await logText();
  ok(Array.isArray(upstream) && upstream.length > 0, `上流の index.json を取得 (${JSON.stringify(upstream)})`);
  ok(gh.length > 0, `① 投稿コースが一覧に出る (${gh.length} 件: ${JSON.stringify(gh)})${gh.length ? '' : ' ／ ログ末尾: ' + JSON.stringify(log0.slice(-300))}`);
  const wantKeys = (upstream || []).filter((n) => /\.json$/i.test(n)).map((n) => 'gh:' + n.replace(/\.json$/i, ''));
  const missing = wantKeys.filter((k) => !gh.some((o) => o.v === k));
  ok(missing.length === 0, `① 上流の投稿が全件一覧にある (欠け ${missing.length}: ${JSON.stringify(missing)})`);
  // 除外の告知の書き出し (件数の前まで) を配信中の t() から取り、その行がログに無いことを見る (言語に依らない)
  const badHead = await appModule(page, 'js/i18n.js', (m) => m.t('log.ghCoursesBad', { n: '\u0000' }).split('\u0000')[0]);
  ok(badHead.length > 5 && !log0.split('\n').some((l) => l.replace(/^\[[^\]]*\]\s*/, '').startsWith(badHead)),
    `① 上流の現行投稿に除外の告知が出ない (告知の書き出し ${JSON.stringify(badHead)})`);

  // ②〜④ 全件で 選択 → ▶ → 🏁
  await page.evaluate(() => { const c = document.getElementById('raceWatch'); if (c && c.checked) c.click(); });   // 観戦リプレイ OFF (結果だけ)
  const runLabel = await appModule(page, 'js/i18n.js', (m) => m.t('hud.st.run'));
  for (const o of gh) {
    console.log(`\n── ${o.v}「${o.label}」──`);
    const e0 = errors.length;
    await page.selectOption('#courseSel', o.v);
    await page.waitForTimeout(2500);   // フィット判定が落ち着くまで
    const applied = await page.evaluate(() => document.getElementById('courseSel').value);
    const name = await appModule(page, 'js/state.js', (m) => m.course && m.course.name);
    ok(applied === o.v && typeof name === 'string' && name.length > 0, `② 選択が反映 (value=${applied}・course.name=${JSON.stringify(name)})`);

    await page.click('#run');
    await page.waitForTimeout(3000);
    const state = await page.evaluate(() => document.getElementById('state').textContent);
    ok(state === runLabel, `③ ▶ で走り出す (状態「${state}」／期待「${runLabel}」)`);
    await page.click('#stop');
    await page.waitForTimeout(400);

    const t0 = Date.now();
    await page.click('#raceRun');
    const opened = await page.waitForFunction(() => !!document.getElementById('dlgRace')?.open, null, { timeout: 180000 }).then(() => true).catch(() => false);
    const rows = opened ? await page.evaluate(() => document.querySelectorAll('#raceResults tr').length) : 0;
    ok(opened && rows > 1, `④ 🏁 結果ダイアログが開き結果表に行がある (${opened}・行 ${rows}・${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    if (opened) { await page.click('#dlgRace .docdlg-x'); await page.waitForTimeout(300); }
    ok(errors.length === e0, `⑤ この投稿コースで新しい JS/HTTP エラー 0 (${errors.length - e0}: ${JSON.stringify(errors.slice(e0, e0 + 3))})`);
  }
  ok(errors.length === 0, `⑤ 全体の JS/HTTP エラー 0 (${errors.length}) / 想定内 ${benign.length}: ${JSON.stringify(benign.slice(0, 3))}`);
} finally {
  await browser.close();
}
console.log(`\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗:\n  - ' + fails.join('\n  - ')); process.exit(1); }
console.log('結果: PASS');
