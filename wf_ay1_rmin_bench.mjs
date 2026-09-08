// wf_ay1_rmin_bench.mjs — Stage AY1「逆算ベンチコーナーでの grip vs drift 同予算比較」の受け入れゲート。
// ══════════════════════════════════════════════════════════════════════════════════════
// 問い（利用者・2026-09-07）: **卓上に「ドリフトが必須／有利」な領域は存在するか。**
//
// 支配する不等式（掃引ではなく既存パラメータからの導出）:
//   **廊下の外径 `R_out` が、舵角律速の下限 `R_min = ホイールベース ÷ tan(最大舵角)` を下回るか。**
//   `R_min` は **速度に依存しない運動学的な下限**なので、これを下回るコーナーでは
//   「減速して曲がる」が原理的に効かない（DOC-FIX-1・v8.1.1 で公開文へ書いた話と同じ根）。
//
// ── `R_out` の定義（AY1 で確定・PLAN/AY-0 の記述を是正した）─────────────────────────────
//   **`R_out = R + usable`, `usable = W/2 − 車幅/2`**（R = 意図線の半径・W = 廊下幅）。
//   これは `wf_drift_opt.mjs` の廊下プロキシ `|dist(CG,C) − R| ≤ W/2 − 車半幅` の **上側境界そのもの**
//   ＝ 車の基準点（後輪軸中心）が到達できる最も外側の同心円。**既存オラクルと同一定義**で、
//   本ゲートは A 章でその一致を機械確認する。
//   ⚠ **PLAN AY / 決定ログ AY-0 は `R_out = R + usable/2` と書いていたが、同じ節の逆算値**
//     （道幅 0.16→R=0.210 ／ 0.20→0.190 ／ 0.28→0.150）**は `R + usable` でしか再現しない**
//     （`usable/2` なら 0.230/0.220/0.210）。∴ 逆算値の側を正とし、定義を上のとおり確定した。
//     この取り違えの結果、AY-0 の「現行コースで最も際どい外径 0.297m ＝ R_min の 1.017 倍」は
//     **0.3172m ＝ 1.086 倍**（架空峠 ロング・ワインディング(激坂)〔道幅 2 台分〕）が正しい。
//     **結論「現行コースに `R_out < R_min` は 0 本」は 3 通りの定義すべてで変わらない**（A-4 が実測で固定）。
//
// ── もう 1 件の是正（AY1 の位置づけを正しく言う）──────────────────────────────────────
//   AY-0 は「AO8/AU3 で唯一 GO が出た `bench-hairpin-R5` が唯一 `R_min` を下回るセル ＝ 滑らせる以外に
//   手が無いセルだった」と書いたが、`5/5.840 = 0.856` は **中心線 R / R_min** であって `R_out/R_min`
//   ではない。同じベンチの `R_out/R_min` は **(5 + (6/2 − 1.6)) / 5.840 = 7.200/5.840 = 1.233**（A-5 が実測）。
//   ∴ **AO8/AU3 のベンチは 5 半径すべて `R_out > R_min`** ＝「舵では原理的に曲がれない」領域は
//   **一度も測られていない**。あの GO は「舵でも通れるが、滑らせたほうが 11.9% 速かった」であって
//   「滑らせる以外に手が無い」ではない。
//   ⇒ 本ゲートの 4 水準 `R_out/R_min ∈ {1.02, 0.95, 0.856, 0.80}` は「同比率の再現」ではなく
//     **grip の可否境界をまたぐ初めての掃引**である。0.856 はその中の 1 点として残す（PLAN 固定・CI-7）。
//
// ── 測るもの（PLAN AY1 の受け入れ基準・実装前固定）────────────────────────────────────
//   A ベンチの生成    : 外径比 4 水準 × 道幅 2 水準 = 8 セル。各セルの R・W・usable・R_out・**R_min**・比率を印字
//   B 同予算の最適化  : drift（滑り目標つき）と grip（意図的な滑りを作らない）を **同じ手続き・同じ予算**で
//                       最適化して総合時間比を出す。**`wf_drift_opt.mjs`（= wf_drift_reexam の最適化器を
//                       純粋抽出したもの）を呼ぶ。再実装しない**
//   C 非空振りガード  : grip 単独で通れるセルと通れないセルが **両方存在する**こと（片側全滅なら格子が無意味）
//   D GO 判定         : 総合時間比 ≤0.98 ∧ 進入±10% で 3/3 clean。GO のセル数と条件を表で出す
//   E 反証条件        : GO が 0 なら「この格子には存在しない」と明記し、**grip が通れなくなる境界の
//                       `R_out/R_min`** を二分探索で数値化する（GO の有無に関わらず得られる一次データ）
//   F 回復限界        : 各セルの |β| ピークと「出口で再グリップできたか」（AO8 の律速は舵でなく車体側の
//                       回復限界 |β|≈36° だった。それがこの領域でも効くのかを見る）
//   G 低μ補助アーム   : AU3 の唯一 GO は低μ側だった。固定 8 セルとは**別枠**で同じ格子を低μで測る
//   H 実壁アーム      : 廊下プロキシではなく **実 stadium の壁**で剛体車のクリアランスを掃引し、
//                       `R_out < R_min` の幾何的な意味を製品オラクル（corners/distToSeg/checkCollision）で裏取り
//   I 決定論          : 同一パラメータ 2 回・最適化 2 回が bit 一致
//
// **走行条件（Stage AX/AY 固定）**: エンジン **v2** × 領域 **卓上** × 車種 `normal_fr` × 装備すべて既定
//   （タイヤ normal・モーターブレーキ・direct ギア・quasi サス）。**操舵だけは 3値(tri)と連続(prop・AS12 の
//   任意装備)の両方を探索空間に入れる**（grip/drift 双方に同じ選択肢を与える＝片側だけ有利にしない）。
//   **卓上の本番既定エンジンは dynamic**（config.js）なので、結論には必ず「卓上 v2 での話」と条件を刻む。
// **走行物理は 1 バイトも触らない**（本ファイルは product を import するだけ）。
//
// 使い方:  node wf_ay1_rmin_bench.mjs          （既定=縮小掃引・アサート緑/赤で exit 0/1）
//          node wf_ay1_rmin_bench.mjs --full   （予算 2 倍・二分探索を細かく。docs 転記用）
//          node wf_ay1_rmin_bench.mjs --json   （表を JSON で）
// ══════════════════════════════════════════════════════════════════════════════════════
import { buildFromSpec } from './public/js/course.js';
import { CarV2, tireParamsFor } from './public/js/physics_v2.js';
import { CAR, CONST, setPhysicsMode, APP_VERSION, PHYSICS, REGIME_STATE, CAR_TYPE_BY_KEY } from './public/js/config.js';
import { applyRegime, DYN } from './public/js/physics_dyn.js';
import { checkCollision } from './public/js/physics.js';
import { distToSeg } from './public/js/geom.js';
import { buildWallGrid, queryRadius } from './public/js/contact_v2.js';
import { makeCornerLab, DEEP_MIN } from './wf_drift_opt.mjs';
import { tougeGeom, tougeSpecs, derivedTougeSpecs, cornersOf, swingOut } from './wf_touge_driver.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FULL = process.argv.includes('--full');
const WANT_JSON = process.argv.includes('--json');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
// **記録行**。`ok(true, …)` を記録に使うと「述語を壊しても緑」の恒真アサートが増え、pass 件数が
// 検査の実体を表さなくなる（層 4 レビュー指摘）。記録は記録として、アサートと分けて出す。
const note = (m) => console.log('  · ' + m);

setPhysicsMode('v2'); applyRegime('tabletop');

const CAR_KEY = 'normal_fr';
const R_MIN = CAR.wheelBase / Math.tan(CAR.maxSteer);
const VREF = CAR.maxSpeed * CAR_TYPE_BY_KEY[CAR_KEY].maxSpeed;   // 車種の最高速 [m/s]
const DIAG = Math.hypot(CAR.length, CAR.width);

// ── 領域スケールの持ち込み（`wf_drift_opt.mjs` の既定値は fullscale の literal）────────────
// 既定値をそのまま卓上へ持ち込むと別物のドライバになる。たとえば速度保持のデッドバンド 0.6 m/s は
// **卓上の車種最高速 0.714 m/s より大きい**＝ブレーキが一度も入らない。
// ∴ 速度次元の定数は **fullscale の literal を、その領域の代表 v_grip で割った無次元比**に直し、
//   卓上の参照速度 VREF を掛けて戻す。代表 v_grip は本ゲートが再利用する Part 2 の 4 セル
//   （R5/R6.5 × dry/low）の算術平均 = 5.9475 m/s（下の FS_VGRIP が式ごと持つ＝数字を書き写さない）。
// 長さ次元（出口面までの距離・廊下逸脱の罰の重み）は **長さスケール比 20**（fullscale ホイールベース
// 2.6m ÷ 卓上 0.13m）で換算する。**grip と drift に同じ値が掛かる**ので、どちらかを有利にしない。
// **代表 v_grip は製品から実測する**。初版は `mu0 = 0.8` を literal で書いたが、それは**卓上の値**で
// fullscale は **1.4**（`public/js/physics_v2.js` の領域別較正）。書き写した結果 24% 過小の 5.9475 を
// 使っていた（層 4 レビュー指摘・実測 7.8681）。「式ごと持つ＝数字を書き写さない」と書きながら
// μ だけ写していたので、**領域を切り替えて製品に聞く**形へ直した。
const FS_VGRIP = (() => {
  applyRegime('fullscale');
  const mu0 = tireParamsFor('normal').mu0, g = DYN.g;
  const v = [[5, 1.0], [5, 0.6], [6.5, 1.0], [6.5, 0.6]]
    .reduce((a, [R, gr]) => a + Math.sqrt(mu0 * gr * g * R), 0) / 4;
  applyRegime('tabletop');   // 必ず戻す（以降の測定はすべて卓上）
  return v;
})();
const L_SCALE = 2.6 / 0.13;                       // fullscale ホイールベース ÷ 卓上ホイールベース = 20
const rel = (fsLiteral) => fsLiteral / FS_VGRIP * VREF;
const LAB_CFG = {
  exitM: 20 / L_SCALE,                            // 20m → 1.0m
  runupTicks: 120,                                // 実測 2026-09-08: 卓上 normal_fr は **tick 58** で前 tick と bit 一致（終端 0.7139999999999995）。約 2 倍の余裕
  brakeBand: rel(0.6), speedBias: rel(0.3),
  throttleFloorU: rel(1), throttleBias: rel(0.2), tcFloorU: rel(1),
  revU: -rel(0.5), arFloorU: rel(0.5),
  violW: 5 * L_SCALE,                             // 逸脱量 [m] が 1/20 になるぶん重みを 20 倍（罰の効きを保つ）
};
const lab = makeCornerLab(LAB_CFG);
// 卓上のタイヤ μ0（**製品から取る**。上の FS_VGRIP と同じ理由で literal を書かない）。
const TT_MU0 = tireParamsFor('normal').mu0;

const usableOf = (W) => W / 2 - CAR.width / 2;
const rOf = (ratio, W) => ratio * R_MIN - usableOf(W);

// ── 探索空間（領域で意味が変わる範囲だけ差し替える）──────────────────────────────────────
// ・`entry`（進入速度 / vRef）: 卓上は **全セルで vgrip > 車種最高速**（H-0b が実測で固定）ゆえ
//   vRef は最高速に張り付く。∴ entry > 1.0 は **物理的に到達不能**で、助走が上限まで回るだけの
//   同一初期状態になる。上限を 1.0 に切り、**grip と drift で同一区間 [0.6, 1.0]** にした
//   （元は grip [0.7,1.15] / drift [0.8,1.5] と非対称。到達可能域に切り詰めるついでに対称化した）。
// ・`lead`（ターンイン位置 [m]）: 元は [0,6]m（R5 に対し ~1.2R）。卓上は同じ比で [0, 0.25]m。
// 残り（β 目標 deg・各ゲイン・進入比・brakeTicks）は無次元または tick なのでそのまま。
// ・`y0`（進入の横オフセット [m]）: **AY1 で追加した 1 次元**。元の実装は助走後に必ず (0,0,0) へ戻すため
//   y0=0 に固定されており、意図線 C=(lead,R) と同心の円が引けなかった。その結果、舵で通せる条件が
//   幾何の `R + usable ≥ R_min` ではなく **`R + usable/2 ≥ R_min`** に狭まる（E 章が両方を実測する）。
//   範囲は廊下いっぱい [−usable, +usable]（直線区間の廊下プロキシ |cgy| ≤ usable と同じ）。
//   **grip と drift に同じ 1 次元を与える**。
const ENTRY = [0.6, 1.0], LEAD = [0, 0.25];
const spacesFor = (W, withOffset = true) => {
  const y0 = withOffset ? [-usableOf(W), usableOf(W)] : [0, 0];
  return { grip: { ...lab.GRIP_SPACE, entry: ENTRY, lead: LEAD, y0 },
           drift: { ...lab.DRIFT_SPACE, entry: ENTRY, lead: LEAD, y0 } };
};

