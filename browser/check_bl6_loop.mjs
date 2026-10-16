// check_bl6_loop.mjs — BL6 live の loop() の頻度（低 fps×速度 3×）の実ブラウザ検証 (headed Chrome on Xvfb)
// ═════════════════════════════════════════════════════════════════════════════════════
// 受け入れ基準 (PLAN BL6) のうち **卓上ゲート (wf_bl1_ui.mjs J 章＝本番のスケジューラを node で呼ぶ) では測れない部分**
// ＝「本物のページの frame() が、本物の rAF の間隔で、loop() を sim 時間あたり何回呼んだか」を測る:
//   利用者と同じ UI 操作だけで 1 台の車に「loop() のたびに回数を print する」Python プログラムを載せて ▶ し、
//   列のシリアル出力 (.cc-serial の最後の行＝それまでの loop() の回数) と、main.js frame() と同じ式
//   sdt = 速度 × min(0.05, Δt) で数えた sim 時間から、区間ごとの loop() の頻度 [回 / sim 秒] を出す。
//   低 fps はページの rAF に毎フレームの忙し待ちを足して作る (init script・product は触らない)。速度は #speed の input。
//   ① 60 fps×3× (負荷なし)・② 約 30 fps×3× (25 ms の負荷＝sdt ≈ 0.1)・③ 1 フレーム 50 ms 超×3× (70 ms の負荷＝sdt = 0.15)
//      で loop() の頻度が loopHz (ページの config.js の SIM.loopHz) の ±5 %。
//   ④ ③ の直後に負荷を外し速度を 1× に戻した最初の 1 sim 秒の loop() の回数が loopHz ± 1・続く 5 sim 秒の頻度が ±5 %。
//   ⑤ JS エラー 0。
//   参考（BL6 fix1・合否に使わない）: ① の窓で sdt が 1 周期を超え区間に分けたフレームの数と、その sdt の列を product の runLiveFrame で
//   再生したときの loop() の間隔（最短・5 ms 未満の回数＝端数の区間の始まりと次のフレームの始まりで続けて呼ばれた回数）。
//   前提の照合 (外れたら合否の前に ✗): ② の sdt の中央値が 1.5 周期以上 (＝是正前の if が 1 フレーム 1 回で取りこぼす条件)・
//   ③ の sdt の中央値が速度×0.05 (＝1 フレームの上限に当たる条件)・④ の Δt の中央値が 1 周期未満 (60 fps 相当)。
//
// 是正前 (fee6e7a まで・v10.3.0) は main.js frame の `if (s.loopTimer <= 0)` が 1 フレーム 1 回までで、loopTimer は下限なく負へ
// 溜まった (2026-10-17 の実測): ① も Δt が 16.7 ms を超えるフレームの分だけ落ちて 17.4〜18.2 Hz・② 約 10 Hz・③ 6.67 Hz、④ は溜まった負債を
// 1 フレーム 1 回で返すので 60 fps×1× でも約 57〜60 回 / sim 秒 (すべて赤)。是正前の木で測るには、その木の public/ を 127.0.0.1 で配信して
//   RC_URL=http://127.0.0.1:<port>/ bash run.sh check_bl6_loop.mjs   (例: git archive fee6e7a public | tar -x -C <dir> → python3 -m http.server)
//
// 使い方: cd browser && bash run.sh check_bl6_loop.mjs   （所要: 約 1 分）
import { launch, newPage, appModule } from './lib.mjs';
import { runLiveFrame, liveSlices } from '../public/js/loopsched.js';   // 参考の再生だけに使う（合否には使わない・BL6 fix1）

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } return c; };

const PROG = 'n = 0\ndef loop():\n    global n\n    n += 1\n    print(n)\n';

