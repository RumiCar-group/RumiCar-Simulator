// wf_be3_cartype.mjs — BE3: 投稿車種・自作車種・公式レースの持ち込み車種が組込車種を上書きしないこと。
// ════════════════════════════════════════════════════════════════════════════
// 何を守るゲートか:
//   v8.7.0 までの `registerCarType`（`config.js`）は組込 key も無条件に置き換えていた（BD-3(b)）。改修前ツリーの
//   実ブラウザで再現した経路（2026-09-24）:
//     ・起動時の自作車一括登録（`car_crud.js`）: localStorage の自作車に key 'normal_fr' が 1 件あると組込 FR が
//       置き換わる（maxSpeed 1.02 → 1.9）。`capacity.js` のプローブ車 normal_fr の物理が変わるのに、
//       `driveableCapN` の鍵は動かない。
//     ・公式レース／ゴースト対戦（`race_engine.js` の持ち込み車種）: 組込 key の carDef がレース後も居残り、
//       `custom: true` が付くので「追加」ボタンの重複検査もすり抜けて保存まで進んだ（次の起動で上の経路に合流）。
//       同じ field のレースの verifyHash も、直前に持ち込み車種のレースを 1 回走らせただけで変わった。
//     ・GitHub 投稿車種（`main.js`）は BC3 の `isBuiltinKey` 検査で既に止まっていた（到達しない・`check_bc3_intake` ⑥）。
//   本ゲートは product の関数（`config.js` の `registerCarType`/`unregisterCarType`/`registerRaceCarTypes`・
//   `race_engine.js` の `runRace`）を**直接呼んで**同じ性質を卓上で固定する。UI の入口（起動時の告知・「追加」
//   ボタン・「複製」での救済）は `browser/check_be3_cartype.mjs` が本番 UI で測る。
//
// 章立て:
//   A) 組込 6 車種は `registerCarType` のどの形の def でも 1 bit も変わらない（参照・JSON・`CAR_TYPES` の並びとも）。
//      戻り値は null。`unregisterCarType` でも消えない。
//   B) 自作車（組込でない key）は従来どおり: 追加・同じ key の再登録＝その場で更新・drift 未指定は現行の定義から
//      継承（旧実装と同じ規則）・削除。
//   C) 公式レースの持ち込み車種: レース中は従来どおり効き（**結果は改修前ツリーで刻んだ verifyHash と一致**）、
//      レース後は車種表が参照ごと元どおり（組込も・持ち込み前からあった自作車も・新しく持ち込まれた key は消える）。
//      持ち込み車種のレースの後でも、同じ field のレースは同じ結果になる。
//   D) 形の変わった key の持ち込み車種（'__proto__'・非文字列の 5 と '5'・['normal_fr']・オブジェクト）でも、レース後は
//      車種表が参照ごと元どおり（並びに重複・戻し残しが無い・原型が戻る・先にあった '__proto__' の自作車も戻る）。
//      登録の途中・レースの途中で例外が出ても戻る（key が {"toString":1} の carDef／プログラム本文の getter が投げる entry
//      ＝どちらも product を壊さずに起こせる例外）。
//   E) キャッシュ混在（BA1 の規則）: 改修前の config.js 相当（BE3 の 2 か所＝組込の拒否と registerRaceCarTypes の export を
//      文字列で外したもの。git に依存しない＝ZIP で取得しても走る）と新しい race_engine.js の組み合わせでも読み込めて、
//      持ち込み車種のレースが改修前と同じ結果で走る（新しい名前を名前付き import すると、ここで読み込みごと落ちる）。
//   G) 検出力: 一時ツリーへ複製して保護・復元を壊す変異を入れ、上の章が赤くなることを測る（product は無改変）。
//
// 【凍結値の出どころ】C) の FROZEN は**改修前ツリー（HEAD 82683cf）**で同じ field を走らせて刻んだ値。
//   「レース中の挙動を 1 bit も変えない」の物差しなので、走行物理を意図的に変えた版では刻み直す
//   （f0〜f3 と同じ版付き回帰記録。刻み直すときは改修前後の両方で測った理由を添えること）。
// 【測らないこと】同じレースの中で 2 台が同じ key の違う定義を持ち込んだときの後勝ち、および carDef を持たない車が
//   同じ key の持ち込み車種の定義で走ること（ゴースト対戦の「あなた」等。改修前からの挙動・結果が公式記録に刻まれうる
//   ので本ブロックでは変えない＝BE-3 で未決へ）。利用者の組込上書き（V3・`car_crud.js` writeCarType）が容量プローブ車を
//   変えても driveableCapN の鍵が動かないこと（同族・未決へ）。
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'node:url';

