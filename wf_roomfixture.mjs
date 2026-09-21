// wf_roomfixture.mjs — 「閉じた部屋」治具の**単一真実源**（library・単体実行しない）。
// ════════════════════════════════════════════════════════════════════════════
// 何を 1 つにしたか（BD4・2026-09-21）:
//   同じ性質の治具 —「静的には置けるが 1 台も走り出せない閉じた部屋」— が **4 本のゲート**にあり、
//   **枠 (bounds) の取り方だけが 3 通りに分かれていた**:
//     ・wf_az2_fitguard.mjs            … 正方 2.0 m 固定（部屋を (0.2, 0.84) に浮かせる）
//     ・wf_az5_capzero.mjs             … 部屋 + 0.2 m（非正方）
//     ・browser/check_az5_race.mjs     … 同上（さらに車体寸法を 0.190 / 0.080 でハードコード）
//     ・browser/check_az2_fitguard.mjs … 0.01 m 刻みで上へ探し、取り込み検査が最初に受け取った正方
//   枠は「部屋の中の走行」には効かないが、**取り込み検査 `course.js:checkCourse` の `COURSE_LIMITS.bMin`
//   には効く**。実際 BC11 以前の `check_az2_fitguard` は枠＝部屋（0.323 m < bMin 0.5 m）で、BC3 が全取り込み
//   経路へ bMin を課した瞬間に**保存コースとして適用されなくなり、検査が静かに空振りしていた**（決定ログ BC-7(b)）。
//   他の 3 本は値が**偶然** bMin を上回っていただけで、同じ根拠を持っていたわけではない。実測 2026-09-21:
//   `check_az5_race.mjs` の枠 0.523×0.520 は bMin まで余裕 0.023 m しかなく、**車体寸法が 10% 縮むだけで
//   own 取り込みが `bounds.w` で落ちる**（＝同じ空振りが再発する）。
//   ∴ **枠の導出をここ 1 箇所に置き、値は product に答えさせる**（`COURSE_LIMITS` は course.js の export に
//   無いので書き写せない＝BC5 で実測。書き写せたとしても書き写さない）。
//
// **統一しない 1 箇所（意図的）**: `wf_ba1_fitcore.mjs:68` の `fx:pocket` は旧 az2 治具の写しだが、
//   同ゲートは**改修前ツリーで取った出力ダイジェストを凍結して突き合わせる**（`PINNED`・2026-09-15 取得）。
//   配置を変えると凍結値を刻み直すことになり、回帰記録としての価値が消える。∴ **そのまま凍結して残す**。
//
// 導出（呼ぶ 4 本で同一）:
//   ① 部屋は **原点に置いた X×Y の閉じた箱**（壁 4 本）。X = ROOM.depth×車長・Y = ROOM.width×車幅。
//   ② 枠は正方 s×s。s を「部屋の外接 max(X,Y)」から **0.01 m 刻みで上へ**探し、
//      **product の入口 `acceptCourseData(…, { own: true })` が最初に受け取った値**を採る。
//      `own` なのは、この治具が実際に通る経路（保存コースの選択）がその基準だから（course.js の BC3 注記）。
//      グリッド上の最初の合格値であって、下限そのものの値ではない。
//   ③ 見つからなければ `frame: null`・`course: null` を返す（**代わりの枠を勝手に作らない**。呼び出し側は
//      前提が崩れたものとして赤くする — 黙って別の治具で走ると「前提の緑が嘘」になる）。
//   ④ 呼び出し側は `frameViolations()` で**導出の結果を product に問い直す**（下の注記）。
//   ⑤ **発進位置 `start` は統一しない**（呼び出し側が与える）。4 本はそれぞれ別の位置を使っており
//      （az2 ⑤ は部屋の左壁から 0.35X・az5 系は 0.5 車長+5mm・check_az2_fitguard ⑩ は X/2）、
//      どれも各ゲートの旧実装から**保存した**値である。前方の余地が違うので `stuckAtN` が測るものは
//      4 本で同一ではない — **統一したのは「部屋の大きさと枠」までである**と正直に書いておく。
//
// 枠を変えても走行の母体が変わらないことの根拠（実測 2026-09-21・cs 1 / 0.8 / 0.6 / 0.5 の 4 倍率・6 点）:
//   `fleet.js:86` の廊下 BFS は候補を bounds で刈るが、そこから外へ出られないのは次行 `:87` の
//   `segClearOfWalls`（壁を横切らない）で、直線グリッドの候補（`fleet.js:191`）は bounds を見ず
//   `onTrack`（start との見通し）が部屋の外を落とす。∴ どちらの経路も枠に依らず部屋の中に閉じる。
//   **同じ配置のまま枠だけ 2.0 → 0.503 に変えたときのスポーン 6 点の差は、4 倍率すべてで厳密に 0**。
//   枠が効くのは `fitguard.js:98` の代理量 `target = 0.25×min(w,h)` を通る**途中経過**だけで、
//   落ち着き先（卓上 cs0.5）は変わらない。
//   ⚠ **区別すること**: `wf_az2_fitguard` は枠だけでなく**部屋の位置も (0.2, 0.84) → 原点へ動かした**。
//   平行移動のぶんは 0 ではない —— cs0.8 で 1 点ぶん 0.22 m ずれる（実測）。これは `fleet.js:72` の
//   廊下 BFS の重複除去キーが**絶対座標のグリッド**なので、平行移動でバケットの割れ方が変わり
//   **同じ点集合の割当順が入れ替わる**ため。収容オラクルの答えは全倍率で一致する
//   （実測: `fitsAllCars(6)` と `capacityOf` が cs 1/0.8/0.6/0.5 のすべてで旧＝新）。
import { acceptCourseData } from './public/js/course.js';

