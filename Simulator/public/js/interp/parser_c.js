// Arduino C++ 風パーサ → 共通 AST。
import { tokenize } from './lexer.js';

// 型語と宣言修飾子。skipType() がまとめて読み飛ばす (この処理系は型を追跡しない)。
// AS4: 修飾子 const/static/volatile/signed と幅つき整数型を追加。配列サイズ定数の定石
//   `const int N = 72;` / `static int buf[8];` が従来は構文エラーだった (実測 C16/C23)。
const TYPES = ['int', 'float', 'double', 'void', 'bool', 'char', 'long', 'short', 'unsigned', 'auto', 'byte', 'uint8_t', 'uint16_t', 'int16_t',
  'const', 'static', 'volatile', 'signed', 'boolean', 'size_t', 'uint32_t', 'int32_t', 'int8_t'];

export function parseC(src) {
  const toks = tokenize(src, 'c');
  let pos = 0;
  const peek = (k = 0) => toks[pos + k];
  const next = () => toks[pos++];
  const isEOF = () => peek().type === 'EOF';

  function err(msg) { throw new Error(`構文エラー(C): ${msg} (行 ${peek().line})`); }
  function eat(type, value) {
    const t = peek();
    if (t.type !== type || (value !== undefined && t.value !== value))
      err(`'${value ?? type}' を期待しましたが '${t.value ?? t.type}'`);
    return next();
  }
  const isPunc = (v) => peek().type === 'PUNC' && peek().value === v;
  const isOp = (v) => peek().type === 'OP' && peek().value === v;
  const isKw = (v) => peek().type === 'ID' && peek().value === v;
  const isType = () => peek().type === 'ID' && TYPES.includes(peek().value);

  function program() {
    const body = [];
    while (!isEOF()) body.push(topLevel());
    return { t: 'program', body, lang: 'c' };
  }

  function topLevel() {
    // 関数定義 or 変数宣言 or 文
    if (isType()) {
      // 先読み: 型語(複数可)とポインタ '*' を読み飛ばした先が  ID '(' なら関数定義。
      // AS4: 従来は 2 トークン固定の先読みだったため `static void loop()` や `unsigned int f()` を
      //   変数宣言と誤判定して構文エラーになっていた (修飾子の追加で顕在化する経路)。
      let k = 0;
      while (peek(k).type === 'ID' && TYPES.includes(peek(k).value)) k++;
      while (peek(k).type === 'OP' && peek(k).value === '*') k++;
      if (peek(k).type === 'ID' && peek(k + 1).type === 'PUNC' && peek(k + 1).value === '(') return funcDef();
      return varDecl();
    }
    return statement();
  }

  function skipType() {
    // 型(複数語) を読み飛ばす。ポインタ '*' も無視。
    while (isType()) next();
    while (isOp('*')) next();
  }

  function funcDef() {
    skipType();
    const name = eat('ID').value;
    eat('PUNC', '(');
    const params = [];
    if (!isPunc(')')) {
      do {
        skipType();
        if (peek().type === 'ID') params.push(next().value);
        // AS4: 配列仮引数 `int a[]` / `int a[N]`。次元は評価せず読み飛ばす＝実引数は JS 配列が
        //   そのまま参照で渡る (C のポインタ減衰 `int *a` と同値。既存の `int *a` 経路と結果一致)。
        while (isPunc('[')) { next(); if (!isPunc(']')) expr(); eat('PUNC', ']'); }
      } while (isPunc(',') && next());
    }
    eat('PUNC', ')');
    const body = block();
    return { t: 'func', name, params, body };
  }

  function block() {
    eat('PUNC', '{');
    const stmts = [];
    while (!isPunc('}') && !isEOF()) stmts.push(statement());
    eat('PUNC', '}');
    return stmts;
  }

  // statement は配列を返さず1ノード。実行行ハイライト用に発生行 (.line) を付与する。
  function statement() {
    const ln = peek().line;
    const node = statementCore();
    if (node && typeof node === 'object' && node.line == null) node.line = ln;
    return node;
  }
  // block を許すため arrayOrStmt を使う箇所あり。
  function statementCore() {
    if (isPunc('{')) return { t: 'block', body: block() };
    if (isType()) { const v = varDecl(); return v; }
    if (isKw('if')) return ifStmt();
    if (isKw('while')) return whileStmt();
    if (isKw('do')) return doWhileStmt();
    if (isKw('switch')) return switchStmt();
    if (isKw('for')) return forStmt();
    if (isKw('return')) { next(); let v = null; if (!isPunc(';')) v = expr(); eat('PUNC', ';'); return { t: 'return', value: v }; }
    if (isKw('break')) { next(); eat('PUNC', ';'); return { t: 'break' }; }
    if (isKw('continue')) { next(); eat('PUNC', ';'); return { t: 'continue' }; }
    if (isPunc(';')) { next(); return { t: 'pass' }; }
    const e = expr(); eat('PUNC', ';'); return { t: 'exprstmt', expr: e };
  }

  function bodyAsArray() {
    // if/while/for の本体: block か単文
    if (isPunc('{')) return block();
    return [statement()];
  }

  // 1 個の宣言子: 名前 + 任意の配列次元 [..] + 任意の初期化子。
  // 例 int a;  int a[3];  int a[] = {1,2,3};  int a[2][2] = {{1,2},{3,4}};
  function declarator() {
    const name = eat('ID').value;
    const dims = [];
    while (isPunc('[')) {
      next();
      let size = null;
      if (!isPunc(']')) size = expr();
      eat('PUNC', ']');
      dims.push(size);
    }
    let init = null;
    if (isOp('=')) { next(); init = initializer(); }
    if (dims.length) return { t: 'var', name, init: { t: 'arraydecl', dims, init } };
    return { t: 'var', name, init };
  }

  // 初期化子: 波括弧リスト {..} か 通常の式。ネスト {..} は 2 次元以上の配列で使う。
  function initializer() {
    if (isPunc('{')) return braceList();
    return assign();
  }
  function braceList() {
    eat('PUNC', '{');
    const items = [];
    if (!isPunc('}')) do {
      if (isPunc('}')) break;              // 末尾カンマ許容
      items.push(initializer());
    } while (isPunc(',') && next());
    eat('PUNC', '}');
    return { t: 'list', items };
  }

  function varDecl() {
    skipType();
    const decls = [];
    do { decls.push(declarator()); } while (isPunc(',') && next());
    eat('PUNC', ';');
    return decls.length === 1 ? decls[0] : { t: 'block', body: decls };
  }

  function ifStmt() {
    eat('ID', 'if'); eat('PUNC', '('); const cond = expr(); eat('PUNC', ')');
    const then = bodyAsArray();
    let els = null;
    if (isKw('else')) {
      next();
      if (isKw('if')) els = [ifStmt()];
      else els = bodyAsArray();
    }
    return { t: 'if', cond, then, els };
  }

  function whileStmt() {
    eat('ID', 'while'); eat('PUNC', '('); const cond = expr(); eat('PUNC', ')');
    return { t: 'while', cond, body: bodyAsArray() };
  }

  function doWhileStmt() {
    eat('ID', 'do');
    const body = bodyAsArray();
    eat('ID', 'while'); eat('PUNC', '('); const cond = expr(); eat('PUNC', ')'); eat('PUNC', ';');
    return { t: 'dowhile', cond, body };
  }

  // switch(x){ case k: ...; break; ... default: ... }。case のフォールスルーは評価器が担う。
  function switchStmt() {
    eat('ID', 'switch'); eat('PUNC', '('); const disc = expr(); eat('PUNC', ')');
    eat('PUNC', '{');
    const cases = [];
    while (!isPunc('}') && !isEOF()) {
      let test = null;
      if (isKw('case')) { next(); test = expr(); eat('PUNC', ':'); }
      else if (isKw('default')) { next(); eat('PUNC', ':'); }
      else err(`case か default を期待しましたが '${peek().value ?? peek().type}'`);
      const body = [];
      while (!isKw('case') && !isKw('default') && !isPunc('}') && !isEOF()) body.push(statement());
      cases.push({ test, body });
    }
    eat('PUNC', '}');
    return { t: 'switch', disc, cases };
  }

  function forStmt() {
    eat('ID', 'for'); eat('PUNC', '(');
    let init = null;
    if (!isPunc(';')) {
      if (isType()) init = varDeclNoSemi();
      else init = { t: 'exprstmt', expr: expr() };
    }
    eat('PUNC', ';');
    let cond = null; if (!isPunc(';')) cond = expr(); eat('PUNC', ';');
    let update = null; if (!isPunc(')')) update = { t: 'exprstmt', expr: expr() };
    eat('PUNC', ')');
    return { t: 'for', init, cond, update, body: bodyAsArray() };
  }

  function varDeclNoSemi() {
    skipType();
    return declarator();
  }

  // ===== 式 =====
  function expr() { return assign(); }

  function assign() {
    const left = ternary();
    if (peek().type === 'OP' && ['=', '+=', '-=', '*=', '/=', '&=', '|=', '^=', '<<=', '>>='].includes(peek().value)) {
      const op = next().value;
      const value = assign();
      return { t: 'assignexpr', target: left, op, value };
    }
    return left;
  }

  function ternary() {
    let c = logicOr();
    if (isOp('?')) { next(); const a = assign(); eat('PUNC', ':'); const b = assign(); return { t: 'ternary', cond: c, a, b }; }
    return c;
  }

  function binL(sub, ops) {
    let a = sub();
    while (peek().type === 'OP' && ops.includes(peek().value)) {
      const op = next().value; const b = sub(); a = { t: 'bin', op, a, b };
    }
    return a;
  }
  // C の演算子優先順位 (高→低): 単項 > *·/·% > +·- > <<·>> > 関係 > 等価 > & > ^ > | > && > ||
  const logicOr = () => binL(logicAnd, ['||']);
  const logicAnd = () => binL(bitOr, ['&&']);
  const bitOr = () => binL(bitXor, ['|']);
  const bitXor = () => binL(bitAnd, ['^']);
  const bitAnd = () => binL(equality, ['&']);
  const equality = () => binL(relational, ['==', '!=']);
  const relational = () => binL(shift, ['<', '<=', '>', '>=']);
  const shift = () => binL(additive, ['<<', '>>']);
  const additive = () => binL(multiplicative, ['+', '-']);
  const multiplicative = () => binL(unary, ['*', '/', '%']);

  function unary() {
    // AS4: sizeof。`sizeof(式)` / `sizeof(型名)` / `sizeof 式` の3形を受ける。
    //   型名は要素1個ぶんとして畳む (この処理系は型を追跡しないため。意味論は evaluator の
    //   'sizeof' ＝葉要素の総数モデル。実機のバイト数との差は docs/仕様欄に明記=利用者裁定)。
    if (isKw('sizeof')) {
      next();
      if (isPunc('(')) {
        next();
        let a;
        if (isType()) { skipType(); a = { t: 'num', v: 1 }; }
        else a = expr();
        eat('PUNC', ')');
        return { t: 'sizeof', a };
      }
      return { t: 'sizeof', a: unary() };
    }
    if (isOp('!') || isOp('-') || isOp('+') || isOp('~')) { const op = next().value; return { t: 'un', op, a: unary() }; }
    if (isOp('++') || isOp('--')) { const op = next().value; const a = unary(); return { t: 'preincr', op, a }; }
    return postfix();
  }

  function postfix() {
    let e = primary();
    for (;;) {
      if (isPunc('(')) {
        next(); const args = [];
        if (!isPunc(')')) do { args.push(assign()); } while (isPunc(',') && next());
        eat('PUNC', ')'); e = { t: 'call', callee: e, args };
      } else if (isPunc('.')) {
        next(); const name = eat('ID').value; e = { t: 'member', obj: e, name };
      } else if (isPunc('[')) {
        next(); const idx = expr(); eat('PUNC', ']'); e = { t: 'index', obj: e, idx };
      } else if (isOp('++') || isOp('--')) {
        const op = next().value; e = { t: 'postincr', op, a: e };
      } else break;
    }
    return e;
  }

  function primary() {
    const t = peek();
    if (t.type === 'NUM') { next(); return { t: 'num', v: t.value }; }
    if (t.type === 'STR') { next(); return { t: 'str', v: t.value }; }
    if (t.type === 'ID') {
      if (t.value === 'true') { next(); return { t: 'bool', v: true }; }
      if (t.value === 'false') { next(); return { t: 'bool', v: false }; }
      next(); return { t: 'var', name: t.value };
    }
    if (isPunc('(')) { next(); const e = expr(); eat('PUNC', ')'); return e; }
    err(`予期しないトークン '${t.value ?? t.type}'`);
  }

  return program();
}
