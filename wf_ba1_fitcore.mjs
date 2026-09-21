// Stage BA1 常設ゲート — 判定コアの性能改修が **収容オラクルの答えを 1 ビットも変えていない** ことを固定する。
//
// 背景（実測 2026-09-15）:
//   フィットガードの判定コア `fitguard.js:settleFitRatio` 1 回ぶんは、出荷 1188 セルで最大 4.9 秒・目安 50ms 超 546 セル
//   （本ゲートと同じ呼び方の単独治具）。内訳を測ると、④ の 0.1 刻み降下で「収まらない」評価を何十回も払い、その 1 回ごとに
//   `freeSpawn` が廊下 BFS（最悪セルで 59%）と見通し判定（壁 960 本を毎回全走査）で重かった。`fitsAllCars` は carScale に
//   ついて単調でない（出荷 198 行＝コース×領域 のうち 65 行に反例）ので、二分探索で回数を減らすと落ち着き先が変わる
//   （入口で収まらない 5,562 通りのうち 877 通り）。∴ **回数は減らさず 1 回の評価を軽くした**:
//     ・fleet.js   見通し判定の線分交差を割り当てなしに（演算式・順序は同一）／廊下 BFS をジェネレータにして
//                  freeSpawn が決まった時点で打ち切る（出す順序・値は同一）／同じ地点の向き探索で壁候補を 1 回だけ引く
//     ・physics.js checkCollision を「候補を引く」「4 隅と交差を見る」の 2 部品に分け、壁ごとの割り当てを消した
//     ・geom.js    segIntersect の中の r/s をオブジェクトにしない（同じ演算式・同じ演算順・名前と引数は不変）
//     ・fitguard.js 判定 1 回ぶんの fitsAllCars メモ（④ 入口の二重評価と ⑤ の重複を消す。契約は wf_az2_fitguard.mjs D)/H)）
//   **読み込み互換も守る**: JS は Cache-Control 無しで配信され、古いモジュールがブラウザに数日残りうる。新しい名前を
//   名前付き import すると、古い相手ファイルと組み合わさった瞬間にアプリ全体が読み込めなくなる（BA1 で実測・C) 参照）。
//
// **なぜ別ゲートが要るか**: `wf_az2_fitguard.mjs` の A) は「凍結した旧ロジック」と「product の判定コア」を突き合わせるが、
//   **両者とも同じ product のオラクル（fitsAllCars/capacityOf）を呼ぶ**。オラクルの中身を変えると両側が一緒に動くので、
//   A) は何も言えない。ここでは**改修前のツリーで取った出力ダイジェスト**を凍結し、現在のオラクルの出力と突き合わせる。
//   配置（freeSpawn の列）はレース（race_engine の rebuildSpawns）と同じ関数なので、公式記録の再現性も同じ根で守られる
//   （verifyHash と凍結ハッシュ f0〜f3 は wf_ab8_bench / wf_official_result が別に見る）。
//
// 検査:
//   A) 出力ダイジェスト: 出荷コース＋治具 × 3 領域 × carScale で、freeSpawn 6 台ぶんの配置列（倍精度値そのもの）・
//      fitsAllCars(6)/(1)・capacityOf(6)/(3)・minClearance(3) を集めて sha256。コース単位の値も凍結して、食い違ったら場所を出す。
//   B) A) の自己検査: スタート位置を 1e-9 m ずらしただけでダイジェストが変わること（＝配置の違いを本当に見ている）。
//   C) 構造検査: 性能改修が戻っていないこと（戻っても答えは変わらないので A) では捕まらない＝ここで固定する）と、
//      public/js 配下の全ファイルが BA1 の触った 4 モジュールから**改修前に無かった名前**を名前付き import していないこと。
//   D) C) の変異試験。
//   E) キャッシュ混在の再現: 改修前の export 集合にした physics.js/geom.js の一時ツリーで実際に読み込み、代替経路を
//      通した答えが凍結値と一致すること（代替経路の実行回数も出す＝空振りでないこと）。
//
// 使い方: node wf_ba1_fitcore.mjs          … 検査
//         node wf_ba1_fitcore.mjs --pins   … 現在のツリーのダイジェストを印字する（**意図して配置を変えたとき**の再凍結用。
//                                             凍結値を書き換えるなら理由を決定ログに残すこと）
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
import { buildFromSpec, normalizeCourse } from './public/js/course.js';
import * as config from './public/js/config.js';
import * as fleetMod from './public/js/fleet.js';

const PRINT_PINS = process.argv.includes('--pins');
const specs = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
const REG = ['tabletop', 'midscale', 'fullscale'];
const SCALES = [0.5, 1, 2, 4];

let pass = true;
const report = (label, arr, n = 10) => {
  console.log(`  ${arr.length === 0 ? '○' : '✗'} ${label}: ${arr.length} 件`);
  arr.slice(0, n).forEach(s => console.log(`       - ${s}`));
  if (arr.length > n) console.log(`       … 他 ${arr.length - n} 件`);
  if (arr.length) pass = false;
};

