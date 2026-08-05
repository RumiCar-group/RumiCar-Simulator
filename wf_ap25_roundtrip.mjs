// AP25: course_editor の round-trip / 走行可能性 常設機械ゲート。
//
// 「エディタで作ったコースが (a) 生成関数を例外なく通り・非退化 (壁が落ちず bounds 有限)、
//  (b) JSON 直列化を byte 固定点で往復し、(c) 実レースエンジンで走れて (ハング/例外なし)、
//  (d) 既存出荷コースを無編集で往復しても走行ジオメトリが意味同値」であることを、
// 知覚でなく機械検査の失敗 (exit 1) として恒久担保する (CI-14)。
//
// ヘッドレス駆動可否 (冒頭固定条項): CourseEditor は DOM/物理に非依存の編集ロジックゆえ
// node から直接 import・駆動できる (実測済)。drawOverlay(ctx) だけが Canvas 依存だが本ゲートは
// 呼ばない。ゆえに縮小条項 (純関数部への縮小) は発動せず全編集操作を本物の CourseEditor で駆動する。
//
// 検査 (受け入れ基準 AP25 ①〜④):
//   G1 [①生成・例外0/非退化]  ≥5 種の編集操作列ごとに toJSON を **本番の 2 生成入口**へ通す:
//        normalizeCourse(j)               … 保存/コミュニティコースの生成入口
//        buildFromSpec({...j, kind:'raw'}) … raw コース (courses.json の 2 実例と同型) の生成入口
//      いずれも例外0、かつ **非退化** (壁本数=編集後の実本数を保持・bounds.w/h 有限>0・start 有限)。
//      注記 (CI-14 実態判定): kind を付けない buildFromSpec(j) は例外を出さないが loop 既定へ落ち
//      **編集した壁を全て捨て bounds=null** になる (退化)。ゆえに「例外0」だけを見る素朴読みは
//      走行可能性を保証せず本ゲートは非退化まで検査する (基準①の厳格化・緩和ではない)。
//   G2 [②byte 往復固定点]  各編集操作列で toJSON→JSON→(再 load)→toJSON が byte 一致 (直列化冪等)。
//   G3 [③走行可能・非ハング]  各生成コースで runRace(1周・実 PROGRAM) が例外なく返り、
//      決定論的な上限 tick 以内で終了 (無限ループでない=壁時計に十分な余裕)。
//   G4 [④既存コース往復・意味同値]  courses.json 全コースを buildFromSpec→editor→toJSON→normalizeCourse し、
//      走行ジオメトリ (壁集合[順不同]・start・finish[fx/fy 含む]・bounds) が最大偏差 0 で一致。
//
// 使い方:  node wf_ap25_roundtrip.mjs   (PASS なら exit 0・違反で exit 1)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CourseEditor } from './public/js/course_editor.js';
import { buildFromSpec, normalizeCourse, defaultCourse } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const specs = JSON.parse(readFileSync(join(HERE, 'public/data/courses.json'), 'utf8'));

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.log('  ✗ ' + m); fail++; };

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ≥5 種 (全 8 種) の編集操作を本物の CourseEditor で駆動して1コースを作る。
function drive(op) {
  const ed = new CourseEditor(defaultCourse());
  switch (op) {
    case 'wall':   ed.setMode('wall');   ed.click({ x: 0.5, y: 0.5 }); ed.click({ x: 1.0, y: 0.6 }); break;
    case 'draw':   ed.setMode('draw');   ed.startStroke({ x: 0.3, y: 0.3 }); ed.extendStroke({ x: 0.5, y: 0.45 }); ed.extendStroke({ x: 0.7, y: 0.7 }); ed.endStroke(); break;
    case 'curve':  ed.setMode('curve');  ed.startStroke({ x: 1.0, y: 1.0 }); ed.extendStroke({ x: 1.2, y: 1.15 }); ed.extendStroke({ x: 1.5, y: 1.3 }); ed.endStroke(); break;
    case 'poly':   ed.setMode('poly');   ed.click({ x: 2.0, y: 1.0 }); ed.click({ x: 2.2, y: 1.2 }); ed.click({ x: 2.4, y: 1.0 }); ed.finalizePoly(); break;
    case 'rect':   ed.setMode('rect');   ed.startRect({ x: 0.8, y: 0.6 }); ed.extendRect({ x: 1.2, y: 1.0 }); ed.endRect(); break;
    case 'start':  ed.setMode('start');  ed.click({ x: 0.4, y: 0.4 }); ed.click({ x: 0.6, y: 0.5 }); break;
    case 'finish': ed.setMode('finish'); ed.click({ x: 0.4, y: 0.1 }); ed.click({ x: 0.4, y: 0.6 }); break;
    case 'erase':  ed.setMode('erase');  ed.click({ x: 0.42, y: 0.0 }); break;  // 既定リングの壁付近を消去
    default: throw new Error('未知の編集操作: ' + op);
  }
  return ed;
}
const OPS = ['wall', 'draw', 'curve', 'poly', 'rect', 'start', 'finish', 'erase'];

