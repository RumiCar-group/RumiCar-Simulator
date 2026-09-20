// check_bd1_capkey.mjs — BD1「保存コースの壁を編集したときに古い実走判定が返るのを無くす」の実ブラウザ検証
// ════════════════════════════════════════════════════════════════════════════
// 何を測るか:
//   `capacity.js` の実走容量 `driveableCapN` はコース名でキャッシュしていた（BC-12 ③(a)）。
//   ∴ **保存コースの壁だけを編集して同じ名前で ✔適用すると、古い実走判定が返る**。
//   本ゲートは利用者と同じ UI 操作だけでその経路を通す（CI-8）:
//     ① 保存コースを選ぶ → ② ▶（＝ここで実走判定がキャッシュされる）→ ③ 編集で壁を 1 本引く
//     → ④ ✔適用（名前は変えない）→ ⑤ ▶（＝ここで古い答えが返るかを測る）
//
// 【判定の物差し（CI-14）】知覚「古い答えが返る」を 2 つの独立な測定述語へ翻訳する:
//   (a) **product の告知**: 編集後の ▶ で実走ゼロの告知（`log.capZeroDriveWarnOnly`）が出ること。
//   (b) **独立オラクル**: 同じ live コースに対し `capacity.js:stuckAtN`（キャッシュを通らない実走述語）が
//       「1 台も車長ぶん動けない」と答え、かつ `fleet.js:capacityOf` が「静的には置ける」と答えること
//       ＝ 実走ゼロだけが起きている（静的ゼロで別経路に落ちたのではない）。
//   (a) だけだと文言の有無しか見ておらず、(b) だけだと product を 1 行も実行していない。両方を要求する。
//
// 【治具がその性質を保っていることを前提として測る（BC-12 ①）】
//   鍵の他の成分（領域・車長・maxN・エンジン）が編集の前後で**同じ**でなければ、キャッシュは
//   そもそも当たらず本ゲートは空振りする。∴ 編集の前後で **carScale スライダーが同じ値**であることを
//   毎回測り、違ったら治具の陳腐化として FAIL にする（product の退行と読み違えない）。
//
// 【治具の選定（卓上・スライダー既定 0.8 から落ち着く先 0.6 ＝車長 0.1140 m で実測・2026-09-20）】
//   廊下 [0.30,1.50]×幅 0.20 m（bounds 3.0×2.0・start (0.45,1.00,θ=0)）:
//     編集前: 実走の最大変位 0.84021 m = **7.370 × 車長** → 走り出せる
//     編集後（(0.75,0.90)-(0.75,1.10) の壁を 1 本追加）: 0.08996 m = **0.789 × 車長** → 走り出せない
//   静的収容はどちらも `capacityOf`=6（＝静的ゼロではない）。両側とも閾値から 20% 以上離れている。
//   壁の端点は 0.05 m グリッド上なので、エディタ「壁」モードのスナップで**ちょうどこの線**が引ける。
import { launch, newPage, appModule, setLang } from './lib.mjs';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };

const NAME = 'BD1 壁編集テスト';
const X0 = 0.30, X1 = 1.50, YA = 0.90, YB = 1.10, EX = 0.75;
const FIXTURE = {
  name: NAME, bounds: { w: 3.0, h: 2.0 }, start: { x: 0.45, y: 1.00, theta: 0 },
  finish: { x1: 0.35, y1: YA, x2: 0.35, y2: YB, fx: 1, fy: 0 },
  walls: [
    { x1: X0, y1: YA, x2: X1, y2: YA }, { x1: X1, y1: YA, x2: X1, y2: YB },
    { x1: X1, y1: YB, x2: X0, y2: YB }, { x1: X0, y1: YB, x2: X0, y2: YA },
  ],
};
// 文言の識別子（ja）。互いに排他な部分文字列を使う（AZ5 と同じ型）。
const RE = {
  capZeroDrive: /置くことはできても実際に走り出せる車が 1 台もありません/,
  capZeroStatic: /車を 1 台も置けません \(壁に当たらず/,
  capReduced: /しか壁に当たらず走り出せません/,
};

const logText = (page) => page.evaluate(() => (document.getElementById('log')?.textContent ?? ''));
const scaleVal = (page) => page.evaluate(() => document.getElementById('carScale').value);

/** ログが増えて静止するまで待つ（実走プローブを回すので所要が読めない＝固定待ちにしない・AZ5 と同型）。 */
// **timeout を握りつぶさない**（層 4 レビュー 2026-09-20・中）。旧実装は `.catch(() => {})` で待ちの不成立を
//   飲み込んでおり、待てなかったときに `added` が空のまま**否定アサーション（「〜が出ない」）が必ず真**に
//   なった。①は以降の検査が成立するための**前提**なので、ここが空振りすると②〜⑥が何を測ったか保証できない。
//   ∴ 例外のまま落とす（finally がブラウザを閉じて非ゼロ終了＝fail-closed）。
async function settle(page, before, quietMs = 1500, timeout = 120000) {
  await page.waitForFunction(({ n, q }) => {
    const len = (document.getElementById('log')?.textContent ?? '').length;
    window.__bd1 = window.__bd1 || {};
    if (window.__bd1.len !== len) { window.__bd1.len = len; window.__bd1.at = Date.now(); return false; }
    return len >= n && Date.now() - (window.__bd1.at || 0) > q;
  }, { n: before, q: quietMs }, { timeout });
  await page.waitForTimeout(300);
  return (await logText(page)).slice(before);
}

/** ▶ を押して、フィットガードの告知が出そろったログ**全文**を得る。
 *  **`startAuto` は `clearLog()` をフィットガードより前に呼ぶ**（AZ6・main.js:395）ので、押す前の長さで
 *  slice すると必ず空文字になり、「告知が出ない」も「出る」も無条件に通ってしまう（＝原理的に失敗しえない
 *  検査）。∴ 全文を読む。待ちは**ログの長さではなく UI の状態**で取る（BD-1 ⑥「操作したか」を値の一致で
 *  代用しない）: `startAuto` はガードを同期に通し切ってから `syncButtons()` で ⏹ を有効化するので、
 *  ⏹ が有効になった時点でガードの告知は既にログにある。ガードは実走プローブを含み所要が読めないため
 *  固定待ちにしない。 */
async function runAndRead(page) {
  await page.click('#run');
  await page.waitForFunction(() => document.getElementById('stop')?.disabled === false,
    null, { timeout: 180000 });
  const txt = await logText(page);
  await page.click('#stop');
  await page.waitForTimeout(400);
  return txt;
}

/** world 座標 → ビューポート座標。等倍・パン 0（コース選択直後の resetView 後）の本番の写像をそのまま使う。 */
async function clickWorld(page, X, Y) {
  const pt = await page.evaluate(async ([x, y]) => {
    const st = await import(new URL('js/state.js', location.href).href);
    const cv = document.getElementById('course');
    cv.scrollIntoView({ block: 'center' });
    const r = cv.getBoundingClientRect();
    const s = cv.width / st.course.bounds.w;                 // = view.pxPerM（canvas.width = bounds.w × pxPerM）
    const cx = x * s, cy = (st.course.bounds.h - y) * s;     // worldToScreen（y 上向き→画面 y 下向き）
    return { x: r.left + cx * r.width / cv.width, y: r.top + cy * r.height / cv.height };
  }, [X, Y]);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(150);
}

/** 配信中の `capacity.js` が持つ覚え書きの項目数（`CAP_CACHE` は観測専用の口）。
 *  **なぜ要るか**（層 4 レビュー 2026-09-20・中）: ②の「告知が出ない」は否定アサーションなので、⑥の分岐が
 *  何かの理由で通らず**1 件も積まれなかった**場合も緑になる。すると⑤も正しく赤を出せず、バグの再現経路を
 *  一度も通らないまま全緑になる。∴「▶ のたびに実走判定が 1 件積まれた」を数で押さえる（一方向の証拠）。 */
const capSize = (page) => appModule(page, 'js/capacity.js', (m) => m.CAP_CACHE.size);

/** live の走行コース（state.js の live binding）。 */
const liveCourse = (page) => appModule(page, 'js/state.js', (m) => m.course);
/** 独立オラクル: 実走述語（キャッシュを通らない）と静的収容を、配信中のモジュールに答えさせる。 */
const oracles = (page) => page.evaluate(async () => {
  const [cap, fleet, state, cfg] = await Promise.all([
    import(new URL('js/capacity.js', location.href).href),
    import(new URL('js/fleet.js', location.href).href),
    import(new URL('js/state.js', location.href).href),
    import(new URL('js/config.js', location.href).href),
  ]);
  return {
    stuck1: cap.stuckAtN(state.course, 'tabletop', 1),
    staticCap: fleet.capacityOf(state.course, cfg.FLEET.maxCars),
    carLen: cfg.CAR.length,
  };
});
const hasEditWall = (walls) => walls.some((w) =>
  Math.abs(w.x1 - EX) < 1e-9 && Math.abs(w.x2 - EX) < 1e-9 &&
  Math.abs(Math.min(w.y1, w.y2) - YA) < 1e-9 && Math.abs(Math.max(w.y1, w.y2) - YB) < 1e-9);

const browser = await launch();
try {
  const { page, errors, benign } = await newPage(browser);
  await setLang(page, 'ja');

  // ── 治具を保存コースとして入れて読み直す（保存コースは実在の機能・AZ5 と同じ入れ方）────────
  await page.evaluate((c) => {
    const all = JSON.parse(localStorage.getItem('rumicar.courses') || '{}');
    all[c.name] = c;
    localStorage.setItem('rumicar.courses', JSON.stringify(all));
  }, FIXTURE);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await setLang(page, 'ja');

  console.log('\n【① 選択】保存コースを選ぶ（本番の selectCourse → applyCourse → enforceFitRatio(\'course\')）');
  let before = (await logText(page)).length;
  await page.selectOption('#courseSel', NAME);
  let added = await settle(page, before);
  const scale0 = await scaleVal(page);
  const c0 = await liveCourse(page);
  ok(c0.name === NAME, `① 走行コースが治具になった（course.name=${JSON.stringify(c0.name)}）`);
  ok(c0.walls.length === FIXTURE.walls.length, `① 壁は ${c0.walls.length} 本（治具どおり ${FIXTURE.walls.length} 本）`);
  ok(!hasEditWall(c0.walls), '① まだ編集の壁は入っていない（この後の ✔適用が効いたことの一方向の証拠にする）');
  ok(!RE.capZeroStatic.test(added), '① 静的ゼロでは落ちていない（⑥ の実走判定に到達する母体である）');

  console.log('\n【② ▶ 編集前】走り出せる状態で実走判定をキャッシュさせる');
  const cache1 = await capSize(page);
  const log2 = await runAndRead(page);
  const cache2 = await capSize(page);
  const scale1 = await scaleVal(page);
  ok(log2.length > 0, `② ▶ が成立した（clearLog 後のログ ${log2.length} 文字＝ガードの告知が載る先がある）`);
  ok(cache1 === 0 && cache2 === 1,
    `② ▶ で実走判定が 1 件積まれた（覚え書き ${cache1} → ${cache2} 件）＝⑥の分岐を実際に通っている`);
  ok(!RE.capZeroDrive.test(log2), '② 編集前は実走ゼロの告知が出ない（＝この時点のキャッシュは「走り出せる」）');
  ok(!RE.capReduced.test(log2), '② 減台の告知も出ない（収容はそのまま）');

  console.log('\n【③④ 編集 → ✔適用】壁を 1 本引いて、名前を変えずに適用する');
  await page.click('#editToggle');
  await page.waitForTimeout(400);
  const mode = await page.evaluate(() => document.querySelector('input[name=emode]:checked')?.value);
  ok(mode === 'wall', `③ 編集モードは「壁」（2 点クリックで 1 本引く。実測 value=${JSON.stringify(mode)}）`);
  await clickWorld(page, EX, YA);
  await clickWorld(page, EX, YB);
  await page.click('#edApply');
  await page.waitForTimeout(600);
  const c1 = await liveCourse(page);
  ok(c1.name === NAME, `④ ✔適用でコース名は変わっていない（course.name=${JSON.stringify(c1.name)}）＝同名で壁だけが違う`);
  ok(c1.walls.length === FIXTURE.walls.length + 1,
    `④ 壁が 1 本増えた（${FIXTURE.walls.length} → ${c1.walls.length} 本）＝キャンバス操作が実際に効いた`);
  ok(hasEditWall(c1.walls),
    `④ 引いた壁は (${EX},${YA})-(${EX},${YB})（グリッドスナップどおり。実測 ${JSON.stringify(c1.walls[c1.walls.length - 1])}）`);

  console.log('\n【⑤ ▶ 編集後】古い実走判定が返っていないかを測る（本体）');
  const log5 = await runAndRead(page);
  const cache3 = await capSize(page);
  const scale2 = await scaleVal(page);
  ok(cache3 === cache2 + 1,
    `⑤ 壁が違うので新しい項目が 1 件積まれた（覚え書き ${cache2} → ${cache3} 件）＝形の差が鍵に効いている`);

  // 治具の前提（BC-12 ①）: 鍵の他の成分が前後で同じでなければキャッシュに当たらず空振りする。
  ok(scale0 === scale1 && scale1 === scale2,
    `前提: carScale が ①②⑤ で同一（${scale0} / ${scale1} / ${scale2}）＝違うのは壁だけで、鍵の他の成分は動いていない`);

  // (a) product の告知
  ok(RE.capZeroDrive.test(log5),
    '⑤ 編集後の ▶ で実走ゼロを告知する（古い「走り出せる」を返していない）');
  ok(!RE.capZeroStatic.test(log5), '⑤ 静的ゼロの文言では言い換えていない（理由の違うものを同じ文言にしない）');

  // (b) 独立オラクル（キャッシュを通らない実走述語 + 静的収容）
  const orc = await oracles(page);
  ok(orc.stuck1 === 1,
    `⑤ 独立オラクル: stuckAtN(course,'tabletop',1)=${orc.stuck1}（1 = この 1 台は車長 ${orc.carLen.toFixed(4)} m ぶんも動けない）`);
  ok(orc.staticCap >= 1,
    `⑤ 独立オラクル: capacityOf=${orc.staticCap} ≥ 1（静的には置ける＝実走ゼロだけが起きている）`);

  console.log('\n【⑥ 兄弟（逆向き）】壁を戻したら告知が消える（キャッシュが「走り出せない」に固着しない）');
  await page.click('#editToggle');
  await page.waitForTimeout(400);
  await page.click('#edUndo');
  await page.waitForTimeout(200);
  await page.click('#edApply');
  await page.waitForTimeout(600);
  const c2 = await liveCourse(page);
  ok(c2.walls.length === FIXTURE.walls.length && !hasEditWall(c2.walls),
    `⑥ 元に戻す＋✔適用で壁が ${c2.walls.length} 本に戻った（編集の壁は無い）`);
  const log6 = await runAndRead(page);
  const cache4 = await capSize(page);
  const scale3 = await scaleVal(page);
  ok(cache4 === cache3,
    `⑥ 元の形に戻したら項目は増えない（覚え書き ${cache3} → ${cache4} 件）＝内容が同じなら当たる（✔適用のたびに測り直しにならない）`);
  ok(scale3 === scale0, `前提: carScale は ① と同じ ${scale3}（鍵の他の成分は動いていない）`);
  ok(!RE.capZeroDrive.test(log6),
    '⑥ 壁を戻したら実走ゼロの告知は出ない（「走り出せない」側の古い答えにも固着しない）');

  ok(errors.length === 0, `⑦ JS/HTTP エラー 0 件（${errors.length}${errors.length ? ': ' + JSON.stringify(errors.slice(0, 3)) : ''}）／想定内 ${benign.length}`);
  await page.close();
} finally {
  await browser.close();
}

const line = '─'.repeat(64);
console.log('\n' + line);
console.log('BD1 実走容量キャッシュの鍵（壁の編集）実ブラウザゲート');
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log(line); for (const m of fails) console.log('  ✗ ' + m); }
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
