// wf_bd1_capkey.mjs — BD1: 実走容量 `driveableCapN` の覚え書きが「同じコース」を形状で判定すること。
// ════════════════════════════════════════════════════════════════════════════
// 何を守るゲートか:
//   旧実装の鍵は `course.name|regime|carLen|maxN|PHYSICS.mode` で、**名前は識別子であって形状ではない**。
//   ∴ 保存コースの壁だけを編集して同じ名前で ✔適用すると古い実走判定が返った（BC-12 ③(a)）。
//   実ブラウザでの再現と是正は `browser/check_bd1_capkey.mjs`（本番 UI のみで ▶→編集→✔適用→▶ を通す）。
//   本ゲートは同じ性質を **product のオラクルを直接呼んで**卓上で固定し、変異で赤くなることまで測る。
//
// 章立て:
//   A) 振る舞い: 同名・同領域・同スケール・同 maxN で**壁だけ違う** 2 版に対し、`driveableCapN` が
//      それぞれの真値（`stuckAtN`＝キャッシュを通らない実走述語）と一致する。順序の両方向で測る。
//   B) 同じ内容なら同じ digest: 深いコピー・鍵の並べ替えでも一致する（＝形が変わっていない ✔適用では
//      キャッシュが効き続ける＝ヒット率を落とさない）。**参照の同一性には依存しない**ことの確認でもある。
//   C) 取りこぼしゼロ: 出荷コース全本の digest が相異なる。壁・枠・スタート・フィニッシュ・峠の勾配の
//      どれを動かしても digest が変わる。1e-12 の差でも変わる（量子化していない）。
//   D-1) carScale の掃引（product の判定コア・reason='carScale'）では 1 件も増えない。**空の覚え書きで測る。**
//   D-2) 上限を超えて投入しても項目数が上限で止まり、追い出しを跨いでも答えが変わらない。
//   D-0) その前提: 複製したツリーが「誰とも共有していない 1 セット」であること（fitguard 経由の呼び出しが
//        ゲートの見る覚え書きに載ること）。ここが崩れると D-1 は必ず緑になる。
//   E) 検出力: 一時ツリーへ複製して鍵や約束を壊す変異を入れ、A)/C)/D) が実際に赤くなることを測る。
//
// 【測らないこと（沈黙截断の禁止）】① 追い出しの順序が LRU か FIFO かは**測っていない**。観測できるのは
//   項目数と答えだけで、順序を区別するには壁時計（ヒットとミスの所要差）に頼ることになるため。
//   ② D-2 の「答えが変わらない」が捕まえられるのは「追い出したはずの鍵にヒットして古い答えを返す」型だけ。
//   追い出し後の再計算は `driveableCapN` も比較対象の `stuckAtN` も同じ述語なので、そこは原理的に一致する。
//   ③ digest の所要時間（`capacity.js` の注記にある 0.92 ms/回）は測っていない。測るのは相異性と識別力。
//
// 【初版の重大な誤り（層 4 レビュー 2026-09-20・記録として残す）】D-1 を D-2 の**後ろ**で測っていた。
//   飽和後は項目数が上限に釘付けになるので増分は恒等的に 0 ＝ **原理的に失敗しえない検査**だった
//   （`fitguard.js` ⑥ の `ctx.reason !== 'carScale'` を外す変異でも緑のままだと実証された）。
//   順序を入れ替え、その変異を E) に常設した。同じ型（飽和・クランプの後ろで増分を測る）を疑うこと。
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'node:url';

const JS_ROOT = './public/js';
const SPECS = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
let pass = true;
const report = (label, violations) => {
  if (violations.length) { pass = false; console.log(`  ✗ ${label}: ${violations.length} 件`); for (const v of violations) console.log(`      - ${v}`); }
  else console.log(`  ✓ ${label}: 0 件`);
};