// ── ベンチ格子（PLAN AY1 で実装前に固定）────────────────────────────────────────────────
const RATIOS = [1.02, 0.95, 0.856, 0.80];          // R_out / R_min
const WIDTHS = [0.16, 0.28];                       // 廊下幅 [m]（= 車幅 2.0 台分 / 3.5 台分）
const ANG = 180;                                   // ヘアピン（AO8/AU3 の唯一 GO と同じ回頭角）
// ベンチの spec。**廊下は プロキシ**（B〜G 章）なので走行に効くのは `course.start` の路面属性だけだが、
// H 章（実壁アーム）は同じ spec の実際の壁を使う＝1 つの spec が 2 つのアームの単一真実源になる。
function benchSpec(ratio, W, surf) {
  const R = rOf(ratio, W);
  const s = { name: `bench-ay1-r${ratio}-w${W}-${surf}`, kind: 'track', shape: 'stadium',
              L: 1.2, rr: +R.toFixed(6), width: W, samples: 160, noRace: false };
  if (surf === 'low') { s.grip = 0.6; s.muDecay = 0.92; }   // AO8 の低μと同一（唯一 GO が出た路面）
  return s;
}

// **既定予算は --full の半分ではなく「結論が変わらない大きさ」で決める**（AU3 の C-1 是正と同型）。
//   初版は既定 {60,40,100,60}／--full {120,80,200,120} にしたところ、**既定だけ低μで GO=1 が出て
//   --full では GO=0** になった（実測 2026-09-07）。原因は grip の探索不足で、grip に drift と同額の
//   予算を与えると同じセルの時間比が 0.877 → 0.981 へ戻る（J-5）。既定と --full で結論が反転する
//   ゲートは壊れているので、**既定を旧 --full の予算に引き上げ**、--full はさらに 2 倍にした。
//   所要は既定で **約 225 秒**（本ホスト実測 2026-09-08。受け入れ基準「既定は 5 分以内」を満たす）。
//   内訳は末尾の「所要:」行が Part 別に印字する（ホスト依存ゆえ本文に固定値を書き足さない）。
const BUDGET = FULL ? { gr: 240, gl: 160, dr: 400, dl: 240 } : { gr: 120, gl: 80, dr: 200, dl: 120 };
const SEED_G = 11, SEED_D = 7;                     // AU3 Part 2 と同じ種（grip 11 / drift 7）

console.log(`\n[AY1] 逆算ベンチ grip vs drift  APP=${APP_VERSION}  卓上 v2  車種=${CAR_KEY}`);
console.log(`  R_min = ホイールベース ${CAR.wheelBase} ÷ tan(${(CAR.maxSteer * 180 / Math.PI).toFixed(1)}°) = **${R_MIN.toFixed(4)} m**（速度に依存しない運動学的下限）`);
console.log(`  車体 ${CAR.length}×${CAR.width}m（対角 ${DIAG.toFixed(4)}）・車種最高速 ${VREF.toFixed(4)} m/s`);
console.log(`  R_out = R + usable, usable = W/2 − 車幅/2 ＝ 廊下プロキシの上側境界（A-2 で機械確認）`);
console.log(`  掃引: ${FULL ? '系統(--full)' : '既定 縮小'}  ／ 回頭角 ${ANG}°`);

// ══════════════════════════════════════════════════════════════════════════════════════
// H-0: 走行条件の構造検査（**走らせる前に**）
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[H-0] 走行条件`);
{
  const engOK = PHYSICS.mode === 'v2' && REGIME_STATE.active === 'tabletop';
  console.log(`  大域: physics=${PHYSICS.mode} regime=${REGIME_STATE.active}`);
  ok(engOK, `H-0a エンジン/領域 = v2 × 卓上（Stage AX/AY の固定条件）`);
  if (!engOK) { console.log(`\n[結果] pass=${pass} fail=${fail}  ← 条件が違うので以降の測定は行わない`); process.exit(1); }
  // 卓上が舵角律速であること＝ vRef が最高速に張り付くこと。**entry の上限を 1.0 に切った根拠**。
  const rows = [];
  for (const W of WIDTHS) for (const ratio of RATIOS) {
    const R = rOf(ratio, W);
    rows.push({ W, ratio, R, vgrip: Math.sqrt(TT_MU0 * DYN.g * R), vgripLow: Math.sqrt(TT_MU0 * 0.6 * DYN.g * R) });
  }
  // **低μアーム（G 章・grip 0.6）も同じ主張の対象**。余裕が薄いのはそちらなので一緒に検査する
  // （層 4 レビュー指摘: dry だけ見ていた。低μの最狭セルは余裕 11%）。
  const allSteerLimited = rows.every((r) => r.vgrip > VREF && r.vgripLow > VREF);
  const marginLow = Math.min(...rows.map((r) => r.vgripLow / VREF)) - 1;
  console.log(`  v_grip = √(μ·g·R) は 既定路面 ${Math.min(...rows.map((r) => r.vgrip)).toFixed(4)}〜${Math.max(...rows.map((r) => r.vgrip)).toFixed(4)} ／ 低μ(grip0.6) ${Math.min(...rows.map((r) => r.vgripLow)).toFixed(4)}〜${Math.max(...rows.map((r) => r.vgripLow)).toFixed(4)} m/s ／ 車種最高速 ${VREF.toFixed(4)} m/s（低μ最狭セルの余裕 ${(100 * marginLow).toFixed(1)}%）`);
  ok(allSteerLimited,
     `H-0b 全 ${rows.length} セル × 路面 2 種（既定・低μ）で v_grip > 車種最高速 ⇒ **摩擦は最後まで拘束しない（舵角律速）**。最も薄い余裕は低μの最狭セルで ${(100 * marginLow).toFixed(1)}%。` +
     `∴ 参照速度 vRef = min(v_grip, 最高速) = 最高速に張り付き、進入比 entry > 1.0 は到達不能（探索空間を [${ENTRY[0]}, ${ENTRY[1]}] に切った根拠）`);
  // 装備が既定であること（操舵だけは探索対象＝両アームに同じ選択肢）。
  const probe = lab.mkCar(buildFromSpec(benchSpec(1.02, 0.16, 'dry')), CAR_KEY, false);
  console.log(`  装備: tire=${probe.tireSet} brake=${probe.brakeSet ?? '(既定=motor)'} gear=${probe.gearSet ?? '(既定)'} susp=${probe.suspSet ?? '(既定)'} steer=${probe.steerSet}(探索対象)`);
  // **実測: CarV2 は既定装備を明示値で持つ**（未設定 undefined ではない）。CLAUDE.md/Stage AX が言う
  // 「装備すべて既定」＝ normal / motor / direct / quasi。値そのもので固定する（未設定検査だと素通りする）。
  ok(probe.tireSet === 'normal' && probe.brakeSet === 'motor' && probe.gearSet === 'direct' && probe.suspSet === 'quasi',
     `H-0c 装備は既定（tire=${probe.tireSet} / brake=${probe.brakeSet} / gear=${probe.gearSet} / susp=${probe.suspSet}）。操舵のみ 3値/連続を両アームで探索`);
  // 予算の対称性（片側だけ強く探索していないことを構造で出す）。
  console.log(`  予算: grip rand ${BUDGET.gr} + local ${BUDGET.gl} = ${BUDGET.gr + BUDGET.gl} 評価 ／ drift rand ${BUDGET.dr} + local ${BUDGET.dl} = ${BUDGET.dr + BUDGET.dl} 評価` +
              `（drift/grip = ${((BUDGET.dr + BUDGET.dl) / (BUDGET.gr + BUDGET.gl)).toFixed(2)} 倍。AU3 Part 2 と同型＝drift 空間は ${Object.keys(spacesFor(WIDTHS[0]).drift).length} 次元・grip は ${Object.keys(spacesFor(WIDTHS[0]).grip).length} 次元）`);
  ok((BUDGET.dr + BUDGET.dl) >= (BUDGET.gr + BUDGET.gl),
     `H-0d 予算は **drift 側が grip 以上**（${BUDGET.dr + BUDGET.dl} ≥ ${BUDGET.gr + BUDGET.gl}）＝ 結論が NO-GO のとき「drift を探し足りない」では説明できない`);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// A: ベンチ格子の素性（分母 R_min を必ず同じ行に出す・DOC-FIX-1 / AX2 B-2c の教訓）
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[A] ベンチ格子（4 外径比 × 2 道幅 = 8 セル）`);
console.log(`  W(道幅) 車幅比 | 目標比  R(意図線)  usable   R_out   | R_min   実比    | 内壁半径 R−W/2  廊下>対角?`);
const cells = [];
for (const W of WIDTHS) for (const ratio of RATIOS) {
  const R = rOf(ratio, W), u = usableOf(W), Rout = R + u;
  const innerWall = R - W / 2;
  const c = { W, widthCars: +(W / CAR.width).toFixed(3), ratio, R, usable: u, Rout, ratioReal: Rout / R_MIN,
              innerWall, innerProxy: R - u, wallFits: W > DIAG, degenerate: innerWall <= 0 };
  cells.push(c);
  console.log(`  ${W.toFixed(2)}  ${c.widthCars.toFixed(2)} 台 | ${ratio.toFixed(3)}  ${R.toFixed(4)}  ${u.toFixed(4)}  ${Rout.toFixed(4)} | ${R_MIN.toFixed(4)}  ${c.ratioReal.toFixed(4)} | ${innerWall.toFixed(4)} ${c.degenerate ? '← 退化(実壁不能)' : ''}  ${c.wallFits ? 'yes' : 'no '}`);
}
{
  ok(cells.length === 8, `A-1 セル数 ${cells.length} = 外径比 ${RATIOS.length} × 道幅 ${WIDTHS.length}`);
  const maxErr = Math.max(...cells.map((c) => Math.abs(c.ratioReal - c.ratio)));
  ok(maxErr < 1e-12,
     `A-2 各セルの実測 R_out/R_min が目標比と一致（最大誤差 ${maxErr.toExponential(1)}）。**分母 R_min = ${R_MIN.toFixed(4)}m は上表の各行に印字済**`);
  // A-3: `usable` が廊下プロキシの境界と同一式であること（定義の二重化を防ぐ）。
  //   `wf_drift_opt.mjs` の runCornerSwitch は `lim = W/2 − HALF_W_CAR` を廊下の許容ずれに使う。
  // **`wf_drift_opt.mjs` が実際に使う関数 `limOf` を呼ぶ**（式を書き写すと、あちらを変異させても
  // ここが緑のままになり、R_out の定義が静かに嘘になる。層 4 レビュー指摘）。
  const same = WIDTHS.every((W) => lab.limOf(W) === usableOf(W));
  ok(same,
     `A-3 usable = W/2 − 車幅/2 は **廊下プロキシの許容ずれ lim と同一**（実装の lab.limOf を呼んで照合: ${WIDTHS.map((W) => `W=${W}: ${lab.limOf(W).toFixed(4)}`).join(' / ')}）` +
     ` ⇒ R_out は「基準点が到達できる最も外側の同心円」であって別定義ではない`);
}

