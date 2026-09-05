// RumiCar Simulator — 実ブラウザ 常設ゲート: ルーズ路面 (掘り込み項) の到達性 (Stage AV1)
//
// 背景: node 側の常設ゲート (wf_av1_loose.mjs) が**モデルの法則**(散逸性・摩擦円・σ 比例＋
//   クランプ・ピーク移動・領域不変)と**効果**(go/no-go)を測るのに対し、ここでは
//   **「配信物から実際に届くか」** だけを利用者と同じ経路で測る (CI-8)。
//   AV1 は AS10 と同じく **UI トグルではなくコースデータの任意フィールド**なので、
//   「利用者と同じ経路」＝ **自作コース (localStorage `rumicar.courses`) に surface を書いて選ぶ**。
//
// ここで測るもの:
//   T1 📐 コースデータ仕様ダイアログに surface / muDecay の項目が実在し ja/en とも本文が非空・はみ出し 0
//   T2 物理モデル解説 (pm.s11.loose) が ja/en とも実際に描画される
//   T3 **配信中のモジュール**で掘り込みが実際に効く (曲線・摩擦円・軌跡)
//      ＋対照: surface 無しは 1 tick も変わらない (=「常に効く」壊れ方の検出)
//      ＋対照: dynamic / classic は解釈しない (§13.15 の記述と実装の一致)
//   T4 **利用者と同じ経路**: 自作コースに surface を入れて保存 → コース選択に現れ → 選んで走れる
//   T5 操作中の console error / pageerror 0 (想定内の 404 は件数を明示して除外)
//
// 使い方: bash run.sh check_av1_loose.mjs   終了コード: 0=全 PASS / 1=いずれか FAIL
import { launch, newPage, setLang, report, APP_URL } from './lib.mjs';

let pass = 0, fail = 0;
const ok = (label, cond, detail) => (report(label, cond, detail) ? pass++ : fail++);

const browser = await launch();
console.log(`\n== 実ブラウザ: ルーズ路面 (掘り込み項) の到達性 (AV1) ==\n対象: ${APP_URL}\n`);
const { page, errors, benign } = await newPage(browser, { width: 1440, height: 900 });

// ── T1: 📐 コースデータ仕様に surface / muDecay が載っている (ja/en) ──────────────
for (const lang of ['ja', 'en']) {
  await setLang(page, lang);
  await page.waitForTimeout(200);
  await page.click('#docSpec');
  await page.waitForTimeout(300);
  for (const [key, reJa, reEn] of [['doc.common.surface', /(ルーズ|路面種別|掘り込み)/, /(loose|surface type|digging)/i],
                                   ['doc.common.muDecay', /(ピーク後|粘り)/, /(post-peak|persistence)/i]]) {
    const li = page.locator(`[data-i18n-html="${key}"]`);
    const n = await li.count();
    const txt = n ? (await li.first().innerText()).trim() : '';
    ok(`T1-a [${lang}] 仕様ダイアログに ${key} が実在し本文が非空`, n === 1 && txt.length > 80, `count=${n} len=${txt.length}`);
    ok(`T1-b [${lang}] ${key} の本文が当該言語で書かれている`, (lang === 'ja' ? reJa : reEn).test(txt), `先頭="${txt.slice(0, 60)}"`);
  }
  const over = await page.evaluate(() => {
    const b = document.querySelector('#dlgDoc .docdlg-body');
    return b ? b.scrollWidth - b.clientWidth : -1;
  });
  ok(`T1-c [${lang}] 仕様ダイアログの横はみ出し 0`, over <= 0, `scrollWidth−clientWidth=${over}px`);
  await page.evaluate(() => document.querySelector('#dlgDoc').close());
  await page.waitForTimeout(150);
}

// ── T2: 物理モデル解説 (pm.s11.loose) が描画される (ja/en) ────────────────────────
for (const lang of ['ja', 'en']) {
  await setLang(page, lang);
  await page.waitForTimeout(200);
  const txt = await page.evaluate(() => {
    const el = document.querySelector('[data-i18n-html="pm.s11.loose"]');
    return el ? el.innerText.trim() : null;
  });
  const re = lang === 'ja' ? /(ルーズ|掘り込み|路面種別)/ : /(loose|digging|surface type)/i;
  ok(`T2 [${lang}] pm.s11.loose が実際に描画され当該言語である`, !!txt && txt.length > 60 && re.test(txt), `len=${txt ? txt.length : 0} 先頭="${(txt || '').slice(0, 60)}"`);
}
await setLang(page, 'ja');
await page.waitForTimeout(200);

