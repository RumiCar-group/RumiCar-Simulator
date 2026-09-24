// wf_be2_practicekey.mjs — BE2: 練習ベストを「コース名」でなく「コースの形」で引くこと。
// ════════════════════════════════════════════════════════════════════════════
// 何を守るゲートか:
//   v8.7.0 までの練習ベストの鍵は `rumicar.practice.<コース名>::<車種>` で、**名前は識別子であって形ではない**。
//   ∴ 保存コースの壁だけを編集して同じ名前で ✔適用すると、別レイアウトのベストが自分の記録として出た
//   （BD-3(a)・実ブラウザで再現＝`browser/check_be2_practicekey.mjs`）。名前がプリセットと重複する自作コースも
//   同じ鍵を奪い合った（BB-4 ⑤）。本ゲートは product の関数（`lap.js` の `LapTracker`/`loadBestRec`/
//   `practiceCourseId`・`challenge.js`・`data_backup.js`）を**直接呼んで**同じ性質を卓上で固定する。
//
// 記録の作り方（CI-8）: localStorage に記録を直接書かない。`LapTracker.update` にフィニッシュラインを
//   負側→正側へ横切る基準点を渡し、product の `_saveBest` に書かせる（走行物理は通さない＝ここで測るのは
//   「どの鍵に書き、どの鍵から読むか」だけ）。**旧形式の記録だけは例外**: v8.7.0 の product はもう無いので、
//   現行の product に書かせた値（`captureCond` が作る `cond` ごと）を、凍結した旧キーの書式
//   `rumicar.practice.<名前>::<車種>` へ移して作る（値は product 製・鍵の文字列だけが凍結した書式）。
//
// 章立て:
//   A) 後方互換: 出荷全コース × 全車種で、v8.7.0 形式の記録（AP2 以降の cond 付き JSON）と AP2 以前の記録
//      （裸の数値）の**両方**が改修後も同じ t・同じ ver で読める（損失 0）。`LapTracker.reset` 経由（HUD の BEST と
//      「(当時 vX)」の元）でも同じ。層 4（2026-09-24）の指摘で AP2 以前の形式を母集団に足した（初版は現行 product が
//      書いた cond 付きの記録だけを測っており、条件を構成上満たすので AP2 以前の損失を測れなかった）。
//   B) 本件: 同名で壁だけ違うコースには、新形式・旧形式どちらの記録も出ない。形を変える差（壁・枠・スタート・
//      フィニッシュ・峠・勾配・路面・グリップ・バンク・丸めの格子 1e-6 を超える 1e-5 の移動）ではすべて分かれ、名前・説明・格付けだけの
//      差・深いコピー・鍵の並べ替えでは分かれない（＝名前を変えても記録は残る）。
//   C) 同名の別コース（プリセットと同名の自作・名前が空の 2 本）が互いの記録を読まず、上書きもしない。
//   D) 形を証明できない旧記録（自作・投稿コースの旧記録＝裸の数値・cond 無し・courseHash 一致でも）と、別レイアウトの
//      証拠がある旧記録（出荷コースで courseHash 不一致）は出さず、**消さない**（byte 不変）。
//      新しいベストを書いた後も旧キーは byte 不変。旧記録より遅いラップでは新キーを作らない。
//   E) `data_backup.js` の往復で新形式の記録が byte 同値で戻り、同じ記録として読める。
//   F) 指紋の安定性: 作り直し・JSON 往復（＝再読込後）・`runRace` で走らせた後も同じ（実行時の書き込みで
//      鍵がずれない）。チャレンジ（`challengeState`）も形で数える。`public/js` に名前で引く呼び出しが残っていない。
//   P) 凍結表: 出荷全コースの `practiceCourseId` を値そのもので固定する。新しい鍵は指紋の**値**に永続的に依存する
//      （値が 1 bit 変われば、その形の記録は利用者のブラウザで丸ごと見えなくなり、旧キーのような救済経路も無い）。
//      相異性・安定性だけでは値の変化を捕まえられない（層 4 の実測: digest の初期値を変えても A〜G は緑だった）。
//      **この表を刻み直すのは「そのコースの練習記録を別の記録として始め直す」決定**であり、刻み直した版の
//      CHANGELOG に「どのコースの練習ベストが新しく始まるか」を書くこと（黙って刻み直さない）。
//   G) 検出力: 一時ツリーへ複製して鍵を壊す変異を入れ、上の章が赤くなることを測る（product は無改変）。
//
// 【測らないこと】指紋の計算時間（`main.js`・`fleet.js` の注記の値は凍結した点測定）。HUD の描画そのもの
//   （実ブラウザゲートが HUD の fillText を測る）。F) の「名前で引く呼び出しの残存」は第 1 引数の字面に `.name`/`Name`
//   を含むものしか捕まえない（`loadBestRec(nm, k)` のような変数は素通り）— ただし文字列を渡すと product は null を返す
//   （D) が測る）ので、漏れても「別のコースの記録が出る」ではなく「記録が出ない」側に倒れる。
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'node:url';

const JS_ROOT = './public/js';
const SPECS = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
const LEGACY_VER = 'v8.7.0';                        // 旧形式の記録に刻む版（「(当時 vX)」の元になる値）
const legacyKey = (name, car) => 'rumicar.practice.' + name + '::' + car;   // 凍結した v8.7.0 の鍵の書式

// localStorage（Map 1 つ）。getItem/setItem/removeItem/key/length だけ＝`data_backup.js` と `lap.js` が使う面。
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
// 出荷コースの定義は product の `loadPresets`（`course.js`）に読ませる。node の `fetch` は file を読めないので、
// その 1 本の URL にだけ実ファイルの中身を返す（旧記録の採否 (b) が同名の出荷コースを引くため・中身は配信物そのもの）。
const COURSES_RAW = fs.readFileSync('./public/data/courses.json', 'utf8');
globalThis.fetch = async (url) => {
  if (String(url) !== 'data/courses.json') throw new Error('想定外の取得: ' + url);
  return { ok: true, status: 200, json: async () => JSON.parse(COURSES_RAW) };
};

