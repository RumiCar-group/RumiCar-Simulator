// RumiCar Simulator — 共有設定・定数
// すべての調整可能パラメータをここに集約する。

// アプリのバージョン (ヘッダーのバッジ・起動ログに表示する単一ソース)。
export const APP_VERSION = 'v8.1.1';

// 変更履歴 (CHANGELOG) は **`./changelog.js` に分離**した (Stage AS2)。表示専用のデータ塊で
// 起動のコース初描画には使わないのに、critical path 上の本ファイル (ほぼ全モジュールが import)
// に同居していたため全利用者が起動のたびに 124KB を読まされていた。版を上げたら
// `changelog.js` の先頭へ 1 行追加する (先頭の版 === APP_VERSION は wf_version_check.mjs が機械検査)。

export const CONST = {
  // 操舵 (RumiCar API)
  LEFT: 0, CENTER: 1, RIGHT: 2,
  // 走行 (RumiCar API)
  FREE: 0, REVERSE: 1, FORWARD: 2, BRAKE: 3,
  // 測距の方向。BACK は任意装備の後方センサー (実機は I2C アドレス確保済・物理追加可能)。
  BACK: 3,
  // 車輪エンコーダ (任意装備) の対象車軸。RC_wheel_speed(FRONT/REAR) で前/後軸の車輪面速度[m/s]を読む。
  // 競技(フルスケール)領域でトラクション制御/ABS を書くための信号。実機は車輪エンコーダで追加可能。
  FRONT: 0, REAR: 1,
};

export const CAR = {
  length: 0.19,        // m (車体長 / 衝突ボックス)
  width: 0.08,         // m (車体幅)
  wheelBase: 0.13,     // m (前軸〜後軸)
  rearToBack: 0.03,    // m (後輪軸中心から車体後端まで)
  maxSteer: 24 * Math.PI / 180, // rad (最大操舵角)
  // 操舵サーボの動作速度 (rad/s)。瞬時ではなく有限速度で目標舵角へ動く。
  // これにより 3値操舵を小刻みにオン/オフ (デューティ制御) すると、車体が平均値で
  // ローパスされ「実効的な中間舵角」が得られる (Step2)。中立↔全開(24°)を約0.06秒で移動。
  steerRate: 7.0,      // rad/s
  maxSpeed: 0.7,       // m/s (pwm=255 相当の最高速)
  accel: 2.5,          // m/s^2 (加速)
  brake: 4.0,          // m/s^2 (制動: BRAKE)
  coast: 1.2,          // m/s^2 (惰性減速: FREE。転がり抵抗のみでゆっくり落ちる)
};

// 速度の「相対補正表示」。物理は卓上スケール (実寸 cm) なので計算上の km/h は小さく人間の感覚と
// 合わない。そこで表示用に、車の最高速 (CAR.maxSpeed) に対する割合を、実車の代表的な最高速へ写像する。
//   サーキット ≒ 350 km/h / 峠 ≒ 180 km/h を満タン (全開) の目安とする。
// ※ あくまで体感に近づける表示専用の係数で、物理モデル・判定・テストには一切影響しない。
export const SPEED_DISPLAY = { circuit: 350, touge: 180 };
export function displayKmh(v, course) {
  // フルスケール領域 (realKmh) は物理的に実速度が出るので m/s×3.6 を直接表示する (没入写像なし)。
  // 卓上/中スケールは従来どおり「最高速比×topKmh」の没入写像 (実速度は cm/s 級で体感と合わないため)。
  const reg = REGIMES[REGIME_STATE.active];
  if (reg && reg.realKmh) return Math.abs(v) * 3.6;
  const ref = (course && course.topKmh) || (course && course.touge ? SPEED_DISPLAY.touge : SPEED_DISPLAY.circuit);
  return Math.abs(v) / CAR.maxSpeed * ref;
}

// 勾配重力の車体前方成分 (AP10・世界方向射影)。downhill(=g·sinθ, m/s²) を世界固定の下り方向 slopeDir
// へ向くベクトルとみなし車体前方へ射影する (gFwd = downhill·cos(theta−slopeDir))。下り向き(theta=slopeDir)
// で +downhill・登り向き(theta=slopeDir±π)で −downhill。downhill===0 (平地・全凍結シナリオ・全オラクル
// ゲート) は 0 を返し、以降の勾配項が完全 no-op = byte 不変。**3エンジン共通** (physics.js/physics_dyn.js/
// physics_v2.js)＝AP22 で 3箇所の同一式を 1 実装へ統合 (純リファクタ・traceHash 不変)。呼び側の FREE 静止
// 転動・勾配ピッチ荷重の扱いはエンジンごとに異なる (std=簡易/dyn=two-track/v2=substep・意図的差異) ため
// 統合せず各エンジンに残す (誤統合防止・決定ログ AP-22)。
export function gForward(downhill, theta, slopeDir) {
  return gPlane(downhill, 0, theta, slopeDir, _gpScratch).fwd;
}

// ── 面内重力の2軸射影 (Stage AS10・AP10 の gForward を「ベクトルの完全射影」へ是正) ──────────
// **AP10 の欠陥 (AS10 着手前ゲートで実測)**: 面内重力を slopeDir 方向のベクトルとみなしながら、車体
// **前方成分しか適用していなかった** (`downhill·sin(θ−slopeDir)` がどこにも入っていない = 33 箇所の
// slopeDir 参照のうち Math.sin を使う行は 0 だった)。峠の実走では θ と slopeDir が最大 80° 開き、
// 落としていた横成分は **最大 1.47 m/s²** = 卓上で到達できる横加速度 ay≈1.63 と同オーダーの一次項。
// AS10 で 2 軸へ正しく射影する (利用者裁定 2026-08-05・版 MAJOR)。
//   面内重力ベクトル = downhill·(slopeDir 方向) + gLat·(slopeDir の左 90° 方向)
//   δ = θ − slopeDir とおくと   fwd  = downhill·cos δ + gLat·sin δ
//                              left = gLat·cos δ − downhill·sin δ      (車体 +y = 左・vlat と同符号)
// **gLat===0 のとき fwd は AP10 と同一式・同一 double** (guarded ternary) ゆえ前方挙動は byte 不変。
// **downhill===0 && gLat===0 (平地・全凍結 f0〜f3・正準レース・全オラクルゲート) は早期 return で
// 完全 no-op** = byte 不変。**3エンジン共通** (physics.js は fwd のみ消費 = 横自由度 vlat を持たない
// スカラー速度モデルゆえ横重力を表現できない・AS10 ④' で非対象と明記)。
// out は呼び側が持つスクラッチ (毎サブステップの割当を避ける・AP12 の巻き上げと同趣旨)。
export function gPlane(downhill, gLat, theta, slopeDir, out) {
  if (downhill === 0 && gLat === 0) { out.fwd = 0; out.left = 0; return out; }
  const d = theta - slopeDir, c = Math.cos(d), s = Math.sin(d);
  out.fwd = gLat !== 0 ? downhill * c + gLat * s : downhill * c;   // gLat=0 は AP10 と厳密同一
  out.left = gLat !== 0 ? gLat * c - downhill * s : -(downhill * s);
  return out;
}
const _gpScratch = { fwd: 0, left: 0 };

// 路面法線方向の重力成分 (Stage AS10)。重力の大きさは g で一定なので、面内成分 gIn=hypot(downhill,gLat)
// を取り出したぶん法線成分は gN=√(g²−gIn²) へ減る。**AP10 までは法線に g をそのまま使いながら面内へ
// downhill を足していた** ため、モデルが持つ重力の大きさが √(g²+downhill²) となり峠③で **+1.16% の
// 「無から生まれた重力」** になっていた (AS10 着手前ゲートの実測)。面内成分ゼロ (平地) は g をそのまま
// 返す guarded branch = byte 不変 (√(g²−0) は double で g と一致するとは限らないため式に入れない)。
export function gNormal(g, downhill, gLat) {
  const gin2 = downhill * downhill + gLat * gLat;
  return gin2 > 0 ? Math.sqrt(Math.max(0, g * g - gin2)) : g;
}

// カント (横勾配・スーパーエレベーション) の道追従プロファイル (Stage AS10)。
// `course.bank` [度] は **そのコースの最急コーナーでのバンク角**で、他の地点は局所曲率に線形比例する
// (|κ|/κmax)。これは道路設計のスーパーエレベーション則 e ∝ v²·κ/g (設計速度一定) そのもので、新しい
// 定数を1つも導入しない。符号: 正のバンク = 路面が**カーブ外側へ持ち上がる** ⇒ 面内重力は**内側**を向く
// (旋回を助ける)。負値 = 逆バンク (逆勾配)。左旋回 (符号付き曲率 κ=dθ/ds>0) の内側は左なので、
// gLat = g·sin(bank)·(κ/κmax) が「左が正」の符号規約とそのまま一致する。
// **進行方向に依らない**: 逆走すると接線が反転して「左」も反転するが 符号付き曲率も反転するため、
// 積 (= 世界系のバンク方向) は不変 = 実在のバンクと同じ性質。
export function gLatOf(g, bankDeg, kappaNorm) {
  return bankDeg !== 0 ? g * Math.sin(bankDeg * Math.PI / 180) * kappaNorm : 0;
}

// センサー (車体前部・tof_1 基準。URDF 準拠)
// CENTER 正面, LEFT +65°, RIGHT -65°
export const SENSORS = [
  { name: 'LEFT',   idx: 0, dx: 0.130, dy: 0.018, yaw:  65 * Math.PI / 180 },
  { name: 'CENTER', idx: 1, dx: 0.135, dy: 0.000, yaw:  0 },
  { name: 'RIGHT',  idx: 2, dx: 0.130, dy: -0.018, yaw: -65 * Math.PI / 180 },
];
// 任意装備の後方センサー (既定OFF=前方3つのみで実機 faithful。ONで追走車の察知などに使える)。
// 後輪軸より少し後ろから真後ろ(yaw=180°)を見る。
export const SENSOR_REAR = { name: 'BACK', idx: 3, dx: -0.045, dy: 0.0, yaw: Math.PI };
// 計測レンジ上限 (mm)。Phase F1: 領域の長さスケールに連動するため可変ホルダーにした
// (applyRegime が SENSOR_RANGE.maxMm を書き換える。卓上=2000mm)。
export const SENSOR_RANGE = { maxMm: 2000 };

// VL53L0X 相当の視野コーン (Stage AM1・#27 根治)。全角 25°(半角 12.5°)。測距は中心1本の
// 「太さゼロ直線レイ」でなく扇内の最近反射面 (geom.coneNearest) を返す=端点掠め貫通を原理的に排除。
// 視野角は角度量ゆえレジーム(卓上/フルスケール)で不変 (スケール不変)=領域スケールしない。
const SENSOR_FOV_HALF = 12.5 * Math.PI / 180;
export const SENSOR_FOV = { halfRad: SENSOR_FOV_HALF, cosHalf: Math.cos(SENSOR_FOV_HALF), sinHalf: Math.sin(SENSOR_FOV_HALF) };

