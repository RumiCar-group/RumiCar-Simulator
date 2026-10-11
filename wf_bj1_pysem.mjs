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

console.log(`\n  python3 との突き合わせ: ${PY3 ? py3Checked + ' 件' : '0 件（python3 不在）'}`);
console.log(`[結果] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