const JS_ROOT = './public/js';
const SPECS = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
const BUILTIN = ['normal_fr', 'normal_ff', 'normal_awd', 'drift_ff', 'drift_fr', 'drift_awd'];
// 改修前ツリー (HEAD 82683cf・2026-09-24) で刻んだ verifyHash。オーバル・2 周・maxSec 30・dynamic・interact。
const FROZEN = { plain: '7cee2df9', withDefs: '97b6657c' };

let pass = true;
const report = (label, violations) => {
  if (violations.length) { pass = false; console.log(`  ✗ ${label}: ${violations.length} 件`); for (const v of violations.slice(0, 12)) console.log(`      - ${v}`); if (violations.length > 12) console.log(`      … ほか ${violations.length - 12} 件`); }
  else console.log(`  ✓ ${label}: 0 件`);
};

async function loadTree(dir) {
  const url = (f) => pathToFileURL(path.resolve(dir, f)).href;
  const [cfg, eng, crs, prog] = await Promise.all([
    import(url('config.js')), import(url('race_engine.js')), import(url('course.js')), import(url('programs.js'))]);
  return { cfg, eng, crs, prog };
}
const clone = (x) => JSON.parse(JSON.stringify(x));
// 車種表の状態＝並び（参照）・鍵ごとの参照・原型。「元どおり」を参照の同一性で比べる（値だけ同じ別物を許さない）。
const tableState = (cfg) => ({
  list: cfg.CAR_TYPES.slice(),
  keys: Object.keys(cfg.CAR_TYPE_BY_KEY).sort(),
  refs: Object.fromEntries(Object.keys(cfg.CAR_TYPE_BY_KEY).map((k) => [k, cfg.CAR_TYPE_BY_KEY[k]])),
  proto: Object.getPrototypeOf(cfg.CAR_TYPE_BY_KEY),
});
function diffState(a, b, where) {
  const v = [];
  if (a.list.length !== b.list.length || a.list.some((t, i) => t !== b.list[i])) v.push(`${where}: CAR_TYPES の並び/参照が変わった（${a.list.map((t) => t.key).join(',')} → ${b.list.map((t) => t.key).join(',')}）`);
  if (a.keys.join() !== b.keys.join()) v.push(`${where}: CAR_TYPE_BY_KEY の鍵が変わった（${a.keys.join(',')} → ${b.keys.join(',')}）`);
  for (const k of a.keys) if (a.refs[k] !== b.refs[k]) v.push(`${where}: CAR_TYPE_BY_KEY.${k} の参照が変わった`);
  if (a.proto !== b.proto) v.push(`${where}: CAR_TYPE_BY_KEY の原型が変わった`);
  return v;
}