// 実機(VL53L0X)相当のセンサー外乱モデル (M1, #18①)。既定 OFF=従来経路 (sensors.js が乱数を一切呼ばない=
// 卓上 byte 不変)。ON で readSensor が有効測距値に「距離依存ガウスノイズ + 確率的欠測(範囲外コード)」を注入する。
// 注入は表示(レイ/距離ラベル)だけでなく api.js 経由で学習プログラムが読む値にも効く=頑健性を試せる。
// 学習側 ToF×3 方針(D-1)は不変: センサーは増やさず、既存 ToF の値を実機的に劣化させるだけ。
export const SENSOR_NOISE = {
  on: false,        // 既定 OFF。ON のときのみ乱数注入 (OFF は従来の決定論経路に厳密縮退=byte 不変)。
  sigmaBaseMm: 8,   // 近距離での測距ノイズ標準偏差 (mm)。VL53L0X の典型 ±数mm 相当。
  sigmaFrac: 0.02,  // 距離比例のノイズ成分 (σ += sigmaFrac × 測距mm)。遠いほど荒れる。
  dropout: 0.03,    // 1計測あたりの欠測(タイムアウト)確率。欠測時は範囲外コード(-3)を返す=実機の無効測距。
  // AP19 (opt-in ②・外れ値/距離依存欠測/他車反射率)。**出荷既定は全て中立 (0 / 倍率1)** = 従来経路
  //   (ガウス+距離非依存 dropout) へ厳密縮退し、追加の乱数を一切消費しない = 卓上 byte 不変 (受け入れ①)。
  //   ON の実効値は main.js の optNoise トグルが「実機相当プリセット」として与える (config 既定は byte 基準線)。
  outlier: 0,        // spurious 外れ値の発生確率/計測。実機 VL53L0X のクロストーク/2次反射で稀に真距離と無相関な
                     //   値を返す現象。発火時は [outlierMinMm, 測距レンジ] の一様乱数で mm を差し替える (CONF 信頼
                     //   区間ゲートが実際に発火し得る=samples の CONF 教材を演習可能に)。0=無効=Math.random 短絡で非消費。
  outlierMinMm: 20,  // spurious 値の下限 [mm] (上限は SENSOR_RANGE.maxMm)。
  dropoutFar: 0,     // 距離依存欠測の傾き [/m]。実効欠測率 = dropout + dropoutFar × 測距[m] (0=距離非依存=従来)。
                     //   実機 ToF は遠距離ほど信号品質が落ち欠測が増える。dropout=0 でも遠方だけ欠ける挙動を作れる。
  carSigmaMul: 1,    // 他車の車体エッジを標的にしたときの σ 倍率 (低反射率=荒れる)。1=中立 (壁と同じ精度)。
                     //   混走で「他車までの距離だけ荒れる」実機挙動を模す。壁標的読には影響しない (×1)。
};

// 実機(VL53L0X)相当の ToF 光学モデル = 反射率/材質・入射角・標的サイズ・扇内の混入反射(マルチパス)・
// カバーガラス由来のクロストーク (Stage AS8)。**既定 OFF = sensors.js が本ブロックへ入らない**=
// 従来の「扇内最近反射面」(AM1) へ厳密縮退する (追加計算ゼロ・乱数ゼロ=卓上 byte 不変)。
// SENSOR_NOISE (確率的) と違い本モデルは**決定論**(乱数を一切呼ばない)=同一入力→同一出力ゆえ、
// 「実機の系統誤差」と「実機のばらつき」を独立に演習できる。公式レースは強制 OFF (race_engine.js)。
//
// **一次情報**(実機 RumiCar が実際に使うライブラリと頒布元の公開記述。全文と引用は docs/stage_as/AS8_tof.md §1):
//   ・上流 `ArduinoAndESP32/Libraries/RumiCar/RumiCar.cpp:74-86` = `LONG_RANGE` 定義時のみ
//     `setSignalRateLimit(0.1)` を呼ぶ (**既定 0.25 MCPS**)。`RumiCar.h:81` で既定はコメントアウト=OFF。
//   ・Pololu VL53L0X ライブラリ: `setSignalRateLimit` は「**標的から反射して受信される信号の最小振幅**。
//     有効な読みを報告するために必要。下げるとレンジは伸びるが、**意図した標的以外からの反射**で
//     不正確になりやすい」。RumiCar.h:76-80 の注記も同旨 (「暗所で最良」)。
//   ・Pololu 製品ページ (VL53L0X carrier): 「最大 2m まで測距」「**有効レンジと精度は、周囲条件および
//     反射率やサイズといった標的の性質、センサー設定に大きく依存する**」「ToF ゆえ**距離値そのものは
//     反射率に大きく左右されない**」。
//   ⇒ ∴ 実機で反射率が効くのは**距離値のバイアスではなく「有効レンジ(=有効/無効の境目)」**である。
//     本モデルはこれに厳密に従う (反射率は信号レート S にだけ入り、単一標的の距離値を歪めない)。
//
// **モデル** (導出は docs/physics_model.md §12「光学モデル」): Lambertian な拡張標的では受光電力は
//   S ∝ ρ·cosθ / d²。公称レンジ maxMm がちょうど信号しきい値になるよう正規化して S=(ρ·cosθ)·(maxM/d)²
//   と置くと、有効レンジは **d_max(ρ,θ) = maxMm·√(ρ·cosθ)** となる (無次元=領域スケール不変)。
//   扇は rays 本の方向へ離散化し、方向ごとの最近面から S_k を作って平均 S̄ を取る (=標的が扇の一部しか
//   占めなければ S̄ が下がる ⇒ 「標的サイズ」依存が自動的に出る)。S̄<1 で低信号=無効測距 (-3)。
export const SENSOR_OPTICS = {
  on: false,         // 既定 OFF。ON のときだけ光学モデルで測距する (OFF は AM1 の扇内最近へ厳密縮退=byte 不変)。
  rays: 33,          // 扇 (25°) の角度離散化本数。**33 の根拠は実測**: 中立設定 (下記の縮退) で ON の測距が
                     //   OFF (解析的な扇内最近) と食い違う量の最大が rays=9 で 20mm・**33 で 5mm**・513 で 1mm
                     //   (全41コース×24姿勢・wf_as8_optics.mjs A1)。**5mm は実機の測距ノイズ σ=8mm
                     //   (SENSOR_NOISE.sigmaBaseMm) を下回る**ので離散化がモデルの主要誤差にならない。
  wallRefl: 1.0,     // 壁の相対反射率。**1.0 = 基準標的**=「この反射率・正対で公称レンジ maxMm がちょうど
                     //   成立する」明るい標的。出荷コースの壁は白い板を想定してこれを基準に置く (=正対の壁は
                     //   従来どおり公称レンジまで見える)。暗い壁を模すなら下げる (0.5 で有効レンジ ×0.71)。
  carRefl: 0.35,     // 他車ボディの相対反射率 (塗装プラスチック=基準標的より暗い)。有効レンジは ×√0.35=0.59 倍。
                     //   **モデルパラメータであって公称スペックの引用ではない** (AS8_tof.md §1 に明記)。
  incidence: true,   // 斜め入射で信号が cosθ 倍になる (Lambertian の導出どおり)。壁沿い走行で外側センサーが
                     //   壁を掠める向きでは有効レンジが大きく縮む=実機で最も効く効果。
  multipath: true,   // 扇内に複数の反射面があるとき信号加重で混合する (mixed pixel=「意図した標的以外からの
                     //   反射」)。false なら最強信号の1面だけを見る。
  xtalk: 0.02,       // カバーガラス由来のクロストーク信号 (基準信号=1 に対する比)。距離0の寄生信号として
                     //   混ざるので、**弱信号=遠方ほど距離が短側へ寄る**系統誤差になる (実機は工場/ユーザー
                     //   較正で補償するが Pololu ライブラリは既定で較正しない)。0=無効。
};

// 実機(VL53L0X)相当のセンサー更新レート/レイテンシ = sample-and-hold (AP18・#18① D1)。既定 OFF=
// 従来経路 (api.js が tick 世代キャッシュのみ=AP5 の挙動に厳密縮退=byte 不変・乱数非消費)。ON で
// api.js の測距キャッシュ鍵が「直近サンプルからの経過時間」に切り替わり、1計測に一定時間を要する実機を
// 模して 1/hz 秒経過するまで前回の測距値を「保持」する。実機 VL53L0X は 1 計測に 20-33ms を要し
// (レート ~30-50Hz)、理想センサー (レイテンシ0・レート無制限) との最大の構造差。保持により
//  (a) 同一保持窓内は分散0 (b) 1 反復内に何度読んでも同一値 = 多数回読み平均でノイズσを縮める
//     エクスプロイト (実測 ×9.8 縮小) が同時に閉じる。学習側 ToF×3 方針(D-1)は不変=センサーは増やさず
//     既存 ToF の「更新の遅さ」を実機的に付与するだけ。公式レースは決定論ゆえ強制 OFF (race_engine.js)。
export const SENSOR_HOLD = {
  on: false,        // 既定 OFF。ON のときのみ sample-and-hold (OFF は AP5 の tick 世代キャッシュに厳密縮退=byte 不変)。
  hz: 30,           // センサー更新レート [Hz]。実機 VL53L0X 既定 (~30Hz=33ms 積分) 相当。更新間隔[物理tick]=round(physicsHz/hz)。
};

// 描画
export const VIEW = {
  pxPerM: 280,         // m → px (基準スケール。大きなコースは setView がこれ以下へ自動縮小=フィット)
  maxCanvasPx: 2400,   // キャンバス最大辺[px]。これを超える大コース(フルスケール競技グラウンド 200m 等)は
                       //   pxPerM を下げて収める。既存コースは最大 7.99m (架空峠激坂→2237px) なので全て 280 のまま不変。
  bg: '#d9d9d9',       // 背景 (明るいグレー)
  wall: '#e0a878',     // 壁: 淡い暖色 (ソフトなアプリコット)。怖くない優しい色
  wallWidth: 5,
  ray: '#ff3030',
  trail: '#36d36b',
  // レーシングカー描画
  carBody: '#e2202a',     // ボディ主色
  carBody2: '#8d1117',    // ボディ陰 (グラデーション)
  carAccent: '#f4f4f4',   // センターストライプ
  carCanopy: '#16243c',   // コックピット
  carWing: '#232323',     // 前後ウイング
  carWheel: '#161616',    // タイヤ
  carCrash: '#ff7a7a',    // 衝突時
  meter: '#1fa85a',
  finish: '#2244ff',     // フィニッシュライン
  finishAlt: '#ffffff',  // フィニッシュライン (チェッカー)
  grid: 'rgba(0,0,0,0.10)',
  editGhost: '#0a84ff',  // 編集中の壁プレビュー
  carScale: 1,           // 車体スケール (コースに対する車の大きさ比率)。setCarScale で変更
};

