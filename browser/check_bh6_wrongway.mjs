// check_bh6_wrongway.mjs — 周回の数え方（BH3）と逆走の向き直し（BH5）を、本番 UI の操作で固定する（BH6）。
// ════════════════════════════════════════════════════════════════════════════
// 発端（BH2・2026-10-04）: 「四角の中の丸」動力学 6 台・3 周・3 秒ペナルティ復帰の 🏁 で、6 台中 5 台が逆走し（最大 347 車長）、
//   そのうち 1 台は順方向へ 1 周もしていないのに「3 周完走・2 位」と数えられた（検証ハッシュ 877faf78）。逆走して完走できなかった車の
//   レースレポートの見立ては「時間切れ — 周回数/時間の設定が過大（コース/プログラムは破綻していません）」だった。
//   BH3 で周回を「借り」で数えるようにし（lap.js）、BH5 で逆走した車を 5 車長で向け直すようにした（fleet.js marshalCheck）。
//
// このゲートがすること（利用者と同じ UI 操作だけ・応答の差し替えなし＝CI-8）:
//   ① 🏁「四角の中の丸」動力学 6 台・3 周・ペナルティ復帰。UI の検証ハッシュ ＝ 同じページの race_engine でもう一度走らせた
//      verifyHash ＝ node の verifyHash。その軌跡（ページと node の両方）に、product の周回の数え方も進行方向の場も使わない
//      測定（コースの中心まわりの角度の積算）を当てる:
//        ・完走した車は、完走の時点で順方向へ 周回数 − 0.1 周以上回っている（回り切っていない完走が無い）
//        ・どの車も、向きが逆のまま逆へ進んだ距離が W_MAX 車長以下（逆走が続かない）
//      レースレポート（結果ダイアログの DOM）の「クラッシュ」の欄が、向き直しのあった車で回数の内訳を出している。
//   ② 🏁「トライアングル」動力学 6 台・3 周・ペナルティ復帰（時間切れの車に、向き直しのあった車と無かった車の両方が出るセル）。
//      見立ての欄: 向き直しのあった時間切れの車に「設定が過大」と出さず、回数を出す。向き直しの無い時間切れの車にも
//      「コース/プログラムは破綻していません」と断定しない。
//   ③ ライブ ▶「四角の中の丸」6 台・既定設定。▶ の後の毎フレームの rAF 時刻と描かれた車の位置を記録し（check_bg3_live_replay と
//      同じ方法）、ライブ経路の写し（../wf_bg_live.mjs）で node 再生して全フレーム・全車の位置が一致すること。各車のシリアル出力に
//      出た「【逆走】向きを進行方向へ直しました」の行数 ＝ node 再生の向き直しの回数（車ごと）・合計 1 回以上。逆走が続かない（①と同じ測定）。
//   ④ JS/HTTP エラー 0。
//   前提の照合: ページが読み込んだ js/*.js が node の木（RC_ROOT・既定は本リポジトリ）の public/js と 1 byte も違わない・
//      UI の設定と各車のプログラムが想定どおり（既定＝Python 版 Apex Hunter）。
//
// 改修前の木で赤になることの確かめ方（BH6 で実施）: 改修前の木の public/ を 127.0.0.1 で配信し、
//   RC_URL=http://127.0.0.1:<port>/ RC_ROOT=<改修前の木> bash run.sh check_bh6_wrongway.mjs
//   （BH3 より前の木: ①の周回・逆走・レポート、②、③が赤。BH3 の後・BH5 より前の木: ①の逆走・レポート、②、③が赤。）
//
// 使い方: bash run.sh check_bh6_wrongway.mjs    （所要: 約 1 分）
import { launch, newPage } from './lib.mjs';
import { loadMods, liveSetup, liveFrame } from '../wf_bg_live.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RC_ROOT = path.resolve(process.env.RC_ROOT || path.join(HERE, '..'));
const JS_DIR = path.join(RC_ROOT, 'public/js');
const N = 6, MODE = 'dynamic', PROG = 'py_normal_fr', LAPS = 3;
const C1 = '四角の中の丸', C2 = 'トライアングル';
const W_SLACK = 0.1;      // 完走の時点の巻き数の下限 = 周回数 − 0.1（グリッドは線の 2.5 車長先まで＝この輪では 0.09 周未満）
const W_MAX = 6;          // 向きが逆のまま逆へ進んだ距離の上限（車長倍）。product は 5 車長で向きを直す（改修前はこのセルで 347 車長）
const LIVE_SEC = 40;      // ライブの観測（シム時刻・秒）。このセルは発走 3〜4 秒で最初の向き直しが起きる（フレーム時刻の揺れ 5 通りで確認）
const MAX_DEV_M = 1e-6;   // ライブの位置の一致 1 µm 未満
const LOG_JA = '【逆走】向きを進行方向へ直しました';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } return c; };

