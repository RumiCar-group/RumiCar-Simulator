// Stage AZ2 常設ゲート (利用者投稿コースで露見・CI-14「判定基準は代理量でなく実態」)。
//
// 守る不変条件: **フィットガードが落ち着いた先では、必ず実態収容 capN ≥ 1 である**
//   （= 車が壁の中に湧いたまま留まらない）。
//
// 背景（実測 2026-09-12・利用者投稿コース 富士スピードウェイ: 外形 18.36×18.71m・壁 366 本・
// スタート地点の廊下幅 0.300m）:
//   ・代理量 target = 0.25×外形最小辺 = 4.59m は 車長 3.80m を「収まる」と言う ⇒ enforceFitRatio ②
//     （fullscale→卓上の自動復帰）が発火しない。
//   ・④ は carScale を下限 0.4 まで縮めるが、廊下 0.300m < 車幅 0.64m なので無駄。
//   ・⑤ は `while (capN > 1 && …)` と書かれていたため capN=0 を表現できず、**嘘の capN=1 を名乗る**。
//   ⇒ 6 台全部が壁の中に湧く（minClearance −133mm）。
//   しかも **より過大な carScale 2/4 は代理量が過大と判定するので ② が救う** ＝ 軽度の過大だけが壊れる、
//   という「代理量と実態の乖離」の典型的な署名だった。
//
// 検査（本物のオラクルを使う・再実装しない = CI-9）:
//   A) 出荷コース × 3 領域 × 6 carScale の全格子で **旧ロジックと新ロジックの落ち着き先を突き合わせ**、
//      変化したセルを全件列挙する。許すのは「旧が壊れていた (実態 capN=0) セルの救済」だけ。
//   B) 同じ全格子で、**新ロジックの落ち着き先の実態 capN ≥ 1**。
//   C) 「外形は広いが廊下が狭い」合成コースで、**旧は壊れ（capN=0 に落ち着く）・新は救済される**。
//      これが赤くならないなら欠陥を再現できていない＝この検査は何も守っていない（反証条件の固定）。
//   D) 構造検査: product 側（main.js / fleet.js）に「1 台は必ず置ける」仮定が戻っていないこと。
//
// ⚠ **本ゲートの射程（2026-09-12・層 4 レビューの指摘を受けて正直に書き直した）**
//   本ゲートは `enforceFitRatio` が DOM 結合で node から呼べないため、判定順序の**写し**（下の
//   `settle()`）を動かしている。∴ **A)〜C) は product の main.js を 1 行も実行しない。**
//   さらに ④' は出荷コースでは一度も発火しないので、A)/B) の 1188 セルは「既存挙動が変わっていない
//   ことの確認」であって、新ロジックの実行ではない。新ロジックを実際に動かすのは C) の治具（写しの上）と、
//   **`browser/check_az2_fitguard.mjs`（実ブラウザ・本物の main.js）＝そちらが本命**である。
//   D) はその隙間を埋める構造検査だが、正規表現である以上「呼ばれる関数の中身の意味変更」や
//   「テキストを保った並べ替え」は捕まえられない。**このゲートが緑であることを「product が正しい」の
//   証明として使わないこと。**
//   E) 性能: 追加された実オラクル呼び出しが **正常コースでゼロ** であること（④ の戻り値で短絡する設計）と、
//      最悪ケースの実測 ms。
import fs from 'fs';
import { buildFromSpec, normalizeCourse } from './public/js/course.js';
import { fitsAllCars, capacityOf } from './public/js/fleet.js';
import { setCarScale, setRegimeScale, CAR, FLEET, REGIMES } from './public/js/config.js';

const specs = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
const kL = (r) => REGIMES[r].L / REGIMES.tabletop.L;
const REG = ['tabletop', 'midscale', 'fullscale'];
const SCALES = [0.4, 0.5, 0.8, 1, 2, 4];
const MAXN = FLEET.maxCars;
const PERF_BUDGET_MS = 50;   // UI が体感で止まらない目安（受け入れ基準）

