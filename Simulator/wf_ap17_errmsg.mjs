// wf_ap17_errmsg.mjs — Stage AP17「インタプリタのエラーメッセージ品質（実行時エラー行番号＋i18n 化）」常設ゲート。
// PLAN AP17・AP1_audit §AP17(api G5)。実行時エラーが (a)行番号なし (b)ja ハードコード だった問題の是正を
// **本番経路 buildController + buildApi + tickSlot** で機械検証する（再実装せず実インタプリタ/実表示層を呼ぶ・CI-8/CI-14）。
//
//   criterion ①: 実行時エラー全種で /行 \d+/ がマッチ ∧ 行番号が誤り箇所と一致（連続量=期待行との一致で測定）。
//   criterion ②: en モードでエラー文言が英語（i18n キー化＝interp.err.* が ja/en 非空・en 実レンダが期待英文）。
//   criterion ③: StepLimit 経路の実測（tickSlot で running: true→false ∧ ログ厳密1行）。
//   criterion ④: f0〜f3 不変 — 本ゲート対象外（インタプリタは物理エンジン非参照）。別途 wf_refreeze dry-run＋5参照ゲートで確認。
//
//   配線検査（CI-14 測定述語）: evaluator.js に `throw new Error(` が 0 件＝全エラー throw が RuntimeError/StepLimit
//     （＝i18n キー＋行番号機構）経由であることを機械保証。到達不能な防御 default（badStmt/badExpr/badOp）も同機構に載る。
import { readFileSync } from 'node:fs';
import { buildController } from './public/js/runner.js';
import { buildApi } from './public/js/api.js';
import { buildFromSpec } from './public/js/course.js';
import { DynCar } from './public/js/physics_dyn.js';
import { setLang, getLang } from './public/js/i18n.js';
import { MESSAGES } from './public/js/i18n/messages.js';
import { makeSlot, tickSlot } from './public/js/fleet.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };

const specs = JSON.parse(readFileSync(new URL('./public/data/courses.json', import.meta.url), 'utf8'));
const course = buildFromSpec(specs[0]);

// 1プログラムを本番経路で走らせ、実行時エラーを {err,key,line} で返す（正常時は {out}）。
function run(code, lang, ticks = 1) {
  const outs = [];
  const world = { car: new DynCar(course.start), walls: course.walls, start: course.start,
    log: (m) => outs.push(String(m)), _sensors: [], _pendingDelay: 0, _others: [] };
  try {
    const c = buildController(code, lang, buildApi(world));
    c.setup();
    for (let i = 0; i < ticks; i++) c.tick();
    return { out: outs.join('|') };
  } catch (e) { return { err: e.message || String(e), key: e.i18nKey, line: e.line }; }
}
const cLoop = (body) => `void setup(){} void loop(){ ${body} }`;

