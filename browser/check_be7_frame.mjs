// check_be7_frame.mjs — 上限内でも重い投稿コースで、ライブ走行のフレームが出荷コースの最悪の 2 倍に収まることを
// 実ブラウザで測る (BE7・BB-4 ③)。node 側の計算量・等価性は wf_be7_heavy.mjs。
// ════════════════════════════════════════════════════════════════════════════
// 【何を守る数字か】投稿コースの取り込み検査は壁 20,000 本まで通す。改修前 (公開 7772773) は、卓上楕円を壁 20,000 本
//   で描いたコースを 6 台・速度倍率の上限で走らせると 1 フレーム 119.6 ms (追従カメラ ON で 152 ms) で、出荷 66 本の
//   最悪 (競技グラウンド (フルスケール)・33.6 ms) の 3.6〜4.5 倍だった。BE7 の受け入れ基準 (実装前に固定):
//   **既定表示と追従カメラ ON のそれぞれで、同じ条件の出荷最大の 2 倍以内**。
// 【測定述語】CDP Performance.getMetrics の TaskDuration (メインスレッドのタスク時間の累計) の増分 ÷ その間に来た
//   rAF の回数＝1 フレームあたりのメインスレッドの仕事量。vsync (16.7 ms) に量子化されない連続量なので、フレーム間隔を
//   数える check_bc7_frame.mjs と違い「60 fps に収まっているときの余裕」も測れる。
// 【比で判定する】ホストの速さで絶対値が動くので、同じブラウザで出荷最大のコースを交互に測り、比の中央値で判定する
//   (5 回。1 回ごとの比は本ホストで 1.46〜1.89 に揺れた＝追従 ON。3 回の中央値は 1.64〜1.85 だった)。出荷最大のコースは改修前に 66 本を全部測って決めた
//   (既定表示・追従 ON とも競技グラウンド (フルスケール))。出荷コースを足したり v2 を速くしたりして最大が動いたら、
//   ここの ANCHOR を測り直す (docs の BE7 決定ログの手順)。
// 【「負荷が消える向きの退行」を緑にしない】台数が上限まで入った・速度倍率が product に届いた・走行が現に進んでいる
//   (ToF 表示が変わった車の数) を同じ往復で確かめる (check_bc7_frame.mjs と同じ固定)。
// 【検出力】改修前の経路 (contact_v2.js から BE7 の関数を外し、sensors.js の飛ばしを外したもの) を page.route で配信し
//   直したページでは、同じ比が 2 を**超える**ことを測る (product のファイルは触らない)。
// 【画素一致】追従・拡大中のコース描画は「キャンバスに 1 画素も掛からない壁を描かない」。これが絵を変えないことを、
//   間引きを外した course.js を配信し直したページで同じ大きさ・同じ変換で描いた参照との全画素比較で確かめる。
//   間引きを攻めすぎた変異 (余白を負にする) で差が出ること＝検査の検出力も測る。
// ════════════════════════════════════════════════════════════════════════════
import { launch, newPage, appModule, report } from './lib.mjs';

const RATIO_MAX = 2;
const ROUNDS = 5;
const SPAN = 3500, WARMUP = 1500;
const ANCHOR = '競技グラウンド (フルスケール)';
const HEAVY = 'BE7 dense oval 20k';

// 卓上楕円 (オーバルと同寸・外/内の輪を各 10,000 本＝壁 20,000 本)。wf_be7_heavy.mjs の ovalDense と同じ形。
function ovalDense(nPer, name) {
  const rx = 1.2, ry = 0.75, w = 0.55, cx = 1.6, cy = 1.1;
  const ring = (ax, ay) => { const p = []; for (let i = 0; i < nPer; i++) { const t = 2 * Math.PI * i / nPer; p.push([cx + ax * Math.cos(t), cy + ay * Math.sin(t)]); } return p; };
  const walls = [];
  for (const p of [ring(rx + w / 2, ry + w / 2), ring(rx - w / 2, ry - w / 2)])
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; walls.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] }); }
  return { name, bounds: { w: 3.2, h: 2.2 }, start: { x: cx, y: cy - ry, theta: 0 }, finish: { x1: cx, y1: cy - ry - w / 2, x2: cx, y2: cy - ry + w / 2 }, walls };
}
const heavyData = ovalDense(10000, HEAVY);

