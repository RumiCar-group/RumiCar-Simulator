// wf_as13_engage.mjs — Stage AS13「エンゲージメント機能群 (W6 バックログ)」常設ゲート
// =============================================================================
// 実装を再実装せず **本番の race_ladder / race_season / challenge / sector / runRace /
// wf_official_result.mjs (正準ツール)** を呼ぶ。
//
//  A: シーズン/チャンピオンシップ — 配点規定・シーズン×クラスの分離・補充車とリタイアの扱い・
//     カウントバックと同点の正直な扱い・決定論 (入力順非依存)・検出力 (順位入替で王者が変わる)
//  B: 言語別ラダー — **公式結果 (result.json) の schema が 1 bit も変わっていない**ことを
//     正準ツールの実生成物で機械証明 (finisher キー集合＋resultSha256 = manifest pin)。
//     言語は entries から引く経路 (program.lang / progKey) の双方を実データで検査。
//     言語不明 (補充車・entries の無い古い記録) を黙って混ぜず除外件数で返すこと。
//  C: チャレンジ — 母集団は本番 courses.json 全数から「完走が定義される」ものだけ (AS3 の
//     raceableCourse と同述語)。バッジのしきい値が**構造由来**であること (恣意的定数ゼロ)・検出力。
//  D: 区間別テレメトリ比較 — 本番 runRace の ghost に対する事後解析。**保存則 (区間の和 = 周回時間)** を
//     厳密に検査し、距離等分の正しさを定速合成で、順位付けの意味を変異注入で確認 (検出力)。
//  E: 既存エンゲージメント層 (W6) の非退行 — 既存 API の返りフィールドと意味が保たれること。
// =============================================================================
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS, PROGRAM_BY_KEY } from './public/js/programs.js';
import { recordsFrom, dnfsFrom, aggregate, leaderboards, profiles, beatenChecks, realAuthor } from './public/js/race_ladder.js';
import { championships, langBoards, langRecordsAt, langProfiles, pointsFor, POINTS_DEFAULT } from './public/js/race_season.js';
import { challengeState, isCompletable, DIFF_LEVELS } from './public/js/challenge.js';
import { sectorAnalysis, crossIndex, sectorDeltas, SECTORS_DEFAULT } from './public/js/sector.js';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };
const J = (x) => JSON.stringify(x);
const progLang = (k) => (PROGRAM_BY_KEY[k] || {}).lang || null;

// ============================================================================
console.log('\n=== B(前段): 正準ツールの実生成物で result.json schema の不変を機械証明 ===');
// AS13 受け入れ基準② =「既存 result.json の再検証が全て従来どおり成立」。言語別ラダーを作るときに
// finishers へ lang を足すと wf_official_result の resultSha256 (pin) が動き、**公開済みの記録の
// 再検証互換に触れる**。∴ 言語は result の外 (entries) から引く設計にした。その設計が守られていることを
// 「本番の正準ツールを実際に走らせた生成物」で確かめる (静的 grep でなく実データ)。
const TMP = mkdtempSync(join(tmpdir(), 'as13-'));
const REAL_OUT = join(TMP, 'real_result.json');
let toolExit = 0;
try {
  execFileSync(process.execPath, [join(HERE, 'wf_official_result.mjs'), '--out', REAL_OUT],
    { cwd: HERE, stdio: 'pipe' });
} catch (e) { toolExit = e.status || 1; }
ok(toolExit === 0, `B0 正準ツール wf_official_result.mjs が exit 0 (決定論＋再検証＋pin 照合) — 実測 exit=${toolExit}`);
const real = JSON.parse(readFileSync(REAL_OUT, 'utf8'));
const FIN_KEYS = ['rank', 'name', 'author', 'carType', 'totalTimeMs', 'bestLapMs', 'penaltiesSec'];
const finKeys = Object.keys(real.finishers[0]).sort();
ok(J(finKeys) === J([...FIN_KEYS].sort()), `B1 finisher のキー集合が W_spec §6 のまま (実測 ${J(finKeys)})`);
ok(!finKeys.includes('lang'), 'B1 finisher に lang を足していない (足せば resultSha256=pin が動く)');
ok(!JSON.stringify(real).includes('"lang"'), 'B1 result.json 全体のどこにも lang フィールドが無い');
const manifest = JSON.parse(readFileSync(join(HERE, 'wf_frozen_manifest.json'), 'utf8'));
// ツールは③で resultSha256 を pin と照合し、不一致なら exit 3 を返す ⇒ exit 0 = pin 一致。
ok(toolExit === 0 && !!manifest.canonicalNode.resultSha256,
  `B2 resultSha256 が manifest pin と一致 (pin=${String(manifest.canonicalNode.resultSha256).slice(0, 16)}…・ツール③が exit で保証)`);
