// RumiCar Simulator — 実ブラウザ 常設ゲート: 連続舵 (任意装備) の到達性 (Stage AS12)
//
// 背景 (決定ログ AS-9 / AS-11): 共有 URL へフィールドを足すときに触る場所は **5つ** で、
//   node 側の round-trip 検査 (wf_share_check) は ④ を素通りする。AS9 は ④ を、AS11 は ④⑤ を落として
//   **実ブラウザの通し経路ゲートで初めて落ちた**。AS12 は同じ「装備」カテゴリなので、ここで通し経路を測る。
//     ① share.js SHARE_FIELDS ② main.js 捕捉 ③ main.js 適用 ④ main.js hash 再捕捉トリガ配列
//     ⑤ wf_share_check.mjs のスキーマ宣言 (件数ハードコード)
//
// ここで測るもの (「装備が選べているように見えるか」の目視の代わりになる測定述語):
//   T1 セレクタ (#optSteer) が配信 UI に実在し、選択肢と既定が配信 config の白リストと一致
//   T2 選ぶとログに ja の説明が出る／既定へ戻すと既定の文言が出る
//   T3 en でも英語の文言が出る (ja 固定文言でない)
//   T4 **配信中のモジュール**で物理が実際に変わる — 3エンジンすべてで効く (tire/gear/susp と違い v2 専用でない)
//      ＋ 255=全舵が3値と bit 一致 ＋ 未装備なら steerAmt が付いていても3値のまま (多重防御)
//   T5 学習 API の到達性: 配信物の buildApi で未装備の2引数呼びが 0 を返しログが1回出る (沈黙截断の禁止)
//   T6 HUD の刻印: 非既定を選んだときだけ注記へ装備が出る (既定では 1 文字も増えない)
//   T7 共有 URL: 既定は hash に載らず、非既定だけが載って**リロードで復元**される (5箇所の通し経路)
//   T8 物理解説 (📖) と 使い方 (RC_steer の項) に配信されている
//   T9 操作中の console error / pageerror 0 (想定内の 404 は件数を明示して除外)
//
// 使い方: bash run.sh check_as12_steer.mjs   終了コード: 0=全 PASS / 1=いずれか FAIL
import { launch, newPage, setLang, report, APP_URL } from './lib.mjs';

let pass = 0, fail = 0;
const ok = (label, cond, detail) => (report(label, cond, detail) ? pass++ : fail++);

const browser = await launch();
console.log(`\n== 実ブラウザ: 連続舵 (任意装備) の到達性 (AS12) ==\n対象: ${APP_URL}\n`);
const { page, errors, benign } = await newPage(browser, { width: 1440, height: 900 });

const logText = () => page.locator('#log').innerText();

// ── T1: セレクタの実在・選択肢・既定 ────────────────────────────────────
{
  const uiOpts = await page.$$eval('#optSteer option', (os) => os.map((o) => o.value));
  const wl = await page.evaluate(async () => {
    const c = await import('./js/config.js');
    return { sets: c.STEER_SETS, def: c.STEER_DEFAULT };
  });
  ok('T1-a #optSteer の選択肢が配信 config の STEER_SETS と一致', JSON.stringify(uiOpts) === JSON.stringify(wl.sets), `UI=${uiOpts} / config=${wl.sets}`);
  const v = await page.locator('#optSteer').inputValue();
  ok('T1-b 既定は tri (=実機準拠の3値=従来と同じ)', v === wl.def && v === 'tri', `steerSet=${v}`);
}

// ── T2/T3: 選択のログが i18n で出る ──────────────────────────────────────
await setLang(page, 'ja');
{
  const before = await logText();
  await page.selectOption('#optSteer', 'prop');
  await page.waitForTimeout(300);
  const added = (await logText()).slice(before.length);
  ok('T2-a 連続舵を選ぶと ja のログが出る', /操舵サーボ.*連続舵/.test(added), `追加ログ="${added.trim().slice(0, 80)}"`);
}
{
  const before = await logText();
  await page.selectOption('#optSteer', 'tri');
  await page.waitForTimeout(300);
  const added = (await logText()).slice(before.length);
  ok('T2-b 既定へ戻すと既定の文言が出る', /3値/.test(added), `追加ログ="${added.trim().slice(0, 80)}"`);
}
await setLang(page, 'en');
await page.waitForTimeout(300);
{
  const before = await logText();
  await page.selectOption('#optSteer', 'prop');
  await page.waitForTimeout(300);
  const added = (await logText()).slice(before.length);
  ok('T3 en でも英語の文言が出る (ja 固定文言でない)', /Steering servo:\s*continuous/i.test(added), `追加ログ="${added.trim().slice(0, 80)}"`);
}
await setLang(page, 'ja');
await page.selectOption('#optSteer', 'tri');
await page.waitForTimeout(200);