// 車体スケール: コースと車両の比率を利用者が変更できるようにする。
// 車体の物理寸法 (全長/全幅/ホイールベース/後端) とセンサー取付位置、描画サイズを
// 同じ倍率 k で拡縮する (速度 m/s・操舵角・センサーレンジは実値なので据置)。
// CAR / SENSORS は各モジュールが参照で共有しているため、フィールドを書き換えれば全体に反映される。
const CAR_BASE = { length: CAR.length, width: CAR.width, wheelBase: CAR.wheelBase, rearToBack: CAR.rearToBack };
// 衝突フットプリント（設計/k=1 単位）= physics.Car.corners() が成す矩形。描画スプライト(car_sprite.js)を
// この中へ写像して「描画 ⊆ 衝突矩形」を保証する（Stage AH・GitHub #26）。CAR_BASE 由来で carScale に依らず不変。
export const CAR_FOOTPRINT = { back: -CAR_BASE.rearToBack, front: CAR_BASE.length - CAR_BASE.rearToBack, hw: CAR_BASE.width / 2 };
const SENSOR_BASE = SENSORS.map(s => ({ dx: s.dx, dy: s.dy }));
// 実効スケール = 領域の長さ倍率 (regimeK = regime.L/卓上L) × ユーザーの carScale スライダー (userK)。
// Phase F1 で領域を一級化したため2軸に分離した。既定 1×1 は従来の geometry×1 と byte 完全一致。
// AK2/D10: 公式レースエンジン (race_engine.runRace) が userK を退避→既定固定→復元するため export する
// (SENSOR_NOISE/REGIME_STATE と同型の「退避対象 live state」)。既定値・挙動は不変 = byte 不変。
export const SCALE_STATE = { regimeK: 1, userK: 1 };
function _applyScale() {
  const k = SCALE_STATE.regimeK * SCALE_STATE.userK;
  CAR.length = CAR_BASE.length * k;
  CAR.width = CAR_BASE.width * k;
  CAR.wheelBase = CAR_BASE.wheelBase * k;
  CAR.rearToBack = CAR_BASE.rearToBack * k;
  SENSORS.forEach((sd, i) => { sd.dx = SENSOR_BASE[i].dx * k; sd.dy = SENSOR_BASE[i].dy * k; });
  VIEW.carScale = k;
  return k;
}
export function setCarScale(s) {
  // 上限 4: 大コース (例フルスケール競技グラウンド 200×100m) で車体が小さすぎる問題 (#19④b) 用に
  // 拡大。卓上既定 (UI 0.8) / ベンチ母集団 (userK=1) は不変で byte 不変。
  SCALE_STATE.userK = Math.max(0.4, Math.min(4, Number(s) || 1));
  _applyScale();
  return SCALE_STATE.userK; // UI 表示はユーザー倍率を返す (従来互換)
}
// 領域の長さスケール (= regime.L / 卓上 L)。動的相似で幾何 (wheelBase 等) を V と一緒に伸ばす。
// ユーザーの carScale スライダーと合成される (実効 = regimeK×userK)。
export function setRegimeScale(kL) {
  SCALE_STATE.regimeK = Math.max(0.05, Number(kL) || 1);
  return _applyScale();
}

// 複数台同時走行: 車両ごとの識別色 (最大台数 = 配列長)。
export const FLEET = {
  colors: ['#e2202a', '#2a7fff', '#28c76f', '#f4b400', '#a259ff', '#ff7ac2'],
  names: ['A', 'B', 'C', 'D', 'E', 'F'],
  maxCars: 6,
  // グリッドスタート配置 (スタートライン後方へ縦一列)。他車を障害物扱いするので
  // 発進時に張り付かないよう前後間隔は車体長(0.19m)より十分大きく取る。狭いコースでも
  // 横並びで競合しないよう左右ずれ(gridLateral)は小さめ。
  gridBack: 0.30,    // m: 1 台ごとの後方間隔
  gridLateral: 0.10, // m: 左右の僅かなジグザグ量
  gridFront: 0.16,   // m: 1 台目をラインからどれだけ後方に置くか
};

// 色覚セーフ配色 (AF4 / GitHub #26②): 既定 OFF = 従来描画と完全一致 (VIEW/FLEET の既定は不変)。
// ON のときだけ描画系が参照する可変フラグ (SENSOR_NOISE.on と同型のホルダー)。物理・学習・レース
// 計算には一切関与しない (描画専用)。色だけに依存しないよう、ON では破線/マーカ形状の冗長コーディング
// も併用する (レイ=破線・ヒット点=四角・状態テキストは元々語で区別)。
export const A11Y = { cvdSafe: false };
// Okabe–Ito 由来の色覚安全な定性パレット。既定 FLEET.colors の赤(#e2202a)と緑(#28c76f) は
// 1型/2型色覚 (赤緑) で混同しやすいが、本パレットは相互に判別しやすい (青/橙/緑(青寄)/桃/空/朱)。
// ON 時のみ描画層が各車色とテレメトリ色をここへ写像する (既定 OFF では一切参照しない)。
export const CVD = {
  fleet: ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#d55e00'],
  run:   '#0072b2',   // 走行中テレメトリ (既定の緑 #6fe39a に代えて青)
  crash: '#d55e00',   // クラッシュ (既定の赤 #ff6b6b に代えて朱)
  lap:   '#56b4e9',   // 周回数 (既定の緑 #7fe0a0 に代えて空色)
};

// 車種 = 挙動(ノーマル/ドリフト) × 駆動方式(FF/FR/4WD)。
// キネマティック自転車モデルを実車の駆動方式特性で変調して差別化する。
//
// 共通係数:
//   yawGain  : 旋回ヨーの基本倍率
//   us       : 定常アンダーステア量 (速度が上がるほど曲がりにくい) → ヨーを 1/(1+us·sp) 倍
//   os       : 定常オーバーステア量 (速度が上がるほど巻き込む)     → ヨーを (1+os·sp) 倍
//   powerUs  : アクセルON時に加算されるアンダー (FF: 前輪が駆動+操舵を兼ねて飽和)
//   powerOs  : アクセルON時に加算されるオーバー (FR: パワーオーバーステア)
//   liftOffOs: アクセルOFF旋回時に加算されるオーバー (タックイン)
//   brakeOs  : BRAKE 中に加算されるオーバー (制動の前荷重でリアが軽くなる。FR 顕著・FF 安定)
//   spin     : 発進ホイールスピン量 (低速×高スロットルで駆動輪が空転し加速が鈍る。
//              FF=加速で駆動輪の荷重が抜け大、FR=リア荷重で軽度、4WD=ほぼ無し)
//   slide    : 通常時の横滑り量 (旋回で車体が外へ滑る)
//   accel/brake/maxSpeed : 既定 CAR 値に対する倍率
//
// drift (ドリフト車のみ。null=滑らない=ノーマル):
//   trigger  : 滑り出す要求の種類
//              'power'   = 駆動(アクセル開度)で滑る (FR/4WD: パワースライド)
//              'liftoff' = 高速旋回中のアクセルOFF/減速で滑る (FF: リフトオフオーバーステア。
//                          再加速すると前輪が引っ張ってドリフトが速く収束する)
//   grip     : グリップ上限 (0..1)。要求がこれを超えた分だけ滑り出す (旧 PWM 閾値の連続版)
//   gain     : 超過量→滑り量の感度 (大きいほど少しの超過で一気に滑る)
//   brakeDrift: true なら旋回中の急ブレーキでも滑り出す (ブレーキングドリフト。'power' 車のみ)
//   minSp    : 滑り出しに必要な正規化速度 (0..1)
//   slipYaw  : 滑り中の追加回頭 (リアが流れて車体が巻き込む量)
//   slipSlide: 滑り中の横滑り量 (車体が外へ流れる量)
//   attack   : 滑りの立ち上がり速さ (1/s)
//   release  : グリップ回復の速さ (1/s)。逆ハン(カウンター)中は半分の速さで“保持”寄りになる。
// ※ 滑走中、滑り方向と逆へ舵を当てる(逆ハン)と回頭が打ち消され姿勢が安定、
//    滑り方向へ切り込むと滑りが深まる(スピン方向)。
const DRIVE = {
  // FF: パワーオンで強アンダー・タックインあり。エンジン重量が前にあり制動安定。
  ff: {
    label: 'FF (前輪駆動)', mass: 1380,   // 例: 量産スポーツコンパクトの高性能グレード級 (中量)
    yawGain: 0.95, us: 0.45, os: 0.00, powerUs: 0.50, powerOs: 0.00, liftOffOs: 0.18,
    brakeOs: 0.02, spin: 0.45,
    accel: 1.00, brake: 1.08, maxSpeed: 0.97, slide: 0.04,
    // FF ドリフト = リフトオフでリアだけ滑り出す (回頭強め・横流れは控えめ)
    drift: { trigger: 'liftoff', grip: 0.70, gain: 3.0, minSp: 0.45, slipYaw: 0.85, slipSlide: 0.45, attack: 6.0, release: 4.0 },
  },
  // FR: 駆動と操舵が分離して素直に曲がるが、パワーオンでリアが流れる。制動でも姿勢が乱れやすい。
  fr: {
    label: 'FR (後輪駆動)', mass: 1180,   // 例: 軽量ライトウェイトスポーツ級 (軽量で俊敏)
    yawGain: 1.05, us: 0.10, os: 0.10, powerUs: 0.00, powerOs: 0.40, liftOffOs: 0.05,
    brakeOs: 0.22, spin: 0.18,
    accel: 1.05, brake: 0.95, maxSpeed: 1.02, slide: 0.10,
    // FR ドリフト = パワーオーバーステア。リアが大きく流れて回頭、アクセルを戻すと素早く回復。
    // 旋回中の急ブレーキでも滑る (ブレーキングドリフト)。grip 0.84 ≒ 旧 PWM220 相当。
    drift: { trigger: 'power', grip: 0.84, gain: 6.0, brakeDrift: true, minSp: 0.40, slipYaw: 1.20, slipSlide: 0.45, attack: 4.5, release: 5.0 },
  },
  // 4WD: トラクション最強で発進加速に優れ (空転ほぼ無し)、弱アンダーの安定志向。だが重い。
  awd: {
    label: '4WD', mass: 1560,            // 例: 高出力ハイパフォーマンス4WD級 (高出力だが重量級)
    yawGain: 1.00, us: 0.30, os: 0.00, powerUs: 0.15, powerOs: 0.10, liftOffOs: 0.08,
    brakeOs: 0.08, spin: 0.00,
    accel: 1.25, brake: 1.10, maxSpeed: 1.06, slide: 0.02,
    // 4WD ドリフト = ラリー的な四輪ドリフト。回頭は穏やかだが車体ごと外へ流れ、回復が速い。
    // ラリーの振り回し同様、旋回中の急ブレーキでも滑る。grip 0.85 ≒ 旧 PWM220 相当。
    drift: { trigger: 'power', grip: 0.85, gain: 6.0, brakeDrift: true, minSp: 0.50, slipYaw: 0.25, slipSlide: 0.15, attack: 5.0, release: 6.0 },
  },
};
// 重量効果の基準質量(kg)。各車の mass/MASS_REF が「重さ係数」。
// 重い車ほど旋回で慣性が勝りアンダー(曲がりにくい)、制動も僅かに伸びる。下り(重力)では
// 加速は重量に依らない(g·sinθ)が、コーナーでの“曲げにくさ”が効くため軽い車が有利になる。
export const MASS_REF = 1370;
export const MASS = {
  us: 0.85,    // (重さ係数-1) × これ を定常アンダーに加算 (重い=曲がらない/軽い=俊敏)
  brake: 0.25, // 制動の伸び (重い=止まりにくい)
};
function mkType(behavior, dk) {
  const d = DRIVE[dk], drift = behavior === 'drift';
  return {
    key: `${behavior}_${dk}`,
    name: `${drift ? 'ドリフト' : 'ノーマル'} ${d.label}`,
    mass: d.mass,
    yawGain: d.yawGain, us: d.us, os: d.os,
    powerUs: d.powerUs, powerOs: d.powerOs, liftOffOs: d.liftOffOs,
    brakeOs: d.brakeOs, spin: d.spin,
    accel: d.accel, brake: d.brake, maxSpeed: d.maxSpeed,
    slide: d.slide,
    drift: drift ? d.drift : null,
  };
}
export const CAR_TYPES = [
  mkType('normal', 'fr'), mkType('normal', 'ff'), mkType('normal', 'awd'),
  mkType('drift', 'ff'), mkType('drift', 'fr'), mkType('drift', 'awd'),
];
export const CAR_TYPE_BY_KEY = Object.fromEntries(CAR_TYPES.map(t => [t.key, t]));
export const CAR_TYPE_DEFAULT = CAR_TYPES[0].key; // ノーマル FR

