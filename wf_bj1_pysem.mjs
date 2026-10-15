// wf_bj1_pysem.mjs — Stage BJ「インタプリタ是正 I（高頻度の Python 意味論・CRLF）」の常設ゲート。BJ1 で新設し、BJ2・BJ3・BJ5・BJ6 が章を足す。
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
// BJ2（演算子の意味論）— 是正前（HEAD bf780f8）の値は F 章の見出しに書いた。`--root <是正前の木>` で回すと F 章が赤になる（BJ2 の時点では A〜E は緑。後の Stage で改めた期待値＝F-3・H 章〔BK3〕・G-9〔BK4〕・B 章の C の `%=`〔BK5〕は古い木で赤）。
//   F) py の演算子（parser_py の factor/power・evaluator の applyBin に this.lang）: `%` は床剰余（符号は除数に従う・文字列の
//      `%` 書式は従来どおり）・`**` は単項マイナスより強く右結合で右辺に単項を許す（-2**2 = -4・2**-1 = 0.5）・`==`/`!=` は
//      bool と数を数として比べる（True == 1）。`//` は従来どおり Math.floor。値表は python3 の json.dumps の出力を定数で持ち、
//      本処理系の値と型ごとに突き合わせる（bool は bool・数は 1e-12）。C の同じ値表（`**` と `//` を除く）は是正前の HEAD で
//      測った値と byte 一致（C は無改変）。あわせて BJ1 の層 4 指摘: f-string の埋め込み式を py モードで字句解析し
//      （f"{7//2}" → "3"）二重のエスケープ解除をしない（f"{'\\n'}" → `\` と n の 2 文字）・文字列リテラルの中の CRLF を
//      LF に正規化・タプル左辺の複合代入（a, b %= 3）を構文エラーに。
//
// BJ3（スコープと制御フロー）— 是正前（HEAD ae61111）の値は G 章の見出しに書いた。`--root <是正前の木>` で回すと G 章が赤になる（BJ3 の時点では A〜F は緑。BK6 後の `--root ae61111` の実測では B 章の C の `%=`〔BK5〕と F-3〔BK3〕も赤）。
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
// BJ5（三重引用符の文字列と文字列の中の改行）— 是正前（HEAD 0aa4039）の値は H 章の見出しとコメントに書いた。`--root <是正前の木>` で回すと
//   H 章が赤になる（A〜G は緑）。
//   H) lexer.js の readStrBody: py の三重引用符 """…"""／'''…'''（f/F 接頭辞付きを含む）を 1 つの文字列リテラルとして読む（H-1・python3 の
//      json.dumps と照合）。是正前は `""`＋`"…"`＋`""` の 3 つの文として通って s は空文字列・'''It's "ok"''' の開いたままの `'` が後続の
//      文をファイル末尾まで黙って呑み・docstring """say "hi" """ が「未定義の変数/名前: hi」。文字列（通常・三重・f-string。C・py 共通）の
//      中の改行で行番号を進める（H-2: 後ろの文のエラーの行・line()・AST の line。是正前は改行の数だけ小さい）。ファイル末尾まで閉じ引用符が
//      無い文字列は字句エラー「字句エラー: 閉じていない文字列… (行 N)」（N＝開き引用符の行・H-3。是正前の py は黙って通った）。
//      CRLF 版は LF 版と AST（line を含む）・値・行が一致（H-4）。あわせて f-string の埋め込み式の中の文字列リテラル（f"{'}'}"・f"{':'}"）
//      を式の区切り・書式指定にしない（是正前は "'}"・""＝閉じていない文字列を字句エラーにしたので、直さないと閉じた文字列が字句エラーに
//      なる）・#define の置換本体の字句エラーの行を指令の行に（是正前は行 1）。通常の引用符の中の改行は従来どおり受理し、`\`＋改行は
//      従来どおり LF を残す（BJ2 F-4 の期待値。Python はそれぞれ SyntaxError・行継続。三重引用符の `\`＋改行も LF＝H-2 で今の値と python3 の
//      値を定数で持つ）。CR 単独は改行に数えない（H-2）。
//      層 4 の指摘で追加（BJ5 の初版の回帰と穴）: 書式指定の中の引用符は文字（f"{x:'>5} and {a}" の閉じ `}` から後ろが黙って消えた＝初版の回帰・
//      H-1 の H_SPEC。是正前の 0aa4039 でも同じ値なので BJ5 の時点では `--root 0aa4039` で緑＝初版の回帰の検出用。BK3 で H_SPEC の期待値を python3 の
//      書式指定どおりの値に改めた後は `--root 0aa4039` で赤＝BK-9 F3）・式の中の三重引用符の文字列
//      （f"""{'''it's'''}"""。初版は構文エラー）・閉じ `}` の無い置換フィールドは字句エラー（f"{x" は是正前も初版も "5"）・式の中の
//      字句エラー・構文エラーの行は物理行（初版は「開き引用符の行＋式の中の改行の数」と開き引用符の行＝H-3）。
//      未是正の差: f-string の埋め込み式で出た実行時エラーの行は文の行（＝開き引用符の行。python3 は式のある行）・書式指定は落とす（H_SPEC に
//      python3 の値を定数で持つ）。→ 書式指定と単独の `}` は BK3（Stage BK・v10.3.0）で是正し、H_SPEC・F-3・H-1 の該当行と H-3 の単独の `}` の
//      期待値を python3 の値に改めた（wf_bk1_interp2 H 章が書式指定の本体を見る）。
//
// BJ6（1 行の suite の break／continue／pass／return・その文の行番号・return のエラー文言）— 是正前（HEAD 473f95b）の値は I 章の見出しと各表に
//   書いた。`--root <是正前の木>` で回すと I 章が赤になる（BJ6 の時点では A〜H は緑。BK3 以降は F-3・H-1・H-3 の期待値を python3 に
//   改めたので、BK3 より前の木では H 章と F-3 も赤＝BK-9 F3。さらに BK4 以降は G-9〔rangeArg〕・BK5 以降は B 章の C の `%=` も赤＝
//   BK6 後の `--root b93bb43` の実測で赤は B 章の C の `%=`・F-3・G-9・H-1・H-3）。
//   I) parser_py の suite の 1 行の分岐（`:` の後の同じ行の文）を、字下げしたブロックの文と同じキーワードの単純文（kwStmt: return〔値あり・
//      なし〕・break・continue・pass・import／from・global）で読み、読んだ文に先頭のトークンの行を line として付ける。是正前は simpleStmt() だけで
//      読み、`if n == 2: break` が「未定義の変数/名前: break」（`else: continue`・`while x: break`・`if x: pass`・`def f2(): global x` も同じ形）、
//      `def f(): return 1` は関数の本体が変数 return で 1 がトップレベルの別の文（f() が「…: return」）。`if a: return g()` は a が偽の間 g() を
//      無条件に呼んでいた（I-1）。1 行の suite の文に line が無く、外側の文（呼び出し元）の行で報告していた（`else: z = 1 / 0` が if の行 4・
//      `def f(): x = 1 / 0` が呼び出し元の行。python3 は文の行・I-2）。ループの外の 1 行の suite の break／continue／return は breakOutside／
//      continueOutside／returnOutside（是正前は「未定義の変数/名前」・I-2）。従来の形（I-3）: 1 行の suite の複合文（if／while／for／def）と `;` は
//      是正前と同じ文言の構文エラー（Python は `;` を受理＝未是正の差を定数で持つ）。キーワードの単純文の後ろに同じ行の続き（`break 5`・`return 1 2`）が
//      あれば構文エラー（Python も SyntaxError。是正前は `def f(): return 1 2` が f を呼ばなければ黙って走った）。I-4 returnOutside の文言は ja／en とも
//      `while` を含まない（py の while True: と C の while (1) の両方で通る。是正前は C の `return;` にも「while True: の 1 回分を終えるなら continue」）。
//      I-5 CRLF 版の AST（line を含む）・値・エラーの行が LF 版と一致。
//      BK2（Stage BK・2026-10-13）: `;` を受理した（(18)）ので、I-3 の `;` の 6 行は「是正前と同じ構文エラー」から I_SEMI（python3 と同じ出力）へ
//      移した。1 行の suite の複合文・キーワードの文の続きの期待値（文言・行）は BJ6 のまま。BK2 の検査は wf_bk1_interp2 の G 章。
//   G-9（G 章に追加）: BJ3 の挙動変化のうち v10.1.0 の木を `--root` にした走査で拾えなかった 2 つを、エラーになる形で検査する（トップレベルの
//      `for random in range(2)` の後の `random.random()` が notMethod＝ループ変数がホストの名前を隠す・`range(1,5,None)` が rangeStepZero）。
//      BK4（Stage BK・v10.3.0）: `range(1,5,None)` は None が数の 0 でなくなり、python3 と同じ種類の rangeArg（「range() の引数は整数」・
//      python3 は TypeError）に改めた（wf_bk1_interp2 I-7 が range の引数の型を見る）。
//      v10.1.0 の木では赤になり、出力の「実 走った …」がエラー無しで走った値を示す（BJ4 の拾い上げ用）。BJ6 の陰性対照（473f95b）では緑。
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
{ // BJ2（BJ1 層 4 F4）: C の `%=` は Stage BJ では未対応＝構文エラーのままだった（Stage 案 3 の候補）。BK5（Stage BK）で受理した＝C の % は
  //   切り捨て剰余のまま（7 %= 3 は 1・-7 %= 3 は -1＝gcc と同じ。py の床剰余とは別）。C の `%=` の詳細は wf_bk1_interp2 の J 章。
  const r = run('void setup(){\n  int x = 7;\n  x %= 3;\n  int y = -7;\n  y %= 3;\n  print(x); print(y);\n}\nvoid loop(){}', 'c');
  ok(!r.err && J(r.out) === J(['1', '-1']), `C の x %= 3・y = -7; y %= 3 → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ["1","-1"]＝BK5 で受理・切り捨て剰余。BK5 より前は構文エラー（行 3））`);
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
  // BK3（Stage BK）で書式指定を是正した: 是正前（BJ2〜v10.2.0）は書式指定を落として "5"（この行の期待値は null＝"5" だった）。
  ['f"{x:>3}"（書式指定・BK3 で python3 と同じ）', 's = f"{x:>3}"', '"  5"'],
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
//   是正前は値に \r が残り AST が一致しなかった。※三重引用符 """…""" は BJ2 の時点では `""`＋`"…"`＋`""` の 3 つの文字列として
//   字句解析された（未対応・値は空文字列）＝ここで測るのは CRLF と LF の一致だけ。BJ5 で 1 つの文字列リテラルになった（値は H 章で測る）。
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
  for (let k = 0; k < ticks; k++) { tickSlot(slot, []); if (each) each(slot, k, logs); }
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

// G-9（BJ6 で追加）: BJ3 の挙動変化のうち、v10.1.0 の木を `--root` にした走査で拾えなかった 2 つ（決定ログ BJ-9 ④）をエラーになる形で検査する。
//   v10.1.0 の木では赤で、出力の「実 走った …」がエラー無しで走った値を示す（BJ4 の「v10.1.0 で走っていたが v10.2.0 でエラーになる書き方」の拾い上げ用）。
//   BJ3 の後の木（BJ5 の確定コミット 473f95b を含む）では緑。[ラベル, 本文, キー, 行, python3 も同じ種類で止まる正規表現, python3 は別の種類で止まる正規表現]
const G9 = [
  ['トップレベルの for random in range(2) の後の random.random()（ループ変数がホストの名前を隠す）', 'for random in range(2):\n  pass\nx = random.random()', 'notMethod', 3,
    /^AttributeError: 'int' object has no attribute 'random'/, null],
  // BK4: None は数の 0 でなくなった＝rangeStepZero から rangeArg（python3 と同じ TypeError の種類）へ期待値を改めた。
  ['for i in range(1,5,None)（BK4 から rangeArg）', 'for i in range(1,5,None):\n  print(i)', 'rangeArg', 1,
    /^TypeError: 'NoneType' object cannot be interpreted as an integer/, null],
];
for (const [label, src, key, line, py3same, py3diff] of G9) {
  setLang('en'); const en = run(src, 'py'); setLang('ja');
  const r = run(src, 'py');
  ok(r.key === 'interp.err.' + key && r.line === line && r.out.length === 0 && en.key === r.key && en.line === line
    && typeof en.err === 'string' && en.err.endsWith(` (line ${line})`) && !JP_RE.test(en.err),
    `G-9 ${label} → ${key}（行 ${line}）（実 ${r.err ? r.err : '走った ' + J(r.out)}）`);
  if (py3same) checkPy3Err(`G-9 ${label}`, src, py3same);
  if (py3diff) checkPy3Err(`G-9 ${label}（未是正の差: python3 はエラーの種類が違う）`, src, py3diff);
}

// ── H) BJ5 三重引用符の文字列・文字列の中の改行の行番号・閉じていない文字列 ─────────────────────────
console.log('\nH) BJ5 三重引用符・文字列の中の改行・閉じていない文字列 — 是正前: s = """a""" が空文字列・docstring """say "hi" """ が「未定義の変数/名前: hi」・' +
  '文字列の中の改行で行番号が進まない・閉じていない文字列 s = "abc がエラー無しで通る');
// python3 で同じ本文を走らせ、例外の種類（最後の行）と行（traceback の最後の File "<string>", line N）を見る。python3 が無ければ判定しない。
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
// H-1 三重引用符の値。[ラベル, 本文（x = 5・d = {"k": 1} の後に置く）, 期待（python3 の json.dumps(s) の出力・定数・2026-10-12 Python 3.14.4）]。
//   是正前（HEAD 0aa4039）: 三重引用符は `""`＋`"…"`＋`""` の 3 つの文として読まれ s は空文字列（"""a\"""b"""・"""a""" + "b" も ""）、
//   '''It's "ok"''' は開いたままの `'` が後続をファイル末尾まで呑み、""""a""" は「未定義の変数/名前: a」・F"""{x}⏎{d["k"]}""" は
//   「未定義の変数/名前: k」。f-string の式の中の文字列（f"{'}'}"・f"{':'}"・f"{'a:b'}"・f"{'{'}"）は、是正前は式を文字列の中の
//   `}`・`:` で切って "'}"・""・"a"・構文エラー（BJ5 で閉じていない文字列を字句エラーにしたため、式の中の文字列を区切りにしないよう直した）。
const H_VALS = [
  ['s = """a"""', 's = """a"""', '"a"'],
  ['s = """a⏎b"""（LF を含む）', 's = """a\nb"""', '"a\\nb"'],
  ['s = \'\'\'It\'s "ok"\'\'\'', 's = \'\'\'It\'s "ok"\'\'\'', '"It\'s \\"ok\\""'],
  ['s = """a\\tb"""（エスケープは通常の文字列と同じ）', 's = """a\\tb"""', '"a\\tb"'],
  ['s = """"""（空）', 's = """"""', '""'],
  ['s = f"""v={x}⏎ok"""', 's = f"""v={x}\nok"""', '"v=5\\nok"'],
  ["s = f'''{x}'''", "s = f'''{x}'''", '"5"'],
  ['s = F"""{x}⏎{d["k"]}"""（式の中の別の引用符）', 's = F"""{x}\n{d["k"]}"""', '"5\\n1"'],
  ['s = """say "hi" """（単独の引用符）', 's = """say "hi" """', '"say \\"hi\\" "'],
  ['s = """a\\"""b"""（エスケープした引用符は閉じ引用符に数えない）', 's = """a\\"""b"""', '"a\\"\\"\\"b"'],
  ['s = """"a"""（中身の先頭が引用符）', 's = """"a"""', '"\\"a"'],
  ["s = '''a''b'''（2 つ続く引用符）", "s = '''a''b'''", '"a\'\'b"'],
  ['s = """a""" + "b"', 's = """a""" + "b"', '"ab"'],
  ['s = """# 注釈ではない⏎  字下げも中身"""', 's = """# not a comment\n  indented"""', '"# not a comment\\n  indented"'],
  ['s = "" + "x"（空の文字列は三重引用符ではない）', 's = "" + "x"', '"x"'],
  ["s = f\"{'}'}\"（式の中の文字列の } で式を切らない）", "s = f\"{'}'}\"", '"}"'],
  ["s = f\"{':'}\"（式の中の文字列の : を書式指定にしない）", "s = f\"{':'}\"", '":"'],
  ["s = f\"{'a:b'}\"", "s = f\"{'a:b'}\"", '"a:b"'],
  ["s = f\"{'{'}\"", "s = f\"{'{'}\"", '"{"'],
  ["s = f\"{'it\\'s'}\"（式の中の文字列のエスケープした引用符）", "s = f\"{'it\\'s'}\"", '"it\'s"'],
  ["s = f\"{'a\\':b'}\"（式の中の文字列のエスケープした引用符の後の : も書式指定にしない）", "s = f\"{'a\\':b'}\"", '"a\':b"'],
  ["s = f\"\"\"{'''it's'''}\"\"\"（式の中の三重引用符の文字列に単独の '・BJ5 初版は構文エラー）", "s = f\"\"\"{'''it's'''}\"\"\"", '"it\'s"'],
  ["s = f\"{'''a'b'''}\"", "s = f\"{'''a'b'''}\"", '"a\'b"'],
  ['s = f\'{"""a"b"""}\'', 's = f\'{"""a"b"""}\'', '"a\\"b"'],
  ["s = f\"{''''a'''}\"（式の中の三重引用符の中身の先頭が引用符）", "s = f\"{''''a'''}\"", '"\'a"'],
  ["s = f\"{'' + 'a'}\"（式の中の空の文字列は三重引用符ではない）", "s = f\"{'' + 'a'}\"", '"a"'],
  ["s = f\"{'a' + '}:'}\"（式の中の文字列の } と : の後ろも式）", "s = f\"{'a' + '}:'}\"", '"a}:"'],
  ["s = f\"{ {'a': x}['a'] }\"（式の中の dict の : は書式指定ではない）", "s = f\"{ {'a': x}['a'] }\"", '"5"'],
  ["s = f\"{({'a': x})['a']}\"（括弧の中の dict の :）", "s = f\"{({'a': x})['a']}\"", '"5"'],
  // BK3: 書式指定を是正（是正前は落として "5"＝この行の期待値は null だった）。
  ['s = f"{x:>3}"（書式指定・BK3 で python3 と同じ・F-3 と同じ）', 's = f"{x:>3}"', '"  5"'],
];
const H_PRE = 'x = 5\nd = {"k": 1}\n';
// 文の数（x・d・s の 3 つ）。是正前は三重引用符が `""`＋`"…"`＋`""` に割れて文が増えた（値がたまたま同じ  もここで赤になる）。
const nStmts = (src) => { try { return parsePy(src).body.length; } catch (e) { return 'ERR ' + (e.message || e); } };
for (const [label, body, want] of H_VALS) {
  const r = run(H_PRE + body, 'py');
  const got = r.vars ? J(r.vars.s) : 'ERR ' + r.err;
  const ns = nStmts(H_PRE + body);
  if (want === null) { ok(got === '"5"' && ns === 3, `H-1 ${label} → ${got}・文 ${ns}（本処理系は書式指定を扱わない＝"5"・文 3）`); continue; }
  ok(got === want && ns === 3, `H-1 ${label} → ${got}・文 ${ns}（期待 ${want}・文 3）`);
  checkPy3(`H-1 ${label}`, 'import json\n' + H_PRE + body + '\nprint(json.dumps(s))', [want]);
}
// H-1 書式指定（`:` 以降）と変換（`!r` 等）の中の引用符は文字（区切りではない）。BJ5〜v10.2.0 は書式指定を落とした（値は素の str 化）ので、
//   期待値は「書式指定を除いた本文」を python3 で走らせた値で、python3 の書式指定どおりの値は未是正の差として定数で持っていた。
//   BK3（Stage BK・v10.3.0）で書式指定を是正したので、期待値を python3 の書式指定どおりの値（最後の列・null＝python3 は ValueError ＝
//   本処理系は interp.err.fmtSpec の実行時エラー〔行 3〕）に改めた。引用符を区切りにしない検査（閉じ `}` の見落とし＝初版の回帰）は値に
//   後ろのフィールドが残ること（" and 4"・"|1"・"\nend"）で引き続き見ている。「書式指定を除いた本文」の python3 の値の照合は残す。
//   BJ5 の初版は書式指定の中の引用符を文字列の区切りとして追い、閉じ `}` を見落として本体の末尾まで読み、書式指定として黙って落とした
//   （f"{x:'>5} and {a}" → "5"・f'{x:"^5} units' → "5"・f"""{"a"}⏎{x:'>2}⏎end""" → "a\n5"）＝層 4 の指摘の回帰。是正前の 0aa4039 は
//   三重引用符の行を除いて今と同じ値（引用符を見ずに `{`／`}` だけで閉じていた）＝BJ5 の時点では `--root 0aa4039` で緑・初版の木では赤（BK3 で期待値を改めた後は 0aa4039 でも赤＝BK-9 F3）。
//   [ラベル, 本文（H_PRE の後に置く）, 書式指定を除いた本文, 期待（json.dumps）, python3 の書式指定どおりの値（json.dumps・定数）]
const H_SPEC = [
  ["s = f\"{x:'>5} and {a}\"（層 4 の指摘の入力）", "a = 4\ns = f\"{x:'>5} and {a}\"", 'a = 4\ns = f"{x} and {a}"', '"5 and 4"', '"\'\'\'\'5 and 4"'],
  ["s = f'{x:\"^5} units'", "s = f'{x:\"^5} units'", "s = f'{x} units'", '"5 units"', '"\\"\\"5\\"\\" units"'],
  ["s = f\"\"\"{\"a\"}⏎{x:'>2}⏎end\"\"\"（三重引用符）", "s = f\"\"\"{\"a\"}\n{x:'>2}\nend\"\"\"", 's = f"""{"a"}\n{x}\nend"""', '"a\\n5\\nend"', '"a\\n\'5\\nend"'],
  ["s = f\"{x!s:'>3}|\"（変換の後の書式指定）", "s = f\"{x!s:'>3}|\"", 's = f"{x!s}|"', '"5|"', '"\'\'5|"'],
  ["s = f\"{d['k']:'>3}|{d['k']}\"（式の中の文字列と書式指定の中の引用符）", "s = f\"{d['k']:'>3}|{d['k']}\"", "s = f\"{d['k']}|{d['k']}\"", '"1|1"', '"\'\'1|1"'],
  ["s = f\"{x:{'>'}5}|\"（書式指定の中の入れ子のフィールドの引用符）", "s = f\"{x:{'>'}5}|\"", 's = f"{x}|"', '"5|"', '"    5|"'],
  ['s = f"{x:\\}"（書式指定の中の \\ の後の } は閉じ＝python3 と同じ。式の中の \\ とは違う）', 's = f"{x:\\}"', 's = f"{x}"', '"5"', null],
  ["s = f'''{x:\"'}\"'''（三重引用符の中の書式指定の両方の引用符）", "s = f'''{x:\"'}\"'''", "s = f'''{x}\"'''", '"5\\""', null],
];
for (const [label, body, plain, want, py3spec] of H_SPEC) {
  const r = run(H_PRE + body, 'py');
  const got = r.vars ? J(r.vars.s) : 'ERR ' + r.err;
  if (py3spec !== null) ok(got === py3spec, `H-1 書式指定 ${label} → ${got}（期待 ${py3spec}＝python3 の書式指定どおりの値・BK3。BJ5〜v10.2.0 は書式指定を除いた ${want}）`);
  else ok(!r.vars && r.key === 'interp.err.fmtSpec' && r.line === 3, `H-1 書式指定 ${label} → ${got}（期待 interp.err.fmtSpec〔行 3〕＝python3 の ValueError・BK3。BJ5〜v10.2.0 は書式指定を除いた ${want}）`);
  checkPy3(`H-1 書式指定 ${label}（書式指定を除いた本文）`, 'import json\n' + H_PRE + plain + '\nprint(json.dumps(s))', [want]);
  if (py3spec !== null) checkPy3(`H-1 書式指定 ${label}（書式指定どおりの値）`, 'import json\n' + H_PRE + body + '\nprint(json.dumps(s))', [py3spec]);
  else checkPy3Err(`H-1 書式指定 ${label}（python3 は書式指定を解釈して ValueError）`, H_PRE + body, /^ValueError/);
}
{ // len（受け入れ基準の値）
  for (const [label, body, want] of [['len("""a""")', 's = """a"""\nprint(len(s))', ['1']], ['len("""a⏎b""")', 's = """a\nb"""\nprint(len(s))', ['3']]]) {
    const r = run(body, 'py');
    ok(!r.err && J(r.out) === J(want), `H-1 ${label} → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ${J(want)}・是正前は 0）`);
    checkPy3(`H-1 ${label}`, body, want);
  }
}
// docstring（関数・モジュール・Model A の loop()・Model B）があっても走る。是正前は """say "hi" """ が「未定義の変数/名前: hi」。
//   [ラベル, 本文, 期待する出力, tick 数, docstring の数（AST の中の「文字列だけの文」の数。是正前は 1 つの docstring が 3 つ以上に割れた）]
const H_DOC = [
  ['関数の docstring """say "hi" """', 'def f():\n  """say "hi" """\n  return 1\nprint(f())', ['1'], 0, 1],
  ['関数の docstring """doc⏎more"""', 'def f():\n  """doc\nmore"""\n  return 1\nprint(f())', ['1'], 0, 1],
  ['関数の docstring \'\'\'It\'s "ok"\'\'\'', 'def f():\n  \'\'\'It\'s "ok"\'\'\'\n  return 1\nprint(f())', ['1'], 0, 1],
  ['モジュールの docstring と Model A の loop() の docstring（1 tick）', '"""module\n  doc"""\ndef setup():\n  pass\ndef loop():\n  """loop doc"""\n  print(1)', ['1'], 1, 2],
  ['Model B の本体の docstring（2 tick）', 'n = 0\nwhile True:\n  """body\n  doc"""\n  n += 1\n  print(n)', ['1', '2'], 2, 1],
];
const strStmts = (node) => (Array.isArray(node) ? node.reduce((a, x) => a + strStmts(x), 0)
  : node && typeof node === 'object' ? (node.t === 'exprstmt' && node.expr && node.expr.t === 'str' ? 1 : 0) + Object.values(node).reduce((a, x) => a + strStmts(x), 0) : 0);
for (const [label, src, want, ticks, nDoc] of H_DOC) {
  const r = run(src, 'py', ticks);
  let nd; try { nd = strStmts(parsePy(src)); } catch (e) { nd = 'ERR ' + (e.message || e); }
  ok(!r.err && J(r.out) === J(want) && nd === nDoc, `H-1 ${label} → ${r.err ? 'ERR ' + r.err : J(r.out)}・docstring ${nd} 個（期待 ${J(want)}・${nDoc} 個）`);
  checkPy3(`H-1 ${label}`, asPy3(src, ticks), want);
}
{ // C は三重引用符を扱わない（従来どおり "" "a" "" の 3 つの文字列＝構文エラー。字句エラーではない）
  const r = run('auto s = """a""";\nvoid setup(){}\nvoid loop(){}', 'c');
  ok(!!r.err && r.err.startsWith('構文エラー(C)'), `H-1 C の """a""" は従来どおり構文エラー（三重引用符を扱わない）（実 ${r.err ? r.err : '走った'}）`);
}
// H-2 行番号。文字列の中の改行で行を進める（文字列の後ろの文は物理行・文字列で始まる文の行は開き引用符の行）。
//   [ラベル, 言語, 本文, tick 数, キー, 行, 是正前の行, python3 の例外（null＝照合しない）]
const H_LINE = [
  ['s = """a⏎b"""⏎x = 1/0', 'py', 's = """a\nb"""\nx = 1/0', 0, 'divZero', 3, 2, /^ZeroDivisionError/],
  ['s = "a⏎b"⏎x = 1/0（通常の引用符の中の改行・Python は SyntaxError＝物理行で判定）', 'py', 's = "a\nb"\nx = 1/0', 0, 'divZero', 3, 2, null],
  ['x = 1⏎"""a⏎b"""⏎y = 1/0（文字列だけの文）', 'py', 'x = 1\n"""a\nb"""\ny = 1/0', 0, 'divZero', 4, 3, /^ZeroDivisionError/],
  ['s = "a\\⏎b"⏎x = 1/0（\\＋改行）', 'py', 's = "a\\\nb"\nx = 1/0', 0, 'divZero', 3, 2, /^ZeroDivisionError/],
  ['s = f"""a⏎{x}⏎b"""⏎y = 1/0（f-string の中の改行）', 'py', 'x = 1\ns = f"""a\n{x}\nb"""\ny = 1/0', 0, 'divZero', 5, 3, /^ZeroDivisionError/],
  ['関数の docstring の後の文', 'py', 'def f():\n  """doc\n  more"""\n  return 1/0\nf()', 0, 'divZero', 4, 3, /^ZeroDivisionError/],
  ['Model A の loop() の中（1 tick）', 'py', 'def setup():\n  pass\ndef loop():\n  s = """a\n\nb"""\n  n = 1/0', 1, 'divZero', 7, 5, /^ZeroDivisionError/],
  ['Model B の本体（1 tick）', 'py', 'while True:\n  s = \'\'\'a\nb\'\'\'\n  n = 1/0', 1, 'divZero', 4, 3, /^ZeroDivisionError/],
  ['C auto s = "a⏎b"; の次の行', 'c', 'void setup(){\n  auto s = "a\nb";\n  int x = 1 / 0;\n}\nvoid loop(){}', 0, 'divZero', 4, 3, null],
  ['C 2 つの改行を含む文字列と #define の後', 'c', '#define K 0\nint a = 1;\nvoid setup(){}\nvoid loop(){\n  Serial.println("x\ny\nz");\n  int b = a / K;\n}', 1, 'divZero', 8, 6, null],
  ['s = """a\\⏎b"""⏎x = 1/0（三重引用符の中の \\＋改行）', 'py', 's = """a\\\nb"""\nx = 1/0', 0, 'divZero', 3, 2, /^ZeroDivisionError/],
  ['s = "a<CR>b"⏎x = 1/0（CR 単独は改行に数えない＝本体ループと同じ）', 'py', 's = "a\rb"\nx = 1/0', 0, 'divZero', 2, 2, null],
  ['s = """a<CR>b<CR>c"""⏎x = 1/0（三重引用符の中の CR 単独）', 'py', 's = """a\rb\rc"""\nx = 1/0', 0, 'divZero', 2, 2, null],
];
for (const [label, lang, src, ticks, key, line, pre, py3re] of H_LINE) {
  const r = runLine(src, lang, ticks);
  ok(r.key === 'interp.err.' + key && r.line === line && r.cur === line && r.err.endsWith(`(行 ${line})`),
    `H-2 ${label} → ${key}（行 ${line}・line() ${line}・是正前は ${pre}）（実 ${r.err ? r.err : '走った'}・line() ${r.cur}）`);
  if (py3re) checkPy3Line(`H-2 ${label}`, asPy3(src, ticks), py3re, line);
}
{ // 未是正の差（決定ログに記録）: f-string の埋め込み式で出た実行時エラーの行は文の行（＝開き引用符の行）。python3 は式のある行。
  const src = 'x = 0\ns = f"""a\n{1/x}"""';
  const r = runLine(src, 'py', 0);
  ok(r.key === 'interp.err.divZero' && r.line === 2, `H-2 未是正の差: f"""a⏎{1/x}""" のゼロ除算は文の行 2（実 ${r.err ? r.err : '走った'}・python3 は式のある行 3）`);
  checkPy3Line('H-2 未是正の差（python3 は式のある行）', src, /^ZeroDivisionError/, 3);
}
{ // 未是正の差（決定ログ BJ-11 ② (d)・BJ2 F-4 と同じ扱い）: 三重引用符の中の `\`＋改行は LF を残す（python3 は行継続＝"ab"）。CR 単独は値に残る。
  for (const [label, body, want, py3want] of [
    ['s = """a\\⏎b"""', 's = """a\\\nb"""', '"a\\nb"', '"ab"'],
    ['s = f"""a\\⏎{x}"""', 'x = 5\ns = f"""a\\\n{x}"""', '"a\\n5"', '"a5"'],
    ['s = "a<CR>b"（CR 単独）', 's = "a\rb"', '"a\\rb"', null],
  ]) {
    const r = run(body, 'py');
    const got = r.vars ? J(r.vars.s) : 'ERR ' + r.err;
    ok(got === want, `H-2 未是正の差: ${label} → ${got}（期待 ${want}${py3want ? '・python3 は ' + py3want : '・python3 は CR 単独を改行として読む'}）`);
    if (py3want) checkPy3(`H-2 未是正の差: ${label}（python3 の値）`, 'import json\n' + body + '\nprint(json.dumps(s))', [py3want]);
  }
}
{ // AST の line: 三重引用符・f-string で始まる文は開き引用符の行、その後ろの文は物理行（是正前は [1,2,2,2,3,3,3,4]＝三重引用符が 3 つの文に割れ行も進まない）。
  const lines = (src, parse) => { try { return J(parse(src).body.map((s) => s.line)); } catch (e) { return 'ERR ' + (e.message || e); } };
  const a = lines('x = 1\n"""a\nb"""\nf"""c\n{x}"""\ny = 2', parsePy);
  ok(a === J([1, 2, 4, 6]), `H-2 py の文の line（x = 1／"""a⏎b"""／f"""c⏎{x}"""／y = 2）→ ${a}（期待 [1,2,4,6]）`);
  let fb;
  try { fb = J(parsePy('def f():\n  """doc\n  more"""\n  return 1').body[0].body.map((s) => s.line)); } catch (e) { fb = 'ERR ' + e.message; }
  ok(fb === J([2, 4]), `H-2 関数の本体の文の line（docstring／return）→ ${fb}（期待 [2,4]）`);
  let c;   // C のトップレベルの宣言は line を持たない（parser_c の topLevel）＝関数の本体の文で見る
  try { c = J(parseC('void setup(){\n  auto s = "a\nb";\n  int y = 2;\n}\nvoid loop(){}').body[0].body.map((s) => s.line)); } catch (e) { c = 'ERR ' + e.message; }
  ok(c === J([2, 4]), `H-2 C の関数の本体の文の line（auto s = "a⏎b";／int y = 2;）→ ${c}（期待 [2,4]）`);
}
{ // 実行位置ハイライト（line()）: loop() の最後の文が三重引用符の後ろの文なら tick の後の line() はその物理行（是正前は 5）。
  const r = runLine('def setup():\n  pass\ndef loop():\n  s = """a\nb"""\n  x = 1', 'py', 1);
  ok(!r.err && r.cur === 6, `H-2 loop() の三重引用符の後ろの文の後の line() は 6（実 ${r.err ? r.err : r.cur}・是正前は 5）`);
}
// H-3 閉じていない文字列は字句エラー（行＝開き引用符の行・日本語固定の形式＝i18n 化は Stage 案 3）。
//   [ラベル, 言語, 本文, 行, python3 の例外（null＝照合しない）]。是正前: py は黙って通る（"abc\ は "abcundefined"）・C は構文エラー（行 1）。
const H_OPEN = [
  ['py s = "abc', 'py', 's = "abc', 1, /^SyntaxError: unterminated string literal/],
  ['py s = """abc⏎x = 2', 'py', 's = """abc\nx = 2', 1, /^SyntaxError: unterminated triple-quoted string literal/],
  ['py x = 1⏎s = f"{x}', 'py', 'x = 1\ns = f"{x}', 2, /^SyntaxError: unterminated f-string literal/],
  ['C auto s = "abc;', 'c', 'auto s = "abc;\nvoid setup(){}\nvoid loop(){}', 1, null],
  ["py s = 'abc", 'py', "s = 'abc", 1, /^SyntaxError: unterminated string literal/],
  ["py x = 1⏎s = '''It's", 'py', "x = 1\ns = '''It's", 2, /^SyntaxError: unterminated triple-quoted string literal/],
  ['py s = """a""""（引用符が 1 つ多い）', 'py', 's = """a""""', 1, /^SyntaxError: unterminated string literal/],
  ['py s = "abc\\（\\ で終わる・是正前は "abcundefined"）', 'py', 's = "abc\\', 1, /^SyntaxError: unterminated string literal/],
  ["py s = f\"{'abc}\"（式の中の閉じていない文字列）", 'py', "s = f\"{'abc}\"", 1, /^SyntaxError: unterminated string literal/],
  ["py x = 1⏎s = f'''{x}⏎y = 2", 'py', "x = 1\ns = f'''{x}\ny = 2", 2, /^SyntaxError: unterminated triple-quoted f-string literal/],
  ['py 3 行目で開いた " がファイル末尾まで閉じない', 'py', 'a = 1\nb = 2\nc = "x\nd = 4\n', 3, null],
  ['C #define S "abc（行 2・是正前は使わないマクロならエラー無し）', 'c', 'int a = 1;\n#define S "abc\nvoid setup(){}\nvoid loop(){}', 2, null],
  ["C char c = 'a;", 'c', "char c = 'a;\nvoid setup(){}\nvoid loop(){}", 1, null],
];
for (const [label, lang, src, line, py3re] of H_OPEN) {
  for (const [form, body] of [['LF', src], ['CRLF', crlf(src)]]) {
    const r = run(body, lang);
    ok(!!r.err && r.err.startsWith('字句エラー: 閉じていない文字列') && r.err.endsWith(` (行 ${line})`) && r.out.length === 0,
      `H-3 ${label}（${form}）→ 字句エラー（行 ${line}）（実 ${r.err ? r.err : '走った ' + J(r.vars && r.vars.s)}）`);
  }
  if (py3re) checkPy3Line(`H-3 ${label}`, src, py3re, line);
}
{ // f-string の埋め込み式の字句エラー・構文エラーの行は物理行（字句エラー＝その文字・閉じていない文字列の開き引用符の行／構文エラー＝読めなかった
  //   トークンの行。python3 と同じ行の本文で照合）。BJ5 の初版は式の字句解析を開き引用符の行から始めてトークンの行を開き引用符の行で上書きしていた＝
  //   字句エラーは「開き引用符の行＋式の中の改行の数」・構文エラーは開き引用符の行（初版の木で実測: 4 本目が 3・ほかは 2）。
  //   是正前の 0aa4039 は三重引用符の f-string が無く 1〜5 本目はエラー無しで走った（s は空文字列）。6 本目は 0aa4039 でも構文エラーで行 2。
  //   [ラベル, 本文, 先頭, 行, python3 の例外（null＝照合しない）]
  const H_FEXPR = [
    ['f"""a⏎{x\\y}"""（式の中の \\）', 'x = 1\ns = f"""a\n{x\\y}"""\nz = 2', "字句エラー: 不明な文字 '\\'", 3, /^SyntaxError: unexpected character after line continuation character/],
    ["f\"\"\"a⏎{'abc}\"\"\"（式の中の閉じていない文字列）", "x = 1\ns = f\"\"\"a\n{'abc}\"\"\"\nz = 2", '字句エラー: 閉じていない文字列', 3, /^SyntaxError: unterminated string literal/],
    ['f"""a⏎{x y}"""（式の構文エラー）', 'x = 1\ns = f"""a\n{x y}"""\nz = 2', '構文エラー(Py)', 3, /^SyntaxError: invalid syntax/],
    ["f\"\"\"a⏎{⏎'abc}\"\"\"（式の中の改行の後の閉じていない文字列・層 4 の指摘の入力）", "x = 1\ns = f\"\"\"a\n{\n'abc}\"\"\"", '字句エラー: 閉じていない文字列', 4, /^SyntaxError: unterminated string literal/],
    ['f"""a⏎{⏎x y}"""（式の中の改行の後の構文エラー）', 'x = 1\ns = f"""a\n{\nx y}"""', '構文エラー(Py)', 4, /^SyntaxError: invalid syntax/],
    ['f"a\\⏎{x y}"（通常の引用符の \\＋改行の後の式）', 'x = 5\ns = f"a\\\n{x y}"', '構文エラー(Py)', 3, /^SyntaxError: invalid syntax/],
  ];
  for (const [label, src, head, line, py3re] of H_FEXPR) {
    for (const [form, body] of [['LF', src], ['CRLF', crlf(src)]]) {
      const r = run(body, 'py');
      ok(!!r.err && r.err.startsWith(head) && r.err.endsWith(` (行 ${line})`), `H-3 ${label}（${form}）→ ${head}…（行 ${line}）（実 ${r.err ? r.err : '走った'}）`);
    }
    if (py3re) checkPy3Line(`H-3 ${label}`, src, py3re, line);
  }
}
{ // 閉じ `}` の無い置換フィールドは字句エラー（行＝`{` の行）。是正前（0aa4039）も BJ5 の初版もエラー無しで "5" 等（python3 は SyntaxError）。
  //   式の中の `\` は、是正前と初版は `\}` で式を閉じて `\` を黙って落とした（f"{x\}" → "5"）＝今は字句エラー（python3 と同じ SyntaxError）。
  //   [ラベル, 本文, エラー文（完全一致）, python3 の例外, python3 の行]
  const H_FIELD = [
    ['x = 5⏎s = f"{x"', 'x = 5\ns = f"{x"', '字句エラー: f-string の { に対応する } がありません (行 2)', /^SyntaxError: f-string: expecting '}'/, 2],
    ["x = 5⏎s = f\"{x:'>5\"（書式指定の後に閉じ } が無い）", "x = 5\ns = f\"{x:'>5\"", '字句エラー: f-string の { に対応する } がありません (行 2)', /^SyntaxError: f-string: expecting '}'/, 2],
    ["x = 5⏎s = f\"\"\"{x⏎:'>5\"\"\"（三重引用符・行＝{ の行）", "x = 5\ns = f\"\"\"{x\n:'>5\"\"\"", '字句エラー: f-string の { に対応する } がありません (行 2)', /^SyntaxError: '\{' was never closed/, 2],
    ["x = 5⏎s = f\"\"\"a⏎{x:'>5\"\"\"（{ が開き引用符より後の行）", "x = 5\ns = f\"\"\"a\n{x:'>5\"\"\"", '字句エラー: f-string の { に対応する } がありません (行 3)', /^SyntaxError: f-string: expecting '}'/, 3],
    ['x = 5⏎s = f"{x\\}"（式の中の \\・是正前は "5"）', 'x = 5\ns = f"{x\\}"', "字句エラー: 不明な文字 '\\' (行 2)", /^SyntaxError: unexpected character after line continuation character/, 2],
    ['x = 5⏎s = f"{x\\:>3}"（式の中の \\: は書式指定の始まりではない・是正前も初版も同じ字句エラー。判定を ch で行うと "5"）', 'x = 5\ns = f"{x\\:>3}"', "字句エラー: 不明な文字 '\\' (行 2)", /^SyntaxError: unexpected character after line continuation character/, 2],
  ];
  for (const [label, src, msg, py3re, py3line] of H_FIELD) {
    for (const [form, body] of [['LF', src], ['CRLF', crlf(src)]]) {
      const r = run(body, 'py');
      ok(r.err === msg && r.out.length === 0, `H-3 ${label}（${form}）→ ${msg}（実 ${r.err ? r.err : '走った ' + J(r.vars && r.vars.s)}）`);
    }
    checkPy3Line(`H-3 ${label}`, src, py3re, py3line);
  }
}
{ // 未是正の差（決定ログ BJ-11 ②）: f-string のリテラル部分の単独の `}` はそのまま文字（python3 は SyntaxError・出力に `}` が見える）。
  //   同じ種類の引用符の入れ子（PEP 701・python 3.12 以降）は未対応で字句エラー（外側の文字列が式の中の引用符で閉じる。3.11 以前の python も SyntaxError。
  //   是正前・初版は構文エラー「予期しないトークン ')'」＝文言が変わった＝`--root` の木では赤）。単独の `}` は是正前・初版と同じ値（`--root` でも緑）。
  //   BK3（Stage BK・v10.3.0）: 単独の `}` は是正した＝構文エラー interp.syn.fstrRBrace（行 2・python3 と同じ SyntaxError。是正前の期待値は "a}b5"）。
  const r1 = run('x = 5\ns = f"a}b{x}"', 'py');
  ok(!r1.vars && r1.key === 'interp.syn.fstrRBrace' && r1.line === 2, `H-3 f"a}b{x}"（BK3 で是正）→ ${r1.err ? 'ERR ' + r1.err : J(r1.vars.s)}（期待 interp.syn.fstrRBrace〔行 2〕・python3 は SyntaxError・BJ5〜v10.2.0 は "a}b5"）`);
  checkPy3Err('H-3 f"a}b{x}"', 'x = 5\ns = f"a}b{x}"', /^SyntaxError: f-string: single '}' is not allowed/);
  const r2 = run('d = {"k": 1}\ns = f"{d["k"]}"', 'py');
  ok(r2.err === '字句エラー: f-string の { に対応する } がありません (行 2)', `H-3 未是正の差: f"{d["k"]}"（同じ引用符の入れ子）→ ${r2.err ? r2.err : '走った ' + J(r2.vars && r2.vars.s)}（期待 字句エラー（行 2）・python3.12 以降は 1）`);
}
{ // 置換本体の不明な文字の行も指令の行（是正前は行 1）
  const r = run('int a = 1;\n#define S @\nvoid setup(){}\nvoid loop(){}', 'c');
  ok(!!r.err && r.err === "字句エラー: 不明な文字 '@' (行 2)", `H-3 C #define S @ の字句エラーは指令の行 2（実 ${r.err ? r.err : '走った'}・是正前は行 1）`);
}
// H-4 CRLF: H-1／H-2 の本文の CRLF 版の AST（line を含む）と値・エラーの行が LF 版と一致。
{
  const bad = [];
  const srcs = [...H_VALS.map(([l, b]) => ['py', l, H_PRE + b, 0]), ...H_SPEC.map(([l, b]) => ['py', l, H_PRE + b, 0]), ...H_DOC.map(([l, s, , t]) => ['py', l, s, t]),
    ...H_LINE.map(([l, lang, s, t]) => [lang, l, s, t])];
  for (const [lang, label, src, ticks] of srcs) {
    const a = astOf(src, lang), b = astOf(crlf(src), lang);
    const rl = runLine(src, lang, ticks), rc = runLine(crlf(src), lang, ticks);
    const vl = run(src, lang, ticks), vc = run(crlf(src), lang, ticks);
    const same = !a.startsWith('ERR') && a === b && J(rl) === J(rc) && J(vl.out) === J(vc.out) && J(vl.vars && vl.vars.s) === J(vc.vars && vc.vars.s) && vl.err === vc.err;
    if (!same) bad.push(label);
  }
  ok(bad.length === 0 && srcs.length > 0, `H-4 H-1／H-2 の本文 ${srcs.length} 本: CRLF 版の AST（line を含む）・値・エラーの行が LF 版と一致${bad.length ? '（不一致 ' + bad.join(', ') + '）' : ''}`);
}


// ── I) BJ6 1 行の suite の break／continue／pass／return・その文の行番号・returnOutside の文言 ─────────────────────────
console.log('\nI) BJ6 1 行の suite（if …: break ほか）— 是正前: if n == 2: break が「未定義の変数/名前: break」・def f(): return 1 の f() が「…: return」・' +
  'else: z = 1 / 0 のエラーが if の行・returnOutside の文言が C の return; にも while True: を案内');
// I-1 値。[ラベル, 本文, python3 の出力（定数・2026-10-12 Python 3.14.4）, tick 数, 是正前（473f95b）の結果]。python3 も同じ出力（checkPy3）。
const I_VALS = [
  ['while の中の if n == 2: break', 'n = 0\nwhile n < 5:\n  n += 1\n  if n == 2: break\nprint(n)', ['2'], 0, '未定義の変数/名前: break (行 4)'],
  ['while の中の if n == 2: continue', 'n = 0\ns = 0\nwhile n < 4:\n  n += 1\n  if n == 2: continue\n  s += n\nprint(s)', ['8'], 0, '未定義の変数/名前: continue (行 5)'],
  ['for の中の if k < 2: pass と else: continue', 'for k in range(4):\n  if k < 2: pass\n  else: continue\n  print(k)', ['0', '1'], 0, '未定義の変数/名前: pass (行 2)'],
  ['while x: break', 'x = 1\nwhile x: break\nprint(x)', ['1'], 0, '未定義の変数/名前: break (行 2)'],
  ['def f(): return 1', 'def f(): return 1\nprint(f())', ['1'], 0, '未定義の変数/名前: return (行 2)'],
  ['関数の中の if a: return 5', 'def g(a):\n  if a: return 5\n  return 7\nprint(g(1), g(0))', ['5 7'], 0, '未定義の変数/名前: return (行 2)'],
  ['関数の中の if x: return（値なし）', 'def h():\n  x = 1\n  if x: return\n  print("no")\nh()\nprint("ok")', ['ok'], 0, '未定義の変数/名前: return (行 3)'],
  ['def f2(): global x', 'x = 0\ndef f2(): global x\nf2()\nprint(x)', ['0'], 0, '未定義の変数/名前: global (行 3)'],
  // 同じ規則の別の形
  ['if i == 0: continue と elif i == 3: break', 'for i in range(5):\n  if i == 0: continue\n  elif i == 3: break\n  print(i)', ['1', '2'], 0, '未定義の変数/名前: continue (行 2)'],
  ['for i in range(3): pass の後の i', 'for i in range(3): pass\nprint(i)', ['2'], 0, '未定義の変数/名前: pass (行 1)'],
  ['def f(): return 1, 2（タプル）', 'def f(): return 1, 2\na, b = f()\nprint(a, b)', ['1 2'], 0, '未定義の変数/名前: return (行 2)'],
  ['def f(a): return a * 2 if a else -1（条件式）', 'def f(a): return a * 2 if a else -1\nprint(f(3), f(0))', ['6 -1'], 0, '未定義の変数/名前: a (行 1)'],
  ['if a: return g() は a が偽なら g() を呼ばない', 'def g():\n  print("g")\n  return 1\ndef f(a):\n  if a: return g()\n  return 7\nprint(f(0))', ['7'], 0,
    'エラー無しで ["g","7"]＝a が偽の間 g() を無条件に呼んだ（return g() の g() がトップレベルではなく関数の本体の別の文になった）'],
  ['if 1: import math', 'if 1: import math\nprint(1)', ['1'], 0, '未定義の変数/名前: import (行 1)'],
  ['def loop() の中の if 1: return（Model A・1 tick）', 'def setup():\n  pass\ndef loop():\n  print("a")\n  if 1: return\n  print("no")', ['a'], 1, '出力 ["a"] の後「未定義の変数/名前: return (行 5)」'],
  ['def setup(): pass と def loop(): print(n)（Model A・1 tick）', 'n = 3\ndef setup(): pass\ndef loop(): print(n)', ['3'], 1, '未定義の変数/名前: pass (行 1)'],
];
for (const [label, src, want, ticks, pre] of I_VALS) {
  const r = run(src, 'py', ticks);
  ok(!r.err && linesEq(r.out, want), `I-1 ${label} → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ${J(want)}・是正前 ${pre}）`);
  checkPy3(`I-1 ${label}`, asPy3(src, ticks), want);
}
{ // Model B（トップレベルの while True:）の 1 行の suite の break を本番の tickSlot で（G-3 と同じ見方）。3 tick 目に break し、ループの後ろの文を
  //   その tick で 1 回だけ走らせて終わる＝running は true のまま・ログ ["after 3"]・以降の tick でログが増えない。
  //   是正前は 1 tick 目に「【実行時エラー】未定義の変数/名前: break (行 4)」で停止（running=false）。
  const src = 'n = 0\nwhile True:\n  n += 1\n  if n == 3: break\nprint("after", n)';
  const counts = [];
  const { logs, slot, vars } = runSlot(src, 8, (s, k, lg) => counts.push(lg.length));
  ok(slot.running === true && J(logs) === J(['after 3']) && vars.n === 3 && J(counts) === J([0, 0, 1, 1, 1, 1, 1, 1]),
    `I-1 Model B の if n == 3: break（8 tick）: running=${slot.running}・ログ ${J(logs)}・n=${vars.n}・tick ごとのログ行数 ${J(counts)}（期待 true・["after 3"]・3・[0,0,1,1,1,1,1,1]）`);
  checkPy3('I-1 Model B の if n == 3: break', asPy3(src, 8), ['after 3']);
}
// I-2 行番号。(a) AST の line: 1 行の suite の文に先頭のトークンの行（是正前は line 無し・キーワードは exprstmt の変数）。
{
  const src = 'x = 1\nif x: y = 2\nelse: y = 3\ndef f(): return 4\nwhile x: break\nfor i in range(2): pass\nfor c in "ab": continue\nif x:\n  pass\nelif x: y = 5\ndef g(): global x\nif x: import math';
  let got;
  try {
    const b = parsePy(src).body;
    const one = [b[1].then[0], b[1].els[0], b[2].body[0], b[3].body[0], b[4].body[0], b[5].body[0], b[6].els[0].then[0], b[7].body[0], b[8].then[0]];
    got = J(one.map((s) => [s.t, s.line]));
  } catch (e) { got = 'ERR ' + (e.message || e); }
  const want = J([['massign', 2], ['massign', 3], ['return', 4], ['break', 5], ['pass', 6], ['continue', 7], ['massign', 10], ['pass', 11], ['pass', 12]]);
  ok(got === want, `I-2 1 行の suite の文の AST の [t, line] → ${got}（期待 ${want}）`);
}
// (b) エラーの行と line()。[ラベル, 本文, tick 数, キー, 行, 是正前の行, python3 の例外]
const I_LINE = [
  ['else: z = 1 / 0（if の 2 行後の else）', 'n = 0\nwhile n < 3:\n  n += 1\n  if n == 9:\n    pass\n  else: z = 1 / 0', 0, 'divZero', 6, '4（if の行）', /^ZeroDivisionError/],
  ['def f(): return 1 / 0', 'def f(): return 1 / 0\nprint(f())', 0, 'divZero', 1, '1（関数の中ではなくトップレベルの別の文 1 / 0 の行）', /^ZeroDivisionError/],
  ['def f(): x = 1 / 0（呼び出しは行 3）', 'def f(): x = 1 / 0\ny = 1\nf()', 0, 'divZero', 1, '3（呼び出し元の行）', /^ZeroDivisionError/],
  ['if x == \\⏎   1: y = 1 / 0（\\ で続けた条件の後の文）', 'x = 1\nif x == \\\n   1: y = 1 / 0', 0, 'divZero', 3, '2（if の行）', /^ZeroDivisionError/],
  ['if """a⏎b""": z = 1 / 0（改行を含む文字列の条件の後の文）', 'if """a\nb""": z = 1 / 0', 0, 'divZero', 2, '1（if の行）', /^ZeroDivisionError/],
];
for (const [label, src, ticks, key, line, pre, py3re] of I_LINE) {
  const r = runLine(src, 'py', ticks);
  ok(r.key === 'interp.err.' + key && r.line === line && r.cur === line && r.err.endsWith(`(行 ${line})`),
    `I-2 ${label} → ${key}（行 ${line}・line() ${line}・是正前は ${pre}）（実 ${r.err ? r.err : '走った'}・line() ${r.cur}）`);
  checkPy3Line(`I-2 ${label}`, asPy3(src, ticks), py3re, line);
}
{ // def f(): return 1 / 0 の 1 / 0 は関数の中の式（是正前はトップレベルの別の文で、print("a") より前に行 1 のゼロ除算＝出力 []）。
  const src = 'def f(): return 1 / 0\nprint("a")\nprint(f())';
  const r = run(src, 'py');
  ok(r.key === 'interp.err.divZero' && r.line === 1 && J(r.out) === J(['a']),
    `I-2 def f(): return 1 / 0 の後の print("a") が先に走り f() でゼロ除算（行 1）（実 ${r.err ? r.err : '走った'}・出力 ${J(r.out)}・是正前は出力 [] で行 1）`);
  checkPy3Line('I-2 def f(): return 1 / 0（print("a") の後）', src, /^ZeroDivisionError/, 1);
}
{ // 実行位置ハイライト: 1 行の def loop(): y = 1 の 1 tick の後の line() は 2（是正前は 0＝関数の本体の文に line が無かった）。
  const r = runLine('def setup(): x = 0\ndef loop(): y = 1', 'py', 1);
  ok(!r.err && r.cur === 2, `I-2 def loop(): y = 1 の 1 tick の後の line() は 2（実 ${r.err ? r.err : r.cur}・是正前は 0）`);
}
// (c) ループの外・関数の外の 1 行の suite の break／continue／return（是正前は「未定義の変数/名前」）。ja と en・キー・行は okErr（G-4／G-5 と同じ見方）、
//   python3 の SyntaxError の種類と行は checkPy3Line。[ラベル, 本文, tick 数, キー, 行, python3 の例外]
const I_OUT = [
  ['def loop(): の中の if x: break（1 tick）', 'def loop():\n  x = 1\n  if x: break', 1, 'breakOutside', 3, /^SyntaxError: 'break' outside loop/],
  ['def loop(): の中の if 1: continue（1 tick）', 'def loop():\n  if 1: continue', 1, 'continueOutside', 2, /^SyntaxError: 'continue' not properly in loop/],
  ['トップレベルの if x: return', 'x = 1\nif x: return', 0, 'returnOutside', 2, /^SyntaxError: 'return' outside function/],
  ['Model B の while True: の中の if 1: return（1 tick）', 'n = 0\nwhile True:\n  if 1: return', 1, 'returnOutside', 3, /^SyntaxError: 'return' outside function/],
];
for (const [label, src, ticks, key, line, py3re] of I_OUT) {
  okErr(`I-2 ${label}`, src, 'py', ticks, key, line, null);
  checkPy3Line(`I-2 ${label}`, src, py3re, line);
}
// I-3 従来の形は変えない。1 行の suite の単純文（キーワード以外）は従来どおり simpleStmt。
{
  const src = 'x = 1\nif x: y = 2\nprint(y)';
  const r = run(src, 'py');
  ok(!r.err && J(r.out) === J(['2']), `I-3 if x: y = 2 → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ["2"]・是正前と同じ）`);
  checkPy3('I-3 if x: y = 2', src, ['2']);
}
// 1 行の suite の複合文は是正前（473f95b）と同じ文言の構文エラー（完全一致）。[ラベル, 本文, エラー文, python3 の本文, python3: 正規表現＝SyntaxError]
//   BK2（2026-10-13・Stage BK「Python 構文の穴 I」(18)）: `;` の 6 行は BJ6 では「未是正の差」として是正前と同じ構文エラー「予期しないトークン ';'」を
//   期待し、python3 の出力を定数で持っていた。BK2 が `;` を受理したので、その 6 行は下の I_SEMI（python3 と同じ出力）へ移した（期待値を
//   黙って変えたのではない＝決定ログ BK2 結果）。BK2 では 1 行の suite の複合文を inlineCompound が見出しまで読んで ':' で止めるので、
//   文言・行は BJ6 の期待値のまま。
const I_SYN = [
  ['1 行の suite の if（if x: if x: pass）', 'x = 1\nif x: if x: pass', "構文エラー(Py): 予期しないトークン ':' (行 2)", null, /^SyntaxError: invalid syntax/],
  ['1 行の suite の for（while x: for i in range(2): pass）', 'x = 1\nwhile x: for i in range(2): pass', "構文エラー(Py): 予期しないトークン ':' (行 2)", null, /^SyntaxError: invalid syntax/],
  ['1 行の suite の while（if x: while x: pass）', 'x = 1\nif x: while x: pass', "構文エラー(Py): 予期しないトークン ':' (行 2)", null, /^SyntaxError: invalid syntax/],
  ['1 行の suite の def（if x: def g(): pass）', 'x = 1\nif x: def g(): pass', "構文エラー(Py): 予期しないトークン ':' (行 2)", null, /^SyntaxError: invalid syntax/],
  ['else: の 1 行の suite の if', 'x = 1\nif x:\n  pass\nelse: if x: pass', "構文エラー(Py): 予期しないトークン ':' (行 4)", null, /^SyntaxError: invalid syntax/],
];
for (const [label, src, msg, py3src, py3want] of I_SYN) {
  const r = run(src, 'py');
  ok(r.err === msg && r.out.length === 0, `I-3 ${label} → ${msg}（是正前と同じ）（実 ${r.err ? r.err : '走った ' + J(r.out)}）`);
  checkPy3Err(`I-3 ${label}`, src, py3want);
}
// BK2 (18): 1 行の suite の `;`（BJ6 では未是正の差）。python3 と同じ出力（定数＝BJ6 が持っていた python3 の値・checkPy3 で突き合わせ）。
//   [ラベル, 本文, tick 数, python3 の出力, 是正前（BJ6・473f95b〜06d65ab）の結果]。`while 1:` は Model B＝1 tick で break して後ろの print(2)。
const I_SEMI = [
  ['if x: a = 1; b = 2', 'x = 1\nif x: a = 1; b = 2\nprint(a, b)', 0, ['1 2'], "構文エラー(Py): 予期しないトークン ';' (行 2)"],
  ['a = 1; b = 2', 'a = 1; b = 2\nprint(a, b)', 0, ['1 2'], "構文エラー(Py): 予期しないトークン ';' (行 1)"],
  ['def f(): global x; x = 1', 'x = 0\ndef f(): global x; x = 1\nf()\nprint(x)', 0, ['1'], "構文エラー(Py): 予期しないトークン ';' (行 2)"],
  ['if 1: import math; import time', 'if 1: import math; import time\nprint(1)', 0, ['1'], "構文エラー(Py): 予期しないトークン ';' (行 1)"],
  ['def f(): return; x = 1', 'def f(): return; x = 1\nprint(2)', 0, ['2'], "構文エラー(Py): 予期しないトークン ';' (行 1)"],
  ['while 1: break; x = 1', 'while 1: break; x = 1\nprint(2)', 1, ['2'], "構文エラー(Py): 予期しないトークン ';' (行 1)"],
];
for (const [label, src, ticks, want, pre] of I_SEMI) {
  const r = run(src, 'py', ticks);
  ok(!r.err && J(r.out) === J(want), `I-3 BK2 ${label} → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ${J(want)}＝python3・BJ6 では ${pre}）`);
  checkPy3(`I-3 BK2 ${label}`, src, want);
}
// キーワードの単純文の後ろの同じ行の続きは構文エラー（Python も SyntaxError）。是正前: if x: break 5 は「未定義の変数/名前: break」・
//   def f(): return 1 2 と def f(): pass 5 は f を呼ばなければエラー無しで走った（v10.1.0 も同じ）。
const I_JUNK = [
  ['if x: break 5', 'x = 1\nif x: break 5', "構文エラー(Py): 予期しないトークン '5' (行 2)"],
  ['def f(): return 1 2', 'def f(): return 1 2\nprint(3)', "構文エラー(Py): 予期しないトークン '2' (行 1)"],
  ['def f(): pass 5', 'def f(): pass 5\nprint(3)', "構文エラー(Py): 予期しないトークン '5' (行 1)"],
];
for (const [label, src, msg] of I_JUNK) {
  const r = run(src, 'py');
  ok(r.err === msg && r.out.length === 0, `I-3 ${label} → ${msg}（実 ${r.err ? r.err : '走った ' + J(r.out)}）`);
  checkPy3Err(`I-3 ${label}`, src, /^SyntaxError: invalid syntax/);
}
// I-4 returnOutside の文言（ja／en とも while を含まない＝py の while True: と C の while (1) の両方で通る）。是正前は
//   「while True: の 1 回分を終えるなら continue」を C の関数の外の return; にも案内した。
{
  const m = MESSAGES['interp.err.returnOutside'] || {};
  ok(typeof m.ja === 'string' && typeof m.en === 'string' && !!m.ja && !!m.en && !/while/i.test(m.ja) && !/while/i.test(m.en)
    && /continue/.test(m.ja) && /break/.test(m.ja) && /continue/.test(m.en) && /break/.test(m.en) && !JP_RE.test(m.en),
    `I-4 interp.err.returnOutside の ja／en に while が無い（continue と break の案内はある・en に日本語なし）（実 ja ${J(m.ja)}・en ${J(m.en)}）`);
  const I_RET = [
    ['py Model B の while True: の中の return（1 tick）', 'n = 0\nwhile True:\n  n += 1\n  return', 'py', 1, 4],
    ['C の関数の外の return;', 'int x = 1;\nreturn;\nvoid setup(){}\nvoid loop(){}', 'c', 0, 2],
    ['C のトップレベルの while (1) の中の return;（2 tick）', 'int n = 0;\nwhile (1) {\n  n++;\n  if (n == 2) return;\n}', 'c', 2, 4],
  ];
  for (const [label, src, lang, ticks, line] of I_RET) {
    okErr(`I-4 ${label}`, src, lang, ticks, 'returnOutside', line, null);
    setLang('en'); const en = run(src, lang, ticks); setLang('ja');
    const ja = run(src, lang, ticks);
    ok(!!m.ja && ja.err === `${m.ja} (行 ${line})` && en.err === `${m.en} (line ${line})`,
      `I-4 ${label} の表示が新しい文言そのもの（実 ja ${J(ja.err)}・en ${J(en.err)}）`);
  }
}
// I-5 CRLF: I-1／I-2 の本文の CRLF 版の AST（line を含む）・値・エラーの行が LF 版と一致。
{
  const bad = [];
  const srcs = [...I_VALS.map(([l, s, , t]) => [l, s, t]), ...I_LINE.map(([l, s, t]) => [l, s, t]), ...I_OUT.map(([l, s, t]) => [l, s, t])];
  for (const [label, src, ticks] of srcs) {
    const a = astOf(src, 'py'), b = astOf(crlf(src), 'py');
    const rl = runLine(src, 'py', ticks), rc = runLine(crlf(src), 'py', ticks);
    const vl = run(src, 'py', ticks), vc = run(crlf(src), 'py', ticks);
    if (!(!a.startsWith('ERR') && a === b && J(rl) === J(rc) && J(vl.out) === J(vc.out) && vl.err === vc.err)) bad.push(label);
  }
  ok(bad.length === 0 && srcs.length > 0, `I-5 I-1／I-2 の本文 ${srcs.length} 本: CRLF 版の AST（line を含む）・値・エラーの行が LF 版と一致${bad.length ? '（不一致 ' + bad.join(', ') + '）' : ''}`);
}

console.log(`\n  python3 との突き合わせ: ${PY3 ? py3Checked + ' 件' : '0 件（python3 不在）'}`);
console.log(`[結果] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
