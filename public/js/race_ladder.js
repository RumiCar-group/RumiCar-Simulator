// 公式記録の集計 (Stage W / W6)。正準スペック docs/phase_w/W_spec.md §8
// (エンゲージメント／ロジック・ショーケース＝クラス別ラダー＋ドライバープロフィール／称号) の
// **純粋ロジック**実装。UI を持たず決定論的 (Math.random/Date 不使用)。
//
// 入力 = GitHub から取得した公式レースの配列 [{event, entries, result}] (loader.fetchRace の出力)。
// **検証済 (verified) のみを集計対象にする** = result が存在し verifyHash (固定環境の正準エンジンで
// 算出・人間レビュー済 PR で取り込み) を持つレースだけ (W_spec §5/§7・「尊敬が本物である根拠」)。
// ブラウザのローカル再実行結果は cross-PF で公式と一致しないことがある「参考」= ラダーに入れない
// (W_spec §5.1)。
//
// 二層モデル (W_spec §0): 練習 (非公式・localStorage・lap.js) はここに混ざらない。本モジュールは
// 公式記録だけを扱う。
import { courseShapeDigest } from './course_digest.js';

// 検証済 (= ラダー/プロフィール/称号に反映してよい) か。result + 非空 verifyHash を要件にする。
export function isVerified(race) {
  return !!(race && race.result && typeof race.result.verifyHash === 'string' && race.result.verifyHash);
}

const classifiedMs = (f) => Math.round((f.totalTimeMs || 0) + (f.penaltiesSec || 0) * 1000);