// ── A) 組込 6 車種の保護 ──────────────────────────────────────────────────────────
function checkA(m) {
  const v = [], { cfg } = m;
  const s0 = tableState(cfg);
  const json0 = Object.fromEntries(BUILTIN.map((k) => [k, JSON.stringify(cfg.CAR_TYPE_BY_KEY[k])]));
  if (!BUILTIN.every((k) => cfg.CAR_TYPE_BY_KEY[k])) v.push('母集団: 組込 6 車種が揃っていない');
  for (const k of BUILTIN) {
    if (!cfg.isBuiltinCarKey(k)) v.push(`isBuiltinCarKey('${k}') が false`);
    const defs = [
      { key: k, name: '偽', maxSpeed: 1.9, accel: 2.5 },                  // 部分 def（投稿車種・自作車の典型）
      { ...clone(cfg.CAR_TYPE_BY_KEY[k]), maxSpeed: 1.9 },                 // 完全 def（公式レースの carDefForEntry と同じ形）
      { key: k, drift: { grip: 0.1 } },                                    // drift だけ
      { key: k, drift: null },                                             // drift を消す
      { key: k, name: '偽', custom: true, community: true },              // 印を自称する
      { key: [k], name: '偽', maxSpeed: 1.9 },                            // 非文字列 key（CAR_TYPE_BY_KEY[[k]] は k を引く）
      { key: { toString: () => k }, name: '偽', maxSpeed: 1.9 },          // 文字列へ変換すると組込になるオブジェクト
    ];
    for (const d of defs) {
      const r = cfg.registerCarType(d);
      if (r !== null) v.push(`registerCarType(${String(JSON.stringify(d)).slice(0, 60)}) が null を返さない`);
    }
    if (cfg.unregisterCarType(k) !== false) v.push(`unregisterCarType('${k}') が false を返さない`);
    const now = String(JSON.stringify(cfg.CAR_TYPE_BY_KEY[k]));   // 消えていれば 'undefined'
    if (now !== json0[k]) v.push(`${k} の定義が変わった（${now.slice(0, 80)}）`);
  }
  for (const k of ['be3_none', 'constructor', 'normal_fr_copy']) if (cfg.isBuiltinCarKey(k)) v.push(`isBuiltinCarKey('${k}') が true`);
  v.push(...diffState(s0, tableState(cfg), 'A) 後'));
  return v;
}

// ── B) 自作車は従来どおり（追加・更新・継承・削除）────────────────────────────────────
function checkB(m) {
  const v = [], { cfg } = m;
  const n0 = cfg.CAR_TYPES.length;
  const a = cfg.registerCarType({ key: 'be3_c', name: 'C', maxSpeed: 1.2 });
  if (!a || !a.custom || cfg.CAR_TYPE_BY_KEY.be3_c !== a || cfg.CAR_TYPES.length !== n0 + 1) v.push('自作車の追加が車種表に入らない');
  const idx = cfg.CAR_TYPES.findIndex((t) => t.key === 'be3_c');
  const b = cfg.registerCarType({ key: 'be3_c', name: 'C2', maxSpeed: 0.9 });
  if (!b || b.maxSpeed !== 0.9 || b.name !== 'C2' || cfg.CAR_TYPE_BY_KEY.be3_c !== b) v.push('同じ key の再登録で更新されない');
  if (cfg.CAR_TYPES.length !== n0 + 1 || cfg.CAR_TYPES[idx] !== b) v.push('再登録で並びが変わった（その場で置き換わるはず）');
  // drift 未指定は現行の定義から継承（旧 registerCarType と同じ規則。自作車の JSON を部分的に直す運用を壊さない）
  cfg.registerCarType({ key: 'be3_d', name: 'D', drift: { grip: 0.5 } });
  const d2 = cfg.registerCarType({ key: 'be3_d', name: 'D', maxSpeed: 1.0 });
  if (!d2 || !d2.drift || d2.drift.grip !== 0.5) v.push(`drift 未指定の再登録で drift が継承されない（${JSON.stringify(d2 && d2.drift)}）`);
  const d3 = cfg.registerCarType({ key: 'be3_d', name: 'D', drift: null });
  if (!d3 || d3.drift !== null) v.push('drift: null の再登録で drift が消えない');
  if (cfg.unregisterCarType('be3_c') !== true || cfg.CAR_TYPE_BY_KEY.be3_c) v.push('自作車が削除できない');
  if (cfg.unregisterCarType('be3_d') !== true) v.push('自作車 be3_d が削除できない');
  if (cfg.CAR_TYPES.length !== n0) v.push(`B) 後の車種数 ${cfg.CAR_TYPES.length}（${n0} のはず）`);
  return v;
}

