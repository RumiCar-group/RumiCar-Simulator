// wf_bh5_marshal.mjs — Stage BH5 常設ゲート: 逆走の向き直し（fleet.js marshalCheck）を固定する。
// ════════════════════════════════════════════════════════════════════════════
// 背景（BH2 実測・2026-10-04）: プログラムは前方 3 センサーだけで走るのでコースの進行方向を知れず、切り返し・接触・自分の操舵で
//   向きが反転するとそのまま逆向きに走り続けた（公式レースのペナルティ復帰で逆走した車 動力学 6.3%・クラシック 4.6%・精密 v2 23.4%。
//   4 割は走行の終わりまで逆向きのまま）。裁定（BH-4）で、自動復帰 ON（ライブ）／ペナルティ復帰（公式レース）の走行中の車が、
//   車体の向きが進行方向と逆のまま逆へ 5 車長進んだら、向きを進行方向へ直す（コース係が車を置き直すのと同じ）。公式レースでは
//   切り返しと同じく 1 回 3 秒。働くのは進行方向が分かるコース（中心線を持つ出荷の track と峠・壁が annulus の形のコース）だけで、
//   自作・投稿コース、リタイア規則、自動復帰 OFF では 1 ビットも変わらない。注記は fleet.js の「BH5」。
//
// 測定（オラクル）は product の向き直しの部品を呼ばない:
//   ①コースに沿った進み（位置だけ）: 中心線の最近点の弧長（annulus は中心まわりの角度 × 半径の中ほど）を積算し、
//     **いちばん進んだ所からどれだけ戻ったか（後退量）**の最大を車長で出す。逆走は後退量が伸び続ける（改修前: 数十〜数百車長）。
//   ②向きを直した瞬間の姿勢（ログの呼び出しの時点）: 壁と交差しない（checkCollision）・その瞬間のどの他車とも重なりの面積
//     （fleet.js overlapArea）を直す前より増やさない・向きがその基準点の進行方向と cos > 0.9・速度 0・その tick に周回が増えない。
//   ③周回の数（wf_bh3_laps と同じ線分の通過の測定）: 数えた周回 ≤ 順方向へ回り切った周回・回り切った tick に数える。
//
// 検査:
//   A) 進行方向の場: 出荷の全コースで、あるべきコース（フィニッシュのある 64 本＝中心線 60・annulus 4）にあり、向きが lap.js の
//      正方向と一致（基準線を添字順にたどると lap.js が 1 周／ゴールと数える・逆順では数えない）・添字順が逆の中心線は反転する・
//      annulus の見分け（投稿コースの写し・中心線を落とした track の写し・壁を足した／頂点を動かした／刻みが等しくない／輪が開いた
//      annulus・格子に手で描ける 8 方位の輪は当たらない・annulus の JSON 往復の写し・逆回り・左右反転は同じ扱いになる）・
//      鋭い角（トライアングル）の近くで向きが飛ばない・向きの決め方の部品（頂点では両側の区間・符号の一致・内積の下限）・
//      折れ角が 150° を超える頂点のある基準線と長さ 0 の区間のある基準線には場を作らない・峠の両端はつながない。
//   B) 部品の単体（長い直線の治具）: 5 車長で直す・働かない条件（自動復帰 OFF・走行していない・発走待ち・進行方向の分からないコース）・
//      向きが進行方向のままの後退／向きが逆でも進行方向へ動く間は積まない（0 より下へも積まない＝後の逆走の貯金にしない）・
//      向きが戻れば 0・距離は進行方向への射影で測る・「向きが逆」の境目・寸法の倍率・切り返し中は待つ・諦め中の車も直す・
//      候補 A → B の選び方（他車・壁）・どちらも通らなければ見送って次に試す・走路の外では直さない（中心線・annulus）・同じ tick に
//      2 台・フィニッシュ線を順方向に越える置き直しはしない・逆方向に越えた分は借りになり位置の巻き数と合う・鋭い角の手前で
//      正しく走っている車を直さない・car.reset で消える・公式レースのペナルティ（毎回 3 秒・レポート）・試走の分は数えない。
//   C) 代表セル: モダン・レイアウト（動力学 6 台）・四角の中の丸（annulus・動力学 6 台）・ツイスティ・レイアウト（精密 v2 1 台）の
//      公式レース（ペナルティ復帰）とライブで、後退量・完走・②③。対象外＝投稿コースの写し・リタイア規則・自動復帰 OFF・
//      中心線の無い治具は、改修前の木で取った毎 tick 全状態の指紋と一致。
//   D) 縮小母集団（出荷の 3 本おき × 3 エンジン × 6 台・ペナルティ復帰）: 完走の合計と、後退量の大きい車の数。
//   F) 構造: 新しい名前を名前付き import していない（BA1）・race_engine のペナルティの数え方・試走にも自動復帰の設定を渡す。
//   G) 変異: fleet.js／race_engine.js／lap.js／physics*.js の部品を 1 つずつ壊した写しで A)／B)／C)／F) のどれかが赤になること。
//
// 使い方: node wf_bh5_marshal.mjs              … 検査
//         node wf_bh5_marshal.mjs --root <dir>  … <dir>/public/js の product で C)・D) だけ（改修前の木で赤になることの確認用）
// exit: 0=全緑 / 1=いずれか赤。
// ════════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { loadMods, liveSetup, liveFrame, fleetEdgesOf } from './wf_bg_live.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rootIdx = process.argv.indexOf('--root');
const ROOT = rootIdx >= 0 ? path.resolve(process.argv[rootIdx + 1]) : HERE;
const PRODUCT_ONLY = rootIdx >= 0;
const JS_DIR = path.join(ROOT, 'public/js');
const T0 = Date.now();

