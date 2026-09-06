// physics_v2.js — Stage AO 走行エンジン v2「精密動力学」(AO1 骨格 → AO2 タイヤ・荷重コア → AO3 駆動系)。
// ════════════════════════════════════════════════════════════════════════════
// 三軸直交アーキテクチャ (AO_spec §1) の「エンジン軸」の第3値 `v2` の実体。
//   AO1 = 骨格＋配線 (DynCar 継承の暫定プレースホルダ)。
//   AO2 = _substep を **4輪 two-track (結合 MF robust 形・輪別荷重・rollBalance・荷重感度・横力緩和長・
//        β依存空力)** へ全面上書き。reset を v2 状態へ拡張。step を §2.6 積分契約 (外側 1/60・nSub 基本8・
//        adaptiveSub 上限256) へ上書き。V2 定数ホルダ・タイヤモデル関数を新設。**単軌道 DynCar のハック
//        (muY/muX 異方性・muXDrift・driftSteerMul・kinFactor/steerK シム) は一切参照しない** = 実機 ±24°
//        統一の正直な物理 (AO_spec §0)。
//   AO3 (本ブロック) = 縦方向を **車輪 ODE＋左右差動 (デフ)** へ差し替え (§2.4)。AO2 の縦は「準静的」=
//        駆動/制動需要を線形剛性で κ へ逆算する暫定形だった。AO3 は per-wheel 面速度 `_vw[4]` を状態化し
//        `dvw/dt = λ·(fApp − fx_tire)` で積分。差動 (open=等分/LSD=平滑粘性 lsdTorque)・モーターブレーキ
//        (駆動軸 split のみ=FR 後軸ロック/FF 前軸)・エンコーダ (vwF/vwR=軸平均) を導入。**タイヤ力法則
//        (tireForceMF)・荷重・空力・body 積分は不変** (κ の決まり方だけを差し替え)。step に車輪剛性の
//        adaptiveSub 条件 (h·λ·μFz·C·Bp/(κP·denom)<0.5) を追加。
// 後続ブロックが継承先の seam を差し替えて段階導入する:
//   ・AO4 = 接触を contact_v2.js の integrateFleetV2 (CCD＋インパルス) へ (integrateSlot 無改変)。
//   ・AO5 = applyRegimeV2 で V2.* を領域別較正・fullscale 既定化。**AO2 は V2.* を固定既定** (normal
//           タイヤ・単一定数帯) で全領域を走らせる (g/空力/長さスケールは applyRegime が設定済の
//           DYN/CAR を読む)。較正の絶対値は AO5、AO2 は「摩擦円・定常円・荷重・緩和・単調性・
//           エネルギー」の**数理的性質**を検証する (性質はスケール不変)。
//   ・AO6 = タイヤセット normal/slip を V2.* の可変化で導入 (AO2 は normal 固定・muDecay 0.75)。
//   ・AO12 = 温度/摩耗 fT/fW (AO2 は fT=fW=1)。
// 既存 physics_dyn.js / physics.js / integrateSlot / api.js / sensors.js は無改変。卓上既定
// (dynamic・normal) の canonical f0/f1 は v2 が guarded branch (mode==='v2' のみ) のため byte 不変。
// ════════════════════════════════════════════════════════════════════════════
import { DynCar, DYN, DYN_DRIVE, dynDriveKey } from './physics_dyn.js';
import { CAR, CONST, MASS, MASS_REF, REGIMES, registerRegimeHook, gPlane, gNormal, GEARS, GEAR_DEFAULT,
         SUSPS, SUSP_DEFAULT, SURFACES, SURFACE_DEFAULT, BRAKES, BRAKE_DEFAULT, steerTargetOf } from './config.js';

// 駆動方式キーは physics_dyn.js の dynDriveKey を共用する (AP22 で旧 driveKeyOf の再実装を 2→1 統合)。

// V2 定数ホルダ (AO_spec §2・§4)。AO2 は **normal タイヤ・固定既定**。AO5 が applyRegimeV2 で領域別に、
// AO6 が normal/slip タイヤセットで一部を書き換える (現段階は単一帯)。μ0 は等方 (縦横同一の実μ) =
// DynCar の異方性ハック (muY≪muX) を廃する v2 の核。
export const V2 = {
  // ── タイヤモデル (結合 Magic Formula robust 形・§2.3) ──
  mu0: 1.4,          // ピーク摩擦係数 μ0 (等方・normal・§4 fullscale 実績)。×course.grip×loadSens×fT×fW
  kappaP: 0.10,      // ピーク縦スリップ率 κP (§2.3/§4 normal)
  alphaP: 0.14,      // ピーク横スリップ (tanα の値・§2.3/§4 normal。α≈8°)。線形剛性 Cα=μFz·C·Bp/αP
  muDecay: 0.75,     // gInf = ピーク後の漸近比 (§2.3 [0.35,0.95] クランプ)。舗装 normal=0.75 (ピーク後落ちる)
  kLS: 0.10,         // 荷重感度 kLS (§2.3)。μ が荷重とともに目減り (重い輪ほど μ 低)
  relLenFrac: 0.5,   // 横力緩和長 relLen = relLenFrac·wheelBase (m・領域スケールで自動追従)
  kappaClamp: 3,     // κ クランプ (§2.3 ±3)
  tanAClamp: Math.tan(80 * Math.PI / 180),  // tanα クランプ (§2.3 ±tan80°)
  // ── 荷重・幾何 (§2.1–2.2) ──
  twFrac: 0.85,      // トレッド tw = twFrac·CAR.width
  hOverL: 0.35,      // 重心高 h = hOverL·wheelBase (DYN.hOverL と同値。荷重移動の強さ)
  izK: 1.0,          // ヨー慣性係数 izK∈[0.95,1.15]。Iz/m = izK·(a·b + tw²/12)
  rollBalance: 0.55, // ζF = 前軸の左右荷重移動分担率 (§2.2 既定0.55・後軸 1−ζF)。ζF↑=前抜け US 化
  // ── 空力 (§2.5) ──
  kBeta: 1.5,        // β依存抗力 (1+kβ·sin²β)。横向き走行は前面投影増で抗力増 (ドリフトのスクラブ)
  // ── 駆動系 (§2.4・AO3) ──
  wheelLambda: 28.0, // λ = m·R²/Iw (車輪応答の速さ・剛さ)。**無次元＝相似スケール不変** (小径/大径で同比)。
                     //   dvw/dt = λ·(fApp − fx_tire)。grip 十分域は半陰的 Euler (AP13・無条件安定)、低グリップは
                     //   原 explicit＋剛性 adaptiveSub を保存 (下 siMinMu)。
  siMinMu: 0.35,     // 車輪 ODE 半陰的化 (AP13・nSub 削減) を適用する μ0eff=T.mu0·grip の下限。これ以上=grip 十分。
                     //   **未満=低グリップ (卓上 slip 0.2 等) は near-limit の slide↔空転連成が鋭く、半陰的で安定でも
                     //   粗い h でカオス発散し衝突多発 (実測 ao6 D2)** ゆえ原 explicit＋needW を保存 (opt-in の疑似ドリフト
                     //   練習場=perf 非律速)。境界 0.35 は卓上 slip(0.2) を保存側・卓上 normal(0.8)/fullscale(1.4/0.9) を上。
  siWheelThresh: 128,// 領域分類の閾値 (applyRegimeV2 が設定)。**領域の代表最大速度での陽的 needW がこれを超える**なら
                     //   「構造的に低速＝needW が常に浪費的」な領域 (卓上 normal は max 速でも needW≈199) と判定し半陰的化
                     //   を有効化 (siActive=true)。fullscale は max 速で needW 小 (走行中 p90≈24) ゆえ false → 全走行が原
                     //   explicit=byte 不変 (エンコーダ vwF/vwR・f2/f3・ao10/ao11 完全保存)。128 は卓上(≈199) と fullscale
                     //   (≪128) の中間。**領域レベルの一括判定ゆえ fullscale は発走 u≈0 の一過性も含め全て explicit=不変。**
  siActive: false,   // 上記判定の結果 (applyRegimeV2 が領域切替時に設定)。true=この領域は車輪 ODE を半陰的化 (nSub 削減)。
  // LSD (平滑粘性＋トルク感応・§2.4)。Tt = clamp(kv·Δvw + kp·|fAxle|·Δvw/(|Δvw|+εv), ±TtMax)·lsd。
  // **sign() 不使用** (Δvw→0 で Δvw/(|Δvw|+εv)→0 連続 ⇒ Tt→0 連続)。lsd∈[0,1] は車種属性 (下 lsdOf)。
  lsdKv: 2.0,        // 粘性結合 (速度差比例・VLSD 的)
  lsdKp: 0.4,        // トルク感応 (伝達トルクに比例して締まる・Torsen/クラッチ式 LSD 的)
  lsdTtMax: 8.0,     // 差動トルク上限 (mass-norm・完全ロックの飽和)
  lsdEps: 0.05,      // 平滑 sign の速度差スケール (m/s・これ未満で連続に 0 へ)
  // ── 定出力ドライブトレイン (§2.4・AO5 で領域別に applyRegimeV2 が書込) ──
  // launchAccel=低速トルク律速の cap (×p.accel)、wheelPower=高速出力律速 (P/vw̄)。**v2 専用** (DynCar は
  // DYN.launchAccel/wheelPower を読む=無改変)。既定 0 = fullscale ドライブトレイン無し (CAR.accel 律速=卓上
  // dynamic と同型)。applyRegimeV2(fullscale) が REGIMES.fullscale.v2 の較正値を書く (AO5)。
  launchAccel: 0,
  wheelPower: 0,
};

// ── タイヤ熱・摩耗 (Stage AO12・AO_spec §6) ─────────────────────────────────────────
// **opt-in (car.wear=true のときのみ作動・既定 OFF=fT=fW=1=byte 不変)**。輪ごとに滑り仕事率から温度と
// 摩耗を決定論積分し、μ を fT(温度)·fW(摩耗) で変調する (**合計効果 ≤maxEffect にクランプ=支配しない設計**)。
// 教材核心 (§6): **ドリフトは後輪を消耗する=使いどころを選ぶ「資源」**。常時ドリフト戦略が長丁場で自滅する
// 様を測定可能にする。全定数は無次元 (P は摩擦円利用率×正規化スリップ速で領域不変=スケール不変・CI-14)。
export const TH = {
  t0: 0.20,        // 冷間 (発走時) 熱状態 (tOpt を1とした比・冷えたタイヤ)
  tOpt: 1.0,       // 最適熱状態 (ピークグリップ)。fT はここで最大 (=1)
  tauTh0: 6.0,     // 熱時定数アンカー (s・Froude スケール sqrt(L/0.13) で領域追従。suspension と同型)
  gain: 1.2,       // 定常昇温 = t0 + gain·P (単位正規化スリップ仕事率あたりの温度上昇。ハードドリフトで温度~1.7)
  kCold: 0.05,     // 冷間グリップ低下勾配 (per (tOpt−temp)⁺。t0 で ~4%=穏やか・暖まれば解消。摩耗に予算を残す)
  kHot: 0.18,      // 過熱グリップ低下勾配 (per (temp−tOpt)⁺。過熱ドリフトで clamp へ近づく=資源の使い過ぎ)
  c3: 0.06,        // 摩耗率 (単位 P·hot·(dt/tauTh) あたりの摩耗増分。数ドリフト周回で ≤10% クランプへ漸近)
  kW: 0.40,        // 摩耗グリップ低下勾配 (per 摩耗量 wear。wear=0.25 で clamp 境界へ)
  maxEffect: 0.10, // 合計 μ 低下クランプ (≤10%=「支配しない」設計・§6)
};

