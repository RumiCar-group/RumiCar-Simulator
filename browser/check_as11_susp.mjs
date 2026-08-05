// RumiCar Simulator — 実ブラウザ 常設ゲート: サスペンション自由度 (任意装備) の到達性 (Stage AS11)
//
// 背景 (決定ログ AS-11): node 側の常設ゲート (wf_as11_susp.mjs) が**モデルの法則**
//   (自由応答からの (ω,ζ) 復元・行き過ぎ Mp の閉形式・定常一致) を測るのに対し、ここでは
//   **「配信物の UI から実際に届くか」** だけを、利用者と同じ操作で測る (CI-8)。
//   AS9 の申し送り②「共有 URL へフィールドを足すときの配線は3箇所・round-trip だけでは緑のまま
//   通ってしまう」への直接の答えが T6 (通し経路の実測)。
//
// ここで測るもの (「装備を選べているように見えるか」の目視の代わりになる測定述語):
//   T1 セレクタ (#optSusp) が配信 UI に実在し、選択肢と既定が配信 config の白リストと一致
//   T2 選ぶとログに ja の説明が出る／既定へ戻すと既定の文言が出る
//   T3 en でも英語の文言が出る (ja 固定文言でない)
//   T4 **配信中のモジュール**で v2 の物理が実際に変わる (行き過ぎ Mp が閉形式どおり・定常は不変)
//      ＋対照: 旧エンジン (dynamic) では装備を選んでも軌跡が 1 tick も変わらない
//   T5 HUD の刻印: 非既定を選んだときだけ注記へ装備が出る (既定では 1 文字も増えない)
//   T6 共有 URL: 既定は hash に載らず、非既定だけが載って**リロードで復元**される (3箇所の通し経路)
//   T7 物理解説 (📖) に §サス自由度の項が配信されている
//   T8 操作中の console error / pageerror 0 (想定内の 404 は件数を明示して除外)
//
// 使い方: bash run.sh check_as11_susp.mjs   終了コード: 0=全 PASS / 1=いずれか FAIL
import { launch, newPage, setLang, report, APP_URL } from './lib.mjs';

let pass = 0, fail = 0;
const ok = (label, cond, detail) => (report(label, cond, detail) ? pass++ : fail++);

const browser = await launch();
console.log(`\n== 実ブラウザ: サスペンション自由度 の到達性 (AS11) ==\n対象: ${APP_URL}\n`);
const { page, errors, benign } = await newPage(browser, { width: 1440, height: 900 });

const logText = () => page.locator('#log').innerText();

// ── T1: セレクタの実在・選択肢・既定 ────────────────────────────────────
{
  const uiOpts = await page.$$eval('#optSusp option', (os) => os.map((o) => o.value));
  const wl = await page.evaluate(async () => {
    const c = await import('./js/config.js');
    return { sets: c.SUSP_SETS, def: c.SUSP_DEFAULT, keys: Object.keys(c.SUSPS) };
  });
  ok('T1-a #optSusp の選択肢が配信 config の SUSP_SETS と一致', JSON.stringify(uiOpts) === JSON.stringify(wl.sets), `UI=${uiOpts} / config=${wl.sets}`);
  ok('T1-b SUSPS の定義キーと白リストが一致 (定義漏れ/白リスト漏れ 0)', JSON.stringify(wl.keys) === JSON.stringify(wl.sets), `SUSPS=${wl.keys}`);
  const v = await page.locator('#optSusp').inputValue();
  ok('T1-c 既定は quasi (=自由度なし=従来と同じ)', v === wl.def && v === 'quasi', `susp=${v}`);
}

// ── T2/T3: 選択のログが i18n で出る ──────────────────────────────────────
await setLang(page, 'ja');
{
  const before = await logText();
  await page.selectOption('#optSusp', 'soft');
  await page.waitForTimeout(300);
  const added = (await logText()).slice(before.length);
  ok('T2-a ソフトを選ぶと ja のログが出る', /サス.*ソフト/.test(added), `追加ログ="${added.trim().slice(0, 80)}"`);
}
{
  const before = await logText();
  await page.selectOption('#optSusp', 'quasi');
  await page.waitForTimeout(300);
  const added = (await logText()).slice(before.length);
  ok('T2-b 既定へ戻すと既定の文言が出る', /準静的/.test(added), `追加ログ="${added.trim().slice(0, 80)}"`);
}
await setLang(page, 'en');
await page.waitForTimeout(300);
{
  const before = await logText();
  await page.selectOption('#optSusp', 'stiff');
  await page.waitForTimeout(300);
  const added = (await logText()).slice(before.length);
  ok('T3 en でも英語の文言が出る (ja 固定文言でない)', /Suspension:\s*Stiff/i.test(added), `追加ログ="${added.trim().slice(0, 80)}"`);
}
await setLang(page, 'ja');
await page.selectOption('#optSusp', 'quasi');
await page.waitForTimeout(200);