let pass = true;
const report = (label, violations) => {
  if (violations.length) { pass = false; console.log(`  ✗ ${label}: ${violations.length} 件`); for (const v of violations.slice(0, 12)) console.log(`      - ${v}`); if (violations.length > 12) console.log(`      … ほか ${violations.length - 12} 件`); }
  else console.log(`  ✓ ${label}: 0 件`);
};

const _tmpDirs = [];
async function loadTree(dir) {
  const url = (f) => pathToFileURL(path.resolve(dir, f)).href;
  const [lap, crs, cfg, ch, bk, eng, prog, fleet] = await Promise.all([
    import(url('lap.js')), import(url('course.js')), import(url('config.js')), import(url('challenge.js')),
    import(url('data_backup.js')), import(url('race_engine.js')), import(url('programs.js')), import(url('fleet.js'))]);
  await crs.loadPresets();
  if (crs.PRESETS.length !== SPECS.length) throw new Error(`出荷コースが ${crs.PRESETS.length} 本しか読めていない（${SPECS.length} 本のはず）`);
  return { lap, crs, cfg, ch, bk, eng, prog, fleet };
}

// フィニッシュラインを負側→正側へ横切らせて 1 周（峠は 1 回のゴール）を計上させる。記録は product が書く。
function lapOnce(m, course, carType, sec) {
  const f = course.finish;
  const mx = (f.x1 + f.x2) / 2, my = (f.y1 + f.y2) / 2;
  const P = (s) => [mx + f.fx * s, my + f.fy * s];
  const tr = new m.lap.LapTracker(course, { carType });
  tr.update(0, ...P(0.30), true);         // 基準点（prev）
  tr.update(0, ...P(0.30), true);         // 正側へ armDist(≤0.25) より離れて武装
  tr.update(sec, ...P(-0.01), true);      // 負側へ（ここで sec 秒経過）
  const lapped = tr.update(0, ...P(0.01), true);   // 負→正へ横切る＝計上
  return { tr, lapped };
}
const built = (m) => SPECS.map((s) => m.crs.buildFromSpec(s));
const carKeys = (m) => m.cfg.CAR_TYPES.map((c) => c.key);
const clone = (x) => JSON.parse(JSON.stringify(x));
const EDIT_WALL = { x1: 0.05, y1: 0.05, x2: 0.10, y2: 0.05 };   // コースの外の隅に 1 本（実ブラウザの再現と同じ）

// ── A) 後方互換（損失 0）──────────────────────────────────────────────────────────
function checkA(m) {
  const v = [];
  store.clear();
  let n = 0, shown = 0, withFinish = 0, n0 = 0, shown0 = 0;
  const cs = built(m).filter((c) => c.finish);
  withFinish = cs.length;
  for (const c of cs) for (const car of carKeys(m)) {
    // product に書かせた値を旧キーへ移す（新キーは消す＝旧形式の記録だけが残る状態を作る）。
    const { tr, lapped } = lapOnce(m, c, car, 20);
    if (!lapped) { v.push(`「${c.name}」×${car}: 治具が周回を計上できない（この組は空振り）`); continue; }
    const newKey = [...store.keys()].find((k) => k.startsWith('rumicar.practiceShape.'));
    const val = JSON.parse(store.get(newKey));
    val.ver = LEGACY_VER;
    store.delete(newKey);
    store.set(legacyKey(c.name, car), JSON.stringify(val));
    n++;
    const rec = m.lap.loadBestRec(c, car);
    const tr2 = new m.lap.LapTracker(c, { carType: car });
    if (rec && rec.t === val.t && rec.ver === LEGACY_VER && tr2.bestLap === val.t && tr2.bestRec && tr2.bestRec.ver === LEGACY_VER) shown++;
    else v.push(`「${c.name}」×${car}: 旧形式の記録が読めない（loadBestRec=${JSON.stringify(rec)}・reset.bestLap=${tr2.bestLap}）`);
    store.clear();
    void tr;
    // AP2 以前（W2）の記録＝裸の数値。版スタンプも cond も無い（HUD は注記なし・チャレンジは「スタンプ無し」と断る）。
    store.set(legacyKey(c.name, car), '17.25');
    n0++;
    const r0 = m.lap.loadBestRec(c, car);
    const t0 = new m.lap.LapTracker(c, { carType: car });
    if (r0 && r0.t === 17.25 && r0.ver === null && t0.bestLap === 17.25) shown0++;
    else v.push(`「${c.name}」×${car}: AP2 以前の記録（裸の数値）が読めない（${JSON.stringify(r0)}）`);
    store.clear();
  }
  console.log(`     出荷 ${SPECS.length} 本中フィニッシュを持つ ${withFinish} 本 × 車種 ${carKeys(m).length}: ` +
    `cond 付き ${n} 組 → 表示 ${shown}（損失 ${n - shown}）・AP2 以前 ${n0} 組 → 表示 ${shown0}（損失 ${n0 - shown0}）`);
  if (n < 300 || n0 < 300) v.push(`母集団が ${n}/${n0} 組しかない（出荷全コース × 全車種に届いていない＝空振り）`);
  return v;
}

