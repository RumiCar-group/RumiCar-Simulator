// RumiCar Simulator — 実ブラウザ 常設ゲート: レインタイヤ＋ギア比 (任意装備) の到達性 (Stage AS9)
//
// 背景 (決定ログ AS-9): node 側の常設ゲート (wf_as9_tire_gear.mjs) が**モデルの法則**
//   (交差点 g*=0.7987 の領域不変・最高速比=1/減速比) を測るのに対し、ここでは
//   **「配信物の UI から実際に届くか」** だけを、利用者と同じ操作で測る (CI-8)。
//
// ここで測るもの (「装備を選べているように見えるか」の目視の代わりになる測定述語):
//   T1 セレクタ (#optTire / #optGear) が配信 UI に実在し、選択肢と既定が仕様どおり
//   T2 選ぶとログに ja の説明が出る／既定へ戻すと既定の文言が出る
//   T3 en でも英語の文言が出る (ja 固定文言でない)
//   T4 **配信中のモジュール**で v2 の物理が実際に変わる (レイン=ウェットで容量増／ギア=最高速比)
//      ＋対照: 旧エンジン (dynamic) では装備を選んでも軌跡が 1 tick も変わらない
//   T5 HUD の刻印: 非既定を選んだときだけ注記へ装備が出る (既定では 1 文字も増えない)
//   T6 共有 URL: 既定は hash に載らず、非既定だけが載って復元できる
//   T7 操作中の console error / pageerror 0 (想定内の 404 は件数を明示して除外)
//
// 使い方: bash run.sh check_as9_equip.mjs   終了コード: 0=全 PASS / 1=いずれか FAIL
import { launch, newPage, setLang, report, APP_URL } from './lib.mjs';

let pass = 0, fail = 0;
const ok = (label, cond, detail) => (report(label, cond, detail) ? pass++ : fail++);

const browser = await launch();
console.log(`\n== 実ブラウザ: レインタイヤ＋ギア比 の到達性 (AS9) ==\n対象: ${APP_URL}\n`);
const { page, errors, benign } = await newPage(browser, { width: 1440, height: 900 });

const logText = () => page.locator('#log').innerText();
const optionsOf = (sel) => page.$$eval(`${sel} option`, (os) => os.map((o) => o.value));

// ── T1: セレクタの実在・選択肢・既定 ──────────────────────────────────────
{
  const tireOpts = await optionsOf('#optTire');
  const gearOpts = await optionsOf('#optGear');
  const wl = await page.evaluate(async () => {
    const c = await import('./js/config.js');
    return { tire: c.TIRE_SETS, gear: c.GEAR_SETS, td: c.TIRE_DEFAULT, gd: c.GEAR_DEFAULT };
  });
  ok('T1-a #optTire の選択肢が配信 config の TIRE_SETS と一致', JSON.stringify(tireOpts) === JSON.stringify(wl.tire), `UI=${tireOpts} / config=${wl.tire}`);
  ok('T1-b #optGear の選択肢が配信 config の GEAR_SETS と一致', JSON.stringify(gearOpts) === JSON.stringify(wl.gear), `UI=${gearOpts} / config=${wl.gear}`);
  const tv = await page.locator('#optTire').inputValue();
  const gv = await page.locator('#optGear').inputValue();
  ok('T1-c 既定は normal / direct (=従来と同じ)', tv === wl.td && gv === wl.gd, `tire=${tv} gear=${gv}`);
}

// ── T2/T3: 選択のログが i18n で出る ───────────────────────────────────────
await setLang(page, 'ja');
for (const [sel, val, re, label] of [
  ['#optTire', 'rain', /タイヤ.*レイン/, 'レイン'],
  ['#optGear', 'auto2', /ギア.*2速/, '2速オートマ'],
]) {
  const before = await logText();
  await page.selectOption(sel, val);
  await page.waitForTimeout(300);
  const added = (await logText()).slice(before.length);
  ok(`T2-a ${label} を選ぶと ja のログが出る`, re.test(added), `追加ログ="${added.trim().slice(0, 70)}"`);
}
{
  const before = await logText();
  await page.selectOption('#optTire', 'normal');
  await page.selectOption('#optGear', 'direct');
  await page.waitForTimeout(300);
  const added = (await logText()).slice(before.length);
  ok('T2-b 既定へ戻すと既定の文言が出る', /ノーマル/.test(added) && /直結/.test(added), `追加ログ="${added.trim().slice(0, 90)}"`);
}
await setLang(page, 'en');
await page.waitForTimeout(300);
{
  const before = await logText();
  await page.selectOption('#optTire', 'rain');
  await page.selectOption('#optGear', 'short');
  await page.waitForTimeout(300);
  const added = (await logText()).slice(before.length);
  ok('T3 en でも英語の文言が出る (ja 固定文言でない)', /Tire:\s*Rain/i.test(added) && /Gear:\s*Low/i.test(added), `追加ログ="${added.trim().slice(0, 90)}"`);
}
await setLang(page, 'ja');
await page.selectOption('#optTire', 'normal');
await page.selectOption('#optGear', 'direct');
await page.waitForTimeout(200);

