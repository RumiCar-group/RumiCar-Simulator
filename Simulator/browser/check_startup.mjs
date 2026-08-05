// RumiCar Simulator — 起動時間の実測ゲート (Stage AS2)
//
// 測るもの（知覚「起動が遅い」を測定述語へ・CI-14）
//   T_course : ナビゲーション開始 → **初回コース描画** までの ms。
//              判定点は本番コードが実際に打つ状態遷移そのもの＝`render()` が初回 drawCourse を
//              終えた直後に `#courseLoader` へ `hidden` を付ける瞬間 (main.js の _loaderHidden)。
//              検査側で「描画できたはず」を再実装しない（CI-9）。MutationObserver で拾うので
//              rAF ポーリングのような 1 フレーム(≒16ms)の量子化誤差が乗らない。
//   T_fcp    : First Contentful Paint（静的ローダーが出るまで＝体感の第一歩）
//   T_dcl    : DOMContentLoaded（= module graph の評価完了後に発火する＝JS 到着+パースの目安）
//   js       : JS リソースの本数 / 転送バイト / 最後の JS が届いた時刻
//
// 各回は **新しいコンテキスト**（＝空キャッシュ）で測る。初訪問が最も遅く、体感の問題はそこにある。
// RC_WARM=1 で同一コンテキスト再訪（キャッシュ有効）も測れる。
//
// 使い方:
//   bash run.sh check_startup.mjs                 # 既定 N=7 回・配信コンテナ直
//   RC_N=11 bash run.sh check_startup.mjs
//   RC_BUDGET=1200 bash run.sh check_startup.mjs  # 中央値の上限(ms)。超過で exit 1
//   RC_WARM=1 bash run.sh check_startup.mjs       # 2 回目以降キャッシュ有効で測る
//   RC_RTT=40 RC_BW=10 bash run.sh check_startup.mjs  # 往復遅延(ms)/帯域(Mbps)を CDP で再現
//   RC_JSON=path.json                             # 生の測定値を保存（before/after 比較用）
//
// なぜ遅延を再現するか: 配信コンテナ直（同一ホスト・RTT≒0）では **モジュール依存グラフの深さ**が
// ほぼ無コストになり、実利用者（RTT 20〜80ms）で効く要因が測れない。RTT を与えた条件も併記する。
// 終了コード: 0=予算内 / 1=予算超過 or 測定不能

import { launch, report, APP_URL, classify } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const N = Number(process.env.RC_N || 7);
const BUDGET = Number(process.env.RC_BUDGET || 0);   // 0 = 予算判定しない（計測のみ）
const WARM = process.env.RC_WARM === '1';
const RTT = Number(process.env.RC_RTT || 0);         // 往復遅延(ms)・0=無制限
const BW = Number(process.env.RC_BW || 0);           // 帯域(Mbps)・0=無制限

// ページ内に仕込む観測器。**本番コードには一切触れない**（検査側だけで完結させる）。
const PROBE = () => {
  const marks = {};
  window.__rcMarks = marks;
  const rec = (k, v) => { if (marks[k] == null) marks[k] = (v == null ? performance.now() : v); };
  try {
    // FCP は「観測した時刻」ではなく **エントリの startTime**（＝実際に描かれた時刻）を採る。
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') rec('fcp', e.startTime);
    }).observe({ type: 'paint', buffered: true });
  } catch (e) { /* paint timing 非対応ブラウザでは fcp が欠測になるだけ */ }
  document.addEventListener('DOMContentLoaded', () => rec('dcl'));
  // 起動直後に描かれるのは state.js の既定コースで、**確定のコース**は data/courses.json 到着後に
  // 差し替わる (main.js の loadPresets().then → rebuildCourseList/applyCourse)。利用者から見た
  // 「コースが確定した時刻」はこちら。#courseSel に選択肢が入った瞬間で拾う。
  const attachCourses = () => {
    const sel = document.getElementById('courseSel');
    if (!sel) return false;
    if (sel.options.length >= 2) { rec('coursesReady'); return true; }
    const mo = new MutationObserver(() => {
      if (sel.options.length >= 2) { rec('coursesReady'); mo.disconnect(); }
    });
    mo.observe(sel, { childList: true });
    return true;
  };
  const attach = () => {
    const el = document.getElementById('courseLoader');
    if (!el) return false;
    if (el.classList.contains('hidden')) { rec('course'); return true; }
    const mo = new MutationObserver(() => {
      if (el.classList.contains('hidden')) { rec('course'); mo.disconnect(); }
    });
    mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    return true;
  };
  let doneL = false, doneC = false;
  const tryAll = () => { if (!doneL) doneL = attach(); if (!doneC) doneC = attachCourses(); return doneL && doneC; };
  if (!tryAll()) {
    const mo2 = new MutationObserver(() => { if (tryAll()) mo2.disconnect(); });
    mo2.observe(document, { childList: true, subtree: true });
  }
};

const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const worst = (a) => Math.max(...a);
const f1 = (x) => (x == null ? 'n/a' : x.toFixed(1));