// ── B) 本件: 形が違えば出ない／名前だけ違えば出る ─────────────────────────────────────
const SEPARATE = [
  ['壁を 1 本足す（本件）', (c) => { c.walls.push({ ...EDIT_WALL }); }],
  ['壁を 1 本消す', (c) => { c.walls.pop(); }],
  ['壁の端点を 1e-5 動かす（丸めの格子 1e-6 より大きい差）', (c) => { c.walls[0].x1 += 1e-5; }],
  ['枠(bounds)を変える', (c) => { c.bounds.w += 0.01; }],
  ['スタート位置を変える', (c) => { c.start.x += 0.01; }],
  ['フィニッシュを変える', (c) => { c.finish.x1 += 0.01; }],
  ['峠フラグを立てる', (c) => { c.touge = true; }],
  ['峠の勾配を足す', (c) => { c.downhill = 3; }],
  ['路面を変える（courseHashOf が含まない場＝AV1-e1）', (c) => { c.surface = 'loose'; }],
  ['グリップを変える', (c) => { c.grip = 0.5; }],
  ['バンクを足す', (c) => { c.bank = [[0, 0.1]]; }],
];
const SAME = [
  ['名前を変える', (c) => { c.name = c.name + '（改名）'; }],
  ['英語名を変える', (c) => { c.name_en = 'renamed'; }],
  ['説明を変える', (c) => { c.desc = '説明を直した'; c.desc_en = 'fixed desc'; }],
  ['難度・初心者・ベンチの印を変える', (c) => { c.diff = 5; c.beginner = true; c.bench = true; }],
  ['深いコピー', () => {}],
  ['鍵の並び順だけ変える', null],
];
function checkB(m) {
  const v = [];
  const base = m.crs.buildFromSpec(SPECS.find((s) => m.crs.buildFromSpec(s).finish && !m.crs.buildFromSpec(s).touge));
  const car = carKeys(m)[0];
  for (const legacy of [false, true]) {
    const tag = legacy ? '旧形式' : '新形式';
    for (const [what, mut] of SEPARATE) {
      store.clear();
      lapOnce(m, base, car, 20);
      if (legacy) {
        const k = [...store.keys()][0]; const val = store.get(k); store.delete(k); store.set(legacyKey(base.name, car), val);
      }
      const c = clone(base); mut(c);
      const rec = m.lap.loadBestRec(c, car);
      const tr = new m.lap.LapTracker(c, { carType: car });
      if (rec !== null || tr.bestLap !== null) v.push(`${tag}・${what}: 別の形なのに記録 ${JSON.stringify(rec && rec.t)}（reset.bestLap=${tr.bestLap}）が出る＝本件の取り違え`);
    }
  }
  for (const [what, mut] of SAME) {
    store.clear();
    lapOnce(m, base, car, 20);
    let c;
    if (mut) { c = clone(base); mut(c); } else { c = {}; for (const k of Object.keys(base).reverse()) c[k] = clone(base[k]); }
    const rec = m.lap.loadBestRec(c, car);
    if (!rec || rec.t !== 20) v.push(`新形式・${what}: 形は同じなのに記録が出ない（${JSON.stringify(rec)}）`);
  }
  console.log(`     分かれるべき差 ${SEPARATE.length} 通り × {新形式, 旧形式}・分かれてはならない差 ${SAME.length} 通り（基準「${base.name}」×${car}）`);
  return v;
}

// ── C) 同名の別コース ─────────────────────────────────────────────────────────────
function checkC(m) {
  const v = [];
  const car = carKeys(m)[0];
  const preset = m.crs.buildFromSpec(SPECS.find((s) => m.crs.buildFromSpec(s).finish && !m.crs.buildFromSpec(s).touge));
  const own = clone(preset); own.walls.push({ ...EDIT_WALL }); delete own.desc; delete own.name_en; delete own.desc_en; delete own.diff; delete own.beginner;
  store.clear();
  lapOnce(m, preset, car, 30);
  lapOnce(m, own, car, 10);                                   // 自作（同名）のほうが速い
  const rp = m.lap.loadBestRec(preset, car), ro = m.lap.loadBestRec(own, car);
  if (!rp || rp.t !== 30) v.push(`プリセットと同名の自作で走った後、プリセットの記録が ${JSON.stringify(rp && rp.t)}（30 のはず＝上書きされた）`);
  if (!ro || ro.t !== 10) v.push(`同名の自作の記録が ${JSON.stringify(ro && ro.t)}（10 のはず）`);
  // 名前が空のコース 2 本（BB-4 ⑤「空文字が『カスタム』に畳まれる」）
  const e1 = clone(own); e1.name = ''; const e2 = clone(preset); e2.name = '';
  store.clear();
  lapOnce(m, e1, car, 11);
  const r2 = m.lap.loadBestRec(e2, car);
  if (r2 !== null) v.push(`名前が空の別コースに記録 ${JSON.stringify(r2.t)} が出る`);
  const keys = [...store.keys()];
  if (keys.some((k) => k.startsWith('rumicar.practice.'))) v.push(`新しい記録が旧キーの名前空間に書かれた（${keys.join(', ')}）`);
  return v;
}

