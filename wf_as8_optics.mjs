// AS8 常設アサーションゲート: 実機 ToF の光学モデル (opt-in・決定論) を機械で守る。
// 本番フローのみ (readAll / buildFromSpec / runRace / makeSlot+tickSlot+integrateSlot) を使い、
// 判定述語を検査側へ写し取らない (CI-8/CI-9)。exit 非0 = 失敗。
//
// 背景 (一次情報・決定ログ AS-8 / docs/stage_as/AS8_tof.md §1): 実機 VL53L0X は「標的から返る信号
//   レートがしきい値以上のときだけ有効な測距を報告する」(上流 RumiCar.cpp:74-86 の setSignalRateLimit・
//   既定 0.25 MCPS / Pololu ライブラリと製品ページの記述)。信号は Lambertian 拡張標的に対し
//   S ∝ ρ·cosθ/d² なので、**有効レンジは d_max ∝ √(ρ·cosθ)**、また扇の一部しか標的が埋めなければ
//   平均信号が下がる (=「標的のサイズ」依存)。本ゲートはこの**法則そのもの**を比で検査する
//   (比を取れば比例定数が消えるので、実装の内部式を写し取らずに済む)。
//
// 章立て: A 光学モデルの厳密性 / B 反射率・材質 / C 既定 OFF と公式レース非干渉 /
//         D 領域スケール不変 (無次元性・AS7 申し送り) / E 教材差分の母集団実測
import { SENSOR_OPTICS, SENSOR_RANGE, SENSOR_NOISE, SENSORS, SIM, REGIMES } from './public/js/config.js';
import { applyRegime } from './public/js/physics_dyn.js';
import { readAll } from './public/js/sensors.js';
import { carEdges } from './public/js/physics.js';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { makeSlot, rebuildSpawns, tickSlot, integrateSlot, othersFor, swapPhysics } from './public/js/fleet.js';
import { buildController } from './public/js/runner.js';
import { PROGRAMS } from './public/js/programs.js';
import specs from './public/data/courses.json' with { type: 'json' };

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };

// 既定値を退避して章ごとに復元する (このゲートが live 大域を汚さない)。
const DEF = { ...SENSOR_OPTICS };
const resetOptics = () => { for (const k of Object.keys(DEF)) SENSOR_OPTICS[k] = DEF[k]; };

// ---- 共通ヘルパ -------------------------------------------------------------
// 中央センサーだけを使う合成シーン。距離 d[m]・傾き tilt[rad] の平面標的を1枚置く。
// 壁は扇 (25°) を確実に覆う長さにする (半幅 = d·tan(12.5°) の 8 倍)。
// isCar=true のときは extra (他車エッジ) として渡す = 実装の反射率分岐 (壁/他車) を本番経路で踏む。
function planeScene(d, tilt = 0, isCar = false) {
  const car = { x: 0, y: 0, theta: 0 };
  const ox = SENSORS[1].dx;                            // CENTER の前方オフセット (領域スケールで動くので実値を読む)
  const cx = ox + d, cy = 0;
  const half = Math.max(0.5, d * Math.tan(12.5 * Math.PI / 180) * 8);
  // 標的の面法線を視線から tilt だけ倒す = 線分方向を (90°+tilt) へ回す。
  const a = Math.PI / 2 + tilt;
  const seg = { x1: cx - half * Math.cos(a), y1: cy - half * Math.sin(a), x2: cx + half * Math.cos(a), y2: cy + half * Math.sin(a) };
  return { car, walls: isCar ? [] : [seg], extra: isCar ? [seg] : [] };
}
const readCenter = (sc) => readAll(sc.car, sc.walls, sc.extra)[1].mm;

