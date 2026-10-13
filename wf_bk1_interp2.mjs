// wf_bk1_interp2.mjs — Stage BK「インタプリタ是正 II」の常設ゲート。BK1 で新設し、BK2〜BK5 が章を足す（BK2＝G 章・BK3＝H 章・BK4＝I 章）。
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
// BK2（Python 構文の穴 I・py だけ）— 是正前の木（06d65ab）で `--root <木>` を付けて回すと G 章（是正前と同じ形の行を除く）と A 章の BK2 新設の
//   3 本・本数が赤になる（2026-10-13 の実測: pass=242 fail=123＝赤は A 章の 8〔新設 3 本の ja/en・本数・全種〕と G 章だけ・A〜F の BK1 の述語は緑）。A 章: `x = (1`（閉じていない括弧になった）と
//   `a = 1; b = 2`（`;` を受理した）の 2 本を、是正前と同じ文言・行の別の本文に差し替え、parser_py の BK2 の新しい構文エラー
//   （unclosed・augList・bytes）を足した（発生箇所は parser_py 4 → 9）。
//   G) 本番経路の値と構文エラーを python3 3.14.4 の実測（定数・checkPy3／checkPy3Line で行まで突き合わせ）と照合する。表の最後の列は是正前の値。
//      G-1 (18)(28) `;` で区切った単純文（トップレベル・字下げしたブロック・1 行の suite・関数の本体の global／import の後ろ）・行末の `;`・
//          `;;`／先頭の `;` は構文エラー。G-2 (29) 文の後ろの同じ行の続きは構文エラー（字下げしたブロック・トップレベル・1 行の suite のキーワード
//          以外の文。BJ6 の 1 行の suite の期待値〔文言・行〕は不変）。G-3 (20) 隣り合う文字列リテラルの連結（f-string・三重引用符・括弧の中の改行）・
//          名前や数の後ろの f-string は呼び出しにしない。G-4 (21) 接頭辞 r／R・fr／rf・u／U と b（bytes＝構文エラー）・raw の `\"`・閉じていない r"。
//          G-5 (10) in／not in（list・tuple・str・dict・連鎖・if／while／for の中）と右側の型のエラー。G-6 (9) リストの左辺・列の代入（右辺を
//          list／tuple／str／dict に分け、数が違えばエラー）・`[a, b] += …` は構文エラー・(2) `--1`／`++x`／`not not x`・C の `++`／`--` は無改変。
//          G-7 括弧の中の改行（暗黙の行継続）と閉じていない括弧（括弧の行で報告・括弧より前のエラーが先）。
//      出荷 py の AST 指紋（wf_bj1_pysem E 章）・23 本の出力と runRace（F 章）は不変。
//
// BK3（f-string と str.format の書式指定・py だけ）— 是正前の木（b93bb43）で `--root <木>` を付けて回すと H 章（是正前と同じ値の 4 行を除く）と
//   A 章の BK3 新設の 4 本（ja/en）・本数・全種が赤になる（2026-10-14 の実測: pass=430 fail=75＝赤は A 章の 10 と H 章の 65 だけ・A〜G の
//   既存の述語は緑）。A 章: parser_py に fstrRBrace・kwArg・posAfterKw・kwRepeat（9 → 13）・lexer に書式指定の中の閉じ } の無い fstrBrace（4 → 5）。
//   H) 本番経路の値とエラーを python3 3.14.4 の実測（定数・checkPy3／checkPy3Line）と照合する。表の最後の列は是正前の値。
//      H-1 (7) 書式指定ミニ言語（fill・align・sign・0・width・,／_・.precision・type d f e g s % x X b o と省略・# の接頭辞・偶数丸め）を f-string と
//          str.format（位置・番号・名前付き・添字・入れ子の幅・{{ }}・!r）で・未対応の指定（n）と書き方の誤りは interp.err.fmtSpec・型に使えない
//          指定は fmtType・str.format の引数は fmtField／fmtMix／fmtBrace（行番号付き）・書式指定の無いフィールドと % の書式は是正前と同じ。
//      H-2 (25) 自己記述 `{x=}`・`{x = }`・`{x=:.2f}`・変換 `!r`／`!s`／`!a`（`!r` の文字列は 'a'）。H-3 (26) 書式指定の中の入れ子のフィールド。
//      H-4 (23) リテラル部の単独の `}` は構文エラー interp.syn.fstrRBrace（行＝その `}` の物理行）・`}}` は `}`・`\{`／`\}` は `\` を残す。
//      H-5 キーワード引数は `.format(…)` だけ（それ以外は構文エラー kwArg・位置引数の後ろ・同じ名前は 1 回）・キーワード引数の無い呼び出しの
//          AST は是正前と同じ形。
//      wf_bj1_pysem の F-3・H-1（H_SPEC）・H-3 の書式指定と単独の `}` の行は、是正前の値（書式指定を落とす・a}b5）から python3 の値に改めた。
//
// BK4（値の意味論・py だけ・C は従来どおり）— 是正前の木（850bbb2）で `--root <木>` を付けて回すと I 章（是正前と同じ値の行を除く）だけが赤になる
//   （2026-10-14 の実測: pass=595 fail=73＝赤は I 章の 73 だけ・A〜H は緑）。
//   I) 本番経路の値とエラーを python3 3.14.4 の実測（定数・checkPy3／checkPy3Line）と照合する。表の最後の列は是正前の値。
//      I-1 (3) 除数の False・0 の負のべきは divZero。I-2 (4) and／or は被演算子の値・py の真偽は空の list／tuple／dict も偽（if・while・not・
//          bool()。是正前は空の list／dict が真＝PLAN の `[] or 0`＝0 はこれ無しに成り立たない）。I-3 (5) print／str／f-string／str.format／`%s` の
//          True／False／None・return の無い関数は None・C の print(true) は "true" のまま。I-4 (6) list／tuple の ==／!= は要素ごと（`is` は構文
//          エラーのまま）。I-5 (8)(11) count／index／remove・dict のキーと添字の bool は数・index と remove の未発見は interp.err.notInList。
//          I-6 (11) // は CPython の床除算（1 // 0.1 は 9.0）。I-7 (17) range の引数は整数（interp.err.rangeArg）・式の range の 0 のステップ。
//          I-8 None（null）の演算と添字は interp.err.noneOp／noneIndex（==・!=・in・`%s` は通す）。
//      出荷 23 本の出力と runRace（F 章）・出荷 py の AST 指紋（wf_bj1_pysem E 章）は不変。wf_bj1_pysem の G-9 `range(1,5,None)` は rangeStepZero から
//      rangeArg（python3 と同じ TypeError の種類）に改めた。
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
// BK2: python3 でも同じ本文が re の例外で止まり、その行（traceback の最後の File "<string>", line N）が line であること（wf_bj1_pysem と同じ見方）。
function checkPy3Line(label, pySrc, re, line) {
  if (!PY3) return;
  const r = spawnSync('python3', ['-I', '-W', 'ignore', '-c', pySrc], { encoding: 'utf8', timeout: 20000 });
  py3Checked++;
  const last = (r.stderr || '').trim().split('\n').pop();
  const m = [...(r.stderr || '').matchAll(/File "<string>", line (\d+)/g)].pop();
  const got = m ? Number(m[1]) : null;
  ok(!r.error && r.status !== 0 && re.test(last) && got === line,
    `${label}: python3 ${PY3} も ${re} で行 ${line}（実 ${r.error || r.status === 0 ? 'エラーなし' : last + '・行 ' + got}）`);
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
  // BK2: 下の 2 本は本文を差し替えた（`x = (1` は閉じていない括弧 interp.syn.unclosed に・`a = 1; b = 2` は `;` の受理で通るようになった＝G 章）。
  //   差し替えた本文の ja の文言と行も e65643e の木で採った値（是正前と同じ）。
  ['eat の期待（py・引数の間のカンマ忘れ）', 'py', 'x = foo(1 2)', 'interp.syn.expected', 1,
    "構文エラー(Py): ')' を期待しましたが '2' (行 1)", "Syntax error (Py): expected ')' but got '2' (line 1)"],
  ['1 行の suite のキーワードの文の続き（py）', 'py', 'x = 1\nif x: break 5', 'interp.syn.unexpected', 2,
    "構文エラー(Py): 予期しないトークン '5' (行 2)", "Syntax error (Py): unexpected token '5' (line 2)"],
  ['複合代入のタプルの左辺（py）', 'py', 'a = 1\nb = 2\na, b += 1', 'interp.syn.augTuple', 3,
    "構文エラー(Py): 複合代入 '+=' の左辺に複数の変数（a, b のようなタプル）は書けません（1 つずつ代入してください） (行 3)",
    "Syntax error (Py): the left side of the compound assignment '+=' cannot be several variables (a tuple such as a, b); assign them one at a time (line 3)"],
  ['primary の予期しないトークン（py の式の位置の )）', 'py', 'a = 1\nb = )', 'interp.syn.unexpected', 2,
    "構文エラー(Py): 予期しないトークン ')' (行 2)", "Syntax error (Py): unexpected token ')' (line 2)"],
  // BK2 新設（parser_py）: ja は BK2 の文言（是正前は別の文言＝G 章の表の最後の列）。
  ['閉じていない括弧（py・BK2 新設）', 'py', 'x = 1\ny = (2', 'interp.syn.unclosed', 2,
    "構文エラー(Py): '(' が閉じられていません（対応する閉じ括弧がありません） (行 2)", "Syntax error (Py): '(' was never closed (there is no matching closing bracket) (line 2)"],
  ['リストの左辺の複合代入（py・BK2 新設）', 'py', 'a = 1\n[a, b] += 1', 'interp.syn.augList', 2,
    "構文エラー(Py): 複合代入 '+=' の左辺にリスト（[a, b] のような）は書けません（1 つずつ代入してください） (行 2)",
    "Syntax error (Py): the left side of the compound assignment '+=' cannot be a list (such as [a, b]); assign the variables one at a time (line 2)"],
  ['bytes リテラル（py・BK2 新設）', 'py', 'x = 1\ny = b"ab"', 'interp.syn.bytes', 2,
    '構文エラー(Py): bytes リテラル（b"…）は未対応です。文字列は b を付けずに書いてください (行 2)', 'Syntax error (Py): bytes literals (b"…) are not supported; write the string without the b prefix (line 2)'],
  // BK3 新設（parser_py）: f-string のリテラル部の単独の `}`（lexer の印 FSTRERR を primary が報告）とキーワード引数（.format(…) だけ）。
  ['f-string の単独の }（py・BK3 新設）', 'py', 'x = 5\ns = f"a}b"', 'interp.syn.fstrRBrace', 2,
    "構文エラー(Py): f-string の中の単独の '}' は使えません ('}' という文字は '}}' と書きます) (行 2)", "Syntax error (Py): a single '}' is not allowed in an f-string (write '}}' for a literal '}') (line 2)"],
  ['.format 以外のキーワード引数（py・BK3 新設）', 'py', 'x = 1\nprint(x, end="")', 'interp.syn.kwArg', 2,
    "構文エラー(Py): キーワード引数 'end=' は未対応です (キーワード引数を使えるのは str.format() だけです) (行 2)", "Syntax error (Py): keyword argument 'end=' is not supported (only str.format() accepts keyword arguments) (line 2)"],
  ['キーワード引数の後ろの位置引数（py・BK3 新設）', 'py', 'print("{}".format(a=1, 2))', 'interp.syn.posAfterKw', 1,
    '構文エラー(Py): キーワード引数の後ろに位置引数は書けません (行 1)', 'Syntax error (Py): positional argument follows keyword argument (line 1)'],
  ['同じ名前のキーワード引数（py・BK3 新設）', 'py', 'print("{a}".format(a=1, a=2))', 'interp.syn.kwRepeat', 1,
    "構文エラー(Py): キーワード引数 'a' が 2 回あります (行 1)", "Syntax error (Py): keyword argument repeated: 'a' (line 1)"],
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
    `A ${label}: ja ${J(ja.err)}・行 ${ja.line}・${ja.key}（期待 ${label.includes('BK2 新設') ? 'BK2 の文言' : label.includes('BK3 新設') ? 'BK3 の文言' : '是正前と同じ'} ${J(wantJa)}・行 ${line}・${key}）`);
  ok(en.err === wantEn && en.line === line && en.key === key && !JP_RE.test(en.err || ''),
    `A ${label}: en ${J(en.err)}（期待 ${J(wantEn)}・日本語なし）`);
}
{ // 発生箇所の本数（ソースを数える）と、各 sub が上の表で起きていること（全種）。
  const lex = [...src('interp/lexer.js').matchAll(/throw lexErr\('([A-Za-z]+)'/g)].map((m) => m[1]);
  const py = [...src('interp/parser_py.js').matchAll(/(?<!function )\berr\('([A-Za-z]+)'/g)].map((m) => m[1]);
  const c = [...src('interp/parser_c.js').matchAll(/(?<!function )\berr\('([A-Za-z]+)'/g)].map((m) => m[1]);
  ok(lex.length === 5 && py.length === 13 && c.length === 3,
    `A 発生箇所の本数: lexer ${lex.length}・parser_py ${py.length}・parser_c ${c.length}（期待 5・13・3＝21。BK1 は 4・4・3＝11、BK2 が parser_py に 5 箇所〔err の中と program の末尾の unclosed・inlineCompound の unexpected・augList・bytes〕、` +
    `BK3 が lexer に 1 箇所〔書式指定の中で閉じ } の無い fstrBrace〕・parser_py に 4 箇所〔fstrRBrace・kwRepeat・posAfterKw・kwArg〕）`);
  const covered = new Set(SRC_ERR.map((r) => r[3]));
  const want = [...lex.map((s) => 'interp.lex.' + s), ...py.map((s) => 'interp.syn.' + s), ...c.map((s) => 'interp.syn.' + s)];
  const miss = [...new Set(want)].filter((k) => !covered.has(k));
  ok(want.length === 21 && miss.length === 0, `A 発生箇所の全種（${[...new Set(want)].join('・')}）が表で起きている${miss.length ? '（未検査 ' + miss.join(', ') + '）' : ''}`);
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

// ── G) BK2 Python 構文の穴 I ─────────────────────────────────────────────────────
console.log('\nG) BK2 Python 構文の穴 I（; ・行末の続き・隣接文字列・接頭辞・in・リストの左辺・単項の重ね・括弧の中の改行）— 是正前（06d65ab）の値は各表の最後の列');
// 値の行: [ラベル, 本文, tick 数, 期待の出力（python3 3.14.4 の実測＝checkPy3 で突き合わせ）, 是正前（06d65ab）の結果]。
//   tick 数が 1 以上の本文は Model A（def loop():）で、python3 には setup()／loop() の呼び出しを足して渡す（pyOf）。
const pyOf = (code, ticks) => (ticks ? code + '\nloop()'.repeat(ticks) : code);
function gVals(tag, rows) {
  for (const [label, code, ticks, want, pre] of rows) {
    const r = run(code, 'py', ticks);
    ok(!r.err && J(r.out) === J(want), `${tag} ${label} → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ${J(want)}・是正前 ${pre}）`);
    checkPy3(`${tag} ${label}`, pyOf(code, ticks), want);
  }
}
// エラーの行: [ラベル, 本文, キー, 行, params（null＝照合しない）, python3 の例外の正規表現, 是正前（06d65ab）の結果]。
//   ja／en の文言はカタログの文言（頭＋本体＋行の接尾）そのもの・en に日本語なし・i18nKey と line の構造値（A 章と同じ見方。新しいキーの
//   文言そのものは A 章が定数で照合する）。
function gErrs(tag, rows) {
  for (const [label, code, key, line, params, py3re, pre] of rows) {
    const { ja, en } = runBoth(code, 'py');
    const syn = key.startsWith('interp.syn.'), lex = key.startsWith('interp.lex.');
    const render = (msg, lang) => {
      if (msg === undefined) return null;
      let s = msg; for (const k in (ja.params || {})) s = s.split('{' + k + '}').join(ja.params[k]);
      const head = syn ? (lang === 'ja' ? msgJa('interp.syn.head.py') : msgEn('interp.syn.head.py')) : lex ? (lang === 'ja' ? msgJa('interp.lex.head') : msgEn('interp.lex.head')) : '';
      return head + s + (lang === 'ja' ? ` (行 ${line})` : ` (line ${line})`);
    };
    const wantJa = render(msgJa(key), 'ja'), wantEn = render(msgEn(key), 'en');
    ok(ja.key === key && ja.line === line && (params === null || J(ja.params) === J(params)) && ja.err === wantJa && en.err === wantEn && !JP_RE.test(en.err || ''),
      `${tag} ${label} → ${key}（行 ${line}${params ? '・' + J(params) : ''}）（実 ja ${J(ja.err)}・en ${J(en.err)}・是正前 ${pre}）`);
    if (py3re) checkPy3Line(`${tag} ${label}`, code, py3re, line);
  }
}

// G-1 (18)(28) `;` で区切った単純文。行末の `;` は受理・`;;` と先頭の `;` は構文エラー（python3 も SyntaxError）。
gVals('G-1', [
  ['a = 1; b = 2（probe の (18)）', 'a = 1; b = 2\nprint(a, b)', 0, ['1 2'], "「予期しないトークン ';' (行 1)」"],
  ['関数の中の global x; x = 1（probe の (28)）', 'x = 0\ndef f():\n    global x; x = 1\nf()\nprint(x)', 0, ['1'], '["0"]（x = 1 が黙って消えた）'],
  ['トップレベルの import math; x = 1', 'import math; x = 1\nprint(x)', 0, ['1'], '「未定義の変数/名前: x (行 2)」'],
  ['字下げしたブロックの x = 1; y = 2', 'if 1:\n    x = 1; y = 2\nprint(x, y)', 0, ['1 2'], "「予期しないトークン ';' (行 2)」"],
  ['関数の本体の a = 1; b = 2', 'def f():\n    a = 1; b = 2\n    return a + b\nprint(f())', 0, ['3'], "「予期しないトークン ';' (行 2)」"],
  ['global x; x = 1; return x + 1', 'x = 0\ndef f():\n    global x; x = 1; return x + 1\nprint(f(), x)', 0, ['2 1'], '[" 0"]（; 以降が消え、f() は値なし・x は 0）'],
  ['行末の ;（x = 1;）', 'x = 1;\nprint(x)', 0, ['1'], "「予期しないトークン ';' (行 1)」"],
  ['空白を挟んだ ; と行末の ;', 'x = 1 ; y = 2 ;\nprint(x, y)', 0, ['1 2'], "「予期しないトークン ';' (行 1)」"],
  ['1 行の suite の ;（for … : print(i); print(i * 10)）', 'for i in range(2): print(i); print(i * 10)', 0, ['0', '0', '1', '10'], "「予期しないトークン ';' (行 1)」"],
  ['1 行の suite の ;（while … : x += 1; print(x)）', 'x = 0\nwhile x < 3: x += 1; print(x)', 0, ['1', '2', '3'], "「予期しないトークン ';' (行 2)」"],
  ['def loop() の中の a = 1; b = 2（Model A・1 tick）', 'def loop():\n    a = 1; b = 2\n    print(a + b)', 1, ['3'], "「予期しないトークン ';' (行 2)」"],
]);
gErrs('G-1', [
  ['x = 1;;', 'x = 1;;', 'interp.syn.unexpected', 1, { tok: ';' }, /^SyntaxError/, "「予期しないトークン ';' (行 1)」（同じ）"],
  ['先頭の ;', 'x = 0\n;x = 1', 'interp.syn.unexpected', 2, { tok: ';' }, /^SyntaxError/, "「予期しないトークン ';' (行 2)」（同じ）"],
  ['x = 1; ;', 'x = 1\n\ny = 2; ;', 'interp.syn.unexpected', 3, { tok: ';' }, /^SyntaxError/, "「予期しないトークン ';' (行 3)」（同じ）"],
]);

// G-2 (29) 文の後ろの同じ行の続きは構文エラー（行＝その行・トークン＝続きの先頭）。是正前は字下げしたブロック・トップレベル・1 行の suite の
//   キーワード以外の単純文で、続きを次の文として黙って読んだ。1 行の suite のキーワードの文（BJ6）は同じ文言・行のまま。
gErrs('G-2', [
  ['x = 1 2（probe の (29)）', 'x = 1 2\nprint(x)', 'interp.syn.unexpected', 1, { tok: 2 }, /^SyntaxError/, '["1"]（2 を次の文として捨てた）'],
  ['print(1) print(2)', 'print(1) print(2)', 'interp.syn.unexpected', 1, { tok: 'print' }, /^SyntaxError/, '["1","2"]'],
  ['字下げしたブロックの print(1) print(2)', 'if 1:\n    print(1) print(2)', 'interp.syn.unexpected', 2, { tok: 'print' }, /^SyntaxError/, '["1","2"]'],
  ['字下げしたブロックの x = 1 2', 'def f():\n    x = 1 2\n    return x\nprint(f())', 'interp.syn.unexpected', 2, { tok: 2 }, /^SyntaxError/, '["1"]'],
  ['字下げしたブロックの break 5', 'for i in range(2):\n    break 5\nprint(i)', 'interp.syn.unexpected', 2, { tok: 5 }, /^SyntaxError/, '["0"]'],
  ['関数の本体の return 1 2', 'def f():\n    return 1 2\nprint(3)', 'interp.syn.unexpected', 2, { tok: 2 }, /^SyntaxError/, '["3"]'],
  ['字下げしたブロックの y = 2 3', 'x = 1\nif x:\n    y = 2 3', 'interp.syn.unexpected', 3, { tok: 3 }, /^SyntaxError/, 'エラー無し'],
  ['トップレベルの break 5', 'x = 1\nbreak 5', 'interp.syn.unexpected', 2, { tok: 5 }, /^SyntaxError/, '「break はループ (for / while。C は switch も) の中に書いてください。… (行 2)」'],
  ['1 行の suite のキーワード以外の文の続き（if 1: y = 2 3）', 'if 1: y = 2 3', 'interp.syn.unexpected', 1, { tok: 3 }, /^SyntaxError/, 'エラー無し'],
  ['文字列の後ろの数（x = "a" 5）', 'x = "a" 5', 'interp.syn.unexpected', 1, { tok: 5 }, /^SyntaxError/, 'エラー無し'],
  ['1 行の suite のキーワードの文の続き（BJ6 の if x: break 5・不変）', 'x = 1\nif x: break 5', 'interp.syn.unexpected', 2, { tok: 5 }, /^SyntaxError/, '同じ（BJ6）'],
  ['1 行の suite の複合文（BJ6 の if x: if x: pass・不変）', 'x = 1\nif x: if x: pass', 'interp.syn.unexpected', 2, { tok: ':' }, /^SyntaxError/, '同じ（BJ6）'],
]);
{ // 是正前と同じ形: コメントは行末の続きではない・`\` の行継続の後ろの続きは継続先の行で報告。
  gVals('G-2', [['行末のコメント', 'x = 1  # コメント\nprint(x)', 0, ['1'], '同じ'], ['\\ の行継続', 'x = 1 + \\\n    2\nprint(x)', 0, ['3'], '同じ']]);
  gErrs('G-2', [['\\ の行継続の後ろの続き', 'x = 1 + \\\n    2 3', 'interp.syn.unexpected', 2, { tok: 3 }, /^SyntaxError/, 'エラー無し']]);
}

// G-3 (20) 隣り合う文字列リテラルの連結（f-string・三重引用符・括弧の中の改行を含む）。
gVals('G-3', [
  ['s = "ab" "cd"', 's = "ab" "cd"\nprint(s)', 0, ['abcd'], '["ab"]（"cd" を別の文として捨てた）'],
  ['print("ab" "cd")（probe の (20)）', 'print("ab" "cd")', 0, ['abcd'], "「')' を期待しましたが 'cd' (行 1)」"],
  ['("ab"⏎ "cd")', 's = ("ab"\n     "cd")\nprint(s)', 0, ['abcd'], "「')' を期待しましたが 'NEWLINE' (行 2)」"],
  ['f"{x}" "y"', 'x = 5\ns = f"{x}" "y"\nprint(s)', 0, ['5y'], '["5"]'],
  ['"y" f"{x}" "z" f"{x}{x}"', 'x = 5\ns = "y" f"{x}" "z" f"{x}{x}"\nprint(s)', 0, ['y5z55'], '「呼び出し対象が関数ではありません (行 2)」（"y" の後ろの f-string の括弧を呼び出しと読んだ）'],
  ['引用符の種類の混在と三重引用符', 's = "a" \'b\' """c""" \'\'\'d\'\'\'\nprint(s)', 0, ['abcd'], '["a"]'],
  ['括弧の中のコメントを挟む', 's = ("a"  # 1 つ目\n     "b"\n)\nprint(s)', 0, ['ab'], "「')' を期待しましたが 'NEWLINE' (行 2)」"],
  ['連結は % より先（"%d" "x" % 3）', 'print("%d" "x" % 3)', 0, ['3x'], "「')' を期待しましたが 'x' (行 1)」"],
  ['連結はメソッド呼び出しより先（"a" "b".upper()）', 'print("a" "b".upper())', 0, ['AB'], "「')' を期待しましたが 'b' (行 1)」"],
  ['f-string の式の中の連結', 'x = 5\nprint(f"{f\'{x}\' \'y\'}")', 0, ['5y'], "「')' を期待しましたが 'y' (行 2)」"],
  ['f-string と raw の連結', 'x = 5\ns = f"{x}" r"\\n"\nprint(len(s))', 0, ['3'], '「未定義の変数/名前: r (行 2)」'],
  ['f-string のメソッド呼び出し（従来どおり）', 'x = 5\ns = f"{x}a".upper()\nprint(s)', 0, ['5A'], '同じ'],
  ['g (f"{x}")（空白を挟んだ呼び出し・従来どおり）', 'def g(a):\n    return a\nx = 5\nprint(g (f"{x}"))', 0, ['5'], '同じ'],
]);
// f-string の前が文字列以外（名前・数）なら呼び出しにしない（python3 も SyntaxError）。表示するトークンは f-string の開き引用符。
gErrs('G-3', [
  ['print f"{x}"（Python 2 の書き方）', 'x = 5\nprint f"{x}"', 'interp.syn.unexpected', 2, { tok: 'f"' }, /^SyntaxError/, '["5"]（print("" + x) の呼び出しとして黙って走った）'],
  ['y = 3 f"{x}"', 'x = 5\ny = 3 f"{x}"', 'interp.syn.unexpected', 2, { tok: 'f"' }, /^SyntaxError/, '「呼び出し対象が関数ではありません (行 2)」'],
  ['引数の中の 1 f"{x}"', 'x = 5\nprint("a", 1 f"{x}")', 'interp.syn.expected', 2, { want: ')', got: 'f"' }, /^SyntaxError/, '「呼び出し対象が関数ではありません (行 2)」'],
]);

// G-4 (21) 文字列の接頭辞。r／R＝raw・fr／rf（大文字小文字を問わない）＝raw の f-string・u／U＝通常・b を含む＝構文エラー interp.syn.bytes。
gVals('G-4', [
  ['r"a\\nb"（probe の (21)・長さ 4）', 's = r"a\\nb"\nprint(len(s), s)', 0, ['4 a\\nb'], "「未定義の変数/名前: r (行 1)」"],
  ['R"a\\nb"', 's = R"a\\nb"\nprint(len(s))', 0, ['4'], "「未定義の変数/名前: R (行 1)」"],
  ['rf"{x}\\n"', 'x = 5\ns = rf"{x}\\n"\nprint(len(s), s)', 0, ['3 5\\n'], "「未定義の変数/名前: rf (行 2)」"],
  ['fr"{x}\\t"', 'x = 5\ns = fr"{x}\\t"\nprint(len(s))', 0, ['3'], "「未定義の変数/名前: fr (行 2)」"],
  ['Rf"\\{x}"（\\ の後ろの { は置換フィールド）', 'x = 5\ns = Rf"\\{x}"\nprint(len(s), s)', 0, ['2 \\5'], "「未定義の変数/名前: Rf (行 2)」"],
  ['u"a\\nb"（通常の文字列）', 's = u"a\\nb"\nprint(len(s))', 0, ['3'], "「未定義の変数/名前: u (行 1)」"],
  ['U"ab"', 's = U"ab"\nprint(s)', 0, ['ab'], "「未定義の変数/名前: U (行 1)」"],
  ['r"\\""（\\" は閉じ引用符にしない）', 's = r"\\""\nprint(len(s))', 0, ['2'], "「未定義の変数/名前: r (行 1)」"],
  ["r'\\''", "s = r'\\''\nprint(len(s))", 0, ['2'], "「未定義の変数/名前: r (行 1)」"],
  ['r"""a\\nb"""', 's = r"""a\\nb"""\nprint(len(s))', 0, ['4'], "「未定義の変数/名前: r (行 1)」"],
  ['r"a\\⏎b"（\\ と改行の 2 文字）', 's = r"a\\\nb"\nprint(len(s))', 0, ['4'], "「未定義の変数/名前: r (行 1)」"],
  ['接頭辞の文字は名前として使える', 'r = 5\nb = 3\nu = 4\nf = 2\nrb = 1\nprint(r + b + u + f + rb)', 0, ['15'], '同じ'],
]);
gErrs('G-4', [
  ['b"a"', 'print(b"a")', 'interp.syn.bytes', 1, { open: 'b"' }, null, "「')' を期待しましたが 'a' (行 1)」"],
  ["rB'ab'（2 行目）", "x = 1\ny = rB'ab'", 'interp.syn.bytes', 2, { open: "rB'" }, null, '「未定義の変数/名前: rB (行 2)」'],
  ['"a" b"b"（連結の途中）', 'print("a" b"b")', 'interp.syn.bytes', 1, { open: 'b"' }, /^SyntaxError: cannot mix bytes and nonbytes literals/, "「')' を期待しましたが 'b' (行 1)」"],
  ['閉じていない r"', 'x = 1\ns = r"abc', 'interp.lex.unterminated', 2, { open: 'r"', close: '"' }, /^SyntaxError: unterminated string literal/, '同じ字句エラーで開き引用符が " （接頭辞を含まない）'],
  ['r"a\\" は閉じていない（\\" は閉じ引用符にしない）', 's = r"a\\"', 'interp.lex.unterminated', 1, { open: 'r"', close: '"' }, /^SyntaxError: unterminated string literal/, '同じ字句エラーで開き引用符が " （接頭辞を含まない）'],
]);

// G-5 (10) in／not in（list・tuple・str〔部分文字列〕・dict〔キー〕）。真偽は `1 if (…) else 0` で数にして python3 と照合する（bool の表示は BK4）。
{
  const IN = [
    ['1 in [1, 2]', '1'], ['3 in [1, 2]', '0'], ['3 not in [1, 2]', '1'], ['2 in (1, 2)', '1'], ['"x" in ["x", "y"]', '1'],
    ['"bc" in "abc"', '1'], ['"ac" in "abc"', '0'], ['"" in "abc"', '1'], ['"a" not in "abc"', '0'],
    ['"k" in {"k": 1}', '1'], ['"z" in {"k": 1}', '0'], ['1 in {1: "a"}', '1'], ['"k" not in {"k": 1}', '0'],
    ['True in [1]', '1'], ['1 in [True]', '1'], ['0 in [False]', '1'], ['1.0 in [1]', '1'],
    ['1 < 2 in [True]', '0'], ['not 1 in [1]', '0'], ['1 in [1] == True', '0'], ['(1 in [1]) == True', '1'],
  ];
  gVals('G-5', IN.map(([e, v]) => [e, `print(1 if (${e}) else 0)`, 0, [v], "「')' を期待しましたが 'in'／'not'」"]));
}
gVals('G-5', [
  ['if 2 in x:', 'x = [1, 2]\nif 2 in x:\n    print("yes")', 0, ['yes'], "「':' を期待しましたが 'in' (行 2)」"],
  ['while n not in [3]:', 'n = 0\nwhile n not in [3]:\n    n += 1\nprint(n)', 0, ['3'], "「':' を期待しましたが 'not' (行 2)」"],
  ['for … in と同じ行の in（for c in "ab": … c in "xa"）', 'for c in "ab":\n    print(1 if c in "xa" else 0)', 0, ['1', '0'], "「'else' を期待しましたが 'in' (行 2)」"],
  ['x = 1 in [1]（括弧の外）', 'x = 1 in [1]\nprint(1 if x else 0)', 0, ['1'], '「未定義の変数/名前: in (行 1)」'],
]);
gErrs('G-5', [
  ['1 in 5（右が数）', 'x = 1\nprint(1 in 5)', 'interp.err.inRight', 2, {}, /^TypeError/, "「')' を期待しましたが 'in' (行 2)」"],
  ['1 in "abc"（右が str・左が数）', 'print(1 in "abc")', 'interp.err.inStrLeft', 1, {}, /^TypeError: 'in <string>' requires string as left operand/, "「')' を期待しましたが 'in' (行 1)」"],
]);

// G-6 (9) リストの左辺・列の代入（右辺を列に分け、数が違えばエラー）・(2) 単項の重ね。
gVals('G-6', [
  ['[a, b] = [1, 2]（probe の (9)）', '[a, b] = [1, 2]\nprint(a, b)', 0, ['1 2'], '「代入先が不正です (行 1)」'],
  ['[a, b] = 1, 2', '[a, b] = 1, 2\nprint(a, b)', 0, ['1 2'], '「代入先が不正です (行 1)」'],
  ['[a, b] = "xy"', '[a, b] = "xy"\nprint(a, b)', 0, ['x y'], '「代入先が不正です (行 1)」'],
  ['a, b = "xy"（タプルの左辺も str を分ける）', 'a, b = "xy"\nprint(a, b)', 0, ['x y'], '["xy "]（a が "xy"・b が未定義）'],
  ['a, b = {"p": 1, "q": 2}（dict はキー）', 'a, b = {"p": 1, "q": 2}\nprint(a, b)', 0, ['p q'], '「Cannot convert object to primitive value」（JS の TypeError が漏れた・a が dict）'],
  ['[a] = [5]（要素 1 つ）', '[a] = [5]\nprint(a + 1)', 0, ['6'], '「代入先が不正です (行 1)」'],
  ['a, = [5]（要素 1 つのタプル）', 'a, = [5]\nprint(a + 1)', 0, ['6'], '["51"]（a が [5]）'],
  ['(a, b), c = (1, 2), 3（入れ子）', '(a, b), c = (1, 2), 3\nprint(a, b, c)', 0, ['1 2 3'], '「代入先が不正です (行 1)」'],
  ['[a, [b, c]] = [1, [2, 3]]（入れ子）', '[a, [b, c]] = [1, [2, 3]]\nprint(a, b, c)', 0, ['1 2 3'], '「代入先が不正です (行 1)」'],
  ['[a, b] = [b, a]（入れ替え）', 'a = 1\nb = 2\n[a, b] = [b, a]\nprint(a, b)', 0, ['2 1'], '「代入先が不正です (行 3)」'],
  ['[d[0], d[1]] = [3, 4]', 'd = [0, 0]\n[d[0], d[1]] = [3, 4]\nprint(d[0], d[1])', 0, ['3 4'], '「代入先が不正です (行 2)」'],
  ['a, b = f()（従来どおり）', 'def f():\n    return 1, 2\na, b = f()\nprint(a, b)', 0, ['1 2'], '同じ'],
  ['--1（probe の (2)）', 'print(--1)', 0, ['1'], "「予期しないトークン '--' (行 1)」"],
  ['++x', 'x = 3\nprint(++x)', 0, ['3'], "「予期しないトークン '++' (行 2)」"],
  ['not not x', 'x = 3\nprint(1 if not not x else 0, 1 if not not 0 else 0)', 0, ['1 0'], '同じ'],
  ['-+-1・- - 1・3--2・3++2・--2**2', 'print(-+-1, - - 1, 3--2, 3++2, --2**2)', 0, ['1 1 5 5 4'], "「')' を期待しましたが '--' (行 1)」"],
  ['y = x--1', 'x = 3\ny = x--1\nprint(y)', 0, ['4'], "「予期しないトークン '--' (行 2)」"],
  ['---1・x---1・x++ + 1・--(2)・--.5', 'x = 3\nprint(---1, x---1, x++ + 1, --(2), --.5)', 0, ['-1 2 4 2 0.5'], "「予期しないトークン '--' (行 2)」"],
  ['括弧の中で -- の後ろが次の行', 'x = 3\ny = (x--\n     1)\nprint(y)', 0, ['4'], "「')' を期待しましたが '--' (行 2)」"],
]);
gErrs('G-6', [
  ['[a, b] += [1]', '[a, b] += [1]', 'interp.syn.augList', 1, { op: '+=' }, /^SyntaxError: 'list' is an illegal expression for augmented assignment/, '「未定義の変数/名前: a (行 1)」'],
  ['[a] -= 1（2 行目）', 'a = 1\n[a] -= 1', 'interp.syn.augList', 2, { op: '-=' }, /^SyntaxError: 'list' is an illegal expression for augmented assignment/, '「代入先が不正です (行 2)」'],
  ['a, b = [1]（足りない）', 'a, b = [1]', 'interp.err.unpack', 1, { n: 2 }, /^ValueError: not enough values to unpack/, 'エラー無し（print(a, b) は "1 "＝b が未定義）'],
  ['a, b = [1, 2, 3]（多い）', 'x = 0\na, b = [1, 2, 3]', 'interp.err.unpack', 2, { n: 2 }, /^ValueError: too many values to unpack/, 'エラー無し（print(a, b) は "1 2"＝3 を捨てた）'],
  ['[a, b] = 5（数）', '[a, b] = 5', 'interp.err.unpack', 1, { n: 2 }, /^TypeError: cannot unpack non-iterable int object/, '「代入先が不正です (行 1)」'],
  ['[a] = 5（要素 1 つ・数）', 'x = 1\n[a] = 5', 'interp.err.unpack', 2, { n: 1 }, /^TypeError: cannot unpack non-iterable int object/, '「代入先が不正です (行 2)」'],
  // 後置の `x++`／`x--`（C の癖）は従来どおり 1 トークンの構文エラー（後ろが被演算子で始まらない＝lexer が分けない）。
  ['x++（後置）', 'x = 1\nx++\nprint(x)', 'interp.syn.unexpected', 2, { tok: '++' }, /^SyntaxError/, "同じ（「予期しないトークン '++' (行 2)」）"],
  ['x--; と行末のコメント', 'x = 1\nx--;  # c', 'interp.syn.unexpected', 2, { tok: '--' }, /^SyntaxError/, "同じ（「予期しないトークン '--' (行 2)」）"],
  ['print(x--)', 'x = 1\nprint(x--)', 'interp.syn.expected', 2, { want: ')', got: '--' }, /^SyntaxError/, "同じ（「')' を期待しましたが '--' (行 2)」）"],
]);
{ // C は無改変: `++`／`--` は 1 トークン（前置・後置）。
  const r = run('void setup(){\n  int i = 5; i--; i++; i--;\n  print(i); print(--i); print(i++); print(i);\n}\nvoid loop(){}', 'c');
  ok(!r.err && J(r.out) === J(['4', '3', '3', '4']), `G-6 C の i--／++i／i++ は従来どおり → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ["4","3","3","4"]）`);
}

// G-7 (20) 括弧 ( [ { の中の改行は文の続き（暗黙の行継続）・閉じていない括弧は「'(' が閉じられていません」（行＝括弧の行）。
gVals('G-7', [
  ['複数行のリスト', 'x = [1,\n     2]\nprint(len(x))', 0, ['2'], "「予期しないトークン 'NEWLINE' (行 2)」"],
  ['複数行の辞書', 'd = {\n  "a": 1,\n  "b": 2\n}\nprint(d["b"])', 0, ['2'], "「予期しないトークン 'NEWLINE' (行 2)」"],
  ['複数行の仮引数と引数', 'def f(a,\n      b):\n    return a + b\nprint(f(1,\n        2))', 0, ['3'], "「'ID' を期待しましたが 'NEWLINE' (行 2)」"],
  ['複数行の式', 'x = (1 +\n     2)\nprint(x)', 0, ['3'], "「予期しないトークン 'NEWLINE' (行 2)」"],
  ['複数行の if の条件', 'if (1 and\n    1):\n    print("ok")', 0, ['ok'], "「予期しないトークン 'NEWLINE' (行 2)」"],
  ['def loop() の中の字下げより浅い続きの行（Model A・1 tick）', 'def loop():\n    v = [1,\n  2]\n    print(len(v))', 1, ['2'], "「予期しないトークン 'NEWLINE' (行 3)」"],
  ['複数行の from … import (…)', 'from math import (sqrt,\n    floor)\nprint(1)', 0, ['1'], "「予期しないトークン 'INDENT' (行 2)」"],
]);
{ // 複数行の文の後ろの行番号は物理行（文字列の中の改行と同じ）。複数行の文の実行時エラーの行は文の行（python3 も式の始まりの行）。
  const a = run('x = [1,\n 2]\ny = 1 / 0', 'py'), b = run('x = (1 +\n     2) / 0', 'py');
  ok(a.key === 'interp.err.divZero' && a.line === 3 && b.key === 'interp.err.divZero' && b.line === 1,
    `G-7 複数行のリストの後ろの文のゼロ除算は行 3・複数行の式のゼロ除算は文の行 1（実 ${a.line}・${b.line}・是正前はどちらも「予期しないトークン 'NEWLINE' (行 2)」）`);
  checkPy3Line('G-7 複数行のリストの後ろの文のゼロ除算', 'x = [1,\n 2]\ny = 1 / 0', /^ZeroDivisionError/, 3);
  checkPy3Line('G-7 複数行の式のゼロ除算', 'x = (1 +\n     2) / 0', /^ZeroDivisionError/, 1);
}
gErrs('G-7', [
  ['x = (1（probe の syntax err text・末尾で閉じていない）', 'x = (1', 'interp.syn.unclosed', 1, { ch: '(' }, /^SyntaxError: '\(' was never closed/, "「')' を期待しましたが 'NEWLINE' (行 1)」"],
  ['x = (1⏎y = 2', 'x = (1\ny = 2', 'interp.syn.unclosed', 1, { ch: '(' }, /^SyntaxError: '\(' was never closed/, "「')' を期待しましたが 'NEWLINE' (行 2)」"],
  ['一番内側の閉じていない括弧（[）', 'x = foo(1, [2\ny = 3', 'interp.syn.unclosed', 1, { ch: '[' }, /^SyntaxError: '\[' was never closed/, "「']' を期待しましたが 'NEWLINE' (行 2)」"],
  ['def loop() の中の閉じ忘れ（後ろに if）', 'def loop():\n    d = sensor(1\n    if d > 100:\n        motor(1)', 'interp.syn.unclosed', 2, { ch: '(' }, /^SyntaxError: '\(' was never closed/, "「')' を期待しましたが 'NEWLINE' (行 3)」"],
  ['import の読み飛ばしが閉じていない括弧の先まで呑む形', 'from math import (sqrt\nx = 1\nprint(x)', 'interp.syn.unclosed', 1, { ch: '(' }, /^SyntaxError: '\(' was never closed/, '["1"]（是正前は括弧の中も改行で区切ったので import の後ろが走った）'],
  ['括弧より前のエラーが先', 'x = = 1\ny = (2', 'interp.syn.unexpected', 1, { tok: '=' }, /^SyntaxError: invalid syntax/, "同じ（「予期しないトークン '=' (行 1)」）"],
  ['余分な閉じ括弧', 'x = 1)', 'interp.syn.unexpected', 1, { tok: ')' }, /^SyntaxError: unmatched '\)'/, "同じ（「予期しないトークン ')' (行 1)」）"],
]);

// ── H) BK3 f-string と str.format の書式指定（(7)(23)(25)(26)）──────────────────────────────────
console.log('\nH) BK3 書式指定ミニ言語・自己記述 {x=}・変換 !r/!s/!a・入れ子のフィールド・単独の }・str.format — 是正前（b93bb43）の値は各表の最後の列');
// H-1 (7) 書式指定ミニ言語 `[[fill]align][sign][#][0][width][,][.precision][type]`（f-string と str.format の位置・番号・名前付き）。
//   期待値は python3 3.14.4 の実測（checkPy3 で突き合わせる）。是正前は書式指定を落として素の str 化（`f"{x:.2f}"` は 3.14159）・
//   str.format は `{}`／`{n}` だけ（名前・変換・`{{` は無視、キーワード引数は構文エラー）。
gVals('H-1', [
  ['f"{x:.2f}"（probe の (7)）', 'x = 3.14159\nprint(f"{x:.2f}")', 0, ['3.14'], '["3.14159"]'],
  ['f"{x:>5}"', 'x = 5\nprint(f"[{x:>5}]")', 0, ['[    5]'], '["[5]"]'],
  ['f"{i:03d}"', 'i = 7\nprint(f"{i:03d}")', 0, ['007'], '["7"]'],
  ['f"{n:,}"', 'n = 1234567\nprint(f"{n:,}")', 0, ['1,234,567'], '["1234567"]'],
  ['f"{p:.1%}"', 'p = 0.256\nprint(f"{p:.1%}")', 0, ['25.6%'], '["0.256"]'],
  ['"{:>8.3f}".format(x)', 'x = 3.14159\nprint("[" + "{:>8.3f}".format(x) + "]")', 0, ['[   3.142]'], '["[3.14159]"]'],
  ['"{0} {1}".format(a, b)（従来どおり）', 'a = 1\nb = "two"\nprint("{0} {1}".format(a, b))', 0, ['1 two'], '同じ'],
  ['"{a}".format(a=1)（キーワード引数）', 'print("{a}".format(a=1))', 0, ['1'], "「')' を期待しましたが '=' (行 1)」"],
  ['埋め文字と揃え（< ^ > と文字列の既定は左）', 's = "ab"\nprint(f"[{s:*<6}][{s:-^6}][{s:>4}][{s:<4}]")', 0, ['[ab****][--ab--][  ab][ab  ]'], '["[ab][ab][ab][ab]"]'],
  ['符号（+ - 空白）', 'v = 5\nw = -5\nprint(f"[{v:+}][{w:+}][{v:-}][{v: }][{w: }]")', 0, ['[+5][-5][5][ 5][-5]'], '["[5][-5][5][5][-5]"]'],
  ['0 埋め・符号と = の揃え', 'v = -12.5\nprint(f"[{v:08.2f}][{v:+08.2f}][{v:=+9.2f}]")', 0, ['[-0012.50][-0012.50][-   12.50]'], '["[-12.5][-12.5][-12.5]"]'],
  ['区切り（, と _・float の整数部・0 埋めの区切り）', 'print(f"{1234567.891:,}|{1234567:_}|{12345.678:,.2f}|{-1234:010,}")', 0, ['1,234,567.891|1_234_567|12,345.68|-0,001,234'], '["1234567.891|1234567|12345.678|-1234"]'],
  ['型 e／E（指数は 2 桁以上）', 'x = 12345.678\nprint(f"{x:e}|{x:.2e}|{0.000123:E}")', 0, ['1.234568e+04|1.23e+04|1.230000E-04'], '["12345.678|12345.678|0.000123"]'],
  ['型 g（有効数字・末尾の 0 を外す・指数への切り替え）', 'print(f"{1234.5:g}|{0.00001234:g}|{123456789:g}|{1.0:g}|{3.14159:.3g}")', 0, ['1234.5|1.234e-05|1.23457e+08|1|3.14'], '["1234.5|0.00001234|123456789|1|3.14159"]'],
  ['型 s と精度（文字列の切り詰め）', 's = "abcdef"\nprint(f"[{s:s}][{s:.3}][{s:>5.2}]")', 0, ['[abcdef][abc][   ab]'], '["[abcdef][abcdef][abcdef]"]'],
  ['型 x X b o と # の接頭辞・_ は 4 桁ごと', 'print(f"{255:x}|{255:X}|{255:#x}|{5:b}|{5:#b}|{8:o}|{255:_b}")', 0, ['ff|FF|0xff|101|0b101|10|1111_1111'], '["255|255|255|5|5|8|255"]'],
  ['型 %（100 倍・既定 6 桁）', 'print(f"{0.5:%}|{0.125:.0%}|{1:.1%}")', 0, ['50.000000%|12%|100.0%'], '["0.5|0.125|1"]'],
  ['型の省略＋精度（float は g の変形）', 'print(f"{3.14159:.3}|{12.5:.3}|{123.4:.3}|{0.00001:.3}")', 0, ['3.14|12.5|1.23e+02|1e-05'], '["3.14159|12.5|123.4|0.00001"]'],
  ['丸めは 2 進の正確な値の偶数丸め（toFixed は 0.5→"1"）', 'print(f"{2.5:.0f}|{0.125:.2f}|{2.675:.2f}|{1.5:.0f}|{0.5:.0f}")', 0, ['2|0.12|2.67|2|0'], '["2.5|0.125|2.675|1.5|0.5"]'],
  ['幅だけ（数は右・文字列は左）', 'print(f"[{42:6}][{\'hi\':6}]")', 0, ['[    42][hi    ]'], '["[42][hi]"]'],
  ['1e21 以上の f（toFixed は指数表記になる）', 'print(f"{1e22:.1f}")', 0, ['10000000000000000000000.0'], '["1e+22"]'],
  ['str.format の名前・番号・添字・入れ子の幅', 'print("{name}: {val:.1f}|{0[1]}|{1:{2}}|".format([1, 2], 7, 4, name="spd", val=1.25))', 0, ['spd: 1.2|2|   7|'], "「')' を期待しましたが '=' (行 1)」"],
  ['str.format の {{ }} と !r', 'print("{{{}}} {!r}".format(5, "a"))', 0, ["{5} 'a'"], '["{{5}} {!r}"]'],
  ['str.format の幅を引数で（{:{}}・自動の番号は外側が先）', 'print("[" + "{:{}}".format("a", 5) + "]")', 0, ['[a    ]'], '["[a}]"]'],
  ['センサー値の整形（Model A の loop()・1 tick）', 'def loop():\n    d = 123.456\n    print(f"d={d:6.1f}mm")', 1, ['d= 123.5mm'], '["d=123.456mm"]'],
]);
// 未対応の指定と書き方の誤り（interp.err.fmtSpec）・型に使えない指定（fmtType）・str.format の引数（fmtField・fmtMix・fmtBrace）は
//   行番号付きの実行時エラー（python3 は ValueError／TypeError／IndexError／KeyError・同じ行）。`n`（ロケール依存）は python3 では有効だが未対応。
gErrs('H-1', [
  ['未対応の型 n（python3 は "5"）', 'x = 5\nprint(f"{x:n}")', 'interp.err.fmtSpec', 2, { spec: 'n' }, null, '["5"]（書式指定を落とした）'],
  ['書き方の誤り {x:abc}', 'x = 5\nprint(f"{x:abc}")', 'interp.err.fmtSpec', 2, { spec: 'abc' }, /^ValueError: Invalid format specifier/, '["5"]'],
  ['書き方の誤り "{:5.2.1}"', 'print("{:5.2.1}".format(1.5))', 'interp.err.fmtSpec', 1, { spec: '5.2.1' }, /^ValueError: Invalid format specifier/, '["1.5"]'],
  ['文字列に d', 's = "a"\nprint(f"{s:d}")', 'interp.err.fmtType', 2, { type: 'str', spec: 'd' }, /^ValueError: Unknown format code 'd' for object of type 'str'/, '["a"]'],
  ['整数値でない数に d', 'x = 3.5\nprint(f"{x:d}")', 'interp.err.fmtType', 2, { type: 'float', spec: 'd' }, /^ValueError: Unknown format code 'd' for object of type 'float'/, '["3.5"]'],
  ['list に幅', 'x = [1]\nprint(f"{x:>5}")', 'interp.err.fmtType', 2, { type: 'list', spec: '>5' }, /^TypeError: unsupported format string passed to list\.__format__/, '["1"]'],
  ['文字列に符号', "print(f\"{'a':+}\")", 'interp.err.fmtType', 1, { type: 'str', spec: '+' }, /^ValueError: Sign not allowed in string format specifier/, '["a"]'],
  ['x に , の区切り', 'print(f"{255:,x}")', 'interp.err.fmtType', 1, { type: 'int', spec: ',x' }, /^ValueError: Cannot specify ',' with 'x'/, '["255"]'],
  ['関数の中の書式のエラーの行（return の行）', 'def f(v):\n    return f"{v:d}"\nprint(f(1.5))', 'interp.err.fmtType', 2, { type: 'float', spec: 'd' }, /^ValueError: Unknown format code 'd'/, '["1.5"]'],
  ['str.format の引数が足りない', 'print("{}{}".format(1))', 'interp.err.fmtField', 1, { field: '' }, /^IndexError: Replacement index 1 out of range/, '["1undefined"]'],
  ['str.format の名前の引数が無い', 'print("{a}".format(b=1))', 'interp.err.fmtField', 1, { field: 'a' }, /^KeyError: 'a'/, "「')' を期待しましたが '=' (行 1)」"],
  ['str.format の添字が範囲外', 'print("{0[5]}".format([1]))', 'interp.err.fmtField', 1, { field: '0[5]' }, /^IndexError: list index out of range/, '["{0[5]}"]'],
  ['str.format の属性（未対応・python3 は AttributeError）', 'print("{0.x}".format(1))', 'interp.err.fmtField', 1, { field: '0.x' }, /^AttributeError/, '["{0.x}"]'],
  ['str.format の自動の番号と番号の指定の混在', 'print("{0}{}".format(1, 2))', 'interp.err.fmtMix', 1, {}, /^ValueError: cannot switch from manual field specification to automatic field numbering/, '["11"]'],
  ['str.format の単独の }（2 行目）', 'x = 1\nprint("}".format())', 'interp.err.fmtBrace', 2, {}, /^ValueError: Single '}' encountered in format string/, '["}"]'],
  ['str.format の閉じていない {', 'print("{".format())', 'interp.err.fmtBrace', 1, {}, /^ValueError: Single '\{' encountered in format string/, '["{"]'],
  ['str.format の不明な変換 !x', 'print("{0!x}".format(1))', 'interp.err.fmtSpec', 1, { spec: '!x' }, /^ValueError: Unknown conversion specifier x/, '["{0!x}"]'],
]);
{ // 変わらないもの: 書式指定の無いフィールドの値（是正前の `"" + (式)` と同じ＝list は 1,2・float は JS の表示。python3 は [1, 2]・1e-07＝未是正の差）と `%` の書式。
  const r = run('x = [1, 2]\ny = 0.1 + 0.2\nz = 1e-7\nprint(f"{x}|{y}|{z}|{x!s}")', 'py');
  ok(!r.err && J(r.out) === J(['1,2|0.30000000000000004|1e-7|1,2']), `H-1 書式指定の無いフィールドの値は是正前と同じ → ${r.err ? 'ERR ' + r.err : J(r.out)}（是正前 ["1,2|0.30000000000000004|1e-7|1,2"]・python3 は ["[1, 2]|0.30000000000000004|1e-07|[1, 2]"]）`);
  const p = run('x = 3.14159\nprint("%.2f" % x, "%d" % 7)', 'py');
  ok(!p.err && J(p.out) === J(['3.14 7']), `H-1 % の書式は従来どおり → ${p.err ? 'ERR ' + p.err : J(p.out)}（期待 ["3.14 7"]）`);
}

// H-2 (25) 自己記述 `{x=}`（式の本文・= と空白を残す。変換も書式指定も無ければ repr）と変換 `!r`／`!s`／`!a`。
gVals('H-2', [
  ['f"{x=}"（probe の (25)）', 'x = 5\nprint(f"{x=}")', 0, ['x=5'], "「')' を期待しましたが '=' (行 2)」"],
  ['f"{x = }"（空白を残す）', 'x = 5\nprint(f"{x = }")', 0, ['x = 5'], "「')' を期待しましたが '=' (行 2)」"],
  ['f"{x=:.2f}"', 'x = 3.14159\nprint(f"{x=:.2f}")', 0, ['x=3.14'], "「')' を期待しましたが '=' (行 2)」"],
  ["f\"{s=}\"＝s='a'・空の書式指定 {s=:} と !s は str・!r は 'a'（probe の (25) !r）", 's = "a"\nprint(f"{s=}|{s=:}|{s=!s}|{s!r}|{s!s}|{s!a}")', 0, ["s='a'|s=a|s=a|'a'|a|'a'"], "「')' を期待しましたが '=' (行 2)」（!r だけなら a）"],
  ['!r の引用符の選び方とエスケープ', 's = "it\'s\\n"\nprint(f"{s!r}")', 0, ['"it\'s\\n"'], '["it\'s⏎"]'],
  ['!a は ASCII 以外を \\x・\\u に', 's = "é日"\nprint(f"{s!a}|{s!r}")', 0, ["'\\xe9\\u65e5'|'é日'"], '["é日|é日"]'],
  ['式の自己記述と書式指定', 'x = 5\nprint(f"{x+1=}|{x * 2 = :>4}|")', 0, ['x+1=6|x * 2 =   10|'], "「')' を期待しましたが '=' (行 2)」"],
  ['変換の後の書式指定', 'x = 5\nprint(f"{x!r:>4}|{x=!r:>4}|")', 0, ['   5|x=   5|'], "「')' を期待しましたが '=' (行 2)」"],
  ['入れ子の f-string の中の自己記述', "x = 5\nprint(f\"{f'{x=}'}\")", 0, ['x=5'], "「')' を期待しましたが '=' (行 2)」"],
]);
// H-3 (26) 書式指定の中の入れ子の置換フィールド。
gVals('H-3', [
  ['f"{x:{w}}"', 'x = 5\nw = 6\nprint(f"{x:{w}}|")', 0, ['     5|'], '["5|"]'],
  ["f\"{x:{'>'}{w}}\"", "x = 5\nw = 6\nprint(f\"{x:{'>'}{w}}|\")", 0, ['     5|'], '["5|"]'],
  ['f"{x:{w}.{p}f}"', 'x = 3.14159\nw = 8\np = 3\nprint(f"{x:{w}.{p}f}|")', 0, ['   3.142|'], '["3.14159|"]'],
  ["f\"{x:{'*'}^{9}}\"", "x = 5\nprint(f\"{x:{'*'}^{9}}|\")", 0, ['****5****|'], '["5|"]'],
  ['f"{x:{w=}}"（入れ子の自己記述＝書式指定 "w=6"）', 'x = 5\nw = 6\nprint(f"{x:{w=}}|")', 0, ['wwwww5|'], '["5|"]'],
]);
// H-4 (23) リテラル部の単独の `}` は構文エラー（行＝その `}` の物理行・python3 と同じ SyntaxError）。`}}` は `}`。通常の f-string の `\{`／`\}` は
//   `\` と波括弧（python3 は未知のエスケープの `\` を残す。是正前は `\` を落とした波括弧 1 文字）。
gErrs('H-4', [
  ['f"a}b"（2 行目）', 'x = 5\ns = f"a}b"', 'interp.syn.fstrRBrace', 2, {}, /^SyntaxError: f-string: single '}' is not allowed/, '[]（s は "a}b"）'],
  ['三重引用符の 2 行目の }（物理行）', 'x = 5\ns = f"""a\n}"""', 'interp.syn.fstrRBrace', 3, {}, /^SyntaxError: f-string: single '}' is not allowed/, '[]（s は "a⏎}"）'],
  ['f"{x}}"（フィールドの後ろの単独の }）', 'x = 5\nprint(f"{x}}")', 'interp.syn.fstrRBrace', 2, {}, /^SyntaxError: f-string: single '}' is not allowed/, '["5}"]'],
  ['f"a\\}b"（\\ の後ろの単独の }）', 'x = 5\nprint(f"a\\}b")', 'interp.syn.fstrRBrace', 2, {}, /^SyntaxError: f-string: single '}' is not allowed/, '["a}b"]'],
]);
gVals('H-4', [
  ['f"a}}b{{c}}"（従来どおり）', 'print(f"a}}b{{c}}")', 0, ['a}b{c}'], '同じ'],
  ['f"a\\}}b"・f"a\\{x}b"（\\ を残す）', 'x = 5\nprint(f"a\\}}b|a\\{x}b")', 0, ['a\\}b|a\\5b'], '["a}b|a5b"]'],
]);
// H-5 キーワード引数（使えるのは .format(…) だけ・位置引数の後ろ・同じ名前は 1 回）。.format 以外のキーワード引数（print の end= 等）は
//   python3 では有効だが未対応＝読み込みの時点の構文エラー kwArg（是正前も構文エラー「')' を期待しましたが '='」）。
gErrs('H-5', [
  ['print(x, end="")（未対応・python3 は 1）', 'x = 1\nprint(x, end="")', 'interp.syn.kwArg', 2, { name: 'end' }, null, "「')' を期待しましたが '=' (行 2)」"],
  ['ユーザー関数のキーワード引数（未対応・python3 は 1）', 'def f(a):\n    return a\nprint(f(a=1))', 'interp.syn.kwArg', 3, { name: 'a' }, null, "「')' を期待しましたが '=' (行 3)」"],
  ['キーワード引数の後ろの位置引数', 'print("{}".format(a=1, 2))', 'interp.syn.posAfterKw', 1, {}, /^SyntaxError: positional argument follows keyword argument/, "「')' を期待しましたが '=' (行 1)」"],
  ['同じ名前のキーワード引数', 'print("{a}".format(a=1, a=2))', 'interp.syn.kwRepeat', 1, { name: 'a' }, /^SyntaxError: keyword argument repeated: a/, "「')' を期待しましたが '=' (行 1)」"],
]);
{ // キーワード引数の無い呼び出しの AST は是正前と同じ形（kwargs を持たない）・ある呼び出しだけ kwargs を持つ。
  const { parsePy } = await imp('interp/parser_py.js');
  const calls = (n, acc = []) => { if (Array.isArray(n)) n.forEach((x) => calls(x, acc)); else if (n && typeof n === 'object') { if (n.t === 'call') acc.push(n); Object.values(n).forEach((x) => calls(x, acc)); } return acc; };
  const a = calls(parsePy('print(len("ab"), "{}".format(1))'));
  let b = [];
  try { b = calls(parsePy('print("{a}".format(a=1))')); } catch (e) { b = []; }   // 是正前の木（--root）は構文エラー
  ok(a.length === 3 && a.every((c) => !('kwargs' in c)) && b.length === 2 && J(b.map((c) => c.kwargs ? c.kwargs.map((k) => k.name) : null)) === J([null, ['a']]),
    `H-5 キーワード引数の無い呼び出しの節に kwargs は無い（${a.length} 本）・ある呼び出しだけ kwargs（${J(b.map((c) => c.kwargs ? c.kwargs.map((k) => k.name) : null))}）`);
}

// ── I) BK4 値の意味論（(3)(4)(5)(6)(8)(11)(17)）──────────────────────────────────────────
console.log('\nI) BK4 値の意味論（ゼロ除算・and/or の値と空の list の真偽・True/None の表示・list の ==・bool と数のキー・// ・range の引数）— 是正前（850bbb2）の値は各表の最後の列');
// I-1 (3) 除数の False・0 の負のべき・0.0 の除数は divZero（行番号付き・python3 は ZeroDivisionError）。2 ** -1・0 ** 0 は不変。
gErrs('I-1', [
  ['0 ** -1（probe の (3)）', 'x = 1\nprint(0 ** -1)', 'interp.err.divZero', 2, {}, /^ZeroDivisionError/, '["Infinity"]'],
  ['1 / False（probe の (3)）', 'print(1 / False)', 'interp.err.divZero', 1, {}, /^ZeroDivisionError/, '["Infinity"]'],
  ['1 // False', 'print(1 // False)', 'interp.err.divZero', 1, {}, /^ZeroDivisionError/, '["Infinity"]'],
  ['7 % False', 'print(7 % False)', 'interp.err.divZero', 1, {}, /^ZeroDivisionError/, '["NaN"]'],
  ['1 / 0.0（従来どおり）', 'print(1 / 0.0)', 'interp.err.divZero', 1, {}, /^ZeroDivisionError/, '同じ'],
  ['0.0 ** -1.5', 'print(0.0 ** -1.5)', 'interp.err.divZero', 1, {}, /^ZeroDivisionError/, '["Infinity"]'],
  ['False ** -2', 'print(False ** -2)', 'interp.err.divZero', 1, {}, /^ZeroDivisionError/, '["Infinity"]'],
  ['x //= False（複合代入・2 行目）', 'x = 7\nx //= False', 'interp.err.divZero', 2, {}, /^ZeroDivisionError/, 'x が Infinity'],
  ['関数の中の 0 ** -1（return の行）', 'def f(b):\n    return 0 ** b\nprint(f(-1))', 'interp.err.divZero', 2, {}, /^ZeroDivisionError/, '["Infinity"]'],
]);
gVals('I-1', [
  ['2 ** -1・0 ** 0・0 ** 2（不変）', 'print(2 ** -1, 0 ** 0, 0 ** 2)', 0, ['0.5 1 0'], '同じ'],
]);
// I-2 (4) and／or は被演算子の値を返す。py の真偽（if・while・not・and・or・三項・bool()）は空の list／tuple／dict も偽（python3 と同じ）。
//   是正前は `0 and 1` が false（表示 false）・空の list／dict が真（`[] or 0` が []・`if []:` が本体を走らせた）。
gVals('I-2', [
  ['0 and 1（probe の (4)）', 'print(0 and 1)', 0, ['0'], '["false"]'],
  ['"" or "x"', 'print("" or "x")', 0, ['x'], '同じ'],
  ['[] or 0', 'print([] or 0)', 0, ['0'], '[""]（[] は真）'],
  ['1 and 2・5 and None・None or 5・0 or ""', 'print(1 and 2, 5 and None, None or 5, 0 or "")', 0, ['2 None 5 '], '["2 0 5 "]'],
  ['1 and 0 or 3・not 0 and 2・len([] and 1)', 'print(1 and 0 or 3, not 0 and 2, len([] and 1))', 0, ['3 2 0'], 'len(1) のエラー（[] は真）'],
  ['x = 0 and f()（短絡・f を呼ばない）', 'def f():\n    print("called")\n    return 1\nx = 0 and f()\nprint(x)', 0, ['0'], '["false"]'],
  ['if／while の判定（数・文字列・None・list）', 'n = 0\nfor v in [0, 1, "", "a", None, [], [0], {}, {"k": 1}]:\n    if v:\n        n += 1\nprint(n)', 0, ['4'], '["6"]（[]・{} が真）'],
  ['while q:（空になったら止まる）', 'q = [1, 2, 3]\nn = 0\nwhile q:\n    q.pop()\n    n += 1\nprint(n)', 0, ['3'], 'ステップ上限エラー（[] が真）'],
  ['not []・bool([])・bool([0])・bool({})', 'print(not [], bool([]), bool([0]), bool({}))', 0, ['True False True False'], '["false true true true"]'],
  ['if x and y:（真偽の判定は従来どおり）', 'x = 2\ny = 0\nif x and y:\n    print("a")\nelif x or y:\n    print("b")', 0, ['b'], '同じ'],
]);
// I-3 (5) py の print／str／f-string／str.format／`%s` の bool は True／False・None は None（python3 と同じ）。値の無い return・return の無い関数・
//   dict.get の見つからないキーは None。bool に空でない書式指定は int（従来どおり・python3 と同じ）。是正前は true／false・None が数の 0。
gVals('I-3', [
  ['print(True, None, False)（probe の (5)）', 'print(True, None, False)', 0, ['True None False'], '["true 0 false"]'],
  ['print(None)', 'print(None)', 0, ['None'], '["0"]'],
  ['str(False)・str(None)・str(True) + "!"', 'print(str(False), str(None), str(True) + "!")', 0, ['False None True!'], '["false 0 true!"]'],
  ['f"{True}"・f"{None}"・f"{True!r}"', 'print(f"{True}|{None}|{True!r}|{False!s}")', 0, ['True|None|True|False'], '["true|0|true|false"]'],
  ['"{}".format(False)・"%s" % True', 'print("{} {}".format(False, None), "%s" % True)', 0, ['False None True'], '["false 0 true"]'],
  ['比較の結果の表示', 'print(1 == 1, 2 < 1, not 0, [1] == [1])', 0, ['True False True True'], '["true false true false"]'],
  ['return の無い関数・値の無い return・dict.get', 'def f():\n    pass\ndef g():\n    return\nd = {}\nprint(f(), g(), d.get("k"))', 0, ['None None None'], '["  "]'],
  ['bool に書式指定は int（従来どおり）', 'print(f"[{True:>5}][{False:d}]")', 0, ['[    1][0]'], '同じ'],
  ['True + 1・True * 3（数として）', 'print(True + 1, True * 3)', 0, ['2 3'], '同じ'],
  ['Model A の loop() の中の print(True)（1 tick）', 'def loop():\n    print(5 > 3)', 1, ['True'], '["true"]'],
]);
{ // C は従来どおり（print(true) は "true"・&& は偽のとき false・除数の false は Infinity・配列の == は同一性）。
  const r = run('void setup() {\n  int a[2] = {1, 2};\n  int b[2] = {1, 2};\n  print(true); print(false); Serial.println(true);\n  print(0 && 5); print(2 && 5); print(0 || 7);\n  print(1 / false); print(a == b);\n}\nvoid loop() {}', 'c');
  const want = ['true', 'false', 'true', 'false', '5', '7', 'Infinity', 'false'];
  ok(!r.err && J(r.out) === J(want), `I-3 C は従来どおり → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ${J(want)}＝是正前と同じ）`);
}
// I-4 (6) list／tuple の ==／!= は要素ごと（入れ子・長さ違い・要素の型違い）。`in` も同じ規則。`is` は未対応のまま（構文エラー）。
//   残る差: list と tuple を区別しない（`[1, 2] == (1, 2)` は True・python3 は False）・dict の == は同一性のまま。
{
  const EQ = [
    ['[1, 2] == [1, 2]', 'True'], ['[1, 2] != [1, 2]', 'False'], ['[1, [2, 3]] == [1, [2, 3]]', 'True'], ['[1, 2] == [1, 2, 3]', 'False'],
    ['[1] == ["1"]', 'False'], ['[True] == [1]', 'True'], ['[1.0, 2] == [1, 2]', 'True'], ['(1, 2) == (1, 2)', 'True'],
    ['[1, 2] == [2, 1]', 'False'], ['[] == []', 'True'], ['[1, 2] == 1', 'False'], ['[[1]] != [[2]]', 'True'],
    ['[1, 2] in [[1, 2]]', 'True'], ['[None] == [None]', 'True'], ['[0] == [False]', 'True'], ['["a", [1]] == ["a", [True]]', 'True'],
  ];
  gVals('I-4', EQ.map(([e, v]) => [e, `print(${e})`, 0, [v], (e.includes('!=') ? '["true"]' : '["false"]') + '（同一性）']));
}
gVals('I-4', [
  ['同じ list（a = b）', 'a = [1]\nb = a\nprint(a == b, a != b)', 0, ['True False'], '["true false"]'],
  ['if x == [1, 2]:', 'x = [1, 2]\nif x == [1, 2]:\n    print("eq")\nelse:\n    print("ne")', 0, ['eq'], '["ne"]'],
]);
{ // 自分自身を要素に持つ別々の list 同士は、比べている途中の同じ組に戻ったら等しいとみなす（python3 は RecursionError＝未是正の差。組を覚えないと
  //   JS の呼び出しスタックが尽き、トップレベルでは RangeError が素のまま出る）。
  const r = run('a = [1]\na.append(a)\nb = [1]\nb.append(b)\nc = [2]\nc.append(c)\nprint(a == b, a == c, a == a)', 'py');
  ok(!r.err && J(r.out) === J(['True False True']), `I-4 自分自身を要素に持つ list の == → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ["True False True"]・RangeError を出さない・是正前 ["false false true"]）`);
}
gErrs('I-4', [
  ['x is None（未対応・python3 は True）', 'x = None\nprint(x is None)', 'interp.syn.expected', 2, null, null, '同じ'],
]);
// I-5 (8) bool と数を数として比べる: list の count／index／remove（pySame）・dict のキー（リテラル・添字・get・pop・in）・list／str の添字。
//   (11) index は start／end（負は末尾から）・index と remove は見つからなければ interp.err.notInList（python3 は ValueError）。
gVals('I-5', [
  ['[True].count(1)・[1, True, 1.0].count(True)・[0, False].count(0)', 'print([True].count(1), [1, True, 1.0].count(True), [0, False].count(0))', 0, ['1 3 2'], '["0 1 1"]'],
  ['[1].index(True)・[2, 3].index(3)', 'print([1].index(True), [2, 3].index(3))', 0, ['0 1'], '["-1 1"]'],
  ['{1: "a"}.get(True)・{True: "t"}[1]・{1: "a"}.pop(True)', 'print({1: "a"}.get(True), {True: "t"}[1], {1: "a"}.pop(True))', 0, ['a t a'], '["  "]（キー "true"・get／pop は None＝表示は空）'],
  ['True in {1: "a"}・[5, 6][True]・"ab"[True]', 'print(True in {1: "a"}, [5, 6][True], "ab"[True])', 0, ['True 6 b'], '["false  "]'],
  ['index の start／end', 'print([1, 2, 1].index(1, 1), [1, 2, 1].index(1, -2), [1, 2, 1].index(2, 0, 2))', 0, ['2 2 1'], '["0 0 1"]'],
  ['x.remove(True)（最初の 1 と等しい要素）', 'x = [2, 1, True]\nx.remove(True)\nprint(len(x), x[0], x[1])', 0, ['2 2 True'], '["2 2 1"]（True そのものを消した）'],
  ['[[1, 2]].index([1, 2])（list も要素ごと）', 'print([[1, 2]].index([1, 2]), [[1], [1]].count([1]))', 0, ['0 2'], '["-1 0"]'],
]);
gErrs('I-5', [
  ['[1].index(5)（2 行目）', 'x = [1]\nprint(x.index(5))', 'interp.err.notInList', 2, { method: 'index' }, /^ValueError/, '["-1"]'],
  ['index の start より後ろに無い', 'print([1, 2, 1].index(2, 2))', 'interp.err.notInList', 1, { method: 'index' }, /^ValueError/, '["1"]'],
  ['[1].remove(5)', 'x = [1]\nx.remove(5)\nprint(x)', 'interp.err.notInList', 2, { method: 'remove' }, /^ValueError: list\.remove\(x\): x not in list/, '["1"]（黙って何もしない）'],
]);
// I-6 (11) // は python3 と同じ床除算（CPython の float の divmod の手順・1 // 0.1 は 9.0）。値は == で比べて True で照合する（float の表示は未是正の差）。
gVals('I-6', [
  ['1 // 0.1 == 9（probe の (11)）', 'print(1 // 0.1 == 9, int(1 // 0.1))', 0, ['True 9'], '["false 10"]'],
  ['-1 // 0.1 == -10・7.5 // 2 == 3・5 // -0.5 == -10・-0.5 // 1 == -1', 'print(-1 // 0.1 == -10, 7.5 // 2 == 3, 5 // -0.5 == -10, -0.5 // 1 == -1)', 0, ['True True True True'], '["true true true true"]（表示だけ違う）'],
  ['整数（従来どおり）', 'print(7 // 2, -7 // 2, 7 // -2, -8 // 3, 0 // 5)', 0, ['3 -4 -4 -3 0'], '同じ'],
  ['inf（1 // inf・-1 // inf・1e300 // 1e-10）', 'import math\nprint(1 // math.inf == 0, -1 // math.inf == -1, 1e300 // 1e-10 == math.inf)', 0, ['True True True'], '["true false true"]（-1 // inf が -0）'],
  ['x //= 0.1', 'x = 1\nx //= 0.1\nprint(x == 9)', 0, ['True'], '["false"]'],
  ['0.3 // 0.1 == 2・2.0 // 0.5 == 4', 'print(0.3 // 0.1 == 2, 2.0 // 0.5 == 4)', 0, ['True True'], '["true true"]（表示だけ違う）'],
]);
// I-7 (17) range の引数は整数（bool は数）。それ以外は interp.err.rangeArg（python3 は TypeError）・式の range(…) の 0 のステップも rangeStepZero。
gErrs('I-7', [
  ['for i in range(1, 5, None)（probe の (17)）', 'for i in range(1, 5, None):\n    print(i)', 'interp.err.rangeArg', 1, { type: 'None' }, /^TypeError: 'NoneType' object cannot be interpreted as an integer/, '「range() のステップ (3 番目の引数) に 0 は使えません」'],
  ['list(range(1, 5, None))（2 行目）', 'x = 1\nprint(list(range(1, 5, None)))', 'interp.err.rangeArg', 2, { type: 'None' }, /^TypeError: 'NoneType' object cannot be interpreted as an integer/, '[""]（黙って空）'],
  ['range(2.5)', 'print(list(range(2.5)))', 'interp.err.rangeArg', 1, { type: 'float' }, /^TypeError: 'float' object cannot be interpreted as an integer/, '["0,1,2"]'],
  ['for i in range("3")', 'for i in range("3"):\n    pass', 'interp.err.rangeArg', 1, { type: 'str' }, /^TypeError: 'str' object cannot be interpreted as an integer/, '0 回'],
  ['list(range(1, 5, 0))（式の range）', 'print(list(range(1, 5, 0)))', 'interp.err.rangeStepZero', 1, {}, /^ValueError: range\(\) arg 3 must not be zero/, '[""]（黙って空）'],
]);
gVals('I-7', [
  ['range(True, 3)・range(4 // 2)・負のステップ（従来どおり）', 'for i in range(True, 3):\n    print(i)\nprint(len(range(4 // 2)), list(range(3, 0, -1))[2])', 0, ['1', '2', '2 1'], '["true","2","2 1"]'],
]);
// I-8 None（null）の演算と添字は実行時エラー（python3 は TypeError）。==・!=・in と `%s` の書式は通す。是正前は None が数の 0。
gErrs('I-8', [
  ['x = None; x += 1（2 行目）', 'x = None\nx += 1', 'interp.err.noneOp', 2, { op: '+' }, /^TypeError: unsupported operand/, 'x が 1'],
  ['1 / None', 'print(1 / None)', 'interp.err.noneOp', 1, { op: '/' }, /^TypeError: unsupported operand/, '「0 で割ることはできません」'],
  ['None < 1', 'print(None < 1)', 'interp.err.noneOp', 1, { op: '<' }, /^TypeError: '<' not supported/, '["true"]'],
  ['-None', 'print(-None)', 'interp.err.noneOp', 1, { op: '-' }, /^TypeError: bad operand type for unary -/, '["0"]'],
  ['return の無い関数の値 + 1', 'def f():\n    pass\ny = f() + 1', 'interp.err.noneOp', 3, { op: '+' }, /^TypeError: unsupported operand/, 'y が NaN'],
  ['None[0]', 'x = None\nprint(x[0])', 'interp.err.noneIndex', 2, {}, /^TypeError: 'NoneType' object is not subscriptable/, '[""]'],
  ['f"{None:>5}"（書式指定・fmtType）', 'print(f"{None:>5}")', 'interp.err.fmtType', 1, { type: 'None', spec: '>5' }, /^TypeError: unsupported format string passed to NoneType\.__format__/, '["    0"]'],
]);
gVals('I-8', [
  ['None == 0・None == None・None != 0・None in [None]・"%s" % None', 'print(None == 0, None == None, None != 0, None in [None], "%s" % None)', 0, ['False True True True None'], '["true true false true 0"]'],
  ['d.get("k") == None・f() == None', 'def f():\n    pass\nd = {}\nprint(d.get("k") == None, f() == None)', 0, ['True True'], '["false false"]'],
  ['while None:（Model B にしない・従来どおり）', 'while None:\n    print(1)\nprint("end")', 0, ['end'], '同じ'],
]);

console.log(`\n  python3 との突き合わせ: ${PY3 ? py3Checked + ' 件' : '0 件（python3 不在）'}`);
console.log(`[結果] pass=${pass} fail=${fail}`);
setLang('ja');
process.exit(fail ? 1 : 0);
