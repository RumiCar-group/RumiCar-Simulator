// wf_bj1_pysem.mjs — Stage BJ「インタプリタ是正 I（高頻度の Python 意味論・CRLF）」の常設ゲート。BJ1 で新設し、BJ2・BJ3 が章を足す。
// ════════════════════════════════════════════════════════════════════════════
// 学習者が自力で原因に辿り着けない「エラーが出ない／意味不明なエラーになる」意味論の穴の是正を、本番経路
//   buildController(src, lang, buildApi(world)) → setup()/tick() と parsePy/parseC で機械検証する（再実装しない・CI-8/CI-14）。
// 期待値は python3 で同じ本文を走らせた値を定数で持つ（2026-10-11・Python 3.14.4 で実測）。python3 があるホストでは同じ本文を
//   python3 でも実行して定数と突き合わせる（定数が Python から黙ってずれない）。無いホストでは定数だけで判定し、その旨を表示する。
//
// BJ1（字句・構文の穴）— 是正前（HEAD ba977c1）の値は各章の見出しに書いた。`--root <是正前の木>` で回すと A〜D が赤になる。
//   A) `for v in range(a, b[, step])` の複数引数。是正前は parser_py の forStmt が引数列を expr()（タプルを含む）で 1 つの式として
//      読み、end＝タプル・start＝0 になって 0 回ループしていた（range(2,5) で何も出ない）。単引数は従来と同じ AST。
//   B) 複合代入 `%=`・`//=`・`**=`（是正前は構文エラー「予期しないトークン '='／'**='」）。0 での `%=`・`//=` は行番号付きの
//      ゼロ除算エラー（applyBin の既存の判定を通る）。
//   C) 文字列エスケープ `\n \t \r \\ \" \' \0`（py・C・f-string・#define の置換本体）。是正前は `\` の次の文字をそのまま足した
//      （"a\tb" → "atb"・'\0' → "0"）。未知のエスケープは PLAN BJ1 の仕様どおり従来の挙動（`\` を落として次の文字）を保つ＝
//      Python（`\q` を 2 文字のまま残す）とは違うので python3 との照合はしない（表示だけ）。
//   D) CRLF（ファイル取込・GitHub 取込は本文をそのまま渡す）: LF 版と CRLF 版の AST が一致し、実行結果も一致。是正前は
//      SAMPLES.py の CRLF 版が「予期しないトークン 'INDENT'」、ブロック内に空行を含むフィクスチャも同じ。`\` による行継続の
//      CRLF 版は「不明な文字 '\'」だった（py・C 共通）。
//   E) 出荷サンプルの AST 指紋（BJ1 の是正前 HEAD と是正後で一致した sha256）。**本文が同じなら AST も同じ**であること＝
//      インタプリタの改修が出荷サンプルの解釈を黙って変えていないことを見張る（BJ2・BJ3 の陰性対照）。
//      BJ2 で締めた: 出荷の全見本（PROGRAMS＋SAMPLES・js を含む）が表に載り本文も一致することを要求する（1 本でも照合外なら赤）。
//      js の見本はパーサを通らない（new Function）ので本文の指紋だけを照合する。見本の本文を意図して変えたら表を刻み直す。
//
// BJ2（演算子の意味論）— 是正前（HEAD bf780f8）の値は F 章の見出しに書いた。`--root <是正前の木>` で回すと F 章が赤になる（A〜E は緑）。
//   F) py の演算子（parser_py の factor/power・evaluator の applyBin に this.lang）: `%` は床剰余（符号は除数に従う・文字列の
//      `%` 書式は従来どおり）・`**` は単項マイナスより強く右結合で右辺に単項を許す（-2**2 = -4・2**-1 = 0.5）・`==`/`!=` は
//      bool と数を数として比べる（True == 1）。`//` は従来どおり Math.floor。値表は python3 の json.dumps の出力を定数で持ち、
//      本処理系の値と型ごとに突き合わせる（bool は bool・数は 1e-12）。C の同じ値表（`**` と `//` を除く）は是正前の HEAD で
//      測った値と byte 一致（C は無改変）。あわせて BJ1 の層 4 指摘: f-string の埋め込み式を py モードで字句解析し
//      （f"{7//2}" → "3"）二重のエスケープ解除をしない（f"{'\\n'}" → `\` と n の 2 文字）・文字列リテラルの中の CRLF を
//      LF に正規化・タプル左辺の複合代入（a, b %= 3）を構文エラーに。
//
// BJ3（スコープと制御フロー）— 是正前（HEAD ae61111）の値は G 章の見出しに書いた。`--root <是正前の木>` で回すと G 章が赤になる（A〜F は緑）。
//   G) py の for（forrange／forin）はスコープを作らない: ループ変数は囲むスコープへ直接置き（関数の中の for i は同名のグローバル i を
//      書き換えない）、本体の新しい変数もループ後に残る・0 回のループはループ変数を作らない（G-1・python3 と照合）。是正前は
//      `for i in range(3): last = i` の後の last と i が「未定義の変数/名前」・関数の中の for i の後の i がグローバルの値（100 100）。
//      C の for はブロックスコープのまま（G-2）。人間判断①（global 宣言なしの関数内代入は既存のグローバルを書き換える）は維持し、
//      python3 との差（python3 は -1）を定数で持つ。Model B（トップレベルの while True:）の本体の直下の continue＝その tick を終える・
//      break＝以降の tick は何もしない（人間判断②・G-3。本番の tickSlot で running とログを見る。是正前は「【実行時エラー】[object Object]」
//      で停止）。ループの外の break／continue（loop()／setup()／ユーザー関数の直下・トップレベル・Model C）と関数の外の return は行番号付きの
//      i18n 実行時エラー breakOutside／continueOutside／returnOutside（G-4／G-5。是正前は `[object Object]`、ループの中から呼んだ関数の
//      直下の break／continue は呼び出し側のループに黙って効いた）。range のステップ 0 は rangeStepZero（G-6。是正前は start <= end で
//      黙って 0 回・start > end でステップ上限エラー）。G-7 は配線（runner.js・evaluator.js に throw new Error( 0 件・新キーの ja/en）。
//      層 4 の指摘で追加: Model B で break したらループの後ろの文をその tick で 1 回だけ走らせて終える（G-3。是正前は [object Object]）・
//      ユーザー関数から戻ったら curLine を呼び出し元の文の行へ戻す（G-8。是正前は `x = 10 / f()` のゼロ除算・`for c in f():` の
//      notIterable などが呼ばれた関数の最後の文の行を指した）・関数の中の for x の後の x = 10 が関数ローカルになったこと・仮引数や
//      ホストの名前と同名のループ変数（G-1）。未是正の差（global x を宣言した関数の中の for x）は今の値と python3 の値を定数で持つ。
//
// 使い方: node wf_bj1_pysem.mjs              … 検査
//         node wf_bj1_pysem.mjs --root <dir>  … <dir>/public/js の product で回す（改修前の木で赤になることの確認用）
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
const imp = (f) => import(pathToFileURL(join(ROOT, 'public/js', f)).href);
const { buildController } = await imp('runner.js');
const { buildApi } = await imp('api.js');
const { parsePy } = await imp('interp/parser_py.js');
const { parseC } = await imp('interp/parser_c.js');
const { buildFromSpec } = await imp('course.js');
const { DynCar } = await imp('physics_dyn.js');
const { PROGRAMS } = await imp('programs.js');
const { SAMPLES } = await imp('samples.js');
const { setLang } = await imp('i18n.js');
const { MESSAGES } = await imp('i18n/messages.js');
const { makeSlot, tickSlot } = await imp('fleet.js');
const { CONST } = await imp('config.js');
setLang('ja');

