// wf_bh3_laps.mjs — Stage BH3 常設ゲート: 周回の数え方（借りで数える＝順方向へ回り切った数を超えたときだけ）を固定する。
// ════════════════════════════════════════════════════════════════════════════
// 背景（BH2 実測・2026-10-04）: v9.0.0 までの lap.js は「武装していて・フィニッシュ線を負側→正側へ・線分の中を通った」だけで
//   1 周と数え、その間にコースを回ったかを見ていなかった。∴ 逆向きに線を戻ってもう一度通ると、回っていなくても 1 周になった:
//   線の前後を往復するだけのプログラムが公式レース 3 周を 10.5 秒で完走・出荷の公式サンプル大会の 1 位は 1 周していなかった。
//   BH3 の着手前の実測でさらに 2 つ: 出荷「トライアングル」は線分と正方向が 60° ずれていて正しく回っても 1 周も数えられない／
//   小さいコースの内側の線では武装距離に届かず数え漏れる。改修は lap.js だけ（数え方の全体は lap.js の【BH3】の注記）。
//
// 測定（オラクル）は 2 つ。どちらも車の位置だけを見て、product の lap.js を呼ばない。
//   ①線分の通過: フィニッシュ線分の通過を **線分の法線** で数える（交差の判定は幾何の部品 geom.segIntersect）。巻き数 w =
//     順方向の通過 − 逆方向の通過 − 発走の通過（線の手前から出た車は 1）。wMax = それまでの w の最大 = 順方向へ回り切った周回の数。
//     主張は「数えた周回 ≤ wMax（回り切っていない計上が無い）」と「走行中のどの tick でも 数えた周回 = wMax（数え漏れが無い。
//     回り切った tick に数える＝後の踏み直しまで遅れない）」。発走の規約（線の手前なら最初の通過は発走）は product と同じ。
//   ②角度の積算（D3）: 島の中心まわりの角度を積算し、フィニッシュ線の方位を何回順方向に越えたかを数える。segIntersect も
//     線分の側の式も使わない（①と部品を共有しない）。
//
// 検査:
//   A) 単体（治具のコースに軌跡を与える）: 線の上／手前／先からの発走・踏み直し・逆 1〜3 周・線分の端と壁の車幅以下のすき間
//      （後退で抜けて通り直しても数えない・発走の通過がすき間を通っても 1 周目が遅れない・寸法は通過の時点の実効寸法）・線の横の
//      通路（発走の通過が通っても遅れない・回り込む走りは従来どおり 1 周）・線に触れる壁と線を横切る壁（弦を切る・別の弦を初めて
//      通る周も遅れない）・ヘアピンのコース（仕切りの先端のそばに引いた線で、戻りの走路の通過を借りにしない）・線分が壁を突き抜けた先の廊下・
//      直交しない線分・武装距離に届かない小さいコース・峠（1 回のゴール＝変えない）・走行していない間（完走後の惰行）は数えない・
//      数えた周回は減らない・ラップタイム・縮退した入力で投げない・弦の区切り位置（白箱）・限界として固定するもの（壁の端や
//      線分の端のまわりを回る走り／向かいの廊下まで届く線分での逆走／2 本の走路を 1 つの弦でまたぐ線／通路を抜けた後に残る
//      借り／線の横を通り抜けた後の踏み直し）と規約 1 つ（線の先から発走した車の最初の通過は 1 周目）。
//   F) 出荷の全周回コース＋投稿コースの写し: 側の判定（_signed）が直交するコースでは fx,fy の式とビット一致・中点の往復は
//      0 周・線の外を回って戻れば 1 周・線分の端の壁の向こうで線の延長を横切っても借りは返らない。
//   B) 往復するだけのプログラム（公式レース runRace・スピードウェイ／ロングオーバル × 3 エンジン）: 0 周（改修前は 3 周完走）。
//   C) 出荷の公式サンプル大会: どの車も回り切っていない計上・数え漏れが無い。巻き数 0 の車（Circuit-FR）が完走に入らないことは、
//      同じ大会を「進行方向の分からない同じ形のコース」（中心線を落とした写し）で走らせて見る（【BH5】の注記）。
//   D) 代表セル（四角の中の丸・動力学・6 台・ペナルティ復帰）: 回り切っていない計上も数え漏れも無い（改修前は巻き数 0 の車が
//      2 位完走）。D3) 同じセルを角度の積算で測っても一致。
//      D5) オーバル（動力学・6 台）: 多くの車が周回を重ねるセルで、測定①②とも毎 tick 一致。
//      D4) モダン・レイアウト（クラシック・3 台）: フィニッシュ線分の内側の端が、折り返した内壁の頂点（壁が線の片側から触れる
//          だけ）で、その先の線の延長を手前の区間が横切る。手前の区間の通過で借りが返らない（＝逆走した車を数えない）。
//          逆走する車が要るので、中心線を落とした写しで走らせる（【BH5】の注記）。出荷のコースそのものでも数え方が合うことを併せて見る。
// 【BH5・2026-10-05】逆走の向き直し（fleet.js marshalCheck）で、ペナルティ復帰の公式レースでは逆走が 5 車長で止まるようになった。
//   C) と D4) は「逆走した車がいる走り」を材料にしていたので、**向き直しが働かない同じ形のコース**（course.centerline を落とした写し＝
//   エディタで開いて適用したコースと同じ・壁もフィニッシュ線も同じ）で走らせる。この写しの走りは BH3 の時点と 1 ビットも変わらない
//   （公式サンプルは verifyHash cb6afdeb のまま＝下で固定）。数え方（lap.js）の検査の中身は変えていない。
//      D2) 小さいコース（舵角限界ベンチ・道幅 3.5 台分・1 台）: 回り切った tick に数える（改修前は武装距離に届かず遅れて数えた）。
//   E) トライアングル（C 版 Apex Hunter・クラシック・1 台）: 完走し、数えた周回が測定①と一致（改修前は 0 周）。
//   H) ライブの ▶ 走行の練習ベスト（localStorage の rumicar.practiceShape.*）: 往復するだけのプログラムでは 1 件も書かれない
//      （改修前は 3 秒台の「ベストラップ」が書かれた）。対照: 普通に 1 周すればその周のタイムが書かれる。
//   G) 変異試験: lap.js の部品を 1 つずつ壊した写し（一時ツリー）で A)／F) が赤になること。
//
// 使い方: node wf_bh3_laps.mjs              … 検査
//         node wf_bh3_laps.mjs --root <dir>  … <dir>/public/js の product で G) 以外を回す（改修前ツリーで赤になることの確認用）
//         node wf_bh3_laps.mjs --root <dir> --mutate … <dir> の lap.js に変異を入れて G) も回す
// exit: 0=全緑 / 1=いずれか赤。
// ════════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { loadMods, liveSetup, liveFrame } from './wf_bg_live.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rootIdx = process.argv.indexOf('--root');
const ROOT = rootIdx >= 0 ? path.resolve(process.argv[rootIdx + 1]) : HERE;
const RUN_MUT = rootIdx < 0 || process.argv.includes('--mutate');
const JS_DIR = path.join(ROOT, 'public/js');
const T0 = Date.now();

// localStorage（Map 1 つ）。H) がライブの練習ベストの読み書きを見るためだけに使う（ほかの章は persist:false で触れない）。
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); },
  key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; },
};

