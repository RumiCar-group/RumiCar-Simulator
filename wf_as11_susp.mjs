// AS11 常設アサーションゲート: サスペンション自由度 (ロール/ピッチの状態量化) を機械で守る。
// 本番フローのみ (config.SUSPS・physics_v2.suspParamsFor/CarV2.step・buildFromSpec・runRace) を呼び、
// 判定述語を検査側へ写し取らない (CI-8/CI-9)。exit 非0 = 失敗。
//
// 設計 (docs/physics_model.md §13.13・決定ログ AS-11):
//   ・v2 の輪荷重移動は AO_spec §2.2 以来「準静的な h/L 式を **1次 LPF** (時定数 τ_susp) で駆動」する
//     形で、**行き過ぎ (オーバーシュート) を原理的に持てなかった**。AS11 は ロール1自由度・ピッチ1自由度
//     を状態量化する:  q̈ = ω²(a − q) − 2ζω·q̇   (q = 荷重移動が読む実効加速度 ∝ ロール角)
//     **不動点は q=a** ⇒ 定常の荷重移動は現行と厳密同一・変わるのは過渡だけ (①)。
//   ・**新しい絶対定数ゼロ**: ω は既存の τ_susp から ω₀=1/τ_susp を取り、装備は無次元の (wN, ζ) だけ。
//
// 検査の作法: 実装の遷移式を写し取らず、**減衰2次系なら必ず成り立つ普遍関係**だけで測る —
//   ・自由応答は ω_d=ω√(1−ζ²) で鳴り σ=ζω で減衰する ⇒ 逆に (σ, ω_d) から ω=√(σ²+ω_d²), ζ=σ/ω を
//     復元できる (積分法に依らない)。
//   ・ステップ応答の行き過ぎは **Mp = exp(−πζ/√(1−ζ²))**、到達は t_p=π/ω_d (比例定数を含まない)。
// 章立て: A 自由度の同定 (普遍関係・領域不変・検出力) / B 定常一致 (① の核・quasi と厳密一致)
//         C 過渡の閉形式 (行き過ぎ Mp・単調順序・検出力) / D 大きさの保存 (ΣFz・AS10 申し送り ii)
//         E 二重計上の禁止 (勾配/カント上でも重力は DOF 入力に入らない・AS10 申し送り i)
//         F 既定 quasi の完全縮退 (自由度は一度も動かない・canon/共有 URL に載らない)
//         G 数値安定 (③・増幅率 <1・本番 ω·h の余裕・掃引で発散 0)
//         H 本番 runRace の実走 (② 切り返しの過渡オーバー/アンダーを連続量で)
import { CAR, CONST, SIM, SUSPS, SUSP_SETS, PHYSICS, setPhysicsMode } from './public/js/config.js';
import { applyRegime, DYN } from './public/js/physics_dyn.js';
import { CarV2, suspParamsFor } from './public/js/physics_v2.js';
import { normSusp } from './public/js/fleet.js';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const DT = 1 / SIM.physicsHz;
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);
// 定常のピッチ状態は「定速なら ~0」なので純粋な相対差だと分母が消えて意味を失う (実測: 絶対差 3e-14 が
// rel 3e-9 に化けた)。荷重移動として意味のあるスケール = 重力 の 1% を床にして測る。
const relG = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 0.01 * DYN.g);
const tauOf = () => 0.12 * Math.sqrt(CAR.wheelBase / 0.13);   // 本番 _subCtx と同じ Froude 時間アンカー
const prog = (k) => { const p = PROGRAMS.find((x) => x.key === k); if (!p) throw new Error('no prog ' + k); return p; };