// ── C) 公式レースの持ち込み車種はレースの間だけ ─────────────────────────────────────────
function raceKit(m) {
  const { cfg, eng, crs, prog } = m;
  const course = crs.buildFromSpec(SPECS.find((s) => s.name === 'オーバル'));
  const p = prog.PROGRAM_BY_KEY.normal_fr;
  const run = (field) => eng.runRace({ course, laps: 2, maxSec: 30, interact: true, field, physics: 'dynamic' }).verifyHash;
  const you = { name: 'you', lang: p.lang, src: p.code, carType: 'normal_fr' };
  const plainField = () => [you, { ...you, name: 'b', carType: 'drift_fr' }];
  const defsField = () => {
    const modFR = { ...clone(cfg.CAR_TYPE_BY_KEY.normal_fr), maxSpeed: 1.9, accel: 2.5 };   // V3 で上書きした組込 FR を同梱した形
    const modDrift = { ...clone(cfg.CAR_TYPE_BY_KEY.drift_fr), maxSpeed: 1.3 }; delete modDrift.drift;   // drift 未指定＝継承の枝
    return [you,
      { name: 'rec', lang: p.lang, src: p.code, carType: 'normal_fr', carDef: modFR },
      { name: 'd', lang: p.lang, src: p.code, carType: 'drift_fr', carDef: modDrift },
      { name: 'x', lang: p.lang, src: p.code, carType: 'be3_x', carDef: { key: 'be3_x', name: 'X', maxSpeed: 1.2 } }];
  };
  return { run, plainField, defsField };
}
function checkC(m) {
  const v = [], { cfg } = m;
  const { run, plainField, defsField } = raceKit(m);
  // 利用者の自作車が先にある（持ち込み車種が同じ key で上書きしても、レース後は利用者のものへ戻る）
  const mine = cfg.registerCarType({ key: 'be3_y', name: '私の Y', maxSpeed: 0.8 });
  const h0 = run(plainField());
  if (h0 !== FROZEN.plain) v.push(`持ち込み無しのレース ${h0}（凍結 ${FROZEN.plain}）`);
  const s0 = tableState(cfg);
  const field = defsField();
  field.push({ ...field[3], name: 'y', carType: 'be3_y', carDef: { key: 'be3_y', name: '他人の Y', maxSpeed: 1.5 } });
  const hd = run(field.slice(0, 4));
  if (hd !== FROZEN.withDefs) v.push(`持ち込み車種のレース ${hd}（凍結 ${FROZEN.withDefs}）＝レース中の挙動が改修前と違う`);
  const hNoDef = run(field.slice(0, 4).map((e) => ({ ...e, carDef: undefined })));
  if (hNoDef === hd) v.push(`carDef を外しても結果が同じ（${hd}）＝持ち込み車種がレース中に効いていない（C) の検出力が無い）`);
  run(field);   // 利用者の自作車 be3_y と同じ key の持ち込み
  v.push(...diffState(s0, tableState(cfg), 'C) 持ち込み車種のレース後'));
  if (cfg.CAR_TYPE_BY_KEY.be3_x) v.push('持ち込まれた新しい key be3_x がレース後に残った');
  if (cfg.CAR_TYPE_BY_KEY.be3_y !== mine || mine.maxSpeed !== 0.8) v.push('利用者の自作車 be3_y がレース後に他人の定義のまま');
  if (cfg.CAR_TYPE_BY_KEY.normal_fr.maxSpeed === 1.9 || cfg.CAR_TYPE_BY_KEY.normal_fr.custom) v.push('組込 normal_fr がレース後に持ち込みの定義のまま');
  const h1 = run(plainField());
  if (h1 !== FROZEN.plain) v.push(`持ち込み車種のレースの後の同じ field ${h1}（凍結 ${FROZEN.plain}）＝前のレースの定義が居残った`);
  cfg.unregisterCarType('be3_y');
  return v;
}

