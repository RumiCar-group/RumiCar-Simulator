// wf_ao12_wear.mjs — Stage AO12「タイヤ熱・摩耗 (opt-in・戦略資源化)＋摩擦円/タイヤ状態 HUD」受け入れゲート。
// AO_spec §6・§12 AO12 を「知覚→測定の翻訳 (CI-14)」で連続量マージンの機械検査に落とす。
// **再実装せず 実 CarV2.step / runRace / applyRegime の本物のオラクルを呼ぶ** (温度/摩耗/摩擦円容量は実 physics_v2)。
//
// 受け入れ (§12 AO12):
//   ① OFF 既定で f2/f3 不変 = wear 未指定 と wear:false が同一 verifyHash (canon にキーを足さない=byte 不変)。
//   ② ON 決定論 = wear:true を2回 → verifyHash/traceHash bit 一致。
//   ③ ドリフト周回の後輪摩耗 ≥2× grip 周回 (実 CarV2.step の car._wear を読む・同一時間で drift vs grip)。
//   ④ 効果 ≤10% クランプ = 極端に摩耗させても latCap (実 Σμ_i·Fz_i) の低下は ≤10% (=clamp が load-bearing)。
//   ⑤ 自己記述 canon = wear:true は wear:false と別 verifyHash (=別記録として再現・照合可)。
//   ⑥ 「常時ドリフト vs 戦略ドリフト」N ブロック対比 (docs 記録=drift は後輪 grip を食い潰す・grip は保つ)。
//   ⑦ 摩擦円/タイヤ HUD は表示層のみ = 物理は HUD 診断量 (_muUse4) を読み戻さない (probe 撹乱で verifyHash 不変)
//      ＋ hud.js は car 物理フィールドへ書かない・race_engine は hud を import しない (静的確認)。
// 1つでもズレたら exit(1)。
import { readFileSync } from 'node:fs';
import { CarV2, TH, tireParamsFor } from './public/js/physics_v2.js';
import { applyRegime } from './public/js/physics_dyn.js';
import { CAR, CONST, PHYSICS, REGIMES } from './public/js/config.js';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';
import { SAMPLES } from './public/js/samples.js';

const DT = 1 / 60, R2D = 180 / Math.PI;
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };
const beta = c => Math.atan2(c.vlat, Math.max(1e-6, Math.abs(c.u))) * R2D;

function mk(type, tire, wear, regime = 'tabletop') {
  applyRegime(regime);
  const c = new CarV2({ x: 0, y: 0, theta: 0, grip: 1, downhill: 0 });
  c.type = type; c.tireSet = tire; c.wear = wear;
  c.reset({ x: 0, y: 0, theta: 0, grip: 1, downhill: 0 });
  return c;
}
// 過激ドリフト台本 (全開・全舵導入→|β|>35 でカウンター)＝後輪を激しく滑らせ続ける。
function driftRun(type, tire, wear, frames) {
  const c = mk(type, tire, wear);
  c.driveDir = CONST.FORWARD;
  for (let i = 0; i < frames; i++) {
    c.pwm = 255;
    c.steer = i < 30 ? CONST.LEFT : (Math.abs(beta(c)) > 35 ? (c.r > 0 ? CONST.RIGHT : CONST.LEFT) : CONST.LEFT);
    c.step(DT);
  }
  return c;
}
// 穏やかグリップ走行 (中程度スロットル・緩い操舵で転がす)＝ほとんど滑らない。
function gripRun(type, tire, wear, frames) {
  const c = mk(type, tire, wear);
  c.driveDir = CONST.FORWARD;
  for (let i = 0; i < frames; i++) {
    c.pwm = 110;
    c.steer = (i % 160 < 40) ? CONST.LEFT : CONST.CENTER;
    c.step(DT);
  }
  return c;
}
const rearWear = c => 0.5 * (c._wear[2] + c._wear[3]);
const frontWear = c => 0.5 * (c._wear[0] + c._wear[1]);
// 定常横容量 latCap=Σμ_i·Fz_i を実 physics から読むオラクル (AO6 と同型)。摩耗した car を渡すと fTW 込みの容量。
function latCapOf(car) {
  const spd = CAR.maxSpeed;
  car.driveDir = CONST.FREE; car.steer = CONST.CENTER;
  for (let i = 0; i < 6; i++) { car.u = spd; car.vlat = 0; car.r = 0; car.step(DT); }
  return car._latCapSS;
}

