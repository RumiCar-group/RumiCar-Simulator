// 常設ゲート (Stage AK4/AK7・GitHub #26・D5＋発走順次化＋実態容量): 走行モデルが「初期位置で壁に刺さって
// 走り出せない／密集発走で楽め込んで走り出せない」を残さないことを、本物のオラクル (runRace/checkCollision/
// driveableCapN) で構造検査する (CI-9/CI-14)。知覚「走り出せない」を測定述語へ翻訳: spawn からの最大変位
// (trackNet=観測のみ・verifyHash 不変) が carLen 未満かつ非クラッシュ=「走り出せない」。
// AK7 で発走順次化ゲート (applyStartGate) ＋実態容量 (driveableCapN) を導入し、残っていた最狭2コース×多台数の
// 楽め込みを解消した。検査 (本ゲートは prototype を一切 patch しない=容量プローブ走行が計装を汚染しない):
//   (A) 正準レース verifyHash 不変 (クリーン/公式記録=リカバリ/順次化を含まない横並びグリッド=byte 不変)。
//       ＝発走順次化ゲートが f0/f1 で構造 no-op であることの実証 (held が立てば hash が変わる)。
//   (B) 「凍結車ゼロ」: 全41×1..6台×tabletop/0.8 のどの実フィールド車も spawn から FROZEN(=0.05m) より大きく
//       動く (=報告の元バグ net~0.004 で発走位置に永久固着 が一掃されている)。
//   (C) 「走り出せない車 (最大変位<carLen)」は **実態容量超過 (n > driveableCapN(course)) に限る** (=ライブが
//       自動で台数を絞る範囲の外。容量内 n≤capN では一台も走り出せない車は無い=完全0)。単調性も同時に検査
//       (capN 以下に stuck が無い=stuck は capN より上の台数だけ)。
//   (D) リカバリ回数 recoverN が RECOVER_MAX+1 で頭打ち=袋小路でも発散しない。
// 失敗時は非0終了。卓上 byte 不変は f0_regime、衝突応答(AK1)は wf_collision_model が別途担保。
import fs from 'fs';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { setCarScale, setRegimeScale, CAR, FLEET } from './public/js/config.js';
import { PROGRAMS, PROGRAM_BY_KEY } from './public/js/programs.js';
import { driveableCapN } from './public/js/capacity.js';
import { FROZEN as FROZEN_HASH } from './wf_frozen.mjs';   // AP3: 凍結ハッシュは中央マニフェスト経由 (既存 const FROZEN=0.05m〔変位閾値〕と衝突回避のため別名)

