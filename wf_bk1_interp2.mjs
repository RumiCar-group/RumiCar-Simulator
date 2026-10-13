// wf_bk1_interp2.mjs — Stage BK「インタプリタ是正 II」の常設ゲート。BK1 で新設し、BK2〜BK5 が章を足す。
// ════════════════════════════════════════════════════════════════════════════
// 学習者が自力で原因に辿り着けないエラー（英語モードでも日本語・行番号の無い JS の RangeError・状況に合わない文言）の是正を、
//   本番経路 buildController(src, lang, buildApi(world)) → setup()/tick()（と fleet の tickSlot・race_engine の runRace）で
//   機械検証する（再実装しない・CI-8/CI-14）。Python の挙動に触れる期待値は python3 の実測を定数で持ち、python3 があるホストでは
//   同じ本文を `python3 -I` で走らせて突き合わせる（2026-10-13・Python 3.14.4 で実測）。無いホストでは定数だけで判定する。
//
// BK1（字句・構文エラー文言の i18n と再帰上限）— 是正前の木（HEAD e65643e＝v10.2.0）で `--root <木>` を付けて回すと、
//   A（ja の文言は同じだが i18nKey と line の構造値が無い・en は日本語）・B・C と、D・E の新しい述語が赤になる（D・E の従来の文言の行と
//   F は是正前と同じ値なので緑。2026-10-13 の実測: pass=33 fail=62）。
//   A) 字句エラー・構文エラーの全種。発生箇所は 11（lexer.js の `throw lexErr(` 4〔funcMacro・fstrBrace・unterminated・badChar〕・
//      parser_py.js の `err('…')` 4〔eat の expected・1 行の suite の unexpected・augTuple・primary の unexpected〕・parser_c.js の
//      `err('…')` 3〔eat の expected・caseDefault・primary の unexpected〕。本数はソースを数えて照合する）。各箇所を本番経路で起こし、
//      setLang('ja') の文言が是正前（e65643e で採った定数）と 1 文字も違わず、setLang('en') の文言が英語の定数と一致し（日本語を含まない）、
//      行（e.line と文言の行）が是正前と同じ値であることを見る。是正前は en でも日本語（BJ-16 F1）。
//   B) 配線: lexer.js・parser_c.js・parser_py.js（と evaluator.js・runner.js）に `throw new Error(` が 0 件（wf_ap17_errmsg の evaluator 向け
//      検査と同型）。ソースが参照する文言のキー（interp.lex.*・interp.syn.*・新しい interp.err.*）が全てカタログにあり ja/en とも非空。
//   C) 深い再帰: py・C の `f(n) = 1 + f(n-1)` の f(5000) が JS の RangeError を漏らさず interp.err.recursion（行＝再帰呼び出しの行・
//      ja/en・{n}＝SIM.maxCallDepth）。f(50) は 50。上限より先に JS のスタックが尽きる環境（子プロセスを --stack-size=150 で起動）でも
//      同じキーと行になる。エラーの後に入れ子の段数（interp.depth）が 0 に戻る。スタック切れでない RangeError は変換しない。
//      是正前は py・C とも RangeError「Maximum call stack size exceeded」（行番号なし）。python3 は f(5000) が RecursionError・f(50) が 50。
//   D) (30) ループの外の break／continue の文言: loop() を持つプログラム（Model A）の関数の直下に届いたときだけ従来の loop() 向けの
//      文言（BJ3／BJ6 の期待値のまま）。トップレベルと loop() を持たないプログラムの関数の直下は Generic 版（「loop() 関数そのものは」を
//      含まない）。種類（i18nKey）はどちらも breakOutside／continueOutside。是正前は 1 回だけ走るプログラムのトップレベルの continue にも
//      「loop() 関数そのものはループではありません (その回の loop() を終えるなら return)」が出た。
//   E) H1（人間判断・時刻の進み方は変えない）: その tick で millis()／micros() を呼んでいてステップ上限に達したときだけ、文言を
//      stepLimitTime（stepLimit の文言＋ヒント）にする。millis() を呼ばない無限ループ・前の tick や setup() だけで呼んだ場合は従来の文言と
//      1 文字も違わない。fleet の tickSlot の実行時エラーのログにもヒントが載る。種類（i18nKey）は stepLimit のまま。
//   F) 出荷 23 本（PROGRAMS）の不変: 1 台ずつ自分のコースで runRace（20 秒・trace）の verifyHash／traceHash／tick 数と、buildController で
//      300 tick 走らせた出力（print／Serial）の sha256 が是正前（e65643e）の定数と一致。出荷サンプルの呼び出しの入れ子の最大が上限以下。
//
// 使い方: node wf_bk1_interp2.mjs              … 検査
//         node wf_bk1_interp2.mjs --root <dir>  … <dir>/public/js の product で回す（改修前の木で赤になることの確認用）
// exit: 0=全緑 / 1=いずれか赤。
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const rootIdx = process.argv.indexOf('--root');
const ROOT = rootIdx >= 0 ? resolve(process.argv[rootIdx + 1]) : HERE;
const JS = join(ROOT, 'public/js');
const imp = (f) => import(pathToFileURL(join(JS, f)).href);
const { buildController } = await imp('runner.js');
const { buildApi } = await imp('api.js');
const { buildFromSpec } = await imp('course.js');
const { DynCar } = await imp('physics_dyn.js');
const { PROGRAMS } = await imp('programs.js');
const { setLang } = await imp('i18n.js');
const { MESSAGES } = await imp('i18n/messages.js');
const { makeSlot, tickSlot } = await imp('fleet.js');
const { SIM } = await imp('config.js');
const { runRace } = await imp('race_engine.js');
const { Interp } = await imp('interp/evaluator.js');
setLang('ja');

