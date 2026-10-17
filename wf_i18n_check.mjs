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
//   ⑤ changelog.js CHANGELOG の各エントリに noteEn が非空であること、**h を持つエントリは** h=hash(note) であること
//      (h は任意。AV3 で changelog.js ヘッダと揃えた) … 違反で非ゼロ終了
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
//   ⑨ index.html の data-i18n / data-i18n-html **インライン本文** ≡ ja カタログ であること   … 違反で非ゼロ終了
//      (AU3・AU2 の敵対的レビューで判明した「見せかけの緑」の根治。`i18n.js:43,47` が JS 有効時に
//       textContent/innerHTML をカタログで上書きするため、インライン本文が古くても画面上は正しく見える。しかし
//       **公開ソース・JS 無効時・ハイドレーション前**には古い本文が出る。②はキーの存在、④は hash(ja) 対
//       カタログ自身しか見ないので、**カタログだけ直してインライン本文を直し忘れると全部緑のまま**だった
//       (AU2 で変異注入により実測: インライン本文を旧文言へ戻しても exit=0)。
//       既存の陳腐化は EXPECTED_STALE で件数と顔ぶれを固定し、**増えたら赤・直ったらリストを外せと赤**にする。
//       BC2: 当初 data-i18n-html だけが対象で plain data-i18n は母集団外だった。実測で母集団を広げても
//       新規の不一致は 4 件 (official.intro/rank.intro/ghost.intro/chal.intro) のみと確認できたため
//       (37 件の data-i18n-html 側 EXPECTED_STALE はそのまま)、plain data-i18n も同じ機構に統合した。)
//   ⑩ index.html の **静的 title=** (data-i18n-title 併記分) ≡ ja カタログ であること        … 違反で非ゼロ終了
//      (AZ3・⑨ と同型の「見せかけの緑」の根治。`i18n.js:44` が JS 有効時に `el.title` をカタログで
//       上書きするため、**静的な title= が古くても画面上は正しく見える**。②はキーの存在しか見ず、
//       ⑨ は data-i18n-html の innerHTML しか見ないので、**title だけ腐ると全部緑のまま**だった。
//       AZ3 の実測で 76 件中 13 件が不一致で、うち `fleet.brake.title` は **v8.0.0 で是正した旧主張**
//       (「卓上/中スケールでは停止距離が 3 割ほど伸びる」) を JS 無効面に残し、`cars.share.title` は
//       `title=""` の空だった。13 件すべて ja へ一致させたうえで、ここで固定する。
//       **逆方向も課す**: ページ中の静的 `title=` の総数 ≡ 照合できた要素数 (＝`data-i18n-title` を書き忘れた
//       裸の tooltip が 0 件)。これが無いと「data-i18n-title を外す/最初から付けない」だけで静かに検査対象外に
//       できてしまう〔層 4 レビュー 2026-09-13 が変異で実証: 全削除しても「0 要素すべて一致」で緑だった〕。)
//   ⑪ data-i18n / data-i18n-title / data-i18n-placeholder / data-i18n-aria で参照されるキーの
//      カタログ ja/en が書式タグ (`<b>` 等) を含まないこと                                    … 違反で非ゼロ終了
//      (BC2。この 4 経路は `i18n.js:43-45,49` で textContent / 属性値として流し込まれる。data-i18n-html
//       だけが innerHTML で HTML として解釈される。textContent 経路にタグ文字列を混ぜると画面に生タグが
//       そのまま出る — BB5 で `usage.s5.lap` が実際にこれを起こしていた (data-i18n-html へ移して解消)。
//       ⑨ はインライン本文とカタログの一致しか見ないため、**両方が同じ書式タグ込みで揃っていれば** ⑨ は
//       通り、この不具合は検出できない。⑪ は経路 (textContent か innerHTML か) そのものを見て別に守る。)
//   ⑫ 英語表示で日本語が出ないこと (messages.js の外の日本語固定文が画面に出る 4 経路)                … 違反で非ゼロ終了
//      (BM6。v10.4.0 の再点検 §K で、setLang('en') でも ① 領域の切替ログ (REGIMES の name/desc)
//       ② 質問・提案の拒否理由 (moderate.js の 'リンク過多') ③ バックアップ読込失敗 (data_backup.js の Error 文)
//       ④ 名前の無いコースの既定名 (course.js のカスタム/トラック/アニュラス/峠) が日本語のまま出た。
//       本番の関数 (main.js の regimeText・courseNameText・courseDisplayName は本文を取り出して評価・moderate・
//       parseBackup・normalizeCourse・buildFromSpec) に本番の値を通し、en で日本語の文字が 0・ja は改修前と同じ文
//       (カタログの ja ≡ REGIMES の原文・DEFAULT_COURSE_NAME) であることを課す。配線 (main.js / race_ui.js の呼び出し 25 本) は
//       字面で照合し、生のコース名を表示へ渡す書き方 (`{ name: course.name` 等・#edName への直代入) の残りも数える (BM6 fix1)。)
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

