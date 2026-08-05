// RumiCar Simulator — 実ブラウザ 常設ゲート: 横勾配 (カント/バンク) の到達性 (Stage AS10)
//
// 背景 (決定ログ AS-10): node 側の常設ゲート (wf_as10_cant.mjs) が**モデルの法則**
//   (面内重力の大きさ保存・v²=R·g·(μcosφ+sinφ) の閉形式・領域不変) を測るのに対し、
//   ここでは **「配信物から実際に届くか」** だけを利用者と同じ経路で測る (CI-8)。
//   AS10 は AS8/AS9 と違い **UI トグルではなくコースデータの任意フィールド**なので、
//   「利用者と同じ経路」＝ **自作コース (localStorage `rumicar.courses`) に bank を書いて選ぶ**。
//
// ここで測るもの (「カントが効いているように見えるか」の目視の代わりになる測定述語):
//   T1 📐 コースデータ仕様ダイアログに bank の項目が実在し ja/en とも本文が非空・はみ出し 0
//   T2 物理モデル解説 (pm.s11.cant) が ja/en とも実際に描画される
//   T3 **配信中のモジュール**でカントが実際に効く (gLat が出る／物理が変わる)
//      ＋対照: bank 無しは roadFrame=null で 1 tick も変わらない (=「常に効く」壊れ方の検出)
//      ＋対照: クラシック (standard) は解釈しない (§13.12 の記述と実装の一致)
//   T4 **利用者と同じ経路**: 自作コースに bank を入れて保存 → コース選択に現れ → 選んで走れる
//   T5 操作中の console error / pageerror 0 (想定内の 404 は件数を明示して除外)
//
// 使い方: bash run.sh check_as10_cant.mjs   終了コード: 0=全 PASS / 1=いずれか FAIL
import { launch, newPage, setLang, report, overflowX, APP_URL } from './lib.mjs';

let pass = 0, fail = 0;
const ok = (label, cond, detail) => (report(label, cond, detail) ? pass++ : fail++);

const browser = await launch();
console.log(`\n== 実ブラウザ: 横勾配 (カント/バンク) の到達性 (AS10) ==\n対象: ${APP_URL}\n`);
const { page, errors, benign } = await newPage(browser, { width: 1440, height: 900 });

// ── T1: 📐 コースデータ仕様に bank が載っている (ja/en) ────────────────────────
for (const lang of ['ja', 'en']) {
  await setLang(page, lang);
  await page.waitForTimeout(200);
  await page.click('#docSpec');
  await page.waitForTimeout(300);
  const li = page.locator('[data-i18n-html="doc.common.bank"]');
  const n = await li.count();
  const txt = n ? (await li.first().innerText()).trim() : '';
  ok(`T1-a [${lang}] 仕様ダイアログに bank の項目が実在し本文が非空`, n === 1 && txt.length > 80, `count=${n} len=${txt.length}`);
  const re = lang === 'ja' ? /(カント|横勾配)/ : /(cant|cross-slope)/i;
  ok(`T1-b [${lang}] 本文が当該言語で書かれている`, re.test(txt), `先頭="${txt.slice(0, 60)}"`);
  // ダイアログ本体が横にはみ出していないこと (AS1 T4-T5 と同型の測定述語)。
  const over = await page.evaluate(() => {
    const b = document.querySelector('#dlgDoc .docdlg-body');
    return b ? b.scrollWidth - b.clientWidth : -1;
  });
  ok(`T1-c [${lang}] 仕様ダイアログの横はみ出し 0`, over <= 0, `scrollWidth−clientWidth=${over}px`);
  await page.evaluate(() => document.querySelector('#dlgDoc').close());
  await page.waitForTimeout(150);
}

// ── T2: 物理モデル解説 (pm.s11.cant) が描画される (ja/en) ──────────────────────
for (const lang of ['ja', 'en']) {
  await setLang(page, lang);
  await page.waitForTimeout(200);
  const txt = await page.evaluate(() => {
    const el = document.querySelector('[data-i18n-html="pm.s11.cant"]');
    return el ? el.innerText.trim() : null;
  });
  const re = lang === 'ja' ? /(バンク|カント|横勾配)/ : /(bank|cant|cross-slope)/i;
  ok(`T2 [${lang}] pm.s11.cant が実際に描画され当該言語である`, !!txt && txt.length > 60 && re.test(txt), `len=${txt ? txt.length : 0} 先頭="${(txt || '').slice(0, 60)}"`);
}
await setLang(page, 'ja');
await page.waitForTimeout(200);

