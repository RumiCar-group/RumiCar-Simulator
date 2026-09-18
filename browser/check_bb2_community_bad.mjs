// check_bb2_community_bad.mjs — 壊れた投稿コースが混じっても、正常な投稿と本体が壊れないこと (BB2)。
// ════════════════════════════════════════════════════════════════════════════
// 上流 (RumiCar-group/RumiCar の courses/community/) は投稿の中身を検査しない。一覧 (index.json) を作るだけで、
// 形式の壊れた JSON もそのまま並ぶ。起票時 (2026-09-15) の実測では、壊れた 1 本で投稿コースが一覧から全部消える・
// 選んでも黙って切り替わらず例外・描画エラーが出続ける、が起きた。ここではそれが二度と起きないことを固定する。
//
// 差し替えるのは **上流の応答だけ** (page.route)。product (loader.js / course.js / main.js) は本物がそのまま走る (CI-8)。
//   ・index.json … 上流の本物を取ってきて、その entries の **前と後ろ** に壊れた投稿を混ぜる
//   ・bad-*.json … コーパス wf_course_corpus.mjs の SHAPES の本文を返す。正常な投稿 (上流の実データ) は本物を取りに行く
//
// 形ごとの期待は BB2 の実装前に固定した (internal docs の決定ログ「BB2 着手前の固定」)。
// 判定:
//   ① 上流の正常な投稿が全件、一覧に残る／除外する形は一覧に無い／採用する形は一覧にある
//   ② pageerror・console error が 0
//   ③ 除外した件数とファイル名＋理由を 1 行で知らせる (ja/en それぞれ)。期待する行は、配信中の course.js の
//      checkCourseData に同じ本文を答えさせて理由を得て、配信中の i18n の t() で組み、ログの行と**完全一致**で比べる
//   ④ 一覧に載った投稿のうち採用する形を選び、▶ で走らせ (既定の物理と、⚙ の物理エンジン選択で v2 に切り替えた後の両方)、
//      編集表示を開閉しても、新しいエラー 0・XSS の印が立たない・ページが応答し続ける
//   ⑤ その後プリセットへ戻して ▶ で走り出す
//
// 使い方: bash run.sh check_bb2_community_bad.mjs
//         BB2_ONLY=bad-null.json bash run.sh check_bb2_community_bad.mjs   … 1 形だけ混ぜる (修正前の赤の確認用)
import { launch, newPage, setLang, appModule } from './lib.mjs';

// BC3 (2026-09-18): コーパスは wf_course_corpus.mjs へ出した (卓上ゲート wf_bc3_intake.mjs・
// 実ブラウザゲート check_bc3_intake.mjs と**同じ配列を読む**＝写しを作らない)。本ゲートが見るのは
// 投稿コースの経路なので、期待は std 側 (SHAPES の 3 つ目) をそのまま使う。
import { SHAPES } from '../wf_course_corpus.mjs';
const ONLY = process.env.BB2_ONLY;
const shapes = ONLY ? SHAPES.filter(([f]) => f === ONLY) : SHAPES;
if (!shapes.length) { console.log(`✗ BB2_ONLY=${ONLY} に合う形が無い`); process.exit(2); }
const BODY = Object.fromEntries(shapes.map(([f, b]) => [f, b]));
const half = Math.ceil(shapes.length / 2);
const before = shapes.slice(0, half).map(([f]) => f), after = shapes.slice(half).map(([f]) => f);

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };
const key = (f) => 'gh:' + f.replace(/\.json$/i, '');

let upstream = null;   // 上流の本物の entries (正常な投稿)
const route = (lang) => async (page) => {
  await page.addInitScript((l) => { try { localStorage.setItem('rumicar.lang', l); } catch (e) {} }, lang);
  await page.route('**/courses/community/index.json*', async (r) => {
    const res = await r.fetch();
    const j = await res.json();
    const names = (Array.isArray(j) ? j : j.entries).map((n) => (typeof n === 'string' ? n : n.name));
    upstream = names;
    await r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ generated: 'check_bb2', entries: [...before, ...names, ...after] }) });
  });
  await page.route('**/courses/community/bad-*', (r) => {
    const name = decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop());
    return r.fulfill({ status: 200, contentType: 'text/plain', body: BODY[name] ?? '' });
  });
};

