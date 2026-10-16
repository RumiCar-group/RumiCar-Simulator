// escape.js — BL4: innerHTML に入れる値のエスケープ (main.js の escapeHtml を DOM に触れない module へ分離)。
// main.js が import し、依存注入で race_ui.js・car_crud.js へ同じ関数を渡す (各モジュールの `esc`／`escapeHtml`)。
//
// 規則: & < > " を実体参照へ置き換える。' は対象外 (属性の値は " で囲む前提。' 囲み・引用符なしの属性に入れると抜け出せる)。
//   検査の範囲: wf_bl1_ui.mjs G-4c が car_crud.js・race_ui.js のテンプレート文字列 (`…${…}…`) の属性の値の引用符を読む
//   (' 囲み・引用符なしは赤)。ほかのファイル・文字列の連結 ('…="' + x + '"') は検査していない (G-4 は ${…} の中の式だけを見る)。
// 文字列化は String(s) のまま (数値・null・undefined・Symbol は従来どおり "5"・"null"・"undefined"・"Symbol()")。
// String(s) が投げる値は '?' にする: {"toString":1} のように toString/valueOf が文字列を返さない object
// (JSON から作れる)・Object.create(null)・読み出しで投げる Proxy。他人が書いた entries・event.json・投稿車種・
// localStorage の自作車から届きうる。旧実装は TypeError を投げ、🏆 の詳細の描画がそこで止まった (決定ログ BL-3)。
export function escapeHtml(s) {
  let str;
  try { str = String(s); } catch (e) { str = '?'; }
  return str.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
