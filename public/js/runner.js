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

  // BJ3: 関数の外の文は interp.execTop で走らせる（そこまで届いた break／continue／return を行番号付きの i18n 実行時エラーに
  //   する。是正前は execBlock を素で呼び、信号オブジェクトが表示層へ届いて `[object Object]` になっていた）。
  //   loop()／setup() の直下の break／continue は interp.callUser が同じエラーにする。

  // Model A: loop() 関数あり
  if (interp.has('loop')) {
    return {
      setup() {
        interp.resetSteps();
        interp.execTop(interp.topStmts); // グローバル変数初期化
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
    const post = interp.topStmts.slice(idx + 1);
    // BJ3: tick 1 回＝while True: の本体 1 回。本体の直下で continue したらその回（tick）を終える。break したらループを抜け、
    //   ループの後ろに書いた文（post）をその tick の中で 1 回だけ走らせてプログラムを終える＝以降の tick は何もしない（人間判断②。
    //   Python でループを抜けて後ろの文を走らせ、スクリプトが終わるのと同じ。車は最後の指令のまま＝後ろに停止の指令を書けば
    //   それが最後の指令）。post の中の break／continue／return は execTop がエラーにする。post に 2 つ目の while True: があると、
    //   Model B のループは先頭の 1 つだけなので 1 tick の中で回り切ろうとしてステップ上限エラーになる（決定ログ BJ-8）。
    //   是正前は信号が tick の外へ出て `[object Object]` の実行時エラーで停止し、post は走らなかった。
    let ended = false;
    return {
      setup() { ended = false; interp.resetSteps(); interp.execTop(pre); },
      tick() {
        if (ended) return;
        interp.resetSteps();
        if (interp.execLoopPass(loopBody)) { ended = true; interp.execTop(post); }
      },
      line,
      interp,   // AO10: 同上 (検証オラクル専用の読み取り口)。
    };
  }

  // それ以外: 一度だけ実行
  return {
    setup() { interp.resetSteps(); interp.execTop(interp.topStmts); },
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
