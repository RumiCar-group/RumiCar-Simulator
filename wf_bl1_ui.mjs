// wf_bl1_ui.mjs — Stage BL（UI 不具合）の常設ゲート。BL1 が新設し、BL2〜BL7 が章を足す。
// ════════════════════════════════════════════════════════════════════════════
// 本番モジュールを import して答えさせる（再実装しない・CI-9）。実ブラウザでしか測れない部分は
// browser/check_bl<n>_*.mjs（run_all.sh が glob で拾う）。
//
// A) BL1 質問・提案（💬）の NG ワード判定 — public/js/moderate.js の moderate()（main.js の askSendBtn が呼ぶ唯一の判定）。
//    是正前（ad5ddd1＝v10.3.0）は main.js の中の NG 語を `includes` で部分一致させていたため、アプリ自身の語彙
//    「カスタム車種」（カス）・「cockpit」（cock）・「Essex」「Sussex」（sex）・「Dickens」（dick）・「die hard」（"die "）・
//    「スカスカ」（カス）が拒否された。A-1 の通過表（PLAN BL1 の 9 行＋設計で決めた規則の行）と A-2 の拒否表
//    （product の NG_WORDS の全語から機械生成・語ごとに複数の文）と A-3 の URL 過多・A-4 の配線、A-5 の取りこぼし側の表
//    （v10.3.0 は拒否していた攻撃表現: BL1 初版の語境界化で通るようになり一覧に足した行＝拒否／直さずに残した行＝
//    moderate.js 冒頭「既知の残り」と一致すること／v10.3.0 から残る誤検出）を固定する。
//    `--root <是正前の木>` で回すと、moderate.js が無い木では main.js の NG_WORDS と moderate の本文を
//    取り出して評価する（是正前の木の判定を是正前のまま測るためだけの読み口＝product の経路は変えない）。
//    是正前の木では A-1 の PLAN の 9 行のうち diesel・differential 以外の 7 行と、規則の行の多く、A-4 が赤、
//    A-5 は「既知の取りこぼし」の行（v10.3.0 は拒否）と文書照合の行が赤（2026-10-16 の実測は決定ログ BL1 結果）。
//
// 使い方: node wf_bl1_ui.mjs              … 検査
//         node wf_bl1_ui.mjs --root <dir>  … <dir>/public/js の product で回す（是正前の木で赤になることの確認用）
// exit: 0=全緑 / 1=いずれか赤。
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const rootIdx = process.argv.indexOf('--root');
const ROOT = rootIdx >= 0 ? resolve(process.argv[rootIdx + 1]) : HERE;
const JS = join(ROOT, 'public/js');

let pass = 0, fail = 0;
const fails = [];
const ok = (cond, msg) => { console.log(`  ${cond ? '○' : '✗'} ${msg}`); if (cond) pass++; else { fail++; fails.push(msg); } return cond; };
const J = (v) => JSON.stringify(v);

console.log(`[BL1] wf_bl1_ui — product: ${JS}${ROOT === HERE ? '' : '（--root）'}`);

// ── 判定関数の読み口 ─────────────────────────────────────────────────────────
// 是正後: moderate.js を import。是正前の木（moderate.js が無い）: main.js から NG_WORDS と moderate の本文を
// 切り出して評価する（main.js は DOM を前提にするので module として import できない）。
async function loadModerate() {
  const mod = join(JS, 'moderate.js');
  if (existsSync(mod)) {
    const m = await import(pathToFileURL(mod).href);
    return { moderate: m.moderate, NG_WORDS: m.NG_WORDS, from: 'moderate.js' };
  }
  const src = readFileSync(join(JS, 'main.js'), 'utf8');
  const a = src.indexOf('const NG_WORDS = [');
  const b = src.indexOf("$('askSendBtn')", a);
  if (a < 0 || b < 0) throw new Error('main.js に NG_WORDS／askSendBtn が見つからない');
  const body = src.slice(a, b);
  const f = new Function(`${body}\nreturn { moderate, NG_WORDS };`);
  return { ...f(), from: 'main.js（是正前の木の本文を評価）' };
}
const { moderate, NG_WORDS, from } = await loadModerate();
console.log(`  判定関数: ${from}・NG 語 ${NG_WORDS.length} 語`);

