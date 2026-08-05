// wf_as4_carray.mjs — Stage AS4「C インタプリタの配列対応（Recon Racer/Self-Locator の py 限定解消）」常設ゲート。
// PLAN AS4 改訂受け入れ基準 ①'（残ギャップ4件の是正）と ②'（C 移植 2 本の忠実性）を、
// **本番経路のみ**（buildController + buildApi / runRace）で機械検証する。再実装しない（CI-8/CI-9）。exit 非0=失敗。
//
// 背景（2026-08-04 の着手前ゲート実測・決定ログ AS-4）: C 配列サブセットは v4.0.0 で既に実装済みで、
//   残っていたのは (a) 関数の配列仮引数 `int a[]` (b) `sizeof` (c) 修飾子 const/static
//   (d) `char s[]="…"` が**エラーを出さず空配列になる**サイレント破綻、の4件だった。
//
//   A: 配列サブセットの意味論（宣言・添字読書・多次元・初期化・0埋め・仮引数・sizeof・修飾子）
//   B: サイレント破綻の可聴化（char 文字列初期化＝行番号付き i18n 実行時エラー）
//   C: py↔C 移植の同値性。**結果要約 verifyHash では測らない**——DNF が同形なら別プログラムでも
//      同値になり検出力がゼロだから（実測: recon_racer と comp_localize は verifyHash 9004f017 が一致）。
//      毎tick の tickChecksum を刻む traceHash・**学習した配列の全要素**・**全tick のアクチュエータ列**で測る。
//      さらに「配列経路が実際に走ったこと」（phase/lp が 1 に遷移し地図が埋まったこと）を同時に要求する
//      ＝退化した（地図を使わない）状態のまま緑にならない。
//   D: 検出力の実証。C 側を1定数だけ変異させると C が落ちることを実測する（緑の意味を保証）。
import { readFileSync } from 'node:fs';
import { buildController } from './public/js/runner.js';
import { buildApi } from './public/js/api.js';
import { buildFromSpec } from './public/js/course.js';
import { DynCar } from './public/js/physics_dyn.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.error('  ✗ ' + m); } };

const specs = JSON.parse(readFileSync(new URL('./public/data/courses.json', import.meta.url), 'utf8'));
const defaultCourse = buildFromSpec(specs[0]);
const prog = (k) => { const p = PROGRAMS.find((x) => x.key === k); if (!p) throw new Error('no prog ' + k); return p; };

// 1プログラムを本番経路で走らせ Serial/print 出力を返す（wf_ap16_semantics と同一の流儀）。
function run(code, lang = 'c', ticks = 1) {
  const outs = [];
  const world = { car: new DynCar(defaultCourse.start), walls: defaultCourse.walls, start: defaultCourse.start,
    log: (m) => outs.push(String(m)), _sensors: [], _pendingDelay: 0, _others: [] };
  try {
    const c = buildController(code, lang, buildApi(world));
    c.setup();
    for (let i = 0; i < ticks; i++) c.tick();
    return { out: outs.join('|') };
  } catch (e) { return { err: e.message || String(e), key: e.i18nKey, line: e.line }; }
}
const L = (body) => `void setup(){} void loop(){ ${body} }`;

