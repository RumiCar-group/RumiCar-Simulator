// AP4: localStorage 書込の安全化ヘルパ。
// 従来 data 系 3 経路 (練習ベスト / 自作コース / 独自車種) は `try{setItem}catch(e){}` で
// 保存失敗 (QuotaExceededError・private mode 等) を握りつぶしており、利用者に不可視だった。
// safeSetItem は失敗を捨てず false を返し、登録済みハンドラ経由で 1 行通知する
// (設定系トグルは失敗しても実害が小さいので従来どおり raw setItem のまま = スコープ外)。
//
// data 系識別子 `what` は安定 id ('best' | 'course' | 'car')。i18n を持たない lap.js /
// course_editor.js からも呼べるよう、文言化は main.js 側の登録ハンドラに委ねる (関心分離)。

let _onFail = null;

// 保存失敗時に呼ぶハンドラを登録する (通常 main.js が i18n + logLine で 1 行通知)。
export function setStoreFailHandler(fn) { _onFail = fn; }

// localStorage.setItem のラッパ。成功=true / 失敗=false。失敗時のみハンドラを 1 回呼ぶ。
export function safeSetItem(key, value, what) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (_onFail) { try { _onFail(what, e); } catch (_) { /* 通知失敗でも保存結果は false のまま返す */ } }
    return false;
  }
}
