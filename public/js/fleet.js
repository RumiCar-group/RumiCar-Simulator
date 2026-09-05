// 車両スロット = 1台分の実行単位 (プログラム・物理・ラップ計測)。
// スロットの生成・グリッド配置・物理積分・プログラム tick を main (UI/ループ) から分離。
import { FLEET, CAR_TYPE_DEFAULT, CONST, SIM, CAR, PHYSICS, TIRE_SETS, TIRE_DEFAULT, GEAR_SETS, GEAR_DEFAULT, SUSP_SETS, SUSP_DEFAULT, STEER_SETS, STEER_DEFAULT, BRAKE_SETS, BRAKE_DEFAULT, gLatOf } from './config.js';

// 装備値の正規化 (Stage AO6/AS9)。白リスト外・未指定は既定へ落とす **単一の実装** (UI・共有 URL・
// レース field・swapPhysics が同じ規則を通る=「同じ値が意味の違う複数箇所」でズレない)。
// 旧 `(x==='slip')?'slip':'normal'` と normal/slip については同一の写像 = 既存挙動 byte 不変。
export function normTire(v) { return TIRE_SETS.includes(v) ? v : TIRE_DEFAULT; }
export function normGear(v) { return GEAR_SETS.includes(v) ? v : GEAR_DEFAULT; }
export function normSusp(v) { return SUSP_SETS.includes(v) ? v : SUSP_DEFAULT; }   // AS11
export function normSteer(v) { return STEER_SETS.includes(v) ? v : STEER_DEFAULT; } // AS12 (3エンジン共通)
export function normBrake(v) { return BRAKE_SETS.includes(v) ? v : BRAKE_DEFAULT; } // AV2 (v2 のみ)
import { Car, checkCollision, carEdges } from './physics.js';
import { DynCar, DYN } from './physics_dyn.js';
import { CarV2 } from './physics_v2.js';
import { t } from './i18n.js';

// 走行車両の生成 (物理モードで実装を選択)。
// スポーン判定等の「形だけ使う」一時オブジェクトは軽量な Car のままで良い
// (corners() は両実装同一のため判定結果も同じ)。
function newCar(spawn) {
  if (PHYSICS.mode === 'v2') return new CarV2(spawn);   // Stage AO1: 精密動力学 v2 (骨格)
  return PHYSICS.mode === 'dynamic' ? new DynCar(spawn) : new Car(spawn);
}
import { buildApi } from './api.js';
import { LapTracker } from './lap.js';
import { segIntersect, distToSeg } from './geom.js';
import { wallGridFor, resolveFleetContacts, vCrashOf } from './contact_v2.js';

// 許容誤差つき線分交差 (スポーン判定専用)。壁ポリゴンの継ぎ目頂点をちょうど通る線分は、
// 浮動小数の丸めで両隣の壁とも t/u が僅かに [0,1] を外れ「非交差」になり得る (すり抜け)。
// 僅かに広い区間で判定してこの縮退を防ぐ。
function segHit(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  const e = 1e-7;
  return t >= -e && t <= 1 + e && u >= -e && u <= 1 + e;
}

// 廊下伝いの BFS でスタートから到達できる点を近い順に列挙する。
// 直線グリッド候補が尽きるコース (スタートが鋭角コーナー直上等) の保険。
// 1 歩ごとに「壁を横切らない」を確認しながら広がるので、候補は必ずコース内に収まる。
function corridorCandidates(course, st, maxPts = 600) {
  const step = 0.07;
  const key = (x, y) => Math.round(x / step) + ',' + Math.round(y / step);
  const clear = (a, b) => !course.walls.some(w => segHit(a, b, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }));
  const seen = new Set([key(st.x, st.y)]);
  const q = [{ x: st.x, y: st.y, theta: st.theta }];
  const out = [];
  for (let qi = 0; qi < q.length && out.length < maxPts; qi++) {
    const c = q[qi];
    for (let k = 0; k < 8; k++) {
      const ang = k * Math.PI / 4;
      const x = c.x + step * Math.cos(ang), y = c.y + step * Math.sin(ang);
      const kk = key(x, y);
      if (seen.has(kk)) continue;
      if (x < 0 || y < 0 || x > course.bounds.w || y > course.bounds.h) continue;
      if (!clear(c, { x, y })) continue;
      seen.add(kk);
      // 車の向き: スタートと同じ → 進行方向 (=局所的な廊下の向き) → 全方位 22.5° 刻み の順に
      // 置ける向きを探す (大きな車は廊下方向にしか収まらず、45°刻みでは曲がり廊下で全滅するため)。
      const travel = Math.atan2(y - c.y, x - c.x);
      let theta = null;
      const ths = [c.theta, travel, travel + Math.PI];
      for (let j = 1; j < 8; j++) { ths.push(travel + j * Math.PI / 8, travel - j * Math.PI / 8); }
      for (const th of ths) {
        if (!checkCollision(new Car({ x, y, theta: th }), course.walls)) { theta = th; break; }
      }
      if (theta === null) {
        q.push({ x, y, theta: c.theta }); // 置けないが通路としては先へ広げる
        continue;
      }
      const node = { x, y, theta };
      q.push(node); out.push(node);
    }
  }
  return out;
}

// 1 台分の「空いている初期位置」を探す。occupied = 既に置いた他車の位置 (重ならないよう避ける)。
// スタート地点を起点に、後方→(無ければ)前方へ、左右にずらしながら、壁・コース外・他車と
// 重ならない最初の空きを返す。
// 重なり判定は「現在の車体寸法 (CAR) での矩形同士の交差チェック」= 車体スケールを変えても厳密。
// 希望車間 (spawnSep) も寸法に追従する。フォールバックでも交差する点は決して採用しない。
function spawnSep() { return Math.hypot(CAR.length, CAR.width) + 0.015; } // 向きを問わず非接触の中心距離+余白