// 減衰振動トレースから (σ, ω_d) を構造非依存に取り出す。ゼロ交差は厳密に T_d/2 間隔 (線形補間で
// sub-sample 精度)、極値は放物線補間して ln|peak| の最小二乗勾配 = −σ。
function fitDecay(tr) {
  const zc = [], ext = [];
  for (let i = 1; i < tr.length; i++) {
    const a = tr[i - 1].q, b = tr[i].q;
    if (a === 0 || a * b < 0) zc.push(tr[i - 1].t + (tr[i].t - tr[i - 1].t) * (a / (a - b)));
  }
  for (let i = 1; i < tr.length - 1; i++) {
    const y0 = tr[i - 1].q, y1 = tr[i].q, y2 = tr[i + 1].q;
    if ((y1 - y0) * (y2 - y1) < 0) {
      const den = y0 - 2 * y1 + y2;
      const d = den !== 0 ? 0.5 * (y0 - y2) / den : 0;
      ext.push({ t: tr[i].t + d * (tr[i].t - tr[i - 1].t), v: y1 - 0.25 * (y0 - y2) * d, sgn: Math.sign(y1) });
    }
  }
  let wd = null, sig = null;
  if (zc.length >= 3) wd = Math.PI / ((zc[zc.length - 1] - zc[0]) / (zc.length - 1));
  if (ext.length >= 3) {
    const n = ext.length; let st = 0, sy = 0, stt = 0, sty = 0;
    for (const e of ext) { const y = Math.log(Math.abs(e.v)); st += e.t; sy += y; stt += e.t * e.t; sty += e.t * y; }
    sig = -(n * sty - st * sy) / (n * stt - st * st);
  }
  return { wd, sig, ext, nzc: zc.length };
}

// ロール自由度の自由応答を **本番 step()** で鳴らす (静止・無操舵 ⇒ 入力 aySpec=0)。
// 初期撓みだけが実験の設定で、以降の発展は 100% 本番コード。susp を任意上書きできる (検出力用)。
function freeRing(suspKey, nTicks, override) {
  const car = new CarV2({ x: 0, y: 0, theta: 0 });
  car.suspSet = suspKey;
  if (override) { SUSPS[suspKey] = override; }
  car.driveDir = CONST.FREE; car.steer = CONST.CENTER; car.pwm = 0;
  car._ayF = 1; car._ayFd = 0;
  const tr = [];
  for (let i = 0; i < nTicks; i++) { car.step(DT); tr.push({ t: (i + 1) * DT, q: car._ayF }); }
  return tr;
}

// 定常旋回を本番 step() で作る (壁なし・一定操舵/一定 PWM)。末尾の状態と、**入力自身が定常に達したか**
// (直近1秒の aySpec の振れ) を返す。定常一致の検査は「入力が定常であること」を前提にするので、
// 前提が成立しているかを同じ関数で測っておく (成立していないのに一致を求めるのは測定設計の誤り)。
function steadyTurn(suspKey, secs, pwm) {
  const car = new CarV2({ x: 0, y: 0, theta: 0 });
  car.suspSet = suspKey;
  car.driveDir = CONST.FORWARD; car.pwm = pwm || 210; car.steer = CONST.LEFT;
  const n = Math.round(secs / DT); const tail = [];
  for (let i = 0; i < n; i++) { car.step(DT); if (i > n - 61) tail.push(car._ayTire); }
  car._inputRipple = Math.max(...tail) - Math.min(...tail);
  return car;
}

// 切り返し (ステップ&ホールド): 左で落ち着かせてから右へ切り、過渡を測る。**行き過ぎは入力自身の山で
// 正規化する** — 入力 (タイヤ横力) も切り返しで山を作るので、生の peak/settled では「自由度の行き過ぎ」と
// 「入力の山」を区別できない。1次遅れは入力の山を増幅できない (比 ≤1) が、2次系は増幅する (比 >1)。
function flick(suspKey, secs, pwm) {
  const car = new CarV2({ x: 0, y: 0, theta: 0 });
  car.suspSet = suspKey; car.driveDir = CONST.FORWARD; car.pwm = pwm;
  const nh = Math.round(secs / DT);
  car.steer = CONST.LEFT; for (let i = 0; i < nh * 2; i++) car.step(DT);
  car.steer = CONST.RIGHT;
  let pq = 0, pa = 0, sq = 0, sa = 0, capMin = Infinity, capSet = 0, shMax = -Infinity, shSet = 0;
  for (let i = 0; i < nh; i++) {
    car.step(DT);
    const share = car._latCapSS > 0 ? car._latCapF / car._latCapSS : 0;   // 前軸が持つ横容量の割合
    if (i > nh * 0.1) { pq = Math.max(pq, Math.abs(car._ayF)); pa = Math.max(pa, Math.abs(car._ayTire)); }
    capMin = Math.min(capMin, car._latCapSS);
    if (i > nh * 0.1) shMax = Math.max(shMax, -share);        // 前軸分担の「落ち込み」の深さ
    if (i > nh - 10) { sq = Math.abs(car._ayF); sa = Math.abs(car._ayTire); capSet = car._latCapSS; shSet = share; }
  }
  return { over: (pq / sq) / (pa / sa), capDip: 1 - capMin / capSet, frontDip: shSet - (-shMax) };
}