// ---- ⑤ のため: changelog.js の CHANGELOG / config.js の APP_VERSION (en 併記＋陳腐化印 h=hash(note)) ----
const { APP_VERSION } = await import('./public/js/config.js');
// CHANGELOG は Stage AS2 で changelog.js へ分離。
const { CHANGELOG } = await import('./public/js/changelog.js');

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
const { CAR_PARAM_DOC, REGIMES, TIRE_SETS, GEAR_SETS, SUSP_SETS, SUSP_DEFAULT, STEER_SETS, STEER_DEFAULT, BRAKE_SETS, BRAKE_DEFAULT } = await import('./public/js/config.js'); // CHANGELOG/APP_VERSION と同モジュール
const { DIFF_LEVELS } = await import('./public/js/challenge.js');   // AS13: チャレンジのバッジ suffix ドメイン
const { DEFAULT_COURSE_NAME, normalizeCourse, buildFromSpec } = await import('./public/js/course.js');   // BM6 (⑧・⑫)
const DCN = DEFAULT_COURSE_NAME || {};   // 無い木 (BM6 前) でも落ちずに ⑫ の赤として出す
// BM6: moderate.js の reason と data_backup.js の backupError のコードはソースの字面から集める (evaluator の subs と同じ読み方)。
const MODERATE_REASONS = [...new Set([...readFileSync(join(JSDIR, 'moderate.js'), 'utf8').matchAll(/\breason:\s*'([A-Za-z]+)'/g)].map((m) => m[1]))];
const BACKUP_ERR_CODES = [...new Set([...readFileSync(join(JSDIR, 'data_backup.js'), 'utf8').matchAll(/\bbackupError\(\s*'([A-Za-z]+)'/g)].map((m) => m[1]))];
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
  // AS9: 装備ラベルは main.js が t('log.tire.'+tireSet) / t('log.gear.'+gearSet)、hud.js が
  // t('hud.lb.tire.'+…) / t('hud.lb.gear.'+…) で動的構築する。suffix ドメインの権威は config の
  // TIRE_SETS/GEAR_SETS (白リストそのもの) ⇒ タイヤ/ギアを増やしたらラベル付け忘れで必ず落ちる。
  { prefix: 'log.tire.', keys: TIRE_SETS, src: `TIRE_SETS (${TIRE_SETS.length})` },
  { prefix: 'log.gear.', keys: GEAR_SETS, src: `GEAR_SETS (${GEAR_SETS.length})` },
  { prefix: 'hud.lb.tire.', keys: TIRE_SETS, src: `TIRE_SETS (${TIRE_SETS.length})` },
  { prefix: 'hud.lb.gear.', keys: GEAR_SETS, src: `GEAR_SETS (${GEAR_SETS.length})` },
  // AS11: サス自由度も同型 (main.js が t('log.susp.'+suspSet)、hud.js が t('hud.lb.susp.'+…))。
  // HUD は **非既定のときだけ**バッジを出すので既定 (quasi) のラベルは持たない ⇒ 既定を除いた集合が権威。
  { prefix: 'log.susp.', keys: SUSP_SETS, src: `SUSP_SETS (${SUSP_SETS.length})` },
  { prefix: 'fleet.susp.', keys: SUSP_SETS, src: `SUSP_SETS (${SUSP_SETS.length})` },
  { prefix: 'hud.lb.susp.', keys: SUSP_SETS.filter((k) => k !== SUSP_DEFAULT), src: `SUSP_SETS 非既定 (${SUSP_SETS.length - 1})` },
  // AS12: 操舵サーボも同型 (main.js が t('log.steer.'+steerSet)、hud.js が t('hud.lb.steer.'+…))。
  // HUD は非既定のときだけバッジを出すので既定 (tri) のラベルは持たない。
  { prefix: 'log.steer.', keys: STEER_SETS, src: `STEER_SETS (${STEER_SETS.length})` },
  { prefix: 'fleet.steer.', keys: STEER_SETS, src: `STEER_SETS (${STEER_SETS.length})` },
  { prefix: 'hud.lb.steer.', keys: STEER_SETS.filter((k) => k !== STEER_DEFAULT), src: `STEER_SETS 非既定 (${STEER_SETS.length - 1})` },
  // AV2: 制動装置も同型 (main.js が t('log.brake.'+brakeSet)、hud.js が t('hud.lb.brake.'+…))。
  // HUD は非既定のときだけバッジを出すので既定 (motor) のラベルは持たない。
  { prefix: 'log.brake.', keys: BRAKE_SETS, src: `BRAKE_SETS (${BRAKE_SETS.length})` },
  { prefix: 'fleet.brake.', keys: BRAKE_SETS, src: `BRAKE_SETS (${BRAKE_SETS.length})` },
  { prefix: 'hud.lb.brake.', keys: BRAKE_SETS.filter((k) => k !== BRAKE_DEFAULT), src: `BRAKE_SETS 非既定 (${BRAKE_SETS.length - 1})` },
  // AS13: チャレンジのバッジ/状態は main.js が t('chal.badge.'+key) / t('chal.state.'+state) で動的構築する。
  // suffix ドメインの権威は challenge.js の DIFF_LEVELS (バッジは first + 難度ごと + all) と 3 状態の enum
  // ⇒ 難度の刻みを増やしたらラベル付け忘れで必ず落ちる (TIRE_SETS と同型)。
  { prefix: 'chal.badge.', keys: ['first', ...DIFF_LEVELS.map((d) => 'diff' + d), 'all'],
    src: `first + DIFF_LEVELS (${DIFF_LEVELS.length}) + all` },
  { prefix: 'chal.state.', keys: ['none', 'started', 'clear'], src: '進捗 enum (3)' },
  // BM6: 英語表示で日本語が出た 4 経路の訳 (⑫)。suffix ドメインは本物のソース (REGIMES・DEFAULT_COURSE_NAME・
  //   moderate.js の reason・data_backup.js の backupError のコード) から導く。
  { prefix: 'regime.', keys: Object.keys(REGIMES).flatMap((k) => [`${k}.name`, `${k}.desc`]), src: `REGIMES×2 (${Object.keys(REGIMES).length}×2)` },
  { prefix: 'course.defaultName.', keys: Object.keys(DCN), src: `DEFAULT_COURSE_NAME (${Object.keys(DCN).length})` },
  { prefix: 'ask.reason.', keys: MODERATE_REASONS, src: `moderate.js reason (${MODERATE_REASONS.length})` },
  { prefix: 'backup.err.', keys: BACKUP_ERR_CODES, src: `data_backup.js backupError (${BACKUP_ERR_CODES.length})` },
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

// ---- ⑫ 英語表示で日本語が出ないこと (BM6・ヘッダ ⑫) ----
// 日本語の文字＝ひらがな・カタカナ・CJK 統合漢字 (拡張 A を含む)・半角カナ (docs/stage_bm/probe/k_scan.mjs と同じ集合)。
const JP_RE = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;
const i18nMod = await import('./public/js/i18n.js');
const { moderate } = await import('./public/js/moderate.js');
const { parseBackup } = await import('./public/js/data_backup.js');
const mainSrc = readFileSync(join(JSDIR, 'main.js'), 'utf8');
// main.js は DOM を前提にするので import できない。表示名を決める関数の本文だけを取り出し、依存を渡して評価する
// (再実装しない＝本番の本文そのもの。取り出せなければ ⑫ の赤として出す)。
const takeFn = (name) => {
  const a = mainSrc.indexOf(`\nfunction ${name}(`);
  const b = a < 0 ? -1 : mainSrc.indexOf('\n}\n', a);
  return (a < 0 || b < 0) ? null : mainSrc.slice(a + 1, b + 2);
};
const i18nNg = [];   // ⑫ の違反 (文で残す)
const FN_NAMES = ['regimeText', 'courseNameText', 'courseDisplayName', 'courseBadLine', 'setEdNameFromCourse', 'edNameValue', 'refreshEdNameShown'];
const fnSrc = Object.fromEntries(FN_NAMES.map((k) => [k, takeFn(k)]));
for (const [k, v] of Object.entries(fnSrc)) if (!v) i18nNg.push(`main.js に function ${k} が見つからない`);
if (!DEFAULT_COURSE_NAME) i18nNg.push('course.js に DEFAULT_COURSE_NAME (名前の無いコースの既定名) が無い');
let FN = null;
const edNameEl = { value: '' };   // #edName の代わり (setEdNameFromCourse／edNameValue は $('edName').value だけを読み書きする)
if (!i18nNg.length) {
  const courseParts = await import('./public/js/course.js');
  const presetByName = courseParts.presetByName || (() => null);
  const $ = (id) => (id === 'edName' ? edNameEl : null);
  // edNameShown は main.js の module 変数 (let)。関数の本文と同じく取り出せないので、ここで同じ初期値で宣言する。
  FN = new Function('REGIMES', 'courseParts', 'presetByName', 't', 'hasKey', 'getLang', '$',
    `let edNameShown = null;\n${FN_NAMES.map((k) => fnSrc[k]).join('\n')}\nreturn { ${FN_NAMES.join(', ')} };`)(
    REGIMES, courseParts, presetByName, i18nMod.t, i18nMod.hasKey, i18nMod.getLang, $);
}
// 配線: 本文で取り出した関数を main.js / race_ui.js が該当の表示で呼んでいること (呼び出しの式そのもの)。
//   BM6 fix1 (層4 F1/F2): 名前の無いコースの名前を表示する全経路 (取込・✔適用・保存・投稿・削除・一覧・収容告知・
//   参照が曖昧/見つからない・公式開催の衝突・ランキングの bundled ラベル・公式記録の検証再走) を数え上げて照合する。
const raceUiSrc = readFileSync(join(JSDIR, 'race_ui.js'), 'utf8');
const WIRES = [
  ["logLine(t('log.regime', { name: regimeText(r, 'name'), desc: regimeText(r, 'desc'),", '領域の切替ログが regimeText を通す'],
  ["t('ask.msg.blocked', { word: m.reason ? (hasKey(`ask.reason.${m.reason}`) ? t(`ask.reason.${m.reason}`) : m.reason) : m.word })", '質問・提案の拒否理由が reason を訳す (hasKey ガード)'],
  ["t('log.backup.err', { e: (e && e.i18nCode && hasKey(`backup.err.${e.i18nCode}`)) ? t(`backup.err.${e.i18nCode}`, e.vars) : e.message })", 'バックアップ読込失敗が i18nCode を訳す (hasKey ガード)'],
  ["? courseNameText(ref.name) : '(courseDef)')", 'ランキングの bundled def のラベルが既定名を訳す (raceCourseUnitNow)'],
  ["t(k, { name: cref.clash != null ? cref.clash : courseDisplayName(course) })", '公式開催の衝突/不明の告知が courseDisplayName を通す'],
  ["`⚠ ${cref.clash != null ? cref.clash : courseDisplayName(course)}`", '同 (古い messages.js の素の形)'],
  ["t('log.courseAmbiguous', { name: courseNameText(courseRef), n })", '参照が曖昧の告知 (resolveRaceCourse)'],
  ["t('log.courseAmbiguous', { name: courseNameText(want), n })", '参照が曖昧の告知 (共有 URL)'],
  ["t('log.share.course.missing', { name: courseNameText(want) })", '共有 URL のコースが見つからない告知'],
  ["addOpt(sel, '★ ' + courseNameText(n), key);", '保存コースの一覧の表示名'],
  ["t(r.capZero ? r.zeroKey : 'log.capReduced', { name: courseNameText(course.name), n: capN, was })", '収容の告知 (台数を減らす)'],
  ["logLine(t(r.zeroKeyOnly, { name: courseNameText(course.name) }));", '収容の告知 (減らす台数が無い)'],
  ["log: (key, params) => logLine(t(key, (params && Object.prototype.hasOwnProperty.call(params, 'name')) ? { ...params, name: courseNameText(params.name) } : params)),", 'fitguard.js の告知 (fx.log) が {name} を訳す'],
  ["t('log.courseApplied', { name: courseNameText(c.name) })", '✔適用の告知'],
  ["const name = (edNameValue() || t('ed.name.default'));", '保存が欄の値を edNameValue で読む (訳して見せた既定名を識別子へ戻す)'],
  ["t('log.courseSaved', { name: courseNameText(name) })", '保存の告知'],
  ["setEdNameFromCourse(editor.course.name);", 'JSON 取込が欄に setEdNameFromCourse で名前を出す'],
  ["t('log.courseJsonLoaded', { name: courseNameText(editor.course.name) || '' })", 'JSON 取込の告知'],
  ["json.name = (edNameValue() ||", '投稿が欄の値を edNameValue で読む'],
  ["{ name: courseNameText(json.name), file: r.filename }", '投稿の告知'],
  ["t('log.savedCourseDeleted', { name: courseNameText(n) })", '保存コース削除の告知'],
  ["refreshEdNameShown();", '言語切替で欄の訳した既定名を追従'],
];
for (const [w, what] of WIRES) if (!mainSrc.includes(w)) i18nNg.push(`配線なし: ${what} (main.js に「${w}」が無い)`);
const RACE_UI_WIRES = [
  ["const cn = (event.course && typeof event.course === 'object') ? courseDisplayName(event.course) : event.course;", '検証再走: コースが見つからない'],
  ["const cn0 = (event.course && typeof event.course === 'object') ? courseDisplayName(event.course) : event.course;", '検証再走: 収容 0 台'],
  ["t('official.verify.noRoom', { name: courseDisplayName(rcourse) })", '👻 世界ベスト: 収容 0 台'],
];
for (const [w, what] of RACE_UI_WIRES) if (!raceUiSrc.includes(w)) i18nNg.push(`配線なし: ${what} (race_ui.js に「${w}」が無い)`);
// 兄弟の取り残し: コースの名前を生のまま告知・欄へ入れる書き方が main.js に残っていないこと (新しい経路の書き忘れも拾う)。
for (const re of [/\{ name: (?:course|c|editor\.course|rc|rcourse|json)\.name\b/g, /\$\('edName'\)\.value = (?!next)/g]) {
  for (const mm of mainSrc.matchAll(re)) {
    const ln = mainSrc.slice(0, mm.index).split('\n').length;
    i18nNg.push(`生のコース名を表示へ渡す書き方: main.js:${ln} 「${mainSrc.split('\n')[ln - 1].trim().slice(0, 120)}」 (courseNameText／courseDisplayName／setEdNameFromCourse を通す)`);
  }
}
const i18nRows = [];   // [言語, 経路, 文]
const BAD_BACKUPS = [null, [], 'x', { format: 'x' }, { format: 'rumicar-backup' }, { format: 'rumicar-backup', data: [] },
  { format: 'rumicar-backup', data: { 'rumicar.a': 1 } }];
const COURSES_JSON = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'courses.json'), 'utf8'));
const nameless = (kind) => { const sp = COURSES_JSON.find((c) => c.kind === kind); if (!sp) return null; const o = { ...sp }; delete o.name; delete o.name_en; return o; };
const langBefore = i18nMod.getLang();
if (FN) for (const lang of ['ja', 'en']) {
  i18nMod.setLang(lang);
  if (i18nMod.getLang() !== lang) { i18nNg.push(`setLang('${lang}') が効かない`); continue; }
  const tt = i18nMod.t;
  for (const k of Object.keys(REGIMES)) {
    const r = REGIMES[k];
    i18nRows.push([lang, `regime.${k}`, tt('log.regime', { name: FN.regimeText(r, 'name'), desc: FN.regimeText(r, 'desc'), size: (r.L / 0.13).toFixed(1), mm: r.sensorMaxMm })]);
    if (lang === 'ja' && (FN.regimeText(r, 'name') !== r.name || FN.regimeText(r, 'desc') !== (r.desc || '')))
      i18nNg.push(`ja の regime.${k}.name/desc が REGIMES.${k} の原文と違う (改修前の ja と同じ文にすること)`);
  }
  const m = moderate(Array.from({ length: 4 }, (_, i) => `https://e${i}.example/`).join(' '));
  if (m.ok !== false || !m.reason) i18nNg.push(`moderate の URL 過多が reason を返さない (実 ${JSON.stringify(m)})`);
  else i18nRows.push([lang, 'ask.reason', tt('ask.msg.blocked', { word: m.reason ? tt(`ask.reason.${m.reason}`) : m.word })]);
  BAD_BACKUPS.forEach((b, i) => {
    try { parseBackup(b); i18nNg.push(`parseBackup が不正な入力 #${i} を通した`); }
    catch (e) {
      if (!e || !e.i18nCode) i18nNg.push(`parseBackup の Error #${i} に i18nCode が無い (${e && e.message})`);
      i18nRows.push([lang, `backup#${i}`, tt('log.backup.err', { e: (e && e.i18nCode) ? tt(`backup.err.${e.i18nCode}`, e.vars) : e.message })]);
    }
  });
  const base = { walls: [{ x1: 0, y1: 0, x2: 1, y2: 0 }], bounds: { w: 3, h: 2 }, start: { x: 1, y: 1, theta: 0 } };
  i18nRows.push([lang, 'normalizeCourse', FN.courseDisplayName(normalizeCourse(base))]);
  for (const kind of Object.keys(DCN)) {
    const sp = kind === 'raw' ? { kind: 'raw', ...base } : nameless(kind);
    if (!sp) { i18nNg.push(`courses.json に kind=${kind} のコースが無い (名前の無い ${kind} を作れない)`); continue; }
    const c = buildFromSpec(sp);
    if (c.name !== DCN[kind]) i18nNg.push(`buildFromSpec(名前の無い ${kind}).name が DEFAULT_COURSE_NAME.${kind} でない (実 ${c.name})`);
    i18nRows.push([lang, `course.${kind}`, FN.courseDisplayName(c)]);
    if (lang === 'ja' && FN.courseDisplayName(c) !== DCN[kind]) i18nNg.push(`ja の既定名 ${kind} が DEFAULT_COURSE_NAME と違う`);
    // courseDisplayName の文字列の分岐 (公式記録の course 識別子) と取り込み拒否の 1 行 (courseBadLine) も同じ規則。
    i18nRows.push([lang, `course.${kind}(識別子)`, FN.courseDisplayName(DCN[kind])]);
    if (lang === 'ja' && FN.courseDisplayName(DCN[kind]) !== DCN[kind]) i18nNg.push(`ja の識別子 ${kind} の表示が既定名と違う`);
    i18nRows.push([lang, `courseBad.${kind}`, FN.courseBadLine(DCN[kind], 'walls[0]')]);
    // 欄 (#edName): 既定名は訳して見せ、見せたままなら識別子へ戻す。書き換えたら書いた値。空白だけは ''。
    FN.setEdNameFromCourse(DCN[kind]);
    i18nRows.push([lang, `edName.${kind}`, edNameEl.value]);
    if (FN.edNameValue() !== DCN[kind]) i18nNg.push(`[${lang}] 欄に見せた既定名 ${kind} が保存時に識別子へ戻らない (実 ${FN.edNameValue()})`);
    edNameEl.value = '  ' + edNameEl.value + ' ';
    if (FN.edNameValue() !== DCN[kind]) i18nNg.push(`[${lang}] 欄の前後の空白で既定名 ${kind} が識別子へ戻らない`);
    edNameEl.value = 'My Own';
    if (FN.edNameValue() !== 'My Own') i18nNg.push(`[${lang}] 書き換えた欄の値がそのまま使われない`);
    edNameEl.value = '   ';
    if (FN.edNameValue() !== '') i18nNg.push(`[${lang}] 空白だけの欄が '' にならない (既定名へ落ちない)`);
    if (lang === 'ja' && edNameEl.value !== '   ') i18nNg.push('edNameValue が欄を書き換えた');
  }
  // 言語切替: 見せたままの欄は新しい言語の表示へ、書き換えた欄は触らない。
  FN.setEdNameFromCourse(DCN.raw);
  const other = lang === 'ja' ? 'en' : 'ja';
  i18nMod.setLang(other); FN.refreshEdNameShown();
  const want = FN.courseNameText(DCN.raw);
  if (edNameEl.value !== want) i18nNg.push(`[${lang}→${other}] 欄の既定名が言語に追従しない (実 ${edNameEl.value} / 期待 ${want})`);
  edNameEl.value = 'Mine'; i18nMod.setLang(lang); FN.refreshEdNameShown();
  if (edNameEl.value !== 'Mine') i18nNg.push(`[${other}→${lang}] 書き換えた欄を言語切替が上書きした`);
  // 利用者が名付けた既定名以外の名前は訳さない (ja/en とも受け取った値のまま)。
  if (FN.courseNameText('カスタム車') !== 'カスタム車' || FN.courseDisplayName({ name: 'X峠' }) !== 'X峠') i18nNg.push('既定名と完全一致しない名前まで訳している');
}
i18nMod.setLang(langBefore);
for (const [lang, what, txt] of i18nRows) if (lang === 'en' && JP_RE.test(String(txt))) i18nNg.push(`en に日本語: ${what} → ${txt}`);

