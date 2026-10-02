// check_bg3_live_replay.mjs — 6 台で走らせると車どうしが詰まって止まる件（Stage BG）を、発端と同じ本番 UI の操作で固定する（BG3）。
// ════════════════════════════════════════════════════════════════════════════
// 発端（2026-09-30）: 投稿コース「サンプル8の字風 (コミュニティ例)」で、既定設定（卓上・動力学モデル・衝突で自動復帰 ON・
//   他車を障害物 ON・各車の既定プログラム・速度 3×）のまま 6 台並べて ▶ すると、2〜3 秒後に 5 台が左のカーブで数珠つなぎに
//   なり、以後動かなかった。BG2 で車どうしの接触（ESCAPE・STUCK）とゴール・完走・リタイアした車の扱いを改修した。
//
// このゲートがすること（利用者と同じ UI 操作だけ・応答の差し替えなし＝CI-8）:
//   ① 本番 UI でその操作をして、▶ の後の毎フレームの rAF 時刻（main.js frame() が sdt を作るのと同じ時刻）と、描かれた
//      各車の位置（hud.js drawCar のノーズ→テールのグラデーションの端点）を、シム時刻 120 秒ぶん記録する。
//   ② 記録した rAF 時刻列から main.js と同じ式 sdt = 速度 × min(0.05, Δt) を作り、ライブ経路の写し（../wf_bg_live.mjs。
//      node の常設ゲート wf_bg2_stall.mjs が停止の測定に使っているものと同じ）で node 再生して、全フレーム・全車の位置が
//      本物と 1 µm 未満で一致すること（＝node の測定が本物のライブと同じであることの確認）。比べられないフレーム
//      （描かれた車の数が合わない）は ▶ 直後の 2 フレームまで。
//   ③ BG1 の停止の述語（観測の終わりの 10 秒の窓 [110,120] s で、窓の始点からの最大変位が車長未満・クラッシュでない・
//      ゴールしていない車）で、停止車 0 台（BG3 の基準＝BG2 の改修後の実測は sdt 16 通りすべて 0 台。改修前は同じ
//      セルで 6・6・5・6・2・5 台）。描かれた軌跡と node 再生の軌跡の両方に当てて、同じ台数になること。
//   ④ JS/HTTP エラー 0。
//   前提の照合（素性の確認・どれかが外れたら合否の前に ✗）:
//      ・上流から届いた投稿コースの中身が、node 再生に使う写し ../wf_bg2_fig8_course.json と同じ（sha256）。
//      ・ページが読み込んだ js/*.js が、node 再生に使う木（RC_ROOT・既定は本リポジトリ）の public/js と 1 byte も違わない。
//      ・UI が既定設定のまま（動力学・自動復帰 ON・他車を障害物 ON・速度 3×）で、各車のプログラムが写しの既定（Python 版
//        Apex Hunter）と同じ。
//
// ⚠ 上流に依存する: RumiCar-group/RumiCar の courses/community/ を本物で読む（check_bb2_community_path.mjs と同じ）。
//   上流の「サンプル8の字風」が書き換わると、前提の照合で ✗ になる（＝写しと基準を見直す合図）。
//
// 改修前の木で赤になることの確かめ方（BG3 で実施）: 改修前の public/ を 127.0.0.1 で配信し、
//   RC_URL=http://127.0.0.1:<port>/ RC_ROOT=<改修前の木> bash run.sh check_bg3_live_replay.mjs
//   （② は改修前でも一致する＝写しは改修前の product でも本物と同じ・③ が赤になる）。
//
// 使い方: bash run.sh check_bg3_live_replay.mjs    （所要: ▶ の後 シム 120 秒＝実時間 約 40 秒＋起動）
import { launch, newPage } from './lib.mjs';
import { loadMods, liveSetup, liveFrame } from '../wf_bg_live.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RC_ROOT = path.resolve(process.env.RC_ROOT || path.join(HERE, '..'));
const JS_DIR = path.join(RC_ROOT, 'public/js');
const COURSE = 'gh:example-community-course';
const FIG8_FILE = path.join(HERE, '..', 'wf_bg2_fig8_course.json');
const FIG8_SHA = '3d29879ba871f340176e07f90e6d7d90432ff56a0bdd07fef0d80bab586794bf';   // wf_bg2_stall.mjs と同じ（取得 2026-10-01T04:59:18Z）
const N = 6, MODE = 'dynamic', PROG = 'py_normal_fr';
const SIM_SEC = 120, W = 10;            // BG1 の停止の述語（観測 120 秒・窓 10 秒）
const MAX_STOPPED = 0;                  // BG3 の基準（PROGRESS の「BG3 基準の具体化」）
const MAX_DEV_M = 1e-6;                 // 位置の一致 1 µm 未満

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } return c; };
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

