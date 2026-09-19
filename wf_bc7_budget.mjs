// wf_bc7_budget.mjs — BC7 性能予算ゲート（常設アサートゲート・CI-8/9/14）。
// ════════════════════════════════════════════════════════════════════════════
// 【何を守る数字か】
//   旧基準 AP13「S4 µs/tick/台 ≤60」は **絶対時間の代理量** で、当時のホストで出た実測値
//   (44.1) を丸めたものだった。何台を何倍速で回すのかという要件から導かれていないため、
//   ホストが変わると意味が変わる（本ホストでは v7.8.0 でも中央値 60.6 ＝境界上・AW-3 (i)）。
//   本ゲートは同じ関心事を **アプリの実態パラメータから導出した量** で置き換える。
//
//   守る実態: 利用者が **FLEET.maxCars 台**を **UI が出せる最大の速度倍率**で走らせたとき、
//             シミュレーション時刻が実時間×速度倍率から遅れないこと。
//
//   導出: ライブの 1 フレームで進めるべきシム時間は `dt × speedMax`（main.js:493 `const sdt = real * speed;`）。
//         実時間比 R ≡ シム秒/壁秒 で回る物理は、その計算に `dt × speedMax / R` 秒かかる。
//         これを 1 フレーム `dt` のうち割合 φ 以下に収める要件は dt が約分されて
//               **R ≥ speedMax / φ**
//         となる（dt に依存しない＝フレームレートを仮定しない）。φ は「物理に許すフレームの取り分」で、
//         残り (1-φ) が描画・HUD・GC の取り分。φ = 1/4 を採る（実ブラウザで実測した物理の実取り分は
//         2〜6% ＝ φ に 4〜14 倍の余裕。BC7 決定ログ参照）。
//   ∴ 下限 R_min = speedMax / φ。speedMax と maxCars は **product から読む**ので、
//     アプリ側が速度上限や最大台数を変えたら下限は自動で追従する。
//   （φ・D 章の帯・実ブラウザ側の LAG_MAX は本ホスト実測から置いた定数で、これらは凍結値である。
//     「凍結した数字を持たない」のは **下限の導出元** だけ、という限定であることを明記しておく。）
//
// 【測っている経路とライブ経路の刻みの違い（過小評価ではなく過大評価＝安全側）】
//   本ゲートが時間を測るのは race_engine（`runRace`）で、ライブ経路（`main.js:integrateLive`）ではない。
//   刻みは一致しない:
//     ・v2   : ライブも race_engine も 1/`SIM.physicsHz`（`fleet.js:640` / `race_engine.js:49`）＝**一致**
//     ・dynamic/standard の多車 interact: ライブは 1 ステップ上限 1/`SIM.loopHz`（`main.js:475`・
//       `config.js:918` loopHz=20 ＝ 50ms）に対し race_engine は 1/`SIM.physicsHz`（=16.7ms）固定。
//       ∴ 同じシム秒あたり race_engine の方がステップ数が多く、`report:true` の観測コストも余分に払う。
//   つまり [dyn] の R は**ライブの実力より悲観側**に出る。下限を割れば赤になる向きなので偽の緑にはならないが、
//   [dyn] の数値をライブの実力そのものとして読んではならない。ライブ経路の実測は browser/check_bc7_frame.mjs。
//
// 【既存ゲートとの関係】`wf_ao5_calib.mjs` の J（fullscale v2 6 台 `simSec/wall ≥ 10×`）は、本ゲートの
//   [v2f] と**コース・領域・エンジン・フィールド・crashRule・interact がすべて同一**で、違いは
//   `laps`/`maxSec` だけ（J=40 周/60 秒・本ゲート=99 周/30 秒＝同じ軌跡の前半）。床は J が 10×、本ゲートが
//   speedMax/φ=12× なので**本ゲートの方が厳しく、J は本ゲートに包含される**。J は残してある（撤去は BC7 の
//   スコープ外）ので、E 章でこの包含関係が崩れていないことを毎回測る。
//
// 【旧基準との換算】R と µs/tick/台 は `µs = 1e6 / (RACE_HZ × nCars × R)` で 1 対 1 に対応する。
//   本ゲートはこの換算値も印字するので、旧記録（AP13 44.1・AW-3 60.6）と同じ土俵で読める。
//
// 【壁時計ゲートの扱い】WF_SKIP_TIMING=1 のとき**時間に依存する検査だけ**を skip する
//   （wf_ao5_calib J と同じ運用・AP21）。決定論と構造の検査は常に走る。
//
// 使い方: node wf_bc7_budget.mjs [--n <試行数>]     exit 0=PASS / 1=FAIL
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';
import { FLEET, APP_VERSION, SIM } from './public/js/config.js';
import { applyRegime } from './public/js/physics_dyn.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const courses = JSON.parse(readFileSync(join(ROOT, 'public/data/courses.json'), 'utf8'));
const RACE_HZ = SIM.physicsHz;            // race_engine の固定刻み = 1/SIM.physicsHz (race_engine.js:49)
const PHYS_SHARE = 1 / 4;                 // φ: 物理に許す 1 フレームの取り分
const nArg = process.argv.indexOf('--n');
const N = nArg >= 0 ? Number(process.argv[nArg + 1]) : 5;
// N を検査しないと、試行 0 回で ratios が空配列になり Math.min(...[])=Infinity＝**必ず緑**になる
// （原理的に失敗しえない検査になる）。ここで落とす。
if (!Number.isInteger(N) || N < 2) {
  console.error(`FAIL: --n は 2 以上の整数（受け取った値: ${process.argv[nArg + 1]}）。`
    + ' 1 回の測定で基準を判定しないため 2 未満は受け付けない。');
  process.exit(1);
}
const SKIP_TIMING = process.env.WF_SKIP_TIMING === '1';