// ── 配線検査: evaluator.js に生 Error throw が残っていない（全て RuntimeError/StepLimit 経由）─────────
console.log('\n[AP17] 配線検査 — evaluator.js の全エラー throw が i18n キー＋行番号機構を通る');
{
  const evsrc = readFileSync(new URL('./public/js/interp/evaluator.js', import.meta.url), 'utf8');
  const rawErr = (evsrc.match(/throw new Error\(/g) || []).length;
  ok(rawErr === 0, `配線 evaluator.js の生 throw new Error は 0 件（実 ${rawErr}）＝全エラーが RuntimeError/StepLimit 経由`);
  // 8 core throw（Interp メソッド）が this.rt( 経由・applyBin の 2 が RuntimeError 経由であることを本数で確認。
  const rtCount = (evsrc.match(/this\.rt\(/g) || []).length;
  const reCount = (evsrc.match(/new RuntimeError\(/g) || []).length;
  ok(rtCount >= 8, `配線 this.rt( 呼出 ≥8（実 ${rtCount}）＝Interp メソッドの実行時 throw が行番号機構経由`);
  ok(reCount >= 2, `配線 new RuntimeError( ≥2（実 ${reCount}）＝applyBin(divZero/badOp) が行番号機構経由`);
}

// ── criterion ①: 実行時エラー全種で /行 \d+/ ∧ 行番号=誤り箇所 ──────────────────────────────
// 到達可能な実行時エラー 8 種を本番 buildController+tick で発火。err.line は setLang 非依存（構造値）。
// 「誤り箇所と一致」は誤り文を狙った行に置き、err.line===期待行 で測定する。
console.log('\n[AP17] criterion ① — 実行時エラー行番号（本番経路・/行 \\d+/ ∧ 行一致）');
setLang('ja');
const LINE_RE = /行\s*\d+/;
// 各ケース: {label, code, lang, wantLine, wantKey}。code は誤り文が wantLine 行に来るよう構成。
const cases = [
  { label: 'undefName',   code: 'x=1\ny=2\nprint(zzz)',                     lang: 'py', wantLine: 3, wantKey: 'interp.err.undefName' },
  { label: 'undefFunc',   code: 'a=1\nnope()',                             lang: 'py', wantLine: 2, wantKey: 'interp.err.undefFunc' },
  { label: 'notMethod',   code: 's="hi"\nprint(s.bogus())',               lang: 'py', wantLine: 2, wantKey: 'interp.err.notMethod' },
  { label: 'notIterable', code: 'n=5\nfor x in n:\n  print(x)',           lang: 'py', wantLine: 2, wantKey: 'interp.err.notIterable' },
  { label: 'badAssign',   code: 'a=1\n5=3',                               lang: 'py', wantLine: 2, wantKey: 'interp.err.badAssign' },
  { label: 'divZero',     code: 'a=1\nb=2\nprint(a/0)',                    lang: 'py', wantLine: 3, wantKey: 'interp.err.divZero' },
  { label: 'notCallable', code: 'void setup(){}\nvoid loop(){\n  int a[2]={1,2};\n  a[0]();\n}', lang: 'c', wantLine: 4, wantKey: 'interp.err.notCallable' },
  { label: 'divZeroMod',  code: 'a=1\nprint(5%0)',                         lang: 'py', wantLine: 2, wantKey: 'interp.err.divZero' },
];
for (const c of cases) {
  const r = run(c.code, c.lang);
  ok(r.err != null && LINE_RE.test(r.err), `① ${c.label}: /行 \\d+/ マッチ（実 ${JSON.stringify(r)})`);
  ok(r.line === c.wantLine, `① ${c.label}: 行番号=誤り箇所 ${c.wantLine}（実 line=${r.line})`);
  ok(r.key === c.wantKey, `① ${c.label}: i18n キー=${c.wantKey}（実 ${r.key})`);
}

// ── criterion ②: en モードでエラー文言が英語（i18n キー化）───────────────────────────────
console.log('\n[AP17] criterion ② — en レンダが英語 ∧ 全 interp.err.* キー ja/en 非空');
// (2a) カタログ完全性: interp.err.* 全キーに ja/en 非空。
const interpKeys = Object.keys(MESSAGES).filter(k => k.startsWith('interp.err.'));
ok(interpKeys.length >= 12, `②a interp.err.* キー数 ≥12（実 ${interpKeys.length})`);
for (const k of interpKeys) {
  const e = MESSAGES[k] || {};
  ok(e.ja != null && e.ja !== '' && e.en != null && e.en !== '', `②a ${k} は ja/en 両方非空`);
}
// (2b) en 実レンダ: 期待英文一致（日本語混入なし）。setLang('en') で本番経路のエラーを英語化。
setLang('en');
const JP_RE = /[぀-ヿ一-龯]/;   // ひらがな/カタカナ/漢字
const enExpect = [
  { code: 'print(zzz)',                 lang: 'py', want: /^Undefined variable\/name: zzz \(line 1\)$/ },
  { code: 'nope()',                     lang: 'py', want: /^Undefined function: nope \(line 1\)$/ },
  { code: 'print("x".bogus())',         lang: 'py', want: /^Not a method: \.bogus \(line 1\)$/ },
  { code: 'print(1/0)',                 lang: 'py', want: /^Cannot divide by zero \(line 1\)$/ },
  { code: 'n=5\nfor x in n:\n  print(x)', lang: 'py', want: /not iterable/ },
  { code: cLoop('int a[2]={1,2}; a[0]();'), lang: 'c', want: /not a function/ },
  { code: cLoop('while(1){ int x=1; }'), lang: 'c', want: /step limit exceeded/ },
];
for (const c of enExpect) {
  const r = run(c.code, c.lang);
  ok(r.err != null && c.want.test(r.err), `②b en レンダ ${c.want}（実 ${JSON.stringify(r)})`);
  ok(r.err != null && !JP_RE.test(r.err), `②b en レンダに日本語混入なし（実 ${JSON.stringify(r.err)})`);
  ok(r.err != null && /\(line \d+\)/.test(r.err), `②b en 行番号も英語表記 (line N)`);
}

// ── criterion ③: StepLimit 経路の実測（tickSlot で running: true→false ∧ ログ厳密1行）─────────
console.log('\n[AP17] criterion ③ — StepLimit 本番経路（tickSlot: running→false ∧ ログ1行）');
setLang('ja');
{
  const logs = [];
  const slot = makeSlot({ i: 0, lang: 'c', src: cLoop('while(1){ int x=1; }'), course, slotCount: 1, logFor: () => (m) => logs.push(String(m)) });
  slot.controller = buildController(slot.src, slot.lang, slot.hostEnv);
  slot.controller.setup();
  slot.running = true;
  const before = slot.running;
  tickSlot(slot, []);
  ok(before === true && slot.running === false, `③ StepLimit で running: true→false（実 before=${before} after=${slot.running})`);
  ok(logs.length === 1, `③ ログ厳密1行（実 ${logs.length} 行: ${JSON.stringify(logs)})`);
  ok(logs.length === 1 && LINE_RE.test(logs[0]) && /実行時エラー|ステップ上限/.test(logs[0]), `③ ログが実行時エラー＋行番号（実 ${JSON.stringify(logs[0])})`);
}

console.log(`\n[結果] pass=${pass} fail=${fail}`);
setLang('ja');   // 後始末（他ゲート連結時の言語状態を既定へ）
process.exit(fail ? 1 : 0);