let pass = true;
const report = (label, arr, n = 10) => {
  console.log(`  ${arr.length === 0 ? '○' : '✗'} ${label}: ${arr.length} 件`);
  arr.slice(0, n).forEach(s => console.log(`       - ${s}`));
  if (arr.length > n) console.log(`       … 他 ${arr.length - n} 件`);
  if (arr.length) pass = false;
};

// ── オラクルのキャッシュ（本物を呼んだ結果を覚えるだけ。再実装はしない）──────────────
// これは**ゲート内だけ**の高速化。product 側にキャッシュは入れていない。
// 【2026-09-12 是正】当初この理由を「course_editor.js が course.walls を in-place で書き換えるから」と
// 書いたが **誤りだった**（層 4 レビューの指摘を一次情報で再確認）。実際は
//   course_editor.js:57  this.course = normalizeCourse(JSON.parse(JSON.stringify(course)));  ← 深いコピー
//   course_editor.js:210 result() { return normalizeCourse(this.toJSON()); }                 ← 新オブジェクト
// で、編集器は**自分の複製**だけを書き換える。∴ ライブの course はオブジェクト同一性で鍵にできる。
// それでも product に入れないのは別の理由:
//   ① 入れる必要が無い — ④' は ④ の戻り値で短絡するので、追加の実オラクル呼び出しは
//      「卓上以外 × ④ が収まると言い切れなかった」セルに限られ、卓上（利用者の既定）では 0 回。
//   ② キャッシュは「いつ無効化するか」を新しく正しく保ち続ける義務を生む。今回の欠陥自体が
//      「暗黙の前提が古くなっても誰も気づかない」型なので、必要になるまで作らない。
// 実測の根拠は下の E 節（ms と呼び出し回数）。
const memo = new Map();
let oracleCalls = 0;                        // product が実際に払う「論理呼び出し」回数
const fitsM = (c, cid, n) => {
  oracleCalls++;
  const k = `f|${cid}|${CAR.length.toFixed(6)}|${n}`;
  if (memo.has(k)) return memo.get(k);
  const v = fitsAllCars(c, n);
  memo.set(k, v); return v;
};
// capM は**計測用にも使う**ので呼び出し回数を数えない。product が ⑤ で払う分は、
// capacityOf が実際に行う fitsAllCars の回数 (maxN→結果まで降りる) を呼び出し側で加算する。
const capM = (c, cid) => {
  const k = `c|${cid}|${CAR.length.toFixed(6)}`;
  if (memo.has(k)) return memo.get(k);
  const v = capacityOf(c, MAXN);            // 本物の共有オラクル（0 を返せる）
  memo.set(k, v); return v;
};
const capCost = (v) => (v >= 1 ? MAXN - v + 1 : MAXN);   // capacityOf 1 回が払う fitsAllCars 回数