let pass = 0, fail = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? '○' : '✗'} ${msg}`); if (cond) pass++; else fail++; return cond; };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const J = (v) => JSON.stringify(v);

const specs = JSON.parse(readFileSync(join(HERE, 'public/data/courses.json'), 'utf8'));
const course = buildFromSpec(specs[0]);
// 1 本を本番経路で走らせる。out＝print/Serial の出力行・vars＝プログラムのグローバル（AO10 の読み取り口 ctrl.interp）・
//   err/key/line＝例外（i18n キーと行）。py のトップレベルは setup() で 1 回走る。def loop() を持つものは ticks 回 tick() する。
function run(code, lang, ticks = 0) {
  const out = [];
  const world = { car: new DynCar(course.start), walls: course.walls, start: course.start,
    log: (m) => out.push(String(m)), _sensors: [], _pendingDelay: 0, _others: [] };
  let ctrl = null;
  try {
    ctrl = buildController(code, lang, buildApi(world));
    ctrl.setup();
    for (let i = 0; i < ticks; i++) ctrl.tick();
    return { out, vars: ctrl.interp ? ctrl.interp.global.vars : null };
  } catch (e) { return { out, err: e.message || String(e), key: e.i18nKey, line: e.line }; }
}
const astOf = (src, lang) => { try { return J(lang === 'py' ? parsePy(src) : parseC(src)); } catch (e) { return 'ERR: ' + (e.message || e); } };
const crlf = (s) => s.replace(/\n/g, '\r\n');

// python3（任意）。同じ本文を -I（隔離モード）で実行し、標準出力の行を返す。無ければ null。
const PY3 = (() => {
  const r = spawnSync('python3', ['-I', '-c', 'import sys; print(sys.version.split()[0])'], { encoding: 'utf8', timeout: 20000 });
  return r.error || r.status !== 0 ? null : r.stdout.trim();
})();
function py3(src) {
  const r = spawnSync('python3', ['-I', '-W', 'ignore', '-c', src], { encoding: 'utf8', timeout: 20000 });
  if (r.error || r.status !== 0) return { err: (r.error && r.error.message) || r.stderr.trim().split('\n').pop() };
  return { out: r.stdout.replace(/\n$/, '').split('\n') };
}
// 数として読めるもの同士は数で比べる（Python は 7.5//2 を "3.0" と書き、本処理系は "3" と書く＝表記の差で値の差ではない）。
const numEq = (a, b) => {
  const x = Number(a), y = Number(b);
  if (a !== '' && b !== '' && Number.isFinite(x) && Number.isFinite(y)) return Math.abs(x - y) <= 1e-12;
  return a === b;
};
const linesEq = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => numEq(v, b[i]));
let py3Checked = 0;
// 定数（python3 の実測）が今のホストの python3 と一致するか。python3 が無ければ判定しない（件数だけ数えない）。
function checkPy3(label, pySrc, want) {
  if (!PY3) return;
  const r = py3(pySrc);
  py3Checked++;
  ok(!r.err && J(r.out) === J(want), `${label}: python3 ${PY3} の出力 ${r.err ? 'ERR ' + r.err : J(r.out)} ＝ 定数 ${J(want)}`);
}
// BJ2: python3 でも同じ本文がエラーになること（エラーの種類を正規表現で見る）。python3 が無ければ判定しない。
function checkPy3Err(label, pySrc, re) {
  if (!PY3) return;
  const r = py3(pySrc);
  py3Checked++;
  ok(!!r.err && re.test(r.err), `${label}: python3 ${PY3} も ${re} で止まる（実 ${r.err ? r.err : 'エラーなし ' + J(r.out)}）`);
}

console.log(`[BJ1] wf_bj1_pysem — product: ${join(ROOT, 'public/js')}${ROOT === HERE ? '' : '（--root）'}`);
console.log(`  python3: ${PY3 ? PY3 + '（定数と同じ本文の実行結果を突き合わせる）' : '不在（定数＝2026-10-11 の Python 3.14.4 の実測で判定）'}`);

// ── A) range の複数引数 ─────────────────────────────────────────────────────
console.log('\nA) for v in range(a, b[, step]) — 是正前: range(2,5)／range(5,0,-2) が 0 回（単引数だけ正常）');
const RANGE = [
  // [ラベル, 本文, python3 の出力（定数）, tick 数]
  ['range(2,5)', 'for i in range(2,5):\n  print(i)', ['2', '3', '4']],
  ['range(5,0,-2)', 'for i in range(5,0,-2):\n  print(i)', ['5', '3', '1']],
  ['range(3)', 'for i in range(3):\n  print(i)', ['0', '1', '2']],
  ['range(0, 10, 3)', 'for i in range(0, 10, 3):\n  print(i)', ['0', '3', '6', '9']],
  ['range(n - 1, -1, -1)', 'n = 3\nfor i in range(n - 1, -1, -1):\n  print(i)', ['2', '1', '0']],
  ['range(1 if f else 0, 3)', 'f = 1\nfor i in range(1 if f else 0, 3):\n  print(i)', ['1', '2']],
  ['range(-3, -1)', 'for i in range(-3, -1):\n  print(i)', ['-3', '-2']],
  ['range(len(a))', 'a = [5, 6]\nfor i in range(len(a)):\n  print(a[i])', ['5', '6']],
  ['def loop() の中の range(2,5)（Model A・1 tick）', 'def setup():\n  pass\ndef loop():\n  for i in range(2,5):\n    print(i)', ['2', '3', '4'], 1],
];
for (const [label, src, want, ticks] of RANGE) {
  const r = run(src, 'py', ticks || 0);
  ok(!r.err && linesEq(r.out, want), `${label} → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ${J(want)}）`);
  checkPy3(label, ticks ? src + '\nsetup()\nloop()\n' : src, want);
}
{ // BJ2（BJ1 層 4 F4）: 引数 4 個は構文エラー（Python は TypeError）。第 3 引数を expr() で読むとタプル (3, 4) になり黙って走る。
  const src = 'for i in range(1,2,3,4):\n  print(i)';
  const r = run(src, 'py');
  ok(!!r.err && r.err.startsWith('構文エラー(Py)') && r.out.length === 0, `range(1,2,3,4) → 構文エラー（実 ${r.err ? r.err : '走った ' + J(r.out)}）`);
  checkPy3Err('range(1,2,3,4)', src, /^TypeError: range expected at most 3 arguments/);
}

// ── B) 複合代入 %= //= **= ───────────────────────────────────────────────────
console.log('\nB) 複合代入 %=・//=・**= — 是正前: いずれも構文エラー');
const MASSIGN = [
  ['x %= 3（x=7）', 'x = 7\nx %= 3\nprint(x)', ['1']],
  ['x //= 2（x=7）', 'x = 7\nx //= 2\nprint(x)', ['3']],
  ['x **= 2（x=7）', 'x = 7\nx **= 2\nprint(x)', ['49']],
  ['x //= 2（x=7.5）', 'x = 7.5\nx //= 2\nprint(x)', ['3.0']],
  ['x **= 0.5（x=16）', 'x = 16\nx **= 0.5\nprint(x)', ['4.0']],
  ['a[1] %= 4', 'a = [1, 10]\na[1] %= 4\nprint(a[1])', ['2']],
  ['d["k"] **= 2', 'd = {"k": 3}\nd["k"] **= 2\nprint(d["k"])', ['9']],
  ['x%=3（空白なし）', 'x=7\nx%=3\nprint(x)', ['1']],
  ['s %= 5（文字列の書式）', 's = "v=%d"\ns %= 5\nprint(s)', ['v=5']],
];
for (const [label, src, want] of MASSIGN) {
  const r = run(src, 'py');
  ok(!r.err && linesEq(r.out, want), `${label} → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ${J(want)}・数は数として比較）`);
  checkPy3(label, src, want);
}
for (const [label, src] of [['x //= 0', 'x = 7\nx //= 0\nprint(x)'], ['x %= 0', 'x = 7\nx %= 0\nprint(x)']]) {
  const r = run(src, 'py');
  ok(r.key === 'interp.err.divZero' && r.line === 2 && r.out.length === 0,
    `${label} → 行番号付きのゼロ除算エラー（実 key=${r.key} line=${r.line} out=${J(r.out)}・Python も ZeroDivisionError）`);
}
{ // BJ2（BJ1 層 4 F4）: C の `%=` は是正前後とも未対応＝構文エラーのまま（受理範囲を変えない。Stage 案 3 の候補）。
  const r = run('void setup(){\n  int x = 7;\n  x %= 3;\n}\nvoid loop(){}', 'c');
  ok(!!r.err && r.err.startsWith('構文エラー(C)') && /\(行 3\)/.test(r.err), `C の x %= 3 → 構文エラー（行 3）のまま（実 ${r.err ? r.err : '走った'}）`);
}
{
  let node;
  try { node = parsePy('x %= 3\ny //= 2\nz **= 4').body.map((s) => `${s.t}:${s.op}`); } catch (e) { node = 'ERR ' + (e.message || e); }
  ok(J(node) === J(['massign:%=', 'massign://=', 'massign:**=']), `AST は massign（op %=・//=・**=）＝評価器 execMassign の既存経路（実 ${J(node)}）`);
}