let pass = 0, fail = 0, skipped = 0; const fails = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; fails.push(msg); console.log('  ✗ ' + msg); } };
const skip = (msg) => { skipped++; console.log('  ⤿ ' + msg); };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo); };
const usOf = (R, nCars) => 1e6 / (RACE_HZ * nCars * R);

const line = '─'.repeat(78);
console.log(line);
console.log(`BC7 性能予算ゲート  engine=${APP_VERSION}  node=${process.version}  試行 N=${N}/条件`);
console.log(line);

// ── A. 下限の導出元を product から読む（凍結した数字を持たない）─────────────────
console.log('A) 下限の導出（product から読む）');
const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
const m = html.match(/<input id="speed"[^>]*>/);
const speedMax = m ? Number((m[0].match(/\bmax="([\d.]+)"/) || [])[1]) : NaN;
ok(m != null, `A1: index.html に速度スライダー #speed がある${m ? '' : '（見つからない＝下限を導出できない）'}`);
ok(Number.isFinite(speedMax) && speedMax > 0, `A2: 速度倍率の上限 speedMax=${speedMax}× を読めた（UI の max 属性）`);
const maxCars = FLEET.maxCars;
ok(Number.isInteger(maxCars) && maxCars >= 2, `A3: FLEET.maxCars=${maxCars} 台（config.js）`);
const R_MIN = speedMax / PHYS_SHARE;
console.log(`     → 下限 R_min = speedMax/φ = ${speedMax}/${PHYS_SHARE} = ${R_MIN.toFixed(1)}× 実時間`
          + `（= ${usOf(R_MIN, maxCars).toFixed(1)} µs/tick/台 相当・旧 AP13 基準 60 との換算）`);

