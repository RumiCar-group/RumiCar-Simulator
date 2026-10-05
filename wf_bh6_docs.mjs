// wf_bh6_docs.mjs — Stage BH6 常設ゲート: 利用者向けの説明に書いた数字と主張を、product の実測と照合する。
// ════════════════════════════════════════════════════════════════════════════
// 背景（2026-10-04〜05）: Stage BH で、説明と実態の食い違いが続けて見つかった。
//   ・`spec.exec.crash` ほかの「後退して開いた側へ切り返し」→ 実装は同じ場所での試行ごとに 真後ろ → 左 → 右（AK4 以来）
//   ・Python 版サンプル 3 本の「C 版と完全に同一 (=同じ走り)」→ 3 本とも行き止まり脱出が無く、走りが違う
//   ・`physics_model` §14 の「（逆走は）STUCK の切り返しで増える」→ 母集団では増えていない
//   ・自己位置推定サンプルの「前方検知 96%」→ 実測と合わない（こちらは実測を持つ wf_ao10_localize.mjs の ⑥ が見張る）
//   どれも、説明を書いた後に実装・走りが変わり、説明を見張るものが無かったために残った。
//   このゲートは、BH6 で書いた説明（`docs/physics_model.md`／`.en.md` §14・アプリ内 `messages.js`・`programs.js` の注記）から
//   数字を抜き出し、product を**実際に動かして**得た値と突き合わせる。走りや定数を変えたら赤になる＝説明も直す合図。
//
// 検査:
//   A) 切り返し: 動けない箱の中の車を走らせ、切り返しの舵が 真後ろ → 左 → 右 の順に巡ること・1 回の後退の長さ・同じ場所での
//      回数の上限・諦めた後の待ち時間を測り、説明の数字と一致。「開いた側へ」の記述が残っていない。
//   B) 向き直し: 長い直線の治具で、向きが逆のまま逆走する車が向きを直されるまでの距離（車長倍）を測り、説明の「5 車長」と一致。
//      進行方向の場のある出荷コースの数（周回・峠・輪のコース・全体）と、同梱の形（取り込みの後）・エディタで適用した形でも場が残る
//      コース、6 台まで並べたグリッドで置かれた時点で逆向きの配置の数、自分で U ターンを繰り返すサンプルの向き直しの回数を測り、
//      説明の数字と一致。向きの一致の下限と輪の見分けの対の数は、ソースの定数と説明が一致。
//   C) 周回: 出荷「トライアングル」で、スタート位置と 6 台のグリッドの 5・6 番手（車体 1× とライブの既定の倍率）から、中心線の上の点を
//      順に product の LapTracker へ与えて、1 周目を数えるまでの道のり（1 周に対する割合）・スタートが線の何 m／何車長先か・1 周の長さ、
//      フィニッシュ線分と正方向が直交するコースの数を測り、説明の数字と一致。
//   D) Python 版サンプル 3 本: C 版と違う走りになるレースが実際にあること（無くなったら注記が古い）・「C 版と同一」の記述が残っていない。
//   E) 並べられる台数: レースガイドの「道幅の狭いコースでは、6台を並べられないことがあります (多くのコースは6台)」を、フィニッシュの
//      ある出荷コース × 3 エンジンで、アプリの ▶ が台数を決める関数（fitguard.settleFitRatio・ライブの既定の車体の倍率・6 台を指定）を
//      呼んだ実測と照合。以前の説明「ナローシケインは実態容量 4 台」は実測（6 台）と合っていなかった（BH6 の層 4 が毎回指摘）。
//      ここで見るのは「6 台に届くか」だけ（settleFitRatio の capN を 6 で頭打ち。1 台も走り出せないコースは capN が表示用に 1 へ丸められる
//      ので、台数そのものは説明に書かない）。🏁 の 2 段目（runRace が車体 1× の静的な収容へ切る）と、📋 開催・公式の再走の経路
//      （runRace の静的な収容だけ）は測っていない。
//
// 測り方の前提: グリッドは product の freeSpawn を、各コースの領域・**車体 1×**（公式レース・🏁 と同じ）で、静的な収容（capacityOf）の
//   台数まで呼んで作る。アプリの ▶／🏁 は卓上では走り出せる台数（実走容量）までさらに減らすことがあり、▶ は車体の倍率でも配置が
//   変わるので、アプリで見える台数とは一致しない（説明にもそう書いてある。ライブの既定の倍率で並べた配置の数は B) が記録として印字する）。
//   配置はエンジンに依らないので、説明の「3 エンジンの延べ」は配置の数 × 3。
// 見張れていないもの（限界）: ①母集団の百分率・台数（Stage BH2・BH3・BH5 の測定の値。ここでは測り直さない）と、置き直しの線の長さ・
//   向きを直されるまでの秒数・「車が動くのは 1 車長未満」など、下に挙げていない数字。②数字を含まない文の意味（例: 説明の否定を肯定に
//   書き換える。輪の形の例外の文は「働きます」まで照合する）。③同じ数字を別の言い回しで書いた文（照合するのは下に正規表現で挙げた
//   文だけ）。④Python 版の注記の「側方補正の条件が違う」（走りの違いと後退の有無だけを見る）。⑤向き直しの「90° 超」「0 より下へ
//   積まない」・向きの一致の下限と輪の対の数の**使われ方**は、振る舞いを wf_bh5_marshal.mjs が見る（ここは説明の数字と定数の一致だけ）。
//   ⑥同梱の形（course.js normalizeCourse）・エディタで適用した形（course_editor.js の CourseEditor.result()）は「進行方向の場があるか」
//   だけを見る（実際に向きを直すかは見ていない）。⑦「アプリで見える台数はこのとおりにはならない」は、ライブの既定の倍率で並べた配置の
//   数が車体 1× と違うことだけを見る（B) では ▶／🏁 が台数を絞る経路 fitguard.js を動かしていない）。
// 説明の文を直すときは、ここの正規表現も合わせること（数字を書いた文が見つからなければ赤）。
// 使い方: node wf_bh6_docs.mjs      exit: 0=全緑 / 1=いずれか赤。
// ════════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { loadMods } from './wf_bg_live.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JS_DIR = path.join(HERE, 'public/js');
const M = await loadMods(JS_DIR);
const u = (f) => pathToFileURL(path.join(JS_DIR, f)).href;
const [{ MESSAGES }, lapMod, edMod] = await Promise.all([import(u('i18n/messages.js')), import(u('lap.js')), import(u('course_editor.js'))]);
const { config, fleet, course: courseMod, race, programs, api, runner, dyn, fitguard } = M;
const SPECS = JSON.parse(fs.readFileSync(path.join(HERE, 'public/data/courses.json'), 'utf8'));
const MD = fs.readFileSync(path.join(HERE, 'docs/physics_model.md'), 'utf8');
const EN = fs.readFileSync(path.join(HERE, 'docs/physics_model.en.md'), 'utf8');
const msg = (k, lang) => { const e = MESSAGES[k]; return e ? (e[lang] || '') : ''; };

