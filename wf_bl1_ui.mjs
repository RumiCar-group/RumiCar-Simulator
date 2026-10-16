// wf_bl1_ui.mjs — Stage BL（UI 不具合）の常設ゲート。BL1 が新設し、BL2〜BL7 が章を足す（A＝BL1・B＝BL2・C〜F＝BL3・G＝BL4）。
// ════════════════════════════════════════════════════════════════════════════
// 本番モジュールを import して答えさせる（再実装しない・CI-9）。実ブラウザでしか測れない部分は
// browser/check_bl<n>_*.mjs（run_all.sh が glob で拾う）。
//
// A) BL1 質問・提案（💬）の NG ワード判定 — public/js/moderate.js の moderate()（main.js の askSendBtn が呼ぶ唯一の判定）。
//    是正前（ad5ddd1＝v10.3.0）は main.js の中の NG 語を `includes` で部分一致させていたため、アプリ自身の語彙
//    「カスタム車種」（カス）・「cockpit」（cock）・「Essex」「Sussex」（sex）・「Dickens」（dick）・「die hard」（"die "）・
//    「スカスカ」（カス）が拒否された。A-1 の通過表（PLAN BL1 の 9 行＋設計で決めた規則の行）と A-2 の拒否表
//    （product の NG_WORDS の全語から機械生成・語ごとに複数の文）と A-3 の URL 過多・A-4 の配線、A-5 の取りこぼし側の表
//    （v10.3.0 は拒否していた攻撃表現: 語境界化で通るようになり一覧・規則に足した行＝拒否／直さずに残した行＝
//    moderate.js 冒頭「既知の残り」と一致すること／v10.3.0 から残る誤検出）、A-6／A-7 の前後の文字の機械列挙
//    （日本語の短い語・英字の語の前後に小書き仮名・長音・促音・半角カナ・記号・数字・英字などを付けた文を、文字の分類表と
//    規則から決まる期待と照合し、v10.3.0 は拒否・現在は通る行を「既知の残り」の型 (j1)〜(j3)・(e1) ごとに表で出す）を固定する。
//    `--root <是正前の木>` で回すと、moderate.js が無い木では main.js の NG_WORDS と moderate の本文を
//    取り出して評価する（是正前の木の判定を是正前のまま測るためだけの読み口＝product の経路は変えない）。
//    赤になる章（2026-10-16 の実測・件数は決定ログ BL1 結果）: ad5ddd1（v10.3.0）＝A-1（PLAN の 9 行のうち diesel・
//    differential 以外の 7 行と規則の行）・A-4・A-5・A-6・A-7。9f5b4c2（BL1 初版）＝A-1 の 2 行・A-5・A-6・A-7。
//    e2869c0（層4 往復 1）＝A-5・A-6・A-7（添え字の付いた短い語・数字の後の英字の語・sexual）。
//
// B) BL2 走行中の設定変更の停止処理 — main.js の配線（本文を読む・DOM 前提で import できないため）。
//    是正前（ad5ddd1〜b649a95＝v10.3.0）は loadCourse と設定の change 8 経路（optTire/optGear/optSusp/optSteer/optBrake/
//    optWear/optPhysMode/regimeSel）が `running = false; paused = false; syncButtons();` だけで止め、setRunView(false)・
//    releaseDrive を通らなかった（走行中に変えるとコード表示のまま固定・■ が無効）。B-1 `running = false` の出現が stopAuto の
//    中だけ（是正前 11 箇所＝stopAuto・loadCourse・change 8 本・startAuto の ok === 0）、B-2 stopAuto の本文、B-3 9 経路が
//    stopAuto() を呼ぶ、B-4 発火元（courseSel → selectCourse → applyCourse → loadCourse・enforceFitRatio の fx.regime →
//    regimeSel の change・startAuto の失敗経路）。見た目（■・.cc-editor・.cc-code）は browser/check_bl2_runview.mjs。
//    赤になる章（2026-10-16 の実測）: ad5ddd1／b649a95（BL1 後・BL2 前）＝B-1・B-3・B-4（startAuto の行）。
//
// C) BL3 ① 順位表（HUD の leaderboard）の並び — hud.js drawFleetHud を mock ctx で呼び fillText の順で読む。
//    lap.js の lapTime は現周回の経過時間（周回を数えると 0）＝同じ周回数なら lapTime の長い車が先に線を越えた。
//    是正前は同周回を lapTime の昇順に並べ後続車を 1 位に描いた。峠のゴール済み同士はタイムの短い順・周回数違いは従来どおり。
// D) BL3 ② 記録 → エントリーの名前引き — race_ladder.js recordsFrom（言語別ラダーの lang）と race_ui.js の 2 か所
//    （📖 ショーケースの優勝エントリーの intro＝D-3・👻 の相手のプログラム＝D-4。E/F の治具で本番の経路から測る）。
//    是正前は作者の先勝ちで、同じ作者の 2 件目（C と py）の記録が 1 件目を引いた。
// E) BL3 ③ 再実行検証（verifyOfficialLocally）— frozenField を try の中へ。carDef.key が {toString:1} のエントリーで
//    TypeError が漏れず official.verify.badEntry（ja/en）を出す。正常な event は生成側（frozenField → resolveEventSpec →
//    runRace＝wf_official_result と同じ）と同じ verifyHash で「一致」と出す（是正前後で同じ値）。
// F) BL3 ④ 👻 あなた vs 世界ベスト（ghostVsWorld）の runRace の spec に physics/recon/wear が resolveEventSpec と同じ値で入る。
//    E/F の治具: race_ui.js を本番のまま import し、それが import する './race_engine.js'・'./loader.js' だけを
//    module.registerHooks で「本物を再輸出して runRace（呼び出しを記録して本物を呼ぶ）・上流の取得（治具の大会を返す）を
//    包む module」に解決する。🏆 の大会選択（selectOfficialRace）→「再実行検証」の click、🏅 の集計（loadAllOfficialData →
//    renderRankings）→ 👻 ボタンの data-cls/data-course で ghostVsWorld、と利用者と同じ入口から呼ぶ。DOM は $ の mock。
//    赤になる章（2026-10-16 の実測・--root）: f61d970（BL2 後・BL3 前）＝C-1・C-5・D-1・D-2b・D-3・E（例外と文言 ja/en）・
//    F（physics・recon・wear）・D-4 の 15 件。実ブラウザは browser/check_bl3_rankorder.mjs（順位表を実走で測る）。
//
// G) BL4 未エスケープの innerHTML と esc の非文字列耐性 — 表示側のエスケープ（入口の検査に頼らない）。
//    G-1 esc（public/js/escape.js の escapeHtml。BL4 で main.js から分離・main.js が import して race_ui/car_crud へ注入）が
//    {toString:1}・Object.create(null)・Proxy・Symbol・null・undefined・数値でも投げず文字列を返す（String(s) が投げる値は '?'）。
//    G-2 race_ui.js 🏆 の詳細の順位・ペナルティ（result.json）と再実行検証の結果の予算（event.budget.total）が文字列のまま見える。
//    G-3 🏆 の詳細は名前・intro・carDef.key が文字列にできないエントリーでも最後まで描ける（esc と main.js entryCarLabel の
//    hasOwnProperty.call を本文のまま評価して注入・決定ログ BL-3 の申し送り）。G-4 配線: car_crud.js・race_ui.js の
//    テンプレート文字列の ${…} を字句解析で全部取り出し、esc／fmtTime／t('…') で包まれていない式は一覧（理由つき）に
//    あるものだけ（一覧に無い式・ソースから消えた一覧の式は赤）。G-4b metaRows の値は全部 esc。G-5 car_crud.js の車種表と
//    編集フォーム（自作車〔localStorage〕・投稿車種〔registerCarType〕・組込の上書き〔applyCarOverride〕・JSON → フォーム）で
//    `<img`・onerror を持つタグが 0・`&lt;img` があり、value 属性が元の文字列のまま。出荷 6 車種の行は是正前の書き方と同一。
//    「onerror= を含まない」は**タグの中に**含まないことで測る（エスケープした本文は onerror= の綴りを文字として残す）。
//    G-4c 属性の値に入る ${…} は " 囲み（escape.js は ' をエスケープしない＝' 囲み・引用符なしは赤）。
//    G-6（層4 往復 1）文字列・数にできない値の同族: t() の {var} の差し込み（i18n.js の 1 か所＝join が投げたら String(v)／'?'）・
//    大会（event／entries／result）の値の欄を 1 つずつ {"toString":1}・Object.create(null)・Symbol() に替えて 🏆 詳細・🍴 fork・
//    再実行検証・🏅 の集計・打破通知・👻 の 6 入口で例外が漏れない表（race_ui.js の asText／asNum・aggregateNow の
//    「単独で通らない大会を外す」）・結果ダイアログの t()（:115 新記録・:123 最速ラップ・:127 勝者）・🏆 の公式記録の 1 行／
//    旧版の注記・main.js carTypeName（投稿車種の name）・carTypeLabel・loadCommunityCars（key が文字列にできない投稿）。
//    赤になる章（2026-10-16 の実測・--root 8248a58＝BL3 後・BL4 前）: 件数は決定ログ BL4 結果。--root 8a4bd2e（BL4 初版）＝
//    G-4（renderOfficialDetail の fmtTime(asNum(…)) の 2 行）・G-6。実ブラウザは browser/check_bl4_escape.mjs
//    （自作車の車種表と編集フォームを実画面で開き、img 要素 0・alert 0）。
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

// BL4: innerHTML のエスケープ（escapeHtml）の読み口。是正後: escape.js を import。是正前の木（escape.js が無い）:
// main.js の `function escapeHtml(` の 1 行を取り出して評価する（loadModerate と同じ・product の経路は変えない）。
async function loadEscape() {
  const mod = join(JS, 'escape.js');
  if (existsSync(mod)) return { escapeHtml: (await import(pathToFileURL(mod).href)).escapeHtml, from: 'escape.js' };
  const src = readFileSync(join(JS, 'main.js'), 'utf8');
  const m = /^function escapeHtml\(s\) \{.*\}$/m.exec(src);
  if (!m) throw new Error('main.js に function escapeHtml が見つからない');
  return { escapeHtml: new Function(`${m[0]}\nreturn escapeHtml;`)(), from: 'main.js（是正前の木の本文を評価）' };
}
const { escapeHtml: ESC, from: escFrom } = await loadEscape();
console.log(`  エスケープ: ${escFrom}`);
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
  // 層4 往復 2 の F1（添え字の先がカタカナの文字なら長い語の一部）
  'エロージョン', 'パーカス', 'ルーカス', 'ホッブス', 'ジョブス', 'sextant',
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
  ['cockhead', 'cockhead'], ['エロゲーム', 'エロゲ'], ['stupider', 'stupid'],
  // 層4 往復 2 の F1／F3（添え字の読み飛ばし・数字は区切り・sex の語尾 -ual）
  ['お前はバカッ', 'バカ'], ['バカッ！', 'バカ'], ['アホー！', 'アホ'], ['おまえ、バカッ！', 'バカ'], ['ちょーバカ', 'バカ'],
  ['マジでちょーカスだな', 'カス'], ['すげーアホ', 'アホ'], ['お前はエロッ', 'エロ'], ['クズーッ', 'クズ'], ['ブスｯ', 'ブス'],
  ['デブァ', 'デブ'], ['しねっ！', 'しね'], ['しねぇ', 'しね'], ['sexual content', 'sex'], ['69sex', 'sex']]) {
  const r = moderate(s);
  ok(r && r.ok === false, `拒否（取りこぼしの是正）「${s}」（実 ${J(r)}・現行の語「${w}」）`);
}
// A-5b／A-5c: 直さずに残した行。moderate.js 冒頭「既知の残り」に同じ文が書いてあり、挙動もその記述どおりであること
// （直したらここが赤になる＝記述も直す）。
const MSRC = existsSync(join(JS, 'moderate.js')) ? readFileSync(join(JS, 'moderate.js'), 'utf8') : '';
for (const s of ['お前はしね', 'しねよ', 'もうしね', 'i will kill your family', 'エロイ', '性差別', '差別発言',
  'クソバカ', 'ドアホ', 'カスヤロー', '差別野郎', 'sexist', 'cockface',
  'バカッタレ', 'スーパーバカ', 'バカバカ', 'しねぇよ', 'homosexual', 'just die already', 'die bitch']) {
  const r = moderate(s);
  ok(r && r.ok === true && MSRC.includes(`「${s}」`), `既知の取りこぼし「${s}」＝通過かつ moderate.js に記述あり（実 ${J(r)}）`);
}
for (const [s, w] of [['少しね', 'しね'], ['勢いを殺す', '殺す'], ['pussyfoot', 'pussy'], ['Penistone', 'penis'],
  ['在日外国人向けの英語 UI', '在日'], ['在日本大使館', '在日'], ['非差別的な扱い', '差別的'], ['無差別的', '差別的'],
  ['反人種差別', '人種差別'], ['人種差別撤廃条約', '人種差別'], ['エラーコード 0xxx', 'xxx']]) {
  const r = moderate(s);
  ok(r && r.ok === false && r.word === w && MSRC.includes(`「${s}」`),
     `既知の誤検出「${s}」→ 語「${w}」かつ moderate.js に記述あり（実 ${J(r)}）`);
}

// ── A-6／A-7: 前後の文字を機械的に並べて v10.3.0（部分一致）と突き合わせる（層4 往復 2 の F1／F3）─────────────
// v10.3.0 の判定は「NG 語のどれかを部分一致で含めば拒否」だったので、NG 語を含む文は全部拒否していた。
// ここでは NG 語の前後に付きうる文字（小書き仮名・長音・促音・半角カナ・半角濁点・踊り字・ひらがな・漢字・記号・感嘆・
// 数字・英字）を文字の分類つきで列挙し、moderate.js 冒頭の規則（② の添え字の読み飛ばし・① の語境界）から決まる
// 期待（通過／拒否）と product の答えを全行で照合する。通過の行＝「v10.3.0 は拒否・現在は通る」行で、その表を
// 分類（moderate.js「既知の残り」の (j1)〜(j3)・(e1)）ごとに全件出す。期待は文字の分類表から決める（判定の写しではない）。
const OLD_V1030 = ['セックス', 'エロ', 'av女優', 'ちんちん', 'まんこ', 'ペニス', 'ヴァギナ', 'パイズリ', 'オナニー',
  'sex', 'porn', 'pussy', 'dick', 'cock', 'penis', 'vagina', 'boobs', 'nude', 'xxx', 'fuck',
  '死ね', '殺す', 'しね', 'バカ', 'アホ', 'クズ', 'カス', 'キモい', 'ブス', 'デブ', 'きちがい', 'キチガイ',
  '在日', '差別', 'idiot', 'stupid', 'retard', 'kill you', 'die '];  // ad5ddd1 main.js:2685-2692 の写し（比較専用・39 語）
