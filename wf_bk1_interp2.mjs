// wf_bk1_interp2.mjs — Stage BK「インタプリタ是正 II」の常設ゲート。BK1 で新設し、BK2〜BK5 が章を足す（BK2＝G 章・BK3＝H 章・BK4＝I 章・BK5＝J 章）。
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
//   （2026-10-14 の実測: H1＝A の fix 後の表で pass=674 fail=139＝赤は I 章の 139 だけ・A〜H は緑。層4 往復 1 回目の表では pass=620 fail=90・
//   最初の表では pass=595 fail=73）。
//   I) 本番経路の値とエラーを python3 3.14.4 の実測（定数・checkPy3／checkPy3Line）と照合する。表の最後の列は是正前の値。
//      I-1 (3) 除数の False・0 の負のべきは divZero（指数 -inf は除く）。I-2 (4) and／or は被演算子の値。py の真偽は 1 つの規則（python3 と同じく
//          空の list／tuple／dict も偽＝H1＝A・BK-14）で、if・elif・while・not・三項・and・or・bool() が同じ判定（式 E の表の 8 経路の同値性・
//          BK-12 F1 の回帰行・11 値の if v: で是正前と違うのは [] と {} だけ）。I-3 (5) print／str／f-string／str.format／`%s`／py の Serial.print の True／False／None・return
//          の無い関数は None・C の print(true)・`"%s" % true` は "true" のまま。I-4 (6) list／tuple の ==／!= は要素ごと・list と tuple は等しくない・
//          入れ子 30000 段でも JS の RangeError を出さない（`is` は構文エラーのまま）。I-5 (8)(11) count／index／remove・dict のキーと添字の bool は数・
//          index と remove の未発見は interp.err.notInList。I-6 (11) // は CPython の床除算（1 // 0.1 は 9.0）。I-7 (17) range の引数は整数
//          （interp.err.rangeArg）・式の range の 0 のステップ。I-8 None（null）の演算と添字は interp.err.noneOp／noneIndex（==・!=・in・`%s` は通す）・
//          `%` の数の指定子に None は noneOp・list／str の添字の None は noneAsIndex・dict のキーの None は 'None'（JS の "null" を見せない）。
//      層4（wf-verify）の指摘 F1〜F9 の是正（4a23b63 の後の追加コミット cfd9a5e）: F2 の list と tuple・F5 の深い入れ子・F6・F7・F9 の行を足した。
//          cfd9a5e の F1 の是正（if・while・not・三項・bool() を是正前の truthy に戻し and／or の値だけ pyTruthy）は BK-12 F1（and／or が返した空の
//          list を if が真と見る退行）を生んだので、H1＝A（BK-14）で真偽を 1 つの規則に統一し、I-2 に同値性の表と BK-12 F1 の回帰行を足した。
//          cfd9a5e の木で `--root` を付けて回すと BK-12 F1 の回帰行を含む I 章の 33 行だけが赤（2026-10-14 の実測: pass=780 fail=33）。
//          BK-12 の low: I-4 に NaN の要素と dict.items() の == の残る差・I-7 に範囲外の添字の値の range の残る差（どちらも python3 の値を突き合わせる）。
//      出荷 23 本の出力と runRace（F 章）・出荷 py の AST 指紋（wf_bj1_pysem E 章）は不変。wf_bj1_pysem の G-9 `range(1,5,None)` は rangeStepZero から
//      rangeArg（python3 と同じ TypeError の種類）に改めた。
//
// BK5（C 定石・C だけ。py は層4 F6 の複合代入の左辺を 1 回だけ評価する是正だけ＝J-9）— 是正前の木（8ecdfd9）で `--root <木>` を付けて回すと J 章（是正前と同じ値の行を除く）と A 章の BK5 新設の
//   1 本・本数・全種が赤になる（実測は決定ログ BK5 結果）。A 章: `int y = (int)x;`（キャストの受理で通るようになった）を是正前と同じ文言・行の
//   別の本文に差し替え、lexer の blockComment を足した（lexer 5 → 6）。
//   J) 本番経路の値を gcc の実測（定数・checkGcc で同じ本文を gcc でも走らせて突き合わせる。期待値は python3 ではなく実機 C の値）と照合する。
//      J-1 関数の中の static（最初の 1 回だけ初期化・関数ごと・配列・再帰・controller ごと）。J-2 キャスト（整数型は 0 方向への切り捨て・float／
//      double・bool・void・#define の型名・`(x)` の括弧式は不変）。J-3 数値接尾辞（u・l・ul・ll・f・F・L・16 進）。J-4 カンマ演算子と for の
//      初期化部の複数の宣言子（s＝3・j＝6）。J-5 `%=`（切り捨て剰余・0 は divZero）。J-6 (27) 閉じていない `/*`（行＝`/*` の行）・閉じたコメント
//      は不変。J-7 整数の f と英数字の続く接尾辞は是正前と同じ構文エラー。J-8 C の `!`・三項・for・do-while・while の真偽は不変（BK-15 F3）。
//      J-9 BK5 層4 是正（0fbea4d の後退と端）: F1 `(int(x) + 1)` は括弧式（g++ と同じ・8ecdfd9 と同じ）・F2 char のキャストは文字コード・F3 隣の
//      ブロックの同名の宣言は static を書き換えない・F4 case の値と配列の次元のカンマは構文エラー・三項の中のカンマは受ける・F6 複合代入と ++ は
//      左辺の場所を 1 回だけ評価（C・py）・§9 の残る差（ブロックのスコープ・char の算術・(void) の値）の現在値。gcc 不在なら g++ の行も省く。
//      層4 往復 2: F2 関数形式の int('7')・float('7')・int(' ')・bool('\0') の値（v10.2.0 の 7・7・0・true から 55・55・32・false）・F4 sizeof の
//      型語の直後が ( なら式（sizeof(int(x)) は式・sizeof(int[3]) は是正前と同じ構文エラー）。J-10 F1 式の途中でファイルが終わる本文は interp.syn.unexpected（12 種×末尾 5 種と関数の中・
//      8e49d4b は JS の TypeError）。
//      C の整数除算は従来どおり非対応（`(int)7/2` は 3.5・§9）なので、gcc に渡す行に整数どうしの `/` を書かない。
//
// 使い方: node wf_bk1_interp2.mjs              … 検査
//         node wf_bk1_interp2.mjs --root <dir>  … <dir>/public/js の product で回す（改修前の木で赤になることの確認用）
// exit: 0=全緑 / 1=いずれか赤。
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  // BK5: 下の 1 本は本文を差し替えた（`int y = (int)x;` はキャストの受理で通るようになった＝J 章）。差し替えた本文の ja の文言と行も
  //   e65643e の木で採った値（是正前と同じ）。
  ['eat の期待（C の数の後ろの名前）', 'c', cLoop('  float x = 3.7; int y = 3 x;'), 'interp.syn.expected', 3,
    "構文エラー(C): ';' を期待しましたが 'x' (行 3)", "Syntax error (C): expected ';' but got 'x' (line 3)"],
  ['switch の case/default（C）', 'c', cLoop('  switch (1) { x = 1; }'), 'interp.syn.caseDefault', 3,
    "構文エラー(C): case か default を期待しましたが 'x' (行 3)", "Syntax error (C): expected case or default but got 'x' (line 3)"],
  ['primary の予期しないトークン（C・probe の C syntax err text）', 'c', cLoop('  int x = ;'), 'interp.syn.unexpected', 3,
    "構文エラー(C): 予期しないトークン ';' (行 3)", "Syntax error (C): unexpected token ';' (line 3)"],
  // BK5 新設（lexer）: 閉じていないブロックコメント（行＝`/*` の行）。是正前はエラー無し（末尾まで黙ってコメント）。
  ['閉じていないブロックコメント（C・BK5 新設）', 'c', 'int a;\n/* oops\n' + cLoop(''), 'interp.lex.blockComment', 2,
    '字句エラー: 閉じていないブロックコメント（/* で始まるコメントの終わりの */ がありません） (行 2)', 'Lexical error: unterminated block comment (the comment that starts with /* has no closing */) (line 2)'],
];
for (const [label, lang, code, key, line, wantJa, wantEn] of SRC_ERR) {
  const { ja, en } = runBoth(code, lang);
  ok(ja.err === wantJa && ja.line === line && ja.key === key,
    `A ${label}: ja ${J(ja.err)}・行 ${ja.line}・${ja.key}（期待 ${label.includes('BK2 新設') ? 'BK2 の文言' : label.includes('BK3 新設') ? 'BK3 の文言' : label.includes('BK5 新設') ? 'BK5 の文言' : '是正前と同じ'} ${J(wantJa)}・行 ${line}・${key}）`);
  ok(en.err === wantEn && en.line === line && en.key === key && !JP_RE.test(en.err || ''),
    `A ${label}: en ${J(en.err)}（期待 ${J(wantEn)}・日本語なし）`);
}
{ // 発生箇所の本数（ソースを数える）と、各 sub が上の表で起きていること（全種）。
  const lex = [...src('interp/lexer.js').matchAll(/throw lexErr\('([A-Za-z]+)'/g)].map((m) => m[1]);
  const py = [...src('interp/parser_py.js').matchAll(/(?<!function )\berr\('([A-Za-z]+)'/g)].map((m) => m[1]);
  const c = [...src('interp/parser_c.js').matchAll(/(?<!function )\berr\('([A-Za-z]+)'/g)].map((m) => m[1]);
  ok(lex.length === 6 && py.length === 13 && c.length === 3,
    `A 発生箇所の本数: lexer ${lex.length}・parser_py ${py.length}・parser_c ${c.length}（期待 6・13・3＝22。BK1 は 4・4・3＝11、BK2 が parser_py に 5 箇所〔err の中と program の末尾の unclosed・inlineCompound の unexpected・augList・bytes〕、` +
    `BK3 が lexer に 1 箇所〔書式指定の中で閉じ } の無い fstrBrace〕・parser_py に 4 箇所〔fstrRBrace・kwRepeat・posAfterKw・kwArg〕、BK5 が lexer に 1 箇所〔blockComment〕）`);
  const covered = new Set(SRC_ERR.map((r) => r[3]));
  const want = [...lex.map((s) => 'interp.lex.' + s), ...py.map((s) => 'interp.syn.' + s), ...c.map((s) => 'interp.syn.' + s)];
  const miss = [...new Set(want)].filter((k) => !covered.has(k));
  ok(want.length === 22 && miss.length === 0, `A 発生箇所の全種（${[...new Set(want)].join('・')}）が表で起きている${miss.length ? '（未検査 ' + miss.join(', ') + '）' : ''}`);
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
console.log('\nI) BK4 値の意味論（ゼロ除算・and/or の値と py の真偽〔空の容器は偽〕・True/None の表示・list の ==・bool と数のキー・// ・range の引数）— 是正前（850bbb2）の値は各表の最後の列');
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
  // 層4 F6: 指数が -inf なら divZero にしない（python3 も inf。値は == で比べる＝float の表示は未是正の差）。
  ['0 ** -math.inf・0.0 ** -math.inf・False ** -math.inf は inf（層4 F6）', 'import math\nprint(0 ** -math.inf == math.inf, 0.0 ** -math.inf == math.inf, False ** -math.inf == math.inf)', 0, ['True True True'], '["true true true"]（4a23b63 は divZero）'],
]);
// I-2 (4) and／or は被演算子の値を返す。py の真偽は 1 つの規則（評価器の Interp.tr＝python3 と同じく空の list／tuple／dict も偽・H1＝A・BK-14）で、
//   if・elif・while・not・三項・and・or・bool() の全部が同じ判定（値を変数・関数の戻り値に通しても条件に直接書いても同じ分岐）。是正前（850bbb2）は
//   `0 and 1` が false（表示 false）・`[] or 0` が []・空の list／dict が真（`if []:` が本体を走らせ・`while q:` が空になってもステップ上限まで回った）。
//   空の容器以外の真偽は是正前と同じ（下の 11 値の表で是正前と違うのは [] と {} の 2 値だけ）。
gVals('I-2', [
  ['0 and 1（probe の (4)）', 'print(0 and 1)', 0, ['0'], '["false"]'],
  ['"" or "x"', 'print("" or "x")', 0, ['x'], '同じ'],
  ['[] or 0', 'print([] or 0)', 0, ['0'], '[""]（[] は真）'],
  ['{} or 5・len([] and 1)・[0] or 1', 'print({} or 5, len([] and 1), len([0] or 1))', 0, ['5 0 1'], 'len(1) のエラー（[] は真）'],
  ['1 and 2・5 and None・None or 5・0 or ""', 'print(1 and 2, 5 and None, None or 5, 0 or "")', 0, ['2 None 5 '], '["2 0 5 "]'],
  ['1 and 0 or 3・not 0 and 2', 'print(1 and 0 or 3, not 0 and 2)', 0, ['3 2'], '["3 2"]'],
  ['x = 0 and f()（短絡・f を呼ばない）', 'def f():\n    print("called")\n    return 1\nx = 0 and f()\nprint(x)', 0, ['0'], '["false"]'],
  ['x = [] or 0 の後の if x:（値の文脈の or）', 'x = [] or 0\nif x:\n    print("run")\nelse:\n    print("skip")', 0, ['skip'], '["run"]'],
  ['if x and y:（真偽の判定は従来どおり）', 'x = 2\ny = 0\nif x and y:\n    print("a")\nelif x or y:\n    print("b")', 0, ['b'], '同じ'],
  // 空の q の条件の and（`q and …` の値 [] は偽＝空の q で本体を走らせない＝是正前と同じ分岐）。
  ['空の q の if q and q[0] == 1:', 'q = []\nif q and q[0] == 1:\n    print("run")\nelse:\n    print("skip")', 0, ['skip'], '同じ'],
  ['while q and q[0] > 0:（空になったら止まる）', 'q = [3, 2, 0, 5]\nn = 0\nwhile q and q[0] > 0:\n    q.pop(0)\n    n += 1\nprint(n, len(q))\nr = [1]\nwhile r and r[0] > 0:\n    r.pop()\nprint(len(r))', 0, ['2 2', '0'], '同じ'],
  ['not (q and q[0])・q and q[0] の三項（空の q）', 'q = []\nprint(not (q and q[0]), "a" if q and q[0] else "b")', 0, ['True b'], '["true b"]'],
]);
gVals('I-2', [
  ['if v: の 11 値（0・1・""・"a"・None・[]・[0]・{}・{"k": 1}・0.0・(1, 2)）の真の数', 'n = 0\nfor v in [0, 1, "", "a", None, [], [0], {}, {"k": 1}, 0.0, (1, 2)]:\n    if v:\n        n += 1\nprint(n)', 0, ['5'], '["7"]（[] と {} が真）'],
  ['if []:（本体を飛ばす）・elif {}:・else', 'if []:\n    print("run")\nelif {}:\n    print("elif")\nelse:\n    print("skip")', 0, ['skip'], '["run"]'],
  ['not []・bool([])・bool([0])・bool({})・bool()・bool(None)', 'print(not [], bool([]), bool([0]), bool({}), bool(), bool(None))', 0, ['True False True False False False'], '["false true true true false false"]'],
  ['三項 "a" if [] else "b"・not ([] or 0)・条件に直接書いた if [] or 0:', 'print("a" if [] else "b", not ([] or 0))\nif [] or 0:\n    print("run")', 0, ['b True'], '["a false","run"]'],
  ['q = [1, 2, 3]・while q: q.pop()（3 回で止まる）', 'q = [1, 2, 3]\nn = 0\nwhile q:\n    q.pop()\n    n += 1\nprint(n)', 0, ['3'], 'interp.err.stepLimit（空になっても止まらない）'],
  ['{} or 5・[] or 0・len([] and 1)・x = q or [0]（空の q）', 'q = []\nx = q or [0]\nprint({} or 5, [] or 0, len([] and 1), x[0], len(x))', 0, ['5 0 0 0 1'], 'len(1) のエラー（[] は真）'],
  // BK-12 F1 の回帰（cfd9a5e＝条件だけ是正前の truthy・and／or の値だけ pyTruthy の木では赤＝and／or が返した空の list を if が真と見た）。
  ['BK-12 F1 def f(q): return q and q[0]・空の q で if f(q):', 'def f(q):\n    return q and q[0]\nq = []\nif f(q):\n    print("run")\nelse:\n    print("skip")', 0, ['skip'], '同じ（cfd9a5e は ["run"]）'],
  ['BK-12 F1 ok = q and q[0] > 0 の後の if ok:（空の q）', 'q = []\nok = q and q[0] > 0\nif ok:\n    print("run")\nelse:\n    print("skip")', 0, ['skip'], '同じ（cfd9a5e は ["run"]）'],
  ['BK-12 F1 bool(q and q[0])（空の q）', 'q = []\nprint(bool(q and q[0]))', 0, ['False'], '["false"]（cfd9a5e は ["True"]）'],
  ['BK-12 F1 q = [1, 2]・def t(): return q and q[0] > 0・while t(): q.pop()（2 回で止まる）', 'q = [1, 2]\ndef t():\n    return q and q[0] > 0\nn = 0\nwhile t():\n    q.pop()\n    n += 1\nprint(n)', 0, ['2'], '同じ（cfd9a5e は interp.err.stepLimit）'],
  ['BK-12 F1 Model A の near(q)（return q and q[0] < 100・空の q で go・1 tick）', 'q = []\ndef near(q):\n    return q and q[0] < 100\ndef loop():\n    if near(q):\n        print("brake")\n    else:\n        print("go")', 1, ['go'], '同じ（cfd9a5e は ["brake"]）'],
]);
{ // 11 値の if v: の真偽の並び（1＝真）。是正前（850bbb2・定数）と違う位置は [] と {} の 2 つだけ＝空の容器以外の真偽は不変。
  const VALS = '[0, 1, "", "a", None, [], [0], {}, {"k": 1}, 0.0, (1, 2)]';
  const code = `s = ""\nfor v in ${VALS}:\n    if v:\n        s += "1"\n    else:\n        s += "0"\nprint(s)`;
  const PRE = '01010111101';   // 850bbb2 の木（--root）で採った値
  const r = run(code, 'py');
  const got = !r.err && r.out.length === 1 ? r.out[0] : null;
  const diff = got && got.length === PRE.length ? [...got].map((c, i) => (c !== PRE[i] ? i : -1)).filter((i) => i >= 0) : null;
  ok(got === '01010010101' && J(diff) === J([5, 7]), `I-2 11 値の if v: の並び → ${r.err ? 'ERR ' + r.err : J(got)}（期待 "01010010101"・是正前 "${PRE}" と違う位置 ${J(diff)}＝[5,7]（[] と {}）だけ）`);
  checkPy3('I-2 11 値の if v: の並び', code, ['01010010101']);
}
{ // 条件の真偽と値の真偽の同値性（基準 (4) 共通）: 式 E ごとに 7 経路（if E:・x = E⏎if x:・def f(): return E⏎if f():・bool(E)・not not E・
  //   "a" if E else "b"・while E:（本体で break））と elif E: の分岐が全部一致し、python3 3.14.4 の実測（下の表の真偽）と同じ。q は [] と [3] の両方。
  //   表の真偽は python3 の bool(E) の実測（2026-10-14）。cfd9a5e の木では値の経路（x = E・f()・bool(E)）と条件に直接書いた経路が食い違う行が赤になる。
  const TABLE = [
    // [E, q = [] のときの真偽, q = [3] のときの真偽]
    ['[] or 0', 0, 0], ['[] and 1', 0, 0], ['{} or {}', 0, 0], ['[0] or 1', 1, 1], ['1 and []', 0, 0], ['None or []', 0, 0],
    ['"" and 1', 0, 0], ['not []', 1, 1], ['q and q[0]', 0, 1], ['q and q[0] > 0', 0, 1], ['q or [0]', 1, 1], ['q', 0, 1],
    ['not q', 1, 0], ['{} or 5', 1, 1], ['q and [q[0]]', 0, 1], ['(1, 2) and []', 0, 0], ['{"k": 1} and q', 0, 1], ['[[]]', 1, 1],
    ['q and q[0] > 5 or []', 0, 0], ['len(q) > 0 and q', 0, 1],
  ];
  const prog = (e, qv) => `q = ${qv}\ndef f():\n    return (${e})\np1 = "F"\nif (${e}):\n    p1 = "T"\nx = (${e})\np2 = "F"\nif x:\n    p2 = "T"\n` +
    `p3 = "F"\nif f():\n    p3 = "T"\np4 = bool(${e})\np5 = not not (${e})\np6 = "a" if (${e}) else "b"\np7 = "F"\nwhile (${e}):\n    p7 = "T"\n    break\n` +
    `p8 = "F"\nif 0:\n    p8 = "?"\nelif (${e}):\n    p8 = "T"\nprint(p1, p2, p3, p4, p5, p6, p7, p8)`;
  const line = (t) => (t ? 'T T T True True a T T' : 'F F F False False b F F');
  let n = 0;
  for (const [e, tEmpty, tOne] of TABLE) {
    for (const [qv, t] of [['[]', tEmpty], ['[3]', tOne]]) {
      const code = prog(e, qv);
      const r = run(code, 'py');
      ok(!r.err && J(r.out) === J([line(t)]), `I-2 同値性 E = ${e}（q = ${qv}）→ ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 8 経路とも ${t ? '真' : '偽'}＝${J(line(t))}）`);
      checkPy3(`I-2 同値性 E = ${e}（q = ${qv}）`, code, [line(t)]);
      n++;
    }
  }
  ok(TABLE.length >= 15 && n === TABLE.length * 2, `I-2 同値性の表は ${TABLE.length} 式 × q 2 通り＝${n} 本（基準: 15 式以上・q は [] と [3]）`);
}
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
  // 層4 F4: C の `"%s" % true` も "true" のまま。
  const r = run('void setup() {\n  int a[2] = {1, 2};\n  int b[2] = {1, 2};\n  print(true); print(false); Serial.println(true);\n  print(0 && 5); print(2 && 5); print(0 || 7);\n  print(1 / false); print(a == b); print("%s" % true);\n  if (0 && 1) print(1); else print(2);\n}\nvoid loop() {}', 'c');
  const want = ['true', 'false', 'true', 'false', '5', '7', 'Infinity', 'false', 'true', '2'];
  ok(!r.err && J(r.out) === J(want), `I-3 C は従来どおり → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ${J(want)}＝是正前と同じ）`);
  // 層4 F7: py の Serial.print／println も print と同じ表示（python3 に Serial は無い＝定数だけで判定）。
  const s = run('Serial.println(True, None)\nSerial.print(False)\nSerial.println(1, "a")', 'py');
  ok(!s.err && J(s.out) === J(['True None', 'False', '1 a']), `I-3 py の Serial.println(True, None)・Serial.print(False) → ${s.err ? 'ERR ' + s.err : J(s.out)}（期待 ["True None","False","1 a"]・是正前 ["true 0","false","1 a"]・4a23b63 ["true ","false","1 a"]）`);
}
// I-4 (6) list／tuple の ==／!= は要素ごと（入れ子・長さ違い・要素の型違い）。`in` も同じ規則。`is` は未対応のまま（構文エラー）。
//   層4 F2: list と tuple は等しくない（python3 と同じ。tuple は評価器の TUPLES の印・dict.items() の組も tuple）。残る差: dict の == は同一性のまま。
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
  ['(1, 2) == [1, 2]・[1, 2] in [(1, 2)]・(1, 2) != [1, 2]・[[1, 2]] == [(1, 2)]（層4 F2）', 'print((1, 2) == [1, 2], [1, 2] in [(1, 2)], (1, 2) != [1, 2], [[1, 2]] == [(1, 2)], [(1, 2)] == [(1, 2)])', 0, ['False False True False True'], '["false false true false false"]（同一性）・4a23b63 は ["True True False True True"]'],
  ['dict.items() の組は tuple・return a, b は tuple・list(t) は list（層4 F2）', 'd = {"a": 1}\nfor p in d.items():\n    print(p == ("a", 1), p == ["a", 1])\ndef f():\n    return 1, 2\nprint(f() == (1, 2), f() == [1, 2], list((1, 2)) == [1, 2], [1, 2].count((1, 2)))', 0, ['True False', 'True False True 0'], '["false false","false false false 0"]'],
  ['同じ list（a = b）', 'a = [1]\nb = a\nprint(a == b, a != b)', 0, ['True False'], '["true false"]'],
  ['if x == [1, 2]:', 'x = [1, 2]\nif x == [1, 2]:\n    print("eq")\nelse:\n    print("ne")', 0, ['eq'], '["ne"]'],
]);
{ // 自分自身を要素に持つ別々の list 同士は、比べている途中の同じ組に戻ったら等しいとみなす（python3 は RecursionError＝未是正の差。組を覚えないと
  //   JS の呼び出しスタックが尽き、トップレベルでは RangeError が素のまま出る）。
  const r = run('a = [1]\na.append(a)\nb = [1]\nb.append(b)\nc = [2]\nc.append(c)\nprint(a == b, a == c, a == a)', 'py');
  ok(!r.err && J(r.out) === J(['True False True']), `I-4 自分自身を要素に持つ list の == → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ["True False True"]・RangeError を出さない・是正前 ["false false true"]）`);
}
{ // 層4 F5: 入れ子 30000 段の list の ==・!=・in・count・index は明示のスタックで比べる（JS の RangeError を出さない・関数の中でも recursion に
  //   しない。python3 3.14.4 も True）。4a23b63 はトップレベルで RangeError「Maximum call stack size exceeded」・関数の中で interp.err.recursion。
  const deep = 'a = []\nb = []\nfor i in range(30000):\n    a = [a]\n    b = [b]\n';
  gVals('I-4', [
    ['入れ子 30000 段の ==・!=・in・count・index（層4 F5）', deep + 'print(a == b, a != b, a in [b], [a].count(b), [a].index(b))', 0, ['True False True 1 0'], '["false true false 0 -1"]（同一性）'],
    ['関数の中の入れ子 30000 段の ==（層4 F5）', deep + 'def f():\n    return a == b\nc = [b]\nprint(f(), a == c)', 0, ['True False'], '["false false"]'],
  ]);
}
{ // 残る差（BK-12 low ②・§9 (6)）: list の要素の比較は Object.is または pyEq（pySame）＝NaN の要素は自分と等しい・dict.items() の値は list で
  //   list と == で比べられる。行は [ラベル, 本文, 本処理系の値, python3 の値]。python3 がある環境では python3 の値も突き合わせる（差が実在すること）。
  const KEEP = [
    ['[float("nan")] == [float("nan")]・!=', 'print([float("nan")] == [float("nan")], [float("nan")] != [float("nan")])', ['True False'], ['False True']],
    ['d.items() == [("a", 1)]・list(d.items()) == [("a", 1)]', 'd = {"a": 1}\nprint(d.items() == [("a", 1)], list(d.items()) == [("a", 1)])', ['True True'], ['False True']],
  ];
  for (const [label, code, want, py3want] of KEEP) {
    const r = run(code, 'py');
    ok(!r.err && J(r.out) === J(want), `I-4 残る差 ${label} → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ${J(want)}・python3 は ${J(py3want)}）`);
    checkPy3(`I-4 残る差 ${label}（python3 側の値）`, code, py3want);
  }
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
// 残る差（BK-12 low ③・§9 (17)）: 範囲外の添字の値（v10.2.0 から黙って値の無いもの）を range に渡すと rangeArg「None は使えません」（python3 は
//   添字の時点で IndexError）。
gErrs('I-7', [
  ['y = [1, 2]⏎for i in range(y[3]):（残る差・python3 は IndexError）', 'y = [1, 2]\nfor i in range(y[3]):\n    pass', 'interp.err.rangeArg', 2, { type: 'None' }, null, '0 回（黙って空）'],
]);
checkPy3Err('I-7 残る差 range(y[3])（python3 側）', 'y = [1, 2]\nfor i in range(y[3]):\n    pass', /^IndexError: list index out of range/);
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
  // 層4 F9: `%` の数の指定子（d i f x X）に None は noneOp（python3 は TypeError）。`%s` は None（下の gVals）。
  ['"%d" % None（2 行目・層4 F9）', 'x = None\nprint("%d" % x)', 'interp.err.noneOp', 2, { op: '%' }, /^TypeError: %d format: a real number is required, not NoneType/, '["0"]'],
  ['"%.1f" % None（層4 F9）', 'print("%.1f" % None)', 'interp.err.noneOp', 1, { op: '%' }, /^TypeError: must be real number, not NoneType/, '["0.0"]'],
  ['"%s %x" % ("a", None)（層4 F9）', 'print("%s %x" % ("a", None))', 'interp.err.noneOp', 1, { op: '%' }, /^TypeError: %x format: an integer is required, not NoneType/, '["a 0"]'],
  // 層4 F7: list／str の添字の None は noneAsIndex（python3 は TypeError）。4a23b63 は黙って空（JS のキー "null"）・是正前は数の 0（先頭の要素）。
  ['[1, 2][None]（2 行目・層4 F7）', 'x = [1, 2]\nprint(x[None])', 'interp.err.noneAsIndex', 2, {}, /^TypeError: list indices must be integers or slices, not NoneType/, '["1"]'],
  ['x[None] = 5（list の代入先・層4 F7）', 'x = [1, 2]\nx[None] = 5', 'interp.err.noneAsIndex', 2, {}, /^TypeError: list indices must be integers or slices, not NoneType/, 'x[0] が 5'],
  ['"ab"[None]（層4 F7）', 'print("ab"[None])', 'interp.err.noneAsIndex', 1, {}, /^TypeError: string indices must be integers, not 'NoneType'/, '["a"]'],
]);
gVals('I-8', [
  ['None == 0・None == None・None != 0・None in [None]・"%s" % None', 'print(None == 0, None == None, None != 0, None in [None], "%s" % None)', 0, ['False True True True None'], '["true true false true 0"]'],
  ['d.get("k") == None・f() == None', 'def f():\n    pass\nd = {}\nprint(d.get("k") == None, f() == None)', 0, ['True True'], '["false false"]'],
  ['while None:（Model B にしない・従来どおり）', 'while None:\n    print(1)\nprint("end")', 0, ['end'], '同じ'],
  // 層4 F7: dict のキーの None は 'None'（反復・in・添字・get・pop で JS の "null" を見せない）。
  ['for k in {None: 1}・"null" in {None: 1}・None in・d[None]・get・pop（層4 F7）', 'd = {None: 1}\nfor k in d:\n    print(k)\nd[None] = 3\nprint("null" in d, None in d, d[None], d.get(None), len(d), d.pop(None), len(d))', 0, ['None', 'False True 3 3 1 3 0'], '["0","false true 3 3 1 3 0"]・4a23b63 は ["null","True True 3 3 1 3 0"]'],
  ['"%s|%d|%s" % (None, True, False)', 'print("%s|%d|%s" % (None, True, False))', 0, ['None|1|False'], '["0|1|false"]'],
]);
{ // 残る差（層4 F7 の兄弟）: py の str.join と文字列のメソッドは文字列以外の値を pyStr で文字列にして通す（python3 は TypeError）。JS の "null"・"true" は見せない。
  const r = run('print("a".join(["x", None]), "-".join(["x", True]), "anullb".replace(None, "x"), "null".find(None), "aNoneb".replace(None, "-"))', 'py');
  ok(!r.err && J(r.out) === J(['xaNone x-True anullb -1 a-b']), `I-8 残る差 join・replace・find に None／True → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ["xaNone x-True anullb -1 a-b"]・4a23b63 ["xanull x-true axb 0 aNoneb"]・python3 は TypeError）`);
  checkPy3Err('I-8 残る差 "a".join(["x", None])（python3 側）', 'print("a".join(["x", None]))', /^TypeError: sequence item 1: expected str instance, NoneType found/);
  // 層4 F8: 実機 API に None は引数エラー（RC_read は -2・RC_drive／RC_steer は 0 を返して何もしない）。是正前は None が数の 0＝LEFT／FREE と同じ。
  //   数の組込関数（int・abs・math.*）は 0 として計算（§9 の残る差）。python3 に RC_* は無い＝定数だけで判定。
  const a = run('print(RC_read(None), RC_drive(None, 100), RC_steer(None), int(None), abs(None))', 'py');
  ok(!a.err && J(a.out) === J(['-2 0 0 0 0']), `I-8 実機 API と数の組込関数に None（層4 F8）→ ${a.err ? 'ERR ' + a.err : J(a.out)}（期待 ["-2 0 0 0 0"]・是正前は RC_read(None) が RC_read(LEFT) と同じ・RC_drive(None, 100) が 1）`);
}