// ── 路面属性の一括受け渡し (Stage AV1 で 2 箇所の重複を1つの門へ集約) ───────────────────
// spawn は `course.start` を丸ごと渡さず、車が読むフィールドだけを写す。この「写し」が
// **freeSpawn と rebuildSpawns の 2 箇所に重複**していたため、AS10 以降にコース属性を足すたび
// 片方だけ直す事故が起きうる状態だった (実測: AV1 の `surface` は実際に両方へ書き忘れ、node の
// 単体検査は通るのに `runRace` の traceHash が変わらないという形で実ブラウザゲート T3-d が検出した)。
// **経路を増やすときフィルタを片側にだけ書かない** (RATELIMIT-1 の教訓) ため、ここへ集約する。
//   ・downhill/grip は常に持たせる (従来どおり)。
//   ・muDecay/surface は **指定があるときだけキーを足す** = 未指定コースの spawn オブジェクトは
//     従来と同一の形 ⇒ JSON 往復・凍結記録・byte 不変。
function roadMeta(st) {
  const m = { downhill: st.downhill || 0, grip: st.grip || 1 };
  if (st.muDecay != null) m.muDecay = +st.muDecay;   // 路面 muDecay (§5・AO8・v2 のみ)
  if (st.surface != null) m.surface = String(st.surface);   // 路面種別 (AV1・v2 のみ)
  return m;
}
export function freeSpawn(course, occupied, idx) {
  const st = course.start;
  const meta = { theta: st.theta, ...roadMeta(st) };   // AV1: 路面属性は roadMeta へ集約 (キー順・値とも従来と同一)
  const ch = Math.cos(st.theta), sh = Math.sin(st.theta);
  // スタート(または既に置いた車)まで壁を横切らずに見通せる = スタートと同じ走行廊下上にある。
  // 「壁に囲まれているか」だけの判定ではリング系コースの内側の島 (全方向が壁) を誤って許してしまう。
  const losClear = (x, y, tx, ty) => {
    const a = { x, y }, b = { x: tx, y: ty };
    return !course.walls.some(w => segHit(a, b, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }));
  };
  const onTrack = (x, y) => losClear(x, y, st.x, st.y) || occupied.some(o => losClear(x, y, o.x, o.y));
  const minToOcc = (x, y) => occupied.length ? Math.min(...occupied.map(o => Math.hypot(x - o.x, y - o.y))) : Infinity;
  // 既配置車の車体エッジ (各車の向きで現寸法の矩形を構成)。交差チェックに使う。
  const occEdges = occupied.flatMap(o => carEdges(new Car(o)));
  // 厳密な非重なり: 矩形交差なし + 中心距離が車幅以上 (同位置同向き=辺が交差しない縮退を除外)
  const noOverlap = (x, y, theta) =>
    minToOcc(x, y) >= CAR.width && !checkCollision(new Car({ x, y, theta }), [], occEdges);
  // AK3 (GitHub #26 D6/D7): 発走方向 (st.theta) に前方余地があり「走り出せる」位置か。実態の収容容量
  //   ＝「N台が走り出せる」の核。前方 0.5 車長先まで車体を進めても壁交差しなければ driveable とみなす
  //   (実測: 走り出せる配置は前方 ~1車長クリア・走り出せない配置は ~0.26車長で壁=ここに境界がある)。
  //   従来の千鳥 (laneBlocked) は「前方コーンに"他車"が居るか」だけ見て"壁"を見ず、曲がり際で車を壁
  //   向きに置いて発走不能 (毎サブステップ壁で原子棄却され回頭も溜まらない) にしていた=これを塞ぐ。
  //   広いコース (オーバル等) は前方が常に空く=この絞り込みは no-op (=正準 verifyHash・卓上 byte 不変)。
  const driveable = (x, y) =>
    !checkCollision(new Car({ x: x + 0.5 * CAR.length * ch, y: y + 0.5 * CAR.length * sh, theta: st.theta }), course.walls);
  // 候補: スタート起点に 後方→前方、左右にずらす (スタートに近い順)。車体スケールに応じて広げる。
  const k = Math.max(1, CAR.length / 0.19);
  const sep = spawnSep();
  const lats = [0, 0.11, -0.11, 0.2, -0.2, 0.31, -0.31, 0.42, -0.42].map(l => l * k);
  const cands = [];
  if (idx === 0) cands.push([st.x, st.y]);
  for (let back = 0; back <= 1.8 * k; back += 0.035 * k) for (const lat of lats) cands.push([st.x - back * ch - lat * sh, st.y - back * sh + lat * ch]);
  for (let fwd = 0.035 * k; fwd <= 1.5 * k; fwd += 0.035 * k) for (const lat of lats) cands.push([st.x + fwd * ch - lat * sh, st.y + fwd * sh + lat * ch]);
  // AD2: 賢い初期配置 = 「発走時に他車が走行ライン (進行方向 CENTER ToF) 上に居て即ロックしない」
  // 位置を優先する。st.theta 向きの縦コーン (横半幅 coneHalf・前後 coneLen) に他車中心が入る候補は
  // 「ライン直撃」とみなして避け、スタートに近い順で最初の lane-clear かつ十分離れた点を採る
  // (前車の真後ろ/真ん前でなく隙間に入る=千鳥配置)。前後対称に判定する=「前に他車がいる」だけでなく
  // 「自分が他車の真ん前に入る (前車の走行ラインを塞ぐ)」も避ける。lane-clear が皆無 (狭路) のときは
  // 従来どおり「最初の十分離れた点」へフォールバック (AC1 と同一配置=退行ゼロ・極小コースは安全側)。
  const coneHalf = CAR.width + 0.02;                  // ライン直撃とみなす横半幅 (車幅+小余白・領域追従)
  const coneLen = Math.max(4 * CAR.length, sep * 3);  // 「即ロック」とみなす前後縦距離 (数台身・領域追従)
  const laneBlocked = (x, y) => occupied.some(o => {
    const fx = (o.x - x) * ch + (o.y - y) * sh;        // 候補↔他車 の前後成分 (st.theta 基準・符号不問)
    const lx = -(o.x - x) * sh + (o.y - y) * ch;       // 同・横成分
    return Math.abs(fx) < coneLen && Math.abs(lx) < coneHalf;
  });
  // 1) スタートに近い順に有効点を走査。十分離れた (≥sep) 点のうち lane-clear を最優先で即採用し、
  //    lane-clear が無ければ「最初の ≥sep 点」(従来挙動) を温存してフォールバックに使う。
  let best = null, bestD = -1, firstSep = null, bestWall = null, bestWallD = -1;
  for (const [x, y] of cands) {
    // 壁交差しない & スタートと同じ廊下上 (LOS=島でない) の点だけを候補化。従来の valid を
    // 「壁交差+廊下」と「重なり」の2段に分け、間で最終保険 (bestWall) を温存する (返り値の順序・
    // 早期 return 条件は従来と完全に同一=byte/verifyHash 不変、変わるのは異常系の最終フォールバックのみ)。
    if (checkCollision(new Car({ x, y, theta: st.theta }), course.walls) || !onTrack(x, y)) continue;
    const d = minToOcc(x, y);
    // AK3 (GitHub #26 D6/D7): 壁交差せず廊下上で「他車から最も離れた点」を最終保険として温存。
    // 従来の最終保険は壁内スタートをそのまま返し車を壁にめり込ませていた=これを実在の非交差点へ置換。
    if (d > bestWallD) { bestWallD = d; bestWall = { x, y }; }
    if (!noOverlap(x, y, st.theta)) continue;   // 他車と重なる点は valid でない (従来 valid と同条件)
    if (!driveable(x, y)) continue;             // 前方が壁で発走できない位置は配置しない (実態容量=走り出せる)
    if (d >= sep) {
      if (!laneBlocked(x, y)) return { x, y, ...meta };  // 賢い配置: 走行ラインがクリアな点を即採用
      if (!firstSep) firstSep = { x, y, ...meta };        // 従来の「最初の ≥sep 点」を温存
    }
    if (d > bestD) { bestD = d; best = { x, y, theta: st.theta } }
  }
  // 直線グリッドに ≥sep 点はあったが全て前方ブロックなら、従来挙動 (最初の ≥sep 点) を返す
  // (= AC1 と同一配置・corridor 探索へは進まない=退行ゼロ)。
  if (firstSep) return firstSep;
  // 2) 直線グリッドに ≥sep 点が皆無の時のみ廊下伝いの BFS 候補から探す (鋭角コーナー等で廊下が曲がる場合)。
  for (const c of corridorCandidates(course, st)) {
    if (!noOverlap(c.x, c.y, c.theta)) continue;
    const d = minToOcc(c.x, c.y);
    if (d >= sep) return { ...meta, x: c.x, y: c.y, theta: c.theta };
    if (d > bestD) { bestD = d; best = c; }
  }
  // 3) 希望車間に届かなくても「重ならない有効点の中で他車から最も離れた点」を採用
  //    (best は valid/noOverlap を通った点のみ。極小コースでも交差する位置は返さない)。
  if (best) return { ...meta, x: best.x, y: best.y, theta: best.theta };
  // AK3 (D6/D7): 重なり無しの有効点が皆無でも、壁交差しない廊下上の実点 (他車から最遠) を返す
  //   = 決して壁内には置かない。残る「重なり」は呼び出し側の収容容量ガード (enforceFitRatio) が
  //   台数を実態へ減らして解消する (=代理量でなく実 freeSpawn/checkCollision/carEdges で判定)。
  if (bestWall) return { ...meta, x: bestWall.x, y: bestWall.y, theta: st.theta };
  return { x: st.x, y: st.y, ...meta }; // 廊下上に壁交差しない点が皆無=真の異常系 (壁内スタート) のみ
}

