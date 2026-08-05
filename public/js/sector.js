// 区間 (sector) 別テレメトリ比較 — Stage AS / AS13。
// 正準スペック docs/phase_w/W_spec.md §8 の任意バックログ「テレメトリ区間別並走比較」の**純ロジック**実装。
// DOM を持たず決定論的 (Math.random/Date 不使用)。すべてゴーストフレームからの「観測のみ」＝
// race_engine は非改変ゆえ verifyHash/traceHash は不変 (ghost_gap.js と同じ契約・CI-5)。
//
// ── 区間の定義 (代理量でなく実態を測るための選択・CI-14) ────────────────────────────
// 1 周を **その車がその周に実際に走った距離** で k 等分する (時間等分でも角度等分でもない)。距離は
// ghost_gap.ghostCumDist の累積走行距離をそのまま使う (テレポート抑制済み・新しい概念はゼロ)。
//   - 時間等分にすると「速い車ほど先の区間まで進む」だけになり比較にならない。
//   - 角度/座標等分は周回コース以外 (峠・非凸レイアウト) で定義できない。
//   - 距離等分なら「同じ道のりを行くのに何秒かかったか」を車どうしで直接比べられる。
// ∴ ライン取りが違えば区間境界の**地図上の位置**は車ごとに少しずれる。これは正規化の帰結であって
// 実機のセクター計時 (コース側の検出線で決まる) の模倣ではない — 記録は検出線を持たないので採れない。
//
// ── 時間分解能 (正直な限界) ──────────────────────────────────────────────────
// ゴーストは GHOST_EVERY tick ごとの間引き (既定 dt = 1/12 s)。区間境界の交差は累積距離を線形補間して
// **実数フレーム**で求めるので「区間の和 = その周の所要時間」は厳密に成り立つ (丸め誤差のみ)。一方
// **周回境界そのものは間引き格子に量子化**される ⇒ ここで出る周回時間は公式タイムではない
// (公式は runRace の finishers/bestLapMs が正)。UI はその旨を明示すること。

import { ghostCumDist } from './ghost_gap.js';

// 区間数の既定。競技の慣行 (S1/S2/S3) に合わせた**規定**であって物理定数ではない (呼出側で変更可)。
export const SECTORS_DEFAULT = 3;

// 単調非減少配列 arr の区間 [lo,hi] で値 v に到達する**実数インデックス**を返す (線形補間)。
// v <= arr[lo] は lo、v >= arr[hi] は hi にクランプ。二分探索ゆえ O(log n)・決定論。
export function crossIndex(arr, lo, hi, v) {
  if (hi <= lo) return lo;
  if (v <= arr[lo]) return lo;
  if (v >= arr[hi]) return hi;
  let a = lo, b = hi;                       // arr[a] <= v < arr[b] を保つ
  while (b - a > 1) { const m = (a + b) >> 1; if (arr[m] <= v) a = m; else b = m; }
  const d = arr[b] - arr[a];
  return d > 0 ? a + (v - arr[a]) / d : a;
}

// 車 ci の周回境界フレーム。bframe[L] = 「L 周完了した最初のフレーム」(bframe[0] = 0 = 発走)。
// laps は単調非減少 (race_engine の LapTracker が計上) なので 1 パスで拾える。
function lapBoundaryFrames(frames, ci) {
  const nf = frames.length;
  const bframe = [0];
  let pl = 0;
  for (let fi = 0; fi < nf; fi++) {
    const p = frames[fi][ci];
    const L = p ? (p.laps | 0) : 0;
    while (L > pl) { pl++; bframe[pl] = fi; }
  }
  return bframe;
}

// 1 周ぶんの区間時間。startFi/endFi は周回境界フレーム (整数)。cum は累積距離。
// 区間境界は距離の等分点で、交差フレームを線形補間して求める ⇒ **和は (endFi-startFi)*dt に厳密一致**。
function sectorsOfLap(cum, startFi, endFi, k, dt) {
  const d0 = cum[startFi], d1 = cum[endFi];
  const span = d1 - d0;
  const marks = [startFi];
  for (let j = 1; j < k; j++) {
    // 距離が伸びない (停止したまま周回計上=ありえないが防御) 場合はフレームを等分してクランプ。
    const fx = span > 0 ? crossIndex(cum, startFi, endFi, d0 + span * (j / k))
                        : startFi + (endFi - startFi) * (j / k);
    marks.push(Math.max(marks[marks.length - 1], fx));   // 非減少を保証 (境界の重なりは 0 秒区間)
  }
  marks.push(endFi);
  const sectors = [];
  for (let j = 0; j < k; j++) sectors.push((marks[j + 1] - marks[j]) * dt);
  return { sectors, lapSec: (endFi - startFi) * dt, marks };
}

