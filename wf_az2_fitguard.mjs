// Stage AZ2/AZ6 常設ゲート (利用者投稿コースで露見・CI-14「判定基準は代理量でなく実態」)。
//
// 守る不変条件: **フィットガードが落ち着いた先では、必ず実態収容 capN ≥ 1 である**
//   （= 車が壁の中に湧いたまま留まらない）。
//
// 背景（実測 2026-09-12・利用者投稿コース レーシングコース: 外形 18.36×18.71m・壁 366 本・
// スタート地点の廊下幅 0.300m）:
//   ・代理量 target = 0.25×外形最小辺 = 4.59m は 車長 3.80m を「収まる」と言う ⇒ enforceFitRatio ②
//     （fullscale→卓上の自動復帰）が発火しない。
//   ・④ は carScale を下限まで縮めるが、廊下 0.300m < 車幅 0.64m なので無駄。
//   ・⑤ は `while (capN > 1 && …)` と書かれていたため capN=0 を表現できず、**嘘の capN=1 を名乗る**。
//   ⇒ 6 台全部が壁の中に湧く（minClearance −133mm）。
//   しかも **より過大な carScale 2/4 は代理量が過大と判定するので ② が救う** ＝ 軽度の過大だけが壊れる、
//   という「代理量と実態の乖離」の典型的な署名だった。
//
// ══════════════════════════════════════════════════════════════════════════════
// **【AZ6・2026-09-13】本ゲートは product の判定コアを実行するようになった。**
//   AZ2 期の本ゲートは `enforceFitRatio` が DOM 結合で node から呼べないため、判定順序の**写し**を
//   動かしていた（∴ A)〜C) は product の main.js を 1 行も実行せず、写しが緑でも product が壊れて
//   いてよかった）。AZ6 で判定を `public/js/fitguard.js` の `settleFitRatio` へ分離したので、
//   **A)〜C) はライブ（main.js）が呼ぶのと同一の関数を呼ぶ**（CI-9「再実装しない」を判定にも適用）。
//   下の `settleLegacy` は **AZ6 改修前のロジックを凍結した比較基準**であって product の写しではない
//   （A) の「旧 → 新」の差分を出すためだけに存在し、B)/C)/G) では使わない）。
//   残る隙間: DOM そのものの挙動（スライダーの値域丸め等）と、適用側（ログ・スロット操作）は
//   node では回せない。そこは `browser/check_az2_fitguard.mjs`（実ブラウザ・本物の main.js）が見る。
// ══════════════════════════════════════════════════════════════════════════════
//
// 検査（本物のオラクルを使う・再実装しない = CI-9）:
//   A) 出荷コース × 3 領域 × 6 carScale の全格子で **凍結した旧ロジックと product の判定コアの
//      落ち着き先を突き合わせ**、変化したセルを全件列挙する。許すのは下の SIGNATURES に宣言した
//      変化だけ（救済／AZ6 の carScale 下限引き上げ／AZ6 の告知 1 本化）。宣言外は不合格。
//   B) 同じ全格子で、**新ロジックの落ち着き先の実態 capN ≥ 1**。
//   C) 「外形は広いが廊下が狭い」合成コースで、**旧は壊れ（capN=0 に落ち着く）・新は救済される**。
//      これが赤くならないなら欠陥を再現できていない＝この検査は何も守っていない（反証条件の固定）。
//      あわせて **AZ6 の ④' 復元**（旧は下限まで削るが新は入口の倍率を保つ）を固定する。
//   D) 構造検査: product 側に「1 台は必ず置ける」仮定が戻っていないこと・main.js が判定を持ち帰って
//      いないこと・carScale の下限が UI スライダーの min と一致していること。
//   E) 性能。F) D) 自身の変異試験。
//   G) **ライブ判定（利用者スケール）と 🏁 の判定（×1・AK2/D10）の食い違い**。出荷コースにも実在する
//      ので件数は情報として出し、**食い違うセルで 🏁 が必ず NO_ROOM で止まる**ことを本物の runRace で確認する。
//   H) 【BA1】判定コアの `fitsAllCars` メモが**判定をまたいで答えを持ち越さない**こと（振る舞い）。
//      メモの鍵と寿命の構文は D)、収容オラクルの出力そのものが改修前とビット単位で同じことは `wf_ba1_fitcore.mjs` が見る。
import fs from 'fs';
import { buildFromSpec, normalizeCourse } from './public/js/course.js';
import { fitsAllCars, capacityOf } from './public/js/fleet.js';
import { setCarScale, setRegimeScale, CAR, FLEET, REGIMES } from './public/js/config.js';
import { settleFitRatio, FIT } from './public/js/fitguard.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAM_BY_KEY } from './public/js/programs.js';

const specs = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
const kL = (r) => REGIMES[r].L / REGIMES.tabletop.L;
const REG = ['tabletop', 'midscale', 'fullscale'];
const SCALES = [0.4, 0.5, 0.8, 1, 2, 4];   // 0.4 はスライダー min=0.5 より下＝UI からは到達しないが、
                                           // 状態としては渡されうるので入力に残す（上げ直さないことの確認）。
const MAXN = FLEET.maxCars;
const PERF_BUDGET_MS = 50;   // UI が体感で止まらない目安（受け入れ基準）
const LEGACY_USERK_MIN = 0.4;   // AZ6 改修前の下限（凍結値。FIT.userKMin と食い違うのが AZ6 の是正点）

let pass = true;
const report = (label, arr, n = 10) => {
  console.log(`  ${arr.length === 0 ? '○' : '✗'} ${label}: ${arr.length} 件`);
  arr.slice(0, n).forEach(s => console.log(`       - ${s}`));
  if (arr.length > n) console.log(`       … 他 ${arr.length - n} 件`);
  if (arr.length) pass = false;
};

// ── オラクルのキャッシュ（本物を呼んだ結果を覚えるだけ。再実装はしない）──────────────
// **凍結した旧ロジック（settleLegacy）と、G) の ×1 判定でだけ使う。** product の判定コアは
// ゲート側のキャッシュを通さず `fleet.js` の本物を直接呼ぶ（＝ゲートが product の実コストをそのまま払う）。
// product 側は【BA1・2026-09-15】から **判定 1 回のあいだだけ** `fitsAllCars` の答えを覚える（判定をまたいでは
// 覚えない＝無効化の義務を作らない）。鍵と寿命の理由は `fitguard.js` の `fitsMemoFor` の注記、契約は D) が固定する。
const memo = new Map();
let oracleCalls = 0;                        // 凍結旧ロジックが払う「論理呼び出し」回数（E) の比較用）
const fitsM = (c, cid, n) => {
  oracleCalls++;
  const k = `f|${cid}|${CAR.length.toFixed(6)}|${n}`;
  if (memo.has(k)) return memo.get(k);
  const v = fitsAllCars(c, n);
  memo.set(k, v); return v;
};
const capM = (c, cid) => {
  const k = `c|${cid}|${CAR.length.toFixed(6)}`;
  if (memo.has(k)) return memo.get(k);
  const v = capacityOf(c, MAXN);            // 本物の共有オラクル（0 を返せる）
  memo.set(k, v); return v;
};
const capCost = (v) => (v >= 1 ? MAXN - v + 1 : MAXN);   // capacityOf 1 回が払う fitsAllCars 回数

// ── 凍結: AZ6 改修前の判定（比較基準。**product の写しではなく「当時の記録」**）──────────
// az2=false で AZ2 改修前、az2=true で AZ2 後 / AZ6 前。短絡評価の有無まで当時の product に合わせてある。
// **射程の限界（正直に書く）**: これは当時の product の *意図したロジック* であって、*実ブラウザでの
//   実挙動* ではない。当時の ③④ は `csEl.value` を毎回読み直しており、0.4 を書くと DOM が `min="0.5"` へ
//   丸めるため、実ブラウザでは再クランプが「実状態 0.4 なのに 0.5」を読んでいた（まさに AZ6 が直した
//   三重ズレ）。∴ A) の「旧」は DOM 丸めを含まない側の基準である。
// **⑥（driveableCapN・実走）は含めない。** 下の settleCore も slotCount=1 / reason='course' で呼ぶので
//   ⑥ は新旧どちらでも発火せず、比較は同条件になる（⑥ 自体は wf_az5_capzero.mjs と実ブラウザが見る）。
function settleLegacy(course, cid, regime0, userK0, az2) {
  const b = course.bounds, minDim = Math.min(b.w, b.h);
  const target = 0.25 * minDim;
  const noRace = course.noRace === true;
  let regime = regime0, userK = userK0;
  const logs = [];
  const apply = () => { setRegimeScale(kL(regime)); setCarScale(userK); };
  apply();

  if (noRace && minDim >= 50 && regime !== 'fullscale') { regime = 'fullscale'; logs.push('autoFullscale'); apply(); }   // ①
  if (!noRace && regime === 'fullscale' && CAR.length > target) { regime = 'tabletop'; logs.push('autoTabletop'); apply(); }   // ②

  const clampByProxy = () => {                                                                      // ③
    if (!(CAR.length > target) || !(userK > 0)) return;
    const lenAtUserK1 = CAR.length / userK;
    const newUserK = Math.max(LEGACY_USERK_MIN, Math.floor((target / lenAtUserK1) * 10) / 10);
    if (newUserK < userK) { userK = newUserK; apply(); logs.push('cs' + userK.toFixed(1)); }
  };
  const clampByFit = () => {                                                                        // ④
    if (!(userK > LEGACY_USERK_MIN + 1e-9)) return null;   // 呼んでいない以上「収まる」とは言えない（不明）
    if (!fitsM(course, cid, MAXN)) {
      while (userK > LEGACY_USERK_MIN + 1e-9 && !fitsM(course, cid, MAXN)) {
        userK = Math.max(LEGACY_USERK_MIN, Math.round((userK - 0.1) * 10) / 10);
        apply();
      }
      logs.push('cs' + userK.toFixed(1));
      return null;
    }
    return true;
  };
  clampByProxy();
  const fits6 = clampByFit();

  if (az2 && !noRace && regime !== 'tabletop' && fits6 !== true && !fitsM(course, cid, 1)) {        // ④'
    regime = 'tabletop'; logs.push('autoTabletopFit'); apply();
    clampByProxy();
    clampByFit();
  }

  let reported;                                                                                     // ⑤
  if (az2) {
    reported = capM(course, cid);
    oracleCalls += capCost(reported);   // product が capacityOf の中で払う実オラクル回数
    if (reported < 1) reported = 1;   // 0 台は表示できないので 1 に留める（product は同時に警告を出す）
  } else {
    reported = MAXN;
    while (reported > 1 && !fitsM(course, cid, reported)) reported--;
  }
  return { regime, userK, len: CAR.length, reported, logs, trueCap: capM(course, cid) };
}

