// AB11 (PX-004): 観戦リプレイの車間(gap)/順位/オーバーテイクの算出 — 純関数 (DOM 非依存)。
// すべてゴーストフレーム ({x,y,th,crashed,laps}) からの「観測のみ」算出なので race_engine は非改変＝
// verifyHash/traceHash は不変 (CI-5・W1)。node↔browser で同一コードを使うため独立モジュールに分離し、
// 本番エンジンの ghost 出力に対して node ハーネス (wf_ab11_verify.mjs) で再確認する (CI-9)。
//
// 進行度モデル (ghostProgressModel)。距離だけでは順位を誤る2点を吸収する:
//   ① レーシングラインの差で「走行距離」がぶれる → 各車の平均1周距離で正規化した「周回+周回内割合」を使う。
//   ② 完走車はみな同じ総距離で惰行停止するため距離では区別不能 → 完走車は「完走の早さ(finish frame)」で順位。
// よって racing 中は rp=laps+正規化割合 (単調増加)、完走後は finishFi で序列化＝エンジンの着順と一致する。

// 各車の累積走行距離をフレーム別に算出 (rejoin 復帰のテレポートは抑制)。frames[fi][ci]={x,y,crashed,laps}。
export function ghostCumDist(frames, nc, boundsW, boundsH) {
  const nf = frames.length;
  const cap = Math.max(0.5, 0.25 * Math.min(boundsW, boundsH));  // テレポート抑制上限 (m)
  const cum = [];
  for (let ci = 0; ci < nc; ci++) {
    const arr = new Float64Array(nf);
    let d = 0;
    for (let fi = 1; fi < nf; fi++) {
      const p0 = frames[fi - 1][ci], p1 = frames[fi][ci];
      if (p0 && p1 && !p0.crashed) {
        const step = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        if (step <= cap) d += step;
      }
      arr[fi] = d;
    }
    cum.push(arr);
  }
  return cum;
}

// 進行度モデルを前計算 (リプレイ開始時に一度)。返り値の rp[ci][fi] は単調増加の racing 進行度
// (laps + 正規化周回内割合)、finishFi[ci] は目標周回 (targetLaps) 到達フレーム or null。
export function ghostProgressModel(frames, nc, boundsW, boundsH) {
  const nf = frames.length;
  const cum = ghostCumDist(frames, nc, boundsW, boundsH);
  const lapAt = (fi, ci) => (frames[fi][ci] ? (frames[fi][ci].laps || 0) : 0);
  const finalLaps = [];
  let targetLaps = 0;
  for (let ci = 0; ci < nc; ci++) { finalLaps[ci] = lapAt(nf - 1, ci); if (finalLaps[ci] > targetLaps) targetLaps = finalLaps[ci]; }

  // 周回境界の cum/frame と平均1周距離を求める。perLap=平均1周距離 (>=1周完了車)。
  const lapStartCum = [], finishFi = [], perLap = [];
  for (let ci = 0; ci < nc; ci++) {
    const bcum = [0], bframe = [0];   // bcum[L]/bframe[L] = L 周完了時 (=L+1周目の起点) の cum/frame。bcum[0]=0=発走
    let pl = 0;
    for (let fi = 0; fi < nf; fi++) { const L = lapAt(fi, ci); while (L > pl) { pl++; bcum[pl] = cum[ci][fi]; bframe[pl] = fi; } }
    lapStartCum[ci] = bcum;
    const completed = bcum.length - 1;
    perLap[ci] = completed >= 1 ? bcum[completed] / completed : null;
    finishFi[ci] = (targetLaps > 0 && finalLaps[ci] >= targetLaps) ? bframe[targetLaps] : null;
  }
  const known = perLap.filter((v) => v != null).sort((a, b) => a - b);
  const medLap = known.length ? known[known.length >> 1] : Math.max(boundsW, boundsH);  // 0周車のフォールバック
  for (let ci = 0; ci < nc; ci++) if (perLap[ci] == null) perLap[ci] = medLap;

  // rp[ci][fi] = laps + (cum-周回起点cum)/perLap。完走後の惰行も cum 増加で単調。時間gap 探索が単調を
  // 前提とするため、周回境界で正規化割合が一時的に 1 を超える微小揺れ (1周が平均より長い時) を非減少にクランプ。
  const rp = [];
  for (let ci = 0; ci < nc; ci++) {
    const arr = new Float64Array(nf), bcum = lapStartCum[ci], pL = perLap[ci];
    for (let fi = 0; fi < nf; fi++) {
      const L = lapAt(fi, ci);
      const start = bcum[Math.min(L, bcum.length - 1)];
      const v = L + (cum[ci][fi] - start) / pL;
      arr[fi] = (fi > 0 && v < arr[fi - 1]) ? arr[fi - 1] : v;
    }
    rp.push(arr);
  }
  return { cum, rp, finishFi, finalLaps, targetLaps, nf };
}