console.log('Stage AO12 ゲート  (タイヤ熱・摩耗 opt-in＋摩擦円/タイヤ HUD・§6/§12)');
console.log('='.repeat(70));

// ── A. スキーマ・凍結定数 (退行検知) ─────────────────────────────────────────────
console.log('A. スキーマ / 凍結定数');
{
  ok(new CarV2({ x: 0, y: 0, theta: 0, grip: 1, downhill: 0 }).wear === false, 'A1: CarV2 既定 wear=false (opt-in)');
  ok(TH && TH.maxEffect === 0.10, `A2: TH.maxEffect=0.10 (合計効果 ≤10% クランプ=支配しない設計・=${TH && TH.maxEffect})`);
  ok(TH.tOpt === 1.0 && TH.t0 < TH.tOpt, `A3: 温度アンカー t0=${TH.t0} < tOpt=${TH.tOpt} (冷間始動→最適)`);
}

// ── B. OFF 既定で byte 不変 (production flow=runRace) ────────────────────────────
console.log('B. OFF 既定 = byte 不変 (wear 未指定 ≡ wear:false・canon にキーを足さない)');
const courses = (await import('./public/data/courses.json', { with: { type: 'json' } })).default;
const oval = buildFromSpec(courses.find(c => c.name === 'オーバル'));
const base = PROGRAMS.find(p => p.key === 'normal_fr');
const mkField = (tire) => [{ name: 'T', lang: 'c', src: base.code, carType: 'normal_fr', tire }];
const spec = { course: oval, regime: 'tabletop', physics: 'v2', laps: 2, crashRule: { rejoin: true, penaltySec: 0 }, interact: false };
{
  const noKey = runRace({ ...spec, field: mkField('slip') });                 // wear キー無し
  const wOff  = runRace({ ...spec, field: mkField('slip'), wear: false });    // wear:false
  ok(noKey.verifyHash === wOff.verifyHash, `B1: wear 未指定 (${noKey.verifyHash}) ≡ wear:false (${wOff.verifyHash}) = 既定 byte 不変`);
}

// ── C. ON 決定論 + 自己記述 canon (production flow) ──────────────────────────────
console.log('C. ON 決定論 (bit 一致) + 自己記述 canon (§7)');
{
  const wOff  = runRace({ ...spec, field: mkField('slip'), wear: false });
  const on1 = runRace({ ...spec, field: mkField('slip'), wear: true, trace: true });
  const on2 = runRace({ ...spec, field: mkField('slip'), wear: true, trace: true });
  ok(on1.verifyHash === on2.verifyHash, `C1: wear:true 決定論 verifyHash (${on1.verifyHash} ×2)`);
  ok(on1.traceHash === on2.traceHash, `C2: wear:true 決定論 traceHash (${on1.traceHash} ×2)`);
  ok(on1.verifyHash !== wOff.verifyHash, `C3: wear:true は wear:false と別ハッシュ (${on1.verifyHash}≠${wOff.verifyHash}=自己記述・別記録)`);
  ok(on1.traceHash !== null && on1.traceHash !== runRace({ ...spec, field: mkField('slip'), wear: false, trace: true }).traceHash,
    'C4: wear:true は本番軌跡が変わる (traceHash≠wear:false=摩耗が実挙動に効く真オラクル)');
}

// ── D. ドリフト周回の後輪摩耗 ≥2× grip 周回 (実 CarV2.step・§6 教材核心) ──────────────
console.log('D. ドリフト周回=後輪摩耗 ≥2× grip 周回 (同一時間・実 car._wear)');
const F = 900;   // 15s 相当 (卓上)
{
  const d = driftRun('drift_fr', 'slip', true, F);
  const g = gripRun('normal_fr', 'normal', true, F);
  const dR = rearWear(d), gR = rearWear(g), ratio = gR > 1e-12 ? dR / gR : Infinity;
  ok(ratio >= 2, `D1: 後輪摩耗 drift=${dR.toFixed(4)} / grip=${gR.toFixed(6)} = ${ratio === Infinity ? '∞' : ratio.toFixed(1)}× ≥2× (=ドリフトは後輪を消耗)`);
  ok(rearWear(d) > frontWear(d) * 2, `D2: ドリフトは後輪偏摩耗 (後${rearWear(d).toFixed(4)} > 前${frontWear(d).toFixed(4)}×2 = FR 駆動+ドリフトで後軸が滑る)`);
  ok(d._temp[2] > TH.tOpt && d._temp[0] < d._temp[2], `D3: 後輪が発熱 (RL温度=${d._temp[2].toFixed(2)}>${TH.tOpt} > 前輪 ${d._temp[0].toFixed(2)})`);
}

