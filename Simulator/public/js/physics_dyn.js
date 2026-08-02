// 車両運動モデル (動力学版): 単軌道 (シングルトラック) モデル + 摩擦楕円 + 簡易荷重移動。
// physics.js (キネマティック版) の Car と公開面互換。Phase B (物理大改修) で新設。
//
// キネマティック版は速度ベクトルが車体向き±45°に拘束される (slide ≤ |v| キャップ) ため
// 90°超のドリフト過渡 (バックエントリー等) が構造的に不可能だった。本モデルは
// 車体座標の前後速度 u / 横速度 vlat / ヨーレート r を独立に積分するため、
// パワーオーバー・リフトオフ・ブレーキドリフト・定常ドリフト・バックエントリー・
// ドーナツが個別ルールなしに創発する。
//
// 状態 (重心=CG 基準):
//   u    : 車体前後速度 (m/s, 前+)
//   vlat : 車体横速度 (m/s, 左+)
//   r    : ヨーレート (rad/s, 反時計+)
//   公開 x,y は互換のため後輪軸中心 (CG から b 後方)。内部 _cx,_cy が CG。
//
// スケール注意: 卓上 (最高速 0.7m/s・ホイールベース 0.13m) なので、実車の μ≈1 (9.8m/s²)
// だと横限界が到達不能になり絶対に滑らない。横の摩擦は「滑り出しが見える」よう小さく、
// 縦は現モデルの加速 2.5 / 制動 4.0 m/s² を出せるよう強く、と異方性を持たせる (摩擦楕円)。
import { CAR, CONST, TRAIL, CAR_TYPE_BY_KEY, CAR_TYPE_DEFAULT, MASS_REF, MASS, REGIMES, REGIME_STATE, setRegimeScale, SENSOR_RANGE, REGIME_HOOKS, gForward } from './config.js';

// 駆動方式ごとの動力学パラメータ。
//   aFrac    : CG 位置 (前軸からの距離 a = aFrac×wheelBase)。小さい=前荷重 (FF)。
//   split    : 駆動力の前後配分 [前, 後]。制動も同じ配分 — RumiCar の BRAKE は
//              摩擦ブレーキではなくモーターブレーキ (駆動輪にしか効かない)。
//              → FR はリアのみ制動=ロックで回頭 (ブレーキドリフト)、FF は前のみ=直進安定。
//              現キネマ版の brakeOs 序列 (FR 0.22 ≫ FF 0.02) と同じ性格が構造から出る。
//   CfK/CrK  : コーナリング剛性の前後倍率 (比が定常ゲインの速度依存=アンダー/オーバー勾配を決める)
//   muRK     : ドリフト車の後軸横μ倍率 (<1 = リアが先に流れる)。ドーナツ/パワーオーバーの源:
//              前後同時飽和だとモーメントが釣り合い中立4輪ドリフトで止まる (実測)。
//              リアだけ明確に低いと a·fyF−b·fyR>0 が残って回頭が自走する。
//              ノーマル車には適用しない (滑らない車まで滑り出すため)。
//   steerK   : 実効舵角の一定トリム。kin 変調層シム (下記) で吸収しきれない動力学側の
//              残差を test_dyn.mjs「calib fit」で較正する。
//
// 較正の設計 (試行の記録):
//   剛性比 CfK/CrK で速度依存を作る → 剛性が極端 (Cr 4.0 等) になり過渡がもっさりして
//   プログラム成績 169→137 に悪化。速度のみのシム (1+gainV·sp) → FF の「リフトで曲げる」
//   が効かず 148 止まり (kin の powerUs はスロットル連動のため)。
//   → 結論: kin の変調層 yawGain·(1+osEff·spOver)/(1+usEff·sp) を throttle/liftoff/braking
//   連動のまま実効舵角シムとして移植する (_kinSteerFactor)。操縦感は kin、限界挙動
//   (飽和・滑り・>90°過渡) は動力学のまま。
export const DYN_DRIVE = {
  ff:  { aFrac: 0.42, split: [1.0, 0.0], CfK: 0.95, CrK: 1.30, muRK: 1.05, steerK: 1.075 },
  fr:  { aFrac: 0.55, split: [0.0, 1.0], CfK: 1.15, CrK: 1.00, muRK: 0.80, steerK: 0.965 },
  awd: { aFrac: 0.50, split: [0.4, 0.6], CfK: 1.00, CrK: 1.10, muRK: 0.95, steerK: 1.040 },
};

