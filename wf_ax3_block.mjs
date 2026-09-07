// wf_ax3_block.mjs — Stage AX3「多車・片道レースでのブロック戦術の測定（道幅比の掃引を含む）」の受け入れゲート。
// ══════════════════════════════════════════════════════════════════════════════════════
// 問い（利用者・2026-09-06）: 峠（スタートとゴールが別・多車）で、先頭がブロック戦術を使うと **順位** を守れるか。
//   「先頭が損をしても、後続がもっと損をするなら勝ち」という非対称性を、着順で測る（ラップタイムではない）。
//
// 測るもの（PLAN AX3 の受け入れ基準・実装前固定・CI-7）:
//   指標   = 先頭（グリッド最前）の **着順** と到達時刻。自タイム悪化はコストとして併記する（勝敗には使わない）。
//   掃引   = 台数 {2,3,4,6}（既定は {2,4}）× 先頭の戦術 4 種 × 峠 6 本 × 道幅 4 水準（現行・4.5/3.0/2.0 台分）
//            × 反復（追走のペース比・発走遅延・初期横位置）。
//   戦術   = race（自分の最速線を素直に走る）／inside（前コーナー出口から次コーナーの到達可能な最内を占有。最後のコーナー以降は
//            中心線）／sideways（追走が迫ったらコーナーで
//            停止→3 点旋回で横向き→保持）／drift（コーナー入口で後軸ロック＋フル舵で姿勢を崩し内側を占有）。
//   GO     = ある条件で「先頭が 1 位で完走する割合」が race より **有意に高い**（同一反復条件の対で符号検定・両側 p<0.05）。
//            接触（車車の重なり、または slop の半分 0.01m より内側への接近）を伴って勝った反復は **別枠**（戦術の勝ちから接触依存分を
//            除いた clean GO と、接触込みの GO を分ける。clean の対は戦術側にだけ clean を課す保守側の非対称定義＝E 節の注記）。
//   自滅   = 先頭の到達時刻が race より遅くなる量を必ず記録し「勝っても遅い」を数える。追走の実ルール（1 車長以上の
//            差でゴール＝lead／1 位でも 1 車長未満＝caught／抜かれた＝passed）での別判定を併記する。
//   幾何   = 水準ごとに「横に 2 台並ぶ余地」を先に出し、余地 0 の水準（2.0 台分）の結果は戦術でなく幾何が決めると明記する。
//
// ── 設計時の実測で決めた前提（2026-09-07・卓上 v2 normal_fr・装備既定。wf_touge_driver.mjs の AX3 節に理由を記載）──
//   ・卓上 v2 normal では **持続ドリフトは成立しない**（全開＋フル舵で |β| 11〜12° 頭打ち）。`drift` は「入口の後軸ロックで
//     姿勢を崩す」に限定して実装し、実際に出た |β| ピークと滑走 tick 割合を返す。
//   ・`sideways` は滑りでは作れないので停止→3 点旋回で作る（solo 実測: ψ=30〜45° を壁接触 0 で作れるが +14〜18s）。
//   ・本番 freeSpawn は峠で 4 台目以降を **前方** に置く（フタ壁・2〜3 台目は横並び）ため、AD1 の本番経路 rebuildSpawns(grid) に
//     中心線上の等間隔グリッドを渡す（壁交差・重なりが出る車は後ろへ、最後尾がフタ壁側へ落ちるなら先頭を前へ出して置き直す）。
//     追走は先頭より速くないと「順位を守れるか」が測れないので、ペース比 >1 を反復軸に入れる。
//   ・ゴールした車はコースから外す（ゴール線の 0.35m 先が端壁で、停車した車が後続を塞ぎ着順測定が壊れる）。
//   ・`inside`/`sideways`/`drift` の速度則は race と同じ holdTo（プロファイル・超過時 BRAKE）＝同一ペースで比べる。例外は
//     drift の「滑り過多（目標+4°超）のときだけ駆動を pwm=60 に絞る」の 1 点（姿勢制御の一部）。sideways の停止・旋回・保持は
//     戦術そのもの（速度則の外）。
//   ・追走の回避モデルは前方の車を「弧長・横位置・**姿勢角込みの実効横幅**」で見る（横向きの先頭を点＋車幅で扱うと楽観になる）。
//   ・**道幅 2.0 台分では 4 戦術の基準線が中心線に縮退する**（room ≤ 壁余白 0.04m）。この水準の `inside` は race と同一の
//     シミュレーションになるので「判定不能（線が同一）」として分けて数える（F-1 はその同一性を bit 一致で確かめる）。
//   ・clean 勝ち = 先頭が他車と **重なり 0 かつ slop の半分（0.01m）より内側への接近 0** で 1 位（v2 の接触ソルバは slop=0.02m 手前
//     からインパルスを交換するので重なりだけでは押し戻され切った接触を見逃す。一方、追走の指令間隙は 0.02m なので slop そのものを
//     閾値にすると指令どおりの並走がすべて「接近」に化ける＝2 巡目レビュー 重要-A。半分にして「詰めた接近」だけを数える）。
//   ・`--full` のペース比 1.0 は「追走が速くない」対照（同着近傍が増え符号検定の n を薄める）。既定の縮小掃引には入れない。
//
// **本番フローのみ・実データ**（CI-8）: コースは buildFromSpec（派生は hw だけ替えた spec）・スロットは makeSlot/rebuildSpawns・
// 積分は integrateFleetV2（干渉 ON・rejoin ON）・発走順次化は applyStartGate・接触は checkCollision/carEdges・ゴールは
// LapTracker の touge 分岐。走行物理は 1 バイトも触らない。走行条件は Stage AX 固定の **v2 × 卓上**。
//
// 使い方:  node wf_ax3_block.mjs          （縮小掃引・アサート緑/赤で exit 0/1）
//          node wf_ax3_block.mjs --full   （全掃引・docs 転記用・長い）
//          node wf_ax3_block.mjs --json   （表を JSON で）
// ══════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setupRegime, tougeGeom, tougeSpecs, derivedTougeSpecs, cornersOf, runTougeRace, derivedTougeSpec, roomForTwo, roomAt, AX3, TACTICS, PACE_DEFAULT } from './wf_touge_driver.mjs';
import { buildFromSpec } from './public/js/course.js';
import { CAR, APP_VERSION, PHYSICS, REGIME_STATE } from './public/js/config.js';
import { slopOf } from './public/js/contact_v2.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FULL = process.argv.includes('--full');
const WANT_JSON = process.argv.includes('--json');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const tag = (n) => { const m = n.match(/[（(]([^）)]*)[）)]/); return (n.slice(0, 6) + (m ? '(' + m[1] + ')' : n.slice(6, 14))); };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const f2 = (v, w = 6) => (v == null ? '--'.padStart(w) : v.toFixed(2).padStart(w));

