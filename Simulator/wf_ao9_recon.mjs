// AO9 試走フェーズ (spec.recon) 常設アサートゲート。本番 runRace の決定論で:
//   ① byte 不変: recon 未指定 と recon:{laps:0} が同一 verifyHash (=既存 hash に載らない)。
//   ② 決定論: recon:{laps:2} を2回 → verifyHash/traceHash bit 一致。
//   ③ グローバル保持=本番挙動が変わる (真オラクル): recon:1 の traceHash ≠ recon:0 の traceHash。
//      traceHash は canon 非依存 (毎tick 状態チェックサム) ゆえ「学習地図/位相/走行距離が本番へ
//      持ち込まれ物理軌跡が変わった」ことの直接証拠 (=1周目挙動差・§12 AO9)。verifyHash 差だけでは
//      canon の recon キー由来と区別できないので trace で測る (代理量でなく実態=CI-14)。
//   ④ 計時外: recon:N の本番総時間 − recon:0 の総時間 < 1周ぶん。もし試走が on-clock なら N×1周ぶん
//      増えるはず=大幅超過で失敗する。1周未満の増加は「試走は計時に載っていない」ことの証拠。
//   ⑤ 自己記述 canon: recon:N>0 は canon に recon キーが載り recon:0 と別 verifyHash=別記録として
//      再現・照合できる (§7)。
// 補足 (実測知見): recon_racer は本番1周目に自前で試走 (phase0→1) する自己完結型ゆえ、事前 recon は
//   IT には概ね冗長 (recon:2/3 は走行距離 s が整数周ぶん整合し recon:0 と同一軌跡へ収束・recon:1 は
//   1周ぶんの走行距離オフセットで僅かに摂動)。機構の真価は「地図を前提に計画する」プログラム (AO11
//   Apex Strategist) 向け。本ゲートは機構 (グローバル保持) の健全性を recon:1 で担保する。
// 1つでもズレたら exit(1)。
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';

const prog = (key) => { const p = PROGRAMS.find((x) => x.key === key); return { src: p.code, lang: p.lang || 'c', carType: p.carType }; };
const circuit = buildFromSpec({ name: '競技サーキット (フルスケール)', kind: 'track', shape: 'superellipse', rx: 360, ry: 230, k: 0.55, width: 28, samples: 160 });
const rr = prog('recon_racer');
// recon_racer: FF・エンコーダ必須 (距離インデックス地図)。単独・v2・normal・rejoin。
const fieldRR = () => [{ name: 'RR', lang: rr.lang, src: rr.src, carType: rr.carType, rear: false, encoder: true }];
const base = { physics: 'v2', regime: 'fullscale', course: circuit, laps: 3, interact: false,
  crashRule: { rejoin: true, penaltySec: 3 }, maxSec: 400, report: true };

const run = (reconLaps, withTrace) => runRace({ ...base, field: fieldRR(),
  recon: reconLaps > 0 ? { laps: reconLaps } : (reconLaps === 0 ? { laps: 0 } : undefined),
  trace: !!withTrace });

const rNoKey = runRace({ ...base, field: fieldRR() });     // recon キー無し (undefined)
const r0     = run(0, true);                                 // recon:{laps:0} (trace で ③ の基準)
const r1     = run(1, true);                                 // recon:{laps:1} (trace で ③ を測る)
const r2a    = run(2, true);
const r2b    = run(2, true);
const r3     = run(3);

const tt = (r) => (r.finishers[0] ? r.finishers[0].totalTimeMs : null);
const bl = (r) => (r.finishers[0] ? r.finishers[0].bestLapMs : null);
const sig = (r) => `verify=${r.verifyHash} fin=${r.finishers.length} laps=${r.report[0].lapsCompleted} tt=${tt(r)!=null?Math.round(tt(r)):'-'}ms best=${bl(r)!=null?Math.round(bl(r)):'-'}ms`;
console.log('recon 無キー    :', sig(rNoKey));
console.log('recon:{laps:0}  :', sig(r0));
console.log('recon:{laps:1}  :', sig(r1));
console.log('recon:{laps:2} a:', sig(r2a), 'trace=' + r2a.traceHash);
console.log('recon:{laps:2} b:', sig(r2b), 'trace=' + r2b.traceHash);
console.log('recon:{laps:3}  :', sig(r3));