// ── C) 文字列エスケープ ─────────────────────────────────────────────────────
console.log('\nC) 文字列エスケープ \\n \\t \\r \\\\ \\" \\\' \\0 — 是正前: "a\\tb" → "atb"（\\ の次の文字をそのまま足した）');
const codes = (s) => (typeof s === 'string' ? [...s].map((c) => c.charCodeAt(0)) : null);
// [ラベル, 言語, 本文, 観測する変数, 期待する文字コード列, python3 で同じリテラルを評価する式（null＝照合しない）]
const C_MAIN = (decl) => `${decl}\nvoid setup(){}\nvoid loop(){}`;
const ESC = [
  ['py "a\\tb"', 'py', 's = "a\\tb"', 's', [97, 9, 98], '"a\\tb"'],
  ['py "a\\nb"', 'py', 's = "a\\nb"', 's', [97, 10, 98], '"a\\nb"'],
  ['py "\\\\"', 'py', 's = "\\\\"', 's', [92], '"\\\\"'],
  ['py "\\""', 'py', 's = "\\""', 's', [34], '"\\""'],
  ["py '\\''", 'py', "s = '\\''", 's', [39], "'\\''"],
  ['py "\\r\\0"', 'py', 's = "\\r\\0"', 's', [13, 0], '"\\r\\0"'],
  ['py f"{x}\\n"', 'py', 'x = 5\ns = f"{x}\\n"', 's', [53, 10], 'f"{5}\\n"'],
  ['py f"a\\tb{x}"', 'py', 'x = 5\ns = f"a\\tb{x}"', 's', [97, 9, 98, 53], 'f"a\\tb{5}"'],
  ['C "a\\tb"', 'c', C_MAIN('auto s = "a\\tb";'), 's', [97, 9, 98], '"a\\tb"'],
  ['C "a\\nb"', 'c', C_MAIN('auto s = "a\\nb";'), 's', [97, 10, 98], '"a\\nb"'],
  ['C "\\\\"', 'c', C_MAIN('auto s = "\\\\";'), 's', [92], '"\\\\"'],
  ['C "\\""', 'c', C_MAIN('auto s = "\\"";'), 's', [34], '"\\""'],
  ["C '\\0'", 'c', C_MAIN("char s = '\\0';"), 's', [0], "'\\0'"],
  ["C '\\n'", 'c', C_MAIN("char s = '\\n';"), 's', [10], "'\\n'"],
  ['C #define MSG "a\\tb"（置換本体も同じ規則）', 'c', '#define MSG "a\\tb"\n' + C_MAIN('auto s = MSG;'), 's', [97, 9, 98], '"a\\tb"'],
  // 未知のエスケープ＝従来どおり（PLAN BJ1 の仕様）。Python は `\q` を 2 文字のまま残すので照合しない。
  ['py "\\q"（未知＝従来どおり "q"）', 'py', 's = "\\q"', 's', [113], null],
  ['py "\\x41"（16 進は扱わない＝従来どおり "x41"）', 'py', 's = "\\x41"', 's', [120, 52, 49], null],
];
for (const [label, lang, src, v, want, pyLit] of ESC) {
  const r = run(src, lang);
  const got = r.vars ? codes(r.vars[v]) : null;
  ok(!r.err && J(got) === J(want), `${label} → ${r.err ? 'ERR ' + r.err : J(got)}（期待 ${J(want)}）`);
  if (pyLit) checkPy3(label, `print([ord(c) for c in ${pyLit}])`, [J(want).replace(/,/g, ', ')]);
}
{ // 出力経路（print → world.log）まで通しても実エスケープのまま・長さ 3
  const r = run('print("a\\tb")\nprint(len("a\\tb"))\nprint("a\\nb")', 'py');
  ok(!r.err && J(r.out) === J(['a\tb', '3', 'a\nb']), `py print 経路: "a\\tb"・len("a\\tb")・"a\\nb" → ${J(r.out)}`);
  const rc = run('void setup(){}\nvoid loop(){ Serial.println("a\\tb"); Serial.println(len("a\\tb")); }', 'c', 1);
  ok(!rc.err && J(rc.out) === J(['a\tb', '3']), `C Serial.println 経路: "a\\tb"・len → ${J(rc.out)}`);
}

// ── D) CRLF ────────────────────────────────────────────────────────────────
console.log('\nD) CRLF — 是正前: SAMPLES.py の CRLF 版とフィクスチャが「予期しないトークン \'INDENT\'」・CRLF の行継続が「不明な文字 \'\\\'」');
// ブロック内の空行・空白だけの行・コメント行（深い列と浅い列）・2 段のインデント戻しを含む固定フィクスチャ（Python として正しい本文）。
const FIXTURE = [
  '# BJ1 CRLF fixture',
  'total = 0',
  '',
  'def step(n):',
  '    global total',
  '    if n > 2:',
  '        total = total + n',
  '',
  '        # comment inside a nested block',
  '    ',
  '        total = total + 1',
  '    else:',
  '',
  '        total = total - 1',
  '  # comment at a shallower column',
  '    return total',
  '',
  'for i in range(5):',
  '    step(i)',
  '',
  'print(total)',
  '',
].join('\n');
const CONT = 'x = 1 + \\\n    2\nif x > 2:\n    y = x + \\\n        1\n\n    print(x, y)\n';
const PY_FIX = [
  ['フィクスチャ（空行・コメント行・インデント戻し）', FIXTURE, 0, ['6']],
  ['行継続 \\ ＋改行', CONT, 0, ['3 4']],
  ['Model B（while True: の本体に空行・2 tick）', 'n = 0\nwhile True:\n  n += 1\n\n  print(n)\n', 2, ['1', '2']],
  ['末尾に改行なし', 'if 1:\n  x = 1\n\n  print(x)', 0, ['1']],
  ['タブ字下げ＋空白だけの行', 'if 1:\n\tx = 2\n\t\n\n\tprint(x)\n', 0, ['2']],
];
for (const [label, src, ticks, want] of PY_FIX) {
  const a = astOf(src, 'py'), b = astOf(crlf(src), 'py');
  ok(!a.startsWith('ERR') && a === b, `py ${label}: LF 版と CRLF 版の AST が一致${b.startsWith('ERR') ? '（CRLF ' + b + '）' : ''}`);
  const rl = run(src, 'py', ticks), rc = run(crlf(src), 'py', ticks);
  ok(!rl.err && !rc.err && J(rl.out) === J(rc.out) && linesEq(rl.out, want),
    `py ${label}: 実行結果 LF ${rl.err ? 'ERR ' + rl.err : J(rl.out)} ＝ CRLF ${rc.err ? 'ERR ' + rc.err : J(rc.out)}（期待 ${J(want)}）`);
  if (!ticks) { checkPy3(`py ${label}（LF）`, src, want); checkPy3(`py ${label}（CRLF）`, crlf(src), want); }
}
{ // LF と CRLF の混在（1 本の中で両方）
  const r = run('if 1:\r\n  x = 3\n\r\n  print(x)\n', 'py');
  ok(!r.err && J(r.out) === J(['3']), `py LF と CRLF の混在 → ${r.err ? 'ERR ' + r.err : J(r.out)}`);
}
const CFIX = '#define K 3\n// c comment\nint a = K; /* block\n comment */\nvoid setup(){\n}\n\nvoid loop(){\n  int b = a + \\\n    1;\n  Serial.println(b);\n}\n';
{
  const a = astOf(CFIX, 'c'), b = astOf(crlf(CFIX), 'c');
  ok(!a.startsWith('ERR') && a === b, `C フィクスチャ（#define・// と /* */ コメント・行継続）: LF 版と CRLF 版の AST が一致${b.startsWith('ERR') ? '（CRLF ' + b + '）' : ''}`);
  const rl = run(CFIX, 'c', 1), rc = run(crlf(CFIX), 'c', 1);
  ok(!rl.err && !rc.err && J(rl.out) === J(rc.out) && J(rl.out) === J(['4']), `C フィクスチャ: 実行結果 LF ${J(rl.out)} ＝ CRLF ${rc.err ? 'ERR ' + rc.err : J(rc.out)}（期待 ["4"]）`);
}
const SHIPPED = [
  ...PROGRAMS.map((p) => ({ key: 'PROGRAMS:' + p.key, lang: p.lang, code: p.code })),
  ...Object.entries(SAMPLES).map(([lang, code]) => ({ key: 'SAMPLES:' + lang, lang, code })),
];
for (const lang of ['py', 'c']) {
  const set = SHIPPED.filter((s) => s.lang === lang);
  const bad = set.filter((s) => { const a = astOf(s.code, lang); return a.startsWith('ERR') || a !== astOf(crlf(s.code), lang); });
  ok(set.length > 0 && bad.length === 0,
    `出荷 ${lang} ${set.length} 本: LF 版と CRLF 版の AST が全件一致${bad.length ? '（不一致 ' + bad.map((s) => s.key).join(', ') + '）' : ''}`);
}