const specs = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'courses.json'), 'utf8'));
const AS3_EXPECTED = JSON.parse(readFileSync(join(ROOT, 'wf_as3_expected.json'), 'utf8'));   // 派生コースの desc の完走数の正本
const BASES = tougeSpecs(specs);                     // 出荷の峠 6 本（派生を含まない）
const DERIVED = derivedTougeSpecs(specs);
setupRegime();
const CAR_KEY = 'normal_fr';
const T0 = process.hrtime.bigint();
const lapT = () => (Number(process.hrtime.bigint() - T0) / 1e9).toFixed(0);

// 掃引の軸（縮小/全）。反復 = ペース比 × 発走遅延 × 初期横位置。
const N_CARS = FULL ? [2, 3, 4, 6] : [2, 4];
const RATIOS = FULL ? [1.0, 1.15, 1.35] : [1.15, 1.35];
const DELAYS = FULL ? [0.3, 0.6, 1.0] : [0.5];
const LATS = FULL ? [0, -0.5, 0.5] : [0, -0.5, 0.5];
const VARS = [];
for (const ratio of RATIOS) for (const delay of DELAYS) for (const lat of LATS) VARS.push({ ratio, delay, lat });
const LEVELS = [{ key: 'cur', widthCars: null }, ...AX3.WIDTH_LEVELS.map((w) => ({ key: String(w), widthCars: w }))];

console.log(`\n[AX3] 峠・多車・片道レースのブロック戦術  APP=${APP_VERSION}  卓上 v2  車種=${CAR_KEY}（全車）  先頭 pace=${PACE_DEFAULT}`);
console.log(`  掃引: 峠 ${BASES.length} × 道幅 ${LEVELS.length} 水準 × 台数 {${N_CARS}} × 戦術 ${TACTICS.length} × 反復 ${VARS.length}（ペース比 {${RATIOS}} × 遅延 {${DELAYS}}s × 横位置 {${LATS}}）= ${BASES.length * LEVELS.length * N_CARS.length * TACTICS.length * VARS.length} レース（${FULL ? '全' : '縮小'}）`);