// ---- ⑨ index.html のインライン本文 ≡ ja カタログ (AU3・BC2 で plain data-i18n へ拡張) ----
// 抽出: data-i18n / data-i18n-html を持つ要素の innerHTML を、**同名タグの入れ子を数えて**取り出す(DOM 非依存)。
//   正しさの裏取り＝137 要素中 100 要素がカタログと完全一致する(抽出が壊れていれば一致はまず出ない)。
// 正規化: 空白連を 1 個へ畳み、**タグ境界の空白は無視**する(index.html 側の改行・インデント由来の空白を
//   実差分と誤検出しないため。実測でこの正規化により偽陽性 11 件が消えた)。
const INLINE_STALE_NOTE = 'i18n.js:43,47 が JS 有効時に textContent/innerHTML を上書きするため画面では見えないが、公開ソース/JS 無効時/ハイドレーション前には出る';
// **既知例外(2026-09-05 AU3 で実測して固定)**: 長文ヘルプの一部でインライン本文が旧版のまま残っている。
//   ここに載っているキーは「今は不一致でよい」。**増えたら赤**(新しい取り残しの検出)。
//   **直ったのにここに残っていても赤**(リストが腐るのを防ぐ)＝直したらこの配列から外すこと。
const EXPECTED_STALE = [
  'ask.intro', 'doc.annulus.fields', 'doc.annulus.shapes', 'doc.common.bank',
  'doc.common.desc', 'doc.common.grip', 'doc.common.i18n', 'doc.common.kind',
  'doc.common.meta', 'doc.common.name', 'doc.common.noRace', 'doc.intro',
  'doc.loop.note', 'doc.raw.fields', 'doc.sf.note', 'doc.touge.fields',
  'doc.touge.style', 'doc.track.fields', 'doc.track.shape', 'doc.validate.note',
  'pm.s1.models', 'pm.s11.cant', 'pm.s7.similar', 'rg.design.body',
  'rg.feel.body', 'rg.gear.body', 'rg.howto.body', 'rg.intro',
  'rg.layers.body', 'rg.recon.body', 'rg.rules.body', 'spec.lang.subset',
  'spec.misc.storage', 'spec.veh.speedDisp', 'sys.arch.body',
  'usage.langNote',
];
const normInline = (x) => x.replace(/\s+/g, ' ').replace(/\s+</g, '<').replace(/>\s+/g, '>').trim();
const inlineRows = [];
{
  const re9 = /<([a-zA-Z][\w-]*)\b[^>]*\bdata-i18n(-html)?="([^"]+)"[^>]*>/g;
  let m9;
  while ((m9 = re9.exec(html)) !== null) {
    const full = m9[0], tag = m9[1], key = m9[3];
    if (/\/>$/.test(full)) continue;                       // 自己閉じ (本文なし) は対象外
    let i = m9.index + full.length, depth = 1, end = -1;
    const openRe = new RegExp(`<${tag}\\b`, 'g'), closeRe = new RegExp(`</${tag}\\s*>`, 'g');
    while (i < html.length) {
      openRe.lastIndex = i; closeRe.lastIndex = i;
      const o = openRe.exec(html), c = closeRe.exec(html);
      if (!c) break;
      if (o && o.index < c.index) { depth++; i = o.index + o[0].length; }
      else { depth--; if (depth === 0) { end = c.index; break; } i = c.index + c[0].length; }
    }
    inlineRows.push({ key, inline: end < 0 ? null : html.slice(m9.index + full.length, end) });
  }
}
const inlineBroken = inlineRows.filter((r) => r.inline == null).map((r) => r.key);   // 閉じタグを見つけられなかった＝抽出器の適用外
const inlineMiss = [];
for (const r of inlineRows) {
  if (r.inline == null) continue;
  const e = MESSAGES[r.key];
  if (!e) continue;                                        // カタログ不在は ② が担当
  if (normInline(r.inline) !== normInline(e.ja)) inlineMiss.push(r.key);
}
const inlineNew = inlineMiss.filter((k) => !EXPECTED_STALE.includes(k));                     // 新しい取り残し＝赤
const inlineFixed = EXPECTED_STALE.filter((k) => inlineRows.some((r) => r.key === k) && !inlineMiss.includes(k));  // 直った＝リストから外せ
const inlineGone = EXPECTED_STALE.filter((k) => !inlineRows.some((r) => r.key === k));       // HTML から消えた＝リスト腐り

