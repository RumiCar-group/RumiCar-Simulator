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
    return [simpleStmt()];
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
    if (isKw('return')) { next(); let v = null; if (peek().type !== 'NEWLINE') v = expr(); return { t: 'return', value: v }; }
    if (isKw('break')) { next(); return { t: 'break' }; }
    if (isKw('continue')) { next(); return { t: 'continue' }; }
    if (isKw('pass')) { next(); return { t: 'pass' }; }
    if (isKw('import') || isKw('from')) { while (peek().type !== 'NEWLINE' && !isEOF()) next(); return { t: 'pass' }; }
    if (isKw('global')) { while (peek().type !== 'NEWLINE' && !isEOF()) next(); return { t: 'pass' }; }
    return simpleStmt();
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
      const a = expr(); let start = { t: 'num', v: 0 }, end = a, step = { t: 'num', v: 1 };
      if (isPunc(',')) { next(); start = a; end = expr(); if (isPunc(',')) { next(); step = expr(); } }
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
    if (isOp('=') || (peek().type === 'OP' && ['+=', '-=', '*=', '/='].includes(peek().value))) {
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
  function multiplicative() {
    let a = power();
    while (peek().type === 'OP' && ['*', '/', '%', '//'].includes(peek().value)) { const op = next().value; a = { t: 'bin', op, a, b: power() }; }
    return a;
  }
  function power() {
    let a = unary();
    if (isOp('**')) { next(); return { t: 'bin', op: '**', a, b: power() }; }
    return a;
  }
  function unary() {
    if (isOp('-') || isOp('+')) { const op = next().value; return { t: 'un', op, a: unary() }; }
    return postfix();
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
