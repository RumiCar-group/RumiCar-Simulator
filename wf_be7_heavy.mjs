// Stage BE7 常設ゲート — 上限内でも重い投稿コースの計算量 (BB-4 ①②③) を固定する。
//
// 背景（実測 2026-09-25・改修前＝公開 7772773・本ホスト）:
//   投稿コースの取り込み検査 (course.js checkCourse) が守るのは事故 (単位の取り違え・遠い壁・桁違いの寸法) までで、
//   わざと作った重い形は上限内でも重かった:
//   ① 櫛形 100×6.4 m・壁 2,996 本 (歯の間も中央の通路も車幅より狭い＝どこにも置けない) で freeSpawn 1 回 2,358 ms。
//      廊下 BFS の上限 maxPts=600 が「置けるノード」しか数えず、置けない通路を上限なしに広げ、1 歩ごとに全壁を走査した。
//   ② 1000 m の水平壁 149 本で車体スケールを 0.5→4.0 と掃くと、セル寸法 (2×車長) ごとの壁グリッドが積み上がり、
//      node 既定ヒープ (2,198 MB) で cs2.7 のとき OOM。
//   ③ 卓上楕円を壁 20,000 本で描いた投稿コースを 6 台・3.0× で走らせると 1 フレーム 119.6 ms (追従カメラ ON で 152 ms)。
//      センサー扇の方向別終端・深度ビューのレイ・センサー測距・追従中のコース再描画が、どれも到達範囲の全壁を回していた。
//   出荷 66 本の同じ治具での最大は freeSpawn 1 回 104.0 ms・フレーム 33.6 ms (既定表示／追従 ON とも)・保持グリッドは
//   掃引で無制限。
// BE7 の改修 (どれも出荷コースの答えを 1 ビットも変えない＝wf_ba1_fitcore / wf_official_result / wf_ab8_bench が別に見る):
//   fleet.js    廊下 BFS に「見つけたノードの総数」の上限 (10×maxPts)・見通し判定を contact_v2.anyWallNearSeg で候補限定
//   contact_v2  壁配列ごとのグリッドを直近 GRID_CACHE_MAX 個に限る・描画用のレイ照会 rayNearestWall / fanDepthsNear
//   sensors.js  扇内最近の走査で、扇形 (半径=その時点の最近距離) の外接矩形に届かない壁を飛ばす (走査順は同じ)
//   hud.js / depth.js  扇・深度ビューをレイ照会へ (古い contact_v2.js では従来の経路)
//   course.js   拡大・追従中のコース描画で、キャンバスに 1 画素も掛からない壁を描かない (画素一致は実ブラウザの
//               browser/check_be7_frame.mjs が測る)
//
// 検査:
//   A) ①: 櫛形の freeSpawn 1 回 ÷ 出荷最大の条件の freeSpawn 1 回 ≤ 2 (同じプロセスの比＝ホストの速さが約分される)。
//      上限が効くこと (上限を超えた先にしか置き場所が無い形で、上限なしなら置き場所・上限ありなら次の段へ)。変異で赤。
//   B) ②: 掃引の全段で保持グリッド数 ≤ GRID_CACHE_MAX・ヒープの増分が上限個ぶんのグリッドに収まる・使い回しで作り直さない。変異で赤。
//   C) ③: レイ照会 = 全壁走査 (値が同一)・扇 = fanDepths(全壁)・描画命令列と測距が BE7 前の経路と同一・
//      1 フレーム分の計算 (回帰の検知線): 同じ壁 20,000 本のコースで BE7 前の経路に対する時間の比を経路ごとに ≤ C_GAIN_MAX。
//   D) 読み込み互換: BE7 の新しい名前を名前付き import していない (古い contact_v2.js がキャッシュに残るブラウザで起動しない)。
//      古い contact_v2.js の export 集合で読み込んでも答えが同じこと (C) の「BE7 前の経路」がそれ)。変異で赤。
//
// 使い方: node wf_be7_heavy.mjs          exit 0=PASS / 1=FAIL
//         node wf_be7_heavy.mjs --full   … 出荷全コースの freeSpawn 全数ダイジェストを改修前の凍結値と照合 (約 6 分・既定の実行には含めない)
import fs from 'fs';
import os from 'os';
import path from 'path';
import v8 from 'v8';
import vm from 'vm';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const JS = path.join(ROOT, 'public/js');
const specs = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/courses.json'), 'utf8'));
v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc');

let pass = true;
const report = (label, arr, n = 10) => {
  console.log(`  ${arr.length === 0 ? '○' : '✗'} ${label}: ${arr.length} 件`);
  arr.slice(0, n).forEach((s) => console.log(`       - ${s}`));
  if (arr.length > n) console.log(`       … 他 ${arr.length - n} 件`);
  if (arr.length) pass = false;
};

// ── モジュール一式を読み込む (product と、public/js を一時ディレクトリへ写して一部を書き換えた「変異ツリー」) ──
const loadTree = async (dir) => {
  const M = (p) => import(pathToFileURL(path.join(dir, p)).href);
  return { dir, course: await M('course.js'), cfg: await M('config.js'), dyn: await M('physics_dyn.js'), fleet: await M('fleet.js'),
    contact: await M('contact_v2.js'), sensors: await M('sensors.js'), hud: await M('hud.js'), depth: await M('depth.js'),
    geom: await M('geom.js'), fitguard: await M('fitguard.js') };
};
const tmpDirs = [];
// edits: { 'file.js': [[from, to], ...] }。from が**ちょうど 1 回**現れないときは変異を作らない (パターン腐りを名指しで赤にする)。
async function mutantTree(name, edits, rot) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf_be7_'));
  tmpDirs.push(dir);
  fs.cpSync(JS, dir, { recursive: true });
  for (const [file, list] of Object.entries(edits)) {
    const p = path.join(dir, file);
    let s = fs.readFileSync(p, 'utf8');
    for (const [from, to] of list) {
      const n = s.split(from).length - 1;
      if (n !== 1) { rot.push(`${name}: ${file} に「${from.slice(0, 60)}」が ${n} 回（1 回であること）`); return null; }
      s = s.replace(from, to);
    }
    fs.writeFileSync(p, s);
  }
  return loadTree(dir);
}
const P = await loadTree(JS);

// ── --full: 出荷全コースの freeSpawn の全数ダイジェスト (受け入れ基準「出荷全コース × 実利用パラメータ (FLEET.maxCars 台) で
//    改修前と一致」の再確認用・既定の実行には含めない＝本ホストで約 6 分)。条件は 66 本 × 3 領域 × 車体スケール
//    0.4・0.5〜4.0 (0.1 刻み＝UI のスライダーと fitguard の刻み) × 6 台 (occupied を累積＝rebuildSpawns と同じ) の 43,956 回で、
//    配置の倍精度値と路面属性を連結して sha256。凍結値は改修前 (公開 7772773) のツリーで取った値 (BE7 決定ログ)。
if (process.argv.includes('--full')) {
  const crypto = await import('crypto');
  const FULL_PIN = '1135ca3912ddb47cca877d9cd32657d8acb8341e0b0aa4755e4810f442737ae3';
  const SC = [0.4]; for (let i = 5; i <= 40; i++) SC.push(i / 10);
  const h = crypto.createHash('sha256');
  let calls = 0; const t0 = Date.now();
  for (const spec of specs) {
    const c = P.course.buildFromSpec(spec);
    for (const r of ['tabletop', 'midscale', 'fullscale']) for (const uk of SC) {
      P.cfg.setRegimeScale(P.cfg.REGIMES[r].L / P.cfg.REGIMES.tabletop.L); P.cfg.setCarScale(uk);
      const occ = [];
      for (let i = 0; i < P.cfg.FLEET.maxCars; i++) { occ.push(P.fleet.freeSpawn(c, occ, i)); calls++; }
      h.update(JSON.stringify({ c: c.name, r, uk, occ: occ.map((o) => [o.x, o.y, o.theta, o.downhill, o.grip, o.muDecay, o.surface]) }) + '\n');
    }
  }
  const d = h.digest('hex');
  console.log(`--full: freeSpawn ${calls} 回（${((Date.now() - t0) / 1000).toFixed(0)}s）\n   現在 ${d}\n   凍結 ${FULL_PIN}`);
  console.log(d === FULL_PIN ? '--full: 改修前と 1 ビットも違わない ○' : '--full: ✗ 改修前と配置が違う');
  process.exit(d === FULL_PIN ? 0 : 1);
}