// ── main.js enforceFitRatio ①〜⑤ の判定順序の写し ────────────────────────────────
// az2=false で改修前、az2=true で改修後。短絡評価の有無まで product に合わせる。
function settle(course, cid, regime0, userK0, az2) {
  const b = course.bounds, minDim = Math.min(b.w, b.h);
  const target = 0.25 * minDim;
  const noRace = course.noRace === true;
  let regime = regime0, userK = userK0;
  const apply = () => { setRegimeScale(kL(regime)); setCarScale(userK); };
  apply();

  if (noRace && minDim >= 50 && regime !== 'fullscale') { regime = 'fullscale'; apply(); }          // ①
  if (!noRace && regime === 'fullscale' && CAR.length > target) { regime = 'tabletop'; apply(); }   // ②

  const clampByProxy = () => {                                                                      // ③
    if (!(CAR.length > target) || !(userK > 0)) return;
    const lenAtUserK1 = CAR.length / userK;
    const newUserK = Math.max(0.4, Math.floor((target / lenAtUserK1) * 10) / 10);
    if (newUserK < userK) { userK = newUserK; apply(); }
  };
  const clampByFit = () => {                                                                        // ④
    if (!(userK > 0.4 + 1e-9)) return null;   // 呼んでいない以上「収まる」とは言えない（不明）
    if (!fitsM(course, cid, MAXN)) {
      while (userK > 0.4 + 1e-9 && !fitsM(course, cid, MAXN)) {
        userK = Math.max(0.4, Math.round((userK - 0.1) * 10) / 10);
        apply();
      }
      return null;
    }
    return true;
  };
  clampByProxy();
  const fits6 = clampByFit();

  if (az2 && !noRace && regime !== 'tabletop' && fits6 !== true && !fitsM(course, cid, 1)) {        // ④'
    regime = 'tabletop'; apply();
    clampByProxy();
    clampByFit();
  }

  let reported;                                                                                     // ⑤
  if (az2) {
    reported = capM(course, cid);
    oracleCalls += capCost(reported);   // product が capacityOf の中で払う実オラクル回数
    if (reported < 1) reported = 1;   // 0 台は表示できないので 1 に留める（product は同時に警告を出す）
  } else {
    reported = MAXN;
    while (reported > 1 && !fitsM(course, cid, reported)) reported--;
  }
  return { regime, userK, len: CAR.length, reported, trueCap: capM(course, cid) };
}

// ── 治具: 「外形は広いが廊下が狭い」コース（投稿コースの性質を最小構成で再現）───────────
// **閉じた**幅 0.30m の廊下であることが肝。初版は「広い箱の中に壁を 2 本」にしたため廊下の外に
// 空きが残り、freeSpawn がそこへ置けてしまって**欠陥を再現できなかった**（実測で判明し是正）。
// 走れる場所が廊下だけなら、外形 18×18m（代理量 target=4.50m）は「車長 3.80m は収まる」と言うのに
// 実際には 1 台も置けない = 投稿コース（外形 18.36×18.71m・廊下 0.300m）と同じ性質になる。
function narrowCorridorFixture() {
  const W = 18.0, H = 18.0, gap = 0.30, yc = 9.0, xa = 1.0, xb = 17.0;
  const walls = [
    { x1: xa, y1: yc - gap / 2, x2: xb, y2: yc - gap / 2 },
    { x1: xb, y1: yc - gap / 2, x2: xb, y2: yc + gap / 2 },
    { x1: xb, y1: yc + gap / 2, x2: xa, y2: yc + gap / 2 },
    { x1: xa, y1: yc + gap / 2, x2: xa, y2: yc - gap / 2 },
  ];
  return normalizeCourse({ name: 'AZ2 fixture: wide frame / closed narrow corridor', walls, bounds: { w: W, h: H }, start: { x: 2.0, y: yc, theta: 0 } });
}

console.log('Stage AZ2 フィットガード・ゲート — 落ち着いた先で実態収容 capN ≥ 1 を守る');
console.log('='.repeat(78));

