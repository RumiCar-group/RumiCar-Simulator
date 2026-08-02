// wf_share_check.mjs — AF1 卓上ゲート (リポジトリ追跡・本番フロー検証の機械側)
// =====================================================================
// share.js の純粋関数 encodeState/decodeState/normalizeState を検査する:
//   ① round-trip 同一: decodeState(encodeState(s)) === normalizeState(s)  (代表マトリクス)
//   ② 冪等: encodeState(decodeState(encodeState(s))) === encodeState(s)
//   ③ 不正入力耐性: あらゆる壊れた hash で例外を投げず、全フィールド null/正規値
//   ④ 未知キー無視 (後方互換)
//   ⑤ 純粋性: 入力オブジェクトを変更しない (Object.freeze 下でも throw しない)
//   ⑥ 特殊文字 (& = % 空白 絵文字 日本語 超長文) の往復保全
//   ⑦ 型強制 (laps 整数化 / noise 三値 / 文字列 trim・空→null・上限長)
// 1 つでも失敗したら非ゼロ終了 (本番 import パスで実行=CI-8/9)。

import { encodeState, decodeState, normalizeState, SHARE_FIELDS, SHARE_VERSION, hasShareState } from './public/js/share.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function noThrow(fn, msg) {
  try { fn(); pass++; return true; }
  catch (e) { fail++; fails.push(msg + ' — THREW: ' + (e && e.message)); return false; }
}

const ALL_NULL = { course: null, car: null, program: null, regime: null, laps: null, noise: null, theme: null, lang: null, physics: null, tire: null, recon: null, wear: null };

// ---- 代表状態マトリクス (round-trip / 冪等) -------------------------------------
const STATES = [
  {},                                                                   // 空
  { course: 'オーバル' },                                                 // 日本語 1 フィールド
  { course: 'Oval', car: 'normal_fr', program: 'comp_circuit', regime: 'fullscale', laps: 5, noise: false, theme: 'dark', lang: 'ja' }, // 全部
  { car: 'drift_fr', program: 'comp_drift', regime: 'fullscale', laps: 30, noise: true, theme: 'neon', lang: 'en' },
  { course: 'My Custom Course #1 (a&b=c)', car: 'custom_xyz', program: 'recon_racer', laps: 1 }, // 特殊文字含む自作名
  { course: '架空峠 激坂', regime: 'midscale', laps: 3, noise: false, theme: 'paper', lang: 'ja' },
  { course: '  trimmed  ', laps: '7', noise: '1', theme: 'glass' },     // trim / 文字列数値 / 文字列bool
  { laps: 1.7 },                                                        // 整数化 round
  { noise: false },                                                     // 明示 false
  { course: '名前に & と = と % と 🚗 と 空白', lang: 'en' },             // フル特殊文字
  { course: 'x'.repeat(500) },                                         // 超長文 (上限長)
  { physics: 'v2' },                                                   // AO1: 物理エンジン単独
  { car: 'drift_fr', physics: 'standard', regime: 'fullscale' },       // AO1: physics + 他フィールド
  { tire: 'slip' },                                                    // AO6: タイヤセット単独
  { car: 'drift_fr', physics: 'v2', tire: 'slip', regime: 'tabletop' },// AO6: tire + physics + 他フィールド
  { recon: 2 },                                                        // AO9: 試走周回数単独
  { program: 'recon_racer', physics: 'v2', regime: 'fullscale', recon: 3 }, // AO9: recon + physics + 他フィールド
  { wear: true },                                                      // AO12: タイヤ摩耗単独
  { car: 'drift_fr', physics: 'v2', tire: 'slip', wear: true, regime: 'tabletop' }, // AO12: wear + tire + physics + 他フィールド
];

for (const s of STATES) {
  const norm = normalizeState(s);
  const h = encodeState(s);
  ok(typeof h === 'string', 'encodeState は文字列を返す: ' + JSON.stringify(s));
  const back = decodeState(h);
  ok(eq(back, norm), '① round-trip 同一: ' + JSON.stringify(s) + '\n    enc=' + h + '\n    norm=' + JSON.stringify(norm) + '\n    back=' + JSON.stringify(back));
  ok(encodeState(decodeState(h)) === h, '② 冪等: ' + JSON.stringify(s) + ' enc=' + h);
  // 先頭 '#' を付けても同一に decode できる
  ok(eq(decodeState('#' + h), norm), '①# 先頭 # 許容: ' + JSON.stringify(s));
  // encodeState は決定論 (同じ入力で同じ出力)
  ok(encodeState(s) === h, '②det 決定論: ' + JSON.stringify(s));
}