let pass = 0, fail = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? '○' : '✗'} ${msg}`); if (cond) pass++; else fail++; return cond; };
const J = (v) => JSON.stringify(v);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const JP_RE = /[぀-ヿ一-龯]/;   // ひらがな・カタカナ・漢字
const src = (f) => readFileSync(join(JS, f), 'utf8');

const specs = JSON.parse(readFileSync(join(ROOT, 'public/data/courses.json'), 'utf8'));
const course = buildFromSpec(specs[0]);
// 1 本を本番経路で走らせる。out＝print/Serial の出力行・err/key/line/params/ctor＝例外。simMs＝tick ごとに進めるシム時刻（millis()）。
function run(code, lang, ticks = 0, simMs = 0) {
  const out = [];
  const world = { car: new DynCar(course.start), walls: course.walls, start: course.start,
    log: (m) => out.push(String(m)), _sensors: [], _pendingDelay: 0, _others: [], _simMs: 0 };
  let ctrl = null;
  try {
    ctrl = buildController(code, lang, buildApi(world));
    ctrl.setup();
    for (let i = 0; i < ticks; i++) { world._simMs += simMs; ctrl.tick(); }
    return { out, ctrl };
  } catch (e) {
    return { out, ctrl, err: e && e.message != null ? e.message : String(e), key: e && e.i18nKey, line: e && e.line, params: e && e.i18nParams, ctor: e && e.constructor && e.constructor.name };
  }
}
// ja と en の両方で走らせる。
function runBoth(code, lang, ticks = 0, simMs = 0) {
  setLang('en'); const en = run(code, lang, ticks, simMs); setLang('ja');
  const ja = run(code, lang, ticks, simMs);
  return { ja, en };
}
const msgJa = (k) => (MESSAGES[k] ? MESSAGES[k].ja : undefined);
const msgEn = (k) => (MESSAGES[k] ? MESSAGES[k].en : undefined);

// python3（任意）。同じ本文を -I（隔離モード）で実行し、標準出力の行またはエラーの最後の行を返す。無ければ null。
const PY3 = (() => {
  const r = spawnSync('python3', ['-I', '-c', 'import sys; print(sys.version.split()[0])'], { encoding: 'utf8', timeout: 20000 });
  return r.error || r.status !== 0 ? null : r.stdout.trim();
})();
function py3(pySrc) {
  const r = spawnSync('python3', ['-I', '-W', 'ignore', '-c', pySrc], { encoding: 'utf8', timeout: 20000 });
  if (r.error || r.status !== 0) return { err: (r.error && r.error.message) || r.stderr.trim().split('\n').pop() };
  return { out: r.stdout.replace(/\n$/, '').split('\n') };
}
let py3Checked = 0;
function checkPy3(label, pySrc, want) {
  if (!PY3) return;
  const r = py3(pySrc); py3Checked++;
  ok(!r.err && J(r.out) === J(want), `${label}: python3 ${PY3} の出力 ${r.err ? 'ERR ' + r.err : J(r.out)} ＝ 定数 ${J(want)}`);
}
function checkPy3Err(label, pySrc, re) {
  if (!PY3) return;
  const r = py3(pySrc); py3Checked++;
  ok(!!r.err && re.test(r.err), `${label}: python3 ${PY3} も ${re} で止まる（実 ${r.err ? r.err : 'エラーなし ' + J(r.out)}）`);
}

console.log(`[BK1] wf_bk1_interp2 — product: ${JS}${ROOT === HERE ? '' : '（--root）'}`);
console.log(`  python3: ${PY3 ? PY3 + '（定数と同じ本文の実行結果を突き合わせる）' : '不在（定数＝2026-10-13 の Python 3.14.4 の実測で判定）'}`);

// ── A) 字句エラー・構文エラーの全種（ja は是正前と同一・en は英語・行は是正前と同じ）────────────────────────────
console.log('\nA) 字句・構文エラーの文言の i18n — 是正前（e65643e）: en モードでも日本語（BJ-16 F1）');
const cLoop = (body) => `void setup(){}\nvoid loop(){\n${body}\n}`;
// [ラベル, 言語, 本文, キー（interp.lex|syn.<sub>）, 行, ja（是正前の e65643e で採った文言）, en]
const SRC_ERR = [
  ['関数形式マクロ（C・#define の行）', 'c', 'int a;\n#define SQ(x) x*x\n' + cLoop(''), 'interp.lex.funcMacro', 2,
    "未対応の関数形式マクロ '#define SQ(...)' (行 2)", "Unsupported function-like macro '#define SQ(...)' (line 2)"],
  ['f-string の閉じ } が無い（py）', 'py', 'x = 5\ns = f"{x"', 'interp.lex.fstrBrace', 2,
    '字句エラー: f-string の { に対応する } がありません (行 2)', 'Lexical error: f-string { has no matching } (line 2)'],
  ['閉じていない文字列（py の "）', 'py', 'x = 1\ns = "abc', 'interp.lex.unterminated', 2,
    '字句エラー: 閉じていない文字列（" で始まる文字列の終わりの " がありません） (行 2)', 'Lexical error: unterminated string (the string that starts with " has no closing ") (line 2)'],
  ["閉じていない文字列（C の '）", 'c', cLoop("  char c = 'a;"), 'interp.lex.unterminated', 3,
    "字句エラー: 閉じていない文字列（' で始まる文字列の終わりの ' がありません） (行 3)", "Lexical error: unterminated string (the string that starts with ' has no closing ') (line 3)"],
  ['閉じていない文字列（py の f"""）', 'py', 'x = 1\n\ns = f"""{x}', 'interp.lex.unterminated', 3,
    '字句エラー: 閉じていない文字列（f""" で始まる文字列の終わりの """ がありません） (行 3)', 'Lexical error: unterminated string (the string that starts with f""" has no closing """) (line 3)'],
  ['不明な文字（py）', 'py', 'x = 1\ny = 2 @ 3', 'interp.lex.badChar', 2,
    "字句エラー: 不明な文字 '@' (行 2)", "Lexical error: unknown character '@' (line 2)"],
  ['不明な文字（C の #define の置換本体）', 'c', 'int a;\n#define S @\n' + cLoop(''), 'interp.lex.badChar', 2,
    "字句エラー: 不明な文字 '@' (行 2)", "Lexical error: unknown character '@' (line 2)"],
  ['eat の期待（py・probe の syntax err text）', 'py', 'x = (1', 'interp.syn.expected', 1,
    "構文エラー(Py): ')' を期待しましたが 'NEWLINE' (行 1)", "Syntax error (Py): expected ')' but got 'NEWLINE' (line 1)"],
  ['1 行の suite のキーワードの文の続き（py）', 'py', 'x = 1\nif x: break 5', 'interp.syn.unexpected', 2,
    "構文エラー(Py): 予期しないトークン '5' (行 2)", "Syntax error (Py): unexpected token '5' (line 2)"],
  ['複合代入のタプルの左辺（py）', 'py', 'a = 1\nb = 2\na, b += 1', 'interp.syn.augTuple', 3,
    "構文エラー(Py): 複合代入 '+=' の左辺に複数の変数（a, b のようなタプル）は書けません（1 つずつ代入してください） (行 3)",
    "Syntax error (Py): the left side of the compound assignment '+=' cannot be several variables (a tuple such as a, b); assign them one at a time (line 3)"],
  ['primary の予期しないトークン（py の ;）', 'py', 'a = 1; b = 2', 'interp.syn.unexpected', 1,
    "構文エラー(Py): 予期しないトークン ';' (行 1)", "Syntax error (Py): unexpected token ';' (line 1)"],
  ['eat の期待（C のキャスト）', 'c', cLoop('  float x = 3.7; int y = (int)x;'), 'interp.syn.expected', 3,
    "構文エラー(C): ';' を期待しましたが 'x' (行 3)", "Syntax error (C): expected ';' but got 'x' (line 3)"],
  ['switch の case/default（C）', 'c', cLoop('  switch (1) { x = 1; }'), 'interp.syn.caseDefault', 3,
    "構文エラー(C): case か default を期待しましたが 'x' (行 3)", "Syntax error (C): expected case or default but got 'x' (line 3)"],
  ['primary の予期しないトークン（C・probe の C syntax err text）', 'c', cLoop('  int x = ;'), 'interp.syn.unexpected', 3,
    "構文エラー(C): 予期しないトークン ';' (行 3)", "Syntax error (C): unexpected token ';' (line 3)"],
];
for (const [label, lang, code, key, line, wantJa, wantEn] of SRC_ERR) {
  const { ja, en } = runBoth(code, lang);
  ok(ja.err === wantJa && ja.line === line && ja.key === key,
    `A ${label}: ja ${J(ja.err)}・行 ${ja.line}・${ja.key}（期待 是正前と同じ ${J(wantJa)}・行 ${line}・${key}）`);
  ok(en.err === wantEn && en.line === line && en.key === key && !JP_RE.test(en.err || ''),
    `A ${label}: en ${J(en.err)}（期待 ${J(wantEn)}・日本語なし）`);
}
{ // 発生箇所の本数（ソースを数える）と、各 sub が上の表で起きていること（全種）。
  const lex = [...src('interp/lexer.js').matchAll(/throw lexErr\('([A-Za-z]+)'/g)].map((m) => m[1]);
  const py = [...src('interp/parser_py.js').matchAll(/(?<!function )\berr\('([A-Za-z]+)'/g)].map((m) => m[1]);
  const c = [...src('interp/parser_c.js').matchAll(/(?<!function )\berr\('([A-Za-z]+)'/g)].map((m) => m[1]);
  ok(lex.length === 4 && py.length === 4 && c.length === 3,
    `A 発生箇所の本数: lexer ${lex.length}・parser_py ${py.length}・parser_c ${c.length}（期待 4・4・3＝11）`);
  const covered = new Set(SRC_ERR.map((r) => r[3]));
  const want = [...lex.map((s) => 'interp.lex.' + s), ...py.map((s) => 'interp.syn.' + s), ...c.map((s) => 'interp.syn.' + s)];
  const miss = [...new Set(want)].filter((k) => !covered.has(k));
  ok(want.length === 11 && miss.length === 0, `A 発生箇所の全種（${[...new Set(want)].join('・')}）が表で起きている${miss.length ? '（未検査 ' + miss.join(', ') + '）' : ''}`);
  // 字句・構文エラーの line は構造値（setLang に依らない）・en の行の接尾は (line N)。
}

// ── B) 配線 ──────────────────────────────────────────────────────────────────
console.log('\nB) 配線 — 生の throw new Error( が 0 件・参照するキーが ja/en とも非空');
{
  const files = ['interp/lexer.js', 'interp/parser_c.js', 'interp/parser_py.js', 'interp/evaluator.js', 'runner.js'];
  const counts = files.map((f) => (src(f).match(/throw new Error\(/g) || []).length);
  ok(counts.every((n) => n === 0), `B ${files.join('・')} の throw new Error( は ${counts.join('・')} 件（期待 全て 0＝字句・構文・実行時エラーが i18n キー＋行番号の機構を通る）`);
  const keys = new Set(['interp.lex.head', 'interp.syn.head.py', 'interp.syn.head.c', 'interp.err.line']);
  for (const m of src('interp/lexer.js').matchAll(/lexErr\('([A-Za-z]+)'/g)) keys.add('interp.lex.' + m[1]);
  for (const f of ['interp/parser_py.js', 'interp/parser_c.js']) for (const m of src(f).matchAll(/(?<!function )\berr\('([A-Za-z]+)'/g)) keys.add('interp.syn.' + m[1]);
  const ev = src('interp/evaluator.js');
  for (const m of ev.matchAll(/(?:this\.rt|new RuntimeError)\(\s*'([A-Za-z]+)'/g)) keys.add('interp.err.' + m[1]);
  for (const m of ev.matchAll(/'(stepLimit[A-Za-z]*)'/g)) keys.add('interp.err.' + m[1]);
  const bad = [...keys].filter((k) => !(MESSAGES[k] && MESSAGES[k].ja && MESSAGES[k].en));
  ok(bad.length === 0 && keys.size >= 30, `B ソースが参照する文言のキー ${keys.size} 個が全てカタログにあり ja/en とも非空${bad.length ? '（欠け ' + bad.join(', ') + '）' : ''}`);
  const newKeys = ['interp.err.recursion', 'interp.err.breakOutsideGeneric', 'interp.err.continueOutsideGeneric', 'interp.err.stepLimitTime'];
  const enJp = [...keys].filter((k) => k.startsWith('interp.') && MESSAGES[k] && JP_RE.test(MESSAGES[k].en));
  ok(newKeys.every((k) => keys.has(k)) && enJp.length === 0, `B 新しい interp.err のキー 4 個がソースから参照され、interp.* の en に日本語が無い${enJp.length ? '（' + enJp.join(', ') + '）' : ''}`);
}

// ── C) 深い再帰 ────────────────────────────────────────────────────────────────
console.log('\nC) 深い再帰 — 是正前: py・C とも RangeError「Maximum call stack size exceeded」（行番号なし）');
const LIM = SIM.maxCallDepth;
ok(Number.isInteger(LIM) && LIM >= 3, `C 上限 SIM.maxCallDepth＝${LIM}（出荷サンプルの入れ子の最大〔F 章で実測〕以上）`);
const recPy = (n) => `def f(n):\n    if n == 0:\n        return 0\n    return 1 + f(n-1)\nprint(f(${n}))`;
const recC = (n) => `int f(int n){\n  if (n == 0) return 0;\n  return 1 + f(n-1);\n}\nvoid setup(){ print(f(${n})); }\nvoid loop(){}`;
const REC = [
  // [ラベル, 言語, 本文, tick 数, 再帰呼び出しの行]
  ['py f(5000)', 'py', recPy(5000), 0, 4],
  ['C f(5000)', 'c', recC(5000), 0, 3],
  ['py の loop() から呼んだ再帰（Model A・1 tick）', 'py', 'def g(n):\n  return g(n + 1)\ndef loop():\n  x = 1\n  g(0)', 1, 2],
  ['py の相互再帰（a→b→a）', 'py', 'def a(n):\n  return b(n)\ndef b(n):\n  return a(n)\na(1)', 0, 4],
];
for (const [label, lang, code, ticks, line] of REC) {
  const { ja, en } = runBoth(code, lang, ticks);
  ok(ja.key === 'interp.err.recursion' && ja.line === line && ja.params && ja.params.n === LIM && ja.ctor !== 'RangeError'
      && ja.err === msgJa('interp.err.recursion').split('{n}').join(String(LIM)) + ` (行 ${line})`,
    `C ${label} → interp.err.recursion（行 ${line}・n=${LIM}）（実 ${ja.ctor} ${J(ja.err)}・行 ${ja.line}）`);
  ok(en.key === 'interp.err.recursion' && en.err === msgEn('interp.err.recursion').split('{n}').join(String(LIM)) + ` (line ${line})` && !JP_RE.test(en.err),
    `C ${label}: en ${J(en.err)}`);
  ok(ja.ctrl && ja.ctrl.interp && ja.ctrl.interp.depth === 0, `C ${label}: エラーの後の入れ子の段数 interp.depth＝${ja.ctrl && ja.ctrl.interp ? ja.ctrl.interp.depth : '?'}（期待 0）`);
}
{
  const r50 = run(recPy(50), 'py'), c50 = run(recC(50), 'c');
  ok(!r50.err && J(r50.out) === J(['50']) && !c50.err && J(c50.out) === J(['50']), `C f(50) は正常に 50（py ${r50.err ? 'ERR ' + r50.err : J(r50.out)}・C ${c50.err ? 'ERR ' + c50.err : J(c50.out)}）`);
  checkPy3('C py f(50)', recPy(50), ['50']);
  checkPy3Err('C py f(5000)', recPy(5000), /^RecursionError: maximum recursion depth exceeded/);
  // 上限ちょうど: loop()／setup() を数えない Model C のトップレベルからの f(LIM - 1) は段数 LIM で通り、f(LIM) は LIM+1 段目で止まる。
  const atLim = run(recPy(LIM - 1), 'py'), over = run(recPy(LIM), 'py');
  ok(!atLim.err && J(atLim.out) === J([String(LIM - 1)]) && over.key === 'interp.err.recursion' && over.line === 4,
    `C 境目: f(${LIM - 1})（入れ子 ${LIM} 段）は ${atLim.err ? 'ERR ' + atLim.err : J(atLim.out)}・f(${LIM}) は ${over.key || over.err}（行 ${over.line}）`);
}
{ // スタック切れでない RangeError（toFixed の桁数）は再帰のエラーに変換しない（判定は call stack／too much recursion の文言だけ）。
  const r = run('def f():\n  return "%.200f" % 1.5\nprint(f())', 'py');
  ok(r.ctor === 'RangeError' && r.key !== 'interp.err.recursion', `C スタック切れでない RangeError（"%.200f" % 1.5）は変換しない（実 ${r.ctor} ${J(r.err)}）`);
}
{ // 上限より先に JS のスタックが尽きる環境: 子プロセスを --stack-size=150 で起動し、同じ本文が同じキー・行になる（RangeError が漏れない）。
  const child = `import { pathToFileURL } from 'node:url';
const JS = ${J(JS)};
const imp = (f) => import(pathToFileURL(JS + '/' + f).href);
const { buildController } = await imp('runner.js'); const { buildApi } = await imp('api.js');
const { DynCar } = await imp('physics_dyn.js'); const { buildFromSpec } = await imp('course.js'); const { setLang } = await imp('i18n.js');
const { readFileSync } = await import('node:fs');
setLang('ja');
const course = buildFromSpec(JSON.parse(readFileSync(${J(join(ROOT, 'public/data/courses.json'))}, 'utf8'))[0]);
const res = [];
for (const [lang, code] of ${J([['py', recPy(5000)], ['c', recC(5000)]])}) {
  const world = { car: new DynCar(course.start), walls: course.walls, start: course.start, log: () => {}, _sensors: [], _pendingDelay: 0, _others: [], _simMs: 0 };
  try { const c = buildController(code, lang, buildApi(world)); c.setup(); res.push({ ok: true }); }
  catch (e) { res.push({ ctor: e.constructor.name, key: e.i18nKey, line: e.line, n: e.i18nParams && e.i18nParams.n, msg: String(e.message).slice(0, 80) }); }
}
console.log(JSON.stringify(res));`;
  const r = spawnSync(process.execPath, ['--stack-size=150', '--input-type=module', '-e', child], { encoding: 'utf8', timeout: 60000 });
  let res = null; try { res = JSON.parse(r.stdout.trim().split('\n').pop()); } catch (e) { res = null; }
  const good = Array.isArray(res) && res.length === 2 && res[0].key === 'interp.err.recursion' && res[0].line === 4 && res[0].n < LIM
    && res[1].key === 'interp.err.recursion' && res[1].line === 3 && res[1].n < LIM;
  ok(good, `C スタックの小さい環境（--stack-size=150）: py・C の f(5000) → interp.err.recursion（行 4・3・n＜${LIM}＝スタック切れを変換した経路）（実 ${res ? J(res) : 'status ' + r.status + ' ' + (r.stderr || '').slice(0, 200)}）`);
}

// ── D) (30) ループの外の break／continue の文言 ─────────────────────────────────────────
console.log('\nD) (30) ループの外の break／continue — 是正前: 1 回だけ走るプログラムのトップレベルにも loop() 向けの文言');
const LOOP_NOTE_JA = 'loop() 関数そのものは', LOOP_NOTE_EN = 'loop() function itself';
// 従来の文言（BJ3/BJ6・e65643e）は変えない: カタログの値そのものを定数で照合する。
const OLD = {
  breakOutside: ['break はループ (for / while。C は switch も) の中に書いてください。loop() 関数そのものはループではありません。関数の中の break は、その関数を呼んだループには効きません',
    '\'break\' must be inside a loop (for / while, or a switch in C). The loop() function itself is not a loop, and a break inside a function does not affect the loop that called it'],
  continueOutside: ['continue はループ (for / while) の中に書いてください。loop() 関数そのものはループではありません (その回の loop() を終えるなら return)。関数の中の continue は、その関数を呼んだループには効きません',
    '\'continue\' must be inside a loop (for / while). The loop() function itself is not a loop (use return to end this pass of loop()), and a continue inside a function does not affect the loop that called it'],
};
ok(msgJa('interp.err.breakOutside') === OLD.breakOutside[0] && msgEn('interp.err.breakOutside') === OLD.breakOutside[1]
  && msgJa('interp.err.continueOutside') === OLD.continueOutside[0] && msgEn('interp.err.continueOutside') === OLD.continueOutside[1],
  'D 従来の breakOutside／continueOutside の文言（ja/en）はカタログで是正前のまま');
// [ラベル, 言語, 本文, tick 数, 種類, 行, loop() 向けか（true＝従来の文言そのもの・false＝Generic）, python3 の例外（null＝照合しない）]
const OUT = [
  ['Model C のトップレベルの continue（probe の (30)）', 'py', 'continue', 0, 'continueOutside', 1, false, /^SyntaxError: 'continue' not properly in loop/],
  ['Model C のトップレベルの break', 'py', 'x = 1\nbreak', 0, 'breakOutside', 2, false, /^SyntaxError: 'break' outside loop/],
  ['Model C の if の中の continue', 'py', 'if 1:\n  continue', 0, 'continueOutside', 2, false, /^SyntaxError: 'continue' not properly in loop/],
  ['Model C の関数の直下の break（loop() を持たない）', 'py', 'def f():\n  break\nf()', 0, 'breakOutside', 2, false, /^SyntaxError: 'break' outside loop/],
  ['Model B の while True: より前の continue', 'py', 'x = 1\ncontinue\nwhile True:\n  pass', 0, 'continueOutside', 2, false, /^SyntaxError: 'continue' not properly in loop/],
  ['Model B の本体から呼んだ関数の直下の break（1 tick）', 'py', 'def f():\n  break\nwhile True:\n  f()', 1, 'breakOutside', 2, false, /^SyntaxError: 'break' outside loop/],
  ['Model A のトップレベルの break', 'py', 'x = 1\nbreak\ndef loop():\n  pass', 0, 'breakOutside', 2, false, /^SyntaxError: 'break' outside loop/],
  ['C のトップレベルの break（Model A）', 'c', 'int x = 1;\nbreak;\nvoid setup(){}\nvoid loop(){}', 0, 'breakOutside', 2, false, null],
  ['Model A の def loop(): 直下の continue（BJ3 G-4）', 'py', 'def setup():\n  pass\ndef loop():\n  x = 1\n  continue', 1, 'continueOutside', 5, true, /^SyntaxError: 'continue' not properly in loop/],
  ['Model A の def loop(): 直下の break（BJ3 G-4）', 'py', 'def setup():\n  pass\ndef loop():\n  x = 1\n  break', 1, 'breakOutside', 5, true, /^SyntaxError: 'break' outside loop/],
  ['Model A の def loop(): の中の if x: break（BJ6 I-2）', 'py', 'def loop():\n  x = 1\n  if x: break', 1, 'breakOutside', 3, true, /^SyntaxError: 'break' outside loop/],
  ['Model A の def setup(): 直下の break（BJ3 G-4）', 'py', 'def setup():\n  break\ndef loop():\n  pass', 0, 'breakOutside', 2, true, /^SyntaxError: 'break' outside loop/],
  ['Model A の loop() の for から呼んだ関数の直下の continue（BJ3 G-4）', 'py', 'def f():\n  continue\ndef loop():\n  for i in range(2):\n    f()', 1, 'continueOutside', 2, true, /^SyntaxError: 'continue' not properly in loop/],
  ['C void loop(){ continue; }（BJ3 G-4）', 'c', 'void setup(){}\nvoid loop(){\n  continue;\n}', 1, 'continueOutside', 3, true, null],
];
for (const [label, lang, code, ticks, kind, line, note, py3re] of OUT) {
  const { ja, en } = runBoth(code, lang, ticks);
  const mk = note ? kind : kind + 'Generic';
  const wantJa = msgJa('interp.err.' + mk) + ` (行 ${line})`, wantEn = msgEn('interp.err.' + mk) + ` (line ${line})`;
  ok(ja.key === 'interp.err.' + kind && ja.line === line && ja.err === wantJa && en.err === wantEn && !JP_RE.test(en.err || '')
      && (note ? ja.err.includes(LOOP_NOTE_JA) && en.err.includes(LOOP_NOTE_EN) : !ja.err.includes(LOOP_NOTE_JA) && !en.err.includes(LOOP_NOTE_EN)),
    `D ${label} → ${kind}（行 ${line}）${note ? '・従来の loop() 向けの文言のまま' : '・「loop() 関数そのものは」を含まない'}（実 ja ${J(ja.err)}・en ${J(en.err)}）`);
  if (py3re && lang === 'py') checkPy3Err(`D ${label}`, ticks ? code + '\nloop()' : code, py3re);
}

// ── E) H1 ステップ上限の文言の millis() のヒント ───────────────────────────────────────
console.log('\nE) H1 ステップ上限の millis()／micros() のヒント — 時刻の進み方は変えない（是正前: ヒント無し）');
const STEP_OLD_JA = '評価ステップ上限超過 (無限ループの可能性)', STEP_OLD_EN = 'Evaluation step limit exceeded (possible infinite loop)';
ok(msgJa('interp.err.stepLimit') === STEP_OLD_JA && msgEn('interp.err.stepLimit') === STEP_OLD_EN, 'E 従来の stepLimit の文言（ja/en）はカタログで是正前のまま');
// [ラベル, 言語, 本文, tick 数, tick ごとのシム時刻 ms, 行, ヒント付きか]
const STEP = [
  ['py の t = millis() → while millis() - t < 100: pass（probe）', 'py', 't = millis()\nwhile millis() - t < 100:\n    pass\nprint(1)', 1, 50, 3, true],
  ['C の while (millis() - t < 100) {}（probe）', 'c', 'void setup(){\n  unsigned long t = millis();\n  while (millis() - t < 100) { }\n  print(1);\n}\nvoid loop(){}', 1, 50, 3, true],
  ['py の micros() のビジーウェイト', 'py', 't = micros()\nwhile micros() - t < 100000:\n    pass', 0, 0, 3, true],
  ['Model A の loop() の中の millis() のビジーウェイト（1 tick）', 'py', 'def loop():\n  t = millis()\n  while millis() - t < 100:\n    pass', 1, 50, 4, true],
  ['millis() を呼ばない無限ループ（py）', 'py', 'n = 0\nwhile n >= 0:\n    n += 1', 0, 0, 3, false],
  ['millis() を呼ばない無限ループ（C の loop()・AP17 の②b）', 'c', 'void setup(){} void loop(){ while(1){ int x=1; } }', 1, 0, 1, false],
  ['前の tick だけで millis() を呼んだ（2 tick 目の無限ループはヒント無し）', 'py', 'n = 0\ndef loop():\n  global n\n  n += 1\n  if n == 1:\n    t = millis()\n  if n == 2:\n    while True:\n      pass', 2, 50, 9, false],
  ['setup() だけで millis() を呼んだ（loop() の無限ループはヒント無し）', 'py', 'def setup():\n  t = millis()\ndef loop():\n  while True:\n    pass', 1, 50, 5, false],
  ['利用者が定義した millis()（ホストの時刻ではない）', 'py', 'def millis():\n  return 0\nwhile millis() < 100:\n  pass', 0, 0, 4, false],
  ['time.time() はヒントの対象外（PLAN は millis()／micros()）', 'py', 't = time.time()\nwhile time.time() - t < 1:\n  pass', 0, 0, 3, false],
];
for (const [label, lang, code, ticks, simMs, line, hint] of STEP) {
  const { ja, en } = runBoth(code, lang, ticks, simMs);
  const k = hint ? 'interp.err.stepLimitTime' : 'interp.err.stepLimit';
  const wantJa = msgJa(k) + ` (行 ${line})`, wantEn = msgEn(k) + ` (line ${line})`;
  const extra = hint ? (ja.err || '').startsWith(STEP_OLD_JA + '。') && /millis\(\)/.test(ja.err) && /delay\(\)/.test(ja.err) && (en.err || '').startsWith(STEP_OLD_EN + '. ')
    : ja.err === `${STEP_OLD_JA} (行 ${line})` && en.err === `${STEP_OLD_EN} (line ${line})`;
  ok(ja.key === 'interp.err.stepLimit' && ja.line === line && ja.err === wantJa && en.err === wantEn && !JP_RE.test(en.err || '') && extra,
    `E ${label} → stepLimit（行 ${line}）${hint ? '・末尾にヒント' : '・ヒント無し＝是正前と同一'}（実 ja ${J(ja.err)}）`);
}
{ // millis() の値（時刻の進み方）は変えない: Model A で tick ごとに 50 ms 進め、loop() の中の 2 回の millis() は同じ値。
  const r = run('def loop():\n  a = millis()\n  b = millis()\n  print(a, b)', 'py', 3, 50);
  ok(!r.err && J(r.out) === J(['50 50', '100 100', '150 150']), `E millis() の値は従来どおり（loop() 1 回の中で一定・tick ごとに進む）→ ${r.err ? 'ERR ' + r.err : J(r.out)}`);
}
{ // fleet の tickSlot（本番の ▶ 走行の 1 tick）: 実行時エラーのログにヒントが載り、車は止まる（running: true→false・ログ 1 行）。
  const logs = [];
  const code = 'void setup(){}\nvoid loop(){\n  unsigned long t = millis();\n  while (millis() - t < 100) { }\n}';
  const slot = makeSlot({ i: 0, lang: 'c', src: code, course, slotCount: 1, logFor: () => (m) => logs.push(String(m)) });
  slot.controller = buildController(slot.src, slot.lang, slot.hostEnv);
  slot.controller.setup();
  slot.running = true;
  tickSlot(slot, []);
  ok(slot.running === false && logs.length === 1 && logs[0].includes(msgJa('interp.err.stepLimitTime')) && logs[0].includes('(行 4)'),
    `E tickSlot: running ${slot.running}・ログ ${logs.length} 行 ${J(logs[0])}（期待 false・1 行・ヒント付き・行 4）`);
}

// ── F) 出荷 23 本の不変 ─────────────────────────────────────────────────────────
console.log('\nF) 出荷 23 本（PROGRAMS）— runRace の verifyHash／traceHash／tick 数・300 tick の出力が是正前（e65643e）と同じ');
// [key, 'verifyHash/traceHash/ticks'（自分のコース・regime・20 秒・trace・1 台）, 300 tick の出力の sha256 先頭 16]（e65643e で採った値）
const PIN = [
  ['normal_fr', '244e0d4a/91bd6835/839'], ['normal_awd', 'b2093638/814c6019/783'], ['normal_ff', 'd86310de/4513b630/1015'],
  ['drift_fr', '8f9fa3bc/c0fbdfac/1031'], ['drift_awd', 'a0463b46/2d5e52b8/772'], ['drift_ff', '076b0abc/0201fd47/1045'],
  ['py_normal_fr', '244e0d4a/91bd6835/839'], ['py_normal_awd', 'b2093638/814c6019/783'], ['py_normal_ff', 'd86310de/4513b630/1015'],
  ['showtime', '0811e6e8/7ec08755/1191'], ['zerocounter', '60c9df98/a9b1c82b/1200'], ['comp_demo', '8941d86a/03af9170/1200'],
  ['comp_launch', '8941d86a/2d57e001/1200'], ['comp_brake', '8941d86a/006dd0d1/1200'], ['comp_circuit', 'cbf8c3d6/a5beb586/1200'],
  ['comp_drift', 'b1c6f992/dcdf6e9f/1200'], ['comp_slip', 'b1c6f992/dcdf6e9f/1200'], ['comp_estimate', 'cbf8c3d6/a5beb586/1200'],
  ['recon_racer', 'cbf8c3d6/0c1c56a8/1200'], ['comp_localize', 'cbf8c3d6/0c1c56a8/1200'], ['recon_racer_c', 'cbf8c3d6/0c1c56a8/1200'],
  ['comp_localize_c', 'cbf8c3d6/0c1c56a8/1200'], ['strategist', 'cbf8c3d6/77c1c829/1200'],
];
const OUT_PIN = '129131c7aedd7e18';   // e65643e で採った値
{
  // 呼び出しの入れ子の最大を数える（観測だけ・返り値と例外はそのまま）。是正前の木には depth が無いので数えない。
  let maxDepth = 0;
  const orig = Interp.prototype.callUser;
  Interp.prototype.callUser = function (...a) { if (typeof this.depth === 'number' && this.depth + 1 > maxDepth) maxDepth = this.depth + 1; return orig.apply(this, a); };
  const bad = [];
  const outH = createHash('sha256');
  try {
    for (const p of PROGRAMS) {
      const sp = p.course ? specs.find((x) => x.name === p.course) : specs[0];
      const r = runRace({ course: buildFromSpec(sp), regime: p.regime || null, laps: 1, maxSec: 20, interact: false, trace: true,
        field: [{ name: 'A', lang: p.lang, src: p.code, carType: p.carType, rear: !!p.rear, encoder: !!p.encoder }] });
      const got = `${r.verifyHash}/${r.traceHash}/${r.ticks}`;
      const want = (PIN.find(([k]) => k === p.key) || [])[1];
      if (got !== want) bad.push(`${p.key} ${got}≠${want}`);
      const o = run(p.code, p.lang, 300, 1000 / SIM.loopHz);
      outH.update(p.key + '\u0000' + J(o.out) + '\u0000' + (o.err || '') + '\u0001');
    }
  } finally { Interp.prototype.callUser = orig; }
  ok(PROGRAMS.length === 23 && PIN.length === 23 && bad.length === 0, `F 23 本の runRace（verifyHash／traceHash／tick 数）が是正前と同じ${bad.length ? '（違い ' + bad.join('・') + '）' : ''}`);
  const oh = outH.digest('hex').slice(0, 16);
  ok(oh === OUT_PIN, `F 23 本の 300 tick の出力（print／Serial・エラー）の sha256 先頭 ${oh}（是正前 ${OUT_PIN}）`);
  ok(ROOT !== HERE || (maxDepth >= 1 && maxDepth <= LIM), `F 出荷 23 本の呼び出しの入れ子の最大 ${maxDepth} 段 ≤ 上限 ${LIM}`);
}

console.log(`\n  python3 との突き合わせ: ${PY3 ? py3Checked + ' 件' : '0 件（python3 不在）'}`);
console.log(`[結果] pass=${pass} fail=${fail}`);
setLang('ja');
process.exit(fail ? 1 : 0);