// N 台容量判定 (Stage AG・GitHub #26 §3/§7・CI-14)。配置ロジック (freeSpawn/rebuildSpawns) は無改変で、
// 現在の CAR 寸法で freeSpawn を occupied 累積で n 回呼び、全車が「壁交差0・車間重なり0・idx≥1 の
// start 団子0・前方に発走余地あり (走り出せる)」で収まるかを bool で返す純粋判定 (slots に副作用なし・
// 本物の checkCollision/carEdges を使用)。「単独車が 0.25×外形最小辺 に収まる」(代理量) でなく
// 「N 台が実際に走り出せる」(実態・AK3 D6/D7) を測る審判=Stage AK の収容容量の核。
export function fitsAllCars(course, n) {
  const occupied = [];
  const st = course.start;
  for (let i = 0; i < n; i++) {
    const sp = freeSpawn(course, occupied, i);
    if (i >= 1 && Math.hypot(sp.x - st.x, sp.y - st.y) < 1e-6) return false; // idx≥1 が start = 最終保険(団子)
    if (checkCollision(new Car(sp), course.walls)) return false;            // 壁交差
    // AK3 (D6/D7): 発走方向 (sp.theta) 前方 0.5 車長先まで壁交差しない=「走り出せる」配置か。前方が壁の
    // 位置は freeSpawn が driveable 点を置けず壁前にフォールバックした証拠=この台数は実態容量を超える。
    {
      const fch = Math.cos(sp.theta), fsh = Math.sin(sp.theta), fc = 0.5 * CAR.length;
      if (checkCollision(new Car({ x: sp.x + fc * fch, y: sp.y + fc * fsh, theta: sp.theta }), course.walls)) return false;
    }
    for (const o of occupied) {
      if (checkCollision(new Car(sp), [], carEdges(new Car(o)))) return false; // 既配置車との重なり
    }
    occupied.push(sp);
  }
  return true;
}

// 2線分の最短距離 (交差していれば 0)。本物の距離オラクル distToSeg/segIntersect を使う (CI-9)。
function segSegDist(a, b, c, d) {
  if (segIntersect(a, b, c, d)) return 0;
  return Math.min(distToSeg(a, c, d), distToSeg(b, c, d), distToSeg(c, a, b), distToSeg(d, a, b));
}
// 交差する2線分の貫入深さ = 交点から各線分端までの最短側 (連続量の負号材料・防御用)。
function segCrossDepth(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return 0;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return 0;
  const X = { x: a.x + t * rx, y: a.y + t * ry };
  return Math.min(
    Math.min(Math.hypot(X.x - a.x, X.y - a.y), Math.hypot(X.x - b.x, X.y - b.y)),
    Math.min(Math.hypot(X.x - c.x, X.y - c.y), Math.hypot(X.x - d.x, X.y - d.y)));
}
// 最小クリアランス連続量 (Stage AI・GitHub #26 §7-4・CI-14)。fitsAllCars(二値) の連続量版。
// 実 freeSpawn で n 台配置し、各車の衝突フットプリント(carEdges) ⇔ 壁 / 他車 の最小距離(m)を返す。
// 二値(fits/不fits)でなく「あと何 mm で接触するか」の連続量で出し、閾値未満を「脆弱」として
// 壊れる前に警告する材料にする (観測のみ・freeSpawn/rebuildSpawns 本体は無改変・slots 副作用なし)。
// 戻り値は符号付き: 正=離間(最小クリアランス m)、負=交差(=-最大貫入深さ・防御的で AG1 が通常は消す)。
// 本物の carEdges/distToSeg/segIntersect を使う (再実装しない・CI-9)。台数 0 (=配置なし) は Infinity。
export function minClearance(course, n) {
  const occupied = [], cars = [];
  for (let i = 0; i < n; i++) {
    const sp = freeSpawn(course, occupied, i);
    occupied.push(sp);
    cars.push(new Car(sp));
  }
  if (!cars.length) return Infinity;
  const wpts = course.walls.map(w => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]);
  const edgesOf = car => carEdges(car).map(e => [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }]);
  const ce = cars.map(edgesOf);
  let minSep = Infinity, maxPen = 0;   // 正の最小離間 / 交差時の最大貫入深さ
  const consider = (p, q, a, b) => {
    const dd = segSegDist(p, q, a, b);
    if (dd > 0) { if (dd < minSep) minSep = dd; return; }
    const pen = segCrossDepth(p, q, a, b);     // dd===0: 真の交差か端点接触か
    if (pen > 0) { if (pen > maxPen) maxPen = pen; } else { minSep = 0; }
  };
  for (let i = 0; i < cars.length; i++) {
    for (const [p, q] of ce[i]) for (const [a, b] of wpts) consider(p, q, a, b);      // 車 ⇔ 壁
    for (let j = i + 1; j < cars.length; j++)                                          // 車 ⇔ 他車
      for (const [p, q] of ce[i]) for (const [a, b] of ce[j]) consider(p, q, a, b);
  }
  return maxPen > 0 ? -maxPen : minSep;
}

