// wf_ax1_touge_base.mjs — Stage AX1「峠を安定して走る基準ドライバの常設化」の受け入れゲート。
// ══════════════════════════════════════════════════════════════════════════════════════
// 守るもの = PLAN AX1 の受け入れ基準（実装前固定・CI-7）。実装本体は `wf_touge_driver.mjs`（library）。
//   A 完走率      : 出荷の峠 6 × 主要 3 車種 = 18 セルで単車完走 100%（壁で止まらない・recover に落ちない）
//   B 決定論      : 同一条件 5 回で到達時刻・終端姿勢が bit 一致
//   C 速度の妥当性: 各セルの所要が、同一コース・同一条件の既存プログラムの ±30% 以内
//   D 横位置の追従: 目標横位置に対する偏差の中央値が 車幅の 50% 以内（目標 3 水準 × 18 セル = 54 条件）
//   E 欠陥①の固定: 生の中心線が道幅より粗いことと、0.02m 再標本化が効いていること
//   F 欠陥②の固定: 最近点方式が実データで誤割当することと、前方窓方式が全走行で単調なこと
//   G 幾何の一次データ: 中心線の最小曲率半径と R_min の関係（AX2/AX3 が前提にする事実の凍結）
//
// **本番フローのみ・実データ**（CI-8）: コースは `buildFromSpec`、スロットは `makeSlot`/`rebuildSpawns`、
// 積分は `integrateFleetV2`、完走判定は `LapTracker` の touge 分岐、比較対象は `runRace` に通した
// `programs.js` の既定サンプル。判定述語を再実装しない（CI-14）。走行物理は 1 バイトも触らない。
//
// 走行条件（Stage AX 固定・SAX-PREP H1）: **v2 エンジン × 卓上領域**・装備はすべて既定。
//   卓上の本番既定エンジンは `dynamic` なので、本ゲートの数値は「卓上 v2 での話」である。
//
// ── 本ゲートの検出力（変異注入で実測 2026-09-06。守っている行を 1 つずつ壊して確かめた）─────────
//   ✔ 再標本化を無効化(STEP 0.02→1.0)         → 8 アサートが赤（E-3/A-1/A-3/C-1/C-2/D-1/D-2/D-3）
//   ✔ 回廊クランプを外す                       → D-3 が赤
//   ✔ ペース較正を外す(pace 0.74→1.0)          → C-1/C-2 が赤
//   ✔ 道追従 `slot._road` を切る               → H-1a/H-1 が赤（所要は 18/18 セルで変わり最大 6.56%。
//                                                H-1 が測る 6 セル（FR）では 6.26%。±30% 帯では
//                                                捕まらないので、差分そのものを固定する）
//   ✔ エンジンを dynamic へ替える              → H-0a が赤（以降を実行せず停止＝別条件の数字を出さない）
//   ✔ 操舵を連続舵(prop)へ替える               → H-0b が赤
//   ✔ 半幅の計算に前後のフタを混ぜる           → E-4 が赤
//   ✔ 回廊の平滑が窓 min を上回るのを許す       → D-3 が赤（実効安全率が設計値 1.06 を割る）
//   ✔ 回廊の左右の符号を反転する（兄弟バグ）   → D-3 が赤
//   ✔ pwm を目標速度比でなく生値で出す         → C-1/C-2 が赤
//   ✔ lookahead の横オフセットを落とす         → D-1/D-4 が赤
//   ✔ `sideWallsOf` の峠ガードを外す           → E-5 が赤（非峠 track 29 本が本数検査を素通しする）
//   ✔ 旋回はみ出し(swingOut)を 0 にする         → D-5 が赤（接触 0 のままマージンだけ 1.096→0.986×車幅）
//   ✔ 壁余白 WALL_CLEAR を負にする             → D-5 が赤（同 0.563×車幅）
//   ⚠ 進行度を最近点方式へ替えても赤にならない  → 出荷コースの**走行線上では両方式が bit 一致**（実測）。
//       誤割当は廊下の**最外縁 f=±1 でのみ**起き（0.367m・32 点）、ドライバが指令する |f|≤0.5 では 0 点。
//       **走行での検出力は無い**ことを F-3 が正面から測って固定している。前方窓が要る根拠は F-1 の
//       構造と、AX3 で道幅を詰めて走行線が外縁へ寄ること。
//   ⚠ 速度プロファイルの「摩擦円」制限を外しても赤にならない → 卓上・既定 pace では**一度も拘束しない**
//       （外して 18/18 bit 一致）。「舵角律速」「制動の後退伝播」も寄与は 0.28%/0.09% と小さい。
//   （変異 14 件を試し **14 件すべてを検出**。ただし「進度を最近点方式へ替える」だけは *設計上* 検出
//     できない〔F-3 が理由ごと固定〕ので上の ⚠ に残してある。）
//   （2026-09-06 の層 4 敵対的レビュー〔文脈ゼロのサブエージェント〕で **致命 1・重要 5・軽微 15** の
//     指摘を受け、公開前にすべて是正した。とくに ①本ライブラリ冒頭が撤回済みの数字「自己接近 4/29」を
//     保持していたこと ②旧 A-2（`car.crashed`）が v2×recover=true では**定義から恒真**で壁接触を
//     まったく測っていなかったこと ③`sideWallsOf` が非峠 track 29 本を素通ししていたこと
//     ④回廊の平滑が安全率を 1.06→0.916 に崩していたこと ⑤`BODY_MARGIN` が車体中心基準で計算されて
//     いたこと（正は後輪軸中心）。詳細は internal `docs/stage_ax/AX1_baseline.md` §4。）
//
// 使い方:  node wf_ax1_touge_base.mjs          （既定・アサート緑/赤で exit 0/1）
//          node wf_ax1_touge_base.mjs --json   （表を JSON で吐く。docs 転記用）
// ══════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setupRegime, runTouge, tougeGeom, tougeSpecs, roomAt, swingOut, sideWallsOf, CAR_KEYS, PACE_DEFAULT, RMIN_SAFE, STEP } from './wf_touge_driver.mjs';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';
import { CAR, APP_VERSION, PHYSICS, REGIME_STATE } from './public/js/config.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const WANT_JSON = process.argv.includes('--json');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const specs = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'courses.json'), 'utf8'));
const T = tougeSpecs(specs);
const progOf = (k) => { const p = PROGRAMS.find((x) => x.key === k); if (!p) throw new Error('no program ' + k); return p; };
const short = (n) => n.slice(0, 20).padEnd(22);
// 架空峠 3 本は先頭 12 文字が同一（『架空峠 ロング・ワインデ』）で見分けがつかない。括弧内の斜面名まで残す。
const tag = (n) => { const m = n.match(/[（(]([^）)]*)[）)]/); return (n.slice(0, 6) + (m ? '(' + m[1] + ')' : n.slice(6, 14))); };

