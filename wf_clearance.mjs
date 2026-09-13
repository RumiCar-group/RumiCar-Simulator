// Stage AI 測定ゲート (CI-14・追跡): 配置時の最小クリアランスを連続量で測り、本番ロジックと同じ
// 脆弱判定 (minClearance < FRAGILE_FRAC×CAR.width) を実 minClearance オラクルで再現する (再実装しない・CI-9)。
// 主張: 既定プレイ(既定台数=1) は全コースで非脆弱=no-op / 多台数(=6台)を狭コースへ詰めると脆弱が検出される。
// AG1 後の実ガード applyNewGuard を通して配置を本番フローに揃える。
import fs from 'fs';
import { buildFromSpec } from './public/js/course.js';
import { minClearance } from './public/js/fleet.js';
import { setRegimeScale, setCarScale, CAR, FLEET, REGIMES } from './public/js/config.js';
import { settleScale } from './public/js/fitguard.js';

const specs = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
const N = FLEET.maxCars;
const FRAGILE_FRAC = 0.05;   // main.js FRAGILE_CLEARANCE_FRAC と一致 (決定ログ AI-1)
const kL = r => REGIMES[r].L / REGIMES.tabletop.L;
// 【AZ6・2026-09-13】**判定の写しを置かない。** 領域と carScale の確定は product の判定コア
// `public/js/fitguard.js` の `settleScale` を呼ぶ（ライブ main.js が呼ぶのと同じ関数）。
// 旧実装はここに ①②③④ を書き写しており、下限 0.4 のハードコードが product（現 FIT.userKMin=0.5）
// と食い違ったまま黙って腐る形だった。効果フックはスケールを当てるだけ（DOM も告知も無い）。
const settleFx = {
  regime: (name) => { setRegimeScale(kL(name)); },
  scale: (uk) => setCarScale(uk),
  sync: () => {},
  log: () => {},
};
function applyNewGuard(course, regime0, userK0) {
  setRegimeScale(kL(regime0)); setCarScale(userK0);
  return settleScale(course, { regime: regime0, userK: userK0, slotCount: N, reason: 'course' }, settleFx);
}
const mm = m => (m * 1000).toFixed(2);
// 脆弱判定 = 本番 warnFragileClearance と同条件。CAR は配置時スケールに確定済み前提。
const fragile = (course, n) => minClearance(course, n) < FRAGILE_FRAC * CAR.width;

// [1] 既定(tabletop,0.8)・既定台数 n=1: 全コースで非脆弱 (no-op) でなければ FAIL
let def1Bad = 0, floor1 = Infinity, floor1n = '';
for (const s of specs) {
  const c = buildFromSpec(s); applyNewGuard(c, 'tabletop', 0.8);
  const mc = minClearance(c, 1);
  if (mc < floor1) { floor1 = mc; floor1n = s.name; }
  if (fragile(c, 1)) { def1Bad++; console.log('  DEF-1-FRAGILE(想定外)', s.name, mm(mc) + 'mm'); }
}
console.log(`[1] 既定(tabletop,0.8)・既定台数 n=1: 脆弱判定 = ${def1Bad}/${specs.length} (期待 0=no-op) | 床=${mm(floor1)}mm (${floor1n}, 車幅の ${(floor1 / CAR.width).toFixed(2)}×)`);

// [2] 既定スケールでも 6台詰め: 脆弱が検出される (連続量監視の検出力・正直さ)
let def6 = 0; const def6ex = [];
for (const s of specs) {
  const c = buildFromSpec(s); applyNewGuard(c, 'tabletop', 0.8);
  if (fragile(c, N)) { def6++; def6ex.push([s.name, mm(minClearance(c, N))]); }
}
console.log(`[2] 既定スケール×${N}台詰め: 脆弱検出 = ${def6}/${specs.length} (例 ${def6ex.slice(0, 3).map(e => `${e[0]} ${e[1]}mm`).join(' / ')})`);

// [3] ストレス(AG1後・userK0=4)×6台: 脆弱が検出される
let str6 = 0; const str6ex = [];
for (const s of specs) {
  const c = buildFromSpec(s); applyNewGuard(c, 'tabletop', 4);
  if (fragile(c, N)) { str6++; str6ex.push([s.name, mm(minClearance(c, N))]); }
}
console.log(`[3] ストレス(AG1後)×${N}台: 脆弱検出 = ${str6}/${specs.length} (例 ${str6ex.slice(0, 3).map(e => `${e[0]} ${e[1]}mm`).join(' / ')})`);

const pass = def1Bad === 0 && def6 > 0 && str6 > 0;
console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'}: 既定プレイ(1台) no-op=${def1Bad === 0} / 6台詰めで脆弱検出 既定=${def6 > 0} ストレス=${str6 > 0}`);
process.exit(pass ? 0 : 1);