// ── D) 形の変わった key・レース中の例外 ──────────────────────────────────────────────
function checkD(m) {
  const v = [], { cfg } = m;
  const { run, plainField } = raceKit(m);
  const P = (key, name) => ({ key, name, maxSpeed: 1.1 });
  const cases = [
    ['__proto__', [JSON.parse('{"key":"__proto__","name":"P","maxSpeed":1.1}')]],
    ['5 と \'5\'', [P(5, 'five'), P('5', 'five-s')]],
    ["['normal_fr']", [P(['normal_fr'], 'arr')]],
    ['オブジェクト 2 つ', [P({ a: 1 }, 'o1'), P({ b: 2 }, 'o2')]],
  ];
  for (const [label, defs] of cases) {
    const s0 = tableState(cfg);
    const f = plainField();
    for (const d of defs) f.push({ ...f[1], name: String(d.name), carType: d.key, carDef: d });
    try { run(f); } catch (e) { v.push(`${label}: レースが例外（${e.message}）`); }
    v.push(...diffState(s0, tableState(cfg), `D) ${label} の後`));
    if ('maxSpeed' in cfg.CAR_TYPE_BY_KEY) v.push(`D) ${label}: 車種表が持ち込み車種を原型に持ったまま`);
  }
  // 先に利用者の '__proto__' の自作車がある（改修前からある経路で入りうる）→ 同じ key を持ち込むレースの後も戻る
  {
    const mine = cfg.registerCarType(JSON.parse('{"key":"__proto__","name":"mine","maxSpeed":0.7}'));
    const s0 = tableState(cfg);
    const f = plainField();
    f.push({ ...f[1], name: 'p', carType: '__proto__', carDef: JSON.parse('{"key":"__proto__","name":"theirs","maxSpeed":1.4}') });
    run(f);
    v.push(...diffState(s0, tableState(cfg), 'D) 既存の __proto__ 自作車'));
    if (Object.getPrototypeOf(cfg.CAR_TYPE_BY_KEY) !== mine) v.push('D) 既存の __proto__ 自作車の原型が戻らない');
    const i = cfg.CAR_TYPES.indexOf(mine); if (i >= 0) cfg.CAR_TYPES.splice(i, 1);   // 後始末（この性質は改修前から・未決）
    Object.setPrototypeOf(cfg.CAR_TYPE_BY_KEY, Object.prototype);
  }
  // 登録の途中で例外（key が {"toString":1} の carDef は CAR_TYPE_BY_KEY[key] の文字列化で投げる＝PR で来うる JSON。
  //   先に組込 key の持ち込みを登録してから投げるので、戻さなければ組込 FR が持ち込みの定義のまま残る）
  {
    const s0 = tableState(cfg);
    const f = plainField();
    f.push({ ...f[1], name: 'fr', carType: 'normal_fr', carDef: { key: 'normal_fr', name: '偽', maxSpeed: 1.9 } });
    f.push({ ...f[1], name: 'bad', carType: 'x', carDef: JSON.parse('{"key":{"toString":1},"name":"bad"}') });
    let threw = false;
    try { run(f); } catch (e) { threw = true; }
    if (!threw) v.push('D) 登録中の例外: runRace が投げない（経路を通っていない＝空振り）');
    v.push(...diffState(s0, tableState(cfg), 'D) 登録中の例外の後'));
    if (cfg.CAR_TYPE_BY_KEY.normal_fr.maxSpeed === 1.9) v.push('D) 登録中の例外の後、組込 normal_fr が持ち込みの定義のまま');
  }
  // レースの途中で例外（プログラム本文の getter が投げる entry。持ち込み車種の登録は済んだ後で起きる）
  {
    const s0 = tableState(cfg);
    const f = plainField();
    f[1] = { ...f[1], carType: 'be3_boom', carDef: { key: 'normal_fr', name: '偽', maxSpeed: 1.9 } };
    f.push({ name: 'boom', lang: f[0].lang, carType: 'be3_new', carDef: { key: 'be3_new', name: 'N' }, get src() { throw new Error('BE3 getter'); } });
    let threw = false;
    try { run(f); } catch (e) { threw = /BE3 getter/.test(String(e && e.message)); }
    if (!threw) v.push('D) 例外の経路: getter の例外が runRace から出てこない（経路を通っていない＝空振り）');
    v.push(...diffState(s0, tableState(cfg), 'D) レース中の例外の後'));
  }
  return v;
}