console.log('check_bh6_wrongway — 周回の数え方と逆走の向き直しを本番 UI の 🏁 とライブ ▶ で確かめる');
console.log(`  node の木: ${RC_ROOT}`);

// ── 測定（product の lap.js も進行方向の場も使わない）────────────────────────────────────────
// 輪のコースの中心（壁の外接箱の中心）と、周回の向き（フィニッシュ線の中点で正方向 fx,fy が中心のまわりをどちらへ回るか）。
function ringOf(course) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const w of course.walls) { x0 = Math.min(x0, w.x1, w.x2); x1 = Math.max(x1, w.x1, w.x2); y0 = Math.min(y0, w.y1, w.y2); y1 = Math.max(y1, w.y1, w.y2); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, f = course.finish;
  const mx = (f.x1 + f.x2) / 2, my = (f.y1 + f.y2) / 2;
  return { cx, cy, turn: ((mx - cx) * f.fy - (my - cy) * f.fx) >= 0 ? 1 : -1 };
}
// traj[k][i] = [x, y, theta]。車ごとに、巻き数（順方向を正・周）の時系列と、向きが逆のまま逆へ進んだ距離の最大（車長倍）。
//   向きが逆 = 車体の向きと「中心のまわりを回る向き」の内積が負。距離 = その間の、回る向きと逆への移動の積算（向きが戻れば 0）。
function measure(ring, traj, carLen) {
  const n = traj[0].length, out = [];
  for (let i = 0; i < n; i++) {
    let wind = 0, pa = Math.atan2(traj[0][i][1] - ring.cy, traj[0][i][0] - ring.cx), B = 0, maxB = 0, px = traj[0][i][0], py = traj[0][i][1];
    const winds = new Array(traj.length);
    for (let k = 0; k < traj.length; k++) {
      const [x, y, th] = traj[k][i];
      const a = Math.atan2(y - ring.cy, x - ring.cx);
      let d = a - pa; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      wind += ring.turn * d; pa = a; winds[k] = wind / (2 * Math.PI);
      const phi = a + ring.turn * Math.PI / 2;
      if (Math.cos(th - phi) < 0) { B += -((x - px) * Math.cos(phi) + (y - py) * Math.sin(phi)); if (!(B <= maxB)) maxB = B; } else B = 0;
      px = x; py = y;
    }
    out.push({ winds, maxB: maxB / carLen });
  }
  return out;
}