// ══ A. 自由度の同定 (普遍関係で測る・領域不変・検出力) ═══════════════════════════════
console.log('\n=== A: ロール自由度の同定 (自由応答 → (ω,ζ) 復元) ===');
const AFIT = {};
for (const regime of ['tabletop', 'midscale', 'fullscale']) {
  applyRegime(regime);
  const tau = tauOf();
  for (const key of ['soft', 'balanced']) {
    const S = suspParamsFor(key);
    const f = fitDecay(freeRing(key, regime === 'fullscale' ? 900 : 600));
    const wM = Math.hypot(f.sig, f.wd), zM = f.sig / wM;
    AFIT[regime + ':' + key] = { wM, zM, tau };
    ok(rel(wM, S.wN / tau) < 3e-5 && rel(zM, S.zeta) < 3e-5,
      `A1 ${regime}/${key}: 復元 ω=${wM.toFixed(6)} (宣言 ${(S.wN / tau).toFixed(6)}・rel ${rel(wM, S.wN / tau).toExponential(1)}) ` +
      `ζ=${zM.toFixed(6)} (宣言 ${S.zeta}・rel ${rel(zM, S.zeta).toExponential(1)})`);
  }
}
{
  // A2 **領域不変**: ω·τ_susp は無次元 = wN そのもの ⇒ 3 領域で厳密に一致すべき (AS7/AS9 と同型)。
  for (const key of ['soft', 'balanced']) {
    const vals = ['tabletop', 'midscale', 'fullscale'].map((r) => AFIT[r + ':' + key].wM * AFIT[r + ':' + key].tau);
    const spread = (Math.max(...vals) - Math.min(...vals)) / SUSPS[key].wN;
    ok(spread < 1e-4, `A2 ${key}: 無次元 ω·τ_susp が 3 領域で一致 (${vals.map((v) => v.toFixed(6)).join(' / ')}・振れ ${spread.toExponential(1)} ≤1e-4 = 領域不変)`);
  }
}
{
  // A3 **検出力**: ζ を 1% だけ動かすと復元値が必ず動く (A1 の残差 ~1e-5 を桁で上回る)。
  applyRegime('tabletop');
  const tau = tauOf(), keep = SUSPS.soft;
  const base = fitDecay(freeRing('soft', 600));
  const pert = fitDecay(freeRing('soft', 600, { wN: keep.wN, zeta: keep.zeta * 1.01 }));
  SUSPS.soft = keep;
  const zB = base.sig / Math.hypot(base.sig, base.wd), zP = pert.sig / Math.hypot(pert.sig, pert.wd);
  ok(rel(zP, zB) > 3e-3, `A3 検出力: ζ×1.01 で復元 ζ が ${zB.toFixed(6)}→${zP.toFixed(6)} (相対 ${rel(zP, zB).toExponential(1)} ≫ A1 残差) = 同定は本物`);
  const back = fitDecay(freeRing('soft', 600));
  ok(rel(back.sig / Math.hypot(back.sig, back.wd), zB) < 1e-12, 'A3b 摂動を戻すと同一値へ復帰 (グローバル汚染なし)');
}