ok(real.verifyHash === 'c731ecce', `B2 正準サンプルの verifyHash が従来値 c731ecce のまま (実測 ${real.verifyHash})`);

// ---- 実データのレース束 (正準サンプルの event + entries + いま生成した result) ----
const bundle = JSON.parse(readFileSync(join(HERE, 'docs/phase_w/official_sample_event.json'), 'utf8'));
const raceReal = { event: bundle.event, entries: bundle.entries, result: real };
const realBefore = J(real);
const recsReal = recordsFrom([raceReal], { progLang });
ok(J(real) === realBefore, 'B3 recordsFrom は result オブジェクトを一切書き換えない (読み取り専用)');
ok(recsReal.length === real.finishers.length, `B3 完走者数ぶんのレコードになる (${recsReal.length})`);
ok(recsReal.every((r) => r.lang === 'c'),
  `B4 progKey 参照エントリーの言語が実 PROGRAMS から解決される (comp_circuit=${progLang('comp_circuit')}・実測 ${J([...new Set(recsReal.map((r) => r.lang))])})`);

// ============================================================================
console.log('\n=== A: シーズン/チャンピオンシップ (race_season) ===');
// A1/A2: 配点は「規定」。既定表を明示し、イベント側で上書きできること。
ok(J([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => pointsFor(r))) === J([10, 8, 6, 5, 4, 3, 2, 1, 0, 0]),
  `A1 既定配点 = ${POINTS_DEFAULT.join('-')}・表の外は 0`);
ok(pointsFor(1, [25, 18]) === 25 && pointsFor(2, [25, 18]) === 18 && pointsFor(3, [25, 18]) === 0,
  'A2 event.points による配点の上書きが効く');
ok(pointsFor(1, []) === 10 && pointsFor(1, null) === 10, 'A2 不正/空の配点表は既定へフォールバック');

// 実 result を複製して 著者・言語・シーズンだけ差し替えた束を作る (schema は実生成物と同一)。
const clone = (o) => JSON.parse(JSON.stringify(o));
function mkRace(id, season, cls, order, dnf = [], langs = {}) {
  const res = clone(real);
  res.eventId = id; res.class = cls;
  res.finishers = order.map((a, i) => ({ ...clone(real.finishers[Math.min(i, real.finishers.length - 1)]),
    rank: i + 1, name: a + '-car', author: a, totalTimeMs: 10000 + i * 1000, bestLapMs: 10000 + i * 1000, penaltiesSec: 0 }));
  res.dnf = dnf.map((a) => ({ name: a + '-car', author: a, carType: 'normal_fr', lapsCompleted: 0, reason: 'timeout' }));
  const who = [...order, ...dnf].filter((a) => realAuthor(a));
  return {
    event: { ...bundle.event, id, season, class: cls },
    entries: who.map((a, i) => ({ name: a + '-car', author: a, program: { src: '', lang: langs[a] || 'c' },
      carType: 'normal_fr', submittedAt: `2026-01-01T00:00:0${i}Z` })),
    result: res,
  };
}
// s1: 2 戦。alice が 1-2 位、bob が 2-1 位 → 同点・同優勝数・同表彰台・同完走 = tie。
const s1 = [mkRace('s1r1', '2026A', 'open', ['alice', 'bob', '(filler)']),
            mkRace('s1r2', '2026A', 'open', ['bob', 'alice', '(filler)'])];
// s2: 別シーズン。carol が 1 位・dave が DNF。
const s2 = [mkRace('s2r1', '2026B', 'open', ['carol', 'dave2'], ['dave'], { carol: 'py' })];
// s3: 同一シーズンだが別クラス (混ざってはいけない)。
const s3 = [mkRace('s3r1', '2026A', 'spec', ['erin', 'frank'])];
const allRaces = [...s1, ...s2, ...s3, raceReal];
const agg = aggregate(allRaces, { progLang });
const champs = championships(agg.records, agg.dnfs);

