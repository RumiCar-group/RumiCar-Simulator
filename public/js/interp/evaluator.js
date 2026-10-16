// 共通 AST の木探索インタープリタ。Arduino C 風 / Python 風 共通。
import { SIM } from '../config.js';
import { t } from '../i18n.js';

// BJ3: 制御の信号は投げた文の行を持つ（ループの外・関数の外まで届いたとき、その行で i18n 実行時エラーにするため・Interp.outside）。
class ReturnSignal { constructor(v, line) { this.v = v; this.line = line; } }
class BreakSignal { constructor(line) { this.line = line; } }
class ContinueSignal { constructor(line) { this.line = line; } }

// AP17: 実行時エラーを i18n キー (interp.err.<sub>) ＋発生行つきで表す。
//   message は throw 時点の言語で翻訳済み＝表示層 (fleet/main/race) は従来どおり e.message を使う。
//   line は直近に実行した文の行 (execStmt が curLine を更新)。行があれば ` (行 N)` / ` (line N)` を付す。
//   ※ `t('interp.err.' + sub, …)` の動的キーは wf_i18n_check の接頭辞機構で参照済み扱いになる (孤児誤検知回避)。
// BK1: kind＝エラーの種類 (i18nKey。既定は sub)。同じ種類で文言だけを状況で変えるとき、sub に文言のキー・kind に種類を渡す
//   (breakOutside の Generic 版・stepLimit の millis() ヒント付き版)。i18nMsgKey＝実際に描画した文言のキー。
const ERR_PREFIX = 'interp.err.';
export class RuntimeError extends Error {
  constructor(sub, params, line, kind) {
    let msg = t('interp.err.' + sub, params || {});
    if (line) msg += t('interp.err.line', { n: line });
    super(msg);
    this.i18nKey = 'interp.err.' + (kind || sub);
    this.i18nMsgKey = 'interp.err.' + sub;
    this.i18nParams = params || {};
    this.line = line || 0;
  }
}
// ステップ上限 (無限ループ検出) も行番号つき実行時エラーの一種。
// BK1 H1: その tick の中で millis()／micros() を呼んでいたら (timeRead)、文言を stepLimitTime (stepLimit の文言＋「millis() は
//   loop() 1 回の中では進みません…」のヒント) にする。種類 (i18nKey) は stepLimit のまま・時刻の進み方は変えない。
export class StepLimit extends RuntimeError {
  constructor(line, timeRead) { super(timeRead ? 'stepLimitTime' : 'stepLimit', {}, line, 'stepLimit'); }
}
// BK1: 実行環境の呼び出しスタック切れ (V8／JSC は RangeError「Maximum call stack size exceeded」・SpiderMonkey は InternalError
//   「too much recursion」)。他の RangeError (toFixed の桁数・配列の長さ等) は含めない。
//   正規表現を使わない: スタックが尽きかけた所で初めて正規表現をコンパイルすると、V8 はそれ自体を SyntaxError「Invalid regular
//   expression」にし (変換されずに漏れる)、プロセスが OOM で落ちたこともある (BK1 の実測)。文字列の indexOf だけで判定する。
const isStackOverflow = (e) => {
  if (!e || !(e instanceof RangeError || e.name === 'InternalError')) return false;
  const m = String(e.message);
  return m.indexOf('call stack') >= 0 || m.indexOf('too much recursion') >= 0;
};

export class Interp {
  constructor(hostEnv) {
    this.host = hostEnv;          // 定数・API・センサーオブジェクト
    this.funcs = Object.create(null);
    this.global = { vars: Object.create(null), parent: null };
    this.steps = 0;
    this.curLine = 0;   // 直近に実行した文の行 (実行位置ハイライト用)
    this.depth = 0;     // BK1: ユーザー関数の呼び出しの入れ子の段数 (callUser・SIM.maxCallDepth)
    this.timeRead = false;   // BK1 H1: この tick の中で millis()／micros() を呼んだか (StepLimit の文言のヒント)
    this.statics = new Map();   // BK5: C の static 変数の記憶域（宣言の節 → { v }）。Interp ごと＝車ごと・buildController ごとに新しい
  }

  load(ast) {
    this.lang = ast.lang || 'c';   // AP16: 言語別意味論 (py 負index 等) の分岐に使う
    this.topStmts = [];
    for (const s of ast.body) {
      if (s.t === 'func') this.funcs[s.name] = s;
      else this.topStmts.push(s);
    }
  }

  resetSteps() { this.steps = 0; this.timeRead = false; }
  // BK4 (4)（H1＝A・BK-14）: 真偽の判定を 1 つの関数にする（if・elif・while・do-while・C の for・not・三項・and・or・py の bool()）。py は
  //   python3 と同じく空の list／tuple／dict も偽（pyTruthy）。条件の真偽と値の真偽が同じ規則なので、and／or が返した値を変数や関数の戻り値を
  //   経由して if に渡しても、条件に直接書いたときと同じ分岐になる（`def f(q): return q and q[0]` の空の q で `if f(q):` は本体を飛ばす）。
  //   是正前（850bbb2）は全部 truthy＝空の list／dict が真（`if []:` が本体を走らせ・`while q:` が空になっても回り続けた）。空の容器以外の真偽は
  //   是正前と同じ。C は従来どおり truthy。
  tr(v) { return this.lang === 'py' ? pyTruthy(v) : truthy(v); }
  tick() { if (++this.steps > SIM.maxStepsPerTick) throw new StepLimit(this.curLine, this.timeRead); }

  has(name) { return !!this.funcs[name]; }

  // AP17: 実行時エラー生成ヘルパ (直近実行文の行 curLine を付与)。sub=interp.err.<sub> の短名。
  rt(sub, params) { return new RuntimeError(sub, params, this.curLine); }

  // 関数呼び出し (ユーザー定義)。fresh ローカルスコープ。
  // BJ3: 関数の本体から出た break／continue（関数の中のループに捕まらなかった＝loop()／setup() やユーザー関数の直下）は
  //   行番号付きの i18n 実行時エラー。是正前は素通りし、loop() の直下なら `[object Object]` で停止、ループの中から呼んだ
  //   関数の直下なら呼び出し側のループに黙って効いていた（Python・C ともに関数の境界を越える break／continue は無い）。
  // BK1: 深い再帰。呼び出しの入れ子 (depth・loop()／setup() も 1 段) が SIM.maxCallDepth に達したら、呼び出した文の行 (curLine＝
  //   evalCall の時点の呼び出し元の文の行) で interp.err.recursion にする。上限より先に実行環境の呼び出しスタックが尽きたら
  //   (字下げの深い本体・スタックの小さい環境)、その RangeError 等を同じキーの実行時エラーへ変換する (行＝この関数を呼んだ文の行
  //   callLine。runner が直接呼ぶ loop()／setup() は callLine が無く curLine)。是正前は JS の RangeError「Maximum call stack size
  //   exceeded」が行番号なしで表示層へ漏れた (py・C)。depth は例外で抜けても finally で戻す。
  callUser(name, args, callLine) {
    const fn = this.funcs[name];
    if (this.depth >= SIM.maxCallDepth) throw this.rt('recursion', { n: this.depth });
    const scope = { vars: Object.create(null), parent: this.global };
    (fn.params || []).forEach((p, i) => { scope.vars[p] = args[i]; });
    this.depth++;
    // BK4 (5): py の関数の本体の終わり（return に届かない）は None（null）。値の無い return も None（execStmt の return）。C は従来どおり
    //   undefined（値を使わない）。是正前は undefined で、print(f()) が空・f() == None が偽。
    const none = this.lang === 'py' ? null : undefined;
    try { this.execBlock(fn.body, scope); }
    catch (e) {
      if (e instanceof ReturnSignal) return e.v;
      // BL7 ⑤: スタック切れの変換は文言を recursionStack（「入れ子が深すぎます」・段数を書かない）にする。種類（i18nKey）は recursion のまま。
      //   是正前は上限の文言「呼び出しの入れ子が {n} 段に達しました」で、loop() の中の str(深い入れ子の list) のように関数の呼び出しでなく
      //   JS の内部の再帰で尽きたときも n＝1（loop() の 1 段）と出た。i18nParams.n（そのときの段数）は従来どおり持つ。上限の経路は不変。
      if (isStackOverflow(e)) throw new RuntimeError('recursionStack', { n: this.depth }, callLine || this.curLine, 'recursion');
      throw this.outside(e, this.has('loop'));
    }
    finally { this.depth--; }
    return none;
  }

