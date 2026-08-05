// 共通 AST の木探索インタープリタ。Arduino C 風 / Python 風 共通。
import { SIM } from '../config.js';
import { t } from '../i18n.js';

class ReturnSignal { constructor(v) { this.v = v; } }
class BreakSignal {}
class ContinueSignal {}

// AP17: 実行時エラーを i18n キー (interp.err.<sub>) ＋発生行つきで表す。
//   message は throw 時点の言語で翻訳済み＝表示層 (fleet/main/race) は従来どおり e.message を使う。
//   line は直近に実行した文の行 (execStmt が curLine を更新)。行があれば ` (行 N)` / ` (line N)` を付す。
//   ※ `t('interp.err.' + sub, …)` の動的キーは wf_i18n_check の接頭辞機構で参照済み扱いになる (孤児誤検知回避)。
export class RuntimeError extends Error {
  constructor(sub, params, line) {
    let msg = t('interp.err.' + sub, params || {});
    if (line) msg += t('interp.err.line', { n: line });
    super(msg);
    this.i18nKey = 'interp.err.' + sub;
    this.i18nParams = params || {};
    this.line = line || 0;
  }
}
// ステップ上限 (無限ループ検出) も行番号つき実行時エラーの一種。
export class StepLimit extends RuntimeError {
  constructor(line) { super('stepLimit', {}, line); }
}

export class Interp {
  constructor(hostEnv) {
    this.host = hostEnv;          // 定数・API・センサーオブジェクト
    this.funcs = Object.create(null);
    this.global = { vars: Object.create(null), parent: null };
    this.steps = 0;
    this.curLine = 0;   // 直近に実行した文の行 (実行位置ハイライト用)
  }

  load(ast) {
    this.lang = ast.lang || 'c';   // AP16: 言語別意味論 (py 負index 等) の分岐に使う
    this.topStmts = [];
    for (const s of ast.body) {
      if (s.t === 'func') this.funcs[s.name] = s;
      else this.topStmts.push(s);
    }
  }

  resetSteps() { this.steps = 0; }
  tick() { if (++this.steps > SIM.maxStepsPerTick) throw new StepLimit(this.curLine); }

  has(name) { return !!this.funcs[name]; }

  // AP17: 実行時エラー生成ヘルパ (直近実行文の行 curLine を付与)。sub=interp.err.<sub> の短名。
  rt(sub, params) { return new RuntimeError(sub, params, this.curLine); }

  // 関数呼び出し (ユーザー定義)。fresh ローカルスコープ。
  callUser(name, args) {
    const fn = this.funcs[name];
    const scope = { vars: Object.create(null), parent: this.global };
    (fn.params || []).forEach((p, i) => { scope.vars[p] = args[i]; });
    try { this.execBlock(fn.body, scope); }
    catch (e) { if (e instanceof ReturnSignal) return e.v; throw e; }
    return undefined;
  }

  // ===== スコープ =====
  getVar(scope, name) {
    for (let s = scope; s; s = s.parent) if (name in s.vars) return s.vars[name];
    if (name in this.host) return this.host[name];
    throw this.rt('undefName', { name });
  }
  setVar(scope, name, val) {
    for (let s = scope; s; s = s.parent) if (name in s.vars) { s.vars[name] = val; return; }
    scope.vars[name] = val; // 見つからなければ現在スコープに定義
  }

  // ===== 文 =====
  execBlock(stmts, scope) { for (const s of stmts) this.execStmt(s, scope); }

