// wf_course_corpus.mjs — 壊れた/境目のコース入力の単一真実源 (BC3・2026-09-18)
// ════════════════════════════════════════════════════════════════════════════
// BB2 が `browser/check_bb2_community_bad.mjs` の中に持っていた不正入力コーパスをここへ出し、
// **卓上ゲート (wf_bc3_intake.mjs) と実ブラウザゲート (check_bb2_community_bad.mjs・check_bc3_intake.mjs) が
// 同じ配列を読む**ようにしたもの。写しを 2 つ持つと、片方だけ直したときに「緑だが守れていない」が生まれる
// (CI-9「再実装しない」をテストデータにも適用する)。BB2 の実文はそのまま移した (期待も据え置き)。
//
// 形式: [ファイル名, 本文 (文字列・JSON とは限らない), std の期待, own の期待 (省略時は std と同じ)]
//   ・std = `course.js:checkCourseData`   … 第三者のデータ (投稿コース・大会の同梱 courseDef・取り込んだ JSON)
//   ・own = `course.js:checkOwnCourseData`… 利用者自身のデータ (保存コースの選択・エディタの ✔適用)
//   ・'drop' … 検査が理由を返す (= 一覧に載せない・読み込まない)。ただし bad-syntax.json だけは
//     JSON として読めない形で、落ちるのは JSON.parse (呼び出し側が SyntaxError を 'JSON' として数える)。
//   ・'keep' … 形式としては正しい。XSS の印・空の名前・上限ぎりぎりなど「通ってよいが油断できない」形。
// **std と own で答えが分かれる形を必ず含めること** (分かれない形しか無いと、2 基準を 1 つに戻す退行が
// 緑のまま通る。BC3 の 1 回目で実際にその形の見落としが起きた)。
// 依存ゼロ (import なし) = node_modules 不要のまま wf_run_all.mjs から呼べる。
// ════════════════════════════════════════════════════════════════════════════

function square(x0, y0, x1) {
  return [{ x1: x0, y1: y0, x2: x1, y2: y0 }, { x1, y1: y0, x2: x1, y2: x1 }, { x1, y1: x1, x2: x0, y2: x1 }, { x1: x0, y1: x1, x2: x0, y2: y0 }];
}
// 軸に沿った長方形 (0,0)-(w,h) の閉じた壁 4 本
function box(w, h) {
  return [{ x1: 0, y1: 0, x2: w, y2: 0 }, { x1: w, y1: 0, x2: w, y2: h }, { x1: w, y1: h, x2: 0, y2: h }, { x1: 0, y1: h, x2: 0, y2: 0 }];
}
// 楕円の閉じた壁 (n 本・中心 cx,cy・半径 rx,ry)
function ring(n, cx, cy, rx, ry) {
  const w = [];
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * i / n, b = 2 * Math.PI * (i + 1) / n;
    w.push({ x1: cx + rx * Math.cos(a), y1: cy + ry * Math.sin(a), x2: cx + rx * Math.cos(b), y2: cy + ry * Math.sin(b) });
  }
  return w;
}

