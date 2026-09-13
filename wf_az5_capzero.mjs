// Stage AZ5 常設ゲート — **収容ゼロ (capN=0) を、どの経路でも黙って 1 に丸めない。**
//
// 背景（実測 2026-09-12）。AZ2 は `enforceFitRatio` ⑤ から「1 台は必ず置ける」という**構文に埋め込まれた
// 仮定**を除いたが、同型が他に 2 箇所残っていて AZ2 の保護が届かない経路があった:
//   ・`race_engine.js` の fit ガード  `while (nFit > 1 && !fitsAllCars(course, nFit)) nFit--;`
//     → 実測: 外形 18×18m・**閉じた**廊下 0.30m のコース × regime 'fullscale' × field 3 台 で 1 台へ減らされ、
//       その 1 台は **netMax 0.0000m ＝ 一切動けない**（finishers 0 / dnf 1）。**レースは成立していないのに
//       成立したことにされる。** なお「壁の中に湧く」わけではない（`freeSpawn` は bestWall フォールバックで
//       壁交差しない廊下上の点を返す＝`fleet.js` の「決して壁内には置かない」）。害は別で、**0 台のレースが
//       verifyHash つきの結果として残ること**にある。
//   ・`capacity.js` の `driveableCapN` 末尾 `if (cap < 1) cap = 1;`（注記は「1台は必ず置ける (構造上の下限)」）
//     → **実走の結果に対する仮定であって構造ではない。** 実測: 卓上・閉じた部屋（幅 4×車幅 × 奥行 1.7×車長）で
//       静的 `fitsAllCars` は 3 台まで真なのに `stuckAtN(1)=1`＝1 台も車長ぶん動けない。旧実装はここで 0 を 1 へ
//       丸めるので、`main.js` ⑥ は `log.capReduced`「最大 1 台なら走り出せます」と **嘘を告知していた**。
//   ・さらに `fitReduced` は AK5 以来エンジンが返していたのに **product の誰も読んでいなかった**
//     （実測: 参照は `race_engine.js` 自身と `wf_ak5_robustness.mjs` だけ）＝「3 台で始めたはずが 1 台で
//       走っていた」ことが利用者に一切伝わらなかった。
//
// 検査（本物のオラクルを本番フローで呼ぶ・再実装しない = CI-8/CI-9）:
//   A) 反証条件の固定: 上の 2 つの壊れ方を治具で**再現**する。再現できなければこの検査は何も守っていない。
//   B) 回帰: 出荷コースで (B-1) `driveableCapN` が 0 を返すコースが無いこと、(B-2) **走れたはずのレースを
//      拒否していない**こと（NO_ROOM になるセルでは、旧挙動の「1 台へ丸める」でもその車は走り出せない）、
//      (B-3) 正準 f0/f1 の verifyHash 不変・fitReduced=0。
//   C) 公式記録の再現性: **凍結グリッド (grid != null) では fit ガードが発火しない**＝収容 0 でも投げない。
//      `fitGuard:false`（capacity.js が実態容量を測る経路）も同様に投げない＝AK7 を壊さない。
//      C-2) **NO_ROOM で抜けても live globals を元へ戻す。** 初版の私の実装は fit ガードを try の外に
//      置いたため、`setCarScale(1)` / `applyRegime(regime)` の後に投げて finally の復元を飛ばしていた。
//      実測: fullscale の NO_ROOM 1 回で REGIME_STATE.active が 'fullscale' のまま残り、以後の卓上判定が
//      全部おかしくなった（本ゲート B-1 が出荷 38 コースを「走り出せない」と誤検出して露見）。
//      ライブなら利用者のノイズ/領域/carScale/物理エンジン設定が黙って壊れる。**同じ条件で毎回測る。**
//   D) 構造検査: 「1 台は必ず置ける」仮定が product へ戻っていないこと、0 を握りつぶす形になっていないこと、
//      呼び出し側 4 経路が NO_ROOM と fitReduced を受けていること。**コメントを剥がしてから照合する。**
//   E) D) 自身の変異試験: 守っている行を 1 つずつ壊して赤くなることを毎回機械確認する（AZ2 の F) と同型）。
//
// ⚠ 射程: D) は正規表現による構造検査なので「呼ばれる関数の中身の意味変更」「テキストを保った並べ替え」は
//   原理的に捕まえられない。UI 層（main.js / race_ui.js）を実際に走らせるのは `browser/check_az5_race.mjs`
//   （実ブラウザ・本物の main.js）で、そちらが本命である。**このゲートが緑であることを「product が正しい」の
//   証明として使わないこと。**
//   さらに **UI 4 経路のうち、実ブラウザが実際に踏むのは 2 経路だけ**（🏁 runRaceNow と 📋 closeAndRace）。
//   公式記録の検証再走とゴースト対戦は **D) の構造条件だけが守っている**（層 4 レビュー 2026-09-12 の指摘）。
//
// ⚠ **AZ5 が塞いでいない範囲（実測で確定・AZ6 へ申し送り）**:
//   ・**既定の 1 台編成では実走ゼロが告知されない**。`main.js` ⑥ は `slots.length > 1` で落ちるので、
//     静的には置けるが 1 台も走り出せないコースを 1 台で開いても無言（実測: 静的 capacityOf=3・stuckAtN(1)=1）。
//     広げなかった理由はコスト（出荷最大コースで 1 台プローブ 90.3ms／コース選択ごと）と、発火条件を変えると
//     落ち着き先の全格子回帰をやり直す必要があること。
//   ・**`runRace` の収容判定は carScale ×1 で行われ、ライブの `enforceFitRatio` は利用者のスケールで測る**。
//     ∴ 「UI は 6 台置けると言うのに 🏁 が NO_ROOM で止まる」構成が実在する（実測: 廊下 0.8m×0.08m）。
//     AZ5 は**文言でこの条件（×1）を明示する**ところまでで、判定系の統一は AZ6（判定コアの DOM 分離）。
import fs from 'fs';
import { buildFromSpec, normalizeCourse } from './public/js/course.js';
import { fitsAllCars, capacityOf } from './public/js/fleet.js';
import { runRace } from './public/js/race_engine.js';
import { driveableCapN, stuckAtN } from './public/js/capacity.js';
import { applyRegime } from './public/js/physics_dyn.js';
import { setCarScale, setRegimeScale, setPhysicsMode, CAR, FLEET, REGIMES, REGIME_STATE, SCALE_STATE, SENSOR_NOISE, SENSOR_HOLD, SENSOR_OPTICS, PHYSICS } from './public/js/config.js';
import { PROGRAM_BY_KEY } from './public/js/programs.js';
import { FROZEN } from './wf_frozen.mjs';