// ── コーパス ─────────────────────────────────────────────────────────────────────
function fixtures() {
  const out = [];
  {   // 外形は広いが閉じた細い廊下（wf_az2_fitguard.mjs C) と同形）
    const W = 18, yc = 9, gap = 0.30, xa = 1, xb = 17;
    out.push(normalizeCourse({ name: 'fx:narrow', bounds: { w: W, h: W }, start: { x: 2, y: yc, theta: 0 }, walls: [
      { x1: xa, y1: yc - gap / 2, x2: xb, y2: yc - gap / 2 }, { x1: xb, y1: yc - gap / 2, x2: xb, y2: yc + gap / 2 },
      { x1: xb, y1: yc + gap / 2, x2: xa, y2: yc + gap / 2 }, { x1: xa, y1: yc + gap / 2, x2: xa, y2: yc - gap / 2 }] }));
  }
  {   // スタート地点だけ閉じた小部屋。**【BD4・2026-09-21】意図して凍結した写しである。**
      //   BD4 は同型の治具 4 本（wf_az2_fitguard / wf_az5_capzero / browser の 2 本）の枠の導出を
      //   `wf_roomfixture.mjs` へ 1 つにまとめ、部屋を原点・枠を product に答えさせた値（0.503m）へ揃えた。
      //   **ここだけ揃えない**: 下の PINNED は改修前ツリー（63fa638）で取った出力ダイジェストで、配置を
      //   変えると凍結値を刻み直すことになり、回帰記録としての価値が消える。∴ 枠 2.0・部屋 (0.2, 0.84)・
      //   車体寸法のリテラルをそのまま残す（wf_az2_fitguard E) ⑤ とは**もう同形ではない**）。
    const L = 0.19, Wc = 0.08, X = 1.7 * L, Y = 4 * Wc, W0 = 2.0, y0 = W0 / 2 - Y / 2, x0 = 0.2;
    out.push(normalizeCourse({ name: 'fx:pocket', bounds: { w: W0, h: W0 }, start: { x: x0 + X * 0.35, y: W0 / 2, theta: 0 }, walls: [
      { x1: x0, y1: y0, x2: x0 + X, y2: y0 }, { x1: x0 + X, y1: y0, x2: x0 + X, y2: y0 + Y },
      { x1: x0 + X, y1: y0 + Y, x2: x0, y2: y0 + Y }, { x1: x0, y1: y0 + Y, x2: x0, y2: y0 }] }));
  }
  return out;
}
function corpus() {
  const list = [];
  for (const s of specs) { try { list.push(buildFromSpec(s)); } catch { /* 出荷データの壊れは他ゲートが見る */ } }
  return [...list, ...fixtures()];
}
// 1 コースぶんのダイジェスト（3 領域 × SCALES）。JSON の数値は倍精度を往復で一意に表す＝値の 1 ビットの違いも拾う。
// `mods` を渡すと別のモジュール実体（E) の一時ツリー）で同じ手順を回す。省略時は product。
function courseDigest(c, mods = { cfg: config, fleet: fleetMod }) {
  const { cfg, fleet } = mods;
  const kLm = (r) => cfg.REGIMES[r].L / cfg.REGIMES.tabletop.L;
  const h = crypto.createHash('sha256');
  for (const r of REG) for (const uk of SCALES) {
    cfg.setRegimeScale(kLm(r)); cfg.setCarScale(uk);
    const occ = [];
    for (let i = 0; i < 6; i++) occ.push(fleet.freeSpawn(c, occ, i));
    const rec = { r, uk, occ: occ.map(o => [o.x, o.y, o.theta]), f6: fleet.fitsAllCars(c, 6), f1: fleet.fitsAllCars(c, 1),
      cap: fleet.capacityOf(c, 6), cap3: fleet.capacityOf(c, 3), mc: fleet.minClearance(c, 3) };
    h.update(JSON.stringify(rec) + '\n');
  }
  return h.digest('hex').slice(0, 24);
}

