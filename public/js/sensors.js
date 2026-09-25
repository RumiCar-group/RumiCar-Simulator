// 距離センサーのコーン測距 (前方3 + 任意の後方1)。VL53L0X 相当の 25° 視野コーンで
// 「扇内の最近反射面」を返す (Stage AM1・#27)。中心1本の直線レイでは凸コーナー端点の外を
// 掠め遠い壁で止まる「壁の外へ抜ける」現象が起きたため、扇内最近距離へ置換した。
import { SENSORS, SENSOR_REAR, SENSOR_RANGE, SENSOR_NOISE, SENSOR_OPTICS, SENSOR_FOV, CAR } from './config.js';
import { coneNearest, fanHits } from './geom.js';
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

// --- AS8: 実機 ToF の光学モデル (opt-in・決定論)。SENSOR_OPTICS.on のときだけ呼ばれる。--------------
// 扇を rays 本の方向へ離散化し (fanHits)、方向ごとの最近反射面から反射信号レートを組み立てる:
//   S_k = ρ_k · cosθ_k · (maxM/d_k)²      (Lambertian 拡張標的。S=1 が公称レンジ maxM の信号量)
// 平均 S̄ = ΣS_k/K が 1 未満なら「信号レート下限を割った」= 実機の無効測距 (-3) とする
//   (上流ライブラリ RumiCar.cpp:74-86 の setSignalRateLimit と同じ判定原理。config の一次情報を参照)。
// 有効なら距離は**信号加重平均** d_w = ΣS_k d_k / ΣS_k = 「扇内の複数反射面の混合」(mixed pixel)。
// さらにカバーガラス由来のクロストークを距離0の寄生信号として混ぜる:
//   d = d_w · S̄/(S̄ + xtalk)   ⇒ 弱信号 (遠方/暗い/斜め) ほど短側へ寄る系統誤差。
// 反射率は S にしか入らない ⇒ **単一標的の距離値は反射率で歪まない**（Pololu の公開記述どおり）。
// 乱数は一切呼ばない (決定論)。scratch 配列はモジュール内で使い回す (ON 時のみ確保・OFF は未確保)。
let _oD = null, _oC = null, _oK = null, _oN = -1;
function opticsRead(ox, oy, ux, uy, maxM, walls, extra) {
  const n = Math.max(1, Math.round(SENSOR_OPTICS.rays)) - 1;   // 分割数 (方向数 = n+1)
  if (_oN !== n) { _oD = new Float64Array(n + 1); _oC = new Float64Array(n + 1); _oK = new Int8Array(n + 1); _oN = n; }
  fanHits(ox, oy, ux, uy, SENSOR_FOV.halfRad, n, maxM, walls, extra, _oD, _oC, _oK);
  const K = n + 1;
  let sSum = 0, sdSum = 0, sMax = -1, kMax = -1, carSum = 0;
  for (let k = 0; k < K; k++) {
    if (_oK[k] < 0) continue;                                  // 反射面なし = 信号0 (S̄ を押し下げる = 標的サイズ依存)
    const d = _oD[k];
    if (!(d > 1e-9)) continue;                                 // 0 距離は信号無限大になるので数値安全側で捨てる
    const refl = _oK[k] === 1 ? SENSOR_OPTICS.carRefl : SENSOR_OPTICS.wallRefl;
    const cos = SENSOR_OPTICS.incidence ? _oC[k] : 1;
    const r = maxM / d;
    const s = refl * cos * r * r;
    if (s <= 0) continue;
    sSum += s; sdSum += s * d;
    if (_oK[k] === 1) carSum += s;
    if (s > sMax) { sMax = s; kMax = k; }
  }
  if (kMax < 0) return null;                                   // 扇内に反射面なし = 従来と同じ「範囲外」扱い
  const sBar = sSum / K;                                       // 扇全体で平均した信号レート (1 = しきい値)
  if (sBar < 1) return null;                                   // 低信号 = 無効測距 (実機の -3 / 生値 8190)
  // multipath=false は「最強信号の1面だけを見る」= 混合しない理想化 (効果の切り分け用)。
  const dW = SENSOR_OPTICS.multipath ? (sdSum / sSum) : _oD[kMax];
  const xt = Math.max(0, SENSOR_OPTICS.xtalk);
  const d = dW * (sBar / (sBar + xt));
  // 方位は最強信号の方向 (=実機が「見ている」向き)。距離は上で求めた測距値に沿わせる。
  const a = n === 0 ? 0 : -SENSOR_FOV.halfRad + (2 * SENSOR_FOV.halfRad) * (kMax / n);
  const ca = Math.cos(a), sa = Math.sin(a);
  const dx = ca * ux - sa * uy, dy = sa * ux + ca * uy;
  // hitCar は SENSOR_NOISE の carSigmaMul 用 (AP19)。混合後は「信号の過半が他車由来か」で決める。
  return { best: d, hx: ox + dx * d, hy: oy + dy * d, hitCar: carSum * 2 > sSum };
}

