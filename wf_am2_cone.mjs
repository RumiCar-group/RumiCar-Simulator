// Stage AM2 検証ゲート: センサーの「距離減衰コーン描画」を **本物の drawSensors** に
// **本物の readAll の測距** を食わせ、記録用の擬似 canvas ctx で描画コマンドを採取して
// 測定述語 (連続量マージン) で検証する。再実装せず本物のオラクルを呼ぶ (CI-9/CI-14)。
//
// 検証する知覚→測定の翻訳:
//   P1 扇(コーン)表示   … fill パスが頂点+±12.5°の弧 = 全角25°の楔 (角度/半径のマージン)
//   P2 距離2乗減衰      … 放射グラデーションのストップ alpha が f(t)=1-(1-0.12)t² に一致・端/頂点比=0.12
//   P3 最近反射で終端   … 反射があるとき塗り最大半径 = 測距 mm (=壁距離) で、レンジ上限まで伸びない
//                         (=壁を貫いて描かれない・#27 の視覚貫通が消える)
//   P4 描画のみ         … drawSensors が測距 (mm/hit) を書き換えない
//   P5 空扇             … mm<0 は塗り半径=レンジ上限・ヒット点マーカ無し・ラベル∞
//   P6 色覚セーフ       … dash:true で辺が破線・ヒットマーカが四角(fillRect)
//   P7 遮蔽上限         … 単一コーンの塗り alpha 上限 ≤ FAN_ALPHA (他車を潰さない measurable ceiling)
import { readAll } from './public/js/sensors.js';
import { worldToScreen } from './public/js/course.js';
import { SENSOR_FOV, SENSOR_RANGE } from './public/js/config.js';
import { drawSensors } from './public/js/hud.js';

// ── 記録用の擬似 canvas 2D コンテキスト ────────────────────────────────
function makeRecCtx() {
  const rec = { grads: [], fills: [], strokes: [], rects: [], texts: [], dashes: [] };
  let path = [];               // 現在のサブパス頂点 (moveTo/lineTo)
  let cur = { fillStyle: null, strokeStyle: null, globalAlpha: 1, lineWidth: 1, dash: [] };
  const ctx = {
    set fillStyle(v) { cur.fillStyle = v; }, get fillStyle() { return cur.fillStyle; },
    set strokeStyle(v) { cur.strokeStyle = v; }, get strokeStyle() { return cur.strokeStyle; },
    set globalAlpha(v) { cur.globalAlpha = v; }, get globalAlpha() { return cur.globalAlpha; },
    set lineWidth(v) { cur.lineWidth = v; }, get lineWidth() { return cur.lineWidth; },
    set font(v) {}, get font() { return ''; },
    save() {}, restore() {},
    setLineDash(d) { cur.dash = d.slice(); rec.dashes.push(d.slice()); },
    beginPath() { path = []; },
    moveTo(x, y) { path.push({ op: 'M', x, y }); },
    lineTo(x, y) { path.push({ op: 'L', x, y }); },
    closePath() { path.push({ op: 'Z' }); },
    arc(x, y, r) { path.push({ op: 'A', x, y, r }); },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      const g = { kind: 'radgrad', x0, y0, r0, x1, y1, r1, stops: [] };
      g.addColorStop = (off, color) => g.stops.push({ off, color });
      rec.grads.push(g);
      return g;
    },
    fill() { rec.fills.push({ style: cur.fillStyle, alpha: cur.globalAlpha, verts: path.filter(p => p.op === 'M' || p.op === 'L').map(p => ({ x: p.x, y: p.y })), hasArc: path.some(p => p.op === 'A') }); },
    stroke() { rec.strokes.push({ style: cur.strokeStyle, alpha: cur.globalAlpha, lineWidth: cur.lineWidth, dash: cur.dash.slice(), verts: path.filter(p => p.op === 'M' || p.op === 'L').map(p => ({ x: p.x, y: p.y })) }); },
    fillRect(x, y, w, h) { rec.rects.push({ x, y, w, h, style: cur.fillStyle }); },
    measureText(s) { return { width: s.length * 6 }; },
    fillText(s, x, y) { rec.texts.push({ s, x, y }); },
  };
  return { ctx, rec };
}
function parseAlpha(rgba) { const m = /rgba?\([^)]*,\s*([0-9.]+)\)\s*$/.exec(rgba); return m ? parseFloat(m[1]) : 1; }

