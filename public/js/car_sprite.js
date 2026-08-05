// car_sprite.js — 車スプライト（シルエット）の設計頂点（k=1 設計フレーム・単位 m）の単一真実源。
// 描画 hud.drawCar と検証ゲート（wf_sprite_extent.mjs / wf_silhouette_fill.mjs）が同一定義を共有し、
// 実装と検証を乖離させない。
//
// Stage AL（2026-07-01・利用者指示）: 単一 CAR_SPRITE（レーシングカー風・分離した複数塊）→ CAR_SPRITES
//   （キー付きシルエット集合）。狙いは「描画スプライトを一体の車らしい形にして見た目と矩形フット
//   プリントの知覚整合（走行リアルさ・認知性）を上げる」描画層のみの改修。意匠中立（実在車の固有
//   意匠/バッジを模さない）。
//   - AL1: 既定 'sport'（汎用スポーツカー・一体ボディ）。
//   - AL2: 6 組込車種 normal_fr/ff/awd・drift_fr/ff/awd を作り分け（色×形の二重符号化＝色だけでなく
//     形でも判別）。全車で AL1 の「車らしさ下限」（充填 ≥95%・連結 ≥90%・前方 ≥90%）を共有ボディで
//     担保し、識別は**プロポーション/可視特徴**（グラスハウス位置/大きさ・ホイールベース・トレッド
//     スタンス幅・リアウイング）で与える。custom/未知 type は既定 'sport' へフォールバック。
//     ※ 識別基準は「本物のオラクルが算出する正規化特徴ベクトル `[GC,GL,WB,TR,RW]` の任意2組込間
//        L2 距離 ≥ 0.15」（当初案 (1−IoU)≥0.15 は充填 ≥95% と数学的両立不能ゆえ CI-5 是正・AL-2）。
//
// Stage AH（GitHub #26 §4/§7-6・CI-14）の不変条件（保持）:
//   すべてのソリッド車体頂点を「衝突フットプリント（physics.Car.corners() が成す矩形）」内へ
//   写像する fitToFootprint を提供する。→ 描画スプライト ⊆ 衝突フットプリント を構造的に保証。
//   衝突フットプリントは物理/配置（AG1 freeSpawn）が必ず壁から離して置くので、これだけで
//   「車が壁を跨いで見える」視覚破綻が、いかなるコース・スケール・配置・走行中でも起きなくなる。
//   物理・配置・決定論ハッシュは無改変（car_sprite.js を import するのは描画 hud.js のみ）。
//
// 各シルエットの構造:
//   solid:      bbox/充填/AH の母集団となる「ポリゴン部品名」の配列（例 ['body'] / ['body','rearWing']）。
//   body:       一体ボディ（必須・ソリッド）。全車で共有（= AL1 充填/連結/前方の下限を担保）。
//   wheelHalf:  タイヤ半寸 {x,y}（操舵時に前輪 wheels[0],[1] が steerAngle で回転して描かれる）。
//   wheels:     タイヤ中心 4 点（[0],[1]=前輪＝操舵）。ソリッド（矩形展開して bbox/充填に算入）。
//               → ホイールベース（前後 x 差）・トレッド（左右 y スタンス幅）が駆動別の識別特徴。
//   canopy:     グラスハウス（キャビン・演出＝ソリッド非算入）。位置/大きさが駆動別の識別特徴（GC/GL）。
//   rearWing:   リアウイング（drift のみ・ソリッド）。テールに描く全幅バー＝ドリフト系の識別特徴（RW）。
//   noseAccent: 先端アクセント点（ソリッド・面積ほぼ0）。
//   shadow / stripe / canopyHi: 装飾（影＝方向性ソフトFX・他はボディ内側）。bbox 非算入。
//
// 値は hud.drawCar の実描画と一対一（drawCar はこの定数を参照し、存在する部品のみ描く）。

