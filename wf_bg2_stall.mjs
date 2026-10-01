// wf_bg2_stall.mjs — Stage BG2 常設ゲート: 6 台で走らせると車どうしが詰まって止まる件の改修を固定する。
// ════════════════════════════════════════════════════════════════════════════
// 背景（BG1 実測・2026-10-01）: ライブの ▶ 走行（既定: 動力学・卓上・自動復帰 ON・他車を障害物 ON・Python 版 Apex Hunter）で、
//   出荷 66＋上流の投稿 2 コースのうち 61 コースで、止まったまま動かない車が出た（動力学 6 台・120 秒で 1 回あたり平均 1.72 台）。
//   仕組みは 2 つ: ①動力学・classic の車どうしの接触は「位置を取り消してその場で止める」だけで切り返さず、押し合った車は
//   永久に待ち、重なった（融着した）車はどの向きの一歩も取り消された ②ゴール・完走・リタイアした車が障害物として残った。
//   裁定 A で fleet.js に ESCAPE（重なりの面積を増やさない動きは通す）・STUCK（前進が車に阻まれて動けなければ壁と同じ切り返し）を足し、
//   ゴール・完走・リタイアした車を他車のセンサーと衝突の相手から外した（v2 の接触計算を含む）。注記は fleet.js isRetired /
//   integrateSlot の直前。
//
// 停止の測定述語（BG1 で固定・変えない）: 観測の終わりの W=10 秒の窓（始点は走行開始から 30 秒以降）で、窓の始点の位置からの
//   最大変位が車長 CAR.length 未満のまま、かつ crashed でなく、ゴールしていない車。ライブの観測は 120 秒（窓 [110,120]）。
//
// 検査:
//   A) 代表セル（ライブ）: 発端の「サンプル8の字風」6 台（上流の投稿コースの写し wf_bg2_fig8_course.json）と峠 6 台で、
//      停止車が上限以下。改修前のツリーでは同じセルで止まる（下の数字は改修前の実測）。
//   B) 縮小母集団（ライブ・6 台・sdt 名目・68 コースの 1 つおき）: 周回コース・峠ごとに 1 回あたり平均停止台数が上限以下。
//      上限は同じ部分集合での改修前と改修後の実測の中間（受け入れ基準の判定は母集団で行った＝同じ統計量ではない）。
//   C) 公式レース: 凍結記録 f1 の構成（卓上オーバル 2 台・ペナルティ復帰）で 2 台とも完走（改修前は完走車が障害物に
//      なって 1 台しか完走しない）・6 台の代表レースで完走台数が下限以上（改修前は完走車・リタイア車・詰まりで届かない）。
//   D) 部品の単体検査: ESCAPE（十字・同心の重なりから軸に斜めの姿勢でも抜けられる＝BG1 層 4 L4・BG2 層 4 A-1／重なりを
//      増やす動きと、深く刺さった追突の通り抜けは取り消す＝A-3）・STUCK（窓の長さ・自動復帰 OFF/走行していない車では働かない・
//      後退中/下り坂の惰行で阻まれた車には仕込まない・前進と惰行を切り替えるプログラムでも働く＝A-2・阻んだ車が去った車／窓の
//      中で動けた車／切り返し中の車／後ろの車に阻まれた前進には仕込まない＝2 回目のレビュー M3/M4・car.reset で窓が消える＝L5・
//      v2 の _stuckT も消える）・外した車（他車から見えない・自分も他車と当たらない・壁とは当たる・v2 の接触を作らない・
//      リタイア規則の DNF 車にも印が立つ）。
//   E) 1 台走行の不変: 毎 tick 全状態の traceHash と、ライブ 1 台の毎フレームの軌跡を、改修前のツリーで取った値と突き合わせる
//      （各部品は他車がいるときにしか働かない＝1 台の走りは 1 ビットも変わらない）。
//   F) 構造検査: main.js のライブ経路（integrateLive・frame・render）が fleetEdges を名前空間 import で「あれば使う」形で
//      呼んでいること（本ゲートのライブ経路は main.js の写しなので、本物が写しと同じ外し方をしていることをここで固定する）・
//      race_engine が完走/リタイアで印を立てて外していること・contact_v2 が外した車の組を作らないこと。
//   G) 変異試験: 部品を 1 つずつ外した product の写し（一時ツリー）で A)/C)/D) のどれかが赤になること。
//
// 使い方: node wf_bg2_stall.mjs           … 検査（本ホスト実測の所要は末尾に印字）
//         node wf_bg2_stall.mjs --root <dir> … <dir>/public/js の product で A)〜C) を回す（改修前ツリーで赤になることの確認用。
//                                             D)〜G) は改修後の名前を使うので回さない）
// exit: 0=全緑 / 1=いずれか赤。
// ════════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { pathToFileURL, fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rootIdx = process.argv.indexOf('--root');
const ROOT = rootIdx >= 0 ? path.resolve(process.argv[rootIdx + 1]) : HERE;
const PRODUCT_ONLY = rootIdx >= 0;   // 改修前ツリーでは A)〜C) だけ
const JS_DIR = path.join(ROOT, 'public/js');
const T0 = Date.now();