let fail = 0;
const ok = (cond, m) => { console.log(`  ${cond ? '○' : '✗'} ${m}`); if (!cond) fail++; return cond; };
// 説明の 1 か所から数字を抜き出して実測と比べる。places = [[名前, 本文, 正規表現], …]・want = 実測（表示と同じ丸めの文字列の配列）。
function claims(label, want, places) {
  const bad = [];
  for (const [name, text, re] of places) {
    const m = re.exec(text);
    if (!m) bad.push(`${name}: 数字を書いた文が見つからない`);
    else if (m.slice(1).join('/') !== want.join('/')) bad.push(`${name}: 説明 ${m.slice(1).join('/')} ≠ 実測 ${want.join('/')}`);
  }
  ok(bad.length === 0, `${label}＝実測 ${want.join('/')}（説明 ${places.length} か所）${bad.length ? ' — ' + bad.join(' ／ ') : ''}`);
}
// 説明の本文（解説 2 本＋アプリ内の全メッセージ）と、サンプルの説明・本文。
const DOC_TEXT = [['docs/physics_model.md', MD], ['docs/physics_model.en.md', EN],
  ...Object.keys(MESSAGES).flatMap((k) => [[`${k} (ja)`, msg(k, 'ja')], [`${k} (en)`, msg(k, 'en')]])];
const PROG_TEXT = programs.PROGRAMS.flatMap((p) => [[`programs.js ${p.key} strategy`, p.strategy || ''], [`programs.js ${p.key} learns`, p.learns || ''], [`programs.js ${p.key} code`, p.code || '']]);
function forbid(label, re, texts) {
  const hits = texts.filter(([, t]) => re.test(t)).map(([n]) => n);
  ok(hits.length === 0, `${label}（${texts.length} 個の本文を走査）${hits.length ? ' — 残っている: ' + hits.slice(0, 5).join('・') : ''}`);
}
// 1 台の車を治具のコースで走らせる準備（main.js の ▶ と同じ部品: makeSlot → rebuildSpawns → buildController）。
function soloSlot(course, { src, lang = 'c', mode = 'dynamic' }) {
  config.SENSOR_NOISE.on = false; config.setPhysicsMode(mode); dyn.applyRegime('tabletop'); config.setCarScale(1);
  const slot = fleet.makeSlot({ i: 0, lang, src, course, slotCount: 1, logFor: () => () => {}, persist: false });
  fleet.rebuildSpawns([slot], course, null, { persist: false });
  slot.car.reset(slot.spawn);
  slot.hostEnv = api.buildApi(slot.world);
  slot.lap.reset(course, { carType: slot.carType, persist: false });
  slot.controller = runner.buildController(src, lang, slot.hostEnv); slot.controller.setup();
  slot.running = true; slot.loopTimer = 0;
  return slot;
}
const DT = 1 / config.SIM.physicsHz;
function stepSolo(slot, course, recover) {
  slot.loopTimer -= DT;
  if (slot.loopTimer <= 0) { fleet.tickSlot(slot, []); slot.loopTimer += (1 / config.SIM.loopHz) + (slot.world._pendingDelay || 0) / 1000; }
  fleet.integrateSlot(slot, DT, [], course.walls, recover, [slot]);
}
const box = (x0, y0, x1, y1) => [{ x1: x0, y1: y0, x2: x1, y2: y0 }, { x1: x1, y1: y0, x2: x1, y2: y1 }, { x1: x1, y1: y1, x2: x0, y2: y1 }, { x1: x0, y1: y1, x2: x0, y2: y0 }];
const FWD_C = 'void setup() { RC_setup(); }\nvoid loop() { RC_steer(CENTER); RC_drive(FORWARD, 200); }';

console.log(`wf_bh6_docs — 説明に書いた数字と主張を product の実測と照合する（${config.APP_VERSION}）`);

// ── A) 切り返し ────────────────────────────────────────────────────────────────────────
console.log('\nA) 切り返し（動けない箱の中の車）');
{
  // 車体より 2 cm ずつだけ広い箱: 前へも後ろへも動けない＝毎回「同じ場所」で切り返しを仕込み直す。
  dyn.applyRegime('tabletop'); config.setCarScale(1);
  const Lc = config.CAR.length, Wc = config.CAR.width, rb = config.CAR.rearToBack;
  const course = { name: 'bh6-box', bounds: { w: 2, h: 2 }, walls: box(1 - rb - 0.01, 1 - Wc / 2 - 0.01, 1 - rb + Lc + 0.01, 1 + Wc / 2 + 0.01), start: { x: 1, y: 1, theta: 0 }, finish: null };
  const slot = soloSlot(course, { src: FWD_C }), car = slot.car, C = config.CONST;
  const nameOf = (s) => (s === C.CENTER ? '真後ろ' : s === C.LEFT ? '左' : s === C.RIGHT ? '右' : '?');
  const seq = []; let prevT = 0, backT = null, gaveAt = null, waitT = null, t = 0;
  for (let k = 0; k < 60 * 60 && waitT == null; k++) {
    stepSolo(slot, course, true); t += DT;
    if (car.recoverT > prevT + 1e-9) {   // 新しい切り返しを仕込んだ
      if (gaveAt != null) waitT = t - gaveAt;
      else { seq.push(nameOf(car.recoverSteer)); if (backT == null) backT = car.recoverT; }
    }
    if (car.gaveUp && gaveAt == null) gaveAt = t;
    prevT = car.recoverT;
  }
  const cyc = seq.slice(0, 3).join(' → ');
  ok(seq.length >= 3 && seq.every((s, i) => s === seq[i % 3]) && new Set(seq.slice(0, 3)).size === 3, `切り返しの舵は 3 通りを同じ順に巡る（${seq.join(' → ')} → 諦め）`);
  ok(gaveAt != null && waitT != null && Math.abs(waitT - Math.round(waitT)) < 0.1, `諦めた後、待ってからやり直す（待ち ${waitT == null ? '—' : waitT.toFixed(2)} 秒＝整数秒から 0.1 秒以内）`);
  const want = [cyc, String(seq.length), waitT == null ? '—' : String(Math.round(waitT))];
  claims('切り返しの舵の順・同じ場所での回数・諦めた後の待ち（秒）', want, [
    ['spec.exec.crash (ja)', msg('spec.exec.crash', 'ja'), /試行ごとに (\S+ → \S+ → \S+) の順に替えます。[^)]*?同じ場所で(\d+)回試しても抜けられなければ、(\d+)秒待ってからやり直します/],
  ]);
  const EN_NAME = { 真後ろ: 'straight back', 左: 'left', 右: 'right' }, cycEn = seq.slice(0, 3).map((x) => EN_NAME[x] || '?').join(' → ');
  claims('切り返しの舵の順（英語）・回数・待ち', [cycEn, want[1], want[2]], [
    ['spec.exec.crash (en)', msg('spec.exec.crash', 'en'), /cycles ([a-z ]+ → [a-z ]+ → [a-z ]+) with each try at the same spot[^)]*?After (\d+) tries at the same spot without getting out, it waits (\d+) s/],
  ]);
  claims('1 回の後退の長さ（秒）と舵の順', [backT == null ? '—' : String(+backT.toFixed(2)), cyc], [
    ['docs/physics_model.md §14 の STUCK の行', MD, /\(([\d.]+) 秒後退する。後退中の舵は、同じ場所での試行ごとに (\S+ → \S+ → \S+) の順に替える/],
  ]);
  claims('1 回の後退の長さ（英語）と舵の順', [backT == null ? '—' : String(+backT.toFixed(2)), cycEn], [
    ['docs/physics_model.en.md §14 の STUCK の行', EN, /reverse for ([\d.]+) s; the steering while reversing cycles ([a-z ]+ → [a-z ]+ → [a-z ]+) with each try/],
  ]);
  // サンプルのプログラム自身が「開いた側へ」舵を切るのは別の話（programs.js の本文は対象外）。
  forbid('自動復帰の説明に「開いた側へ切り返す」という記述が残っていない', /開いた側へ|toward the open side/, DOC_TEXT);
}

