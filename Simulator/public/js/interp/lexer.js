// 字句解析。mode = 'c' | 'py'。
// 共通トークン: NUM, STR, ID, OP, PUNC, EOF
// Python 専用: NEWLINE, INDENT, DEDENT
// 戻り値: トークン配列。

const OPS3 = ['**=', '<<=', '>>='];
const OPS2 = ['==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '**', '//', '++', '--', '<<', '>>', '&=', '|=', '^='];
const OPS1 = ['+', '-', '*', '/', '%', '<', '>', '=', '!', '&', '|', '?', '^', '~'];
const PUNCS = ['(', ')', '{', '}', '[', ']', ',', ';', ':', '.'];

function isIdStart(ch) { return /[A-Za-z_]/.test(ch); }
function isIdPart(ch) { return /[A-Za-z0-9_]/.test(ch); }
function isDigit(ch) { return /[0-9]/.test(ch); }

// AP8: C プリプロセッサ `#define`（オブジェクト形式マクロのみ）。
// macros[name] = 置換トークン列。使用箇所で単純にトークンを差し込む（テキスト置換相当）。
// 関数形式マクロ `#define SQ(x) ...` は未対応＝明示エラー（サイレント読み飛ばしを廃す）。
export function tokenize(src, mode, macros = Object.create(null)) {
  const toks = [];
  let i = 0, line = 1;
  const n = src.length;
  // Python のインデントスタック
  const indentStack = [0];
  let atLineStart = (mode === 'py');

  function pushTok(type, value) { toks.push({ type, value, line }); }

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
      throw new Error(`未対応の関数形式マクロ '#define ${name}(...)' (行 ${line})`);
    }
    // 置換本体をトークン化（既に定義済みのマクロは展開・自己/前方参照は素の ID のまま＝C 相当）。
    const body = after.trim();
    macros[name] = tokenize(body, 'c', macros).filter(t => t.type !== 'EOF');
  }
  function skipBlockComment() {
    i += 2;
    while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
    i += 2;
  }

  // AP9: f-string の内容 raw を `( STR + (exprtoks) + STR ... )` へ展開して現在の行番号で push する。
  function emitFString(raw) {
    const parts = [];   // {lit:string} | {expr:string}
    let lit = '', k = 0;
    while (k < raw.length) {
      const c = raw[k];
      if (c === '{') {
        if (raw[k + 1] === '{') { lit += '{'; k += 2; continue; }
        parts.push({ lit }); lit = ''; k++;
        let depth = 1, etext = '';
        while (k < raw.length) {
          const d = raw[k];
          if (d === '{') depth++;
          else if (d === '}') { depth--; if (depth === 0) break; }
          etext += d; k++;
        }
        k++;                                   // 閉じ '}' を消費
        parts.push({ expr: stripFormatSpec(etext) });
      } else if (c === '}' && raw[k + 1] === '}') { lit += '}'; k += 2; }
      else { lit += c; k++; }
    }
    parts.push({ lit });
    pushTok('PUNC', '(');
    let firstEmit = true;
    const plus = () => { if (!firstEmit) pushTok('OP', '+'); firstEmit = false; };
    for (const p of parts) {
      if (p.lit !== undefined) {
        if (p.lit === '' && !firstEmit) continue;   // 中間の空リテラルは省く (先頭は文字列文脈のため残す)
        plus(); pushTok('STR', p.lit);
      } else {
        plus();
        pushTok('PUNC', '(');
        for (const t of tokenize(p.expr, 'c').filter(t => t.type !== 'EOF')) pushTok(t.type, t.value);
        pushTok('PUNC', ')');
      }
    }
    if (firstEmit) pushTok('STR', '');            // f"" → ""
    pushTok('PUNC', ')');
  }
  // トップレベル (括弧外) の最初の `:` (フォーマット指定) / `!r|!s|!a` (変換) 以降を落とす。
  function stripFormatSpec(s) {
    let depth = 0;
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (depth === 0 && c === ':') return s.slice(0, j);
      else if (depth === 0 && c === '!' && /[rsa]/.test(s[j + 1] || '') &&
               (j + 2 >= s.length || s[j + 2] === ':')) return s.slice(0, j);
    }
    return s;
  }

  function handlePyIndent() {
    // 行頭。空白を数える。空行/コメント行はスキップ。
    let col = 0;
    while (i < n) {
      if (src[i] === ' ') { col++; i++; }
      else if (src[i] === '\t') { col += 8; i++; }
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

    // 行継続 (Python の \ 改行)
    if (ch === '\\' && src[i + 1] === '\n') { i += 2; line++; continue; }

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
    if (mode === 'py' && (ch === 'f' || ch === 'F') && (src[i + 1] === '"' || src[i + 1] === "'")) {
      const quote = src[i + 1]; i += 2;
      let raw = '';
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') { raw += src[i + 1]; i += 2; }
        else raw += src[i++];
      }
      i++;
      emitFString(raw);
      continue;
    }
    // 文字列
    if (ch === '"' || ch === "'") {
      const quote = ch; let s = ''; i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') { s += src[i + 1]; i += 2; }
        else s += src[i++];
      }
      i++;
      pushTok('STR', s);
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

    throw new Error(`字句エラー: 不明な文字 '${ch}' (行 ${line})`);
  }

  if (mode === 'py') {
    const last = toks[toks.length - 1];
    if (last && last.type !== 'NEWLINE') pushTok('NEWLINE');
    while (indentStack.length > 1) { indentStack.pop(); pushTok('DEDENT'); }
  }
  pushTok('EOF');
  return toks;
}