// ===== 車種パラメータの公開 + 利用者の独自車種追加 =====
// 各パラメータの意味 (UI「車種パラメータ」表示・独自車種定義の参考に)。
export const CAR_PARAM_DOC = [
  ['mass', '車重(kg)。重いほど旋回でアンダー(慣性)・制動が伸びる。'],
  ['accel', '加速の倍率。大きいほど速く目標速度へ。'],
  ['brake', '制動の倍率。大きいほど短く止まる。'],
  ['maxSpeed', '最高速の倍率(基準 0.7 m/s に対する比)。'],
  ['spin', '発進ホイールスピン量。大きいほど発進で空転し加速が鈍る(FF大/4WD≈0)。'],
  ['yawGain', '旋回ヨーの基本倍率。'],
  ['us', '定常アンダーステア量。大きいほど高速で曲がりにくい。'],
  ['os', '定常オーバーステア量。大きいほど高速で巻き込む。'],
  ['powerUs', 'アクセルON時に増すアンダー(FF: 前輪が駆動+操舵で飽和)。'],
  ['powerOs', 'アクセルON時に増すオーバー(FR: パワーオーバーステア)。'],
  ['liftOffOs', 'アクセルOFF旋回で増すオーバー(タックイン)。'],
  ['brakeOs', '制動中に増すオーバー(前荷重でリアが軽い。FR顕著)。'],
  ['slide', '通常時の横滑り量。'],
  ['drift', 'ドリフト設定(null=滑らない)。{trigger,grip,gain,minSp,slipYaw,slipSlide,attack,release,brakeDrift}'],
];

// 独自車種を登録する (利用者定義。最低限 key/name と駆動系パラメータがあればよい)。
// 既定値で埋めるので、一部だけ指定しても動く。重複キーは置き換える。
export function registerCarType(def) {
  if (!def || !def.key) return null;
  const base = mkType('normal', 'fr'); // 既定の土台 (FR ノーマル)
  const t = { ...base, ...def, custom: true };
  // drift は { ...} or null。指定が object なら既定とマージ。
  if (def.drift && typeof def.drift === 'object') {
    const dbase = DRIVE.fr.drift;
    t.drift = { ...dbase, ...def.drift };
  } else if (def.drift === null || def.drift === undefined) {
    t.drift = def.key && CAR_TYPE_BY_KEY[def.key] ? CAR_TYPE_BY_KEY[def.key].drift : null;
    if (def.drift === null) t.drift = null;
  }
  const idx = CAR_TYPES.findIndex(x => x.key === t.key);
  if (idx >= 0) CAR_TYPES[idx] = t; else CAR_TYPES.push(t);
  CAR_TYPE_BY_KEY[t.key] = t;
  return t;
}

// 独自車種の登録解除 (個別削除)。組込車種 (custom でない既定6種) は保護して解除しない
// (= shipped 既定の CAR_TYPES は壊さない)。解除できたら true。
export function unregisterCarType(key) {
  const idx = CAR_TYPES.findIndex(x => x.key === key);
  if (idx < 0) return false;
  if (!CAR_TYPES[idx].custom) return false; // 組込は保護 (V3 で別途扱う)
  CAR_TYPES.splice(idx, 1);
  delete CAR_TYPE_BY_KEY[key];
  return true;
}

// ===== 物理モデルの切替 =====
// dynamic  = 単軌道動力学モデル (physics_dyn.js DynCar。既定。ドリフト/バックエントリーが物理として可能)
// standard = キネマティック自転車モデル (physics.js Car。クラシック物理として選択可)
// v2       = 精密動力学 (physics_v2.js CarV2。Stage AO。4輪 two-track＋緻密接触・fullscale 向け。
//            AO1 骨格では dynamic 相当の挙動=guarded branch のため卓上既定 byte 不変)
// Phase D4-B6 (2026-06-13) で dynamic を既定化 (test_programs 161/180・峠47/48・ウェット全完走を確認済み)。
// UI の初期選択 (index.html #optPhysMode) はこの既定値と一致させること。
export const PHYSICS = { mode: 'dynamic' };
export const PHYSICS_MODES = ['standard', 'dynamic', 'v2'];   // 3値白リスト (Stage AO1)
// v2 エンジンのタイヤセット (Stage AO6・car.tireSet)。normal=既定 (ゴム/スリック)。slip=スリップタイヤ
// (硬質プラ/ハードコンパウンド=疑似ドリフト環境)。rain=レインタイヤ (Stage AS9・溝つき軟質コンパウンド)。
// 物理定数は REGIMES[name].v2tire に領域別に持つ。
// **既定 normal のときは共有 URL/レース canon に載せない=既存ハッシュ byte 不変** (physics/grid と同型)。
export const TIRE_SETS = ['normal', 'slip', 'rain'];
export const TIRE_DEFAULT = 'normal';

// ── ギア比 (任意装備・Stage AS9) ────────────────────────────────────────────────
// 実機 RumiCar は**モーター直結**(ピニオン/スパーの固定比) だが、RC カーではピニオン交換による
// ギア比変更が標準的な調整であり、2速メカニカルトランスミッションも実在する。本モデルはこれを
// 「実機に追加できる拡張装備」として opt-in で与える (後方センサー/車輪エンコーダと同じ扱い)。
// **既定 'direct' = 比 1 の単段 = 現行の直結と同値 = byte 不変** (ratios[0]===1 かつ変速機構を通らない)。
//
// 物理: モータートルクは減速比 r 倍で車輪へ届き、車輪回転数は 1/r 倍になる。∴
//   ・トルク律速の加速上限 aCap ×r  ・ギア比が決める最高速 maxV ÷r
//   ・出力律速 (fullscale 定出力ドライブトレイン wheelPower) は **P=F·v ゆえギアで不変**(乗じない)
//   ・モーターブレーキも同じ歯車列を通る (逆起電力制動トルク ×r)
// 比は無次元 ⇒ 領域スケール不変 (卓上/中/フルスケールで同じ比が同じ意味)。変速点も maxV に対する
// 比 (無次元) で置く。変速中は駆動トルクが途切れる (shiftSec0=卓上アンカー・Froude 時間 √(L/0.13) で追従)
// ため「2速は加速も最高速も取れるが変速で一瞬失う」= 交換として測れる (どれかが常に最良ではない)。
export const GEARS = {
  direct: { ratios: [1] },                    // 既定=直結 (byte 不変)。比 1・単段=変速機構なし。
  short:  { ratios: [1.45] },                 // ローギア: 加速 ×1.45・最高速 ÷1.45 (=0.69倍)
  tall:   { ratios: [0.72] },                 // ハイギア: 加速 ×0.72・最高速 ÷0.72 (=1.39倍)
  // 2速オートマ: 車速で決定論的にシフト (ヒステリシス upAt>downAt で往復を防ぐ)。
  // upAt/downAt は **ギア比を掛ける前の maxV に対する比** (無次元)。1速の頭打ちは 0.69·maxV なので
  // upAt=0.62 は 1速の 90% 地点、downAt=0.50 はその下=戻り点。shiftSec0 は変速で駆動が切れる時間 [s]。
  auto2:  { ratios: [1.45, 0.72], upAt: 0.62, downAt: 0.50, shiftSec0: 0.10 },
};
export const GEAR_SETS = ['direct', 'short', 'tall', 'auto2'];
export const GEAR_DEFAULT = 'direct';