// ── E) 出荷サンプルの AST 指紋 ───────────────────────────────────────────────
console.log('\nE) 出荷サンプルの AST 指紋（本文が同じなら AST も同じ＝インタプリタの改修が出荷サンプルの解釈を変えていない）');
// [見本, 本文の sha256 先頭 16 桁, parsePy/parseC の JSON の sha256]。BJ1 是正前 HEAD ba977c1 と是正後で全件一致した値（2026-10-11）。
const AST_PIN = [
  ['PROGRAMS:normal_fr', 'd244897d62418fde', '3ba1d12415e30aacd6e250cc943ac2635b1d5e91242a382c5de3b12088236f36'],
  ['PROGRAMS:normal_awd', 'ae7a6827aea6fb4e', 'd0d1b94a58cf05ae5f0aca2845b143327bdb1f78a286a7ee406f52d0707ae782'],
  ['PROGRAMS:normal_ff', '65d50c348f206469', '5aeaccafe4c802cf7248863550bfca7ce8597e2cdc677c245c7185007648cef7'],
  ['PROGRAMS:drift_fr', '48d14ef3fe0c033b', '5d0620b7c4272758208f7e0b807d22772fc4e1ae1129ca4f69da923bd413ba51'],
  ['PROGRAMS:drift_awd', '21e1acc8f018baaf', '50d5a74b41cc28fe10ea367ee54842496e250a590e2bae2116dd54d7b675d778'],
  ['PROGRAMS:drift_ff', '544f34db7f304966', '87bb07436bb200038861452dff08c948198e7f0df3ea6f22b8c02dd302fac2a6'],
  ['PROGRAMS:py_normal_fr', 'f396c38a3f52336a', '807d52601db83ca492bd233f0d4d36b27e08e7108815adbed826d3ea278f9756'],
  ['PROGRAMS:py_normal_awd', '523b166d80607b28', '0457e8f9dfcd5b57475f76e01c210a08354be74c187daf2c407ba763fc7842b0'],
  ['PROGRAMS:py_normal_ff', 'fc5fa0d92e3c5064', 'bae0df6c7f861b1b9247c953ac6fe43c893fcd3ca7cba09941a37daf517a7f82'],
  ['PROGRAMS:showtime', '0f8a2e2aae35fcd2', 'af3071a3885ab9b31ba6ae4e242e7ccf01fa3320ba8fdd16a1cbf3710a137e43'],
  ['PROGRAMS:zerocounter', '5d05f115101384fc', '939eb1ff2345d7bad7a33a81879f16045f4b6a7cacccbf4d7c1f29028ed8eadc'],
  ['PROGRAMS:comp_demo', '9b3eb17e92379dcd', '2bbbcff16ed01fa7c3d3c6c6ab3eec9d448a437aceb02b8efac73fc60da1f06f'],
  ['PROGRAMS:comp_launch', '5f172ea5fe07e98c', 'c177d3632b1b1bf040bfc3fa6a63849391783b0a39f2b222fcce6af13f09383f'],
  ['PROGRAMS:comp_brake', '94134e0e900d062e', '14c65463a8c5bb2dae1e7ebd2681ae28723f61a66eb3601056eb9c0de3543517'],
  ['PROGRAMS:comp_circuit', 'b48e13fa730b7921', '8ce41932717cf449f4cc72eb93f07fb55fe3c825420f201ec58bf45f9b3a0631'],
  ['PROGRAMS:comp_drift', 'c351cf25a89271fb', '8fd400867b57c7dadd4db7529dcc9fab94497d6cb064a09ef8dca0b4e71de023'],
  ['PROGRAMS:comp_slip', 'e2dcf2c8ba532115', 'a87bdad11c8aafa6b2754f80deec57d66f1bf54158b423b4e004ee56d6a7edcf'],
  ['PROGRAMS:comp_estimate', '3348d2470fe4a13b', '2afa12ddc6a3154e4fb80c7044ecdaf0ea023aa6fd41661ba21a221227080443'],
  ['PROGRAMS:recon_racer', 'af4b66a8266f098d', '49c99fd1d0883bc2b5060ce6bfb3515a80f55302316fd3fc27a645c6057e8f2f'],
  ['PROGRAMS:comp_localize', '80e0b98546681e0a', '59b184a208ad313fb63976586e1742581482e39226270e31fbd4d8b12fd082b5'],
  ['PROGRAMS:recon_racer_c', '221af979a07b1799', '3b8b4aea60cdfd1f7626bad2477bd34716765ec8631254ecfc32ad01ad5bf9d4'],
  ['PROGRAMS:comp_localize_c', '5589ae03a02759bf', '2d17083effcb920d7538bd5074ea2bb376d5df2a5e680297ba32d71885780038'],
  ['PROGRAMS:strategist', '65c5a79ac2b9b3a6', '46a10790758b689a168ef2002d179041707b7dbbf9d8bb1d08ec51b1432b9ba2'],
  ['SAMPLES:c', 'cf1c46a02d4ec84b', '255d4a2baed889e4ac225673d6bec73f3b0059f8296dfa50c2137f3133736f26'],
  ['SAMPLES:py', '6f4e54b528d8874e', 'db26605e1f4ae4c7911ce1439fc2165dd2a4e493fab12ec20aa3163705a47f44'],
  ['SAMPLES:js', 'be1d87d6719a5d3b', null],   // BJ2: js はパーサ非経由（new Function）＝本文の指紋だけ（2026-10-11・bf780f8 で実測）
];
{
  const pin = new Map(AST_PIN.map(([k, s, a]) => [k, { src16: s, ast: a }]));
  const shippedKeys = new Set(SHIPPED.map((s) => s.key));
  const same = [], changed = [], unpinned = [], mismatch = [];
  const stale = AST_PIN.map(([k]) => k).filter((k) => !shippedKeys.has(k));   // 表にあるが出荷に無い（見本の削除・改名）
  for (const s of SHIPPED) {
    const p = pin.get(s.key);
    if (!p) { unpinned.push(s.key); continue; }
    if (sha(s.code).slice(0, 16) !== p.src16) { changed.push(s.key); continue; }
    if (s.lang === 'js') { if (p.ast === null) same.push(s.key); else mismatch.push(s.key + '（js に AST 指紋）'); continue; }
    const a = astOf(s.code, s.lang);
    if (sha(a) === p.ast) same.push(s.key);
    else mismatch.push(`${s.key}${a.startsWith('ERR') ? '（' + a + '）' : ''}`);
  }
  ok(mismatch.length === 0 && same.length > 0,
    `本文が刻んだ時と同じ ${same.length} 本の AST が指紋と一致${mismatch.length ? '（不一致 ' + mismatch.length + ' 本: ' + mismatch.join(', ') + '）' : ''}`);
  // BJ2（BJ1 層 4 F5）: 出荷の全見本が照合対象であること（照合外が 1 本でもあれば赤）。
  ok(changed.length === 0 && unpinned.length === 0 && stale.length === 0 && same.length === SHIPPED.length && SHIPPED.length === AST_PIN.length,
    `出荷 ${SHIPPED.length} 本すべてが照合対象で一致（一致 ${same.length}・本文が変わった ${changed.length}${changed.length ? '（' + changed.join(', ') + '）' : ''}` +
    `・表に無い ${unpinned.length}${unpinned.length ? '（' + unpinned.join(', ') + '）' : ''}・表にあって出荷に無い ${stale.length}${stale.length ? '（' + stale.join(', ') + '）' : ''}` +
    `・うち js ${SHIPPED.filter((s) => s.lang === 'js').length} 本は本文の指紋だけ）`);
}

// ── F) BJ2 演算子の意味論 ─────────────────────────────────────────────────────
console.log('\nF) BJ2 演算子の意味論 — 是正前: -7%2 → -1・-2**2 → 4・True==1 → 偽・f"{7//2}" → "7"・a, b %= 3 が走って a だけ更新');
// F-1 py の値表。[式, python3 の json.dumps(式) の出力（定数・2026-10-11 Python 3.14.4）]。x = 3 を先に置く。
//   本処理系は `r = 式` を本番経路で走らせ、グローバル r を定数と型ごとに比べる（bool は bool 同士・数は数同士で 1e-12）。
const PY_VALS = [
  ['-7%2', '1'], ['7%-2', '-1'], ['-7//2', '-4'], ['7//-2', '-4'], ['-2**2', '-4'], ['2**-1', '0.5'], ['2**3**2', '512'], ['-x**2', '-9'],
  ['True==1', 'true'], ['False==0', 'true'], ['True!=0', 'true'], ['1==True', 'true'], ['"1"==1', 'false'], ['True+True', '2'], ['not 0', 'true'],
  ['-7.5%2', '0.5'], ['abs(-3)%2', '1'],
  // 同じ規則の別の形（符号の組合せ・括弧・連鎖比較）
  ['-7%-2', '-1'], ['5%-3', '-1'], ['-0.5%1', '0.5'], ['7%2.5', '2.0'], ['-4%2', '0'], ['(-2)**2', '4'], ['-(2)**2', '-4'], ['-2**-2', '-0.25'],
  ['2*-3**2', '-18'], ['- -2**2', '4'], ['True==1.0', 'true'], ['True!=1', 'false'], ['True==True', 'true'], ['0==False', 'true'], ['"1"!=1', 'true'],
  ['1==True==1.0', 'true'],
  // 余り 0 の符号: Python の int に符号付きゼロは無い（-4 % 2 は 0）。-0 を返すと atan2 の象限が変わる（atan2(-0, -1) = -π）。
  ['math.atan2(-4%2, -1)', '3.141592653589793'],
];
const typedEq = (got, wantJson) => {
  const w = JSON.parse(wantJson);
  if (typeof w === 'boolean') return got === w;
  if (typeof w === 'number') return typeof got === 'number' && Math.abs(got - w) <= 1e-12;
  return got === w;
};
{
  const bad = [];
  for (const [e, want] of PY_VALS) {
    const r = run('x = 3\nr = ' + e, 'py');
    const got = r.vars ? r.vars.r : undefined;
    const good = !r.err && typedEq(got, want);
    if (!good) bad.push(`${e} → ${r.err ? 'ERR ' + r.err : J(got)}（python3 ${want}）`);
  }
  ok(bad.length === 0, `F-1 py の値表 ${PY_VALS.length} 式が python3 の値と一致（型も）${bad.length ? '・不一致 ' + bad.length + ' 式: ' + bad.join('・') : ''}`);
  checkPy3('F-1 py の値表', 'import json, math\nx = 3\n' + PY_VALS.map(([e]) => `print(json.dumps(${e}))`).join('\n'), PY_VALS.map(([, w]) => w));
}
// 複合代入（execMassign → applyBin も this.lang）と Model A の loop()（関数の中でも py の意味論）
const PY_STMTS = [
  ['x = -7; x %= 2', 'x = -7\nx %= 2\nprint(x)', ['1'], 0],
  ['x = -7; x //= 2', 'x = -7\nx //= 2\nprint(x)', ['-4'], 0],
  ['x = 7; x %= -2', 'x = 7\nx %= -2\nprint(x)', ['-1'], 0],
  ['def loop() の中（Model A・1 tick）', 'def setup():\n  pass\ndef loop():\n  print(-7 % 2)\n  print(-2 ** 2)\n  print(7 % -2)', ['1', '-4', '-1'], 1],
  ['while True: の本体（Model B・1 tick）', 'n = -7\nwhile True:\n  print(n % 3)\n  n = n + 1', ['2'], 1],
  ['文字列の % 書式は従来どおり', 'print("%d|%s" % (-7, -7 % 2))', ['-7|1'], 0],
];
for (const [label, src, want, ticks] of PY_STMTS) {
  const r = run(src, 'py', ticks);
  ok(!r.err && linesEq(r.out, want), `F-1 ${label} → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ${J(want)}）`);
  checkPy3(`F-1 ${label}`, ticks && /def loop/.test(src) ? src + '\nsetup()\nloop()\n' : (ticks ? src.replace('while True:', 'for _ in range(1):') : src), want);
}
// F-2 C の値表（** と // は C に無い）。是正前の HEAD bf780f8 で測った値（-0 は '-0' と書く）と byte 一致＝C は無改変。
//   C の % は切り捨て剰余（-7 % 2 = -1）・/ は真除算（AP16 H 項）・true == 1 は偽（=== のまま）。
const C_VALS = ['-7 % 2', '7 % -2', '-7 % -2', '5 % -3', '-7.5 % 2', '-4 % 2', 'abs(-3) % 2', '-7 / 2', '7 / -2', '-2 * -2', '-x * x',
  'true == 1', 'false == 0', 'true != 0', '1 == true', 'true + true', '!0', 'x % 4'];
