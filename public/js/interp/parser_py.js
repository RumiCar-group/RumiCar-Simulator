// Python 風パーサ → 共通 AST。
import { tokenize } from './lexer.js';

export function parsePy(src) {
  const toks = tokenize(src, 'py');
  let pos = 0;
  const peek = (k = 0) => toks[pos + k];
  const next = () => toks[pos++];
  const isEOF = () => peek().type === 'EOF';
  function err(msg) { throw new Error(`構文エラー(Py): ${msg} (行 ${peek().line})`); }
  function eat(type, value) {
    const t = peek();
    if (t.type !== type || (value !== undefined && t.value !== value))
      err(`'${value ?? type}' を期待しましたが '${t.value ?? t.type}'`);
    return next();
  }
  const isPunc = (v) => peek().type === 'PUNC' && peek().value === v;
  const isOp = (v) => peek().type === 'OP' && peek().value === v;
  const isKw = (v) => peek().type === 'ID' && peek().value === v;
  const skipNewlines = () => { while (peek().type === 'NEWLINE') next(); };

  function program() {
    const body = [];
    skipNewlines();
    while (!isEOF()) { body.push(statement()); skipNewlines(); }
    return { t: 'program', body, lang: 'py' };
  }

  function suite() {
    // ':' の後。改行+INDENT...DEDENT、または同一行の単純文
    if (peek().type === 'NEWLINE') {
      next();
      eat('INDENT');
      const stmts = [];
      while (peek().type !== 'DEDENT' && !isEOF()) { stmts.push(statement()); skipNewlines(); }
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
    const ln = peek().line;
    const kw = kwStmt(true);
    if (kw && peek().type !== 'NEWLINE' && !isEOF()) err(`予期しないトークン '${peek().value ?? peek().type}'`);
    const node = kw || simpleStmt();
    if (node.line == null) node.line = ln;
    return [node];
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
    if (isKw('for')) return forStmt();
    return kwStmt(false) || simpleStmt();
  }
  // BJ6: キーワードの単純文（return〔値あり・なし〕・break・continue・pass・import／from・global〔どちらも pass として読み飛ばす〕）。
  //   該当しなければ null。statementCore（字下げしたブロックの文）と suite の 1 行の分岐が共有する（BJ6 で statementCore から
  //   切り出した。字下げしたブロックの文の AST は是正前と同じ＝出荷サンプルの AST 指紋は wf_bj1_pysem E 章が見張る）。
  //   inline＝1 行の suite: import／from／global の読み飛ばしを `;` の手前で止める（`def f(): global x; x = 1` は是正前と同じ
  //   「予期しないトークン ';'」の構文エラー＝`;` は未対応）。字下げしたブロックでは従来どおり行末まで読み飛ばす（`global x; x = 1` の
  //   `x = 1` は黙って消える＝是正前からの差・BJ6 の範囲外）。
  function kwStmt(inline) {
    if (isKw('return')) { next(); let v = null; if (peek().type !== 'NEWLINE') v = expr(); return { t: 'return', value: v }; }
    if (isKw('break')) { next(); return { t: 'break' }; }
    if (isKw('continue')) { next(); return { t: 'continue' }; }
    if (isKw('pass')) { next(); return { t: 'pass' }; }
    if (isKw('import') || isKw('from') || isKw('global')) {
      while (peek().type !== 'NEWLINE' && !isEOF() && !(inline && isPunc(';'))) next();
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
        err(`複合代入 '${peek().value}' の左辺に複数の変数（a, b のようなタプル）は書けません（1 つずつ代入してください）`);
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

  function flattenTargets(node) {
    if (node && node.t === 'tuple') return node.items;
    return [node];
  }

  // ===== 式 =====
  function expr() { return tupleOrTernary(); }

  function tupleOrTernary() {
    const first = ternary();
    if (isPunc(',')) {
      const items = [first];
      while (isPunc(',')) { next(); if (isPunc('=') || peek().type === 'NEWLINE' || isOp('=')) break; items.push(ternary()); }
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
    const first = additive();
    const rest = [];
    while (peek().type === 'OP' && ['==', '!=', '<', '<=', '>', '>='].includes(peek().value)) {
      const op = next().value; rest.push({ op, right: additive() });
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
      if (isPunc('(')) {
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
  function primary() {
    const t = peek();
    if (t.type === 'NUM') { next(); return { t: 'num', v: t.value }; }
    if (t.type === 'STR') { next(); return { t: 'str', v: t.value }; }
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
    err(`予期しないトークン '${t.value ?? t.type}'`);
  }

  return program();
}
