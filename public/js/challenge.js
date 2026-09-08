// チャレンジ (難コース完走バッジ) — Stage AS / AS13。
// 正準スペック docs/phase_w/W_spec.md §8 の任意バックログ「チャレンジ (難コース完走バッジ)」の
// **純ロジック**実装。DOM も localStorage も直接触らず決定論的 (Math.random/Date 不使用)。
//
// ── なぜ練習 (ローカル) 側なのか ──────────────────────────────────────────────
// 公式レース (GitHub races/) は**まだシードされていない** (loader.js の races/ 契約・作成は人間・CI-11)
// ため、公式記録を母集団にする機能は実データが 0 件のまま検証できない。チャレンジは
// **利用者自身の練習記録**を母集団にするので、いま実データで成立し実データで検証できる (CI-8)。
// 二層モデル (W_spec §0) のとおり練習は非公式＝公式ラダー/称号には一切混ざらない。
//
// ── 「完走した」の定義 (代理量でなく実態・CI-14) ───────────────────────────────
// 練習ベスト記録の**存在そのもの**を完走の証拠として使う。lap.js は周回 (峠はゴール) を計上した
// その瞬間にしかベストを書かない (`LapTracker.update` → `_saveBest`) ので、
// 「記録がある ⇔ 少なくとも一度は完走した」が構造的に成り立つ。別途フラグを持つと二重機構になる。
//
// ── 母集団から外すもの (理由が 2 系統ある。混ぜない) ──────────────────────
// (1) フィニッシュ線を持たないコース (ドリフト広場・競技グラウンド) は**完走が定義されない**ので除外。
//     述語 `isCompletable` は AS3 が敷いた `raceableCourse()` と同一 (= 組み立て後の course.finish の有無)
//     で、ここで再実装しない。
// (2) 教材ベンチ (`bench`・AY2) は**完走が定義されるが完走を前提にしていない**ので除外 (`isChallengeCourse`)。
//     (1) の述語を広げて済ませてはならない — UI の説明文が「ゴールラインを持たない」なので嘘になる。
// **どちらも除外件数を理由ごとに別々に返し** (excluded / excludedBench)、黙って捨てない (沈黙截断の禁止)。

// 難度の刻み (courses.json の diff)。AB5 で実測段階化し AS3 ⑧' で再較正済み。
export const DIFF_LEVELS = Object.freeze([1, 2, 3, 4, 5]);

// 完走が定義されるコースか (AS3 の raceableCourse と同じ述語)。**ゴールラインの有無だけ**を見る。
export const isCompletable = (c) => !!(c && c.finish);
// チャレンジの母集団に入るコースか。AY2 (2026-09-08・利用者裁定): 教材ベンチ (`bench`) を外す。
//   R_out < R_min を見せるために逆算したコースで、アプリ自身が説明文で「舵では原理的に曲がれません」と
//   書いている＝完走を前提にしていない。母集団に入れると ★5 と全コースのバッジが事実上取得不能になる
//   (実測: diff5 25→32・全 57→64 で分子は 0 のまま)。
//   **`isCompletable` は広げない**: あちらは「完走が定義されるか」で、ベンチはゴールラインを持つ＝定義は
//   される。混ぜると UI の説明文 (chal.excluded =「ゴールラインを持たない」) が嘘になる。除外の理由が
//   違うので件数も別に返し (excluded / excludedBench)、UI はそれぞれの理由を書く。
export const isChallengeCourse = (c) => isCompletable(c) && !c.bench;

// チャレンジ状態を組み立てる。
//   courses  = 組み立て済みコース配列 (name / diff / finish / beginner / noRace を見る)
//   carKeys  = 記録を探す車種キー配列 (練習記録は コース×車種 別に保存される・lap.js bestKey)
//   lookup   = (courseName, carType) => 練習記録 {t, ver, cond} | null   ← localStorage 依存の注入点
// 戻り値:
//   { rows[], byDiff[], total{done,total}, badges[], excluded, next }
//     rows[]    … コース別 { name, diff, done, cars[], bestSec, ver, stale }
//     byDiff[]  … 難度別 { diff, done, total, state:'none'|'started'|'clear' }
//     badges[]  … UI が並べるバッジ { key, icon, got, done, total }
//     excluded  … 完走が定義されず (ゴールライン無し) 母集団から外した件数
//     excludedBench … 完走を前提にしない教材ベンチとして母集団から外した件数 (AY2)
//     next      … 未完走のうち最もやさしいコース (難度昇順→名前昇順) or null
export function challengeState(courses, carKeys, lookup) {
  const rows = [];
  let excluded = 0, excludedBench = 0;
  for (const c of (courses || [])) {
    if (!isCompletable(c)) { excluded++; continue; }
    if (!isChallengeCourse(c)) { excludedBench++; continue; }
    const cars = [];
    let bestSec = null, ver = null, stale = false;
    for (const k of (carKeys || [])) {
      const rec = lookup(c.name, k);
      if (!rec || !(rec.t > 0)) continue;
      cars.push(k);
      if (bestSec == null || rec.t < bestSec) { bestSec = rec.t; ver = rec.ver || null; }
      if (!rec.ver) stale = true;         // 版スタンプの無い旧記録 (AP2 以前)。表示で正直に区別する。
    }
    rows.push({ name: c.name, nameEn: c.name_en || '', diff: (c.diff >= 1 && c.diff <= 5) ? c.diff : null,
      beginner: !!c.beginner, done: cars.length > 0, cars, bestSec, ver, stale });
  }
  // 表示順は 難度昇順 → 名前昇順 (決定論)。難度なし (自作等) は末尾。
  rows.sort((a, b) => ((a.diff == null ? 9 : a.diff) - (b.diff == null ? 9 : b.diff)) ||
    String(a.name).localeCompare(String(b.name)));

  const byDiff = DIFF_LEVELS.map((d) => {
    const inD = rows.filter((r) => r.diff === d);
    const done = inD.filter((r) => r.done).length;
    const total = inD.length;
    const state = total === 0 ? 'none' : (done === total ? 'clear' : (done > 0 ? 'started' : 'none'));
    return { diff: d, done, total, state };
  });

  const doneAll = rows.filter((r) => r.done).length;
  const total = { done: doneAll, total: rows.length };

  // バッジ。しきい値は**構造的**にだけ置く (「その難度の全コース」「全コース」「1つ以上」) —
  // 「★4 以上を 3 つ」のような恣意的な数を作らない (足せばそれは測っているものが変わる)。
  const badges = [
    { key: 'first', icon: '🔰', got: doneAll > 0, done: Math.min(doneAll, 1), total: 1 },
    ...byDiff.filter((d) => d.total > 0).map((d) => (
      { key: 'diff' + d.diff, icon: d.state === 'clear' ? '🏆' : '⭐', got: d.state === 'clear', done: d.done, total: d.total })),
    { key: 'all', icon: '🌏', got: rows.length > 0 && doneAll === rows.length, done: doneAll, total: rows.length },
  ];

  // 「次の一歩」= 未完走のうち最もやさしいもの (rows が既にその順なので先頭を拾うだけ)。
  const next = rows.find((r) => !r.done) || null;
  return { rows, byDiff, total, badges, excluded, excludedBench, next };
}