// ── 新: **product の判定コアそのもの**を呼ぶ（写しを持たない・CI-9）────────────────────
// 効果フックは「記録する」だけ。ライブ（main.js）は同じ位置で DOM を書きイベントを発火する。
function settleCore(course, regime0, userK0, slotCount = 1, reason = 'course', cid = null) {
  const logs = [];
  let regime = regime0;
  const fx = {
    regime: (name, key) => { regime = name; logs.push(key.replace(/^log\./, '')); setRegimeScale(kL(name)); },
    scale: (uk) => setCarScale(uk),
    sync: () => {},   // スライダー/ラベル/スポーンの同期は DOM 側（実ブラウザゲートが見る）
    log: (key, p) => logs.push(key === 'log.autoCarScale' ? 'cs' + p.scale : key.replace(/^log\./, '')),
  };
  setRegimeScale(kL(regime0)); setCarScale(userK0);
  const r = settleFitRatio(course, { regime: regime0, userK: userK0, slotCount, reason }, fx);
  // 落ち着き先の**実態**（0 を返せる共有オラクル）。r.capN はゼロを 1 に留めた表示用の値なので、
  // ここは判定コアの戻り値から導かず **オラクルを独立に引き直す**（導くと B) が循環する）。
  // 引き直しはキャッシュ経由（同じ course × 同じ CAR 寸法なら同じ答え・本物を 1 回は必ず呼ぶ）。
  return { ...r, regime, logs, len: CAR.length, trueCap: cid == null ? capacityOf(course, MAXN) : capM(course, cid) };
}

// ── A) が許す変化の署名（宣言したものだけ許す。宣言外の変化は不合格）──────────────────
// 「全部同じ」を期待しない — 救うのが目的なので変化は出る。**変化の向きが宣言どおりであること**を条件にする。
const SIGNATURES = [
  {
    key: 'AZ2-救済',
    doc: '旧は実態 capN=0 に落ち着いていたセルが、④\' で卓上へ戻って capN≥1 になる',
    // **`trueCap` の 0→≥1 だけで判定しない**（層 4 レビュー 2026-09-13 の指摘）。それだと「別の理由で
    // たまたま 0 でなくなったセル」を無条件に飲み込む。救済であることの証拠＝**④' が実際に発火し
    // （告知 `autoTabletopFit` が出て）落ち着き先が卓上になっている**ことまで要求する。
    // なお出荷 66 コースでは ④' は 1 セルも発火しない（実測 2026-09-13・660 セル）ので本署名は 0 件で、
    // ④' の behavioral な証人は C) の治具と実ブラウザ ⑨ である。
    test: (o, n) => o.trueCap < 1 && n.trueCap >= 1
      && n.logs.includes('autoTabletopFit') && n.regime === 'tabletop',
  },
  {
    key: 'AZ6-下限',
    doc: 'carScale の下限を 0.4→0.5（スライダーの min）へ上げたことによる落ち着き先の差。'
       + '旧は DOM が表現できない 0.4 に留まり、スライダー位置 0.5 / ラベル 0.4× / 実状態 0.4 の三重ズレだった',
    test: (o, n) => o.regime === n.regime
      && Math.abs(o.userK - LEGACY_USERK_MIN) < 1e-9 && Math.abs(n.userK - FIT.userKMin) < 1e-9
      && n.trueCap >= 1,
  },
  {
    key: 'AZ6-告知1本化',
    doc: '落ち着き先は同一で、log.autoCarScale の途中経過が消え最終値 1 行だけになった',
    test: (o, n) => o.regime === n.regime && Math.abs(o.userK - n.userK) < 1e-9 && o.reported === n.capN
      && collapseScaleLogs(o.logs).join(',') === n.logs.join(','),
  },
];
// 旧の [.., cs1.2, cs1.0] のような carScale 告知の連鎖を「最後の 1 本」へ畳む（新の期待形）。
function collapseScaleLogs(logs) {
  const out = [];
  for (const l of logs) {
    if (l.startsWith('cs') && out.length && out[out.length - 1].startsWith('cs')) out[out.length - 1] = l;
    else out.push(l);
  }
  return out;
}

// ── 治具: 「外形は広いが廊下が狭い」コース（投稿コースの性質を最小構成で再現）───────────
// **閉じた**幅 0.30m の廊下であることが肝。初版は「広い箱の中に壁を 2 本」にしたため廊下の外に
// 空きが残り、freeSpawn がそこへ置けてしまって**欠陥を再現できなかった**（実測で判明し是正）。
// 走れる場所が廊下だけなら、外形 18×18m（代理量 target=4.50m）は「車長 3.80m は収まる」と言うのに
// 実際には 1 台も置けない = 投稿コース（外形 18.36×18.71m・廊下 0.300m）と同じ性質になる。
function narrowCorridorFixture() {
  const W = 18.0, H = 18.0, gap = 0.30, yc = 9.0, xa = 1.0, xb = 17.0;
  const walls = [
    { x1: xa, y1: yc - gap / 2, x2: xb, y2: yc - gap / 2 },
    { x1: xb, y1: yc - gap / 2, x2: xb, y2: yc + gap / 2 },
    { x1: xb, y1: yc + gap / 2, x2: xa, y2: yc + gap / 2 },
    { x1: xa, y1: yc + gap / 2, x2: xa, y2: yc - gap / 2 },
  ];
  return normalizeCourse({ name: 'AZ2 fixture: wide frame / closed narrow corridor', walls, bounds: { w: W, h: H }, start: { x: 2.0, y: yc, theta: 0 } });
}

console.log('Stage AZ2/AZ6 フィットガード・ゲート — 落ち着いた先で実態収容 capN ≥ 1 を守る');
console.log('='.repeat(78));

// ── A) / B) 出荷コースの全格子 ────────────────────────────────────────────────────
const badChange = [], capZero = [];
const sigCount = Object.fromEntries(SIGNATURES.map(s => [s.key, 0]));
const mismatch = [];   // G) ライブ判定と 🏁(×1) 判定の食い違い
let cells = 0, callsLegacy = 0;
const tGrid0 = Date.now();
for (let ci = 0; ci < specs.length; ci++) {
  let course; try { course = buildFromSpec(specs[ci]); } catch { continue; }
  for (const r of REG) for (const uk of SCALES) {
    cells++;
    oracleCalls = 0; const oldS = settleLegacy(course, ci, r, uk, true); callsLegacy += oracleCalls;
    const newS = settleCore(course, r, uk, 1, 'course', ci);
    const tag = `${specs[ci].name}|${r}|cs${uk}`;
    // G) 用: 落ち着き先で 🏁 の条件（×1・AK2/D10）に切り替えて実態収容を測り直す（同じパスで済ませる）。
    if (newS.trueCap >= 1) {
      setRegimeScale(kL(newS.regime)); setCarScale(1);
      if (capM(course, `race|${ci}`) < 1) mismatch.push({ tag, course, regime: newS.regime, userK: newS.userK, live: newS.trueCap });
    }
    const moved = oldS.regime !== newS.regime || Math.abs(oldS.userK - newS.userK) > 1e-9
      || oldS.reported !== newS.capN || oldS.logs.join(',') !== newS.logs.join(',');
    if (moved) {
      const sig = SIGNATURES.find(s => s.test(oldS, newS));
      const line = `${tag}: 旧 ${oldS.regime}/cs${oldS.userK}/capN${oldS.reported}(実${oldS.trueCap})[${oldS.logs.join(',')}]`
        + ` → 新 ${newS.regime}/cs${newS.userK}/capN${newS.capN}(実${newS.trueCap})[${newS.logs.join(',')}]`;
      if (sig) sigCount[sig.key]++; else badChange.push(line);
    }
    if (newS.trueCap < 1) capZero.push(`${tag}: 新でも実態 capN=0 (${newS.regime}/cs${newS.userK}/len${newS.len.toFixed(3)})`);
  }
}
const gridSec = (Date.now() - tGrid0) / 1000;
console.log(`\nA/B) 出荷 ${specs.length} コース × ${REG.length} 領域 × ${SCALES.length} carScale = ${cells} セル（${gridSec.toFixed(1)}s）`);
console.log('   ※ 新側は product の判定コア `fitguard.js:settleFitRatio` をそのまま実行している（写しではない）。');
report('A) 宣言外の挙動変化（既存の既定挙動を予期せず変えたセル）', badChange);
for (const s of SIGNATURES) console.log(`  ${sigCount[s.key] === 0 ? '○' : '◇'} 宣言済みの変化「${s.key}」: ${sigCount[s.key]} 件 — ${s.doc}`);
report('B) 新ロジックの落ち着き先で実態 capN=0 が残ったセル', capZero);

