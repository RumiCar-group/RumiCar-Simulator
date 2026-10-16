// Arduino C++ 風パーサ → 共通 AST。
import { tokenize, SourceError } from './lexer.js';

// 型語と宣言修飾子。skipType() がまとめて読み飛ばす (この処理系は型を追跡しない)。
// AS4: 修飾子 const/static/volatile/signed と幅つき整数型を追加。配列サイズ定数の定石
//   `const int N = 72;` / `static int buf[8];` が従来は構文エラーだった (実測 C16/C23)。
//   BK5: `static` は保持する（skipType が型語の列に static があったかを返し、varDecl が各宣言子の var の節に static: true を付ける＝評価器が
//   最初の 1 回だけ初期化する）。static の無い宣言の AST は是正前と同じ形（static の印を付けない）。
const TYPES = ['int', 'float', 'double', 'void', 'bool', 'char', 'long', 'short', 'unsigned', 'auto', 'byte', 'uint8_t', 'uint16_t', 'int16_t',
  'const', 'static', 'volatile', 'signed', 'boolean', 'size_t', 'uint32_t', 'int32_t', 'int8_t'];
// BK5: キャスト `(型名)式` の変換の種類（evaluator の 'cast'）。float／double を含めば 'float'（数にする）・bool／boolean は 'bool'（C の真偽）・
//   void／auto・ポインタ（`*` を含む）は 'none'（値をそのまま）・unsigned の付かない char は 'char'（この処理系の char は 1 文字の文字列＝文字は
//   そのまま・数は 'int' と同じ）・それ以外の整数型（int・long・short・unsigned・signed・unsigned char・byte・size_t・uintN_t・intN_t・修飾子だけ）は
//   'int'（0 方向への切り捨て）。BK5 層4 F2: 'int'／'float'／'bool' は 1 文字の文字列（char の値）を文字コードにしてから変換する（evaluator）。
function castKind(words, ptr) {
  if (ptr) return 'none';
  if (words.includes('float') || words.includes('double')) return 'float';
  if (words.includes('bool') || words.includes('boolean')) return 'bool';
  if (words.includes('void') || words.includes('auto')) return 'none';
  if (words.includes('char') && !words.includes('unsigned')) return 'char';
  return 'int';
}