const view = { pxPerM: 280, hM: 3, wPx: 1200 };
const S = view.pxPerM;
const FAN_FAR = 0.12;                     // 設計値 (hud.js と一致させる。ズレたら比が外れて検知される)
let fail = 0; const ok = (c, m) => { console.log(`  ${c ? '○' : '✗'} ${m}`); if (!c) fail++; };

// ── ケースA: 正面 0.5m に壁 (反射あり) ─────────────────────────────────
console.log('=== A) 反射あり (正面 0.5m 壁): P1 扇 / P2 距離2乗減衰 / P3 終端 / P4 描画のみ ===');
const carA = { x: 1.0, y: 1.5, theta: 0 };
const wallDist = 0.5, wx = carA.x + 0.135 + wallDist; // CENTER dx=0.135 → 壁 x
const wallsA = [{ x1: wx, y1: 0.5, x2: wx, y2: 2.5 }];
const sensA = readAll(carA, wallsA);
const cen = sensA[1];                      // CENTER
const mmBefore = cen.mm, hitBefore = { x: cen.hit.x, y: cen.hit.y };
ok(cen.mm > 0 && Math.abs(cen.mm - wallDist * 1000) < 5, `CENTER 測距 mm=${cen.mm} ≈ ${wallDist * 1000} (壁距離)`);
ok(cen.dir && Math.abs(cen.dir.x - 1) < 1e-9 && Math.abs(cen.dir.y) < 1e-9, `dir=中心方向 (${cen.dir?.x?.toFixed(3)},${cen.dir?.y?.toFixed(3)})`);

const A = makeRecCtx();
drawSensors(A.ctx, [cen], view, { show: true, labels: true, color: '#e2202a', dash: false });

// P4: 描画で測距が変わらない
ok(cen.mm === mmBefore && cen.hit.x === hitBefore.x && cen.hit.y === hitBefore.y, `P4 描画で mm/hit 不変 (mm=${cen.mm})`);

// 塗り (楔) = hasArc:false の fill でグラデーション。頂点[0]=apex, 残り=弧。
const wedge = A.rec.fills.find(f => f.style && f.style.kind === 'radgrad');
ok(!!wedge, 'P1 塗りは放射グラデーションの楔');
const apex = wedge.verts[0];
const oS = worldToScreen(cen.origin, view);
ok(Math.hypot(apex.x - oS.x, apex.y - oS.y) < 1e-6, `P1 頂点=センサー原点 screen (${apex.x.toFixed(1)},${apex.y.toFixed(1)})`);
const arc = wedge.verts.slice(1);          // 弧の標本点
const radii = arc.map(p => Math.hypot(p.x - apex.x, p.y - apex.y));
const Rpx = cen.mm / 1000 * S;             // 期待半径[px]
const rErr = Math.max(...radii.map(r => Math.abs(r - Rpx)));
ok(rErr < 0.5, `P1 弧の全点が半径 ${Rpx.toFixed(1)}px 上 (最大誤差 ${rErr.toFixed(3)}px)`);
// 角度span: 最初と最後の弧点が apex から成す角
const ang = (p) => Math.atan2(p.y - apex.y, p.x - apex.x);
let span = Math.abs(ang(arc[arc.length - 1]) - ang(arc[0]));
if (span > Math.PI) span = 2 * Math.PI - span;
const fullFov = 2 * SENSOR_FOV.halfRad;
ok(Math.abs(span - fullFov) < 1e-3, `P1 扇の全角 = ${(span * 180 / Math.PI).toFixed(2)}° (期待 ${(fullFov * 180 / Math.PI).toFixed(1)}°)`);

// P2: グラデーションの alpha プロファイル = 距離2乗減衰
const g = wedge.style;
ok(g.stops.length >= 3, `P2 グラデーションストップ ${g.stops.length} 段`);
const a0 = parseAlpha(g.stops[0].color), aLast = parseAlpha(g.stops[g.stops.length - 1].color);
ok(Math.abs(aLast / a0 - FAN_FAR) < 1e-6, `P2 端/頂点の濃度比 = ${(aLast / a0).toFixed(4)} (期待 ${FAN_FAR})`);
// 各ストップが f(t)=1-(1-FAN_FAR)t² に一致 (距離2乗)
let profErr = 0;
for (const st of g.stops) { const f = 1 - (1 - FAN_FAR) * st.off * st.off; profErr = Math.max(profErr, Math.abs(parseAlpha(st.color) / a0 - f)); }
ok(profErr < 1e-6, `P2 全ストップが距離2乗則に一致 (最大偏差 ${profErr.toExponential(2)})`);

