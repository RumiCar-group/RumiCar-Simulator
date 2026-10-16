// check_bl5_a11y.mjs — BL5 大きなエディタの背景・ファイル入力のキーボード操作・立体プレビューの言語の実ブラウザ検証 (headed Chrome on Xvfb)
// ════════════════════════════════════════════════════════════════════════════
// 受け入れ基準 (PLAN BL5) のうち **卓上ゲート (wf_bl1_ui.mjs H・I 章) では測れない部分** を実機で測る:
//   (a) 大きなプログラムエディタ (#dlgEditor・車両カードの「⤢」= .cc-expand) を開いたときの
//       getComputedStyle(dlg).backgroundColor が rgba(0, 0, 0, 0) でない — テーマセレクタの全 11 テーマで測る。
//       是正前は .dlg-editor { background: var(--surface-1) } の --surface-1 が全テーマで未定義＝計算値時点で無効＝透明。
//       (a') BL5 fix1（層4 F2）: 背景の計算値が不透明でないこと（≠透明）は代理量で、glass（--surface＝rgba(255,255,255,.08)）では
//       背後のボタンや文字がくっきりコードと重なって見えた。設計＝glass は他のダイアログ（.docdlg・📋 仕様・制限 #dlgSpec）と同じ
//       「半透明＋暗く 2px ぼかす幕」にそろえる。測る: 全テーマで #dlgEditor の背景色と ::backdrop（背景色・backdrop-filter）が
//       #dlgSpec と同じ計算値。glass では画面の左端の帯（どちらのダイアログの外＝幕だけが掛かる）の縁の強さ（隣の画素との輝度差の平均）を
//       ダイアログ無し・エディタ・#dlgSpec で撮って比べ、エディタ／#dlgSpec の比が 0.8〜1.25（同じ見え方）。エディタの本体は .08 の白を
//       重ねるだけ（自分ではぼかさない）なので、背後の見え方は幕で決まる。95ef692 では幕がぼけず比が大きく外れる。
//   (b) 3 つのファイル入力 (#dataImport＝📋 仕様・制限の「📥 バックアップを読み込む」・#edImport＝コース編集の「JSON 読込」・
//       車両カードの .cc-file＝「⬆」) に、直前の操作子からの Tab キーで到達し (document.activeElement で測る)、
//       包む label にフォーカスリング (box-shadow) が出て、そのまま Space キーでファイル選択が開く (Playwright の filechooser
//       イベント)。車両カードは起動時の非同期の取得の後にも作り直されるので、作り直しが 1.5 秒止まってから測る。アクセシブル名 (ariaSnapshot) が
//       非空。名前は見える文言と一致する (BL5 fix1・層4 F5・WCAG 2.5.3 Label in Name): 見える文言のある label (📥 バックアップを読み込む・
//       JSON 読込) の入力は aria-label を持たず、名前＝label の文言＝カタログ値。アイコンだけの label (⬆) は aria-label＝カタログ値。
//       en に日本語が無い。
//       是正前は .filebtn input { display: none } でタブ順とアクセシビリティツリーから消える (label はフォーカスできない)。
//   (c) 峠コースの立体プレビュー (#elev3d) の canvas 描画 (fillText を捕捉) — ja で表示 → 言語を en に切り替えた直後の
//       描画、en のまま別の峠コースを開いたときの描画に日本語が無い。ja の描画は ja のカタログ値どおり。
//       是正前は elev3d.js が「頂上 +…m」「麓 0m」「立体プレビュー — 高低差 …m を下る ▼」を固定で描き、言語切替でも描き直さない。
//   (d) BL5 fix1（層4 F1・回帰）: マウスで 3 つのファイル入力の label (⬆・JSON 読込・📥 バックアップを読み込む) を押した後も、矢印キーで
//       車を手動運転できる。label を押すとフォーカスが視覚的に隠した入力へ移る (display:none の頃は移らなかった)。95ef692 は
//       main.js arrowKeysForCar が INPUT を一律に除外したので、別の場所を押すまで矢印が無言で効かなかった。測る: label を押した後の
//       document.activeElement・ArrowUp の keydown が product に取られた (defaultPrevented を product のリスナの後で読む)・⬆ では
//       ArrowUp を 1.5 秒押して車の ToF (.cc-dist の L/C/R) が変わる。81e44bf (BL5 前) は緑・95ef692 は赤・是正後は緑。
//
// 期待値はページが現に読み込んでいる i18n.js の t() に答えさせる (再実装しない・CI-9)。
// 使い方: cd browser && bash run.sh check_bl5_a11y.mjs
import { launch, newPage, setLang } from './lib.mjs';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };
const JA = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;   // ひらがな・カタカナ・漢字・半角カナ
const J = (v) => JSON.stringify(v);