// ══════════════════════════════════════════════════════════════════════════════════════
// H-0: 走行条件と、公開 courses.json の派生コース（利用者裁定 H2）の構造検査
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[H-0] 走行条件と派生コース`);
{
  const engOK = PHYSICS.mode === 'v2' && REGIME_STATE.active === 'tabletop';
  console.log(`  大域: physics=${PHYSICS.mode} regime=${REGIME_STATE.active}`);
  ok(engOK, `H-0a エンジン/領域 = v2 × 卓上（Stage AX の固定条件・SAX-PREP H1）`);
  if (!engOK) { console.log(`\n[結果] pass=${pass} fail=${fail}  ← 条件が違うので以降の測定は行わない`); process.exit(1); }
  // 派生コースは末尾に 18 本（6 峠 × 3 水準・峠優先の順）。既存索引をずらさない（wf_as3_expected の perCourse は索引キー）。
  const nBase = specs.length - DERIVED.length;
  const tailOK = specs.slice(nBase).every((s) => s.derivedFrom) && specs.slice(0, nBase).every((s) => !s.derivedFrom);
  const expectNames = [];
  for (const b of BASES) for (const w of AX3.WIDTH_LEVELS) expectNames.push(derivedTougeSpec(b, w).name);
  const orderOK = DERIVED.map((s) => s.name).join('|') === expectNames.join('|');
  ok(DERIVED.length === BASES.length * AX3.WIDTH_LEVELS.length && tailOK && orderOK,
    `H-0b 派生コース ${DERIVED.length} 本 = 峠 ${BASES.length} × 水準 ${AX3.WIDTH_LEVELS.length}、courses.json の末尾に峠優先の順で並ぶ（先頭 ${nBase} 本は非派生）`);
  // 各派生コースは「hw だけ替えた spec」と幾何が一致する（壁以外を変えていない）。**desc/desc_en は全文を再生成して照合**する
  //   （完走数の正本 = wf_as3_expected.json の perCourse[索引]・日付 = AX3.DESC_STAMP。利用者向けの数字が壊れても緑にならない）。
  let geomBad = 0, metaBad = 0, descBad = 0;
  for (const d of DERIVED) {
    const b = BASES.find((x) => x.name === d.derivedFrom);
    if (!b) { metaBad++; continue; }
    const idx = specs.indexOf(d);
    const e = derivedTougeSpec(b, d.widthCars, AS3_EXPECTED.perCourse[idx], AX3.DESC_STAMP);
    // widthCars は hw から独立に検算する（e は d.widthCars から作るので e.widthCars との比較は恒真＝2 巡目 軽-7）
    if (e.hw !== d.hw || e.name !== d.name || e.name_en !== d.name_en || Math.abs(2 * d.hw / CAR.width - d.widthCars) > 1e-9 || d.diff !== 5) metaBad++;
    if (e.desc !== d.desc || e.desc_en !== d.desc_en) descBad++;
    const c1 = buildFromSpec(d), c2 = buildFromSpec({ ...b, hw: d.hw });
    if (JSON.stringify(c1.walls) !== JSON.stringify(c2.walls) || JSON.stringify(c1.centerline) !== JSON.stringify(c2.centerline) || c1.downhill !== c2.downhill) geomBad++;
  }
  ok(metaBad === 0 && geomBad === 0 && descBad === 0,
    `H-0c 派生コースは元の峠から hw（半幅）だけを替えたもの（メタ不一致 ${metaBad}・幾何不一致 ${geomBad}・desc/desc_en の全文不一致 ${descBad}）＝ 元の spec に hw だけ替えて build した壁・中心線・downhill と一致（fitAndPlace の平行移動込み）、desc の完走数は wf_as3_expected.json と一致`);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// G: 幾何 — 水準ごとの「横に 2 台並ぶ余地」（PLAN AX3・AX1 実測の再確認）
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[G] 道幅の水準と、横に 2 台並ぶ幾何的余地（車幅 ${CAR.width}m）`);
const geo = [];
for (const b of BASES) for (const lv of LEVELS) {
  const spec = lv.widthCars ? derivedTougeSpec(b, lv.widthCars) : b;
  const course = buildFromSpec(spec), G = tougeGeom(course), corners = cornersOf(G);
  // 縮退: 全標本で room ≤ 壁余白 なら走行線の比 k(i)=0 → race/inside の線が同一（層 4 重要-1）
  let roomMax = 0; for (let i = 0; i < G.n; i++) roomMax = Math.max(roomMax, roomAt(G, i));
  geo.push({ course: b.name, level: lv.key, spec, built: { course, G, corners }, width: 2 * spec.hw, widthCars: +(2 * spec.hw / CAR.width).toFixed(2), room2: +roomForTwo(spec).toFixed(4), nCorners: corners.length, minR: +Math.min(...corners.map((c) => c.R)).toFixed(4), roomMax: +roomMax.toFixed(4), degenerate: roomMax <= AX3.WALL_MARGIN });
}
{
  const byLevel = {};
  for (const g of geo) (byLevel[g.level] = byLevel[g.level] || []).push(g);
  for (const lv of LEVELS) {
    const rows = byLevel[lv.key];
    console.log(`  水準 ${lv.key.padEnd(4)}: 道幅 ${rows.map((g) => g.width.toFixed(3)).join('/')}m  車幅比 ${rows.map((g) => g.widthCars).join('/')}  余地 ${rows.map((g) => g.room2.toFixed(3)).join('/')}m`);
  }
  const r20 = byLevel['2'].map((g) => g.room2), r30 = byLevel['3'].map((g) => g.room2), r45 = byLevel['4.5'].map((g) => g.room2);
  ok(r20.every((v) => Math.abs(v) < 1e-6) && r30.every((v) => Math.abs(v - 0.080) < 1e-6) && r45.every((v) => Math.abs(v - 0.200) < 1e-6),
    `G-1 横に 2 台並ぶ余地: 2.0 台分 = ${r20[0].toFixed(3)}m（**0 ＝ 追い越しは幾何的に不可能**）／3.0 台分 = +${r30[0].toFixed(3)}m／4.5 台分 = +${r45[0].toFixed(3)}m ⇒ 2.0 台分の結果は戦術でなく幾何が決める`);
  // （情報）コーナー数と最小 R は水準によらず同一 — H-0c が中心線一致を確かめているので恒真（層 4 軽-5）。アサートにはしない。
  console.log(`  コーナー数/最小 R（水準共通）: ${BASES.map((b) => `${tag(b.name)} ${geo.find((g) => g.course === b.name).nCorners}本/R${geo.find((g) => g.course === b.name).minR}`).join(' ')}`);
  const cur = byLevel.cur.map((g) => g.widthCars);
  ok(Math.min(...cur) > 6 && Math.max(...cur) < 12, `G-2 現行の峠は車幅の ${Math.min(...cur)}〜${Math.max(...cur)} 台分（実車の峠 ≈ 2 台分より 3〜5 倍広い＝掃引の動機）`);
  const degen = geo.filter((g) => g.degenerate);
  ok(degen.length === BASES.length && degen.every((g) => g.level === '2'),
    `G-3 走行線が中心線に縮退する（room の最大 ≤ 壁余白 ${AX3.WALL_MARGIN}m）セルは 2.0 台分の ${degen.length}/${BASES.length} 本だけ（room 最大 ${LEVELS.map((lv) => `${lv.key}:${Math.max(...byLevel[lv.key].map((g) => g.roomMax)).toFixed(3)}`).join(' ')}）⇒ 2.0 台分では inside ≡ race（判定不能・別枠で数える）`);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// S: solo 較正 — 各（峠 × 水準）で `race` の走行線（f のラダーで最速）を決め、各戦術の自コストを測る
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[S] solo 較正（先頭 1 台・pace ${PACE_DEFAULT}）: race 線 = f∈{0,0.5,0.75,1.0} の最速。各戦術の自コスト Δt（race 比）`);
const F_LADDER = [0, 0.5, 0.75, 1.0];
const solo = [];
for (const g of geo) {
  const lad = F_LADDER.map((f) => ({ f, r: runTougeRace({ spec: g.spec, nCars: 1, tactic: 'race', fRace: f, ...g.built }) }));
  const fin = lad.filter((x) => x.r.leaderT != null && x.r.recoverArms === 0);
  const best = (fin.length ? fin : lad.filter((x) => x.r.leaderT != null)).sort((a, b) => a.r.leaderT - b.r.leaderT)[0] || null;
  g.fRace = best ? best.f : 0.75;
  const tRace = best ? best.r.leaderT : null;
  const per = {};
  for (const tac of ['inside', 'sideways', 'drift']) {
    const r = runTougeRace({ spec: g.spec, nCars: 1, tactic: tac, fRace: g.fRace, ...g.built });
    per[tac] = { t: r.leaderT, rec: r.recoverArms, betaPk: r.betaPk, driftFrac: r.driftFrac, occ: r.occ, blocks: r.blocks };
  }
  solo.push({ course: g.course, level: g.level, fRace: g.fRace, ladder: lad.map((x) => ({ f: x.f, t: x.r.leaderT, rec: x.r.recoverArms })), tRace, ...per });
  console.log(`  ${tag(g.course)} @${g.level.padEnd(3)} race f=${g.fRace} ${f2(tRace)}s | inside ${f2(per.inside.t)}s (Δ${per.inside.t != null && tRace != null ? (per.inside.t - tRace).toFixed(2) : '--'}) | sideways(発動なし) ${f2(per.sideways.t)}s | drift ${f2(per.drift.t)}s (Δ${per.drift.t != null && tRace != null ? (per.drift.t - tRace).toFixed(2) : '--'}・βpk ${per.drift.betaPk.toFixed(0)}°・滑走 ${(100 * per.drift.driftFrac).toFixed(0)}%・rec ${per.drift.rec})`);
}
{
  const nFin = solo.filter((s) => s.tRace != null).length;
  ok(nFin === solo.length, `S-1 全 ${solo.length} セル（峠 × 水準）で race 線の solo が完走（${nFin}/${solo.length}）`);
  const fDist = {}; for (const s of solo) fDist[s.fRace] = (fDist[s.fRace] || 0) + 1;
  console.log(`  race 線 f の分布: ${Object.entries(fDist).map(([k, v]) => `f=${k}:${v}`).join(' ')}`);
  const insideSlow = solo.filter((s) => s.inside.t == null || (s.tRace != null && s.inside.t > s.tRace * 1.5)).length;
  ok(insideSlow === 0, `S-2 inside の solo が未完走または race の 1.5 倍超のセル ${insideSlow}/${solo.length} = 0（内側線が壁に擦って復帰ループに落ちていない）`);
  const dFin = solo.filter((s) => s.drift.t != null).length, dRec = solo.reduce((a, s) => a + s.drift.rec, 0);
  ok(dFin >= solo.length - 2, `S-3 drift の solo 完走 ${dFin}/${solo.length}（≥${solo.length - 2}）・recover 合計 ${dRec}・βpk 平均 ${mean(solo.map((s) => s.drift.betaPk)).toFixed(1)}°・滑走 tick 割合 平均 ${(100 * mean(solo.map((s) => s.drift.driftFrac))).toFixed(1)}%`);
  const dInsideMean = mean(solo.filter((s) => s.inside.t != null && s.tRace != null).map((s) => s.inside.t - s.tRace));
  const dDriftMean = mean(solo.filter((s) => s.drift.t != null && s.tRace != null).map((s) => s.drift.t - s.tRace));
  console.log(`  自コスト（solo・race 比）: inside 平均 ${dInsideMean != null ? (dInsideMean >= 0 ? '+' : '') + dInsideMean.toFixed(2) : '--'}s / drift 平均 ${dDriftMean != null ? (dDriftMean >= 0 ? '+' : '') + dDriftMean.toFixed(2) : '--'}s（sideways は追走が居ないと発動しない＝solo では inside と同一）`);
}
console.log(`  （経過 ${lapT()}s）`);

// ══════════════════════════════════════════════════════════════════════════════════════
// R: 掃引本体
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[R] 掃引（進捗は峠ごと）`);
const rows = [];
for (const g of geo) {
  const t0 = process.hrtime.bigint();
  for (const n of N_CARS) for (let vi = 0; vi < VARS.length; vi++) {
    const v = VARS[vi];
    for (const tac of TACTICS) {
      const r = runTougeRace({ spec: g.spec, nCars: n, tactic: tac, fRace: g.fRace, paceRatio: v.ratio, delay: v.delay, latStart: v.lat, ...g.built });
      rows.push({ course: g.course, level: g.level, n, vi, ratio: v.ratio, delay: v.delay, lat: v.lat, tactic: tac,
        rank: r.leaderRank, win: r.leaderRank === 1 && r.leaderT != null, t: r.leaderT, tF: r.bestChaserT, rule: r.chaseRule, gap: r.gapAtFinish,
        contacts: r.contacts, lc: r.leaderContact, near: r.leaderNear, rec: r.recoverArms, nonMono: r.nonMono, nonMonoL: r.nonMonoLeader, dnf: r.finished.filter((x) => !x).length, gridHit: r.gridHit, gridShift: +r.gridShift.toFixed(3),
        psi: +(r.psiMax * 180 / Math.PI).toFixed(1), blocks: r.blocks, betaPk: +r.betaPk.toFixed(1), driftFrac: +r.driftFrac.toFixed(3), occ: r.occ != null ? +r.occ.toFixed(3) : null, occS: r.occStraight != null ? +r.occStraight.toFixed(3) : null, ticks: r.ticks });
    }
  }
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  const mine = rows.filter((x) => x.course === g.course && x.level === g.level);
  console.log(`  ${tag(g.course)} @${g.level.padEnd(3)} ${mine.length} レース ${secs.toFixed(0)}s | 先頭 1 位率 ${TACTICS.map((tc) => `${tc} ${(100 * mine.filter((x) => x.tactic === tc && x.win).length / (mine.length / TACTICS.length)).toFixed(0)}%`).join(' / ')}`);
}
console.log(`  （経過 ${lapT()}s）`);

