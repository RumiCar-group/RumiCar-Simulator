// wf_version_check.mjs — 版表記の整合 常設ゲート (v5.2.0・BROWSER-1 の再発防止・CI-14)。
//
// 背景: index.html の版バッジ (#appVer) は main.js が起動時に config.APP_VERSION で上書きするため、
// HTML 側のフォールバック文字列 (JS 無効/読込失敗時に見える) が古い版のまま残っても実ブラウザの
// 通常表示・スモークでは検出できない (BROWSER-1 で v5.0.0 のまま v5.1.0 を配っていたのを実検出)。
// 「版の食い違い」は知覚でなく機械で判定する:
//   ① config.js の APP_VERSION が vX.Y.Z 形式である
//   ② CHANGELOG 先頭エントリの v が APP_VERSION と一致する (changelog.js 内コメントの明記規約)
//   ③ index.html の #appVer フォールバック文字列が APP_VERSION と一致する
// exit: 0=全緑 / 1=不一致。
import { readFileSync } from 'node:fs';
import { APP_VERSION } from './public/js/config.js';
// CHANGELOG は Stage AS2 で changelog.js へ分離 (起動 critical path から外すため)。
import { CHANGELOG } from './public/js/changelog.js';

let ok = true;
const fail = (msg) => { ok = false; console.log(`✗ ${msg}`); };
const pass = (msg) => console.log(`✓ ${msg}`);

// ① 形式
if (/^v\d+\.\d+\.\d+$/.test(APP_VERSION)) pass(`APP_VERSION 形式: ${APP_VERSION}`);
else fail(`APP_VERSION が vX.Y.Z 形式でない: ${APP_VERSION}`);

// ② CHANGELOG 先頭
const head = CHANGELOG && CHANGELOG[0] && CHANGELOG[0].v;
if (head === APP_VERSION) pass(`CHANGELOG[0].v 一致: ${head}`);
else fail(`CHANGELOG[0].v (${head}) ≠ APP_VERSION (${APP_VERSION})`);

// ③ index.html フォールバック
const html = readFileSync('public/index.html', 'utf8');
const m = html.match(/id="appVer"[^>]*>([^<]*)</);
if (!m) fail('index.html に #appVer が見つからない (パターン変更ならこのゲートを追随させる)');
else if (m[1].trim() === APP_VERSION) pass(`index.html #appVer フォールバック一致: ${m[1].trim()}`);
else fail(`index.html #appVer フォールバック (${m[1].trim()}) ≠ APP_VERSION (${APP_VERSION})`);

console.log(ok ? '結果: PASS (版表記 3 点一致)' : '結果: FAIL');
process.exit(ok ? 0 : 1);