// ── タイヤセット較正 (Stage AO6・AO_spec §4/§10.2) ────────────────────────────────
// v2 は車ごとに `car.tireSet` ('normal'|'slip') を持ち、タイヤの物理定数 (mu0/muDecay/alphaP/kappaP/
// relLenFrac) を切替える (normal=既定・byte 不変／slip=疑似ドリフト環境)。定数は **領域別** (卓上ゴム μ0≈0.8
// と fullscale スリック μ0=1.4 は別ハード) なので REGIMES[name].v2tire に持ち、applyRegimeV2 が領域切替の
// たびに **現在アクティブ領域の値** を _tireCal へ複製する。μ0/muDecay 等は無次元ゆえ midscale は tabletop
// の v2tire を継承 (Froude 導出)。既定 (領域に v2tire 無し) は下記リテラル (=V2 既定=fullscale normal 相当)。
const _tireCalDefault = () => ({
  normal: { mu0: 1.4,  muDecay: 0.75, alphaP: 0.14, kappaP: 0.10, relLenFrac: 0.5 },
  slip:   { mu0: 0.9,  muDecay: 0.95, alphaP: 0.25, kappaP: 0.18, relLenFrac: 0.6 },
  rain:   { mu0: 1.19, muDecay: 0.80, alphaP: 0.16, kappaP: 0.11, relLenFrac: 0.55, wetGain: 0.70 },
});
let _tireCal = _tireCalDefault();
// car.tireSet に応じたタイヤ定数を返す (未知/未指定は normal)。_substep/step が per-car に引く。
// AS9: normal/slip の2値スイッチからキー引きへ一般化 (rain 追加)。未知キーは normal へフォールバック
// ＝旧2値と同一の解決 (normal→normal・slip→slip・その他→normal) ゆえ既存挙動は byte 不変。
export function tireParamsFor(tireSet) { return _tireCal[tireSet] || _tireCal.normal; }

// ── 実効路面グリップ (Stage AS9・レインタイヤの排水性) ────────────────────────────
// 路面の `course.grip` (<1 = 濡れ/低μ) に対し、溝つきレインタイヤは水膜を排除して**低下分の一部を
// 取り戻す**: gripEff = 1 − (1−grip)·(1−wetGain)。wetGain=0 で恒等 (grip そのもの)、1 で完全回復。
// **wetGain===0 (normal/slip) は grip をそのまま返す guarded branch**: 恒等式 1−(1−g)·1 は double では
// g と一致しないことがあり (g=0.55 → 0.55000000000000004)、無条件に通すと既定挙動が byte で動く。
// AP10 の `downhill===0` / AO12 の `doWear` と同じ「非活性なら式に入れない」作法。
export function effGrip(grip, T) {
  const wg = (T && T.wetGain) || 0;
  return wg > 0 ? 1 - (1 - grip) * (1 - wg) : grip;
}

// ── ギア比の解決 (Stage AS9・任意装備) ──────────────────────────────────────────
// car.gearSet ('direct'|'short'|'tall'|'auto2') から GEARS の定義を引く (未知/未指定は direct)。
// direct (ratios=[1]) は「変速機構なし」= 呼び側が geared=false で全ブロックを飛ばす = byte 不変。
export function gearParamsFor(gearSet) { return GEARS[gearSet] || GEARS[GEAR_DEFAULT]; }

// ── サスペンション自由度の解決 (Stage AS11・任意装備) ────────────────────────────
// car.suspSet ('quasi'|'soft'|'balanced'|'stiff') から SUSPS の定義を引く (未知/未指定は quasi)。
// quasi (null) は「ロール/ピッチ自由度なし」= 呼び側が susp=null で ⑪ の旧 LPF 2行をそのまま通す
// = byte 不変 (gearParamsFor の direct と同じ作法)。
export function suspParamsFor(suspSet) {
  const s = Object.prototype.hasOwnProperty.call(SUSPS, suspSet) ? SUSPS[suspSet] : SUSPS[SUSP_DEFAULT];
  return s || null;
}

// ── 路面種別の解決 (Stage AV1・コース任意属性) ────────────────────────────────────
// course.surface ('paved'|'loose') から SURFACES の定義を引く (未知/未指定は paved)。
// paved (null) は「掘り込みなし」= 呼び側が dig=null で全ブロックを飛ばす = byte 不変
// (suspParamsFor の quasi・gearParamsFor の direct と同じ作法)。
export function surfaceParamsFor(surface) {
  const s = Object.prototype.hasOwnProperty.call(SURFACES, surface) ? SURFACES[surface] : SURFACES[SURFACE_DEFAULT];
  // 値域の防御 (AV1 敵対的レビュー 軽6): digSat<=0 は CBpD=Infinity → kD=Infinity → 車輪面速度が
  // 例外を出さずに凍結する **沈黙する故障** になる。dig<0 は F_ss<0 で散逸性の証明 (F_ss≥0) が崩れる。
  // 定義が壊れているエントリは **掘り込み無し (null) へ縮退**させる (既定へ落ちる方が安全)。
  if (!s) return null;
  return (Number.isFinite(s.dig) && s.dig > 0 && Number.isFinite(s.digSat) && s.digSat > 0) ? s : null;
}

// ── 路面のピーク正規化スリップ (Stage AV3・**表示層専用**・物理へは一切読み戻さない) ────────────
// HUD/レースレポートの「摩擦円使用率」は正規化スリップ σ をそのまま百分率にしている (M2/#18②)。舗装は
// ピークが σ=1 なので「100%＝限界・100% 超＝ピークを越えて滑走」と読めるが、掘り込み路面 (AV1) はピークが
// σ=digSat 付近へ移るため、最大グリップで走っている車が 300% と表示されていた (v7.6.0/v7.7.0 の記録)。
// 表示の意味を路面によらず保つため、掘り込み路面では σ を **その路面のタイヤ法則の実ピーク σ** で割る。
// ピークは F(σ)=g(σ)+dig·min(σ/digSat,1) の argmax を数値で求める (探索域 σ∈[1, digSat]。σ>digSat では
// 掘り込みが飽和し g(σ) が単調減なので必ず下がる。単峰性は仮定せず 64 分割の走査を 3 段細分する)。
// 舗装 (dig=null) では呼ばれず _muUseF/_muUseR は従来の σ そのもの (byte 不変)。ゲート wf_av1_loose B8。
export function surfacePeakSigma(C, Bp, dig) {
  if (!dig) return 1;
  const F = (s) => Math.sin(C * Math.atan(Bp * s)) + dig.dig * Math.min(s / dig.digSat, 1);
  const top = Math.max(1, dig.digSat);
  let lo = 1, hi = top, best = 1, bv = F(1);
  for (let r = 0; r < 3; r++) {
    const N = 64, step = (hi - lo) / N;
    if (!(step > 0)) break;
    for (let i = 0; i <= N; i++) { const s = lo + step * i; const v = F(s); if (v > bv) { bv = v; best = s; } }
    lo = Math.max(1, best - step); hi = Math.min(top, best + step);
  }
  return best;
}

// ── 制動装置の解決 (Stage AV2・車両の任意装備) ────────────────────────────────────
// car.brakeSet ('motor'|'friction'|'frictionFront'|'frictionRear') から BRAKES の定義を引く
// (未知/未指定は motor)。motor (null) は「4輪摩擦ブレーキなし」= 呼び側が brk=null で配分ブロックを
// 飛ばし駆動軸 split の従来経路をそのまま通る = byte 不変
// (surfaceParamsFor の paved・suspParamsFor の quasi・gearParamsFor の direct と同じ作法)。
export function brakeParamsFor(brakeSet) {
  const b = Object.prototype.hasOwnProperty.call(BRAKES, brakeSet) ? BRAKES[brakeSet] : BRAKES[BRAKE_DEFAULT];
  // 値域の防御 (AV1 軽6 と同型): biasF が [0,1] の外や非有限だと片軸へ負の制動力 (=加速) が流れ、
  // 「総量は fCmd のまま配分だけ変える」という不変条件が壊れる。壊れた定義は **既定 (null) へ縮退**。
  if (!b) return null;
  return (Number.isFinite(b.biasF) && b.biasF >= 0 && b.biasF <= 1) ? b : null;
}

// v2 の領域別較正を V2 holder / _tireCal へ適用する (Stage AO5/AO6・applyRegime の choke point からフック
// 起動)。**DYN/CAR は applyRegime が既に設定済** (g/空力/長さスケール) — 本関数は v2 専用パラメータ
// (定出力ドライブトレイン＋タイヤセット) のみを書く。引数は REGIMES キー文字列 or applyRegime が渡す領域
// オブジェクト。REGIMES[name].v2 が無ければ駆動 0 (=CAR.accel 律速=卓上 dynamic 同型)、v2tire が無ければ
// リテラル既定へフォールバック (tabletop/midscale/fullscale は全て v2tire を持つ)。
export function applyRegimeV2(nameOrObj) {
  const named = typeof nameOrObj === 'string';
  const r = named ? (REGIMES[nameOrObj] || REGIMES.tabletop) : (nameOrObj || REGIMES.tabletop);
  const v = r.v2 || {};
  V2.launchAccel = (v.launchAccel != null) ? v.launchAccel : 0;
  V2.wheelPower = (v.wheelPower != null) ? v.wheelPower : 0;
  // タイヤセット (AO6): 領域の v2tire を _tireCal へ **値複製** する (midscale が tabletop の v2tire を
  // 参照共有するため領域オブジェクトを書き換えない)。normal/slip 両方が揃うときのみ採用・欠落は既定。
  const ts = r.v2tire;
  const pick = (o) => ({ mu0: o.mu0, muDecay: o.muDecay, alphaP: o.alphaP, kappaP: o.kappaP, relLenFrac: o.relLenFrac,
                         wetGain: o.wetGain || 0 });   // AS9: 排水性 (未指定=0=恒等)
  // AS9: rain は任意 (領域が持たなければリテラル既定へ)。normal/slip の採用条件は従来どおり
  // (両方揃うときだけ領域値) ＝ 既存領域の normal/slip 解決は byte 不変。
  _tireCal = (ts && ts.normal && ts.slip)
    ? { normal: pick(ts.normal), slip: pick(ts.slip), rain: ts.rain ? pick(ts.rain) : _tireCalDefault().rain }
    : _tireCalDefault();
  // 後方互換: V2.* は「アクティブ領域の normal タイヤ」を映す (V2.muDecay/kappaP/alphaP を読む既存の AO2
  // ゲート・診断は normal を得る)。per-car の実解決は必ず tireParamsFor(car.tireSet) を経由する。
  const nrm = _tireCal.normal;
  V2.mu0 = nrm.mu0; V2.muDecay = nrm.muDecay; V2.alphaP = nrm.alphaP; V2.kappaP = nrm.kappaP; V2.relLenFrac = nrm.relLenFrac;
  // AP13: この領域で車輪 ODE 半陰的化 (nSub 削減) を有効化するか — 領域レベルの一括判定 (per-step でなく決定論・
  // 軌跡カオス無し)。領域の代表最大速度でも陽的 needW=ceil(2·λ·μFz·C·Bp/(κP·|u|)·dt) が siWheelThresh を超える
  // なら「構造的に低速で nSub が常に上限へ貼り付く」領域 (卓上/midscale) と判定 → siActive=true (nSub 253→28)。
  // fullscale は max 速で needW 小 → false ⇒ 全走行 (発走 u≈0 含む) が原 explicit=byte 不変 (エンコーダ/f2/f3/
  // ao10/ao11 保存)。DYN/CAR は applyRegime が本フック起動前に設定済 (registerRegimeHook)。dt=1/60=RACE_DT。
  const maxU = Math.max(CAR.maxSpeed, DYN.absUFloor);
  const qMax = (DYN.rho > 0 && DYN.frontalArea > 0) ? 0.5 * DYN.rho * DYN.frontalArea / MASS_REF : 0;
  const muFzAtMax = V2.mu0 * (0.7 * DYN.g + DYN.Cl * qMax * maxU * maxU);
  const cbMax = mfCoeffs(V2.muDecay);
  const needWatMax = 2 * V2.wheelLambda * (muFzAtMax * cbMax.C * cbMax.Bp / (V2.kappaP * maxU)) / 60;
  V2.siActive = needWatMax > V2.siWheelThresh;
}
// applyRegime (physics_dyn.js) の末尾フックへ登録 → 領域切替のたびに V2.* が同期する (循環 import 回避)。
registerRegimeHook(applyRegimeV2);

