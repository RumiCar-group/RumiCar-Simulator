// 常設ゲート: index.html の <link rel="modulepreload"> が「実測で選んだ方針」どおりであることを機械検査する。
//
// ── 何のための preload か (Stage AS2・実測で方針を決めた経緯を残す) ─────────────────
// ES モジュールはブラウザが「読んで初めて次の import が分かる」ため、エントリの**直接依存でない**
// モジュール (深さ 2 以上) は 2 往復目まで発見されない。実測 (browser/check_startup.mjs・本番 h2・
// RTT=40ms/10Mbps・N=5・T_course=ナビ開始→初回コース描画) では:
//
//   preload なし                     T_course 678ms / FCP 280ms
//   全 40 本を preload               T_course 618ms / FCP 516ms   ← FCP が壊滅的に悪化
//   深さ2以上の 11 本を preload      T_course 595ms / FCP 340ms   ← まだ FCP が 60ms 悪化
//   深さ2以上の 11 本 + priority=low T_course 592ms / FCP 348ms   ← 優先度では直らない
//   messages.js だけ preload         T_course 616ms / FCP 284ms   ← **採用**
//
// 悪化の機序は帯域の食い合いである。FCP は stylesheet の到着で決まるのに、h2 は多重化した
// ストリームをほぼ均等に流すため、preload を 1 本足すごとに CSS の取り分が 1/(n+1) に減る。
// **起動ローダー (Stage AA1) が出るまでの空白を伸ばすのは、コース描画を数十 ms 早めるより悪い。**
// よって「発見が遅く、かつ大きい」モジュールだけを preload する — 遅い発見の損 > 1 ストリーム
// 増やす損 が成り立つのは、その 1 本が全 JS 転送量の中で無視できない比率を占めるときだけ。
//
// ── 方針 (このゲートが強制するもの) ───────────────────────────────────────────
//   preload する = 「エントリの直接依存でない (深さ≥2)」 かつ 「gzip 転送量が全 JS の THRESHOLD 以上」
//   それ以外は preload しない。動的 import (コード分割したもの) は絶対に preload しない。
// 一覧を手書きすると必ず腐る (モジュールを足しても誰も気づかず黙って遅くなる) ので、
// 実ソースの import 閉包から機械的に導き、ズレを FAIL にする。
//
// 使い方:
//   node wf_modulepreload.mjs            … 検査のみ (exit 0/1)
//   node wf_modulepreload.mjs --write    … index.html の preload ブロックを方針どおりに書き直す
//   node wf_modulepreload.mjs --report   … 全モジュールの深さ/サイズ表を出す (方針見直し用)
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname, relative } from 'node:path';

const ROOT = new URL('./public/', import.meta.url).pathname;
const HTML = ROOT + 'index.html';
const ENTRY = 'js/main.js';
const THRESHOLD = 0.10;    // 全 JS 転送量に対する比率。これ以上の「深い」モジュールだけ preload する
const MIN_DEPTH = 2;       // エントリ(0)の直接依存(1)は 1 往復目で発見されるので対象外
const BEGIN = '  <!-- modulepreload: 発見が遅く大きいモジュールだけ (wf_modulepreload.mjs が機械生成・手書き禁止) -->';
const END = '  <!-- /modulepreload -->';

// ---- 静的 import / 動的 import の抽出 ------------------------------------------
// 行頭 (インデント可) の import/export に限定して、文字列リテラル中の "import" 誤検出を避ける。
const STATIC_RE = /^[ \t]*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]|^[ \t]*import\s*['"]([^'"]+)['"]/gm;
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const read = (rel) => readFileSync(ROOT + rel, 'utf8');
const rel2 = (from, spec) => relative(ROOT, resolve(ROOT + dirname(from), spec));

function depsOf(rel) {
  const out = [];
  for (const m of read(rel).matchAll(STATIC_RE)) {
    const spec = m[1] ?? m[2];
    if (spec && spec.startsWith('.')) out.push(rel2(rel, spec));
  }
  return out;
}
const dynamicOf = (rel) => [...read(rel).matchAll(DYNAMIC_RE)]
  .map((m) => m[1]).filter((s) => s.startsWith('.')).map((s) => rel2(rel, s));