// ── ブラウザ ──────────────────────────────────────────────────────────────────────────────
const browser = await launch();
let errors = [], benign = [], served = null, race1 = null, race2 = null, live = null;
try {
  const np = await newPage(browser, {
    width: 1440, height: 900,
    before: async (p) => {
      await p.addInitScript(() => {
        try { localStorage.setItem('rumicar.lang', 'ja'); } catch (e) {}
        // ライブ ▶ の記録（check_bg3_live_replay.mjs と同じ方法）: drawCar の車体グラデーションの端点と、毎フレームの rAF 時刻。
        const B = window.__bh6 = { on: false, frames: [], cur: [], prevT: null, t0prev: null, speed: null, simT: 0 };
        const who = () => { const m = (new Error().stack || '').split('\n').slice(3).map((l) => (/at (\w+)/.exec(l) || [])[1]).filter(Boolean); return m[0] || ''; };
        const P = CanvasRenderingContext2D.prototype, o = P.createLinearGradient;
        P.createLinearGradient = function (x0, y0, x1, y1) {
          if (B.on && this.canvas && this.canvas.id === 'course' && who() === 'drawCar') {
            const T = this.getTransform();
            B.cur.push([T.a * x0 + T.c * y0 + T.e, T.b * x0 + T.d * y0 + T.f, T.a * x1 + T.c * y1 + T.e, T.b * x1 + T.d * y1 + T.f]);
          }
          return o.call(this, x0, y0, x1, y1);
        };
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
          if (e.target && e.target.id === 'run' && !B.on && B.armed) { B.on = true; B.speed = Number(document.getElementById('speed').value); }
        }, true);
      });
    },
  });
  const { page } = np;
  errors = np.errors; benign = np.benign;

  const selectCourse = async (name) => {
    const opt = await page.evaluate((nm) => { const o = [...document.querySelectorAll('#courseSel option')].find((x) => x.textContent.includes(nm)); return o ? o.value : null; }, name);
    if (opt == null) throw new Error(`コース「${name}」が一覧に無い`);
    await page.selectOption('#courseSel', opt); await page.waitForTimeout(1200);
  };
  const envOf = () => page.evaluate(async () => {
    const C = await import(new URL('js/config.js', location.href).href);
    const S = await import(new URL('js/state.js', location.href).href);
    return {
      cars: document.querySelectorAll('.carcol').length, courseName: S.course.name, nWalls: S.course.walls.length,
      activeIdx: Number((document.querySelector('.carcol.active') || { dataset: { idx: -1 } }).dataset.idx),
      regimeSel: document.getElementById('regimeSel').value, regime: C.REGIME_STATE.active, physics: C.PHYSICS.mode, userK: C.SCALE_STATE.userK,
      rejoin: document.getElementById('raceRejoin').checked, laps: document.getElementById('raceLaps').value,
      speed: Number(document.getElementById('speed').value), recover: document.getElementById('optRecover').checked, interact: document.getElementById('optInteract').checked,
      names: C.FLEET.names.slice(0, 8), ver: C.APP_VERSION,
      cols: [...document.querySelectorAll('.carcol')].map((c) => ({ lang: c.querySelector('.cc-lang').value, src: c.querySelector('.cc-editor').value, carType: c.querySelector('.cc-cartype').value })),
    };
  });
  // 🏁 を押して結果ダイアログを読み、同じページの race_engine で同じ spec をもう一度走らせる（毎 tick の姿勢つき）。
  const raceOnce = async (courseName) => {
    await selectCourse(courseName);
    await page.selectOption('#optPhysMode', MODE); await page.waitForTimeout(300);
    for (let i = 0; i < 8; i++) { const c = await page.evaluate(() => document.querySelectorAll('.carcol').length); if (c >= N) break; await page.click('#carAdd'); await page.waitForTimeout(250); }
    await page.locator('#raceRejoin').setChecked(true);
    await page.locator('#raceWatch').uncheck();
    await page.fill('#raceLaps', String(LAPS));
    await page.waitForTimeout(400);
    const logBefore = await page.evaluate(() => document.getElementById('log').textContent.length);
    await page.click('#raceRun');
    const opened = await page.waitForFunction(() => !!document.getElementById('dlgRace')?.open, null, { timeout: 120000 }).then(() => true).catch(() => false);
    ok(opened, `「${courseName}」🏁 の結果ダイアログが開いた`);
    const ui = await page.evaluate(async (n0) => {
      const I = await import(new URL('js/i18n.js', location.href).href);
      const hs = [...document.querySelectorAll('#raceResults h3')];
      const h = hs.find((x) => x.textContent === I.t('race.report'));
      const tb = h ? h.nextElementSibling : null;
      const rows = tb ? [...tb.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim())) : null;
      return { rows, log: document.getElementById('log').textContent.slice(n0) };
    }, logBefore);
    ui.env = await envOf();
    const inpage = await page.evaluate(async ({ laps }) => {
      const R = await import(new URL('js/race_engine.js', location.href).href);
      const S = await import(new URL('js/state.js', location.href).href);
      const C = await import(new URL('js/config.js', location.href).href);
      const field = [...document.querySelectorAll('.carcol')].map((c, i) => ({ name: C.FLEET.names[i] || ('C' + (i + 1)), lang: c.querySelector('.cc-lang').value, src: c.querySelector('.cc-editor').value, carType: c.querySelector('.cc-cartype').value, rear: false, encoder: false }));
      const traj = []; let carLen = null;
      const res = R.runRace({ course: S.course, regime: document.getElementById('regimeSel').value, laps, field, crashRule: { rejoin: true, penaltySec: 3 }, interact: document.getElementById('optInteract').checked, report: true, ghost: true, recon: null, wear: false,
        probe: (tick, slots) => { if (carLen == null) carLen = C.CAR.length; traj.push(slots.map((s) => [s.car.x, s.car.y, s.car.theta])); } });
      return { hash: res.verifyHash, ticks: res.ticks, carLen, traj, names: field.map((f) => f.name), interact: document.getElementById('optInteract').checked,
        fin: res.finishers.map((f) => ({ idx: f.idx, name: f.name, tick: f.finishTick, pen: f.penaltiesSec })), dnf: res.dnf.map((d) => ({ idx: d.idx, name: d.name, reason: d.reason })),
        report: res.report.map((r) => ({ idx: r.idx, name: r.name, laps: r.lapsCompleted, crash: r.crashCount, marshal: r.marshalCount })) };
    }, { laps: LAPS });
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    return { ui, inpage };
  };

  console.log(`\n① 🏁「${C1}」動力学 ${N} 台・${LAPS} 周・ペナルティ復帰`);
  race1 = await raceOnce(C1);
  served = await page.evaluate(async () => {
    const urls = [...new Set(performance.getEntriesByType('resource').map((e) => e.name.split('#')[0].split('?')[0]).filter((u) => /\/js\/.+\.js$/.test(u)))];
    const out = [];
    for (const u of urls) { const r = await fetch(u, { cache: 'no-store' }); out.push({ rel: u.slice(u.indexOf('/js/') + 4), text: await r.text() }); }
    return out;
  });
  console.log(`\n② 🏁「${C2}」動力学 ${N} 台・${LAPS} 周・ペナルティ復帰`);
  race2 = await raceOnce(C2);

  console.log(`\n③ ライブ ▶「${C1}」${N} 台・既定設定（シム ${LIVE_SEC} 秒）`);
  await selectCourse(C1);
  const env3 = await envOf();
  await page.evaluate(() => { window.__bh6.armed = true; });
  await page.click('#run');
  const done = await page.waitForFunction((sec) => window.__bh6.simT >= sec, LIVE_SEC, { timeout: 120000, polling: 250 }).then(() => true).catch(() => false);
  // 記録を止めるのと同じ時点で、各車のシリアル出力（利用者に見えている欄）を読む
  const rec = await page.evaluate(() => {
    const B = window.__bh6; B.on = false;
    return { frames: B.frames, t0prev: B.t0prev, speed: B.speed, simT: B.simT, serials: [...document.querySelectorAll('.carcol .cc-serial')].map((e) => e.textContent) };
  });
  await page.click('#stop').catch(() => {});
  ok(done, `▶ の後 シム ${LIVE_SEC} 秒まで記録できた（${rec.simT.toFixed(2)} 秒・${rec.frames.length} フレーム）`);
  live = { env: env3, rec };
} finally {
  await browser.close();
}