// 車種の LSD 強度 lsd∈[0,1] (§2.4)。**既定 open(0)**、ドリフト車 (profile.drift) は LSD 装備 (実車ドリ車の
// 必須) で高 lsd。AO3 は駆動別 open 既定＋drift boost で決める (config.js の CAR_TYPES/DYN_DRIVE は無改変
// ＝卓上 byte・共有 URL 不変。AO5+ で normal スポーツカーへの LSD 付与や編集可能フィールド化は別途)。
const V2_LSD_BY_DRIVE = { ff: 0, fr: 0, awd: 0 };
export function lsdOf(profile, driveKey) {
  const base = V2_LSD_BY_DRIVE[driveKey] || 0;
  const boost = (profile && profile.drift) ? 0.8 : 0;
  return Math.max(0, Math.min(1, base + boost));
}

// LSD 差動トルク Tt (§2.4)。Δvw = vw_L − vw_R (左−右の車輪面速度差)。faster 輪から slower へ移す
// (Δvw>0 で左が速い ⇒ Tt>0 ⇒ 左 fApp を減じ右を増やす ⇒ 速度差を詰める)。lsd=0 (open) は Tt=0=等トルク。
// 平滑 sign で Δvw→0 で連続に 0 (§12 AO3「Δω→0 で Tt→0」)。総軸力は不変 (内部移送) ⇒ ヨーのみ変える。
export function lsdTorque(dvw, fAxle, lsd) {
  if (lsd <= 0) return 0;
  const smooth = dvw / (Math.abs(dvw) + V2.lsdEps);   // ∈(−1,1)・Δvw→0 で 0 連続
  const Tt = V2.lsdKv * dvw + V2.lsdKp * Math.abs(fAxle) * smooth;
  return Math.max(-V2.lsdTtMax, Math.min(V2.lsdTtMax, Tt)) * lsd;
}

// 結合 Magic Formula の robust 係数 (§2.3)。gInf=muDecay から C・Bp を閉形式導出:
//   C  = 2 − (2/π)·asin(gInf)      Bp = tan(π/(2C))
// これで g(σ)=sin(C·atan(Bp·σ)) が g(1)=1 (peak)・g(∞)=gInf (漸近) を全 gInf∈(0,1) で厳密に満たす。
// E 項は不採用 (低 gInf×高 B で力の符号反転の破綻域が生じるため・AO_spec §2.3 設計判断固定)。
export function mfCoeffs(gInf) {
  const gi = Math.max(0.35, Math.min(0.95, gInf));
  const C = 2 - (2 / Math.PI) * Math.asin(gi);
  const Bp = Math.tan(Math.PI / (2 * C));
  return { C, Bp };
}

// 結合 MF タイヤ力 (§2.3)。κ=縦スリップ率, ta=tanα, muFz=μ·Fz (質量正規化 accel), (C,Bp)=mfCoeffs,
// kP/aP=ピークスリップ。返り {fx, fy, sigma}: fx=縦力/fy=横力 (車輪系・mass-norm), sigma=正規化スリップ長。
// **|(fx,fy)| = muFz·g(σ) ≤ muFz を構造保証** (摩擦円不変条件)。σ<ε は線形勾配 C·Bp で接続。
// **接地スリップに対し常に散逸的** (fx·(−κ) ≤0 かつ fy·ta ≤0 = エネルギー非注入・§2.3)。
//
// ── Stage AV1: ルーズ路面の掘り込み項 (opt-in・第8引数 dig) ────────────────────────
// dig = {dig, digSat} (config.js SURFACES) が渡ると 合力の**大きさだけ**に σ 比例・上限付きの
// 項を足す: F_ss = muFz·[g(σ) + dig·min(σ/digSat, 1)]。**向き (正規化スリップの逆向き) は
// 変えない**ので散逸性 F·v_slip = −(F_ss·denom/σ)·(κ²/κP+tanα²/αP) ≤ 0 は恒等的に保たれ、
// 摩擦円は |F| ≤ muFz·(1+dig) = μ_eff·Fz を構造保証する (呼び側が同じ μ_eff でクランプする)。
// σ<ε の線形域では掘り込みも σ 比例ゆえ勾配へ dig/digSat が加わる (曲線は原点で連続)。
// **dig が falsy (既定 paved) のときは掘り込みの項が式に一切入らない** = 旧式と同一 double
// = f0〜f3・verifyHash・全既存記録が byte 不変 (effGrip/AP10/AO12 と同じ guarded branch の作法)。
export function tireForceMF(kappa, ta, muFz, C, Bp, kP, aP, dig) {
  const nk = kappa / kP, na = ta / aP;
  const sigma = Math.hypot(nk, na);
  const EPS = 1e-6;
  if (muFz <= 0) return { fx: 0, fy: 0, sigma };
  if (sigma < EPS) {
    const lin = dig ? muFz * (C * Bp + dig.dig / dig.digSat) : muFz * C * Bp;   // σ→0 の線形勾配 (縦横共通)
    return { fx: lin * nk, fy: -lin * na, sigma };
  }
  const g = Math.sin(C * Math.atan(Bp * sigma));   // ∈(0,1]・g(1)=1・g(∞)=gInf
  const Fss = dig ? muFz * (g + dig.dig * Math.min(sigma / dig.digSat, 1)) : muFz * g;   // |F| = Fss ≤ μ_eff·Fz
  return { fx: Fss * nk / sigma, fy: -Fss * na / sigma, sigma };
}

// CarV2: v2 エンジンの車両。AO2 = 4輪 two-track。DynCar を継承し公開面 (フィールド/メソッド) を
// 完全一致させた drop-in (配線検査ゲート wf_ao1_v2 A/B)。`engine='v2'` マーカーで実行時判別可能。
export class CarV2 extends DynCar {
  constructor(start) {
    super(start);          // DynCar.reset(→ CarV2.reset 仮想) で公開面フィールド初期化
    this.engine = 'v2';    // 実体マーカー (DynCar は持たない)
    this.tireSet = 'normal';  // 装備タイヤ (Stage AO6/AS9・car.type と同様に外部から上書き・reset で不変)
    this.wear = false;     // タイヤ熱・摩耗モデル (Stage AO12・opt-in)。tireSet 同様 外部設定・reset で不変。
    this.gearSet = GEAR_DEFAULT;  // 装備ギア (Stage AS9・opt-in)。既定 'direct'=直結=byte 不変。tireSet 同様 reset で不変。
    this.suspSet = SUSP_DEFAULT;  // 装備サス (Stage AS11・opt-in)。既定 'quasi'=自由度なし=byte 不変。reset で不変。
    this.brakeSet = BRAKE_DEFAULT; // 装備ブレーキ (Stage AV2・opt-in)。既定 'motor'=駆動軸のみ=byte 不変。reset で不変。
  }

  // v2 状態フィールドを追加 (DynCar の公開面は super.reset で全て初期化)。
  reset(start) {
    super.reset(start);
    // 路面 muDecay 上書き (§5・AO8)。course.start.muDecay (buildFromSpec→spawn 経由) が渡れば
    // タイヤセット既定 (T.muDecay) を上書きする。null=上書きなし (既定=タイヤ値)。低μ路面の忘れ物
    // 防止に reset のたび再評価 (grip と同型・grip は super.reset が設定)。
    this.muDecay = (start && start.muDecay != null) ? +start.muDecay : null;
    // 路面種別 (Stage AV1)。course.surface (buildFromSpec→spawn 経由) が 'loose' なら掘り込み項が
    // 効く。null/'paved' = 掘り込みなし = byte 不変。grip/muDecay と同型に reset のたび再評価する
    // (**車の装備ではなく路面の属性**なので tireSet/gearSet/suspSet のように reset をまたいで保持しない)。
    this.surface = (start && start.surface != null) ? String(start.surface) : null;
    this._axF = 0;         // 前後加速度の1次 LPF 状態 (荷重移動用・タイヤ縦力 accel)
    this._ayF = 0;         // 横加速度の1次 LPF 状態 (荷重移動用・タイヤ横力 accel)
    // ── Stage AS11: サスペンション自由度 (opt-in)。装備時のみ _axF/_ayF は「1次 LPF の状態」でなく
    // 「ピッチ/ロールのばね撓み (正規化)」になり、その **変化率** をここに持つ (2次系ゆえ状態が2つ)。
    // 既定 quasi では一度も読み書きされない (⑪ の guarded branch) = byte 不変。
    this._axFd = 0;        // ピッチ自由度の速度 dq_x/dt (m/s³)
    this._ayFd = 0;        // ロール自由度の速度 dq_y/dt (m/s³)
    this._fyRel = [0, 0, 0, 0];  // 輪ごと横力緩和長の状態 [FL,FR,RL,RR] (車輪系・mass-norm)
    this._FzWheel = [0, 0, 0, 0];// 輪ごと垂直荷重 (mass-norm・診断/荷重移動ゲート用)
    this._fcMarginSS = 0;  // 定常 MF 力の摩擦円マージン max_i(|(fx,fy)|−μFz) (≤0=円内・不変条件ゲート)
    this._fcMargin = 0;    // 適用力 (緩和+半径クランプ後) の摩擦円マージン (≤0=物理適用力も円内)
    this._slipPowerSS = 0; // 定常 MF 力の接地スリップ仕事率 max_i(F·v_slip) (≤0=散逸的・エネルギー監査)
    this._latCapSS = 0;    // 横グリップ容量 Σμ_i·Fz_i (定常円ゲート)
    this._latCapF = 0;     // 前軸ぶんの横グリップ容量 Σ_front μ_i·Fz_i (AS11: 過渡の前後バランス測定・表示/ゲート専用)
    this._nFaxle0 = 0; this._nRaxle0 = 0;  // 前後移動前の軸荷重 (荷重移動ゲート)
    this._ayTire = 0; this._ayFrontTire = 0; this._ayRearTire = 0;  // 総/前/後軸 横タイヤ accel
    this._muUseF = 0; this._muUseR = 0;  // 軸ごと摩擦円使用率 σ (HUD #18・slip 表示)。AV3: 掘り込み路面ではその路面のピーク σ で正規化 (表示層専用)
    this._vw = [0, 0, 0, 0];  // 車輪面速度 vw=ωR の状態 [FL,FR,RL,RR] (AO3 車輪 ODE＋左右差動)。
                              // vwF/vwR (エンコーダ公開面) は軸平均で毎ステップ導出 ⇒ api.js 無改変。
    // ── Stage AO12: タイヤ熱・摩耗 状態 (発走ごとに冷間・無摩耗へ=各レース新品タイヤ) ──
    this._temp = [TH.t0, TH.t0, TH.t0, TH.t0];  // 輪ごと温度 (熱状態・冷間 t0 始動・§6)
    this._wear = [0, 0, 0, 0];                  // 輪ごと摩耗量 (単調増加=資源枯渇・§6)
    this._muUse4 = [0, 0, 0, 0];  // 輪ごと摩擦円利用率 |F|/μFz∈[0,1] (HUD #AO12・表示層のみ・物理非読取)
    // ── Stage AV2: 制動/駆動の輪ごと診断量 (**表示・ゲート専用・物理は一切読み戻さない**・_muUse4 と同じ作法)。
    // ゲートが「実装が実際にどう配分し、どれだけの縦力を出したか」を **外から** 読むための量。
    // (AV1 の敵対的検証で「不変条件をゲート側で再計算すると実装を 2 倍にしても緑のまま」が実証された
    //  ため、AV2 では配分と力の両方を実装の側から読む述語を置く。)
    this._fAppWheel = [0, 0, 0, 0];  // 輪へ指令した縦力 fApp (制動は負・駆動は正・非駆動/惰行輪は 0)
    this._fxWheel = [0, 0, 0, 0];    // 輪が実際に路面へ出した縦力 fxA (車輪系・緩和/半径クランプ後)
    // ── Stage AW1: 車輪 ODE が到達した縦スリップ率 κ (クランプ後・非駆動輪は 0) とクランプ発火回数 (**診断専用・物理非読取**)。
    //    ゲートが「実装の κ」を外から読むための量 (AV1 教訓(ii): 不変条件をゲート側で再計算しない)。
    this._kapWheel = [0, 0, 0, 0];
    this._kapClampN = 0;
    // ── Stage AS9: 変速機の状態 (発走ごとに 1速・変速中でない)。direct 装備では参照されない (=byte 不変) ──
    this._gearIdx = 0;     // 現在の段 (GEARS[gearSet].ratios の添字)
    this._shiftT = 0;      // 変速で駆動が切れている残り時間 [s] (>0 の間 駆動トルク 0)
  }