// ── E) キャッシュ混在 ────────────────────────────────────────────────────────────
// 改修前の config.js 相当: BE3 が config.js に入れた「組込 key の拒否」と「registerRaceCarTypes の export」を外す。
//   外したあとの registerCarType は改修前の本体そのもの（_putCarType は改修前の本体を移しただけ）。
//   外す文字列が見つからなければ（実装とズレたら）赤にする＝黙って新しい config.js のまま測らない。
const E_REVERT = [
  ['  if (BUILTIN_CAR_KEYS.has(String(def.key))) return null;\n', ''],
  ['export function registerRaceCarTypes(defs) {', 'function registerRaceCarTypes(defs) {'],
];
const _eTmps = [];
async function checkE(dir = JS_ROOT) {
  const v = [];
  let old = fs.readFileSync(path.join(dir, 'config.js'), 'utf8');
  for (const [a, b] of E_REVERT) { if (!old.includes(a)) return [`E) 改修前相当へ戻す文字列が無い（${a.trim().slice(0, 50)}）＝実装とズレた`]; old = old.replace(a, b); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf_be3_mix_'));
  _eTmps.push(tmp);
  fs.cpSync(dir, tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'config.js'), old);
  let m;
  try { m = await loadTree(tmp); } catch (e) { return [`改修前の config.js と組み合わせると読み込めない（${e.message}）`]; }
  const { run, defsField } = raceKit(m);
  const h = run(defsField());
  if (h !== FROZEN.withDefs) v.push(`混在ツリーの持ち込み車種のレース ${h}（改修前 ${FROZEN.withDefs}）`);
  return v;
}

