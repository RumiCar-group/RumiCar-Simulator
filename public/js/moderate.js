// moderate.js — 質問・提案（💬）の投稿前チェック：NG 語と連絡先/URL スパムの判定（BL1・main.js から分離）。
// DOM に触れない純関数だけを置く（main.js の askSendBtn と常設ゲート wf_bl1_ui.mjs A 章が同じ関数を呼ぶ）。
// 注: クライアント側フィルタは回避可能。最終的な可視性は GitHub 上のレビュー（承認/削除）で担保する。
//
// ── 判定の規則（BL1 で部分一致 includes から改めた・v10.3.0 までは全語が部分一致）─────────────
//  v10.3.0 までは全語を `includes` で探したため、アプリ自身の語彙「カスタム車種」（カス）・「cockpit」（cock）・
//  地名「Essex」「Sussex」（sex）・人名「Dickens」（dick）・「die hard」（"die "）が投稿できなかった。
//  ① 英字の語（a-z と空白だけ）: 語境界で照合する。直前が英数字・_ でなく（"RC_xxx" の xxx は語の一部）、
//     直後が英字でない（数字・_ は区切り＝"sex69"・"sex_toy" は拒否）。語尾の活用（既定 -s/-es/-ed/-ing/-y・
//     語ごとに `suf` で変える）までは同じ語とみなす（"idiots"・"idiotic"・"stupidity"・"retarded"・"sexy" は拒否。
//     "Essex"・"cockpit"・"Dickens" は通る。retard は -s/-ed だけ＝"retarder"〔減速装置〕・"retarding force"
//     〔減速力〕・"retardation" は通る）。`sub: true` の語は部分一致のまま（"motherfucker" のような合成語も拒否）。
//     大小文字は区別しない。
//  ② 日本語の 2 文字以下の語（同じ文字種＝カタカナ／ひらがな／漢字だけで書いた語）: 前後の文字が同じ文字種で
//     なければ一致とする（長い語の一部なら一致としない）。`side: 'left'` の語は直前だけを見る（直後は問わない）。
//     文字種は Unicode の Script で引く（漢字＝Han〔CJK 拡張・互換漢字・々〇〕と〆、カタカナ＝Katakana〔ヽヾ・
//     半角カナ〕と長音ー・半角ｰ・半角濁点ﾞﾟ、ひらがな＝Hiragana〔ゝゞ〕）。前後の文字はサロゲート対
//     （CJK 拡張 B 以降）を 1 文字として読む。
//     「カスタム」「スカスカ」「バカンス」「デブリ」「差別化」「無差別」「滞在日数」「現在日時」は通り、
//     「カス」「このカスが」「在日韓国人」は拒否。
//  ③ それ以外（3 文字以上の日本語・文字種の混じった語）: 従来どおり部分一致。②で通るようになった語の
//     うち意図の明らかな合成語（バカヤロ・デブス・アホンダラ・エロゲ・人種差別・差別的）と英語の句（kill yourself・
//     die in a fire・you should die）、英語の合成語（dickhead・dickface・dickwad・cockhead・cocksucker）は一覧に足した
//     （無害な語の綴りに現れる例を見つけていない形だけ。「ドアホ」は「ドアホン」に現れるので足さない）。
//  "die "（末尾空白つき）は「die hard」「the engine would die here」を拒否していたので一覧から外し、
//  意図の明らかな句 "go die" に置き換えた（語境界で照合）。
//  連絡先/URL スパムの軽い抑止: http(s):// が 4 本以上なら拒否（従来どおり）。
//
// ── 既知の残り（v10.3.0 との差を wf_bl1_ui.mjs A-5 が固定する。直すと A-5 の行が赤になる＝ここも直す）──
//  取りこぼし（v10.3.0 は拒否・現在は通る）: 「お前はしね」「しねよ」「もうしね」（ひらがなに挟まれた しね は
//  「わたしね、」「もしね、」「少しねじれる」と区別できない）・「i will kill your family」（"kill your" は
//  「kill your speed」と区別できない）・「エロイ」（「エロイカ」と区別できない）・「性差別」「差別発言」
//  （差別 は「差別化」「無差別」と同じ漢字の並び）。同じ型の合成語は一般に通る: カタカナの短い語を含むカタカナの
//  合成語（「クソバカ」「ドアホ」「カスヤロー」＝「カスタム」と同じ字の並び）・漢字の合成語（「差別野郎」）・
//  英字の語の合成語（「sexist」「cockface」＝「Essex」「cockpit」と同じ語境界の規則・PLAN BL1 の指定）。
//  誤検出（v10.3.0 も拒否）: 「少しね」（しね）・「勢いを殺す」（殺す）・「pussyfoot」（pussy）・
//  「Penistone」（penis）・「在日外国人向けの英語 UI」（在日）・「在日本大使館」（在日）。

