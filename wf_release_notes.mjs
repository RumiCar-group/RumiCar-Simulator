// wf_release_notes.mjs — GitHub Release のノート本文を changelog.js から生成する。
//
// なぜ新しく文章を書かないのか
//   リリースノートの素材は既に `public/js/changelog.js` の CHANGELOG[] にある（版ごとに
//   日本語 note と英語 noteEn）。しかもこれは wf_i18n_check の ⑤ が
//   「全件 noteEn 非空・陳腐化印 h が hash(ja) と一致・先頭版 = APP_VERSION」を機械検査している
//   ＝ **リリースノートの品質が既に常設ゲートで担保されている**。二重に書けば必ずドリフトする。
//
// 使い方:
//   node wf_release_notes.mjs                    … APP_VERSION 1 版ぶん
//   node wf_release_notes.mjs v7.3.0             … 指定した 1 版ぶん
//   node wf_release_notes.mjs v7.3.0 --since v5.1.0
//                                                … v5.1.0 より後 〜 v7.3.0 までを新しい順に列挙
//                                                  (公開スナップショットが飛んでいるときに使う)
//   node wf_release_notes.mjs v7.3.0 --title     … 1 行の Release タイトルだけを出す
//
// 出力は Markdown（英語を主・日本語を <details> に畳む）。GitHub Release の body にそのまま貼れる。
import { CHANGELOG } from './public/js/changelog.js';
import { APP_VERSION } from './public/js/config.js';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const version = argv.find((a) => /^v\d+\.\d+\.\d+$/.test(a)) || APP_VERSION;
const since = opt('--since');

// 版文字列 → 比較可能な数値タプル。3 桁方式 (MAJOR.MINOR.PATCH・CLAUDE.md の採番規約)。
const vnum = (v) => String(v).replace(/^v/, '').split('.').map(Number);
const cmp = (a, b) => { const x = vnum(a), y = vnum(b);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };

const idx = CHANGELOG.findIndex((c) => c.v === version);
if (idx < 0) { console.error(`✗ CHANGELOG に ${version} がありません。`); process.exit(2); }

if (flag('--title')) { console.log(`${version}`); process.exit(0); }

// 対象版の集合 (新しい順)。--since を付けたら「それより後 〜 指定版」まで。
const targets = since
  ? CHANGELOG.filter((c) => cmp(c.v, since) > 0 && cmp(c.v, version) <= 0)
  : [CHANGELOG[idx]];
if (!targets.length) { console.error(`✗ 対象の版がありません (${since} < v <= ${version})。`); process.exit(2); }

const out = [];
if (since && targets.length > 1) {
  out.push(`This release brings the public repository from **${since}** to **${version}**.`);
  out.push('');
  out.push(`> The intermediate versions below were developed and verified in sequence, but only`);
  out.push(`> ${since} and ${version} exist as published snapshots here — the versions in between`);
  out.push(`> are documented rather than tagged, because tagging a tree that is not that version`);
  out.push(`> would be inaccurate. The in-app changelog carries the same notes.`);
  out.push('');
  out.push('---');
  out.push('');
}

for (const c of targets) {
  out.push(`## ${c.v}`);
  out.push('');
  out.push(c.noteEn || '(no English note)');
  out.push('');
  out.push('<details><summary>日本語</summary>');
  out.push('');
  out.push(c.note || '(ノートなし)');
  out.push('');
  out.push('</details>');
  out.push('');
}

// 検証の再現手順は毎回同じなので定型で添える (OSS 利用者がいちばん知りたいこと)。
out.push('---');
out.push('');
out.push('### Verifying this release yourself');
out.push('');
out.push('```sh');
out.push('cd Simulator');
out.push('node wf_run_all.mjs        # the full assertion-gate suite');
out.push('```');
out.push('');
out.push('The suite runs from a fresh clone with no dependencies beyond Node.js.');
out.push('The real-browser checks under `Simulator/browser/` additionally need `npm install` and a display.');

console.log(out.join('\n'));