// ── サスペンション自由度 (任意装備・Stage AS11) ──────────────────────────────────
// v2 の輪荷重移動は「準静的な h/L 式を **1次遅れ** で駆動する」形 (physics_v2 ⑪ の LPF・時定数
// τ_susp=0.12·√(L/0.13))。1次遅れは **行き過ぎ (オーバーシュート) を原理的に持てない** ので、
// 実車の「切り返しでロールが行き過ぎ、戻ってくる」過渡が表現できない。AO_spec §2.2 はこれを
// 「明示ロール/ピッチ自由度は持たない (剛性 ODE を避け決定論・安定・低コスト。設計判断＝固定)」
// と記録し、§13-7 が **サス自由度を明示的バックログ** として後日へ送っていた (本装備がその実施)。
//
// モデル (ロール1自由度・ピッチ1自由度): ロール角 φ のばね・減衰系
//     I_x·φ̈ = m·a_y·h − K·φ − C·φ̇
// を、荷重移動が読む「実効横加速度」 q ≡ (K/(m·h))·φ [m/s²] へ正規化すると **定数が全部消えて**
//     q̈ = ω²·(a_y − q) − 2ζω·q̇          (ω=√(K/I_x)=ロール固有角振動数, ζ=減衰比)
// になる。**不動点は q=a_y で現行 LPF と厳密に同一** ⇒ 定常の荷重移動は一切変わらず、変わるのは
// 過渡だけ (①の「定常一致・過渡のみ変化」)。ピッチも同形 (a_x に対する 1 自由度)。
//
// **新しい絶対定数を1つも入れない** (AS10 の bank と同じ作法): 固有角振動数は既存の τ_susp から
// ω₀=1/τ_susp を取り、装備は **無次元の2数 (wN=ω/ω₀, zeta=ζ) だけ** を与える。無次元ゆえ
// 領域スケール不変 (卓上/中/フルスケールで同じ数字が同じ意味・τ_susp が Froude 時間で追従する)。
// ζ<1 の行き過ぎ量は閉形式 **Mp=exp(−πζ/√(1−ζ²))**、到達時刻は **tp=π/(ω√(1−ζ²))** で、
// どちらも比例定数を含まない ⇒ 実装の内部式を検査側へ写さずに機械照合できる (AS9 g*・AS10 v² と同型)。
//
// **既定 'quasi' = 自由度なし = 現行の1次遅れそのもの = byte 不変** (physics_v2 ⑪ が guarded branch で
// 旧2行と同一式・同一 double を通る)。精密 v2 エンジンでのみ効く (dynamic/standard は無視)。
export const SUSPS = {
  quasi: null,                        // 既定=準静的 (1次遅れ)。自由度を持たない=従来と完全に同じ。
  soft:  { wN: 0.75, zeta: 0.30 },    // ソフト: 低い固有振動数・弱い減衰 ⇒ 大きく揺れて行き過ぎる (Mp≈37%)
  balanced: { wN: 1.00, zeta: 0.70 },  // 標準: τ_susp と同じ速さ・実車の常用域 ζ≈0.7 (Mp≈4.6%)
  stiff: { wN: 1.70, zeta: 1.00 },    // ハード: 速く・臨界減衰 ⇒ 行き過ぎ 0 (Mp=0)・ほぼ即時に荷重が乗る
};
export const SUSP_SETS = ['quasi', 'soft', 'balanced', 'stiff'];
export const SUSP_DEFAULT = 'quasi';

// ── 操舵サーボの分解能 (任意装備・Stage AS12) ───────────────────────────────────
// 実機 RumiCar の操舵は **3値 (LEFT/CENTER/RIGHT)** で、これは D-1 (AO_spec §0) が定める
// 学習 API 表面の不変条件そのもの。ここで足すのは「実機に **比例操舵サーボ** を増設したら
// どうなるか」を試せる **任意装備** で、**既定 'tri' は 1 バイトも変えない** (下の早期 return が
// 旧式と同一式・同一 double を通る)。後方センサー/車輪エンコーダ/ギア比/サス自由度と同じ扱い。
//
// **3値でも中間舵角自体は作れる**: サーボは目標角へ steerRate [rad/s] で追従するだけなので、
// 3値指令を小刻みにオン/オフすれば平均化されて中間角になる (physics.js `_stepSteering` の
// 設計コメント「デューティ操舵」)。∴ 連続舵が変えるのは **分解能ではなく帯域** である —
// 3値では舵を動かすたびに ±フル舵へ向かって steerRate ぶん流れるので、保持角のリップルが
// 「1指令あたりの角度」= steerRate/指令レート に張り付く (fullscale 20Hz なら 5.73°/指令・
// 卓上なら 20.05°/指令)。連続舵は目標角を直接置けるのでリップルが 0 になる。
//   → この違いが実走で何を変えるか (ドリフト保持の go/no-go) は AS12 が実測する。
export const STEER_SETS = ['tri', 'prop'];
export const STEER_DEFAULT = 'tri';

// 舵指令 → 目標舵角 [rad]。mx = その車のフル舵角 (CAR.maxSteer ×driftSteerMul 等・呼び側が決める)。
//   set!=='prop' または amt==null (= 既定の3値) → **旧式と厳密に同一** (早期 return・byte 不変)。
//   set==='prop' かつ amt!=null → 0..255 を フル舵 mx への比 amt/255 として掛ける。
// amt=255 のとき 255/255 は IEEE754 で厳密に 1.0、`mx*1` も厳密恒等ゆえ **「全舵」は3値と bit 一致**。
export function steerTargetOf(steer, mx, set, amt) {
  if (set !== 'prop' || amt == null) {
    if (steer === CONST.LEFT) return mx;
    if (steer === CONST.RIGHT) return -mx;
    return 0;
  }
  const k = amt / 255;
  if (steer === CONST.LEFT) return mx * k;
  if (steer === CONST.RIGHT) return -mx * k;
  return 0;
}

// ── 路面種別 (コース任意属性・Stage AV1) ────────────────────────────────────────
// 既存の路面属性は `grip` (ピーク倍率) と `muDecay` (ピーク後の漸近比) の2つで、どちらも
// **「滑るほど落ちる」曲線の形しか作れない**: mfCoeffs は muDecay を [0.35,0.95] にクランプする
// (physics_v2.js) ので g(σ)=sin(C·atan(Bp·σ)) は σ>1 で必ず単調減少する (実測 muDecay=0.92 で
// g(1)=1 → g(4)=0.9557、0.99/1.0 を渡してもクランプされて 0.95 と同一係数になる)。
//
// 実際の砂利・ダート・雪といった **ルーズ路面** はそうならない。タイヤが表層へ潜り、進む先に
// 材料の土手を作って押しのける (bulldozing / 掘り込み) ため、横力は Coulomb 摩擦だけで決まらず
// 「押しのけた材料の量」ぶんが足し算で乗る。これが、舗装路の最適スリップ角が 5〜10° なのに
// ダートでは 20〜30° になる理由であり、ラリーが大きな滑り角で曲がる物理的根拠でもある。
//
// モデル (掘り込み項・**σ 比例＋上限クランプ**):
//     F_ss = μ·Fz·[ g(σ) + dig·min(σ/digSat, 1) ]        μ_eff = μ·(1 + dig)
//   ・`dig`    = 掘り込みで足せる力の上限 (ピーク摩擦 μ·Fz に対する比)。土手が満載のときの寄与。
//   ・`digSat` = 掘り込みが飽和する正規化スリップ σ (これ以上滑らせても土手はもう育たない)。
// **力の向きは変えず大きさだけを増やす**ので、接地スリップに対する散逸性
//   F·v_slip = −(F_ss·denom/σ)·(κ²/κP + tanα²/αP) ≤ 0 は F_ss≥0 である限り恒等的に成立し、
// 摩擦円も |F| ≤ μ_eff·Fz を構造保証する (物理の不変条件を1つも壊さない・AO_spec §2.3)。
//
// digSat=3 は「ルーズ路面のピークが σ=3 へ移る」という意味で、αP=0.14 (normal) では
// α=atan(3×0.14)=22.8° ＝ 実在のダート最適スリップ角 20〜30° に収まる。dig=0.30 は
// そのとき μ_eff/μ=1.30 になる大きさ。**どちらもゲート `wf_av1_loose.mjs` が掃引して
// 法則 (単調性・クランプ・散逸性・摩擦円) を検査する**ので、結論は単一の値に依存しない。
//
// **既定 (フィールド無し / 'paved') は null = 掘り込みなし = 式に入らない = byte 不変**
// (SUSPS の 'quasi'・GEARS の 'direct' と同じ guarded branch の作法)。
//
// **精密 v2 エンジンでのみ効く (dynamic/standard は非対象)**。理由は「タイヤ曲線を持たないから」では
// ない — `physics_dyn.js:89-95, 503-512` は簡易 Pacejka (alphaPeak/kDecay) と摩擦楕円を持っている。
// 非対象にするのは **掘り込み項を足す先が無い**から: dig は「**輪ごとの** ピーク摩擦 μ_i·Fz_i に対する比」
// として、v2 の結合スリップ σ=hypot(κ/κP, tanα/αP) 上で定義してある。dynamic は単軌道 (自転車) 近似で
// 輪ごとの μ·Fz を持たず (軸ごとの摩擦楕円半径 fyFMax/fyRMax)、スリップの正規化も |α|/alphaPeak と別物。
// standard (クラシック) はさらに横速度自由度 vlat も持たない。別モデルから導出し直さずに足せば
// 「実体のない差の注入」になる (AS7/AS10 が却下したのと同型)。
export const SURFACES = {
  paved: null,                        // 既定=舗装。掘り込みなし=従来と完全に同じ。
  loose: { dig: 0.30, digSat: 3.0 },  // ルーズ (砂利/ダート/雪): σ=3 まで掘り込みが育ち、以後クランプ。
};
export const SURFACE_DEFAULT = 'paved';

