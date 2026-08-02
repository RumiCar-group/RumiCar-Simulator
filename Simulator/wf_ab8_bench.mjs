// AB8/AO7 byte 不変ベンチ (常設アサートゲート): 本番物理を runRace で決定論実行し verifyHash を採取し、
// 凍結値と照合する。physics/config/programs 無改変なら hash 不変。1つでもズレたら exit(1)。
//   f0/f1 = 卓上(オーバル・dynamic 既定・normal タイヤ)。走行エンジン v1(dynamic)の永久凍結値。
//   f2/f3 = fullscale(競技サーキット・精密動力学 v2)。Stage AO7 で凍結。
//           f2 = 競技サーキット × 3車種(FF/FR/AWD) × v2 × normal タイヤ(Circuit Racer プログラム・独立走行)。
//           f3 = 競技サーキット × ドリフト FR × slip タイヤ(Slip Attack プログラム)=ドリフト経路の凍結。
// 注: f2/f3 は非既定(physics=v2 / tire=slip)ゆえ canon に physics/tire キーが付き、f0/f1 とは別ハッシュで
//     決定論(既存 f0/f1 は byte 完全不変=末尾キー無し)。
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';
import { FROZEN } from './wf_frozen.mjs';   // AP3: 凍結値は中央マニフェスト wf_frozen_manifest.json を単一の真実源として読む
const prog = (key) => { const p = PROGRAMS.find((x) => x.key === key); return { src: p.code, lang: p.lang || 'c', carType: p.carType }; };
const fieldOf = (...keys) => keys.map((k,i)=>{ const p=prog(k); return { name:'C'+i, lang:p.lang, src:p.src, carType:p.carType, rear:false, encoder:false }; });

// ---- f0/f1: 卓上オーバル (dynamic 既定・normal)。永久凍結 (走行エンジン v1)。 ----
const oval = buildFromSpec({ name:'オーバル', kind:'track', shape:'ellipse', rx:1.2, ry:0.75, width:0.55 });
const r0 = runRace({ report:true, course:oval, laps:3, field:fieldOf('normal_fr','normal_awd','normal_ff'), crashRule:{rejoin:false,penaltySec:3} });
const r1 = runRace({ report:true, course:oval, laps:2, field:fieldOf('normal_ff','normal_fr'), crashRule:{rejoin:true,penaltySec:3} });

// ---- f2/f3: フルスケール競技サーキット (精密動力学 v2)。Stage AO7 で凍結。 ----
// 競技サーキット spec は courses.json と同一 (再現性のためインライン)。
const circuit = buildFromSpec({ name:'競技サーキット (フルスケール)', kind:'track', shape:'superellipse', rx:360, ry:230, k:0.55, width:28, samples:160 });
const ccSrc = prog('comp_circuit').src;   // Circuit Racer (再チューン済 v2 全舵デューティ)
const csSrc = prog('comp_slip').src;       // Slip Attack (ドリフト FR)
// f2: 3車種 (FF/FR/AWD) が Circuit Racer で独立走行 (interact:false)・normal タイヤ・1周・rejoin。
//     FF は清潔に周回・FR/AWD はオーバーステアでスピン (実車スケールの安定性レッスン=course desc)。
const r2 = runRace({ report:true, physics:'v2', regime:'fullscale', course:circuit, laps:1, interact:false,
  field:['normal_ff','normal_fr','normal_awd'].map((ct,i)=>({ name:'C'+i, lang:'c', src:ccSrc, carType:ct, rear:false, encoder:false })),
  crashRule:{rejoin:true,penaltySec:3}, maxSec:200 });
// f3: ドリフト FR + slip タイヤ・単独・1周・rejoin。ToF×3+3値ステアでは姿勢を読めず持続ドリフト不成立=
//     コーナーでスピン(β→180°)=ドリフト経路。canon に tire=['slip'] キーが付く(AO6)。
const r3 = runRace({ report:true, physics:'v2', regime:'fullscale', course:circuit, laps:1, interact:false,
  field:[{ name:'C0', lang:'c', src:csSrc, carType:'drift_fr', rear:false, encoder:false, tire:'slip' }],
  crashRule:{rejoin:true,penaltySec:3}, maxSec:120 });

const sig = (r) => `verify=${r.verifyHash} fin=${r.finishers.length} laps=${r.report.map(x=>x.lapsCompleted).join(',')}`;
console.log('f0(oval3・dyn):    ', sig(r0));
console.log('f1(oval2rejoin・dyn):', sig(r1));
console.log('f2(circuit3・v2・normal):', sig(r2));
console.log('f3(circuit・v2・slip drift):', sig(r3));

// ---- 凍結値との照合 (アサートゲート・1つでもズレたら exit(1)) ----
// FROZEN は wf_frozen_manifest.json 由来 (AP3・刻み直しは wf_refreeze.mjs)。
const got = { f0:r0.verifyHash, f1:r1.verifyHash, f2:r2.verifyHash, f3:r3.verifyHash };
let ok = true;
for (const k of Object.keys(FROZEN)) {
  const pass = got[k] === FROZEN[k];
  if (!pass) { ok = false; console.error(`  ✗ ${k}: got ${got[k]} expected ${FROZEN[k]}`); }
  // 全車の最終座標が有限であることも確認 (発散/NaN 検出)。
}
const allFinite = [r0,r1,r2,r3].every(r => r.report.every(x => Number.isFinite(x.finalX) && Number.isFinite(x.finalY)));
if (!allFinite) { ok = false; console.error('  ✗ 非有限な最終座標 (発散/NaN)'); }
if (ok) { console.log('OK: f0/f1/f2/f3 全て凍結値と一致・全座標有限'); }
else { console.error('FAIL: 凍結値と不一致 (物理/プログラム/config が変わった)'); process.exit(1); }
