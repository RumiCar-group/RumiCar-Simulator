// wf_bc3_intake.mjs — コースの取り込み経路が「1 つの入口」を通ることを固定する常設ゲート (BC3・2026-09-18)。
// ════════════════════════════════════════════════════════════════════════════
// 背景 (実測 2026-09-18・範囲 Simulator/public/js 全体):
//   BB2 で入れた形式検査 `checkCourseData` を呼んでいたのは投稿コースの一覧作り (main.js の
//   loadCommunityCourses) **1 箇所だけ**で、自分のファイルを取り込む経路は素通りだった。BB2 が上限を
//   足した理由 (遠い壁 1 本で壁グリッドの走査が終わらない・mm と m の取り違えでメモリが尽きる) は
//   「どこから来た JSON か」に依らないので、取り込み経路ごとに検査の有無が違うこと自体が欠陥だった。
//   BC3 で `course.js:acceptCourseData` (検査 → 正規化) を単一の入口にし、全経路をそこへ通した。
//
//   ただし **基準は取り込み元で 2 つに分ける**。1 回目の BC3 は投稿向けの基準を保存コースへそのまま
//   当てて、**エディタで枠を縮めて保存した自作コースが二度と開けなくなる**退行を出した (出荷 66/66 本で
//   再現)。理由と実測は course.js の注記を正とする。ここでは「2 つの基準が現に分かれていること」を固定する。
//
// 検査:
//   A) 入口の契約: acceptCourseData は**例外を投げず** { ok, why, course } を返す。合格なら course は
//      normalizeCourse(data) と **byte 同値** (= 既存の挙動・公式レースの決定論を変えない)、不合格なら
//      course は null で why は対応する検査と同一の箇所。コーパス全形 × 2 基準 ＋ 出荷 66 本で確かめる。
//   B) **2 つの基準の関係**（本ブロックの肝・これが緩むと 1 回目の退行が戻る）:
//      B1 own は std より緩い (std が通すものは own も通す) — 全母集団で。
//      B2 「枠を縮めて保存した出荷コース」66 本が own で**全部開ける**・std では**全部落ちる**。
//      B3 own が受け入れた入力は、**本物の contact_v2.buildWallGrid が終わる**。判定は壁グリッドの
//         `for (let ix = ix0; ix <= ix1; ix++)` が進む条件 (|ix| < 2^53 ＝ ix+1 !== ix) を product の
//         セル寸法で実際に計算し、そのうえで buildWallGrid を本当に呼ぶ。対照として、遠い壁は
//         この条件を満たさない (＝ own が受け取ってはいけない) ことを数で示す。
//   C) 一元化の構造: 取り込み経路と、それに付随する UI の始末をソースで固定する。内訳は
//      **コースの入口 5 つ**（① JSON 取込〔own〕/ ② 保存・投稿コースの選択〔saved=own・community=std〕/ ④ 公式レースのコース解決〔std〕/
//      ⑦ 投稿前の検査 / ⑧ ✔適用）＋ **付随 3 つ**（⑥ 投稿車種の除外告知＝コース側と対称・起動時の
//      共有復元・一覧の再構築）＝ 8 項目。⑤ は ④ を race_ui 側から呼んでいること、③ は data_backup が
//      **検査しない**ことを別に固定する。逆に **acceptCourse を経ない裸の normalizeCourse( が
//      public/js 全体に残っていない**ことも数える。ここが緩むと「新しい経路を足した人が検査を忘れる」が
//      再発する (BB2 → BC3 で実際に起きた)。
//   D) 読み込み互換 (BA-1 の教訓・wf_bb2_course_check E) と同じ理由): acceptCourseData を**名前付き
//      import してはならない**。main.js は名前空間 import で受け、関数が無ければ従来どおり無検査で
//      正規化するフォールバックを持つこと。
//   E) 変異試験: C)/D) の配線を 1 つずつ壊すと必ず赤になる (product は読むだけ・変異はメモリ上)。
//
// 使い方: node wf_bc3_intake.mjs
// 依存: node のみ (node_modules 不要 = フレッシュクローン検証の前提を保つ)。
// ════════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import { buildFromSpec, normalizeCourse, checkCourseData, checkOwnCourseData, acceptCourseData } from './public/js/course.js';
import { buildWallGrid } from './public/js/contact_v2.js';
import * as config from './public/js/config.js';
import { SHAPES, SYNTAX_ONLY, expectOf, BIG_FRAME_SHAPES } from './wf_course_corpus.mjs';

