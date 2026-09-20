// 描画 (車体・センサーレイ・軌跡) と HUD パネル更新。
import { VIEW, CAR, CONST, A11Y, CVD, CAR_FOOTPRINT, SENSOR_FOV, SENSOR_RANGE, APP_VERSION } from './config.js';
import { spriteFor, spriteBBox, fitToFootprint } from './car_sprite.js';
import { worldToScreen } from './course.js';
import { fanDepths } from './geom.js';
import { wallsNear } from './contact_v2.js';
import { fmtTime } from './lap.js';
import { darkenHex, hexRgb } from './color.js';
import { t } from './i18n.js';

export function drawTrail(ctx, car, view, color) {
  const tr = car.trail;
  if (tr.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color || VIEW.trail;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 軌跡フェード (PX-011): 古い点ほど淡く・新しい点ほど濃く描き、レース/観戦で複数台の
  // 古い軌跡が画面を埋め尽くすのを防ぐ。1点ずつ alpha を変えると重いので、軌跡を BANDS 本の
  // 帯に分けて帯ごとに globalAlpha を上げる (最大 BANDS 本の stroke で近似・帯の継ぎ目は重ねて連結)。
  const BANDS = 8, n = tr.length, ALPHA_MIN = 0.18;
  for (let b = 0; b < BANDS; b++) {
    const i0 = Math.floor((b * (n - 1)) / BANDS);
    const i1 = Math.floor(((b + 1) * (n - 1)) / BANDS);
    if (i1 <= i0) continue;
    ctx.globalAlpha = ALPHA_MIN + (1 - ALPHA_MIN) * ((b + 1) / BANDS);
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const s = worldToScreen(tr[i], view);
      if (i === i0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// お手本ライン (AB13・PX-014): 実走の軌跡(蛇行を含む)を時系列で移動平均し「なめらかな基準線」を
// 重ねて描く。3値(左右中央)操舵に由来する蛇行の“理想形”を可視化する純粋な表示補助で、物理・学習
// (ToF×3)・レース計算には一切関与しない (car.trail を読むだけ)。破線=ガイド線。実走の軌跡(同色)と
// 混ざらないよう、車色を白へ寄せて明るくし、暗い縁取り(casing)を敷いてどのテーマでも視認できる。
const REF_SMOOTH_R = 6;       // 移動平均の片側窓 (点≈1cm 間隔・±6=13点で蛇行波長を平滑)
const REF_MIN_PTS = 120;      // これ未満の短い軌跡では描かない (走り出し直後/早期クラッシュのスタブ抑制)
function lightenHex(hex, f) { // f=0..1 で白へ寄せる
  const c = hexRgb(hex);
  const m = (v) => Math.round(v + (255 - v) * f);
  return `rgb(${m(c.r)},${m(c.g)},${m(c.b)})`;
}
export function drawReferenceLine(ctx, car, view, color) {
  const tr = car.trail;
  if (!tr || tr.length < REF_MIN_PTS) return;
  const R = REF_SMOOTH_R, n = tr.length, sm = [];
  for (let i = R; i < n - R; i++) {
    let sx = 0, sy = 0;
    for (let k = i - R; k <= i + R; k++) { sx += tr[k].x; sy += tr[k].y; }
    const w = 2 * R + 1;
    sm.push(worldToScreen({ x: sx / w, y: sy / w }, view));
  }
  if (sm.length < 2) return;
  const trace = () => { ctx.beginPath(); for (let i = 0; i < sm.length; i++) { i === 0 ? ctx.moveTo(sm[i].x, sm[i].y) : ctx.lineTo(sm[i].x, sm[i].y); } };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([9, 6]); // 破線=実走でなく「お手本(基準)」のガイド線
  // 縁取り (どのテーマでも視認・実走軌跡と区別)
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 4.5; trace(); ctx.stroke();
  // 明るいコア (車色を白へ寄せて実走の同色軌跡と混同させない)
  ctx.strokeStyle = lightenHex(color || '#ffffff', 0.55); ctx.lineWidth = 2.2; trace(); ctx.stroke();
  ctx.restore();
}

// センサーの視野コーン描画 (Stage AM2・#27)。中心1本の直線でなく VL53L0X 相当の 25° 扇 (FoV) を、
// 距離2乗で淡くなる放射グラデーションで塗り、扇内最近反射面 (=測距 mm) で終端する。測距 (sensors.js)
// には一切触れない=描画のみ=byte/verifyHash 不変。s={mm,hit,origin,dir}。dir=扇の中心方向 (単位・
// sensors.js が測距と同一幾何から供給=単一真実源)。扇の頂点/端点は world 座標で作り worldToScreen で
// 写す (course.js の y 反転に非依存)。塗り alpha は放射グラデーションのストップに焼き込む (globalAlpha
// では半径方向に変えられないため)。近距離=濃/レンジ端(2m 相当)=FAN_FAR まで距離2乗で減衰。
const FAN_ALPHA = 0.20;   // 扇の頂点(最近距離)での塗り alpha。多車 (最大6台×3+後方=多数の扇) でも
                          //   下敷きの他車/壁を潰さない上限 (2枚重なりでも ~0.36・下地は過半が透ける)。
const FAN_FAR = 0.12;     // レンジ端での相対濃度 (頂点=1.0 に対する下限)。設計 AM2「2m で約0.12」。
const FAN_ARC_N = 8;      // 遠端アークの標本数 (全角25°を滑らかな弧に見せる最小限)。
// 方向別終端 (Stage AQ・GitHub #30) の方向標本数 (全角25°を約1°刻み=壁沿いのカットを滑らかに追従)。
const FAN_DEPTH_N = 24;
const _fanProf = new Float64Array(FAN_DEPTH_N + 1);  // 深度プロファイルの再利用バッファ (毎フレーム確保ゼロ)
function rayRgba(col, a) { const [r, g, b] = hexRgb(col); return `rgba(${r},${g},${b},${a})`; }

export function drawSensors(ctx, sensors, view, opts = {}) {
  if (opts.show === false) return;
  const col = opts.color || VIEW.ray;
  const dim = opts.color ? 0.85 : 1;                 // 複数台時は色付きで少し透過 (従来踏襲)
  const half = SENSOR_FOV.halfRad;
  const maxM = SENSOR_RANGE.maxMm / 1000;            // レンジ上限[m] (=減衰の基準距離・領域スケール込み)
  ctx.save();
  for (const s of sensors) {
    const o = worldToScreen(s.origin, view);
    // dir=扇の中心方向 (単位・sensors.js が供給=常在)。万一欠落した古い供給元でも扇が壊れないよう、
    // hit-origin を正規化した単位ベクトルへフォールバック (半径は R で決まり |d| に依存しない=不変)。
    let d = s.dir;
    if (!d) { const dx = s.hit.x - s.origin.x, dy = s.hit.y - s.origin.y, L = Math.hypot(dx, dy) || 1; d = { x: dx / L, y: dy / L }; }
    // 扇の半径[m]: 反射があれば最近反射面 (mm) で終端、空扇はレンジ上限まで=壁を貫いて伸びない。
    const R = s.mm >= 0 ? s.mm / 1000 : maxM;
    // 方向別の実到達距離 (Stage AQ・GitHub #30)。扇全体を一定半径 R (=扇内最近距離) のアークで
    // 打ち切ると、横の壁を掠っただけで前方が開けていても扇が空中で終端し、「同じ車種なのに
    // レーザーの長さが違う」ように見える。opts.walls (＋opts.extra=他車エッジ) がある時は方向ごとに
    // 壁/他車で終端する深度プロファイルで描く (壁沿いにカットされ、開いた方向はレンジまで伸びる)。
    // 測距値 (s.mm・ヒット点・ラベル) は従来どおり sensors.js の扇内最近=単一真実源で不変。
    // ノイズ注入 (SENSOR_NOISE)・保持値 (AP18) の mm は現在幾何と乖離し得るが、扇=現在の FoV 幾何・
    // 点/ラベル=計測値 の役割分担で描く (既定 OFF・非保持では min(プロファイル)≈mm で一致)。
    const prof = opts.walls
      ? fanDepths(s.origin.x, s.origin.y, d.x, d.y, half, FAN_DEPTH_N, maxM,
          wallsNear(opts.walls, s.origin.x, s.origin.y, maxM + 1e-6, maxM), opts.extra, _fanProf)
      : null;
    // 距離2乗減衰の放射グラデーション: 外半径=レンジ上限の screen px。扇 (半径 R≤maxM) は必ずこの内側。
    const far = worldToScreen({ x: s.origin.x + d.x * maxM, y: s.origin.y + d.y * maxM }, view);
    const rPx = Math.hypot(far.x - o.x, far.y - o.y) || 1;
    const grad = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, rPx);
    for (let k = 0; k <= 4; k++) {
      const tt = k / 4;                              // 距離/レンジ (0..1)
      const f = 1 - (1 - FAN_FAR) * tt * tt;         // 距離2乗減衰 (頂点1.0 → レンジ端 FAN_FAR)
      grad.addColorStop(tt, rayRgba(col, FAN_ALPHA * f * dim));
    }
    // 扇のパス (頂点 → -half から +half へ → 頂点)。全て world で作って写像 (y反転非依存)。
    // prof あり=方向別深度 (壁沿い終端)・なし=従来の一定半径 R アーク (フォールバック)。
    const arcN = prof ? FAN_DEPTH_N : FAN_ARC_N;
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    for (let k = 0; k <= arcN; k++) {
      const a = -half + (2 * half) * (k / arcN);
      const ca = Math.cos(a), sa = Math.sin(a);
      const r = prof ? prof[k] : R;
      const p = worldToScreen({ x: s.origin.x + (ca * d.x - sa * d.y) * r, y: s.origin.y + (sa * d.x + ca * d.y) * r }, view);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    // 扇の2辺の輪郭。色覚セーフ (AF4) は破線にして色だけでなく「扇の形」でも実走軌跡(実線)と区別する。
    ctx.strokeStyle = col;
    ctx.globalAlpha = dim;
    ctx.lineWidth = 1.2;
    if (opts.dash) ctx.setLineDash([6, 4]); else ctx.setLineDash([]);
    const cosH = Math.cos(half), sinH = Math.sin(half);
    // 2辺の長さも方向別終端に合わせる (+half 端=prof[末尾]・-half 端=prof[0]・なければ従来 R)。
    const rP = prof ? prof[FAN_DEPTH_N] : R, rM = prof ? prof[0] : R;
    const eP = worldToScreen({ x: s.origin.x + (cosH * d.x - sinH * d.y) * rP, y: s.origin.y + (sinH * d.x + cosH * d.y) * rP }, view);
    const eM = worldToScreen({ x: s.origin.x + (cosH * d.x + sinH * d.y) * rM, y: s.origin.y + (-sinH * d.x + cosH * d.y) * rM }, view);
    ctx.beginPath();
    ctx.moveTo(o.x, o.y); ctx.lineTo(eP.x, eP.y);
    ctx.moveTo(o.x, o.y); ctx.lineTo(eM.x, eM.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    // ヒット (扇内最近点) マーカ + ラベル (従来どおり・選択車のみラベル)。
    const h = worldToScreen(s.hit, view);
    if (s.mm >= 0) {
      ctx.fillStyle = col;
      if (opts.dash) ctx.fillRect(h.x - 3, h.y - 3, 6, 6);            // 四角マーカ (形状で区別)
      else { ctx.beginPath(); ctx.arc(h.x, h.y, 3, 0, Math.PI * 2); ctx.fill(); }
    }
    if (opts.labels) {
      // BB3: ラベルの文字と札は画面上の大きさを一定に保つ (opts.textScale=この変換での「CSS 1px あたりの px」)。
      // 大きいコースで内部キャンバスが縮小表示されても 11 CSS px のまま読める。
      const ts = opts.textScale || 1;
      const txt = s.mm < 0 ? '∞' : `${s.mm}`;
      ctx.font = (11 * ts) + 'px monospace';
      ctx.fillStyle = '#b30000';
      ctx.fillRect(h.x + 4 * ts, h.y - 12 * ts, ctx.measureText(txt).width + 6 * ts, 14 * ts);
      ctx.fillStyle = '#fff';
      ctx.fillText(txt, h.x + 7 * ts, h.y - 1 * ts);
    }
  }
  ctx.restore();
}

// ── 画面固定 HUD の寸法 (BB3) ─────────────────────────────────────────────────────
// main.js の render は HUD を **CSS px の座標系**で描く (変換 = 内部キャンバス px / CSS px)。ゆえに以下の数値は
// すべて画面上の CSS px で、コースの大きさ (内部キャンバスの縮小表示) に依らず同じ大きさに見える。
// レイアウト判定 (layoutHud) と描画 (drawMeters/drawTireHud/drawFleetHud) が同じ値を使う。
const METER = { x0: 12, y0: 14, labelW: 72, w: 150, h: 13, gap: 26, rows: 3 };
const METER_W_MIN = 60;   // 狭い画面でメーターのバーを縮めるときの下限 (layoutHud)
const TIRE = { cell: 20, gap: 4, padX: 8, padY: 6, labelH: 16 };
const TIRE_W = TIRE.cell * 2 + TIRE.gap + TIRE.padX * 2;
const TIRE_H = TIRE.cell * 2 + TIRE.gap + TIRE.padY * 2 + TIRE.labelH;
const TIRE_FONT = '11px monospace';
// タイヤ HUD の見出しと箱の幅。見出し (「タイヤ利用率」等) は 2×2 の升目より広いので、箱を見出しに合わせる
// (BB3。旧実装は見出しが箱の右へはみ出していた＝右端に置くとキャンバスの外へ切れる)。
const tireLabel = (T) => (T.wear ? t('hud.tire.wear') : t('hud.tire'));
function tireBoxW(ctx, label) {
  ctx.save(); ctx.font = TIRE_FONT;
  const w = Math.max(TIRE_W, Math.ceil(ctx.measureText(label).width) + TIRE.padX * 2);
  ctx.restore();
  return w;
}
// 順位表 (リーダーボード) の寸法。wMin = 行の中身 (順位・色ドット・名前・LAP・BEST・状態) が**詰めずに**
// 収まる枠幅 (＝自然幅。BD2 以降、狭い画面ではこれより細い枠も作る＝「取りうる最小」ではない)。
// export しているのは常設ゲートが**独立した上界**としてこの値を引くため (check_bc6_hudband.mjs B3d)。
// 枠幅を観測値どうしで比べると式の両辺に現れて相殺し、枠が太る退行を捕まえられない。
// ⚠ B3d の母集団は ja・1 台・既定装備。en は注記が長く AS1 の実測合わせで 276px まで広がる (上界を超える)。
export const LB = { rowH: 23, padT: 10, headH: 19, footH: 18, padL: 12, wMin: 268, noteMin: 10, noteLineH: 15 };
// 行の列の自然位置 (枠の左端からの CSS px)・色ドットの半径・フォント・枠の外の左右余白。
// LB.wMin=268 は「状態列の右端 + 余白」＝この並びそのものから決まっている値。
const LB_COL = { rank: 12, dot: 33, name: 45, lap: 109, best: 139, state: 222 };
const LB_DOT_R = 5.3, LB_ROW_FONT = 14, LB_HEAD_FONT = 13, LB_MARGIN = 12;
// BD2: 表示幅が自然幅に足りないとき (スマホ幅) に枠を詰める。
//   枠は右詰め (x0 = wPx − w − LB_MARGIN) なので、w が表示幅に入らないと左へはみ出して読めない。
//   改修前は w の下限が LB.wMin 固定だったため、コース表示幅 256 CSS px (viewport 320px) では枠が 24px・
//   文字が 12px 左へ出ていた (BC-9 ③ に「既知の構造的限界」として記録した状態)。
//   詰め方は 2 段: ① **空白** (枠内の左右余白と列の隙間) を s 倍にする → ② それでも入らなければ
//   **内容** (文字と色ドット) を kf 倍にする。文字は 10 CSS px を下限にする (BB3 H1「読める大きさ」と同じ)。
//   s = kf = 1 のとき列位置・フォント・枠幅は改修前と一致する＝入る画面では絵が 1 px も変わらない。
//   ⚠ 詰めには下限があるので「左へ出ない」は無条件ではない: s・kf が下限に張り付くと枠幅は **160.8 CSS px
//   (ja・実測)** で止まり、帯の表示幅がそれ + LB_MARGIN を下回ると枠ごと左へ出る (実測の崖 = 表示幅
//   172.8px ≒ viewport 233px)。読める大きさ (10 CSS px) を捨ててまで詰めない、という選択の帰結。
//   出荷が支える viewport 280px の表示幅は 216px で、崖まで 43px の余裕がある。この余裕そのものを
//   check_bc6_hudband.mjs B16 が毎回測る (「0 かどうか」でなく「崖までいくつ残っているか」)。
const LB_SMIN = 0.45, LB_FONT_MIN = 10;

// 順位表の注記 (練習ベストの断り・旧版記録・非既定装備) を組み立てる。
function fleetNote(slots) {
  // BEST=練習(非公式)記録である旨を明示 (W2)。公式記録(将来のレース)と混同しないための注記。
  // AP2: 表示中のベストに旧エンジン版で樹立された記録があれば「(当時 vX)」を併記（版跨ぎ比較の誤解
  // を防ぐ・公式 official.result.archived と同型。現行版一致の記録には出さない＝誤検知なし）。
  let note = t('hud.lb.note');
  for (const s of slots) {
    const rv = s.lap && s.lap.bestRec && s.lap.bestRec.ver;
    if (rv && rv !== APP_VERSION) { note += '  ' + t('hud.lb.archived', { ver: rv }); break; }
  }
  // AS9 ③: **非既定の装備だけ**を注記へ刻む (既定 normal/direct では 1 文字も足さない=従来の注記と
  // 完全一致)。装備は v2 エンジンのみ物理へ効くので v2 の車だけを見る (旧エンジンでは選んでも無効)。
  const equip = [];
  for (const s of slots) {
    const c = s.car;
    if (!c) continue;
    // AS12: 操舵サーボは **全エンジン共通**の装備ゆえ v2 判定より前で拾う (下の3つは v2 専用)。
    if (c.steerSet && c.steerSet !== 'tri') equip.push(t('hud.lb.steer.' + c.steerSet));
    if (c.engine !== 'v2') continue;
    if (c.tireSet && c.tireSet !== 'normal') equip.push(t('hud.lb.tire.' + c.tireSet));
    if (c.gearSet && c.gearSet !== 'direct') equip.push(t('hud.lb.gear.' + c.gearSet));
    if (c.suspSet && c.suspSet !== 'quasi') equip.push(t('hud.lb.susp.' + c.suspSet));   // AS11
    if (c.brakeSet && c.brakeSet !== 'motor') equip.push(t('hud.lb.brake.' + c.brakeSet));  // AV2
  }
  if (equip.length) note += '  [' + [...new Set(equip)].join('/') + ']';
  return note;
}

// 行の各列が要する幅 [CSS px]。**状態列だけは実際に描く語 (i18n) を measureText で測る** (ja 28 / en 35 と
// 言語で変わるため)。他の 4 列は「等幅 1 文字幅 × 文字数」の見積り＝**全角の車名 (自由入力) は見積りを超える**
// (改修前から列は固定オフセットで同じ超過が起きる。BD2 はその見積りを枠幅の決定にも使うようになった)。
// あわせて列の隙間と枠の右余白を自然位置 (LB_COL) から逆算する — 詰める対象は「空白」であって文字ではない。
// 返り値の wNat は自然幅で、ja/en・既定編成では LB.wMin と一致する (LB.wMin はこの並びから決まった値)。
function lbParts(ctx, slots) {
  ctx.save();
  ctx.font = LB_ROW_FONT + 'px monospace';
  const ch = ctx.measureText('0').width;
  const state = Math.max(...['hud.lb.run', 'hud.lb.stop', 'hud.lb.crash'].map((k) => ctx.measureText(t(k)).width));
  ctx.restore();
  // 順位=slots.length の桁数・名前=padEnd(5)・LAP=padStart(2)・BEST=slice(0,8)。いずれも drawFleetHud と同じ。
  const cw = { rank: String(slots.length).length * ch, dot: LB_DOT_R * 2, name: 5 * ch, lap: 2 * ch, best: 8 * ch, state };
  const gap = [
    (LB_COL.dot - LB_DOT_R) - (LB_COL.rank + cw.rank),
    LB_COL.name - (LB_COL.dot + LB_DOT_R),
    LB_COL.lap - (LB_COL.name + cw.name),
    LB_COL.best - (LB_COL.lap + cw.lap),
    LB_COL.state - (LB_COL.best + cw.best),
  ];
  const padR = Math.max(4, LB.wMin - (LB_COL.state + cw.state));   // 状態列の右の余白 (実測 ja 18 / en 11)
  const content = cw.rank + cw.dot + cw.name + cw.lap + cw.best + cw.state;
  // space が 0 以下になると s の式が 0 除算 (NaN) になり、NaN は比較も clamp も素通りして
  // 'NaNpx monospace' (無効値＝直前のフォントのまま) まで伝播する。空白が無い並びは「詰めない」で扱う。
  const space = Math.max(1e-6, LB.padL + gap.reduce((a, b) => a + b, 0) + padR);
  return { cw, gap, content, space, wNat: content + space };
}

// 順位表の寸法 (幅・高さ・列位置・フォント・注記の行分割)。wPx = HUD 座標系での画面幅。
function fleetHudMetrics(ctx, slots, wPx) {
  const note = fleetNote(slots);
  const P = lbParts(ctx, slots);
  const avail = wPx - LB_MARGIN * 2;        // 左右に同じ余白を取ったとき枠に使える幅
  // ヘッダは列とは別建ての 1 本の整形済み文字列。これも 10 CSS px を割らせないので、**「入るか」の判定より
  // 前に**測る (後で測ると、ヘッダのために枠を広げる必要があるのに nat と判定して詰めない経路ができる)。
  ctx.save();
  ctx.font = LB_HEAD_FONT + 'px monospace';
  const hdrW = ctx.measureText(t('hud.lb.header')).width;
  ctx.restore();
  const hdrNeed = hdrW * (LB_FONT_MIN / LB_HEAD_FONT);   // ヘッダが 10 CSS px で要する内幅
  const wNeed = Math.max(P.wNat, hdrNeed + LB.padL * 2); // 詰めずに済む幅 (ja/en 既定では = P.wNat = LB.wMin)
  const nat = avail >= wNeed - 1e-9;        // 自然幅が入る＝改修前とまったく同じ経路 (列も枠もフォントも)
  let s = 1, kf = 1;
  if (!nat) {                               // BD2: ① 空白を s 倍に詰める → ② 足りなければ内容を kf 倍に縮める
    s = (avail - P.content) / P.space;
    if (s < LB_SMIN) { s = LB_SMIN; kf = (avail - LB_SMIN * P.space) / P.content; }
    s = Math.min(1, Math.max(LB_SMIN, s));
    kf = Math.min(1, Math.max(LB_FONT_MIN / LB_ROW_FONT, kf));
  }
  const padL = nat ? LB.padL : LB.padL * s;
  // 枠幅。ヘッダが 10 CSS px を割るくらいなら枠の方を広げる (読めなくしない)。この下限が avail を超えると
  // 枠は左へ出る＝上の「⚠ 崖」。
  const w0 = Math.max(nat ? P.wNat : P.space * s + P.content * kf, hdrNeed + padL * 2);
  // AS1: 注記の実測幅にパネル幅を合わせる。AS1 以前の固定幅 268px では注記が枠を越えて canvas の外へ
  // 切れていた（当時の実測: ja 282px / en 336px に対し内幅 244px）。パネルは右詰めなので広げると左へ伸びる。
  let noteFont = 12;
  ctx.save();
  ctx.font = noteFont + 'px monospace';
  let noteW = ctx.measureText(note).width;
  const wMax = Math.max(w0, avail);   // 画面幅を越えて広げない (狭い端末での保険)
  const w = Math.min(Math.max(w0, noteW + padL * 2), wMax);
  // wMax で頭打ちになる狭い画面では、注記側を縮めて収める。BB3: 下限は 10px (読める大きさ・旧 9px)。
  while (noteW > w - padL * 2 && noteFont > LB.noteMin) {
    ctx.font = (--noteFont) + 'px monospace';
    noteW = ctx.measureText(note).width;
  }
  // それでも収まらなければ、縮めずに行を折り返す (BB3。旧実装は枠の外へはみ出して切れていた)。
  // 空白の区切りで折り返し (英語の語の途中で切らない)、1 語が内幅を越えるとき (日本語は空白が無い) だけ文字単位で切る。
  // 行頭・行末の空白は落とす。**1 回の反復で必ず 1 語か 1 文字進む**ので内幅に依らず必ず終わる
  // (BD2 以降、内幅は詰めで 150px 級まで下がりうる＝「内幅 244px」を前提にしてはならない)。
  const inner = w - padL * 2, fits = (x) => ctx.measureText(x).width <= inner;
  const lines = [];
  if (fits(note)) lines.push(note);
  else {
    let cur = '';
    const flush = () => { const x = cur.trim(); if (x) lines.push(x); cur = ''; };
    for (const tok of note.split(/(\s+)/)) {
      if (!tok) continue;
      if (fits(cur + tok)) { cur += tok; continue; }
      if (/^\s+$/.test(tok)) { flush(); continue; }          // 区切りの空白で行を終える
      if (cur.trim()) flush();
      for (const ch of tok) {                               // 語を新しい行へ。入らなければ文字単位
        if (cur && !fits(cur + ch)) flush();
        cur += ch;
      }
    }
    flush();
  }
  ctx.restore();
  const footH = LB.footH + (lines.length - 1) * LB.noteLineH;
  const h = LB.padT * 2 + LB.headH + LB.rowH * slots.length + footH;
  // 列の位置 (枠の左端から)。nat のときは LB_COL そのもの＝改修前と 1 px も変わらない。
  let cols = LB_COL, dotR = LB_DOT_R;
  if (!nat) {
    dotR = LB_DOT_R * kf;
    let x = padL;
    cols = { rank: x };
    x += P.cw.rank * kf + P.gap[0] * s;
    cols.dot = x + dotR;
    x += P.cw.dot * kf + P.gap[1] * s;
    cols.name = x; x += P.cw.name * kf + P.gap[2] * s;
    cols.lap = x;  x += P.cw.lap * kf + P.gap[3] * s;
    cols.best = x; x += P.cw.best * kf + P.gap[4] * s;
    cols.state = x;
  }
  const headFont = Math.max(LB_FONT_MIN, Math.min(LB_HEAD_FONT, LB_HEAD_FONT * (w - padL * 2) / hdrW));
  return { w, h, noteFont, lines, cols, dotR, padL, rowFont: LB_ROW_FONT * kf, headFont };
}

// HUD の配置 (BB3)。hv = { wPx, hPx } は HUD 座標系 (CSS px) での画面の大きさ。
// 広い画面は従来どおり「メーター=左上・タイヤ=左下・順位表=右上」。ただしタイヤ HUD はメーターより上へは上げない
// (表示高さが低いキャンバスでメーターと重ならない)。メーターと順位表が横に並ばない狭い画面 (スマホ幅) では:
//   ① タイヤ HUD をメーターの右上へ (入らなければメーターのバーを縮める・下限 METER_W_MIN)、順位表をその下へ
//   ② それでも入らない (幅 約 270px 未満) ときは、メーター → タイヤ HUD → 順位表 の順に左側へ縦に積む
// どの分岐でも 3 部品の矩形は構造的に重ならない (高さが足りなければ下がキャンバスの外へ切れる＝決定ログ)。
// tire4 = data.tire4 (タイヤ HUD を出さないときは null)。
export function layoutHud(ctx, slots, hv, tire4) {
  const lb = (slots && slots.length) ? fleetHudMetrics(ctx, slots, hv.wPx) : null;
  const mRight = METER.x0 + METER.labelW + METER.w;
  const mBottom = METER.y0 + (METER.rows - 1) * METER.gap + METER.h;
  let tire = { x: 12, y: Math.max(hv.hPx - TIRE_H - 12, mBottom + 8) }, lbTop = 12, meterW = METER.w;
  const side = !lb || hv.wPx >= mRight + 12 + lb.w + 12;
  // タイヤ HUD の箱の幅 (出さないときは 0)。BB4: ミニマップが避けるべき矩形を layoutMinimap へ渡すため、
  // 狭い画面の分岐だけでなく常に測る (測るだけ＝描画には影響しない)。
  const tw = (tire4 && tire4.util) ? tireBoxW(ctx, tireLabel(tire4)) : 0;
  if (!side) {
    let top = mBottom;
    if (tw) {
      meterW = Math.min(METER.w, hv.wPx - 12 - tw - 8 - METER.x0 - METER.labelW);
      if (meterW >= METER_W_MIN) {                                     // ①
        tire = { x: hv.wPx - tw - 12, y: 12 }; top = Math.max(top, 12 + TIRE_H);
      } else {                                                        // ②
        meterW = METER.w;
        tire = { x: 12, y: mBottom + 8 }; top = tire.y + TIRE_H;
      }
    }
    lbTop = top + 8;
  }
  return { side, tire, lbTop, lb, meterW, tireW: tw };
}

// HUD の 3 部品を「最小限に詰めて」置くのに要る高さ [CSS px] (BC6)。lay = layoutHud の結果。
// これがコース表示域の高さを超える狭い画面では、HUD をコースの上に描いても下が切れて読めないので、
// main.js が HUD をコースの下の帯 (#hudBand) へ出す。**この関数が「収まるか」の単一真実源**
// (product も常設ゲートもここを呼ぶ＝判定を二重実装しない)。
//   広い画面 (side): 部品は横に並ぶ。タイヤ HUD は layoutHud が下端へ貼り付けるが、高さの必要量としては
//     「メーターの下へ詰めたとき」の下端で数える (貼り付け位置で数えると必要高さ = 表示高さ になり常に境界上)。
//   狭い画面 (!side): 順位表がいちばん下。lbTop が既にタイヤ/メーターの下を指している。
// 末尾の 12 は下の余白 (layoutHud が上下に取る余白と同じ)。
export function hudNeedH(lay) {
  const mBottom = METER.y0 + (METER.rows - 1) * METER.gap + METER.h;
  const tireBottom = lay.tireW ? (lay.side ? mBottom + 8 + TIRE_H : lay.tire.y + TIRE_H) : 0;
  const lbBottom = lay.lb ? lay.lbTop + lay.lb.h : 0;
  return Math.max(mBottom, tireBottom, lbBottom) + 12;
}

// 複数車両のリーダーボード (右上。狭い画面ではメーターの下＝layoutHud)。slots=[{name,color,lap,car,running}], activeIdx=強調表示。
// 周回数の多い順 → 現ラップ経過の短い順に並べる。view.wPx = HUD 座標系での画面幅。
// top/metrics は layoutHud の結果 (省略時は右上・その場で寸法を測る)。
// 列の位置・色ドットの半径・フォントは **すべて metrics (fleetHudMetrics) から受け取る**。ここに数値を
// 置き直すと、狭い画面の詰め (BD2) が枠だけに効いて中身が枠からはみ出す。
export function drawFleetHud(ctx, slots, view, activeIdx, top = 12, metrics = null) {
  if (!slots || slots.length === 0) return;
  const order = slots.map((s, i) => ({ s, i })).sort((a, b) => {
    const dl = (b.s.lap?.laps || 0) - (a.s.lap?.laps || 0);
    if (dl) return dl;
    return (a.s.lap?.lapTime || 0) - (b.s.lap?.lapTime || 0);
  });
  // 2026-08-02 利用者指摘「右上の表示が小さすぎて読めない」により拡大 (行高/余白/フォント/列幅を
  // 約 1.2 倍・box 幅を余裕をもって拡張)。表示内容・並び順・判定ロジックは無変更 (描画のみ)。
  const { rowH, padT, headH } = LB;
  const m = metrics || fleetHudMetrics(ctx, slots, view.wPx);
  const { w, h, noteFont, lines, cols, dotR, padL, rowFont, headFont } = m;
  const x0 = view.wPx - w - LB_MARGIN, y0 = top;
  ctx.save();
  ctx.fillStyle = 'rgba(10,12,16,0.86)';
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, w, h);
  ctx.font = headFont + 'px monospace'; ctx.fillStyle = '#9fb0c8';
  ctx.fillText(t('hud.lb.header'), x0 + padL, y0 + padT + 12);
  ctx.font = rowFont + 'px monospace';
  order.forEach((o, rank) => {
    const s = o.s, y = y0 + padT + headH + rank * rowH + 16;
    const active = o.i === activeIdx;
    if (active) { ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(x0 + 2, y - 16, w - 4, rowH); }
    // 順位
    ctx.fillStyle = '#cfd6e6'; ctx.fillText(String(rank + 1), x0 + cols.rank, y);
    // 色ドット (色覚セーフ ON 時は s.color は呼び出し側で安全パレットへ写像済み・crash 色のみここで写像)
    ctx.fillStyle = s.car?.crashed ? (A11Y.cvdSafe ? CVD.crash : VIEW.carCrash) : s.color;
    ctx.beginPath(); ctx.arc(x0 + cols.dot, y - 5, dotR, 0, Math.PI * 2); ctx.fill();
    // 名前
    ctx.fillStyle = active ? '#fff' : '#cfd6e6';
    ctx.fillText((s.name || '').slice(0, 5).padEnd(5), x0 + cols.name, y);
    // LAP
    ctx.fillStyle = A11Y.cvdSafe ? CVD.lap : '#7fe0a0'; ctx.fillText(String(s.lap?.laps ?? 0).padStart(2), x0 + cols.lap, y);
    // BEST
    ctx.fillStyle = (s.lap?.improved) ? '#ffd34d' : '#9fb0c8';
    ctx.fillText(fmtTime(s.lap?.bestLap).slice(0, 8), x0 + cols.best, y);
    // 状態 (テキスト=run/stop/crash の語で既に区別。色覚セーフ ON 時は緑/赤を安全色へ写像し色でも区別可能に)
    const st = s.car?.crashed ? t('hud.lb.crash') : (s.running ? t('hud.lb.run') : t('hud.lb.stop'));
    ctx.fillStyle = A11Y.cvdSafe
      ? (s.car?.crashed ? CVD.crash : (s.running ? CVD.run : '#8a93a3'))
      : (s.car?.crashed ? '#ff6b6b' : (s.running ? '#6fe39a' : '#8a93a3'));
    ctx.fillText(st, x0 + cols.state, y);
  });
  // 注記 (1 行なら従来と同じ位置。折り返したときは下端から上へ積む)。
  ctx.font = noteFont + 'px monospace'; ctx.fillStyle = '#a3aebe';
  lines.forEach((ln, k) => ctx.fillText(ln, x0 + padL, y0 + h - padT + 2 - (lines.length - 1 - k) * LB.noteLineH));
  ctx.restore();
}

// 車の位置マーカー (BB3)。車体 (drawCar) とは別に、画面上で一定の大きさの輪を車の中心に重ねる。
// 大きいコースを縮小表示すると車は数 px になり場所が分からないため。車体の描画寸法は変えない (描画は主張＝
// 車を太らせて見せない)。showBelowCss: 画面上の車長 (CSS px) がこれ未満のときだけ出す (大きく見えている車には
// 何も足さない＝従来の絵のまま)。pts = [{x,y,color}] は HUD 座標系 (CSS px)。
// ⚠ 20px は i18n の opt.carMarker.title (ja/en) にも文章で書いてある (check_bb3_hud.mjs M7 が一致を検査する)。
//   index.html の静的 title= は ja と同じ文字列であることを wf_i18n_check ⑩ が検査する。
// 描く順は HUD の後 (main.js)。順位表の下にいる車でも位置が分かるように、輪は HUD より前面に出す。
export const MARKER = { showBelowCss: 20, r: 9, casing: 4, ring: 2 };
export function drawCarMarkers(ctx, pts) {
  ctx.save();
  for (const p of pts) {
    ctx.beginPath(); ctx.arc(p.x, p.y, MARKER.r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = MARKER.casing; ctx.stroke();
    ctx.strokeStyle = p.color; ctx.lineWidth = MARKER.ring; ctx.stroke();
  }
  ctx.restore();
}

// ミニマップ (BB4)。拡大表示中 (zoom > 1 または追従 ON) に、コース全体の縮小図と「いま見えている範囲」の
// 矩形を右下へ出す。等倍・追従 OFF のときは出さない (邪魔にしない)。座標系は HUD と同じ CSS px。
// max/min: 箱の長辺の最大 [CSS px] と、これを下回るなら出さない下限。minShort: 短辺の下限 (細長いコースで
// 潰れた帯にならないように。長辺だけ見ると 20:1 のコースで高さ 7px の図が「合格」してしまう)。
export const MINI = { max: 150, min: 56, minShort: 28, pad: 12, gap: 8, wall: 1, car: 2.5 };

// ミニマップの配置。HUD の 3 部品と**構造的に**重ならない領域だけを使う:
//   縦 = 順位表の下端より下 (順位表は layoutHud のどの分岐でも右寄せ＝右下と衝突しうる唯一の部品)
//   横 = メーターの右。タイヤ HUD が順位表より下にある (広い画面の左下) ときはその右も避ける。
// その領域にコースの縦横比を保った箱を入れ、長辺が MINI.min 未満なら null = 出さない。
// 位置ではなく**部品の寸法**から領域を出すので、配置が壊れて部品が下へずれた退行を「入る」と取り違えない。
// BC6: lay = null は「HUD をコース面の外 (HUD 帯) へ出した」ことを表す。避けるべき部品がコース面に
// 1 つも無いので、四辺の余白だけを空けて全面を使う (狭い画面でミニマップが出せるようになる)。
export function layoutMinimap(hv, lay, wM, hM) {
  if (!(wM > 0 && hM > 0)) return null;
  const lbBottom = (lay && lay.lb) ? lay.lbTop + lay.lb.h : 0;
  let left = lay ? METER.x0 + METER.labelW + lay.meterW + MINI.gap : MINI.pad;
  if (lay && lay.tireW && lay.tire.y + TIRE_H > lbBottom) left = Math.max(left, lay.tire.x + lay.tireW + MINI.gap);
  // 上端: 順位表の下 (＋すき間)。コース面に HUD が無い (lay=null) ときは左右と同じ余白だけを空ける。
  const top = lay ? lbBottom + MINI.gap : MINI.pad;
  const availW = hv.wPx - MINI.pad - left;
  const availH = hv.hPx - MINI.pad - top;
  if (!(availW > 0 && availH > 0)) return null;
  const s = Math.min(MINI.max / Math.max(wM, hM), availW / wM, availH / hM);
  const w = wM * s, h = hM * s;
  if (Math.max(w, h) < MINI.min || Math.min(w, h) < MINI.minShort) return null;
  return { x: hv.wPx - MINI.pad - w, y: hv.hPx - MINI.pad - h, w, h };
}

// コースの縮小図はコース/箱の大きさが変わったときだけ焼き直す (毎フレーム全壁を描くと壁の多いコースで重い)。
// 署名は壁の本数 + 最大 32 本の標本。編集器で壁を差し替えても本数か標本が動けば焼き直る (表示のみ＝誤差は絵の鮮度)。
const MINI_CACHE = { sig: '', cv: null };
function miniSig(course) {
  const W = course.walls, step = Math.max(1, Math.floor(W.length / 32));
  let s = W.length;
  for (let i = 0; i < W.length; i += step) { const w = W[i]; s = (s * 31 + w.x1 * 7 + w.y1 * 13 + w.x2 * 17 + w.y2 * 23) % 1e9; }
  return s;
}
// box = layoutMinimap の結果 (CSS px)・cars = [{x,y,color}] (world)・viewRect = いま見えている範囲 (CSS px・box と同じ系)。
// ⚠ strokeRect の呼び順は「① 箱の枠 → ② 表示範囲の矩形」で固定 (check_bb4_follow.mjs N2 がこの順で読む)。
export function drawMinimap(ctx, box, course, cars, viewRect) {
  const b = course.bounds;
  // 署名にテーマ色を入れる: 焼くときだけ VIEW.bg/VIEW.wall を読むので、入れないとテーマを変えても
  // 古い地色・壁色の板が貼られ続ける (applyCanvasTheme が VIEW.bg を書き換える・BB4 層 4 で実測)。
  const sig = `${miniSig(course)}|${b.w}x${b.h}|${box.w.toFixed(1)}x${box.h.toFixed(1)}|${VIEW.bg}|${VIEW.wall}`;
  if (MINI_CACHE.sig !== sig) {
    const cv = MINI_CACHE.cv || (MINI_CACHE.cv = document.createElement('canvas'));
    const dpr = 2;   // 2 倍で焼いて縮めると、細い壁が縮小で消えない
    cv.width = Math.max(1, Math.round(box.w * dpr)); cv.height = Math.max(1, Math.round(box.h * dpr));
    const c2 = cv.getContext('2d');
    c2.fillStyle = VIEW.bg; c2.fillRect(0, 0, cv.width, cv.height);
    const s = cv.width / b.w;
    c2.strokeStyle = VIEW.wall; c2.lineWidth = Math.max(1, MINI.wall * dpr); c2.lineCap = 'round';
    c2.beginPath();   // 全壁を 1 本のパスにして 1 回だけ stroke する (壁ごとの stroke は壁の多いコースで重い)
    for (const w of course.walls) { c2.moveTo(w.x1 * s, (b.h - w.y1) * s); c2.lineTo(w.x2 * s, (b.h - w.y2) * s); }
    c2.stroke();
    MINI_CACHE.sig = sig;
  }
  ctx.save();
  ctx.drawImage(MINI_CACHE.cv, box.x, box.y, box.w, box.h);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);            // ① 箱の枠
  // ここから先は箱で切り取る。車も表示範囲もコース外へ出うる (追従中は被覆クランプを外すため) ので、
  // 切り取らないと点や枠が箱の外＝他の HUD の上へ漏れる。**呼び出しの座標は切り取らない実値のまま**
  // なので、表示範囲の矩形は vt から計算した範囲とそのまま比べられる。
  ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
  for (const c of cars) {
    ctx.beginPath();
    ctx.arc(box.x + (c.x / b.w) * box.w, box.y + ((b.h - c.y) / b.h) * box.h, MINI.car, 0, Math.PI * 2);
    ctx.fillStyle = c.color; ctx.fill();
  }
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
  ctx.strokeRect(viewRect.x, viewRect.y, viewRect.w, viewRect.h);            // ② 表示範囲
  ctx.restore();
}

// レーシングカーを上面視で描画。すべて車体ローカル座標 (lx=前方, ly=左) で組み立て、
// 物理フレームと同じ変換でスクリーンへ写すので衝突ボックスと向きが一致する。
// color: 車体主色 (複数台で識別)。省略時は VIEW.carBody。
export function drawCar(ctx, car, view, color) {
  const body = color || VIEW.carBody;
  const body2 = color ? darkenHex(color, 0.5) : VIEW.carBody2;
  const c = Math.cos(car.theta), s = Math.sin(car.theta);
  const k = VIEW.carScale || 1; // 車体スケール (描画も衝突ボックスと同じ倍率で拡縮)
  // car.type → シルエット解決 (未知/custom は既定 sport へフォールバック・Stage AL)。色での識別は維持。
  const sprite = spriteFor(car.type);
  const bbox = spriteBBox(sprite);
  // 生変換 (影・タイヤ煙のソフト演出用。フットプリント写像なし)。
  const Praw = (lx, ly) => worldToScreen({ x: car.x + (lx * k) * c - (ly * k) * s, y: car.y + (lx * k) * s + (ly * k) * c }, view);
  // 車体ソリッドは設計頂点を衝突フットプリント内へ写像してから描く → 描画スプライト ⊆ 衝突矩形
  // (Stage AH・GitHub #26 §4/§7-6)。衝突矩形は必ず壁から離れている (AG1) ので、これで視覚の
  // 壁越えが「いかなるコース・スケール・配置・走行中でも」構造的に起きない。物理/配置は無改変。
  const P = (lx, ly) => { const [fx, fy] = fitToFootprint(lx, ly, CAR_FOOTPRINT, bbox); return Praw(fx, fy); };
  const poly = (pts, pf = P) => {
    ctx.beginPath();
    pts.forEach((p, i) => { const q = pf(p[0], p[1]); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
    ctx.closePath();
  };
  const crashed = car.crashed;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // ドリフト中のタイヤスモーク (raw・後方へ意図的に伸びる演出のためフットプリント写像対象外)
  const slip = car.slip || 0;
  if (slip > 0.18 && !crashed) {
    const sign = car.slipSign || 1;
    const pxm = Math.hypot(Praw(0.1, 0).x - Praw(0, 0).x, Praw(0.1, 0).y - Praw(0, 0).y) / 0.1; // px/m
    for (let i = 0; i < 5; i++) {
      const back = -0.05 - i * 0.055;
      const cpt = Praw(back, sign * (0.02 + i * 0.022));
      ctx.beginPath(); ctx.arc(cpt.x, cpt.y, (0.028 + i * 0.014) * pxm, 0, Math.PI * 2);
      ctx.fillStyle = '#f4f6fa'; ctx.globalAlpha = Math.min(0.6, slip * 0.65) * (1 - i * 0.16); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // 影 (raw・方向性のあるソフト演出のためフットプリント写像対象外)
  if (sprite.shadow) {
    ctx.globalAlpha = 0.18;
    poly(sprite.shadow, Praw);
    ctx.fillStyle = '#000'; ctx.fill();
    ctx.globalAlpha = 1;
  }

  // タイヤ (黒・角丸風)。前輪 wheels[0],[1] は実操舵角 (steerAngle) で向きを描く → 操舵・逆ハンが見える。
  if (sprite.wheels && sprite.wheelHalf) {
    const { x: whx, y: why } = sprite.wheelHalf;
    const wheel = (wx, wy, ang) => {
      const ca = Math.cos(ang || 0), sa = Math.sin(ang || 0);
      const rot = (dx, dy) => [wx + dx * ca - dy * sa, wy + dx * sa + dy * ca];
      poly([rot(-whx, -why), rot(whx, -why), rot(whx, why), rot(-whx, why)]);
      ctx.fillStyle = VIEW.carWheel; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = '#000'; ctx.stroke();
    };
    const steer = car.steerAngle || 0;          // 実舵角 (rad)。LEFT=+, RIGHT=−
    sprite.wheels.forEach((w, i) => wheel(w[0], w[1], i < 2 ? steer : 0)); // [0],[1]=前輪(操舵)・他=後輪
  }

  // 車体 (一体ボディ・ノーズ→テールのグラデーション)。ノーズ/テールはシルエット bbox から取る。
  const nose = P(bbox.x1, 0), tail = P(bbox.x0, 0);
  const g = ctx.createLinearGradient(nose.x, nose.y, tail.x, tail.y);
  g.addColorStop(0, crashed ? '#ffc0c0' : body);
  g.addColorStop(1, crashed ? VIEW.carCrash : body2);
  poly(sprite.body);
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 1.4; ctx.strokeStyle = crashed ? '#9c1414' : '#15171c'; ctx.stroke();

  // リアウイング / フロントウイング (シルエットが持つ場合のみ。sport/normal は非分離ボディ=持たない)。
  // ボディの後に描く → 共有ボディのテール上に載る全幅バーとして見える (drift 系の識別特徴)。
  for (const wk of ['rearWing', 'frontWing']) {
    if (!sprite[wk]) continue;
    poly(sprite[wk]);
    ctx.fillStyle = VIEW.carWing; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = '#000'; ctx.stroke();
  }

  // センターストライプ
  if (sprite.stripe) {
    poly(sprite.stripe);
    ctx.globalAlpha = 0.9; ctx.fillStyle = crashed ? '#ffe2e2' : VIEW.carAccent; ctx.fill(); ctx.globalAlpha = 1;
  }

  // コックピット (キャノピー) + ハイライト
  if (sprite.canopy) {
    poly(sprite.canopy);
    ctx.fillStyle = VIEW.carCanopy; ctx.fill();
    if (sprite.canopyHi) { poly(sprite.canopyHi); ctx.fillStyle = 'rgba(255,255,255,0.30)'; ctx.fill(); }
  }

  // ノーズ先端のアクセント (ヘッドライト風)
  if (sprite.noseAccent) {
    const np = P(sprite.noseAccent[0], sprite.noseAccent[1]);
    ctx.beginPath(); ctx.arc(np.x, np.y, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = crashed ? '#ffd0d0' : '#ffd84d'; ctx.fill();
  }

  ctx.restore();
}

// 緑のメーター (Canvas 左上)
// barW: バーの幅 (layoutHud の meterW。狭い画面ではタイヤ HUD を右に置くため縮む。省略時は既定)。
export function drawMeters(ctx, data, barW = METER.w) {
  // 2026-08-02 利用者指摘によりラベル文字/バーを拡大 (行間もあわせて拡張)。
  // BB3: 数値は HUD 座標系 (CSS px) の METER (layoutHud と共有)。
  const { x0, y0, h, gap, labelW } = METER, w = barW;
  const items = [
    ['Distance', Math.min(1, (data.center < 0 ? 2000 : data.center) / 2000)],
    ['Angle', (data.steer === CONST.LEFT ? 0.15 : data.steer === CONST.RIGHT ? 0.85 : 0.5)],
    ['Speed', Math.min(1, Math.abs(data.speed) / CAR.maxSpeed)],
  ];
  ctx.save();
  ctx.font = '13px monospace';
  items.forEach((it, i) => {
    const y = y0 + i * gap;
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x0 + labelW, y, w, h);
    ctx.fillStyle = VIEW.meter; ctx.fillRect(x0 + labelW, y, w * it[1], h);
    ctx.fillStyle = '#0a6b38'; ctx.fillText(it[0], x0, y + 11);
  });
  ctx.restore();
}

export function updatePanel(refs, data) {
  // 測距の単位は領域で変える (Stage Y/Y2・Issue #20)。卓上/中スケールは従来どおり mm 表記のまま
  // (卓上は byte 不変方針に従い表示も不変)。フルスケール (実車相当・ToF レンジ 150m) は値が
  // 万 mm 単位に達して読みにくく「2000mm 超→30000」の混乱を生むため m 表記に切り替える。
  const f = data.meters
    ? (v) => v < 0 ? '∞' : `${(v / 1000).toFixed(1)}m`
    : (v) => v < 0 ? '∞' : `${v}mm`;
  refs.sL.textContent = f(data.left);
  refs.sC.textContent = f(data.center);
  refs.sR.textContent = f(data.right);
  if (refs.sB) refs.sB.textContent = data.back != null ? `B:${f(data.back)}` : '';
  // 現在領域の測距上限 (sensorMaxMm) と単位を常時明示する (Issue #20)。
  if (refs.sRange && data.maxMm != null) {
    refs.sRange.textContent = data.meters
      ? `ToF≤${(data.maxMm / 1000).toFixed(0)}m`
      : `ToF≤${data.maxMm}mm`;
  }
  // θ は物理内部では連続角(無制限累積)。表示層でのみ 0–360° に正規化する (BUG-01)。
  const thDeg = ((data.theta * 180 / Math.PI) % 360 + 360) % 360;
  let posTxt = `x=${data.x.toFixed(2)} y=${data.y.toFixed(2)} θ=${thDeg.toFixed(0)}°`;
  // slip角 β と速度ベクトル方位 v→ の数値表示 (IMP-03)。dynamic 車のみ (data.slip!=null)。
  if (data.slip != null) {
    const vdir = ((thDeg + data.slip) % 360 + 360) % 360;
    posTxt += ` β=${data.slip.toFixed(0)}° v→${vdir.toFixed(0)}°`;
  }
  // 摩擦円使用率 (M2 / #18②)。0%=グリップに余裕・100%超=限界突破で滑走。dynamic 車のみ。
  // v2 は正規化スリップ σ (掘り込み路面ではその路面のピーク σ で正規化・AV3) を百分率にしている。
  if (data.muUse != null) {
    posTxt += ` ${t('hud.muCircle')} F:${Math.round(data.muUse.f * 100)}% R:${Math.round(data.muUse.r * 100)}%`;
  }
  refs.pos.textContent = posTxt;
  // 速度表示は領域連動 (PX-010・AB7)。卓上/中スケールの dispKmh は「最高速比×topKmh」の没入写像なので
  // 「実車換算」マーカを付け、桁違いの誤解 (卓上で 327km/h) を防ぐ。フルスケールは実速度なのでマーカ無し。
  const _kmh = (data.dispKmh != null ? data.dispKmh : Math.abs(data.speed) * 3.6).toFixed(0);
  refs.spd.textContent = data.speedScaled ? `${_kmh} km/h${t('speed.equiv')}` : `${_kmh} km/h`;
  refs.state.textContent = data.crashed ? t('hud.st.crash') : (data.running ? t('hud.st.run') : t('hud.st.stop'));
  refs.state.style.color = data.crashed ? '#d33' : (data.running ? '#0a0' : '#888');
}

// Stage AO12: 輪ごと摩擦円利用率 ＋ タイヤ熱・摩耗 状態 HUD (**表示層のみ・v2 車のみ・物理を一切読み戻さない**)。
// car._muUse4 (輪ごと摩擦円利用率 |F|/μFz)・_temp・_wear は physics_v2 が書き、ここ (と main の data 組立) が
// 読むだけ = 純粋な可視化 (物理非読取ゲート wf_ao12_wear で機械確認)。data.tire4 が null (旧エンジン等) なら no-op。
// フットプリント: 2×2 の車輪ボックス (FL FR / RL RR)。塗り高=摩擦円利用率∈[0,1] (緑→黄→赤)。wear=ON のとき
// 枠色=温度 (冷=青/最適=緑/過熱=赤)＋下端の摩耗バー (摩耗ほど赤く伸び clamp 境界で全幅)。
// at = { x, y }: 左上の位置 (HUD 座標系・layoutHud の tire)。省略時は BB3 以前と同じ ctx.canvas.height 基準の左下
// (変換が恒等のときだけ正しい。main.js は layoutHud の位置を渡す)。
export function drawTireHud(ctx, data, at = { x: 12, y: ctx.canvas.height - TIRE_H - 12 }) {
  const T = data.tire4;
  if (!T || !T.util) return;
  const { cell, gap, padX, padY, labelH } = TIRE;
  const label = tireLabel(T);
  const boxW = tireBoxW(ctx, label), boxH = TIRE_H;
  const x0 = at.x, y0 = at.y;
  ctx.save();
  ctx.font = TIRE_FONT;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x0, y0, boxW, boxH);
  ctx.fillStyle = '#bfe';
  ctx.fillText(label, x0 + padX, y0 + labelH - 2);
  const gx = x0 + padX, gy = y0 + labelH + padY;
  const pos = [[0, 0], [1, 0], [0, 1], [1, 1]];   // idx 0..3 = FL FR / RL RR
  for (let k = 0; k < 4; k++) {
    const bx = gx + pos[k][0] * (cell + gap), by = gy + pos[k][1] * (cell + gap);
    const util = Math.max(0, Math.min(1, T.util[k] || 0));
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(bx, by, cell, cell);
    const fh = cell * util;
    ctx.fillStyle = `hsl(${120 * (1 - util)},70%,45%)`;   // 120=緑(余裕) → 0=赤(限界)
    ctx.fillRect(bx, by + cell - fh, cell, fh);
    if (T.wear && T.temp) {
      const tp = T.temp[k];
      const hh = tp <= 1 ? (220 - 100 * Math.max(0, tp)) : Math.max(0, 120 - 120 * (tp - 1));   // 冷青→最適緑→過熱赤
      ctx.strokeStyle = `hsl(${hh},80%,55%)`; ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
    }
    ctx.strokeRect(bx + 0.5, by + 0.5, cell - 1, cell - 1);
    if (T.wear && T.worn) {
      const wr = Math.max(0, Math.min(1, (T.worn[k] || 0) / 0.25));   // 0.25=clamp 境界=全幅
      ctx.fillStyle = '#e55';
      ctx.fillRect(bx, by + cell - 3, cell * wr, 3);
    }
  }
  ctx.restore();
}
