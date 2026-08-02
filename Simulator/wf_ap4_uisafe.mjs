// AP4: UI 安全・堅牢化の常設機械ゲート (リポジトリ追跡・XSS 2 経路封鎖 + sink ゲート + safeSetItem)。
//
// 「外部由来識別子 (community/custom 車種名) が escapeHtml 非経由で innerHTML へ到達しない」
// ことと「data 系 3 経路 (練習ベスト/自作コース/独自車種) の保存失敗が握りつぶされない」
// ことを、知覚でなく機械検査の失敗 (exit 1) として恒久担保する (CI-14)。
//
// 検査 (受け入れ基準 AP4 ①〜④):
//   G1 [sink ゲート・常設]  main.js の全 `${carTypeName(...)}` 補間が escapeHtml で包まれている
//                           (生 `${carTypeName(` 出現数 = 0)。version drift しても機械検出する。
//   G2 [XSS 封鎖・runtime]  registerCarType 相当の悪性名を sink 式へ通すと生 `<` 残存数 = 0。
//                           escapeHtml / carTypeName の写しは source PIN で本物と一致を機械確認
//                           (CI-9 バイパス防止=コピーが陳腐化したら PIN 不一致で exit 1)。
//   G3 [safeSetItem]        本物の storage.js を import し、QuotaExceededError スタブで
//                           false + 通知 1 回・正常時 true + 通知 0 回。
//   G4 [生 setItem 残存 0]  data 系 3 経路の関数本文に raw localStorage.setItem が残っていない
//                           (lap._saveBest / course_editor.saveCourse・deleteCourse /
//                            main.saveCustomCars・saveCarOverrides)。設定系トグルはスコープ外。
//
// 使い方:  node wf_ap4_uisafe.mjs   (PASS なら exit 0・違反で exit 1)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const P = (rel) => join(HERE, rel);
const read = (rel) => readFileSync(P(rel), 'utf8');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.log('  ✗ ' + m); fail++; };

const mainSrc = read('public/js/main.js');
const lapSrc = read('public/js/lap.js');
const ceSrc = read('public/js/course_editor.js');
// AP23: main.js 責務分割で custom car CRUD の carTypeName sink と saveCustomCars/saveCarOverrides は
// car_crud.js へ、公式/ゴースト UI は race_ui.js へ移動。ゲートは sink を追って両モジュールも走査する。
const carCrudSrc = read('public/js/car_crud.js');
const raceUiSrc = read('public/js/race_ui.js');