let fail = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? '○' : '✗'} ${msg}`); if (!cond) fail++; return cond; };

// ── モジュール一式（product か、変異を入れた一時ツリー）──────────────────────────
async function loadMods(jsDir) {
  const u = (f) => pathToFileURL(path.join(jsDir, f)).href;
  const [fleet, physics, config, course, runner, api, programs, fitguard, race, dyn, fnv] = await Promise.all(
    ['fleet.js', 'physics.js', 'config.js', 'course.js', 'runner.js', 'api.js', 'programs.js', 'fitguard.js', 'race_engine.js', 'physics_dyn.js', 'fnv1a.js'].map((f) => import(u(f))));
  return { fleet, physics, config, course, runner, api, programs, fitguard, race, dyn, fnv };
}

// ── コース ──────────────────────────────────────────────────────────────────────
const SPECS = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/courses.json'), 'utf8'));
// 発端のコース: 上流の投稿コース（RumiCar-group の例示コース）の写し。取得 2026-10-01T04:59:18Z・sha256 は下で照合する。
const FIG8_FILE = path.join(HERE, 'wf_bg2_fig8_course.json');
const FIG8_SHA = '3d29879ba871f340176e07f90e6d7d90432ff56a0bdd07fef0d80bab586794bf';
const FIG8 = 'サンプル8の字風 (コミュニティ例)';
function courseOf(M, name) {
  if (name === FIG8) {
    const r = M.course.acceptCourseData(JSON.parse(fs.readFileSync(FIG8_FILE, 'utf8')), { own: false });   // ライブの投稿コースと同じ入口
    if (!r.ok) throw new Error('8 の字の写しが取り込みで拒否: ' + r.why);
    return r.course;
  }
  const s = SPECS.find((x) => x.name === name);
  if (!s) throw new Error('出荷コースに無い: ' + name);
  return M.course.buildFromSpec(s);
}
const regimeOf = (name) => { const s = SPECS.find((x) => x.name === name); return (s && s.noRace) ? 'fullscale' : 'tabletop'; };
const isTouge = (name) => { const s = SPECS.find((x) => x.name === name); return !!(s && s.kind === 'touge'); };

// ── ライブの ▶ 走行（main.js startAuto → frame の走行中・非ポーズ分岐 → integrateLive の写し）──────────
// 呼ぶ関数はすべて product（fleet/runner/api/fitguard）。写しが本物と同じことは BG1 で実ブラウザの rAF 時刻列を再生して
// 確かめた（11 本で全車の位置差 0.000 mm・docs は internal の stage_bg/bg1）。外し方が本物と同じことは F) で固定する。
const STOP = { W: 10 }, LIVE_SEC = 120;   // 窓 = 観測の終わりの W 秒 (120 秒観測なので始点 110 秒＝BG1 の「T=30 秒以降」を満たす)
const SDT_NOMINAL = (1 / 60) * 3;   // 60 fps × 速度 3×（UI 既定）
// sdt 列: V0 = 名目（▶ 直後の 2 フレーム目は容量プローブの実走で長い＝上限 0.05 s に丸めた 0.15）・VA/VB = 実ブラウザで見た
//   フレームの揺れ（16.5〜16.8 ms・負荷で 33 ms が混ざる）を周期で真似た列。式は main.js frame() と同じ sdt = 3 × min(0.05, Δt)。
const SDT = {
  V0: (k) => (k === 1 ? 0.15 : SDT_NOMINAL),
  VA: (k) => (k === 1 ? 0.15 : 3 * Math.min(0.05, [16.6, 16.7, 16.6, 33.3][k % 4] / 1000)),
  VB: (k) => (k === 1 ? 0.15 : 3 * Math.min(0.05, [16.5, 16.8, 16.8, 16.5, 16.7][k % 5] / 1000)),
};
function fleetEdgesOf(M, sl) {   // main.js の fleetEdgesOf と同じ
  return typeof M.fleet.fleetEdges === 'function' ? M.fleet.fleetEdges(sl) : sl.map((s) => M.physics.carEdges(s.car));
}
function liveSetup(M, { name, n, mode, userK = 0.8, progKey = 'py_normal_fr' }) {
  const { config, dyn, fleet, fitguard, programs, runner, api } = M;
  config.SENSOR_NOISE.on = false;
  const course = courseOf(M, name);
  const regime = regimeOf(name);
  config.setPhysicsMode(mode);
  dyn.applyRegime(regime);
  config.setCarScale(userK);
  // フィットガード（main.js enforceFitRatio('race') の判定コア＝product の settleFitRatio）
  const fx = { regime: (r) => dyn.applyRegime(r), scale: (k) => config.setCarScale(k), sync: () => {}, log: () => {} };
  const fit = fitguard.settleFitRatio(course, { regime, userK, slotCount: n, reason: 'race' }, fx);
  const nUse = Math.min(n, fit.capN);
  const prog = programs.PROGRAM_BY_KEY[progKey];
  const slots = [];
  for (let i = 0; i < nUse; i++) slots.push(fleet.makeSlot({ i, lang: prog.lang, src: prog.code, course, slotCount: slots.length, logFor: () => () => {}, persist: false }));
  fleet.rebuildSpawns(slots, course, null, { persist: false });   // startAuto
  for (const s of slots) {
    s.car.reset(s.spawn);
    s.world._pendingDelay = 0; s.world._others = [];
    s.hostEnv = api.buildApi(s.world);
    s.lap.reset(course, { carType: s.carType, tire: s.world.tire, wear: s.world.wear, gear: s.world.gear, persist: false });
    s.controller = runner.buildController(s.src, s.lang, s.hostEnv);
    s.controller.setup();
    s.running = true; s.loopTimer = 0;
  }
  return { M, course, slots, nUse, t: 0, frames: 0 };
}
function liveFrame(L, sdt) {
  const { M, slots, course } = L;
  const { fleet, config } = M;
  const edges = fleetEdgesOf(M, slots);
  slots.forEach((s, i) => {
    if (!s.running) return;
    s.loopTimer -= sdt;
    if (s.loopTimer <= 0) {
      fleet.tickSlot(s, fleet.othersFor(edges, i, true));
      s.loopTimer += (1 / config.SIM.loopHz) + (s.world._pendingDelay || 0) / 1000;
    }
  });
  fleet.applyStartGate(slots, true);
  if (config.PHYSICS.mode === 'v2') fleet.integrateFleetV2(slots, sdt, course.walls, true, true);
  else {
    const max = slots.length > 1 ? (1 / config.SIM.loopHz) : sdt;
    let rem = sdt;
    while (rem > 1e-6) {
      const step = Math.min(max, rem);
      const e = fleetEdgesOf(M, slots);
      slots.forEach((s, i) => fleet.integrateSlot(s, step, fleet.othersFor(e, i, true), course.walls, true));
      rem -= step;
    }
  }
  L.t += sdt; L.frames++;
}
// 停止車の数（BG1 の述語）。null = フィットガードが台数を減らした（比べられないセル）。
function liveStopped(M, opts, sdtOf = SDT.V0) {
  const L = liveSetup(M, opts);
  if (L.nUse < opts.n) return null;
  const carLen = M.config.CAR.length;
  const W0 = LIVE_SEC - STOP.W;
  let start = null; const maxD = new Array(L.slots.length).fill(0);
  while (L.t < LIVE_SEC - 1e-9) {
    liveFrame(L, sdtOf(L.frames));
    if (L.t >= W0 - 1e-9) {
      if (!start) start = L.slots.map((s) => ({ x: s.car.x, y: s.car.y }));
      L.slots.forEach((s, i) => { const d = Math.hypot(s.car.x - start[i].x, s.car.y - start[i].y); if (d > maxD[i]) maxD[i] = d; });
    }
  }
  return L.slots.filter((s, i) => !s.car.crashed && !(s.lap.touge && s.lap.finished) && maxD[i] < carLen).length;
}

// ════════════════════════════════════════════════════════════════════════════
const P = await loadMods(JS_DIR);
console.log(`wf_bg2_stall — 車どうしの詰まりと、ゴール・完走・リタイアした車の扱い（Stage BG2）  product=${path.relative(process.cwd(), JS_DIR) || JS_DIR}`);
{
  const sha = crypto.createHash('sha256').update(fs.readFileSync(FIG8_FILE)).digest('hex');
  ok(sha === FIG8_SHA, `8 の字の写し wf_bg2_fig8_course.json の sha256 が上流の取得物と一致 (${sha.slice(0, 8)}…)`);
}

// ── A) 代表セル ──────────────────────────────────────────────────────────────────
// before = 改修前ツリー（公開 7026bd9・v8.9.0）で本ゲートの同じ手順を回した実測（`--root` で改修前の public/js を指して取得）。
// 上限は改修後の実測に合わせず、「止まる車が出ない（0 台）」を代表セルの約束にする。8 の字 classic の V0/VB は改修前も 0 台
// （sdt の揺れで止まる回と止まらない回がある＝BG1 §2）なので回帰の見張りだけで、改修の効果は VA と他のセルで見る。
const CELLS = [
  {
    "name": "サンプル8の字風 (コミュニティ例)",
    "mode": "dynamic",
    "v": "V0",
    "max": 0,
    "before": 6
  },
  {
    "name": "サンプル8の字風 (コミュニティ例)",
    "mode": "dynamic",
    "v": "VA",
    "max": 0,
    "before": 6
  },
  {
    "name": "サンプル8の字風 (コミュニティ例)",
    "mode": "dynamic",
    "v": "VB",
    "max": 0,
    "before": 6
  },
  {
    "name": "サンプル8の字風 (コミュニティ例)",
    "mode": "standard",
    "v": "V0",
    "max": 0,
    "before": 0
  },
  {
    "name": "サンプル8の字風 (コミュニティ例)",
    "mode": "standard",
    "v": "VA",
    "max": 0,
    "before": 6
  },
  {
    "name": "サンプル8の字風 (コミュニティ例)",
    "mode": "standard",
    "v": "VB",
    "max": 0,
    "before": 0
  },
  {
    "name": "峠② タイトヘアピン (急な下り)〔道幅 3 台分〕",
    "mode": "dynamic",
    "v": "V0",
    "max": 0,
    "before": 4
  },
  {
    "name": "峠② タイトヘアピン (急な下り)〔道幅 3 台分〕",
    "mode": "standard",
    "v": "V0",
    "max": 0,
    "before": 6
  }
];
console.log('\nA) 代表セル（ライブ・6 台・120 秒・BG1 の停止述語）');
const cellResult = [];
for (const c of CELLS) {
  const got = liveStopped(P, { name: c.name, n: 6, mode: c.mode }, SDT[c.v]);
  cellResult.push(got);
  ok(got !== null && got <= c.max, `${c.name} ${c.mode} ${c.v}: 停止車 ${got === null ? '（フィットガードが台数を減らした）' : got} ≤ ${c.max}（改修前 ${c.before}）`);
}

// ── B) 縮小母集団 ────────────────────────────────────────────────────────────────
// 出荷＋投稿の 68 コースから 1 つおきに選んだ 34 コース（投稿は 8 の字のみ・race 用の 1 本は治具に無いので除く）× classic/動力学 ×
// 6 台 × sdt 名目。**上限はこの部分集合での改修前と改修後の実測のあいだ（改修前の 5〜7 割）に置いた**（改修前ツリー 7026bd9:
// classic 周回 1.158・峠 3.000／動力学 周回 1.150・峠 2.571、改修後 2026-10-02: 0.158・0.000／0.350・0.000）。受け入れ基準の
// 判定は 68 コース × sdt 3 通りの母集団で行った（同じ統計量ではない・internal の BG2 決定ログ）。ここは回帰の検出が目的。
const POP = [
  "オーバル",
  "ヘアピン",
  "S字シケイン",
  "ナローゲート",
  "丸の中の四角",
  "六角と三角",
  "テクニカル周回 (簡易)",
  "ロングオーバル",
  "トライアングル",
  "エッセ・レイアウト",
  "フローイング・レイアウト",
  "ロングストレート・レイアウト",
  "ツイスティ・レイアウト",
  "モダン・レイアウト",
  "ナローシケイン・レイアウト",
  "峠① 中速ヘアピン (緩い下り)",
  "峠③ 高速ヘアピン (大R下り)",
  "ウェットS字 (雨)",
  "架空峠 ロング・ワインディング(中斜面)",
  "ドリフト広場 (ショー会場)",
  "競技サーキット (フルスケール)",
  "峠① 中速ヘアピン (緩い下り)〔道幅 3 台分〕",
  "峠② タイトヘアピン (急な下り)〔道幅 4.5 台分〕",
  "峠② タイトヘアピン (急な下り)〔道幅 2 台分〕",
  "峠③ 高速ヘアピン (大R下り)〔道幅 3 台分〕",
  "架空峠 ロング・ワインディング(緩斜面)〔道幅 4.5 台分〕",
  "架空峠 ロング・ワインディング(緩斜面)〔道幅 2 台分〕",
  "架空峠 ロング・ワインディング(中斜面)〔道幅 3 台分〕",
  "架空峠 ロング・ワインディング(激坂)〔道幅 4.5 台分〕",
  "架空峠 ロング・ワインディング(激坂)〔道幅 2 台分〕",
  "舵角限界ベンチ R_out/R_min=0.95〔道幅 2 台分〕",
  "舵角限界ベンチ R_out/R_min=0.8〔道幅 2 台分〕",
  "舵角限界ベンチ R_out/R_min=0.95〔道幅 3.5 台分〕",
  "サンプル8の字風 (コミュニティ例)"
];
const LIM = { standard: { loop: 0.7, touge: 1.5 }, dynamic: { loop: 0.8, touge: 1.2 } };
console.log(`\nB) 縮小母集団（${POP.length} コース × classic/動力学 × 6 台 × sdt 名目）`);
for (const mode of ['standard', 'dynamic']) {
  const acc = { loop: [0, 0], touge: [0, 0] };
  for (const name of POP) {
    const got = liveStopped(P, { name, n: 6, mode });
    if (got === null) continue;   // フィットガードが台数を減らしたセルは比べない（BG1 と同じ）
    const g = isTouge(name) ? 'touge' : 'loop';
    acc[g][0] += got; acc[g][1]++;
  }
  for (const g of ['loop', 'touge']) {
    const m = acc[g][0] / Math.max(1, acc[g][1]);
    ok(acc[g][1] > 0 && m <= LIM[mode][g] + 1e-12, `${mode} ${g === 'loop' ? '周回' : '峠'}: 1 回あたり平均停止 ${m.toFixed(3)} ≤ ${LIM[mode][g].toFixed(2)}（${acc[g][1]} 走・停止 ${acc[g][0]} 台）`);
  }
}

// ── C) 公式レース ────────────────────────────────────────────────────────────────
console.log('\nC) 公式レース（race_engine.runRace）');
const progOf = (M, key) => M.programs.PROGRAMS.find((x) => x.key === key);
function f1Race(M) {
  const oval = M.course.buildFromSpec({ name: 'オーバル', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
  const field = ['normal_ff', 'normal_fr'].map((k, i) => { const p = progOf(M, k); return { name: 'C' + i, lang: p.lang || 'c', src: p.code, carType: p.carType, rear: false, encoder: false }; });
  return M.race.runRace({ report: true, course: oval, laps: 2, field, crashRule: { rejoin: true, penaltySec: 3 } });
}
{
  const r = f1Race(P);
  ok(r.finishers.length === 2, `凍結記録 f1 の構成（卓上オーバル 2 台・2 周・ペナルティ復帰）で完走 ${r.finishers.length}/2（改修前は完走車が障害物に残り 1/2）`);
}
// リタイア規則の DNF 車にも印が立つ（race_engine が s.retired を立てる 2 か所の片方）。全車が壁でリタイアする舵角限界ベンチ
// （R_out/R_min=0.95・道幅 2 台分）で、レースの終わりにクラッシュした車すべてが外れていること（runRace の観測口 probe で読む）。
function dnfRetired(M) {
  M.config.SENSOR_NOISE.on = false;
  const spec = SPECS.find((x) => x.bench && x.ratioOutMin === 0.95 && /2 台分/.test(x.name));
  const course = M.course.buildFromSpec(spec);
  const p = M.programs.PROGRAM_BY_KEY.normal_fr;
  const field = Array.from({ length: 3 }, (_, i) => ({ name: 'C' + i, lang: p.lang || 'c', src: p.code, carType: p.carType }));
  let last = null;
  const r = M.race.runRace({ course, laps: 3, field, crashRule: { rejoin: false, penaltySec: 3 }, interact: true, probe: (tick, slots) => { last = slots; } });
  const crashed = last.filter((s) => s.car.crashed);
  return { dnf: r.dnf.filter((d) => d.reason === 'crash').length, crashed: crashed.length, marked: crashed.filter((s) => s.retired === true).length };
}
const RACES = [
  {
    "name": "サンプル8の字風 (コミュニティ例)",
    "mode": "standard",
    "rejoin": false,
    "min": 5,
    "before": 1
  },
  {
    "name": "複合コーナー",
    "mode": "dynamic",
    "rejoin": true,
    "min": 5,
    "before": 1
  },
  {
    "name": "峠② タイトヘアピン (急な下り)〔道幅 2 台分〕",
    "mode": "standard",
    "rejoin": false,
    "min": 5,
    "before": 1
  }
];
{
  const d = dnfRetired(P);
  ok(d.dnf > 0 && d.crashed === d.dnf && d.marked === d.crashed, `リタイア規則の DNF 車は外れる（DNF ${d.dnf} 台・クラッシュ ${d.crashed} 台・印 ${d.marked} 台）`);
}
function raceFinishers(M, c) {
  M.config.SENSOR_NOISE.on = false;
  const course = courseOf(M, c.name);
  const p = M.programs.PROGRAM_BY_KEY.py_normal_fr;
  const field = Array.from({ length: 6 }, (_, i) => ({ name: 'C' + i, lang: p.lang, src: p.code, carType: p.carType }));
  return M.race.runRace({ course, regime: regimeOf(c.name), laps: 3, field, crashRule: { rejoin: c.rejoin, penaltySec: 3 }, interact: true, physics: c.mode }).finishers.length;
}
for (const c of RACES) {
  const got = raceFinishers(P, c);
  ok(got >= c.min, `${c.name} ${c.mode} ${c.rejoin ? 'ペナルティ復帰' : 'リタイア'} 6 台: 完走 ${got} ≥ ${c.min}（改修前 ${c.before}）`);
}

if (PRODUCT_ONLY) finish();

// ── D) 部品の単体検査 ────────────────────────────────────────────────────────────
// 壁の無い広い場所に 2 台を置き、integrateSlot / integrateFleetV2 を直接呼ぶ（呼び出しは本物と同じ 1/60 秒刻み）。
function partsChecks(M, say) {
  const { fleet, config, physics, dyn } = M;
  const res = {};
  config.SENSOR_NOISE.on = false; dyn.applyRegime('tabletop'); config.setCarScale(1);
  const L = config.CAR.length, Wd = config.CAR.width;
  const open = { name: 'open', bounds: { w: 20, h: 20 }, walls: [], start: { x: 10, y: 10, theta: 0 } };
  const mk = (i, pose) => {
    const s = fleet.makeSlot({ i, lang: 'c', src: 'void setup(){} void loop(){}', course: open, slotCount: 2, logFor: () => () => {}, persist: false });
    s.car.reset(pose); s.running = true; s.spawn = pose;
    return s;
  };
  const drive = (s, dir, pwm = 200) => { s.car.driveDir = dir; s.car.pwm = pwm; s.car.steer = config.CONST.CENTER; };
  const h = 1 / config.SIM.physicsHz;
  const C = config.CONST;
  // 4 隅の中心 (後輪軸中心からずれる) を (cx,cy) に置く姿勢
  const poseAt = (cx, cy, th) => { const off = (L - config.CAR.rearToBack) - L / 2; return { x: cx - off * Math.cos(th), y: cy - off * Math.sin(th), theta: th }; };
  for (const mode of ['standard', 'dynamic']) {
    config.setPhysicsMode(mode);
    // D1 ESCAPE: 十字の重なり（中心が同じ・直交）とほぼ同心の重なりから、前進で抜けられる。軸に斜めの姿勢も試す
    //   （面積が変わらない平行移動でも丸めで数 ulp ずれ、許容なしだと「増えた」と判定されて動けなかった＝BG2 層 4 A-1）。
    //   四隅の深さで測ると十字・同心では 0 になって働かない（BG1 層 4 L4）。
    const TH = [0, 0.3, 1.0, 2.5];
    res[`escapeCross_${mode}`] = []; res[`escapeSame_${mode}`] = [];
    for (const th of TH) {
      const c = Math.cos(th), sn = Math.sin(th);
      const A = mk(0, poseAt(10, 10, th)), B = mk(1, poseAt(10, 10, th + Math.PI / 2));
      const x0 = A.car.x, y0 = A.car.y;
      for (let k = 0; k < 60; k++) { drive(A, C.FORWARD); fleet.integrateSlot(A, h, physics.carEdges(B.car), [], true); }
      res[`escapeCross_${mode}`].push(Math.hypot(A.car.x - x0, A.car.y - y0));
      const A2 = mk(0, poseAt(10, 10, th)), B2 = mk(1, poseAt(10 - 0.02 * L * c - 0.05 * Wd * sn, 10 - 0.02 * L * sn + 0.05 * Wd * c, th));
      const x2 = A2.car.x, y2 = A2.car.y;
      for (let k = 0; k < 90; k++) { drive(A2, C.FORWARD); fleet.integrateSlot(A2, h, physics.carEdges(B2.car), [], true); }
      res[`escapeSame_${mode}`].push(Math.hypot(A2.car.x - x2, A2.car.y - y2));
    }
    // D1b 重なりを増やす動きは取り消す: A の鼻先が B の横腹に刺さった T の重なり。前進は重なりが増えるので取り消される。
    {
      const A = mk(0, poseAt(10, 10, 0)), B = mk(1, poseAt(10 + 0.5 * L + 0.3 * Wd, 10, Math.PI / 2));
      const before = physics.checkCollision(A.car, [], physics.carEdges(B.car));
      const x0 = A.car.x;
      for (let k = 0; k < 30; k++) { drive(A, C.FORWARD); fleet.integrateSlot(A, h, physics.carEdges(B.car), [], false); }
      res[`deepenT_${mode}`] = { overlapped: before, moved: A.car.x - x0 };
    }
    // D1c 深く刺さった追突（同じ向き・横に半車幅ずれ・縦に 45 mm）。前進では相手を通り抜けない（最小分離距離で測ると
    //   小さい方の幅で頭打ちになり通り抜けた＝BG2 層 4 A-3）。後退なら重なりが減るので抜けられる。
    {
      const A = mk(0, poseAt(10, 10, 0)), B = mk(1, poseAt(10 + L - 0.045, 10 + 0.5 * Wd, 0));
      const x0 = A.car.x;
      for (let k = 0; k < 60; k++) { drive(A, C.FORWARD); fleet.integrateSlot(A, h, physics.carEdges(B.car), [], false); }
      const fwd = A.car.x - x0;
      const A2 = mk(0, poseAt(10, 10, 0)), B2 = mk(1, poseAt(10 + L - 0.045, 10 + 0.5 * Wd, 0));
      const x2 = A2.car.x;
      for (let k = 0; k < 60; k++) { drive(A2, C.REVERSE); fleet.integrateSlot(A2, h, physics.carEdges(B2.car), [], false); }
      res[`rearEnd_${mode}`] = { fwd, rev: A2.car.x - x2 };
    }
    // D2 STUCK: 正面で接した 2 台（隙間 1 mm）。A は前進指令のまま。窓 1.2 秒の前は切り返さず、後は切り返す。
    {
      const gap = 0.001;
      const A = mk(0, poseAt(10, 10, 0)), B = mk(1, poseAt(10 + L + gap, 10, Math.PI));
      let armedAt = null, openedAt = null;
      for (let k = 1; k <= 150; k++) {
        drive(A, C.FORWARD); fleet.integrateSlot(A, h, physics.carEdges(B.car), [], true);
        if (openedAt == null && A.car._ccOn) openedAt = k;   // 最初に車どうしの接触で取り消された呼び出し
        if (armedAt == null && A.car.recoverT > 0) armedAt = k;
      }
      // 窓の長さ = 取り消された呼び出しから切り返しを仕込んだ呼び出しまで (その呼び出し自身の dt を含む)
      res[`stuckArm_${mode}`] = (armedAt != null && openedAt != null) ? (armedAt - openedAt + 1) * h : null;
      const A2 = mk(0, poseAt(10, 10, 0)), B2 = mk(1, poseAt(10 + L + gap, 10, Math.PI));
      let armedOff = false;
      for (let k = 1; k <= 180; k++) { drive(A2, C.FORWARD); fleet.integrateSlot(A2, h, physics.carEdges(B2.car), [], false); if (A2.car.recoverT > 0) armedOff = true; }
      res[`stuckOff_${mode}`] = armedOff;
      const A3 = mk(0, poseAt(10, 10, 0)), B3 = mk(1, poseAt(10 + L + gap, 10, Math.PI));
      A3.running = false;
      let armedIdle = false;
      for (let k = 1; k <= 180; k++) { drive(A3, C.FORWARD); fleet.integrateSlot(A3, h, physics.carEdges(B3.car), [], true); if (A3.car.recoverT > 0) armedIdle = true; }
      res[`stuckIdle_${mode}`] = armedIdle;
      // 後退中に後ろの車に阻まれた車には仕込まない (切り返しは後退＝後退へ後退を重ねると回数だけ積もって諦める)
      const A5 = mk(0, poseAt(10, 10, 0)), B5 = mk(1, poseAt(10 - L - gap, 10, 0));
      const x5 = A5.car.x;
      let armedRev = false;
      for (let k = 1; k <= 180; k++) { drive(A5, C.REVERSE); fleet.integrateSlot(A5, h, physics.carEdges(B5.car), [], true); if (A5.car.recoverT > 0) armedRev = true; }
      // 後ろの車に届いた＝隙間のぶん (0 より大きく gap 以下) 下がって止まっている
      res[`stuckRev_${mode}`] = { armed: armedRev, back: x5 - A5.car.x, gap };
      // 前進と惰行を半周期 c 秒で切り替えるプログラムでも、阻まれて動けていなければ切り返す（BG2 層 4 A-2・3 回目 A-1:
      //   窓の満了が惰行の側に当たり続ける周期 0.3/0.6 秒〔レース刻み〕・0.2〜0.6 秒〔ライブ刻み 0.05 秒〕で、保留しない版は
      //   30 秒間一度も切り返さなかった）。レース刻み 1/60 秒とライブ刻み 0.05 秒の両方で、10 秒以内に 1 回以上。
      res[`stuckToggle_${mode}`] = [];
      for (const [dtT, cT] of [[h, 0.1], [h, 0.3], [h, 0.6], [0.05, 0.2], [0.05, 0.3], [0.05, 0.6]]) {
        const A6 = mk(0, poseAt(10, 10, 0)), B6 = mk(1, poseAt(10 + L + 0.0001, 10, Math.PI));
        let armsToggle = 0, prevT = 0, tt = 0;
        while (tt < 10) {
          const fwd = Math.floor(tt / cT + 1e-9) % 2 === 0;
          if (A6.car.recoverT <= 0) { if (fwd) drive(A6, C.FORWARD); else drive(A6, C.FREE, 0); }
          fleet.integrateSlot(A6, dtT, physics.carEdges(B6.car), [], true);
          if (A6.car.recoverT > prevT + 1e-9) armsToggle++;
          prevT = A6.car.recoverT; tt += dtT;
        }
        res[`stuckToggle_${mode}`].push({ race: dtT === h, c: cT, arms: armsToggle });
      }
      // ライブの外側 dt (0.05 秒) で呼んでも窓の長さは 1.2 秒（窓の時刻はサブステップでなく呼び出しの dt で進む）。
      {
        const A12 = mk(0, poseAt(10, 10, 0)), B12 = mk(1, poseAt(10 + L + 0.0001, 10, Math.PI));
        let op = null, ar = null;
        for (let k = 1; k <= 80; k++) {
          drive(A12, C.FORWARD); fleet.integrateSlot(A12, 0.05, physics.carEdges(B12.car), [], true);
          if (op == null && A12.car._ccOn) op = k;
          if (ar == null && A12.car.recoverT > 0) ar = k;
        }
        res[`stuckLiveDt_${mode}`] = (op != null && ar != null) ? (ar - op + 1) * 0.05 : null;
      }
      // 阻んだ車が去ったら仕込まない（BG2 層 4 2 回目 M3）: 0.3 秒阻まれた後に前の車が消え、(a) 自分のプログラムが止める
      //   (b) 前進を続けて走り去る。どちらも窓の終わりの時点では阻まれていない。
      for (const after of ['stop', 'go']) {
        const A7 = mk(0, poseAt(10, 10, 0)), B7 = mk(1, poseAt(10 + L + gap, 10, Math.PI));
        let armed7 = false, opened7 = false;
        for (let k = 1; k <= 120; k++) {
          const gone = k > 18;
          if (after === 'stop' && gone) drive(A7, C.FREE, 0); else drive(A7, C.FORWARD);
          fleet.integrateSlot(A7, h, gone ? [] : physics.carEdges(B7.car), [], true);
          if (A7.car._ccOn) opened7 = true;
          if (A7.car.recoverT > 0) armed7 = true;
        }
        res[`stuckGone_${after}_${mode}`] = { opened: opened7, armed: armed7 };
      }
      // 窓の中で動けた車には仕込まない（stuckEps の判定）: 0.3 秒阻まれた後に前の車が 2 車長先へ退き、A が前進して
      //   0.5 車長以上進んだところで、窓の終わりの直前にまた前の車に阻まれる。窓の始点からは動けているので仕込まない。
      {
        const A8 = mk(0, poseAt(10, 10, 0)), B8 = mk(1, poseAt(10 + L + gap, 10, Math.PI));
        let armed8 = false;
        const xs = A8.car.x;
        for (let k = 1; k <= 75; k++) {
          if (k === 19) B8.car.reset(poseAt(10 + 3 * L, 10, Math.PI));
          if (k === 62) {   // A の鼻先のすぐ前へ戻す
            const c = A8.car.corners();
            const fx = 0.5 * (c[0].x + c[1].x);
            B8.car.reset(poseAt(fx + 0.5 * L + 0.0005, 10, Math.PI));
          }
          drive(A8, C.FORWARD);
          fleet.integrateSlot(A8, h, physics.carEdges(B8.car), [], true);
          if (A8.car.recoverT > 0) armed8 = true;
        }
        res[`stuckMoved_${mode}`] = { armed: armed8, moved: A8.car.x - xs, eps: 0.5 * L };
      }
      // 切り返し中には仕込まない: 1.1 秒阻まれ続けたところで壁の切り返しが始まった (recoverT を立てる) とする。
      {
        const A9 = mk(0, poseAt(10, 10, 0)), B9 = mk(1, poseAt(10 + L + gap, 10, Math.PI));
        for (let k = 1; k <= 80; k++) {
          if (k === 66) { A9.car.recoverT = 0.5; A9.car.recoverSteer = C.CENTER; }
          else if (A9.car.recoverT <= 0) drive(A9, C.FORWARD);
          fleet.integrateSlot(A9, h, physics.carEdges(B9.car), [], true);
        }
        res[`stuckDuringRecover_${mode}`] = A9.car.recoverN || 0;
      }
      // 前進指令でない車には仕込まない: 下り坂 (downhill) を惰行で転がって前の車へ押し付けられ続ける車。プログラムは止めて
      //   いるので、後退を仕込むとプログラムの意図に反する (後ろの車へ下がる経路は「前の車に阻まれたとき」で別に防いでいる)。
      {
        const A11 = mk(0, poseAt(10, 10, 0)), B11 = mk(1, poseAt(10 + L + gap, 10, Math.PI));
        A11.car.downhill = 2.0; A11.car.slopeDir = 0;
        let armed11 = false, rejected11 = 0;
        for (let k = 1; k <= 150; k++) {
          drive(A11, C.FREE, 0);
          const x0 = A11.car.x;
          fleet.integrateSlot(A11, h, physics.carEdges(B11.car), [], true);
          if (A11.car.x === x0) rejected11++;
          if (A11.car.recoverT > 0) armed11 = true;
        }
        res[`stuckCoast_${mode}`] = { armed: armed11, rejected: rejected11 };
      }
      // 後ろの車に阻まれた前進では窓を開かない: A の後端の右に B を置き、A は左へ切りながら前進する (後端が右へ振れて B に
      //   触れる)。阻んだ車が後ろにいるので、ここで後退を仕込むとその車へ下がって突っ込む。
      {
        const A10 = mk(0, poseAt(10, 10, 0));
        A10.car.steerAngle = config.CAR.maxSteer;
        if ('v' in A10.car) A10.car.v = 0.2;
        if ('u' in A10.car) A10.car.u = 0.2;
        const rearX = 10 - 0.5 * L;
        const B10 = mk(1, poseAt(rearX - 0.3 * L, 10 - Wd - 0.0002, 0));
        // 阻んでいない車を 2 車長前に置く（「前にいる」は阻んだ相手だけで判定する＝3 回目 D-2: 他車全部で見ると、この車で窓が開く）
        const F10 = mk(2, poseAt(10 + 2 * L, 10 + 0.5 * Wd, 0));
        const oth10 = [...physics.carEdges(B10.car), ...physics.carEdges(F10.car)];
        let openedRear = false, rejected = false;
        for (let k = 1; k <= 30; k++) {
          A10.car.driveDir = C.FORWARD; A10.car.pwm = 120; A10.car.steer = C.LEFT;
          const x0 = A10.car.x, y0 = A10.car.y;
          fleet.integrateSlot(A10, h, oth10, [], true);
          if (A10.car.x === x0 && A10.car.y === y0) rejected = true;
          if (A10.car._ccOn) openedRear = true;
        }
        res[`stuckRear_${mode}`] = { opened: openedRear, rejected };
      }
      // L5: 窓が開いたまま car.reset したら消える（押し直しで前の走行の計時を持ち越さない）
      const A4 = mk(0, poseAt(10, 10, 0)), B4 = mk(1, poseAt(10 + L + gap, 10, Math.PI));
      for (let k = 1; k <= 30; k++) { drive(A4, C.FORWARD); fleet.integrateSlot(A4, h, physics.carEdges(B4.car), [], true); }
      const openBefore = !!A4.car._ccOn;
      A4.car.reset(A4.spawn);
      res[`resetClears_${mode}`] = { openBefore, after: !!A4.car._ccOn, t: A4.car._ccT };
    }
    // D3 外した車: 完走（slot.retired）した A は、重なっている B と当たらない（取り消されない）。fleetEdges は空。
    {
      // T の重なり (前進で深くなる＝ESCAPE では通らない形) にして、外したことだけで通ることを見る
      const A = mk(0, poseAt(10, 10, 0)), B = mk(1, poseAt(10 + 0.5 * L + 0.3 * Wd, 10, Math.PI / 2));
      A.retired = true;
      const x0 = A.car.x;
      for (let k = 0; k < 30; k++) { drive(A, C.FORWARD); fleet.integrateSlot(A, h, physics.carEdges(B.car), [], false); }
      res[`retiredPass_${mode}`] = A.car.x - x0;
      res[`retiredEdges_${mode}`] = typeof fleet.fleetEdges === 'function' ? fleet.fleetEdges([A, B]).map((e) => e.length) : null;
      // 外した車も壁とは当たる（走っていない車は壁でクラッシュ側の分岐）
      const walls = [{ x1: 10 + 0.5 * L + 0.01, y1: 9, x2: 10 + 0.5 * L + 0.01, y2: 11 }];
      const Rw = mk(0, poseAt(10, 10, 0));
      Rw.retired = true; Rw.running = false;
      for (let k = 0; k < 60; k++) { drive(Rw, C.FORWARD); fleet.integrateSlot(Rw, h, [], walls, true); }
      res[`retiredWall_${mode}`] = { crashed: !!Rw.car.crashed, inWall: physics.checkCollision(Rw.car, walls) };
    }
  }
  // D3' 峠でゴールした車も外れる（lap.touge && lap.finished）。
  {
    config.setPhysicsMode('dynamic');
    const s = mk(0, poseAt(10, 10, 0));
    s.lap.touge = true; s.lap.finished = true;
    res.tougeGoal = typeof fleet.isRetired === 'function' ? fleet.isRetired(s) : null;
  }
  // D2' v2: DynCar.reset (CarV2 が継ぐ) は v2 のスタック検出の窓 _stuckT も消す（BG1 層 4 L5 の兄弟）。
  {
    config.setPhysicsMode('v2');
    const s2 = mk(0, poseAt(10, 10, 0));
    s2.car._stuckT = 0.9;
    s2.car.reset(s2.spawn);
    res.v2StuckReset = s2.car._stuckT;
  }
  // D4 v2: 完走した車は車どうしの接触を作らない。B が A へ突っ込む。A が外れていれば、B の動きは B だけを走らせたときと同じ。
  {
    config.setPhysicsMode('v2');
    const run = (withA, retiredA) => {
      const B = mk(1, poseAt(10, 10, 0));
      const A = mk(0, poseAt(10 + 1.2 * L, 10, 0));
      if (retiredA) A.retired = true;
      const ax0 = A.car.x, ay0 = A.car.y;
      const sl = withA ? [B, A] : [B];
      for (let k = 0; k < 60; k++) { drive(B, C.FORWARD, 255); A.car.driveDir = C.FREE; A.car.pwm = 0; fleet.integrateFleetV2(sl, h, [], true, true); }
      return { bx: B.car.x, by: B.car.y, aMoved: Math.hypot(A.car.x - ax0, A.car.y - ay0), passed: B.car.x > ax0 };
    };
    const solo = run(false, false), ghost = run(true, true), hit = run(true, false);
    res.v2Ghost = { same: ghost.bx === solo.bx && ghost.by === solo.by, aStill: ghost.aMoved === 0, hitDiffers: hit.bx !== solo.bx, reached: solo.passed };
  }
  config.setPhysicsMode('dynamic');
  return res;
}
function judgeParts(res, say) {
  const bad = [];
  const t = (cond, msg) => { if (say) ok(cond, msg); if (!cond) bad.push(msg); };
  for (const mode of ['standard', 'dynamic']) {
    const mm = (v) => v.map((x) => (1000 * x).toFixed(1)).join('/');
    t(res[`escapeCross_${mode}`].every((v) => v > 2 * 0.19), `${mode} D1 十字の重なりから前進で抜ける（向き 0/0.3/1.0/2.5 rad で ${mm(res[`escapeCross_${mode}`])} mm 進む・基準 2 車長）`);
    t(res[`escapeSame_${mode}`].every((v) => v > 2 * 0.19), `${mode} D1 ほぼ同心の重なりから前進で抜ける（同 ${mm(res[`escapeSame_${mode}`])} mm）`);
    const d = res[`deepenT_${mode}`];
    t(d.overlapped && Math.abs(d.moved) < 1e-12, `${mode} D1b T の重なりを増やす前進は取り消す（重なり ${d.overlapped}・移動 ${(1000 * d.moved).toFixed(3)} mm）`);
    const re = res[`rearEnd_${mode}`];
    t(Math.abs(re.fwd) < 1e-12 && re.rev < -2 * 0.19, `${mode} D1c 深く刺さった追突は前進で通り抜けず（${(1000 * re.fwd).toFixed(3)} mm）、後退で抜ける（${(1000 * re.rev).toFixed(1)} mm）`);
    const a = res[`stuckArm_${mode}`];
    t(a != null && Math.abs(a - 1.2) <= 1.5 / 60, `${mode} D2 正面で阻まれた車は阻まれてから 1.2 秒で切り返す（${a == null ? '切り返さない' : a.toFixed(4) + ' 秒'}）`);
    t(!res[`stuckOff_${mode}`], `${mode} D2 自動復帰 OFF では切り返さない`);
    t(!res[`stuckIdle_${mode}`], `${mode} D2 走行していない車は切り返さない`);
    const rv = res[`stuckRev_${mode}`];
    t(!rv.armed && rv.back > 0 && rv.back <= rv.gap + 1e-9, `${mode} D2 後退中に後ろの車に阻まれた車には切り返しを仕込まない（仕込んだ ${rv.armed}・後退 ${(1000 * rv.back).toFixed(3)} mm で後ろの車に届いて止まる＝隙間 ${1000 * rv.gap} mm 以下）`);
    const tg = res[`stuckToggle_${mode}`];
    t(tg.every((x) => x.arms >= 1), `${mode} D2 前進と惰行を切り替えるプログラムでも阻まれたままなら切り返す（10 秒の切り返し回数: ${tg.map((x) => `${x.race ? 'レース' : 'ライブ'}刻み 半周期 ${x.c}s=${x.arms}`).join('・')}）`);
    const ld = res[`stuckLiveDt_${mode}`];
    t(ld != null && Math.abs(ld - 1.2) <= 0.05 + 1e-9, `${mode} D2 ライブの外側 dt (0.05 秒) でも阻まれてから 1.2 秒で切り返す（${ld == null ? '切り返さない' : ld.toFixed(3) + ' 秒'}）`);
    for (const after of ['stop', 'go']) {
      const g = res[`stuckGone_${after}_${mode}`];
      t(g.opened && !g.armed, `${mode} D2 前の車が去ったら仕込まない（${after === 'stop' ? '自分のプログラムが止めた' : '前進を続けた'}・窓は開いた ${g.opened}・仕込んだ ${g.armed}）`);
    }
    const mv = res[`stuckMoved_${mode}`];
    t(!mv.armed && mv.moved >= mv.eps, `${mode} D2 窓の中で 0.5 車長以上動けた車には、終わりの直前に阻まれても仕込まない（${(1000 * mv.moved).toFixed(1)} mm 動いた・仕込んだ ${mv.armed}）`);
    t(res[`stuckDuringRecover_${mode}`] === 0, `${mode} D2 切り返し中の車には仕込まない（recoverN ${res[`stuckDuringRecover_${mode}`]}）`);
    const co = res[`stuckCoast_${mode}`];
    t(!co.armed && co.rejected > 100, `${mode} D2 下り坂を惰行で前の車へ押し付けられる車（前進指令でない）には仕込まない（取り消し ${co.rejected}/150 回・仕込んだ ${co.armed}）`);
    const rr = res[`stuckRear_${mode}`];
    t(rr.rejected && !rr.opened, `${mode} D2 後ろの車に阻まれた前進では窓を開かない（2 車長前に阻んでいない車がいても・取り消された ${rr.rejected}・窓 ${rr.opened}＝検査が空振りしていないことを「取り消された」で確かめる）`);
    const r = res[`resetClears_${mode}`];
    t(r.openBefore && !r.after && r.t === 0, `${mode} D2 car.reset で STUCK の窓が消える（L5: 窓 ${r.openBefore}→${r.after}・計時 ${r.t}）`);
    t(res[`retiredPass_${mode}`] > 0.3 * 0.19, `${mode} D3 完走した車は他車と当たらない（${(1000 * res[`retiredPass_${mode}`]).toFixed(1)} mm 進む）`);
    const e = res[`retiredEdges_${mode}`];
    t(Array.isArray(e) && e[0] === 0 && e[1] === 4, `${mode} D3 fleetEdges は完走した車を空にする（${JSON.stringify(e)}）`);
    const rw = res[`retiredWall_${mode}`];
    t(rw.crashed && !rw.inWall, `${mode} D3 外した車も壁とは当たる（クラッシュ ${rw.crashed}・壁にめり込んだまま ${rw.inWall}）`);
  }
  t(res.tougeGoal === true, `D3 峠でゴールした車は isRetired（${res.tougeGoal}）`);
  t(res.v2StuckReset === 0, `D2' v2 の車の reset でスタック検出の窓 _stuckT が消える（${res.v2StuckReset}）`);
  t(res.v2Ghost.same && res.v2Ghost.aStill && res.v2Ghost.hitDiffers && res.v2Ghost.reached, `D4 v2: 完走した車へ突っ込んだ車は、相手がいないときと同じ動き（${res.v2Ghost.same}）・完走車は押されない（${res.v2Ghost.aStill}）・外さなければ当たる（${res.v2Ghost.hitDiffers}）・相手の位置まで届いている（${res.v2Ghost.reached}＝検査が空振りしていない）`);
  return bad;
}
console.log('\nD) 部品の単体検査');
judgeParts(partsChecks(P), true);