// ── T4: 配信中のモジュールで物理が実際に変わる (法則＋対照) ─────────────────
{
  const probe = await page.evaluate(async () => {
    const [cfg, dyn, v2, crs, eng, prg] = await Promise.all([
      import('./js/config.js'), import('./js/physics_dyn.js'), import('./js/physics_v2.js'),
      import('./js/course.js'), import('./js/race_engine.js'), import('./js/programs.js'),
    ]);
    const DT = 1 / cfg.SIM.physicsHz;
    // (a) 自由応答の最初の負の極値 = ステップ応答の行き過ぎ Mp (閉形式 exp(−πζ/√(1−ζ²)))。
    //     初期撓みだけが実験の設定で、以降の発展は配信中の step() そのもの。
    const overshootOf = (key) => {
      dyn.applyRegime('tabletop');
      const c = new v2.CarV2({ x: 0, y: 0, theta: 0, grip: 1 });
      c.type = 'normal_fr'; c.suspSet = key;
      c.driveDir = cfg.CONST.FREE; c.pwm = 0; c._ayF = 1; c._ayFd = 0;
      let minv = 0;
      for (let i = 0; i < 600; i++) { c.step(DT); minv = Math.min(minv, c._ayF); }
      return -minv;
    };
    const mp = { soft: overshootOf('soft'), balanced: overshootOf('balanced'), stiff: overshootOf('stiff'), quasi: overshootOf('quasi') };
    const pred = (z) => (z < 1 ? Math.exp(-Math.PI * z / Math.sqrt(1 - z * z)) : 0);
    const mpPred = { soft: pred(cfg.SUSPS.soft.zeta), balanced: pred(cfg.SUSPS.balanced.zeta) };
    // (b) 定常一致: 定常旋回に達したあとの輪荷重が既定と厳密に同じ (変わるのは過渡だけ)。
    const steady = (key) => {
      dyn.applyRegime('tabletop');
      const c = new v2.CarV2({ x: 0, y: 0, theta: 0, grip: 1 });
      c.type = 'normal_fr'; c.suspSet = key;
      c.driveDir = cfg.CONST.FORWARD; c.pwm = 210; c.steer = cfg.CONST.LEFT;
      for (let i = 0; i < Math.round(24 / DT); i++) c.step(DT);
      return c._FzWheel.slice();
    };
    const ref = steady('quasi'), sft = steady('soft');
    const dFz = Math.max(...ref.map((v, i) => Math.abs(v - sft[i]) / Math.max(Math.abs(v), 1e-300)));
    // (c) 対照: 旧エンジン (dynamic) は装備を無視する = 軌跡が 1 tick も変わらない
    const specs = await fetch('./data/courses.json').then((r) => r.json());
    const course = crs.buildFromSpec(specs.find((c) => c.name === 'オーバル'));
    const p = prg.PROGRAMS.find((x) => x.key === 'normal_fr');
    const trace = (phys, extra) => eng.runRace({ course, laps: 2, physics: phys, trace: true,
      field: [{ name: 'A', lang: 'c', src: p.code, carType: 'normal_fr', ...extra }],
      crashRule: { rejoin: false, penaltySec: 3 } }).traceHash;
    const dynSame = trace(undefined, {}) === trace(undefined, { susp: 'soft' });
    const v2Diff = trace('v2', {}) !== trace('v2', { susp: 'soft' });
    dyn.applyRegime('tabletop');
    return { mp, mpPred, dFz, dynSame, v2Diff };
  });
  ok('T4-a 配信物の行き過ぎが閉形式 Mp=exp(−πζ/√(1−ζ²)) と一致 (soft)',
    Math.abs(probe.mp.soft - probe.mpPred.soft) / probe.mpPred.soft < 5e-3,
    `実測 ${(probe.mp.soft * 100).toFixed(3)}% / 予測 ${(probe.mpPred.soft * 100).toFixed(3)}%`);
  ok('T4-b 同 (balanced)', Math.abs(probe.mp.balanced - probe.mpPred.balanced) / probe.mpPred.balanced < 5e-3,
    `実測 ${(probe.mp.balanced * 100).toFixed(3)}% / 予測 ${(probe.mpPred.balanced * 100).toFixed(3)}%`);
  ok('T4-c 既定 (quasi) と臨界減衰 (stiff) は行き過ぎ 0', probe.mp.quasi === 0 && probe.mp.stiff === 0,
    `quasi=${probe.mp.quasi} stiff=${probe.mp.stiff}`);
  ok('T4-d 定常の輪荷重は既定と厳密一致 (変わるのは過渡だけ)', probe.dFz < 1e-9, `最大相対差 ${probe.dFz.toExponential(2)}`);
  ok('T4-e 対照: 旧エンジンは装備を無視 (軌跡 traceHash 完全一致)', probe.dynSame === true, `dynSame=${probe.dynSame}`);
  ok('T4-f v2 では装備が軌跡を変える', probe.v2Diff === true, `v2Diff=${probe.v2Diff}`);
}

