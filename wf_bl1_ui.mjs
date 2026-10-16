// wf_bl1_ui.mjs — Stage BL（UI 不具合）の常設ゲート。BL1 が新設し、BL2〜BL7 が章を足す（A＝BL1・B＝BL2・C〜F＝BL3）。
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
// escapeHtml は main.js:escapeHtml と同じ式（DOM を前提にする main.js は import できない＝依存注入の相手を同じ形で置く）。
const escH = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const unescH = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const { buildFromSpec } = await import(pathToFileURL(join(JS, 'course.js')).href);
const { PROGRAM_BY_KEY } = await import(pathToFileURL(join(JS, 'programs.js')).href);
const engine = await import(ENGINE_URL);
const raceEvent = await import(pathToFileURL(join(JS, 'race_event.js')).href);
const i18n = await import(pathToFileURL(join(JS, 'i18n.js')).href);
const COURSE_SPECS = JSON.parse(readFileSync(join(ROOT, 'public/data/courses.json'), 'utf8'));
const OVAL = buildFromSpec(COURSE_SPECS.find((x) => x.name === 'オーバル'));
const logs = [];
const ui = (await import(UI_URL)).initRaceUI({
  $: el, escapeHtml: escH, logLine: (x) => logs.push(String(x)),
  activeSlot: () => ({ name: 'ME', lang: 'c', src: PROGRAM_BY_KEY.normal_fr.code, carType: 'normal_fr' }),
  exitEdit() {}, courseDisplayName: (c) => (c && typeof c === 'object' ? c.name : String(c || '')),
  carTypeLabel: (k) => String(k), entryCarLabel: (k) => String(k || ''), setActiveProgram() {}, playCountdown() {},
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
{  // 参考（合否に数えない）: name が object のエントリーは、再実行検証より前に 🏆 の詳細の描画（renderOfficialDetail の
   // escapeHtml(e.name)＝main.js の String(s)）で止まり、ボタンまで届かない（BL3 の範囲外＝決定ログ BL-3 で BL4 へ申し送り）。
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

const line = '─'.repeat(64);
console.log('\n' + line);
console.log(`wf_bl1_ui: pass=${pass} fail=${fail}`);
if (fail) { for (const m of fails.slice(0, 40)) console.log('  ✗ ' + m); if (fails.length > 40) console.log(`  … ほか ${fails.length - 40} 件`); }
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