const gOf = (season, cls) => champs.find((c) => c.season === season && c.cls === cls);
ok(champs.length === 4, `A3 シーズン×クラスで 4 群に分かれる (2026A/open・2026A/spec・2026B/open・""/open) — 実測 ${champs.length}`);
ok(!!gOf('2026A', 'open') && !!gOf('2026A', 'spec'), 'A3 同一シーズンでもクラスが違えば別の選手権 (混ざらない)');
ok(gOf('2026A', 'open').rows.every((r) => r.author !== '(filler)') &&
   gOf('2026A', 'open').rows.length === 2, 'A4 補充車は選手権の順位表に入らない (実在の投稿者だけ)');
{
  // A4 (実態): 補充車は順位を占める ⇒ 補充車に負けた人間は順位が下がりポイントも減る。
  const r1 = championships(recordsFrom([mkRace('x1', 'S', 'open', ['alice', 'bob'])], { progLang }), []);
  const r2 = championships(recordsFrom([mkRace('x2', 'S', 'open', ['alice', '(filler)', 'bob'])], { progLang }), []);
  const p1 = r1[0].rows.find((r) => r.author === 'bob').points;
  const p2 = r2[0].rows.find((r) => r.author === 'bob').points;
  ok(p1 === pointsFor(2) && p2 === pointsFor(3) && p2 < p1,
    `A4 補充車に負けると順位が下がりポイントも減る (${p1}→${p2})`);
}
{
  const g = gOf('2026B', 'open');
  const dave = g.rows.find((r) => r.author === 'dave');
  ok(dave && dave.points === 0 && dave.dnfs === 1 && dave.starts === 1 && dave.finishes === 0,
    `A5 リタイアは 0 点だが出走には数える (pts=${dave && dave.points} starts=${dave && dave.starts})`);
  ok(g.rows.find((r) => r.author === 'carol').points === pointsFor(1), 'A5 完走者のポイントは順位表どおり');
}
{
  // A6 決定論: レース配列の順序を変えても結果は同一 (Map の挿入順に依存しない)。
  const shuffled = [...allRaces].reverse();
  const c2 = championships(aggregate(shuffled, { progLang }).records, aggregate(shuffled, { progLang }).dnfs);
  ok(J(champs) === J(c2), 'A6 入力レースの順序を変えても選手権表は完全同一 (決定論)');
}
{
  const g = gOf('2026A', 'open');
  ok(g.tie === true, `A7 カウントバックでも決まらない完全同点は tie=true で正直に返す (${J(g.rows.map((r) => [r.author, r.points, r.wins]))})`);
  // カウントバックで差がつけば tie=false (2 戦とも alice が勝てば優勝数で決まる)。
  const w = [mkRace('w1', 'W', 'open', ['alice', 'bob']), mkRace('w2', 'W', 'open', ['alice', 'bob'])];
  const cw = championships(recordsFrom(w, { progLang }), [])[0];
  ok(cw.tie === false && cw.champion.author === 'alice', 'A7 差がつくときは tie=false');
}
{
  // A8: 全員が配点表の外 (9位以下) なら「王者なし」。
  const many = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];
  const r = mkRace('z1', 'Z', 'open', [...many, 'z9', 'z10']);
  const only = recordsFrom([r], { progLang }).filter((x) => x.rank >= 9);
  const cz = championships(only, [])[0];
  ok(cz.champion === null, 'A8 誰も得点していなければ王者を立てない (null で正直に返す)');
}
{
  // A9 検出力: 1 レースの 1 位と 2 位を入れ替えると王者が入れ替わる。
  const base = [mkRace('d1', 'D', 'open', ['alice', 'bob']), mkRace('d2', 'D', 'open', ['alice', 'bob'])];
  const swap = [mkRace('d1', 'D', 'open', ['bob', 'alice']), mkRace('d2', 'D', 'open', ['bob', 'alice'])];
  const cb = championships(recordsFrom(base, { progLang }), [])[0].champion.author;
  const cs = championships(recordsFrom(swap, { progLang }), [])[0].champion.author;
  ok(cb === 'alice' && cs === 'bob', `A9 検出力: 順位を入れ替えると王者が変わる (${cb}→${cs})`);
}

