// i18n 更新漏れ検査ゲート (Phase N / N4・リポジトリ追跡の常設ゲート)。
//
// 「版アップ時の更新漏れゼロ」を機械検査の失敗として担保する。
// 検査4点:
//   ① 全カタログキーに ja/en の両方が非空であること          … 違反で非ゼロ終了
//   ② index.html の全 data-i18n* キーがカタログに存在すること … 違反で非ゼロ終了
//   ③ カタログの孤児キー (HTML/JS のどこからも参照されない疑い) … 報告のみ (終了コードに影響しない)
//   ④ `h` (ja 内容ハッシュ印) 持ちキーは hash(ja)===h であること … 違反で非ゼロ終了
//      (Phase O・陳腐化検知。ja を直して en を直し忘れた「古い英語」を落とす。
//       `h` を持たないキー＝Phase N 既存の短文は従来どおり ④ 対象外＝後方互換。)
//   ⑤ config.js CHANGELOG の各エントリに noteEn が非空・h=hash(note) であること … 違反で非ゼロ終了
//      かつ先頭エントリの版が APP_VERSION と一致すること (版バンプ時の更新漏れ検知)。
//   ⑥ data/courses.json の各ビルトインコースに name_en/desc_en が非空であること   … 違反で非ゼロ終了
//      (AB4・RC-I18N-001。name があるのに name_en 欠落 / desc があるのに desc_en 欠落で落とす。
//       コース追加時の英語付け忘れを版アップ前に検出する。)
//   ⑦ data/courses.json の各ビルトインコースに難易度 diff∈{1..5} があること          … 違反で非ゼロ終了
//      (AB5・PX-021。コース追加時の難易度メタ付け忘れ=バッジ無表示を版アップ前に検出する。)
//   ⑧ 動的キー族 (t('prefix'+var)) の全展開が MESSAGES に存在し ja/en 非空であること   … 違反で非ゼロ終了
//      (AP21。①〜⑦ は静的リテラルキー前提で、動的構築キーの「カタログ不在」を ②③ とも見逃す。
//       ⑧ は suffix ドメインを本物のソース (PROGRAMS/CAR_PARAM_DOC/REGIMES/evaluator の throw subs)
//       から導出し cross-product 展開を機械検査する。PROGRAMS 追加時のラベル付け忘れ等を版アップ前に検出。)
//
// 使い方:  node wf_i18n_check.mjs        (PASS なら exit 0・違反で exit 1)
//   ④ で落ちたら en を再確認のうえ node wf_i18n_rehash.mjs で h を更新する。
//
// 注: ②③ の HTML スキャンは data-i18n / -title / -placeholder / -html / -aria を対象にする。
//     ③ の孤児判定は「カタログキーが t('key') か data-i18n*='key' に文字列一致するか」で行う。
//     非キー文字列 (createElement('div') 等) はカタログに無いので自然に無視される。
//     i18n キーは動的構築されない (全て静的リテラル) ことを前提とする。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hashJa } from './wf_i18n_hash.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const HTML = join(ROOT, 'public', 'index.html');
const JSDIR = join(ROOT, 'public', 'js');

const { MESSAGES } = await import('./public/js/i18n/messages.js');
const catalogKeys = Object.keys(MESSAGES);

// ---- ⑤ のため: config.js の CHANGELOG / APP_VERSION (en 併記＋陳腐化印 h=hash(note)) ----
const { CHANGELOG, APP_VERSION } = await import('./public/js/config.js');

// ---- ② のため: index.html が参照する data-i18n* キーを抽出 ----
const html = readFileSync(HTML, 'utf8');
const htmlKeys = new Set();
for (const m of html.matchAll(/data-i18n(?:-title|-placeholder|-html|-aria)?="([^"]*)"/g)) htmlKeys.add(m[1]);

