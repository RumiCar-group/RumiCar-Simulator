// コースエディタ。Canvas 上のクリックで壁・スタート・フィニッシュを編集する。
// グリッドスナップ。作成したコースは JSON でシリアライズ可能。
import { snap, worldToScreen, normalizeCourse } from './course.js';
import { VIEW } from './config.js';
import { clamp, distToSeg, segIntersect } from './geom.js';
import { safeSetItem } from './storage.js'; // AP4: 保存失敗を握りつぶさず可視化

const ERASE_DIST = 0.06; // m: この距離以内の壁を消去
const STROKE_MIN = 0.06; // m: 連続描画で点を追加する最小間隔 (細かすぎる点を間引く=壁本数を抑える)

// Catmull-Rom スプラインで点列を平滑・リサンプルする (曲線モード)。端点は複製して通過させる。
// 入力点が既に STROKE_MIN 間隔なので perSeg は控えめ (壁の総数=衝突計算量を抑える)。
function catmullRom(pts, perSeg = 4) {
  if (pts.length < 3) return pts.slice();
  const P = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let j = 0; j < perSeg; j++) {
      const t = j / perSeg, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// 壁(線分)が軸並行矩形 [x0,x1]×[y0,y1] と交差(内包も含む)するか。
// いずれかの端点が矩形内、または矩形の 4 辺のどれかと線分が交われば真。
function segHitsRect(w, x0, y0, x1, y1) {
  const a = { x: w.x1, y: w.y1 }, b = { x: w.x2, y: w.y2 };
  const inside = (p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  if (inside(a) || inside(b)) return true;
  const c0 = { x: x0, y: y0 }, c1 = { x: x1, y: y0 }, c2 = { x: x1, y: y1 }, c3 = { x: x0, y: y1 };
  return segIntersect(a, b, c0, c1) || segIntersect(a, b, c1, c2) ||
         segIntersect(a, b, c2, c3) || segIntersect(a, b, c3, c0);
}

export class CourseEditor {
  constructor(course) {
    this.load(course);
    this.mode = 'wall';      // 'wall' | 'start' | 'finish' | 'erase' | 'draw' | 'curve' | 'poly' | 'rect'
    this.pending = null;     // 2 クリック系の 1 点目 (world)
    this.hover = null;       // プレビュー用の現在カーソル位置 (world)
    this.stroke = null;      // 連続描画/曲線モードのドラッグ中の点列 (world)
    this.poly = null;        // 折れ線モード(クリック配置)で確定待ちの点列 (world)
    this.rect = null;        // 矩形範囲消去モードのドラッグ中の矩形 {a,b} (world)
    // undo 用の履歴。各要素は数値(末尾に追加した壁の本数=ポップで取消) か
    // 削除アクション {type:'remove', walls:[{i,w}...]}(元の位置に戻して取消)。
    this.history = [];
  }

  load(course) {
    // 編集用に深いコピーを作る
    this.course = normalizeCourse(JSON.parse(JSON.stringify(course)));
    this.history = [];
  }

  setMode(m) { this.mode = m; this.pending = null; this.stroke = null; this.poly = null; this.rect = null; }

  // world 座標でクリック。完了したアクション名を返す (なければ null)。
  click(pt) {
    // 連続描画/曲線はドラッグ(startStroke/endStroke)で処理するのでクリックは無視
    if (this.mode === 'draw' || this.mode === 'curve') return null;
    const p = { x: clamp(snap(pt.x), 0, this.course.bounds.w), y: clamp(snap(pt.y), 0, this.course.bounds.h) };
    switch (this.mode) {
      case 'wall':
        if (!this.pending) { this.pending = p; return null; }
        if (p.x !== this.pending.x || p.y !== this.pending.y) {
          this.course.walls.push({ x1: this.pending.x, y1: this.pending.y, x2: p.x, y2: p.y });
          this.history.push(1);
        }
        this.pending = null; return 'wall';
      case 'finish':
        if (!this.pending) { this.pending = p; return null; }
        this.course.finish = normalizeCourse({
          ...this.course,
          finish: { x1: this.pending.x, y1: this.pending.y, x2: p.x, y2: p.y },
        }).finish;
        this.pending = null; return 'finish';
      case 'start':
        if (!this.pending) { this.pending = p; return null; }
        // 2 点目で向きを決める
        this.course.start = { x: this.pending.x, y: this.pending.y, theta: Math.atan2(p.y - this.pending.y, p.x - this.pending.x) };
        // フィニッシュの正方向を始点方位に追従
        this.course.finish = normalizeCourse({ ...this.course, finish: this.course.finish ? { ...this.course.finish, fx: null, fy: null } : null }).finish;
        this.pending = null; return 'start';
      case 'erase': {
        let bi = -1, bd = ERASE_DIST;
        this.course.walls.forEach((w, i) => {
          const d = distToSeg(p, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
          if (d < bd) { bd = d; bi = i; }
        });
        if (bi >= 0) { this.course.walls.splice(bi, 1); return 'erase'; }
        return null;
      }
      case 'poly': {
        // クリックごとに点を追加 (グリッドスナップ・直前と同点なら無視)。確定は finalizePoly()。
        if (!this.poly) this.poly = [];
        const last = this.poly[this.poly.length - 1];
        if (last && last.x === p.x && last.y === p.y) return null;
        this.poly.push(p); return 'poly-point';
      }
    }
    return null;
  }

  // 折れ線(クリック配置)の確定。置いた点列を直線でつないだ壁列を 1 ストロークとして追加する。
  finalizePoly() {
    if (!this.poly || this.poly.length < 2) { this.poly = null; return null; }
    const pts = this.poly; this.poly = null;
    let n = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a.x === b.x && a.y === b.y) continue;
      this.course.walls.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      n++;
    }
    if (n > 0) { this.history.push(n); return 'poly'; }
    return null;
  }

  move(pt) { this.hover = { x: clamp(snap(pt.x), 0, this.course.bounds.w), y: clamp(snap(pt.y), 0, this.course.bounds.h) }; }

  // ===== 連続描画 / 曲線モード (ドラッグで中心線を連続入力) =====
  // フリーハンドはグリッドスナップせず bounds 内にクランプのみ (滑らかさ優先)。
  _clampPt(pt) { return { x: clamp(pt.x, 0, this.course.bounds.w), y: clamp(pt.y, 0, this.course.bounds.h) }; }

  startStroke(pt) {
    if (this.mode !== 'draw' && this.mode !== 'curve') return;
    this.stroke = [this._clampPt(pt)];
  }
  extendStroke(pt) {
    if (!this.stroke) return;
    const p = this._clampPt(pt), last = this.stroke[this.stroke.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= STROKE_MIN) this.stroke.push(p);
  }
  // ドラッグ確定。点列を(曲線モードなら平滑して)連結した壁セグメント群として追加する。
  endStroke() {
    if (!this.stroke) return null;
    let pts = this.stroke; this.stroke = null;
    if (pts.length < 2) return null;
    if (this.mode === 'curve') pts = catmullRom(pts);
    let n = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a.x === b.x && a.y === b.y) continue;
      this.course.walls.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      n++;
    }
    if (n > 0) { this.history.push(n); return this.mode; }
    return null;
  }

  // ===== 矩形範囲消去モード (ドラッグで矩形を描き、交差する壁を一括消去) =====
  startRect(pt) {
    if (this.mode !== 'rect') return;
    const p = this._clampPt(pt);
    this.rect = { a: p, b: p };
  }
  extendRect(pt) {
    if (!this.rect) return;
    this.rect.b = this._clampPt(pt);
  }
  // ドラッグ確定。矩形に交差(内包も含む)する壁を一括削除し、undo 用に元の位置とともに記録する。
  // start/finish は walls とは別フィールドなので対象外 (誤って壊さない)。
  endRect() {
    if (!this.rect) return null;
    const { a, b } = this.rect; this.rect = null;
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    if (x1 - x0 < 1e-9 && y1 - y0 < 1e-9) return null; // クリックのみ(面積ゼロ)は無操作
    const hit = [];
    this.course.walls.forEach((w, i) => {
      if (segHitsRect(w, x0, y0, x1, y1)) hit.push({ i, w });
    });
    if (!hit.length) return null;
    // 削除は末尾側から (添字ずれ回避)、記録は昇順 (undo で昇順に splice 復元)
    for (let k = hit.length - 1; k >= 0; k--) this.course.walls.splice(hit[k].i, 1);
    this.history.push({ type: 'remove', walls: hit });
    return 'rect';
  }

  // 直近の追加/削除アクションを取り消す
  undo() {
    // 折れ線を配置中なら、まず確定前の点列を取り消す (壁はまだ無いので history は触らない)
    if (this.poly) { this.poly = null; return; }
    this.pending = null; this.stroke = null; this.rect = null;
    if (!this.history.length) { if (this.course.walls.length) this.course.walls.pop(); return; }
    const h = this.history.pop();
    if (typeof h === 'number') {
      for (let k = 0; k < h && this.course.walls.length; k++) this.course.walls.pop();
    } else if (h && h.type === 'remove') {
      // 削除した壁を元の位置へ戻す (昇順 splice = 元の添字に復元)
      for (const { i, w } of h.walls) this.course.walls.splice(i, 0, w);
    }
  }
  clearWalls() { this.course.walls = []; this.pending = null; this.stroke = null; this.poly = null; this.rect = null; this.history = []; }

  toJSON() {
    const c = this.course;
    return {
      name: c.name, bounds: c.bounds, start: c.start, finish: c.finish, walls: c.walls,
    };
  }

  result() { return normalizeCourse(this.toJSON()); }

  // プレビュー描画 (ペンディング点・スタート・カーソル)
  drawOverlay(ctx, view) {
    ctx.save();
    // スタートマーカ
    const s = this.course.start;
    const sp = worldToScreen({ x: s.x, y: s.y }, view);
    ctx.fillStyle = '#00c853';
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 6, 0, Math.PI * 2); ctx.fill();
    const hp = worldToScreen({ x: s.x + 0.18 * Math.cos(s.theta), y: s.y + 0.18 * Math.sin(s.theta) }, view);
    ctx.strokeStyle = '#00c853'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(hp.x, hp.y); ctx.stroke();
    // ペンディング点 + カーソルへのゴースト線
    if (this.pending && this.hover) {
      const a = worldToScreen(this.pending, view), b = worldToScreen(this.hover, view);
      ctx.strokeStyle = VIEW.editGhost; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.hover) {
      const c = worldToScreen(this.hover, view);
      ctx.fillStyle = VIEW.editGhost;
      ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, Math.PI * 2); ctx.fill();
    }
    // 折れ線モード: 置いた点と点間の直線、最後の点→カーソルのゴースト線をプレビュー
    if (this.poly && this.poly.length >= 1) {
      ctx.strokeStyle = VIEW.editGhost; ctx.lineWidth = 3;
      if (this.poly.length > 1) {
        ctx.beginPath();
        const a0 = worldToScreen(this.poly[0], view); ctx.moveTo(a0.x, a0.y);
        for (let i = 1; i < this.poly.length; i++) { const q = worldToScreen(this.poly[i], view); ctx.lineTo(q.x, q.y); }
        ctx.stroke();
      }
      const lastP = this.poly[this.poly.length - 1];
      if (this.hover) {
        const a = worldToScreen(lastP, view), b = worldToScreen(this.hover, view);
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = VIEW.editGhost;
      for (const pp of this.poly) { const q = worldToScreen(pp, view); ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, Math.PI * 2); ctx.fill(); }
    }
    // 矩形範囲消去モード: ドラッグ中の矩形を破線で、内部を薄く塗ってプレビュー
    if (this.rect) {
      const a = worldToScreen(this.rect.a, view), b = worldToScreen(this.rect.b, view);
      const rx = Math.min(a.x, b.x), ry = Math.min(a.y, b.y);
      const rw = Math.abs(b.x - a.x), rh = Math.abs(b.y - a.y);
      ctx.fillStyle = 'rgba(255,80,80,0.18)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = '#ff5050'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }
    // 連続描画/曲線モード: ドラッグ中のストロークをプレビュー (曲線モードは平滑後を表示)
    if (this.stroke && this.stroke.length > 1) {
      const sp = (this.mode === 'curve') ? catmullRom(this.stroke) : this.stroke;
      ctx.strokeStyle = VIEW.editGhost; ctx.lineWidth = 3;
      ctx.beginPath();
      const a0 = worldToScreen(sp[0], view); ctx.moveTo(a0.x, a0.y);
      for (let i = 1; i < sp.length; i++) { const q = worldToScreen(sp[i], view); ctx.lineTo(q.x, q.y); }
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ===== 保存コース (localStorage) =====
const STORE_KEY = 'rumicar.courses';

export function loadSavedCourses() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
  catch (e) { return {}; }
}
export function saveCourse(name, json) {
  const all = loadSavedCourses();
  all[name] = { ...json, name };
  safeSetItem(STORE_KEY, JSON.stringify(all), 'course'); // AP4: 失敗は 1 行通知
}
export function deleteCourse(name) {
  const all = loadSavedCourses();
  delete all[name];
  safeSetItem(STORE_KEY, JSON.stringify(all), 'course'); // AP4: 失敗は 1 行通知
}