  // BJ3: ループの外まで届いた break／continue と関数の外まで届いた return を、その文の行の i18n 実行時エラーにする
  //   （それ以外の例外はそのまま返す）。是正前は信号オブジェクトがそのまま表示層へ届き、`e.message || e` で
  //   `[object Object]` と表示されていた（fleet.js tickSlot の sim.runtimeErr・main.js の log.err.setup）。
  // BK1 (30): loopNote＝「loop() 関数そのものはループではありません」を含む従来の文言にするか。loop() を持つプログラム (Model A) の
  //   関数の直下に届いたときだけ真 (callUser)。トップレベル (execTop・execLoopPass) と loop() を持たないプログラムの関数の直下は
  //   Generic 版 (loop() に触れない)。種類 (i18nKey) はどちらも breakOutside／continueOutside。是正前は 1 回だけ走るプログラムの
  //   トップレベルの continue にも「loop() 関数そのものは… (その回の loop() を終えるなら return)」が出た。
  outside(e, loopNote) {
    if (e instanceof BreakSignal) return loopNote ? new RuntimeError('breakOutside', {}, e.line) : new RuntimeError('breakOutsideGeneric', {}, e.line, 'breakOutside');
    if (e instanceof ContinueSignal) return loopNote ? new RuntimeError('continueOutside', {}, e.line) : new RuntimeError('continueOutsideGeneric', {}, e.line, 'continueOutside');
    if (e instanceof ReturnSignal) return new RuntimeError('returnOutside', {}, e.line);
    return e;
  }
  // BL7 fix1（層4 F3）: ループの条件を行 ln（そのループの文の行）で評価して真偽を返し、curLine を評価前の値へ戻す（例外で抜けたときは
  //   戻さない＝エラーの行は ln か、条件が呼んだ関数の中の行）。
  condAt(ln, cond, scope) {
    const keep = this.curLine;
    if (ln) this.curLine = ln;
    const v = this.tr(this.evalExpr(cond, scope));
    this.curLine = keep;
    return v;
  }
  // BL7 fix1（層4 F3）: C の for の更新部（parser_c の { t: 'exprstmt' }・行なし）を for の行で評価する。execStmt と同じく先に tick()
  //   （ステップの数とステップ上限エラーの行は是正前と同じ）・評価の後は curLine を戻す。行を持つ・式でない更新部は従来どおり execStmt。
  execUpdate(node, fs) {
    const u = node.update;
    if (u.t !== 'exprstmt' || u.line) { this.execStmt(u, fs); return; }
    this.tick();
    const keep = this.curLine;
    if (node.line) this.curLine = node.line;
    this.evalExpr(u.expr, fs);
    this.curLine = keep;
  }
  // BJ3: 関数の外の文（トップレベル。Model A の setup 前の初期化・Model B の while True: より前・Model C の全体）を走らせる。
  //   ここまで届いた break／continue／return は、外側にループも関数も無い＝エラー（Python も SyntaxError）。
  // BL7 ④: 関数の外（トップレベル）で実行環境のスタックが尽きたとき（Model B の `while True:` の本体や 1 回だけ走るプログラムの
  //   `s = str(深い入れ子の list)`）も、callUser と同じ種類（recursion）・文言（recursionStack）・行（その文の行＝curLine）の実行時エラーに
  //   する（stackErr）。是正前は JS の RangeError「Maximum call stack size exceeded」が行番号も i18n キーも無しで表示層へ漏れた。
  execTop(stmts) {
    try { this.execBlock(stmts, this.global); }
    catch (e) { throw this.stackErr(e) || this.outside(e, false); }
  }
  stackErr(e) { return isStackOverflow(e) ? new RuntimeError('recursionStack', { n: this.depth }, this.curLine, 'recursion') : null; }
  // BJ3: Model B（トップレベルの while True:）の本体を 1 回走らせる。continue＝この回を終える（false）・break＝ループを
  //   抜ける（true を返す。runner が以降の tick を無動作にする＝人間判断②）。return は関数の外＝エラー。
  execLoopPass(stmts) {
    try { this.execBlock(stmts, this.global); }
    catch (e) {
      if (e instanceof ContinueSignal) return false;
      if (e instanceof BreakSignal) return true;
      throw this.stackErr(e) || this.outside(e, false);
    }
    return false;
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
      case 'var': {
        // BK5: C の `static int n = 0;`（parser_c が static: true）。最初に実行したときだけ初期化子を評価して記憶域（宣言の節ごと＝同じ名前でも
        //   関数が違えば別・再帰でも 1 つ）に置き、スコープの名前はその記憶域を読み書きする（アクセサ）＝関数を抜けても値が残る。
        //   static の無い宣言は従来どおり毎回初期化。是正前は static を読み飛ばして毎回初期化（`f(); f(); print(f());` が 1）。
        if (node.static) {
          let cell = this.statics.get(node);
          if (!cell) { cell = { v: node.init ? this.evalExpr(node.init, scope) : 0 }; this.statics.set(node, cell); }
          Object.defineProperty(scope.vars, node.name, { get: () => cell.v, set: (x) => { cell.v = x; }, enumerable: true, configurable: true });
          return;
        }
        const v = node.init ? this.evalExpr(node.init, scope) : 0;
        // BK5 層4 F3: C のブロック `{ }` はスコープを作らない（従来からの制限・§9）ので、隣のブロックの static と同じ名前の static でない宣言が
        //   同じスコープの名前に来る。その名前が static の記憶域に結んだアクセサなら外してから置く＝static の値を書き換えない（`{ static int n = 0;
        //   n++; } { int n = 100; }` を 3 回呼んで 1,2,3＝gcc と同じ。0fbea4d は setter を通って 1,101,101）。static を 1 つも宣言していなければ素通り。
        if (this.statics.size) { const pd = Object.getOwnPropertyDescriptor(scope.vars, node.name); if (pd && pd.get) delete scope.vars[node.name]; }
        scope.vars[node.name] = v; return;
      }
      case 'exprstmt': this.evalExpr(node.expr, scope); return;
      case 'massign': return this.execMassign(node, scope);
      // BJ3: 値の式が関数を呼んでも、戻った時点で curLine は return の行に戻っている（evalCall）＝信号の行は return の行。
      // BK4 (5): py の値の無い return は None（null）。C は従来どおり undefined。
      case 'return': throw new ReturnSignal(node.value ? this.evalExpr(node.value, scope) : (this.lang === 'py' ? null : undefined), this.curLine);
      case 'break': throw new BreakSignal(this.curLine);
      case 'continue': throw new ContinueSignal(this.curLine);
      case 'if': {
        if (this.tr(this.evalExpr(node.cond, scope))) this.execBlock(node.then, scope);
        else if (node.els) this.execBlock(node.els, scope);
        return;
      }
      // BL7 fix1（層4 F3）: ループの条件（while・C の for の条件と更新・do-while の条件）は、そのループの文の行で評価する（condAt・execUpdate）。
      //   是正前は 2 回目以降の条件を本体の最後に実行した文の行のまま評価し、条件の中で出たエラー（len(None)・ゼロ除算・未定義の名前ほか）の
      //   行が本体の最後の文を指した（1 回目だけ while の行）。評価の後は curLine を元へ戻す＝エラーが出ない限り、実行位置ハイライト（line()）・
      //   ステップ上限エラーの行・評価ステップの数は是正前と同じ。
      case 'while': {
        while (this.condAt(node.line, node.cond, scope)) {
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
        } while (this.condAt(node.condLine || node.line, node.cond, scope));   // condLine＝`} while (…);` の while の行（parser_c）
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
        while (node.cond ? this.condAt(node.line, node.cond, fs) : true) {
          this.tick();
          try { this.execBlock(node.body, fs); }
          catch (e) { if (e instanceof BreakSignal) break; if (e instanceof ContinueSignal) {} else throw e; }
          if (node.update) this.execUpdate(node, fs);
        }
        return;
      }
      // BJ3: py の for（forrange／forin。どちらも parser_py だけが作る＝C の for は上の 'for' でブロックスコープのまま）は
      //   Python と同じくスコープを作らない。ループ変数は囲むスコープへ直接置き（setVar を通さない＝関数の中の `for i` は
      //   同名のグローバル i を書き換えない・Python と同じ）、本体は囲むスコープで走る（本体の代入は従来どおり setVar＝
      //   人間判断①）。∴ 本体で新しく代入した変数もループ変数もループ後に最後の値で残る。0 回のループはループ変数を作らない。
      //   是正前は for ごとに新しいスコープを作り、ループ変数（ループの前に start を置いた）と本体の新しい変数をそこへ置いて
      //   ループ後に捨てていた（`for i in range(3): last = i` の後の last が「未定義の変数/名前」）。
      case 'forrange': {
        // BJ3: ステップ 0 は Python と同じくエラー（ValueError）。是正前は start <= end なら黙って 0 回・start > end なら
        //   ステップ上限エラー（無限ループ）。引数の式が関数を呼んでも curLine は for の行に戻っている（evalCall）。
        // BK4 (17): 引数の型と 0 のステップは rangeArgs（`range(…)` の呼び出しと同じ）。
        let [i, end, step] = this.rangeArgs([this.evalExpr(node.start, scope), this.evalExpr(node.end, scope), this.evalExpr(node.step, scope)]);
        while (step > 0 ? i < end : i > end) {
          this.tick();
          scope.vars[node.var] = i;
          try { this.execBlock(node.body, scope); }
          catch (e) { if (e instanceof BreakSignal) break; if (e instanceof ContinueSignal) {} else throw e; }
          i += step;
        }
        return;
      }
      case 'forin': {
        // AP9: list はその要素、str は各文字、dict はキーを走査 (Python 意味論)。BJ3: スコープは forrange と同じ。
        const it = this.evalExpr(node.iter, scope);
        let seq;
        if (Array.isArray(it)) seq = it;
        else if (typeof it === 'string') seq = it.split('');
        else if (it && typeof it === 'object') seq = Object.keys(it);
        else throw this.rt('notIterable');
        for (let k = 0; k < seq.length; k++) {
          this.tick();
          scope.vars[node.var] = seq[k];
          try { this.execBlock(node.body, scope); }
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
      // BK5 層4 F6: 左辺の場所は 1 回だけ評価する（lref・python3 と同じく `a[k()] += 1` の k は 1 回。0fbea4d までは 2 回）。
      const ref = this.lref(targets[0], scope);
      const cur = ref.get();
      const rhs = this.evalExpr(values[0], scope);
      const v = applyBin(op.slice(0, -1), cur, rhs, this.curLine, this.lang);
      ref.set(v); return;
    }
    let vals;
    if (targets.length === values.length) vals = values.map(v => this.evalExpr(v, scope));
    // BK2 (9): 左辺が 2 つ以上・右辺が 1 つ（`a, b = f()`・`[a, b] = "xy"`）は右辺を列に分ける（unpackSeq: assignTo の列の代入先と同じ
    //   規則）。是正前は配列以外を 1 要素として扱い（`a, b = "xy"` は a が "xy"・b が未定義）、要素の数の食い違いは黙って通った
    //   （`a, b = [1]` の b は未定義・`a, b = [1, 2, 3]` は 3 を捨てた。python3 は ValueError）。出荷の py に該当する文は無い（BK2 で AST を走査）。
    else if (values.length === 1) vals = this.unpackSeq(this.evalExpr(values[0], scope), targets.length);
    else vals = values.map(v => this.evalExpr(v, scope));
    targets.forEach((tgt, i) => this.assignTo(tgt, vals[i], scope));
  }

  // BK2 (9): 列の代入（py）の右辺を n 個の値の列に分ける。list／tuple＝要素・str＝各文字・dict＝キー（for … in と同じ）。それ以外
  //   （数・None・関数）や要素の数が n と違えば、行番号付きの実行時エラー interp.err.unpack（python3 は ValueError／TypeError）。
  unpackSeq(val, n) {
    let seq = null;
    if (Array.isArray(val)) seq = val;
    else if (typeof val === 'string') seq = val.split('');
    else if (val && typeof val === 'object') seq = Object.keys(val);
    if (!seq || seq.length !== n) throw this.rt('unpack', { n });
    return seq;
  }

  // BK5 層4 F6: 読み書きする左辺の場所（複合代入・`++`／`--`）。配列と添字・メンバの持ち主をここで 1 回だけ評価し、get／set はその場所を
  //   読み書きする。読む値と書き方は evalExpr／assignTo の各分岐と同じ（index の None・pyIndex の負の添字・member の null は undefined）。
  //   名前（var）とそれ以外（列の代入先など）は従来どおり evalExpr／assignTo（評価する部分式が無い・badAssign）。
  lref(tgt, scope) {
    if (tgt.t === 'index') {
      const o = this.evalExpr(tgt.obj, scope);
      if (o === null) throw this.rt('noneIndex');
      const k = this.pyIndex(o, this.evalExpr(tgt.idx, scope));
      return { get: () => o[k], set: (v) => { o[k] = v; } };
    }
    if (tgt.t === 'member') {
      const o = this.evalExpr(tgt.obj, scope);
      return { get: () => (o == null ? undefined : o[tgt.name]), set: (v) => { o[tgt.name] = v; } };
    }
    return { get: () => this.evalExpr(tgt, scope), set: (v) => this.assignTo(tgt, v, scope) };
  }

  assignTo(tgt, val, scope) {
    if (tgt.t === 'var') this.setVar(scope, tgt.name, val);
    else if (tgt.t === 'member') { const o = this.evalExpr(tgt.obj, scope); o[tgt.name] = val; }
    else if (tgt.t === 'index') {
      const o = this.evalExpr(tgt.obj, scope);
      if (o === null) throw this.rt('noneIndex');   // BK4: py の None（null）。是正前は数の 0 で、JS の TypeError が素のまま出た
      o[this.pyIndex(o, this.evalExpr(tgt.idx, scope))] = val;
    }
    else if (tgt.t === 'tuple' || tgt.t === 'list') {
      // BK2 (9): 列の代入先（py の `a, = [5]`・`[a] = [5]`・入れ子 `(a, b), c = …`／`[a, [b, c]] = …` の内側。parser_py の flattenTargets が
      //   要素 2 つ以上の左辺を平らにするので、ここへ来るのは要素 1 つの左辺と入れ子の内側だけ）。右辺の分け方と数の検査は unpackSeq。
      //   是正前は「代入先が不正です」（タプルの `a, = [5]` は平らにされて a が [5]）。
      const seq = this.unpackSeq(val, tgt.items.length);
      tgt.items.forEach((it, k) => this.assignTo(it, seq[k], scope));
    }
    else throw this.rt('badAssign');
  }

  // AP16: Python の負インデックス (a[-1] → 末尾)。py のみ・list/str に適用 (C は無改変=従来どおり)。
  // BK4 (8): py の添字の bool は数（`[5, 6][True]` は 6・`{1: "a"}[True]` は "a"。Python の bool は int）。是正前は JS のキー "true"。
  // BK4 層4 F7: py の添字の None。dict は pyKey（キー 'None'）・list／str は実行時エラー interp.err.noneAsIndex（python3 は TypeError: list indices
  //   must be integers…）。是正前（null になってから）は JS のキー "null"＝`[1, 2][None]` が黙って空・`{None: 1}` のキーが表示 null。
  pyIndex(o, k) {
    if (this.lang === 'py' && k === null) {
      if (Array.isArray(o) || typeof o === 'string') throw this.rt('noneAsIndex');
      return pyKey(k);
    }
    if (this.lang === 'py' && typeof k === 'boolean') k = Number(k);
    if (this.lang === 'py' && typeof k === 'number' && k < 0 && (Array.isArray(o) || typeof o === 'string')) return o.length + k;
    return k;
  }

  // BK4 (17): py の range の引数（for … in range(…) の forrange と、式の range(…) の呼び出し）。整数（bool を含む）でなければ行番号付きの
  //   実行時エラー interp.err.rangeArg（python3 は TypeError: 'NoneType' object cannot be interpreted as an integer）・3 番目が 0 なら
  //   rangeStepZero（python3 は ValueError）。bool は数にして返す。是正前は None（数の 0）がステップ 0 と同じ rangeStepZero・式の range(…) は
  //   `range(1, 5, None)`／`range(1, 5, 0)` が黙って空・`range(2.5)` が 0,1,2。残る差: 整数値の float（`range(4 / 2)`）は int と区別できず通る。
  rangeArgs(vals) {
    for (const v of vals) if (!(typeof v === 'boolean' || Number.isInteger(v))) throw this.rt('rangeArg', { type: typeName(v) });
    const out = vals.map(Number);
    if (out.length >= 3 && out[2] === 0) throw this.rt('rangeStepZero');
    return out;
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
      case 'none': return null;   // BK4 (5): py の None（parser_py）
      case 'var': return this.getVar(scope, node.name);
      case 'list': return node.items.map(e => this.evalExpr(e, scope));
      // BK4 層4 F2: tuple は TUPLES に印を付けた配列（pyEq が list と区別する＝`(1, 2) == [1, 2]` は False）。
      case 'tuple': return mkTuple(node.items.map(e => this.evalExpr(e, scope)));
      case 'dict': {
        // AP9: 素の辞書 (プロトタイプ無し) — index 読み書き `d[k]` と反復キー列挙に使う。
        const o = Object.create(null);
        // BK4 (8): キーの bool は数（`{True: "t"}[1]` は "t"）。
        for (const en of node.entries) o[pyKey(this.evalExpr(en.key, scope))] = this.evalExpr(en.value, scope);
        return o;
      }
      case 'bin': {
        const op = node.op;
        // BK4 (4): py の and／or は被演算子の値を返す（`0 and 1` は 0・`5 and None` は None・`[] or 0` は 0・`"" or "x"` は x）。被演算子の真偽は
        //   if・while と同じ tr（py は python3 と同じく空の list／tuple／dict も偽）。是正前は and が偽のとき false・真偽は truthy（`[] or 0` は []）。
        //   C は従来どおり（&& は偽のとき false・|| は被演算子の値・真偽は truthy）。
        if (op === '&&') { const a = this.evalExpr(node.a, scope); return this.tr(a) ? this.evalExpr(node.b, scope) : (this.lang === 'py' ? a : false); }
        if (op === '||') { const a = this.evalExpr(node.a, scope); return this.tr(a) ? a : this.evalExpr(node.b, scope); }
        return applyBin(op, this.evalExpr(node.a, scope), this.evalExpr(node.b, scope), this.curLine, this.lang);
      }
      case 'compare': {
        // AP16: Python 連鎖比較 (a<b<c = (a<b) and (b<c)・中間 b は1回評価・短絡)。
        let left = this.evalExpr(node.first, scope);
        for (const seg of node.rest) {
          const right = this.evalExpr(seg.right, scope);
          if (!applyBin(seg.op, left, right, this.curLine, this.lang)) return false;
          left = right;
        }
        return true;
      }
      case 'un': {
        const a = this.evalExpr(node.a, scope);
        // BK4: py の None（null）に - + ~ は実行時エラー（python3 は TypeError。是正前は数の 0 として 0）。
        if (a === null && this.lang === 'py' && node.op !== '!') throw this.rt('noneOp', { op: node.op });
        if (node.op === '-') return -a; if (node.op === '+') return +a; if (node.op === '!') return !this.tr(a);
        if (node.op === '~') return ~a;
        return a;
      }
      case 'arraydecl': return this.shapeArray(node.dims, 0, node.init ? this.evalExpr(node.init, scope) : null, scope);
      case 'sizeof': return this.sizeOfVal(this.evalExpr(node.a, scope));
      // BK5: C のカンマ演算子（parser_c の expr）。左から評価して最後の値。
      case 'seq': { let v; for (const e of node.items) v = this.evalExpr(e, scope); return v; }
      // BK5: C のキャスト（parser_c の castKind）。'int'＝0 方向への切り捨て（`(int)-3.7` は -3・-0 は 0）・'float'＝数・'bool'＝C の真偽・'none'＝そのまま。
      //   型の幅は持たない（`(uint8_t)300` は 300・`(unsigned long)-1` は -1・`(char)65` は数の 65＝§9 の残る差）。
      // BK5 層4 F2: この処理系の C の char は 1 文字の文字列（`char c = 'A';` の c は "A"）。'int'・'float'・'bool' は 1 文字の文字列を文字コードに
      //   してから変換する（`(int)c` は 65・`(int)'7'` は 55・`(bool)'\0'` は false＝gcc と同じ。0fbea4d は Number("A") の NaN・Number("7") の 7）。
      //   'char' は文字（1 文字の文字列）をそのまま・数は 'int' と同じ（`(char)'A'` は "A"＝print は Arduino の Serial.print((char)…) と同じ "A"・
      //   `(char)65` は数の 65＝§9 の残る差）。2 文字以上の文字列（C ではポインタ）は従来どおり Number。
      case 'cast': {
        let a = this.evalExpr(node.a, scope);
        if (node.to === 'char' && typeof a === 'string' && a.length === 1) return a;
        if (node.to === 'none') return a;
        if (typeof a === 'string' && a.length === 1) a = a.charCodeAt(0);
        if (node.to === 'int' || node.to === 'char') { const r = Math.trunc(Number(a)); return r === 0 ? 0 : r; }
        if (node.to === 'float') return Number(a);
        if (node.to === 'bool') return truthy(a);
        return a;
      }
      case 'ternary': return this.tr(this.evalExpr(node.cond, scope)) ? this.evalExpr(node.a, scope) : this.evalExpr(node.b, scope);
      // BK5 層4 F6: 複合代入（`+=`・`%=` ほか）と `++`／`--` は左辺の場所（配列と添字・メンバの持ち主）を 1 回だけ評価する（lref）。0fbea4d までは
      //   読むときと書くときで 2 回評価し、`a[i++] %= 4` が a[0] を読んで a[1] に書き i が 2 進んだ（gcc は i=1・a[0]=3）。`=` は従来どおり。
      case 'assignexpr': {
        if (node.op === '=') { const v = this.evalExpr(node.value, scope); this.assignTo(node.target, v, scope); return v; }
        const ref = this.lref(node.target, scope);
        const v = applyBin(node.op.slice(0, -1), ref.get(), this.evalExpr(node.value, scope), this.curLine, this.lang);
        ref.set(v); return v;
      }
      case 'preincr': { const ref = this.lref(node.a, scope); const cur = ref.get(); const v = node.op === '++' ? cur + 1 : cur - 1; ref.set(v); return v; }
      case 'postincr': { const ref = this.lref(node.a, scope); const cur = ref.get(); const v = node.op === '++' ? cur + 1 : cur - 1; ref.set(v); return cur; }
      case 'member': { const o = this.evalExpr(node.obj, scope); return o == null ? undefined : o[node.name]; }
      case 'index': {
        const o = this.evalExpr(node.obj, scope);
        if (o === null) throw this.rt('noneIndex');   // BK4: py の None（null）に添字（python3 は TypeError: 'NoneType' object is not subscriptable）
        return o[this.pyIndex(o, this.evalExpr(node.idx, scope))];
      }
      case 'call': return this.evalCall(node, scope);
      // BK3: f-string の置換フィールド（parser_py の fmt の節）。書式指定は文字列の式（入れ子のフィールドを含む）。
      case 'fmt': return pyFormatField(this.evalExpr(node.v, scope), node.conv, node.spec ? '' + this.evalExpr(node.spec, scope) : '', this.curLine);
      default: throw this.rt('badExpr', { t: node.t });
    }
  }

