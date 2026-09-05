// wf_av1_loose.mjs — Stage AV1「ルーズ路面属性 course.surface='loose'（掘り込み項）」受け入れゲート。
// ══════════════════════════════════════════════════════════════════════════════════════
// 既存の路面属性 grip / muDecay は **「滑るほど落ちる」曲線しか作れない**（mfCoeffs が muDecay を
// [0.35,0.95] にクランプするので g(σ)=sin(C·atan(Bp·σ)) は σ>1 で必ず単調減少する。実測: muDecay に
// 0.99 や 1.0 を渡してもクランプされて 0.95 と同一係数になる）。砂利・ダート・雪といったルーズ路面は
// タイヤが表層へ潜って材料を押しのける（bulldozing＝掘り込み）ため、横力は滑らせても落ちず、
// むしろ深い滑り角でピークを迎える。AV1 はこれを **コースの任意フィールド** として足した。
//
//   F_ss = μ·Fz·[ g(σ) + dig·min(σ/digSat, 1) ]        μ_eff = μ·(1 + dig)
//
// **再実装せず 実 tireForceMF / CarV2.step / buildFromSpec / checkFields / courseHashOf を呼ぶ**
// （CI-14。オラクル一覧は internal の docs/oracle_inventory.md）。
//
// 構成:
//   [A] 既定の完全縮退（フィールド無し／'paved'／未知値 は掘り込みの項が式に入らない＝byte 不変）
//   [B] 掘り込みの法則（散逸性・摩擦円・σ 比例＋クランプ・ピーク移動・領域不変。各々に検出力を併記）
//   [C] 効果（AO8 低μベンチを loose 化した自由空間 go/no-go。ドライバは AU3 `wf_drift_reexam.mjs` と同型）
//   [D] validate_courses のフィールド検査と検出力
//   [E] 記録（courseHashOf が surface を含まない既存の穴＝AS10 §4(f) と同型・人間裁定待ち）
//
// 使い方:
//   node wf_av1_loose.mjs          # 既定=縮小掃引。アサート緑/赤で exit 0/1
//   node wf_av1_loose.mjs --full   # 全表（docs 転記用・桁違いに長い）
//   node wf_av1_loose.mjs --json   # 表を JSON で吐く（internal の docs/stage_av/ へ整形転記）
// 所要は末尾に Part 別で印字する（ホスト依存ゆえ本文に固定値を書かない）。
// ══════════════════════════════════════════════════════════════════════════════════════
import { CarV2, V2, mfCoeffs, tireForceMF, tireParamsFor, surfaceParamsFor } from './public/js/physics_v2.js';
import { applyRegime, DYN, DynCar } from './public/js/physics_dyn.js';
import { Car } from './public/js/physics.js';
import { CAR, CONST, CAR_TYPES, SURFACES, setPhysicsMode, APP_VERSION } from './public/js/config.js';
import { buildFromSpec } from './public/js/course.js';
import { freeSpawn, rebuildSpawns } from './public/js/fleet.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';
import { courseHashOf } from './public/js/lap.js';
import { checkFields } from './validate_courses.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FULL = process.argv.includes('--full');
const WANT_JSON = process.argv.includes('--json');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const DT = 1 / 60, deg = 180 / Math.PI, rad = Math.PI / 180;
const beta = (c) => Math.atan2(c.vlat, Math.max(Math.abs(c.u), 1e-6)) * deg;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const benches = JSON.parse(readFileSync(join(ROOT, 'docs', 'stage_ao', 'bench_courses.json'), 'utf8'));
const shipped = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'courses.json'), 'utf8'));

setPhysicsMode('v2'); applyRegime('fullscale');
const Tn = tireParamsFor('normal');
const LOOSE = surfaceParamsFor('loose');
const R_MIN = CAR.wheelBase / Math.tan(CAR.maxSteer);
const HALF_W_CAR = CAR.width / 2;
const BENCH_LOW = benches.find(b => b.name === 'bench-hairpin-R5-low');   // 低μベンチ（B/C 共用）
const T0 = process.hrtime.bigint(); let MARK = T0;
const lap = () => { const n = process.hrtime.bigint(); const v = Number(n - MARK) / 1e9; MARK = n; return v; };
let tA = 0, tB = 0, tC = 0, tD = 0;

console.log(`\n[AV1] ルーズ路面（掘り込み項）ゲート  APP=${APP_VERSION}  fullscale v2  R_min=${R_MIN.toFixed(3)}m`);
console.log(`  掃引: ${FULL ? '系統(--full・docs 転記用)' : '既定 縮小'}   SURFACES.loose = dig ${LOOSE.dig} / digSat ${LOOSE.digSat}（μ_eff = μ×${(1 + LOOSE.dig).toFixed(2)}）`);

