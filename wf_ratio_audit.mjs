// Stage Y / Y1 監査: enforceFitRatio の band 収束を全コース×領域で機械確認 (実 buildFromSpec)。
// band = 実効車長 CAR.length ≤ 0.25×minDim。比率を動かす入力は regime(regimeK)×carScale(userK)。
import { buildFromSpec } from './public/js/course.js';
import { REGIMES, CAR } from './public/js/config.js';
import fs from 'fs';
const specs = JSON.parse(fs.readFileSync('./public/data/courses.json','utf8'));
const BASE_LEN = 0.19;                         // config.js CAR_BASE.length (起点)
const kL = (r) => REGIMES[r].L / REGIMES.tabletop.L;   // regimeK = regime.L / 卓上L
const effLen = (regime, userK) => BASE_LEN * kL(regime) * userK;
// guard の最終状態をシミュレート (regime, userK 初期 → 補正後)。
function simulate(course, regime0, userK0) {
  const minDim = Math.min(course.bounds.w, course.bounds.h);
  const target = 0.25 * minDim;
  const noRace = course.noRace === true;
  let regime = regime0, userK = userK0;
  // ① noRace 大型 → fullscale
  if (noRace && minDim >= 50 && regime !== 'fullscale') regime = 'fullscale';
  // ② 通常×fullscale 過大 → tabletop
  if (!noRace && regime === 'fullscale' && effLen(regime, userK) > target) regime = 'tabletop';
  // ③ carScale クランプ
  if (effLen(regime, userK) > target) {
    const lenAtUserK1 = effLen(regime, userK) / userK;
    const maxUserK = target / lenAtUserK1;
    userK = Math.max(0.4, Math.floor(maxUserK * 10) / 10);
  }
  return { regime, userK, len: effLen(regime, userK), target, minDim, fits: effLen(regime, userK) <= target + 1e-9 };
}
let noopFail=0, fitFail=0, n=0;
const scenarios = [['tabletop',1],['tabletop',0.8],['fullscale',1],['fullscale',0.5],['midscale',1],['tabletop',4],['midscale',4]];
for (const s of specs) {
  const c = buildFromSpec(s); n++;
  // 既定経路 (tabletop, userK=1) で補正が発火しない (no-op) こと
  const def = simulate(c, 'tabletop', 1);
  const defNoop = (def.regime === 'tabletop' && Math.abs(def.userK-1) < 1e-9);
  if (!defNoop && !c.noRace) { noopFail++; console.log('NOOP-FAIL (non-noRace default corrected):', s.name, def); }
  // 各シナリオで最終 fit
  for (const [r,u] of scenarios) {
    const res = simulate(c, r, u);
    if (!res.fits) { fitFail++; console.log('FIT-FAIL:', s.name, 'from', r, u, '→', res); }
  }
}
console.log(`\n${n} courses × ${scenarios.length} scenarios. noopFail=${noopFail} fitFail=${fitFail}`);
const ratioPass = (noopFail === 0 && fitFail === 0);
console.log(ratioPass ? 'PASS: 既定経路 no-op (非noRace) ＋ 全シナリオで band 収束 (OVERFLOW=0)' : 'FAIL');
// AP3: FAIL でも exit 0 だった常設ゲートのバグを修正 (26 ゲート中これだけ CI を落とせなかった)。
if (!ratioPass) process.exit(1);