// 言語の初期値を固定し、canvas の fillText を canvas の id ごとに捕捉する (clearRect で区切り＝最後の描画だけを残す)。
const instrument = (lang) => async (p) => {
  await p.addInitScript((lg) => {
    try { localStorage.setItem('rumicar.lang', lg); } catch (e) {}
    const P = CanvasRenderingContext2D.prototype;
    const draws = (window.__bl5draws = {});
    const fill = P.fillText, clear = P.clearRect;
    P.fillText = function (s, ...a) { const id = this.canvas && this.canvas.id; if (id) (draws[id] = draws[id] || []).push(String(s)); return fill.call(this, s, ...a); };
    P.clearRect = function (...a) { const id = this.canvas && this.canvas.id; if (id === 'elev3d') draws[id] = []; return clear.apply(this, a); };
    // 車両カード (#fleetCols) の作り直し (buildFleetColumns) の回数と最後の時刻。起動時の非同期の取得 (投稿車種など) の後にも
    // 作り直されるので、(b) は作り直しが止まってから測る (途中で作り直されるとフォーカスした入力が DOM から外れる＝測りたい性質と無関係)。
    window.__bl5cols = { n: 0, last: 0 };
    const mo = new MutationObserver(() => { window.__bl5cols.n++; window.__bl5cols.last = performance.now(); });
    document.addEventListener('DOMContentLoaded', () => { const f = document.getElementById('fleetCols'); if (f) mo.observe(f, { childList: true }); });
  }, lang);
};

const browser = await launch();
const allErrors = [];

