// RumiCar Simulator — 実ブラウザ 常設ゲート: 4輪摩擦ブレーキ (任意装備) の到達性 (Stage AV2)
//
// 背景: node 側の常設ゲート (wf_av2_brake.mjs) が**モデルの法則**(配分・閉形式・ロックの創発・
//   不変条件)と**効果**(旋回中制動)を測るのに対し、ここでは **「配信物から実際に届くか」** だけを
//   利用者と同じ経路で測る (CI-8)。AV2 は **車両の UI 装備**なので、利用者と同じ経路＝
//   **セレクタで選ぶ → 全車へ適用 → 共有 URL に載る → 復元される**。
//
//   AS9 は共有 URL の配線④を、AS11 は④⑤を落としており、**どちらも実ブラウザゲートだけが検出**した。
//   AV1 は fleet.js の spawn 経路が 2 箇所に重複していたのを落としており、**node の単体検査は全緑**の
//   まま実ブラウザだけが捕まえた。∴ T4 は 5 箇所の配線を **1 本につないで** 検査する。
//
// ここで測るもの:
//   T1 UI: 制動装置セレクタが実在し、ja/en とも 4 択が当該言語で表示される
//   T2 物理モデル解説 (pm.s11.brake) と §4 の説明 (pm.s4.brake) が ja/en とも実際に描画される
//   T3 **配信中のモジュール**で装備が実際に効く (配分・4輪 ODE 参加・本番 traceHash)
//      ＋対照: 既定 motor は 1 tick も変わらない / dynamic・classic は解釈しない
//   T4 **利用者と同じ経路**: セレクタで選ぶ → 全車の car.brakeSet へ反映 → 共有 URL に bk= が載る
//      → リロードして URL から復元される → HUD に装備バッジが出る
//   T5 操作中の console error / pageerror 0 (想定内の 404 は件数を明示して除外)
//
// 使い方: bash run.sh check_av2_brake.mjs   終了コード: 0=全 PASS / 1=いずれか FAIL
import { launch, newPage, setLang, report, APP_URL } from './lib.mjs';

let pass = 0, fail = 0;
const ok = (label, cond, detail) => (report(label, cond, detail) ? pass++ : fail++);

const browser = await launch();
console.log(`\n== 実ブラウザ: 4輪摩擦ブレーキ (任意装備) の到達性 (AV2) ==\n対象: ${APP_URL}\n`);
const { page, errors, benign } = await newPage(browser, { width: 1440, height: 900 });

// ── T1: 制動装置セレクタが実在し 4 択が当該言語で出る ────────────────────────────
for (const lang of ['ja', 'en']) {
  await setLang(page, lang);
  await page.waitForTimeout(250);
  const sel = await page.evaluate(() => {
    const el = document.querySelector('#optBrake');
    if (!el) return null;
    return { n: el.options.length, values: [...el.options].map((o) => o.value),
             labels: [...el.options].map((o) => o.textContent.trim()), value: el.value,
             title: (el.closest('label') || {}).title || '' };
  });
  ok(`T1-a [${lang}] #optBrake が実在し 4 択ある`, !!sel && sel.n === 4, sel ? `n=${sel.n} values=${sel.values.join(',')}` : 'セレクタ無し');
  ok(`T1-b [${lang}] 既定が motor`, !!sel && sel.value === 'motor', sel ? `value=${sel.value}` : '-');
  const reLbl = lang === 'ja' ? /(モーター|摩擦)/ : /(motor|friction)/i;
  ok(`T1-c [${lang}] 選択肢ラベルが当該言語で表示される`, !!sel && sel.labels.every((l) => l.length > 0) && sel.labels.some((l) => reLbl.test(l)),
     sel ? `labels="${sel.labels.join(' | ')}"` : '-');
  const reTip = lang === 'ja' ? /(制動|ブレーキ)/ : /(brak)/i;
  ok(`T1-d [${lang}] 説明ツールチップが当該言語で非空`, !!sel && sel.title.length > 80 && reTip.test(sel.title),
     sel ? `len=${sel.title.length} 先頭="${sel.title.slice(0, 50)}"` : '-');
}

