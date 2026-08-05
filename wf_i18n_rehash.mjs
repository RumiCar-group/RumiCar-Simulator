// i18n 陳腐化印 `h` の再計算ツール (Phase O / O1・リポジトリ追跡の常設ツール)。
//
// 長文/解説キー (ja/en/h を持つ) の `h` を hash(ja) で再計算し、messages.js を更新する。
// 運用: ja 本文を直す → en を再確認して直す → このツールで h を更新 → wf_i18n_check.mjs PASS。
// (h を更新せず ja だけ直すと wf_i18n_check.mjs ④ が exit 1 で落ちる＝en の直し忘れを検知。)
//
// 使い方:  node wf_i18n_rehash.mjs
//
// 実装注: messages.js を AST でなくテキストで書き換える。値文字列に含まれる `{var}` 補間や
//        ":" "," "h:" 等に惑わされないよう、文字列状態を追う string-aware スキャナで
//        対象キーのオブジェクト範囲と h プロパティを特定する。hash は常に 8 桁 hex＝長さ不変。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hashJa } from './wf_i18n_hash.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MSG = join(ROOT, 'public', 'js', 'i18n', 'messages.js');
const CFG = join(ROOT, 'public', 'js', 'changelog.js');   // Stage AS2: CHANGELOG は config.js から分離
const { MESSAGES } = await import('./public/js/i18n/messages.js');
const { CHANGELOG } = await import('./public/js/changelog.js');

// キー k のオブジェクトリテラル範囲 {start..end} (両端は { と }) を string-aware に求める。
function findEntry(src, key) {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp("(['\"])" + esc + "\\1\\s*:\\s*\\{").exec(src);
  if (!m) return null;
  const open = m.index + m[0].length - 1; // '{' の位置
  let depth = 0, q = null, escd = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (q) { if (escd) escd = false; else if (c === '\\') escd = true; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return { start: open, end: i }; }
  }
  return null;
}

// changelog.js CHANGELOG の各エントリ ({ v: 'vX', ... }) のオブジェクト範囲を版 v で string-aware に求める。
// (各エントリの '{' は ` v:` の直前にある＝v 文字列を見つけ、その手前の '{' から brace-match する。)
function findChangelogEntry(src, v) {
  const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp("v\\s*:\\s*(['\"])" + esc + "\\1").exec(src);
  if (!m) return null;
  const open = src.lastIndexOf('{', m.index);
  if (open < 0) return null;
  let depth = 0, q = null, escd = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (q) { if (escd) escd = false; else if (c === '\\') escd = true; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return { start: open, end: i }; }
  }
  return null;
}

// エントリ文字列内の (文字列の外にある) h プロパティの値を want に差し替える。
function replaceH(entry, want) {
  let q = null, escd = false;
  for (let i = 1; i < entry.length; i++) {
    const c = entry[i];
    if (q) { if (escd) escd = false; else if (c === '\\') escd = true; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === 'h' && /[\s,{]/.test(entry[i - 1])) {
      let j = i + 1; while (/\s/.test(entry[j])) j++;
      if (entry[j] !== ':') continue;
      let k = j + 1; while (/\s/.test(entry[k])) k++;
      const quote = entry[k];
      if (quote !== "'" && quote !== '"') continue;
      let e = k + 1; while (e < entry.length && entry[e] !== quote) { if (entry[e] === '\\') e++; e++; }
      return entry.slice(0, k) + quote + want + quote + entry.slice(e + 1);
    }
  }
  return null;
}

let src = readFileSync(MSG, 'utf8');
const changed = [];
for (const k of Object.keys(MESSAGES)) {
  const e = MESSAGES[k];
  if (!e || typeof e.h === 'undefined') continue;
  const want = hashJa(e.ja);
  if (e.h === want) continue;
  const ent = findEntry(src, k);
  if (!ent) { console.error(`✗ entry が見つからない: ${k}`); process.exit(2); }
  const after = replaceH(src.slice(ent.start, ent.end + 1), want);
  if (after == null) { console.error(`✗ h プロパティが見つからない: ${k}`); process.exit(2); }
  src = src.slice(0, ent.start) + after + src.slice(ent.end + 1);
  changed.push(`${k}: ${e.h} → ${want}`);
}

if (changed.length) {
  writeFileSync(MSG, src);
  console.log(`rehash(messages.js): ${changed.length} 件の h を更新しました`);
  for (const c of changed) console.log(`  - ${c}`);
} else {
  console.log('rehash(messages.js): 更新なし (全 h 印が最新)');
}

// ---- changelog.js CHANGELOG の h=hash(note) を再計算 (h 印を持つエントリのみ) ----
let csrc = readFileSync(CFG, 'utf8');
const clChanged = [];
for (const e of CHANGELOG) {
  if (!e || typeof e.h === 'undefined') continue;
  const want = hashJa(e.note);
  if (e.h === want) continue;
  const ent = findChangelogEntry(csrc, e.v);
  if (!ent) { console.error(`✗ CHANGELOG entry が見つからない: ${e.v}`); process.exit(2); }
  const after = replaceH(csrc.slice(ent.start, ent.end + 1), want);
  if (after == null) { console.error(`✗ CHANGELOG の h プロパティが見つからない: ${e.v}`); process.exit(2); }
  csrc = csrc.slice(0, ent.start) + after + csrc.slice(ent.end + 1);
  clChanged.push(`${e.v}: ${e.h} → ${want}`);
}
if (clChanged.length) {
  writeFileSync(CFG, csrc);
  console.log(`rehash(changelog.js CHANGELOG): ${clChanged.length} 件の h を更新しました`);
  for (const c of clChanged) console.log(`  - ${c}`);
} else {
  console.log('rehash(changelog.js CHANGELOG): 更新なし (全 h 印が最新)');
}
