// check_bf3_bundledrec.mjs — BF3「コース定義を同梱した公式イベントのコースレコード照合」の実ブラウザ検証
// ════════════════════════════════════════════════════════════════════════════
// 何を測るか:
//   外部の公式イベントは `course` にコース定義を同梱できる（W_spec §1）。同梱 def は `normalizeCourse` を通るので
//   出荷コースを同梱しても中心線・bank 等が落ち、練習記録の鍵（形）が出荷コースと一致しない＝練習ベストがあっても
//   公式の再実行（ローカル検証）の結果で「新記録」と出ていた（BE-2 (a)・改修前ツリーで実測）。
//   BF3 の実測（出荷 66 本 × 3 領域 × 3 エンジン）で、落ちる鍵が走りに効かないコース（卓上のオーバル等）と、
//   効くコース（峠・雨）があると分かったので、**同じ走りになると確かめられたときだけ**出荷コースの記録で引く。
// 本ゲートは利用者と同じ UI（🏆 公式 → 大会を選ぶ → ローカル再実行）だけで通す（CI-8）。差し替えるのは上流の応答だけ。
//   (1) 走りが一致するコース（オーバル・卓上）: 文字列参照の大会と同梱 def の大会で、結果の祝祭文（勝者バナー）が**同一**。
//   (2) 走りが一致しないコース（ウェットテクニカル (雨)・卓上）: 同梱 def の大会は従来どおり照合しない（「新記録」）。
//       文字列参照の大会は練習ベストで照合する（陽性対照＝仕込みが効いている）。
//   練習ベストは 3 車種とも仕込み、秒数はコースごとに変える（オーバル 999 秒・雨 777 秒＝どの車種が最速でも「更新」になり、
//   別の出荷コースの記録を引く取り違えは短縮秒数の違いで祝祭文に出る）。期待する文言は配信中の t() で組む。
// 使い方: bash run.sh check_bf3_bundledrec.mjs
import { launch, newPage, appModule } from './lib.mjs';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m, d = '') => { if (c) { pass++; console.log(`  ✓ ${m}${d ? ' — ' + d : ''}`); } else { fail++; fails.push(m); console.log(`  ✗ ${m}${d ? ' — ' + d : ''}`); } };

const SAME = 'オーバル', DIFF = 'ウェットテクニカル (雨)';
const CARS = ['normal_fr', 'normal_awd', 'normal_ff'];   // race_event.js の FILLER_POOL の先頭 3 台（エントリー 0 件＝補充 3 台）