let ok = true;
const fail = (m) => { ok = false; console.error('  ✗ ' + m); };

// ① byte 不変: recon 未指定 と laps:0 が同一 (末尾キー無し=既存 hash に載らない)。
if (rNoKey.verifyHash !== r0.verifyHash) fail(`① recon 未指定 (${rNoKey.verifyHash}) ≠ laps:0 (${r0.verifyHash})`);
if (rNoKey.traceHash !== null) fail('① recon 未指定で trace 無効なのに traceHash が非 null');

// ② 決定論: recon:{laps:2} を2回 → verifyHash/traceHash bit 一致。
if (r2a.verifyHash !== r2b.verifyHash) fail(`② 非決定論 verifyHash ${r2a.verifyHash} ≠ ${r2b.verifyHash}`);
if (r2a.traceHash !== r2b.traceHash) fail(`② 非決定論 traceHash ${r2a.traceHash} ≠ ${r2b.traceHash}`);

// ③ グローバル保持=本番物理軌跡が変わる (真オラクル=traceHash・canon 非依存)。recon:1 は学習地図/位相/
//    走行距離が本番へ持ち込まれ recon:0 と別軌跡 (=1周目挙動差)。これが機構健全性の直接証拠。
if (r1.traceHash === r0.traceHash) fail(`③ recon:1 の traceHash が recon:0 と同一 (${r0.traceHash})=グローバルが本番へ伝わっていない`);

// ③' 完走: recon 有無いずれも 3 周完走 (recon_racer は独立走行で清潔=AN 基線)。
for (const [tag, r] of [['recon:0', r0], ['recon:1', r1], ['recon:2', r2a], ['recon:3', r3]]) {
  if (r.finishers.length !== 1) fail(`③' ${tag} が完走せず (fin=${r.finishers.length})`);
}

// ④ 計時外: recon:N の本番総時間 − recon:0 の総時間 < 1周ぶん (bestLapMs)。試走が on-clock なら
//    N×1周ぶん増えるはず=大幅超過で失敗する。1周未満の増加は「試走は計時に載っていない」ことの証拠。
if (tt(r0) != null) {
  const oneLap = bl(r0);
  for (const [tag, r] of [['recon:1', r1], ['recon:2', r2a], ['recon:3', r3]]) {
    if (tt(r) == null) { fail(`④ ${tag} 総時間なし`); continue; }
    if (tt(r) >= tt(r0) + oneLap) fail(`④ ${tag} 総時間 ${Math.round(tt(r))}ms ≥ recon:0 ${Math.round(tt(r0))}ms + 1周 ${Math.round(oneLap)}ms (試走が計時に混入=on-clock 疑い)`);
  }
}

// ⑤ 自己記述 canon: recon:N>0 は canon に recon キーが載り recon:0 と別 verifyHash=別記録として照合可 (§7)。
for (const [tag, r] of [['recon:1', r1], ['recon:2', r2a], ['recon:3', r3]]) {
  if (r.verifyHash === r0.verifyHash) fail(`⑤ ${tag} が recon:0 と同一 verifyHash (canon に recon キーが載っていない=記録が自己記述でない)`);
}

// ⑤ 有限性 (発散/NaN 検出)。
const allFinite = [rNoKey, r0, r1, r2a, r3].every(r => r.report.every(x => Number.isFinite(x.finalX) && Number.isFinite(x.finalY)));
if (!allFinite) fail('⑤ 非有限な最終座標 (発散/NaN)');

if (ok) console.log('OK: AO9 試走フェーズ ①byte不変 ②決定論 ③地図保持 ④計時外 ⑤有限 全て緑');
else { console.error('FAIL: AO9 試走フェーズのアサートに失敗'); process.exit(1); }
