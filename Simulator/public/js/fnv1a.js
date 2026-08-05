// 決定論 32-bit FNV-1a 文字列ハッシュ (単一ソース)。Math.random/Date 不使用 = どの環境でも同値。
// 依存ゼロの葉モジュール。race_engine.js (verifyHash/traceHash/tickChecksum) と lap.js (練習記録の
// コース/車種指紋・AP2) が共用する。従来は lap.js が「lap→race_engine→fleet→lap の循環 import を
// 避けるため」同一アルゴリズムをローカル複製していた (定義ドリフトのリスク) — 葉に切り出して統合した。
// アルゴリズム・出力 (8桁 hex) は race_engine.js:81 (v5.1.0 時点) と byte 一致 = 既存の verifyHash・
// 練習記録ハッシュは全て不変。
export function fnv1a(str) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // h *= 16777619 (mod 2^32) をシフト和で (32bit 安全)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}