  evalCall(node, scope) {
    this.tick();
    const args = node.args.map(a => this.evalExpr(a, scope));
    // BK3: キーワード引数（parser_py が `.format(…)` の呼び出しにだけ許す）。位置引数の後に書いた順で評価する。
    let kw = null;
    if (node.kwargs) { kw = Object.create(null); for (const k of node.kwargs) kw[k.name] = this.evalExpr(k.value, scope); }
    const callee = node.callee;
    if (callee.t === 'member') {
      const obj = this.evalExpr(callee.obj, scope);
      // BK3: str.format は書式指定ミニ言語・名前・変換を扱う pyStrFormat（エラーの行＝この文の行）。文字列以外の .format は従来どおり
      //   下の経路（list／dict には無い＝notMethod）。キーワード引数が付いたまま文字列以外へは渡さない。
      if (typeof obj === 'string' && callee.name === 'format') return pyStrFormat(obj, args, kw, this.curLine);
      if (kw) throw this.rt('notMethod', { name: callee.name });
      // AP9: str/list/dict の Python メソッドを JS ネイティブより優先 (.replace/.sort 等の意味論差を吸収)。
      const pm = pyMethod(obj, callee.name, this.curLine, this.lang);
      if (pm) return pm(...args);
      // ホストオブジェクト (Serial/math/sensor/time/random) と dict 値の関数はネイティブ経路。
      const fn = obj == null ? undefined : obj[callee.name];
      if (typeof fn !== 'function') throw this.rt('notMethod', { name: callee.name });
      // BK4 層4 F7: py の Serial.print／println も print と同じく pyStr（True／False／None）。是正前は "true"／""（None は null）。C は従来どおり。
      if (this.lang === 'py' && obj === this.host.Serial) return fn.apply(obj, args.map((v) => (v === undefined ? v : pyStr(v))));
      return this.callHost(fn, obj, args);
    }
    if (callee.t === 'var') {
      const name = callee.name;
      if (this.funcs[name]) {
        // BJ3: ユーザー関数から正常に戻ったら curLine を呼び出し元の文の行へ戻す。是正前は呼ばれた関数の最後の文の行が残り、
        //   同じ文の続きで出るエラー（ゼロ除算・未定義の名前・for … in の notIterable・rangeStepZero・関数の外の return ほか）の
        //   行と実行位置ハイライト（runner の line()）が呼ばれた関数の中を指していた（`for c in f():` が f の return の行）。
        //   例外で抜けたときは戻さない（エラーの出た行を指したまま）。runner が直接呼ぶ setup()／loop() はこの経路を通らない＝
        //   tick の後の line() は loop() の本体で最後に実行した文の行（その文が呼んだ関数の中の行ではない）。
        const ln = this.curLine;
        const v = this.callUser(name, args, ln);
        this.curLine = ln;
        return v;
      }
      if (name in this.host && typeof this.host[name] === 'function') {
        if (name === 'millis' || name === 'micros') this.timeRead = true;   // BK1 H1: StepLimit の文言のヒント (値は変えない)
        // BK4: py だけ。print／str の値の文字列化は pyStr（True／False／None。f-string・str.format と同じ）。是正前は JS の表示（true・
        //   None は数の 0）。undefined（範囲外の添字など）は従来どおり（print は空・str は "undefined"）。C の print(true) は従来どおり "true"。
        //   bool(…) は pyTruthy（if と同じ tr＝空の list／tuple／dict は False・H1＝A）。range(…) の引数は rangeArgs（整数・0 でないステップ）。
        if (this.lang === 'py') {
          if (name === 'print') return this.host.print(...args.map((v) => (v === undefined ? v : pyStr(v))));
          if (name === 'str') return args.length ? pyStr(args[0]) : '';
          if (name === 'bool') return args.length ? pyTruthy(args[0]) : false;   // BK4 (4): bool([]) は False（是正前は True）
          if (name === 'range') return this.host.range(...this.rangeArgs(args));
        }
        // BK5 層4 F2 の兄弟: C の関数形式の型変換 int(c)・float(c)・bool(c) も 1 文字の文字列（char）は文字コード（g++ と同じ 65。キャストの 'cast' と
        //   同じ規則）。0fbea4d まで（v10.2.0 も）は int・float が Number(文字)＝'A' は NaN・'7' は 7・' ' は 0、bool は空でない文字列を真＝'\0' も真
        //   （HEAD は 65・55・32・bool('\0') は偽＝エラー無しで値が変わる書き方がある・BK-17 ②）。py は従来どおり（int("7") は 7）。
        if (this.lang !== 'py' && (name === 'int' || name === 'float' || name === 'bool') && typeof args[0] === 'string' && args[0].length === 1) {
          return this.host[name](args[0].charCodeAt(0), ...args.slice(1));
        }
        return this.callHost(this.host[name], this.host, args);
      }
      throw this.rt('undefFunc', { name });
    }
    const fn = this.evalExpr(callee, scope);
    if (typeof fn !== 'function') throw this.rt('notCallable');
    return this.callHost(fn, undefined, args);
  }