// ── (a) 大きなエディタの背景 ─────────────────────────────────────────────
console.log('\n(a) 大きなプログラムエディタ (#dlgEditor) の背景 — 全テーマ');
{
  const { page, errors } = await newPage(browser, { width: 1440, before: instrument('ja') });
  const themes = await page.evaluate(() => [...document.querySelectorAll('#themeSel option')].map((o) => o.value));
  ok(themes.length === 11, `テーマセレクタの選択肢 ${themes.length} 個 (${themes.join(',')})`);
  const seen = [];
  for (const th of themes) {
    await page.selectOption('#themeSel', th);
    await page.waitForTimeout(150);
    await page.click('#fleetCols .carcol .cc-expand');
    await page.waitForFunction(() => document.getElementById('dlgEditor').open, null, { timeout: 5000 });
    const r = await page.evaluate(() => {
      const d = document.getElementById('dlgEditor'), sp = document.getElementById('dlgSpec');
      const cs = getComputedStyle(d), bd = getComputedStyle(d, '::backdrop'), sbd = getComputedStyle(sp, '::backdrop');
      return { theme: document.documentElement.dataset.theme || '(none)', bg: cs.backgroundColor, surface: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),
        specBg: getComputedStyle(sp).backgroundColor, bd: bd.backgroundColor + ' ' + bd.backdropFilter, specBd: sbd.backgroundColor + ' ' + sbd.backdropFilter };
    });
    seen.push(`${th}=${r.bg}`);
    ok(r.bg !== 'rgba(0, 0, 0, 0)' && r.bg !== 'transparent', `テーマ ${th} (data-theme=${r.theme}): backgroundColor=${r.bg} (--surface=${r.surface})`);
    ok(r.bg === r.specBg && r.bd === r.specBd, `テーマ ${th}: 背景と幕が #dlgSpec (.docdlg) と同じ計算値 (背景 ${r.bg} / ${r.specBg}・幕 ${r.bd} / ${r.specBd})`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('dlgEditor').open, null, { timeout: 5000 });
  }
  console.log(`  値: ${seen.join(' ; ')}`);

  // (a') glass の見え方: 左端の帯 (どちらのダイアログの外) の縁の強さ。画面は product が描いたものをそのまま撮る。
  console.log("\n(a') glass で背後がぼける — 左端の帯の縁の強さ (隣の画素との輝度差の平均)");
  await page.selectOption('#themeSel', 'glass');
  await page.waitForTimeout(300);
  const CLIP = { x: 8, y: 130, width: 200, height: 640 };
  const edge = async () => {
    await page.waitForTimeout(250);
    const b64 = (await page.screenshot({ clip: CLIP })).toString('base64');
    return page.evaluate(async (src) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + src; await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
      const { data, width: w, height: h } = cx.getImageData(0, 0, img.width, img.height);
      const L = (x, y) => { const k = (y * w + x) * 4; return 0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2]; };
      let sum = 0, n = 0;
      for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) { const l = L(x, y); sum += Math.abs(L(x + 1, y) - l) + Math.abs(L(x, y + 1) - l); n++; }
      return sum / n;
    }, b64);
  };
  const eNone = await edge();
  await page.click('#fleetCols .carcol .cc-expand');
  await page.waitForFunction(() => document.getElementById('dlgEditor').open, null, { timeout: 5000 });
  const rectE = await page.evaluate(() => { const r = document.getElementById('dlgEditor').getBoundingClientRect(); return { x: r.x, y: r.y }; });
  const eEd = await edge();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('dlgEditor').open, null, { timeout: 5000 });
  await page.click('#helpSpec');
  await page.waitForFunction(() => document.getElementById('dlgSpec').open, null, { timeout: 5000 });
  const rectS = await page.evaluate(() => { const r = document.getElementById('dlgSpec').getBoundingClientRect(); return { x: r.x, y: r.y }; });
  const eSp = await edge();
  await page.keyboard.press('Escape');
  const ratio = eEd / eSp;
  ok(rectE.x > CLIP.x + CLIP.width && rectS.x > CLIP.x + CLIP.width, `測る帯 (x ${CLIP.x}〜${CLIP.x + CLIP.width}) は両ダイアログの外 (エディタの左端 ${rectE.x.toFixed(0)}・#dlgSpec の左端 ${rectS.x.toFixed(0)})`);
  ok(eNone > 1 && eSp < eNone, `幕の無い画面の縁の強さ ${eNone.toFixed(2)} > #dlgSpec の幕越し ${eSp.toFixed(2)} (空振りでない)`);
  ok(ratio >= 0.8 && ratio <= 1.25, `glass: エディタの幕越しの縁の強さ ${eEd.toFixed(2)}／#dlgSpec の幕越し ${eSp.toFixed(2)} ＝ ${ratio.toFixed(3)} (0.8〜1.25＝同じ見え方・幕無し ${eNone.toFixed(2)})`);
  allErrors.push(...errors);
  await page.close();
}