// ── node 側 ────────────────────────────────────────────────────────────────────────────────
const M = await loadMods(JS_DIR);
const specs = JSON.parse(fs.readFileSync(path.join(RC_ROOT, 'public/data/courses.json'), 'utf8'));
const prog = M.programs.PROGRAM_BY_KEY[PROG];
const buildCourse = (name) => M.course.buildFromSpec(specs.find((s) => s.name === name));

console.log('\n前提の照合');
{
  const diff = served.filter((f) => { const p = path.join(JS_DIR, f.rel); return !fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== f.text; }).map((f) => f.rel);
  const need = ['fleet.js', 'lap.js', 'race_engine.js', 'race_ui.js', 'physics.js', 'physics_dyn.js', 'config.js', 'course.js', 'runner.js', 'api.js', 'programs.js', 'fitguard.js', 'fnv1a.js', 'main.js', 'hud.js', 'i18n/messages.js'];
  const missing = need.filter((f) => !served.some((x) => x.rel === f));
  ok(missing.length === 0, `検査に関わるモジュールがページの読み込みに含まれる（欠け ${missing.length}${missing.length ? ': ' + missing.join(', ') : ''}）`);
  ok(served.length >= 10 && diff.length === 0, `ページが読み込んだ js ${served.length} 本が node の木の public/js と同一（違い ${diff.length}${diff.length ? ': ' + diff.slice(0, 5).join(', ') : ''}）`);
}