let fail = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? '○' : '✗'} ${msg}`); if (!cond) fail++; return cond; };
const report = (label, v) => ok(v.length === 0, `${label}${v.length ? `: ${v.length} 件 — ${v.slice(0, 4).join(' ／ ')}${v.length > 4 ? ` … ほか ${v.length - 4} 件` : ''}` : ''}`);

async function loadTree(jsDir) {
  const u = (f) => pathToFileURL(path.join(jsDir, f)).href;
  const M = await loadMods(jsDir);
  [M.lap, M.geom, M.raceEvent] = await Promise.all(['lap.js', 'geom.js', 'race_event.js'].map((f) => import(u(f))));
  return M;
}

const SPECS = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/courses.json'), 'utf8'));
const FIG8 = JSON.parse(fs.readFileSync(path.join(HERE, 'wf_bg2_fig8_course.json'), 'utf8'));   // 上流の投稿コースの写し（BG2）
const SAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/phase_w/official_sample_event.json'), 'utf8'));

// ── 治具 ────────────────────────────────────────────────────────────────────────
const rect = (x1, y1, x2, y2) => [{ x1, y1, x2, y2: y1 }, { x1: x2, y1, x2, y2 }, { x1: x2, y1: y2, x2: x1, y2 }, { x1, y1: y2, x2: x1, y2: y1 }];
// 四角い周回の廊下（外周 W×H・廊下の幅 m）。順方向は反時計回り（下の廊下を +x へ）。
const ring = (finish, { W = 4, H = 3, m = 1, extra = [], ...rest } = {}) => ({
  name: '治具', walls: [...rect(0, 0, W, H), ...rect(m, m, W - m, H - m), ...extra], bounds: { w: W, h: H },
  start: { x: 1.7, y: 0.5, theta: 0 }, finish: { fx: 1, fy: 0, ...finish }, ...rest,
});
// 下の廊下の (x0, y0) から反時計回りに 1 周して (x1, y1) へ（下の廊下は高さ yb を走る）。
const loop = (x0, x1, yb = 0.5, { W = 4, H = 3, m = 1, y0 = yb, y1 = yb } = {}) =>
  [[x0, y0], [x0, yb], [W - m / 2, yb], [W - m / 2, H - m / 2], [m / 2, H - m / 2], [m / 2, y1], [x1, y1]];
const rev = (pts) => pts.slice().reverse();

// 折れ線 pts を step ごとに刻んで LapTracker に与える（最初の呼び出しの先頭の点が基準点）。数えた周回が減ったら記録する。
// 刻みは区間を等分した点から半端 (PHI) だけ手前へずらす: 等分のままだと標本がフィニッシュ線のちょうど上に乗り、lap.js の
// 「側の符号」と「線分との交差」（別の式）が最下位ビットで食い違う通過を治具が自分で作ってしまう（実走では起きない並び）。
const PHI = 0.3819660112501051;
function driver(M, course, opts = {}) {
  const tr = new M.lap.LapTracker(course, { persist: false, ...opts });
  const st = { tr, started: false, updates: 0, decreased: 0, x: null, y: null };
  st.go = (pts, { running = true, step = 0.02, dt = 1 / 60 } = {}) => {
    let n = 0;
    const put = (x, y, d) => { const b = tr.laps; if (tr.update(d, x, y, running)) n++; st.updates++; if (tr.laps < b) st.decreased++; st.x = x; st.y = y; };
    if (!st.started) { put(pts[0][0], pts[0][1], 0); st.started = true; }
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], x0 = st.x, y0 = st.y, k = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      if (x1 === x0 && y1 === y0) continue;
      for (let j = 1; j <= k; j++) put(x0 + (x1 - x0) * (j - PHI) / k, y0 + (y1 - y0) * (j - PHI) / k, dt);
      put(x1, y1, dt);
    }
    return n;
  };
  return st;
}

// ── A) 単体 ─────────────────────────────────────────────────────────────────────
function checkA(M) {
  const v = [];
  const eq = (got, want, what) => { if (got !== want) v.push(`${what}: ${got}（期待 ${want}）`); };
  const guard = (what, fn) => { try { fn(); } catch (e) { v.push(`${what}: 例外 ${String(e && e.message || e).slice(0, 80)}`); } };
  const FULL = { x1: 1.5, y1: 0, x2: 1.5, y2: 1 };   // 壁から壁まで塞ぐ線分
  const L = M.config.CAR.length;
  if (!(Math.abs(L - 0.19) < 1e-12)) v.push(`治具の前提: 車長 ${L}（卓上・倍率 1 の 0.19 を想定）`);

  guard('A1 発走', () => {
    let d = driver(M, ring(FULL));
    d.go([[1.3, 0.5], [1.7, 0.5]]); eq(d.tr.laps, 0, 'A1 線の手前から発走: 発走の通過は数えない');
    eq(d.go(loop(1.7, 1.7)), 1, 'A1 線の手前から発走: 1 周目の計上の回数'); eq(d.tr.laps, 1, 'A1 線の手前から発走: 1 周して 1');
    if (!(Math.abs(d.tr.lastLap + d.tr.lapTime - d.tr.totalTime) < 1e-9)) v.push(`A1 線の手前から発走した車の 1 周目のラップタイム ${d.tr.lastLap}＋計上後 ${d.tr.lapTime} が発走からの累計 ${d.tr.totalTime} と違う（発走の通過で計時を戻している）`);
    d.go(loop(1.7, 1.7)); eq(d.tr.laps, 2, 'A1 線の手前から発走: 2 周して 2');
    const lap2 = d.tr.lastLap;
    d.go(loop(1.7, 1.7)); eq(d.tr.laps, 3, 'A1 線の手前から発走: 3 周して 3');
    if (!(Math.abs(d.tr.lastLap - lap2) < 1e-9 && lap2 > 5)) v.push(`A1 同じ 1 周のラップタイムが 2 周目 ${lap2}・3 周目 ${d.tr.lastLap}（計上のたびに計時を 0 へ戻していない）`);
    d = driver(M, ring(FULL)); d.go([[1.495, 0.5], [1.7, 0.5]]); eq(d.tr.laps, 0, 'A1 線の 5 mm 手前から発走: 発走の通過は数えない'); d.go(loop(1.7, 1.7)); eq(d.tr.laps, 1, 'A1 同: 1 周して 1');
    d = driver(M, ring(FULL)); d.go(loop(1.5, 1.7)); eq(d.tr.laps, 1, 'A1 線の上から発走: 1 周して 1'); d.go(loop(1.7, 1.7)); eq(d.tr.laps, 2, 'A1 線の上から発走: 2 周して 2');
    d = driver(M, ring(FULL)); d.go(loop(1.7, 1.7)); eq(d.tr.laps, 1, 'A1 線の先から発走: 1 周して 1');
    d = driver(M, ring(FULL)); d.go(loop(2.6, 2.6)); eq(d.tr.laps, 1, 'A1 規約: 線の 1.1 m 先から発走した車も、最初の通過を 1 周目と数える（v9.0.0 までと同じ）');
    d = driver(M, ring(FULL)); d.go([[1.3, 0.5], [1.1, 0.5], [1.7, 0.5]]); eq(d.tr.laps, 0, 'A1 手前から発走し少し下がってから発進: 0'); d.go(loop(1.7, 1.7)); eq(d.tr.laps, 1, 'A1 同: 1 周して 1');
    d = driver(M, ring(FULL)); d.go([[1.5, 0.5], [1.4, 0.5], [1.7, 0.5]]); eq(d.tr.laps, 0, 'A1 線の上から発走し下がって線を踏み直す: 0'); d.go(loop(1.7, 1.7)); eq(d.tr.laps, 1, 'A1 同: 1 周して 1');
  });

  guard('A2 踏み直し', () => {
    const d = driver(M, ring(FULL));
    d.go(loop(1.7, 1.9)); eq(d.tr.laps, 1, 'A2 1 周して 1');
    const lap1 = d.tr.lastLap;
    for (let i = 0; i < 5; i++) d.go([[1.9, 0.5], [1.2, 0.5], [1.9, 0.5]]);
    eq(d.tr.laps, 1, 'A2 線の前後を 5 往復（線の先へ 0.4 m 離れてから戻る）しても 1 のまま');
    d.go(loop(1.9, 1.9)); eq(d.tr.laps, 2, 'A2 往復の後に 1 周して 2');
    if (!(d.tr.lastLap > lap1 + 5)) v.push(`A2 2 周目のラップタイム ${d.tr.lastLap} が往復の時間を含んでいない（1 周目 ${lap1}）`);
    eq(d.decreased, 0, 'A2 数えた周回が減った回数');
  });

  guard('A3 逆走', () => {
    let d = driver(M, ring(FULL));
    d.go(loop(1.7, 1.7)); eq(d.tr.laps, 1, 'A3 1 周して 1');
    d.go(rev(loop(1.7, 1.7))); eq(d.tr.laps, 1, 'A3 逆向きに 1 周しても 1 のまま（減らない）');
    d.go(loop(1.7, 1.7)); eq(d.tr.laps, 1, 'A3 逆 1 周の後の順方向の 1 周は元へ戻るだけ（1 のまま）');
    d.go(loop(1.7, 1.7)); eq(d.tr.laps, 2, 'A3 その次の 1 周で 2');
    eq(d.decreased, 0, 'A3 数えた周回が減った回数');
    d = driver(M, ring(FULL));
    d.go(loop(1.7, 1.7)); d.go(rev(loop(1.7, 1.7))); d.go(rev(loop(1.7, 1.7))); eq(d.tr.laps, 1, 'A3 逆向きに 2 周: 1 のまま');
    d.go(loop(1.7, 1.7)); d.go(loop(1.7, 1.7)); eq(d.tr.laps, 1, 'A3 逆 2 周の後の順方向の 2 周は元へ戻るだけ（借りは 2 まで積もる）');
    d.go(loop(1.7, 1.7)); eq(d.tr.laps, 2, 'A3 その次の 1 周で 2');
    d = driver(M, ring(FULL));
    d.go(loop(1.7, 1.7)); for (let i = 0; i < 3; i++) d.go(rev(loop(1.7, 1.7)));
    for (let i = 0; i < 3; i++) d.go(loop(1.7, 1.7)); eq(d.tr.laps, 1, 'A3 逆 3 周の後の順方向の 3 周は元へ戻るだけ（借りは 3 まで積もる）');
    d.go(loop(1.7, 1.7)); eq(d.tr.laps, 2, 'A3 その次の 1 周で 2');
  });

  guard('A4 すき間・通路', () => {
    const GAP = { x1: 1.5, y1: 0.06, x2: 1.5, y2: 1 };   // 外の壁との間に 0.06 m のすき間（車幅 0.08 以下＝車は通り抜けられない）
    let d = driver(M, ring(GAP));
    d.go(loop(1.7, 1.9)); eq(d.tr.laps, 1, 'A4 すき間: 1 周して 1');
    d.go([[1.9, 0.5], [1.9, 0.03], [1.2, 0.03], [1.2, 0.5], [1.9, 0.5]]); eq(d.tr.laps, 1, 'A4 すき間を後退で抜けて線分を通り直しても 1 のまま');
    d.go(loop(1.9, 1.9)); eq(d.tr.laps, 2, 'A4 すき間: その後の 1 周で 2');
    d = driver(M, ring(GAP));
    d.go([[1.3, 0.03], [1.7, 0.03]]); eq(d.tr.laps, 0, 'A4 発走の通過がすき間を通る: 0');
    d.go(loop(1.7, 1.7, 0.5, { y0: 0.03 })); eq(d.tr.laps, 1, 'A4 発走の通過がすき間を通っても 1 周目が遅れない');
    d = driver(M, ring(GAP));
    d.go(loop(1.7, 1.7, 0.5, { y1: 0.03 })); eq(d.tr.laps, 0, 'A4 順方向にすき間を通った周は数えない（線分の中を通っていない＝従来どおり）');
    d.go(loop(1.7, 1.7, 0.5, { y0: 0.03 })); eq(d.tr.laps, 1, 'A4 その次に線分の中を通って 1（2 にはしない）');
    d = driver(M, ring(GAP));
    d.go(loop(1.7, 1.9)); d.go([[1.9, 0.5], [1.2, 0.5], [1.2, 0.03], [1.9, 0.03]]); d.go(loop(1.9, 1.9, 0.5, { y0: 0.03 }));
    eq(d.tr.laps, 2, 'A4 線分を逆向きに通った借りは、順方向にすき間を通っても返る（その後の 1 周を数える）');
    // 車幅 0.08 m の境目: すき間 0.07 m は線の一部（後退で抜けて通り直しても数えない）・0.09 m は通路（線分の端を回る走り＝1 周）
    const through = (gap) => [[1.9, 0.5], [1.9, gap / 2], [1.2, gap / 2], [1.2, 0.5], [1.9, 0.5]];
    for (const [gap, want] of [[0.07, 1], [0.09, 2]]) {
      d = driver(M, ring({ x1: 1.5, y1: gap, x2: 1.5, y2: 1 })); d.go(loop(1.7, 1.9)); d.go(through(gap));
      eq(d.tr.laps, want, `A4 すき間 ${gap} m（車幅 0.08）を後退で抜けて通り直す`);
    }
    // 寸法は通過の時点の実効寸法（車体 0.5× なら車幅 0.04: すき間 0.07 m は通路）。走行の途中で倍率を変えても追従する。
    d = driver(M, ring({ x1: 1.5, y1: 0.07, x2: 1.5, y2: 1 })); d.go(loop(1.7, 1.9)); d.go(through(0.07)); eq(d.tr.laps, 1, 'A4 車体 1×: すき間 0.07 m を後退で抜けて通り直しても 1 のまま');
    M.config.setCarScale(0.5);
    try {
      d.go(loop(1.9, 1.9)); d.go(through(0.07)); eq(d.tr.laps, 3, 'A4 走行の途中で車体 0.5× にすると（車幅 0.04）、同じすき間は通路＝2 周目の後に 3');
      d = driver(M, ring({ x1: 1.5, y1: 0.07, x2: 1.5, y2: 1 })); d.go(loop(1.7, 1.9)); d.go(through(0.07)); eq(d.tr.laps, 2, 'A4 車体 0.5× で始めても同じ（すき間 0.07 m は通路）');
    } finally { M.config.setCarScale(1); }
    // 線の横に幅 0.5 m の通路: 発走の通過が通路を通っても遅れない・通路を戻って線分の端を回る走りは従来どおり 1 周
    const LANE = { x1: 1.5, y1: 0.5, x2: 1.5, y2: 1 };
    d = driver(M, ring(LANE));
    d.go([[1.3, 0.25], [1.7, 0.25]]); d.go(loop(1.7, 1.9, 0.75, { y0: 0.25 })); eq(d.tr.laps, 1, 'A4 発走の通過が線の横の通路を通っても 1 周目が遅れない');
    d.go([[1.9, 0.75], [1.9, 0.2], [1.2, 0.2], [1.2, 0.75], [1.9, 0.75]]); eq(d.tr.laps, 2, 'A4 線の横の通路を戻って線分の端を回り込む走りは従来どおり 1 周');
    d.go([[1.9, 0.75], [1.2, 0.75], [1.9, 0.75]]); eq(d.tr.laps, 2, 'A4 通路のあるコースでも線分の中の往復は数えない');
    eq(d.decreased, 0, 'A4 数えた周回が減った回数');
    // 線分の外を順方向に通った分を貸しにしない（通路を順方向に抜けた後の往復は 0 のまま）
    d = driver(M, ring(LANE)); d.go(loop(1.7, 1.9, 0.75, { y1: 0.2 })); d.go([[1.9, 0.2], [1.9, 0.75], [1.2, 0.75], [1.9, 0.75]]);
    eq(d.tr.laps, 0, 'A4 線分の外（通路）を順方向に通った周は数えず、その後の線分の往復でも数えない（貸しにしない）');
    // 借りを返すのも線の一部を通ったときだけ: 線分を逆向きに通った後、線の横の通路を順方向に抜けても借りは残る
    d = driver(M, ring(LANE));
    d.go(loop(1.7, 1.9, 0.75)); d.go([[1.9, 0.75], [1.2, 0.75], [1.2, 0.2], [1.9, 0.2]]); d.go(loop(1.9, 1.9, 0.75, { y0: 0.2 }));
    eq(d.tr.laps, 1, 'A4 既知の限界: 線分を逆向きに通った借りは、線の横の通路を順方向に抜けても返らない（次に線分を通って返す＝その 1 周は数えない）');
    d.go(loop(1.9, 1.9, 0.75)); eq(d.tr.laps, 2, 'A4 同: その次の 1 周で 2');
    // 既知の限界: 車幅より広いすき間（0.10 m）では、線分の端のまわりを小さく回っても 1 周と数える（v9.0.0 は線の先へ 0.25 m 離れたときだけ）
    d = driver(M, ring({ x1: 1.5, y1: 0.1, x2: 1.5, y2: 1 }));
    d.go([[1.52, 0.12]]); for (let i = 0; i < 5; i++) d.go([[1.52, 0.12], [1.52, 0.08], [1.48, 0.08], [1.48, 0.12], [1.52, 0.12]]);
    eq(d.tr.laps, 5, 'A4 既知の限界: すき間 0.10 m の線分の端のまわりを半径 2 cm で 5 回まわると 5 と数える');
  });

  guard('A5 突き抜け', () => {
    // 線分が島を突き抜けて向かいの廊下（逆向きに走る）まで届く
    let d = driver(M, ring({ x1: 1.5, y1: 0, x2: 1.5, y2: 3 }));
    for (let i = 1; i <= 3; i++) { d.go(loop(1.7, 1.7)); eq(d.tr.laps, i, `A5 線分が向かいの廊下まで届くコース: ${i} 周して ${i}`); }
    d.go([[1.7, 0.5], [1.2, 0.5], [1.7, 0.5]]); eq(d.tr.laps, 3, 'A5 同: 往復は数えない');
    d = driver(M, ring({ x1: 1.5, y1: 0, x2: 1.5, y2: 3 }));
    for (let i = 0; i < 3; i++) d.go(rev(loop(1.7, 1.7)));
    eq(d.tr.laps, 3, 'A5 既知の限界: 線分が向かいの廊下まで届くコースでは、逆向きの 3 周も 3 と数える（v9.0.0 は 2）');
    // 線分が横へずれている（片端は壁とのすき間 0.046 m・反対の端は壁を 0.046 m 突き抜ける＝投稿「レーシングコース」の形）
    const R2 = { W: 2, H: 1.5, m: 0.3 };
    const off = () => ring({ x1: 0.8, y1: -0.046, x2: 0.8, y2: 0.254 }, R2);
    d = driver(M, off());
    d.go([[0.6, 0.28], [1.0, 0.28]]); d.go(loop(1.0, 1.2, 0.15, { ...R2, y0: 0.28 })); eq(d.tr.laps, 1, 'A5 線分が横へずれたコース: 発走の通過がすき間を通っても 1 周目が遅れない');
    d.go([[1.2, 0.15], [1.2, 0.28], [0.6, 0.28], [0.6, 0.15], [1.2, 0.15]]); eq(d.tr.laps, 1, 'A5 同: すき間を後退で抜けて通り直しても 1 のまま');
    d.go(loop(1.2, 1.2, 0.15, R2)); eq(d.tr.laps, 2, 'A5 同: 1 周して 2');
  });

  guard('A6 直交しない線分', () => {
    const SL = { x1: 1.2, y1: 0, x2: 1.8, y2: 1 };   // 正方向 (1,0) に対して線分が斜め
    let d = driver(M, ring(SL));
    d.go(loop(2.2, 2.2, 0.25)); eq(d.tr.laps, 1, 'A6 斜めの線分: 下寄りを 1 周して 1');
    d.go(loop(2.2, 2.2, 0.25)); eq(d.tr.laps, 2, 'A6 斜めの線分: 2 周して 2');
    d.go([[2.2, 0.25], [2.2, 0.75]]); d.go(loop(2.2, 2.2, 0.75)); eq(d.tr.laps, 3, 'A6 斜めの線分: 上寄りを 1 周して 3');
    d.go([[2.2, 0.75], [1.0, 0.75], [2.2, 0.75]]); eq(d.tr.laps, 3, 'A6 斜めの線分: 往復は数えない');
    const onLine = (tr, f) => Math.max(Math.abs(tr._signed(f.x1, f.y1)), Math.abs(tr._signed(f.x2, f.y2)));
    if (!(onLine(d.tr, SL) < 1e-9)) v.push(`A6 斜めの線分の端点で側の判定が 0 でない（${onLine(d.tr, SL)}）＝線分の法線で測っていない`);
    if (!(d.tr._signed(2.5, 0.5) > 0 && d.tr._signed(0.5, 0.5) < 0)) v.push('A6 斜めの線分の正方向の側が正でない');
    // 直交とみなす境目（|e·f|/(|e||f|) = 1e-4）: 0.01 ずれた線分は線分の法線・2e-5 ずれた線分は従来の fx,fy の式のまま
    const S1 = { x1: 1.5, y1: 0, x2: 1.51, y2: 1 }, S2 = { x1: 1.5, y1: 0, x2: 1.50002, y2: 1 }, S3 = { x1: 1.5, y1: 0, x2: 1.5005, y2: 1 };
    d = driver(M, ring(S1)); if (!(onLine(d.tr, S1) < 1e-9)) v.push(`A6 ずれ 0.01 の線分: 端点で側の判定が ${onLine(d.tr, S1)}（線分の法線で測っていない）`);
    d = driver(M, ring(S3)); if (!(onLine(d.tr, S3) < 1e-9)) v.push(`A6 ずれ 5e-4 の線分: 端点で側の判定が ${onLine(d.tr, S3)}（線分の法線で測っていない）`);
    d = driver(M, ring(S2));
    for (const [x, y] of [[1.7, 0.3], [1.5, 0], [1.50002, 1], [0.123456789, 2.87654321]]) if (d.tr._signed(x, y) !== (x - (S2.x1 + S2.x2) / 2) * 1 + (y - 0.5) * 0) { v.push(`A6 ずれ 2e-5 の線分: 側の判定が従来の fx,fy の式と違う（${x},${y}）`); break; }
    // 正方向が線分とほぼ平行（向きを決められない）: 従来どおり fx,fy のまま＝数えない
    const PAR = { x1: 1.5, y1: 0, x2: 1.5, y2: 1, fx: 0, fy: 1 };
    d = driver(M, ring(PAR)); d.go(loop(1.7, 1.7)); d.go(rev(loop(1.7, 1.7))); eq(d.tr.laps, 0, 'A6 正方向が線分と平行: どちら向きに回っても数えない（従来どおり）');
    if (d.tr._signed(1.7, 0.8) !== (1.7 - 1.5) * 0 + (0.8 - 0.5) * 1) v.push('A6 正方向が線分と平行: 側の判定が従来の fx,fy の式と違う');
  });

  guard('A7 小さいコース', () => {
    // 線の先に壁が 0.3 m しか無い（v9.0.0 の武装距離 0.15 m）。内側の線は線の先 0.12 m までしか行かない。
    const T = { W: 1, H: 0.6, m: 0.2 };
    const d = driver(M, ring({ x1: 0.7, y1: 0, x2: 0.7, y2: 0.2 }, T));
    const lp = [[0.75, 0.1], [0.82, 0.1], [0.82, 0.5], [0.1, 0.5], [0.1, 0.1], [0.75, 0.1]];
    for (let i = 1; i <= 3; i++) { d.go(lp, { step: 0.005 }); eq(d.tr.laps, i, `A7 小さいコースの内側の線: ${i} 周して ${i}`); }
  });

  guard('A8 峠', () => {
    const tg = () => ({ name: '治具・峠', touge: true, walls: [{ x1: 0, y1: 0, x2: 6, y2: 0 }, { x1: 0, y1: 1, x2: 6, y2: 1 }], bounds: { w: 6, h: 1 }, start: { x: 0.2, y: 0.5, theta: 0 }, finish: { x1: 5, y1: 0, x2: 5, y2: 1, fx: 1, fy: 0 } });
    let d = driver(M, tg());
    eq(d.go([[0.2, 0.5], [5.5, 0.5]]), 1, 'A8 峠: ゴールの計上の回数'); eq(d.tr.laps, 1, 'A8 峠: ゴールで 1'); eq(d.tr.finished, true, 'A8 峠: finished');
    if (!(Math.abs(d.tr.lastLap - d.tr.totalTime) < 1e-12 && d.tr.lastLap > 0)) v.push(`A8 峠: ゴールタイム ${d.tr.lastLap} が累計 ${d.tr.totalTime} と違う`);
    const tGoal = d.tr.totalTime;
    eq(d.go([[5.5, 0.5], [4.5, 0.5], [5.5, 0.5]]), 0, 'A8 峠: ゴール後に線を踏み直しても数えない'); eq(d.tr.laps, 1, 'A8 峠: ゴール後も 1');
    if (d.tr.totalTime !== tGoal) v.push('A8 峠: ゴール後に計時が進んだ');
    d = driver(M, tg()); d.go([[0.2, 0.5], [5.5, 0.5]], { running: false }); eq(d.tr.finished, false, 'A8 峠: 走行していない車はゴールしない');
  });

  guard('A9 走行していない間', () => {
    let d = driver(M, ring(FULL));
    d.go(loop(1.7, 1.7)); eq(d.tr.laps, 1, 'A9 1 周して 1');
    const t = d.tr.totalTime;
    d.go(loop(1.7, 1.7), { running: false }); eq(d.tr.laps, 1, 'A9 走行していない間（完走後の惰行）の通過は数えない');
    if (d.tr.totalTime !== t) v.push('A9 走行していない間に計時が進んだ');
    d.go(loop(1.7, 1.7)); eq(d.tr.laps, 2, 'A9 走行を再開して 1 周で 2（走行していない間の通過を後から数えない）');
    d.go([[1.7, 0.5], [1.2, 0.5]], { running: false }); d.go([[1.2, 0.5], [1.7, 0.5]]); eq(d.tr.laps, 2, 'A9 走行していない間に逆向きに通った分も借りになる');
    d.go([[1.7, 0.5], [1.2, 0.5]]); d.go([[1.2, 0.5], [1.7, 0.5]], { running: false }); d.go(loop(1.7, 1.7)); eq(d.tr.laps, 3, 'A9 走行していない間の順方向の通過でも借りは返る（その後の 1 周を数える）');
    d = driver(M, ring({ x1: 1.5, y1: 0.06, x2: 1.5, y2: 1 }));
    d.go(loop(1.7, 1.9)); d.go([[1.9, 0.5], [1.9, 0.03], [1.2, 0.03]], { running: false }); d.go([[1.2, 0.03], [1.2, 0.5], [1.9, 0.5]]);
    eq(d.tr.laps, 1, 'A9 走行していない間にすき間を逆向きに通った分も借りになる');
    // reset で借りと発走の通過は消える
    d = driver(M, ring(FULL));
    d.go(loop(1.7, 1.7)); d.go([[1.7, 0.5], [1.2, 0.5]]);
    d.tr.reset(ring(FULL), { persist: false }); d.started = false;
    d.go(loop(1.7, 1.7)); eq(d.tr.laps, 1, 'A9 reset の後は借りが残らない（線の先から 1 周して 1）');
    // 本番は同じコースオブジェクトで reset する（▶ の押し直し・試走の後）: それでも借りは残らない
    const same = ring(FULL);
    d = driver(M, same); d.go(loop(1.7, 1.7)); d.go([[1.7, 0.5], [1.2, 0.5]]);
    d.tr.reset(same, { persist: false }); d.started = false;
    d.go(loop(1.7, 1.7)); eq(d.tr.laps, 1, 'A9 同じコースオブジェクトで reset しても借りが残らない');
  });

  guard('A10 縮退した入力', () => {
    let d = driver(M, ring({ x1: 1.5, y1: 0.5, x2: 1.5, y2: 0.5 })); d.go(loop(1.7, 1.7)); d.go(loop(1.7, 1.7)); eq(d.tr.laps, 0, 'A10 長さ 0 の線分: 数えない（投げない）');
    d = driver(M, ring({ ...FULL, fx: 0, fy: 0 })); d.go(loop(1.7, 1.7)); eq(d.tr.laps, 0, 'A10 正方向が (0,0): 数えない（投げない）');
    const open = { name: '治具・壁なし', bounds: { w: 4, h: 4 }, start: { x: -1, y: 0, theta: 0 }, finish: { x1: 0, y1: -0.5, x2: 0, y2: 0.5, fx: 1, fy: 0 } };
    for (const [walls, label] of [[[], '壁 0 本'], [undefined, '壁が未定義'], [{ 0: { x1: 0, y1: 1, x2: 0, y2: 2 } }, '壁が配列でない'], [[null, { x1: NaN, y1: 0, x2: 1, y2: 1 }], '壁に null・NaN']]) {
      d = driver(M, { ...open, walls });
      d.go([[-1, 5], [1, 5], [1, -5], [-1, -5], [-1, 0], [1, 0]]); eq(d.tr.laps, 1, `A10 ${label}: 発走の通過が線分の外・線の外を回って戻り、線分を通って 1`);
      d.go([[1, 0], [-1, 0], [1, 0]]); eq(d.tr.laps, 1, `A10 ${label}: 往復は数えない`);
    }
    // 位置が NaN・無限大の tick を挟んで逆向きに線を通っても借りになる（直前の有効な位置と比べる）
    for (const [bx, label] of [[NaN, 'NaN'], [Infinity, '+∞'], [-Infinity, '−∞']]) {
      d = driver(M, ring(FULL));
      d.go(loop(1.7, 1.7)); const t0 = d.tr.totalTime; d.tr.update(1 / 60, bx, 0.5, true);
      if (!(Math.abs(d.tr.totalTime - t0 - 1 / 60) < 1e-12)) v.push(`A10 位置が ${label} の tick で計時が進まない`);
      d.tr.update(1 / 60, 1.3, 0.5, true); d.x = 1.3; d.y = 0.5;
      d.go([[1.3, 0.5], [1.7, 0.5]]); eq(d.tr.laps, 1, `A10 位置が ${label} の tick を挟んだ逆向きの通過も借りになる`);
    }
    // 線分の上の長さ 0 の壁（点・衝突の実体なし）では弦を切らない: 点の両側を往復しても数えない
    d = driver(M, ring(FULL, { extra: [{ x1: 1.5, y1: 0.5, x2: 1.5, y2: 0.5 }] }));
    d.go(loop(1.7, 1.7)); for (let i = 0; i < 5; i++) d.go([[1.7, 0.49], [1.3, 0.49], [1.3, 0.51], [1.7, 0.51], [1.7, 0.49]]);
    eq(d.tr.laps, 1, 'A10 線分の上の長さ 0 の壁の両側を 5 往復しても 1 のまま');
  });

  guard('A11 線に触れる壁・線を横切る壁', () => {
    // 線に触れる壁・線を横切る壁は弦を切る（先端の両側は別の走路でありうる＝A13）。発走の通過は車に 1 つなので、
    //   別の弦を初めて通る周も遅れない。
    const TIP = [{ x1: 1.0, y1: 0.5, x2: 1.5, y2: 0.5 }];                                             // 線の上で終わる仕切り
    const VEE = [{ x1: 1.3, y1: 0.4, x2: 1.5, y2: 0.5 }, { x1: 1.5, y1: 0.5, x2: 1.3, y2: 0.6 }];       // V 字の先端が線に触れる
    const CROSS = [{ x1: 1.4, y1: 0.5, x2: 1.6, y2: 0.5 }];                                           // 線を横切る独立の短い壁
    for (const [extra, label, n] of [[TIP, '線の上で終わる仕切り', 3], [VEE, 'V 字の先端が線に触れる壁', 3], [CROSS, '線を横切る短い壁', 4]]) {
      const d = driver(M, ring(FULL, { extra }));
      d.go([[1.2, 0.25], [1.7, 0.25]]); let y = 0.25; const got = [d.tr.laps];
      for (const yn of [0.75, 0.75, 0.25, 0.25].slice(0, n)) { d.go(loop(1.7, 1.7, y, { y1: yn })); got.push(d.tr.laps); y = yn; }
      eq(got.join(','), [0, 1, 2, 3, 4].slice(0, n + 1).join(','), `A11 ${label}: 手前から発走し、壁の下→上→上→下…と ${n} 周（1 周も遅れない）`);
    }
    // 既知の限界: 壁の端のまわりを回る走りは 1 周と数える（ヘアピンの先端を回る正しい 1 周＝A13 と、線の通過の列が同じ）
    let d = driver(M, ring(FULL, { extra: CROSS }));
    d.go([[1.7, 0.7]]); for (let i = 0; i < 3; i++) d.go([[1.7, 0.7], [1.7, 0.3], [1.3, 0.3], [1.3, 0.7], [1.7, 0.7]]);
    eq(d.tr.laps, 3, 'A11 既知の限界: 線が横切る独立の壁のまわりを 3 回まわると 3 と数える');
    d = driver(M, ring(FULL, { extra: TIP }));
    d.go([[1.7, 0.7]]); for (let i = 0; i < 3; i++) d.go([[1.7, 0.7], [1.7, 0.3], [1.3, 0.3], [1.3, 0.45], [1.1, 0.45], [0.9, 0.5], [1.1, 0.55], [1.3, 0.7], [1.7, 0.7]]);
    eq(d.tr.laps, 3, 'A11 既知の限界: 線の上で終わる仕切りのまわり（下を戻り、反対の端を回って上を進む）を 3 回まわると 3 と数える');
    // 借りは弦ごと: 上の弦に借りがあるまま下の弦で数えても、上の弦の借りは消えない
    d = driver(M, ring(FULL, { extra: CROSS }));
    d.go(loop(1.7, 1.7, 0.25)); d.go([[1.7, 0.25], [1.7, 0.75], [1.3, 0.75], [1.3, 0.25], [1.7, 0.25]]); eq(d.tr.laps, 2, 'A11 上の弦を逆向き・下の弦を順方向（壁のまわりを回る）: 2');
    d.go([[1.7, 0.25], [1.3, 0.25], [1.3, 0.75], [1.7, 0.75]]); eq(d.tr.laps, 2, 'A11 その後、下を逆向き・上を順方向: 上の弦に残っていた借りを返すだけ（2 のまま）');
    // 借りは発走の通過より先に返す: 手前から発走 → コースの外を回って線の先へ → 壁の下を逆向きに通る（下の弦に借り）→
    //   壁の下を順方向（借りを返す・発走の通過はまだ）→ 1 周して壁の上を順方向（発走の通過）→ もう 1 周して数える
    d = driver(M, ring(FULL, { extra: CROSS }));
    d.go([[1.3, 0.25], [1.3, -5], [1.7, -5], [1.7, 0.25], [1.3, 0.25], [1.7, 0.25]]); eq(d.tr.laps, 0, 'A11 手前から発走し、借りを作って返す: 0');
    d.go(loop(1.7, 1.7, 0.25, { y1: 0.75 })); eq(d.tr.laps, 0, 'A11 借りを返した後の最初の順方向の通過（別の弦）は発走の通過＝0');
    d.go(loop(1.7, 1.7, 0.75)); eq(d.tr.laps, 1, 'A11 その次の 1 周で 1');
    // 線を越えた位置は、移動の始点でも中点でもなく線との交点で決める（斜めの大きな 1 歩で壁の上の弦を逆向きに越える）
    d = driver(M, ring(FULL, { extra: CROSS })); d.go(loop(1.7, 1.9, 0.75));
    d.tr.update(1 / 60, 1.6, 0.45, true); d.tr.update(1 / 60, 0.4, 1.65, true); d.x = 0.4; d.y = 1.65;   // 交点は y=0.55（上の弦）・始点は y=0.45（下）
    d.go([[0.4, 1.65], [1.2, 0.75], [1.9, 0.75]]); eq(d.tr.laps, 1, 'A11 始点が下・交点が上の 1 歩: 借りは上の弦に付き、上を順方向に通って返す（1 のまま）');
    d = driver(M, ring(FULL, { extra: CROSS })); d.go(loop(1.7, 1.9, 0.75));
    d.tr.update(1 / 60, 1.6, 0.9, true); d.tr.update(1 / 60, 0.5, -0.1, true); d.x = 0.5; d.y = -0.1;     // 交点は y=0.81（上の弦）・中点は y=0.4（下）
    d.go([[0.5, -0.1], [1.2, 0.75], [1.9, 0.75]]); eq(d.tr.laps, 1, 'A11 交点が上・中点が下の 1 歩: 借りは上の弦に付く（1 のまま）');
    // コースの外で線の上に寝た壁・線分の端に頂点が乗る壁（track/annulus の線分の端は壁の頂点）
    d = driver(M, ring(FULL, { extra: [{ x1: 1.5, y1: 1, x2: 1.5, y2: 1.4 }, { x1: 1.5, y1: 0, x2: 1.2, y2: -0.3 }] }));
    d.go(loop(1.7, 1.7)); d.go([[1.7, 0.5], [1.2, 0.5], [1.7, 0.5]]); d.go(loop(1.7, 1.7)); eq(d.tr.laps, 2, 'A11 コースの外で線の上に寝た壁・端に頂点が乗る壁: 2 周と往復 1 回で 2');
  });

  guard('A12 弦の区切り位置（白箱）', () => {
    // 線分の線に沿う座標（中点 0・線分は −0.5〜0.5）で、線分と重なる弦の [a, b] を見る。lap.js の内部 (_geo.chords) を直接読む。
    const chords = (extra, finish = FULL) => new M.lap.LapTracker(ring(finish, { extra }), { persist: false })._geo.chords.map((c) => [c.a, c.b]);
    const same = (got, want, what) => { if (got.length !== want.length || got.some((c, i) => Math.abs(c[0] - want[i][0]) > 1e-9 || Math.abs(c[1] - want[i][1]) > 1e-9)) v.push(`A12 ${what}: 弦 ${JSON.stringify(got)}（期待 ${JSON.stringify(want)}）`); };
    const HALF = { x1: 1.5, y1: 0.5, x2: 1.5, y2: 1 };
    same(chords([]), [[-0.5, 0.5]], '壁から壁まで塞ぐ線分');
    same(chords([{ x1: 1.4, y1: 0.2, x2: 1.9, y2: 0.45 }]), [[-0.5, -0.25], [-0.25, 0.5]], '斜めの壁が線を y=0.25 で横切る');
    same(chords([{ x1: 1.0, y1: 0.5, x2: 1.5, y2: 0.5 }]), [[-0.5, 0], [0, 0.5]], '線分の途中で終わる仕切り（切る）');
    same(chords([{ x1: 1.3, y1: 0.4, x2: 1.5, y2: 0.5 }, { x1: 1.5, y1: 0.5, x2: 1.3, y2: 0.6 }]), [[-0.5, 0], [0, 0.5]], '線分の途中で V 字の先端が線に触れる（切る）');
    same(chords([{ x1: 1.3, y1: 0.4, x2: 1.5, y2: 0.5 }, { x1: 1.5, y1: 0.5, x2: 1.7, y2: 0.6 }]), [[-0.5, 0], [0, 0.5]], '線の上の頂点で壁が両側へ抜ける（切る）');
    same(chords([{ x1: 1.5, y1: 0.3, x2: 1.5, y2: 0.4 }]), [[-0.5, -0.2], [-0.2, -0.1], [-0.1, 0.5]], '線の上に寝た壁（両端で切る）');
    same(chords([{ x1: 1.5, y1: 0.5, x2: 1.5, y2: 0.5 }]), [[-0.5, 0.5]], '線分の上の長さ 0 の壁（切らない）');
    same(chords([{ x1: 1.0, y1: 0.5, x2: 1.5 + 5e-7, y2: 0.5 }]), [[-0.5, 0], [0, 0.5]], '仕切りの先端が線を 5e-7 m 越える（切る）');
    same(chords([{ x1: 1.0, y1: 0.5, x2: 1.5 - 5e-10, y2: 0.5 }]), [[-0.5, 0], [0, 0.5]], '仕切りの先端が線の 5e-10 m 手前（線の上とみなす＝切る）');
    same(chords([{ x1: 1.0, y1: 0.5, x2: 1.5 - 5e-7, y2: 0.5 }]), [[-0.5, 0.5]], '仕切りの先端が線の 5e-7 m 手前で止まる（線に届かない＝切らない）');
    same(chords([{ x1: 1.7, y1: 0.4, x2: 1.5, y2: 0.5 }, { x1: 1.5, y1: 0.5, x2: 1.7, y2: 0.3 }], HALF), [[-0.25, 0.25]], '線分の端に V 字の先端が線の先から触れる（切る＝モダン・レイアウトの内側の端の形）');
    same(chords([{ x1: 1.0, y1: 0.3, x2: 1.5, y2: 0.3 }], HALF), [[-0.45, 0.25]], '線分の外で仕切りの先端が触れる（切る）');
    same(chords([], { x1: 1.5, y1: 0.06, x2: 1.5, y2: 1 }), [[-0.53, 0.47]], 'すき間 0.06 m の線分（弦は壁まで）');
    same(chords([], { x1: 1.5, y1: 0, x2: 1.5, y2: 3 }), [[-1.5, -0.5], [-0.5, 0.5], [0.5, 1.5]], '線分が向かいの廊下まで届く（弦 3 本）');
  });

  guard('A13 ヘアピンのコース', () => {
    // 外周 3.0×0.8・中央の仕切り y=0.4, x=0.6..2.4 を回る U 字のコース（順方向: 下の走路を +x → 右の先端を回る → 上の走路を −x）。
    //   戻りの走路は仕切り寄り（仕切りから 0.1 m）を通る＝フィニッシュ線の延長を、線分の端のすぐ横で逆向きに横切る。
    //   ここで見るのは「戻りの走路の通過を借りにしない」こと。軌跡は手書きで、どの周も線分を順方向に通る。
    const U = (finish) => ({ name: '治具・U 字', walls: [...rect(0, 0, 3, 0.8), { x1: 0.6, y1: 0.4, x2: 2.4, y2: 0.4 }], bounds: { w: 3, h: 0.8 }, start: { x: 1.0, y: 0.2, theta: 0 }, finish: { fx: 1, fy: 0, ...finish } });
    const lapU = (x0) => [[x0, 0.2], [2.6, 0.2], [2.6, 0.5], [0.4, 0.5], [0.4, 0.2], [x0, 0.2]];
    for (const [finish, x0, label, want] of [
      [{ x1: 2.40, y1: 0, x2: 2.40, y2: 0.40 }, 2.5, '線が仕切りの先端ちょうど・下の走路だけ', 3],
      [{ x1: 2.45, y1: 0, x2: 2.45, y2: 0.40 }, 2.5, '線が先端の 0.05 m 先・下の走路だけ', 3],
      [{ x1: 2.40, y1: 0, x2: 2.40, y2: 0.45 }, 2.5, '線が先端ちょうど・線分が先端を 0.05 m 越える', 3],
      [{ x1: 2.35, y1: 0, x2: 2.35, y2: 0.45 }, 2.5, '線が先端の 0.05 m 手前・線分が仕切りを 0.05 m 突き抜ける', 3],
      [{ x1: 1.50, y1: 0, x2: 1.50, y2: 0.40 }, 1.7, '線が仕切りの途中', 3],
      [{ x1: 2.45, y1: 0, x2: 2.45, y2: 0.80 }, 2.5, '既知の限界: 線が先端の先で外壁から向かいの外壁まで（順方向と逆方向の 2 本の走路を 1 つの弦でまたぐ）', 0],
    ]) {
      const d = driver(M, U(finish));
      d.go([[x0, 0.2]]); for (let i = 0; i < 3; i++) d.go(lapU(x0));
      eq(d.tr.laps, want, `A13 ${label}: 3 周`);
    }
    // 線分が走路を塞いでいないコース（層 4 の 4 回目の形: 外周 (0.2,0.2)-(2.8,0.8)・仕切り y=0.5, x=0.5..2.5・走路 0.3 m・
    //   フィニッシュ線は左の先端の 0.15 m 手前で下半分だけ (0.35,0.2)-(0.35,0.5)。線分の端と仕切りの先端の間は 0.15 m）。
    const N = { name: '治具・狭い U 字', walls: [...rect(0.2, 0.2, 2.8, 0.8), { x1: 0.5, y1: 0.5, x2: 2.5, y2: 0.5 }], bounds: { w: 3, h: 1 }, start: { x: 0.8, y: 0.35, theta: 0 }, finish: { x1: 0.35, y1: 0.2, x2: 0.35, y2: 0.5, fx: 1, fy: 0 } };
    // (i) 上の走路から線の横（線分の上の通路）を逆向きに抜けて回り込み、線分を順方向に通る: 数える
    let d = driver(M, N);
    d.go([[0.8, 0.35]]); for (let i = 0; i < 3; i++) d.go([[0.8, 0.35], [2.65, 0.35], [2.65, 0.65], [0.27, 0.65], [0.27, 0.35], [0.8, 0.35]]);
    eq(d.tr.laps, 3, 'A13 線分が走路を塞いでいないコース: 線の横の通路を戻って線分を順方向に通る 3 周');
    // (ii) 線分の端と仕切りの先端の間（線の正側のまま）を通り抜け、切り返しで線分を後ろ→前と踏み直す: 数えない（往復と同じ）
    d = driver(M, N);
    d.go([[0.8, 0.35]]); for (let i = 0; i < 3; i++) d.go([[0.8, 0.35], [2.65, 0.35], [2.65, 0.65], [0.42, 0.65], [0.42, 0.35], [0.31, 0.35], [0.8, 0.35]]);
    eq(d.tr.laps, 0, 'A13 既知の限界: 線の横を通り抜けた後、切り返しで線分を踏み直すだけの 3 周は 0（v9.0.0 は 3）');
  });
  return v;
}

// ── F) 出荷の全周回コース＋投稿コースの写し ──────────────────────────────────────────
function checkF(M) {
  const v = [];
  const cs = SPECS.map((s) => M.course.buildFromSpec(s));
  { const r = M.course.acceptCourseData(JSON.parse(JSON.stringify(FIG8)), { own: false }); if (!r.ok) v.push('投稿コースの写しが取り込めない: ' + r.why); else cs.push(r.course); }
  let nLoop = 0, nSlant = 0, nFinish = 0, nTouch = 0;
  for (const c of cs) {
    const f = c.finish; if (!f) continue;
    nFinish++;
    const ex = f.x2 - f.x1, ey = f.y2 - f.y1, len = Math.hypot(ex, ey), fl = Math.hypot(f.fx, f.fy);
    const mx = (f.x1 + f.x2) / 2, my = (f.y1 + f.y2) / 2;
    const slant = Math.abs(ex * f.fx + ey * f.fy) / (len * fl);
    const tr = new M.lap.LapTracker(c, { persist: false });
    if (slant <= 1e-4) {
      // 直交するコース: 側の判定は v9.0.0 と同じ式（fx,fy）とビット一致＝発走の側・通過の tick が変わらない
      for (const [x, y] of [[c.start.x, c.start.y], [f.x1, f.y1], [f.x2, f.y2], [mx + 0.3 * f.fx, my + 0.3 * f.fy], [mx - 0.7 * f.fx + 0.1, my - 0.7 * f.fy - 0.2], [0.123456789, 9.87654321]]) {
        const want = (x - mx) * f.fx + (y - my) * f.fy;
        if (tr._signed(x, y) !== want) { v.push(`${c.name}: _signed(${x},${y}) = ${tr._signed(x, y)} ≠ fx,fy の式 ${want}`); break; }
      }
    } else {
      nSlant++;
      let nx = -ey / len, ny = ex / len; if (nx * f.fx + ny * f.fy < 0) { nx = -nx; ny = -ny; }
      if (!(Math.abs(tr._signed(f.x1, f.y1)) < 1e-9 && Math.abs(tr._signed(f.x2, f.y2)) < 1e-9 && tr._signed(mx + 0.1 * nx, my + 0.1 * ny) > 0))
        v.push(`${c.name}（線分と正方向のずれ ${(Math.asin(Math.min(1, slant)) * 180 / Math.PI).toFixed(1)}°）: 側の判定が線分の法線になっていない`);
    }
    if (c.touge) continue;
    nLoop++;
    // 線分の法線 n（fx,fy 側）と線分に沿う向き t。中点を n に沿って往復／線分の線のはるか外を回って戻る。
    let nx = -ey / len, ny = ex / len; if (nx * f.fx + ny * f.fy < 0) { nx = -nx; ny = -ny; }
    const tx = ex / len, ty = ey / len, D = 4 * (c.bounds.w + c.bounds.h) + 4 * len;
    const P = (s, q = 0) => [mx + nx * s + tx * q, my + ny * s + ty * q];
    let d = driver(M, c);
    d.go([P(0.3), P(-0.3), P(0.3), P(-0.3), P(0.3), P(-0.3), P(0.3)]);
    if (d.tr.laps !== 0) v.push(`${c.name}: 線の中点を 3 往復して ${d.tr.laps} 周（期待 0）`);
    d = driver(M, c);
    d.go([P(0.3), P(0.3, D), P(-0.3, D), P(-0.3), P(0.3)]);
    if (d.tr.laps !== 1) v.push(`${c.name}: 線の外を回って戻り線分を通って ${d.tr.laps} 周（期待 1）`);
    d.go([P(0.3), P(0.3, -D), P(-0.3, -D), P(-0.3), P(0.3)]);
    if (d.tr.laps !== 2) v.push(`${c.name}: 反対側の外を回って戻り線分を通って ${d.tr.laps} 周（期待 2）`);
    // 線分は両端とも壁の上で終わり（壁から壁まで塞ぐ）、1 つの弦に収まる（＝数えた周回は巻き数と一致する前提）。
    //   端が壁の上にあることは、壁までの距離で独立に測る（lap.js の弦を使わない）。
    const onWall = (px, py) => c.walls.some((w) => M.geom.distToSeg({ x: px, y: py }, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }) <= 1e-9);
    if (!(onWall(f.x1, f.y1) && onWall(f.x2, f.y2))) v.push(`${c.name}: フィニッシュ線分の端が壁の上に無い`);
    const ch = tr._geo ? tr._geo.chords : null;
    if (!(ch && ch.length === 1 && Math.abs(ch[0].a + len / 2) < 1e-6 && Math.abs(ch[0].b - len / 2) < 1e-6)) v.push(`${c.name}: 線分と重なる弦が ${ch ? JSON.stringify(ch.map((x) => [x.a, x.b])) : 'なし'}（壁から壁までの 1 本のはず・線分 ±${len / 2}）`);
    // 線分を逆向きに通った後、線分の端の壁のすぐ向こう（島・コースの外・隣の区間＝別の弦）で線の延長を正側へ横切っても借りは返らない。
    for (const q of [len / 2 + 0.01, -(len / 2 + 0.01)]) {
      d = driver(M, c);
      d.go([P(0.3), P(-0.3), P(-0.3, q), P(0.3, q), P(0.3, D), P(-0.3, D), P(-0.3), P(0.3)]);
      if (d.tr.laps !== 0) v.push(`${c.name}: 線分を逆向きに通り、端の壁の向こう（${q > 0 ? '＋' : '−'}側）で線の延長を横切って戻って ${d.tr.laps} 周（期待 0）`);
    }
    // 線分の端で壁が線の片側からしか触れていない所（頂点に集まる壁の他端が全部同じ側）を、壁の座標だけから数える。
    for (const [px, py] of [[f.x1, f.y1], [f.x2, f.y2]]) {
      const sides = [];
      for (const w of c.walls) {
        if (Math.hypot(w.x1 - px, w.y1 - py) < 1e-9) sides.push((w.x2 - mx) * nx + (w.y2 - my) * ny);
        if (Math.hypot(w.x2 - px, w.y2 - py) < 1e-9) sides.push((w.x1 - mx) * nx + (w.y1 - my) * ny);
      }
      if (sides.length && (sides.every((x) => x > 1e-9) || sides.every((x) => x < -1e-9))) nTouch++;
    }
  }
  if (nLoop < 40) v.push(`周回コースが ${nLoop} 本しか検査されていない`);
  if (nSlant !== 1) v.push(`線分と正方向が直交しないコースが ${nSlant} 本（出荷はトライアングル 1 本のはず）`);
  // 線分の端で壁が片側からしか触れない所は出荷に 1 つある（モダン・レイアウトの内側の端: 折り返した内壁の頂点）。上の「壁から壁まで
  //   の 1 本」「端の壁の向こうで借りは返らない」は、この端でも成り立つことを見ている（＝この形が母集団に入っていることの確認）。
  if (nTouch !== 1) v.push(`線分の端で壁が線の片側からしか触れていない所が ${nTouch} か所（出荷はモダン・レイアウトの 1 か所のはず）`);
  checkF.n = nLoop; checkF.nFinish = nFinish;
  return v;
}

// ── 測定①: 線分の通過（冒頭の注記）──────────────────────────────────────────────────
function windObserver(M, course) {
  const f = course.finish, A = { x: f.x1, y: f.y1 }, B = { x: f.x2, y: f.y2 };
  const ex = f.x2 - f.x1, ey = f.y2 - f.y1, len = Math.hypot(ex, ey), mx = (f.x1 + f.x2) / 2, my = (f.y1 + f.y2) / 2;
  let nx = -ey / len, ny = ex / len; if (nx * f.fx + ny * f.fy < 0) { nx = -nx; ny = -ny; }
  const cars = [];
  const probe = (tick, slots) => slots.forEach((s, i) => {
    const c = s.car, d = (c.x - mx) * nx + (c.y - my) * ny;
    let o = cars[i];
    if (!o) { cars[i] = o = { x: c.x, y: c.y, d, w: d < 0 ? -1 : 0, wMax: 0, fwd: 0, rev: 0, laps: 0, over: 0, late: 0 }; return; }
    if ((o.d < 0) !== (d < 0) && M.geom.segIntersect({ x: o.x, y: o.y }, { x: c.x, y: c.y }, A, B)) { if (o.d < 0) { o.w++; o.fwd++; } else { o.w--; o.rev++; } }
    if (o.w > o.wMax) o.wMax = o.w;
    if (s.lap.laps > o.laps) { o.laps = s.lap.laps; if (o.laps > o.wMax) o.over = Math.max(o.over, o.laps - o.wMax); }
    if (s.running && o.wMax > s.lap.laps) o.late++;   // 走行中なのに、回り切った周回がこの tick までに数えられていない
    o.x = c.x; o.y = c.y; o.d = d;
  });
  return { probe, cars };
}
// ── 測定②: 角度の積算（島の中心まわり。segIntersect も線分の側の式も使わない）─────────────────
//   中心 = 壁の端点の重心（annulus は中心対称）。フィニッシュ線の方位 a0 = 中心から線分の中点への向き。
//   k(t) = floor(積算角 / 2π)（積算角は a0 から測る）。線の手前から出た車は k=−1 から始まり、最初に線の方位を越えると 0
//   （発走の通過）。順方向へ回り切った周回の数 = max(0, max_t k(t))（反時計回りが順方向のコース用）。
function angleObserver(course) {
  let cx = 0, cy = 0, n = 0;
  for (const w of course.walls) { cx += w.x1 + w.x2; cy += w.y1 + w.y2; n += 2; }
  cx /= n; cy /= n;
  const f = course.finish, a0 = Math.atan2((f.y1 + f.y2) / 2 - cy, (f.x1 + f.x2) / 2 - cx);
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };
  const cars = [];
  const probe = (tick, slots) => slots.forEach((s, i) => {
    const a = Math.atan2(s.car.y - cy, s.car.x - cx);
    let o = cars[i];
    if (!o) cars[i] = o = { a, acc: wrap(a - a0), kMax: 0, bad: 0 };
    else { o.acc += wrap(a - o.a); o.a = a; }
    const k = Math.floor(o.acc / (2 * Math.PI));
    if (k > o.kMax) o.kMax = k;
    if (s.running ? s.lap.laps !== o.kMax : s.lap.laps > o.kMax) o.bad++;
  });
  return { probe, cars };
}
const SHUTTLE = `// フィニッシュ線の前後を往復するだけ（コースは 1 周もしない）
int ph; int k;
void setup() { RC_setup(); ph = 0; k = 0; }
void loop() {
  k = k + 1;
  RC_steer(CENTER);
  if (ph == 0) { RC_drive(REVERSE, 200); if (k >= 6) { ph = 1; k = 0; } }
  else if (ph == 1) { RC_drive(FORWARD, 200); if (k >= 32) { ph = 2; k = 0; } }
  else { RC_drive(REVERSE, 200); if (k >= 32) { ph = 1; k = 0; } }
}
`;
const specOf = (name) => { const s = SPECS.find((x) => x.name === name); if (!s) throw new Error('出荷コースに無い: ' + name); return s; };
const MODES = ['dynamic', 'standard', 'v2'];

// ── 実行 ────────────────────────────────────────────────────────────────────────
const P = await loadTree(JS_DIR);
console.log(`wf_bh3_laps — 周回の数え方（product: ${ROOT === HERE ? 'この木' : ROOT}・${P.config.APP_VERSION}）`);

console.log('\nA) 単体（治具のコースに軌跡を与える）');
report('発走・踏み直し・逆走・すき間・通路・線に触れる壁・ヘアピンのコース・突き抜け・斜めの線分・小さいコース・峠・走行していない間・縮退した入力・弦の区切り', checkA(P));

console.log('\nF) 出荷の全周回コース＋投稿コースの写し');
{ const v = checkF(P); report(`フィニッシュを持つ ${checkF.nFinish} 本の側の判定が従来の式とビット一致（斜めの 1 本は線分の法線）・周回コース ${checkF.n} 本で中点の往復は 0 周・線の外を回って戻れば 1 周・線分は壁から壁まで塞ぐ 1 つの弦`, v); }

console.log('\nB) 往復するだけのプログラム（公式レース・3 周）');
{
  const bad = [];
  for (const name of ['スピードウェイ', 'ロングオーバル']) for (const mode of MODES) {
    const r = P.race.runRace({ course: P.course.buildFromSpec(specOf(name)), regime: 'tabletop', laps: 3, field: [{ name: 'Shuttle', lang: 'c', src: SHUTTLE, carType: 'normal_fr' }], crashRule: { rejoin: false, penaltySec: 3 }, interact: true, physics: mode });
    const laps = r.finishers.length ? 3 : r.dnf[0].lapsCompleted;
    if (r.finishers.length || laps !== 0) bad.push(`${name}/${mode}: ${r.finishers.length ? `完走 ${(r.finishers[0].totalTimeMs / 1000).toFixed(1)} 秒` : laps + ' 周'}`);
  }
  report('スピードウェイ・ロングオーバル × 3 エンジンで 0 周・完走しない（改修前は 6/6 本が約 10.5 秒で完走）', bad);
}

console.log('\nC) 出荷の公式サンプル大会');
{
  const { event, courseSpec } = SAMPLE;
  const entries = SAMPLE.entries.map((e) => (e.progKey && !e.program && !e.src) ? { ...e, src: P.programs.PROGRAM_BY_KEY[e.progKey].code, lang: P.programs.PROGRAM_BY_KEY[e.progKey].lang || 'c' } : e);
  const full = P.course.buildFromSpec(courseSpec), field = P.raceEvent.frozenField(event, entries);
  const { centerline: _cl, ...bare } = full;   // BH5: 進行方向の分からない同じ形のコース（向き直しが働かない＝BH3 の時点と同じ走り）
  const run = (course) => { const obs = windObserver(P, course); const r = P.race.runRace({ course, regime: event.regime, laps: event.laps, field, crashRule: event.crashRule, interact: true, maxSec: event.maxSec, physics: event.physicsMode, recon: null, wear: false, probe: obs.probe }); return { obs, r, fin: new Set(r.finishers.map((x) => x.idx)) }; };
  { const { obs, r, fin } = run(bare);
    const zero = obs.cars.map((o, i) => ({ o, i })).filter((x) => x.o.wMax === 0);
    ok(zero.length >= 1 && zero.every((x) => !fin.has(x.i)), `中心線を落とした写し: 巻き数 0 の車（${zero.map((x) => field[x.i].name).join('・') || 'なし'}）は完走に入らない（完走: ${r.finishers.map((x) => x.name).join('・') || 'なし'}）`);
    ok(obs.cars.every((o) => o.over === 0 && o.late === 0) && r.verifyHash === 'cb6afdeb', `同: どの車も回り切っていない計上・数え漏れが無く、結果は BH3 の時点と同じ（verifyHash ${r.verifyHash}＝cb6afdeb・数えた周回／巻き数の最大: ${obs.cars.map((o, i) => `${field[i].name} ${o.laps}/${o.wMax}`).join('・')}）`); }
  { const { obs, r, fin } = run(full);
    ok(obs.cars.every((o) => o.over === 0 && o.late === 0) && obs.cars.every((o, i) => !fin.has(i) || o.wMax >= event.laps), `出荷の大会そのもの: どの車も回り切っていない計上・数え漏れが無く、完走した車は回り切っている（完走: ${r.finishers.map((x) => x.name).join('・') || 'なし'}・数えた周回／巻き数の最大: ${obs.cars.map((o, i) => `${field[i].name} ${o.laps}/${o.wMax}`).join('・')}）`); }
}

console.log('\nD) 代表セル（四角の中の丸・動力学・6 台・ペナルティ復帰・3 周）');
{
  const p = P.programs.PROGRAM_BY_KEY.py_normal_fr, course = P.course.buildFromSpec(specOf('四角の中の丸'));
  const obs = windObserver(P, course), ang = angleObserver(course);
  const r = P.race.runRace({ course, regime: 'tabletop', laps: 3, field: Array.from({ length: 6 }, (_, i) => ({ name: 'C' + i, lang: p.lang, src: p.code, carType: p.carType })), crashRule: { rejoin: true, penaltySec: 3 }, interact: true, physics: 'dynamic', probe: (t, s) => { obs.probe(t, s); ang.probe(t, s); } });
  const fin = new Set(r.finishers.map((x) => x.idx));
  ok(obs.cars.every((o) => o.over === 0), `回り切っていない計上が無い（数えた周回／巻き数の最大: ${obs.cars.map((o) => `${o.laps}/${o.wMax}`).join('・')}）`);
  ok(obs.cars.every((o, i) => o.late === 0 && (fin.has(i) || o.laps === o.wMax)), `数え漏れが無い（走行中のどの tick でも 数えた周回 = 巻き数の最大。数えられていない tick の数: ${obs.cars.map((o) => o.late).join('・')}）`);
  ok(obs.cars.some((o) => o.rev > 0 && o.fwd > o.wMax), `線を逆向きに通ってから通り直した車がいる（＝この検査が往復を含むセルを見ている。逆向きの通過 計 ${obs.cars.reduce((a, o) => a + o.rev, 0)} 回）`);
  ok(ang.cars.every((o) => o.bad === 0), `D3 角度の積算（島の中心まわり・線分の通過の判定を使わない測定）でも毎 tick 一致（数えた周回／角度で数えた周回: ${ang.cars.map((o, i) => `${obs.cars[i].laps}/${o.kMax}`).join('・')}・食い違った tick ${ang.cars.map((o) => o.bad).join('・')}）`);
}

console.log('\nD5) 代表セル（オーバル・動力学・6 台・ペナルティ復帰・3 周）— 多くの車が周回を重ねるセル');
{
  const p = P.programs.PROGRAM_BY_KEY.py_normal_fr, course = P.course.buildFromSpec(specOf('オーバル'));
  const obs = windObserver(P, course), ang = angleObserver(course);
  const r = P.race.runRace({ course, regime: 'tabletop', laps: 3, field: Array.from({ length: 6 }, (_, i) => ({ name: 'C' + i, lang: p.lang, src: p.code, carType: p.carType })), crashRule: { rejoin: true, penaltySec: 3 }, interact: true, physics: 'dynamic', probe: (t, s) => { obs.probe(t, s); ang.probe(t, s); } });
  const total = obs.cars.reduce((a, o) => a + o.laps, 0);
  ok(total >= 12 && obs.cars.every((o) => o.over === 0 && o.late === 0) && ang.cars.every((o) => o.bad === 0), `計 ${total} 周（完走 ${r.finishers.length} 台）で、測定①（線分の通過）②（角度の積算）とも毎 tick 一致（数えた周回: ${obs.cars.map((o) => o.laps).join('・')}）`);
}

console.log('\nD4) 代表セル（モダン・レイアウト・クラシック・3 台・ペナルティ復帰・3 周）');
{
  const p = P.programs.PROGRAM_BY_KEY.py_normal_fr, full = P.course.buildFromSpec(specOf('モダン・レイアウト'));
  const { centerline: _cl, ...bare } = full;   // BH5: 逆走する車が要るので、向き直しが働かない同じ形のコースで走らせる
  const run = (course) => { const obs = windObserver(P, course); P.race.runRace({ course, regime: 'tabletop', laps: 3, field: Array.from({ length: 3 }, (_, i) => ({ name: 'C' + i, lang: p.lang, src: p.code, carType: p.carType })), crashRule: { rejoin: true, penaltySec: 3 }, interact: true, physics: 'standard', probe: obs.probe }); return obs; };
  { const obs = run(bare);
    ok(obs.cars.every((o) => o.over === 0 && o.late === 0) && obs.cars.some((o) => o.rev > o.fwd), `中心線を落とした写し: 逆走した車（線分の逆向きの通過が順方向より多い）を数えない・数え漏れも無い（数えた周回／巻き数の最大: ${obs.cars.map((o) => `${o.laps}/${o.wMax}`).join('・')}・順／逆 ${obs.cars.map((o) => `${o.fwd}/${o.rev}`).join('・')}）`); }
  { const obs = run(full);
    ok(obs.cars.every((o) => o.over === 0 && o.late === 0), `出荷のコースそのもの: 回り切っていない計上・数え漏れが無い（数えた周回／巻き数の最大: ${obs.cars.map((o) => `${o.laps}/${o.wMax}`).join('・')}・順／逆 ${obs.cars.map((o) => `${o.fwd}/${o.rev}`).join('・')}）`); }
}

console.log('\nD2) 代表セル（舵角限界ベンチ R_out/R_min=0.856〔道幅 3.5 台分〕・動力学・1 台・ペナルティ復帰・3 周）');
{
  // 改修前は、内側の線では武装距離に届かず 3 周目を回り切った tick に数えられず、約 4.9 秒後に切り返しで線を踏み直したときに数えた。
  const p = P.programs.PROGRAM_BY_KEY.py_normal_fr, course = P.course.buildFromSpec(specOf('舵角限界ベンチ R_out/R_min=0.856〔道幅 3.5 台分〕'));
  const obs = windObserver(P, course);
  const r = P.race.runRace({ course, regime: 'tabletop', laps: 3, field: [{ name: 'C0', lang: p.lang, src: p.code, carType: p.carType }], crashRule: { rejoin: true, penaltySec: 3 }, interact: true, physics: 'dynamic', probe: obs.probe });
  const o = obs.cars[0];
  ok(r.finishers.length === 1 && o.over === 0 && o.late === 0, `回り切った tick に数える（数えられていない tick ${o.late}・完走 ${r.finishers.length ? (r.finishers[0].totalTimeMs / 1000).toFixed(2) + ' 秒' : 'なし'}。改修前は 3 周目を約 4.9 秒遅れて数えた）`);
}

console.log('\nE) トライアングル（線分と正方向が 60° ずれる・C 版 Apex Hunter・クラシック・1 台・ペナルティ復帰）');
{
  const p = P.programs.PROGRAM_BY_KEY.normal_fr, course = P.course.buildFromSpec(specOf('トライアングル'));
  const obs = windObserver(P, course);
  const r = P.race.runRace({ course, regime: 'tabletop', laps: 3, field: [{ name: 'C0', lang: p.lang, src: p.code, carType: p.carType }], crashRule: { rejoin: true, penaltySec: 3 }, interact: true, physics: 'standard', probe: obs.probe });
  const o = obs.cars[0];
  ok(r.finishers.length === 1, `完走する（改修前は線分を順方向に 18 回通って 0 周・時間切れ。今回: ${r.finishers.length ? '完走 ' + (r.finishers[0].totalTimeMs / 1000).toFixed(1) + ' 秒' : (r.dnf[0].lapsCompleted + ' 周で ' + r.dnf[0].reason)}）`);
  ok(o.over === 0 && o.late === 0 && o.laps === Math.min(3, o.wMax), `数えた周回 ${o.laps} が測定①（順 ${o.fwd}／逆 ${o.rev}・巻き数の最大 ${o.wMax}）と一致し、回り切った tick に数えている`);
}

console.log('\nH) ライブの ▶ 走行の練習ベスト（自動復帰 ON・車体 0.8×・速度 3×・練習記録を読み書きする＝本物の ▶ と同じ）');
{
  const live = (name, prog, sec) => {
    store.clear();
    const L = liveSetup(P, { course: P.course.buildFromSpec(specOf(name)), regime: 'tabletop', n: 1, mode: 'dynamic', prog, persist: true });
    while (L.t < sec - 1e-9) liveFrame(L, (1 / 60) * 3);
    return { lap: L.slots[0].lap, recs: [...store.entries()].filter(([k]) => k.startsWith('rumicar.practice')) };
  };
  try {
    const sh = live('スピードウェイ', { lang: 'c', code: SHUTTLE }, 40);
    ok(sh.lap.laps === 0 && sh.recs.length === 0, `往復するだけのプログラム（スピードウェイ・40 秒）: 数えた周回 ${sh.lap.laps}・書かれた練習ベスト ${sh.recs.length} 件${sh.recs.length ? `（${sh.recs[0][0].slice(0, 40)}… = ${sh.recs[0][1].slice(0, 30)}…）` : ''}（=0・0。改修前は 3 秒台のベストが書かれた）`);
    const ah = live('オーバル', P.programs.PROGRAM_BY_KEY.py_normal_fr, 60);
    const rec = ah.recs.length === 1 ? JSON.parse(ah.recs[0][1]) : null;
    ok(ah.lap.laps >= 2 && rec && ah.recs[0][0].startsWith('rumicar.practiceShape.') && rec.t === ah.lap.bestLap && rec.t > 10,
      `対照 — Apex Hunter（オーバル・60 秒）: ${ah.lap.laps} 周・練習ベスト ${rec ? rec.t.toFixed(2) + ' 秒' : 'なし'} が形の鍵に書かれる（1 周 13 秒台）`);
  } finally { store.clear(); P.config.setCarScale(1); P.dyn.applyRegime('tabletop'); }
}

// ── G) 変異試験 ───────────────────────────────────────────────────────────────────
const tmpDirs = [];
if (RUN_MUT) {
  console.log('\nG) 変異試験（一時ツリーの lap.js を壊して A)／F) が赤くなるか）');
  const RAW = fs.readFileSync(path.join(JS_DIR, 'lap.js'), 'utf8');
  const PAY = '        if (c.owe > 0 && this._cg) c.owe -= 1;\n        else if (this._start) this._start = false;\n        else if (running && inSeg) {';
  const REV = '      } else if (c && this._cg) c.owe += 1;';
  const GATE = 'this._cg = inSeg || (v >= (best.lo - best.a <= G ? best.a : best.lo) && v <= (best.b - best.hi <= G ? best.b : best.hi));';
  const SLANT = 'if (along > SLANT_TOL && Math.abs(across) > SLANT_TOL) {';
  const MUT = [
    ['逆向きの通過を借りにしない（改修前と同じ＝往復で数える）', (s) => s.replace(REV, '      } else if (c && this._cg) c.owe += 0;')],
    ['借りを 1 で頭打ちにする', (s) => s.replace(REV, '      } else if (c && this._cg) c.owe = 1;')],
    ['逆向きに通ったら数えた周回を減らす', (s) => s.replace(REV, '      } else if (c && this._cg) { c.owe += 1; if (this.laps > 0) this.laps -= 1; }')],
    ['線の手前から発走した車の発走の通過を外す', (s) => s.replace('      this._start = s < 0;', '      this._start = false;')],
    ['線の先から発走した車にも発走の通過を付ける', (s) => s.replace('      this._start = s < 0;', '      this._start = true;')],
    ['借りを返す通過でも数える', (s) => s.replace(PAY, '        if (c.owe > 0 && this._cg) c.owe -= 1;\n        if (this._start) this._start = false;\n        else if (running && inSeg) {')],
    ['借りを返さない（一度逆向きに通ると二度と数えない）', (s) => s.replace(PAY, PAY.replace('c.owe -= 1', 'c.owe -= 0'))],
    ['線分の外の順方向の通過では借りを返さない（すき間を通っても返らない）', (s) => s.replace(PAY, PAY.replace('if (c.owe > 0 && this._cg) c.owe -= 1;', 'if (c.owe > 0 && inSeg) c.owe -= 1;'))],
    ['線の一部でない所の順方向の通過でも借りを返す（2 回目の改訂前＝遠い通過で借りが消える）', (s) => s.replace(PAY, PAY.replace('if (c.owe > 0 && this._cg) c.owe -= 1;', 'if (c.owe > 0) c.owe -= 1;'))],
    ['線分の外の順方向の通過では発走の通過を返さない（発走がすき間を通ると 1 周遅れる＝試作 B）', (s) => s.replace(PAY, PAY.replace('else if (this._start) this._start = false;', 'else if (this._start) { if (inSeg) this._start = false; }'))],
    ['走行していない間の順方向の通過では借りを返さない', (s) => s.replace(PAY, PAY.replace('if (c.owe > 0 && this._cg) c.owe -= 1;', 'if (c.owe > 0 && this._cg && running) c.owe -= 1;'))],
    ['線分の外の順方向の通過も数える', (s) => s.replace(PAY, PAY.replace('else if (running && inSeg) {', 'else if (running) {'))],
    ['走行していない車も数える', (s) => s.replace(PAY, PAY.replace('else if (running && inSeg) {', 'else if (inSeg) {'))],
    ['計上のときにラップの計時を 0 へ戻さない', (s) => s.replace('          this.lapTime = 0;\n          lapped = true;', '          lapped = true;')],
    ['reset で借りを消さない（弦を使い回す）', (s) => s.replace('this._geo = this.finish ? finishGeometry(course) : null;', 'this._geo = this.finish ? (this._geo || finishGeometry(course)) : null;')],
    ['同じコースオブジェクトなら reset で弦を作り直さない', (s) => s.replace('this._geo = this.finish ? finishGeometry(course) : null;', 'this._geo = this.finish ? ((this._geoOf === course && this._geo) || finishGeometry(course)) : null; this._geoOf = course;')],
    ['数えたときに他の弦の借りも消す', (s) => s.replace('          this.lapTime = 0;\n          lapped = true;', '          this.lapTime = 0;\n          for (const o of this._geo.chords) o.owe = 0;\n          lapped = true;')],
    ['直交とみなす上限を 5e-3 にする', (s) => s.replace('const SLANT_TOL = 1e-4;', 'const SLANT_TOL = 5e-3;')],
    ['弦で区切らない（線分の線の全体を 1 つに扱う）', (s) => s.replace('  cuts.sort((p, q) => p - q);\n  let a = -Infinity;', '  cuts.length = 0;\n  let a = -Infinity;')],
    ['壁が線を切る位置を誤る（壁の中点にする）', (s) => s.replace('cuts.push(v1 + (v2 - v1) * (d1 / (d1 - d2)));', 'cuts.push(v1 + (v2 - v1) * 0.5);')],
    ['線に端点が触れる壁では切らない（線を横切る壁だけで切る）', (s) => s.replace('    if (on1) cuts.push(v1);\n    if (on2) cuts.push(v2);\n', '')],
    ['線の一部を線分だけにする（車幅以下のすき間を数えない）', (s) => s.replace(GATE, 'this._cg = inSeg;')],
    ['線の一部を弦の全体にする（線の横の通路も塞ぐ）', (s) => s.replace(GATE, 'this._cg = true;')],
    ['すき間の上限を車幅でなく車長にする', (s) => s.replace('      const G = CAR.width;', '      const G = CAR.length;')],
    ['すき間の上限を実効寸法でなく固定値にする', (s) => s.replace('      const G = CAR.width;', '      const G = 0.08;')],
    ['線分の端から車長以内は壁が無くても線の一部にする（3 回目の層 4 の前の形＝ヘアピンの戻りの走路の通過が借りになる）', (s) => s.replace(GATE, 'this._cg = inSeg || (v >= best.lo - Math.min(CAR.length, best.lo - best.a) && v <= best.hi + Math.min(CAR.length, best.b - best.hi));')],
    ['片側から線に触れるだけの壁を線分の途中では切らない（3 回目の層 4 の前の形）', (s) => s.replace('    if (on1) cuts.push(v1);\n    if (on2) cuts.push(v2);\n', '    if (on1 && !(v1 > -g.h + LINE_EPS && v1 < g.h - LINE_EPS)) cuts.push(v1);\n    if (on2 && !(v2 > -g.h + LINE_EPS && v2 < g.h - LINE_EPS)) cuts.push(v2);\n')],
    ['側の判定を常に fx,fy で測る（改修前と同じ＝斜めの線分で数えられない）', (s) => s.replace(SLANT, 'if (false) {')],
    ['側の判定を常に線分の法線で測る（直交するコースの値が変わる）', (s) => s.replace(SLANT, 'if (true) {')],
    ['正方向が線分と平行でも線分の法線で測る', (s) => s.replace(SLANT, 'if (along > SLANT_TOL) {')],
    ['線分の法線の向きを正方向へ揃えない', (s) => s.replace('const sgn = across < 0 ? -1 : 1;', 'const sgn = 1;')],
    ['直交とみなす上限を 0.5 にする', (s) => s.replace('const SLANT_TOL = 1e-4;', 'const SLANT_TOL = 0.5;')],
    ['直交とみなす上限を 1e-6 にする', (s) => s.replace('const SLANT_TOL = 1e-4;', 'const SLANT_TOL = 1e-6;')],
    ['武装（線の先へ 0.25 m）を計上の条件に戻す', (s) => s.replace('    let lapped = false;', '    let lapped = false; if (s > 0.25) this._arm = true;').replace(PAY, PAY.replace('else if (running && inSeg) {', 'else if (running && inSeg && this._arm) {\n          this._arm = false;'))],
    ['峠を周回と同じ数え方にする', (s) => s.replace('    if (this.touge) {', '    if (false) {')],
    ['位置が NaN・無限大の tick を飛ばさない', (s) => s.replace('    if (!Number.isFinite(s)) return false;', '')],
    ['位置が NaN の tick だけ飛ばす（無限大は飛ばさない）', (s) => s.replace('    if (!Number.isFinite(s)) return false;', '    if (s !== s) return false;')],
    ['長さ 0 の壁でも切る', (s) => s.replace('    if (Math.hypot(w.x2 - w.x1, w.y2 - w.y1) <= LINE_EPS) continue;', '')],
    ['すき間の上限を車幅の 1.2 倍にする', (s) => s.replace('      const G = CAR.width;', '      const G = CAR.width * 1.2;')],
    ['すき間の上限を車幅の 0.8 倍にする', (s) => s.replace('      const G = CAR.width;', '      const G = CAR.width * 0.8;')],
    ['発走の通過を借りより先に返す', (s) => s.replace(PAY, '        if (this._start) this._start = false;\n        else if (c.owe > 0 && this._cg) c.owe -= 1;\n        else if (running && inSeg) {')],
    ['線を越えた位置を移動の中点にする', (s) => s.replace('const g = this._geo, k = prev.s / (prev.s - s);', 'const g = this._geo, k = 0.5;')],
    ['線を越えた位置を移動の始点にする', (s) => s.replace('const g = this._geo, k = prev.s / (prev.s - s);', 'const g = this._geo, k = 0;')],
    ['発走の通過でラップの計時を 0 へ戻す', (s) => s.replace(PAY, PAY.replace('else if (this._start) this._start = false;', 'else if (this._start) { this._start = false; this.lapTime = 0; }'))],
    ['位置が NaN・無限大の tick で計時を進めない', (s) => s.replace('    if (running && !this.finished) { this.lapTime += dt; this.totalTime += dt; }\n    const s = this._signed(x, y);\n    if (!Number.isFinite(s)) return false;', '    const s = this._signed(x, y);\n    if (!Number.isFinite(s)) return false;\n    if (running && !this.finished) { this.lapTime += dt; this.totalTime += dt; }')],
    ['線の上とみなす距離を 1e-6 m にする', (s) => s.replace('const LINE_EPS = 1e-9;', 'const LINE_EPS = 1e-6;')],
    ['線分の外の順方向の通過を貸しにする', (s) => s.replace(PAY, PAY.replace('else if (running && inSeg) {', 'else if (!inSeg) c.owe -= 1;\n        else if (running) {'))],
    ['借りを 2 で頭打ちにする', (s) => s.replace(REV, '      } else if (c && this._cg) c.owe = Math.min(2, c.owe + 1);')],
    ['走行していない間の線分の外の逆向きの通過を借りにしない', (s) => s.replace(REV, '      } else if (c && (inSeg || (this._cg && running))) c.owe += 1;')],
    ['線の 1 cm 手前までを「線の上から発走」とみなす', (s) => s.replace('      this._start = s < 0;', '      this._start = s < -0.01;')],
    ['壁が配列かを確かめない', (s) => s.replace('for (const w of (Array.isArray(course.walls) ? course.walls : [])) {', 'for (const w of (course.walls || [])) {')],
  ];
  const miss = [], noop = [];
  try {
    for (const [name, fn] of MUT) {
      const mutated = fn(RAW);
      if (mutated === RAW) { noop.push(name); continue; }
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf_bh3_mut_'));
      tmpDirs.push(tmp);
      fs.cpSync(JS_DIR, tmp, { recursive: true });
      fs.writeFileSync(path.join(tmp, 'lap.js'), mutated);
      const m = await loadTree(tmp);
      const a = checkA(m).length, f = checkF(m).length;
      if (a + f === 0) miss.push(name); else console.log(`     ✓ ${name} → A) ${a} 件・F) ${f} 件で赤`);
    }
  } finally { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); }
  report(`変異 ${MUT.length} 件のうち見逃し`, miss);
  report('適用できなかった変異（パターンが実装とずれた）', noop);
  ok(fs.readFileSync(path.join(JS_DIR, 'lap.js'), 'utf8') === RAW, 'product の lap.js は実行前後で無変化');
}

console.log(`\n${fail === 0 ? '────────── BH3 周回の数え方ゲート: 全パス ○ ──────────' : `────────── BH3 ゲート: ✗ ${fail} 件 NG ──────────`}（所要 ${((Date.now() - T0) / 1000).toFixed(1)} 秒）`);
process.exit(fail === 0 ? 0 : 1);
