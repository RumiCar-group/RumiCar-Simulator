// 字句解析。mode = 'c' | 'py'。
// 共通トークン: NUM, STR, ID, OP, PUNC, EOF
// Python 専用: NEWLINE, INDENT, DEDENT
// 戻り値: トークン配列。
//
// BJ5: 文字列リテラル（通常・三重引用符・f-string。C・py 共通）は readStrBody で閉じ引用符まで読む。
//   ① py の `"""…"""`／`'''…'''`（`f`/`F` 接頭辞付きを含む）を 1 つの文字列リテラルとして読む（中身は改行と単独の引用符を含みうる・
//      エスケープと CRLF→LF は通常の文字列と同じ strUnit）。C は三重引用符を扱わない（従来どおり `""`＋`"…"`＋`""`）。
//   ② 文字列の中の改行（LF・CRLF・`\`＋改行。CR 単独は数えない＝本体ループと同じ）で行番号を進める。文字列のトークンと f-string の
//      外枠のトークンの行は開き引用符の行（＝その文字列で始まる文の AST の line も開き引用符の行）・f-string の埋め込み式のトークンは式の
//      物理行（式の中の字句エラー・構文エラーの行＝python3 と同じ。AST は式のトークンの行を持たない）・文字列の後ろのトークンは物理行。
//   ③ ファイルの末尾まで閉じ引用符が無い文字列は字句エラー（行＝開き引用符の行）。f-string の閉じ `}` の無い置換フィールドも字句エラー
//      （行＝`{` の行・emitFString）。
//   是正前（HEAD 0aa4039）: `s = """a"""` が `""`＋`"a"`＋`""` の 3 つの文として通って s は空文字列・`'''It's "ok"'''` の開いたままの
//   `'` が後続の文をファイル末尾まで黙って呑む・docstring `"""say "hi" """` が「未定義の変数/名前: hi」・文字列の中の改行で行番号が
//   進まない（以降のエラーの行が改行の数だけ小さい）・閉じていない文字列 `s = "abc` がエラー無しで通った。
//   通常の引用符の文字列の中の改行は従来どおり受理し（Python は SyntaxError）、`\`＋改行は従来どおり LF を残す（三重引用符も同じ。
//   Python は行継続＝`"""a\⏎b"""` は "ab"）。

import { t } from '../i18n.js';

// BK1: 字句エラー・構文エラーを i18n キー＋行番号で表す（実行時エラー RuntimeError〔evaluator.js〕と同じ機構）。
//   message は throw 時点の言語で翻訳済み＝表示層（fleet/main/race）は従来どおり e.message を使う。
//   phase＝'lex'（字句・本ファイル）／'syn'（構文・parser_py/parser_c）。文言のキーは interp.<phase>.<sub>。
//   head＝文言の頭（'lex'＝「字句エラー: 」・'py'／'c'＝「構文エラー(Py): 」／「構文エラー(C): 」・null＝頭なし〔関数形式マクロ〕）。
//   行の接尾は実行時エラーと同じ interp.err.line（ja「 (行 N)」・en「 (line N)」）で、字句・構文エラーは常に付ける（是正前と同じ）。
//   ja の文言は是正前（素の Error に載せた日本語固定文）と 1 文字も変えない（wf_bj1_pysem の既存の期待値・wf_bk1_interp2 A 章）。
//   是正前は en モードでも日本語が出た（BJ-16 F1 の既知）。i18nKey＝文言のキー・i18nParams・line は RuntimeError と同じ名前の構造値。
export class SourceError extends Error {
  constructor(phase, sub, params, line, head) {
    const hd = head ? t('interp.' + phase + '.head' + (head === 'lex' ? '' : '.' + head)) : '';
    super(hd + t('interp.' + phase + '.' + sub, params || {}) + t('interp.err.line', { n: line }));
    this.i18nKey = 'interp.' + phase + '.' + sub;
    this.i18nParams = params || {};
    this.line = line;
  }
}
const lexErr = (sub, params, line, head = 'lex') => new SourceError('lex', sub, params, line, head);