  // 停止 (衝突/オーバーラップ解決時)。DynCar.halt は vwF/vwR を 0 化 = CarV2 は車輪状態 _vw も 0 化。
  halt() { super.halt(); if (this._vw) this._vw[0] = this._vw[1] = this._vw[2] = this._vw[3] = 0; }

  // ── 接触 v2 (AO4) の剛体インターフェース ──────────────────────────────────────
  // contact_v2.js のインパルスソルバは車の内部 (aFrac/izK/twFrac) を知らない純粋な幾何/力学解法。
  // ここで CarV2 が自分の「剛体パラメータ」(質量中心 CG・世界系 CG 速度・ヨーレート・逆質量・逆慣性) を
  // _substep と同じ定数で提供し、ソルバはこれを介してのみ状態を読み書きする (カプセル化)。
  //   ・(u,vlat) は **CG の車体系速度** (位置積分が CG を進めるため・_substep ⑩)。
  //   ・Iz は _substep と同一 (izK·(a·b+tw²/12)·m)。逆慣性 = 1/Iz。壁は静的 (invM=invI=0・ソルバ側)。
  // 位置補正は剛体並進 (x,y=後輪軸基準を Δだけ動かせば CG も四隅も同一に並進) ゆえ car.x/y へ直接足す。
  _contactBody() {
    const p = this.profile();
    const dk = DYN_DRIVE[dynDriveKey(p.key || this.type)] || DYN_DRIVE.fr;
    const L = CAR.wheelBase;
    const a = dk.aFrac * L, b = L - a;              // CG→前軸 / CG→後軸 (後輪軸=公開 x,y から前へ b)
    const tw = V2.twFrac * CAR.width;
    const iz = V2.izK * (a * b + tw * tw / 12);     // Iz/m (質量正規化・_substep と同一)
    const m = p.mass || MASS_REF;
    const cth = Math.cos(this.theta), sth = Math.sin(this.theta);
    const cx = this.x + b * cth, cy = this.y + b * sth;         // CG 世界座標
    const vx = this.u * cth - this.vlat * sth;                 // CG 速度 世界系 (車体系→世界)
    const vy = this.u * sth + this.vlat * cth;
    return { m, invM: 1 / m, invI: 1 / (m * iz), cx, cy, vx, vy, w: this.r, b };
  }

  // ソルバが解いた世界系 CG 速度 (vx,vy)・ヨーレート w を車体系 (u,vlat,r) へ書き戻す。位置 (theta) は不変。
  _setContactVel(vx, vy, w) {
    const cth = Math.cos(this.theta), sth = Math.sin(this.theta);
    this.u = vx * cth + vy * sth;
    this.vlat = -vx * sth + vy * cth;
    this.r = w;
    this.v = this.u;   // 表示/派生用 (step 末尾と同期)
  }

  // v2 は driftSteerMul を参照しない = 実機 ±24° 全車統一 (AO_spec §2.1)。
  // Stage AS12: 既定 (3値・steerSet='tri') は従来と厳密に同一。連続舵は ±24° への比 (amt/255)。
  get steerTarget() {
    return steerTargetOf(this.steer, CAR.maxSteer, this.steerSet, this.steerAmt);
  }

  // step 内 substep 反復で不変な量を1回だけ算出して束ねる (AP12 巻き上げ)。旧 _substep はこれらを毎 substep
  // (卓上 v2 は平均 253 回/step) 再計算していた: driveKeyOf の正規表現・mfCoeffs の asin/tan・muOf クロージャ
  // 確保・Math.sqrt(サス/熱)・多数の不変スカラー。**各値は旧 _substep 内の式と同一・同一入力** (this.type/
  // tireSet/grip/muDecay/wear は step 実行中に不変=同一 double 結果) ゆえ **byte 完全不変** (f0-f3・S1/S4
  // verifyHash/traceHash 不変)。dt(=h) はステアレート・積分で使うため _substep 引数のまま残す。p/T/C/Bp は
  // step() が nSub 決定で既に算出したものを受け取る (二重計算も排除)。
  _subCtx(p, T, C, Bp, h) {
    const dkey = dynDriveKey(p.key || this.type);
    const dk = DYN_DRIVE[dkey] || DYN_DRIVE.fr;
    // AS9: grip は「路面」、gripEff は「そのタイヤが実際に使える路面グリップ」。normal/slip (wetGain=0) は
    // gripEff===grip の同一 double ゆえ以降すべて byte 不変 (effGrip の guarded branch)。
    const g = DYN.g, grip = effGrip(this.grip || 1, T);
    // AS10: 路面法線方向の重力 (面内成分 hypot(downhill,gLat) を取り出したぶん減る)。downhill/gLat は
    // step 実行中は不変 (fleet.js が外側 1/60 ごとに書く) ゆえ per-step 不変量として巻き上げる (AP12)。
    // 平地 (面内ゼロ) は gN===g の同一 double ⇒ 全凍結 f0〜f3・正準レースは byte 不変。
    const gN = gNormal(g, this.downhill, this.gLat);
    const m = p.mass || MASS_REF;
    const massK = m / MASS_REF;
    const L = CAR.wheelBase;
    const a = dk.aFrac * L, b = L - a;          // CG→前軸 / CG→後軸
    const tw = V2.twFrac * CAR.width;           // トレッド
    const halfT = tw / 2;
    const hCG = V2.hOverL * L;                  // 重心高
    const iz = V2.izK * (a * b + tw * tw / 12); // ヨー慣性 (質量正規化 Iz/m)
    const maxV = CAR.maxSpeed * p.maxSpeed;
    const CBp = C * Bp;
    const kP = T.kappaP, aP = T.alphaP;
    const vLow = Math.max(DYN.absUFloor, 1e-4);
    // ④ 荷重感度つき μ_i (等方・§2.3)。捕捉する T.mu0/grip/V2.kLS はすべて step 中不変。
    const muOf = (n, n0) => {
      const ls = Math.max(0.7, Math.min(1.15, 1 - V2.kLS * (n - n0) / n0));
      return T.mu0 * grip * ls;
    };
    const doWear = this.wear === true;
    const relLen = T.relLenFrac * L;
    const lsd = lsdOf(p, dkey);
    // ⑪サス LPF 係数 kf・⑫熱時定数 kth (dt=h 固定ゆえ step で確定。式は旧 _substep と厳密同一)。
    const tauSusp = 0.12 * Math.sqrt(L / 0.13);
    const kf = Math.max(0, Math.min(1, h / tauSusp));
    // ⑪' サスペンション自由度 (Stage AS11・opt-in)。装備時だけ 2次系の **厳密離散化** 係数を per-step で作る。
    // ω₀=1/τ_susp を固有角振動数のアンカーに使う (**新しい絶対定数ゼロ**・Froude 時間で領域追従)。
    //
    // ë + 2ζω·ė + ω²·e = 0 (e=q−a・a は substep 内で一定=ZOH) の**解析解**をそのまま遷移行列にする:
    //   e(h) = E·[e₀·(c + σ·s) + v₀·s]      ė(h) = E·[−e₀·ω²·s + v₀·(c − σ·s)]
    //   E=e^{−σh}, σ=ζω, (c,s) = (cos ω_d h, sin(ω_d h)/ω_d)  ω_d=ω√(1−ζ²)  … ζ<1
    //                  = (1, h)                                            … ζ=1 (上式の ω_d→0 極限)
    //                  = (cosh ω_h h, sinh(ω_h h)/ω_h)  ω_h=ω√(ζ²−1)       … ζ>1
    // **数値減衰ゼロ・振動数誤差ゼロ**で、固有値の大きさは常に E=e^{−σh}<1 ⇒ **無条件安定**
    // (AP13 の半陰的化は非線形タイヤ力への妥協だが、本 DOF は線形で係数が per-step 定数ゆえ厳密に解ける)。
    // コストは substep あたり 4 乗算 (後退 Euler の除算より安い)・超越関数は step に1回 (AP12 巻き上げ)。
    // 不動点は (q,v)=(a,0) ＝ 現行 LPF と同一 ⇒ **定常の荷重移動は不変・変わるのは過渡だけ**。
    // 既定 quasi は susp=null で ⑪ が旧2行へ入る (式・double とも同一) = byte 不変。
    // AV1: 路面の掘り込み係数 (per-step 不変。this.surface は step 実行中に変わらない)。
    // paved/未指定は null ⇒ tireForceMF・μ_eff・剛性見積りのすべてで掘り込みの項が式に入らない。
    const dig = surfaceParamsFor(this.surface);
    // 掘り込み込みの σ→0 線形勾配。舗装 (dig=null) は CBp と**同一 double** ゆえ これを使う式は
    // すべて旧式と bit 一致する (車輪 ODE の半陰的剛性 kD・REVERSE 半陰の横剛性 CaF/CaR)。
    const CBpD = dig ? CBp + dig.dig / dig.digSat : CBp;
    // AV3: 表示層専用。掘り込み路面のピーク σ (HUD/レポートの摩擦円使用率を「100%＝ピーク」へ正規化する除数)。
    // 舗装は 1 (使われない＝_muUseF は σ そのもの)。物理は読まない。
    const sigPk = dig ? surfacePeakSigma(C, Bp, dig) : 1;
    // AV2: 制動装置 (per-step 不変。this.brakeSet は step 実行中に変わらない)。
    // motor/未指定は null ⇒ 差動ブロックも wheelDriven も旧経路と同一 = byte 不変。
    const brk = brakeParamsFor(this.brakeSet);
    const S = suspParamsFor(this.suspSet);
    let susp = null;
    if (S) {
      const w = S.wN / tauSusp, z = S.zeta, sg = z * w;
      const E = Math.exp(-sg * h);
      let c_, s_;
      if (z < 1) { const wd = w * Math.sqrt(1 - z * z); c_ = Math.cos(wd * h); s_ = Math.sin(wd * h) / wd; }
      else if (z > 1) { const wh = w * Math.sqrt(z * z - 1); c_ = Math.cosh(wh * h); s_ = Math.sinh(wh * h) / wh; }
      else { c_ = 1; s_ = h; }
      susp = { c1: E * (c_ + sg * s_), c2: E * s_, c3: -E * w * w * s_, c4: E * (c_ - sg * s_) };
    }
    const tauTh = TH.tauTh0 * Math.sqrt(L / 0.13);
    const kth = Math.max(0, Math.min(1, h / tauTh));
    // ⑬ ギア比 (AS9)。geared=false (既定 direct=単段・比1) なら _substep のギアブロックへ入らない
    // ＝ 旧経路と同一式・同一 double = byte 不変。変速時間は熱時定数と同じ Froude 時間 √(L/0.13) で領域追従。
    const G = gearParamsFor(this.gearSet);
    const ratios = G.ratios || [1];
    const geared = !(ratios.length === 1 && ratios[0] === 1);
    const gearN = ratios.length;
    const shiftSec = (G.shiftSec0 || 0) * Math.sqrt(L / 0.13);
    return { p, dk, g, gN, grip, m, massK, L, a, b, tw, halfT, hCG, iz, maxV,
             C, Bp, CBp, CBpD, kP, aP, vLow, muOf, doWear, relLen, lsd, kf, kth, susp, dig, sigPk, brk,
             geared, ratios, gearN, upAt: G.upAt || 0, downAt: G.downAt || 0, shiftSec };
  }

