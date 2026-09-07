// AS3 常設アサーションゲート: 「組込サンプルの頑健化」と、その前提となる**周回条件の構造是正**を機械で守る。
// 本番フローのみ (buildFromSpec + runRace) を使い、判定述語は再実装しない (CI-8/CI-9)。exit 非0=失敗。
//
// 背景 (2026-08-04 の実測・決定ログ AS-3): 「既定サンプルで 0 完走のコースが 12/41」の内訳を測ったところ、
//   8 件は **どのプログラムでも完走不可能** だった。
//     ・峠 6 件 = lap.js が touge でゴール1回=laps 1 に確定するのに、レースは laps 引数 (既定3) を要求していた。
//     ・finish 線なし 2 件 = LapTracker が周回を原理的に計上できない (開けた raw コース)。
//   このゲートは、その両方が再発しないこと (A/B) と、サンプル改良の完走マトリクスが退行しないこと (C) を守る。
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';
import fs from 'fs';

const specs = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
const prog = (k) => { const p = PROGRAMS.find((x) => x.key === k); if (!p) throw new Error('no prog ' + k); return p; };
const KEYS = ['normal_fr', 'normal_awd', 'normal_ff'];   // UI 既定3台 (FR/4WD/FF)
const field = () => KEYS.map((k, i) => {
  const p = prog(k);
  return { name: ['A', 'B', 'C'][i], lang: 'c', src: p.code, carType: p.carType, rear: false, encoder: false };
});
const run = (spec, course, laps) => runRace({
  course, regime: spec.noRace ? 'fullscale' : null, laps,
  field: field(), crashRule: { rejoin: false, penaltySec: 3 }, interact: true, report: true,
});

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };

const built = specs.map((spec, i) => ({ i, spec, course: buildFromSpec(spec) }));

// ===== A: 峠 (touge) の周回条件 =====
// 峠はスタート→ゴールの片道。laps 引数は効かず「実効1本」でなければならない。
// 検出力: race_engine.js の touge 正規化を外すと laps=3 の verifyHash が laps=1 と変わり、A-1 が落ちる。
console.log('=== A: 峠の周回条件 (ゴール到達=完走・laps 引数は無効) ===');
const touges = built.filter((b) => b.course.touge);
ok(touges.length > 0, '峠コースが1件も無い (courses.json の前提が崩れた)');
for (const { i, spec, course } of touges) {
  const h1 = run(spec, course, 1), h3 = run(spec, course, 3), h7 = run(spec, course, 7);
  ok(h1.verifyHash === h3.verifyHash && h3.verifyHash === h7.verifyHash,
    `[${i}] ${spec.name}: laps=1/3/7 で verifyHash が一致しない (${h1.verifyHash}/${h3.verifyHash}/${h7.verifyHash}) = 峠が周回コース扱いのまま`);
  // AX3 (2026-09-07): 道幅比の派生峠（`derivedFrom` 持ち・車幅 2.0〜4.5 台分の狭路）は **意図的に出荷サンプルで完走しにくい**
  //   コース（追加時の実測 0〜3/3・desc に明記）。「誰かがゴールできる」は出荷 6 峠にだけ課す。laps 正規化の検出器 A-1
  //   （laps=1/3/7 で verifyHash 一致）は派生を含む全峠に課したまま。
  if (!spec.derivedFrom) ok(h3.finishers.length >= 1,
    `[${i}] ${spec.name}: 既定 laps=3 で完走者 0 (峠は誰かがゴールできなければならない)`);
  console.log(`  [${i}] ${spec.name}: verify=${h3.verifyHash} (laps 1/3/7 一致) 完走 ${h3.finishers.length}/3${spec.derivedFrom ? ' (派生峠・完走要求なし)' : ''}`);
}

// ===== B: 完走判定 (finish ライン) を持たないコース =====
// 周回が原理的に計上されないので、レースは成立しない (本番 UI は開始を止める=main.js raceableCourse)。
// ここでは「本当に誰も完走できない」ことを実測で確定し、対象集合が増減したら気づけるようにする。
console.log('\n=== B: 完走判定の無いコース (レース不成立) ===');
const NOFINISH_EXPECT = ['ドリフト広場 (ショー会場)', '競技グラウンド (フルスケール)'];
const noFinish = built.filter((b) => !b.course.finish);
ok(noFinish.length === NOFINISH_EXPECT.length && noFinish.every((b) => NOFINISH_EXPECT.includes(b.spec.name)),
  `finish 線を持たないコースの集合が変わった: 実測=[${noFinish.map((b) => b.spec.name).join(', ')}] 期待=[${NOFINISH_EXPECT.join(', ')}]`);
