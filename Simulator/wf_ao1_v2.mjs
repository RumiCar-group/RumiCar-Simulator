// wf_ao1_v2.mjs — Stage AO1 受け入れゲート (リポジトリ追跡・本番フロー検証の機械側 / CI-8/9/14)。
// ════════════════════════════════════════════════════════════════════════════
// AO1「v2 骨格＋PHYSICS.mode 3値化＋配線＋静的壁ブロードフェーズ基盤」を実測述語で検証する。
// AO_spec §12 AO1 の受け入れを「知覚→測定の翻訳」で連続量/二値の機械検査に落とす:
//   A. 公開面 同名同型 (機械検査)      … CarV2 が DynCar と同じフィールド/メソッドを同 typeof で持つ。
//   B. 配線 (本番 newCar/makeSlot)     … PHYSICS.mode∈{standard,dynamic,v2} で makeSlot が Car/DynCar/CarV2 を生成。
//   C. 決定論 bit 一致 ×2 (runRace)    … mode=v2 で同一 spec を2回走らせ verifyHash/traceHash 完全一致 (本物オラクル)。
//   D. 6車種×3領域×10⁴step 有界+決定論 … CarV2.step を直接回し 全状態 finite・|·|<bound、同条件2回でハッシュ一致。
//   E. ブロードフェーズ=全壁走査と結果一致 … 全コース×多ポーズで readAll(候補)===readAll(全壁) かつ
//                                          min distToSeg(候補)===全壁 を【差分ゼロ】で (本物 sensors/geom オラクル)。
// いずれか失敗で非ゼロ終了。既存 canonical f0/f1・collision/recover 等は別ゲートで別途緑を確認する
// (v2 は guarded branch=mode!=='v2' の既定経路は無改変)。
// ════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import { PHYSICS, PHYSICS_MODES, setPhysicsMode, CAR, SENSOR_RANGE, CONST, CAR_TYPES } from './public/js/config.js';
import { DynCar, applyRegime } from './public/js/physics_dyn.js';
import { Car } from './public/js/physics.js';
import { CarV2 } from './public/js/physics_v2.js';
import { buildWallGrid, queryRadius } from './public/js/contact_v2.js';
import { buildFromSpec } from './public/js/course.js';
import { readAll } from './public/js/sensors.js';
import { distToSeg } from './public/js/geom.js';
import { makeSlot } from './public/js/fleet.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eqJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
// 検証側ハッシュ (出力の再現性測定用・物理ロジックの再実装ではない=決定論の測定オラクル)。
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ── A. 公開面 同名同型 ───────────────────────────────────────────────────────
{
  const spawn = { x: 0.31, y: 0.22, theta: 0.53, grip: 1, downhill: 0 };
  const dyn = new DynCar(spawn);
  const v2 = new CarV2(spawn);
  // AO_spec §1 の互換公開面フィールド一式。
  const FIELDS = ['x', 'y', 'theta', 'v', 'u', 'vlat', 'r', 'slip', 'slipSign', 'steerAngle',
    'vwF', 'vwR', 'crashed', 'held', 'released', 'grip', 'downhill', 'trail', 'type',
    'steer', 'driveDir', 'pwm', 'recoverT', 'recoverSteer', 'recoverN', 'recoverX', 'recoverY',
    'gaveUp', 'recoverCooldownT'];
  for (const k of FIELDS) ok(typeof v2[k] === typeof dyn[k], `A: フィールド ${k} が同 typeof (${typeof v2[k]} vs ${typeof dyn[k]})`);
  const METHODS = ['profile', 'reset', 'halt', 'step', 'corners'];
  for (const m of METHODS) ok(typeof v2[m] === 'function', `A: メソッド ${m}() を持つ`);
  ok(typeof v2.delta === 'number', 'A: get delta が number');
  ok(typeof v2.steerTarget === 'number', 'A: get steerTarget が number');
  ok(Array.isArray(v2.corners()) && v2.corners().length === 4, 'A: corners() が4頂点');
  ok(v2.profile() && typeof v2.profile() === 'object', 'A: profile() がオブジェクト');
  // 実体マーカーで v2 を実行時に判別可能 (配線検査の土台)。
  ok(v2.engine === 'v2', 'A: CarV2.engine === "v2"');
  ok(dyn.engine === undefined, 'A: DynCar は engine マーカー無し (判別可能)');
  ok(PHYSICS_MODES.length === 3 && PHYSICS_MODES.includes('v2'), 'A: PHYSICS_MODES 3値白リストに v2');
}