  // 外側 1/60 固定 → nSub 分割 (§2.6 積分契約)。基本8。高速コーナリングの陽的 body 積分安定条件で
  // adaptiveSub (上限256)。横力は緩和長で陰的=無条件安定だが、body の semi-implicit Euler は高速で
  // yaw/横の剛性が上がるため速度・剛性比で刻む。AO3 の車輪 ODE 剛性条件も併せて最小 nSub を取る。
  step(dt) {
    if (this.crashed) { this.v = 0; this.u = 0; this.vlat = 0; this.r = 0; this.vwF = 0; this.vwR = 0; this._vw[0] = this._vw[1] = this._vw[2] = this._vw[3] = 0; return; }
    let nSub = Math.max(8, DYN.nSub);
    const p = this.profile();
    const T = tireParamsFor(this.tireSet);   // AO6: この車の装備タイヤ (normal/slip) の定数
    const absU = Math.max(Math.abs(this.u), DYN.absUFloor);
    // v2 コーナリング剛性の粗い上限 (mass-norm): 2軸ぶんの Cα ≈ 2·μ0·g·grip·C·Bp/αP。陽的横積分の
    // 安定条件 (Cα_total·h/absU < subSafety) を満たす最小 nSub。緩和長で実効剛性は下がるが安全側。
    const { C, Bp } = mfCoeffs((this.muDecay != null) ? this.muDecay : T.muDecay);   // 路面 muDecay 上書き (§5・AO8)
    // AS9: nSub の剛性見積りも「そのタイヤが実際に使えるグリップ」で行う (排水で μ が戻る rain は
    // 実際に横剛性が高い)。normal/slip は gripEff===grip の同一 double ゆえ nSub は byte 不変。
    const gripE = effGrip(this.grip || 1, T);
    // AV1: 掘り込みは σ→0 の線形勾配を C·Bp → C·Bp+dig/digSat へ上げるので、陽的横積分の
    // 安定条件に使う剛性見積りも同じだけ上げる (nSub が増える＝安全側)。舗装 (dig=null) は
    // 三項演算子の else が **旧式と厳密に同一の式** ゆえ nSub は byte 不変。
    const digS = surfaceParamsFor(this.surface);
    const CaTot = digS ? 2 * T.mu0 * DYN.g * gripE * (C * Bp + digS.dig / digS.digSat) / T.alphaP
                       : 2 * T.mu0 * DYN.g * gripE * C * Bp / T.alphaP;
    let need = Math.ceil(CaTot * dt / (Math.max(1.2, DYN.subSafety) * absU));
    // 車輪 ODE 陽的剛性条件 needW = ceil(2·λ·μFz·C·Bp/(κP·denom)·dt) (h·eig<0.5)。縦タイヤ剛性が車輪応答 λ で
    // 増幅され陽的発散する低速域を刻む。μFz は輪荷重上限 (前後左右移動＋ダウンフォース込)×μ、denom=|u| フロア。
    const q = (DYN.rho > 0 && DYN.frontalArea > 0) ? 0.5 * DYN.rho * DYN.frontalArea / (p.mass || MASS_REF) : 0;
    const fDownEst = DYN.Cl * q * absU * absU;                              // 高速ダウンフォース (mass-norm)
    const muFzMax = T.mu0 * gripE * (0.7 * DYN.g + fDownEst);   // per-wheel μ·Fz 上限 (AS9: 実効グリップ)
    // 縦も同じ (∂fx/∂vw の最大は σ→0 の勾配。掘り込みぶんを足すのが正しい上界)。
    const dFxdvw = (digS ? muFzMax * (C * Bp + digS.dig / digS.digSat) : muFzMax * C * Bp) / (T.kappaP * absU);
    const needW = Math.ceil(2 * V2.wheelLambda * dFxdvw * dt);
    // ── 半陰的化の適用境界 (AP13): 「構造的に低速な領域 かつ grip 十分」なときだけ nSub を削減する ──────
    // AO3 車輪 ODE を半陰的化 (_substep ⑥・無条件安定) すれば、上の陽的 needW (低速 1/absU で発散し nSub を上限
    //   256 へ貼り付かせ卓上 v2 の avgNSub を 253.5 へ押し上げていた・binding 100%) を課さずに済み、nSub は横タイヤ
    //   陽的積分の安定条件 need だけで決まる (卓上 normal: 253.5→28.4・§2.6)。ただし2つの条件で原 explicit＋needW を
    //   **保存**する (両立して初めて全 v2 が健全):
    //   (a) **領域が構造的低速でない (!V2.siActive・fullscale)**: fullscale は原 explicit で既に nSub≈16 と適正＝浪費で
    //       ない。これを **領域一括で** 保存する (per-step 判定だと発走 u≈0 の一過性だけ半陰的化してもカオスで全周回が
    //       発散し、エンコーダ vwF/vwR 依存の戦略制御が退行する=実測 ao11 で戦略レーサー DNF/crash)。∴ applyRegimeV2 が
    //       領域単位で siActive を決め、fullscale は **発走含め全走行 explicit=byte 完全不変** (f2/f3・ao10/ao11 保存)。
    //   (b) **低グリップ (μ0eff<siMinMu・卓上 slip 0.2 等)**: near-limit の slide↔空転連成が鋭く、半陰的で安定でも粗い h
    //       では軌跡がカオス発散し衝突多発 (実測 ao6 D2: crash は nSub に過敏=48→0/50→4 でチューニング不可)→保存。
    //   ⇒ **siWheel = 構造的低速領域 ∧ grip 十分** のときだけ半陰的化。卓上 normal だけが該当し nSub 削減、
    //   fullscale 全走行 と 卓上 slip は非該当で byte 保存。μ0eff・siActive とも step 中不変=前ステップ非依存=決定論。
    const mu0eff = T.mu0 * gripE;   // AS9: 半陰的化の可否も実効グリップで判定 (rain は排水で grip 十分側へ寄る)
    const siWheel = V2.siActive && mu0eff >= V2.siMinMu;   // 領域が半陰的化対象(卓上/midscale) ∧ grip 十分(slip 除外)
    if (!siWheel) need = Math.max(need, needW);   // 非該当 (fullscale 全走行・低グリップ slip): 原 needW を課す (byte 保存)
    nSub = Math.max(nSub, Math.min(256, need));
    const h = dt / nSub;
    const sc = this._subCtx(p, T, C, Bp, h);   // AP12: step 不変量を1回だけ算出し全 substep で共有 (byte 不変)
    sc.siWheel = siWheel;   // AP13: 半陰的 on/off を _substep へ (非該当は原 explicit 車輪 ODE)
    for (let i = 0; i < nSub; i++) this._substep(h, sc);
    this.v = this.u;
    this._recordTrail();
  }

  // 4輪 two-track サブステップ (AO_spec §2)。順序は §2.6:
  // ①サーボ ②空力 ③荷重(LPF) ④μ_i ⑤スリップ→タイヤ力(緩和) ⑥車輪 ODE＋差動(AO3・§2.4) ⑦合力/モーメント
  // ⑧semi-implicit Euler(REVERSE横半陰) ⑨低速キネマブレンド ⑩位置(CG→後輪軸) ⑪LPF更新 ⑫(温度/摩耗=AO12)
  _substep(dt, sc) {
    // AP12: step 不変量は sc (per-step context・_subCtx で1回算出) から取得。旧版はこの束を毎 substep 再計算
    // していた (driveKeyOf 正規表現/mfCoeffs/muOf クロージャ/Math.sqrt/不変スカラー群)。sc の各値は旧 substep
    // 内の式と同一・同一入力ゆえ byte 同一 (f0-f3/S1/S4 verifyHash・traceHash 不変)。dt(=h) は引数のまま。
    const { p, dk, g, gN, grip, m, massK, L, a, b, tw, halfT, hCG, iz, maxV,
            C, Bp, CBp, CBpD, kP, aP, vLow, muOf, doWear, relLen, lsd, kf, kth, dig, brk, siWheel } = sc;

    // ── ⓪ 変速機 (Stage AS9・任意装備)。gr = 減速比 (モータートルク ×gr・車輪回転数 ÷gr)。
    //    既定 direct は sc.geared=false でこのブロックへ入らず gr=1 ⇒ 以降の式は旧経路と同一 double
    //    (×1.0・÷1.0 は IEEE754 で厳密恒等) = byte 不変。
    //    2速以上は「車速で決定論的にシフト」: 上げは upAt·maxV 超、下げは downAt·maxV 未満 (ヒステリシス)。
    //    変速中 (_shiftT>0) は駆動トルクが切れる (クラッチ開放相当) = 2速の利得に正直な代償を課す。 ──
    let gr = 1, shifting = false;
    if (sc.geared) {
      if (sc.gearN > 1) {
        if (this._shiftT > 0) {
          this._shiftT = Math.max(0, this._shiftT - dt);
        } else {
          const au = Math.abs(this.u);
          if (this._gearIdx < sc.gearN - 1 && au > sc.upAt * maxV) { this._gearIdx++; this._shiftT = sc.shiftSec; }
          else if (this._gearIdx > 0 && au < sc.downAt * maxV) { this._gearIdx--; this._shiftT = sc.shiftSec; }
        }
        shifting = this._shiftT > 0;
      }
      gr = sc.ratios[this._gearIdx];
    }

    // ── ① 操舵サーボ (3値→有限速度で実舵角) ＋ アッカーマン (左右前輪) ──
    const tgt = this.steerTarget;
    const maxd = CAR.steerRate * dt;
    this.steerAngle += Math.max(-maxd, Math.min(maxd, tgt - this.steerAngle));
    const delta = this.steerAngle;
    const td = Math.tan(delta);
    // δ→0 で両輪 δ に連続接続する形 (1/tanδ の発散を回避)。左旋回 δ>0 で内輪(左)が大。
    const dFL = Math.atan(L * td / (L - halfT * td));
    const dFR = Math.atan(L * td / (L + halfT * td));

    // ── ② 空力 (§2.5・β依存抗力・ダウンフォースは前進成分 u² のみ=ドリフト中喪失) ──
    let dragX = 0, dragY = 0, fDown = 0;
    if (DYN.rho > 0 && DYN.frontalArea > 0) {
      const V = Math.hypot(this.u, this.vlat);
      const q = 0.5 * DYN.rho * DYN.frontalArea / m;   // ½ρA/m
      if (V > 1e-9) {
        const sin2b = (this.vlat * this.vlat) / (V * V);
        const dragMag = DYN.Cd * q * V * V * (1 + V2.kBeta * sin2b);  // |抗力| (mass-norm)
        dragX = dragMag * this.u / V;                  // 速度ベクトル逆向き
        dragY = dragMag * this.vlat / V;
      }
      const uf = Math.max(this.u, 0);
      fDown = DYN.Cl * q * uf * uf;                    // ダウンフォース (mass-norm・前進のみ)
    }

    // ── 勾配重力の車体前方成分 (AP10) ── downhill(=g·sinθ) を世界固定の下り方向 slopeDir へ向く
    // ベクトルとみなし車体前方へ射影。gFwd = downhill·cos(theta−slopeDir)。旧「常に車体+x」のコンベア
    // (theta=π でも前進・登り不能) を是正。downhill===0 (平地・全凍結 f2/f3・全オラクルゲート) は gFwd=0 で
    // 以降の勾配項 (荷重・比力・車体前方 accel) が完全 no-op = byte 不変。
    // AS10: 面内重力を **2 軸へ完全射影** (gPlane)。AP10 は前方成分だけを適用し横成分
    // downhill·sin(θ−slopeDir) を落としていた (峠実走で最大 1.47 m/s²)。gLat=0 でも前方は AP10 と同一
    // double・面内成分ゼロ (平地=全凍結 f0〜f3・正準レース) は早期 return で完全 no-op = byte 不変。
    const gp = gPlane(this.downhill, this.gLat, this.theta, this.slopeDir, this._gp);
    const gFwd = gp.fwd, gLeft = gp.left;

    // ── ③ 輪ごと垂直荷重 (準静的+前ステップ LPF・mass-norm=g スケール accel・§2.2) ──
    // 荷重移動は輪浮きで inner→0 に連続縮退させつつ **Σ Fz = g + ダウンフォース を厳密保存** する
    // (移動量を利用可能荷重にクランプ=inner が浮いたぶんは outer が軸荷重を全部背負う。非保存だと
    //  外輪荷重が軸総和を超え μ·Fz 合計が膨れて ay が μg を超える非物理が起きる)。
    const axF = this._axF, ayF = this._ayF;
    const zF = V2.rollBalance;
    // AS10: 静的輪荷重は **路面法線方向の重力 gN** で立てる (荷重感度の基準 Fz0 も同じ gN 基準に揃える)。
    // 平地は gN===g ゆえ厳密同一 = byte 不変。カントの左右荷重移動は「重力を支えるタイヤ横力」が
    // aySpec 経由で自動的に生むので、ここへ gLat を足さない (足すと二重計上)。
    const nF0 = gN * (b / L) / 2, nR0 = gN * (a / L) / 2;   // 静的 per-wheel 荷重 (Fz0・荷重感度の基準)
    // 勾配ピッチ荷重 (AP10 defect④): 斜面の傾きで CG が幾何的に前後へ寄り静的輪荷重が移る。下り(gFwd>0)で
    // 前軸 +gFwd·hCG/L・後軸 −同 (Σ保存)。静的重力項ゆえ準静的 base(=_nFaxle0)に含める(動的移動 dLong とは別)。
    // downhill===0 で dGrade=0 = +0 加算 = byte 不変。定常(theta=0)では前軸 Fz 増分 = gFwd·hCG/L = downhill·hOverL。
    const dGrade = gFwd !== 0 ? gFwd * hCG / L : 0;
    // 軸ごと総荷重 (静的+ダウンフォース+勾配) → 前後移動をクランプ (軸荷重を非負に=Σ保存)
    let nFaxle = gN * (b / L) + fDown * DYN.downforceBalance + dGrade;
    let nRaxle = gN * (a / L) + fDown * (1 - DYN.downforceBalance) - dGrade;
    this._nFaxle0 = nFaxle; this._nRaxle0 = nRaxle;   // 前後移動前の軸荷重 (荷重移動ゲート: 移動量=軸荷重−これ)
    const dLong = Math.max(-nRaxle, Math.min(nFaxle, axF * hCG / L));  // accel>0=前軸→後軸
    nFaxle -= dLong; nRaxle += dLong;
    // 左右移動 (§2.2 ζF 前軸分担/1−ζF 後軸)。総量 ayF·h/tw を軸内でクランプ (inner を非負に)。
    const dLat = ayF * hCG / tw;
    const nFh = nFaxle / 2, nRh = nRaxle / 2;
    const latF = Math.max(-nFh, Math.min(nFh, zF * dLat));
    const latR = Math.max(-nRh, Math.min(nRh, (1 - zF) * dLat));
    // side: 左輪(y>0) は ayF>0 で抜ける ⇒ −lat。右輪(y<0) は +lat。各輪∈[0,軸荷重]・和=Σ保存。
    const nFL = nFh - latF, nFR = nFh + latF;
    const nRL = nRh - latR, nRR = nRh + latR;

    // ── ④ 荷重感度つき μ_i (等方・§2.3・muOf は sc へ巻き上げ済 = T.mu0·grip·荷重感度) ──
    // ── Stage AO12: タイヤ熱・摩耗 の μ 変調係数 fTW[idx] (opt-in・§6) ──
    // 前ステップ末で積分した温度/摩耗を今ステップの μ に反映 (緩い状態量=1次遅れで十分)。fT(温度窓)·fW(摩耗)
    // を合計効果 ≤maxEffect にクランプ (支配しない設計)。OFF (doWear=false) は乗じない=byte 完全不変 (§7)。
    let fTW = null;   // doWear は sc へ巻き上げ済
    if (doWear) {
      fTW = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const tp = this._temp[k], wr = this._wear[k];
        const fT = 1 - TH.kCold * Math.max(0, TH.tOpt - tp) - TH.kHot * Math.max(0, tp - TH.tOpt);
        const fW = 1 - TH.kW * wr;
        fTW[k] = Math.max(1 - TH.maxEffect, Math.min(1, fT * fW));
      }
    }
    const wSlipP = doWear ? [0, 0, 0, 0] : null;   // 輪ごと滑り仕事率 P (無次元・熱/摩耗の駆動量)。OFF は未使用。