// ── T5: HUD の刻印は非既定を選んだときだけ ──────────────────────────────
// 本番 drawFleetHud をそのまま呼び、fillText の実引数を記録して注記行を読む (AS1 T2 と同じ作法)。
{
  const hud = await page.evaluate(async () => {
    const h = await import('./js/hud.js');
    const texts = [];
    const ctx = new Proxy({}, {
      get(t, k) {
        if (k === 'fillText') return (s) => texts.push(String(s));
        if (k === 'measureText') return () => ({ width: 100 });
        if (['save', 'restore', 'fillRect', 'strokeRect', 'beginPath', 'arc', 'fill'].includes(k)) return () => {};
        return undefined;
      },
      set() { return true; },
    });
    const mkSlot = (susp) => ({ name: 'A', color: '#f00', running: false,
      lap: { laps: 0, lapTime: 0, bestLap: null, improved: false, bestRec: null },
      car: { crashed: false, engine: 'v2', tireSet: 'normal', gearSet: 'direct', suspSet: susp } });
    const view = { wPx: 1245, hPx: 700 };
    const run = (susp) => { texts.length = 0; h.drawFleetHud(ctx, [mkSlot(susp)], view, 0); return texts.join(''); };
    return { def: run('quasi'), soft: run('soft'), stiff: run('stiff') };
  });
  ok('T5-a 既定では装備の刻印が 1 文字も出ない', !/足/.test(hud.def), `注記に「足」を含まない`);
  ok('T5-b ソフト選択で HUD に刻印が出る', hud.soft !== hud.def && /ソフト足/.test(hud.soft), `刻印あり`);
  ok('T5-c ハード選択で HUD に刻印が出る', hud.stiff !== hud.def && /ハード足/.test(hud.stiff), `刻印あり`);
}

// ── T6: 共有 URL は非既定だけ載る＋リロードで復元 (AS9 申し送り② の通し経路) ──────
{
  await page.selectOption('#optSusp', 'quasi');
  await page.waitForTimeout(400);
  const hDef = await page.evaluate(() => location.hash);
  await page.selectOption('#optSusp', 'balanced');
  await page.waitForTimeout(400);
  const hEquip = await page.evaluate(() => location.hash);
  ok('T6-a 既定では hash に装備が載らない (非既定で載る)', hDef !== hEquip, `既定 hash 長=${hDef.length} / 装備 hash 長=${hEquip.length}`);
  const decoded = await page.evaluate(async (hash) => {
    const m = await import('./js/share.js').catch(() => null);
    return m && m.decodeState ? m.decodeState(hash) : null;
  }, hEquip);
  if (decoded) {
    ok('T6-b 非既定が hash へ載る (susp=balanced)', decoded.susp === 'balanced', `decoded.susp=${decoded.susp}`);
  } else {
    ok('T6-b 非既定が hash へ載る (decode 経路が無いため hash 差で確認)', hEquip.length > hDef.length, 'share.decodeState を解決できず hash 長で確認');
  }
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const v = await page.locator('#optSusp').inputValue();
  ok('T6-c 装備つき URL でリロードすると UI が復元される (捕捉/適用/リスナの3箇所が通っている)', v === 'balanced', `susp=${v}`);
}

// ── T7: 物理解説に項が配信されている ──────────────────────────────────────
{
  const has = await page.evaluate(() => {
    const el = document.querySelector('[data-i18n-html="pm.s11.susp"]');
    return el ? el.textContent.length : 0;
  });
  ok('T7 物理解説 (📖) に「サス自由度」の Q&A が配信されている', has > 100, `本文 ${has} 文字`);
}

// ── T8: エラー 0 ──────────────────────────────────────────────────────
ok('T8 操作中の console error / pageerror 0', errors.length === 0,
  `errors=${errors.length}${benign.length ? ` (想定内として除外した応答 ${benign.length} 件)` : ''}`);

await browser.close();
console.log(`\nAS11 実ブラウザ ゲート: PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
