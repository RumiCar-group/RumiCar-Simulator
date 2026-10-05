// ラップ計測＆スコア。
// 車体基準点がフィニッシュラインを正方向に横切るたびに周回を計上する。ただし逆向きに線を戻った車は、同じ回数だけ
// 順方向に通り直すまで数えない (＝回っていない周回を数えない。下の【BH3】)。

import { segIntersect } from './geom.js';
import { APP_VERSION, REGIME_STATE, PHYSICS, SENSOR_NOISE, SENSOR_OPTICS, SCALE_STATE, CAR_TYPE_BY_KEY, CAR } from './config.js';
import { safeSetItem } from './storage.js'; // AP4: 保存失敗を握りつぶさず可視化
import { fnv1a } from './fnv1a.js'; // v5.2.0: 葉モジュールへ統合 (旧ローカル複製と byte 一致・下記 AP2 注記参照)
import { courseShapeDigest } from './course_digest.js'; // BE2: 「同じコースか」は BD1 と同じ唯一の場所で決める (葉＝循環なし)
import { PRESETS } from './course.js';                  // BE2: 旧記録の採否に出荷コースの定義を使う (course.js は config.js だけに依存＝循環なし)

// ── 【BH3・2026-10-04】周回は「借り」で数える ─────────────────────────────────────────
// v9.0.0 までの計上は「武装していて (線の正側へ 0.25m 離れたことがある)・負側→正側へ・線分の中を通った」だけで、
// その間にコースを回ったかは見ていなかった。∴ **逆向きに線を戻ってもう一度順方向に通ると、回っていなくても 1 周**に
// なった (BH2 の実測: 線の前後を往復するだけのプログラムが公式レース 3 周を 10.5 秒で完走・出荷の公式サンプル大会の
// 1 位は 1 周していなかった・公式レースの母集団で完走と数えた車の 4.1% が回り切っていない周回を含む)。
//
// 数え方: フィニッシュ線を**逆向きに通るたびに借りが 1 増える**。順方向の通過は、借りがあればそれを返すだけで
//   数えず、**借りが 0 のときだけ 1 周**と数える。線の手前 (負側) から発走した車は、最初の順方向の通過を発走の通過として
//   数えない (車ごとに 1 回)。線の上か先 (正側) から発走した車は、最初の順方向の通過を 1 周目と数える (v9.0.0 までと同じ
//   規約。∴ スタートが線のずっと先にあるコースでは 1 周目が短い: 出荷「トライアングル」は 83%)。
//   数えた周回は減らない (sector.js・ghost_gap.js は laps が減らないことを前提にしている)。
//   **数える瞬間は従来と同じ** (走行中・負側→正側・移動線分がフィニッシュ線分と交差)。∴ v9.0.0 が正しく数えていた走り
//   (回り切っていない計上も数え漏れも無い走り) では、計上の tick・ラップタイムは 1 ビットも変わらない。
//   線分が 1 つの弦 (下記) に収まるコース (出荷の周回コース全部) では、数えた周回は巻き数
//   「順方向の通過 − 逆方向の通過 − 発走の通過」の最大と一致する。
// 武装 (線の正側へ armDist 離れる) は廃止した。借りが発走直後の二重計上を防ぐので要らず、残すと害がある:
//   ①武装は線の正側の半平面のどこでも立つので、線を一度も通っていない車がコースの向こう側で武装した
//   ②小さいコースの内側の線では武装距離に届かず、正しく回った周回がその時点で数えられなかった (BH2: 舵角限界ベンチの
//     道幅 3.5 台分の 3 本。後の踏み直しで遅れて数えるか、数えないまま終わる)。
//
// 線分の線の上を壁で区切る (弦):
//   借りは**弦ごと**に持つ。弦を切るのは、線を横切る壁・線に端点が触れる壁・線の上に寝た壁 (長さ 0 の壁は無視)。
//   フィニッシュ線分が壁を突き抜けて隣の走路に届くコース (投稿「レーシングコース」は線分が横へ 0.046m ずれている・
//   自作コース) や、線分の端が壁の頂点で、その先の線の延長を別の区間が横切るコース (出荷「モダン・レイアウト」) で、
//   隣の走路・別の区間の通過を自分の走路の借りに混ぜないため。ヘアピンの仕切りの先端が線に触れる自作コースでも、
//   先端の両側 (行きと戻りの走路) を分ける。
//   **線の一部** = 線分の中と、線分の端と壁の間の**車幅 (CAR.width＝通過の時点の実効寸法) 以下のすき間**。
//   そこを逆向きに通れば借りが増え、順方向に通れば借りを返す (数えはしない)。車が通り抜けられない幅は通路ではない:
//   線の一部にしないと、すき間を後退で抜けて線分を通り直す往復が 1 周になる。車幅より広いすき間 (線の横の通路) の
//   通過は借りに関わらない (そこが戻りの走路でありうる: 仕切りの先端より先に引いた線。壁に届かない線を置いた広場の
//   ようなコースでも周回を数えられなくしない)。すき間の幅は**線に沿って**測る (線分が壁に斜めに入るコースでは実際の
//   幅より長く測るので、通り抜けられない幅を通路とみなすことがある＝下の限界の 1 つ目の形になる)。
//   発走の通過 (線の手前から発走した車の最初の順方向の通過) は、線分の外でも同じ弦の中ならどこを通っても済む
//   (発走の通過がすき間や横の通路を通っても 1 周目が遅れない)。線分の外の順方向の通過そのものは従来どおり数えない。
//   限界 (線の通過の列だけでは区別できない):
//     ・線に触れる壁・線を横切る壁・線の上に寝た壁の端のまわり、線分の端 (車幅より広い通路がある場合) のまわりを
//       回る走りは 1 周と数える。ヘアピンの先端に線を引いたコースではそれが正しい 1 周であり、廊下の中の障害物の
//       まわりを小さく回る走りと区別できない。v9.0.0 までは線の先へ 0.25m 離れたときだけ数えたが、武装を廃止した
//       ので小さな回り方でも数える。
//     ・線分が向かいの走路 (逆向きに走る) まで**壁を挟んで**届くコースでは、逆向きの周回も数える (v9.0.0 までも同じ)。
//     ・線分が、間に壁の無い順方向と逆方向の 2 本の走路を 1 つの弦でまたぐコース (例: 中央の仕切りの先端より先で、
//       外壁から向かいの外壁まで引いた線) では、1 周のうちに順方向と逆方向に 1 回ずつ通るので 1 周も数えない
//       (v9.0.0 までは武装で数えていた)。フィニッシュ線は 1 本の走路だけを横切るように引く必要がある。
//     ・線分が走路を塞いでいないコース (線分の端と壁・仕切りの先端の間を車が通り抜けられる) では、線の横を通り抜けた
//       周は数えない (従来どおり)。通り抜けた後に切り返しで線分を「後ろ→前」と踏み直しても数えない (それは往復。
//       v9.0.0 はこの踏み直しを 1 周と数えたので、狭いヘアピンの出口に短い線を引いたコースでは周回が減る)。
//       フィニッシュ線は走路を壁から壁 (仕切り) まで塞ぐように引く必要がある。
//     ・線分を逆向きに通った後、線の横の通路 (線の一部でない所) を順方向に抜けた車は、次に線分を順方向に通るまで
//       借りが残る (その 1 周は数えない)。
//     ・線の上か先から発走した車の 1 周目は 1 周に満たない (上記)。そのタイムがベストラップ・練習ベストに残りうる
//       (トライアングルは 83%。6 台のグリッドの後ろの車が線の 1〜2.5 車長先に置かれるコースが 12 本ある)。
//
// 側の判定 (_signed):
//   線分と正方向 fx,fy が直交するコース (|e·f| ≤ SLANT_TOL·|e||f|。出荷の 64 本中 63 本と上流の投稿 2 本) は従来どおり
//   fx,fy で測る (式も値も不変)。直交しないコースは**線分の法線** (fx,fy 側) で測る＝画面に描かれている線を順方向に
//   通れば数える。fx,fy のままだと「fx,fy に垂直な線の符号変化」と「線分との交差」が同じ tick に起きたときしか
//   数えられない: 出荷「トライアングル」(start を辺の中ほどに明示・線分は頂点＝60° ずれ) は、正しく回っても 1 周も
//   数えられなかった (BH3 の実測: 線分を順方向 18 回／逆方向 7 回通過して計上 0 周)。
//   正方向が線分とほぼ平行なコース (向きを決められない) は従来どおり fx,fy のまま＝数えない。
//   限界: ずれが 0 でなく SLANT_TOL 以下のコース (投稿「レーシングコース」1.5e-5) は従来どおりなので、符号変化と
//   交差が別の tick に割れた通過は従来どおり数えない (ずれ 1.5e-5 で 1 万回に 1 回の桁・SLANT_TOL ちょうどで 0.1% の桁)。
const SLANT_TOL = 1e-4;   // 線分と正方向を「直交」とみなす |e·f|/(|e||f|) の上限 (＝それを超えたら線分の法線で測る)
const LINE_EPS = 1e-9;    // m: 壁の端点が線分の線の上にあるとみなす距離／これ以下の長さは 0 とみなす (線分・壁・弦と線分の重なり)