let fail = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? '○' : '✗'} ${msg}`); if (!cond) fail++; return cond; };
const report = (label, v) => ok(v.length === 0, `${label}${v.length ? `: ${v.length} 件 — ${v.slice(0, 4).join(' ／ ')}${v.length > 4 ? ` … ほか ${v.length - 4} 件` : ''}` : ''}`);

async function loadTree(jsDir) {
  const u = (f) => pathToFileURL(path.join(jsDir, f)).href;
  const M = await loadMods(jsDir);
  [M.lap, M.geom, M.i18n] = await Promise.all(['lap.js', 'geom.js', 'i18n.js'].map((f) => import(u(f))));
  return M;
}
const SPECS = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/courses.json'), 'utf8'));
const FIG8 = JSON.parse(fs.readFileSync(path.join(HERE, 'wf_bg2_fig8_course.json'), 'utf8'));   // 上流の投稿コースの写し（BG2）
const specOf = (name) => { const s = SPECS.find((x) => x.name === name); if (!s) throw new Error('出荷コースに無い: ' + name); return s; };
const fig8Of = (M) => { const r = M.course.acceptCourseData(JSON.parse(JSON.stringify(FIG8)), { own: false }); if (!r.ok) throw new Error('投稿コースの写しが取り込めない: ' + r.why); return r.course; };
const MODES = ['dynamic', 'standard', 'v2'];
const rect = (x1, y1, x2, y2) => [{ x1, y1, x2, y2: y1 }, { x1: x2, y1, x2, y2 }, { x1: x2, y1: y2, x2: x1, y2 }, { x1, y1: y2, x2: x1, y2: y1 }];
const DUMMY = 'void setup(){} void loop(){}';

// ── 測定①: コースに沿った進み（位置だけ・product の向き直しの部品を呼ばない）──────────────────
//   基準線 = 中心線（あれば）。無ければ annulus とみなし、壁の前半（外周）と後半（内周）の対の中点列（＝この測定のための幾何で、
//   product の annulusMidline は呼ばない）。進み = 最近点の弧長の積算（周回は 1 周の長さで巻き戻しを解く）。
//   1 回の観測で弧長が 0.1 m ＋ 3 m/s × dt より大きく変わった分は積まない: 車が動ける距離（卓上の最高速 1.4 m/s）より大きい変化は、
//   最近点が別の区間へ飛んだもの（ヘアピンの中心の近くでは全部の区間が等距離。精密 v2 は内側の壁を抜けてそこへ入ることがある＝
//   改修前からの未決）か、置き直しそのもの。後退量は「車が自分で戻った距離」を測る。
function progressObserver(course) {
  let line = course.centerline;
  if (!Array.isArray(line) || line.length < 2) { const w = course.walls, n = w.length / 2; line = Array.from({ length: n }, (_, i) => [(w[i].x1 + w[n + i].x1) / 2, (w[i].y1 + w[n + i].y1) / 2]); }
  const closed = !course.touge, n = line.length, nSeg = closed ? n : n - 1;
  const cum = [0]; for (let i = 0; i < nSeg; i++) { const a = line[i], b = line[(i + 1) % n]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const total = cum[nSeg];
  const arc = (x, y) => { let best = Infinity, s = 0; for (let i = 0; i < nSeg; i++) { const a = line[i], b = line[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; let t = l2 < 1e-12 ? 0 : ((x - a[0]) * dx + (y - a[1]) * dy) / l2; t = t < 0 ? 0 : (t > 1 ? 1 : t); const d = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); if (d < best) { best = d; s = cum[i] + t * Math.sqrt(l2); } } return s; };
  const cars = [];
  const probe = (tick, slots, dt = 1 / 60) => slots.forEach((s, i) => {
    const a = arc(s.car.x, s.car.y);
    let o = cars[i];
    if (!o) { cars[i] = o = { a, p: 0, peak: 0, back: 0 }; return; }
    let d = a - o.a; if (closed) { if (d > total / 2) d -= total; else if (d < -total / 2) d += total; }
    o.a = a; if (Math.abs(d) > 0.1 + 3 * dt) return;
    o.p += d; if (o.p > o.peak) o.peak = o.p; if (o.peak - o.p > o.back) o.back = o.peak - o.p;
  });
  return { probe, cars, total };
}
// ── 測定③: 線分の通過（wf_bh3_laps の windObserver と同じ測り方）──────────────────────────────
function windObserver(M, course) {
  const f = course.finish, A = { x: f.x1, y: f.y1 }, B = { x: f.x2, y: f.y2 };
  const ex = f.x2 - f.x1, ey = f.y2 - f.y1, len = Math.hypot(ex, ey), mx = (f.x1 + f.x2) / 2, my = (f.y1 + f.y2) / 2;
  let nx = -ey / len, ny = ex / len; if (nx * f.fx + ny * f.fy < 0) { nx = -nx; ny = -ny; }
  const cars = [];
  const probe = (tick, slots) => slots.forEach((s, i) => {
    const c = s.car, d = (c.x - mx) * nx + (c.y - my) * ny;
    let o = cars[i];
    if (!o) { cars[i] = o = { x: c.x, y: c.y, d, w: d < 0 ? -1 : 0, wMax: 0, laps: 0, over: 0, late: 0 }; return; }
    if ((o.d < 0) !== (d < 0) && M.geom.segIntersect({ x: o.x, y: o.y }, { x: c.x, y: c.y }, A, B)) o.w += o.d < 0 ? 1 : -1;
    if (o.w > o.wMax) o.wMax = o.w;
    if (s.lap.laps > o.laps) { o.laps = s.lap.laps; if (o.laps > o.wMax) o.over = Math.max(o.over, o.laps - o.wMax); }
    if (s.running && o.wMax > s.lap.laps) o.late++;
    o.x = c.x; o.y = c.y; o.d = d;
  });
  return { probe, cars };
}
// ── 測定②: 向きを直した瞬間の姿勢 ─────────────────────────────────────────────────────────
//   ログの呼び出し（marshalCheck の最後）で車の回数が増えていたら、その時点の姿勢を検査する。直す前の姿勢は
//   lap.crossesForwardTo の呼び出し（姿勢を書き換える前）で捕まえる。改修前の木では何も起きない（回数が増えない）。
function poseWatch(M, course, slots, st) {
  const tol = 1e-9 * M.config.CAR.length * M.config.CAR.width;
  slots.forEach((s, i) => {
    let seen = s.car._marshal || 0, pre = null;
    if (typeof s.lap.crossesForwardTo === 'function') { const orig = s.lap.crossesForwardTo.bind(s.lap); s.lap.crossesForwardTo = (x, y) => { pre = { x: s.car.x, y: s.car.y, theta: s.car.theta }; return orig(x, y); }; }
    const log0 = s.world.log;
    s.world.log = function (...a) {
      const m = s.car._marshal || 0;
      if (m > seen) {
        seen = m; st.events++;
        const c = s.car, bad = [];
        if (M.physics.checkCollision(c, course.walls)) bad.push('壁と交差');
        const cos = Math.cos(c.theta - M.fleet.dirAt(s._dirF, c.x, c.y));
        if (!(cos > 0.9)) bad.push(`向き cos ${cos.toFixed(2)}`);
        if (Math.hypot(c.u || 0, c.vlat || 0) !== 0 || (c.v || 0) !== 0 || (c.r || 0) !== 0) bad.push('速度が 0 でない');
        if (!pre) bad.push('直す前の姿勢が取れない');
        else {
          const now = c.corners(), sv = [c.x, c.y, c.theta];
          c.x = pre.x; c.y = pre.y; c.theta = pre.theta; const before = c.corners(); c.x = sv[0]; c.y = sv[1]; c.theta = sv[2];
          slots.forEach((o, j) => { if (j === i || M.fleet.isRetired(o)) return; const q = o.car.corners(); if (M.fleet.overlapArea(now, q) > M.fleet.overlapArea(before, q) + tol) bad.push(`C${j} との重なりが増えた`); });
        }
        st.at.push(i);
        if (bad.length) st.bad.push(`C${i}: ${bad.join('・')}`);
        pre = null;
      }
      return log0.apply(this, a);
    };
  });
}
const pyField = (M, n) => { const p = M.programs.PROGRAM_BY_KEY.py_normal_fr; return Array.from({ length: n }, (_, i) => ({ name: 'C' + i, lang: p.lang, src: p.code, carType: p.carType })); };

// 公式レース 1 本を 3 つの測定つきで走らせる。
function raceCell(M, course, { regime = 'tabletop', n, mode, rejoin = true, grid = null, recon = null, maxSec, trace = false, poke = null }) {
  M.config.SENSOR_NOISE.on = false;
  const prog = progressObserver(course), wind = course.touge ? null : windObserver(M, course);
  const st = { events: 0, bad: [], at: [], lapInc: 0 };
  let inst = false; const lapsPrev = [], mainEv = [];
  const spec = { course, regime, laps: 3, field: pyField(M, n), crashRule: { rejoin, penaltySec: 3 }, interact: true, physics: mode, trace, report: true,
    probe: (tick, slots) => {
      if (poke) poke(tick, slots);   // 治具が本番の途中で車の姿勢を作り込む口（B11）。ふだんは null
      if (!inst) { inst = true; poseWatch(M, course, slots, st); slots.forEach((s, i) => { lapsPrev[i] = s.lap.laps; mainEv[i] = { arm: 0, rt: 0, m: s.car._marshal || 0, m0: s.car._marshal || 0 }; }); }
      for (const i of st.at) if (slots[i].lap.laps > lapsPrev[i]) st.lapInc++;
      st.at.length = 0;
      slots.forEach((s, i) => { lapsPrev[i] = s.lap.laps; const e = mainEv[i]; if (s.car.recoverT > e.rt + 1e-9) e.arm++; e.rt = s.car.recoverT; e.m = s.car._marshal || 0; });
      prog.probe(tick, slots); if (wind) wind.probe(tick, slots);
      last = slots;
    } };
  if (grid) spec.grid = grid; if (recon) spec.recon = recon; if (maxSec != null) spec.maxSec = maxSec;
  let last = null;
  const r = M.race.runRace(spec);
  const L = M.config.CAR.length;   // runRace の後は呼び出し側の寸法（卓上・倍率 1）
  return { r, fin: r.finishers.length, back: prog.cars.map((o) => o.back), marshal: last.map((s) => s.car._marshal || 0), st, wind: wind ? wind.cars : [], mainEv };
}
// ライブの ▶ 走行 1 本（wf_bg_live の写し）。recover=false は自動復帰 OFF（写しの liveFrame は ON 固定なので、同じ手順をここで回す）。
function liveCell(M, course, { regime = 'tabletop', n, mode, sec = 120, recover = true }) {
  const Lv = liveSetup(M, { course, regime, n, mode });
  const prog = progressObserver(course), st = { events: 0, bad: [], at: [], lapInc: 0 };
  poseWatch(M, course, Lv.slots, st);
  const parts = []; let lapsPrev = Lv.slots.map((s) => s.lap.laps);
  const { fleet, config } = M;
  while (Lv.t < sec - 1e-9) {
    const sdt = Lv.frames === 1 ? 0.15 : (1 / 60) * 3;
    if (recover) liveFrame(Lv, sdt);
    else {
      const edges = fleetEdgesOf(M, Lv.slots);
      Lv.slots.forEach((s, i) => { if (!s.running) return; s.loopTimer -= sdt; if (s.loopTimer <= 0) { fleet.tickSlot(s, fleet.othersFor(edges, i, true)); s.loopTimer += (1 / config.SIM.loopHz) + (s.world._pendingDelay || 0) / 1000; } });
      fleet.applyStartGate(Lv.slots, true);
      if (config.PHYSICS.mode === 'v2') fleet.integrateFleetV2(Lv.slots, sdt, course.walls, false, true);
      else { const max = Lv.slots.length > 1 ? (1 / config.SIM.loopHz) : sdt; let rem = sdt; while (rem > 1e-6) { const step = Math.min(max, rem); const e = fleetEdgesOf(M, Lv.slots); Lv.slots.forEach((s, i) => fleet.integrateSlot(s, step, fleet.othersFor(e, i, true), course.walls, false)); rem -= step; } }
      Lv.t += sdt; Lv.frames++;
    }
    for (const i of st.at) if (Lv.slots[i].lap.laps > lapsPrev[i]) st.lapInc++;
    st.at.length = 0; lapsPrev = Lv.slots.map((s) => s.lap.laps);
    prog.probe(Lv.frames, Lv.slots, sdt);
    parts.push(M.fnv.fnv1a(Lv.slots.map((s) => `${s.car.x},${s.car.y},${s.car.theta},${s.car.crashed ? 1 : 0},${s.lap.laps}`).join(';')));
  }
  const out = { nUse: Lv.nUse, back: prog.cars.map((o) => o.back), marshal: Lv.slots.map((s) => s.car._marshal || 0), st, hash: M.fnv.fnv1a(parts.join('|')) };
  M.config.setCarScale(1); M.dyn.applyRegime('tabletop');
  return out;
}

// ── A) 進行方向の場 ─────────────────────────────────────────────────────────────────
function checkA(M) {
  const v = [];
  const { fleet, course: CM, lap } = M;
  let nCl = 0, nAnn = 0, nNull = 0;
  const built = SPECS.map((s) => ({ s, c: CM.buildFromSpec(s) }));
  for (const { s, c } of built) {
    const df = fleet.dirFrame(c);
    if (!c.finish) { nNull++; if (df) v.push(`${s.name}: フィニッシュが無いのに進行方向の場がある`); continue; }
    if (!df) { v.push(`${s.name}（${s.kind}）: 進行方向の場が無い`); continue; }
    if (Array.isArray(c.centerline)) nCl++; else nAnn++;
    if (df.rev) v.push(`${s.name}: 基準線の添字順が周回の向きと逆（出荷は全部同じ向きのはず）`);
    // フィニッシュ線の端点を ±1 ulp ずらしても（別の JS エンジンの丸め・track では線の中点が中心線の頂点そのもの＝場の特異点）、
    //   場の有無と向きが変わらない。
    { const f = c.finish, ulp = (x, k) => { const b = new Float64Array([x]), u = new BigInt64Array(b.buffer); u[0] += BigInt(x >= 0 ? k : -k); return b[0]; };
      let bad = 0;
      for (let m = 0; m < 81; m++) { const k = [m % 3 - 1, Math.floor(m / 3) % 3 - 1, Math.floor(m / 9) % 3 - 1, Math.floor(m / 27) % 3 - 1];
        const d2 = fleet.dirFrame({ ...c, finish: { ...f, x1: ulp(f.x1, k[0]), y1: ulp(f.y1, k[1]), x2: ulp(f.x2, k[2]), y2: ulp(f.y2, k[3]) } });
        if (!d2 || d2.rev !== df.rev) bad++; }
      if (bad) v.push(`${s.name}: フィニッシュ線の端点を ±1 ulp ずらした 81 通りのうち ${bad} 通りで場が無くなるか向きが変わる`); }
    // 基準線を進行方向の順にたどると lap.js が数える（周回 = 1 周と 1/10 で 1 以上・峠 = ゴール）。逆順では数えない。
    const pts = df.cl.map((p) => [p[0], p[1]]);
    const walk = (order) => {
      const tr = new lap.LapTracker(c, { persist: false });
      // 周回: フィニッシュ線から 1/4 周先の頂点から始めて 1 周（線をちょうど 1 回通る。線の上から始めると発走の側が丸めで決まる）
      let k0 = 0, best = Infinity; order.forEach((p, k) => { const d = Math.hypot(p[0] - (c.finish.x1 + c.finish.x2) / 2, p[1] - (c.finish.y1 + c.finish.y2) / 2); if (d < best) { best = d; k0 = k; } });
      const q = (k0 + Math.round(order.length / 4)) % order.length;
      const seq = c.touge ? order : [...order.slice(q), ...order.slice(0, q + 1)];
      // 標本は頂点そのものに置かない（フィニッシュ線の中点は中心線の頂点＝線のちょうど上に標本が乗ると、lap.js の側の符号と線分との
      //   交差が最下位ビットで食い違う通過を治具が自分で作る。wf_bh3_laps の driver と同じ理由で半端だけ手前へずらす）。
      let px = seq[0][0], py = seq[0][1], first = true;
      for (const [x, y] of seq) { const m = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / 0.01)); for (let j = 1; j <= m; j++) { tr.update(first ? 0 : 1 / 60, px + (x - px) * (j - 0.38) / m, py + (y - py) * (j - 0.38) / m, true); first = false; } px = x; py = y; }
      return tr.laps;
    };
    const fwd = walk(df.rev ? pts.slice().reverse() : pts), bwd = walk(df.rev ? pts : pts.slice().reverse());
    if (!(fwd >= 1 && bwd === 0)) v.push(`${s.name}: 基準線を進行方向にたどって ${fwd} 周・逆にたどって ${bwd} 周（期待 1 以上・0）`);
    // 進行方向の場 (dirAt) が、いま lap.js で確かめた「たどる向き」と合う（基準線の各区間の中点で。中心線のコースは一致・annulus は
    //   中心のまわりを回る向きなので折れ線の向きと少しずれる）
    { let mn = 1; const sg = df.rev ? -1 : 1, m = c.touge ? pts.length - 1 : pts.length;
      for (let k = 0; k < m; k++) { const a = pts[k], b = pts[(k + 1) % pts.length], th = Math.atan2(sg * (b[1] - a[1]), sg * (b[0] - a[0])); mn = Math.min(mn, Math.cos(fleet.dirAt(df, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2) - th)); }
      if (!(mn > (Array.isArray(c.centerline) ? 1 - 1e-9 : 0.7))) v.push(`${s.name}: 進行方向の場が基準線をたどる向きと合わない（cos の最小 ${mn.toFixed(3)}）`);
      if (!Array.isArray(c.centerline) && mn < (checkA.annMin ?? 1)) checkA.annMin = mn; }
    // 中心線の無いコースに足したものが無い（形の指紋を変えない）・JSON 往復の写しでも同じ場
    if (!Array.isArray(c.centerline)) {
      const copy = CM.acceptCourseData(JSON.parse(JSON.stringify(c)), { own: false });
      const d2 = copy.ok ? fleet.dirFrame(copy.course) : null;
      if (!d2 || d2.n !== df.n || d2.rev !== df.rev || !df.cl.every((p, k) => p[0] === d2.cl[k][0] && p[1] === d2.cl[k][1])) v.push(`${s.name}: JSON 往復の写しで進行方向の場が変わる`);
      if (lap.practiceCourseId(c) !== lap.practiceCourseId(JSON.parse(JSON.stringify(c)))) v.push(`${s.name}: コースオブジェクトに JSON で落ちる状態がある`);
      // 壁を 1 本足す／頂点を 1 つ 1e-6 動かす／外周と内周を入れ替える → annulus と見なさない
      const plus = { ...c, walls: [...c.walls, { x1: 0, y1: 0, x2: 0.01, y2: 0 }] };
      const w2 = c.walls.map((w) => ({ ...w })), nn = w2.length / 2; w2[3].x1 += 1e-6; w2[2].x2 += 1e-6;
      const swap = { ...c, walls: [...c.walls.slice(nn), ...c.walls.slice(0, nn)] };
      if (fleet.dirFrame(plus)) v.push(`${s.name}: 壁を 1 本足しても annulus と見なす`);
      if (fleet.dirFrame({ ...c, walls: w2 })) v.push(`${s.name}: 外周の頂点を 1e-6 m 動かしても annulus と見なす`);
      if (fleet.dirFrame(swap)) v.push(`${s.name}: 内周と外周を入れ替えても annulus と見なす`);
      // 内周の輪の添字を 1 つずらす（輪 2 本・閉じている・内周は外周の内側のまま。対だけが同じ半直線に乗らない）
      const inner = c.walls.slice(nn), shift = { ...c, walls: [...c.walls.slice(0, nn), ...inner.slice(1), inner[0]] };
      if (fleet.dirFrame(shift)) v.push(`${s.name}: 対が同じ半直線に乗らない（内周の添字を 1 つずらした）輪 2 本を annulus と見なす`);
      // 輪の継ぎ目を 1 か所開ける（壁の終点だけを 1 mm ずらす＝頂点の対は元のまま）
      const w3 = c.walls.map((w) => ({ ...w })); w3[5].x2 += 1e-3;
      if (fleet.dirFrame({ ...c, walls: w3 })) v.push(`${s.name}: 輪が閉じていなくても annulus と見なす`);
      // 対 7 だけを中心のまわりに 0.5° 回す（輪は閉じたまま・対は同じ半直線の上のまま・半直線の刻みだけが等しくない）
      { const ctr = df.ring ? [df.ring.cx, df.ring.cy] : null;
        if (!ctr) v.push(`${s.name}: annulus の場に中心が無い`);
        else {
          const w4 = c.walls.map((w) => ({ ...w })), cs = Math.cos(0.5 * Math.PI / 180), sn = Math.sin(0.5 * Math.PI / 180);
          for (const o of [0, nn]) { const p = w4[o + 7], x = p.x1 - ctr[0], y = p.y1 - ctr[1], nx = ctr[0] + x * cs - y * sn, ny = ctr[1] + x * sn + y * cs; p.x1 = nx; p.y1 = ny; w4[o + 6].x2 = nx; w4[o + 6].y2 = ny; }
          if (fleet.dirFrame({ ...c, walls: w4 })) v.push(`${s.name}: 半直線の刻みが等しくない輪 2 本を annulus と見なす`);
        } }
      // 逆回りの周回（スタートの向きと正方向を反転）: 場も反転する。左右を反転した形（添字順が時計回り）でも周回の向きを返す。
      { const f = c.finish, st = c.start;
        const back = fleet.dirFrame({ ...c, start: { ...st, theta: st.theta + Math.PI }, finish: { ...f, fx: -f.fx, fy: -f.fy } });
        if (!back || !(Math.cos(fleet.dirAt(back, st.x, st.y) - (st.theta + Math.PI)) > 0.99)) v.push(`${s.name}: 逆回りにした annulus で進行方向の場が反転しない`);
        const W = c.bounds.w, mir = { ...c, walls: c.walls.map((w) => ({ x1: W - w.x1, y1: w.y1, x2: W - w.x2, y2: w.y2 })), start: { ...st, x: W - st.x, theta: Math.PI - st.theta }, finish: { ...f, x1: W - f.x1, x2: W - f.x2, fx: -f.fx } };
        const dm = fleet.dirFrame(mir);
        if (!dm || !(Math.cos(fleet.dirAt(dm, mir.start.x, mir.start.y) - mir.start.theta) > 0.99)) v.push(`${s.name}: 左右を反転した annulus で進行方向の場がスタートの向きと合わない`); }
    } else {
      // 中心線を落とした写し（エディタで開いて適用したコース＝輪 2 本だが対が 1 点に集まらない）は対象外
      const { centerline, ...rest } = c;
      if (!c.touge && fleet.dirFrame(rest)) v.push(`${s.name}: 中心線を落とした写しに進行方向の場がある`);
      // 添字順を逆にした中心線: 反転して同じ向きを返す
      const rv = fleet.dirFrame({ ...c, centerline: c.centerline.slice().reverse() });
      if (!c.touge) {
        const q = [c.start.x, c.start.y];
        if (!rv || !rv.rev || !(Math.cos(fleet.dirAt(rv, q[0], q[1]) - fleet.dirAt(df, q[0], q[1])) > 1 - 1e-9)) v.push(`${s.name}: 添字順を逆にした中心線で向きが反転しない`);
      }
    }
  }
  if (nCl !== 60 || nAnn !== 4 || nNull !== 2) v.push(`進行方向の場: 中心線 ${nCl}・annulus ${nAnn}・なし ${nNull}（期待 60・4・2）`);
  if (fleet.dirFrame(fig8Of(M))) v.push('投稿コースの写し（輪 2 本・480 対）に進行方向の場がある');
  // コースエディタの格子の上に手で描ける輪（8 方位・角と辺の中点を結んだ四角い輪 2 本／半径ばらばらの 8 方位の輪 2 本）は annulus と見なさない
  { const sq = (h) => [[h, 0], [h, h], [0, h], [-h, h], [-h, 0], [-h, -h], [0, -h], [h, -h]].map(([x, y]) => [2 + x, 2 + y]);
    const ringOf = (pts) => pts.map((p, i) => ({ x1: p[0], y1: p[1], x2: pts[(i + 1) % pts.length][0], y2: pts[(i + 1) % pts.length][1] }));
    const hand = (outer, inner) => ({ name: '治具・手描きの輪', walls: [...ringOf(outer), ...ringOf(inner)], bounds: { w: 4, h: 4 }, start: { x: 3.375, y: 2, theta: Math.PI / 2 }, finish: { x1: 3.75, y1: 2, x2: 3, y2: 2, fx: 0, fy: 1 } });
    if (fleet.dirFrame(hand(sq(1.75), sq(1.0)))) v.push('格子に手で描ける四角い輪 2 本（8 方位）を annulus と見なす');
    const r8 = (rs) => rs.map((r, i) => { const d = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]][i]; return [2 + d[0] * r, 2 + d[1] * r]; });
    if (fleet.dirFrame(hand(r8([1.75, 1.5, 1.6, 1.25, 1.75, 1.4, 1.5, 1.3]), r8([1.0, 0.75, 0.9, 0.6, 1.0, 0.7, 0.8, 0.65])))) v.push('半径ばらばらの 8 方位の輪 2 本を annulus と見なす'); }
  // 基準線の区間の数: 周回は頂点の数（閉じる）・峠は頂点の数 − 1（末尾と先頭をつながない）
  for (const { s, c } of built) { const df = fleet.dirFrame(c); if (df && df.nSeg !== (c.touge ? df.n - 1 : df.n)) v.push(`${s.name}: 基準線の区間の数 ${df.nSeg}（頂点 ${df.n}・${c.touge ? '峠' : '周回'}）`); }
  // 頂点の近くの向き（出荷「トライアングル」＝折れ角 120°）: 2 つの区間から等距離の線（内側）をまたいでも向きが飛ばない・
  //   頂点の手前で次の区間の向きを向いた車（正しく走っている車）は「向きが逆」にならない・頂点から離れれば区間の向きそのまま。
  { const c = built.find((x) => x.s.name === 'トライアングル').c, df = fleet.dirFrame(c), cl = c.centerline;
    const wr = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    let jump = 0, lead = -1, far = 0;
    for (let k = 0; k < 3; k++) {
      const V = cl[k], A = cl[(k + 2) % 3], B = cl[(k + 1) % 3];   // 頂点 V・手前の頂点 A・次の頂点 B
      const u0 = [(V[0] - A[0]), (V[1] - A[1])], l0 = Math.hypot(u0[0], u0[1]); u0[0] /= l0; u0[1] /= l0;
      const u1 = [(B[0] - V[0]), (B[1] - V[1])], l1 = Math.hypot(u1[0], u1[1]); u1[0] /= l1; u1[1] /= l1;
      const inward = (u0[0] * u1[1] - u0[1] * u1[0]) > 0 ? [-u0[1], u0[0]] : [u0[1], -u0[0]];   // 手前の区間から見た内側
      const T = Math.abs(wr(Math.atan2(u1[1], u1[0]) - Math.atan2(u0[1], u0[0])));
      for (const d of [0.05, 0.1, 0.15]) {
        const a = d * Math.tan(T / 2);   // 等距離の線までの距離（手前の区間に沿って）
        const P = (aa) => [V[0] - u0[0] * aa + inward[0] * d, V[1] - u0[1] * aa + inward[1] * d];
        const p1 = P(a + 0.002), p2 = P(a - 0.002);
        jump = Math.max(jump, Math.abs(wr(fleet.dirAt(df, p1[0], p1[1]) - fleet.dirAt(df, p2[0], p2[1]))));
        // 次の区間の向き th1 を向いた車: 等距離の線の 1.5 倍手前までは cos ≥ 0（向きが逆と見ない）
        const th1 = Math.atan2(u1[1], u1[0]), q = P(1.5 * a);
        lead = Math.max(lead, -Math.cos(th1 - fleet.dirAt(df, q[0], q[1])));
        const r = P(3.5 * a);
        far = Math.max(far, Math.abs(wr(fleet.dirAt(df, r[0], r[1]) - Math.atan2(u0[1], u0[0]))));
      }
    }
    if (!(jump < 5 * Math.PI / 180)) v.push(`トライアングル: 2 つの区間から等距離の線をまたぐと向きが ${(jump * 180 / Math.PI).toFixed(1)}° 飛ぶ`);
    if (!(lead < 0)) v.push(`トライアングル: 頂点の手前で次の区間の向きを向いた車が「向きが逆」に見える（−cos の最大 ${lead.toFixed(2)}）`);
    if (!(far < 4 * Math.PI / 180)) v.push(`トライアングル: 頂点から離れた所で向きが区間の向きから ${(far * 180 / Math.PI).toFixed(1)}° ずれる`); }
  // 向きを決められないコースは null: 正方向がフィニッシュ線と平行／フィニッシュ線が基準線とほぼ平行／長さ 0 の区間（頂点の重複）がある中心線
  { const c = built.find((x) => x.s.name === 'オーバル').c; const f = c.finish, cl = c.centerline;
    if (fleet.dirFrame({ ...c, finish: { ...f, fx: -f.fy, fy: f.fx } })) v.push('正方向がフィニッシュ線と平行なコースに進行方向の場がある');
    const mx = (f.x1 + f.x2) / 2, my = (f.y1 + f.y2) / 2, hl = Math.hypot(f.x2 - f.x1, f.y2 - f.y1) / 2, tx = cl[1][0] - cl[0][0], ty = cl[1][1] - cl[0][1], tl = Math.hypot(tx, ty);
    const along = { ...f, x1: mx - hl * tx / tl + 0.02 * ty / tl, y1: my - hl * ty / tl - 0.02 * tx / tl, x2: mx + hl * tx / tl, y2: my + hl * ty / tl };   // 基準線にほぼ沿った（約 5° 傾けた）線
    if (fleet.dirFrame({ ...c, finish: along })) v.push('フィニッシュ線が基準線とほぼ平行なコースに進行方向の場がある');
    if (fleet.dirFrame({ ...c, centerline: [...cl.slice(0, 10), [cl[9][0], cl[9][1]], ...cl.slice(10)] })) v.push('長さ 0 の区間がある中心線に進行方向の場がある'); }
  // 向きの決め方の部品（治具・1 辺 4 m の正三角形の中心線。区間 0 は (1,1)→(5,1)＝向き 0°・区間 1 は向き 120°）:
  //   フィニッシュ線の法線（正方向の側）と、線の中点に最も近い区間（最近点が頂点なら両側の区間）の向きの内積で決める。
  { const tri = (finish) => ({ name: '治具・三角', walls: rect(0, 0, 6, 5.5), bounds: { w: 6, h: 5.5 }, start: { x: 2, y: 1, theta: 0 }, finish, centerline: [[1, 1], [5, 1], [3, 1 + 2 * Math.sqrt(3)]] });
    const fin = (mx, my, nAng, fAng = nAng, hl = 0.3) => ({ x1: mx + hl * Math.sin(nAng), y1: my - hl * Math.cos(nAng), x2: mx - hl * Math.sin(nAng), y2: my + hl * Math.cos(nAng), fx: Math.cos(fAng), fy: Math.sin(fAng) });   // 中点 (mx,my)・法線の向き nAng・正方向 fAng
    const D = Math.PI / 180;
    // (a) 頂点 (5,1) を通り手前の区間に直交する線（法線 0°）: 手前の区間との内積 1・次の区間との内積 −0.5＝符号が不ぞろい → 決められない
    if (fleet.dirFrame(tri(fin(5, 1, 0)))) v.push('頂点を通り片側の区間に直交するフィニッシュ線（両側の区間で符号が不ぞろい）のコースに進行方向の場がある');
    // (b) 同じ頂点を通る二等分の線（法線 60°）: 両側とも内積 0.5 → 場あり・順向き。正方向が反対側（240°）なら逆向き
    { const d1 = fleet.dirFrame(tri(fin(5, 1, 60 * D))), d2 = fleet.dirFrame(tri(fin(5, 1, 60 * D, 240 * D)));
      if (!d1 || d1.rev) v.push('頂点を通る二等分のフィニッシュ線のコースに進行方向の場が無い（または逆向き）');
      if (!d2 || !d2.rev) v.push('頂点を通る二等分のフィニッシュ線で正方向が逆のコースの場が反転しない'); }
    // (c) 区間 0 の中ほど (3,1) を通る線: 法線と区間の向きの内積が 0.4 なら場あり・0.2 なら決められない（線が基準線に沿いすぎ）
    { const d04 = fleet.dirFrame(tri(fin(3, 1, Math.acos(0.4)))), d02 = fleet.dirFrame(tri(fin(3, 1, Math.acos(0.2))));
      if (!d04 || d04.rev) v.push('フィニッシュ線の法線と区間の向きの内積が 0.4 のコースに進行方向の場が無い（または逆向き）');
      if (d02) v.push('フィニッシュ線の法線と区間の向きの内積が 0.2 のコースに進行方向の場がある（下限 0.3）'); }
    // (d) 折れ角が 150° を超える頂点（ほぼ折り返し）のある基準線には場を作らない（tan が発散して、つなぐ範囲が区間の全長に広がる）。
    //     140° なら場あり・160° なら無し。開いた基準線（峠の形）で確かめる。
    { const foldOf = (deg) => ({ name: '治具・折り返し', touge: true, walls: rect(-1, -1, 6, 3), bounds: { w: 7, h: 4 }, start: { x: 0.5, y: 0, theta: 0 }, finish: { x1: 2, y1: -0.3, x2: 2, y2: 0.3, fx: 1, fy: 0 }, centerline: [[0, 0], [4, 0], [4 + 4 * Math.cos(deg * D), 4 * Math.sin(deg * D)]] });
      const d140 = fleet.dirFrame(foldOf(140)), d160 = fleet.dirFrame(foldOf(160));
      if (!d140 || d140.rev) v.push('140° 折り返す頂点のある基準線に進行方向の場が無い（または逆向き）');
      if (d160) v.push('160° 折り返す頂点のある基準線に進行方向の場がある（上限 150°）');
      // (e) 開いた基準線（峠）の両端は折れ角 0＝末尾と先頭をつながない: 始点のそば・終点のそばの向きは、その区間の向きそのまま（90° 曲がる治具）
      const dfF = fleet.dirFrame(foldOf(90)), gs = dfF ? fleet.dirAt(dfF, 0.2, -0.1) : NaN, ge = dfF ? fleet.dirAt(dfF, 4.1, 3.8) : NaN;
      if (!(Math.abs(gs) < 1e-9 && Math.abs(ge - Math.PI / 2) < 1e-9)) v.push(`開いた基準線の両端の向き: 始点のそば ${(gs / D).toFixed(1)}°（区間の向き 0°）・終点のそば ${(ge / D).toFixed(1)}°（区間の向き 90°）`); } }
  // start を明示しない三角形（courses.json の samples:3 と同じ作り）: 正方向は頂点の二等分の向き・場あり
  { const c = CM.buildFromSpec({ name: '治具・三角', kind: 'track', shape: 'ellipse', rx: 1.3, ry: 1.3, width: 0.6, samples: 3 }), d3 = fleet.dirFrame(c);
    if (!d3 || d3.rev) v.push('start を明示しない三角形の track に進行方向の場が無い（または逆向き）'); }
  checkA.info = `中心線 ${nCl} 本・annulus ${nAnn} 本・なし ${nNull} 本／annulus の場と中点列の向きの cos の最小 ${(checkA.annMin ?? NaN).toFixed(3)}`;
  return v;
}

// ── B) 部品の単体 ───────────────────────────────────────────────────────────────────
function checkB(M, { races = true } = {}) {
  const v = [];
  const t = (cond, msg) => { if (!cond) v.push(msg); };
  const { fleet, physics, config, course: CM, dyn, i18n } = M;
  const C = config.CONST;
  config.SENSOR_NOISE.on = false; dyn.applyRegime('tabletop'); config.setCarScale(1);
  const L = config.CAR.length, off = (L - config.CAR.rearToBack) - L / 2, h = 1 / config.SIM.physicsHz;
  // 治具: 長い直線 2 本の track（中心線あり・道幅 1.2 m）。上の直線（進行方向 d）を使う。P(s,l) = 直線に沿って s・左へ l。
  const jig = CM.buildFromSpec({ name: '治具', kind: 'track', shape: 'stadium', L: 4, rr: 1, width: 1.2 });
  const cl = jig.centerline, A0 = cl[20], B0 = cl[21];
  const dl = Math.hypot(B0[0] - A0[0], B0[1] - A0[1]), d = [(B0[0] - A0[0]) / dl, (B0[1] - A0[1]) / dl], nl = [-d[1], d[0]], phi0 = Math.atan2(d[1], d[0]);
  if (!(Math.abs(dl - 4) < 1e-9)) { v.push(`治具の前提: 上の直線の長さ ${dl}`); return v; }
  const P = (s, l = 0) => [A0[0] + s * d[0] + l * nl[0], A0[1] + s * d[1] + l * nl[1]];
  const poseC = (s, l, rel) => { const th = phi0 + rel, [cx, cy] = P(s, l); return { x: cx - off * Math.cos(th), y: cy - off * Math.sin(th), theta: th }; };   // 車体の中心を (s,l) に置く
  const centerOf = (c) => [c.x + off * Math.cos(c.theta), c.y + off * Math.sin(c.theta)];
  const sOf = (x, y) => (x - A0[0]) * d[0] + (y - A0[1]) * d[1], lOf = (x, y) => (x - A0[0]) * nl[0] + (y - A0[1]) * nl[1];
  const mk = (course, pose, logs) => { const s = fleet.makeSlot({ i: 0, lang: 'c', src: DUMMY, course, slotCount: 1, logFor: () => (m) => { if (logs) logs.push(m); }, persist: false }); s.car.reset(pose); s.running = true; s.spawn = pose; return s; };
  const drive = (s, dir, pwm = 200) => { s.car.driveDir = dir; s.car.pwm = pwm; s.car.steer = C.CENTER; };
  const edgesOf = (ss) => ss.flatMap((s) => physics.carEdges(s.car));
  const ov = (a, b) => fleet.overlapArea(a.car.corners(), b.car.corners());
  for (const mode of ['standard', 'dynamic', 'v2']) {
    config.setPhysicsMode(mode);
    const step = (s, others, walls, recover, dt = h) => { if (mode === 'v2') fleet.integrateFleetV2([s, ...others], dt, walls, recover, true); else fleet.integrateSlot(s, dt, edgesOf(others), walls, recover); };
    // B1: 逆向きの車が前進（＝進行方向と逆へ）→ 5 車長で向きを直す
    for (const dt of [h, 0.05]) {
      const logs = [], s = mk(jig, poseC(3.4, 0, Math.PI), logs), c = s.car;
      const s0 = sOf(c.x, c.y); let at = null, sPrev = s0, vmax = 0, sBefore = null;
      for (let k = 1; k <= 900 && at == null; k++) { drive(s, C.FORWARD); const sb = sOf(c.x, c.y); step(s, [], jig.walls, true, dt); vmax = Math.max(vmax, Math.abs(sb - sPrev)); sPrev = sb; if (c._marshal) { at = k; sBefore = sb; } }
      const back = s0 - sBefore, tag = `B1 ${mode} 刻み ${dt === h ? '1/60' : '0.05'} 秒`;
      t(at != null && back <= 5 * L + 1e-9 && back + 2 * vmax >= 5 * L, `${tag}: 逆へ 5 車長で向きを直す（直した呼び出しの前までに ${(back / L).toFixed(3)} 車長・1 回の移動 ${(vmax / L).toFixed(3)} 車長）`);
      t(Math.cos(c.theta - phi0) > 1 - 1e-12 && Math.hypot(c.u || 0, c.vlat || 0) === 0 && c.v === 0 && c._wrongB === 0 && c._marshal === 1, `${tag}: 直した後は向き＝進行方向・速度 0・距離 0・回数 1`);
      t(logs.length === 1 && logs[0] === i18n.t('sim.marshal') && /逆走/.test(logs[0]) && !physics.checkCollision(c, jig.walls), `${tag}: ログ 1 行（${logs[0]}）・壁と交差しない`);
      for (let k = 0; k < 400; k++) { drive(s, C.FORWARD); step(s, [], jig.walls, true, dt); }
      t(c._marshal === 1 && sOf(c.x, c.y) > sBefore + L, `${tag}: その後は進行方向へ走り、向き直しは増えない（回数 ${c._marshal}）`);
    }
    // B1-2: 直した直後にまた逆を向いて走れば、そこから 5 車長でまた直す（直した後に距離を積まない時間を作らない）
    {
      const s = mk(jig, poseC(3.4, 0, Math.PI)), c = s.car;
      drive(s, C.FREE, 0); step(s, [], jig.walls, true); c._wrongB = 5 * L; step(s, [], jig.walls, true);   // 1 回目（その場で直る）
      const m1 = c._marshal; c.theta += Math.PI; c.halt();
      const s0 = sOf(c.x, c.y); let sPrev = s0, vmax = 0, sBefore = null;
      for (let k = 1; k <= 900 && sBefore == null; k++) { drive(s, C.FORWARD); const sb = sOf(c.x, c.y); step(s, [], jig.walls, true); vmax = Math.max(vmax, Math.abs(sb - sPrev)); sPrev = sb; if (c._marshal > m1) sBefore = sb; }
      const back = s0 - sBefore;
      t(m1 === 1 && sBefore != null && back <= 5 * L + 1e-9 && back + 2 * vmax >= 5 * L, `B1-2 ${mode} 直した直後にまた逆走: そこから 5 車長でまた直す（1 回目 ${m1}・${sBefore == null ? '2 回目は直さない' : '逆へ ' + (back / L).toFixed(3) + ' 車長'}）`);
    }
    // B1': しきい値は車長に比例する（車体 0.5×・2×）。治具のコースは同じ（道幅 1.2 m）。
    for (const k of [0.5, 2]) {
      config.setCarScale(k);
      try {
        const Lk = config.CAR.length, offk = (Lk - config.CAR.rearToBack) - Lk / 2, th = phi0 + Math.PI, [cx, cy] = P(3.4, 0);
        const s = mk(jig, { x: cx - offk * Math.cos(th), y: cy - offk * Math.sin(th), theta: th }), c = s.car;
        const s0 = sOf(c.x, c.y); let at = null, sPrev = s0, vmax = 0, sBefore = null;
        for (let n = 1; n <= 1500 && at == null; n++) { drive(s, C.FORWARD); const sb = sOf(c.x, c.y); step(s, [], jig.walls, true); vmax = Math.max(vmax, Math.abs(sb - sPrev)); sPrev = sb; if (c._marshal) { at = n; sBefore = sb; } }
        const back = s0 - sBefore;
        t(Math.abs(Lk - 0.19 * k) < 1e-12 && at != null && back <= 5 * Lk + 1e-9 && back + 2 * vmax >= 5 * Lk, `B1' ${mode} 車体 ${k}×（車長 ${Lk.toFixed(3)} m）: 逆へ 5 車長で直す（${at == null ? '直さない' : (back / Lk).toFixed(3) + ' 車長'}）`);
      } finally { config.setCarScale(1); }
    }
    // B1'': 逆へ進んだ距離は「その位置の進行方向への射影」で測る（車体の向きへの射影でも、道のりでもない）。進行方向から 150° を向いて
    //   まっすぐ進む車は、進行方向と逆へ 5 車長（道のりでは 5.77 車長）進んだ所で直す。
    {
      const s = mk(jig, poseC(3.4, -0.3, 150 * Math.PI / 180)), c = s.car;
      const s0 = sOf(c.x, c.y); let at = null, sPrev = s0, vmax = 0, sBefore = null, path = 0, pathBefore = 0;
      for (let k = 1; k <= 1500 && at == null; k++) {
        drive(s, C.FORWARD); const sb = sOf(c.x, c.y), xb = c.x, yb = c.y; step(s, [], jig.walls, true);
        vmax = Math.max(vmax, Math.abs(sb - sPrev)); sPrev = sb;
        if (c._marshal) { at = k; sBefore = sb; pathBefore = path; } else path += Math.hypot(c.x - xb, c.y - yb);
      }
      const back = s0 - sBefore;
      t(at != null && back <= 5 * L + 1e-9 && back + 2 * vmax >= 5 * L && pathBefore > 5.5 * L, `B1'' ${mode} 進行方向から 150° を向いて直進: 進行方向と逆へ 5 車長で直す（${at == null ? '直さない' : `逆へ ${(back / L).toFixed(3)} 車長・道のり ${(pathBefore / L).toFixed(3)} 車長`}）`);
    }
    // B2: 働かない条件
    for (const [label, prep, rec] of [['自動復帰 OFF', () => {}, false], ['走行していない車', (s) => { s.running = false; }, true], ['発走待ち (held)', (s) => { s.car.held = true; }, true]]) {
      const s = mk(jig, poseC(3.4, 0, Math.PI)); prep(s);
      const s0 = sOf(s.car.x, s.car.y);
      for (let k = 0; k < 600; k++) { drive(s, C.FORWARD); if (label.startsWith('発走')) s.car.held = true; step(s, [], jig.walls, rec); }
      t(!s.car._marshal && (label.startsWith('発走') ? s.car.x === poseC(3.4, 0, Math.PI).x : (s0 - sOf(s.car.x, s.car.y) > 5.5 * L || s.car.crashed)), `B2 ${mode} ${label}: 向きを直さない（回数 ${s.car._marshal}・逆へ ${((s0 - sOf(s.car.x, s.car.y)) / L).toFixed(1)} 車長）`);
    }
    // 距離がすでに 5 車長ある車でも、条件を満たさなければ直さず、距離を 0 に戻す（発走待ち・クラッシュした車は動かないので、こちらで見る）
    for (const [label, prep, rec] of [['自動復帰 OFF', () => {}, false], ['走行していない車', (s) => { s.running = false; }, true], ['発走待ち (held)', (s) => { s.car.held = true; }, true], ['クラッシュした車', (s) => { s.car.crashed = true; }, true]]) {
      const s = mk(jig, poseC(2.0, 0, Math.PI)); prep(s);
      s.car._wrongB = 5 * L; drive(s, C.FREE, 0); step(s, [], jig.walls, rec);
      t(!s.car._marshal && s.car._wrongB === 0 && Math.cos(s.car.theta - phi0) < 0, `B2 ${mode} ${label}（距離 5 車長を持つ車）: 向きを直さず、距離を 0 に戻す（回数 ${s.car._marshal}・距離 ${s.car._wrongB}）`);
    }
    {
      const raw = { name: '治具・中心線なし', walls: jig.walls, bounds: jig.bounds, start: jig.start, finish: jig.finish };
      const s = mk(raw, poseC(3.4, 0, Math.PI));
      for (let k = 0; k < 600; k++) { drive(s, C.FORWARD); step(s, [], raw.walls, true); }
      t(s._dirF === null && !s.car._marshal, `B2 ${mode} 進行方向の分からないコース: 向きを直さない`);
      // rebuildSpawns もコースの切り替えで場を更新する（中心線ありのコースへ → 場あり・無しへ → null）
      fleet.rebuildSpawns([s], jig, null, { persist: false }); const has = !!s._dirF;
      fleet.rebuildSpawns([s], raw, null, { persist: false });
      t(has && s._dirF === null, `B2 ${mode} rebuildSpawns がコースの進行方向の場を更新する`);
    }
    // B3: 向きが進行方向のままの後退（切り返しの後退と同じ形）／B4: 向きは逆だが進行方向へ動く — どちらも積まない
    {
      const s = mk(jig, poseC(3.4, 0, 0)); const s0 = sOf(s.car.x, s.car.y);
      for (let k = 0; k < 500; k++) { drive(s, C.REVERSE); step(s, [], jig.walls, true); }
      t(!s.car._marshal && s0 - sOf(s.car.x, s.car.y) > 6 * L && s.car._wrongB === 0, `B3 ${mode} 向きは進行方向のまま ${((s0 - sOf(s.car.x, s.car.y)) / L).toFixed(1)} 車長後退: 向きを直さない`);
      const s2 = mk(jig, poseC(0.6, 0, Math.PI)); const s1 = sOf(s2.car.x, s2.car.y);
      let bLo = Infinity, bHi = -Infinity;
      for (let k = 0; k < 1500 && sOf(s2.car.x, s2.car.y) - s1 < 6.5 * L; k++) { drive(s2, C.REVERSE); step(s2, [], jig.walls, true); bLo = Math.min(bLo, s2.car._wrongB); bHi = Math.max(bHi, s2.car._wrongB); }
      t(!s2.car._marshal && sOf(s2.car.x, s2.car.y) - s1 >= 6.5 * L && bLo === 0 && bHi === 0, `B4 ${mode} 向きは逆のまま進行方向へ ${((sOf(s2.car.x, s2.car.y) - s1) / L).toFixed(1)} 車長: 向きを直さず、距離は 0 のまま（0 より下へ積まない・最小 ${bLo}・最大 ${bHi}）`);
      // B4': その後に前進（＝逆走）へ転じたら、折り返した所から 5 車長で直す（進行方向へ動いた 6.5 車長を「貯金」にしない）
      let sTop = sOf(s2.car.x, s2.car.y), sPrev2 = sTop, vmax2 = 0, sBefore2 = null;
      for (let k = 0; k < 1500 && sBefore2 == null; k++) {
        drive(s2, C.FORWARD); const sb = sOf(s2.car.x, s2.car.y); step(s2, [], jig.walls, true);
        vmax2 = Math.max(vmax2, Math.abs(sb - sPrev2)); sPrev2 = sb;
        if (s2.car._marshal) sBefore2 = sb; else sTop = Math.max(sTop, sb, sOf(s2.car.x, s2.car.y));
      }
      const back2 = sTop - sBefore2;
      t(sBefore2 != null && back2 <= 5 * L + 1e-6 && back2 + 2 * vmax2 >= 5 * L, `B4' ${mode} 進行方向へ 6.5 車長動いた後に逆走へ転じる: 折り返した所から 5 車長で直す（${sBefore2 == null ? '直さない' : (back2 / L).toFixed(3) + ' 車長'}）`);
    }
    // B4'': 積んだ距離は、向きが逆のまま進行方向へ動けばその分だけ減る（正味。逆へ動いた分だけを積む「道のり」ではない）
    {
      const s = mk(jig, poseC(1.0, 0, Math.PI)); drive(s, C.FREE, 0); step(s, [], jig.walls, true);
      s.car._wrongB = 3 * L; const sA = sOf(s.car.x, s.car.y);
      for (let k = 0; k < 1500 && sOf(s.car.x, s.car.y) - sA < L; k++) { drive(s, C.REVERSE); step(s, [], jig.walls, true); }
      const mv = sOf(s.car.x, s.car.y) - sA;
      t(mv >= L && Math.abs((3 * L - s.car._wrongB) - mv) < 1e-6 && !s.car._marshal, `B4'' ${mode} 3 車長を持つ逆向きの車が進行方向へ ${(mv / L).toFixed(2)} 車長動く: 距離はその分だけ減る（${(s.car._wrongB / L).toFixed(3)} 車長）`);
    }
    // B5: 4 車長で向きが戻れば 0 に戻る
    {
      const s = mk(jig, poseC(3.4, 0, Math.PI));
      const run = (dist) => { const a = sOf(s.car.x, s.car.y); for (let k = 0; k < 2000 && Math.abs(sOf(s.car.x, s.car.y) - a) < dist; k++) { drive(s, C.FORWARD); step(s, [], jig.walls, true); } };
      run(4 * L); const b1 = s.car._wrongB;
      s.car.theta = phi0; s.car.halt(); drive(s, C.FREE, 0); step(s, [], jig.walls, true); const b2 = s.car._wrongB;
      s.car.theta = phi0 + Math.PI; s.car.halt(); run(4 * L);
      t(b1 > 3.9 * L && b2 === 0 && !s.car._marshal, `B5 ${mode} 逆へ 4 車長 → 向きが戻る → また逆へ 4 車長: 向きを直さない（積んだ ${(b1 / L).toFixed(2)} → ${b2}・回数 ${s.car._marshal}）`);
    }
    // B6: 切り返し中は終わるまで待つ（切り返しの後退は進行方向へ動くので距離は減る＝余裕を持たせる）
    {
      const s = mk(jig, poseC(2.0, 0, Math.PI));
      drive(s, C.FREE, 0); step(s, [], jig.walls, true);
      s.car._wrongB = 6.5 * L; s.car.recoverT = 0.3; s.car.recoverSteer = C.CENTER;
      let during = 0;
      for (let k = 1; k <= 60; k++) { if (s.car.recoverT <= 0) drive(s, C.FREE, 0); const rt = s.car.recoverT; step(s, [], jig.walls, true); if (rt > h + 1e-9 && s.car._marshal) during++; }
      t(during === 0 && s.car._marshal === 1, `B6 ${mode} 切り返し中は直さず、終わったら直す（切り返し中に直した ${during}・回数 ${s.car._marshal}）`);
    }
    // B6': 切り返しの後退（向きが逆の車は進行方向へ動く）の間も、0 より下へ積まない
    {
      const s = mk(jig, poseC(2.0, 0, Math.PI));
      drive(s, C.FREE, 0); step(s, [], jig.walls, true);
      s.car._wrongB = 0; s.car.recoverT = 0.7; s.car.recoverSteer = C.CENTER;
      const sA = sOf(s.car.x, s.car.y); let lo = Infinity, n = 0;
      for (let k = 1; k <= 80 && s.car.recoverT > 0; k++) { step(s, [], jig.walls, true); lo = Math.min(lo, s.car._wrongB); n++; }
      const fwd = sOf(s.car.x, s.car.y) - sA;
      t(n >= 10 && fwd > 0.1 * L && lo === 0 && !s.car._marshal, `B6' ${mode} 切り返しの後退で進行方向へ ${(fwd / L).toFixed(2)} 車長: 距離は 0 のまま（最小 ${lo}・${n} 回の呼び出し）`);
    }
    // B7: 候補の選び方。車は止めたまま（惰行・速度 0）で距離だけを 5 車長にして 1 回呼ぶ＝その姿勢で判定される。
    const still = (pose, blockers, walls = jig.walls) => {
      const s = mk(jig, pose); const bs = blockers.map((p) => { const b = mk(jig, p); b.running = false; return b; });
      drive(s, C.FREE, 0); step(s, bs, walls, true);
      const c0 = centerOf(s.car), r0 = [s.car.x, s.car.y];
      s.car._wrongB = 5 * L; step(s, bs, walls, true);
      const c1 = centerOf(s.car);
      const kind = !s.car._marshal ? 'none' : (Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) < 1e-9 ? 'A' : (Math.hypot(s.car.x - r0[0], s.car.y - r0[1]) < 1e-9 ? 'B' : 'C'));
      return { s, bs, kind, c1 };
    };
    const tilt = 2 * Math.PI / 3;   // 進行方向から 120°（cos = −0.5 ＝逆向き）
    {
      const r = still(poseC(2.0, 0.2, tilt), []);
      t(r.kind === 'A' && Math.cos(r.s.car.theta - phi0) > 1 - 1e-9, `B7 ${mode} 相手なし: A（中心を保って回す）（採った ${r.kind}）`);
      const blk1 = poseC(2.0 - 0.17, 0.2, 0);            // 車体の中心の 0.17 m 後ろに、進行方向を向いた車（A の姿勢と重なる）
      const r2 = still(poseC(2.0, 0.2, tilt), [blk1]);
      t(r2.kind === 'B' && ov(r2.s, r2.bs[0]) === 0, `B7 ${mode} A の姿勢が他車と重なる: B（基準点を保って回す）を採り、重ならない（採った ${r2.kind}）`);
      const blk2 = poseC(2.0 + 0.25, 0.2 - 0.056, 0);    // B の姿勢と重なる位置にも車
      const r4 = still(poseC(2.0, 0.2, tilt), [blk1, blk2]);
      const moved4 = Math.hypot(r4.s.car.x - poseC(2.0, 0.2, tilt).x, r4.s.car.y - poseC(2.0, 0.2, tilt).y);
      t(r4.kind === 'none' && r4.s.car._wrongB >= 5 * L && Math.cos(r4.s.car.theta - phi0) < 0 && (mode === 'v2' || moved4 === 0), `B7 ${mode} A・B とも他車と重なる: 見送る（採った ${r4.kind}・距離は残る・車は動かさない）`);
      r4.bs[1].car.reset(poseC(0.3, 0, 0));   // B の姿勢を塞いでいた車が去る
      drive(r4.s, C.FREE, 0); step(r4.s, r4.bs, jig.walls, true);
      t(r4.s.car._marshal === 1 && ov(r4.s, r4.bs[0]) === 0, `B7 ${mode} 見送った後、塞いでいた車が去れば次の呼び出しで直す（回数 ${r4.s.car._marshal}）`);
      const r5 = still(poseC(2.0, 0.2, Math.PI), [poseC(2.0 + 0.1, 0.2 + 0.03, 0)]);
      t(r5.kind === 'A' && (mode === 'v2' || ov(r5.s, r5.bs[0]) > 0), `B7 ${mode} すでに重なっている相手: 重なりを増やさない姿勢（真後ろ向きの A は同じ矩形）は通す（採った ${r5.kind}）`);
      // 外した車（完走・リタイア・ゴール）は相手にしない: A の姿勢と重なる位置にいても A を採る
      const r6s = mk(jig, poseC(2.0, 0.2, tilt)), gone = mk(jig, blk1); gone.running = false; gone.retired = true;
      drive(r6s, C.FREE, 0);
      const stepG = () => { if (mode === 'v2') fleet.integrateFleetV2([r6s, gone], h, jig.walls, true, true); else fleet.integrateSlot(r6s, h, fleet.othersFor(fleet.fleetEdges([r6s, gone]), 0, true), jig.walls, true); };
      stepG(); const g0 = centerOf(r6s.car); r6s.car._wrongB = 5 * L; stepG(); const g1 = centerOf(r6s.car);
      t(r6s.car._marshal === 1 && Math.hypot(g1[0] - g0[0], g1[1] - g0[1]) < 1e-9, `B7 ${mode} 外した車は相手にしない（A を採る・回数 ${r6s.car._marshal}）`);
      // 「向きが逆」の境目は cos < 0: 進行方向から 95° なら逆（直す）・85° なら逆でない（直さず、距離を 0 に戻す）
      const r95 = still(poseC(2.0, 0.2, 95 * Math.PI / 180), []), r85 = still(poseC(2.0, 0.2, 85 * Math.PI / 180), []);
      t(r95.kind === 'A' && r85.kind === 'none' && r85.s.car._wrongB === 0, `B7 ${mode} 向きが逆の境目: 進行方向から 95° は直す（${r95.kind}）・85° は直さない（${r85.kind}・距離 ${r85.s.car._wrongB}）`);
      // 向きを直したら、車どうしの STUCK の窓と v2 のスタック検出の窓を消す（置き直した位置から取り直す）
      { const s = mk(jig, poseC(2.0, 0.2, tilt)); drive(s, C.FREE, 0); step(s, [], jig.walls, true);
        s.car._wrongB = 5 * L; s.car._ccOn = true; s.car._ccT = 0.3; s.car._ccX = s.car.x; s.car._ccY = s.car.y; s.car._ccLast = 0.3; s.car._stuckT = 0.4;
        step(s, [], jig.walls, true);
        t(s.car._marshal === 1 && s.car._ccOn === false && s.car._stuckT === 0, `B7 ${mode} 向きを直したら STUCK の窓を消す（_ccOn ${s.car._ccOn}・_stuckT ${s.car._stuckT}）`); }
      // 諦め（gaveUp）中の車も、走行中なら向きを直す。向き直しは切り返しの回数（recoverN）と諦めの状態を変えない。
      { const s = mk(jig, poseC(2.0, 0.2, tilt)); drive(s, C.FREE, 0); step(s, [], jig.walls, true);
        s.car._wrongB = 5 * L; s.car.gaveUp = true; s.car.recoverCooldownT = 100; s.car.recoverN = 3;
        step(s, [], jig.walls, true);
        t(s.car._marshal === 1 && s.car.gaveUp === true && s.car.recoverN === 3, `B7 ${mode} 諦め中の車: 向きを直す（回数 ${s.car._marshal}）・諦めの状態と切り返しの回数は変えない（gaveUp ${s.car.gaveUp}・recoverN ${s.car.recoverN}）`); }
      if (mode !== 'v2') {
        // 他車のエッジが 4 本ずつでない呼び出し（車体の四角に組めない）では向きを直さない。4 本ずつなら直す（遠くのエッジ・全スロットは渡さない）。
        const farE = (k) => Array.from({ length: k }, (_, j) => ({ x1: 30 + j, y1: 30, x2: 30.5 + j, y2: 30 }));
        const runE = (k) => { const s = mk(jig, poseC(2.0, 0.2, tilt)); drive(s, C.FREE, 0); fleet.integrateSlot(s, h, farE(k), jig.walls, true); s.car._wrongB = 5 * L; fleet.integrateSlot(s, h, farE(k), jig.walls, true); return s.car; };
        const c5 = runE(5), c4 = runE(4);
        t(c5._marshal === 0 && c5._wrongB >= 5 * L && c4._marshal === 1, `B7 ${mode} 他車のエッジが 4 本ずつでない呼び出し: 直さない（回数 ${c5._marshal}）・4 本ずつなら直す（回数 ${c4._marshal}）`);
      }
      if (mode === 'v2') {
        // 他車を障害物にしない走り（interact OFF）では、精密 v2 でも他車を相手にしない（A の姿勢と重なる位置に車がいても A を採る）
        const s9 = mk(jig, poseC(2.0, 0.2, tilt)), b9 = mk(jig, blk1); b9.running = false;
        drive(s9, C.FREE, 0); fleet.integrateFleetV2([s9, b9], h, jig.walls, true, false);
        const q0 = centerOf(s9.car); s9.car._wrongB = 5 * L; fleet.integrateFleetV2([s9, b9], h, jig.walls, true, false); const q1 = centerOf(s9.car);
        t(s9.car._marshal === 1 && Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) < 1e-9, `B7 v2 他車を障害物にしない走り（interact OFF）では他車を見ない（A を採る・回数 ${s9.car._marshal}）`);
      }
      if (mode !== 'v2') {
        // 全スロットを渡す呼び出し（公式レース・ライブ）でも同じ: 外した車は相手にしない（遠くに走っている車が 1 台いる＝others は空でない）
        const s7 = mk(jig, poseC(2.0, 0.2, tilt)), gone7 = mk(jig, blk1), far7 = mk(jig, poseC(0.5, 0, 0)); gone7.running = false; gone7.retired = true; far7.running = false;
        const all7 = [s7, gone7, far7];
        const step7 = () => { drive(s7, C.FREE, 0); fleet.integrateSlot(s7, h, fleet.othersFor(fleet.fleetEdges(all7), 0, true), jig.walls, true, all7); };
        step7(); const h0 = centerOf(s7.car); s7.car._wrongB = 5 * L; step7(); const h1 = centerOf(s7.car);
        t(s7.car._marshal === 1 && Math.hypot(h1[0] - h0[0], h1[1] - h0[1]) < 1e-9, `B7 ${mode} 全スロットを渡しても、外した車は相手にしない（A を採る・回数 ${s7.car._marshal}）`);
        // 他車を相手にしない走り（他車を障害物 OFF＝others が空）では、全スロットを渡されても相手にしない
        const s8 = mk(jig, poseC(2.0, 0.2, tilt)), b8 = mk(jig, blk1); b8.running = false;
        const step8 = () => { drive(s8, C.FREE, 0); fleet.integrateSlot(s8, h, [], jig.walls, true, [s8, b8]); };
        step8(); const k0 = centerOf(s8.car); s8.car._wrongB = 5 * L; step8(); const k1 = centerOf(s8.car);
        t(s8.car._marshal === 1 && Math.hypot(k1[0] - k0[0], k1[1] - k0[1]) < 1e-9, `B7 ${mode} 他車を障害物にしない走り（others が空）では他車を見ない（A を採る・回数 ${s8.car._marshal}）`);
      }
    }
    // B8: 壁。A の姿勢の後端に短い壁（いまの斜めの姿勢には触れない）→ 別の候補を採る。中心の移動が壁を横切る候補は採らない。
    {
      const seg = (p, q) => ({ x1: p[0], y1: p[1], x2: q[0], y2: q[1] });
      const walls = [...jig.walls, seg(P(2.0 - 0.09, 0.2 - 0.03), P(2.0 - 0.09, 0.2 - 0.3))];   // A の姿勢の後端の内側から横へ伸びる壁
      const pre = mk(jig, poseC(2.0, 0.2, tilt));
      const r = still(poseC(2.0, 0.2, tilt), [], walls);
      t(!physics.checkCollision(pre.car, walls) && r.kind === 'B' && !physics.checkCollision(r.s.car, walls), `B8 ${mode} A の姿勢が壁に当たる: B を採り、壁と交差しない（採った ${r.kind}）`);
      // 走路の上にいない車（基準線の最近点との間に壁がある＝壁の向こうの区間の向きを拾っている・走路の外へ出た）は向きを直さない。
      //   基準線との間に仕切りを置く。相手なしなら A が通る姿勢でも見送り、距離は残る。仕切りが無ければ直す。
      const fence = seg(P(1.5, 0.1), P(2.5, 0.1));
      const r2 = still(poseC(2.0, 0.25, tilt), [], [...jig.walls, fence]);
      t(r2.kind === 'none' && r2.s.car._wrongB >= 5 * L, `B8 ${mode} 基準線の最近点との間に壁がある: 見送る（採った ${r2.kind}・距離は残る）`);
      const r3 = still(poseC(2.0, 0.25, tilt), []);
      t(r3.kind === 'A', `B8 ${mode} 対照（仕切りなし・同じ姿勢）: 直す（採った ${r3.kind}）`);
      // 「走路の上にいるか」の見通しは車体の中心から引く（基準点からではない）。真後ろ向きの車（中心 (2.0, 0.3)・基準点はその先 off）で、
      //   基準点と基準線の間だけを横切る短い仕切りを置く → 中心からは見通せるので直す。
      const stub = seg(P(2.0 + 0.012, 0.15), P(2.0 + off + 0.02, 0.15));
      const r5 = still(poseC(2.0, 0.3, Math.PI), [], [...jig.walls, stub]);
      t(off > 0.03 && r5.kind === 'A', `B8 ${mode} 基準点と基準線の間だけに仕切り（車体の中心からは見通せる・off ${off.toFixed(3)} m）: 直す（採った ${r5.kind}）`);

    }
  }
  // B12: 同じ tick に 2 台が向きを直す。公式レースと同じ呼び順（他車の車体エッジを tick の冒頭に 1 回作る → 添字順に 1 台ずつ進める・
  //   全スロットを渡す）で、後の車は先に置き直した車の**置き直した後の姿勢**を見る＝重ならない（古い姿勢で見ると車体の 1 割重なる）。
  for (const mode of ['standard', 'dynamic', 'v2']) {
    config.setPhysicsMode(mode);
    const tilt = 2 * Math.PI / 3;
    const a = mk(jig, poseC(2.0, 0.2, tilt)), b = mk(jig, poseC(2.0 + 0.17, 0.2, tilt)), sl = [a, b];
    const tick = () => { for (const s of sl) drive(s, C.FREE, 0);
      if (mode === 'v2') fleet.integrateFleetV2(sl, h, jig.walls, true, true);
      else { const e = fleet.fleetEdges(sl); sl.forEach((s, i) => fleet.integrateSlot(s, h, fleet.othersFor(e, i, true), jig.walls, true, sl)); } };
    tick(); const before = ov(a, b);
    a.car._wrongB = 5 * L; b.car._wrongB = 5 * L; tick();
    t(before === 0 && a.car._marshal === 1 && ov(a, b) === 0 && !physics.checkCollision(a.car, [], physics.carEdges(b.car)), `B12 ${mode} 同じ tick に 2 台: 先の車は直し、後の車は先の車の置き直した後の姿勢と重ならない（回数 ${a.car._marshal}・${b.car._marshal}・重なり ${ov(a, b).toExponential(2)} m²）`);
    for (let k = 0; k < 5 && !b.car._marshal; k++) tick();
    t(ov(a, b) === 0, `B12 ${mode} その後も重ならない（後の車の回数 ${b.car._marshal}・重なり ${ov(a, b).toExponential(2)} m²）`);
  }
  config.setPhysicsMode('dynamic');
  // B9: フィニッシュ線（斜めの線の治具・中心線つきの四角い周回）。3 エンジンで（精密 v2 は向き直しとラップ計測の順が別の関数にある）。
  {
    const a = -50 * Math.PI / 180, fx = Math.cos(a), fy = Math.sin(a);
    const ring = { name: '治具・斜めの線', walls: [...rect(0, 0, 6, 4), ...rect(1.6, 1.6, 4.4, 2.4)], bounds: { w: 6, h: 4 }, start: { x: 1.0, y: 0.8, theta: 0 },
      finish: { x1: 2.2, y1: 0, x2: 2.2 + 1.6 * (-fy / fx), y2: 1.6, fx, fy }, centerline: [[0.8, 0.8], [5.2, 0.8], [5.2, 3.2], [0.8, 3.2]] };
    const tg = { name: '治具・峠', touge: true, walls: rect(0, 0, 6, 1.6), bounds: { w: 6, h: 1.6 }, start: { x: 0.3, y: 0.8, theta: 0 },
      finish: { x1: 2.2, y1: 0, x2: 2.2 + 1.6 * (-fy / fx), y2: 1.6, fx, fy }, centerline: [[0.2, 0.8], [5.8, 0.8]] };
    const df = fleet.dirFrame(ring);
    t(df && !df.rev && Math.abs(fleet.dirAt(df, 3, 0.8)) < 1e-12, 'B9 治具: 進行方向の場あり（下の直線は +x）');
    const pose = (cx, cy, th) => ({ x: cx - off * Math.cos(th), y: cy - off * Math.sin(th), theta: th });
    for (const mode of ['standard', 'dynamic', 'v2']) {
      config.setPhysicsMode(mode);
      const mk2 = (course, p, i = 0) => { const s = fleet.makeSlot({ i, lang: 'c', src: DUMMY, course, slotCount: 1, logFor: () => () => {}, persist: false }); s.car.reset(p); s.running = i === 0; return s; };
      const stepAll = (course, s, bs) => { s.car.driveDir = C.FREE; s.car.pwm = 0; if (mode === 'v2') fleet.integrateFleetV2([s, ...bs], h, course.walls, true, true); else fleet.integrateSlot(s, h, edgesOf(bs), course.walls, true, [s, ...bs]); };
      const run = (course, p, blockers) => {
        const s = mk2(course, p), bs = blockers.map((q) => mk2(course, q, 1));
        stepAll(course, s, bs);
        const before = { x: s.car.x, y: s.car.y, sg: s.lap._signed(s.car.x, s.car.y) };
        s.car._wrongB = 5 * L; stepAll(course, s, bs);
        return { s, before, after: s.lap._signed(s.car.x, s.car.y) };
      };
      // 順方向に越える置き直しはしない。斜めの線（正方向は進行方向から −50°）のすぐ手前に、進行方向から −95° を向いた車（向きは逆・
      //   cos −0.09）を置く。A（中心を保って回す）は基準点を線の先へ 4 mm 動かす＝線を順方向に越えるので採らず、B（基準点を保つ）を採る。
      const sgAt = (x, y) => (x - (ring.finish.x1 + ring.finish.x2) / 2) * fx + (y - (ring.finish.y1 + ring.finish.y2) / 2) * fy;
      const thX = -95 * Math.PI / 180, refX = (dn) => { const mx = (ring.finish.x1 + ring.finish.x2) / 2, my = (ring.finish.y1 + ring.finish.y2) / 2; return { x: mx + fx * dn, y: my + fy * dn, theta: thX }; };
      const aRef = (p) => { const ccx = p.x + off * Math.cos(p.theta), ccy = p.y + off * Math.sin(p.theta); return [ccx - off, ccy]; };   // A の後の基準点（向き 0）
      const p0 = refX(-0.002), a0 = aRef(p0);
      const r = run(ring, p0, []);
      t(sgAt(p0.x, p0.y) < 0 && sgAt(a0[0], a0[1]) > 0 && r.s.car._marshal === 1 && Math.hypot(r.s.car.x - r.before.x, r.s.car.y - r.before.y) < 1e-9 && r.s.lap.laps === 0 && r.s.lap._start === true && r.after < 0,
        `B9 ${mode} A が基準点をフィニッシュ線の順方向へ越えさせる（手前 ${sgAt(p0.x, p0.y).toFixed(4)} → 先 ${sgAt(a0[0], a0[1]).toFixed(4)}）: A を採らず B を採る（回数 ${r.s.car._marshal}・基準点は動かない・周回 ${r.s.lap.laps}・発走の通過 ${r.s.lap._start}）`);
      const p1 = refX(-0.05), a1 = aRef(p1), r2 = run(ring, p1, []);
      t(sgAt(a1[0], a1[1]) < 0 && r2.s.car._marshal === 1 && Math.hypot(r2.s.car.x - a1[0], r2.s.car.y - a1[1]) < 1e-9, `B9 ${mode} 対照（線の 5 cm 手前＝A でも線を越えない）: A を採る（回数 ${r2.s.car._marshal}）`);
      // 逆方向に越える置き直しは通し、**その呼び出しのうちに**借りになる（周回は増えない）。その後に線を順方向へ通っても数えず、1 周してから数える。
      const r3 = run(ring, pose(3.153 - 0.005, 0.8, Math.PI), []);
      const lp = r3.s.lap, owe = lp._geo.chords.reduce((q, c) => q + c.owe, 0);
      t(r3.before.sg > 0 && r3.after < 0 && r3.s.car._marshal === 1 && lp.laps === 0 && owe === 1 && lp.prev.x === r3.s.car.x, `B9 ${mode} 基準点が線の先 ${r3.before.sg.toFixed(3)} → 置き直しで手前 ${r3.after.toFixed(3)}: 直す・周回は増えない（${lp.laps}）・同じ呼び出しで借り ${owe}`);
      const feed = (pts) => { for (const [x, y] of pts) { const x0 = lp.prev.x, y0 = lp.prev.y, k = Math.ceil(Math.hypot(x - x0, y - y0) / 0.02); for (let j = 1; j <= k; j++) lp.update(1 / 60, x0 + (x - x0) * j / k, y0 + (y - y0) * j / k, true); } };
      feed([[4.0, 0.8]]); const l1 = lp.laps;
      feed([[5.2, 0.8], [5.2, 3.2], [0.8, 3.2], [0.8, 0.8], [4.0, 0.8]]); const l2 = lp.laps;
      t(l1 === 0 && l2 === 1, `B9 ${mode} その後: 線を順方向に通っても ${l1}（借りを返すだけ）→ 1 周して ${l2}＝位置の巻き数（−1 → 0 → 1）と合う`);
      // 峠: 置き直しでゴールしない（同じ形: A はゴール線を越えるので採らず、B で直す）
      const r4 = run(tg, p0, []);
      t(!r4.s.lap.finished && r4.s.car._marshal === 1 && Math.hypot(r4.s.car.x - r4.before.x, r4.s.car.y - r4.before.y) < 1e-9, `B9 ${mode} 峠: 置き直しでゴールしない（ゴール ${r4.s.lap.finished}・回数 ${r4.s.car._marshal}・基準点は動かない）`);
      // 角の近く: 直した後の向きは、その基準点の進行方向と cos > 0.9（回した後の基準点で進行方向が変わるなら、そちらでやり直すか、別の候補）。
      //   角 (5.2, 0.8)（下の直線 +x → 右の直線 +y）のまわりの格子の点に、その点の進行方向と真逆を向いた車を置いて確かめる。
      let nDone = 0, nBad = 0, worst = 1;
      for (let gx = 4.9; gx <= 5.5 + 1e-9; gx += 0.05) for (let gy = 0.5; gy <= 1.1 + 1e-9; gy += 0.05) {
        const s = mk2(ring, { x: gx, y: gy, theta: fleet.dirAt(df, gx, gy) + Math.PI });
        stepAll(ring, s, []); s.car._wrongB = 5 * L; stepAll(ring, s, []);
        if (!s.car._marshal) continue;
        nDone++; const cs = Math.cos(s.car.theta - fleet.dirAt(df, s.car.x, s.car.y)); if (cs < worst) worst = cs; if (!(cs > 0.9)) nBad++;
      }
      t(nDone >= 100 && nBad === 0, `B9 ${mode} 角のまわりの ${nDone} 点: 直した後の向きが、その基準点の進行方向と cos > 0.9（最小 ${worst.toFixed(3)}・違反 ${nBad}）`);
    }
    config.setPhysicsMode('dynamic');
    // lap.crossesForwardTo そのもの（読むだけの口）
    const tr = new M.lap.LapTracker(ring, { persist: false });
    const side = (x, y) => tr._signed(x, y);
    const before0 = tr.crossesForwardTo(4, 0.8);
    tr.update(0, 2.5, 0.8, true);   // 線の手前（負側）
    const st0 = JSON.stringify([tr.prev, tr.laps, tr._start, tr._geo.chords.map((c) => c.owe)]);
    const fwd = tr.crossesForwardTo(4, 0.8), same = tr.crossesForwardTo(2.0, 0.8), nan = tr.crossesForwardTo(NaN, 0.8);
    const fmx = (ring.finish.x1 + ring.finish.x2) / 2, fmy = (ring.finish.y1 + ring.finish.y2) / 2;   // 線の中点。正方向 (fx,fy) は線の法線
    const justOver = tr.crossesForwardTo(fmx + 1e-6 * fx, fmy + 1e-6 * fy), justShort = tr.crossesForwardTo(fmx - 1e-6 * fx, fmy - 1e-6 * fy);
    const st1 = JSON.stringify([tr.prev, tr.laps, tr._start, tr._geo.chords.map((c) => c.owe)]);
    tr.update(0, 4, 0.8, false);    // 線の先（正側）へ
    const backw = tr.crossesForwardTo(2.5, 0.8), stay = tr.crossesForwardTo(4.5, 0.8);
    const noFin = new M.lap.LapTracker({ ...ring, finish: null }, { persist: false }); noFin.update(0, 1, 1, true);
    t(side(2.5, 0.8) < 0 && side(4, 0.8) > 0 && before0 === false && fwd === true && same === false && nan === true && backw === false && stay === false && noFin.crossesForwardTo(4, 0.8) === false && st0 === st1,
      `B9 lap.crossesForwardTo: update の前は偽（${before0}）・負側 → 正側は真（${fwd}）・負側のままは偽（${same}）・NaN は真（${nan}）・正側 → 負側は偽（${backw}）・正側のままは偽（${stay}）・フィニッシュ無しは偽・状態を変えない（${st0 === st1}）`);
    t(justOver === true && justShort === false, `B9 lap.crossesForwardTo の境目: 線の 1 µm 先は真（${justOver}）・1 µm 手前は偽（${justShort}）`);
  }
  // B13: 頂点の近くの向き（折れ角 120° の三角形の中心線の治具）。頂点の手前で次の区間の向きを向いた車＝正しく走っている車は、距離を持っていても
  //   直さず 0 に戻す（区間の向きのままだと「向きが逆」に見えて直してしまう）。同じ場所で手前の区間と真逆を向いた車は直す。
  {
    const tri = { name: '治具・三角', walls: rect(0, 0, 6, 5.5), bounds: { w: 6, h: 5.5 }, start: { x: 2, y: 1, theta: 0 }, finish: { x1: 2, y1: 0.2, x2: 2, y2: 1.8, fx: 1, fy: 0 }, centerline: [[1, 1], [5, 1], [3, 1 + 2 * Math.sqrt(3)]] };
    const df = fleet.dirFrame(tri);
    for (const mode of ['standard', 'dynamic', 'v2']) {
      config.setPhysicsMode(mode);
      const go = (x, y, th) => { const s = fleet.makeSlot({ i: 0, lang: 'c', src: DUMMY, course: tri, slotCount: 1, logFor: () => () => {}, persist: false }); s.car.reset({ x, y, theta: th }); s.running = true;
        const st = () => { s.car.driveDir = C.FREE; s.car.pwm = 0; if (mode === 'v2') fleet.integrateFleetV2([s], h, tri.walls, true, true); else fleet.integrateSlot(s, h, [], tri.walls, true); };
        st(); s.car._wrongB = 5 * L; st(); return s.car; };
      // 頂点 (5,1) の手前 0.26 m・内側 0.1 m（等距離の線は手前 0.173 m）。次の区間の向きは 120°。
      const c1 = go(5 - 0.26, 1.1, 2 * Math.PI / 3), c2 = go(5 - 0.26, 1.1, Math.PI);
      t(df && c1._marshal === 0 && c1._wrongB === 0 && c2._marshal === 1, `B13 ${mode} 鋭い角の手前: 次の区間の向きを向いた車は直さず距離を 0 に戻す（回数 ${c1._marshal}・距離 ${c1._wrongB}）・真逆を向いた車は直す（回数 ${c2._marshal}）`);
    }
    config.setPhysicsMode('dynamic');
  }
  // B14: annulus（出荷「丸の中の四角」）。走路の外（外周の壁の外）では直さない。走路の中では A で直し、直した後の向きは **直す前の基準点**
  //   での進行方向（回した後の基準点での進行方向ではない。輪では位置で進行方向が変わるので 2 つは違う）。
  {
    const ann = CM.buildFromSpec(specOf('丸の中の四角')), dfA = fleet.dirFrame(ann);
    const ang = (p, q) => Math.atan2(Math.sin(p - q), Math.cos(p - q));
    const acx = dfA && dfA.ring ? dfA.ring.cx : NaN, acy = dfA && dfA.ring ? dfA.ring.cy : NaN;
    for (const mode of ['standard', 'dynamic', 'v2']) {
      config.setPhysicsMode(mode);
      const go = (rx, ry) => {
        const s = fleet.makeSlot({ i: 0, lang: 'c', src: DUMMY, course: ann, slotCount: 1, logFor: () => () => {}, persist: false });
        s.car.reset({ x: rx, y: ry, theta: fleet.dirAt(dfA, rx, ry) + Math.PI }); s.running = true;
        const st = () => { s.car.driveDir = C.FREE; s.car.pwm = 0; if (mode === 'v2') fleet.integrateFleetV2([s], h, ann.walls, true, true); else fleet.integrateSlot(s, h, [], ann.walls, true); };
        st(); const x0 = s.car.x, y0 = s.car.y, phi = fleet.dirAt(dfA, x0, y0); s.car._wrongB = 5 * L; st();
        return { c: s.car, x0, y0, phi };
      };
      const inn = go(acx + 0.9, acy + 0.05), out = go(acx + 1.6, acy + 0.05);
      const dOld = Math.abs(ang(inn.c.theta, inn.phi)), dNew = Math.abs(ang(fleet.dirAt(dfA, inn.c.x, inn.c.y), inn.c.theta)), moved = Math.hypot(inn.c.x - inn.x0, inn.c.y - inn.y0);
      t(!!(dfA && dfA.ring) && inn.c._marshal === 1 && dOld < 1e-9 && moved > 0.05 && dNew > 0.02,
        `B14 ${mode} annulus の走路の中: A で直し、向きは直す前の基準点での進行方向（差 ${dOld.toExponential(1)} rad・基準点の移動 ${moved.toFixed(3)} m・回した後の基準点での進行方向との差 ${dNew.toFixed(3)} rad）`);
      t(out.c._marshal === 0 && out.c._wrongB >= 5 * L, `B14 ${mode} annulus の走路の外（外周の壁の外）: 直さない（回数 ${out.c._marshal}・距離は残る）`);
    }
    config.setPhysicsMode('dynamic');
  }
  // B10: reset で消える（3 エンジン）
  for (const mode of ['standard', 'dynamic', 'v2']) {
    config.setPhysicsMode(mode);
    const s = mk(jig, poseC(3.4, 0, Math.PI));
    s.car._wrongB = 0.5; s.car._marshal = 3; s.car.reset(s.spawn);
    t(s.car._wrongB === 0 && s.car._marshal === 0, `B10 ${mode}: car.reset で距離と回数が消える`);
  }
  config.setPhysicsMode('dynamic');
  if (!races) return v;
  // B11: 公式レース。向き直しは切り返しと同じ 1 回 3 秒・試走の向き直しは本番に数えない・リタイア規則では働かない。
  //   スタートの向きを 180° 反転させた凍結グリッドで 1 台（オーバル）。本番の出来事は probe（本番だけで呼ばれる）で数える。
  {
    const oval = CM.buildFromSpec(specOf('オーバル'));
    const g = [{ x: oval.start.x, y: oval.start.y, theta: oval.start.theta + Math.PI }];
    for (const mode of MODES) {
      const a = raceCell(M, oval, { n: 1, mode, grid: g });
      const e = a.mainEv[0], pen = a.r.finishers.length ? a.r.finishers[0].penaltiesSec : null;
      t(a.fin === 1 && e.m - e.m0 >= 1 && pen === 3 * (e.arm + (e.m - e.m0)), `B11 ${mode} 逆向きの発走: 完走し、ペナルティ ${pen} 秒 = 3 ×（切り返し ${e.arm}＋向き直し ${e.m - e.m0}）`);
      const b = raceCell(M, oval, { n: 1, mode, grid: g, recon: { laps: 1 } });
      const e2 = b.mainEv[0], pen2 = b.r.finishers.length ? b.r.finishers[0].penaltiesSec : null;
      t(b.fin === 1 && e2.m0 === 0 && e2.m - e2.m0 >= 1 && pen2 === 3 * (e2.arm + (e2.m - e2.m0)), `B11 ${mode} 試走つき: 本番の開始時点の回数 ${e2.m0}・ペナルティ ${pen2} 秒 = 3 ×（本番の切り返し ${e2.arm}＋向き直し ${e2.m - e2.m0}）`);
      const c = raceCell(M, oval, { n: 1, mode, grid: g, rejoin: false, maxSec: 40 });
      t(c.marshal[0] === 0, `B11 ${mode} リタイア規則: 向きを直さない（回数 ${c.marshal[0]}）`);
      const rep = a.r.report && a.r.report[0];
      t(rep && rep.marshalCount === e.m - e.m0 && rep.crashCount === e.arm + (e.m - e.m0), `B11 ${mode} レポート: 向き直し ${rep && rep.marshalCount} 回・ペナルティの回数 ${rep && rep.crashCount}＝切り返し ${e.arm}＋向き直し ${e.m - e.m0}`);
    }
    // 向き直しが 2 回以上の走り: 1 回ごとに 3 秒（最初の 1 回だけでなく毎回数える）。逆向きの発走で 1 回目。その後、直されてから
    //   5 秒後に治具が車の向きを 180° 回す（速度 0）ことを 2 回 → 向き直しはちょうど 3 回（走りの成り行きに頼らず 3 エンジンで作る）。
    for (const mode of MODES) {
      let seen = 0, due = -1, flips = 0;
      const poke = (tick, slots) => {
        const c = slots[0].car, m = c._marshal || 0;
        if (m > seen) { seen = m; due = flips < 2 ? tick + 300 : -1; }
        if (due >= 0 && tick >= due && !(c.recoverT > 0) && !c.crashed && !slots[0].lap.finished) { c.theta += Math.PI; c.halt(); flips++; due = -1; }
      };
      const a = raceCell(M, oval, { n: 1, mode, grid: g, poke });
      const e = a.mainEv[0], rep = a.r.report[0], pen = a.r.finishers.length ? a.r.finishers[0].penaltiesSec : null;
      t(flips === 2 && e.m - e.m0 === 3 && a.fin === 1 && rep.marshalCount === 3 && rep.crashCount === e.arm + 3 && pen === 3 * rep.crashCount, `B11 ${mode} 向き直し 3 回の走り（逆向きの発走＋途中で 2 回向きを回す）: 毎回数える（向きを回した ${flips} 回・向き直し ${e.m - e.m0} 回・完走 ${a.fin}・ペナルティの回数 ${rep.crashCount}＝切り返し ${e.arm}＋向き直し ${rep.marshalCount}・${pen == null ? '未完走' : pen + ' 秒'}）`);
    }
  }
  return v;
}