// **ESM は解決済み URL でモジュールを覚える**ので、同じパスを import し直しても同じ名前空間＝同じ
// `_cache` が返る（実測 2026-09-20: `import(x) === import(x)` が true・覚え書きも共有される）。
// 「空の覚え書きから始める」検査はそれでは成立しない。
// **クエリ（`?v=1`）で URL をずらす手は使えない**: `fitguard.js` の `import { driveableCapN } from './capacity.js';`
// のような**相対 import にはクエリが伝播しない**ので、ゲートが掴む `capacity.js?v=1` と `fitguard.js` が
// 実際に呼ぶ `capacity.js` が別インスタンスになり、`CAP_CACHE.size` が「誰も使っていない覚え書き」を
// 指してしまう（初版でこれをやって D-1 が再び空振りした）。∴ **ツリーごと別ディレクトリへ複製する**。
// こうすれば相対 import も複製先の中で閉じ、モジュールグラフ全体が 1 セットとして新しくなる。
// 複製は本ホスト実測 12 ms/回（public/js = 1.9 MB）。
const _tmpDirs = [];
function freshDir(src) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wf_bd1_tree_'));
  fs.cpSync(src, d, { recursive: true });
  _tmpDirs.push(d);
  return d;
}
async function loadTree(dir, fresh = false) {
  const root = fresh ? freshDir(dir) : dir;
  const url = (f) => pathToFileURL(path.resolve(root, f)).href;
  const [cap, cfg, crs, guard, eng, prog] = await Promise.all([
    import(url('capacity.js')), import(url('config.js')), import(url('course.js')),
    import(url('fitguard.js')), import(url('race_engine.js')), import(url('programs.js'))]);
  return { cap, cfg, crs, guard, rr: { runRace: eng.runRace, PROGRAM_BY_KEY: prog.PROGRAM_BY_KEY } };
}
// 複製先が本当に「誰とも共有していない 1 セット」であることを測る（この前提が崩れると D-1 が空振りする）。
async function assertIsolated(dir) {
  const v = [];
  const m = await loadTree(dir, true);
  if (m.cap.CAP_CACHE.size !== 0) v.push(`複製したツリーの覚え書きが空でない（${m.cap.CAP_CACHE.size} 件）`);
  const course = fixture(m.crs);
  setScale(m.cfg);
  m.cap.driveableCapN(course, 'tabletop', 1);                 // ゲートが掴んだ capacity に 1 件積む
  const viaGate = m.cap.CAP_CACHE.size;
  const fx = { regime: () => {}, scale: (uk) => m.cfg.setCarScale(uk), sync: () => {}, log: () => {} };
  setScale(m.cfg);
  m.guard.settleFitRatio(course, { regime: 'tabletop', userK: USER_K, slotCount: 1, reason: 'race' }, fx);
  const viaGuard = m.cap.CAP_CACHE.size;                       // fitguard 経由でも同じ覚え書きが見えるか
  if (viaGate !== 1) v.push(`複製ツリーで driveableCapN を 1 回呼んだのに項目数が ${viaGate}`);
  if (viaGuard !== viaGate) v.push(`fitguard 経由の呼び出しがゲートの見る覚え書きに載らない（${viaGate} → ${viaGuard}）＝別インスタンス`);
  console.log(`     隔離の確認: 複製直後 0 件 → 直接呼び 1 件 → fitguard 経由も同じ覚え書き（${viaGuard} 件）`);
  return v;
}

