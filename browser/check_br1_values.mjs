// RumiCar Simulator — 実ブラウザ 常設ゲート: 出荷の見本と説明の「RC_read の値の扱い」を本番の画面で確かめる (Stage BR・v12.1.0)
//
// v12.1.0 から、出荷の見本 (Wall Hugger の C++・Python・JavaScript と Python の車種別 3 本) は、実機の見本 (正本 RumiCar-lib v0.7.1 の
// Exercise-3.3・4.2-Answer／RasPi の Exercise-3.1〜3.3) と同じ決まりで RC_read の値を扱う: まず 0 以上 (距離) か負の数 (ステータス) かで分け、
// -1 (センサーが応答しない) は止まり、-3 (範囲外) は比べる前に先頭の定数 FAR_MM へ置き換える。上限は先頭の定数 LIMIT_MM。出力は RC_read が
// 返した値のまま。値と指令の照合 (-1 を含む入力の列・3 言語の一致・verifyHash) は wf_bh6_docs.mjs の D 章が見る。
// ここでは本番の画面 (言語を選んで「📄」・車種を選ぶ・「自動 ▶」・シリアル出力・説明のダイアログ) で次を確かめる。
//
//  Z1 既定サンプル (C++・Python・JavaScript): 言語を選んで「📄」を押すと、配信中の samples.js の見本が入る。本文に LIMIT_MM・FAR_MM・
//     RC_setReadLimit(LIMIT_MM)・RC_drive(BRAKE, 0) があり、旧い名前 FAR は無い。▶ で走らせると警告・実行時エラーなしで車が動き、
//     シリアル出力は RC_read が返した値のまま (上限以下の距離か -3 だけ。-1 も、置き換えた値 9999 も出ない)。
//  Z2 Python の車種別 3 本: 車種 (ノーマル FR・4WD・FF) を選び、プログラムの選択で Wall Hugger (Python) を選ぶと入る (車種だけを選ぶと C 版が入る)。本文は Z1 と同じ決まりで、▶ で走らせると
//     実行時エラーなしで車が動く。
//  Z3 センサーノイズ ON (「実機ノイズ」): 見本 (C++) を走らせても、前・左・右の RC_read に -1 は出ない (欠測は -3)。車は動く。
//     ＝説明の「シミュレータの前・左・右は -1 を返さない」。
//  Z4 説明の表示 (日本語・英語): 使い方 7 章 (RC_read・RC_setReadLimit・値を扱う順序)、仕様と制限、物理モデル、システム説明の文がカタログと同じで、
//     新しい決まりの語 (ステータス・FAR_MM・LIMIT_MM) が出る。古い言い方 (読めない・範囲外＝遠い・この 1 行だけ) が出ない。ダイアログを開くと項が見える。
//  Z5 操作中の console error / pageerror 0 (想定内の応答は件数を明示して除外)。
//
// 観測の仕方: 車が動いたかは check_bo1_exercise.mjs と同じ作法 (ページが読み込んでいる physics の車クラスの step(dt) をページの中だけで包み、
//   位置を記録する＝製品コードは変えない)。▶ の直前の試走 (capacity.js) の車は除き、■ を押す直前まで走っていた車の記録だけを使う。
// 使い方: bash run.sh check_br1_values.mjs   終了コード: 0=全 PASS / 1=いずれか FAIL
import { launch, newPage, appModule, setLang, report, APP_URL } from './lib.mjs';

let pass = 0, fail = 0;
const ok = (label, cond, detail) => (report(label, cond, detail) ? pass++ : fail++);

const browser = await launch();
console.log(`\n== 実ブラウザ: 見本と説明の RC_read の値の扱い (BR) ==\n対象: ${APP_URL}\n`);
const { page, errors, benign } = await newPage(browser, {
  width: 1440, height: 900,
  before: async (p) => { await p.addInitScript(() => { try { localStorage.setItem('rumicar.lang', 'ja'); } catch (e) {} }); },
});
const ver = await appModule(page, 'js/config.js', (m) => m.APP_VERSION);
console.log(`APP_VERSION ${ver}`);

// コース: 卓上の「オーバル」(courses.json の先頭)。
const courseVal = await page.evaluate(() => {
  const o = [...document.querySelectorAll('#courseSel option')].find((x) => x.textContent.trim().replace(/^[^\p{L}]+/u, '').startsWith('オーバル'));
  return o ? o.value : null;
});
if (courseVal != null) { await page.selectOption('#courseSel', courseVal); await page.waitForTimeout(800); }
ok('Z0 コース「オーバル」を選べる', courseVal != null, `value=${courseVal}`);