// BJ1: py の複合代入 `%=`・`//=` を 1 トークンに（`**=` は従来から在る）。C の `//` は行コメントの判定が演算子より先なので
//   `//=` は C に現れない。C の `%=` は 1 トークンになるが parser_c は従来どおり受理しない（是正前も構文エラー＝受理範囲は不変）。
const OPS3 = ['**=', '<<=', '>>=', '//='];
const OPS2 = ['==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '**', '//', '++', '--', '<<', '>>', '&=', '|=', '^='];
const OPS1 = ['+', '-', '*', '/', '%', '<', '>', '=', '!', '&', '|', '?', '^', '~'];
const PUNCS = ['(', ')', '{', '}', '[', ']', ',', ';', ':', '.'];

function isIdStart(ch) { return /[A-Za-z_]/.test(ch); }
function isIdPart(ch) { return /[A-Za-z0-9_]/.test(ch); }
function isDigit(ch) { return /[0-9]/.test(ch); }

// BJ1: 文字列リテラル（C・py 共通。f-string と #define の置換本体も同じ tokenize を通る）のエスケープ。
//   `\n \t \r \\ \" \' \0` を実際の文字に。それ以外（未知のエスケープ）は従来どおり `\` を落として次の文字。
//   是正前は全て「次の文字」だった（"a\tb" → "atb"）。8 進/16 進/Unicode のエスケープは扱わない（\x41 → "x41"・\012 → NUL＋"12"）。
const ESCAPES = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", '0': '\0' };
function unescapeChar(c) { return Object.prototype.hasOwnProperty.call(ESCAPES, c) ? ESCAPES[c] : c; }
// BJ2: f-string の埋め込み式を py モードで字句解析したときに落とすトークン（式の中では意味を持たない）。
const FSTR_DROP = new Set(['EOF', 'NEWLINE', 'INDENT', 'DEDENT']);

// AP8: C プリプロセッサ `#define`（オブジェクト形式マクロのみ）。
// macros[name] = 置換トークン列。使用箇所で単純にトークンを差し込む（テキスト置換相当）。
// 関数形式マクロ `#define SQ(x) ...` は未対応＝明示エラー（サイレント読み飛ばしを廃す）。
// BJ2: line0＝開始行（f-string の埋め込み式を字句解析するとき、字句エラーの行番号を外側の行にするため。既定 1＝従来どおり）。
export function tokenize(src, mode, macros = Object.create(null), line0 = 1) {
  const toks = [];
  let i = 0, line = line0;
  const n = src.length;
  // Python のインデントスタック
  const indentStack = [0];
  let atLineStart = (mode === 'py');

  // BJ5: ln＝トークンの行（既定は現在の行）。文字列・f-string は開き引用符の行を渡す（本体の改行で line が進んだ後に push するため）。
  function pushTok(type, value, ln = line) { toks.push({ type, value, line: ln }); }

  function skipLineComment() { while (i < n && src[i] !== '\n') i++; }

  // C プリプロセッサ行の処理。`#define NAME 置換...`（オブジェクト形式）を macros に登録し、
  // それ以外の指令（#include/#ifdef/#pragma 等）は従来どおり行ごと無視する。
  // i は '#' を指す。行末（\n の手前）まで消費する（\n は本体ループが処理＝line++ は不変）。
  function handleDirective() {
    let text = '';
    while (i < n && src[i] !== '\n') text += src[i++];
    const m = /^#\s*define\s+/.exec(text);
    if (!m) return;                                   // define 以外の指令 → 無視
    const rest = text.slice(m[0].length);
    const nm = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (!nm) return;                                  // 壊れた define → 無視
    const name = nm[0];
    const after = rest.slice(name.length);
    if (after[0] === '(') {                            // 直後 '('（空白なし）＝関数形式マクロ
      throw lexErr('funcMacro', { name }, line, null);
    }
    // 置換本体をトークン化（既に定義済みのマクロは展開・自己/前方参照は素の ID のまま＝C 相当）。
    // BJ5: 開始行＝指令の行（置換本体の字句エラー〔閉じていない文字列・不明な文字〕の行。是正前は常に行 1。
    //   置換トークンの行は使用箇所の行で差し込み直すので AST は変わらない）。
    const body = after.trim();
    macros[name] = tokenize(body, 'c', macros, line).filter(t => t.type !== 'EOF');
  }
  function skipBlockComment() {
    i += 2;
    while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
    i += 2;
  }

  // AP9: f-string の内容を `( STR + (exprtoks) + STR ... )` へ展開して push する。
  // BJ2: 内容は 1 文字ずつの組 {ch: エスケープ解除後の文字, raw: 本文の生テキスト（`\n` なら 2 文字）} の列 units で受ける。
  //   リテラル部分の波括弧の判定と文字列部分は ch で行い（是正前と同じ。埋め込み式の範囲の判定は BJ5 で raw に）、埋め込み式は raw を
  //   連結して **py モード**で字句解析する。
  //   是正前は式もエスケープ解除後の文字から切り出し C モードで字句解析していた＝①`f"{7//2}"` の `//` 以降が C の行コメントに
  //   なり "7"（python3 は "3"）②`f"{'\\n'}"` の式 `'\\n'` が外側と内側で 2 回エスケープ解除されて LF 1 文字（python3 は
  //   `\` と `n` の 2 文字）。py モードの字句解析は行頭の字下げ（`{ x }` の空白）を INDENT に、末尾を NEWLINE にするので、
  //   式の中では意味を持たない NEWLINE/INDENT/DEDENT は落とす（EOF も従来どおり落とす）。
  //   式の中の `\"`（例 `f"{d[\"k\"]}"`）は Python では SyntaxError で、本処理系も字句エラー「不明な文字 '\'」になる（是正前は通っていた）。
  // BJ5: units の各単位は line（その単位が始まる物理行）も持つ。ln＝開き引用符の行。
  //   ① 行: 外枠のトークン（最初の `(`・リテラル部分の STR・`+`・最後の `)`）は ln で出す（＝f-string で始まる文の AST の line は開き引用符の行）。
  //      埋め込み式のトークン（式を囲む `(`／`)` を含む）は式の物理行で出し、式の字句解析は `{` の行から始める＝式の中の字句エラーの行は
  //      その文字（閉じていない文字列は開き引用符）の物理行、構文エラーの行は読めなかったトークンの物理行（`x = 1⏎s = f"""a⏎{x y}"""` は
  //      行 3＝python3 と同じ。python3 は「カンマ忘れ」等で式の始まりの行を出すこともある）。BJ5 の初版は式の字句解析を開き引用符の行から
  //      始めてトークンの行を開き引用符の行で上書きしていた＝字句エラーは「開き引用符の行＋式の中の改行の数」・構文エラーは開き引用符の行で、
  //      どちらも物理行と合わなかった（層 4 の指摘）。AST が持つ行は文の line だけ（parser_py の statement）なので、式のトークンの行は AST に入らない。
  //      実行時エラーの行は従来どおり文の行（`\` で続けた複数行の文と同じ。python3 は式のある行）。
  //   ② 埋め込み式の範囲は 1 回の走査で決める。式の中の文字列リテラル（'…'・"…"・'''…'''・"""…"""。`\'` 等のエスケープは raw が 2 文字＝
  //      引用符に数えない）の中では `{`・`}`・`:`・`!` を区切りにしない（f"{'}'}" → "}"・f"{':'}" → ":"・f"{'''it's'''}" → "it's"）。
  //      括弧の外の最初の `:`（書式指定）／`!r`・`!s`・`!a`（変換）から後ろは落とし（値は素の str 化・従来どおり）、その中の引用符は文字として
  //      扱う（python3 と同じ。f"{x:'>5}" の `'` は埋め文字＝区切りではない）。書式指定の中では入れ子の `{…}` だけを数えて閉じ `}` を探す。
  //   ③ 閉じ `}` が無い置換フィールドは字句エラー（行＝`{` の行。式の中に字句エラー〔閉じていない文字列・`\` 等〕があればそちらを先に報告）。
  //      BJ5 の初版は書式指定の中の引用符も文字列の区切りとして追い、閉じ `}` を見落として本体の末尾まで読み、書式指定として黙って落としていた
  //      （f"{x:'>5} and {a}" → "5"。層 4 の指摘。是正前の 0aa4039 と python3 の書式指定を落とした値は "5 and 4"）。
  //   是正前（HEAD 0aa4039）: 式の範囲は `{`／`}` だけで決め（引用符を見ない）、切り出した式から書式指定を落としていた＝f"{'}'}" → "'}"・
  //   f"{':'}" → ""・f"{'a:b'}" → "a"・f"{'{'}" → 構文エラー・閉じ `}` の無い f"{x" → "5"（エラー無し・python3 は SyntaxError）。
  function emitFString(units, ln) {
    const parts = [];   // {lit:string} | {expr:string, l0:式の開始行（`{` の行）, l1:閉じ `}` の行}
    let lit = '', k = 0;
    const chAt = (j) => (j < units.length ? units[j].ch : undefined);
    const rawAt = (j) => (j < units.length ? units[j].raw : undefined);
    while (k < units.length) {
      const c = units[k].ch;
      if (c === '{') {
        if (chAt(k + 1) === '{') { lit += '{'; k += 2; continue; }
        parts.push({ lit }); lit = '';
        const l0 = units[k].line; k++;
        // braces＝`{`／`}` の深さ（閉じ `}` の判定）・brackets＝`(`・`[`・`{` の深さ（書式指定の `:`／`!` の判定）・
        // q＝式の中の文字列リテラルの開き引用符（中にいる間だけ。三重引用符は 3 文字）・spec＝書式指定／変換の中。
        // 式の中の判定は raw（本文の生テキスト）で行う＝`\}`・`\:` 等のエスケープ（raw が 2 文字）は区切りに数えず式にそのまま残す（式の中の
        // `\` は字句エラー＝python3 と同じ SyntaxError。是正前は ch で判定し `\}` で式を閉じて `\` を黙って落とした＝f"{x\}" → "5"）。
        // 書式指定の中は従来どおり ch で `{`／`}` を数える（`\` は書式指定の文字で、続く `}` は閉じ＝python3 と同じ）。
        let braces = 1, brackets = 0, etext = '', q = null, spec = false;
        while (k < units.length) {
          const r = units[k].raw;
          if (spec) {
            const d = units[k].ch;
            if (d === '{') braces++;
            else if (d === '}' && --braces === 0) break;
            k++; continue;
          }
          if (q) {
            if (r === q[0] && (q.length === 1 || (rawAt(k + 1) === r && rawAt(k + 2) === r))) { etext += q; k += q.length; q = null; }
            else { etext += r; k++; }
            continue;
          }
          if (r === '"' || r === "'") { q = (rawAt(k + 1) === r && rawAt(k + 2) === r) ? r + r + r : r; etext += q; k += q.length; continue; }
          if (r === '{') { braces++; brackets++; }
          else if (r === '}') { if (--braces === 0) break; brackets--; }
          else if (r === '(' || r === '[') brackets++;
          else if (r === ')' || r === ']') brackets--;
          else if (brackets === 0 && (r === ':' || (r === '!' && /^[rsa]$/.test(rawAt(k + 1) || '') &&
                   (rawAt(k + 2) === '}' || rawAt(k + 2) === ':')))) { spec = true; k++; continue; }
          etext += r; k++;
        }
        if (k >= units.length) {
          tokenize(etext, 'py', undefined, l0);   // 式の中の字句エラー（閉じていない文字列・`\` 等）があれば先に報告（行＝物理行）
          throw lexErr('fstrBrace', {}, l0);
        }
        parts.push({ expr: etext, l0, l1: units[k].line });
        k++;                                   // 閉じ '}' を消費
      } else if (c === '}' && chAt(k + 1) === '}') { lit += '}'; k += 2; }
      else { lit += c; k++; }
    }
    parts.push({ lit });
    pushTok('PUNC', '(', ln);
    let firstEmit = true;
    const plus = () => { if (!firstEmit) pushTok('OP', '+', ln); firstEmit = false; };
    for (const p of parts) {
      if (p.lit !== undefined) {
        if (p.lit === '' && !firstEmit) continue;   // 中間の空リテラルは省く (先頭は文字列文脈のため残す)
        plus(); pushTok('STR', p.lit, ln);
      } else {
        plus();
        pushTok('PUNC', '(', p.l0);
        for (const t of tokenize(p.expr, 'py', undefined, p.l0).filter(t => !FSTR_DROP.has(t.type))) pushTok(t.type, t.value, t.line);
        pushTok('PUNC', ')', p.l1);
      }
    }
    if (firstEmit) pushTok('STR', '', ln);        // f"" → ""
    pushTok('PUNC', ')', ln);
  }

  // 文字列リテラル（通常・f-string 共通）の中身を 1 単位読む。i は単位の先頭を指し、読んだ分だけ進める。
  //   ch＝値に入る文字（BJ1 の実エスケープ）・raw＝本文の生テキスト（f-string の埋め込み式は raw から組む・BJ2）。
  //   BJ2: CRLF（Windows の改行・ファイル取込/GitHub 取込は本文をそのまま渡す）を LF に正規化する＝文字列の中に改行を含む
  //   本文（`"a` CRLF `b"`・三重引用符 `"""a` CRLF `b"""` の中身）の値と AST が LF 版と一致する。是正前は値に `\r` が残った。
  //   `\` ＋ CRLF も `\` ＋ LF と同じ（従来どおり `\` を落とした LF 1 文字）。CR 単独は従来どおりそのまま。
  //   BJ5: 物理的な改行（LF・CRLF・`\`＋LF・`\`＋CRLF）を読んだら行番号を進める（本体ループの改行と同じ数え方＝CR 単独は数えない）。
  function strUnit() {
    if (src[i] === '\\') {
      if (src[i + 1] === '\r' && src[i + 2] === '\n') { i += 3; line++; return { ch: '\n', raw: '\\\n' }; }
      if (src[i + 1] === '\n') line++;
      const u = { ch: unescapeChar(src[i + 1]), raw: src.slice(i, i + 2) };
      i += 2; return u;
    }
    if (src[i] === '\r' && src[i + 1] === '\n') { i += 2; line++; return { ch: '\n', raw: '\n' }; }
    const c = src[i++];
    if (c === '\n') line++;
    return { ch: c, raw: c };
  }

  // BJ5: 文字列リテラルの本体を閉じ引用符 close（'"'・"'"・'"""'・"'''"）まで読み、閉じ引用符の直後へ進めて単位の列を返す。
  //   i は本体の先頭（開き引用符の直後）を指す。ファイルの末尾まで閉じ引用符が無ければ字句エラー（行＝開き引用符の行 l0）。
  //   是正前は閉じ引用符が無くてもファイル末尾までを文字列として黙って受け取っていた。
  function readStrBody(open, close, l0) {
    const units = [];
    while (i < n && !src.startsWith(close, i)) { const l = line, u = strUnit(); u.line = l; units.push(u); }   // line＝単位の物理行（emitFString の式の行）
    if (i >= n) throw lexErr('unterminated', { open, close }, l0);
    i += close.length;
    return units;
  }

  function handlePyIndent() {
    // 行頭。空白を数える。空行/コメント行はスキップ。
    // BJ1: CRLF（Windows の改行・ファイル取込/GitHub 取込は本文をそのまま渡す）の `\r` は字下げに数えず読み飛ばす＝
    //   `\r\n` だけ（と空白＋`\r\n`）の行も空行として扱う。是正前は `\r` で止まり col=0 の行と見て DEDENT を出していた。
    let col = 0;
    while (i < n) {
      if (src[i] === ' ') { col++; i++; }
      else if (src[i] === '\t') { col += 8; i++; }
      else if (src[i] === '\r') { i++; }
      else break;
    }
    if (i >= n) return;
    if (src[i] === '\n') { i++; line++; return; } // 空行
    if (src[i] === '#') { skipLineComment(); return; } // コメント行
    // インデント変化
    const top = indentStack[indentStack.length - 1];
    if (col > top) { indentStack.push(col); pushTok('INDENT'); }
    else while (col < indentStack[indentStack.length - 1]) {
      indentStack.pop(); pushTok('DEDENT');
    }
    atLineStart = false;
  }

  while (i < n) {
    if (mode === 'py' && atLineStart) { handlePyIndent(); continue; }
    const ch = src[i];

    // コメント / プリプロセッサ (C の #define は展開・#include 等は行ごと無視。py の # は行コメント)
    if (ch === '#') {
      if (mode === 'c') { handleDirective(); continue; }
      skipLineComment(); continue;
    }
    if (ch === '/' && src[i + 1] === '/' && mode === 'c') { skipLineComment(); continue; }
    if (ch === '/' && src[i + 1] === '*' && mode === 'c') { skipBlockComment(); continue; }

    // 改行
    if (ch === '\n') {
      i++; line++;
      if (mode === 'py') {
        // 直近が有効トークンなら NEWLINE を出す
        const last = toks[toks.length - 1];
        if (last && last.type !== 'NEWLINE' && last.type !== 'INDENT' && last.type !== 'DEDENT')
          pushTok('NEWLINE');
        atLineStart = true;
      }
      continue;
    }
    // 空白
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }

    // 行継続 (Python の \ 改行)。BJ1: CRLF の `\` `\r` `\n` も同じ（`\r` は改行の一部）。
    if (ch === '\\' && src[i + 1] === '\n') { i += 2; line++; continue; }
    if (ch === '\\' && src[i + 1] === '\r' && src[i + 2] === '\n') { i += 3; line++; continue; }

    // 数値 (10進 / 小数 / 指数 1e3 / 16進 0x1F)
    if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1]))) {
      // 16進リテラル 0x.. / 0X..
      if (ch === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
        let h = src[i] + src[i + 1]; i += 2;
        while (i < n && /[0-9a-fA-F]/.test(src[i])) h += src[i++];
        pushTok('NUM', parseInt(h, 16));
        continue;
      }
      let s = '';
      while (i < n && isDigit(src[i])) s += src[i++];
      if (src[i] === '.') { s += src[i++]; while (i < n && isDigit(src[i])) s += src[i++]; }
      // 指数表記 1e3 / 1.5e-3 / .5E+2 (e/E の後に数字、または符号+数字が続くときのみ)
      if ((src[i] === 'e' || src[i] === 'E') &&
          (isDigit(src[i + 1]) || ((src[i + 1] === '+' || src[i + 1] === '-') && isDigit(src[i + 2])))) {
        s += src[i++];                                  // e / E
        if (src[i] === '+' || src[i] === '-') s += src[i++];
        while (i < n && isDigit(src[i])) s += src[i++];
      }
      pushTok('NUM', parseFloat(s));
      continue;
    }
    // AP9: Python f-string `f"..."` / `f'...'` (F 大文字も可)。接頭辞 f が引用符直前のときだけ。
    //   `( "lit0" + (expr1) + "lit1" + ... )` へトークン展開する (先頭は必ず STR ＝文字列連結文脈)。
    //   埋め込み式は再帰 tokenize (既存 #define と同じ流儀)。フォーマット指定 `{x:.2f}`/変換 `{x!r}`
    //   は先頭のトップレベル `:`/`!` 以降を切り捨てる (簡易・値は素の str 化)。`{{`/`}}` は素の波括弧。
    //   BJ5: `f"""…"""`／`f'''…'''`（三重引用符）も同じ展開。外枠のトークン（STR・`(`・`)`・`+`）の行は開き引用符の行＝文の AST line。
    //   埋め込み式の中のトークンは物理行を持つ（式の中の字句・構文エラーは物理行で報告＝python3 と同じ）。
    if (mode === 'py' && (ch === 'f' || ch === 'F') && (src[i + 1] === '"' || src[i + 1] === "'")) {
      const l0 = line, q = src[i + 1];
      const close = src.startsWith(q + q + q, i + 1) ? q + q + q : q;
      i += 1 + close.length;
      const units = readStrBody(ch + close, close, l0);   // BJ1: 実エスケープ・BJ2: 生テキストも保持＋CRLF→LF・BJ5: 改行で行を進める
      emitFString(units, l0);
      continue;
    }
    // 文字列（BJ5: py は `"""`／`'''` で始まれば三重引用符。C は扱わない）
    if (ch === '"' || ch === "'") {
      const l0 = line;
      const close = (mode === 'py' && src.startsWith(ch + ch + ch, i)) ? ch + ch + ch : ch;
      i += close.length;
      const units = readStrBody(close, close, l0);        // BJ1: 実エスケープ・BJ2: CRLF→LF・BJ5: 改行で行を進める
      pushTok('STR', units.map((u) => u.ch).join(''), l0);
      continue;
    }
    // 識別子 / キーワード
    if (isIdStart(ch)) {
      let s = '';
      while (i < n && isIdPart(src[i])) s += src[i++];
      // AP8: C マクロ名は置換トークン列を使用箇所の行番号で差し込む（本体空の #define FLAG は 0 トークン）。
      if (mode === 'c' && s in macros) {
        for (const bt of macros[s]) pushTok(bt.type, bt.value);
        continue;
      }
      pushTok('ID', s);
      continue;
    }
    // 演算子 (長い順)
    const three = src.substr(i, 3);
    if (OPS3.includes(three)) { pushTok('OP', three); i += 3; continue; }
    const two = src.substr(i, 2);
    if (OPS2.includes(two)) { pushTok('OP', two); i += 2; continue; }
    if (OPS1.includes(ch)) { pushTok('OP', ch); i++; continue; }
    if (PUNCS.includes(ch)) { pushTok('PUNC', ch); i++; continue; }

    throw lexErr('badChar', { ch }, line);
  }

  if (mode === 'py') {
    const last = toks[toks.length - 1];
    if (last && last.type !== 'NEWLINE') pushTok('NEWLINE');
    while (indentStack.length > 1) { indentStack.pop(); pushTok('DEDENT'); }
  }
  pushTok('EOF');
  return toks;
}
