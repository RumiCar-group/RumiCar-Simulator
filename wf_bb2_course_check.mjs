// Stage BB2 常設ゲート — 投稿コースの形式検査 `course.js:checkCourseData` を固定する。
//
// 背景（実測 2026-09-15）:
//   上流 RumiCar-group/RumiCar の courses/community/ は投稿の中身を検査しない（index.json は一覧を作るだけ）。
//   アプリは取ってきた JSON をそのまま `normalizeCourse` に渡していたので、`null`・walls が配列でない・壁に null を
//   選ぶと例外、座標が数値でないと描画エラーが出続けた（1.5 秒で 92 件）。BB2 で「形式が正しい投稿だけを一覧に載せ、
//   壊れた投稿は理由を言って除外する」ようにした。判定は DOM に触れない純関数 1 つで、ライブ（main.js の
//   loadCommunityCourses）と本ゲートが**同じ関数**を呼ぶ（CI-9・写しを作らない）。
//
// 検査:
//   A) 正常データを 1 件も落とさない: 出荷 courses.json の全コース（buildFromSpec の出力）と、それをコースエディタの
//      toJSON と同じ形（name/bounds/start/finish/walls）にして JSON を往復させたもの（＝利用者が投稿するファイルの形）が全部合格。
//      **上流の現行投稿は実ブラウザゲート browser/check_bb2_community_bad.mjs ① が本物を取りに行って見る**
//      （本ゲートは node_modules 不要・ネットワーク不要のまま保つ＝フレッシュクローン検証の前提）。
//   B) 形ごとの期待（実装前に固定した 13 形＋境界）: 除外/採用と、除外理由の JSON パスまで一致。
//   C) 合格したものは normalizeCourse が例外を投げず、出力の数値がすべて有限・bounds が正（＝検査が守りたい性質そのもの）。
//      正常なコースの 1 項目をいろいろな値へ差し替えた変種（決定論の擬似乱数・数千通り）で確かめる。すり抜けた変種を数える。
//   D) 変異試験: checkCourseData の中の判定を 1 つずつ壊すと A)〜C)・F) のどれかが赤になる（product は読むだけ・変異はメモリ上）。
//   E) 読み込み互換（BA-1 の教訓）: public/js 配下の全ファイルが course.js から**BB2 前に無かった名前**を名前付き import
//      していない／main.js は名前空間 import で受け、関数が無いときは検査を飛ばす形になっている。
//   F) 大きさの上限（層 4 レビュー 2026-09-15: 形が正しくても、遠い壁 1 本で壁グリッドの走査が終わらず、mm/m の取り違えで
//      メモリが尽きた）: 出荷全コースが上限に対してどれだけ余裕があるかを出し（無ければ赤）、上限ぎりぎりで合格する最悪形を
//      **本物の利用側**（fitguard の settleFitRatio・contact_v2 の buildWallGrid）に車体スケール最小/既定で通して、壁グリッドの
//      セル数が出荷最大コースの GRID_RATIO 倍以内に収まることを測る（壁時計でなくセル数で判定＝ホストの速さに依らない）。
//
// 使い方: node wf_bb2_course_check.mjs
import fs from 'fs';
import path from 'path';
import { buildFromSpec, normalizeCourse, checkCourseData } from './public/js/course.js';
import { settleFitRatio } from './public/js/fitguard.js';
import { buildWallGrid } from './public/js/contact_v2.js';
import * as config from './public/js/config.js';

let pass = true;
const report = (label, arr, n = 10) => {
  console.log(`  ${arr.length === 0 ? '○' : '✗'} ${label}: ${arr.length} 件`);
  arr.slice(0, n).forEach(s => console.log(`       - ${s}`));
  if (arr.length > n) console.log(`       … 他 ${arr.length - n} 件`);
  if (arr.length) pass = false;
};
const J = (v) => JSON.parse(JSON.stringify(v));

// ── A) 正常データ ────────────────────────────────────────────────────────────────
const specs = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
const editorShape = (c) => J({ name: c.name, bounds: c.bounds, start: c.start, finish: c.finish, walls: c.walls });
function runA(check) {
  const v = [];
  let n = 0;
  for (const s of specs) {
    const c = buildFromSpec(s);
    n++;
    for (const [what, data] of [['buildFromSpec の出力', c], ['エディタ形で JSON 往復', editorShape(c)],
      ['name_en/desc/desc_en 付きで JSON 往復', { ...editorShape(c), name_en: c.name_en ?? 'x', desc: c.desc ?? '', desc_en: c.desc_en ?? '' }]]) {
      let why;
      try { why = check(data); } catch (e) { why = `例外 ${e.message}`; }
      if (why !== null) v.push(`${s.name}（${what}）が不合格: ${why}`);
    }
  }
  // 壁を全消去し、ゴールラインの無いコースをエディタで書き出した形（finish: null）も正規の出力
  const cleared = J({ name: 'カスタム', bounds: { w: 3, h: 2 }, start: { x: 0.3, y: 0.3, theta: 0 }, finish: null, walls: [] });
  let cw;
  try { cw = check(cleared); } catch (e) { cw = `例外 ${e.message}`; }
  if (cw !== null) v.push(`壁 0 本・finish: null のエディタ出力が不合格: ${cw}`);
  return { v, n };
}
{
  const { v, n } = runA(checkCourseData);
  console.log(`A) 正常データ（出荷 courses.json ${n} 本 × 3 形＋エディタの空の出力）`);
  if (n !== specs.length || n < 60) v.push(`数えたコース ${n} 本が courses.json の ${specs.length} 本と合わない／少なすぎる`);
  report('A) 不合格にされた正常データ', v);
}