const RAW_NG_WORDS = [
  // 猥褻・性的 (日本語/ローマ字/英)
  'セックス', 'エロ', 'av女優', 'ちんちん', 'まんこ', 'ペニス', 'ヴァギナ', 'パイズリ', 'オナニー',
  'sex', { w: 'porn', sub: true }, { w: 'pussy', sub: true }, 'dick', 'cock', { w: 'penis', sub: true },
  { w: 'vagina', sub: true }, { w: 'boobs', sub: true }, 'nude', 'xxx', { w: 'fuck', sub: true },
  { w: 'dickhead', sub: true }, { w: 'dickface', sub: true }, { w: 'dickwad', sub: true }, { w: 'cockhead', sub: true },
  { w: 'cocksucker', sub: true },
  // 誹謗中傷・差別・攻撃
  '死ね', '殺す', 'しね', 'バカ', 'アホ', 'クズ', 'カス', 'キモい', 'ブス', 'デブ', 'きちがい', 'キチガイ',
  'バカヤロ', 'デブス', 'アホンダラ', 'エロゲ',
  { w: '在日', side: 'left' }, '差別', '人種差別', '差別的',
  { w: 'idiot', suf: ['', 's', 'ic', 'ically'] }, { w: 'stupid', suf: ['', 's', 'ity', 'ly', 'er', 'est'] },
  { w: 'retard', suf: ['', 's', 'ed'] },
  'kill you', 'kill yourself', 'kill yourselves', 'go die', 'die in a fire', 'you should die',
];

// 文字種（② の判定用）。Unicode の Script（u フラグ）で引き、Script=Common の長音・〆・半角濁点を足す
// （中黒・は区切りなので含めない）。引数はコードポイント 1 個ぶんの文字列（サロゲート対は 2 単位）。
const KATA = /^[\p{Script=Katakana}\u30FC\uFF70\uFF9E\uFF9F]$/u;
const HIRA = /^\p{Script=Hiragana}$/u;
const KANJI = /^[\p{Script=Han}\u3006]$/u;
const WORD_BEFORE = /[a-z0-9_]/;  // 直前: 語の文字＝正規表現の \w と同じ（RC_xxx の xxx は語の一部）
const WORD_AFTER = /[a-z]/;       // 直後: 英字だけが語の続き（数字・_ は区切り＝sex69・sex_toy は拒否）
const scriptOf = (ch) => (ch && (KATA.test(ch) ? 'kata' : HIRA.test(ch) ? 'hira' : KANJI.test(ch) ? 'kanji' : null)) || null;
const ASCII_WORD = /^[a-z ]+$/;
const SUFFIXES = ['', 's', 'es', 'ed', 'ing', 'y'];

function compile(entry) {
  // typeof を見る: 文字列には String.prototype.sub（古い HTML メソッド）があり entry.sub が真になる。
  const opt = typeof entry === 'object' ? entry : {};
  const word = typeof entry === 'string' ? entry : entry.w;
  const lw = word.toLowerCase();
  if (ASCII_WORD.test(lw)) {
    if (opt.sub === true) return { word, kind: 'sub', lw };
    return { word, kind: 'ascii', lw, suf: Array.isArray(opt.suf) ? opt.suf : SUFFIXES };
  }
  if (opt.sub === true) return { word, kind: 'sub', lw };
  const chars = [...lw];
  const sc = scriptOf(chars[0]);
  if (chars.length <= 2 && sc && chars.every((c) => scriptOf(c) === sc)) {
    return { word, kind: 'short', lw, script: sc, leftOnly: opt.side === 'left' };
  }
  return { word, kind: 'sub', lw };
}

/** 判定に使う NG 語（表示用の原形）。並びは一覧の順＝最初に当たった語を返す。 */
export const NG_WORDS = Object.freeze(RAW_NG_WORDS.map((e) => (typeof e === 'string' ? e : e.w)));
const COMPILED = RAW_NG_WORDS.map(compile);

// 位置 i の直前／位置 j から始まる 1 文字（サロゲート対は 2 単位まとめて）。範囲外は ''。
function charBefore(t, i) {
  if (i <= 0) return '';
  const lo = t.charCodeAt(i - 1);
  if (lo >= 0xDC00 && lo <= 0xDFFF && i >= 2) {
    const hi = t.charCodeAt(i - 2);
    if (hi >= 0xD800 && hi <= 0xDBFF) return t.slice(i - 2, i);
  }
  return t[i - 1];
}
const charAt = (t, j) => (j < t.length ? String.fromCodePoint(t.codePointAt(j)) : '');

// lw が t の位置 i から始まる出現のうち、規則に合う一致があるか。
function matchAt(t, i, c) {
  const end = i + c.lw.length;
  if (c.kind === 'ascii') {
    if (i > 0 && WORD_BEFORE.test(t[i - 1])) return false;
    for (const s of c.suf) {
      if (s && t.slice(end, end + s.length) !== s) continue;
      const after = t[end + s.length];
      if (!after || !WORD_AFTER.test(after)) return true;
    }
    return false;
  }
  // short: 前後の文字が同じ文字種でない（leftOnly は直前だけ）。
  if (scriptOf(charBefore(t, i)) === c.script) return false;
  return c.leftOnly || scriptOf(charAt(t, end)) !== c.script;
}

function hits(t, c) {
  if (c.kind === 'sub') return t.includes(c.lw);
  for (let i = t.indexOf(c.lw); i >= 0; i = t.indexOf(c.lw, i + 1)) if (matchAt(t, i, c)) return true;
  return false;
}

/**
 * 投稿本文（タイトル＋本文）を判定する。
 * @returns {{ok:true}|{ok:false, word:string}} word＝拒否の理由として表示する語（NG 語の原形か 'リンク過多'）。
 */
export function moderate(text) {
  const t = String(text ?? '').toLowerCase();
  for (const c of COMPILED) if (hits(t, c)) return { ok: false, word: c.word };
  // 連絡先/URLスパムの軽い抑止 (技術的議論に限定)
  if ((t.match(/https?:\/\//g) || []).length > 3) return { ok: false, word: 'リンク過多' };
  return { ok: true };
}