// ============================================================================
console.log('\n=== B: 言語別ラダー (race_season.langBoards) ===');
{
  const lb = langBoards(agg.records);
  const langs = [...new Set(lb.boards.map((b) => b.lang))].sort();
  ok(J(langs) === J(['c', 'py']), `B5 program.lang / progKey の双方から言語が引けている (実測 ${J(langs)})`);
  ok(lb.boards.every((b) => b.rows.every((r) => r.lang === b.lang)), 'B6 各ボードの行はその言語だけ');
  ok(lb.boards.every((b) => b.record === b.rows[0] &&
    b.rows.every((r) => r.classifiedMs >= b.record.classifiedMs)), 'B6 record はそのボードの最速');
  ok(lb.boards.every((b, i, a) => i === 0 || a[i - 1].key.localeCompare(b.key) <= 0), 'B6 ボードの並びは key 昇順 (決定論)');
  ok(lb.unknown > 0 && agg.records.some((r) => !r.lang),
    `B7 言語不明 (補充車等) は黙って混ぜず除外件数で返す (unknown=${lb.unknown})`);
  ok(lb.boards.every((b) => b.rows.every((r) => realAuthor(r.author) || r.lang)),
    'B7 除外された行がボードに紛れ込んでいない');
  // B8 検出力: py の記録を全部落とすと py ボードが消える。
  const noPy = langBoards(agg.records.filter((r) => r.lang !== 'py'));
  ok(noPy.boards.every((b) => b.lang !== 'py') && noPy.boards.length < lb.boards.length,
    `B8 検出力: py の記録を除くと py ボードが消える (${lb.boards.length}→${noPy.boards.length})`);
  // 言語別のコースレコード帯・言語プロフィール
  const strip = langRecordsAt(lb.boards, 'open', real.course);
  ok(strip.length >= 1 && strip.every((x) => x.rec && x.n >= 1), `B6 クラス×コースの言語別ベスト帯が引ける (${strip.length} 言語)`);
  const lp = langProfiles(agg.records);
  ok(lp.every((p) => p.entries > 0 && p.authors >= 0) && lp.every((p, i, a) => i === 0 || a[i - 1].lang <= p.lang),
    'B6 言語別プロフィールは lang 昇順・件数は正');
  ok(lp.reduce((s, p) => s + p.entries, 0) + lb.unknown === agg.records.length,
    `B7 言語別の合計 + 言語不明 = 全レコード数 (取りこぼしゼロ: ${lp.reduce((s, p) => s + p.entries, 0)}+${lb.unknown}=${agg.records.length})`);
}

