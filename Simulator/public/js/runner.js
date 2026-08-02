// ユーザーコードを解析し、実行モデル (setup/loop or while ループ) を確定して
// Controller { setup(), tick() } を返す。
import { parseC } from './interp/parser_c.js';
import { parsePy } from './interp/parser_py.js';
import { Interp } from './interp/evaluator.js';

function isTrueLiteral(cond) {
  return cond && ((cond.t === 'bool' && cond.v === true) || (cond.t === 'num' && cond.v !== 0));
}

export function buildController(src, lang, hostEnv) {
  if (lang === 'js') return buildJs(src, hostEnv);

  const ast = (lang === 'c') ? parseC(src) : parsePy(src);
  const interp = new Interp(hostEnv);
  interp.load(ast);

  const line = () => interp.curLine;   // 直近に実行した行 (実行位置ハイライト用)

  // Model A: loop() 関数あり
  if (interp.has('loop')) {
    return {
      setup() {
        interp.resetSteps();
        interp.execBlock(interp.topStmts, interp.global); // グローバル変数初期化
        if (interp.has('setup')) interp.callUser('setup', []);
      },
      tick() { interp.resetSteps(); interp.callUser('loop', []); },
      line,
      interp,   // AO10: 検証オラクル専用の読み取り口 (interp.global.vars でプログラムのグローバルを観測)。
    };         //       本番の実行経路は一切参照しない (byte/verifyHash 不変)。プログラムへ course は渡さない (D-1)。
  }

  // Model B: while True ループ
  const idx = interp.topStmts.findIndex(s => s.t === 'while' && isTrueLiteral(s.cond));
  if (idx >= 0) {
    const pre = interp.topStmts.slice(0, idx);
    const loopBody = interp.topStmts[idx].body;
    return {
      setup() { interp.resetSteps(); interp.execBlock(pre, interp.global); },
      tick() { interp.resetSteps(); interp.execBlock(loopBody, interp.global); },
      line,
      interp,   // AO10: 同上 (検証オラクル専用の読み取り口)。
    };
  }

  // それ以外: 一度だけ実行
  return {
    setup() { interp.resetSteps(); interp.execBlock(interp.topStmts, interp.global); },
    tick() {},
    line,
    interp,   // AO10: 同上 (検証オラクル専用の読み取り口)。
  };
}

function buildJs(src, hostEnv) {
  const keys = Object.keys(hostEnv);
  const vals = keys.map(k => hostEnv[k]);
  const factory = new Function(...keys,
    `"use strict";\n${src}\n;return {` +
    `setup: (typeof setup!=='undefined')?setup:null,` +
    `loop: (typeof loop!=='undefined')?loop:null};`);
  const api = factory(...vals);
  return {
    setup() { if (api.setup) api.setup(); },
    tick() { if (api.loop) api.loop(); },
    line() { return 0; },   // JS (ネイティブ実行) は行追跡非対応
    interp: null,           // AO10: JS ネイティブ実行はツリー interp を持たない (オラクルは py/c サンプルのみ観測)。
  };
}