// ── D) 証明できない旧記録は出さず・消さない ──────────────────────────────────────────
function checkD(m) {
  const v = [];
  const car = carKeys(m)[0];
  const c = m.crs.buildFromSpec(SPECS.find((s) => m.crs.buildFromSpec(s).finish && !m.crs.buildFromSpec(s).touge));
  // 出荷コースの旧記録: 別レイアウトの証拠（courseHash 不一致）があれば出さない。証拠が無ければ（cond 無し・
  //   courseHash が文字列でない）出荷コースと同一であることだけで採る（改修前も表示していた記録）。どちらも消さない。
  const cases = [
    ['courseHash が今のコースと違う', JSON.stringify({ t: 12.5, ver: LEGACY_VER, cond: { courseHash: 'deadbeef' } }), false],
    ['cond の無い JSON（証拠なし）', JSON.stringify({ t: 12.5, ver: 'v3.0.0' }), true],
    ['courseHash が文字列でない（証拠なし）', JSON.stringify({ t: 12.5, ver: LEGACY_VER, cond: { courseHash: null } }), true],
  ];
  for (const [what, raw, shown] of cases) {
    store.clear();
    store.set(legacyKey(c.name, car), raw);
    const rec = m.lap.loadBestRec(c, car);
    if (!shown && rec !== null) v.push(`出荷コース・${what}: 別レイアウトの証拠があるのに記録 ${JSON.stringify(rec.t)} が出る`);
    if (shown && !(rec && rec.t === 12.5)) v.push(`出荷コース・${what}: 改修前も表示していた記録が出ない（${JSON.stringify(rec)}）`);
    lapOnce(m, c, car, shown ? 5 : 40);                      // 新しいベストを書く（採った記録より速く）
    if (store.get(legacyKey(c.name, car)) !== raw) v.push(`${what}: 旧キーが書き換わった／消えた（利用者の記録を失う）`);
    const now = m.lap.loadBestRec(c, car);
    if (!now || now.t !== (shown ? 5 : 40)) v.push(`${what}: 新しいベストが読めない（${JSON.stringify(now)}）`);
  }
  // 自作コースの旧記録: 出荷コースと中身が違えば、どの形式でも採らない（courseHash が一致しても＝壁とラインは同じでも）。
  //   路面だけ変えた同名の自作（courseHashOf が見ない場）と、出荷コースに無い名前の自作。
  for (const [what, mk, raw] of [
    ['同名・同じ壁で路面だけ違う自作（courseHash 一致）', (x) => { x.surface = 'loose'; }, null],
    ['出荷コースに無い名前の自作（中身は出荷コースと同じ・courseHash 一致）', (x) => { x.name = 'BE2 自作'; }, null],
    ['同名・路面だけ違う自作の裸の数値', (x) => { x.surface = 'loose'; }, '12.5'],
    ['出荷コースに無い名前の自作の cond 無し JSON', (x) => { x.name = 'BE2 自作'; }, JSON.stringify({ t: 12.5, ver: 'v3.0.0' })],
  ]) {
    store.clear();
    const own = clone(c); mk(own);
    let val0 = raw;
    if (raw == null) {
      lapOnce(m, own, car, 20);
      const k0 = [...store.keys()][0]; val0 = store.get(k0); store.delete(k0);
      if (JSON.parse(val0).cond.courseHash !== m.lap.courseHashOf(own)) v.push(`${what}: 治具の courseHash が一致していない（空振り）`);
    }
    store.set(legacyKey(own.name, car), val0);
    const r0 = m.lap.loadBestRec(own, car);
    if (r0 !== null) v.push(`${what}: 形を証明できない旧記録 ${JSON.stringify(r0.t)} が出る`);
    if (store.get(legacyKey(own.name, car)) !== val0) v.push(`${what}: 旧キーが変わった`);
  }
  // 名前（文字列）を渡す旧呼び出しは、旧キーに記録があっても null（取り違えない側に落ちる）
  store.clear(); store.set(legacyKey(c.name, car), '12.5');
  if (m.lap.loadBestRec(c.name, car) !== null) v.push('名前（文字列）を渡した旧呼び出しに記録が返る');
  // 証明できる旧記録より遅いラップでは新キーを作らず、速いラップでは新キーへ書く（旧キーは byte 不変のまま）
  store.clear();
  lapOnce(m, c, car, 20);
  const k0 = [...store.keys()][0], val = store.get(k0); store.delete(k0); store.set(legacyKey(c.name, car), val);
  lapOnce(m, c, car, 25);
  if ([...store.keys()].some((k) => k.startsWith('rumicar.practiceShape.'))) v.push('旧記録（20s）より遅い 25s で新しい記録が作られた（ベストが遅くなる）');
  lapOnce(m, c, car, 15);
  const r = m.lap.loadBestRec(c, car);
  if (!r || r.t !== 15) v.push(`旧記録（20s）より速い 15s が新しいベストにならない（${JSON.stringify(r)}）`);
  if (store.get(legacyKey(c.name, car)) !== val) v.push('新しいベストを書いたら旧キーが変わった');
  return v;
}

// ── E) バックアップの往復 ───────────────────────────────────────────────────────────
function checkE(m) {
  const v = [];
  store.clear();
  const cs = built(m).filter((c) => c.finish).slice(0, 5);
  cs.forEach((c, i) => lapOnce(m, c, carKeys(m)[i % carKeys(m).length], 10 + i));
  const before = new Map(store);
  const file = JSON.stringify(m.bk.makeBackupEnvelope(localStorage, 'test'));
  store.clear();
  const res = m.bk.applyImport(localStorage, m.bk.parseBackup(JSON.parse(file)), { overwrite: false });
  const shapeKeys = [...before.keys()].filter((k) => k.startsWith('rumicar.practiceShape.'));
  if (shapeKeys.length !== cs.length) v.push(`治具: 新形式の記録が ${shapeKeys.length} 件（${cs.length} 件のはず）`);
  for (const k of shapeKeys) if (store.get(k) !== before.get(k)) v.push(`${k}: 復元後の値が byte 同値でない`);
  if (res.applied.length !== before.size) v.push(`復元件数 ${res.applied.length} ≠ 書き出し ${before.size}`);
  cs.forEach((c, i) => { const r = m.lap.loadBestRec(c, carKeys(m)[i % carKeys(m).length]); if (!r || r.t !== 10 + i) v.push(`「${c.name}」: 復元後に記録が読めない`); });
  return v;
}