// ============================================================================
console.log('\n=== C: チャレンジ (challenge.challengeState・本番 courses.json 全数) ===');
const specs = JSON.parse(readFileSync(join(HERE, 'public/data/courses.json'), 'utf8'));
const built = specs.map((s) => buildFromSpec(s));
const CARS = ['normal_fr', 'normal_awd', 'normal_ff'];
const noFinish = built.filter((c) => !isCompletable(c));
ok(noFinish.length === 2,
  `C1 完走が定義されないコースは 2 件 (AS3 の実測と一致) — 実測 ${noFinish.length} [${noFinish.map((c) => c.name).join(', ')}]`);
{
  const st0 = challengeState(built, CARS, () => null);
  ok(st0.excluded === noFinish.length, `C1 除外件数を黙らず返す (excluded=${st0.excluded})`);
  // AY2 (2026-09-08): 除外の理由は 2 種類ある。**混ぜてはいけない** — `excluded` は「ゴールラインが無く
  //   完走が定義されない」、`excludedBench` は「ゴールラインは持つが、舵では原理的に曲がれないことを
  //   見せるための教材ベンチで完走を前提にしていない」。UI は理由ごとに別の文言を出すので、片方の述語を
  //   広げて済ませると説明文が嘘になる（実際に一度そう壊した）。両方を件数で固定する。
  const benchC = built.filter((c) => c.bench);
  ok(benchC.length === 7 && benchC.every((c) => isCompletable(c)),
    `C1 舵角限界ベンチは 7 件で、いずれも**ゴールラインは持つ**（＝除外理由は「完走が定義されない」ではない）` +
    ` — 実測 ${benchC.length} 件・ゴールライン有り ${benchC.filter((c) => isCompletable(c)).length} 件`);
  ok(st0.excludedBench === benchC.length, `C1 ベンチの除外件数も黙らず別に返す (excludedBench=${st0.excludedBench})`);
  ok(st0.rows.length === built.length - noFinish.length - benchC.length,
    `C1 母集団 = 完走が定義され、かつ教材ベンチでないコースのみ (${st0.rows.length} = ${built.length} − ${noFinish.length} − ${benchC.length})`);
  ok(st0.total.done === 0 && st0.badges.every((b) => !b.got), 'C2 記録ゼロなら完走 0・バッジは全て未取得');
  ok(st0.next && st0.next.diff === Math.min(...st0.rows.map((r) => r.diff == null ? 9 : r.diff)),
    `C2 「次の一歩」は未完走のうち最もやさしいコース (★${st0.next && st0.next.diff}「${st0.next && st0.next.name}」)`);
  ok(J(st0) === J(challengeState(built, CARS, () => null)), 'C7 同じ入力なら完全同一の出力 (決定論)');
  // C6: バッジの total は実コース数由来 (恣意的な数を持たない)。
  const byKey = Object.fromEntries(st0.badges.map((b) => [b.key, b]));
  ok(DIFF_LEVELS.every((d) => {
    const n = st0.rows.filter((r) => r.diff === d).length;
    return n === 0 ? !byKey['diff' + d] : byKey['diff' + d].total === n;
  }), 'C6 難度バッジの total は「その難度の実コース数」= 構造由来 (恣意的しきい値ゼロ)');
  ok(byKey.all.total === st0.rows.length, 'C6 全制覇バッジの total は母集団のコース数');
}
{
  // C3/C8: ★1 の全コースに記録を入れると clear、1 つ消すと started へ落ちる (検出力)。
  const d1Names = new Set(built.filter((c) => isCompletable(c) && c.diff === 1).map((c) => c.name));
  const lookupD1 = (name, car) => (d1Names.has(name) && car === 'normal_fr') ? { t: 12.34, ver: 'v7.2.0' } : null;
  const stA = challengeState(built, CARS, lookupD1);
  const d1 = stA.byDiff.find((d) => d.diff === 1);
  ok(d1.state === 'clear' && d1.done === d1.total, `C3 ★1 の全コース完走で state=clear (${d1.done}/${d1.total})`);
  ok(stA.badges.find((b) => b.key === 'diff1').got === true, 'C3 ★1 制覇バッジを取得');
  ok(stA.badges.find((b) => b.key === 'first').got === true, 'C3 1 コース以上で「はじめの一歩」を取得');
  ok(stA.badges.find((b) => b.key === 'all').got === false, 'C3 全コースは未制覇のまま');
  const one = [...d1Names][0];
  const stB = challengeState(built, CARS, (n, c) => (n === one ? null : lookupD1(n, c)));
  const d1b = stB.byDiff.find((d) => d.diff === 1);
  ok(d1b.state === 'started' && d1b.done === d1.done - 1,
    `C8 検出力: 1 コースの記録を消すと clear→started に落ちる (${d1.done}→${d1b.done})`);
}
{
  // C4: 全コースに記録 → 全制覇・next=null。C5: t<=0 / 壊れた記録は完走扱いしない。
  const stAll = challengeState(built, CARS, () => ({ t: 9.99, ver: 'v7.2.0' }));
  ok(stAll.total.done === stAll.total.total && stAll.next === null, 'C4 全コース完走で next=null');
  ok(stAll.badges.every((b) => b.got), 'C4 全バッジ取得');
  ok(stAll.byDiff.filter((d) => d.total).every((d) => d.state === 'clear'), 'C4 全難度 clear');
  const stZero = challengeState(built, CARS, () => ({ t: 0, ver: 'v7.2.0' }));
  const stNeg = challengeState(built, CARS, () => ({ t: -1 }));
  ok(stZero.total.done === 0 && stNeg.total.done === 0, 'C5 t<=0 の壊れた記録は完走として数えない');
  // 版スタンプの無い旧記録 (AP2 以前) は完走ではあるが stale として区別する。
  const stOld = challengeState(built, CARS, () => ({ t: 5, ver: null }));
  ok(stOld.rows.every((r) => r.done && r.stale), 'C5 版スタンプ無しの旧記録は完走だが stale と区別される');
}

