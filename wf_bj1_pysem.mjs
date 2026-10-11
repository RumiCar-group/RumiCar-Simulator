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
//      インタプリタの改修が出荷サンプルの解釈を黙って変えていないことを見張る（BJ2・BJ3 の陰性対照）。本文を変えた見本・
//      表に無い見本は照合外として件数と名前を表示する（落とさない）。js の見本はパーサを通らない（new Function）ので対象外。
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
];
{
  const pin = new Map(AST_PIN.map(([k, s, a]) => [k, { src16: s, ast: a }]));
  const parsed = SHIPPED.filter((s) => s.lang !== 'js');
  const same = [], changed = [], unpinned = [], mismatch = [];
  for (const s of parsed) {
    const p = pin.get(s.key);
    if (!p) { unpinned.push(s.key); continue; }
    if (sha(s.code).slice(0, 16) !== p.src16) { changed.push(s.key); continue; }
    const a = astOf(s.code, s.lang);
    if (sha(a) === p.ast) same.push(s.key);
    else mismatch.push(`${s.key}${a.startsWith('ERR') ? '（' + a + '）' : ''}`);
  }
  ok(mismatch.length === 0 && same.length > 0,
    `本文が刻んだ時と同じ ${same.length} 本の AST が指紋と一致${mismatch.length ? '（不一致 ' + mismatch.length + ' 本: ' + mismatch.join(', ') + '）' : ''}`);
  console.log(`    照合外: 本文が変わった ${changed.length} 本${changed.length ? '（' + changed.join(', ') + '）' : ''}・表に無い ${unpinned.length} 本${unpinned.length ? '（' + unpinned.join(', ') + '）' : ''}` +
    `・js ${SHIPPED.length - parsed.length} 本（パーサ非経由）／出荷計 ${SHIPPED.length} 本`);
}

console.log(`\n  python3 との突き合わせ: ${PY3 ? py3Checked + ' 件' : '0 件（python3 不在）'}`);
console.log(`[結果] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