// ---- G1: sink ゲート (常設・静的) ----
console.log('G1 sink ゲート: ${carTypeName(...)} は必ず escapeHtml で包む');
{
  // `${carTypeName(` = 生 (未ラップ)。`${escapeHtml(carTypeName(` は `${` の直後が escapeHtml
  // なので生パターンには一致しない。ゆえに生の出現数がそのまま「未ラップ数」になる。
  // AP23: sink は main.js / car_crud.js / race_ui.js に散る。3ファイル横断で未ラップ 0 を担保する。
  let raw = 0, wrapped = 0;
  for (const src of [mainSrc, carCrudSrc, raceUiSrc]) {
    raw += (src.match(/\$\{\s*carTypeName\(/g) || []).length;
    wrapped += (src.match(/\$\{\s*escapeHtml\(carTypeName\(/g) || []).length;
  }
  if (raw === 0) ok(`未ラップ ${'${carTypeName('} 出現数 = 0 (main/car_crud/race_ui 横断・escapeHtml 経由 ${wrapped} 箇所)`);
  else bad(`未ラップ ${'${carTypeName('} が ${raw} 箇所残存 (全て escapeHtml で包むこと)`);
  if (wrapped < 1) bad('escapeHtml(carTypeName(...)) の使用が 1 箇所も無い=sink 自体が消えた可能性');
}

// ---- G2: XSS 封鎖 (runtime) + source PIN ----
console.log('G2 XSS 封鎖: 悪性車種名を sink へ通すと生 < 残存 0 / 写しは source PIN 一致');
{
  // 本物の escapeHtml 定義を source PIN (コピーが陳腐化=バイパスを機械検出)。
  const ESC_PIN = `function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }`;
  if (mainSrc.includes(ESC_PIN)) ok('escapeHtml 定義 PIN 一致 (写しは本物と byte 一致)');
  else bad('escapeHtml 定義が source と不一致=写しが陳腐化 (PIN を更新し再検証せよ)');

  // 本物の carTypeName の要点 PIN: i18n キー無しなら base = ct.name (community は '🌐 ' 前置)。
  const CTN_PIN = "return ct.community ? '🌐 ' + base : base;";
  if (mainSrc.includes(CTN_PIN)) ok('carTypeName 要点 PIN 一致 (base=ct.name 経路が生存)');
  else bad('carTypeName の要点が source と不一致 (PIN を更新し再検証せよ)');

  // 写し (PIN 済) で sink 式を再現し、悪性名の生 < が 0 になることを実証。
  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const carTypeName = (ct) => { const base = ct.name; return ct.community ? '🌐 ' + base : base; };
  const PAYLOAD = '<img src=x onerror=alert(1)>';
  for (const ct of [{ key: 'evil', name: PAYLOAD, community: true }, { key: 'evil2', name: PAYLOAD, custom: true }]) {
    // sink 2 箇所と同じ式: ${escapeHtml(carTypeName(ct))}
    const sinkOption = `<option value="${escapeHtml(ct.key)}">${escapeHtml(carTypeName(ct))}</option>`;
    const sinkRow = `<tr><td class="pname">${escapeHtml(carTypeName(ct))}</td></tr>`;
    const rawLt = (sinkOption.match(/<img/g) || []).length + (sinkRow.match(/<img/g) || []).length;
    if (rawLt === 0) ok(`sink 出力に生 <img 残存 0 (${ct.community ? 'community' : 'custom'} 名は &lt;img へ無害化)`);
    else bad(`sink 出力に生 <img が ${rawLt} 箇所残存 (エスケープ漏れ)`);
  }
}

// ---- G3: safeSetItem 挙動 (本物の storage.js を import) ----
console.log('G3 safeSetItem: QuotaExceeded で false+通知1 / 正常で true+通知0');
{
  const { safeSetItem, setStoreFailHandler } = await import('./public/js/storage.js');
  // (a) 失敗経路: setItem が QuotaExceededError を投げるスタブ。
  let notifies = [];
  setStoreFailHandler((what) => notifies.push(what));
  globalThis.localStorage = { setItem() { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } };
  const r1 = safeSetItem('rumicar.best.x', '{}', 'best');
  if (r1 === false) ok('QuotaExceeded 時 safeSetItem === false'); else bad(`QuotaExceeded 時 戻り値 ${r1} (false 期待)`);
  if (notifies.length === 1 && notifies[0] === 'best') ok(`通知 1 回・what='best' (received ${JSON.stringify(notifies)})`);
  else bad(`通知回数/内容が不正: ${JSON.stringify(notifies)} (['best'] 期待)`);

  // (b) 正常経路: setItem 成功。通知は増えない。
  notifies = [];
  let stored = null;
  globalThis.localStorage = { setItem(k, v) { stored = [k, v]; } };
  const r2 = safeSetItem('rumicar.courses', '{"a":1}', 'course');
  if (r2 === true) ok('正常時 safeSetItem === true'); else bad(`正常時 戻り値 ${r2} (true 期待)`);
  if (notifies.length === 0) ok('正常時 通知 0 回'); else bad(`正常時 通知 ${notifies.length} 回 (0 期待)`);
  if (stored && stored[0] === 'rumicar.courses' && stored[1] === '{"a":1}') ok('正常時 実 setItem に key/value 到達');
  else bad(`正常時 setItem 到達値が不正: ${JSON.stringify(stored)}`);
}

// ---- G4: data 系 3 経路に raw localStorage.setItem が残っていない ----
console.log('G4 生 setItem 残存 0: data 系 3 経路 (練習ベスト/自作コース/独自車種)');
{
  // 関数本文を切り出して raw `localStorage.setItem` の有無と safeSetItem 使用を確認する。
  const slice = (src, startRe, endMarker) => {
    const m = src.match(startRe); if (!m) return null;
    const from = m.index; const end = src.indexOf(endMarker, from);
    return src.slice(from, end < 0 ? src.length : end + endMarker.length);
  };
  const checks = [
    ['lap._saveBest', slice(lapSrc, /_saveBest\(\)\s*\{/, '\n  }')],
    ['course_editor.saveCourse', slice(ceSrc, /export function saveCourse\(/, '\n}')],
    ['course_editor.deleteCourse', slice(ceSrc, /export function deleteCourse\(/, '\n}')],
    ['car_crud.saveCustomCars', slice(carCrudSrc, /function saveCustomCars\(/, '\n')],
    ['car_crud.saveCarOverrides', slice(carCrudSrc, /function saveCarOverrides\(/, '\n')],
  ];
  for (const [name, body] of checks) {
    if (body == null) { bad(`${name}: 関数本文を特定できない (source 構造変化)`); continue; }
    const hasRaw = /localStorage\.setItem/.test(body);
    const hasSafe = /safeSetItem\(/.test(body);
    if (!hasRaw && hasSafe) ok(`${name}: raw setItem 0・safeSetItem 使用`);
    else bad(`${name}: raw setItem=${hasRaw} / safeSetItem=${hasSafe} (raw 0 かつ safe 使用が要件)`);
  }
}

console.log('');
if (fail === 0) { console.log('✅ AP4 UI 安全ゲート PASS (全検査合格)'); process.exit(0); }
else { console.log(`❌ AP4 UI 安全ゲート FAIL (${fail} 件違反)`); process.exit(1); }