// 有効測距の境界 (これを超えると -3 になる距離 [m]) を二分探索で実測する。
function edgeDistance(tilt = 0, isCar = false, lo = null, hi = null) {
  const maxM = SENSOR_RANGE.maxMm / 1000;
  lo = lo == null ? maxM * 0.02 : lo;                  // 探索下限もレンジ比で置く (領域に依らず同じ相対位置)
  hi = hi == null ? maxM * 0.999 : hi;
  if (readCenter(planeScene(lo, tilt, isCar)) < 0) return null;   // 近距離ですら無効 = 探索不能
  if (readCenter(planeScene(hi, tilt, isCar)) >= 0) return hi;    // レンジ端まで有効 (飽和)
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (readCenter(planeScene(mid, tilt, isCar)) >= 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ===== A: 光学モデルの厳密性 =================================================
console.log('\n=== A: 光学モデルの厳密性 (同一姿勢・本番 readAll) ===');
{
  // A1/A2: 「中立」設定 (壁の反射率=基準・入射角なし・混合なし・クロストークなし) では、
  //   ON は「最強信号=最も近いビン」を返すので、連続極限 (rays→∞) で OFF (解析的な扇内最近) と一致する。
  //   ただし**扇の一部しか標的が埋めない姿勢は、rays をいくら増やしても ON が無効 (-3) になる**
  //   (=標的サイズ効果=モデルの実体であって離散化ではない)。両者を分けて測る。
  resetOptics();
  SENSOR_OPTICS.wallRefl = 1.0; SENSOR_OPTICS.incidence = false; SENSOR_OPTICS.multipath = false; SENSOR_OPTICS.xtalk = 0;
  const poses = []; for (let i = 0; i < 360; i += 15) poses.push(i * Math.PI / 180);
  const built = specs.map((s) => { try { return buildFromSpec(s); } catch (e) { return null; } }).filter(Boolean);
  const scan = (rays) => {
    SENSOR_OPTICS.rays = rays;
    let n = 0, diff = 0, maxAbs = 0, sized = 0;
    for (const course of built) for (const th of poses) {
      const car = { x: course.start.x, y: course.start.y, theta: th };
      SENSOR_OPTICS.on = false; const a = readAll(car, course.walls, []).map((s) => s.mm);
      SENSOR_OPTICS.on = true; const b = readAll(car, course.walls, []).map((s) => s.mm);
      for (let k = 0; k < 3; k++) {
        n++;
        if (a[k] >= 0 && b[k] < 0) { sized++; continue; }
        if (a[k] < 0 || b[k] < 0) continue;
        const d = Math.abs(b[k] - a[k]);
        if (d > 0) { diff++; if (d > maxAbs) maxAbs = d; }
      }
    }
    SENSOR_OPTICS.on = false;
    return { n, diff, maxAbs, sized };
  };
  const RAYS = [9, 33, 129, 513];
  const r = RAYS.map(scan);
  RAYS.forEach((rays, i) => console.log(`    rays=${String(rays).padStart(3)}: 読み ${r[i].n}・両方有効で不一致 ${r[i].diff} (最大 ${r[i].maxAbs}mm)・OFF有効→ON無効 ${r[i].sized}`));
  // A1 連続極限で一致する = 中立の ON は「扇内最近」に収束する。
  ok(r[RAYS.length - 1].maxAbs <= 1,
    `A1 中立設定は連続極限 (rays=${RAYS[RAYS.length - 1]}) で OFF と一致: 最大差 ${r[RAYS.length - 1].maxAbs}mm ≤ 1mm`);
  // A2 単調収束 (離散化であることの実証)。
  let mono = true;
  for (let i = 1; i < RAYS.length; i++) if (r[i].diff > r[i - 1].diff || r[i].maxAbs > r[i - 1].maxAbs) mono = false;
  ok(mono, `A2 rays を増やすと不一致件数・最大差がともに単調減少 (${r.map((x) => `${x.diff}/${x.maxAbs}mm`).join(' → ')})`);
  // A3 既定 rays の離散化誤差が実機ノイズ σ を下回る (config の既定値選定の根拠を常設監視)。
  const iDef = RAYS.indexOf(DEF.rays);
  ok(iDef >= 0 && r[iDef].maxAbs < SENSOR_NOISE.sigmaBaseMm,
    `A3 既定 rays=${DEF.rays} の離散化誤差 ${iDef >= 0 ? r[iDef].maxAbs : '?'}mm < 実機ノイズ σ ${SENSOR_NOISE.sigmaBaseMm}mm`);
  // A4 標的サイズ効果は離散化ではない = rays を変えても件数がほぼ動かない。
  const sizes = r.slice(1).map((x) => x.sized);
  const spread = Math.max(...sizes) - Math.min(...sizes);
  ok(spread <= 5 && sizes[0] > 0,
    `A4 「扇が標的で埋まらず低信号→無効」は rays に依存しない (rays≥33 で ${sizes.join('/')} 件・振れ幅 ${spread} ≤ 5) = 離散化ではなくモデルの実体`);
}
{
  // A5 有効レンジの法則 d_max ∝ √(ρ·cosθ)。比で見るので比例定数 (信号しきい値) は消える。
  resetOptics();
  SENSOR_OPTICS.on = true; SENSOR_OPTICS.multipath = false; SENSOR_OPTICS.xtalk = 0;
  const base = edgeDistance(0);
  ok(base != null && base > 0.1, `A5-0 基準標的 (ρ=1・正対) の有効レンジ境界 ${base ? base.toFixed(3) : '—'} m を実測`);
  const TOL = 0.05;   // 5% (扇の幾何ゆえ法則は厳密には扇平均を伴う。実装前に固定した許容)
  for (const rho of [0.5, 0.25]) {
    SENSOR_OPTICS.wallRefl = rho;
    const d = edgeDistance(0);
    const exp = base * Math.sqrt(rho);
    ok(d != null && Math.abs(d - exp) / exp <= TOL, `A5-a ρ=${rho}: 境界 ${d.toFixed(3)} m ≈ 基準×√ρ = ${exp.toFixed(3)} m (相対差 ${(100 * Math.abs(d - exp) / exp).toFixed(1)}% ≤ ${100 * TOL}%)`);
  }
  SENSOR_OPTICS.wallRefl = 1.0;
  // √cosθ は**細いビームの極限**の法則。実際の扇 (25°) では傾いた面までの距離が扇の中で変わり、
  // S∝1/d² ゆえ「近い側」が過大に効くので、**実測は必ず予測より遠く**なる。この乖離は傾きとともに
  // 単調に増えるので、法則の成立域 (θ≤45°) を TOL で検査し、それ以遠は**乖離の向きと単調性**を検査する
  // (AS7 の「離散化なら偏差の向きも構造から予測できる」と同型。実測は AS8_tof.md §3 の表)。
  const dev = [];
  for (const deg of [15, 30, 45]) {
    const th = deg * Math.PI / 180;
    const d = edgeDistance(th);
    const exp = base * Math.sqrt(Math.cos(th));
    ok(d != null && Math.abs(d - exp) / exp <= TOL, `A5-b 入射 ${deg}°: 境界 ${d.toFixed(3)} m ≈ 基準×√cosθ = ${exp.toFixed(3)} m (相対差 ${(100 * Math.abs(d - exp) / exp).toFixed(1)}% ≤ ${100 * TOL}%)`);
  }
  for (const deg of [60, 70]) {
    const th = deg * Math.PI / 180;
    const d = edgeDistance(th);
    const exp = base * Math.sqrt(Math.cos(th));
    dev.push((d - exp) / exp);
  }
  ok(dev[0] > 0 && dev[1] > dev[0],
    `A5-b2 θ>45° では扇の幅ゆえ実測が予測より遠くなり、その乖離が単調に増える (60°: +${(100 * dev[0]).toFixed(1)}% → 70°: +${(100 * dev[1]).toFixed(1)}%) = 細ビーム極限からの構造的なズレ`);
  // 検出力: incidence を切ると境界が有意に伸びる (入射角の効果を実際に測っている証拠)。
  //   ※ 面を傾けると「扇の中の距離分布」も変わるので、切っても基準へ厳密には戻らない (上の A5-b2 と同じ理由)。
  const th60 = 60 * Math.PI / 180;
  const withInc = edgeDistance(th60);
  SENSOR_OPTICS.incidence = false;
  const noInc = edgeDistance(th60);
  ok(noInc > withInc * 1.10,
    `A5-c 検出力: incidence=false にすると入射 60° の境界が ${withInc.toFixed(3)} → ${noInc.toFixed(3)} m (+${(100 * (noInc / withInc - 1)).toFixed(1)}% > 10%) = A5-b は入射角の効果を実際に測っている`);
}
{
  // A6 クロストークは短側・弱信号ほど強い。multipath/incidence を切った単一正対標的で比を見る。
  //   モデルの主張は「d_meas/d_true = S̄/(S̄+xtalk)」で S̄∝1/d² ゆえ、**近距離ほど比が 1 に近い**。
  resetOptics();
  SENSOR_OPTICS.on = true; SENSOR_OPTICS.multipath = false; SENSOR_OPTICS.incidence = false;
  const maxM = SENSOR_RANGE.maxMm / 1000;
  const ratioAt = (d) => { const mm = readCenter(planeScene(d)); return mm < 0 ? null : (mm / 1000) / d; };
  SENSOR_OPTICS.xtalk = 0;
  const r0 = [0.2, 0.6, 0.95].map((f) => ratioAt(f * maxM));
  ok(r0.every((x) => x != null && Math.abs(x - 1) < 2e-3), `A6-a xtalk=0 では距離が歪まない (比 ${r0.map((x) => x.toFixed(4)).join('/')} ≈ 1)`);
  SENSOR_OPTICS.xtalk = DEF.xtalk;
  const r1 = [0.2, 0.6, 0.95].map((f) => ratioAt(f * maxM));
  // 短側にしか寄らない (≤1)。**近距離では 1.0000 になる**が、これは信号が強くバイアスが
  // 1mm 量子化を下回るため (0.2×レンジ=400mm で理論値 −0.32mm) = 実機でクロストークが
  // 近距離では問題にならないことと同じ。厳密な不等号は遠方 (0.95×レンジ) で検査する。
  ok(r1.every((x) => x != null && x <= 1), `A6-b xtalk=${DEF.xtalk} は短側にしか寄らない (比 ${r1.map((x) => x.toFixed(4)).join('/')} ≤ 1)`);
  ok(r1[2] < 1, `A6-b2 遠方 (0.95×レンジ) では実際に短く出る (比 ${r1[2].toFixed(4)} < 1)`);
  ok(r1[0] > r1[1] && r1[1] > r1[2], `A6-c 遠いほど短側バイアスが強い (比 ${r1.map((x) => x.toFixed(4)).join(' > ')}) = 弱信号ほどクロストークが効く`);
}
{
  // A7 混合 (マルチパス) は必ず「最近面と最遠面の間」に入り、最近面より長い側へ寄る。
  //   扇の中に近い面と遠い面を両方入れた合成シーンで測る。
  resetOptics();
  SENSOR_OPTICS.on = true; SENSOR_OPTICS.incidence = false; SENSOR_OPTICS.xtalk = 0;
  const ox = 0.135;
  const near = { x1: ox + 0.60, y1: 0.02, x2: ox + 0.60, y2: 1.0 };   // 扇の片側だけを塞ぐ近い面
  const far = { x1: ox + 1.20, y1: -1.0, x2: ox + 1.20, y2: 1.0 };    // 奥の面 (扇全体を覆う)
  const car = { x: 0, y: 0, theta: 0 };
  SENSOR_OPTICS.multipath = false;
  const single = readAll(car, [near, far], [])[1].mm;
  SENSOR_OPTICS.multipath = true;
  const mixed = readAll(car, [near, far], [])[1].mm;
  ok(single > 0 && mixed > 0 && mixed > single && mixed < 1200,
    `A7 混合は最近面 ${single}mm と最遠面 1200mm の間へ寄る (multipath=true → ${mixed}mm) = 「意図した標的以外からの反射」`);
}

// ===== B: 反射率・材質 =======================================================
console.log('\n=== B: 反射率・材質 (実機は「距離値」でなく「有効レンジ」に効く) ===');
{
  resetOptics();
  SENSOR_OPTICS.on = true; SENSOR_OPTICS.multipath = false; SENSOR_OPTICS.xtalk = 0;
  const wall = edgeDistance(0, false);
  const carT = edgeDistance(0, true);
  const exp = wall * Math.sqrt(DEF.carRefl / DEF.wallRefl);
  ok(carT != null && Math.abs(carT - exp) / exp <= 0.05,
    `B1 他車エッジ標的の有効レンジは壁の √(carRefl/wallRefl)=${Math.sqrt(DEF.carRefl / DEF.wallRefl).toFixed(3)} 倍 (実測 ${carT.toFixed(3)} / ${wall.toFixed(3)} m = ${(carT / wall).toFixed(3)} 倍)`);
  // B2 Pololu の公開記述「ToF ゆえ距離値そのものは反射率に大きく左右されない」の再現。
  //   有効な範囲内で反射率を変えても mm は動かない (信号は有効/無効の境目にしか効かない)。
  const d = wall * 0.4;
  const vals = [1.0, 0.6, 0.3].map((rho) => { SENSOR_OPTICS.wallRefl = rho; return readCenter(planeScene(d)); });
  ok(vals.every((v) => v > 0 && v === vals[0]),
    `B2 有効な範囲内では反射率を変えても距離値が動かない (ρ=1.0/0.6/0.3 で ${vals.join('/')}mm) = 公開記述どおり`);
}

// ===== C: 既定 OFF と公式レース非干渉 =========================================
console.log('\n=== C: 既定 OFF の完全縮退と公式レースの強制 OFF ===');
{
  // C1 OFF ではサブフィールドを極端に振っても読値が1件も変わらない (= ON ゲート以外に漏れ口が無い)。
  resetOptics();
  const poses = []; for (let i = 0; i < 360; i += 30) poses.push(i * Math.PI / 180);
  const built = specs.map((s) => { try { return buildFromSpec(s); } catch (e) { return null; } }).filter(Boolean);
  const snap = () => built.map((course) => poses.map((th) => readAll({ x: course.start.x, y: course.start.y, theta: th }, course.walls, []).map((s) => s.mm).join(',')).join('|')).join('#');
  SENSOR_OPTICS.on = false;
  const a = snap();
  Object.assign(SENSOR_OPTICS, { rays: 3, wallRefl: 0.01, carRefl: 0.01, incidence: false, multipath: false, xtalk: 0.9 });
  const b = snap();
  ok(a === b, `C1 OFF ではサブフィールドを極端に変えても読値が1件も変わらない (全 ${built.length} コース×${poses.length} 姿勢×3 センサー)`);
  resetOptics();
}
{
  // C2 公式レース (runRace) は SENSOR_OPTICS.on の live 値に依らず同一 verifyHash + 実行後に復元。
  resetOptics();
  const spec = specs.find((c) => c.name === 'オーバル');
  const course = buildFromSpec(spec);
  const prog = (k) => PROGRAMS.find((x) => x.key === k);
  const field = ['normal_fr', 'normal_awd', 'normal_ff'].map((k, i) => {
    const p = prog(k);
    return { name: ['A', 'B', 'C'][i], lang: 'c', src: p.code, carType: p.carType, rear: false, encoder: false };
  });
  const race = () => runRace({ course, laps: 2, field, crashRule: { rejoin: false, penaltySec: 3 }, interact: true, report: true });
  SENSOR_OPTICS.on = false; const h0 = race().verifyHash;
  SENSOR_OPTICS.on = true; const h1 = race().verifyHash;
  ok(h0 === h1, `C2-a 公式レースは光学モデル ON/OFF で verifyHash が一致 (${h0}) = 強制 OFF が効いている`);
  ok(SENSOR_OPTICS.on === true, 'C2-b runRace 実行後に live の SENSOR_OPTICS.on が復元される (退避→強制 OFF→復元)');
  resetOptics();
}

// ===== D: 領域スケール不変 (無次元性・AS7 申し送り(ii)) =======================
console.log('\n=== D: 領域スケール不変 (無次元でない閾値を足していないか) ===');
{
  // 信号のしきい値判定は (d/maxMm)² の形なので**無次元**でなければならない。
  // 卓上 (maxMm=2000) と中スケール (maxMm=4000) で「有効レンジ境界 / maxMm」が一致することを実測する。
  resetOptics();
  SENSOR_OPTICS.on = true; SENSOR_OPTICS.multipath = false; SENSOR_OPTICS.xtalk = 0;
  const frac = {};
  for (const rg of ['tabletop', 'midscale', 'fullscale']) {
    applyRegime(REGIMES[rg]);
    const d = edgeDistance(45 * Math.PI / 180);
    frac[rg] = d / (SENSOR_RANGE.maxMm / 1000);
    console.log(`    ${rg.padEnd(10)} maxMm=${String(SENSOR_RANGE.maxMm).padStart(6)} 境界 ${d.toFixed(3)} m = ${(100 * frac[rg]).toFixed(3)}% of レンジ`);
  }
  applyRegime(REGIMES.tabletop);
  const vals = Object.values(frac);
  const spread = (Math.max(...vals) - Math.min(...vals)) / Math.min(...vals);
  ok(spread <= 5e-3, `D1 「有効レンジ境界 / 公称レンジ」が3領域で一致 (相対振れ ${(100 * spread).toFixed(3)}% ≤ 0.5%) = しきい値は無次元 (AS7 の崖は生じない)`);
  resetOptics();
}

// ===== E: ③ 教材差分の母集団実測 (本番ソロ走行フロー) =========================
console.log('\n=== E: 「sim で動く = 実機でも頑健か」の母集団差分 (本番ソロ走行) ===');
{
  // 公式レースは光学モデルを強制 OFF にするので、この opt-in が実際に届くのは**ソロ走行**の経路
  //   (main.js の走行ループと同型 = makeSlot → tickSlot → integrateSlot)。そこで測る。
  // 判定は Stage AS 共通の測定作法に従い**母集団の連続量**で書く (コース別 0/1 は軌道カオスゆえ代理量)。
  resetOptics();
  const CONF = 640;                                    // 既定サンプルの信頼区間 (physics_model §12)
  const BUDGET_S = 60;
  const KEYS = ['normal_fr', 'normal_awd', 'normal_ff'];
  const prog = (k) => PROGRAMS.find((x) => x.key === k);
  const built = specs.map((spec) => ({ spec, course: buildFromSpec(spec) }))
    .filter((b) => b.course.finish && !/フルスケール/.test(b.spec.name));
  const runSolo = (course, key) => {
    const p = prog(key);
    const slot = makeSlot({ i: 0, lang: 'c', src: p.code, course, slotCount: 1, logFor: () => (() => {}) });
    slot.carType = p.carType; swapPhysics([slot]); rebuildSpawns([slot], course);
    slot.lap.persist = false;                          // 練習記録には書かない (計測目的・本番経路の persist 引数)
    slot.controller = buildController(slot.src, 'c', slot.hostEnv);
    slot.controller.setup(); slot.running = true; slot.loopTimer = 0;
    let reads = 0, invalid = 0, open = 0;
    const steps = Math.round(BUDGET_S * SIM.loopHz);
    for (let k = 0; k < steps; k++) {
      const edges = [carEdges(slot.car)];
      tickSlot(slot, othersFor(edges, 0, false));
      integrateSlot(slot, 1 / SIM.loopHz, othersFor(edges, 0, false), course.walls, true);
      for (const s of (slot.world._sensors || [])) { reads++; if (s.mm < 0) invalid++; else if (s.mm > CONF) open++; }
      if (slot.lap.laps >= 1) break;
    }
    return { done: slot.lap.laps >= 1, reads, invalid, open };
  };
  const sweep = () => {
    let done = 0, total = 0, reads = 0, invalid = 0, open = 0;
    for (const b of built) for (const key of KEYS) {
      const r = runSolo(b.course, key);
      total++; if (r.done) done++;
      reads += r.reads; invalid += r.invalid; open += r.open;
    }
    return { done, total, invRate: invalid / reads, openRate: open / reads, reads };
  };
  SENSOR_OPTICS.on = false; const off = sweep();
  SENSOR_OPTICS.on = true; const on = sweep();
  SENSOR_OPTICS.incidence = false; const noInc = sweep();
  resetOptics();
  const pc = (x) => (100 * x).toFixed(2) + '%';
  console.log(`    OFF          完走 ${off.done}/${off.total}・無効測距率 ${pc(off.invRate)}・">CONF=開いてる判定" ${pc(off.openRate)}`);
  console.log(`    ON           完走 ${on.done}/${on.total}・無効測距率 ${pc(on.invRate)}・">CONF=開いてる判定" ${pc(on.openRate)}`);
  console.log(`    ON(入射角なし) 完走 ${noInc.done}/${noInc.total}・無効測距率 ${pc(noInc.invRate)}・">CONF=開いてる判定" ${pc(noInc.openRate)}`);
  ok(on.invRate > off.invRate * 10 && on.invRate > 0.01,
    `E1 ON は無効測距を実際に生む (${pc(off.invRate)} → ${pc(on.invRate)} = ×${(on.invRate / Math.max(1e-9, off.invRate)).toFixed(0)})`);
  ok(on.openRate > off.openRate,
    `E2 ON は「>CONF ゆえ開いている」と判定される読みを増やす (${pc(off.openRate)} → ${pc(on.openRate)}) = 実機で危ない側の教材差分`);
  ok(off.done - on.done <= 9,
    `E3 それでも既定サンプル (AS3 頑健化) は母集団として崩れない: 完走 ${off.done} → ${on.done} (低下 ${off.done - on.done} ≤ 9 = AS3 が実測したカオス下限)`);
  ok(noInc.invRate < on.invRate,
    `E4 検出力: incidence を切ると無効測距率が下がる (${pc(on.invRate)} → ${pc(noInc.invRate)}) = E1 は入射角の効果を実際に測っている`);
}

console.log(`\nAS8 光学モデル ゲート: PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