// ── 治具（卓上・車長 0.1140 m ＝ スライダー 0.6。実測 2026-09-20）──────────────────────
//   編集前: 実走の最大変位 0.84021 m = 7.370 × 車長 → 走り出せる
//   編集後（(0.75,0.90)-(0.75,1.10) の壁を 1 本追加）: 0.08996 m = 0.789 × 車長 → 走り出せない
//   静的収容はどちらも capacityOf=6（＝静的ゼロではない）。両側とも閾値から 20% 以上離れている。
const NAME = 'BD1 壁編集テスト', X0 = 0.30, X1 = 1.50, YA = 0.90, YB = 1.10, EX = 0.75, USER_K = 0.6;
const BASE_WALLS = [
  { x1: X0, y1: YA, x2: X1, y2: YA }, { x1: X1, y1: YA, x2: X1, y2: YB },
  { x1: X1, y1: YB, x2: X0, y2: YB }, { x1: X0, y1: YB, x2: X0, y2: YA },
];
const fixture = (crs, extra = []) => crs.normalizeCourse({
  name: NAME, bounds: { w: 3.0, h: 2.0 }, start: { x: 0.45, y: 1.00, theta: 0 },
  finish: { x1: 0.35, y1: YA, x2: 0.35, y2: YB, fx: 1, fy: 0 }, walls: [...BASE_WALLS, ...extra],
});
const EDIT_WALL = { x1: EX, y1: YA, x2: EX, y2: YB };
// 端を EX まで縮めた廊下。**壁の本数は編集前と同じ 4 本で座標だけが違う**（実測 stuckAtN(1)=1）。
// 本数だけを見る digest（＝配列の中身を歩かない実装）を A) が捕まえられるようにするための 2 組目。
const shortened = (crs) => crs.normalizeCourse({
  name: NAME, bounds: { w: 3.0, h: 2.0 }, start: { x: 0.45, y: 1.00, theta: 0 },
  finish: { x1: 0.35, y1: YA, x2: 0.35, y2: YB, fx: 1, fy: 0 },
  walls: [{ x1: X0, y1: YA, x2: EX, y2: YA }, { x1: EX, y1: YA, x2: EX, y2: YB },
          { x1: EX, y1: YB, x2: X0, y2: YB }, { x1: X0, y1: YB, x2: X0, y2: YA }],
});
// A) が通す 2 組。どちらも「同名・同領域・同スケール・同 maxN」で**壁だけが違う**。
const PAIRS = [
  { tag: '壁を 1 本足す（本数 4→5）', mk: (crs) => [fixture(crs), fixture(crs, [EDIT_WALL])] },
  { tag: '端を縮める（本数は 4 のまま・座標だけ違う）', mk: (crs) => [fixture(crs), shortened(crs)] },
];
const setScale = (cfg, k = USER_K) => { cfg.setRegimeScale(1); cfg.setCarScale(k); };
// 連続量マージン: 1 台走らせたときの「spawn からの最大変位 ÷ 判定閾値（車長）」。1 を跨ぐ所が stuckAtN の境界。
// product の `stuckAtN` と**同じ runRace 呼び出し**（`capacity.js` の引数と 1 対 1）で測る＝述語を再実装しない。
function margin(m, course) {
  const p = m.rr.PROGRAM_BY_KEY['normal_fr'];   // **同じツリーの** race_engine/config を使う（別ツリーだと CAR 寸法が噛み合わない）
  const r = m.rr.runRace({ course, regime: 'tabletop', laps: 2, field: [{ lang: p.lang, src: p.code, carType: p.carType }],
    crashRule: { rejoin: true, penaltySec: 3 }, interact: true, maxSec: 14, trackNet: true, fitGuard: false });
  return r.netMax[0] / m.cfg.CAR.length;
}

