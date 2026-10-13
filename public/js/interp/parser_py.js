// Python 風パーサ → 共通 AST。
import { tokenize, SourceError } from './lexer.js';

export function parsePy(src) {
  const toks = tokenize(src, 'py');
  let pos = 0;
  const peek = (k = 0) => toks[pos + k];
  const next = () => toks[pos++];
  const isEOF = () => peek().type === 'EOF';
  // BK1: 構文エラーは i18n キー＋行番号（SourceError・lexer.js）。sub＝interp.syn.<sub>・行＝読めなかったトークンの行（是正前と同じ）。
  //   是正前は素の Error に「構文エラー(Py): <文言> (行 N)」の日本語固定文を載せていた（ja の文言は 1 文字も変えない）。
  // BK2: ln＝行の指定（既定は読めなかったトークンの行）。ファイルの末尾で開いたままの括弧（toks.unclosed・lexer.js）より後ろの
  //   トークンで止まったら、その括弧の「'(' が閉じられていません」を括弧の行で報告する（括弧の中の改行が暗黙の行継続になったので、
  //   閉じ忘れは次の行以降の思わぬトークンで止まる。python3 の "'(' was never closed" と同じ。括弧より前のエラーはそのまま）。
  function err(sub, params, ln) {
    const u = toks.unclosed;
    if (u && sub !== 'unclosed' && pos > u.idx) err('unclosed', { ch: u.ch }, u.line);
    throw new SourceError('syn', sub, params, ln ?? peek().line, 'py');
  }
  // BK2: エラーに出すトークンの字面。f-string の外枠の `(`（lexer の印 fstr）は開き引用符（`f"`）を出す（是正前は '('）。
  const shown = (t) => t.fstr || (t.value ?? t.type);
  function eat(type, value) {
    const t = peek();
    if (t.type !== type || (value !== undefined && t.value !== value))
      err('expected', { want: value ?? type, got: shown(t) });
    return next();
  }
  const isPunc = (v) => peek().type === 'PUNC' && peek().value === v;
  const isOp = (v) => peek().type === 'OP' && peek().value === v;
  const isKw = (v) => peek().type === 'ID' && peek().value === v;
  const skipNewlines = () => { while (peek().type === 'NEWLINE') next(); };

  function program() {
    const body = [];
    skipNewlines();
    while (!isEOF()) { for (const s of statements()) body.push(s); skipNewlines(); }
    // BK2: 閉じていない括弧があるのに最後まで読めた（import／from／global の読み飛ばしが括弧の中の改行を越えてファイルの末尾まで呑んだ
    //   `from math import (sqrt⏎x = 1`）ときも、括弧の行で「閉じられていません」にする（黙って後ろの文を消さない）。
    if (toks.unclosed) err('unclosed', { ch: toks.unclosed.ch }, toks.unclosed.line);
    return { t: 'program', body, lang: 'py' };
  }

  function suite() {
    // ':' の後。改行+INDENT...DEDENT、または同一行の単純文
    if (peek().type === 'NEWLINE') {
      next();
      eat('INDENT');
      const stmts = [];
      while (peek().type !== 'DEDENT' && !isEOF()) { for (const s of statements()) stmts.push(s); skipNewlines(); }
      eat('DEDENT');
      return stmts;
    }
    // BJ6: 1 行の suite（`if n == 2: break`・`else: continue`・`while x: break`・`def f(): return 1`・`def f(): global x`）。
    //   字下げしたブロックの文（statementCore）と同じキーワードの単純文を kwStmt で読み、それ以外は従来どおり simpleStmt()。
    //   読んだ文には先頭のトークンの行を line に付ける（statement() と同じ規則。`else: z = 1 / 0` のエラーが else の行・
    //   `def f(): return 1 / 0` が関数の中の行になる）。是正前は simpleStmt() だけで読み、break／continue／pass／return／global が
    //   変数名になって「未定義の変数/名前: break」等（`def f(): return 1` は本体が変数 return で 1 が別の文）、文に line が無く
    //   外側の文の行（呼び出し元の行）で報告していた。複合文（if／while／for／def）は従来どおり simpleStmt() へ回って構文エラー
    //   （Python も SyntaxError）。キーワードの単純文の後ろに同じ行の続き（`break 5`・`return 1 2`・`;`）があれば構文エラー
    //   （Python も SyntaxError。続きを次の文として黙って読む形を新しく作らない。是正前は `if x: break 5` が「未定義の変数/名前: break」、
    //   `def f(): return 1 2` は f を呼ばなければエラー無しで走った。`;` は従来どおり未対応＝是正前と同じ文言の構文エラー。
    //   字下げしたブロックの `break 5` は従来どおり 5 を次の文として読む＝是正前からの差・BJ6 の範囲外）。
    // BK2: 1 行の suite も字下げしたブロック・トップレベルと同じ simpleStmts（`;` で区切った単純文の並び・行末の続きは構文エラー）で読む
    //   ＝`if x: a = 1; b = 2` は 2 つの文とも if の本体・`def f(): global x; x = 1` の x = 1 は関数の本体（python3 と同じ。BJ6 では
    //   「予期しないトークン ';'」）。キーワード以外の単純文の続き（`if x: y = 2 3`）も構文エラー（是正前は 3 を次の文として読んだ）。
    //   複合文は inlineCompound が BJ6 と同じ文言・行の構文エラーにする。
    inlineCompound();
    return simpleStmts();
  }
  // BK2: 1 行の suite に複合文（if／while／for／def）は書けない（Python も SyntaxError）。見出しを読み、本体を開く ':' を「予期しないトークン
  //   ':'」にする（BJ6 の期待値〔wf_bj1_pysem I-3〕と同じ文言・行。是正前は if 等を変数名として読み、続きを次の文として読んだ末に ':' で
  //   止まっていた。(29) で文の続きを構文エラーにしたので、見出しを読まずに単純文として読むと `if x: if x: pass` が 'x' で止まる）。
  function inlineCompound() {
    if (isKw('if') || isKw('while')) { next(); expr(); }
    else if (isKw('for')) { next(); eat('ID'); eat('ID', 'in'); expr(); }
    else if (isKw('def')) {
      next(); eat('ID'); eat('PUNC', '(');
      if (!isPunc(')')) do { eat('ID'); } while (isPunc(',') && next());
      eat('PUNC', ')');
    } else return;
    err('unexpected', { tok: shown(peek()) });
  }

  // BK2: 文＝複合文（def／if／while／for・1 つ）か、単純文の並び（simpleStmts・1 つ以上）。呼び手（program・suite）は返した配列を
  //   本体へ平らに足す（`a = 1; b = 2` は 2 つの文。1 つだけの行の AST は是正前と同じ＝出荷サンプルの AST 指紋は wf_bj1_pysem E 章）。
  function statements() {
    if (isKw('def') || isKw('if') || isKw('while') || isKw('for')) return [statement()];
    return simpleStmts();
  }
  function statement() {
    const ln = peek().line;
    const node = statementCore();
    if (node && typeof node === 'object' && node.line == null) node.line = ln;
    return node;
  }
  function statementCore() {
    if (isKw('def')) return funcDef();
    if (isKw('if')) return ifStmt();
    if (isKw('while')) return whileStmt();
    return forStmt();
  }
  // BK2 (18)(28)(29): 単純文の並び `small (';' small)* [';']` の後ろは行末（NEWLINE）かファイルの末尾だけ（Python の simple_stmts）。
  //   各文には先頭のトークンの行を line に付ける（是正前の statement() と同じ規則）。行末の `;`（`x = 1;`）は受理・`;;` と先頭の `;` は
  //   構文エラー（python3 も SyntaxError）。是正前は `;` が全て構文エラー「予期しないトークン ';'」(18)、字下げしたブロックとトップレベルの
  //   `global x; x = 1`・`import math; x = 1` は行末まで読み飛ばして `x = 1` が黙って消え (28)、文の後ろの同じ行の続き（`x = 1 2`・
  //   `print(1) print(2)`・`break 5`）を次の文として読んでいた (29)。1 行の suite のキーワードの文の続き（BJ6）も同じ判定で同じ文言・行。
  function simpleStmts() {
    const out = [];
    for (;;) {
      const ln = peek().line;
      const node = kwStmt() || simpleStmt();
      if (node.line == null) node.line = ln;
      out.push(node);
      if (!isPunc(';')) break;
      next();
      if (peek().type === 'NEWLINE' || isEOF()) break;
    }
    if (peek().type !== 'NEWLINE' && !isEOF()) err('unexpected', { tok: shown(peek()) });
    return out;
  }
  // BJ6: キーワードの単純文（return〔値あり・なし〕・break・continue・pass・import／from・global〔どちらも pass として読み飛ばす〕）。
  //   該当しなければ null。字下げしたブロックの文と suite の 1 行の分岐が共有する（BJ6 で statementCore から切り出した。字下げした
  //   ブロックの文の AST は是正前と同じ＝出荷サンプルの AST 指紋は wf_bj1_pysem E 章が見張る）。
  // BK2 (28): import／from／global の読み飛ばしは、どこでも `;` の手前で止める（`global x; x = 1` の x = 1 を次の文として読む。是正前は
  //   字下げしたブロックとトップレベルでは行末まで読み飛ばして x = 1 が黙って消え、1 行の suite だけ `;` で止めて構文エラーにしていた）。
  //   値の無い return は行末・`;`・ファイルの末尾の手前（`def f(): return; x = 1`）。
  function kwStmt() {
    if (isKw('return')) { next(); let v = null; if (peek().type !== 'NEWLINE' && !isPunc(';') && !isEOF()) v = expr(); return { t: 'return', value: v }; }
    if (isKw('break')) { next(); return { t: 'break' }; }
    if (isKw('continue')) { next(); return { t: 'continue' }; }
    if (isKw('pass')) { next(); return { t: 'pass' }; }
    if (isKw('import') || isKw('from') || isKw('global')) {
      while (peek().type !== 'NEWLINE' && !isEOF() && !isPunc(';')) next();
      return { t: 'pass' };
    }
    return null;
  }

  function funcDef() {
    eat('ID', 'def'); const name = eat('ID').value; eat('PUNC', '(');
    const params = [];
    if (!isPunc(')')) do { params.push(eat('ID').value); } while (isPunc(',') && next());
    eat('PUNC', ')'); eat('PUNC', ':');
    return { t: 'func', name, params, body: suite() };
  }

  function ifStmt() {
    eat('ID', 'if');
    return ifTail();
  }
  // 'if'/'elif' のキーワードを消費した後の本体を解析。
  function ifTail() {
    const cond = expr(); eat('PUNC', ':'); const then = suite();
    let els = null;
    skipNewlines();
    if (isKw('elif')) { next(); els = [ifTail()]; }
    else if (isKw('else')) { next(); eat('PUNC', ':'); els = suite(); }
    return { t: 'if', cond, then, els };
  }

  function whileStmt() {
    eat('ID', 'while'); const cond = expr(); eat('PUNC', ':');
    return { t: 'while', cond, body: suite() };
  }

  function forStmt() {
    eat('ID', 'for'); const v = eat('ID').value; eat('ID', 'in');
    // `for v in range(...)`: 高速・決定論の専用ノード。それ以外は任意の反復可能を forin で処理。
    if (isKw('range') && peek(1).type === 'PUNC' && peek(1).value === '(') {
      next(); eat('PUNC', '(');
      // BJ1: 引数は ternary() で 1 つずつ読む（1〜3 個）。是正前は expr()＝タプルを含む式で読んだため `range(2, 5)` の
      //   引数列全体が 1 つのタプル式になり end=タプル・start=0 として 0 回ループしていた（単引数は従来と同じ AST）。
      const a = ternary(); let start = { t: 'num', v: 0 }, end = a, step = { t: 'num', v: 1 };
      if (isPunc(',')) { next(); start = a; end = ternary(); if (isPunc(',')) { next(); step = ternary(); } }
      eat('PUNC', ')'); eat('PUNC', ':');
      return { t: 'forrange', var: v, start, end, step, body: suite() };
    }
    // AP9: `for v in <iterable>:` — list / str / dict(キー) を走査。
    const iter = expr(); eat('PUNC', ':');
    return { t: 'forin', var: v, iter, body: suite() };
  }

  function simpleStmt() {
    // 代入 (タプル可) または式
    const first = expr();
    // BJ1: 複合代入に `%=`・`//=`・`**=` を追加（評価器 execMassign は op.slice(0,-1) を applyBin へ渡す＝'%'・'//'・'**' は既存）。
    if (isOp('=') || (peek().type === 'OP' && ['+=', '-=', '*=', '/=', '%=', '//=', '**='].includes(peek().value))) {
      // BJ2: 複合代入の左辺は 1 つだけ（Python も `a, b += 1` は SyntaxError）。是正前は通って先頭の a だけ更新していた
      //   （execMassign の複合代入は targets[0] しか見ない＝黙って b を無視）。括弧付き `(a, b) += 1` も同じ tuple ノード。
      if (!isOp('=') && first && first.t === 'tuple')
        err('augTuple', { op: peek().value });
      // BK2 (9): リストの左辺の複合代入（`[a, b] += 1`）も構文エラー（python3 も SyntaxError「'list' is an illegal expression for augmented
      //   assignment」）。是正前は実行時エラー「代入先が不正です」。
      if (!isOp('=') && first && first.t === 'list')
        err('augList', { op: peek().value });
      const op = next().value;
      const targets = [first];
      // タプル代入の左辺は first が 'tuple' の場合あり (下の expr で処理しないため簡易対応)
      const valFirst = expr();
      const values = [valFirst];
      while (isPunc(',')) { next(); values.push(expr()); }
      return { t: 'massign', op, targets: flattenTargets(first), values };
    }
    return { t: 'exprstmt', expr: first };
  }

  // BK2 (9): リストの左辺 `[a, b] = …` もタプルの左辺と同じく要素ごとの代入先にする（是正前は list の節のまま評価器へ渡り「代入先が
  //   不正です」）。要素が 1 つの左辺（`a, = [5]`・`[a] = [5]`）は平らにせず、その節を 1 つの代入先にする（評価器の assignTo が右辺を
  //   列として分ける＝a は 5。平らにすると `a = [5]` と同じ AST になり a が [5]。タプルの `a, = [5]` は是正前はそうだった）。入れ子
  //   （`(a, b), c = …`・`[a, [b, c]] = …`）の内側の節も assignTo が分ける。要素 2 つ以上のタプルの AST は是正前と同じ。
  function flattenTargets(node) {
    if (node && (node.t === 'tuple' || node.t === 'list') && node.items.length >= 2) return node.items;
    return [node];
  }

  // ===== 式 =====
  function expr() { return tupleOrTernary(); }

  function tupleOrTernary() {
    const first = ternary();
    if (isPunc(',')) {
      const items = [first];
      // BK2: 末尾のカンマの後ろが `;`（`x = 1,; y = 2`）も末尾のカンマ（行末・`=` と同じ）。
      while (isPunc(',')) { next(); if (isPunc('=') || peek().type === 'NEWLINE' || isOp('=') || isPunc(';')) break; items.push(ternary()); }
      return { t: 'tuple', items };
    }
    return first;
  }

  function ternary() {
    const a = logicOr();
    if (isKw('if')) {
      next(); const cond = logicOr(); eat('ID', 'else'); const b = ternary();
      return { t: 'ternary', cond, a, b };
    }
    return a;
  }

  function logicOr() {
    let a = logicAnd();
    while (isKw('or')) { next(); a = { t: 'bin', op: '||', a, b: logicAnd() }; }
    return a;
  }
  function logicAnd() {
    let a = notExpr();
    while (isKw('and')) { next(); a = { t: 'bin', op: '&&', a, b: notExpr() }; }
    return a;
  }
  function notExpr() {
    if (isKw('not')) { next(); return { t: 'un', op: '!', a: notExpr() }; }
    return comparison();
  }
  function comparison() {
    // AP16: Python の連鎖比較 (10<x<5 は (10<x) and (x<5)＝偽・中間は1回評価・短絡)。
    // C は左結合 ((10<x)<5) のまま (parser_c は無改変)。単一比較 a<b は compare 1 段で従来と同値。
    // BK2 (10): `in`／`not in` も比較演算子（同じ優先順位・連鎖 `1 < 2 in [True]` も同じ規則・`not x in y` は not (x in y)）。値は
    //   評価器の applyBin（pyIn）。是正前は `in` で式が終わり「')' を期待しましたが 'in'」等。`for v in …` の `in` は forStmt が先に読む。
    const first = additive();
    const rest = [];
    for (;;) {
      let op;
      if (peek().type === 'OP' && ['==', '!=', '<', '<=', '>', '>='].includes(peek().value)) op = next().value;
      else if (isKw('in')) { next(); op = 'in'; }
      else if (isKw('not') && peek(1).type === 'ID' && peek(1).value === 'in') { next(); next(); op = 'not in'; }
      else break;
      rest.push({ op, right: additive() });
    }
    return rest.length ? { t: 'compare', first, rest } : first;
  }
  function additive() {
    let a = multiplicative();
    while (isOp('+') || isOp('-')) { const op = next().value; a = { t: 'bin', op, a, b: multiplicative() }; }
    return a;
  }
  // BJ2: Python の優先順位（言語リファレンス 6.5「べき乗演算子」・6.17）に合わせる:
  //   term   = factor (('*' | '/' | '%' | '//') factor)*
  //   factor = ('-' | '+') factor | power        … 単項は ** より弱い（-2**2 = -(2**2) = -4・-x**2 = -(x**2)）
  //   power  = postfix ['**' factor]             … 右辺は factor＝単項を許し（2**-1 = 0.5）右結合（2**3**2 = 2**9）
  //   是正前は multiplicative → power → unary の順で単項が ** より強く結合し、-2**2 が (-2)**2 = 4 だった。
  //   AST が変わるのは単項 ± が ** の左の被演算子に付く式（-a**b・+a**b・a**-b**c）だけで、それ以外（-x・a*-b・a**b・a**-b・a**b**c）は
  //   是正前と同じ（BJ2 で実測。出荷サンプルの AST 指紋は wf_bj1_pysem E 章が見張る）。
  function multiplicative() {
    let a = unary();
    while (peek().type === 'OP' && ['*', '/', '%', '//'].includes(peek().value)) { const op = next().value; a = { t: 'bin', op, a, b: unary() }; }
    return a;
  }
  function unary() {
    if (isOp('-') || isOp('+')) { const op = next().value; return { t: 'un', op, a: unary() }; }
    return power();
  }
  function power() {
    const a = postfix();
    if (isOp('**')) { next(); return { t: 'bin', op: '**', a, b: unary() }; }
    return a;
  }
  function postfix() {
    let e = primary();
    for (;;) {
      // BK2: f-string の外枠の `(`（印 fstr）は呼び出しの括弧にしない（`x f"{y}"`・`print f"{x}"` は python3 と同じく構文エラー。是正前は
      //   x("" + y) の呼び出しとして黙って走った）。
      if (isPunc('(') && !peek().fstr) {
        next(); const args = [];
        if (!isPunc(')')) do { args.push(ternary()); } while (isPunc(',') && next());
        eat('PUNC', ')'); e = { t: 'call', callee: e, args };
      } else if (isPunc('.')) {
        next(); const name = eat('ID').value; e = { t: 'member', obj: e, name };
      } else if (isPunc('[')) {
        next(); const idx = expr(); eat('PUNC', ']'); e = { t: 'index', obj: e, idx };
      } else break;
    }
    return e;
  }
  // BK2 (20): 隣り合う文字列リテラル（f-string・r／u 接頭辞を含む。括弧の中なら行をまたいでもよい）は 1 つの文字列（python3 と同じ）。
  //   かたまり＝STR・BYTES・f-string（lexer の emitFString が出した印 fstr 付きの `(` … `)`）。通常の文字列どうしは 1 つの str の節に
  //   畳み、f-string を含むときは '+' でつなぐ（f-string の展開は先頭が必ず文字列＝値は str）。かたまりが 1 つなら是正前と同じ節。
  //   bytes（b"…"）は未対応＝構文エラー（行＝その b"…" の行・連結の途中でも同じ。python3 は bytes と文字列の連結も SyntaxError）。
  //   是正前は 2 つ目のかたまりで式が終わり、括弧の中なら「')' を期待しましたが 'cd'」、文なら 2 つ目が別の文として黙って捨てられた。
  const isStrAtom = () => { const t = peek(); return t.type === 'STR' || t.type === 'BYTES' || (t.type === 'PUNC' && t.value === '(' && !!t.fstr); };
  function strAtom() {
    const t = peek();
    if (t.type === 'BYTES') err('bytes', { open: t.value });
    next();
    if (t.type === 'STR') return { t: 'str', v: t.value };
    const e = expr(); eat('PUNC', ')'); return e;   // f-string（是正前の `(` の分岐と同じ読み方）
  }
  function primary() {
    const t = peek();
    if (t.type === 'NUM') { next(); return { t: 'num', v: t.value }; }
    if (isStrAtom()) {
      let node = strAtom();
      while (isStrAtom()) {
        const b = strAtom();
        node = (node.t === 'str' && b.t === 'str') ? { t: 'str', v: node.v + b.v } : { t: 'bin', op: '+', a: node, b };
      }
      return node;
    }
    if (t.type === 'ID') {
      if (t.value === 'True') { next(); return { t: 'bool', v: true }; }
      if (t.value === 'False') { next(); return { t: 'bool', v: false }; }
      if (t.value === 'None') { next(); return { t: 'num', v: 0 }; }
      next(); return { t: 'var', name: t.value };
    }
    if (isPunc('(')) { next(); const e = expr(); eat('PUNC', ')'); return e; }
    if (isPunc('[')) {
      next(); const items = [];
      if (!isPunc(']')) do { items.push(ternary()); } while (isPunc(',') && next());
      eat('PUNC', ']'); return { t: 'list', items };
    }
    // AP9: dict リテラル `{k: v, ...}` (空 `{}` は空 dict)。set リテラルは非対応 (キー:値 のみ)。
    if (isPunc('{')) {
      next(); const entries = [];
      if (!isPunc('}')) do {
        const key = ternary(); eat('PUNC', ':'); const value = ternary();
        entries.push({ key, value });
      } while (isPunc(',') && next());
      eat('PUNC', '}'); return { t: 'dict', entries };
    }
    err('unexpected', { tok: shown(t) });
  }

  return program();
}
