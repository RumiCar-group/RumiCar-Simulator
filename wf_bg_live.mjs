// wf_bg_live.mjs — Stage BG のライブ ▶ 走行の写し（library・単体では何もしない。wf_run_all の EXCLUDED に明示）。
// ════════════════════════════════════════════════════════════════════════════
// main.js の startAuto → frame（走行中・非ポーズ分岐）→ integrateLive を、product の関数（fleet/runner/api/fitguard）だけを
// 呼んで再現する。外し方（ゴール・完走・リタイアした車を他車の相手にしない）は main.js の fleetEdgesOf と同じ「あれば使う」形。
//
// 使う側（写しを 2 つ作らないためにここへ切り出した・BG3）:
//   ・wf_bg2_stall.mjs                    … 停止の測定（BG1 の述語）・1 台走行の不変
//   ・browser/check_bg3_live_replay.mjs   … 本番 UI で記録した rAF 時刻列をこの写しで再生し、全車の位置が本物と一致すること
//                                           （＝この写しが本物のライブと同じであること）を実ブラウザで確かめる
// ∴ ここを直したら、実ブラウザゲートで本物との一致を確かめ直す（本物の main.js を直したときも同じ）。
//
// product の木は呼び出し側が選ぶ（loadMods(<dir>/public/js)）。改修前の木（fleetEdges が無い）でも動く。
// ════════════════════════════════════════════════════════════════════════════
import path from 'path';
import { pathToFileURL } from 'url';

// product のモジュール一式（jsDir = <木>/public/js）。
export async function loadMods(jsDir) {
  const u = (f) => pathToFileURL(path.join(jsDir, f)).href;
  const [fleet, physics, config, course, runner, api, programs, fitguard, race, dyn, fnv] = await Promise.all(
    ['fleet.js', 'physics.js', 'config.js', 'course.js', 'runner.js', 'api.js', 'programs.js', 'fitguard.js', 'race_engine.js', 'physics_dyn.js', 'fnv1a.js'].map((f) => import(u(f))));
  return { fleet, physics, config, course, runner, api, programs, fitguard, race, dyn, fnv };
}

// main.js の fleetEdgesOf と同じ（改修前の木には fleetEdges が無いので全車のエッジ）。
export function fleetEdgesOf(M, sl) {
  return typeof M.fleet.fleetEdges === 'function' ? M.fleet.fleetEdges(sl) : sl.map((s) => M.physics.carEdges(s.car));
}

// ▶ を押した直後の状態を作る。course は組み立て済みのコース（出荷コースは buildFromSpec・投稿コースは acceptCourseData）、
// regime はそのコースの推奨領域、userK は UI の車体倍率（既定 0.8×）、progKey は全車に載せるプログラム（UI 既定 = Python 版 Apex Hunter）。
// BH3: prog = { lang, code } を渡すとサンプルに無いプログラムを載せる。persist = true で練習ベストを読み書きする（本物の ▶ と同じ。
//   既定 false＝測定が localStorage に触れない）。どちらも渡さなければ従来と同じ。
export function liveSetup(M, { course, regime, n, mode, userK = 0.8, progKey = 'py_normal_fr', prog: progArg = null, persist = false }) {
  const { config, dyn, fleet, fitguard, programs, runner, api } = M;
  config.SENSOR_NOISE.on = false;
  config.setPhysicsMode(mode);
  dyn.applyRegime(regime);
  config.setCarScale(userK);
  // フィットガード（main.js enforceFitRatio('race') の判定コア＝product の settleFitRatio）
  const fx = { regime: (r) => dyn.applyRegime(r), scale: (k) => config.setCarScale(k), sync: () => {}, log: () => {} };
  const fit = fitguard.settleFitRatio(course, { regime, userK, slotCount: n, reason: 'race' }, fx);
  const nUse = Math.min(n, fit.capN);
  const prog = progArg || programs.PROGRAM_BY_KEY[progKey];
  const slots = [];
  for (let i = 0; i < nUse; i++) slots.push(fleet.makeSlot({ i, lang: prog.lang, src: prog.code, course, slotCount: slots.length, logFor: () => () => {}, persist }));
  fleet.rebuildSpawns(slots, course, null, { persist });   // startAuto
  for (const s of slots) {
    s.car.reset(s.spawn);
    s.world._pendingDelay = 0; s.world._others = [];
    s.hostEnv = api.buildApi(s.world);
    s.lap.reset(course, { carType: s.carType, tire: s.world.tire, wear: s.world.wear, gear: s.world.gear, persist });
    s.controller = runner.buildController(s.src, s.lang, s.hostEnv);
    s.controller.setup();
    s.running = true; s.loopTimer = 0;
  }
  return { M, course, slots, nUse, t: 0, frames: 0 };
}

// 1 フレーム分（sdt = 速度倍率 × min(0.05, Δt)＝main.js frame() と同じ式で呼び出し側が作る）。
export function liveFrame(L, sdt) {
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
      slots.forEach((s, i) => fleet.integrateSlot(s, step, fleet.othersFor(e, i, true), course.walls, true, slots));
      rem -= step;
    }
  }
  L.t += sdt; L.frames++;
}