// ── A) 壁だけ違う 2 版を、順序の両方向で ────────────────────────────────────────────
async function checkA(dir, label, rec = new Map()) {
  const v = [];
  for (const { tag, mk } of PAIRS) {
    for (const rev of [false, true]) {          // 順序の両方向（片方向だけだと非対称な穴を見落とす）
      const m = await loadTree(dir, true);      // 反復ごとに**本当に**素のモジュール（空の覚え書き）から始める
      setScale(m.cfg);
      const [a, b] = mk(m.crs);
      const seq = rev ? [['編集後', b, 0], ['編集前', a, 1]] : [['編集前', a, 1], ['編集後', b, 0]];
      const dir2 = rev ? '編集後→編集前' : '編集前→編集後';
      for (const [what, course, want] of seq) {
        setScale(m.cfg);
        const got = m.cap.driveableCapN(course, 'tabletop', 1);
        setScale(m.cfg);
        const truth = m.cap.stuckAtN(course, 'tabletop', 1) > 0 ? 0 : 1;   // 真値（キャッシュを通らない）
        if (truth !== want) v.push(`${label}【${tag}】${dir2} ${what}: 治具が陳腐化（真値 ${truth}・期待 ${want}）＝この章は空振り`);
        if (got !== truth) v.push(`${label}【${tag}】${dir2} ${what}: driveableCapN=${got} だが真値は ${truth}（古い答えを返している）`);
        // **二値の真偽だけでなく連続量の余裕も測る**（CI-14）。閾値のすぐ際に治具が寄ると、product が
        // 壊れていなくても環境差で色が変わる「境界上の基準」になる。実測の netMax/車長 を毎回出して縛る。
        setScale(m.cfg);
        const r = margin(m, course);
        if (want === 1 && !(r >= 1.20)) v.push(`${label}【${tag}】${dir2} ${what}: 走り出せる側の余裕が ${r.toFixed(3)}×車長（1.20 未満＝境界に寄りすぎ）`);
        if (want === 0 && !(r <= 0.85)) v.push(`${label}【${tag}】${dir2} ${what}: 走り出せない側の余裕が ${r.toFixed(3)}×車長（0.85 超＝境界に寄りすぎ）`);
        if (!rec.has(`${tag}/${what}`)) rec.set(`${tag}/${what}`, r);
      }
    }
  }
  return v;
}

// ── B) 同じ内容なら同じ digest ──────────────────────────────────────────────────
function checkB(mods) {
  const { cap, crs } = mods, v = [];
  const a = fixture(crs);
  const clone = JSON.parse(JSON.stringify(a));                       // 別オブジェクト・同じ内容
  if (cap.courseShapeDigest(a) !== cap.courseShapeDigest(clone))
    v.push('深いコピー（別オブジェクト・同じ内容）で digest が変わる＝✔適用のたびに測り直しになる');
  const shuffled = {};                                                // 鍵の並びだけ変える
  for (const k of Object.keys(clone).reverse()) shuffled[k] = clone[k];
  if (cap.courseShapeDigest(a) !== cap.courseShapeDigest(shuffled))
    v.push('鍵の並び順だけ違うオブジェクトで digest が変わる（生成経路の違いでキャッシュが当たらなくなる）');
  return v;
}