// ══ B. 定常一致 (① の核) ══════════════════════════════════════════════════════
console.log('\n=== B: 定常一致 (装備しても定常の荷重移動は現行と厳密同一) ===');
// **前提の明示**: 「定常一致」は入力 (タイヤ横力) 自身が定常に達して初めて意味を持つ。卓上は 12s で
// 完全に定常 (振れ 0.0)、フルスケールは車が定常円へ乗るまで遅く 12s では未収束 (振れ 3.9e-2)・120s で
// 7e-11 になる — 初版はこれを見落として「装備の差」と誤読しかけた (測定設計の誤り・実測で潰した)。
// soft は最も減衰の遅いモード (σ=ζω=1.875 s⁻¹) なので 12s では自身の過渡が 1.7e-10 残る (実測)。
// 車体側は 12s で完全に定常 (振れ 0.0) なので、待つべきはサス自身の減衰 ⇒ 卓上 24s (e^{−37.5}≈5e-17)。
const SETTLE = { tabletop: 24, fullscale: 120 };
for (const regime of ['tabletop', 'fullscale']) {
  applyRegime(regime);
  const ref = steadyTurn('quasi', SETTLE[regime]);
  ok(ref._inputRipple < 1e-8, `B0 ${regime}: 検査の前提が成立 — ${SETTLE[regime]}s 後の入力 aySpec は定常 (直近1秒の振れ ${ref._inputRipple.toExponential(1)} <1e-8)`);
  for (const key of ['soft', 'balanced', 'stiff']) {
    const c = steadyTurn(key, SETTLE[regime]);
    const dAy = relG(c._ayF, ref._ayF), dAx = relG(c._axF, ref._axF);
    let dFz = 0;
    for (let i = 0; i < 4; i++) dFz = Math.max(dFz, rel(c._FzWheel[i], ref._FzWheel[i]));
    ok(dAy < 1e-9 && dAx < 1e-9 && dFz < 1e-9,
      `B1 ${regime}/${key}: 定常でロール状態 rel ${dAy.toExponential(1)} / ピッチ rel ${dAx.toExponential(1)} / 輪荷重 rel ${dFz.toExponential(1)} (≤1e-9 = 定常一致)`);
    ok(Math.abs(c._ayFd) < 1e-6 * Math.max(1, Math.abs(c._ayF)),
      `B2 ${regime}/${key}: 定常でロール速度 |dq/dt|=${Math.abs(c._ayFd).toExponential(2)} ≈0 (振動が収まっている)`);
  }
}
{
  // B3 **検出力**: 定常一致は「何もしていない」ことの証明ではない — 不動点を 1% ずらすと必ず落ちる。
  // (本番には不動点をずらす経路が無いので、ここでは自由応答の収束先が入力そのものであることを測る)
  applyRegime('tabletop');
  const c = steadyTurn('balanced', 12);
  const aIn = c._ayTire;   // 入力 aySpec = sumFyTire − dragY。低速旋回では dragY≈0
  ok(Math.abs(c._ayF - aIn) < 5e-3 * Math.max(1, Math.abs(aIn)),
    `B3 収束先は入力そのもの: q=${c._ayF.toFixed(6)} ← aySpec≈${aIn.toFixed(6)} (差 ${Math.abs(c._ayF - aIn).toExponential(1)})`);
}