// ── A) NG ワード判定 ───────────────────────────────────────────────────────────
console.log('\nA-1) 通過（NG 語の綴りを語の一部に含むだけの文）— 是正前: diesel・differential 以外は拒否');
const PASS_PLAN = [  // PLAN BL1 の受け入れ基準の 9 行（実装前固定）
  'カスタム車種を作りたい', 'cockpit view', 'Essex のコース', 'Sussex', 'Dickens', 'die hard', 'スカスカ', 'diesel', 'differential',
];
const PASS_RULE = [  // moderate.js 冒頭の規則 ①② から導いた行（大小文字・語の前後の文字種・語の文字＝\w）
  'ESSEX', 'Charles Dickens の小説', 'peacock', 'Hancock', 'cocktail', 'sextant と sexagesimal', 'the skill you need',
  'the engine would die here', 'RC_xxx の関数', 'retarder（減速装置）', 'バカンス', 'デブリ', 'コロンブス', 'エロージョン',
  'クズネツォフ', '差別化する', '無差別', '滞在日数', 'カスケード制御', '少しねじれる',
  // 層4 F1/F3/F4 の是正で足した規則の行（retard は -s/-ed だけ・kill your は kill you と別・在日は直前だけを見る・
  // ひらがなに挟まれた しね・サロゲート対の漢字〔CJK 拡張 B〕も漢字として読む）
  'retarding force', 'retardation', 'kill your speed before the corner', '現在日時', 'わたしね、', 'もしね、', '\u{20BB7}在日',
];
for (const s of [...PASS_PLAN, ...PASS_RULE]) {
  const r = moderate(s);
  ok(r && r.ok === true, `通過「${s}」（実 ${J(r)}）${PASS_PLAN.includes(s) ? '' : '〔規則〕'}`);
}

console.log('\nA-2) 拒否（product の NG_WORDS の全語から機械生成）');
// 語の前後に句読点・空白・括弧を置いた文（どの規則でも NG 語そのものとして一致すべき形）。
const T_ALL = [(w) => w, (w) => `「${w}」と言われた`, (w) => `>> ${w} <<`, (w) => `${w}。`, (w) => `title: ${w}!`];
// 語の前後が別の文字種の文（ひらがなだけの 2 文字以下の語は前後のひらがなと区別できない＝対象外。moderate.js ②）。
const isShortHira = (w) => [...w].length <= 2 && /^[\u3041-\u3096]+$/.test(w);
const T_JA = (w) => `お前は${w}だ`;
const T_UP = (w) => `YOU ARE ${w.toUpperCase()}`;
let generated = 0;
const perWord = {};
for (const w of NG_WORDS) {
  const ts = [...T_ALL];
  if (!isShortHira(w)) ts.push(T_JA);
  if (/^[a-z ]+$/.test(w)) ts.push(T_UP);
  perWord[w] = 0;
  for (const tpl of ts) {
    const s = tpl(w);
    const r = moderate(s);
    generated++;
    if (ok(r && r.ok === false && r.word === w, `拒否「${s}」→ 語「${w}」（実 ${J(r)}）`)) perWord[w]++;
  }
}
ok(NG_WORDS.length >= 30, `NG 語の一覧が空でない（${NG_WORDS.length} 語・是正前は 39 語）`);
ok(Object.values(perWord).every((n) => n >= 1) && generated >= NG_WORDS.length,
   `全語で 1 本以上の拒否が成立（生成 ${generated} 本・拒否に失敗した語 ${J(Object.keys(perWord).filter((w) => perWord[w] < 1))}）`);
// 語尾の活用・合成語（moderate.js ①: -s/-es/-ed/-ing/-y・sub の語は部分一致）。是正前も拒否（部分一致）だった形。
for (const [s, w] of [['idiots everywhere', 'idiot'], ['so retarded', 'retard'], ['a sexy line', 'sex'], ['fucking slow', 'fuck'],
  ['motherfucker', 'fuck'], ['nudes', 'nude'], ['pornography', 'porn'], ['このカスが', 'カス'], ['エロい', 'エロ'], ['バカな車', 'バカ'],
  ['死ねない', '死ね']]) {
  const r = moderate(s);
  ok(r && r.ok === false && r.word === w, `拒否（活用・合成）「${s}」→ 語「${w}」（実 ${J(r)}）`);
}

console.log('\nA-3) URL 過多（http(s):// が 4 本以上で拒否・3 本は通過）');
const urls = (n, p = 'https') => Array.from({ length: n }, (_, i) => `${p}://e${i}.example/`).join(' ');
ok(J(moderate(urls(4))) === J({ ok: false, word: 'リンク過多' }), `https 4 本 → リンク過多（実 ${J(moderate(urls(4)))}）`);
ok(J(moderate(urls(4, 'http'))) === J({ ok: false, word: 'リンク過多' }), 'http 4 本 → リンク過多');
ok(moderate(urls(3)).ok === true, 'https 3 本 → 通過');
ok(moderate('').ok === true && moderate(null).ok === true && moderate(undefined).ok === true, '空・null・undefined → 通過（例外を投げない）');