console.log(`check_bg3_live_replay — 「サンプル8の字風」6 台・既定設定の ▶ を本番 UI で記録し、node 再生と停止の述語で確かめる`);
console.log(`  node 再生の木: ${RC_ROOT}`);

let upstreamSha = null;
const browser = await launch();
let rec = null, env0 = null, cols = null, served = null;
let errors = [], benign = [];
try {
  const np = await newPage(browser, {
    width: 1440, height: 900,
    before: async (p) => {
      // 上流から届いた投稿コースの中身を記録する（差し替えない）
      p.on('response', async (r) => {
        if (/\/courses\/community\/example-community-course\.json(\?|$)/.test(r.url()) && r.ok()) {
          try { upstreamSha = sha256(await r.body()); } catch (e) { /* 取れなければ下の照合で ✗ */ }
        }
      });
      await p.addInitScript(() => {
        try { localStorage.setItem('rumicar.lang', 'ja'); } catch (e) {}
        const B = window.__bg = { on: false, frames: [], cur: [], prevT: null, t0prev: null, speed: null, simT: 0 };
        // drawCar の車体グラデーション（ノーズ→テール）の端点をキャンバス座標で拾う（描かれた車の位置そのもの）
        const who = () => { const m = (new Error().stack || '').split('\n').slice(3).map((l) => (/at (\w+)/.exec(l) || [])[1]).filter(Boolean); return m[0] || ''; };
        const P = CanvasRenderingContext2D.prototype, o = P.createLinearGradient;
        P.createLinearGradient = function (x0, y0, x1, y1) {
          if (B.on && this.canvas && this.canvas.id === 'course' && who() === 'drawCar') {
            const T = this.getTransform();
            B.cur.push([T.a * x0 + T.c * y0 + T.e, T.b * x0 + T.d * y0 + T.f, T.a * x1 + T.c * y1 + T.e, T.b * x1 + T.d * y1 + T.f]);
          }
          return o.call(this, x0, y0, x1, y1);
        };
        // 初期化スクリプトの rAF は main.js より先に登録される＝各フレームで main の frame() より先に呼ばれる。
        // ∴ ここで積むのは「同じ時刻 t」と「直前のフレームで main が描いた車」。シム時刻は main.js と同じ式で数える（待ちの目安）。
        const loop = (t) => {
          if (B.on) {
            if (B.t0prev == null) B.t0prev = B.prevT;
            B.simT += B.speed * Math.min(0.05, (t - (B.frames.length ? B.frames[B.frames.length - 1].t : B.t0prev)) / 1000);
            B.frames.push({ t, cars: B.cur });
          }
          B.cur = []; B.prevT = t;
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
        document.addEventListener('click', (e) => {
          if (e.target && e.target.id === 'run' && !B.on) { B.on = true; B.speed = Number(document.getElementById('speed').value); }
        }, true);
      });
    },
  });
  const { page } = np;
  errors = np.errors; benign = np.benign;

  // ── 操作: 投稿コースを選ぶ → 6 台に揃える → ▶ ──────────────────────────────────
  const listed = await page.waitForFunction((cv) => [...document.querySelectorAll('#courseSel option')].some((o) => o.value === cv), COURSE, { timeout: 30000 }).then(() => true).catch(() => false);
  if (!ok(listed, `投稿コース ${COURSE} が一覧に出る（出なければ上流に届いていない＝時間をおいて再実行）`)) throw new Error('上流に届かない');
  await page.selectOption('#courseSel', COURSE); await page.waitForTimeout(1500);
  for (let i = 0; i < 8; i++) { const c = await page.evaluate(() => document.querySelectorAll('.carcol').length); if (c >= N) break; await page.click('#carAdd'); await page.waitForTimeout(250); }
  await page.waitForTimeout(500);
  env0 = await page.evaluate(async () => {
    const C = await import(new URL('js/config.js', location.href).href);
    const S = await import(new URL('js/state.js', location.href).href);
    return {
      cars: document.querySelectorAll('.carcol').length,
      activeIdx: Number((document.querySelector('.carcol.active') || { dataset: { idx: -1 } }).dataset.idx),
      course: document.getElementById('courseSel').value, courseName: S.course.name, nWalls: S.course.walls.length,
      speed: Number(document.getElementById('speed').value),
      recover: document.getElementById('optRecover').checked, interact: document.getElementById('optInteract').checked,
      physSel: document.getElementById('optPhysMode').value, physics: C.PHYSICS.mode,
      regime: C.REGIME_STATE.active, userK: C.SCALE_STATE.userK,
    };
  });
  cols = await page.evaluate(() => [...document.querySelectorAll('.carcol')].map((c) => ({
    lang: c.querySelector('.cc-lang').value, src: c.querySelector('.cc-editor').value, carType: c.querySelector('.cc-cartype').value,
  })));
  // ページが読み込んだ js/*.js（node 再生の木と同じかを照合する）
  served = await page.evaluate(async () => {
    const urls = [...new Set(performance.getEntriesByType('resource').map((e) => e.name.split('#')[0].split('?')[0]).filter((u) => /\/js\/.+\.js$/.test(u)))];
    const out = [];
    for (const u of urls) { const r = await fetch(u, { cache: 'no-store' }); out.push({ rel: u.slice(u.indexOf('/js/') + 4), text: await r.text() }); }
    return out;
  });

  await page.click('#run');
  const done = await page.waitForFunction((sec) => window.__bg.simT >= sec, SIM_SEC + 1, { timeout: 240000, polling: 500 }).then(() => true).catch(() => false);
  rec = await page.evaluate(() => { const B = window.__bg; B.on = false; return { frames: B.frames, t0prev: B.t0prev, speed: B.speed, simT: B.simT }; });
  await page.click('#stop').catch(() => {});
  ok(done, `▶ の後 シム ${SIM_SEC + 1} 秒まで記録できた（${rec.simT.toFixed(2)} 秒・${rec.frames.length} フレーム）`);
} finally {
  await browser.close();
}

// ── 前提の照合 ──────────────────────────────────────────────────────────────────
console.log('\n前提の照合');
const fixture = fs.readFileSync(FIG8_FILE);
ok(sha256(fixture) === FIG8_SHA, `写し wf_bg2_fig8_course.json の sha256 が上流の取得物（2026-10-01）と一致`);
ok(upstreamSha === FIG8_SHA, `上流から届いた「サンプル8の字風」の中身が写しと同じ（${upstreamSha ? upstreamSha.slice(0, 8) + '…' : '応答を記録できなかった'}・違えば上流が書き換わった＝写しと基準を見直す）`);
{
  const diff = served.filter((f) => { const p = path.join(JS_DIR, f.rel); return !fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== f.text; }).map((f) => f.rel);
  const need = ['fleet.js', 'physics.js', 'config.js', 'course.js', 'runner.js', 'api.js', 'programs.js', 'fitguard.js', 'race_engine.js', 'physics_dyn.js', 'fnv1a.js', 'main.js', 'hud.js', 'i18n/messages.js'];
  const missing = need.filter((f) => !served.some((x) => x.rel === f));
  ok(missing.length === 0, `node 再生が読むモジュール（wf_bg_live.mjs の loadMods）と main.js・hud.js・messages.js がページの読み込みに含まれる（欠け ${missing.length}${missing.length ? ': ' + missing.join(', ') : ''}）`);
  ok(served.length >= 10 && diff.length === 0, `ページが読み込んだ js ${served.length} 本が node 再生の木の public/js と同一（違い ${diff.length}${diff.length ? ': ' + diff.slice(0, 5).join(', ') : ''}）`);
}
ok(env0.cars === N && env0.course === COURSE && env0.speed === 3 && env0.recover && env0.interact && env0.physSel === MODE && env0.physics === MODE,
  `UI が既定設定のまま（${JSON.stringify({ cars: env0.cars, speed: env0.speed, recover: env0.recover, interact: env0.interact, physics: env0.physics, regime: env0.regime, userK: env0.userK, course: env0.courseName })}）`);
ok(rec.speed === env0.speed, `記録に使った速度倍率が UI の値と同じ（${rec.speed}）`);

// ── ② node 再生 ────────────────────────────────────────────────────────────────
console.log('\n② node 再生（ライブ経路の写し wf_bg_live.mjs）');
const M = await loadMods(JS_DIR);
const acc = M.course.acceptCourseData(JSON.parse(fixture.toString('utf8')), { own: false });   // ライブの投稿コースと同じ入口
if (!acc.ok) throw new Error('写しが取り込みで拒否: ' + acc.why);
ok(acc.course.walls.length === env0.nWalls && acc.course.name === env0.courseName, `写しを取り込んだコースがページのコースと同じ（壁 ${acc.course.walls.length}/${env0.nWalls} 本・${acc.course.name}）`);
const L = liveSetup(M, { course: acc.course, regime: env0.regime, n: N, mode: MODE, userK: env0.userK, progKey: PROG });
const prog = M.programs.PROGRAM_BY_KEY[PROG];
ok(L.nUse === N, `フィットガードの後も ${N} 台（node ${L.nUse} 台）`);
ok(cols.length === N && cols.every((c, i) => c.lang === prog.lang && c.src === prog.code && c.carType === L.slots[i].carType),
  `各車のプログラム・言語・車種が写しの既定と同じ（${cols.map((c) => `${c.lang}/${c.carType}/${c.src === prog.code ? '同じコード' : '違うコード'}`).join(' ')}）`);

const F = M.config.CAR_FOOTPRINT, k = M.config.VIEW.carScale, hM = L.course.bounds.h;
// main.js render は選択中の車を最後に描く（slots.map((s, i) => i).sort((x, y) => (x === activeIdx) - (y === activeIdx))）。
// 描かれた順 → 車の添字へ戻すため、同じ並べ方を作る（選択車は ▶ の前に UI から読んだ .carcol.active）。
const order = Array.from({ length: N }, (_, i) => i).sort((x, y) => (x === env0.activeIdx) - (y === env0.activeIdx));
ok(env0.activeIdx >= 0 && env0.activeIdx < N, `選択中の車が分かる（${env0.activeIdx}・描画順 ${order.join(',')}）`);
// 描かれた車（ノーズ→テールの端点・キャンバス座標）→ 世界座標の中点
const drawn = (c) => { const [nx, ny, tx, ty] = c; const s = Math.hypot(nx - tx, ny - ty) / ((F.front - F.back) * k); return { x: (nx + tx) / 2 / s, y: hM - (ny + ty) / 2 / s }; };
// node の車の同じ点（車体の前端と後端の中点）
const nodePt = (car) => { const off = (F.front + F.back) / 2 * k; return { x: car.x + off * Math.cos(car.theta), y: car.y + off * Math.sin(car.theta) }; };
let tPrev = rec.t0prev, simT = 0, maxDev = 0, compared = 0, nonFinite = 0;
const skipped = [];
let endState = null;   // 窓の終わり（シム SIM_SEC 秒に届いたフレーム）の除外状態（クラッシュ・ゴール）
const BT = [], NT = [], ST = [];   // 比べたフレームごとの 描かれた位置 / node の位置 / シム時刻
for (let j = 0; j < rec.frames.length - 1 && simT < SIM_SEC + 0.5; j++) {
  const t = rec.frames[j].t;
  const sdt = rec.speed * Math.min(0.05, (t - tPrev) / 1000); tPrev = t;
  liveFrame(L, sdt); simT += sdt;
  const bc = rec.frames[j + 1].cars;
  if (!endState && simT >= SIM_SEC) endState = L.slots.map((s) => !!(s.car.crashed || (s.lap.touge && s.lap.finished)));
  if (bc.length !== L.slots.length) { skipped.push(j); continue; }
  const bb = new Array(N);
  bc.forEach((c, d) => { bb[order[d]] = drawn(c); });
  const nn = L.slots.map((s) => nodePt(s.car));
  for (let i = 0; i < N; i++) {
    const v = [bb[i].x, bb[i].y, nn[i].x, nn[i].y];
    if (!v.every(Number.isFinite)) { nonFinite++; maxDev = Infinity; continue; }   // NaN を「差 0」として素通ししない
    const dev = Math.hypot(bb[i].x - nn[i].x, bb[i].y - nn[i].y);
    if (!(dev <= maxDev)) maxDev = dev;
  }
  compared++; BT.push(bb); NT.push(nn); ST.push(simT);
}
ok(simT >= SIM_SEC, `再生がシム ${SIM_SEC} 秒に届いた（${simT.toFixed(2)} 秒）`);
// 比べたフレーム数の下限 = シム SIM_SEC 秒を最も粗い刻み（sdt の上限 = 速度 × 0.05 秒）で進めたときのフレーム数（遅いホストでも偽の赤にしない）
const MIN_FRAMES = Math.floor(SIM_SEC / (rec.speed * 0.05));
ok(compared >= MIN_FRAMES && skipped.every((j) => j <= 1), `比べられないフレームは ▶ 直後の 2 フレームまで（比べた ${compared} ≥ ${MIN_FRAMES}・比べられない ${skipped.length}: ${JSON.stringify(skipped.slice(0, 5))}）`);
ok(nonFinite === 0, `描かれた位置・node の位置がすべて有限（有限でない ${nonFinite} 件）`);
ok(maxDev < MAX_DEV_M, `全フレーム・全車で描かれた位置と node 再生の位置が一致（最大差 ${(maxDev * 1e6).toFixed(3)} µm < ${MAX_DEV_M * 1e6} µm）`);

// ── ③ 停止の述語（BG1）──────────────────────────────────────────────────────────
console.log('\n③ 停止の述語（窓 [' + (SIM_SEC - W) + ',' + SIM_SEC + '] s・車長未満・クラッシュでない・ゴールしていない）');
const carLen = M.config.CAR.length;
const stoppedOf = (TR) => {
  const j0 = ST.findIndex((x) => x >= SIM_SEC - W), j1 = ST.findIndex((x) => x >= SIM_SEC);
  if (j0 < 0 || j1 < 0) return null;
  const out = [];
  for (let i = 0; i < N; i++) {
    if (!endState || endState[i]) continue;   // 窓の終わりの時点でクラッシュ・ゴールしている車は除く
    let m = 0;
    for (let j = j0; j <= j1; j++) { const d = Math.hypot(TR[j][i].x - TR[j0][i].x, TR[j][i].y - TR[j0][i].y); if (!(d <= m)) m = d; }
    if (!(m >= carLen)) out.push(i);   // NaN も「止まっている」側へ（素通しで合格にしない）
  }
  return out;
};
const sB = stoppedOf(BT), sN = stoppedOf(NT);
ok(sB !== null && JSON.stringify(sB) === JSON.stringify(sN), `描かれた軌跡と node 再生で同じ車が止まっている（描画 ${JSON.stringify(sB)} / node ${JSON.stringify(sN)}・車長 ${(carLen * 1000).toFixed(1)} mm）`);
ok(sB !== null && sB.length <= MAX_STOPPED, `停止車 ${sB ? sB.length : '—'} 台 ≤ ${MAX_STOPPED}（改修前は同じセルで 6・6・5・6・2・5 台＝BG1）`);
console.log(`  参考: 120 秒時点の周回 ${L.slots.map((s) => s.lap.laps).join('/')}・クラッシュ ${L.slots.filter((s) => s.car.crashed).length} 台・切り返し回数 ${L.slots.map((s) => s.car.recoverN || 0).join('/')}`);

// ── ④ エラー ────────────────────────────────────────────────────────────────────
console.log('\n④ エラー');
ok(errors.length === 0, `JS/HTTP エラー 0（${errors.length}: ${JSON.stringify(errors.slice(0, 3))}）／想定内 ${benign.length}: ${JSON.stringify(benign.slice(0, 3))}`);

console.log(`\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗:\n  - ' + fails.join('\n  - ')); process.exit(1); }
console.log('結果: PASS');