// ===== 全車共有の一体ボディ／装飾（sport と同一＝AL1 で検証済の充填 98.2%・連結 100%・前方 96.8%）=====
// 角丸ノーズ/テール・側面はほぼ全幅。bbox = x[-0.05,0.17] y[±0.044]。
const BODY = [
  [0.170, 0.030], [0.161, 0.041], [0.150, 0.044],   // 前ノーズ（角丸・前縁ほぼ全幅）
  [0.060, 0.044], [-0.020, 0.044],                   // 側面（ほぼ全幅）
  [-0.040, 0.042], [-0.050, 0.034],                  // 後コーナー（角丸）
  [-0.050, -0.034], [-0.040, -0.042],                // 後端
  [-0.020, -0.044], [0.060, -0.044],                 // 側面（ほぼ全幅）
  [0.150, -0.044], [0.161, -0.041], [0.170, -0.030], // 前ノーズ（角丸）
];
const STRIPE = [[0.155, 0], [0.120, -0.0055], [-0.045, -0.0055], [-0.045, 0.0055], [0.120, 0.0055]];
const SHADOW = [[0.165, 0.012], [0.0, 0.046], [-0.05, 0.036], [-0.05, -0.012], [0.0, -0.018]];
const NOSE_ACCENT = [0.158, 0];
const WHEEL_HALF = { x: 0.018, y: 0.009 };  // steer-safe（±maxSteer 回転しても footprint 内）

// グラスハウス（六角形・演出）。前端 F・後端 R・半幅 HW。中心 x（GC）と x 長さ（GL）が駆動別の識別特徴。
function canopyPoly(F, R, HW) {
  return [[F, 0], [F - 0.022, -HW], [R + 0.014, -HW], [R, 0], [R + 0.014, HW], [F - 0.022, HW]];
}
// リアウイング（テールの全幅バー・ソリッド）。depth=x 厚み・HW=半幅（body 後端より僅かに張り出し可視化）。
function rearWingPoly(depth, HW) {
  const x0 = -0.05, x1 = -0.05 + depth;
  return [[x0, -HW], [x1, -HW], [x1, HW], [x0, HW]];
}
// シルエット生成: 共有ボディ＋駆動別の canopy/wheels/(rearWing)。cab*=グラスハウス・w*X=前後輪 x・
//   ftY/rtY=前/後トレッド（片側 |y|）・wing={depth,hw}（drift のみ）。
function mkSil({ cabF, cabR, cabHW, wfX, wrX, ftY, rtY, wing }) {
  const s = {
    solid: wing ? ['body', 'rearWing'] : ['body'],
    shadow: SHADOW,
    wheelHalf: WHEEL_HALF,
    wheels: [[wfX, ftY], [wfX, -ftY], [wrX, rtY], [wrX, -rtY]], // [0],[1]=前輪(steer 回転)
    body: BODY,
    stripe: STRIPE,
    canopy: canopyPoly(cabF, cabR, cabHW),
    canopyHi: [[cabF - 0.02, -0.006], [cabF - 0.046, -0.015], [cabF - 0.056, -0.006]],
    noseAccent: NOSE_ACCENT,
  };
  if (wing) s.rearWing = rearWingPoly(wing.depth, wing.hw);
  return s;
}