const C_WANT = '-1,1,-1,2,-1.5,-0,1,-3.5,-3.5,4,-9,false,false,true,false,2,true,-3';
{
  const src = 'int x = -3;\n' + C_VALS.map((e, i) => `auto r${i} = ${e};`).join('\n') + '\nvoid setup(){}\nvoid loop(){}\n';
  const r = run(src, 'c', 1);
  const ser = (v) => (Object.is(v, -0) ? '-0' : J(v));
  const got = r.vars ? C_VALS.map((_, i) => ser(r.vars['r' + i])).join(',') : 'ERR ' + r.err;
  ok(got === C_WANT, `F-2 C の値表 ${C_VALS.length} 式が是正前と byte 一致（実 ${got}）`);
}
// F-3 f-string の埋め込み式（BJ1 層 4 F1）。[ラベル, 本文（x = 5・d = {"k": 1} の後）, 期待（JSON）]。python3 は json.dumps(s)。
//   是正前: f"{7//2}" → "7"（`//` 以降が C の行コメント）・f"{-7%2}" → "-1"・f"{'\\n'}" → LF 1 文字・f"{f'{x}'}" → 構文エラー。
const FSTR = [
  ['f"{7//2}"', 's = f"{7//2}"', '"3"'],
  ['f"{x//2}"', 's = f"{x//2}"', '"2"'],
  ['f"{-7%2}"', 's = f"{-7%2}"', '"1"'],
  ['f"{-2**2}"', 's = f"{-2**2}"', '"-4"'],
  ["f\"{'\\\\n'}\"（\\ と n の 2 文字）", "s = f\"{'\\\\n'}\"", '"\\\\n"'],
  ["f\"{'a\\tb'}\"（式の中のエスケープは 1 回だけ解く）", "s = f\"{'a\\tb'}\"", '"a\\tb"'],
  ['f"{ x }"（式の前後の空白）', 's = f"{ x }"', '"5"'],
  ["f\"{f'{x}'}\"（入れ子の f-string）", "s = f\"{f'{x}'}\"", '"5"'],
  ["f\"{d['k']}\"", "s = f\"{d['k']}\"", '"1"'],
  ['f"a{x}b{{c}}\\n"（文字列部分・{{ }}・エスケープは従来どおり）', 's = f"a{x}b{{c}}\\n"', '"a5b{c}\\n"'],
  ['f"{x:>3}"（書式指定は従来どおり落とす）', 's = f"{x:>3}"', null],
];
for (const [label, body, want] of FSTR) {
  const src = 'x = 5\nd = {"k": 1}\n' + body;
  const r = run(src, 'py');
  const got = r.vars ? J(r.vars.s) : 'ERR ' + r.err;
  if (want === null) { ok(got === '"5"', `F-3 ${label} → ${got}（本処理系は書式指定を扱わない＝"5"・Python は "  5"）`); continue; }
  ok(got === want, `F-3 ${label} → ${got}（期待 ${want}）`);
  checkPy3(`F-3 ${label}`, 'import json\n' + src + '\nprint(json.dumps(s))', [want]);
}
{ // 式の中の \"（外側と同じ引用符をエスケープで書く）は Python では SyntaxError。本処理系も字句エラーで止まる（是正前は通っていた）。
  const src = 'd = {"k": 1}\ns = f"{d[\\"k\\"]}"';
  const r = run(src, 'py');
  ok(!!r.err && r.err.startsWith('字句エラー') && /\(行 2\)/.test(r.err), `F-3 f"{d[\\"k\\"]}" → 字句エラー（行 2）（実 ${r.err ? r.err : '走った ' + J(r.vars && r.vars.s)}）`);
  checkPy3Err('F-3 f"{d[\\"k\\"]}"', src, /^SyntaxError/);
}
// F-4 文字列リテラルの中の CRLF（BJ1 層 4 F2）。LF 版と CRLF 版の AST が byte 一致し、値に CR が残らない。
//   是正前は値に \r が残り AST が一致しなかった。※三重引用符 """…""" は本処理系では `""`＋`"…"`＋`""` の 3 つの文字列として
//   字句解析される（未対応・値は空文字列）＝ここで測るのは CRLF と LF の一致だけ。
const STR_CRLF = [
  ['py 三重引用符の本文 """a⏎b"""', 'py', 's = """a\nb"""\nprint(s)\n', null],
  ['py 改行を含む "a⏎b" と \'c⏎d\'', 'py', 's = "a\nb"\nt = \'c\nd\'\n', [97, 10, 98]],
  ['py f-string f"{x}⏎y"', 'py', 'x = 1\ns = f"{x}\ny"\n', [49, 10, 121]],
  ['py \\＋改行 "a\\⏎b"（従来どおり \\ を落とした LF）', 'py', 's = "a\\\nb"\n', [97, 10, 98]],
  ['C 改行を含む "a⏎b"', 'c', 'auto s = "a\nb";\nvoid setup(){}\nvoid loop(){}\n', [97, 10, 98]],
];
for (const [label, lang, src, wantCodes] of STR_CRLF) {
  const a = astOf(src, lang), b = astOf(crlf(src), lang);
  ok(!a.startsWith('ERR') && a === b, `F-4 ${label}: LF 版と CRLF 版の AST が一致${a === b ? '' : '（CRLF 版に \\r が残る）'}`);
  if (wantCodes) {
    const r = run(crlf(src), lang, lang === 'c' ? 1 : 0);
    const got = r.vars ? codes(r.vars.s) : null;
    ok(!r.err && J(got) === J(wantCodes), `F-4 ${label}: CRLF 版の値 ${r.err ? 'ERR ' + r.err : J(got)}（期待 ${J(wantCodes)}）`);
  }
}
// F-5 タプル左辺の複合代入（BJ1 層 4 F3）。Python は SyntaxError（'tuple' is an illegal expression for augmented assignment）。
//   是正前は通って先頭の a だけ更新していた（a, b %= 3 → a=1・b=8）。単一左辺の複合代入とタプルの通常代入は従来どおり。
for (const [label, src] of [['a, b %= 3', 'a = 7\nb = 8\na, b %= 3\nprint(a, b)'], ['a, b += 1', 'a = 7\nb = 8\na, b += 1\nprint(a, b)'],
  ['(a, b) **= 2', 'a = 7\nb = 8\n(a, b) **= 2\nprint(a, b)']]) {
  const r = run(src, 'py');
  ok(!!r.err && r.err.startsWith('構文エラー(Py)') && /\(行 3\)/.test(r.err) && r.out.length === 0, `F-5 ${label} → 構文エラー（行 3）（実 ${r.err ? r.err : '走った ' + J(r.out)}）`);
  checkPy3Err(`F-5 ${label}`, src, /^SyntaxError: 'tuple' is an illegal expression for augmented assignment/);
}
for (const [label, src, want] of [['a, b = 1, 2', 'a, b = 1, 2\nprint(a, b)', ['1 2']], ['a, b = b, a（入れ替え）', 'a, b = 1, 2\na, b = b, a\nprint(a, b)', ['2 1']],
  ['a %= 3（単一左辺）', 'a = 7\na %= 3\nprint(a)', ['1']], ['a[0] += 1（添字の左辺）', 'a = [1, 2]\na[0] += 1\nprint(a[0])', ['2']]]) {
  const r = run(src, 'py');
  ok(!r.err && linesEq(r.out, want), `F-5 ${label} → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ${J(want)}）`);
  checkPy3(`F-5 ${label}`, src, want);
}

// ── G) BJ3 スコープと制御フロー ────────────────────────────────────────────────
console.log('\nG) BJ3 スコープと制御フロー — 是正前: for 本体の変数とループ変数がループ後に「未定義」・ループの外の break/continue/return が [object Object]・' +
  '呼び出し先の continue/break が呼び出し側のループに黙って効く・range(a,b,0) が黙って 0 回・関数を呼んだ文のエラーの行が呼ばれた関数の行');