// ── C) 形の差を取りこぼさない ────────────────────────────────────────────────────
function checkC(mods) {
  const { cap, crs } = mods, v = [];
  const seen = new Map();
  let n = 0;
  for (const spec of SPECS) {
    const c = crs.buildFromSpec(spec); n++;
    const d = cap.courseShapeDigest(c);
    if (seen.has(d)) v.push(`出荷コースの digest が衝突: 「${c.name}」と「${seen.get(d)}」`);
    seen.set(d, c.name);
  }
  const a = fixture(crs), da = cap.courseShapeDigest(a);
  const variants = [
    ['壁を 1 本足す', (c) => { c.walls.push(EDIT_WALL); }],
    ['壁を 1 本消す', (c) => { c.walls.pop(); }],
    ['壁の端点を 1e-12 動かす', (c) => { c.walls[0].x1 += 1e-12; }],
    ['枠(bounds)を変える', (c) => { c.bounds.w += 0.01; }],
    ['スタート位置を変える', (c) => { c.start.x += 0.01; }],
    ['スタート方位を変える', (c) => { c.start.theta += 1e-9; }],
    ['フィニッシュを変える', (c) => { c.finish.x1 += 0.01; }],
    ['峠の勾配を足す（後から増えた場を代表）', (c) => { c.downhill = 3; }],
    ['峠の中心線を足す', (c) => { c.centerline = [[0, 0], [1, 1]]; }],
  ];
  for (const [what, mutate] of variants) {
    const c = JSON.parse(JSON.stringify(a));
    mutate(c);
    if (cap.courseShapeDigest(c) === da) v.push(`${what}: digest が変わらない（この差で古い答えが返る）`);
  }
  if (n < 2) v.push(`母集団が ${n} 本しかない（2 本未満では digest の衝突検査が成立しない＝この章は空振り）`);
  // **歩ける型の前提を測る（中-5 の指摘）**: `courseShapeDigest` はプレーンなオブジェクト/配列と
  //   プリミティブしか歩けない（Map/Set/Date/Symbol 鍵/非列挙/プロトタイプ状態は見えない・循環は歩けない）。
  //   コースがその形を外れた日に「静かに古い答えを返す」ので、**前提そのものを毎回確かめる**:
  //   出荷コースと normalizeCourse の出力が JSON 往復で同値なら、素のデータしか含まない。
  let plain = 0;
  for (const spec of SPECS) {
    const c = crs.buildFromSpec(spec);
    if (JSON.stringify(JSON.parse(JSON.stringify(c))) !== JSON.stringify(c))
      v.push(`「${c.name}」が JSON 往復で同値でない＝素のデータ以外を含む（digest が見落とす場がある）`);
    else plain++;
  }
  const fx0 = fixture(crs);
  if (JSON.stringify(JSON.parse(JSON.stringify(fx0))) !== JSON.stringify(fx0))
    v.push('normalizeCourse の出力が JSON 往復で同値でない（digest の前提が崩れている）');
  console.log(`     出荷 ${n} コースの digest は相異なり ${seen.size} 種・形の差 ${variants.length} 通り・素データ往復一致 ${plain}/${n} 本`);
  return v;
}