for (const { i, spec, course } of noFinish) {
  const r = run(spec, course, 1);
  ok(r.finishers.length === 0, `[${i}] ${spec.name}: finish 線が無いのに完走者が出た`);
  ok(r.report.every((x) => x.lapsCompleted === 0), `[${i}] ${spec.name}: finish 線が無いのに周回が計上された`);
  console.log(`  [${i}] ${spec.name}: finish=null・完走 0/3・全車 lapsCompleted=0 (レース不成立を実測)`);
}

// ===== C: 既定3サンプルの完走マトリクス (母集団レベルの回帰ゲート) =====
// 本番既定条件 = 既定3台・laps=3 (峠は実効1)・rejoin=OFF・maxSec 未指定 (computeRaceTimeout)。
//
// **なぜコース別に判定しないか (CI-14・代理量でなく実態)**: この系は軌道カオスで、意味のない摂動でも
//   個々のコースの完走数が上下する。実測 (2026-08-04・決定ログ AS-3) — サンプルの TOP を 250→249 と
//   PWM 1 だけ下げるだけで 9 コースが下がり、D_SIDE を 1mm 詰めるだけで 8 コースが下がった。
//   よって「コース別に下がらないこと」を守らせると、無害な変更まで不合格にする一方、実質的な劣化と
//   改善を区別できない。母集団の連続量 (完走総数 / 全3台完走コース数 / 0 完走コース数) で判定する。
//   perCourse は診断用の参照データとして持つだけで、合否には使わない。
// 検出力: サンプルの脱出ロジックを外すと完走総数が 103→75 に落ち 0 完走が 2→4 に増えて C が落ちる（39 コース時代の実測）。
// AX3 (2026-09-07) で派生峠 18 本を足し母集団は 57 コース（凍結 total 120 / allThree 30 / maxZero 10・3 値とも実測＝境界の
// ゼロ余裕＝AS10 以来の方針を踏襲）。完走 1 台のコースが 1→4 件に増えたので、無害な物理改良で赤になりやすくなっている
// （層 4 レビュー 重要-7）。赤になったら「意図した変化か」を確かめて刻み直す（AP-0 の版付き回帰記録）。
console.log('\n=== C: 既定3サンプルの完走マトリクス (母集団レベル) ===');
const EXPECTED = JSON.parse(fs.readFileSync(new URL('./wf_as3_expected.json', import.meta.url), 'utf8'));
let total = 0;
const perCourse = {};
for (const { i, spec, course } of built) {
  if (!course.finish) continue;                       // B で扱った不成立コースは対象外
  const r = run(spec, course, 3);
  perCourse[i] = r.finishers.length; total += r.finishers.length;
}
const nAll = Object.keys(perCourse).filter((i) => perCourse[i] === 3).length;
const zero = Object.keys(perCourse).filter((i) => perCourse[i] === 0);
ok(total >= EXPECTED.total, `完走総数 ${total} が下限 ${EXPECTED.total} を下回った`);
ok(nAll >= EXPECTED.allThreeCourses, `全3台完走コース ${nAll} 件が下限 ${EXPECTED.allThreeCourses} 件を下回った`);
ok(zero.length <= EXPECTED.maxZeroCourses,
  `0 完走コースが ${zero.length} 件で上限 ${EXPECTED.maxZeroCourses} 件を超えた: ${zero.map((i) => '[' + i + ']').join('')}`);
const drift = Object.keys(perCourse).filter((i) => EXPECTED.perCourse[i] !== perCourse[i]);
console.log(`  対象 ${Object.keys(perCourse).length} コース: 完走総数 ${total}/${Object.keys(perCourse).length * 3} (下限 ${EXPECTED.total})・` +
  `全3台完走 ${nAll} 件 (下限 ${EXPECTED.allThreeCourses})・0 完走 ${zero.length} 件 ${zero.map((i) => '[' + i + ']').join('')} (上限 ${EXPECTED.maxZeroCourses})`);
console.log(`  参照 (合否に使わない): 凍結時と完走数が異なるコース ${drift.length} 件 ` +
  drift.map((i) => `[${i}]${EXPECTED.perCourse[i]}->${perCourse[i]}`).join(' '));

console.log(`\n合計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.error('FAIL: AS3 ゲート不合格'); process.exit(1); }
console.log('OK: 峠の周回条件・完走判定なしコース・完走マトリクス すべて期待どおり');