// ── F) 指紋の安定性・消費側 ─────────────────────────────────────────────────────────
function checkF(m) {
  const v = [];
  const cs = built(m);
  const again = built(m);
  let n = 0;
  cs.forEach((c, i) => {
    const id = m.lap.practiceCourseId(c);
    if (id !== m.lap.practiceCourseId(again[i])) v.push(`「${c.name}」: 作り直すと指紋が変わる`);
    if (id !== m.lap.practiceCourseId(clone(c))) v.push(`「${c.name}」: JSON 往復（＝再読込）で指紋が変わる`);
    n++;
  });
  // 別系統のブラウザで `Math.sin/cos` の最下位ビットが違う場合の代理: 全数値を ±1・±8 ulp ずらしても指紋が変わらない。
  const f64 = new Float64Array(1), i64 = new BigInt64Array(f64.buffer);
  const bump = (x, d) => { if (!Number.isFinite(x) || x === 0) return x; f64[0] = x; i64[0] += BigInt(d); return f64[0]; };
  const perturb = (x, d) => Array.isArray(x) ? x.map((e) => perturb(e, d)) : (x && typeof x === 'object')
    ? Object.fromEntries(Object.entries(x).map(([k, e]) => [k, perturb(e, d)])) : (typeof x === 'number' ? bump(x, d) : x);
  let ulpFlip = 0;
  for (const c of cs) for (const d of [1, -1, 8, -8]) if (m.lap.practiceCourseId(perturb(c, d)) !== m.lap.practiceCourseId(c)) {
    ulpFlip++; v.push(`「${c.name}」: 全数値を ${d} ulp ずらすと指紋が変わる（別系統のブラウザへ移すと記録が見えなくなりうる）`);
  }
  const ids = new Set(cs.map((c) => m.lap.practiceCourseId(c)));
  if (ids.size !== cs.length) v.push(`出荷コースの指紋が衝突（${cs.length} 本で ${ids.size} 種）`);
  // 走らせた後も同じ（エンジンがコースに実行時の値を書き足していない）
  const c = cs.find((x) => x.finish && !x.touge);
  const before = m.lap.practiceCourseId(c);
  const p = m.prog.PROGRAM_BY_KEY['normal_fr'];
  m.eng.runRace({ course: c, regime: 'tabletop', laps: 1, field: [{ lang: p.lang, src: p.code, carType: p.carType }], maxSec: 20 });
  if (m.lap.practiceCourseId(c) !== before) v.push(`「${c.name}」: runRace で走らせた後に指紋が変わった（実行時の書き込みで鍵がずれる）`);
  // チャレンジも形で数える: 同名で壁だけ違う版では完走にならない
  store.clear();
  const car = carKeys(m)[0];
  lapOnce(m, c, car, 20);
  const edited = clone(c); edited.walls.push({ ...EDIT_WALL });
  const st1 = m.ch.challengeState([c], [car], m.lap.loadBestRec);
  const st2 = m.ch.challengeState([edited], [car], m.lap.loadBestRec);
  if (!(st1.rows[0] && st1.rows[0].done)) v.push('チャレンジ: 走ったコースが完走にならない');
  if (st2.rows[0] && st2.rows[0].done) v.push('チャレンジ: 同名で壁だけ違うコースが完走扱い（名前で数えている）');
  // AP2 以前の記録（裸の数値）は出荷コースで完走に数え、「版スタンプ無し」と断る（`challenge.js` の stale が生きている）
  store.clear();
  store.set(legacyKey(c.name, car), '17.25');
  const st3 = m.ch.challengeState([c], [car], m.lap.loadBestRec);
  if (!(st3.rows[0] && st3.rows[0].done && st3.rows[0].stale === true))
    v.push(`チャレンジ: AP2 以前の記録で完走・スタンプ無しにならない（${JSON.stringify(st3.rows[0])}）`);
  // public/js に名前で引く呼び出しが残っていない（loadBestRec/loadBest の第 1 引数に `.name` を渡さない）
  for (const f of fs.readdirSync(JS_ROOT, { recursive: true }).filter((x) => String(x).endsWith('.js'))) {
    const src = fs.readFileSync(path.join(JS_ROOT, String(f)), 'utf8');
    for (const mm of src.matchAll(/\bloadBest(?:Rec)?\(\s*([^,)]*)/g)) {
      if (/\.name\b|Name\b/.test(mm[1])) v.push(`${f}: ${mm[0]}（名前で引いている）`);
    }
  }
  // product の配線（fleet.rebuildSpawns が台数ぶんの reset で指紋の memo を共有する）: 別のコースで続けて呼ぶと、
  //   全車の鍵が後のコースのものに切り替わる（memo を呼び出しを跨いで共有する誤りを捕まえる・層 4 の 3 回目の指摘）。
  //   makeSlot の既定（persist 省略）は練習記録を読む側・persist:false は読まない側であることも測る。
  {
    const A = cs.find((x) => x.finish && !x.touge), B = cs.find((x) => x.finish && !x.touge && x !== A);
    const p = m.prog.PROGRAM_BY_KEY['normal_fr'];
    const slots = [0, 1, 2].map((i) => m.fleet.makeSlot({ i, lang: p.lang, src: p.code, course: A, slotCount: 3, logFor: () => () => {} }));
    m.fleet.rebuildSpawns(slots, A);
    m.fleet.rebuildSpawns(slots, B);
    const idB = m.lap.practiceCourseId(B);
    const bad = slots.filter((s) => s.lap._courseId !== idB || !s.lap.persist).length;
    if (bad) v.push(`rebuildSpawns(A)→rebuildSpawns(B) の後、${bad}/3 台の練習記録の鍵が B のものでない（memo が呼び出しを跨いで残っている）`);
    const off = m.fleet.makeSlot({ i: 0, lang: p.lang, src: p.code, course: A, slotCount: 1, logFor: () => () => {}, persist: false });
    m.fleet.rebuildSpawns([off], B, null, { persist: false });
    if (off.lap.persist !== false || off.lap._courseId !== null) v.push('persist:false の車が練習記録の鍵を持っている（公式レースが練習記録を読む）');
    m.fleet.rebuildSpawns([off], B, undefined, null);      // lapOpts=null でも落ちず、既定（読む側）になる
    if (off.lap.persist !== true || off.lap._courseId !== idB) v.push('rebuildSpawns の lapOpts=null で既定（練習記録を読む）にならない');
  }
  // 出荷コースの組み直し（loadPresets をもう一度）の後も、出荷コースの旧記録の採否が変わらない（shippedIdOf の覚え書きが古くならない）
  store.clear();
  store.set(legacyKey(c.name, car), '17.25');
  const before2 = m.lap.loadBestRec(c, car);
  return m.crs.loadPresets().then(() => {
    const after2 = m.lap.loadBestRec(m.crs.presetByName(c.name), car);
    if (!(before2 && before2.t === 17.25 && after2 && after2.t === 17.25)) v.push(`出荷コースの組み直しの前後で旧記録の採否が変わる（${JSON.stringify(before2)} → ${JSON.stringify(after2)}）`);
    console.log(`     指紋: 出荷 ${n} 本で作り直し・JSON 往復とも一致・相異なり ${ids.size} 種・±1/±8 ulp で変わった ${ulpFlip}/${cs.length * 4}`);
    return v;
  });
}

