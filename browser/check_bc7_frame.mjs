// check_bc7_frame.mjs — ライブ走行がフレーム予算に収まることを実ブラウザで測る (BC7)。
// ════════════════════════════════════════════════════════════════════════════
// 【何を守る数字か】旧基準 AP13「S4 µs/tick/台 ≤60」は絶対時間の代理量で、当時のホストの実測値を
//   丸めたものだった（本ホストでは v7.8.0 でも 60.6＝境界上・AW-3 (i)）。BC7 はこれを
//   「**FLEET.maxCars 台**を **UI が出せる最大の速度倍率**で走らせたとき、シミュレーション時刻が
//   実時間×速度倍率から遅れないこと」という実態へ置き換えた。本ゲートはその実態を**ライブ経路**
//   （requestAnimationFrame → integrateLive）で直接測る。ヘッドレスのレース経路は wf_bc7_budget.mjs。
//
// 【測定述語は代理量でなく導出した等価条件】main.js:487 は
//        const real = Math.min(0.05, (t - lastT) / 1000);
//   ∴ 1 フレームが 50 ms を超えた分だけ、シム時刻は実時間から**確定的に**遅れる。よって
//        遅れ率 ≡ Σ max(0, dtᵢ − 50ms) / 総経過時間
//   が「遅れ」そのもの（二値の「カクついた/カクつかない」ではなく連続量＝CI-14）。
//   二値の「>50ms フレームが 0 件」にしないのは、Xvfb+SwiftShader では単発の長フレームが
//   0〜2 回/5 秒 で揺れるため（BC7 の実測 24 実行）。連続量なら単発の影響が総量に埋もれる。
//
// 【母集団＝アプリが現に走る条件】(BC7 決定ログ)
//   画面 {広 1440×900, 狭 390×844}: 狭い画面は layoutHud が毎フレーム 2 回走る経路（BC-9 ⑦）。
//   条件 ①既定(卓上×dynamic) ②利用者が精密 v2 を選ぶ ③領域を fullscale にする(自動で v2)
//        ④勾配コース(架空峠・描画が重く frame() が毎回 integrateLive を呼ぶ＝BC-9 ②)
//   台数は product の入口 #carAdd で上限まで足す（上限で disabled になる＝main.js:1230）。
//   速度は product の UI #speed を **max 属性いっぱい**へ動かす（既定値でなく「出せる最大」で測る）。
//
// 【「負荷が消える向きの退行」を緑にしないための固定】フレーム間隔だけを見る検査は、
//   全車が止まる・▶ が効かない・速度倍率が反映されない といった **負荷が減る向きの退行で
//   より緑になる**。そこで時間を測るのと同じ往復で、product の出力から次を併せて固定する:
//     ・走行が現に進んでいる: 各車の ToF 表示 `.cc-dist`（main.js:1298）が計測窓の前後で変化した台数
//     ・速度倍率が product に届いている: `#speedv`（main.js:2553 が内部変数 speed から書く）の文字列
//       ＝ input を代入して読み返すのではなく、**アプリが自分で書いた値**を読む
//
// 【検出力】最後に、ページへ 1 フレームあたり 120 ms の負荷を注入したとき、同じ述語が
//   基準を**超える**ことを測る（product は触らない）。基準が動かないなら測定が無意味と判る。
// ════════════════════════════════════════════════════════════════════════════
import { launch, newPage, appModule, report } from './lib.mjs';

// 【2 つの基準の役割分担】
//   ・中央値（MED_MAX）＝**常態的な遅さ**を鋭く捕まえる。単発の停止では動かないのでノイズに強い。
//   ・遅れ率（LAG_MAX）＝停止も含めた**絶対の上限**。単発に反応するぶん、ノイズ床が下限を決める。
//
// 遅れ率の上限をいくつに置くかは、**本ハーネスのノイズ床**が決めている（利用者の許容値ではない）。
// 実測（BC7・計 32 標本）: 無負荷でも 50〜167ms の単発フレームがランダムな位置に 0〜4 本／5 秒現れ、
// 遅れ率は 0.000〜5.647% に散る。原因の切り分け済み — 長フレームの位置は計測窓の #5〜#269 に散らばり
// 先頭に偏らない（＝計測の段取りが作っているのではない）。`browser/README` のとおり Xvfb+SwiftShader は
// 実機 GPU より悲観側なので、この値は**下限保証**として読む。
//   → 上限 15%。実測の裾 5.647% に対し 2.7 倍の余裕（＝境界上の基準にしない）。
//     注入負荷 63% は基準の 4.2 倍なので検出力は残る（下の「検出力」で毎回測る）。
const LAG_MAX = 0.15;
// フレーム間隔 中央値の上限 ms。実測は全 8 条件で 16.7ms（=vsync 60Hz）。中央値は vsync の量子
// （16.7 / 33.3ms）しか取らないので、25 は 2 つの量子のちょうど中間＝連続量としての「境界上」ではない
// （1 段落ちれば 33.3ms で確実に赤）。既存 check_tags T6a と同じ水準。
const MED_MAX = 25;
const MIN_FRAMES = 200;      // 5 秒で最低これだけフレームが来ていること（空振り防止）
const SPAN = 5000;           // 計測窓 ms
const WARMUP = 1500;         // 立ち上がりは測らない ms