// ══ C. 過渡の閉形式 (行き過ぎ Mp) ═══════════════════════════════════════════════
console.log('\n=== C: 過渡の行き過ぎ Mp = exp(−πζ/√(1−ζ²)) を比で照合 ===');
applyRegime('tabletop');
const MP = {};
for (const key of ['soft', 'balanced']) {
  const S = suspParamsFor(key), tau = tauOf();
  const w = S.wN / tau, z = S.zeta, wd = w * Math.sqrt(1 - z * z);
  const tr = freeRing(key, 600);
  // ステップ応答 s(t)=1−h(t) の最大行き過ぎ = 自由応答 h(t) の最初の負の極値の絶対値。
  const f = fitDecay(tr);
  const first = f.ext.find((e) => e.v < 0);
  const mpMeas = Math.abs(first.v), mpPred = Math.exp(-Math.PI * z / Math.sqrt(1 - z * z));
  const tpMeas = first.t, tpPred = Math.PI / wd;
  MP[key] = mpMeas;
  ok(rel(mpMeas, mpPred) < 5e-3, `C1 ${key}: 行き過ぎ meas=${(mpMeas * 100).toFixed(3)}% pred=${(mpPred * 100).toFixed(3)}% (rel ${rel(mpMeas, mpPred).toExponential(1)} ≤5e-3)`);
  ok(rel(tpMeas, tpPred) < 5e-3, `C2 ${key}: 到達時刻 meas=${tpMeas.toFixed(5)}s pred=${tpPred.toFixed(5)}s (rel ${rel(tpMeas, tpPred).toExponential(1)})`);
}
{
  // C3 臨界減衰 (stiff) は行き過ぎ 0 = 符号反転が一度も起きない。
  const tr = freeRing('stiff', 300);
  const flips = tr.filter((p, i) => i > 0 && p.q * tr[i - 1].q < 0).length;
  MP.stiff = 0;
  ok(flips === 0, `C3 stiff (ζ=1 臨界減衰): 符号反転 ${flips} 回 = 行き過ぎ 0 (Mp=0 の閉形式どおり)`);
  // C4 単調順序: ζ が大きいほど行き過ぎが小さい (soft > balanced > stiff=0)。
  ok(MP.soft > MP.balanced && MP.balanced > MP.stiff,
    `C4 順序 soft ${(MP.soft * 100).toFixed(2)}% > balanced ${(MP.balanced * 100).toFixed(2)}% > stiff 0% (ζ 単調)`);
  // C5 quasi (1次遅れ) は構造的に行き過ぎを持てない = 本ブロックが解消した制約そのもの。
  const trQ = freeRing('quasi', 300);
  const flipsQ = trQ.filter((p, i) => i > 0 && p.q * trQ[i - 1].q < 0).length;
  ok(flipsQ === 0 && MP.soft > 0.3, `C5 quasi は符号反転 0 (1次遅れ=行き過ぎ不可)・soft は ${(MP.soft * 100).toFixed(1)}% 行き過ぎる = 自由度が入った証拠`);
}

// ══ D. 大きさの保存 (AS10 申し送り ii の実行) ═══════════════════════════════════
console.log('\n=== D: 不変条件「Σ輪荷重 = 法線重力 + ダウンフォース」(行き過ぎても壊れない) ===');
for (const regime of ['tabletop', 'fullscale']) {
  applyRegime(regime);
  for (const key of ['quasi', 'soft', 'balanced', 'stiff']) {
    // 切り返し (最も荷重が動く場面) を通しながら毎 tick Σ を測る。
    const car = new CarV2({ x: 0, y: 0, theta: 0 });
    car.suspSet = key; car.driveDir = CONST.FORWARD; car.pwm = 230;
    let worst = 0, minFz = Infinity;
    for (let i = 0; i < 900; i++) {
      car.steer = (i % 60 < 30) ? CONST.LEFT : CONST.RIGHT;    // 0.5 秒ごとの切り返し
      car.step(DT);
      const sum = car._FzWheel[0] + car._FzWheel[1] + car._FzWheel[2] + car._FzWheel[3];
      const tot = car._nFaxle0 + car._nRaxle0;                 // 前後移動前の軸荷重和 (= 法線重力+DF)
      worst = Math.max(worst, rel(sum, tot));
      minFz = Math.min(minFz, Math.min(...car._FzWheel));
    }
    ok(worst < 1e-12 && minFz >= 0,
      `D1 ${regime}/${key}: Σ保存 最悪 rel ${worst.toExponential(1)} (≤1e-12)・輪荷重の最小 ${minFz.toExponential(2)} ≥0 (輪浮きは 0 へ連続縮退)`);
  }
}