const oldRejects = (s) => { const t = s.toLowerCase(); return OLD_V1030.some((w) => t.includes(w.toLowerCase())); };

console.log('\nA-6) 日本語の短い語の前後の文字（v10.3.0 は全行拒否。通過は「既知の残り」(j1)〜(j3) の型だけ）');
// 文字の分類。kata/hira/kanji＝その文字種の文字、kataM/hiraM＝その文字種の語で読み飛ばす添え字、other＝区切り。
const CH = [];
const addCh = (cat, str) => { for (const c of str) CH.push({ c, cat }); };
addCh('kata', 'アカンタｱｶスパルホジレマエロバクズブデ');
addCh('kataM', 'ァィゥェォッャュョヮヵヶㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿｧｨｩｪｫｬｭｮｯーｰﾞﾟヽヾ');
addCh('hira', 'あはちげよだなてのすめおまえでたれしね');
addCh('hiraM', 'ぁぃぅぇぉっゃゅょゎゕゖゝゞ');
addCh('kanji', '漢超々〆\u{20BB7}前在日差別');
addCh('other', '！？!?。、…〜～・「」（）() 　wｗ♪☆♡💢#@-_/.,01１a');
const catOf = new Map(CH.map((x) => [x.c, x.cat]));
const SCRIPT_OF_CAT = { kata: 'kata', kataM: 'kata', hira: 'hira', hiraM: 'hira', kanji: 'kanji', other: null };
// 規則②: 語の文字種 sc の添え字（sc+'M'）を読み飛ばし、その先の文字（無ければ文の端）が sc なら「続き」。
const contOf = (chars, sc) => {
  for (const c of chars) {
    const k = catOf.get(c);
    if (!k) throw new Error(`A-6 の文字の分類表に無い文字「${c}」`);
    if (k === sc + 'M') continue;
    return SCRIPT_OF_CAT[k] === sc;
  }
  return false;
};
const scriptOfWord = (w) => (/^[ァ-ヺ]+$/.test(w) ? 'kata' : /^[ぁ-ゖ]+$/.test(w) ? 'hira' : /^[一-鿿]+$/.test(w) ? 'kanji' : null);
const SHORT = NG_WORDS.filter((w) => [...w].length <= 2 && scriptOfWord(w));
const LEFT_ONLY = new Set(['在日']);  // moderate.js の side: 'left'
const NG3 = NG_WORDS.filter((w) => !/^[a-z ]+$/.test(w) && !SHORT.includes(w));  // 規則③（部分一致）の日本語の語
// 文 s の期待（規則②③）: ③ の語を含めば拒否。② の語は出現ごとに、直前（leftOnly でなければ直後も）が「続き」で
// なければ拒否（「バカ」＋「ス」＝バカス は カス の直前が カ＝続き・直後が文の端＝拒否。デブス は ③）。
const specPassJa = (s) => {
  if (NG3.some((x) => s.includes(x))) return false;
  for (const x of SHORT) {
    const sc = scriptOfWord(x);
    for (let i = s.indexOf(x); i >= 0; i = s.indexOf(x, i + 1)) {
      const lc = contOf([...s.slice(0, i)].reverse(), sc);
      const rc = contOf([...s.slice(i + x.length)], sc);
      if (!(lc || (!LEFT_ONLY.has(x) && rc))) return false;
    }
  }
  return true;
};
ok(J(SHORT) === J(['エロ', 'しね', 'バカ', 'アホ', 'クズ', 'カス', 'ブス', 'デブ', '在日', '差別']),
   `2 文字以下の日本語の語＝${J(SHORT)}`);
// 文脈: 1 文字ぜんぶ＋各添え字の先に代表の文字を 1 つ（右は「添え字＋X」、左は「X＋添え字」）＋語ごとの実例。
const REPS = ['', '！', 'ア', 'あ', '漢', 'ー', 'ッ', 'っ'];
const RIGHT = new Set(['']), LEFT = new Set(['']);
for (const { c, cat } of CH) {
  RIGHT.add(c); LEFT.add(c);
  if (cat === 'kataM' || cat === 'hiraM') for (const r of REPS) { RIGHT.add(c + r); LEFT.add(r + c); }
}
for (const r of ['ーッ！', 'ッ！', 'ー！', 'ーーー', 'ッッ', 'ァァ', 'ーｯ', 'ージョン', 'ッタレ', 'ッたれ', 'ぇよ', 'ーよ', 'っての', 'だな', 'だ']) RIGHT.add(r);
for (const l of ['ちょー', 'すげー', 'めっちゃー', 'スーパー', 'パー', 'ルー', 'ホッ', 'ジョ', 'ちょっ', 'お前は', 'おまえ、', 'マジでちょー', 'ーー']) LEFT.add(l);
const passTable = new Map();  // `${sc}|${side}` → Map(文脈 → 通った語の配列)
let a6rows = 0;
for (const w of SHORT) {
  const sc = scriptOfWord(w);
  const lo = LEFT_ONLY.has(w);
  const bad = { left: [], right: [], cross: [] };
  const run = (side, l, r) => {
    const s = l + w + r;
    const expPass = specPassJa(s);
    const got = moderate(s);
    a6rows++;
    if (!oldRejects(s)) bad[side].push(`${s}（v10.3.0 が拒否しない＝表の前提外）`);
    if (!got || got.ok !== expPass) bad[side].push(`${s}（期待 ${expPass ? '通過' : '拒否'}・実 ${J(got)}）`);
    if (expPass && side !== 'cross') {
      const key = `${sc}|${side}`, ctx = side === 'left' ? l : r;
      if (!passTable.has(key)) passTable.set(key, new Map());
      const m = passTable.get(key);
      if (!m.has(ctx)) m.set(ctx, []);
      m.get(ctx).push(w);
    }
  };
  for (const l of LEFT) run('left', l, '');
  if (!lo) for (const r of RIGHT) run('right', '', r);
  const CL = ['', 'ー', 'ッ', 'ちょー', 'パー', 'あ', 'ア', '漢', '！', 'お前は'];
  const CR = ['', 'ー', 'ッ！', 'ージョン', 'あ', 'ア', '漢', '！', 'ぇよ', 'だな'];
  for (const l of CL) for (const r of CR) run('cross', l, r);
  for (const side of ['left', 'right', 'cross']) {
    if (side === 'right' && lo) continue;
    const n = side === 'left' ? LEFT.size : side === 'right' ? RIGHT.size : CL.length * CR.length;
    ok(bad[side].length === 0, `「${w}」${side === 'left' ? '直前' : side === 'right' ? '直後' : '前後の組'} ${n} 通りが規則②どおり${bad[side].length ? `（食い違い ${bad[side].length}: ${bad[side].slice(0, 6).join(' / ')}）` : ''}`);
  }
}
// 表は文字種×側で 1 本（文字種の全語では通らない文脈は「（…だけ）」で通る語を示す）。
const CLASS = { kata: '(j1)', hira: '(j2)', kanji: '(j3)' };
console.log(`  ── 表: v10.3.0 は拒否・現在は通る文脈（${a6rows} 文から機械生成。語の前後の片側だけに付けた文脈）`);
for (const [key, m] of [...passTable].sort()) {
  const [sc, side] = key.split('|');
  const words = SHORT.filter((w) => scriptOfWord(w) === sc && !(side === 'right' && LEFT_ONLY.has(w)));
  const cell = ([ctx, ws]) => `[${ctx}]${ws.length < words.length ? `（${ws.join('・')}だけ）` : ''}`;
  console.log(`  ${CLASS[sc]} ${sc}（${words.join('・')}）の${side === 'left' ? '直前' : '直後'} ${m.size} 種: ${[...m].map(cell).join(' ')}`);
  ok(MSRC.includes(CLASS[sc]), `表の型 ${CLASS[sc]} が moderate.js「既知の残り」に書いてある`);
  // 型の中身: 通る文脈は、添え字の先に語と同じ文字種の文字（添え字でない）を含むものだけ（「ちょーバカ」「すげーアホ」は拒否）。
  ok([...m.keys()].every((ctx) => [...ctx].some((c) => catOf.get(c) === sc)),
     `${CLASS[sc]} の${side === 'left' ? '直前' : '直後'}で通る文脈はすべて ${sc} の文字を含む（添え字・記号だけの文脈は拒否）`);
}
// 参考: ひらがな書き・半角カナ書き・全角英字は v10.3.0 から一覧に無い（v10.3.0 と同じく通る＝回帰ではない）。
for (const s of ['ばか', 'あほ', 'かす', 'ﾊﾞｶ', 'ｱﾎ', 'ｶｽ', 'ＳＥＸ']) {
  const r = moderate(s);
  ok(r && r.ok === !oldRejects(s) && MSRC.includes(`「${s}」`), `v10.3.0 と同じ「${s}」（実 ${J(r)}・v10.3.0 ${oldRejects(s) ? '拒否' : '通過'}）かつ moderate.js に記述あり`);
}

console.log('\nA-7) 英字の語の前後の文字（v10.3.0 は全行拒否〔一覧に無かった句を除く〕。通過は (e1) の型だけ）');
const DEF_SUF = ['', 's', 'es', 'ed', 'ing', 'y'];
const ASCII_SPEC = {  // moderate.js ① の語尾（suf）。一覧を変えたらここも変える（下の照合が赤になる）。
  sex: [...DEF_SUF, 'ual', 'ually', 'uality'], dick: DEF_SUF, cock: DEF_SUF, nude: DEF_SUF, xxx: DEF_SUF,
  idiot: ['', 's', 'ic', 'ically'], stupid: ['', 's', 'ity', 'ly', 'er', 'est'], retard: ['', 's', 'ed'],
  'kill you': DEF_SUF, 'kill yourself': DEF_SUF, 'kill yourselves': DEF_SUF, 'go die': DEF_SUF, 'die in a fire': DEF_SUF,
  'you should die': DEF_SUF,
};
const SUB_ASCII = ['porn', 'pussy', 'penis', 'vagina', 'boobs', 'fuck', 'dickhead', 'dickface', 'dickwad', 'cockhead', 'cocksucker'];
ok(J(NG_WORDS.filter((w) => /^[a-z ]+$/.test(w)).sort()) === J([...Object.keys(ASCII_SPEC), ...SUB_ASCII].sort()),
   '英字の語＝語境界の語（ASCII_SPEC）＋部分一致の語（SUB_ASCII）');
// 直前: 英字・_ は語の続き（通過）、それ以外（数字・記号・空白・日本語・文の端）は区切り。
const PRE = { '': false, ' ': false, a: true, x: true, Q: true, homo: true, _: true, 9: false, 69: false, 0: false, '-': false,
  '#': false, '.': false, '@': false, "'": false, '(': false, 'の': false, 'お前は': false, 'é': false };
const SUFS = ['', 's', 'es', 'ed', 'ing', 'y', 'ual', 'ually', 'uality', 'ual content', 'ic', 'ically', 'ity', 'ly', 'er', 'est',
  'ist', 'ish', 'tant', 'ens', 'pit', 'x', 'S', 'ED', 'Y', '69', '9', '_', '_toy', '!', '.', ' ', ' content', '-', 'é', 'の'];
const sufCont = (w, s) => { const t = s.toLowerCase(); return !ASCII_SPEC[w].some((x) => t.startsWith(x) && !/[a-z]/.test(t[x.length] ?? '')); };
const passE = new Map();
let a7rows = 0;
for (const w of Object.keys(ASCII_SPEC)) {
  const bad = [];
  for (const [pre, pc] of Object.entries(PRE)) for (const suf of SUFS) {
    const s = pre + w + suf;
    const expPass = pc || sufCont(w, suf);
    const got = moderate(s);
    a7rows++;
    if (!got || got.ok !== expPass) bad.push(`${s}（期待 ${expPass ? '通過' : '拒否'}・実 ${J(got)}）`);
    if (expPass && oldRejects(s)) {
      if (!passE.has(w)) passE.set(w, { pre: new Set(), suf: new Set() });
      if (pc) passE.get(w).pre.add(pre);
      else passE.get(w).suf.add(suf);
    }
  }
  ok(bad.length === 0, `「${w}」前 ${Object.keys(PRE).length}×後 ${SUFS.length} 通りが規則①どおり${bad.length ? `（食い違い ${bad.length}: ${bad.slice(0, 6).join(' / ')}）` : ''}`);
}
console.log(`  ── 表: v10.3.0 は拒否・現在は通る形（${a7rows} 文から機械生成。前だけ／後だけに付けた形）`);
for (const [w, { pre, suf }] of passE) console.log(`  (e1) ${w}: 前 [${[...pre].join('] [')}]・後 [${[...suf].join('] [')}]`);
ok(passE.size === 0 || MSRC.includes('(e1)'), '表の型 (e1) が moderate.js「既知の残り」に書いてある');
// "die "（v10.3.0 の末尾空白つきの語）にだけ当たっていた文: 意図の明らかな句だけ拒否・ほかは (e2)。
for (const [s, exp] of [['go die now', false], ['die in a fire now', false], ['you should die now', false], ['die idiot', false],
  ['just die already', true], ['die bitch', true], ['die hard', true], ['the engine would die here', true]]) {
  const r = moderate(s);
  ok(r && r.ok === exp && oldRejects(s) && (!exp || PASS_PLAN.includes(s) || PASS_RULE.includes(s) || MSRC.includes(`「${s}」`)),
     `"die " の文「${s}」→ ${exp ? '通過' : '拒否'}（実 ${J(r)}・v10.3.0 は拒否）`);
}