// ============================================================================
console.log('\n=== D: 区間別テレメトリ比較 (sector・本番 runRace の ghost) ===');
// D1: 線形補間の解析解と一致。
{
  const arr = new Float64Array([0, 1, 2, 3, 4]);
  ok(crossIndex(arr, 0, 4, 2.5) === 2.5 && crossIndex(arr, 0, 4, 0) === 0 && crossIndex(arr, 0, 4, 4) === 4,
    'D1 crossIndex は線形補間の解析解と一致');
  ok(crossIndex(arr, 0, 4, -5) === 0 && crossIndex(arr, 0, 4, 99) === 4, 'D1 範囲外は端へクランプ');
  const flat = new Float64Array([0, 0, 0, 0]);
  ok(Number.isFinite(crossIndex(flat, 0, 3, 0)), 'D1 進んでいない (差 0) 区間でも非有限値を返さない');
}
// D2〜D6: 本番 runRace (卓上オーバル・既定3サンプル・3周 = f0 と同一構成) の ghost を解析。
const prog = (key) => { const p = PROGRAMS.find((x) => x.key === key); return { src: p.code, lang: p.lang || 'c', carType: p.carType }; };
const oval = buildFromSpec({ name: 'オーバル', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
const field = ['normal_fr', 'normal_awd', 'normal_ff'].map((k, i) => {
  const p = prog(k); return { name: 'C' + i, lang: p.lang, src: p.src, carType: p.carType };
});
const rr = runRace({ report: true, ghost: true, course: oval, laps: 3, field, crashRule: { rejoin: false, penaltySec: 3 } });
ok(rr.verifyHash === '636ed39f',
  `D2 本番 runRace の既定挙動が f0 記録値と一致 (ghost:true は byte 不変・実測 ${rr.verifyHash})`);
const an = sectorAnalysis(rr.ghost, oval.bounds, SECTORS_DEFAULT);
ok(an.k === 3 && an.dt > 0 && an.cars.length === field.length, `D2 3 区間で ${an.cars.length} 台ぶん解析 (dt=${an.dt.toFixed(4)}s)`);
ok(an.lapsCounted > 0, `D2 完了周回を検出 (${an.lapsCounted} 周ぶん)`);
{
  // D2': 解析できる周回数は「ゴーストのフレームに終端境界が写っている周」だけ = 最終フレームの laps に厳密一致。
  //   実測 (卓上オーバル×3周): 最後にゴールする車 (C2) は tick 3288 でラインを越えるが、最後のゴースト
  //   フレームは tick 3285 (GHOST_EVERY=5 の格子) なので **3 周目の終端が記録に無い**。したがって
  //   レポートの完了周回 (3) より 1 周少なくなる。これは sector の欠陥ではなくゴースト間引きの構造的性質で、
  //   欠けるのは常に「最後の 1 周だけ」(格子間隔 = 1 フレーム未満のずれ) ⇒ 二重の述語で機械固定する。
  const nf = rr.ghost.frames.length;
  const lastLaps = rr.ghost.frames[nf - 1].map((p) => (p ? (p.laps | 0) : 0));
  ok(an.cars.every((c, i) => c.laps.length === lastLaps[i]),
    `D2 解析周回数 = 最終ゴーストフレームの laps に厳密一致 (${J(an.cars.map((c) => c.laps.length))} vs ${J(lastLaps)})`);
  const deficit = rr.report.map((r, i) => r.lapsCompleted - lastLaps[i]);
  ok(deficit.every((d) => d === 0 || d === 1),
    `D2 レポートとの差は 0 または 1 周のみ (間引き格子ぶん・実測 ${J(deficit)})`);
  const lastFrameTick = (nf - 1) * Math.round(an.dt / (rr.simSec / rr.ticks));
  ok(rr.finishers.every((f) => (deficit[f.idx] === 0) === (f.finishTick <= lastFrameTick)),
    `D2 差が出るのは「最後のゴーストフレームより後にゴールした車」だけ (最終フレーム tick=${lastFrameTick})`);
}
{
  // D3 保存則: 区間の和 = その周の所要時間 (厳密・丸め誤差のみ)。これが区間分割の正しさの根拠。
  let worst = 0;
  for (const c of an.cars) for (const lp of c.laps) {
    worst = Math.max(worst, Math.abs(lp.sectors.reduce((a, b) => a + b, 0) - lp.lapSec));
  }
  ok(worst < 1e-9, `D3 保存則: Σ区間 = 周回時間 (最大偏差 ${worst.toExponential(2)}s)`);
  ok(an.cars.every((c) => c.laps.every((lp) => lp.sectors.every((s) => s >= 0))), 'D4 全区間が非負');
  ok(an.cars.every((c) => c.laps.every((lp) => lp.endFi > lp.startFi)), 'D4 周回境界は厳密に前進する');
  ok(an.cars.every((c) => c.laps.every((lp, i, a) => i === 0 || lp.startFi >= a[i - 1].endFi)), 'D4 周は重ならない');
}
{
  // D5/D6: 理論ベスト = 各区間の全車最速の和 ≤ 実ベストラップ (定義上)。差が「取りこぼし」。
  const sum = an.bestOf.reduce((a, b) => a + b, 0);
  ok(Math.abs(sum - an.theoreticalBestSec) < 1e-12, 'D6 理論ベスト = 各区間最速の和');
  ok(an.gainSec >= -1e-9, `D5 理論ベスト ≤ 実ベストラップ (gain=${an.gainSec.toFixed(4)}s ≥ 0)`);
  ok(an.holderOf.every((h) => h == null || an.cars.some((c) => c.ci === h)), 'D5 区間最速の保持者は実在の車');
  ok(an.cars.every((c) => c.bestSectors.every((v, j) => v == null || v >= an.bestOf[j] - 1e-12)),
    'D5 どの車の区間タイムも全体最速を下回らない');
  const dl = sectorDeltas(an.cars[0].laps[0], an.bestOf);
  ok(dl.length === an.k && dl.every((d) => d == null || d >= -1e-12), 'D5 区間差分は全体最速からの非負の差');
}
{
  // D7: 等分性 — 定速で円周を回る合成フレームなら k 区間の時間は厳密に等しくなる。
  //   ⚠ これは「距離で割っていること」の検査には**ならない**: 定速では距離等分と時間等分が一致するため、
  //     実装を時間等分へ差し替えても D7 は通る (変異注入で実測済み)。距離等分であることを弁別するのは
  //     **速度が一定でない D8** の方である。D7 が保証するのは「境界の求め方が偏っていないこと」まで。
  const dt = 1 / 12, nf = 241, frames = [];
  for (let fi = 0; fi < nf; fi++) {
    const u = fi / 120, th = 2 * Math.PI * u;
    frames.push([{ x: Math.cos(th), y: Math.sin(th), th, crashed: false, laps: Math.floor(u) }]);
  }
  for (const k of [1, 3, 5]) {
    const a = sectorAnalysis({ frames, dt, names: ['A'], carTypes: [''] }, { w: 2.2, h: 2.2 }, k);
    const lp = a.cars[0].laps[0];
    const rel = Math.max(...lp.sectors.map((s) => Math.abs(s * k / lp.lapSec - 1)));
    ok(rel < 1e-12, `D7 定速なら ${k} 区間が厳密に等分される (相対偏差 ${rel.toExponential(2)})`);
    ok(Math.abs(lp.sectors.reduce((x, y) => x + y, 0) - lp.lapSec) < 1e-12, `D10 k=${k} でも保存則が成立`);
  }
}
{
  // D8 検出力 (変異注入): 2 台のうち B の「後半だけ」を遅らせると、その区間の最速保持者が A へ移る。
  //   同じ道のりを A と同じ形で走らせ、B は周回の後半だけ歩幅を半分にする (= 遅い)。
  const dt = 1 / 12, nf = 241;
  const mk = (slowLate) => {
    const fr = [];
    let u = 0;
    for (let fi = 0; fi < nf; fi++) {
      const th = 2 * Math.PI * u;
      fr.push({ x: Math.cos(th), y: Math.sin(th), th, crashed: false, laps: Math.floor(u) });
      const frac = u - Math.floor(u);
      u += (slowLate && frac >= 0.5) ? (1 / 240) : (1 / 120);
    }
    return fr;
  };
  const A = mk(false), B = mk(true);
  const frames = A.map((_, fi) => [A[fi], B[fi]]);
  const a = sectorAnalysis({ frames, dt, names: ['A', 'B'], carTypes: ['', ''] }, { w: 2.2, h: 2.2 }, 2);
  ok(a.holderOf[0] != null && a.holderOf[1] === 0,
    `D8 検出力: 後半を遅くした車は後半区間の最速を失う (holderOf=${J(a.holderOf)})`);
  const bLap = a.cars[1].laps[0];
  ok(bLap.sectors[1] > bLap.sectors[0] * 1.5,
    `D8 検出力: 遅くした側の後半区間だけが伸びる (S1=${bLap.sectors[0].toFixed(2)}s S2=${bLap.sectors[1].toFixed(2)}s)`);
}
{
  // D9: 1 周も完了していない入力でも安全に「出せない」を返す (例外にしない・嘘の値を作らない)。
  const dt = 1 / 12;
  const frames = Array.from({ length: 20 }, (_, fi) => [{ x: fi * 0.01, y: 0, th: 0, crashed: false, laps: 0 }]);
  const a = sectorAnalysis({ frames, dt, names: ['A'], carTypes: [''] }, { w: 1, h: 1 }, 3);
  ok(a.lapsCounted === 0 && a.theoreticalBestSec === null && a.bestLapSec === null, 'D9 完了周回ゼロなら null を返す (捏造しない)');
  const e = sectorAnalysis(null, null, 3);
  ok(e.lapsCounted === 0 && e.cars.length === 0, 'D9 空入力でも例外にならない');
}

// ============================================================================
console.log('\n=== E: 既存エンゲージメント層 (W6) の非退行 ===');
{
  const OLD_REC_KEYS = ['eventId', 'eventTitle', 'cls', 'course', 'regime', 'laps', 'engineVer', 'verifyHash',
    'rank', 'name', 'author', 'carType', 'totalTimeMs', 'bestLapMs', 'penaltiesSec', 'classifiedMs', 'programRef'];
  ok(OLD_REC_KEYS.every((k) => k in agg.records[0]), 'E1 recordsFrom の既存フィールドが全て残っている (追加のみ)');
  ok(['records', 'boards', 'drivers', 'verifiedCount'].every((k) => k in agg), 'E2 aggregate の既存キーが残っている');
  const boards = leaderboards(agg.records);
  ok(J(boards) === J(agg.boards), 'E2 aggregate.boards は leaderboards(records) と同一');
  ok(boards.every((b) => b.record === b.rows[0]), 'E3 各ボードの record は最速行 (従来どおり)');
  const drv = profiles(agg.records, boards);
  ok(drv.every((d) => d.podiums >= d.wins && d.entries >= d.podiums), 'E3 称号の単調性 (優勝 ≤ 表彰台 ≤ 出走) が保たれる');
  ok(drv.every((d) => d.author !== '(filler)'), 'E3 補充車はドライバーに含まれない');
  // DNF を別配列にしたので profiles の表彰台計算に混入しない (rank:null が `<=3` を通る事故を構造的に排除)。
  ok(agg.records.every((r) => typeof r.rank === 'number'), 'E3 records には rank を持つ完走者しか入らない (DNF は dnfs へ分離)');
  ok(agg.dnfs.every((d) => !('rank' in d)), 'E3 dnfs は順位を持たない (ラダーに混ざり得ない)');
  const beaten = beatenChecks(agg.records, 'alice');
  ok(Array.isArray(beaten) && beaten.every((b) => b.gapMs >= 0), 'E3 打破通知は従来どおり (gap は非負)');
}

// ============================================================================
if (process.argv.includes('--table')) {
  console.log('\n===TABLE===');
  console.log(J({ champs: champs.map((c) => ({ season: c.season, cls: c.cls, champion: c.champion && c.champion.author, tie: c.tie })),
    langs: langBoards(agg.records).boards.map((b) => `${b.lang}:${b.rows.length}`),
    sector: { k: an.k, dt: an.dt, best: an.bestOf, theo: an.theoreticalBestSec, gain: an.gainSec } }));
}
console.log(`\n[結果] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