const specs = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
const kL = (r) => REGIMES[r].L / REGIMES.tabletop.L;
const REG = ['tabletop', 'midscale', 'fullscale'];
const MAXN = FLEET.maxCars;
const prog = (k) => PROGRAM_BY_KEY[k];
const field = (k, n) => Array.from({ length: n }, (_, i) => { const p = prog(k); return { name: 'C' + i, lang: p.lang, src: p.code, carType: p.carType }; });
const canonField = (...keys) => keys.map((k, i) => { const p = prog(k); return { name: 'C' + i, lang: p.lang, src: p.code, carType: p.carType, rear: false, encoder: false }; });

let pass = true;
const ok = (cond, msg) => { console.log(`  ${cond ? '○' : '✗'} ${msg}`); if (!cond) pass = false; };
const report = (label, arr, n = 10) => {
  console.log(`  ${arr.length === 0 ? '○' : '✗'} ${label}: ${arr.length} 件`);
  arr.slice(0, n).forEach((s) => console.log(`       - ${s}`));
  if (arr.length > n) console.log(`       … 他 ${arr.length - n} 件`);
  if (arr.length) pass = false;
};
// runRace が NO_ROOM で止めたかを bool で返す（他の例外は投げ直す＝握りつぶさない）。
const throwsNoRoom = (spec) => {
  try { runRace(spec); return false; }
  catch (e) { if (e && e.code === 'NO_ROOM') return true; throw e; }
};

console.log('Stage AZ5 収容ゼロ・ゲート — capN=0 をどの経路でも黙って 1 に丸めない');
console.log('='.repeat(78));