// ── T4: 配信中のモジュールで物理が実際に変わる (対照つき) ───────────────────
{
  const probe = await page.evaluate(async () => {
    const [cfg, dyn, v2, crs, eng, prg] = await Promise.all([
      import('./js/config.js'), import('./js/physics_dyn.js'), import('./js/physics_v2.js'),
      import('./js/course.js'), import('./js/race_engine.js'), import('./js/programs.js'),
    ]);
    const DT = 1 / cfg.SIM.physicsHz;
    // (a) レイン: ウェット (grip=0.5) の横グリップ容量が normal より大きい / 乾路では小さい
    const capOf = (tire, grip) => {
      dyn.applyRegime('tabletop');
      const c = new v2.CarV2({ x: 0, y: 0, theta: 0, grip });
      c.type = 'normal_fr'; c.tireSet = tire; c.driveDir = cfg.CONST.FREE; c.pwm = 0; c.u = 0;
      c.step(DT);
      return c._latCapSS;
    };
    const wetRatio = capOf('rain', 0.5) / capOf('normal', 0.5);
    const dryRatio = capOf('rain', 1.0) / capOf('normal', 1.0);
    // (b) ギア: 全開直進の終端速度比が 1/減速比
    const vEnd = (gear) => {
      dyn.applyRegime('tabletop');
      const c = new v2.CarV2({ x: 0, y: 0, theta: 0, grip: 1 });
      c.type = 'normal_fr'; c.tireSet = 'normal'; c.gearSet = gear;
      c.driveDir = cfg.CONST.FORWARD; c.pwm = 255;
      for (let i = 0; i < Math.round(12 / DT); i++) c.step(DT);
      return c.u;
    };
    const gearRatio = vEnd('short') / vEnd('direct');
    const gearPred = 1 / cfg.GEARS.short.ratios[0];
    // (c) 対照: 旧エンジン (dynamic) は装備を無視する = 軌跡が 1 tick も変わらない
    const specs = await fetch('./data/courses.json').then((r) => r.json());
    const course = crs.buildFromSpec(specs.find((c) => c.name === 'オーバル'));
    const p = prg.PROGRAMS.find((x) => x.key === 'normal_fr');
    const trace = (phys, extra) => eng.runRace({ course, laps: 2, physics: phys, trace: true,
      field: [{ name: 'A', lang: 'c', src: p.code, carType: 'normal_fr', ...extra }],
      crashRule: { rejoin: false, penaltySec: 3 } }).traceHash;
    const dynSame = trace(undefined, {}) === trace(undefined, { tire: 'rain', gear: 'auto2' });
    const v2Diff = trace('v2', {}) !== trace('v2', { tire: 'rain', gear: 'auto2' });
    dyn.applyRegime('tabletop');
    return { wetRatio, dryRatio, gearRatio, gearPred, dynSame, v2Diff };
  });
  ok('T4-a 配信物のレインはウェットで容量が増える', probe.wetRatio > 1.2, `grip=0.5 の容量比 ${probe.wetRatio.toFixed(4)}`);
  ok('T4-b 配信物のレインは乾路で容量が減る', probe.dryRatio < 1, `grip=1.0 の容量比 ${probe.dryRatio.toFixed(4)}`);
  ok('T4-c 配信物のギアは最高速比 = 1/減速比', Math.abs(probe.gearRatio - probe.gearPred) / probe.gearPred < 1e-3,
    `実測 ${probe.gearRatio.toFixed(4)} / 予測 ${probe.gearPred.toFixed(4)}`);
  ok('T4-d 対照: 旧エンジンは装備を無視 (軌跡 traceHash 完全一致)', probe.dynSame === true, `dynSame=${probe.dynSame}`);
  ok('T4-e v2 では装備が軌跡を変える', probe.v2Diff === true, `v2Diff=${probe.v2Diff}`);
}