// ── 治具（すべて投稿コースとして取り込み検査 std を通る形）──────────────────────────────
function comb(W = 100, H = 6.4, nTeeth = 1496, d = 3.17, openFrom = Infinity) {
  const walls = [{ x1: 0, y1: 0, x2: W, y2: 0 }, { x1: W, y1: 0, x2: W, y2: H }, { x1: W, y1: H, x2: 0, y2: H }, { x1: 0, y1: H, x2: 0, y2: 0 }];
  for (let i = 1; i <= nTeeth; i++) {
    const x = W * i / (nTeeth + 1);
    if (x >= openFrom) break;   // openFrom より先は歯が無い＝車が置ける広場
    walls.push({ x1: x, y1: 0, x2: x, y2: d }); walls.push({ x1: x, y1: H, x2: x, y2: H - d });
  }
  return { name: 'BE7 comb', bounds: { w: W, h: H }, start: { x: 0.5 * W / (nTeeth + 1), y: H / 2, theta: 0 }, walls };
}
function ovalDense(nPer, name) {   // オーバルと同寸の楕円トラックを各輪 nPer 本で描く
  const rx = 1.2, ry = 0.75, w = 0.55, cx = 1.6, cy = 1.1;
  const ring = (ax, ay) => { const p = []; for (let i = 0; i < nPer; i++) { const t = 2 * Math.PI * i / nPer; p.push([cx + ax * Math.cos(t), cy + ay * Math.sin(t)]); } return p; };
  const walls = [];
  for (const p of [ring(rx + w / 2, ry + w / 2), ring(rx - w / 2, ry - w / 2)])
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; walls.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] }); }
  return { name, bounds: { w: 3.2, h: 2.2 }, start: { x: cx, y: cy - ry, theta: 0 }, finish: { x1: cx, y1: cy - ry - w / 2, x2: cx, y2: cy - ry + w / 2 }, walls };
}
function longWalls(n = 149, W = 1000) {
  const walls = [];
  for (let i = 1; i <= n; i++) { const y = W * i / (n + 1); walls.push({ x1: 0, y1: y, x2: W, y2: y }); }
  return { name: 'BE7 long walls', bounds: { w: W, h: W }, start: { x: W / 2, y: W / (n + 1) / 2, theta: 0 }, walls };
}
const intake = [];
const accept = (T, data) => { const r = T.course.acceptCourseData(data); if (!r.ok) intake.push(`${data.name}: ${r.why}`); return r.course || T.course.normalizeCourse(data); };
const kL = (T, r) => T.cfg.REGIMES[r].L / T.cfg.REGIMES.tabletop.L;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const timeMs = (f) => { const t0 = process.hrtime.bigint(); f(); return Number(process.hrtime.bigint() - t0) / 1e6; };
const rot = [];   // 適用できなかった変異 (パターン腐り)

console.log('Stage BE7 重い投稿コースの計算量ゲート — ①配置探索 ②グリッド保持 ③毎フレームの壁走査');
console.log('='.repeat(78));

// ════ A) ① freeSpawn ════════════════════════════════════════════════════════════════════
// 出荷の比較条件＝改修前に全 43,956 回 (66 本×3 領域×cs 0.4/0.5〜4.0×6 台) を測って最大だった条件 (104.0 ms・BE7 決定ログ)。
const SHIP_REF = { name: 'ウェットテクニカル (雨)', regime: 'midscale', uk: 2.9, idx: 4 };
const A_RATIO_MAX = 2;
const A_SEG_GAIN_MIN = 1.3;   // 候補限定なし÷ありの判定コアの時間の下限。改修後の本ホスト実測 1.72〜1.83、外したとき (≒古い contact_v2.js) は 1.0 前後
function spawnTimes(T, course, regime, uk, idx, reps) {
  T.cfg.setRegimeScale(kL(T, regime)); T.cfg.setCarScale(uk);
  const occ = [];
  for (let i = 0; i < idx; i++) occ.push(T.fleet.freeSpawn(course, occ, i));
  T.fleet.freeSpawn(course, occ, idx);   // 1 回目 (JIT・グリッド構築) は捨てる
  const ts = [];
  for (let k = 0; k < reps; k++) ts.push(timeMs(() => T.fleet.freeSpawn(course, occ, idx)));
  return ts;
}
const combP = accept(P, comb());
const shipP = P.course.buildFromSpec(specs.find((s) => s.name === SHIP_REF.name));
const aBad = [];
{
  const tComb = med(spawnTimes(P, combP, 'tabletop', 1, 0, 5));
  const tShip = med(spawnTimes(P, shipP, SHIP_REF.regime, SHIP_REF.uk, SHIP_REF.idx, 5));
  const ratio = tComb / tShip;
  console.log(`\nA) ① 櫛形 (壁 ${combP.walls.length} 本・卓上 cs1・1 台目) ${tComb.toFixed(1)} ms ÷ 出荷最大の条件 (${SHIP_REF.name}・${SHIP_REF.regime}・cs${SHIP_REF.uk}・${SHIP_REF.idx + 1} 台目) ${tShip.toFixed(1)} ms = ${ratio.toFixed(2)}（上限 ${A_RATIO_MAX}・余裕 ${(A_RATIO_MAX / ratio).toFixed(2)} 倍）`);
  if (!(ratio <= A_RATIO_MAX)) aBad.push(`freeSpawn 1 回の比 ${ratio.toFixed(2)} が ${A_RATIO_MAX} を超えた`);
  // 上限が効くこと: 20 m の櫛で 18 m より先だけ歯が無い (車が置ける)。上限なしの BFS はそこまで行って置けるが、
  // 上限ありは手前で打ち切って次の段 (置けない＝スタート位置の最終保険) へ進む。どちらも本物の freeSpawn の出力で見る。
  const pocket = accept(P, comb(20, 6.4, 299, 3.17, 18));
  P.cfg.setRegimeScale(1); P.cfg.setCarScale(1);
  const sp = P.fleet.freeSpawn(pocket, [], 0);
  console.log(`   上限の効き（20 m の櫛・18 m から先が広場）: product → (${sp.x.toFixed(3)}, ${sp.y.toFixed(3)})`);
  if (!(Math.abs(sp.x - pocket.start.x) < 1e-12 && Math.abs(sp.y - pocket.start.y) < 1e-12)) aBad.push(`上限ありなのに広場まで探索した (${sp.x}, ${sp.y})＝上限が効いていない`);
  // 変異①: 上限を外す → 広場に置ける (＝上の「スタート位置」は上限の効果であって、置けない形だからではない) ＋ 比が上限を超える
  const mCap = await mutantTree('上限を外す', { 'fleet.js': [['maxNodes = 10 * maxPts) {', 'maxNodes = Infinity) {']] }, rot);
  if (mCap) {
    mCap.cfg.setRegimeScale(1); mCap.cfg.setCarScale(1);
    const pocketM = accept(mCap, comb(20, 6.4, 299, 3.17, 18));
    const spM = mCap.fleet.freeSpawn(pocketM, [], 0);
    const tCombM = med(spawnTimes(mCap, accept(mCap, comb()), 'tabletop', 1, 0, 3));
    console.log(`   変異「上限を外す」: 広場の櫛 → (${spM.x.toFixed(3)}, ${spM.y.toFixed(3)})・櫛形 ${tCombM.toFixed(1)} ms（比 ${(tCombM / tShip).toFixed(2)}）`);
    if (!(spM.x > 15)) aBad.push(`変異「上限を外す」でも広場に置けない (x=${spM.x})＝上の検査は上限を見ていない`);
    if (!(tCombM / tShip > A_RATIO_MAX)) aBad.push(`変異「上限を外す」で比が ${(tCombM / tShip).toFixed(2)}＝時間の検査が上限の有無を区別できない`);
  }
  // 変異②: 見通し判定の候補限定を外す (anyWallNearSeg の export を消す＝古い contact_v2.js と同じ) → 答えは同じ・比は上限超え
  const mSeg = await mutantTree('見通し判定の候補限定を外す', { 'contact_v2.js': [['export function anyWallNearSeg(', 'function anyWallNearSeg(']] }, rot);
  if (mSeg) {
    // ①の上限 (比 ≤ 2) を満たすのは発見ノード数の上限のほうで、候補限定は外しても満たす (実測 2026-09-25: 櫛形 96 ms・比 1.03)。
    // 候補限定が効いているのは判定コア (コース選択・スライダーのたびに走る settleFitRatio) の時間なので、そこで
    // 「外すと遅くなる」ことを固定する (実測: 櫛形 cs1.5 で 373→733 ms・壁 20,000 本の楕円の fitsAllCars(6) 13→30 ms)。
    const settleMs = (T, c) => { const fx = { regime: () => {}, scale: (k) => T.cfg.setCarScale(k), sync: () => {}, log: () => {} };
      const one = () => { T.cfg.setRegimeScale(1); T.cfg.setCarScale(1.5); return timeMs(() => T.fitguard.settleFitRatio(c, { regime: 'tabletop', userK: 1.5, slotCount: 1, reason: 'carScale' }, fx)); };
      one(); return med([one(), one(), one()]); };
    const sP = settleMs(P, combP), sM = settleMs(mSeg, accept(mSeg, comb()));
    console.log(`   見通し判定の候補限定の効き: 櫛形の判定コア (cs1.5) 候補限定あり ${sP.toFixed(0)} ms ／ なし (＝古い contact_v2.js) ${sM.toFixed(0)} ms（なし÷あり ${(sM / sP).toFixed(2)}・下限 ${A_SEG_GAIN_MIN}）`);
    if (!(sM / sP >= A_SEG_GAIN_MIN)) aBad.push(`見通し判定の候補限定が効いていない（なし÷あり ${(sM / sP).toFixed(2)} < ${A_SEG_GAIN_MIN}）`);
    // 答えが同じこと (出荷 6 本 × 3 領域 × 2 倍率 × 6 台と重いコース)
    const diffs = [];
    const pick = ['ウェットテクニカル (雨)', 'オーバル', 'ナローシケイン・レイアウト', '峠② タイトヘアピン (急な下り)〔道幅 2 台分〕', '競技サーキット (フルスケール)', 'ドリフト広場 (ショー会場)'];
    const cases = [...pick.map((n) => [P.course.buildFromSpec(specs.find((s) => s.name === n)), mSeg.course.buildFromSpec(specs.find((s) => s.name === n))]),
      [accept(P, ovalDense(10000, 'd20k')), accept(mSeg, ovalDense(10000, 'd20k'))]];
    for (const [cp, cm] of cases) for (const r of ['tabletop', 'midscale', 'fullscale']) for (const uk of [0.8, 3]) {
      const run = (T, c) => { T.cfg.setRegimeScale(kL(T, r)); T.cfg.setCarScale(uk); const o = []; for (let i = 0; i < 6; i++) o.push(T.fleet.freeSpawn(c, o, i)); return JSON.stringify(o); };
      if (run(P, cp) !== run(mSeg, cm)) diffs.push(`${cp.name}|${r}|cs${uk}`);
    }
    console.log(`   候補限定あり／なし（＝古い contact_v2.js）の freeSpawn 6 台: ${cases.length * 6} 条件で比較`);
    if (diffs.length) aBad.push(...diffs.map((d) => `候補限定の有無で配置が変わった: ${d}`));
  }
}
report('A) ① freeSpawn の計算量と上限', aBad);