// ── 0) 正準 no-op（領域を触る前の pristine 状態で評価する = wf_ak5_robustness と同条件）────────
console.log('\nB-3) 正準レースは無改変（fit ガードが no-op・verifyHash 不変）');
{
  const oval = buildFromSpec({ name: 'オーバル', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
  const r3 = runRace({ report: true, course: oval, laps: 3, field: canonField('normal_fr', 'normal_awd', 'normal_ff'), crashRule: { rejoin: false, penaltySec: 3 } });
  const r2 = runRace({ report: true, course: oval, laps: 2, field: canonField('normal_ff', 'normal_fr'), crashRule: { rejoin: true, penaltySec: 3 } });
  ok(r3.fitReduced === 0 && r3.verifyHash === FROZEN.f0, `f0 (oval×3): fitReduced=0・verifyHash=${r3.verifyHash} (=${FROZEN.f0})`);
  ok(r2.fitReduced === 0 && r2.verifyHash === FROZEN.f1, `f1 (oval×2 rejoin): fitReduced=0・verifyHash=${r2.verifyHash} (=${FROZEN.f1})`);
}

// ── 治具 ───────────────────────────────────────────────────────────────────────
// (1) 外形は広いが**閉じた**廊下が狭い（利用者投稿コースの性質を最小構成で再現・AZ2 の治具と同一形状）。
function narrowCorridorFixture() {
  const W = 18.0, H = 18.0, gap = 0.30, yc = 9.0, xa = 1.0, xb = 17.0;
  const walls = [
    { x1: xa, y1: yc - gap / 2, x2: xb, y2: yc - gap / 2 },
    { x1: xb, y1: yc - gap / 2, x2: xb, y2: yc + gap / 2 },
    { x1: xb, y1: yc + gap / 2, x2: xa, y2: yc + gap / 2 },
    { x1: xa, y1: yc + gap / 2, x2: xa, y2: yc - gap / 2 },
  ];
  return normalizeCourse({ name: 'AZ5 fixture: closed narrow corridor', walls, bounds: { w: W, h: H }, start: { x: 2.0, y: yc, theta: 0 } });
}
// (2) **静的には複数台置けるのに、実走では 1 台も走り出せない**閉じた部屋。
//     奥行きは「前方 0.5 車長は空く（fitsAllCars の driveable 判定を満たす）が、車長ぶんは走れない」値に取る。
//     幅は 2 台以上を横に並べられる値に取る（静的 capN ≥ 2 ＝ main.js ⑥ に入る条件）。寸法は現 CAR から導く
//     ので、車体寸法が変わっても治具の性質（静的に置ける／走り出せない）が保たれる。
function deadEndRoomFixture() {
  const X = 1.7 * CAR.length, Y = 4.0 * CAR.width;
  const walls = [
    { x1: 0, y1: 0, x2: X, y2: 0 }, { x1: X, y1: 0, x2: X, y2: Y },
    { x1: X, y1: Y, x2: 0, y2: Y }, { x1: 0, y1: Y, x2: 0, y2: 0 },
  ];
  return normalizeCourse({ name: 'AZ5 fixture: dead-end room', walls, bounds: { w: X + 0.2, h: Y + 0.2 }, start: { x: 0.5 * CAR.length + 0.005, y: Y / 2, theta: 0 } });
}

// ── A) 反証条件の固定 ──────────────────────────────────────────────────────────
console.log('\nA-1) race_engine: 収容 0 台のレースを成立させない（治具: 外形 18×18m・閉じた廊下 0.30m × fullscale）');
{
  const fx = narrowCorridorFixture();
  setRegimeScale(kL('fullscale')); setCarScale(1);
  const capFS = capacityOf(fx, MAXN);
  const lenFS = CAR.length;
  ok(capFS === 0, `治具の実態収容 = ${capFS} 台（0 でなければ欠陥を再現できていない）`);
  ok(throwsNoRoom({ course: fx, regime: 'fullscale', laps: 1, maxSec: 6, field: field('normal_fr', 3), crashRule: { rejoin: true, penaltySec: 3 } }),
     'field 3 台 → runRace が NO_ROOM で停止（1 台へ丸めて走らせない）');
  // 旧挙動の反証: 1 台へ丸めた場合、その車が実際に走り出せるのかを測る（fitGuard:false = capacity 経路）。
  const one = runRace({ course: fx, regime: 'fullscale', laps: 1, maxSec: 6, field: field('normal_fr', 1), crashRule: { rejoin: true, penaltySec: 3 }, trackNet: true, fitGuard: false });
  ok(one.netMax[0] < lenFS, `旧挙動の反証: 丸めた 1 台は ${one.netMax[0].toFixed(4)}m しか動けない（< 車長 ${lenFS.toFixed(3)}m）＝レースは成立していなかった`);
  ok(one.finishers.length === 0, `旧挙動の反証: 完走 ${one.finishers.length} 台（0 = 走れていない）`);
  setRegimeScale(1); setCarScale(1);
}

console.log('\nA-2) capacity: 実走の収容ゼロを 1 に丸めない（治具: 卓上・閉じた部屋 幅 4×車幅 × 奥行 1.7×車長）');
{
  setRegimeScale(1); setCarScale(1);
  const fx2 = deadEndRoomFixture();
  const capStatic = capacityOf(fx2, MAXN);
  ok(capStatic >= 2, `静的 capacityOf = ${capStatic} 台（≥2 = main.js ⑥ に入る条件を満たす＝旧実装が嘘をつく母体）`);
  const st1 = stuckAtN(fx2, 'tabletop', 1);
  ok(st1 > 0, `実走 stuckAtN(1) = ${st1}/1 台（>0 = 1 台も走り出せない＝欠陥の再現）`);
  const drv = driveableCapN(fx2, 'tabletop', MAXN);
  ok(drv === 0, `driveableCapN = ${drv}（0 = 正直。旧実装は末尾 if (cap<1) cap=1 で 1 を名乗り「最大 1 台なら走り出せます」と嘘を告知していた）`);
}

// ── C) 公式記録の再現性・AK7 の保全 ─────────────────────────────────────────────
console.log('\nC) 凍結グリッド / capacity 経路では投げない（公式記録の再現性・AK7 保全）');
{
  const fx = narrowCorridorFixture();
  setRegimeScale(kL('fullscale')); setCarScale(1);
  const frozenGrid = [{ x: 2.0, y: 9.0, theta: 0 }, { x: 2.3, y: 9.0, theta: 0 }, { x: 2.6, y: 9.0, theta: 0 }];
  let gridOk = true, gridErr = '';
  try {
    const rg = runRace({ course: fx, regime: 'fullscale', laps: 1, maxSec: 3, field: field('normal_fr', 3), crashRule: { rejoin: true, penaltySec: 3 }, grid: frozenGrid });
    gridOk = rg.fitReduced === 0 && rg.grid.length === 3;
  } catch (e) { gridOk = false; gridErr = (e && e.code) || (e && e.message) || String(e); }
  ok(gridOk, `凍結グリッド (grid != null): 収容 0 台でも投げず 3 台で再現（公式記録の再現性を壊さない）${gridErr ? ' — ' + gridErr : ''}`);
  let capOk = true, capErr = '';
  try {
    const rc = runRace({ course: fx, regime: 'fullscale', laps: 1, maxSec: 3, field: field('normal_fr', 6), crashRule: { rejoin: true, penaltySec: 3 }, trackNet: true, fitGuard: false });
    capOk = rc.fitReduced === 0;
  } catch (e) { capOk = false; capErr = (e && e.code) || (e && e.message) || String(e); }
  ok(capOk, `fitGuard:false (capacity 経路): 収容 0 台でも投げず素通し（実態容量を測れる = AK7 保全）${capErr ? ' — ' + capErr : ''}`);
  setRegimeScale(1); setCarScale(1);
}

console.log('\nC-2) NO_ROOM で抜けても live globals を元へ戻す（finally の復元を飛ばさない）');
{
  const fx = narrowCorridorFixture();
  setRegimeScale(1); setCarScale(0.8);
  // **既定値のまま測ると 4 項目が恒真になる（層 4 レビュー 軽-4）。** runRace はセンサ 3 フラグを
  //   `false` に**しか**しないので、既定 false のまま比べても finally を丸ごと外して緑になる。
  //   `spec.physics` を渡さなければ `setPhysicsMode` 自体が走らない。∴ **先に既定と違う値へ倒し、
  //   `spec.physics` も明示して**から測る＝7 項目すべてに実効の検出力を持たせる。
  SENSOR_NOISE.on = true; SENSOR_HOLD.on = true; SENSOR_OPTICS.on = true;
  setPhysicsMode('v2');
  // 復元されるべき値をすべて控える（race_engine の finally が戻す対象そのもの）。
  const before = {
    active: REGIME_STATE.active, userK: SCALE_STATE.userK, regimeK: SCALE_STATE.regimeK,
    noise: SENSOR_NOISE.on, hold: SENSOR_HOLD.on, optics: SENSOR_OPTICS.on, physics: PHYSICS.mode,
  };
  const threw = throwsNoRoom({ course: fx, regime: 'fullscale', laps: 1, maxSec: 3, field: field('normal_fr', 3), crashRule: { rejoin: true, penaltySec: 3 }, physics: 'dynamic' });
  ok(threw, 'C-2 前提: この構成は NO_ROOM で抜ける');
  const after = {
    active: REGIME_STATE.active, userK: SCALE_STATE.userK, regimeK: SCALE_STATE.regimeK,
    noise: SENSOR_NOISE.on, hold: SENSOR_HOLD.on, optics: SENSOR_OPTICS.on, physics: PHYSICS.mode,
  };
  const drift = Object.keys(before).filter((k) => before[k] !== after[k])
    .map((k) => `${k}: ${String(before[k])} → ${String(after[k])}`);
  report('C-2) NO_ROOM 後に元へ戻らなかった live global', drift);
  // 治具で倒した値を戻す（このゲート自身が後続の節を汚染しない）。
  SENSOR_NOISE.on = false; SENSOR_HOLD.on = false; SENSOR_OPTICS.on = false; setPhysicsMode('dynamic');
  setRegimeScale(1); setCarScale(1);
}

// ── B) 出荷コースの回帰 ────────────────────────────────────────────────────────
console.log(`\nB-1) 出荷 ${specs.length} コース × 卓上 cs0.8（wf_recover_model と同条件）で driveableCapN が 0 を返さない`);
{
  const zero = [];
  for (const spec of specs) {
    let course; try { course = buildFromSpec(spec); } catch { continue; }
    setRegimeScale(1); setCarScale(0.8);
    const cap = driveableCapN(course, 'tabletop', MAXN);
    if (cap < 1) zero.push(`${spec.name}: driveableCapN=0（1 台も走り出せない）`);
  }
  report('B-1) 実走で 1 台も走り出せない出荷コース', zero);
  setRegimeScale(1); setCarScale(1);
}

console.log(`\nB-2) 走れたはずのレースを拒否していない（出荷 ${specs.length} コース × ${REG.length} 領域 × cs1）`);
{
  // NO_ROOM になるのは「実態収容 0 台」のセルだけ。そのセルで旧挙動（1 台へ丸めて走らせる）を実測し、
  // **その 1 台が走り出せない**ことを確認する ＝ 拒否によって失われたレースは元から成立していなかった。
  const zeroCells = [];
  for (let ci = 0; ci < specs.length; ci++) {
    let course; try { course = buildFromSpec(specs[ci]); } catch { continue; }
    for (const r of REG) {
      setRegimeScale(kL(r)); setCarScale(1);
      if (capacityOf(course, MAXN) === 0) zeroCells.push({ course, name: specs[ci].name, r });
    }
  }
  console.log(`  実態収容 0 台のセル: ${zeroCells.length} 件（この構成だけが NO_ROOM になる）`);
  const wouldHaveRun = [];
  for (const z of zeroCells) {
    setRegimeScale(kL(z.r)); setCarScale(1);
    const lenR = CAR.length;
    let one;
    try { one = runRace({ course: z.course, regime: z.r, laps: 1, maxSec: 6, field: field('normal_fr', 1), crashRule: { rejoin: true, penaltySec: 3 }, trackNet: true, fitGuard: false }); }
    catch (e) { wouldHaveRun.push(`${z.name}|${z.r}: 旧挙動の測定が例外 ${(e && e.message) || e}`); continue; }
    if (one.netMax[0] >= lenR) wouldHaveRun.push(`${z.name}|${z.r}: 旧挙動なら ${one.netMax[0].toFixed(3)}m 走れていた（≥ 車長 ${lenR.toFixed(3)}m）= 拒否は退行`);
  }
  report('B-2) 拒否したが実は走れていたセル（救済でない変化）', wouldHaveRun);
  setRegimeScale(1); setCarScale(1);
}

// ── D) 構造検査 ────────────────────────────────────────────────────────────────
// **コメントを剥がしてから照合する。** 剥がさないと「注記に文字列が残っているだけ」で真になり、
// 実装を消す変異を見逃す（AZ2 の層 4 レビュー 2026-09-12 の実測指摘と同型）。
// 行内に `://`（URL）を含む行は保守的に丸ごと残す＝誤って消さない側へ倒す。
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map((l) => (/:\/\//.test(l) ? l : l.replace(/\/\/.*$/, ''))).join('\n');
const bodyOf = (src, header) => {
  const i = src.indexOf(header); if (i < 0) return '';
  const j = src.indexOf('\n}', i); return j < 0 ? src.slice(i) : src.slice(i, j + 2);
};

function checkStructural(raw) {
  const eng = strip(raw.engine), cap = strip(raw.capacity), main = strip(raw.main), ui = strip(raw.ui);
  const v = [];
  // --- race_engine: fit ガードが 0 を表現し、0 では走らせない ---
  if (/while\s*\(\s*nFit\s*>\s*1\s*&&\s*!fitsAllCars/.test(eng))
    v.push("race_engine に旧実装 `while (nFit > 1 && !fitsAllCars…)` が復活している（capN=0 を表現できない）");
  if (!/const nFit = capacityOf\(course, field\.length\);/.test(eng))
    v.push('race_engine が共有オラクル capacityOf(course, field.length) を使っていない（走査を再実装している）');
  if (!/if \(nFit < 1\) \{/.test(eng))
    v.push('race_engine が収容 0 台を判定していない（nFit < 1 の分岐が無い）');
  if (!/err\.code = 'NO_ROOM';/.test(eng))
    v.push('race_engine が NO_ROOM を付けていない（呼び出し側がメッセージ文字列に依存する）');
  if (!/throw err;/.test(eng))
    v.push('race_engine が収容 0 台で throw していない（0 台のレース結果が verifyHash つきで残る）');
  // **M5（層 4 レビューが実測した穴）**: `throw err;` の存在だけを見ると `if (spec.strictRoom) throw err;`
  //   のように条件を被せる変異が素通りする。`if (nFit < 1) {` から `throw err;` までに **別の if が無い**
  //   ことを構造で固定する（＝到達が無条件であること）。
  {
    const i0 = eng.indexOf('if (nFit < 1) {'), i1 = eng.indexOf('throw err;', i0);
    if (i0 < 0 || i1 < 0) v.push('race_engine の収容 0 台ブロックが見つからない');
    else if (/\bif\s*\(/.test(eng.slice(i0 + 'if (nFit < 1) {'.length, i1)))
      v.push('race_engine の throw が条件付きになっている（収容 0 台でも走ってしまう経路ができる）');
  }
  // **M1（同上）**: `fitReduced` のカウンタだけ残して **実際のスライスを消す**変異が素通りしていた
  //   （6 台が団子で走りながら「2 台に減らして走りました」と告知する）。両方を 1 行で固定する。
  if (!/\{ fitReduced = field\.length - nFit; fitField = field\.slice\(0, nFit\); \}/.test(eng))
    v.push('race_engine が fitReduced のカウンタと fitField の実スライスを一緒に更新していない（告知と実態が割れる）');
  // 凍結グリッドの正規化（空配列を grid 無しと同義にする）＝ガードの判断と配置を同じ値で駆動する。
  if (!/const gridUsed = \(Array\.isArray\(grid\) && grid\.length > 0\) \? grid : null;/.test(eng))
    v.push('race_engine が grid を正規化していない（grid:[] がガードを素通りし、配置は freeSpawn になる）');
  if (!/rebuildSpawns\(slots, course, gridUsed\);/.test(eng))
    v.push('race_engine の配置が gridUsed を使っていない（ガードの判断と配置が別の値で駆動される）');
  if (!/if \(gridUsed == null && spec\.fitGuard !== false\) \{/.test(eng))
    v.push('race_engine の fit ガードの適用条件が変わった（凍結グリッド/capacity 経路の除外が消えると公式記録と AK7 を壊す）');
  // fit ガードは **try の内側**でなければならない（外だと NO_ROOM が finally の live globals 復元を飛ばす）。
  {
    const iTry = eng.indexOf('\n  try {');
    const iGuard = eng.indexOf('if (gridUsed == null && spec.fitGuard !== false) {');
    if (iTry < 0) v.push('race_engine の try ブロックが見つからない（副作用の復元構造が変わった）');
    else if (iGuard < 0 || iGuard < iTry)
      v.push('race_engine の fit ガードが try の外にある（NO_ROOM で live globals の復元を飛ばす）');
  }
  // --- capacity: driveableCapN が 0 を返せる ---
  const capBody = bodyOf(cap, 'export function driveableCapN');
  if (!capBody) v.push('capacity.js に driveableCapN の定義が無い');
  if (/if \(cap < 1\) cap = 1;/.test(capBody))
    v.push('driveableCapN が 0 を 1 へ丸めている（「1台は必ず置ける」の嘘が戻った）');
  if (/Math\.max\s*\(\s*1\s*,/.test(capBody))
    v.push('driveableCapN の中で 1 に丸めている（capN=0 を表現できなくなる）');
  if (!/while \(cap >= 1 && stuckAtN\(course, regime, cap\) > 0\) cap--;/.test(capBody))
    v.push('driveableCapN が 0 まで下げる走査を持っていない');
  if (!/\breturn cap;/.test(capBody))
    v.push('driveableCapN が cap をそのまま返していない');
  // --- main.js ⑥: 実走の 0 を握りつぶさない ---
  if (!/const drv = driveableCapN\(course, regNow, capN\);/.test(main))
    v.push('main.js ⑥ が driveableCapN の戻り値を受けていない');
  if (!/if \(drv < 1\) capZeroDrive = true; else capN = Math\.min\(capN, drv\);/.test(main))
    v.push('main.js ⑥ が実走の収容ゼロを capZeroDrive として立てていない（0 を黙って丸めている）');
  if (/capN = Math\.min\(capN, driveableCapN\(/.test(main))
    v.push('main.js ⑥ が旧実装（戻り値を検査せず Math.min するだけ）に戻っている');
  // **M2（層 4 レビューが実測した穴）**: ⑥ の**囲みの条件**をどのゲートも見ていなかったため、
  //   `slots.length > 9` や `regNow === 'midscale'` にするだけで AZ5 の中核が丸ごと死ぬのに緑だった。
  //   条件式をリテラルで固定する（変えるなら、変えた理由とセルの全件列挙が要る）。
  if (!/if \(!capZeroStatic && regNow === 'tabletop' && reason !== 'carScale' && capN > 1 && slots\.length > 1\) \{/.test(main))
    v.push("main.js ⑥ の発火条件が変わった（実走ゼロの検出範囲が動く。変更するなら落ち着き先の全件列挙が要る）");
  // --- main.js: レース 2 経路が NO_ROOM と fitReduced を受ける ---
  const errBody = bodyOf(main, 'function raceErrLine');
  if (!/e\.code === 'NO_ROOM'/.test(errBody) || !/log\.race\.noRoom/.test(errBody))
    v.push('main.js の raceErrLine が NO_ROOM を専用文言へ振り分けていない');
  const noteBody = bodyOf(main, 'function noteFitReduced');
  if (!/res\.fitReduced > 0/.test(noteBody) || !/log\.race\.fitReduced/.test(noteBody))
    v.push('main.js の noteFitReduced が fitReduced を告知していない');
  // **呼び出し箇所だけを数える。** 素朴に `noteFitReduced\(res, ` を数えると **関数定義自身**
  //   （`function noteFitReduced(res, requested)`）も 1 件に数えてしまい、片方の呼び出しを消す変異が
  //   「2 件のまま」で素通りする（初版で実際に E) が見逃した。行頭アンカーで定義行を除く）。
  // **「ちょうど 2」で測らない（層 4 レビュー 軽-5）**: 5 本目のレース呼び出しを**正しく足した**ときに
  //   赤くなるのは偽陽性で、ゲート全体の信用を落とす（`check_vnc` を既定から外したのと同じ論理）。
  //   下限で測り、**取り残しは「runRace を呼ぶ経路の数と一致するか」で**測る。
  const raceCalls = (src) => (src.match(/runRace\(\{/g) || []).length
                           - (src.match(/fitGuard: false/g) || []).length;   // 容量測定経路は対象外
  const mainCalls = raceCalls(main), uiCalls = raceCalls(ui);
  if ((main.match(/logLine\(raceErrLine\(e\)\)/g) || []).length !== mainCalls)
    v.push(`main.js のレース経路 ${mainCalls} 件に対し raceErrLine が ${(main.match(/logLine\(raceErrLine\(e\)\)/g) || []).length} 件（取り残しか、余分）`);
  if ((main.match(/^\s+noteFitReduced\(res, /gm) || []).length !== mainCalls)
    v.push(`main.js のレース経路 ${mainCalls} 件に対し noteFitReduced が ${(main.match(/^\s+noteFitReduced\(res, /gm) || []).length} 件（減らして走ったことが無言になる経路がある）`);
  // --- race_ui.js: 検証再走とゴースト対戦も無言にしない ---
  if ((ui.match(/e\.code === 'NO_ROOM'/g) || []).length !== uiCalls)
    v.push(`race_ui.js のレース経路 ${uiCalls} 件に対し NO_ROOM の受けが ${(ui.match(/e\.code === 'NO_ROOM'/g) || []).length} 件`);
  // 減台の告知は経路ごとに**言えることが違う**ので、キーも別（検証再走＝ハッシュ照合あり／ゴースト＝照合なし）。
  if (!/official\.verify\.fitReduced/.test(ui))
    v.push('race_ui.js の検証再走が減台を告知していない（不一致を環境差と誤読させる）');
  if (!/ghost\.fitReduced/.test(ui))
    v.push('race_ui.js のゴースト対戦が減台を告知していない');
  if ((ui.match(/official\.verify\.fitReduced/g) || []).length !== 1)
    v.push('ゴースト対戦に official.verify.fitReduced を流用している（verifyHash を照合しない経路で照合の話をする）');
  if (!/if \(res\.fitReduced > 0\) \{/.test(ui))
    v.push('race_ui.js の検証再走が fitReduced を検査していない（不一致を環境差と誤読させる）');
  return v;
}

const RAW = {
  engine: fs.readFileSync('./public/js/race_engine.js', 'utf8'),
  capacity: fs.readFileSync('./public/js/capacity.js', 'utf8'),
  main: fs.readFileSync('./public/js/main.js', 'utf8'),
  ui: fs.readFileSync('./public/js/race_ui.js', 'utf8'),
};
console.log('\nD) product 側の構造検査（コメントを剥がして照合）');
console.log('   ※ 正規表現による構造検査。呼ばれる関数の中身の意味変更や、テキストを保った並べ替えは');
console.log('     検出できない。UI を実際に走らせるのは browser/check_az5_race.mjs（実ブラウザ）。');
const structural = checkStructural(RAW);
report('D) 構造条件の違反', structural);

// ── E) D) 自身の変異試験 ───────────────────────────────────────────────────────
// **product のファイルは読むだけ**（変異はメモリ上の複製に入れる）。
const MUTATIONS = [
  ['race_engine: 旧走査 `while (nFit > 1 …)` を復活', 'engine',
    (s) => s.replace('const nFit = capacityOf(course, field.length);', 'let nFit = field.length; while (nFit > 1 && !fitsAllCars(course, nFit)) nFit--;')],
  ['race_engine: 収容 0 台の throw を削除', 'engine', (s) => s.replace('      throw err;\n', '')],
  ['race_engine: NO_ROOM コードを外す', 'engine', (s) => s.replace("      err.code = 'NO_ROOM';\n", '')],
  ['race_engine: 0 台判定を殺す', 'engine', (s) => s.replace('if (nFit < 1) {', 'if (false) {')],
  ['race_engine: 凍結グリッド/capacity 経路の除外を外す', 'engine',
    (s) => s.replace('if (gridUsed == null && spec.fitGuard !== false) {', 'if (true) {')],
  // 私が初版で実際にやってしまった形（fit ガードを try の外へ出す）を変異として常設する。
  ['race_engine: fit ガードを try の外へ戻す（finally の復元を飛ばす）', 'engine',
    (s) => s.replace('\n  try {\n', '\n  if (gridUsed == null && spec.fitGuard !== false) { const n0 = capacityOf(course, field.length); if (n0 < 1) { const e0 = new Error("x"); e0.code = "NO_ROOM"; throw e0; } }\n  try {\n')],
  ['capacity: 0→1 の丸めを再注入', 'capacity',
    (s) => s.replace('  _cache.set(key, cap);', '  if (cap < 1) cap = 1;\n  _cache.set(key, cap);')],
  ['capacity: 戻り値を Math.max(1, cap) にする', 'capacity', (s) => s.replace('  return cap;   //', '  return Math.max(1, cap);   //')],
  ['capacity: 走査を cap>=2 で止める', 'capacity',
    (s) => s.replace('while (cap >= 1 && stuckAtN(course, regime, cap) > 0) cap--;', 'while (cap >= 2 && stuckAtN(course, regime, cap) > 0) cap--;')],
  ['main ⑥: 実走ゼロの検査を外して旧実装へ戻す', 'main',
    (s) => s.replace('const drv = driveableCapN(course, regNow, capN);        // 0..capN (AZ5: 0 を返せる)\n        if (drv < 1) capZeroDrive = true; else capN = Math.min(capN, drv);',
                     'capN = Math.min(capN, driveableCapN(course, regNow, capN));')],
  ['main: NO_ROOM の出し分けを削除', 'main', (s) => s.replace("e.code === 'NO_ROOM'", 'false')],
  ['main: fitReduced の告知を無効化', 'main', (s) => s.replace('if (!res || !(res.fitReduced > 0)) return;', 'return;')],
  ['main: 🏁 経路の fitReduced 告知を取り残す', 'main', (s) => s.replace('  noteFitReduced(res, slots.length);', '')],
  ['race_ui: ゴースト対戦の NO_ROOM を取り残す（同族バグ）', 'ui',
    (s) => s.replace("logLine((e && e.code === 'NO_ROOM') ? t('official.verify.noRoom', { name: rcourse.name })", "logLine((e && false) ? t('official.verify.noRoom', { name: rcourse.name })")],
  ['race_ui: 検証再走の fitReduced 告知を削除', 'ui', (s) => s.replace('if (res.fitReduced > 0) {', 'if (false) {')],
  // ▼ ここから下は **層 4 敵対的レビュー（2026-09-12）が「D) は見逃す」と実測した変異**。
  //   指摘を受けて D) に構造条件を足したので、毎回「ちゃんと赤くなる」ことを機械確認する。
  ['M1 engine: fitReduced のカウンタだけ残しスライスを削除（告知と実態が割れる）', 'engine',
    (s) => s.replace('{ fitReduced = field.length - nFit; fitField = field.slice(0, nFit); }', '{ fitReduced = field.length - nFit; }')],
  ['M2 main ⑥: slots.length > 1 を > 9 にして実走ゼロ検出を殺す', 'main',
    (s) => s.replace("capN > 1 && slots.length > 1) {", "capN > 1 && slots.length > 9) {")],
  ['M2b main ⑥: 卓上判定を midscale にして実走ゼロ検出を殺す', 'main',
    (s) => s.replace("regNow === 'tabletop' && reason !== 'carScale'", "regNow === 'midscale' && reason !== 'carScale'")],
  ['M5 engine: throw を条件付きにする（既定では投げない）', 'engine',
    (s) => s.replace('        throw err;', '        if (spec.strictRoom) throw err;')],
  ['M7 engine: grid の正規化を外す（grid:[] が 0 台レースを成立させる）', 'engine',
    (s) => s.replace('const gridUsed = (Array.isArray(grid) && grid.length > 0) ? grid : null;', 'const gridUsed = grid;')],
  ['M8 ui: ゴースト対戦に official.verify.fitReduced を流用（照合しない経路で照合の話をする）', 'ui',
    (s) => s.replace("logLine(t('ghost.fitReduced', {", "logLine(t('official.verify.fitReduced', {")],
];
console.log('\nE) D) 自身の変異試験（守っている行を壊して赤くなるか）');
const mutMiss = [], mutNoop = [];
for (const [name, key, fn] of MUTATIONS) {
  const mutated = { ...RAW, [key]: fn(RAW[key]) };
  if (mutated[key] === RAW[key]) { mutNoop.push(`${name}（変異が適用されていない＝パターンが実装とズレた）`); continue; }
  if (checkStructural(mutated).length <= structural.length) mutMiss.push(name);
}
console.log(`  変異 ${MUTATIONS.length} 件を注入（product のファイルは無改変）`);
report('E) D) が見逃した変異', mutMiss);
report('E) 適用できなかった変異（パターン腐り）', mutNoop);

console.log('\n' + '='.repeat(78));
console.log(pass ? 'AZ5 収容ゼロ・ゲート: 全パス ○' : 'AZ5 収容ゼロ・ゲート: ✗ 不合格');
console.log('='.repeat(78));
process.exit(pass ? 0 : 1);