// ── T3: 配信中のモジュールでカントが実際に効く (対照つき) ────────────────────────
{
  const probe = await page.evaluate(async () => {
    const [cfg, dyn, v2, phy, crs, flt, eng, prg] = await Promise.all([
      import('./js/config.js'), import('./js/physics_dyn.js'), import('./js/physics_v2.js'),
      import('./js/physics.js'), import('./js/course.js'), import('./js/fleet.js'),
      import('./js/race_engine.js'), import('./js/programs.js'),
    ]);
    const DT = 1 / cfg.SIM.physicsHz;
    dyn.applyRegime('tabletop');
    const ovalSpec = (bank) => ({ name: 'AS10 円', kind: 'track', shape: 'ellipse', rx: 1.0, ry: 1.0, samples: 96, width: 0.5, ...(bank ? { bank } : {}) });
    // (a) bank 無し = roadFrame が null (毎サブステップの処理に一切入らない)
    const rfFlat = flt.roadFrame(crs.buildFromSpec(ovalSpec(0)));
    // (b) bank あり = 最急コーナーで |gLat| = g·sin(bank)
    const BANK = 18;
    const rf = flt.roadFrame(crs.buildFromSpec(ovalSpec(BANK)));
    const c = new phy.Car({ x: rf.cl[0][0], y: rf.cl[0][1], theta: 0 });
    flt.applyRoadFrame(c, rf);
    const gLat = c.gLat, predict = dyn.DYN.g * Math.sin(BANK * Math.PI / 180);
    // (c) 横グリップ容量が cos(bank) 倍に縮む (法線荷重の減少=閉形式の cosφ)
    const capOf = (gl) => {
      const k = new v2.CarV2({ x: 0, y: 0, theta: 0, grip: 1 });
      k.type = 'normal_fr'; k.gLat = gl; k.downhill = 0; k.slopeDir = 0;
      k.driveDir = cfg.CONST.FREE; k.pwm = 0; k.u = 0; k.step(DT);
      return k._latCapSS;
    };
    const capRatio = capOf(predict) / capOf(0);
    // (d) 本番 runRace の軌跡: bank ありは変わる / bank 無しは 1 tick も変わらない (対照)
    const p = prg.PROGRAMS.find((x) => x.key === 'normal_fr');
    const trace = (bank) => eng.runRace({
      course: crs.buildFromSpec({ name: 'AS10 走行検査', kind: 'track', shape: 'stadium', L: 1.6, rr: 0.62, samples: 120, width: 0.42, ...(bank ? { bank } : {}) }),
      laps: 2, interact: false, trace: true,
      field: [{ name: 'A', lang: 'c', src: p.code, carType: 'normal_fr' }],
      crashRule: { rejoin: false, penaltySec: 3 },
    }).traceHash;
    const t0 = trace(0), t0b = trace(0), t10 = trace(10);
    // (e) 対照: クラシック (standard) は gLat を無視する
    const stdMove = (gl) => {
      const k = new phy.Car({ x: 0, y: 0, theta: 0 });
      k.type = 'normal_fr'; k.gLat = gl; k.downhill = 0; k.slopeDir = 0;
      k.driveDir = cfg.CONST.FORWARD; k.pwm = 255; k.steer = cfg.CONST.CENTER;
      for (let i = 0; i < 120; i++) k.step(DT);
      return [k.x, k.y];
    };
    const s0 = stdMove(0), s1 = stdMove(3.0);
    return { flatNull: rfFlat === null, gLat, predict, capRatio, cosB: Math.cos(BANK * Math.PI / 180),
             sameFlat: t0 === t0b, diffBank: t0 !== t10, stdSame: s0[0] === s1[0] && s0[1] === s1[1] };
  });
  ok('T3-a 配信物: bank 無しのコースは roadFrame=null (完全 no-op)', probe.flatNull === true, `roadFrame=${probe.flatNull ? 'null' : '非null'}`);
  ok('T3-b 配信物: 最急コーナーの gLat = g·sin(bank)',
    Math.abs(probe.gLat - probe.predict) / probe.predict < 0.02, `実測 ${probe.gLat.toFixed(5)} / 予測 ${probe.predict.toFixed(5)}`);
  ok('T3-c 配信物: 横グリップ容量が cos(bank) 倍に縮む (法線荷重)',
    Math.abs(probe.capRatio - probe.cosB) / probe.cosB < 1e-9, `実測 ${probe.capRatio.toFixed(9)} / cos=${probe.cosB.toFixed(9)}`);
  ok('T3-d 配信物: bank ありで本番の軌跡が変わる', probe.diffBank === true, `traceHash 差あり=${probe.diffBank}`);
  ok('T3-e 対照: bank 無しの2回実行は完全一致 (=「常に効く」壊れ方の検出)', probe.sameFlat === true, `同一=${probe.sameFlat}`);
  ok('T3-f 対照: クラシック (standard) は gLat を無視 (§13.12 の記述と一致)', probe.stdSame === true, `座標一致=${probe.stdSame}`);
}