// 部屋の寸法（車体寸法に対する倍数）。**ここが唯一の定義**。
//   奥行 1.7 車長 = 「前方 0.5 車長は空く（fitsAllCars の driveable 判定を満たす）が、車長ぶんは走れない」
//   幅   4.0 車幅 = 静的に 2 台以上を横へ並べられる（= 多台の分岐に入れる母体）
export const ROOM = { depth: 1.7, width: 4.0 };

// 枠の探索グリッド。**刻みと打ち切りもここ 1 箇所**（呼び出し側へ書き写さない）。
export const FRAME = { step: 0.01, max: 5.0 };

const r3 = (v) => Math.round(v * 1000) / 1000;
const gridStart = (X, Y) => r3(Math.max(X, Y));

/**
 * 「閉じた部屋」治具を組み立てる。
 * @param {object}   o
 * @param {string}   o.name     コース名
 * @param {number}   o.L        車長（卓上 ×1 の実寸）
 * @param {number}   o.W        車幅（同上）
 * @param {Function} o.start    (X, Y, L, W) => { x, y, theta }  部屋の左下を原点とした発進位置
 * @returns {{ X:number, Y:number, frame:number|null, data:object|null, course:object|null }}
 *   data  … 取り込み前の素データ（保存コースとして seed する形・normalizeCourse は通していない）
 *   course… product の入口が返した正規化済みコース（= acceptCourseData の戻り値そのもの）
 */