  // BL7 ①②: ホスト（api.js）の組込関数を呼ぶ。組込関数は文の行を知らないので、行の無い RuntimeError（len(None)・random.choice([]) ほか）を
  //   投げたら、ここで呼び出した文の行（curLine＝evalCall の時点の文の行）を付けて投げ直す（文言のキー・種類・引数は同じ）。
  //   それ以外の例外と、行の付いた RuntimeError はそのまま。正常に戻る呼び出しの値と this は従来どおり（this.host[name](...) は this＝host）。
  callHost(fn, self, args) {
    try { return fn.apply(self, args); }
    catch (e) {
      if (e instanceof RuntimeError && !e.line) throw new RuntimeError(e.i18nMsgKey.slice(ERR_PREFIX.length), e.i18nParams, this.curLine, e.i18nKey.slice(ERR_PREFIX.length));
      throw e;
    }
  }
}

function truthy(v) { return !(v === 0 || v === false || v === '' || v == null); }
// BK4 (4): py の真偽（Interp.tr）。truthy に加えて空の list／tuple（長さ 0 の配列）と空の dict（プロトタイプ無しの素の辞書＝evalExpr の dict）が
//   偽（python3 と同じ）。ホストのオブジェクト（math・Serial・sensor0 など）は真のまま。
function pyTruthy(v) {
  if (!truthy(v)) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object' && Object.getPrototypeOf(v) === null) return dictNonEmpty(v);
  return true;
}
// BL7 ③: 素の辞書（プロトタイプ無し）に鍵が 1 つでもあるか。是正前の Object.keys(v).length > 0 と同じ値（プロトタイプ無しなので
//   for … in が数えるのは自前の列挙できる鍵だけ＝Object.keys と同じ集合）。ソースの上では最初の鍵で抜けるが、**速くはならない**:
//   BL7 fix1（層4 F1）の実測（Node 22.22.1）で、Object.create(null) の辞書は V8 の辞書モード（%HasFastProperties＝false）で、for … in は
//   始める前に全部の鍵を集める＝鍵の数に比例（N＝1／1000／20000 で 0.29／22.8／2132 µs・Object.keys 版との比 1.0〜1.6）・割り当ても同じ
//   （N＝1000 を 2 万回で GC の scavenge が両方 160 回）。O(1) にするには dict に要素数を持たせ、全部の更新箇所で同期する必要がある
//   （採らない・決定ログ BL7 fix1）。値は是正前と同じ・Object.keys を呼ばない（wf_bl1_ui K-3 の配線）ことだけを主張する。
function dictNonEmpty(o) { for (const k in o) return true; return false; }