// ── E) 1 台走行の不変 ────────────────────────────────────────────────────────────
const SOLO_RACE = {
  "オーバル|standard|false": "7c50a7d2",
  "オーバル|standard|true": "7c50a7d2",
  "オーバル|dynamic|false": "91bd6835",
  "オーバル|dynamic|true": "91bd6835",
  "オーバル|v2|false": "32b6aea5",
  "オーバル|v2|true": "32b6aea5",
  "ナローゲート|standard|false": "1a521c2c",
  "ナローゲート|standard|true": "1a521c2c",
  "ナローゲート|dynamic|false": "111c036d",
  "ナローゲート|dynamic|true": "111c036d",
  "ナローゲート|v2|false": "9411b358",
  "ナローゲート|v2|true": "9411b358",
  "テクニカル周回 (簡易)|standard|false": "2b26076a",
  "テクニカル周回 (簡易)|standard|true": "2b26076a",
  "テクニカル周回 (簡易)|dynamic|false": "936e5d57",
  "テクニカル周回 (簡易)|dynamic|true": "936e5d57",
  "テクニカル周回 (簡易)|v2|false": "fcd0f861",
  "テクニカル周回 (簡易)|v2|true": "fcd0f861",
  "エッセ・レイアウト|standard|false": "f4a73706",
  "エッセ・レイアウト|standard|true": "f4a73706",
  "エッセ・レイアウト|dynamic|false": "f583586c",
  "エッセ・レイアウト|dynamic|true": "f583586c",
  "エッセ・レイアウト|v2|false": "a259e354",
  "エッセ・レイアウト|v2|true": "a259e354",
  "ツイスティ・レイアウト|standard|false": "f3e486bc",
  "ツイスティ・レイアウト|standard|true": "f3e486bc",
  "ツイスティ・レイアウト|dynamic|false": "db6a3553",
  "ツイスティ・レイアウト|dynamic|true": "54963869",
  "ツイスティ・レイアウト|v2|false": "eb919443",
  "ツイスティ・レイアウト|v2|true": "e3c6f19d",
  "峠① 中速ヘアピン (緩い下り)|standard|false": "3f52a788",
  "峠① 中速ヘアピン (緩い下り)|standard|true": "3f52a788",
  "峠① 中速ヘアピン (緩い下り)|dynamic|false": "6f56330d",
  "峠① 中速ヘアピン (緩い下り)|dynamic|true": "6f56330d",
  "峠① 中速ヘアピン (緩い下り)|v2|false": "5231afbf",
  "峠① 中速ヘアピン (緩い下り)|v2|true": "5231afbf",
  "架空峠 ロング・ワインディング(中斜面)|standard|false": "20ce04eb",
  "架空峠 ロング・ワインディング(中斜面)|standard|true": "20ce04eb",
  "架空峠 ロング・ワインディング(中斜面)|dynamic|false": "19a0f26d",
  "架空峠 ロング・ワインディング(中斜面)|dynamic|true": "19a0f26d",
  "架空峠 ロング・ワインディング(中斜面)|v2|false": "9725e60d",
  "架空峠 ロング・ワインディング(中斜面)|v2|true": "9725e60d",
  "峠① 中速ヘアピン (緩い下り)〔道幅 3 台分〕|standard|false": "9e8d0425",
  "峠① 中速ヘアピン (緩い下り)〔道幅 3 台分〕|standard|true": "742e969e",
  "峠① 中速ヘアピン (緩い下り)〔道幅 3 台分〕|dynamic|false": "c8b32ac2",
  "峠① 中速ヘアピン (緩い下り)〔道幅 3 台分〕|dynamic|true": "c8b32ac2",
  "峠① 中速ヘアピン (緩い下り)〔道幅 3 台分〕|v2|false": "ccd3f986",
  "峠① 中速ヘアピン (緩い下り)〔道幅 3 台分〕|v2|true": "86f344f8",
  "峠③ 高速ヘアピン (大R下り)〔道幅 3 台分〕|standard|false": "9f2faa38",
  "峠③ 高速ヘアピン (大R下り)〔道幅 3 台分〕|standard|true": "a41fae30",
  "峠③ 高速ヘアピン (大R下り)〔道幅 3 台分〕|dynamic|false": "3121c7f4",
  "峠③ 高速ヘアピン (大R下り)〔道幅 3 台分〕|dynamic|true": "3121c7f4",
  "峠③ 高速ヘアピン (大R下り)〔道幅 3 台分〕|v2|false": "a222c379",
  "峠③ 高速ヘアピン (大R下り)〔道幅 3 台分〕|v2|true": "b71d3a88",
  "架空峠 ロング・ワインディング(中斜面)〔道幅 3 台分〕|standard|false": "1c6e7ab0",
  "架空峠 ロング・ワインディング(中斜面)〔道幅 3 台分〕|standard|true": "2f0d434a",
  "架空峠 ロング・ワインディング(中斜面)〔道幅 3 台分〕|dynamic|false": "9ab741fb",
  "架空峠 ロング・ワインディング(中斜面)〔道幅 3 台分〕|dynamic|true": "331688e7",
  "架空峠 ロング・ワインディング(中斜面)〔道幅 3 台分〕|v2|false": "bc808194",
  "架空峠 ロング・ワインディング(中斜面)〔道幅 3 台分〕|v2|true": "1e971536",
  "舵角限界ベンチ R_out/R_min=0.95〔道幅 2 台分〕|standard|false": "528b5438",
  "舵角限界ベンチ R_out/R_min=0.95〔道幅 2 台分〕|standard|true": "528b5438",
  "舵角限界ベンチ R_out/R_min=0.95〔道幅 2 台分〕|dynamic|false": "98395377",
  "舵角限界ベンチ R_out/R_min=0.95〔道幅 2 台分〕|dynamic|true": "bb72ddab",
  "舵角限界ベンチ R_out/R_min=0.95〔道幅 2 台分〕|v2|false": "771115e0",
  "舵角限界ベンチ R_out/R_min=0.95〔道幅 2 台分〕|v2|true": "b002c493"
};
const SOLO_LIVE = {
  "オーバル|standard": "23d81ad7",
  "オーバル|dynamic": "2d403d9e",
  "オーバル|v2": "c3ec7674",
  "丸の中の四角|standard": "3f3dd054",
  "丸の中の四角|dynamic": "92ec0b2a",
  "丸の中の四角|v2": "c139dd7f",
  "トライアングル|standard": "cd89bd9f",
  "トライアングル|dynamic": "369edf91",
  "トライアングル|v2": "71fc18a8",
  "ツイスティ・レイアウト|standard": "6cf54317",
  "ツイスティ・レイアウト|dynamic": "a13d27ad",
  "ツイスティ・レイアウト|v2": "7a05d79e",
  "峠③ 高速ヘアピン (大R下り)|standard": "31aa0e7e",
  "峠③ 高速ヘアピン (大R下り)|dynamic": "517a275c",
  "峠③ 高速ヘアピン (大R下り)|v2": "a77547c3",
  "競技サーキット (フルスケール)|standard": "8717ed38",
  "競技サーキット (フルスケール)|dynamic": "08cc75db",
  "競技サーキット (フルスケール)|v2": "7ee4f04f",
  "峠③ 高速ヘアピン (大R下り)〔道幅 3 台分〕|standard": "cc459389",
  "峠③ 高速ヘアピン (大R下り)〔道幅 3 台分〕|dynamic": "f3c47379",
  "峠③ 高速ヘアピン (大R下り)〔道幅 3 台分〕|v2": "cc20587a",
  "架空峠 ロング・ワインディング(激坂)〔道幅 4.5 台分〕|standard": "ecc64200",
  "架空峠 ロング・ワインディング(激坂)〔道幅 4.5 台分〕|dynamic": "697d602b",
  "架空峠 ロング・ワインディング(激坂)〔道幅 4.5 台分〕|v2": "aa4c2e45",
  "舵角限界ベンチ R_out/R_min=0.95〔道幅 3.5 台分〕|standard": "06db4446",
  "舵角限界ベンチ R_out/R_min=0.95〔道幅 3.5 台分〕|dynamic": "a0e95f91",
  "舵角限界ベンチ R_out/R_min=0.95〔道幅 3.5 台分〕|v2": "3169b870"
};
console.log(`\nE) 1 台走行の不変（改修前ツリーの値と突き合わせ: レース ${Object.keys(SOLO_RACE).length} 本・ライブ ${Object.keys(SOLO_LIVE).length} 本）`);
{
  const p = P.programs.PROGRAM_BY_KEY.py_normal_fr;
  const bad = [];
  for (const [k, want] of Object.entries(SOLO_RACE)) {
    const [name, mode, rj] = k.split('|');
    const r = P.race.runRace({ course: courseOf(P, name), regime: regimeOf(name), laps: 1, field: [{ name: 'C0', lang: p.lang, src: p.code, carType: p.carType }], crashRule: { rejoin: rj === 'true', penaltySec: 3 }, interact: true, physics: mode, maxSec: 30, trace: true });
    if (r.traceHash !== want) bad.push(`${k}: ${r.traceHash} ≠ ${want}`);
  }
  ok(bad.length === 0, `レース 1 台の毎 tick 全状態 traceHash が改修前と一致${bad.length ? '（不一致 ' + bad.length + ': ' + bad.slice(0, 3).join(' / ') + '）' : ''}`);
  const bad2 = [];
  for (const [k, want] of Object.entries(SOLO_LIVE)) {
    const [name, mode] = k.split('|');
    const L = liveSetup(P, { name, n: 1, mode });
    const parts = [];
    while (L.t < LIVE_SEC - 1e-9) {
      liveFrame(L, SDT.V0(L.frames));
      const c = L.slots[0].car;
      parts.push(P.fnv.fnv1a(`${c.x},${c.y},${c.theta},${c.u || 0},${c.vlat || 0},${c.r || 0},${c.v || 0},${c.recoverT || 0},${c.recoverN || 0},${c.crashed ? 1 : 0},${L.slots[0].lap.laps}`));
    }
    const got = P.fnv.fnv1a(parts.join('|'));
    if (got !== want) bad2.push(`${k}: ${got} ≠ ${want}`);
  }
  ok(bad2.length === 0, `ライブ 1 台の毎フレームの軌跡が改修前と一致${bad2.length ? '（不一致 ' + bad2.length + ': ' + bad2.slice(0, 3).join(' / ') + '）' : ''}`);
}