// ── C) 代表セル ─────────────────────────────────────────────────────────────────────
// 後退量の上限: 向き直しは逆へ 5 車長で働く。切り返しの後退・見送り・押し合いを足した実測の最大は、下の代表セルで 8.4 車長（改修後・C4）。
//   改修前は同じセルで数十〜数百車長（C1 455・C2 360・C3 47・C4 39・ライブ 250／277）。D) の母集団では、精密 v2 で壁を抜けて走路の外へ
//   出た車（改修前からの未決・向きを直さない）だけが上限を超える（改修後 1 台）。
const BACK_MAX = 15;
// 対象外の指紋（改修前の木 607dd2c で取った値。--root で改修前の木を指しても同じ値になる＝対象外は 1 ビットも変わらない）
const FROZEN = {
  '投稿コースの写し|公式レース 動力学 6 台 ペナルティ復帰': '80772d99/145ceb8a',
  '投稿コースの写し|公式レース 精密 v2 6 台 ペナルティ復帰': '74d799c8/b9602478',
  'モダン・レイアウト|公式レース 動力学 6 台 リタイア規則': 'e679bd1f/1e473a24',
  '四角の中の丸|公式レース 精密 v2 6 台 リタイア規則': '6a367aab/bbc3e465',
  'モダン・レイアウト（中心線なしの写し）|公式レース 動力学 6 台 ペナルティ復帰': '885732fd/399d6e93',
  '投稿コースの写し|ライブ 動力学 6 台': 'dcbdffaa',
  'モダン・レイアウト|ライブ 動力学 6 台 自動復帰 OFF': 'd31cd2aa',
  '四角の中の丸|ライブ 精密 v2 6 台 自動復帰 OFF': '788c6201',
};
function checkC(M, say) {
  const v = [];
  const t = (cond, msg) => { if (say) ok(cond, msg); if (!cond) v.push(msg); };
  const L = 0.19;
  const fmt = (a) => a.map((x) => (x / L).toFixed(1)).join('・');
  const post = (label, a) => {
    t(a.st.bad.length === 0 && a.st.lapInc === 0, `${label}: 向きを直した瞬間の姿勢 ${a.st.events} 回（違反 ${a.st.bad.length}${a.st.bad.length ? ' ' + a.st.bad.slice(0, 2).join(' / ') : ''}・その tick に周回が増えた ${a.st.lapInc}）`);
    if (a.wind && a.wind.length) t(a.wind.every((o) => o.over === 0 && o.late === 0), `${label}: 周回の数が位置の巻き数と合う（数えた周回／巻き数の最大 ${a.wind.map((o) => `${o.laps}/${o.wMax}`).join('・')}）`);
    t(Math.max(...a.marshal) <= 12, `${label}: 向き直しは 1 台 12 回以下（${a.marshal.join('・')}）`);
  };
  // C1 モダン・レイアウト 動力学 6 台（改修前: 完走 1/6・後退量 最大 400 車長超）
  { const a = raceCell(M, M.course.buildFromSpec(specOf('モダン・レイアウト')), { n: 6, mode: 'dynamic' });
    t(a.fin >= 5 && Math.max(...a.back) <= BACK_MAX * L, `C1 モダン・レイアウト 動力学 6 台 ペナルティ復帰: 完走 ${a.fin}/6（≥ 5）・後退量 ${fmt(a.back)} 車長（≤ ${BACK_MAX}）`); post('C1', a); }
  // C2 四角の中の丸（annulus）動力学 6 台
  { const a = raceCell(M, M.course.buildFromSpec(specOf('四角の中の丸')), { n: 6, mode: 'dynamic' });
    t(a.fin >= 5 && Math.max(...a.back) <= BACK_MAX * L, `C2 四角の中の丸 動力学 6 台 ペナルティ復帰: 完走 ${a.fin}/6（≥ 5）・後退量 ${fmt(a.back)} 車長（≤ ${BACK_MAX}）`); post('C2', a); }
  // C3 ツイスティ・レイアウト 精密 v2 1 台（改修前: 切り返しの後に反転して 25 秒逆走）
  { const a = raceCell(M, M.course.buildFromSpec(specOf('ツイスティ・レイアウト')), { n: 1, mode: 'v2' });
    t(a.fin === 1 && a.marshal[0] >= 1 && a.back[0] <= BACK_MAX * L, `C3 ツイスティ・レイアウト 精密 v2 1 台: 完走 ${a.fin}/1・向き直し ${a.marshal[0]} 回（≥ 1）・後退量 ${fmt(a.back)} 車長（≤ ${BACK_MAX}）`); post('C3', a); }
  // C4 峠（道幅 3 台分）精密 v2 6 台
  { const a = raceCell(M, M.course.buildFromSpec(specOf('峠① 中速ヘアピン (緩い下り)〔道幅 3 台分〕')), { n: 6, mode: 'v2' });
    t(Math.max(...a.back) <= BACK_MAX * L, `C4 峠①〔道幅 3 台分〕精密 v2 6 台: 完走 ${a.fin}/6・後退量 ${fmt(a.back)} 車長（≤ ${BACK_MAX}）`); post('C4', a); }
  // C5 ライブ（自動復帰 ON・120 秒）
  for (const [name, mode] of [['モダン・レイアウト', 'dynamic'], ['四角の中の丸', 'v2']]) {
    const a = liveCell(M, M.course.buildFromSpec(specOf(name)), { n: 6, mode });
    t(a.nUse === 6 && Math.max(...a.back) <= BACK_MAX * 0.8 * L, `C5 ライブ ${name} ${mode} 6 台 120 秒: 後退量 ${a.back.map((x) => (x / (0.8 * L)).toFixed(1)).join('・')} 車長（≤ ${BACK_MAX}・車体 0.8×）・向き直し ${a.marshal.join('・')} 回`);
    t(a.st.bad.length === 0 && a.st.lapInc === 0 && Math.max(...a.marshal) <= 12, `C5 ライブ ${name} ${mode}: 向きを直した瞬間の姿勢 ${a.st.events} 回（違反 ${a.st.bad.length}${a.st.bad.length ? ' ' + a.st.bad.slice(0, 2).join(' / ') : ''}・周回が増えた ${a.st.lapInc}）`);
  }
  // C6 対象外は 1 ビットも変わらない（改修前の木の値）
  const same = (key, got) => t(FROZEN[key] === got, `C6 ${key}: ${got}${FROZEN[key] === got ? '' : ' ≠ 改修前 ' + FROZEN[key]}`);
  { const r = raceCell(M, fig8Of(M), { n: 6, mode: 'dynamic', trace: true }); same('投稿コースの写し|公式レース 動力学 6 台 ペナルティ復帰', r.r.verifyHash + '/' + r.r.traceHash); t(r.marshal.every((x) => x === 0), 'C6 投稿コースの写し: 向き直し 0 回'); }
  { const r = raceCell(M, fig8Of(M), { n: 6, mode: 'v2', trace: true }); same('投稿コースの写し|公式レース 精密 v2 6 台 ペナルティ復帰', r.r.verifyHash + '/' + r.r.traceHash); }
  { const r = raceCell(M, M.course.buildFromSpec(specOf('モダン・レイアウト')), { n: 6, mode: 'dynamic', rejoin: false, trace: true }); same('モダン・レイアウト|公式レース 動力学 6 台 リタイア規則', r.r.verifyHash + '/' + r.r.traceHash); }
  { const r = raceCell(M, M.course.buildFromSpec(specOf('四角の中の丸')), { n: 6, mode: 'v2', rejoin: false, trace: true }); same('四角の中の丸|公式レース 精密 v2 6 台 リタイア規則', r.r.verifyHash + '/' + r.r.traceHash); }
  { // 中心線を落としたモダン・レイアウト（エディタで開いて適用した形）: 逆走しても向きを直さない
    const { centerline, ...c } = M.course.buildFromSpec(specOf('モダン・レイアウト'));
    const r = raceCell(M, c, { n: 6, mode: 'dynamic', trace: true }); same('モダン・レイアウト（中心線なしの写し）|公式レース 動力学 6 台 ペナルティ復帰', r.r.verifyHash + '/' + r.r.traceHash);
    t(r.marshal.every((x) => x === 0), 'C6 中心線なしの写し: 向き直し 0 回'); }
  { const a = liveCell(M, fig8Of(M), { n: 6, mode: 'dynamic' }); same('投稿コースの写し|ライブ 動力学 6 台', a.hash); }
  { const a = liveCell(M, M.course.buildFromSpec(specOf('モダン・レイアウト')), { n: 6, mode: 'dynamic', recover: false }); same('モダン・レイアウト|ライブ 動力学 6 台 自動復帰 OFF', a.hash); }
  { const a = liveCell(M, M.course.buildFromSpec(specOf('四角の中の丸')), { n: 6, mode: 'v2', recover: false }); same('四角の中の丸|ライブ 精密 v2 6 台 自動復帰 OFF', a.hash); }
  return v;
}