// ── 凍結値（改修前＝公開リポジトリ 63fa638〔v8.3.0〕のツリーで `--pins` を実行して取得・2026-09-15）─────────
const PINNED = {
  all: "e2cf0c7383eaf7b297de717abab34615bc631774eef1f8676b92b8737bd749eb",
  courses: {
    "オーバル": "edaed6af966de820013a9311",
    "スピードウェイ": "020ca7bb69aad70e22023085",
    "ヘアピン": "5f171407b14dc0293558913c",
    "90度サーキット": "0e2ce850e1f0e798cd038745",
    "S字シケイン": "601f4c4e713c9a0d7557c68e",
    "複合コーナー": "e207e0883fce8a1f77518abe",
    "ナローゲート": "993e3f34204a4ff45a00feb3",
    "ボトルネック": "f4f25ad9e2804ff86606ca81",
    "丸の中の四角": "918dc66df18a29391007144c",
    "四角の中の丸": "f75f8179b717d07257050771",
    "六角と三角": "7413720c6903dbc9ad764ff1",
    "うねりと円": "8cbeab3dd51f39ea11a52a41",
    "テクニカル周回 (簡易)": "58c61f4a03aa874bdaf205d1",
    "タイト市街地 (簡易)": "8d5e1aeed7dfe6d4113d985e",
    "ロングオーバル": "c10a2dbebc6d0021652fa260",
    "オクタゴン": "a8c2f36b83a85a64ca05bd28",
    "トライアングル": "4db6825700b5ad1a03194b2b",
    "ハイスピード・レイアウト": "9380dedf296fa4277767e2b9",
    "エッセ・レイアウト": "e9f7854ac836f61e59e5f03d",
    "ストリート・レイアウト": "76d4f692ab37fef74a84a8e8",
    "フローイング・レイアウト": "15e9fadb0fdfee97b1498911",
    "ロングラン・レイアウト": "a72d51da49f45cbba61f0799",
    "ロングストレート・レイアウト": "2125e3c856e1aca1b428c839",
    "コンパクト・レイアウト": "f40cbd2f48d6f4b100fce2c1",
    "ツイスティ・レイアウト": "7714ec9e129405d4d25bc14d",
    "ショート・レイアウト": "72af5756e68ad8be9bab8f99",
    "モダン・レイアウト": "170a6f05177976a96dab064e",
    "ストップ＆ゴー・レイアウト": "bd0b9dcfa12e0da35f62759b",
    "ナローシケイン・レイアウト": "94da72ddfa7cb5e1a917ba2b",
    "バンク・レイアウト": "2a547c415edfd4f782c7634b",
    "峠① 中速ヘアピン (緩い下り)": "3ca003c1eb32f88adba0a75d",
    "峠② タイトヘアピン (急な下り)": "1e51e6bd12fd1ed3f7d137b5",
    "峠③ 高速ヘアピン (大R下り)": "fc95acba561660636f599310",
    "ウェットテクニカル (雨)": "ae7b03cc4b1e9b0f7458b632",
    "ウェットS字 (雨)": "87be53981919bfc95b851e04",
    "架空峠 ロング・ワインディング(緩斜面)": "c324cc4f9ad71f5cbb3facc8",
    "架空峠 ロング・ワインディング(中斜面)": "4a8c56da091915fdf621d732",
    "架空峠 ロング・ワインディング(激坂)": "45dfbcd8738169b42a48d9c5",
    "ドリフト広場 (ショー会場)": "98dec8f71cd6e7bc59831464",
    "競技グラウンド (フルスケール)": "90e45928ddfffe38cda61d22",
    "競技サーキット (フルスケール)": "960932ed52d31c826b8c2088",
    "峠① 中速ヘアピン (緩い下り)〔道幅 4.5 台分〕": "7a3342c787c1106ba399578b",
    "峠① 中速ヘアピン (緩い下り)〔道幅 3 台分〕": "7d76df3ab8714d8bd4b00b1f",
    "峠① 中速ヘアピン (緩い下り)〔道幅 2 台分〕": "742886fb48e5341adb10bbb0",
    "峠② タイトヘアピン (急な下り)〔道幅 4.5 台分〕": "ac2e90ce3deace5da5683511",
    "峠② タイトヘアピン (急な下り)〔道幅 3 台分〕": "53d82fdf30b120107b098f8d",
    "峠② タイトヘアピン (急な下り)〔道幅 2 台分〕": "ccdceed260949b51a567e0c6",
    "峠③ 高速ヘアピン (大R下り)〔道幅 4.5 台分〕": "a0add77b62dcd5278ad99bbf",
    "峠③ 高速ヘアピン (大R下り)〔道幅 3 台分〕": "86d0d9bb5a1583aae7be2721",
    "峠③ 高速ヘアピン (大R下り)〔道幅 2 台分〕": "f0e3e571e774b0ef29b9ece1",
    "架空峠 ロング・ワインディング(緩斜面)〔道幅 4.5 台分〕": "94e55bfbb62b99631c43cf78",
    "架空峠 ロング・ワインディング(緩斜面)〔道幅 3 台分〕": "ff54647375ad0dbce83da138",
    "架空峠 ロング・ワインディング(緩斜面)〔道幅 2 台分〕": "1c2ed5c5d10d4188cbfd530d",
    "架空峠 ロング・ワインディング(中斜面)〔道幅 4.5 台分〕": "cb9f519fd707436227f278b4",
    "架空峠 ロング・ワインディング(中斜面)〔道幅 3 台分〕": "382bfd4dabb00330802c4f2a",
    "架空峠 ロング・ワインディング(中斜面)〔道幅 2 台分〕": "b3f1585a7a7518ea38ac6770",
    "架空峠 ロング・ワインディング(激坂)〔道幅 4.5 台分〕": "92fa070937607b89188f308e",
    "架空峠 ロング・ワインディング(激坂)〔道幅 3 台分〕": "9bbace17f328db05c3539568",
    "架空峠 ロング・ワインディング(激坂)〔道幅 2 台分〕": "e27a22fd067ff0c7cbe27e0a",
    "舵角限界ベンチ R_out/R_min=1.02〔道幅 2 台分〕": "98c7e3e99360f3fd0c883bd7",
    "舵角限界ベンチ R_out/R_min=0.95〔道幅 2 台分〕": "0a367d262b46be495ebdc6ad",
    "舵角限界ベンチ R_out/R_min=0.856〔道幅 2 台分〕": "20ea7991b9b14974a49c42ac",
    "舵角限界ベンチ R_out/R_min=0.8〔道幅 2 台分〕": "03c351fa4fcde7e3e520eff8",
    "舵角限界ベンチ R_out/R_min=1.02〔道幅 3.5 台分〕": "3a51b2ba95345e3335e25b59",
    "舵角限界ベンチ R_out/R_min=0.95〔道幅 3.5 台分〕": "a886f3794bb030487554ae09",
    "舵角限界ベンチ R_out/R_min=0.856〔道幅 3.5 台分〕": "c1bb005984cff6245ebd7f57",
    "fx:narrow": "1f43b6c4bf5a9c0e072f76e8",
    "fx:pocket": "2d0f61e36a27c250e392d6da",
  },
};