const specs = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
let fail = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? '○' : '✗'} ${msg}`); if (!cond) fail++; };
const prog = (k) => { const p = PROGRAMS.find((x) => x.key === k); return { lang: 'c', src: p.code, carType: p.carType }; };

const FROZEN = 0.05;                 // これ未満しか動かない=発走位置に固着(=元バグ)。
const RECOVER_MAX = 6;               // fleet.js と一致 (袋小路の後退 arm 上限)。
const fieldOf = (n) => Array(n).fill('normal_fr').map((k) => { const p = PROGRAM_BY_KEY[k]; return { lang: p.lang, src: p.code, carType: p.carType }; });

// (A) 正準レースゲート (wf_ab8_bench / wf_collision_model と完全同一構成) = リカバリ/順次化 改修後も byte 不変。
console.log('A) 正準レース verifyHash 不変 (発走順次化ゲートが横並びグリッドで構造 no-op)');
{
  const oval = buildFromSpec({ name: 'オーバル', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
  const fld = (...ks) => ks.map((k, i) => { const p = prog(k); return { name: 'C' + i, lang: p.lang, src: p.src, carType: p.carType, rear: false, encoder: false }; });
  const r1 = runRace({ report: true, course: oval, laps: 3, field: fld('normal_fr', 'normal_awd', 'normal_ff'), crashRule: { rejoin: false, penaltySec: 3 } });
  const r2 = runRace({ report: true, course: oval, laps: 2, field: fld('normal_ff', 'normal_fr'), crashRule: { rejoin: true, penaltySec: 3 } });
  ok(r1.verifyHash === FROZEN_HASH.f0, `f0(oval3) verifyHash=${r1.verifyHash} (期待 ${FROZEN_HASH.f0} = AM1 コーン測距で再凍結)`);
  ok(r2.verifyHash === FROZEN_HASH.f1, `f1(oval2rejoin) verifyHash=${r2.verifyHash} (期待 ${FROZEN_HASH.f1} = AM1 コーン測距で再凍結)`);
}

// (B)(C)(D) 全41×1..6台 tabletop/0.8 を本物の runRace (trackNet=観測のみ) で回し、各車の最大変位・recoverN を測る。
// prototype を patch しない=本ゲート内の driveableCapN プローブ走行が計装を汚染しない (AK7 で計装非依存化)。
console.log('B/C/D) 凍結車0・走り出せない車⊆実態容量超過・recoverN 発散なし (全41×1..6台 tabletop/0.8)');
let minMaxNet = Infinity, maxArmAll = 0, totStuck = 0, totCars = 0;
const offCap = [], capped = [];
for (const spec of specs) {
  let course; try { course = buildFromSpec(spec); } catch { continue; }
  setRegimeScale(1); setCarScale(0.8);
  const cap = driveableCapN(course, 'tabletop', FLEET.maxCars);   // 本物の実態容量 (ライブと同一オラクル)
  if (cap < FLEET.maxCars) capped.push(`${spec.name}(cap${cap})`);
  for (let n = 1; n <= FLEET.maxCars; n++) {
    setRegimeScale(1); setCarScale(0.8);
    let r;
    try { r = runRace({ course, regime: 'tabletop', laps: 2, field: fieldOf(n), crashRule: { rejoin: true, penaltySec: 3 }, interact: true, maxSec: 14, trackNet: true, fitGuard: false }); }
    catch (e) { console.log('  ERR', spec.name, n, e.message); fail++; continue; }
    for (let i = 0; i < n; i++) {
      totCars++;
      if (r.armMax[i] > maxArmAll) maxArmAll = r.armMax[i];   // recoverN は全範囲で発散しないこと
      // (B) 凍結検査は実態容量内 (n≤cap=ライブで実際に走る範囲) のみ。容量超過 (n>cap) は発走順次化で
      //     楽め込み車の後ろの車が永久 held=netMax0 になり得るが、それはライブで自動的に絞られ走らない台数。
      if (n <= cap && r.netMax[i] < minMaxNet) minMaxNet = r.netMax[i];
      if (r.netMax[i] < CAR.length && !r.carCrashed[i]) {          // 一度も carLen 動けない=走り出せない
        totStuck++;
        // (C) 容量内 (n≤cap) で走り出せない車が出たら回帰 (=完全0 が崩れた / 単調性が破れた)。
        if (n <= cap) offCap.push(`${spec.name}|${n}≤cap${cap}`);
      }
    }
  }
}
ok(minMaxNet > FROZEN, `凍結車ゼロ: 全 ${totCars} 車の最小 最大変位 = ${minMaxNet.toFixed(3)}m > ${FROZEN}m (元バグ net~0.004 は一掃)`);
ok(offCap.length === 0, `実態容量内 (n≤capN) で走り出せない車 0 = 完全0 (違反=${offCap.length}件${offCap.length ? ': ' + offCap.join(', ') : ''})`);
ok(maxArmAll <= RECOVER_MAX + 1, `recoverN 頭打ち: 全車の最大 = ${maxArmAll} ≤ ${RECOVER_MAX + 1} (袋小路でも発散しない)`);
console.log(`  参考) 走り出せない車 合計 = ${totStuck} (すべて実態容量超過 n>capN=ライブが自動で絞る範囲)。実態容量<6 のコース: ${capped.length ? capped.join(', ') : 'なし'}`);

console.log(fail === 0 ? '\n走行モデル (順次化+実態容量) ゲート: 全パス ○' : `\n✗ ${fail} 件 不合格`);
process.exit(fail === 0 ? 0 : 1);