// ── B. 母集団（アプリが現に走る条件）──────────────────────────────────────────
const prog = (k) => { const p = PROGRAMS.find(x => x.key === k); return { src: p.code, lang: p.lang || 'c', carType: p.carType }; };
const field = (keys, enc) => keys.map((k, i) => { const p = prog(k); return { name: 'C' + i, lang: p.lang, src: p.src, carType: p.carType, rear: false, encoder: !!enc }; });
const cycle = (arr, n) => Array.from({ length: n }, (_, i) => arr[i % arr.length]);
const oval = buildFromSpec({ name: 'オーバル', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
const circuitSpec = courses.find(c => /競技サーキット/.test(c.name));
const circuit = buildFromSpec(circuitSpec);
const SEC = 30;                                       // 1 試行あたりのシム秒（maxSec で打ち切る）
const CASES = [
  { key: 'dyn',  id: `卓上×dynamic×${maxCars}台（アプリ既定エンジン）`, regime: 'tabletop',
    spec: { course: oval, laps: 99, field: field(cycle(['normal_ff', 'normal_fr', 'normal_awd'], maxCars)), crashRule: { rejoin: true, penaltySec: 3 }, interact: true, maxSec: SEC } },
  { key: 'v2t',  id: `卓上×v2×${maxCars}台（利用者が精密 v2 を選んだとき・AP13 S4 と同じ土俵）`, regime: 'tabletop',
    spec: { course: oval, laps: 99, physics: 'v2', field: field(cycle(['normal_ff', 'normal_fr', 'normal_awd'], maxCars)), crashRule: { rejoin: true, penaltySec: 3 }, interact: true, maxSec: SEC } },
  { key: 'v2f',  id: `fullscale×v2×${maxCars}台（領域切替で自動的に v2）`, regime: 'fullscale',
    spec: { course: circuit, regime: 'fullscale', laps: 99, physics: 'v2', field: field(cycle(['comp_circuit', 'comp_estimate', 'recon_racer'], maxCars), true), crashRule: { rejoin: true, penaltySec: 3 }, interact: true, maxSec: SEC } },
];

console.log('\nB) 母集団の実行と決定論（時間を測る前に「同じ仕事を測っているか」を固定する）');
const res = {};
for (const c of CASES) {
  applyRegime(c.regime);
  let warm = null;
  { const r = runRace({ ...c.spec, report: true }); warm = r; }      // ウォームアップ 1 回（JIT・計測から捨てる）
  const ratios = [], hashes = [], tickList = [], fitCut = [], ranCars = [];
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint();
    const r = runRace({ ...c.spec, report: true });
    const wall = Number(process.hrtime.bigint() - t0) / 1e9;
    ratios.push(r.simSec / wall); hashes.push(r.verifyHash); tickList.push(r.ticks);
    fitCut.push(r.fitReduced | 0); ranCars.push(r.report.length);
  }
  res[c.key] = { ...c, ratios, hashes, ticks: tickList, fitCut, ranCars, warm };
  const uniqH = [...new Set([...hashes, warm.verifyHash])];
  const uniqT = [...new Set([...tickList, warm.ticks])];
  ok(uniqH.length === 1, `B1[${c.key}] ${N + 1} 回とも同じ走行（verifyHash=${uniqH.join(',')}）`);
  ok(uniqT.length === 1 && uniqT[0] === SEC * RACE_HZ,
     `B2[${c.key}] 打ち切りまで走り切った ticks=${uniqT.join(',')}（期待 ${SEC * RACE_HZ}＝空振りでない）`);
  // race_engine は静的容量を超える編成を黙って削る（race_engine.js:242 `fitField = field.slice(0, nFit)`）。
  // 削られたことに気づかないと「maxCars 台で」という看板が偽になり、µs/tick/台 も誤った台数で割ってしまう。
  const uniqCut = [...new Set([...fitCut, warm.fitReduced | 0])];
  const uniqRan = [...new Set([...ranCars, warm.report.length])];
  ok(uniqCut.length === 1 && uniqCut[0] === 0 && uniqRan.length === 1 && uniqRan[0] === maxCars,
     `B3[${c.key}] 頼んだ ${maxCars} 台がそのまま走った（実走 ${uniqRan.join(',')} 台・容量で削られた台数 ${uniqCut.join(',')}）`);
}
applyRegime('tabletop');

// ── C. 性能予算（要件由来の下限・壁時計）───────────────────────────────────────
console.log('\nC) 性能予算 R ≥ R_min（要件から導出した下限・境界からのマージンを数値で示す）');
if (SKIP_TIMING) {
  for (const c of CASES) skip(`C[${c.key}] 壁時計アサートを WF_SKIP_TIMING=1 でスキップ（timing 隔離・AP21）`);
} else {
  for (const c of CASES) {
    const r = res[c.key], nCars = r.ranCars[0];   // 頼んだ数でなく **実際に走った** 台数で割る（B3 が 0 削りを固定）
    const med = q(r.ratios, .5), min = Math.min(...r.ratios), max = Math.max(...r.ratios);
    const spread = (max - min) / med * 100;
    console.log(`   [${c.key}] ${c.id}`);
    console.log(`        実時間比 med ${med.toFixed(2)}× / min ${min.toFixed(2)} / p25 ${q(r.ratios, .25).toFixed(2)} / p75 ${q(r.ratios, .75).toFixed(2)} / max ${max.toFixed(2)}  ばらつき ${spread.toFixed(1)}%`);
    console.log(`        µs/tick/台 med ${usOf(med, nCars).toFixed(2)}（旧 AP13 基準 60 との比較用）`);
    ok(min >= R_MIN, `C[${c.key}] 最悪試行 ${min.toFixed(2)}× ≥ 下限 ${R_MIN.toFixed(1)}×`
       + `  マージン ${(min / R_MIN).toFixed(2)}倍（中央値なら ${(med / R_MIN).toFixed(2)}倍）`);
  }
}

// ── D. ホスト非依存の回帰トリップワイヤ ───────────────────────────────────────
// C の下限は要件由来ゆえ実測に対して大きな余裕がある（＝境界上の基準を作らない代わりに、
// 小さな退行は捕まえられない）。そこを **同一プロセス・同一ホストで測った比** で補う。
// 比なのでホストの速さが約分され、ホストの機嫌で緑赤が決まらない。
// 帯は本ホストの実測から置く（BC7 で 7 回測った実測値 2.12 / 2.25 / 2.31 / 2.42 / 2.51 / 2.63 / 2.64
// ＝中央値 2.42・振れ ±11%）。下端 1.5 まで 1.41 倍・上端 4.5 まで 1.86 倍の余裕がある。
// **守備範囲の限界を明示する**: 両エンジンが同率で重くなる退行はこの比では捕まえられない
// （その場合に動くのは C）。逆に C は要件由来ゆえ余裕が大きく小さな退行を拾えない。2 つで補い合う。
console.log('\nD) ホスト非依存の回帰トリップワイヤ（同一実行内の比＝ホストの速さが約分される）');
const BAND = { lo: 1.5, hi: 4.5 };
if (SKIP_TIMING) {
  skip('D 壁時計アサートを WF_SKIP_TIMING=1 でスキップ（timing 隔離・AP21）');
} else {
  const rDyn = q(res.dyn.ratios, .5), rV2 = q(res.v2t.ratios, .5);
  const cost = rDyn / rV2;      // = 卓上 v2 の 1 tick あたりコスト ÷ 卓上 dynamic のそれ
  ok(cost >= BAND.lo && cost <= BAND.hi,
     `D1 卓上 v2 のコストは dynamic の ${cost.toFixed(2)} 倍（帯 ${BAND.lo}〜${BAND.hi}）`
     + `  下端まで ${(cost / BAND.lo).toFixed(2)}倍・上端まで ${(BAND.hi / cost).toFixed(2)}倍`);
}

// ── E. 導出が陳腐化していないことの構造検査 ───────────────────────────────────
// 「speedMax を UI から読む」導出は、UI 側の綴りが変わると黙って壊れる。A1/A2 が読めた値が
// 実装側の既定（main.js の初期値）と矛盾していないことを併せて測り、片側だけの変更を検出する。
console.log('\nE) 導出元の整合（UI と実装で速度倍率の上限・既定が食い違っていないこと）');
const mainSrc = readFileSync(join(ROOT, 'public/js/main.js'), 'utf8');
const initSpeed = Number((mainSrc.match(/^let speed = ([\d.]+);/m) || [])[1]);
const uiValue = m ? Number((m[0].match(/\bvalue="([\d.]+)"/) || [])[1]) : NaN;   // A1 が赤でも TypeError で落ちない
ok(Number.isFinite(initSpeed), `E1: main.js の再生速度の初期値 let speed = ${initSpeed}`);
ok(Number.isFinite(uiValue) && initSpeed === uiValue, `E2: 実装の初期値 ${initSpeed} と UI の value ${uiValue} が一致`);
// E3: 既存の壁時計ゲート wf_ao5_calib J（本ゲート [v2f] と同一治具）の床を本ゲートが下回っていないこと。
//     下回ると「BC7 が J を置き換えた」という主張が崩れ、J の方が強い＝両方要る状態になる。
const calibSrc = readFileSync(join(ROOT, 'wf_ao5_calib.mjs'), 'utf8');
const jFloor = Number((calibSrc.match(/ok\(ratio >= ([\d.]+),/) || [])[1]);
ok(Number.isFinite(jFloor) && R_MIN >= jFloor,
   Number.isFinite(jFloor)
     ? `E3: 本ゲートの下限 ${R_MIN.toFixed(1)}× は wf_ao5_calib J の床 ${jFloor}× 以上（J を包含する）`
     : 'E3: wf_ao5_calib J の床を読めなかった＝包含関係を確かめられない（J 側の綴りが変わった可能性）');

console.log(line);
console.log(`検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}${skipped ? ` / SKIP ${skipped} (WF_SKIP_TIMING)` : ''}`);
if (fail) { for (const f of fails) console.log('  ✗ ' + f); }
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
console.log(line);
process.exit(fail ? 1 : 0);