// ── D) 縮小母集団 ───────────────────────────────────────────────────────────────────
// フィニッシュのある出荷コースを 3 本おき × 3 エンジン × 6 台 × ペナルティ復帰。下限・上限は、同じ部分集合での改修前と改修後の
// 実測のあいだ（完走: 改修前 96・83・68／改修後 96・94・81〔各 102 台〕。後退量が BACK_MAX を超えた車: 改修前 10・14・29 台／改修後 0・0・1 台）。
// 動力学の完走はこの部分集合では改修前後で同じなので回帰の見張りだけ。受け入れ基準の判定は全母集団で行った（internal の BH5 の記録）。
const POP_LIM = { dynamic: { fin: 93, far: 3 }, standard: { fin: 88, far: 4 }, v2: { fin: 75, far: 8 } };
function checkD(M, say) {
  const v = [];
  const t = (cond, msg) => { if (say) ok(cond, msg); if (!cond) v.push(msg); };
  const names = SPECS.filter((s) => s.kind !== 'raw').filter((_, i) => i % 3 === 1).map((s) => s.name);
  const L = 0.19, acc = {};
  let nBad = 0, nLap = 0, mMax = 0, nWind = 0, nRace = 0;
  for (const mode of MODES) {
    acc[mode] = { fin: 0, cars: 0, far: 0, ev: 0 };
    for (const name of names) {
      const s = specOf(name), course = M.course.buildFromSpec(s);
      let a;
      try { a = raceCell(M, course, { regime: s.noRace ? 'fullscale' : 'tabletop', n: 6, mode }); } catch (e) { v.push(`${name} ${mode}: ${e.message}`); continue; }
      if (a.r.fitReduced) continue;
      nRace++;
      const Lr = s.noRace ? null : L;
      acc[mode].fin += a.fin; acc[mode].cars += 6; acc[mode].ev += a.st.events;
      if (Lr) acc[mode].far += a.back.filter((x) => x > BACK_MAX * Lr).length;
      nBad += a.st.bad.length; nLap += a.st.lapInc; mMax = Math.max(mMax, ...a.marshal);
      nWind += a.wind.filter((o) => o.over > 0 || o.late > 0).length;
    }
  }
  checkD.acc = acc;
  checkD.info = MODES.map((m) => `${m}: 完走 ${acc[m].fin}/${acc[m].cars}・後退量 ${BACK_MAX} 車長超 ${acc[m].far} 台・向き直し ${acc[m].ev} 回`).join(' ／ ');
  for (const m of MODES) {
    const lim = POP_LIM[m] || { fin: Infinity, far: -1 };
    t(acc[m].fin >= lim.fin, `D ${m}: 完走 ${acc[m].fin}/${acc[m].cars} ≥ ${lim.fin}`);
    t(acc[m].far <= lim.far, `D ${m}: 後退量が ${BACK_MAX} 車長を超えた車 ${acc[m].far} 台 ≤ ${lim.far}`);
  }
  t(nBad === 0 && nLap === 0 && nWind === 0 && mMax <= 12, `D ${nRace} 本: 向きを直した瞬間の姿勢の違反 ${nBad}・その tick に周回が増えた ${nLap}・周回の数が巻き数と合わない車 ${nWind}・1 台の向き直しの最大 ${mMax} 回（≤ 12）`);
  return v;
}