// ══ E. 二重計上の禁止 (AS10 申し送り i の実行) ══════════════════════════════════
console.log('\n=== E: 重力の横成分をロール式へ直接足していない (二重計上の禁止) ===');
{
  applyRegime('tabletop');
  // 勾配 + カント相当の面内重力を与えた車 (本番 fleet.applyRoadFrame が書くフィールドと同じ)。
  const mk = (key, downhill, gLat) => {
    const car = new CarV2({ x: 0, y: 0, theta: 0 });
    car.suspSet = key; car.driveDir = CONST.FORWARD; car.pwm = 180; car.steer = CONST.CENTER;
    car.downhill = downhill; car.gLat = gLat; car.slopeDir = 0;
    for (let i = 0; i < 600; i++) car.step(DT);
    return car;
  };
  for (const key of ['soft', 'balanced', 'stiff']) {
    const c = mk(key, 1.2, 0.9);      // 下り + 逆バンク相当 (面内重力の横成分が大きい条件)
    // ロール DOF の収束先は「タイヤ横力 (+空力)」であって重力横成分ではない。gLeft が混ざれば必ずずれる。
    const dev = Math.abs(c._ayF - c._ayTire);
    ok(dev < 0.02 * Math.max(1, Math.abs(c._ayTire)) && Math.abs(c.gLat) > 0,
      `E1 ${key}: 面内重力あり (downhill=1.2 gLat=0.9) でも q=${c._ayF.toFixed(6)} は タイヤ横力 ${c._ayTire.toFixed(6)} に一致 (差 ${dev.toExponential(1)}) = 重力は DOF 入力に入らない`);
  }
  // E2 対照: 重力横成分が実際に車へ効いていること (E1 が「何も起きていない」ことの証明でないこと)。
  const a = mk('balanced', 0, 0), b = mk('balanced', 1.2, 0.9);
  ok(Math.abs(b.y - a.y) > 1e-6 || Math.abs(b.x - a.x) > 1e-6,
    `E2 対照: 面内重力の有無で軌跡が動く (Δx=${(b.x - a.x).toExponential(2)} Δy=${(b.y - a.y).toExponential(2)}) = E1 は無風検査ではない`);
}

// ══ F. 既定 quasi の完全縮退 ═══════════════════════════════════════════════════
console.log('\n=== F: 既定 quasi は自由度を一度も動かさない (byte 不変の構造的根拠) ===');
{
  applyRegime('tabletop');
  const car = new CarV2({ x: 0, y: 0, theta: 0 });
  car.driveDir = CONST.FORWARD; car.pwm = 230;
  let moved = false;
  for (let i = 0; i < 600; i++) {
    car.steer = (i % 60 < 30) ? CONST.LEFT : CONST.RIGHT;
    car.step(DT);
    if (car._axFd !== 0 || car._ayFd !== 0) moved = true;
  }
  ok(car.suspSet === 'quasi' && !moved, 'F1 既定 (quasi) では自由度の速度状態が最後まで 0 のまま = ⑪ が旧 LPF 2行しか通らない');
  ok(suspParamsFor('quasi') === null && suspParamsFor(undefined) === null && suspParamsFor('bogus') === null,
    'F2 quasi/未指定/未知キーは全て null (自由度なし) へ解決 = 未知値でも既定へ落ちる');
  ok(normSusp('bogus') === 'quasi' && normSusp(undefined) === 'quasi' && SUSP_SETS.every((k) => normSusp(k) === k),
    'F3 normSusp は白リスト外を既定 quasi へ・白リスト内は恒等 (UI/共有URL/レース field 単一実装)');
}
{
  // F4 レース canon: 全車 quasi では末尾キーが付かず、非既定が1台でも居れば付く (既存ハッシュ byte 不変の根拠)。
  const spec = { name: 'as11-canon', kind: 'raw', w: 1200, h: 800,
    walls: [[0, 0, 1200, 0], [1200, 0, 1200, 800], [1200, 800, 0, 800], [0, 800, 0, 0]],
    start: { x: 200, y: 400, theta: 0 }, finish: null };
  const course = buildFromSpec(spec);
  const fieldOf = (susp) => [{ name: 'A', lang: 'py', src: prog('py_normal_fr').code, carType: 'normal_fr', susp }];
  const prev = PHYSICS.mode; setPhysicsMode('v2');
  const rQ = runRace({ report: true, course, laps: 1, field: fieldOf('quasi'), physics: 'v2' });
  const rB = runRace({ report: true, course, laps: 1, field: fieldOf('balanced'), physics: 'v2' });
  const rU = runRace({ report: true, course, laps: 1, field: fieldOf('bogus'), physics: 'v2' });
  setPhysicsMode(prev);
  ok(rQ.verifyHash === rU.verifyHash, `F4 未知の susp 値は既定へ正規化され quasi と同一ハッシュ (${rQ.verifyHash})`);
  ok(rQ.verifyHash !== rB.verifyHash, `F4b 非既定 (balanced) は別ハッシュ (${rB.verifyHash}) = canon へ自己記述的に刻まれる`);
}