console.log('Stage BA1 判定コア性能改修ゲート — 収容オラクルの出力を改修前とビット単位で一致させる');
console.log('='.repeat(78));
const t0 = Date.now();
const courses = corpus();
const got = {};
for (const c of courses) got[c.name] = courseDigest(c);
const all = crypto.createHash('sha256').update(JSON.stringify(got)).digest('hex');
const secA = (Date.now() - t0) / 1000;
if (PRINT_PINS) {
  console.log(JSON.stringify({ all, courses: got }, null, 2));
  process.exit(0);
}
console.log(`\nA) 出力ダイジェスト: ${courses.length} コース × ${REG.length} 領域 × ${SCALES.length} carScale（${secA.toFixed(1)}s）`);
console.log(`   現在 ${all}`);
console.log(`   凍結 ${PINNED ? PINNED.all : '(未設定)'}`);
{
  const bad = [];
  if (!PINNED) bad.push('凍結値が未設定');
  else {
    for (const [name, d] of Object.entries(got)) {
      if (!(name in PINNED.courses)) bad.push(`${name}: 凍結値に無いコース（出荷コースを足したなら --pins で再凍結し、理由を記録する）`);
      else if (PINNED.courses[name] !== d) bad.push(`${name}: ${d}（凍結 ${PINNED.courses[name]}）＝配置か収容の答えが改修前と違う`);
    }
    for (const name of Object.keys(PINNED.courses)) if (!(name in got)) bad.push(`${name}: 凍結値にあるが現在のコーパスに無い`);
    if (!bad.length && PINNED.all !== all) bad.push(`全体ダイジェストだけが違う（${all}）`);
  }
  report('A) 改修前と出力が違うコース', bad);
}

// ── B) A) の自己検査（ダイジェストが配置の違いを本当に見ているか）───────────────────────
//   出荷の先頭コースのスタート位置を 1e-9 m だけずらす。配置候補はスタート基準で並ぶので配置列の値が変わり、
//   ダイジェストも変わらなければならない。変わらないなら A) の一致は「何も見ていない一致」である。
{
  const bad = [];
  const base = buildFromSpec(specs[0]);
  const moved = { ...base, start: { ...base.start, x: base.start.x + 1e-9 } };
  const dBase = got[base.name], dMoved = courseDigest(moved);
  console.log(`\nB) 自己検査「${base.name}」: そのまま ${dBase} ／ スタートを 1e-9 m ずらす ${dMoved}`);
  if (dBase === dMoved) bad.push('スタートを動かしてもダイジェストが変わらない＝A) は配置を見ていない');
  report('B) ダイジェストの感度', bad);
}