// ── B) 形ごとの期待 ─────────────────────────────────────────────────────────────
const W = [{ x1: 0, y1: 0, x2: 1, y2: 0 }];
const OK = null;
const CASES = [
  // 実装前に固定した 13 形（実ブラウザゲートと同じ本文）
  ['① null', null, '$'],
  ['② 配列', [1, 2], '$'],
  // ③ JSON 文法エラーは JSON.parse で落ちる（main.js が SyntaxError を 'JSON' として数える）ので B) の対象外・実ブラウザゲートが見る
  ['④ 空オブジェクト', {}, 'walls'],
  ['⑤ walls が配列でない', { name: 'x', walls: {} }, 'walls'],
  ['⑥ 壁に null', { name: 'x', bounds: { w: 3, h: 2 }, walls: [null] }, 'walls[0]'],
  ['⑦ name がオブジェクト', { name: { a: 1 }, walls: [] }, 'name'],
  ['⑧ 数値でない座標', { name: 'x', bounds: { w: 'abc', h: 'x' }, start: { x: 'a' }, walls: [{ x1: 'a', y1: 1, x2: 2, y2: 3 }] }, 'walls[0].x1'],
  ['⑨ HTML 入りの名前・説明', { name: '<img src=x onerror="window.__xss=1">BAD', desc: '<img src=x>', walls: [] }, OK],
  // ⑩ は実装前の固定では「採用」だったが、層 4 レビューで v2 物理・編集表示のメモリ超過を実測したので「除外」へ改訂（決定ログ）
  ['⑩ 巨大 bounds', { name: 'x', bounds: { w: 1e9, h: 1e9 }, walls: [{ x1: 0, y1: 0, x2: 1e9, y2: 0 }] }, 'bounds.w'],
  ['⑪ 中身が文字列', 'オーバル', '$'],
  ['⑫ name_en が数', { name: 'x', name_en: 7, walls: [] }, 'name_en'],
  ['⑫ name_en がオブジェクト', { name: 'x', name_en: {}, walls: [] }, 'name_en'],
  ['⑫ name_en が配列', { name: 'x', name_en: [], walls: [] }, 'name_en'],
  ['⑬ name_en が空白だけ', { name: 'x', name_en: '   ', walls: [] }, 'name_en'],
  // 境界（固定した合格条件の読み方をそのまま書いたもの）
  ['walls だけ（名前なし）', { walls: W }, OK],
  ['walls が空配列', { walls: [] }, OK],
  ['finish: null・start: null・bounds: null', { walls: W, finish: null, start: null, bounds: null }, OK],
  ['name: null・name_en: null・desc: null', { walls: W, name: null, name_en: null, desc: null, desc_en: null }, OK],
  ['desc が空文字', { walls: W, desc: '', desc_en: '' }, OK],
  ['desc が数', { walls: W, desc: 3 }, 'desc'],
  ['desc_en が配列', { walls: W, desc_en: ['a'] }, 'desc_en'],
  ['name が空文字（エディタで名前欄を空白だけにした出力）', { walls: W, name: '' }, OK],
  ['name_en が空文字', { walls: W, name_en: '' }, OK],
  ['name が改行と空白だけ', { walls: W, name: ' \n\t ' }, 'name'],
  ['name が数', { walls: W, name: 12 }, 'name'],
  ['壁が配列', { walls: [[0, 0, 1, 0]] }, 'walls[0]'],
  ['壁の y2 が欠け', { walls: [{ x1: 0, y1: 0, x2: 1 }] }, 'walls[0].y2'],
  ['2 本目の壁の x2 が数字の文字列', { walls: [W[0], { x1: 0, y1: 0, x2: '1', y2: 0 }] }, 'walls[1].x2'],
  ['壁の座標が Infinity（JSON の 1e999）', JSON.parse('{"walls":[{"x1":1e999,"y1":0,"x2":1,"y2":0}]}'), 'walls[0].x1'],
  ['壁の座標が NaN', { walls: [{ x1: NaN, y1: 0, x2: 1, y2: 0 }] }, 'walls[0].x1'],
  ['壁の座標が負（bounds の外側 5% 以内）', { bounds: { w: 100, h: 100 }, walls: [{ x1: -1, y1: -2, x2: 1, y2: 0 }] }, OK],
  ['bounds.w が 0', { walls: W, bounds: { w: 0, h: 2 } }, 'bounds.w'],
  ['bounds.h が負', { walls: W, bounds: { w: 3, h: -2 } }, 'bounds.h'],
  ['bounds.h が欠け', { walls: W, bounds: { w: 3 } }, 'bounds.h'],
  ['bounds が配列', { walls: W, bounds: [3, 2] }, 'bounds'],
  ['bounds が数', { walls: W, bounds: 3 }, 'bounds'],
  ['bounds.w が負で start も壊れている（形の検査が先に bounds を言う）', { walls: [], bounds: { w: -1, h: 2 }, start: { x: 'a', y: 0, theta: 0 } }, 'bounds.w'],
  ['start.theta が欠け', { walls: W, start: { x: 1, y: 1 } }, 'start.theta'],
  ['start.y が文字列', { walls: W, start: { x: 1, y: '1', theta: 0 } }, 'start.y'],
  ['start が文字列', { walls: W, start: 'here' }, 'start'],
  ['finish の x1..y2 がそろい fx/fy なし', { walls: W, finish: { x1: 0, y1: 0, x2: 0, y2: 1 } }, OK],
  ['finish の fx/fy が null', { walls: W, finish: { x1: 0, y1: 0, x2: 0, y2: 1, fx: null, fy: null } }, OK],
  ['finish.y2 が欠け', { walls: W, finish: { x1: 0, y1: 0, x2: 0 } }, 'finish.y2'],
  ['finish.fx が文字列', { walls: W, finish: { x1: 0, y1: 0, x2: 0, y2: 1, fx: 'a' } }, 'finish.fx'],
  ['finish.fy がオブジェクト', { walls: W, finish: { x1: 0, y1: 0, x2: 0, y2: 1, fx: 1, fy: {} } }, 'finish.fy'],
  ['finish が配列', { walls: W, finish: [0, 0, 0, 1] }, 'finish'],
  ['表示用メタが壊れている（diff 文字列・beginner 数）', { walls: W, diff: 'abc', beginner: 3, bench: 'x' }, OK],
  // 大きさ（層 4 レビュー後に追加）
  ['遠い壁 1 本（x=1e17・レビューで走査が終わらなかった形）', { bounds: { w: 3, h: 2 }, walls: [W[0], { x1: 1e17, y1: 0, x2: 1e17 + 0.1, y2: 0 }] }, 'walls[1].x1'],
  ['mm/m の取り違え（bounds 18,363 m）', { bounds: { w: 18363, h: 18707 }, walls: [{ x1: 100, y1: 100, x2: 18000, y2: 100 }] }, 'bounds.w'],
  ['bounds 1000 m ちょうど', { bounds: { w: 1000, h: 1000 }, walls: W }, OK],
  ['bounds.w が 1000 m を超える', { bounds: { w: 1000.001, h: 10 }, walls: W }, 'bounds.w'],
  ['bounds 0.5 m ちょうど', { bounds: { w: 0.5, h: 0.5 }, start: { x: 0.2, y: 0.2, theta: 0 }, walls: [{ x1: 0, y1: 0, x2: 0.5, y2: 0 }] }, OK],
  ['bounds.h が 0.5 m 未満（1e-300）', { bounds: { w: 3, h: 1e-300 }, walls: W }, 'bounds.h'],
  ['bounds が無いと既定 3×2 で測る（x=3.15 は外側 5% ちょうど）', { walls: [{ x1: 0, y1: 0, x2: 3.15, y2: 0 }] }, OK],
  ['bounds が無いと既定 3×2 で測る（x=3.16 は外）', { walls: [{ x1: 0, y1: 0, x2: 3.16, y2: 0 }] }, 'walls[0].x2'],
  ['壁の y1 が下へはみ出す', { bounds: { w: 10, h: 10 }, walls: [{ x1: 0, y1: -0.51, x2: 1, y2: 0 }] }, 'walls[0].y1'],
  ['start がコースの外', { bounds: { w: 10, h: 10 }, start: { x: 11, y: 1, theta: 0 }, walls: W }, 'start.x'],
  ['start が既定の位置（bounds 0.5 m でも内側）', { bounds: { w: 0.5, h: 0.5 }, walls: [] }, OK],
  ['finish の端がコースの外', { bounds: { w: 10, h: 10 }, finish: { x1: 1, y1: 1, x2: 1, y2: 10.6 }, walls: W }, 'finish.y2'],
  ['壁のセル数が上限を超える（1000 m の中の 125 m 対角 2 本）', { bounds: { w: 1000, h: 1000 }, walls: [{ x1: 0, y1: 0, x2: 125, y2: 125 }, { x1: 200, y1: 0, x2: 325, y2: 125 }] }, 'walls:size'],
  ['壁のセル数が上限以内（125 m 対角 1 本）', { bounds: { w: 1000, h: 1000 }, walls: [{ x1: 0, y1: 0, x2: 122, y2: 122 }] }, OK],
  ['壁が 20,001 本', { bounds: { w: 100, h: 100 }, walls: Array.from({ length: 20001 }, (_, i) => ({ x1: (i % 100) * 0.9, y1: Math.floor(i / 100) * 0.4, x2: (i % 100) * 0.9 + 0.01, y2: Math.floor(i / 100) * 0.4 })) }, 'walls:size'],
  ['壁が 20,000 本', { bounds: { w: 100, h: 100 }, walls: Array.from({ length: 20000 }, (_, i) => ({ x1: (i % 100) * 0.9, y1: Math.floor(i / 100) * 0.4, x2: (i % 100) * 0.9 + 0.01, y2: Math.floor(i / 100) * 0.4 })) }, OK],
  ['数', 42, '$'],
  ['真偽値', true, '$'],
  ['undefined', undefined, '$'],
];
function runB(check) {
  const v = [];
  for (const [label, data, want] of CASES) {
    let got;
    try { got = check(data); } catch (e) { got = `例外 ${e.message}`; }
    if (got !== want) v.push(`${label}: 期待 ${JSON.stringify(want)} ／ 実際 ${JSON.stringify(got)}`);
  }
  return v;
}
console.log(`\nB) 形ごとの期待（${CASES.length} 例・除外理由の JSON パスまで一致）`);
report('B) 期待と違った例', runB(checkCourseData));