// ── BF4・2026-09-29: リーダーボードの「コース」の単位 (枠の鍵と見出し) ───────────────────────────────
// 旧実装は `String(result.course || event.course)` を枠の鍵にしていた。course は event.json の**参照**
// (出荷コース名・投稿コースの名前かファイル名・同梱 courseDef) で、参照はコースの同一性ではない:
//   同じ投稿コースを名前で開催した大会とファイル名で開催した大会が別の枠になり (見出しにファイル名が出る)、
//   同梱 def は `String()` で '[object Object]' の 1 枠に束ねられていた (別々の同梱コースの記録が同じ表に並び、
//   worldBest の `===` が当たらず 👻 は「ゴースト無し」になった) — BE-6 ② (a)。
// 枠の鍵 (courseKey) は**型の接頭辞つき**の文字列で、接頭辞は型で決まる＝型が違う鍵は決して一致しない:
//   'shape:<id>' … opts.courseUnit (アプリの解決規則＝main.js raceCourseUnit) が「再検証が走らせるコース」に解決できた
//                  参照。id は練習記録の鍵と同じ形の指紋 (名前・説明を抜いた形)。同じ形に解決する参照は 1 つの枠。
//                  接頭辞はここで付ける (courseUnit が何を返しても他の型の鍵と混ざらない)。
//   'ref:<文字列>' … 解決できない文字列参照 (投稿一覧を読めていない・消えた・複数に当たる、または courseUnit 無し)。
//                  従来どおり文字列で束ねる (勝手にまとめない)。
//   'def:<指紋>'   … 解決できない同梱 def。素の def を歩いた指紋 (courseShapeDigest・鍵の並びに依らない)。別の def は別の枠。
//   'race:<大会>'  … def を歩けない (循環・極端に深い入れ子で courseShapeDigest が投げる) とき。その大会だけの枠
//                  (混ぜるより分ける)。<大会> は eventId と verifyHash の組 (入力の並びに依らない)。
// 見出し (courseLabel) は courseUnit が返す表示名 (言語追従・注記はアプリ側)。courseUnit が id を返さず label だけを
// 返したときは、鍵は既定 (文字列・def の指紋) のまま見出しだけを使う (検査で断られた同梱 def に注記を付ける等)。
// courseUnit が無い・何も返さないときは、文字列参照は参照そのもの、同梱 def は文字列の name (無い・文字列でなければ
// '(courseDef)')。同じ枠に違う見出しの参照が入ったとき (名前だけ違う同じ形の投稿など) は、見出しを符号単位の昇順で
// ' / ' に並べる (環境の locale に依らない＝決定論)。
// 限界 (正直に書く): shape: の同一性は practiceCourseId (1e-6 の格子で丸めた 64bit の指紋・lap.js の注記) の同一性。
// **レース結果・verifyHash・result.json には触れない** (集計と表示の単位だけ)。
function defaultUnit(ref, raceTag) {
  if (ref !== null && typeof ref === 'object') {
    const label = (typeof ref.name === 'string' && ref.name) ? ref.name : '(courseDef)';
    try { return { key: 'def:' + courseShapeDigest(ref), label }; }
    catch (e) { return { key: 'race:' + raceTag, label }; }
  }
  return { key: 'ref:' + String(ref), label: String(ref) };
}
const raceTagOf = (eventId, verifyHash) => JSON.stringify([String(eventId || ''), String(verifyHash || '')]);
// 1 回の集計の中で参照ごとに 1 回だけ解決する (同じ大会の完走者・リタイアで同じ参照を何度も引く)。
// courseUnit(ref) → { id, label } | { label } | null。id が空・null・例外なら鍵は既定 (上の defaultUnit)、
// label が文字列ならそれを見出しにする。
function unitResolver(opts) {
  const resolve = (opts && typeof opts.courseUnit === 'function') ? opts.courseUnit : null;
  const byObj = new Map(), byPrim = new Map();
  return (ref, raceTag) => {
    const isObj = ref !== null && typeof ref === 'object';
    const memo = isObj ? byObj : byPrim;
    const mk = isObj ? ref : typeof ref + ':' + String(ref);
    if (memo.has(mk)) return memo.get(mk);
    let r = null;
    if (resolve) { try { r = resolve(ref); } catch (e) { r = null; } }
    const label = (r && typeof r.label === 'string') ? r.label : null;
    let u;
    if (r && typeof r.id === 'string' && r.id) u = { key: 'shape:' + r.id, label: label == null ? '' : label };
    else { u = defaultUnit(ref, raceTag); if (label != null) u = { key: u.key, label }; }
    memo.set(mk, u);
    return u;
  };
}
// レコードの枠の鍵・見出し。recordsFrom/dnfsFrom の出力は必ず courseKey/courseLabel を持つ。持たない (手で組んだ
// レコード) ときは既定の規則で course から作る (同梱 def を '[object Object]' にしない)。race_season も使う。
export function courseKeyOf(r) {
  return (r && typeof r.courseKey === 'string') ? r.courseKey : defaultUnit(r && r.course, raceTagOf(r && r.eventId, r && r.verifyHash)).key;
}
export function courseLabelOf(r) {
  return (r && typeof r.courseLabel === 'string') ? r.courseLabel : defaultUnit(r && r.course, '').label;
}
// 枠の中のレコードの見出しを 1 つにまとめる (違う見出しは符号単位の昇順で ' / ' 区切り)。
export function joinLabels(rows) {
  const s = [...new Set(rows.map(courseLabelOf))].sort();
  return s.join(' / ');
}
// 枠 (クラス×コース) の鍵。区切り文字を使わない (クラス名・参照に '::' が入っても別の枠が混ざらない)。
const groupKey = (cls, courseKey) => JSON.stringify([String(cls), courseKey]);

// ── BH1・2026-10-03: レコードの出どころの大会 ───────────────────────────────────────────────
// レコードの eventId は event.json / result.json の**中身**で、上流のディレクトリ名 (大会の実体) と違って一意の保証が無い:
// 2 つの大会が同じ eventId を名乗ることも、どちらにも書かれていないこともある。旧実装は eventId で大会を引き直していたので、
// 重複すると 👻 が最初の大会 (別のコース・別のエントリー) で走り、欠落すると大会を引けなかった。「参加」「n 戦」も eventId の
// 種類数で数えていたので、同じ eventId の 2 大会が 1 つに数えられた (BF-4 ② (c))。
// ∴ レコードを作るときに、その元になった大会オブジェクト (入力 races の要素そのもの) を覚えておき、raceOfRecord で引く。
// レコードの形 (フィールド) は変えない＝JSON にしたときの中身・入力の並びを変えたときの一致は従来どおり
// (添字を持たせると並びで値が変わる)。覚えは弱参照で、レコードが捨てられれば一緒に消える。
// 手で組んだレコード (recordsFrom/dnfsFrom を通っていない) は null を返す。数える側は従来どおり eventId で数える。
const _raceOf = new WeakMap();
export function raceOfRecord(rec) {
  return (rec !== null && typeof rec === 'object' && _raceOf.get(rec)) || null;
}
// 「何大会か」を数えるときの鍵。出どころが分かればその大会そのもの、分からなければ従来どおり eventId。race_season も使う。
export function raceKeyOf(rec) {
  return raceOfRecord(rec) || rec.eventId;
}