// ── (b) ファイル入力のキーボード操作とアクセシブル名 ─────────────────────────
console.log('\n(b) ファイル入力 3 つ — 直前の操作子から Tab で到達・Space でファイル選択・アクセシブル名');
async function probeInput(page, { id, prep, from, input }) {
  if (prep) await prep(page);
  await page.waitForFunction(() => performance.now() - window.__bl5cols.last > 1500, null, { timeout: 30000, polling: 200 });
  const cols0 = await page.evaluate(() => window.__bl5cols.n);
  await page.locator(from).first().focus();
  let reached = false, steps = 0;
  const trail = [];
  for (steps = 1; steps <= 3; steps++) {
    await page.keyboard.press('Tab');
    const a = await page.evaluate((sel) => {
      const el = document.activeElement;
      const tgt = document.querySelector(sel);
      return { hit: !!tgt && el === tgt, desc: el ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') : 'null' };
    }, input);
    trail.push(a.desc);
    if (a.hit) { reached = true; break; }
  }
  ok(reached, `${id}: ${from} から Tab ${reached ? steps + ' 回で到達' : '3 回で到達せず'} (フォーカスの経路 ${trail.join(' → ')})`);
  // フォーカスが見える: 入力は見た目を隠しているので、包む label (.filebtn) にリングが出る (キーボードのフォーカス＝:focus-visible・
  // button:focus-visible と同じ box-shadow: var(--ring))
  const ring = await page.evaluate((sel) => { const el = document.querySelector(sel); const lb = el && el.closest('label'); if (!lb) return null; return getComputedStyle(lb).boxShadow; }, input);
  ok(reached && !!ring && ring !== 'none', `${id}: フォーカス中は label にリングが出る (box-shadow ${ring || '—'})`);
  let chooser = null, after = null;
  if (reached) {
    await page.evaluate(() => { window.__bl5focused = document.activeElement; });
    const wait = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
    await page.keyboard.press('Space');
    chooser = await wait;
    after = await page.evaluate(() => ({ connected: window.__bl5focused.isConnected, cols: window.__bl5cols.n }));
  }
  ok(!!chooser, `${id}: フォーカスした入力で Space → ファイル選択が開く (${chooser ? 'filechooser 発火・multiple=' + chooser.isMultiple() : '開かない'}` +
    `${after ? `・入力は DOM に${after.connected ? '残る' : '無い'}・車両カードの作り直し ${cols0}→${after.cols} 回` : ''})`);
  const snap = await page.locator(input).first().ariaSnapshot().catch((e) => 'ERR ' + e.message);
  const attrs = await page.evaluate((sel) => { const el = document.querySelector(sel); const lb = el && el.closest('label'); return { aria: el ? el.getAttribute('aria-label') : null, visible: lb ? lb.innerText.trim() : null }; }, input);
  return { snap, aria: attrs.aria, visible: attrs.visible };
}

const INPUTS = [
  { id: '#dataImport (📋 仕様・制限 → バックアップを読み込む)', key: 'sys.backup.import', named: 'label', from: '#dataExport', input: '#dataImport',
    prep: async (p) => { await p.click('#helpSpec'); await p.waitForFunction(() => document.getElementById('dlgSpec').open, null, { timeout: 5000 }); } },
  { id: '#edImport (コース編集 → JSON 読込)', key: 'ed.import', named: 'label', from: '#edExport', input: '#edImport',
    prep: async (p) => { await p.click('#editToggle'); await p.waitForSelector('#edExport', { state: 'visible', timeout: 5000 }); } },
  { id: '.cc-file (車両カード → ⬆)', key: 'aria.file.program', named: 'aria', from: '#fleetCols .carcol .cc-repo', input: '#fleetCols .carcol .cc-file', prep: null },
];

for (const lang of ['ja', 'en']) {
  console.log(`  ── 言語 ${lang}`);
  for (const spec of INPUTS) {
    const { page, errors } = await newPage(browser, { width: 1440, before: instrument(lang) });
    const r = await probeInput(page, spec);
    const expect = await page.evaluate(async (k) => { const m = await import(new URL('js/i18n.js', location.href).href); return { v: m.t(k), lang: m.getLang(), has: m.hasKey(k) }; }, spec.key);
    ok(expect.lang === lang, `${spec.id}: ページの言語 ${expect.lang}`);
    const nm = /^- button "([^"]+)"/.exec(String(r.snap).trim());
    const name = nm ? nm[1] : '';
    ok(!!name, `${spec.id}: アクセシブル名が非空 (ariaSnapshot ${J(String(r.snap).trim().split('\n')[0])})`);
    if (spec.named === 'label') {
      // 見える文言のある label: aria-label で上書きしない＝名前は label の文言そのもの (WCAG 2.5.3 Label in Name)
      ok(r.aria === null && expect.has && name === expect.v && r.visible === expect.v,
        `${spec.id}: aria-label なし (実 ${J(r.aria)})・名前 ${J(name)}＝見える文言 ${J(r.visible)}＝カタログ ${spec.key} の ${lang} 値 ${expect.has ? J(expect.v) : '未登録'}`);
    } else {
      // アイコンだけの label (⬆): aria-label がカタログの名前
      ok(expect.has && !!r.aria && r.aria === expect.v && name === expect.v, `${spec.id}: aria-label がカタログ ${spec.key} の ${lang} 値 (実 ${J(r.aria)}・名前 ${J(name)}・カタログ ${expect.has ? J(expect.v) : '未登録'}・見える文言 ${J(r.visible)}＝アイコンだけ)`);
    }
    if (lang === 'en') ok(!!name && !JA.test(name), `${spec.id}: en の名前に日本語が無い (${J(name)})`);
    allErrors.push(...errors);
    await page.close();
  }
}

