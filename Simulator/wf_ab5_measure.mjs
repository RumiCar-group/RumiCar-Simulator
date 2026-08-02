// AB5 計測ハーネス (リポジトリ追跡外・CI-9): 入門プール/難易度を本番エンジンで再実測する。
// report の走破マトリクスは旧 maxSec=180 固定下の結果。AB2 で timeout がコース規模×周回連動に
// なったため、現エンジンで「既定3台 (FR/4WD/FF)・既定 laps=3・本番 regime 自動切替」で完走数を
// 測り直し、起動入門プール (全3台完走しやすいコース) を地に足のついた根拠で選ぶ。
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';
import fs from 'fs';

const specs = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
const prog = (key) => { const p = PROGRAMS.find((x) => x.key === key); if (!p) throw new Error('no prog ' + key); return p; };
// 既定3台 = A:ノーマルFR / B:ノーマル4WD / C:ノーマルFF (report と同編成)。
const DEFAULT_KEYS = ['normal_fr', 'normal_awd', 'normal_ff'];
const field = () => DEFAULT_KEYS.map((k, i) => { const p = prog(k); return { name: ['A', 'B', 'C'][i], lang: 'c', src: p.code, carType: p.carType, rear: false, encoder: false }; });

// 本番 enforceFitRatio と同じ: noRace 設計コースは fullscale、それ以外は卓上 (tabletop=null)。
const regimeOf = (spec) => (spec.noRace ? 'fullscale' : null);

const LAPS = 3;   // UI 既定 (index.html raceLaps value="3")

function run(spec, rejoin) {
  const course = buildFromSpec(spec);
  const res = runRace({
    course, regime: regimeOf(spec), laps: LAPS,
    field: field(), crashRule: { rejoin, penaltySec: 3 }, interact: true, report: true,
  });   // maxSec 未指定 = computeRaceTimeout (本番既定)
  return { fins: res.finishers.length, dnf: res.dnf.map((d) => d.reason), simSec: res.simSec };
}

console.log('AB5 完走実測 (既定3台 FR/4WD/FF・laps=3・本番 timeout スケール)');
console.log('rejoin=false が本番既定 (raceRejoin 既定 OFF)。rejoin=true は report 条件 (参考)。\n');
console.log('# '.padEnd(4) + 'name'.padEnd(34) + 'regime'.padEnd(10) + 'OFF(既定)'.padEnd(12) + 'ON(参考)');

const rows = [];
specs.forEach((spec, i) => {
  const off = run(spec, false);
  const on = run(spec, true);
  rows.push({ i, name: spec.name, regime: regimeOf(spec) || 'tabletop', off, on, touge: !!spec.touge, noRace: !!spec.noRace });
  const offStr = `${off.fins}/3 [${off.dnf.join(',') || '-'}]`;
  const onStr = `${on.fins}/3 [${on.dnf.join(',') || '-'}]`;
  console.log(String(i).padEnd(4) + (spec.name || '?').padEnd(34) + (regimeOf(spec) || 'tabletop').padEnd(10) + offStr.padEnd(12) + onStr);
});

console.log('\n===== 入門プール候補 (本番既定 rejoin=OFF で全3台完走・卓上・非峠) =====');
const pool = rows.filter((r) => r.off.fins === 3 && !r.noRace && !r.touge);
pool.forEach((r) => console.log(`  [${r.i}] ${r.name}`));
console.log(`計 ${pool.length} コース`);

console.log('\n===== 完走数で見た難易度分布 (rejoin=OFF 本番既定) =====');
const by3 = rows.filter((r) => r.off.fins === 3).length;
const by12 = rows.filter((r) => r.off.fins === 1 || r.off.fins === 2).length;
const by0 = rows.filter((r) => r.off.fins === 0).length;
console.log(`全3台完走=${by3}  1〜2台=${by12}  0台=${by0}  (計 ${rows.length})`);