// ── D) 青天井にしない ───────────────────────────────────────────────────────────
async function checkD(dir) {
  const v = [...await assertIsolated(dir)];
  // ── D-1) carScale の掃引で 1 件も増えないこと。**飽和前の素の覚え書きで測る。**
  //   【層 4 レビュー 2026-09-20・重大】初版はこれを D-2（上限まで飽和させる検査）の**後ろ**で測っていた。
  //   飽和後は `size` が上限に釘付けになるので、掃引が何件積んでも増分は恒等的に 0 ＝ **原理的に失敗しえない
  //   検査**だった（実証: `fitguard.js` ⑥ の `ctx.reason !== 'carScale'` を外した変異でも増分 0 で緑）。
  //   ∴ 順序を入れ替え、**空の覚え書きから**掃引して増分を測る。E) の変異 5 がこの検査を狙って赤にする。
  {
    const m = await loadTree(dir, true);
    const course = fixture(m.crs);
    const fx = { regime: () => {}, scale: (uk) => m.cfg.setCarScale(uk), sync: () => {}, log: () => {} };
    const before = m.cap.CAP_CACHE.size;
    let sweeps = 0;
    for (let k = 0.5; k <= 2.0001; k += 0.1) {
      const uk = Math.round(k * 10) / 10;
      setScale(m.cfg, uk);
      m.guard.settleFitRatio(course, { regime: 'tabletop', userK: uk, slotCount: 3, reason: 'carScale' }, fx);
      sweeps++;
    }
    const grew = m.cap.CAP_CACHE.size - before;
    if (before !== 0) v.push(`D-1 の前提が崩れている: 掃引前の項目数が ${before}（空の覚え書きで測っていない＝上限に釘付けなら増分は恒等的に 0）`);
    if (grew !== 0) v.push(`carScale を ${sweeps} 段掃引したら項目数が ${grew} 件増えた（⑥ は reason==='carScale' で実走を払わない約束）`);
    console.log(`     D-1 carScale 掃引 ${sweeps} 段（掃引前 ${before} 件）→ 増分 ${grew} 件`);
  }
  // ── D-2) 相異なる形を上限 + 32 本通しても項目数が上限で止まる。
  //   併せて「追い出されても答えが変わらない」を測るが、**この検査が捕まえられるのは**
  //   「追い出したはずの鍵にヒットして古い答えを返す」型だけである（追い出し後の再計算は
  //   `driveableCapN` も比較対象の `stuckAtN` も同じ述語なので、そこは原理的に一致する）。**測っていないこと**:
  //   追い出しの順序が LRU か FIFO か（観測できるのは項目数と答えだけで、順序の区別は壁時計に頼ることになる）。
  {
    const m = await loadTree(dir, true);
    const { cap, cfg, crs } = m;
    const N = cap.CAP_CACHE.max + 32;
    const mkN = (i) => crs.normalizeCourse({
      name: NAME, bounds: { w: 3.0, h: 2.0 }, start: { x: 0.45, y: 1.00, theta: 0 },
      walls: [{ x1: X0, y1: YA, x2: X1 + i * 0.001, y2: YA }, { x1: X1 + i * 0.001, y1: YA, x2: X1 + i * 0.001, y2: YB },
              { x1: X1 + i * 0.001, y1: YB, x2: X0, y2: YB }, { x1: X0, y1: YB, x2: X0, y2: YA }],
    });
    setScale(cfg);
    const first = cap.driveableCapN(mkN(0), 'tabletop', 1);   // 追い出される前の答え
    const t0 = Date.now();
    for (let i = 0; i < N; i++) { setScale(cfg); cap.driveableCapN(mkN(i), 'tabletop', 1); }
    const ms = Date.now() - t0;
    if (cap.CAP_CACHE.size > cap.CAP_CACHE.max)
      v.push(`相異なる形を ${N} 本通したら項目数が ${cap.CAP_CACHE.size}（上限 ${cap.CAP_CACHE.max} を超えた＝青天井）`);
    console.log(`     D-2 相異なる形 ${N} 本（${ms} ms）→ 項目数 ${cap.CAP_CACHE.size} / 上限 ${cap.CAP_CACHE.max}`);
    setScale(cfg);
    const again = cap.driveableCapN(mkN(0), 'tabletop', 1);
    setScale(cfg);
    const truth = cap.stuckAtN(mkN(0), 'tabletop', 1) > 0 ? 0 : 1;
    if (again !== first || again !== truth)
      v.push(`追い出しを跨いで答えが変わった: 追い出し前 ${first} → 後 ${again}（真値 ${truth}）`);
  }
  return v;
}

// ── 本番ツリーで A)〜D) ─────────────────────────────────────────────────────────
console.log('\nBD1) 実走容量の覚え書きが「同じコース」を形状で判定する');
const real = await loadTree(JS_ROOT);
console.log('\n  A) 壁だけ違う 2 版で、それぞれの真値と一致する（2 組 × 順序の両方向・連続量マージン付き）');
const marginRec = new Map();
report('A) 古い答えを返した組', await checkA(JS_ROOT, 'product', marginRec));
for (const [k, r] of marginRec) console.log(`     治具の余裕 ${k}: ${r.toFixed(3)} × 車長`);
console.log('\n  B) 同じ内容なら同じ digest（深いコピー・鍵の並べ替え）');
report('B) 内容が同じなのに digest が違う組', checkB(real));
console.log('\n  C) 形の差を取りこぼさない');
report('C) 区別できなかった差', checkC(real));
console.log('\n  D) 項目数が上限で止まり、答えは変わらない');
report('D) 上限・答えの違反', await checkD(JS_ROOT));