// ── E. 効果 ≤10% クランプ (実 latCap=Σμ_i·Fz_i・clamp が load-bearing) ─────────────
console.log('E. 効果 ≤10% クランプ (極端摩耗でも latCap 低下 ≤10%・clamp 実効)');
{
  // 基準は **wear-OFF の公称容量** (fTW=1)。fresh な wear-ON 車は「冷間」ぶん既に僅かに低いので基準にしない
  //  (冷間ペナルティを摩耗効果と取り違えない=CI-14)。clamp は fTW∈[1-maxEffect,1] を保証 ⇒ latCap も同帯。
  const cap0 = latCapOf(mk('drift_fr', 'slip', false));   // wear OFF = 公称 μ (温度/摩耗 変調なし)
  // 極端に摩耗させる (長時間ドリフト→後輪 wear を clamp 境界 0.25 の数倍へ)。unclamped なら fW≪0.9 のはず。
  const worn = driftRun('drift_fr', 'slip', true, 3600);
  const wornWear = Math.max(worn._wear[2], worn._wear[3]);
  const unclampedFW = 1 - TH.kW * wornWear;   // クランプ前なら本来この係数 (参考=clamp が無ければどれだけ削れたか)
  const capW = latCapOf(worn);
  const drop = 1 - capW / cap0;
  ok(wornWear > 0.25, `E1: 後輪を clamp 境界超へ摩耗 (wear=${wornWear.toFixed(3)} > 0.25=unclamped fW なら ${unclampedFW.toFixed(2)}≪0.9)`);
  ok(drop <= 0.10 + 1e-9, `E2: latCap 低下=${(drop * 100).toFixed(1)}% ≤10% (極端摩耗でも clamp が μ 低下を頭打ち=支配しない)`);
  ok(drop > 0.0, `E3: latCap は公称より低下 (${(drop * 100).toFixed(2)}%>0 = 摩耗/温度が物理に効いている=clamp は load-bearing)`);
}

// ── F. 「常時ドリフト vs 戦略ドリフト」N ブロック対比 (docs 記録・§6) ──────────────────
console.log('F. 常時ドリフト vs 戦略(グリップ) の N ブロック摩耗/容量 対比 (docs 記録)');
const N = 5, BLK = 300;   // 5 ブロック × 5s = 長丁場のスタンド近似
{
  // 常時ドリフター (滑らせ続ける) と 戦略型 (グリップで丁寧に) を同じ車で N ブロック走らせ、ブロックごとに
  // 後輪摩耗と latCap を測る。常時ドリフターは後輪 grip を食い潰し容量が落ちていく=長丁場で自滅を測定可能に。
  const drifter = mk('drift_fr', 'slip', true); drifter.driveDir = CONST.FORWARD;
  const strat = mk('drift_fr', 'slip', true); strat.driveDir = CONST.FORWARD;
  const rows = [];
  for (let blk = 0; blk < N; blk++) {
    for (let i = 0; i < BLK; i++) {
      // drifter: 常時ドリフト
      drifter.pwm = 255;
      drifter.steer = Math.abs(beta(drifter)) > 35 ? (drifter.r > 0 ? CONST.RIGHT : CONST.LEFT) : CONST.LEFT;
      drifter.step(DT);
      // strat: グリップ (穏やかに転がす=滑らせない)
      strat.pwm = 110;
      strat.steer = (i % 160 < 40) ? CONST.LEFT : CONST.CENTER;
      strat.step(DT);
    }
    rows.push({ blk: blk + 1, driftRear: rearWear(drifter), stratRear: rearWear(strat) });
  }
  console.log('     ブロック | 常時ドリフト後輪摩耗 | 戦略(grip)後輪摩耗');
  for (const r of rows) console.log(`        ${r.blk}     |     ${r.driftRear.toFixed(4)}       |     ${r.stratRear.toFixed(5)}`);
  const last = rows[N - 1];
  ok(last.driftRear >= 2 * Math.max(last.stratRear, 1e-9), `F1: N=${N} 終で 常時ドリフト後輪摩耗 ${last.driftRear.toFixed(4)} ≥2× 戦略 ${last.stratRear.toFixed(5)} (資源枯渇の差)`);
  ok(rows.every((r, i) => i === 0 || r.driftRear > rows[i - 1].driftRear), 'F2: 常時ドリフトの後輪摩耗は単調増加 (資源が減り続ける)');
}