// ── F) 構造検査 ──────────────────────────────────────────────────────────────────
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => (/:\/\//.test(l) ? l : l.replace(/\/\/.*$/, ''))).join('\n');
const bodyOf = (src, header) => { const i = src.indexOf(header); if (i < 0) return ''; const j = src.indexOf('\n}', i); return j < 0 ? src.slice(i) : src.slice(i, j + 2); };
function structural(srcs) {
  const v = [];
  const main = strip(srcs['main.js']), race = strip(srcs['race_engine.js']), contact = strip(srcs['contact_v2.js']), fleet = strip(srcs['fleet.js']);
  if (!/^import \* as fleetParts from '\.\/fleet\.js';$/m.test(main)) v.push('main.js が fleet.js を名前空間 import していない（新しい名前の名前付き import は古い fleet.js で起動しなくなる＝BA1）');
  if (!/const fleetEdgesOf = \(sl\) => \(typeof fleetParts\.fleetEdges === 'function' \? fleetParts\.fleetEdges\(sl\) : sl\.map\(s => carEdges\(s\.car\)\)\);/.test(main)) v.push('main.js の fleetEdgesOf が「あれば使う」形でない');
  const live = bodyOf(main, 'function integrateLive(dt) {');
  if (!/const e = fleetEdgesOf\(slots\);\s*slots\.forEach\(\(s, i\) => integrateSlot\(s, step, othersFor\(e, i, interact\), course\.walls, recover\)\);/.test(live)) v.push('main.js integrateLive のサブステップが fleetEdgesOf で他車エッジを作っていない（本ゲートの写しと違う）');
  if (/carEdges\(/.test(live)) v.push('main.js integrateLive に carEdges の直呼びが残っている（外した車が相手に残る）');
  const frame = bodyOf(main, 'function frame(t) {');
  if (!/const edges = fleetEdgesOf\(slots\);/.test(frame)) v.push('main.js frame が fleetEdgesOf で他車エッジを作っていない（センサー・一時停止ステップ）');
  if (/carEdges\(/.test(frame)) v.push('main.js frame に carEdges の直呼びが残っている');
  if (!/edges = edges \|\| fleetEdgesOf\(slots\);/.test(bodyOf(main, 'function render(edges) {'))) v.push('main.js render のセンサー表示が fleetEdgesOf を使っていない');
  if (!/const edges = slots\.map\(\(s\) => \(s\.retired \? \[\] : carEdges\(s\.car\)\)\);/.test(race)) v.push('race_engine が完走・リタイアした車を他車エッジから外していない');
  if ((race.match(/s\.retired = true;/g) || []).length !== 2) v.push('race_engine が完走と DNF の 2 か所で s.retired を立てていない');
  if (!/if \(bodies\[i\]\.ghost \|\| bodies\[j\]\.ghost\) continue;/.test(contact)) v.push('contact_v2 resolveFleetContacts が外した車の組を作らない形になっていない');
  if (!/ghost: isRetired\(slot\),/.test(fleet)) v.push('fleet.js integrateFleetV2 が body に ghost を立てていない');
  if (!/if \(others\.length && isRetired\(slot\)\) others = \[\];/.test(bodyOf(fleet, 'export function integrateSlot(slot, dt, others, walls, recover) {'))) v.push('fleet.js integrateSlot が外した車の others を空にしていない');
  return v;
}
const SRC_NAMES = ['main.js', 'race_engine.js', 'contact_v2.js', 'fleet.js'];
const SRCS = Object.fromEntries(SRC_NAMES.map((f) => [f, fs.readFileSync(path.join(JS_DIR, f), 'utf8')]));
console.log('\nF) 構造検査');
{
  const v = structural(SRCS);
  ok(v.length === 0, `ライブ経路・レース・v2 の外し方の形${v.length ? '（' + v.join(' / ') + '）' : ''}`);
  // F) の変異: 守っている行を 1 つずつ壊して赤くなるか
  const muts = [
    ['main.js integrateLive が carEdges に戻る', { 'main.js': (s) => s.replace('const e = fleetEdgesOf(slots);', 'const e = slots.map(s => carEdges(s.car));') }],
    ['main.js frame が carEdges に戻る', { 'main.js': (s) => s.replace('const edges = fleetEdgesOf(slots);', 'const edges = slots.map(s => carEdges(s.car));') }],
    ['main.js が fleetEdges を名前付き import', { 'main.js': (s) => s.replace("import * as fleetParts from './fleet.js';", "import { fleetEdges } from './fleet.js';") }],
    ['race_engine が全車のエッジを渡す', { 'race_engine.js': (s) => s.replace('const edges = slots.map((s) => (s.retired ? [] : carEdges(s.car)));', 'const edges = slots.map((s) => carEdges(s.car));') }],
    ['contact_v2 が ghost を見ない', { 'contact_v2.js': (s) => s.replace('if (bodies[i].ghost || bodies[j].ghost) continue;', '') }],
  ];
  const missed = [];
  for (const [label, m] of muts) {
    const srcs = { ...SRCS };
    for (const [f, fn] of Object.entries(m)) { const before = srcs[f]; srcs[f] = fn(srcs[f]); if (srcs[f] === before) missed.push(label + '（変異が当たらない）'); }
    if (structural(srcs).length === 0) missed.push(label);
  }
  ok(missed.length === 0, `F) の変異 ${muts.length} 件がすべて赤になる${missed.length ? '（素通り: ' + missed.join(' / ') + '）' : ''}`);
}

// ── G) 変異試験（部品を外した product の写し）─────────────────────────────────────────
console.log('\nG) 変異試験（部品を 1 つずつ外した public/js の写しで A)/C)/D) のどれかが赤になるか）');
{
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf_bg2_'));
  // [ラベル, ファイル, 置換 (文字列 1 組 か [[from,to],…]), 置換後の行き先, 末尾に足す関数]
  const AREA_HEAD = 'function overlapArea(a, b) {\n  const sgn';
  const MUTS = [
    ['①(a) ESCAPE を外す', 'fleet.js', 'if (cc.escape) continue;', ''],
    ['①(a) 重なりを四隅の深さで測る（L4 の穴を戻す）', 'fleet.js', AREA_HEAD, 'function overlapArea(a, b) {\n  return cornerDepth(a, b);\n  const sgn', 'CORNER'],
    ['①(a) 重なりを最小分離距離（SAT）で測る（A-3 の通り抜けを戻す）', 'fleet.js', AREA_HEAD, 'function overlapArea(a, b) {\n  return satDepth(a, b);\n  const sgn', 'SAT'],
    ['①(a) 比較の許容を外す（A-1 を戻す）', 'fleet.js', 'const tol = 1e-9 * CAR.length * CAR.width;', 'const tol = 0;'],
    ['①(b) STUCK を外す', 'fleet.js', 'else if (car._ccT - car._ccLast <= STUCK_RECENT) { armRecover(car, slot); car._ccOn = false; }', 'else if (car._ccT - car._ccLast <= STUCK_RECENT) { car._ccOn = false; }'],
    ['①(b) 前進指令でなくても窓を開く（前進指令の条件を外す）', 'fleet.js', 'if (cc.ahead && car.driveDir === CONST.FORWARD && car.pwm > 5) {', 'if (cc.ahead) {'],
    ['①(b) 後ろの車に阻まれても窓を開く（前方の条件を外す）', 'fleet.js', 'if (cc.ahead && car.driveDir === CONST.FORWARD && car.pwm > 5) {', 'if (car.driveDir === CONST.FORWARD && car.pwm > 5) {'],
    ['①(b) 阻んだ車が去っても仕込む（「いまも阻まれている」を外す）', 'fleet.js', 'else if (car._ccT - car._ccLast <= STUCK_RECENT) { armRecover(car, slot); car._ccOn = false; }', 'else { armRecover(car, slot); car._ccOn = false; }'],
    ['①(b) 窓を保留せず満了で閉じる（3 回目 A-1 を戻す）', 'fleet.js', 'else if (car._ccT - car._ccLast <= STUCK_RECENT) { armRecover(car, slot); car._ccOn = false; }', 'else { if (car._ccT - car._ccLast <= STUCK_RECENT) armRecover(car, slot); car._ccOn = false; }'],
    ['①(b) 動けた車にも仕込む（stuckEps の判定を外す）', 'fleet.js', 'if (Math.hypot(car.x - car._ccX, car.y - car._ccY) >= stuckEps() || car.recoverT > 0) car._ccOn = false;', 'if (car.recoverT > 0) car._ccOn = false;'],
    ['①(b) 切り返し中にも仕込む', 'fleet.js', 'if (Math.hypot(car.x - car._ccX, car.y - car._ccY) >= stuckEps() || car.recoverT > 0) car._ccOn = false;', 'if (Math.hypot(car.x - car._ccX, car.y - car._ccY) >= stuckEps()) car._ccOn = false;'],
    ['①(b) 窓の時刻をサブステップ幅で頭打ちにする（3 回目 D-1）', 'fleet.js', 'car._ccT += dt;', 'car._ccT += Math.min(dt, 1 / SIM.physicsHz);'],
    ['①(b) 「前にいる」を阻んだ相手でなく他車全部で見る（3 回目 D-2）', 'fleet.js', 'const blockers = grew.length ? grew : touched;', 'const blockers = [0, 1, 2, 3].length && others.length ? Array.from({ length: others.length / 4 }, (_, q) => [0, 1, 2, 3].map((j) => ({ x: others[4 * q + j].x1, y: others[4 * q + j].y1 }))) : touched;'],
    ['①(b) 前進指令でなくなったら窓を捨てる（A-2 を戻す）', 'fleet.js', 'if (!(recover && slot.running)) car._ccOn = false;', 'if (!(recover && slot.running && car.driveDir === CONST.FORWARD && car.pwm > 5)) car._ccOn = false;'],
    ['①(b) DynCar.reset で窓を消さない（L5 を戻す）', 'physics_dyn.js', 'this._ccOn = false; this._ccT = 0; this._ccX = 0; this._ccY = 0; this._stuckT = 0;', 'this._stuckT = 0;'],
    ['①(b) DynCar.reset で v2 の _stuckT を消さない（L5 の兄弟を戻す）', 'physics_dyn.js', 'this._ccY = 0; this._stuckT = 0;', 'this._ccY = 0;'],
    ['①(b) Car.reset (classic) で窓を消さない（L5 を戻す）', 'physics.js', 'this._ccOn = false; this._ccT = 0; this._ccX = 0; this._ccY = 0;', ''],
    ['② ゴール・完走・リタイアした車を外さない（fleet.js）', 'fleet.js', 'return slot.retired === true || !!(slot.lap && slot.lap.touge && slot.lap.finished);', 'return false;'],
    ['② race_engine が完走車を他車エッジに残す', 'race_engine.js', 'const edges = slots.map((s) => (s.retired ? [] : carEdges(s.car)));', 'const edges = slots.map((s) => carEdges(s.car));'],
    ['② race_engine が DNF 車に印を立てない', 'race_engine.js', "dnf[i] = { lapsCompleted: s.lap.laps, tick, reason: 'crash' };\n          s.retired = true;", "dnf[i] = { lapsCompleted: s.lap.laps, tick, reason: 'crash' };"],
    ['② v2 の接触で外した車の組を作る', 'contact_v2.js', 'if (bodies[i].ghost || bodies[j].ghost) continue;', ''],
  ];
  const EXTRA = {
    // 四隅の深さ (相手の矩形の内側へ入った隅の、4 辺までの距離の最小、の最大)。BG1 の試作の測り方＝十字・同心の重なりで 0。
    CORNER: `
function cornerDepth(a, b) {
  const depthIn = (p, q) => {
    let pos = Infinity, neg = Infinity, allPos = true, allNeg = true;
    for (let k = 0; k < 4; k++) {
      const s = q[k], e = q[(k + 1) % 4];
      const ex = e.x - s.x, ey = e.y - s.y, l = Math.hypot(ex, ey);
      const d = (ex * (p.y - s.y) - ey * (p.x - s.x)) / l;
      if (d > 0) { allNeg = false; pos = Math.min(pos, d); } else if (d < 0) { allPos = false; neg = Math.min(neg, -d); } else return 0;
    }
    return allPos ? pos : (allNeg ? neg : 0);
  };
  let best = 0;
  for (const p of a) best = Math.max(best, depthIn(p, b));
  for (const p of b) best = Math.max(best, depthIn(p, a));
  return best;
}
`,
    // 最小分離距離 (SAT・両方の辺の法線への射影の重なりの最小)。BG2 の初版の測り方＝深く刺さると幅で頭打ち。
    SAT: `
function satDepth(a, b) {
  let min = Infinity;
  for (const q of [a, b]) for (let k = 0; k < 2; k++) {
    const ex = q[k + 1].x - q[k].x, ey = q[k + 1].y - q[k].y, l = Math.hypot(ex, ey);
    if (l < 1e-12) continue;
    const ux = -ey / l, uy = ex / l;
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const p of a) { const d = p.x * ux + p.y * uy; if (d < amin) amin = d; if (d > amax) amax = d; }
    for (const p of b) { const d = p.x * ux + p.y * uy; if (d < bmin) bmin = d; if (d > bmax) bmax = d; }
    const ov = Math.min(amax, bmax) - Math.max(amin, bmin);
    if (ov <= 0) return 0;
    if (ov < min) min = ov;
  }
  return min === Infinity ? 0 : min;
}
`,
  };
  let mi = 0;
  for (const [label, file, from, to, extra] of MUTS) {
    const dir = path.join(tmpRoot, 'm' + (mi++));
    fs.cpSync(JS_DIR, dir, { recursive: true });
    const fp = path.join(dir, file);
    let src = fs.readFileSync(fp, 'utf8');
    const pairs = Array.isArray(from) ? from : [[from, to]];
    if (pairs.some(([f]) => !src.includes(f))) { ok(false, `${label}: 変異が当たらない（product の形が変わった）`); continue; }
    for (const [f, t2] of pairs) src = src.replace(f, t2);
    if (extra) src += EXTRA[extra];
    fs.writeFileSync(fp, src);
    const M = await loadMods(dir);
    const red = [];
    // D)
    const bad = judgeParts(partsChecks(M), false);
    if (bad.length) red.push(`D) ${bad.length} 件`);
    // A) の先頭セル（8 の字 動力学 V0）。② は峠セル（ゴールした車）と C) f1 も
    for (const [ci, c] of CELLS.entries()) {
      if (ci > 0 && !(label.startsWith('②') && c.name.startsWith('峠'))) continue;
      const got = liveStopped(M, { name: c.name, n: 6, mode: c.mode }, SDT[c.v]);
      if (got === null || got > c.max) red.push(`A) ${c.name} ${c.mode} ${c.v} 停止 ${got}`);
    }
    if (label.startsWith('②')) {
      const r = f1Race(M); if (r.finishers.length !== 2) red.push(`C) f1 完走 ${r.finishers.length}/2`);
      for (const c of RACES) { const got = raceFinishers(M, c); if (got < c.min) red.push(`C) ${c.name} ${c.mode} 完走 ${got}`); }
      const d = dnfRetired(M); if (!(d.dnf > 0 && d.marked === d.crashed)) red.push(`C) DNF 車の印 ${d.marked}/${d.crashed}`);
    }
    ok(red.length > 0, `${label} → 赤: ${red.length ? red.join(' / ') : '（どれも赤にならない＝この部品を検査が見ていない）'}`);
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

finish();
function finish() {
  console.log(`\n所要 ${((Date.now() - T0) / 1000).toFixed(1)} 秒`);
  console.log(fail === 0 ? '\nwf_bg2_stall: 全パス ○' : `\n✗ ${fail} 件 不合格`);
  process.exit(fail === 0 ? 0 : 1);
}
