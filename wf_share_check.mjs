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
// さらに **投稿導線 (loader.js)** を検査する (AZ1・2026-09-12):
//   ⑧ 投稿先 URL が **投稿物の大きさに依存しない** = 壁を増やしても長さが 1 byte も動かない
//   ⑨ 投稿物が URL に載らない / 往復で欠けない / ファイル名が安全
// 1 つでも失敗したら非ゼロ終了 (本番 import パスで実行=CI-8/9)。

import { encodeState, decodeState, normalizeState, SHARE_FIELDS, SHARE_VERSION, hasShareState } from './public/js/share.js';
import * as loader from './public/js/loader.js';
import { uploadPageUrl, courseSubmission, programSubmission } from './public/js/loader.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function noThrow(fn, msg) {
  try { fn(); pass++; return true; }
  catch (e) { fail++; fails.push(msg + ' — THREW: ' + (e && e.message)); return false; }
}

// 【AV2 是正】ALL_NULL は SHARE_FIELDS から **導出** する。以前はフィールド名を書き写したリテラルで、
// スキーマへ 1 行足すたび③/⑦の 5 アサートが「値が違う」で落ちる第2真実源になっていた
// (AV1 で SURFACE_KINDS に同じ是正をした型)。**フィールド集合そのものの検出力**は下の
// スキーマ節 (件数・短縮キー一意・状態キー一意) と、直下の期待名リストが担う。
const ALL_NULL = Object.fromEntries(SHARE_FIELDS.map(f => [f.name, null]));
// 期待するフィールド名の明示リスト (導出化で検出力が消えないための固定点。スキーマを変えたらここも直す)。
const EXPECT_NAMES = ['course', 'car', 'program', 'regime', 'laps', 'noise', 'theme', 'lang',
                      'physics', 'tire', 'recon', 'wear', 'gear', 'susp', 'steerSet', 'brake'];

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
ok(SHARE_FIELDS.map(f => f.name).join(',') === EXPECT_NAMES.join(','),
   'スキーマのフィールド名が期待どおり (順序込み): ' + SHARE_FIELDS.map(f => f.name).join(','));
ok(SHARE_FIELDS.length === 16, 'スキーマ 16 フィールド (Stage AO1: physics / AO6: tire / AO9: recon / AO12: wear / AS9: gear / AS11: susp / AS12: steerSet / AV2: brake 追加)');
ok(new Set(SHARE_FIELDS.map(f => f.k)).size === 16, '短縮キー一意');
ok(new Set(SHARE_FIELDS.map(f => f.name)).size === 16, '状態キー一意');
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
// ---- AS9 前方互換の byte 不変: gear 未指定/既定の従来状態は 'gr=' を一切出さない (既存共有 URL 不変) ----
ok(!encodeState(legacyFull).includes('gr='), 'AS9: gear 省略時は gr= を出さない (既存 hash byte 不変)');
ok(encodeState({ gear: 'auto2' }).includes('gr=auto2'), 'AS9: gear 明示時は往復する (gr=auto2)');
ok(decodeState(encodeState({ gear: 'tall' })).gear === 'tall', 'AS9: gear=tall が往復');

// ---- AS11 前方互換の byte 不変: susp 未指定/既定の従来状態は 'sp=' を一切出さない (既存共有 URL 不変) ----
ok(!encodeState(legacyFull).includes('sp='), 'AS11: susp 省略時は sp= を出さない (既存 hash byte 不変)');
ok(encodeState({ susp: 'balanced' }).includes('sp=balanced'), 'AS11: susp 明示時は往復する (sp=balanced)');
ok(decodeState(encodeState({ susp: 'soft' })).susp === 'soft', 'AS11: susp=soft が往復');
ok(decodeState(encodeState({ tire: 'rain' })).tire === 'rain', 'AS9: tire=rain が往復');

// ---- AS12 前方互換の byte 不変: steerSet 未指定/既定の従来状態は 'ss=' を一切出さない (既存共有 URL 不変) ----
ok(!encodeState(legacyFull).includes('ss='), 'AS12: steerSet 省略時は ss= を出さない (既存 hash byte 不変)');
ok(encodeState({ steerSet: 'prop' }).includes('ss=prop'), 'AS12: steerSet 明示時は往復する (ss=prop)');
ok(decodeState(encodeState({ steerSet: 'prop' })).steerSet === 'prop', 'AS12: steerSet=prop が往復');
ok(decodeState(encodeState({ steerSet: 'tri' })).steerSet === 'tri', 'AS12: steerSet=tri も明示すれば往復 (捕捉側が省略するだけ)');
ok(encodeState({ susp: 'soft', steerSet: 'prop' }).indexOf('sp=') < encodeState({ susp: 'soft', steerSet: 'prop' }).indexOf('ss='), 'AS12: 新フィールドは末尾 (既存キーの並び順を動かさない)');