// フィニッシュ線分の幾何 (reset ごとに 1 回・壁の本数に比例)。
//   戻り値 { mx,my: 線分の中点・nx,ny: 側の判定の法線・tx,ty: 線分に沿う単位ベクトル・h: 線分の半分の長さ・
//            chords: 線分と重なる弦 [{ a,b: 弦の両端 (線分に沿う座標・中点が 0・壁が無ければ ±Infinity)・
//                                      lo,hi: 弦の中の線分・owe: 借り }] }
function finishGeometry(course) {
  const f = course.finish;
  const mx = (f.x1 + f.x2) / 2, my = (f.y1 + f.y2) / 2;
  const ex = f.x2 - f.x1, ey = f.y2 - f.y1, len = Math.hypot(ex, ey);
  const g = { mx, my, nx: f.fx, ny: f.fy, tx: 0, ty: 0, h: len / 2, chords: [] };
  if (!(len > LINE_EPS)) return g;   // 縮退した線分 (segIntersect が常に false) は従来どおり数えない
  const tx = ex / len, ty = ey / len, ux = -ty, uy = tx;   // 線分に沿う単位ベクトルと線分の単位法線
  g.tx = tx; g.ty = ty;
  const fl = Math.hypot(f.fx, f.fy);
  if (fl > 0) {
    const along = Math.abs(ex * f.fx + ey * f.fy) / (len * fl), across = (ux * f.fx + uy * f.fy) / fl;
    if (along > SLANT_TOL && Math.abs(across) > SLANT_TOL) { const sgn = across < 0 ? -1 : 1; g.nx = sgn * ux; g.ny = sgn * uy; }
  }
  // 壁が線分の線を切る位置 (線分に沿う座標)。線を横切る壁・端点が線に触れる壁・線の上に寝た壁 (両端)。
  const cuts = [];
  for (const w of (Array.isArray(course.walls) ? course.walls : [])) {
    if (!w) continue;
    const d1 = (w.x1 - mx) * ux + (w.y1 - my) * uy, d2 = (w.x2 - mx) * ux + (w.y2 - my) * uy;
    const v1 = (w.x1 - mx) * tx + (w.y1 - my) * ty, v2 = (w.x2 - mx) * tx + (w.y2 - my) * ty;
    if (!Number.isFinite(d1) || !Number.isFinite(d2) || !Number.isFinite(v1) || !Number.isFinite(v2)) continue;
    if (Math.hypot(w.x2 - w.x1, w.y2 - w.y1) <= LINE_EPS) continue;   // 長さ 0 の壁 (点) は何も塞がない＝切らない
    const on1 = Math.abs(d1) <= LINE_EPS, on2 = Math.abs(d2) <= LINE_EPS;
    if (on1) cuts.push(v1);
    if (on2) cuts.push(v2);
    if (!on1 && !on2 && (d1 < 0) !== (d2 < 0)) cuts.push(v1 + (v2 - v1) * (d1 / (d1 - d2)));   // 線を横切る壁
  }
  cuts.sort((p, q) => p - q);
  let a = -Infinity;
  for (let i = 0; i <= cuts.length; i++) {
    const b = i < cuts.length ? cuts[i] : Infinity;
    const lo = Math.max(a, -g.h), hi = Math.min(b, g.h);
    if (hi - lo > LINE_EPS) g.chords.push({ a, b, lo, hi, owe: 0 });
    a = b;
  }
  return g;
}