    // ── 縦方向の指令 (§2.4・AO3 駆動系) = 駆動軸への総トルク相当力 fCmd (split・差動 前・mass-norm) ──
    const thrFwd = this.driveDir === CONST.FORWARD;
    const driven = thrFwd || this.driveDir === CONST.REVERSE;
    const braking = this.driveDir === CONST.BRAKE;
    const activeDrive = driven || braking;   // FREE 以外＝駆動軸に実トルクあり (惰行は全輪自由転動)
    let fCmd = 0;     // 駆動軸への縦力指令 (split・差動 前・mass-norm)
    let coast = 0;    // 転がり抵抗 (全輪・body ax へ直接・§2.5 coast 継承)
    let brakeStop = false;
    // 駆動輪の平均車輪面速度 vw̄ (定出力 knee・§2.4「P_wheel/max(|vw̄|,vLow)」。前ステップ状態から)。
    let vwBar = 0, nDrv = 0;
    if (dk.split[0] > 0) { vwBar += Math.abs(this._vw[0]) + Math.abs(this._vw[1]); nDrv += 2; }
    if (dk.split[1] > 0) { vwBar += Math.abs(this._vw[2]) + Math.abs(this._vw[3]); nDrv += 2; }
    vwBar = nDrv > 0 ? vwBar / nDrv : Math.abs(this.u);
    if (driven) {
      const sgn = thrFwd ? 1 : -1;
      // AS9: ギア比が決める頭打ち速度 = maxV/gr (車輪回転数は 1/gr)。gr=1 で従来式に厳密一致。
      const desired = sgn * (this.pwm / 255) * maxV / gr;
      const dBand = DYN.driveBand || 0.06;
      // AS9: トルク律速の加速上限は ×gr。**出力律速 (wheelPower) は P=F·v ゆえギアで不変**(乗じない)。
      let aCap = CAR.accel * p.accel * gr;
      if (V2.wheelPower > 0) {   // fullscale 定出力ドライブトレイン (§2.4・knee は車輪面速度・**V2 専用較正=AO5**)
        const vKnee = Math.max(DYN.absUFloor, vwBar);
        aCap = Math.min(V2.launchAccel * p.accel * gr, V2.wheelPower / vKnee);
      }
      // 変速中は駆動トルクが切れる (クラッチ開放)。direct/単段では shifting=false ゆえ従来どおり。
      fCmd = shifting ? 0 : aCap * Math.max(-1, Math.min(1, (desired - this.u) / dBand));
    } else if (braking) {   // モーターブレーキ = 駆動軸のみへ逆トルク (split 従い FR=後軸ロック/FF=前軸のみ)
      // AS9: モーターブレーキも同じ歯車列を通る (逆起電力の制動トルク ×gr)。gr=1 で従来式に厳密一致。
      const bk = CAR.brake * p.brake * grip * gr / (1 + MASS.brake * (massK - 1));
      fCmd = -Math.sign(this.u) * bk;
      if (Math.abs(this.u) < DYN.uStop) { fCmd = 0; this.u = 0; brakeStop = true; }
    } else {   // FREE: 惰行 (全輪 自由転動 = 接地追従) + 勾配重力
      if (gFwd === 0) {
        coast = -Math.sign(this.u) * Math.min(CAR.coast, Math.abs(this.u) / dt);   // 平地: 従来 (byte 不変)
      } else {
        // 勾配あり (AP10 defect③): 重力 gFwd と Coulomb 転がり抵抗 (速度を反転させない) を合成した正味縦 accel。
        // |gFwd|≤coast の緩斜面は静止保持 (u→0)、|gFwd|>coast で正味転動。gFwd=0 なら従来式に厳密一致。
        const uTent = this.u + gFwd * dt;
        const resist = Math.min(CAR.coast * dt, Math.abs(uTent));
        coast = (uTent - Math.sign(uTent) * resist - this.u) / dt;
      }
    }

    // ── 差動 (§2.4): 軸指令 fCmd·split を左右輪へ配分。open=等分、LSD=Δvw で移送 (総軸力は不変=ヨーのみ) ──
    // relLen・lsd は sc へ巻き上げ済。
    // ── Stage AV2: 4輪摩擦ブレーキ (opt-in)。装備車が BRAKE を出している substep だけ、制動力の配分を
    //    「駆動軸 split」から「前後 biasF 配分」へ差し替える。**総量 fCmd は変えない** (配分だけの比較)。
    //    ロックは車輪 ODE から創発する (下の wheelDriven で非駆動軸も ODE に参加する)。
    //    brk が null (既定 motor) なら fricBrake は常に false ⇒ 下は旧経路そのもの = byte 不変。
    const fricBrake = brk !== null && braking;
    const fApp = [0, 0, 0, 0];   // [FL,FR,RL,RR] への適用力 (mass-norm・非駆動/惰行輪は 0)
    if (fricBrake) {
      // 前軸へ biasF・後軸へ (1−biasF)。各軸内は左右等分。**駆動軸だけは左右がデフで結合**している
      // ので LSD の移送 Tt を従来どおり適用する (総軸力は不変=ヨーのみ変える)。非駆動軸のブレーキ
      // キャリパは輪ごとに独立ゆえ結合しない (lsd=0 の車は どちらでも Tt=0 で同じ)。
      for (let ax = 0; ax < 2; ax++) {
        const wl = ax === 0 ? 0 : 2, wr = ax === 0 ? 1 : 3;   // 左/右輪 idx
        const fAxle = fCmd * (ax === 0 ? brk.biasF : 1 - brk.biasF);
        const half = 0.5 * fAxle;
        const Tt = dk.split[ax] > 0 ? lsdTorque(this._vw[wl] - this._vw[wr], fAxle, lsd) : 0;
        fApp[wl] = half - Tt;
        fApp[wr] = half + Tt;
      }
    } else if (activeDrive) {
      for (let ax = 0; ax < 2; ax++) {
        const share = dk.split[ax];
        if (share <= 0) continue;               // 非駆動軸: fApp=0 (接地追従)
        const wl = ax === 0 ? 0 : 2, wr = ax === 0 ? 1 : 3;   // 左/右輪 idx
        const fAxle = fCmd * share;             // 軸合計トルク相当力
        const half = 0.5 * fAxle;
        const Tt = lsdTorque(this._vw[wl] - this._vw[wr], fAxle, lsd);
        fApp[wl] = half - Tt;                   // faster 輪 (Δvw>0=左速い) は Tt>0 で減、slower は増
        fApp[wr] = half + Tt;
      }
    }