console.log('check_bl6_loop — live の loop() の頻度を、本物のページの rAF の間隔と速度倍率で測る');
const browser = await launch();
let rec = null, loopHz = null, env = null;
let errors = [], benign = [];
try {
  const np = await newPage(browser, {
    width: 1440, height: 900,
    before: async (p) => {
      await p.addInitScript(() => {
        try { localStorage.setItem('rumicar.lang', 'ja'); } catch (e) {}
        // main.js より先に登録される rAF＝各フレームで main の frame() より先に呼ばれる (check_bg3_live_replay と同じ作法)。
        // ∴ このコールバックで読む .cc-serial は「直前のフレームで main が書いた値」。時刻 t は同じフレームの main と同じ。
        const B = window.__bl6 = { on: false, frames: [], loadMs: 0, simT: 0, prevT: null };
        const lastN = () => {
          const el = document.querySelector('#fleetCols .carcol .cc-serial');
          const s = el ? el.textContent : '';
          const m = /(\d+)\s*$/.exec(s);
          return m ? Number(m[1]) : 0;
        };
        const loop = (t) => {
          if (B.on) {
            const sp = Number(document.getElementById('speed').value);
            B.frames.push({ t, pt: B.prevT, n: lastN(), speed: sp, load: B.loadMs });
            if (B.prevT != null) B.simT += sp * Math.min(0.05, (t - B.prevT) / 1000);
            if (B.loadMs > 0) { const t0 = performance.now(); while (performance.now() - t0 < B.loadMs) { /* 忙し待ち */ } }
          }
          B.prevT = t;
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
        document.addEventListener('click', (e) => { if (e.target && e.target.id === 'run' && !B.on) B.on = true; }, true);
      });
    },
  });
  const { page } = np;
  errors = np.errors; benign = np.benign;
  loopHz = await appModule(page, 'js/config.js', (m) => m.SIM.loopHz);

  // ── 操作: 1 台・速度 3×（既定）のまま、列のエディタに数えるプログラムを書いて ▶ ─────────────
  env = await page.evaluate(() => ({ cars: document.querySelectorAll('#fleetCols .carcol').length, lang: document.querySelector('#fleetCols .carcol .cc-lang').value, speed: Number(document.getElementById('speed').value) }));
  await page.fill('#fleetCols .carcol .cc-editor', PROG);
  await page.waitForTimeout(300);
  await page.click('#run');
  const until = (sec, timeout = 120000) => page.waitForFunction((s) => window.__bl6.simT >= s, sec, { timeout, polling: 100 }).then(() => true).catch(() => false);
  const setPhase = (loadMs, speed) => page.evaluate(([l, s]) => {
    window.__bl6.loadMs = l;
    const sp = document.getElementById('speed');
    if (Number(sp.value) !== s) { sp.value = String(s); sp.dispatchEvent(new Event('input', { bubbles: true })); }
    window.__bl6.frames.push({ mark: true, loadMs: l, speed: s });
  }, [loadMs, speed]);
  const simNow = () => page.evaluate(() => window.__bl6.simT);

  // 各区間は測る窓より 1 sim 秒長く回す（区間の終わりは waitForFunction の検出までずれるので、窓の終わりの点が必ず区間の中にあるように）。
  // ① 60 fps×3×（負荷なし）: 2 sim 秒の助走の後、窓 [0,10] sim 秒
  let s = 0;
  const reached = [];
  reached.push(await until(s += 2));
  await setPhase(0, 3); reached.push(await until(s += 11));
  // ② 約 30 fps×3×（25 ms の負荷）: 窓 [1,21] sim 秒（最初の 1 sim 秒は助走）
  await setPhase(25, 3); reached.push(await until(s += 22));
  // ③ 1 フレーム 50 ms 超×3×（70 ms の負荷）: 窓 [1,21] sim 秒
  await setPhase(70, 3); reached.push(await until(s += 22));
  // ④ 負荷を外し 1× に戻す: 窓 [0,1]（最初の 1 sim 秒）と [1,6] sim 秒
  await setPhase(0, 1); s = await simNow(); reached.push(await until(s + 7));
  rec = await page.evaluate(() => { const B = window.__bl6; B.on = false; return B.frames; });
  await page.click('#stop').catch(() => {});
  ok(reached.every(Boolean), `各区間の sim 時間に届いた（${reached.map((r) => (r ? '○' : '✗')).join('')}）`);
} finally {
  await browser.close();
}

// ── 記録 → 区間ごとの頻度 ───────────────────────────────────────────────────────────
// frames[j]＝時刻 t_j のフレームで main の frame() より先に読んだ値: n_j は「main のフレーム j−1 の後」の loop() の回数、speed_j は
// main のフレーム j が使う速度（同じフレームの中で #speed は変わらない）、pt_j＝t_{j−1}。main のフレーム j の sdt は
//   sdt_j = speed_j × min(0.05, (t_j − t_{j−1}) / 1000)（main.js frame と同じ式）
// なので、n_j と対になる sim 時間は sim(j) = Σ_{i<j} sdt_i（フレーム j−1 まで）。
const P = 1 / loopHz;
const F = [];
let phase = -1, simT = 0;
for (const f of rec) {
  if (f.mark) { phase++; continue; }
  const dt = f.pt == null ? 0 : (f.t - f.pt) / 1000;
  const sdt = f.speed * Math.min(0.05, dt);
  F.push({ ...f, sim: simT, phase, sdt, dt });
  simT += sdt;
}
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
// 区間 k の [a, b] sim 秒（区間の始まりからの相対）での頻度。
function rate(k, a, b) {
  const fr = F.filter((f) => f.phase === k);
  if (!fr.length) return null;
  const s0 = fr[0].sim;
  const at = (x) => fr.find((f) => f.sim >= s0 + x);
  const fa = at(a), fb = at(b);
  if (!fa || !fb) return null;
  return { hz: (fb.n - fa.n) / (fb.sim - fa.sim), count: fb.n - fa.n, span: fb.sim - fa.sim,
    sdtMed: med(fr.filter((f) => f.sim >= fa.sim && f.sim <= fb.sim).map((f) => f.sdt)),
    dtMed: med(fr.filter((f) => f.sim >= fa.sim && f.sim <= fb.sim).map((f) => f.dt)) };
}
console.log(`\n前提: 1 台 ${env.cars}・言語 ${env.lang}・速度 ${env.speed}×（既定）・loopHz ${loopHz}・記録 ${F.length} フレーム`);
ok(env.cars === 1 && env.lang === 'py' && env.speed === 3, `UI が既定（1 台・Python・速度 3×）`);
const lo = loopHz * 0.95, hi = loopHz * 1.05;
const fmt = (r) => r ? `${r.hz.toFixed(2)} Hz（${r.count} 回 / ${r.span.toFixed(2)} sim 秒・sdt 中央値 ${r.sdtMed.toFixed(4)} s・Δt 中央値 ${(r.dtMed * 1000).toFixed(1)} ms）` : '測れない';

console.log('\n① 60 fps×3×（負荷なし）');
const r1 = rate(0, 0, 10);
ok(!!r1 && r1.hz >= lo && r1.hz <= hi, `loop() の頻度 ${fmt(r1)} が ${lo.toFixed(1)}〜${hi.toFixed(1)} Hz`);
// 参考（BL6 fix1・層4 F3。合否には使わない）: ① の窓のフレームのうち sdt が 1 周期を超えて区間に分けたもの（＝物理も区間ごとに積分し、
// 軌跡が是正前と変わりうるフレーム）の数と、その sdt の列を product の runLiveFrame で 1 台ぶん再生したときの loop() の間隔
// （最短・5 ms 未満の回数）。Xvfb の rAF の揺れは利用者の画面と違うので、値は「この環境ではこうだった」の記録。
{
  const fr = F.filter((f) => f.phase === 0);
  const s0 = fr.length ? fr[0].sim : 0;
  const win = fr.filter((f) => f.sim >= s0 && f.sim < s0 + 10);
  const split = win.filter((f) => liveSlices(f.sdt, loopHz).length > 1).length;
  const slot = { running: true, loopTimer: 0 }; let t = 0; const tk = [];
  for (const f of win) runLiveFrame(f.sdt, loopHz, [slot], () => { tk.push(t); return 0; }, (dt) => { t += dt; });
  const iv = tk.slice(1).map((x, i) => x - tk[i]);
  console.log(`  参考: sdt が 1 周期を超え区間に分けたフレーム ${split}/${win.length}・その列を runLiveFrame で再生した loop() の間隔 最短 ${iv.length ? (Math.min(...iv) * 1000).toFixed(2) : '—'} ms・5 ms 未満 ${iv.filter((x) => x < 0.005).length} 回（${tk.length} 回中）`);
}

console.log('\n② 約 30 fps×3×（25 ms の負荷）');
const r2 = rate(1, 1, 21);
ok(!!r2 && r2.sdtMed >= 1.5 * P, `前提: sdt の中央値 ${r2 ? r2.sdtMed.toFixed(4) : '—'} s ≥ 1.5 周期（${(1.5 * P).toFixed(3)} s）`);
ok(!!r2 && r2.hz >= lo && r2.hz <= hi, `loop() の頻度 ${fmt(r2)} が ${lo.toFixed(1)}〜${hi.toFixed(1)} Hz`);

console.log('\n③ 1 フレーム 50 ms 超×3×（70 ms の負荷）');
const r3 = rate(2, 1, 21);
ok(!!r3 && Math.abs(r3.sdtMed - 3 * 0.05) < 1e-9, `前提: sdt の中央値 ${r3 ? r3.sdtMed.toFixed(4) : '—'} s ＝ 3 × 0.05（1 フレームの上限）`);
ok(!!r3 && r3.hz >= lo && r3.hz <= hi, `loop() の頻度 ${fmt(r3)} が ${lo.toFixed(1)}〜${hi.toFixed(1)} Hz`);

console.log('\n④ 負荷を外し速度 1× に戻した直後');
const r4a = rate(3, 0, 1), r4b = rate(3, 1, 6);
ok(!!r4b && r4b.dtMed < P, `前提: Δt の中央値 ${r4b ? (r4b.dtMed * 1000).toFixed(1) : '—'} ms < 1 周期（60 fps 相当）`);
ok(!!r4a && Math.abs(r4a.count - loopHz * r4a.span) <= 1, `最初の 1 sim 秒の loop() の回数 ${r4a ? r4a.count : '—'}（${r4a ? r4a.span.toFixed(3) : '—'} sim 秒）が ${loopHz} ± 1`);
ok(!!r4b && r4b.hz >= lo && r4b.hz <= hi, `続く 5 sim 秒の頻度 ${fmt(r4b)} が ${lo.toFixed(1)}〜${hi.toFixed(1)} Hz`);

console.log('\n⑤ エラー');
ok(errors.length === 0, `JS/HTTP エラー 0（${errors.length}: ${JSON.stringify(errors.slice(0, 3))}）／想定内 ${benign.length}`);

console.log(`\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗:\n  - ' + fails.join('\n  - ')); process.exit(1); }
console.log('結果: PASS');