// ── 制動装置 (車両の任意装備・Stage AV2) ─────────────────────────────────────────
// 実機 RumiCar の制動は **駆動モーターの逆トルクだけ** で、これは v2 の `_substep` が
// 「BRAKE の指令を駆動軸 split へ流す」形で正直に写している (physics_v2.js の braking 枝)。
// ∴ **FR は制動が後軸だけに掛かり後輪がロックする** (実測: fullscale FR・40m/s から制動 0.5s 後の
// 車輪面速度が u=35.72 に対し [前 35.73, 35.73 / 後 0.00, 0.00] = 前輪は接地追従・後輪は完全ロック)。
// ロックした後輪は横力を失うので、コーナー内でブレーキを踏むとリアが即座に抜ける。停止距離も
// 駆動方式で大きく違う (fullscale・normal タイヤ・grip 1.0・**40m/s → 2m/s**:
//   FR 138.97m=0.588g / FF 88.11m=0.926g / AWD 65.85m=1.239g)。
// **上の数値はすべて常設ゲート `wf_av2_brake.mjs` の C6/C7 が毎回印字する**(条件つきで転記すること。
//  終速を書かない転記は再現できない — 実際 v7.7.0 の初版はそれで別条件の値を載せていた)。
//
// 実車はこれと違い **4 輪すべてに独立した摩擦ブレーキ** を持ち、制動力を前後へ配分する
// (前荷重移動で前輪の方が多くの力を受け止められるため、配分は前寄りが普通)。この違いは
// **トレイルブレーキ** (コーナー進入で残したブレーキを解きながら曲がる) の成立可否を直接決める。
// ここで足すのは「実機に 4 輪摩擦ブレーキを増設したらどうなるか」を試せる **任意装備**で、
// **既定 'motor' は 1 バイトも変えない** (呼び側が brk=null で配分ブロックへ入らない
// = GEARS の 'direct'・SUSPS の 'quasi'・SURFACES の 'paved' と同じ guarded branch の作法)。
//
// モデル: BRAKE 指令の総制動力 fCmd (= CAR.brake·p.brake·grip·gr / 質量項) は**総量を変えず**、
//   前軸へ biasF・後軸へ (1−biasF) を配り、各軸内は左右等分する。
//   ・**総量が同じ**ので「配分だけを変えた」比較になる (装備が制動力そのものを増やすのではない)。
//   ・**ロックは車輪 ODE から創発する** (dvw/dt=λ·(fApp−fx_tire) の fApp が輪のタイヤ縦力容量を
//     超えると vw が 0 へ落ちる)。閾値を書き込まない = 荷重移動と μ が自動的に効く。
//   ・**駆動軸だけは左右がデフで結合**しているので LSD の移送 Tt を従来どおり適用する
//     (総軸力は不変＝ヨーのみ変える)。非駆動軸のブレーキは輪ごとに独立。
//   ・配分は無次元比ゆえ **領域スケール不変** (卓上/中/フルスケールで同じ数字が同じ意味)。
//
// **⚠ 効果は領域で符号が変わる**: fullscale では FR の制動が 2.11 倍強くなるが、**卓上/中スケールでは
// 0.77 倍と弱くなる**。原因は領域そのものではなく、卓上/中スケールで有効な **AP13 の車輪 ODE 半陰的化**
// で、その減衰に「線形域のタイヤ剛性＝飽和域の実勾配を上回る安全側」の値を使うため、輪はスリップを
// 立ち上げ切れず **指令より小さい力しか路面へ届かない**。これは既定のモーターブレーキでも同じ
// (実力/指令 0.59) で、指令を 4 輪へ薄く配ると過小伝達がさらに効く (同 0.43)。半陰的化を通らない条件
// (低グリップ・slip タイヤ・fullscale) では 0.96〜2.11 倍。**判別量は「4 輪へ配ったときに指令がより
// 多く路面へ届くか」**で、`wf_av2_brake.mjs` の I 章が 8 条件すべてで符号一致を機械検査する。
// 半陰的化そのものの精度改良は既定の卓上物理を変えるため本装備のスコープ外 (AV3 へ申し送り)。
//
// biasF の値: 実車の前後制動配分は前 60〜75% が一般的 (前荷重移動ぶん前輪が受け持てる)。
// 3 つのプリセットは「安定 ⇄ 回頭」の交換を学習者が測れるように置いてある —
// 前寄りほど直進安定でアンダー、後寄りほど回頭するがリアがロックしやすい。**単一の値に結論が
// 依存しないよう、ゲート `wf_av2_brake.mjs` が biasF を掃引して法則 (閉形式の減速度・ロック閾値・
// 摩擦円) を検査する**。
//
// **適用は精密 v2 エンジンのみ** (dynamic/standard は非対象)。理由は「車輪 ODE が無いから」では
// **ない** — `physics_dyn.js:406-435` は軸レベルの車輪 ODE (wheelStep・vwF/vwR) と摩擦楕円
// fyFMax=FyF·√(1−(fxF/fxFMax)²) を実際に持っている。非対象にするのは:
//   ① 前後配分の意味は **輪ごと(4)** の荷重 Fz_i とロックにある (内輪が先にロックする・荷重移動で
//      前輪の容量が増える)。dynamic は **軸レベル(2)** で左右非対称を原理的に持たない。
//   ② dynamic の制動関連機構 (wheelDyn/circleBi/latLoadK) は **fullscale だけ有効** (下の REGIMES:
//      卓上/中スケールは 3 つとも 0)。卓上では !DYN.wheelDyn 分岐の瞬時クランプでロックが創発せず、
//      **同じ装備が領域によって黙って無効になる沈黙故障**になる。
//   ③ standard (クラシック) は横自由度も車輪状態も持たず、制動はスカラーの減速率 (physics.js:105)。
export const BRAKES = {
  motor: null,                          // 既定=モーターブレーキ (駆動軸のみ)。従来と完全に同じ。
  friction:      { biasF: 0.60 },       // 4輪摩擦ブレーキ・標準配分 (前 60% / 後 40%)
  frictionFront: { biasF: 0.75 },       // 前寄り配分: 直進安定・リアがロックしにくい (アンダー傾向)
  frictionRear:  { biasF: 0.45 },       // 後寄り配分: 回頭しやすいがリアがロックしやすい (オーバー傾向)
};
export const BRAKE_SETS = ['motor', 'friction', 'frictionFront', 'frictionRear'];
export const BRAKE_DEFAULT = 'motor';

export function setPhysicsMode(m) {
  PHYSICS.mode = PHYSICS_MODES.includes(m) ? m : 'dynamic';   // 未知値は既定 dynamic へフォールバック
  return PHYSICS.mode;
}

// 領域適用フック (Stage AO5)。applyRegime(physics_dyn.js) は DYN/CAR というグローバル holder を書くが、
// v2 エンジンは自前の holder (V2・physics_v2.js) を持つ。両者を単一の choke point (applyRegime) から
// 同期させるため、physics_v2.js が applyRegimeV2 をここへ登録し、applyRegime が末尾で全フックを呼ぶ。
// **循環 import を避ける**ため (physics_dyn ↔ physics_v2)、両モジュールが config.js のみに依存する形にする
// (physics_dyn は本配列を呼ぶだけ・v2 の存在を知らない/ physics_v2 は本関数で登録するだけ)。フックは
// v2 が到達可能な全経路 (fleet.js が CarV2 を top-level import・全 v2 ゲートが physics_v2 を import) で
// モジュール読込時に登録済 = applyRegime の初回呼出 (ユーザー操作/runRace・全 import 解決後) までに必ず在る。
export const REGIME_HOOKS = [];
export function registerRegimeHook(fn) { if (typeof fn === 'function' && !REGIME_HOOKS.includes(fn)) REGIME_HOOKS.push(fn); }

// ===== 領域(regime) — 物理スケールのプリセット (Phase F1) =====
// 同じ動力学エンジンで卓上 (RumiCar 実機, 1.3km/h) 〜 フルスケールレース (350km/h) を扱う。
// 設計原理: 支配比 Ay*=(v²/R)/(μg) を領域不変に保つ「動的相似 (dynamic similarity)」。
// 領域は長さ L・特性速度 V・重力 g・路面μ という次元パラメータで定義し、Froude 相似則
//   kV=√(kL·kG) (kMu=1)  ⇒ (V²/L)/(μg) 不変
// で全ての速度・加速度・時間レートの量をスケールする。学習者は「卓上で走るプログラムが
// フルスケールでスピンする → なぜ?」を相似則として体得できる。
//
// プリセットは物理スカラー (DYN/CAR が読む量) を flat に保持する。applyRegime() (physics_dyn.js)
// が DYN.* / CAR.* へ書き込む。**卓上(tabletop) = 現値そのもの** なので applyRegime('tabletop')
// は byte no-op (f0_regime Part A の退行ゼロ契約)。L/sensorMaxMm/topKmh は派生・表示用メタ。
export const REGIMES = {
  tabletop: {
    name: '卓上 (RumiCar 実機相当)',
    desc: '実寸 13cm・1.3km/h。異方性摩擦で滑り出しが見える卓上スケール。初心者はここで滑らず学ぶ。',
    L: 0.13,            // 長さスケール (wheelBase, m) — 無次元化/ToF レンジの基準
    // 重力・摩擦 (DYN へ)
    g: 9.81, muY: 0.19, muYDrift: 0.13, muX: 0.75, muXDrift: 0.35, C0: 10.0,
    // 速度・加速度系 (CAR へ)
    maxSpeed: 0.7, accel: 2.5, brake: 4.0, coast: 1.2, steerRate: 7.0,
    // 低速・数値系 (DYN へ)
    uBlend0: 0.02, uBlend1: 0.08, absUFloor: 0.05, uStop: 0.02, uStopHard: 1e-4,
    vlatStop: 2.5, nSub: 4, adaptiveSub: false,
    // タイヤ横力曲線のピーク+穏やか減衰 (tire-1, Phase F4)。alphaPeak = ピーク滑り角 (rad, 無次元なので
    // Froude スケール不変)。|α|≤alphaPeak はピーク横力 (摩擦楕円) フル、超えると 1/(1+kDecay·(|α|−αpeak))
    // で穏やかに減衰 (ゼロには落とさない)。卓上は alphaPeak 大きめ・kDecay 浅めで創発を等価角で維持
    // (落ち込み過大は全速ドリフトを殺す既往退行 β68→3 があるため)。線形域 (小α) は不変 → std/dyn byte 維持。
    alphaPeak: 1.35, kDecay: 0.50,
    // kinFactor (実効舵角シム) のフェード強度 (Phase F-kin)。卓上=1 = シム全量 (US/OS を異方性摩擦ハック上の
    // 入力側シムで再現=操縦感/プログラム互換/教材パラメータ us/os/powerUs/liftOffOs/brakeOs/yawGain を保持)。
    // フルスケール (等方実μ+空力+F4 曲線=US/OS の物理母体がそろう) でのみ 0 へフェードし kinFactor/steerK を
    // 撤去して US/OS を物理から創発させる。適用は連続ブレンド (二値禁止)。midscale は相似保持なので 1 のまま。
    kinFade: 1,
    // 左右(横)荷重移動の強さ (Z2 / IMP-01)。卓上=0 = 寄与ゼロ=恒等 (横荷重移動ブロックをスキップ=byte 完全
    // 不変)。卓上は異方性摩擦ハック (μ を線形に逆算した値) で滑り出しを作っており、実タイヤの荷重感度
    // 非線形性 (荷重移動で軸グリップが目減りする) は相似破れの実μ領域 (fullscale) でのみ物理的に正しい。
    // ∴ circleBi/kinFade と同じ相似破れ境界で fullscale のみ >0 にする (中スケールは Froude 相似保持=0)。
    latLoadK: 0,
    // 摩擦円の双方向結合強度 (tire-3, Phase F2)。卓上=0 = 片方向(縦優先)。卓上のスリップタイヤは
    // 駆動輪空転で横力が消える (=パワーオーバー/ドーナツの母体) wheelspin 律速のため縦優先が物理的に
    // 正しく、双方向化は創発を壊す (sweep_f2.mjs 実測: κ=0.05 でパワーオーバー156→145°・ドーナツβ87→63°)。
    // 等方実μのフルスケール領域では 1 (=ラジアル円) が正しい (combined-slip でグリップ限界。F3 で活性化)。
    circleBi: 0,
    // 車輪スリップ率/縦力 (Phase F5, 任意・競技題材)。wheelDyn=0 で車輪角速度ブロックを丸ごとスキップ
    // → 従来の「指令の瞬時クランプ」のまま = byte 完全不変。卓上は 0 (過去2度棄却 156/180 を領域ゲートで回避)。
    // フルスケールでのみ活性化し、車輪面速度 vw=ωR を陽的 Euler 積分してスリップ率 s=(vw−u)/|u| から縦版
    // Pacejka 縦力を導く → ローンチ・ホイールスピン (全開ベタ踏みが空転損失でスルーレート制御に負ける) と
    // ブレーキ・ロック (s→−1 で横グリップ喪失) が創発する。driveBand=0.06 は卓上の従来駆動レート (不変)、
    // wheelPower/launchAccel は fullscale 専用の定出力ドライブトレイン (accel/muX は不変=空転は車輪慣性から創発)。
    wheelDyn: 0, wheelLambda: 0, sPeak: 0, wheelB: 0, wheelC: 0,
    driveBand: 0.06, wheelPower: 0, launchAccel: 0,
    // 空力 (Phase F3)。卓上は ρ=0/A=0 で完全 no-op (動圧 ½ρ·A·u² がゼロ → 抗力もダウンフォースもゼロ)。
    // 卓上スケール (13cm, 0.7m/s) では v² が小さく空力は実質無視できる (フルスケール比で約7万分の1)。
    rho: 0, Cd: 0, Cl: 0, frontalArea: 0, downforceBalance: 0.5,
    // 表示・知覚メタ。realKmh=false は displayKmh が「最高速比×topKmh」の没入写像を使う (卓上の体感維持)。
    sensorMaxMm: 2000, topKmh: 350, realKmh: false,
    // ── v2 エンジン専用タイヤセット較正 (Stage AO6・AO_spec §4・車ごと car.tireSet で選択) ──
    // 卓上は RC 実機ハード相当: normal=ゴム (μ0≈0.8・§4 帯 0.7–0.9) で「通常ドリフトは起きない」
    // (最大到達 ay=v²/R≈1.6 ≪ μg≈7.8 → 機械述語 max|β|<5°)。slip=硬質プラ (μ0≈0.20・帯 0.15–0.30)
    // で μg≈2.0 → 限界超過が到達可能・後軸縦容量≈1.0<accel 2.5 → 発進空転/パワーオーバーが成立し
    // 疑似ドリフト練習場になる (§10.2)。μ0/αP/κP/muDecay は無次元 ⇒ Froude 相似の midscale は本表を
    // そのまま継承 (scaleRegime が v2tire をコピー=「Froude 導出」)。normal は fullscale normal と同じ
    // 数理性質 (摩擦円・定常円・散逸) ゆえ AO2/AO3 ゲートは緑・卓上既定は dynamic なので f0/f1 は byte 不変。
    // rain (Stage AS9)= 溝つき軟質コンパウンド。**乾路では normal に劣り (mu0 比 ρ=0.85)・濡れた路面では
    // 排水で路面グリップ低下を取り戻す (wetGain)**。→ 交差点 (どちらが速いかが入れ替わる路面グリップ)
    // g* = ρ·w/(1−ρ·(1−w)) = 0.85·0.70/(1−0.85·0.30) = **0.7987**。ρ を領域間で揃えてあるので
    // **g* は領域不変** (卓上/中/フルスケールで同じ)。出荷ウェット2コース (grip 0.5/0.55) は g* 未満
    // ⇒ rain が速い。乾路 (grip=1) は g* 超 ⇒ normal が速い。
    v2tire: {
      normal: { mu0: 0.8,  muDecay: 0.75, alphaP: 0.14, kappaP: 0.10, relLenFrac: 0.5 },
      slip:   { mu0: 0.20, muDecay: 0.95, alphaP: 0.25, kappaP: 0.18, relLenFrac: 0.6 },
      rain:   { mu0: 0.68, muDecay: 0.80, alphaP: 0.16, kappaP: 0.11, relLenFrac: 0.55, wetGain: 0.70 },
    },
  },
};
// 現在アクティブな領域名 (applyRegime が更新)。既定=卓上。
export const REGIME_STATE = { active: 'tabletop' };