// 共通チューニング定数 (test_dyn.mjs のシナリオ群で較正)。
// Phase F1: 領域(regime)依存のスカラーをここに集約し、applyRegime() が領域プリセットの値を
// 書き込む。卓上(tabletop)プリセット = 下記の現値そのもの (f0_regime Part A の byte 再現契約)。
export const DYN = {
  g: 9.81,         // 重力加速度 (m/s²)。領域パラメータ (月/火星/スケール則で可変)。荷重 nF/nR・
                   // 横限界 muY·nF・縦限界 muX·nF が全て g 比例で支配比 Ay*=(v²/R)/(μg) の分母を成す。
  C0: 10.0,        // コーナリング剛性の基準 (m/s²/rad, 質量正規化)。無次元 Cα*=C0/(μ·g) で領域横断。
  // 横摩擦は「定常旋回の需要/限界 = ay/(μ·g)」(荷重配分は約分で消える) で決まる。
  // 到達可能な最大 ay は全舵全速で ≈1.74 m/s² → ノーマル 0.19 (限界1.86) はギリ滑らず、
  // ドリフト 0.13 (限界1.28) は全舵 u≈0.61 で滑り出す (旧モデルの PWM215 滑り出しに一致)。
  muY: 0.19,       // 横摩擦係数 (ノーマル車。×荷重×course.grip が横力上限)
  muYDrift: 0.13,  // 横摩擦係数 (ドリフト車 = 滑るタイヤ)
  muX: 0.75,       // 縦摩擦係数 (駆動/制動の軸上限。横より強い異方性)
  // ドリフト車の縦μ。全開の駆動需要 (2.5 m/s²) が後軸上限 (≈0.35×6.3=2.2) を超えて
  // 空転 → 摩擦楕円で横力がほぼゼロ → パワーオーバー/ドーナツ/ブレーキロックが創発する。
  // (現モデルの spin パラメータ=発進空転と同じ現象。加速がわずかに鈍るのも同じ)
  muXDrift: 0.35,
  hOverL: 0.35,    // 重心高/ホイールベース (前後荷重移動の強さ)
  // 摩擦円の双方向結合強度 (tire-3, Phase F2)。0=片方向(縦優先)=卓上スリップタイヤ(空転で横力喪失)、
  // 1=等方ラジアル=フルスケール実μ(combined-slip でグリップ限界)。領域パラメータ。卓上=0 で byte 不変。
  circleBi: 0,
  // ドリフト車の操舵上限の倍率 (I2)。1=実機 RumiCar 準拠 ±24° (卓上/中スケール=byte 不変)。
  // フルスケール領域だけ >1 にして「レーサー的な大舵角の逆ハン(カウンター)」を可能にする。
  // ノーマル車(Circuit Racer 等)には掛けない=競技レースの安定性(test_g2)に非影響。
  driftSteerMul: 1,
  // 車輪スリップ率/縦力 (tire-2, Phase F5)。wheelDyn=0 で車輪角速度ブロックを丸ごとスキップ → 従来の縦力
  // 瞬時クランプのまま = byte 完全不変 (卓上は 0、過去2度棄却 156/180 を領域ゲートで回避)。wheelDyn=1 で
  // 車輪面速度 vw=ωR を状態化し陽的 Euler 積分、スリップ率 s から縦版 Pacejka Fx=μx·n·sin(wheelC·atan(wheelB·s))。
  // wheelLambda=λ=m·R²/Iw (車輪応答の剛さ→adaptiveSub が剛性条件で nSub を増やす)、sPeak=ピークスリップ率、
  // driveBand=駆動比例帯 (卓上=0.06=従来レート)、wheelPower/launchAccel=fullscale 定出力ドライブトレイン。
  wheelDyn: 0, wheelLambda: 0, sPeak: 0, wheelB: 0, wheelC: 0,
  driveBand: 0.06, wheelPower: 0, launchAccel: 0,
  // 空力 (Phase F3)。抗力 ½ρ·Cd·A·u² (常時・縦に逆向き) とダウンフォース ½ρ·Cl·A·u² (荷重 nF/nR を v² 増)。
  // 質量正規化は各車の mass で割る (力 = 係数·u²/m, m/s²)。卓上は rho=0/A=0 で完全 no-op (byte 不変)。
  // フルスケール領域でのみ非ゼロ: ダウンフォースが μ·n の摩擦円半径を速度依存にし「速度=グリップ」が成立、
  // 抗力が推力=抗力の釣り合いで最高速を自然決定する (F2 の双方向円 circleBi=1 の上に乗る)。
  rho: 0,                 // 空気密度 (kg/m³)。卓上=0。フルスケール≈1.225。
  Cd: 0,                  // 抗力係数 (無次元)
  Cl: 0,                  // 揚力(ダウンフォース)係数 (無次元, 下向き正)
  frontalArea: 0,         // 前面投影面積 A (m²)。卓上=0 で空力ゼロ。
  downforceBalance: 0.5,  // ダウンフォースの前軸配分 (0..1, 残りが後軸)
  // タイヤ横力曲線のピーク+穏やか減衰 (簡易 Pacejka, tire-1, Phase F4)。alphaPeak = ピーク滑り角 (rad)、
  // kDecay = 減衰率。|α|≤alphaPeak はピーク横力 (摩擦楕円 fyMax) フル、|α|>alphaPeak で fyMax を
  // 1/(1+kDecay·(|α|−αpeak)) で穏やかに削る (ゼロには落とさない=崖でなく丘)。線形域 (小α) は fy=−C·tanα の
  // まま不変 → std/dyn byte 維持。スリップ角を物理域 (−π/2,π/2) に束縛し tan のラップ符号反転 (旧 stab-1) を
  // 構造解消したので旧 tanCap (=tanα の発散防止クランプ) は不要・削除。alphaPeak/kDecay は無次元 (角度比/率)
  // なので Froude スケール不変=領域パラメータ (卓上は落ち込み浅め=全速ドリフト保護、フルスケールは早期ピーク)。
  alphaPeak: 1.35, // ピーク滑り角 (rad)。領域パラメータ。卓上≈77° (normal 車の過渡角の上=崖に当てない)。
  kDecay: 0.50,    // ピーク超の減衰率 (大=深く落ちる)。領域パラメータ。卓上は浅く (β68→3 の既往退行を回避)。
  // kinFactor (実効舵角シム) のフェード強度 (kin-1, Phase F-kin)。1=シム全量 (卓上=操縦感/プログラム互換/
  // US/OS 教材パラメータを保持)、0=恒等 (フルスケール=US/OS を物理から創発させ kinFactor/steerK を撤去)。
  // 適用は連続ブレンド kinFactorEff=1+kinFade·(kinFactor−1) / steerKEff=1+kinFade·(steerK−1) (二値切替禁止
  // =境界で相似破れ以外の confound を作らない)。卓上=1 で従来式に厳密縮退 (byte 不変)。F2 circleBi 0→1 と
  // 同じ作法・同じ境界 (midscale=相似保持=1 / fullscale=相似破れ=0)。領域パラメータ。
  kinFade: 1,
  // 左右(横)荷重移動の強さ (Z2 / IMP-01)。旋回の横タイヤ力 ay が重心高×トレッドで外内輪へ荷重を移し、
  // タイヤ荷重感度 (load sensitivity: μ は荷重とともに目減りする非線形性) によって各軸の有効「横」グリップが
  // 目減りする。単軌道モデルは外内2輪を持たないので、外内輪の荷重感度和を解析的に畳んだ軸グリップ係数
  //   gmF = 1 − latLoadK·(φF·ay/nF)²  /  gmR = 1 − latLoadK·((1−φF)·ay/nR)²   (φF = 前軸静的荷重比 b/L)
  // を横容量 FyF/FyR に掛ける (導出: μ(Fz)=μ0(1−k·ΔFz/w) の外内輪和 = μ0·N·(1−k·(Δ/w)²) → 1−latLoadK·(T/N)²)。
  // latLoadK = 4·loadSens·(h/track)² (h=重心高/track=トレッド・無次元化=重心/トレッド/ホイールベース基準)。
  // 領域フェード: tabletop=0 (寄与ゼロ=恒等=byte 不変)、fullscale>0 (US/OS が荷重で創発)。前後荷重移動
  // (hOverL→nF/nR) で nF/nR が動くと gmF/gmR の相対目減りがずれ、トレイル制動でリア抜け・加速旋回で前抜け
  // 等の荷重連成 US/OS が出る。φF=静的比なので定常旋回は均等目減り (既存 fullscale ゲート Part F を保つ=
  // 効果はトレイル制動/複合荷重に自己集中)。学習側 ToF×3 不変 (D-1): nF/nR・ay は学習 API に晒さない。
  // 適用は連続 (gmF/gmR は latLoadK に滑らかで latLoadK→0 で恒等 1 へ縮退)・byte-skip は circleBi と同じガード。
  latLoadK: 0,
  uBlend0: 0.02,   // 合成速度これ未満は完全キネマティック
  uBlend1: 0.08,   // 合成速度これ以上は完全動力学 (間は線形ブレンド)
  nSub: 4,         // サブステップ数 (60Hz×4=240Hz: 低速の剛い横力に必要)。領域はスケールで増減。
  vlatStop: 2.5,   // 停止域での横速度の追加減衰 (1/s)。レートは √(g/L) でスケール。
  // 速度次元の数値床 (卓上 maxV=0.7 基準)。領域では特性速度 V=√(gL) 比で正規化する。
  absUFloor: 0.05, // スリップ角分母の最小 |u| (停止付近の特異点回避)
  uStop: 0.02,     // BRAKE 停止スナップしきい (|u| これ未満で u=0)
  uStopHard: 1e-4, // 非駆動時の完全停止しきい
  // 適応サブステップ: 横力陽的減衰の安定条件 (Cf+Cr)·h/|u| < subSafety を満たすよう nSub を増やす。
  // 卓上は固定 nSub=4 で既に安定 (k·h≈1.9<2) のため adaptiveSub=false で旧コードパス完全一致。
  // 高 C0 (フルスケール実μ) の領域で true にすると発散を自動回避する (stab-3)。
  adaptiveSub: false,
  subSafety: 1.6,  // 適応時の安全率 (k·h の上限)
};