// ── C) 合格したものは normalizeCourse が安全に扱える ─────────────────────────────────
const JUNK = [null, undefined, NaN, Infinity, -Infinity, 0, -1, 1e9, '', ' ', '1', 'abc', {}, [], [1], true, false, { x: 1 }];
const BASE = editorShape(buildFromSpec(specs[0]));
BASE.name_en = 'Base'; BASE.desc = 'd'; BASE.desc_en = 'd';
function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 >>> 0) / 2 ** 32); }
// 値を差し替える場所（オブジェクトのパス）。壁は先頭・末尾・途中を狙う。
function slotsOf(c) {
  const out = [[], ['walls'], ['bounds'], ['start'], ['finish'], ['name'], ['name_en'], ['desc'], ['desc_en']];
  for (const k of ['w', 'h']) out.push(['bounds', k]);
  for (const k of ['x', 'y', 'theta']) out.push(['start', k]);
  for (const k of ['x1', 'y1', 'x2', 'y2', 'fx', 'fy']) out.push(['finish', k]);
  for (const i of [0, Math.floor(c.walls.length / 2), c.walls.length - 1]) {
    out.push(['walls', i]);
    for (const k of ['x1', 'y1', 'x2', 'y2']) out.push(['walls', i, k]);
  }
  return out;
}
function setAt(obj, p, val) {
  if (p.length === 0) return val;
  const root = J(obj);
  let o = root;
  for (let i = 0; i < p.length - 1; i++) o = o[p[i]];
  if (val === undefined) delete o[p[p.length - 1]]; else o[p[p.length - 1]] = val;
  return root;
}
function safeAfterNormalize(data) {
  let c;
  try { c = normalizeCourse(data); } catch (e) { return `normalizeCourse が例外: ${e.message}`; }
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!Array.isArray(c.walls)) return 'walls が配列でない';
  for (const [i, w] of c.walls.entries()) for (const k of ['x1', 'y1', 'x2', 'y2']) if (!fin(w[k])) return `walls[${i}].${k}=${w[k]}`;
  if (!(fin(c.bounds.w) && c.bounds.w > 0 && fin(c.bounds.h) && c.bounds.h > 0)) return `bounds=${JSON.stringify(c.bounds)}`;
  for (const k of ['x', 'y', 'theta']) if (!fin(c.start[k])) return `start.${k}=${c.start[k]}`;
  if (c.finish) for (const k of ['x1', 'y1', 'x2', 'y2', 'fx', 'fy']) if (!fin(c.finish[k])) return `finish.${k}=${c.finish[k]}`;
  for (const k of ['name', 'name_en']) if (c[k] !== undefined && !(typeof c[k] === 'string' && c[k].trim())) return `${k}=${JSON.stringify(c[k])}`;
  for (const k of ['desc', 'desc_en']) if (c[k] !== undefined && typeof c[k] !== 'string') return `${k}=${JSON.stringify(c[k])}`;
  return null;
}
function runC(check) {
  const v = [];
  let accepted = 0, rejected = 0;
  const slots = slotsOf(BASE);
  // 1 項目の総当たり（場所 × 値）
  for (const p of slots) for (const val of JUNK) {
    const d = setAt(BASE, p, val);
    let got;
    try { got = check(d); } catch (e) { v.push(`${p.join('.') || '$'} = ${String(val)} で検査が例外: ${e.message}`); continue; }
    if (got !== null) { rejected++; continue; }
    accepted++;
    const why = safeAfterNormalize(d);
    if (why) v.push(`${p.join('.') || '$'} = ${String(val)} を合格させたが ${why}`);
  }
  // 2〜3 項目を同時に壊す（決定論の擬似乱数）
  const r = rng(20260915);
  for (let t = 0; t < 3000; t++) {
    let d = BASE;
    const k = 2 + Math.floor(r() * 2);
    for (let j = 0; j < k; j++) {
      const p = slots[1 + Math.floor(r() * (slots.length - 1))];
      try { d = setAt(d, p, JUNK[Math.floor(r() * JUNK.length)]); } catch { /* 親が壊れていて辿れない = その差し替えは飛ばす */ }
    }
    let got;
    try { got = check(d); } catch (e) { v.push(`多重変種 #${t} で検査が例外: ${e.message}`); continue; }
    if (got !== null) { rejected++; continue; }
    accepted++;
    const why = safeAfterNormalize(d);
    if (why) v.push(`多重変種 #${t} を合格させたが ${why}`);
  }
  return { v, accepted, rejected };
}
{
  const { v, accepted, rejected } = runC(checkCourseData);
  console.log(`\nC) 合格したものは normalizeCourse が安全に扱える（変種 合格 ${accepted}・除外 ${rejected}）`);
  if (accepted < 50 || rejected < 500) v.push(`合格 ${accepted}／除外 ${rejected} は偏りすぎ（変種の作り方が空振りしている）`);
  report('C) 検査をすり抜けて normalizeCourse の出力が壊れた変種', v);
}

