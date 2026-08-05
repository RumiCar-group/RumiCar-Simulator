// シーズン/チャンピオンシップ と 言語別ラダー — Stage AS / AS13。
// 正準スペック docs/phase_w/W_spec.md §8 の任意バックログ2件 (「シーズン/チャンピオンシップ」
// 「複数クラス/言語別ラダー」) の**純ロジック**実装。DOM を持たず決定論的 (Math.random/Date 不使用)。
//
// 入力は race_ladder.recordsFrom / dnfsFrom の平坦レコード配列。**検証済 (verifyHash を持つ) 記録だけ**が
// そこに入る (W_spec §5/§7「尊敬が本物である根拠」) ので、本モジュールは追加の検証をしない。
//
// ── result.json の schema は一切変えていない (AS13 受け入れ基準②) ────────────────────
// シーズンは event.season (任意・未指定 = 既定シーズン)、言語は entries の program.lang から引く。
// どちらも result.json の外なので、**既に公開された result.json の再検証 (verifyHash / resultSha256) は
// 1 bit も動かない**。schema を足さないことが互換の保証そのものである。

import { realAuthor } from './race_ladder.js';

// ── 配点 (規定) ─────────────────────────────────────────────────────────────
// AS9〜AS12 の物理ブロックは「新しい絶対定数ゼロ」を設計目標にできたが、**選手権の配点は物理法則では
// なく競技規定**なので、定数を消そうとするのは筋が違う (消せば「完走台数−順位+1」等になり、補充車が
// 何台入ったかで価値が変わってしまう＝ノイズを配点に混ぜることになる)。
// ∴ 表として明示し、イベント側 (event.points) で上書き可能にする。既定はモータースポーツで広く
// 使われる逓減表 (1位から 10-8-6-5-4-3-2-1、9位以降 0)。**順位は補充車を含む実走順位**で引く
// (補充車に負けたら順位が下がる = 正しい)。ポイントを得るのは実在の著者だけ (realAuthor)。
export const POINTS_DEFAULT = Object.freeze([10, 8, 6, 5, 4, 3, 2, 1]);

// 順位 → ポイント。表の外 (下位) は 0。rank は 1 始まり。
export function pointsFor(rank, table = POINTS_DEFAULT) {
  const t = (Array.isArray(table) && table.length) ? table : POINTS_DEFAULT;
  const i = Math.round(rank) - 1;
  return (i >= 0 && i < t.length) ? (+t[i] || 0) : 0;
}

const seasonKey = (season, cls) => String(season) + '::' + String(cls);