// ===== A: C 配列サブセットの意味論 =====
console.log('=== A: C 配列サブセットの意味論（本番 buildController + buildApi） ===');
const A = [
  ['固定長宣言＋添字の書込/読出', L('int a[3]; a[0]=5; a[2]=7; Serial.println(a[0]+a[2]);'), '12'],
  ['初期化子（サイズ省略）', L('int a[] = {1,2,3}; Serial.println(a[1]);'), '2'],
  ['部分初期化の 0 埋め', L('int a[4] = {9}; Serial.println(a[3]);'), '0'],
  ['2 次元', L('int a[2][2] = {{1,2},{3,4}}; Serial.println(a[1][0]);'), '3'],
  ['for による走査', L('int a[4]; for(int i=0;i<4;i++){ a[i]=i*2; } Serial.println(a[3]);'), '6'],
  ['添字の複合代入', L('int a[2]={1,1}; a[1]+=4; Serial.println(a[1]);'), '5'],
  ['添字の ++', L('int a[2]={1,1}; a[0]++; Serial.println(a[0]);'), '2'],
  ['float 配列', L('float a[2]={1.5,2.5}; Serial.println(a[0]+a[1]);'), '4'],
  ['多重ループの 2 次元書込', L('int m[2][3]; for(int i=0;i<2;i++){ for(int j=0;j<3;j++){ m[i][j]=i+j; } } Serial.println(m[1][2]);'), '3'],
  ['同一宣言で複数の配列', L('int a[2]={1,2}, b[2]={3,4}; Serial.println(a[1]+b[0]);'), '5'],
  ['グローバル配列（関数外）', 'int g[3]={7,8,9};\nvoid setup(){}\nvoid loop(){ Serial.println(g[2]); }', '9'],
  ['グローバル配列へ loop から書込', 'int g[3];\nvoid setup(){ g[0]=1; }\nvoid loop(){ g[0]=g[0]+1; Serial.println(g[0]); }', '2'],
  ['#define によるサイズ', '#define M 3\nvoid setup(){}\nvoid loop(){ int a[M]; a[2]=5; Serial.println(a[2]); }', '5'],
  // ①'(a) 配列仮引数（従来は構文エラー）。ポインタ形と同値であること＝参照渡し。
  ['①(a) 配列仮引数 int a[]', 'int sum(int a[], int n){ int s=0; for(int i=0;i<n;i++) s+=a[i]; return s; }\nvoid setup(){}\nvoid loop(){ int v[3]={1,2,3}; Serial.println(sum(v,3)); }', '6'],
  ['①(a) 配列仮引数 サイズ付き int a[3]', 'int g(int a[3]){ return a[2]; }\nvoid setup(){}\nvoid loop(){ int v[3]={4,5,6}; Serial.println(g(v)); }', '6'],
  ['①(a) ポインタ形 int *a（従来から可・同値）', 'int sum(int *a, int n){ int s=0; for(int i=0;i<n;i++) s+=a[i]; return s; }\nvoid setup(){}\nvoid loop(){ int v[3]={1,2,3}; Serial.println(sum(v,3)); }', '6'],
  ['①(a) 仮引数経由の書換が呼出側へ及ぶ（参照渡し）', 'void fill(int a[]){ a[0]=42; }\nvoid setup(){}\nvoid loop(){ int v[2]={0,0}; fill(v); Serial.println(v[0]); }', '42'],
  ['①(a) const 付き配列仮引数', 'int g(const int a[], int n){ return a[n-1]; }\nvoid setup(){}\nvoid loop(){ int v[3]={4,5,6}; Serial.println(g(v,3)); }', '6'],
  // ①'(b) sizeof＝葉要素の総数モデル（利用者裁定 2026-08-04。実機のバイト数とは異なる＝docs/仕様欄に明記）。
  ['①(b) sizeof(a)/sizeof(a[0])', L('int a[4]={1,2,3,4}; Serial.println(sizeof(a)/sizeof(a[0]));'), '4'],
  ['①(b) sizeof(a)/sizeof(int)', L('int a[5]={1,2,3,4,5}; Serial.println(sizeof(a)/sizeof(int));'), '5'],
  ['①(b) sizeof 2 次元＝行数', L('int m[2][3]; Serial.println(sizeof(m)/sizeof(m[0]));'), '2'],
  ['①(b) sizeof 2 次元＝列数', L('int m[2][3]; Serial.println(sizeof(m[0])/sizeof(m[0][0]));'), '3'],
  ['①(b) sizeof スカラー＝1', L('int x=3; Serial.println(sizeof(x));'), '1'],
  ['①(b) sizeof 式形（括弧なし）', L('int a[3]; Serial.println(sizeof a);'), '3'],
  ['①(b) for の上限に sizeof', L('int a[4]={1,2,3,4}; int s=0; for(int i=0;i<sizeof(a)/sizeof(a[0]);i++){s+=a[i];} Serial.println(s);'), '10'],
  // ①'(c) 宣言修飾子（従来は構文エラー）。
  ['①(c) const int で配列サイズ', 'const int K = 3;\nvoid setup(){}\nvoid loop(){ int a[K]; a[2]=6; Serial.println(a[2]); }', '6'],
  ['①(c) static 配列', L('static int a[2]={5,6}; Serial.println(a[1]);'), '6'],
  ['①(c) const スカラー', 'const float KK = 2.5;\nvoid setup(){}\nvoid loop(){ Serial.println(KK*2); }', '5'],
  ['①(c) static void loop()（修飾子つき関数定義）', 'static void loop(){ Serial.println(1); }', '1'],
  ['①(c) unsigned int 戻り値の関数定義', 'unsigned int f(){ return 7; }\nvoid setup(){}\nvoid loop(){ Serial.println(f()); }', '7'],
];
for (const [label, code, want] of A) {
  const r = run(code);
  ok(!r.err && r.out === want, `A ${label}: 期待 ${JSON.stringify(want)} 実 ${JSON.stringify(r.err ? 'ERR: ' + r.err : r.out)}`);
}