// 走行ジオメトリの正規化キー (順不同の壁集合＋start/finish/bounds)。
function geomKey(c) {
  const w = [...c.walls]
    .map((x) => [x.x1, x.y1, x.x2, x.y2].map((v) => +(+v).toFixed(6)).join(',')).sort().join('|');
  const st = [c.start.x, c.start.y, c.start.theta].map((v) => +(+v).toFixed(6)).join(',');
  const fi = c.finish
    ? [c.finish.x1, c.finish.y1, c.finish.x2, c.finish.y2, c.finish.fx, c.finish.fy]
        .map((v) => +(+v).toFixed(6)).join(',')
    : 'none';
  const bd = [c.bounds.w, c.bounds.h].map((v) => +(+v).toFixed(6)).join(',');
  return JSON.stringify({ w, st, fi, bd });
}

// ---- 冒頭: ヘッドレス駆動可否の測定 (縮小条項の発動判定) ----
console.log('AP25 course_editor round-trip / 走行可能性ゲート');
console.log('■ ヘッドレス駆動可否:');
try {
  const ed = new CourseEditor(defaultCourse());
  ed.setMode('wall'); ed.click({ x: 0.5, y: 0.5 }); ed.click({ x: 1.0, y: 0.6 });
  const j = ed.toJSON();
  if (!Array.isArray(j.walls)) throw new Error('toJSON.walls が配列でない');
  ok('CourseEditor を node から import・駆動・toJSON 可 (縮小条項は非発動＝全操作を本物で駆動)');
} catch (e) {
  bad('CourseEditor をヘッドレス駆動できない: ' + e.message + ' (縮小条項=純関数部へ縮小が必要)');
}

// ---- G1: 生成入口を例外0・非退化で通る (≥5 種) ----
console.log('■ G1 [①]  ≥5 種編集操作 → 本番 2 生成入口 例外0・非退化:');
let g1MinWallKeep = Infinity;  // raw 生成での「編集壁本数 - 生成壁本数」の最悪 (0 が要件)
for (const op of OPS) {
  const ed = drive(op);
  const editWalls = ed.course.walls.length;
  const j = ed.toJSON();
  let normOk = false, rawOk = false, degen = '';
  try {
    const nc = normalizeCourse(j);
    normOk = Array.isArray(nc.walls) && isFiniteNum(nc.bounds.w) && nc.bounds.w > 0
      && isFiniteNum(nc.bounds.h) && nc.bounds.h > 0 && isFiniteNum(nc.start.x) && isFiniteNum(nc.start.theta);
    if (!normOk) degen += ' normalizeCourse 退化';
  } catch (e) { degen += ' normalizeCourse THREW:' + e.message; }
  try {
    const rc = buildFromSpec({ ...j, kind: 'raw' });
    const keep = editWalls - rc.walls.length;
    g1MinWallKeep = Math.min(g1MinWallKeep, keep === 0 ? 0 : -Math.abs(keep));
    rawOk = rc.walls.length === editWalls && isFiniteNum(rc.bounds.w) && rc.bounds.w > 0
      && isFiniteNum(rc.bounds.h) && rc.bounds.h > 0 && isFiniteNum(rc.start.x);
    if (!rawOk) degen += ` raw 退化(編集${editWalls}→生成${rc.walls.length}壁, bounds=${rc.bounds.w}x${rc.bounds.h})`;
  } catch (e) { degen += ' buildFromSpec(raw) THREW:' + e.message; }
  if (normOk && rawOk) ok(`${op.padEnd(7)} 例外0・非退化 (壁 ${editWalls} 本保持・bounds 有限)`);
  else bad(`${op.padEnd(7)}${degen}`);
}
// CI-14 実態注記: kind 無し buildFromSpec は「例外0」だが退化する (走行不能) ことを PIN。
{
  const ed = drive('draw');
  const editWalls = ed.course.walls.length;
  const nokind = buildFromSpec(ed.toJSON());  // kind を付けない素朴読み
  const isDegen = nokind.walls.length !== editWalls || !isFiniteNum(nokind.bounds.w);
  if (isDegen) ok(`kind 無し buildFromSpec は退化 (壁 ${editWalls}→${nokind.walls.length}・bounds.w=${nokind.bounds.w})＝「例外0」だけでは走行保証にならない (①厳格化の根拠)`);
  else bad('kind 無し buildFromSpec が非退化になった＝生成入口の前提変化 (基準①再設計要)');
}