// 練習記録（非公式）のローカル保存キー（Stage W / W2・W_spec §0 二層モデル）。
// ソロ走行のベストラップは「練習（非公式）」記録として **コース×車種別** にこのブラウザへ保存する
// (公式記録=GitHub races/ とは別経路＝「公式と混入しない」)。車種で速さが変わるため車種別が正。
// 旧キー `rumicar.best.<course>` (コースのみ) は W2 で per-car へ移行（旧記録は再走で再生成）。
//
// 【BE2・2026-09-24】**「どのコースの記録か」を名前でなく形で決める。** W2〜v8.7.0 の鍵は
//   `rumicar.practice.<コース名>::<車種>` だった。名前は識別子であって形ではないので、**保存コースの壁だけを
//   編集して同じ名前で ✔適用すると、別レイアウトのベストが自分の記録として出た**（実ブラウザで再現: オーバルの
//   写しで 1 周 00:13.60 → 隅に壁を 1 本足して ✔適用 → HUD の BEST に 00:13.60）。BD1 が `capacity.js` で
//   直したのと同じ「名前＝同一性」の欠陥（BD-3(a)）。名前がプリセットと重複する自作コースも同じ鍵を奪い合っていた（BB-4 ⑤）。
//   新しい鍵は `rumicar.practiceShape.<形の指紋 16 桁>::<車種>`。旧キーの名前空間 `rumicar.practice.` とは
//   接頭辞が重ならない（`practice.` と `practiceShape.` は 9 文字目で分かれる）ので、どんな名前のコースでも衝突しない。
//   形の指紋は BD1 の `courseShapeDigest`（コースを丸ごと歩く）に、**名前と説明と格付けだけを抜いた**コースを渡したもの。
//   抜くのは下の RECORD_LABEL_KEYS だけ（＝名前を変えても・説明文を直しても・星の数を付け替えても同じ記録）。
//   **抜く側を列挙し、入れる側は列挙しない**: 将来コースに場が増えても自動で形に入る。列挙を誤った場合に
//   起きるのは「記録が見つからない」側（安全側）で、「別のコースの記録が出る」側ではない。
//   **数値は 1e-6 の格子へ丸めてから混ぜる**（`capacity.js` の覚え書きは丸めない＝あちらは「答えが変わりうるか」で
//   1e-12 の差も区別する。こちらは「利用者にとって同じコースか」）。理由: 出荷コースの壁は `buildFromSpec` が
//   `Math.sin/cos/hypot/atan2` で組み立てる倍精度で、ECMAScript はこれらの精度を実装に任せている（最下位ビットは
//   エンジン次第）。丸めずに混ぜると、バックアップ（`data_backup.js`）を別系統のブラウザへ移したときに出荷コースの
//   記録がまとめて見えなくなりうる（層 4 の 2 回目・2026-09-24 の指摘。別エンジンはこの環境に無いので、代わりに
//   出荷全コースの全数値を最下位ビットで ±1 ずらして測った: 丸めないと 66/66 本の指紋が変わり、1e-6 の格子では 0/132）。
//   丸め（乗算・`Math.round`・除算）は IEEE で結果が決まっているのでエンジンに依らない。`-0` は `+0` に揃える
//   （0 の両側に 1 ulp ずれた値が別の指紋になるのを防ぐ）。**残る限界**: 格子の境目から数 ulp 以内にある値は
//   エンジン差で隣の格子へ落ちうる（座標 数 m の値で 1 値あたりおおむね 1e-9 の桁。出荷コースの全 5.5 万値では境目に
//   最も近い値でも約 1.2 万 ulp 離れている＝層 4 の 3 回目の実測）。同じ 1e-6 の格子点に丸まる値どうしは同じコースとして
//   扱う（境目をまたぐ差は 1µm 未満でも別のコースになる。どちらも利用者にとっては同じコースだが、別になる側は安全側）。
const RECORD_LABEL_KEYS = new Set(['name', 'name_en', 'desc', 'desc_en', 'diff', 'beginner', 'bench']);
export function practiceCourseId(course) {
  const shape = {};
  for (const k of Object.keys(course || {})) if (!RECORD_LABEL_KEYS.has(k)) shape[k] = course[k];
  return courseShapeDigest(shape, 1e6);   // 1e-6 の格子で丸めて混ぜる（写しは作らない＝丸めは digest の数値の入口 1 箇所）
}
function bestKeyById(courseId, carType) { return 'rumicar.practiceShape.' + courseId + '::' + (carType || ''); }
// 旧キー（v8.7.0 まで）。**読むだけで書かない・消さない**（利用者の記録を失わない＝データ保全・`data_backup.js` の
// バックアップにもそのまま残る）。新しいベストは常に新しい鍵へ書く。
function legacyBestKey(courseName, carType) { return 'rumicar.practice.' + courseName + '::' + (carType || ''); }