// ══════════════════════════════════════════════════════════════════════════════════════
// [A] 既定の完全縮退 — 「非活性なら式に入れない」が実際に守られているか
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[A] 既定の完全縮退`);
{
  // A1: 解決規則。未指定/'paved'/未知値 はすべて null（＝掘り込みなし）。
  const resolved = [undefined, null, 'paved', 'bogus', ''].map(v => surfaceParamsFor(v));
  ok(resolved.every(r => r === null) && LOOSE && LOOSE.dig > 0 && LOOSE.digSat > 0,
     `A1 解決規則: 未指定/null/'paved'/未知値/'' はすべて null（掘り込みなし）・'loose' のみ定義を返す`);

  // A2: tireForceMF は dig 省略 と dig=null で **全格子 bit 一致**、かつ |F| が muFz·g(σ) と bit 一致
  //     （＝掘り込みが「0 を足している」のではなく「式に入っていない」ことの確認）。
  const { C, Bp } = mfCoeffs(Tn.muDecay);
  const muFz = 12.0;
  let bitDiff = 0, gDiff = 0, n = 0;   // gDiff は最悪 **相対** 誤差
  for (let ik = -40; ik <= 40; ik++) for (let ia = -40; ia <= 40; ia++) {
    const kappa = ik * 0.1, ta = ia * 0.1;
    const a = tireForceMF(kappa, ta, muFz, C, Bp, Tn.kappaP, Tn.alphaP);
    const b = tireForceMF(kappa, ta, muFz, C, Bp, Tn.kappaP, Tn.alphaP, null);
    if (!Object.is(a.fx, b.fx) || !Object.is(a.fy, b.fy) || !Object.is(a.sigma, b.sigma)) bitDiff++;
    // 独立再計算。**bit 一致は要求しない**: |F| は hypot(Fss·nk/σ, Fss·na/σ) と成分から再合成するので
    // 丸めが入り、Fss と bit 一致しないのが正しい挙動（当初 Object.is を要求して 6561 中 1732 が赤に
    // なったのは述語の誤り）。ここで見たいのは「舗装の曲線が muFz·g(σ) そのものか」なので相対誤差で測る。
    if (a.sigma >= 1e-6) {
      const want = muFz * Math.sin(C * Math.atan(Bp * a.sigma));
      gDiff = Math.max(gDiff, Math.abs(Math.hypot(a.fx, a.fy) - want) / want);
    }
    n++;
  }
  ok(bitDiff === 0, `A2 dig 省略 と dig=null が ${n} 格子で bit 一致（不一致 ${bitDiff}）`);
  ok(gDiff < 4e-16, `A2' 舗装の曲線は muFz·g(σ) そのもの（独立再計算・最悪 **相対** 誤差 ${gDiff.toExponential(2)} = 丸め ${(gDiff / Number.EPSILON).toFixed(1)} ulp）`);
  console.log(`      ※ 「掘り込みが式に入っていない」ことの証拠は本アサートではなく **f0〜f3 の凍結値一致・`);
  console.log(`         正準 verifyHash 不変・上の A4（本番 600 step が bit 一致）** である（別ゲート wf_ab8_bench / wf_official_result）。`);

  // A3: 出荷 41 コースに surface は 0 件 ＋ buildFromSpec の JSON 往復 byte 一致。
  const withField = shipped.filter(s => s.surface !== undefined).length;
  let rtDiff = 0;
  for (const s of shipped) {
    const a = JSON.stringify(buildFromSpec(s));
    const b = JSON.stringify(buildFromSpec(JSON.parse(JSON.stringify(s))));
    if (a !== b) rtDiff++;
  }
  // 【是正・敵対的レビュー 軽3】当初は `withField === 0` を**要求**していたが、それは
  //   「ルーズ路面のコースを1本でも同梱した瞬間に常設ゲートが赤になる」＝本機能の意図された使い方を
  //   禁止する反転アサートだった。要求するのは **JSON 往復の byte 一致**（コース定義の可逆性）だけにし、
  //   同梱数は**記録**に落とす（0 でなくなること自体は正常）。
  ok(rtDiff === 0, `A3 出荷 ${shipped.length} コースの buildFromSpec JSON 往復 byte 一致（差 ${rtDiff}）`);
  console.log(`      （記録）出荷コースのうち surface を持つもの = ${withField} 件（0 でなくてもよい＝同梱は将来の正常な使い方）`);

  // A4: 本番 CarV2 の実走。surface 無し / 'paved' / 未知値 が **最終状態まで bit 一致**、'loose' だけ違う。
  const specLow = benches.find(b => b.name === 'bench-hairpin-R5-low');
  const runV2 = (sf) => {
    const spec = sf === undefined ? specLow : { ...specLow, surface: sf };
    const course = buildFromSpec(spec);
    const c = new CarV2({ ...course.start, x: 0, y: 0, theta: 0 });
    c.type = 'normal_fr'; c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.LEFT;
    for (let i = 0; i < 600; i++) c.step(DT);
    return [c.x, c.y, c.theta, c.u, c.vlat, c.r];
  };
  const base = runV2(undefined), paved = runV2('paved'), bogus = runV2('bogus'), loose = runV2('loose');
  const same = (a, b) => a.every((v, i) => Object.is(v, b[i]));
  ok(same(base, paved) && same(base, bogus),
     `A4 本番 CarV2 600 step: surface 無し / 'paved' / 未知値 が bit 一致（x=${base[0].toFixed(9)}）`);
  ok(!same(base, loose),
     `A4' 対照: 'loose' だけ軌跡が動く（Δx=${(loose[0] - base[0]).toExponential(3)} Δβ=${(Math.atan2(loose[4], Math.abs(loose[3])) - Math.atan2(base[4], Math.abs(base[3]))).toExponential(3)}）`);

  // A5: 非対象エンジン（standard / dynamic は σ も MF 曲線も持たない）。同一入力で bit 一致すること。
  const runOther = (Klass, sf) => {
    const spec = sf === undefined ? specLow : { ...specLow, surface: sf };
    const course = buildFromSpec(spec);
    const c = new Klass({ ...course.start, x: 0, y: 0, theta: 0 });
    c.type = 'normal_fr'; c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.LEFT;
    for (let i = 0; i < 600; i++) c.step(DT);
    return [c.x, c.y, c.theta];
  };
  const s0 = runOther(Car, undefined), s1 = runOther(Car, 'loose');
  const d0 = runOther(DynCar, undefined), d1 = runOther(DynCar, 'loose');
  ok(same(s0, s1), `A5 standard（クラシック）は surface を無視（600 step 後の座標が厳密一致 x=${s0[0].toFixed(9)}）`);
  ok(same(d0, d1), `A5' dynamic（動力学）も surface を無視（厳密一致 x=${d0[0].toFixed(9)}）`);

  // A6: **spawn 経路**（実 freeSpawn / rebuildSpawns）が surface を車まで届けるか。
  //  【実装中に実際に落ちていた欠陥・実ブラウザゲート T3-d が検出】fleet.js は `course.start` を
  //   丸ごと渡さず、車が読むフィールドだけを写した meta を作る。その写しが **freeSpawn と
  //   rebuildSpawns の 2 箇所に重複**していたため、AV1 の初版は両方に surface を書き忘れ、
  //   単体の CarV2 では効くのに `runRace` では traceHash が 1 bit も動かなかった。
  //   ∴ **単体の車ではなく spawn 経路で**確かめる述語をここに置く（node 側でも同じ型の欠陥を捕まえる）。
  const spawnOf = (sf) => freeSpawn(buildFromSpec(sf === undefined ? specLow : { ...specLow, surface: sf }), [], 0);
  const spNone = spawnOf(undefined), spPaved = spawnOf('paved'), spLoose = spawnOf('loose');
  const carVia = (sp) => { const c = new CarV2(sp); return c.surface; };
  ok(spNone.surface === undefined && spPaved.surface === 'paved' && spLoose.surface === 'loose'
     && carVia(spLoose) === 'loose' && surfaceParamsFor(carVia(spLoose)) !== null,
     `A6 spawn 経路: freeSpawn が surface を運び車まで届く（未指定=${JSON.stringify(spNone.surface)} / paved=${spPaved.surface} / loose=${spLoose.surface} → car.surface=${carVia(spLoose)}）`);
  // 【是正・敵対的レビュー 軽1】当初は `spawnOf(undefined)` を**自分自身と**比べており恒真だった。
  //   「従来と同じ形」を主張するなら **キー列をリテラルで固定**しないと検査にならない。
  const SPAWN_KEYS_NO_SURFACE = 'x,y,theta,downhill,grip,muDecay';   // AV1 以前の freeSpawn が返す形（低μベンチ）
  ok(Object.keys(spNone).join(',') === SPAWN_KEYS_NO_SURFACE,
     `A6' 未指定コースの spawn は AV1 以前と同じキー列 [${SPAWN_KEYS_NO_SURFACE}]（実測 [${Object.keys(spNone).join(',')}]）＝JSON 往復と凍結記録が byte 不変`);

  // A7: **本番 runRace** の traceHash（実ブラウザゲート T3-d の node 版）。
  //   loose で変わり、未指定と 'paved' は一致すること。ここが「配線されているか」の最終判定。
  const prog = PROGRAMS.find((x) => x.key === 'normal_fr');
  const traceOf = (sf) => runRace({
    course: buildFromSpec({ name: 'AV1 配線検査', kind: 'track', shape: 'stadium', L: 1.6, rr: 0.62, samples: 120, width: 0.42, grip: 0.6, ...(sf ? { surface: sf } : {}) }),
    laps: 2, interact: false, trace: true, physics: 'v2',
    field: [{ name: 'A', lang: 'c', src: prog.code, carType: 'normal_fr' }],
    crashRule: { rejoin: false, penaltySec: 3 },
  }).traceHash;
  const trNone = traceOf(null), trNone2 = traceOf(null), trPaved = traceOf('paved'), trLoose = traceOf('loose');
  ok(trNone === trNone2 && trNone === trPaved && trNone !== trLoose,
     `A7 本番 runRace の traceHash: 未指定 ${trNone} = 2回目 ${trNone2} = paved ${trPaved} ≠ loose ${trLoose}`);
  console.log(`      ※ A7 は「単体の車では効くのに本番経路では効かない」型の欠陥（AV1 実装中に実在した）を捕まえる。`);
  console.log(`      （記録）\`main.js:2299\` の車ドラッグは spawn を {x,y,theta} で置き換え downhill/grip/muDecay/surface を落とすが、`);
  console.log(`               spawn を読む唯一の経路 startAuto()（main.js:253）は直前に rebuildSpawns を呼ぶため **実害はない**（潜在の取り残し）。`);
  console.log(`      ※ 非対象は仕様。**理由は「タイヤ曲線を持たないから」ではない**（敵対的レビュー 重要2: physics_dyn.js:89-95,503-512 は`);
  console.log(`         簡易 Pacejka と摩擦楕円を持つ）。掘り込みは「**輪ごとの** μ·Fz に対する比」を v2 の結合スリップ σ 上で定義しており、`);
  console.log(`         単軌道近似の dynamic は輪ごとの μ·Fz を持たず（軸ごとの摩擦楕円半径）正規化も |α|/alphaPeak と別物＝**足す先が無い**。`);
  console.log(`         classic はさらに横自由度も無い。別モデルから導出せずに足せば「実体のない差の注入」になる。対照は上の A4'（v2 は動く）。`);
}
tA = lap();