const browser = await launch();
const NET = (RTT > 0 || BW > 0) ? `RTT=${RTT}ms BW=${BW || '∞'}Mbps` : '無制限(同一ホスト)';
console.log(`\n== 起動時間 実測 (${WARM ? 'warm=キャッシュ有効' : 'cold=空キャッシュ'} × ${N} 回 / 回線 ${NET}) ==`);
console.log(`対象: ${APP_URL}\n`);

const runs = [];
let ctx = null;
for (let i = 0; i < N; i++) {
  // cold: 毎回 新しいコンテキスト = 空キャッシュ。warm: 同一コンテキストを使い回す。
  if (!WARM || !ctx) { if (ctx) await ctx.close(); ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { const s = r.status(); if (s >= 400 && !classify(s, r.url())) errors.push(`http ${s} ${r.url()}`); });
  await page.addInitScript(PROBE);
  if (RTT > 0 || BW > 0) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: RTT,
      downloadThroughput: BW > 0 ? (BW * 1e6) / 8 : -1,
      uploadThroughput: BW > 0 ? (BW * 1e6) / 8 : -1,
    });
  }
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // コース描画のマークが立つまで待つ（立たなければ measure 不能＝失敗として扱う）
  await page.waitForFunction(
    () => window.__rcMarks && window.__rcMarks.course != null && window.__rcMarks.coursesReady != null,
    null, { timeout: 25000 }).catch(() => {});
  const m = await page.evaluate(() => {
    const js = performance.getEntriesByType('resource').filter((r) => /\.js(\?|$)/.test(r.name));
    const nav = performance.getEntriesByType('navigation')[0] || {};
    return {
      marks: window.__rcMarks,
      jsCount: js.length,
      jsBytes: js.reduce((s, r) => s + (r.transferSize || 0), 0),
      jsDecoded: js.reduce((s, r) => s + (r.decodedBodySize || 0), 0),
      jsLast: js.length ? Math.max(...js.map((r) => r.responseEnd)) : null,
      load: nav.loadEventEnd || null,
      proto: nav.nextHopProtocol || '',
    };
  });
  runs.push({ ...m, errors });
  console.log(`  #${i + 1}  course=${f1(m.marks.course)}ms  ready=${f1(m.marks.coursesReady)}ms  fcp=${f1(m.marks.fcp)}ms`
    + `  jsLast=${f1(m.jsLast)}ms  js=${m.jsCount}本/${(m.jsBytes / 1024).toFixed(0)}KB(転送)`
    + `${errors.length ? '  ⚠ err=' + errors.length : ''}`);
  await page.close();
  if (!WARM) { await ctx.close(); ctx = null; }
}
if (ctx) await ctx.close();
await browser.close();

const ok0 = runs.filter((r) => r.marks.course != null);
const course = ok0.map((r) => r.marks.course);
const fcp = runs.map((r) => r.marks.fcp).filter((x) => x != null);
const dcl = runs.map((r) => r.marks.dcl).filter((x) => x != null);
const ready = runs.map((r) => r.marks.coursesReady).filter((x) => x != null);
const jsLast = runs.map((r) => r.jsLast).filter((x) => x != null);
const errTotal = runs.reduce((s, r) => s + r.errors.length, 0);

let pass = 0, fail = 0;
const ok = (label, cond, detail) => (report(label, cond, detail) ? pass++ : fail++);

console.log('');
ok(`測定成立 (course マークが全 ${N} 回で立つ)`, ok0.length === N, `${ok0.length}/${N}`);
if (ok0.length) {
  console.log(`  T_course  中央値 ${med(course).toFixed(1)}ms / 最悪 ${worst(course).toFixed(1)}ms  (N=${course.length})`);
  console.log(`  T_fcp     中央値 ${fcp.length ? med(fcp).toFixed(1) : 'n/a'}ms`);
  console.log(`  T_dcl     中央値 ${dcl.length ? med(dcl).toFixed(1) : 'n/a'}ms`);
  console.log(`  T_ready   中央値 ${ready.length ? med(ready).toFixed(1) : 'n/a'}ms  (courses.json 到着後の確定コース)`);
  console.log(`  jsLast    中央値 ${jsLast.length ? med(jsLast).toFixed(1) : 'n/a'}ms`
    + `   JS ${runs[0].jsCount}本 / 転送 ${(runs[0].jsBytes / 1024).toFixed(0)}KB / 実体 ${(runs[0].jsDecoded / 1024).toFixed(0)}KB`
    + `   proto=${runs[0].proto}`);
}
ok('起動中のエラー 0', errTotal === 0, errTotal ? runs.flatMap((r) => r.errors).slice(0, 3).join(' | ') : '0 件');
if (BUDGET > 0) ok(`T_course 中央値 ≤ ${BUDGET}ms`, ok0.length === N && med(course) <= BUDGET,
  ok0.length ? `${med(course).toFixed(1)}ms` : '測定不能');

if (process.env.RC_JSON) {
  writeFileSync(process.env.RC_JSON, JSON.stringify({ url: APP_URL, warm: WARM, n: N, net: NET, runs }, null, 2));
  console.log(`  生データ: ${process.env.RC_JSON}`);
}
console.log(`\n結果: PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