export const CAR_SPRITES = {
  // 既定/フォールバック: 汎用スポーツカー（custom/未知 type 用・一体ボディで矩形を充填・意匠中立）。
  sport: {
    solid: ['body'],
    shadow:    SHADOW,
    wheelHalf: WHEEL_HALF,
    wheels:    [[0.115, 0.025], [0.115, -0.025], [-0.012, 0.030], [-0.012, -0.030]],
    body:      BODY,
    stripe:    STRIPE,
    canopy:    [[0.058, 0], [0.030, -0.020], [-0.012, -0.020], [-0.028, 0], [-0.012, 0.020], [0.030, 0.020]],
    canopyHi:  [[0.038, -0.006], [0.012, -0.015], [0.002, -0.006]],
    noseAccent: NOSE_ACCENT,
  },

  // ===== 6 組込車種（AL2・色×形の二重符号化）=====
  // 駆動形式でプロポーションを差別化: FR=ロングノーズ・クーペ（キャビン後方・ロング WB）／
  //   FF=キャブフォワード・ハッチ（キャビン前方・大きめ・ショート WB）／AWD=ワイドスタンス（広トレッド・中間 WB）。
  // 性格でドリフト系を差別化: drift はテールの全幅リアウイング＋一段広いトレッド（normal より攻撃的）。
  normal_fr:  mkSil({ cabF: 0.030, cabR: -0.035, cabHW: 0.019, wfX: 0.120, wrX: -0.024, ftY: 0.023, rtY: 0.023 }),
  normal_ff:  mkSil({ cabF: 0.078, cabR: -0.008, cabHW: 0.023, wfX: 0.098, wrX:  0.008, ftY: 0.023, rtY: 0.023 }),
  normal_awd: mkSil({ cabF: 0.052, cabR: -0.024, cabHW: 0.020, wfX: 0.112, wrX: -0.012, ftY: 0.025, rtY: 0.030 }),
  drift_fr:   mkSil({ cabF: 0.030, cabR: -0.035, cabHW: 0.019, wfX: 0.120, wrX: -0.024, ftY: 0.024, rtY: 0.028, wing: { depth: 0.037, hw: 0.040 } }),
  drift_ff:   mkSil({ cabF: 0.078, cabR: -0.008, cabHW: 0.023, wfX: 0.098, wrX:  0.008, ftY: 0.024, rtY: 0.028, wing: { depth: 0.037, hw: 0.040 } }),
  drift_awd:  mkSil({ cabF: 0.052, cabR: -0.024, cabHW: 0.020, wfX: 0.112, wrX: -0.012, ftY: 0.026, rtY: 0.034, wing: { depth: 0.037, hw: 0.040 } }),
};

// 既定シルエットのキー（未知/custom type のフォールバック先）。
export const DEFAULT_SPRITE = 'sport';

// AL2 識別基準の対象＝config.js CAR_TYPES と一致する 6 組込キー（sport フォールバックは対象外）。
export const BUILTIN_SPRITES = ['normal_fr', 'normal_ff', 'normal_awd', 'drift_fr', 'drift_ff', 'drift_awd'];

// car.type → シルエット解決（未知/custom は既定 sport へフォールバック）。描画層に閉じる。
export function spriteFor(type) {
  return (type && CAR_SPRITES[type]) || CAR_SPRITES[DEFAULT_SPRITE];
}

// fit 対象のソリッド頂点（steer=0・影/演出 除外）= 外接 bbox・充填・AH 母集団。
export function solidVerts(sprite) {
  sprite = sprite || CAR_SPRITES[DEFAULT_SPRITE];
  const v = [];
  for (const k of sprite.solid) v.push(...sprite[k]);
  if (sprite.wheels && sprite.wheelHalf) {
    const { x: hx, y: hy } = sprite.wheelHalf;
    for (const [wx, wy] of sprite.wheels) v.push([wx - hx, wy - hy], [wx + hx, wy - hy], [wx + hx, wy + hy], [wx - hx, wy + hy]);
  }
  if (sprite.noseAccent) v.push(sprite.noseAccent);
  return v;
}

// シルエット設計 bbox（ソリッド・k=1）。fit はこの bbox の隅をフットプリントの隅へ写す。
export function spriteBBox(sprite) {
  sprite = sprite || CAR_SPRITES[DEFAULT_SPRITE];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of solidVerts(sprite)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, x1, y0, y1 };
}

// 設計頂点 (lx,ly) を衝突フットプリント foot{back,front,hw} 内へ per-axis 線形写像。
// bbox の隅 → フットプリントの隅、なので fit 後の全ソリッド頂点が必ずフットプリント内に入る。
// bbox を省略すると既定シルエットの bbox（後方互換）。
export function fitToFootprint(lx, ly, foot, bbox) {
  const b = bbox || SPRITE_BBOX;
  return [
    foot.back + (lx - b.x0) / (b.x1 - b.x0) * (foot.front - foot.back),
    -foot.hw + (ly - b.y0) / (b.y1 - b.y0) * (2 * foot.hw),
  ];
}

// 既定シルエット(sport)の bbox（fitToFootprint の bbox 省略時フォールバック）。
const SPRITE_BBOX = spriteBBox(CAR_SPRITES[DEFAULT_SPRITE]);