// ── C) 構造検査（性能改修が戻っていないこと・読み込み互換）───────────────────────────────
//   戻っても答えは同じなので A) では捕まらない。**性能の根拠になった形そのもの**と、**キャッシュ混在で起動しなくなる
//   import を作らないこと**を固定する。コメントを剥がしてから照合する（wf_az2_fitguard.mjs D) と同じ剥がし方）。
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => (/:\/\//.test(l) ? l : l.replace(/\/\/.*$/, ''))).join('\n');
const bodyOf = (src, header) => {
  const i = src.indexOf(header); if (i < 0) return '';
  const j = src.indexOf('\n}', i); return j < 0 ? src.slice(i) : src.slice(i, j + 2);
};
// **改修前（公開リポジトリ 63fa638）の export 名**（`before` ツリーを import して Object.keys で取得・2026-09-15）。
//   ブラウザが改修前のファイルを持ったまま新しい importer を取ると、ここに無い名前の名前付き import は
//   `does not provide an export named` でモジュールグラフ全体を落とす（BA1 で実測）。
//   **ここを書き換えてよいのは、配信側でキャッシュ混在が起きないと確かめたときだけ**（例: JS に Cache-Control を付けて
//   十分な日数が経った）。書き換えるなら理由を決定ログに残す。
const PRE_BA1_EXPORTS = {
  'physics.js': ['Car', 'carEdges', 'checkCollision', 'collisionReach'],
  'geom.js': ['clamp', 'coneNearest', 'distToSeg', 'fanDepths', 'fanHits', 'raySeg', 'segIntersect'],
  'fleet.js': ['applyRoadFrame', 'applyStartGate', 'capacityOf', 'fitsAllCars', 'freeSpawn', 'integrateFleetV2', 'integrateSlot',
    'makeSlot', 'minClearance', 'normBrake', 'normGear', 'normSteer', 'normSusp', 'normTire', 'othersFor', 'rebuildSpawns',
    'releaseDrive', 'roadFrame', 'spawnPos', 'swapPhysics', 'tickSlot'],
  'fitguard.js': ['FIT', 'settleFitRatio', 'settleScale'],
};
const JS_ROOT = './public/js';
function listJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJs(p)); else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
// srcs: { 相対パス(public/js 基準): 生ソース }。F) 相当の変異は、この表の一部を差し替えて渡す。
function checkStructural(srcs) {
  const fleet = strip(srcs['fleet.js']), phys = strip(srcs['physics.js']), geom = strip(srcs['geom.js']);
  const v = [];
  for (const [src, canary, who] of [
    [fleet, 'export function freeSpawn(course, occupied, idx) {', 'fleet.js'],
    [fleet, 'function* corridorCandidates(course, st, maxPts = 600) {', 'fleet.js'],
    [phys, 'export function checkCollision(car, walls, extra = []) {', 'physics.js'],
    [geom, 'export function segIntersect(a, b, c, d) {', 'geom.js'],
  ]) if (!src.includes(canary)) v.push(`${who} に「${canary}」が無い（改修前の形に戻った、または strip() がソースを食べた）`);

  // --- 読み込み互換: public/js 配下の全ファイルについて、BA1 が触った 4 モジュールからの名前付き import が
  //     改修前の export 名に収まっていること（**行の有無でなく名前の集合**で見る＝別行・別ファイルで足しても捕まる）---
  let importsSeen = 0;
  for (const [rel, raw] of Object.entries(srcs)) {
    const src = strip(raw);
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[2]));
      if (!(target in PRE_BA1_EXPORTS)) continue;
      importsSeen++;
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name && !PRE_BA1_EXPORTS[target].includes(name))
          v.push(`${rel} が ${target} から改修前に無かった名前「${name}」を名前付き import している＝古い ${target} がキャッシュに残るブラウザで起動しない（名前空間 import で「あれば使う」にすること）`);
      }
    }
  }
  if (importsSeen < 10) v.push(`名前付き import を ${importsSeen} 件しか見つけられない（検査が空振りしている。strip() か正規表現を確かめること）`);
  if (!/^import \* as physicsParts from '\.\/physics\.js';$/m.test(fleet)) v.push('fleet.js が physics.js の新しい部品を名前空間 import で受けていない');

  // --- fleet.js: 廊下 BFS は 1 個ずつ出し、freeSpawn は決まった時点で打ち切る ---
  const corr = bodyOf(fleet, 'function* corridorCandidates(course, st, maxPts = 600) {');
  if (!/\n      yield node;\n/.test(corr)) v.push('corridorCandidates が候補を 1 個ずつ出していない（yield が無い＝全件を作ってから返す形に戻った）');
  if (/return out;/.test(corr)) v.push('corridorCandidates が配列をまとめて返している（打ち切れない）');
  const fs_ = bodyOf(fleet, 'export function freeSpawn(course, occupied, idx) {');
  if (!/for \(const c of corridorCandidates\(course, st\)\) \{[\s\S]{0,300}?if \(d >= sep\) return \{/.test(fs_))
    v.push('freeSpawn が廊下候補を順に読んで「十分離れた最初の候補」で return していない');
  if (/\[\.\.\.corridorCandidates|Array\.from\(corridorCandidates/.test(fleet)) v.push('廊下候補を配列へ展開している（打ち切りが効かない）');
  // --- fleet.js: 同じ地点の向き探索で壁候補は 1 回・姿勢は使い回し（古い physics.js では従来の checkCollision）---
  if (!/const shared = \(typeof physicsParts\.collisionCandidates === 'function' && typeof physicsParts\.cornersHitSegs === 'function'\)\s*\? \{ candidates: physicsParts\.collisionCandidates, hit: physicsParts\.cornersHitSegs \} : null;/.test(corr))
    v.push('廊下 BFS が physics.js の新しい部品の有無を確かめていない／形が変わった');
  if (!/\n      probe\.x = x; probe\.y = y;\n      if \(shared\) \{/.test(corr))
    v.push('廊下 BFS が向き探索の前に姿勢の位置を（両経路とも）書いていない');
  if (!/if \(shared\) \{\s*const cand = shared\.candidates\(course\.walls, x, y\);\s*for \(const th of ths\) \{\s*probe\.theta = th;\s*if \(!shared\.hit\(probe\.corners\(\), cand\)\) \{ theta = th; break; \}/.test(corr))
    v.push('廊下 BFS の向き探索が「地点ごとに候補を 1 回だけ引く」形になっていない');
  if (!/\} else \{\s*for \(const th of ths\) \{\s*probe\.theta = th;\s*if \(!checkCollision\(probe, course\.walls\)\) \{ theta = th; break; \}/.test(corr))
    v.push('廊下 BFS の「古い physics.js のとき」の経路が従来の checkCollision になっていない');
  if ((corr.match(/new Car\(/g) || []).length !== 1) v.push(`廊下 BFS の中で Car を ${(corr.match(/new Car\(/g) || []).length} 回作っている（姿勢は 1 個を使い回す）`);
  // --- fleet.js: 見通し判定は壁ごとの割り当てなし・演算と許容誤差は旧 segHit と同じ ---
  if (!/const losClear = \(x, y, tx, ty\) => segClearOfWalls\(x, y, tx, ty, course\.walls\);/.test(fs_)) v.push('freeSpawn の見通し判定が segClearOfWalls を使っていない');
  if (!/if \(!segClearOfWalls\(c\.x, c\.y, x, y, course\.walls\)\) continue;/.test(corr)) v.push('廊下 BFS の 1 歩の判定が segClearOfWalls を使っていない');
  const shw = bodyOf(fleet, 'function segHitWall(ax, ay, bx, by, w) {');
  const scw = bodyOf(fleet, 'function segClearOfWalls(ax, ay, bx, by, walls) {');
  if (!shw) v.push('fleet.js に segHitWall が無い');
  if (!scw) v.push('fleet.js に segClearOfWalls が無い');
  for (const [b, who] of [[shw, 'segHitWall'], [scw, 'segClearOfWalls']])
    if (b && (/\{\s*x\s*:/.test(b) || /\.some\(/.test(b) || /=>/.test(b))) v.push(`${who} の中でオブジェクトかクロージャを作っている（壁ごとの割り当てが戻った）`);
  //   旧 segHit(a,b,c,d) の各行を c=壁の始点・d=壁の終点で読み替えた形。**許容誤差 1e-7 も含めて**行ごとに固定する
  //   （層 4 レビュー 2026-09-15: 1e-7→1e-6 は A) の出荷コーパスでは答えが変わらず素通りしたが、自作コースで配置が変わる）。
  for (const line of ['const rx = bx - ax, ry = by - ay, sx = w.x2 - w.x1, sy = w.y2 - w.y1;', 'const den = rx * sy - ry * sx;',
    'if (Math.abs(den) < 1e-12) return false;', 'const t = ((w.x1 - ax) * sy - (w.y1 - ay) * sx) / den;',
    'const u = ((w.x1 - ax) * ry - (w.y1 - ay) * rx) / den;', 'const e = 1e-7;', 'return t >= -e && t <= 1 + e && u >= -e && u <= 1 + e;'])
    if (!shw.includes(line)) v.push(`segHitWall の演算か許容誤差が旧 segHit と違う形になった（${line}）`);
  if (!/for \(let i = 0; i < walls\.length; i\+\+\) if \(segHitWall\(ax, ay, bx, by, walls\[i\]\)\) return false;\n  return true;/.test(scw))
    v.push('segClearOfWalls が「全壁を順に見て 1 本でも当たれば偽」の形でない');
  // --- physics.js: checkCollision は 2 部品の合成で、内側ループに割り当てが無い ---
  const cc = bodyOf(phys, 'export function checkCollision(car, walls, extra = []) {');
  if (!/return cornersHitSegs\(cs, collisionCandidates\(walls, car\.x, car\.y\)\) \|\| \(extra\.length > 0 && cornersHitSegs\(cs, extra\)\);/.test(cc))
    v.push('checkCollision が cornersHitSegs / collisionCandidates の合成になっていない（廊下 BFS と別の判定になりうる）');
  const chs = bodyOf(phys, 'export function cornersHitSegs(cs, segs) {');
  if (!chs) v.push('physics.js に cornersHitSegs が無い');
  else {
    if (/\{\s*x\s*:|for \(const \[|\.some\(|=>/.test(chs)) v.push('cornersHitSegs の中でオブジェクト・分割代入・クロージャを作っている（壁ごとの割り当てが戻った）');
    if (!/_wa\.x = w\.x1; _wa\.y = w\.y1; _wb\.x = w\.x2; _wb\.y = w\.y2;/.test(chs)) v.push('cornersHitSegs が使い回しの端点へ書いていない');
    if (!/segIntersect\(c0, c1, _wa, _wb\) \|\| segIntersect\(c1, c2, _wa, _wb\)\s*\|\| segIntersect\(c2, c3, _wa, _wb\) \|\| segIntersect\(c3, c0, _wa, _wb\)/.test(chs))
      v.push('cornersHitSegs の辺の組が旧 checkCollision（c0c1, c1c2, c2c3, c3c0）と同じでない');
  }
  if (!/export function collisionCandidates\(walls, x, y\) \{\n  return wallsNear\(walls, x, y, collisionReach\(\), 2 \* CAR\.length\);\n\}/.test(phys))
    v.push('collisionCandidates が checkCollision の旧候補検索（wallsNear・半径 collisionReach・セル 2×車長）と同じでない');
  // --- geom.js: segIntersect は割り当てなしで、演算式・演算順は旧実装と同じ ---
  const si = bodyOf(geom, 'export function segIntersect(a, b, c, d) {');
  if (/\{\s*x\s*:/.test(si)) v.push('segIntersect の中でオブジェクトを作っている（最内ループの割り当てが戻った）');
  for (const line of ['const rx = b.x - a.x, ry = b.y - a.y;', 'const sx = d.x - c.x, sy = d.y - c.y;', 'const denom = rx * sy - ry * sx;',
    'if (Math.abs(denom) < 1e-12) return false;', 'const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;',
    'const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;', 'return t >= 0 && t <= 1 && u >= 0 && u <= 1;'])
    if (!si.includes(line)) v.push(`segIntersect の演算が旧実装と違う形になった（${line}）＝ビット同一の根拠が崩れる`);
  return v;
}
const SRCS = Object.fromEntries(listJs(JS_ROOT).map(p => [path.relative(JS_ROOT, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8')]));
const structural = checkStructural(SRCS);
console.log(`\nC) 構造検査（コメントを剥がして照合・public/js 配下 ${Object.keys(SRCS).length} ファイルの import を含む）`);
report('C) 性能改修の形・読み込み互換が崩れた箇所', structural);

// ── D) C) の変異試験（守っている行を 1 つずつ壊して赤くなるか）──────────────────────────
const M = (edits) => ({ ...SRCS, ...Object.fromEntries(Object.entries(edits).map(([f, fn]) => [f, fn(SRCS[f])])) });
const MUTATIONS = [
  ['廊下 BFS を配列で返す形に戻す', M({ 'fleet.js': s => s.replace('function* corridorCandidates(', 'function corridorCandidates(').replace('      q.push(node); out.push(node);\n      yield node;\n', '      q.push(node); out.push(node);\n').replace('    }\n  }\n}\n\n// 1 台分の', '    }\n  }\n  return out;\n}\n\n// 1 台分の') })],
  ['freeSpawn が廊下候補を配列へ展開する', M({ 'fleet.js': s => s.replace('for (const c of corridorCandidates(course, st)) {', 'for (const c of [...corridorCandidates(course, st)]) {') })],
  ['fleet.js が新しい部品を既存の import 行へ足す', M({ 'fleet.js': s => s.replace("import { Car, checkCollision, carEdges } from './physics.js';", "import { Car, checkCollision, carEdges, collisionCandidates } from './physics.js';") })],
  ['fleet.js が新しい部品を**別の行で**名前付き import する（層 4 レビューの反例）', M({ 'fleet.js': s => s.replace("import * as physicsParts from './physics.js';", "import * as physicsParts from './physics.js';\nimport { cornersHitSegs } from './physics.js';") })],
  ['physics.js が geom.js から新しい名前を import する', M({ 'physics.js': s => s.replace("import { segIntersect } from './geom.js';", "import { segIntersect, segIntersectXY } from './geom.js';") })],
  ['BA1 が触っていない別ファイル（fitguard.js）が physics.js の新しい名前を import する', M({ 'fitguard.js': s => s.replace("import { driveableCapN } from './capacity.js';", "import { driveableCapN } from './capacity.js';\nimport { cornersHitSegs } from './physics.js';") })],
  ['向き探索で向きごとに Car を作り直す', M({ 'fleet.js': s => s.replace('if (!checkCollision(probe, course.walls)) { theta = th; break; }', 'if (!checkCollision(new Car({ x, y, theta: th }), course.walls)) { theta = th; break; }') })],
  ['向き探索の候補を向きごとに引き直す', M({ 'fleet.js': s => s.replace('if (!shared.hit(probe.corners(), cand))', 'if (!shared.hit(probe.corners(), shared.candidates(course.walls, x, y)))') })],
  ['新しい部品の有無を確かめずに使う', M({ 'fleet.js': s => s.replace("const shared = (typeof physicsParts.collisionCandidates === 'function' && typeof physicsParts.cornersHitSegs === 'function')", "const shared = (true)") })],
  ['古い physics.js 側の経路だけ姿勢の y を書かない（層 4 レビューの反例）', M({ 'fleet.js': s => s.replace('      probe.x = x; probe.y = y;\n      if (shared) {', '      probe.x = x; if (shared) probe.y = y;\n      if (shared) {') })],
  ['見通し判定を壁ごとにオブジェクトを作る形に戻す', M({ 'fleet.js': s => s.replace('const losClear = (x, y, tx, ty) => segClearOfWalls(x, y, tx, ty, course.walls);', 'const losClear = (x, y, tx, ty) => !course.walls.some(w => segHitWall(x, y, tx, ty, { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 }));') })],
  ['segClearOfWalls を some とクロージャにする', M({ 'fleet.js': s => s.replace('  for (let i = 0; i < walls.length; i++) if (segHitWall(ax, ay, bx, by, walls[i])) return false;\n  return true;', '  return !walls.some(w => segHitWall(ax, ay, bx, by, w));') })],
  ['segHitWall の許容誤差を 1e-7→1e-6 にする（層 4 レビューの反例）', M({ 'fleet.js': s => s.replace('  const e = 1e-7;\n  return t >= -e', '  const e = 1e-6;\n  return t >= -e') })],
  ['segHitWall の t を分配して書き直す（ビット同一の根拠が崩れる形）', M({ 'fleet.js': s => s.replace('const t = ((w.x1 - ax) * sy - (w.y1 - ay) * sx) / den;', 'const t = (w.x1 * sy - ax * sy - (w.y1 - ay) * sx) / den;') })],
  ['checkCollision を 2 部品の合成から外す', M({ 'physics.js': s => s.replace('return cornersHitSegs(cs, collisionCandidates(walls, car.x, car.y)) || (extra.length > 0 && cornersHitSegs(cs, extra));', 'const cand = wallsNear(walls, car.x, car.y, collisionReach(), 2 * CAR.length);\n  return cornersHitSegs(cs, cand) || (extra.length > 0 && cornersHitSegs(cs, extra));') })],
  ['cornersHitSegs で壁ごとに端点オブジェクトを作る', M({ 'physics.js': s => s.replace('    _wa.x = w.x1; _wa.y = w.y1; _wb.x = w.x2; _wb.y = w.y2;', '    const _wa = { x: w.x1, y: w.y1 }, _wb = { x: w.x2, y: w.y2 };') })],
  ['cornersHitSegs の辺の組を 1 本落とす', M({ 'physics.js': s => s.replace('\n      || segIntersect(c2, c3, _wa, _wb) || segIntersect(c3, c0, _wa, _wb)) return true;', '\n      || segIntersect(c2, c3, _wa, _wb)) return true;') })],
  ['collisionCandidates の半径を変える', M({ 'physics.js': s => s.replace('return wallsNear(walls, x, y, collisionReach(), 2 * CAR.length);', 'return wallsNear(walls, x, y, collisionReach() * 1.01, 2 * CAR.length);') })],
  ['segIntersect を割り当てのある形に戻す', M({ 'geom.js': s => s.replace('  const rx = b.x - a.x, ry = b.y - a.y;\n', '  const r = { x: b.x - a.x, y: b.y - a.y };\n  const rx = r.x, ry = r.y;\n') })],
  ['segIntersect の t を逆数の乗算にする（ビット同一の根拠が崩れる形）', M({ 'geom.js': s => s.replace('const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;', 'const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) * (1 / denom);') })],
];
console.log('\nD) C) の変異試験（product のファイルは読むだけ・変異はメモリ上）');
{
  const miss = [], noop = [];
  for (const [name, srcs] of MUTATIONS) {
    if (Object.keys(srcs).every(k => srcs[k] === SRCS[k])) { noop.push(`${name}（変異が適用されていない＝パターンが実装とズレた）`); continue; }
    if (checkStructural(srcs).length <= structural.length) miss.push(name);
  }
  console.log(`  変異 ${MUTATIONS.length} 件を注入`);
  report('D) C) が見逃した変異', miss);
  report('D) 適用できなかった変異（パターン腐り）', noop);
}

// ── E) キャッシュ混在の再現（振る舞い）: 改修前の export 集合の physics.js / geom.js で読み込み、答えが同じか ──
//   一時ディレクトリに public/js を写し、physics.js と geom.js から「改修前に無かった export」の `export` を外す
//   （＝古いファイルがキャッシュに残ったブラウザと同じ名前の集合）。そのツリーの fleet.js / fitguard.js / race_engine.js を
//   実際に import し、①読み込めること ②fleet.js が代替経路（従来の checkCollision）を**実際に通った**こと
//   ③A) と同じ手順のダイジェストが凍結値と一致すること、を確かめる。**product のファイルは書き換えない**。
//   代替経路の実行回数は、一時ツリーの fleet.js の該当行にだけ数え上げを足して測る（判定の真偽は変えない形）。
console.log('\nE) キャッシュ混在の再現（改修前の export 集合の physics.js/geom.js ＋ 現在の fleet.js/fitguard.js）');
{
  const bad = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf_ba1_mix_'));
  try {
    fs.cpSync(JS_ROOT, path.join(tmp, 'js'), { recursive: true });
    const unexport = (file) => {
      const p = path.join(tmp, 'js', file);
      let s = fs.readFileSync(p, 'utf8');
      const removed = [];
      s = s.replace(/^export (function\*? |const |class )(\w+)/gm, (all, kind, name) => {
        if (PRE_BA1_EXPORTS[file].includes(name)) return all;
        removed.push(name); return kind + name;
      });
      fs.writeFileSync(p, s);
      return removed;
    };
    const removedPhys = unexport('physics.js'), removedGeom = unexport('geom.js');
    console.log(`   一時ツリーで export を外した名前: physics.js=[${removedPhys.join(', ')}] geom.js=[${removedGeom.join(', ')}]`);
    {
      const p = path.join(tmp, 'js', 'fleet.js');
      const s = fs.readFileSync(p, 'utf8');
      const from = 'if (!checkCollision(probe, course.walls)) { theta = th; break; }';
      const to = 'if ((globalThis.__ba1Fallback = (globalThis.__ba1Fallback || 0) + 1, !checkCollision(probe, course.walls))) { theta = th; break; }';
      if (!s.includes(from)) bad.push('一時ツリーの fleet.js に代替経路の行が見つからない（数え上げを足せない）');
      fs.writeFileSync(p, s.replace(from, to));
    }
    globalThis.__ba1Fallback = 0;
    const url = (f) => pathToFileURL(path.join(tmp, 'js', f)).href;
    let mods = null;
    try {
      const [physT, cfgT, fleetT] = await Promise.all([import(url('physics.js')), import(url('config.js')), import(url('fleet.js'))]);
      await import(url('fitguard.js')); await import(url('race_engine.js')); await import(url('capacity.js'));
      if (typeof physT.cornersHitSegs !== 'undefined') bad.push('一時ツリーの physics.js にまだ cornersHitSegs がある（古い export 集合を再現できていない）');
      mods = { cfg: cfgT, fleet: fleetT };
    } catch (e) {
      bad.push(`改修前の export 集合の physics.js/geom.js と組み合わせると読み込めない: ${e.constructor.name}: ${e.message}`);
    }
    if (mods) {
      const pick = new Set(['fx:narrow', 'fx:pocket', 'オーバル', 'ヘアピン', '峠② タイトヘアピン (急な下り)〔道幅 2 台分〕', 'ボトルネック']);
      let n = 0;
      for (const c of courses) {
        if (!pick.has(c.name)) continue;
        n++;
        const d = courseDigest(c, mods);
        if (PINNED.courses[c.name] !== d) bad.push(`${c.name}: 代替経路で ${d}（凍結 ${PINNED.courses[c.name]}）＝古い physics.js のブラウザで答えが変わる`);
      }
      console.log(`   コース ${n} 本で照合・代替経路（checkCollision）の実行回数 ${globalThis.__ba1Fallback}`);
      if (n !== pick.size) bad.push(`照合したコースが ${n}/${pick.size} 本（コース名が変わった）`);
      if (!(globalThis.__ba1Fallback > 0)) bad.push('代替経路が 1 回も実行されていない＝この照合は空振り');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  report('E) キャッシュ混在で読み込めない／答えが変わる', bad);
}

console.log('\n' + '='.repeat(78));
console.log(pass ? 'BA1 判定コア性能改修ゲート: 全パス ○' : 'BA1 判定コア性能改修ゲート: ✗ 不合格');
console.log('='.repeat(78));
process.exit(pass ? 0 : 1);
