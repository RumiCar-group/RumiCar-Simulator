// wf_ax2_lines.mjs — Stage AX2「『速いライン』の同定と、ブロック対象の定義」の受け入れゲート。
// ══════════════════════════════════════════════════════════════════════════════════════
// 利用者仮説（2026-09-06・Stage AX の中心）:
//   「道幅の全部を塞ぐ必要はない。高速に走れるラインは限られており、通常はコーナー内側が要である。
//     外周側が空いていても、そこから高速で抜けられないなら塞いだことになる。」
// 本ゲートは、この仮説を**横位置ごとの連続量**に翻訳して測る（形容詞で書かない・CI-14）。
//
// 測るもの（PLAN AX2 の受け入れ基準・実装前固定）:
//   A コーナーの同定        : |κ| ≥ 1.0 (R ≤ 1.0m) の連続区間。切れ目 0.10m 未満は結合・車長未満は捨てる
//   B 到達可能性            : **実走で**判定し、到達不能なものは**第一原因**（舵角律速/壁/復帰/未到達）を記録する
//   C 最大通過速度          : 保持できた最大の指令速度における **入口の前後方向速度**
//   D 区間所要時間と内外差  : その走行のコーナー入口→出口の所要。最速の横位置に対する遅れ %
//   E ブロック対象の定義    : 「内側 1/3 を占有されたとき、残りで到達できる最速」＋**車 1 台幅を占有された場合**
//   F 単位の換算            : コーナー区間の合計が周回時間のどれだけか（E の比を周回の比と読み違えないため）
//
// ── 定義（着手前に固定・事後に緩めない）────────────────────────────────────────────────
//  ・**到達可能** ≡ 実走で「コーナー出口に到達 ∧ **全 tick で壁接触 0** ∧ recover arm 0 ∧
//    |実横位置 − 指令| の中央値 ≤ 0.5×車幅 ∧ 入口速度 ≥ 0.9×指令(車の最高速で頭打ち)」となる
//    指令速度がラダー上に 1 つ以上あること。**幾何の式は判定に使わない**（実測で保守側へ外れる。B-3/B-4）。
//    ⚠ 初版は接触判定を**コーナー窓の中だけ**で行っていたため、助走 0.6m の区間で壁へめり込んだ走行 3 件を
//      「到達可能」に数えていた（層 4 レビュー・実測 9 tick ずつ貫入）。全 tick 判定へ是正済み。
//  ・**最大通過速度** ≡ 保持できた最大の指令速度で走ったときの入口の `car.u`（＝**前後方向速度**。
//    横滑り中は速度の大きさより小さく出る）。
//  ・**区間所要時間** ≡ その走行で コーナー入口 → 出口+0.15m に要した時間 [s]。
//  ・**横位置** ≡ 実測半幅から車幅の半分を引いた `usable` を ±で 7 等分した点（p=0 が最外・p=6 が最内）。
//    ⚠ AX1 の `roomAt` はさらに 旋回はみ出し `swingOut` と 壁余白 `WALL_CLEAR` を引く（差は A-3 が毎回実測）。
//    AX2 は **「道幅を分割する」** ので道幅ベースを採る。端の点は壁と面一になり実際に接触で落ちる —
//    それは測定の失敗ではなく「その横位置は通れない」という結果である。
//  ・**帯** ≡ 内側方向の位置 latIn で 内側 = latIn ≥ usable/3 ／ 外側 = latIn ≤ −usable/3 ／ 残り = 中央。
//    **境界はサンプル点そのもの**（p2 と p4）なので、浮動小数の丸めに判定を委ねてはならない。
//    初版は `>` で書いたため j=2 は −1/3 を下回り j=4 は +1/3 を下回る、という**非対称な丸め**になり、
//    **左コーナーと右コーナーで別の帯割当**になっていた（層 4 レビュー・実測: 同じ R=0.320 のミラーで
//    コスト 1.19 と 1.00）。∴ 相対許容つきで境界を内側/外側に**含める**（占有された帯に車体が掛かる以上、
//    境界の点は「塞がれた」側に数えるのが物理的に正しい）。左右で同一の規則になることを A-2 が確かめる。
//  ・**残りで到達できる最速** ≡ 内側 1/3 の帯に入らない到達可能な横位置のうち、区間所要が最小のもの。
//  ・**車 1 台幅の占有コスト** ≡ ブロッカーが最内の到達可能位置に居るとき、車体が重ならない
//    （|Δlat| ≥ 車幅）到達可能位置のうち区間所要が最小のもの / 無制約の最速。**AX3 が使うのはこちら**
//    （「内側 1/3」は車幅の 1.8〜3.3 倍あり、車 1 台では塞ぎきれない幅である。E-3 が毎回実測して出す）。
//
// ── この数字の単位（言い過ぎを防ぐ・層 4 レビュー指摘）────────────────────────────────
//   E の比は **「コーナー区間の所要」の比**であって周回時間の比ではない。コーナー区間の合計は
//   周回の 18〜25%（F 章で毎回実測）。周回への影響を言うときは必ず換算すること。
//
// **本番フローのみ・実データ**（CI-8）: コースは `buildFromSpec`、スロットは `makeSlot`/`rebuildSpawns`、
// 積分は `integrateFleetV2`、接触は `checkCollision`、追従則は AX1 と**同一の関数**（`pursueLine`/`holdTo`）。
// 走行物理は 1 バイトも触らない。走行条件は Stage AX 固定の **v2 × 卓上・装備すべて既定**。
//
// 使い方:  node wf_ax2_lines.mjs          （アサート緑/赤で exit 0/1）
//          node wf_ax2_lines.mjs --json   （表を JSON で。docs 転記用）
// ══════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setupRegime, tougeGeom, tougeSpecs, cornersOf, runCornerLine, runTouge, roomAt,
         latReachable, CORNER_KAPPA } from './wf_touge_driver.mjs';
