// 常設ゲート (Stage AK1・GitHub #26): 衝突応答モデルの不変条件を本物のオラクルで構造検査する。
// 知覚「初期位置で壁に刺さって走り出せない／高速で壁をすり抜ける」を測定述語へ翻訳し、再実装せず
// 実 integrateSlot/checkCollision/runRace/freeSpawn を呼ぶ (CI-9/CI-14)。3条件:
//   (A) 正準レース verifyHash 不変 (= 衝突を含まないクリーン/公式記録は byte 不変)。
//   (B) ライブ多台でねじ込み(走り出せない)が起きない (各物理サブステップ判定＋壁=原子的姿勢棄却)。
//   (C) フルスケール高速の壁トンネリング(すり抜け)が起きない。
// 失敗時は非0終了。卓上 byte 不変は f0_regime が別途担保。
import fs from 'fs';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { Car, checkCollision, carEdges } from './public/js/physics.js';
import { DynCar } from './public/js/physics_dyn.js';
import { makeSlot, rebuildSpawns, integrateSlot, tickSlot, othersFor } from './public/js/fleet.js';
import { buildController } from './public/js/runner.js';
import { buildApi } from './public/js/api.js';
import { setCarScale, setRegimeScale, CAR, SIM, SENSOR_NOISE } from './public/js/config.js';
import { applyRegime } from './public/js/physics_dyn.js';
import { PROGRAM_BY_KEY, PROGRAMS } from './public/js/programs.js';
import { FROZEN } from './wf_frozen.mjs';   // AP3: 凍結値は中央マニフェスト経由

const specs = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
const course = (name) => buildFromSpec(specs.find((s) => s.name === name));
const prog = (k) => { const p = PROGRAMS.find((x) => x.key === k); return { lang: 'c', src: p.code, carType: p.carType }; };
let fail = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? '○' : '✗'} ${msg}`); if (!cond) fail++; };

// (A) 正準レースゲート (wf_ab8_bench 相当) = 衝突応答の改修後も byte 不変であること。
console.log('A) 正準レース verifyHash 不変 (クリーン/公式記録は影響を受けない)');
{
  // wf_ab8_bench と完全同一の構成 (最小 oval spec・name/rear/encoder 付き field) = 正準ハッシュの定義。
  const oval = buildFromSpec({ name: 'オーバル', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
  const fld = (...ks) => ks.map((k, i) => { const p = prog(k); return { name: 'C' + i, lang: p.lang, src: p.src, carType: p.carType, rear: false, encoder: false }; });
  const r1 = runRace({ report: true, course: oval, laps: 3, field: fld('normal_fr', 'normal_awd', 'normal_ff'), crashRule: { rejoin: false, penaltySec: 3 } });
  const r2 = runRace({ report: true, course: oval, laps: 2, field: fld('normal_ff', 'normal_fr'), crashRule: { rejoin: true, penaltySec: 3 } });
  ok(r1.verifyHash === FROZEN.f0, `f0(oval3) verifyHash=${r1.verifyHash} (期待 ${FROZEN.f0} = AM1 コーン測距で再凍結)`);
  ok(r2.verifyHash === FROZEN.f1, `f1(oval2rejoin) verifyHash=${r2.verifyHash} (期待 ${FROZEN.f1} = AM1 コーン測距で再凍結)`);
}

// (B) ライブ多台でねじ込みが起きない (報告バグの直接再現＝ロングオーバル6台)。
console.log('B) ライブ多台のねじ込み(走り出せない)=0');
{
  SENSOR_NOISE.on = false; applyRegime('tabletop'); setRegimeScale(1); setCarScale(0.8);
  const crs = course('ロングオーバル');
  const field = Array(6).fill(PROGRAM_BY_KEY['normal_fr']);
  const slots = field.map((p, i) => { const s = makeSlot({ i, lang: p.lang, src: p.code, course: crs, slotCount: 6, logFor: () => (() => {}) }); s.carType = p.carType; s.car.type = p.carType; return s; });
  rebuildSpawns(slots, crs);
  for (const s of slots) { s.car.reset(s.spawn); s.world._others = []; s.hostEnv = buildApi(s.world); s.lap.reset(crs, { carType: s.carType, persist: false }); try { s.controller = buildController(s.src, s.lang, s.hostEnv); s.controller.setup(); s.running = true; s.loopTimer = 0; } catch (e) { s.running = false; } }
  const x0 = slots.map((s) => ({ x: s.car.x, y: s.car.y }));
  for (let f = 0; f < 140; f++) {   // 7s @ sdt=0.05 (ライブ粗い積分・substep=1/loopHz)
    const edges = slots.map((s) => carEdges(s.car));
    slots.forEach((s, i) => { if (!s.running) return; s.loopTimer -= 0.05; if (s.loopTimer <= 0) { tickSlot(s, othersFor(edges, i, true)); s.loopTimer += 1 / SIM.loopHz; } });
    let rem = 0.05; const mx = 1 / SIM.loopHz;
    while (rem > 1e-6) { const st = Math.min(mx, rem); const e = slots.map((s) => carEdges(s.car)); slots.forEach((s, i) => integrateSlot(s, st, othersFor(e, i, true), crs.walls, true)); rem -= st; }
  }
  const stuck = slots.filter((s, i) => Math.hypot(s.car.x - x0[i].x, s.car.y - x0[i].y) < 0.5 * CAR.length && !s.car.crashed).length;
  const wallStuck = slots.filter((s) => checkCollision(s.car, crs.walls)).length;
  ok(stuck === 0, `7s 後に走り出せない車 = ${stuck} (期待 0)`);
  ok(wallStuck === 0, `7s 後に壁にめり込んだまま = ${wallStuck} (期待 0)`);
}

// (C) フルスケール高速の壁トンネリングが起きない (薄壁を全開で通過しない)。
console.log('C) フルスケール壁トンネリング=なし');
{
  applyRegime('fullscale'); setRegimeScale(20); setCarScale(1);
  const crs = { name: 't', bounds: { w: 3000, h: 200 }, walls: [{ x1: 1500, y1: 0, x2: 1500, y2: 200 }], start: { x: 1495, y: 100, theta: 0 }, noRace: true };
  const slot = makeSlot({ i: 0, lang: 'c', src: 'void loop(){}', course: crs, slotCount: 1, logFor: () => (() => {}) });
  slot.car.reset({ x: 1495, y: 100, theta: 0 }); slot.running = true;
  slot.car.driveDir = 2; slot.car.pwm = 255; slot.car.u = 110;   // 110m/s で壁直前から1回積分
  integrateSlot(slot, 0.15, [], crs.walls, false);
  const passed = slot.car.x > 1502 && !checkCollision(slot.car, crs.walls);
  ok(!passed, `110m/s で壁(1500)を1ステップ積分: afterX=${slot.car.x.toFixed(1)} passedThrough=${passed} (期待 false=壁で止まる)`);
}

console.log(fail === 0 ? '\n衝突応答モデル・ゲート: 全パス ○' : `\n✗ ${fail} 件 不合格`);
process.exit(fail === 0 ? 0 : 1);
