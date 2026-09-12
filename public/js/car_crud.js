// car_crud.js — Stage AP23: main.js 責務分割 第1弾。独自車種(custom car)の CRUD と組込6車種の
// ローカル上書き(V3)エディタ UI を集約。純粋な「関数移動」= 関数本文は byte 同一。依存注入
// initCarCrud(deps) で main.js ヘルパを束縛し逆 import を作らない(循環 0)。組込既定 BUILTIN_DEFAULTS
// はモジュール評価時(=config 評価後・独自車種の登録前=CAR_TYPES は組込6種のみ)に捕捉する。
// 起動時副作用(独自車種の登録・上書き適用・UI 初期化・リスナ配線)は initCarCrud 内で main.js から
// 一度だけ実行(従来の module-eval 位置と同順: 登録 → applyAllCarOverrides → setBuiltinEditUI)。
import { CAR_TYPES, CAR_TYPE_BY_KEY, CAR_TYPE_DEFAULT, CAR_PARAM_DOC, registerCarType, unregisterCarType } from './config.js';
import { safeSetItem } from './storage.js';
import { t, hasKey } from './i18n.js';
import { carSubmission } from './loader.js';

// --- 依存注入スロット ---
let $, escapeHtml, carTypeName, logLine, buildFleetColumns, pruneSlotCarTypes, submitToGithub;

const CUSTOM_CARS_KEY = 'rumicar.customCars';
function loadCustomCars() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_CARS_KEY) || '[]'); } catch (e) { return []; }
}
function saveCustomCars(arr) { safeSetItem(CUSTOM_CARS_KEY, JSON.stringify(arr), 'car'); } // AP4: 失敗は 1 行通知

// ===== V3: 組込6車種のローカル上書き編集 (opt-in runtime override レイヤ) =====
// 設計核心 (PLAN Stage V): shipped 既定 (config.js CAR_TYPES/mkType) は無改変。上書きは
// localStorage rumicar.carOverrides (組込 key → 部分パラメータ) に保存し、起動時/編集時のみ
// CAR_TYPE_BY_KEY/CAR_TYPES へマージ適用する。上書きが無いときは override を一切参照しない
// (OFF パス副作用ゼロ = 卓上 byte 不変)。「既定に戻す」で shipped 既定の元参照へ完全復帰する。
const CAR_OVR_KEY = 'rumicar.carOverrides';
// 組込6種の shipped 既定オブジェクト「参照」を退避 (リセットで byte 完全復帰する真実源)。
// この時点の CAR_TYPES は組込6種のみ (独自車種の登録は後段)。参照を保持し、上書き適用時は
// 別オブジェクトに差し替えるので、この退避参照は常に出荷時の値を保つ。
const BUILTIN_DEFAULTS = Object.fromEntries(CAR_TYPES.map(c => [c.key, c]));
const isBuiltinKey = (k) => Object.prototype.hasOwnProperty.call(BUILTIN_DEFAULTS, k);
const cloneCarDef = (o) => JSON.parse(JSON.stringify(o)); // 車種 def は純データ (数値/文字列/null/drift) ＝ JSON クローン安全
function loadCarOverrides() {
  try { const o = JSON.parse(localStorage.getItem(CAR_OVR_KEY) || '{}'); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; }
  catch (e) { return {}; }
}
function saveCarOverrides(o) { safeSetItem(CAR_OVR_KEY, JSON.stringify(o), 'car'); } // AP4: 失敗は 1 行通知
// 組込 key の runtime オブジェクトを差し替える (CAR_TYPES スロット + CAR_TYPE_BY_KEY 双方)。
function writeCarType(key, obj) {
  const idx = CAR_TYPES.findIndex(x => x.key === key);
  if (idx >= 0) CAR_TYPES[idx] = obj; else CAR_TYPES.push(obj);
  CAR_TYPE_BY_KEY[key] = obj;
}
// shipped 既定の「元参照」に戻す = byte 完全復帰 (クローンでなく原本に戻す)。
function restoreBuiltin(key) { if (isBuiltinKey(key)) writeCarType(key, BUILTIN_DEFAULTS[key]); }
// 組込 key へ部分上書き ovr をマージ適用 (shipped 既定のクローン + ovr → 新オブジェクト)。
function applyCarOverride(key, ovr) {
  if (!isBuiltinKey(key)) return;
  const merged = cloneCarDef(BUILTIN_DEFAULTS[key]);
  for (const [p] of CAR_NUM_PARAMS) if (ovr[p] != null && !Number.isNaN(ovr[p])) merged[p] = ovr[p];
  if ('drift' in ovr) {
    if (ovr.drift === null) merged.drift = null;
    else if (merged.drift && typeof merged.drift === 'object') merged.drift = { ...merged.drift, ...ovr.drift };
    else merged.drift = cloneCarDef(ovr.drift);
  }
  merged.key = key; // 念のため key 固定 (走行は profile().key から駆動系を引く)
  writeCarType(key, merged);
}
// 起動時: 保存済みの組込上書きを適用 (組込 key のみ。空 {} ならループ body 不実行 = 既定経路に副作用ゼロ)。
function applyAllCarOverrides() {
  const all = loadCarOverrides();
  for (const key of Object.keys(all)) if (isBuiltinKey(key)) applyCarOverride(key, all[key] || {});
}
// 組込 key の「現在の full def」と shipped 既定の差分 (部分パラメータ) を作る。
// 比較は両辺を fillCarDef で正規化して行う (FF ドリフトの brakeDrift 等、フォーム既定補完が
// 生む phantom 差分を相殺する)。返す ovr は実際に変えた項目だけ = 「部分パラメータ」。
function carOverrideDiff(key, full) {
  const base = fillCarDef(BUILTIN_DEFAULTS[key]);
  const f = fillCarDef(full);
  const ovr = {};
  for (const [p] of CAR_NUM_PARAMS) if (f[p] !== base[p]) ovr[p] = f[p];
  const baseHas = base.drift != null, fHas = f.drift != null;
  if (fHas && !baseHas) ovr.drift = cloneCarDef(f.drift);
  else if (!fHas && baseHas) ovr.drift = null;
  else if (fHas && baseHas) {
    const dd = {};
    if (f.drift.trigger !== base.drift.trigger) dd.trigger = f.drift.trigger;
    if (!!f.drift.brakeDrift !== !!base.drift.brakeDrift) dd.brakeDrift = !!f.drift.brakeDrift;
    for (const [p] of DRIFT_NUM_PARAMS) if (f.drift[p] !== base.drift[p]) dd[p] = f.drift[p];
    if (Object.keys(dd).length) ovr.drift = dd;
  }
  return ovr;
}