// ── E) 検出力（変異）─────────────────────────────────────────────────────────────
// **product のファイルは読むだけ**（変異は一時ツリーの複製に入れる）。
console.log('\n  E) 変異試験（鍵を壊して A)/C)/D) が赤くなるか）');
const MUTATIONS = [
  ['鍵の 1 つ目を course.name へ戻す（BD1 以前）', 'capacity.js', 'A',
    (s) => s.replace('const key = `${courseShapeDigest(course)}|', 'const key = `${course.name}|')],
  ['digest が配列の中身を見ない（壁の座標を無視する）', 'capacity.js', 'A',
    (s) => s.replace("      if (Array.isArray(x)) { mixU(7); mixU(x.length); for (const e of x) walk(e); return; }",
                     "      if (Array.isArray(x)) { mixU(7); mixU(x.length); return; }")],
  ['digest を 1e-4 に量子化する（描画用指紋と同じ丸め）', 'capacity.js', 'C',
    (s) => s.replace('const mixN = (n) => { _f64[0] = n; mixU(_u32[0]); mixU(_u32[1]); };',
                     'const mixN = (n) => { mixU((n * 1e4) | 0); };')],
  ['上限の追い出しを外す', 'capacity.js', 'D',
    (s) => s.replace('  if (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value);', '')],
  // **層 4 レビュー 2026-09-20 の重大指摘を受けて追加。** D-1 が守っている約束（carScale のドラッグでは
  //   実走プローブを払わない）を実際に破る変異。初版の D) はこれを飽和後に測っていたため緑のままだった。
  ['fitguard ⑥ が carScale の掃引でも実走を払う（D-1 が守る約束を破る）', 'fitguard.js', 'D',
    (s) => s.replace("ctx.reason !== 'carScale' && capN > 1 && ctx.slotCount > 1", 'capN > 1 && ctx.slotCount > 1')],
];
const RAW = Object.fromEntries(['capacity.js', 'fitguard.js'].map((f) => [f, fs.readFileSync(path.join(JS_ROOT, f), 'utf8')]));
const mutMiss = [], mutNoop = [];
for (const [name, file, chapter, fn] of MUTATIONS) {
  const mutated = fn(RAW[file]);
  if (mutated === RAW[file]) { mutNoop.push(`${name}（変異が適用されていない＝パターンが実装とズレた）`); continue; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf_bd1_mut_'));
  try {
    fs.cpSync(JS_ROOT, tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, file), mutated);
    let caught = 0;
    if (chapter === 'A') caught = (await checkA(tmp, '変異')).length;
    else if (chapter === 'C') caught = checkC(await loadTree(tmp, true)).length;
    else caught = (await checkD(tmp)).length;
    if (caught === 0) mutMiss.push(`${name} → ${chapter}) が見逃した`);
    else console.log(`     ✓ ${name} → ${chapter}) が ${caught} 件で赤`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
console.log(`  変異 ${MUTATIONS.length} 件を注入（product のファイルは無改変）`);
report('E) 見逃した変異', mutMiss);
report('E) 適用できなかった変異（パターン腐り）', mutNoop);

// product が無改変であることの機械確認（ゲート自身が書き換えていない）
{
  const changed = Object.keys(RAW).filter((f) => fs.readFileSync(path.join(JS_ROOT, f), 'utf8') !== RAW[f]);
  if (changed.length) { pass = false; console.log(`  ✗ ゲートの実行で ${changed.join(', ')} が変化した（変異が本番ツリーへ漏れた）`); }
  else console.log(`  ✓ public/js/{${Object.keys(RAW).join(', ')}} は実行前後で無変化`);
}

for (const d of _tmpDirs) fs.rmSync(d, { recursive: true, force: true });   // 複製した一時ツリーを片づける

console.log('\n' + '='.repeat(78));
console.log(pass ? 'BD1 実走容量キャッシュの鍵・ゲート: 全パス ○' : 'BD1 実走容量キャッシュの鍵・ゲート: ✗ 不合格');
console.log('='.repeat(78));
process.exit(pass ? 0 : 1);
