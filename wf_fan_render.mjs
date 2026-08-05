// 常設ゲート (Stage AQ・GitHub #30): センサー扇描画の方向別終端 (fanDepths) が測距の正
// (sensors.js readAll = coneNearest 扇内最近) と単一真実源で整合することを本物のオラクルで検査する。
// 知覚「同じ車種なのにレーザーの長さが違う／扇が空中で終端して見える」を測定述語へ翻訳 (CI-9/CI-14):
//   (A) 整合: 全方向 depth ≥ 測距 best (=(mm-0.5)/1000) かつ 密な標本で min(depths) ≤ best×1.02+2mm。
//       mm=-3 (扇内反射なし) は全方向 depth=maxM。全41コース×3台発走ポーズ×回転ポーズ×3センサー。
//   (B) #30 シナリオ根治: ナローシケイン 卓上3台 normal_fr 発走の中央方向描画長 = 実壁上 (事前計測の凍結値
//       1699/1809/1421mm)。従来の一定半径 (=mm: 1223/770/578) の空中終端が消えたことの機械証明。
//   (C) broadphase 等価: hud.js が使う wallsNear 候補での fanDepths == 全壁での fanDepths (byte 一致)。
// 失敗時は非0終了。測距値そのものの不変は f0_regime / wf_ab8_bench が別途担保。
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const P = (p) => path.join(HERE, p);

const { buildFromSpec } = await import(P('./public/js/course.js'));
const { makeSlot, rebuildSpawns, othersFor } = await import(P('./public/js/fleet.js'));
const { readAll } = await import(P('./public/js/sensors.js'));
const { fanDepths, raySeg } = await import(P('./public/js/geom.js'));
const { carEdges } = await import(P('./public/js/physics.js'));
const { wallsNear } = await import(P('./public/js/contact_v2.js'));
const { setCarScale, setRegimeScale, SENSOR_RANGE, SENSOR_FOV, SENSOR_NOISE } = await import(P('./public/js/config.js'));
const { applyRegime } = await import(P('./public/js/physics_dyn.js'));
const { PROGRAM_BY_KEY } = await import(P('./public/js/programs.js'));

