// 距離センサーのコーン測距 (前方3 + 任意の後方1)。VL53L0X 相当の 25° 視野コーンで
// 「扇内の最近反射面」を返す (Stage AM1・#27)。中心1本の直線レイでは凸コーナー端点の外を
// 掠め遠い壁で止まる「壁の外へ抜ける」現象が起きたため、扇内最近距離へ置換した。
import { SENSORS, SENSOR_REAR, SENSOR_RANGE, SENSOR_NOISE, SENSOR_FOV, CAR } from './config.js';
import { coneNearest } from './geom.js';
import { wallsNear } from './contact_v2.js';

// 壁ブロードフェーズ候補限定 (AP6)。車位置中心・半径 = センサー最大レンジ + 1.5×車長 (センサー原点の
// 前方オフセット ≤ 車長 を覆う余裕) の円を包む AABB の候補壁のみを readSensor へ渡す。半径がレンジ+オフセット
// を確実に上回るので「レンジ内で最近反射面になり得る壁」は必ず候補に入る (=全走査と同じ最小値・mm/hit byte
// 一致)。等価性は wf_ao1_v2 の E 手法 (41 コース×多ポーズ 差分ゼロ) で実証済。壁数<32・照会が全域被覆
// (卓上=レンジがコースを覆う) は元配列を返す (受け入れ④・確保ゼロ)。**グリッドのセル寸法=maxM の粗セル**
// を使う (レンジ照会は細セルだと数百セルを跨いで全走査より遅い=AP6 実測)。SENSOR_RANGE.maxMm と CAR.length は
// applyRegime で領域スケールされる値を呼び出し時に読むので tabletop/fullscale いずれも正しい半径・セルになる。
function wallCandidates(car, walls) {
  const maxM = SENSOR_RANGE.maxMm / 1000;
  return wallsNear(walls, car.x, car.y, maxM + 1.5 * CAR.length, maxM);
}