// 改修前の経路を配信し直す (検出力の確認用)。product のファイルは触らず、応答の本文だけを差し替える。
const OLD_EDITS = {
  'contact_v2.js': [['export function anyWallNearSeg(', 'function anyWallNearSeg('], ['export function rayNearestWall(', 'function rayNearestWall('],
    ['export function fanDepthsNear(', 'function fanDepthsNear('], ['export function rayGridWorth(', 'function rayGridWorth(']],
  'sensors.js': [['const SENSE_PRUNE_MIN = 16;', 'const SENSE_PRUNE_MIN = Infinity;']],
};
let pass = 0, fail = 0; const fails = [];
const ok = (label, cond, detail) => { if (report(label, cond, detail)) pass++; else { fail++; fails.push(`${label} — ${detail}`); } };

const browser = await launch();
const rot = [];
async function routeEdits(page, edits) {
  for (const [file, list] of Object.entries(edits)) {
    await page.route(`**/js/${file}*`, async (route) => {
      const res = await route.fetch();
      let body = await res.text();
      for (const [from, to] of list) {
        if (body.split(from).length - 1 !== 1) rot.push(`${file}: 「${from.slice(0, 50)}」が 1 回でない`);
        body = body.replace(from, to);
      }
      await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'application/javascript' } });
    });
  }
}