setupRegime();
const R_MIN = CAR.wheelBase / Math.tan(CAR.maxSteer);
const LAT_LIMIT = 0.5 * CAR.width;
console.log(`\n[AX1] 峠の基準ドライバ  APP=${APP_VERSION}  卓上 v2  車体 ${CAR.length}x${CAR.width}m  R_min=${R_MIN.toFixed(4)}m`);
console.log(`  ペース係数 pace=${PACE_DEFAULT}（出荷サンプルへ較正）／回廊の安全率 RMIN_SAFE=${RMIN_SAFE}／中心線 再標本化 ${STEP}m`);

// ══════════════════════════════════════════════════════════════════════════════════════
// H-0: 走行条件の構造検査。**いちばん先に**やる — 条件（エンジン/装備）が違うと以降の測定は
//   別物になるうえ、v2 以外だと integrateFleetV2 が内部で例外死して「何が違うのか」が読めなくなる
//   （実測: setPhysicsMode('dynamic') に替えると赤 0 件のまま exit=1 になった）。
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[H-0] 走行条件の構造検査`);
{
  // **走らせる前に**大域条件を見る。v2 以外で integrateFleetV2 を呼ぶと CarV2 専用の内部 API が無く
  // 例外死し、「何が違うのか」が読めないまま exit=1 になる（実測で確認）。先に赤を出して止める。
  const engOK = PHYSICS.mode === 'v2' && REGIME_STATE.active === 'tabletop';
  console.log(`  大域: physics=${PHYSICS.mode} regime=${REGIME_STATE.active}`);
  ok(engOK, `H-0a エンジン/領域 = v2 × 卓上（Stage AX の固定条件・SAX-PREP H1）`);
  if (!engOK) {
    console.log(`\n[結果] pass=${pass} fail=${fail}  ← 条件が違うので以降の測定は行わない（別条件の数字を出さない）`);
    process.exit(1);
  }
  const probe = runTouge({ spec: T[0], carType: CAR_KEYS[0], latFrac: 0, maxSec: 5 });
  console.log(`  実測: engine=${probe.engine} steerSet=${probe.steerSet} tire=${probe.tireSet} brake=${probe.brakeSet} gear=${probe.gearSet} susp=${probe.suspSet} road=${probe.roadActive}`);
  ok(probe.engine === 'v2' && probe.steerSet === 'tri' && probe.tireSet === 'normal' && probe.brakeSet === 'motor'
    && probe.gearSet === 'direct' && probe.suspSet === 'quasi',
    `H-0b 車体の実装と装備がすべて既定（engine=v2・tri 操舵/normal タイヤ/motor ブレーキ/direct ギア/quasi サス）＝ 既定サンプルと同一条件`);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// G: 幾何の一次データ（先に出す。A〜D の解釈がこれに依存する）
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[G] コース幾何（中心線の最小曲率半径と R_min=${R_MIN.toFixed(3)}m の関係）`);
const geo = [];
for (const s of T) {
  const course = buildFromSpec(s);
  const G = tougeGeom(course);
  let minR = Infinity, tight = 0;
  for (let i = 0; i < G.n; i++) { const ak = Math.abs(G.kap[i]); const R = ak > 1e-6 ? 1 / ak : Infinity; if (R < minR) minR = R; if (R < R_MIN) tight++; }
  const raw = course.centerline;
  let rawMax = 0; for (let i = 1; i < raw.length; i++) rawMax = Math.max(rawMax, Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  let resMax = 0; for (let i = 1; i < G.n; i++) resMax = Math.max(resMax, G.s[i] - G.s[i - 1]);
  const rec = { name: s.name, hw: s.hw, width: 2 * s.hw, widthCars: +(2 * s.hw / CAR.width).toFixed(2),
    pathLen: +G.total.toFixed(3), rawPts: raw.length, rawMaxGap: +rawMax.toFixed(4), resPts: G.n, resMaxGap: +resMax.toFixed(4),
    minR: +minR.toFixed(4), tightFrac: +(tight / G.n).toFixed(4), room0: +roomAt(G, 0).toFixed(4) };
  geo.push(rec);
  console.log(`  ${short(s.name)} 幅 ${rec.width.toFixed(3)}m(車 ${rec.widthCars}台) 路長 ${rec.pathLen.toFixed(2)}m  minR ${rec.minR.toFixed(3)}m  R<R_min の弧長比 ${(100 * rec.tightFrac).toFixed(1)}%`);
}
// 「R<R_min の区間を持つコースが実在する」= AX2/AX3 の『内側線が到達不能』の根拠。構造が変われば気づく。
{
  // 判定はコース名でなく **幾何そのもの**（minR と R_min の比）で書く。改名で誤って赤にならないように。
  const withTight = geo.filter((g) => g.tightFrac > 0);
  ok(withTight.length >= 1,
    `G-1 中心線が R_min を下回る区間を持つ峠が ${withTight.length}/6 実在: ${withTight.map((g) => `${tag(g.name)}(minR ${g.minR.toFixed(3)}m=${(g.minR / R_MIN).toFixed(3)}×R_min/${(100 * g.tightFrac).toFixed(1)}%)`).join(' ') || 'なし'} ⇒ その区間では中心線そのものが追えない`);
  const maxRatio = Math.max(...geo.map((g) => g.minR / R_MIN));
  ok(maxRatio <= 2.5, `G-2 全 6 峠の最小曲率半径が R_min の ${maxRatio.toFixed(2)} 倍以内（測定の舞台として十分タイト。上限 2.5 倍）`);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// E: 欠陥①「中心線が道幅より粗い」の固定
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[E] 欠陥① 生の中心線の粗さと 0.02m 再標本化`);
{
  const coarse = geo.filter((g) => g.rawMaxGap > g.width);     // 点間隔が道幅より大きい = 一桁粗い
  console.log(`  生の最大点間隔: ${geo.map((g) => g.rawMaxGap.toFixed(3)).join(' / ')}  （道幅: ${geo.map((g) => g.width.toFixed(2)).join(' / ')}）`);
  // 非空振りガード: 「粗いコースが実在する」ことを先に確かめる。実在しなければ再標本化のアサートは無意味。
  // **同一コース内で**「点間隔 / 道幅」を比べる（最大点間隔と最小道幅を別コースから拾って並べない）。
  const worstCoarse = geo.slice().sort((a, b) => (b.rawMaxGap / b.width) - (a.rawMaxGap / a.width))[0];
  ok(coarse.length >= 3, `E-1 生の中心線が **その峠自身の道幅より粗い** 峠が ${coarse.length}/6 実在（最悪 ${tag(worstCoarse.name)}: 点間隔 ${worstCoarse.rawMaxGap.toFixed(3)}m / 道幅 ${worstCoarse.width.toFixed(3)}m = ${(worstCoarse.rawMaxGap / worstCoarse.width).toFixed(1)} 倍）⇒ 再標本化なしでは進行度も曲率も測れない`);
  // **絶対値**で縛る。`STEP * 1.2` のように固定したい当のパラメータの相対値にすると、STEP を 1.0 に
  //   変えても緑のまま通る（層 4 レビュー指摘・実測）。道幅比でも縛って「何のための分解能か」を残す。
  //   なお再標本化の理論上限は 1.5×STEP（`Math.round` による）で、実データの最悪は 1.164×STEP。
  const resAbs = Math.max(...geo.map((g) => g.resMaxGap)), resRel = Math.max(...geo.map((g) => g.resMaxGap / g.width));
  ok(resAbs <= 0.031 && resRel <= 0.10,
    `E-2 再標本化後の最大点間隔 ${resAbs.toFixed(4)}m ≤ 0.031m（=1.5×STEP の理論上限）かつ 道幅の ${(100 * resRel).toFixed(1)}% ≤ 10%（全 6 峠）`);
  ok(geo.every((g) => g.resPts >= g.rawPts * 3), `E-3 再標本化が実際に点を増やしている（最小 ${Math.min(...geo.map((g) => g.resPts / g.rawPts)).toFixed(1)} 倍）＝ E-2 が恒真でない`);
  // E-4: 半幅は **側壁だけ** から測る。前後のフタ（スタート背後／ゴール先の壁）を混ぜると、
  //   路の両端で半幅がフタまでの距離に化けて room が縮む（＝発走位置とゴール直前の横の余地が嘘になる）。
  //   端点の実測半幅が公称 hw の 9 割以上あることで、フタが混ざっていないことを機械で確かめる。
  let endMin = Infinity;
  for (const s2 of T) {
    const G = tougeGeom(buildFromSpec(s2));
    endMin = Math.min(endMin, G.hw[0] / s2.hw, G.hw[G.n - 1] / s2.hw);
  }
  ok(endMin >= 0.9, `E-4 路の両端でも実測半幅が公称 hw の ${(100 * endMin).toFixed(1)}% ≥ 90%（＝前後のフタを半幅計算に混ぜていない）`);
  // E-5: `sideWallsOf` の峠判定が **本当に効いている**か。壁の本数だけでは判別できない —
  //   track 型（周回）は polyWalls が閉じるので左右とも n 本＝2n で、峠の期待値 2(n-1)+2=2n と
  //   恒等的に一致する。実際、出荷の非峠 track は全 29 本がこの本数検査を素通しする（層 4 レビュー指摘）。
  //   ∴ `course.touge` を見ていることを、非峠コースを渡して例外になることで確かめる。
  const nonTouge = specs.filter((x) => x.kind !== 'touge').map((x) => buildFromSpec(x)).filter((c) => c.walls && c.walls.length);
  let rejected = 0, sameCount = 0;
  for (const c of nonTouge) {
    if (c.centerline && c.walls.length === 2 * (c.centerline.length - 1) + 2) sameCount++;
    try { sideWallsOf(c); } catch (e) { rejected++; }
  }
  ok(nonTouge.length > 0 && rejected === nonTouge.length && sameCount > 0,
    `E-5 非峠コース ${nonTouge.length} 本をすべて拒否（うち ${sameCount} 本は壁の本数だけなら峠の期待値と一致＝本数検査では判別できない）`);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// F: 欠陥②「最近点方式の進行度」の固定
//   PLAN 起票時の根拠「峠② で中心線が 0.35m 以内に自己接近する点が 4/29」は **誤り**だった。
//   予備実装 `_touge_diag.mjs` は壁から中心線を再構成する際に `w[i]` と `w[walls.length/2 + i]` を
//   組にしていたが、峠の壁は「片側 28 セグメント ×2 ＋ 前後のフタ 2 枚 = 58」で、片側は 29 ではなく
//   **28**。1 本ずれた中心線は本物の `course.centerline` から **最大 1.538m**（道幅 0.530m の約 3 倍）
//   ずれており、「4/29」はその産物である（本ゲート F-0 が両方を実測して固定する）。
//   一方で **最近点方式が壊れること自体は実データで起きる**: 架空峠(激坂) は蛇行の隣り合う山が近く、
//   廊下の**最外縁**では全域最近点が弧長で 0.367m 飛ぶ。前方窓方式はこれを構造的に排除する。
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[F] 欠陥② 進行度の求め方（最近点方式 vs 前方窓方式）`);
{
  // F-0: 予備実装の再構成が壊れていたことの実測（記録の訂正を機械で固定する）
  const s2 = T.find((x) => x.name.startsWith('峠②'));
  const c2 = buildFromSpec(s2), w = c2.walls, N = w.length / 2;
  let devMax = 0;
  for (let i = 0; i < N; i++) {
    const px = (w[i].x1 + w[N + i].x1) / 2, py = (w[i].y1 + w[N + i].y1) / 2;
    const q = c2.centerline[Math.min(i, c2.centerline.length - 1)];
    devMax = Math.max(devMax, Math.hypot(px - q[0], py - q[1]));
  }
  ok(w.length === 2 * (c2.centerline.length - 1) + 2 && devMax > 2 * s2.hw,
    `F-0 予備実装の中心線再構成は壊れていた: 壁 ${w.length} = 片側 ${c2.centerline.length - 1}×2 ＋ フタ 2 ゆえ w[i]↔w[${N}+i] は 1 本ずれ、本物の centerline から最大 ${devMax.toFixed(3)}m（道幅 ${(2 * s2.hw).toFixed(3)}m）外れる ⇒ 起票時の「自己接近 4/29」はこの産物`);

  // F-1: 廊下内を網羅走査し、全域最近点が弧長で飛ぶ点が **実在する** ことを測る（非空振り）
  const JUMP = 0.30;
  const FRACS = [-1, -0.5, 0, 0.5, 1];
  const scan = [];
  for (const s of T) {
    const G = tougeGeom(buildFromSpec(s));
    let worst = 0, nbad = 0, ntot = 0;
    for (let i = 0; i < G.n; i++) {
      const room = roomAt(G, i);
      for (const f of FRACS) {
        const lat = f * room;
        const x = G.P[i][0] - Math.sin(G.th[i]) * lat, y = G.P[i][1] + Math.cos(G.th[i]) * lat;
        let best = 0, bd = Infinity;
        for (let j = 0; j < G.n; j++) { const d = (G.P[j][0] - x) ** 2 + (G.P[j][1] - y) ** 2; if (d < bd) { bd = d; best = j; } }
        const jump = Math.abs(G.s[best] - G.s[i]); ntot++;
        if (jump > JUMP) nbad++;
        if (jump > worst) worst = jump;
      }
    }
    scan.push({ name: s.name, worst: +worst.toFixed(4), nbad, ntot });
    console.log(`  ${short(s.name)} 全域最近点の最大の飛び ${worst.toFixed(3)}m  ${JUMP}m 超 ${nbad}/${ntot} 点`);
  }
  const broken = scan.filter((x) => x.nbad > 0);
  ok(broken.length >= 1, `F-1 最近点方式が実データで誤割当する峠が ${broken.length}/6 実在: ${broken.map((b) => `${tag(b.name)}(${b.nbad}点・最大 ${b.worst.toFixed(3)}m)`).join(' ') || 'なし'} ⇒ 前方窓方式が必要（空振りしていない）`);

  // F-3: **その誤割当が「走る線」の上で起きるのか**を分けて測る。実測では |lat| が余地いっぱい
  //   （f=±1）のときだけ飛び、ドライバが実際に指令する最大 f=±0.5 では 1 点も飛ばない。
  //   ∴ 出荷コースを既定条件で走るかぎり両方式は等価で、**走行での検出力は無い**（正直に固定する）。
  const byFrac = {};
  for (const f of FRACS) byFrac[f] = 0;
  for (const s of T) {
    const G = tougeGeom(buildFromSpec(s));
    for (let i = 0; i < G.n; i++) {
      const room = roomAt(G, i);
      for (const f of FRACS) {
        const lat = f * room;
        const x = G.P[i][0] - Math.sin(G.th[i]) * lat, y = G.P[i][1] + Math.cos(G.th[i]) * lat;
        let best = 0, bd = Infinity;
        for (let j = 0; j < G.n; j++) { const d = (G.P[j][0] - x) ** 2 + (G.P[j][1] - y) ** 2; if (d < bd) { bd = d; best = j; } }
        if (Math.abs(G.s[best] - G.s[i]) > JUMP) byFrac[f]++;
      }
    }
  }
  const w1 = runTouge({ spec: T[0], carType: CAR_KEYS[0], latFrac: 0, mode: 'window' });
  const n1 = runTouge({ spec: T[0], carType: CAR_KEYS[0], latFrac: 0, mode: 'nearest' });
  console.log(`  誤割当の出どころ（横位置 f＝余地に対する比）: ${FRACS.map((f) => `f=${f}:${byFrac[f]}点`).join(' / ')}`);
  ok(byFrac[0] === 0 && byFrac[0.5] === 0 && byFrac[-0.5] === 0 && (byFrac[1] + byFrac[-1]) > 0
     && w1.t === n1.t && w1.ticks === n1.ticks,
    `F-3 誤割当は**廊下の最外縁（f=±1）でのみ**起き（${byFrac[1] + byFrac[-1]} 点）、ドライバが指令する範囲（|f|≤0.5）では 0 点。` +
    `∴ 出荷コース×既定条件では両方式が bit 一致（${w1.t} vs ${n1.t}）＝ **走行での検出力は無い**。前方窓の根拠は F-1 の構造と、AX3 で道幅を詰めて走行線が外縁へ寄ること`);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// C の比較対象: 既定サンプルを **同一条件**（v2/卓上・単車 TT・rejoin ON・装備既定）で走らせる
// ══════════════════════════════════════════════════════════════════════════════════════
const sample = {};
for (const s of T) {
  const course = buildFromSpec(s);
  sample[s.name] = {};
  for (const k of CAR_KEYS) {
    const p = progOf(k);
    const r = runRace({
      course, regime: 'tabletop', physics: 'v2', laps: 1,
      field: [{ name: 'A', lang: 'c', src: p.code, carType: p.carType, rear: false, encoder: false }],
      crashRule: { rejoin: true, penaltySec: 3 }, interact: false,
    });
    sample[s.name][k] = r.finishers[0] ? r.finishers[0].totalTimeMs / 1000 : null;
  }
}
ok(T.every((s) => CAR_KEYS.every((k) => sample[s.name][k] != null)),
  `C-0 比較対象の非空振り: 既定サンプル 18/18 が同一条件で完走（1 つでも DNF なら ±30% 帯が定義できない）`);

// ══════════════════════════════════════════════════════════════════════════════════════
// A / C: 18 セルの完走と所要時間
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[A/C] 単車 18 セル（完走・所要・既定サンプルとの比）  代表 2 種 = 同車種サンプル(主) / そのコースの最速サンプル(副)`);
const cells = [];
for (const s of T) {
  for (const k of CAR_KEYS) {
    const r = runTouge({ spec: s, carType: k, latFrac: 0 });
    const tMatch = sample[s.name][k];
    const vals = CAR_KEYS.map((x) => sample[s.name][x]).filter((v) => v != null);
    const tBest = vals.length ? Math.min(...vals) : null;
    const rm = (r.finished && tMatch) ? r.t / tMatch : null, rb = (r.finished && tBest) ? r.t / tBest : null;
    cells.push({ course: s.name, car: k, finished: r.finished, crashed: r.crashed, recoverArms: r.recoverArms,
      t: r.finished ? +r.t.toFixed(4) : null, tMatch: tMatch != null ? +tMatch.toFixed(4) : null, tBest: tBest != null ? +tBest.toFixed(4) : null,
      ratioMatch: rm != null ? +rm.toFixed(4) : null, ratioBest: rb != null ? +rb.toFixed(4) : null,
      nonMono: r.nonMono, clampFrac: +r.clampFrac.toFixed(4), steerSatFrac: +r.steerSatFrac.toFixed(4),
      contactTicks: r.contactTicks, minClear: r.minClear != null ? +r.minClear.toFixed(5) : null });
    const f2 = (v) => (v != null && Number.isFinite(v) ? v.toFixed(2) : ' --- ');   // 未完走/DNF でも落ちない
    console.log(`  ${short(s.name)} ${k.replace('normal_', '').padEnd(4)} ${r.finished ? '完走' : '未完走'} ${f2(r.t).padStart(6)}s  サンプル 同 ${f2(tMatch)} / 最速 ${f2(tBest)}  比 ${rm != null ? rm.toFixed(3) : ' -- '} / ${rb != null ? rb.toFixed(3) : ' -- '}  接触 ${r.contactTicks}  recover ${r.recoverArms}`);
  }
}
ok(cells.length === 18, `A-0 セル数 ${cells.length} = 峠 ${T.length} × 車種 ${CAR_KEYS.length}（母集団が縮んでいない）`);
ok(cells.every((c) => c.finished), `A-1 完走率 ${cells.filter((c) => c.finished).length}/18 = 100%（LapTracker の touge ゴール判定）`);
// **A-2 は `car.crashed` では測れない**。v2 × recover=true では `fleet.js:635` の分岐が `!recover` で
//   守られており crashed は**構造的に立たない**＝「crashed が 0」は定義から恒真で何も守らない
//   （層 4 レビュー指摘。壁を 14 tick こすっても緑になることを実測で確認済み）。
//   ∴ 製品オラクル `checkCollision` による**接触 tick** と、車体四隅〜側壁の**最小クリアランス**で測る。
{
  const contact = cells.reduce((a, c) => a + c.contactTicks, 0);
  const clr = Math.min(...cells.map((c) => c.minClear).filter((v) => v != null));
  ok(contact === 0 && Number.isFinite(clr),
    `A-2 壁への接触 tick ${contact}/18走行 = 0（製品オラクル checkCollision）・車体四隅〜側壁の最小クリアランス ${Number.isFinite(clr) ? clr.toFixed(4) : '--'}m`);
}
ok(cells.every((c) => c.recoverArms === 0), `A-3 後退復帰(recover) が arm した走行 ${cells.filter((c) => c.recoverArms > 0).length}/18 = 0（recover ループに落ちない）`);
{
  const rs = cells.map((c) => c.ratioMatch);
  const bad = cells.filter((c) => !(c.ratioMatch != null && c.ratioMatch >= 0.7 && c.ratioMatch <= 1.3));
  ok(bad.length === 0, `C-1 所要が同車種サンプルの ±30% 以内: 比 ${Math.min(...rs).toFixed(3)}〜${Math.max(...rs).toFixed(3)}（帯外 ${bad.length}/18${bad.length ? ': ' + bad.map((b) => `${b.course.slice(0, 8)}/${b.car}=${b.ratioMatch}`).join(' ') : ''}）`);
  const rb = cells.map((c) => c.ratioBest);
  ok(rb.every((v) => v != null && v >= 0.7 && v <= 1.3), `C-2 副基準（そのコースの最速サンプル）でも ±30% 以内: 比 ${Math.min(...rb).toFixed(3)}〜${Math.max(...rb).toFixed(3)}`);
}
// 文言を式に合わせる: 「単調」ではなく「1 tick で 0.05m 以上の逆戻りが 0 回」。
//   なお前方窓は後方 0.10m しか探さないので **0.10m 以上は構造的に戻れない**（式が拾えるのは 0.05〜0.10m）。
ok(cells.every((c) => c.nonMono === 0), `F-2 前方窓方式の進行度は全 18 走行で「1 tick に 0.05m 以上の逆戻り」が ${cells.reduce((a, c) => a + c.nonMono, 0)} 回 = 0（後方窓 0.10m ゆえ式が拾える範囲は 0.05〜0.10m）`);

// ══════════════════════════════════════════════════════════════════════════════════════
// B: 決定論（同一条件 5 回で bit 一致）
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[B] 決定論（同一条件 5 回）`);
{
  let bad = 0, n = 0;
  for (const s of T) for (const k of CAR_KEYS) {
    const rs = []; for (let i = 0; i < 5; i++) rs.push(runTouge({ spec: s, carType: k, latFrac: 0 }));
    // `t === t` は null===null も真になる（5 回とも未完走でも緑）ので、**完走していること**を先に要求する。
    const same = rs.every((r) => r.finished && r.t === rs[0].t && r.ticks === rs[0].ticks && r.endX === rs[0].endX
      && r.endY === rs[0].endY && r.endTheta === rs[0].endTheta && r.endU === rs[0].endU
      && r.latErrMed === rs[0].latErrMed && r.latErrP95 === rs[0].latErrP95
      && r.clampFrac === rs[0].clampFrac && r.contactTicks === rs[0].contactTicks);
    n++; if (!same) { bad++; console.log(`  ✗ ${short(s.name)} ${k}: ${rs.map((r) => r.t).join(' / ')}`); }
  }
  ok(bad === 0 && n === 18, `B-1 同一条件 5 回で 完走・到達時刻・tick 数・終端姿勢(x,y,θ,u)・追従誤差(中央値/p95)・クランプ率・接触 tick が bit 一致（${n} セル）`);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// D: 横位置の追従（目標 3 水準 × 18 セル = 54 条件）
//   合否は **全 tick の中央値**（発走後 0.5s の過渡を除く）で採る＝より厳しい側。
//   回廊が拘束した tick（＝その横位置が舵角律速で到達不能）とそうでない tick を分けて診断値も出す。
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[D] 横位置の追従（目標 = 余地の -50% / 0 / +50%。要求: 偏差の中央値 ≤ 0.5×車幅 = ${LAT_LIMIT.toFixed(4)}m）`);
const lats = [];
for (const s of T) for (const k of CAR_KEYS) for (const lf of [-0.5, 0, 0.5]) {
  const r = runTouge({ spec: s, carType: k, latFrac: lf });
  lats.push({ course: s.name, car: k, latFrac: lf, finished: r.finished, recoverArms: r.recoverArms,
    med: +r.latErrMed.toFixed(5), p95: +r.latErrP95.toFixed(5), n: r.latErrN,
    freeMed: r.latFreeMed != null ? +r.latFreeMed.toFixed(5) : null, freeN: r.latFreeN,
    bindMed: r.latBindMed != null ? +r.latBindMed.toFixed(5) : null, bindN: r.latBindN,
    clampFrac: +r.clampFrac.toFixed(4), clampMax: +r.clampMax.toFixed(4), steerSatFrac: +r.steerSatFrac.toFixed(4),
    contactTicks: r.contactTicks, minClear: r.minClear != null ? +r.minClear.toFixed(5) : null });
}
{
  const bad = lats.filter((x) => !x.finished || !(x.med <= LAT_LIMIT));
  const medMax = Math.max(...lats.map((x) => x.med)), p95Max = Math.max(...lats.map((x) => x.p95));
  const nMin = Math.min(...lats.map((x) => x.n));
  console.log(`  中央値の最大 ${medMax.toFixed(4)}m（要求 ≤ ${LAT_LIMIT.toFixed(4)}）／p95 の最大 ${p95Max.toFixed(4)}m／最小標本 ${nMin} tick`);
  console.log(`  回廊が拘束した tick の割合 ${(100 * lats.reduce((a, x) => a + x.clampFrac, 0) / lats.length).toFixed(1)}%（＝その横位置が R_min で到達不能だった割合）・最大クランプ量 ${Math.max(...lats.map((x) => x.clampMax)).toFixed(3)}m`);
  ok(lats.length === 54 && nMin >= 200, `D-0 条件数 ${lats.length} = 18 セル × 目標 3 水準・各走行の標本 ${nMin} tick 以上（中央値が少数点で決まらない）`);
  ok(bad.length === 0, `D-1 目標横位置に対する偏差の中央値 ≤ 0.5×車幅: 最大 ${medMax.toFixed(4)}m / 限界 ${LAT_LIMIT.toFixed(4)}m（不合格 ${bad.length}/54${bad.length ? ': ' + bad.map((b) => `${b.course.slice(0, 8)}/${b.car}/${b.latFrac}=${b.med}`).join(' ') : ''}）`);
  ok(lats.every((x) => x.recoverArms === 0), `D-2 横位置を指定した 54 走行でも recover は一度も arm しない`);
  // D-3: 回廊そのものの構造検査 — 「指令しうる最も内側の横位置」が舵角で追える半径に収まっているか。
  //   D-1 は追従誤差しか見ないので、回廊のクランプを外しても中央値は小さいまま通ってしまう（実測）。
  //   ∴ クランプが効いていることは **幾何の不等式**で直接固定する。非空振りガードとして、クランプが
  //   無ければ実効半径が R_min の 0.4 倍を切る峠が実在することも同時に測る（激坂は負＝旋回中心の逆側）。
  let corrMinRatio = Infinity, rawMinRatio = Infinity, rawBad = 0;
  for (const s of T) {
    const G = tougeGeom(buildFromSpec(s));
    let wc = Infinity, wr = Infinity;
    for (let i = 0; i < G.n; i++) {
      const k = G.kap[i], ak = Math.abs(k);
      if (ak < 1e-6) continue;
      const R = 1 / ak, latIn = k > 0 ? G.hiLat[i] : -G.loLat[i];
      if (R - latIn < wc) wc = R - latIn;
      if (R - roomAt(G, i) < wr) wr = R - roomAt(G, i);
    }
    corrMinRatio = Math.min(corrMinRatio, wc / R_MIN);
    rawMinRatio = Math.min(rawMinRatio, wr / R_MIN);
    if (wr / R_MIN < 0.4) rawBad++;
  }
  // 閾値は **設計値 RMIN_SAFE そのもの**にする。初版は 0.85 という説明のない数字で、平滑が回廊を
  //   広げ戻して実効 0.916× になっていたのを受け入れてしまっていた（層 4 レビュー指摘）。
  ok(corrMinRatio >= RMIN_SAFE - 1e-9 && rawBad >= 3,
    `D-3 回廊が指令する最内線の実効半径 ≥ 設計値 ${RMIN_SAFE}×R_min（実測 最小 ${corrMinRatio.toFixed(4)}×）。` +
    `クランプが無ければ 0.4×R_min を切る峠が ${rawBad}/6（最小 ${rawMinRatio.toFixed(3)}×・負値は旋回中心の逆側）＝ このアサートは空振りしていない`);
  // D-4: **p95 の分布を固定する**。合否に使うのは中央値（＝PLAN の「定常偏差」）だが、
  //   「横位置の占有」を主張できるかは p95 が決める。∴ 条件ごとの p95 を表に出し、
  //   **p95 が車幅を超える条件の件数とその所属コース**を回帰指紋として刻む（AX3 はここを見て、
  //   占有を主張してよいコースとそうでないコースを分けること）。
  const overW = lats.filter((x) => x.p95 > CAR.width);
  const byCourse = {};
  for (const x of lats) byCourse[x.course] = Math.max(byCourse[x.course] || 0, x.p95);
  console.log(`  コース別 p95 の最大: ${Object.entries(byCourse).map(([k2, v]) => `${tag(k2)} ${v.toFixed(3)}`).join(' / ')}`);
  ok(overW.length <= 18 && new Set(overW.map((x) => x.course)).size <= 2,
    `D-4 p95 が車幅(${CAR.width}m)を超える条件 ${overW.length}/54・所属コース ${[...new Set(overW.map((x) => tag(x.course)))].join('・') || 'なし'}（上限 18 条件/2 コース）` +
    ` ⇒ **横位置の占有を主張してよいのは残りのコース**。AX3 はこの区分を前提にすること`);
  // D-5: **壁からの余裕を連続量で縛る**。接触 tick が 0 なだけでは、目標線を壁ぎりぎりへ寄せる
  //   退行（旋回はみ出しの見積りを落とす／壁余白を詰める）を捕まえられない — 実測で、旋回はみ出しを
  //   0 にしても壁余白を −0.075m にしても**接触 0 のまま**で、変わるのはマージンだけだった。
  //   ∴ 「四隅〜側壁の最小クリアランス ≥ 車幅」を課す（実測 1.096×車幅。上の 2 変異はどちらも下回る）。
  const clr54 = Math.min(...lats.map((x) => x.minClear).filter((v) => v != null));
  const ct54 = lats.reduce((a, x) => a + x.contactTicks, 0);
  ok(ct54 === 0 && clr54 >= CAR.width,
    `D-5 54 条件で 壁への接触 tick ${ct54} = 0 ∧ 四隅〜側壁の最小クリアランス ${clr54.toFixed(5)}m ≥ 車幅 ${CAR.width}m（実測 ${(clr54 / CAR.width).toFixed(3)}×車幅）`);
  const worst = lats.slice().sort((a, b) => b.p95 - a.p95)[0];
  console.log(`  診断: p95 最大は ${worst.course.slice(0, 14)}/${worst.car}/${worst.latFrac} の ${worst.p95.toFixed(3)}m。` +
    `同走行の 舵角飽和 ${(100 * worst.steerSatFrac).toFixed(1)}%・回廊拘束 ${(100 * worst.clampFrac).toFixed(1)}% ⇒ ` +
    `中心線の minR が R_min に迫る区間（G 参照）で幾何的に外れる分であり、追従則の不良ではない。`);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// H: 予備実装の欠陥③「下り勾配（道追従の路面フレーム）を渡していなかった」の固定
//   ±30% 帯は広すぎて 6.65% の系統差を捕まえられない。∴ **差分そのもの**を固定する。
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[H] 下り勾配の道追従が効いていることの差分`);
{
  // 道追従が全 6 峠で有効か（roadFrame は downhill=0 かつ bank=0 なら null を返す＝峠では必ず非 null）
  const roadOn = T.map((s) => runTouge({ spec: s, carType: CAR_KEYS[0], latFrac: 0 }));
  ok(roadOn.every((r) => r.roadActive && r.downhill > 0), `H-1a 全 6 峠で道追従の路面フレームが有効（downhill ${roadOn.map((r) => r.downhill).join('/')}）`);
  // 差分: 道追従を切ると所要が変わることを実測で固定（予備実装は切れたまま走っていた）
  let maxRel = 0, changed = 0;
  for (let i = 0; i < T.length; i++) {
    const off = runTouge({ spec: T[i], carType: CAR_KEYS[0], latFrac: 0, road: false });
    if (!off.finished || off.t !== roadOn[i].t) changed++;
    if (off.finished) maxRel = Math.max(maxRel, Math.abs(off.t - roadOn[i].t) / roadOn[i].t);
  }
  ok(changed === T.length && maxRel > 0.01,
    `H-1 道追従を切ると 6/6 峠で **結果が変わる**（完走したまま所要が変わる/未完走になる のいずれか。完走した中での最大差 ${(100 * maxRel).toFixed(2)}%・変化 ${changed}/6）⇒ 下り重力が実際に効いている（予備実装はここが落ちていた）`);
}

console.log(`\n[結果] pass=${pass} fail=${fail}`);
if (WANT_JSON) {
  console.log('===JSON===');
  console.log(JSON.stringify({ appVersion: APP_VERSION, pace: PACE_DEFAULT, rminSafe: RMIN_SAFE, step: STEP,
    car: { length: CAR.length, width: CAR.width, wheelBase: CAR.wheelBase, maxSteer: CAR.maxSteer, maxSpeed: CAR.maxSpeed, rMin: +R_MIN.toFixed(5) },
    geo, cells, lats }, null, 0));
}
process.exit(fail ? 1 : 0);