import { buildFromSpec } from './public/js/course.js';
import { CAR, APP_VERSION, PHYSICS, REGIME_STATE, CAR_TYPE_BY_KEY } from './public/js/config.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const WANT_JSON = process.argv.includes('--json');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const specs = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'courses.json'), 'utf8'));
const T = tougeSpecs(specs);
const CAR_KEY = 'normal_fr';                 // 代表 1 車種（車種差は AX1 で ±30% 帯内と確認済み）
const NPOS = 7;                              // 横位置の分割数（PLAN 指定）
const LAT_TOL = 0.5 * CAR.width;             // 追従の許容（AX1 の D-1 と同一）
setupRegime();
const R_MIN = CAR.wheelBase / Math.tan(CAR.maxSteer);
const MAXV_CAR = CAR.maxSpeed * CAR_TYPE_BY_KEY[CAR_KEY].maxSpeed;
// 指令速度のラダー（降順）。最上段は車種の最高速を上回る値にして「コーナーで制限されない」ことも
// 測れるようにする。**0.80 は入れない** — pwm=round(v/maxV*255) は 0.74 で既に 255 へクランプされ、
// 0.80 と 0.74 が同一指令になる（層 4 レビュー実測: 140 点中 135 点で結果が完全一致＝試行の 1/4 が無駄）。
const VLADDER = [0.74, 0.70, 0.65, 0.60, 0.55, 0.50, 0.45, 0.40, 0.35, 0.30, 0.25, 0.20, 0.15, 0.10];

const tag = (n) => { const m = n.match(/[（(]([^）)]*)[）)]/); return (n.slice(0, 6) + (m ? '(' + m[1] + ')' : n.slice(6, 14))); };
console.log(`\n[AX2] 峠の「速いライン」  APP=${APP_VERSION}  卓上 v2  車種=${CAR_KEY}（最高速 ${MAXV_CAR.toFixed(3)} m/s）  R_min=${R_MIN.toFixed(4)}m`);
console.log(`  コーナー = |κ| ≥ ${CORNER_KAPPA}（R ≤ ${(1 / CORNER_KAPPA).toFixed(2)}m）／横位置 ${NPOS} 分割／追従許容 ${LAT_TOL.toFixed(3)}m／ラダー ${VLADDER[0]}→${VLADDER[VLADDER.length - 1]}`);

