// 国際化 (i18n) ランタイム (Phase N)。
// メッセージ本文は messages.js に分離 (プログラム埋め込みにしない)。
//   - t(key, vars)      … キー→現在言語の文字列。未翻訳は ja フォールバック。{var} 補間。
//   - applyI18n(root)   … data-i18n / data-i18n-title / data-i18n-placeholder / data-i18n-aria を流し込む。
//   - getLang/setLang   … 言語の取得/切替 (localStorage 'rumicar.lang' に永続化)。
//   - warnMissing()     … 欠落キー (ja/en 空) と未登録キーを console.warn 集約 (更新漏れ早期検出)。
import { MESSAGES } from './i18n/messages.js';

const LS_KEY = 'rumicar.lang';
const SUPPORTED = ['ja', 'en'];

// 既定言語: ブラウザ設定が日本語なら ja、それ以外は en。
function detectDefault() {
  let nav = '';
  try { nav = (navigator.language || navigator.userLanguage || '').toLowerCase(); } catch (e) { /* 非ブラウザ環境 */ }
  return nav.startsWith('ja') ? 'ja' : 'en';
}

let curLang = (() => {
  try { const s = localStorage.getItem(LS_KEY); if (SUPPORTED.includes(s)) return s; } catch (e) { /* private mode 等 */ }
  return detectDefault();
})();

export function getLang() { return curLang; }

// キー → 文字列 (現在言語。空/欠落は ja フォールバック。最後の手段はキー名)。
export function t(key, vars) {
  const e = MESSAGES[key];
  let s = key;
  if (e) s = (e[curLang] != null && e[curLang] !== '') ? e[curLang] : (e.ja != null ? e.ja : key);
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

// カタログにキーが存在するか (動的キーの存在チェック用。車種名 car.<key> など、
// カタログに無いキー＝カスタム車種は呼び出し側で name フォールバックする)。
export function hasKey(key) { return Object.prototype.hasOwnProperty.call(MESSAGES, key); }

// data-i18n* 属性を持つ要素にテキスト/属性を流し込む。
export function applyI18n(root) {
  root = root || (typeof document !== 'undefined' ? document : null);
  if (!root) return;   // 非DOM環境 (Node ゲート) では no-op ＝ setLang() を Node からも安全に呼べる
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  // data-i18n-html: 長文/数式など rich HTML をそのまま差し込む (カタログは自前の信頼コンテンツ)。
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  // data-i18n-aria: アイコンのみのボタン (モーダル× 等) のアクセシブル名 (RC-A11Y-001)。
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}

// 言語を切り替えて永続化し、静的UIへ即時反映する。
// (fleet カード等の動的生成テキストの再描画は呼び出し側 main.js が onLangChange で行う＝N3 で拡張)
let onChange = null;
export function setOnLangChange(fn) { onChange = fn; }

export function setLang(lang) {
  if (!SUPPORTED.includes(lang) || lang === curLang) return;
  curLang = lang;
  try { localStorage.setItem(LS_KEY, lang); } catch (e) { /* 保存不可でも動作 */ }
  try { document.documentElement.lang = lang; } catch (e) { /* noop */ }
  applyI18n();   // 引数省略＝applyI18n 内で document を解決 (非DOM環境では no-op)
  if (onChange) onChange(lang);
}

// 起動時の更新漏れ検出: カタログの空キーと、HTML が参照するのにカタログに無いキー。
export function warnMissing() {
  const miss = [];
  for (const k in MESSAGES) {
    const m = MESSAGES[k] || {};
    if (m.ja == null || m.ja === '') miss.push(k + ' (ja 空)');
    if (m.en == null || m.en === '') miss.push(k + ' (en 空)');
  }
  try {
    const attrs = [['i18n'], ['i18nTitle'], ['i18nPlaceholder'], ['i18nHtml'], ['i18nAria']];
    document.querySelectorAll('[data-i18n],[data-i18n-title],[data-i18n-placeholder],[data-i18n-html],[data-i18n-aria]').forEach((el) => {
      for (const [a] of attrs) { const key = el.dataset[a]; if (key && !MESSAGES[key]) miss.push(key + ' (カタログ未登録)'); }
    });
  } catch (e) { /* 非DOM環境 */ }
  if (miss.length) console.warn('[i18n] 未翻訳/欠落キー: ' + miss.join(', '));
}