// 補充車 (filler) や著者不明は「ドライバー」ではない (称号の対象外)。
export function realAuthor(a) {
  const s = String(a || '').trim();
  return (s && s !== '(filler)' && s.toLowerCase() !== 'filler') ? s : null;
}

// ── AS13: 記録の**プログラム言語**を引く (言語別ラダー用) ──────────────────────────
// result.json (W_spec §6 schema) は言語を持たない。**持たせない**のが正しい: finishers に
// フィールドを足すと wf_official_result の resultSha256 (pin) が動き、既に公開された result.json の
// 再検証互換 (AS13 受け入れ基準②) に触れてしまう。言語は同じ PR に同梱される entries 側
// (W_spec §1 の program.lang) に既にあるので、**そこから引けば schema 拡張はゼロで済む**。
// 補充車 (filler) は entries に存在しない ⇒ 言語不明 (null) となり言語別ラダーから自然に外れる。
function langOfEntry(e, progLang) {
  if (!e) return null;
  const l = (e.program && e.program.lang) || e.lang || null;
  if (l) return String(l);
  // progKey 参照エントリー (docs/phase_w/official_sample_event.json 形式) は呼出側の解決表で引く。
  if (e.progKey && progLang) return progLang(e.progKey) || null;
  return null;
}

// author (無ければ name) → entry の索引。author は W_spec §1 の一次識別子、name は表示名。
function entryIndex(race) {
  const byAuthor = new Map(), byName = new Map();
  for (const e of ((race && race.entries) || [])) {
    const a = String(e.author || '').trim();
    const n = String(e.name || '').trim();
    if (a && !byAuthor.has(a)) byAuthor.set(a, e);
    if (n && !byName.has(n)) byName.set(n, e);
  }
  return { byAuthor, byName };
}
const entryOf = (ix, author, name) =>
  (author && ix.byAuthor.get(String(author).trim())) || (name && ix.byName.get(String(name).trim())) || null;

// 検証済レース群 → finisher レコードの平坦配列。各レコードは順位/著者/タイム/クラス/コース等を持つ。
// AS13 で **season / lang / points** を追記 (いずれも event/entries 由来＝result.json は不変)。
// opts.progLang(key) を渡すと progKey 参照エントリーの言語も解決する (省略可)。
// BF4: opts.courseUnit(ref) を渡すとコースの枠を「再検証が走らせるコースの形」で決める (上の注記)。各レコードは
//   course (参照そのもの・従来どおり) に加えて courseKey (枠の鍵) と courseLabel (その参照の見出し) を持つ。
export function recordsFrom(races, opts = {}) { return recordsWith(races, opts, unitResolver(opts)); }
function recordsWith(races, opts, unitOf) {
  const recs = [];
  for (const race of (races || [])) {
    if (!isVerified(race)) continue;
    const r = race.result, ev = race.event || {};
    const cls = r.class || ev.class || 'open';
    const course = r.course || ev.course || '';
    const unit = unitOf(course, raceTagOf(r.eventId || ev.id, r.verifyHash));
    const season = String(ev.season || '');                 // 未指定 = 既定シーズン ('' で1つに束ねる)
    const points = Array.isArray(ev.points) ? ev.points : null;   // イベント別の配点上書き (任意)
    const ix = entryIndex(race);
    // BH1: result.json の finishers が配列でない・行がオブジェクトでないときは、その行を飛ばす (1 件の壊れた結果で
    //   全大会の集計が例外で止まり、🏅 が「読み込み中」のまま固まった)。
    for (const f of (Array.isArray(r.finishers) ? r.finishers : [])) {
      if (f === null || typeof f !== 'object') continue;
      const rec = {
        eventId: r.eventId || ev.id || '', eventTitle: ev.title || r.eventId || ev.id || '',
        cls, course, courseKey: unit.key, courseLabel: unit.label,
        regime: r.regime || ev.regime || '', laps: r.laps || ev.laps || 0,
        engineVer: r.engineVer || ev.engineVer || '', verifyHash: r.verifyHash,
        rank: f.rank, name: f.name, author: f.author || '',
        carType: f.carType || '', totalTimeMs: f.totalTimeMs || 0,
        bestLapMs: f.bestLapMs != null ? f.bestLapMs : null,
        penaltiesSec: f.penaltiesSec || 0, classifiedMs: classifiedMs(f),
        programRef: f.programRef || null,
        season, points,
        lang: langOfEntry(entryOf(ix, f.author, f.name), opts.progLang),
      };
      _raceOf.set(rec, race);   // BH1: 出どころの大会 (上の注記)
      recs.push(rec);
    }
  }
  return recs;
}