// ── P) 出荷全コースの凍結表（2026-09-24・v8.7.0 の courses.json・BE2 で刻んだ）: [practiceCourseId, courseHashOf] ──
// ① practiceCourseId: 新しい鍵。刻み直すのは「そのコースの練習記録を別の記録として始め直す」決定。刻み直した版の
//    CHANGELOG に対象コースを書くこと。
// ② courseHashOf: 旧記録の採否 (a) が比べる値（AP2 以降の旧記録が保存時点で持つ値）。**これは刻み直してはならない**:
//    変わると出荷コースの AP2 以降の旧記録がすべて「別レイアウトの証拠あり」で見えなくなる（層 4 の 2 回目の実測:
//    courseHashOf に surface を足すと 64/64 本で消えた）。AV1-e1（courseHashOf が路面を含まない穴）を塞ぐなら、
//    courseHashOf 自体は変えずに別の関数を足すこと。
const PINNED = {
  "オーバル": ["7d9e3b8e437d775a", "3c2a60a9"],
  "スピードウェイ": ["960a341c57749ec0", "80be788b"],
  "ヘアピン": ["089d88a3f809d2c7", "7e937306"],
  "90度サーキット": ["18825dbb8a7d1b4f", "00dfb439"],
  "S字シケイン": ["653fd5e3c632bc07", "2c5ab0d5"],
  "複合コーナー": ["7ada8899d74f245d", "a19fd356"],
  "ナローゲート": ["312877cf037a5edb", "e4d0902e"],
  "ボトルネック": ["4d81376e4bce13ba", "88ca86df"],
  "丸の中の四角": ["a72790f11511390d", "6cd8c9eb"],
  "四角の中の丸": ["766990ccc31e08b8", "9f2d038e"],
  "六角と三角": ["7d3a16bd11f6ff09", "699ca76b"],
  "うねりと円": ["30af78d17704e97d", "01f1ee78"],
  "テクニカル周回 (簡易)": ["545f3816caf56102", "bf966005"],
  "タイト市街地 (簡易)": ["547479c3d16c4c37", "7b84f1a4"],
  "ロングオーバル": ["3ff81bd4b8df3c48", "c2e20cf3"],
  "オクタゴン": ["048b59eb8d44b2ef", "e8689b47"],
  "トライアングル": ["32ed51527d1e4b3e", "bafad9f9"],
  "ハイスピード・レイアウト": ["e8762d345f6ccd40", "5135f37f"],
  "エッセ・レイアウト": ["c9263441c1d4669d", "e3b0e26a"],
  "ストリート・レイアウト": ["117f91a9682fe225", "31766db4"],
  "フローイング・レイアウト": ["5b6b7a2fdd80ca6b", "9281bf62"],
  "ロングラン・レイアウト": ["c913aacd5b7da4c9", "53f6e5f3"],
  "ロングストレート・レイアウト": ["afedd14d8167bf81", "04175b4f"],
  "コンパクト・レイアウト": ["f04bdd8fcc6f340b", "62769c9b"],
  "ツイスティ・レイアウト": ["34396514b9a93938", "bc4c9f9a"],
  "ショート・レイアウト": ["153581be4de3242a", "0e8dbb52"],
  "モダン・レイアウト": ["76db4b8f029616eb", "c536644b"],
  "ストップ＆ゴー・レイアウト": ["67a965727d9d4bee", "705b8682"],
  "ナローシケイン・レイアウト": ["895227811c0879c5", "ddca5cbe"],
  "バンク・レイアウト": ["0cd5a7a2043f85e6", "0cf40849"],
  "峠① 中速ヘアピン (緩い下り)": ["9d024acb54fc34d7", "2069afdc"],
  "峠② タイトヘアピン (急な下り)": ["8e68dcd44e7809e8", "7adba08b"],
  "峠③ 高速ヘアピン (大R下り)": ["6791b8e1ae0bd62d", "005e82d8"],
  "ウェットテクニカル (雨)": ["e41b8d176bc78513", "0a155caa"],
  "ウェットS字 (雨)": ["3d30e30aa624c99e", "1473b0af"],
  "架空峠 ロング・ワインディング(緩斜面)": ["75e1da6fe99cb923", "e95f49c6"],
  "架空峠 ロング・ワインディング(中斜面)": ["8917a8a56e477771", "988ae096"],
  "架空峠 ロング・ワインディング(激坂)": ["a39c2ce345227787", "b3efcabc"],
  "ドリフト広場 (ショー会場)": ["e5e5264c67adcba0", "50420395"],
  "競技グラウンド (フルスケール)": ["be9cc13729852a43", "34bad284"],
  "競技サーキット (フルスケール)": ["3b610d331449d9c7", "8799ba0f"],
  "峠① 中速ヘアピン (緩い下り)〔道幅 4.5 台分〕": ["73c4df00edf3f484", "26c29b36"],
  "峠① 中速ヘアピン (緩い下り)〔道幅 3 台分〕": ["f50f6a1b8be3fb7f", "6c539875"],
  "峠① 中速ヘアピン (緩い下り)〔道幅 2 台分〕": ["fbd18bfc892c7fc8", "2cc7206f"],
  "峠② タイトヘアピン (急な下り)〔道幅 4.5 台分〕": ["6b9f7edb7907b29f", "19be0aa8"],
  "峠② タイトヘアピン (急な下り)〔道幅 3 台分〕": ["3058b1e84357fb94", "b6515a7e"],
  "峠② タイトヘアピン (急な下り)〔道幅 2 台分〕": ["e2672ec0f8e03b2c", "7de7820f"],
  "峠③ 高速ヘアピン (大R下り)〔道幅 4.5 台分〕": ["e36de3ebee14ebd7", "b43b6903"],
  "峠③ 高速ヘアピン (大R下り)〔道幅 3 台分〕": ["a502bffa1f818b0e", "e4f0d3a1"],
  "峠③ 高速ヘアピン (大R下り)〔道幅 2 台分〕": ["1fac04e5d402cb11", "1f6354fd"],
  "架空峠 ロング・ワインディング(緩斜面)〔道幅 4.5 台分〕": ["3dfc9eac1d29faa8", "72753b59"],
  "架空峠 ロング・ワインディング(緩斜面)〔道幅 3 台分〕": ["be2a5acf2e099d03", "e9ac258e"],
  "架空峠 ロング・ワインディング(緩斜面)〔道幅 2 台分〕": ["9a793f40f4bd1d44", "8585079a"],
  "架空峠 ロング・ワインディング(中斜面)〔道幅 4.5 台分〕": ["553c9ad5166588f9", "8027ae8c"],
  "架空峠 ロング・ワインディング(中斜面)〔道幅 3 台分〕": ["da96502afbcc6106", "257a5b23"],
  "架空峠 ロング・ワインディング(中斜面)〔道幅 2 台分〕": ["ffd383fa1e80e4b6", "3a00fca2"],
  "架空峠 ロング・ワインディング(激坂)〔道幅 4.5 台分〕": ["e766a7901ff85094", "4dbd7c23"],
  "架空峠 ロング・ワインディング(激坂)〔道幅 3 台分〕": ["b8a188cb5585c267", "658997af"],
  "架空峠 ロング・ワインディング(激坂)〔道幅 2 台分〕": ["994cc449509895cd", "8cb1c871"],
  "舵角限界ベンチ R_out/R_min=1.02〔道幅 2 台分〕": ["08b00065212c4981", "855f14a5"],
  "舵角限界ベンチ R_out/R_min=0.95〔道幅 2 台分〕": ["9525d2bc739e6338", "48ae7c37"],
  "舵角限界ベンチ R_out/R_min=0.856〔道幅 2 台分〕": ["9d0ea7837cb280a7", "43c63508"],
  "舵角限界ベンチ R_out/R_min=0.8〔道幅 2 台分〕": ["8cd1b1bf631a5bcb", "49b84f7d"],
  "舵角限界ベンチ R_out/R_min=1.02〔道幅 3.5 台分〕": ["3a77837ce6d19618", "04018391"],
  "舵角限界ベンチ R_out/R_min=0.95〔道幅 3.5 台分〕": ["a880e5b00a42ed94", "e7b70b5a"],
  "舵角限界ベンチ R_out/R_min=0.856〔道幅 3.5 台分〕": ["b310d045285a1d89", "6b8486cc"],
};
function checkP(m) {
  const v = [];
  const cs = built(m);
  for (const c of cs) {
    if (!(c.name in PINNED)) { v.push(`「${c.name}」が凍結表に無い（出荷コースが増えた＝表へ足すこと）`); continue; }
    const id = m.lap.practiceCourseId(c), h = m.lap.courseHashOf(c);
    if (id !== PINNED[c.name][0]) v.push(`「${c.name}」: 指紋 ${id} ≠ 凍結 ${PINNED[c.name][0]}（このコースの新形式の記録が見えなくなる）`);
    if (h !== PINNED[c.name][1]) v.push(`「${c.name}」: courseHashOf ${h} ≠ 凍結 ${PINNED[c.name][1]}（このコースの AP2 以降の旧記録が見えなくなる）`);
  }
  for (const name of Object.keys(PINNED)) if (!cs.some((c) => c.name === name)) v.push(`凍結表の「${name}」が出荷コースに無い`);
  console.log(`     凍結表 ${Object.keys(PINNED).length} 本 ↔ 出荷 ${cs.length} 本`);
  if (cs.length < 60) v.push(`母集団が ${cs.length} 本しかない（空振り）`);
  return v;
}