// ===== ⑧⑨ 投稿導線 (loader.js) — URL 長への非依存 (AZ1・2026-09-12) ==============
// 【この節が守っている事実 (実測)】
// github.com がクエリ付き URL を受理する上限は **約 6,600 文字**
//   (6,692→302 正常 / 7,092→500 / 8,092→接続断 / 9,092 以上→414)。
// 旧方式は投稿物の全文を `?value=` に載せていたため、
//   ・利用者の実投稿コース (壁 366 本) = 丸めた提出ファイルで 80,391 / 編集器の生値で 250,233 文字
//   ・同梱プログラム 23 本中 18 本 (最大 40,747 文字)
// が上限を超え、**ボタンを押しても何も開かない** 状態だった。
// 圧縮では届かない (minify + 3 桁丸め + 壁の配列化まで行っても 36,829 = 上限の 5.6 倍) ので、
// **URL からデータを外した**。この節は「また載せ始めていないか」を機械で見張る。
// 判定は二値で終わらせず、**上限に対するマージンを連続量で出す** (CI-14)。
const GH_URL_LIMIT = 6600;          // 実測した github.com の受理上限 (文字)
const NAV_URL_BUDGET = 2000;        // 受け入れ基準 (AZ1): 遷移先 URL は 2,000 文字未満

// 決定論の合成コース。座標は **丸めない** = 編集器 (course_editor.js toJSON) が持つ生の倍精度
// を模す。丸めた提出ファイルより 3 倍長くなる側 = 最悪ケースで検査する。
function synthCourse(nWalls, name = 'gate-course') {
  const walls = [];
  for (let i = 0; i < nWalls; i++) {
    const a = (i * Math.PI) / 97, b = (i * Math.E) / 89;   // 無理数比 = 循環しない桁を作る
    walls.push({ x1: 1 + Math.sin(a) / 3, y1: 1 + Math.cos(a) / 3,
                 x2: 1 + Math.sin(b) / 3, y2: 1 + Math.cos(b) / 3 });
  }
  return { name, bounds: { w: 18.36326, h: 18.70771 },
           start: { x: 4.131, y: 7.649, theta: 0.639579127024498 },
           finish: { x1: 4.04147, y1: 7.76935, x2: 4.22053, y2: 7.52865 }, walls };
}

// --- ⑧-1 旧ビルダー (URL に本文を載せる経路) が再導入されていないこと ---
ok(!('shareCourseUrl' in loader),
   '⑧ loader.js が shareCourseUrl を再び export していない (URL に本文を載せる経路の復活)');
ok(!('shareProgramUrl' in loader),
   '⑧ loader.js が shareProgramUrl を再び export していない (同上)');
ok(typeof uploadPageUrl === 'function' && typeof courseSubmission === 'function'
   && typeof programSubmission === 'function', '⑧ 新方式の 3 関数が export されている');
// **データを受け取る口そのものを持たせない**。長さだけを見る検査は、引数を増やして
// `?value=` を付け足す変異を素通りさせた (本ゲートの変異試験で実測)。ゆえに
//   (a) uploadPageUrl の引数は dir の 1 つだけ
//   (b) 返す URL にクエリもフラグメントも無い
// という**構造**を固定する。これなら中身が空でも「載せる口ができた」時点で赤になる。
ok(uploadPageUrl.length === 1,
   `⑧ uploadPageUrl の引数は dir の 1 つだけ = 投稿物を渡す口が無い (実測 ${uploadPageUrl.length} 個)`);
// ⚠ **Function.length は既定値の手前までしか数えない**。`uploadPageUrl(dir, value = '')` と書けば
// length は 1 のままで、本文を**パスに**埋めればクエリ検査も素通りする (層 4 レビューで実証された)。
// 長さ・引数個数・部分一致では足りない。**遷移先 URL が取りうる値そのもの**を固定する:
//   origin + pathname が `https://github.com/<owner>/<repo>/upload/<branch>/<dir>` と**完全一致**。
// これ 1 本で「endpoint を /new/ に戻す」「データをパスに埋める」「投稿先をずらす」を同時に塞ぐ。
const { owner: OWNER, repo: REPO, branch: BRANCH } = loader.COURSE_REPO;
function expectNav(dir) { return `https://github.com/${OWNER}/${REPO}/upload/${BRANCH}/${dir}`; }
for (const dir of ['courses/community', 'programs/community']) {
  ok(uploadPageUrl(dir) === expectNav(dir),
     `⑧ 遷移先 URL が期待値と完全一致 (${dir}): 実測 ${uploadPageUrl(dir)} / 期待 ${expectNav(dir)}`);
  ok(new URL(uploadPageUrl(dir)).pathname === `/${OWNER}/${REPO}/upload/${BRANCH}/${dir}`,
     `⑧ pathname が完全一致 = 本文をパスに埋める変異も落ちる (${dir})`);
}
// dir の取り違えは黙って `.../undefined` を開かせるので throw させる。
for (const bad of [undefined, null, '', 0, {}, []]) {
  let threw = false;
  try { uploadPageUrl(bad); } catch (e) { threw = true; }
  ok(threw, `⑧ uploadPageUrl(${JSON.stringify(bad)}) は throw する (実在しないページを開かせない)`);
}