const JP_RE = /[぀-ヿ一-龯]/;   // ひらがな/カタカナ/漢字（en の文言に日本語が混ざらない）
// python3 で同じ本文を走らせるときの形: Model A は setup()／loop() を 1 回ずつ呼ぶ・Model B は while True: を 1 回（ticks 回）の for にする。
const asPy3 = (src, ticks) => (!ticks ? src : /def loop/.test(src) ? src + '\nsetup()\n' + 'loop()\n'.repeat(ticks) : src.replace('while True:', `for _ in range(${ticks}):`));
// G-1 py の for はスコープを作らない。[ラベル, 本文, 期待する出力, tick 数]。python3 も同じ出力（checkPy3）。
const G_SCOPE = [
  ['for i in range(3): last = i の後の last と i', 'for i in range(3):\n  last = i\nprint(last, i)', ['2 2']],
  ['for ch in "ab": seen = ch の後の seen と ch', 'for ch in "ab":\n  seen = ch\nprint(seen, ch)', ['b b']],
  ['for x in [5, 6]（list）', 'for x in [5, 6]:\n  y = x * 2\nprint(x, y)', ['6 12']],
  ['for k in d（dict のキー）', 'd = {"a": 1, "b": 2}\nfor k in d:\n  v = d[k]\nprint(k, v)', ['b 2']],
  ['break で抜けたループ変数', 'for i in range(10):\n  if i == 4:\n    break\nprint(i)', ['4']],
  ['continue を含むループの後', 'for i in range(4):\n  if i % 2 == 0:\n    continue\n  odd = i\nprint(i, odd)', ['3 3']],
  ['入れ子の for', 'for a in range(2):\n  for b in range(3):\n    c = a * 10 + b\nprint(a, b, c)', ['1 2 12']],
  ['range(5,1,-1)（従来どおり 5,4,3,2）', 'for i in range(5,1,-1):\n  print(i)', ['5', '4', '3', '2']],
  ['ループ変数と同名のグローバル（関数の中の for i は書き換えない）', 'i = 100\ndef f():\n  for i in range(3):\n    pass\n  return i\nprint(f(), i)', ['2 100']],
  ['ループ変数と同名のグローバル（関数の中の for c in … も書き換えない）', 'c = "z"\ndef f():\n  for c in "ab":\n    pass\n  return c\nprint(f(), c)', ['b z']],
  // 層 4 F1／F6（BJ-8）: 関数の中の for のループ変数は関数ローカルなので、ループの後の同名の代入も関数ローカル（是正前は人間判断①で
  //   既存のグローバルを書き換えて 10）。仮引数と同名のループ変数（是正前 9）・ホストの名前（random）と同名のトップレベルの
  //   ループ変数はループの後も残る（是正前はループの中だけで、ループの後は random がホストのオブジェクトに戻った）。どれも python3 と同じ。
  ['関数の中の for x の後の x = 10 は関数ローカル（是正前は既存のグローバルを書き換えて 10）', 'x = 0\ndef f():\n  for x in range(3):\n    pass\n  x = 10\nf()\nprint(x)', ['0']],
  ['仮引数と同名のループ変数（是正前は f(9) が 9）', 'def f(i):\n  for i in range(3):\n    pass\n  return i\nprint(f(9))', ['2']],
  ['ホストの名前と同名のトップレベルのループ変数（是正前はループの後 random がホストのオブジェクト）', 'for random in range(2):\n  pass\nprint(random)', ['1']],
  ['トップレベルの for は同名の既存のグローバルを書き換える（是正前は 100 のまま）', 'i = 100\nfor i in range(3):\n  pass\nprint(i)', ['2']],
  ['0 回のループは既存の値を変えない', 'i = 5\nfor i in range(0):\n  pass\nprint(i)', ['5']],
  ['0 回の for … in も既存の値を変えない', 'c = "z"\nfor c in "":\n  pass\nprint(c)', ['z']],
  ['関数の中の for 本体の新しい変数は関数ローカル', 'def f():\n  for i in range(3):\n    tmp = i\n  return tmp\nprint(f())', ['2']],
  ['関数の中の for から return', 'def f():\n  for i in range(5):\n    if i == 3:\n      return i\n  return -1\nprint(f())', ['3']],
  ['関数の中のループの break（呼び出し側のループは続く）', 'def f():\n  for j in range(5):\n    if j == 2:\n      break\n  return j\nfor i in range(2):\n  print(f())', ['2', '2']],
  ['while True: の本体の for（Model B・1 tick）', 'while True:\n  for i in range(3):\n    last = i\n  print(last, i)', ['2 2'], 1],
  ['def loop() の中の for（Model A・1 tick）', 'def setup():\n  pass\ndef loop():\n  for i in range(3):\n    last = i\n  print(last, i)', ['2 2'], 1],
];
for (const [label, src, want, ticks] of G_SCOPE) {
  const r = run(src, 'py', ticks || 0);
  ok(!r.err && linesEq(r.out, want), `G-1 ${label} → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ${J(want)}）`);
  checkPy3(`G-1 ${label}`, asPy3(src, ticks), want);
}
{ // 関数の中の for で代入した変数・ループ変数はグローバルへ漏れない（関数が終わった後の interp.global.vars に無い）
  const r = run('def f():\n  for i in range(3):\n    tmp = i\n  return tmp\nr = f()', 'py');
  const vars = r.vars || {};
  ok(!r.err && vars.r === 2 && !('tmp' in vars) && !('i' in vars),
    `G-1 関数の中の for の tmp と i はグローバルに無い（実 ${r.err ? 'ERR ' + r.err : 'r=' + J(vars.r) + ' tmp∈global=' + ('tmp' in vars) + ' i∈global=' + ('i' in vars)}）`);
  checkPy3('G-1 関数の中の for の tmp と i はグローバルに無い', 'def f():\n  for i in range(3):\n    tmp = i\n  return tmp\nr = f()\nprint(r, "tmp" in globals(), "i" in globals())', ['2 False False']);
}
{ // 人間判断①: global 宣言なしの関数内の代入は既存のグローバルを書き換える（for の本体でも同じ）。python3 は -1（BJ4 で文書化）。
  const src = 'last = -1\ndef f():\n  for i in range(3):\n    last = i\nf()\nprint(last)';
  const r = run(src, 'py');
  ok(!r.err && J(r.out) === J(['2']), `G-1 人間判断①: 関数の中の for 本体の last = i は既存のグローバル last を書き換える → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ["2"]）`);
  checkPy3('G-1 人間判断①の差（python3 は関数ローカル＝-1）', src, ['-1']);
}
{ // 層 4 F1（未是正・DRIFT＝決定ログ BJ-8 ②）: `global x` を宣言した関数の中で x をループ変数にすると、ループ変数は関数ローカルに置かれ
  //   （global 文は parser_py が読み飛ばす＝是正するには AST を変える）、ループの後の x = 10 も関数ローカルに入る。是正前は 10（python3 と同じ）。
  //   ここでは今の値 0 と python3 の値 10 を定数で持ち、差を見張る（是正したら両方を 10 にする）。
  const src = 'x = 0\ndef f():\n  global x\n  for x in range(3):\n    pass\n  x = 10\nf()\nprint(x)';
  const r = run(src, 'py');
  ok(!r.err && J(r.out) === J(['0']), `G-1 未是正の差: global x を宣言した関数の中の for x の後の x = 10 はグローバルに届かない → ${r.err ? 'ERR ' + r.err : J(r.out)}（今の値 ["0"]・是正前と python3 は 10）`);
  checkPy3('G-1 未是正の差（python3 は global x でグローバル＝10）', src, ['10']);
}
for (const [label, src, name] of [['for j in range(0) の後の j', 'for j in range(0):\n  pass\nprint(j)', 'j'], ['for c in "" の後の c', 'for c in "":\n  pass\nprint(c)', 'c']]) {
  const r = run(src, 'py');
  ok(r.key === 'interp.err.undefName' && r.line === 3 && r.err === `未定義の変数/名前: ${name} (行 3)`, `G-1 0 回のループはループ変数を作らない: ${label} → ${r.err ? r.err : '走った ' + J(r.out)}`);
  checkPy3Err(`G-1 ${label}`, src, new RegExp(`^NameError: name '${name}' is not defined`));
}
// G-2 C の for は従来どおりブロックスコープ（ループ後に i も本体の last も未定義）。AST は是正前 HEAD ae61111 の実測と byte 一致（parser_c 無改修）。
{
  const cfor = (v) => `void setup(){\n  for (int i = 0; i < 3; i++) { int last = i; }\n  Serial.println(${v});\n}\nvoid loop(){}`;
  for (const v of ['last', 'i']) {
    const r = run(cfor(v), 'c');
    ok(r.key === 'interp.err.undefName' && r.line === 3 && r.err === `未定義の変数/名前: ${v} (行 3)`, `G-2 C の for の後の ${v} → 未定義（行 3）のまま（実 ${r.err ? r.err : '走った ' + J(r.out)}）`);
  }
  const a = sha(astOf(cfor('last'), 'c'));
  ok(a === '00de1dc209da6f4aa14e1c20814afb32492c44af1f038fcf00f7f1bba83f3a5d', `G-2 C の for の AST が是正前と byte 一致（実 ${a.slice(0, 16)}…）`);
}
// G-3 Model B（トップレベルの while True:）の continue／break を本番の tickSlot で（running と実況ログを見る）。
function runSlot(code, ticks, each) {
  const logs = [];
  const slot = makeSlot({ i: 0, lang: 'py', src: code, course, slotCount: 1, logFor: () => (m) => logs.push(String(m)) });
  slot.controller = buildController(slot.src, slot.lang, slot.hostEnv || buildApi(slot.world));
  slot.controller.setup();
  slot.running = true;
  for (let k = 0; k < ticks; k++) { tickSlot(slot, []); if (each) each(slot, k); }
  return { logs, slot, vars: slot.controller.interp.global.vars };
}
{
  const src = 'n = 0\nwhile True:\n  n += 1\n  if n % 2 == 0:\n    continue\n  print(n)';
  const { logs, slot, vars } = runSlot(src, 6);
  ok(slot.running === true && J(logs) === J(['1', '3', '5']) && vars.n === 6,
    `G-3 Model B の continue はその tick を終えて次の tick も動く: 6 tick で running=${slot.running}・ログ ${J(logs)}・n=${vars.n}（期待 true・["1","3","5"]・6・エラー 0 行）`);
  checkPy3('G-3 Model B の continue', asPy3(src, 6), ['1', '3', '5']);
}
{
  const src = 'n = 0\nwhile True:\n  n += 1\n  rc_drive(FORWARD, 100 + n)\n  rc_steer(LEFT)\n  if n == 3:\n    break\n  print(n)';
  const cmd = (s) => J([s.car.driveDir, s.car.pwm, s.car.steer, s.car.steerAmt]);
  let atBreak = null; const after = [];
  const { logs, slot, vars } = runSlot(src, 23, (s, k) => { if (k === 2) atBreak = cmd(s); else if (k > 2) after.push(cmd(s)); });
  ok(slot.running === true && J(logs) === J(['1', '2']) && vars.n === 3 && after.length === 20 && after.every((c) => c === atBreak) && slot.car.pwm === 103,
    `G-3 Model B の break で以降の tick は無動作: running=${slot.running}・ログ ${J(logs)}・n=${vars.n}・pwm=${slot.car.pwm}・break 後 20 tick の指令が break 時と同じ ${after.filter((c) => c === atBreak).length}/20（期待 true・["1","2"]・3・103・20/20）`);
  checkPy3('G-3 Model B の break（python3 は 23 回の for で n=3 のまま）', asPy3(src, 23).replace(/rc_drive\(FORWARD, 100 \+ n\)\n  rc_steer\(LEFT\)\n  /, '') + '\nprint(n)', ['1', '2', '3']);
}
{ // C の Model B（トップレベルの while (1)）でも同じ。
  const r = run('int n = 0;\nwhile (1) {\n  n++;\n  if (n == 2) break;\n  Serial.println(n);\n}', 'c', 5);
  ok(!r.err && J(r.out) === J(['1']) && r.vars && r.vars.n === 2, `G-3 C の while (1) の break → 出力 ${r.err ? 'ERR ' + r.err : J(r.out)}・n=${r.vars && r.vars.n}（期待 ["1"]・2・エラー無し）`);
}
// 層 4 F2: break でループを抜けたら、ループの後ろの文をその tick の中で 1 回だけ走らせてプログラムを終える（Python と同じ）。以降の tick は何もしない（人間判断②）。
{
  const src = 'n = 0\nwhile True:\n  n += 1\n  if n == 2:\n    break\nprint("after", n)';
  const { logs, slot, vars } = runSlot(src, 5);
  ok(slot.running === true && J(logs) === J(['after 2']) && vars.n === 2,
    `G-3 Model B の break の後ろの文はその tick で 1 回だけ走る: 5 tick で running=${slot.running}・ログ ${J(logs)}・n=${vars.n}（期待 true・["after 2"]・2。是正前は「【実行時エラー】[object Object]」）`);
  checkPy3('G-3 Model B の break の後ろの文', asPy3(src, 5), ['after 2']);
}
{
  const src = 'while True:\n  rc_drive(FORWARD, 200)\n  break\nrc_drive(BRAKE, 0)';
  const cmd = (s) => J([s.car.driveDir, s.car.pwm]);
  const after = [];
  const { logs, slot } = runSlot(src, 21, (s, k) => { if (k > 0) after.push(cmd(s)); });
  ok(slot.running === true && logs.length === 0 && slot.car.driveDir === CONST.BRAKE && slot.car.pwm === 0 && after.length === 20 && after.every((c) => c === cmd(slot)),
    `G-3 Model B の break の後ろの停止の指令が最後の指令になる: running=${slot.running}・ログ ${J(logs)}・指令 ${cmd(slot)}・以降 20 tick で同じ ${after.filter((c) => c === cmd(slot)).length}/20（期待 BRAKE・0・20/20）`);
}
{ // 後ろの文の中の return は関数の外＝エラー（execTop）。後ろに 2 つ目の while True: があると 1 tick の中で回り切ろうとしてステップ上限エラー
  //   （Model B のループは先頭の 1 つだけ＝未対応・決定ログ BJ-8。python3 は 2 つ目のループを回し続ける）。
  const r1 = run('while True:\n  break\nreturn', 'py', 1);
  ok(r1.key === 'interp.err.returnOutside' && r1.line === 3, `G-3 Model B の break の後ろの return → returnOutside（行 3）（実 ${r1.err ? r1.err : '走った'}）`);
  const r2 = run('while True:\n  break\nn = 0\nwhile True:\n  n += 1', 'py', 2);
  ok(r2.key === 'interp.err.stepLimit' && r2.line === 5, `G-3 未対応: Model B の break の後ろの 2 つ目の while True: → ステップ上限エラー（行 5）（実 ${r2.err ? r2.err : '走った'}）`);
}
// G-4／G-5 ループの外の break／continue と関数の外の return、range のステップ 0。ja と en の両方で走らせ、キー・行・文言を見る
//   （ja は「… (行 N)」・en は「… (line N)」で日本語を含まない・どちらも [object Object] を含まない）。
function okErr(label, code, lang, ticks, key, line, wantOut) {
  setLang('en'); const en = run(code, lang, ticks); setLang('ja');
  const ja = run(code, lang, ticks);
  const good = ja.key === 'interp.err.' + key && ja.line === line && en.key === ja.key && en.line === line
    && typeof ja.err === 'string' && ja.err.endsWith(` (行 ${line})`) && ja.err.length > ` (行 ${line})`.length
    && typeof en.err === 'string' && en.err.endsWith(` (line ${line})`) && !JP_RE.test(en.err)
    && !ja.err.includes('[object Object]') && !en.err.includes('[object Object]')
    && (!wantOut || J(ja.out) === J(wantOut));
  ok(good, `${label} → ${key}（行 ${line}）${wantOut ? '・出力 ' + J(wantOut) : ''}（実 ja ${J(ja.err)}${ja.err ? '' : ' 出力 ' + J(ja.out)}・en ${J(en.err)}）`);
}
const G_ERR = [
  // [ラベル, 本文, 言語, tick 数, キー, 行, 期待する出力（null＝見ない）, python3 も止まる正規表現（null＝照合しない）]
  ['G-4 py def loop(): 直下の break', 'def setup():\n  pass\ndef loop():\n  x = 1\n  break', 'py', 1, 'breakOutside', 5, null, /^SyntaxError: 'break' outside loop/],
  ['G-4 py def loop(): 直下の continue', 'def setup():\n  pass\ndef loop():\n  x = 1\n  continue', 'py', 1, 'continueOutside', 5, null, /^SyntaxError: 'continue' not properly in loop/],
  ['G-4 py def setup(): 直下の break', 'def setup():\n  break\ndef loop():\n  pass', 'py', 0, 'breakOutside', 2, null, /^SyntaxError: 'break' outside loop/],
  ['G-4 py ループの中から呼んだ関数の直下の continue', 'def f():\n  continue\ndef loop():\n  for i in range(2):\n    f()\n    print(i)', 'py', 1, 'continueOutside', 2, [], /^SyntaxError: 'continue' not properly in loop/],
  ['G-4 py ループの中から呼んだ関数の直下の break', 'def f():\n  break\ndef loop():\n  for i in range(2):\n    f()\n    print(i)', 'py', 1, 'breakOutside', 2, [], /^SyntaxError: 'break' outside loop/],
  ['G-4 py トップレベルのループから呼んだ関数の if の中の break', 'def f(i):\n  if i == 1:\n    break\nfor i in range(3):\n  f(i)\n  print(i)', 'py', 0, 'breakOutside', 3, ['0'], /^SyntaxError: 'break' outside loop/],
  ['G-4 C void loop(){ break; }', 'void setup(){}\nvoid loop(){\n  break;\n}', 'c', 1, 'breakOutside', 3, null, null],
  ['G-4 C void loop(){ continue; }', 'void setup(){}\nvoid loop(){\n  continue;\n}', 'c', 1, 'continueOutside', 3, null, null],
  ['G-4 C loop() のループから呼んだ void f(){ continue; }', 'void f(){\n  continue;\n}\nvoid setup(){}\nvoid loop(){\n  for (int i = 0; i < 2; i++) { f(); Serial.println(i); }\n}', 'c', 1, 'continueOutside', 2, [], null],
  ['G-4 C loop() のループから呼んだ void f(){ break; }', 'void f(){\n  break;\n}\nvoid setup(){}\nvoid loop(){\n  for (int i = 0; i < 2; i++) { f(); Serial.println(i); }\n}', 'c', 1, 'breakOutside', 2, [], null],
  ['G-4 C switch の外（loop() 直下の if の中）の break', 'void setup(){}\nvoid loop(){\n  int k = 1;\n  if (k) { break; }\n}', 'c', 1, 'breakOutside', 4, null, null],
  ['G-5 Model A のトップレベルの break', 'x = 1\nbreak\ndef loop():\n  pass', 'py', 0, 'breakOutside', 2, null, /^SyntaxError: 'break' outside loop/],
  ['G-5 Model A のトップレベルの return', 'return 5\ndef loop():\n  pass', 'py', 0, 'returnOutside', 1, null, /^SyntaxError: 'return' outside function/],
  ['G-5 Model B の while True: より前の continue', 'x = 1\ncontinue\nwhile True:\n  pass', 'py', 0, 'continueOutside', 2, null, /^SyntaxError: 'continue' not properly in loop/],
  ['G-5 Model B の while True: 直下の return', 'n = 0\nwhile True:\n  n += 1\n  return', 'py', 1, 'returnOutside', 4, null, /^SyntaxError: 'return' outside function/],
  ['G-5 Model C（1 回だけ実行）の break', 'x = 1\nbreak', 'py', 0, 'breakOutside', 2, null, /^SyntaxError: 'break' outside loop/],
  ['G-5 Model C の continue', 'x = 1\ncontinue', 'py', 0, 'continueOutside', 2, null, /^SyntaxError: 'continue' not properly in loop/],
  ['G-5 Model C の return', 'x = 1\nreturn', 'py', 0, 'returnOutside', 2, null, /^SyntaxError: 'return' outside function/],
  ['G-5 Model C の if の中の break', 'if 1:\n  break', 'py', 0, 'breakOutside', 2, null, /^SyntaxError: 'break' outside loop/],
  ['G-5 関数を呼ぶ return の行は return の行（呼ばれた関数の行ではない）', 'def f():\n  x = 1\n  return 2\nreturn f()', 'py', 0, 'returnOutside', 4, null, /^SyntaxError: 'return' outside function/],
  ['G-5 C のトップレベルの break（Model A）', 'int x = 1;\nbreak;\nvoid setup(){}\nvoid loop(){}', 'c', 0, 'breakOutside', 2, null, null],
  // range のステップ 0（BJ-4）。是正前は前者が黙って 0 回・後者がステップ上限エラー。
  ['G-6 range(1,5,0)', 'for i in range(1,5,0):\n  print(i)', 'py', 0, 'rangeStepZero', 1, [], /^ValueError: range\(\) arg 3 must not be zero/],
  ['G-6 range(5,1,0)（行 2）', 'x = 1\nfor i in range(5,1,0):\n  print(i)', 'py', 0, 'rangeStepZero', 2, [], /^ValueError: range\(\) arg 3 must not be zero/],
  ['G-6 range(1,5,False)', 'for i in range(1,5,False):\n  print(i)', 'py', 0, 'rangeStepZero', 1, [], /^ValueError: range\(\) arg 3 must not be zero/],
  ['G-6 ステップの式が関数を呼んでも行は for の行', 'def z():\n  a = 0\n  return a\nfor i in range(1, 5, z()):\n  pass', 'py', 0, 'rangeStepZero', 4, [], /^ValueError: range\(\) arg 3 must not be zero/],
  ['G-6 def loop() の中の range(0,3,0)（Model A・1 tick）', 'def setup():\n  pass\ndef loop():\n  for i in range(0, 3, 0):\n    print(i)', 'py', 1, 'rangeStepZero', 4, [], /^ValueError: range\(\) arg 3 must not be zero/],
];
for (const [label, src, lang, ticks, key, line, wantOut, py3re] of G_ERR) {
  okErr(label, src, lang, ticks, key, line, wantOut);
  if (py3re) checkPy3Err(label, asPy3(src, ticks), py3re);
}
{ // 正常系の対照: C の switch の中の break と、ループの中の break/continue は従来どおりエラーにならない。
  const r = run('void setup(){}\nvoid loop(){\n  int k = 1;\n  switch (k) { case 1: Serial.println(1); break; default: Serial.println(0); }\n  for (int i = 0; i < 5; i++) { if (i == 1) continue; if (i == 3) break; Serial.println(i + 10); }\n  Serial.println(2);\n}', 'c', 1);
  ok(!r.err && J(r.out) === J(['1', '10', '12', '2']), `G-4 C の switch の break・for の continue/break は従来どおり → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ["1","10","12","2"]）`);
}
{ // 配線: runner.js と evaluator.js に生の throw new Error( が無い（全て RuntimeError＝i18n キー＋行番号）・新しいキーの ja/en が非空。
  const raw = ['runner.js', 'interp/evaluator.js'].map((f) => (readFileSync(join(ROOT, 'public/js', f), 'utf8').match(/throw new Error\(/g) || []).length);
  ok(raw[0] === 0 && raw[1] === 0, `G-7 runner.js・evaluator.js の throw new Error( は 0 件（実 ${raw.join('・')}）`);
  const keys = ['breakOutside', 'continueOutside', 'returnOutside', 'rangeStepZero'].map((k) => 'interp.err.' + k);
  const bad = keys.filter((k) => !(MESSAGES[k] && MESSAGES[k].ja && MESSAGES[k].en));
  ok(bad.length === 0, `G-7 interp.err の新しいキー 4 個の ja/en が非空${bad.length ? '（欠け ' + bad.join(', ') + '）' : ''}`);
}
// G-8 層 4 F3／F4: ユーザー関数から正常に戻ったら curLine（エラーの行・実行位置ハイライトの line()）は呼び出し元の文の行に戻る。
//   是正前は呼ばれた関数の最後の文の行が残り、同じ文の続きで出るエラーの行がずれた（下の「是正前」）。関数の中で出たエラーは
//   関数の中の行のまま（例外のときは戻さない）。[ラベル, 本文, 言語, tick 数, キー, 行, python3 の例外の正規表現（null＝照合しない）]
function runLine(code, lang, ticks) {
  const world = { car: new DynCar(course.start), walls: course.walls, start: course.start, log: () => {}, _sensors: [], _pendingDelay: 0, _others: [] };
  let c = null;
  try { c = buildController(code, lang, buildApi(world)); c.setup(); for (let i = 0; i < ticks; i++) c.tick(); return { cur: c.line() }; }
  catch (e) { return { err: e.message || String(e), key: e.i18nKey, line: e.line, cur: c ? c.line() : null }; }
}
const G_LINE = [
  ['for c in f():（notIterable・是正前は行 3）', 'def f():\n  a = 1\n  return 5\nfor c in f():\n  pass', 'py', 0, 'notIterable', 4, /^TypeError: 'int' object is not iterable/],
  ['関数の外の return f()（是正前は [object Object]・line() は 3）', 'def f():\n  x = 1\n  return 2\nreturn f()', 'py', 0, 'returnOutside', 4, /^SyntaxError: 'return' outside function/],
  ['x = 10 / f()（ゼロ除算・是正前は行 3）', 'def f():\n  a = 1\n  return 0\nx = 10 / f()', 'py', 0, 'divZero', 4, /^ZeroDivisionError/],
  ['y = f() + zz（未定義の名前・是正前は行 2）', 'def f():\n  return 1\ny = f() + zz', 'py', 0, 'undefName', 3, /^NameError: name 'zz' is not defined/],
  ['nope(f())（未定義の関数・是正前は行 2）', 'def f():\n  return 1\nnope(f())', 'py', 0, 'undefFunc', 3, /^NameError: name 'nope' is not defined/],
  ['x //= f()（複合代入・是正前は行 2）', 'def f():\n  return 0\nx = 5\nx //= f()', 'py', 0, 'divZero', 4, /^ZeroDivisionError/],
  ['C int x = 10 / f();（是正前は行 2）', 'int f(){\n  return 0;\n}\nvoid setup(){}\nvoid loop(){\n  int x = 10 / f();\n}', 'c', 1, 'divZero', 6, null],
  ['関数の中で出たエラーは関数の中の行のまま（是正前後で同じ）', 'def f():\n  a = 1\n  return 1 / 0\nx = f()', 'py', 0, 'divZero', 3, /^ZeroDivisionError/],
];
for (const [label, src, lang, ticks, key, line, py3re] of G_LINE) {
  const r = runLine(src, lang, ticks);
  ok(r.key === 'interp.err.' + key && r.line === line && r.cur === line, `G-8 ${label} → ${key}（行 ${line}・line() ${line}）（実 ${r.err ? r.err : '走った'}・line() ${r.cur}）`);
  if (py3re) checkPy3Err(`G-8 ${label}`, src, py3re);
}
{ // 正常系の実行位置: loop() の最後の文が関数を呼ぶと、tick の後の line() はその文の行（是正前は呼ばれた関数の最後の文の行 3）。
  const r = runLine('def g():\n  a = 1\n  return a\ndef setup():\n  pass\ndef loop():\n  x = g()', 'py', 1);
  ok(!r.err && r.cur === 7, `G-8 loop() の最後の文 x = g() の後の line() は 7（実 ${r.err ? r.err : r.cur}・是正前は 3）`);
}


console.log(`\n  python3 との突き合わせ: ${PY3 ? py3Checked + ' 件' : '0 件（python3 不在）'}`);
console.log(`[結果] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
