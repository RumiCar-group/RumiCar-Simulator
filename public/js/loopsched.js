// loopsched.js — live 走行（main.js frame）の学習プログラム loop() の呼び出しの段取り（Stage BL・BL6・2026-10-17）。
// DOM・物理に触れない。main.js frame() が runLiveFrame を呼び、常設ゲート wf_bl1_ui.mjs J 章とライブ経路の写し
// wf_bg_live.mjs が同じ関数を import して測る（段取りの写しを作らない・CI-9）。決定論レースエンジン（race_engine.js・
// 固定 60 Hz で「tick → 積分」を回す）はこの関数を使わない＝公式レース・verifyHash・凍結ハッシュ f0〜f3 には効かない。
//
// 【是正前（v10.3.0）】frame は 1 フレームの sim 時間 sdt = min(0.05, Δt) × 速度 を物理に全部積分するのに、loop() は
//   `loopTimer -= sdt; if (loopTimer <= 0) { tick; loopTimer += 1/loopHz + delay }` で 1 フレーム 1 回まで。
//   sdt > 1/loopHz で loop() はフレームの数に落ち（30 fps×3× で約 10 Hz・1 フレーム 50 ms 超×3× で約 6.7 Hz。速度の既定は 3× で、
//   60 fps でも Δt が 16.7 ms を超えたフレームの分だけ落ちる＝実ブラウザの実測 17.4〜18.2 Hz）、loopTimer は下限なく負へ溜まり
//   （60 sim 秒で 30 s）、条件が戻った後も溜まった分だけ毎フレーム呼ばれた（60 fps×1× で約 60 回 / sim 秒）。
//
// 【段取り】1 フレームの sdt を loop の周期 P = 1/loopHz で刻み（liveSlices）、区間ごとに
//   「各スロットの loopTimer を区間ぶん進める → 期限が来ていれば loop() を 1 回 → その区間を物理に積分」を繰り返す。
//   ・区間は P ちょうどを先に並べ、P に満たない端数を最後に 1 つ。sdt ≤ P のフレームは区間 1 つ＝sdt そのもの。
//     P は物理のサブステップ 1/physicsHz の整数倍（20 Hz と 60 Hz で 3 倍）なので、区間に分けても積分の中のサブステップの
//     並び（h, h, …, 端数）は 1 回で積分したときと同じ（浮動小数の丸めの差を除く）。変わるのは、その間に loop() が入ることだけ。
//   ・区間 ≤ P なので 1 区間の loop() は高々 1 回で足り、loopTimer は区間の途中でも −P を下回らない（負債が溜まらない）。
//   ・sdt ≤ P のフレーム（60 fps×1×、60 fps×3× で Δt ≤ 16.7 ms）は区間 1 つで、是正前と同じ呼び出し・同じ値
//     （loopTimer の引き算・`<= 0` の比較・足し算の式と順も是正前と同じ）。
//   ・期限の来た loop() は、その区間の始まりの姿勢で呼ぶ（是正前の「期限がそのフレームの中に来たらフレームの始まりで呼ぶ」と同じ規則を
//     区間に当てた形）。∴ loop() の呼ばれる時刻は期限より最大 1 区間（≤ P）早い。
//
// 【1 フレームの loop() の回数の上限 LIVE_MAX_TICKS_PER_FRAME = 3 とその根拠】
//   区間の数＝1 台あたりの 1 フレームの loop() の回数の上限＝integrateLive の呼び出し回数。frame は 1 フレームの実時間を 0.05 s で
//   打ち切り（main.js frame の Math.min(0.05, …)）、速度スライダーの上限は 3（index.html #speed の max）なので、UI で出せる sdt の
//   最大は 0.15 s＝loopHz 20 で 3 周期。上限はこの値にそろえた＝UI で出せる条件では上限に当たらない。上限は「1 フレームの仕事
//   （全車の loop()＋積分）を UI の最大で打ち切る安全網」で、速度の上限・loopHz・1 フレームの打ち切りを変えたときにだけ効く
//   （wf_bl1_ui.mjs J 章が index.html の max・main.js の打ち切り・SIM.loopHz から UI の最大の区間の数 ≤ 上限 を測る）。
//   上限に当たったときの挙動: 区間を上限の数にまとめ（最後の区間が P より長くなる）、物理は sdt を全部積分する。loop() は区間ごとに
//   高々 1 回なので sim 時間に対する頻度は下がり、取りこぼした分は loopTimer の下限 −P で捨てる（負債を溜めない＝条件が戻った直後に
//   loop() が詰めて呼ばれることはない）。
//
// 【delay()】delay(ms)・sleep(s) は world._pendingDelay [ms] に積まれ（api.js）、その回の loop() の後に loopTimer へ P と一緒に足す
//   （是正前と同じ式・同じ順。tick が返した値を使う）。次の loop() は P＋delay の後に期限が来る。負の delay（例 delay(-1000)）は
//   是正前、溜まった負債として毎フレーム loop() を呼ぶ形で返していた（60 fps×1× でも）。是正後は下限 −P で捨てる（次の区間で
//   loop() を呼ぶところまで＝毎回負の delay を呼ぶプログラムは区間ごとに 1 回）。loopTimer は区間を進めた直後も loop() の後も −P を
//   下回らない（liveLoopAdvance・liveLoopRearm の下限）。delay ≥ 0 で sdt ≤ P のフレームはどちらの下限にも当たらない。