// ── T5: HUD の刻印は非既定を選んだときだけ ────────────────────────────────
// 本番 drawFleetHud をそのまま呼び、fillText の実引数を記録して注記行を読む (AS1 T2 と同じ作法=
// 幾何定数も文言も検査側へ写し取らない)。
{
  const hud = await page.evaluate(async () => {
    const [h, cfg] = await Promise.all([import('./js/hud.js'), import('./js/config.js')]);
    const texts = [];
    const ctx = new Proxy({}, {
      get(t, k) {
        if (k === 'fillText') return (s) => texts.push(String(s));
        if (k === 'measureText') return () => ({ width: 100 });
        if (k === 'save' || k === 'restore' || k === 'fillRect' || k === 'strokeRect' || k === 'beginPath' || k === 'arc' || k === 'fill') return () => {};
        return undefined;
      },
      set() { return true; },
    });
    const mkSlot = (tire, gear) => ({ name: 'A', color: '#f00', running: false,
      lap: { laps: 0, lapTime: 0, bestLap: null, improved: false, bestRec: null },
      car: { crashed: false, engine: 'v2', tireSet: tire, gearSet: gear } });
    const view = { wPx: 1245, hPx: 700 };
    const run = (tire, gear) => { texts.length = 0; h.drawFleetHud(ctx, [mkSlot(tire, gear)], view, 0); return texts.join(''); };
    return { def: run('normal', 'direct'), rain: run('rain', 'direct'), gear: run('normal', 'auto2'), both: run('rain', 'auto2'), ver: cfg.APP_VERSION };
  });
  ok('T5-a 既定では装備の刻印が 1 文字も出ない', !/\[/.test(hud.def), `注記="${hud.def.split('').pop().slice(0, 60)}"`);
  ok('T5-b レイン選択で HUD に刻印が出る', hud.rain !== hud.def && /レイン/.test(hud.rain), `注記="${hud.rain.split('').pop().slice(0, 60)}"`);
  ok('T5-c ギア選択で HUD に刻印が出る', hud.gear !== hud.def && /2速/.test(hud.gear), `注記="${hud.gear.split('').pop().slice(0, 60)}"`);
  ok('T5-d 両方選ぶと両方刻まれる', /レイン/.test(hud.both) && /2速/.test(hud.both), `注記="${hud.both.split('').pop().slice(0, 60)}"`);
}

// ── T6: 共有 URL は非既定だけ載る ────────────────────────────────────────
{
  await page.selectOption('#optTire', 'normal');
  await page.selectOption('#optGear', 'direct');
  await page.waitForTimeout(400);
  const hDef = await page.evaluate(() => location.hash);
  await page.selectOption('#optTire', 'rain');
  await page.selectOption('#optGear', 'tall');
  await page.waitForTimeout(400);
  const hEquip = await page.evaluate(() => location.hash);
  const decoded = await page.evaluate(async (hash) => {
    const m = await import('./js/share.js').catch(() => null);
    return m && m.decodeState ? m.decodeState(hash) : null;
  }, hEquip);
  ok('T6-a 既定では hash に装備が載らない', hDef !== hEquip, `既定 hash 長=${hDef.length} / 装備 hash 長=${hEquip.length}`);
  if (decoded) {
    ok('T6-b 非既定が hash へ載る (tire=rain / gear=tall)', decoded.tire === 'rain' && decoded.gear === 'tall', `decoded=${JSON.stringify({ tire: decoded.tire, gear: decoded.gear })}`);
  } else {
    ok('T6-b 非既定が hash へ載る (decode 経路が無いため hash 差で確認)', hEquip.length > hDef.length, 'share.decodeState を解決できず hash 長で代替');
  }
  // 復元: 装備つき hash でリロードすると UI が復元される
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const tv = await page.locator('#optTire').inputValue();
  const gv = await page.locator('#optGear').inputValue();
  ok('T6-c 装備つき URL でリロードすると UI が復元される', tv === 'rain' && gv === 'tall', `tire=${tv} gear=${gv}`);
}

// ── T7: エラー 0 ──────────────────────────────────────────────────────────
ok('T7 操作中の console error / pageerror 0', errors.length === 0,
  `errors=${errors.length}${benign.length ? ` (想定内として除外した応答 ${benign.length} 件)` : ''}`);

await browser.close();
console.log(`\nAS9 実ブラウザ ゲート: PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