// 動的相似スケーリング: 基準領域 base を 長さ kL・摩擦 kMu・重力 kG 倍した派生領域を生成する。
// Froude 相似 kV=√(kL·kG·kMu) で速度を、時間は kT=√(kL/(kG·kMu)) でスケールし、Ay* を不変に保つ。
//   速度 (m/s)     : ×kV      … maxSpeed, uBlend0/1, absUFloor, uStop, uStopHard
//   加速度 (m/s²)  : ×kG·kMu  … accel, brake, coast, C0 (=Cα*·μg なので μ·g に比例)
//   重力 (m/s²)    : ×kG      … g
//   摩擦 (無次元)  : ×kMu     … muY, muYDrift, muX, muXDrift
//   レート (1/s)   : ÷kT      … steerRate, vlatStop
//   長さ (m)       : ×kL      … L, sensorMaxMm
// これにより同じ走行プログラムを領域を変えて走らせても、滑り出し (Ay*=1) が同じ操作で起きる。
export function scaleRegime(base, { name, desc, kL = 1, kMu = 1, kG = 1, topKmh } = {}) {
  const kV = Math.sqrt(kL * kG * kMu);   // 速度スケール (Froude)
  const kT = Math.sqrt(kL / (kG * kMu)); // 時間スケール
  const kA = kG * kMu;                   // 加速度スケール (=kV²/kL)
  return {
    name: name || `${base.name} ×${kL}`,
    desc: desc || `${base.name} を 長さ${kL}・μ${kMu}・g${kG} 倍した相似領域 (Ay* 不変)`,
    L: base.L * kL,
    g: base.g * kG,
    muY: base.muY * kMu, muYDrift: base.muYDrift * kMu,
    muX: base.muX * kMu, muXDrift: base.muXDrift * kMu,
    C0: base.C0 * kA,
    maxSpeed: base.maxSpeed * kV, accel: base.accel * kA, brake: base.brake * kA,
    coast: base.coast * kA, steerRate: base.steerRate / kT,
    uBlend0: base.uBlend0 * kV, uBlend1: base.uBlend1 * kV, absUFloor: base.absUFloor * kV,
    uStop: base.uStop * kV, uStopHard: base.uStopHard * kV,
    vlatStop: base.vlatStop / kT, nSub: base.nSub, adaptiveSub: true,
    // タイヤ横力曲線の形状係数 (tire-1, F4) は無次元 (滑り角・減衰率) なので Froude 相似で不変 (base 引き継ぎ)。
    alphaPeak: (base.alphaPeak != null) ? base.alphaPeak : 1.35,
    kDecay: (base.kDecay != null) ? base.kDecay : 0.50,
    // kinFactor フェード (F-kin) は base から引き継ぐ。Froude 相似領域 (midscale) は卓上と同じ異方性摩擦・
    // 同じ Ay* (相似保持) なので kinFade=1 のまま (シムが等しく妥当)。kinFade を 0 へ落とすのは相似破れの
    // 実μ等方領域 (fullscale) のみ=circleBi 0→1 と同じ境界 (相似破れ以外の confound を作らない)。
    kinFade: (base.kinFade != null) ? base.kinFade : 1,
    // 摩擦円双方向結合は μ の等方性で決まる。Froude 相似 (kMu 一律) は μx/μy 比を保つので
    // base の値を引き継ぐ (kMu でスケールしても異方→等方の度合いは変わらない)。等方実μ領域は
    // 生成後に circleBi=1 を明示上書きする (F3)。連続ブレンドなので領域間に不連続帯は生じない。
    circleBi: base.circleBi || 0,
    // 左右(横)荷重移動 (Z2)。base から引き継ぐ (Froude 相似領域 midscale は base=卓上=0 のまま縮退=byte 不変・
    // Part C の Ay* 領域不変ゲートを保つ)。荷重感度は相似破れの fullscale でのみ正しい (circleBi/kinFade と同型)。
    latLoadK: base.latLoadK || 0,
    // 車輪スリップ率/縦力 (Phase F5) は base から引き継ぐ (Froude 相似領域は base=卓上=0 のまま縮退=byte 不変)。
    // driveBand のみ従来駆動レート 0.06 をフォールバック (未定義なら 0.06)。
    wheelDyn: base.wheelDyn || 0, wheelLambda: base.wheelLambda || 0,
    sPeak: base.sPeak || 0, wheelB: base.wheelB || 0, wheelC: base.wheelC || 0,
    driveBand: (base.driveBand != null) ? base.driveBand : 0.06,
    wheelPower: base.wheelPower || 0, launchAccel: base.launchAccel || 0,
    // v2 タイヤセット (Stage AO6)。μ0/αP/κP/muDecay/relLenFrac は無次元 ⇒ Froude 相似 (kMu=1) は μ を
    // 保つので base (卓上) の v2tire をそのまま継承する (=「midscale は Froude 導出」)。参照コピーで可
    // (読み取り専用・applyRegimeV2 は値を複製して V2 へ書く)。base に無い場合は undefined (V2 既定へ)。
    v2tire: base.v2tire,
    // 空力 (Phase F3) は base から引き継ぐ (Froude 相似領域は base=卓上=0 のまま no-op)。
    // 真のフルスケール race は相似が破れる (実μ等方+ダウンフォース) ため scaleRegime ではなく
    // 直接定義する (下記 REGIMES.fullscale)。
    rho: base.rho || 0, Cd: base.Cd || 0, Cl: base.Cl || 0,
    frontalArea: base.frontalArea || 0,
    downforceBalance: (base.downforceBalance != null) ? base.downforceBalance : 0.5,
    sensorMaxMm: Math.round(base.sensorMaxMm * kL), topKmh: topKmh || base.topKmh,
    realKmh: base.realKmh || false,
  };
}

// 登録済み第二領域: 卓上を 長さ2倍 (μ/g 同) した Froude 相似領域 (中スケール ≒ 屋外 RC)。
// 動的相似により Ay* は卓上と不変 = 「同じプログラムが大きく速い世界でも同じ操作で滑り出す」。
// 車体は2倍 (carScale と合成)。既存コースでも操作可能 (コース側のスケール化は Phase F の後段)。
// 真のフルスケール 350km/h レース (等方実μ+ダウンフォースで相似が破れ「速度=グリップ」) は
// 空力が要るため F3 で追加する (F0 監査 regime-7 と一致)。
REGIMES.midscale = scaleRegime(REGIMES.tabletop, {
  name: '中スケール (屋外 RC 相当)',
  desc: '卓上を長さ2倍・速度√2倍した相似領域。Ay* は卓上と同じ=同じプログラムが同じ挙動 (動的相似)。',
  kL: 2, topKmh: 500,
});