// 車クラスの step を包んで位置を記録する (ページの中だけ)。
await page.evaluate(async () => {
  const [p, d, v] = await Promise.all([import('./js/physics.js'), import('./js/physics_dyn.js'), import('./js/physics_v2.js')]);
  const L = window.__br1 = { on: false, last: null, id: new WeakMap(), n: 0, path: new Map(), prev: new Map() };
  for (const C of [p.Car, d.DynCar, v.CarV2]) {
    if (!Object.prototype.hasOwnProperty.call(C.prototype, 'step') || C.prototype.step.__br1) continue;
    const orig = C.prototype.step;
    const w = function (dt) {
      const r = orig.call(this, dt);
      if (L.on) {
        let id = L.id.get(this); if (id == null) { id = ++L.n; L.id.set(this, id); }
        const q = L.prev.get(id);
        if (q) L.path.set(id, (L.path.get(id) || 0) + Math.hypot(this.x - q[0], this.y - q[1]));
        L.prev.set(id, [this.x, this.y]); L.last = id;
      }
      return r;
    };
    w.__br1 = true; C.prototype.step = w;
  }
});

const col = () => page.locator('#fleetCols .carcol').first();
const serialLines = async () => (await col().locator('.cc-serial').innerText()).split('\n').map((x) => x.trim()).filter(Boolean);
// ▶ で走らせ、シリアルが lines 行たまる (か ms ミリ秒たつ) まで待って ■。シリアル出力・ログの増分・走っていた車の道のり [m] を返す。
async function runNow({ lines = 80, ms = 20000 } = {}) {
  const logBefore = (await page.locator('#log').innerText()).length;
  await page.evaluate(() => { const L = window.__br1; L.on = true; L.last = null; L.id = new WeakMap(); L.path = new Map(); L.prev = new Map(); });
  await page.click('#run');
  const t0 = Date.now();
  try {
    await page.waitForFunction((n) => { const s = document.querySelector('#fleetCols .carcol .cc-serial'); return s && s.innerText.split('\n').filter((x) => x.trim()).length >= n; }, lines, { timeout: ms, polling: 100 });
  } catch (e) { /* 出力の無いプログラム (Python の車種別 3 本) は時間で区切る */ }
  if (await page.isEnabled('#stop')) await page.click('#stop');
  await page.waitForTimeout(300);
  const moved = await page.evaluate(() => { const L = window.__br1; L.on = false; return L.last == null ? 0 : (L.path.get(L.last) || 0); });
  const serial = await serialLines();
  const log = (await page.locator('#log').innerText()).slice(logBefore);
  return { serial, log, moved, all: log + '\n' + serial.join('\n'), sec: (Date.now() - t0) / 1000 };
}
const codeOnly = (lang, src) => src.split('\n').map((l) => (lang === 'py' ? l.replace(/#.*$/, '') : l.replace(/\/\/.*$/, ''))).join('\n');
const rules = (lang, src) => {
  const code = codeOnly(lang, src);
  return /\bLIMIT_MM\s*=\s*\d+/.test(code) && /RC_setReadLimit\(\s*LIMIT_MM\s*\)/.test(code) && /\bFAR_MM\s*=\s*\d+/.test(code)
    && /RC_drive\(\s*BRAKE\s*,\s*0\s*\)/.test(code) && !/\bFAR\b/.test(code) && !/RC_setReadLimit\(\s*\d/.test(code);
};
// シリアル出力の「左 中央 右」の行 (整数 3 つ) を数に直す。
const triples = (serial) => serial.map((l) => l.split(/\s+/)).filter((a) => a.length === 3 && a.every((x) => /^-?\d+$/.test(x))).map((a) => a.map(Number));

// ── Z1: 既定サンプル 3 言語 ───────────────────────────────────────────────────
const SAMPLES = await appModule(page, 'js/samples.js', (m) => m.SAMPLES);
for (const lang of ['c', 'py', 'js']) {
  await col().locator('.cc-lang').selectOption(lang);
  await col().locator('.cc-sample').click();
  await page.waitForTimeout(300);
  const src = await col().locator('.cc-editor').inputValue();
  ok(`Z1-a ${lang}: 言語を選んで「📄」を押すと配信中の見本が入る`, src === SAMPLES[lang], `${src.length} 文字`);
  ok(`Z1-b ${lang}: 本文は LIMIT_MM・FAR_MM・RC_setReadLimit(LIMIT_MM)・RC_drive(BRAKE, 0) を持ち、旧い名前 FAR と数値つきの RC_setReadLimit が無い`, rules(lang, src));
  const limit = Number((/\bLIMIT_MM\s*=\s*(\d+)/.exec(src) || [])[1]);
  const r = await runNow({ lines: 100 });
  const t = triples(r.serial), flat = t.flat();
  const bad = flat.filter((v) => !(v === -3 || (v >= 0 && v <= limit)));
  ok(`Z1-c ${lang}: 警告・実行時エラーなしで走り、車が動く`, !/実行時エラー|⚠/.test(r.all) && r.moved > 0.2, `道のり ${r.moved.toFixed(2)} m・${r.sec.toFixed(1)} 秒${/実行時エラー|⚠/.test(r.all) ? '・' + r.all.trim().slice(0, 80) : ''}`);
  ok(`Z1-d ${lang}: シリアル出力は RC_read が返した値のまま (上限 ${limit} 以下の距離か -3 だけ・-1 と 9999 は出ない)`, t.length >= 90 && bad.length === 0 && flat.includes(-3) && flat.some((v) => v >= 0),
    `${t.length} 行・距離 ${flat.filter((v) => v >= 0).length} 個・-3 ${flat.filter((v) => v === -3).length} 個・それ以外 ${bad.length} 個${bad.length ? ' (' + [...new Set(bad)].slice(0, 5).join(',') + ')' : ''}`);
}

// ── Z2: Python の車種別 3 本 (車種を選び、プログラムの選択で選ぶ) ─────────────────
const PROGS = await appModule(page, 'js/programs.js', (m) => Object.fromEntries(['py_normal_fr', 'py_normal_awd', 'py_normal_ff'].map((k) => [k, { code: m.PROGRAM_BY_KEY[k].code, carType: m.PROGRAM_BY_KEY[k].carType, name: m.PROGRAM_BY_KEY[k].name }])));
for (const key of ['py_normal_awd', 'py_normal_ff', 'py_normal_fr']) {
  const p = PROGS[key];
  await col().locator('.cc-cartype').selectOption(p.carType);
  await page.waitForTimeout(300);
  await col().locator('.cc-program').selectOption(key);
  await page.waitForTimeout(300);
  const src = await col().locator('.cc-editor').inputValue();
  const sel = await col().locator('.cc-program').inputValue();
  const lang = await col().locator('.cc-lang').inputValue();
  const ctype = await col().locator('.cc-cartype').inputValue();
  ok(`Z2-a ${key}: 車種 ${p.carType} を選び、プログラムで ${p.name} を選ぶと本文が入る (言語 py)`, src === p.code && sel === key && lang === 'py' && ctype === p.carType, `選択 ${sel}・車種 ${ctype}・言語 ${lang}・${src.length} 文字`);
  ok(`Z2-b ${key}: 本文は LIMIT_MM・FAR_MM・RC_setReadLimit(LIMIT_MM)・RC_drive(BRAKE, 0) を持ち、旧い名前 FAR と数値つきの RC_setReadLimit が無い`, rules('py', src));
  const r = await runNow({ lines: 1e9, ms: 5000 });
  ok(`Z2-c ${key}: 実行時エラー・警告なしで走り、車が動く`, !/実行時エラー|⚠/.test(r.all) && r.moved > 0.2, `道のり ${r.moved.toFixed(2)} m・${r.sec.toFixed(1)} 秒${/実行時エラー|⚠/.test(r.all) ? '・' + r.all.trim().slice(0, 80) : ''}`);
}

// ── Z3: センサーノイズ ON でも前・左・右の RC_read に -1 は出ない ─────────────
{
  await col().locator('.cc-lang').selectOption('c');
  await col().locator('.cc-sample').click();
  await page.waitForTimeout(300);
  await page.check('#optNoise');
  await page.waitForTimeout(200);
  const on = await page.isChecked('#optNoise');
  const r = await runNow({ lines: 240 });
  const flat = triples(r.serial).flat();
  const m1 = flat.filter((v) => v === -1).length, m3 = flat.filter((v) => v === -3).length, dist = flat.filter((v) => v >= 0).length;
  ok('Z3-a 「実機ノイズ」を ON にできる', on);
  ok('Z3-b センサーノイズ ON: 見本 (C++) のシリアル出力に -1 は出ない (欠測は -3)・距離は上限以下', flat.length >= 600 && m1 === 0 && m3 > 0 && dist > 0 && flat.every((v) => v === -3 || (v >= 0 && v <= 200)),
    `値 ${flat.length} 個: 距離 ${dist}・-3 ${m3}・-1 ${m1}`);
  ok('Z3-c センサーノイズ ON: 警告・実行時エラーなしで車が動く (止まったままにならない)', !/実行時エラー|⚠ RC_/.test(r.all) && r.moved > 0.2, `道のり ${r.moved.toFixed(2)} m`);
  await page.uncheck('#optNoise');
  await page.waitForTimeout(200);
}

// ── Z4: 説明の表示 (日本語・英語) ────────────────────────────────────────────
const KEYS = [['usage.s7.read1', 'dlgUsage'], ['usage.s7.limit', 'dlgUsage'], ['usage.s7.conf', 'dlgUsage'], ['spec.sensor.range', 'dlgSpec'], ['sys.prog.body', 'dlgSpec'], ['pm.s9.cone', 'dlgPhysics']];
const OPEN = { dlgUsage: '#helpUsage', dlgSpec: '#helpSpec', dlgPhysics: '#helpPhysics' };
for (const lang of ['ja', 'en']) {
  await setLang(page, lang);
  const want = await appModule(page, 'js/i18n/messages.js', (m) => Object.fromEntries(['usage.s7.read1', 'usage.s7.limit', 'usage.s7.conf', 'spec.sensor.range', 'sys.prog.body', 'pm.s9.cone'].map((k) => [k, { ja: m.MESSAGES[k].ja, en: m.MESSAGES[k].en }])));
  const got = await page.evaluate((keys) => Object.fromEntries(keys.map(([k, dlg]) => {
    const el = document.querySelector(`[data-i18n-html="${k}"]`);
    return [k, { text: el ? el.textContent.replace(/\s+/g, ' ').trim() : null, inDlg: !!(el && el.closest('#' + dlg)) }];
  })), KEYS);
  const plain = await page.evaluate((w) => Object.fromEntries(Object.entries(w).map(([k, h]) => { const d = document.createElement('div'); d.innerHTML = h; return [k, d.textContent.replace(/\s+/g, ' ').trim()]; })), Object.fromEntries(Object.entries(want).map(([k, v]) => [k, v[lang]])));
  const diff = KEYS.filter(([k]) => got[k].text !== plain[k] || !got[k].inDlg).map(([k]) => k);
  ok(`Z4-a ${lang}: 説明 6 か所 (使い方 7 章・仕様と制限・システム説明・物理モデル) の表示がカタログの文と同じ`, diff.length === 0, diff.length ? '違う: ' + diff.join('・') : KEYS.map(([k]) => k).join('・'));
  const all = KEYS.map(([k]) => got[k].text || '').join('\n');
  const NEED = lang === 'ja' ? [/負の数はステータス/, /FAR_MM = 9999/, /LIMIT_MM/, /RC_drive\(BRAKE, 0\) で止まり/, /シミュレータでは後方センサー未装備の REAR だけ/]
    : [/A negative value is a status/, /FAR_MM = 9999/, /LIMIT_MM/, /stop with RC_drive\(BRAKE, 0\)/, /in the simulator only REAR without the rear sensor/];
  const OLD = lang === 'ja' ? /読めない|範囲外＝遠い|この 1 行だけ|走行では「遠い」として扱う/ : /no reading|out of range = far|in this one line only|treat it as "far" when driving/;
  const miss = NEED.filter((re) => !re.test(all)).map((re) => re.source);
  ok(`Z4-b ${lang}: 新しい決まりの語 (ステータス・FAR_MM・LIMIT_MM・-1 は止まる・-1 が返る場面) が出て、古い言い方が出ない`, miss.length === 0 && !OLD.test(all), miss.length ? '無い: ' + miss.join(' ／ ') : (OLD.test(all) ? '古い言い方: ' + (OLD.exec(all) || [''])[0] : ''));
  for (const [dlg, btn] of Object.entries(OPEN)) {
    await page.click(btn);
    await page.waitForTimeout(300);
    const key = KEYS.filter(([, d]) => d === dlg).map(([k]) => k);
    const vis = await page.evaluate(([d, ks]) => ks.map((k) => { const el = document.querySelector(`[data-i18n-html="${k}"]`); if (!el) return null; el.scrollIntoView(); const r = el.getBoundingClientRect(); return { open: document.getElementById(d).open, w: Math.round(r.width), h: Math.round(r.height) }; }), [dlg, key]);
    ok(`Z4-c ${lang}: ${dlg} を開くと ${key.join('・')} が表示される`, vis.every((v) => v && v.open && v.w > 100 && v.h > 10), vis.map((v) => (v ? `${v.w}x${v.h}px` : '(無い)')).join(' '));
    await page.screenshot({ path: `shots/br1_${dlg}_${lang}.png` });
    await page.click(`#${dlg} .docdlg-x`);
    await page.waitForTimeout(200);
  }
}
await setLang(page, 'ja');

// ── Z5 ──
ok('Z5 操作中の console error / pageerror 0', errors.length === 0, `errors=${errors.length}${errors.length ? ' ' + errors.slice(0, 3).join(' | ') : ''} (想定内として除外した応答 ${benign.length} 件)`);

await browser.close();
console.log(`\n結果: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