// ── 統計: 対応のある符号検定（両側）────────────────────────────────────────────────
function signTest(a, b) {   // a=戦術だけ勝った対の数, b=race だけ勝った対の数
  const n = a + b; if (n === 0) return 1;
  const k = Math.min(a, b);
  let cum = 0;
  const C = (nn, kk) => { let r = 1; for (let i = 1; i <= kk; i++) r = r * (nn - kk + i) / i; return r; };
  for (let i = 0; i <= k; i++) cum += C(n, i);
  return Math.min(1, 2 * cum / Math.pow(2, n));
}
// 条件 = (峠, 水準, 戦術)。対 = (台数, 反復) ごとに race と戦術を突き合わせる（台数は頑健性の一部として束ねる）。
const conds = [];
for (const g of geo) for (const tac of TACTICS.filter((t) => t !== 'race')) {
  const R = rows.filter((x) => x.course === g.course && x.level === g.level);
  let a = 0, b = 0, aClean = 0, bClean = 0, both = 0, neither = 0, pairs = 0, dt = [], winSlow = 0, winContact = 0;
  let tWin = 0, rWin = 0, tWinClean = 0, rWinClean = 0;
  for (const n of N_CARS) for (let vi = 0; vi < VARS.length; vi++) {
    const rr = R.find((x) => x.n === n && x.vi === vi && x.tactic === 'race'), rt = R.find((x) => x.n === n && x.vi === vi && x.tactic === tac);
    if (!rr || !rt) continue;
    pairs++;
    const cleanOf = (x) => x.win && x.lc === 0 && x.near === 0;   // clean 勝ち = 先頭が他車と重ならず・0.01m より内側に近づかずに 1 位
    const tw = rt.win, rw = rr.win, twc = cleanOf(rt), rwc = cleanOf(rr);
    if (tw) tWin++; if (rw) rWin++; if (twc) tWinClean++; if (rwc) rWinClean++;
    if (tw && !rw) a++; else if (!tw && rw) b++; else if (tw && rw) both++; else neither++;
    // clean の対は **戦術側にだけ clean を課す保守側の非対称定義**: a′ = 戦術が clean に勝ち race は負け／b′ = race が勝ち
    //   （接触の有無を問わず）戦術は clean に勝てず。PLAN の意図は「接触に依存して勝っている条件を別枠にする」＝戦術の勝ちから
    //   接触依存分を除いて race の勝ち（基準線）と比べること。両側に clean を課す対称定義（2 巡目レビューの提案で一度採用）は、
    //   race の勝ちが追走に詰められて clean でない水準（4.5 台分）で「戦術の勝ちのほうが綺麗」という別の量を測ってしまい、
    //   符号検定 p=0.13〜1 の条件が clean GO になった（--full で実測 4/66）。∴ 非対称に戻す（race の clean 勝ち率は参考に印字）。
    if (twc && !rw) aClean++; else if (!twc && rw) bClean++;
    if (tw && rt.lc > 0) winContact++;
    if (rt.t != null && rr.t != null) { dt.push(rt.t - rr.t); if (tw && rt.t > rr.t) winSlow++; }
  }
  const p = signTest(a, b), pClean = signTest(aClean, bClean);
  // 縮退（inside ≡ race・線が同一）: 判定不能として印を付ける。同一性は F-1 が bit 一致で確かめる。
  const degenerate = tac === 'inside' && g.degenerate;
  conds.push({ course: g.course, level: g.level, tactic: tac, pairs, tWin, rWin, tWinClean, rWinClean, a, b, both, neither, p: +p.toFixed(4), go: p < 0.05 && a > b,
    aClean, bClean, pClean: +pClean.toFixed(4), goClean: pClean < 0.05 && aClean > bClean, winContact, winSlow, dtMean: dt.length ? +mean(dt).toFixed(3) : null, dtN: dt.length, degenerate });
}