// ── AP2: 練習ベスト記録の時点記録化（版・条件・定義ハッシュ＋移行）──────────────────
// FNV-1a 32bit は race_engine.js と共通の葉モジュール fnv1a.js から import する (v5.2.0 統合)。
// 旧実装は「lap→race_engine→fleet→lap の循環 import を避ける」ためローカル複製していた
// （定義ドリフトのリスクを「将来の統合候補」と注記）— 依存ゼロの葉に切り出したことで循環なしに
// 統合できた。アルゴリズム・出力は旧複製と byte 一致 = 既存の練習記録ハッシュは全て不変。

// コース定義の指紋。壁1本の移動・フィニッシュ/スタート位置・峠フラグの変化で必ず変わり、無編集の
// 再保存では不変（誤検知ゼロ）＝定義ドリフトの検出。値の配列で正規化（オブジェクト identity/キー順に
// 依存しない）・表示専用/派生フィールドは含めない。
// AV1: 常設ゲートが **実関数を呼んで** 「この指紋に何が含まれ、何が含まれないか」を測れるように
// export する（再実装＝CI-14 違反を避ける。physics_v2 の mfCoeffs/tireForceMF/effGrip と同じ扱い）。
// 挙動は一切変わらない（純関数・module 内の呼び出しもそのまま）。
// 【BE2・2026-09-24】**この関数の出力を変えてはならない**: v8.7.0 までの旧記録の採否（下の loadBestRec の (a)）が、
//   記録が保存時点で持つこの値と今の値を比べる。変えると出荷コースの AP2 以降の旧記録がすべて見えなくなる
//   （`wf_be2_practicekey` の P) が出荷全コースの値を凍結して測る）。AV1-e1（路面を含まない穴）を塞ぐなら別の関数を足すこと。
export function courseHashOf(course) {
  if (!course) return '00000000';
  const walls = (course.walls || []).map(w => [w.x1, w.y1, w.x2, w.y2]);
  const f = course.finish;
  const fin = f ? [f.x1, f.y1, f.x2, f.y2, f.fx, f.fy] : null;
  const st = course.start ? [course.start.x, course.start.y, course.start.theta] : null;
  return fnv1a(JSON.stringify({ w: walls, f: fin, s: st, touge: !!course.touge }));
}