// 標準正規乱数 (Box-Muller)。M1 (#18①) の実機ノイズ注入専用 = SENSOR_NOISE.on のときだけ呼ばれる。
// OFF では到達しないため、既定経路の決定論・卓上 byte 不変を一切壊さない。
function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 1 センサーの計測。戻り値 {mm, hit:{x,y}, origin:{x,y}}。返り形は不変 (描画・API 互換)。
// extra: 追加線分 (他車の車体エッジ等)。壁と同様にコーン測距の対象に含める。
// 中心1本の直線レイでなく 25° 視野コーン (SENSOR_FOV) の「扇内最近反射面」までの距離を返す。
function readSensor(car, walls, sensorDef, extra = []) {
  const c = Math.cos(car.theta), s = Math.sin(car.theta);
  const ox = car.x + sensorDef.dx * c - sensorDef.dy * s;
  const oy = car.y + sensorDef.dx * s + sensorDef.dy * c;
  const ang = car.theta + sensorDef.yaw;
  const ux = Math.cos(ang), uy = Math.sin(ang);       // 扇の中心方向 (単位)
  const cosH = SENSOR_FOV.cosHalf, sinH = SENSOR_FOV.sinHalf;
  const pt = [0, 0];                                   // coneNearest の最近点出力 (呼び出しごとに1個)
  let best = Infinity, hx = 0, hy = 0;                 // 扇内最近点 (world)
  let hitCar = false;                                  // AP19: 扇内最近反射面が他車エッジ(extra)か壁か。反射率で σ を変える(carSigmaMul)ためだけに使う=測距値(mm)/hit は不変(byte 不変)。
  for (const w of walls) {
    const d = coneNearest(ox, oy, ux, uy, cosH, sinH, w.x1, w.y1, w.x2, w.y2, pt);
    if (d < best) { best = d; hx = pt[0]; hy = pt[1]; hitCar = false; }
  }
  for (const w of extra) {
    const d = coneNearest(ox, oy, ux, uy, cosH, sinH, w.x1, w.y1, w.x2, w.y2, pt);
    if (d < best) { best = d; hx = pt[0]; hy = pt[1]; hitCar = true; }
  }
  const maxM = SENSOR_RANGE.maxMm / 1000;
  let mm, hit;
  if (best === Infinity || best > maxM) {
    mm = -3; // 範囲外 / 扇内に反射面なし / 信号品質低下
    hit = { x: ox + ux * maxM, y: oy + uy * maxM };    // 空扇=中心方向の最大レンジ (描画既定)
  } else {
    mm = Math.round(best * 1000);
    hit = { x: hx, y: hy };                            // 扇内の最近反射点
  }
  // 実機(VL53L0X)相当のノイズ/欠測注入 (M1, #18① + AP19 ②外れ値/距離依存欠測/他車反射率)。既定 OFF=
  // このブロックに入らない=乱数を一切呼ばない。有効測距 (mm>=0) のみ対象 (範囲外 -3 はそのまま)。AP19 の
  // 追加3項は既定 (outlier=0/dropoutFar=0/carSigmaMul=1) で従来経路へ厳密縮退 (乱数消費列・byte 不変)。
  if (SENSOR_NOISE.on && mm >= 0) {
    const bearX = (hx - ox) / best, bearY = (hy - oy) / best;  // 扇内最近点への実方位 (単位)
    // AP19 ②-a spurious 外れ値 (D2)。既定 outlier=0 → 左辺短絡で Math.random は呼ばれない=乱数列/byte 不変。
    //   発火時は真距離と無相関な [outlierMinMm, レンジ] 一様値で差し替え (クロストーク/2次反射相当)。CONF ゲート
    //   (>信頼閾 or 負) が実際に発火し得る値を生成する=samples の CONF 教材を演習可能にする狙い。
    if (SENSOR_NOISE.outlier > 0 && Math.random() < SENSOR_NOISE.outlier) {
      mm = Math.round(SENSOR_NOISE.outlierMinMm + Math.random() * (maxM * 1000 - SENSOR_NOISE.outlierMinMm));
      const dN = mm / 1000;
      hit = { x: ox + bearX * dN, y: oy + bearY * dN };
    // AP19 ②-b 距離依存欠測 (D3)。dropoutFar=0 → 閾値=SENSOR_NOISE.dropout (従来値) ゆえ同一乱数・同一比較=byte 不変。
    //   best[m] に比例して欠測率を上げる (遠距離ほど信号品質低下=実機 ToF)。
    } else if (Math.random() < SENSOR_NOISE.dropout + SENSOR_NOISE.dropoutFar * best) {
      mm = -3;  // 欠測(タイムアウト)=実機の無効測距。範囲外と同じコードに統一 (既存プログラムが扱える)。
      hit = { x: ox + ux * maxM, y: oy + uy * maxM };
    } else {
      // AP19 ②-c 他車反射率。他車エッジ標的は低反射率で σ が carSigmaMul 倍に荒れる。carSigmaMul=1 (壁/既定) は×1=従来。
      const mul = hitCar ? SENSOR_NOISE.carSigmaMul : 1;
      const sigma = (SENSOR_NOISE.sigmaBaseMm + SENSOR_NOISE.sigmaFrac * mm) * mul;
      mm = Math.max(0, Math.round(mm + sigma * gauss()));
      const dN = mm / 1000;
      hit = { x: ox + bearX * dN, y: oy + bearY * dN };  // レイ可視化も注入後の距離に沿わせる
    }
  }
  // dir = 扇の中心方向 (単位)。AM1 の {mm,hit,origin} に加える描画専用の追加フィールド (後方互換=既存
  // 消費側は mm/hit/origin のみ参照)。real hit のとき hit は扇内の非対称な最近点ゆえ (hit-origin) から
  // 中心方向は復元できない → 測距と同一幾何を持つ本モジュールが中心方位を供給する (AM2 コーン描画の単一
  // 真実源)。測距値 (mm) は不変ゆえ verifyHash/卓上 byte・学習 API(.mm のみ参照) には一切影響しない。
  return { mm, hit, origin: { x: ox, y: oy }, dir: { x: ux, y: uy } };
}

// 前方3 センサー一括。idx 0:LEFT 1:CENTER 2:RIGHT。extra=他車エッジ等。
// AP6: 壁は車ごとに1回だけ候補限定し (wallCandidates)、3 センサーで共用する (照会1回/読取)。
export function readAll(car, walls, extra = []) {
  const cand = wallCandidates(car, walls);
  return SENSORS.map(def => readSensor(car, cand, def, extra));
}

// 任意装備の後方センサー (idx 3:BACK)。有効時のみ呼ぶ。戻り値は readSensor と同形 {mm,hit,origin}。
export function readRear(car, walls, extra = []) {
  return readSensor(car, wallCandidates(car, walls), SENSOR_REAR, extra);
}
