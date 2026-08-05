// AK2/D10/D11 常設ゲート: 公式レースエンジン runRace の決定論が carScale スライダー位置
// (userK) に非依存であること = 「誰が再実行しても同じ verifyHash」(公式記録の根幹) を構造検査。
// 本物のオラクル (setCarScale / runRace / engineFingerprint) を本番フローで呼ぶ (CI-8/CI-9)。
//
// 検査:
//  A) 同一レースを userK ∈ {0.4,0.8,1,2.0,4} で再実行 → verifyHash が全一致 (スライダー非依存)。
//     卓上・凍結グリッド / フルスケール・凍結グリッド / freeSpawn(grid=null) の3系統。
//  B) runRace が live state (SCALE_STATE.userK) を実行後に厳密復元 (公式実行の副作用ゼロ)。
//  C) engineFingerprint が版照合要素 (appVersion=APP_VERSION / userKDefault=1 / regimeK / exec) を持つ。
//
// fix 前は A が割れる (userK 依存)。fix 後は一致。非ゼロ終了で CI が落とせる。
import { buildFromSpec } from './public/js/course.js';
import { runRace, engineFingerprint } from './public/js/race_engine.js';
import { setCarScale, SCALE_STATE, APP_VERSION } from './public/js/config.js';
import { PROGRAMS } from './public/js/programs.js';

const prog = (key) => { const p = PROGRAMS.find((x) => x.key === key); return { src: p.code, lang: 'c', carType: p.carType }; };
const fieldOf = (...keys) => keys.map((k, i) => { const p = prog(k); return { name: 'C' + i, lang: p.lang, src: p.src, carType: p.carType, rear: false, encoder: false }; });
const oval = buildFromSpec({ name: 'オーバル', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
const grid = [
  { x: 0.0, y: -0.60, theta: 0 }, { x: 0.10, y: -0.90, theta: 0 }, { x: -0.10, y: -1.20, theta: 0 },
];
const USERKS = [0.4, 0.8, 1, 2.0, 4];
let pass = true;
const ok = (b, msg) => { console.log(`  ${b ? '○' : '✗'} ${msg}`); if (!b) pass = false; };

function independence(label, baseSpec) {
  console.log(`\nA) userK 非依存 — ${label}`);
  let base = null, allSame = true, allRestored = true;
  for (const uk of USERKS) {
    setCarScale(uk);
    const before = SCALE_STATE.userK;
    const spec = { ...baseSpec, grid: baseSpec.grid ? baseSpec.grid.map((g) => ({ ...g })) : null };
    const res = runRace(spec);
    const after = SCALE_STATE.userK;
    if (base == null) base = res.verifyHash;
    if (res.verifyHash !== base) allSame = false;
    if (Math.abs(after - before) > 1e-12) allRestored = false;
    console.log(`    userK=${String(uk).padEnd(4)} verifyHash=${res.verifyHash} restore ${before}->${after}`);
  }
  ok(allSame, `verifyHash が userK に非依存で全一致 (=${base})`);
  ok(allRestored, 'B) runRace 後に SCALE_STATE.userK を厳密復元');
}

independence('卓上・凍結グリッド・rejoin=false', {
  course: oval, regime: 'tabletop', laps: 2, grid,
  field: fieldOf('normal_fr', 'normal_awd', 'normal_ff'),
  crashRule: { rejoin: false, penaltySec: 3 }, interact: true, maxSec: 180, report: true });
independence('フルスケール・凍結グリッド・rejoin=true', {
  course: oval, regime: 'fullscale', laps: 2, grid,
  field: fieldOf('normal_fr', 'normal_ff'),
  crashRule: { rejoin: true, penaltySec: 3 }, interact: true, maxSec: 180, report: true });
independence('卓上・freeSpawn(grid=null)', {
  course: oval, regime: 'tabletop', laps: 2, grid: null,
  field: fieldOf('normal_fr', 'normal_awd', 'normal_ff'),
  crashRule: { rejoin: false, penaltySec: 3 }, interact: true, maxSec: 180, report: true });
// AO7: 精密動力学 v2 も userK 非依存であることを確認 (v2 の決定論が carScale スライダーに漏れない=
// AK2 の userK 退避/復元が v2 経路でも効く。physics:'v2' 指定で spec.physics ピン留め・fullscale)。
independence('フルスケール v2・凍結グリッド・rejoin=true', {
  course: oval, physics: 'v2', regime: 'fullscale', laps: 2, grid,
  field: fieldOf('normal_fr', 'normal_ff'),
  crashRule: { rejoin: true, penaltySec: 3 }, interact: true, maxSec: 180, report: true });

console.log('\nC) engineFingerprint 版照合要素 (D11)');
const fp = engineFingerprint();
console.log('   ', JSON.stringify(fp));
ok(fp.appVersion === APP_VERSION, `appVersion=${fp.appVersion} が APP_VERSION(${APP_VERSION}) と一致`);
ok(fp.userKDefault === 1, `userKDefault=${fp.userKDefault} (公式は userK=1 固定)`);
ok('regimeK' in fp && 'exec' in fp, 'regimeK / exec を含む');

console.log(`\n${'='.repeat(62)}`);
console.log(pass ? 'carScale 決定論ゲート: 全パス ○' : 'carScale 決定論ゲート: ✗ 不合格');
console.log('='.repeat(62));
process.exit(pass ? 0 : 1);