    // ── ⑤ 輪ごと 結合 MF タイヤ力 (横力緩和込) → 車体系へ回転して合算 ──
    // AW1: 車輪 ODE の更新を「全輪の力→車体加速度」の後（⑥'）へ回すための輪ごとの入力（同一 substep 内の受け渡し）。
    const WD = [false, false, false, false], WV = [0, 0, 0, 0], WDen = [0, 0, 0, 0], WFx = [0, 0, 0, 0], WMu = [0, 0, 0, 0], WcD = [1, 1, 1, 1], WsD = [0, 0, 0, 0];
    const WH = [
      { x: a, y: +halfT, d: dFL, n: nFL, n0: nF0, split: dk.split[0], idx: 0 },  // FL
      { x: a, y: -halfT, d: dFR, n: nFR, n0: nF0, split: dk.split[0], idx: 1 },  // FR
      { x: -b, y: +halfT, d: 0, n: nRL, n0: nR0, split: dk.split[1], idx: 2 },   // RL
      { x: -b, y: -halfT, d: 0, n: nRR, n0: nR0, split: dk.split[1], idx: 3 },   // RR
    ];
    let sumFx = 0, sumFy = 0, sumMz = 0, sumFyTire = 0, sumFyFront = 0, sumFyRear = 0, latCap = 0, latCapF = 0;
    let fcMarginSS = -Infinity, slipPowSS = -Infinity, fcMarginApp = -Infinity;
    let sigFmax = 0, sigRmax = 0, arRear = 0;
    for (const w of WH) {
      const cD = Math.cos(w.d), sD = Math.sin(w.d);
      // 接地点速度 (車体系) → 車輪系へ回転
      const vx = this.u - this.r * w.y;
      const vy = this.vlat + this.r * w.x;
      const vcx = vx * cD + vy * sD;
      const vcy = -vx * sD + vy * cD;
      const denom = Math.max(Math.abs(vcx), vLow);
      let muFz = muOf(w.n, w.n0) * w.n;   // μ_i·Fz_i (mass-norm)
      if (doWear) muFz *= fTW[w.idx];        // AO12: 熱・摩耗変調 (OFF は乗じない=byte 不変)
      // AV1: **この路面でこの輪が出せる力の上限** = 摩擦円の半径。舗装 (dig=null) は muFz そのもの
      // (同一 double) ゆえ以降の全式が byte 不変。ルーズ路面は掘り込みぶん μ_eff=μ·(1+dig) へ広がる。
      const muFzEff = dig ? muFz * (1 + dig.dig) : muFz;
      latCap += muFzEff;                     // 横グリップ容量 Σμ_eff,i·Fz_i (定常円ゲート)
      if (w.idx <= 1) latCapF += muFzEff;    // AS11: 前軸ぶん (過渡の前後バランス。物理は読まない診断量)
      // 縦スリップ率 κ (§2.4・AO3 = 車輪 ODE 状態から)。駆動輪は面速度 vw_i と接地縦速 vcx の差、
      // 非駆動/惰行輪は接地追従 (κ=0=自由転動)。±クランプ (物理スリップ上限＋数値安定)。飽和で空転/ロック創発。
      // AV2: 摩擦ブレーキ作動中は **非駆動輪にも制動力が掛かる** ので車輪 ODE に参加させる
      // (κ が 0 でなくなり、fApp が縦力容量を超えた輪から順にロックが創発する)。
      // fricBrake=false (既定 motor・非制動) は旧式と同一 = byte 不変。
      const wheelDriven = fricBrake || (activeDrive && w.split > 0);
      let kappa = 0;
      if (wheelDriven) {
        kappa = Math.max(-V2.kappaClamp, Math.min(V2.kappaClamp, (this._vw[w.idx] - vcx) / denom));
      }
      const ta = Math.max(-V2.tanAClamp, Math.min(V2.tanAClamp, vcy / denom));
      const F = tireForceMF(kappa, ta, muFz, C, Bp, kP, aP, dig);   // AV1: dig=null (舗装) は旧式と同一 double
      // 定常 MF 力 (fx,fy) の摩擦円マージン (構造的に |F|=μFz·g(σ)≤μFz) と 接地スリップ散逸性
      // (fx·vslx+fy·vsly≤0 を構造保証)。**§2.3 の不変条件を測る連続量オラクル (再実装でなく実力を読む)**。
      const vslx = -kappa * denom, vsly = vcy;   // v_slip (車輪系): 縦 vcx−vw=−κ·denom, 横 vcy
      fcMarginSS = Math.max(fcMarginSS, Math.hypot(F.fx, F.fy) - muFzEff);
      slipPowSS = Math.max(slipPowSS, F.fx * vslx + F.fy * vsly);
      // 横力緩和長 (§2.3): 陰的 Euler (無条件安定)。τ=relLen/denom。fx は瞬時 (車輪動特性は AO3)。
      const tau = relLen / denom;
      const alpha = dt / Math.max(tau, 1e-9);
      let fyDyn = (this._fyRel[w.idx] + alpha * F.fy) / (1 + alpha);
      this._fyRel[w.idx] = fyDyn;
      // 緩和した横力は fy が遅れるため瞬時 fx と合成すると過渡で円を僅かに超えうる (緩和モデルの
      // 既知アーティファクト = カーカス撓みのエネルギー蓄積)。適用力は物理的にタイヤ限界を超えられない
      // ので (fx,fyDyn) を μFz へ半径クランプ (線形域では |F|≪μFz で不発 ⇒ fx≈需要は不変)。
      let fxA = F.fx, fyA = fyDyn;
      const Fapp = Math.hypot(fxA, fyA);
      if (Fapp > muFzEff && Fapp > 1e-12) { const s = muFzEff / Fapp; fxA *= s; fyA *= s; }
      fcMarginApp = Math.max(fcMarginApp, Math.hypot(fxA, fyA) - muFzEff);
      // ── AO12: 輪ごと摩擦円利用率 |F|/μFz∈[0,1] (HUD・表示層のみ・物理非読取)＋滑り仕事率 P (熱/摩耗駆動量)。
      //    P = 利用率×正規化スリップ速 (|v_slip|/maxV) = **無次元＝相似スケール不変** (卓上⇔実機で同尺度・CI-14)。──
      const utilW = muFzEff > 1e-12 ? Math.hypot(fxA, fyA) / muFzEff : 0;
      this._muUse4[w.idx] = utilW;
      this._fxWheel[w.idx] = fxA;            // AV2: 実際に出た縦力 (診断・物理非読取)
      this._fAppWheel[w.idx] = fApp[w.idx];  // AV2: 指令した縦力 = 配分の実測点 (診断・物理非読取)
      if (doWear) wSlipP[w.idx] = utilW * (Math.hypot(vslx, vsly) / Math.max(maxV, 1e-6));
      // 車輪系 → 車体系 (前輪は δ_i で回転)
      const fxB = fxA * cD - fyA * sD;
      const fyB = fxA * sD + fyA * cD;
      sumFx += fxB; sumFy += fyB; sumFyTire += fyB;
      if (w.idx <= 1) sumFyFront += fyB; else sumFyRear += fyB;  // 軸別横力 (緩和長/rollBalance ゲート)
      sumMz += w.x * fyB - w.y * fxB;
      // ── 車輪 ODE (§2.4・AO3) は ⑥'（全輪の力と車体加速度の後）で更新する（AW1・2 パス）。ここでは輪ごとの入力を保存。
      WD[w.idx] = wheelDriven; WV[w.idx] = vcx; WDen[w.idx] = denom; WFx[w.idx] = fxA; WMu[w.idx] = muFz; WcD[w.idx] = cD; WsD[w.idx] = sD;
      this._FzWheel[w.idx] = w.n;
      if (w.idx <= 1) sigFmax = Math.max(sigFmax, F.sigma); else sigRmax = Math.max(sigRmax, F.sigma);
      if (w.idx === 2) arRear = ta;
    }
    // ── ⑦ 車体合力/モーメント (mass-norm) ──
    let ax = sumFx + coast - dragX + this.r * this.vlat;   // Coriolis +r·vlat
    let ay = sumFy - dragY - this.r * this.u;              // Coriolis −r·u
    const rdot = sumMz / iz;
    // 勾配重力の適用 (AP10): 駆動中(FORWARD/REVERSE)と BRAKE 走行中は gFwd をそのまま加算。BRAKE 静止は
    // ブレーキ保持で掛けない (現仕様踏襲)。FREE は上の惰行ブロックで転がり抵抗と合成済 (coast に内包) ゆえ
    // ここでは加えない (二重加算回避)。gApplied は荷重 LPF の縦比力にも同値で入る (下・FREE は coast 経由)。
    let gApplied = 0;
    if (gFwd !== 0 && this.driveDir !== CONST.FREE && (driven || Math.abs(this.u) > 1e-3)) gApplied = gFwd;
    ax += gApplied;
    // AS10: 面内重力の横成分。前方と違い FREE 惰行ブロックへ折り込む相手 (転がり抵抗) が無いので**無条件に
    // 加算**する (惰行で坂を下る車も横へ押される)。gLeft は非タイヤ力ゆえ REVERSE 半陰的分岐でも ayNoLat
    // 側に残り正しく陽的に扱われ、⑪の aySpec (タイヤ横力+空力) には入らない = 左右荷重移動の二重計上なし。
    // 平地は gLeft===0 で完全 no-op = byte 不変。
    if (gLeft !== 0) ay += gLeft;
    // ── ⑥' 車輪 ODE (§2.4・AO3・**AW1: 2 パス目**) ──────────────────────────────────────
    //  dvw/dt = λ·(fApp − fx_tire)。fx は適用縦力 fxA (body と同一=作用反作用)。縦力は瞬時 (緩和は横力のみ)。
    //  κ を ±clamp で数値安定 (nSub 上限時の発散止め=最終防波堤)。非駆動/惰行輪は接地追従 vw=vcx (自由転動)。
    //  AP13 の半陰的化 (grip 十分域・siWheel=true) は fx を vw で 1 次陰的化した backward Euler
    //    vw' = v0 + λ·dt·(fApp − fxA)/(1 + λ·dt·kD)  (kD=∂fx/∂vw=muFz·C·Bp/(kP·denom) の線形域上界・無条件安定)
    //  だが、substep の間 **接地速度 vcx を凍結**していた (作用素分割)。車体が減速して vcx が毎 substep ax·dt だけ
    //  下がるのに輪は (fApp−fxA)/kD 程度しか追随できず、滑りが立ち上がらない＝**指令より小さい力しか路面へ届かない**
    //  (AV3 実測: 卓上 motor で参照解の −36%・中スケール −32%。誤差 ∝ dt·kD)。
    //  AW1 の是正: 全輪の力から **同一 substep の車体加速度 (ax, ay, rdot)** を先に求め、接地点の縦速度変化
    //    Δvcx = (ax − rdot·y)·cosδ·dt + (Δv_lat + rdot·x·dt)·sinδ   （前進/制動では Δv_lat = ay·dt。REVERSE は ⑧ と同じ半陰的式で予測＝下記）
    //  を滑り変数 s=vw−vcx の陰的更新へ入れる: s' = s + [λ·dt·(fApp−fxA) − Δvcx]/(1+λ·dt·kD) ⇔
    //    **vw' = v0 + λ·dt·(fApp−fxA)/(1+λ·dt·kD) + Δvcx·λ·dt·kD/(1+λ·dt·kD)**、κ クランプの基準は vcx+Δvcx。
    //  **前 substep の Δvcx を使う予測子は禁止** (AV3 で 4 輪制動が周期 2 振動: ΣFx>0 22%・後輪 fx 符号交替 83%)。
    //  同一 substep の ax は現在の力の関数なのでループ利得の遅れが無く、線形化解析で |1−ε|<1 の減衰 (AW1 ゲートで
    //  ΣFx>0=0・符号交替 <5% を機械固定)。**陽的経路 (siWheel=false: fullscale・低グリップ) は式・順序とも旧値と同一
    //  double** (f2/f3・正準 verifyHash・AO6 D2 を byte 保存)。
    // AW1 (敵対的レビュー #1 で是正): REVERSE は ⑧ が横速度 vlat を半陰的 (1/(1+kLat·dt)) に積分する。定常後退旋回では
    //   陽的 ay·dt は 0 にならず (ayNoLat = kLat·vlat が釣り合う)、Δvcx の横成分をそれで予測すると誤差が毎 substep 滑りへ入り
    //   続ける (実測: 後退速度 +7%・旋回半径 +5% の乖離)。∴ ⑧ と **同一の式・同一の kLat** で Δvlat を予測する。
    //   kLat は ⑧ から巻き上げ (絶対値 |u+ax·dt| は ⑧ の u+=ax·dt 後の |u| と同一 double) ⇒ 陽的経路の ⑧ は bit 不変。
    let kLatRev = 0, dvlat = ay * dt;
    if (this.driveDir === CONST.REVERSE) {
      const absU_ = Math.max(Math.abs(this.u + ax * dt), DYN.absUFloor);
      const cd0_ = Math.cos(delta);
      let CaF_, CaR_;
      if (doWear) {
        CaF_ = (muOf(nFL, nF0) * fTW[0] * nFL + muOf(nFR, nF0) * fTW[1] * nFR) * CBpD / aP;
        CaR_ = (muOf(nRL, nR0) * fTW[2] * nRL + muOf(nRR, nR0) * fTW[3] * nRR) * CBpD / aP;
      } else {
        CaF_ = (muOf(nFL, nF0) * nFL + muOf(nFR, nF0) * nFR) * CBpD / aP;
        CaR_ = (muOf(nRL, nR0) * nRL + muOf(nRR, nR0) * nRR) * CBpD / aP;
      }
      kLatRev = (CaF_ * cd0_ * cd0_ + CaR_) / absU_;
      dvlat = (this.vlat + (ay - sumFyTire) * dt) / (1 + kLatRev * dt) - this.vlat;   // ⑧ REVERSE 枝と同一式の 1 substep 変化
    }
    this._kapClampN = 0;
    for (let k = 0; k < 4; k++) {
      const w = WH[k], vcx = WV[k], denom = WDen[k];
      if (!WD[k]) { this._vw[k] = vcx; this._kapWheel[k] = 0; continue; }
      const v0 = this._vw[k], fxA = WFx[k];
      let vwNew, vcxRef = vcx;
      if (siWheel) {
        const kD = WMu[k] * CBpD / (kP * denom);   // 縦タイヤ剛性 ∂fx/∂vw (線形域・安全側。AV1: CBpD は掘り込み込み)
        const dvcx = (ax - rdot * w.y) * WcD[k] * dt + (dvlat + rdot * w.x * dt) * WsD[k];   // AW1: 同一 substep の接地速度変化 (横は ⑧ と同じ積分則)
        const g = V2.wheelLambda * kD * dt;
        vwNew = v0 + V2.wheelLambda * (fApp[k] - fxA) * dt / (1 + g) + dvcx * g / (1 + g);
        const vcxN = vcx + dvcx; vcxRef = vcxN;
        const kN = (vwNew - vcxN) / denom;
        if (kN > V2.kappaClamp) { vwNew = vcxN + V2.kappaClamp * denom; this._kapClampN++; }
        else if (kN < -V2.kappaClamp) { vwNew = vcxN - V2.kappaClamp * denom; this._kapClampN++; }
      } else {
        vwNew = v0 + V2.wheelLambda * (fApp[k] - fxA) * dt;   // 原 explicit (低グリップ・fullscale 保存・byte 不変)
        const kN = (vwNew - vcx) / denom;
        if (kN > V2.kappaClamp) { vwNew = vcx + V2.kappaClamp * denom; this._kapClampN++; }
        else if (kN < -V2.kappaClamp) { vwNew = vcx - V2.kappaClamp * denom; this._kapClampN++; }
      }
      // モーターブレーキは回転を止めるだけ=車輪を逆回転へは駆動しない (0 でロック。ブレーキはエネルギーを
      // 注入できない)。制動中は vw の符号を跨がせず 0 クランプ (F5 の vwLock 相当・ロック輪=最大スリップ)。
      if (braking) vwNew = v0 >= 0 ? Math.max(0, vwNew) : Math.min(0, vwNew);
      this._vw[k] = vwNew;
      this._kapWheel[k] = (vwNew - vcxRef) / denom;   // AW1 診断: 到達 κ (クランプ後・物理非読取)
    }
    this._fcMarginSS = fcMarginSS;    // 定常 MF 力の摩擦円マージン (≤0=円内・不変条件)
    this._fcMargin = fcMarginApp;     // 適用力 (緩和+クランプ後) のマージン (≤0=クランプで保証)
    this._slipPowerSS = slipPowSS;    // 定常 MF 力の接地散逸性 (≤0=エネルギー非注入)
    this._latCapSS = latCap;          // 横グリップ容量 Σμ_i·Fz_i (定常円 ay/(μg_eff) 突合)
    this._latCapF = latCapF;          // AS11: うち前軸ぶん (front share = _latCapF/_latCapSS で過渡バランスを測る)
    this._ayTire = sumFyTire;         // 総横タイヤ accel (瞬時・緩和/クランプ後)
    this._ayFrontTire = sumFyFront;   // 前軸横タイヤ accel (緩和長ステップ応答)
    this._ayRearTire = sumFyRear;     // 後軸横タイヤ accel (rollBalance バランスシフト)
    // AV3: 掘り込み路面だけピーク σ で正規化 (表示層専用・「100%＝ピーク」を路面によらず保つ)。舗装は従来の σ (byte 不変)。
    this._muUseF = dig ? sigFmax / sc.sigPk : sigFmax; this._muUseR = dig ? sigRmax / sc.sigPk : sigRmax;
    // ── エンコーダ公開面 vwF/vwR = 軸平均 (§12 AO3・api.js は car.vwF/vwR を読むだけ=無改変で成立) ──
    this.vwF = 0.5 * (this._vw[0] + this._vw[1]);   // 前軸 (非駆動なら接地追従の平均=地面速度)
    this.vwR = 0.5 * (this._vw[2] + this._vw[3]);   // 後軸
    if (brakeStop) { this._vw[0] = this._vw[1] = this._vw[2] = this._vw[3] = 0; this.vwF = 0; this.vwR = 0; }