const real = await loadTree(JS_ROOT);
console.log('='.repeat(78));
console.log('BE3 組込車種の保護（投稿車種・自作車・公式レースの持ち込み車種）');
console.log('='.repeat(78));
console.log('\n  A) 組込 6 車種は registerCarType / unregisterCarType で 1 bit も変わらない');
report('A) 違反', checkA(real));
console.log('\n  B) 自作車は従来どおり（追加・その場で更新・drift の継承・削除）');
report('B) 違反', checkB(real));
console.log(`\n  C) 持ち込み車種はレースの間だけ（凍結 plain=${FROZEN.plain}・withDefs=${FROZEN.withDefs}・改修前ツリーで刻んだ値）`);
report('C) 違反', checkC(real));
console.log("\n  D) 形の変わった key（'__proto__'・非文字列）・レース中の例外でも車種表が元どおり");
report('D) 違反', checkD(real));
console.log('\n  E) キャッシュ混在: 改修前相当の config.js ＋新しい race_engine.js で読み込めて改修前と同じ結果');
report('E) 違反', await checkE());
// ── G) 検出力（変異）─────────────────────────────────────────────────────────────
console.log('\n  G) 変異試験（一時ツリーの config.js / race_engine.js を壊して A)〜D) が赤くなるか）');
// 改修中の初版 registerRaceCarTypes（key ごとに退避して個別に戻す）。層 4 が非文字列 key で重複・戻し残しを実測した形。
const FIRST_VERSION = `export function registerRaceCarTypes(defs) {
  const own = (k) => Object.prototype.hasOwnProperty.call(CAR_TYPE_BY_KEY, k);
  const proto = Object.getPrototypeOf(CAR_TYPE_BY_KEY);
  const saved = [];
  for (const def of defs) {
    if (!def || !def.key) continue;
    if (!saved.some(([k]) => k === def.key)) saved.push([def.key, own(def.key) ? CAR_TYPE_BY_KEY[def.key] : undefined]);
    _putCarType(def);
  }
  return function restoreRaceCarTypes() {
    for (let i = saved.length - 1; i >= 0; i--) {
      const [key, prev] = saved[i];
      const idx = CAR_TYPES.findIndex(x => x.key === key);
      if (prev === undefined) {
        if (idx >= 0) CAR_TYPES.splice(idx, 1);
        if (own(key)) delete CAR_TYPE_BY_KEY[key];
      } else {
        if (idx >= 0) CAR_TYPES[idx] = prev; else CAR_TYPES.push(prev);
        CAR_TYPE_BY_KEY[key] = prev;
      }
    }
    if (Object.getPrototypeOf(CAR_TYPE_BY_KEY) !== proto) Object.setPrototypeOf(CAR_TYPE_BY_KEY, proto);
  };
}`;
const MUTATIONS = [
  ['registerCarType の組込保護を外す（改修前）', 'A',
    (s) => s.replace('  if (BUILTIN_CAR_KEYS.has(String(def.key))) return null;\n', '')],
  ['registerCarType が組込 key に custom 印を付けて置き換える（→ unregisterCarType でも消せてしまう）', 'A',
    (s) => s.replace('  if (BUILTIN_CAR_KEYS.has(String(def.key))) return null;\n', '  if (BUILTIN_CAR_KEYS.has(String(def.key)) && def.name !== \'偽\') return null;\n')],
  ['組込判定で key を文字列にしない（[\'normal_fr\'] ですり抜ける）', 'A',
    (s) => s.replace('  if (BUILTIN_CAR_KEYS.has(String(def.key))) return null;\n', '  if (BUILTIN_CAR_KEYS.has(def.key)) return null;\n')],
  ['組込の判定集合が空（評価順を誤って登録後に作る等）', 'A',
    (s) => s.replace('const BUILTIN_CAR_KEYS = new Set(CAR_TYPES.map(t => t.key));', 'const BUILTIN_CAR_KEYS = new Set();')],
  ['レース後に戻さない（finally の呼び出しを消す）', 'C',
    (s) => s.replace('    if (restoreCarTypes) restoreCarTypes();', ''), 'race_engine.js'],
  ['持ち込み車種を registerCarType で登録する（組込 key を拒む＝公式記録が再現しない）', 'C',
    (s) => s.replace('    if (configNS.registerRaceCarTypes) restoreCarTypes = configNS.registerRaceCarTypes(carDefs);', '    if (false) restoreCarTypes = null;'), 'race_engine.js'],
  ['race_engine が新しい名前を名前付き import する（古い config.js がキャッシュに残ると起動しない）', 'E',
    (s) => s.replace('registerCarType, SCALE_STATE', 'registerCarType, registerRaceCarTypes, SCALE_STATE'), 'race_engine.js'],
  ['登録の途中で投げたら戻さない（戻す関数を返す前に抜ける）', 'D',
    (s) => s.replace('  catch (e) { restoreRaceCarTypes(); throw e; }', '  catch (e) { throw e; }')],
  ['新しく持ち込まれた key を消さない', 'C',
    (s) => s.replace('    for (const k of Object.keys(CAR_TYPE_BY_KEY)) delete CAR_TYPE_BY_KEY[k];\n', '')],
  ['並びを戻さない（鍵の表だけ戻す）', 'C',
    (s) => s.replace('    CAR_TYPES.length = 0;\n    for (const t of list) CAR_TYPES.push(t);\n', '')],
  ['写しを登録の後に取る（戻す先が持ち込みの定義になる）', 'C',
    (s) => s.replace("  const list = CAR_TYPES.slice();\n  const byKey = Object.keys(CAR_TYPE_BY_KEY).map(k => [k, CAR_TYPE_BY_KEY[k]]);\n", '')
            .replace('  catch (e) { restoreRaceCarTypes(); throw e; }\n', "  catch (e) { restoreRaceCarTypes(); throw e; }\n  const list = CAR_TYPES.slice();\n  const byKey = Object.keys(CAR_TYPE_BY_KEY).map(k => [k, CAR_TYPE_BY_KEY[k]]);\n")],
  ['key を突き合わせて個別に戻す（改修中の初版そのもの＝非文字列 key で重複・戻し残し）', 'D',
    (s) => { const a = s.indexOf('export function registerRaceCarTypes(defs) {'), b = s.indexOf('// 独自車種の登録解除 (個別削除)');
      return a < 0 || b < 0 ? s : s.slice(0, a) + FIRST_VERSION + '\n\n' + s.slice(b); }],
  ['車種表の原型を戻さない', 'D',
    (s) => s.replace('    if (Object.getPrototypeOf(CAR_TYPE_BY_KEY) !== proto) Object.setPrototypeOf(CAR_TYPE_BY_KEY, proto);\n', '')],
];
const FILES = ['config.js', 'race_engine.js'];
const RAWS = Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(path.join(JS_ROOT, f), 'utf8')]));
const CH = { A: checkA, B: checkB, C: checkC, D: checkD, E: null };
const miss = [], noop = [], tmps = [];
for (const [name, chapter, fn, file = 'config.js'] of MUTATIONS) {
  const RAW = RAWS[file];
  const mutated = fn(RAW);
  if (mutated === RAW) { noop.push(`${name}（変異が適用されていない＝パターンが実装とズレた）`); continue; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf_be3_mut_'));
  tmps.push(tmp);
  fs.cpSync(JS_ROOT, tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, file), mutated);
  let caught, threw = null;
  const log = console.log; console.log = () => {};
  try { caught = chapter === 'E' ? (await checkE(tmp)).length : CH[chapter](await loadTree(tmp)).length; }
  catch (e) { caught = 1; threw = (e && e.message) || String(e); }   // 読み込み・実行で落ちるのも検出（赤）。理由は必ず出す
  finally { console.log = log; }
  if (caught === 0) miss.push(`${name} → ${chapter}) が見逃した`);
  else console.log(`     ✓ ${name} → ${chapter}) が ${threw ? `例外で赤（${threw.slice(0, 90)}）` : `${caught} 件で赤`}`);
}
console.log(`  変異 ${MUTATIONS.length} 件を注入（product のファイルは無改変）`);
report('G) 見逃した変異', miss);
report('G) 適用できなかった変異（パターン腐り）', noop);
{
  const changed = FILES.filter((f) => fs.readFileSync(path.join(JS_ROOT, f), 'utf8') !== RAWS[f]);
  if (changed.length) { pass = false; console.log(`  ✗ ゲートの実行で ${changed.join(', ')} が変化した`); }
  else console.log(`  ✓ public/js/{${FILES.join(', ')}} は実行前後で無変化`);
}
for (const d of tmps.concat(_eTmps)) fs.rmSync(d, { recursive: true, force: true });

console.log('\n' + '='.repeat(78));
console.log(pass ? 'BE3 組込車種の保護・ゲート: 全パス ○' : 'BE3 組込車種の保護・ゲート: ✗ 不合格');
console.log('='.repeat(78));
process.exit(pass ? 0 : 1);
