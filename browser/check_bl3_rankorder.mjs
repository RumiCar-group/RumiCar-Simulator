// check_bl3_rankorder.mjs — BL3 順位表（HUD 右上の leaderboard）の同周回内の並びの実ブラウザ検証 (headed Chrome on Xvfb)
// ════════════════════════════════════════════════════════════════════════════
// 何を測るか（PLAN BL3 ①・見た目で判定しない＝CI-14）:
//   順位表は「周回数の多い順 → 同じ周回数なら先に線を越えた車が上」であるべき。lap.js の lapTime は**現周回の経過時間**
//   （周回を数えた瞬間に 0 へ戻る）なので、同じ周回数なら lapTime が長い車ほど先に線を越えた＝前を走っている。
//   是正前（ad5ddd1〜f61d970＝v10.3.0）の hud.js drawFleetHud は同周回数を lapTime の**昇順**で並べ、後続車を 1 位に描いていた。
// 測り方（本番の UI だけで走らせる・CI-8）:
//   オーバルで ＋ により 2 台にし ▶ で走らせる（速度は既定 3×）。product の描画呼び出し drawFleetHud の fillText を
//   観測だけで記録し（描画は product のまま）、毎フレームの順位表の行（順位・名前・LAP 列）を読む。
//   **正解は lapTime を使わずに HUD の LAP 列だけから決める**: 各車の LAP 列が k になった最初のフレーム（＝k 周目を数えた
//   フレーム）を記録し、2 台の LAP が同じ L（≥1）のフレームでは、L になったのが早い車が前。ただし 2 台が同じフレームで
//   L になった（差が付かない）周回は判定対象から外す（母集団ガードで外した件数も出す）。
//     R1 判定できたフレーム（同じ LAP ≥1・越えたフレームが 2 以上離れている）が 30 以上（母集団ガード）
//     R2 そのすべてで 1 位の行が先に越えた車（違反 0）
//     R3 周回数が違うフレームでは LAP 列の大きい車が 1 位（既存の期待・是正前も緑）
//     R4 JS エラー 0 件
//   是正前は R2 が全フレーム赤（後続車が 1 位）。
// 使い方: cd browser && bash run.sh check_bl3_rankorder.mjs
import { launch, newPage, appModule } from './lib.mjs';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };

const COURSE = 'オーバル';
const RUN_MS = Number(process.env.BL3_RUN_MS || 40000);   // 走らせる実時間（3× でオーバル数周）