// ---- ③ 不正入力耐性 (例外を投げず全 null/正規) ---------------------------------
const GARBAGE = [
  null, undefined, '', '#', '#!', '&&&', 'v=1', 'v=999&zzz=1',
  '=', '==', 'c', 'c=', 'l=abc', 'l=&n=&c=', 'rg=zzz&n=5&th=',
  '%', '%zz', 'c=%E3%81', 'c=%', '%%%=%%%', 'l=NaN&n=maybe',
  'c=' + 'a'.repeat(9999), 'a&b&c&d', '#c=Oval', 0, 42, true, {}, [], NaN,
];
for (const g of GARBAGE) {
  let r;
  if (!noThrow(() => { r = decodeState(g); }, '③ decode が throw しない: ' + JSON.stringify(g))) continue;
  // 返り値は必ず全フィールド (SHARE_FIELDS) のキーを持ち、各値は null か正規型
  const keysOk = SHARE_FIELDS.every(f => (f.name in r));
  ok(keysOk, '③ decode が全フィールドを返す: ' + JSON.stringify(g) + ' -> ' + JSON.stringify(r));
  for (const f of SHARE_FIELDS) {
    const v = r[f.name];
    let typeOk = (v === null);
    if (!typeOk) {
      if (f.type === 'int') typeOk = Number.isInteger(v);
      else if (f.type === 'bool') typeOk = (typeof v === 'boolean');
      else typeOk = (typeof v === 'string' && v.length > 0 && v.length <= 200);
    }
    ok(typeOk, '③ decode の値が正規型: ' + JSON.stringify(g) + ' [' + f.name + ']=' + JSON.stringify(v));
  }
}
// 完全な garbage 文字列は全 null
ok(eq(decodeState('totally garbage !@#$ no pairs'), ALL_NULL), '③ 無構造文字列は全 null');
ok(eq(decodeState(''), ALL_NULL), '③ 空文字は全 null');
ok(eq(decodeState(null), ALL_NULL), '③ null は全 null');

// ---- ④ 未知キー無視 (後方互換) ------------------------------------------------
const futureHash = 'v=2&c=' + encodeURIComponent('オーバル') + '&future=xyz&zzz=1&l=4';
const fr = decodeState(futureHash);
ok(fr.course === 'オーバル' && fr.laps === 4, '④ 未知キーを無視し既知キーは解釈: ' + JSON.stringify(fr));
ok(fr.car === null && fr.regime === null, '④ 未指定キーは null');

// ---- ⑤ 純粋性 (入力を変更しない) ----------------------------------------------
const frozenIn = Object.freeze({ course: 'オーバル', car: 'normal_fr', laps: 5, noise: true });
noThrow(() => { encodeState(frozenIn); }, '⑤ encodeState は freeze 入力で throw しない');
noThrow(() => { normalizeState(frozenIn); }, '⑤ normalizeState は freeze 入力で throw しない');
const mutProbe = { course: 'オーバル', laps: 5 };
encodeState(mutProbe); normalizeState(mutProbe); decodeState(encodeState(mutProbe));
ok(eq(mutProbe, { course: 'オーバル', laps: 5 }), '⑤ 入力オブジェクトが変更されていない');

// ---- ⑥ 特殊文字の往復保全 (個別精査) ------------------------------------------
const tricky = ['a&b', 'a=b', 'a%b', 'a b', '日本語コース', '🚗💨', 'x&y=z%20 w', '#hash', 'semi;colon'];
for (const name of tricky) {
  const h = encodeState({ course: name });
  const back = decodeState(h);
  ok(back.course === name, '⑥ 特殊文字往復: ' + JSON.stringify(name) + ' enc=' + h + ' back=' + JSON.stringify(back.course));
  // & や = が hash 構造を壊さないこと (course のみ非 null)
  ok(SHARE_FIELDS.filter(f => f.name !== 'course').every(f => back[f.name] === null), '⑥ 特殊文字が他フィールドを汚染しない: ' + JSON.stringify(name));
}