// ── T3: 配信中のモジュールで掘り込みが実際に効く (対照つき) ────────────────────────
{
  const probe = await page.evaluate(async () => {
    const [cfg, dyn, v2, phy, crs, eng, prg] = await Promise.all([
      import('./js/config.js'), import('./js/physics_dyn.js'), import('./js/physics_v2.js'),
      import('./js/physics.js'), import('./js/course.js'),
      import('./js/race_engine.js'), import('./js/programs.js'),
    ]);
    const DT = 1 / cfg.SIM.physicsHz;
    dyn.applyRegime('fullscale');
    const T = v2.tireParamsFor('normal');
    const L = v2.surfaceParamsFor('loose');
    const cb = v2.mfCoeffs(T.muDecay);
    // (a) 曲線: σ=3 の |F|/μFz が舗装 g(3) → ルーズ g(3)+dig（掘り込みは σ 比例＋クランプ）
    const muFz = 12, ta = 3 * T.alphaP;
    const mag = (dig) => { const F = v2.tireForceMF(0, ta, muFz, cb.C, cb.Bp, T.kappaP, T.alphaP, dig); return Math.hypot(F.fx, F.fy) / muFz; };
    const gP = mag(null), gL = mag(L), want = gP + L.dig;
    // (b) 摩擦円: 大 σ でも |F| ≤ μ_eff·Fz（クランプが効いている）
    const big = v2.tireForceMF(0, 40 * T.alphaP, muFz, cb.C, cb.Bp, T.kappaP, T.alphaP, L);
    const fcOK = Math.hypot(big.fx, big.fy) <= muFz * (1 + L.dig) * (1 + 1e-12);
    // (c) 解決規則: 未指定/paved/未知値 は null（掘り込みなし）
    const resolveOK = [undefined, null, 'paved', 'bogus'].every((v) => v2.surfaceParamsFor(v) === null) && !!L;
    // (d) 本番 runRace の軌跡: loose は変わる / surface 無しは 1 tick も変わらない (対照)
    const p = prg.PROGRAMS.find((x) => x.key === 'normal_fr');
    const trace = (sf) => eng.runRace({
      course: crs.buildFromSpec({ name: 'AV1 走行検査', kind: 'track', shape: 'stadium', L: 1.6, rr: 0.62, samples: 120, width: 0.42, grip: 0.6, ...(sf ? { surface: sf } : {}) }),
      laps: 2, interact: false, trace: true, physics: 'v2',
      field: [{ name: 'A', lang: 'c', src: p.code, carType: 'normal_fr' }],
      crashRule: { rejoin: false, penaltySec: 3 },
    }).traceHash;
    const t0 = trace(null), t0b = trace(null), tP = trace('paved'), tL = trace('loose');
    // (e) 対照: dynamic / classic は surface を無視する
    const move = (Klass, sf) => {
      const c = crs.buildFromSpec({ name: 'x', kind: 'track', shape: 'stadium', L: 1.6, rr: 0.62, samples: 120, width: 0.42, grip: 0.6, ...(sf ? { surface: sf } : {}) });
      const k = new Klass({ ...c.start, x: 0, y: 0, theta: 0 });
      k.type = 'normal_fr'; k.driveDir = cfg.CONST.FORWARD; k.pwm = 255; k.steer = cfg.CONST.LEFT;
      for (let i = 0; i < 400; i++) k.step(DT);
      return [k.x, k.y, k.theta];
    };
    const same = (a, b) => a.every((v, i) => Object.is(v, b[i]));
    return { gP, gL, want, fcOK, resolveOK, sameNone: t0 === t0b, samePaved: t0 === tP, diffLoose: t0 !== tL,
             dynSame: same(move(dyn.DynCar, null), move(dyn.DynCar, 'loose')),
             stdSame: same(move(phy.Car, null), move(phy.Car, 'loose')),
             v2Diff: !same(move(v2.CarV2, null), move(v2.CarV2, 'loose')) };
  });
  ok('T3-a 配信物: 未指定/paved/未知値 は掘り込みなし (解決規則)', probe.resolveOK === true, `resolve=${probe.resolveOK}`);
  ok('T3-b 配信物: σ=3 の |F|/μFz が 舗装+dig になる (σ 比例＋クランプ)',
    Math.abs(probe.gL - probe.want) < 1e-12, `舗装 ${probe.gP.toFixed(6)} → ルーズ ${probe.gL.toFixed(6)} (予測 ${probe.want.toFixed(6)})`);
  ok('T3-c 配信物: 大スリップでも |F| ≤ μ_eff·Fz (摩擦円が破れない)', probe.fcOK === true, `摩擦円=${probe.fcOK}`);
  ok('T3-d 配信物: surface:"loose" で本番の軌跡が変わる', probe.diffLoose === true, `traceHash 差あり=${probe.diffLoose}`);
  ok('T3-e 対照: surface 無しの2回実行は完全一致 (=「常に効く」壊れ方の検出)', probe.sameNone === true, `同一=${probe.sameNone}`);
  ok('T3-f 対照: surface:"paved" は surface 無しと traceHash が一致 (既定縮退)', probe.samePaved === true, `同一=${probe.samePaved}`);
  ok('T3-g 対照: dynamic は surface を無視 (§13.15 の記述と一致)', probe.dynSame === true, `座標一致=${probe.dynSame}`);
  ok('T3-h 対照: classic は surface を無視 (§13.15 の記述と一致)', probe.stdSame === true, `座標一致=${probe.stdSame}`);
  ok('T3-i 対照: v2 だけは動く (=「どのエンジンも無視する」壊れ方の検出)', probe.v2Diff === true, `座標差あり=${probe.v2Diff}`);
}