// ===== AP9: Python 組込メソッド (str / list / dict) =====
// 各テーブルは `(受け手) => (...引数) => 結果` のファクトリ。pyMethod が受け手を束縛して返す。
function trimChars(s, chars, left, right) {
  const set = new Set(String(chars).split(''));
  let a = 0, b = s.length;
  if (left) while (a < b && set.has(s[a])) a++;
  if (right) while (b > a && set.has(s[b - 1])) b--;
  return s.slice(a, b);
}
// ===== BK3: Python の書式指定ミニ言語（f-string の `{x:spec}`・`!r`/`!s`/`!a`・`{x=}` と str.format）=====
// 正本＝Python 公式「Format Specification Mini-Language」。期待値は python3 3.14.4 の実測（wf_bk1_interp2 H 章が突き合わせる）。
//   `[[fill]align][sign][z][#][0][width][grouping][.precision][type]`・type＝b c d e E f F g G o s x X %・省略。
//   本処理系は int と float を区別しない（JS の数）＝整数値の数は int として書式化する（`f"{3.0:d}"` は "3"・python3 は ValueError／
//   `f"{x:>5}"` の x=3.0 は "    3"・python3 は "  3.0"）。整数値でない数・±inf・nan・|x|≥2^53 の整数値は float。-0 は 0 と同じに扱う
//   （JS の -0 は int の演算〔`0 * -1`・`round(-0.4)`〕からも出る。python3 の int 0 と同じ表示）。bool は int（`f"{True:>5}"` は "    1"・
//   書式指定が空なら pyStr）。None（BK4 から null）・list／dict／関数に空でない書式指定は実行時エラー（python3 は TypeError）。
//   丸めは 2 進の値の正確な 10 進展開に対する偶数丸め（python3 と同じ＝`f"{2.5:.0f}"` は "2"・`f"{0.125:.2f}"` は "0.12"・`f"{2.675:.2f}"` は
//   "2.67"）。JS の toFixed は同点を切り上げ（0.5→"1"）、1e21 以上は指数表記になるので使わない。
//   未対応（`n`・`z` 以外の 3.14 の小数部の区切り）と書き方の誤りは interp.err.fmtSpec、型に使えない指定（文字列に `d`・符号、整数値でない数に
//   `d`・`x`、整数に型 `d` 等と精度・`z` を書いた `.2d`・`zd` など）は interp.err.fmtType（行＝その文の行）。型を省略した整数の
//   `f"{5:.2}"`・`f"{5:z}"` は float として書式化して "5.0"（python3 は ValueError＝§9 (7) の残る差・BK-9 F1）。幅と精度は 10000 まで（超えたら fmtSpec。python3 は上限なし）。
const SPEC_RE = /^(?:([\s\S])?([<>=^]))?([+\- ])?(z)?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/u;
const FMT_MAX = 10000;
// 値の文字列化（f-string の書式指定の無いフィールド・`!s`・str.format の `{}`・BK4 から py の print／str と `%s`）。bool は True／False・
//   None（null）は None（python3 と同じ）。それ以外は是正前の f-string の展開 `"" + (式)` と同じ値（list は 1,2・float は JS の表示＝未是正の差）。
//   BK4 (5): 是正前は true／false と、None が数の 0 で 0。
function pyStr(v) {
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (v === null) return 'None';
  return '' + v;
}
// repr（`!r`）。文字列だけ python3 の repr（引用符の選び方・エスケープ・表示できない文字）。それ以外は pyStr（list の repr〔[1, 'a']〕は
//   本処理系の list の文字列化〔1,a〕のまま＝未是正の差）。ascii（`!a`）は repr の ASCII 以外の文字を \x／\u／\U にする。
const NONPRINT = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;
const hexN = (c, n) => c.toString(16).padStart(n, '0');
function pyRepr(v, ascii) {
  if (typeof v !== 'string') return pyStr(v);
  const q = v.includes("'") && !v.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of v) {
    const c = ch.codePointAt(0);
    if (ch === q || ch === '\\') out += '\\' + ch;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (c < 0x20 || c === 0x7f) out += '\\x' + hexN(c, 2);
    else if (c < 0x7f) out += ch;
    else if (ascii || NONPRINT.test(ch)) out += c <= 0xff ? '\\x' + hexN(c, 2) : c <= 0xffff ? '\\u' + hexN(c, 4) : '\\U' + hexN(c, 8);
    else out += ch;
  }
  return out + q;
}
// 有限で 0 以上の x の正確な 10 進展開 x = D / 10^k（D・k は BigInt／数）。
const F64 = new DataView(new ArrayBuffer(8));
function exactDec(x) {
  F64.setFloat64(0, x);
  const hi = F64.getUint32(0), lo = F64.getUint32(4), eb = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo), e;
  if (eb === 0) e = -1074; else { m |= 1n << 52n; e = eb - 1075; }
  if (e >= 0) return { D: m << BigInt(e), k: 0 };
  return { D: m * 5n ** BigInt(-e), k: -e };
}
// D を 10^s で割って偶数丸め（s ≤ 0 なら 10^-s を掛ける）。
function divRound(D, s) {
  if (s <= 0) return D * 10n ** BigInt(-s);
  const div = 10n ** BigInt(s), q = D / div, r2 = 2n * (D % div);
  return (r2 > div || (r2 === div && (q & 1n) === 1n)) ? q + 1n : q;
}
// 固定小数点（p 桁）の数字列（符号なし）。
function fixedDigits(x, p) {
  const { D, k } = exactDec(x);
  const s = divRound(D, k - p).toString();
  if (p === 0) return s;
  const t = s.padStart(p + 1, '0');
  return t.slice(0, -p) + '.' + t.slice(-p);
}
// 有効数字 n 桁に丸めた数字列 digits（n 文字）と指数 exp（x ≈ d.ddd × 10^exp）。x＝0 は '0'×n・0。
function sigDigits(x, n) {
  if (x === 0) return { digits: '0'.repeat(n), exp: 0 };
  const { D, k } = exactDec(x);
  const s = D.toString();
  let exp = s.length - 1 - k;
  let r = divRound(D, s.length - n).toString();
  if (r.length > n) { r = r.slice(0, n); exp++; }   // 9.99… → 10.0（繰り上がり）
  return { digits: r, exp };
}
const expStr = (e) => (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(2, '0');
// 指数表記: digits の先頭 1 桁＋'.'＋残り（keepPoint＝残りが空でも '.' を付ける〔'#'〕）＋'e±XX'。
function sciStr(digits, exp, keepPoint) {
  const rest = digits.slice(1);
  return digits[0] + (rest || keepPoint ? '.' + rest : '') + 'e' + expStr(exp);
}
// 有効数字の列と指数から固定小数点の数字列（-4 ≤ exp の範囲だけで使う）。
function plainFromSig(digits, exp) {
  if (exp < 0) return '0.' + '0'.repeat(-exp - 1) + digits;
  const ip = digits.slice(0, exp + 1).padEnd(exp + 1, '0'), fp = digits.slice(exp + 1);
  return fp ? ip + '.' + fp : ip;
}
// 小数部の末尾の 0 と、残らなければ '.' を外す（指数表記は仮数の小数部だけ）。
const stripZeros = (s) => {
  const e = s.indexOf('e'), m = e < 0 ? s : s.slice(0, e), t = e < 0 ? '' : s.slice(e);
  return (m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m) + t;
};
// float の本体（符号なし・x ≥ 0 有限）。type＝e E f F g G % ''（''＝省略: prec が null なら repr、あれば g の変形）。
function floatBody(x, type, prec, alt) {
  const lo = type.toLowerCase();
  if (lo === 'f') return fixedDigits(x, prec == null ? 6 : prec) + (alt && prec === 0 ? '.' : '');
  if (lo === '%') {
    const y = x * 100;   // python3 と同じく float の掛け算（1e307 の 100 倍は inf）
    if (!Number.isFinite(y)) return 'inf%';
    return fixedDigits(y, prec == null ? 6 : prec) + (alt && prec === 0 ? '.' : '') + '%';
  }
  if (lo === 'e') { const p = prec == null ? 6 : prec; const { digits, exp } = sigDigits(x, p + 1); return sciStr(digits, exp, alt); }
  if (type === '' && prec == null) {
    // repr: 最短の往復できる数字列（JS の toExponential() と同じ桁）・指数は -4 ≤ exp < 16 なら固定小数点（python3 の float_repr）。
    const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(x.toExponential());
    const digits = m[1] + (m[2] || ''), exp = Number(m[3]);
    if (exp < -4 || exp >= 16) return sciStr(digits, exp, alt);   // '#' は指数表記でも '.' を残す（1.e-05）
    const s = plainFromSig(digits, exp);
    return s.includes('.') ? s : s + '.0';
  }
  // g と、型の省略＋精度（python3 は g と同じだが固定小数点のときは小数部を最低 1 桁・指数表記に切り替える境目が 1 つ手前）。
  const P = prec == null ? 6 : (prec === 0 ? 1 : prec);
  const { digits, exp } = sigDigits(x, P);
  const addDot0 = type === '';
  const useExp = exp < -4 || exp >= (addDot0 ? P - 1 : P);
  let s = useExp ? sciStr(digits, exp, alt) : plainFromSig(digits, exp);
  if (alt) { if (!useExp && !s.includes('.')) s += '.'; }
  else s = stripZeros(s);
  if (addDot0 && !useExp && !s.includes('.')) s += '.0';
  return s;
}
// 整数部の区切り（Python の _PyUnicode_InsertThousandsGrouping と同じ手順・minWidth＝'0' 埋めの '=' のときの最小幅）。
function groupDigits(d, sep, size, minWidth) {
  const groups = [];
  let rem = d.length, mw = minWidth, end = d.length;
  for (;;) {
    const l = Math.min(Math.max(rem, mw, 1), size);
    const nChars = Math.max(0, Math.min(rem, l)), nZeros = Math.max(0, l - rem);
    groups.unshift('0'.repeat(nZeros) + d.slice(end - nChars, end));
    end -= nChars; rem -= nChars; mw -= l;
    if (rem <= 0 && mw <= 0) break;
    mw -= sep.length;
  }
  return groups.join(sep);
}
const cpLen = (s) => { let n = 0; for (const _ of s) n++; return n; };
function pad(body, width, fill, align, head = '') {
  const n = width - cpLen(head + body);
  if (n <= 0) return head + body;
  if (align === '<') return head + body + fill.repeat(n);
  if (align === '^') { const l = Math.floor(n / 2); return fill.repeat(l) + head + body + fill.repeat(n - l); }
  if (align === '=') return head + fill.repeat(n) + body;
  return fill.repeat(n) + head + body;
}
// BL7: api.js（len・random.choice の引数の型の文言）も使う＝export。
export const typeName = (v) => (typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'float')
  : typeof v === 'string' ? 'str' : Array.isArray(v) ? 'list' : v == null ? 'None' : typeof v === 'function' ? 'function' : 'dict');