// 後方互換: 単独配置 (makeSlot 用)。実際の重なり回避は rebuildSpawns が担う。
export function spawnPos(course, slotCount, i) {
  return freeSpawn(course, [], i);
}

// スロット生成。logFor(slot) は Serial 出力の書込先 (UI 側で用意) を返すファクトリ。
let slotSeq = 0;
export function makeSlot({ i, lang, src, course, slotCount, logFor }) {
  const spawn = spawnPos(course, slotCount, i);
  const car = newCar(spawn);
  const slot = {
    id: ++slotSeq,
    name: FLEET.names[i] || ('C' + (i + 1)),
    color: FLEET.colors[i % FLEET.colors.length],
    lang, src,
    carType: CAR_TYPE_DEFAULT,  // 車種 (CAR_TYPES のキー)
    car, spawn,
    world: null, hostEnv: null, controller: null,
    lap: new LapTracker(course),
    loopTimer: 0, running: false,
    serial: '',   // この車両の Serial 出力バッファ
  };
  car.type = slot.carType;
  slot.world = {
    car, walls: course.walls, start: spawn,
    log: logFor(slot), _sensors: [], _pendingDelay: 0, _others: [], rear: false,
    _sensGen: 0,      // AP5: tick 世代カウンタ。tickSlot が毎 tick 進め、api.js refresh() の測距キャッシュ鍵になる。
    _simMs: 0,        // AP8: シム時刻[ms]。tickSlot が loop 周期ぶん進め、millis()/micros() へ供給 (wallclock 非依存=決定論)。
    tire: 'normal',   // AO6/AS9: v2 タイヤセット (normal|slip|rain)。v2 車のみ car.tireSet へ反映 (旧エンジンは無視)。
    wear: false,      // AO12: タイヤ熱・摩耗 opt-in。v2 車のみ car.wear へ反映 (旧エンジンは無視)。
    gear: GEAR_DEFAULT,  // AS9: ギア比 (任意装備・既定 direct=直結)。v2 車のみ car.gearSet へ反映 (旧エンジンは無視)。
    susp: SUSP_DEFAULT,  // AS11: サス自由度 (任意装備・既定 quasi=自由度なし)。v2 車のみ car.suspSet へ反映 (旧エンジンは無視)。
    brake: BRAKE_DEFAULT, // AV2: 制動装置 (任意装備・既定 motor=駆動軸のみ)。v2 車のみ car.brakeSet へ反映 (旧エンジンは無視)。
    // AS12: 操舵サーボ (任意装備・既定 tri=実機準拠の3値)。**3エンジン共通** (サーボは Car が持つ共通機構ゆえ
    // v2 専用の上3つと違い standard/dynamic でも効く)。api.js が world.steerSet を見て第2引数を受理する。
    steerSet: STEER_DEFAULT,
  };
  car.steerSet = slot.world.steerSet;   // AS12: 全エンジン (Car/DynCar/CarV2 が共通で持つ)
  if (car.engine === 'v2') { car.tireSet = slot.world.tire; car.wear = slot.world.wear; car.gearSet = slot.world.gear; car.suspSet = slot.world.susp; car.brakeSet = slot.world.brake; }
  slot._road = roadFrame(course);   // AP11/AS10: 道追従の路面フレーム (勾配+カント。平坦コース=null=no-op)
  slot.hostEnv = buildApi(slot.world);
  return slot;
}

// 物理モード切替: 各スロットの車オブジェクトを現行モードの実装へ入れ替える。
// world.car は API (RC_drive 等) が毎回動的に参照するため、差し替えだけで
// controller/hostEnv の再構築は不要。位置・ラップのリセットは呼び出し側で
// rebuildSpawns を呼ぶこと (コース変更と同じ扱い)。
export function swapPhysics(slots) {
  for (const s of slots) {
    const car = newCar(s.spawn);
    car.type = s.carType;
    car.steerSet = normSteer(s.world && s.world.steerSet);   // AS12: 操舵サーボは全エンジン共通ゆえ v2 判定の外
    // AO6/AO12/AS9: v2 へ切替えた車は world のタイヤ/摩耗/ギア設定を引き継ぐ (物理モード/領域切替でも装備維持)。
    if (car.engine === 'v2') {
      car.tireSet = normTire(s.world && s.world.tire);
      car.wear = !!(s.world && s.world.wear);
      car.gearSet = normGear(s.world && s.world.gear);
      car.suspSet = normSusp(s.world && s.world.susp);   // AS11
      car.brakeSet = normBrake(s.world && s.world.brake); // AV2
    }
    s.car = car;
    s.world.car = car;
    s.running = false; s.loopTimer = 0;
  }
}

// スロット数/コース変更時に全車のスポーン位置・ラップをリセット (プログラムは保持)。
// 各車を順に「既に置いた車と重ならない空き」へ配置 → 全コースで初期位置が重ならない。
// AD1: 任意 grid=[{x,y,theta},…] を渡すとその凍結位置で配置する (公式記録の忠実再現＝配置を
// データ駆動化)。grid 未指定 (既存の全呼び出し) は従来どおり freeSpawn で算法計算＝byte 完全不変。
export function rebuildSpawns(slots, course, grid) {
  const occupied = [];
  const road = roadFrame(course);   // AP11/AS10: コース適用時に路面フレームを更新 (平坦=null)
  const stMeta = roadMeta(course.start);   // AV1: 路面属性は roadMeta へ集約 (キー順・値とも従来と同一)
  slots.forEach((s, i) => {
    const g = grid && grid[i];
    const sp = g ? { x: g.x, y: g.y, theta: g.theta, ...stMeta } : freeSpawn(course, occupied, i);
    occupied.push(sp);
    s.spawn = sp;
    s._road = road;
    s.world.walls = course.walls;
    s.world.start = sp;
    s.world._others = [];
    s.car.reset(sp);
    s.lap.reset(course, { carType: s.carType, tire: s.world.tire, wear: s.world.wear, gear: s.world.gear });   // 練習記録はコース×車種別 (W2)・装備を記録へ刻む (AP2/AS9)
    s.running = false; s.loopTimer = 0;
  });
}