const browser = await launch();
try {
  // 出荷コースの定義は配信中の course.js から取る（写さない）。1 枚目のページで組み立て、同梱 def として配る。
  const probe = await newPage(browser);
  const defs = await probe.page.evaluate(async ([a, b]) => {
    const crs = await import(new URL('js/course.js', location.href).href);
    const pick = (n) => JSON.parse(JSON.stringify(crs.PRESETS.map((f) => f()).find((c) => c.name === n)));
    return { [a]: pick(a), [b]: pick(b) };
  }, [SAME, DIFF]);
  await probe.page.close();
  ok(!!defs[SAME] && !!defs[DIFF], '出荷コース 2 本の定義を配信中の course.js から取れた');
  const ev = (id, course) => ({ id, title: 'BF3 ' + id, course, regime: 'tabletop', laps: 2, class: 'open', maxSec: 90, entryWindow: { open: '', close: '' } });
  const EVENTS = [['bf3-same-str', ev('bf3-same-str', SAME)], ['bf3-same-def', ev('bf3-same-def', defs[SAME])],
                  ['bf3-diff-str', ev('bf3-diff-str', DIFF)], ['bf3-diff-def', ev('bf3-diff-def', defs[DIFF])]];
  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const { page, errors, benign } = await newPage(browser, {
    before: async (p) => {
      await p.addInitScript(() => { try { localStorage.setItem('rumicar.lang', 'ja'); } catch (e) {} });
      await p.route(/api\.github\.com\/repos\/.*\/contents\/races\?/, (r) => r.fulfill(json(EVENTS.map(([id]) => ({ name: id, type: 'dir', path: `races/${id}` })))));
      for (const [id, e] of EVENTS) {
        await p.route(new RegExp(`raw\\.githubusercontent\\.com/.*/races/${id}/event\\.json$`), (r) => r.fulfill(json(e)));
        await p.route(new RegExp(`raw\\.githubusercontent\\.com/.*/races/${id}/entries/index\\.json$`), (r) => r.fulfill(json({ entries: [] })));
        await p.route(new RegExp(`raw\\.githubusercontent\\.com/.*/races/${id}/result\\.json$`), (r) => r.fulfill({ status: 404, contentType: 'text/plain', body: '404: Not Found' }));
      }
    },
  });
  const line = (key, params) => appModule(page, 'js/i18n.js', `(m) => m.t(${JSON.stringify(key)}, ${JSON.stringify(params || {})})`);
  // 練習ベストを product の鍵で仕込む（鍵の作り方は配信中の lap.js の practiceCourseId・形式は parseRec が読む {t,ver,cond}）。
  const seeded = await page.evaluate(async ([names, cars, T]) => {
    const [crs, lap, cfg] = await Promise.all(['course.js', 'lap.js', 'config.js'].map((f) => import(new URL('js/' + f, location.href).href)));
    const out = [];
    for (const n of names) {
      const c = crs.PRESETS.map((f) => f()).find((x) => x.name === n);
      for (const k of cars) { const key = 'rumicar.practiceShape.' + lap.practiceCourseId(c) + '::' + k;
        // コースごとに違う秒数 (層 4: 同じ秒数だと、別の出荷コースの記録を引く取り違えを祝祭文で区別できない)。
        localStorage.setItem(key, JSON.stringify({ t: T[n], ver: cfg.APP_VERSION, cond: {} })); out.push(!!lap.loadBestRec(c, k)); }
    }
    return out;
  }, [[SAME, DIFF], CARS, { [SAME]: 999, [DIFF]: 777 }]);
  ok(seeded.length === 6 && seeded.every(Boolean), '練習ベスト 2 コース × 3 車種を仕込み、出荷コースで読める', JSON.stringify(seeded));

  await page.click('#officialOpen'); await page.waitForTimeout(2500);
  const banner = async (id) => {
    await page.evaluate(() => { const d = document.getElementById('dlgRace'); if (d.open) d.close(); });
    await page.selectOption('#ofRace', id); await page.waitForTimeout(1200);
    await page.click('#ofVerify');
    await page.waitForFunction(() => document.getElementById('dlgRace').open, null, { timeout: 120000 });
    await page.waitForTimeout(300);
    const b = await page.evaluate(() => (document.querySelector('#dlgRace .race-winner-banner')?.textContent ?? null));
    const rec = await page.evaluate(() => (document.querySelector('#dlgRace .race-winner-banner .rw-record, #dlgRace .race-winner-banner .rw-fast')?.textContent ?? null));
    await page.evaluate(() => document.getElementById('dlgRace').close());
    return { b, rec };
  };
  const newHead = (await line('race.record.new', { name: '\u0000', time: '\u0000', gap: '' })).split('\u0000').filter(Boolean);
  const beatHead = (await line('race.record.beat', { name: '\u0000', time: '\u0000', gap: '\u0000' })).split('\u0000').filter(Boolean);
  const isNew = (s) => !!s && newHead.every((h) => s.includes(h));
  const isBeat = (s) => !!s && beatHead.every((h) => s.includes(h));

  console.log('\n── (1) 走りが一致するコース（' + SAME + '・卓上） ──');
  const s1 = await banner('bf3-same-str'), d1 = await banner('bf3-same-def');
  ok(isBeat(s1.rec), '(1) 文字列参照の大会は練習ベスト 999 秒を「更新」（陽性対照）', JSON.stringify(s1.rec));
  ok(s1.b != null && s1.b === d1.b, '(1) 同梱 def の大会の祝祭文が文字列参照の大会と同一', `同梱 ${JSON.stringify(d1.b)}`);

  console.log('\n── (2) 走りが一致しないコース（' + DIFF + '・卓上） ──');
  const s2 = await banner('bf3-diff-str'), d2 = await banner('bf3-diff-def');
  ok(isBeat(s2.rec), '(2) 文字列参照の大会は練習ベストで照合する（陽性対照）', JSON.stringify(s2.rec));
  ok(isNew(d2.rec), '(2) 同梱 def の大会は従来どおり照合しない（新記録）', JSON.stringify(d2.rec));

  console.log(`\n除外した想定内の応答: ${benign.length} 件`);
  ok(errors.length === 0, 'ページ側のエラー 0 件', errors.slice(0, 3).join(' / ') || '0 件');
} finally { await browser.close(); }
console.log(`\n${'─'.repeat(60)}\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗: ' + fails.join(' / ')); process.exitCode = 1; }
else console.log('結果: PASS (同梱コースの大会は、同じ走りになるときだけ出荷コースの練習ベストで照合する)');