// ── T4: 配信中のモジュールで物理が実際に変わる (3エンジン共通・多重防御) ─────────
{
  const probe = await page.evaluate(async () => {
    const [cfg, phys, dyn, v2] = await Promise.all([
      import('./js/config.js'), import('./js/physics.js'), import('./js/physics_dyn.js'), import('./js/physics_v2.js'),
    ]);
    const DT = 1 / cfg.SIM.physicsHz;
    dyn.applyRegime('tabletop');
    const mk = (eng, set) => {
      const s = { x: 0, y: 0, theta: 0, grip: 1 };
      const c = eng === 'v2' ? new v2.CarV2(s) : eng === 'dynamic' ? new dyn.DynCar(s) : new phys.Car(s);
      c.type = 'normal_awd'; c.steerSet = set; return c;
    };
    const out = {};
    for (const eng of ['standard', 'dynamic', 'v2']) {
      const full = mk(eng, 'tri'); full.steer = cfg.CONST.LEFT; full.steerAmt = null;
      const q255 = mk(eng, 'prop'); q255.steer = cfg.CONST.LEFT; q255.steerAmt = 255;
      const half = mk(eng, 'prop'); half.steer = cfg.CONST.LEFT; half.steerAmt = 128;
      const sham = mk(eng, 'tri'); sham.steer = cfg.CONST.LEFT; sham.steerAmt = 128;   // 未装備なのに amt が付いている
      const drive = (set, amt) => { const c = mk(eng, set); c.driveDir = cfg.CONST.FORWARD; c.pwm = 200;
        for (let i = 0; i < 300; i++) { c.steer = cfg.CONST.LEFT; c.steerAmt = amt; c.step(DT); }
        return { x: c.x, y: c.y }; };
      const a = drive('prop', 100), b = drive('tri', null);
      out[eng] = {
        bit255: Object.is(q255.steerTarget, full.steerTarget),
        half: half.steerTarget > 0 && half.steerTarget < full.steerTarget * 0.99,
        shamSame: Object.is(sham.steerTarget, full.steerTarget),
        moved: Math.hypot(a.x - b.x, a.y - b.y),
      };
    }
    return out;
  });
  for (const eng of ['standard', 'dynamic', 'v2']) {
    const p = probe[eng];
    ok(`T4-a ${eng}: amt=255 は3値の全舵と bit 一致`, p.bit255 === true, `bit255=${p.bit255}`);
    ok(`T4-b ${eng}: 装備すると中間舵角が作れる`, p.half === true, `half=${p.half}`);
    ok(`T4-c ${eng}: **未装備**なら amt が付いていても3値のまま (物理側でも装備を見る=多重防御)`, p.shamSame === true, `shamSame=${p.shamSame}`);
    ok(`T4-d ${eng}: 実走で連続舵が効く (300 step 後の位置差)`, p.moved > 1e-3, `Δ=${p.moved.toExponential(2)} m`);
  }
}

// ── T5: 学習 API の到達性 (配信物の buildApi・沈黙截断の禁止) ─────────────────
{
  const api = await page.evaluate(async () => {
    const [cfg, phys, apiMod] = await Promise.all([
      import('./js/config.js'), import('./js/physics.js'), import('./js/api.js'),
    ]);
    const mk = () => { const car = new phys.Car({ x: 0, y: 0, theta: 0 }); const logs = [];
      const world = { car, walls: [], log: (m) => logs.push(String(m)), _sensors: [], _others: [], _sensGen: 0, _simMs: 0 };
      return { car, world, env: apiMod.buildApi(world), logs }; };
    const un = mk();
    const r1 = un.env.RC_steer(cfg.CONST.LEFT);           // 1引数 = 従来どおり
    const r2 = un.env.RC_steer(cfg.CONST.RIGHT, 128);     // 未装備の2引数 = 失敗
    un.env.RC_steer(cfg.CONST.RIGHT, 200); un.env.RC_steer(cfg.CONST.LEFT, 10);
    const eq = mk(); eq.world.steerSet = 'prop'; eq.car.steerSet = 'prop';
    const r3 = eq.env.RC_steer(cfg.CONST.RIGHT, 128);
    eq.env.RC_steer(cfg.CONST.RIGHT);                      // 1引数で3値へ復帰
    return { r1, r2, r3, unSteer: un.car.steer, unAmt: un.car.steerAmt, logs: un.logs.length,
             eqAmt: eq.car.steerAmt, eqLeft: cfg.CONST.LEFT };
  });
  ok('T5-a 配信物: 1引数 RC_steer は従来どおり 1 を返す', api.r1 === 1 && api.unSteer === api.eqLeft && api.unAmt === null, `r1=${api.r1}`);
  ok('T5-b 配信物: 未装備の2引数は 0 を返し指令を変えない', api.r2 === 0 && api.unAmt === null, `r2=${api.r2} amt=${api.unAmt}`);
  ok('T5-c 配信物: 未装備の理由がログへ 1 回だけ出る (沈黙截断の禁止・20Hz で溢れない)', api.logs === 1, `ログ ${api.logs} 件`);
  ok('T5-d 配信物: 装備すれば 2引数が通り、1引数で3値へ復帰する', api.r3 === 1 && api.eqAmt === null, `r3=${api.r3} amt(復帰後)=${api.eqAmt}`);
}