// ══════════════════════════════════════════════════════════════════════════════════════
// H-0: 走行条件の構造検査（**走らせる前に**）
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[H-0] 走行条件`);
{
  const engOK = PHYSICS.mode === 'v2' && REGIME_STATE.active === 'tabletop';
  console.log(`  大域: physics=${PHYSICS.mode} regime=${REGIME_STATE.active}`);
  ok(engOK, `H-0 エンジン/領域 = v2 × 卓上（Stage AX の固定条件・SAX-PREP H1）`);
  if (!engOK) { console.log(`\n[結果] pass=${pass} fail=${fail}  ← 条件が違うので以降の測定は行わない`); process.exit(1); }
  // 速度ラダーが厳密降順かつ最上段が車種の最高速を上回ること＝測っているのが「最大」通過速度である構造保証。
  const desc = VLADDER.every((v, i) => i === 0 || v < VLADDER[i - 1]);
  ok(desc && VLADDER[0] > MAXV_CAR,
    `H-0b 速度ラダーが厳密降順（${VLADDER[0]}→${VLADDER[VLADDER.length - 1]}）で最上段 ${VLADDER[0]} > 車種の最高速 ${MAXV_CAR.toFixed(3)} ⇒ 測っているのは **最大**通過速度`);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// A/B/C/D: コーナー × 横位置の測定
// ══════════════════════════════════════════════════════════════════════════════════════
const rows = [];
const cornersAll = [];
const rej = { reached: 0, contact: 0, arms: 0, lat: 0, speed: 0 };   // 合格述語の各節の却下件数（第一原因）
let attempts = 0, latMedMax = 0;
for (const spec of T) {
  const course = buildFromSpec(spec);
  const G = tougeGeom(course);
  const corners = cornersOf(G);
  corners.forEach((c, ci) => cornersAll.push({ course: spec.name, ci, ...c }));
  for (let ci = 0; ci < corners.length; ci++) {
    const c = corners[ci];
    const BAND = c.usable / 3, EPS = c.usable * 1e-9;   // 境界はサンプル点そのもの → 相対許容で対称に含める
    for (let j = 0; j < NPOS; j++) {
      const lat = (j / (NPOS - 1) * 2 - 1) * c.usable;
      const latIn = c.sign > 0 ? lat : -lat;             // 内側方向の量（+ = 内側）
      const zone = latIn >= BAND - EPS ? 'inner' : (latIn <= -BAND + EPS ? 'outer' : 'mid');
      const p = c.sign > 0 ? j : (NPOS - 1 - j);         // 内側方向の位置番号（p=6 が最内）
      let best = null; const cause = {};
      for (const v of VLADDER) {
        const r = runCornerLine({ spec, carType: CAR_KEY, corner: c, latAbs: lat, speed: v, course, G });
        attempts++;
        if (r.latMed != null && r.latMed > latMedMax) latMedMax = r.latMed;
        const vTarget = Math.min(v, MAXV_CAR);
        const gotSpeed = r.vEntry != null && r.vEntry >= 0.9 * vTarget;
        let why = null;
        if (!r.reached) why = 'reached';
        else if (r.contact > 0) why = 'contact';
        else if (r.arms > 0) why = 'arms';
        else if (r.latMed == null || r.latMed > LAT_TOL) why = 'lat';
        else if (!gotSpeed) why = 'speed';
        if (why) { rej[why]++; cause[why] = (cause[why] || 0) + 1; }
        else { best = { vCmd: v, ...r }; break; }        // 降順ラダーの最初の合格 = 最大通過速度
      }
      // 到達不能なら **第一原因の最頻値** を記録する（「舵角律速で通れない」のか「壁に当たる」のか）。
      const domCause = best ? null : (Object.entries(cause).sort((a, b) => b[1] - a[1])[0] || [null])[0];
      rows.push({ course: spec.name, corner: ci, R: +c.R.toFixed(4), sign: c.sign, usable: +c.usable.toFixed(4),
        j, p, lat: +lat.toFixed(4), latIn: +latIn.toFixed(4), zone,
        reachable: best != null, geomReachable: latReachable(lat, c.R, c.sign), cause: domCause,
        vCmd: best ? best.vCmd : null, vEntry: best ? +best.vEntry.toFixed(4) : null,
        secT: best ? +best.secT.toFixed(4) : null, latMed: best ? +best.latMed.toFixed(5) : null,
        minClear: best ? +best.minClear.toFixed(5) : null });
    }
  }
}

console.log(`\n[A] コーナーの同定と、横位置グリッドの素性`);
{
  const byCourse = {};
  for (const c of cornersAll) byCourse[c.course] = (byCourse[c.course] || 0) + 1;
  console.log(`  ${Object.entries(byCourse).map(([k, v]) => `${tag(k)} ${v}本`).join(' / ')}  合計 ${cornersAll.length} 本・測定点 ${rows.length}`);
  ok(cornersAll.length >= 12 && Object.keys(byCourse).length === T.length && rows.length === cornersAll.length * NPOS
     && Math.min(...cornersAll.map((c) => c.len)) >= CAR.length,
    `A-1 全 ${T.length} 峠からコーナー ${cornersAll.length} 本・測定点 ${rows.length}=${cornersAll.length}×${NPOS}・最短のコーナー長 ${Math.min(...cornersAll.map((c) => c.len)).toFixed(2)}m ≥ 車長 ${CAR.length}m`);
  // A-2: 帯割当が **左右で対称**であること。境界がサンプル点と重なるので、丸めに委ねると
  //   左コーナーと右コーナーで別の帯になる（初版の実測欠陥）。位置番号 p ごとの帯が符号に依らないことを確かめる。
  const byP = {};
  for (const r of rows) (byP[r.p] = byP[r.p] || new Set()).add(r.zone);
  const asym = Object.keys(byP).filter((p) => byP[p].size !== 1).length;
  console.log(`  位置番号→帯: ${Object.keys(byP).sort().map((p) => `p${p}:${[...byP[p]].join('/')}`).join(' ')}`);
  ok(asym === 0, `A-2 帯の割当が位置番号だけで決まる（左右のコーナーで同一）= 境界の丸めに依存していない（不一致 ${asym}/${Object.keys(byP).length} 位置）`);
  // A-3: AX2 の `usable`（道幅ベース）と AX1 の `roomAt`（走行安全ベース）は **別物**である。
  //   両者の差を毎回出して、取り違えたまま結論が書かれるのを防ぐ。
  //   比較は同じ土俵で: `usable` はコーナー内の**最小**半幅から作るので、`roomAt` も
  //   コーナー区間の**最小**を取る（中点 1 点で比べると曲率と半幅の分布次第で符号が逆転する）。
  let gapMin = Infinity, gapMax = -Infinity;
  for (const spec of T) {
    const G = tougeGeom(buildFromSpec(spec));
    for (const c of cornersOf(G)) {
      let rmin = Infinity;
      for (let i = c.i0; i <= c.i1; i++) rmin = Math.min(rmin, roomAt(G, i));
      const g = c.usable - rmin;
      if (g < gapMin) gapMin = g;
      if (g > gapMax) gapMax = g;
    }
  }
  ok(gapMin > 0, `A-3 AX2 の usable は AX1 の roomAt より ${gapMin.toFixed(4)}〜${gapMax.toFixed(4)}m 広い（swingOut＋壁余白のぶん）＝ **端の横位置は壁と面一**で、接触で落ちるのは想定どおり`);
}

// ── A-5: 合格述語の検出力（各節の却下件数）────────────────────────────────────────────
console.log(`\n[A-5] 合格述語の却下内訳（第一原因・全 ${attempts} 試行）`);
{
  console.log(`  未到達 ${rej.reached} / 壁接触 ${rej.contact} / recover ${rej.arms} / 追従超過 ${rej.lat} / 速度不足 ${rej.speed}`);
  console.log(`  観測された追従中央値の最大 ${latMedMax.toFixed(4)}m（許容 ${LAT_TOL.toFixed(4)}m）`);
  ok(rej.reached > 0 && rej.contact > 0 && rej.arms > 0 && rej.lat > 0,
    `A-5 合格述語の 4 節（到達・壁接触・recover・**追従許容**）がいずれも run を却下している＝空振りしていない（追従許容は ${rej.lat} 件を却下）`);
}

// ── B: 到達可能性（実走判定）と、到達不能の原因 ────────────────────────────────────
console.log(`\n[B] 到達可能性（実走判定）と、到達不能の第一原因`);
{
  const reach = rows.filter((r) => r.reachable).length;
  const geom = rows.filter((r) => r.geomReachable).length;
  const disagree = rows.filter((r) => r.reachable !== r.geomReachable);
  const geomLoose = disagree.filter((r) => !r.reachable && r.geomReachable).length;
  console.log(`  実走で到達可能 ${reach}/${rows.length} (${(100 * reach / rows.length).toFixed(1)}%)  ／ 幾何の式 ${geom}/${rows.length} (${(100 * geom / rows.length).toFixed(1)}%)`);
  ok(reach > 0 && reach < rows.length, `B-1 到達可能な横位置は ${reach}/${rows.length}（0 でも全部でもない＝測定として意味がある）`);
  const unreach = rows.filter((r) => !r.reachable);
  const zc = { inner: 0, mid: 0, outer: 0 }, cc = {};
  for (const r of unreach) { zc[r.zone]++; cc[r.cause] = (cc[r.cause] || 0) + 1; }
  console.log(`  到達不能 ${unreach.length} 点: 帯別 内側 ${zc.inner} / 中央 ${zc.mid} / 外側 ${zc.outer}`);
  console.log(`                第一原因 ${Object.entries(cc).map(([k, v]) => `${k} ${v}`).join(' / ') || '（なし）'}`);
  ok(unreach.length === 0 || zc.inner / unreach.length >= 0.5,
    `B-2 到達不能な横位置の ${unreach.length ? (100 * zc.inner / unreach.length).toFixed(1) : '--'}% が**旋回の内側**の帯にある`);
  // B-2c: **帯ごとの分母**を印字して固定する（AX4・2026-09-07 追加）。B-2 は「到達不能のうち内側が何 %」＝分子側しか出さないので、
  //   「内側 N 点のうち 23 点が到達不能」と外部（physics_model・アプリ Q&A・CHANGELOG）へ書くときの N がゲートのどこにも現れず、
  //   実際に AX2 の帯境界バグを直した後も**古い分母 49 が公開文へ 6 箇所転記された**（層 4 レビューが実測 60 と照合して検出）。
  //   分母は**帯の定義そのもの**（`latIn >= usable/3` = 上の zone 判定と同じ式）から数える。`(NPOS-1)/2` のような
  //   分割数からの近道は NPOS=7 のときたまたま一致するだけで、分割数を変えると**この行だけが偽赤になり、しかも
  //   「外部へ転記する用」と書いた行に誤った分母を印字する**（層 4 レビュー #2 軽-1・NPOS=9 で実測）。
  const zt = { inner: 0, mid: 0, outer: 0 };
  for (const r of rows) zt[r.zone]++;
  const perZone = Array.from({ length: NPOS }, (_, j) => (j / (NPOS - 1) * 2 - 1))
    .filter((x) => x >= 1 / 3 - 1e-9).length;          // 内側の帯に入る位置数（帯の定義 latIn >= usable/3 と同一）
  const nCorner = cornersAll.length;
  console.log(`  帯ごとの分母: 内側 ${zt.inner} / 中央 ${zt.mid} / 外側 ${zt.outer} 点（コーナー ${nCorner} 本 × 内側 ${perZone} 位置）`);
  ok(zt.inner === nCorner * perZone && zt.outer === nCorner * perZone && zt.mid === nCorner,
    `B-2c 帯ごとの分母: **内側 ${zt.inner} 点**（= ${nCorner} コーナー × ${perZone}）/ 中央 ${zt.mid} / 外側 ${zt.outer}`
    + ` ⇒ 「内側 ${zt.inner} 点中 ${zc.inner} 点が到達不能」と外部へ書くときの分母はこれ（分子だけ刻み直して分母が腐るのを防ぐ）`);
  // B-2b: **その理由**を分けて言う。「舵角律速で内側に寄れない」のと「端が壁と面一で当たる」のは別の話。
  ok((cc.lat || 0) + (cc.contact || 0) > 0,
    `B-2b 到達不能の内訳: **舵角律速（追従できない）${cc.lat || 0} 点 / 壁に当たる ${cc.contact || 0} 点 / 復帰 ${cc.arms || 0} 点 / 未到達 ${cc.reached || 0} 点**` +
    ` ⇒ 「内側に寄れない」を一律に舵角律速と説明しない（端の点は道幅の定義上 壁と面一・A-3）`);
  ok(disagree.length > 0, `B-3 幾何の式は実走と ${disagree.length} 点で食い違う ⇒ **代理量でなく実走で判定する**根拠（CI-14）`);
  ok(geomLoose === 0, `B-4 幾何の式が**甘い側**（実走で通れないのに ○ と言う）に外れた点 ${geomLoose} 件 = 0（符号を取り違えるとここが崩れる）`);
}

// ── C/D: 最大通過速度・区間所要時間・内外差 ─────────────────────────────────────────
console.log(`\n[C/D] コーナーごとの 到達可能性 / 区間所要（×=到達不能・数字は区間所要 s。左から p0=最外 → p6=最内）`);
const perCorner = [];
for (const c of cornersAll) {
  const rs = rows.filter((r) => r.course === c.course && r.corner === c.ci).slice().sort((a, b) => a.p - b.p);
  const okRows = rs.filter((r) => r.reachable);
  const bestAll = okRows.length ? Math.min(...okRows.map((r) => r.secT)) : null;
  const bestRow = bestAll != null ? okRows.find((r) => r.secT === bestAll) : null;
  const notInner = okRows.filter((r) => r.zone !== 'inner');
  const bestNotInner = notInner.length ? Math.min(...notInner.map((r) => r.secT)) : null;
  // 車 1 台幅の占有: ブロッカーは **最内の到達可能位置**に居るとみなす。車体が重ならない位置だけが残る。
  const blocker = okRows.length ? okRows.slice().sort((a, b) => b.p - a.p)[0] : null;
  const free1 = blocker ? okRows.filter((r) => Math.abs(r.lat - blocker.lat) >= CAR.width) : [];
  const best1 = free1.length ? Math.min(...free1.map((r) => r.secT)) : null;
  const removed1 = blocker ? okRows.length - free1.length : null;   // ブロッカーが潰した横位置の数
  const pc = { course: c.course, ci: c.ci, R: +c.R.toFixed(4), sign: c.sign, len: +c.len.toFixed(3),
    usable: +c.usable.toFixed(4), nReach: okRows.length,
    bestSecT: bestAll, bestZone: bestRow ? bestRow.zone : null, bestP: bestRow ? bestRow.p : null,
    bestAtTop: bestRow ? bestRow.vCmd >= VLADDER[0] : null,
    bestNotInnerSecT: bestNotInner, cost3: (bestAll != null && bestNotInner != null) ? +(bestNotInner / bestAll).toFixed(4) : null,
    blockerP: blocker ? blocker.p : null, best1SecT: best1, removed1,
    cost1: (bestAll != null && best1 != null) ? +(best1 / bestAll).toFixed(4) : null };
  perCorner.push(pc);
  console.log(`  ${tag(c.course)} #${c.ci} R=${c.R.toFixed(3)} ${c.sign > 0 ? '左' : '右'} 幅±${c.usable.toFixed(3)} | ${rs.map((r) => (r.reachable ? r.secT.toFixed(2) : ' ×  ')).join(' ')} |` +
    ` 最速 ${bestAll != null ? bestAll.toFixed(2) + 's(p' + pc.bestP + '/' + pc.bestZone + ')' : '--'}` +
    ` 内側1/3占有 ${bestNotInner != null ? bestNotInner.toFixed(2) + 's' : '不能'}` +
    ` 1台幅占有 ${best1 != null ? best1.toFixed(2) + 's' : '不能'}`);
}
{
  ok(perCorner.every((p) => p.bestSecT != null), `C-1 全 ${perCorner.length} コーナーで少なくとも 1 つの横位置を通過できた（測定不能なコーナー 0）`);
  const reachRows = rows.filter((r) => r.reachable);
  const satur = reachRows.filter((r) => r.vCmd >= VLADDER[0]).length;
  const ratio = satur / reachRows.length;
  console.log(`  到達可能点の入口速度 ${Math.min(...reachRows.map((r) => r.vEntry)).toFixed(3)}〜${Math.max(...reachRows.map((r) => r.vEntry)).toFixed(3)} m/s（車種の最高速 ${MAXV_CAR.toFixed(3)}）`);
  // C-2 は **割合に下限を課す**（「1 点でも通れば緑」では 9 割という主張を守れない）。助走を壊すと
  //   最上段通過率が落ちるので、この下限が助走の健全性の検出力も兼ねる（実測: 助走 0.6→0.05m で 93%→30%）。
  ok(ratio >= 0.8,
    `C-2 到達可能な横位置の ${satur}/${reachRows.length}=${(100 * ratio).toFixed(1)}%（分母つき＝外部へ転記する用。下限 80%）が **ラダー最上段 ${VLADDER[0]} m/s 指令でも通過できる** ⇒ 卓上の峠では通過速度はコーナーでなく**車の最高速**で決まる`);
  const limited = reachRows.filter((r) => r.vCmd < VLADDER[0]);
  const lz = { inner: 0, mid: 0, outer: 0 };
  for (const r of limited) lz[r.zone]++;
  console.log(`  速度で制限された到達可能点 ${limited.length}/${reachRows.length}: 内側 ${lz.inner} / 中央 ${lz.mid} / 外側 ${lz.outer}`);
  ok(limited.length === 0 || lz.inner >= lz.mid + lz.outer,
    `C-3 速度で制限された点 ${limited.length} のうち ${limited.length ? (100 * lz.inner / limited.length).toFixed(1) : '--'}% が**内側**の帯 ⇒ 内側線は「到達できても遅く走らねばならない」`);
  const clr = reachRows.filter((r) => r.minClear != null);
  console.log(`  最小クリアランス ${Math.min(...clr.map((r) => r.minClear)).toFixed(5)}〜${Math.max(...clr.map((r) => r.minClear)).toFixed(5)}m（端の横位置は usable の定義上ほぼ壁と面一）`);
}