  execStmt(node, scope) {
    this.tick();
    if (node.line) this.curLine = node.line;
    switch (node.t) {
      case 'pass': return;
      case 'block': return this.execBlock(node.body, scope);
      case 'var': { const v = node.init ? this.evalExpr(node.init, scope) : 0; scope.vars[node.name] = v; return; }
      case 'exprstmt': this.evalExpr(node.expr, scope); return;
      case 'massign': return this.execMassign(node, scope);
      case 'return': throw new ReturnSignal(node.value ? this.evalExpr(node.value, scope) : undefined);
      case 'break': throw new BreakSignal();
      case 'continue': throw new ContinueSignal();
      case 'if': {
        if (truthy(this.evalExpr(node.cond, scope))) this.execBlock(node.then, scope);
        else if (node.els) this.execBlock(node.els, scope);
        return;
      }
      case 'while': {
        while (truthy(this.evalExpr(node.cond, scope))) {
          this.tick();
          try { this.execBlock(node.body, scope); }
          catch (e) { if (e instanceof BreakSignal) break; if (e instanceof ContinueSignal) continue; throw e; }
        }
        return;
      }
      case 'dowhile': {
        do {
          this.tick();
          try { this.execBlock(node.body, scope); }
          catch (e) { if (e instanceof BreakSignal) break; if (e instanceof ContinueSignal) continue; throw e; }
        } while (truthy(this.evalExpr(node.cond, scope)));
        return;
      }
      case 'switch': {
        const d = this.evalExpr(node.disc, scope);
        // 一致 case を探し、無ければ default。C のフォールスルー: 一致位置から break まで連続実行。
        let start = -1, def = -1;
        for (let k = 0; k < node.cases.length; k++) {
          const c = node.cases[k];
          if (c.test === null) { def = k; continue; }
          if (this.evalExpr(c.test, scope) === d) { start = k; break; }
        }
        if (start === -1) start = def;
        if (start === -1) return;
        try { for (let k = start; k < node.cases.length; k++) this.execBlock(node.cases[k].body, scope); }
        catch (e) { if (e instanceof BreakSignal) return; throw e; }
        return;
      }
      case 'for': {
        const fs = { vars: Object.create(null), parent: scope };
        if (node.init) this.execStmt(node.init, fs);
        while (node.cond ? truthy(this.evalExpr(node.cond, fs)) : true) {
          this.tick();
          try { this.execBlock(node.body, fs); }
          catch (e) { if (e instanceof BreakSignal) break; if (e instanceof ContinueSignal) {} else throw e; }
          if (node.update) this.execStmt(node.update, fs);
        }
        return;
      }
      case 'forrange': {
        const fs = { vars: Object.create(null), parent: scope };
        let i = this.evalExpr(node.start, fs);
        const end = this.evalExpr(node.end, fs);
        const step = this.evalExpr(node.step, fs);
        fs.vars[node.var] = i;
        while (step > 0 ? i < end : i > end) {
          this.tick();
          fs.vars[node.var] = i;
          try { this.execBlock(node.body, fs); }
          catch (e) { if (e instanceof BreakSignal) break; if (e instanceof ContinueSignal) {} else throw e; }
          i += step;
        }
        return;
      }
      case 'forin': {
        // AP9: list はその要素、str は各文字、dict はキーを走査 (Python 意味論)。
        const fs = { vars: Object.create(null), parent: scope };
        const it = this.evalExpr(node.iter, fs);
        let seq;
        if (Array.isArray(it)) seq = it;
        else if (typeof it === 'string') seq = it.split('');
        else if (it && typeof it === 'object') seq = Object.keys(it);
        else throw this.rt('notIterable');
        for (let k = 0; k < seq.length; k++) {
          this.tick();
          fs.vars[node.var] = seq[k];
          try { this.execBlock(node.body, fs); }
          catch (e) { if (e instanceof BreakSignal) break; if (e instanceof ContinueSignal) {} else throw e; }
        }
        return;
      }
      default: throw this.rt('badStmt', { t: node.t });
    }
  }

  execMassign(node, scope) {
    const { targets, values, op } = node;
    if (op !== '=') {
      // 複合代入 (単一ターゲット)
      const tgt = targets[0];
      const cur = this.evalExpr(tgt, scope);
      const rhs = this.evalExpr(values[0], scope);
      const v = applyBin(op.slice(0, -1), cur, rhs, this.curLine);
      this.assignTo(tgt, v, scope); return;
    }
    let vals;
    if (targets.length === values.length) vals = values.map(v => this.evalExpr(v, scope));
    else if (values.length === 1) {
      const r = this.evalExpr(values[0], scope);
      vals = Array.isArray(r) ? r : [r];
    } else vals = values.map(v => this.evalExpr(v, scope));
    targets.forEach((tgt, i) => this.assignTo(tgt, vals[i], scope));
  }

  assignTo(tgt, val, scope) {
    if (tgt.t === 'var') this.setVar(scope, tgt.name, val);
    else if (tgt.t === 'member') { const o = this.evalExpr(tgt.obj, scope); o[tgt.name] = val; }
    else if (tgt.t === 'index') { const o = this.evalExpr(tgt.obj, scope); o[this.pyIndex(o, this.evalExpr(tgt.idx, scope))] = val; }
    else throw this.rt('badAssign');
  }

  // AP16: Python の負インデックス (a[-1] → 末尾)。py のみ・list/str に適用 (C は無改変=従来どおり)。
  pyIndex(o, k) {
    if (this.lang === 'py' && typeof k === 'number' && k < 0 && (Array.isArray(o) || typeof o === 'string')) return o.length + k;
    return k;
  }