// ── A-4/A-5: AY-0 の 2 つの数値の是正を、実測で機械固定する ────────────────────────────
console.log(`\n[A-4/A-5] 決定ログ AY-0 の数値の是正（実測で固定・対象は**峠コーナーだけ**。峠以外は A-6）`);
{
  const specs = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'courses.json'), 'utf8'));
  const T = [...tougeSpecs(specs), ...derivedTougeSpecs(specs)];
  const rows = [];
  let nShip = 0;
  for (const spec of T) {
    const G = tougeGeom(buildFromSpec(spec));
    const cs = cornersOf(G);
    if (!spec.derivedFrom) nShip += cs.length;   // 出荷/派生の内訳も**数え上げる**（literal を書くと腐る）
    for (const c of cs) rows.push({ name: spec.name, R: c.R, hwMin: c.hwMin, usable: c.usable });
  }
  // 3 通りの定義すべてで数える（結論が定義に依らないことを示す）。
  const defs = {
    'R + usable（本ゲートの定義）': (r) => r.R + r.usable,
    'R + usable/2（AY-0 本文の式）': (r) => r.R + r.usable / 2,
    'R + hw（半幅そのもの）': (r) => r.R + r.hwMin,
  };
  const below = {}, tightest = {};
  for (const [k, f] of Object.entries(defs)) {
    below[k] = rows.filter((r) => f(r) < R_MIN).length;
    const t = rows.slice().sort((a, b) => f(a) - f(b))[0];
    tightest[k] = { name: t.name, Rout: f(t), ratio: f(t) / R_MIN };
    console.log(`  ${k.padEnd(30)} R_out<R_min = ${String(below[k]).padStart(2)} / ${rows.length} 本・最も際どい ${tightest[k].Rout.toFixed(4)}m = R_min の ${tightest[k].ratio.toFixed(3)} 倍（${t.name}）`);
  }
  ok(Object.values(below).every((v) => v === 0),
     `A-4 **現行の全 ${rows.length} 峠コーナー（出荷の峠 ${nShip} ＋ 派生 ${rows.length - nShip}）に R_out < R_min は 0 本**（3 通りの定義すべてで 0）` +
     ` ⇒ AY-0 の結論は不変。ただし最も際どい値は **${tightest['R + usable（本ゲートの定義）'].Rout.toFixed(4)}m = ${tightest['R + usable（本ゲートの定義）'].ratio.toFixed(3)} 倍**` +
     `（AY-0 本文の「0.297m = 1.017 倍」は usable/2 で算出したもの＝是正）`);
  // A-5: fullscale の「唯一 GO」セルの 2 つの比率を並べて、取り違えを機械的に封じる。
  const FS_RMIN = 2.6 / Math.tan(CAR.maxSteer);   // fullscale ホイールベース 2.6m（maxSteer は領域不変）
  const FS_W = 1.6;                                // fullscale 車幅
  const fsRows = [[5, 6], [6.5, 6], [8, 7], [50, 12], [120, 14]].map(([R, W]) => ({
    R, W, usable: W / 2 - FS_W / 2, Rout: R + (W / 2 - FS_W / 2),
    rCenter: R / FS_RMIN, rOut: (R + (W / 2 - FS_W / 2)) / FS_RMIN }));
  console.log(`  fullscale ベンチ（R_min=${FS_RMIN.toFixed(3)}m・車幅 ${FS_W}m）:`);
  for (const r of fsRows) console.log(`    R${String(r.R).padStart(3)} 幅${r.W}  R_out=${r.Rout.toFixed(2)} | **中心線比 R/R_min = ${r.rCenter.toFixed(3)}** / **外径比 R_out/R_min = ${r.rOut.toFixed(3)}**`);
  const r5 = fsRows[0];
  ok(fsRows.every((r) => r.rOut > 1) && Math.abs(r5.rCenter - 0.8562) < 5e-4,
     `A-5 **AO8/AU3 のベンチは 5 半径すべて R_out > R_min**（${fsRows.map((r) => r.rOut.toFixed(2)).join('/')}）。` +
     `唯一 GO の R5 の「0.856」は **中心線比**（${r5.rCenter.toFixed(4)}）であって外径比（${r5.rOut.toFixed(3)}）ではない` +
     ` ⇒ あの GO は「舵でも通れるが滑らせたほうが速い」であり「滑らせる以外に手が無い」ではない（AY-0 の是正）`);
}

// ── A-6: AY2 で公開した「舵角限界ベンチ」の台帳（コースとゲートのベンチが同一幾何であることの機械固定）──
// なぜ要るか: AY2 で courses.json に逆算ベンチ 7 本を追加した。以後 **公開コースの中に R_out < R_min の廊下が
//   実在する**ので、A-4 の「0 本」は**峠に限った話**になった（A-4 の文言もそう直してある）。外部文書
//   （physics_model §11・アプリ Q&A・CHANGELOG）は「峠には無い / ベンチには有る」と書き分けているので、
//   その 2 つの数を毎回ここで数え直す。加えて **コース側の rr/width が benchSpec と一致すること**を見て、
//   「ゲートのベンチ」と「公開コース」が別物へ分岐するのを防ぐ（同名で別物の防止）。
console.log(`\n[A-6] 公開コースの舵角限界ベンチ（AY2 追加分）の台帳`);
{
  const specsAll = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'courses.json'), 'utf8'));
  const benches = specsAll.filter((c) => c.bench);
  let geomOK = benches.length > 0, below = 0, atOrAbove = 0;
  for (const b of benches) {
    const ref = benchSpec(b.ratioOutMin, b.width, 'dry');
    const same = b.kind === ref.kind && b.shape === ref.shape && b.L === ref.L &&
                 b.rr === ref.rr && b.width === ref.width && b.samples === ref.samples;
    if (!same) geomOK = false;
    const Rout = b.rr + usableOf(b.width);
    if (Rout < R_MIN) below++; else atOrAbove++;
    console.log(`  ${b.name}  rr=${b.rr} W=${b.width} | R_out=${Rout.toFixed(4)} / R_min=${R_MIN.toFixed(4)} = ${(Rout / R_MIN).toFixed(4)}` +
                ` | benchSpec と一致: ${same ? 'yes' : '**NO**'}`);
  }
  ok(geomOK,
     `A-6a 公開ベンチ ${benches.length} 本の幾何（kind/shape/L/rr/width/samples）が benchSpec と**完全一致**` +
     ` ⇒ 公開コースで走るのと本ゲートが測っているのは同じ廊下`);
  // A-6c: **公開文言（name / desc / desc_en）の数値が、この場で計算した値と一致するか**。
  //   なぜ要るか（層 4 レビュー D3）: A-6a は `benchSpec(b.ratioOutMin, ...)` と比べるので、`ratioOutMin` と `rr` を
  //   一緒に動かすと恒真になり、しかも **name/desc の数値は一切見ていなかった**（変異テストで実証: 名前に
  //   「=0.856」と書いてある行の隣にゲートが「= 0.9000」と印字しながら緑だった）。利用者が読むのは desc なので、
  //   幾何ではなく**文言**を機械で縛る。加えて **2 本の境界の前提スタンプ**（AY1_bench §6 が「必ず添えろ」と
  //   書いているもの）が日英とも desc に残っているかを存在検査する（消えたら赤）。
  const num = (re, txt) => { const m = txt.match(re); return m ? Number(m[1]) : NaN; };
  const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;
  const wordBad = [], numBad = [];
  for (const b of benches) {
    const Rout = b.rr + usableOf(b.width), body = (Rout - swingOut(R_MIN)) / R_MIN;
    const chk = [
      ['name 比',       near(num(/R_out\/R_min=([\d.]+)/, b.name), b.ratioOutMin, 5e-4)],
      ['name_en 比',    near(num(/R_out\/R_min=([\d.]+)/, b.name_en), b.ratioOutMin, 5e-4)],
      ['ja R_out',      near(num(/R_out=([\d.]+)m/, b.desc), Rout, 5e-5)],
      ['ja R_min',      near(num(/R_min=([\d.]+)m/, b.desc), R_MIN, 5e-5)],
      ['ja 比',         near(num(/の ([\d.]+) 倍/, b.desc), b.ratioOutMin, 5e-4)],
      ['ja 車体比',     near(num(/\(R_out−はみ出し\)\/R_min = ([\d.]+)/, b.desc), body, 5e-4)],
      ['ja 道幅',       near(num(/台分\(([\d.]+)m\)/, b.desc), b.width, 1e-9)],
      ['en R_out',      near(num(/R_out=([\d.]+) m/, b.desc_en), Rout, 5e-5)],
      ['en 比',         near(num(/is ([\d.]+)x the minimum turning radius/, b.desc_en), b.ratioOutMin, 5e-4)],
      ['en R_min',      near(num(/R_min=([\d.]+) m/, b.desc_en), R_MIN, 5e-5)],
      ['en 車体比',     near(num(/\(R_out - swing-out\)\/R_min = ([\d.]+)/, b.desc_en), body, 5e-4)],
    ];
    for (const [k, okk] of chk) if (!okk) numBad.push(`${b.name}: ${k}`);
    // 2 本の境界の前提スタンプ（横位置を選べる前提 / 廊下中央から入る前提の 1.073・1.174）。
    if (!(b.desc.includes('1.073') && b.desc.includes('1.174') && b.desc.includes('前提'))) wordBad.push(`${b.name}: ja 前提スタンプ`);
    if (!(b.desc_en.includes('1.073') && b.desc_en.includes('1.174') && b.desc_en.includes('assum'))) wordBad.push(`${b.name}: en 前提スタンプ`);
  }
  ok(numBad.length === 0,
     `A-6c 公開文言（name/name_en/desc/desc_en）の数値 ${11 * benches.length} 点がすべて計算値と一致` +
     `（不一致 ${numBad.length}${numBad.length ? ': ' + numBad.join(' / ') : ''}）⇒ 幾何を直して文言を直し忘れる／文言だけ書き替える のどちらも赤になる。**照合するのは R_out・R_min・比・車体比・道幅の 5 種**で、実壁の不足量は H-6、既定サンプルの完走数は wf_as3_samples の D 章が別に照合する`);
  ok(wordBad.length === 0,
     `A-6d 全 ${benches.length} 本の desc/desc_en に **2 本の境界の前提スタンプ**（1.073 / 1.174 と「前提」/"assum"）が残っている` +
     `（欠落 ${wordBad.length}${wordBad.length ? ': ' + wordBad.join(' / ') : ''}）⇒ AY1_bench §6 の「どちらの前提かを必ず添える」を機械で保つ`);
  ok(below === 5 && atOrAbove === 2,
     `A-6b 公開ベンチの内訳 = **R_out < R_min が ${below} 本**（舵では原理的に曲がれない）／**R_out ≥ R_min が ${atOrAbove} 本**（比 1.02＝舵で通せる側の対照）` +
     ` ⇒ A-4 の「峠には 0 本」と併せて外部文書の「峠には無い／ベンチには有る」を機械固定する`);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// B/C/D/F: 主表 — 同予算の grip vs drift（固定 8 セル・卓上既定の路面）
// ══════════════════════════════════════════════════════════════════════════════════════

function measureCell(cell, surf) {
  const spec = benchSpec(cell.ratio, cell.W, surf);
  const course = buildFromSpec(spec);
  const R = cell.R, W = cell.W;
  const SP = spacesFor(W);
  const g = lab.optimize(course, R, W, CAR_KEY, 'grip', ANG, BUDGET.gr, BUDGET.gl, SEED_G, lab.score, SP);
  const d = lab.optimize(course, R, W, CAR_KEY, 'drift', ANG, BUDGET.dr, BUDGET.dl, SEED_D, lab.score, SP);
  // 深さ**制約**アーム（AU3 と同型）は「clean な深い解」を探すので、clean 解が 1 つも無いセルでは
  // `scoreDeep` が `score` に退化して無制約アームの bit 同一な複製になる（層 4 レビュー指摘）。
  // ∴ **clean 解があるときだけ**回し、無いセルでは代わりに下の**深さ強制**アームが仕事をする。
  const dp = d.r.clean ? lab.optimize(course, R, W, CAR_KEY, 'drift', ANG, BUDGET.dr, BUDGET.dl, SEED_D, lab.scoreDeep, SP) : null;
  // 深さ**強制**アーム: clean を諦めてでも深く滑らせ、そのうえで廊下逸脱を最小化する。
  // 「舵で通れない廊下は滑らせても通れない」を、**実際に滑った走行**で裏付けるために要る。
  const df = lab.optimize(course, R, W, CAR_KEY, 'drift', ANG, BUDGET.dr, BUDGET.dl, SEED_D, lab.scoreForceDeep, SP);
  const gt = g.r.clean ? g.r.t : null, dt = d.r.clean ? d.r.t : null;
  const dpt = (dp && dp.r.clean && dp.r.betaPk >= DEEP_MIN) ? dp.r.t : null;
  const ratioT = (gt && dt) ? dt / gt : null;
  const GO = ratioT != null && ratioT <= 0.98 && d.robust === 3;
  return { ...cell, surf, gripPass: gt != null, driftPass: dt != null,
    grip_t: gt != null ? +gt.toFixed(5) : null, grip_robust: g.robust, grip_entry: +g.p.entry.toFixed(4),
    grip_prop: !!g.p.prop, grip_bpk: +g.r.betaPk.toFixed(2), grip_viol: +g.r.viol.toFixed(5),
    grip_exitBeta: g.r.exitBeta != null ? +g.r.exitBeta.toFixed(2) : null,
    drift_t: dt != null ? +dt.toFixed(5) : null, drift_robust: d.robust, drift_entry: +d.p.entry.toFixed(4),
    drift_beta: +d.p.beta.toFixed(2), drift_brakeTicks: d.p.brakeTicks, drift_prop: !!d.p.prop,
    drift_bpk: +d.r.betaPk.toFixed(2), drift_arPk: +d.r.arPk.toFixed(2), drift_viol: +d.r.viol.toFixed(5),
    drift_exitBeta: d.r.exitBeta != null ? +d.r.exitBeta.toFixed(2) : null,
    drift_exitU: d.r.exitU != null ? +d.r.exitU.toFixed(4) : null, drift_spun: d.r.spun,
    drift_uMin: +d.r.uMin.toFixed(4),
    deep_t: dpt != null ? +dpt.toFixed(5) : null, deep_bpk: dp ? +dp.r.betaPk.toFixed(2) : null, deep_ran: !!dp,
    force_clean: df.r.clean, force_t: df.r.clean ? +df.r.t.toFixed(5) : null,
    force_bpk: +df.r.betaPk.toFixed(2), force_arPk: +df.r.arPk.toFixed(2),
    force_viol: +df.r.viol.toFixed(5), force_uMin: +df.r.uMin.toFixed(4), force_spun: df.r.spun,
    grip_p: g.p, drift_p: d.p,
    ratioT: ratioT != null ? +ratioT.toFixed(5) : null, ratioRaw: ratioT, verdict: GO ? 'GO' : 'NO-GO' };
}

