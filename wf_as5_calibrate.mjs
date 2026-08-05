// AS5 常設アサーションゲート: 「レース開催パラメータの実測較正」を機械で守る。
// 本番フローのみ (buildFromSpec + runRace + race_event.js の実関数) を使い、判定述語は再実装しない (CI-8/CI-9)。
// 判定は Stage AS 共通の測定作法 (docs/PLAN.md Stage AS 冒頭) に従い、コース別 0/1 ではなく
// **母集団レベルの連続量**で書く (この系は軌道カオスでコース別判定は代理量にしかならない・AS3 実測)。
// exit 非0=失敗。
//
// 背景 (2026-08-04・決定ログ AS-5):
//  ① budget クラス costOf の初期 weight (仮置き・W_spec §11) が「単一最強ビルドを生む」か実測で較正。
//     6 アーキタイプ (budget<=100 を使い切る・costOf() 実関数で二分探索し逆算) を AS3 で頑健化した
//     normal_fr で統一駆動し、39 コース (完走が定義される集合=AS3 と同一) を実レースで走らせる。
//  ② FILLER_POOL 補充車の全対象コース完走可能性を実測。旧プール (comp_circuit を2枠) は
//     comp_circuit 単体で 39 コース中 10 完走しかない「フルスケール専用チューン」で設計意図
//     ("どのコースでも完走を狙える") に反していた→ normal_fr/awd/ff + drift_awd/ff の5本へ差替済 (本番 race_event.js)。
//  ③ 補充車のプログラム本文の凍結機構 (freezeFillerPool/event.fillerPool 優先) を追加。
//     既存公式記録 (docs/phase_w/official_sample_event.json) は fillerPool を持たないため
//     未凍結フォールバック経路のまま=非退行 (D)。
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { costOf, validateEntry, formField, fillerEntry, freezeFillerPool, FILLER_POOL } from './public/js/race_event.js';
import { PROGRAM_BY_KEY } from './public/js/programs.js';
import fs from 'fs';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };

const specs = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
const NOFINISH = ['ドリフト広場 (ショー会場)', '競技グラウンド (フルスケール)'];   // finish===null (AS3)
const built = specs.map((spec, i) => ({ i, spec, course: buildFromSpec(spec) })).filter(({ spec }) => !NOFINISH.includes(spec.name));

// ===== A: budget コスト関数の逆変換 (costFrac 0..1 → 実パラメータ) — costOf() の式の逆 =====
const P = {
  maxSpeed: (f) => 0.85 + f * 0.35, accel: (f) => 0.85 + f * 0.55, brake: (f) => 0.85 + f * 0.40,
  us: (f) => 0.50 - f * 0.50, os: (f) => 0.30 - f * 0.30, mass: (f) => 1500 - f * 500,
};
const clamp = (x) => Math.max(0, Math.min(1, x));
function defAt(key, frac, scale, drift) {
  return {
    key, name: key, mass: P.mass(clamp(frac.mass * scale)),
    yawGain: 1.0, us: P.us(clamp(frac.us * scale)), os: P.os(clamp(frac.os * scale)),
    powerUs: 0, powerOs: 0.1, liftOffOs: 0.05, brakeOs: 0.1, spin: 0.1,
    accel: P.accel(clamp(frac.accel * scale)), brake: P.brake(clamp(frac.brake * scale)),
    maxSpeed: P.maxSpeed(clamp(frac.maxSpeed * scale)), slide: 0.05,
    drift: drift ? { trigger: 'power', grip: 0.84, gain: 6.0, brakeDrift: true, minSp: 0.40, slipYaw: 1.0, slipSlide: 0.4, attack: 5, release: 5 } : null,
  };
}
// frac の比率を保ったまま budget を使い切る scale を二分探索 (costOf() 本番実関数で判定)。
function buildArchetype(key, frac, drift, budget) {
  let lo = 0, hi = 4;   // hi=4: 全軸 frac<=1 なので scale<=4 で clamp 上限に達し切る
  for (let iter = 0; iter < 40; iter++) {
    const mid = (lo + hi) / 2;
    if (costOf(defAt(key, frac, mid, drift)) <= budget) lo = mid; else hi = mid;
  }
  const def = defAt(key, frac, lo, drift);
  return { def, cost: costOf(def) };
}