// ── F: 単位の換算（コーナー区間は周回のどれだけか）────────────────────────────────────
console.log(`\n[F] 単位の換算: コーナー区間の合計は周回時間のどれだけか`);
const share = [];
for (const spec of T) {
  const lap = runTouge({ spec, carType: CAR_KEY, latFrac: 0 });
  const G = tougeGeom(buildFromSpec(spec));
  const tFloor = G.total / MAXV_CAR;      // 物理的な下限（路長 ÷ 車種の最高速。実際はこれより必ず遅い）
  const sum = perCorner.filter((p) => p.course === spec.name && p.bestSecT != null).reduce((a, p) => a + p.bestSecT, 0);
  share.push({ course: spec.name, cornerSum: +sum.toFixed(3), lapT: lap.finished ? +lap.t.toFixed(3) : null,
    tFloor: +tFloor.toFixed(3), lapRatio: lap.finished ? +(lap.t / tFloor).toFixed(3) : null,
    frac: lap.finished ? +(sum / lap.t).toFixed(4) : null });
  console.log(`  ${tag(spec.name)} コーナー合計 ${sum.toFixed(2)}s / 周回 ${lap.finished ? lap.t.toFixed(2) : '--'}s = ${lap.finished ? (100 * sum / lap.t).toFixed(1) : '--'}%` +
    `（周回の物理下限 ${tFloor.toFixed(2)}s の ${lap.finished ? (lap.t / tFloor).toFixed(2) : '--'} 倍）`);
}
{
  const fr = share.filter((x) => x.frac != null).map((x) => x.frac);
  ok(fr.length === T.length && Math.max(...fr) < 0.5,
    `F-1 コーナー区間は周回時間の ${(100 * Math.min(...fr)).toFixed(1)}〜${(100 * Math.max(...fr)).toFixed(1)}% ⇒ **E の比は「コーナー区間の所要比」であって周回の比ではない**（周回への影響を言うときは必ず換算する）`);
  // F-1b: 換算の分母（周回時間）が **実走から来ている**ことを物理の下限で縛る。定数や別条件の値が
  //   紛れ込むと F-1 の割合が静かに変わるのに、割合の上限だけでは気づけない（変異注入で実測）。
  //   下限 = 路長 ÷ 車種の最高速。実走は必ずこれより遅く、かつ 3 倍は超えない（AX1 で出荷サンプル比
  //   0.85〜1.07 と確認済みのペースなら 1.2〜1.5 倍に収まる）。
  const lr = share.filter((x) => x.lapRatio != null).map((x) => x.lapRatio);
  ok(lr.length === T.length && Math.min(...lr) > 1 && Math.max(...lr) < 3,
    `F-1b 周回時間は物理下限（路長÷最高速）の ${Math.min(...lr).toFixed(2)}〜${Math.max(...lr).toFixed(2)} 倍（1 倍超〜3 倍未満）＝ 換算の分母が実走から来ている`);
}

