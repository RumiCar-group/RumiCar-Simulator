// wf_ap16_semantics.mjs — Stage AP16「インタプリタのサイレント意味論乖離の解消」常設ゲート。
// PLAN AP16・AP1_audit §AP16(api G4)。学習者が自力解決できない「エラーが出ない罠」を是正した5点を
// **本番経路 buildController + buildApi** で機械検証する(再実装せず実インタプリタを呼ぶ・CI-8/CI-14)。
//
//   criterion ①(実装前固定): a[-1]→30 / 10<x<5→偽 / "ab"*2→"abab" / "x=%d"%5→"x=5" / 1/0→行番号付き実行時エラー
//   criterion ②: 出荷サンプル(PROGRAMS+SAMPLES)回帰 ERR 0
//   criterion ③: f0〜f3 不変(物理エンジン非参照ゆえ別途 5参照ゲートで確認・本ゲートはインタプリタ意味論のみ)
//   H項【制限明記・人間承認 2026-07-12】: C 整数除算は実装せず真除算のまま(7/2→3.5)。実機 C との既知の差を
//     docs/physics_model.md に明記。本ゲートは「C の / が真除算のまま」を回帰記録として固定する。
import { readFileSync } from 'node:fs';
import { buildController } from './public/js/runner.js';
import { buildApi } from './public/js/api.js';
import { buildFromSpec } from './public/js/course.js';
import { DynCar } from './public/js/physics_dyn.js';
import { PROGRAMS } from './public/js/programs.js';
import { SAMPLES } from './public/js/samples.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };

const specs = JSON.parse(readFileSync(new URL('./public/data/courses.json', import.meta.url), 'utf8'));
const defaultCourse = buildFromSpec(specs[0]);
const courseByName = (name) => buildFromSpec(specs.find(c => c.name === name) || specs[0]);
function makeWorld(course, { rear = false, encoder = false } = {}) {
  const car = new DynCar(course.start);
  const logs = [];
  return { car, walls: course.walls, start: course.start, log: (m) => logs.push(String(m)), logs,
    _sensors: [], _pendingDelay: 0, _others: [], rear, encoder };
}

// 1プログラムを本番経路で走らせ、Serial/print 出力(結合)を返す。error は {err} で返す。
// C は setup()+loop() 規約ゆえ、被検式は loop 側に置く(setup のみだと tick で走らない)。
function run(code, lang, ticks = 1) {
  const world = makeWorld(defaultCourse);
  const outs = [];
  world.log = (m) => outs.push(String(m));
  try {
    const ctrl = buildController(code, lang, buildApi(world));
    ctrl.setup();
    for (let i = 0; i < ticks; i++) ctrl.tick();
    return { out: outs.join('|') };
  } catch (e) { return { err: e.message || String(e) }; }
}
const pyMain = (body) => body;                                   // py はトップレベルがそのまま走る
const cLoop = (body) => `void setup(){} void loop(){ ${body} }`;  // C は loop に被検式

console.log('\n[AP16] インタプリタ サイレント意味論乖離の解消 — criterion ①(本番 buildController)');

// ── criterion ①: 5 サイレント乖離の是正 ────────────────────────────────────────────
// ① py 負インデックス a[-1] → 末尾(30)
ok(run(pyMain('a=[10,20,30]\nprint(a[-1])'), 'py').out === '30', `① py a[-1] → 30 (実 ${JSON.stringify(run(pyMain('a=[10,20,30]\nprint(a[-1])'), 'py'))})`);
ok(run(pyMain('a=[10,20,30]\nprint(a[-2])'), 'py').out === '20', `① py a[-2] → 20`);
ok(run(pyMain('s="hello"\nprint(s[-1])'), 'py').out === 'o', `① py str[-1] → o`);
// ② py 連鎖比較 10<x<5 → 偽(Python: (10<x) and (x<5))。真の連鎖 3<x<9 → 真も確認。
ok(run(pyMain('x=7\nif 10<x<5:\n  print(1)\nelse:\n  print(0)'), 'py').out === '0', `② py 10<x<5 → 偽`);
ok(run(pyMain('x=5\nif 3<x<9:\n  print(1)\nelse:\n  print(0)'), 'py').out === '1', `② py 3<x<9 → 真(連鎖成立)`);
// ③ py 文字列反復 "ab"*2 → "abab"(数値*文字列も)
ok(run(pyMain('print("ab"*2)'), 'py').out === 'abab', `③ py "ab"*2 → abab`);
ok(run(pyMain('print(3*"xy")'), 'py').out === 'xyxyxy', `③ py 3*"xy" → xyxyxy`);
// ④ py 文字列フォーマット "x=%d"%5 → "x=5"(タプルも)
ok(run(pyMain('print("x=%d"%5)'), 'py').out === 'x=5', `④ py "x=%d"%5 → x=5`);
ok(run(pyMain('print("%d-%d"%(3,4))'), 'py').out === '3-4', `④ py "%d-%d"%(3,4) → 3-4`);
ok(run(pyMain('print("%s!"%"go")'), 'py').out === 'go!', `④ py "%s!"%"go" → go!`);
// ⑤ 1/0 → 行番号付き実行時エラー(py も C も)。/行 \d+/ がマッチ ∧ 出力(Infinity)を出さない。
{
  const rpy = run(pyMain('print(1/0)'), 'py');
  ok(rpy.err != null && /行\s*\d+/.test(rpy.err), `⑤ py 1/0 → 行番号付きエラー (実 ${JSON.stringify(rpy)})`);
  const rc = run(cLoop('int z=1/0;'), 'c');
  ok(rc.err != null && /行\s*\d+/.test(rc.err), `⑤ C 1/0 → 行番号付きエラー (実 ${JSON.stringify(rc)})`);
  const rmod = run(pyMain('print(5%0)'), 'py');
  ok(rmod.err != null && /行\s*\d+/.test(rmod.err), `⑤ py 5%0(0剰余) → 行番号付きエラー`);
}