// ── A) / B) 出荷コースの全格子 ────────────────────────────────────────────────────
const badChange = [], rescued = [], capZero = [], callDelta = [];
let cells = 0, callsOld = 0, callsNew = 0;
for (let ci = 0; ci < specs.length; ci++) {
  let course; try { course = buildFromSpec(specs[ci]); } catch { continue; }
  for (const r of REG) for (const uk of SCALES) {
    cells++;
    oracleCalls = 0; const oldS = settle(course, ci, r, uk, false); const cOld = oracleCalls; callsOld += cOld;
    oracleCalls = 0; const newS = settle(course, ci, r, uk, true);  const cNew = oracleCalls; callsNew += cNew;
    const tag = `${specs[ci].name}|${r}|cs${uk}`;
    // AZ2 が 1 セルで増やしてよいのは「実態 capN=0 か判定するための fitsAllCars(course,1)」1 回まで。
    // 卓上（利用者の既定領域）では ④' が構造的に発火しないので増分は必ず 0 でなければならない。
    if (cNew - cOld > 1) callDelta.push(`${tag}: +${cNew - cOld} 回（1 回を超えて増えた）`);
    if (r === 'tabletop' && cNew !== cOld) callDelta.push(`${tag}: 卓上なのに増分 ${cNew - cOld} 回（④' は卓上で発火しないはず）`);
    const moved = oldS.regime !== newS.regime || Math.abs(oldS.userK - newS.userK) > 1e-9 || oldS.reported !== newS.reported;
    if (moved) {
      const line = `${tag}: 旧 ${oldS.regime}/cs${oldS.userK}/capN${oldS.reported}(実${oldS.trueCap}) → 新 ${newS.regime}/cs${newS.userK}/capN${newS.reported}(実${newS.trueCap})`;
      if (oldS.trueCap < 1 && newS.trueCap >= 1) rescued.push(line); else badChange.push(line);
    }
    if (newS.trueCap < 1) capZero.push(`${tag}: 新でも実態 capN=0 (${newS.regime}/cs${newS.userK}/len${newS.len.toFixed(3)})`);
  }
}
console.log(`\nA/B) 出荷 ${specs.length} コース × ${REG.length} 領域 × ${SCALES.length} carScale = ${cells} セル`);
report('A) 救済ではない挙動変化（既存の既定挙動を変えたセル）', badChange);
console.log(`  ${rescued.length === 0 ? '○' : '◇'} 救済として許容した変化: ${rescued.length} 件`);
rescued.slice(0, 10).forEach(s => console.log(`       - ${s}`));
report('B) 新ロジックの落ち着き先で実態 capN=0 が残ったセル', capZero);

// ── C) 反証治具 ────────────────────────────────────────────────────────────────
const fx = narrowCorridorFixture();
const fxBroken = [], fxUnrescued = [];
for (const r of REG) for (const uk of SCALES) {
  const oldS = settle(fx, 'fx', r, uk, false);
  const newS = settle(fx, 'fx', r, uk, true);
  if (oldS.reported >= 1 && oldS.trueCap < 1) fxBroken.push(`${r}|cs${uk}: 旧は capN=${oldS.reported} と名乗るが実態 0（${oldS.regime}/cs${oldS.userK}）`);
  if (newS.trueCap < 1) fxUnrescued.push(`${r}|cs${uk}: 新でも実態 capN=0（${newS.regime}/cs${newS.userK}）`);
}
console.log(`\nC) 治具「外形 18×18m・廊下 0.30m」 ${REG.length * SCALES.length} セル`);
console.log(`  ${fxBroken.length > 0 ? '○' : '✗'} 旧ロジックが壊れることを再現: ${fxBroken.length} 件`);
fxBroken.slice(0, 6).forEach(s => console.log(`       - ${s}`));
if (fxBroken.length === 0) { console.log('       ✗ 欠陥を再現できていない＝この検査は何も守っていない'); pass = false; }
report('C) 新ロジックでも救済されなかったセル', fxUnrescued);