// 車種定義の指紋。速さを左右する物理パラメータを **固定キー順** でハッシュ（車種上書きで params が
// 変われば変わり、同一 params の再登録では不変＝誤検知ゼロ）。name/key は識別子（キーに含む）ゆえ除外。
const CAR_HASH_KEYS = ['mass', 'yawGain', 'us', 'os', 'powerUs', 'powerOs', 'liftOffOs', 'brakeOs', 'spin', 'accel', 'brake', 'maxSpeed', 'slide'];
const DRIFT_HASH_KEYS = ['trigger', 'grip', 'gain', 'brakeDrift', 'minSp', 'slipYaw', 'slipSlide', 'attack', 'release'];
function carHashOf(carType) {
  const ct = CAR_TYPE_BY_KEY[carType];
  if (!ct) return fnv1a('?' + (carType || ''));
  const base = CAR_HASH_KEYS.map(k => ct[k]);
  const drift = ct.drift ? DRIFT_HASH_KEYS.map(k => ct.drift[k]) : null;
  return fnv1a(JSON.stringify({ p: base, d: drift }));
}

// 保存時点の走行条件スナップショット（版跨ぎ比較の誤解を防ぐ）。regime/physics/noise/carScale は
// config の live 大域・tire/wear は reset で渡された slot 装備・course/car ハッシュは上記。
function captureCond(carType, tire, wear, course, gear) {
  return {
    regime: REGIME_STATE.active,
    physics: PHYSICS.mode,
    tire: tire || 'normal',
    gear: gear || 'direct',       // AS9: ギア比 (任意装備)。tire/wear と同型に条件へ刻む (直結=既定)。
    wear: !!wear,
    noise: !!SENSOR_NOISE.on,
    optics: !!SENSOR_OPTICS.on,   // AS8: ToF 光学モデル (noise と同じく「読める値」を変えるので条件に刻む)。
                                  //   ※ SENSOR_HOLD (更新遅延) は AP18 以来ここに無い=既存の記録漏れ (AS8 では拡げない・AS8_tof.md §6)。
    carScale: SCALE_STATE.userK,
    courseHash: courseHashOf(course),
    carHash: carHashOf(carType),
  };
}

// 記録の読取（3系対応・W2→AP2 移行）: 新スキーマ JSON {t,ver,cond} / 旧スキーマ裸数値 / 破損。
// 破損・非有限・負値は null（=記録なし扱い＝再樹立を許す）。旧実装は `+v` が JSON 文字列に NaN を
// 返し、比較 `< NaN` が恒常 false になってベスト更新が永久停止するハザードがあった（AP2 で是正）。
function parseRec(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === '') return null;
    const s = raw.trim();
    if (s.charCodeAt(0) === 123) {   // 0x7B '{' = 新スキーマ JSON
      const o = JSON.parse(s);
      // t は本物の正の数のみ有効。`+o.t` の暗黙変換だと t:null→0・t:[]→0 等が「0 秒記録」として
      // 通り抜け、どのラップも 0 に勝てず永久固着する（NaN 固着と同型のハザード）→ typeof で弾く。
      const t = o.t;
      if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) return null;
      return {
        t,
        ver: (typeof o.ver === 'string' && o.ver) ? o.ver : null,
        cond: (o.cond && typeof o.cond === 'object') ? o.cond : null,
      };
    }
    const t = +s;   // 旧スキーマ = 裸の数値（W2 以前・未スタンプ）。0/負/非有限は記録なし扱い。
    if (!Number.isFinite(t) || t <= 0) return null;
    return { t, ver: null, cond: null };
  } catch (e) { return null; }
}