// P3: 塗り最大半径 = 反射距離 (レンジ上限まで伸びない=壁を貫かない)
const maxFillR_m = Math.max(...radii) / S;
const maxM = SENSOR_RANGE.maxMm / 1000;
ok(Math.abs(maxFillR_m - cen.mm / 1000) < 2e-3, `P3 塗り最大半径 ${maxFillR_m.toFixed(3)}m = 測距 ${(cen.mm / 1000).toFixed(3)}m`);
ok(maxFillR_m <= wallDist + 2e-3, `P3 塗りが壁(${wallDist}m)を越えない (最大 ${maxFillR_m.toFixed(3)}m・over-shoot ${((maxFillR_m - wallDist) * 1000).toFixed(2)}mm)`);
ok(maxFillR_m < maxM - 0.01, `P3 レンジ上限(${maxM}m)まで伸びていない=終端した (${maxFillR_m.toFixed(3)}m < ${maxM}m)`);
// ヒットマーカ (mm>=0) = 弧上・ラベル数字
const hitS = worldToScreen(cen.hit, view);
const dot = A.rec.fills.find(f => f.hasArc);
ok(!!dot, 'P3 ヒット点マーカ (丸) を描画');
ok(A.rec.texts.some(t => t.s === String(cen.mm)), `P3/ラベル: 測距値 "${cen.mm}" を表示`);

// P7: 単一コーンの塗り alpha 上限 (colored=×0.85)
const maxAlpha = Math.max(...g.stops.map(st => parseAlpha(st.color)));
ok(maxAlpha <= 0.20 + 1e-9, `P7 塗り alpha 上限 = ${maxAlpha.toFixed(3)} ≤ 0.20 (他車を潰さない ceiling)`);

// ── ケースB: 空扇 (反射なし=正面に壁なし) ─────────────────────────────
console.log('\n=== B) 空扇 (反射なし): P5 レンジ上限まで・ヒット点なし・ラベル∞ ===');
const wallsB = [{ x1: 50, y1: -50, x2: 50, y2: 50 }]; // 遠方=扇外
const sensB = readAll(carA, wallsB);
const cenB = sensB[1];
ok(cenB.mm < 0, `空扇の測距 mm=${cenB.mm} (<0=範囲外)`);
const B = makeRecCtx();
drawSensors(B.ctx, [cenB], view, { show: true, labels: true, color: '#e2202a', dash: false });
const wedgeB = B.rec.fills.find(f => f.style && f.style.kind === 'radgrad');
const apexB = wedgeB.verts[0];
const maxRB_m = Math.max(...wedgeB.verts.slice(1).map(p => Math.hypot(p.x - apexB.x, p.y - apexB.y))) / S;
ok(Math.abs(maxRB_m - maxM) < 2e-3, `P5 空扇は塗り半径=レンジ上限 ${maxRB_m.toFixed(3)}m (期待 ${maxM}m)`);
ok(!B.rec.fills.some(f => f.hasArc), 'P5 ヒット点マーカ (丸) を描かない');
ok(B.rec.texts.some(t => t.s === '∞'), 'P5 ラベル "∞" を表示');

// ── ケースC: 色覚セーフ (dash:true) ───────────────────────────────────
console.log('\n=== C) 色覚セーフ (dash:true): P6 辺が破線・ヒットマーカが四角 ===');
const C = makeRecCtx();
drawSensors(C.ctx, [cen], view, { show: true, labels: false, color: '#e2202a', dash: true });
ok(C.rec.dashes.some(d => d.length === 2 && d[0] === 6 && d[1] === 4), 'P6 辺の破線 setLineDash([6,4])');
ok(C.rec.rects.some(r => r.w === 6 && r.h === 6), 'P6 ヒットマーカが四角 (fillRect 6×6)');

// ── 総合 ──────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(58));
if (fail === 0) console.log('AM2 距離減衰コーン描画ゲート: 全パス ○');
else { console.log(`AM2 ゲート: ${fail} 件 失敗 ✗`); process.exitCode = 1; }