// 🏁 1 本ぶんの突き合わせ。戻り値 = { node の結果, ページの軌跡, node の軌跡 }
function checkRace(tag, courseName, R) {
  const e = R.ui.env, ip = R.inpage;
  ok(e.cars === N && e.courseName === courseName && e.physics === MODE && e.rejoin === true && e.laps === String(LAPS) && e.regime === 'tabletop',
    `${tag} UI の設定（${JSON.stringify({ cars: e.cars, course: e.courseName, physics: e.physics, regime: e.regime, rejoin: e.rejoin, laps: e.laps, userK: e.userK, ver: e.ver })}）`);
  ok(e.cols.length === N && e.cols.every((c) => c.lang === prog.lang && c.src === prog.code && c.carType === prog.carType), `${tag} 各車のプログラムが UI の既定（Python 版 Apex Hunter）`);
  const line = (R.ui.log.trim().split('\n').filter((l) => l.includes('レース終了')).pop() || '').trim();
  const uiHash = (/検証 ([0-9a-f]{8})\)/.exec(line) || [])[1];
  console.log(`    UI のログ: ${line}`);
  ok(!!uiHash && uiHash === ip.hash, `${tag} UI の 🏁 の検証ハッシュ ${uiHash} = 同じページでもう一度走らせた verifyHash ${ip.hash}`);
  const course = buildCourse(courseName);
  const field = e.cols.map((c, i) => ({ name: ip.names[i], lang: c.lang, src: c.src, carType: c.carType, rear: false, encoder: false }));
  M.config.SENSOR_NOISE.on = false; M.config.setPhysicsMode(MODE);
  const ntraj = [];
  const nres = M.race.runRace({ course, regime: e.regimeSel, laps: LAPS, field, crashRule: { rejoin: true, penaltySec: 3 }, interact: ip.interact, report: true, ghost: true, recon: null, wear: false,
    probe: (tick, slots) => { ntraj.push(slots.map((s) => [s.car.x, s.car.y, s.car.theta])); } });
  ok(nres.verifyHash === ip.hash, `${tag} node の verifyHash ${nres.verifyHash} = ページ ${ip.hash}`);
  const nrep = nres.report.map((r) => ({ idx: r.idx, name: r.name, laps: r.lapsCompleted, crash: r.crashCount, marshal: r.marshalCount }));
  ok(JSON.stringify(nrep) === JSON.stringify(ip.report), `${tag} レポートの値（周回・クラッシュ・向き直しの回数）が node とページで同じ`);
  console.log(`    完走 ${ip.fin.map((f) => f.name).join('') || '—'}／未完走 ${ip.dnf.map((d) => `${d.name}(${d.reason})`).join(' ') || '—'}／向き直し ${ip.report.map((r) => `${r.name}:${r.marshal}`).join(' ')}／クラッシュ ${ip.report.map((r) => `${r.name}:${r.crash}`).join(' ')}`);
  return { course, nres, ip, ntraj };
}
// レポートの表（DOM）の行を車の名前で引く。列 = 名前・摩擦円・β・クラッシュ・見立て。
const rowOf = (rows, name) => (rows || []).find((r) => r[0] === name) || null;