export const SHAPES = [
  ['bad-null.json', 'null', 'drop'],
  ['bad-array.json', '[1,2]', 'drop'],
  ['bad-syntax.json', '{name:', 'drop'],
  ['bad-empty.json', '{}', 'drop'],
  ['bad-walls-obj.json', JSON.stringify({ name: 'BAD walls が配列でない', walls: {} }), 'drop'],
  ['bad-wall-null.json', JSON.stringify({ name: 'BAD 壁に null', bounds: { w: 3, h: 2 }, walls: [null] }), 'drop'],
  ['bad-name-obj.json', JSON.stringify({ name: { a: 1 }, walls: [] }), 'drop'],
  ['bad-nan.json', JSON.stringify({ name: 'BAD 数値でない座標', bounds: { w: 'abc', h: 'x' }, start: { x: 'a' }, walls: [{ x1: 'a', y1: 1, x2: 2, y2: 3 }] }), 'drop'],
  ['bad-html.json', JSON.stringify({ name: '<img src=x onerror="window.__xss=1">BAD', desc: '<img src=x onerror="window.__xss=2">', walls: [] }), 'keep'],
  // 実装前の固定では「採用」だったが、層 4 レビューで v2 物理・編集表示のメモリ超過を実測したので「除外」へ改訂 (決定ログ)
  ['bad-huge.json', JSON.stringify({ name: 'BAD 巨大 bounds', bounds: { w: 1e9, h: 1e9 }, walls: [{ x1: 0, y1: 0, x2: 1e9, y2: 0 }] }), 'drop'],
  ['bad-string.json', JSON.stringify('オーバル'), 'drop'],
  ['bad-name-en-num.json', JSON.stringify({ name: 'BAD name_en が数', name_en: 7, walls: [] }), 'drop'],
  ['bad-name-en-obj.json', JSON.stringify({ name: 'BAD name_en がオブジェクト', name_en: {}, walls: [] }), 'drop'],
  ['bad-name-en-arr.json', JSON.stringify({ name: 'BAD name_en が配列', name_en: [], walls: [] }), 'drop'],
  ['bad-name-en-blank.json', JSON.stringify({ name: 'BAD name_en が空白', name_en: '   ', walls: [] }), 'drop'],
  // 大きさ (層 4 レビュー後に追加)。遠い壁 1 本は選んだ瞬間に壁グリッドの走査が終わらなかった形、mm は実投稿の ×1000 相当。
  // **どちらも own でも落とす**: 遠い壁は buildWallGrid の for が終わらなくなる形なので「自分のデータ」でも受け取れない。
  ['bad-far-wall.json', JSON.stringify({ name: 'BAD 遠い壁', bounds: { w: 3, h: 2 }, start: { x: 1.5, y: 0.3, theta: 0 },
    walls: [...ring(40, 1.5, 1, 1.2, 0.8), { x1: 1e17, y1: 0, x2: 1e17 + 0.1, y2: 0 }] }), 'drop', 'drop'],
  ['bad-mm.json', JSON.stringify({ name: 'BAD mm と m の取り違え', bounds: { w: 18363, h: 18707 }, start: { x: 4131, y: 7649, theta: 0.64 },
    walls: ring(60, 9000, 9000, 8000, 8000) }), 'drop', 'drop'],
  ['bad-name-empty.json', JSON.stringify({ name: '', walls: ring(24, 1.5, 1, 1.2, 0.8), bounds: { w: 3, h: 2 }, start: { x: 1.5, y: 0.3, theta: 0 } }), 'keep'],
  // 外周と内周の正方形 (廊下幅 100 m)＋廊下を斜めに横切る 118 m の壁 1 本。壁グリッドのセル数が上限の 98% になる形
  ['bad-limit-big.json', JSON.stringify({ name: 'BAD 上限ぎりぎり (1000 m)', bounds: { w: 1000, h: 1000 }, start: { x: 500, y: 50, theta: 0 },
    walls: [...square(0, 0, 1000), ...square(100, 100, 900), { x1: 5, y1: 105, x2: 123, y2: 223 }] }), 'keep'],
  ['bad-limit-tiny.json', JSON.stringify({ name: 'BAD 上限ぎりぎり (0.5 m)', bounds: { w: 0.5, h: 0.5 }, start: { x: 0.25, y: 0.06, theta: 0 },
    finish: { x1: 0.25, y1: -0.025, x2: 0.25, y2: 0.14 }, walls: [...ring(24, 0.25, 0.25, 0.24, 0.24), ...ring(24, 0.25, 0.25, 0.12, 0.12)] }), 'keep'],
  // ── BC3: std と own で答えが分かれる形 ───────────────────────────────────────
  // コースエディタは枠 bounds だけを 1 m まで縮められ、壁は動かさず、保存は無検査。∴ これは**正規の中間状態**で、
  // 自分の保存コースとしては開けなければならない (own=keep)。他人へ配る投稿としては通さない (std=drop)。
  ['bad-shrunk-frame.json', JSON.stringify({ name: 'BC3 枠を 1×1 m へ縮めた自作コース', bounds: { w: 1, h: 1 },
    start: { x: 0.5, y: 0.25, theta: 0 }, finish: { x1: 0.5, y1: 0, x2: 0.5, y2: 0.5 }, walls: box(3, 2) }), 'drop', 'keep'],
  ['bad-shrunk-start.json', JSON.stringify({ name: 'BC3 枠の外に start がある自作コース', bounds: { w: 1, h: 1 },
    start: { x: 2.5, y: 1.5, theta: 0 }, walls: box(3, 2) }), 'drop', 'keep'],
  // own の絶対上限 (bMax=1000 m) の境目。ちょうどは通り、超えると own でも落ちる。
  ['bad-own-edge-in.json', JSON.stringify({ name: 'BC3 絶対上限ちょうど (1000 m)', bounds: { w: 3, h: 2 },
    start: { x: 1.5, y: 1, theta: 0 }, walls: [...box(3, 2), { x1: 999.9, y1: 0, x2: 1000, y2: 0 }] }), 'drop', 'keep'],
  ['bad-own-edge-out.json', JSON.stringify({ name: 'BC3 絶対上限を超える (1000.0001 m)', bounds: { w: 3, h: 2 },
    start: { x: 1.5, y: 1, theta: 0 }, walls: [...box(3, 2), { x1: 999.9, y1: 0, x2: 1000.0001, y2: 0 }] }), 'drop', 'drop'],
  // ── BC3 層 4 レビュー (2026-09-18): **own が std より厳しくなりうる帯**の反例 ───────────────
  // 枠が bMax/(1+margin) = 952.38 m を超えると、枠＋margin の窓 (bw×1.05) が絶対上限 1000 m を追い越す。
  // own の窓を「絶対上限だけ」にすると、ここで **std は通すのに own が落とす**という逆転が起きる
  // (＝大枠コースを保存すると開けなくなる)。own の窓を和集合にしてある限り両方 keep。
  // **この形を母集団から外すと「own は std より緩い」の検査が空振りになる** (wf_bc3_intake B1)。
  ['big-frame-wall.json', JSON.stringify({ name: 'BC3 大枠 1000 m・壁が枠の外 40 m (std の窓の内側)', bounds: { w: 1000, h: 1000 },
    start: { x: 500, y: 50, theta: 0 }, walls: [...box(1000, 1000), { x1: 0, y1: 0, x2: 1040, y2: 0 }] }), 'keep', 'keep'],
  ['big-frame-start.json', JSON.stringify({ name: 'BC3 大枠 1000 m・start が枠の外 20 m', bounds: { w: 1000, h: 1000 },
    start: { x: 1020, y: 500, theta: 0 }, walls: box(1000, 1000) }), 'keep', 'keep'],
  ['big-frame-finish.json', JSON.stringify({ name: 'BC3 大枠 1000 m・finish が枠の外 49 m', bounds: { w: 1000, h: 1000 },
    start: { x: 500, y: 50, theta: 0 }, finish: { x1: 500, y1: -49, x2: 500, y2: 1049 }, walls: box(1000, 1000) }), 'keep', 'keep'],
];

// **std が通すのに own が落とす形は 1 つも無い** (own ⊇ std) ことを、母集団が空振りせずに突けるように、
// 「枠が bMax/(1+margin) を超える帯」の形があることをコーパス自身が名指しで持つ。ゲートはこの名前で
// 母集団の検分をする (名前を変えるならゲートも一緒に直すこと)。
export const BIG_FRAME_SHAPES = ['big-frame-wall.json', 'big-frame-start.json', 'big-frame-finish.json'];

// JSON として読めない形 (落ちるのは検査でなく JSON.parse)。
export const SYNTAX_ONLY = ['bad-syntax.json'];

/** その形の期待 ('drop' | 'keep')。key = 'std' | 'own'。own を省いた形は std と同じ。 */
export function expectOf(shape, key) { return (key === 'own' && shape.length > 3) ? shape[3] : shape[2]; }