function printTable(title, rows) {
  console.log(`\n${title}`);
  console.log(`  W    比    R_out/R_min | grip: t     rob entry 舵 | drift: t     rob entry  β  brk 舵 βpk αr | 時間比  判定`);
  for (const r of rows) {
    const f = (v) => v == null ? '  --  ' : v.toFixed(3).padStart(6);
    console.log(`  ${r.W.toFixed(2)} ${r.ratio.toFixed(3)} ${r.ratioReal.toFixed(4)}      | ${f(r.grip_t)} ${r.grip_robust}/3 ${r.grip_entry.toFixed(2)} ${r.grip_prop ? 'P' : 'T'} |` +
      ` ${f(r.drift_t)} ${r.drift_robust}/3 ${r.drift_entry.toFixed(2)} ${r.drift_beta.toFixed(0).padStart(2)} ${String(r.drift_brakeTicks).padStart(3)} ${r.drift_prop ? 'P' : 'T'} ${r.drift_bpk.toFixed(0).padStart(3)} ${r.drift_arPk.toFixed(0).padStart(3)} |` +
      ` ${r.ratioT != null ? r.ratioT.toFixed(3) : '  --  '}  ${r.verdict}`);
  }
}

const t0 = process.hrtime.bigint();
const dryRows = cells.map((c) => measureCell(c, 'dry'));
const tDry = Number(process.hrtime.bigint() - t0) / 1e9;
printTable(`[B] 主表（固定 8 セル・卓上既定の路面）— grip/drift とも同じ手続き・同じ予算で最適化`, dryRows);

console.log(`\n[C] 非空振りガード（grip 単独で通れるか）`);
{
  const gp = dryRows.filter((r) => r.gripPass), gn = dryRows.filter((r) => !r.gripPass);
  console.log(`  grip 通過 ${gp.length}/8（比 ${gp.map((r) => r.ratio).join('/') || 'なし'}） ／ 不能 ${gn.length}/8（比 ${gn.map((r) => r.ratio).join('/') || 'なし'}）`);
  console.log(`  grip 不能セルの最良の廊下逸脱量 = ${gn.length ? gn.map((r) => r.grip_viol.toFixed(4)).join(' / ') : '（なし）'} m（連続量マージン・CI-14）`);
  ok(gp.length >= 1 && gn.length >= 1,
     `C-1 **非空振り**: grip が通れるセル ${gp.length} 本と通れないセル ${gn.length} 本が **両方存在する**` +
     `（どちらかが 0 なら格子が緩すぎ／厳しすぎで、drift の比較が意味を持たない）`);
  // C-2: **守るべき結論は「6 セルで grip が通れない」**なので、予算感度はその 6 セルで測る。
  //   初版は grip が**通る**最緩セルだけを測っており、「もっと探せば失敗セルを通せたのでは」という
  //   反論に何も答えていなかった（層 4 レビュー指摘）。
  const fail2 = [];
  for (const c of gn) {
    const spec2 = buildFromSpec(benchSpec(c.ratio, c.W, 'dry'));
    const g2 = lab.optimize(spec2, c.R, c.W, CAR_KEY, 'grip', ANG, BUDGET.gr * 2, BUDGET.gl * 2, SEED_G, lab.score, spacesFor(c.W));
    fail2.push({ W: c.W, ratio: c.ratio, clean: g2.r.clean, viol1: c.grip_viol, viol2: +g2.r.viol.toFixed(5) });
  }
  console.log(`  grip 不能セルの予算 2 倍（${BUDGET.gr * 2}+${BUDGET.gl * 2} 評価）再測: ` +
    fail2.map((x) => `W${x.W}/比${x.ratio}: ${x.clean ? '**通過**' : '不能'}（逸脱 ${x.viol1} → ${x.viol2}）`).join(' ／ '));
  ok(fail2.length >= 4 && fail2.every((x) => !x.clean),
     `C-2 **grip は予算に拘束されていない**: 通れなかった ${fail2.length} セルすべてで、予算を 2 倍にしても依然 clean 解なし` +
     `（廊下逸脱量も ${fail2.map((x) => (x.viol2 - x.viol1 >= 0 ? '+' : '') + (x.viol2 - x.viol1).toFixed(5)).join('/')} m しか動かない）` +
     ` ⇒ 「grip を探し足りない」では結論を説明できない`);
  // 参考: grip が通るセルでの予算感度（初版の測り方。捨てずに参考値として残す）。
  const loose = cells.slice().sort((a, b) => b.ratio - a.ratio)[0];
  const spec = buildFromSpec(benchSpec(loose.ratio, loose.W, 'dry'));
  const g1 = lab.optimize(spec, loose.R, loose.W, CAR_KEY, 'grip', ANG, BUDGET.gr, BUDGET.gl, SEED_G, lab.score, spacesFor(loose.W));
  const g2b = lab.optimize(spec, loose.R, loose.W, CAR_KEY, 'grip', ANG, BUDGET.gr * 2, BUDGET.gl * 2, SEED_G, lab.score, spacesFor(loose.W));
  const imp = (g1.r.clean && g2b.r.clean) ? (g1.r.t - g2b.r.t) / g1.r.t : null;
  note(`C-2b （参考）grip が通るセル（比 ${loose.ratio}・W=${loose.W}）の予算感度: 標準 ${g1.r.clean ? g1.r.t.toFixed(4) + 's' : 'DNF'} → 2倍 ${g2b.r.clean ? g2b.r.t.toFixed(4) + 's' : 'DNF'}` +
       `（改善 ${imp != null ? (100 * imp).toFixed(2) + '%' : '算出不能=どちらかが DNF'}）`);
}

console.log(`\n[D] GO 判定（総合時間比 ≤ 0.98 ∧ 進入±10% で 3/3 clean）`);
const goRows = dryRows.filter((r) => r.verdict === 'GO');
{
  const both = dryRows.filter((r) => r.ratioT != null);
  const fast = both.filter((r) => r.ratioT <= 0.98);
  console.log(`  比が出た（両者 clean）行 ${both.length}/8 ／ 速さの条件(≤0.98)を満たす行 ${fast.length} ／ **GO ${goRows.length}**`);
  if (both.length) console.log(`  総合時間比: ${both.map((r) => `${r.ratio}@W${r.W}:${r.ratioT.toFixed(3)}`).join('  ')}`);
  for (const r of goRows) console.log(`  GO: W=${r.W} 比${r.ratio}（R_out/R_min=${r.ratioReal.toFixed(4)}） grip ${r.grip_t}s → drift ${r.drift_t}s（比 ${r.ratioT.toFixed(3)}） 勝ち筋 = entry ${r.drift_entry} / β目標 ${r.drift_beta}° / brake ${r.drift_brakeTicks}tick / 舵 ${r.drift_prop ? 'prop' : 'tri'} → βpk ${r.drift_bpk}°`);
  // **全行**で判定列が定義と一致することを見る（GO 行だけを見ると GO=0 のとき恒真になる）。
  // **生値**で再評価する（保存した丸め値で比べると ratio=0.9800004 のとき判定が食い違う・層 4 レビュー指摘）。
  const bad = dryRows.filter((r) => (r.verdict === 'GO') !== (r.ratioRaw != null && r.ratioRaw <= 0.98 && r.drift_robust === 3));
  ok(bad.length === 0,
     `D-1 判定列は全 ${dryRows.length} 行で定義（時間比 ≤0.98 ∧ 進入±10% 3/3 clean）と一致（不一致 ${bad.length} 行）` +
     `。速さだけ満たして頑健でない行 = ${dryRows.filter((r) => r.ratioT != null && r.ratioT <= 0.98 && r.drift_robust !== 3).length} 本` +
     `（${dryRows.filter((r) => r.ratioT != null && r.ratioT <= 0.98 && r.drift_robust !== 3).map((r) => `W${r.W}/比${r.ratio}: 比 ${r.ratioT.toFixed(3)} だが ${r.drift_robust}/3`).join(' ') || 'なし'}）`);
  // D-2: 反証条件（NO-GO でも成果にする）。**GO が 0 のとき何を言えるか**を機械で固定する。
  if (goRows.length === 0) {
    console.log(`  ⇒ **この格子（外径比 ${RATIOS.join('/')} × 道幅 ${WIDTHS.join('/')}m・卓上既定の路面）には、drift が有利な領域は存在しない。**`);
  }
  note(`D-2 （記録）GO=${goRows.length}/8。${goRows.length === 0
        ? '**この種・この予算では drift が有利なセルは無い**（反証条件どおり NO-GO も成果。ただし「存在しない」と断ずるには種と予算のばらつきが要る ⇒ J 章）'
        : 'GO が出たセルの条件は上に全パラメータを印字した'}`);
  // D-3: **進入 ±10% の頑健性が水増しでないか**を、閾値の当てずっぽうではなく **実走の bit 比較**で測る。
  //   卓上は vRef が車種最高速に張り付くので、進入指令が既に最高速に達している解では +10% 側の run が
  //   元と bit 一致し、頑健性に 1 点タダで入る（層 4 レビュー指摘）。**どの行がそうなのかは走らせれば分かる**
  //   （層 4 レビューは閾値を entry ≥ 1/1.1 と見積もったが、実測すると no-op は entry ≥ 1.0 の行だけだった。
  //    entry 0.93 の +10% は 1.023 で最高速に飽和する一方、基準の 0.93 は飽和していないので別 run になる）。
  const satRows = [];
  for (const r of dryRows) {
    const crs = buildFromSpec(benchSpec(r.ratio, r.W, 'dry'));
    for (const [tag, prm, strat] of [['grip', r.grip_p, 'grip'], ['drift', r.drift_p, 'drift']]) {
      const a = lab.runCornerSwitch(crs, r.R, r.W, CAR_KEY, strat, { ...prm, ang: ANG });
      const b = lab.runCornerSwitch(crs, r.R, r.W, CAR_KEY, strat, { ...prm, ang: ANG, entry: prm.entry * 1.1 });
      const noop = a.t === b.t && a.viol === b.viol && a.betaPk === b.betaPk && a.clean === b.clean;
      satRows.push({ W: r.W, ratio: r.ratio, tag, entry: +prm.entry.toFixed(4), noop });
    }
  }
  const satG = satRows.filter((x) => x.tag === 'grip' && x.noop), satD = satRows.filter((x) => x.tag === 'drift' && x.noop);
  note(`D-3 進入 +10% を実走して基準 run と bit 比較 → **no-op（同一 run）だった行**: grip ${satG.length}/8` +
       `（${satG.map((x) => `W${x.W}/比${x.ratio}:entry ${x.entry}`).join(' ') || 'なし'}） ／ drift ${satD.length}/8（${satD.map((x) => `W${x.W}/比${x.ratio}:entry ${x.entry}`).join(' ') || 'なし'}）`);
  const goSat = goRows.filter((r) => satRows.some((x) => x.tag === 'drift' && x.W === r.W && x.ratio === r.ratio && x.noop));
  ok(goSat.length === 0,
     `D-3 **GO 行の頑健性 3/3 は水増しではない**: GO ${goRows.length} 本のうち、+10% 側が基準と同一 run になる行は ${goSat.length} 本` +
     `（全 8 行では grip ${satG.length} 本・drift ${satD.length} 本が該当。該当行の 3/3 は実質 2/2 なので表の rob 列はそのぶん割り引いて読む）`);
}