export function closedRoomFixture({ name, L, W, start }) {
  const X = ROOM.depth * L, Y = ROOM.width * W;
  const walls = [
    { x1: 0, y1: 0, x2: X, y2: 0 }, { x1: X, y1: 0, x2: X, y2: Y },
    { x1: X, y1: Y, x2: 0, y2: Y }, { x1: 0, y1: Y, x2: 0, y2: 0 },
  ];
  const st = start(X, Y, L, W);
  const mk = (s) => ({ name, bounds: { w: s, h: s }, start: { x: st.x, y: st.y, theta: st.theta }, walls });
  // **開始値が部屋の外接を下回る枠は採らない。** `r3` は四捨五入なので `max(X,Y)` をわずかに下回る値に
  // なりうる（例: 2.3454 → 2.345）。そのまま受理されると `fleet.js:86` の刈りが部屋の端を削り、
  // 「閉じた部屋」でなくなる。現寸法では起きない（実測 2026-09-21: r3(0.323) ≥ X）が、構造で塞ぐ。
  const floor = Math.max(X, Y);
  for (let s = gridStart(X, Y); s <= FRAME.max; ) {
    if (s >= floor) {
      const r = acceptCourseData(mk(s), { own: true });
      if (r.ok) return { X, Y, frame: s, data: mk(s), course: r.course };
    }
    const next = r3(s + FRAME.step);
    if (!(next > s)) break;   // 刻みが丸めで消える入力で回り続けない
    s = next;
  }
  return { X, Y, frame: null, data: null, course: null };
}

/**
 * 組み上がった治具を **product に問い直す**。呼び出し側はこの戻り値（違反の配列）をそのまま赤にする。
 *
 * **循環していないのはどれか（正直に書く）**:
 *   ・(1)(2) の「取り込みを通る」は、`closedRoomFixture` が同じ関数で選んだ枠を同じプロセスで問い直すので
 *     **枠がこの関数由来なら構成上ほぼ必ず真**。効くのは、呼び出し側が枠を自前で決めて `data` を作った場合
 *     （＝ BC11 の壊れ方そのもの）だけである。
 *   ・(3)(4) が**非循環な本体**: 枠が「product が答えた値」であることを、選び方に依らない形で押さえる。
 *       (3) グリッド整合 … `frame` が `max(X,Y)` から `FRAME.step` の整数倍だけ上にある
 *       (4) 最小性     … `frame - FRAME.step` は取り込みに**落ちる**（＝これ以上小さくできない）
 *     実測 2026-09-21: 枠を 2.0 に固定し直す変異は (1)(2) を素通りするが (3)(4) で赤くなる
 *     （2.0 は グリッド外・かつ 1.99 が受理される）。0.5（＝`bMin` を書き写した値）も (3) で赤くなる。
 */
export function frameViolations(fx) {
  const v = [];
  if (fx.frame === null || fx.course === null) {
    v.push(`取り込み検査 (acceptCourseData) が受理する枠が ${FRAME.max}m までに無い（frame=${fx.frame}）＝治具を組めない`);
    return v;
  }
  const own = acceptCourseData(fx.data, { own: true });
  if (!own.ok) v.push(`枠 ${fx.frame}m が product の取り込み検査 (own) で落ちる（why=${own.why}）＝保存コース経路では適用されない治具（BC11 の再発）`);
  const std = acceptCourseData(fx.data, {});
  if (!std.ok) v.push(`枠 ${fx.frame}m が第三者データの基準 (std) で落ちる（why=${std.why}）`);
  // (3) グリッド整合
  const g0 = gridStart(fx.X, fx.Y);
  const n = (fx.frame - g0) / FRAME.step;
  if (!(n >= 0) || Math.abs(n - Math.round(n)) > 1e-6)
    v.push(`枠 ${fx.frame}m が探索グリッド（${g0}m から ${FRAME.step}m 刻み）の上に無い＝product に答えさせず値を書いた疑い`);
  // (4) 最小性: 1 段下は落ちること（落ちないなら、product が答えた下限より大きい枠を使っている）
  const below = r3(fx.frame - FRAME.step);
  if (below >= g0 && acceptCourseData({ ...fx.data, bounds: { w: below, h: below } }, { own: true }).ok)
    v.push(`枠 ${fx.frame}m は product が答えた下限より大きい（1 段下の ${below}m も受理される）＝product に答えさせず値を書いた疑い`);
  return v;
}