const specs = JSON.parse(fs.readFileSync(P('./public/data/courses.json'), 'utf8'));
let fail = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? '○' : '✗'} ${msg}`); if (!cond) fail++; };
const N_DENSE = 240, N_RENDER = 24;   // 収束検査用の密標本 / hud.js FAN_DEPTH_N と同値の描画解像度

SENSOR_NOISE.on = false; applyRegime('tabletop'); setRegimeScale(1); setCarScale(0.8);
const prog = PROGRAM_BY_KEY['normal_fr'];
const spawn3 = (crs) => {
  const slots = Array.from({ length: 3 }, (_, i) => makeSlot({ i, lang: prog.lang, src: prog.code, course: crs, slotCount: 3, logFor: () => (() => {}) }));
  rebuildSpawns(slots, crs);
  for (const s of slots) s.car.reset(s.spawn);
  return slots;
};

// (A) 整合: depth 下界 (≥ 測距) と密標本の上界収束・空扇=全方向 maxM。
console.log('A) fanDepths ⇔ readAll (coneNearest) の単一真実源整合 (全コース×ポーズ×3センサー)');
{
  const half = SENSOR_FOV.halfRad;
  let checks = 0, lbViol = 0, ubViol = 0, emptyViol = 0, worstUb = 0, worstUbAt = '';
  const dense = new Float64Array(N_DENSE + 1), render = new Float64Array(N_RENDER + 1);
  for (const spec of specs) {
    const crs = buildFromSpec(spec);
    const slots = spawn3(crs);
    const edges = slots.map((s) => carEdges(s.car));
    const maxM = SENSOR_RANGE.maxMm / 1000;
    slots.forEach((s, i) => {
      for (const dTheta of [0, 0.5]) {                 // 発走姿勢＋回転ポーズ (幾何の多様性)
        s.car.theta += dTheta;
        const extra = othersFor(edges, i, true);
        const sensors = readAll(s.car, crs.walls, extra);
        for (const sen of sensors) {
          checks++;
          fanDepths(sen.origin.x, sen.origin.y, sen.dir.x, sen.dir.y, half, N_DENSE, maxM, crs.walls, extra, dense);
          fanDepths(sen.origin.x, sen.origin.y, sen.dir.x, sen.dir.y, half, N_RENDER, maxM, crs.walls, extra, render);
          let mn = Infinity;
          for (const v of dense) if (v < mn) mn = v;
          if (sen.mm >= 0) {
            const best = (sen.mm - 0.5) / 1000;        // mm は round 済 → 真の best ≥ (mm-0.5)/1000
            for (const v of dense) if (v < best - 1e-9) { lbViol++; break; }
            for (const v of render) if (v < best - 1e-9) { lbViol++; break; }
            const ub = (sen.mm / 1000) * 1.02 + 0.002;
            if (mn > ub) { ubViol++; if (mn - ub > worstUb) { worstUb = mn - ub; worstUbAt = `${spec.name} car${i} dθ=${dTheta}`; } }
          } else {
            if (mn < maxM - 1e-9) emptyViol++;         // 扇内反射なし → 全方向レンジまで開く
          }
        }
        s.car.theta -= dTheta;
      }
    });
  }
  ok(lbViol === 0, `下界 (全方向 depth ≥ 測距 best) 違反 = ${lbViol} / ${checks} 検査 (期待 0)`);
  ok(ubViol === 0, `上界 (密標本 min ≤ mm×1.02+2mm) 違反 = ${ubViol} (期待 0)${ubViol ? ` 最悪 +${(worstUb * 1000).toFixed(1)}mm @ ${worstUbAt}` : ''}`);
  ok(emptyViol === 0, `空扇 (mm=-3) で min(depths)=maxM 違反 = ${emptyViol} (期待 0)`);
}

// (B) #30 シナリオ根治: ナローシケイン 卓上3台の中央方向描画長 = 実壁上の凍結値 (空中終端の解消)。
console.log('B) GitHub #30 シナリオ (ナローシケイン・レイアウト 卓上3台 normal_fr 発走)');
{
  const crs = buildFromSpec(specs.find((s) => s.name === 'ナローシケイン・レイアウト'));
  const slots = spawn3(crs);
  const maxM = SENSOR_RANGE.maxMm / 1000;
  const half = SENSOR_FOV.halfRad;
  const EXPECT_MM = [1223, 770, 578];                  // 従来の一様扇半径 (=測距値・空中終端) の凍結値
  const EXPECT_CENTER = [1699, 1809, 1421];            // 修正後の中央方向描画長 (実壁上・事前計測凍結値)
  const prof = new Float64Array(N_RENDER + 1);
  slots.forEach((s, i) => {
    const c = readAll(s.car, crs.walls, [])[1];
    ok(c.mm === EXPECT_MM[i], `car${i} 測距 (扇内最近) = ${c.mm}mm (期待 ${EXPECT_MM[i]} = 測距不変)`);
    fanDepths(c.origin.x, c.origin.y, c.dir.x, c.dir.y, half, N_RENDER, maxM, crs.walls, null, prof);
    const centerMm = Math.round(prof[N_RENDER / 2] * 1000);
    ok(Math.abs(centerMm - EXPECT_CENTER[i]) <= 2, `car${i} 中央方向の描画長 = ${centerMm}mm (期待 ${EXPECT_CENTER[i]}±2 = 実壁上で終端)`);
    // 中央方向 depth が独立の raySeg 全壁走査と一致 (描画が実壁で終端している直接証明)
    let d = maxM;
    for (const w of crs.walls) { const t = raySeg(c.origin.x, c.origin.y, c.dir.x, c.dir.y, w.x1, w.y1, w.x2, w.y2); if (t < d) d = t; }
    ok(Math.abs(prof[N_RENDER / 2] - d) < 1e-12, `car${i} 中央方向 depth == raySeg 全壁最小 (${(d * 1000).toFixed(0)}mm)`);
  });
}

// (C) broadphase 等価: hud.js が渡す wallsNear 候補での fanDepths == 全壁での fanDepths (byte 一致)。
console.log('C) wallsNear 候補 ⇔ 全壁 の fanDepths byte 等価 (hud.js の実呼び出し形)');
{
  const half = SENSOR_FOV.halfRad;
  let diff = 0, checks = 0;
  const a = new Float64Array(N_RENDER + 1), b = new Float64Array(N_RENDER + 1);
  for (const spec of specs) {
    const crs = buildFromSpec(spec);
    const slots = spawn3(crs);
    const maxM = SENSOR_RANGE.maxMm / 1000;
    slots.forEach((s) => {
      const sensors = readAll(s.car, crs.walls, []);
      for (const sen of sensors) {
        checks++;
        const cand = wallsNear(crs.walls, sen.origin.x, sen.origin.y, maxM + 1e-6, maxM);
        fanDepths(sen.origin.x, sen.origin.y, sen.dir.x, sen.dir.y, half, N_RENDER, maxM, cand, null, a);
        fanDepths(sen.origin.x, sen.origin.y, sen.dir.x, sen.dir.y, half, N_RENDER, maxM, crs.walls, null, b);
        for (let k = 0; k <= N_RENDER; k++) if (a[k] !== b[k]) { diff++; break; }
      }
    });
  }
  ok(diff === 0, `候補壁と全壁の depth 相違 = ${diff} / ${checks} 検査 (期待 0 = broadphase は描画に影響しない)`);
}

console.log(fail === 0 ? 'wf_fan_render: ALL PASS' : `wf_fan_render: FAIL ×${fail}`);
process.exit(fail === 0 ? 0 : 1);