// パラメータ表を描画 (全車種 × 主要パラメータ)。組込6種は「編集」(ローカル上書き)・上書き中は
// 「上書き中」印 + 「既定に戻す」。現値 (= 上書き反映後) を各セルに表示する (V3「現値表示」)。
function renderCarParamTable() {
  const wrap = $('carParamTable'); if (!wrap) return;
  const cols = ['mass', 'accel', 'brake', 'maxSpeed', 'spin', 'us', 'os', 'powerUs', 'powerOs'];
  const ovr = loadCarOverrides();
  let h = `<table class="ptable"><tr><th>${t('cars.tbl.type')}</th>` + cols.map(c => `<th>${c}</th>`).join('') + '<th>drift</th><th></th></tr>';
  for (const ct of CAR_TYPES) {
    const builtin = isBuiltinKey(ct.key);
    const overridden = builtin && !!ovr[ct.key];
    const badge = ct.community ? '' // 🌐 は carTypeName が name に前置済み (二重表示しない)
      : ct.custom ? ` <span class="pcustom">${t('cars.tbl.custom')}</span>`
      : (overridden ? ` <span class="povr">${t('cars.ovr.badge')}</span>` : '');
    let ops = '';
    if (builtin) {
      ops = `<button class="car-ovr-edit" data-key="${escapeHtml(ct.key)}">${t('cars.list.edit')}</button>`;
      if (overridden) ops += ` <button class="car-ovr-reset" data-key="${escapeHtml(ct.key)}">${t('cars.ovr.reset')}</button>`;
    }
    h += `<tr><td class="pname">${escapeHtml(carTypeName(ct))}${badge}</td>` +
      cols.map(c => `<td>${ct[c] != null ? ct[c] : '-'}</td>`).join('') +
      `<td>${ct.drift ? `grip ${ct.drift.grip}` : '—'}</td>` +
      `<td class="carlist-ops">${ops}</td></tr>`;
  }
  h += '</table>';
  wrap.innerHTML = h;
  renderCarOvrBar();
  const doc = $('carParamDoc');
  // 説明文は i18n カタログ (cars.pdoc.<param>) を正とし言語追従。CAR_PARAM_DOC はキー/順序の単一ソース。
  if (doc) doc.innerHTML = '<table class="ptable">' + CAR_PARAM_DOC.map(([k]) => `<tr><td class="pname">${k}</td><td>${t('cars.pdoc.' + k)}</td></tr>`).join('') + '</table>';
  const ex = $('carJsonExample');
  if (ex) ex.textContent = JSON.stringify({
    key: 'light_fr', name: t('cars.ex.name'), mass: 980, accel: 1.1, brake: 1.1, maxSpeed: 1.04,
    us: 0.06, os: 0.08, powerOs: 0.30, drift: null,
  }, null, 2);
}
// 登録済み独自車種の一覧 (個別 編集/複製/削除)。組込6車種は対象外 (V3)。
function renderCustomCarList() {
  const wrap = $('customCarList'); if (!wrap) return;
  const arr = loadCustomCars();
  if (!arr.length) { wrap.innerHTML = `<p class="carlist-empty">${t('cars.list.empty')}</p>`; return; }
  let h = `<table class="ptable carlist"><tr><th>${t('cars.list.name')}</th><th>key</th><th></th></tr>`;
  for (const def of arr) {
    const k = escapeHtml(def.key || '');
    h += `<tr><td class="pname">${escapeHtml(def.name || '')}</td><td class="ckey">${k}</td>` +
      `<td class="carlist-ops">` +
        `<button class="carlist-edit" data-key="${k}">${t('cars.list.edit')}</button>` +
        `<button class="carlist-dup" data-key="${k}">${t('cars.list.dup')}</button>` +
        `<button class="carlist-del" data-key="${k}">${t('cars.list.del')}</button>` +
      `</td></tr>`;
  }
  h += '</table>';
  wrap.innerHTML = h;
}
// 既存のどの車種 key とも衝突しない新 key を作る (複製用)。
function uniqueCarKey(base) {
  const used = new Set(CAR_TYPES.map(c => c.key).concat(loadCustomCars().map(c => c.key)));
  let cand = `${base}_copy`;
  for (let n = 2; used.has(cand); n++) cand = `${base}_copy${n}`;
  return cand;
}