// ══════════════════════════════════════════════════════════════════════════════════════
// [B] 掘り込みの法則
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[B] 掘り込みの法則（散逸性・摩擦円・σ 比例＋クランプ・ピーク移動・領域不変）`);
const tableB = [];
{
  const { C, Bp } = mfCoeffs(Tn.muDecay);
  const kP = Tn.kappaP, aP = Tn.alphaP, muFz = 12.0;
  const DIGS = FULL ? [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50] : [0, 0.10, 0.20, 0.30, 0.50];
  const SATS = FULL ? [1.5, 2, 3, 4, 6] : [2, 3, 4];

  // B1/B2: 散逸性と摩擦円を **dig×digSat×(κ,tanα) の全格子** で（AO2 T1/T2/T6a と同型の連続量マージン）。
  let worstPow = -Infinity, worstFc = -Infinity, cells = 0;
  let worstFcNoCap = -Infinity;   // 検出力: μ_eff から (1+dig) を落とした場合の破れ
  for (const dg of DIGS) for (const sat of SATS) {
    const dig = dg > 0 ? { dig: dg, digSat: sat } : null;
    const muEff = dg > 0 ? muFz * (1 + dg) : muFz;
    for (let ik = -40; ik <= 40; ik++) for (let ia = -40; ia <= 40; ia++) {
      const kappa = ik * 0.1, ta = ia * 0.1;
      const F = tireForceMF(kappa, ta, muFz, C, Bp, kP, aP, dig);
      const denom = 1.0;                                   // v_slip = (−κ·denom, ta·denom)
      const vslx = -kappa * denom, vsly = ta * denom;
      worstPow = Math.max(worstPow, F.fx * vslx + F.fy * vsly);
      const mag = Math.hypot(F.fx, F.fy);
      worstFc = Math.max(worstFc, mag - muEff);
      worstFcNoCap = Math.max(worstFcNoCap, (mag - muFz) / muFz);
      cells++;
    }
  }
  ok(worstPow <= 1e-9, `B1 散逸性 F·v_slip ≤ 0 を ${cells} 格子（dig×digSat 全組合せ）で（最悪 ${worstPow.toExponential(2)}）`);
  ok(worstFc <= 1e-9, `B2 摩擦円 |F| ≤ μ_eff·Fz を同格子で（最悪マージン ${worstFc.toExponential(2)}）`);
  ok(worstFcNoCap > 0.4, `B2' 検出力: μ_eff から (1+dig) を落とすと同じ述語が最大 ${(worstFcNoCap * 100).toFixed(1)}% 破れる（>40% を要求）`);
  console.log(`      ※ B1/B2 は **tireForceMF だけ**を見ており、本番のクランプ半径 muFzEff（physics_v2.js の _substep）は`);
  console.log(`         見ていない（ゲート側で μ_eff を再計算しているため）。実装側の半径は下の B2c/B2d が測る。`);

  // ── B2c/B2d: **実装の muFzEff** に検出力を与える（敵対的レビュー 致命2）────────────────
  // 【なぜ要るか】当初のゲートは μ_eff をゲート側で再計算しており、実装の `muFzEff`（physics_v2.js の
  //   _substep）を一度も読んでいなかった。実測: `muFz*(1+dig)` を `muFz*(1+2*dig)` に変えても **34/34 緑**、
  //   `latCap += muFzEff` を `+= muFz` に戻しても **34/34 緑**。しかも半径クランプ直後の
  //   `fcMarginApp = |F| − muFzEff` は **クランプ後 定義上 0** なので恒真（対照変異で定常側が 1.98e+1 まで
  //   破れているのに適用力側は緑のままだった）。∴ 実装の値を**外から読める診断量**で測る述語を足す。
  //   ・_latCapSS = Σ muFzEff,i·Fz_i … μ_eff を上下させれば必ず動く
  //   ・_muUse4  = |F_applied| / muFzEff … μ_eff が実力に対して過大なら下がる
  //
  // B2c: **直進 FREE 惰行**（タイヤ力ゼロ＝荷重が舗装とルーズで厳密に同一）で _latCapSS の比を測る。
  //   σ=0 ⇒ 力 0 ⇒ 状態が発散しないので、比は厳密に (1+dig) になる。
  {
    const mkStraight = (sf) => {
      const c = new CarV2({ ...buildFromSpec(sf ? { ...BENCH_LOW, surface: sf } : BENCH_LOW).start, x: 0, y: 0, theta: 0 });
      c.type = 'normal_fr'; c.driveDir = CONST.FREE; c.steer = CONST.CENTER;
      for (let i = 0; i < 120; i++) { c.u = 20; c.vlat = 0; c.r = 0; c.step(DT); }
      return c._latCapSS;
    };
    const capP = mkStraight(null), capL = mkStraight('loose');
    const ratio = capL / capP, want = 1 + LOOSE.dig;
    ok(Math.abs(ratio - want) < 1e-9,
       `B2c **実装の μ_eff を外から測る**: 直進惰行（タイヤ力 0＝荷重が同一）の _latCapSS 比 = ${ratio.toFixed(9)}（予測 1+dig = ${want.toFixed(9)}）`);
    console.log(`      ※ B2c は μ_eff を 2 倍にすると ${(2 * LOOSE.dig + 1).toFixed(2)}、latCap を muFz へ戻すと 1.00 になって赤くなる（当初はどちらも緑だった）。`);
  }
  // B2d: **半径クランプが実走で実際に binding する**（飾りのコードでないこと）。
  //  【初版の解釈は誤りだった】当初は「|F|/μ_eff の最大は 1 未満のはず（μ_eff は最小上界でない）」と
  //   書いたが、`_muUse4` は **適用力**（横力緩和長 LPF ＋半径クランプ後）を μ_eff で割った量なので、
  //   緩和の遅れで合力が一時的に上限を超えるとクランプが働き **定義上ちょうど 1.0** になる（実測 1.000000）。
  //   ∴ この量が測れるのは「クランプが効いているか」であって「μ_eff が最小上界か」ではない。
  //   μ_eff の大きさそのものは B2c が厳密に、定常力の余裕は B5' が測る。
  {
    const course = buildFromSpec({ ...BENCH_LOW, surface: 'loose' });
    let uMax = 0, bind = 0, n = 0;
    for (let bd = 4; bd <= 40; bd += 2) {
      const c = new CarV2({ ...course.start, x: 0, y: 0, theta: 0 });
      c.type = 'normal_fr'; c.driveDir = CONST.FREE; c.steer = CONST.CENTER;
      const U = 25, vlat = U * Math.tan(bd * rad);
      for (let i = 0; i < 200; i++) { c.u = U; c.vlat = vlat; c.r = 0; c.theta = 0; c.step(DT);
        const m = Math.max(...c._muUse4); uMax = Math.max(uMax, m); n++; if (m >= 1 - 1e-12) bind++; }
    }
    ok(uMax <= 1 + 1e-9 && bind > 0,
       `B2d 半径クランプはルーズ路面で実際に binding する（適用力の |F|/μ_eff 最大 = ${uMax.toFixed(6)} ≤ 1・${bind}/${n} tick でクランプが働いた）＝飾りのコードではない`);
  }

  // B3/B4: 「σ=2〜4 の横力/ピーク比」= |F(σ)| / (μ·Fz)（純横スリップ κ=0）。
  //   ・B3 dig の掃引で単調に上がる。
  //   ・B4 掘り込み寄与は σ<digSat で σ 比例・σ≥digSat でクランプ（残差 0 で照合）。
  const ratioAt = (sigma, dig) => {
    const ta = sigma * aP;
    const F = tireForceMF(0, ta, muFz, C, Bp, kP, aP, dig);
    return Math.hypot(F.fx, F.fy) / muFz;
  };
  const gAt = (sigma) => Math.sin(C * Math.atan(Bp * sigma));
  const SIGS = [2, 3, 4];
  let monoBad = 0, residBad = 0, worstResid = 0;
  const sat = LOOSE.digSat;
  for (const sg of SIGS) {
    let prev = -Infinity;
    for (const dg of DIGS) {
      const dig = dg > 0 ? { dig: dg, digSat: sat } : null;
      const r = ratioAt(sg, dig);
      if (r <= prev) monoBad++;
      prev = r;
      const want = gAt(sg) + dg * Math.min(sg / sat, 1);      // 期待する掘り込み寄与（σ 比例＋クランプ）
      const resid = Math.abs(r - want);
      worstResid = Math.max(worstResid, resid);
      if (resid > 1e-12) residBad++;
    }
  }
  ok(monoBad === 0,
     `B3 σ=2/3/4 の 横力/ピーク比 が dig 掃引（${DIGS.join('→')}）で **単調増加**（違反 ${monoBad}）`);
  ok(residBad === 0,
     `B4 掘り込み寄与 = dig·min(σ/digSat,1)（σ 比例＋上限クランプ）を残差 ${worstResid.toExponential(2)} で照合（違反 ${residBad}）`);
  // B4' 検出力: クランプを外すと大 σ でどれだけ伸びるか（＝クランプが効いていることの実測）。
  const sBig = 8;
  const clamped = ratioAt(sBig, { dig: LOOSE.dig, digSat: sat }) - gAt(sBig);
  const unclamped = LOOSE.dig * sBig / sat;
  ok(Math.abs(clamped - LOOSE.dig) < 1e-12 && unclamped / clamped > 2,
     `B4' 検出力: σ=${sBig} での掘り込み寄与は ${clamped.toFixed(6)}（=dig でクランプ済）。クランプを外すと ${unclamped.toFixed(6)}＝**${(unclamped / clamped).toFixed(2)} 倍**に伸びる`);

  // B4'': σ→0 の線形枝（`sigma < EPS`）にも掘り込みが入っているか＝曲線が原点で連続か。
  //   【敵対的レビュー 致命2 M6】この枝から dig を落としても当初は 34/34 緑だった。
  {
    const tiny = 1e-9 * aP, big = 1e-3 * aP;                 // EPS=1e-6 の両側（σ=1e-9 と 1e-3）
    const gLin = (dig) => Math.hypot(...(([F]) => [F.fx, F.fy])([tireForceMF(0, tiny, muFz, C, Bp, kP, aP, dig)])) / (tiny / aP);
    const gCurve = (dig) => Math.hypot(...(([F]) => [F.fx, F.fy])([tireForceMF(0, big, muFz, C, Bp, kP, aP, dig)])) / (big / aP);
    const wantP = muFz * C * Bp, wantL = muFz * (C * Bp + LOOSE.dig / LOOSE.digSat);
    const eP = Math.abs(gLin(null) - wantP) / wantP, eL = Math.abs(gLin(LOOSE) - wantL) / wantL;
    const contP = Math.abs(gLin(null) - gCurve(null)) / wantP, contL = Math.abs(gLin(LOOSE) - gCurve(LOOSE)) / wantL;
    ok(eP < 1e-12 && eL < 1e-12 && contP < 1e-4 && contL < 1e-4,
       `B4'' σ→0 の線形枝: 勾配は 舗装 muFz·C·Bp（誤差 ${eP.toExponential(1)}）／ルーズ muFz·(C·Bp + dig/digSat)（${eL.toExponential(1)}）で、EPS 境界を跨いで連続（${contP.toExponential(1)} / ${contL.toExponential(1)}）`);
  }

  // B5: ピークが深い滑り角へ移る（舗装 α≈8° → ルーズ）。argmax を実測で出す。
  const argmax = (dig) => { let best = -Infinity, bs = 0; for (let s = 0.02; s <= 10; s += 0.002) { const v = ratioAt(s, dig); if (v > best) { best = v; bs = s; } } return { s: bs, v: best }; };
  const pv = argmax(null), lo = argmax(LOOSE);
  const aPv = Math.atan(pv.s * aP) * deg, aLo = Math.atan(lo.s * aP) * deg;
  // B5': **定常タイヤ力**が到達する最大と μ_eff の関係（重要5: μ_eff は上界であって最小上界ではない）。
  //   B2d が測る適用力と違い、こちらは緩和もクランプも通さないタイヤ法則そのもの。
  {
    const head = lo.v / (1 + LOOSE.dig);
    ok(head >= 0.85 && head < 1,
       `B5' μ_eff は**上界であって最小上界ではない**: 定常力の到達最大は ${lo.v.toFixed(4)}·μFz ＝ μ_eff(${(1 + LOOSE.dig).toFixed(2)}·μFz) の ${(head * 100).toFixed(1)}%。` +
       `残り ${((1 - head) * 100).toFixed(1)}% は掘り込みが σ 比例で立ち上がるぶんの余裕（クランプ半径は安全側に広い）`);
  }
  ok(aLo > aPv + 8 && aLo >= 15 && aLo <= 35,
     `B5 **ピークが深い滑り角へ移る**: 舗装 σ=${pv.s.toFixed(2)}（α=${aPv.toFixed(1)}°）→ ルーズ σ=${lo.s.toFixed(2)}（α=${aLo.toFixed(1)}°）／実在のダート最適 20〜30° の帯に入る`);
  console.log(`      ピーク値: 舗装 ${pv.v.toFixed(4)}·μFz → ルーズ ${lo.v.toFixed(4)}·μFz（μ_eff 上限 ${(1 + LOOSE.dig).toFixed(2)} に対し ${(lo.v / (1 + LOOSE.dig) * 100).toFixed(1)}%）`);
  for (const sg of [1, 2, 3, 4, 6]) tableB.push({ sigma: sg, alphaDeg: +(Math.atan(sg * aP) * deg).toFixed(2), paved: +ratioAt(sg, null).toFixed(6), loose: +ratioAt(sg, LOOSE).toFixed(6) });
  console.log(`      σ:      ${tableB.map(r => String(r.sigma).padStart(8)).join('')}`);
  console.log(`      α[°]:   ${tableB.map(r => r.alphaDeg.toFixed(1).padStart(8)).join('')}`);
  console.log(`      舗装:   ${tableB.map(r => r.paved.toFixed(4).padStart(8)).join('')}`);
  console.log(`      ルーズ: ${tableB.map(r => r.loose.toFixed(4).padStart(8)).join('')}`);

  // B6: 領域不変（AS7 申し送り「新しい量を足したら崖を測る」）。
  //  【当初の述語は誤りだった・実測で判明】最初は「production car を σ=3 の純横滑りに固定して 3 領域で
  //   ay/latCap を測る」形にしていたが、これは掘り込み則ではなく **1 step 内の状態ドリフト** を測って
  //   いた。状態は step の外で毎 1/60 s に書き戻すだけで、内部の 8〜256 substep では自由に動く。
  //   Δv≈μ·g·dt は領域で不変でも、U は領域で 0.35→55 m/s と 157 倍違うので Δv/U が
  //   22%（卓上）〜0.25%（fullscale）と桁で変わる。∴ 領域差 4.86e-2 は掘り込みの崖ではなく
  //   **構造から予測できる強制誤差**（AS10 B3'' と同じ閉じ方）。下でその大きさを実測して印字する。
  //  ∴ B6 は「掘り込み則が領域スケールを持ち込んでいないか」を **実 tireForceMF に各領域の実タイヤ定数を
  //   渡して** 直接測る形にした。μ0 は卓上 0.8 / fullscale 1.4 と 1.75 倍違うので、もし dig を μ 比では
  //   なく絶対加速度で足していれば比は必ずばらける（B6' がその検出力を数字で出す）。
  const sigmaB6 = 3;
  const b6 = [];
  for (const rg of ['tabletop', 'midscale', 'fullscale']) {
    applyRegime(rg);
    const T = tireParamsFor('normal');
    const cb = mfCoeffs(0.92);                       // 低μベンチの course.muDecay
    const muFzR = T.mu0 * 0.6 * DYN.g;               // その領域の実 μ·Fz 相当（grip 0.6）
    const ta = sigmaB6 * T.alphaP;
    const Fp = tireForceMF(0, ta, muFzR, cb.C, cb.Bp, T.kappaP, T.alphaP);
    const Fl = tireForceMF(0, ta, muFzR, cb.C, cb.Bp, T.kappaP, T.alphaP, LOOSE);
    b6.push({ rg, mu0: T.mu0, muFz: muFzR,
              paved: Math.hypot(Fp.fx, Fp.fy) / muFzR, loose: Math.hypot(Fl.fx, Fl.fy) / muFzR });
  }
  applyRegime('fullscale');
  const b6spread = Math.max(...b6.map(x => x.loose)) - Math.min(...b6.map(x => x.loose));
  ok(b6spread < 1e-12,
     `B6 （構造的に真・回帰用）掘り込み則は無次元: σ=${sigmaB6} の |F|/μFz は ${b6.map(x => `${x.rg}(μ0=${x.mu0}) ${x.loose.toFixed(9)}`).join(' / ')}・振れ ${b6spread.toExponential(2)}`);
  console.log(`      ※ B6 は **崖の検査ではない**（敵対的レビュー 軽2）。tireForceMF は領域入力を持たず μ は比で相殺するので`);
  console.log(`         領域差は原理的に出ない＝恒真に近い。定数を絶対量へ変えたら赤になる回帰用（検出力は B6'）。**崖の検査は B6''**。`);
  // B6' 検出力: dig を「μ 比」ではなく「絶対加速度」で足す実装だと、μ0 が 1.75 倍違う領域間で必ずばらける。
  const absDig = LOOSE.dig * b6[2].muFz;             // fullscale の μFz を基準に絶対量化した変異体
  const b6abs = b6.map(x => x.paved + absDig / x.muFz);
  const absSpread = Math.max(...b6abs) - Math.min(...b6abs);
  ok(absSpread > 0.1,
     `B6' 検出力: dig を絶対加速度で足す実装だと同じ述語が ${b6abs.map(v => v.toFixed(4)).join(' / ')} とばらける（振れ ${absSpread.toFixed(4)} > 0.1）`);
  // B6'' 積分器の崖（AP13 siActive の両経路を通す）。卓上=半陰的・fullscale=陽的の**両方**で
  //   ルーズ路面を実走させ、摩擦円/散逸性/有限性が保たれることを見る（nSub が上限へ貼り付いて
  //   軌跡が発散する型の崖は crash・非有限として現れる）。
  const cliff = [];
  for (const rg of ['tabletop', 'midscale', 'fullscale']) {
    applyRegime(rg);
    const cs = buildFromSpec({ ...benches.find(b => b.name === 'bench-hairpin-R5-low'), surface: 'loose' });
    let wm = -Infinity, wp = -Infinity, bad = 0;
    for (const st of [CONST.LEFT, CONST.CENTER, CONST.RIGHT]) {
      const c = new CarV2({ ...cs.start, x: 0, y: 0, theta: 0 });
      c.type = 'normal_fr'; c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = st;
      for (let i = 0; i < 900; i++) { c.step(DT); wm = Math.max(wm, c._fcMargin); wp = Math.max(wp, c._slipPowerSS);
        if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.u)) bad++; }
    }
    cliff.push({ rg, wm, wp, bad, si: V2.siActive });
  }
  applyRegime('fullscale');
  ok(cliff.every(x => x.wm <= 1e-9 && x.wp <= 1e-9 && x.bad === 0),
     `B6'' 積分器の崖なし: ${cliff.map(x => `${x.rg}(半陰的=${x.si}) 摩擦円 ${x.wm.toExponential(1)}・散逸 ${x.wp.toExponential(1)}・非有限 ${x.bad}`).join(' / ')}`);
  // （記録）当初の述語が測っていた量と、その差の出所を数字で残す（沈黙截断の禁止）。
  const drift = [];
  for (const rg of ['tabletop', 'midscale', 'fullscale']) {
    applyRegime(rg);
    const T = tireParamsFor('normal');
    const U = Math.max(CAR.maxSpeed * 0.5, 0.3);
    drift.push({ rg, U, dv: T.mu0 * 0.6 * DYN.g * DT, frac: T.mu0 * 0.6 * DYN.g * DT / U });
  }
  applyRegime('fullscale');
  console.log(`      （記録）1 step 内の状態ドリフト Δv=μg·dt / U = ${drift.map(x => `${x.rg} ${(x.frac * 100).toFixed(2)}%`).join(' / ')}`);
  console.log(`               ＝ production car に状態を毎 step 書き戻す方式で領域比較すると、この比がそのまま誤差になる。`);

  // B7: **本番 trace** の摩擦円・散逸性（AO2 T2/T6a と同型。式でなく走っている車の診断量を読む）。
  const looseCourse = buildFromSpec({ ...benches.find(b => b.name === 'bench-hairpin-R5-low'), surface: 'loose' });
  const types = FULL ? CAR_TYPES.map(t => t.key) : ['normal_fr', 'normal_awd', 'drift_fr'];
  // 【是正・敵対的レビュー 軽7】当初は装備を 1 通りも掃引しておらず（tireSet='normal' 固定・wear/gear/susp/steer は既定）、
  //   とくに physics_v2.js の `doWear × REVERSE × CBpD` の経路はどのゲートも通っていなかった。
  //   装備の組合せを **ルーズ路面のまま**通す（掘り込みが他装備と干渉しないことの検査）。
  const EQUIP = FULL
    ? [{}, { tireSet: 'slip' }, { tireSet: 'rain' }, { wear: true }, { gearSet: 'short' }, { suspSet: 'soft' }, { steerSet: 'prop', steerAmt: 180 },
       { tireSet: 'slip', wear: true, gearSet: 'auto2', suspSet: 'stiff' }]
    : [{}, { tireSet: 'slip' }, { tireSet: 'rain', wear: true }, { gearSet: 'short', suspSet: 'soft' }, { wear: true, steerSet: 'prop', steerAmt: 180 }];
  let wSS = -Infinity, wApp = -Infinity, wPow = -Infinity, traces = 0, steps = 0, nonFinite = 0;
  for (const t of types) for (const d of [CONST.FORWARD, CONST.BRAKE, CONST.REVERSE, CONST.FREE]) for (const st of [CONST.LEFT, CONST.CENTER, CONST.RIGHT]) for (const eq of EQUIP) {
    const c = new CarV2({ ...looseCourse.start, x: 0, y: 0, theta: 0 });
    c.type = t; c.driveDir = d; c.pwm = 200; c.steer = st; Object.assign(c, eq); traces++;
    for (let i = 0; i < 300; i++) { c.step(DT); steps++; wSS = Math.max(wSS, c._fcMarginSS); wApp = Math.max(wApp, c._fcMargin); wPow = Math.max(wPow, c._slipPowerSS);
      if (!Number.isFinite(c.x) || !Number.isFinite(c.u) || !Number.isFinite(c.r)) nonFinite++; }
  }
  ok(wSS <= 1e-9 && nonFinite === 0,
     `B7 本番 trace（ルーズ路面 ${traces} trace × ${steps / traces} step・装備 ${EQUIP.length} 通り併用）の**定常 MF 力**の摩擦円 ${wSS.toExponential(2)} ≤ 0・非有限 ${nonFinite}`);
  ok(wPow <= 1e-9, `B7' 同 trace の**定常 MF 力**の接地スリップ仕事率 F·v_slip ≤ 0（最悪 ${wPow.toExponential(2)}）＝ルーズ路面でもタイヤ力は散逸的`);
  console.log(`      ※ 検査対象は **定常 MF 力**（_fcMarginSS / _slipPowerSS）。適用力（横力緩和長 LPF ＋半径クランプ後）の`);
  console.log(`         マージン _fcMargin はクランプ直後に**同じ半径で**測るので定義上 ≤0 の**恒真**（敵対的レビュー 致命2・実測 ${wApp.toExponential(1)}）。`);
  console.log(`         ∴ アサートから外した。実装の半径そのものは B2c/B2d が測る。適用力の散逸性は緩和長モデルの既知`);
  console.log(`         アーティファクト（カーカス撓みのエネルギー蓄積・AO_spec §2.3）で**舗装でも保証されない**＝AV1 の退行ではない。`);
}
tB = lap();

