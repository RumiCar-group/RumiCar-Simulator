// RumiCar Simulator — 実ブラウザ 常設ゲート: ToF 光学モデル (実機相当) の到達性 (Stage AS8)
//
// 背景 (決定ログ AS-8): 実機 VL53L0X が有効な測距を返すのは「標的から戻る信号レートがしきい値以上」の
//   ときだけ (上流ライブラリの setSignalRateLimit)。この判定原理を opt-in の決定論モデルとして実装した。
//   node 側の常設ゲート (wf_as8_optics.mjs) がモデルの法則を測るのに対し、ここでは
//   **「配信物の UI から実際に届くか」** だけを、利用者と同じ操作で測る。
//
// ここで測るもの (「トグルが効いているように見えるか」の目視の代わりになる測定述語):
//   T1 トグル (#optOptics) が配信中の UI に実在し、既定が OFF (=理想測距) であること
//   T2 ON にするとログに ja の説明が出る／OFF に戻すと OFF の文言が出る
//   T3 en でも英語の文言が出る (ja 固定文言でない)
//   T4 **配信中のモジュール**で readAll を呼び、ON/OFF で読値が実際に変わること
//      (=配信物が新モデルを含んでいる。config 既定 OFF では 1 件も変わらないことの対照つき)
//   T5 **公式レースは強制 OFF**: トグル ON のまま runRace しても verifyHash が OFF と一致
//   T6 操作中の console error / pageerror 0 (想定内の 404 は件数を明示して除外)
//
// 使い方: bash run.sh check_as8_optics.mjs   終了コード: 0=全 PASS / 1=いずれか FAIL
import { launch, newPage, setLang, report, APP_URL } from './lib.mjs';

let pass = 0, fail = 0;
const ok = (label, cond, detail) => (report(label, cond, detail) ? pass++ : fail++);

const browser = await launch();
console.log(`\n== 実ブラウザ: ToF 光学モデル (実機相当) の到達性 (AS8) ==\n対象: ${APP_URL}\n`);
const { page, errors, benign } = await newPage(browser, { width: 1440, height: 900 });

const logText = () => page.locator('#log').innerText();

// ── T1: トグルの実在と既定 OFF ────────────────────────────────────────────
const exists = await page.locator('#optOptics').count();
ok('T1-a トグル #optOptics が配信 UI に実在', exists === 1, `count=${exists}`);
const defOff = await page.locator('#optOptics').isChecked();
ok('T1-b 既定は OFF (理想測距)', defOff === false, `checked=${defOff}`);
const cfgOff = await page.evaluate(async () => (await import('./js/config.js')).SENSOR_OPTICS.on);
ok('T1-c 配信中の config でも SENSOR_OPTICS.on=false', cfgOff === false, `on=${cfgOff}`);

// ── T2/T3: ON/OFF のログが i18n で出る ────────────────────────────────────
await setLang(page, 'ja');
const b1 = await logText();
await page.locator('#optOptics').check();
await page.waitForTimeout(300);
const onJa = (await logText()).slice(b1.length);
ok('T2-a ON でログに ja の説明が出る', /光学モデル.*ON/.test(onJa), `追加ログ="${onJa.trim().slice(0, 80)}"`);
const b2 = await logText();
await page.locator('#optOptics').uncheck();
await page.waitForTimeout(300);
const offJa = (await logText()).slice(b2.length);
ok('T2-b OFF に戻すと OFF の文言が出る', /光学モデル.*OFF/.test(offJa), `追加ログ="${offJa.trim().slice(0, 80)}"`);

await setLang(page, 'en');
await page.waitForTimeout(300);
const b3 = await logText();
await page.locator('#optOptics').check();
await page.waitForTimeout(300);
const onEn = (await logText()).slice(b3.length);
ok('T3 en でも英語の文言が出る (ja 固定文言でない)', /optics model.*ON/i.test(onEn), `追加ログ="${onEn.trim().slice(0, 80)}"`);
await page.locator('#optOptics').uncheck();
await page.waitForTimeout(200);