// 値 v を書式指定 spec で文字列にする。line＝実行時エラーの行。
function formatValue(v, spec, line) {
  if (spec === '') return pyStr(v);
  const bad = () => new RuntimeError('fmtSpec', { spec }, line);
  const m = SPEC_RE.exec(spec);
  if (!m) throw bad();
  let [, fill, align, sign, z, alt, zero, width, group, prec, type] = m;
  type = type || '';
  width = width ? Number(width) : 0;
  prec = prec != null ? Number(prec) : null;
  if (type === 'n' || width > FMT_MAX || (prec != null && prec > FMT_MAX)) throw bad();
  const tname = typeName(v);
  const badType = () => new RuntimeError('fmtType', { type: tname, spec }, line);
  if (typeof v === 'string') {
    if ((type && type !== 's') || sign || z || alt || group || align === '=') throw badType();
    if (zero && fill === undefined) fill = '0';
    let s = v;
    if (prec != null) s = Array.from(s).slice(0, prec).join('');
    return pad(s, width, fill === undefined ? ' ' : fill, align || '<');
  }
  if (typeof v !== 'number' && typeof v !== 'boolean') throw badType();
  const x = Number(v);
  if (zero && fill === undefined) { fill = '0'; if (!align) align = '='; }
  fill = fill === undefined ? ' ' : fill;
  align = align || '>';
  const neg = x < 0;
  const ax = Math.abs(x);
  const intType = 'bcdoxX'.includes(type) && type !== '';
  let prefix = '', body, isInt = false;
  // int として書式化: 型 b c d o x X と、型も精度も z も無い安全な整数値（|x| < 2^53）。それ以外は float（型の省略は repr／g の変形）。
  if (intType || (type === '' && prec == null && !z && Number.isSafeInteger(x))) {
    if (!Number.isInteger(x)) throw badType();
    if (z || prec != null || type === 's') throw badType();
    if (type === 'c') {
      if (sign || alt || group || x < 0 || x > 0x10ffff) throw badType();
      return pad(String.fromCodePoint(x), width, fill, align);
    }
    isInt = true;
    const base = { b: 2, o: 8, x: 16, X: 16 }[type] || 10;
    body = BigInt(ax).toString(base);
    if (type === 'X') body = body.toUpperCase();
    if (alt && base !== 10) prefix = '0' + (type === 'X' ? 'X' : type);
    if (group === ',' && base !== 10) throw badType();
  } else {
    if (type === 's') throw badType();
    if (!Number.isFinite(x)) {
      body = Number.isNaN(x) ? 'nan' : 'inf';
      if ('EFG'.includes(type) && type !== '') body = body.toUpperCase();
      if (type === '%') body += '%';
    } else {
      body = floatBody(ax, type, prec, !!alt);
      if ('EG'.includes(type) && type !== '') body = body.toUpperCase();
    }
  }
  const plusSg = sign === '+' ? '+' : sign === ' ' ? ' ' : '';
  let sg = neg ? '-' : plusSg;
  // z（負のゼロを 0 に）: 丸めた結果が 0 の負の float は符号を外す（`f"{-0.0001:z.2f}"` は 0.00）。
  if (z && neg && Number.isFinite(x) && !/[1-9]/.test(body.replace(/e[+-]\d+$/i, ''))) sg = plusSg;
  // 整数部（int は本体全体・float は先頭の数字の並び）に区切りを入れる。'0' 埋めの '=' なら区切りを含めて幅まで 0 で埋める（python3 と
  //   同じ 0,001,234・b／o／x／X の '_' は 4 桁ごと）。
  const im = isInt ? [body] : /^\d+/.exec(body);
  if (im && group) {
    const size = (group === '_' && 'boxX'.includes(type) && type !== '') ? 4 : 3;
    const rest = body.slice(im[0].length);
    const mw = (fill === '0' && align === '=') ? Math.max(0, width - sg.length - prefix.length - rest.length) : 0;
    body = groupDigits(im[0], group, size, mw) + rest;
  }
  return pad(body, width, fill, align, sg + prefix);
}
// f-string の置換フィールド（lexer の FMT・parser の fmt の節）: 変換（'r'・'s'・'a'・''）の後に書式指定。
function pyFormatField(v, conv, spec, line) {
  if (conv === 'r') v = pyRepr(v, false);
  else if (conv === 'a') v = pyRepr(v, true);
  else if (conv === 's') v = pyStr(v);
  return formatValue(v, spec, line);
}
// str.format（位置 `{}`・番号 `{0}`・名前 `{a}`〔キーワード引数 kw〕・添字 `{0[1]}`／`{a[k]}`・変換 `!r`/`!s`/`!a`・書式指定〔入れ子の
//   `{}` を 1 段まで・自動の番号は外側のフィールドの次〕・`{{`/`}}`）。python3 の ValueError／IndexError／KeyError に当たるものは
//   行番号付きの実行時エラー（fmtBrace＝単独の `{`／`}`・fmtField＝当てはまる引数が無い／属性 `.x`（未対応）・fmtMix＝自動の番号と
//   番号指定の混在・fmtSpec／fmtType は f-string と同じ）。是正前（v10.2.0）は正規表現 `\{(\d*)(?::[^}]*)?\}` で `{}`/`{n}` だけを
//   素の str 化し、書式指定・名前・変換・`{{` は無視（`"{:.2f}".format(x)` は 3.14159・`"{a}"` はそのまま残った）。
function pyStrFormat(tpl, args, kw, line) {
  const st = { auto: 0, mode: null };
  const render = (s, depth) => {
    let out = '', i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '}') {
        if (s[i + 1] === '}') { out += '}'; i += 2; continue; }
        throw new RuntimeError('fmtBrace', {}, line);
      }
      if (c !== '{') { out += c; i++; continue; }
      if (s[i + 1] === '{') { out += '{'; i += 2; continue; }
      if (depth >= 2) throw new RuntimeError('fmtSpec', { spec: s }, line);   // python3: Max string recursion exceeded
      // 対応する `}` まで（入れ子の `{…}` を数える）。
      let j = i + 1, d = 1;
      for (; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) break; }
      if (j >= s.length) throw new RuntimeError('fmtBrace', {}, line);
      const body = s.slice(i + 1, j);
      // フィールド名（`[` … `]` の中の `:`・`!` は区切りにしない）・変換・書式指定。
      let k = 0;
      for (; k < body.length; k++) {
        if (body[k] === '[') { const e = body.indexOf(']', k); if (e < 0) { k = body.length; break; } k = e; continue; }
        if (body[k] === ':' || body[k] === '!') break;
      }
      const name = body.slice(0, k);
      let conv = '', spec = '';
      if (body[k] === '!') {
        conv = body[k + 1] || '';
        if (!'rsa'.includes(conv) || conv === '' || (k + 2 < body.length && body[k + 2] !== ':')) throw new RuntimeError('fmtSpec', { spec: body.slice(k) }, line);
        k += 2;
      }
      if (body[k] === ':') spec = body.slice(k + 1);
      const v = fieldValue(name);
      const sp = spec.includes('{') || spec.includes('}') ? render(spec, depth + 1) : spec;
      out += pyFormatField(v, conv, sp, line);
      i = j + 1;
    }
    return out;
  };
  const noArg = (name) => new RuntimeError('fmtField', { field: name }, line);
  function fieldValue(name) {
    const hm = /^[^.[]*/.exec(name), head = hm[0];
    let rest = name.slice(head.length), v;
    if (head === '' || /^\d+$/.test(head)) {
      const want = head === '' ? 'auto' : 'manual';
      if (st.mode && st.mode !== want) throw new RuntimeError('fmtMix', {}, line);
      st.mode = want;
      const idx = head === '' ? st.auto++ : Number(head);
      if (idx >= args.length) throw noArg(name);
      v = args[idx];
    } else {
      if (!kw || !Object.prototype.hasOwnProperty.call(kw, head)) throw noArg(name);
      v = kw[head];
    }
    while (rest) {
      const im = /^\[([^\]]*)\]/.exec(rest);
      if (!im) throw noArg(name);   // `.属性`（未対応）・壊れた添字
      const key = /^\d+$/.test(im[1]) ? Number(im[1]) : im[1];
      if (v == null || typeof v !== 'object' && typeof v !== 'string') throw noArg(name);
      if (Array.isArray(v) || typeof v === 'string' ? !(typeof key === 'number' && key < v.length) : !Object.prototype.hasOwnProperty.call(v, key)) throw noArg(name);
      v = v[key];
      rest = rest.slice(im[0].length);
    }
    return v;
  }
  return render(String(tpl), 0);
}
// BK4 層4 F7 の兄弟: py は引数の文字列化を pyStr（None は 'None'・bool は True／False）。是正前（None が null になってから）は String で
//   `"anullb".replace(None, "x")` が axb・`"null".find(None)` が 0（JS の "null"）。python3 は文字列以外の引数が TypeError＝残る差（文字列にして
//   通す・数は従来どおり）。C は従来どおり String。各ファクトリは (受け手, py) を受ける。
const sOf = (py) => (py ? pyStr : String);
const STR_METHODS = {
  upper: (s) => () => s.toUpperCase(),
  lower: (s) => () => s.toLowerCase(),
  strip: (s, py) => (c) => c == null ? s.trim() : trimChars(s, sOf(py)(c), true, true),
  lstrip: (s, py) => (c) => c == null ? s.replace(/^\s+/, '') : trimChars(s, sOf(py)(c), true, false),
  rstrip: (s, py) => (c) => c == null ? s.replace(/\s+$/, '') : trimChars(s, sOf(py)(c), false, true),
  replace: (s, py) => (a, b) => s.split(sOf(py)(a)).join(sOf(py)(b)),
  split: (s, py) => (sep) => sep == null ? s.trim().split(/\s+/).filter((x) => x !== '') : s.split(sOf(py)(sep)),
  startswith: (s, py) => (p) => s.startsWith(sOf(py)(p)),
  endswith: (s, py) => (p) => s.endsWith(sOf(py)(p)),
  find: (s, py) => (x) => s.indexOf(sOf(py)(x)),
  count: (s, py) => (x) => { const t = sOf(py)(x); return t === '' ? s.length + 1 : s.split(t).length - 1; },
  // format は evalCall が直接 pyStrFormat を呼ぶ（BK3: キーワード引数と実行時エラーの行を渡すため）。
  // BK4 層4 F7: py は要素を pyStr（True／False／None。是正前は null・true）。python3 は文字列以外の要素が TypeError＝残る差（数も通す・従来どおり）。
  join: (s, py) => (arr) => (Array.isArray(arr) ? arr : [arr]).map(sOf(py)).join(s),
};
// BK4 (8)(11): count／index／remove は要素を pySame（== と同じ規則＝bool と数を数として・list は要素ごと）で比べる。index と remove は
//   見つからなければ行番号付きの実行時エラー interp.err.notInList（python3 は ValueError）。index の start／end は python3 と同じ（負は末尾から）。
//   是正前は JS の indexOf／===（`[True].count(1)` は 0・`[1].index(True)` は -1）で、index は見つからないと -1・remove は黙って何もしない。
const LIST_METHODS = {
  append: (a) => (x) => { a.push(x); },
  pop: (a) => (i) => (i == null ? a.pop() : a.splice(i, 1)[0]),
  insert: (a) => (i, x) => { a.splice(i, 0, x); },
  remove: (a, line) => (x) => {
    const k = a.findIndex((e) => pySame(x, e));
    if (k < 0) throw new RuntimeError('notInList', { method: 'remove' }, line);
    a.splice(k, 1);
  },
  index: (a, line) => (x, start, end) => {
    const n = a.length;
    const at = (v, d) => { if (v === undefined) return d; v = Number(v); return v < 0 ? Math.max(0, v + n) : Math.min(v, n); };
    for (let k = at(start, 0), e = at(end, n); k < e; k++) if (pySame(x, a[k])) return k;
    throw new RuntimeError('notInList', { method: 'index' }, line);
  },
  count: (a) => (x) => a.reduce((c, e) => c + (pySame(x, e) ? 1 : 0), 0),
  extend: (a) => (o) => { for (const e of (Array.isArray(o) ? o : [])) a.push(e); },
  sort: (a) => () => { a.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)); },
  reverse: (a) => () => { a.reverse(); },
  clear: (a) => () => { a.length = 0; },
  copy: (a) => () => a.slice(),
};
// BK4 (8): get／pop のキーの bool は数（`{1: "a"}.get(True)` は "a"・dict のリテラル・添字・in と同じ pyKey）。
const DICT_METHODS = {
  get: (o) => (k, d) => { k = pyKey(k); return k in o ? o[k] : (d === undefined ? null : d); },
  keys: (o) => () => Object.keys(o),
  values: (o) => () => Object.keys(o).map((k) => o[k]),
  items: (o) => () => Object.keys(o).map((k) => mkTuple([k, o[k]])),   // BK4 層4 F2: 組は tuple（python3 と同じ）
  pop: (o) => (k, d) => { k = pyKey(k); if (k in o) { const v = o[k]; delete o[k]; return v; } return d === undefined ? null : d; },
  clear: (o) => () => { for (const k of Object.keys(o)) delete o[k]; },
};
// 受け手の型に応じた Python メソッドを返す (無ければ null → 呼び出し側がネイティブ経路へ)。line＝実行時エラーの行（BK4: list の index／remove）・
//   lang＝言語（BK4 層4 F7: py の str.join の要素の文字列化）。
function pyMethod(obj, name, line, lang) {
  if (typeof obj === 'string') { const f = STR_METHODS[name]; return f ? f(obj, lang === 'py') : null; }
  if (Array.isArray(obj)) { const f = LIST_METHODS[name]; return f ? f(obj, line) : null; }
  if (obj && typeof obj === 'object') { const f = DICT_METHODS[name]; return f ? f(obj, line) : null; }
  return null;
}