// ── J) BK5 C 定石（static・キャスト・数値接尾辞・カンマ演算子と for の複数の宣言子・%=・閉じていない /*）──────────────────────────
console.log('\nJ) BK5 C 定石（static・キャスト・数値接尾辞・for のカンマ・%=・閉じていない /*）— 是正前（8ecdfd9）の値は各表の最後の列');
// 値の行: [ラベル, 関数・グローバルの宣言, setup() の本体, tick 数, 期待の出力（gcc で同じ本文を実測した値・checkGcc で突き合わせ）, 是正前（8ecdfd9）の結果]。
//   本処理系の本文は `<宣言>⏎void setup(){<本体>}⏎void loop(){…}`。gcc には `#include <stdio.h>`・`<stdint.h>` と `#define print(x) printf("%g\n", (double)(x))` を前に、
//   setup() と loop() を tick 数だけ呼ぶ main を後ろに足して同じ本文を渡す（期待値は実機 C の値で、python3 ではない）。表の値は数だけ
//   （bool の表示 true／false は本処理系の C の print の従来の表示で gcc と違う＝真偽の行は gcc に渡さない）。
const GCC = (() => {
  const r = spawnSync('gcc', ['--version'], { encoding: 'utf8', timeout: 20000 });
  return r.error || r.status !== 0 ? null : r.stdout.split('\n')[0];
})();
let gccChecked = 0;
const cProg = (decl, body, loopBody = '') => `${decl}\nvoid setup(){${body}}\nvoid loop(){${loopBody}}`;
// gcc（任意）: 同じ本文をコンパイルして走らせ、出力の行（またはコンパイルエラーの最初の error 行）を返す。一時ディレクトリは自分で作って消す。
// BK5 層4 F1: cxx＝真なら g++（-std=gnu++17・C++ の関数形式の型変換 `int(x)` を確かめる行だけ）。
function gccRun(prog, ticks, cxx = false) {
  const dir = mkdtempSync(join(tmpdir(), 'wf_bk5_'));
  try {
    const exe = join(dir, 'a.out');
    const full = '#include <stdio.h>\n#include <stdint.h>\n#define print(x) printf("%g\\n", (double)(x))\n' + prog +
      `\nint main(void){ setup(); for (int t_ = 0; t_ < ${ticks}; t_++) loop(); return 0; }\n`;
    const c = cxx ? spawnSync('g++', ['-std=gnu++17', '-w', '-x', 'c++', '-', '-o', exe], { input: full, encoding: 'utf8', timeout: 60000 })
      : spawnSync('gcc', ['-std=c11', '-w', '-x', 'c', '-', '-o', exe], { input: full, encoding: 'utf8', timeout: 60000 });
    if (c.error || c.status !== 0) return { err: (c.error && c.error.message) || (c.stderr.split('\n').find((l) => /error/.test(l)) || c.stderr.trim()) };
    const x = spawnSync(exe, [], { encoding: 'utf8', timeout: 20000 });
    if (x.error || x.status !== 0) return { err: (x.error && x.error.message) || 'exit ' + x.status };
    return { out: x.stdout.replace(/\n$/, '').split('\n').filter((l, k, a) => !(a.length === 1 && l === '')) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function checkGcc(label, prog, ticks, want, cxx = false) {
  if (!GCC) return;
  const r = gccRun(prog, ticks, cxx); gccChecked++;
  ok(!r.err && J(r.out) === J(want), `${label}: ${cxx ? 'g++' : 'gcc'} の出力 ${r.err ? 'ERR ' + r.err : J(r.out)} ＝ 定数 ${J(want)}`);
}
function checkGccErr(label, prog, re) {
  if (!GCC) return;
  const r = gccRun(prog, 0); gccChecked++;
  ok(!!r.err && re.test(r.err), `${label}: gcc も ${re} で止まる（実 ${r.err ? r.err : 'エラーなし ' + J(r.out)}）`);
}
console.log(`  gcc: ${GCC ? GCC + '（定数と同じ本文の実行結果を突き合わせる）' : '不在（定数＝2026-10-14 の gcc の実測で判定）'}`);
function jVals(tag, rows) {
  for (const [label, decl, body, ticks, want, pre] of rows) {
    const prog = cProg(decl, body, ticks ? 'tick1();' : '');
    const r = run(prog, 'c', ticks);
    ok(!r.err && J(r.out) === J(want), `${tag} ${label} → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ${J(want)}・是正前 ${pre}）`);
    checkGcc(`${tag} ${label}`, prog, ticks, want);
  }
}
// J-1 static: 関数の中の static は最初の 1 回だけ初期化して値を保つ（宣言の節ごと＝同じ名前でも関数が違えば別・再帰でも 1 つ）。static の無い
//   ローカルは従来どおり毎回初期化。是正前は static を読み飛ばして毎回初期化（probe の `f(); f(); print(f());` が 1）。
jVals('J-1', [
  ['static int n = 0（probe）', 'int f(){ static int n = 0; n = n + 1; return n; }', 'f(); f(); print(f());', 0, ['3'], '["1"]'],
  ['static の無いローカルは毎回初期化（従来どおり）', 'int f(){ int n = 0; n = n + 1; return n; }', 'f(); f(); print(f());', 0, ['1'], '同じ'],
  ['2 つの関数の同名の static は独立', 'int f(){ static int n = 0; n++; return n; }\nint g(){ static int n = 10; n++; return n; }', 'f(); f(); g(); print(f()); print(g());', 0, ['3', '12'], '["1","11"]'],
  ['配列の static も保持', 'int f(){ static int a[2]; a[0] = a[0] + 1; return a[0]; }', 'f(); f(); print(f());', 0, ['3'], '["1"]'],
  ['初期化子の無い static は 0 から', 'int f(){ static int n; n += 2; return n; }', 'f(); print(f());', 0, ['4'], '["2"]'],
  ['static int a = 1, b = 5（宣言子ごと）', 'int f(){ static int a = 1, b = 5; a++; b--; return a * 10 + b; }', 'f(); print(f());', 0, ['33'], '["24"]'],
  ['再帰の中の static は 1 つ', 'int f(int k){ static int c = 0; c++; if (k > 0) f(k - 1); return c; }', 'print(f(3)); print(f(0));', 0, ['4', '5'], '["1","1"]'],
  ['ファイルの static（グローバル・従来どおり）', 'static int g = 3;\nint f(){ g++; return g; }', 'f(); print(f());', 0, ['5'], '同じ'],
  ['loop() から呼ぶ関数の static unsigned long（3 tick）', 'void tick1(){ static unsigned long cnt = 0; cnt++; print(cnt); }', '', 3, ['1', '2', '3'], '["1","1","1"]'],
]);
{ // static の値は Interp ごと（buildController ごと＝車ごと）。同じ本文の 2 つ目の controller は 1 から数え直す。
  const prog = cProg('int f(){ static int n = 0; n++; return n; }', 'print(f()); print(f());');
  const a = run(prog, 'c'), b = run(prog, 'c');
  ok(!a.err && !b.err && J(a.out) === J(['1', '2']) && J(b.out) === J(['1', '2']), `J-1 static の記憶域は controller ごと → ${J(a.out)}・${J(b.out)}（期待 ["1","2"] が 2 回）`);
}
// J-2 キャスト `(型名)式`: 整数型は 0 方向への切り捨て・float／double は数・(bool) は C の真偽・型の幅は持たない（§9 の残る差）。`(x)` の括弧式は不変。
//   是正前は `(int)x` が「';' を期待しましたが 'x'」・`(int)3.7` が「')' を期待しましたが '3.7'」。
jVals('J-2', [
  ['(int)x（probe）', '', 'float x = 3.7; int y = (int)x; print(y);', 0, ['3'], '構文エラー「\';\' を期待しましたが \'x\'」'],
  ['(int)3.7・(int)-3.7・(float)7/2・(long)3.99・(double)7/2・(unsigned long)5.9・(char)65.2', '', 'print((int)3.7); print((int)-3.7); print((float)7/2); print((long)3.99); print((double)7/2); print((unsigned long)5.9); print((char)65.2);', 0,
    ['3', '-3', '3.5', '3', '3.5', '5', '65'], '構文エラー'],
  ['(x) の括弧式・(int)x * 2・(int)(x * 2)・(unsigned int)0.5・(short)-0.5', '', 'float x = 3.7; print((x)); print((int)x * 2); print((int)(x * 2)); print((unsigned int)0.5); print((short)-0.5);', 0, ['3.7', '6', '7', '0', '0'], '構文エラー'],
  ['#define の型名のキャスト・(const int)・(uint8_t)', '#define T int', 'print((T)2.9); print((const int)-1.5); print((uint8_t)7.9);', 0, ['2', '-1', '7'], '構文エラー'],
]);
{ // (bool) は C の真偽（true／false）。bool の表示は本処理系の C の print の従来の表示（gcc に渡さない）。
  const r = run(cProg('', 'print((bool)2); print((bool)0); print((boolean)0.5);'), 'c');
  ok(!r.err && J(r.out) === J(['true', 'false', 'true']), `J-2 (bool)・(boolean) → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ["true","false","true"]）`);
}
// (void) は文として値を捨てる定石（BK5 層4 F5: 0fbea4d は gcc がエラーにする `print((void)v + 1)` の 5 を期待値にしていた＝gcc で裏の取れる書き方に差し替え）。
jVals('J-2', [
  ['(void)v;・(void)(v = v + 1);（文として捨てる）', '', 'int v = 4; (void)v; (void)(v = v + 1); print(v);', 0, ['5'], '構文エラー'],
]);
// J-3 数値接尾辞（読み飛ばす）。是正前は「';' を期待しましたが 'f'」「…が 'UL'」の構文エラー。整数の f と英数字の続く接尾辞は従来どおり構文エラー（gcc も invalid suffix）。
jVals('J-3', [
  ['1.0f（probe）・10UL（probe）', '', 'float x = 1.0f; print(x); unsigned long y = 10UL; print(y);', 0, ['1', '10'], '構文エラー'],
  ['1.5F・10L・10u・0x1Fu・1e3f・10ULL・10LU・.5f・2.5L・0XffUL', '', 'print(1.5F); print(10L); print(10u); print(0x1Fu); print(1e3f); print(10ULL); print(10LU); print(.5f); print(2.5L); print(0XffUL);', 0,
    ['1.5', '10', '10', '31', '1000', '10', '10', '0.5', '2.5', '255'], '構文エラー'],
]);
// J-4 カンマ演算子（for の初期化部・更新部と式の文）と for の初期化部の複数の宣言子。値は実機 C（gcc）と同じ（s＝3・j＝6）。
jVals('J-4', [
  ['for (i = 0, j = 0; i < 3; i++, j += 2)', '', 'int s = 0; int i; int j; for (i = 0, j = 0; i < 3; i++, j += 2) s++; print(s); print(j);', 0, ['3', '6'], '構文エラー「\';\' を期待しましたが \',\'」'],
  ['for (int i = 0, j = 0; i < 3; i++, j += 2)（probe）', '', 'int t = 0; for (int i = 0, j = 0; i < 3; i++, j += 2) t = t + j; print(t);', 0, ['6'], '構文エラー「\';\' を期待しましたが \',\'」'],
  ['int a = 1, b = 2;（従来どおり）', '', 'int a = 1, b = 2; print(a + b);', 0, ['3'], '同じ'],
  ['式の文 a = 1, b = a + 1;・x = (a, b);・関数の引数のカンマは区切り', 'int add(int p, int q){ return p * 10 + q; }', 'int a; int b; int x; a = 1, b = a + 1; x = (a, b); print(x); print(add(a, b));', 0, ['2', '12'], '構文エラー'],
]);
{ // for の宣言はブロックスコープ（従来どおり）: for の後ろで i・j は未定義。
  const r = run(cProg('', 'for (int i = 0, j = 0; i < 1; i++) {}\n  print(j);'), 'c');
  ok(r.key === 'interp.err.undefName' && r.line === 3, `J-4 for (int i = 0, j = 0; …) の後ろの j は未定義（実 ${r.key || J(r.out)}・行 ${r.line}）`);
}
// J-5 `%=`（C の % は切り捨て剰余のまま・除数 0 は divZero）。是正前は「';' を期待しましたが '%='」。
jVals('J-5', [
  ['a = 7; a %= 2（probe）・-7 %= 2・7 %= -3・a[1] %= 4', '', 'int a = 7; a %= 2; print(a); int b = -7; b %= 2; print(b); int c = 7; c %= -3; print(c); int d[2] = {1, 10}; d[1] %= 4; print(d[1]);', 0,
    ['1', '-1', '1', '2'], '構文エラー「\';\' を期待しましたが \'%=\'」'],
]);
{
  const r = run(cProg('', '\n  int a = 7;\n  a %= 0;'), 'c');
  ok(r.key === 'interp.err.divZero' && r.line === 4, `J-5 a %= 0 → interp.err.divZero（行 4）（実 ${r.key || J(r.out)}・行 ${r.line}）`);
}
// J-6 (27) 閉じていない `/*` は字句エラー interp.lex.blockComment（行＝`/*` の行・文言は A 章）。是正前は末尾まで黙ってコメント（setup()／loop() が消える）。
{
  const ERR = [
    ['/* oops（probe・1 行目）', '/* oops\n' + cProg('', 'print(1);'), 1],
    ['3 行目の /*（途中の改行を数える）', 'int a;\n\n/* oops\n' + cProg('', 'print(1);'), 3],
    ['/*/ は閉じない', cProg('', 'print(1); /*/ print(2);'), 2],
    ['末尾の * だけ', cProg('', 'print(1);') + '\n/* x *', 4],
  ];
  for (const [label, code, line] of ERR) {
    const { ja, en } = runBoth(code, 'c');
    const wantJa = msgJa('interp.lex.head') + msgJa('interp.lex.blockComment') + ` (行 ${line})`;
    const wantEn = msgEn('interp.lex.head') + msgEn('interp.lex.blockComment') + ` (line ${line})`;
    ok(ja.key === 'interp.lex.blockComment' && ja.line === line && ja.err === wantJa && en.err === wantEn && !JP_RE.test(en.err || ''),
      `J-6 ${label} → ${ja.key || J(ja.out)}・行 ${ja.line}（期待 interp.lex.blockComment・行 ${line}・ja/en の文言・是正前はエラー無し）`);
  }
  checkGccErr('J-6 /* oops', '/* oops\n' + cProg('', 'print(1);'), /unterminated comment/);
}
jVals('J-6', [
  ['閉じた /* … */（複数行・行の途中）と // は不変', '/* a\n b */ int z = 2; // c', 'print(z); /* x */ print(3); /*/ */ print(4);', 0, ['2', '3', '4'], '同じ'],
]);
// J-7 構文エラーのまま（gcc もエラー）: 整数の f 接尾辞・英数字の続く接尾辞。文言と行は是正前と同じ。
{
  const BAD = [['10f（整数の f）', 'print(10f);', "')' を期待しましたが 'f'", /invalid suffix "f"|invalid suffix ‘f’/], ['10ux', 'print(10ux);', "')' を期待しましたが 'ux'", /invalid suffix "ux"|invalid suffix ‘ux’/]];
  for (const [label, body, want, re] of BAD) {
    const r = run(cProg('', body), 'c');
    ok(r.key === 'interp.syn.expected' && r.line === 2 && r.err === `構文エラー(C): ${want} (行 2)`, `J-7 ${label} → ${J(r.err)}（期待 構文エラー(C): ${want} (行 2)・是正前と同じ）`);
    checkGccErr(`J-7 ${label}`, cProg('', body), re);
  }
}
// J-8 C の真偽は不変（BK-15 F3・BK-16）: `!`・三項・for・do-while・while の条件の真偽は truthy（0・false・""・null が偽）。期待値は是正前の
//   2 つの木（850bbb2〔BK4 の前〕・8ecdfd9〔BK4 fix〕）で採った出力（両者で同一）。`!""` が true・`"" ? 1 : 2` が 2 なのは本処理系の従来の
//   C の文字列の真偽（実機 C の文字列リテラルはヌルでないポインタ＝真）。
{
  const prog = 'void setup() {\n  int a[2] = {0, 0};\n  print(!0); print(!1); print(!-1); print(!0.5); print(!""); print(!"a"); print(!true); print(!false); print(!a);\n' +
    '  print(0 ? 1 : 2); print(-1 ? 1 : 2); print(0.5 ? 1 : 2); print("" ? 1 : 2); print("a" ? 1 : 2); print(false ? 1 : 2); print(a ? 1 : 2);\n' +
    '  int n = 0; for (int k = 3; k; k--) n++; print(n);\n  int q = 0; for (; q - 2; q++) {} print(q);\n  int m = 0; do { m++; } while (m - 3); print(m);\n' +
    '  float f = 0.0; int d = 0; do { d++; f = f + 0.25; } while (f - 1.0); print(d);\n  int e = 0; do { e++; } while (0); print(e);\n  int w = 5; while (w) w--; print(w);\n}\nvoid loop() {}';
  const want = ['true', 'false', 'false', 'false', 'true', 'false', 'false', 'true', 'false', '2', '1', '1', '2', '1', '2', '1', '3', '2', '3', '4', '1', '0'];
  const r = run(prog, 'c');
  ok(!r.err && J(r.out) === J(want), `J-8 C の ! ・三項・for・do-while・while の真偽 → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ${J(want)}＝850bbb2・8ecdfd9 と同じ）`);
}
// J-9 BK5 層4 是正（0fbea4d の後退と端）。期待値は gcc／g++ の実測（checkGcc）と python3（checkPy3）。最後の列は 0fbea4d（BK5 の初回）の結果。
//   F1 括弧の中が関数形式の型変換（C++ の `int(x)`）で始まる式は括弧式（`)` で閉じるかを先読みしてからキャストと決める）＝8ecdfd9 と同じ値。
//   F2 char（この処理系では 1 文字の文字列）のキャストは文字コード（gcc と同じ）。`(char)'A'` は文字のまま（print は "A"）。
//   F3 隣のブロックの同じ名前の static でない宣言は static の記憶域を書き換えない（ブロックがスコープを作らないこと自体は §9 の残る差）。
//   F4 case の値・配列の次元はカンマ演算子を受けない（gcc と同じく構文エラー＝8ecdfd9 と同じ）・三項の `?` と `:` の間は受ける（gcc と同じ 3）。
//   F6 複合代入と ++／-- は左辺の場所を 1 回だけ評価する（C は gcc・py は python3 と同じ）。
function jVals9(rows) {
  for (const [label, decl, body, want, pre, cxx] of rows) {
    const prog = cProg(decl, body);
    const r = run(prog, 'c');
    ok(!r.err && J(r.out) === J(want), `J-9 ${label} → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ${J(want)}・0fbea4d ${pre}）`);
    checkGcc(`J-9 ${label}`, prog, 0, want, !!cxx);
  }
}
jVals9([
  ['F1 (int(x) + 1)・(float(7) / 2)・(bool(0))（関数形式の型変換・C++）', '', 'float x = 3.7; int y = (int(x) + 1); print(y); print((float(7) / 2)); int b = (bool(0)); print(b ? 1 : 2);', ['4', '3.5', '2'],
    '構文エラー「\')\' を期待しましたが \'(\'」（8ecdfd9 は 4・3.5・2）', true],
  ['F1 (int)(x)・((int)x)・(int*)a の添字・(unsigned)(5.5)・(x) + 1・(g)(3)', 'int g(int v){ return v * 2; }', 'float x = -3.7; print((int)(x)); print(((int)x)); int a[2] = {3, 4}; print(((int*)a)[1]); print((unsigned)(5.5)); int w = 4; print((w) + 1); print((g)(3));',
    ['-3', '-3', '4', '5', '5', '6'], '同じ'],
  ['F2 char の (int)・(float)・(long)・(unsigned char)・(int)(char)・(char)66.7', '', "char c = 'A'; print((int)c); char d = '7'; print((int)d); print((float)'A'); print((long)'z'); print((unsigned char)'B'); print((int)(char)'A'); print((char)66.7); print(d - '0');",
    ['65', '55', '65', '122', '66', '65', '66', '7'], 'NaN・7・NaN・NaN・NaN・NaN・66・7'],
  ['F2 int(c)・float(c)（関数形式・C++）', '', "char c = 'A'; print(int(c)); print(float(c) + 1);", ['65', '66'], 'NaN・NaN', true],
  // 往復 2 F2: 数字・空白の 1 文字の関数形式は v10.2.0（e65643e）と 0fbea4d で Number("7")＝7・Number(" ")＝0（エラー無しで黙って値が変わる書き方＝BK-17 ②）。
  ['F2 int(\'7\')・float(\'7\')・int(\' \')・bool(\'\\0\') ? 1 : 2・int(c) - 48・float(\' \') + 0.5（関数形式・C++）', '',
    "print(int('7')); print(float('7')); print(int(' ')); print(bool('\\0') ? 1 : 2); char c = '7'; print(int(c) - 48); print(float(' ') + 0.5);",
    ['55', '55', '32', '2', '7', '32.5'], '7・7・0・1・-41・0.5（v10.2.0〔e65643e〕も同じ）', true],
  // 往復 2 F4: sizeof( の後ろの型語の列の直後が ( なら式（関数形式の型変換）・それ以外は従来どおり型名。sizeof の値は葉要素の数（AS4・§9）なので g++ とは
  //   sizeof(int) との等しさで照合する。8ecdfd9 まで（v10.2.0 も）は「')' を期待しましたが '('」。
  ['F4 sizeof(int(x))・sizeof(int(x) + 1)・sizeof(float(2) / 2) は式（関数形式の型変換・C++）', '',
    'float x = 3.7; print(sizeof(int(x)) == sizeof(int) ? 1 : 0); print(sizeof(int(x) + 1) == sizeof(int) ? 1 : 0); print(sizeof(float(2) / 2) == sizeof(float) ? 1 : 0);',
    ['1', '1', '1'], '構文エラー「\')\' を期待しましたが \'(\'」（8ecdfd9・v10.2.0 も同じ）', true],
  ['F3 { static int n = 0; n++; print(n); } { int n = 100; } を 3 回', 'int f(){ { static int n = 0; n++; print(n); } { int n = 100; } return 0; }', 'f(); f(); f();', ['1', '2', '3'], '1・101・101'],
  ['F3 { int n = 100; } { static int n = 0; … } を 3 回（逆の順）', 'int f(){ { int n = 100; } { static int n = 0; n++; print(n); } return 0; }', 'f(); f(); f();', ['1', '2', '3'], '同じ'],
  ['F4 1 ? 2, 3 : 4（三項の ? と : の間のカンマ演算子）・0 ? 1, 2 : 4・1 ? 0, 7 : 4', '', 'int x = 1 ? 2, 3 : 4; print(x); int p = 0 ? 1, 2 : 4; print(p); int q = 1 ? 0, 7 : 4; print(q);', ['3', '4', '7'], '構文エラー「\':\' を期待しましたが \',\'」'],
  ['F4 0 ? 1 : a = 5（: の後ろは代入式＝C++・従来どおり）', '', 'int a = 0; int y = 0 ? 1 : a = 5; print(y); print(a);', ['5', '5'], '同じ', true],
  ['F6 a[i++] %= 4・a[i++] += 4・a[i++]++・++a[i++]', '', 'int a[3] = {7, 7, 7}; int i = 0; a[i++] %= 4; print(i); print(a[0]); print(a[1]); int b[3] = {7, 7, 7}; int j = 0; b[j++] += 4; print(j); print(b[0]); print(b[1]); int c[3] = {7, 7, 7}; int k = 0; c[k++]++; ++c[k++]; print(k); print(c[0]); print(c[1]);',
    ['1', '3', '7', '1', '11', '7', '2', '8', '8'], '2・7・3・2・7・11・4・7・8'],
]);
{ // F4: case の値と配列の次元のカンマは構文エラー（gcc も）。0fbea4d は `case 1, 2:` が 2 だけに一致・`int a[2, 3];` が大きさ 3。8ecdfd9 と同じ文言・行。
  const BAD = [
    ['case 1, 2:', 'switch (2) { case 1, 2: print(9); break; default: print(0); }', "':' を期待しましたが ','", /expected ‘:’ or ‘\.\.\.’ before ‘,’ token|expected ':' or '\.\.\.' before ',' token/, '9'],
    ['int a[2, 3];', 'int a[2, 3]; print(sizeof(a));', "']' を期待しましたが ','", /expected ‘\]’ before ‘,’ token|expected '\]' before ',' token/, '3'],
  ];
  for (const [label, body, want, re, pre] of BAD) {
    const r = run(cProg('', body), 'c');
    ok(r.key === 'interp.syn.expected' && r.line === 2 && r.err === `構文エラー(C): ${want} (行 2)`, `J-9 F4 ${label} → ${J(r.err || r.out)}（期待 構文エラー(C): ${want} (行 2)・0fbea4d は ${pre}）`);
    checkGccErr(`J-9 F4 ${label}`, cProg('', body), re);
  }
  const p = run('int f(int a[2, 3]){ return 0; }\nvoid setup(){}\nvoid loop(){}', 'c');
  ok(p.key === 'interp.syn.expected' && p.line === 1, `J-9 F4 配列の仮引数 int a[2, 3] → ${p.key || J(p.out)}・行 ${p.line}（期待 interp.syn.expected・行 1）`);
}
{ // F2: (char) は文字のまま（print は "A"＝Arduino の Serial.print((char)'A')）・(bool)'\0' は偽・(int)"" は 0（gcc に渡さない＝表示の違い・ポインタ）。
  const r = run(cProg('', "print((char)'A'); char c = 'B'; print((char)c); print((bool)'\\0'); print((bool)'0'); print((int)\"\");"), 'c');
  ok(!r.err && J(r.out) === J(['A', 'B', 'false', 'true', '0']), `J-9 F2 (char)'A'・(char)c・(bool)'\\0'・(bool)'0'・(int)"" → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ["A","B","false","true","0"]・0fbea4d は NaN・NaN・true・true・0）`);
}
{ // 往復 2 F2: 関数形式の bool('\0') は偽（print は "false"）・bool('0') は真（v10.2.0 と 0fbea4d は bool('\0') が true＝空でない文字列は真）。
  //   F4: 型名の sizeof は従来どおり（sizeof(int)・sizeof(int*)・sizeof(unsigned long)・sizeof x は 1＝葉要素の数）。
  const r = run(cProg('', "print(bool('\\0')); print(bool('0')); print(sizeof(int)); print(sizeof(int*)); print(sizeof(unsigned long)); float x = 1.5; print(sizeof x); print(sizeof(int) * 2);"), 'c');
  ok(!r.err && J(r.out) === J(['false', 'true', '1', '1', '1', '1', '2']), `J-9 F2 bool('\\0')・bool('0')／F4 sizeof(型名)・sizeof x・sizeof(int) * 2 → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ["false","true","1","1","1","1","2"]・v10.2.0 は bool('\\0') が true）`);
  // F4 の兄弟: sizeof(int[3]) は是正前（8ecdfd9・v10.2.0）と同じ構文エラー（式として読むと名前 int の添字になり黙って 1 を返す＝その経路を作らない）。
  const t = run(cProg('', 'print(sizeof(int[3]));'), 'c');
  ok(t.key === 'interp.syn.expected' && t.line === 2 && t.err === "構文エラー(C): ')' を期待しましたが '[' (行 2)", `J-9 F4 sizeof(int[3]) → ${J(t.err || t.out)}（期待 構文エラー(C): ')' を期待しましたが '[' (行 2)＝8ecdfd9 と同じ）`);
}
{ // §9 の残る差（現在値を固定・gcc の値は別に確かめる）: C のブロック `{ }`・if の本体はスコープを作らない＝内側の同じ名前の宣言が外側を上書きする。
  //   char は 1 文字の文字列（`c + 1` は "A1"）。`(void)v + 1` は値をそのまま（gcc は void value not ignored）。
  const DIFF = [
    ['ブロックの内側の int n = 100 が外側の n を上書き', '', 'int n = 1; { int n = 100; } print(n);', ['100'], ['1']],
    ['if の本体の int n が関数の static n を隠したまま残る', 'int f(){ static int n = 0; n++; if (1) { int n = 100; } return n; }', 'f(); print(f());', ['100'], ['2']],
    ['char c = \'A\'; c + 1', '', "char c = 'A'; print(c + 1);", ['A1'], ['66']],
  ];
  for (const [label, decl, body, want, gccWant] of DIFF) {
    const prog = cProg(decl, body);
    const r = run(prog, 'c');
    ok(!r.err && J(r.out) === J(want), `J-9 残る差 ${label} → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ${J(want)}＝§9 の残る差・gcc は ${J(gccWant)}）`);
    checkGcc(`J-9 残る差 ${label}（gcc 側）`, prog, 0, gccWant);
  }
  const v = run(cProg('', 'int v = 4; print((void)v + 1);'), 'c');
  ok(!v.err && J(v.out) === J(['5']), `J-9 残る差 (void)v + 1 → ${v.err ? 'ERR ' + v.err : J(v.out)}（期待 ["5"]＝§9 の残る差・gcc はエラー）`);
  checkGccErr('J-9 残る差 (void)v + 1（gcc 側）', cProg('', 'int v = 4; print((void)v + 1);'), /void value not ignored/);
}
{ // F6 の py: 左辺の添字の式は 1 回（python3 と同じ）。0fbea4d までは k() を 2 回呼んだ（n＝2）。
  const pySrc = 'a = [1, 2, 3]\nd = {0: 5}\nn = 0\ndef k():\n    global n\n    n += 1\n    return 0\na[k()] += 10\nd[k()] -= 1\na[-1] *= 2\nprint(n, a[0], a[1], a[2], d[0])';
  const r = run(pySrc, 'py');
  ok(!r.err && J(r.out) === J(['2 11 2 6 4']), `J-9 F6 py a[k()] += 10・d[k()] -= 1・a[-1] *= 2 → ${r.err ? 'ERR ' + r.err : J(r.out)}（期待 ["2 11 2 6 4"]・0fbea4d は ["4 11 2 6 4"]）`);
  checkPy3('J-9 F6 py（python3 側）', pySrc, ['2 11 2 6 4']);
}
// J-10 BK5 層4 往復 2 F1: 式の途中でファイルが終わる C の本文は SourceError interp.syn.unexpected「予期しないトークン 'EOF'」（行＝末尾の行・ja/en）。
//   8e49d4b はキャストの先読みが現在のトークンを確かめる前に peek(1) を読み、末尾より先（undefined）の .type で JS の TypeError「Cannot read properties
//   of undefined (reading 'type')」（行番号も i18n キーも無い・main.js はそのまま表示）。8ecdfd9 は下の全行で同じ値（緑）・0fbea4d は `(int*` の 6 行だけ
//   interp.syn.expected「')' を期待しましたが 'EOF'」（`)` で閉じるかを見ずにキャストと決めていた）。末尾に空白・改行・コメントがあっても同じ（行は末尾の行）。`case` は switch の中に書く（トップレベルの `case` は名前＝「';' を期待しましたが 'EOF'」で是正前と同じ）。
{
  const EOFS = ['int y =', 'x = 1 +', 'return', 'if (', 'print(', 'a[', 'switch (1) { case', 'sizeof', 'f(1,', '1 ?', '(int)(', '(int*'];
  const TAILS = [['', 0], ['   ', 0], ['\n', 1], [' // c\n', 1], [' /* c */\n\n', 2]];
  const rows = [];
  for (const body of EOFS) {
    for (const [tail, nl] of TAILS) rows.push([body + tail, 1 + nl]);
    rows.push([`void setup() {\n  ${body}`, 2]);   // 関数の本体の中（行 2）
  }
  for (const [code, line] of rows) {
    const { ja, en } = runBoth(code, 'c');
    ok(ja.ctor === 'SourceError' && ja.key === 'interp.syn.unexpected' && ja.line === line && ja.err === `構文エラー(C): 予期しないトークン 'EOF' (行 ${line})` &&
      en.ctor === 'SourceError' && en.key === ja.key && en.line === line && en.err === `Syntax error (C): unexpected token 'EOF' (line ${line})`,
      `J-10 EOF ${J(code)} → ${ja.ctor}・${ja.key}・行 ${ja.line}・${J(ja.err)}（期待 SourceError・interp.syn.unexpected・行 ${line}・ja/en の文言・TypeError でない）`);
  }
}
console.log(`\n  gcc との突き合わせ: ${GCC ? gccChecked + ' 件' : '0 件（gcc 不在）'}`);

console.log(`\n  python3 との突き合わせ: ${PY3 ? py3Checked + ' 件' : '0 件（python3 不在）'}`);
console.log(`[結果] pass=${pass} fail=${fail}`);
setLang('ja');
process.exit(fail ? 1 : 0);