// 駆動方式キー (型キー名 → fr/ff/awd)。AP22: physics_v2.js は従来 driveKeyOf として同一正規表現を
// 再実装していたが (physics_dyn.js を byte 不変に保つ旧方針の名残)、export して 2→1 統合した。
export function dynDriveKey(typeKey) {
  if (/_ff\b|_ff$/.test(typeKey)) return 'ff';
  if (/_awd\b|_awd$/.test(typeKey)) return 'awd';
  return 'fr';
}

// 領域(regime)プリセットを物理エンジンへ適用する (Phase F1)。DYN/CAR のスケール依存スカラーと
// 幾何の長さスケールを書き込む。引数は REGIMES のキー文字列か、scaleRegime() が返す領域オブジェクト。
// applyRegime('tabletop') は現値を書き戻すだけなので byte no-op (f0_regime Part A の退行ゼロ契約)。
// muRK/hOverL/subSafety は領域不変なので触らない (DYN_DRIVE/DYN の既定のまま)。alphaPeak/kDecay は
// 無次元だが領域パラメータ (卓上=落ち込み浅め/フルスケール=早期ピーク) なので書き込む。
export function applyRegime(nameOrObj) {
  const named = typeof nameOrObj === 'string';
  const r = named ? (REGIMES[nameOrObj] || REGIMES.tabletop) : (nameOrObj || REGIMES.tabletop);
  REGIME_STATE.active = named && REGIMES[nameOrObj] ? nameOrObj : (r.name || 'custom');
  // 重力・摩擦・コーナリング剛性 (DYN)
  DYN.g = r.g; DYN.C0 = r.C0;
  DYN.muY = r.muY; DYN.muYDrift = r.muYDrift; DYN.muX = r.muX; DYN.muXDrift = r.muXDrift;
  // 低速・数値系 (DYN)
  DYN.uBlend0 = r.uBlend0; DYN.uBlend1 = r.uBlend1; DYN.absUFloor = r.absUFloor;
  DYN.uStop = r.uStop; DYN.uStopHard = r.uStopHard; DYN.vlatStop = r.vlatStop;
  DYN.nSub = r.nSub; DYN.adaptiveSub = !!r.adaptiveSub;
  // 摩擦円双方向結合 (tire-3)。未定義の領域は 0 (片方向=卓上互換) にフォールバック。
  DYN.circleBi = r.circleBi || 0;
  // ドリフト車の操舵上限倍率 (I2)。未定義の領域は 1 (=±24° 実機準拠・卓上/中スケール byte 不変)。
  DYN.driftSteerMul = r.driftSteerMul || 1;
  // 車輪スリップ率/縦力 (tire-2, F5)。未定義の領域は 0 (車輪ブロックスキップ=卓上互換) にフォールバック。
  // driveBand のみ従来駆動レート 0.06 を既定にする (未定義領域でも従来挙動)。
  DYN.wheelDyn = r.wheelDyn || 0; DYN.wheelLambda = r.wheelLambda || 0;
  DYN.sPeak = r.sPeak || 0; DYN.wheelB = r.wheelB || 0; DYN.wheelC = r.wheelC || 0;
  DYN.driveBand = (r.driveBand != null) ? r.driveBand : 0.06;
  DYN.wheelPower = r.wheelPower || 0; DYN.launchAccel = r.launchAccel || 0;
  // 空力 (Phase F3)。未定義の領域は 0 (空力なし=卓上互換) にフォールバック。downforceBalance は
  // A=0 なら無効なので既定 0.5。
  DYN.rho = r.rho || 0; DYN.Cd = r.Cd || 0; DYN.Cl = r.Cl || 0;
  DYN.frontalArea = r.frontalArea || 0;
  DYN.downforceBalance = (r.downforceBalance != null) ? r.downforceBalance : 0.5;
  // タイヤ横力曲線の形状 (tire-1, F4)。未定義の領域は卓上既定にフォールバック (無次元なのでスケール不変)。
  DYN.alphaPeak = (r.alphaPeak != null) ? r.alphaPeak : 1.35;
  DYN.kDecay = (r.kDecay != null) ? r.kDecay : 0.50;
  // kinFactor フェード (F-kin)。未定義の領域は 1 (シム全量=卓上互換) にフォールバック。
  DYN.kinFade = (r.kinFade != null) ? r.kinFade : 1;
  // 左右(横)荷重移動 (Z2/IMP-01)。未定義の領域は 0 (寄与ゼロ=恒等=卓上/中スケール互換=byte 不変)。
  DYN.latLoadK = r.latLoadK || 0;
  // 速度・加速度系 (CAR)
  CAR.maxSpeed = r.maxSpeed; CAR.accel = r.accel; CAR.brake = r.brake;
  CAR.coast = r.coast; CAR.steerRate = r.steerRate;
  // 幾何の長さスケール (Ay* 不変のため特性速度 V と一緒に伸ばす)
  setRegimeScale(r.L / REGIMES.tabletop.L);
  // ToF 計測レンジも長さスケールに連動 (大きい世界では遠くまで見える)
  if (r.sensorMaxMm) SENSOR_RANGE.maxMm = r.sensorMaxMm;
  // 領域適用フック (Stage AO5): v2 エンジンの領域別較正 (applyRegimeV2) を単一 choke point から同期させる。
  // dynamic/standard は V2 holder を読まないので卓上既定 byte 不変 (フックは V2.* のみ書く)。
  for (const hook of REGIME_HOOKS) hook(r);
  return r;
}

export class DynCar {
  constructor(start) {
    this.type = CAR_TYPE_DEFAULT;
    this.reset(start);
  }
  profile() { return CAR_TYPE_BY_KEY[this.type] || CAR_TYPE_BY_KEY[CAR_TYPE_DEFAULT]; }