const real = await loadTree(JS_ROOT);
console.log('\n  P) 出荷全コースの指紋の凍結表');
report('P) 凍結値からのずれ', checkP(real));
console.log('\n  A) 後方互換（v8.7.0 形式の記録・出荷全コース × 全車種）');
report('A) 読めなくなった旧記録', checkA(real));
console.log('\n  B) 形が違えば出ない／名前・説明だけの違いでは出る');
report('B) 取り違え・取りこぼし', checkB(real));
console.log('\n  C) 同名の別コース（プリセットと同名の自作・名前が空）');
report('C) 同名の取り違え・上書き', checkC(real));
console.log('\n  D) 証明できない旧記録は出さず・消さない');
report('D) 旧記録の扱いの違反', checkD(real));
console.log('\n  E) データのバックアップ/復元で往復');
report('E) 往復の不一致', checkE(real));
console.log('\n  F) 指紋の安定性・チャレンジ・名前で引く呼び出しの残存');
report('F) 安定性・消費側の違反', await checkF(real));

// ── G) 検出力（変異）─────────────────────────────────────────────────────────────
console.log('\n  G) 変異試験（一時ツリーの lap.js / course_digest.js / fleet.js を壊して A)〜F)・P) が赤くなるか）');
const MUTATIONS = [
  ['形の指紋の代わりに名前を鍵にする（改修前の鍵）', 'B',
    (s) => s.replace('  return courseShapeDigest(shape, 1e6);', '  return String(course && course.name);')],
  ['旧記録を形の証明なしに採る（(a)(b) とも外す）', 'D',
    (s) => s.replace("  if (!old || shippedIdOf(course.name) !== m.id) return null;", "  if (!old) return null;")
            .replace("    if (h !== m.hash) return null;", '')],
  ['別レイアウトの証拠 (a) を無視する', 'D',
    (s) => s.replace("    if (h !== m.hash) return null;", '')],
  ['証拠の無い旧記録を捨てる（(a) を必須にする＝BE2 初版）', 'A',
    (s) => s.replace("    if (h !== m.hash) return null;\n  }", "    if (h !== m.hash) return null;\n  } else return null;")],
  ['練習記録の指紋を丸めない（別系統のブラウザで記録が見えなくなる）', 'F',
    (s) => s.replace('  return courseShapeDigest(shape, 1e6);', '  return courseShapeDigest(shape);')],
  ['courseHashOf に路面を足す（AV1-e1 を courseHashOf で塞ぐ＝出荷コースの旧記録が全部消える）', 'P',
    (s) => s.replace('return fnv1a(JSON.stringify({ w: walls, f: fin, s: st, touge: !!course.touge }));', "return fnv1a(JSON.stringify({ w: walls, f: fin, s: st, touge: !!course.touge, sf: course.surface || 'paved' }));")],
  ['名前・説明を形から抜かない', 'B',
    (s) => s.replace('if (!RECORD_LABEL_KEYS.has(k)) shape[k] = course[k];', 'shape[k] = course[k];')],
  ['保存を旧キー（名前）へ書く', 'C',
    (s) => s.replace("safeSetItem(bestKeyById(this._courseId, this.carType),", "safeSetItem(legacyBestKey(this.course.name, this.carType),")],
  ['旧記録の採否から「同名の出荷コースと同一」を外す（courseHash だけで採る）', 'B',
    (s) => s.replace("  if (!old || shippedIdOf(course.name) !== m.id) return null;", "  if (!old) return null;")],
  ['digest の初期値を 1 変える（全利用者の新形式の記録が見えなくなる）', 'P',
    (s) => s.replace('let h1 = 0x811c9dc5 >>> 0, h2 = 0x2545f491 >>> 0;', 'let h1 = 0x811c9dc6 >>> 0, h2 = 0x2545f491 >>> 0;'), 'course_digest.js'],
  ['rebuildSpawns の memo を呼び出しを跨いで共有する', 'F',
    (s) => s.replace('  const memo = {};   // BE2:', '  const memo = _lapMemo;   // BE2:').replace('export function rebuildSpawns(', 'const _lapMemo = {};\nexport function rebuildSpawns('), 'fleet.js'],
  ['旧記録を読まない（後方互換を捨てる）', 'A',
    (s) => s.replace('  const old = parseRec(legacyBestKey(course.name, carType));', '  const old = null;')],
];
const RAWS = Object.fromEntries(['lap.js', 'course_digest.js', 'fleet.js'].map((f) => [f, fs.readFileSync(path.join(JS_ROOT, f), 'utf8')]));
const CH = { A: checkA, B: checkB, C: checkC, D: checkD, E: checkE, F: checkF, P: checkP };
const miss = [], noop = [];
for (const [name, chapter, fn, file = 'lap.js'] of MUTATIONS) {
  const RAW = RAWS[file];
  const mutated = fn(RAW);
  if (mutated === RAW) { noop.push(`${name}（変異が適用されていない＝パターンが実装とズレた）`); continue; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf_be2_mut_'));
  _tmpDirs.push(tmp);
  fs.cpSync(JS_ROOT, tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, file), mutated);
  const m = await loadTree(tmp);
  const log = console.log; console.log = () => {};
  let caught;
  try { caught = (await CH[chapter](m)).length; } finally { console.log = log; }
  if (caught === 0) miss.push(`${name} → ${chapter}) が見逃した`);
  else console.log(`     ✓ ${name} → ${chapter}) が ${caught} 件で赤`);
}
console.log(`  変異 ${MUTATIONS.length} 件を注入（product のファイルは無改変）`);
report('G) 見逃した変異', miss);
report('G) 適用できなかった変異（パターン腐り）', noop);
{
  const changed = Object.keys(RAWS).filter((f) => fs.readFileSync(path.join(JS_ROOT, f), 'utf8') !== RAWS[f]);
  if (changed.length) { pass = false; console.log(`  ✗ ゲートの実行で ${changed.join(', ')} が変化した`); }
  else console.log(`  ✓ public/js/{${Object.keys(RAWS).join(', ')}} は実行前後で無変化`);
}
for (const d of _tmpDirs) fs.rmSync(d, { recursive: true, force: true });

console.log('\n' + '='.repeat(78));
console.log(pass ? 'BE2 練習ベストの鍵（コースの形）・ゲート: 全パス ○' : 'BE2 練習ベストの鍵（コースの形）・ゲート: ✗ 不合格');
console.log('='.repeat(78));
process.exit(pass ? 0 : 1);