// ── C) 反証治具 ────────────────────────────────────────────────────────────────
const fx = narrowCorridorFixture();
const fxBroken = [], fxUnrescued = [], fxNoRestore = [];
let fxRescued = 0, fxRestoreReached = 0;   // **述語に到達した件数**（0 件 ○ が「空振り」か「本当に違反なし」かを分ける）
for (const r of REG) for (const uk of SCALES) {
  const oldS = settleLegacy(fx, 'fx', r, uk, false);
  const newS = settleCore(fx, r, uk);
  if (oldS.reported >= 1 && oldS.trueCap < 1) fxBroken.push(`${r}|cs${uk}: 旧は capN=${oldS.reported} と名乗るが実態 0（${oldS.regime}/cs${oldS.userK}）`);
  if (newS.trueCap < 1) fxUnrescued.push(`${r}|cs${uk}: 新でも実態 capN=0（${newS.regime}/cs${newS.userK}）`);
  // **AZ6: ④' の carScale 復元。** ④' で卓上へ戻したあと、入口の倍率で改めて測り直すこと
  // （旧は ③④ が先に下限まで削るので復元されず、同じコースで cs0.8→車長 0.076m / cs2→0.380m と
  //  5 倍の不連続が出ていた）。卓上で入口の倍率がそのまま収まるなら、それが落ち着き先でなければならない。
  if (newS.logs.includes('autoTabletopFit')) {
    fxRescued++;
    setRegimeScale(kL('tabletop')); setCarScale(uk);
    const fitsAtEntry = fitsAllCars(fx, MAXN);
    if (fitsAtEntry) fxRestoreReached++;
    if (fitsAtEntry && Math.abs(newS.userK - uk) > 1e-9) {
      fxNoRestore.push(`${r}|cs${uk}: ④' 後に卓上 cs${uk} で ${MAXN} 台収まるのに cs${newS.userK} まで削っている（復元されていない）`);
    }
  }
}
console.log(`\nC) 治具「外形 18×18m・廊下 0.30m」 ${REG.length * SCALES.length} セル`);
console.log(`  ${fxBroken.length > 0 ? '○' : '✗'} 旧ロジックが壊れることを再現: ${fxBroken.length} 件`);
fxBroken.slice(0, 6).forEach(s => console.log(`       - ${s}`));
if (fxBroken.length === 0) { console.log('       ✗ 欠陥を再現できていない＝この検査は何も守っていない'); pass = false; }
report('C) 新ロジックでも救済されなかったセル', fxUnrescued);
console.log(`  ○ ④' が発火したセル: ${fxRescued} 件／うち「卓上で入口倍率のまま ${MAXN} 台収まる」＝復元検査が実際に評価されたセル: ${fxRestoreReached} 件`);
if (fxRestoreReached === 0) { console.log("       ✗ 復元検査が 1 セルも評価されていない＝下の 0 件は空振り"); pass = false; }
report("C) ④' 後に carScale が復元されなかったセル（AZ6）", fxNoRestore);

// ── H) 【BA1】判定をまたいで fitsAllCars の答えを持ち越さない（振る舞い）────────────────────
// 同じ CAR 寸法で「6 台収まるコース」を判定した直後に「収まらないコース」を判定する。メモが判定をまたいで生きていれば
// 後者の ④ 入口が前者の「真」を拾って縮めずに素通りし、⑤ も maxCars を名乗る。持ち越しの鍵になりうるものごとに 3 場面:
//   ①別オブジェクト・別名（素朴なモジュール直下のメモ）
//   ②**同じオブジェクト**の壁・スタート・外形を差し替えて判定し直す（コースオブジェクトを鍵にしたメモ／WeakMap）
//   ③**同じ名前**の別オブジェクト（course.name を鍵にしたメモ。エディタで適用しても名前は残る）
// ※ 層 4 レビュー（2026-09-15）が、旧 H)（①だけ）と D) を ②③ の形の持ち越しが素通りすることを実証したので足した。
// **前提（収まる側は真・収まらない側は偽）を先に本物で確かめる**（崩れていたら、この検査は何も見ていない）。
{
  const hFail = [];
  const openGeom = () => ({ bounds: { w: 3, h: 3 }, start: { x: 1.5, y: 1.5, theta: 0 },
    walls: [{ x1: 0, y1: 0, x2: 3, y2: 0 }, { x1: 3, y1: 0, x2: 3, y2: 3 }, { x1: 3, y1: 3, x2: 0, y2: 3 }, { x1: 0, y1: 3, x2: 0, y2: 0 }] });
  // 収まらない側＝E) ⑤ と同じ「外形は広く、スタート地点だけ閉じた小部屋」（卓上 cs1 で静的に 3 台）。
  setRegimeScale(kL('tabletop')); setCarScale(1);
  const L = CAR.length, W = CAR.width;
  const pocketGeom = () => {
    const X = 1.7 * L, Y = 4 * W, W0 = 2.0, y0 = W0 / 2 - Y / 2, x0 = 0.2;
    return { bounds: { w: W0, h: W0 }, start: { x: x0 + X * 0.35, y: W0 / 2, theta: 0 },
      walls: [{ x1: x0, y1: y0, x2: x0 + X, y2: y0 }, { x1: x0 + X, y1: y0, x2: x0 + X, y2: y0 + Y },
              { x1: x0 + X, y1: y0 + Y, x2: x0, y2: y0 + Y }, { x1: x0, y1: y0 + Y, x2: x0, y2: y0 }] };
  };
  const mk = (name, g) => normalizeCourse({ name, ...g });
  {
    setRegimeScale(kL('tabletop')); setCarScale(1);
    const preOpen = fitsAllCars(mk('pre-open', openGeom()), MAXN), preTight = fitsAllCars(mk('pre-pocket', pocketGeom()), MAXN);
    if (!preOpen || preTight) hFail.push(`前提が崩れた（収まる側=${preOpen} は true・収まらない側=${preTight} は false であること）＝この検査は空振り`);
  }
  const judge = (label, c) => {
    const r = settleCore(c, 'tabletop', 1);
    setRegimeScale(kL(r.regime)); setCarScale(r.userK);
    const capFresh = capacityOf(c, MAXN), capShown = capFresh < 1 ? 1 : capFresh;
    if (r.capN !== capShown) hFail.push(`${label}: capN=${r.capN}（本物の capacityOf を引き直すと ${capFresh}）＝前の判定の答えを持ち越した`);
    if (!(r.userK < 1)) hFail.push(`${label}: ④ が縮めなかった（userK=${r.userK}。入口 cs1 では本物が偽）＝前の判定の「収まる」を拾った`);
    return `${r.regime}/cs${r.userK}/capN${r.capN}（本物 ${capFresh}）`;
  };
  // ① 別オブジェクト・別名
  settleCore(mk('BA1 H1 open', openGeom()), 'tabletop', 1);
  const s1 = judge('①別オブジェクト・別名', mk('BA1 H1 pocket', pocketGeom()));
  // ② 同じオブジェクトの中身を差し替える（コースオブジェクトを鍵にしたメモを捕まえる）
  const same = mk('BA1 H2 same object', openGeom());
  settleCore(same, 'tabletop', 1);
  Object.assign(same, pocketGeom());
  const s2 = judge('②同じオブジェクトの壁を差し替え', same);
  // ③ 同じ名前の別オブジェクト（course.name を鍵にしたメモを捕まえる）
  settleCore(mk('BA1 H3 same name', openGeom()), 'tabletop', 1);
  const s3 = judge('③同じ名前の別コース', mk('BA1 H3 same name', pocketGeom()));
  console.log(`\nH) 判定をまたいだ持ち越し（BA1）: ① ${s1} ／ ② ${s2} ／ ③ ${s3}`);
  report('H) 判定をまたいで答えを持ち越した場面', hFail);
}