console.log(`\n① 「${C1}」の突き合わせ`);
{
  const { course, ip, ntraj } = checkRace('①', C1, race1);
  const ring = ringOf(course);
  for (const [nm, traj] of [['ページ', ip.traj], ['node', ntraj]]) {
    const ms = measure(ring, traj, ip.carLen);
    const finW = ip.fin.map((f) => ({ name: f.name, w: ms[f.idx].winds[Math.min(f.tick, traj.length - 1)] }));
    const minW = finW.length ? Math.min(...finW.map((x) => x.w)) : NaN;
    ok(finW.length > 0 && finW.every((x) => x.w >= LAPS - W_SLACK), `①（${nm}の軌跡）完走した ${finW.length} 台は、完走の時点で順方向へ ${LAPS - W_SLACK} 周以上回っている（最小 ${Number.isFinite(minW) ? minW.toFixed(3) : '—'} 周: ${finW.map((x) => `${x.name} ${x.w.toFixed(2)}`).join(' ')}）`);
    const maxB = Math.max(...ms.map((m) => m.maxB));
    ok(maxB <= W_MAX, `①（${nm}の軌跡）向きが逆のまま逆へ進んだ距離は、どの車も ${W_MAX} 車長以下（最大 ${maxB.toFixed(2)} 車長: ${ms.map((m, i) => `${ip.names[i]} ${m.maxB.toFixed(1)}`).join(' ')}）`);
  }
  const rows = race1.ui.rows;
  ok(Array.isArray(rows) && rows.length === N, `① レースレポートの表が ${N} 行（${rows ? rows.length : '表が無い'}）`);
  const withM = ip.report.filter((r) => r.marshal > 0), noM = ip.report.filter((r) => !(r.marshal > 0));
  ok(withM.length >= 1, `① 向き直しのあった車がいる（${withM.length} 台・計 ${withM.reduce((t, r) => t + r.marshal, 0)} 回）`);
  // 欄の形 = 「<合計>（…向き直し <回数>）」。合計と回数は数字の並びの一部でなく、その数そのものであること（「1」が「12」に当たらない）。
  const badM = withM.filter((r) => { const row = rowOf(rows, r.name); return !row || !new RegExp(`^${r.crash}(?!\\d)\\D*向き直し\\s*${r.marshal}(?!\\d)\\D*$`).test(row[3]); });
  ok(badM.length === 0, `① 向き直しのあった車の「クラッシュ」の欄が「合計（うち逆走の向き直し n）」（${withM.map((r) => `${r.name}:「${(rowOf(rows, r.name) || [])[3]}」`).join(' ')}）`);
  const bad0 = noM.filter((r) => { const row = rowOf(rows, r.name); return !row || row[3] !== String(r.crash || 0); });
  ok(bad0.length === 0, `① 向き直しの無い車の「クラッシュ」の欄は回数だけ（${noM.map((r) => `${r.name}:「${(rowOf(rows, r.name) || [])[3]}」`).join(' ')}）`);
}

console.log(`\n② 「${C2}」の突き合わせ`);
{
  const { ip } = checkRace('②', C2, race2);
  const rows = race2.ui.rows;
  const reason = new Map(ip.dnf.map((d) => [d.idx, d.reason]));
  const toM = ip.report.filter((r) => reason.get(r.idx) === 'timeout' && r.marshal > 0), to0 = ip.report.filter((r) => reason.get(r.idx) === 'timeout' && !(r.marshal > 0));
  ok(toM.length >= 1 && to0.length >= 1, `② 時間切れの車に、向き直しのあった車（${toM.length} 台）と無かった車（${to0.length} 台）の両方がいる`);
  const badM = toM.filter((r) => { const row = rowOf(rows, r.name); return !row || row[4].includes('過大') || !row[4].includes('逆走') || !new RegExp(`(?<!\\d)${r.marshal}\\s*回`).test(row[4]); });
  ok(toM.length >= 1 && badM.length === 0, `② 向き直しのあった時間切れの車の見立ては「設定が過大」と言わず、逆走と回数を出す（${toM.map((r) => `${r.name}:「${(rowOf(rows, r.name) || [])[4]}」`).join(' ')}）`);
  const bad0 = to0.filter((r) => { const row = rowOf(rows, r.name); return !row || !row[4].includes('時間切れ') || row[4].includes('破綻していません') || row[4].includes('逆走'); });
  ok(to0.length >= 1 && bad0.length === 0, `② 向き直しの無い時間切れの車の見立ては「コース/プログラムは破綻していません」と断定しない（${to0.slice(0, 2).map((r) => `${r.name}:「${(rowOf(rows, r.name) || [])[4]}」`).join(' ')}）`);
}