// ── (c) 立体プレビューの言語 ─────────────────────────────────────────────
console.log('\n(c) 峠コースの立体プレビュー (#elev3d) の canvas 描画 — fillText を捕捉');
const TOUGE = ['峠② タイトヘアピン (急な下り)', '峠① 中速ヘアピン (緩い下り)'];
async function elevState(page) {
  return page.evaluate(async () => {
    const c = document.getElementById('elev3d');
    const m = await import(new URL('js/i18n.js', location.href).href);
    return { hidden: c.hidden, texts: (window.__bl5draws.elev3d || []).slice(), lang: m.getLang() };
  });
}
async function expectTexts(page, elev) {
  return page.evaluate(async (e) => {
    const m = await import(new URL('js/i18n.js', location.href).href);
    if (!m.hasKey('elev3d.top')) return null;
    return [m.t('elev3d.top', { m: e }), m.t('elev3d.foot'), m.t('elev3d.title', { m: e })];
  }, elev);
}
{
  const { page, errors } = await newPage(browser, { width: 1440, path: '#c=' + encodeURIComponent(TOUGE[0]), before: instrument('ja') });
  const elev0 = await page.evaluate(async (nm) => { const r = await fetch(new URL('data/courses.json', location.href)); const L = await r.json(); const c = L.find((x) => x.name === nm); return c ? c.elev : null; }, TOUGE[0]);
  const s0 = await elevState(page);
  const w0 = await expectTexts(page, elev0);
  ok(!s0.hidden && s0.texts.length === 3, `ja で ${TOUGE[0]} (elev ${elev0}) を開くと立体プレビューが表示され 3 つの文言を描く (表示=${!s0.hidden}・描画 ${J(s0.texts)})`);
  ok(!!w0 && J(s0.texts) === J(w0), `ja の描画がカタログ elev3d.* の ja 値と一致 (カタログ ${w0 ? J(w0) : '未登録'})`);

  await setLang(page, 'en');
  const s1 = await elevState(page);
  const w1 = await expectTexts(page, elev0);
  ok(s1.lang === 'en' && !s1.hidden && s1.texts.length === 3 && !s1.texts.some((x) => JA.test(x)),
    `言語を en に切り替えた後の描画に日本語が無い (言語 ${s1.lang}・描画 ${J(s1.texts)})`);
  ok(!!w1 && J(s1.texts) === J(w1), `en の描画がカタログ elev3d.* の en 値と一致 (カタログ ${w1 ? J(w1) : '未登録'})`);

  // en のまま別の峠コースを開く (courseSel の change = 利用者の経路)
  const v2 = await page.evaluate((nm) => {
    const sel = document.getElementById('courseSel');
    const o = [...sel.options].find((x) => x.value === nm || x.dataset.name === nm);
    return o ? o.value : [...sel.options].map((x) => x.value).slice(0, 5);
  }, TOUGE[1]);
  if (typeof v2 === 'string') {
    await page.selectOption('#courseSel', v2);
    await page.waitForTimeout(600);
  }
  const s2 = await elevState(page);
  const elev1 = await page.evaluate(async (nm) => { const r = await fetch(new URL('data/courses.json', location.href)); const L = await r.json(); const c = L.find((x) => x.name === nm); return c ? c.elev : null; }, TOUGE[1]);
  const w2 = await expectTexts(page, elev1);
  ok(typeof v2 === 'string' && !s2.hidden && s2.texts.length === 3 && !s2.texts.some((x) => JA.test(x)) && !!w2 && J(s2.texts) === J(w2),
    `en のまま ${TOUGE[1]} (elev ${elev1}) を開いた描画に日本語が無くカタログの en 値と一致 (選択 ${J(v2)}・描画 ${J(s2.texts)})`);

  // ja へ戻すと ja の文言に戻る (言語切替の往復)
  await setLang(page, 'ja');
  const s3 = await elevState(page);
  const w3 = await expectTexts(page, elev1);
  ok(!!w3 && J(s3.texts) === J(w3), `ja へ戻した後の描画が ja 値 (描画 ${J(s3.texts)})`);
  allErrors.push(...errors);
  await page.close();
}