// ===== B: サイレント破綻の可聴化（①'(d)） =====
// 従来は `char s[]="ab"` が長さ0の配列を黙って作り s[0] が空文字だった（エラーが出ない罠）。
console.log('\n=== B: char 配列の文字列初期化＝行番号付き i18n 実行時エラー（①(d)） ===');
{
  const r = run('void setup(){}\nvoid loop(){\n  char s[] = "ab";\n  Serial.println(s[0]);\n}');
  ok(r.err != null, `B 文字列初期化が黙って通ってしまう（実 ${JSON.stringify(r)}）`);
  ok(r.key === 'interp.err.strArrayInit', `B i18n キー=interp.err.strArrayInit（実 ${r.key}）`);
  ok(r.line === 3, `B 行番号=誤り箇所 3（実 ${r.line}）`);
  ok(r.err != null && /行\s*\d+/.test(r.err), `B メッセージに行番号（実 ${JSON.stringify(r.err)}）`);
  // 対照: 数値の初期化子は通る（＝「常に落とす」壊れ方の検出）。
  const c2 = run(L("int a[2]={1,2}; Serial.println(a[1]);"));
  ok(!c2.err && c2.out === '2', `B 対照: 数値初期化子は通る（実 ${JSON.stringify(c2)}）`);
}

// ===== C: py↔C 移植の同値性（本番 runRace + probe） =====
// probe は race_engine が検証オラクル専用に用意した毎tick観測フック（AO10・verifyHash 不変）。
console.log('\n=== C: py↔C 移植の同値性（本番 runRace・毎tick 観測） ===');
function raceOf(p) {
  const course = buildFromSpec(specs.find((s) => s.name === p.course));
  const acts = []; let vars = null;
  const r = runRace({
    course, regime: p.regime || 'fullscale', laps: 3, physics: 'v2',
    field: [{ name: 'X', lang: p.lang, src: p.code, carType: p.carType, rear: false, encoder: !!p.encoder }],
    crashRule: { rejoin: false, penaltySec: 3 }, interact: true, report: true, trace: true,
    probe: (tick, slots) => {
      const s = slots[0];
      acts.push(`${s.car.steer}/${s.car.driveDir}/${s.car.pwm}`);
      if (s.controller && s.controller.interp) vars = s.controller.interp.global.vars;
    },
  });
  return { r, acts, vars };
}
const arrEq = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return 'どちらかが配列でない';
  if (a.length !== b.length) return `長さ ${a.length} != ${b.length}`;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return `要素 ${i}: ${a[i]} != ${b[i]}`;
  return null;
};
// [py キー, C キー, 比較する配列, 「配列経路が走った」証拠となるスカラー, その期待値]
const PAIRS = [
  ['recon_racer', 'recon_racer_c', ['sev', 'mapL', 'mapR'], 'phase', 1],
  ['comp_localize', 'comp_localize_c', ['fpC', 'fpL', 'fpR', 'fpN', 'w'], 'lp', 1],
];
const baseline = {};
for (const [pk, ck, arrs, flag, flagWant] of PAIRS) {
  const a = raceOf(prog(pk)), b = raceOf(prog(ck));
  baseline[ck] = a;   // D の変異比較に使う（py 側を基準にする）
  console.log(`  ${pk} ↔ ${ck}: ticks=${a.r.ticks} traceHash=${a.r.traceHash} ${flag}=${a.vars && a.vars[flag]}`);
  // C-0: 配列経路が実際に走った証拠（退化した状態のまま緑にならないための前提）
  ok(a.vars != null && a.vars[flag] === flagWant,
    `C-0 ${pk}: ${flag}==${flagWant} に遷移していない＝地図/指紋を使う経路が走っていない（実 ${a.vars && a.vars[flag]}）`);
  for (const nm of arrs) {
    const arr = a.vars && a.vars[nm];
    const touched = Array.isArray(arr) ? arr.filter((x) => x !== 99000 && x !== 0).length : -1;
    ok(touched >= 5, `C-0 ${pk}.${nm}: 初期値から変化した要素が ${touched} 件（<5）＝配列が書かれていない`);
  }
  // C-1: 毎tick チェックサムの列（traceHash）と総 tick が一致
  ok(a.r.traceHash === b.r.traceHash && a.r.ticks === b.r.ticks,
    `C-1 ${pk}↔${ck}: traceHash/ticks 不一致（${a.r.traceHash}/${a.r.ticks} vs ${b.r.traceHash}/${b.r.ticks}）`);
  // C-2: 学習した配列の全要素が一致
  for (const nm of arrs) {
    const d = arrEq(a.vars && a.vars[nm], b.vars && b.vars[nm]);
    ok(d === null, `C-2 ${pk}↔${ck}: 配列 ${nm} が不一致（${d}）`);
  }
  // C-3: 全tick のアクチュエータ列（操舵・駆動方向・PWM）が一致
  const i0 = a.acts.findIndex((x, i) => x !== b.acts[i]);
  ok(a.acts.length === b.acts.length && i0 < 0,
    `C-3 ${pk}↔${ck}: アクチュエータ列が tick ${i0} で分岐（py=${a.acts[i0]} c=${b.acts[i0]}）`);
  // C-4: 結果（完走周回・終端座標）が一致
  const qa = a.r.report[0], qb = b.r.report[0];
  ok(qa.lapsCompleted === qb.lapsCompleted && qa.finalX === qb.finalX && qa.finalY === qb.finalY,
    `C-4 ${pk}↔${ck}: 周回/終端座標が不一致（${qa.lapsCompleted}@${qa.finalX},${qa.finalY} vs ${qb.lapsCompleted}@${qb.finalX},${qb.finalY}）`);
}