// ── T4: 配信中のモジュールで読値が実際に変わる (対照つき) ───────────────────
const probe = await page.evaluate(async () => {
  const [cfg, sen, crs] = await Promise.all([
    import('./js/config.js'), import('./js/sensors.js'), import('./js/course.js'),
  ]);
  const specs = await fetch('./data/courses.json').then((r) => r.json());
  const course = crs.buildFromSpec(specs.find((c) => c.name === 'オーバル'));
  const prev = cfg.SENSOR_OPTICS.on;
  const scan = () => {
    const out = [];
    for (let i = 0; i < 360; i += 15) {
      const car = { x: course.start.x, y: course.start.y, theta: i * Math.PI / 180 };
      out.push(sen.readAll(car, course.walls, []).map((s) => s.mm).join(','));
    }
    return out.join('|');
  };
  cfg.SENSOR_OPTICS.on = false; const a = scan();
  // 対照: OFF のままサブフィールドを極端に振っても 1 件も変わらない (既定 OFF の完全縮退)
  const keep = { ...cfg.SENSOR_OPTICS };
  Object.assign(cfg.SENSOR_OPTICS, { rays: 3, wallRefl: 0.01, carRefl: 0.01, incidence: false, multipath: false, xtalk: 0.9 });
  const aPerturbed = scan();
  Object.assign(cfg.SENSOR_OPTICS, keep);
  cfg.SENSOR_OPTICS.on = true; const b = scan();
  cfg.SENSOR_OPTICS.on = prev;
  const diff = a.split('|').filter((row, i) => row !== b.split('|')[i]).length;
  return { same: a === b, offStable: a === aPerturbed, diffPoses: diff, poses: a.split('|').length };
});
ok('T4-a 配信物で ON/OFF の読値が実際に変わる', probe.same === false, `差の出た姿勢 ${probe.diffPoses}/${probe.poses}`);
ok('T4-b 対照: OFF ではサブフィールドを極端に振っても 1 件も変わらない', probe.offStable === true, `offStable=${probe.offStable}`);

// ── T5: 公式レースは強制 OFF ───────────────────────────────────────────────
const race = await page.evaluate(async () => {
  const [cfg, crs, eng, prg] = await Promise.all([
    import('./js/config.js'), import('./js/course.js'), import('./js/race_engine.js'), import('./js/programs.js'),
  ]);
  const specs = await fetch('./data/courses.json').then((r) => r.json());
  const course = crs.buildFromSpec(specs.find((c) => c.name === 'オーバル'));
  const field = ['normal_fr', 'normal_awd', 'normal_ff'].map((k, i) => {
    const p = prg.PROGRAMS.find((x) => x.key === k);
    return { name: ['A', 'B', 'C'][i], lang: 'c', src: p.code, carType: p.carType, rear: false, encoder: false };
  });
  const run = () => eng.runRace({ course, laps: 2, field, crashRule: { rejoin: false, penaltySec: 3 }, interact: true, report: true }).verifyHash;
  const prev = cfg.SENSOR_OPTICS.on;
  cfg.SENSOR_OPTICS.on = false; const h0 = run();
  cfg.SENSOR_OPTICS.on = true; const h1 = run();
  const restored = cfg.SENSOR_OPTICS.on;
  cfg.SENSOR_OPTICS.on = prev;
  return { h0, h1, restored };
});
ok('T5-a 公式レースは光学モデル ON/OFF で verifyHash が一致 (強制 OFF)', race.h0 === race.h1, `verifyHash=${race.h0}`);
ok('T5-b runRace 後に live のトグル状態が復元される', race.restored === true, `restored=${race.restored}`);

// ── T6: エラー 0 ──────────────────────────────────────────────────────────
ok('T6 操作中の console error / pageerror 0', errors.length === 0,
  `errors=${errors.length}${benign.length ? ` (想定内として除外した応答 ${benign.length} 件)` : ''}`);

await browser.close();
console.log(`\nAS8 実ブラウザ ゲート: PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