// 同じ場所で後退リカバリを繰り返しても抜けられない回数の上限 (Stage AK4/D5)。これを超えたら袋小路と
// みなして後退の arm をやめる (無限後退/振動を防ぐ=「全時間 壁張付き」配信の解消)。実コースの発走ジャムは
// 数回で抜けるため到達しない (到達0を wf_recover_model で構造検査)。crashed にはせず正直に壁際で待つ。
const RECOVER_MAX = 6;
// 後退リカバリの操舵を「同じ場所での試行回数 recoverN」で切替える順 (Stage AK4/D5)。狭い楔ではレイ測距が
// 車体幅を無視して誤る (実測: rear-right 339mm でも reverse+右 は車体角が壁に当たり原子棄却で net~0) ため、
// レイで一発当てに行かず「実際の動き」で当てる: まず CENTER (真後ろ＝鼻先で壁に刺さった車を入った経路へ
// まっすぐ戻す＝最頻ケースを1回で解く)、抜けねば LEFT/RIGHT へ角度を付けて切り返す。原子棄却下で動けた
// 向き(net≥carLen)が残れば「走り出せない」は解消。clone を作らない=決定論・計装が probe を拾わない。
const RECOVER_STEER_CYCLE = [CONST.CENTER, CONST.LEFT, CONST.RIGHT];

// Stage AK7 (GitHub #26 続報・発走の順次化): 密集グリッドの同時発走で起きる「箱詰め→壁ポケット刺さり→
// normal_fr が再度壁へ舵を切り無限リカバリ」(=最狭2コース×多台数の『走り出せない車』) を、発走を順次化
// (anti-pile-up) して構造的に消す。各車は「自分の進行方向の前方コーン (前方 GATE_AHEAD×横半幅 GATE_LAT
// 車長) に他車が居る間は発走を保留 (held)」。先頭車 (前に他車が無い) から発走→離れたら次が解除…と数珠つなぎに
// 発走するので start 団子が形成されない。前方射影 f>0 は acyclic (先頭は常に解除可) ＝デッドロックしない。
// 一度解除 (released) したらラッチして二度と保留しない (発走時のみの機構＝走行中の追い抜きでは保留しない)。
// **正準/公式 verifyHash の不変性 (CI-7 ハードゲート)**: f0/f1 等の正準レースはグリッドが横並び (発走方向成分
// f=0＝誰も「前」に居ない) ＝ held に決して入らない構造 no-op ＝ 964fdc70/6e534aaf byte 不変。interact OFF/
// 単独車も他車が無く no-op。held は本関数を呼んだ loop のみが立てる opt-in フラグ ＝ 直接 integrateSlot を
// 呼ぶ既存テスト/経路は held=false のまま不変。
// コーン寸法は車長倍 (スケール不変＝freeSpawn の配置は CAR 寸法に追従するため carLen 単位で不変)。
// **横半幅 GATE_LAT が正準 no-op の鍵**: 実測 (_ak7_geom/_ak7_cone) で正準 f0/f1 オーバルの後方車は先頭から
// 横 1.05車長 (左右の列) に居る一方、ジャム (ナローシケイン/S字) の保留すべき後方車は先頭から横 0.59〜0.72車長 に居る。
// よって L∈(0.72,1.05)車長 が両者を分離＝正準オーバルは横が広く held に入らない (no-op) / ジャムだけ発火。
const GATE_AHEAD = 2.5;   // 前方コーンの奥行き (車長倍)。実測スイープで 2.0〜3.0 が最良 (3.5 は過保護で別コース退行・1.5 未満は不足)。
const GATE_LAT = 0.9;     // 前方コーンの横半幅 (車長倍)。(0.72,1.05) の中央付近＝ジャム後方車を捕え正準オーバル(横1.05車長)を除く。
export function applyStartGate(slots, interact) {
  const K = GATE_AHEAD * CAR.length, L = GATE_LAT * CAR.length;
  for (const s of slots) {
    const car = s.car;
    if (!interact || !s.running || car.crashed || car.released) { car.held = false; continue; }
    const ch = Math.cos(car.theta), sh = Math.sin(car.theta);
    let blocked = false;
    for (const o of slots) {
      if (o === s || o.car.crashed) continue;
      const dx = o.car.x - car.x, dy = o.car.y - car.y;
      const f = dx * ch + dy * sh;                      // 自分の進行方向への射影 (前方=正)
      if (f <= 1e-9 || f >= K) continue;                // 前方 (0,K) に居る他車だけが発走を塞ぐ
      if (Math.abs(-dx * sh + dy * ch) < L) { blocked = true; break; }  // 横半幅 L 以内 (同レーン)
    }
    car.held = blocked;
    if (!blocked) car.released = true;                  // ラッチ: 前が空いたら以後ずっと発走可
  }
}

