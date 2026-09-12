// Stage AK3 常設ゲート (GitHub #26 D6/D7・CI-14): 初期配置を「実態の収容容量」で持つことの構造検査。
// 本物のオラクル (freeSpawn / fitsAllCars / checkCollision / carEdges) を本番フローで呼ぶ (CI-8/CI-9)。
// 代理量 (0.25×外形最小辺) でなく実態 (実際に N 台を置いて壁交差0・重なり0で並べられるか) を測る。
//
// 「実態容量」capN = max{ N∈0..maxCars : fitsAllCars(course,N) } を本物の freeSpawn で測る。
//  capN=0 は「車が外形よりも大きく1台も置けない」regime 誤用 (例: 小さな卓上コースをフルスケール領域で
//  使う) で、ライブは enforceFitRatio が領域/スケールを自動補正してこの状態に留まらせない=配置に
//  到達しない。よって capN=0 構成には配置健全性を課さず「代理が fits と言うなら必ず capN≥1」(代理の健全性)
//  だけを要求する。capN≥1 のライブ到達構成では:
//
//  ⚠【2026-09-12・Stage AZ2 で是正】**上の「ライブは到達しない」は偽である。** 利用者投稿コース
//    (外形 18.36×18.71m・スタート地点の廊下幅 0.300m) は、代理量 target=0.25×外形最小辺=4.59m が
//    車長 3.80m を「収まる」と言うため ② が発火せず、④ も carScale 下限で諦め、**capN=0 のまま
//    落ち着いていた**（= 6 台全部が壁の中に湧く）。
//    AZ2 は enforceFitRatio に ④'（実態 fitsAllCars(course,1) が偽なら卓上へ戻す）を足してこの穴を塞いだが、
//    **これは「到達しない」保証ではない**。実測で正確に言えるのは次の 3 点だけ:
//      ・出荷コースを capN≥1 に保っているのは ② と ④ である（④' は出荷 66 コース × 3 領域 × 6 carScale で
//        **一度も発火しない**＝`wf_az2_fitguard.mjs` の A) が 0 件で示す）。
//      ・④' は **noRace と、既に卓上の場合を対象外にする**。その 2 つでは capN=0 のまま ⑤ が 1 台へ丸め、
//        `log.capZeroWarn` で告知する経路が残る。
//      ・∴ 下の `capN < 1 → continue` は「ライブに無い状態だから見ない」ではなく、
//        **「静的配置の健全性を課す対象外」** と読むこと。
//    D) `proxyOverest` は **昇格させない**（情報のまま）: これは「あるセル単体で代理と実態が食い違う」
//    ことしか言わず、ライブがそのセルに落ち着くかを問わないので、ガードが正しく救済するセルまで赤にする。
//    守るべき不変条件は「**ガードが落ち着いた先で capN≥1**」で、これは `wf_az2_fitguard.mjs` が扱う。
//    **この注記を消すなら、先にそちらのゲートを読むこと。**
//   A) freeSpawn は idx 0..maxCars-1 のどれでも「壁交差する点」を決して返さない (壁内スタート根絶=criterion a)。
//   B) capN 台を独立に再配置すると全車「壁交差0・他車重なり0・idx≥1 が start に団子0」で並ぶ
//      (= enforceFitRatio が台数を capN へ減らせば「走り出せない車0」が静的に保証される=criterion b/c)。
//   C) 単調性: 1..capN すべてで fitsAllCars=true (capN 以下は必ず収まる)。
//  さらに全構成共通で:
//   D) 代理の健全性: CAR.length ≤ 0.25×minDim (代理が「単独車は収まる」と言う) ⟹ capN≥1 (実際に1台は収まる)。
// 違反があれば非ゼロ終了で CI が落とせる。
import fs from 'fs';
import { buildFromSpec } from './public/js/course.js';
import { Car, checkCollision, carEdges } from './public/js/physics.js';
import { freeSpawn, fitsAllCars } from './public/js/fleet.js';
import { setCarScale, setRegimeScale, CAR, FLEET } from './public/js/config.js';

const specs = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
const REGIMES = { tabletop: 1, midscale: 2, fullscale: 20 };
const SCALES = [0.4, 0.5, 0.8, 1, 2, 4];
const MAXN = FLEET.maxCars;

let pass = true;
const fails = { wallcross: [], capPlace: [], monotone: [] };
const proxyOverest = [];   // 情報のみ: 長さ代理(0.25×minDim)は「収まる」だが driveable では capN=0 の隅
let capZero = 0, reachable = 0;

function placeAndCheck(course, n) {           // n 台を freeSpawn(occupied 累積) で置いて違反を返す (本物)
  const occupied = [], cars = [];
  const st = course.start;
  let wallcross = 0, overlap = 0, wedge = 0, blocked = 0;
  for (let i = 0; i < n; i++) {
    const sp = freeSpawn(course, occupied, i);
    const car = new Car(sp);
    if (checkCollision(car, course.walls)) wallcross++;                          // 壁交差 (本物)
    for (const o of cars) if (checkCollision(car, [], carEdges(o))) overlap++;   // 他車重なり (本物)
    if (i >= 1 && Math.hypot(sp.x - st.x, sp.y - st.y) < 1e-6) wedge++;          // idx≥1 が start=団子
    const fch = Math.cos(sp.theta), fsh = Math.sin(sp.theta), fc = 0.5 * CAR.length;
    if (checkCollision(new Car({ x: sp.x + fc * fch, y: sp.y + fc * fsh, theta: sp.theta }), course.walls)) blocked++; // 前方が壁=発走不能
    occupied.push(sp); cars.push(car);
  }
  return { wallcross, overlap, wedge, blocked };
}