// 【BE7・2026-09-25】扇 (頂点 O・中心方向 u・半角 half) を半径 r で切った扇形を包む軸平行矩形を box へ書く。
// 扇形は半角 < 90° なので凸で、外接矩形は「O・両辺の端・扇の中にある軸方向 (±x/±y) の弧上の点」で決まる。
// pad は丸めに負けない余裕 (座標 1000 m でも double の丸めは 1e-13 m 程度)。
function coneBox(ox, oy, ux, uy, cosH, sinH, r, box) {
  const px = cosH * ux - sinH * uy, py = sinH * ux + cosH * uy;   // +half 方向 (coneNearest と同じ式)
  const mx = cosH * ux + sinH * uy, my = -sinH * ux + cosH * uy;  // -half 方向
  let x0 = Math.min(ox, ox + r * px, ox + r * mx), x1 = Math.max(ox, ox + r * px, ox + r * mx);
  let y0 = Math.min(oy, oy + r * py, oy + r * my), y1 = Math.max(oy, oy + r * py, oy + r * my);
  if (ux >= cosH) x1 = Math.max(x1, ox + r);    // +x 方向が扇の中 → 弧の右端
  if (-ux >= cosH) x0 = Math.min(x0, ox - r);
  if (uy >= cosH) y1 = Math.max(y1, oy + r);
  if (-uy >= cosH) y0 = Math.min(y0, oy - r);
  const pad = 1e-9 + 1e-9 * r;
  box[0] = x0 - pad; box[1] = x1 + pad; box[2] = y0 - pad; box[3] = y1 + pad;
}
const _cbox = new Float64Array(4);
// 候補がこれより少ないときは飛ばし判定をしない (矩形の計算の固定費が coneNearest を省く得より大きい。出荷の実測で、
// 壁 4 本のコースや卓上で候補が数本の広いコースだけが遅くなった)。飛ばしてもしなくても結果は同じ。
const SENSE_PRUNE_MIN = 16;

// 1 センサーの計測。戻り値 {mm, hit:{x,y}, origin:{x,y}}。返り形は不変 (描画・API 互換)。
// extra: 追加線分 (他車の車体エッジ等)。壁と同様にコーン測距の対象に含める。
// 中心1本の直線レイでなく 25° 視野コーン (SENSOR_FOV) の「扇内最近反射面」までの距離を返す。
// 【BE7・2026-09-25】壁の走査で、**扇を半径 R=min(その時点の最近距離, レンジ上限) で切った扇形の外接矩形に
//   外接矩形が掛からない壁は coneNearest を呼ばずに飛ばす**。旧経路は候補壁を全部 coneNearest に通しており、卓上では
//   候補がコースの全壁になる (レンジ 2 m がコースを覆う) ので壁の本数に比例した (実測・改修前: 卓上楕円を壁 20,000 本で
//   描いた投稿コースで、追従カメラ ON の 1 フレームの約 3 割が測距)。**結果は旧経路と 1 ビットも変わらない**:
//   走査順はそのまま。飛ばす壁は扇内最近点 Q (coneNearest が返す距離 d の点) を持つとしても Q は外接矩形の外＝
//   d > R。d > best の壁は `d < best` を満たさず状態を変えない。best がレンジ上限を超えている間の d > maxM の壁は
//   best を動かしうるが、そのとき最終的に best > maxM のまま (範囲内の壁は飛ばさないので必ず拾う) なら mm=-3・hit は
//   既定点で旧経路と同じ、範囲内の壁があればその壁で上書きされる (hitCar は mm<0 のとき使われない)。
//   光学モデル (opticsRead) は従来どおり候補壁の全部を渡す (飛ばしは扇内最近の走査だけ)。
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
  const prune = walls.length >= SENSE_PRUNE_MIN;       // BE7: 候補が少なければ飛ばさない (上の注記)
  const box = _cbox;
  let R = SENSOR_RANGE.maxMm / 1000;                    // BE7: 飛ばし判定の矩形の半径 (常に best 以上か、レンジ上限)
  if (prune) coneBox(ox, oy, ux, uy, cosH, sinH, R, box);
  for (const w of walls) {
    if (prune) {
      const wx0 = w.x1 < w.x2 ? w.x1 : w.x2, wx1 = w.x1 < w.x2 ? w.x2 : w.x1;
      const wy0 = w.y1 < w.y2 ? w.y1 : w.y2, wy1 = w.y1 < w.y2 ? w.y2 : w.y1;
      if (wx1 < box[0] || wx0 > box[1] || wy1 < box[2] || wy0 > box[3]) continue;   // BE7: 扇形に届かない壁
    }
    const d = coneNearest(ox, oy, ux, uy, cosH, sinH, w.x1, w.y1, w.x2, w.y2, pt);
    if (d < best) {
      best = d; hx = pt[0]; hy = pt[1]; hitCar = false;
      // BE7: 残りはこれより近い壁だけが意味を持つ。矩形は大きく縮んだとき (3/4 未満) だけ作り直す — 大きめの矩形の
      //   ままでも飛ばすのは届かない壁だけ (保守側) で、最近距離が少しずつ縮む並びで毎回作り直す固定費を払わない。
      if (prune && best < 0.75 * R) { R = best; coneBox(ox, oy, ux, uy, cosH, sinH, R, box); }
    }
  }
  for (const w of extra) {
    const d = coneNearest(ox, oy, ux, uy, cosH, sinH, w.x1, w.y1, w.x2, w.y2, pt);
    if (d < best) { best = d; hx = pt[0]; hy = pt[1]; hitCar = true; }
  }
  const maxM = SENSOR_RANGE.maxMm / 1000;
  // AS8: 光学モデル (opt-in・決定論)。ON のときだけ「扇内最近」を信号レートにもとづく測距で置き換える。
  // 低信号 (S̄<1) は best=Infinity に落として下の既存分岐へ渡す = mm=-3 (範囲外/低信号) の実機挙動。
  // OFF ではこのブロックへ入らない = 上の扇内最近がそのまま使われる (byte 不変)。
  if (SENSOR_OPTICS.on) {
    const o = opticsRead(ox, oy, ux, uy, maxM, walls, extra);
    if (o) { best = o.best; hx = o.hx; hy = o.hy; hitCar = o.hitCar; }
    else { best = Infinity; hitCar = false; }
  }
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