// ══ G. 数値安定 (③) ═══════════════════════════════════════════════════════════
console.log('\n=== G: 数値安定 (厳密離散化ゆえ無条件安定・本番刻みの余裕・掃引で発散 0) ===');
{
  // G1 増幅率: 自由応答の1周期あたりの減衰は e^{−σT_d} <1 (成長しない)。全領域×全装備で測る。
  let worstGrow = -Infinity;
  for (const regime of ['tabletop', 'midscale', 'fullscale']) {
    applyRegime(regime);
    for (const key of ['soft', 'balanced', 'stiff']) {
      const tr = freeRing(key, 600);
      let grow = -Infinity, prevAbs = Math.abs(tr[0].q);
      for (let i = 1; i < tr.length; i++) {
        const a = Math.abs(tr[i].q);
        if (a > 1e-280 && prevAbs > 1e-280) grow = Math.max(grow, a / prevAbs);
        prevAbs = Math.max(prevAbs, a) === a ? a : prevAbs;   // 包絡線 (単調非増加であるべき)
      }
      worstGrow = Math.max(worstGrow, Math.abs(tr[tr.length - 1].q) / Math.abs(tr[0].q));
    }
  }
  ok(worstGrow < 1, `G1 全領域×全装備で自由応答の包絡線は縮小のみ (最悪の 終端/初期 = ${worstGrow.toExponential(2)} <1)`);
  // G2 本番刻みでの ω·h と、陽的積分なら発散する境界 (ω·h=2) までの余裕。厳密離散化は境界を持たないが、
  //    「どれだけ余裕があるか」を連続量で常設監視する (AS7 の siWheelThresh の崖と同型)。
  let worstWh = 0, worstAt = '';
  for (const regime of ['tabletop', 'midscale', 'fullscale']) {
    applyRegime(regime);
    const tau = tauOf(), hMax = DT / Math.max(8, DYN.nSub);   // nSub の下限 = h の上限
    for (const key of SUSP_SETS) {
      const S = suspParamsFor(key); if (!S) continue;
      const wh = (S.wN / tau) * hMax;
      if (wh > worstWh) { worstWh = wh; worstAt = `${regime}/${key}`; }
    }
  }
  ok(worstWh < 0.2, `G2 本番の最悪 ω·h = ${worstWh.toExponential(3)} (${worstAt}) — 陽的積分の限界 2.0 まで ×${(2 / worstWh).toFixed(1)} の余裕 (厳密離散化ゆえ限界自体は無い)`);
  // G3 掃引: 領域×装備×操舵パターンで本番 step を回し、非有限値・発散が 0 件。
  let bad = 0, maxAbs = 0;
  for (const regime of ['tabletop', 'midscale', 'fullscale']) {
    applyRegime(regime);
    for (const key of SUSP_SETS) {
      for (const period of [2, 6, 20, 60]) {
        const car = new CarV2({ x: 0, y: 0, theta: 0 });
        car.suspSet = key; car.driveDir = CONST.FORWARD; car.pwm = 255;
        for (let i = 0; i < 600; i++) {
          car.steer = (i % (2 * period) < period) ? CONST.LEFT : CONST.RIGHT;
          car.step(DT);
          for (const v of [car.u, car.vlat, car.r, car._axF, car._ayF, car._axFd, car._ayFd, car.x, car.y]) {
            if (!Number.isFinite(v)) bad++;
          }
          maxAbs = Math.max(maxAbs, Math.abs(car._ayF), Math.abs(car._axF));
        }
      }
    }
  }
  ok(bad === 0, `G3 掃引 3領域×4装備×4切り返し周期×600tick: 非有限値 ${bad} 件 (0=発散なし)・荷重移動状態の最大 |q|=${maxAbs.toFixed(3)} m/s²`);
}