// ── B) 向き直し ────────────────────────────────────────────────────────────────────────
console.log('\nB) 逆走の向き直し');
{
  // 長い直線の周回路の治具（中心線つき）。車を逆向きに置いて前進させ、向きを直されるまでに逆へ進んだ距離を測る。
  const spec = { name: 'bh6-ring', kind: 'track', shape: 'ellipse', rx: 6.0, ry: 2.0, width: 0.6, samples: 160 };
  const course = courseMod.buildFromSpec(spec);
  const cl = course.centerline;
  let k0 = 0; cl.forEach((q, i) => { if (q[1] > cl[k0][1]) k0 = i; });   // 楕円の平らな側（曲率が最も小さい所）から始める
  const a = cl[k0], b = cl[(k0 + 1) % cl.length];
  const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const run = (recover) => {
    const slot = soloSlot(course, { src: FWD_C }), car = slot.car;
    car.reset({ ...slot.spawn, x: a[0], y: a[1], theta: dir + Math.PI }); slot.lap.reset(course, { carType: slot.carType, persist: false });
    let dist = 0, px = car.x, py = car.y, at = null;
    for (let k = 0; k < 60 * 30 && at == null; k++) {
      stepSolo(slot, course, recover);
      const m0 = car._marshal || 0;
      if (m0 > 0) { at = dist; break; }
      dist += Math.hypot(car.x - px, car.y - py); px = car.x; py = car.y;
    }
    return { at, dist, cos: Math.cos(car.theta - dir) };
  };
  const on = run(true), off = run(false);
  const Lc = config.CAR.length, n = on.at == null ? null : on.at / Lc;
  ok(n != null && on.cos > 0.9, `自動復帰 ON: 逆向きに ${n == null ? '—' : n.toFixed(2)} 車長進んだ所で向きを直された（直した後の向きの cos ${on.cos.toFixed(3)}）`);
  ok(off.at == null && off.dist > 8 * Lc, `自動復帰 OFF: 向きを直さない（${(off.dist / Lc).toFixed(0)} 車長逆走したまま）`);
  const L = n == null ? '—' : String(Math.round(n));
  ok(n != null && Math.abs(n - Math.round(n)) < 0.06, `向きを直すまでの距離は ${L} 車長から 0.06 車長以内（${n == null ? '—' : n.toFixed(3)}）`);
  claims('向きを直すまでの逆走の距離（車長倍）', [L], [
    ['docs/physics_model.md §14.1', MD, /進行方向と逆へ\*\*正味 (\d+) 車長\*\*進んだとき/],
    ['docs/physics_model.en.md §14.1', EN, /has gone a \*\*net (\d+) car lengths\*\* against the course direction/],
    ['spec.exec.crash (ja)', msg('spec.exec.crash', 'ja'), /逆へ車長の(\d+)倍ぶん進んだ車/],
    ['spec.exec.crash (en)', msg('spec.exec.crash', 'en'), /travelled (\d+) car lengths the wrong way/],
    ['fleet.recover.title (ja)', msg('fleet.recover.title', 'ja'), /車長の(\d+)倍ぶん逆走した車/],
    ['fleet.recover.title (en)', msg('fleet.recover.title', 'en'), /run (\d+) car lengths the wrong way/],
    ['pm.s11.wrongway (ja)', msg('pm.s11.wrongway', 'ja'), /逆へ正味(\d+)車長進むと/],
    ['pm.s11.wrongway (en)', msg('pm.s11.wrongway', 'en'), /gone a net (\d+) car lengths against the course/],
    ['rg.rules.body (ja)', msg('rg.rules.body', 'ja'), /向きが逆のまま(\d+)車長逆走して/],
    ['rg.rules.body (en)', msg('rg.rules.body', 'en'), /after running (\d+) car lengths the wrong way/],
    ['docs/physics_model.md §9', MD, /車体の向きが進行方向と逆のまま (\d+) 車長逆走した車を、その場で/],
    ['docs/physics_model.en.md §9', EN, /a car that has run (\d+) car lengths the wrong way while its body faces against the course direction is turned on the spot/],
    ['docs/physics_model.md §14.1 残る逆走', MD, /②(\d+) 車長に届くまでの逆走は起きます/],
    ['docs/physics_model.en.md §14.1 remains', EN, /\(2\) Wrong-way running up to (\d+) car lengths still happens/],
    ['pm.s11.wrongway (ja) 冒頭', msg('pm.s11.wrongway', 'ja'), /出荷の周回コースと峠では、(\d+)車長で向きを直すようにしました/],
    ['pm.s11.wrongway (en) head', msg('pm.s11.wrongway', 'en'), /it is now turned back after (\d+) car lengths/],
    ['pm.s11.wrongway (ja) ④', msg('pm.s11.wrongway', 'ja'), /④(\d+)車長に届かない逆走/],
    ['pm.s11.wrongway (en) (4)', msg('pm.s11.wrongway', 'en'), /\(4\) Wrong-way running shorter than (\d+) car lengths/],
  ]);
  // ソースの定数との照合（振る舞いは wf_bh5_marshal.mjs が見る。ここは「説明の数字 = 定数」だけ）
  { const src = fs.readFileSync(path.join(JS_DIR, 'fleet.js'), 'utf8');
    const cst = (name) => (new RegExp(`\\nconst ${name} = ([\\d.]+);`).exec(src) || [])[1] || '—';
    claims('向きの一致の下限（MARSHAL_COS）', [cst('MARSHAL_COS')], [
      ['docs/physics_model.md §14.1', MD, /その位置の進行方向と合わない\(cos ≤ ([\d.]+)\)/],
      ['docs/physics_model.en.md §14.1', EN, /not agree with the course direction at that position \(cos ≤ ([\d.]+)\)/],
    ]);
    claims('輪の見分けの対の数の下限（ANNULUS_MIN_N）', [cst('ANNULUS_MIN_N')], [
      ['docs/physics_model.md §14.1', MD, /等しい角度で刻んだ形」\((\d+) 対以上\)/],
      ['docs/physics_model.en.md §14.1', EN, /cut at equal angles from a common centre" \((\d+) pairs or more\)/],
    ]); }
  // 進行方向の場のある出荷コースの数
  const cnt = { all: SPECS.length, field: 0, track: 0, touge: 0, ring: [] };
  for (const s of SPECS) {
    const c = courseMod.buildFromSpec(s);
    if (!fleet.dirFrame(c)) continue;
    cnt.field++;
    if (s.kind === 'touge') cnt.touge++; else if (Array.isArray(c.centerline)) cnt.track++; else cnt.ring.push(s.name);
  }
  ok(cnt.field === cnt.track + cnt.touge + cnt.ring.length, `進行方向の場のある出荷コース ${cnt.field}/${cnt.all} 本（中心線の周回 ${cnt.track}・峠 ${cnt.touge}・輪のコース ${cnt.ring.length}: ${cnt.ring.join('・')}）`);
  claims('場のあるコース数（全体・うち場あり）', [String(cnt.all), String(cnt.field)], [
    ['docs/physics_model.md §14.1', MD, /\*\*出荷 (\d+) 本中 (\d+) 本\*\*/],
    ['pm.s11.wrongway (ja)', msg('pm.s11.wrongway', 'ja'), /出荷(\d+)本中(\d+)本/],
  ]);
  claims('場のあるコース数（英語・うち場あり・全体）', [String(cnt.field), String(cnt.all)], [
    ['docs/physics_model.en.md §14.1', EN, /\*\*(\d+) of the (\d+) shipped courses\*\*/],
    ['pm.s11.wrongway (en)', msg('pm.s11.wrongway', 'en'), /\((\d+) of the (\d+) shipped courses in all/],
  ]);
  claims('内訳（中心線の周回・峠・輪のコース）', [String(cnt.track), String(cnt.touge), String(cnt.ring.length), cnt.ring.join('・')], [
    ['docs/physics_model.md §14.1', MD, /中心線を持つ出荷の周回コース\((\d+) 本\)と峠\((\d+) 本\)、[^|]*?出荷コース (\d+) 本\(([^)]+)\)/],
  ]);
  claims('内訳（英語）', [String(cnt.track), String(cnt.touge), String(cnt.ring.length)], [
    ['docs/physics_model.en.md §14.1', EN, /the shipped lap courses \((\d+)\) and touge courses \((\d+)\) that have a centerline, and the (\d+) shipped courses whose walls/],
  ]);
  // 同梱の形（大会定義に埋め込んだコース＝取り込み normalizeCourse の後）: 中心線は外れるが、輪のコースは壁の形から見分けるので場が残る。
  { let clKeep = 0; const ringKeep = [];
    for (const s of SPECS) { const c = courseMod.buildFromSpec(s); if (!c.finish) continue;
      const r = courseMod.normalizeCourse(JSON.parse(JSON.stringify(c))), cc = r && (r.course || r);
      if (cc && cc.walls && fleet.dirFrame(cc)) { if (Array.isArray(c.centerline)) clKeep++; else ringKeep.push(s.name); } }
    ok(clKeep === 0 && ringKeep.join('・') === cnt.ring.join('・'), `同梱の形（取り込みの後）で場が残るのは輪のコースだけ（中心線のコース ${clKeep} 本・輪のコース ${ringKeep.length} 本）`);
    // 輪の形の見分け: 写し（JSON 往復）は場が残る。壁を 1 本足す・外周と内周の順を入れ替える・座標を小数 3 桁に丸める、では場が無くなる。
    { const bad = [];
      for (const nm of cnt.ring) { const c = courseMod.buildFromSpec(SPECS.find((x) => x.name === nm)), w = c.walls, h = w.length / 2;
        const mk = (walls) => ({ name: c.name, bounds: c.bounds, start: c.start, finish: c.finish, walls });
        const r3 = (v) => Math.round(v * 1000) / 1000;
        const cases = [['写し', mk(JSON.parse(JSON.stringify(w))), true], ['壁を 1 本足す', mk([...w, { x1: 0, y1: 0, x2: 0.01, y2: 0 }]), false],
          ['外周と内周の順を入れ替える', mk([...w.slice(h), ...w.slice(0, h)]), false], ['座標を小数 3 桁に丸める', mk(w.map((q) => ({ x1: r3(q.x1), y1: r3(q.y1), x2: r3(q.x2), y2: r3(q.y2) }))), false]];
        for (const [what, cc, want] of cases) if (!!fleet.dirFrame(cc) !== want) bad.push(`${nm}・${what}: 場が${want ? '無い' : 'ある'}`); }
      ok(bad.length === 0, `輪の形の ${cnt.ring.length} 本: 写しは場が残り、壁を足す・外周と内周の順を入れ替える・座標を粗く丸めると場が無くなる${bad.length ? ' — ' + bad.slice(0, 3).join(' ／ ') : ''}`);
      for (const [nm, t, re] of [['docs/physics_model.md §14.1 働くコース', MD, /見分けは壁の形と並び\(外周の輪・内周の輪の順\)で行うので、この (\d+) 本の壁をそのまま写したコースも同じ扱いになります/],
        ['docs/physics_model.en.md §14.1', EN, /The check looks at the shape and order of the walls \(the outer ring, then the inner ring\), so a course that copies the walls of these (\d+) exactly is treated the same/]]) {
        const m = re.exec(t); ok(!!m && m[1] === String(cnt.ring.length), `${nm}: 「壁の形と並びで見分け、写しも同じ扱い」と書いてある（本数 ${m ? m[1] : '文が無い'}）`); } }
    // コースエディタで開いて ✔適用した形でも同じ（product の CourseEditor に読み込ませ、result() が返すコースで見る）。
    let edCl = 0, edRing = 0;
    for (const s of SPECS) { const c = courseMod.buildFromSpec(s); if (!c.finish) continue;
      const er = new edMod.CourseEditor(c).result(), ec = er && (er.course || er);
      if (ec && ec.walls && fleet.dirFrame(ec)) { if (Array.isArray(c.centerline)) edCl++; else edRing++; } }
    ok(edCl === 0 && edRing === cnt.ring.length, `エディタで適用した形（壁・スタート・フィニッシュだけ）で場が残るのも輪のコースだけ（中心線のコース ${edCl} 本・輪のコース ${edRing} 本）`);
    claims('同梱・写しでも働く輪のコースの数（文は「働きます」まで照合）', [String(ringKeep.length)], [
      ['docs/physics_model.md §14.1 働かないとき', MD, /コースエディタで開いて ✔適用したコースや、大会定義に同梱したコースでは中心線が外れるので働きません。例外は上の輪の形の (\d+) 本で、壁の形と並びから見分けるので、壁をそのまま写した自作コースや同梱した大会定義でも働きます。壁を足す・外周と内周の順を入れ替える・座標を粗く丸めるなどで形や並びが崩れると働きません/],
      ['docs/physics_model.en.md §14.1', EN, /because the centerline is dropped\. The exception is the (\d+) ring-shaped courses above: they are recognised from the shape and order of the walls, so it does act on an own course that copies their walls exactly and on a race definition that bundles one\. If the shape or the order is broken — a wall added, the outer and inner rings swapped, coordinates rounded coarsely and so on — it does not act/],
      ['pm.s11.wrongway (ja)', msg('pm.s11.wrongway', 'ja'), /中心線が外れるので働きません。輪の形の(\d+)本は壁の形と並びから見分けるので、壁をそのまま写した自作コースや同梱した大会でも働きます/],
      ['pm.s11.wrongway (en)', msg('pm.s11.wrongway', 'en'), /because the centerline is dropped\. The (\d+) ring-shaped courses are recognised from the shape and order of their walls, so it does act on an own course that copies their walls exactly and on a race that bundles one/],
      ['spec.exec.crash (ja)', msg('spec.exec.crash', 'ja'), /自作コース・投稿コースでは働きません<\/b> \(壁が輪の形の出荷コース(\d+)本をそのまま写したコースでは働きます\)/],
      ['spec.exec.crash (en)', msg('spec.exec.crash', 'en'), /it does not act on your own or community courses<\/b> \(it does act on a course that copies the walls of one of the (\d+) ring-shaped shipped courses exactly\)/],
      ['docs/physics_model.md §9', MD, /自作・投稿コースでは働きません\(輪の形の出荷コース (\d+) 本の写しなどを除く\)/],
      ['docs/physics_model.en.md §9', EN, /not on your own or community courses \(except, for example, copies of the (\d+) ring-shaped shipped courses\)/],
      ['docs/physics_model.md §14.1 残る逆走', MD, /①対象外のコース・規則\(輪の形の (\d+) 本の写しなどを除く自作コース・投稿コース、リタイア規則、自動復帰 OFF\)では今までどおり/],
      ['docs/physics_model.en.md §14.1 remains', EN, /\(your own courses and community courses other than, for example, copies of the (\d+) ring-shaped courses; the retire rule; auto-recover off\) nothing changes/],
    ]); }
  // 6 台のグリッド（各コースの領域・車体 1×・収まる台数まで）で、置かれた時点でその場所の進行方向と逆を向いている車。
  //   配置はエンジンに依らないので、説明の「延べ」は 3 エンジンぶん（× 3）。
  { let nCars = 0, rev = 0; const revC = new Set();
    for (const s of SPECS) { const c = courseMod.buildFromSpec(s); const df = fleet.dirFrame(c); if (!df) continue;
      dyn.applyRegime(s.noRace ? 'fullscale' : 'tabletop'); config.setCarScale(1);
      const nFit = fleet.capacityOf(c, 6), occ = [];
      for (let i = 0; i < nFit; i++) { const sp = fleet.freeSpawn(c, occ, i); occ.push(sp); nCars++; if (Math.cos(sp.theta - fleet.dirAt(df, sp.x, sp.y)) < 0) { rev++; revC.add(s.name); } } }
    dyn.applyRegime('tabletop'); config.setCarScale(1);
    const E = 3;
    const noComma = (t) => t.replace(/(\d),(\d{3})/g, '$1$2');
    { const liveK = +((/id="carScale"[^>]*\bvalue="([\d.]+)"/.exec(fs.readFileSync(path.join(HERE, 'public/index.html'), 'utf8')) || [])[1]);
      let nL = 0, revL = 0;
      for (const s of SPECS) { const c = courseMod.buildFromSpec(s); const df = fleet.dirFrame(c); if (!df) continue;
        dyn.applyRegime(s.noRace ? 'fullscale' : 'tabletop'); config.setCarScale(liveK);
        const nFit = fleet.capacityOf(c, 6), occ = [];
        for (let i = 0; i < nFit; i++) { const sp = fleet.freeSpawn(c, occ, i); occ.push(sp); nL++; if (Math.cos(sp.theta - fleet.dirAt(df, sp.x, sp.y)) < 0) revL++; } }
      dyn.applyRegime('tabletop'); config.setCarScale(1);
      ok(Number.isFinite(liveK) && (nL !== nCars || revL !== rev), `ライブの既定の車体 ${liveK}× で並べると配置の数が変わる（${nL} 通りのうち逆向き ${revL} 通り／車体 1× は ${nCars} 通りのうち ${rev} 通り）＝「アプリで見える台数はこのとおりにはならない」`);
      for (const [nm, t, re] of [['docs/physics_model.md §14.1', MD, /アプリで見える台数はこのとおりにはなりません。多くなることも少なくなることもあります/], ['docs/physics_model.en.md §14.1', EN, /the count you see in the app will not be exactly this — it can be more or fewer/]]) ok(re.test(t), `${nm}: 「アプリで見える台数はこのとおりにはならない」と書いてある`); }
    claims('置かれた時点で逆向きのグリッドの配置（配置の数・うち逆向き・コース数・3 エンジンの延べ・うち逆向き）', [String(nCars), String(rev), String(revC.size), String(nCars * E), String(rev * E)], [
      ['docs/physics_model.md §14.1', noComma(MD), /公式レースと同じ車体 1× で 6 台まで並べた配置 (\d+) 通りのうち (\d+) 通り・(\d+) コース。3 エンジンの延べでは (\d+) 台中 (\d+) 台/],
    ]);
    claims('同（英語・うち逆向き・配置の数・コース数・延べのうち逆向き・延べ）', [String(rev), String(nCars), String(revC.size), String(rev * E), String(nCars * E)], [
      ['docs/physics_model.en.md §14.1', noComma(EN), /\((\d+) of the (\d+) grid positions when up to 6 cars are placed at car scale 1×, as in official races, on (\d+) courses; counted over the 3 engines that is (\d+) of (\d+) cars/],
    ]);
    claims('同（アプリ内・配置の数・うち逆向き・延べ・うち逆向き）', [String(nCars), String(rev), String(nCars * E), String(rev * E)], [
      ['pm.s11.wrongway (ja)', noComma(msg('pm.s11.wrongway', 'ja')), /公式レースと同じ車体1×で6台まで並べた配置(\d+)通りのうち(\d+)通り。3エンジンの延べでは(\d+)台中(\d+)台/],
    ]);
    claims('同（アプリ内・英語）', [String(rev), String(nCars), String(rev * E), String(nCars * E)], [
      ['pm.s11.wrongway (en)', noComma(msg('pm.s11.wrongway', 'en')), /\((\d+) of the (\d+) grid positions when up to 6 cars are placed at car scale 1×, as in official races; counted over the 3 engines that is (\d+) of (\d+) cars\)/],
    ]); }
  // 自分で U ターン・スピンを繰り返すサンプル: ドリフト車のサンプル 6 台・ナローシケイン・動力学・ペナルティ復帰の公式レースで、1 台の向き直しの最大。
  { const p = programs.PROGRAM_BY_KEY.drift_fr, sp = SPECS.find((x) => x.name === 'ナローシケイン・レイアウト');
    const r = race.runRace({ course: courseMod.buildFromSpec(sp), regime: 'tabletop', laps: 3, field: Array.from({ length: 6 }, (_, i) => ({ name: 'C' + i, lang: p.lang || 'c', src: p.code, carType: p.carType })), crashRule: { rejoin: true, penaltySec: 3 }, interact: true, physics: 'dynamic', report: true });
    const mx = Math.max(...r.report.map((q) => q.marshalCount || 0));
    ok(r.report.length === 6, `ドリフト車のサンプル 6 台がナローシケインに並ぶ（${r.report.length} 台・向き直し ${r.report.map((q) => q.marshalCount).join('/')}）`);
    claims('自分で U ターンを繰り返すサンプルの、1 台の向き直しの最大', [String(mx)], [
      ['docs/physics_model.md §14.1', MD, /`drift_fr` を 6 台並べたナローシケイン・動力学の公式レースで、1 台に最大 (\d+) 回/],
      ['docs/physics_model.en.md §14.1', EN, /up to (\d+) times for one car in an official race on the dynamic model with six of the drift-car sample `drift_fr` on the Narrow Chicane Layout/],
      ['pm.s11.wrongway (ja)', msg('pm.s11.wrongway', 'ja'), /ドリフト車のサンプルを6台並べたナローシケインの公式レースで、1台に最大(\d+)回/],
      ['pm.s11.wrongway (en)', msg('pm.s11.wrongway', 'en'), /up to (\d+) times for one car in an official race with six of the drift-car sample on the Narrow Chicane Layout/],
    ]); }
}

// ── C) 周回（トライアングルの 1 周目）─────────────────────────────────────────────────────
console.log('\nC) 周回の数え方（トライアングルの 1 周目）');
{
  const course = courseMod.buildFromSpec(SPECS.find((s) => s.name === 'トライアングル'));
  dyn.applyRegime('tabletop'); config.setCarScale(1);
  const cl = course.centerline, n = cl.length, seg = [], cum = [0];
  for (let i = 0; i < n; i++) { const a = cl[i], b = cl[(i + 1) % n]; seg.push(Math.hypot(b[0] - a[0], b[1] - a[1])); cum.push(cum[i] + seg[i]); }
  const lapLen = cum[n];
  const at = (s) => { s = ((s % lapLen) + lapLen) % lapLen; let i = 0; while (i < n - 1 && cum[i + 1] <= s) i++; const t = (s - cum[i]) / seg[i], a = cl[i], b = cl[(i + 1) % n]; return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]; };
  // スタートの弧長（中心線への射影）
  let best = Infinity, s0 = 0;
  for (let i = 0; i < n; i++) { const a = cl[i], b = cl[(i + 1) % n]; let t = ((course.start.x - a[0]) * (b[0] - a[0]) + (course.start.y - a[1]) * (b[1] - a[1])) / (seg[i] * seg[i]); t = Math.max(0, Math.min(1, t)); const d = Math.hypot(course.start.x - (a[0] + t * (b[0] - a[0])), course.start.y - (a[1] + t * (b[1] - a[1]))); if (d < best) { best = d; s0 = cum[i] + t * seg[i]; } }
  // 中心線に沿ってスタートから順方向へ走らせ、product の LapTracker が 1 周目・2 周目を数えた道のり
  const tr = new lapMod.LapTracker(course, { persist: false });
  const step = 0.004; let d = 0; const counted = [];
  { const p = at(s0); tr.update(0, p[0], p[1], true); }
  while (d < 2.5 * lapLen && counted.length < 2) { d += step; const p = at(s0 + d); if (tr.update(DT, p[0], p[1], true)) counted.push(d); }
  ok(counted.length === 2 && Math.abs((counted[1] - counted[0]) - lapLen) < 3 * step, `中心線に沿って順方向に走ると、2 周目は 1 周ぶん（${counted.length === 2 ? (counted[1] - counted[0]).toFixed(3) : '—'} m / ${lapLen.toFixed(3)} m）で数える`);
  // 1 周目を数えるまでの道のり first は product の LapTracker の答え。「線の何 m 先か」s0 は中心線の幾何（両者が合うことを下で見る）。
  const first = counted.length ? counted[0] : NaN, Lc = config.CAR.length;
  const pct1 = (100 * first / lapLen).toFixed(0), aheadM = s0.toFixed(3), aheadL = (s0 / Lc).toFixed(1), aheadPct = (100 * s0 / lapLen).toFixed(1);
  ok(Number.isFinite(first) && Math.abs((lapLen - first) - s0) < 3 * step, `1 周目を数えるまでの道のり ${first.toFixed(3)} m ＝ 1 周 ${lapLen.toFixed(3)} m − スタートが線の先にある分 ${s0.toFixed(3)} m（＝1 周の ${(100 * first / lapLen).toFixed(1)}%）`);
  claims('トライアングル（スタートが線の何 m 先・何車長・1 周の長さ・その割合・1 周目の距離の割合）', [aheadM, aheadL, lapLen.toFixed(3), aheadPct, pct1], [
    ['docs/physics_model.md §14.2', MD, /スタートが線の ([\d.]+) m 先\(車体 1× で ([\d.]+) 車長・1 周 ([\d.]+) m の ([\d.]+)%\)にあり、1 周目は (\d+)% の距離/],
  ]);
  claims('トライアングル（英語）', [aheadM, aheadL, aheadPct, lapLen.toFixed(3), pct1], [
    ['docs/physics_model.en.md §14.2', EN, /starts ([\d.]+) m beyond the line \(([\d.]+) car lengths at car scale 1×; ([\d.]+)% of the ([\d.]+) m lap\), so lap 1 is (\d+)% of the distance/],
  ]);
  claims('トライアングルの 1 周目の距離の割合', [pct1], [
    ['usage.s5.lap (ja)', msg('usage.s5.lap', 'ja'), /「トライアングル」は、スタート位置の車で1周目が(\d+)%の距離/],
    ['usage.s5.lap (en)', msg('usage.s5.lap', 'en'), /on "Triangle" lap 1 is (\d+)% of the distance for the car at the start position/],
  ]);
  claims('トライアングル（スタートが線の何車長先・1 周目の割合）', [aheadL, pct1], [
    ['pm.s11.lapcount (ja)', msg('pm.s11.lapcount', 'ja'), /スタートが線の([\d.]+)車長先\(車体1×\)にあり、1周目は(\d+)%の距離/],
    ['pm.s11.lapcount (en)', msg('pm.s11.lapcount', 'en'), /starts ([\d.]+) car lengths \(at car scale 1×\) beyond the line, so lap 1 is (\d+)% of the distance/],
  ]);
  // 6 台のグリッドの各車: 置かれた位置から中心線に沿って走らせ、1 周目を数えるまでの道のりの割合（product の freeSpawn と LapTracker）。
  //   置かれる位置は車体の大きさで変わるので、公式レース・🏁 の車体 1× と、ライブの既定の倍率（index.html の #carScale の value）の両方で測る。
  { const arcOf = (x, y) => { let bst = Infinity, q = 0; for (let i = 0; i < n; i++) { const a = cl[i], b = cl[(i + 1) % n]; let t = ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / (seg[i] * seg[i]); t = Math.max(0, Math.min(1, t)); const dd = Math.hypot(x - (a[0] + t * (b[0] - a[0])), y - (a[1] + t * (b[1] - a[1]))); if (dd < bst) { bst = dd; q = cum[i] + t * seg[i]; } } return q; };
    const liveK = (/id="carScale"[^>]*\bvalue="([\d.]+)"/.exec(fs.readFileSync(path.join(HERE, 'public/index.html'), 'utf8')) || [])[1] || '—';
    const gridFrac = (k) => { dyn.applyRegime('tabletop'); config.setCarScale(k); const occ = [], frac = [];
      for (let i = 0; i < 6; i++) { const sp = fleet.freeSpawn(course, occ, i); occ.push(sp);
        const t2 = new lapMod.LapTracker(course, { persist: false }); t2.update(0, sp.x, sp.y, true);
        const q0 = arcOf(sp.x, sp.y); let dd = 0, f1 = NaN; while (dd < 2 * lapLen && !Number.isFinite(f1)) { dd += step; const pp = at(q0 + dd); if (t2.update(DT, pp[0], pp[1], true)) f1 = dd; }
        frac.push(100 * f1 / lapLen); }
      config.setCarScale(1); return frac; };
    const f1x = gridFrac(1), fLive = gridFrac(+liveK);
    { const capOf = (k) => { dyn.applyRegime('tabletop'); config.setCarScale(k); const v = fleet.capacityOf(course, 6); config.setCarScale(1); return v; };
      ok(capOf(1) === 6 && capOf(+liveK) === 6, `トライアングルには 6 台並ぶ（車体 1× ${capOf(1)} 台・${liveK}× ${capOf(+liveK)} 台）`); }
    console.log(`     トライアングルの 6 台のグリッドの 1 周目の道のり（1 周に対する %）: 車体 1× ${f1x.map((v, i) => `#${i + 1} ${v.toFixed(1)}`).join(' ')} ／ 車体 ${liveK}× ${fLive.map((v, i) => `#${i + 1} ${v.toFixed(1)}`).join(' ')}`);
    const p5 = f1x[4].toFixed(0), p6 = f1x[5].toFixed(0), lo = Math.min(f1x[4], f1x[5]).toFixed(0), hi = Math.max(f1x[4], f1x[5]).toFixed(0);
    ok(Math.abs(+f1x[0].toFixed(0) - +pct1) === 0, `グリッドの 1 番手（スタート位置の車）の 1 周目は、上で測ったスタートからの値と同じ（${f1x[0].toFixed(1)}%）`);
    ok(fLive[4].toFixed(0) === fLive[5].toFixed(0), `ライブの既定の車体 ${liveK}× では 5・6 番手が同じ割合（${fLive[4].toFixed(1)}%・${fLive[5].toFixed(1)}%）`);
    claims('トライアングルの 6 台のグリッドの 5・6 番手の 1 周目（車体 1× の 5 番手・6 番手／ライブの既定の倍率・そのときの割合）', [p5, p6, liveK, fLive[4].toFixed(0)], [
      ['docs/physics_model.md §14.2', MD, /公式レース・🏁 の車体 1× で 5 番手が (\d+)%・6 番手が (\d+)% の距離、ライブの既定の車体 ([\d.]+)× では 5・6 番手とも (\d+)% の距離になります/],
      ['docs/physics_model.en.md §14.2', EN, /at car scale 1× \(official races and 🏁\) the fifth car gets (\d+)% and the sixth (\d+)% of the distance, while at the live default car scale ([\d.]+)× the fifth and sixth both get (\d+)%/],
    ]);
    claims('同（アプリ内・英語: 車体 1× の範囲・ライブの既定のときの割合・その倍率）', [lo, hi, fLive[4].toFixed(0), liveK], [
      ['pm.s11.lapcount (en)', msg('pm.s11.lapcount', 'en'), /the lap-1 distance of the last two cars placed changes with the car size \(where they are placed\): (\d+)–(\d+)% at car scale 1× \(official races and 🏁\), and (\d+)% for both at the live default car scale ([\d.]+)×/],
    ]);
    claims('同（アプリ内・車体 1× のあとから置かれる 2 台の範囲／ライブの既定の倍率・そのときの割合）', [lo, hi, liveK, fLive[4].toFixed(0)], [
      ['pm.s11.lapcount (ja)', msg('pm.s11.lapcount', 'ja'), /あとから置かれる2台の1周目の距離は車体の大きさ\(置かれる位置\)で変わり、公式レース・🏁の車体1×では(\d+)〜(\d+)%、ライブの既定の車体([\d.]+)×では2台とも(\d+)%です/],
    ]); }
  // フィニッシュ線分と正方向が直交するコース: product の LapTracker が側の判定に fx,fy をそのまま使っているコースを数える。
  { let nOrth = 0, nFin = 0;
    for (const s of SPECS) { const c = courseMod.buildFromSpec(s); if (!c.finish) continue;
      const t3 = new lapMod.LapTracker(c, { persist: false }); nFin++;
      if (t3._geo.nx === c.finish.fx && t3._geo.ny === c.finish.fy) nOrth++; }
    claims('フィニッシュ線分と正方向が直交するコース（フィニッシュのある出荷コース・うち直交）', [String(nFin), String(nOrth)], [
      ['docs/physics_model.md §14.2', MD, /直交するコース\(フィニッシュを持つ出荷 (\d+) 本中 (\d+) 本\)/],
    ]);
    claims('同（英語・うち直交・全体）', [String(nOrth), String(nFin)], [
      ['docs/physics_model.en.md §14.2', EN, /are perpendicular \((\d+) of the (\d+) shipped courses that have a finish\)/],
    ]); }
}

// ── D) Python 版サンプル ───────────────────────────────────────────────────────────────
console.log('\nD) Python 版サンプル 3 本（C 版と同じ走りとは限らない）');
{
  const spec = SPECS.find((s) => s.name === 'トライアングル');
  const runOf = (key, mode) => { const p = programs.PROGRAM_BY_KEY[key]; return race.runRace({ course: courseMod.buildFromSpec(spec), regime: 'tabletop', laps: 3, field: [{ name: 'A', lang: p.lang || 'c', src: p.code, carType: p.carType }], crashRule: { rejoin: true, penaltySec: 3 }, interact: true, physics: mode, trace: true }); };
  for (const [ck, pk] of [['normal_fr', 'py_normal_fr'], ['normal_awd', 'py_normal_awd'], ['normal_ff', 'py_normal_ff']]) {
    const diff = ['dynamic', 'standard', 'v2'].filter((mode) => runOf(ck, mode).traceHash !== runOf(pk, mode).traceHash);
    const p = programs.PROGRAM_BY_KEY[pk], c = programs.PROGRAM_BY_KEY[ck];
    const noRev = !/REVERSE/.test(p.code.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')), cRev = /REVERSE/.test(c.code);
    ok(diff.length >= 1 && noRev && cRev, `${pk}: C 版（後退あり）と違う走りになるレースがある（トライアングル・1 台・ペナルティ復帰の 3 エンジン中 ${diff.length} 本）・この版は後退を指令しない`);
    const places = [[`programs.js ${pk} strategy`, p.strategy], [`prog.${pk}.strategy (ja)`, msg(`prog.${pk}.strategy`, 'ja')], [`programs.js ${pk} の冒頭の注記`, p.code.split('\n').slice(0, 6).join('\n')]];
    const miss = places.filter(([, t]) => !/同じとは限(りません|らない)/.test(t)).map(([nm]) => nm);
    const missEn = /does not always drive the same as the C version/.test(msg(`prog.${pk}.strategy`, 'en')) ? [] : [`prog.${pk}.strategy (en)`];
    ok(miss.length + missEn.length === 0, `${pk}: 説明が「走りは C 版と同じとは限らない」と書いている（4 か所）${miss.length + missEn.length ? ' — 無い: ' + [...miss, ...missEn].join('・') : ''}`);
  }
  forbid('「C 版と同一（同じ走り）」という記述が残っていない', /走りは C版と同一|完全に同一 \(=|走行挙動は C 版と同一|driving is identical to the C version/, [...DOC_TEXT, ...PROG_TEXT]);
}

// ── E) 並べられる台数 ─────────────────────────────────────────────────────────────────────
console.log('\nE) 並べられる台数（▶ の経路・ライブの既定の車体の倍率・6 台を指定）');
{
  const liveK = +((/id="carScale"[^>]*\bvalue="([\d.]+)"/.exec(fs.readFileSync(path.join(HERE, 'public/index.html'), 'utf8')) || [])[1]);
  const capOf = (s, mode) => { const regime = s.noRace ? 'fullscale' : 'tabletop'; config.setPhysicsMode(mode); dyn.applyRegime(regime); config.setCarScale(liveK);
    const fx = { regime: (r) => dyn.applyRegime(r), scale: (k) => config.setCarScale(k), sync: () => {}, log: () => {} };
    const v = Math.min(6, fitguard.settleFitRatio(courseMod.buildFromSpec(s), { regime, userK: liveK, slotCount: 6, reason: 'race' }, fx).capN);
    dyn.applyRegime('tabletop'); config.setCarScale(1); return v; };
  const fin = SPECS.filter((s) => courseMod.buildFromSpec(s).finish), MODES = ['dynamic', 'standard', 'v2'];
  const tab = fin.map((s) => [s.name, MODES.map((m) => capOf(s, m))]);
  config.setPhysicsMode('dynamic');
  const all6 = tab.filter(([, v]) => v.every((x) => x === 6)).length, short = tab.filter(([, v]) => v.some((x) => x < 6));
  console.log(`     フィニッシュのある出荷コース ${fin.length} 本: 3 エンジンとも 6 台 ${all6} 本・6 台に届かないエンジンがある ${short.length} 本`);
  ok(short.length >= 1 && short.every(([nm]) => /道幅|フローイング/.test(nm)), `6 台を並べられないことがあるコースがある（${short.length} 本。道幅を詰めた派生コースが中心: ${short.slice(0, 3).map(([nm, v]) => `${nm} ${v.join('/')}`).join('・')} ほか）`);
  ok(all6 / fin.length >= 0.6, `多くのコースは 6 台（3 エンジンとも 6 台が ${all6}/${fin.length} 本＝${(100 * all6 / fin.length).toFixed(0)}% ≥ 60%）`);
  for (const [nm, t, re] of [['rg.rules.body (ja)', msg('rg.rules.body', 'ja'), /道幅の狭いコースでは、6台を並べられないことがあります \(多くのコースは6台\)。/], ['rg.rules.body (en)', msg('rg.rules.body', 'en'), /On courses with a narrow road, 6 cars sometimes cannot be lined up \(most courses take 6\)\./]]) ok(re.test(t), `${nm}: 「狭いコースでは 6 台を並べられないことがある（多くは 6 台）」と書いてある`);
  const nc = tab.find(([nm]) => nm === 'ナローシケイン・レイアウト');
  ok(!!nc && nc[1].every((v) => v === 6), `ナローシケイン・レイアウトは 3 エンジンとも 6 台（${nc ? nc[1].join('/') : '—'}）＝説明に「4 台」と書かない`);
  forbid('「ナローシケインは実態容量 4 台」という記述が残っていない', /ナローシケイン・レイアウト」は実態容量が<b>4台|has a real capacity of <b>4 cars<\/b>/, DOC_TEXT);
}

console.log(`\n${fail === 0 ? '────────── BH6 説明と実測の照合ゲート: 全パス ○ ──────────' : `────────── BH6 ゲート: ✗ ${fail} 件 ──────────`}`);
process.exit(fail === 0 ? 0 : 1);