// ===== D: 検出力の実証 =====
// C 移植を壊したら C の同値判定が実際に落ちること。落ちなければ C は「何を入れても緑」のゲート。
// 2 段で測る理由（実測・2026-08-04）: 走行を変える変異と、**走行を変えずに配列の中身だけ変える変異**は
//   別物で、後者は traceHash では絶対に捕まらない（例: 地図の記録行を消しても軌跡は 1 tick も変わらない
//   ＝Recon の先読みはこのコースでは発火しないため）。配列対応を守るゲートなので両方を要求する。
// 置換対象は **ソース内で一意** であることを数えて確かめる（ヘッダーコメント中の同じ字面に当たって
//   「変異したつもりで何も変わっていない」事故を防ぐ＝実際にこの罠を踏んで発覚した）。
console.log('\n=== D: 検出力（C 移植の変異体は同値判定に落ちるか） ===');
{
  const p = prog('recon_racer_c');
  const base = baseline['recon_racer_c'];   // 基準＝py 版の実測（C 版はこれと一致することを C で確認済）
  const mutate = (label, from, to, expect) => {
    const n = p.code.split(from).length - 1;
    ok(n === 1, `D ${label}: 置換対象 ${JSON.stringify(from)} がソース内に ${n} 箇所（1 でないと変異検査が無効）`);
    if (n !== 1) return;
    const m = raceOf({ ...p, code: p.code.replace(from, to) });
    const thDiff = m.r.traceHash !== base.r.traceHash;
    const actDiff = m.acts.length !== base.acts.length || m.acts.findIndex((x, i) => x !== base.acts[i]) >= 0;
    const arrDiff = arrEq(base.vars.sev, m.vars && m.vars.sev) !== null;
    console.log(`  ${label}: traceHash=${m.r.traceHash}（基準 ${base.r.traceHash}） 軌跡差=${thDiff} 操作差=${actDiff} 配列差=${arrDiff}`);
    ok(expect(thDiff, actDiff, arrDiff), `D ${label}: 変異しても同値判定が落ちない＝該当の一致は何も保証していない`);
  };
  // D-1 駆動レベル: 旋回中の PWM 上限を 1 下げる → 軌跡と操作列が変わる（C-1/C-3 の検出力）。
  mutate('D-1 TCAP 58→57（駆動）', 'const int TCAP=58;', 'const int TCAP=57;', (th, act) => th && act);
  // D-2 配列レベル: 地図への記録を止める → 軌跡は 1 tick も変わらないが配列の中身が変わる（C-2 の検出力）。
  mutate('D-2 地図記録の削除（配列）', 'if(C<sev[b]){ sev[b]=C; }', 'if(C<sev[b]){ }', (th, act, arr) => arr);
  // D-3 py の // 相当（floor）を外す → これも軌跡でなく配列の中身に出る（移植の要点を守る）。
  mutate('D-3 floor 除去（py の // 相当）', 'int b=floor(s/BL);', 'int b=s/BL;', (th, act, arr) => arr);
}

console.log(`\n[結果] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