let pass = true;
const report = (label, arr, n = 10) => {
  console.log(`  ${arr.length === 0 ? '○' : '✗'} ${label}: ${arr.length} 件`);
  arr.slice(0, n).forEach(s => console.log(`       - ${s}`));
  if (arr.length > n) console.log(`       … 他 ${arr.length - n} 件`);
  if (arr.length) pass = false;
};
const J = (v) => JSON.parse(JSON.stringify(v));
const CHECK = { std: checkCourseData, own: checkOwnCourseData };
const OPTS = { std: { own: false }, own: { own: true } };

const specs = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
const shipped = specs.map(buildFromSpec);
const editorShape = (c) => J({ name: c.name, bounds: c.bounds, start: c.start, finish: c.finish, walls: c.walls });

// ── A) 入口の契約 ───────────────────────────────────────────────────────────────
// 母集団は「コーパスの全形 (JSON として読めるもの)」＋「出荷コースの 2 つの形」。
const CORPUS = SHAPES.filter(([f]) => !SYNTAX_ONLY.includes(f));
const POP = [
  ...CORPUS.map((sh) => ({ label: `corpus ${sh[0]}`, data: JSON.parse(sh[1]), expect: { std: expectOf(sh, 'std'), own: expectOf(sh, 'own') } })),
  ...shipped.flatMap((c) => [
    { label: `出荷「${c.name}」buildFromSpec の出力`, data: J(c), expect: { std: 'keep', own: 'keep' } },
    { label: `出荷「${c.name}」エディタ形で JSON 往復`, data: editorShape(c), expect: { std: 'keep', own: 'keep' } },
  ]),
];
{
  const v = [];
  for (const { label, data, expect } of POP) {
    for (const key of ['std', 'own']) {
      let r;
      try { r = acceptCourseData(J(data), OPTS[key]); }
      catch (e) { v.push(`[${key}] ${label}: acceptCourseData が例外を投げた (${e.message})`); continue; }
      const why = CHECK[key](J(data));
      if (r.why !== why) v.push(`[${key}] ${label}: why=${JSON.stringify(r.why)} が検査の ${JSON.stringify(why)} と違う`);
      if (r.ok !== (why === null)) v.push(`[${key}] ${label}: ok=${r.ok} が検査の結果と食い違う`);
      if ((r.ok ? 'keep' : 'drop') !== expect[key]) v.push(`[${key}] ${label}: 期待 ${expect[key]} ／ 実際 ${r.ok ? 'keep' : 'drop'} (${JSON.stringify(r.why)})`);
      if (!r.ok && r.course !== null) v.push(`[${key}] ${label}: 不合格なのに course が null でない`);
      // 合格した入力では **従来の normalizeCourse と byte 同値**。
      // ⚠ いまの acceptCourseData は本体が `normalizeCourse(data)` そのものなので、この 1 行は
      //   **現状では構成上自明**（同じ関数を 2 回呼んでいる）。値があるのは「将来 acceptCourseData が
      //   course に手を加えたら赤にする」という**契約の固定**のほう。決定論の本当のリスクは
      //   「これまで解決できていたものが解決できなくなる」で、そちらは直前の
      //   `expect[key]` 照合（出荷 66 本 × 2 形 × 2 基準がすべて keep）が担う。
      if (r.ok && JSON.stringify(r.course) !== JSON.stringify(normalizeCourse(J(data))))
        v.push(`[${key}] ${label}: course が normalizeCourse の出力と一致しない (既存の挙動を変えている)`);
    }
  }
  console.log(`A) 入口の契約 (母集団 ${POP.length} 件 × 基準 2 種: コーパス ${CORPUS.length} 形＋出荷 ${shipped.length} 本 × 2 形)`);
  if (CORPUS.length < 15 || shipped.length < 60) v.push(`母集団が少なすぎる (コーパス ${CORPUS.length} 形・出荷 ${shipped.length} 本) = 検査が空振りしている`);
  report('A) 入口の契約が崩れた箇所', v);
}