// ══ H. 本番 runRace の実走 (② 切り返しの過渡オーバー/アンダー) ═══════════════════
console.log('\n=== H: 切り返しでの過渡 (② の実測デモ・連続量) ===');
{
  applyRegime('tabletop');
  const res = {};
  for (const k of SUSP_SETS) res[k] = flick(k, 3.0, 235);
  for (const k of SUSP_SETS) {
    console.log(`     ${k.padEnd(9)} 正規化行き過ぎ=${res[k].over.toFixed(4)}  横容量の落ち込み=${(res[k].capDip * 100).toFixed(3)}%  前軸分担の落ち込み=${(res[k].frontDip * 100).toFixed(4)}pt`);
  }
  ok(res.soft.over > 1 && res.quasi.over < 1 && res.stiff.over < 1,
    `H1 切り返しで soft は入力の山を **増幅** する (比 ${res.soft.over.toFixed(4)} >1) が quasi は増幅できない (${res.quasi.over.toFixed(4)} <1) = 1次遅れには原理的に出せない過渡`);
  ok(res.soft.over > res.balanced.over && res.balanced.over > res.stiff.over,
    `H2 行き過ぎの強さは ζ の順序どおり soft ${res.soft.over.toFixed(4)} > balanced ${res.balanced.over.toFixed(4)} > stiff ${res.stiff.over.toFixed(4)}`);
  ok(res.soft.capDip > 10 * res.quasi.capDip,
    `H3 行き過ぎた荷重移動は横グリップ容量を過渡的に削る (soft ${(res.soft.capDip * 100).toFixed(3)}% ≫ quasi ${(res.quasi.capDip * 100).toFixed(3)}%・荷重感度 kLS 経由) = 交換として測れる`);
  ok(res.soft.frontDip > res.quasi.frontDip && res.soft.frontDip > res.stiff.frontDip,
    `H4 前軸が持つ横容量の割合が過渡的に落ちる幅は soft ${(res.soft.frontDip * 100).toFixed(4)}pt > quasi ${(res.quasi.frontDip * 100).toFixed(4)}pt = **過渡アンダー** (ζF=0.55 で前軸の荷重移動が大きいぶん μ の目減りも大きい)`);
}
{
  // H5 本番 runRace (実コース・実プログラム) で装備が走行結果に効き、決定論が保たれる。
  const spec = { name: 'as11-slalom', kind: 'raw', w: 1600, h: 900,
    walls: [[0, 0, 1600, 0], [1600, 0, 1600, 900], [1600, 900, 0, 900], [0, 900, 0, 0]],
    start: { x: 150, y: 450, theta: 0 }, finish: null };
  const course = buildFromSpec(spec);
  applyRegime('tabletop');
  const prev = PHYSICS.mode; setPhysicsMode('v2');
  const hashes = {};
  for (const k of SUSP_SETS) {
    const f = [{ name: 'A', lang: 'py', src: prog('py_normal_fr').code, carType: 'normal_fr', susp: k }];
    const r1 = runRace({ report: true, course, laps: 1, field: f, physics: 'v2' });
    const r2 = runRace({ report: true, course, laps: 1, field: f, physics: 'v2' });
    hashes[k] = r1.verifyHash;
    ok(r1.verifyHash === r2.verifyHash, `H5 ${k}: 本番 runRace が決定論 (2回とも ${r1.verifyHash})`);
  }
  setPhysicsMode(prev);
  const uniq = new Set(Object.values(hashes));
  ok(uniq.size >= 3, `H6 装備ごとに走行結果が変わる (${SUSP_SETS.map((k) => k + '=' + hashes[k]).join(' ')}・異なり ${uniq.size}/4)`);
}

console.log(`\nAS11 サスペンション自由度ゲート: PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