// ── B. 配線 (本番 newCar/makeSlot 経由) ─────────────────────────────────────
{
  const course = buildFromSpec({ name: 'wireT', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
  const cases = [['standard', Car], ['dynamic', DynCar], ['v2', CarV2]];
  for (const [mode, klass] of cases) {
    const applied = setPhysicsMode(mode);
    ok(applied === mode, `B: setPhysicsMode(${mode}) が白リスト受理`);
    const slot = makeSlot({ i: 0, lang: 'py', src: '', course, slotCount: 1, logFor: () => ({}) });
    ok(slot.car.constructor === klass, `B: mode=${mode} → makeSlot が ${klass.name} を生成 (実 constructor=${slot.car.constructor.name})`);
    if (mode === 'v2') ok(slot.car.engine === 'v2', 'B: v2 スロット車が engine==="v2"');
  }
  // 未知値は既定 dynamic へフォールバック (白リスト)。
  ok(setPhysicsMode('bogus') === 'dynamic', 'B: 未知 mode は dynamic フォールバック');
  setPhysicsMode('dynamic');
}

// ── C. 決定論 bit 一致 ×2 (mode=v2・本物 runRace オラクル) ────────────────────
{
  setPhysicsMode('v2');
  const byKey = {}; for (const p of Object.values(PROGRAMS)) byKey[p.key] = p;
  const fr = byKey['normal_fr'], ff = byKey['normal_ff'];
  const mkField = () => [
    { name: 'A', lang: fr.lang, src: fr.code, carType: 'normal_fr' },
    { name: 'B', lang: ff.lang, src: ff.code, carType: 'normal_ff' },
  ];
  const oval = { name: 'detOval', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 };
  const mkSpec = () => ({ course: buildFromSpec(oval), regime: 'tabletop', laps: 2, field: mkField(), interact: true });
  let r1, r2;
  try { r1 = runRace(mkSpec()); r2 = runRace(mkSpec()); }
  catch (e) { fail++; fails.push('C: runRace(v2) 例外: ' + e.message); }
  if (r1 && r2) {
    ok(typeof r1.verifyHash === 'string' && r1.verifyHash.length > 0, 'C: v2 runRace が verifyHash を返す');
    ok(r1.verifyHash === r2.verifyHash, `C: v2 決定論 verifyHash 一致 (${r1.verifyHash} vs ${r2.verifyHash})`);
    ok(r1.traceHash === r2.traceHash, `C: v2 決定論 traceHash 一致 (${r1.traceHash} vs ${r2.traceHash})`);
  }
  setPhysicsMode('dynamic');
}

// ── D. 6車種×3領域×10⁴step 有界＋決定論 (CarV2.step 直接=本番 step 経路) ───────
{
  const STEPS = 10000, DT = 1 / 60, BOUND = 1e6, VBOUND = 1e4;
  const regimes = ['tabletop', 'midscale', 'fullscale'];
  const keys = CAR_TYPES.map(t => t.key);
  ok(keys.length === 6, `D: 車種 6 種 (${keys.length})`);
  function runOnce(type) {
    const car = new CarV2({ x: 0.30, y: 0.20, theta: 0.30, grip: 1, downhill: 0 });
    car.type = type;
    car.driveDir = CONST.FORWARD; car.pwm = 200; car.steer = CONST.LEFT;   // 定常ハードコーナリング (定入力=決定論)
    let acc = '', bounded = true;
    for (let i = 0; i < STEPS; i++) {
      car.step(DT);
      const vals = [car.x, car.y, car.theta, car.u, car.vlat, car.r];
      for (const v of vals) if (!Number.isFinite(v)) bounded = false;
      if (Math.abs(car.x) > BOUND || Math.abs(car.y) > BOUND) bounded = false;
      if (Math.abs(car.u) > VBOUND || Math.abs(car.vlat) > VBOUND || Math.abs(car.r) > VBOUND) bounded = false;
      if (!bounded) break;
      acc = fnv1a(acc + vals.join(','));   // 逐次 rolling hash
    }
    return { hash: acc, bounded };
  }
  for (const rg of regimes) {
    applyRegime(rg);
    for (const type of keys) {
      const a = runOnce(type);
      ok(a.bounded, `D: ${rg}/${type} 10⁴step 全状態 finite・|·|<bound`);
      const b = runOnce(type);
      ok(a.bounded && a.hash === b.hash, `D: ${rg}/${type} 同条件2回でハッシュ一致 (決定論)`);
    }
  }
  applyRegime('tabletop');   // 復元
}

// ── E. 静的壁ブロードフェーズ = 全壁走査と結果一致 (差分ゼロ・本物 sensors/geom) ─
{
  applyRegime('tabletop');
  const specs = JSON.parse(fs.readFileSync('public/data/courses.json', 'utf8'));
  const maxM = SENSOR_RANGE.maxMm / 1000;
  const Rsensor = maxM + 1.5 * CAR.length;      // センサー原点 (前方オフセット≤車長) の maxRange 円を包む
  const Rcontact = 2 * CAR.length;              // 接触照会半径
  const THS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  const NX = 7, NY = 7;
  let poses = 0, sMis = 0, cMis = 0, courses = 0;
  let sumWallsFull = 0, sumWallsCand = 0;
  const clampMin = (d, R) => (d < R ? d : R);
  function minWallDist(px, py, walls) {
    let best = Infinity; const p = { x: px, y: py };
    for (const w of walls) { const d = distToSeg(p, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }); if (d < best) best = d; }
    return best;
  }
  for (const spec of specs) {
    let course; try { course = buildFromSpec(spec); } catch (e) { continue; }
    const walls = course.walls; if (!walls || !walls.length) continue;
    courses++;
    const grid = buildWallGrid(walls);
    const b = grid.bounds;
    const spanx = (b.maxx - b.minx) || 1, spany = (b.maxy - b.miny) || 1;
    for (let ix = 0; ix < NX; ix++) {
      for (let iy = 0; iy < NY; iy++) {
        const cx = b.minx + spanx * (ix + 0.5) / NX;
        const cy = b.miny + spany * (iy + 0.5) / NY;
        for (const th of THS) {
          const car = { x: cx, y: cy, theta: th };
          // センサー等価: readAll(候補) === readAll(全壁)
          const cand = queryRadius(grid, cx, cy, Rsensor);
          const full = readAll(car, walls);
          const restricted = readAll(car, cand);
          if (!eqJson(full, restricted)) sMis++;
          sumWallsFull += walls.length; sumWallsCand += cand.length;
          // 接触等価: 照会半径内の最近壁距離が全壁と一致 (半径超は「接触なし」で両者一致)
          const candC = queryRadius(grid, cx, cy, Rcontact);
          if (clampMin(minWallDist(cx, cy, walls), Rcontact) !== clampMin(minWallDist(cx, cy, candC), Rcontact)) cMis++;
          poses++;
        }
      }
    }
  }
  ok(courses >= 30, `E: 検査コース数 ${courses} (>=30)`);
  ok(sMis === 0, `E: センサー等価 差分ゼロ (mismatch=${sMis}/${poses})`);
  ok(cMis === 0, `E: 接触等価 差分ゼロ (mismatch=${cMis}/${poses})`);
  const reduce = sumWallsFull > 0 ? (100 * (1 - sumWallsCand / sumWallsFull)).toFixed(1) : '0';
  console.log(`  E: ${courses} コース × ${poses} ポーズ で差分ゼロ / ブロードフェーズ平均候補削減 ${reduce}% (全壁${sumWallsFull}→候補${sumWallsCand})`);
}

// 復元 (別プロセスだが防御的に既定へ戻す)。
setPhysicsMode('dynamic');
applyRegime('tabletop');

// ── 結果 ─────────────────────────────────────────────────────────────────────
const line = '─'.repeat(64);
console.log(line);
console.log('Stage AO1 ゲート  (v2 骨格＋配線＋決定論＋ブロードフェーズ等価)');
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log(line); for (const m of fails) console.log('  ✗ ' + m); }
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