// ── T2: 物理モデル解説が描画される (ja/en) ──────────────────────────────────────
for (const lang of ['ja', 'en']) {
  await setLang(page, lang);
  await page.waitForTimeout(250);
  for (const [key, reJa, reEn, minLen] of [['pm.s11.brake', /(制動装置|摩擦ブレーキ|後輪だけ)/, /(braking|friction brakes|rear wheels)/i, 200],
                                           ['pm.s4.brake', /(モーターブレーキ|停止距離)/, /(motor brake|stopping distance)/i, 100]]) {
    const txt = await page.evaluate((k) => {
      const el = document.querySelector(`[data-i18n-html="${k}"]`);
      return el ? el.innerText.trim() : null;
    }, key);
    const re = lang === 'ja' ? reJa : reEn;
    ok(`T2 [${lang}] ${key} が実際に描画され当該言語である`, !!txt && txt.length > minLen && re.test(txt),
       `len=${txt ? txt.length : 0} 先頭="${(txt || '').slice(0, 50)}"`);
  }
}
await setLang(page, 'ja');
await page.waitForTimeout(250);

// ── T3: 配信中のモジュールで装備が実際に効く (対照つき) ──────────────────────────
{
  const probe = await page.evaluate(async () => {
    const [cfg, dyn, v2, phy, crs, eng] = await Promise.all([
      import('./js/config.js'), import('./js/physics_dyn.js'), import('./js/physics_v2.js'),
      import('./js/physics.js'), import('./js/course.js'), import('./js/race_engine.js'),
    ]);
    const DT = 1 / cfg.SIM.physicsHz;
    dyn.applyRegime('fullscale');
    // (a) 解決規則: 未指定/motor/未知値 は null（配分なし）
    const resolveOK = [undefined, null, 'motor', 'bogus'].every((v) => v2.brakeParamsFor(v) === null)
                      && !!v2.brakeParamsFor('friction');
    // (b) 配分: 実装の診断量 _fAppWheel を外から読み、定義値と一致するか
    const distOf = (set) => {
      const c = new v2.CarV2({ x: 0, y: 0, theta: 0, grip: 1 });
      c.type = 'normal_fr'; c.brakeSet = set;
      c.driveDir = cfg.CONST.FORWARD; c.pwm = 255; c.steer = cfg.CONST.CENTER;
      for (let i = 0; i < 3000 && c.u < 30; i++) c.step(DT);
      c.driveDir = cfg.CONST.BRAKE; c.pwm = 0; c.step(DT);
      const f = [...c._fAppWheel], s = f[0] + f[1] + f[2] + f[3];
      return { f, sum: s, bias: s !== 0 ? (f[0] + f[1]) / s : NaN };
    };
    const dM = distOf('motor'), dF = distOf('friction'), dFF = distOf('frictionFront');
    const wantF = cfg.BRAKES.friction.biasF, wantFF = cfg.BRAKES.frictionFront.biasF;
    const ULP2 = 2 * Number.EPSILON;
    // (c) 停止距離: FR は motor より friction の方が明確に短い
    const stop = (set) => {
      const c = new v2.CarV2({ x: 0, y: 0, theta: 0, grip: 1 });
      c.type = 'normal_fr'; c.brakeSet = set;
      c.driveDir = cfg.CONST.FORWARD; c.pwm = 255; c.steer = cfg.CONST.CENTER;
      for (let i = 0; i < 3000 && c.u < 40; i++) c.step(DT);
      const x0 = c.x; c.driveDir = cfg.CONST.BRAKE; c.pwm = 0;
      for (let i = 0; i < 4000 && c.u > 2; i++) c.step(DT);
      return c.x - x0;
    };
    const sM = stop('motor'), sF = stop('friction');
    // (d) 本番 runRace の軌跡: 制動を含むプログラムで motor / friction / frictionFront が別ハッシュ
    const SRC = ['t = 0', 'def setup():', '    RC_setup()', 'def loop():', '    global t', '    t = t + 1',
                 '    RC_steer(LEFT)', '    if t % 120 < 80:', '        RC_drive(FORWARD, 255)',
                 '    else:', '        RC_drive(BRAKE, 0)'].join('\n');
    const course = crs.buildFromSpec({ name: 'AV2 走行検査', kind: 'raw', w: 600, h: 400,
      walls: [[0, 0, 600, 0], [600, 0, 600, 400], [600, 400, 0, 400], [0, 400, 0, 0]],
      start: { x: 300, y: 200, theta: 0 }, finish: null });
    const trace = (brake, mode) => eng.runRace({
      course, laps: 1, regime: 'fullscale', maxSec: 20, interact: false, trace: true, physics: mode,
      field: [{ name: 'A', lang: 'py', src: SRC, carType: 'normal_fr', brake }],
      crashRule: { rejoin: false, penaltySec: 3 },
    }).traceHash;
    const tM = trace('motor', 'v2'), tM2 = trace(undefined, 'v2'), tU = trace('bogus', 'v2');
    const tF = trace('friction', 'v2'), tFF = trace('frictionFront', 'v2');
    // (e) 対照: dynamic / classic は brakeSet を無視する
    const dynSame = trace('motor', 'dynamic') === trace('frictionFront', 'dynamic');
    const stdSame = trace('motor', 'standard') === trace('frictionFront', 'standard');
    return { resolveOK,
      biasOK: Math.abs(dF.bias - wantF) / wantF <= ULP2 && Math.abs(dFF.bias - wantFF) / wantFF <= ULP2,
      biasF: dF.bias, biasFF: dFF.bias, motorBias: dM.bias,
      totalOK: Math.abs(dF.sum - dM.sum) / Math.abs(dM.sum) <= ULP2 && Math.abs(dFF.sum - dM.sum) / Math.abs(dM.sum) <= ULP2,
      sM, sF, sameDefault: tM === tM2 && tM === tU, diffEquip: tF !== tM && tFF !== tM && tF !== tFF,
      dynSame, stdSame };
  });
  ok('T3-a 配信物: 未指定/motor/未知値 は配分なし (解決規則)', probe.resolveOK === true, `resolve=${probe.resolveOK}`);
  ok('T3-b 配信物: 前後配分が定義値と一致 (実装の _fAppWheel を外から読む)', probe.biasOK === true,
     `motor=${probe.motorBias.toFixed(4)} friction=${probe.biasF.toFixed(4)} front=${probe.biasFF.toFixed(4)}`);
  ok('T3-c 配信物: 総制動力は装備で変わらない (配分だけが変わる)', probe.totalOK === true, `総和一致=${probe.totalOK}`);
  ok('T3-d 配信物: FR の停止距離が 4輪摩擦で明確に短くなる', probe.sM > probe.sF * 1.5,
     `motor ${probe.sM.toFixed(2)}m → friction ${probe.sF.toFixed(2)}m (${(100 * (1 - probe.sF / probe.sM)).toFixed(0)}% 短縮)`);
  ok('T3-e 配信物: 装備すると本番の軌跡が変わる (3 装備が別ハッシュ)', probe.diffEquip === true, `別ハッシュ=${probe.diffEquip}`);
  ok('T3-f 対照: 既定/未指定/未知値 は traceHash が一致 (=「常に効く」壊れ方の検出)', probe.sameDefault === true, `同一=${probe.sameDefault}`);
  ok('T3-g 対照: dynamic は brakeSet を無視 (§13.16 の記述と一致)', probe.dynSame === true, `同一=${probe.dynSame}`);
  ok('T3-h 対照: classic は brakeSet を無視 (§13.16 の記述と一致)', probe.stdSame === true, `同一=${probe.stdSame}`);
}