console.log('\nA-4) 配線（main.js の askSendBtn が moderate.js の moderate を呼ぶ・main.js に判定の写しが無い）');
{
  const main = readFileSync(join(JS, 'main.js'), 'utf8');
  ok(/^import \{ moderate \} from '\.\/moderate\.js';/m.test(main), "main.js が import { moderate } from './moderate.js'");
  ok(!/const NG_WORDS\b/.test(main) && !/function moderate\b/.test(main), 'main.js に NG_WORDS／function moderate の写しが無い');
  const h = main.indexOf("$('askSendBtn').addEventListener");
  ok(h >= 0 && /const m = moderate\(title \+ '\\n' \+ body\);/.test(main.slice(h, h + 1200)),
     "askSendBtn のハンドラが moderate(title + '\\n' + body) を呼ぶ");
  const msrc = existsSync(join(JS, 'moderate.js')) ? readFileSync(join(JS, 'moderate.js'), 'utf8') : '';
  ok(msrc !== '' && !/\b(document|window|localStorage)\b/.test(msrc.replace(/^\s*\/\/.*$/gm, '')),
     'moderate.js は DOM に触れない（document/window/localStorage の参照 0 件・コメントを除く）');
}

console.log('\nA-5) 取りこぼし側（v10.3.0 は部分一致で拒否していた攻撃表現。層4 F1 の実測）');
// A-5a: BL1 初版（9f5b4c2）の語境界化で通るようになったため一覧・規則に足した行＝拒否（是正前の木でも拒否）。
for (const [s, w] of [['kill yourself', 'kill yourself'], ['you should kill yourselves', 'kill yourselves'],
  ['dickhead', 'dickhead'], ['cocksucker', 'cocksucker'], ['idiotic', 'idiot'], ['idiotically slow', 'idiot'],
  ['stupidity', 'stupid'], ['stupidly', 'stupid'], ['die in a fire', 'die in a fire'], ['you should die now', 'you should die'],
  ['バカヤロー', 'バカヤロ'], ['バカヤロウ', 'バカヤロ'], ['デブス', 'デブス'], ['アホンダラ', 'アホンダラ'],
  ['在日韓国人は出ていけ', '在日'], ['在日朝鮮人', '在日'], ['人種差別', '人種差別'], ['差別的な発言', '差別的'],
  ['sex_toy', 'sex'], ['sex69', 'sex'], ['sexy69', 'sex'], ['dickface', 'dickface'], ['dickwad', 'dickwad'],
  ['cockhead', 'cockhead'], ['エロゲーム', 'エロゲ'], ['stupider', 'stupid']]) {
  const r = moderate(s);
  ok(r && r.ok === false, `拒否（取りこぼしの是正）「${s}」（実 ${J(r)}・現行の語「${w}」）`);
}
// A-5b／A-5c: 直さずに残した行。moderate.js 冒頭「既知の残り」に同じ文が書いてあり、挙動もその記述どおりであること
// （直したらここが赤になる＝記述も直す）。
const MSRC = existsSync(join(JS, 'moderate.js')) ? readFileSync(join(JS, 'moderate.js'), 'utf8') : '';
for (const s of ['お前はしね', 'しねよ', 'もうしね', 'i will kill your family', 'エロイ', '性差別', '差別発言',
  'クソバカ', 'ドアホ', 'カスヤロー', '差別野郎', 'sexist', 'cockface']) {
  const r = moderate(s);
  ok(r && r.ok === true && MSRC.includes(`「${s}」`), `既知の取りこぼし「${s}」＝通過かつ moderate.js に記述あり（実 ${J(r)}）`);
}
for (const [s, w] of [['少しね', 'しね'], ['勢いを殺す', '殺す'], ['pussyfoot', 'pussy'], ['Penistone', 'penis'],
  ['在日外国人向けの英語 UI', '在日'], ['在日本大使館', '在日']]) {
  const r = moderate(s);
  ok(r && r.ok === false && r.word === w && MSRC.includes(`「${s}」`),
     `既知の誤検出「${s}」→ 語「${w}」かつ moderate.js に記述あり（実 ${J(r)}）`);
}

const line = '─'.repeat(64);
console.log('\n' + line);
console.log(`wf_bl1_ui: pass=${pass} fail=${fail}`);
if (fail) { for (const m of fails.slice(0, 40)) console.log('  ✗ ' + m); if (fails.length > 40) console.log(`  … ほか ${fails.length - 40} 件`); }
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