  reset(start) {
    this.x = start.x;         // 後輪軸中心 (m) — 互換公開面
    this.y = start.y;
    this.theta = start.theta;
    this.v = 0;               // HUD/既存コード互換 (= u を毎ステップ反映)
    this.u = 0;               // 車体前後速度
    this.vlat = 0;            // 車体横速度 (左+)
    this.r = 0;               // ヨーレート
    this.steer = CONST.CENTER;
    this.driveDir = CONST.FREE;
    this.pwm = 0;
    this.crashed = false;
    this.recoverT = 0;
    this.recoverSteer = CONST.CENTER;
    this.recoverN = 0; this.recoverX = 0; this.recoverY = 0; this.gaveUp = false; this.recoverCooldownT = 0; // Stage AK4/D5: 後退リカバリの袋小路ガード
    this.held = false; this.released = false; // Stage AK7: 発走の順次化(anti-pile-up)。前方に他車が居る間 held=発走保留・空けば released(ラッチ)
    this.slip = 0;            // 描画互換: 後軸の飽和度 0..1 (スモーク)
    this.slipSign = 1;
    this.steerAngle = 0;
    this.vwF = 0; this.vwR = 0;  // 車輪面速度 vw=ωR (前後軸, Phase F5)。wheelDyn=0 では死状態 (使われない)。
    this.downhill = (start && start.downhill) || 0;
    // 勾配の下り方向 (世界固定の fall-line 方位角 rad)。AP10: downhill を「常に車体+x」の
    // コンベアでなく世界方向ベクトルとして扱うための参照軸。既定 0 (=世界+x)。course.start.slopeDir
    // で上書き可 (未指定=0)。出荷峠は全て発走が +x 近傍のため既定 0 で発走方向≈下り方向になる
    // (峠ごとの方位・大きさの elev 較正は AP11 スコープ)。
    this.slopeDir = (start && start.slopeDir) || 0;
    this.grip = (start && start.grip) || 1;
    this._axPrev = 0;
    this._ayPrev = 0;  // 前ステップの横タイヤ力 (左右荷重移動 Z2 用・代数ループ回避。latLoadK=0 では未使用)
    this.trail = [{ x: this.x, y: this.y }];
  }

  // 速度状態を完全に止める (衝突取り消し等)。v だけでなく動力学状態も消す。
  halt() { this.v = 0; this.u = 0; this.vlat = 0; this.r = 0; this.vwF = 0; this.vwR = 0; }

  get delta() { return this.steerAngle; }
  get steerTarget() {
    // ドリフト車はフルスケール領域でのみ操舵上限を拡大 (I2)。卓上/中スケールは driftSteerMul=1 で ±24° 不変。
    const mx = CAR.maxSteer * (this.profile().drift ? DYN.driftSteerMul : 1);
    if (this.steer === CONST.LEFT) return mx;
    if (this.steer === CONST.RIGHT) return -mx;
    return 0;
  }

  step(dt) {
    if (this.crashed) { this.v = 0; this.u = 0; this.vlat = 0; this.r = 0; this.vwF = 0; this.vwR = 0; return; }
    let nSub = DYN.nSub;
    if (DYN.adaptiveSub) {
      // 横力陽的減衰の安定条件 (Cf+Cr)·h/|u| < subSafety を満たす最小 nSub を選ぶ (stab-3)。
      // 卓上は adaptiveSub=false で固定 nSub=4 (k·h≈1.9<2 で既に安定・byte 不変)。高 C0 を
      // 与える領域 (フルスケール実μ) では Cf+Cr が増え固定刻みだと陽的発散するので自動で刻む。
      const p = this.profile();
      const dk = DYN_DRIVE[dynDriveKey(p.key || this.type)] || DYN_DRIVE.fr;
      const Cf = DYN.C0 * dk.CfK, Cr = DYN.C0 * dk.CrK;
      const absU = Math.max(Math.abs(this.u), DYN.absUFloor);
      let need = Math.ceil((Cf + Cr) * dt / (DYN.subSafety * absU));
      // 車輪スリップ率 ODE の剛性条件 (tire-2, F5)。車輪時定数 1/(λ·∂Fx/∂vw) が h より速いと陽的発散するので
      // λ·(∂Fx/∂vw)·h < subSafety を満たす nSub を要求する (∂Fx/∂vw = μx·nMax·線形勾配/|u|, nMax はダウンフォース込)。
      // wheelDyn=0 (卓上/中スケール) はこのブロックに入らず、かつ adaptiveSub=false なので二重に無効 = byte 不変。
      if (DYN.wheelDyn) {
        const pr = this.profile();
        const muXcap = (pr.drift ? DYN.muXDrift : DYN.muX) * (this.grip || 1);
        const gxNorm = Math.sin(DYN.wheelC * Math.atan(DYN.wheelB * DYN.sPeak)) || 1;
        const slope = DYN.wheelC * DYN.wheelB / gxNorm;
        const nMax = DYN.g + (DYN.rho > 0 ? 0.5 * DYN.rho * DYN.frontalArea * DYN.Cl * this.u * this.u / (pr.mass || MASS_REF) : 0);
        const dFxdvw = muXcap * nMax * slope / absU;
        const needW = Math.ceil(DYN.wheelLambda * dFxdvw * dt / DYN.subSafety);
        need = Math.max(need, needW);
      }
      nSub = Math.max(DYN.nSub, Math.min(256, need));
    }
    const h = dt / nSub;
    for (let i = 0; i < nSub; i++) this._substep(h);
    this.v = this.u;
    this._recordTrail();
  }