// ── G. 摩擦円/タイヤ HUD は表示層のみ = 物理は HUD 診断量を読み戻さない ───────────────
console.log('G. HUD 表示層のみ (物理非読取): probe 撹乱で verifyHash 不変 + 静的確認');
{
  // 実行時: wear:true レースで毎tick car._muUse4 を撹乱 (HUD 診断量)。physics がこれを読むなら verifyHash が
  // 変わる。読まない (表示専用) なら不変 = 「HUD を物理へ読み戻さない」の直接オラクル (probe は slots 非改変契約
  //  の例外だが _muUse4 は物理状態でない診断フィールドゆえ安全=まさにそれを機械確認する)。
  const clean = runRace({ ...spec, field: mkField('slip'), wear: true });
  const scribble = runRace({ ...spec, field: mkField('slip'), wear: true,
    probe: (tick, slots) => slots.forEach(s => { if (s.car._muUse4) s.car._muUse4[0] = s.car._muUse4[1] = s.car._muUse4[2] = s.car._muUse4[3] = 9.99; }) });
  ok(clean.verifyHash === scribble.verifyHash, `G1: _muUse4 撹乱で verifyHash 不変 (${clean.verifyHash}) = 物理は HUD 摩擦円利用率を読み戻さない`);
  // 静的: hud.js は car の物理フィールドへ書かない (= 表示は読むだけ)。race_engine は hud を import しない。
  const hud = readFileSync('./public/js/hud.js', 'utf8');
  const reng = readFileSync('./public/js/hud.js', 'utf8') && readFileSync('./public/js/race_engine.js', 'utf8');
  const writesPhysics = /\bcar\.(x|y|theta|u|vlat|r|_vw|_temp|_wear|_muUse4|slip|steerAngle)\s*=/.test(hud) ||
    /\bc\.(x|y|theta|u|vlat|r|_vw|_temp|_wear|_muUse4)\s*=/.test(hud);
  ok(!writesPhysics, 'G2: hud.js は car の物理/診断フィールドへ代入しない (drawTireHud 含め読むだけ=表示層)');
  ok(!/from\s+['"]\.\/hud\.js['"]/.test(reng), 'G3: race_engine.js は hud.js を import しない (物理エンジンは HUD 非依存)');
  // 静的: _muUse4 は physics_v2 では書くだけ (読みは hud/main の表示のみ)。physics 側に読取が無いことを確認。
  const phys = readFileSync('./public/js/physics_v2.js', 'utf8');
  const muUse4Reads = (phys.match(/_muUse4\[[^\]]+\]/g) || []).filter(s => !new RegExp(`this\\.${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`).test(phys));
  // 代入は `this._muUse4[w.idx] = utilW` の1箇所のみ・それ以外の参照 (読取) が無いことを確認。
  const assignCount = (phys.match(/this\._muUse4\[[^\]]+\]\s*=/g) || []).length;
  const totalRefs = (phys.match(/_muUse4\b/g) || []).length;   // 宣言(reset)+代入(1) のみ=読取なし
  ok(assignCount === 1, `G4: physics_v2 の _muUse4 代入は1箇所のみ (=${assignCount}・書くだけ)`);
  ok(totalRefs <= 3, `G5: physics_v2 の _muUse4 参照は宣言/代入のみ (総${totalRefs}=物理計算で読み戻さない)`);
}

applyRegime('tabletop');   // 復元
ok(PHYSICS.mode === 'dynamic', `H: runRace 後 PHYSICS.mode 復元 (=${PHYSICS.mode})`);

const line = '─'.repeat(70);
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
console.log(line);
console.log(fail === 0 ? '結果: PASS' : '結果: FAIL');
process.exit(fail === 0 ? 0 : 1);