// ---- ③ のため: public/js/**/*.js の t('key') リテラルを抽出 (サブディレクトリ再帰＝interp/ 等も走査) ----
// 加えて t('prefix' + var ...) / t(`prefix${var}`) の動的キーは「リテラル接頭辞」を集め、
// その接頭辞で始まるカタログキーを参照済み扱いにする (ループ内 per-program/per-param キーの孤児誤検知を防ぐ)。
// AP17: interp/evaluator.js が t('interp.err.'+sub) を使うため、非再帰だと当該キーを孤児誤検知していた。
const jsKeys = new Set();
const jsPrefixes = new Set();
function walkJs(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) { walkJs(join(dir, ent.name)); continue; }
    if (!ent.name.endsWith('.js')) continue;
    const src = readFileSync(join(dir, ent.name), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*(['"])(.+?)\1/g)) jsKeys.add(m[2]);
    for (const m of src.matchAll(/\bt\(\s*(['"])([^'"]*?)\1\s*\+/g)) jsPrefixes.add(m[2]); // t('prefix' + …)
    for (const m of src.matchAll(/\bt\(\s*`([^`$]*)\$\{/g)) jsPrefixes.add(m[1]);            // t(`prefix${…}`)
  }
}
walkJs(JSDIR);
const prefixList = [...jsPrefixes].filter(Boolean);
const refByPrefix = (k) => prefixList.some((p) => k.startsWith(p));

// ---- ① 空キー検査 ----
const empties = [];
for (const k of catalogKeys) {
  const e = MESSAGES[k] || {};
  if (e.ja == null || e.ja === '') empties.push(`${k} (ja 空)`);
  if (e.en == null || e.en === '') empties.push(`${k} (en 空)`);
}

// ---- ② HTML 参照キーのカタログ存在検査 ----
const unknownHtml = [...htmlKeys].filter((k) => !(k in MESSAGES));

// ---- ③ 孤児キー (HTML/JS のどちらからも参照されない) ----
const orphans = catalogKeys.filter((k) => !htmlKeys.has(k) && !jsKeys.has(k) && !refByPrefix(k));

// ---- ④ 陳腐化検査: `h` 持ちキーは hash(ja)===h ----
const stale = [];
let hCount = 0;
for (const k of catalogKeys) {
  const e = MESSAGES[k] || {};
  if (typeof e.h === 'undefined') continue; // h 無し＝Phase N 既存短文＝対象外
  hCount++;
  const want = hashJa(e.ja);
  if (e.h !== want) stale.push(`${k} (記録 h=${e.h} / 現 ja=${want})`);
}

// ---- ⑤ CHANGELOG 検査: noteEn 非空・h=hash(note)・先頭版=APP_VERSION ----
const clEmpty = [];
const clStale = [];
let clHCount = 0;
for (const e of CHANGELOG) {
  if (e.note == null || e.note === '') clEmpty.push(`${e.v} (note 空)`);
  if (e.noteEn == null || e.noteEn === '') clEmpty.push(`${e.v} (noteEn 空)`);
  if (typeof e.h !== 'undefined') {
    clHCount++;
    const want = hashJa(e.note);
    if (e.h !== want) clStale.push(`${e.v} (記録 h=${e.h} / 現 note=${want})`);
  }
}
const clVerMismatch = (CHANGELOG[0] && CHANGELOG[0].v !== APP_VERSION)
  ? `CHANGELOG 先頭=${CHANGELOG[0] ? CHANGELOG[0].v : '(なし)'} / APP_VERSION=${APP_VERSION}`
  : null;

// ---- ⑥ コース en 整合: courses.json の各ビルトインに name_en/desc_en が非空 ----
// ---- ⑦ コース難易度: 各ビルトインに diff∈{1..5} (AB5・PX-021) ----
const courseEn = [];
const courseDiff = [];
let courseCount = 0;
try {
  const courses = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'courses.json'), 'utf8'));
  if (Array.isArray(courses)) {
    courseCount = courses.length;
    for (const c of courses) {
      const nm = c && c.name ? c.name : '(無名)';
      if (c && c.name && (c.name_en == null || c.name_en === '')) courseEn.push(`${nm} (name_en 空)`);
      if (c && c.desc && (c.desc_en == null || c.desc_en === '')) courseEn.push(`${nm} (desc_en 空)`);
      if (c && c.name && !(Number.isInteger(c.diff) && c.diff >= 1 && c.diff <= 5)) courseDiff.push(`${nm} (diff=${c ? c.diff : '?'})`);
    }
  }
} catch (e) { courseEn.push(`courses.json 読込/解析失敗: ${e.message}`); }

// ---- ⑧ 動的キー族の網羅 (AP21) ----
// ①〜⑦ は「静的リテラルキー」前提。t('prefix'+var) / t(`prefix${var}`) で構築される動的キーは、
// 当該キーがカタログに「無い」場合を ② (HTML のみ) も ③ (接頭辞で参照済み扱いにするため欠落を見逃す)
// も検出できない (例: PROGRAMS に1件追加してラベル4キーを付け忘れても ①〜⑦ 全緑のまま)。
// ⑧ は各族の suffix ドメインを **本物のソース (PROGRAMS/CAR_PARAM_DOC/REGIMES/evaluator の throw subs)**
// から導出し (再実装せず import＝CI-14「実装に答えさせる」)、cross-product 展開の全キーが MESSAGES に
// 存在し ja/en 非空かを保証する。展開1件でも欠落/空なら FAIL。
// 対象は「suffix ドメインが単一ソースから権威的に列挙できる」族に限る:
//   prog.<key>.<level|label|strategy|learns>  … PROGRAMS × 4   (main.js programSelectOptions)
//   interp.err.<sub>                          … evaluator の rt()/RuntimeError() subs ＋ line/stepLimit (AP17)
//   cars.pdoc.<param>                         … CAR_PARAM_DOC              (main.js カー諸元ドキュ)
//   fleet.regime.<name>                       … REGIMES                    (main.js レース結果メタ)
//   course.diff.<1..5>                        … 難易度 1..5 (⑦ と同契約)
//   event.class.<open|spec|budget>            … クラス enum                (main.js evClassLabel ほか・非ガード)
// ※ car.<key> / cars.pdoc.<p>(2955) は hasKey() ガード付きフォールバックのため必須被覆でない＝対象外。
//   race.summary./race.reason./official.status./store.what. は suffix が実行時データ駆動で単一ソース列挙
//   不能＝対象外 (存在するキーの ja/en 空は ① が既に担保)。
const { PROGRAMS } = await import('./public/js/programs.js');
const { CAR_PARAM_DOC, REGIMES } = await import('./public/js/config.js'); // CHANGELOG/APP_VERSION と同モジュール
const errSubs = new Set(['line', 'stepLimit']); // line=" (行 N)" 接尾ヘルパ / stepLimit=StepLimit クラス sub
try {
  const evalSrc = readFileSync(join(JSDIR, 'interp', 'evaluator.js'), 'utf8');
  for (const m of evalSrc.matchAll(/(?:this\.rt|new RuntimeError)\(\s*'([a-zA-Z]+)'/g)) errSubs.add(m[1]);
} catch (e) { /* 走査不能なら line/stepLimit のみ＝下で欠落として顕在化 */ }
const dynFamilies = [
  { prefix: 'prog.', keys: PROGRAMS.flatMap((p) => ['level', 'label', 'strategy', 'learns'].map((s) => `${p.key}.${s}`)), src: `PROGRAMS×4 (${PROGRAMS.length}×4)` },
  { prefix: 'interp.err.', keys: [...errSubs], src: `evaluator subs (${errSubs.size})` },
  { prefix: 'cars.pdoc.', keys: CAR_PARAM_DOC.map(([k]) => k), src: `CAR_PARAM_DOC (${CAR_PARAM_DOC.length})` },
  { prefix: 'fleet.regime.', keys: Object.keys(REGIMES), src: `REGIMES (${Object.keys(REGIMES).length})` },
  { prefix: 'course.diff.', keys: ['1', '2', '3', '4', '5'], src: 'diff 1..5' },
  { prefix: 'event.class.', keys: ['open', 'spec', 'budget'], src: 'クラス enum (3)' },
];
const dynExpected = [];
for (const f of dynFamilies) for (const k of f.keys) dynExpected.push(f.prefix + k);
const dynMissing = []; // カタログに存在しない (① では検出不能な欠落)
const dynEmpty = [];   // 存在するが ja/en 空
for (const k of dynExpected) {
  const e = MESSAGES[k];
  if (!e) { dynMissing.push(k); continue; }
  if (e.ja == null || e.ja === '') dynEmpty.push(`${k} (ja 空)`);
  if (e.en == null || e.en === '') dynEmpty.push(`${k} (en 空)`);
}

// ---- 報告 ----
const line = '─'.repeat(60);
console.log(line);
console.log(`i18n 更新漏れ検査  (カタログ ${catalogKeys.length} キー)`);
console.log(line);

let fail = false;

if (empties.length) {
  fail = true;
  console.log(`\n✗ ① 空キー (ja/en いずれか欠落): ${empties.length} 件`);
  for (const s of empties) console.log(`    - ${s}`);
} else {
  console.log('\n✓ ① 全カタログキーに ja/en 両方が非空');
}

if (unknownHtml.length) {
  fail = true;
  console.log(`\n✗ ② index.html の data-i18n* がカタログに無い: ${unknownHtml.length} 件`);
  for (const s of unknownHtml) console.log(`    - ${s}`);
} else {
  console.log('✓ ② index.html の全 data-i18n* キーがカタログに存在');
}

if (orphans.length) {
  console.log(`\n△ ③ 孤児の疑い (HTML/JS から未参照): ${orphans.length} 件 (報告のみ・非失敗)`);
  for (const s of orphans) console.log(`    - ${s}`);
} else {
  console.log('✓ ③ 孤児キーなし (全カタログキーが HTML/JS から参照される)');
}

if (stale.length) {
  fail = true;
  console.log(`\n✗ ④ 陳腐化 (ja を直したが h 未更新＝en 未再確認の疑い): ${stale.length} 件`);
  for (const s of stale) console.log(`    - ${s}`);
  console.log('    → en を再確認のうえ node wf_i18n_rehash.mjs で h を更新すること');
} else {
  console.log(`✓ ④ 陳腐化なし (h 印つき ${hCount} キーすべて hash(ja)===h)`);
}

if (clEmpty.length || clStale.length || clVerMismatch) {
  fail = true;
  console.log(`\n✗ ⑤ CHANGELOG (config.js) に問題`);
  for (const s of clEmpty) console.log(`    - 空: ${s}`);
  for (const s of clStale) console.log(`    - 陳腐化: ${s}`);
  if (clVerMismatch) console.log(`    - 先頭版不一致: ${clVerMismatch}`);
  if (clStale.length) console.log('    → en を再確認のうえ node wf_i18n_rehash.mjs で h を更新すること');
} else {
  console.log(`✓ ⑤ CHANGELOG: 全 ${CHANGELOG.length} 件 noteEn 非空・h 印 ${clHCount} 件 hash(note)===h・先頭版=APP_VERSION (${APP_VERSION})`);
}

if (courseEn.length) {
  fail = true;
  console.log(`\n✗ ⑥ courses.json コース en 欠落: ${courseEn.length} 件`);
  for (const s of courseEn) console.log(`    - ${s}`);
} else {
  console.log(`✓ ⑥ courses.json: 全 ${courseCount} コースに name_en/desc_en 非空`);
}

if (courseDiff.length) {
  fail = true;
  console.log(`\n✗ ⑦ courses.json コース難易度 diff 欠落/範囲外: ${courseDiff.length} 件`);
  for (const s of courseDiff) console.log(`    - ${s}`);
} else {
  console.log(`✓ ⑦ courses.json: 全 ${courseCount} コースに diff∈{1..5}`);
}

if (dynMissing.length || dynEmpty.length) {
  fail = true;
  console.log(`\n✗ ⑧ 動的キー族の欠落/空 (展開 ${dynExpected.length} キー): 欠落 ${dynMissing.length} 件 / 空 ${dynEmpty.length} 件`);
  for (const s of dynMissing) console.log(`    - 欠落 (① 検出不能): ${s}`);
  for (const s of dynEmpty) console.log(`    - ${s}`);
} else {
  console.log(`✓ ⑧ 動的キー族: 展開 ${dynExpected.length} キー全て存在＋ja/en 非空 [${dynFamilies.map((f) => `${f.prefix}${f.keys.length}`).join(' ')}]`);
}

console.log(`\n${line}`);
if (fail) {
  console.log('結果: FAIL (①②④⑤⑥⑦⑧ のいずれかに違反) — 版アップ前に修正すること');
  process.exit(1);
} else {
  console.log('結果: PASS');
  process.exit(0);
}
