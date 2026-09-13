// Stage Y / Y1 監査: enforceFitRatio の band 収束を全コース×領域で機械確認 (実 buildFromSpec)。
// band = 実効車長 CAR.length ≤ 0.25×minDim。比率を動かす入力は regime(regimeK)×carScale(userK)。
import { buildFromSpec } from './public/js/course.js';
import { REGIMES, CAR, FLEET, setRegimeScale, setCarScale } from './public/js/config.js';
import { settleScale, FIT } from './public/js/fitguard.js';
import { fitsAllCars } from './public/js/fleet.js';
import fs from 'fs';
const specs = JSON.parse(fs.readFileSync('./public/data/courses.json','utf8'));
const kL = (r) => REGIMES[r].L / REGIMES.tabletop.L;   // regimeK = regime.L / 卓上L
// 【AZ6・2026-09-13】**判定の写しを置かない。** 旧実装はここに ①②③ を書き写し、代理量 0.25 と下限 0.4 を
// ハードコードしていた（product が FIT.userKMin=0.5 へ動いた時点で黙って腐る形）。本監査は
// 「`enforceFitRatio` の band 収束」を主張するものなので、**product の判定コアそのもの**を呼ぶ。
// 写しでは ④（実 fitsAllCars で N 台ぶん追加縮小）が無かったが、本物は ④④' も通るので
// 「band に収まる」の主張はより強い側へ動く（縮む方向にしか動かないため）。
const settleFx = { regime: (n) => { setRegimeScale(kL(n)); }, scale: (uk) => setCarScale(uk), sync: () => {}, log: () => {} };
function simulate(course, regime0, userK0) {
  const minDim = Math.min(course.bounds.w, course.bounds.h);
  const target = FIT.proxyFrac * minDim;
  setRegimeScale(kL(regime0)); setCarScale(userK0);
  const r = settleScale(course, { regime: regime0, userK: userK0, slotCount: FLEET.maxCars, reason: 'course' }, settleFx);
  const len = CAR.length;   // 判定コアが確定させた実効車長（本物の CAR 寸法）
  return { regime: r.regime, userK: r.userK, len, target, minDim, fits: len <= target + 1e-9 };
}
let regimeFail=0, unfoundedFail=0, overClampFail=0, fitFail=0, n=0, clamped=0;
const scenarios = [['tabletop',1],['tabletop',0.8],['fullscale',1],['fullscale',0.5],['midscale',1],['tabletop',4],['midscale',4]];
// **【AZ6・2026-09-13】主張を実測に合わせ直した。**
//   旧: 「既定経路 (tabletop, userK=1) では補正が一切発火しない (no-op)」。
//   これは**写しが ①②③ しか持っていなかったから言えていた**だけで、本物の判定コアを通すと
//   ④（N台フィット保証・実 fitsAllCars）が発火して **carScale が縮むコースが 10 本**ある（卓上 cs1・
//   実測 2026-09-13。cs0.8 では 5 本。いずれも狭路の峠/ベンチ系で、入口で 6 台が収まらない）。
//   **「補正が発火したコース」は 12 本／7 本で、数え方が違うだけ**——その差 2 本は noRace の大型コース
//   （競技グラウンド／競技サーキット）で、① が領域を fullscale へ上げるだけで carScale は動かさない。
//   下の `clamped` が数えるのは **carScale が動いた本数**なので 10／5 である（件数を書くときは
//   「何を数えた数か」まで書く）。
//   これは AG1 以来の**意図した設計**であって AZ6 の変更ではない。∴ 守るべきものを言い直す:
//     ① 非 noRace の既定経路で **領域は変わらない**（②③ の代理量補正が既定で発火しない）。
//     ② carScale が縮んだセルは **入口で fitsAllCars(maxCars) が偽**（＝根拠のない縮小をしない）。
//     ②' さらに **1 段上（+0.1）では収まらない**（＝必要以上に縮めていない・下限で床打ちした場合を除く）。
//     ③ 全シナリオで band 収束（実効車長 ≤ 0.25×外形最小辺）。
for (const s of specs) {
  const c = buildFromSpec(s); n++;
  // 既定経路 (tabletop, userK=1): 領域は変わらない (非 noRace)
  const def = simulate(c, 'tabletop', 1);
  if (def.regime !== 'tabletop' && !c.noRace) { regimeFail++; console.log('REGIME-FAIL (non-noRace default changed regime):', s.name, def); }
  // carScale が縮んだなら、その根拠 (入口で maxCars 台が収まらない) が実オラクルで立つこと
  if (Math.abs(def.userK - 1) > 1e-9) {
    clamped++;
    setRegimeScale(kL('tabletop')); setCarScale(1);
    if (fitsAllCars(c, FLEET.maxCars)) {
      unfoundedFail++;
      console.log('UNFOUNDED-CLAMP (縮めたのに入口で maxCars 台が収まっている):', s.name, def);
    }
    // **「縮めた根拠がある」だけでは緩い**（0.9 で足りるのに 0.5 まで削っても通ってしまう。
    //   層 4 レビュー 2026-09-13 の指摘）。**1 段上（+0.1）では収まらない**ことまで固定する
    //   ＝「必要最小限しか縮めていない」。下限で床打ちした場合（＝それ以上縮められない）は対象外。
    if (def.userK > FIT.userKMin + 1e-9) {
      const up = Math.round((def.userK + 0.1) * 10) / 10;
      setRegimeScale(kL('tabletop')); setCarScale(up);
      if (fitsAllCars(c, FLEET.maxCars)) {
        overClampFail++;
        console.log(`OVER-CLAMP (cs${up} でも ${FLEET.maxCars} 台収まるのに cs${def.userK} まで縮めた):`, s.name);
      }
    }
  }
  // 各シナリオで最終 fit
  for (const [r,u] of scenarios) {
    const res = simulate(c, r, u);
    if (!res.fits) { fitFail++; console.log('FIT-FAIL:', s.name, 'from', r, u, '→', res); }
  }
}
console.log(`\n${n} courses × ${scenarios.length} scenarios (判定コア = public/js/fitguard.js:settleScale)`);
console.log(`  既定 (tabletop, cs1) で carScale が縮んだコース: ${clamped} 件（④ N台フィット保証・AG1 の設計どおり）`);
console.log(`  regimeFail=${regimeFail} unfoundedFail=${unfoundedFail} overClampFail=${overClampFail} fitFail=${fitFail}`);
const ratioPass = (regimeFail === 0 && unfoundedFail === 0 && overClampFail === 0 && fitFail === 0);
console.log(ratioPass ? 'PASS: 既定経路で領域不変 (非noRace) ＋ 縮小には実オラクルの根拠あり ＋ 縮めすぎていない (1 段上では収まらない) ＋ 全シナリオで band 収束 (OVERFLOW=0)' : 'FAIL');
// AP3: FAIL でも exit 0 だった常設ゲートのバグを修正 (26 ゲート中これだけ CI を落とせなかった)。
if (!ratioPass) process.exit(1);