console.log(`\n③ ライブ ▶「${C1}」の突き合わせ（ライブ経路の写し wf_bg_live.mjs で node 再生）`);
{
  const e = live.env, rec = live.rec;
  ok(e.cars === N && e.courseName === C1 && e.speed === 3 && e.recover && e.interact && e.physics === MODE,
    `③ UI が既定設定（${JSON.stringify({ cars: e.cars, course: e.courseName, speed: e.speed, recover: e.recover, interact: e.interact, physics: e.physics, regime: e.regime, userK: e.userK })}）`);
  ok(e.cols.length === N && e.cols.every((c) => c.lang === prog.lang && c.src === prog.code), '③ 各車のプログラムが UI の既定（Python 版 Apex Hunter）');
  const course = buildCourse(C1);
  const L = liveSetup(M, { course, regime: e.regime, n: N, mode: MODE, userK: e.userK, progKey: PROG });
  ok(L.nUse === N, `③ フィットガードの後も ${N} 台（node ${L.nUse} 台）`);
  const carLen = M.config.CAR.length;
  const F = M.config.CAR_FOOTPRINT, k = M.config.VIEW.carScale, hM = L.course.bounds.h;
  const order = Array.from({ length: N }, (_, i) => i).sort((x, y) => (x === e.activeIdx) - (y === e.activeIdx));   // main.js render は選択中の車を最後に描く
  const drawn = (c) => { const [nx, ny, tx, ty] = c; const s = Math.hypot(nx - tx, ny - ty) / ((F.front - F.back) * k); return { x: (nx + tx) / 2 / s, y: hM - (ny + ty) / 2 / s }; };
  const nodePt = (car) => { const off = (F.front + F.back) / 2 * k; return { x: car.x + off * Math.cos(car.theta), y: car.y + off * Math.sin(car.theta) }; };
  let tPrev = rec.t0prev, simT = 0, maxDev = 0, compared = 0, nonFinite = 0;
  const skipped = [], traj = [];
  for (let j = 0; j < rec.frames.length; j++) {
    const t = rec.frames[j].t;
    const sdt = rec.speed * Math.min(0.05, (t - tPrev) / 1000); tPrev = t;
    liveFrame(L, sdt); simT += sdt;
    traj.push(L.slots.map((s) => [s.car.x, s.car.y, s.car.theta]));
    if (j + 1 >= rec.frames.length) break;                       // 最後のフレームの描画は記録に無い（位置の比較はここまで）
    const bc = rec.frames[j + 1].cars;
    if (bc.length !== L.slots.length) { skipped.push(j); continue; }
    const bb = new Array(N); bc.forEach((c, d) => { bb[order[d]] = drawn(c); });
    const nn = L.slots.map((s) => nodePt(s.car));
    for (let i = 0; i < N; i++) {
      const v = [bb[i].x, bb[i].y, nn[i].x, nn[i].y];
      if (!v.every(Number.isFinite)) { nonFinite++; maxDev = Infinity; continue; }
      const dev = Math.hypot(bb[i].x - nn[i].x, bb[i].y - nn[i].y);
      if (!(dev <= maxDev)) maxDev = dev;
    }
    compared++;
  }
  const MIN_FRAMES = Math.floor(LIVE_SEC / (rec.speed * 0.05)) - 2;
  ok(compared >= MIN_FRAMES && skipped.every((j) => j <= 1), `③ 比べられないフレームは ▶ 直後の 2 フレームまで（比べた ${compared} ≥ ${MIN_FRAMES}・比べられない ${skipped.length}）`);
  ok(nonFinite === 0 && maxDev < MAX_DEV_M, `③ 全フレーム・全車で描かれた位置と node 再生の位置が一致（最大差 ${(maxDev * 1e6).toFixed(3)} µm < ${MAX_DEV_M * 1e6} µm・有限でない ${nonFinite} 件）`);
  const nodeM = L.slots.map((s) => s.car._marshal || 0);
  const uiM = rec.serials.map((s) => s.split(LOG_JA).length - 1);
  console.log(`    向き直しの回数: node 再生 ${nodeM.join('/')}／シリアル出力の行数 ${uiM.join('/')}`);
  ok(uiM.length === N && JSON.stringify(uiM) === JSON.stringify(nodeM), `③ 各車のシリアル出力の「${LOG_JA}」の行数 = node 再生の向き直しの回数（車ごと）`);
  ok(uiM.reduce((t, v) => t + v, 0) >= 1, `③ ライブ ▶ で向き直しのログが出た（計 ${uiM.reduce((t, v) => t + v, 0)} 行）`);
  const ms = measure(ringOf(course), traj, carLen), maxB = Math.max(...ms.map((m) => m.maxB));
  ok(maxB <= W_MAX, `③ 向きが逆のまま逆へ進んだ距離は、どの車も ${W_MAX} 車長以下（最大 ${maxB.toFixed(2)} 車長・車長 ${(carLen * 1000).toFixed(0)} mm）`);
}

console.log('\n④ エラー');
ok(errors.length === 0, `JS/HTTP エラー 0（${errors.length}: ${JSON.stringify(errors.slice(0, 3))}）／想定内 ${benign.length}: ${JSON.stringify(benign.slice(0, 3))}`);

console.log(`\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗:\n  - ' + fails.join('\n  - ')); process.exit(1); }
console.log('結果: PASS');