  _substep(dt) {
    const p = this.profile();
    const dk = DYN_DRIVE[dynDriveKey(p.key || this.type)] || DYN_DRIVE.fr;
    const g = DYN.g, grip = this.grip || 1;
    const L = CAR.wheelBase;
    const a = dk.aFrac * L, b = L - a;   // CG→前軸 / CG→後軸
    const iz = a * b;                    // ヨー慣性 (Iz/m ≈ a·b の古典近似)
    const maxV = CAR.maxSpeed * p.maxSpeed;
    const drift = !!p.drift;             // ドリフト車 = 滑るタイヤ (横μ低・空転しやすい)
    const muY = (drift ? DYN.muYDrift : DYN.muY) * grip;
    const muX = (drift ? DYN.muXDrift : DYN.muX) * grip;
    const Cf = DYN.C0 * dk.CfK, Cr = DYN.C0 * dk.CrK;

    // --- 勾配重力の車体前方成分 (AP10) ---
    // downhill(=g·sinθ, m/s²) を世界固定の下り方向 slopeDir へ向くベクトルとみなし、車体前方へ射影する。
    // 旧実装は「常に車体+x」= 車の向きに依らず前方加速するコンベア (theta=π でも前進・登り不能) だった。
    // gFwd = downhill·cos(theta−slopeDir): 下り向き(theta=slopeDir)で+downhill、登り向き(θ=slopeDir±π)で−downhill。
    // downhill===0 (平地・全凍結シナリオ・全オラクルゲート) は gFwd=0 で以降の勾配項が完全 no-op = byte 不変。
    // AP22: 3エンジン同一式を config.gForward へ 3→1 統合 (純リファクタ・値不変=traceHash 不変)。
    const gFwd = gForward(this.downhill, this.theta, this.slopeDir);

    // --- 操舵サーボ (キネマティック版と同一: 3値→有限速度で実舵角へ) ---
    const tgt = this.steerTarget;
    const maxd = CAR.steerRate * dt;
    this.steerAngle += Math.max(-maxd, Math.min(maxd, tgt - this.steerAngle));

    // --- 縦方向の指令 (質量正規化 m/s²) ---
    const thr = this.driveDir === CONST.FORWARD ? this.pwm / 255 : 0; // アクセル開度 (kin と同義)
    let fDrive = 0;   // 駆動 (前後分配前)
    let fBrake = 0;   // 制動 (モーターブレーキ: 駆動輪のみ → split で分配)
    let coast = 0;    // 転がり抵抗 (全輪。軸配分せず直接 u̇ へ)
    const massK = (p.mass || MASS_REF) / MASS_REF;
    let desired = 0;
    if (this.driveDir === CONST.FORWARD || this.driveDir === CONST.REVERSE) {
      const sgn = this.driveDir === CONST.FORWARD ? 1 : -1;
      desired = sgn * (this.pwm / 255) * maxV;
      // 目標速度まで一定推力、近傍では比例 (現モデルのレート制限と同等の加速プロファイル)。
      // 卓上は driveBand=0.06・wheelPower=0 で従来式 CAR.accel·p.accel·clamp((desired−u)/0.06) に厳密縮退 (byte 不変)。
      // fullscale (wheelPower>0) は定出力ドライブトレイン: 低速はトルク律速 launchAccel·accel、高速は出力律速
      // wheelPower/|u|。これでローンチ時にトルク>グリップになり車輪が空転する (accel/muX は弄らない=空転は車輪慣性発)。
      const dBand = DYN.driveBand || 0.06;
      let aCap = CAR.accel * p.accel;
      if (DYN.wheelPower > 0) {
        const vKnee = Math.max(DYN.absUFloor, Math.abs(this.u));
        aCap = Math.min(DYN.launchAccel * p.accel, DYN.wheelPower / vKnee);
      }
      fDrive = aCap * Math.max(-1, Math.min(1, (desired - this.u) / dBand));
    } else if (this.driveDir === CONST.BRAKE) {
      const bk = CAR.brake * p.brake * grip / (1 + MASS.brake * (massK - 1));
      fBrake = -Math.sign(this.u) * bk;
      if (Math.abs(this.u) < DYN.uStop) { fBrake = 0; this.u = 0; } // 停止スナップ
    } else { // FREE: 惰行 (+ 勾配重力)
      if (gFwd === 0) {
        coast = -Math.sign(this.u) * Math.min(CAR.coast, Math.abs(this.u) / dt);   // 平地: 従来 (byte 不変)
      } else {
        // 勾配あり (AP10 defect③): 重力 gFwd と Coulomb 転がり抵抗 (速度を反転させない) を合成した正味縦 accel。
        // |gFwd|≤coast の緩斜面は uTent が抵抗内で相殺され静止保持 (u→0)、|gFwd|>coast で正味転動する。
        // gFwd=0 なら上の従来式に厳密一致 (min(coast,|u|/dt) と同値) ゆえ平地 byte 不変。
        const uTent = this.u + gFwd * dt;
        const resist = Math.min(CAR.coast * dt, Math.abs(uTent));
        coast = (uTent - Math.sign(uTent) * resist - this.u) / dt;
      }
    }

    // --- 実効舵角: kin の変調層 (yawGain/us/os/powerUs/liftOffOs/brakeOs/massUs) を
    //     入力側シムとして移植する。操縦感とプログラム互換は kin、限界挙動は動力学のまま。
    const sp = Math.min(1, Math.abs(this.u) / Math.max(0.05, maxV));
    const liftOff = sp > 0.25 && (this.driveDir !== CONST.FORWARD || desired < this.u - 0.02);
    const braking = this.driveDir === CONST.BRAKE && sp > 0.25;
    const massUs = MASS.us * (massK - 1);
    const usEff = p.us + p.powerUs * thr + Math.max(-0.3, massUs);
    const osEff = p.os + p.powerOs * thr + (liftOff ? p.liftOffOs : 0) + (braking ? p.brakeOs : 0);
    const spOver = Math.min(1.9, sp / grip);
    const kinFactor = (p.yawGain || 1) * (1 + osEff * spOver) / (1 + usEff * sp);
    // 領域フェード (F-kin): kinFactor と steerK を恒等(1)へ連続ブレンドする。卓上 kinFade=1 で
    // 従来式 (1+1·(x−1)=x) に厳密縮退=byte 不変、フルスケール kinFade=0 で恒等=US/OS を物理に委ねる。
    // 二値切替禁止のため if 分岐でなく線形ブレンド (F2 circleBi と同じ作法・同じ境界)。
    const kf = DYN.kinFade;
    const kinFactorEff = 1 + kf * (kinFactor - 1);
    const steerKEff = 1 + kf * ((dk.steerK || 1) - 1);
    // シムの増幅上限: ドリフト車は物理の舵角ロック (±maxSteer) まで — 増幅を無制限に許すと
    // 全開全舵で δ=37° 相当になりドリフト平衡を飛び越えてフルスピンする (実測)。
    // ノーマル車はグリップ内に収まる (μ が高く飽和しない) ため、シムを kin のヨー応答の
    // 等価表現として全量適用する (kin の FR は全舵時にロック以上に曲がるモデルのため)。
    // kinFade<1 では増幅が縮むため dCap は実質拘束しなくなる (恒等時 d=steerAngle≤maxSteer)。
    const dCap = CAR.maxSteer * (drift ? DYN.driftSteerMul : 1.6);
    const d = Math.max(-dCap, Math.min(dCap, this.steerAngle * steerKEff * kinFactorEff));

    // --- 空力 (Phase F3): 動圧 ½ρ·A·u² を質量正規化 (÷mass)。抗力は縦に逆向き常時、
    //     ダウンフォースは荷重 nF/nR を v² で増やす (摩擦円半径 μ·n が速度依存=「速度=グリップ」)。
    //     卓上は rho=0/A=0 でブロックを丸ごとスキップ → byte 完全不変 (f0_regime 指紋契約)。 ---
    const aero = DYN.rho > 0 && DYN.frontalArea > 0;
    let fDrag = 0, fDown = 0;
    if (aero) {
      const qA = 0.5 * DYN.rho * DYN.frontalArea * this.u * this.u / (p.mass || MASS_REF); // ½ρ·A·u²/m
      fDrag = DYN.Cd * qA;   // 抗力 (m/s², 進行と逆向き)
      fDown = DYN.Cl * qA;   // ダウンフォース (m/s², 荷重へ加算)
    }

    // --- 荷重 (前後移動つき, 質量正規化: n = g×静的配分 ∓ hOverL×ax) ---
    const axPrev = this._axPrev || 0; // 前ステップの前後加速度で荷重移動 (代数ループ回避)
    // 勾配ピッチ荷重 (AP10 defect④): 斜面の傾きで CG が幾何的に前後へ寄り、静的輪荷重が移る。
    // 下り(gFwd>0=前傾)で前軸 +gFwd·hOverL・後軸 −gFwd·hOverL (Σ保存)。タイヤ縦力の動的移動(axPrev)とは
    // 別の静的重力項。downhill===0 で gFwd=0 = +0 加算 = byte 不変。
    let nF = g * (b / L) - DYN.hOverL * axPrev + DYN.hOverL * gFwd;
    let nR = g * (a / L) + DYN.hOverL * axPrev - DYN.hOverL * gFwd;
    nF = Math.max(0.1 * g, nF); nR = Math.max(0.1 * g, nR);
    // ダウンフォースを前後配分で加算 (床クランプ後 = 常に load を増やす方向)。
    if (fDown > 0) { nF += fDown * DYN.downforceBalance; nR += fDown * (1 - DYN.downforceBalance); }

    // --- 軸ごとの縦力 (駆動配分+制動バイアス → 縦摩擦でキャップ = 空転/ロック) ---
    const fxFMax = muX * nF, fxRMax = muX * nR;
    let fxF, fxR;
    if (!DYN.wheelDyn) {
      // 卓上 (wheelDyn=0): 従来の「指令の瞬時クランプ」を一切変えずに通す (byte 完全不変)。
      fxF = (fDrive + fBrake) * dk.split[0];
      fxR = (fDrive + fBrake) * dk.split[1];
      fxF = Math.max(-fxFMax, Math.min(fxFMax, fxF));
      fxR = Math.max(-fxRMax, Math.min(fxRMax, fxR));
    } else {
      // フルスケール (wheelDyn>0, Phase F5): 車輪面速度 vw=ωR を陽的 Euler 積分し、スリップ率 s=(vw−u)/|u| から
      // 縦版 Pacejka 縦力 Fx=μx·n·gx(s) を導く。駆動指令 aCmd が縦容量を超えると車輪が空転 (s↑→ピーク超で gx<1
      // =空転損失=ローンチで全開がスルーレート制御に負ける母体)。制動で vw が落ち s→−1 で車輪ロック (横グリップ喪失)。
      // s を [−1, S_MAX] に束縛して vw をクランプ=発散防止。剛い ODE は step() の adaptiveSub が nSub を増やして吸収。
      const lam = DYN.wheelLambda, sPk = DYN.sPeak;
      const Bx = DYN.wheelB, Cx = DYN.wheelC;
      const gxNorm = Math.sin(Cx * Math.atan(Bx * sPk)) || 1;  // s=sPeak でピーク横軸 gx=1 に正規化
      const absUw = Math.max(Math.abs(this.u), DYN.absUFloor);
      const S_MAX = 2.0;  // 空転スリップ率上限 (車輪が地面の3倍速まで=発散防止の床/天井)
      const wheelStep = (vw, aCmd, fxMax) => {
        let s = (vw - this.u) / absUw;
        const sc = Math.max(-1, Math.min(S_MAX, s));
        const gx = Math.sin(Cx * Math.atan(Bx * sc)) / gxNorm;  // 縦版 Pacejka (ピーク→緩やか減衰)
        const Fx = Math.max(-fxMax, Math.min(fxMax, fxMax * gx));
        let vwNew = vw + lam * (aCmd - Fx) * dt;                // 車輪 ODE: dvw/dt = λ·(指令−路面反力)
        const vwLock = this.u - absUw, vwSpin = this.u + S_MAX * absUw;
        if (vwNew < vwLock) vwNew = vwLock;
        if (vwNew > vwSpin) vwNew = vwSpin;
        s = (vwNew - this.u) / absUw;
        return { Fx, vw: vwNew, s };
      };
      if (dk.split[0] > 0) {
        const wF = wheelStep(this.vwF, (fDrive + fBrake) * dk.split[0], fxFMax);
        this.vwF = wF.vw; fxF = wF.Fx; this._slipF = wF.s;
      } else { this.vwF = this.u; fxF = 0; this._slipF = 0; }  // 非駆動軸は地面同期 (スリップなし)
      if (dk.split[1] > 0) {
        const wR = wheelStep(this.vwR, (fDrive + fBrake) * dk.split[1], fxRMax);
        this.vwR = wR.vw; fxR = wR.Fx; this._slipR = wR.s;
      } else { this.vwR = this.u; fxR = 0; this._slipR = 0; }
      if (this.driveDir === CONST.BRAKE && this.u === 0) { this.vwF = 0; this.vwR = 0; } // 完全停止で車輪も止める
    }

    // --- タイヤ滑り角と横力 (F = -C·tanα を摩擦円で飽和) ---
    // スリップ角は |u| 基準 + sign(u)·δ で計算する。符号付き u をそのまま atan に入れると
    // u<0 (後退) で角度が鏡映され横力が全て逆向き=増幅 (アンチダンピング) になり、
    // 後退旋回が車種により逆回り・エネルギーが湧いて合成速度が車輪速上限の2倍に達する
    // (D4-B1 で実測した欠陥)。|u| 基準なら前進は従来と完全に同一で、後退も減衰になる。
    const absU = Math.max(Math.abs(this.u), DYN.absUFloor);
    const sgnU = this.u < 0 ? -1 : 1;
    // スリップ角を物理域 (−π/2, π/2) に束縛する (stab-1 構造解消, Phase F4)。旧モデルは af が ±π/2 を
    // 跨ぐと Math.tan(af) が符号反転し、大きさだけ見る tanCap クランプが前輪横力を発散方向に張り付かせた
    // (深い滑り角=spin/back-entry/donut で到達)。ALIM でクランプすると tan は単調増加・符号保存のまま
    // (|α|→大 で発散せず、深角でも復元方向を保つ)。旧 tanCap クランプは不要になり削除。
    const ALIM = Math.PI / 2 - 1e-3;
    const af = Math.max(-ALIM, Math.min(ALIM, Math.atan((this.vlat + a * this.r) / absU) - sgnU * d));
    const ar = Math.max(-ALIM, Math.min(ALIM, Math.atan((this.vlat - b * this.r) / absU)));
    let fyF = -Cf * Math.tan(af), fyR = -Cr * Math.tan(ar);
    const fyFd = fyF; const fyRd = fyR; // 飽和前の要求値 (slip 表示用)
    // 横軸の単独最大 (結合前)。muRK = 後軸グリップ比 (領域非依存パラメータ。<1 でリアが先に流れる)。
    let FyF = muY * nF, FyR = muY * (drift ? dk.muRK : 1) * nR;
    // --- 左右(横)荷重移動による軸グリップ目減り (Z2 / IMP-01) ---
    // 旋回の横タイヤ力 ayLat(前ステップ値=代数ループ回避) が重心高×トレッドで外内輪へ荷重を移し、タイヤ荷重
    // 感度で各軸の有効横グリップが gm=1−latLoadK·(φ·ayLat/n)² に目減りする (外内2輪を解析的に畳んだ係数)。
    // φF=前軸静的荷重比(b/L) なので定常旋回は前後均等目減り (Part F ゲート保持)。前後荷重移動(hOverL)で nF/nR が
    // 動くとき相対目減りがずれて荷重連成 US/OS が創発 (トレイル制動→nR↓→gmR↓=リア抜け 等)。下限クランプで
    // グリップ全壊(即スピン)を防ぐ。latLoadK=0(卓上/中スケール) はブロックスキップ=byte 不変 (circleBi と同型)。
    const latLoadK = DYN.latLoadK || 0;
    if (latLoadK > 0) {
      const ayLat = Math.abs(this._ayPrev || 0);   // 前ステップの横タイヤ力 (質量正規化)
      const phiF = b / L;                            // 前軸静的荷重比 (= ロール均衡 LLTD)
      const tF = phiF * ayLat, tR = (1 - phiF) * ayLat;
      // AK5/D14: 荷重分母の自己防衛フロア。nF/nR は上で 0.1*g(>0) に既にクランプ済ゆえ n→0 は到達不能で
      // tF/nF は有限=ここは厳密 no-op (nF≥0.981>1e-9 ⇒ max(nF,1e-9)==nF)。NaN隅(0/0)の保護を当ブロックへ
      // 局所化し、離れた箇所のフロアに暗黙依存しない (将来そのフロアが動いても 0/0→0 で NaN にしない)。
      const gmF = Math.max(0.5, 1 - latLoadK * (tF / Math.max(nF, 1e-9)) ** 2);
      const gmR = Math.max(0.5, 1 - latLoadK * (tR / Math.max(nR, 1e-9)) ** 2);
      FyF *= gmF; FyR *= gmR;
    }

    // --- 摩擦円の双方向結合 (tire-3, Phase F2) ---
    // 横荷重 (fy) を使った分だけ縦のグリップが残らない、という縦←横の結合を kappa で導入する。
    // (縦→横の結合は下の摩擦楕円 fyMax=Fy·√(1-(fx/Fx)²) が常に担う = 従来からの片方向)。
    //  kappa=0: 双方向ブロックを完全スキップ → 縦は単独クランプのまま = 片方向(縦優先)。卓上の
    //    スリップタイヤ (駆動輪が空転して横力が消える=パワーオーバー/ドーナツの母体) はこれが物理的に
    //    正しく、現モデルと byte 完全一致 (退行ゼロ契約)。
    //  kappa>0: 正規化空間 ξ=√((fx/Fx)²+(fy/Fy)²)>1 のとき縦力を s=1-κ+κ/ξ で削る (κ=1 で等方ラジアル
    //    1/ξ)。フルスケールの等方実μ (μx≈μy) で combined-slip によりグリップ限界へ達するタイヤはこれが
    //    正しく、横荷重が縦力を削って v²/R≤μg で横速度 vlat を再束縛する (sign-2=横 KE 過剰の解消母体)。
    //  0<κ<1 は連続ブレンド (領域横断で不連続帯を作らず「同じプログラムが領域でなぜ挙動が変わるか」の
    //    教育因果を濁さない)。ゼロ除算は stab-4 と同じく Fx/Fy>1e-9 でガード (μ=0 氷領域)。
    const kappa = DYN.circleBi || 0;
    if (kappa > 0) {
      if (fxFMax > 1e-9 && FyF > 1e-9) {
        const xiF = Math.hypot(fxF / fxFMax, Math.max(-FyF, Math.min(FyF, fyF)) / FyF);
        if (xiF > 1) fxF *= 1 - kappa + kappa / xiF;
      }
      if (fxRMax > 1e-9 && FyR > 1e-9) {
        const xiR = Math.hypot(fxR / fxRMax, Math.max(-FyR, Math.min(FyR, fyR)) / FyR);
        if (xiR > 1) fxR *= 1 - kappa + kappa / xiR;
      }
    }
    // 摩擦楕円 (縦→横): 縦力を使った分だけ横のグリップが残らない。縦力比はゼロ除算をガードする (stab-4)。
    // μ=0 (氷) 領域では fxFMax→0・fxF→0 で 0/0=NaN になるため分母ゼロ時は縦力ゼロ=横力フルで連続化する。
    const exF = fxFMax > 1e-9 ? (fxF / fxFMax) ** 2 : 0;
    const exR = fxRMax > 1e-9 ? (fxR / fxRMax) ** 2 : 0;
    let fyFMax = FyF * Math.sqrt(Math.max(0, 1 - exF));
    let fyRMax = FyR * Math.sqrt(Math.max(0, 1 - exR));
    // --- タイヤ限界曲線: ピーク+穏やか減衰 (簡易 Pacejka, tire-1, Phase F4) ---
    // 摩擦楕円が決めるピーク横力 (fyFMax/fyRMax = F2 の縦力で痩せた円半径) をそのまま「ピーク値」とし、
    // 滑り角が alphaPeak を超えた分だけエンベロープを 1/(1+kDecay·(|α|−αpeak)) で穏やかに痩せさせる。
    // |α|≤alphaPeak は減衰係数=1 (=従来のフラットクランプと同値 → 線形域 byte 不変)。|α|>alphaPeak で
    // ピークを単調に下回るがゼロには漸近しない (kDecay 有限) ので「穏やかな落ち込み」になる (崖でない)。
    // F2 の ξ 計算は飽和前の fyF/fyR を使うので、この減衰は下流=円半径側のみに作用し F2 双方向κ不変。
    const ap = DYN.alphaPeak, kd = DYN.kDecay;
    const aaf = Math.abs(af), aar = Math.abs(ar);
    if (aaf > ap) fyFMax /= 1 + kd * (aaf - ap);
    if (aar > ap) fyRMax /= 1 + kd * (aar - ap);
    fyF = Math.max(-fyFMax, Math.min(fyFMax, fyF));
    fyR = Math.max(-fyRMax, Math.min(fyRMax, fyR));
    this._fyFMax = fyFMax; this._fyRMax = fyRMax; // 診断用 (F5 Part G がロック時の横力崩壊を読む。物理非参加)
    // 摩擦円(楕円)使用率 (M2 / #18②): 各軸で (縦力/縦容量, 横demand/横容量) を楕円正規化したベクトル長
    // ξ=hypot(fx/fxMax, fyd/Fy)。ξ=1.0(=100%) でタイヤがグリップ限界。横は飽和前の demand (fyFd/fyRd=
    // -C·tanα) を使うので、滑り角が容量を超え滑走(スリップスモーク)する状況で 100% を超えて出る。直進低速の
    // 惰行では fx も demand も小さく ~0%。ゼロ除算は他の楕円計算 (stab-4) と同じく >1e-9 でガード (μ=0 氷)。
    // 読み取り専用診断 = 物理へ読み戻さない (_fyFMax と同じ作法・卓上 byte 不変)。
    const muUseF = Math.hypot(fxFMax > 1e-9 ? fxF / fxFMax : 0, FyF > 1e-9 ? fyFd / FyF : 0);
    const muUseR = Math.hypot(fxRMax > 1e-9 ? fxR / fxRMax : 0, FyR > 1e-9 ? fyRd / FyR : 0);
    this._muUseF = muUseF; this._muUseR = muUseR;

    // --- 運動方程式 (車体座標) ---
    // 前輪駆動/制動力の sinδ 成分は「タイヤが路面を横に押す力」なので横μでクランプする。
    // 異方性摩擦 (縦が強い) のまま全力を横へ投影すると FF が舵だけで spun する (実測した欠陥)。
    const cd = Math.cos(d), sd = Math.sin(d);
    const fxFLat = Math.max(-muY * nF, Math.min(muY * nF, fxF));
    let ax = fxF * cd - fyF * sd + fxR + coast + this.r * this.vlat;
    // 空力抗力 (Phase F3): 進行方向と逆向き常時。卓上は fDrag=0 で無影響。これが推力と釣り合う点で
    // 最高速が自然決定する (FREE の coast=転がり抵抗とは別に、駆動中も効く)。
    if (fDrag > 0) ax -= Math.sign(this.u) * fDrag;
    let ay = fyF * cd + fxFLat * sd + fyR - this.r * this.u;
    let rdot = (a * (fyF * cd + fxFLat * sd) - b * fyR) / iz;

    // 勾配重力を車体前方 accel へ (AP10: 世界方向射影 gFwd・登り=負値も有効)。駆動中(FORWARD/REVERSE)と
    // BRAKE 走行中はそのまま加算。BRAKE 静止はブレーキ保持で掛けない (坂で勝手に滑り出さない・現仕様踏襲)。
    // FREE は上の惰行ブロックで転がり抵抗と合成済 (coast に内包) ゆえここでは加えない (二重加算回避)。
    const driven = this.driveDir === CONST.FORWARD || this.driveDir === CONST.REVERSE;
    let gApplied = 0;
    if (gFwd !== 0 && this.driveDir !== CONST.FREE && (driven || Math.abs(this.u) > 1e-3)) gApplied = gFwd;
    ax += gApplied;

    this._axPrev = fxF * cd + fxR; // 前後荷重移動用 (タイヤ縦力のみ。重力成分は含めない)
    this._ayPrev = fyF * cd + fxFLat * sd + fyR; // 左右荷重移動用 (タイヤ横力。latLoadK=0 では未使用=byte 不変)

    // --- 積分 (セミインプリシット Euler) ---
    this.u += ax * dt;
    // 横方向積分: 前進指令は従来どおり陽的 Euler で forward byte 完全不変。後退指令
    // (driveDir===REVERSE) のみ横速度を半陰的化する (sign-1 後退連成の数値安定化)。
    // sign-1 欠陥の本体は「後退駆動で u と r が維持される旋回で Coriolis -r·u が横チャネル
    // vlat へ動力を注ぎ続け、タイヤ横力が摩擦楕円で飽和して復元が頭打ちになるため vlat が
    // 単調成長し、合成速度が車輪速上限の最大 226% (drift_awd) まで湧く」連成。
    // 線形横剛性 kLat=(Cf·cos²δ+Cr)/|u| による復元を陽的項から外して陰的に解き直す
    // (vlat=(vlat+dt·ayNoLat)/(1+dt·kLat)) ことで、摩擦楕円が閉じても復元が常にフル線形強度を
    // 保ち Coriolis に勝ち、vlat が物理的平衡 (cap≈100%) へ収束する (過渡もオーバーシュート無し)。
    // ゲートを u<0 でなく driveDir でかけるのは、前進指令のドリフト/ドーナツ (β>90° で瞬間的に
    // u<0 になる創発) を巻き込まず後退連成だけを狙い撃つため。新定数不要 (既存量から導出)。
    if (this.driveDir === CONST.REVERSE) {
      const kLat = (Cf * cd * cd + Cr) / absU;  // 横速度の線形減衰率 (1/s)
      const ayNoLat = ay - (fyF * cd + fyR);    // 横タイヤ力を除いた横加速度 (Coriolis + 前輪舵横分)
      this.vlat = (this.vlat + ayNoLat * dt) / (1 + kLat * dt);
    } else {
      this.vlat += ay * dt;
    }
    this.r += rdot * dt;

    // --- 低速キネマティックブレンド (停止付近の特異点回避) ---
    // 判定は合成速度 hypot(u,vlat)。|u| だけで判定すると、バックエントリー等の深い横向き
    // (u≈0 で vlat が大きい) の瞬間にブレンドが発動して滑り状態を破壊してしまう (実測した欠陥)。
    const spd = Math.hypot(this.u, this.vlat);
    const w = Math.max(0, Math.min(1, (spd - DYN.uBlend0) / (DYN.uBlend1 - DYN.uBlend0)));
    const rKin = (this.u / L) * Math.tan(d);
    const vlatKin = rKin * b; // キネマティック旋回では後輪軸の横速度=0 → CG では r·b
    this.r = w * this.r + (1 - w) * rKin;
    this.vlat = w * this.vlat + (1 - w) * vlatKin;
    // 完全停止スナップ (非駆動・停止近傍)。ただし FREE で勾配が転がり抵抗を超え正味転動する急坂 (gRoll) は
    // スナップしない (AP10 defect③: v2 の細かい substep では静止転動の微小増分が uStopHard 未満で毎回 0 へ
    // 潰され転動できないため)。downhill===0 では gFwd=0→gRoll=false で従来条件 (!driven) と同一 = byte 不変。
    const gRoll = this.driveDir === CONST.FREE && Math.abs(gFwd) > CAR.coast;
    if (Math.abs(this.u) < DYN.uStopHard && !driven && !gRoll) { this.u = 0; }
    if (this.u === 0 && Math.abs(this.vlat) > 0) this.vlat *= Math.max(0, 1 - DYN.vlatStop * dt);

    // --- 位置更新 (CG で積分 → 公開 x,y は後輪軸へ変換) ---
    const c = Math.cos(this.theta), s = Math.sin(this.theta);
    let cx = this.x + b * c, cy = this.y + b * s;
    cx += (this.u * c - this.vlat * s) * dt;
    cy += (this.u * s + this.vlat * c) * dt;
    this.theta += this.r * dt;
    this.x = cx - b * Math.cos(this.theta);
    this.y = cy - b * Math.sin(this.theta);

    // --- 描画用 slip (後軸の飽和度: 要求/上限。ドーナツやドリフト保持で 1 に張り付く) ---
    // 楕円が閉じ切った時 (空転/ロック中) は fyRMax≈0 — そのときこそ最大の滑りなので sat は大きく。
    const sat = fyRMax > 0.02 ? Math.abs(fyRd) / fyRMax : (Math.abs(fxR) > 0.1 ? 3 : 0);
    const slipNow = Math.max(0, Math.min(1, (sat - 0.85) / 0.6)) * w;
    this.slip += (slipNow - this.slip) * Math.min(1, 6 * dt); // 表示の平滑化
    if (Math.abs(ar) > 0.03) this.slipSign = ar > 0 ? 1 : -1;
  }

  _recordTrail() {
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(this.x - last.x, this.y - last.y) > 0.01) {
      this.trail.push({ x: this.x, y: this.y });
      while (this.trail.length > TRAIL.max) this.trail.shift();
    }
  }

  corners() {
    const c = Math.cos(this.theta), s = Math.sin(this.theta);
    const front = CAR.length - CAR.rearToBack;
    const back = -CAR.rearToBack;
    const hw = CAR.width / 2;
    const pts = [
      { x: front, y: hw }, { x: front, y: -hw },
      { x: back, y: -hw }, { x: back, y: hw },
    ];
    return pts.map(p => ({ x: this.x + p.x * c - p.y * s, y: this.y + p.x * s + p.y * c }));
  }
}