const browser = await launch();
try {
  for (const lang of ['ja', 'en']) {
    console.log(`\n── ${lang} ──`);
    upstream = null;
    const { page, errors, benign } = await newPage(browser, { before: route(lang) });
    ok(Array.isArray(upstream) && upstream.length > 0, `上流の index.json を取得できた (正常な投稿 ${upstream ? upstream.length : 0} 件: ${JSON.stringify(upstream)})`);
    const good = (upstream || []).filter((n) => /\.json$/i.test(n));
    const keep = shapes.filter(([, , e]) => e === 'keep').map(([f]) => f);
    const drop = shapes.filter(([, , e]) => e === 'drop').map(([f]) => f);
    // 一覧が組まれるまで待つ (正常な投稿の最後の 1 件が出たら)
    const want = [...good, ...keep].map(key);
    await page.waitForFunction((w) => {
      const v = new Set([...document.querySelectorAll('#courseSel option')].map((o) => o.value));
      return w.every((k) => v.has(k));
    }, want, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(500);
    const opts = await page.evaluate(() => [...document.querySelectorAll('#courseSel option')].map((o) => ({ v: o.value, label: o.textContent })));
    const vals = new Set(opts.map((o) => o.v));

    // ①
    const missGood = good.map(key).filter((k) => !vals.has(k));
    ok(missGood.length === 0, `① 上流の正常な投稿が全件一覧に残る (欠け ${missGood.length}: ${JSON.stringify(missGood)})`);
    const leaked = drop.map(key).filter((k) => vals.has(k));
    ok(leaked.length === 0, `① 除外する形が一覧に無い (載ってしまった ${leaked.length}: ${JSON.stringify(leaked)})`);
    const missKeep = keep.map(key).filter((k) => !vals.has(k));
    ok(missKeep.length === 0, `① 採用する形が一覧にある (欠け ${missKeep.length}: ${JSON.stringify(missKeep)})`);
    const html = opts.find((o) => o.v === 'gh:bad-html');
    if (html) ok(html.label === '🌐 <img src=x onerror="window.__xss=1">BAD', `① HTML 入りの名前は文字のまま出る (label=${JSON.stringify(html.label)})`);

    // ③ 除外の告知: 期待する 1 行を product に組ませて、ログの行と完全一致で比べる。
    //    理由 = 配信中の checkCourseData の答え (JSON として読めないものは 'JSON')。並び = index.json の順。
    //    名前は先頭 BAD_SHOWN 件まで・残りは件数だけ (main.js loadCommunityCourses の告知の書式)。
    const log = await page.evaluate(() => document.getElementById('log').textContent);
    const logLines = log.split('\n').map((l) => l.replace(/^\[[^\]]*\]\s*/, ''));
    if (drop.length) {
      const order = [...before, ...after].filter((f) => drop.includes(f));
      const expected = await page.evaluate(async ({ order, body }) => {
        const course = await import(new URL('js/course.js', location.href).href);
        const i18n = await import(new URL('js/i18n.js', location.href).href);
        const BAD_SHOWN = 10;
        const why = (f) => { let d; try { d = JSON.parse(body[f]); } catch (e) { return 'JSON'; } return course.checkCourseData(d); };
        const reasons = order.map((f) => [f, why(f)]);
        const items = reasons.slice(0, BAD_SHOWN).map(([f, w]) => `${f} (${w})`).join(', ')
          + (reasons.length > BAD_SHOWN ? `, … (+${reasons.length - BAD_SHOWN})` : '');
        return { line: i18n.t('log.ghCoursesBad', { n: order.length, items }), lang: i18n.getLang(), nullReasons: reasons.filter(([, w]) => w === null).map(([f]) => f) };
      }, { order, body: BODY });
      ok(expected.lang === lang, `③ 画面の言語 ${expected.lang}`);
      ok(expected.nullReasons.length === 0, `③ 除外する形はすべて配信中の checkCourseData でも不合格 (合格してしまった ${JSON.stringify(expected.nullReasons)})`);
      const hits = logLines.filter((l) => l === expected.line);
      const near = logLines.filter((l) => l.includes(order[0]));
      ok(hits.length === 1, `③ 告知が期待の 1 行と完全一致 (${hits.length} 行)\n       期待: ${JSON.stringify(expected.line)}\n       近い行: ${JSON.stringify(near)}`);
    }

    // ② 読込直後
    ok(errors.length === 0, `② 読込直後の JS/HTTP エラー 0 (${errors.length}: ${JSON.stringify(errors.slice(0, 4))}) / 想定内 ${benign.length}`);

    if (lang === 'ja') {
      // ④ 一覧に載った bad-* を全部選ぶ (修正前の product では除外すべき形もここで選ばれる)。
      //    採用する形は ▶ で走らせ、編集表示を開閉する (選ぶだけでは v2 物理・編集グリッドの重さを見ない＝層 4 レビュー)。
      const ghBad = opts.filter((o) => o.v.startsWith('gh:bad-'));
      const preset = opts.find((o) => !o.v.startsWith('gh:') && !o.label.startsWith('★')).v;
      const runLabel = await appModule(page, 'js/i18n.js', (m) => m.t('hud.st.run'));
      // ページが応答するか (メインスレッドが止まっていれば evaluate が返らない)
      const alive = () => Promise.race([page.evaluate(() => 1).then(() => true), new Promise((r) => setTimeout(() => r(false), 15000))]);
      for (const o of ghBad) {
        const e0 = errors.length;
        await page.selectOption('#courseSel', o.v, { timeout: 20000 }).catch((e) => errors.push('select: ' + e.message));
        await page.waitForTimeout(1500);
        const sel = await alive();
        const xss = sel ? await page.evaluate(() => window.__xss ?? null) : 'no-response';
        const cur = sel ? await page.evaluate(() => document.getElementById('courseSel').value) : null;
        let ran = '—', mode = '—', edited = '—';
        if (sel && keep.map(key).includes(o.v)) {
          await page.click('#run');
          await page.waitForTimeout(2500);
          ran = (await alive()) ? await page.evaluate(() => document.getElementById('state').textContent) : 'no-response';
          mode = await appModule(page, 'js/config.js', (m) => `${m.PHYSICS.mode}/${m.REGIME_STATE.active}`).catch(() => '?');
          await page.click('#stop').catch(() => {});
          await page.waitForTimeout(300);
          // v2 (壁グリッドを常に作る物理) でも走らせる。選択欄は設定パネル内で隠れていることがあるので、
          // 値を入れて change を送る (走るのは main.js の本物の change ハンドラ)。終わったら元の物理へ戻す。
          const physBefore = await page.evaluate(() => document.getElementById('optPhysMode').value);
          await page.evaluate(() => { const el = document.getElementById('optPhysMode'); el.value = 'v2'; el.dispatchEvent(new Event('change', { bubbles: true })); });
          await page.waitForTimeout(500);
          await page.click('#run');
          await page.waitForTimeout(2500);
          const ranV2 = (await alive()) ? await page.evaluate(() => document.getElementById('state').textContent) : 'no-response';
          const modeV2 = await appModule(page, 'js/config.js', (m) => m.PHYSICS.mode).catch(() => '?');
          await page.click('#stop').catch(() => {});
          await page.waitForTimeout(300);
          await page.evaluate((v) => { const el = document.getElementById('optPhysMode'); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, physBefore);
          await page.waitForTimeout(400);
          ok(ranV2 === runLabel && modeV2 === 'v2', `④ ${o.v} を v2 物理でも ▶ で走らせられる (状態「${ranV2}」・物理 ${modeV2})`);
          await page.click('#editToggle');
          await page.waitForTimeout(1200);
          const ed = await alive();
          await page.click('#editToggle').catch(() => {});
          await page.waitForTimeout(400);
          edited = ed && (await alive()) ? 'ok' : 'no-response';
          ok(ran === runLabel && edited === 'ok', `④ ${o.v} で ▶ が走り (状態「${ran}」・物理/領域 ${mode})、編集表示の開閉にページが応答する (${edited})`);
        }
        ok(sel && errors.length === e0 && xss === null && cur === o.v,
          `④ ${o.v} を選んで新しいエラー 0・XSS の印なし・選択が保たれる (応答 ${sel} / 新エラー ${errors.length - e0}: ${JSON.stringify(errors.slice(e0, e0 + 3))} / xss=${xss} / value=${cur})`);
        if (!sel) break;   // 止まったページでは以降を測れない
      }
      // ⑤ プリセットへ戻して ▶
      const e0 = errors.length;
      await page.selectOption('#courseSel', preset);
      await page.waitForTimeout(800);
      await page.click('#run');
      await page.waitForTimeout(2500);
      const state = await page.evaluate(() => document.getElementById('state').textContent);
      ok(state === runLabel && errors.length === e0, `⑤ プリセット「${preset}」で ▶ → 状態「${state}」(期待「${runLabel}」)・新しいエラー ${errors.length - e0}`);
      await page.click('#stop');
      await page.waitForTimeout(300);
      ok(errors.length === 0, `② 全操作を通した JS/HTTP エラー 0 (${errors.length}: ${JSON.stringify(errors.slice(0, 4))})`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗:\n  - ' + fails.join('\n  - ')); process.exit(1); }
console.log('結果: PASS');
