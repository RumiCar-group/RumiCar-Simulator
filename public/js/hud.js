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
  ctx.font = '11px monospace';
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
      const txt = s.mm < 0 ? '∞' : `${s.mm}`;
      ctx.fillStyle = '#b30000';
      ctx.fillRect(h.x + 4, h.y - 12, ctx.measureText(txt).width + 6, 14);
      ctx.fillStyle = '#fff';
      ctx.fillText(txt, h.x + 7, h.y - 1);
    }
  }
  ctx.restore();
}

// 複数車両のリーダーボード (右上)。slots=[{name,color,lap,car,running}], activeIdx=強調表示。
// 周回数の多い順 → 現ラップ経過の短い順に並べる。
export function drawFleetHud(ctx, slots, view, activeIdx) {
  if (!slots || slots.length === 0) return;
  const order = slots.map((s, i) => ({ s, i })).sort((a, b) => {
    const dl = (b.s.lap?.laps || 0) - (a.s.lap?.laps || 0);
    if (dl) return dl;
    return (a.s.lap?.lapTime || 0) - (b.s.lap?.lapTime || 0);
  });
  // 2026-08-02 利用者指摘「右上の表示が小さすぎて読めない」により拡大 (行高/余白/フォント/列幅を
  // 約 1.2 倍・box 幅を余裕をもって拡張)。表示内容・並び順・判定ロジックは無変更 (描画のみ)。
  const rowH = 23, padT = 10, headH = 19, footH = 18; // footH=練習(非公式)注記の行高 (W2)
  const padL = 12, wMin = 268;
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
  // 幅は下の実測ロジックがこの note に合わせて広げる (AS1) ので枠外へ切れない。
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
  // AS1: 注記の実測幅にパネル幅を合わせる。固定幅 268px では注記が枠を越えて canvas の外へ
  // 切れていた（実測: ja 282px / en 336px に対し内幅 244px。特に en は「(当時 vX)」注記なしでも
  // 252px で既に溢れる）。パネルは右詰め (x0 = wPx - w - 12) なので、広げると左へ伸びて画面内に収まる。
  // 行の列位置はすべて x0 基準なので配置は不変＝広がるのは右側の余白のみ。
  let noteFont = 12;
  ctx.save();
  ctx.font = noteFont + 'px monospace';
  let noteW = ctx.measureText(note).width;
  const wMax = Math.max(wMin, view.wPx - 24);   // 画面幅を越えて広げない (狭い端末での保険)
  const w = Math.min(Math.max(wMin, noteW + padL * 2), wMax);
  // wMax で頭打ちになる狭い画面では、注記側を縮めて収める (下限 9px)。
  while (noteW > w - padL * 2 && noteFont > 9) {
    ctx.font = (--noteFont) + 'px monospace';
    noteW = ctx.measureText(note).width;
  }
  ctx.restore();
  const h = padT * 2 + headH + rowH * slots.length + footH;
  const x0 = view.wPx - w - 12, y0 = 12;
  ctx.save();
  ctx.fillStyle = 'rgba(10,12,16,0.86)';
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, w, h);
  ctx.font = '13px monospace'; ctx.fillStyle = '#9fb0c8';
  ctx.fillText(t('hud.lb.header'), x0 + 12, y0 + padT + 12);
  ctx.font = '14px monospace';
  order.forEach((o, rank) => {
    const s = o.s, y = y0 + padT + headH + rank * rowH + 16;
    const active = o.i === activeIdx;
    if (active) { ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(x0 + 2, y - 16, w - 4, rowH); }
    // 順位
    ctx.fillStyle = '#cfd6e6'; ctx.fillText(String(rank + 1), x0 + 12, y);
    // 色ドット (色覚セーフ ON 時は s.color は呼び出し側で安全パレットへ写像済み・crash 色のみここで写像)
    ctx.fillStyle = s.car?.crashed ? (A11Y.cvdSafe ? CVD.crash : VIEW.carCrash) : s.color;
    ctx.beginPath(); ctx.arc(x0 + 33, y - 5, 5.3, 0, Math.PI * 2); ctx.fill();
    // 名前
    ctx.fillStyle = active ? '#fff' : '#cfd6e6';
    ctx.fillText((s.name || '').slice(0, 5).padEnd(5), x0 + 45, y);
    // LAP
    ctx.fillStyle = A11Y.cvdSafe ? CVD.lap : '#7fe0a0'; ctx.fillText(String(s.lap?.laps ?? 0).padStart(2), x0 + 109, y);
    // BEST
    ctx.fillStyle = (s.lap?.improved) ? '#ffd34d' : '#9fb0c8';
    ctx.fillText(fmtTime(s.lap?.bestLap).slice(0, 8), x0 + 139, y);
    // 状態 (テキスト=run/stop/crash の語で既に区別。色覚セーフ ON 時は緑/赤を安全色へ写像し色でも区別可能に)
    const st = s.car?.crashed ? t('hud.lb.crash') : (s.running ? t('hud.lb.run') : t('hud.lb.stop'));
    ctx.fillStyle = A11Y.cvdSafe
      ? (s.car?.crashed ? CVD.crash : (s.running ? CVD.run : '#8a93a3'))
      : (s.car?.crashed ? '#ff6b6b' : (s.running ? '#6fe39a' : '#8a93a3'));
    ctx.fillText(st, x0 + 222, y);
  });
  // 注記の本文とフォントは上（パネル幅の決定）で確定済み。
  ctx.font = noteFont + 'px monospace'; ctx.fillStyle = '#a3aebe';
  ctx.fillText(note, x0 + padL, y0 + h - padT + 2);
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
export function drawMeters(ctx, data) {
  // 2026-08-02 利用者指摘によりラベル文字/バーを拡大 (行間もあわせて拡張)。
  const x0 = 12, y0 = 14, w = 150, h = 13, gap = 26;
  const items = [
    ['Distance', Math.min(1, (data.center < 0 ? 2000 : data.center) / 2000)],
    ['Angle', (data.steer === CONST.LEFT ? 0.15 : data.steer === CONST.RIGHT ? 0.85 : 0.5)],
    ['Speed', Math.min(1, Math.abs(data.speed) / CAR.maxSpeed)],
  ];
  ctx.save();
  ctx.font = '13px monospace';
  items.forEach((it, i) => {
    const y = y0 + i * gap;
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x0 + 72, y, w, h);
    ctx.fillStyle = VIEW.meter; ctx.fillRect(x0 + 72, y, w * it[1], h);
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
export function drawTireHud(ctx, data) {
  const T = data.tire4;
  if (!T || !T.util) return;
  const cell = 20, gap = 4, padX = 8, padY = 6, labelH = 16;
  const gridW = cell * 2 + gap;
  const boxW = gridW + padX * 2, boxH = cell * 2 + gap + padY * 2 + labelH;
  const x0 = 12, y0 = ctx.canvas.height - boxH - 12;
  ctx.save();
  ctx.font = '11px monospace';
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x0, y0, boxW, boxH);
  ctx.fillStyle = '#bfe';
  ctx.fillText(T.wear ? t('hud.tire.wear') : t('hud.tire'), x0 + padX, y0 + labelH - 2);
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