// ══════════════════════════════════════════════════════════════════════════════════════
// [C] 効果 — AO8 低μベンチを loose 化した自由空間 go/no-go
//   ドライバ・廊下プロキシ・clean 述語は **AU3 `wf_drift_reexam.mjs` Part1 と同型**（同じ土俵で比べる）。
//   ここで測るのは「舗装 vs ルーズ」であって「drift vs grip の勝敗」ではない。GO の有無は問わない
//   （PLAN の受け入れ:「表が出ること」）。見るのは ①比が下がるか ②深い滑りで clean 化する数。
// ══════════════════════════════════════════════════════════════════════════════════════
const maxVOf = (car) => CAR.maxSpeed * car.profile().maxSpeed;
const pwmFor = (car, U) => Math.max(0, Math.min(255, Math.round(U / maxVOf(car) * 255)));
function holdSpeed(car, U) {
  const e = U - car.u;
  if (e < -0.6) { car.driveDir = CONST.BRAKE; car.pwm = 0; }
  else { car.driveDir = CONST.FORWARD; car.pwm = pwmFor(car, U + 0.3); }
}
function tcPwm(car, full, maxSlip) {
  const s = (car.vwR - Math.abs(car.u)) / Math.max(Math.abs(car.u), 1);
  return s > maxSlip ? pwmFor(car, Math.abs(car.u)) : full;
}
function applySteer(car, prop, norm) {
  const n = Math.max(-1, Math.min(1, norm));
  if (prop) { car.steer = n >= 0 ? CONST.LEFT : CONST.RIGHT; car.steerAmt = Math.round(Math.abs(n) * 255); }
  else { car.steer = (car.steerAngle < n * CAR.maxSteer) ? CONST.LEFT : CONST.RIGHT; car.steerAmt = null; }
  return n;
}
function mkCar(course, type, prop) {
  const car = new CarV2({ ...course.start, x: 0, y: 0, theta: 0 });
  car.type = type; car.tireSet = 'normal'; car.steerSet = prop ? 'prop' : 'tri';
  return car;
}
function toSpeed(car, U) {
  car.steer = CONST.CENTER; car.steerAmt = null; car.driveDir = CONST.FORWARD; car.pwm = 255;
  for (let i = 0; i < 8000 && car.u < U; i++) car.step(DT);
  car.x = 0; car.y = 0; car.theta = 0;
}
const SPIN_LIM = 115, EXIT_M = 20, TMO = 1800, DEEP_MIN = 20;
let cRuns = 0, cReversed = 0;
function runCornerFree(course, R, W, type, strat, prm) {
  const prop = prm.prop, mx = CAR.maxSteer;
  const car = mkCar(course, type, prop);
  const vgrip = Math.sqrt(Tn.mu0 * (car.grip || 1) * DYN.g * R);
  const vEntry = prm.entry * vgrip;
  toSpeed(car, vEntry);
  const A = prm.ang * rad, lead = prm.lead || 0, Cx = lead, Cy = R;
  const Px = lead + R * Math.sin(A), Py = R - R * Math.cos(A);
  const ex = Math.cos(A), ey = Math.sin(A), nx = -Math.sin(A), ny = Math.cos(A);
  const lim = W / 2 - HALF_W_CAR;
  let head = 0, prevTh = car.theta, betaPk = 0, spun = false, reversed = false, viol = 0, t = 0, done = false;
  let phase = 'init', prevSl = -beta(car), initTicks = 0;
  let brake = (strat === 'drift' && /_fr$/.test(type)) ? prm.brakeTicks : 0;
  let gSteer = CONST.CENTER, exitU = null, exitBeta = null, exitHead = null, gated = false;
  cRuns++;
  for (let i = 0; i < TMO; i++) {
    const cgx = car.x, cgy = car.y;
    let prog = (cgx - Px) * ex + (cgy - Py) * ey;
    if (!gated) { if (head >= 0.75 * A && prog >= 0) gated = true; else prog = -1; }
    const lat = (cgx - Px) * nx + (cgy - Py) * ny;
    if (prog < 0) { const dev = (cgx < Cx) ? Math.abs(cgy) : Math.abs(Math.hypot(cgx - Cx, cgy - Cy) - R); if (dev > lim) viol = Math.max(viol, dev - lim); }
    else if (Math.abs(lat) > lim) viol = Math.max(viol, Math.abs(lat) - lim);
    if (prog >= EXIT_M) { done = true; exitU = car.u; exitBeta = beta(car); exitHead = wrap(car.theta - A) * deg; break; }
    const sl = -beta(car), sld = (sl - prevSl) / DT; prevSl = sl;
    const remaining = A - head;
    if (strat === 'grip') {
      if (prog >= 0) { const herr = wrap(A - car.theta); applySteer(car, prop, prm.kpG * 4 * herr / mx); car.driveDir = CONST.FORWARD; car.pwm = tcPwm(car, 255, 0.15); }
      else if (prop) { const want = CAR.wheelBase / R + prm.kpG * (car.u / R - car.r); applySteer(car, true, want / mx); holdSpeed(car, vEntry); }
      else { const rStar = car.u / R; if (car.r < rStar * 0.98) gSteer = CONST.LEFT; else if (car.r > rStar * 1.02) gSteer = CONST.CENTER; car.steer = gSteer; car.steerAmt = null; holdSpeed(car, vEntry); }
    } else {
      const bt = prm.beta;
      if (prog >= 0) phase = 'exit';
      else if (phase !== 'exit' && phase !== 'catch' && remaining < Math.max(Math.abs(car.r), 0.5) * prm.tLead) phase = 'catch';
      else if (phase === 'init' && (sl >= bt - 5 || initTicks > 90)) phase = 'hold';
      if (phase === 'init') {
        initTicks++;
        if (brake > 0) { car.steer = CONST.LEFT; car.steerAmt = null; car.driveDir = CONST.BRAKE; car.pwm = 0; brake--; }
        else { applySteer(car, prop, 1); car.driveDir = CONST.FORWARD; car.pwm = tcPwm(car, 255, 0.8); }
      } else if (phase === 'hold') {
        const want = (prm.kp * (bt - sl) - prm.kd * sld) * mx; applySteer(car, prop, want / mx);
        car.driveDir = CONST.FORWARD; car.pwm = (sl > bt + 4) ? prm.pHold : tcPwm(car, 255, 0.6);
      } else if (phase === 'catch') {
        const btc = Math.max(0, Math.min(bt, prm.catchGain * remaining));
        const want = (prm.kp * (btc - sl) - prm.kd * sld) * mx; applySteer(car, prop, want / mx);
        car.driveDir = CONST.FORWARD; car.pwm = (sl > btc + 4) ? prm.pCatch : tcPwm(car, 200, 0.3);
      } else {
        const herr = wrap(A - car.theta) * deg;
        const want = (prm.kp * (0 - sl) - prm.kd * sld + 0.02 * herr) * mx; applySteer(car, prop, want / mx);
        car.driveDir = CONST.FORWARD; car.pwm = (Math.abs(sl) > 8) ? prm.pCatch : tcPwm(car, 255, 0.15);
      }
    }
    car.step(DT); t += DT;
    head += wrap(car.theta - prevTh); prevTh = car.theta;
    const ab = Math.abs(beta(car)); if (ab > betaPk) betaPk = ab;
    if (ab > SPIN_LIM || car.u < -0.5) { if (car.u < -0.5) { reversed = true; cReversed++; } spun = true; break; }
  }
  const clean = done && !spun && viol === 0 && Math.abs(exitBeta) <= 10 && Math.abs(exitHead) <= 10 && exitU >= 0.5 * vgrip;
  return { t: done ? t : null, clean, spun, reversed, viol, betaPk, exitU, exitBeta, exitHead, vgrip, vEntry, done };
}
function gridGripFree(ang) {
  const entries = FULL ? [0.75, 0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1] : [0.75, 0.85, 0.95, 1.05, 1.1];
  const kpGs = FULL ? [0.2, 0.45, 0.8] : [0.45];
  const leads = FULL ? [0, 2, 4, 6] : [0, 4];
  const out = [];
  for (const prop of [false, true]) for (const entry of entries) for (const kpG of kpGs) for (const lead of leads) out.push({ prop, entry, ang, kpG, lead });
  return out;
}
function gridDriftFree(ang, type) {
  const entries = FULL ? [0.85, 1.0, 1.15, 1.3] : [0.85, 1.0, 1.15];
  // 【AV1 の是正】AU3 の縮小格子は {15,35} だが、これは **舗装向けに調整された格子** で
  //   ルーズ路面の最適滑り角（B5 実測 σ=3 ⇒ α=22.8°）の近傍に標本が無い。舗装とルーズを
  //   この格子で比べると構造的にルーズが不利になる（比較の土俵が傾く）ので、25 を
  //   **舗装・ルーズの両方に等しく**足す。片側だけ強く探索しない（AU3 の予算則を踏襲）。
  const bts = FULL ? [15, 25, 35, 45] : [15, 25, 35];
  const tLeads = [0.5, 1.0];
  const pCatches = FULL ? [30, 110, 200] : [30, 110];
  const leads = [0, 4];
  const brakes = /_fr$/.test(type) ? (FULL ? [4, 9, 25] : [4, 25]) : (FULL ? [0, 6, 12] : [0, 12]);
  const out = [];
  for (const prop of [false, true]) for (const entry of entries) for (const b of bts) for (const tLead of tLeads)
    for (const pCatch of pCatches) for (const lead of leads) for (const brakeTicks of brakes)
      out.push({ prop, entry, ang, beta: b, tLead, pCatch, brakeTicks, lead, kp: 0.06, kd: 0.002, pHold: 110, catchGain: 60 });
  return out;
}
// 掃引。**深い滑り（βpk≥DEEP_MIN）で clean な run の数**も数える（連続量の記録＝PLAN の受け入れ）。
function sweepFree(course, R, W, type, ang, strat) {
  const grid = strat === 'grip' ? gridGripFree(ang) : gridDriftFree(ang, type);
  let best = null, cleanN = 0, deepClean = 0, bpkMax = 0, bpkCleanMax = 0;
  for (const prm of grid) {
    const r = runCornerFree(course, R, W, type, strat, prm);
    if (r.clean) { cleanN++; if (r.betaPk >= DEEP_MIN) deepClean++; bpkCleanMax = Math.max(bpkCleanMax, r.betaPk); if (!best || r.t < best.t) best = { ...prm, ...r }; }
    bpkMax = Math.max(bpkMax, r.betaPk);   // ※ 全 run。u→0 のスピンで β=atan2(vlat,|u|)→90° を拾うので **深さの指標ではない**
  }
  let robust = null;
  if (best && strat === 'drift') robust = 1 + [0.9, 1.1].map(m => runCornerFree(course, R, W, type, 'drift', { ...best, entry: best.entry * m })).filter(r => r.clean).length;
  return { best, cleanN, deepClean, bpkMax, bpkCleanMax, n: grid.length, robust };
}