const ARCHETYPES = [
  ['Speed',      { maxSpeed: 1, accel: 1, brake: 0.6, us: 0, os: 0, mass: 0.3 }, false],
  ['Grip',       { maxSpeed: 0.2, accel: 0.4, brake: 0.8, us: 1, os: 1, mass: 0.6 }, false],
  ['Light',      { maxSpeed: 0.5, accel: 0.6, brake: 0.4, us: 0.3, os: 0.3, mass: 1 }, false],
  ['DriftTech',  { maxSpeed: 0.4, accel: 0.6, brake: 0.6, us: 0.5, os: 0.4, mass: 0.3 }, true],
  ['Balanced',   { maxSpeed: 0.5, accel: 0.5, brake: 0.5, us: 0.5, os: 0.5, mass: 0.5 }, false],
  ['BrakeCtl',   { maxSpeed: 0.3, accel: 0.5, brake: 1, us: 0.6, os: 0.6, mass: 0 }, false],
];
const BUDGET = 100;
console.log('=== A: budget クラス costOf 較正 (budget=' + BUDGET + ') ===');
const builds = ARCHETYPES.map(([key, frac, drift]) => ({ key, frac, drift, ...buildArchetype(key, frac, drift, BUDGET) }));
for (const b of builds) ok(b.cost <= BUDGET, `${b.key}: cost=${b.cost} が budget=${BUDGET} を超過`);

// A-検出力: budget が実際に制約として効いていること (=二分探索が骨抜きでないこと) を2点で実測する。
// (i) budget 内でほぼ使い切っている (骨抜きなら scale=0 のまま=cost が budget よりずっと低いままになる)。
// (ii) budget を倍 (200) にすると同じ frac 比のアーキタイプがより高いコスト (=より高いスペック) を
//      獲得できる (budget が単調に効くという最小限の健全性=constraint が実質 no-op なら変化しない)。
for (const b of builds) ok(b.cost >= 0.80 * BUDGET, `${b.key}: cost=${b.cost} が budget=${BUDGET} を十分使い切っていない (二分探索の破損疑い)`);
// (ii) は「全軸で余裕を残す(いずれも clamp 上限に達しない)」frac で確かめる (6アーキタイプの中には
// 意図的に一部軸を最大まで振り切るものがあり、そこは budget を増やしても cost 上限=Σweight·frac に
// 頭打ちする＝正常。budget が効くかどうかの検出には非飽和プローブを使う)。
const probeFrac = { maxSpeed: 0.3, accel: 0.3, brake: 0.3, us: 0.3, os: 0.3, mass: 0.3 };
const probeLo = buildArchetype('Probe', probeFrac, false, 50);
const probeHi = buildArchetype('Probe', probeFrac, false, 100);
ok(probeHi.cost > probeLo.cost,
  `検出力: budget を50→100にしても非飽和プローブの cost が増えない (${probeLo.cost}→${probeHi.cost}) = budget 制約が無意味化している`);

// budget 超過エントリーが決定論的に弾かれること (既存契約・非退行)。
const overBudget = buildArchetype('Over', { maxSpeed: 1, accel: 1, brake: 1, us: 1, os: 1, mass: 1 }, true, 1000).def;
const v = validateEntry({ class: 'budget', budget: { total: BUDGET } }, { carDef: overBudget });
ok(v.ok === false && v.reason === 'budget', 'budget 超過ビルドが validateEntry で弾かれない (退行)');

// ===== B: 実レース (39 コース) での勝者多様性 (母集団述語・CI-14) =====
console.log('=== B: 実レースでの勝者多様性 (' + built.length + ' コース) ===');
const prog = PROGRAM_BY_KEY['normal_fr'];   // AS3 で頑健化した既定サンプル (Apex Hunter)
const raceField = () => builds.map((b) => ({ name: b.key, lang: 'c', src: prog.code, carDef: b.def }));
const winCount = {}; builds.forEach((b) => { winCount[b.key] = 0; });
let coursesWithFinisher = 0;
for (const { spec, course } of built) {
  const res = runRace({ course, regime: spec.noRace ? 'fullscale' : null, laps: spec.kind === 'touge' ? undefined : 3,
    field: raceField(), crashRule: { rejoin: false, penaltySec: 3 }, interact: true, report: false });
  if (res.finishers.length) { coursesWithFinisher++; winCount[res.finishers[0].name]++; }
}
const distinctWinners = Object.values(winCount).filter((n) => n > 0).length;
const maxWinShare = Math.max(...Object.values(winCount)) / (coursesWithFinisher || 1);
console.log(`  完走者が出たコース ${coursesWithFinisher}/${built.length}・優勝内訳 ${JSON.stringify(winCount)}`);
console.log(`  distinct winners = ${distinctWinners}/${builds.length}  max win share = ${(maxWinShare * 100).toFixed(1)}%`);
ok(coursesWithFinisher >= 25, `完走者が出たコースが ${coursesWithFinisher}/${built.length} (基準 >=25。実測は37前後)`);
ok(distinctWinners >= 4, `優勝ビルドの多様性が ${distinctWinners}/${builds.length} (基準 >=4。「単一最強ビルド」を検出)`);
ok(maxWinShare <= 0.65, `最多優勝ビルドの勝率シェアが ${(maxWinShare * 100).toFixed(1)}% (基準 <=65%。「単一最強ビルド」を検出)`);