// ── D) 構造検査 ────────────────────────────────────────────────────────────────
// **コメントを剥がしてから照合する。** 剥がさないと「注記に文字列が残っているだけ」で真になり、
// 実装を消す変異（例: capZeroWarn の出し分け削除）を見逃す（層 4 レビュー 2026-09-12 の実測指摘）。
// 素朴な除去なので、行内に `://` を含む行（URL）は保守的に丸ごと残す＝誤って消さない側へ倒す。
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => (/:\/\//.test(l) ? l : l.replace(/\/\/.*$/, ''))).join('\n');
// 関数本体を切り出して、その中だけを見る（別の場所の同名文字列に釣られないため）。
const bodyOf = (src, header) => {
  const i = src.indexOf(header); if (i < 0) return '';
  const j = src.indexOf('\n}', i); return j < 0 ? src.slice(i) : src.slice(i, j + 2);
};

// 構造条件。**F) がこの関数に変異ソースを食わせて「ちゃんと赤くなるか」を検査する**ので、
// 判定はここ 1 箇所にまとめる（検査の二重実装を作らない）。
function checkStructural(mainRaw, fleetRaw, guardRaw, htmlRaw) {
  const mainSrc = strip(mainRaw), fleetSrc = strip(fleetRaw), guardSrc = strip(guardRaw);
  const capBody = bodyOf(fleetSrc, 'export function capacityOf');
  const v = [];
  // ── strip() の自己検査（**検査が黙って何も見なくなる**のを防ぐ）────────────────────
  //   実害の記録（2026-09-13）: fitguard.js の**行コメントの中に** `public/js/*.js` と書いたところ、
  //   `/\*` がブロックコメントの開始と解釈され、次の `*/`（後続の JSDoc の終わり）までが丸ごと
  //   空白に置換されて **`FIT.userKMin` の定義ごと消えた**。下の肯定形チェックが赤くなったので
  //   気づけたが、否定形チェック（「〜が無いこと」）だけなら**全部素通りして緑**になっていた。
  //   ∴ 各ファイルに「必ず残っているはずの印」を置き、消えたら原因を名指しで赤くする。
  for (const [src, canary, who] of [
    [guardSrc, 'export function settleScale', 'fitguard.js'],
    [guardSrc, 'export function settleFitRatio', 'fitguard.js'],
    [mainSrc, 'function enforceFitRatio(reason)', 'main.js'],
    [fleetSrc, 'export function capacityOf', 'fleet.js'],
  ]) if (!src.includes(canary)) v.push(`strip() が ${who} のソースを食べた（\`${canary}\` が消えた）。行コメント中の \`/\` + \`*\` が原因の可能性が高い`);
  // --- 共有オラクル capacityOf が「0 を返せる」こと ---
  if (!capBody) v.push('fleet.js に capacityOf の定義が無い（共有オラクルが消えた）');
  if (!/while\s*\(\s*n\s*>=\s*1\s*&&\s*!fitsAllCars\(\s*course\s*,\s*n\s*\)\s*\)\s*n--;/.test(capBody))
    v.push('capacityOf が 0 まで下げる走査（while (n >= 1 && !fitsAllCars(course, n)) n--;）を持っていない');
  if (!/\breturn n;/.test(capBody))
    v.push('capacityOf が n をそのまま返していない（戻り値に丸めが入ると「1 台は必ず置ける」の嘘が戻る）');
  if (/Math\.max\s*\(\s*1\s*,/.test(capBody))
    v.push('capacityOf の中で 1 に丸めている（capN=0 を表現できなくなる）');

  // --- 【AZ6】main.js は「適用」だけ。判定を持ち帰っていないこと ---
  //   分離の価値は「ライブとゲートが同じ判定を実行する」ことにあり、main.js に判定が戻ると
  //   本ゲートの A)〜C) が再び product を実行しない状態に静かに戻る。
  if (!/import \{ settleFitRatio \} from '\.\/fitguard\.js';/.test(mainSrc))
    v.push('main.js が判定コア settleFitRatio を import していない');
  const efr = bodyOf(mainSrc, 'function enforceFitRatio(reason)');
  if (!efr) v.push('main.js に enforceFitRatio の定義が無い');
  if (!/const r = settleFitRatio\(course, \{/.test(efr))
    v.push('main.js の enforceFitRatio が判定コアを呼んでいない');
  // （収容オラクル 3 種は下で **file スコープ**で禁止する＝ヘルパ関数へ逃がす抜け道を塞ぐ）
  if (/0\.25\s*\*/.test(efr)) v.push('main.js の enforceFitRatio が代理量 0.25×minDim を再計算している（判定を持ち帰っている）');

  // --- 【AZ6】▶ の経路でガードの告知を消していないこと ---
  //   旧 startAuto は enforceFitRatio('race') のあとに clearLog() を呼んでおり、**ガードが出した
  //   警告をその場で消していた**（🏁 は clearLog を呼ばないので届く＝同じ告知が経路で見え隠れした）。
  {
    const sa = bodyOf(mainSrc, 'function startAuto()');
    if (!sa) v.push('main.js に startAuto の定義が無い');
    else {
      // **「最初の 1 個」で測らない**（前にも後ろにも置けば iClear < iGuard が成立してしまう。
      //   層 4 レビュー 2026-09-13 が H2 として実証）。個数と位置の両方を固定する。
      const nClear = (sa.match(/clearLog\(\);/g) || []).length;
      const iClear = sa.indexOf('clearLog();'), iGuard = sa.indexOf("enforceFitRatio('race')");
      if (nClear === 0) v.push('main.js startAuto に clearLog() が無い');
      else if (nClear > 1) v.push(`main.js startAuto に clearLog() が ${nClear} 個ある（1 個でないと「ガードの後で消す」経路を作れてしまう）`);
      else if (iGuard < 0) v.push("main.js startAuto に enforceFitRatio('race') が無い（発走直前の確定が消えた）");
      else if (iClear > iGuard) v.push('main.js startAuto が clearLog() をフィットガードの後に呼んでいる（▶ の経路でガードの告知が消える）');
    }
  }

  // ══ 【AZ6・2026-09-13 追補】層 4 レビューが「D) は 9 件の変異のうち 8 件を見逃す」と実測した。
  //    見逃しの根因は 3 つ ①単一真実源を**否定形（0.4 リテラルの不在）でしか**見ていない
  //    ②「main.js は適用だけ」を `enforceFitRatio` の**本体内でしか**見ていない（1 行のヘルパを挟めば素通り）
  //    ③`clearLog` の位置を**最初の 1 個でしか**見ていない（後ろにもう 1 個足せば素通り）。
  //    以下はその 3 つを肯定形・全数で固定する。F) に対応する変異を常設した。
  // --- 単一真実源: ③④ が **FIT.userKMin を参照している**こと（リテラルで書き直されていない）---
  //   値が同じでも（0.5 と書いても）真実源が割れた瞬間にスライダーとの一致検査が意味を失う。
  if (!/Math\.max\(FIT\.userKMin, Math\.floor\(maxUserK \* 10\) \/ 10\)/.test(guardSrc))
    v.push('fitguard.js ③ の下限が FIT.userKMin を参照していない（単一真実源が割れた）');
  if (!/applyUserK\(Math\.max\(FIT\.userKMin, step10\(userK - FIT\.step\)\)\);/.test(guardSrc))
    v.push('fitguard.js ④ の下限/刻みが FIT.userKMin / FIT.step を参照していない（単一真実源が割れた）');
  if (/Math\.max\(\s*0\.[0-9]/.test(guardSrc))
    v.push('fitguard.js に carScale 下限の数値リテラルが書かれている（FIT.userKMin を単一真実源にすること）');
  // --- main.js が収容オラクルを **file スコープで** 持っていないこと（ヘルパ経由の持ち帰りを塞ぐ）---
  for (const [re, what] of [
    [/\bfitsAllCars\s*\(/, 'fitsAllCars'], [/\bcapacityOf\s*\(/, 'capacityOf'], [/\bdriveableCapN\s*\(/, 'driveableCapN'],
  ]) if (re.test(mainSrc)) v.push(`main.js が収容オラクル ${what} を直接呼んでいる（判定は fitguard.js に置く。ヘルパ関数へ逃がすのも不可）`);
  // --- 適用側 fx が DOM・ラベル・塗り・スポーンを**そろって**更新すること ---
  //   ここを 1 つでも落とすと「状態は動いたのに見た目が古い」＝AZ6 が直した三重ズレが別の形で戻る。
  {
    const syncBody = /sync: \(k, userK\) => \{([\s\S]{0,900}?)\n      \},/.exec(mainSrc);
    if (!syncBody) v.push('main.js の fx.sync が見つからない／形が変わった');
    else {
      const b = syncBody[1];
      if (!/csEl\.value = String\(userK\)/.test(b)) v.push('fx.sync がスライダーの value を書き戻していない（DOM と状態がズレる）');
      if (!/paintRange\(csEl\)/.test(b)) v.push('fx.sync がスライダーの塗りつぶしを更新していない（サムは動くのに背景が元位置に残る）');
      if (!/carScalev[\s\S]{0,80}toFixed\(1\) \+ '×'/.test(b)) v.push('fx.sync が表示ラベルを更新していない');
      if (!/if \(!running\) rebuildSpawns\(slots, course\);/.test(b)) v.push('fx.sync がスポーンを再生成していない（縮めた車が古い位置のまま描かれる）');
    }
    if (!/scale: \(userK\) => setCarScale\(userK\),/.test(mainSrc)) v.push('main.js の fx.scale が setCarScale を呼んでいない');
    if (!/sel\.dispatchEvent\(new Event\('change'/.test(mainSrc)) v.push('main.js の fx.regime が change を発火していない（物理差替等が走らない）');
  }
  // --- 判定結果をスロット側の上限へ反映していること ---
  if (!/courseCapN = capN;/.test(mainSrc))
    v.push('main.js が courseCapN へ capN を反映していない（車両追加の上限が実態から外れる）');
  // --- ② 代理量による卓上復帰が生きていること（A) が拾うが、構造でも固定する）---
  if (!/if \(!noRace && regime === 'fullscale' && CAR\.length > target\) \{/.test(guardSrc))
    v.push('fitguard.js ② の条件式が無い／変わった（フルスケールから戻らなくなる）');
  // --- 判定不能な入力で黙って縮めないこと ---
  if (!/if \(!\(minDim > 0\)\) return \{ regime, userK \};/.test(guardSrc))
    v.push('fitguard.js が判定不能な入力（minDim<=0）を素通ししている（target=0 で必ず下限まで縮めて告知する）');

  // --- 【AZ6】carScale の下限が UI スライダーの min と一致していること ---
  const slider = /<input id="carScale"[^>]*min="([0-9.]+)"/.exec(htmlRaw);
  if (!slider) v.push('index.html に carScale スライダー（min 属性つき）が見つからない');
  const fitMin = /userKMin:\s*([0-9.]+)/.exec(guardSrc);
  if (!fitMin) v.push('fitguard.js の FIT.userKMin が読めない');
  if (slider && fitMin && Math.abs(Number(slider[1]) - Number(fitMin[1])) > 1e-9)
    v.push(`carScale の下限が食い違う: スライダー min=${slider[1]} / FIT.userKMin=${fitMin[1]}（DOM・状態・ラベルが三重にズレる）`);
  if (/Math\.max\(0\.4,/.test(guardSrc))
    v.push('fitguard.js に下限 0.4 のハードコードが残っている（FIT.userKMin を単一真実源にすること）');

  // --- fitguard.js ⑤: 実態で測り、0 を握りつぶさない ---
  if (!/let capN = fits\.known\(FLEET\.maxCars\) === true \? FLEET\.maxCars : capacityOf\(course, FLEET\.maxCars\);/.test(guardSrc))
    v.push('fitguard.js ⑤ が capacityOf(course, FLEET.maxCars) を使っていない／近道の条件が「④ が真と確かめた」以外に広がった（未評価で maxCars を名乗る）');
  if (/while\s*\(\s*capN\s*>\s*1\s*&&\s*!fitsAllCars/.test(guardSrc))
    v.push('fitguard.js ⑤ に旧実装 `while (capN > 1 && !fitsAllCars…)` が復活している');
  if (!/let capZeroStatic = capN < 1;/.test(guardSrc))
    v.push('fitguard.js ⑤ が静的 capN=0 を判定していない（capZeroStatic が無い）');
  if (!/const capZero = capZeroStatic \|\| capZeroDrive;/.test(guardSrc))
    v.push('fitguard.js ⑤ が 2 種類のゼロを束ねていない（capZero が無い）');
  if (!/if \(capZero\) capN = 1;/.test(guardSrc))
    v.push('fitguard.js ⑤ の capN=0 → 1 の丸めが無い／形が変わった');
  if (!/const zeroKey = capZeroDrive \? 'log\.capZeroDriveWarn' : 'log\.capZeroWarn';/.test(guardSrc))
    v.push('fitguard.js ⑤ がゼロの理由（静的／実走）で文言を出し分けていない');
  // --- main.js 適用側: 0 のときに「最大 n 台なら走り出せる」と言わない・黙らない ---
  if (!/t\(r\.capZero \? r\.zeroKey : 'log\.capReduced'/.test(mainSrc))
    v.push('main.js が capN=0 のときに capReduced（「最大 n 台なら走り出せる」）を出し分けていない＝矛盾する 2 行が出る');
  if (!/\} else if \(r\.capZero\) \{[\s\S]{0,400}?logLine\(t\(r\.zeroKeyOnly, \{ name: course\.name \}\)\);/.test(mainSrc))
    v.push('main.js で「減らす台数が無い」経路の capN=0 告知が無い／専用文言 (zeroKeyOnly) を使っていない（無言になるか、していない台数変更を告げる）');
  // 【AZ6】減らしていない経路へ「{was} 台から {n} 台にします」と言う文言を流さないこと。
  if (!/const zeroKeyOnly = capZeroDrive \? 'log\.capZeroDriveWarnOnly' : 'log\.capZeroWarnOnly';/.test(guardSrc))
    v.push('fitguard.js が「減らす台数が無い」経路の専用文言 (zeroKeyOnly) を決めていない');

  // --- 【AZ5/AZ6】⑥ 実走ゼロ: 多台の分岐と、既定 1 台の分岐（発走直前）の両方があること ---
  if (!/if \(!capZeroStatic && regNow === 'tabletop' && ctx\.reason !== 'carScale' && capN > 1 && ctx\.slotCount > 1\) \{/.test(guardSrc))
    v.push('fitguard.js ⑥ の多台分岐（driveableCapN で実態容量へ絞る）が無い／条件が変わった');
  if (!/\} else if \(!capZeroStatic && regNow === 'tabletop' && ctx\.reason === 'race' && capN >= 1\) \{/.test(guardSrc))
    v.push('fitguard.js ⑥ の 1 台分岐（発走直前に実走ゼロを告知）が無い／条件が変わった＝既定編成が再び無言になる');
  if (!/if \(driveableCapN\(course, regNow, 1\) < 1\) capZeroDrive = true;/.test(guardSrc))
    v.push('fitguard.js ⑥ の 1 台分岐が driveableCapN を呼んでいない（告知の根拠が無い）');

  // --- fitguard.js ④': 実態による救済が丸ごと残っていること＋AZ6 の carScale 復元 ---
  const az4p = /if \(!noRace && regime !== 'tabletop' && fits6 !== true && !fits\(1\)\) \{([\s\S]{0,900}?)\n  \}/.exec(guardSrc);
  if (!az4p) v.push("fitguard.js ④' の条件式が無い／変わった（!noRace && 卓上以外 && fits6!==true && !fits(1)）");
  else {
    const b = az4p[1];
    if (!/regime = 'tabletop';/.test(b)) v.push("④' の救済本体（領域を卓上へ戻す）が無い");
    if (!/log\.autoTabletopFit/.test(b)) v.push("④' が黙って領域を変えている（告知が無い）");
    if (!/if \(userK !== userK0\) applyUserK\(userK0\);/.test(b)) v.push("④' が carScale を入口の倍率へ復元していない（AZ6・② 経路と挙動がそろわない）");
    if (!/clampByProxy\(\);[\s\S]{0,80}clampByFit\(\);/.test(b)) v.push("④' 後の再クランプ（clampByProxy→clampByFit）が無い");
  }
  // --- fitguard.js ④: 確かめていないことを true と言わない契約 ---
  if (!/if \(!\(userK > FIT\.userKMin \+ 1e-9\)\) return null;/.test(guardSrc))
    v.push('fitguard.js ④ が「評価していないのに true」を返しうる形に戻っている（下限での早期 return null が無い）');
  if (!/const fits6 = clampByFit\(\);/.test(guardSrc))
    v.push("fitguard.js が ④ の戻り値を受けていない（④' の短絡が壊れる）");
  // --- 【AZ6】carScale の告知は 1 回だけ（途中経過を流さない・④' の復元と矛盾させない）---
  if (!/if \(scaleK !== null && userK !== userK0\) \{[\s\S]{0,200}?fx\.log\('log\.autoCarScale'/.test(guardSrc))
    v.push('fitguard.js の carScale 告知が「入口から実際に縮んだときに 1 回」の形になっていない');

  // --- 【BA1・2026-09-15】判定 1 回ぶんの fitsAllCars メモの契約 ---
  //   ①鍵に「答えを決める入力」が全部入っている（台数・CAR 寸法 3 値・PHYSICS.mode）
  //   ②メモは判定 1 回の中で作る（モジュールの外側に置くと判定をまたいで古い答えを返す）
  //   ③④ と ④' と ⑤ が同じメモを通る（通らない呼び出しが残ると重複が戻る／別の答えを持つ）
  //   ※ 鍵の入力の網羅は B) の全格子（本物との突合）でも間接に見ているが、寸法 3 値は同じ倍率で一緒に動くので
  //     1 つ抜けても出荷格子では答えが変わらない＝**振る舞いでは捕まらない**。ここで構文として固定する。
  {
    const memoFn = bodyOf(guardSrc, 'function fitsMemoFor(course)');
    //   【層 4 レビュー 2026-09-15 の反例を受けて強化】旧版は「関数の中に new Map(); の文字列がある」「直下に
    //   `new Map();` が無い」だけを見ており、**モジュール直下の WeakMap でコースごとにメモを返す形**や、**括弧なしの
    //   `new Map` に course.name で持ち越す形**、**偽の答えを覚えない形（入口の二重評価が戻る）**を全部素通りした。
    //   ∴ ①本体を行ごとに固定 ②モジュール直下に置いてよい宣言を列挙して固定する（キャッシュの置き場所をそもそも作れない）。
    const MEMO_LINES = [
      'function fitsMemoFor(course) {',
      'const memo = new Map();',
      'const keyOf = (n) => `${n}|${CAR.length}|${CAR.width}|${CAR.rearToBack}|${PHYSICS.mode}`;',
      'const fits = (n) => {',
      'const k = keyOf(n);',
      'let v = memo.get(k);',
      'if (v === undefined) { v = fitsAllCars(course, n); memo.set(k, v); }',
      'return v;',
      '};',
      'fits.known = (n) => memo.get(keyOf(n));',
      'return fits;',
      '}',
    ];
    if (!memoFn) v.push('fitguard.js に fitsMemoFor（判定 1 回ぶんのメモ）が無い');
    else {
      const got = memoFn.split('\n').map(l => l.trim()).filter(Boolean);
      if (got.join('\n') !== MEMO_LINES.join('\n')) {
        const i = MEMO_LINES.findIndex((l, k) => got[k] !== l);
        v.push(`fitsMemoFor の本体が凍結した形と違う（${i + 1} 行目: 期待「${MEMO_LINES[i]}」／実際「${got[i] ?? '(無し)'}」）＝鍵の漏れ・判定をまたぐ持ち越し・偽を覚えない重複評価のいずれかが入りうる`);
      }
    }
    {
      // モジュール直下（行頭が空白でも閉じ括弧でもない行）に置いてよいのはこれだけ。
      const TOP = [/^import \{ [\w, ]+ \} from '\.\/(config|fleet|capacity)\.js';$/, /^export const FIT = \{$/,
        /^const step10 = \(v\) => Math\.round\(v \* 10\) \/ 10;$/, /^function fitsMemoFor\(course\) \{$/,
        /^export function settleScale\(course, ctx, fx, fits = fitsMemoFor\(course\)\) \{$/, /^export function settleFitRatio\(course, ctx, fx\) \{$/];
      for (const line of guardSrc.split('\n')) {
        if (!/^[^\s}]/.test(line)) continue;
        if (!TOP.some(re => re.test(line.trimEnd()))) v.push(`fitguard.js のモジュール直下に想定外の宣言「${line.trim().slice(0, 80)}」（判定をまたぐキャッシュ等を置かない方針・BA1）`);
      }
    }
    if (!/export function settleScale\(course, ctx, fx, fits = fitsMemoFor\(course\)\) \{/.test(guardSrc)) v.push('settleScale がメモを受け取らない／既定で新しいメモを作っていない');
    const sfr = bodyOf(guardSrc, 'export function settleFitRatio');
    if (!/const fits = fitsMemoFor\(course\);[\s\S]{0,200}?settleScale\(course, ctx, fx, fits\);/.test(sfr)) v.push('settleFitRatio が ④④\' と ⑤ で同じメモを共有していない');
    if (/fitsAllCars\(/.test(bodyOf(guardSrc, 'export function settleScale'))) v.push('settleScale がメモを通さずに fitsAllCars を直接呼んでいる（重複評価が戻る）');
    if (/fitsAllCars\(/.test(sfr)) v.push('settleFitRatio がメモを通さずに fitsAllCars を直接呼んでいる');
  }
  return v;
}

const mainRaw = fs.readFileSync('./public/js/main.js', 'utf8');
const fleetRaw = fs.readFileSync('./public/js/fleet.js', 'utf8');
const guardRaw = fs.readFileSync('./public/js/fitguard.js', 'utf8');
const htmlRaw = fs.readFileSync('./public/index.html', 'utf8');
const structural = checkStructural(mainRaw, fleetRaw, guardRaw, htmlRaw);
console.log('\nD) product 側の構造検査（コメントを剥がして照合）');
console.log('   ※ これは正規表現による構造検査で、**呼ばれる関数の中身の意味変更や、テキストを保った');
console.log('     並べ替えは検出できない**。判定の中身は A)〜C) が product の判定コアを実行して見ており、');
console.log('     適用側（DOM・ログ・スロット）は browser/check_az2_fitguard.mjs（実ブラウザ）が見る。');
report('D) 構造条件の違反', structural);

// ── F) D) 自身の変異試験（検査が検査になっているか）────────────────────────────────
// 層 4 レビュー（2026-09-12）が、初版の D) は 10 件の変異のうち **9 件を見逃す**と実測した。
// 「守っている行を 1 つずつ壊して赤くなることを確認してから緑と言う」を常設化する。
// **product のファイルは読むだけ**（変異はメモリ上の複製に入れる）。
const M = (f) => ({ main: f.main || ((s) => s), fleet: f.fleet || ((s) => s), guard: f.guard || ((s) => s), html: f.html || ((s) => s) });
const MUTATIONS = [
  ["④' を noRace 専用に反転", M({ guard: g => g.replace("if (!noRace && regime !== 'tabletop' && fits6 !== true", "if (noRace && regime !== 'tabletop' && fits6 !== true") })],
  ["④' を midscale で無効化", M({ guard: g => g.replace("regime !== 'tabletop' && fits6 !== true", "regime === 'fullscale' && fits6 !== true") })],
  ["④' を false && で殺す", M({ guard: g => g.replace("if (!noRace && regime !== 'tabletop'", "if (false && !noRace && regime !== 'tabletop'") })],
  ["④' の救済本体（卓上へ戻す）を削除", M({ guard: g => g.replace("    regime = 'tabletop';\n    fx.regime('tabletop', 'log.autoTabletopFit'", "    fx.regime('tabletop', 'log.autoTabletopFit'") })],
  ["④' 後の再クランプを削除", M({ guard: g => g.replace("    clampByProxy();\n    clampByFit();\n  }", "  }") })],
  ["④' の carScale 復元を削除（AZ6）", M({ guard: g => g.replace("    if (userK !== userK0) applyUserK(userK0);\n", "") })],
  ['④ が下限でも true を返す', M({ guard: g => g.replace('if (!(userK > FIT.userKMin + 1e-9)) return null;', 'if (!(userK > FIT.userKMin + 1e-9)) return true;') })],
  ['carScale の下限をスライダーの min から外す（AZ6）', M({ guard: g => g.replace('userKMin: 0.5,', 'userKMin: 0.4,') })],
  ['carScale の下限を 0.4 でハードコードし直す（AZ6）', M({ guard: g => g.replace('Math.max(FIT.userKMin, Math.floor(maxUserK * 10) / 10)', 'Math.max(0.4, Math.floor(maxUserK * 10) / 10)') })],
  ['carScale 告知を 1 本化する条件を殺す（途中経過が流れる形へ戻す）', M({ guard: g => g.replace("if (scaleK !== null && userK !== userK0) {", "if (false) {") })],
  ['⑤ の capZeroWarn 出し分けを削除（矛盾する 2 行に戻す）', M({ main: m => m.replace("t(r.capZero ? r.zeroKey : 'log.capReduced'", "t('log.capReduced'") })],
  ['⑤ の静的 capN<1 判定を殺す', M({ guard: g => g.replace('let capZeroStatic = capN < 1;', 'let capZeroStatic = false;') })],
  ['⑤ の 2 種類のゼロの束ねを静的だけに戻す（AZ5 の実走ゼロを握りつぶす）', M({ guard: g => g.replace('const capZero = capZeroStatic || capZeroDrive;', 'const capZero = capZeroStatic;') })],
  ['⑤ のゼロ理由の出し分けを潰す（実走ゼロに静的の文言を当てる）', M({ guard: g => g.replace("const zeroKey = capZeroDrive ? 'log.capZeroDriveWarn' : 'log.capZeroWarn';", "const zeroKey = 'log.capZeroWarn';") })],
  ['⑤ の「減らす台数が無い」経路の告知を殺す', M({ main: m => m.replace('logLine(t(r.zeroKeyOnly, { name: course.name }));', '') })],
  ['⑤ の「減らす台数が無い」経路に減らした側の文言を流す（していない台数変更を告げる・AZ6）', M({ main: m => m.replace('logLine(t(r.zeroKeyOnly, { name: course.name }));', 'logLine(t(r.zeroKey, { name: course.name, n: capN, was: slots.length }));') })],
  ['zeroKeyOnly の出し分けを潰す（実走ゼロに静的の文言を当てる・AZ6）', M({ guard: g => g.replace("const zeroKeyOnly = capZeroDrive ? 'log.capZeroDriveWarnOnly' : 'log.capZeroWarnOnly';", "const zeroKeyOnly = 'log.capZeroWarnOnly';") })],
  ['⑥ の 1 台分岐を殺す（既定編成が再び無言になる・AZ6）', M({ guard: g => g.replace("} else if (!capZeroStatic && regNow === 'tabletop' && ctx.reason === 'race' && capN >= 1) {", "} else if (false) {") })],
  ['⑥ の 1 台分岐を slotCount<=1 へ狭める（capN=1 × 多台編成の兄弟穴を再注入・AZ6）', M({ guard: g => g.replace("ctx.reason === 'race' && capN >= 1) {", "ctx.reason === 'race' && ctx.slotCount <= 1 && capN >= 1) {") })],
  ['⑥ の 1 台分岐から実走プローブを抜く（根拠の無い告知にする・AZ6）', M({ guard: g => g.replace('if (driveableCapN(course, regNow, 1) < 1) capZeroDrive = true;', 'if (false) capZeroDrive = true;') })],
  ['⑥ の多台分岐の囲みを殺す', M({ guard: g => g.replace("ctx.reason !== 'carScale' && capN > 1 && ctx.slotCount > 1", "ctx.reason !== 'carScale' && capN > 1 && ctx.slotCount > 9") })],
  ['main.js が判定を持ち帰る（capacityOf を直接呼ぶ・AZ6）', M({ main: m => m.replace('    const capN = r.capN;', '    const capN = capacityOf(course, FLEET.maxCars);') })],
  ['main.js が判定コアを呼ばなくなる（AZ6）', M({ main: m => m.replace("import { settleFitRatio } from './fitguard.js';", "// removed") })],
  ['capacityOf の走査を n>=2 にする', M({ fleet: f => f.replace('while (n >= 1 && !fitsAllCars(course, n)) n--;', 'while (n >= 2 && !fitsAllCars(course, n)) n--;') })],
  ['capacityOf の戻り値を 1 に丸める（「1 台は必ず置ける」の嘘を再注入）', M({ fleet: f => f.replace('  return n;   //', '  return Math.max(1, n);   //') })],
  ['スライダーの min を 0.5 から動かす（AZ6・三重ズレの再注入）', M({ html: h => h.replace('<input id="carScale" type="range" min="0.5"', '<input id="carScale" type="range" min="0.6"') })],
  ['▶ の経路で clearLog をガードの後へ戻す（告知が消える・AZ6）', M({ main: m => m.replace("  clearLog();\n  enforceFitRatio('race');", "  enforceFitRatio('race');\n  clearLog();") })],
  // ▼ 層 4 レビュー（2026-09-13）が「D) が見逃す」と実測した 8 件。指摘を受けて D) を強化したので、
  //    毎回「ちゃんと赤くなる」ことを機械確認する（H 番号はレビューの harness に対応）。
  ['H1 ③ の下限を FIT.userKMin からリテラル 0.5 へ（値は同じ・単一真実源が割れる）', M({ guard: g => g.replace('Math.max(FIT.userKMin, Math.floor(maxUserK * 10) / 10)', 'Math.max(0.5, Math.floor(maxUserK * 10) / 10)') })],
  ['H1b ④ の下限を FIT.userKMin からリテラル 0.5 へ', M({ guard: g => g.replace('applyUserK(Math.max(FIT.userKMin, step10(userK - FIT.step)));', 'applyUserK(Math.max(0.5, step10(userK - FIT.step)));') })],
  ['H2 startAuto にガードの後ろで 2 個目の clearLog を足す（告知が消える）', M({ main: m => m.replace("  rebuildSpawns(slots, course);\n  let ok = 0;", "  rebuildSpawns(slots, course);\n  clearLog();\n  let ok = 0;") })],
  ['H3 main.js が判定をヘルパ関数へ逃がす（enforceFitRatio 本体の外で capacityOf を呼ぶ）', M({ main: m => m.replace('let _enforcingFit = false;', 'function _recap(c) { return capacityOf(c, FLEET.maxCars); }\nlet _enforcingFit = false;') })],
  ['H4 fx.sync から rebuildSpawns を削除（縮めた車が古い位置のまま）', M({ main: m => m.replace('        if (!running) rebuildSpawns(slots, course);\n      },', '      },') })],
  ['H5 courseCapN への反映を削除（車両追加の上限が実態から外れる）', M({ main: m => m.replace('    courseCapN = capN;', '') })],
  ['H7 fx.sync から DOM 書き戻しを削除（状態だけ動いてスライダーが残る）', M({ main: m => m.replace('if (csEl) { csEl.value = String(userK); paintRange(csEl); }', 'if (csEl) { paintRange(csEl); }') })],
  ['H7b fx.sync から塗りつぶし更新を削除（4 つ目のズレを再注入）', M({ main: m => m.replace('if (csEl) { csEl.value = String(userK); paintRange(csEl); }', 'if (csEl) { csEl.value = String(userK); }') })],
  ['H8 ② の比較を殺す（フルスケールから戻らない）', M({ guard: g => g.replace("if (!noRace && regime === 'fullscale' && CAR.length > target) {", "if (!noRace && regime === 'fullscale' && false) {") })],
  ['H9 判定不能な入力のガードを外す（minDim<=0 で黙って下限まで縮めて告知する）', M({ guard: g => g.replace('if (!(minDim > 0)) return { regime, userK };', '') })],
  // ▼ BA1（2026-09-15）: 判定 1 回ぶんの fitsAllCars メモの契約
  ['BA1 メモの鍵から CAR.width を外す', M({ guard: g => g.replace('|${CAR.width}', '') })],
  ['BA1 メモの鍵から CAR.rearToBack を外す', M({ guard: g => g.replace('|${CAR.rearToBack}', '') })],
  ['BA1 メモの鍵から PHYSICS.mode を外す', M({ guard: g => g.replace('|${PHYSICS.mode}', '') })],
  ['BA1 メモの鍵から台数 n を外す（1 台と 6 台の答えが混ざる）', M({ guard: g => g.replace('=> `${n}|${CAR.length}', '=> `${CAR.length}') })],
  ['BA1 メモをモジュール直下へ出す（判定をまたいで答えを持ち越す）', M({ guard: g => g.replace('function fitsMemoFor(course) {\n  const memo = new Map();', 'const memo = new Map();\nfunction fitsMemoFor(course) {') })],
  ['BA1 ⑤ の近道を「偽でなければ」へ広げる（未評価で maxCars を名乗る）', M({ guard: g => g.replace('fits.known(FLEET.maxCars) === true ?', 'fits.known(FLEET.maxCars) !== false ?') })],
  ['BA1 settleFitRatio が ⑤ とメモを共有しない', M({ guard: g => g.replace('settleScale(course, ctx, fx, fits);', 'settleScale(course, ctx, fx);') })],
  ['BA1 ④ の入口だけメモを通さない（入口の二重評価を戻す）', M({ guard: g => g.replace('    if (!fits(FLEET.maxCars)) {', '    if (!fitsAllCars(course, FLEET.maxCars)) {') })],
  // ▼ 層 4 レビュー（2026-09-15）が「D)/H) を素通りする」と実証した形
  ['BA1 モジュール直下の WeakMap でコースごとにメモを返す（判定をまたいで持ち越す）', M({ guard: g => g.replace('function fitsMemoFor(course) {\n', 'const _memoByCourse = new WeakMap();\nfunction fitsMemoFor(course) {\n  if (_memoByCourse.has(course)) return _memoByCourse.get(course);\n') })],
  ['BA1 括弧なしの new Map に course.name で持ち越す', M({ guard: g => g.replace('function fitsMemoFor(course) {\n  const memo = new Map();', 'const _byName = new Map;\nfunction fitsMemoFor(course) {\n  const memo = _byName.get(course.name) || new Map(); _byName.set(course.name, memo);') })],
  ['BA1 偽の答えを覚えない（入口の二重評価が戻る）', M({ guard: g => g.replace('if (v === undefined) { v = fitsAllCars(course, n); memo.set(k, v); }', 'if (!v) { v = fitsAllCars(course, n); if (v) memo.set(k, v); }') })],
];
console.log('\nF) D) 自身の変異試験（守っている行を壊して赤くなるか）');
const mutMiss = [], mutNoop = [];
for (const [name, mut] of MUTATIONS) {
  const m = mut.main(mainRaw), f = mut.fleet(fleetRaw), g = mut.guard(guardRaw), h = mut.html(htmlRaw);
  if (m === mainRaw && f === fleetRaw && g === guardRaw && h === htmlRaw) { mutNoop.push(`${name}（変異が適用されていない＝パターンが実装とズレた）`); continue; }
  if (checkStructural(m, f, g, h).length <= structural.length) mutMiss.push(name);
}
console.log(`  変異 ${MUTATIONS.length} 件を注入（product のファイルは無改変）`);
report('F) D) が見逃した変異', mutMiss);
report('F) 適用できなかった変異（パターン腐り）', mutNoop);

// ── G) ライブ判定（利用者スケール）と 🏁 の判定（×1）の食い違い ────────────────────────
// **決定（AZ6・2026-09-13）: 両者を片方へ「寄せない」。** 理由は測っている対象が違い、どちらも
// その目的に対して正しいから:
//   ・`runRace` は AK2/D10 により `setCarScale(1)` で userK を 1 へ正規化してから収容を測る。
//     公式記録がスライダー位置に依存しては困る（verifyHash が変わる）＝**ここを変えると既存の
//     公式記録の再現性が壊れる**。
//   ・判定コア（ライブ）は利用者のスケールで測る。③④ の存在理由そのものが「利用者の carScale を
//     コースへ合わせて縮める」ことなので、×1 で測ったら仕事にならない。
// ∴ 統一するのではなく、**食い違ったときに必ず利用者へ届くこと**で担保する。
//
// ⚠ **この食い違いは出荷コースに実在する（実測 2026-09-13・下の件数）。** AZ6 の起票時は「無いはず」と
//   想定していたが、峠系の狭路コース × midscale で多数出る（ライブは carScale を 0.4〜0.9 まで縮めて
//   「6 台収まる」と言うのに、🏁 は ×1 で測るので 1 台も置けない）。**想定でなく実測を正とする。**
//   ∴ 本節が守る不変条件は「食い違いが 0 件」ではなく —
//   **食い違うセルでは 🏁 が必ず `NO_ROOM` で止まる（＝黙って壊れたレースを成立させない）**
//   である。これは AZ5 が入れた throw と `log.race.noRoom`（「レースは車体スケール ×1 で走ります」と
//   明示する文言）が効いていることの behavioral な確認になる。
console.log('\nG) ライブ判定（利用者スケール）と 🏁 の判定（×1・AK2/D10）の食い違い');
console.log('   ※ 決定: 寄せない（両者は別の対象を測っており、寄せると公式記録の再現性か ③④ の目的が壊れる）。');
console.log(`   食い違うセル: ${mismatch.length} 件 / ${cells} セル（情報。0 件を不変条件にはしない＝実在する）`);
{
  const byCourse = [...new Set(mismatch.map(m => m.tag.split('|')[0]))];
  console.log(`   該当コース ${byCourse.length} 本: ${byCourse.slice(0, 6).join(' / ')}${byCourse.length > 6 ? ' …' : ''}`);
  mismatch.slice(0, 3).forEach(m => console.log(`       - ${m.tag}: ライブ ${m.regime}/cs${m.userK} capN=${m.live} だが 🏁(×1) は capN=0`));
}
// **不変条件（behavioral）**: 食い違うセルの代表で本物の `runRace` を呼び、NO_ROOM で止まること。
// 代表＝該当コースごとに 1 セル（全件回すと実走コストが大きすぎる。コースが増えれば代表も増える）。
const silentRace = [];
{
  const seen = new Set();
  for (const m of mismatch) {
    const cname = m.tag.split('|')[0];
    if (seen.has(cname)) continue; seen.add(cname);
    setRegimeScale(kL(m.regime)); setCarScale(1);
    let threw = null;
    try {
      runRace({ course: m.course, regime: m.regime, laps: 1, field: [{ lang: 'c', src: PROGRAM_BY_KEY['normal_fr'].code, carType: PROGRAM_BY_KEY['normal_fr'].carType }], maxSec: 2 });
    } catch (e) { threw = e && e.code; }
    if (threw !== 'NO_ROOM') silentRace.push(`${m.tag}: 🏁 が NO_ROOM で止まらなかった（code=${threw}）＝食い違いが無言になる`);
  }
  console.log(`   behavioral 確認: 該当コース ${seen.size} 本で本物の runRace を 1 回ずつ実行`);
}
report('G) 食い違うのに 🏁 が黙って走ってしまうセル', silentRace);

// ── E) 性能 ────────────────────────────────────────────────────────────────────
console.log('\nE) 性能');
console.log(`  凍結旧ロジックの実オラクル論理呼び出し（出荷 ${cells} セル合計）: ${callsLegacy} 回`);
console.log(`  新側は product の判定コアを（ゲート側のキャッシュを通さず）そのまま実行しており、A/B の壁時計は ${gridSec.toFixed(1)}s。`);
const perfBad = [];
let worst = null;
for (const spec of specs) { let c; try { c = buildFromSpec(spec); } catch { continue; } if (!worst || c.walls.length > worst.walls.length) worst = c; }
const timeOf = (c, n, reps = 5) => { const t0 = process.hrtime.bigint(); for (let i = 0; i < reps; i++) fitsAllCars(c, n); return Number(process.hrtime.bigint() - t0) / reps / 1e6; };
setRegimeScale(kL('tabletop')); setCarScale(1);
const tFx = timeOf(fx, MAXN);
const tOkWorst = timeOf(worst, MAXN);
setRegimeScale(kL('fullscale')); setCarScale(1);
const tNgWorst = timeOf(worst, MAXN);
console.log(`  ① 治具（閉じた廊下・落ち着き先＝卓上 cs1）× ${MAXN} 台            : ${tFx.toFixed(2)} ms`);
console.log(`  ② 出荷最大「${worst.name}」壁 ${worst.walls.length} 本・卓上 cs1 × ${MAXN} 台: ${tOkWorst.toFixed(2)} ms  ← 改修前から ④ が毎回払っている`);
console.log(`  ③ 同コース fullscale cs1（置けない＝廊下 BFS へ落ちる最悪ケース）  : ${tNgWorst.toFixed(2)} ms  ← 同上（改修前からの性質）`);
// **【AZ6・2026-09-13 是正】「利用者が待つもの」を測る。**
//   旧 E) は `PERF_BUDGET_MS` を治具 1 本の `fitsAllCars` 単体時間とだけ比べていた（＝受け入れ基準を
//   宣言しながら、照らしていたのが別物だった。層 4 レビュー 2026-09-13 の指摘）。利用者が実際に待つのは
//   **判定コア 1 回ぶん**（コース選択・領域変更・carScale 変更のたび）なので、そちらを全格子で測って出す。
const noFx = { regime: (n) => { setRegimeScale(kL(n)); }, scale: (k2) => setCarScale(k2), sync: () => {}, log: () => {} };
{
  const rows = [];
  for (let ci = 0; ci < specs.length; ci++) {
    let c; try { c = buildFromSpec(specs[ci]); } catch { continue; }
    for (const r of REG) for (const uk of SCALES) {
      setRegimeScale(kL(r)); setCarScale(uk);
      const t1 = process.hrtime.bigint();
      settleFitRatio(c, { regime: r, userK: uk, slotCount: 1, reason: 'course' }, noFx);
      rows.push({ t: Number(process.hrtime.bigint() - t1) / 1e6, tag: `${specs[ci].name}|${r}|cs${uk}` });
    }
  }
  rows.sort((a, b) => b.t - a.t);
  const med = rows[Math.floor(rows.length / 2)].t;
  const over = rows.filter(x => x.t > PERF_BUDGET_MS).length;
  console.log(`  ④ **判定コア 1 回**（${rows.length} セル・reason='course'）: 中央値 ${med.toFixed(1)} ms・最大 ${rows[0].t.toFixed(1)} ms（${rows[0].tag}）`);
  console.log(`     目安 ${PERF_BUDGET_MS} ms 超: ${over} / ${rows.length} セル（${(over / rows.length * 100).toFixed(0)}%）`);
  console.log('     ⚠ 残る目安超えは、ほぼ全部が ④ の 0.1 刻み降下で「収まらない」評価を何回も払うセル（AG1 以来の設計）。');
  console.log('     `fitsAllCars` は carScale について単調でない（BA1 実測 2026-09-15: 出荷 198 行＝コース×領域 のうち 65 行に反例）ので、');
  console.log('     二分探索で回数を減らすと落ち着き先が変わる（同: 入口で収まらない 5,562 通りのうち 877 通り）。');
  console.log('     ∴ BA1 は回数を減らさず 1 回の評価を軽くした（結果はビット単位で同一＝wf_ba1_fitcore.mjs が出力ダイジェストで固定）。');
  console.log('     **隠さず数字で残すが赤にはしない**（壁時計は環境ノイズに負ける）。AZ6 が増やしたぶんだけを下の条件で赤くする。');
}
// **AZ6 の増分を赤くする条件**: ⑥ の 1 台プローブ（実走 `runRace`）は**発走直前だけ**に払う設計なので、
//   コース閲覧（reason ∈ {course, regime, carScale, startup}）では 1 回も走らないこと。ここが崩れると
//   「コース選択のたびに数十〜数百 ms」へ戻る。
//   **時間では測らない**（環境ノイズに負ける）。「静的には置けるが 1 台も走り出せない」治具を使い、
//   **`capZeroDrive` が立つかどうか**という二値で測る — 立てば実走プローブが走った動かぬ証拠になる。
{
  // 外形は広く（③ が縮めない）、スタート地点だけ閉じた小部屋＝静的 capN≥1・実走 0。
  const mk = () => {
    setRegimeScale(kL('tabletop')); setCarScale(1);
    const L = CAR.length, W = CAR.width, X = 1.7 * L, Y = 4 * W, W0 = 2.0, y0 = W0 / 2 - Y / 2, x0 = 0.2;
    return normalizeCourse({ name: 'AZ6 perf fixture: pocket', bounds: { w: W0, h: W0 },
      start: { x: x0 + X * 0.35, y: W0 / 2, theta: 0 },
      walls: [{ x1: x0, y1: y0, x2: x0 + X, y2: y0 }, { x1: x0 + X, y1: y0, x2: x0 + X, y2: y0 + Y },
              { x1: x0 + X, y1: y0 + Y, x2: x0, y2: y0 + Y }, { x1: x0, y1: y0 + Y, x2: x0, y2: y0 }] });
  };
  const pocket = mk();
  const run = (reason) => {
    setRegimeScale(kL('tabletop')); setCarScale(1);
    return settleFitRatio(pocket, { regime: 'tabletop', userK: 1, slotCount: 1, reason }, noFx);
  };
  const race = run('race');
  console.log(`  ⑤ 治具（外形 2×2m・スタート地点だけ閉じた小部屋）: reason='race' → capZeroDrive=${race.capZeroDrive}・capZeroStatic=${race.capZeroStatic}`);
  if (race.capZeroStatic) perfBad.push('⑤ の治具が静的にも置けない＝この検査は ⑥ を通っていない（治具の作り直しが要る）');
  if (!race.capZeroDrive) perfBad.push("reason==='race' でも実走ゼロを検出できていない（⑥ の 1 台分岐が死んでいる＝下の 0 件は空振り）");
  const browsed = [];
  for (const reason of ['course', 'regime', 'carScale', 'startup']) if (run(reason).capZeroDrive) browsed.push(reason);
  console.log(`  ⑤ コース閲覧 4 経路で実走プローブが走った数: ${browsed.length}（0 であること）`);
  if (browsed.length) perfBad.push(`reason!=='race' でも実走プローブが走っている（${browsed.join('/')}）＝コース閲覧に実走コストを払う設計へ戻った`);
}
if (tFx > PERF_BUDGET_MS) perfBad.push(`落ち着き先での判定が目安 ${PERF_BUDGET_MS} ms を超えた: ${tFx.toFixed(2)} ms`);
report('E) 性能条件の違反', perfBad);

console.log('\n' + '='.repeat(78));
console.log(pass ? 'AZ2/AZ6 フィットガード・ゲート: 全パス ○' : 'AZ2/AZ6 フィットガード・ゲート: ✗ 不合格');
console.log('='.repeat(78));
process.exit(pass ? 0 : 1);