  // C 配列宣言の実体化。dims=各次元サイズ式 (null=初期化子から推定)、initVal=波括弧初期化子の評価済み値。
  // 宣言サイズに満たない要素は 0 埋め (C セマンティクス)。多次元は再帰。
  shapeArray(dims, depth, initVal, scope) {
    // AS4: `char s[] = "ab";` は従来「長さ0の配列」を黙って作り s[0] が空になっていた
    //   (エラーが出ない罠＝AP16 が潰したサイレント意味論乖離と同型)。文字列からの配列初期化は
    //   未対応であることを行番号付き実行時エラーで告げる (サイレント截断の禁止)。
    if (typeof initVal === 'string') throw this.rt('strArrayInit', {});
    const sizeNode = dims[depth];
    let len = sizeNode != null ? Math.floor(this.evalExpr(sizeNode, scope)) : 0;
    if (!(len > 0)) len = Array.isArray(initVal) ? initVal.length : 0;
    const isLast = depth >= dims.length - 1;
    const arr = new Array(len);
    for (let k = 0; k < len; k++) {
      const iv = Array.isArray(initVal) ? initVal[k] : undefined;
      arr[k] = isLast ? (iv !== undefined ? iv : 0) : this.shapeArray(dims, depth + 1, iv, scope);
    }
    return arr;
  }

  // AS4: sizeof の値。配列は**葉要素の総数**・スカラー(および型名)は 1 とする要素数モデル。
  //   これにより Arduino の定石 `sizeof(a)/sizeof(a[0])` が 1 次元 (4/1=4) でも 2 次元
  //   (m[2][3] → 6/3=2 行) でも正しく要素数になる。実機はバイト数を返すが、実機 Arduino でも
  //   `sizeof(int)` は AVR=2 / ESP32=4 とボード依存でバイト意味論は一意でない (利用者裁定
  //   2026-08-04: 要素数モデルを採り、実機との差は docs/physics_model と仕様欄に明記する)。
  sizeOfVal(v) { return Array.isArray(v) ? v.reduce((s, e) => s + this.sizeOfVal(e), 0) : 1; }

  // ===== 式 =====
  evalExpr(node, scope) {
    switch (node.t) {
      case 'num': return node.v;
      case 'str': return node.v;
      case 'bool': return node.v;
      case 'var': return this.getVar(scope, node.name);
      case 'list': return node.items.map(e => this.evalExpr(e, scope));
      case 'tuple': return node.items.map(e => this.evalExpr(e, scope));
      case 'dict': {
        // AP9: 素の辞書 (プロトタイプ無し) — index 読み書き `d[k]` と反復キー列挙に使う。
        const o = Object.create(null);
        for (const en of node.entries) o[this.evalExpr(en.key, scope)] = this.evalExpr(en.value, scope);
        return o;
      }
      case 'bin': {
        const op = node.op;
        if (op === '&&') return truthy(this.evalExpr(node.a, scope)) ? this.evalExpr(node.b, scope) : false;
        if (op === '||') { const a = this.evalExpr(node.a, scope); return truthy(a) ? a : this.evalExpr(node.b, scope); }
        return applyBin(op, this.evalExpr(node.a, scope), this.evalExpr(node.b, scope), this.curLine);
      }
      case 'compare': {
        // AP16: Python 連鎖比較 (a<b<c = (a<b) and (b<c)・中間 b は1回評価・短絡)。
        let left = this.evalExpr(node.first, scope);
        for (const seg of node.rest) {
          const right = this.evalExpr(seg.right, scope);
          if (!applyBin(seg.op, left, right, this.curLine)) return false;
          left = right;
        }
        return true;
      }
      case 'un': {
        const a = this.evalExpr(node.a, scope);
        if (node.op === '-') return -a; if (node.op === '+') return +a; if (node.op === '!') return !truthy(a);
        if (node.op === '~') return ~a;
        return a;
      }
      case 'arraydecl': return this.shapeArray(node.dims, 0, node.init ? this.evalExpr(node.init, scope) : null, scope);
      case 'sizeof': return this.sizeOfVal(this.evalExpr(node.a, scope));
      case 'ternary': return truthy(this.evalExpr(node.cond, scope)) ? this.evalExpr(node.a, scope) : this.evalExpr(node.b, scope);
      case 'assignexpr': {
        let v;
        if (node.op === '=') v = this.evalExpr(node.value, scope);
        else { const cur = this.evalExpr(node.target, scope); v = applyBin(node.op.slice(0, -1), cur, this.evalExpr(node.value, scope), this.curLine); }
        this.assignTo(node.target, v, scope); return v;
      }
      case 'preincr': { const cur = this.evalExpr(node.a, scope); const v = node.op === '++' ? cur + 1 : cur - 1; this.assignTo(node.a, v, scope); return v; }
      case 'postincr': { const cur = this.evalExpr(node.a, scope); const v = node.op === '++' ? cur + 1 : cur - 1; this.assignTo(node.a, v, scope); return cur; }
      case 'member': { const o = this.evalExpr(node.obj, scope); return o == null ? undefined : o[node.name]; }
      case 'index': { const o = this.evalExpr(node.obj, scope); return o[this.pyIndex(o, this.evalExpr(node.idx, scope))]; }
      case 'call': return this.evalCall(node, scope);
      default: throw this.rt('badExpr', { t: node.t });
    }
  }