// ── F) 大きさの上限と、利用側の実コスト ─────────────────────────────────────────────
//   壁グリッド（contact_v2.buildWallGrid・セル 2×車長）は壁の外接矩形が覆うセルを全部埋める。セル数が利用側の重さの主因
//   （層 4 レビューの無限ループ・メモリ超過もここ）なので、**上限ぎりぎりで合格する形のセル数**を、同じ車体スケールでの
//   **出荷コースを卓上で動かしたときの最大セル数**と比べる。投稿コースは noRace を持たず常に卓上で動くので、比較も卓上に揃える
//   （出荷の大型 noRace コースは実際には fullscale で動き、壁グリッドは最大 1,668 セル＝これと比べると投稿の上限は数百倍重い）。
//   車体スケールは UI スライダーの最小（0.5）と既定（0.8）。
//   **ここが守るのは事故の形まで**（2026-09-15 利用者裁定）。わざと作った重い形は上限内でも超えうる（例: 1000 m の水平壁 149 本は
//   合格するが卓上 0.8 で 49 万セル＝この基準の 5.8 倍・櫛形の壁で配置探索が 1 回 3 秒）。STRESS はそれを並べない。
const GRID_RATIO = 3;
const USER_K = [0.5, 0.8];
const shippedBuilt = specs.map(s => buildFromSpec(s));
function gridCellsAt(walls, userK) { config.setCarScale(userK); return buildWallGrid(walls, 2 * config.CAR.length).cells.size; }
const SHIP_MAX_CELLS = Object.fromEntries(USER_K.map(k => [k, Math.max(...shippedBuilt.map(c => gridCellsAt(c.walls, k)))]));
const box = (w, h) => [{ x1: 0, y1: 0, x2: w, y2: 0 }, { x1: w, y1: 0, x2: w, y2: h }, { x1: w, y1: h, x2: 0, y2: h }, { x1: 0, y1: h, x2: 0, y2: 0 }];
// 利用側に通しても有限時間で終わる大きさだけを並べる（上限を緩めた変異で合格しても、赤を出して戻ってこられる大きさ）。
const STRESS = [
  ['上限内: bounds 1000 m の外周＋118 m の対角 1 本', { name: 's1', bounds: { w: 1000, h: 1000 }, start: { x: 500, y: 5, theta: 0 }, walls: [...box(1000, 1000), { x1: 10, y1: 10, x2: 128, y2: 128 }] }],
  ['上限超: bounds 1000 m＋125 m の対角 2 本', { name: 's2', bounds: { w: 1000, h: 1000 }, start: { x: 500, y: 5, theta: 0 }, walls: [...box(1000, 1000), { x1: 10, y1: 10, x2: 135, y2: 135 }, { x1: 200, y1: 10, x2: 325, y2: 135 }] }],
  ['上限内: 短い壁 20,000 本', { name: 's3', bounds: { w: 1000, h: 1000 }, start: { x: 1, y: 1, theta: 0 }, walls: [...box(1000, 1000), ...Array.from({ length: 19996 }, (_, i) => ({ x1: (i % 140) * 7 + 3, y1: Math.floor(i / 140) * 7 + 3, x2: (i % 140) * 7 + 3.05, y2: Math.floor(i / 140) * 7 + 3 }))] }],
  ['上限内: bounds 0.5 m・finish がはみ出し余裕いっぱい', { name: 's4', bounds: { w: 0.5, h: 0.5 }, start: { x: 0.25, y: 0.25, theta: 0 }, finish: { x1: -0.025, y1: -0.025, x2: 0.525, y2: 0.525 }, walls: box(0.5, 0.5) }],
  ['上限超: bounds 3×2 に x=300 m の壁 1 本（遠い壁の縮小版）', { name: 's5', bounds: { w: 3, h: 2 }, start: { x: 1, y: 1, theta: 0 }, walls: [...box(3, 2), { x1: 0, y1: 1, x2: 300, y2: 1 }, { x1: 0, y1: 0.5, x2: 300, y2: 60 }] }],
];
function runF(check) {
  const v = [], rows = [];
  for (const [label, d] of STRESS) {
    let why;
    try { why = check(J(d)); } catch (e) { v.push(`${label}: 検査が例外 ${e.message}`); continue; }
    if (why !== null) { rows.push(`${label}: 除外（${why}）`); continue; }
    const c = normalizeCourse(J(d));
    for (const k of USER_K) {
      let capN;
      try {
        config.setCarScale(k);
        capN = settleFitRatio(c, { regime: 'tabletop', userK: k, slotCount: config.FLEET.maxCars, reason: 'course' },
          { regime: () => {}, scale: (x) => config.setCarScale(x), sync: () => {}, log: () => {} }).capN;
      } catch (e) { v.push(`${label}（車体スケール ${k}）: settleFitRatio が例外 ${e.message}`); continue; }
      const cells = gridCellsAt(c.walls, k);
      const ratio = cells / SHIP_MAX_CELLS[k];
      rows.push(`${label}（車体スケール ${k}）: 合格・capN ${capN}・壁グリッド ${cells} セル＝出荷最大の ${ratio.toFixed(2)} 倍`);
      if (ratio > GRID_RATIO) v.push(`${label}（車体スケール ${k}）を合格させたが、壁グリッドが出荷最大の ${ratio.toFixed(2)} 倍（上限 ${GRID_RATIO} 倍）`);
    }
  }
  config.setCarScale(1);
  return { v, rows };
}
{
  // 出荷全コースの余裕（上限の表は product の COURSE_LIMITS を切り出して読む＝写しを持たない）
  const limSrc = /const COURSE_LIMITS = (\{[^}]*\});/.exec(fs.readFileSync('./public/js/course.js', 'utf8'));
  const LIM = limSrc ? Function(`return ${limSrc[1]};`)() : null;
  const fv = [];
  console.log(`\nF) 大きさの上限と利用側の実コスト（出荷コースを卓上で動かしたときの最大の壁グリッド: 車体スケール 0.5 で ${SHIP_MAX_CELLS[0.5]}・0.8 で ${SHIP_MAX_CELLS[0.8]} セル）`);
  if (!LIM) fv.push('course.js の COURSE_LIMITS を読めない');
  else {
    let maxSide = 0, minSide = Infinity, maxOut = 0, maxCells = 0, maxWalls = 0;
    for (const c of shippedBuilt) {
      const b = c.bounds;
      maxSide = Math.max(maxSide, b.w, b.h); minSide = Math.min(minSide, b.w, b.h); maxWalls = Math.max(maxWalls, c.walls.length);
      const pts = [...c.walls.flatMap(w => [[w.x1, w.y1], [w.x2, w.y2]]), [c.start.x, c.start.y], ...(c.finish ? [[c.finish.x1, c.finish.y1], [c.finish.x2, c.finish.y2]] : [])];
      for (const [x, y] of pts) maxOut = Math.max(maxOut, Math.max(-x, -y, x - b.w, y - b.h, 0) / Math.max(b.w, b.h));
      let n = 0;
      for (const w of c.walls) n += (Math.floor(Math.max(w.x1, w.x2) / LIM.cell) - Math.floor(Math.min(w.x1, w.x2) / LIM.cell) + 1) * (Math.floor(Math.max(w.y1, w.y2) / LIM.cell) - Math.floor(Math.min(w.y1, w.y2) / LIM.cell) + 1);
      maxCells = Math.max(maxCells, n);
    }
    console.log(`  出荷 ${shippedBuilt.length} 本の実測と上限: 長辺最大 ${maxSide} m（上限 ${LIM.bMax}）・短辺最小 ${minSide.toFixed(3)} m（下限 ${LIM.bMin}）・はみ出し最大 ${(maxOut * 100).toFixed(2)}%（上限 ${LIM.margin * 100}%）・セル数最大 ${maxCells}（上限 ${LIM.maxCells}）・壁本数最大 ${maxWalls}（上限 ${LIM.maxWalls}）`);
    if (!(maxSide <= LIM.bMax && minSide >= LIM.bMin && maxOut <= LIM.margin && maxCells <= LIM.maxCells && maxWalls <= LIM.maxWalls))
      fv.push('出荷コースが上限の外にある（A) も赤のはず）');
  }
  const { v, rows } = runF(checkCourseData);
  rows.forEach(r => console.log('  - ' + r));
  report('F) 上限と利用側コストの食い違い', [...fv, ...v]);
}

