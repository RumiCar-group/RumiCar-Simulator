// i18n 陳腐化検知用の決定論的ハッシュ (Phase O / O1・リポジトリ追跡の常設ツール)。
//
// 長文/解説キーの ja 本文から内容印 h を計算する。ja を直して en を直し忘れた
// 「古い英語」を機械検査で落とすため、gate (wf_i18n_check.mjs) と
// rehash (wf_i18n_rehash.mjs) が同一のこのハッシュを共有する (アルゴリズムのドリフト防止)。
//
// FNV-1a 32bit。Math.random / Date を使わない (完全に決定論的＝resume/CI で安定)。
export function hashJa(s) {
  s = String(s == null ? '' : s);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