// 先行車の進行度配列 (rpAhead・単調増加) が値 v に到達した時刻と現在 (fi*dt) の差 = 車間(秒)。
export function ghostTimeGap(rpAhead, v, fi, dt) {
  if (fi <= 0 || v <= rpAhead[0]) return 0;
  let lo = 0, hi = fi;   // rpAhead[lo] <= v < rpAhead[lo+1] となる lo を二分探索
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (rpAhead[m] <= v) lo = m; else hi = m - 1; }
  let tAtV;
  if (lo >= fi) tAtV = fi * dt;
  else {
    const a0 = rpAhead[lo], a1 = rpAhead[lo + 1];
    const frac = a1 > a0 ? (v - a0) / (a1 - a0) : 0;
    tAtV = (lo + frac) * dt;
  }
  return Math.max(0, fi * dt - tAtV);
}

// フレーム fi の順位と車間。完走車 (tier2) は racing 車 (tier1) より前、完走車どうしは finishFi 昇順 (早い=前)。
// gap: 完走どうし=完走時刻差、それ以外=先行車が後続車の現 rp に居た時刻との差。戻り値 {ord, rows}。
export function ghostStandingsAt(model, frames, fi, dt) {
  const { rp, finishFi } = model;
  const nc = rp.length;
  const done = (ci) => finishFi[ci] != null && fi >= finishFi[ci];
  const ord = [];
  for (let ci = 0; ci < nc; ci++) ord.push(ci);
  ord.sort((x, y) => {
    const tx = done(x) ? 2 : 1, ty = done(y) ? 2 : 1;
    if (tx !== ty) return ty - tx;                       // 完走(tier2) を前へ
    if (tx === 2) return (finishFi[x] - finishFi[y]) || (x - y);  // 早い完走を前へ
    return (rp[y][fi] - rp[x][fi]) || (x - y);           // racing は進行度の大きい順
  });
  const rows = ord.map((ci, r) => {
    const fr = frames[fi][ci] || {};
    let gap = null;
    if (r > 0) {
      const ahead = ord[r - 1];
      gap = (done(ci) && done(ahead)) ? Math.max(0, (finishFi[ci] - finishFi[ahead]) * dt)
                                      : ghostTimeGap(rp[ahead], rp[ci][fi], fi, dt);
    }
    return { ci, rank: r + 1, lap: fr.laps || 0, gap, crashed: !!fr.crashed, done: done(ci) };
  });
  return { ord, rows };
}

// 直前の順位 (prevRank[ci]=順位) と現在の順位表 st から、上昇した車と「抜いた相手」を返す (純粋)。
// flash/告知文言(t())は呼び出し側 (DOM 層) が付与する。戻り値: [{ ci, passed:ci|null }...]。
export function ghostPasses(st, prevRank) {
  const out = [];
  if (!prevRank) return out;
  for (const r of st.rows) {
    const prev = prevRank[r.ci];
    if (prev == null || r.rank >= prev) continue;     // 順位が上がった車だけ
    const x = st.rows.find((o) => o.ci !== r.ci && prevRank[o.ci] === r.rank);  // 奪った順位に直前いた車
    out.push({ ci: r.ci, passed: x ? x.ci : null });
  }
  return out;
}