// ── T4: 利用者と同じ経路 — セレクタ → ログ → 共有 URL → 復元 → HUD ─────────────
//   AS9 は共有 URL の配線④(hash 再捕捉トリガ配列)を、AS11 は④⑤を落としており、**どちらも
//   node 側の round-trip 検査 (wf_share_check) を素通りして実ブラウザだけが検出**した。
//   ∴ ここは 5 箇所 (①share.js スキーマ ②捕捉 ③適用 ④再捕捉トリガ ⑤wf_share_check 宣言) を
//   **UI 操作 → hash → リロード復元** の 1 本につないで押さえる。
{
  await page.selectOption('#optBrake', 'motor');
  await page.waitForTimeout(400);
  const hDef = await page.evaluate(() => location.hash);
  await page.selectOption('#optBrake', 'frictionFront');
  await page.waitForTimeout(500);
  const hEquip = await page.evaluate(() => location.hash);
  ok('T4-a 既定では hash に装備が載らず、非既定で載る (④ 再捕捉トリガが配線されている)',
     hDef !== hEquip && !/bk=/.test(hDef) && /bk=frictionFront/.test(hEquip),
     `既定="${hDef.slice(0, 70)}" / 装備後="${hEquip.slice(0, 90)}"`);
  const decoded = await page.evaluate(async (hash) => {
    const m = await import('./js/share.js').catch(() => null);
    return m && m.decodeState ? m.decodeState(hash) : null;
  }, hEquip);
  ok('T4-b 配信中の share.js が hash から装備を復元できる (① スキーマ)',
     !!decoded && decoded.brake === 'frictionFront', decoded ? `decoded.brake=${decoded.brake}` : 'share.js を解決できず');
  const logTxt = await page.evaluate(() => {
    const el = document.querySelector('#log');
    return el ? el.innerText.slice(-900) : '';
  });
  ok('T4-c 切替がログに出る (利用者に何が起きたか見える)', /制動装置/.test(logTxt),
     `末尾="${logTxt.slice(-90).replace(/\n/g, ' / ')}"`);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const restored = await page.locator('#optBrake').inputValue();
  ok('T4-d 装備つき URL でリロードすると UI が復元される (③ 適用まで全部つながっている)',
     restored === 'frictionFront', `復元後 #optBrake="${restored}"`);
  // HUD の装備バッジ（本番 drawFleetHud を Proxy 的な ctx で呼び、実引数を読む・AS1 T2 と同じ作法）
  const badge = await page.evaluate(async () => {
    const [hud, i18n] = await Promise.all([import('./js/hud.js'), import('./js/i18n.js')]);
    const mk = (brakeSet) => {
      let seen = '';
      const ctx = { save() {}, restore() {}, measureText: (t) => ({ width: String(t).length * 7 }),
        fillText(t) { seen += String(t) + '\n'; }, strokeText() {}, beginPath() {}, moveTo() {}, lineTo() {},
        stroke() {}, fill() {}, fillRect() {}, strokeRect() {}, arc() {}, closePath() {}, rect() {}, clip() {},
        createLinearGradient: () => ({ addColorStop() {} }), setLineDash() {}, translate() {}, rotate() {}, scale() {} };
      const slots = [{ name: 'A', color: '#fff', lap: {}, world: {}, running: false,
        car: { engine: 'v2', brakeSet, tireSet: 'normal', gearSet: 'direct', suspSet: 'quasi', steerSet: 'tri',
               crashed: false, u: 5, v: 5, vlat: 0, r: 0, slip: 0, x: 0, y: 0, theta: 0, grip: 1,
               _muUse4: [0, 0, 0, 0], _temp: [0, 0, 0, 0], _wear: [0, 0, 0, 0] } }];
      try { hud.drawFleetHud(ctx, slots, { wPx: 900, hPx: 600 }, 0); } catch (e) { return 'ERR:' + e; }
      return seen;
    };
    return { def: mk('motor'), equip: mk('frictionFront'), want: i18n.t('hud.lb.brake.frictionFront') };
  });
  ok('T4-e 既定では HUD に装備の刻印が 1 文字も出ない', !!badge.want && !badge.def.includes(badge.want),
     `期待ラベル="${badge.want}" が既定の描画文字列に含まれない`);
  ok('T4-f 装備すると HUD に刻印が出る', !!badge.want && badge.equip.includes(badge.want),
     badge.equip.startsWith('ERR:') ? badge.equip.slice(0, 120) : `刻印="${badge.want}"`);
  // 後始末: hash を外して既定へ戻す
  await page.evaluate(() => { history.replaceState(null, '', location.pathname); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const back = await page.locator('#optBrake').inputValue();
  ok('T4-g 後始末: hash を外して再読込すると既定 motor へ戻る', back === 'motor', `#optBrake="${back}"`);
}

// ── T5: console error / pageerror 0 ─────────────────────────────────────────────
ok(`T5 操作中の console error / pageerror 0 (想定内 ${benign.length} 件を除外)`, errors.length === 0,
   errors.length ? errors.slice(0, 5).join(' / ') : '0 件');

await browser.close();
console.log(`\n結果: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