// 【BE2】コース（オブジェクト）× 車種の練習ベスト。**引数は名前でなくコースそのもの**（名前では形が決まらない）。
//   ① 新しい鍵（形の指紋）に記録があればそれ。
//   ② 無ければ旧キー（名前）を読み、**形が同じだと言えるときだけ**採る:
//      (b) 今のコースが**同名の出荷コースと中身まで同一**（`practiceCourseId` が一致）であること。必須。
//      (a) 記録に `cond.courseHash`（AP2 以降の記録が保存時点で持つ `courseHashOf`＝壁・フィニッシュ・スタート・
//          峠フラグの指紋）があるなら、今のコースの `courseHashOf` と一致すること（**別レイアウトの証拠があれば採らない**）。
//          AP2 以前の記録（裸の数値・スタンプ無し JSON）には証拠が無いので (b) だけで採る — 改修前も表示していた記録で、
//          チャレンジは従来どおり「版スタンプ無し」と断って数える（`challenge.js` の stale）。層 4（2026-09-24）の指摘:
//          初版は (a) を必須にしたため、出荷コースの AP2 以前の記録が消え、チャレンジのバッジが後退した。
//      なぜ (b) が要るか: `courseHashOf` は枠・路面・グリップ・バンク・峠の勾配を含まない（AP2 以来の穴・AV1-e1）ので、
//      (a) だけでは同名・同じ壁で路面だけ変えた自作コースに旧記録が出る（BE2 の常設ゲート B) が初版で検出）。
//      自作・投稿コースは**同じ版の中で**中身が変わりうる（本件そのもの）ので、旧記録からは形を証明できない。
//      出荷コースの中身が版を跨いで変わった分は、記録の版スタンプ（`ver`＝HUD の「(当時 vX)」）が開示する
//      ＝過去の記録を当時の版の記録として正直に出す方針（CLAUDE.md）の範囲。
//      **限界（正直に書く）**: 旧版で出荷コースをエディタに開き、壁を変えずに ✔適用したコース（エディタは
//      `name/bounds/start/finish/walls` しか持たないので、路面・グリップ・バンクが外れる）で出した記録は、
//      名前も壁も同じなので出荷コースの旧記録と区別できない（雨の出荷コースでは乾いた路面の記録が採られうる）。
//      旧形式が持つ情報ではこれ以上絞れない。新しい鍵ではこの取り違えは起きない（形を全部含む）。
//      **採らない旧記録は自分の記録として出さない**（消しもしない＝旧キーは byte 不変で残り、バックアップにも入る）:
//      自作・投稿コースの旧記録・`courseHash` が今のコースと違う記録。
//   ①が②より遅いことは通常無い: ②を読んだ走行でベストを出すと、②より速いときだけ①へ書かれる（lap.update）。
//      例外は (b) の判定が後から変わる場合（出荷コースの定義が変わった・`courses.json` を読めず組込みの既定に落ちた）で、
//      そのときは①があれば①が出る（②は読まれない）。
// **memo**（`{}`）を渡すと、そのコースの指紋 `id` と `courseHashOf` の値 `hash` をそこへ覚えて使い回す
// （同じコースを車種の数・台数ぶん引く呼び出し側用。**1 つの memo は 1 つのコースにだけ使うこと**）。
export function loadBestRec(course, carType, memo = null) {
  if (!course || typeof course !== 'object') return null;   // 名前（文字列）を渡す旧呼び出しは記録なし扱い＝取り違えない
  const m = memo || {};
  if (m.id == null) m.id = practiceCourseId(course);
  const rec = parseRec(bestKeyById(m.id, carType));
  if (rec) return rec;
  const old = parseRec(legacyBestKey(course.name, carType));
  if (!old || shippedIdOf(course.name) !== m.id) return null;                        // (b) 同名の出荷コースと同一
  const h = old.cond && old.cond.courseHash;
  if (typeof h === 'string') {                                                       // (a) 別レイアウトの証拠
    if (m.hash == null) m.hash = courseHashOf(course);
    if (h !== m.hash) return null;
  }
  return old;
}

// 同名の出荷コースの形の指紋（無ければ null）。出荷コースは起動時に `loadPresets` が 1 回だけ組み直す
// （組み直すと関数が作り直される）ので、**組み立て関数ごと**に覚える＝組み直し後に古い値を返さない。
// 旧記録がある組み合わせでしか呼ばれない（① に記録があれば・旧キーが空なら呼ばない）。
const _shipped = new WeakMap();
function shippedIdOf(name) {
  for (const f of PRESETS) {
    let e = _shipped.get(f);
    if (!e) { const c = f(); e = { name: c.name, id: practiceCourseId(c) }; _shipped.set(f, e); }
    if (e.name === name) return e.id;
  }
  return null;
}

// 数値シグネチャ維持（既存呼び出し互換・main.js のコースレコード等）。記録タイム t のみ返す。
export function loadBest(course, carType) {
  const rec = loadBestRec(course, carType);
  return rec ? rec.t : null;
}

export class LapTracker {
  constructor(course, opts) { this.reset(course, opts); }