// ── F) 構造 ─────────────────────────────────────────────────────────────────────────
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => (/:\/\//.test(l) ? l : l.replace(/\/\/.*$/, ''))).join('\n');
function structural(srcs) {
  const v = [];
  const NEW = ['dirFrame', 'dirAt', 'overlapArea', 'marshalCheck', 'annulusMidline'];
  for (const [f, src] of Object.entries(srcs)) {
    if (f === 'fleet.js') continue;
    for (const m of strip(src).matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/fleet\.js'/g)) for (const nm of NEW) if (new RegExp(`\\b${nm}\\b`).test(m[1])) v.push(`${f} が fleet.js の新しい名前 ${nm} を名前付き import している（古い fleet.js がキャッシュに残ると起動しない＝BA1）`);
    if (/crossesForwardTo/.test(strip(src)) && f !== 'lap.js') v.push(`${f} が lap.js の新しい口を直接呼んでいる`);
  }
  const fleet = strip(srcs['fleet.js']), race = strip(srcs['race_engine.js']);
  if (!/typeof slot\.lap\.crossesForwardTo === 'function' && slot\.lap\.crossesForwardTo\(x, y\)/.test(fleet)) v.push('fleet.js が lap.crossesForwardTo を「あれば使う」形で呼んでいない');
  if (!/const prevMarshal = slots\.map\(\(s\) => s\.car\._marshal \|\| 0\);/.test(race)) v.push('race_engine が本番の開始時点の向き直しの回数を基準にしていない');
  if (!/if \(recover && m > prevMarshal\[i\]\) \{ crashCount\[i\] \+= m - prevMarshal\[i\];/.test(race)) v.push('race_engine が向き直しの増分をペナルティに数えていない');
  if (!/integrateSlot\(s, RACE_DT, othersFor\(edges, i, interact\), course\.walls, recover, slots\)/.test(race)) v.push('race_engine の本番のループが integrateSlot に全スロットを渡していない（向き直しが古い姿勢で相手を見る）');
  { const main = strip(srcs['main.js']);
    if ((main.match(/integrateSlot\(s, [^;]*, course\.walls, recover, slots\)/g) || []).length !== 2) v.push('main.js の integrateSlot の呼び出し 2 か所（integrateLive・一時停止ステップ）が全スロットを渡していない'); }
  if ((fleet.match(/\n\s+if \(others\.length % 4 === 0\) marshalCheck\(slot, walls, recover,/g) || []).length !== 1 || (fleet.match(/\n\s+marshalCheck\(slot, walls, recover,/g) || []).length !== 1) v.push('fleet.js の向き直しの呼び出しが 2 か所（integrateSlot＝他車のエッジが 4 本ずつのときだけ・integrateFleetV2）でない');
  if (!/integrateFleetV2\(\[s\], RACE_DT, course\.walls, recover, false\);\s*else integrateSlot\(s, RACE_DT, \[\], course\.walls, recover\);/.test(race)) v.push('race_engine の試走が自動復帰の設定（向き直し・切り返し）を積分に渡していない');
  return v;
}

// ════════════════════════════════════════════════════════════════════════════
const P = await loadTree(JS_DIR);
console.log(`wf_bh5_marshal — 逆走の向き直し（product: ${ROOT === HERE ? 'この木' : ROOT}・${P.config.APP_VERSION}）`);
if (!PRODUCT_ONLY) {
  console.log('\nA) 進行方向の場');
  { const v = checkA(P); report(`出荷の全コース（${checkA.info}）・添字順が逆の中心線・annulus の見分け`, v); }
  console.log('\nB) 部品の単体');
  report('5 車長で直す・働かない条件・積まない動き・切り返し中・候補の選び方・壁・フィニッシュ線・reset・公式レースのペナルティと試走', checkB(P));
}
console.log('\nC) 代表セル');
checkC(P, true);
console.log('\nD) 縮小母集団（出荷の 3 本おき × 3 エンジン × 6 台・ペナルティ復帰）');
checkD(P, true); console.log(`     ${checkD.info}`);
if (PRODUCT_ONLY) finish();

console.log('\nF) 構造');
const SRC_NAMES = ['fleet.js', 'race_engine.js', 'main.js', 'lap.js', 'capacity.js', 'race_ui.js'];
const SRCS = Object.fromEntries(SRC_NAMES.map((f) => [f, fs.readFileSync(path.join(JS_DIR, f), 'utf8')]));
report('新しい名前の名前付き import が無い・ペナルティの数え方・呼び出しが 2 か所・試走にも自動復帰の設定を渡す', structural(SRCS));

console.log('\nG) 変異（部品を 1 つずつ壊した public/js の写しで A)／B)／C)／F) のどれかが赤になるか）');
{
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf_bh5_'));
  const MUTS = [
    ['向き直しが働かない（5 車長 → 500 車長）', [['fleet.js', 'const MARSHAL_L = 5;', 'const MARSHAL_L = 500;']]],
    ['しきい値を 3 車長にする', [['fleet.js', 'const MARSHAL_L = 5;', 'const MARSHAL_L = 3;']]],
    ['向きが逆でなくても積む', [['fleet.js', 'if (!(Math.cos(car.theta - phi) < 0)) { car._wrongB = 0; return; }', 'if (false) { car._wrongB = 0; return; }']]],
    ['向きが戻っても距離を 0 に戻さない', [['fleet.js', 'if (!(Math.cos(car.theta - phi) < 0)) { car._wrongB = 0; return; }', 'if (!(Math.cos(car.theta - phi) < 0)) { return; }']]],
    ['逆へ進んだ距離の符号を逆にする', [['fleet.js', 'Math.max(0, (car._wrongB || 0) - ((car.x - px)', 'Math.max(0, (car._wrongB || 0) + ((car.x - px)']]],
    ['正味でなく道のりで積む', [['fleet.js', 'car._wrongB = Math.max(0, (car._wrongB || 0) - ((car.x - px) * Math.cos(phi) + (car.y - py) * Math.sin(phi)));', 'car._wrongB = (car._wrongB || 0) + Math.abs((car.x - px) * Math.cos(phi) + (car.y - py) * Math.sin(phi));']]],
    ['0 より下へも積む（向きが逆のまま進行方向へ動いた分が、後の逆走の貯金になる）', [['fleet.js', 'car._wrongB = Math.max(0, (car._wrongB || 0) - ((car.x - px) * Math.cos(phi) + (car.y - py) * Math.sin(phi)));', 'car._wrongB = (car._wrongB || 0) - ((car.x - px) * Math.cos(phi) + (car.y - py) * Math.sin(phi));']]],
    ['自動復帰 OFF でも働く', [['fleet.js', 'if (!df || !recover || !slot.running || car.crashed || car.held) {', 'if (!df || !slot.running || car.crashed || car.held) {']]],
    ['走行していない車でも働く', [['fleet.js', 'if (!df || !recover || !slot.running || car.crashed || car.held) {', 'if (!df || !recover || car.crashed || car.held) {']]],
    ['クラッシュした車でも働く', [['fleet.js', 'if (!df || !recover || !slot.running || car.crashed || car.held) {', 'if (!df || !recover || !slot.running || car.held) {']]],
    ['発走待ちの車でも働く', [['fleet.js', 'if (!df || !recover || !slot.running || car.crashed || car.held) {', 'if (!df || !recover || !slot.running || car.crashed) {']]],
    ['働かない条件のとき距離を 0 に戻さない', [['fleet.js', 'if (!df || !recover || !slot.running || car.crashed || car.held) { car._wrongB = 0; return; }', 'if (!df || !recover || !slot.running || car.crashed || car.held) { return; }']]],
    ['切り返し中でも直す', [['fleet.js', 'if (!(car._wrongB >= MARSHAL_L * CAR.length) || car.recoverT > 0) return;', 'if (!(car._wrongB >= MARSHAL_L * CAR.length)) return;']]],
    ['壁を見ない', [['fleet.js', 'let ok = !checkCollision(car, walls);', 'let ok = true;']]],
    ['他車を見ない', [['fleet.js', 'if (ok && polys.length) { const now = car.corners();', 'if (false) { const now = car.corners();']]],
    ['重なりを「増やさない」でなく「重ならない」で判定する', [['fleet.js', 'ok = polys.every((p, i) => !(overlapArea(now, p) > base[i] + tol));', 'ok = polys.every((p, i) => !(overlapArea(now, p) > tol));']]],
    ['候補 A（中心を保って回す）を外す', [['fleet.js', 'let done = tryPose(cx - off * Math.cos(phi), cy - off * Math.sin(phi), phi);', 'let done = false;']]],
    ['候補 B（基準点を保って回す）を外す', [['fleet.js', 'if (!done) done = tryPose(ox, oy, phi);', '']]],
    ['フィニッシュ線を順方向に越える置き直しを通す', [['fleet.js', "if (typeof slot.lap.crossesForwardTo === 'function' && slot.lap.crossesForwardTo(x, y)) return false;", '']]],
    ['走路の上にいるか（基準線の最近点まで壁を横切らずに見通せるか）を見ない', [['fleet.js', 'if (!segClearNear(cx, cy, qa[0] + _near.t * (qb[0] - qa[0]), qa[1] + _near.t * (qb[1] - qa[1]), walls)) return;', '']]],
    ['動力学・クラシックで、相手のいまの姿勢 (peers) を見ず渡された車体エッジで見る', [['fleet.js', 'if (Array.isArray(peers)) return peers.filter((o) => o !== slot && !isRetired(o)).map((o) => o.car.corners());', '']]],
    ['動力学・クラシックで、外した車も相手にする', [['fleet.js', 'if (Array.isArray(peers)) return peers.filter((o) => o !== slot && !isRetired(o)).map((o) => o.car.corners());', 'if (Array.isArray(peers)) return peers.filter((o) => o !== slot).map((o) => o.car.corners());']]],
    ['他車を相手にしない走り（others が空）でも peers を相手にする', [['fleet.js', '    if (!others.length) return [];\n', '']]],
    ['直した後の向きの条件（cos > 0.9）を外す', [['fleet.js', 'if (!(Math.cos(th - dirAt(df, x, y)) > MARSHAL_COS)) return false;', '']]],
    ['直した後に速度を残す', [['fleet.js', 'car.halt();\n  car._wrongB = 0; car._marshal', 'car._wrongB = 0; car._marshal']]],
    ['直しても距離を 0 に戻さない', [['fleet.js', 'car._wrongB = 0; car._marshal = (car._marshal || 0) + 1;', 'car._marshal = (car._marshal || 0) + 1;']]],
    ['ログを出さない', [['fleet.js', "slot.world.log(t('sim.marshal'));", '']]],
    ['annulus を、対が 1 点に集まるかを見ずに見分ける', [['fleet.js', 'if (Math.abs(ox * ey - oy * ex) > TOL * ro || Math.abs(ix * ey - iy * ex) > TOL * ro) return null;', '']]],
    ['annulus を、輪が閉じているかを見ずに見分ける', [['fleet.js', 'if (!a || !b || a.x2 !== b.x1 || a.y2 !== b.y1) return null;', 'if (!a || !b) return null;']]],
    ['annulus を、内周が外周の内側かを見ずに見分ける', [['fleet.js', 'if (!(ri > 0 && ro > ri)) return null;', '']]],
    ['annulus の見分けを外す（中心線のあるコースだけ）', [['fleet.js', 'ring = course.touge ? null : annulusMidline(course); cl = ring && ring.mid;', 'ring = null; cl = null;']]],
    ['annulus の向きを中心のまわりでなく半径の向きにする', [['fleet.js', 'a = Math.atan2(y - df.ring.cy, x - df.ring.cx) + df.ring.turn * Math.PI / 2;', 'a = Math.atan2(y - df.ring.cy, x - df.ring.cx);']]],
    ['頂点の近くで向きをなだらかにつながない（区間の向きのまま）', [['fleet.js', 'if (df.turn[vE] !== 0) a += 0.5 * df.turn[vE] * Math.max(0, Math.min(1, (3 - aE / (d * df.tanH[vE])) / 2));\n      if (df.turn[vS] !== 0) a -= 0.5 * df.turn[vS] * Math.max(0, Math.min(1, (3 - aS / (d * df.tanH[vS])) / 2));', '']]],
    ['頂点の先の区間へだけつなぐ（手前の区間へはつながない）', [['fleet.js', 'if (df.turn[vS] !== 0) a -= 0.5 * df.turn[vS] * Math.max(0, Math.min(1, (3 - aS / (d * df.tanH[vS])) / 2));', '']]],
    ['頂点から離れても向きをつなぎ続ける（重みが 0 に落ちない）', [['fleet.js', 'if (df.turn[vE] !== 0) a += 0.5 * df.turn[vE] * Math.max(0, Math.min(1, (3 - aE / (d * df.tanH[vE])) / 2));', 'if (df.turn[vE] !== 0) a += 0.5 * df.turn[vE] * Math.min(1, d * df.tanH[vE] / aE);']]],
    ['annulus の頂点の数の下限を 8 に戻す（格子に手で描ける輪に当たる）', [['fleet.js', 'const ANNULUS_MIN_N = 16;', 'const ANNULUS_MIN_N = 8;']]],
    ['annulus の半直線の刻みが等しいかを見ない', [['fleet.js', 'const ex = e0x * c - e0y * sn, ey = e0x * sn + e0y * c;', 'const rr = Math.hypot(w[i].x1 - cx, w[i].y1 - cy), ex = (w[i].x1 - cx) / rr, ey = (w[i].y1 - cy) / rr;']]],
    ['annulus では周回の向きの反転をしない', [['fleet.js', 'df.rev = dots[0] < 0;', 'df.rev = !ring && dots[0] < 0;']]],
    ['峠でも基準線の末尾と先頭をつなぐ', [['fleet.js', 'const n = cl.length, nSeg = course.touge ? n - 1 : n;\n  const closed = !course.touge;', 'const n = cl.length, nSeg = n;\n  const closed = true;']]],
    ['「向きが逆」の境目を cos < 0.5 にする', [['fleet.js', 'if (!(Math.cos(car.theta - phi) < 0)) { car._wrongB = 0; return; }', 'if (!(Math.cos(car.theta - phi) < 0.5)) { car._wrongB = 0; return; }']]],
    ['「向きが逆」の境目を cos < −0.3 にする', [['fleet.js', 'if (!(Math.cos(car.theta - phi) < 0)) { car._wrongB = 0; return; }', 'if (!(Math.cos(car.theta - phi) < -0.3)) { car._wrongB = 0; return; }']]],
    ['しきい値が車体の寸法に追従しない（0.19 m 固定）', [['fleet.js', 'if (!(car._wrongB >= MARSHAL_L * CAR.length) || car.recoverT > 0) return;', 'if (!(car._wrongB >= MARSHAL_L * 0.19) || car.recoverT > 0) return;']]],
    ['精密 v2 で、他車を障害物にしない走りでも他車を相手にする', [['fleet.js', '() => (interact && !isRetired(slot)', '() => (!isRetired(slot)']]],
    ['精密 v2 で、向き直しをラップ計測の後に呼ぶ', [['fleet.js', "    marshalCheck(slot, walls, recover, mprev[k][0], mprev[k][1], () => (interact && !isRetired(slot)\n      ? slots.filter((o) => o !== slot && !isRetired(o)).map((o) => o.car.corners()) : []));\n    const lapped = slot.lap.update(dt, car.x, car.y, slot.running && !car.crashed);", "    const lapped = slot.lap.update(dt, car.x, car.y, slot.running && !car.crashed);\n    marshalCheck(slot, walls, recover, mprev[k][0], mprev[k][1], () => (interact && !isRetired(slot)\n      ? slots.filter((o) => o !== slot && !isRetired(o)).map((o) => o.car.corners()) : []));"]]],
    ['直した後の向きの下限を cos 0.5 にする', [['fleet.js', 'const MARSHAL_COS = 0.9;', 'const MARSHAL_COS = 0.5;']]],
    ['向きを直しても STUCK の窓を消さない', [['fleet.js', 'car._ccOn = false; car._stuckT = 0;   // 車どうしの', '// 車どうしの']]],
    ['レポートの向き直しの回数が常に 0', [['race_engine.js', 'marshalCount: marshalCount[i],', 'marshalCount: 0,']], 'R'],
    ['公式レースで向き直しを 1 台につき最初の 1 回しか数えない', [['race_engine.js', 'if (recover && m > prevMarshal[i]) { crashCount[i] += m - prevMarshal[i]; marshalCount[i] += m - prevMarshal[i]; }', 'if (recover && m > prevMarshal[i]) { crashCount[i] += (marshalCount[i] === 0 ? 1 : 0); marshalCount[i] += m - prevMarshal[i]; }']], 'R'],
    ['lap.crossesForwardTo が update の前に真を返す', [['lap.js', 'if (!this.finish || this.prev == null) return false;', 'if (!this.finish) return false; if (this.prev == null) return true;']]],
    ['annulus の回る向きを添字順と逆にする', [['fleet.js', 'a = Math.atan2(y - df.ring.cy, x - df.ring.cx) + df.ring.turn * Math.PI / 2;', 'a = Math.atan2(y - df.ring.cy, x - df.ring.cx) - df.ring.turn * Math.PI / 2;']]],
    ['基準線の添字順が逆でも反転しない', [['fleet.js', 'df.rev = dots[0] < 0;', 'df.rev = false;']]],
    ['基準線の添字順の向きを、フィニッシュ線の法線でなく正方向そのもので決める', [['fleet.js', 'if (across < 0) { nx = -nx; ny = -ny; }', 'nx = f.fx / fl; ny = f.fy / fl;']]],
    ['向きを決める内積の下限を 0.6 にする', [['fleet.js', 'if (!dots.every((d) => Math.abs(d) > 0.3 && (d < 0) === (dots[0] < 0))) return null;', 'if (!dots.every((d) => Math.abs(d) > 0.6 && (d < 0) === (dots[0] < 0))) return null;']]],
    ['フィニッシュ線が基準線と平行でも場を作る', [['fleet.js', 'if (!dots.every((d) => Math.abs(d) > 0.3 && (d < 0) === (dots[0] < 0))) return null;', '']]],
    ['正方向がフィニッシュ線と平行でも場を作る', [['fleet.js', 'if (!(Math.abs(across) > 1e-4)) return null;', '']]],
    ['長さ 0 の区間がある中心線でも場を作る', [['fleet.js', 'if (!(len[i] > 1e-9)) return null;', '']]],
    ['rebuildSpawns が進行方向の場を更新しない', [['fleet.js', '    s._dirF = dirF;\n', '']]],
    ['makeSlot が進行方向の場を持たせない', [['fleet.js', 'slot._dirF = dirFrame(course);', 'slot._dirF = null;']]],
    ['動力学・クラシックの経路で呼ばない', [['fleet.js', 'if (others.length % 4 === 0) marshalCheck(slot, walls, recover, mpx, mpy, () => {', 'if (false) marshalCheck(slot, walls, recover, mpx, mpy, () => {']]],
    ['精密 v2 の経路で呼ばない', [['fleet.js', 'marshalCheck(slot, walls, recover, mprev[k][0], mprev[k][1], () => (interact && !isRetired(slot)', 'if (false) marshalCheck(slot, walls, recover, mprev[k][0], mprev[k][1], () => (interact && !isRetired(slot)']]],
    ['精密 v2 で他車を見ない', [['fleet.js', '? slots.filter((o) => o !== slot && !isRetired(o)).map((o) => o.car.corners()) : []));', '? [] : []));']]],
    ['精密 v2 で外した車も相手にする', [['fleet.js', 'slots.filter((o) => o !== slot && !isRetired(o)).map((o) => o.car.corners())', 'slots.filter((o) => o !== slot).map((o) => o.car.corners())']]],
    ['距離の積算の起点を呼び出しの後の位置にする（動力学・クラシック）', [['fleet.js', 'const mpx = car.x, mpy = car.y;   // BH5', 'let mpx = car.x, mpy = car.y; Promise.resolve().then(() => {}); mpx = NaN;   // BH5']]],
    ['公式レースで向き直しをペナルティに数えない', [['race_engine.js', 'if (recover && m > prevMarshal[i]) { crashCount[i] += m - prevMarshal[i]; marshalCount[i] += m - prevMarshal[i]; }', 'if (false) { crashCount[i] += m - prevMarshal[i]; }']], 'R'],
    ['公式レースで向き直しを 2 回ぶん数える', [['race_engine.js', 'if (recover && m > prevMarshal[i]) { crashCount[i] += m - prevMarshal[i];', 'if (recover && m > prevMarshal[i]) { crashCount[i] += 2 * (m - prevMarshal[i]);']], 'R'],
    ['試走の向き直しを本番のペナルティに数える（reset で消さず・本番の開始時点を基準にしない）', [['race_engine.js', 'const prevMarshal = slots.map((s) => s.car._marshal || 0);', 'const prevMarshal = new Array(n).fill(0);'], ['physics.js', 'this._wrongB = 0; this._marshal = 0;', 'this._wrongB = 0;'], ['physics_dyn.js', 'this._wrongB = 0; this._marshal = 0;', 'this._wrongB = 0;']], 'R'],
    ['Car.reset（クラシック）で距離と回数を消さない', [['physics.js', 'this._wrongB = 0; this._marshal = 0;', '']]],
    ['DynCar.reset（動力学・精密 v2）で距離と回数を消さない', [['physics_dyn.js', 'this._wrongB = 0; this._marshal = 0;', '']]],
    ['向きが逆のあいだ、進行方向へ動いた分を引かない（逆へ動いた分だけ積む）', [['fleet.js', 'car._wrongB = Math.max(0, (car._wrongB || 0) - ((car.x - px) * Math.cos(phi) + (car.y - py) * Math.sin(phi)));', 'car._wrongB = (car._wrongB || 0) + Math.max(0, -((car.x - px) * Math.cos(phi) + (car.y - py) * Math.sin(phi)));']]],
    ['開いた基準線（峠）の両端にも折れ角を持たせる', [['fleet.js', '    if (!closed && (v === 0 || v >= nSeg)) continue;\n', '']]],
    ['向きの決め方: 最近点が頂点でも片側の区間しか見ない', [['fleet.js', 'if (t * len[i] <= 1e-6 && (closed || i > 0)) at((i - 1 + nSeg) % nSeg);', ''], ['fleet.js', 'if ((1 - t) * len[i] <= 1e-6 && (closed || i < nSeg - 1)) at((i + 1) % nSeg);', '']]],
    ['向きの決め方: 頂点に集まる 2 区間の符号がそろっているかを見ない', [['fleet.js', 'Math.abs(d) > 0.3 && (d < 0) === (dots[0] < 0)', 'Math.abs(d) > 0.3']]],
    ['向きの決め方: 内積の下限を 0.3 → 0.1 にする', [['fleet.js', 'Math.abs(d) > 0.3 && (d < 0) === (dots[0] < 0)', 'Math.abs(d) > 0.1 && (d < 0) === (dots[0] < 0)']]],
    ['折れ角が 150° を超える頂点があっても場を作る', [['fleet.js', '    if (Math.abs(a) > 5 * Math.PI / 6) return null;\n', '']]],
    ['折れ角の上限を 150° → 130° にする', [['fleet.js', 'if (Math.abs(a) > 5 * Math.PI / 6) return null;', 'if (Math.abs(a) > 130 * Math.PI / 180) return null;']]],
    ['切り返し中は 0 で下げ止めない（切り返しの後退が貯金に戻る）', [['fleet.js', 'car._wrongB = Math.max(0, (car._wrongB || 0) - (', 'car._wrongB = Math.max(car.recoverT > 0 ? -Infinity : 0, (car._wrongB || 0) - (']]],
    ['向きを直した後 3 秒は距離を積まない', [['fleet.js', 'car._wrongB = 0; car._marshal = (car._marshal || 0) + 1;', 'car._wrongB = 0; car._mN = 180; car._marshal = (car._marshal || 0) + 1;'], ['fleet.js', '  const phi = dirAt(df, car.x, car.y);\n  if (!(Math.cos(car.theta - phi) < 0)) { car._wrongB = 0; return; }', '  if (car._mN > 0) { car._mN--; car._wrongB = 0; return; }\n  const phi = dirAt(df, car.x, car.y);\n  if (!(Math.cos(car.theta - phi) < 0)) { car._wrongB = 0; return; }']]],
    ['他車のエッジが 4 本ずつでなくても向き直しを呼ぶ', [['fleet.js', 'if (others.length % 4 === 0) marshalCheck(slot, walls, recover,', 'marshalCheck(slot, walls, recover,']]],
    ['走路の上にいるかの見通しを、車体の中心でなく基準点から引く', [['fleet.js', 'if (!segClearNear(cx, cy, qa[0]', 'if (!segClearNear(ox, oy, qa[0]']]],
    ['annulus では走路の上にいるかを見ない', [['fleet.js', 'if (!segClearNear(cx, cy, qa[0]', 'if (!df.ring && !segClearNear(cx, cy, qa[0]']]],
    ['諦め（gaveUp）中の車は向きを直さない', [['fleet.js', 'if (!df || !recover || !slot.running || car.crashed || car.held) {', 'if (!df || !recover || !slot.running || car.crashed || car.held || car.gaveUp) {']]],
    ['向きを直したら切り返しの回数と諦めの状態も消す', [['fleet.js', 'car._ccOn = false; car._stuckT = 0;', 'car._ccOn = false; car._stuckT = 0; car.recoverN = 0; car.gaveUp = false;']]],
    ['候補 A の向きを、回した後の基準点での進行方向にする', [['fleet.js', 'let done = tryPose(cx - off * Math.cos(phi), cy - off * Math.sin(phi), phi);', 'const phiA = dirAt(df, cx - off * Math.cos(phi), cy - off * Math.sin(phi)); let done = tryPose(cx - off * Math.cos(phiA), cy - off * Math.sin(phiA), phiA);']]],
    ['逆へ進んだ距離を、進行方向でなく車体の向きの逆への射影で測る', [['fleet.js', '- ((car.x - px) * Math.cos(phi) + (car.y - py) * Math.sin(phi)));', '+ ((car.x - px) * Math.cos(car.theta) + (car.y - py) * Math.sin(car.theta)));']]],
    ['lap.crossesForwardTo が線の先 1 mm までを「越えない」と答える', [['lap.js', 'return !Number.isFinite(s) || (this.prev.s < 0 && !(s < 0));', 'return !Number.isFinite(s) || (this.prev.s < 0 && !(s < 0.001));']]],
    ['試走で自動復帰（向き直し・切り返し）を働かせない', [['race_engine.js', 'integrateFleetV2([s], RACE_DT, course.walls, recover, false);', 'integrateFleetV2([s], RACE_DT, course.walls, false, false);'], ['race_engine.js', 'else integrateSlot(s, RACE_DT, [], course.walls, recover);', 'else integrateSlot(s, RACE_DT, [], course.walls, false);']], 'R'],
    ['lap.crossesForwardTo が常に偽を返す', [['lap.js', 'return !Number.isFinite(s) || (this.prev.s < 0 && !(s < 0));', 'return false;']]],
    ['lap.crossesForwardTo が逆方向の越えを答える', [['lap.js', 'return !Number.isFinite(s) || (this.prev.s < 0 && !(s < 0));', 'return !Number.isFinite(s) || (!(this.prev.s < 0) && s < 0);']]],
  ];
  // 変異していない木の失敗（あれば）は赤に数えない＝変異そのものが作った失敗だけを見る
  const base = { a: new Set(checkA(P)), b: new Set(checkB(P)) };
  ok(base.a.size === 0 && base.b.size === 0, `変異していない木で A)・B) が緑（赤が残っていると、変異の検出を取り違える）`);
  let mi = 0; const miss = [], noop = [];
  try {
    for (const [label, edits, where] of MUTS) {
      const dir = path.join(tmpRoot, 'm' + (mi++));
      fs.cpSync(JS_DIR, dir, { recursive: true });
      let applied = true;
      for (const [file, from, to] of edits) {
        const fp = path.join(dir, file), src = fs.readFileSync(fp, 'utf8');
        if (!src.includes(from)) { applied = false; break; }
        fs.writeFileSync(fp, src.replace(from, to));
      }
      if (!applied) { noop.push(label); continue; }
      const M = await loadTree(dir);
      const red = [];
      let a = [], b = [], c = [];
      try { a = checkA(M).filter((x) => !base.a.has(x)); } catch (e) { a = ['例外 ' + e.message]; }
      try { b = checkB(M, { races: where === 'R' }).filter((x) => !base.b.has(x)); } catch (e) { b = ['例外 ' + e.message]; }   // 公式レースの章 (B11) は race_engine に関わる変異だけ
      if (a.length) red.push(`A) ${a.length}`); if (b.length) red.push(`B) ${b.length}`);
      if (!red.length) { try { c = checkC(M, false); } catch (e) { c = ['例外 ' + e.message]; } if (c.length) red.push(`C) ${c.length}`); }
      if (!red.length) { const f2 = structural(Object.fromEntries(SRC_NAMES.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]))); if (f2.length) red.push(`F) ${f2.length}`); }
      if (!red.length) miss.push(label); else console.log(`     ✓ ${label} → ${red.join('・')} 件で赤`);
    }
  } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
  report(`変異 ${MUTS.length} 件のうち見逃し`, miss);
  report('適用できなかった変異（パターンが実装とずれた）', noop);
}
finish();
function finish() {
  console.log(`\n${fail === 0 ? '────────── BH5 逆走の向き直しゲート: 全パス ○ ──────────' : `────────── BH5 ゲート: ✗ ${fail} 件 NG ──────────`}（所要 ${((Date.now() - T0) / 1000).toFixed(1)} 秒）`);
  process.exit(fail === 0 ? 0 : 1);
}