// ── B) 2 つの基準の関係 ─────────────────────────────────────────────────────────
// B2 の母集団: 出荷コースの枠 bounds を ED_DIM_MIN まで縮めたもの。**コースエディタの applyEditDims と
// 同じ計算**を product から読み取って使う (写しを作らない — 定数が変わったらここも一緒に動く)。
const MAIN = fs.readFileSync('./public/js/main.js', 'utf8');
const RACE_UI = fs.readFileSync('./public/js/race_ui.js', 'utf8');
const edDim = /const ED_DIM_MIN = ([\d.]+), ED_DIM_MAX = ([\d.]+);/.exec(MAIN);
{
  const bv = [];
  if (!edDim) bv.push('main.js から ED_DIM_MIN/ED_DIM_MAX を読めない (エディタの枠の下限が変わった?)');
  const ED_MIN = edDim ? Number(edDim[1]) : null;
  const STEP = config.GRID && config.GRID.step;   // 丸めの刻みは product の定数をそのまま使う (写しを作らない)
  if (!(STEP > 0)) bv.push('config.js の GRID.step を読めない');

  // B1) own は std より緩い（std が通すものは own も通す）。
  //   ⚠ **母集団が「逆転の起きうる帯」を含んでいないと、この検査は空振りする**（層 4 レビュー 2026-09-18）。
  //   逆転は枠が bMax/(1+margin) を超えたときだけ起きるので、その帯の形がコーパスに居ることを数で要求する。
  const BIG = bMax => POP.filter(({ data }) => {
    const b = (data && data.bounds) || { w: 3, h: 2 };
    return typeof b.w === 'number' && Math.max(b.w, b.h) * (1 + 0.05) > bMax;
  });
  const bigInPop = BIG(1000).length;
  const bigNamed = BIG_FRAME_SHAPES.filter((f) => POP.some(({ label }) => label === `corpus ${f}`)).length;
  if (bigInPop === 0) bv.push('B1 母集団に「枠 × (1+margin) が絶対上限を超える」形が 1 つも無い = own ⊇ std の検査が空振りする');
  if (bigNamed !== BIG_FRAME_SHAPES.length)
    bv.push(`B1 コーパスが名指しする逆転帯の形 ${BIG_FRAME_SHAPES.length} 件のうち ${bigNamed} 件しか母集団に居ない`);
  let stdKeep = 0, ownKeep = 0;
  for (const { label, data } of POP) {
    const s = CHECK.std(J(data)) === null, o = CHECK.own(J(data)) === null;
    if (s) stdKeep++;
    if (o) ownKeep++;
    if (s && !o) bv.push(`B1 ${label}: std が通すのに own が落とす (own は std より緩いはず)`);
  }
  if (!(ownKeep > stdKeep)) bv.push(`B1 own の合格 ${ownKeep} が std の合格 ${stdKeep} より多くない = 2 つの基準が実は同じ`);

  // B2) 枠を縮めて保存した自作コース: own は全部開ける・std は全部落とす
  let shrunkOwnOk = 0, shrunkStdDrop = 0;
  const shrunk = [];
  if (ED_MIN && STEP) {
    const q = (v) => Math.round(Math.max(ED_MIN, v) / STEP) * STEP;   // applyEditDims と同じクランプ＋丸め
    for (const c of shipped) {
      const d = editorShape(c);
      d.bounds = { w: q(ED_MIN), h: q(ED_MIN) };    // 枠だけを最小へ。壁は動かさない (applyEditDims と同じ)
      shrunk.push({ name: c.name, data: d });
      if (CHECK.own(J(d)) === null) shrunkOwnOk++; else bv.push(`B2 「${c.name}」を枠 ${ED_MIN} m へ縮めると own でも開けない (${CHECK.own(J(d))})`);
      if (CHECK.std(J(d)) !== null) shrunkStdDrop++;
    }
    if (shrunkStdDrop !== shipped.length)
      bv.push(`B2 枠を縮めた ${shipped.length} 本のうち std が落とすのは ${shrunkStdDrop} 本 = この母集団が 2 基準の違いを突いていない`);
  }

  // B3) own が受け入れた入力は、本物の壁グリッドが終わる。
  //   終わる条件 = buildWallGrid の `for (let ix = ix0; ix <= ix1; ix++)` が進むこと。|ix| が 2^53 を
  //   超えると ix++ が値を変えず、この for は終わらない (実測 2026-09-18: bounds 3×2 に x=1e17 の短い壁
  //   1 本で 55 秒走り続けたあと RangeError)。セル寸法が小さいほど添字は大きくなるので、**利用しうる
  //   最小のセル寸法**(車体スケール最小の接触グリッド) で測る。
  const USER_K = [0.5, 0.8];
  const cellOf = (k) => { config.setCarScale(k); return 2 * config.CAR.length; };
  const advances = (ix) => Number.isFinite(ix) && ix + 1 !== ix;
  const maxIndex = (walls, cs) => {
    let m = 0;
    for (const w of walls) for (const v of [w.x1, w.y1, w.x2, w.y2]) m = Math.max(m, Math.abs(Math.floor(v / cs)));
    return m;
  };
  const accepted = [
    ...POP.filter(({ data }) => CHECK.own(J(data)) === null).map(({ label, data }) => ({ label, data })),
    ...shrunk.map(({ name, data }) => ({ label: `枠を縮めた「${name}」`, data })),
  ];
  let gridRuns = 0;
  for (const k of USER_K) {
    const cs = cellOf(k);
    for (const { label, data } of accepted) {
      const walls = normalizeCourse(J(data)).walls;
      const ix = maxIndex(walls, cs);
      if (!advances(ix)) { bv.push(`B3 [k=${k}] ${label}: own が受け入れたのに壁グリッドの添字が ${ix} で ix++ が進まない (for が終わらない)`); continue; }
      try { buildWallGrid(walls, cs); gridRuns++; }
      catch (e) { bv.push(`B3 [k=${k}] ${label}: buildWallGrid が例外 ${e.message}`); }
    }
  }
  config.setCarScale(1);
  if (gridRuns < accepted.length * USER_K.length) bv.push(`B3 壁グリッドを ${gridRuns} 回しか回せていない (合格入力 ${accepted.length} 件 × ${USER_K.length} スケール = ${accepted.length * USER_K.length} 回のはず)`);
  // 対照: 遠い壁は「ix++ が進まない」形そのもの＝この判定に検出力がある証拠 (これが無いと B3 は空振り)
  {
    const far = CORPUS.find(([f]) => f === 'bad-far-wall.json');
    if (!far) bv.push('B3 対照: コーパスに bad-far-wall.json が無い');
    else {
      const cs = cellOf(USER_K[0]);
      const ix = maxIndex(normalizeCourse(JSON.parse(far[1])).walls, cs);
      if (advances(ix)) bv.push(`B3 対照: 遠い壁の添字 ${ix} で ix++ が進んでしまう = B3 の判定に検出力が無い`);
      if (CHECK.own(JSON.parse(far[1])) === null) bv.push('B3 対照: own が遠い壁を受け入れている');
      config.setCarScale(1);
    }
  }
  console.log(`\nB) 2 つの基準の関係 (合格 std ${stdKeep}/${POP.length}・own ${ownKeep}/${POP.length}` +
    ` ／ 枠を縮めた出荷 ${shipped.length} 本: own 合格 ${shrunkOwnOk}・std 不合格 ${shrunkStdDrop}` +
    ` ／ 壁グリッド実行 ${gridRuns} 回)`);
  report('B) 2 つの基準の関係が崩れた箇所', bv);
}