export function parseC(src) {
  const toks = tokenize(src, 'c');
  let pos = 0;
  // BK5 層4 往復 2 F1: 先読みは EOF で止める（末尾より先を読んでも最後の EOF のトークンを返す）。7165160 のキャストの先読みが現在のトークンの
  //   確認より前に peek(1) を読み、式の途中でファイルが終わる本文（`int y =`・`x = 1 +`・`if (` ほか）が行番号も i18n キーも無い JS の TypeError
  //   「Cannot read properties of undefined (reading 'type')」になっていた（8ecdfd9 は interp.syn.unexpected「予期しないトークン 'EOF'」＝wf_bk1_interp2 J-10）。
  const peek = (k = 0) => toks[Math.min(pos + k, toks.length - 1)];
  const next = () => toks[pos++];
  const isEOF = () => peek().type === 'EOF';

  // BK1: 構文エラーは i18n キー＋行番号（SourceError・lexer.js）。sub＝interp.syn.<sub>・行＝読めなかったトークンの行（是正前と同じ）。
  //   是正前は素の Error に「構文エラー(C): <文言> (行 N)」の日本語固定文を載せていた（ja の文言は 1 文字も変えない）。
  function err(sub, params) { throw new SourceError('syn', sub, params, peek().line, 'c'); }
  function eat(type, value) {
    const t = peek();
    if (t.type !== type || (value !== undefined && t.value !== value))
      err('expected', { want: value ?? type, got: t.value ?? t.type });
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
    // 型(複数語) を読み飛ばす。ポインタ '*' も無視。BK5: 型語の列に static があれば true（varDecl が使う）。
    let st = false;
    while (isType()) { if (next().value === 'static') st = true; }
    while (isOp('*')) next();
    return st;
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
        //   BK5 層4 F4: 次元は assign（カンマ演算子を受けない＝`int a[2, 3]` は gcc と同じく構文エラー・是正前と同じ）。
        while (isPunc('[')) { next(); if (!isPunc(']')) assign(); eat('PUNC', ']'); }
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
  // BK5 層4 F4: 次元は assign（カンマ演算子を受けない＝`int a[2, 3];` は gcc と同じく構文エラー・是正前と同じ）。
  function declarator() {
    const name = eat('ID').value;
    const dims = [];
    while (isPunc('[')) {
      next();
      let size = null;
      if (!isPunc(']')) size = assign();
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

  // BK5: `static int n = 0;` は各宣言子の var の節に static: true（評価器が最初の 1 回だけ初期化して値を保持する）。
  function varDecl() {
    const st = skipType();
    const decls = [];
    do { const d = declarator(); if (st) d.static = true; decls.push(d); } while (isPunc(',') && next());
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
    // BL7 fix1（層4 F3）: condLine＝`} while (…);` の while の行（評価器が条件をこの行で評価する＝条件のエラーの行）。
    const condLine = peek().line;
    eat('ID', 'while'); eat('PUNC', '('); const cond = expr(); eat('PUNC', ')'); eat('PUNC', ';');
    return { t: 'dowhile', cond, body, condLine };
  }

  // switch(x){ case k: ...; break; ... default: ... }。case のフォールスルーは評価器が担う。
  // BK5 層4 F4: case の値は assign（カンマ演算子を受けない＝`case 1, 2:` は gcc と同じく構文エラー・是正前と同じ）。
  function switchStmt() {
    eat('ID', 'switch'); eat('PUNC', '('); const disc = expr(); eat('PUNC', ')');
    eat('PUNC', '{');
    const cases = [];
    while (!isPunc('}') && !isEOF()) {
      let test = null;
      if (isKw('case')) { next(); test = assign(); eat('PUNC', ':'); }
      else if (isKw('default')) { next(); eat('PUNC', ':'); }
      else err('caseDefault', { got: peek().value ?? peek().type });
      const body = [];
      while (!isKw('case') && !isKw('default') && !isPunc('}') && !isEOF()) body.push(statement());
      cases.push({ test, body });
    }
    eat('PUNC', '}');
    return { t: 'switch', disc, cases };
  }

  // BK5: 初期化部の宣言は複数の宣言子（`for (int i = 0, j = 0; …)`＝varDeclNoSemi）・初期化部と更新部の式はカンマ演算子（expr の 'seq'）。
  //   是正前は宣言子 1 個だけで `int i = 0, j = 0` が「';' を期待しましたが ','」・更新部の `i++, j += 2` も同じ構文エラー。
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

  // BK5: 宣言子が 1 個なら是正前と同じ var の節・2 個以上なら block（文の位置の varDecl と同じ形。評価器の block はスコープを作らない＝
  //   for のスコープ fs に全部置かれる）。for の初期化部の static は印を付けない（C でも for の宣言に static は書けない）。
  function varDeclNoSemi() {
    skipType();
    const decls = [];
    do { decls.push(declarator()); } while (isPunc(',') && next());
    return decls.length === 1 ? decls[0] : { t: 'block', body: decls };
  }

  // ===== 式 =====
  // BK5: カンマ演算子（C の式の最も低い優先順位）。`a, b` は左から評価して右の値（'seq'）。カンマ 1 個も無ければ是正前と同じ節（assign）。
  //   関数の引数・初期化子（`int a = 1, b = 2;`・`{1, 2}`）は assign を直接読む＝そこでのカンマは従来どおり区切り。BK5 層4 F4: case の値・
  //   配列の次元・三項の `:` の後ろも assign（`case 1, 2:`・`int a[2, 3];` は gcc と同じく構文エラー＝是正前と同じ）。三項の `?` と `:` の間は
  //   expr（C の文法どおりカンマ演算子を受ける＝`1 ? 2, 3 : 4` は 3・gcc と同じ。是正前は構文エラー「':' を期待しましたが ','」）。
  //   是正前は式の位置のカンマが構文エラー（for の更新部 `i++, j += 2`・文 `a = 1, b = 2;`）。
  function expr() {
    const first = assign();
    if (!isPunc(',')) return first;
    const items = [first];
    while (isPunc(',')) { next(); items.push(assign()); }
    return { t: 'seq', items };
  }

  // BK5: `%=` を足した（C の % は切り捨て剰余＝applyBin の C の分岐。是正前は構文エラー「';' を期待しましたが '%='」）。
  function assign() {
    const left = ternary();
    if (peek().type === 'OP' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(peek().value)) {
      const op = next().value;
      const value = assign();
      return { t: 'assignexpr', target: left, op, value };
    }
    return left;
  }

  function ternary() {
    let c = logicOr();
    if (isOp('?')) { next(); const a = expr(); eat('PUNC', ':'); const b = assign(); return { t: 'ternary', cond: c, a, b }; }
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

  // BK5: 現在のトークンが `(` で、その後ろが型語の列（1 語以上）と `*` の列で、その直後が `)` か（キャスト `(int)x`）。読み進めない（先読みだけ）。
  function typeParenAhead() {
    if (!isPunc('(')) return false;
    let ck = 1;
    while (peek(ck).type === 'ID' && TYPES.includes(peek(ck).value)) ck++;
    if (ck === 1) return false;
    while (peek(ck).type === 'OP' && peek(ck).value === '*') ck++;
    return peek(ck).type === 'PUNC' && peek(ck).value === ')';
  }

  function unary() {
    // AS4: sizeof。`sizeof(式)` / `sizeof(型名)` / `sizeof 式` の3形を受ける。
    //   型名は要素1個ぶんとして畳む (この処理系は型を追跡しないため。意味論は evaluator の
    //   'sizeof' ＝葉要素の総数モデル。実機のバイト数との差は docs/仕様欄に明記=利用者裁定)。
    if (isKw('sizeof')) {
      next();
      if (isPunc('(')) {
        // BK5 層4 往復 2 F4: 型語の列の直後が `(` なら関数形式の型変換で始まる式（`sizeof(int(x))`・`sizeof(int(x) + 1)`＝g++ と同じ）。
        //   是正前（8ecdfd9 まで）は `(` の次が型語というだけで型名と決めて「')' を期待しましたが '('」だった。それ以外の型語で始まる中身は従来どおり
        //   型名（`sizeof(int[3])` は是正前と同じ「')' を期待しましたが '['」＝式として読むと名前 int の添字になり黙って 1 を返すので、キャストの
        //   typeParenAhead〔`)` で閉じるときだけ〕と同じ規則にはしない）。
        let ck = 1;
        while (peek(ck).type === 'ID' && TYPES.includes(peek(ck).value)) ck++;
        const tn = ck > 1 && !(peek(ck).type === 'PUNC' && peek(ck).value === '(');
        next();
        let a;
        if (tn) { skipType(); a = { t: 'num', v: 1 }; }
        else a = expr();
        eat('PUNC', ')');
        return { t: 'sizeof', a };
      }
      return { t: 'sizeof', a: unary() };
    }
    // BK5: キャスト `(型名)式`（`(int)x`・`(unsigned long)t`・`(float)7 / 2`＝キャストが先・`(int*)p`）。`(` の後ろが型語の列（と `*`）で、
    //   その直後が `)` のときだけ＝型語でない `(x)` の括弧式は不変。被演算子は単項（`(int)-3.7`）。変換は castKind（evaluator の 'cast'）。
    //   是正前は `(int)x` が「';' を期待しましたが 'x'」。BK5 層4 F1: `)` で閉じるかを先読みする（`(int(x) + 1)`・`(float(7) / 2)`・`(bool(0))` は
    //   括弧の中が関数形式の型変換＝括弧式。0fbea4d は `(` の次が型語というだけでキャストと決めて「')' を期待しましたが '('」にしていた）。
    //   BK5 層4 往復 2 F1: 先読みは現在のトークンが `(` のときだけ（typeParenAhead）・peek は EOF で止まる。
    if (typeParenAhead()) {
      next();
      const words = [];
      while (isType()) words.push(next().value);
      let ptr = false;
      while (isOp('*')) { next(); ptr = true; }
      eat('PUNC', ')');
      return { t: 'cast', to: castKind(words, ptr), a: unary() };
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
    err('unexpected', { tok: t.value ?? t.type });
  }

  return program();
}