// ════ B) ② グリッドの保持数 ════════════════════════════════════════════════════════════════
const bBad = [];
{
  const MAX = P.contact.GRID_CACHE_MAX;
  const heap = () => { gc(); gc(); return process.memoryUsage().heapUsed / 1e6; };
  const noFx = (T) => ({ regime: (nm) => T.cfg.setRegimeScale(kL(T, nm)), scale: (k) => T.cfg.setCarScale(k), sync: () => {}, log: () => {} });
  // 1 個ぶんの大きさ (卓上 cs0.5＝セルが最も細かい) を、別の壁配列で 1 回だけ作って測る
  const h00 = heap();
  const probe = accept(P, longWalls());
  P.cfg.setRegimeScale(1); P.cfg.setCarScale(0.5);
  P.contact.wallGridFor(probe.walls);
  const one = heap() - h00;
  // 掃引 (main.js の carScale スライダーが呼ぶのと同じ判定コア settleFitRatio を 0.1 刻みで)
  const c = accept(P, longWalls());
  const h0 = heap();
  let peak = 0, maxCount = 0;
  const t0 = Date.now();
  for (let s = 5; s <= 40; s++) {
    const uk = s / 10;
    P.cfg.setRegimeScale(1); P.cfg.setCarScale(uk);
    P.fitguard.settleFitRatio(c, { regime: 'tabletop', userK: uk, slotCount: 1, reason: 'carScale' }, noFx(P));
    const n = P.contact.wallGridCount(c.walls);
    if (n > maxCount) maxCount = n;
    if (n > MAX) bBad.push(`cs${uk}: 保持グリッド ${n} 個 > 上限 ${MAX}`);
    const hu = heap() - h0; if (hu > peak) peak = hu;
  }
  const bound = MAX * one * 1.2;
  console.log(`\nB) ② 1000 m の水平壁 149 本・卓上で車体スケール 0.5→4.0（${((Date.now() - t0) / 1000).toFixed(1)}s）: 保持グリッドの最大 ${maxCount} 個（上限 ${MAX}）`);
  console.log(`   ヒープ増分の最大 ${peak.toFixed(0)} MB ≤ 上限個×1 個ぶん×1.2 = ${MAX}×${one.toFixed(0)}×1.2 = ${bound.toFixed(0)} MB（1 個ぶん＝cs0.5 のグリッドを 1 つ作った増分）`);
  if (!(one > 20)) bBad.push(`1 個ぶんの大きさ ${one.toFixed(1)} MB が小さすぎる（治具が細かいグリッドを作っていない＝ヒープの検査が空振り）`);
  if (!(peak <= bound)) bBad.push(`ヒープ増分 ${peak.toFixed(0)} MB が ${bound.toFixed(0)} MB を超えた`);
  // 使い回し: 細セル (衝突) と粗セル (センサー) を交互に引いても作り直さない (同じオブジェクトが返る)
  P.cfg.setRegimeScale(1); P.cfg.setCarScale(1);
  const g1 = P.contact.wallGridFor(c.walls);
  let same = true;
  for (let k = 0; k < 5; k++) { P.contact.wallsNear(c.walls, 500, 500, 3, 2); P.sensors.readAll({ x: 500, y: 3, theta: 0 }, c.walls, []); if (P.contact.wallGridFor(c.walls) !== g1) same = false; }
  if (!same) bBad.push('衝突用とセンサー用のグリッドを交互に引くと作り直している（上限が小さすぎる）');
  // LRU の順序 (層 4 レビューの指摘で追加): セル寸法を 4 通り s1→s2→s3→s1→s4→s3→s2 の順に引く。上限 3 なら s1 を
  // 引き直した時点で s1 が直近へ繰り上がり、s4 で追い出されるのは最も長く使っていない s2。∴ 2 回目の s1・s3 は同じ
  // グリッド (作り直さない)、最後の s2 は作り直し (別のオブジェクト)。
  const lruOrder = (T) => {
    const cl = accept(T, longWalls(40, 200));
    const at = (k) => { T.cfg.setRegimeScale(1); T.cfg.setCarScale(k); return T.contact.wallGridFor(cl.walls); };
    const g1 = at(1.1), g2 = at(1.2), g3 = at(1.3);
    const g1b = at(1.1); at(1.4); const g3b = at(1.3), g2b = at(1.2);
    return { ok: g1b === g1 && g3b === g3 && g2b !== g2, detail: `s1 再利用 ${g1b === g1}・s3 再利用 ${g3b === g3}・s2 作り直し ${g2b !== g2}` };
  };
  { const r = lruOrder(P); console.log(`   LRU の順序: ${r.detail}`); if (!r.ok) bBad.push(`LRU の順序が違う（${r.detail}）`); }
  for (const [name, edits] of [
    ['直近へ繰り上げない', { 'contact_v2.js': [['      if (i > 0) { list.splice(i, 1); list.unshift(e); }', '']] }],
    ['最も新しいものから捨てる', { 'contact_v2.js': [['  if (list.length > GRID_CACHE_MAX) list.length = GRID_CACHE_MAX;', '  if (list.length > GRID_CACHE_MAX) list.splice(1, 1);']] }],
  ]) {
    const mT = await mutantTree(`LRU: ${name}`, edits, rot);
    if (mT) { const r = lruOrder(mT); if (r.ok) bBad.push(`変異「${name}」でも LRU の順序の検査が緑＝順序を見ていない`); }
  }
  // 変異: 上限を外す → 5 段で 5 個 (小さい治具で速く)
  const mLru = await mutantTree('グリッドの保持上限を外す', { 'contact_v2.js': [['export const GRID_CACHE_MAX = 3;', 'export const GRID_CACHE_MAX = 1e9;']] }, rot);
  if (mLru) {
    const cm = accept(mLru, longWalls(40, 200));   // 壁 32 本以上＝グリッド経路 (WALL_BP_MIN 未満は全走査でグリッドを作らない)
    for (let s = 5; s <= 9; s++) { mLru.cfg.setRegimeScale(1); mLru.cfg.setCarScale(s / 10); mLru.fitguard.settleFitRatio(cm, { regime: 'tabletop', userK: s / 10, slotCount: 1, reason: 'carScale' }, noFx(mLru)); }
    const nM = mLru.contact.wallGridCount(cm.walls);
    console.log(`   変異「保持上限を外す」: 5 段の後に ${nM} 個`);
    if (!(nM > MAX)) bBad.push(`変異「保持上限を外す」でも ${nM} 個＝保持数の検査が上限の有無を区別できない`);
  }
}
report('B) ② グリッドの保持', bBad);