const browser = await launch();
const { page, errors, benign } = await newPage(browser, {
  width: 1440,
  before: async (p) => {
    await p.addInitScript(() => {
      try { localStorage.setItem('rumicar.lang', 'ja'); } catch (e) {}
      // 観測だけ: drawFleetHud の中の fillText の文字列を 1 回の描画ごとに束ねる（描画は product のまま）。
      window.__bl3 = null;
      const P = CanvasRenderingContext2D.prototype;
      const orig = P.fillText;
      const whoOf = () => (/at (draw[A-Za-z]+)/.exec(new Error().stack.split('\n').slice(2).join('\n')) || [])[1] || '?';
      P.fillText = function (txt, ...rest) {
        if (window.__bl3 && whoOf() === 'drawFleetHud') window.__bl3.cur.push(String(txt));
        return orig.call(this, txt, ...rest);
      };
      // 1 フレームごとに締める（rAF の先頭で前のフレームの記録を確定する）。
      const tick = () => {
        const s = window.__bl3;
        if (s && s.cur.length) { s.frames.push(s.cur); s.cur = []; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  },
});

// 順位表の見出しはページが現に読み込んでいる t() に答えさせる（写さない）。
const HEAD = await appModule(page, 'js/i18n.js', (m) => m.t('hud.lb.header'));
await page.waitForFunction((c) => [...document.querySelectorAll('#courseSel option')].some((o) => o.value === c), COURSE, { timeout: 30000 });
await page.selectOption('#courseSel', COURSE);
await page.waitForTimeout(800);
await page.click('#carAdd');
await page.waitForTimeout(400);
const nCols = await page.evaluate(() => document.querySelectorAll('#fleetCols .carcol').length);
ok(nCols === 2, `＋ で 2 台（列 ${nCols}）`);
const speed = await page.evaluate(() => document.getElementById('speed').value);
console.log(`  コース ${COURSE}・速度 ${speed}×・走行 ${RUN_MS / 1000} s（実時間）・見出し「${HEAD}」`);

await page.evaluate(() => { window.__bl3 = { cur: [], frames: [] }; });
await page.click('#run');
await page.waitForTimeout(RUN_MS);
const frames = await page.evaluate(() => { const f = window.__bl3.frames; window.__bl3 = null; return f; });
await page.click('#stop');
await page.waitForTimeout(250);

// 1 回の描画 = [見出し, (順位, 名前, LAP, BEST, 状態) × 台数, 注記…]。1 フレームに 2 回描かれていたら最後の 1 回を使う。
function parse(texts) {
  const k = texts.lastIndexOf(HEAD);
  if (k < 0) return null;
  const rows = [];
  for (let r = 0; r < nCols; r++) {
    const a = k + 1 + r * 5;
    if (a + 4 > texts.length - 1) return null;
    const [rank, name, lap] = [texts[a], texts[a + 1], texts[a + 2]];
    if (!/^\d+$/.test(rank) || !/^\s*\d+$/.test(lap)) return null;
    rows.push({ rank: +rank, name, lap: +lap.trim() });
  }
  return rows;
}
const snaps = frames.map(parse).filter((x) => x && x.length === nCols);
console.log(`  記録したフレーム ${frames.length}・読めた順位表 ${snaps.length}`);

// 各車の LAP 列が k になった最初のフレーム（lapTime を使わない正解）。
const reachedAt = new Map();   // name -> Map(lap -> frame index)
snaps.forEach((rows, i) => {
  for (const r of rows) {
    if (!reachedAt.has(r.name)) reachedAt.set(r.name, new Map());
    const m = reachedAt.get(r.name);
    if (!m.has(r.lap)) m.set(r.lap, i);
  }
});
let judged = 0, tieSkipped = 0, sameLap0 = 0, diffLap = 0;
const bad = [], badDiff = [];
const maxLap = Math.max(0, ...snaps.flat().map((r) => r.lap));
snaps.forEach((rows, i) => {
  const [a, b] = rows;   // a = 1 位の行
  if (a.lap !== b.lap) {
    diffLap++;
    if (a.lap < b.lap) badDiff.push(`#${i} 1 位 ${a.name} LAP ${a.lap} < ${b.name} LAP ${b.lap}`);
    return;
  }
  if (a.lap < 1) { sameLap0++; return; }
  const ta = reachedAt.get(a.name).get(a.lap), tb = reachedAt.get(b.name).get(b.lap);
  if (Math.abs(ta - tb) < 2) { tieSkipped++; return; }
  judged++;
  if (!(ta < tb)) bad.push(`#${i} LAP ${a.lap}: 1 位 ${a.name}（${ta} フレーム目に到達）・2 位 ${b.name}（${tb} フレーム目）`);
});
console.log(`  最大 LAP ${maxLap}・同周回で判定 ${judged}・同時到達で除外 ${tieSkipped}・LAP 0 同士 ${sameLap0}・周回数違い ${diffLap}`);
for (const [n, m] of reachedAt) console.log(`    ${n}: ${[...m].filter(([l]) => l >= 1).map(([l, f]) => `LAP ${l}@${f}`).join(' ')}`);

ok(judged >= 30, `R1 同周回（LAP ≥1）で先後が付いたフレームが 30 以上（${judged}）`);
ok(judged > 0 && bad.length === 0, `R2 同周回では先に線を越えた車が 1 位（違反 ${bad.length}/${judged}${bad.length ? ': ' + bad.slice(0, 3).join(' / ') : ''}）`);
ok(badDiff.length === 0, `R3 周回数が違えば LAP の大きい車が 1 位（違反 ${badDiff.length}/${diffLap}${badDiff.length ? ': ' + badDiff.slice(0, 3).join(' / ') : ''}）`);
ok(errors.length === 0, `R4 JS エラー 0 件 (実測 ${errors.length}${errors.length ? ': ' + errors.join(' | ') : ''})`);
if (benign.length) console.log(`  (想定内として除外した応答 ${benign.length} 件: ${benign.slice(0, 3).join(' | ')}${benign.length > 3 ? ' …' : ''})`);
await browser.close();

const line = '─'.repeat(64);
console.log('\n' + line);
console.log('BL3 順位表の同周回内の並び 実ブラウザゲート');
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log(line); for (const m of fails) console.log('  ✗ ' + m); }
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