// ── D) 変異試験 ─────────────────────────────────────────────────────────────────
const COURSE_SRC = fs.readFileSync('./public/js/course.js', 'utf8');
function extract(src) {
  // 上限の表 COURSE_LIMITS は関数の直前に置いてある。表から関数の終わりまでを切り出す（表の値の変異も試せるように）。
  const lim = src.indexOf('const COURSE_LIMITS = {'); if (lim < 0) return null;
  const head = 'export function checkCourseData(data) {';
  const i = src.indexOf(head, lim); if (i < 0) return null;
  const j = src.indexOf('\n}\n', i); if (j < 0) return null;
  return src.slice(lim, i) + src.slice(i + 'export '.length, j + 2);
}
const compile = (fnSrc) => new Function(`${fnSrc}\nreturn checkCourseData;`)();
const ORIG = extract(COURSE_SRC);
const dv = [];
if (!ORIG) dv.push('course.js から checkCourseData を切り出せない');
else {
  // 切り出した写しが product の関数と同じ答えを出す（＝変異の土台が本物と同じ）
  const copy = compile(ORIG);
  if (runB(copy).length || runA(copy).v.length) dv.push('切り出した checkCourseData が product と違う答えを出す（切り出しが壊れている）');
  const MUT = [
    ['配列を通す', s => s.replace("typeof v === 'object' && !Array.isArray(v)", "typeof v === 'object'")],
    ['null を通す', s => s.replace('v !== null && typeof v', 'typeof v')],
    ['walls の配列検査を外す', s => s.replace("if (!Array.isArray(data.walls)) return 'walls';", "if (!data.walls) return 'walls';")],
    ['壁の要素がオブジェクトかを見ない', s => s.replace('if (!isObj(w)) return `walls[${i}]`;', 'if (!w) return `walls[${i}]`;')],
    ['壁の y2 を見ない', s => s.replace("for (const k of ['x1', 'y1', 'x2', 'y2']) if (!num(w[k]))", "for (const k of ['x1', 'y1', 'x2']) if (!num(w[k]))")],
    ['有限でなくても数なら通す', s => s.replace("typeof v === 'number' && Number.isFinite(v)", "typeof v === 'number'")],
    ['数字の文字列を通す', s => s.replace("typeof v === 'number' && Number.isFinite(v)", 'Number.isFinite(+v)')],
    ['bounds の正を見ない', s => s.replace('&& data.bounds[k] > 0', '')],
    ['start.theta を見ない', s => s.replace("['x', 'y', 'theta']", "['x', 'y']")],
    ['finish.fx/fy を見ない', s => s.replace("for (const k of ['fx', 'fy']) if (!absent(data.finish[k]) && !num(data.finish[k])) return `finish.${k}`;", '')],
    ['finish の座標を見ない', s => s.replace("for (const k of ['x1', 'y1', 'x2', 'y2']) if (!num(data.finish[k])) return `finish.${k}`;", '')],
    ['空白だけの名前を通す', s => s.replace(" && (data[k] === '' || data[k].trim() !== '')", '')],
    ['空文字の名前を落とす', s => s.replace("(data[k] === '' || data[k].trim() !== '')", "data[k].trim() !== ''")],
    ['bounds の上限を外す', s => s.replace('bMax: 1000,', 'bMax: Infinity,')],
    ['bounds の下限を外す', s => s.replace('bMin: 0.5,', 'bMin: 0,')],
    ['はみ出しの余裕を 10 倍にする', s => s.replace('margin: 0.05,', 'margin: 0.5,')],
    ['壁の端点のはみ出しを見ない', s => s.replace('if (outX(w.x1)) return `walls[${i}].x1`;', '')],
    ['start のはみ出しを見ない', s => s.replace("if (!absent(data.start)) { if (outX(data.start.x)) return 'start.x'; if (outY(data.start.y)) return 'start.y'; }", '')],
    ['finish のはみ出しを見ない', s => s.replace("if (outX(f.x2)) return 'finish.x2'; if (outY(f.y2)) return 'finish.y2';", '')],
    ['セル数の上限を 100 倍にする', s => s.replace('maxCells: 1500000,', 'maxCells: 150000000,')],
    ['本数の上限を外す', s => s.replace("if (data.walls.length > L.maxWalls) return 'walls:size';", '')],
    ['bounds が無いときの既定を大きくする', s => s.replace('absent(data.bounds) ? 3.0 : data.bounds.w', 'absent(data.bounds) ? 30 : data.bounds.w')],
    ['name_en を見ない', s => s.replace("for (const k of ['name', 'name_en'])", "for (const k of ['name'])")],
    ['desc を見ない', s => s.replace("for (const k of ['desc', 'desc_en'])", "for (const k of ['desc_en'])")],
    ['null を「無い」とみなさない', s => s.replace('v === undefined || v === null', 'v === undefined')],
    ['空の walls を落とす', s => s.replace("if (!Array.isArray(data.walls)) return 'walls';", "if (!Array.isArray(data.walls) || !data.walls.length) return 'walls';")],
  ];
  for (const [label, fn] of MUT) {
    const m = fn(ORIG);
    if (m === ORIG) { dv.push(`変異「${label}」が当たらない（product の形が変わった＝変異を直すこと）`); continue; }
    let f;
    try { f = compile(m); } catch (e) { dv.push(`変異「${label}」が構文エラー: ${e.message}`); continue; }
    // 速く捕まる順に試し、捕まったら打ち切る（C)・F) は重い）
    const caught = runB(f).length || runA(f).v.length || runF(f).v.length || runC(f).v.length;
    if (!caught) dv.push(`変異「${label}」を A)〜C)・F) が捕まえない`);
  }
  console.log(`\nD) 変異試験（checkCourseData を 1 か所ずつ壊す・${MUT.length} 変異）`);
}
report('D) 見逃した変異・土台の不備', dv);

