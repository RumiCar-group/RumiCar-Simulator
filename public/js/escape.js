// escape.js — BL4: innerHTML に入れる値のエスケープ (main.js の escapeHtml を DOM に触れない module へ分離)。
// main.js が import し、依存注入で race_ui.js・car_crud.js へ同じ関数を渡す (各モジュールの `esc`／`escapeHtml`)。
//
// 規則: & < > " を実体参照へ置き換える。' は対象外 (属性はすべて " で囲む＝wf_bl1_ui.mjs G-4 が配線を検査する)。
// 文字列化は String(s) のまま (数値・null・undefined・Symbol は従来どおり "5"・"null"・"undefined"・"Symbol()")。
// String(s) が投げる値は '?' にする: {"toString":1} のように toString/valueOf が文字列を返さない object
// (JSON から作れる)・Object.create(null)・読み出しで投げる Proxy。他人が書いた entries・event.json・投稿車種・
// localStorage の自作車から届きうる。旧実装は TypeError を投げ、🏆 の詳細の描画がそこで止まった (決定ログ BL-3)。
export function escapeHtml(s) {
  let str;
  try { str = String(s); } catch (e) { str = '?'; }
  return str.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