// ── D) 構造検査 ────────────────────────────────────────────────────────────────
// **コメントを剥がしてから照合する。** 剥がさないと「注記に文字列が残っているだけ」で真になり、
// 実装を消す変異（例: capZeroWarn の出し分け削除）を見逃す（層 4 レビュー 2026-09-12 の実測指摘）。
// 素朴な除去なので、行内に `://` を含む行（URL）は保守的に丸ごと残す＝誤って消さない側へ倒す。
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => (/:\/\//.test(l) ? l : l.replace(/\/\/.*$/, ''))).join('\n');
// 関数本体を切り出して、その中だけを見る（別の場所の同名文字列に釣られないため）。
const bodyOf = (src, header) => {
  const i = src.indexOf(header); if (i < 0) return '';
  const j = src.indexOf('\n}', i); return j < 0 ? src.slice(i) : src.slice(i, j + 2);
};

// 構造条件。**F) がこの関数に変異ソースを食わせて「ちゃんと赤くなるか」を検査する**ので、
// 判定はここ 1 箇所にまとめる（検査の二重実装を作らない）。
function checkStructural(mainRaw, fleetRaw) {
  const mainSrc = strip(mainRaw), fleetSrc = strip(fleetRaw);
  const capBody = bodyOf(fleetSrc, 'export function capacityOf');
  const v = [];
  // --- 共有オラクル capacityOf が「0 を返せる」こと ---
  if (!capBody) v.push('fleet.js に capacityOf の定義が無い（共有オラクルが消えた）');
  if (!/while\s*\(\s*n\s*>=\s*1\s*&&\s*!fitsAllCars\(\s*course\s*,\s*n\s*\)\s*\)\s*n--;/.test(capBody))
    v.push('capacityOf が 0 まで下げる走査（while (n >= 1 && !fitsAllCars(course, n)) n--;）を持っていない');
  if (!/\breturn n;/.test(capBody))
    v.push('capacityOf が n をそのまま返していない（戻り値に丸めが入ると「1 台は必ず置ける」の嘘が戻る）');
  if (/Math\.max\s*\(\s*1\s*,/.test(capBody))
    v.push('capacityOf の中で 1 に丸めている（capN=0 を表現できなくなる）');
  // --- main.js ⑤: 実態で測り、0 を握りつぶさない・矛盾する 2 行を出さない ---
  if (!/let capN = capacityOf\(course, FLEET\.maxCars\);/.test(mainSrc))
    v.push('main.js ⑤ が capacityOf(course, FLEET.maxCars) を使っていない');
  if (/while\s*\(\s*capN\s*>\s*1\s*&&\s*!fitsAllCars/.test(mainSrc))
    v.push('main.js ⑤ に旧実装 `while (capN > 1 && !fitsAllCars…)` が復活している');
  if (!/const capZero = capN < 1;/.test(mainSrc))
    v.push('main.js ⑤ が capN=0 を判定していない（capZero が無い）');
  if (!/if \(capZero\) capN = 1;/.test(mainSrc))
    v.push('main.js ⑤ の capN=0 → 1 の丸めが無い／形が変わった');
  if (!/t\(capZero \? 'log\.capZeroWarn' : 'log\.capReduced'/.test(mainSrc))
    v.push('main.js ⑤ が capN=0 のときに capReduced（「最大 n 台なら走り出せる」）を出し分けていない＝矛盾する 2 行が出る');
  if (!/\} else if \(capZero\) \{[\s\S]{0,200}?log\.capZeroWarn/.test(mainSrc))
    v.push('main.js ⑤ で「減らす台数が無い」経路の capN=0 告知が無い（無言になる）');
  // --- main.js ④': 実態による救済が丸ごと残っていること ---
  const az4p = /if \(!noRace && sel\.value !== 'tabletop' && fits6 !== true && !fitsAllCars\(course, 1\)\) \{([\s\S]{0,600}?)\n    \}/.exec(mainSrc);
  if (!az4p) v.push("main.js ④' の条件式が無い／変わった（!noRace && 卓上以外 && fits6!==true && !fitsAllCars(course,1)）");
  else {
    const b = az4p[1];
    if (!/sel\.value = 'tabletop';/.test(b)) v.push("④' の救済本体（領域を卓上へ戻す）が無い");
    if (!/log\.autoTabletopFit/.test(b)) v.push("④' が黙って領域を変えている（告知が無い）");
    if (!/sel\.dispatchEvent\(new Event\('change'/.test(b)) v.push("④' が change を発火していない（物理差替等が走らない）");
    if (!/clampByProxy\(\);[\s\S]{0,80}clampByFit\(\);/.test(b)) v.push("④' 後の再クランプ（clampByProxy→clampByFit）が無い");
  }
  // --- main.js ④: 確かめていないことを true と言わない契約 ---
  if (!/if \(!\(userK > 0\.4 \+ 1e-9\)\) return null;/.test(mainSrc))
    v.push('main.js ④ が「評価していないのに true」を返しうる形に戻っている（下限での早期 return null が無い）');
  if (!/const fits6 = clampByFit\(\);/.test(mainSrc))
    v.push("main.js が ④ の戻り値を受けていない（④' の短絡が壊れる）");
  return v;
}

const mainRaw = fs.readFileSync('./public/js/main.js', 'utf8');
const fleetRaw = fs.readFileSync('./public/js/fleet.js', 'utf8');
const structural = checkStructural(mainRaw, fleetRaw);
console.log('\nD) product 側の構造検査（写しとのズレ検出・コメントを剥がして照合）');
console.log('   ※ これは正規表現による構造検査で、**呼ばれる関数の中身の意味変更や、テキストを保った');
console.log('     並べ替えは検出できない**。product の新ロジックを実際に実行するのは');
console.log('     browser/check_az2_fitguard.mjs（実ブラウザ）で、そちらが本命のゲート。');
report('D) 構造条件の違反', structural);

// ── F) D) 自身の変異試験（検査が検査になっているか）────────────────────────────────
// 層 4 レビュー（2026-09-12）が、初版の D) は 10 件の変異のうち **9 件を見逃す**と実測した。
// 「守っている行を 1 つずつ壊して赤くなることを確認してから緑と言う」を常設化する。
// **product のファイルは読むだけ**（変異はメモリ上の複製に入れる）。
const MUTATIONS = [
  ["④' を noRace 専用に反転", m => m.replace("if (!noRace && sel.value !== 'tabletop' && fits6 !== true", "if (noRace && sel.value !== 'tabletop' && fits6 !== true"), null],
  ["④' を midscale で無効化", m => m.replace("sel.value !== 'tabletop' && fits6 !== true", "sel.value === 'fullscale' && fits6 !== true"), null],
  ["④' を false && で殺す", m => m.replace("if (!noRace && sel.value !== 'tabletop'", "if (false && !noRace && sel.value !== 'tabletop'"), null],
  ["④' の救済本体（卓上へ戻す）を削除", m => m.replace("      sel.value = 'tabletop';\n      logLine(t('log.autoTabletopFit'", "      logLine(t('log.autoTabletopFit'"), null],
  ["④' 後の再クランプを削除", m => m.replace("      clampByProxy();\n      clampByFit();\n    }", "    }"), null],
  ['④ が下限でも true を返す', m => m.replace('if (!(userK > 0.4 + 1e-9)) return null;', 'if (!(userK > 0.4 + 1e-9)) return true;'), null],
  ['⑤ の capZeroWarn 出し分けを削除（矛盾する 2 行に戻す）', m => m.replace("t(capZero ? 'log.capZeroWarn' : 'log.capReduced'", "t('log.capReduced'"), null],
  ['⑤ の capN<1 判定を殺す', m => m.replace('const capZero = capN < 1;', 'const capZero = false;'), null],
  ['capacityOf の走査を n>=2 にする', null, f => f.replace('while (n >= 1 && !fitsAllCars(course, n)) n--;', 'while (n >= 2 && !fitsAllCars(course, n)) n--;')],
  ['capacityOf の戻り値を 1 に丸める（「1 台は必ず置ける」の嘘を再注入）', null, f => f.replace('  return n;   //', '  return Math.max(1, n);   //')],
];
console.log('\nF) D) 自身の変異試験（守っている行を壊して赤くなるか）');
const mutMiss = [], mutNoop = [];
for (const [name, fm, ff] of MUTATIONS) {
  const m = fm ? fm(mainRaw) : mainRaw;
  const f = ff ? ff(fleetRaw) : fleetRaw;
  if (m === mainRaw && f === fleetRaw) { mutNoop.push(`${name}（変異が適用されていない＝パターンが実装とズレた）`); continue; }
  if (checkStructural(m, f).length <= structural.length) mutMiss.push(name);
}
console.log(`  変異 ${MUTATIONS.length} 件を注入（product のファイルは無改変）`);
report('F) D) が見逃した変異', mutMiss);
report('F) 適用できなかった変異（パターン腐り）', mutNoop);

// ── E) 性能 ────────────────────────────────────────────────────────────────────
console.log('\nE) 性能');
console.log(`  実オラクル呼び出し（出荷 ${cells} セル合計・capacityOf が内部で払う分を含む）: 旧 ${callsOld} 回 → 新 ${callsNew} 回（差 ${callsNew - callsOld >= 0 ? '+' : ''}${callsNew - callsOld} 回）`);
const perfBad = [];
// **AZ2 が守るべき性能条件はこれ**: 追加の実オラクル呼び出しを「capN=0 か判定する 1 回」までに
// 抑え、利用者の既定領域（卓上）では 1 回も増やさないこと（④ の戻り値で短絡する設計が効いているか）。
// 絶対時間は下記②③のとおり改修前からの性質で、AZ2 の増減ではない。
console.log(`  （内訳）1 セルあたりの増分は最大 1 回まで・卓上は 0 回であること`);
perfBad.push(...callDelta);
let worst = null;
for (const spec of specs) { let c; try { c = buildFromSpec(spec); } catch { continue; } if (!worst || c.walls.length > worst.walls.length) worst = c; }
const timeOf = (c, n, reps = 5) => { const t0 = process.hrtime.bigint(); for (let i = 0; i < reps; i++) fitsAllCars(c, n); return Number(process.hrtime.bigint() - t0) / reps / 1e6; };
setRegimeScale(kL('tabletop')); setCarScale(1);
const tFx = timeOf(fx, MAXN);
const tOkWorst = timeOf(worst, MAXN);
setRegimeScale(kL('fullscale')); setCarScale(1);
const tNgWorst = timeOf(worst, MAXN);
console.log(`  ① 治具（閉じた廊下・落ち着き先＝卓上 cs1）× ${MAXN} 台            : ${tFx.toFixed(2)} ms`);
console.log(`  ② 出荷最大「${worst.name}」壁 ${worst.walls.length} 本・卓上 cs1 × ${MAXN} 台: ${tOkWorst.toFixed(2)} ms  ← 改修前から ④ が毎回払っている`);
console.log(`  ③ 同コース fullscale cs1（置けない＝廊下 BFS へ落ちる最悪ケース）  : ${tNgWorst.toFixed(2)} ms  ← 同上（改修前からの性質）`);
if (tFx > PERF_BUDGET_MS) perfBad.push(`落ち着き先での判定が目安 ${PERF_BUDGET_MS} ms を超えた: ${tFx.toFixed(2)} ms`);
console.log(`  ※ ②③ が目安 ${PERF_BUDGET_MS} ms を超えるのは **AZ2 以前からの性質**（④ が同じ fitsAllCars を毎回呼ぶ）。`);
console.log('     AZ2 の増分は 1 セルあたり最大 1 回（capN=0 かを判定する fitsAllCars(course,1)）で、');
console.log('     利用者の既定領域である卓上では 0 回。しかも壊れた状態を卓上へ戻して終わらせるので、以後は収まる側の速さになる。');
console.log('     product 側にキャッシュは入れない（必要が無い＝卓上で増分 0・無効化の義務を新たに作らない）。');
console.log('     ※ 上の増分は**本ゲートの写しの上での数字**。実ブラウザではスライダー min="0.5" の丸めのぶん +1 回ありうる。');
report('E) 性能条件の違反', perfBad);

console.log('\n' + '='.repeat(78));
console.log(pass ? 'AZ2 フィットガード・ゲート: 全パス ○' : 'AZ2 フィットガード・ゲート: ✗ 不合格');
console.log('='.repeat(78));
process.exit(pass ? 0 : 1);