    // ── ⑧ セミインプリシット Euler (REVERSE 横半陰化は DynCar 方式継承・sign-1 後退連成安定化) ──
    this.u += ax * dt;
    if (this.driveDir === CONST.REVERSE) {
      // 線形横剛性 (2軸ぶんの Cα・前輪は cos²δ 投影)。緩和後の実効剛性より安全側 (陰的で無条件安定)。
      // AW1: kLat は ⑥' の前で巻き上げた kLatRev (同一式・|u| は u+=ax·dt 後と同一 double ⇒ 旧版と bit 一致) を使う。
      const kLat = kLatRev;
      const ayNoLat = ay - sumFyTire;   // 横タイヤ力を除いた横 accel (Coriolis+空力)
      this.vlat = (this.vlat + ayNoLat * dt) / (1 + kLat * dt);
    } else {
      this.vlat += ay * dt;
    }
    this.r += rdot * dt;

    // ── ⑨ 低速キネマティックブレンド (停止付近の特異点回避・uBlend0/1 継承) ──
    const spd = Math.hypot(this.u, this.vlat);
    const wB = Math.max(0, Math.min(1, (spd - DYN.uBlend0) / (DYN.uBlend1 - DYN.uBlend0)));
    const rKin = (this.u / L) * Math.tan(delta);
    const vlatKin = rKin * b;
    this.r = wB * this.r + (1 - wB) * rKin;
    this.vlat = wB * this.vlat + (1 - wB) * vlatKin;
    // 完全停止スナップ。ただし FREE で勾配が転がり抵抗を超え正味転動する急坂 (gRoll) はスナップしない
    // (AP10 defect③: v2 は substep が細かく静止転動の微小増分が uStopHard 未満で毎回 0 へ潰されるため)。
    // downhill===0 では gFwd=0→gRoll=false で従来条件 (!driven) と同一 = byte 不変。
    const gRoll = this.driveDir === CONST.FREE && Math.abs(gFwd) > CAR.coast;
    if (Math.abs(this.u) < DYN.uStopHard && !driven && !gRoll) this.u = 0;
    if (this.u === 0 && Math.abs(this.vlat) > 0) this.vlat *= Math.max(0, 1 - DYN.vlatStop * dt);

    // ── ⑩ 位置更新 (CG で積分 → 公開 x,y は後輪軸へ変換) ──
    const cth = Math.cos(this.theta), sth = Math.sin(this.theta);
    let cx = this.x + b * cth, cy = this.y + b * sth;
    cx += (this.u * cth - this.vlat * sth) * dt;
    cy += (this.u * sth + this.vlat * cth) * dt;
    this.theta += this.r * dt;
    this.x = cx - b * Math.cos(this.theta);
    this.y = cy - b * Math.sin(this.theta);

    // ── ⑪ 荷重 LPF 状態更新 (次ステップの荷重移動用・§2.2「測定加速度の1次 LPF」) ──
    // 荷重移動は CG の縦横「比力 (specific force)」= 実在力 (タイヤ+転がり+空力+勾配) の総和/m が生む
    // ピッチ/ロールモーメントで決まる。Coriolis (r·vlat/−r·u) は見かけ項なので除く。直進定常では
    // axSpec=du/dt に一致 ⇒ ΔF_long=|du/dt|·h/L (§12 荷重移動突合が独立測定 du/dt と一致する)。
    // kf (サス LPF 係数) は sc へ巻き上げ済 (dt=h 固定)。
    const axSpec = sumFx + coast - dragX + gApplied;    // 縦 比力 (タイヤ+coast+空力抗力+勾配・AP10 gApplied で ax と同値)
    const aySpec = sumFyTire - dragY;             // 横 比力 (タイヤ+空力横成分)
    // Stage AS11: サス自由度を装備した車だけ 2次系 (ばね・減衰) で積分する。既定 (sc.susp===null) は
    // **旧2行をそのまま通す** (同一式・同一 double) = f0〜f3・正準レース・全既存記録が byte 不変。
    if (sc.susp) {
      // 厳密離散化 (§13.13・_subCtx で per-step 係数化)。ばね撓み q が荷重移動を決める (③ が読む _axF/_ayF)。
      // ζ<1 では q が a を **行き過ぎて** 戻る＝1次遅れには原理的に出せない過渡 (切り返しの荷重の行き過ぎ)。
      // 定常 (a 一定) では (q,v)→(a,0) ＝ 現行と同じ荷重移動へ収束する (①「定常一致・過渡のみ変化」)。
      const sp = sc.susp;
      let e0 = this._axF - axSpec, v0 = this._axFd;      // ピッチ自由度
      this._axF = axSpec + sp.c1 * e0 + sp.c2 * v0;
      this._axFd = sp.c3 * e0 + sp.c4 * v0;
      e0 = this._ayF - aySpec; v0 = this._ayFd;          // ロール自由度
      this._ayF = aySpec + sp.c1 * e0 + sp.c2 * v0;
      this._ayFd = sp.c3 * e0 + sp.c4 * v0;
    } else {
      this._axF += (axSpec - this._axF) * kf;
      this._ayF += (aySpec - this._ayF) * kf;
    }

    // ── ⑫ タイヤ熱・摩耗 積分 (Stage AO12・§6・opt-in)。温度=Froude スケール1次フィルタで t0+gain·P へ緩和、
    //    摩耗=P·hot(温度) を単調累積 (資源枯渇)。全て前ステップ状態量の純関数=決定論。OFF は完全 no-op=byte 不変。──
    if (doWear) {
      // kth (熱時定数の 1次係数) は sc へ巻き上げ済 (dt=h 固定)。
      for (let k = 0; k < 4; k++) {
        const P = wSlipP[k];
        this._temp[k] += (TH.t0 + TH.gain * P - this._temp[k]) * kth;   // 定常 t0+gain·P へ1次緩和
        const hot = this._temp[k] / TH.tOpt;                            // 高温ほど摩耗が速い (単調・正)
        this._wear[k] += TH.c3 * P * hot * kth;                         // 摩耗 単調累積 (資源枯渇=戦略資源)
      }
    }

    // ── 描画用 slip (後軸飽和度: σ_rear。ドーナツ/ドリフト保持で 1 に張り付く) ＋ slipSign ──
    const slipNow = Math.max(0, Math.min(1, (sigRmax - 0.85) / 0.6)) * wB;
    this.slip += (slipNow - this.slip) * Math.min(1, 6 * dt);
    if (Math.abs(arRear) > 0.03) this.slipSign = arRear > 0 ? 1 : -1;
  }
}