// 検証済レース群 → **リタイア (DNF)** レコードの平坦配列。ラダー/称号には入れない (完走していない)。
// チャンピオンシップの「出走数」を正直に数えるためだけに使う (完走のみ数えると出走が過小になる)。
export function dnfsFrom(races, opts = {}) { return dnfsWith(races, opts, unitResolver(opts)); }
function dnfsWith(races, opts, unitOf) {
  const out = [];
  for (const race of (races || [])) {
    if (!isVerified(race)) continue;
    const r = race.result, ev = race.event || {};
    const course = r.course || ev.course || '';
    const unit = unitOf(course, raceTagOf(r.eventId || ev.id, r.verifyHash));
    const ix = entryIndex(race);
    for (const d of (Array.isArray(r.dnf) ? r.dnf : [])) {   // BH1: 完走と同じく壊れた行は飛ばす
      if (d === null || typeof d !== 'object') continue;
      const rec = {
        eventId: r.eventId || ev.id || '', eventTitle: ev.title || r.eventId || ev.id || '',
        cls: r.class || ev.class || 'open', course, courseKey: unit.key, courseLabel: unit.label,
        season: String(ev.season || ''), points: Array.isArray(ev.points) ? ev.points : null,
        name: d.name, author: d.author || '', carType: d.carType || '',
        lapsCompleted: d.lapsCompleted || 0, reason: d.reason || '',
        lang: langOfEntry(entryOf(ix, d.author, d.name), opts.progLang),
      };
      _raceOf.set(rec, race);   // BH1: 完走と同じ大会オブジェクト (選手権の出走大会数が完走とリタイアで二重にならない)
      out.push(rec);
    }
  }
  return out;
}

// クラス×コース別リーダーボード。各グループ rows を classified time 昇順 (タイブレーク bestLap→name)
// で並べ、record = rows[0] (=👑 コースレコード保持者)。
// BF4: コースの単位は courseKey (上の注記)。各枠は courseKey と courseLabel (枠の見出し) を持つ。course は枠の
//   最初のレコードの参照 (従来のフィールド・表示や照合には使わない)。枠の並びはクラス→見出し→鍵 (鍵は枠ごとに一意＝決定論)。
const cmpCode = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
export function leaderboards(records) {
  const byKey = new Map();
  for (const r of records) {
    const ck = courseKeyOf(r);
    const k = groupKey(r.cls, ck);
    if (!byKey.has(k)) byKey.set(k, { key: k, cls: r.cls, course: r.course, courseKey: ck, regime: r.regime, rows: [] });
    byKey.get(k).rows.push(r);
  }
  const boards = [...byKey.values()];
  for (const b of boards) {
    b.rows.sort((a, c) =>
      (a.classifiedMs - c.classifiedMs) ||
      ((a.bestLapMs == null ? Infinity : a.bestLapMs) - (c.bestLapMs == null ? Infinity : c.bestLapMs)) ||
      String(a.name).localeCompare(String(c.name)));
    b.record = b.rows[0] || null;     // 👑 そのクラス×コースの最速 = コースレコード
    b.courseLabel = joinLabels(b.rows);
  }
  boards.sort((a, b) => String(a.cls).localeCompare(String(b.cls)) ||
    a.courseLabel.localeCompare(b.courseLabel) || cmpCode(a.courseKey, b.courseKey));
  return boards;
}

// あるクラス×コースの世界ベスト (= リーダーボード row0) を引く。無ければ null。
// BF4: course は**枠の鍵** (board.courseKey)。参照の文字列ではない (参照は同一性ではない＝上の注記)。
export function worldBest(boards, cls, courseKey) {
  const b = boards.find((x) => String(x.cls) === String(cls) && x.courseKey === courseKey);
  return b ? b.record : null;
}