  // opts.carType: 練習記録のキーに使う車種 (コース×車種別)。opts.persist: 練習ベストを localStorage に
  // 読み書きするか (既定 true=ソロ練習走行)。**公式レース(race_engine)は persist:false** で練習記録に
  // 一切書き込まない (W_spec §0「公式と混入しない」)。persist=false では bestLap=null (ローカル非依存)。
  reset(course, opts = {}) {
    this.course = course;
    this.carType = opts.carType || '';
    this._tire = opts.tire || 'normal';   // AP2: 記録に刻む条件（v2 タイヤセット）。既定 normal。
    this._wear = !!opts.wear;             // AP2: 同（タイヤ摩耗 opt-in）
    this._gear = opts.gear || 'direct';   // AS9: 同（ギア比 任意装備）。既定 direct=直結。
    this.persist = opts.persist !== false;
    this.finish = course.finish || null;
    this._geo = this.finish ? finishGeometry(course) : null;   // BH3: 側の判定の法線と弦 (借りは弦ごと)
    this._start = false;     // BH3: 線の手前から発走した車の「発走の通過」がまだか (最初の update で決める)
    this.touge = !!course.touge;   // 峠モード: スタート→ゴールの1回計測
    this.finished = false;         // 峠モードでゴール済みか
    this.laps = 0;
    this.crashes = 0;
    this.lapTime = 0;        // 現在ラップ経過 (s)
    this.totalTime = 0;      // 累計 (s)
    this.lastLap = null;     // 直近ラップタイム / 峠=ゴールタイム (s)
    // AP2: 記録全体（{t,ver,cond} or null）を読む。persist:false（公式レース）は localStorage を
    // 一切参照せず null＝従来と byte 完全一致（公式非干渉）。bestLap は数値のまま（表示/比較互換）。
    // BE2: 記録の鍵（形の指紋）はここで 1 回だけ決め、_saveBest も同じ値を使う（読んだ鍵と書く鍵を割らない）。
    //   opts.memo: 同じコースで何台も reset する呼び出し側（rebuildSpawns・startAuto）が 1 つ渡すと指紋の計算が 1 回で済む。
    const memo = this.persist ? (opts.memo || {}) : null;
    const rec = this.persist ? loadBestRec(course, this.carType, memo) : null;
    this._courseId = this.persist ? memo.id : null;
    this.bestLap = rec ? rec.t : null;
    this.bestRec = rec;              // AP2: 当時版注記（(当時 vX)）の元
    this.lastBestLap = this.bestLap; // 走行開始時点の記録 (比較用)
    this.prev = null;        // 前フレームの基準点
    this.improved = false;   // 今回の走行でベスト更新したか
  }

  // 符号付きライン距離: 正方向側で正。法線は reset で決めたもの (直交するコースは fx,fy＝従来と同じ式・同じ値。BH3)。
  _signed(px, py) {
    const g = this._geo;
    return (px - g.mx) * g.nx + (py - g.my) * g.ny;
  }

  // BH3: 移動線分 prev→(x,y) が線分の線を横切った位置の弦。そこが線の一部かを this._cg に置く。
  //   inSeg (線分そのものと交差) なら線分に最も近い弦、そうでなければその位置を含む弦 (無ければ null＝線分と重ならない弦)。
  _chordAt(prev, x, y, s, inSeg) {
    const g = this._geo, k = prev.s / (prev.s - s);   // 符号が変わった移動なので分母は 0 にならない
    let v = (prev.x + (x - prev.x) * k - g.mx) * g.tx + (prev.y + (y - prev.y) * k - g.my) * g.ty;
    if (inSeg) v = v < -g.h ? -g.h : (v > g.h ? g.h : v);
    this._cg = false;
    let best = null, bd = Infinity;
    for (const c of g.chords) {
      if (v >= c.a && v <= c.b) { best = c; break; }
      if (inSeg) { const d = v < c.lo ? c.lo - v : v - c.hi; if (d < bd) { bd = d; best = c; } }
    }
    if (best) {   // 線の一部か: 線分の中、または線分の端と壁の間の車幅以下のすき間 (車が通り抜けられない幅)
      const G = CAR.width;
      this._cg = inSeg || (v >= (best.lo - best.a <= G ? best.a : best.lo) && v <= (best.b - best.hi <= G ? best.b : best.hi));
    }
    return best;
  }