for (const spec of specs) {
  let course; try { course = buildFromSpec(spec); } catch { continue; }
  const b = course.bounds, minDim = Math.min(b.w, b.h);
  for (const [rk, K] of Object.entries(REGIMES)) {
    setRegimeScale(K);
    for (const uk of SCALES) {
      setCarScale(uk);
      const tag = `${spec.name}|${rk}|cs${uk}|len${CAR.length.toFixed(3)}`;
      const proxyFits = CAR.length <= 0.25 * minDim;                 // 代理量の判定 (enforceFitRatio の target)
      let capN = MAXN; while (capN >= 1 && !fitsAllCars(course, capN)) capN--;   // 実態容量 (0..MAXN・本物)

      // D) 情報のみ (AK4/動的の領分): 長さ代理 (0.25×minDim) は「単独車は収まる」と言うが、駆け出し方向の
      //    余地 (driveable) では capN=0 になる隅 = 巨大 carScale (例 cs4) を曲がり際スタートのコースに使った
      //    場合。1台でも「走り出せない」=静的配置でなく走り出し (操舵/後退リカバリ) の問題ゆえ AK4 で扱う
      //    (この帯はライブで carScale を手動最大にした極端設定。本ゲートは A/B/C の静的保証を判定対象とする)。
      if (proxyFits && capN < 1) proxyOverest.push(`${tag} proxyFits but capN=0 (driveable=走り出せない=AK4)`);

      if (capN < 1) { capZero++; continue; }   // regime 誤用 (車が外形より大)=ライブは到達しない・配置を課さない
      reachable++;

      // A) freeSpawn は壁交差点を返さない (proxyFits=ライブが領域/スケール補正後に落ち着く到達状態のみ。
      //    !proxyFits の巨大車構成は enforceFitRatio② ③ が領域/スケールを自動補正し配置に到達しない=
      //    そこでは「収まらなければ台数を減らす」=criterion a の後段が効く)。idx 0..MAXN-1 を逐次。
      if (proxyFits) {
        const occupied = [];
        for (let i = 0; i < MAXN; i++) {
          const sp = freeSpawn(course, occupied, i);
          if (checkCollision(new Car(sp), course.walls)) { fails.wallcross.push(`${tag} idx${i}`); pass = false; }
          occupied.push(sp);
        }
      }
      // B) capN 台配置の健全性 (壁交差0・重なり0・団子0・発走不能0=走り出せる)
      const chk = placeAndCheck(course, capN);
      if (chk.wallcross || chk.overlap || chk.wedge || chk.blocked) { fails.capPlace.push(`${tag} capN=${capN} ${JSON.stringify(chk)}`); pass = false; }
      // C) 単調性: capN 以下はすべて収まる
      for (let k = 1; k <= capN; k++) if (!fitsAllCars(course, k)) { fails.monotone.push(`${tag} k=${k}<=capN=${capN}`); pass = false; }
    }
  }
}

const N = specs.length * Object.keys(REGIMES).length * SCALES.length;
console.log(`Stage AK3 収容容量ゲート — ${specs.length} コース × ${Object.keys(REGIMES).length} 領域 × ${SCALES.length} スケール = ${N} 構成`);
console.log(`  ライブ到達 (capN≥1): ${reachable} 構成 / regime 誤用 (capN=0・車が外形より大・ライブ自動補正): ${capZero} 構成`);
const show = (label, arr, n = 6) => {
  console.log(`  ${arr.length === 0 ? '○' : '✗'} ${label}: ${arr.length} 件`);
  arr.slice(0, n).forEach(s => console.log(`       - ${s}`));
  if (arr.length > n) console.log(`       … 他 ${arr.length - n} 件`);
};
show('A) freeSpawn が壁交差点を返した (proxyFits=ライブ到達状態)', fails.wallcross);
show('B) capN 台配置に壁交差/重なり/団子/発走不能', fails.capPlace);
show('C) capN 以下で fitsAllCars=false (単調性違反)', fails.monotone);
console.log(`  ◇ 情報) 長さ代理 fits だが driveable で capN=0 (極端 carScale×曲がり際スタート=AK4 走り出し/リカバリの領分): ${proxyOverest.length} 件`);
proxyOverest.slice(0, 6).forEach(s => console.log(`       - ${s}`));
console.log('='.repeat(62));
console.log(pass ? 'AK3 収容容量ゲート (A/B/C 静的保証): 全パス ○' : 'AK3 収容容量ゲート: ✗ 不合格');
console.log('='.repeat(62));
process.exit(pass ? 0 : 1);