console.log(`\n[F] 回復限界（|β| ピークと出口の再グリップ）`);
{
  const bpk = dryRows.map((r) => r.drift_bpk);
  const arpk = dryRows.map((r) => r.drift_arPk);
  const regrip = dryRows.filter((r) => r.drift_exitBeta != null && Math.abs(r.drift_exitBeta) <= 10).length;
  const reached = dryRows.filter((r) => r.drift_exitBeta != null).length;
  console.log(`  drift 最良解の |β| ピーク: ${bpk.map((v) => v.toFixed(0)).join(' / ')} °（最大 ${Math.max(...bpk).toFixed(1)}°）`);
  console.log(`  同 後軸スリップ角ピーク:   ${arpk.map((v) => v.toFixed(0)).join(' / ')} °（最大 ${Math.max(...arpk).toFixed(1)}°）`);
  console.log(`  同 run 中の最小前後速度 uMin:  ${dryRows.map((r) => r.drift_uMin.toFixed(2)).join(' / ')} m/s（vRef=${VREF.toFixed(3)}）`);
  const slowRows = dryRows.filter((r) => r.drift_uMin < 0.1 * VREF);
  console.log(`  ※ β = atan2(vlat, max(|u|,1e-6)) は **u が小さいと意味を失う**。uMin が vRef の 10% (${(0.1 * VREF).toFixed(3)} m/s) を割る行 = ` +
    (slowRows.length ? `${slowRows.map((r) => `W${r.W}/比${r.ratio}`).join(' ')} ＝ その行の βpk は「ほぼ止まった状態の向き」を含みうる` : `**なし**（全行が走っている状態で測れている）`));
  console.log(`  出口面に到達した ${reached}/8 行のうち |出口β| ≤ 10° で再グリップ ${regrip} 行`);
  console.log(`  参考: AO8(fullscale) の律速は舵ではなく **車体側の回復限界 |β| ≈ 36°** だった。`);
  console.log(`  【深さ強制アーム】clean を諦めてでも深く滑らせたときの到達:`);
  console.log(`    |β|ピーク    ${dryRows.map((r) => r.force_bpk.toFixed(0).padStart(3)).join(' /')} °（最大 ${Math.max(...dryRows.map((r) => r.force_bpk)).toFixed(1)}°）`);
  console.log(`    後軸スリップ ${dryRows.map((r) => r.force_arPk.toFixed(0).padStart(3)).join(' /')} °（最大 ${Math.max(...dryRows.map((r) => r.force_arPk)).toFixed(1)}°）`);
  console.log(`    廊下逸脱     ${dryRows.map((r) => r.force_viol.toFixed(3)).join(' / ')} m ／ clean ${dryRows.filter((r) => r.force_clean).length}/8`);
  const deepReached = dryRows.filter((r) => r.force_bpk >= DEEP_MIN);
  ok(deepReached.length >= 1,
     `F-3 **深さ強制アームは実際に深く滑っている**: 8 セル中 ${deepReached.length} セルで |β| ピークが ${DEEP_MIN}° 以上` +
     `（最大 ${Math.max(...dryRows.map((r) => r.force_bpk)).toFixed(1)}°・後軸スリップ角 最大 ${Math.max(...dryRows.map((r) => r.force_arPk)).toFixed(1)}°）` +
     ` ⇒ 「滑らせても通れない」の根拠が「滑っていない走行の失敗」ではないことの担保（層 4 レビュー指摘で新設）`);
  ok(bpk.length === 8 && arpk.length === 8,
     `F-1 全 8 セルで |β| ピーク（最大 ${Math.max(...bpk).toFixed(1)}°）と後軸スリップ角ピーク（最大 ${Math.max(...arpk).toFixed(1)}°）を数値で出した`);
  const moving = dryRows.filter((r) => r.drift_uMin >= 0.1 * VREF);
  const bpkMoving = moving.map((r) => r.drift_bpk);
  // 空配列だと Math.max(...[]) = -Infinity になり、赤いアサートに「回復限界は効いていない」という
  // 正しそうな結論文が付く（層 4 レビュー指摘）。**先に空を弾く**。
  if (moving.length === 0) { ok(false, `F-2 走っている行（uMin ≥ 0.1·vRef）が 0 本 ⇒ |β| ピークを解釈できない`); }
  else ok(true,
     `F-2 （記録）**走っている状態に限った** |β| ピーク最大 = ${Math.max(...bpkMoving).toFixed(1)}°（uMin ≥ 0.1·vRef の ${moving.length}/8 行）` +
     `${Math.max(...bpkMoving) < 36 ? ' < AO8(fullscale) の回復限界 36° ⇒ **回復限界に触れる前に別の何かが律速している**（卓上のこの領域では回復限界は効いていない）' : ' ≥ 36°'}` +
     `。${slowRows.length
        ? `全 8 行の生の最大は ${Math.max(...bpk).toFixed(1)}° だが、これは uMin=${Math.min(...dryRows.map((r) => r.drift_uMin)).toFixed(2)} m/s ＝ ほぼ停止した行を含む（停止近傍の β は「向き」であって滑りではない。CI-14: 代理量でなく実態）`
        : `全 8 行とも uMin ≥ ${Math.min(...dryRows.map((r) => r.drift_uMin)).toFixed(2)} m/s ＝ 停止近傍の行は無く、生の最大 ${Math.max(...bpk).toFixed(1)}° がそのまま読める`}`);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// E: 反証条件 — grip が通れなくなる境界の R_out/R_min（二分探索）
//    GO の有無に関わらず得られる一次データ。**分母 R_min を必ず併記**する。
//
//    **境界は 2 本ある**（AY1 の実測で分かれた。PLAN/AY-0 に 2 通りの式が現れた理由でもある）:
//      ① 進入の横オフセットを使わない（y0 = 0 固定 ＝ 元の実装）
//         舵の下限 R_min で回ると achieved 円の中心が意図線の中心 C から R_min−R だけずれるので、
//         最遠点が 2·R_min − R。これが R + usable 以内に収まる条件は **R + usable/2 ≥ R_min**
//         ⇒ 予測境界 R_out/R_min = 1 + usable/(2·R_min)
//      ② 横オフセットを使える（y0 ∈ [−usable, +usable] を探索空間に入れる ＝ 本ゲート既定）
//         y0 = R − R_min を選べば achieved 円が C と同心になるので条件は **R + usable ≥ R_min**
//         ⇒ 予測境界 R_out/R_min = 1
//    **どちらも実在する**。①は「廊下の真ん中から入る」制約つきの答え、②は幾何そのものの答え。
//    ⚠ ①の式は **回頭角 180° に固有**（C からの距離が φ=π で最大になる性質を使う）。`ANG` は 180 固定
//      だが、変えるなら式を導出し直すこと（層 4 レビュー指摘）。
//    外部へ書くときはどちらの話かを必ず添える（DOC-FIX-1 の教訓と同型）。
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[E] grip が通れなくなる境界の外径比（二分探索・道幅 × 横オフセットの有無）`);
const boundaries = [];
{
  const BI_ITER = FULL ? 11 : 9;        // 区間幅 0.75 → 0.75/2^9 = 0.0015（--full は 0.0004）
  const BR_LO = 0.70, BR_HI = 1.45;     // lo = 通れない想定 / hi = 通れる想定（W=0.28 の①は 1.17 付近）
  const gripPassesAt = (ratio, W, withOffset) => {
    const R = rOf(ratio, W);
    if (!(R > 0)) return false;
    const course = buildFromSpec(benchSpec(ratio, W, 'dry'));   // spec は benchSpec が単一真実源
    const g = lab.optimize(course, R, W, CAR_KEY, 'grip', ANG, BUDGET.gr, BUDGET.gl, SEED_G, lab.score, spacesFor(W, withOffset));
    return g.r.clean;
  };
  for (const W of WIDTHS) for (const withOffset of [false, true]) {
    const u = usableOf(W);
    const predicted = withOffset ? 1 : 1 + u / (2 * R_MIN);
    let lo = BR_LO, hi = BR_HI;
    const loOK = gripPassesAt(lo, W, withOffset), hiOK = gripPassesAt(hi, W, withOffset);
    let iters = 0;
    const bracketed = hiOK && !loOK;
    if (bracketed) for (; iters < BI_ITER; iters++) { const mid = (lo + hi) / 2; if (gripPassesAt(mid, W, withOffset)) hi = mid; else lo = mid; }
    const boundary = bracketed ? (lo + hi) / 2 : null;
    const b = { W, widthCars: +(W / CAR.width).toFixed(2), withOffset, usable: u, predicted,
                bracketed, brLo: BR_LO, brHi: BR_HI, loOK, hiOK, iters, boundary,
                boundaryRout: boundary != null ? boundary * R_MIN : null,
                err: boundary != null ? boundary - predicted : null };
    boundaries.push(b);
    console.log(`  W=${W.toFixed(2)}m（車幅 ${b.widthCars} 台）・横オフセット${withOffset ? 'あり' : 'なし'}: 探索区間 [${BR_LO}, ${BR_HI}]（${loOK ? '通過' : '不能'} / ${hiOK ? '通過' : '不能'}）` +
      (bracketed
        ? ` → **境界 R_out/R_min = ${boundary.toFixed(4)}**（R_out = ${(boundary * R_MIN).toFixed(4)}m・分母 R_min = ${R_MIN.toFixed(4)}m）／ 予測 ${predicted.toFixed(4)}・差 ${(boundary - predicted >= 0 ? '+' : '') + (boundary - predicted).toFixed(4)}`
        : ` → 境界を挟めなかった（探索区間の外）`));
  }
  const off = boundaries.filter((b) => !b.withOffset), on = boundaries.filter((b) => b.withOffset);
  ok(boundaries.every((b) => b.bracketed),
     `E-1 **grip が通れなくなる境界**を全 ${boundaries.length} 条件（道幅 ${WIDTHS.length} × 横オフセット 2）で数値化: ` +
     boundaries.map((b) => `W=${b.W}m/${b.withOffset ? 'オフセットあり' : 'なし'} → R_out/R_min = ${b.bracketed ? b.boundary.toFixed(4) : '--'}（R_out = ${b.bracketed ? b.boundaryRout.toFixed(4) : '--'}m）`).join(' ／ ') +
     `。分母 R_min = ${R_MIN.toFixed(4)}m。**GO の有無に関わらず得られる一次データ**（PLAN AY1 の反証条件）`);
  // E-2: ①（オフセットなし）は解析式 1 + usable/(2·R_min) と一致するか。**知覚でなく数値で照合**（CI-14）。
  // ⚠ メッセージは `ok()` の引数ゆえ**先に評価される**。境界を挟めなかった行を素で toFixed すると
  //   赤いアサートではなく **未捕捉 TypeError** になり、[結果] 行も process.exit も実行されない（層 4 レビュー指摘）。
  const offErr = off.filter((b) => b.bracketed).map((b) => Math.abs(b.err));
  ok(off.every((b) => b.bracketed) && offErr.length > 0 && Math.max(...offErr) <= 0.05,
     `E-2 横オフセットなしの境界は解析式 **1 + usable/(2·R_min)** と一致（` +
     off.map((b) => `W=${b.W}: 実測 ${b.bracketed ? b.boundary.toFixed(4) : '--'} vs 予測 ${b.predicted.toFixed(4)}（差 ${b.bracketed ? b.err.toFixed(4) : '--'}）`).join(' ／ ') +
     `・許容 0.05）⇒ 「舵で通せるか」を決めているのが R_out と R_min の大小であることが実走で裏付けられた`);
  // E-3: ②（オフセットあり）は必ず①より内側（＝オフセットは grip を助ける）。
  const pairs = WIDTHS.map((W) => ({ W, a: off.find((b) => b.W === W), b: on.find((b) => b.W === W) }))
    .filter((q) => q.a && q.b && q.a.bracketed && q.b.bracketed);
  ok(pairs.length === WIDTHS.length && pairs.every((q) => q.b.boundary < q.a.boundary),
     `E-3 **横オフセットは grip を助ける**: 境界が ` + pairs.map((q) => `W=${q.W}: ${q.a.boundary.toFixed(4)} → ${q.b.boundary.toFixed(4)}`).join(' ／ ') +
     ` へ内側に動く（幾何の下限 1.0 に対し ${pairs.map((q) => q.b.boundary.toFixed(4)).join('/')}）` +
     ` ⇒ PLAN/AY-0 に 2 通りの式が現れたのは誤記ではなく **2 つの実在する境界**だった（外部へ書くときは前提を添える）`);
}


// ══════════════════════════════════════════════════════════════════════════════════════
// G: 低μ補助アーム（固定 8 セルとは別枠。AU3 の唯一 GO は低μ側だった）
// ══════════════════════════════════════════════════════════════════════════════════════
const t1 = process.hrtime.bigint();
const lowRows = cells.map((c) => measureCell(c, 'low'));
const tLow = Number(process.hrtime.bigint() - t1) / 1e9;
printTable(`[G] 低μ補助アーム（grip 0.6 / muDecay 0.92 = AO8 の低μ路面。**卓上の既定ではない**・GO 件数は主表 8 セルで数える）`, lowRows);
const goLow = lowRows.filter((r) => r.verdict === 'GO');
{
  const gpL = lowRows.filter((r) => r.gripPass).length;
  console.log(`  低μ: grip 通過 ${gpL}/8 ・ GO ${goLow.length}/8 ・ drift の |β|ピーク最大 ${Math.max(...lowRows.map((r) => r.drift_bpk)).toFixed(1)}°`);
  note(
     `G-1 （記録・別枠）低μ路面での GO = ${goLow.length}/8` +
     (goLow.length
       ? `（${goLow.map((r) => `W${r.W}/比${r.ratio}: 時間比 ${r.ratioT.toFixed(3)}・drift 頑健 ${r.drift_robust}/3・βpk ${r.drift_bpk}°`).join(' ／ ')}）` +
         ` ⇒ **卓上既定の路面では GO 0 だが、低μ路面では GO が出る**。「卓上に drift が有利な領域は無い」とは書けない` +
         `（書けるのは「**卓上の既定の路面には**無い」まで）。この GO の種依存性は J 章が検証する`
       : ` ⇒ 「AU3 の唯一 GO が低μだったのだから低μなら勝てるのでは」という反論は、この種・この予算では成り立たなかった（種のばらつきは J 章）`));
}

// ══════════════════════════════════════════════════════════════════════════════════════
// H: 実壁アーム — 廊下プロキシではなく **実 stadium の壁**で剛体車のクリアランスを掃引する。
//    製品オラクル（CarV2.corners / distToSeg / buildWallGrid+queryRadius / checkCollision）だけを使う。
//
//    **プロキシと実壁は別のことを測っている**（AY1 で実測して分けた）:
//      ・廊下プロキシ（B〜G 章）= 車の**基準点（後輪軸中心）**が半径 R の廊下 [R−usable, R+usable] に
//        収まるか。これが `R_out = R + usable` の意味であり、AX2 の `usable`（道幅ベース）と同じ立場。
//      ・実壁（本章）= **剛体の車体**が収まるか。旋回すると車体の外側前角が基準点の描く円より外へ出る
//        （`swingOut(R)` = wf_touge_driver の既存オラクル。R=R_min で 0.0365m ＝ W=0.16 の usable 0.04m の
//        91% を食う）。∴ 実壁は必ず厳しい。**どちらも正しく、単位が違う**ので両方を数字で出す。
//    弁別性のために、固定 8 セルの外にゆるい**対照セル**（比 1.5 / 2.0）を置く（AP14 の control セルと同型）。
//    これが無いと「実壁では通れない」は反証不能になる。
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[H] 実壁アーム（実 stadium の壁・剛体車の符号付きクリアランス掃引）`);
const wallRows = [];
const WALL_CONTROL_RATIOS = [1.5, 2.0];   // 固定 8 セルの外。**弁別性のためだけ**に置く対照セル
{
  const rad = Math.PI / 180;
  function capGeom(spec) {
    const course = buildFromSpec(spec);
    const rr = +spec.rr, width = +spec.width;
    const outerR = rr + width / 2, innerR = rr - width / 2;
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const w of course.walls) { minX = Math.min(minX, w.x1, w.x2); maxX = Math.max(maxX, w.x1, w.x2); minY = Math.min(minY, w.y1, w.y2); maxY = Math.max(maxY, w.y1, w.y2); }
    return { course, grid: buildWallGrid(course.walls), rr, width, outerR, innerR, capX: maxX - outerR, capY: (minY + maxY) / 2 };
  }
  const insideCorridor = (p, g) => {
    if (p.x >= g.capX) { const r = Math.hypot(p.x - g.capX, p.y - g.capY); return r >= g.innerR && r <= g.outerR; }
    const dy = p.y - g.capY;
    return (dy <= -g.innerR && dy >= -g.outerR) || (dy >= g.innerR && dy <= g.outerR);
  };
  // 剛体車の符号付き壁クリアランス（廊下内=+距離 / 外=−距離）。隅の最小がその姿勢のクリアランス。
  // 探索半径は **車体対角の半分 ＋ 廊下幅** ＝ どの隅からも最寄り壁が必ず候補に入る大きさ
  // （足りないと d が初期値のまま残り、クリアランスが −1e9 に化けて表が無意味になる）。
  function poseClearance(car, g, qr) {
    const near = queryRadius(g.grid, car.x, car.y, qr);
    let sMin = 1e9, noWall = false;
    for (const p of car.corners()) {
      let d = 1e9;
      for (const w of near) { const dd = distToSeg({ x: p.x, y: p.y }, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }); if (dd < d) d = dd; }
      // **隅ごとに**空振りを見る。初版は「4 隅すべてが候補ゼロ」のときしか立たず、廊下外の 1 隅だけが
      // 候補ゼロだと s = −1e9 が最小値になって「収まらない」として素通りした（層 4 レビュー指摘）。
      if (d >= 1e8) noWall = true;
      const s = insideCorridor(p, g) ? d : -d;
      if (s < sMin) sMin = s;
    }
    return { s: sMin, hit: checkCollision(car, near), noWall };
  }
  const PHI0 = -100 * rad, PHI1 = 100 * rad, DPHI = 2.5 * rad;
  function sweepArc(g, car, Rr, yc, bet, qr) {
    const cx = g.capX, cy = g.capY + yc;
    let sMin = 1e9, anyHit = false, noWall = false;
    for (let phi = PHI0; phi <= PHI1 + 1e-9; phi += DPHI) {
      car.x = cx + Rr * Math.cos(phi); car.y = cy + Rr * Math.sin(phi);
      car.theta = phi + Math.PI / 2 + bet;
      const r = poseClearance(car, g, qr);
      if (r.s < sMin) sMin = r.s; if (r.hit) anyHit = true; if (r.noWall) noWall = true;
    }
    return { sMin, anyHit, noWall };
  }
  function bestLine(g, Rs, ycs, betas, qr) {
    const car = new CarV2({ ...g.course.start });
    let best = { s: -1e9, R: null, yc: null, beta: null, hit: true, noWall: false };
    for (const Rr of Rs) for (const yc of ycs) for (const bet of betas) {
      const r = sweepArc(g, car, Rr, yc, bet, qr);
      if (r.sMin > best.s) best = { s: r.sMin, R: Rr, yc, beta: bet, hit: r.anyHit, noWall: r.noWall };
    }
    return best;
  }
  // 掃引格子は **廊下に合わせて作る**（AP14 の固定 4 半径は fullscale のセル用で、卓上の対照セルを拾えない）。
  //   grip = 実舵の下限 R_min 以上・β=0 の定常円弧。外径 outerR までを 12 段。
  //   drift = R_min 未満（滑って初めて描ける半径）を 6 段・車体ヨー β を掃引。
  // **刻みは廊下の余地に対して十分細かくする**。初版は 12 段固定で、対照セル 比2.0/W0.16 の刻み幅が
  //   usable の 75% になり、「収まらない」という**離散化アーチファクト**を出していた（層 4 レビュー指摘・
  //   細格子では +0.0113 m で収まる）。刻みを usable の 1/8 以下に取り、段数は範囲から決める。
  const stepsFor = (lo, hi, u) => Math.max(11, Math.ceil((hi - lo) / (u / 8)));
  const ramp = (lo, hi, n) => { const out = []; for (let k = 0; k <= n; k++) out.push(lo + (hi - lo) * k / n); return out; };
  const gripRs = (g, u) => { const lo = R_MIN, hi = Math.max(R_MIN + 1e-9, g.outerR); return ramp(lo, hi, stepsFor(lo, hi, u)); };
  const driftRs = (g, u) => { const lo = Math.max(0.02, g.innerR + 0.01), hi = Math.max(lo + 1e-9, R_MIN); return ramp(lo, hi, stepsFor(lo, hi, u)); };
  const ycsOf = (u) => ramp(-u, u, 8);
  const BETAS = [-45, -30, -20, -10, 0, 10, 20, 30, 45].map((b) => b * rad);

  function wallCell(ratio, W, kind) {
    const R = rOf(ratio, W), u = usableOf(W), innerWall = R - W / 2;
    const base = { ratio, W, R, usable: u, Rout: R + u, ratioReal: (R + u) / R_MIN, innerWall, kind,
                   swing: swingOut(R_MIN), RoutBody: R + u - swingOut(R_MIN), ratioBody: (R + u - swingOut(R_MIN)) / R_MIN };
    if (innerWall <= 0) return { ...base, skipped: true };
    // **spec は benchSpec を呼ぶ**（初版は object literal を複製しており、benchSpec を直しても
    //   H/E だけ古い定義で走る状態だった＝「単一真実源」が実装されていなかった。層 4 レビュー指摘）。
    const g = capGeom(benchSpec(ratio, W, 'dry'));
    // 探索半径。**基準点は後輪軸中心**なので最遠の隅は `hypot(車長−後端, 車幅/2)` であって
    // 車体対角の半分ではない（層 4 レビュー指摘）。最遠隅 ＋ 廊下幅 を取れば、どの隅からも
    // 廊下の両壁が必ず候補に入る。空振りは H-1b が隅ごとに検出する。
    const qr = Math.hypot(CAR.length - CAR.rearToBack, CAR.width / 2) + W;
    const gr = bestLine(g, gripRs(g, u), ycsOf(u), [0], qr);
    const dr = bestLine(g, driftRs(g, u), ycsOf(u), BETAS, qr);
    return { ...base, skipped: false,
      grip_clr: +gr.s.toFixed(5), grip_fits: gr.s >= 0 && !gr.hit, grip_R: +gr.R.toFixed(4), grip_noWall: gr.noWall,
      drift_clr: +dr.s.toFixed(5), drift_fits: dr.s >= 0 && !dr.hit, drift_R: +dr.R.toFixed(4), drift_beta: Math.round(dr.beta / rad) };
  }

  console.log(`  旋回はみ出し swingOut(R_min) = ${swingOut(R_MIN).toFixed(5)} m（車体外側前角が基準点の円より外へ出る量）`);
  console.log(`  cell            内壁半径 |  R_out 比  車体考慮の比 | grip 幾何(R≥R_min・β=0): clr     最良R  | drift 幾何(R<R_min): clr     最良R   β`);
  for (const c of cells) wallRows.push(wallCell(c.ratio, c.W, 'grid'));
  for (const W of WIDTHS) for (const ratio of WALL_CONTROL_RATIOS) wallRows.push(wallCell(ratio, W, 'control'));
  for (const r of wallRows) {
    const tag = `${r.kind === 'control' ? '対照' : '格子'} 比${String(r.ratio).padEnd(5)}/W${r.W}`;
    if (r.skipped) { console.log(`  ${tag}  ${r.innerWall.toFixed(4)} | **退化（内壁半径 ≤ 0 ＝ 実 stadium として成立しない）ため対象外**`); continue; }
    console.log(`  ${tag}  ${r.innerWall.toFixed(4)} |  ${r.ratioReal.toFixed(4)}   ${r.ratioBody.toFixed(4)}     | ${String(r.grip_clr).padStart(9)} ${r.grip_fits ? 'GO' : 'no'} ${r.grip_R.toFixed(4)} | ${String(r.drift_clr).padStart(9)} ${r.drift_fits ? 'GO' : 'no'} ${r.drift_R.toFixed(4)} ${String(r.drift_beta).padStart(3)}°`);
  }

  const grid = wallRows.filter((r) => r.kind === 'grid');
  const live = grid.filter((r) => !r.skipped), skipped = grid.filter((r) => r.skipped);
  const ctrl = wallRows.filter((r) => r.kind === 'control' && !r.skipped);
  // H-1: 8 セルすべてが表に現れ、落としたのは「内壁半径 ≤ 0」のセルだけ（黙って消していない）。
  ok(grid.length === cells.length && skipped.every((r) => r.innerWall <= 0) && live.every((r) => r.innerWall > 0),
     `H-1 固定 8 セルすべてを表に出し、対象外にしたのは **内壁半径 ≤ 0 の ${skipped.length} セルだけ**` +
     `（${skipped.map((r) => `比${r.ratio}/W${r.W}: ${r.innerWall.toFixed(4)}m`).join(' ') || 'なし'}）。` +
     `これは実 stadium として成立しないという幾何の事実で、廊下プロキシ側は R−usable = ${skipped.map((r) => (r.R - r.usable).toFixed(4)).join(' ') || '--'}m > 0 ゆえ B〜G には含まれる`);
  // 壁が候補に入らずクリアランスが化けていないこと（探索半径の空振り防止）。
  ok([...live, ...ctrl].every((r) => !r.grip_noWall && !r.drift_noWall),
     `H-1b 全 ${live.length + ctrl.length} セルで、掃引したどの姿勢でも **4 隅すべてに**最寄り壁が候補に入っている（探索半径 = 最遠隅 ${Math.hypot(CAR.length - CAR.rearToBack, CAR.width / 2).toFixed(4)}m + 道幅。空振りするとクリアランスが −1e9 に化ける）`);
  const below = live.filter((r) => r.ratio < 1);
  console.log(`  R_out < R_min のセル（比 <1・${below.length} 本）の grip 幾何成立 = ${below.filter((r) => r.grip_fits).length} 本`);
  ok(below.length > 0 && below.every((r) => !r.grip_fits),
     `H-2 **R_out < R_min の ${below.length} セルは実壁でも grip の最善線（R ≥ R_min・β=0）が廊下に収まらない**` +
     `（最善クリアランス ${below.map((r) => r.grip_clr.toFixed(4)).join(' / ')} m < 0）⇒ 廊下プロキシとは独立の経路で同じ結論`);
  // H-3: 弁別性。**対照セル**（固定格子の外・比 1.5/2.0）では同じ掃引が収まる。
  console.log(`  対照セル（比 ${WALL_CONTROL_RATIOS.join('/')}・固定格子の外）の grip 幾何成立 = ${ctrl.filter((r) => r.grip_fits).length}/${ctrl.length} 本`);
  // **全数を要求する**。`>= 1` だと、対照セルの「収まらない」が掃引の離散化誤差でも緑のまま
  // 「掃引の欠陥ではない」と結論してしまう（層 4 レビュー指摘で実際に 3/4 だった）。
  ok(ctrl.length > 0 && ctrl.every((r) => r.grip_fits),
     `H-3 **弁別性**: 同じ掃引が対照セル（比 ${WALL_CONTROL_RATIOS.join('/')}）では ${ctrl.filter((r) => r.grip_fits).length}/${ctrl.length} 本すべてで収まる` +
     `（クリアランス ${ctrl.map((r) => r.grip_clr.toFixed(4)).join(' / ')} m）⇒ H-2 の 0 本は掃引の欠陥ではない`);
  // H-4: プロキシと実壁の食い違いを **量として** 出す（隠さない）。
  const disagree = live.filter((r) => r.ratioReal >= 1 && !r.grip_fits);
  console.log(`  プロキシ基準では通れる（R_out/R_min ≥ 1）が実壁では収まらないセル = ${disagree.length}/${live.filter((r) => r.ratioReal >= 1).length}`);
  note(
     `H-4 （記録）**プロキシと実壁は別の量を測っている**: 旋回はみ出し swingOut(R_min) = ${swingOut(R_MIN).toFixed(5)}m が` +
     ` W=${WIDTHS[0]} の usable ${usableOf(WIDTHS[0]).toFixed(4)}m の ${(100 * swingOut(R_MIN) / usableOf(WIDTHS[0])).toFixed(0)}% を食う。` +
     ` 車体を考慮した比 (R_out − swingOut)/R_min は 格子で ${Math.min(...live.map((r) => r.ratioBody)).toFixed(3)}〜${Math.max(...live.map((r) => r.ratioBody)).toFixed(3)} ＝ **全セルで 1 未満**` +
     `${disagree.length ? `。∴ 比 ${disagree.map((r) => r.ratio).join('/')} の ${disagree.length} セルは「基準点なら通せるが車体では通せない」` : ''}` +
     ` ⇒ 外部へ書くときは「点経路の話か車体の話か」を必ず添える`);
  // drift 幾何アームの読み違いを封じる注記（表に GO と出るが、運転できるとは言っていない）。
  const impossible = [...live, ...ctrl].filter((r) => r.drift_fits && r.drift_R < R_MIN && r.drift_beta === 0);
  // H-6: **公開 desc に書いた「実壁で ○m 収まりません」を、いま測ったクリアランスと照合する**
  //   （層 4 レビュー 2 巡目 ⑨: A-6c は R_out/R_min/比/車体比/道幅しか見ておらず、この数値は無検査だった。
  //    幾何を変えても文言が古いまま緑になる穴が残っていた。）
  {
    const benchSpecsJ = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'courses.json'), 'utf8')).filter((c) => c.bench);
    const badClr = [];
    for (const b of benchSpecsJ) {
      const row = wallRows.find((r) => r.kind === 'grid' && Math.abs(r.ratio - b.ratioOutMin) < 1e-9 && Math.abs(r.W - b.width) < 1e-9);
      if (!row || row.skipped) { badClr.push(`${b.name}: 実壁アームに対応行が無い`); continue; }
      const want = Math.abs(row.grip_clr);
      const mJa = String(b.desc).match(/が ([\d.]+)m 収まりません/);
      const mEn = String(b.desc_en).match(/misses by ([\d.]+) m/);
      if (!mJa || Math.abs(Number(mJa[1]) - want) > 5e-5) badClr.push(`${b.name}: ja ${mJa ? mJa[1] : '(無)'} vs 実測 ${want.toFixed(4)}`);
      if (!mEn || Math.abs(Number(mEn[1]) - want) > 5e-5) badClr.push(`${b.name}: en ${mEn ? mEn[1] : '(無)'} vs 実測 ${want.toFixed(4)}`);
    }
    ok(badClr.length === 0,
       `H-6 公開 ${benchSpecsJ.length} 本の desc/desc_en に書いた「実壁で ○m 収まりません」が本章の実測と一致` +
       `（不一致 ${badClr.length}${badClr.length ? ': ' + badClr.join(' / ') : ''}）`);
  }
  note(`H-5 ⚠ drift 幾何アームは「**その姿勢の剛体が廊下に収まるか**」だけを見ている。R < R_min かつ β=0 の線は` +
       ` **運転では実現できない**（まさに本ゲートが「原理的に不可能」と言っている姿勢）。該当 ${impossible.length} 行` +
       `（${impossible.map((r) => `${r.kind === 'control' ? '対照' : '格子'} 比${r.ratio}/W${r.W}: R=${r.drift_R}`).join(' ') || 'なし'}）。` +
       ` β≠0 の行も「その姿勢を保てれば収まる」までで、**保てるかどうかは動的な問題**＝ J-3 が実走で測っている（結果: 通れない）。` +
       ` ∴ この列の GO を「drift なら入る」と読んではならない`);
}