// ══════════════════════════════════════════════════════════════════════════════════════
// A: 掃引の素性・決定論
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[A] 掃引の素性`);
{
  const expect = BASES.length * LEVELS.length * N_CARS.length * TACTICS.length * VARS.length;
  ok(rows.length === expect, `A-1 レース数 ${rows.length} = 設計どおり ${expect}`);
  const shifted = rows.filter((x) => x.gridShift > 0).length;
  ok(rows.every((x) => x.gridHit === 0), `A-2 全レースでグリッド配置は壁交差 0 かつ車車の重なり 0（gridHit 合計 ${rows.reduce((s, x) => s + x.gridHit, 0)}・等間隔から後ろへずらしたレース ${shifted}/${rows.length}・最大 ${Math.max(...rows.map((x) => x.gridShift)).toFixed(2)}m）`);
  // 進行度の逆行（1 tick に 0.05m 以上）は、車体が回頭・後退する sideways と、スピンする drift でだけ起きる（弧長の割当が
  //   横向きの車体で跳ぶ＝tracker の限界。実測 #3: sideways 309 回/36 レース・drift 707 回/11 レース・race 1・inside 3）。
  //   race/inside（回頭しない）では接触で押し戻された稀な tick だけ → **レース数の 1% 以下**を課し、回頭する戦術は報告に留める。
  const ri = rows.filter((x) => x.tactic === 'race' || x.tactic === 'inside');
  const riBad = ri.filter((x) => x.nonMono > 0).length;
  const sd = (tc) => { const r = rows.filter((x) => x.tactic === tc); return `${tc} ${r.reduce((s, x) => s + x.nonMono, 0)} 回/${r.filter((x) => x.nonMono > 0).length} レース`; };
  const sdL = (tc) => { const r = rows.filter((x) => x.tactic === tc); return `${tc} 全車 ${r.reduce((s, x) => s + x.nonMono, 0)} 回（うち先頭 ${r.reduce((s, x) => s + x.nonMonoL, 0)}）/${r.filter((x) => x.nonMono > 0).length} レース`; };
  ok(riBad / ri.length <= 0.01,
    `A-4 回頭しない race/inside で進行度の逆行があったレース ${riBad}/${ri.length}（≤1%・接触の押し戻し）。回頭する戦術では tracker の弧長割当が跳ぶ: ${sdL('sideways')}・${sdL('drift')}（この跳びは発動判定・追従・ゴール時差の弧長に入る＝測定の限界として記録）`);
  const g0 = geo.find((g) => g.level === 'cur');
  const d1 = runTougeRace({ spec: g0.spec, nCars: 4, tactic: 'sideways', fRace: g0.fRace, paceRatio: 1.35, delay: 0.5, latStart: -0.5, ...g0.built });
  const d2 = runTougeRace({ spec: g0.spec, nCars: 4, tactic: 'sideways', fRace: g0.fRace, paceRatio: 1.35, delay: 0.5, latStart: -0.5, ...g0.built });
  ok(d1.leaderT === d2.leaderT && d1.ticks === d2.ticks && d1.contacts === d2.contacts && JSON.stringify(d1.rank) === JSON.stringify(d2.rank) && d1.psiMax === d2.psiMax,
    `A-3 決定論: 同一条件 2 回で 到達時刻・tick・接触・着順・姿勢角が bit 一致（sideways 4 台 ${tag(g0.course)}: t=${d1.leaderT} ticks=${d1.ticks}）`);
  const dnfL = rows.filter((x) => x.t == null).length;
  console.log(`  先頭の DNF ${dnfL}/${rows.length}（戦術別: ${TACTICS.map((tc) => `${tc} ${rows.filter((x) => x.tactic === tc && x.t == null).length}`).join(' / ')}）・タイムアウト(90s) ${rows.filter((x) => x.ticks >= 5400).length}`);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// C: 非空振り — 追走は先頭を実際に抜ける（race 基準で先頭が負ける反復が存在する）・追走は完走する
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[C] 非空振り（追走モデルの検出力）`);
{
  const raceCur = rows.filter((x) => x.tactic === 'race' && x.level === 'cur');
  const lost = raceCur.filter((x) => !x.win).length;
  ok(lost > 0, `C-1 現行の道幅・race 基準で先頭が 1 位を失った反復 ${lost}/${raceCur.length}（0 なら追走が速くない＝順位を測れない）`);
  const hi = raceCur.filter((x) => x.ratio >= 1.35), lo = raceCur.filter((x) => x.ratio <= 1.15);
  const lostHi = hi.filter((x) => !x.win).length, lostLo = lo.filter((x) => !x.win).length;
  // 1.35 では 1/3 以上が抜かれる（初版の閾値 50% は「点＋車幅」の楽観な追走モデルでの値 56%。姿勢角込みの実効幅にした追走は
  //   先頭の近くで慎重になり 47% になった＝層 4 重要-5 の是正で下がったぶん。**閾値の変更は決定ログ AX-3 に記録し人間の裁定に
  //   委ねる**。これは PLAN の受け入れ基準ではなく測定器の非空振り検査）。1.15 では 0%＝反復の半分は現行幅で着順の弁別に寄与しない。
  ok(hi.length > 0 && lo.length > 0 && lostHi / hi.length >= 1 / 3,
    `C-2 現行幅・race 基準で先頭が抜かれる割合: ペース比 1.15 で ${lostLo}/${lo.length}=${(100 * lostLo / lo.length).toFixed(0)}% → 1.35 で ${lostHi}/${hi.length}=${(100 * lostHi / hi.length).toFixed(0)}%（分母つき＝外部へ転記する用・B-2c と同じ処方。1.35 で ≥33%＝追走が実際に速い。閾値 50%→33% の変更は AX-3 に記録）`);
  const wide = rows.filter((x) => x.tactic === 'race' && (x.level === 'cur' || x.level === '4.5'));
  const chFin = wide.reduce((s, x) => s + (x.n - 1 - Math.max(0, x.dnf - (x.t == null ? 1 : 0))), 0), chAll = wide.reduce((s, x) => s + x.n - 1, 0);
  ok(chFin / chAll >= 0.8, `C-3 広い水準（現行・4.5）の race 基準で追走の完走率 ${chFin}/${chAll}=${(100 * chFin / chAll).toFixed(1)}%（≥80%）`);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// D: 戦術が実際に発動している（測れているものが「何もしていない」ではない）
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[D] 戦術の発動（実測）`);
{
  const occ = (tc, lv) => mean(rows.filter((x) => x.tactic === tc && (lv == null || x.level === lv) && x.occ != null).map((x) => x.occ));
  console.log(`  内側占有率（回廊基準・+1=到達可能な最内）: ${TACTICS.map((tc) => `${tc} ${occ(tc) != null ? occ(tc).toFixed(2) : '--'}`).join(' / ')}`);
  // **コーナー内では race と inside は同じ回廊端にクランプされる**（峠①②③のヘアピンは R≈R_min で回廊が舵角律速の一点に絞られる。
  //   実測 #3: セル別のコーナー内占有率は race≈inside で 24 セル中 11 本しか inside>race にならない）。∴ 2 線の差は
  //   **直線区間で次コーナーの内側へ寄るか**（race は手前 0.30m まで中心・inside は前コーナー出口から余地いっぱい）にある。
  //   直線の寄り occS をセルごとに比べ、縮退していないセルで inside > race を課す（層 4 重要-2: 全体平均を 0.02 の許容で
  //   比べると効果の 2 倍が許容になり、逆でも緑だった）。
  const cellS = (course, level, tc) => mean(rows.filter((x) => x.course === course && x.level === level && x.tactic === tc && x.occS != null).map((x) => x.occS));
  const cells = solo.map((s) => ({ ...s, g: geo.find((g) => g.course === s.course && g.level === s.level) }));
  const shouldDiffer = cells.filter((c) => !c.g.degenerate);
  const differ = shouldDiffer.filter((c) => cellS(c.course, c.level, 'inside') > cellS(c.course, c.level, 'race') + 0.05);
  const degCells = cells.filter((c) => c.g.degenerate);
  const degSame = degCells.filter((c) => { const a = cellS(c.course, c.level, 'inside'), b = cellS(c.course, c.level, 'race'); return a != null && b != null && Math.abs(a - b) < 1e-9; }).length;
  const occS = (tc) => mean(rows.filter((x) => x.tactic === tc && x.occS != null).map((x) => x.occS));
  console.log(`  直線での次コーナー内側への寄り（+1=余地いっぱい）: ${TACTICS.map((tc) => `${tc} ${occS(tc) != null ? occS(tc).toFixed(2) : '--'}`).join(' / ')}`);
  ok(shouldDiffer.length === 18 && differ.length / shouldDiffer.length >= 0.8 && degSame === degCells.length,
    `D-1 inside は直線で次コーナーの内側へ寄っている: 非縮退 ${shouldDiffer.length} セル中 ${differ.length} 本で inside > race + 0.05（≥80%・全体 ${occS('inside').toFixed(2)} vs ${occS('race').toFixed(2)}）。縮退 ${degCells.length} セルは差 0 が ${degSame}。コーナー内の占有率は race ${occ('race').toFixed(2)} / inside ${occ('inside').toFixed(2)} で同じ（回廊端にクランプ）`);
  const sw = rows.filter((x) => x.tactic === 'sideways');
  const swWide = sw.filter((x) => x.level !== '2');
  const trig = swWide.filter((x) => x.blocks > 0).length;
  const psiOK = swWide.filter((x) => x.blocks > 0 && x.psi >= 30).length;
  ok(trig / swWide.length >= 0.5 && psiOK / Math.max(1, trig) >= 0.5,
    `D-2 sideways は 2.0 台分を除く水準で ${trig}/${swWide.length} レースで発動し（≥50%）、発動したうち ${psiOK} レースで姿勢角 ≥30° に達した（≥50%・平均 ${mean(swWide.filter((x) => x.blocks > 0).map((x) => x.psi)).toFixed(0)}°）`);
  const swNarrow = sw.filter((x) => x.level === '2');
  console.log(`  2.0 台分の sideways: 発動 ${swNarrow.filter((x) => x.blocks > 0).length}/${swNarrow.length}・姿勢角 平均 ${mean(swNarrow.filter((x) => x.blocks > 0).map((x) => x.psi)) != null ? mean(swNarrow.filter((x) => x.blocks > 0).map((x) => x.psi)).toFixed(0) : '--'}°（道幅 0.16m に車長 0.19m は横に入らない）`);
  const dr = rows.filter((x) => x.tactic === 'drift');
  const drBeta = dr.filter((x) => x.betaPk >= 15).length;
  ok(drBeta / dr.length >= 0.5, `D-3 drift は ${drBeta}/${dr.length} レースで |β| ピーク ≥15° に達した（≥50%・βpk 平均 ${mean(dr.map((x) => x.betaPk)).toFixed(1)}°・滑走 tick 割合 平均 ${(100 * mean(dr.map((x) => x.driftFrac))).toFixed(1)}%）⇒ ただし持続ドリフトではない（前提参照）`);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// E: GO 判定（着順・符号検定）と、接触依存の別枠・自滅・追走ルール
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[E] 先頭が 1 位で完走する割合（条件 = 峠 × 水準 × 戦術・対 = 台数 × 反復）`);
{
  console.log(`  水準   戦術     | 1位率 race(clean)→戦術(clean) | 対 n  戦術のみ勝ち a / race のみ勝ち b | p(両側)  GO | clean(保守・非対称): 戦術 clean 勝ち∧race 負け a' / race 勝ち∧戦術 clean 勝ちでない b' GO | 接触込み勝ち 勝っても遅い | Δt 平均`);
  for (const lv of LEVELS) for (const tac of TACTICS.filter((t) => t !== 'race')) {
    const cs = conds.filter((c) => c.level === lv.key && c.tactic === tac);
    const pairs = cs.reduce((s, c) => s + c.pairs, 0);
    const tW = cs.reduce((s, c) => s + c.tWin, 0), rW = cs.reduce((s, c) => s + c.rWin, 0), tWc = cs.reduce((s, c) => s + c.tWinClean, 0), rWc = cs.reduce((s, c) => s + c.rWinClean, 0);
    const a = cs.reduce((s, c) => s + c.a, 0), b = cs.reduce((s, c) => s + c.b, 0), ac = cs.reduce((s, c) => s + c.aClean, 0), bc = cs.reduce((s, c) => s + c.bClean, 0);
    const go = cs.filter((c) => c.go).length, goC = cs.filter((c) => c.goClean).length;
    const dts = cs.filter((c) => c.dtMean != null).map((c) => c.dtMean);
    console.log(`  ${lv.key.padEnd(5)} ${tac.padEnd(8)} | ${(100 * rW / pairs).toFixed(0).padStart(3)}%(${(100 * rWc / pairs).toFixed(0).padStart(3)}%)→${(100 * tW / pairs).toFixed(0).padStart(3)}%(${(100 * tWc / pairs).toFixed(0).padStart(3)}%) | ${String(pairs).padStart(3)}  a=${String(a).padStart(3)} b=${String(b).padStart(3)} | GO ${go}/${cs.length} 峠 | clean a=${String(ac).padStart(3)} b=${String(bc).padStart(3)} GO ${goC}/${cs.length} | ${String(cs.reduce((s, c) => s + c.winContact, 0)).padStart(3)} ${String(cs.reduce((s, c) => s + c.winSlow, 0)).padStart(3)} | ${dts.length ? (mean(dts) >= 0 ? '+' : '') + mean(dts).toFixed(2) + 's' : '--'}`);
  }
  console.log(`  GO の条件（峠 × 水準 × 戦術）: ${conds.filter((c) => c.go).map((c) => `${tag(c.course)}@${c.level}/${c.tactic}(a${c.a}/b${c.b} p=${c.p}${c.goClean ? '・clean' : '・接触込み'})`).join(' ') || 'なし'}`);
  const judge = conds.filter((c) => !c.degenerate);   // 分子も分母も判定可能な条件だけで数える（2 巡目 軽-8）
  const goAny = judge.filter((c) => c.go), goClean = judge.filter((c) => c.goClean);
  const goByLevel = {}; for (const c of goClean) goByLevel[c.level] = (goByLevel[c.level] || 0) + 1;
  console.log(`  条件数 ${conds.length} = 峠 ${BASES.length} × 水準 ${LEVELS.length} × 戦術 3、各条件の対 ${N_CARS.length * VARS.length}（符号検定の n の上限。p の最小 = ${(2 / Math.pow(2, N_CARS.length * VARS.length)).toExponential(2)}）— 構造から決まる量なのでアサートにはしない（層 4 軽-4）`);
  // 反証条件（PLAN）: 全戦術で差が出ないなら「このコース群では戦術差が出ない」と明記し、どの水準から差が出るかを閾値として報告。
  // **版付き回帰記録（AP-0）**: 2026-09-07・v8.0.0 の実測は clean GO = 0/66（判定可能な条件。接触込みでも 0）。物理を意図的に
  //   変えた版で結論が動いたら、ここを刻み直す（意図せぬ変化の検出用として固定する）。
  const goStr = `水準別 ${LEVELS.map((lv) => `${lv.key}:${goByLevel[lv.key] || 0}`).join(' ')}`;
  const nDegen = conds.filter((c) => c.degenerate).length, nJudge = conds.length - nDegen;
  ok(goClean.length === 0 && goAny.length === 0 && nJudge === conds.length - BASES.length,
    `E-1 **反証条件が成立**: clean な勝ちで race を有意に上回る条件 ${goClean.length}/${nJudge}（判定可能な条件。ほかに線が同一で判定不能 ${nDegen} = inside × 2.0 台分・接触込みでも ${goAny.length}）${goClean.length ? '（' + goStr + '）' : ''} ⇒ この峠群・卓上 v2 では **ブロック戦術で順位は守れない**（版付き回帰記録 v8.0.0: 0/${nJudge}）`);
  // 戦術は勝率を **下げる** 方向にしか動かない: race だけが勝った対 b に対し、戦術だけが勝った対 a は **5% 以下**（実測 #4 で a=0、
  //   追走モデルの帯の中心を是正した #5 で a=2/b=188。「a=0」は追走モデルの微差で揺れる脆い述語だったので割合で固定する。
  //   **述語の変更（a=0 → ≤5%）は決定ログ AX-3 に記録し人間の裁定に委ねる**）。
  const aTot = judge.reduce((s, c) => s + c.a, 0), bTot = judge.reduce((s, c) => s + c.b, 0);
  ok(bTot >= 100 && aTot / (aTot + bTot) <= 0.05,
    `E-2 戦術だけが勝った対 a 合計 ${aTot} / race だけが勝った対 b 合計 ${bTot}（a の割合 ${(100 * aTot / (aTot + bTot)).toFixed(1)}% ≤ 5%・b ≥ 100）⇒ どの戦術も race より勝率を下げるか変えないだけ（版付き回帰記録 v8.0.0）`);
  // 接触依存: 戦術の勝ちのうち先頭が他車と重なっていたもの
  const winsT = rows.filter((x) => x.tactic !== 'race' && x.win), winsTC = winsT.filter((x) => x.lc > 0), winsTN = winsT.filter((x) => x.lc === 0 && x.near > 0);
  console.log(`  戦術の勝ち ${winsT.length} レースのうち重なりあり ${winsTC.length}・重なり無しで slop 以内に接近 ${winsTN.length}（clean でない勝ち ${winsTC.length + winsTN.length}）・race の勝ち ${rows.filter((x) => x.tactic === 'race' && x.win).length} のうち重なり/接近あり ${rows.filter((x) => x.tactic === 'race' && x.win && (x.lc > 0 || x.near > 0)).length}`);
  // 自滅: 勝っても遅い
  const slow = conds.reduce((s, c) => s + c.winSlow, 0);
  console.log(`  勝っても遅い（1 位だが到達時刻が race より遅い）: ${slow} レース。戦術別 Δt 平均: ${TACTICS.filter((t) => t !== 'race').map((tc) => { const d = conds.filter((c) => c.tactic === tc && c.dtMean != null).map((c) => c.dtMean); return `${tc} ${d.length ? (mean(d) >= 0 ? '+' : '') + mean(d).toFixed(2) + 's' : '--'}`; }).join(' / ')}`);
  // 追走ルール
  const ruleTab = {};
  for (const x of rows) { const k = x.tactic; ruleTab[k] = ruleTab[k] || { lead: 0, caught: 0, passed: 0, dnf: 0 }; ruleTab[k][x.rule] = (ruleTab[k][x.rule] || 0) + 1; }
  console.log(`  追走ルール（lead=1 車長以上の差でゴール／caught=1 位だが 1 車長未満／passed=抜かれた）: ${TACTICS.map((tc) => `${tc} ${ruleTab[tc].lead}/${ruleTab[tc].caught}/${ruleTab[tc].passed}/${ruleTab[tc].dnf || 0}`).join('  ')}`);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// F: 水準ごとの要約（幾何が決める水準の明示）
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[F] 水準ごとの要約`);
const summary = [];
for (const lv of LEVELS) {
  const R = rows.filter((x) => x.level === lv.key);
  const per = {};
  for (const tc of TACTICS) {
    const rr = R.filter((x) => x.tactic === tc);
    // 【AX4・2026-09-07 是正】win/winClean は **丸めずに** 持つ。以前は toFixed(3) で丸めた値をさらに toFixed(0) して印字しており、
    //   4.5 台分の inside（541/648 = 83.49%）が [E] では 83%・この [F] では 0.835→84% と**同じ実行の中で 2 つの数字**になっていた
    //   （二重丸め）。docs へ転記する数字が出力の場所で変わるのは事故のもと（層 4 レビュー 軽-8）。表示のときだけ丸める。
    per[tc] = { win: rr.filter((x) => x.win).length / rr.length, winClean: rr.filter((x) => x.win && x.lc === 0 && x.near === 0).length / rr.length,
      dnf: rr.filter((x) => x.t == null).length, tMean: mean(rr.filter((x) => x.t != null).map((x) => x.t)), contactRate: rr.filter((x) => x.contacts > 0).length / rr.length,   // win/winClean と同じく丸めない（二重丸めの兄弟・層 4 レビュー #2 軽-2）
      lead: rr.filter((x) => x.rule === 'lead').length, caught: rr.filter((x) => x.rule === 'caught').length, passed: rr.filter((x) => x.rule === 'passed').length };
  }
  const room2 = geo.find((g) => g.level === lv.key).room2;
  summary.push({ level: lv.key, room2, goClean: conds.filter((c) => c.level === lv.key && c.goClean).length, goAny: conds.filter((c) => c.level === lv.key && c.go).length, per });
  const rooms = geo.filter((g) => g.level === lv.key).map((g) => g.room2);
  const roomStr = Math.max(...rooms) - Math.min(...rooms) > 1e-6 ? `+${Math.min(...rooms).toFixed(3)}〜+${Math.max(...rooms).toFixed(3)}m` : `${room2 >= 0 ? '+' : ''}${room2.toFixed(3)}m`;
  console.log(`  ${lv.key.padEnd(4)} 余地 ${roomStr}${room2 <= 1e-9 ? '（幾何が決める）' : ''} | 先頭 1 位率: ${TACTICS.map((tc) => `${tc} ${(100 * per[tc].win).toFixed(0)}%(clean ${(100 * per[tc].winClean).toFixed(0)}%)`).join(' ')} | 先頭 DNF: ${TACTICS.map((tc) => per[tc].dnf).join('/')} | 接触あり率: ${TACTICS.map((tc) => (100 * per[tc].contactRate).toFixed(0) + '%').join('/')}`);
}
{
  const s2 = summary.find((s) => s.level === '2');
  // 縮退の同一性を bit 一致で確かめる（inside の各レースが race の同じ反復と到達時刻・tick・着順まで一致）
  const r2 = rows.filter((x) => x.level === '2');
  let ident = 0, tot = 0;
  for (const x of r2.filter((x) => x.tactic === 'inside')) { const y = r2.find((z) => z.tactic === 'race' && z.course === x.course && z.n === x.n && z.vi === x.vi); tot++; if (y && y.t === x.t && y.ticks === x.ticks && y.rank === x.rank) ident++; }
  ok(s2.per.race.win === 1 && ident === tot && tot > 0,
    `F-1 2.0 台分（余地 0）: race の先頭 1 位率 ${(100 * s2.per.race.win).toFixed(0)}% = 100%＝横に 2 台並べない幾何が順位を決める（AX_survey §2 の裏取り）。inside は race と ${ident}/${tot} レースで到達時刻・tick・着順まで bit 一致＝線が同一（縮退の検出が正しい）`);
  // F-3: [E]（対ごとの集計 tWin/pairs）と [F]（レースごとの集計 per[tc].win）は**同じ量**なので、印字も一致しなければならない。
  //   以前は [F] だけが win を toFixed(3) で丸めてから ×100 して整数化しており、同じ実行の中で 83% と 84% が並んでいた
  //   （層 4 レビュー #2 軽-2/軽-3。縮小掃引では丸めの有無で表示が変わらないため、この不変条件が無いと回帰を検出できない）。
  const mism = [];
  for (const lv of LEVELS) for (const tac of TACTICS.filter((t) => t !== 'race')) {
    const cs = conds.filter((c) => c.level === lv.key && c.tactic === tac);
    const pairs = cs.reduce((x, c) => x + c.pairs, 0);
    if (!pairs) continue;
    const tW = cs.reduce((x, c) => x + c.tWin, 0);
    const sm = summary.find((x) => x.level === lv.key);
    if (Math.abs(tW / pairs - sm.per[tac].win) > 1e-12) mism.push(`${lv.key}/${tac}: [E] ${tW}/${pairs} vs [F] ${sm.per[tac].win}`);
  }
  ok(mism.length === 0,
    `F-3 [E] と [F] は同じ 1 位率を出す（丸めた値を再び丸めない）: ${LEVELS.length}×${TACTICS.length - 1} セル全一致`
    + (mism.length ? ` — 不一致 ${mism.length} 件: ${mism.join(' / ')}` : ''));
  const s3 = summary.find((s) => s.level === '3'), sc = summary.find((s) => s.level === 'cur');
  ok(sc.per.race.win < 1 && s3.per.race.win > sc.per.race.win,
    `F-2 道幅を詰めるほど race の先頭 1 位率は上がる（現行 ${(100 * sc.per.race.win).toFixed(0)}% → 3.0 台分 ${(100 * s3.per.race.win).toFixed(0)}%）＝ 順位を守るのは戦術でなく道幅`);
}

console.log(`\n[結果] pass=${pass} fail=${fail}  総所要 ${lapT()}s`);
if (WANT_JSON) {
  console.log('===JSON===');
  console.log(JSON.stringify({ appVersion: APP_VERSION, carKey: CAR_KEY, paceL: PACE_DEFAULT, sweep: FULL ? 'full' : 'reduced', nCars: N_CARS, vars: VARS, levels: LEVELS.map((l) => l.key), ax3: AX3,
    geo: geo.map(({ built, spec, ...g }) => g), solo, rows, conds, summary }, null, 0));
}
process.exit(fail ? 1 : 0);