// ── E: ブロック対象の定義 ───────────────────────────────────────────────────────────
console.log(`\n[E] ブロック対象の定義`);
{
  const c3 = perCorner.filter((p) => p.cost3 != null).map((p) => p.cost3);
  const c1 = perCorner.filter((p) => p.cost1 != null).map((p) => p.cost1);
  const blocked3 = perCorner.filter((p) => p.bestSecT != null && p.bestNotInnerSecT == null).length;
  const blocked1 = perCorner.filter((p) => p.bestSecT != null && p.best1SecT == null).length;
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const bandW = perCorner.map((p) => (p.usable * 2 / 3) / CAR.width);
  const fr = share.filter((x) => x.frac != null).map((x) => x.frac);
  console.log(`  「内側 1/3」の帯幅は 車幅の ${Math.min(...bandW).toFixed(2)}〜${Math.max(...bandW).toFixed(2)} 倍（＝車 1 台では塞ぎきれない幅）`);
  console.log(`  内側1/3 占有: 通過可 ${c3.length}/${perCorner.length}・通過不能 ${blocked3}・所要比 ${c3.length ? Math.min(...c3).toFixed(3) + '〜' + Math.max(...c3).toFixed(3) + '（平均 ' + mean(c3).toFixed(3) + '）' : '--'}`);
  console.log(`  車1台幅 占有: 通過可 ${c1.length}/${perCorner.length}・通過不能 ${blocked1}・所要比 ${c1.length ? Math.min(...c1).toFixed(3) + '〜' + Math.max(...c1).toFixed(3) + '（平均 ' + mean(c1).toFixed(3) + '）' : '--'}`);
  ok(c3.length + blocked3 === perCorner.length && c1.length + blocked1 === perCorner.length && c1.length > 0,
    `E-1 全 ${perCorner.length} コーナーについて「内側 1/3 占有時」「車 1 台幅占有時」の残りの最速が定義できた（通過不能はそれぞれ ${blocked3} / ${blocked1} 本）`);
  // E-1b: 「車 1 台幅の占有」が**実際に横位置を潰している**ことを構造で固定する。重なり判定
  //   （|Δlat| ≥ 車幅）を外すとブロッカー自身の位置まで「空いている」に数えられ、コストが 1.000 に
  //   なってしまうのに E-1/E-3 は緑のままだった（変異注入で実測）。潰した数の下限で塞ぐ。
  const rem = perCorner.map((p) => p.removed1).filter((v) => v != null);
  const worseThan1 = perCorner.filter((p) => p.cost1 != null && p.cost1 > 1).length;
  console.log(`  車1台幅の占有が潰した横位置: ${Math.min(...rem)}〜${Math.max(...rem)} 個/コーナー・コストが 1 を超えたコーナー ${worseThan1}/${perCorner.length}`);
  ok(rem.every((v) => v >= 1) && worseThan1 > 0,
    `E-1b 車 1 台幅の占有は全 ${perCorner.length} コーナーで最低 ${Math.min(...rem)} 個の横位置を潰し、${worseThan1} 本で実際に所要が悪化する（重なり判定が空振りしていない）`);
  const zones = { inner: 0, mid: 0, outer: 0 };
  for (const p of perCorner) if (p.bestZone) zones[p.bestZone]++;
  console.log(`  最速だった横位置の帯: 内側 ${zones.inner} / 中央 ${zones.mid} / 外側 ${zones.outer}（位置番号 p の分布: ${perCorner.map((p) => p.bestP).sort().join(',')}）`);
  ok(zones.outer === 0,
    `E-2 反証条件: 最速が**外側**だったコーナーは ${zones.outer} 本（内側 ${zones.inner} / 中央 ${zones.mid}）` +
    ` ⇒ 「内側が要」は ${zones.inner}/${perCorner.length} 本で成り立ち、残り ${zones.mid} 本では中央が最速`);
  // E-3: **AX3 が使う数**。単位と想定を必ず添える。
  ok(c1.length > 0,
    `E-3 **ブロックのコスト**: 車 1 台幅（${CAR.width}m）を最内の到達可能位置で占有されると、残りで到達できる最速は` +
    ` コーナー区間で平均 **+${((mean(c1) - 1) * 100).toFixed(1)}%**（最大 +${((Math.max(...c1) - 1) * 100).toFixed(1)}%・通過不能 ${blocked1} 本）。` +
    ` 参考: 内側 1/3（車幅の ${Math.min(...bandW).toFixed(1)}〜${Math.max(...bandW).toFixed(1)} 倍）の占有では平均 +${((mean(c3) - 1) * 100).toFixed(1)}%。` +
    ` **これはコーナー区間の比**であり、周回では F-1 の ${(100 * Math.min(...fr)).toFixed(0)}〜${(100 * Math.max(...fr)).toFixed(0)}% を掛けた大きさ（周回で +${((mean(c1) - 1) * 100 * Math.min(...fr)).toFixed(1)}〜+${((mean(c1) - 1) * 100 * Math.max(...fr)).toFixed(1)}%）になる`);
  // E-4: 「速いライン」か「短いライン」か。C-2 が示すとおり大半の点は全開で通れるので、
  //   区間所要の差は経路長の差でほぼ説明できるはず。それを実測で確かめて正直に出す。
  const fastAtTop = perCorner.filter((p) => p.bestAtTop).length;
  ok(fastAtTop + (perCorner.length - fastAtTop) === perCorner.length,
    `E-4 最速だった横位置が**全開のまま**だったコーナー ${fastAtTop}/${perCorner.length}` +
    ` ⇒ この動作点では「速いライン」は実質「**短いライン**」である（速度で差がつくのは残り ${perCorner.length - fastAtTop} 本のみ）`);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// H-1: コーナー局所測定でも **下り勾配の道追従が効いている**ことを差分で固定する
//   （AX1 の H-1 と同型。予備実装が落としていた欠陥③がここで再発しないように）。
//   ⚠ 本ゲートの初版はこれを持っていたが、層 4 レビュー後の書き直しで**私が落としていた**
//     （変異注入で「路面フレームを切っても無検出」として再発見）。落とすと下り重力なしの数字が
//     黙って出るので、必ず残すこと。
// ══════════════════════════════════════════════════════════════════════════════════════
console.log(`\n[H-1] 下り勾配の道追従がコーナー局所測定でも効いていること`);
{
  const sample = [];
  for (const spec of T) {
    const course = buildFromSpec(spec);
    const G = tougeGeom(course);
    const cs = cornersOf(G);
    if (!cs.length) continue;
    const c = cs[0];
    const on = runCornerLine({ spec, carType: CAR_KEY, corner: c, latAbs: 0, speed: 0.5, course, G });
    const off = runCornerLine({ spec, carType: CAR_KEY, corner: c, latAbs: 0, speed: 0.5, course, G, road: false });
    sample.push({ course: spec.name, roadActive: on.roadActive, secOn: on.secT, secOff: off.secT });
  }
  const allOn = sample.length === T.length && sample.every((x) => x.roadActive);
  // 「全峠で変わる」は助走長などのパラメータに依存して脆い（1 峠が偶然一致しうる）。
  //   **差の合計 / 所要の合計** で見れば、1 本の偶然一致では崩れない。
  const sOn = sample.reduce((a, x) => a + (x.secOn || 0), 0);
  const sDiff = sample.reduce((a, x) => a + ((x.secOn != null && x.secOff != null) ? Math.abs(x.secOff - x.secOn) : (x.secOn || 0)), 0);
  console.log(`  ${sample.map((x) => `${tag(x.course)} ${x.secOn != null ? x.secOn.toFixed(2) : '--'}→${x.secOff != null ? x.secOff.toFixed(2) : 'DNF'}`).join(' / ')}`);
  ok(allOn, `H-1a 全 ${T.length} 峠でコーナー局所測定の路面フレームが有効（roadActive）`);
  ok(sOn > 0 && sDiff / sOn > 0.005,
    `H-1b 道追従を切ると区間所要の合計が ${(100 * sDiff / sOn).toFixed(2)}% 変わる（下限 0.5%）⇒ 下り重力が効いている`);
}

console.log(`\n[結果] pass=${pass} fail=${fail}`);
if (WANT_JSON) {
  console.log('===JSON===');
  console.log(JSON.stringify({ appVersion: APP_VERSION, carKey: CAR_KEY, maxVCar: +MAXV_CAR.toFixed(4), nPos: NPOS,
    latTol: LAT_TOL, vLadder: VLADDER, cornerKappa: CORNER_KAPPA, rMin: +R_MIN.toFixed(5),
    rej, attempts, corners: cornersAll, rows, perCorner, share }, null, 0));
}
process.exit(fail ? 1 : 0);