// ---- ⑩ index.html の静的 title= (data-i18n-title 併記分) ≡ ja カタログ (AZ3) ----
// 例外リストは**置かない**: AZ3 で 13 件すべて一致させたので「不一致があれば赤」で足りる。
//   意図的に短縮したいケースが将来出たら、⑨ の EXPECTED_STALE と同じ
//   「増えたら赤・直ったら外せと赤」を足すこと (件数を黙って増やせる形にしない)。
// ⚠ タグ境界は **引用符を意識して** 走査する。`<[^>]*>` で切ると、属性値の中の `&lt;大会&gt;` が
//   生の `<大会>` で書かれた瞬間にタグが途中で切れ、検査が**黙って対象を落とす**
//   (AZ3 の実装中に実際に踏んだ: 一括置換で `<`/`>` を実体化し忘れ、2 件が「併記なし」へ転落した)。
const TITLE_STALE_NOTE = 'i18n.js:44 が JS 有効時に el.title を上書きするため画面では見えないが、公開ソース/JS 無効時/ハイドレーション前には出る';
const decAttr = (x) => x.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// 引用符の外にある最初の '>' までを開始タグとみなす (見つからなければ -1)。
const tagEndFrom = (str, lt) => {
  let i = lt + 1, q = null;
  while (i < str.length) {
    const c = str[i];
    if (q) { if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '>') return i + 1;
    i++;
  }
  return -1;
};
const titleRows = [];
{
  const re10 = /data-i18n-title="([^"]+)"/g;
  let m10;
  while ((m10 = re10.exec(html)) !== null) {
    const key = m10[1];
    const lt = html.lastIndexOf('<', m10.index);
    const end = lt < 0 ? -1 : tagEndFrom(html, lt);
    if (end < 0) { titleRows.push({ key, lit: null, why: 'タグ境界を取れない' }); continue; }
    const tag = html.slice(lt, end);
    const tm = tag.match(/(?:\s|["'])title="([^"]*)"/);   // data-i18n-title= 自身に当てない
    titleRows.push({ key, lit: tm ? decAttr(tm[1]) : null, raw: tm ? tm[1] : null, why: tm ? null : '静的 title= 併記なし' });
  }
}
const titleBroken = titleRows.filter((r) => r.lit === null).map((r) => `${r.key} — ${r.why}`);
const titleMiss = [];
for (const r of titleRows) {
  if (r.lit === null) continue;
  const e = MESSAGES[r.key];
  if (!e) continue;                                       // カタログ不在は ② が担当
  if (r.lit !== e.ja) titleMiss.push(r.key);
}
// 生の `<` / `>` を属性値へ書かせない。decode すると値としては一致するので上の突合は素通りするが
// (AZ3 の変異試験 4 で実測)、`<[^>]*>` でタグを切る検査器はそこで**黙って対象を落とす**。
// 値が正しいことと、検査器が対象を掴めることは別 — 後者をここで守る。
const titleRawLt = titleRows.filter((r) => r.raw !== null && /[<>]/.test(r.raw)).map((r) => r.key);
// **逆方向の検査（層 4 レビュー 2026-09-13 の指摘で追加）**: 上の突合は「`data-i18n-title` を持つ要素」だけを
//   母集団にするので、**`data-i18n-title` を書き忘れた要素は静かに検査対象外**になる。実測でこの穴を確認した —
//   ① `data-i18n-title` を全削除すると「0 要素すべて一致」で緑 ② 1 要素だけ外して title を腐らせても緑
//   ③ `title=` だけの新しいボタンを足しても緑（翻訳されず日本語のまま出るのに誰も見ない）。
//   ③ は「新しいボタンに title だけ書いて data-i18n-title を忘れる」＝**この検査が防ぎたい失敗の最も自然な形**。
//   ∴ **ページ中の静的 `title=` の総数と、照合できた要素数が一致する**ことを課す（＝カタログ外の裸の title= は 0 件）。
//   `data-i18n-title="…"` は直前が `-` なので下の正規表現には当たらない（空白か引用符が要る）。
const titleAttrTotal = (html.match(/(?:\s|["'])title="/g) || []).length;
const titleUncovered = titleAttrTotal - titleRows.length;
// 下限。**正確な件数ではなく床**（tooltip を増やすたびにゲートを編集させない）。一括削除だけを止める。
const TITLE_MIN = 70;

// ---- ⑪ textContent/属性経由キーに書式タグを禁じる (BC2) ----
// data-i18n-html だけが innerHTML で HTML として解釈される (i18n.js:47)。他の 4 経路
// (data-i18n/-title/-placeholder/-aria) は textContent か属性値なので、値に `<b>` 等の
// タグ文字列が入ると画面にタグ文字がそのまま出る (BB5: usage.s5.lap が実際にこれだった)。
// タグ名を固定パターンに限定する (プレースホルダ表記 <race>・不等式 <grip<1> 等は
// タグ名として現れないので自然に除外され、例外リストは要らない＝作ったら基準未達)。
const FORMAT_TAG_RE = /<\/?(b|strong|i|em|code|br|ul|ol|li|p|span|div)(\s[^>]*)?>/i;
const plainAttrKeys = new Set();
for (const m of html.matchAll(/data-i18n(-title|-placeholder|-aria)?="([^"]*)"/g)) plainAttrKeys.add(m[2]);
const formatTagHits = [];
for (const k of plainAttrKeys) {
  const e = MESSAGES[k];
  if (!e) continue;                                       // カタログ不在は ② が担当
  if (e.ja && FORMAT_TAG_RE.test(e.ja)) formatTagHits.push(`${k} (ja)`);
  if (e.en && FORMAT_TAG_RE.test(e.en)) formatTagHits.push(`${k} (en)`);
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
  console.log(`\n✗ ⑤ CHANGELOG (changelog.js) に問題`);
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

if (inlineNew.length || inlineFixed.length || inlineGone.length || inlineBroken.length) {
  fail = true;
  console.log(`\n✗ ⑨ index.html のインライン本文 ≡ ja カタログ (対象 ${inlineRows.length} 要素・既知例外 ${EXPECTED_STALE.length} 件)`);
  for (const k of inlineNew) console.log(`    - **新しい取り残し**: ${k} — ja カタログを直してインライン本文を直し忘れている (${INLINE_STALE_NOTE})`);
  for (const k of inlineFixed) console.log(`    - 直っている: ${k} — wf_i18n_check.mjs の EXPECTED_STALE からこのキーを外すこと`);
  for (const k of inlineGone) console.log(`    - リスト腐り: ${k} — index.html に data-i18n(-html)="${k}" が無い。EXPECTED_STALE から外すこと`);
  for (const k of inlineBroken) console.log(`    - 抽出不能: ${k} — 閉じタグを見つけられない (抽出器の前提を満たさない書き方)`);
} else {
  console.log(`✓ ⑨ インライン本文: ${inlineRows.length} 要素中 ${inlineRows.length - inlineMiss.length} 件が ja カタログと一致 (既知例外 ${EXPECTED_STALE.length} 件は固定・新規の取り残し 0)`);
}

const titleChecked = titleRows.filter((r) => r.lit !== null && MESSAGES[r.key]).length;
if (titleBroken.length || titleMiss.length || titleRawLt.length || titleUncovered !== 0 || titleRows.length < TITLE_MIN) {
  fail = true;
  console.log(`\n✗ ⑩ 静的 title= ≡ ja カタログ (対象 ${titleRows.length} 要素 / ページ中の静的 title= ${titleAttrTotal} 個)`);
  for (const s2 of titleBroken) console.log(`    - 併記なし/抽出不能: ${s2} — JS 無効時に tooltip が空になる`);
  for (const k of titleMiss) console.log(`    - **不一致**: ${k} — ja カタログを直して静的 title= を直し忘れている (${TITLE_STALE_NOTE})`);
  for (const k of titleRawLt) console.log(`    - 生の < / > : ${k} — 属性値では &lt; &gt; へ実体化すること (タグを <[^>]*> で切る検査器がこの要素を黙って落とす)`);
  if (titleUncovered > 0) console.log(`    - **カタログ外の静的 title=**: ${titleUncovered} 個 — data-i18n-title を書き忘れた tooltip がある (翻訳されず日本語のまま出る)。付けるか、意図的なら ⑩ の母集団の定義を見直すこと`);
  if (titleUncovered < 0) console.log(`    - 計数が合わない: 照合 ${titleRows.length} > 静的 title= ${titleAttrTotal} — 同一要素に title= が 2 個ある等、抽出の前提が崩れている`);
  if (titleRows.length < TITLE_MIN) console.log(`    - **対象が少なすぎる**: ${titleRows.length} < 下限 ${TITLE_MIN} — data-i18n-title が一括で消えていないか (消えると検査は「0 件すべて一致」で緑になる)`);
} else {
  console.log(`✓ ⑩ 静的 title=: ${titleRows.length} 要素すべてに併記あり・カタログ照合 ${titleChecked} 件すべて一致・生の <> なし・カタログ外の静的 title= 0 個 (例外リストなし)`);
}

if (formatTagHits.length) {
  fail = true;
  console.log(`\n✗ ⑪ textContent/属性経由キーに書式タグ (対象 ${plainAttrKeys.size} キー): ${formatTagHits.length} 件`);
  for (const s of formatTagHits) console.log(`    - ${s} — data-i18n-html へ変えるか、タグを除いた平文にすること`);
} else {
  console.log(`✓ ⑪ textContent/属性経由 ${plainAttrKeys.size} キーに書式タグなし (例外リストなし)`);
}

if (i18nNg.length) {
  fail = true;
  console.log(`\n✗ ⑫ 英語表示で日本語が出る経路 (BM6): ${i18nNg.length} 件`);
  for (const s2 of i18nNg) console.log(`    - ${s2}`);
} else {
  const enN = i18nRows.filter((r) => r[0] === 'en').length;
  console.log(`✓ ⑫ 英語表示: 4 経路の ${enN} 文に日本語 0・ja は REGIMES/DEFAULT_COURSE_NAME の原文と同じ・欄の往復 OK・配線 ${WIRES.length + RACE_UI_WIRES.length} 本あり・生のコース名の表示 0`);
}

console.log(`\n${line}`);
if (fail) {
  console.log('結果: FAIL (①②④⑤⑥⑦⑧⑨⑩⑪⑫ のいずれかに違反) — 版アップ前に修正すること');
  process.exit(1);
} else {
  console.log('結果: PASS');
  process.exit(0);
}