// ── T6: HUD の刻印は非既定を選んだときだけ ──────────────────────────────
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
    const mkSlot = (steerSet, engine) => ({ name: 'A', color: '#f00', running: false,
      lap: { laps: 0, lapTime: 0, bestLap: null, improved: false, bestRec: null },
      car: { crashed: false, engine, tireSet: 'normal', gearSet: 'direct', suspSet: 'quasi', steerSet } });
    const view = { wPx: 1245, hPx: 700 };
    const run = (ss, eng) => { texts.length = 0; h.drawFleetHud(ctx, [mkSlot(ss, eng)], view, 0); return texts.join(''); };
    return { def: run('tri', 'v2'), prop: run('prop', 'v2'), propStd: run('prop', 'dynamic') };
  });
  ok('T6-a 既定では装備の刻印が 1 文字も出ない', !/連続舵/.test(hud.def), '注記に「連続舵」を含まない');
  ok('T6-b 連続舵を選ぶと HUD に刻印が出る', hud.prop !== hud.def && /連続舵/.test(hud.prop), '刻印あり');
  ok('T6-c 旧エンジンでも刻印が出る (操舵サーボは3エンジン共通の装備)', /連続舵/.test(hud.propStd), '刻印あり (dynamic)');
}

// ── T7: 共有 URL は非既定だけ載る＋リロードで復元 (AS9/AS11 申し送りの通し経路・5箇所) ──
{
  await page.selectOption('#optSteer', 'tri');
  await page.waitForTimeout(400);
  const hDef = await page.evaluate(() => location.hash);
  await page.selectOption('#optSteer', 'prop');
  await page.waitForTimeout(400);
  const hEquip = await page.evaluate(() => location.hash);
  ok('T7-a 既定では hash に装備が載らない (非既定で載る)', hDef !== hEquip && !/ss=/.test(hDef), `既定 hash=${hDef.slice(0, 60)}`);
  const decoded = await page.evaluate(async (hash) => {
    const m = await import('./js/share.js').catch(() => null);
    return m && m.decodeState ? m.decodeState(hash) : null;
  }, hEquip);
  if (decoded) {
    ok('T7-b 非既定が hash へ載る (ss=prop)', decoded.steerSet === 'prop', `decoded.steerSet=${decoded.steerSet}`);
  } else {
    ok('T7-b 非既定が hash へ載る (decode 経路が無いため hash 差で確認)', hEquip.length > hDef.length, 'share.decodeState を解決できず hash 長で確認');
  }
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const v = await page.locator('#optSteer').inputValue();
  ok('T7-c 装備つき URL でリロードすると UI が復元される (5箇所の通し経路が全部つながっている)', v === 'prop', `steerSet=${v}`);
}

// ── T8: ドキュメントが配信されている ──────────────────────────────────────
{
  const doc = await page.evaluate(() => {
    const pm = document.querySelector('[data-i18n-html="pm.s11.steer"]');
    const us = document.querySelector('[data-i18n-html="usage.s7.steer"]');
    return { pm: pm ? pm.textContent.length : 0, usage: us ? us.textContent : '' };
  });
  ok('T8-a 物理解説 (📖) に「連続舵」の Q&A が配信されている', doc.pm > 100, `本文 ${doc.pm} 文字`);
  ok('T8-b 使い方の RC_steer 項が第2引数と装備の条件を説明している', /0.*255/.test(doc.usage) && /比例操舵サーボ|proportional/i.test(doc.usage), `"${doc.usage.slice(0, 70)}"`);
}

// ── T9: エラー 0 ──────────────────────────────────────────────────────
ok('T9 操作中の console error / pageerror 0', errors.length === 0,
  `errors=${errors.length}${benign.length ? ` (想定内として除外した応答 ${benign.length} 件)` : ''}`);

await browser.close();
console.log(`\nAS12 実ブラウザ ゲート: PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