  evalCall(node, scope) {
    this.tick();
    const args = node.args.map(a => this.evalExpr(a, scope));
    const callee = node.callee;
    if (callee.t === 'member') {
      const obj = this.evalExpr(callee.obj, scope);
      // AP9: str/list/dict の Python メソッドを JS ネイティブより優先 (.replace/.sort 等の意味論差を吸収)。
      const pm = pyMethod(obj, callee.name);
      if (pm) return pm(...args);
      // ホストオブジェクト (Serial/math/sensor/time/random) と dict 値の関数はネイティブ経路。
      const fn = obj == null ? undefined : obj[callee.name];
      if (typeof fn !== 'function') throw this.rt('notMethod', { name: callee.name });
      return fn.apply(obj, args);
    }
    if (callee.t === 'var') {
      const name = callee.name;
      if (this.funcs[name]) return this.callUser(name, args);
      if (name in this.host && typeof this.host[name] === 'function') return this.host[name](...args);
      throw this.rt('undefFunc', { name });
    }
    const fn = this.evalExpr(callee, scope);
    if (typeof fn !== 'function') throw this.rt('notCallable');
    return fn(...args);
  }
}

function truthy(v) { return !(v === 0 || v === false || v === '' || v == null); }

// ===== AP9: Python 組込メソッド (str / list / dict) =====
// 各テーブルは `(受け手) => (...引数) => 結果` のファクトリ。pyMethod が受け手を束縛して返す。
function trimChars(s, chars, left, right) {
  const set = new Set(String(chars).split(''));
  let a = 0, b = s.length;
  if (left) while (a < b && set.has(s[a])) a++;
  if (right) while (b > a && set.has(s[b - 1])) b--;
  return s.slice(a, b);
}
function pyFormat(tpl, args) {
  let idx = 0;
  // `{}` は順番・`{n}` は位置指定。`:書式指定` は簡易のため無視して素の str 化。
  return String(tpl).replace(/\{(\d*)(?::[^}]*)?\}/g, (_m, n) => String(args[n === '' ? idx++ : Number(n)]));
}
const STR_METHODS = {
  upper: (s) => () => s.toUpperCase(),
  lower: (s) => () => s.toLowerCase(),
  strip: (s) => (c) => c == null ? s.trim() : trimChars(s, c, true, true),
  lstrip: (s) => (c) => c == null ? s.replace(/^\s+/, '') : trimChars(s, c, true, false),
  rstrip: (s) => (c) => c == null ? s.replace(/\s+$/, '') : trimChars(s, c, false, true),
  replace: (s) => (a, b) => s.split(String(a)).join(String(b)),
  split: (s) => (sep) => sep == null ? s.trim().split(/\s+/).filter((x) => x !== '') : s.split(String(sep)),
  startswith: (s) => (p) => s.startsWith(String(p)),
  endswith: (s) => (p) => s.endsWith(String(p)),
  find: (s) => (x) => s.indexOf(String(x)),
  count: (s) => (x) => { const t = String(x); return t === '' ? s.length + 1 : s.split(t).length - 1; },
  format: (s) => (...a) => pyFormat(s, a),
  join: (s) => (arr) => (Array.isArray(arr) ? arr : [arr]).map(String).join(s),
};
const LIST_METHODS = {
  append: (a) => (x) => { a.push(x); },
  pop: (a) => (i) => (i == null ? a.pop() : a.splice(i, 1)[0]),
  insert: (a) => (i, x) => { a.splice(i, 0, x); },
  remove: (a) => (x) => { const k = a.indexOf(x); if (k >= 0) a.splice(k, 1); },
  index: (a) => (x) => a.indexOf(x),
  count: (a) => (x) => a.reduce((c, e) => c + (e === x ? 1 : 0), 0),
  extend: (a) => (o) => { for (const e of (Array.isArray(o) ? o : [])) a.push(e); },
  sort: (a) => () => { a.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)); },
  reverse: (a) => () => { a.reverse(); },
  clear: (a) => () => { a.length = 0; },
  copy: (a) => () => a.slice(),
};
const DICT_METHODS = {
  get: (o) => (k, d) => (k in o ? o[k] : (d === undefined ? null : d)),
  keys: (o) => () => Object.keys(o),
  values: (o) => () => Object.keys(o).map((k) => o[k]),
  items: (o) => () => Object.keys(o).map((k) => [k, o[k]]),
  pop: (o) => (k, d) => { if (k in o) { const v = o[k]; delete o[k]; return v; } return d === undefined ? null : d; },
  clear: (o) => () => { for (const k of Object.keys(o)) delete o[k]; },
};
// 受け手の型に応じた Python メソッドを返す (無ければ null → 呼び出し側がネイティブ経路へ)。
function pyMethod(obj, name) {
  if (typeof obj === 'string') { const f = STR_METHODS[name]; return f ? f(obj) : null; }
  if (Array.isArray(obj)) { const f = LIST_METHODS[name]; return f ? f(obj) : null; }
  if (obj && typeof obj === 'object') { const f = DICT_METHODS[name]; return f ? f(obj) : null; }
  return null;
}