// ── チャンピオンシップ順位表 ─────────────────────────────────────────────────
// (シーズン × クラス) ごとに著者別のポイント合計を出す。同一シーズンでも クラスが違えば別の選手権
// (規定が違う車で競っているので混ぜられない・W_spec §2「リーダーボードはクラス別 = 複数の梯子」と同型)。
// dnfs を渡すと出走数 (starts) にリタイアも数える (完走だけ数えると出走が過小になる)。
// 並びは (ポイント → 優勝 → 表彰台 → 完走 → 著者名) の決定論。
export function championships(records, dnfs = []) {
  const byKey = new Map();
  const grp = (season, cls) => {
    const k = seasonKey(season, cls);
    if (!byKey.has(k)) byKey.set(k, { key: k, season: String(season), cls: String(cls), events: new Set(), byAuthor: new Map() });
    return byKey.get(k);
  };
  const row = (g, author) => {
    if (!g.byAuthor.has(author)) {
      g.byAuthor.set(author, { author, points: 0, wins: 0, podiums: 0, finishes: 0, dnfs: 0, starts: 0,
        events: new Set(), bestRank: null });
    }
    return g.byAuthor.get(author);
  };

  for (const r of (records || [])) {
    const g = grp(r.season, r.cls);
    g.events.add(r.eventId);
    const a = realAuthor(r.author);
    if (!a) continue;                                  // 補充車は順位を占めるが選手権には入らない
    const p = row(g, a);
    p.points += pointsFor(r.rank, r.points);
    if (r.rank === 1) p.wins++;
    if (r.rank <= 3) p.podiums++;
    p.finishes++; p.starts++;
    p.events.add(r.eventId);
    if (p.bestRank == null || r.rank < p.bestRank) p.bestRank = r.rank;
  }
  for (const d of (dnfs || [])) {
    const g = grp(d.season, d.cls);
    g.events.add(d.eventId);
    const a = realAuthor(d.author);
    if (!a) continue;
    const p = row(g, a);
    p.dnfs++; p.starts++;                              // リタイアは 0 点だが出走ではある
    p.events.add(d.eventId);
  }

  const out = [];
  for (const g of byKey.values()) {
    const rows = [...g.byAuthor.values()].map((p) => ({ ...p, events: p.events.size }));
    rows.sort((a, b) =>
      (b.points - a.points) || (b.wins - a.wins) || (b.podiums - a.podiums) ||
      (b.finishes - a.finishes) || String(a.author).localeCompare(String(b.author)));
    // 王者 = 首位。ただし全員 0 点 (誰も入賞していない) なら「王者なし」を正直に返す。
    const champion = (rows.length && rows[0].points > 0) ? rows[0] : null;
    // カウントバック (ポイント→優勝→表彰台→完走) を使い切っても並ぶときは、最後の順序は著者名という
    // **競技上の意味を持たない** 決定論タイブレークになる。黙って1位を立てず tie で正直に返す。
    const tie = !!(champion && rows.length > 1 &&
      rows[1].points === rows[0].points && rows[1].wins === rows[0].wins &&
      rows[1].podiums === rows[0].podiums && rows[1].finishes === rows[0].finishes);
    out.push({ key: g.key, season: g.season, cls: g.cls, events: g.events.size, rows, champion, tie });
  }
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

// ── 言語別ラダー ────────────────────────────────────────────────────────────
// クラス別ラダー (race_ladder.leaderboards) と同型で、キーに**プログラム言語**を足したもの。
// 「C で書いている学習者は C の中で、Python なら Python の中で速さを競える」= 言語の壁で不利にならない。
// 言語が引けない記録 (補充車・entries が消えた古い記録) は**黙って混ぜず**除外し、件数を unknown で返す
// (沈黙截断の禁止・呼出側が「言語不明 N 件は除外」と表示できる)。
export function langBoards(records) {
  const byKey = new Map();
  let unknown = 0;
  for (const r of (records || [])) {
    if (!r.lang) { unknown++; continue; }
    const k = String(r.cls) + '::' + String(r.course) + '::' + String(r.lang);
    if (!byKey.has(k)) byKey.set(k, { key: k, cls: r.cls, course: r.course, lang: r.lang, rows: [] });
    byKey.get(k).rows.push(r);
  }
  const boards = [...byKey.values()];
  for (const b of boards) {
    b.rows.sort((a, c) =>
      (a.classifiedMs - c.classifiedMs) ||
      ((a.bestLapMs == null ? Infinity : a.bestLapMs) - (c.bestLapMs == null ? Infinity : c.bestLapMs)) ||
      String(a.name).localeCompare(String(c.name)));
    b.record = b.rows[0] || null;      // 👑 その言語×クラス×コースの最速
  }
  boards.sort((a, b) => a.key.localeCompare(b.key));
  return { boards, unknown };
}

// あるクラス×コースの「言語ごとの最速」だけを取り出す (ラダー表の脇に添える帯用)。lang 昇順。
export function langRecordsAt(langBoardList, cls, course) {
  return langBoardList
    .filter((b) => b.cls === cls && b.course === course && b.record)
    .map((b) => ({ lang: b.lang, rec: b.record, n: b.rows.length }))
    .sort((a, b) => String(a.lang).localeCompare(String(b.lang)));
}

// 言語別のドライバー集計 (どの言語でどれだけ走っているか)。言語不明は除外。lang 昇順。
export function langProfiles(records) {
  const by = new Map();
  for (const r of (records || [])) {
    if (!r.lang) continue;
    if (!by.has(r.lang)) by.set(r.lang, { lang: r.lang, entries: 0, wins: 0, authors: new Set(), bestMs: null });
    const p = by.get(r.lang);
    p.entries++;
    if (r.rank === 1) p.wins++;
    const a = realAuthor(r.author); if (a) p.authors.add(a);
    if (p.bestMs == null || r.classifiedMs < p.bestMs) p.bestMs = r.classifiedMs;
  }
  return [...by.values()]
    .map((p) => ({ ...p, authors: p.authors.size }))
    .sort((a, b) => String(a.lang).localeCompare(String(b.lang)));
}