// ── E) 読み込み互換 ─────────────────────────────────────────────────────────────
// BB2 前（公開リポジトリ 60c78f7）の course.js の export 名。これに無い名前を名前付き import すると、古い course.js を
// キャッシュに持つブラウザでモジュールグラフ全体が落ちる（BA1 で実測）。**書き換えてよいのは配信側でキャッシュ混在が
// 起きないと確かめたときだけ**（例: JS に Cache-Control を付けて十分な日数が経った）。書き換えるなら理由を決定ログに残す。
const PRE_BB2_COURSE_EXPORTS = ['buildFromSpec', 'PRESETS', 'loadPresets', 'presetByName', 'defaultCourse', 'normalizeCourse',
  'worldToScreen', 'screenToWorld', 'snap', 'drawCourse', 'drawCourseLayer', 'drawFinish'];
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => (/:\/\//.test(l) ? l : l.replace(/\/\/.*$/, ''))).join('\n');
function listJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJs(p)); else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
function checkImports(srcs) {
  const v = [];
  let seen = 0;
  for (const [rel, raw] of Object.entries(srcs)) {
    for (const m of strip(raw).matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[2]));
      if (target !== 'course.js') continue;
      seen++;
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name && !PRE_BB2_COURSE_EXPORTS.includes(name))
          v.push(`${rel} が course.js から BB2 前に無かった名前「${name}」を名前付き import している＝古い course.js がキャッシュに残るブラウザで起動しない`);
      }
    }
  }
  if (seen < 4) v.push(`course.js からの名前付き import を ${seen} 件しか見つけられない（検査が空振りしている）`);
  const main = strip(srcs['main.js'] || '');
  if (!/^import \* as courseParts from '\.\/course\.js';$/m.test(main)) v.push('main.js が course.js を名前空間 import（courseParts）で受けていない');
  if (!/const check = typeof courseParts\.checkCourseData === 'function' \? courseParts\.checkCourseData : \(\) => null;/.test(main))
    v.push('main.js が「checkCourseData が無ければ検査を飛ばす」形になっていない');
  const lcc = main.slice(main.indexOf('async function loadCommunityCourses() {'));
  const body = lcc.slice(0, lcc.indexOf('\n}\n') + 3);
  if (!/const why = check\(data\);\s*if \(why\) \{ bad\.push\(\{ e, why \}\); return null; \}\s*return \{ name: e\.name, data \};/.test(body))
    v.push('loadCommunityCourses が検査に落ちた投稿を一覧から外していない');
  if (!/logLine\(hasKey\('log\.ghCoursesBad'\) \? t\('log\.ghCoursesBad', \{ n: bad\.length, items \}\) : /.test(body)) v.push('loadCommunityCourses が除外を告知していない');
  return v;
}
const JS_ROOT = './public/js';
const SRCS = Object.fromEntries(listJs(JS_ROOT).map(p => [path.relative(JS_ROOT, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8')]));
console.log(`\nE) 読み込み互換（public/js 配下 ${Object.keys(SRCS).length} ファイル）`);
const ev = checkImports(SRCS);
// E) の変異: 名前付き import に足す／名前空間 import を消す／フォールバックを消す
for (const [label, edits] of [
  ['main.js が checkCourseData を名前付き import する', { 'main.js': s => s.replace("PRESETS, presetByName, normalizeCourse, loadPresets,", "PRESETS, presetByName, normalizeCourse, loadPresets, checkCourseData,") }],
  ['別ファイル（race_ui.js）が checkCourseData を名前付き import する', { 'race_ui.js': s => s.replace("import { drawCourse, worldToScreen } from './course.js';", "import { drawCourse, worldToScreen, checkCourseData } from './course.js';") }],
  ['名前空間 import を消す', { 'main.js': s => s.replace("import * as courseParts from './course.js';", '') }],
  ['フォールバックを消す', { 'main.js': s => s.replace("typeof courseParts.checkCourseData === 'function' ? courseParts.checkCourseData : () => null", 'courseParts.checkCourseData') }],
]) {
  const mut = { ...SRCS };
  for (const [f, fn] of Object.entries(edits)) mut[f] = fn(SRCS[f]);
  if (Object.entries(edits).every(([f]) => mut[f] === SRCS[f])) { ev.push(`E) の変異「${label}」が当たらない`); continue; }
  if (checkImports(mut).length === 0) ev.push(`E) の変異「${label}」を検査が捕まえない`);
}
report('E) 読み込み互換が崩れた箇所・見逃した変異', ev);

console.log(`\n${pass ? 'PASS' : 'FAIL'} — wf_bb2_course_check`);
process.exit(pass ? 0 : 1);