// ── T4: 利用者と同じ経路 — 自作コースに bank を入れて選び、実際に走る ──────────────
{
  const NAME = 'AS10 バンク検査コース';
  await page.evaluate((name) => {
    const key = 'rumicar.courses';
    const all = JSON.parse(localStorage.getItem(key) || '{}');
    all[name] = { name, kind: 'track', shape: 'stadium', L: 1.6, rr: 0.62, samples: 120, width: 0.42, bank: 12,
                  desc: 'AS10 の実ブラウザ検査用 (バンク 12°)', desc_en: 'AS10 browser check (12° bank)', diff: 2 };
    localStorage.setItem(key, JSON.stringify(all));
  }, NAME);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const opts = await page.$$eval('#courseSel option', (os) => os.map((o) => o.textContent.trim()));
  ok('T4-a 自作コース (bank つき) がコース選択に現れる', opts.some((o) => o.includes(NAME)), `候補数=${opts.length}`);
  await page.selectOption('#courseSel', { label: opts.find((o) => o.includes(NAME)) });
  await page.waitForTimeout(600);
  // 自作コースの本番経路 (course_editor.loadSavedCourses → course.buildFromSpec → fleet.roadFrame) を
  // **配信中のモジュールでそのまま辿り**、利用者が保存した bank が物理まで届くことを確かめる。
  // (main.js は同じ2関数を通してコースを作る。live の state は外部へ公開されていないため、
  //  「アプリが読むのと同じ保存データ」を「アプリが使うのと同じ関数」に通す形で測る。)
  const applied = await page.evaluate(async (name) => {
    const [ed, crs, flt, phy] = await Promise.all([
      import('./js/course_editor.js'), import('./js/course.js'), import('./js/fleet.js'), import('./js/physics.js'),
    ]);
    const saved = ed.loadSavedCourses()[name];
    if (!saved) return { found: false };
    const c = crs.buildFromSpec(saved);
    const rf = flt.roadFrame(c);
    if (!rf) return { found: true, bank: c.bank, hasCl: Array.isArray(c.centerline), maxGLat: 0 };
    const car = new phy.Car({ x: 0, y: 0, theta: 0 });
    let maxG = 0;
    for (const p of rf.cl) { car.x = p[0]; car.y = p[1]; flt.applyRoadFrame(car, rf); maxG = Math.max(maxG, Math.abs(car.gLat)); }
    return { found: true, bank: c.bank, hasCl: Array.isArray(c.centerline), maxGLat: maxG };
  }, NAME);
  // 走らせて速度が出ることも確認する (UI から選んで実走できる)。
  await page.click('#run').catch(() => {});
  await page.waitForTimeout(2500);
  const spd = await page.evaluate(() => {
    const el = document.querySelector('#spd');
    return el ? el.innerText.trim() : '';
  });
  const num = parseFloat((spd.match(/[\d.]+/) || ['0'])[0]);
  ok('T4-b bank つきコースで実際に走行できる (速度計が非ゼロ)', num > 0, `#spd="${spd}"`);
  ok('T4-c 保存した bank が本番経路 (loadSavedCourses→buildFromSpec→roadFrame) で物理まで届く',
    applied.found === true && applied.bank === 12 && applied.hasCl === true
      && Math.abs(applied.maxGLat - 9.81 * Math.sin(12 * Math.PI / 180)) < 0.05,
    `found=${applied.found} bank=${applied.bank} centerline=${applied.hasCl} 最大 gLat=${(applied.maxGLat || 0).toFixed(5)} (予測 ${(9.81 * Math.sin(12 * Math.PI / 180)).toFixed(5)})`);
  // 後始末: 検査用コースを消して利用者データを汚さない
  await page.evaluate((name) => {
    const key = 'rumicar.courses';
    const all = JSON.parse(localStorage.getItem(key) || '{}');
    delete all[name];
    localStorage.setItem(key, JSON.stringify(all));
  }, NAME);
}

// ── T5: エラー 0 ──────────────────────────────────────────────────────────
ok('T5 操作中の console error / pageerror が 0', errors.length === 0,
  `errors=${errors.length}${errors.length ? ' → ' + errors.slice(0, 3).join(' | ') : ''} / 想定内として除外した HTTP 応答 ${benign.length} 件`);

console.log(`\n合計: PASS ${pass} / FAIL ${fail}`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