// ===== C: FILLER_POOL の完走可能性 (母集団述語) =====
console.log('=== C: FILLER_POOL の完走可能性 (' + built.length + ' コース) ===');
const fillerField = formField({ minField: FILLER_POOL.length }, []);
ok(fillerField.length === FILLER_POOL.length, `FILLER_POOL 全5台が補充されない (実際 ${fillerField.length} 台)`);
ok(fillerField.every((f) => f.src && f.src.length > 10), 'filler の src が空/極端に短い (progKey 解決の破損)');
let pairFinish = 0, courseWithFillerFinisher = 0;
const perFiller = {}; fillerField.forEach((f) => { perFiller[f.name] = 0; });
for (const { spec, course } of built) {
  const res = runRace({ course, regime: spec.noRace ? 'fullscale' : null, laps: spec.kind === 'touge' ? undefined : 3,
    field: fillerField, crashRule: { rejoin: false, penaltySec: 3 }, interact: true, report: false });
  pairFinish += res.finishers.length;
  if (res.finishers.length) courseWithFillerFinisher++;
  for (const f of res.finishers) perFiller[f.name]++;
}
const pairTotal = built.length * fillerField.length;
console.log(`  完走した(補充車,コース)ペア ${pairFinish}/${pairTotal} (${(100 * pairFinish / pairTotal).toFixed(1)}%)・1台以上完走コース ${courseWithFillerFinisher}/${built.length}`);
console.log(`  filler 別完走数: ${JSON.stringify(perFiller)}`);
ok(courseWithFillerFinisher >= 30, `filler が1台も完走しないコースが多すぎる (完走コース ${courseWithFillerFinisher}/${built.length}・基準 >=30)`);
ok(pairFinish / pairTotal >= 0.40, `filler の population 完走率が ${(100 * pairFinish / pairTotal).toFixed(1)}% (基準 >=40%)`);
ok(Object.values(perFiller).every((n) => n >= 1), `1台も完走できない filler が存在 (${JSON.stringify(perFiller)})`);

// ===== D: 補充車プログラム本文の凍結機構 (AS3 決定ログの持ち越し課題への対処・検出力つき) =====
console.log('=== D: 補充車プログラム本文の凍結 (event.fillerPool 優先) ===');
const frozen = freezeFillerPool();
ok(frozen.length === FILLER_POOL.length && frozen.every((f) => f.program && f.program.src && f.program.src.length > 10),
  'freezeFillerPool() の出力が schema (program.src) を満たさない');
// 検出力: event.fillerPool に「現行 progKey とは異なる偽の本文」を積み、formField がそれを
// **そのまま**使う (= 生きた FILLER_POOL/PROGRAM_BY_KEY を無視する) ことを実測。
// もし formField が退行して常に生きたプールを使うようになれば、この検査は FAIL する。
const fakeSrc = '// AS5 gate: frozen fake body (must be used verbatim, not re-resolved)\n';
const fakeFrozenPool = [{ name: 'BOT-1', program: { src: fakeSrc, lang: 'c' }, carType: 'normal_fr' }];
const frozenField1 = formField({ minField: 1, fillerPool: fakeFrozenPool }, []);
ok(frozenField1.length === 1 && frozenField1[0].src === fakeSrc,
  'event.fillerPool の凍結 src が formField 出力に反映されない (frozenField/公式記録の再現性が壊れる)');
// 非退行 (③): event.fillerPool が無い既存イベント (公式サンプルと同型) は、従来どおり生きた
// FILLER_POOL/PROGRAM_BY_KEY を都度解決する (frozenField・fillerEntry の後方互換)。
const liveFiller = fillerEntry(FILLER_POOL[0]);
const liveViaFormField = formField({ minField: 1 }, [])[0];
ok(liveFiller.src === PROGRAM_BY_KEY[FILLER_POOL[0].progKey].code && liveViaFormField.src === liveFiller.src,
  'event.fillerPool 未指定時に生きた FILLER_POOL 解決へフォールバックしない (③ 既存イベント非退行)');

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${fail}`);
process.exit(fail === 0 ? 0 : 1);