// ---- G2: byte 往復固定点 ----
console.log('■ G2 [②]  toJSON→JSON→再load→toJSON byte 固定点:');
for (const op of OPS) {
  const ed = drive(op);
  const s1 = JSON.stringify(ed.toJSON());
  const s2 = JSON.stringify(new CourseEditor(normalizeCourse(JSON.parse(s1))).toJSON());
  if (s1 === s2) ok(`${op.padEnd(7)} byte 一致 (${s1.length} B)`);
  else bad(`${op.padEnd(7)} byte 不一致 (往復で変化)`);
}

// ---- G3: 走行可能・非ハング ----
console.log('■ G3 [③]  生成コースで runRace 例外なし・上限 tick 内終了:');
const field = [{ name: 't', lang: 'c', src: PROGRAMS[0].c, carType: 'std' }];
const MAXSEC = 10;
const TICK_CEIL = Math.ceil(MAXSEC * 60) + 5;  // 60Hz・決定論終了の上限 (超過=ハング疑い)
let g3MaxWallMs = 0, g3MaxTicks = 0;
for (const op of OPS) {
  const c = normalizeCourse(drive(op).toJSON());
  const t0 = process.hrtime.bigint();
  let r, err = null;
  try { r = runRace({ course: c, laps: 1, field, maxSec: MAXSEC, interact: false }); }
  catch (e) { err = e.message; }
  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
  g3MaxWallMs = Math.max(g3MaxWallMs, wallMs);
  if (err) { bad(`${op.padEnd(7)} runRace THREW: ${err}`); continue; }
  g3MaxTicks = Math.max(g3MaxTicks, r.ticks);
  if (r.ticks <= TICK_CEIL && Number.isFinite(r.simSec)) ok(`${op.padEnd(7)} 完走 ticks=${r.ticks}≤${TICK_CEIL} simSec=${r.simSec.toFixed(2)} wall=${wallMs.toFixed(0)}ms`);
  else bad(`${op.padEnd(7)} 上限超過/非有限 ticks=${r.ticks} simSec=${r.simSec} (ハング疑い)`);
}

// ---- G4: 既存コース無編集 round-trip 意味同値 ----
console.log('■ G4 [④]  courses.json 全コース buildFromSpec→editor→toJSON→normalizeCourse 意味同値:');
let g4Mism = 0;
for (const s of specs) {
  const a = buildFromSpec(s);
  const b = normalizeCourse(new CourseEditor(a).toJSON());
  if (geomKey(a) !== geomKey(b)) { g4Mism++; if (g4Mism <= 3) console.log('    差異: ' + (s.name || '(無名)')); }
}
if (g4Mism === 0) ok(`全 ${specs.length} コース 走行ジオメトリ最大偏差 0 (壁集合/start/finish[fx,fy]/bounds 一致)`);
else bad(`${specs.length} 中 ${g4Mism} コースで往復不一致 (走行ジオメトリ変化)`);

// ---- 連続量マージン要約 (CI-14) ----
console.log('■ マージン要約:');
console.log(`  G1 raw 壁保持 最悪 = ${g1MinWallKeep === 0 ? '0 (全保持)' : g1MinWallKeep}`);
console.log(`  G3 最大 ticks = ${g3MaxTicks}/${TICK_CEIL}・最大 wall = ${g3MaxWallMs.toFixed(0)}ms (無限ループでない余裕)`);
console.log(`  G4 往復不一致 = ${g4Mism}/${specs.length}`);

console.log('');
if (fail === 0) { console.log('✅ AP25 round-trip/走行可能性ゲート PASS (全検査合格)'); process.exit(0); }
else { console.log(`❌ AP25 round-trip/走行可能性ゲート FAIL (${fail} 件違反)`); process.exit(1); }