// BFS で深さつき閉包を作る (深さ = エントリから最短で何段目に発見されるか)。
function closure(entry) {
  const depth = new Map([[entry, 0]]);
  const order = [];
  const dyn = new Set();
  for (let level = [entry], d = 0; level.length; d++) {
    const next = [];
    for (const m of level) {
      for (const x of dynamicOf(m)) dyn.add(x);
      for (const x of depsOf(m)) {
        if (depth.has(x)) continue;
        depth.set(x, d + 1); order.push(x); next.push(x);
      }
    }
    level = next;
  }
  return { depth, order, dyn };
}

const { depth, order, dyn } = closure(ENTRY);
// nginx が返すのと同じ土俵で比べる (gzip_comp_level 6 = nginx-default.conf:11)。
const gz = new Map([[ENTRY, gzipSync(readFileSync(ROOT + ENTRY), { level: 6 }).length]]);
for (const m of order) gz.set(m, gzipSync(readFileSync(ROOT + m), { level: 6 }).length);
const totalGz = [...gz.values()].reduce((a, b) => a + b, 0);

const want = order.filter((m) => depth.get(m) >= MIN_DEPTH && gz.get(m) / totalGz >= THRESHOLD);

if (process.argv.includes('--report')) {
  console.log(`全 JS ${gz.size} 本 / gzip 合計 ${(totalGz / 1024).toFixed(1)}KB   閾値 ${(THRESHOLD * 100).toFixed(0)}% = ${(totalGz * THRESHOLD / 1024).toFixed(1)}KB`);
  for (const m of [ENTRY, ...order].sort((a, b) => gz.get(b) - gz.get(a))) {
    const share = gz.get(m) / totalGz;
    console.log(`  depth=${depth.get(m)}  ${(gz.get(m) / 1024).toFixed(1).padStart(7)}KB  ${(share * 100).toFixed(1).padStart(5)}%  ${m}`
      + (want.includes(m) ? '   ← preload' : ''));
  }
  process.exit(0);
}

const html = readFileSync(HTML, 'utf8');
const inHtml = [...html.matchAll(/<link\s+rel="modulepreload"\s+href="([^"]+)"[^>]*>/g)].map((m) => m[1]);
const lines = want.map((p) => `  <link rel="modulepreload" href="${p}">`).join('\n');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

if (process.argv.includes('--write')) {
  let out;
  if (html.includes(BEGIN) && html.includes(END)) {
    out = html.replace(new RegExp(`${esc(BEGIN)}[\\s\\S]*?${esc(END)}`), `${BEGIN}\n${lines}\n${END}`);
  } else {
    out = html.replace(/(\n\s*<link rel="stylesheet"[^>]*>)/, `$1\n${BEGIN}\n${lines}\n${END}`);
  }
  writeFileSync(HTML, out);
  console.log(`書き込み: modulepreload ${want.length} 件 → index.html`);
  process.exit(0);
}

let fail = 0;
const ok = (label, cond, detail) => { console.log(`${cond ? '  ✓' : '  ✗'} ${label}${detail ? ' — ' + detail : ''}`); if (!cond) fail++; };
const has = new Set(inHtml), need = new Set(want);
const missing = want.filter((p) => !has.has(p));
const extra = inHtml.filter((p) => !need.has(p));
const dynPreloaded = inHtml.filter((p) => dyn.has(p));
const deep = order.filter((m) => depth.get(m) >= MIN_DEPTH);

console.log(`== modulepreload 方針の整合 (エントリ ${ENTRY}) ==`);
console.log(`   静的閉包 ${order.length + 1} 本 / gzip 合計 ${(totalGz / 1024).toFixed(1)}KB`
  + `   深さ≥${MIN_DEPTH} は ${deep.length} 本   動的 import ${dyn.size} 本 (critical path 外)`);
ok(`① 方針が選ぶ ${want.length} 本がすべて preload されている`, missing.length === 0,
   missing.length ? `不足: ${missing.join(' ')}`
   : want.map((m) => `${m} (${(gz.get(m) / 1024).toFixed(1)}KB=${(gz.get(m) / totalGz * 100).toFixed(0)}%)`).join(' '));
ok('② 方針外の preload が無い (FCP を削らない)', extra.length === 0,
   extra.length ? `余分: ${extra.join(' ')}` : '0 件');
ok('③ 動的 import は preload されていない (コード分割を無効化しない)', dynPreloaded.length === 0,
   dynPreloaded.length ? `分割を打ち消す preload: ${dynPreloaded.join(' ')}` : `${dyn.size} 本は遅延のまま`);

console.log(fail ? `\n✗ FAIL ${fail} 件 — 直すには: node wf_modulepreload.mjs --write  (方針の見直しは --report)` : '\n✓ PASS');
process.exit(fail ? 1 : 0);