// 縮小でも 3 コーナー使う: 比が両方の路面で出る対（＝比較の母数）が足りないと c1 が測定不能になる
// （実測: 2 コーナーでは 4 対中 1 対しか比が出なかった）。
const C_CORNERS = [['hairpin-R5', 5, 6], ['hairpin-R6.5', 6.5, 6], ['hairpin-R8', 8, 7]];
// 【是正・実測にもとづく】当初は縮小で types={normal_fr,normal_awd} × ang={180} にしていたが、
//   **awd は 6 セルすべてで drift の clean 解を持たず**、比が両方の路面で出る対が 1 つしか作れなかった
//   （c1/c3 が母数不足で測定不能）。AU3 の縮小掃引と同じ形（types={normal_fr} × ang={90,180}）へ
//   直す。セル数は同じ 12 でランタイムも変わらないが、90° は drift の clean 解が出やすいので
//   比較の母数が増える。awd の対照は --full に残す。
const C_TYPES = FULL ? ['normal_fr', 'normal_awd', 'drift_fr'] : ['normal_fr'];
const C_ANGS = [90, 180];
const tableC = [];
console.log(`\n[C] 効果: AO8 低μベンチ（grip 0.6 / muDecay 0.92）を loose 化した自由空間 go/no-go。ratio=drift/grip・deep=βpk≥${DEEP_MIN}° で clean な run 数`);
console.log(`corner       路面   ang car        | grip t  cln | drift t  cln deep βpk βpkC | ratio robust`);
for (const [ck, R, W] of C_CORNERS) {
  const specLow = benches.find(b => b.name === `bench-${ck}-low`);
  for (const surf of ['paved', 'loose']) {
    const course = buildFromSpec(surf === 'paved' ? specLow : { ...specLow, surface: 'loose' });
    for (const ang of C_ANGS) for (const type of C_TYPES) {
      const g = sweepFree(course, R, W, type, ang, 'grip'), d = sweepFree(course, R, W, type, ang, 'drift');
      const gb = g.best, db = d.best;
      const ratio = (gb && db) ? db.t / gb.t : null;
      const f = (v) => v == null ? '  DNF' : v.toFixed(2).padStart(5);
      console.log(`${ck.padEnd(12)} ${surf.padEnd(6)} ${String(ang).padStart(3)} ${type.padEnd(10)} | ${f(gb && gb.t)} ${String(g.cleanN).padStart(4)} | ${f(db && db.t)} ${String(d.cleanN).padStart(4)} ${String(d.deepClean).padStart(4)} ${db ? String(Math.round(db.betaPk)).padStart(3) : '  -'} ${String(Math.round(d.bpkCleanMax)).padStart(4)} | ${ratio != null ? ratio.toFixed(3) : '  -  '} ${d.robust != null ? d.robust + '/3' : ' - '}`);
      tableC.push({ corner: ck, surface: surf, ang, type,
        grip_t: gb ? +gb.t.toFixed(4) : null, grip_cleanN: g.cleanN, grip_n: g.n, grip_deepClean: g.deepClean, grip_bpkMax: +g.bpkMax.toFixed(2),
        drift_t: db ? +db.t.toFixed(4) : null, drift_cleanN: d.cleanN, drift_n: d.n, drift_deepClean: d.deepClean,
        drift_bpk: db ? +db.betaPk.toFixed(2) : null, drift_bpkMax: +d.bpkMax.toFixed(2), drift_bpkCleanMax: +d.bpkCleanMax.toFixed(2), robust: d.robust,
        ratio: ratio != null ? +ratio.toFixed(4) : null });
    }
  }
}
tC = lap();
{
  const key = (r) => `${r.corner}/${r.ang}/${r.type}`;
  const pv = new Map(tableC.filter(r => r.surface === 'paved').map(r => [key(r), r]));
  const lo = new Map(tableC.filter(r => r.surface === 'loose').map(r => [key(r), r]));
  const pairs = [...pv.keys()].filter(k => lo.has(k)).map(k => ({ k, p: pv.get(k), l: lo.get(k) }));
  const withRatio = pairs.filter(x => x.p.ratio != null && x.l.ratio != null);
  const minP = withRatio.length ? Math.min(...withRatio.map(x => x.p.ratio)) : null;
  const minL = withRatio.length ? Math.min(...withRatio.map(x => x.l.ratio)) : null;
  const down = withRatio.filter(x => x.l.ratio < x.p.ratio);
  const cellP = pairs.filter(x => x.p.drift_t != null).length;   // drift が clean 解を持つセル数
  const cellL = pairs.filter(x => x.l.drift_t != null).length;
  const gainedCells = pairs.filter(x => x.p.drift_t == null && x.l.drift_t != null);
  const lostCells = pairs.filter(x => x.p.drift_t != null && x.l.drift_t == null);
  const deepP = pairs.reduce((a, x) => a + x.p.drift_deepClean, 0);
  const deepL = pairs.reduce((a, x) => a + x.l.drift_deepClean, 0);
  const cleanP = pairs.reduce((a, x) => a + x.p.drift_cleanN, 0);
  const cleanL = pairs.reduce((a, x) => a + x.l.drift_cleanN, 0);
  console.log(`\n[アサート]`);
  console.log(`  C: 対になったセル ${pairs.length}（比が両方出た ${withRatio.length}）／drift clean 合計 舗装 ${cleanP} → ルーズ ${cleanL}`);
  console.log(`     比の最小 舗装 ${minP != null ? minP.toFixed(3) : '--'} → ルーズ ${minL != null ? minL.toFixed(3) : '--'}／比が下がったセル ${down.length}/${withRatio.length}`);
  console.log(`     深い滑り（βpk≥${DEEP_MIN}°）で clean な run 数 合計: 舗装 ${deepP} → ルーズ ${deepL}`);
  console.log(`     drift が clean 解を持つセル数: 舗装 ${cellP}/${pairs.length} → ルーズ ${cellL}/${pairs.length}` +
              `（ルーズで成立 ${gainedCells.map(x => x.k).join(',') || 'なし'}／ルーズで不成立 ${lostCells.map(x => x.k).join(',') || 'なし'}）`);
  const bpkP = Math.max(...pairs.map(x => x.p.drift_bpkCleanMax));
  const bpkL = Math.max(...pairs.map(x => x.l.drift_bpkCleanMax));
  const deepCellsP = pairs.filter(x => x.p.drift_deepClean > 0).map(x => x.k);
  const deepCellsL = pairs.filter(x => x.l.drift_deepClean > 0).map(x => x.k);
  console.log(`     深い clean 解のセル別内訳（舗装→ルーズ）: ${pairs.map(x => `${x.k} ${x.p.drift_deepClean}→${x.l.drift_deepClean}`).join(' / ')}`);
  console.log(`     clean な run に限った βpk 最大: 舗装 ${bpkP.toFixed(0)}° → ルーズ ${bpkL.toFixed(0)}°`);
  console.log(`     ※ 表の βpkC は **clean 限定**。全 run の最大は u→0 のスピンで β=atan2(vlat,|u|)→90° を拾うため深さの指標にならない。`);
  // 【撤回・敵対的レビュー 致命1／独立再確認済】当初は「drift/grip 比がルーズで下がる」を **方向つきで
  //   assert** していたが、これは **β 掃引格子の産物**だった。同じ実装・同じコースで格子だけを変えると反転する
  //   （他は無改変・各 1 回実行）:
  //       [15,25,35]（当初の提出版）        : 0.8764 → 0.8754  下がったセル 3/4  → 緑
  //       [15,35]（AU3 の原格子）           : 0.8764 → 0.8782  下がったセル 2/4  → **赤**
  //       [15,20,25,30,35]（細分＝より厳密） : 0.8626 → 0.8669  下がったセル 2/4  → **赤**
  //   粗くしても細かくしても赤で、3 点格子だけが緑＝**物理でなく格子選択が結論を決めている**。
  //   ∴ 方向の主張は撤回し、**測定が成立していること**だけを assert して値は記録に落とす。
  //   PLAN の予想①「比が舗装より下がる」は **未確立**（CI-7: 基準を緩めたのではなく、その基準が
  //   測っていたのが格子依存の代理量だったことを実測で示し、記録した）。
  ok(withRatio.length >= 2,
     `AV1-c1 （記録・方向の主張は撤回）drift/grip 比: 最小 ${minP != null ? minP.toFixed(4) : '--'} → ${minL != null ? minL.toFixed(4) : '--'}・下がったセル ${down.length}/${withRatio.length}。` +
     `**この符号は β 掃引格子に依存し [15,35] と [15,20,25,30,35] では逆転する**（実測）⇒ PLAN の予想①は未確立`);
  // c2 —— PLAN が予想した「深い β が clean 化する」は **実測で反証された**。述語は AU3 の C-1 と同じ
  //   作法で「予想の真偽を主張する」形から「**何が起きたかを測って固定する**」形へ置き換える。
  //   要求するのは (i) 測定が空振りでないこと (ii) 反証の中身（深い滑りが *減った* こと）が
  //   意図せず変わったら赤になること。方向を後から都合よく反転させないため、下限ではなく
  //   **舗装側が非ゼロであること**と**ルーズ側が舗装側を下回ること**を明示的に固定する。
  // 【PLAN の予想と実測が食い違った・符号はコーナー半径で反転する】単純な合計の増減を assert すると
  //   掃引の混ぜ物になるので、**両側で測定が生きていること**を固定し、内訳と反転はログで出す。
  //   （方向を後から都合よく決め直さないため、合計の符号は下の console 出力で正直に示す。）
  // 【是正・敵対的レビュー 重要1／自分のデータが反例だった】当初は「R_min を境に符号が反転する」と **因果を
  //   書いて**いたが、R_min=5.84m に対し **R6.5 は「半径に余裕がある」側なのに舗装の深い解が 5→0 と消える**
  //   （このゲート自身の出力）。両端（最タイト R5 と最大 R8）だけを選んで書き、真ん中の反例を黙って落としていた。
  //   さらに β 格子を細分すると舗装 R8/90 にも深い解が出るので「舗装に無かった」も偽になる。
  //   ∴ **因果の説明は撤回**し、生の内訳と「特定できていない」ことだけを残す。
  ok(deepP > 0 && deepL > 0 && deepCellsP.length > 0 && deepCellsL.length > 0,
     `AV1-c2 深い滑り（βpk≥${DEEP_MIN}°）の clean 解は **舗装・ルーズの双方に存在する**（run 合計 ${deepP} / ${deepL}・` +
     `セル 舗装 [${deepCellsP.join(',')}] → ルーズ [${deepCellsL.join(',')}]）。**PLAN の予想②「増える」は合計では成り立たない**` +
     `（${deepP}→${deepL}）。**セル別の増減の機序は特定できていない**（R_min=${R_MIN.toFixed(2)}m は判別境界ではない — ` +
     `R6.5 は R_min より大きいのに舗装の深い解が消える。掃引セルが ${pairs.length} と少なく β 格子にも依存する）。clean 限定の βpk 最大 ${bpkP.toFixed(0)}° → ${bpkL.toFixed(0)}°`);
  ok(cleanL > cleanP && cellL >= cellP,
     `AV1-c2' **掘り込みで drift の成立域そのものは広がる**（測定された効果）: drift の clean run 合計 ${cleanP} → ${cleanL}` +
     `（×${(cleanL / Math.max(cleanP, 1)).toFixed(2)}）・clean 解を持つセル ${cellP}/${pairs.length} → ${cellL}/${pairs.length}` +
     `（ルーズで新たに成立 ${gainedCells.map(x => x.k).join(',') || 'なし'}）`);
  ok(cleanP > 0 && cleanL > 0 && withRatio.length >= 2,
     `AV1-c3 非空振り: 舗装/ルーズとも drift の clean 解を持つ（${cleanP} / ${cleanL} 件）・比が両方出た対 ${withRatio.length}（≥2 を要求）`);
  ok(cReversed > 0,
     `AV1-c4 後退ガードの検出力: ${cRuns} run 中 ${cReversed} run が u<−0.5 で打ち切られた ⇒ 打ち切りは空振りしていない`);
  // 決定論（同一パラメータ 2 回 bit 一致）。
  const [ck0, R0, W0] = C_CORNERS[0];
  const cs = buildFromSpec({ ...benches.find(b => b.name === `bench-${ck0}-low`), surface: 'loose' });
  const dprm = { prop: false, entry: 1.0, ang: 180, beta: 25, tLead: 1.0, pCatch: 30, brakeTicks: 9, lead: 0, kp: 0.06, kd: 0.002, pHold: 110, catchGain: 60 };
  const a1 = runCornerFree(cs, R0, W0, 'normal_fr', 'drift', dprm), a2 = runCornerFree(cs, R0, W0, 'normal_fr', 'drift', dprm);
  ok(Object.is(a1.t, a2.t) && a1.clean === a2.clean && Object.is(a1.betaPk, a2.betaPk),
     `AV1-c5 決定論（ルーズ路面 同一パラメータ 2 回 bit 一致 t=${a1.t == null ? 'DNF' : a1.t.toFixed(6)} βpk=${a1.betaPk.toFixed(6)}）`);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// [D] validate_courses のフィールド検査 ＋ [E] 記録
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[D] validate_courses のフィールド検査`);
{
  ok(checkFields(shipped).length === 0, `AV1-d1 出荷 ${shipped.length} コースはフィールドエラー 0 件`);
  const bad = [
    { name: 'x1', surface: 'gravel' },        // 未知の路面種別
    { name: 'x2', surface: 3 },               // 非文字列
    { name: 'x3', surface: null },            // null（undefined ではないので検査対象）
    { name: 'x4', surface: 'Loose' },         // 大文字違い＝未知
  ];
  const errs = checkFields(bad);
  ok(errs.length === 4, `AV1-d2 検出力: 未知値/非文字列/null/大小文字違い の 4 件をすべて検出（${errs.length} 件）`);
  for (const e of errs) console.log(`      検出: ${e}`);
  const good = [{ name: 'g1' }, { name: 'g2', surface: 'paved' }, { name: 'g3', surface: 'loose' },
                { name: 'g4', surface: 'loose', kind: 'raw' }, { name: 'g5', surface: 'loose', kind: 'touge' }];
  ok(checkFields(good).length === 0,
     `AV1-d3 正常値は 0 件（未指定/paved/loose・**kind を選ばない**＝bank と違い中心線を要さない）`);
  const keys = Object.keys(SURFACES);
  ok(keys.every((k) => checkFields([{ name: 'k', surface: k }]).length === 0) && keys.length >= 2,
     `AV1-d4 単一真実源: 検査は config.js の SURFACES をそのまま使う＝**全キー ${keys.join('/')} が検査を通る**（キー追加で検査側が取り残されない）`);
  // 【追加・敵対的レビュー 軽6】値域そのものを検査する（digSat<=0 は kD=Infinity で沈黙故障・dig<0 は
  //   散逸性の証明 F_ss≥0 が崩れる）。`surfaceParamsFor` が壊れた定義を null へ縮退させることも確かめる。
  const badS = keys.filter((k) => { const v = SURFACES[k]; return v && !(Number.isFinite(v.dig) && v.dig > 0 && Number.isFinite(v.digSat) && v.digSat > 0); });
  ok(badS.length === 0 && surfaceParamsFor('paved') === null
     && surfaceParamsFor.call(null, 'loose') !== null
     && keys.every((k) => (SURFACES[k] == null) === (surfaceParamsFor(k) === null)),
     `AV1-d5 SURFACES の値域: 全 ${keys.length} キーが dig>0 ∧ digSat>0 ∧ 有限（不正 ${badS.length} 件）。壊れた定義は surfaceParamsFor が null へ縮退させる`);
}
console.log(`\n[E] 記録（既存の穴・是正はしない）`);
{
  const specLow = benches.find(b => b.name === 'bench-hairpin-R5-low');
  const h0 = courseHashOf(buildFromSpec(specLow));
  const h1 = courseHashOf(buildFromSpec({ ...specLow, surface: 'loose' }));
  ok(h0 === h1,
     `AV1-e1 （記録・反転アサート）courseHashOf は surface を含まない（${h0} = ${h1}）＝grip/muDecay/bank と同じ **AP2 以来の既存の穴**。` +
     `**この行が赤になったら穴が塞がれた合図**（退行ではない）＝本アサートを削除し練習ベスト記録の移行を検討すること。` +
     `自作コースの surface だけを後から変えると練習ベスト記録の条件ハッシュが変わらないまま物理が変わる。` +
     `AS10 §4(f) の裁定（記録のみ・新規ブロック未起票・人間裁定待ち）を踏襲し、本ブロックでは直さない`);
}
tD = lap();

console.log(`\n  所要: A ${tA.toFixed(1)}s ／ B ${tB.toFixed(1)}s ／ C ${tC.toFixed(1)}s ／ D+E ${tD.toFixed(1)}s`);
if (WANT_JSON) {
  console.log('===JSON===');
  console.log(JSON.stringify({ appVersion: APP_VERSION, gate: 'AV1-loose', sweep: FULL ? 'full' : 'reduced',
    surfaces: SURFACES, cRuns, cReversed, curve: tableB, effect: tableC }, null, 0));
}
console.log(`\n[結果] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