// 登録済み第三領域: 真のフルスケール・レース (実車 2.6m・最高速 ~350km/h) (Phase F3)。
// 中スケール (Froude 相似) と違い、これは**動的相似が意図的に破れた**領域:
//   - 路面μが等方の実μ (muY=muX) — 卓上の異方性ハック (muY≪muX) は不要 (本物のタイヤは等方)。
//     → ノーマル車は grip 化し、滑るには本物どおり「攻めて荷重/速度で限界を超える」必要がある。
//       (ドリフト車の縦μ muXDrift のみ Phase J2 で 0.48 に下げ、持続ドリフトを成立させた=下記 muXDrift コメント)
//   - 空力 (抗力+ダウンフォース) が効く: ダウンフォースが荷重 n を v² で増やし、摩擦円半径 μ·n が
//     速度依存になる → 「速度=グリップ」(速いほど曲がれる)。抗力が推力と釣り合って最高速を自然決定。
//   - 摩擦円が双方向ラジアル (circleBi=1): combined-slip でグリップ限界、横荷重が縦力を削る (sign-2 解消)。
// これらで卓上では到達不能な a_y/(μg)→1 が「速度を上げるだけ」で自然に起き、ハック無しで本物どおり滑る。
// 速度は実速度 (realKmh=true) なので displayKmh は m/s×3.6 を直接表示する (写像しない)。
REGIMES.fullscale = {
  name: 'フルスケール・レース (実車 350km/h)',
  desc: '実寸 2.6m・最高速約350km/h。等方実μ+空力ダウンフォースで「速度=グリップ」。上級/競技向け。',
  L: 2.6,                  // 実車ホイールベース (m)
  g: 9.81,
  // 等方実μ (前後横とも縦と同じ=本物のグリップ)。ノーマル車は circleBi=1 の combined-slip で
  // 「攻めて限界を超える」スピン (G2 の US/OS 教材) が創発する。
  // muXDrift (ドリフト車の縦μ) だけは 1.0→0.48 に下げる (Phase J2・再スコープ direction c)。
  //   理由: フルスケールは等方実μで「drift 車も grip 化」する設計だったため、ドリフト車が
  //   サーキットで即スピンし**持続ドリフトが物理的に存在しなかった** (J-4 付随事実)。縦μを下げると
  //   全開で後軸の駆動需要が縦容量を超えて空転 → 摩擦楕円で後軸横力が抜ける = パワーオーバーが復活し、
  //   保持プログラムで持続スライド (旋回平均|β|≈53°・90秒無事故・~1186m 周回) が成立する (J-5 実測)。
  //   muXDrift はドリフト車のみ参照 (physics_dyn.js: `drift ? DYN.muXDrift : DYN.muX`) ＝ ノーマル車
  //   (normal_ff/fr/awd, muX=1.4) は完全不変 (G2/test_g2/test_comp 非影響)。卓上/中スケールも不変 (byte 不変)。
  muY: 1.4, muYDrift: 1.0, muX: 1.4, muXDrift: 0.48,
  C0: 60.0,                // 実タイヤ相当のコーナリング剛性 (α_peak≈0.1rad で飽和)
  // 速度・加速度系 (実車スケール)。最高速 maxSpeed は目標値で、実際の頭打ちは抗力との釣り合いで決まる。
  maxSpeed: 110, accel: 5.4, brake: 40.0, coast: 3.0, steerRate: 2.0,
  // ドリフト車のみ操舵上限を ×2.5 (≈±60°) に拡大 (I2)。実車レーサー的な大舵角カウンター(逆ハン)を
  // 可能にする。卓上/中スケールは driftSteerMul 未定義=1 で ±24° 実機準拠のまま (byte 不変)。
  // ノーマル車には非適用 (Circuit Racer の安定周回=test_g2 に非影響)。
  driftSteerMul: 2.5,
  // 低速・数値系 (実速度スケールの停止特異点ガード。~m/s 域でのみ作用)。
  uBlend0: 0.5, uBlend1: 2.0, absUFloor: 0.5, uStop: 0.3, uStopHard: 0.01,
  vlatStop: 0.5, nSub: 4, adaptiveSub: true,
  // タイヤ横力曲線 (tire-1, F4)。実タイヤは早期 (≈0.25rad≈14°) にピーク → 限界後はやや深く落ち込む
  // (荷重/速度で限界を超える本物の挙動)。卓上より αpeak 小・kDecay 大。ダウンフォースで μ·n が v² 成長し
  // ピーク横力自体が増えるため Part F の steady-turn では Ay*>1.05 (bare μg 超のグリップ) が成立する。
  // 暫定値: F3 (空力) 本活性化時に f1_regime Part F で全車種 Ay* を実測しながら早期ピークへ調律する。
  alphaPeak: 0.25, kDecay: 0.60,
  // kinFactor フェード (F-kin)。フルスケールは相似破れ (等方実μ+空力+早期ピーク F4 曲線) で US/OS の
  // 物理母体がそろうため、入力側シム kinFactor/steerK を恒等(0)へ撤去し US/OS を物理から創発させる。
  // 卓上(1)→fullscale(0) は連続ブレンドで適用 (二値禁止)・circleBi 0→1 と同じ境界 (相似破れと一致)。
  kinFade: 0,
  // 摩擦円双方向結合 (tire-3, F2)。等方実μで combined-slip = ラジアル円。
  circleBi: 1,
  // 左右(横)荷重移動 (Z2 / IMP-01)。実車の横加速度が重心高×トレッドで外内輪へ荷重を移し、タイヤ荷重感度で
  // 各軸の有効横グリップが gm=1−latLoadK·(φ·ay/n)² に目減りする。値の根拠 (重心/トレッド/ホイールベース基準):
  // latLoadK = 4·loadSens·(h/track)²。h≈0.45m(実車重心高)・track≈1.6m → (h/track)²≈0.079、loadSens≈0.158
  // (荷重倍化で横グリップ約16%減の乾燥レースタイヤ相当) → latLoadK≈0.05。φ=前軸静的比なので定常旋回は前後
  // 均等目減りで Part F(normal_awd 定常 Ay*=1.067>1.05・余裕 0.017) を保ち、効果はトレイル制動/複合荷重
  // (nR↓で(φ·ay/nR)²増) に自己集中して荷重連成 US/OS を創発 (FR ブレーキOS β偏移 +75°→+80°・FF +3°→+8°)。
  // 上限 0.06 まで Part F 維持・0.08 で割れる (sweep 実測)。卓上/中スケールは latLoadK=0 で寄与ゼロ (byte 不変)。
  latLoadK: 0.05,
  // 車輪スリップ率/縦力 (Phase F5)。フルスケールでのみ活性化。車輪面速度 vw=ωR を陽的 Euler 積分し、
  // スリップ率 s=(vw−u)/|u| から縦版 Pacejka Fx=μx·n·gx(s) (sin(C·atan(B·s)) を sPeak で正規化) を導く。
  // wheelLambda=λ=m·R²/Iw (車輪応答の速さ・剛さ)、sPeak=ピークスリップ率 (乾燥アスファルト ≈0.10)。
  // driveBand/wheelPower/launchAccel = 定出力ドライブトレイン: 低速はトルク律速 launchAccel·accel、高速は
  // 出力律速 wheelPower/|u| で、ローンチでトルク>グリップ → 車輪が空転 (accel=5.4/muX=1.4 は不変)。
  // 251km/h で hook-up し定常巡航 347km/h は s≈0.01<sPeak で空転せず抗力律速 (Part F 維持)。
  wheelDyn: 1, wheelLambda: 28.0, sPeak: 0.10, wheelB: 14.0, wheelC: 1.7,
  driveBand: 6.0, wheelPower: 547, launchAccel: 15.0,
  // 空力 (F3)。トップフォーミュラ級の高ダウンフォース。ダウンフォースで μ·n が v² 成長 → 高速ほどグリップ。
  rho: 1.225, Cd: 0.9, Cl: 3.0, frontalArea: 1.3, downforceBalance: 0.45,
  // ── v2 エンジン専用の較正 (Stage AO5・applyRegimeV2 が V2 holder へ書込・**旧 DYN 経路は無改変**) ──
  // DYN.launchAccel(=15)/wheelPower(=547) は単軌道 DynCar 向けで、v2 の4輪 two-track では後軸グリップに対し
  // 過大 (AO-3 intel: FR launch 需要15.75/後軸グリップ7.55≈2.09 → κが±3クランプに張り付く全面空転)。v2 は
  // 4輪で軸荷重を正しく分けるため、駆動を実際の軸容量へ再フィットする。DynCar (=AN 較正の fullscale サンプル)
  // は DYN.* をそのまま読むので不変。tabletop/midscale は .v2 を持たない=applyRegimeV2 が 0 (CAR.accel 律速)
  // へフォールバック (卓上 dynamic と同型・AO6 が tire セット/領域可変化で拡張)。
  v2: { launchAccel: 7.0, wheelPower: 455 },
  // v2 タイヤセット (Stage AO6・AO_spec §4)。normal=スリック μ0=1.4 (=AO5 較正の現行値そのまま=fullscale
  // 既定 v2 の byte 不変)。slip=ハードコンパウンド相当 μ0=0.9 (帯 0.8–1.0)＝縦グリップが下がり全開で後軸が
  // 縦容量を超えて空転 → パワーオーバー/ブレーキドリフトの母体 (卓上 slip と同型の縮尺値・§11「slip タイヤで
  // 同型」)。muDecay=0.95 でピーク後ほぼ平坦=滑っても食い続けるドリフト向き。既定 normal は AO5 と完全一致。
  // rain (Stage AS9)= フルウェットタイヤ。mu0 は normal の **ρ=0.85 倍** (1.4×0.85=1.19) で卓上と同比
  // ⇒ 交差点 g*=0.7987 が領域不変 (卓上コメント参照)。wetGain は無次元ゆえ領域共通。
  v2tire: {
    normal: { mu0: 1.4,  muDecay: 0.75, alphaP: 0.14, kappaP: 0.10, relLenFrac: 0.5 },
    slip:   { mu0: 0.9,  muDecay: 0.95, alphaP: 0.25, kappaP: 0.18, relLenFrac: 0.6 },
    rain:   { mu0: 1.19, muDecay: 0.80, alphaP: 0.16, kappaP: 0.11, relLenFrac: 0.55, wetGain: 0.70 },
  },
  // 表示・知覚メタ。realKmh=true → displayKmh は実速度を直接 km/h 化 (没入写像なし)。
  // sensorMaxMm=150000 (150m): フルスケールは ~96m/s・brake40m/s² で停止距離 ~115m。ToF 40m では
  // 「見えてから止まれない」ため、3センサーで先読みブレーキ&ターンの実寸サーキットレース (G2) が
  // 成立しない。実車のレーダ/LiDAR 相当の見通し (120〜250m) に合わせ 150m へ拡張 (Phase G2・許可済み
  // fullscale チューニング)。競技グラウンドの TC/ABS サンプルは ToF を読まない (車輪エンコーダのみ) ので
  // この拡張の影響を受けない (test_comp 不変)。卓上/中スケールの sensorMaxMm は不変 (卓上 byte 不変)。
  sensorMaxMm: 150000, topKmh: 350, realKmh: true,
};

// 走行軌跡の保持量 (利用者が増減可能)。max = 保持する最大点数 (点間隔は約1cm)。
export const TRAIL = { max: 4000 };

// コースエディタのグリッドスナップ単位 (m)
export const GRID = { step: 0.05 };

// 実行
export const SIM = {
  loopHz: 20,          // ユーザー loop() 呼び出し頻度
  physicsHz: 60,       // 物理更新頻度
  maxStepsPerTick: 200000, // 1 反復あたりの評価ステップ上限 (暴走防止)
};
