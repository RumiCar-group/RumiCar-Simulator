// Stage AK7 (GitHub #26 続報・実態容量): このコース×領域×スケールで「実際に走り出せる最大台数」を
// **本物のレースエンジン (runRace) を回して** 測る。AK3 の静的 fitsAllCars (壁交差0・前方0.5車長クリア)
// では、最狭のナローシケイン・レイアウトのように「静的には置けるが normal_fr がコーナー壁へ舵を切り込んで
// 単独で楽め込む」スポーンを区別できない (実測: 静的クリアランスは正準オーバルの方が悪いのに正常走行)。
// よって容量は静的幾何でなく **実走 (発走順次化ゲート込み・recover ON) で全車が carLen 以上動けるか** で
// 測るしかない。driveableCapN = max{ n∈1..maxN : 1..n 台すべてが走り出せる }。
//
// 設計判断: ① 判定プログラムは normal_fr (既定サンプル=容量の保守的代表・楽め込みが顕在化する母体)。
//   ② trackNet (観測のみ=verifyHash 不変) で各車の spawn からの最大変位を読み、 < carLen かつ非クラッシュを
//   「走り出せない」とする (wf_recover_model と同一述語=ライブとゲートが同じオラクルを使う・CI-9)。
//   ③ 結果は (course.name, regime, carLen) でキャッシュ (スケール依存=carLen に内包・領域依存=regime)。
//   ④ ライブは tabletop でのみ使う (楽め込みバグと判定述語の母体は卓上。fullscale は専用コース×凍結グリッド)。
import { runRace } from './race_engine.js';
import { CAR, FLEET } from './config.js';
import { PROGRAM_BY_KEY } from './programs.js';

const _cache = new Map();
const _field = (n) => { const p = PROGRAM_BY_KEY['normal_fr']; return Array.from({ length: n }, () => ({ lang: p.lang, src: p.code, carType: p.carType })); };

// この (course, regime, 現 CAR 寸法) で n 台を実走させ「走り出せない車 (最大変位 < carLen・非クラッシュ)」数。
export function stuckAtN(course, regime, n) {
  const r = runRace({ course, regime, laps: 2, field: _field(n), crashRule: { rejoin: true, penaltySec: 3 }, interact: true, maxSec: 14, trackNet: true, fitGuard: false });
  let s = 0;
  for (let i = 0; i < r.netMax.length; i++) if (r.netMax[i] < CAR.length && !r.carCrashed[i]) s++;
  return s;
}

// 実態容量: 1..n 台すべてが走り出せる最大 n。発走順次化ゲートにより卓上は単調 (n台 OK なら n-1 台も OK) な
// ので **maxN から下げて最初に全車走り出せた台数** で確定する (=clean なコースは1走で maxN 確定。ナローシケインは
// 6→5→4 で確定)。単調性は wf_recover_model が「stuck⊆{n>capN}」で構造検査 (破れたら CI が落ちる)。
export function driveableCapN(course, regime, maxN = FLEET.maxCars) {
  const key = `${course.name}|${regime || 'tabletop'}|${CAR.length.toFixed(4)}|${maxN}`;
  if (_cache.has(key)) return _cache.get(key);
  let cap = maxN;
  while (cap >= 1 && stuckAtN(course, regime, cap) > 0) cap--;
  if (cap < 1) cap = 1;   // 1台は必ず置ける (構造上の下限)
  _cache.set(key, cap);
  return cap;
}