// ── (d) マウスでファイル入力の label を押した後も矢印キーで手動運転できる (層4 F1・回帰) ─────────────
console.log('\n(d) マウスでファイル入力の label を押した後の矢印キー — product に取られ、⬆ では車が動く (ToF が変わる)');
const MOUSE = [
  { id: '⬆ (.cc-up・車両カード)', label: '#fleetCols .carcol .cc-up', input: '.cc-file', drive: true, prep: null, after: null },
  { id: 'JSON 読込 (コース編集)', label: '#edImport', input: '#edImport', drive: false,
    prep: async (p) => { await p.click('#editToggle'); await p.waitForSelector('#edExport', { state: 'visible', timeout: 5000 }); }, after: null },
  { id: '📥 バックアップを読み込む (📋 仕様・制限)', label: '#dataImport', input: '#dataImport', drive: false,
    prep: async (p) => { await p.click('#helpSpec'); await p.waitForFunction(() => document.getElementById('dlgSpec').open, null, { timeout: 5000 }); },
    after: async (p) => { await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.getElementById('dlgSpec').open, null, { timeout: 5000 }); } },
];
for (const m of MOUSE) {
  const { page, errors } = await newPage(browser, { width: 1440, before: instrument('ja') });
  if (m.prep) await m.prep(page);
  await page.waitForFunction(() => performance.now() - window.__bl5cols.last > 1500, null, { timeout: 30000, polling: 200 });   // (b) と同じ: 車両カードの作り直しが止まってから
  await page.evaluate(() => { window.__bl5keys = []; window.addEventListener('keydown', (e) => { window.__bl5keys.push({ key: e.key, taken: e.defaultPrevented }); }); });
  const lab = await page.evaluate((sel) => { const el = document.querySelector(sel); return el ? (el.tagName === 'LABEL' ? el : el.closest('label')) !== null : false; }, m.label);
  const wait = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
  // label を押す (入力は視覚的に隠しているので label の見える部分を押す＝利用者の操作)
  if (m.label.startsWith('#') && !m.label.includes(' ')) await page.locator(m.label).locator('xpath=ancestor::label[1]').click();
  else await page.click(m.label);
  const chooser = await wait;
  const ae1 = await page.evaluate(() => { const a = document.activeElement; return a ? a.tagName + (a.id ? '#' + a.id : '') + (a.className && typeof a.className === 'string' ? '.' + a.className.split(' ')[0] : '') + (a.type ? '[' + a.type + ']' : '') : 'null'; });
  if (m.after) await m.after(page);
  const ae2 = await page.evaluate(() => { const a = document.activeElement; return a ? a.tagName + (a.id ? '#' + a.id : '') + (a.type ? '[' + a.type + ']' : '') : 'null'; });
  const tof = () => page.evaluate(() => document.querySelector('#fleetCols .carcol .cc-dist').textContent);
  const t0 = await tof();
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1500);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(300);
  const t1 = await tof();
  const ks = await page.evaluate(() => window.__bl5keys.filter((k) => k.key === 'ArrowUp'));
  const taken = ks.length > 0 && ks.every((k) => k.taken);
  ok(lab && !!chooser, `${m.id}: label を押すとファイル選択が開く (filechooser ${chooser ? '発火' : '無し'})・押した直後のフォーカス ${ae1}${m.after ? '・ダイアログを閉じた後 ' + ae2 : ''}`);
  ok(taken, `${m.id}: その後の ArrowUp の keydown ${ks.length} 回が全部 product に取られた (defaultPrevented ${ks.filter((k) => k.taken).length}/${ks.length}・フォーカス ${ae2})`);
  if (m.drive) ok(t0 !== t1, `${m.id}: ArrowUp を 1.5 秒押すと車が動く (ToF ${J(t0)} → ${J(t1)})`);
  allErrors.push(...errors);
  await page.close();
}

ok(allErrors.length === 0, `JS エラー・HTTP 異常 0 件 (実測 ${allErrors.length}${allErrors.length ? ': ' + allErrors.slice(0, 5).join(' | ') : ''})`);
await browser.close();

const line = '─'.repeat(64);
console.log('\n' + line);
console.log('BL5 大きなエディタの背景・ファイル入力のキーボード操作・立体プレビューの言語 実ブラウザゲート');
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log(line); for (const m of fails) console.log('  ✗ ' + m); }
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