// ════ C) ③ 毎フレームの壁走査 ════════════════════════════════════════════════════════════════
const cBad = [];
// 同じ 20,000 本で BE7 前の経路に対する時間の比の上限 (下の C4 の注記)。改修後の本ホスト実測: 測距 0.25〜0.26・扇 0.04 前後・深度ビュー 0.08 前後。
const C_GAIN_MAX = { sense: 0.6, fan: 0.3, depth: 0.3 };
// 記録スタブ ctx: 描画命令と引数・代入を順に記録する (canvas/getTransform を持たない＝course.js の間引きは働かない)。
const recCtx = () => {
  const log = [];
  const p = new Proxy({}, {
    get: (t, k) => {
      if (k === 'canvas' || k === 'getTransform') return undefined;
      return (...args) => {
        log.push([String(k), ...args.map((v) => (typeof v === 'object' && v !== null ? '[o]' : v))]);
        if (k === 'measureText') return { width: String(args[0]).length * 7 };
        return (typeof k === 'string' && k.startsWith('create')) ? { addColorStop: (...a) => log.push(['addColorStop', ...a]) } : undefined;
      };
    },
    set: (t, k, v) => { log.push(['=' + String(k), typeof v === 'object' && v !== null ? '[o]' : v]); return true; },
  });
  return { p, log };
};
// 1 フレームぶんの壁依存の計算を経路ごとに測る (main.js render が毎フレーム呼ぶもの: 全車の readAll・扇・深度ビュー)。
// 車 6 台は楕円の中心線上 (スタートの後ろへ等間隔・進行方向は接線) に置く＝実際に走る姿勢。描画は何もしないスタブ ctx。
const nopCtx = new Proxy({}, { get: (t, k) => ((k === 'canvas' || k === 'getTransform') ? undefined
  : (k === 'measureText' ? () => ({ width: 10 }) : ((typeof k === 'string' && k.startsWith('create')) ? () => ({ addColorStop() {} }) : () => {}))), set: () => true });