// ゴースト 1 本ぶんの区間解析。
//   ghost  = runRace の res.ghost { frames, dt, names, carTypes }
//   bounds = コースの bounds { w, h } (ghostCumDist のテレポート抑制上限に使う)
//   k      = 区間数 (既定 SECTORS_DEFAULT)
// 戻り値:
//   { k, dt, lapsCounted, cars[], bestOf[], holderOf[], theoreticalBestSec, bestLapSec, gainSec }
//     cars[ci]     = { ci, name, carType, laps[], bestSectors[], bestLapSec }
//     bestOf[j]    = 全車・全周を通じた区間 j の最速タイム (秒・無ければ null)
//     holderOf[j]  = その保持者の ci (無ければ null)
//     theoreticalBestSec = 各区間の最速の和 (= 「理論ベストラップ」・定義上 実ベスト以下)
//     gainSec      = 実ベストラップ − 理論ベスト (= 1 周のなかで取りこぼしている合計)
export function sectorAnalysis(ghost, bounds, k = SECTORS_DEFAULT) {
  const frames = (ghost && ghost.frames) || [];
  const names = (ghost && ghost.names) || [];
  const nc = names.length;
  const dt = (ghost && ghost.dt) || 0;
  const K = Math.max(1, Math.round(k));
  const empty = { k: K, dt, lapsCounted: 0, cars: [], bestOf: new Array(K).fill(null),
    holderOf: new Array(K).fill(null), theoreticalBestSec: null, bestLapSec: null, gainSec: null };
  if (!frames.length || !nc || !(dt > 0)) return empty;

  const cum = ghostCumDist(frames, nc, (bounds && bounds.w) || 1, (bounds && bounds.h) || 1);
  const cars = [];
  let lapsCounted = 0;
  for (let ci = 0; ci < nc; ci++) {
    const bframe = lapBoundaryFrames(frames, ci);
    const laps = [];
    for (let L = 0; L + 1 < bframe.length; L++) {
      const startFi = bframe[L], endFi = bframe[L + 1];
      if (endFi <= startFi) continue;                       // 同一フレームで 2 周計上 (ありえないが防御)
      const s = sectorsOfLap(cum[ci], startFi, endFi, K, dt);
      laps.push({ lap: L + 1, startFi, endFi, lapSec: s.lapSec, sectors: s.sectors });
      lapsCounted++;
    }
    // 自己ベスト区間 (周をまたいで各区間の最速) と自己ベストラップ。
    const bestSectors = new Array(K).fill(null);
    let bestLapSec = null;
    for (const lp of laps) {
      for (let j = 0; j < K; j++) if (bestSectors[j] == null || lp.sectors[j] < bestSectors[j]) bestSectors[j] = lp.sectors[j];
      if (bestLapSec == null || lp.lapSec < bestLapSec) bestLapSec = lp.lapSec;
    }
    cars.push({ ci, name: names[ci], carType: (ghost.carTypes || [])[ci] || '', laps, bestSectors, bestLapSec });
  }

  // 全車横断の区間最速と保持者 (タイブレーク = ci 昇順 ⇒ 決定論)。
  const bestOf = new Array(K).fill(null), holderOf = new Array(K).fill(null);
  for (let j = 0; j < K; j++) {
    for (const c of cars) {
      const v = c.bestSectors[j];
      if (v == null) continue;
      if (bestOf[j] == null || v < bestOf[j]) { bestOf[j] = v; holderOf[j] = c.ci; }
    }
  }
  const complete = bestOf.every((v) => v != null);
  const theoreticalBestSec = complete ? bestOf.reduce((a, b) => a + b, 0) : null;
  let bestLapSec = null;
  for (const c of cars) if (c.bestLapSec != null && (bestLapSec == null || c.bestLapSec < bestLapSec)) bestLapSec = c.bestLapSec;
  const gainSec = (theoreticalBestSec != null && bestLapSec != null) ? (bestLapSec - theoreticalBestSec) : null;
  return { k: K, dt, lapsCounted, cars, bestOf, holderOf, theoreticalBestSec, bestLapSec, gainSec };
}

// ある車のある周について、各区間が「その区間の全車最速」から何秒離れているかの配列 (差分・秒)。
// UI が紫 (区間最速) / 差の色分けに使う。最速本人は 0。
export function sectorDeltas(lap, bestOf) {
  return lap.sectors.map((v, j) => (bestOf[j] == null ? null : v - bestOf[j]));
}