// AP16: Python 風の printf フォーマット ("x=%d"%5 → "x=5")。%d/%i/%s/%f(.N)/%x/%X/%% を最小サポート。
// 引数はタプル (配列) or 単一値。位置は左から順に消費。未知指定子はそのまま残す。
// (str.format の `{}`-式 pyStrFormat〔BK3〕とは別＝`%` 演算子専用。)
// BK4 層4 F4: `%s` の pyStr（True／False／None）は py だけ（C は従来どおり String＝"true"）。F9: py で None を数の指定子（d i f x X）に渡すと
//   実行時エラー interp.err.noneOp（python3 は TypeError: %d format: a real number is required…）。是正前は数の 0（"0"・"0.000000"）。
function pyPercentFormat(fmt, args, line, py) {
  const list = Array.isArray(args) ? args : [args];
  let i = 0;
  return String(fmt).replace(/%%|%(-?\d+)?(?:\.(\d+))?([sdifxX])/g, (m, _w, prec, conv) => {
    if (m === '%%') return '%';
    const v = list[i++];
    if (py && v === null && conv !== 's') throw new RuntimeError('noneOp', { op: '%' }, line);
    switch (conv) {
      case 'd': case 'i': return String(Math.trunc(Number(v)));
      case 'f': return Number(v).toFixed(prec != null ? +prec : 6);
      case 's': return py ? pyStr(v) : String(v);   // BK4 (5): py の `"%s" % True` は True（是正前は true）・C は従来どおり
      case 'x': return Math.trunc(Number(v)).toString(16);
      case 'X': return Math.trunc(Number(v)).toString(16).toUpperCase();
      default: return m;
    }
  });
}