function frameParts(T, course, reps) {
  T.dyn.applyRegime('tabletop'); T.cfg.setCarScale(0.8); T.cfg.SENSOR_NOISE.on = false; T.cfg.SENSOR_OPTICS.on = false;
  const cars = [];
  for (let i = 0; i < 6; i++) { const f = -Math.PI / 2 - 0.22 * i; cars.push({ x: 1.6 + 1.2 * Math.cos(f), y: 1.1 + 0.75 * Math.sin(f), theta: Math.atan2(0.75 * Math.cos(f), -1.2 * Math.sin(f)) }); }
  const extras = cars.map((_, i) => cars.filter((__, j) => j !== i).map((c) => ({ x1: c.x - 0.03, y1: c.y - 0.03, x2: c.x + 0.03, y2: c.y + 0.03 })));
  const view = { pxPerM: 267, wPx: 856, hPx: 588, hM: course.bounds.h };
  const sens = cars.map((c, i) => T.sensors.readAll(c, course.walls, extras[i]));
  const others = cars.slice(1).map((c) => ({ ...c, color: '#ff0000' }));
  const K = 10;  // 1 標本 = K 回の平均 (960 本側は 1 回 0.5 ms 前後なのでタイマーの粒度と雑音に負けない)
  const part = (f) => { f(); const ts = []; for (let k = 0; k < reps; k++) ts.push(timeMs(() => { for (let j = 0; j < K; j++) f(); }) / K); return med(ts); };
  return {
    sense: part(() => cars.forEach((c, i) => T.sensors.readAll(c, course.walls, extras[i]))),
    fan: part(() => cars.forEach((c, i) => T.hud.drawSensors(nopCtx, sens[i], view, { show: true, walls: course.walls, extra: extras[i] }))),
    depth: part(() => T.depth.drawDepthView(nopCtx, 360, 200, cars[0], course.walls, others)),
  };
}
{
  const heavy = [accept(P, ovalDense(10000, 'BE7 dense oval 20k')), accept(P, comb()), accept(P, longWalls())];
  // C1) レイ照会 = 全壁走査 (値が同一・tMax 以上は Infinity)
  let rays = 0; const rayBad = [];
  const shipSome = ['ウェットテクニカル (雨)', 'オーバル', '競技サーキット (フルスケール)', '架空峠 ロング・ワインディング(中斜面)'].map((n) => P.course.buildFromSpec(specs.find((s) => s.name === n)));
  for (const c of [...heavy, ...shipSome]) for (const uk of [0.5, 1, 4]) {
    P.dyn.applyRegime('tabletop'); P.cfg.setCarScale(uk);
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const w of c.walls) { minx = Math.min(minx, w.x1, w.x2); miny = Math.min(miny, w.y1, w.y2); maxx = Math.max(maxx, w.x1, w.x2); maxy = Math.max(maxy, w.y1, w.y2); }
    for (let i = 0; i < 400; i++) {
      const ox = minx + (maxx - minx) * ((i * 0.618034) % 1), oy = miny + (maxy - miny) * ((i * 0.414214) % 1);
      const a = i * 2.39996, dx = Math.cos(a), dy = Math.sin(a);
      const tMax = [0.3, 2, 3.5, 50][i % 4] * Math.max(1, (maxx - minx) / 10);
      let full = Infinity;
      for (const w of c.walls) { const t = P.geom.raySeg(ox, oy, dx, dy, w.x1, w.y1, w.x2, w.y2); if (t < full) full = t; }
      const want = full < tMax ? full : Infinity;
      const got = P.contact.rayNearestWall(c.walls, ox, oy, dx, dy, tMax, 2 * P.cfg.CAR.length);
      rays++;
      if (got !== want && rayBad.length < 5) rayBad.push(`${c.name} cs${uk} ray#${i}: 照会 ${got} ≠ 全壁 ${want}`);
    }
  }
  console.log(`\nC) ③ レイ照会 ⇔ 全壁走査: ${rays} 本`);
  cBad.push(...rayBad);
  // C1b) 角をかすめるレイ (層 4 レビューの反例の型): 遠くのダミー壁 2,000 本 (グリッド経路に入る本数) ＋ 格子の角から
  //   1 ulp 内側に端点を置いた壁 1 本と、その角を狙ったレイ。DDA が角で片側のセルしか通らないと、丸めでその通らない
  //   セルにだけ登録された壁を見落とす。角の両隣を見る修正を外した変異で食い違いが出ること (検出力) も確かめる。
  const cornerRays = (T, cs, count) => {
    const f64 = new Float64Array(1), u64 = new BigInt64Array(f64.buffer);
    const nudge = (x, n) => { f64[0] = x; u64[0] += BigInt(x >= 0 ? n : -n); return f64[0]; };
    let seed = 4242; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const dummies = []; for (let i = 0; i < 2000; i++) dummies.push({ x1: 500 + (i % 50), y1: 500 + Math.floor(i / 50), x2: 500.5 + (i % 50), y2: 500 + Math.floor(i / 50) });
    let hits = 0, bad = 0;
    for (let it = 0; it < count; it++) {
      const k = 1 + Math.floor(rnd() * 5), m = 1 + Math.floor(rnd() * 5), Cx = k * cs, Cy = m * cs;
      const ox = (k - 1) * cs + (0.05 + 0.9 * rnd()) * cs, oy = (m - 1) * cs + (0.05 + 0.9 * rnd()) * cs;
      let dx = Cx - ox, dy = Cy - oy; const L = Math.hypot(dx, dy);
      dx = nudge(dx / L, Math.floor(rnd() * 5) - 2); dy = nudge(dy / L, Math.floor(rnd() * 5) - 2);
      const upLeft = rnd() < 0.5;
      const E = upLeft ? { x: nudge(Cx, -1), y: Cy } : { x: Cx, y: nudge(Cy, -1) };
      const F = upLeft ? { x: Cx - 0.05 - 0.2 * rnd(), y: Cy + 0.05 + 0.2 * rnd() } : { x: Cx + 0.05 + 0.2 * rnd(), y: Cy - 0.05 - 0.2 * rnd() };
      const wall = rnd() < 0.5 ? { x1: E.x, y1: E.y, x2: F.x, y2: F.y } : { x1: F.x, y1: F.y, x2: E.x, y2: E.y };
      const walls = [...dummies, wall];
      let full = Infinity; for (const w of walls) { const t = T.geom.raySeg(ox, oy, dx, dy, w.x1, w.y1, w.x2, w.y2); if (t < full) full = t; }
      const want = full < 2 ? full : Infinity;
      if (want !== Infinity) hits++;
      if (T.contact.rayNearestWall(walls, ox, oy, dx, dy, 2, cs) !== want) bad++;
    }
    return { hits, bad };
  };
  {
    const cr = [0.38, 0.304].map((cs) => cornerRays(P, cs, 1500));
    const hits = cr.reduce((a, r) => a + r.hits, 0), bad = cr.reduce((a, r) => a + r.bad, 0);
    console.log(`   角をかすめるレイ: ${cr.length * 1500} 本（全壁走査で当たり ${hits} 本）・食い違い ${bad} 本`);
    if (bad) cBad.push(`角をかすめるレイで全壁走査と ${bad} 本食い違う`);
    if (!(hits > 100)) cBad.push(`角をかすめるレイの当たりが ${hits} 本しかない（治具が角を狙えていない）`);
    const mCorner = await mutantTree('角の両隣を見ない', { 'contact_v2.js': [['    if (Math.abs(tnx - tny) <= 1e-9 * (1 + tExit)) {', '    if (false) {']] }, rot);
    if (mCorner) {
      const badM = [0.38, 0.304].map((cs) => cornerRays(mCorner, cs, 1500)).reduce((a, r) => a + r.bad, 0);
      console.log(`     変異「角の両隣を見ない」では食い違い ${badM} 本`);
      if (!(badM > 0)) cBad.push('変異「角の両隣を見ない」でも食い違いが出ない＝角の検査が効いていない');
    }
  }
  // C1c) 軸にほぼ平行なレイが格子線の上を走る (層 4 レビュー 2 回目の反例の型): 水平/垂直なレイ (方向の片成分が 0 か
  //   1e-16 級＝車の向きが 0・π/2・π のときの扇の中心方向) の原点を格子線 m·cs ちょうど (と ±1 ulp) に置き、端点が
  //   その線から 1〜2 ulp 反対側の行 (列) へずれた長い壁を置く。ダミー壁 2,000 本でグリッド経路に入れる。
  const axisRays = (T, cs, count) => {
    const f64 = new Float64Array(1), u64 = new BigInt64Array(f64.buffer);
    const nudge = (x, n) => { f64[0] = x; u64[0] += BigInt(x >= 0 ? n : -n); return f64[0]; };
    let seed = 2024; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const dummies = []; for (let i = 0; i < 2000; i++) dummies.push({ x1: 500 + (i % 50), y1: 500 + Math.floor(i / 50), x2: 500.5 + (i % 50), y2: 500 + Math.floor(i / 50) });
    let hits = 0, bad = 0;
    for (let it = 0; it < count; it++) {
      const vertical = rnd() < 0.5, m = 1 + Math.floor(rnd() * 8), sgn = rnd() < 0.5 ? 1 : -1;
      const line = nudge(m * cs, Math.floor(rnd() * 3) - 1);          // 格子線ちょうど (±1 ulp)
      const along = 0.05 + rnd() * 2;
      const tiny = [0, 1e-16, -1e-16][Math.floor(rnd() * 3)];
      const side = rnd() < 0.5 ? -1 : 1;
      const endOff = nudge(line, side * (1 + Math.floor(rnd() * 2)));  // 端点は線から 1〜2 ulp
      const far = line + side * (1 + 6 * rnd());
      const at = along + sgn * (0.1 + rnd() * 1.2), at2 = at + (rnd() - 0.5) * 0.3;
      let ox, oy, dx, dy, wall;
      if (!vertical) { ox = along; oy = line; dx = sgn; dy = tiny; wall = { x1: at, y1: endOff, x2: at2, y2: far }; }
      else { ox = line; oy = along; dx = tiny; dy = sgn; wall = { x1: endOff, y1: at, x2: far, y2: at2 }; }
      if (rnd() < 0.5) wall = { x1: wall.x2, y1: wall.y2, x2: wall.x1, y2: wall.y1 };
      const walls = [...dummies, wall];
      let full = Infinity; for (const w of walls) { const t = T.geom.raySeg(ox, oy, dx, dy, w.x1, w.y1, w.x2, w.y2); if (t < full) full = t; }
      const want = full < 2 ? full : Infinity;
      if (want !== Infinity) hits++;
      if (T.contact.rayNearestWall(walls, ox, oy, dx, dy, 2, cs) !== want) bad++;
    }
    return { hits, bad };
  };
  {
    const ar = [0.38, 0.304, 0.76].map((cs) => axisRays(P, cs, 3000));
    const hits = ar.reduce((a, r) => a + r.hits, 0), bad = ar.reduce((a, r) => a + r.bad, 0);
    console.log(`   軸に平行なレイ（格子線の上）: ${ar.length * 3000} 本（全壁走査で当たり ${hits} 本）・食い違い ${bad} 本`);
    if (bad) cBad.push(`軸に平行なレイで全壁走査と ${bad} 本食い違う`);
    if (!(hits > 100)) cBad.push(`軸に平行なレイの当たりが ${hits} 本しかない（治具が格子線を狙えていない）`);
    const mAxis = await mutantTree('格子線の反対側を見ない', { 'contact_v2.js': [['  const onLineY = Math.abs(dy) * tMax <= epsY && Math.abs(oy - lineY * cs) <= epsY;', '  const onLineY = false;']] }, rot);
    if (mAxis) {
      const badM = [0.38, 0.304, 0.76].map((cs) => axisRays(mAxis, cs, 3000)).reduce((a, r) => a + r.bad, 0);
      console.log(`     変異「格子線の反対側を見ない」では食い違い ${badM} 本`);
      if (!(badM > 0)) cBad.push('変異「格子線の反対側を見ない」でも食い違いが出ない＝軸平行の検査が効いていない');
    }
  }
  // C2) 扇 = fanDepths(全壁) の byte 一致 (重いコース・車の位置の近くの姿勢)
  let fans = 0; const fanBad = [];
  const half = P.cfg.SENSOR_FOV.halfRad;
  const a = new Float64Array(25), b = new Float64Array(25);
  for (const c of heavy) {
    P.dyn.applyRegime('tabletop'); P.cfg.setCarScale(0.8);
    const maxM = P.cfg.SENSOR_RANGE.maxMm / 1000;
    for (let i = 0; i < 60; i++) {
      const pose = { x: c.start.x + 0.9 * Math.cos(i), y: c.start.y + 0.4 * Math.sin(i * 1.7), theta: i * 0.77 };
      for (const s of P.sensors.readAll(pose, c.walls, [])) {
        P.contact.fanDepthsNear(c.walls, s.origin.x, s.origin.y, s.dir.x, s.dir.y, half, 24, maxM, null, a, 2 * P.cfg.CAR.length);
        P.geom.fanDepths(s.origin.x, s.origin.y, s.dir.x, s.dir.y, half, 24, maxM, c.walls, null, b);
        fans++;
        for (let k = 0; k <= 24; k++) if (a[k] !== b[k]) { if (fanBad.length < 5) fanBad.push(`${c.name} pose#${i} k=${k}: ${a[k]} ≠ ${b[k]}`); break; }
      }
    }
  }
  console.log(`   扇 fanDepthsNear ⇔ fanDepths(全壁): ${fans} 扇`);
  cBad.push(...fanBad);
  // C3) BE7 前の経路 (変異ツリー: contact_v2.js から BE7 の名前を外す＝古い contact_v2.js／sensors.js の飛ばしを外す) と
  //     描画命令列・測距が同一 (重いコース＋出荷 66 本)。**同じ変異ツリーが「古い contact_v2.js がキャッシュに残る
  //     ブラウザ」の再現も兼ねる** (hud.js/depth.js/fleet.js が読み込めて、従来の経路で同じ絵・同じ配置になる)。
  const OLD = { 'contact_v2.js': [['export function anyWallNearSeg(', 'function anyWallNearSeg('], ['export function rayNearestWall(', 'function rayNearestWall('],
    ['export function fanDepthsNear(', 'function fanDepthsNear('], ['export function wallGridCount(', 'function wallGridCount('], ['export const GRID_CACHE_MAX = 3;', 'const GRID_CACHE_MAX = 3;'],
      ['export function rayGridWorth(', 'function rayGridWorth(']],
    'sensors.js': [['const SENSE_PRUNE_MIN = 16;', 'const SENSE_PRUNE_MIN = Infinity;']] };
  const O = await mutantTree('BE7 前の経路', OLD, rot);
  if (O) {
    const removed = ['anyWallNearSeg', 'rayNearestWall', 'rayGridWorth', 'fanDepthsNear', 'wallGridCount', 'GRID_CACHE_MAX'].filter((k) => k in O.contact);
    if (removed.length) cBad.push(`変異ツリーに BE7 の名前が残っている: ${removed.join(', ')}（古い contact_v2.js を再現できていない）`);
    let n3 = 0; const d3 = [];
    // 条件: 重いコースと出荷の一部 (壁の多い・少ない・フルスケール) は 3 領域 × 3 倍率、残りの出荷は卓上 cs0.8。
    //   (層 4 レビューの指摘: 当初は卓上 cs0.8 だけで、中/フルスケールの飛ばし・扇・深度ビューを見ていなかった)
    const WIDE = new Set(['ウェットテクニカル (雨)', 'オーバル', '峠③ 高速ヘアピン (大R下り)', '競技サーキット (フルスケール)', 'スピードウェイ', 'ドリフト広場 (ショー会場)']);
    const conds = (wide) => (wide ? ['tabletop', 'midscale', 'fullscale'].flatMap((r) => [0.5, 1, 2].map((uk) => [r, uk])) : [['tabletop', 0.8]]);
    const pairs = [...heavy.map((c) => [c, O.course.normalizeCourse(JSON.parse(JSON.stringify({ name: c.name, bounds: c.bounds, start: c.start, finish: c.finish, walls: c.walls }))), true]),
      ...specs.map((s) => [P.course.buildFromSpec(s), O.course.buildFromSpec(s), WIDE.has(s.name)])];
    if (pairs.filter((x) => x[2]).length !== heavy.length + WIDE.size) cBad.push('C3 の 3 領域の対象コースが名前で見つからない（コース名が変わった）');
    for (const [cp, co, wide] of pairs) for (const [reg, uk] of conds(wide)) {
      for (const T of [P, O]) { T.dyn.applyRegime(reg); T.cfg.setCarScale(uk); T.cfg.SENSOR_NOISE.on = false; }
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const w of cp.walls) { minx = Math.min(minx, w.x1, w.x2); miny = Math.min(miny, w.y1, w.y2); maxx = Math.max(maxx, w.x1, w.x2); maxy = Math.max(maxy, w.y1, w.y2); }
      for (let i = 0; i < 12; i++) {
        const pose = { x: minx + (maxx - minx) * ((i * 0.618034 + 0.1) % 1), y: miny + (maxy - miny) * ((i * 0.414214 + 0.2) % 1), theta: i * 1.3 };
        const extra = [{ x1: pose.x + 0.3, y1: pose.y - 0.1, x2: pose.x + 0.3, y2: pose.y + 0.1 }];
        for (const optics of [false, true]) {
          P.cfg.SENSOR_OPTICS.on = optics; O.cfg.SENSOR_OPTICS.on = optics;
          const sp = [...P.sensors.readAll(pose, cp.walls, extra), P.sensors.readRear(pose, cp.walls, extra)];
          const so = [...O.sensors.readAll(pose, co.walls, extra), O.sensors.readRear(pose, co.walls, extra)];
          n3++; if (JSON.stringify(sp) !== JSON.stringify(so)) d3.push(`測距 ${cp.name} ${reg} cs${uk} pose#${i} optics=${optics}`);
        }
        P.cfg.SENSOR_OPTICS.on = false; O.cfg.SENSOR_OPTICS.on = false;
        const sp = P.sensors.readAll(pose, cp.walls, extra), so = O.sensors.readAll(pose, co.walls, extra);
        const view = { pxPerM: 200, wPx: 800, hPx: 600, hM: maxy + 0.5 };
        const lp = recCtx(), lo = recCtx();
        P.hud.drawSensors(lp.p, sp, view, { show: true, walls: cp.walls, extra, labels: true });
        O.hud.drawSensors(lo.p, so, view, { show: true, walls: co.walls, extra, labels: true });
        n3++; if (JSON.stringify(lp.log) !== JSON.stringify(lo.log)) d3.push(`扇の描画 ${cp.name} ${reg} cs${uk} pose#${i}`);
        const others = [{ x: pose.x + 0.4 * Math.cos(pose.theta), y: pose.y + 0.4 * Math.sin(pose.theta), theta: 0, color: '#ff0000' }];
        const dp = recCtx(), dO = recCtx();
        P.depth.drawDepthView(dp.p, 360, 200, pose, cp.walls, others);
        O.depth.drawDepthView(dO.p, 360, 200, pose, co.walls, others);
        n3++; if (JSON.stringify(dp.log) !== JSON.stringify(dO.log)) d3.push(`深度ビュー ${cp.name} ${reg} cs${uk} pose#${i}`);
      }
    }
    console.log(`   BE7 前の経路（古い contact_v2.js＋飛ばし無しの測距）と測距・扇・深度ビューの描画命令列: ${n3} 件で比較`);
    cBad.push(...d3.slice(0, 10));
    // C4) 1 フレームぶんの壁依存の計算 (**回帰の検知線**であって受け入れ基準そのものではない。受け入れは実ブラウザの
    //     フレーム時間＝browser/check_be7_frame.mjs)。**同じ 20,000 本のコースで BE7 前の経路 (同じプロセスで同時に測る)
    //     に対する時間の比**を経路ごとに見る (ホストの速さが約分される・改修を戻すと比が 1 に近づいて赤)。
    //     「20,000 本 ÷ 同じ形の 960 本」の比は参考に出すだけにする: 測距は飛ばし判定 (外接矩形の比較) 自体が候補の全壁を
    //     1 本ずつ見るので壁の本数への比例が残り (傾きが約 1/4 になるだけ)、扇・深度ビューのレイ照会はレイが通るセルの壁
    //     だけを見るので**局所の密度**に比例する (同じ形で壁を 20 倍にするとセルあたりの壁も 20 倍)。どちらも総数への比の
    //     上限としては揺れが大きい (本ホストで扇 2.96〜4.57・深度ビュー 3.14〜7.05)。
    const d20 = accept(P, ovalDense(10000, 'd20k')), d960 = accept(P, ovalDense(480, 'd960'));
    const o20 = O.course.normalizeCourse(ovalDense(10000, 'd20k')), o960 = O.course.normalizeCourse(ovalDense(480, 'd960'));
    const a20 = frameParts(P, d20, 7), a960 = frameParts(P, d960, 7), b20 = frameParts(O, o20, 5), b960 = frameParts(O, o960, 5);
    for (const [k, label] of [['sense', '測距 readAll×6'], ['fan', '扇 drawSensors×6'], ['depth', '深度ビュー']]) {
      const r = a20[k] / b20[k], lim = C_GAIN_MAX[k];
      console.log(`   ${label}（壁 20,000 本）: 改修後 ${a20[k].toFixed(2)} ms ÷ BE7 前の経路 ${b20[k].toFixed(2)} ms = ${r.toFixed(3)}（上限 ${lim}・余裕 ${(lim / r).toFixed(1)} 倍）`
        + `／ 参考: 20,000 ÷ 960 本の比 改修後 ${(a20[k] / a960[k]).toFixed(1)}・前 ${(b20[k] / b960[k]).toFixed(1)}`);
      if (!(r <= lim)) cBad.push(`${label}: BE7 前の経路に対する時間の比 ${r.toFixed(3)} が ${lim} を超えた（改修が効いていない）`);
    }
    // C5) 壁の少ない・疎な出荷コースで遅くしないこと (層 4 レビューが「扇・深度ビューが最大 3 倍遅くなる」と実測した組み合わせ)。
    //   レイ照会は「通りうるセル数 × 費用 ≥ 壁数」なら BE7 前と同じ経路へ落ちる (contact_v2.js rayWorthGrid)。
    //   3 つの組み合わせの扇＋深度ビューの時間の合計を BE7 前の経路と比べ、C5_SLOW_MAX 倍以内であること。
    const C5_SLOW_MAX = 1.3, C5_ONE_MAX = 1.5;   // 合計の上限・1 組み合わせの上限 (1 組は 0.1〜0.4 ms で雑音が大きい)
    // 計り方: 改修後 (P) と BE7 前 (O) を**交互に** 11 回測り、組ごとの比の中央値で判定する (1 組は 0.2〜0.4 ms しかなく、
    //   片方ずつまとめて測ると GC や JIT の時期の違いで 1.5 倍前後ぶれた＝2026-09-25 の全数実行で峠① が 1.55 倍と出て、
    //   単独で測り直すと 1.00〜1.23 倍だった)。両者は別のモジュール実体なので、領域・倍率の状態は互いに干渉しない。
    const shipEnv = (T, name, reg, uk) => {
      const c = T.course.buildFromSpec(specs.find((x) => x.name === name));
      T.dyn.applyRegime(reg); T.cfg.setCarScale(uk); T.cfg.SENSOR_NOISE.on = false; T.cfg.SENSOR_OPTICS.on = false;
      const st = c.start, cars = [0, 1, 2].map((i) => ({ x: st.x - 0.3 * i * T.cfg.CAR.length, y: st.y, theta: st.theta }));
      const view = { pxPerM: 600 / Math.max(c.bounds.w, c.bounds.h), wPx: 600, hPx: 600, hM: c.bounds.h };
      const sens = cars.map((car) => T.sensors.readAll(car, c.walls, []));
      const K = 20;
      return () => timeMs(() => { for (let j = 0; j < K; j++) { cars.forEach((car, i) => T.hud.drawSensors(nopCtx, sens[i], view, { show: true, walls: c.walls, extra: [] })); T.depth.drawDepthView(nopCtx, 360, 200, cars[0], c.walls, []); } }) / K;
    };
    const C5_COMBOS = [['峠③ 高速ヘアピン (大R下り)', 'tabletop', 0.8], ['競技サーキット (フルスケール)', 'tabletop', 0.5], ['競技サーキット (フルスケール)', 'tabletop', 0.8],
      ['スピードウェイ', 'fullscale', 1], ['峠① 中速ヘアピン (緩い下り)', 'tabletop', 0.8]];
    const c5 = (X) => {   // X (改修後 or 変異) を BE7 前 O と交互に測る
      let tX = 0, tO = 0; const out = [];
      for (const [name, reg, uk] of C5_COMBOS) {
        const fX = shipEnv(X, name, reg, uk), fO = shipEnv(O, name, reg, uk);
        for (let w = 0; w < 30; w++) { fX(); fO(); }   // 十分に温める
        const ta = [], tb = [], rs = [];
        for (let k = 0; k < 11; k++) { const x = fX(), y = fO(); ta.push(x); tb.push(y); rs.push(x / y); }
        const a = med(ta), b = med(tb);
        tX += a; tO += b; out.push({ name, reg, uk, a, b, r: med(rs) });
      }
      return { tX, tO, out };
    };
    const cp = c5(P);
    const tNew = cp.tX, tOld = cp.tO;
    const rows = cp.out.map((o) => `${o.name} ${o.reg} cs${o.uk} ${o.a.toFixed(3)}/${o.b.toFixed(3)}（比の中央値 ${o.r.toFixed(2)}）`);
    for (const o of cp.out) if (!(o.r <= C5_ONE_MAX)) cBad.push(`壁の少ない出荷コース「${o.name}」${o.reg} cs${o.uk} で扇・深度ビューが BE7 前より ${o.r.toFixed(2)} 倍遅い（1 組の上限 ${C5_ONE_MAX}）`);
    // 検出力: 「割に合うときだけレイ照会」を外す (常にレイ照会) と合計の比が上限を超える (層 4 レビュー 2 回目が手で実測した型)
    const mWorth = await mutantTree('レイ照会を常に使う', { 'contact_v2.js': [['  return n >= WALL_BP_MIN && (2 * Math.ceil(tMax / cell) + 2) * RAY_CELL_COST < n;', '  return n >= WALL_BP_MIN;'],
      ['  return 2 * RAY_HIT_CELLS * gridFor(walls, cell)._fill < n;   // セルが粗い', '  return true;']] }, rot);
    if (mWorth) {
      const cm = c5(mWorth);
      console.log(`     変異「レイ照会を常に使う」では 合計 ${(cm.tX / cm.tO).toFixed(2)} 倍`);
      if (!(cm.tX / cm.tO > C5_SLOW_MAX)) cBad.push(`変異「レイ照会を常に使う」でも合計 ${(cm.tX / cm.tO).toFixed(2)} 倍＝C5 が経路の選び方を見ていない`);
    }
    console.log(`   壁の少ない出荷コースの扇＋深度ビュー: 改修後 ${tNew.toFixed(3)} ms ÷ BE7 前 ${tOld.toFixed(3)} ms = ${(tNew / tOld).toFixed(2)}（上限 ${C5_SLOW_MAX}）／ ${rows.join('・')}`);
    if (!(tNew / tOld <= C5_SLOW_MAX)) cBad.push(`壁の少ない出荷コースで扇・深度ビューが BE7 前より ${(tNew / tOld).toFixed(2)} 倍遅い（上限 ${C5_SLOW_MAX}）`);
  }
}
report('C) ③ 毎フレームの壁走査', cBad);