// 1 条件を測る。seed=保存コースとして置くデータ・follow=追従カメラ・edits=配信し直す差分。
async function measure(courseValue, { seed = null, follow = false, edits = null } = {}) {
  const before = async (page) => {
    if (seed) await page.addInitScript((s) => { localStorage.setItem('rumicar.courses', s); }, JSON.stringify(seed));
    if (edits) await routeEdits(page, edits);
  };
  const { page, errors } = await newPage(browser, { width: 1440, height: 900, before });
  await page.selectOption('#courseSel', courseValue);
  await page.waitForTimeout(600);
  const maxCars = await appModule(page, 'js/config.js', (m) => m.FLEET.maxCars);
  for (let i = 0; i < maxCars + 2; i++) { if (await page.locator('#carAdd').isDisabled()) break; await page.click('#carAdd', { timeout: 5000 }); }
  const speed = await page.evaluate(() => {
    const el = document.getElementById('speed');
    el.value = el.max; el.dispatchEvent(new Event('input', { bubbles: true }));
    return { speedMax: Number(el.max), speedShown: (document.getElementById('speedv').textContent || '').trim() };
  });
  if (follow) await page.check('#optFollow');
  const env = await page.evaluate(async () => {
    const S = await import(new URL('js/state.js', location.href).href);
    return { course: S.course.name, walls: S.course.walls.length, cars: document.querySelectorAll('#fleetCols .carcol').length,
      follow: !!(document.getElementById('optFollow') || {}).checked };
  });
  await page.click('#run');
  await page.waitForTimeout(WARMUP);
  const distAt = () => page.evaluate(() => [...document.querySelectorAll('#fleetCols .cc-dist')].map((e) => e.textContent));
  const dist0 = await distAt();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const met = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const m0 = await met();
  const fr = await page.evaluate((span) => new Promise((res) => { let n = 0; const t0 = performance.now();
    const tick = (now) => { n++; if (now - t0 < span) requestAnimationFrame(tick); else res(n); }; requestAnimationFrame(tick); }), SPAN);
  const m1 = await met();
  const dist1 = await distAt();
  await page.close();
  const moved = dist0.length === dist1.length ? dist0.reduce((a, v, i) => a + (v !== dist1[i] ? 1 : 0), 0) : -1;
  return { ...env, ...speed, maxCars, frames: fr, taskMs: (m1.TaskDuration - m0.TaskDuration) * 1000 / fr, moved, err: errors.length, errs: errors.slice(0, 2) };
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

console.log(`BE7 重いコースのフレーム  比の上限 ${RATIO_MAX}（重いコース ÷ 出荷最大「${ANCHOR}」・${ROUNDS} 回の中央値）`);
console.log('─'.repeat(78));
const seed = { [HEAVY]: heavyData };
const ratios = { default: [], follow: [] };
const anchorMs = { default: [], follow: [] };
for (let r = 0; r < ROUNDS; r++) {
  for (const follow of [false, true]) {
    const key = follow ? 'follow' : 'default';
    const h = await measure(HEAVY, { seed, follow });
    const a = await measure(ANCHOR, { follow });
    for (const x of [h, a]) {
      const tag = `[${key} #${r + 1}] ${x.course}`;
      if (!(x.cars === x.maxCars && x.speedShown === `${x.speedMax.toFixed(1)}×` && x.moved >= 1 && x.err === 0 && x.follow === follow))
        ok(`${tag} 測定条件がそろっている`, false, `台数 ${x.cars}/${x.maxCars}・速度表示「${x.speedShown}」・走行中の車 ${x.moved}・エラー ${x.err} ${x.errs.join(' | ')}・追従 ${x.follow}`);
    }
    if (h.walls !== heavyData.walls.length) ok(`[${key} #${r + 1}] 重いコースが開いた`, false, `壁 ${h.walls} 本（期待 ${heavyData.walls.length}）＝取り込み検査で断られた等`);
    ratios[key].push(h.taskMs / a.taskMs); anchorMs[key].push(a.taskMs);
    console.log(`   ${key} #${r + 1}: 重い ${h.taskMs.toFixed(1)} ms/f ÷ 出荷最大 ${a.taskMs.toFixed(1)} ms/f = ${(h.taskMs / a.taskMs).toFixed(2)}`);
  }
}
for (const key of ['default', 'follow']) {
  const m = med(ratios[key]);
  ok(`${key === 'follow' ? '追従カメラ ON' : '既定表示'}: 重いコース ÷ 出荷最大 の中央値 ≤ ${RATIO_MAX}`, m <= RATIO_MAX,
    `中央値 ${m.toFixed(2)}（各回 ${ratios[key].map((x) => x.toFixed(2)).join(' / ')}）・余裕 ${(RATIO_MAX / m).toFixed(2)} 倍`);
}

// ── 検出力: 改修前の経路を配信し直すと同じ比が上限を超える ────────────────────────────
{
  const o = await measure(HEAVY, { seed, edits: OLD_EDITS });
  const r = o.taskMs / med(anchorMs.default);
  ok('検出力: 改修前の経路（BE7 の関数を外し測距の飛ばしを外す）では既定表示の比が上限を超える', r > RATIO_MAX,
    `${o.taskMs.toFixed(1)} ms/f ÷ 出荷最大の中央値 ${med(anchorMs.default).toFixed(1)} = ${r.toFixed(2)}（エラー ${o.err}・走行中の車 ${o.moved}）`);
}

// ── 画素一致: 追従・拡大中のコース描画の間引きが絵を変えない ───────────────────────────
// 参照は「間引きを外した course.js」(page.route で配信し直す) で、**同じ大きさのキャンバス・同じ変換**で描いたもの。
// ⚠ 大きいキャンバスへ整数画素ずらして描いたものを参照にしてはならない: Chrome の 2D キャンバスは整数画素の平行移動でも
//   縁の画素が最大 16 階調ずれる (2026-09-25 に本ハーネスで実測・間引きを外しても同じ不一致が出た)。
// 各ページで (コース × 変換) ごとに画素の FNV-1a を取り、ページをまたいで突き合わせる。
const NO_CULL = { 'course.js': [['const vr = visibleViewRect(ctx);', 'const vr = null;']] };
const BAD_CULL = { 'course.js': [['const pad = VIEW.wallWidth + 2 / Math.min(m.a, m.d);', 'const pad = -2 * VIEW.wallWidth;']] };
async function pixelHashes(edits) {
  const { page } = await newPage(browser, { width: 900, height: 700, before: edits ? (p) => routeEdits(p, edits) : null });
  const out = await page.evaluate(async (heavy) => {
    const C = await import(new URL('js/course.js', location.href).href);
    const courses = C.PRESETS.map((f) => f());
    courses.push(C.normalizeCourse(heavy));
    const W = 320, H = 240;
    const T = [[1, -37.3, 12.6], [2.5, -400.25, -130.5], [7.3, -1500.7, -700.3], [1.7, 60.5, 40.25]];
    const hashes = [], names = []; let px = 0, culledEvidence = 0;
    for (const c of courses) {
      const s = 600 / Math.max(c.bounds.w, c.bounds.h);
      const view = { pxPerM: s, wPx: c.bounds.w * s, hPx: c.bounds.h * s, hM: c.bounds.h };
      for (const [z, ex, ey] of T) {
        const a = document.createElement('canvas'); a.width = W; a.height = H;
        const ca = a.getContext('2d');
        ca.setTransform(z, 0, 0, z, ex, ey);
        C.drawCourseLayer(ca, c, view, { grid: false });
        const d = ca.getImageData(0, 0, W, H).data;
        let h = 0x811c9dc5;
        for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 0x01000193) >>> 0;
        hashes.push(h); names.push(`${c.name} z${z}`); px += W * H;
        // 空振りでない証拠: キャンバスの外 (20 画素より外) に出る壁の本数＝間引きが実際に働きうる壁
        for (const w of c.walls) {
          const x1 = w.x1 * s * z + ex, x2 = w.x2 * s * z + ex, y1 = (view.hM - w.y1) * s * z + ey, y2 = (view.hM - w.y2) * s * z + ey;
          if (Math.max(x1, x2) < -20 || Math.min(x1, x2) > W + 20 || Math.max(y1, y2) < -20 || Math.min(y1, y2) > H + 20) culledEvidence++;
        }
      }
    }
    return { hashes, names, px, culledEvidence };
  }, heavyData);
  await page.close();
  return out;
}
{
  const prod = await pixelHashes(null), ref = await pixelHashes(NO_CULL), ref2 = await pixelHashes(NO_CULL), bad = await pixelHashes(BAD_CULL);
  const diff = (x, y) => x.hashes.reduce((a, h, i) => a + (h !== y.hashes[i] ? 1 : 0), 0);
  const where = prod.hashes.map((h, i) => (h !== ref.hashes[i] ? prod.names[i] : null)).filter(Boolean);
  ok('画素一致: 追従・拡大中のコース描画（画面外の壁を描かない）が、間引かずに描いた参照と全画素一致', where.length === 0 && prod.hashes.length > 0,
    `${prod.hashes.length} 通り（出荷 ${prod.hashes.length / 4 - 1} 本＋重いコース × 変換 4 種）・${(prod.px / 1e6).toFixed(1)} M 画素・不一致 ${where.length} 通り${where.length ? ' ' + where.slice(0, 4).join(' / ') : ''}`);
  ok('参照の描画が決定的（同じ参照を 2 回描いて全通り一致）', diff(ref, ref2) === 0, `不一致 ${diff(ref, ref2)} 通り`);
  ok('画素一致の検査が空振りでない（キャンバスの外に出る壁が実際にある）', prod.culledEvidence > 1000, `キャンバスの外に出る壁 延べ ${prod.culledEvidence} 本`);
  ok('画素一致の検出力: 間引きを攻めすぎる変異（余白を負にする）で参照と不一致が出る', diff(bad, ref) > 0, `不一致 ${diff(bad, ref)} / ${ref.hashes.length} 通り`);
}
ok('配信し直しの差分がすべて当たった（パターン腐りなし）', rot.length === 0, rot.length ? rot.join(' / ') : '0 件');

await browser.close();
console.log('─'.repeat(78));
console.log(`結果: PASS ${pass} / FAIL ${fail}`);
if (fail) for (const f of fails) console.log('  ✗ ' + f);
process.exit(fail === 0 ? 0 : 1);
