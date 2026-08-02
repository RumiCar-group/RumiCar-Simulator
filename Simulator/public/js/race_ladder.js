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

// 検証済 (= ラダー/プロフィール/称号に反映してよい) か。result + 非空 verifyHash を要件にする。
export function isVerified(race) {
  return !!(race && race.result && typeof race.result.verifyHash === 'string' && race.result.verifyHash);
}

const classifiedMs = (f) => Math.round((f.totalTimeMs || 0) + (f.penaltiesSec || 0) * 1000);
const groupKey = (cls, course) => String(cls) + '::' + String(course);

// 補充車 (filler) や著者不明は「ドライバー」ではない (称号の対象外)。
function realAuthor(a) {
  const s = String(a || '').trim();
  return (s && s !== '(filler)' && s.toLowerCase() !== 'filler') ? s : null;
}

// 検証済レース群 → finisher レコードの平坦配列。各レコードは順位/著者/タイム/クラス/コース等を持つ。
export function recordsFrom(races) {
  const recs = [];
  for (const race of (races || [])) {
    if (!isVerified(race)) continue;
    const r = race.result, ev = race.event || {};
    const cls = r.class || ev.class || 'open';
    const course = r.course || ev.course || '';
    for (const f of (r.finishers || [])) {
      recs.push({
        eventId: r.eventId || ev.id || '', eventTitle: ev.title || r.eventId || ev.id || '',
        cls, course, regime: r.regime || ev.regime || '', laps: r.laps || ev.laps || 0,
        engineVer: r.engineVer || ev.engineVer || '', verifyHash: r.verifyHash,
        rank: f.rank, name: f.name, author: f.author || '',
        carType: f.carType || '', totalTimeMs: f.totalTimeMs || 0,
        bestLapMs: f.bestLapMs != null ? f.bestLapMs : null,
        penaltiesSec: f.penaltiesSec || 0, classifiedMs: classifiedMs(f),
        programRef: f.programRef || null,
      });
    }
  }
  return recs;
}

// クラス×コース別リーダーボード。各グループ rows を classified time 昇順 (タイブレーク bestLap→name)
// で並べ、record = rows[0] (=👑 コースレコード保持者)。グループは key 昇順 (決定論)。
export function leaderboards(records) {
  const byKey = new Map();
  for (const r of records) {
    const k = groupKey(r.cls, r.course);
    if (!byKey.has(k)) byKey.set(k, { key: k, cls: r.cls, course: r.course, regime: r.regime, rows: [] });
    byKey.get(k).rows.push(r);
  }
  const boards = [...byKey.values()];
  for (const b of boards) {
    b.rows.sort((a, c) =>
      (a.classifiedMs - c.classifiedMs) ||
      ((a.bestLapMs == null ? Infinity : a.bestLapMs) - (c.bestLapMs == null ? Infinity : c.bestLapMs)) ||
      String(a.name).localeCompare(String(c.name)));
    b.record = b.rows[0] || null;     // 👑 そのクラス×コースの最速 = コースレコード
  }
  boards.sort((a, b) => a.key.localeCompare(b.key));
  return boards;
}

// あるクラス×コースの世界ベスト (= リーダーボード row0) を引く。無ければ null。
export function worldBest(boards, cls, course) {
  const b = boards.find((x) => x.cls === cls && x.course === course);
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
    p.events.add(r.eventId);
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
// 自分でない (= 抜かれている) ものを返す。{cls, course, mine, world, gapMs} の配列 (gap 大きい順)。
// 静的 SPA のロード時チェック (W_spec §8・自己/エントリー記録 vs 世界ベスト)。
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
    out.push({ cls: b.cls, course: b.course, mine, world, gapMs: mine.classifiedMs - world.classifiedMs });
  }
  out.sort((a, b) => (b.gapMs - a.gapMs));
  return out;
}

// まとめて集計 (UI が1回で全部得る)。races = [{event,entries,result}]。
export function aggregate(races) {
  const records = recordsFrom(races);
  const boards = leaderboards(records);
  const drivers = profiles(records, boards);
  return { records, boards, drivers, verifiedCount: (races || []).filter(isVerified).length };
}