// ── C) 一元化の構造 / D) 読み込み互換 ───────────────────────────────────────────
// 取り込み経路 = 「アプリの外から来たデータをコースにする」場所。各要素は
//   { id, 本文を切り出す目印, 満たすべき正規表現 }。目印が見つからなければ**それ自体が赤**
//   (経路を消した・名前を変えたのに検査が空振りする、を防ぐ)。
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => (/:\/\//.test(l) ? l : l.replace(/\/\/.*$/, ''))).join('\n');

const INTAKE = [
  { id: '① エディタの JSON 取込 (edImport)', from: "$('edImport').addEventListener", to: '\n});',
    must: [[/const r = acceptCourse\(data, true\);/, 'own 基準の acceptCourse を通していない (#edExport で書き出した自作コースを読み戻せなくなる)'],
           [/if \(!r\.ok\) \{ logLine\(courseBadLine\(f\.name, r\.why\)\); return; \}/, '不合格のとき読み込まずに戻っていない'],
           [/editor\.load\(r\.course\)/, '検査を通った course を読み込んでいない']] },
  { id: '② 保存/投稿コースの選択 (selectCourse)', from: 'function selectCourse(name) {', to: '\n}\n',
    must: [[/const r = acceptCourse\(src\.data, src\.type === 'saved'\);/, '保存コースを own 基準・投稿コースを通常基準で通していない'],
           // **拒否の分岐の中**で「知らせる → courseSel を戻す → false を返す」が続いていることを 1 本で見る。
           // `return false;` だけを探すと、関数冒頭の `if (!src) return false;` に当たってしまい、
           // 拒否側の return を消しても緑のまま通る (層 4 レビュー 2026-09-18 の指摘。実害は
           // c が undefined のまま applyCourse へ落ちて TypeError)。
           [/if \(!r\.ok\) \{\s*logLine\(courseBadLine\(name, r\.why\)\);[\s\S]*?\$\('courseSel'\)\.value = courseSelValue;\s*return false;\s*\}/,
            '拒否の分岐が「理由を知らせる → courseSel を戻す → false を返す」になっていない'],
           [/src\.type === 'preset'/, '出荷コース (preset) と外から来たコースを分けていない']] },
  { id: '④ 公式レースのコース解決 (resolveRaceCourse)', from: 'function resolveRaceCourse(courseRef) {', to: '\n}\n',
    must: [[/const r = acceptCourse\(data, false\);/, '通常基準の acceptCourse を通していない'],
           [/logLine\(courseBadLine\(name, r\.why\)\);/, '解決できない理由を知らせていない'],
           [/return accept\(courseRef, /, '同梱 def を入口に通していない'],
           [/return cc \? accept\(cc\.data, courseRef\) : null;/, '投稿コースを入口に通していない']] },
  { id: '⑦ エディタからの投稿 (edShare)', from: "$('edShare').addEventListener", to: '\n});',
    must: [[/const chk = acceptCourse\(json, false\);/, '通常基準の acceptCourse を通していない'],
           [/if \(!chk\.ok\) logLine\(hasKey\('log\.courseSubmitBad'\)/, '検査に落ちることを投稿前に知らせていない (または hasKey ガードが無い)']] },
  { id: '⑥ 投稿車種の除外告知 (loadCommunityCars)', from: 'async function loadCommunityCars() {', to: '\n}\n',
    must: [[/badCars\.push\(/, '除外を数えていない (黙って捨てている)'],
           [/hasKey\('log\.ghCarsBad'\)/, '除外を告知していない (または hasKey ガードが無い)']] },
  { id: '⑧ エディタの ✔適用 (applyEdit)', from: 'function applyEdit() {', to: '\n}\n',
    must: [[/const r = acceptCourse\(editor\.toJSON\(\), true\);/, '② と同じ own 基準を通していない (✔適用と選び直しで答えが割れる)'],
           [/if \(!r\.ok\) \{ logLine\(courseBadLine\([^\n]*\); return; \}/, '不合格のとき適用せずに戻っていない (return; まで見る)']] },
  { id: '起動時の共有復元', from: "if (courseSources[shareState.course]) {", to: '\n    } else {',
    must: [[/restoredCourse = selectCourse\(shareState\.course\);/, '拒否されたのに「復元した」ことにしている (courseSel と実体がずれる)']] },
  { id: '一覧の再構築 (rebuildCourseList)', from: 'function rebuildCourseList(selectName) {', to: '\n}\n',
    must: [[/courseSelValue = sel\.value;/, '現に選ばれている option value を控えていない (② が戻す先が無い)']] },
];
// ⑤ race_ui は resolveRaceCourse 経由 = ④ で捕まる。その「経由している」こと自体を固定する。
// ③ data_backup.js は**検査しない**のが設計 (生文字列を byte 同値で戻す契約・コースとして解釈されるのは ②)。
//    「うっかり検査を足していない」ことも固定する — 足すと復元が部分的に欠けて、利用者はそれに気づけない。
const RACE_UI_MUST = [[/const rcourse = resolveRaceCourse\(event\.course\);/, 'verifyOfficialLocally が resolveRaceCourse を経ていない'],
                      [/const rcourse = resolveRaceCourse\(race\.event\.course\);/, 'ghostVsWorld が resolveRaceCourse を経ていない']];

function slice(src, from, to) {
  const i = src.indexOf(from);
  if (i < 0) return null;
  const j = src.indexOf(to, i);
  return j < 0 ? src.slice(i) : src.slice(i, j + to.length);
}
function checkWiring(mainSrc, raceUiSrc, backupSrc, jsSrcs) {
  const bad = [];
  const m = strip(mainSrc);
  // D) 読み込み互換: BC3 で足した名前を名前付き import してはならない (BA1)
  for (const mm of m.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/course\.js'/g)) {
    for (const name of ['acceptCourseData', 'checkOwnCourseData', 'checkCourseData']) {
      if (new RegExp(`\\b${name}\\b`).test(mm[1]))
        bad.push(`D) main.js が course.js から「${name}」を名前付き import している = 古い course.js がキャッシュに残るブラウザで起動しない (BA1)`);
    }
  }
  if (!/const f = courseParts\.acceptCourseData;/.test(m))
    bad.push('D) main.js が acceptCourseData を名前空間 import (courseParts) で受けていない');
  if (!/if \(typeof f !== 'function'\) return \{ ok: true, why: null, course: normalizeCourse\(data\) \};/.test(m))
    bad.push('D) 古い course.js のときに従来どおり正規化して続けるフォールバックが無い');
  if (!/return f\(data, \{ own: !!own \}\);/.test(m))
    bad.push('D) acceptCourse が own を入口へ渡していない (全経路が同じ基準になってしまう)');
  // C) 経路ごとの配線
  for (const p of INTAKE) {
    const body = slice(m, p.from, p.to);
    if (!body) { bad.push(`C) ${p.id}: 目印「${p.from}」が main.js に無い = 経路が変わったのに検査が追随していない`); continue; }
    for (const [re, why] of p.must) if (!re.test(body)) bad.push(`C) ${p.id}: ${why}`);
  }
  // C) 取り込み経路に**裸の normalizeCourse(** が残っていないこと。**public/js 配下の全ファイル**を数える
  //    (main.js だけ見ていると、race_ui.js や loader.js に新しい取り込み経路を足したときに素通りする＝
  //     層 4 レビュー 2026-09-18 の指摘)。ファイルごとに許す本数を明記し、**合計でなく顔ぶれで**照合する。
  //      ・course.js        … 定義 1 + acceptCourseData の中 1 + drawCourse 系の呼び出し無し = 2
  //      ・course_editor.js … エディタ内部の正規化 (load / finish / start / result)。入口の**下流**なので検査済み = 4
  //      ・main.js          … acceptCourse のフォールバック 1 箇所だけ
  //    それ以外のファイルは 0。増やすときは「その経路が acceptCourse を通っているか」を先に決めること。
  const NAKED_ALLOWED = { 'course.js': 2, 'course_editor.js': 4, 'main.js': 1 };
  for (const [rel, raw] of Object.entries(jsSrcs)) {
    const src = rel === 'main.js' ? m : strip(raw);
    const n = [...src.matchAll(/normalizeCourse\(/g)].length;
    const allow = NAKED_ALLOWED[rel] || 0;
    if (n !== allow)
      bad.push(`C) ${rel} の normalizeCourse( 呼び出しが ${n} 箇所 (許すのは ${allow} 箇所) = 検査を経ない取り込み経路が増えている／経路が消えている`);
  }
  // C) ⑤ race_ui
  const ru = strip(raceUiSrc);
  for (const [re, why] of RACE_UI_MUST) if (!re.test(ru)) bad.push(`C) ⑤ race_ui.js: ${why}`);
  // C) ③ data_backup は検査しない (byte 同値で戻す契約)
  if (/checkCourseData|checkOwnCourseData|acceptCourseData|normalizeCourse/.test(strip(backupSrc)))
    bad.push('C) ③ data_backup.js がコースの検査/正規化に手を出している = 復元が byte 同値でなくなる (検査は ② で行う設計)');
  return bad;
}
const BACKUP = fs.readFileSync('./public/js/data_backup.js', 'utf8');
// public/js 配下の全 .js (入れ子も含む)。裸の normalizeCourse( の数え上げをここで行う。
function listJs(dir, base) {
  const out = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) Object.assign(out, listJs(p, `${base}${e.name}/`));
    else if (e.name.endsWith('.js')) out[`${base}${e.name}`] = fs.readFileSync(p, 'utf8');
  }
  return out;
}
const JS_SRCS = listJs('./public/js', '');
console.log(`\nC) 一元化の構造 / D) 読み込み互換 (public/js 配下 ${Object.keys(JS_SRCS).length} ファイル)`);
if (Object.keys(JS_SRCS).length < 30) console.log('  ✗ public/js のファイル数が少なすぎる = 数え上げが空振りしている');
report('C)/D) 配線が崩れた箇所', checkWiring(MAIN, RACE_UI, BACKUP, JS_SRCS));

// ── E) 変異試験 ─────────────────────────────────────────────────────────────────
// 配線を 1 つずつ壊して、C)/D) が必ず捕まえることを確かめる (product は読むだけ)。
const MUTATIONS = [
  ['①の検査を外す', (m, r, b) => [m.replace('const r = acceptCourse(data, true);', 'const r = { ok: true, course: normalizeCourse(data) };'), r, b]],
  ['①が投稿基準に戻る (書き出した自作コースを読み戻せなくなる)', (m, r, b) => [m.replace('const r = acceptCourse(data, true);', 'const r = acceptCourse(data, false);'), r, b]],
  ['②の検査を外す', (m, r, b) => [m.replace("const r = acceptCourse(src.data, src.type === 'saved');", 'const r = { ok: true, course: normalizeCourse(src.data) };'), r, b]],
  ['②が保存コースにも通常基準を当てる (1 回目の退行)', (m, r, b) => [m.replace("acceptCourse(src.data, src.type === 'saved')", 'acceptCourse(src.data, false)'), r, b]],
  ['②が拒否しても courseSel を戻さない', (m, r, b) => [m.replace("if (courseSelValue && courseSources[courseSelValue]) $('courseSel').value = courseSelValue;", ''), r, b]],
  ['④の同梱 def を素通しに戻す', (m, r, b) => [m.replace('return accept(courseRef, courseRef.name', 'return normalizeCourse(courseRef); // (courseRef.name'), r, b]],
  ['④の投稿コースを素通しに戻す', (m, r, b) => [m.replace('return cc ? accept(cc.data, courseRef) : null;', 'return cc ? normalizeCourse(cc.data) : null;'), r, b]],
  ['④が理由を知らせない', (m, r, b) => [m.replace('if (!r.ok) { logLine(courseBadLine(name, r.why)); return null; }', 'if (!r.ok) { return null; }'), r, b]],
  ['⑦の投稿前の告知を消す', (m, r, b) => [m.replace(/if \(!chk\.ok\) logLine\(hasKey\('log\.courseSubmitBad'\)[^\n]*\n/, ''), r, b]],
  ['⑦の hasKey ガードを外す', (m, r, b) => [m.replace("hasKey('log.courseSubmitBad') ? t('log.courseSubmitBad', { why: chk.why })", "t('log.courseSubmitBad', { why: chk.why })"), r, b]],
  ['⑥の告知を消す', (m, r, b) => [m.replace(/hasKey\('log\.ghCarsBad'\)/, 'false'), r, b]],
  ['⑧を素通しに戻す (✔適用だけ検査しない)', (m, r, b) => [m.replace('const r = acceptCourse(editor.toJSON(), true);', 'const r = { ok: true };'), r, b]],
  ['⑧が ② と違う基準を使う (割れが戻る)', (m, r, b) => [m.replace('acceptCourse(editor.toJSON(), true)', 'acceptCourse(editor.toJSON(), false)'), r, b]],
  ['起動時の共有復元が拒否を無視する', (m, r, b) => [m.replace('restoredCourse = selectCourse(shareState.course);', 'selectCourse(shareState.course);\n      restoredCourse = true;'), r, b]],
  ['rebuildCourseList が現在の選択を控えない', (m, r, b) => [m.replace('  courseSelValue = sel.value;\n', ''), r, b]],
  ['名前空間 import をやめて名前付きにする', (m, r, b) => [
    m.replace('  PRESETS, presetByName, normalizeCourse, loadPresets,', '  PRESETS, presetByName, normalizeCourse, loadPresets, acceptCourseData,')
     .replace('const f = courseParts.acceptCourseData;', 'const f = acceptCourseData;'), r, b]],
  ['古い course.js のフォールバックを消す', (m, r, b) => [
    m.replace("  if (typeof f !== 'function') return { ok: true, why: null, course: normalizeCourse(data) };\n", ''), r, b]],
  ['own を入口へ渡さない (全経路が同じ基準になる)', (m, r, b) => [m.replace('return f(data, { own: !!own });', 'return f(data);'), r, b]],
  ['⑤ verifyOfficialLocally が resolveRaceCourse を経なくなる', (m, r, b) => [m, r.replace('const rcourse = resolveRaceCourse(event.course);', 'const rcourse = event.course;'), b]],
  ['⑤ ghostVsWorld が resolveRaceCourse を経なくなる', (m, r, b) => [m, r.replace('const rcourse = resolveRaceCourse(race.event.course);', 'const rcourse = race.event.course;'), b]],
  ['③ データ復元が勝手に検査を始める', (m, r, b) => [m, r, b.replace('export function parseBackup(obj) {', 'export function parseBackup(obj) {\n  normalizeCourse(obj);')]],
  // ── 層 4 レビュー 2026-09-18 で見つかった「壊しても緑」の形を、変異で塞いだことの証拠にする ──
  // ②の拒否分岐から return だけを消す (関数冒頭の `if (!src) return false;` があるので、
  //   `return false;` を素朴に探す検査では捕まらなかった。実害は c が undefined のまま applyCourse へ落ちる)。
  ['②の拒否分岐から return false だけを消す', (m, r, b) => [
    m.replace("      if (courseSelValue && courseSources[courseSelValue]) $('courseSel').value = courseSelValue;\n      return false;\n",
              "      if (courseSelValue && courseSources[courseSelValue]) $('courseSel').value = courseSelValue;\n"), r, b]],
  // ⑧の拒否分岐から return だけを消す (拒否したコースをそのまま loadCourse してしまう)。
  ['⑧の拒否分岐から return だけを消す', (m, r, b) => [
    m.replace("if (!r.ok) { logLine(courseBadLine(editor.course.name || t('ed.name.default'), r.why)); return; }",
              "if (!r.ok) { logLine(courseBadLine(editor.course.name || t('ed.name.default'), r.why)); }"), r, b]],
  // main.js 以外のファイルに、入口を経ない取り込みを足す (main.js しか数えていないと素通りした)。
  ['race_ui.js に裸の normalizeCourse( を足す', (m, r, b) => [
    m, r.replace('const rcourse = resolveRaceCourse(event.course);', 'const rcourse = normalizeCourse(event.course);'), b]],
];
const ev = [];
for (const [label, mut] of MUTATIONS) {
  const [mm, rr, bb] = mut(MAIN, RACE_UI, BACKUP);
  if (mm === MAIN && rr === RACE_UI && bb === BACKUP) { ev.push(`変異「${label}」が当たらない (目印が変わった＝変異を直すこと)`); continue; }
  // 数え上げ側にも同じ変異を反映する (main.js を直した変異が normalizeCourse( の本数検査にも効くように)
  const js = { ...JS_SRCS, 'main.js': mm, 'race_ui.js': rr, 'data_backup.js': bb };
  if (checkWiring(mm, rr, bb, js).length === 0) ev.push(`変異「${label}」を C)/D) が捕まえない`);
}
console.log(`\nE) 変異試験 (配線を 1 つずつ壊す・${MUTATIONS.length} 変異)`);
report('E) 見逃した変異', ev);

console.log(`\n${pass ? 'PASS' : 'FAIL'} — wf_bc3_intake`);
process.exit(pass ? 0 : 1);