// ── H項の回帰記録(制限明記): C の / は真除算のまま(実装しない選択を固定) ────────────────
console.log('\n[AP16] H項 回帰記録 — C 整数除算は非実装(真除算)・C 連鎖比較は左結合を維持');
ok(run(cLoop('Serial.println(7/2);'), 'c').out === '3.5', `H C 7/2 → 3.5(真除算=非実装・docs 明記)`);
ok(run(pyMain('print(5/2)'), 'py').out === '2.5', `H py 5/2 → 2.5(真除算)`);
// C の 10<x<5 は左結合 ((10<x)<5)=(1<5)=真 のまま(parser_c 無改変・連鎖比較は py 限定)。
ok(run(cLoop('int x=7; if(10<x<5){ Serial.println(1); } else { Serial.println(0); }'), 'c').out === '1',
  `H C 10<x<5 → 真(左結合 (10<x)<5 を維持=C 意味論)`);
// AS4 H項 回帰記録【意味論の意図的な差・利用者裁定 2026-08-04】: sizeof は「葉要素の総数」モデル。
//   実機 Arduino はバイト数を返すが、そのバイト数自体がボード依存 (sizeof(int) は AVR=2/ESP32=4) で
//   一意でないため、定石 sizeof(a)/sizeof(a[0]) が要素数になる側を採った。差は docs/physics_model.md
//   (ja/en) とアプリ内 spec.lang.subset に明記済。ここは「その選択が変わっていないこと」の回帰記録。
ok(run(cLoop('int a[4]={1,2,3,4}; Serial.println(sizeof(a));'), 'c').out === '4',
  `H C sizeof(a) → 4 (葉要素の総数モデル=実機のバイト数ではない・docs 明記)`);
ok(run(cLoop('int a[4]={1,2,3,4}; Serial.println(sizeof(a)/sizeof(a[0]));'), 'c').out === '4',
  `H C sizeof(a)/sizeof(a[0]) → 4 (Arduino の定石が要素数として成立)`);
ok(run(cLoop('int m[2][3]; Serial.println(sizeof(m)/sizeof(m[0]));'), 'c').out === '2',
  `H C 2 次元でも sizeof(m)/sizeof(m[0]) → 行数 2`);

// ── criterion ②: 出荷サンプル(PROGRAMS + SAMPLES)回帰 ERR 0 ──────────────────────────
console.log('\n[AP16] criterion ② — 出荷サンプル回帰(本番 buildController+setup+400tick+物理step)');
const TICKS = 400;
let nOk = 0, nErr = 0; const errs = [];
for (const p of PROGRAMS) {
  const course = p.course ? courseByName(p.course) : defaultCourse;
  const world = makeWorld(course, { rear: p.rear, encoder: p.encoder });
  world.car.type = p.carType;
  try {
    const ctrl = buildController(p.code, p.lang, buildApi(world));
    ctrl.setup();
    for (let i = 0; i < TICKS; i++) { ctrl.tick(); for (let k = 0; k < 3; k++) world.car.step(1 / 60); }
    nOk++;
  } catch (e) { nErr++; errs.push(`PROGRAMS[${p.key}] ${e.message || e}`); }
}
for (const [lang, code] of Object.entries(SAMPLES)) {
  const world = makeWorld(defaultCourse);
  try {
    const ctrl = buildController(code, lang, buildApi(world));
    ctrl.setup();
    for (let i = 0; i < TICKS; i++) { ctrl.tick(); for (let k = 0; k < 3; k++) world.car.step(1 / 60); }
    nOk++;
  } catch (e) { nErr++; errs.push(`SAMPLES[${lang}] ${e.message || e}`); }
}
for (const e of errs) console.log('   ! ' + e);
ok(nErr === 0, `② 出荷サンプル ERR=0 (実 OK=${nOk} ERR=${nErr})`);
console.log(`   出荷サンプル計 ${nOk + nErr} 件: OK=${nOk} ERR=${nErr}`);

console.log(`\n[結果] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