// 独自車種を1件 add/update (同 key は置換) して全 UI を反映。
function upsertCustomCar(def) {
  registerCarType(def);
  const arr = loadCustomCars().filter(c => c.key !== def.key); arr.push(def); saveCustomCars(arr);
  buildFleetColumns(); renderCarParamTable(); renderCustomCarList();
}

// ===== V2: フォーム入力 GUI エディタ (JSON 貼付と双方向同期) =====
// 主要パラメータ [key, min, max, step]。順序は CAR_PARAM_DOC を踏襲 (ラベル/ツールチップの単一ソース)。
const CAR_NUM_PARAMS = [
  ['mass', 200, 3000, 10],
  ['accel', 0, 3, 0.01],
  ['brake', 0, 3, 0.01],
  ['maxSpeed', 0, 2, 0.01],
  ['spin', 0, 2, 0.01],
  ['yawGain', 0, 3, 0.01],
  ['us', 0, 2, 0.01],
  ['os', 0, 2, 0.01],
  ['powerUs', 0, 2, 0.01],
  ['powerOs', 0, 2, 0.01],
  ['liftOffOs', 0, 2, 0.01],
  ['brakeOs', 0, 2, 0.01],
  ['slide', 0, 1, 0.01],
];
const DRIFT_NUM_PARAMS = [
  ['grip', 0, 1.5, 0.01],
  ['gain', 0, 12, 0.1],
  ['minSp', 0, 2, 0.01],
  ['slipYaw', 0, 3, 0.01],
  ['slipSlide', 0, 2, 0.01],
  ['attack', 0, 20, 0.1],
  ['release', 0, 20, 0.1],
];
const carFormBase = () => CAR_TYPE_BY_KEY[CAR_TYPE_DEFAULT];       // ノーマル FR (registerCarType の既定土台と同一)
const carDriftBase = () => CAR_TYPE_BY_KEY['drift_fr'].drift;      // ドリフト有効化時の既定 drift テンプレート
// 部分 def を FR ノーマル既定で埋めた完全 def にする (フォーム描画用。registerCarType の補完規則と一致)。
function fillCarDef(src) {
  const base = carFormBase();
  const def = { key: (src && src.key) || '', name: (src && src.name) || '' };
  for (const [p] of CAR_NUM_PARAMS) def[p] = (src && src[p] != null && !Number.isNaN(src[p])) ? src[p] : base[p];
  if (src && src.drift && typeof src.drift === 'object') {
    const db = carDriftBase();
    const d = {
      trigger: (src.drift.trigger === 'liftoff' || src.drift.trigger === 'power') ? src.drift.trigger : db.trigger,
      brakeDrift: src.drift.brakeDrift != null ? !!src.drift.brakeDrift : !!db.brakeDrift,
    };
    for (const [p] of DRIFT_NUM_PARAMS) d[p] = (src.drift[p] != null && !Number.isNaN(src.drift[p])) ? src.drift[p] : db[p];
    def.drift = d;
  } else {
    def.drift = null; // null / undefined / 非オブジェクト = ドリフトなし
  }
  return def;
}
// フォーム DOM を読み (空欄は NaN・全項目を含む完全 def を返す。バリデーションは validateCarDef)。
function readCarForm() {
  const num = (id) => { const el = $(id); return el ? (el.value === '' ? NaN : Number(el.value)) : undefined; };
  const def = { key: ($('cf_key') ? $('cf_key').value.trim() : ''), name: ($('cf_name') ? $('cf_name').value.trim() : '') };
  for (const [p] of CAR_NUM_PARAMS) { const v = num('cf_num_' + p); if (v !== undefined) def[p] = v; }
  if ($('cf_driftOn') && $('cf_driftOn').checked) {
    const trig = $('cf_drift_trigger');
    if (trig) {
      const d = { trigger: trig.value, brakeDrift: !!($('cf_drift_brakeDrift') && $('cf_drift_brakeDrift').checked) };
      for (const [p] of DRIFT_NUM_PARAMS) { const v = num('cf_num_' + p); if (v !== undefined) d[p] = v; }
      def.drift = d;
    } else { def.drift = {}; } // 直前にチェックON・drift 欄未描画 → fillCarDef が既定で埋める
  } else { def.drift = null; }
  return def;
}
// 数値1行 (ラベル + スライダー + 数値入力。スライダー⇄数値はイベント委譲で相互同期)。
function carNumRow(p, min, max, step, val) {
  const numId = 'cf_num_' + p;
  const has = (val != null && !Number.isNaN(val));
  const v = has ? val : '';
  const rv = has ? val : min;
  const tip = hasKey('cars.pdoc.' + p) ? escapeHtml(t('cars.pdoc.' + p)) : '';
  return `<div class="cf-row"><label class="cf-lbl" title="${tip}">${p}</label>` +
    `<input type="range" class="cf-range" data-num="${numId}" min="${min}" max="${max}" step="${step}" value="${rv}">` +
    `<input type="number" class="cf-num" id="${numId}" min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
}
// フォームを def 値で描画 (部分 def は既定で補完)。values は保持・ラベルは現在言語。
// 組込上書き編集中 (builtinEditKey) は key/name を当該組込に固定 (readonly)＝上書きは数値/drift のみ。
function renderCarForm(def) {
  const wrap = $('carForm'); if (!wrap) return;
  const d = fillCarDef(def || {});
  if (builtinEditKey) { d.key = builtinEditKey; d.name = carTypeName(CAR_TYPE_BY_KEY[builtinEditKey] || BUILTIN_DEFAULTS[builtinEditKey]); }
  const ro = builtinEditKey ? ' readonly' : '';
  let h = '';
  h += `<div class="cf-row"><label class="cf-lbl">key</label><input type="text" class="cf-text" id="cf_key" value="${escapeHtml(d.key)}"${ro} placeholder="my_car"></div>`;
  h += `<div class="cf-row"><label class="cf-lbl">${t('cars.form.name')}</label><input type="text" class="cf-text" id="cf_name" value="${escapeHtml(d.name)}"${ro} placeholder="${escapeHtml(t('cars.ex.name'))}"></div>`;
  for (const [p, min, max, step] of CAR_NUM_PARAMS) h += carNumRow(p, min, max, step, d[p]);
  const on = d.drift != null;
  h += `<div class="cf-row cf-drifttoggle"><label class="cf-lbl cf-lbl-wide"><input type="checkbox" id="cf_driftOn"${on ? ' checked' : ''}> ${t('cars.form.driftEnable')}</label></div>`;
  if (on) {
    h += `<div class="cf-row"><label class="cf-lbl">trigger</label><select id="cf_drift_trigger" class="cf-sel">` +
      `<option value="power"${d.drift.trigger === 'power' ? ' selected' : ''}>power</option>` +
      `<option value="liftoff"${d.drift.trigger === 'liftoff' ? ' selected' : ''}>liftoff</option></select></div>`;
    for (const [p, min, max, step] of DRIFT_NUM_PARAMS) h += carNumRow(p, min, max, step, d.drift[p]);
    h += `<div class="cf-row"><label class="cf-lbl cf-lbl-wide"><input type="checkbox" id="cf_drift_brakeDrift"${d.drift.brakeDrift ? ' checked' : ''}> ${t('cars.form.brakeDrift')}</label></div>`;
  }
  wrap.innerHTML = h;
}
// 独自車種 def のバリデーション (フォーム live・追加ボタン 共通)。{ ok, msg }。
// メッセージは現在言語で eager に解決する (i18n キーを静的参照に保ち孤児検査③を汚さない)。
function validateCarDef(def) {
  if (!def || typeof def !== 'object' || !def.key || !def.name) return { ok: false, msg: t('cars.add.errRequired') };
  if (CAR_TYPE_BY_KEY[def.key] && !CAR_TYPE_BY_KEY[def.key].custom) return { ok: false, msg: t('cars.add.errDupKey', { key: def.key }) };
  const badNum = (v) => v !== undefined && (typeof v !== 'number' || !Number.isFinite(v)); // 明示 null / NaN は不正
  for (const [p] of CAR_NUM_PARAMS) if (badNum(def[p])) return { ok: false, msg: t('cars.add.errNum', { field: p }) };
  if (def.drift != null) {
    if (typeof def.drift !== 'object') return { ok: false, msg: t('cars.add.errNum', { field: 'drift' }) };
    if (def.drift.trigger != null && def.drift.trigger !== 'power' && def.drift.trigger !== 'liftoff')
      return { ok: false, msg: t('cars.add.errNum', { field: 'drift.trigger' }) };
    for (const [p] of DRIFT_NUM_PARAMS) if (badNum(def.drift[p])) return { ok: false, msg: t('cars.add.errNum', { field: 'drift.' + p }) };
  }
  return { ok: true };
}
function showCarMsg(v) {
  const msg = $('carAddMsg'); if (!msg) return;
  if (v.ok) { msg.textContent = ''; }
  else { msg.textContent = v.msg; msg.style.color = 'var(--red)'; }
}
// フォーム → JSON (フォーム編集を下の JSON 欄へ反映し live バリデーション)。
// 組込上書き編集中は key 重複検査を外した validateBuiltinDef を使う (key=組込は正当)。
function syncJsonFromForm() {
  const def = readCarForm();
  const inp = $('carJsonInput'); if (inp) inp.value = JSON.stringify(def, null, 2);
  showCarMsg(builtinEditKey ? validateBuiltinDef(def) : validateCarDef(def));
}
// 組込上書き用バリデーション (key/name 必須・key 重複は不問＝組込 key そのもの。数値/drift のみ検査)。
function validateBuiltinDef(def) {
  const badNum = (v) => v !== undefined && (typeof v !== 'number' || !Number.isFinite(v));
  for (const [p] of CAR_NUM_PARAMS) if (badNum(def[p])) return { ok: false, msg: t('cars.add.errNum', { field: p }) };
  if (def.drift != null) {
    if (typeof def.drift !== 'object') return { ok: false, msg: t('cars.add.errNum', { field: 'drift' }) };
    if (def.drift.trigger != null && def.drift.trigger !== 'power' && def.drift.trigger !== 'liftoff')
      return { ok: false, msg: t('cars.add.errNum', { field: 'drift.trigger' }) };
    for (const [p] of DRIFT_NUM_PARAMS) if (badNum(def.drift[p])) return { ok: false, msg: t('cars.add.errNum', { field: 'drift.' + p }) };
  }
  return { ok: true };
}

// ===== V3: 組込上書き編集の状態と UI =====
let builtinEditKey = null; // 編集中の組込 key (null=非編集)。
// 上書きバー (件数 + 全解除 / 編集中表示) を carParamTable 直下に描画。
function renderCarOvrBar() {
  const bar = $('carOvrBar'); if (!bar) return;
  if (builtinEditKey) {
    const nm = carTypeName(CAR_TYPE_BY_KEY[builtinEditKey] || BUILTIN_DEFAULTS[builtinEditKey]);
    bar.innerHTML = `<span class="carovr-editing">✏️ ${escapeHtml(t('cars.ovr.editing', { name: nm }))}</span>`;
    return;
  }
  const n = Object.keys(loadCarOverrides()).filter(isBuiltinKey).length;
  bar.innerHTML = n > 0
    ? `<span class="carovr-count">${escapeHtml(t('cars.ovr.count', { n }))}</span> <button class="car-ovr-clearall">${t('cars.ovr.clearAll')}</button>`
    : '';
}
// 保存/取消ボタンと追加/全削除ボタンの表示を編集状態に合わせる。
function setBuiltinEditUI() {
  const editing = !!builtinEditKey;
  if ($('carAddBtn')) $('carAddBtn').hidden = editing;
  if ($('carShareBtn')) $('carShareBtn').hidden = editing;
  if ($('carClearBtn')) $('carClearBtn').hidden = editing;
  if ($('carOvrSaveBtn')) $('carOvrSaveBtn').hidden = !editing;
  if ($('carOvrCancelBtn')) $('carOvrCancelBtn').hidden = !editing;
}
function exitBuiltinEdit() { if (builtinEditKey) { builtinEditKey = null; setBuiltinEditUI(); } }
// 組込編集に入る: 現値 (上書き反映後の full def) をフォーム/JSON へ読込む。
function startBuiltinEdit(key) {
  if (!isBuiltinKey(key)) return;
  builtinEditKey = key;
  const cur = cloneCarDef(CAR_TYPE_BY_KEY[key] || BUILTIN_DEFAULTS[key]);
  if ($('carJsonInput')) $('carJsonInput').value = JSON.stringify(cur, null, 2);
  renderCarForm(cur);
  setBuiltinEditUI();
  renderCarParamTable(); // バーを編集中表示へ
  const msg = $('carAddMsg');
  if (msg) { msg.textContent = t('cars.ovr.editLoaded', { name: carTypeName(CAR_TYPE_BY_KEY[key]) }); msg.style.color = 'var(--text-dim)'; }
  if ($('carForm')) $('carForm').scrollIntoView({ block: 'nearest' });
}
function clearFormAfterOvr() { renderCarForm({}); if ($('carJsonInput')) $('carJsonInput').value = ''; }
// 組込上書きを保存 (差分のみ＝部分パラメータ。変更ゼロなら上書き解除＝既定のまま)。
function saveBuiltinOverride() {
  const key = builtinEditKey; if (!key) return;
  const full = readCarForm();
  const v = validateBuiltinDef(full);
  const msg = $('carAddMsg');
  if (!v.ok) { if (msg) { msg.textContent = v.msg; msg.style.color = 'var(--red)'; } return; }
  const diff = carOverrideDiff(key, full);
  const all = loadCarOverrides();
  const changed = Object.keys(diff).length > 0;
  if (changed) { all[key] = diff; saveCarOverrides(all); applyCarOverride(key, diff); }
  else { delete all[key]; saveCarOverrides(all); restoreBuiltin(key); }
  const nm = carTypeName(CAR_TYPE_BY_KEY[key]);
  builtinEditKey = null; setBuiltinEditUI();
  buildFleetColumns(); renderCarParamTable(); clearFormAfterOvr();
  if (msg) { msg.textContent = changed ? t('cars.ovr.saved', { name: nm }) : t('cars.ovr.noChange'); msg.style.color = changed ? 'var(--green)' : 'var(--text-dim)'; }
  if (changed) logLine(t('log.carOverride', { name: nm }));
}
function cancelBuiltinEdit() {
  exitBuiltinEdit();
  renderCarParamTable(); clearFormAfterOvr();
  const msg = $('carAddMsg'); if (msg) msg.textContent = '';
}
// 組込1台を既定に戻す (上書き破棄 → shipped 既定の元参照へ復帰)。
function resetBuiltin(key) {
  if (!isBuiltinKey(key)) return;
  const all = loadCarOverrides();
  if (!all[key]) return;
  const nm = carTypeName(CAR_TYPE_BY_KEY[key]);
  if (!confirm(t('cars.ovr.confirmReset', { name: nm }))) return;
  delete all[key]; saveCarOverrides(all); restoreBuiltin(key);
  if (builtinEditKey === key) { exitBuiltinEdit(); clearFormAfterOvr(); }
  buildFleetColumns(); renderCarParamTable();
  const msg = $('carAddMsg'); if (msg) { msg.textContent = t('cars.ovr.didReset', { name: nm }); msg.style.color = 'var(--text-dim)'; }
  logLine(t('log.carReset', { name: nm }));
}
// 全組込上書きを解除して既定に戻す。
function clearAllOverrides() {
  const all = loadCarOverrides();
  const keys = Object.keys(all).filter(isBuiltinKey);
  if (!keys.length) return;
  if (!confirm(t('cars.ovr.confirmClearAll'))) return;
  for (const k of keys) restoreBuiltin(k);
  saveCarOverrides({});
  if (builtinEditKey) { exitBuiltinEdit(); clearFormAfterOvr(); }
  buildFleetColumns(); renderCarParamTable();
  const msg = $('carAddMsg'); if (msg) { msg.textContent = t('cars.ovr.clearedAll'); msg.style.color = 'var(--text-dim)'; }
}

export function initCarCrud(deps) {
  ({ $, escapeHtml, carTypeName, logLine, buildFleetColumns, pruneSlotCarTypes, submitToGithub } = deps);
  // 起動時: 保存済みの独自車種を登録 (車種メニューに反映)
  for (const def of loadCustomCars()) { try { registerCarType(def); } catch (e) {} }
  // 起動時の組込上書き適用 (CAR_NUM_PARAMS/DRIFT_NUM_PARAMS/fillCarDef 定義後)
  applyAllCarOverrides();
  setBuiltinEditUI(); // 初期状態 (保存/取消は隠す)
  $('helpCars').addEventListener('click', () => {
    renderCarParamTable(); renderCustomCarList();
    if ($('carForm') && !$('carForm').children.length) renderCarForm({});
  });

  // フォーム入力: スライダー⇄数値を相互同期し JSON へ反映 (再描画せず=フォーカス保持)。
  $('carForm').addEventListener('input', (e) => {
    const el = e.target;
    if (el.classList.contains('cf-range')) {
      const num = $(el.dataset.num); if (num) num.value = el.value;
      syncJsonFromForm();
    } else if (el.classList.contains('cf-num')) {
      const range = el.parentElement.querySelector('.cf-range');
      if (range && el.value !== '') range.value = el.value;
      syncJsonFromForm();
    } else if (el.classList.contains('cf-text')) {
      syncJsonFromForm();
    }
  });
  // ドリフトON/OFF・trigger・brakeDrift の変更 (drift 欄の表示切替は再描画)。
  $('carForm').addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'cf_driftOn') { renderCarForm(readCarForm()); syncJsonFromForm(); }
    else if (el.id === 'cf_drift_trigger' || el.id === 'cf_drift_brakeDrift') { syncJsonFromForm(); }
  });
  // JSON → フォーム (貼り付けた JSON をフォームに取り込む)。
  $('carFormFromJson').addEventListener('click', () => {
    const msg = $('carAddMsg');
    let def;
    try { def = JSON.parse($('carJsonInput').value || '{}'); }
    catch (e) { msg.textContent = t('cars.add.errJson', { e: e.message }); msg.style.color = 'var(--red)'; return; }
    renderCarForm(def);
    msg.textContent = t('cars.form.fromJsonOk'); msg.style.color = 'var(--text-dim)';
  });

  $('carAddBtn').addEventListener('click', () => {
    const msg = $('carAddMsg');
    let def;
    try { def = JSON.parse($('carJsonInput').value); }
    catch (e) { msg.textContent = t('cars.add.errJson', { e: e.message }); msg.style.color = 'var(--red)'; return; }
    const v = validateCarDef(def);
    if (!v.ok) { msg.textContent = v.msg; msg.style.color = 'var(--red)'; return; }
    upsertCustomCar(def);
    msg.textContent = t('cars.add.added', { name: def.name }); msg.style.color = 'var(--green)';
    logLine(t('log.customCarAdded', { name: def.name }));
  });
  // V4: 今フォーム/JSON にある車種定義を cars/community/ へ投稿する (PR 共有)。
  // AZ4: ①JSON を書き出し ②アップロード画面を開く方式へ。旧実装は定義全文を URL に載せ、
  // さらに 'noopener' 付きの window.open だったので**成功時も null が返り、阻止されたかを
  // 原理的に判定できない**まま必ず「開きました」と表示していた。
  // submitToGithub は戻り値で判定するため noopener を渡さず、遷移前 (まだ about:blank) に
  // opener を切る。**「noopener と同等の保護」とまでは測れていない**: github.com は
  // Cross-Origin-Opener-Policy を送るので、遷移後に opener が null なのは当方の代入の効果か
  // COOP の効果かを区別できない。ここで言えるのは「遷移前の about:blank に対する保険を掛けた」
  // ことと「browsing context group は noopener と違って分かれない」ことだけ。
  $('carShareBtn').addEventListener('click', () => {
    const msg = $('carAddMsg');
    let def;
    try { def = JSON.parse($('carJsonInput').value); }
    catch (e) { msg.textContent = t('cars.add.errJson', { e: e.message }); msg.style.color = 'var(--red)'; return; }
    const v = validateCarDef(def);
    if (!v.ok) { msg.textContent = v.msg; msg.style.color = 'var(--red)'; return; }
    let r;
    try { r = submitToGithub(carSubmission(def)); }
    catch (e) { msg.textContent = t('log.submit.buildFail', { e: e.message }); msg.style.color = 'var(--red)'; return; }
    if (!r.started) { msg.textContent = t('cars.share.saveFail'); msg.style.color = 'var(--red)'; return; }
    msg.textContent = t(r.opened ? 'cars.share.opened' : 'cars.share.savedOnly', { name: def.name, file: r.filename });
    // 開けなかったときは利用者の追加操作 (自分で投稿ページを開く) が要る = 注意喚起色にする。
    msg.style.color = r.opened ? 'var(--green)' : 'var(--red)';
    logLine(t(r.opened ? 'log.carShareOpened' : 'log.carShareSavedOnly', { name: def.name, file: r.filename }));
  });
  $('carClearBtn').addEventListener('click', () => {
    if (!loadCustomCars().length) { $('carAddMsg').textContent = t('cars.add.cleared'); $('carAddMsg').style.color = 'var(--text-dim)'; return; }
    if (!confirm(t('cars.list.confirmClear'))) return;
    for (const c of loadCustomCars()) unregisterCarType(c.key);
    saveCustomCars([]);
    pruneSlotCarTypes();
    buildFleetColumns(); renderCarParamTable(); renderCustomCarList();
    $('carAddMsg').textContent = t('cars.add.cleared');
    $('carAddMsg').style.color = 'var(--text-dim)';
  });
  // 一覧の 編集/複製/削除 (イベント委譲)。
  $('customCarList').addEventListener('click', (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    const key = btn.dataset.key;
    const def = loadCustomCars().find(c => c.key === key); if (!def) return;
    const msg = $('carAddMsg');
    if (btn.classList.contains('carlist-edit')) {
      exitBuiltinEdit(); // 独自車種の編集に切替＝組込上書き編集モードを抜ける
      $('carJsonInput').value = JSON.stringify(def, null, 2);
      renderCarForm(def); // フォームにも読み込む (双方向同期)
      renderCarParamTable(); // バーの編集中表示を解除
      $('carJsonInput').scrollIntoView({ block: 'nearest' });
      $('carJsonInput').focus();
      msg.textContent = t('cars.list.editLoaded', { name: def.name }); msg.style.color = 'var(--text-dim)';
    } else if (btn.classList.contains('carlist-dup')) {
      const copy = { ...def, key: uniqueCarKey(def.key), name: t('cars.list.copyName', { name: def.name }) };
      upsertCustomCar(copy);
      msg.textContent = t('cars.list.duplicated', { name: copy.name }); msg.style.color = 'var(--green)';
      logLine(t('log.customCarAdded', { name: copy.name }));
    } else if (btn.classList.contains('carlist-del')) {
      if (!confirm(t('cars.list.confirmDel', { name: def.name }))) return;
      unregisterCarType(key);
      saveCustomCars(loadCustomCars().filter(c => c.key !== key));
      pruneSlotCarTypes();
      buildFleetColumns(); renderCarParamTable(); renderCustomCarList();
      msg.textContent = t('cars.list.deleted', { name: def.name }); msg.style.color = 'var(--text-dim)';
    }
  });
  // V3: 組込車種の 編集/既定に戻す (param table 内・イベント委譲。table は innerHTML 差替えだが親は不変)。
  $('carParamTable').addEventListener('click', (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    const key = btn.dataset.key;
    if (btn.classList.contains('car-ovr-edit')) startBuiltinEdit(key);
    else if (btn.classList.contains('car-ovr-reset')) resetBuiltin(key);
  });
  // V3: 全上書き解除 (バー内・イベント委譲)。
  $('carOvrBar').addEventListener('click', (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    if (btn.classList.contains('car-ovr-clearall')) clearAllOverrides();
  });
  $('carOvrSaveBtn').addEventListener('click', saveBuiltinOverride);
  $('carOvrCancelBtn').addEventListener('click', cancelBuiltinEdit);
  return { loadCustomCars, isBuiltinKey, renderCarParamTable, renderCarForm, readCarForm };
}