// ── AP11: 峠 downhill の道追従 (road-tangent) 適用 ──
// downhill (=g·sinθ) は「世界固定の1方向」でなく、下り道に沿って常に進行方向へ働く重力成分。
// switchback は折返しごとに進行方向が反転する (実測: どの固定 slopeDir でも弧長の 34-50% が逆行し、
// 較正後 downhill が駆動加速度 2.5 を超えて失速→未完走) ため、AP10 の「固定 start.slopeDir で足りる」
// 前提は崩れる (決定ログ AP-11・CI-5)。代わりに car の位置における中心線の接線 (start→finish 向き
// =下り方向) を毎サブステップ car.slopeDir に与える。エンジン (physics_*.js の step) は AP10 が入れた
// スカラー slopeDir 消費のまま**無改変** = downhill=0 (全非峠・全凍結 f0-f3・全オラクルゲート) は
// gFwd=0 で完全 no-op = byte 不変。centerline は fitAndPlace が平行移動のみ (回転/拡縮なし) するため
// car.x/y と同一世界系で直接使える。cl.length<2 のときは無効 (下の roadFrame がガード)。
// ── AS10: 道追従の「路面フレーム」(AP11 の slopeCenterline を勾配＋カントへ一般化) ─────────────
// 面内重力は 2 成分ある — 道に沿う `downhill` (AP11) と 道に直交する `gLat` (カント=横勾配・AS10)。
// どちらも「車の位置における道の向き」を基準にするので、中心線から **接線方向** と **正規化符号付き
// 曲率** を1つのフレームとして持たせる。
//   ・接線 (slopeDir) = 最近傍セグメントの向き。**AP11 の roadDownhillDir と同一式**ゆえ既存の峠の
//     前方成分は byte 不変。
//   ・カント = `course.bank`[度] を「最急コーナーでのバンク角」とし、他は |κ|/κmax に線形 (道路設計の
//     スーパーエレベーション則 e ∝ v²κ/g)。**頂点ごとの曲率をセグメント内で線形補間**するので道に
//     沿って連続 (段差のトルクを入れない)。符号付き曲率 κ=dθ/ds>0 (左旋回) → 内側は左 → gLat>0。
// **非活性は null**: 中心線が無い (annulus/raw/loop)・または downhill も bank も 0 (=既存の全コース)
// なら null を返し、呼び側は car.slopeDir/gLat を一切触らない = 完全 no-op = byte 不変。
// **export は検証用** (常設ゲート `wf_as10_cant.mjs` が *本番の実装そのもの* を呼んで測るため。
// AS2 の `drawCourseLayer`・AO10 の `probe` フックと同じ作法＝述語を検査側へ写し取らない・CI-8/CI-9)。
export function roadFrame(course) {
  const cl = course.centerline;
  if (!Array.isArray(cl) || cl.length < 2) return null;
  const bank = +(course.bank || 0), dh = +(course.downhill || 0);
  if (dh === 0 && bank === 0) return null;
  const closed = !course.touge;          // track は閉ループ (末尾→先頭も道)・峠は開いた片道
  const n = cl.length;
  const nSeg = closed ? n : n - 1;
  const dir = new Float64Array(nSeg), len = new Float64Array(nSeg);
  for (let i = 0; i < nSeg; i++) {
    const a = cl[i], b = cl[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    dir[i] = Math.atan2(dy, dx); len[i] = Math.hypot(dx, dy);
  }
  // 頂点 v (セグメント v−1 と v の継ぎ目) の符号付き曲率 κ=Δθ/ds。開いた道の両端は 0 (直線扱い)。
  const kv = new Float64Array(n);
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  for (let v = 0; v < n; v++) {
    const iPrev = v - 1, iCur = v % nSeg;
    if (!closed && (v === 0 || v >= nSeg)) { kv[v] = 0; continue; }
    const p = closed ? (iPrev + nSeg) % nSeg : iPrev;
    const ds = 0.5 * (len[p] + len[iCur]);
    kv[v] = ds > 1e-9 ? wrap(dir[iCur] - dir[p]) / ds : 0;
  }
  let kMax = 0;
  for (let v = 0; v < n; v++) kMax = Math.max(kMax, Math.abs(kv[v]));
  const wn = new Float64Array(n);
  if (kMax > 1e-9) for (let v = 0; v < n; v++) wn[v] = kv[v] / kMax;
  return { cl, n, nSeg, closed, dir, wn, bank, kMax };
}

// 車の位置における路面フレームを car へ書き込む (毎サブステップ)。rf=null は呼ばない (完全 no-op)。
export function applyRoadFrame(car, rf) {
  const cl = rf.cl, nSeg = rf.nSeg, n = rf.n;
  let best = Infinity, bi = 0, bt = 0;
  const px = car.x, py = car.y;
  for (let i = 0; i < nSeg; i++) {
    const a = cl[i], b = cl[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 < 1e-12 ? 0 : ((px - a[0]) * dx + (py - a[1]) * dy) / l2;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    // **Math.hypot で比較する** (AP11 の distToSeg と同一の丸め) — 二乗距離で比べると、ほぼ等距離の
    // 2 セグメントで argmin が入れ替わりうる。slopeDir は前方成分 gFwd を決めるので、AS10 が意図して
    // 変える横成分以外は AP11 と同一の道筋を通す。
    const d = Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
    if (d < best) { best = d; bi = i; bt = t; }
  }
  car.slopeDir = rf.dir[bi];
  // 頂点曲率をセグメント内で線形補間 (道に沿って連続)。bank=0 なら gLatOf が 0 を返す。
  const w = rf.wn[bi] + (rf.wn[(bi + 1) % n] - rf.wn[bi]) * bt;
  car.gLat = gLatOf(DYN.g, rf.bank, w);
}

// 物理積分 + 衝突 + ラップ (1 台分)。
// 壁との衝突: recover=ON なら「後退して切り返し復帰」を試みる / OFF なら従来どおりクラッシュ(恒久停止)。
// 他車との接触 = 重なり防止のため移動を取り消してその場停止 (クラッシュではない)。
export function integrateSlot(slot, dt, others, walls, recover) {
  const car = slot.car;
  if (!car.crashed && dt > 0 && !car.held) {
    // 諦め(袋小路)中は一定時間 待避して他車を塞がない → クールダウン後に再挑戦 (周囲の渋滞が動けば抜ける)。
    if (car.gaveUp) {
      car.recoverCooldownT = Math.max(0, (car.recoverCooldownT || 0) - dt);
      if (car.recoverCooldownT <= 0) { car.gaveUp = false; car.recoverN = 0; }
    }
    // 復帰中はプログラム指令を上書きして後退する (向きは RECOVER_STEER_CYCLE で切替える)。
    if (car.recoverT > 0) {
      car.driveDir = CONST.REVERSE; car.pwm = 150; car.steer = car.recoverSteer;
      car.recoverT = Math.max(0, car.recoverT - dt);
    }
    let rem = dt; const h = 1 / SIM.physicsHz;
    // D1 (Stage AK・GitHub #26): 衝突判定を物理サブステップ(1/60)ごとに行う。従来は外側 dt を全部
    // 進めてから衝突を1回だけ見ていたため、外側 dt が 1/60 より粗いライブ積分では (a) 壁を1ステップで
    // すり抜ける (フルスケール高速のトンネリング)・(b) 1回のリバートで戻すのが dt 分=回転累積で角の車が
    // 壁にねじ込まれ恒久停止 (走り出せない)、が起きていた。サブステップ毎に判定・リバートすれば、すり抜け/
    // めり込みが 1 サブステップ分に有界化され、ライブもレースと同一粒度になる (一つのモデル)。
    // レース/卓上ベンチは dt=1/60=ちょうど1サブステップで呼ぶため、ループは1回=従来と完全に同一の
    // 判定・リバート＝ verifyHash / 卓上 byte は不変 (固定60Hzの呼び出し側は影響を受けない)。
    while (rem > 1e-6) {
      const s = Math.min(h, rem); rem -= s;
      const px = car.x, py = car.y, pth = car.theta, tlen = car.trail.length;
      if (slot._road) applyRoadFrame(car, slot._road);   // AP11/AS10: 道追従の勾配方向 slopeDir とカント gLat
      car.step(s);
      if (checkCollision(car, walls)) {
        if (recover && slot.running) {
          // 復帰: 衝突したサブステップを「丸ごと」取り消し (位置だけでなく向き theta も戻す = D3)。
          // 向きを残すと、塞がれた車が回転だけ累積して自分の角を壁にねじ込み恒久停止する (走り出せない)。
          // 姿勢を最後の正しい(非めり込み)状態へ戻せば、車は壁際で待ち、指令が有効になった瞬間
          // (前が空く/後退する)に動き出せる。halt() が線速度・ヨーレートを 0 にする。
          car.x = px; car.y = py; car.theta = pth; car.halt(); car.trail.length = tlen;
          // 復帰の切り返しを arm (後退向きの選択・袋小路の諦め判定は armRecover に集約=AP22 で v2 経路と 2→1 統合)。
          if (car.recoverT <= 0) armRecover(car, slot);
        } else {
          // クラッシュ: 壁にめり込んだ姿勢のまま固定せず、最後の正しい姿勢へ戻してから停止 (D2)。
          car.x = px; car.y = py; car.theta = pth; car.halt(); car.trail.length = tlen;
          car.crashed = true; slot.lap.addCrash(); slot.running = false;
          slot.world.log(t('sim.crash.stopped'));
        }
        break;   // 衝突サブステップは取り消し済。残り dt は同姿勢で進めても無意味=壁際で待つ
      } else if (others.length && checkCollision(car, [], others)) {
        // 他車に重なる前進を取り消す (= 前車に阻まれて進めない)。**向き(theta)は戻さない**:
        // 接触中もわずかに回頭して隣をすり抜けられる余地を残す (レース流れ・恒久デッドロック回避)。
        // 壁と違い相手も動くので回頭の累積めり込みは起きにくく、theta を戻すと密集レースで
        // 車が団子に固まって壁へ押し出され大量 DNF になる (実測で確認・car-car は従来挙動を保つ)。
        car.x = px; car.y = py; car.halt(); car.trail.length = tlen;
        break;
      }
    }
  }
  const lapped = slot.lap.update(dt, car.x, car.y, slot.running && !car.crashed);
  // 峠モード: ゴール到達でその車を停止 (駆動解除)。
  if (lapped && slot.lap.touge && slot.lap.finished) {
    slot.running = false;
    car.driveDir = CONST.FREE; car.pwm = 0;
    slot.world.log(t('sim.goal', { t: slot.lap.lastLap.toFixed(2) }));
  }
}

// ════════════════════════════════════════════════════════════════════════════
// integrateFleetV2 (Stage AO4・AO_spec §3) = 走行エンジン v2 の **全車同時積分＋インパルス接触**。
// 旧 integrateSlot (1台ずつ「移動取り消し＋停止」) と別経路 (mode==='v2' のときだけ呼び出し側が使う)。
// 「触れたら即停止」を廃し、掃引 CCD＋2点マニフォールド＋法線/接線 (クーロン) インパルスで接触を
// **こすり滑走** させ、法線接近速度 > vCrash のときだけクラッシュ (従来レース規則へ写像)。前進指令下で
// 純変位が伸びない (袋小路) ときは既存 RECOVER_STEER_CYCLE を arm (recover 接続)。接触の検出/解決は
// contact_v2.js の resolveFleetContacts (純粋な剛体ソルバ) に委譲し、本関数は基質 (recover 上書き・
// gaveUp クールダウン・held/crashed=static・ラップ・touge) を従来 integrateSlot と同型に配線する。
// **旧 integrateSlot は無改変** = 卓上既定 (dynamic) の canonical f0/f1・collision/recover ゲート byte 不変。
// ════════════════════════════════════════════════════════════════════════════
// 壁グリッドは contact_v2.js の共有 wallGridFor (WeakMap・コースごと1回構築) を使う。センサー/衝突/接触が
// 同じ course.walls を渡す限り 1 個のグリッドを共用する (AP6 で readAll/checkCollision も同グリッドへ配線)。
const STUCK_WINDOW = 1.2;   // 前進指令下でこの秒数 純変位<STUCK_EPS なら袋小路 → recover arm (AO_spec §3「1.2s」)
function stuckEps() { return 0.5 * CAR.length; }   // 「動けていない」とみなす窓内純変位 (車長比=スケール不変)

// 袋小路の recover を arm (後退復帰の切り返しを仕込む)。**両エンジン共通** = integrateSlot (dynamic・
// 衝突サブステップ取り消し後) と integrateFleetV2 (v2・前進指令下の純変位不足) の両方から呼ぶ。AP22 で
// 旧 integrateSlot のインライン実装 (同一 15 行) と armRecoverV2 の重複を 2→1 統合 (純リファクタ)。
//   D5 (Stage AK4): 復帰は「後退」する。後退中はステア方向と車体の動く向きが前進と逆になる (舵を左へ切って
//   下がるとリアは左へ寄る=実測 _ak4_probe_revsteer) ため、操舵側を前方3センサーで決めると壁の方へ下がり
//   恒久リカバリループになる。後方の余地もレイ測距は車体幅を無視して誤る。そこで同じ場所での試行回数
//   recoverN で CENTER→LEFT→RIGHT と操舵を切替え (RECOVER_STEER_CYCLE)、実際の動きで抜ける向きを当てる。
//   前回リカバリ開始点から十分動いていれば別地点=リセット。RECOVER_MAX+1 で頭打ち (諦め後は同じ場所で何度
//   衝突しても arm しない=回数は発散しない)。RECOVER_MAX 回抜けられなければ一旦「諦め」て一定時間 待避する
//   (後退を arm せず壁際で待つ=他車を塞がない)・crashed にはしない (走り出せない車として正直に残す)。
function armRecover(car, slot) {
  const movedFromLast = Math.hypot(car.x - (car.recoverX ?? car.x), car.y - (car.recoverY ?? car.y));
  const isNewSpot = movedFromLast > 1.5 * CAR.length;
  car.recoverN = isNewSpot ? 1 : Math.min(RECOVER_MAX + 1, (car.recoverN || 0) + 1);
  if (isNewSpot) car.gaveUp = false;
  car.recoverX = car.x; car.recoverY = car.y;
  if (car.recoverN <= RECOVER_MAX) {
    car.recoverT = 0.7;
    car.recoverSteer = RECOVER_STEER_CYCLE[(car.recoverN - 1) % RECOVER_STEER_CYCLE.length];
    slot.world.log(t('sim.crash.recover'));
  } else if (!car.gaveUp) {
    car.gaveUp = true; car.recoverCooldownT = 2.0;
    slot.world.log(t('sim.crash.recoverGiveUp'));
  }
}

export function integrateFleetV2(slots, dt, walls, recover, interact) {
  if (dt <= 0 || !slots.length) return;
  const grid = walls.length ? wallGridFor(walls) : null;
  const grip = (slots[0] && slots[0].car.grip) || 1;
  const vCrash = vCrashOf();
  const eps = stuckEps();
  const h = 1 / SIM.physicsHz;
  let rem = dt;
  // レース/卓上ベンチは dt=1/60=ちょうど1サブステップ (ループ1回)。ライブは sdt を h 刻みへ分割 (レースと同一粒度)。
  while (rem > 1e-6) {
    const s = Math.min(h, rem); rem -= s;
    // ── 1. 前処理 (recover 上書き＋gaveUp クールダウン) と prev 姿勢の記録 (掃引 CCD 用) ──
    const bodies = [];
    for (const slot of slots) {
      const car = slot.car;
      const isStatic = car.crashed || car.held;   // crashed/held は障害物 (動かない・step しない・invM=0)
      if (!isStatic) {
        if (car.gaveUp) {
          car.recoverCooldownT = Math.max(0, (car.recoverCooldownT || 0) - s);
          if (car.recoverCooldownT <= 0) { car.gaveUp = false; car.recoverN = 0; }
        }
        if (car.recoverT > 0) {   // 復帰中はプログラム指令を上書きして後退 (integrateSlot と同型)
          car.driveDir = CONST.REVERSE; car.pwm = 150; car.steer = car.recoverSteer;
          car.recoverT = Math.max(0, car.recoverT - s);
        }
      }
      const pb = car._contactBody();       // step 前 (prev) の CG
      const pcor = car.corners();           // step 前 (prev) の四隅 (掃引 CCD)
      if (!isStatic && slot._road) applyRoadFrame(car, slot._road);   // AP11/AS10: 道追従の勾配方向 slopeDir とカント gLat
      if (!isStatic) car.step(s);           // dynamic のみ積分 (crashed/held は不動)
      const nb = car._contactBody();        // step 後 (now) の CG・速度
      bodies.push({
        slot, car, isStatic,
        invM: isStatic ? 0 : nb.invM, invI: isStatic ? 0 : nb.invI, m: nb.m,
        cx: nb.cx, cy: nb.cy, pcx: pb.cx, pcy: pb.cy,
        vx: nb.vx, vy: nb.vy, w: nb.w,
        cor: car.corners(), pcor,
        dx: 0, dy: 0, maxAppr: 0,
      });
    }
    // ── 2. 接触解決 (掃引 CCD＋マニフォールド＋インパルス＋位置補正) を純粋ソルバへ委譲 ──
    resolveFleetContacts(bodies, grid, walls, grip, interact);
    // ── 3. 書き戻し (速度インパルス→u/vlat/r・位置補正 dx,dy→x/y) ＋ クラッシュ/スタック判定 ──
    for (const bd of bodies) {
      const car = bd.car, slot = bd.slot;
      if (bd.isStatic) continue;            // static は速度/位置とも不変
      car._setContactVel(bd.vx, bd.vy, bd.w);
      car.x += bd.dx; car.y += bd.dy;
      // クラッシュ: 法線接近速度 > vCrash。recover(rejoin) OFF のときだけ crashed=true (従来レース規則へ)。
      // recover ON は crashed にせず「こすり継続」= スタック検出 (下) が袋小路のみ後退で救う。
      if (bd.maxAppr > vCrash && !recover && !car.crashed) {
        car.halt(); car.crashed = true; slot.lap.addCrash(); slot.running = false;
        slot.world.log(t('sim.crash.stopped'));
        continue;
      }
      // スタック検出 (前進指令下 STUCK_WINDOW 秒 純変位<eps → 袋小路)。recover ON かつ走行中のみ arm。
      const forward = car.driveDir === CONST.FORWARD && car.pwm > 5;
      if (recover && slot.running && forward) {
        if (!car._stuckT) { car._stuckT = 0; car._stuckX = car.x; car._stuckY = car.y; }
        car._stuckT += s;
        if (car._stuckT >= STUCK_WINDOW) {
          if (Math.hypot(car.x - car._stuckX, car.y - car._stuckY) < eps && car.recoverT <= 0) armRecover(car, slot);
          car._stuckT = 0; car._stuckX = car.x; car._stuckY = car.y;
        }
      } else {
        car._stuckT = 0;
      }
    }
  }
  // ── 4. ラップ計測 (全車・integrateSlot と同型) ＋ 峠ゴール停止 ──
  for (const slot of slots) {
    const car = slot.car;
    const lapped = slot.lap.update(dt, car.x, car.y, slot.running && !car.crashed);
    if (lapped && slot.lap.touge && slot.lap.finished) {
      slot.running = false;
      car.driveDir = CONST.FREE; car.pwm = 0;
      slot.world.log(t('sim.goal', { t: slot.lap.lastLap.toFixed(2) }));
    }
  }
}

// ユーザープログラムの 1 反復 (loop) 実行。
export function tickSlot(slot, others) {
  if (!slot.controller || !slot.running) return;
  slot.world._others = others;
  slot.world._sensGen = (slot.world._sensGen || 0) + 1;  // AP5: 他車エッジ更新後に tick 世代を進め、この tick の初回 refresh を強制再測 (前 tick の測距キャッシュを無効化)
  // AP8: この loop 反復の開始シム時刻を確定する。前反復ぶんの周期 (1/loopHz + 前反復 delay) を加算＝
  //   millis() がシム時刻由来で単調増加 (wallclock 非依存=決定論)。_pendingDelay は下で 0 に戻す前に読む。
  slot.world._simMs = (slot.world._simMs || 0) + 1000 / SIM.loopHz + (slot.world._pendingDelay || 0);
  slot.world._pendingDelay = 0;
  try { slot.controller.tick(); }
  catch (e) { slot.world.log(t('sim.runtimeErr', { e: (e.message || e) })); slot.running = false; }
}

// 各車の車体エッジ。干渉ON時に他車を「障害物」としてセンサー/衝突に渡す。
export function othersFor(edges, i, interact) {
  if (!interact || edges.length < 2) return [];
  const out = [];
  for (let j = 0; j < edges.length; j++) if (j !== i) out.push(...edges[j]);
  return out;
}

// 走行停止時の駆動解除 (全車)。
export function releaseDrive(slots) {
  for (const s of slots) { s.running = false; s.car.driveDir = CONST.FREE; s.car.pwm = 0; }
}