// ── B) BL2 走行中の設定変更の停止処理（main.js の配線）────────────────────────────
// main.js は DOM を前提にするので import できない＝本文を読んで配線だけを検査する（挙動は browser/check_bl2_runview.mjs）。
// 行コメントを落としてから数える（コメントの中の `running = false` は配線ではない）。`//` の直前が行頭か空白のときだけ
// コメントとみなす（'https://…' の // は落とさない）。
console.log('\nB-1) `running = false`（全体の走行状態を落とす代入）は stopAuto の中だけ');
const MAIN = readFileSync(join(JS, 'main.js'), 'utf8');
const CODE = MAIN.split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
const lineOf = (i) => CODE.slice(0, i).split('\n').length;
// i（`{` の位置）から対応する `}` までを返す（行コメントは落とし済み。文字列・テンプレートの中の括弧は数えない）。
function blockAt(i) {
  let d = 0, q = null;
  for (let k = i; k < CODE.length; k++) {
    const c = CODE[k];
    if (q) { if (c === '\\') k++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') d++;
    else if (c === '}' && --d === 0) return { a: i, b: k, text: CODE.slice(i, k + 1) };
  }
  return null;
}
function fnBody(name) {
  const m = new RegExp(`\\nfunction ${name}\\s*\\([^)]*\\)\\s*\\{`).exec(CODE);
  return m ? blockAt(m.index + m[0].length - 1) : null;
}
// `$('<id>')` を受けた変数に繋いだ change ハンドラ（`const xEl = $('id'); if (xEl) xEl.addEventListener('change', (e) => {…})`）、
// または `$('<id>').addEventListener('change', …)` の本文。
function changeHandler(id) {
  // 宣言と登録が隣り合う最上位の形だけを拾う（関数の中の `const sel = $('regimeSel')` などを取り違えない）。
  const h = new RegExp(`\\nconst (\\w+) = \\$\\('${id}'\\);\\s*\\n(?:if \\(\\1\\) )?\\1\\.addEventListener\\('change',\\s*\\(e\\)\\s*=>\\s*\\{`).exec(CODE)
         || new RegExp(`\\n\\$\\('${id}'\\)\\.addEventListener\\('change',\\s*\\(e\\)\\s*=>\\s*\\{`).exec(CODE);
  return h ? blockAt(h.index + h[0].length - 1) : null;
}
const stopB = fnBody('stopAuto');
const RUN_FALSE = /(?<![\w.$])running\s*=\s*false/g;
const sites = [];
for (let mm; (mm = RUN_FALSE.exec(CODE));) {
  if (/let\s+$/.test(CODE.slice(Math.max(0, mm.index - 8), mm.index))) continue;   // 宣言 `let running = false;` は代入ではない
  sites.push({ at: mm.index, line: lineOf(mm.index), inStop: !!stopB && mm.index > stopB.a && mm.index < stopB.b });
}
// 是正前（ad5ddd1〜b649a95）の実数は 11 箇所（stopAuto・loadCourse・change ハンドラ 8 本・startAuto の ok === 0）。
// PLAN の「10 箇所」は startAuto の 1 箇所を数えていなかった（先頭で stopAuto を呼んだ後の重ね書き＝同じ姿）。
console.log(`  出現 ${sites.length} 箇所（main.js:${sites.map((x) => x.line + (x.inStop ? '〔stopAuto〕' : '')).join(', ')}）`);
ok(!!stopB, 'stopAuto() の定義がある');
const outside = sites.filter((x) => !x.inStop);
ok(sites.length >= 1 && outside.length === 0,
   `running = false は stopAuto の中だけ（外 ${outside.length} 箇所${outside.length ? ': main.js:' + outside.map((x) => x.line).join(', ') : ''}）`);

console.log('\nB-2) stopAuto が停止の姿を全部つくる（駆動解除・編集表示・ボタン）');
for (const want of [/(?<![\w.$])running\s*=\s*false/, /(?<![\w.$])paused\s*=\s*false/, /releaseDrive\(slots\)/, /setRunView\(false\)/, /syncButtons\(\)/]) {
  ok(!!stopB && want.test(stopB.text), `stopAuto の本文に ${want.source.replace(/\(\?<!\[\\w\.\$\]\)/, '').replace(/\\s\*/g, ' ').replace(/\\/g, '')}`);
}

console.log('\nB-3) 走行中の設定変更 9 経路が stopAuto を呼ぶ（是正前は 9 経路とも running = false の直書き）');
const PATHS9 = [
  ['loadCourse（コース選択・投稿コースの復元・エディタ適用）', fnBody('loadCourse')],
  ...['optTire', 'optGear', 'optSusp', 'optSteer', 'optBrake', 'optWear', 'optPhysMode', 'regimeSel'].map((id) => [`${id} の change`, changeHandler(id)]),
];
for (const [label, b] of PATHS9) {
  const calls = b ? (b.text.match(/(?<![\w.$])stopAuto\(\)/g) || []).length : 0;
  const direct = b ? (b.text.match(RUN_FALSE) || []).length : 0;
  ok(!!b && calls >= 1 && direct === 0, `${label}${b ? `（main.js:${lineOf(b.a)}）` : '（本文が見つからない）'}: stopAuto() ${calls} 回・running = false の直書き ${direct}`);
}

console.log('\nB-4) 9 経路へ繋がる発火元（コース選択 → loadCourse・enforceFitRatio の領域切替 → regimeSel の change）');
const selB = fnBody('selectCourse'), appB = fnBody('applyCourse'), fitB = fnBody('enforceFitRatio');
ok(/\$\('courseSel'\)\.addEventListener\('change',[^\n]*selectCourse\(/.test(CODE), 'courseSel の change → selectCourse');
ok(!!selB && /(?<![\w.$])applyCourse\(/.test(selB.text), 'selectCourse → applyCourse');
ok(!!appB && /(?<![\w.$])loadCourse\(/.test(appB.text), 'applyCourse → loadCourse');
ok(!!fitB && /const sel = \$\('regimeSel'\)/.test(fitB.text) && /sel\.dispatchEvent\(new Event\('change'/.test(fitB.text),
   'enforceFitRatio の fx.regime は regimeSel の change を発火する（＝B-3 の regimeSel の経路を通る）');
const startB = fnBody('startAuto');
ok(!!startB && /if \(ok === 0\) \{ stopAuto\(\); return; \}/.test(startB.text), 'startAuto の「全車の setup 失敗」も stopAuto で止める');

// ── C) BL3 ① 順位表（HUD の leaderboard）の同周回内の並び ────────────────────────────
// 本番 hud.js の drawFleetHud を mock ctx で呼び、fillText の順で行（順位・名前）を読む（probe/rank.mjs の型）。
// lap.js の lapTime は現周回の経過時間（周回を数えると 0 へ戻る）＝同じ周回数なら lapTime が長い車ほど先に線を越えた。
// 峠（lap.touge）はゴールまで lapTime == totalTime で、ゴール済み（finished・laps=1）はタイム（totalTime）の短い順。
if (!globalThis.localStorage || typeof globalThis.localStorage.getItem !== 'function') {
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
}
console.log('\nC) 順位表の並び（hud.js drawFleetHud を mock ctx で呼ぶ）— 是正前: 同周回は lapTime の昇順＝後続車が 1 位');
const hud = await import(pathToFileURL(join(JS, 'hud.js')).href);
function lbOrder(slots) {
  const texts = [];
  const ctx = new Proxy({}, { get(t, k) {
    if (k === 'measureText') return (x) => ({ width: String(x).length * 7 });
    if (k === 'fillText') return (x) => texts.push(String(x));
    if (k in t) return t[k];
    return () => {};
  }, set(t, k, v) { t[k] = v; return true; } });
  hud.drawFleetHud(ctx, slots, { wPx: 800 }, -1);
  const names = new Set(slots.map((x) => x.name));   // 名前は 5 文字以下（lbName が切らない長さ）
  return texts.filter((x) => names.has(x));
}
const car = (name, lap) => ({ name, color: '#888', running: true, car: {}, lap });
const C_CASES = [
  // [見出し, slots, 期待の並び（1 位→）, 是正前も緑か]
  ['C-1 同周回（laps=2）: lapTime 10.0 の車（先行）が 1 位・1.0（後続）が 2 位',
    [car('AHEAD', { laps: 2, lapTime: 10.0, totalTime: 40 }), car('BACK', { laps: 2, lapTime: 1.0, totalTime: 31 })], ['AHEAD', 'BACK'], false],
  ['C-2 周回数が違えば周回数の多い順（lapTime に依らない）',
    [car('L2', { laps: 2, lapTime: 9.0 }), car('L3', { laps: 3, lapTime: 0.5 }), car('L0', { laps: 0, lapTime: 20 })], ['L3', 'L2', 'L0'], true],
  ['C-3 峠のゴール済み 2 台（laps=1・lapTime==totalTime）は totalTime の短い順',
    [car('SLOW', { laps: 1, finished: true, touge: true, lapTime: 30, totalTime: 30, lastLap: 30 }),
     car('FAST', { laps: 1, finished: true, touge: true, lapTime: 25, totalTime: 25, lastLap: 25 })], ['FAST', 'SLOW'], true],
  ['C-4 峠: ゴール済み（laps=1）は走行中（laps=0）より上',
    [car('RUN', { laps: 0, touge: true, lapTime: 50, totalTime: 50 }), car('GOAL', { laps: 1, finished: true, touge: true, lapTime: 40, totalTime: 40 })], ['GOAL', 'RUN'], true],
  ['C-5 3 台: 周回数 → 同周回は先に線を越えた順（lapTime の長い順）',
    [car('P3', { laps: 1, lapTime: 2.0 }), car('P1', { laps: 2, lapTime: 1.0 }), car('P2', { laps: 1, lapTime: 7.5 })], ['P1', 'P2', 'P3'], false],
  ['C-6 同周回・同じ lapTime は入力順のまま（安定）・lap の無い車は 0 周',
    [car('X1', { laps: 1, lapTime: 3 }), car('X2', { laps: 1, lapTime: 3 }), { name: 'NOLAP', color: '#888', running: false, car: {} }], ['X1', 'X2', 'NOLAP'], true],
];
for (const [label, slots, want] of C_CASES) {
  for (const rev of [false, true]) {
    if (rev && label.startsWith('C-6')) continue;   // 安定性の行は入力順そのものが期待
    const got = lbOrder(rev ? [...slots].reverse() : slots);
    ok(J(got) === J(want), `${label}${rev ? '（入力を逆順）' : ''}: 実 ${got.join(' → ')}`);
  }
}

// ── D) BL3 ② 記録 → エントリーの名前引き（同じ作者の 2 件目）───────────────────────
// 本番 race_ladder.js の recordsFrom（言語別ラダーの lang を entries から引く）。是正前は entryIndex の byAuthor が
// 先勝ちで、同じ作者の C と py の 2 エントリーの記録がどちらも 1 件目（C）を引いた（probe/author.mjs）。
// race_ui.js の 2 か所（📖 ショーケースの優勝エントリー・👻 の entryForRecord）は下の E/F の治具で本番の経路から測る（D-3・D-4）。
console.log('\nD) 記録 → エントリーの名前引き（race_ladder.js recordsFrom）— 是正前: 同じ作者の 2 件目を引けない');
const ladderM = await import(pathToFileURL(join(JS, 'race_ladder.js')).href);
const langOfRecs = (race) => Object.fromEntries(ladderM.recordsFrom([race]).map((r) => [r.name, r.lang]));
const raceOf = (entries, finishers) => ({ event: { id: 'ev', course: 'X' }, entries, result: { eventId: 'ev', verifyHash: 'h', finishers } });
{
  const r = langOfRecs(raceOf(
    [{ name: 'carC', author: 'alice', program: { lang: 'c', src: 'c' } }, { name: 'carPy', author: 'alice', program: { lang: 'py', src: 'p' } }],
    [{ rank: 1, name: 'carPy', author: 'alice', totalTimeMs: 1000 }, { rank: 2, name: 'carC', author: 'alice', totalTimeMs: 2000 }]));
  ok(r.carPy === 'py', `D-1 同じ作者 alice の py エントリーの記録 carPy → lang py（実 ${r.carPy}）`);
  ok(r.carC === 'c', `D-1 同じ作者 alice の C エントリーの記録 carC → lang c（実 ${r.carC}）`);
}
{  // 既存の引き方（是正前も緑）: 作者違い・名前の無い記録・作者の無い記録・改名（記録の名前と entries の名前が違う）・補充車
  const r = langOfRecs(raceOf(
    [{ name: 'b1', author: 'bob', program: { lang: 'c' } }, { name: 'c1', author: 'carol', program: { lang: 'py' } },
     { name: 'anon', author: '', program: { lang: 'js' } }, { name: 'old', author: 'dave', program: { lang: 'py' } }],
    [{ rank: 1, name: 'b1', author: 'bob' }, { rank: 2, name: 'c1', author: 'carol' }, { rank: 3, name: 'anon', author: '' },
     { rank: 4, name: 'renamed', author: 'dave' }, { rank: 5, name: 'BOT-1', author: '(filler)' }]));
  ok(J(r) === J({ b1: 'c', c1: 'py', anon: 'js', renamed: 'py', 'BOT-1': null }),
     `D-2 作者違い・作者の無い記録（名前で引く）・改名（作者で引く）・補充車（null）は従来どおり（実 ${J(r)}）`);
}
{  // 同じ作者で名前の一致が無い記録は作者の 1 件目（従来どおり）。名前が同じで作者が違うエントリーは引かない。
  const r = langOfRecs(raceOf(
    [{ name: 'same', author: 'erin', program: { lang: 'js' } }, { name: 'e1', author: 'frank', program: { lang: 'c' } },
     { name: 'same', author: 'frank', program: { lang: 'py' } }],
    [{ rank: 1, name: 'same', author: 'frank' }, { rank: 2, name: 'zzz', author: 'frank' }]));
  ok(r.same === 'py' && r.zzz === 'c', `D-2b 名前が同じでも作者の違うエントリーは引かない・名前の一致が無ければ作者の 1 件目（実 ${J(r)}）`);
}

// ── E/F の治具: race_ui.js を本番のまま import し、上流（loader.js の一覧・大会の取得）と runRace の呼び出しだけを差し替える ──
// race_ui.js が import する './race_engine.js'・'./loader.js' だけを、本物を再輸出して 1 関数だけ包む module に解決する
// （module.registerHooks。ほかのモジュールは本物の race_engine.js / loader.js と同じ実体を使う）。runRace は本物を呼び、
// 受け取った spec と結果を記録する（＝呼び出しの捕捉。結果は product のまま）。DOM は $ の mock（innerHTML を読むだけ）。
const { registerHooks } = await import('node:module');
const BL3 = (globalThis.__BL3 = { calls: [], list: [], races: {} });
const UI_URL = pathToFileURL(join(JS, 'race_ui.js')).href;
const ENGINE_URL = pathToFileURL(join(JS, 'race_engine.js')).href;
const LOADER_URL = pathToFileURL(join(JS, 'loader.js')).href;
const SPY_SRC = {
  'bl3-spy:engine': `import * as real from ${J(ENGINE_URL)};\nexport * from ${J(ENGINE_URL)};\n` +
    'export function runRace(spec) { const c = { spec }; globalThis.__BL3.calls.push(c); c.res = real.runRace(spec); return c.res; }\n',
  'bl3-spy:loader': `export * from ${J(LOADER_URL)};\n` +
    'export async function listOfficialRacesState() { return { list: globalThis.__BL3.list.map((id) => ({ id })), state: "ok" }; }\n' +
    'export async function listOfficialRaces() { return globalThis.__BL3.list.map((id) => ({ id })); }\n' +
    'export async function fetchRace(id) { const r = globalThis.__BL3.races[id]; if (!r) throw new Error("no race " + id); return r(); }\n',
};
registerHooks({
  resolve(spec, ctx, next) {
    if (ctx.parentURL === UI_URL && spec === './race_engine.js') return { url: 'bl3-spy:engine', shortCircuit: true };
    if (ctx.parentURL === UI_URL && spec === './loader.js') return { url: 'bl3-spy:loader', shortCircuit: true };
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (SPY_SRC[url]) return { format: 'module', source: SPY_SRC[url], shortCircuit: true };
    return next(url, ctx);
  },
});
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => {};
const ctx2d = new Proxy({}, { get(t, k) {
  if (k === 'measureText') return (x) => ({ width: String(x).length * 7 });
  if (k in t) return t[k];
  return () => ({ addColorStop() {} });
}, set(t, k, v) { t[k] = v; return true; } });
const ELS = new Map();
function el(id) {
  if (!ELS.has(id)) {
    ELS.set(id, {
      id, innerHTML: '', textContent: '', value: '', hidden: false, open: false, disabled: false, checked: false,
      width: 300, height: 200, clientWidth: 300, clientHeight: 200, style: {}, dataset: {}, _l: {},
      addEventListener(type, fn) { (this._l[type] ||= []).push(fn); }, removeEventListener() {},
      fire(type, ev = {}) { for (const fn of this._l[type] || []) fn(ev); },
      showModal() { this.open = true; }, show() { this.open = true; }, close() { this.open = false; this.fire('close'); },
      querySelector() { return null; }, querySelectorAll() { return []; },
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute() {}, getAttribute() { return null; }, appendChild() {}, focus() {}, scrollIntoView() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200 }; },
      getContext() { return ctx2d; },
    });
  }
  return ELS.get(id);
}
// escapeHtml は product（BL4 以降は escape.js を import・それより前の木は main.js の本文を評価＝loadEscape）を依存注入する。
const escH = ESC;
const unescH = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const { buildFromSpec } = await import(pathToFileURL(join(JS, 'course.js')).href);
const { PROGRAM_BY_KEY } = await import(pathToFileURL(join(JS, 'programs.js')).href);
const engine = await import(ENGINE_URL);
const raceEvent = await import(pathToFileURL(join(JS, 'race_event.js')).href);
const i18n = await import(pathToFileURL(join(JS, 'i18n.js')).href);
const COURSE_SPECS = JSON.parse(readFileSync(join(ROOT, 'public/data/courses.json'), 'utf8'));
const OVAL = buildFromSpec(COURSE_SPECS.find((x) => x.name === 'オーバル'));
const logs = [];
// 車種の表示名の依存注入。C〜F 章は従来どおり key の文字列、G 章は main.js の entryCarLabel（product の本文）に差し替える。
let ECL = (k) => String(k || '');
let CTL = (k) => String(k);   // G-6 は main.js の carTypeLabel（product の本文）に差し替える
const ui = (await import(UI_URL)).initRaceUI({
  $: el, escapeHtml: escH, logLine: (x) => logs.push(String(x)),
  activeSlot: () => ({ name: 'ME', lang: 'c', src: PROGRAM_BY_KEY.normal_fr.code, carType: 'normal_fr' }),
  exitEdit() {}, courseDisplayName: (c) => (c && typeof c === 'object' ? c.name : String(c || '')),
  carTypeLabel: (k) => CTL(k), entryCarLabel: (k, d) => ECL(k, d), setActiveProgram() {}, playCountdown() {},
  resolveRaceCourse: (ref) => (ref === 'オーバル' ? OVAL : null), submitToGithub() {}, raceCourseUnit: undefined,
});
const SRC_C = PROGRAM_BY_KEY.normal_fr.code, SRC_PY = PROGRAM_BY_KEY.py_normal_fr.code;
const ent = (name, author, lang, extra = {}) => ({ name, author, program: { lang, src: lang === 'py' ? SRC_PY : SRC_C },
  carType: 'normal_fr', submittedAt: '2026-01-01T00:00:0' + (extra.k || 0) + 'Z', ...extra });
// 大会を 1 つ置き、🏆 で選んで（本番の selectOfficialRace → renderOfficialDetail）「再実行検証」を押す（ofVerify の click）。
async function openRace(id, make) {
  BL3.races[id] = () => JSON.parse(JSON.stringify(make()));
  await ui.selectOfficialRace(id);
  return el('ofDetail').innerHTML;
}
async function clickVerify(id, make) {
  el('ofVerify')._l = {}; el('ofVerifyNote').innerHTML = '';
  await openRace(id, make);
  BL3.calls.length = 0;
  let thrown = null;
  try { el('ofVerify').fire('click'); } catch (e) { thrown = e; }
  return { thrown, note: el('ofVerifyNote').innerHTML, calls: [...BL3.calls] };
}

// D-3: 📖 ショーケース（締切後の優勝エントリーの intro）— 是正前は作者の 1 件目の intro を出した
console.log('\nD-3/D-4) race_ui.js の名前引き（📖 ショーケースの intro・👻 のエントリー）');
const TWO = () => ({
  event: { id: 'bl3-two', course: 'オーバル', laps: 1, class: 'open' },
  entries: [ent('carC', 'alice', 'c', { intro: 'INTRO-OF-C', k: 0 }), ent('carPy', 'alice', 'py', { intro: 'INTRO-OF-PY', k: 1 })],
  result: { eventId: 'bl3-two', verifyHash: 'h-two', course: 'オーバル', class: 'open',
    finishers: [{ rank: 1, name: 'carPy', author: 'alice', carType: 'normal_fr', totalTimeMs: 1000 },
                { rank: 2, name: 'carC', author: 'alice', carType: 'normal_fr', totalTimeMs: 2000 }] },
});
{
  // 締切後はプログラム公開欄が全エントリーの intro を出すので、📖 ショーケースの区画（official-showcase〜再実行ボタン）だけを見る。
  const html = await openRace('bl3-two', TWO);
  const a = html.indexOf('class="official-showcase"'), sc = a >= 0 ? html.slice(a, html.indexOf('id="ofVerify"', a)) : '';
  ok(sc.includes('INTRO-OF-PY') && !sc.includes('INTRO-OF-C'),
     `D-3 📖 ショーケースは優勝 carPy（alice の 2 件目）の intro を出す（区画 ${sc.length} 字・INTRO-OF-PY ${sc.includes('INTRO-OF-PY')}・INTRO-OF-C ${sc.includes('INTRO-OF-C')}）`);
}

// ── E) BL3 ③ 再実行検証（verifyOfficialLocally）の frozenField を try の中へ ──────────────
console.log('\nE) 再実行検証の読めないエントリー（race_ui.js verifyOfficialLocally）— 是正前: frozenField が try の外で TypeError が漏れる');
const BAD_KEY = () => ({
  event: { id: 'bl3-badkey', course: 'オーバル', laps: 1, class: 'budget', budget: { total: 100 } },
  entries: [ent('x', 'a', 'c', { carDef: { key: { toString: 1 } }, k: 0 }), ent('y', 'b', 'c', { k: 1 })],
  result: null,
});
const wantKey = 'official.verify.badEntry';
for (const lang of ['ja', 'en']) {
  i18n.setLang(lang);
  const pre = i18n.t(wantKey, { e: '\u0001' }).split('\u0001')[0];
  for (const [label, id, make] of [['carDef.key が {toString:1}（budget クラス）', 'bl3-badkey', BAD_KEY]]) {
    const r = await clickVerify(id, make);
    ok(r.thrown === null, `E [${lang}] ${label}: 例外が漏れない（実 ${r.thrown ? r.thrown.constructor.name + ': ' + r.thrown.message : 'なし'}）`);
    ok(i18n.hasKey(wantKey) && pre.length > 0 && r.note.includes(escH(pre)) && r.calls.length === 0,
       `E [${lang}] ${label}: 利用者向けの失敗文言（${wantKey}）を出し、再走しない（文言 ${r.note.includes(escH(pre))}・runRace ${r.calls.length} 回・実「${r.note.replace(/<[^>]+>/g, '').slice(0, 70)}」）`);
  }
}
i18n.setLang('ja');
{  // 参考（合否に数えない）: name が object のエントリーは、BL4 より前は再実行検証より前に 🏆 の詳細の描画（renderOfficialDetail の
   // escapeHtml(e.name)＝main.js の String(s)）で止まり、ボタンまで届かなかった（決定ログ BL-3 → BL4 で是正・合否は G-3 が測る）。
  let th = null;
  try { await openRace('bl3-badname', () => ({ event: { id: 'bl3-badname', course: 'オーバル', laps: 1, class: 'open' },
    entries: [ent({ toString: 1 }, '', 'c', { k: 0 }), ent('y', 'b', 'c', { k: 1 })], result: null })); } catch (e) { th = e; }
  console.log(`  参考: name が {toString:1} の大会を 🏆 で選ぶ → ${th ? `詳細の描画で ${th.constructor.name}（${th.message}）＝再実行検証に届かない` : '詳細を描けた'}`);
}
{  // 正常な event: 生成側（wf_official_result.mjs runOfficial と同じ: frozenField → resolveEventSpec → runRace）と同じ verifyHash
  const NORMAL = () => ({
    event: { id: 'bl3-normal', course: 'オーバル', laps: 1, class: 'open', physicsMode: 'v2' },
    entries: [ent('n1', 'alice', 'c', { k: 0 }), ent('n2', 'alice', 'py', { k: 1 }), ent('n3', 'bob', 'c', { k: 2 })],
    result: null,
  });
  const nr = NORMAL();
  const es = raceEvent.resolveEventSpec(nr.event, OVAL);
  const direct = engine.runRace({ course: OVAL, regime: es.regime, laps: es.laps, field: raceEvent.frozenField(nr.event, nr.entries),
    crashRule: es.crashRule, interact: es.interact, maxSec: es.maxSec, physics: es.physics, recon: es.recon, wear: es.wear, report: true, ghost: true });
  const r = await clickVerify('bl3-normal', () => ({ ...NORMAL(), result: { eventId: 'bl3-normal', verifyHash: direct.verifyHash, finishers: [] } }));
  const got = r.calls[0] && r.calls[0].res ? r.calls[0].res.verifyHash : null;
  console.log(`  正常な event の verifyHash: 生成側 ${direct.verifyHash}・再実行検証 ${got}`);
  ok(r.thrown === null && r.calls.length === 1 && got === direct.verifyHash && r.note.includes(escH(i18n.t('official.verify.match', { hash: direct.verifyHash }))),
     `E 正常な event は生成側と同じ verifyHash で「一致」と出す（${got} / ${direct.verifyHash}）`);
}

// ── F) BL3 ④ 👻 あなた vs 世界ベスト（ghostVsWorld）の runRace に physics/recon/wear ────────────
// 🏅 の集計（本番の loadAllOfficialData → renderRankings）が描いた 👻 ボタンの data-cls/data-course で ghostVsWorld を呼ぶ
// （main.js の click 委譲と同じ引数）。runRace の呼び出しを捕捉し、spec の physics/recon/wear が resolveEventSpec と一致するか。
console.log('\nF) 👻 ゴースト対戦の再走条件（race_ui.js ghostVsWorld）— 是正前: physics/recon/wear を渡さない');
{
  const GH = () => {
    const r = TWO();
    r.event = { id: 'bl3-ghost', course: 'オーバル', laps: 1, class: 'open', physicsMode: 'v2', recon: 1, wear: true };
    r.result = { ...r.result, eventId: 'bl3-ghost', verifyHash: 'h-ghost' };
    return r;
  };
  BL3.list = ['bl3-ghost']; BL3.races['bl3-ghost'] = () => JSON.parse(JSON.stringify(GH()));
  await ui.loadAllOfficialData(true);
  ui.renderRankings();
  const html = el('rankBody').innerHTML;
  const m = /class="rank-vsworld" data-cls="([^"]*)" data-course="([^"]*)"/.exec(html);
  ok(!!m, `🏅 の集計に 👻 ボタンがある（${m ? `data-cls=${unescH(m[1])}・data-course=${unescH(m[2])}` : '無し'}）`);
  BL3.calls.length = 0; logs.length = 0;
  let thrown = null;
  if (m) { try { ui.ghostVsWorld(unescH(m[1]), unescH(m[2])); } catch (e) { thrown = e; } }
  const c = BL3.calls[0];
  const es = raceEvent.resolveEventSpec(GH().event, OVAL);
  ok(thrown === null && BL3.calls.length === 1, `ghostVsWorld が runRace を 1 回呼ぶ（${BL3.calls.length} 回${thrown ? '・例外 ' + thrown.message : ''}${logs.length ? '・ログ ' + logs.join(' / ') : ''}）`);
  const sp = c ? c.spec : {};
  for (const k of ['physics', 'recon', 'wear']) {
    ok(c && k in sp && J(sp[k]) === J(es[k]), `F ${k}: spec ${c && k in sp ? J(sp[k]) : '（渡していない）'}・resolveEventSpec ${J(es[k])}`);
  }
  for (const k of ['regime', 'laps', 'crashRule', 'maxSec']) ok(c && J(sp[k]) === J(es[k]), `F ${k} は従来どおり resolveEventSpec の値（${c ? J(sp[k]) : '-'}）`);
  ok(c && sp.interact === false && sp.ghost === true, 'F interact=false・ghost=true（ゴースト対戦の条件は従来どおり）');
  // D-4: 世界ベスト carPy（alice の 2 件目）のプログラムで走る（是正前は alice の 1 件目＝C）
  const w = c && Array.isArray(sp.field) ? sp.field[1] : null;
  ok(!!w && w.lang === 'py' && w.src === SRC_PY, `D-4 👻 の相手は世界ベスト carPy のエントリー（lang ${w ? w.lang : '-'}・src が py の本文 ${!!w && w.src === SRC_PY}）`);
}

// ── G) BL4 未エスケープの innerHTML（car_crud の車種表と編集フォーム・race_ui の順位・ペナルティ・予算）と esc の非文字列耐性 ──
// 判定の述語（PLAN BL4 の「<img・onerror= を含まず &lt;img を含む」）: エスケープした文字列は本文に "onerror=" の綴りを
// 文字として残す（&lt;img src=x onerror=…&gt; は表示される文字列）。∴ onerror= は**タグの中（属性）に無いこと**で測る:
// ① `<img` の出現 0 ② `<…>` のタグのうち onerror を含むもの 0 ③ `&lt;img` を含む。属性からの抜け出しは、該当の
// <input> タグを属性の並びとして読み、value 属性を実体参照を戻して元の文字列と比べる（抜け出すと value="" で切れる）。
const XT = '<img src=x onerror=alert(1)>';      // 本文に入る形
const XA = '"><img src=x onerror=alert(1)>';    // 属性 value="…" から抜け出す形
const tagsOf = (h) => String(h).match(/<[a-zA-Z][^>]*>/g) || [];
// タグの中の onerror 属性＝引用符で囲んだ属性値を除いた残りに onerror= がある（value="…onerror=…" の値の中の綴りは数えない）。
const onAttr = (tag) => /\bonerror\s*=/i.test(tag.replace(/"[^"]*"/g, '""'));
const inert = (h) => ({ img: (String(h).match(/<img/gi) || []).length, onTag: tagsOf(h).filter(onAttr).length,
  lt: String(h).includes('&lt;img') });
const inertOk = (r) => r.img === 0 && r.onTag === 0 && r.lt;
const attrsOf = (tag) => { const o = {}; for (const m of String(tag).matchAll(/([\w-]+)="([^"]*)"/g)) o[m[1]] = unescH(m[2]); return o; };

console.log('\nG-1) esc（escapeHtml）は文字列にできない値でも投げず文字列を返す — 是正前: String(s) が TypeError');
{
  const nullProto = Object.create(null);
  const trap = new Proxy({}, { get() { throw new Error('trap'); } });
  const CASES = [
    ['{toString:1}', { toString: 1 }, null], ['JSON の {"toString":1}', JSON.parse('{"toString":1}'), null],
    ['Object.create(null)', nullProto, null], ['Proxy（どの読み出しも投げる）', trap, null],
    ['Symbol()', Symbol(), 'Symbol()'], ["Symbol('<b>')", Symbol('<b>'), 'Symbol(&lt;b&gt;)'],
    ['null', null, 'null'], ['undefined', undefined, 'undefined'], ['数値 5', 5, '5'], ['数値 1.5', 1.5, '1.5'], ['NaN', NaN, 'NaN'],
    ['真偽 true', true, 'true'], ["{toString(){return '<b>'}}", { toString() { return '<b>'; } }, '&lt;b&gt;'],
    ['配列 [1,"<"]', [1, '<'], '1,&lt;'], ['文字列 `a&<>"\'`', 'a&<>"\'', 'a&amp;&lt;&gt;&quot;\''],
  ];
  for (const [label, v, want] of CASES) {
    let r, th = null;
    try { r = ESC(v); } catch (e) { th = e; }
    ok(th === null && typeof r === 'string' && (want === null || r === want) && !/[<>"]/.test(r),
       `esc(${label}) → ${th ? `${th.constructor.name}: ${th.message}` : J(r)}${want === null ? '（文字列を返す）' : `（期待 ${J(want)}）`}`);
  }
  // 配線: main.js は escape.js の escapeHtml を import して両モジュールへ注入し、自前の定義を持たない
  const MAINS = readFileSync(join(JS, 'main.js'), 'utf8');
  ok(/^import \{ escapeHtml \} from '\.\/escape\.js';/m.test(MAINS) && !/^function escapeHtml\(/m.test(MAINS),
     `main.js は escape.js の escapeHtml を import し、自前の定義が無い（import ${/from '\.\/escape\.js'/.test(MAINS)}・自前 ${/^function escapeHtml\(/m.test(MAINS)}）`);
  ok(/initRaceUI\(\{ \$, escapeHtml,/.test(MAINS) && /initCarCrud\(\{ \$, escapeHtml,/.test(MAINS),
     'main.js は同じ escapeHtml を initRaceUI・initCarCrud に注入する');
}

console.log('\nG-2) race_ui.js 🏆 の詳細（順位・ペナルティ）と再実行検証の結果（予算）— 是正前: f.rank・f.penaltiesSec・budget が生のまま');
{
  const RX = () => ({
    event: { id: 'bl4-x', title: 'T', course: 'オーバル', laps: 1, class: 'budget', budget: { total: XT } },
    entries: [ent('e1', 'a1', 'c', { k: 0 }), ent('e2', 'b2', 'c', { k: 1 })],
    result: { eventId: 'bl4-x', verifyHash: 'h', finishers: [
      { rank: XT, name: 'e1', author: 'a1', carType: 'normal_fr', totalTimeMs: 1000, bestLapMs: 1000, penaltiesSec: XT },
      { rank: XA, name: 'e2', author: 'b2', carType: 'normal_fr', totalTimeMs: 2000, bestLapMs: 1000, penaltiesSec: XA }] },
  });
  let th = null, d = '';
  try { d = await openRace('bl4-x', RX); } catch (e) { th = e; }
  const r1 = inert(d);
  ok(th === null && inertOk(r1), `ofDetail（順位・ペナルティ）: <img ${r1.img}・onerror を持つタグ ${r1.onTag}・&lt;img ${r1.lt}${th ? '・例外 ' + th.message : ''}`);
  const rows = [...d.matchAll(/<tr><td>([^<]*)<\/td><td>e[12]<\/td>[^]*?<td>([^<]*)<\/td><\/tr>/g)].map((m) => [unescH(m[1]), unescH(m[2])]);
  ok(J(rows) === J([[XT, '+' + XT + 's'], [XA, '+' + XA + 's']]), `順位・ペナルティのセルは文字列のまま見える（実 ${J(rows)}）`);
  // 予算は本文に入る形（XT）と属性から抜け出す形（XA）の両方を与える（層4 往復 1 の F5）
  for (const [lb, X] of [['XT', XT], ['XA', XA]]) {
    const RB = () => { const r = RX(); r.event.budget.total = X; return r; };
    const v = await clickVerify('bl4-x', RB);
    const m = el('raceMeta').innerHTML;
    const r2 = inert(m);
    ok(v.thrown === null && v.calls.length === 1 && inertOk(r2), `raceMeta（予算 ${lb}）: <img ${r2.img}・onerror を持つタグ ${r2.onTag}・&lt;img ${r2.lt}（runRace ${v.calls.length} 回${v.thrown ? '・例外 ' + v.thrown.message : ''}）`);
    const bud = /<tr><th>([^<]*)<\/th><td>([^<]*&lt;img[^<]*)<\/td><\/tr>/.exec(m);
    ok(!!bud && unescH(bud[2]) === X && bud[1] === escH(i18n.t('event.meta.budget')), `予算の行（${lb}）は文字列のまま見える（${bud ? `${bud[1]} = ${J(unescH(bud[2]))}` : '無し'}）`);
  }
}

console.log('\nG-3) 🏆 の詳細は名前・車種 key が文字列にできないエントリーでも描ける（BL-3 の申し送り）— 是正前: esc(e.name)・entryCarLabel が TypeError');
{
  // entryCarLabel は main.js の本文（DOM を前提にする main.js は import できない）を取り出し、本物の CAR_TYPE_BY_KEY で評価する。
  const MAINS = readFileSync(join(JS, 'main.js'), 'utf8');
  const a = MAINS.indexOf('function entryCarLabel('), b = MAINS.indexOf('\n}\n', a);
  ok(a >= 0 && b > a, 'main.js に entryCarLabel の本文がある');
  const cfg = await import(pathToFileURL(join(JS, 'config.js')).href);
  const prodECL = new Function('CAR_TYPE_BY_KEY', 'carTypeLabel', `${MAINS.slice(a, b + 2)}\nreturn entryCarLabel;`)(cfg.CAR_TYPE_BY_KEY, (k) => 'LABEL:' + String(k));
  const BAD = { toString: 1 };
  {
    let th = null, r;
    try { r = prodECL(undefined, { key: BAD, name: 'NM' }); } catch (e) { th = e; }
    ok(th === null && r === 'NM', `entryCarLabel(carType 無し, carDef.key={toString:1}) は投げず carDef.name（実 ${th ? th.constructor.name + ': ' + th.message : J(r)}）`);
    let r2, th2 = null;
    try { r2 = [prodECL('normal_fr'), prodECL(undefined, { key: 'normal_ff' }), prodECL('nokey', { name: 'Mine' }), prodECL('constructor'), prodECL(undefined, undefined)]; } catch (e) { th2 = e; }
    ok(th2 === null && J(r2) === J(['LABEL:normal_fr', 'LABEL:normal_ff', 'Mine', 'constructor', '']),
       `entryCarLabel の正常値は従来どおり（実 ${th2 ? th2.message : J(r2)}）`);
  }
  ECL = prodECL;
  const BADR = () => ({
    event: { id: 'bl4-bad', course: 'オーバル', laps: 1, class: 'open' },
    entries: [ent(BAD, 'a1', 'c', { k: 0, intro: BAD }), { ...ent('y', 'b2', 'c', { k: 1 }), carType: undefined, carDef: { key: BAD, name: 'NM' } }],
    result: { eventId: 'bl4-bad', verifyHash: 'h', finishers: [
      { rank: 1, name: BAD, author: 'a1', carType: 'normal_fr', totalTimeMs: 1000, bestLapMs: 1000 },
      { rank: 2, name: 'y', author: 'b2', carDef: { key: BAD, name: 'NM' }, totalTimeMs: 2000, penaltiesSec: BAD }] },
  });
  // JSON 経由で配ると toString:1 は「文字列にできない object」のまま届く（openRace は JSON で複製する＝上流の取得と同じ形）。
  let th = null, d = '';
  try { d = await openRace('bl4-bad', BADR); } catch (e) { th = e; }
  ok(th === null && d.includes('id="ofVerify"'), `🏆 の詳細を最後（再実行検証のボタン）まで描く（${th ? `${th.constructor.name}: ${th.message}` : `${d.length} 字`}）`);
  const v = th === null ? await clickVerify('bl4-bad', BADR) : { thrown: new Error('詳細を描けない') };
  ok(v.thrown === null, `「再実行検証」も例外を漏らさない（${v.thrown ? v.thrown.message : v.note.replace(/<[^>]+>/g, '').slice(0, 60)}）`);
  // 持ち込み車種（carDef）の name が文字列にできない値: runRace は走り、結果ダイアログの車種名（race_ui.js fieldCarLabeler）で止まった
  const cfgM = await import(pathToFileURL(join(JS, 'config.js')).href);
  const CARR = () => ({
    event: { id: 'bl4-car', course: 'オーバル', laps: 1, class: 'open' },
    entries: [ent('own', 'a1', 'c', { k: 0, carType: 'bl4_car', carDef: { ...JSON.parse(JSON.stringify(cfgM.CAR_TYPE_BY_KEY.normal_fr)), key: 'bl4_car', name: BAD } }),
      ent('y', 'b2', 'c', { k: 1 })],
    result: null,
  });
  el('raceMeta').innerHTML = ''; el('raceResults').innerHTML = '';
  let vc;
  try { vc = await clickVerify('bl4-car', CARR); } catch (e) { vc = { thrown: e, calls: [] }; }   // 是正前は 🏆 の詳細（esc(carLabel)）で先に止まる
  const rr = el('raceResults').innerHTML;
  ok(vc.thrown === null && vc.calls.length === 1 && rr.includes('race-tab'),
     `持ち込み車種の name が {toString:1} でも再実行検証の結果ダイアログを描く（runRace ${vc.calls.length} 回・結果表 ${rr.includes('race-tab')}${vc.thrown ? '・例外 ' + vc.thrown.constructor.name + ': ' + vc.thrown.message : ''}）`);
  ECL = (k) => String(k || '');
}

console.log('\nG-4) 配線: car_crud.js・race_ui.js のテンプレート文字列の ${…} は esc／数値／固定の一覧のどれか（一覧に無い式は赤）');
// テンプレート文字列の ${…} を全部取り出す（文字列・コメント・正規表現・入れ子のテンプレートを読み飛ばす最小の字句解析）。
function templateSubs(src) {
  const out = [];
  let i = 0;
  const KW = /(?:^|[^\w$])(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;
  const regexAllowed = (j) => {
    let k = j - 1; while (k >= 0 && /\s/.test(src[k])) k--;
    if (k < 0) return true;
    const c = src[k];
    if ('(,=:[!&|?{};+-*%<>~^'.includes(c)) return true;
    return /[\w$]/.test(c) ? KW.test(src.slice(Math.max(0, k - 10), k + 1)) : false;
  };
  const skipString = (q) => { i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; };
  const skipRegex = () => {
    i++; let cls = false;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '[') cls = true; else if (c === ']') cls = false; else if (c === '/' && !cls) break;
      else if (c === '\n') throw new Error('正規表現の途中で改行 @' + i);
      i++;
    }
    i++; while (/[a-z]/.test(src[i] || '')) i++;
  };
  function code(inSub) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) throw new Error('コメント未終端'); i = e + 2; continue; }
      if (c === "'" || c === '"') { skipString(c); continue; }
      if (c === '`') { template(); continue; }
      if (c === '/' && regexAllowed(i)) { skipRegex(); continue; }
      if (c === '{') depth++;
      if (c === '}') { if (depth === 0 && inSub) return; depth--; }
      i++;
    }
    if (inSub) throw new Error('${ が未終端');
  }
  function template() {
    i++;
    let lit = '';   // このテンプレートの ${ より前の字面（前の ${…} は \u0001 に置く）＝G-4c が属性の引用符を読む
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { lit += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { i++; return; }
      if (c === '$' && src[i + 1] === '{') {
        const rec = { start: i + 2, before: lit }; out.push(rec); i += 2;
        code(true);
        rec.expr = src.slice(rec.start, i).trim(); i++;
        lit += '\u0001';
        continue;
      }
      lit += c;
      i++;
    }
    throw new Error('テンプレート未終端');
  }
  code(false);
  const fns = [...src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([\w$]+)\s*\(/gm)].map((m) => ({ name: m[1], at: m.index }));
  for (const r of out) {
    r.fn = '(top)';
    for (const f of fns) if (f.at < r.start) r.fn = f.name;
    r.line = src.slice(0, r.start).split('\n').length;
  }
  return out;
}
// 式全体が 1 つの呼び出し name(…) か（括弧の対応を見る・文字列の中の括弧は数えない）。
function wholeCall(expr, names) {
  const m = new RegExp(`^(?:${names})\\(`).exec(expr); if (!m) return false;
  let depth = 0, q = null;
  for (let k = m[0].length - 1; k < expr.length; k++) {
    const c = expr[k];
    if (q) { if (c === '\\') k++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return k === expr.length - 1; }
  }
  return false;
}
const autoSafe = (e) => wholeCall(e, 'esc|escapeHtml') || wholeCall(e, 'fmtTime') || /^t\('[^']*'\)$/.test(e);
// 一覧（関数 → 式 → 安全な理由）。利用者由来の値（carDef・entry・event・meta・result の欄）はここに置かない（esc で包む）。
// §5（docs/stage_bl/recheck_v10.3.0.md）の「問題なし」の箇所＝runRace・集計の数値と、エスケープ済みの断片・固定文字列。
const NUM_RACE = 'runRace の出力（race_engine が数値で作る）';
const NUM_AGG = '集計の数え上げ（race_season／race_ladder が数値で作る）';
const PIECE = 'esc 済みの断片か固定文字列だけで組んだ HTML';
const CONST = '固定文字列・定数・インデックス';
const ALLOW = {
  'car_crud.js': {
    renderCarParamTable: { c: 'cols の定数（mass 等）', badge: PIECE, ops: PIECE + '（data-key は escapeHtml）',
      "ct.drift ? `grip ${escapeHtml(ct.drift.grip)}` : '—'": '内側の ${} は escapeHtml（別の行で検査）・ほかは固定文字列',
      k: 'CAR_PARAM_DOC のキー（config.js の定数）', "t('cars.pdoc.' + k)": '自前のカタログ（i18n）の文言' },
    renderCustomCarList: { k: 'const k = escapeHtml(def.key || \'\')（エスケープ済み）' },
    uniqueCarKey: { base: 'HTML ではない（key の文字列を作る）', n: 'HTML ではない（数）' },
    carNumRow: { tip: 'escapeHtml 済み', p: 'CAR_NUM_PARAMS／DRIFT_NUM_PARAMS の定数', numId: "'cf_num_' + 定数",
      min: CONST, max: CONST, step: CONST },
    renderCarForm: { ro: CONST, "on ? ' checked' : ''": CONST, "d.drift.trigger === 'power' ? ' selected' : ''": CONST,
      "d.drift.trigger === 'liftoff' ? ' selected' : ''": CONST, "d.drift.brakeDrift ? ' checked' : ''": CONST },
  },
  'race_ui.js': {
    renderRaceResult: { v: 'metaRows の値（G-4b で全部 esc を確認）', rec: PIECE, recordHtml: PIECE, 'rowCls.trim()': CONST,
      'f.rank': NUM_RACE, 'colorOf(f.idx)': 'FLEET.colors（config.js の定数）', 'colorOf(d.idx)': 'FLEET.colors', 'colorOf(r.idx)': 'FLEET.colors',
      "f.bestLapMs != null ? fmtTime(f.bestLapMs / 1000) : '—'": 'fmtTime（数でなければ --:--.--）',
      "f.penaltiesSec ? '+' + f.penaltiesSec + 's' : '—'": NUM_RACE + '（crashCount×penaltySec）', 'd.lapsCompleted': NUM_RACE,
      "r.muPeakPct != null ? r.muPeakPct + '%' : '—'": NUM_RACE, "r.betaPeakDeg != null ? r.betaPeakDeg + '°' : '—'": NUM_RACE,
      crashCell: NUM_RACE + '＋esc 済みの内訳' },
    renderOfficialDetail: { v: 'metaRows の値（G-4b で全部 esc を確認）',
      "f.totalTimeMs != null ? fmtTime(asNum(f.totalTimeMs) / 1000) : '—'": 'fmtTime（数でなければ --:--.--・割り算の前に asNum＝G-6）',
      "f.bestLapMs != null ? fmtTime(asNum(f.bestLapMs) / 1000) : '—'": 'fmtTime（数でなければ --:--.--・割り算の前に asNum＝G-6）',
      "f.penaltiesSec ? '+' + esc(f.penaltiesSec) + 's' : '—'": 'esc 済み（result.json の値）' },
    officialProgPanels: { i: 'forEach のインデックス' },
    toggleProgSrc: { i: 'HTML ではない（querySelector の数）' },
    renderRankings: { "i === 0 && r.points > 0 ? ' class=\"rank-record\"' : ''": CONST, 'i + 1': CONST, meMark: PIECE,
      'r.points': NUM_AGG + '（pointsFor の +t[i]）', 'r.wins': NUM_AGG, 'r.podiums': NUM_AGG, 'r.finishes': NUM_AGG, 'r.dnfs': NUM_AGG,
      'r.starts': NUM_AGG, 'x.n': NUM_AGG, "i === 0 ? ' class=\"rank-record\"' : ''": CONST, medal: CONST, crown: PIECE,
      "r.bestLapMs != null ? fmtTime(asNum(r.bestLapMs) / 1000) : '—'": 'fmtTime（割り算の前に asNum＝G-6）', 'p.entries': NUM_AGG, 'p.authors': NUM_AGG, 'p.wins': NUM_AGG,
      "p.bestMs != null ? fmtTime(asNum(p.bestMs) / 1000) : '—'": 'fmtTime（割り算の前に asNum＝G-6）', "d.author === me ? ' class=\"rank-record\"' : ''": CONST,
      'd.recordsHeld': NUM_AGG, 'd.wins': NUM_AGG, 'd.podiums': NUM_AGG, 'd.events': NUM_AGG, titles: PIECE },
    renderGhostStandings: { "passing ? ' passing' : ''": CONST, 'r.rank': 'ghost_gap の順位（数値）', 'a.colorOf(r.ci)': 'FLEET.colors',
      "passing ? ' <span class=\"ghost-st-up\">▲</span>' : ''": CONST, rowsHtml: PIECE },
    openGhostReplay: { 'colorOf(i)': 'FLEET.colors' },
    renderGhostSectors: { 'FLEET.colors[c.ci % FLEET.colors.length]': 'FLEET.colors', "isBest ? 'sect-best' : ''": CONST,
      "isBest ? ' ●' : ''": CONST, 'c.laps.length': '件数' },
  },
};
for (const file of ['car_crud.js', 'race_ui.js']) {
  const src = readFileSync(join(JS, file), 'utf8');
  let subs;
  try { subs = templateSubs(src); } catch (e) { ok(false, `${file}: 字句解析が通らない（${e.message}）`); continue; }
  const allow = ALLOW[file];
  const used = new Set();
  const bad = [];
  let auto = 0;
  for (const r of subs) {
    if (autoSafe(r.expr)) { auto++; continue; }
    const why = allow[r.fn] && Object.prototype.hasOwnProperty.call(allow[r.fn], r.expr) ? allow[r.fn][r.expr] : null;
    if (why) used.add(r.fn + '\u0000' + r.expr); else bad.push(`${file}:${r.line} ${r.fn} \${${r.expr}}`);
  }
  const stale = Object.entries(allow).flatMap(([fn, o]) => Object.keys(o).filter((e) => !used.has(fn + '\u0000' + e)).map((e) => `${fn} \${${e}}`));
  console.log(`  ${file}: \${…} ${subs.length} 個（esc／fmtTime／t('…') ${auto}・一覧 ${subs.length - auto - bad.length}・一覧に無い ${bad.length}）`);
  ok(bad.length === 0, `${file}: 一覧に無い \${…} が 0 個（実 ${bad.length}${bad.length ? ': ' + bad.join(' / ') : ''}）`);
  ok(stale.length === 0, `${file}: 一覧の式がすべてソースにある（古い行 ${stale.length}${stale.length ? ': ' + stale.join(' / ') : ''}）`);
}
// G-4c（層4 往復 1 の F2）: 属性の値に入る ${…} は " で囲む（escape.js は ' をエスケープしない＝' 囲み・引用符なしの属性に
//   入れると esc を通しても抜け出せる）。テンプレートの字面で ${ の直前がタグの中（最後の < が最後の > より後）なら、
//   直前の `=` からの字面を読み、`="…` の中なら可・`='…` の中と `=` の直後（引用符なし）は赤。
console.log('\nG-4c) 配線: car_crud.js・race_ui.js のテンプレート文字列で属性の値に入る ${…} は " で囲む（\' 囲み・引用符なしは赤）');
const attrCtx = (before) => {
  const lt = before.lastIndexOf('<'), gt = before.lastIndexOf('>');
  if (lt < 0 || lt < gt) return 'text';
  const tag = before.slice(lt);
  if (/=\s*"[^"]*$/.test(tag)) return 'dq';
  if (/=\s*'[^']*$/.test(tag)) return 'sq';
  if (/=\s*$/.test(tag)) return 'bare';
  return 'tag';   // タグの中だが属性の値ではない（例: <tr${cls}>）
};
{
  // 判定の自己検査（検査が「' 囲みを赤にする」ことを、合成したソースで確かめる）
  const synth = "function f(x) { return `<b title='${esc(x)}'>a</b><i title=${esc(x)}>b</i><u title=\"${esc(x)}\">c</u><s data-i=\"${x} ${esc(x)}\">d</s><p>${esc(x)}</p>`; }";
  const got = templateSubs(synth).map((r) => attrCtx(r.before));
  ok(J(got) === J(['sq', 'bare', 'dq', 'dq', 'dq', 'text']), `判定の自己検査: ' 囲み・引用符なし・" 囲み×3・本文 → ${J(got)}`);
  for (const file of ['car_crud.js', 'race_ui.js']) {
    const subs = templateSubs(readFileSync(join(JS, file), 'utf8'));
    const tally = { text: 0, tag: 0, dq: 0, sq: 0, bare: 0 };
    const bad = [];
    for (const r of subs) { const c = attrCtx(r.before); tally[c]++; if (c === 'sq' || c === 'bare') bad.push(`${file}:${r.line} ${r.fn} \${${r.expr}}（${c}）`); }
    console.log(`  ${file}: 本文 ${tally.text}・属性の値（" 囲み）${tally.dq}・タグの中（値でない）${tally.tag}・' 囲み ${tally.sq}・引用符なし ${tally.bare}`);
    ok(bad.length === 0 && tally.dq > 0, `${file}: 属性の値の \${…} は全部 " 囲み（' 囲み・引用符なし ${bad.length}${bad.length ? ': ' + bad.join(' / ') : ''}）`);
  }
}

console.log('\nG-4b) 配線: race_ui.js の metaRows（renderRaceResult・renderOfficialDetail の表の値）は全部 esc');
{
  const src = readFileSync(join(JS, 'race_ui.js'), 'utf8');
  const vals = [];
  for (const m of src.matchAll(/metaRows(?: = \[|\.push\()/g)) {
    // 対応する ] / ) までを取り、その中の [k, v] の v を読む
    let k = m.index + m[0].length, depth = 1, q = null;
    const start = k;
    for (; k < src.length && depth > 0; k++) {
      const c = src[k];
      if (q) { if (c === '\\') k++; else if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; continue; }
      if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--;
    }
    const body = src.slice(start, k - 1);
    // 各 [t('…'), 値] の値＝`, ` の後から、対応の取れた ] までを読む（値の中の括弧・文字列は数えない）
    for (const p of body.matchAll(/\[t\('[^']+'\),\s*/g)) {
      let j = p.index + p[0].length, dep = 0, qq = null;
      for (; j < body.length; j++) {
        const c = body[j];
        if (qq) { if (c === '\\') j++; else if (c === qq) qq = null; continue; }
        if (c === "'" || c === '"' || c === '`') { qq = c; continue; }
        if ('([{'.includes(c)) dep++;
        else if (')]}'.includes(c)) { if (dep === 0) break; dep--; }
      }
      vals.push({ line: src.slice(0, start).split('\n').length, v: body.slice(p.index + p[0].length, j).trim() });
    }
  }
  const okv = (v) => wholeCall(v, 'esc') || v === "'<code>' + esc(res.verifyHash) + '</code>'";
  const badv = vals.filter((x) => !okv(x.v));
  ok(vals.length >= 17, `metaRows の値を読めた（${vals.length} 個・renderRaceResult 10＋renderOfficialDetail 7）`);
  ok(badv.length === 0, `metaRows の値は全部 esc（esc でない値 ${badv.length}${badv.length ? ': ' + badv.map((x) => x.v).join(' / ') : ''}）`);
}

console.log('\nG-5) car_crud.js 車種表と編集フォーム（自作車・投稿車種・組込の上書き）— 是正前: パラメータ値・drift.grip・value="…" が生のまま');
{
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } } });
  globalThis.confirm = () => true;
  // 経路 ①: localStorage の自作車（initCarCrud が起動時に registerCarType）② 組込の上書き（applyCarOverride）③ 投稿車種（registerCarType）
  store.set('rumicar.customCars', JSON.stringify([{ key: 'bl4_evil', name: 'BL4 evil', mass: XA, accel: XT, drift: { grip: XT, trigger: 'power' } }]));
  store.set('rumicar.carOverrides', JSON.stringify({ normal_fr: { mass: XA } }));
  const cfg = await import(pathToFileURL(join(JS, 'config.js')).href);
  const shippedMass = cfg.CAR_TYPE_BY_KEY.normal_fr.mass;
  const { initCarCrud } = await import(pathToFileURL(join(JS, 'car_crud.js')).href);
  const CC = initCarCrud({ $: el, escapeHtml: ESC, carTypeName: (ct) => String(ct.name), logLine() {}, buildFleetColumns() {}, pruneSlotCarTypes() {}, submitToGithub() {} });
  const comm = cfg.registerCarType({ key: 'bl4_comm', name: 'BL4 comm', brake: XT, drift: { grip: XA } });
  comm.community = true;
  CC.renderCarParamTable();
  const h = el('carParamTable').innerHTML;
  const rowOf = (name) => (h.split('<tr>').find((r) => r.includes(name)) || '');
  const cells = (row) => [...row.matchAll(/<td[^>]*>([^]*?)<\/td>/g)].map((m) => unescH(m[1].replace(/<[^>]+>/g, '')));
  for (const [label, name, want] of [
    ['自作車（localStorage）', 'BL4 evil', { 1: XA, 2: XT, 10: 'grip ' + XT }],
    ['投稿車種（registerCarType）', 'BL4 comm', { 3: XT, 10: 'grip ' + XA }],
    ['組込の上書き（applyCarOverride）', '<td class="pname">ノーマル', { 1: XA }],
  ]) {
    const row = name.startsWith('<') ? (h.split('<tr>').find((r) => r.includes(name) && r.includes('car-ovr-reset')) || '') : rowOf(name);
    const r = inert(row), c = cells(row);
    const seen = Object.entries(want).every(([i, v]) => c[i] === v);
    ok(row.length > 0 && inertOk(r) && seen, `車種表 ${label}: <img ${r.img}・onerror を持つタグ ${r.onTag}・&lt;img ${r.lt}・値は文字列のまま ${seen}（${J(Object.keys(want).map((i) => c[i]))}）`);
  }
  // 編集フォーム: 自作車の一覧の「編集」（customCarList の click 委譲）・組込の「編集」（carParamTable の click 委譲）・JSON → フォーム
  const clickOn = (id, cls, key) => el(id).fire('click', { target: { closest: () => ({ dataset: { key }, classList: { contains: (c) => c === cls } }) } });
  const formCases = [
    ['自作車の「編集」', () => clickOn('customCarList', 'carlist-edit', 'bl4_evil'), { mass: XA, accel: XT, grip: XT }],
    ['組込の上書きの「編集」', () => clickOn('carParamTable', 'car-ovr-edit', 'normal_fr'), { mass: XA }],
    ['JSON → フォーム', () => { el('carOvrCancelBtn').fire('click'); el('carJsonInput').value = JSON.stringify({ key: 'k', name: 'n', mass: XA, slide: XT }); el('carFormFromJson').fire('click'); }, { mass: XA, slide: XT }],
  ];
  for (const [label, act, want] of formCases) {
    let th = null;
    try { act(); } catch (e) { th = e; }
    const f = el('carForm').innerHTML;
    const r = inert(f);
    const got = {};
    for (const p of Object.keys(want)) {
      const num = tagsOf(f).find((x) => x.includes(`id="cf_num_${p}"`));
      const rng = tagsOf(f).find((x) => x.includes(`data-num="cf_num_${p}"`));
      got[p] = [num ? attrsOf(num).value : null, rng ? attrsOf(rng).value : null];
    }
    const same = Object.entries(want).every(([p, v]) => got[p][0] === v && got[p][1] === v);
    ok(th === null && inertOk(r) && same, `編集フォーム ${label}: <img ${r.img}・onerror を持つタグ ${r.onTag}・&lt;img ${r.lt}・value 属性は元の文字列のまま ${same}${th ? '・例外 ' + th.message : ''}`);
  }
  // 正常値: 出荷車種の行の textContent は是正前の書き方（`${ct[c] != null ? ct[c] : '-'}`・`grip ${ct.drift.grip}`）と同じ
  el('carOvrCancelBtn').fire('click');
  el('carOvrBar').fire('click', { target: { closest: () => ({ dataset: {}, classList: { contains: (c) => c === 'car-ovr-clearall' } }) } });
  ok(cfg.CAR_TYPE_BY_KEY.normal_fr.mass === shippedMass, `組込の上書きを全解除して出荷値へ戻った（normal_fr.mass ${cfg.CAR_TYPE_BY_KEY.normal_fr.mass}）`);
  CC.renderCarParamTable();
  const h2 = el('carParamTable').innerHTML;
  const cols = ['mass', 'accel', 'brake', 'maxSpeed', 'spin', 'us', 'os', 'powerUs', 'powerOs'];
  const builtin = cfg.CAR_TYPES.filter((ct) => !ct.custom && !ct.community);
  let same = 0; const diff = [];
  for (const ct of builtin) {
    const row = h2.split('<tr>').find((r) => r.includes(`data-key="${escH(ct.key)}"`)) || '';
    const got = cells(row).slice(1, 11);
    const want = cols.map((c) => String(ct[c] != null ? ct[c] : '-')).concat([ct.drift ? `grip ${ct.drift.grip}` : '—']);
    if (J(got) === J(want)) same++; else diff.push(`${ct.key}: ${J(got)} / ${J(want)}`);
  }
  ok(builtin.length === 6 && same === 6, `出荷車種 6 種の行の表示は是正前の書き方と同一（${same}/${builtin.length}${diff.length ? '・' + diff.join(' ; ') : ''}）`);
  cfg.unregisterCarType('bl4_evil'); cfg.unregisterCarType('bl4_comm');
}

console.log('\nG-6) 層4 往復 1（F1／F3／F4）: 文字列にできない値の同族 — t() の差し込み・🏆 詳細／🍴／再実行検証／🏅／打破通知／👻 を値の欄ごとに・車種名');
// 是正前（8a4bd2e）: i18n.js t() の `s.split('{k}').join(vars[k])` は join が値を文字列にするところで TypeError を投げ、
// t() を esc の前に呼ぶ全部の経路（race_ui の勝者・最速ラップ・公式結果の 1 行・旧版の注記 等）が止まった。
// 設計: 差し込みの 1 か所（i18n.js t()）で守る。join が投げたときだけ String(v)（Symbol は "Symbol()"）、それも投げれば '?'
// （escape.js と同じ規則）。投げない値は従来の join と 1 文字も変わらない（undefined は従来どおり join の既定の ","）。
// 車種名の依存注入は main.js の product の本文（carTypeName・carTypeLabel・entryCarLabel）を取り出して評価する（mock だと
// mock 自身の String() が投げて product と違う答えになる）。
const MAIN6 = readFileSync(join(JS, 'main.js'), 'utf8');
const cut6 = (from, to) => { const a = MAIN6.indexOf(from); const b = MAIN6.indexOf(to, a); if (a < 0 || b < 0) throw new Error('main.js に ' + from + ' が無い'); return MAIN6.slice(a, b + to.length); };
const cfg6 = await import(pathToFileURL(join(JS, 'config.js')).href);
const L6 = new Function('CAR_TYPE_BY_KEY', 'hasKey', 't',
  `${cut6('const carTypeName = (ct) => {', '\n};')}\n${cut6('function carTypeLabel(key) {', '}\n')}\n${cut6('function entryCarLabel(', '\n}\n')}\nreturn { carTypeName, carTypeLabel, entryCarLabel };`)(cfg6.CAR_TYPE_BY_KEY, i18n.hasKey, i18n.t);
{
  const BADS = [
    ['JSON の {"toString":1}', () => JSON.parse('{"toString":1}'), '?'], ['{toString:1}', () => ({ toString: 1 }), '?'],
    ['Object.create(null)', () => Object.create(null), '?'], ['Symbol()', () => Symbol(), 'Symbol()'],
    ["Symbol('<b>')", () => Symbol('<b>'), 'Symbol(<b>)'], ['Proxy（どの読み出しも投げる）', () => new Proxy({}, { get() { throw new Error('trap'); } }), '?'],
    ['配列 [{"toString":1}]', () => JSON.parse('[{"toString":1}]'), '?'],
  ];
  const tmpl = (key) => i18n.t(key);   // 差し込み前の文言（{name} 等が残る）
  for (const key of ['race.winner', 'official.result.verified']) {
    const toks = (tmpl(key).match(/\{(\w+)\}/g) || []).map((x) => x.slice(1, -1));
    for (const [label, mk, want] of BADS) {
      const vars = Object.fromEntries(toks.map((k) => [k, mk()]));
      let r, th = null;
      try { r = i18n.t(key, vars); } catch (e) { th = e; }
      const exp = toks.reduce((s, k) => s.split('{' + k + '}').join(want), tmpl(key));
      ok(th === null && r === exp, `t('${key}', {${toks.join(',')}: ${label}}) → ${th ? th.constructor.name + ': ' + th.message : J(r)}（期待 ${J(exp)}）`);
    }
  }
  // 投げない値は是正前の式（join）と同じ文字列
  const NORMAL = [['文字列', 'x<y'], ['空文字', ''], ['数値 5', 5], ['0', 0], ['1.5', 1.5], ['NaN', NaN], ['null', null], ['undefined', undefined],
    ['true', true], ['配列 ["a","b"]', ['a', 'b']], ["{toString(){return 'z'}}", { toString() { return 'z'; } }], ['{}', {}]];
  let same = 0; const diff = [];
  for (const [label, v] of NORMAL) {
    const want = tmpl('race.winner').split('{name}').join(v);
    const got = i18n.t('race.winner', { name: v });
    if (got === want) same++; else diff.push(`${label}: ${J(got)} / ${J(want)}`);
  }
  ok(same === NORMAL.length, `t() の差し込みは投げない値で是正前の join と同一（${same}/${NORMAL.length}${diff.length ? '・' + diff.join(' ; ') : ''}）`);
  // 差し込みの実装は i18n.js の 1 か所だけ（写しがあればそこは守られない）。呼び出しの数は表に出す（全部この 1 か所を通る）。
  const interp = [];
  const { readdirSync } = await import('node:fs');
  const all = readdirSync(JS).filter((f) => f.endsWith('.js'));
  for (const f of all) {
    const s = readFileSync(join(JS, f), 'utf8');
    for (const m of s.matchAll(/split\(\s*'\{'/g)) interp.push(`${f}:${s.slice(0, m.index).split('\n').length}`);
  }
  ok(interp.length === 1 && interp[0].startsWith('i18n.js:'), `{…} の差し込みは i18n.js t() の 1 か所だけ（${interp.join(' / ')}）`);
  const counts = all.map((f) => [f, (readFileSync(join(JS, f), 'utf8').match(/\bt\(\s*(?:'[^']*'|[\w.$]+(?:\s*\+\s*[^,()]+)?)\s*,\s*\{/g) || []).length]).filter(([, n]) => n);
  console.log(`  t(…, {…}) の呼び出し（差し込みのある t・ファイル別）: ${counts.map(([f, n]) => `${f} ${n}`).join('・')}＝計 ${counts.reduce((a, [, n]) => a + n, 0)}`);
}

// G-6b: 🏆 詳細（selectOfficialRace → renderOfficialDetail）・「再実行検証」（ofVerify の click → verifyOfficialLocally →
//   renderRaceResult）・🏅 の集計（loadAllOfficialData → renderRankings）・👻（ghostVsWorld）を、大会（event／entries／result）の
//   値の欄を 1 つずつ文字列にできない値に替えて呼び、例外が利用者の操作の外へ漏れないこと（欄 × 入口の表）。
//   JSON で届く値（上流の取得は JSON）＝{"toString":1}。Object.create(null)・Symbol() は JSON から作れないが、同じ表で試す（複製しない）。
{
  ECL = L6.entryCarLabel; CTL = L6.carTypeLabel;
  const RICH = () => ({
    event: { id: 'bl4-f', title: 'T', course: 'オーバル', laps: 1, class: 'open', engineVer: 'v0.0.1', season: 'S1', points: [10, 8],
      entryWindow: { open: '2026-01-01T00:00:00Z', close: '2026-01-02T00:00:00Z' } },
    entries: [ent('e1', 'a1', 'c', { k: 0, intro: 'I1' }), ent('e2', 'b2', 'py', { k: 1 })],
    result: { eventId: 'bl4-f', verifyHash: 'h', engineVer: 'v0.0.1', exec: 'x', finishers: [
      { rank: 1, name: 'e1', author: 'a1', carType: 'normal_fr', totalTimeMs: 1000, bestLapMs: 900, penaltiesSec: 2 },
      { rank: 2, name: 'e2', author: 'b2', carType: 'normal_fr', totalTimeMs: 2000, bestLapMs: 1000, penaltiesSec: 0 }],
      dnf: [{ name: 'e3', author: 'c3', carType: 'normal_fr', lapsCompleted: 0, reason: 'crash' }] },
  });
  // 打破通知（checkBeaten・🏅 の「抜かれた記録」の行）も通す: 自分＝a1（ペナルティ 2 秒で換算 3.0 秒＞b2 の 2.0 秒＝b2 が世界ベスト）
  localStorage.setItem('rumicar.author', 'a1');
  const leaves = [];
  const walk = (o, p) => {
    for (const k of Object.keys(o)) {
      const v = o[k], q = [...p, k];
      if (k === 'src') { leaves.push(q); continue; }
      if (v && typeof v === 'object') { leaves.push(q); walk(v, q); } else leaves.push(q);
    }
  };
  walk(RICH(), []);
  const setAt = (o, p, v) => { let x = o; for (const k of p.slice(0, -1)) x = x[k]; x[p[p.length - 1]] = v; return o; };
  // 予算クラスの欄（class: 'budget' のときだけ読む）・エントリー／完走の 1 件そのものが object でない（loader.js fetchRace は
  // null 以外の JSON をそのまま entries に積む・result.json の finishers は上流の値のまま）
  const extra = [[['event', 'budget', 'total'], (r) => { r.event.class = 'budget'; r.event.budget = { total: 1e9 }; }],
    // 結果の無い大会は受付期間で状態を決める（race_ui.js raceStatus の Date.parse。結果があれば読まない）
    [['event', 'entryWindow', 'open'], (r) => { r.result = null; }], [['event', 'entryWindow', 'close'], (r) => { r.result = null; }]];
  const whole = [[['entries', 0], 5], [['entries', 1], 'x'], [['entries', 1], true], [['entries', 0], []],
    [['result', 'finishers', 0], null], [['result', 'finishers', 1], 5], [['result'], 5], [['result', 'finishers'], 'x']];
  const VALS = [['{"toString":1}', () => JSON.parse('{"toString":1}'), true], ['Object.create(null)', () => Object.create(null), false], ['Symbol()', () => Symbol(), false]];
  const rows = [];
  let cases = 0;
  BL3.list = ['bl4-f'];
  for (const [vl, mk, viaJson] of VALS) {
    for (const [p, pre] of [...leaves.map((p) => [p, null]), ...extra]) {
      cases++;
      const make = () => { const r = RICH(); if (pre) pre(r); return setAt(r, p, mk()); };
      BL3.races['bl4-f'] = viaJson ? () => JSON.parse(JSON.stringify(make())) : make;
      const st = {};
      try { await ui.selectOfficialRace('bl4-f'); st.detail = el('ofDetail').innerHTML.includes('id="ofVerify"') ? 'ok' : 'ボタン無し'; } catch (e) { st.detail = `${e.constructor.name}: ${e.message}`; }
      // 🍴 fork（締切後のプログラム公開の各エントリー・forkOfficialEntry）
      try { for (let i = 0; i < 2; i++) ui.forkOfficialEntry(i); st.fork = 'ok'; } catch (e) { st.fork = `${e.constructor.name}: ${e.message}`; }
      el('ofVerify')._l = {}; el('ofVerifyNote').innerHTML = '';
      try { await ui.selectOfficialRace('bl4-f'); el('ofVerify').fire('click'); st.verify = 'ok'; } catch (e) { st.verify = `${e.constructor.name}: ${e.message}`; }
      let rk = '';
      try { await ui.loadOfficialRaces(true); await ui.loadAllOfficialData(true); ui.renderRankings(); rk = el('rankBody').innerHTML; st.rank = rk.includes('rank-board') ? 'ok' : '表が空'; } catch (e) { st.rank = `${e.constructor.name}: ${e.message}`; }
      const m = /class="rank-vsworld" data-cls="([^"]*)" data-course="([^"]*)"/.exec(rk);
      try { ui.checkBeaten(); st.beaten = 'ok'; } catch (e) { st.beaten = `${e.constructor.name}: ${e.message}`; }
      if (m) { try { ui.ghostVsWorld(unescH(m[1]), unescH(m[2])); st.ghost = 'ok'; } catch (e) { st.ghost = `${e.constructor.name}: ${e.message}`; } } else st.ghost = '—';
      // 「表が空」は例外ではない（結果の無い・検証の無い大会は 🏅 に入らない＝正しい）。漏れは例外だけを数える。
      const bad = Object.entries(st).filter(([, v]) => v !== 'ok' && v !== '—' && v !== '表が空');
      rows.push({ v: vl, path: p.join('.'), st, bad });
    }
  }
  for (const [p, v] of whole) {
    cases++;
    const make = () => setAt(RICH(), p, v);
    BL3.races['bl4-f'] = () => JSON.parse(JSON.stringify(make()));
    const st = {};
    try { await ui.selectOfficialRace('bl4-f'); st.detail = el('ofDetail').innerHTML.includes('id="ofVerify"') ? 'ok' : 'ボタン無し'; } catch (e) { st.detail = `${e.constructor.name}: ${e.message}`; }
    el('ofVerify')._l = {}; el('ofVerifyNote').innerHTML = '';
    try { await ui.selectOfficialRace('bl4-f'); el('ofVerify').fire('click'); st.verify = 'ok'; } catch (e) { st.verify = `${e.constructor.name}: ${e.message}`; }
    try { await ui.loadOfficialRaces(true); await ui.loadAllOfficialData(true); ui.renderRankings(); st.rank = 'ok'; } catch (e) { st.rank = `${e.constructor.name}: ${e.message}`; }
    rows.push({ v: J(v), path: p.join('.'), st, bad: Object.entries(st).filter(([, x]) => x !== 'ok') });
  }
  // 表が空振りしていない: 元の大会は 4 つの入口を全部通る（👻 のボタンが出て runRace を呼ぶ・再実行検証は「一致／不一致」の行）
  {
    BL3.races['bl4-f'] = () => JSON.parse(JSON.stringify(RICH()));
    el('ofVerify')._l = {}; el('ofVerifyNote').innerHTML = '';
    await ui.selectOfficialRace('bl4-f'); BL3.calls.length = 0; el('ofVerify').fire('click');
    const vn = el('ofVerifyNote').innerHTML, rr = el('raceResults').innerHTML;
    await ui.loadOfficialRaces(true); await ui.loadAllOfficialData(true); ui.renderRankings();
    const rb = el('rankBody').innerHTML;
    const m = /class="rank-vsworld" data-cls="([^"]*)" data-course="([^"]*)"/.exec(rb);
    const n0 = BL3.calls.length;
    if (m) ui.ghostVsWorld(unescH(m[1]), unescH(m[2]));
    logs.length = 0; ui.checkBeaten();
    const beatenLog = logs.some((x) => x.includes('b2')), beatenRow = rb.includes('<ul class="rank-beaten"><li>');
    ok(n0 === 1 && /official-verify-note/.test(vn) && rr.includes('race-tab') && !!m && BL3.calls.length === 2 && beatenLog && beatenRow,
       `元の大会で 5 つの入口を通る（再実行の runRace ${n0} 回・結果表 ${rr.includes('race-tab')}・🏅 の 👻 ボタン ${!!m}・👻 の runRace ${BL3.calls.length - n0} 回・打破通知 ${beatenLog}・🏅 の抜かれた記録の行 ${beatenRow}）`);
  }
  const badRows = rows.filter((r) => r.bad.length);
  for (const r of badRows) console.log(`    ✗ ${r.v} ${r.path}: ${r.bad.map(([k, v]) => `${k}=${v}`).join(' ; ')}`);
  ok(badRows.length === 0, `大会の値の欄 × 値 ${cases} 通り × 入口（🏆 詳細・🍴 fork・再実行検証・🏅 の集計・打破通知・👻）で例外が漏れない（漏れた行 ${badRows.length}）`);
  // 🏅: 読めない大会が 1 つあっても、ほかの大会の集計は出る（外すのは単独で通らない大会だけ）。
  {
    const G = () => { const r = RICH(); r.event.id = r.result.eventId = 'bl4-g'; r.event.title = 'G';
      r.entries = [ent('g1n', 'g1', 'c', { k: 0, program: { lang: JSON.parse('{"toString":1}'), src: SRC_C } })];
      r.result.finishers = [{ rank: 1, name: 'g1n', author: 'g1', carType: 'normal_fr', totalTimeMs: 500, bestLapMs: 500, penaltiesSec: 0 }];
      r.result.dnf = []; return r; };
    BL3.races['bl4-f'] = () => JSON.parse(JSON.stringify(RICH()));
    BL3.races['bl4-g'] = () => JSON.parse(JSON.stringify(G()));
    BL3.list = ['bl4-f', 'bl4-g'];
    let th = null, rb = '';
    try { await ui.loadOfficialRaces(true); await ui.loadAllOfficialData(true); ui.renderRankings(); rb = el('rankBody').innerHTML; } catch (e) { th = e; }
    const hasF = rb.includes('rank-board') && rb.includes('b2'), hasG = rb.includes('g1');
    ok(th === null && hasF && !hasG, `🏅 は読めない大会（entries の program.lang が {"toString":1}）だけを外し、ほかの大会の表を出す（例外 ${th ? th.message : 'なし'}・bl4-f の行 ${hasF}・bl4-g の行 ${hasG}）`);
    BL3.list = ['bl4-f'];
  }
  localStorage.removeItem('rumicar.author');
  ECL = (k) => String(k || ''); CTL = (k) => String(k);
}

// G-6c: 層4 が名指しした t() の呼び出し（race_ui.js の結果ダイアログ :115 新記録・:123 最速ラップ・:127 勝者／🏆 の詳細の
//   公式記録の 1 行・旧版の注記）を、本番の入口から文字列にできない名前・result.json の値で通す。是正前は全部 TypeError。
{
  ECL = L6.entryCarLabel; CTL = L6.carTypeLabel;
  const { practiceCourseId } = await import(pathToFileURL(join(JS, 'lap.js')).href);
  const recKey = 'rumicar.practiceShape.' + practiceCourseId(OVAL) + '::normal_fr';
  const BADN = JSON.parse('{"toString":1}');
  const R1 = () => ({
    event: { id: 'bl4-t', course: 'オーバル', laps: 1, class: 'open' },
    entries: [ent(BADN, 'a1', 'c', { k: 0 }), ent(BADN, 'b2', 'c', { k: 1 })],   // どちらが勝っても勝者・最速ラップの名前が {"toString":1}
    result: { eventId: 'bl4-t', verifyHash: BADN, engineVer: BADN, exec: BADN, finishers: [
      { rank: 1, name: BADN, author: 'a1', carType: 'normal_fr', totalTimeMs: 1000, bestLapMs: 900 }] },
  });
  for (const [label, rec, wantKey] of [['記録なし（:115 新記録）', null, 'race.record.new'], ['自分の記録の方が速い（:123 最速ラップ）', JSON.stringify({ t: 0.001 }), 'race.fastestLap']]) {
    if (rec) localStorage.setItem(recKey, rec); else localStorage.removeItem(recKey);
    el('raceResults').innerHTML = '';
    let d = '', th = null;
    try { d = await openRace('bl4-t', R1); } catch (e) { th = e; }
    const v = th === null ? await clickVerify('bl4-t', R1) : { thrown: th, calls: [] };
    const rr = el('raceResults').innerHTML;
    const winner = escH(i18n.t('race.winner', { name: '?' }));
    const sub = escH(i18n.t(wantKey, { name: '?', time: '\u0000', gap: '' }).split('\u0000')[0]);   // 名前 '?' までの文言
    ok(th === null && v.thrown === null && v.calls.length === 1 && rr.includes(winner) && rr.includes(sub),
       `再実行検証の結果ダイアログ（${label}）: 勝者 ${rr.includes(winner)}・${wantKey} ${rr.includes(sub)}${v.thrown ? '・例外 ' + v.thrown.constructor.name + ': ' + v.thrown.message : ''}`);
    if (!rec) {
      const vf = escH(i18n.t('official.result.verified', { hash: '?', ver: '?', exec: '?' }));
      const ar = escH(i18n.t('official.result.archived', { rec: '?', app: '\u0000' }).split('\u0000')[0]);   // engineVer ? までの文言
      ok(d.includes(vf) && d.includes(ar), `🏆 の詳細の公式記録の 1 行（official.result.verified）${d.includes(vf)}・旧版の注記（official.result.archived）${d.includes(ar)}`);
    }
  }
  localStorage.removeItem(recKey);
  ECL = (k) => String(k || ''); CTL = (k) => String(k);
}

// G-6d（F3）: 車種名 main.js carTypeName — 投稿車種（community）の name が文字列にできない値でも投げない。是正前は '🌐 ' + base の
//   連結が escapeHtml より先に投げ、車種表（car_crud.js renderCarParamTable）と fleet の車種セレクタ（main.js）が止まった。
//   併せて main.js loadCommunityCars: key が文字列にできない投稿は「key/name」の不正として数え、後続の投稿を読み続ける
//   （是正前は isReservedCarKey の String(key) がループごと投げた）。
{
  const ctn = L6.carTypeName;
  const CASES = [['JSON の {"toString":1}', JSON.parse('{"toString":1}'), '🌐 ?'], ['Object.create(null)', Object.create(null), '🌐 ?'],
    ['Symbol()', Symbol(), '🌐 Symbol()'], ['Proxy（どの読み出しも投げる）', new Proxy({}, { get() { throw new Error('trap'); } }), '🌐 ?']];
  for (const [label, v, want] of CASES) {
    let r, th = null;
    try { r = ctn({ key: 'bl4_x', name: v, community: true }); } catch (e) { th = e; }
    ok(th === null && r === want, `carTypeName(投稿車種・name=${label}) → ${th ? th.constructor.name + ': ' + th.message : J(r)}（期待 ${J(want)}）`);
  }
  const norm = [ctn(cfg6.CAR_TYPE_BY_KEY.normal_fr), ctn({ key: 'bl4_m', name: 'Mine', custom: true }), ctn({ key: 'bl4_c', name: 'Comm', community: true }),
    ctn({ key: 'bl4_n', name: 5, community: true }), ctn({ key: 'bl4_o', name: { valueOf() { return 1; }, toString() { return 'a'; } }, community: true })];
  ok(J(norm) === J([i18n.t('car.normal_fr'), 'Mine', '🌐 Comm', '🌐 5', '🌐 1']), `carTypeName の正常値は従来どおり（${J(norm)}）`);
  // 車種表: product の carTypeName を注入して投稿車種（name が {"toString":1}）の行を描く
  const BADN = JSON.parse('{"toString":1}');
  const comm = cfg6.registerCarType({ key: 'bl4_cn', name: BADN }); comm.community = true;
  const { initCarCrud } = await import(pathToFileURL(join(JS, 'car_crud.js')).href);
  const CC2 = initCarCrud({ $: el, escapeHtml: ESC, carTypeName: ctn, logLine() {}, buildFleetColumns() {}, pruneSlotCarTypes() {}, submitToGithub() {} });
  let th = null;
  try { CC2.renderCarParamTable(); } catch (e) { th = e; }
  const h = el('carParamTable').innerHTML;
  ok(th === null && h.includes('<td class="pname">🌐 ?'), `車種表は投稿車種の name が {"toString":1} でも描く（${th ? th.constructor.name + ': ' + th.message : '行 ' + h.includes('<td class="pname">🌐 ?')}）`);
  cfg6.unregisterCarType('bl4_cn');
  for (const ct of cfg6.CAR_TYPES.filter((c) => c.custom)) cfg6.unregisterCarType(ct.key);   // initCarCrud が localStorage の自作車を登録し直した分
  // loadCommunityCars（本文を取り出して、取得・登録・描画の依存を注入して呼ぶ）
  const body = cut6('async function loadCommunityCars() {', '\n}\n');
  const logs6 = []; let fleetN = 0, tableN = 0;
  const DEFS = { A: { key: 'bl4_ca', name: 'CA' }, B: { key: JSON.parse('{"toString":1}'), name: 'CB' }, C: { key: 'bl4_cc', name: JSON.parse('{"toString":1}') } };
  const f = new Function('listCommunityCars', 'fetchCommunityCar', 'logLine', 't', 'hasKey', 'loadCustomCars', 'isReservedCarKey', 'isBuiltinKey', 'registerCarType',
    'buildFleetColumns', 'renderCarParamTable', `let communityCars = [];\n${body}\nreturn loadCommunityCars;`)(
    async () => [{ name: 'a.json', download_url: 'A' }, { name: 'b.json', download_url: 'B' }, { name: 'c.json', download_url: 'C' }],
    async (u) => JSON.parse(JSON.stringify(DEFS[u], (k, v) => v)), (x) => logs6.push(String(x)), i18n.t, i18n.hasKey, () => [],
    (k) => String(k) in Object.prototype, (k) => Object.prototype.hasOwnProperty.call(cfg6.CAR_TYPE_BY_KEY, k) && !cfg6.CAR_TYPE_BY_KEY[k].custom && !cfg6.CAR_TYPE_BY_KEY[k].community,
    cfg6.registerCarType, () => { fleetN++; }, () => { tableN++; });
  // DEFS.B の key は JSON 経由で {"toString":1}（JSON.stringify は toString:1 を数のまま書く）
  let th2 = null;
  try { await f(); } catch (e) { th2 = e; }
  const reg = ['bl4_ca', 'bl4_cc'].map((k) => !!cfg6.CAR_TYPE_BY_KEY[k] && cfg6.CAR_TYPE_BY_KEY[k].community === true);
  const badLine = logs6.find((x) => x.includes('b.json (key/name)'));
  ok(th2 === null && reg.every(Boolean) && !!badLine && fleetN === 1 && tableN === 1,
     `投稿車種の取り込みは key が {"toString":1} の 1 件を不正として数え、後続を読む（${th2 ? '例外 ' + th2.constructor.name + ': ' + th2.message : `登録 ${J(reg)}・不正の行 ${!!badLine}・セレクタ/車種表の描き直し ${fleetN}/${tableN}`}）`);
  let r3, th3 = null;
  try { r3 = ctn(cfg6.CAR_TYPE_BY_KEY.bl4_cc); } catch (e) { th3 = e; }
  ok(th3 === null && r3 === '🌐 ?', `取り込んだ投稿車種（name が {"toString":1}）の車種名 → ${th3 ? th3.message : J(r3)}`);
  cfg6.unregisterCarType('bl4_ca'); cfg6.unregisterCarType('bl4_cc');
}

const line = '─'.repeat(64);
console.log('\n' + line);
console.log(`wf_bl1_ui: pass=${pass} fail=${fail}`);
if (fail) { for (const m of fails.slice(0, 40)) console.log('  ✗ ' + m); if (fails.length > 40) console.log(`  … ほか ${fails.length - 40} 件`); }
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