// BJ2: Python の剰余（床剰余）。結果の符号は除数に従う（-7 % 2 = 1・7 % -2 = -1・-7.5 % 2 = 0.5）。
//   CPython の float 剰余と同じ手順: fmod（＝JS の %・切り捨て剰余）の符号が除数と違えば除数を足す。
//   余りが 0 のときは +0 を返す（Python の int は符号付きゼロを持たない。本処理系は int と float を区別しない）。
//   // は BK4 (11) で pyFloorDiv（下）。
function pyMod(a, b) {
  const r = a % b;
  if (r === 0) return 0;
  return (r < 0) !== (b < 0) ? r + b : r;
}
// BK4 (11): Python の //（床除算）。CPython の float の divmod と同じ手順: fmod（JS の %）の余りを引いてから割り（(a - mod) / b は丸めの
//   誤差が出ない）、余りの符号が除数と違えば 1 を引き、0.5 を超えて床に落ちたら戻す。是正前は Math.floor(a / b)＝a / b を先に丸めるので
//   `1 // 0.1` が 10（python3 は 9.0＝0.1 の 2 進の値は 0.1 より僅かに大きい）。整数同士（|x| < 2^53）は Math.floor(a / b) と同じ値。
//   商が 0 のときは +0（pyMod と同じく符号付きゼロを返さない＝python3 の int と同じ。float の `-0.0 // 5` は python3 では -0.0）。
//   ±inf と nan は python3 と同じ（`inf // 1` は nan・`-1 // inf` は -1）。
function pyFloorDiv(a, b) {
  const mod = a % b;
  let div = (a - mod) / b;
  if (mod !== 0 && (b < 0) !== (mod < 0)) div -= 1;
  if (div === 0) return 0;
  let fd = Math.floor(div);
  if (div - fd > 0.5) fd += 1;
  return fd;
}
// BJ2: Python の ==。bool と数の組は数として比べる（True == 1・False == 0・True == 1.0 は真・True != 0 も真）。
//   それ以外は従来どおり ===（"1" == 1 は偽・数同士・bool 同士・文字列同士は値で一致・None 同士は真）。
// BK4 (6): list／tuple 同士は seqEq（長さと要素ごとの pySame・入れ子も同じ規則・python3 と同じく要素の同一性を先に見る）。是正前は同一性
//   （`[1, 2] == [1, 2]` は偽）。層4 F2: list と tuple は等しくない（`(1, 2) == [1, 2]` は False・python3 と同じ。tuple は TUPLES の印）。
//   残る差: dict の == は同一性のまま。
const TUPLES = new WeakSet();
function mkTuple(arr) { TUPLES.add(arr); return arr; }
function pyEq(a, b) {
  if ((typeof a === 'boolean' && typeof b === 'number') || (typeof a === 'number' && typeof b === 'boolean')) return Number(a) === Number(b);
  if (Array.isArray(a) && Array.isArray(b)) return seqEq(a, b);
  return a === b;
}
// BK4 (6)・層4 F5: list／tuple の要素ごとの比較を、再帰でなく明示のスタックで行う（入れ子が約 9000 段でも JS の呼び出しスタックを使わない。
//   python3 3.14.4 も 9000 段の == は True を返す・実測）。自分自身を要素に持つ別々の list 同士（`a.append(a)`・`b.append(b)` の a == b）は、
//   比べている途中の同じ組（いまスタックにある組）に戻ったら等しいとみなす（python3 は RecursionError＝残る差）。要素は先頭から順に比べ、
//   違いが出たらそこで止める（再帰の版と同じ順序）。
function seqEq(a0, b0) {
  const stack = [], onPath = new Map();
  // 組 (x, y) を開く。等しくないと決まれば false。同じもの・途中の組は開かずに true。
  const open = (x, y) => {
    if (x === y) return true;
    if (TUPLES.has(x) !== TUPLES.has(y) || x.length !== y.length) return false;
    let ys = onPath.get(x);
    if (ys && ys.has(y)) return true;
    if (!ys) onPath.set(x, ys = new Set());
    ys.add(y);
    stack.push({ x, y, i: 0 });
    return true;
  };
  if (!open(a0, b0)) return false;
  while (stack.length) {
    const f = stack[stack.length - 1];
    if (f.i >= f.x.length) { stack.pop(); onPath.get(f.x).delete(f.y); continue; }
    const u = f.x[f.i], v = f.y[f.i];
    f.i++;
    if (Array.isArray(u) && Array.isArray(v)) { if (!open(u, v)) return false; }
    else if (!pySame(u, v)) return false;
  }
  return true;
}
// BK4: list の要素の比較（==・in・count・index・remove）。python3 の PyObject_RichCompare の同一性の近道と同じく、同じもの（Object.is＝
//   同じ list・同じ nan）は等しい。それ以外は pyEq。
function pySame(x, e) { return Object.is(x, e) || pyEq(x, e); }
// BK4 (8): dict のキー。bool は数（Python の True は 1 と同じキー）。dict のキーは JS のプロパティ名（文字列）のままの模型。
//   層4 F7: None は 'None'（表示も None・`"null" in {None: 1}` は False。是正前は JS の "null"）。残る差: `"None" in {None: 1}` は True（`"1" in {1: …}` と同じ）。
function pyKey(k) { return typeof k === 'boolean' ? Number(k) : k === null ? 'None' : k; }
// BK2 (10): Python の in／not in（parser_py の comparison が比較演算子と同じ段で読む＝連鎖も同じ規則）。list／tuple＝要素のどれかと
//   ==（BK4 から pySame＝bool と数を数として比べ、要素がリストのときは要素ごと＝(6) の是正と同じ規則）・str＝部分文字列
//   （左も str のときだけ。python3 は左が str でなければ TypeError）・dict＝キー（d[k]／d.get(k) と同じく、キーは文字列にして引く＝
//   `"1" in {1: "a"}` も真〔python3 は偽〕。dict のキーの型を持たない従来の模型のまま。BK4 (8) から bool のキーは数＝`True in {1: "a"}` は真）。
//   それ以外（数・None・関数）は python3 と同じくエラー（python3 3.14 は TypeError: argument of type 'int' is not a container or iterable）。
function pyIn(a, b, line) {
  if (Array.isArray(b)) return b.some((e) => pySame(a, e));
  if (typeof b === 'string') {
    if (typeof a !== 'string') throw new RuntimeError('inStrLeft', {}, line);
    return b.includes(a);
  }
  if (b && typeof b === 'object') return Object.prototype.hasOwnProperty.call(b, pyKey(a));   // BK4 (8): `True in {1: "a"}` は真
  throw new RuntimeError('inRight', {}, line);
}

// line = 直近実行文の行 (ゼロ除算/未対応演算子エラーに付与)。AP17: i18n キー化 (interp.err.*)。
// BJ2: lang = 'py' | 'c'（Interp.load が ast.lang から決める this.lang）。py だけ % を床剰余・== / != を pyEq にする。
//   C は無改変（C の % は切り捨て剰余＝JS の % と同じ・== は === のまま）。
// BK4 (3): py の除数の False と 0 の負のべき（`0 ** -1`・`0.0 ** -1.5`・`False ** -2`）も divZero（python3 は ZeroDivisionError）。是正前は
//   `1 / False`・`1 // False` が Infinity・`7 % False` が NaN・`0 ** -1` が Infinity。C は従来どおり（除数の 0 だけ）。
// BK4: py の None（null）を ==・!=・in・not in 以外の演算子に使うと実行時エラー interp.err.noneOp（python3 は TypeError）。左が文字列の `%`
//   （書式）はここでは通し、書式の中の扱いは pyPercentFormat が決める（`%s` は None・数の指定子 d i f x X は noneOp）。是正前は None が数の 0 で、
//   `None + 1` は 1・`1 / None` は divZero。
const NONE_OK = ['==', '!=', 'in', 'not in'];
function applyBin(op, a, b, line, lang) {
  const divErr = () => new RuntimeError('divZero', {}, line);   // AP16→AP17: /0 → 行番号付き i18n 実行時エラー
  const py = lang === 'py';
  if (py && (a === null || b === null) && !NONE_OK.includes(op) && !(op === '%' && typeof a === 'string')) throw new RuntimeError('noneOp', { op }, line);
  const zero = (v) => v === 0 || (py && v === false);
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
      if (zero(b)) throw divErr();
      return a / b;
    // AP16: py 文字列フォーマット ("x=%d"%5 → "x=5")。数値%数値は剰余 (0 剰余はエラー)。
    case '%':
      if (typeof a === 'string') return pyPercentFormat(a, b, line, py);
      if (zero(b)) throw divErr();
      return lang === 'py' ? pyMod(a, b) : a % b;
    case '**':
      // BK4 層4 F6: 指数が -inf のときは除く（`0 ** -math.inf` は python3 も inf）。
      if (py && zero(a) && b < 0 && b !== -Infinity) throw divErr();
      return Math.pow(a, b);
    case '//':   // py だけ（C の // はコメント）
      if (zero(b)) throw divErr();
      return pyFloorDiv(a, b);
    case '&': return a & b;
    case '|': return a | b;
    case '^': return a ^ b;
    case '<<': return a << b;
    case '>>': return a >> b;
    case '==': return lang === 'py' ? pyEq(a, b) : a === b;
    case '!=': return lang === 'py' ? !pyEq(a, b) : a !== b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    case 'in': return pyIn(a, b, line);          // BK2 (10): py だけ（parser_py の comparison）
    case 'not in': return !pyIn(a, b, line);
    default: throw new RuntimeError('badOp', { op }, line);
  }
}