// ドライバープロフィール (著者別集計＋称号)。boards を渡してコースレコード保持数を数える。
// 並びは (コースレコード→優勝→表彰台→エントリー数 降順, 著者名 昇順) で決定論。
export function profiles(records, boards) {
  const recordHolder = new Map();   // author -> 保持コースレコード数
  for (const b of (boards || [])) {
    const a = b.record && realAuthor(b.record.author);
    if (a) recordHolder.set(a, (recordHolder.get(a) || 0) + 1);
  }
  const byAuthor = new Map();
  for (const r of records) {
    const a = realAuthor(r.author);
    if (!a) continue;
    if (!byAuthor.has(a)) byAuthor.set(a, { author: a, entries: 0, wins: 0, podiums: 0, events: new Set(), best: null });
    const p = byAuthor.get(a);
    p.entries++;
    if (r.rank === 1) p.wins++;
    if (r.rank <= 3) p.podiums++;
    p.events.add(raceKeyOf(r));   // BH1: 大会ごとに数える (eventId は重複・欠落しうる)
    if (!p.best || r.classifiedMs < p.best.classifiedMs) p.best = r;
  }
  const out = [...byAuthor.values()].map((p) => {
    const recordsHeld = recordHolder.get(p.author) || 0;
    return {
      author: p.author, entries: p.entries, wins: p.wins, podiums: p.podiums,
      events: p.events.size, recordsHeld,
      titles: titlesFor({ wins: p.wins, podiums: p.podiums, recordsHeld }),
      best: p.best,
    };
  });
  out.sort((a, b) =>
    (b.recordsHeld - a.recordsHeld) || (b.wins - a.wins) || (b.podiums - a.podiums) ||
    (b.entries - a.entries) || String(a.author).localeCompare(String(b.author)));
  return out;
}

// 称号バッジ (アイコン＋件数＋i18n キー)。UI が t(key,{n}) で文言化する。検証済記録のみから算出。
export function titlesFor({ wins, podiums, recordsHeld }) {
  const t = [];
  if (recordsHeld > 0) t.push({ icon: '👑', key: 'rank.title.record', n: recordsHeld });
  if (wins > 0) t.push({ icon: '🥇', key: 'rank.title.win', n: wins });
  if (podiums > 0) t.push({ icon: '🏅', key: 'rank.title.podium', n: podiums });
  return t;
}

// 起動時「打破通知」用。me (自分の GitHub author) が記録を持つグループで、世界ベスト保持者が
// 自分でない (= 抜かれている) ものを返す。{cls, course, courseKey, courseLabel, mine, world, gapMs} の配列 (gap 大きい順)。
// 静的 SPA のロード時チェック (W_spec §8・自己/エントリー記録 vs 世界ベスト)。
// BF4: グループは leaderboards の枠そのもの (courseKey)。表示には courseLabel (枠の見出し) を使う。
export function beatenChecks(records, me) {
  const author = realAuthor(me);
  if (!author) return [];
  const boards = leaderboards(records);
  const out = [];
  for (const b of boards) {
    if (!b.record) continue;
    const mineRows = b.rows.filter((r) => realAuthor(r.author) === author);
    if (!mineRows.length) continue;            // このグループに自分の記録なし
    const mine = mineRows[0];                  // 自分の最良 (rows は昇順)
    const world = b.record;
    if (realAuthor(world.author) === author) continue;   // 自分が世界ベスト = 抜かれていない
    out.push({ cls: b.cls, course: b.course, courseKey: b.courseKey, courseLabel: b.courseLabel,
      mine, world, gapMs: mine.classifiedMs - world.classifiedMs });
  }
  out.sort((a, b) => (b.gapMs - a.gapMs));
  return out;
}

// まとめて集計 (UI が1回で全部得る)。races = [{event,entries,result}]。
// AS13: dnfs (チャンピオンシップの出走数用) も同時に返す。既存の返りフィールドは不変 (追加のみ)。
// BF4: opts.courseUnit (上の注記) は完走とリタイアで同じ解決を使う (参照ごとに 1 回だけ引く)。
export function aggregate(races, opts = {}) {
  const unitOf = unitResolver(opts);
  const records = recordsWith(races, opts, unitOf);
  const boards = leaderboards(records);
  const drivers = profiles(records, boards);
  return { records, dnfs: dnfsWith(races, opts, unitOf), boards, drivers,
    verifiedCount: (races || []).filter(isVerified).length };
}