// AP16: Python 風の printf フォーマット ("x=%d"%5 → "x=5")。%d/%i/%s/%f(.N)/%x/%X/%% を最小サポート。
// 引数はタプル (配列) or 単一値。位置は左から順に消費。未知指定子はそのまま残す。
// (str.format の `{}`-式 pyFormat とは別＝`%` 演算子専用。)
function pyPercentFormat(fmt, args) {
  const list = Array.isArray(args) ? args : [args];
  let i = 0;
  return String(fmt).replace(/%%|%(-?\d+)?(?:\.(\d+))?([sdifxX])/g, (m, _w, prec, conv) => {
    if (m === '%%') return '%';
    const v = list[i++];
    switch (conv) {
      case 'd': case 'i': return String(Math.trunc(Number(v)));
      case 'f': return Number(v).toFixed(prec != null ? +prec : 6);
      case 's': return String(v);
      case 'x': return Math.trunc(Number(v)).toString(16);
      case 'X': return Math.trunc(Number(v)).toString(16).toUpperCase();
      default: return m;
    }
  });
}

// line = 直近実行文の行 (ゼロ除算/未対応演算子エラーに付与)。AP17: i18n キー化 (interp.err.*)。
function applyBin(op, a, b, line) {
  const divErr = () => new RuntimeError('divZero', {}, line);   // AP16→AP17: /0 → 行番号付き i18n 実行時エラー
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    // AP16: 文字列反復 (py: "ab"*2 → "abab" / 数値*文字列も)。数値×数値は従来どおり。
    case '*':
      if (typeof a === 'string' && typeof b === 'number') return a.repeat(Math.max(0, Math.trunc(b)));
      if (typeof a === 'number' && typeof b === 'string') return b.repeat(Math.max(0, Math.trunc(a)));
      return a * b;
    // AP16 H項【制限明記・人間承認 2026-07-12】: C の / も真除算のまま (7/2→3.5)。実機 Arduino C の整数
    // 除算 (7/2→3) は型追跡が必要 (JS は 4.0 と 4 を区別できない) かつ出荷 C サンプルが真除算前提で
    // チューン済 ((gs+5)/110*255 は整数除算だと 0 で壊れる) ため実装せず docs/physics_model.md に明記。
    case '/':
      if (b === 0) throw divErr();
      return a / b;
    // AP16: py 文字列フォーマット ("x=%d"%5 → "x=5")。数値%数値は剰余 (0 剰余はエラー)。
    case '%':
      if (typeof a === 'string') return pyPercentFormat(a, b);
      if (b === 0) throw divErr();
      return a % b;
    case '**': return Math.pow(a, b);
    case '//':
      if (b === 0) throw divErr();
      return Math.floor(a / b);
    case '&': return a & b;
    case '|': return a | b;
    case '^': return a ^ b;
    case '<<': return a << b;
    case '>>': return a >> b;
    case '==': return a === b;
    case '!=': return a !== b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    default: throw new RuntimeError('badOp', { op }, line);
  }
}