// ---- ⑦ 型強制の精査 -----------------------------------------------------------
ok(normalizeState({ laps: '12' }).laps === 12, '⑦ laps 文字列→整数');
ok(normalizeState({ laps: 1.7 }).laps === 2, '⑦ laps 小数→round');
ok(normalizeState({ laps: 'abc' }).laps === null, '⑦ laps 非数→null');
ok(normalizeState({ noise: '1' }).noise === true, '⑦ noise "1"→true');
ok(normalizeState({ noise: '0' }).noise === false, '⑦ noise "0"→false');
ok(normalizeState({ noise: 'maybe' }).noise === null, '⑦ noise 不明→null');
ok(normalizeState({ course: '   ' }).course === null, '⑦ 空白のみ文字列→null');
ok(normalizeState({ course: '  x  ' }).course === 'x', '⑦ 文字列 trim');
ok(normalizeState({ course: 'a'.repeat(300) }).course.length === 200, '⑦ 文字列上限長 200');
ok(eq(normalizeState(undefined), ALL_NULL), '⑦ normalizeState(undefined) 全 null');
ok(eq(normalizeState('not an object'), ALL_NULL), '⑦ normalizeState(非オブジェクト) 全 null');

// ---- hasShareState ------------------------------------------------------------
ok(hasShareState({ course: 'Oval' }) === true, 'hasShareState: 非空');
ok(hasShareState({}) === false, 'hasShareState: 空');
ok(hasShareState({ course: '   ' }) === false, 'hasShareState: 無害化後空');

// ---- スキーマ健全性 -----------------------------------------------------------
ok(SHARE_FIELDS.length === 12, 'スキーマ 12 フィールド (Stage AO1: physics / AO6: tire / AO9: recon / AO12: wear 追加)');
ok(new Set(SHARE_FIELDS.map(f => f.k)).size === 12, '短縮キー一意');
ok(new Set(SHARE_FIELDS.map(f => f.name)).size === 12, '状態キー一意');
ok(SHARE_VERSION === 1, 'SHARE_VERSION=1');

// ---- AO1 前方互換の byte 不変: physics 未指定の従来状態は 'ph=' を一切出さない (既存共有 URL 不変) ----
const legacyFull = { course: 'Oval', car: 'normal_fr', program: 'comp_circuit', regime: 'fullscale', laps: 5, noise: false, theme: 'dark', lang: 'ja' };
ok(!encodeState(legacyFull).includes('ph='), 'AO1: physics 省略時は ph= を出さない (既存 hash byte 不変)');
ok(encodeState({ physics: 'dynamic' }).includes('ph=dynamic'), 'AO1: physics 明示時は往復する');
ok(decodeState(encodeState({ physics: 'v2' })).physics === 'v2', 'AO1: physics=v2 が往復');
// ---- AO6 前方互換の byte 不変: tire 未指定/normal の従来状態は 'tr=' を一切出さない (既存共有 URL 不変) ----
ok(!encodeState(legacyFull).includes('tr='), 'AO6: tire 省略時は tr= を出さない (既存 hash byte 不変)');
ok(encodeState({ tire: 'slip' }).includes('tr=slip'), 'AO6: tire 明示時は往復する');
ok(decodeState(encodeState({ tire: 'slip' })).tire === 'slip', 'AO6: tire=slip が往復');
// ---- AO9 前方互換の byte 不変: recon 未指定/0 の従来状態は 'rc=' を一切出さない (既存共有 URL 不変) ----
ok(!encodeState(legacyFull).includes('rc='), 'AO9: recon 省略時は rc= を出さない (既存 hash byte 不変)');
ok(encodeState({ recon: 2 }).includes('rc=2'), 'AO9: recon 明示時は往復する');
ok(decodeState(encodeState({ recon: 3 })).recon === 3, 'AO9: recon=3 が往復');
// ---- AO12 前方互換の byte 不変: wear 未指定/false の従来状態は 'we=' を一切出さない (既存共有 URL 不変) ----
ok(!encodeState(legacyFull).includes('we='), 'AO12: wear 省略時は we= を出さない (既存 hash byte 不変)');
ok(encodeState({ wear: true }).includes('we=1'), 'AO12: wear 明示時は往復する (we=1)');
ok(decodeState(encodeState({ wear: true })).wear === true, 'AO12: wear=true が往復');

// ---- 結果 ---------------------------------------------------------------------
const line = '─'.repeat(60);
console.log(line);
console.log('AF1 share.js 卓上ゲート  (encodeState/decodeState round-trip + 不正入力耐性)');
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
if (fail) {
  console.log(line);
  for (const m of fails) console.log('  ✗ ' + m);
}
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