// ════ D) 読み込み互換 (構造) ════════════════════════════════════════════════════════════════
// **改修前 (公開 7772773) の contact_v2.js の export 名**。ブラウザが古い contact_v2.js を持ったまま新しい importer を取ると、
// ここに無い名前の名前付き import は `does not provide an export named` でモジュールグラフ全体を落とす (BA1 で実測)。
const PRE_BE7_CONTACT = ['V2_CONTACT', 'WALL_BP_MIN', 'buildWallGrid', 'queryAABB', 'queryRadius', 'resolveFleetContacts', 'slopOf', 'vCrashOf', 'wallGridFor', 'wallsNear'];
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => (/:\/\//.test(l) ? l : l.replace(/\/\/.*$/, ''))).join('\n');
function listJs(dir) { const out = []; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...listJs(p)); else if (e.name.endsWith('.js')) out.push(p); } return out; }
const SRCS = Object.fromEntries(listJs(JS).map((p) => [path.relative(JS, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8')]));
// import 指定子 → public/js からの相対パス (クエリ・ハッシュ付きの指定子も同じモジュールとして数える・層 4 レビュー 2 回目)
const specTarget = (rel, spec) => path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec.replace(/[?#].*$/, '')));
function checkStructural(srcs) {
  const v = [];
  let seen = 0;
  for (const [rel, raw] of Object.entries(srcs)) {
    const src = strip(raw);
    for (const m of src.matchAll(/(?:import|export)\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {   // 再 export も同じ扱い
      const target = specTarget(rel, m[2]);
      if (target !== 'contact_v2.js') continue;
      seen++;
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name && !PRE_BE7_CONTACT.includes(name)) v.push(`${rel} が contact_v2.js から改修前に無かった名前「${name}」を名前付き import している（名前空間 import で「あれば使う」にすること）`);
      }
    }
  }
  if (seen < 3) v.push(`contact_v2.js からの名前付き import を ${seen} 件しか見つけられない（検査が空振り）`);
  // 名前空間 import で受けた contact_v2.js の名前は、**使う名前ごとに**存在を確かめてから使う (層 4 レビューの指摘:
  // 既知の 3 か所以外に確かめずに呼ぶ行を足しても、上の個別の正規表現では捕まらなかった)。
  // 「typeof NS.名前」か「const 変数 = NS.名前; … typeof 変数」のどちらかがそのファイルに在ること。
  //   (層 4 レビュー 2 回目のすり抜け 5 種を受けて強化) 名前空間は「NS.名前」の形でしか使わせない (別名への代入・
  //   角括弧・分割代入は禁止)。**使うたびに**確認があること: 「typeof NS.名前 === 'function' ? NS.名前」の三項か、
  //   「const 変数 = NS.名前; … typeof 変数」の代入のどちらかで、NS.名前 の出現 (typeof を除く) の数とその形の数が等しい。
  for (const [rel, raw] of Object.entries(srcs)) {
    const src = strip(raw);
    if (/export\s*\*\s*(?:as\s+\w+\s*)?from\s*['"]([^'"]+)['"]/.test(src)
      && [...src.matchAll(/export\s*\*\s*(?:as\s+\w+\s*)?from\s*['"]([^'"]+)['"]/g)].some((m) => specTarget(rel, m[1]) === 'contact_v2.js'))
      v.push(`${rel} が contact_v2.js を export * で再 export している（名前の集合を検査できない）`);
    for (const m of src.matchAll(/import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g)) {
      if (specTarget(rel, m[2]) !== 'contact_v2.js') continue;
      const ns = m[1];
      const body = src.replace(m[0], '');
      if (new RegExp(`\\b${ns}\\b(?!\\s*\\.\\s*\\w)`).test(body)) v.push(`${rel} が名前空間 ${ns} を「${ns}.名前」以外の形 (別名への代入・角括弧・分割代入など) で使っている`);
      const used = new Set([...body.matchAll(new RegExp(`\\b${ns}\\s*\\.\\s*(\\w+)`, 'g'))].map((x) => x[1]));
      for (const name of used) {
        if (PRE_BE7_CONTACT.includes(name)) continue;
        const count = (re) => (body.match(re) || []).length;
        const all = count(new RegExp(`\\b${ns}\\s*\\.\\s*${name}\\b`, 'g'));
        const inTypeof = count(new RegExp(`typeof\\s+${ns}\\s*\\.\\s*${name}\\b`, 'g'));
        const tern = count(new RegExp(`typeof\\s+${ns}\\.${name}\\s*===\\s*'function'\\s*\\?\\s*${ns}\\.${name}\\b`, 'g'));
        const assign = [...body.matchAll(new RegExp(`const\\s+(\\w+)\\s*=\\s*${ns}\\.${name}\\s*;`, 'g'))]
          .filter((a) => new RegExp(`typeof\\s+${a[1]}\\b`).test(body.slice(a.index, a.index + 240))).length;
        if (all - inTypeof !== tern + assign)
          v.push(`${rel} が ${ns}.${name} を確認なしで使う箇所がある（使用 ${all - inTypeof}・確認つき ${tern + assign}）＝古い contact_v2.js では undefined を呼んで落ちる`);
      }
    }
  }
  const need = [
    ['fleet.js', /^import \* as contactParts from '\.\/contact_v2\.js';$/m, 'fleet.js が contact_v2.js を名前空間 import していない'],
    ['fleet.js', /const near = contactParts\.anyWallNearSeg;\s*if \(typeof near !== 'function'\) return segClearOfWalls\(ax, ay, bx, by, walls\);/, 'fleet.js の見通し判定が「無ければ全走査」になっていない'],
    ['hud.js', /^import \* as contactParts from '\.\/contact_v2\.js';$/m, 'hud.js が contact_v2.js を名前空間 import していない'],
    ['hud.js', /typeof contactParts\.fanDepthsNear === 'function'\s*\?\s*contactParts\.fanDepthsNear\(/, 'hud.js の扇が「あれば fanDepthsNear」になっていない'],
    ['depth.js', /^import \* as contactParts from '\.\/contact_v2\.js';$/m, 'depth.js が contact_v2.js を名前空間 import していない'],
    ['depth.js', /const nearFn = typeof contactParts\.rayNearestWall === 'function' \? contactParts\.rayNearestWall : null;/, 'depth.js のレイが「あれば rayNearestWall」になっていない'],
    ['depth.js', /const near = nearFn && worthFn && worthFn\(walls, RAY_MAX, cellM\) \? nearFn : null;/, 'depth.js がレイ照会の要否を 1 フレームに 1 回決めていない'],
    ['fleet.js', /function\* corridorCandidates\(course, st, maxPts = 600, maxNodes = 10 \* maxPts\) \{/, 'fleet.js の廊下 BFS に発見ノード数の上限 (maxNodes = 10 * maxPts) が無い'],
    ['fleet.js', /if \(q\.length >= maxNodes\) return;/, 'fleet.js の廊下 BFS が上限に達しても探索を続ける'],
  ];
  for (const [f, re, msg] of need) if (!re.test(strip(srcs[f] || ''))) v.push(msg);
  return v;
}
const structural = checkStructural(SRCS);
console.log(`\nD) 読み込み互換（public/js 配下 ${Object.keys(SRCS).length} ファイル）`);
report('D) 構造条件の違反', structural);
{
  const M = (f, from, to) => ({ ...SRCS, [f]: SRCS[f].replace(from, to) });
  const MUTS = [
    ['depth.js が rayNearestWall を名前付き import する', M('depth.js', "import * as contactParts from './contact_v2.js';", "import * as contactParts from './contact_v2.js';\nimport { rayNearestWall } from './contact_v2.js';")],
    ['hud.js が既存の import 行へ fanDepthsNear を足す', M('hud.js', "import { wallsNear } from './contact_v2.js';", "import { wallsNear, fanDepthsNear } from './contact_v2.js';")],
    ['fleet.js が anyWallNearSeg を名前付き import する', M('fleet.js', "import { wallGridFor, resolveFleetContacts, vCrashOf } from './contact_v2.js';", "import { wallGridFor, resolveFleetContacts, vCrashOf, anyWallNearSeg } from './contact_v2.js';")],
    ['fleet.js が有無を確かめずに anyWallNearSeg を呼ぶ', M('fleet.js', "if (typeof near !== 'function') return segClearOfWalls(ax, ay, bx, by, walls);", '')],
    ['廊下 BFS の上限を外す', M('fleet.js', 'if (q.length >= maxNodes) return;', '')],
    ['廊下 BFS の上限を 10*maxPts から外す', M('fleet.js', 'maxNodes = 10 * maxPts) {', 'maxNodes = Infinity) {')],
    ['depth.js が二重引用符で rayNearestWall を名前付き import する（層 4 レビューの反例）', M('depth.js', "import * as contactParts from './contact_v2.js';", 'import * as contactParts from \'./contact_v2.js\';\nimport { rayNearestWall } from "./contact_v2.js";')],
    ['depth.js が確かめずに anyWallNearSeg を呼ぶ行を足す（層 4 レビューの反例）', M('depth.js', '  const cellM = 2 * CAR.length;', '  const cellM = 2 * CAR.length;\n  contactParts.anyWallNearSeg(walls, 0, 0, 1, 1, 1e-6, cellM, () => false);')],
    ['hud.js が確認済みの名前を 2 か所目で確認なしに呼ぶ（2 回目の反例 1）', M('hud.js', '  const col = opts.color || VIEW.ray;', '  const col = opts.color || VIEW.ray;\n  if (opts.walls) contactParts.fanDepthsNear(opts.walls, 0, 0, 1, 0, 0.1, 2, 1, null, [], 0.4);')],
    ['depth.js が角括弧で呼ぶ（2 回目の反例 2）', M('depth.js', '  const cellM = 2 * CAR.length;', "  const cellM = 2 * CAR.length;\n  contactParts['anyWallNearSeg'](walls, 0, 0, 1, 1, 1e-6, cellM, () => false);")],
    ['depth.js が分割代入で受ける（2 回目の反例 3）', M('depth.js', '  const cellM = 2 * CAR.length;', '  const cellM = 2 * CAR.length;\n  const { anyWallNearSeg } = contactParts;')],
    ['depth.js が新しい名前を再 export する（2 回目の反例 4）', M('depth.js', "import * as contactParts from './contact_v2.js';", "import * as contactParts from './contact_v2.js';\nexport { rayNearestWall } from './contact_v2.js';")],
    ['depth.js がクエリ付きの指定子で名前付き import する（2 回目の反例 5）', M('depth.js', "import * as contactParts from './contact_v2.js';", "import * as contactParts from './contact_v2.js';\nimport { rayNearestWall } from './contact_v2.js?v=2';")],
  ];
  const miss = [], noop = [];
  for (const [name, srcs] of MUTS) {
    if (Object.keys(srcs).every((k) => srcs[k] === SRCS[k])) { noop.push(`${name}（変異が適用されていない＝パターン腐り）`); continue; }
    if (checkStructural(srcs).length <= structural.length) miss.push(name);
  }
  console.log(`   変異 ${MUTS.length} 件を注入（product のファイルは読むだけ）`);
  report('D) 構造検査が見逃した変異', miss);
  report('D) 適用できなかった変異（パターン腐り）', noop);
}

report('取り込み検査 (std) を通らなかった治具（投稿できない形を測っていない）', intake);
report('適用できなかった変異ツリー（パターン腐り）', rot);
for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
console.log('\n' + '='.repeat(78));
console.log(pass ? 'BE7 重い投稿コースの計算量ゲート: 全パス ○' : 'BE7 重い投稿コースの計算量ゲート: ✗ 不合格');
console.log('='.repeat(78));
process.exit(pass ? 0 : 1);