  // 走行中に毎フレーム呼ぶ。dt 秒、(x,y)=基準点。戻り値: ラップ計上(峠=ゴール)で true。
  update(dt, x, y, running) {
    if (!this.finish) return false;
    if (running && !this.finished) { this.lapTime += dt; this.totalTime += dt; }
    const s = this._signed(x, y);
    if (!Number.isFinite(s)) return false;   // BH3: 位置が NaN・無限大の tick は飛ばす (次の有効な位置を直前の有効な位置と比べる。峠も同じ)
    if (this.prev == null) {
      this.prev = { x, y, s };
      this._start = s < 0;   // BH3: 線の手前から発走＝最初の順方向の通過は発走の通過 (車ごとに 1 回)
      return false;
    }

    let lapped = false;
    if (this.touge) {
      // 峠: スタート→ゴールを1回。ゴールライン通過でタイム確定(ベスト保存)。
      if (running && !this.finished && this.prev.s < 0 && s >= 0 && this._crossesSegment(this.prev, { x, y })) {
        this.finished = true; this.laps = 1; this.lastLap = this.totalTime;
        if (this.bestLap == null || this.totalTime < this.bestLap) {
          this.bestLap = this.totalTime; this.improved = true;
          if (this.persist) this._saveBest();
        }
        lapped = true;
      }
    } else if ((this.prev.s < 0) !== (s < 0)) {
      // BH3: 線分の線を横切った。逆方向は、線の一部を通ったら借りを 1 増やす。順方向は、線の一部を通れば借りを 1 返す
      //   (数えない)・借りが無くて発走の通過がまだならそれを済ませる (弦の中ならどこでも・数えない)・どちらも無くて
      //   線分の中を通ったら 1 周 (自動走行中のみ計上)。冒頭の【BH3】。
      const inSeg = this._crossesSegment(this.prev, { x, y });
      const c = this._chordAt(this.prev, x, y, s, inSeg);
      if (c && this.prev.s < 0) {
        if (c.owe > 0 && this._cg) c.owe -= 1;
        else if (this._start) this._start = false;
        else if (running && inSeg) {
          this.laps += 1;
          this.lastLap = this.lapTime;
          if (this.bestLap == null || this.lapTime < this.bestLap) {
            this.bestLap = this.lapTime; this.improved = true;
            if (this.persist) this._saveBest();
          }
          this.lapTime = 0;
          lapped = true;
        }
      } else if (c && this._cg) c.owe += 1;
    }
    this.prev = { x, y, s };
    return lapped;
  }

  // 【BH5】基準点を (x,y) へ置き直すと、フィニッシュ線の線を順方向 (負側→正側) に越えるか。**読むだけ** (状態は変えない)。
  //   update と同じ側の式 (_signed)・同じ「直前の位置」(prev) で答えるので、偽を返した位置で update を呼んでも順方向の分岐
  //   (周回の計上・発走の通過・借りの返済・峠のゴール) には入らない。線分の外で線を越える場合も真。まだ update を 1 度も
  //   呼んでいない・フィニッシュが無いときは偽。fleet.js の逆走の向き直しが、置き直す姿勢を選ぶために読む。
  crossesForwardTo(x, y) {
    if (!this.finish || this.prev == null) return false;
    const s = this._signed(x, y);
    return !Number.isFinite(s) || (this.prev.s < 0 && !(s < 0));
  }

  // AP2: 新スキーマで書込（t/ver/cond）。cond は保存時点のライブ条件を捕捉（版跨ぎ比較の誤解を防ぐ）。
  // this.bestRec も現行版へ同期＝ベスト更新直後は「(当時 vX)」注記が消える（現行で樹立ゆえ）。
  _saveBest() {
    const cond = captureCond(this.carType, this._tire, this._wear, this.course, this._gear);
    const rec = { t: this.bestLap, ver: APP_VERSION, cond };
    this.bestRec = rec;
    safeSetItem(bestKeyById(this._courseId, this.carType), JSON.stringify(rec), 'best'); // AP4: 失敗は 1 行通知・BE2: 形の鍵
  }

  // 移動線分 prev→cur が フィニッシュ線分と交差するか
  _crossesSegment(prev, cur) {
    const f = this.finish;
    return segIntersect(prev, cur, { x: f.x1, y: f.y1 }, { x: f.x2, y: f.y2 });
  }

  addCrash() { this.crashes += 1; }
}

// 経過秒を mm:ss.cc に整形。整数センチ秒へ一度だけ丸めてから分解するので、秒桁は
// 構造的に 0..59 に収まり ":60" は表現できない (旧実装は s%60 を後から toFixed(2) で
// 丸めたため 59.996→"60.00" の桁上がり崩れがあった・GitHub #26 §C7)。非有限・負値は
// 一括で「データ無し」セントネルへ (旧実装は NaN/Infinity/負値が素通りしていた)。
export function fmtTime(s) {
  if (s == null || !Number.isFinite(s) || s < 0) return '--:--.--';
  const cs = Math.round(s * 100);     // 総センチ秒 (丸めはここ1回だけ)
  const m = Math.floor(cs / 6000);
  const r = cs % 6000;                 // 0..5999 ⇒ 秒桁=floor(r/100) は常に 0..59
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(m)}:${p2(Math.floor(r / 100))}.${p2(r % 100)}`;
}