// ══════════════════════════════════════════════════════════════════════════════════════
// J: GO 候補の頑健性 — **種依存か・予算差の産物か**を潰す
//    「卓上で drift が grip に勝った」は本プロジェクトで初めての結果なので、結論が乱択の種や
//    grip/drift の予算差（drift に 1.6 倍）に依らないことを確かめてから記録する（層 1: 結論が
//    劇的であるほど確認を厚く）。候補 = **速さの条件（時間比 ≤0.98）を満たした行**（主表・低μの両方）。
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[J] GO 候補の頑健性（種依存 / 予算差の検査）`);
const jRows = [];
{
  const ALT_SEEDS = [[101, 102], [211, 212], [331, 332]];
  // **対象は「比較が成立した行」すべて**（grip も drift も clean 解を持つ行）。
  //   速さの条件を満たした行だけに絞ると、GO が 0 のとき本章が丸ごと空振りになる（実測: 予算を上げたら
  //   候補 0 になり J-1/J-4 が恒真になった）。比較が成立している限り、種と予算の感度は常に測れる。
  const cand = [...dryRows.map((r) => ({ ...r, arm: 'dry' })), ...lowRows.map((r) => ({ ...r, arm: 'low' }))]
    .filter((r) => r.ratioT != null);
  const fast = cand.filter((r) => r.ratioT <= 0.98);
  console.log(`  対象（grip/drift とも clean ＝ 比較が成立した行）= ${cand.length} 本${cand.length ? '： ' + cand.map((r) => `${r.arm}/W${r.W}/比${r.ratio}(${r.ratioT.toFixed(3)}・${r.verdict})`).join('  ') : ''}`);
  console.log(`  うち速さの条件（時間比 ≤0.98）を満たした行 = ${fast.length} 本`);
  for (const r of cand) {
    const course = buildFromSpec(benchSpec(r.ratio, r.W, r.arm));
    const SP = spacesFor(r.W);
    const run = (sg, sd, gr, gl, dr, dl) => {
      const g = lab.optimize(course, r.R, r.W, CAR_KEY, 'grip', ANG, gr, gl, sg, lab.score, SP);
      const d = lab.optimize(course, r.R, r.W, CAR_KEY, 'drift', ANG, dr, dl, sd, lab.score, SP);
      const gt = g.r.clean ? g.r.t : null, dt = d.r.clean ? d.r.t : null;
      return { ratio: (gt && dt) ? dt / gt : null, robust: d.robust, gripRobust: g.robust };
    };
    // ① 別の種 3 通り（予算は主表と同じ）
    const alt = ALT_SEEDS.map(([sg, sd]) => run(sg, sd, BUDGET.gr, BUDGET.gl, BUDGET.dr, BUDGET.dl));
    const altFast = alt.filter((x) => x.ratio != null && x.ratio <= 0.98).length;
    const altGo = alt.filter((x) => x.ratio != null && x.ratio <= 0.98 && x.robust === 3).length;
    // ② **grip に drift と同額の予算**を与える（主表は AU3 Part 2 と同型で drift に 1.6 倍ある）
    const eq = run(SEED_G, SEED_D, BUDGET.dr, BUDGET.dl, BUDGET.dr, BUDGET.dl);
    // ③ 両方 2 倍予算
    const big = run(SEED_G, SEED_D, BUDGET.gr * 2, BUDGET.gl * 2, BUDGET.dr * 2, BUDGET.dl * 2);
    const row = { arm: r.arm, W: r.W, ratio: r.ratio, base: r.ratioT, baseVerdict: r.verdict,
                  alt: alt.map((x) => (x.ratio != null ? +x.ratio.toFixed(4) : null)), altFast, altGo,
                  eqRatio: eq.ratio != null ? +eq.ratio.toFixed(4) : null, eqRobust: eq.robust,
                  bigRatio: big.ratio != null ? +big.ratio.toFixed(4) : null, bigRobust: big.robust,
                  // 札は「**別種のすべてが主表と同じ GO 判定になるか**」。
                  //   初版は多数決（3 種中 2 種一致なら安定）にしていたため、**別種で GO が 1 本出ても
                  //   「種に安定」**と出た（層 4 レビュー指摘: 種 (211,212) で dry/W0.28/比1.02 が
                  //   時間比 0.932・drift 頑健 3/3 ＝ 文字どおり GO）。判定が 1 つでも裏返ったら種依存。
                  seedFlip: (r.verdict === 'GO') ? (ALT_SEEDS.length - altGo) : altGo };
    row.seedStable = row.seedFlip === 0;
    jRows.push(row);
    console.log(`  ${r.arm}/W${r.W}/比${r.ratio}: 主表 ${r.ratioT.toFixed(3)}（${r.verdict}）` +
      ` ／ 別種 3 通り ${row.alt.map((v) => (v == null ? 'DNF' : v.toFixed(3))).join(' ')}（≤0.98 が ${altFast}/3・うち GO ${altGo}/3）` +
      ` ／ **grip 等予算** ${row.eqRatio != null ? row.eqRatio.toFixed(3) : 'DNF'}（drift 頑健 ${row.eqRobust}/3）` +
      ` ／ 両方2倍 ${row.bigRatio != null ? row.bigRatio.toFixed(3) : 'DNF'}（${row.bigRobust}/3）` +
      ` → ${row.seedStable ? '種に安定' : `**種依存**（${row.seedFlip}/${ALT_SEEDS.length} 種で判定が裏返る）`}`);
  }
  // **候補 0 は空振りではなく結論**（速さの条件を満たす行が 1 本も無い）。非空振りの担保は J-3 が持つ。
  ok(cand.length >= 1,
     `J-1 非空振り: 比較が成立した行（grip/drift とも clean）が ${cand.length} 本あり、種と予算の感度を実際に測っている` +
     `。うち速さの条件（時間比 ≤0.98）を満たしたのは ${fast.length} 本` +
     `${fast.length === 0 ? ' ＝ **この予算では drift が grip に勝つ行が 1 本も無い**' : ''}`);
  ok(jRows.length === cand.length && jRows.every((x) => x.alt.length === ALT_SEEDS.length),
     `J-2 全 ${jRows.length} 候補について 別種 ${ALT_SEEDS.length} 通り＋grip 等予算＋両方 2 倍予算の再測を実施した`);
  // ── ここからが本章の本体。**当初 J-3 に「GO は予算差の産物ではない」と書いて実行したら赤になった**。
  //    低μ W=0.28/比1.02 の GO（時間比 0.877）は、grip へ drift と同額の予算を与えると **0.981** になり
  //    速さの条件 0.98 を割る。∴ あの GO は **drift だけ 1.6 倍探索したこと**の産物であって物理ではない。
  //    ∴ 述語を「そうであってほしいこと」から「実測で安定する不変条件」へ置き直した（赤の事実は J-5 に残す）。
  const goCand = jRows.filter((x) => x.baseVerdict === 'GO');
  const eqHold = goCand.filter((x) => x.eqRatio != null && x.eqRatio <= 0.98);
  // J-3: **「ドリフトが必須」な領域は存在しない** — grip が通れないセルでは drift も 1 本も通れない。
  //   これが本ブロックの問い（卓上に「ドリフトが必須／有利」な領域はあるか）の前半への直接の答え。
  const hard = [...dryRows.map((r) => ({ ...r, arm: 'dry' })), ...lowRows.map((r) => ({ ...r, arm: 'low' }))]
    .filter((r) => !r.gripPass);
  const hardDrift = hard.filter((r) => r.driftPass);
  const hardForce = hard.filter((r) => r.force_clean);                       // 深さ強制アームで通れたセル
  const hardDeepOK = hard.filter((r) => r.force_bpk >= DEEP_MIN);            // 実際に深く滑れたセル
  console.log(`  grip が通れない ${hard.length} セル（主表 ${dryRows.filter((r) => !r.gripPass).length} ＋ 低μ ${lowRows.filter((r) => !r.gripPass).length}）:`);
  console.log(`    無制約 drift アームで通れた = ${hardDrift.length} ／ **深さ強制**アームで通れた = ${hardForce.length}`);
  console.log(`    深さ強制アームの到達 |β|ピーク = ${hard.map((r) => r.force_bpk.toFixed(0)).join('/')} °（${DEEP_MIN}° 以上に達したセル ${hardDeepOK.length}/${hard.length}）`);
  console.log(`    同 後軸スリップ角ピーク = ${hard.map((r) => r.force_arPk.toFixed(0)).join('/')} ° ／ 廊下逸脱 = ${hard.map((r) => r.force_viol.toFixed(3)).join('/')} m`);
  // **証拠の質を述語に入れる**。初版は「無制約アームが clean 0」だけを見ており、そのアームは
  //   後軸スリップ角 2〜3°＝ほぼ滑っていない走行だった（層 4 レビュー指摘）。深さ強制アームで
  //   **実際に深く滑らせたうえで**通れないことを要求する。
  ok(hard.length >= 4 && hardDrift.length === 0 && hardForce.length === 0 && hardDeepOK.length >= 1,
     `J-3 **「ドリフトが必須」な領域は存在しない**: grip が通れない ${hard.length} セル（R_out/R_min < 1）では、` +
     `無制約の drift アーム（clean ${hardDrift.length} 本）でも、**実際に |β| ${Math.max(...hard.map((r) => r.force_bpk)).toFixed(0)}° まで滑らせた深さ強制アーム**` +
     `（${DEEP_MIN}° 以上に達したセル ${hardDeepOK.length}/${hard.length}・後軸スリップ角 最大 ${Math.max(...hard.map((r) => r.force_arPk)).toFixed(0)}°）でも clean ${hardForce.length} 本` +
     ` ⇒ **舵で通れない廊下は、滑らせても通れない**（廊下逸脱は最小でも ${Math.min(...hard.map((r) => r.force_viol)).toFixed(4)} m 残る）`);
  // J-4: **勝ち候補はすべて grip も通れるセル** ＝ drift の優位が出るとしても「必須」ではなく「有利」の話。
  ok(fast.every((r) => r.gripPass) && cand.every((r) => r.gripPass),
     `J-4 比較が成立した ${cand.length} 本（うち速さの条件を満たす ${fast.length} 本）は **すべて grip も通れるセル**` +
     `（比 ${[...new Set(cand.map((r) => r.ratio))].join('/')}）⇒ 卓上で drift に出番があるとしても「舵で通れないから滑る」ではなく「舵でも通れるが速いかもしれない」の話`);
  // J-5: 予算差の検査（**当初の J-3。赤になった事実そのものを固定する**）。
  console.log(`  GO ${goCand.length} 本のうち grip 等予算（${BUDGET.dr}+${BUDGET.dl} 評価）でも時間比 ≤0.98 を保つ = ${eqHold.length} 本`);
  const eqShift = jRows.filter((x) => x.eqRatio != null).map((x) => x.eqRatio - x.base);
  const eqFast = jRows.filter((x) => x.eqRatio != null && x.eqRatio <= 0.98);
  const bigAll = jRows.filter((x) => x.bigRatio != null).map((x) => x.bigRatio);
  // **等予算でも「勝ち」が出ることがある**。原因は drift が強いからではなく、乱択+局所改良が予算に対して
  //   単調でないから（`wf_drift_reexam.mjs` の AU3-b1 も同じ性質を実測で記録している）。予算を増やすと
  //   grip の最良解が悪化する場合があり、時間比がそのぶん下がる。隠さず件数で出す。
  if (eqFast.length) note(`J-5b ⚠ **等予算でも時間比 ≤0.98 になった行 = ${eqFast.length}/${jRows.length}**` +
    `（${eqFast.map((x) => `${x.arm}/W${x.W}/比${x.ratio}: ${x.base.toFixed(3)} → ${x.eqRatio.toFixed(3)}・drift 頑健 ${x.eqRobust}/3`).join(' ／ ')}）` +
    `。乱択+局所改良は予算に単調でないので、予算を増やすと grip 側が悪化することがある（AU3-b1 と同じ性質）`);
  else note(`J-5b 等予算で時間比 ≤0.98 になった行 = 0/${jRows.length}`);
  // 予算 → ∞ の振る舞い。drift の探索空間は「滑らないグリップ線」も表現できる（実測: 最良 drift 解の
  //   後軸スリップ角ピークが 1〜2°）ので、予算を増やすほど drift_t は grip_t へ**上から**寄る。
  //   ∴ 閾値 0.98 は「drift が速いか」だけでなく **探索ノイズの残り**も測っている。
  note(`J-5c 両方 2 倍予算での時間比 = ${bigAll.map((v) => v.toFixed(3)).join(' / ')}` +
    `（1.000 付近へ寄る＝drift 空間はグリップ線も表現できるので、予算を増やすほど drift_t は grip_t へ上から近づく。` +
    `∴ 閾値 0.98 は「drift が速いか」に加えて **探索ノイズの残り具合**も測っている）`);
  ok(jRows.filter((x) => x.eqRatio != null).length >= 1,
     `J-5 **予算差の効き（記録）**: grip へ drift と同額（${BUDGET.dr}+${BUDGET.dl} 評価）の予算を与えると時間比は ` +
     jRows.map((x) => `${x.arm}/W${x.W}/比${x.ratio}: ${x.base.toFixed(3)} → ${x.eqRatio != null ? x.eqRatio.toFixed(3) : 'DNF'}`).join(' ／ ') +
     `（変化 ${eqShift.length ? eqShift.map((v) => (v >= 0 ? '+' : '') + v.toFixed(3)).join('/') : '--'}）。` +
     `GO ${goCand.length} 本のうち等予算でも ≤0.98 を保つのは ${eqHold.length} 本` +
     `${goCand.length && eqHold.length === 0 ? ' ＝ **その GO は予算差の産物**。外部へ書くときは「grip に同じ予算を与えると消える」を必ず添える' : ''}` +
     `。※ **旧既定予算 {60,40,100,60} では低μ W=0.28/比1.02 に GO が 1 本出て、等予算にすると 0.877 → 0.981 で消えた**` +
     `（2026-09-07 実測）。それが既定予算を現在値へ引き上げた理由（上の BUDGET のコメント）`);
  // J-6: 種依存性の札（記録）。**外部へ書くときはこの札を必ず添える**。
  const flaky = jRows.filter((x) => !x.seedStable);
  // 「GO の裏返り」だけでなく「**速さの条件**の裏返り」も出す（GO は頑健性込みなので鈍い）。
  const fastFlip = jRows.filter((x) => ((x.base <= 0.98) ? (ALT_SEEDS.length - x.altFast) : x.altFast) > 0);
  const ratiosAll = jRows.flatMap((x) => [x.base, ...x.alt.filter((v) => v != null)]);
  console.log(`  GO 判定が種で裏返る行 = ${flaky.length}/${jRows.length} ／ **速さの条件（≤0.98）が種で裏返る行 = ${fastFlip.length}/${jRows.length}**` +
    `（${fastFlip.map((x) => `${x.arm}/W${x.W}/比${x.ratio}: ${x.altFast}/${ALT_SEEDS.length} 種で ≤0.98`).join(' ／ ') || 'なし'}）`);
  console.log(`  時間比の種を含めた分布 = ${Math.min(...ratiosAll).toFixed(3)}〜${Math.max(...ratiosAll).toFixed(3)}（GO 閾値 0.98 を${Math.min(...ratiosAll) <= 0.98 && Math.max(...ratiosAll) > 0.98 ? '**跨ぐ**' : '跨がない'}）`);
  // **flaky な行が grip 不能セルに現れたら J-3 と矛盾する**＝ここが赤くなれば本当に問題。
  const gripPassOf = (x) => cand.find((c) => c.arm === x.arm && c.W === x.W && c.ratio === x.ratio).gripPass;
  ok(flaky.every(gripPassOf),
     `J-6 **GO 判定が種で揺れる行 ${flaky.length} 本はすべて grip も通れるセル**` +
     `（${flaky.map((x) => `${x.arm}/W${x.W}/比${x.ratio}: 主表 ${x.base.toFixed(3)} / 別種 ${x.alt.map((v) => v == null ? 'DNF' : v.toFixed(3)).join(' ')}`).join(' ／ ') || 'なし'}）` +
     ` ⇒ 揺れているのは「drift が**速い**か」であって「drift が**必須**か」ではない。` +
     `∴ 本ゲートが言い切れるのは J-3（必須の領域は無い・種にも予算にも堅い）まで。` +
     `**「drift が有利な領域は存在しない」は種に依存する**（時間比は種込みで ${Math.min(...ratiosAll).toFixed(3)}〜${Math.max(...ratiosAll).toFixed(3)} に散り、閾値 0.98 を${Math.min(...ratiosAll) <= 0.98 ? '跨ぐ' : '跨がない'}。` +
     `**速さの条件が種で裏返る行 ${fastFlip.length}/${jRows.length}**）` +
     `。外部へ書くときは「主表の種では GO 0・別種 ${jRows.length * ALT_SEEDS.length} 通り中 ${jRows.reduce((a, x) => a + x.altGo, 0)} 通りで GO・${jRows.reduce((a, x) => a + x.altFast, 0)} 通りで時間比 ≤0.98」を必ず添える`);
}


// ══════════════════════════════════════════════════════════════════════════════════════
// I: 決定論
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[I] 決定論`);
{
  const c = cells[0];
  const course = buildFromSpec(benchSpec(c.ratio, c.W, 'dry'));
  const prm = { prop: false, entry: 0.9, ang: ANG, beta: 25, tLead: 1.0, lead: 0.1, brakeTicks: 3,
                kp: 0.06, kd: 0.002, catchGain: 60, kInit: 0.5, kHold: 0.3, kHoldLo: 0, kCatch: 0.1, kCatchLo: 0, kExit: 0.1 };
  const a1 = lab.runCornerSwitch(course, c.R, c.W, CAR_KEY, 'drift', prm);
  const a2 = lab.runCornerSwitch(course, c.R, c.W, CAR_KEY, 'drift', prm);
  ok(a1.t === a2.t && a1.clean === a2.clean && a1.betaPk === a2.betaPk && a1.viol === a2.viol,
     `I-1 同一パラメータ 2 回が bit 一致（t=${a1.t == null ? 'DNF' : a1.t.toFixed(6)} βpk=${a1.betaPk.toFixed(6)} viol=${a1.viol.toFixed(6)}）`);
  const o1 = lab.optimize(course, c.R, c.W, CAR_KEY, 'drift', ANG, 12, 8, SEED_D, lab.score, spacesFor(c.W));
  const o2 = lab.optimize(course, c.R, c.W, CAR_KEY, 'drift', ANG, 12, 8, SEED_D, lab.score, spacesFor(c.W));
  ok(o1.sc === o2.sc && o1.p.beta === o2.p.beta && o1.robust === o2.robust,
     `I-2 最適化 2 回が bit 一致（固定シード ${SEED_D}・score=${o1.sc.toFixed(6)} β=${o1.p.beta.toFixed(4)}）`);
}

