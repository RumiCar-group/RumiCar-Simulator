// moderate.js — 質問・提案（💬）の投稿前チェック：NG 語と連絡先/URL スパムの判定（BL1・main.js から分離）。
// DOM に触れない純関数だけを置く（main.js の askSendBtn と常設ゲート wf_bl1_ui.mjs A 章が同じ関数を呼ぶ）。
// 注: クライアント側フィルタは回避可能。最終的な可視性は GitHub 上のレビュー（承認/削除）で担保する。
//
// ── 判定の規則（BL1 で部分一致 includes から改めた・v10.3.0 までは全語が部分一致）─────────────
//  v10.3.0 までは全語を `includes` で探したため、アプリ自身の語彙「カスタム車種」（カス）・「cockpit」（cock）・
//  地名「Essex」「Sussex」（sex）・人名「Dickens」（dick）・「die hard」（"die "）が投稿できなかった。
//  ① 英字の語（a-z と空白だけ）: 語境界で照合する。直前が英数字・_ でなく、直後も英数字・_ でない。語尾の活用
//     （-s/-es/-ed/-ing/-y）までは同じ語とみなす（"idiots"・"retarded"・"sexy" は拒否のまま。"Essex"・"cockpit"・
//     "Dickens" は通る。-er は付けない＝"retarder"〔減速装置〕・"dicker" を拒否しない）。`sub: true` の語は無害な英単語の綴りに現れないので部分一致のまま
//     （"motherfucker" のような合成語も拒否）。大小文字は区別しない。
//  ② 日本語の 2 文字以下の語（同じ文字種＝カタカナ／ひらがな／漢字だけで書いた語）: 前後の文字が同じ文字種で
//     なければ一致とする（長い語の一部なら一致としない）。カタカナの長音「ー」はカタカナに数える。
//     「カスタム」「スカスカ」「バカンス」「デブリ」「差別化」「無差別」「滞在日数」は通り、「カス」「このカスが」は拒否。
//     既知の残り: 漢字に続くひらがなの語は区別できない（「少しね」は「しね」で拒否される）。
//  ③ それ以外（3 文字以上の日本語・文字種の混じった語）: 従来どおり部分一致。
//  "die "（末尾空白つき）は「die hard」「the engine would die here」を拒否していたので一覧から外し、
//  意図の明らかな句 "go die" に置き換えた（語境界で照合）。
//  連絡先/URL スパムの軽い抑止: http(s):// が 4 本以上なら拒否（従来どおり）。

const RAW_NG_WORDS = [
  // 猥褻・性的 (日本語/ローマ字/英)
  'セックス', 'エロ', 'av女優', 'ちんちん', 'まんこ', 'ペニス', 'ヴァギナ', 'パイズリ', 'オナニー',
  'sex', { w: 'porn', sub: true }, { w: 'pussy', sub: true }, 'dick', 'cock', { w: 'penis', sub: true },
  { w: 'vagina', sub: true }, { w: 'boobs', sub: true }, 'nude', 'xxx', { w: 'fuck', sub: true },
  // 誹謗中傷・差別・攻撃
  '死ね', '殺す', 'しね', 'バカ', 'アホ', 'クズ', 'カス', 'キモい', 'ブス', 'デブ', 'きちがい', 'キチガイ',
  '在日', '差別', 'idiot', 'stupid', 'retard', 'kill you', 'go die',
];

// 文字種（② の判定用）。カタカナ: ァ〜ヺ と長音ー（中黒・は区切りなので含めない）。
const KATA = /[\u30A1-\u30FA\u30FC]/;
const HIRA = /[\u3041-\u3096\u309D\u309E]/;
const KANJI = /[\u3400-\u4DBF\u4E00-\u9FFF\u3005]/;
const ALNUM = /[a-z0-9_]/;  // 語の文字＝正規表現の \w と同じ（RC_xxx の xxx は語の一部）
const scriptOf = (ch) => (ch && (KATA.test(ch) ? 'kata' : HIRA.test(ch) ? 'hira' : KANJI.test(ch) ? 'kanji' : null));
const ASCII_WORD = /^[a-z ]+$/;
const SUFFIXES = ['', 's', 'es', 'ed', 'ing', 'y'];

function compile(entry) {
  const word = typeof entry === 'string' ? entry : entry.w;
  const lw = word.toLowerCase();
  if (ASCII_WORD.test(lw)) {
    // typeof を見る: 文字列には String.prototype.sub（古い HTML メソッド）があり entry.sub が真になる。
    if (typeof entry === 'object' && entry.sub === true) return { word, kind: 'sub', lw };
    return { word, kind: 'ascii', lw };
  }
  const chars = [...lw];
  const sc = scriptOf(chars[0]);
  if (chars.length <= 2 && sc && chars.every((c) => scriptOf(c) === sc)) return { word, kind: 'short', lw, script: sc };
  return { word, kind: 'sub', lw };
}

/** 判定に使う NG 語（表示用の原形）。並びは一覧の順＝最初に当たった語を返す。 */
export const NG_WORDS = Object.freeze(RAW_NG_WORDS.map((e) => (typeof e === 'string' ? e : e.w)));
const COMPILED = RAW_NG_WORDS.map(compile);

// lw が t の位置 i から始まる出現のうち、規則に合う一致があるか。
function matchAt(t, i, c) {
  const end = i + c.lw.length;
  if (c.kind === 'ascii') {
    if (i > 0 && ALNUM.test(t[i - 1])) return false;
    for (const s of SUFFIXES) {
      if (s && t.slice(end, end + s.length) !== s) continue;
      const after = t[end + s.length];
      if (!after || !ALNUM.test(after)) return true;
    }
    return false;
  }
  // short: 前後の文字（サロゲートを含まない BMP の範囲なので UTF-16 の 1 単位で足りる）が同じ文字種でない。
  return scriptOf(t[i - 1]) !== c.script && scriptOf(t[end]) !== c.script;
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