// --- ⑧-2 遷移先 URL が投稿物の大きさに **1 byte も** 依存しないこと ---
const WALL_COUNTS = [0, 8, 24, 366, 2000, 10000];   // 実投稿は 366 本。上下に広く掃く
const navUrls = [];
let maxTextLen = 0;
for (const n of WALL_COUNTS) {
  const sub = courseSubmission(synthCourse(n));
  const nav = uploadPageUrl(sub.dir);
  navUrls.push(nav);
  maxTextLen = Math.max(maxTextLen, sub.text.length);
  ok(nav.length < NAV_URL_BUDGET,
     `⑧ 壁 ${n} 本でも遷移先 URL < ${NAV_URL_BUDGET} 文字 (実測 ${nav.length})`);
  ok(!/[?&#]/.test(nav),
     `⑧ 壁 ${n} 本: 遷移先 URL にクエリ/フラグメントが無い (データを載せる場所そのものが無い): ${nav}`);
  ok(!nav.includes(String(sub.text.length)) || n === 0,
     `⑧ 壁 ${n} 本: 遷移先 URL に本文長が現れない`);
  // 本文の一部 (末尾の壁座標) が URL に混ざっていないこと = 「載せ始めた」の直接検出
  if (n > 0) {
    const probe = String(sub.text).slice(-40);
    ok(!nav.includes(probe), `⑧ 壁 ${n} 本: 遷移先 URL に本文の断片が含まれない`);
  }
}
const uniqNav = new Set(navUrls);
ok(uniqNav.size === 1,
   `⑧ 遷移先 URL は投稿物によらず **同一文字列** (壁 ${WALL_COUNTS.join('/')} 本で ${uniqNav.size} 種): `
   + [...uniqNav].join(' | '));
const navLen = navUrls[0].length;
ok(navLen < NAV_URL_BUDGET, `⑧ 遷移先 URL 長 ${navLen} < 予算 ${NAV_URL_BUDGET}`);
// マージン (連続量)。旧方式は最大 250,233 文字で上限の 38 倍だった。
const marginChars = GH_URL_LIMIT - navLen;
const marginRatio = GH_URL_LIMIT / navLen;
ok(marginChars > 0,
   `⑧ 受理上限 ${GH_URL_LIMIT} に対するマージン ${marginChars} 文字 (${marginRatio.toFixed(1)} 倍の余裕)`);
ok(maxTextLen > 100000,
   `⑧ 検査に使った最大投稿物が十分大きい (実測 ${maxTextLen} 文字 = 実投稿 366 本の worst case を超える)`);

// --- ⑧-3 プログラム側も同じ性質を持つこと (同梱 23 本中 18 本が旧方式では超過していた) ---
for (const [lang, ext] of [['c', 'ino'], ['py', 'py'], ['js', 'js'], ['zzz', 'ino']]) {
  for (const len of [0, 1000, 40000, 300000]) {
    const sub = programSubmission('あ'.repeat(len), 'my program', lang);   // 日本語 = 符号化で約 3 倍
    const nav = uploadPageUrl(sub.dir);
    ok(nav.length < NAV_URL_BUDGET,
       `⑧ プログラム ${lang}/${len} 文字でも遷移先 URL < ${NAV_URL_BUDGET} (実測 ${nav.length})`);
    ok(!/[?&#]/.test(nav), `⑧ プログラム ${lang}/${len}: 遷移先 URL にクエリ/フラグメントが無い`);
    ok(sub.filename.endsWith('.' + ext),
       `⑧ 拡張子 ${lang} → .${ext} (実測 ${sub.filename})`);
    ok(sub.text.length === len, `⑧ プログラム本文が欠けない (${lang}/${len} → ${sub.text.length})`);
  }
}
const progNav = uploadPageUrl(programSubmission('x', 'n', 'c').dir);
ok(progNav !== navUrls[0], '⑧ コースとプログラムの投稿先ディレクトリは別');
// **投稿先そのものを固定する**。上の「期待値と完全一致」は dir を引数で渡しているので、
// COMMUNITY_DIR をずらす変異 (例: 'courses/community/sub') では期待値も一緒に動いて素通りした
// (層 4 レビュー後の再変異試験で実測)。submission が返す dir を literal で釘付けにする。
ok(courseSubmission({ name: 'x', walls: [] }).dir === 'courses/community',
   `⑧ コースの投稿先は courses/community に固定 (実測 ${courseSubmission({ name: 'x', walls: [] }).dir})`);
ok(programSubmission('x', 'n', 'c').dir === 'programs/community',
   `⑧ プログラムの投稿先は programs/community に固定 (実測 ${programSubmission('x', 'n', 'c').dir})`);
ok(navUrls[0] === expectNav('courses/community'),
   `⑧ コースの遷移先が期待値と完全一致: ${navUrls[0]}`);
ok(progNav === expectNav('programs/community'),
   `⑧ プログラムの遷移先が期待値と完全一致: ${progNav}`);

// --- ⑨-1 投稿物が往復で欠けないこと (URL を通らなくなっても中身は同じ) ---
{
  const src = synthCourse(366, '富士スピードウェイ');
  const sub = courseSubmission(src);
  ok(!('url' in sub), '⑨ 投稿物に url フィールドが無い (URL に載せる誘惑を構造的に断つ)');
  let back = null;
  noThrow(() => { back = JSON.parse(sub.text); }, '⑨ 投稿物の text が JSON として読める');
  ok(eq(back, src), '⑨ 投稿物が原本と deep-equal (壁 366 本・丸めなし)');
  ok(sub.mime === 'application/json', '⑨ コースの mime は application/json');
}

// --- ⑨-2 ファイル名が安全であること (投稿者が自由に名前を付ける = 素性不明の文字列) ---
const NAMES = ['富士スピードウェイ', 'My Course #1', '../../etc/passwd', 'a/b\\c',
               '  ', '', 'ALL CAPS', 'x'.repeat(300), 'a#b?c&d=e', '🚗💨'];
for (const nm of NAMES) {
  for (const sub of [courseSubmission({ name: nm, walls: [] }), programSubmission('x', nm, 'c')]) {
    ok(!/[/\\]/.test(sub.filename), `⑨ ファイル名に区切り文字が無い: ${JSON.stringify(nm)} → ${sub.filename}`);
    ok(!sub.filename.startsWith('.'), `⑨ ファイル名が . で始まらない: ${JSON.stringify(nm)} → ${sub.filename}`);
    ok(sub.filename === encodeURIComponent(sub.filename).replace(/%2F/gi, '/'),
       `⑨ ファイル名が URL 符号化不要の文字だけ: ${JSON.stringify(nm)} → ${sub.filename}`);
    ok(sub.filename.length > 4, `⑨ ファイル名が空にならない: ${JSON.stringify(nm)} → ${sub.filename}`);
    // **上限も見る**。GitHub のパス構成要素は 255 byte 上限で、超えると投稿そのものが通らない。
    // 300 文字の名前は上の NAMES に実際に入っている — 踏んでいるのに見ていない状態を作らない。
    ok(Buffer.byteLength(sub.filename, 'utf8') <= 255,
       `⑨ ファイル名が GitHub のパス上限 255 byte 以内: ${JSON.stringify(nm).slice(0, 40)} → ${sub.filename.length} 文字 / ${Buffer.byteLength(sub.filename, 'utf8')} byte`);
    ok(typeof sub.mime === 'string' && sub.mime.length > 0,
       `⑨ mime が入っている (course/program 両方): ${sub.filename} → ${sub.mime}`);
  }
}
// 空名は時刻フォールバックに落ちる (決定論ではないので、形だけ検査する)
ok(/^course-\d+\.json$/.test(courseSubmission({ name: '', walls: [] }).filename),
   '⑨ 空のコース名は course-<時刻>.json へ落ちる');
ok(/^program-\d+\.ino$/.test(programSubmission('x', '', 'c').filename),
   '⑨ 空のプログラム名は program-<時刻>.ino へ落ちる');

// ---- 結果 ---------------------------------------------------------------------
const line = '─'.repeat(60);
console.log(line);
console.log('AF1 share.js 卓上ゲート  (encodeState/decodeState round-trip + 不正入力耐性)');
console.log('  + AZ1 投稿導線ゲート (loader.js: 遷移先 URL の投稿物非依存)');
console.log(`  遷移先 URL = ${navLen} 文字 (固定) / 受理上限 ${GH_URL_LIMIT} に対し ${marginRatio.toFixed(1)} 倍の余裕`);
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
if (fail) {
  console.log(line);
  for (const m of fails) console.log('  ✗ ' + m);
}
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