console.log(`\n  所要: 主表(dry) ${tDry.toFixed(1)}s ／ 低μ ${tLow.toFixed(1)}s ／ 実行 run 合計 ${lab.stats.runs}（うち後退打ち切り ${lab.stats.reversed}）`);

if (WANT_JSON) {
  console.log('===JSON===');
  console.log(JSON.stringify({ appVersion: APP_VERSION, gate: 'AY1-rmin-bench', sweep: FULL ? 'full' : 'reduced',
    regime: REGIME_STATE.active, engine: PHYSICS.mode, carKey: CAR_KEY,
    rMin: +R_MIN.toFixed(6), vRef: +VREF.toFixed(6), diag: +DIAG.toFixed(6),
    ratios: RATIOS, widths: WIDTHS, ang: ANG, budget: BUDGET, labCfg: LAB_CFG, entrySpace: ENTRY, leadSpace: LEAD,
    cells, dry: dryRows, low: lowRows, wall: wallRows, boundaries, goRobust: jRows,
    goDry: goRows.length, goLow: goLow.length, runs: lab.stats.runs, reversed: lab.stats.reversed }, null, 0));
}

// **公開文書に書いたアサート数を、このゲート自身の実数と突き合わせる**（層 4 レビュー 1 巡目 A2・2 巡目 ②）。
//   同じ欠陥を「その欠陥の修理中に」もう一度作ったので、人の記憶ではなく機構で止める。
//   数える対象は**この検査自身を含めた総数** = pass + fail + 1。
{
  const want = pass + fail + 1;
  const src = [
    ['docs/physics_model.md',    /\(本節・(\d+) アサート/],
    ['docs/physics_model.en.md', /\(this section; (\d+) assertions/],
    ['public/js/changelog.js',   /wf_ay1_rmin_bench\.mjs` \((\d+) アサート\)/],
    ['public/js/changelog.js',   /wf_ay1_rmin_bench\.mjs` \((\d+) assertions\)/],
  ];
  const bad = [];
  for (const [f, re] of src) {
    const m = readFileSync(join(ROOT, f), 'utf8').match(re);
    if (!m) bad.push(`${f}: 記載が見つからない (${re})`);
    else if (Number(m[1]) !== want) bad.push(`${f}: 記載 ${m[1]} ≠ 実数 ${want}`);
  }
  ok(bad.length === 0,
     `Z-1 公開文書 ${src.length} 箇所のアサート数が実数 ${want} と一致` +
     `（不一致 ${bad.length}${bad.length ? ': ' + bad.join(' / ') : ''}）⇒ ゲートを増減したら文書も直さないと赤`);
}

console.log(`\n[結果] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