// 1 フレームの loop() の回数の上限（1 台あたり）。根拠は冒頭。
export const LIVE_MAX_TICKS_PER_FRAME = 3;

// 1 フレームの sim 時間 sdt [s] を区間 [s] の配列に刻む（純関数）。
//   sdt < P（0 以下・NaN を含む）と sdt ≈ P は [sdt]（是正前と同じ 1 回の積分）。それ以外は P を k 個（k = floor(sdt/P)。sdt が P の
//   整数倍のときの丸め誤差 1e-9 周期を許す）と端数 1 つ（端数が 1e-9 周期以下なら最後の P に足す）。区間の数が maxTicks を超えたら
//   maxTicks 個にまとめる（最後の区間が残りを全部持つ）。区間の合計は sdt（最後の区間を引き算で作る）。
export function liveSlices(sdt, loopHz, maxTicks = LIVE_MAX_TICKS_PER_FRAME) {
  const P = 1 / loopHz;
  const k = Math.floor(sdt * loopHz + 1e-9);
  if (!(k >= 1)) return [sdt];
  const n = (sdt - k * P) > 1e-9 * P ? k + 1 : k;
  if (n <= 1) return [sdt];
  const cap = Math.floor(maxTicks);
  const m = cap >= 1 ? Math.min(n, cap) : 1;              // 上限が 1 未満・NaN なら 1（区間 1 つ）
  if (m <= 1) return [sdt];
  const out = new Array(m).fill(P);
  out[m - 1] = sdt - (m - 1) * P;
  return out;
}

// 区間 dt [s] ぶん loopTimer [s] を進める（純関数）。下限 −P＝それより古い期限（取りこぼした loop()）は捨てる。
//   区間 ≤ P・loopTimer ≥ 0 のときは下限に当たらない（是正前と同じ loopTimer − dt）。
export function liveLoopAdvance(loopTimer, dt, loopHz) {
  const t = loopTimer - dt;
  const floor = -1 / loopHz;
  return t < floor ? floor : t;
}

// loop() を 1 回呼んだ後の loopTimer（純関数）。pendingDelayMs＝その回の loop() が積んだ delay の合計 [ms]。
//   式と順は是正前の `loopTimer += (1 / SIM.loopHz) + (world._pendingDelay || 0) / 1000` と同じ。下限 −P は負の delay の分だけに効く
//   （delay ≥ 0 なら loop() を呼ぶ直前の loopTimer ≥ −P に P 以上を足すので 0 以上＝下限に当たらない）。
export function liveLoopRearm(loopTimer, loopHz, pendingDelayMs) {
  const t = loopTimer + ((1 / loopHz) + (pendingDelayMs || 0) / 1000);
  const floor = -1 / loopHz;
  return t < floor ? floor : t;
}

// 1 フレームぶんの段取り。slots＝{ running, loopTimer } の配列（main.js の slots）。loopTimer はここで書き換える。
//   tick(slot, i, k)  … 区間 k で期限の来たスロット i の loop() を 1 回呼び、その回に積まれた delay [ms] を返す。
//   integrate(dt, k)  … 区間 k（dt 秒）を物理に積分する（区間ごとに 1 回・全スロットの tick の後）。
// 戻り: { slices（区間の配列）, ticks（呼んだ loop() の総数）}。
export function runLiveFrame(sdt, loopHz, slots, tick, integrate, maxTicks = LIVE_MAX_TICKS_PER_FRAME) {
  const slices = liveSlices(sdt, loopHz, maxTicks);
  let ticks = 0;
  for (let k = 0; k < slices.length; k++) {
    const dt = slices[k];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s.running) continue;
      s.loopTimer = liveLoopAdvance(s.loopTimer, dt, loopHz);
      if (s.loopTimer <= 0) {
        const d = tick(s, i, k);
        s.loopTimer = liveLoopRearm(s.loopTimer, loopHz, d);
        ticks++;
      }
    }
    integrate(dt, k);
  }
  return { slices, ticks };
}