// ── T4: 利用者と同じ経路 — 自作コースに surface を入れて選び、実際に走る ──────────────
{
  const NAME = 'AV1 ルーズ路面検査コース';
  await page.evaluate((name) => {
    const key = 'rumicar.courses';
    const all = JSON.parse(localStorage.getItem(key) || '{}');
    all[name] = { name, kind: 'track', shape: 'stadium', L: 1.6, rr: 0.62, samples: 120, width: 0.42,
                  grip: 0.6, surface: 'loose',
                  desc: 'AV1 の実ブラウザ検査用 (ルーズ路面)', desc_en: 'AV1 browser check (loose surface)', diff: 2 };
    localStorage.setItem(key, JSON.stringify(all));
  }, NAME);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const opts = await page.$$eval('#courseSel option', (os) => os.map((o) => o.textContent.trim()));
  ok('T4-a 自作コース (surface つき) がコース選択に現れる', opts.some((o) => o.includes(NAME)), `候補数=${opts.length}`);
  await page.selectOption('#courseSel', { label: opts.find((o) => o.includes(NAME)) });
  await page.waitForTimeout(600);
  // 自作コースの本番経路 (course_editor.loadSavedCourses → course.buildFromSpec → spawn) を
  // **配信中のモジュールでそのまま辿り**、利用者が保存した surface が物理まで届くことを確かめる。
  const applied = await page.evaluate(async (name) => {
    const [ed, crs, v2, flt] = await Promise.all([
      import('./js/course_editor.js'), import('./js/course.js'), import('./js/physics_v2.js'), import('./js/fleet.js'),
    ]);
    const saved = ed.loadSavedCourses()[name];
    if (!saved) return { found: false };
    const c = crs.buildFromSpec(saved);
    // **spawn を実際に通す**（敵対的レビュー 軽10: 旧版はラベルに spawn と書きながら
    // `new CarV2({...c.start})` で fleet.js を一切通っていなかった＝経路を偽っていた）。
    const sp = flt.freeSpawn(c, [], 0);
    const car = new v2.CarV2(sp);
    return { found: true, courseSurface: c.surface, startSurface: c.start.surface,
             spawnSurface: sp.surface, carSurface: car.surface, dig: v2.surfaceParamsFor(car.surface) };
  }, NAME);
  await page.click('#run').catch(() => {});
  await page.waitForTimeout(2500);
  const spd = await page.evaluate(() => {
    const el = document.querySelector('#spd');
    return el ? el.innerText.trim() : '';
  });
  const num = parseFloat((spd.match(/[\d.]+/) || ['0'])[0]);
  ok('T4-b surface つきコースで実際に走行できる (速度計が非ゼロ)', num > 0, `#spd="${spd}"`);
  ok('T4-c 保存した surface が本番経路 (loadSavedCourses→buildFromSpec→freeSpawn→CarV2) で車まで届く',
    applied.found === true && applied.courseSurface === 'loose' && applied.startSurface === 'loose'
      && applied.spawnSurface === 'loose' && applied.carSurface === 'loose' && applied.dig && applied.dig.dig > 0,
    `found=${applied.found} course=${applied.courseSurface} start=${applied.startSurface} spawn=${applied.spawnSurface} car=${applied.carSurface} dig=${applied.dig ? applied.dig.dig : 'null'}`);
  await page.evaluate((name) => {
    const key = 'rumicar.courses';
    const all = JSON.parse(localStorage.getItem(key) || '{}');
    delete all[name];
    localStorage.setItem(key, JSON.stringify(all));
  }, NAME);
}

// ── T5: console error / pageerror 0 ─────────────────────────────────────────────
ok(`T5 操作中の console error / pageerror 0 (想定内 ${benign.length} 件を除外)`, errors.length === 0,
   errors.length ? errors.slice(0, 5).join(' / ') : '0 件');

await browser.close();
console.log(`\n結果: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