const SCREENS = [
  { id: '広 1440x900', width: 1440, height: 900 },
  { id: '狭 390x844', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
];
const CASES = [
  { id: '①既定 卓上×dynamic', course: 'オーバル', regime: 'tabletop', phys: null },
  { id: '②卓上×精密 v2', course: 'オーバル', regime: 'tabletop', phys: 'v2' },
  { id: '③fullscale（自動で v2）', course: '競技サーキット (フルスケール)', regime: 'fullscale', phys: null },
  { id: '④勾配 架空峠(中斜面)', course: '架空峠 ロング・ワインディング(中斜面)', regime: 'tabletop', phys: null },
];

let pass = 0, fail = 0; const fails = [];
const ok = (label, cond, detail) => { if (report(label, cond, detail)) pass++; else { fail++; fails.push(`${label} — ${detail}`); } };

const browser = await launch();
const maxCars = await (async () => {
  const { page } = await newPage(browser, { width: 1440, height: 900 });
  const v = await appModule(page, 'js/config.js', (m) => m.FLEET.maxCars);
  await page.close(); return v;
})();

// 1 条件を測る。burnMs>0 ならページに負荷を注入する（検出力の確認用）。
async function measure(sc, c, burnMs = 0) {
  const { page, errors } = await newPage(browser, { ...sc, path: '#c=' + encodeURIComponent(c.course) });
  await page.selectOption('#regimeSel', c.regime);
  if (c.phys) await page.selectOption('#optPhysMode', c.phys);
  for (let i = 0; i < maxCars + 2; i++) {
    if (await page.locator('#carAdd').isDisabled()) break;
    await page.click('#carAdd', { timeout: 5000 });
  }
  // 速度は「UI が出せる最大」へ。product の input 経路をそのまま使う。
  const speed = await page.evaluate(() => {
    const el = document.getElementById('speed');
    el.value = el.max; el.dispatchEvent(new Event('input', { bubbles: true }));
    // speedShown は **アプリが自分で書いた表示**（main.js:2553 が内部変数 speed から `x.x×` を書く）。
    // el.value の読み返しでは input リスナが壊れても緑になるので、product の出力側を見る。
    return { speedSet: Number(el.value), speedMax: Number(el.max),
             speedShown: (document.getElementById('speedv').textContent || '').trim() };
  });
  const env = await page.evaluate(async () => {
    const S = await import(new URL('js/state.js', location.href).href);
    return { cars: document.querySelectorAll('#fleetCols .carcol').length, course: S.course.name,
             mode: document.getElementById('optPhysMode').value, regime: document.getElementById('regimeSel').value };
  });
  await page.click('#run');
  const distAt = () => page.evaluate(() =>
    [...document.querySelectorAll('#fleetCols .cc-dist')].map((e) => e.textContent));
  if (burnMs > 0) await page.evaluate((ms) => {
    const burn = () => { const t = performance.now(); while (performance.now() - t < ms) { /* 負荷 */ }
      window.__bc7burn = requestAnimationFrame(burn); };
    window.__bc7burn = requestAnimationFrame(burn);
  }, burnMs);
  await page.waitForTimeout(WARMUP);
  const dist0 = await distAt();
  const raw = await page.evaluate(([span]) => new Promise((res) => {
    const d = []; let prev = performance.now(); const t0 = prev;
    const tick = (now) => { d.push(now - prev); prev = now;
      if (now - t0 < span) requestAnimationFrame(tick); else res({ d, total: now - t0 }); };
    requestAnimationFrame(tick);
  }), [SPAN]);
  const dist1 = await distAt();
  await page.close();
  const d = raw.d.slice(1);                                  // 1 本目は計測開始の境界なので捨てる
  const s = [...d].sort((a, b) => a - b);
  const lag = d.reduce((a, x) => a + Math.max(0, x - 50), 0);
  const span = d.reduce((a, x) => a + x, 0);                 // 分子と同じ標本の合計（捨てた 1 本を含めない）
  const moved = dist0.length === dist1.length
    ? dist0.reduce((a, v, i) => a + (v !== dist1[i] ? 1 : 0), 0) : -1;
  return { ...env, ...speed, n: d.length, err: errors.length, total: span, moved, nDist: dist0.length,
           med: s[s.length >> 1], p95: s[Math.min(s.length - 1, Math.round((s.length - 1) * 0.95))],
           max: s[s.length - 1], lagMs: lag, lagRate: lag / span };
}

console.log(`BC7 フレーム予算  上限台数 ${maxCars} 台・遅れ率 ≤${(LAG_MAX * 100).toFixed(0)}%・中央値 ≤${MED_MAX}ms`);
console.log('─'.repeat(78));
const seen = [];
for (const sc of SCREENS) {
  for (const c of CASES) {
    const r = await measure(sc, c);
    seen.push(r);
    const tag = `[${sc.id}] ${c.id}`;
    const det = `${r.course} / ${r.mode} / ${r.regime} / 車 ${r.cars} of ${maxCars} / 速度 ${r.speedSet}×(UI の max ${r.speedMax})`
      + ` — 中央値 ${r.med.toFixed(1)} p95 ${r.p95.toFixed(1)} 最悪 ${r.max.toFixed(1)}ms`;
    // 台数が届かないのは性能でなく**コース容量**の退行なので、ラベルでそう言う
    // （product の上限は carCap() = min(FLEET.maxCars, courseCapN)・main.js:97/1230）。
    ok(`${tag} 台数が上限まで足せた（届かないならコース容量の退行）`, r.cars === maxCars, det);
    ok(`${tag} 速度倍率が product に届いた`, r.speedShown === `${r.speedMax.toFixed(1)}×`,
       `UI へ ${r.speedSet}× を入れ、アプリが #speedv に「${r.speedShown}」と書いた（期待「${r.speedMax.toFixed(1)}×」）`);
    ok(`${tag} 走行が現に進んでいる`, r.moved >= 1,
       `計測窓の前後で ToF 表示が変化した車 ${r.moved}/${r.nDist} 台`
       + `（0 台＝全車停止でもフレーム間隔は緑になるので、ここで止める）`);
    ok(`${tag} 計測が空振りでない`, r.n >= MIN_FRAMES, `${r.n} フレーム / ${(r.total / 1000).toFixed(1)}s（下限 ${MIN_FRAMES}）`);
    ok(`${tag} シム時刻の遅れ率 ≤ ${(LAG_MAX * 100).toFixed(0)}%`, r.lagRate <= LAG_MAX,
       `遅れ ${r.lagMs.toFixed(1)}ms / ${(r.total / 1000).toFixed(1)}s = ${(r.lagRate * 100).toFixed(3)}%`
       + `  マージン ${r.lagRate > 0 ? (LAG_MAX / r.lagRate).toFixed(1) + '倍' : '上限まで丸ごと（遅れ 0）'}`);
    ok(`${tag} フレーム間隔 中央値 ≤ ${MED_MAX}ms`, r.med <= MED_MAX,
       `${r.med.toFixed(1)}ms  マージン ${(MED_MAX / r.med).toFixed(2)}倍`);
    ok(`${tag} pageerror / console error 0`, r.err === 0, `${r.err} 件`);
  }
}

// ── 検出力: 同じ述語が、負荷を掛けたときに基準を超えること ───────────────────
console.log('─'.repeat(78));
const burn = await measure(SCREENS[0], CASES[0], 120);
ok('検出力: 1 フレーム 120ms の負荷を注入すると遅れ率が基準を超える', burn.lagRate > LAG_MAX,
   `遅れ率 ${(burn.lagRate * 100).toFixed(1)}%（基準 ${(LAG_MAX * 100).toFixed(0)}% の ${(burn.lagRate / LAG_MAX).toFixed(0)} 倍）`
   + ` 中央値 ${burn.med.toFixed(1)}ms`);
const worst = seen.reduce((a, b) => (b.lagRate > a.lagRate ? b : a));
console.log(`\n無負荷の最悪: 遅れ率 ${(worst.lagRate * 100).toFixed(3)}%（${worst.course} / ${worst.mode}）`
          + ` → 基準まで ${(LAG_MAX / Math.max(worst.lagRate, 1e-9)).toFixed(1)} 倍の余裕`);

await browser.close();
console.log('─'.repeat(78));
console.log(`結果: PASS ${pass} / FAIL ${fail}`);
if (fail) for (const f of fails) console.log('  ✗ ' + f);
process.exit(fail === 0 ? 0 : 1);
