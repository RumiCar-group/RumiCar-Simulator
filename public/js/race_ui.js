// race_ui.js — Stage AP23: main.js 責務分割 第1弾。レース結果ダイアログ・公式レース(W5)・
// エンゲージメント層(W6: ランキング/打破通知/📖ショーケース/🍴fork)・👻ゴースト再生 の UI を集約。
// 純粋な「関数移動」= 移動前後で関数本文は byte 同一 (bare 参照のまま)。物理は非参加
// (f0-f3/verifyHash 不変)。依存注入 initRaceUI(deps) で main.js のヘルパ($/escapeHtml/logLine 等)を
// 束縛し main.js への逆 import を作らない(循環 import 0 維持)。共有可変 course は ./state.js の
// live binding を読む。ghost 再生用の直近レース(pendingRaceGhost)等はこのモジュール内に閉じる。
import { FLEET, CAR_TYPE_BY_KEY, APP_VERSION } from './config.js';
import { runRace, engineFingerprint } from './race_engine.js';
import { frozenField } from './race_event.js';
import { aggregate, worldBest, beatenChecks } from './race_ladder.js';
// AS13: シーズン/チャンピオンシップ・言語別ラダー (result.json の schema は不変・event/entries から引く)
import { championships, langBoards, langRecordsAt, langProfiles, POINTS_DEFAULT } from './race_season.js';
import { ghostProgressModel, ghostStandingsAt, ghostPasses } from './ghost_gap.js';
import { sectorAnalysis, SECTORS_DEFAULT } from './sector.js';   // AS13: 区間別テレメトリ比較 (観測のみ)
import { PROGRAM_BY_KEY } from './programs.js';                  // AS13: progKey 参照エントリーの言語解決
import { fmtTime, loadBestRec } from './lap.js';
import * as SFX from './sfx.js';
import { drawCourse, worldToScreen } from './course.js';
import { fetchRace, listOfficialRaces, shareEntryUrl } from './loader.js';
import { t, applyI18n } from './i18n.js';
import { course } from './state.js';

// --- 依存注入スロット(initRaceUI で main.js から束縛。関数本文は bare 参照のまま=byte 不変) ---
let $, escapeHtml, logLine, activeSlot, exitEdit, courseDisplayName, carTypeLabel, entryCarLabel, setActiveProgram, playCountdown, resolveRaceCourse;

function renderRaceResult(res, meta) {
  // 色は field(=結果)のインデックスで割当 (FLEET.colors)。W3 は field=slots 順なので live 列色と一致、
  // W4 開催は entries+filler の独自順なので field idx 基準が正 (slot とは対応しない)。
  const colorOf = (idx) => FLEET.colors[idx % FLEET.colors.length];
  const esc = escapeHtml;
  const fp = engineFingerprint();
  const rc = meta.course || course;   // W5 公式再実行はイベントのコース・W3/W4 は現在のコース
  // --- メタ ---
  const metaRows = [
    [t('race.meta.course'), esc(courseDisplayName(rc))],
    [t('race.meta.regime'), esc(t('fleet.regime.' + (meta.regime || 'tabletop')))],
    [t('race.meta.laps'), String(meta.laps)],
  ];
  if (meta.eventInfo) {   // W4 ローカル開催の注記 (クラス/予算/補充車)
    metaRows.push([t('event.meta.class'), esc(meta.eventInfo.classLabel)]);
    if (meta.eventInfo.budget != null) metaRows.push([t('event.meta.budget'), String(meta.eventInfo.budget)]);
    if (meta.eventInfo.fillerCount) metaRows.push([t('event.meta.filler'), String(meta.eventInfo.fillerCount)]);
  }
  metaRows.push(
    [t('race.meta.crash'), esc(meta.crashTxt)],
    [t('race.meta.physver'), esc(fp.appVersion)],   // AK6: 記録に物理(engine)版を保持・表示
    [t('race.meta.engine'), esc(fp.exec)],
    [t('race.meta.hash'), '<code>' + esc(res.verifyHash) + '</code>'],
  );
  $('raceMeta').innerHTML =
    '<table class="race-metatab">' + metaRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('') + '</table>' +
    `<p class="race-localnote">${esc(t('race.meta.localnote'))}</p>` +
    (meta.verifyHtml || '');   // W5: 公式 verifyHash との照合ノート (ローカル再実行検証・参考)

  // --- ミニマップ (コース + クラッシュ✕ + 最終位置●) ---
  drawRaceMap(res, colorOf, rc);

  // --- AB9: 勝者セレモニー / コースレコード祝祭 (presentation のみ・hash 非参加) ---
  // ファステストラップ = 完走車のうち bestLapMs 最小。コースレコードは既存 lap best (W2 練習記録
  // lap.js loadBestRec・読み取り専用) との照合で「樹立/更新」を判定し祝祭する (書き込みはしない=
  // casual は非永続 W_spec §0・既存 lap best と整合)。**AP2b 単位是正**: fastest.bestLapMs は
  // ミリ秒、練習ベスト rec.t は秒。旧実装は ms と秒を直接比較し「更新！」祝祭が dead path だった。
  let bannerHtml = '';
  let fastest = null;
  if (res.finishers.length) {
    for (const f of res.finishers) {
      if (f.bestLapMs == null) continue;
      if (!fastest || f.bestLapMs < fastest.bestLapMs) fastest = f;
    }
    let recordHtml = '';
    if (fastest) {
      const prevRec = loadBestRec(rc.name, fastest.carType);   // 既存 lap best (読み取り専用)
      const prev = prevRec ? prevRec.t : null;                 // 記録タイム t (単位=秒。無ければ null)
      const fSec = fastest.bestLapMs / 1000;                   // レース best を秒へ (bestLapMs=ミリ秒)
      const fTime = fmtTime(fSec);
      if (prev == null || fSec < prev) {                       // AP2b: 秒どうしで比較 (旧: ms<秒 で常時 false)
        const key = prev == null ? 'race.record.new' : 'race.record.beat';
        const gap = prev == null ? '' : (prev - fSec).toFixed(2);   // AP2b: 秒どうしの差
        let rec = esc(t(key, { name: fastest.name, time: fTime, gap }));
        // AP2b: 更新した練習ベストが旧エンジン版 (ver≠現行) で樹立されていた場合は「参考(当時 vX)」を
        //       併記 (当時の条件で樹立された記録を更新した旨・現行版では条件が異なりうる)。
        if (prev != null && prevRec.ver && prevRec.ver !== APP_VERSION) {
          rec += ` <span class="rw-record-note">${esc(t('race.record.archived', { ver: prevRec.ver }))}</span>`;
        }
        recordHtml = `<span class="rw-record">${rec}</span>`;
      } else {
        recordHtml = `<span class="rw-fast">${esc(t('race.fastestLap', { name: fastest.name, time: fTime }))}</span>`;
      }
    }
    const winner = res.finishers[0];
    bannerHtml = `<div class="race-winner-banner"><span class="rw-name">${esc(t('race.winner', { name: winner.name }))}</span> ` +
      `<span class="hint">${esc(carTypeLabel(winner.carType))}</span>${recordHtml}</div>`;
  }

  // --- 結果本体 (勝者バナー → ミニマップ凡例 → 完走 → DNF → レポート) ---
  let html = `<p class="race-mapnote">${esc(t('race.map.note'))}</p>`;
  html += bannerHtml;
  html += `<h3>${esc(t('race.finishers'))}</h3>`;
  if (res.finishers.length) {
    html += '<table class="race-tab"><thead><tr>' +
      [t('race.col.rank'), t('race.col.name'), t('race.col.car'), t('race.col.time'), t('race.col.best'), t('race.col.pen')]
        .map((h) => `<th>${esc(h)}</th>`).join('') + '</tr></thead><tbody>';
    for (const f of res.finishers) {
      // AB9: 1位行ハイライト (race-row-win) ＋ ファステストラップ行 (race-row-fast)
      const rowCls = (f.rank === 1 ? ' race-row-win' : '') + (fastest && f.idx === fastest.idx ? ' race-row-fast' : '');
      html += `<tr class="${rowCls.trim()}">` +
        `<td>${f.rank}</td>` +
        `<td><span class="race-dot" style="background:${colorOf(f.idx)}"></span>${esc(f.name)}</td>` +
        `<td>${esc(carTypeLabel(f.carType))}</td>` +
        `<td>${fmtTime(f.totalTimeMs / 1000)}</td>` +
        `<td>${f.bestLapMs != null ? fmtTime(f.bestLapMs / 1000) : '—'}</td>` +
        `<td>${f.penaltiesSec ? '+' + f.penaltiesSec + 's' : '—'}</td>` +
        '</tr>';
    }
    html += '</tbody></table>';
  } else {
    html += `<p class="race-empty">${esc(t('race.none'))}</p>`;
    // AB1: 0完走の能動サマリ。全 DNF の理由 (timeout/crash) で文言を出し分け、原因の手がかりを示す。
    const reasons = (res.dnf || []).map((d) => d.reason);
    const anyTimeout = reasons.includes('timeout');
    const anyCrash = reasons.includes('crash');
    const sumKind = (anyTimeout && anyCrash) ? 'mixed'
      : anyCrash ? 'crashAll'
      : 'timeoutAll';
    html += `<p class="race-summary">${esc(t('race.summary.' + sumKind))}</p>`;
  }

  // --- リタイア (DNF) ---
  if (res.dnf.length) {
    html += `<h3>${esc(t('race.dnf'))}</h3><table class="race-tab"><thead><tr>` +
      [t('race.col.name'), t('race.col.car'), t('race.dnf.col.laps'), t('race.dnf.col.reason')]
        .map((h) => `<th>${esc(h)}</th>`).join('') + '</tr></thead><tbody>';
    for (const d of res.dnf) {
      html += '<tr>' +
        `<td><span class="race-dot" style="background:${colorOf(d.idx)}"></span>${esc(d.name)}</td>` +
        `<td>${esc(carTypeLabel(d.carType))}</td>` +
        `<td>${d.lapsCompleted}</td>` +
        `<td>${esc(t('race.reason.' + d.reason))}</td>` +
        '</tr>';
    }
    html += '</tbody></table>';
  }

  // --- レースレポート (適不適の手がかり: μ円ピーク・βピーク・クラッシュ数・見立て) ---
  if (res.report && res.report.length) {
    html += `<h3>${esc(t('race.report'))}</h3><table class="race-tab"><thead><tr>` +
      [t('race.col.name'), t('race.report.fric'), t('race.report.beta'), t('race.report.crashes'), t('race.report.suit')]
        .map((h) => `<th>${esc(h)}</th>`).join('') + '</tr></thead><tbody>';
    // AB1: 見立ては finished? と dnf_reason(crash/timeout) 起点に再構成。reason は race_engine の
    // dnf リスト (観測値) を idx で引く (race_engine.js は無改変・verifyHash 不変)。
    const dnfReasonByIdx = new Map((res.dnf || []).map((d) => [d.idx, d.reason]));
    for (const r of res.report) {
      let suit;
      if (r.finished) {
        // 完走は否定一辺倒にせず μ円ピークで段階表現 (無事故=好適 / >=150%=滑走多めだが破綻なし)
        suit = (r.muPeakPct != null && r.muPeakPct >= 150) ? t('race.suit.slip') : t('race.suit.finish');
      } else {
        const reason = dnfReasonByIdx.get(r.idx);
        suit = reason === 'timeout' ? t('race.suit.timeout')
          : reason === 'crash' ? t('race.suit.crash')
          : t('race.suit.dnf');   // 理由不明時のフォールバック
      }
      html += '<tr>' +
        `<td><span class="race-dot" style="background:${colorOf(r.idx)}"></span>${esc(r.name)}</td>` +
        `<td>${r.muPeakPct != null ? r.muPeakPct + '%' : '—'}</td>` +
        `<td>${r.betaPeakDeg != null ? r.betaPeakDeg + '°' : '—'}</td>` +
        `<td>${r.crashCount || 0}</td>` +
        `<td>${esc(suit)}</td>` +
        '</tr>';
    }
    html += '</tbody></table>';
  }

  $('raceResults').innerHTML = html;
  // 👻 ゴースト再生 (W6): ghost 軌跡があるときだけボタンを出し、直近レースを stash して再生に使う。
  pendingRaceGhost = (res.ghost && res.ghost.frames && res.ghost.frames.length)
    ? { ghost: res.ghost, course: rc, title: esc(courseDisplayName(rc)), replay: meta.replay || { kind: 'recorded' } } : null;  // AK6: 公式再実行は rerun/ライブは recorded
  const gb = $('raceGhost'); if (gb) gb.hidden = !pendingRaceGhost;
  const dlg = $('dlgRace');
  applyI18n(dlg);            // 静的 data-i18n (タイトル) を現在言語で反映
  dlg.showModal();
}

// レポートのミニマップ: コースを fit し、クラッシュ地点に✕・最終位置に●を打つ (適不適の可視化)。
// rc = 描画するコース (W5 公式再実行はイベントのコース・W3/W4 は現在のコース)。
function drawRaceMap(res, colorOf, rc = course) {
  const cv = $('raceMap'); if (!cv) return;
  const maxW = 520, maxH = 300;
  const sc = Math.min(maxW / rc.bounds.w, maxH / rc.bounds.h);
  const mview = { hM: rc.bounds.h, pxPerM: sc, wPx: Math.round(rc.bounds.w * sc), hPx: Math.round(rc.bounds.h * sc) };
  cv.width = mview.wPx; cv.height = mview.hPx;
  const mctx = cv.getContext('2d');
  drawCourse(mctx, rc, mview, { grid: false });
  if (!res.report) return;
  // 最終位置 ● (全車)
  for (const r of res.report) {
    const p = worldToScreen({ x: r.finalX, y: r.finalY }, mview);
    mctx.beginPath(); mctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    mctx.fillStyle = colorOf(r.idx); mctx.fill();
    mctx.lineWidth = 1; mctx.strokeStyle = 'rgba(0,0,0,0.6)'; mctx.stroke();
  }
  // クラッシュ地点 ✕ (適不適が一目で分かる)
  for (const r of res.report) {
    if (r.crashX == null) continue;
    const p = worldToScreen({ x: r.crashX, y: r.crashY }, mview);
    mctx.save();
    mctx.strokeStyle = colorOf(r.idx); mctx.lineWidth = 2.4; mctx.lineCap = 'round';
    const d = 5.5;
    mctx.beginPath();
    mctx.moveTo(p.x - d, p.y - d); mctx.lineTo(p.x + d, p.y + d);
    mctx.moveTo(p.x + d, p.y - d); mctx.lineTo(p.x - d, p.y + d);
    mctx.stroke(); mctx.restore();
  }
}

let officialRaces = null;     // listOfficialRaces の結果 (null=未取得/失敗・[]=0件・[...]=一覧)
let officialCurrent = null;   // 選択中の { event, entries, result }

// 起動時に公式レース一覧を読み込む (失敗しても本体は止めない・Q1/V4 契約)。
async function loadOfficialRaces() {
  let list;
  try { list = await listOfficialRaces(); } catch (e) { list = null; }
  if (list === null) { officialRaces = null; logLine(t('log.ghRacesFail')); return; }
  officialRaces = list;
  if (list.length) logLine(t('log.ghRacesLoaded', { n: list.length }));
}

// イベントのエントリー期間 {open,close} と現在時刻から状態を決める (結果確定済みは closed)。
function raceStatus(event, hasResult) {
  if (hasResult) return 'closed';
  const w = (event && event.entryWindow) || {};
  const now = Date.now();
  const open = w.open ? Date.parse(w.open) : NaN;
  const close = w.close ? Date.parse(w.close) : NaN;
  if (!Number.isNaN(close) && now > close) return 'closed';
  if (!Number.isNaN(open) && now < open) return 'upcoming';
  return 'open';
}

// 車種キー → 同梱用の carDef (純データ clone・runtime フラグ custom/community は落とす)。
function carDefForEntry(carType) {
  const ct = CAR_TYPE_BY_KEY[carType];
  if (!ct) return null;
  const def = {};
  for (const k of Object.keys(ct)) { if (k === 'custom' || k === 'community') continue; def[k] = ct[k]; }
  return JSON.parse(JSON.stringify(def));   // drift ネストも含めて複製
}



function openOfficialDlg() {
  exitEdit();
  renderOfficialSelect();
  $('ofMsg').textContent = '';
  $('ofEntry').hidden = true;
  $('ofName').value = ''; $('ofAuthor').value = loadMe();   // 自分の GitHub を prefill (W6)
  if (!officialRaces || !officialRaces.length) $('ofDetail').innerHTML = `<p class="race-empty">${escapeHtml(t('official.none'))}</p>`;
  else $('ofDetail').innerHTML = `<p class="hint">${escapeHtml(t('official.pickHint'))}</p>`;
  const dlg = $('dlgOfficial'); applyI18n(dlg); dlg.showModal();
}

function renderOfficialSelect() {
  const sel = $('ofRace'); if (!sel) return;
  const list = officialRaces || [];
  sel.innerHTML = '<option value="">—</option>' + list.map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.id)}</option>`).join('');
}

// 一覧を取り直す (再読込ボタン)。
async function reloadOfficial() {
  $('ofMsg').textContent = t('official.loading');
  await loadOfficialRaces();
  renderOfficialSelect();
  $('ofMsg').textContent = '';
  $('ofEntry').hidden = true;
  if (!officialRaces || !officialRaces.length) $('ofDetail').innerHTML = `<p class="race-empty">${escapeHtml(t('official.none'))}</p>`;
  else $('ofDetail').innerHTML = `<p class="hint">${escapeHtml(t('official.pickHint'))}</p>`;
}

// 大会を選択 → fetchRace → 詳細描画。
async function selectOfficialRace(id) {
  officialCurrent = null;
  $('ofEntry').hidden = true;
  if (!id) { $('ofDetail').innerHTML = `<p class="hint">${escapeHtml(t('official.pickHint'))}</p>`; return; }
  $('ofDetail').innerHTML = `<p class="hint">${escapeHtml(t('official.loading'))}</p>`;
  let race;
  try { race = await fetchRace(id); } catch (e) { race = null; }
  if (!race) { $('ofDetail').innerHTML = `<p class="race-empty">${escapeHtml(t('official.fetchFail'))}</p>`; return; }
  officialCurrent = race;
  renderOfficialDetail(race);
}

// 1 大会の詳細 (メタ・エントリー・公式結果・再実行検証ボタン) を描画。
function renderOfficialDetail(race) {
  const { event, entries, result } = race;
  const esc = escapeHtml;
  const status = raceStatus(event, !!result);
  const cls = event.class || 'open';
  const courseName = (event.course && typeof event.course === 'object') ? (event.course.name || '(courseDef)') : event.course;
  const win = event.entryWindow || {};
  const winTxt = (win.open || '—') + '  →  ' + (win.close || '—');
  const metaRows = [
    [t('official.meta.title'), esc(event.title || event.id || '')],
    [t('official.meta.course'), esc(courseDisplayName(event.course) || courseName || '')],
    [t('official.meta.class'), esc(t('event.class.' + cls))],
    [t('official.meta.laps'), String(event.laps || 3)],
    [t('official.meta.window'), esc(winTxt)],
    [t('official.meta.engine'), esc(event.engineVer || '?')],
    [t('official.meta.status'), esc(t('official.status.' + status))],
  ];
  let html = '<table class="race-metatab">' + metaRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('') + '</table>';

  // エントリー (締切後のみプログラム公開 = policy・ここでは名前/投稿者/車種を表示)
  html += `<h3>${esc(t('official.entries', { n: entries.length }))}</h3>`;
  if (entries.length) {
    html += '<table class="race-tab"><thead><tr>' +
      [t('race.col.name'), t('official.col.author'), t('race.col.car')].map((h) => `<th>${esc(h)}</th>`).join('') + '</tr></thead><tbody>';
    for (const e of entries) {
      const carLabel = entryCarLabel(e.carType, e.carDef);
      html += `<tr><td>${esc(e.name || '')}</td><td>${esc(e.author || '')}</td><td>${esc(carLabel)}</td></tr>`;
    }
    html += '</tbody></table>';
    // プログラム公開ポリシー (W_spec §8): 開催中は非公開 → 締切後に全公開 (閲覧+fork)。
    if (status !== 'closed') html += `<p class="hint">${esc(t('official.entries.hidden'))}</p>`;
    else html += officialProgPanels(entries);   // 締切後: プログラム閲覧 + 🍴 fork (帰属つき)
  } else {
    html += `<p class="race-empty">${esc(t('official.entries.empty'))}</p>`;
  }

  // 公式結果 (確定記録)
  html += `<h3>${esc(t('official.result'))}</h3>`;
  if (result && Array.isArray(result.finishers)) {
    html += `<p class="official-result-meta">${esc(t('official.result.verified', { hash: result.verifyHash || '?', ver: result.engineVer || '?', exec: result.exec || '?' }))}</p>`;
    // AK6: 当時のエンジン版で樹立され現行では完全再現しない可能性のある旧記録を、再実行を待たずに1行で正直明示
    // (称賛は条件付き記録として維持)。物理版が一致する記録には出さない (誤検知なし)。
    const recVer = result.engineVer || event.engineVer || '';
    if (recVer && recVer !== APP_VERSION) {
      html += `<p class="official-result-meta warn">${esc(t('official.result.archived', { rec: recVer, app: APP_VERSION }))}</p>`;
    }
    html += '<table class="race-tab"><thead><tr>' +
      [t('race.col.rank'), t('race.col.name'), t('official.col.author'), t('race.col.car'), t('race.col.time'), t('race.col.best'), t('race.col.pen')]
        .map((h) => `<th>${esc(h)}</th>`).join('') + '</tr></thead><tbody>';
    for (const f of result.finishers) {
      const carLabel = entryCarLabel(f.carType, f.carDef);
      html += `<tr><td>${f.rank}</td><td>${esc(f.name || '')}</td><td>${esc(f.author || '')}</td><td>${esc(carLabel)}</td>` +
        `<td>${f.totalTimeMs != null ? fmtTime(f.totalTimeMs / 1000) : '—'}</td>` +
        `<td>${f.bestLapMs != null ? fmtTime(f.bestLapMs / 1000) : '—'}</td>` +
        `<td>${f.penaltiesSec ? '+' + f.penaltiesSec + 's' : '—'}</td></tr>`;
    }
    html += '</tbody></table>';
  } else {
    html += `<p class="race-empty">${esc(t('official.result.none'))}</p>`;
  }

  // 📖 ロジック・ショーケース (W_spec §8): 締切後、優勝ロジックを「義務」でなく栄誉として讃える。
  // 原作者クレジットは公開＋fork に永続 (晒すのでなく名が刻まれ続ける)。作者は intro で自ら発表できる。
  if (status === 'closed' && result && Array.isArray(result.finishers) && result.finishers.length) {
    const w = result.finishers[0];
    const wEntry = entries.find((e) => (e.author || '') === (w.author || '') && (w.author || '')) || null;
    const wIntro = wEntry && wEntry.intro ? wEntry.intro : '';
    html += `<div class="official-showcase"><div class="official-badge">${esc(t('official.featured'))}</div>` +
      `<p class="official-winner">${esc(t('official.winner'))}: <b>${esc(w.name || '')}</b> <span class="hint">by ${esc(w.author || '?')}</span></p>` +
      `<p class="official-honor">${esc(t('official.featured.note'))}</p>`;
    if (wIntro) html += `<p class="official-intro"><b>${esc(t('official.intro.h'))}:</b> ${esc(wIntro)}</p>`;
    html += `</div>`;
  }

  // 再実行検証 (参考)
  html += `<p style="margin-top:10px"><button id="ofVerify" class="primary" title="${esc(t('official.verify.title'))}">${esc(t('official.verify'))}</button></p>`;
  html += '<div id="ofVerifyNote"></div>';

  $('ofDetail').innerHTML = html;
  $('ofVerify').addEventListener('click', () => verifyOfficialLocally(race));

  // エントリー欄: 受付中のみ表示し、既定の車両名を現在のアクティブ車に。
  const entryOpen = status === 'open';
  $('ofEntry').hidden = !entryOpen;
  if (entryOpen && !$('ofName').value) $('ofName').value = activeSlot() ? activeSlot().name : '';
}

// 締切時の確定エントリー列をローカル決定論エンジンで再実行し、公式 verifyHash と照合 (参考)。
function verifyOfficialLocally(race) {
  const { event, entries, result } = race;
  const note = $('ofVerifyNote');
  const rcourse = resolveRaceCourse(event.course);
  if (!rcourse) {
    const cn = (event.course && typeof event.course === 'object') ? (event.course.name || '') : event.course;
    if (note) note.innerHTML = `<p class="official-verify-note warn">${escapeHtml(t('official.verify.noCourse', { name: cn }))}</p>`;
    return;
  }
  const field = frozenField(event, entries);
  const regime = event.regime || null;
  const laps = Math.max(1, Math.round(event.laps || 3));
  const crashRule = event.crashRule || { rejoin: false, penaltySec: 3 };
  const ix = event.interact !== false;   // 既定 true (対戦)
  // AB2: 公式記録は spec に凍結した maxSec で再実行する (同 maxSec ⇒ 同結果 ⇒ verifyHash 一致)。
  // maxSec 未刻の旧記録は旧固定既定 180 にフォールバック (作成時と同条件 ＝ hash 不変)。
  const maxSec = event.maxSec != null ? event.maxSec : 180;
  // AD1: 記録に凍結グリッド (result.grid) があれば渡して算法非依存に忠実再現する。
  // 旧記録 (grid 未刻) は null=従来の freeSpawn 算法フォールバック (作成時と同条件＝hash 不変)。
  const grid = (result && Array.isArray(result.grid)) ? result.grid : null;
  let res;
  try {
    res = runRace({ course: rcourse, regime, laps, field, crashRule, interact: ix, maxSec, grid, report: true, ghost: true,
      physics: event.physicsMode || 'dynamic',   // AO5: 記録のエンジンで再走 (旧記録=dynamic フォールバック=作成時と同条件)
      recon: event.recon > 0 ? { laps: event.recon } : null,   // AO9: 記録の試走周回数で再走 (旧記録=未刻=0=従来)
      wear: !!event.wear });   // AO12: 記録のタイヤ摩耗設定で再走 (旧記録=未刻=false=従来)
  } catch (e) {
    if (note) note.innerHTML = `<p class="official-verify-note warn">${escapeHtml(t('log.race.err', { e: (e && e.message) || e }))}</p>`;
    return;
  }
  // 検証ノート: engineVer 差 → verifyHash 一致/不一致 (環境差で公式と一致しないことがある＝正準は固定環境)。
  let noteHtml = '';
  if (event.engineVer && event.engineVer !== APP_VERSION) {
    noteHtml += `<p class="official-verify-note warn">${escapeHtml(t('official.verify.engineDiff', { rec: event.engineVer, app: APP_VERSION }))}</p>`;
  }
  if (result && result.verifyHash) {
    noteHtml += (res.verifyHash === result.verifyHash)
      ? `<p class="official-verify-note ok">${escapeHtml(t('official.verify.match', { hash: res.verifyHash }))}</p>`
      : `<p class="official-verify-note warn">${escapeHtml(t('official.verify.diff', { local: res.verifyHash, official: result.verifyHash, ver: event.engineVer || '?' }))}</p>`;
  } else {
    noteHtml += `<p class="official-verify-note">${escapeHtml(t('official.verify.refOnly', { hash: res.verifyHash }))}</p>`;
  }
  if (note) note.innerHTML = noteHtml;
  // 結果ダイアログ (参考) を開く (イベントのコース・クラス注記つき)。
  const crashTxt = crashRule.rejoin ? t('race.crashRule.rejoin', { s: crashRule.penaltySec || 3 }) : t('race.crashRule.dnf');
  renderRaceResult(res, {
    laps, regime, crashTxt, course: rcourse, verifyHtml: noteHtml,
    replay: { kind: 'rerun', recVer: event.engineVer || '' },   // AK6: 公式記録の再実行=最新エンジン再走 (記録とは別物になり得る)
    eventInfo: {
      classLabel: t('event.class.' + (event.class || 'open')),
      budget: (event.class === 'budget' && event.budget) ? event.budget.total : null,
      fillerCount: field.filter((f) => f.filler).length,
    },
  });
}

// 現在のアクティブ車をこの大会にエントリー (PR)。車種 def を同梱 (独自車種も参加可・W_spec §1)。
function submitOfficialEntry() {
  if (!officialCurrent) return;
  const { event, result } = officialCurrent;
  if (raceStatus(event, !!result) !== 'open') { $('ofMsg').textContent = t('official.entry.closed'); return; }
  const name = ($('ofName').value || '').trim();
  const author = ($('ofAuthor').value || '').trim();
  const intro = ($('ofIntro') ? ($('ofIntro').value || '') : '').trim();   // 解説 (任意・締切後公開・W6)
  if (!name) { $('ofMsg').textContent = t('official.entry.needName'); return; }
  if (!author) { $('ofMsg').textContent = t('official.entry.needAuthor'); return; }
  const s = activeSlot(); if (!s) return;
  const entry = {
    name, author,
    program: { lang: s.lang, src: s.src },
    carType: s.carType,
    carDef: carDefForEntry(s.carType),
    submittedAt: new Date().toISOString(),
  };
  if (intro) entry.intro = intro;
  saveMe(author);                            // 自分の GitHub を記憶 (打破通知・ランキングのハイライト用・W6)
  window.open(shareEntryUrl(event.id, entry), '_blank');
  $('ofMsg').textContent = t('official.entry.opened');
}

// ============================================================================
//  エンゲージメント層 (Stage W / W6・W_spec §8)。検証済の公式記録を土台に「学んで伸びる」好循環:
//   ① 👻 ゴースト対戦 (記録の決定論リプレイをコース上に重ね差を体感)
//   ② 打破通知＋差 (起動時に自分の記録 vs 世界ベスト)
//   ③ 記録プログラム閲覧＋fork (締切後・原作者クレジットはソースに刻まれ fork に永続)
//   ④ 📖 ロジック・ショーケース (公開＝義務でなく栄誉・作者は intro で自ら発表)
//   ⑤ 🏅 クラス別ラダー＋ドライバープロフィール／称号
//  **検証済記録のみ反映** (race_ladder.isVerified・W_spec §5/§7＝偽記録に尊敬は集まらない)。
//  ゴーストは視覚参照ゆえローカル決定論で可・公式順位は固定環境の正準エンジンで判定 (W_spec §5.1)。
// ============================================================================
const ME_KEY = 'rumicar.author';
let officialData = [];          // 全公式レースの {event,entries,result} (集計・打破通知・vs world ghost 用)
let officialDataLoaded = false;
let ladder = null;              // race_ladder.aggregate の結果 {records,boards,drivers,verifiedCount}
let pendingRaceGhost = null;    // renderRaceResult が stash した直近レースの ghost+course (👻 再生用)
let ghostRaf = 0;               // ゴーストアニメの rAF id (UI のみ・物理非参加)
let ghostAnim = null;           // { g, rc, mview, colorOf, frame, playing, lastTs }
let ghostOnClose = null;        // AB10: 観戦リプレイを閉じたとき一度だけ呼ぶ後処理 (結果ダイアログ連結)

function loadMe() { try { return (localStorage.getItem(ME_KEY) || '').trim(); } catch (e) { return ''; } }
function saveMe(a) { try { localStorage.setItem(ME_KEY, String(a || '').trim()); } catch (e) {} }

// AS13: progKey 参照エントリー (docs/phase_w/official_sample_event.json 形式) の言語を実 PROGRAMS で解決。
// program.lang を持つ通常のエントリーはこの経路を通らない (race_ladder.langOfEntry が先に返す)。
const progLangOf = (key) => (PROGRAM_BY_KEY[key] || {}).lang || null;

// 全公式レースの詳細を取得 → race_ladder で集計 (起動時 + ランキング/再読込時)。未シードは [] のまま。
async function loadAllOfficialData(force) {
  if (officialDataLoaded && !force) return officialData;
  const list = officialRaces || [];
  // v5.2.0: 逐次 await を並列取得へ (1件失敗はスキップ=従来同値)。out は list 一覧順を維持
  // (aggregate 入力の順序決定性を保つ)。
  const fetchedRaces = await Promise.all(list.map(async (r) => {
    try { return await fetchRace(r.id); } catch (e) { return null; /* 1件失敗はスキップ */ }
  }));
  const out = fetchedRaces.filter((race) => race && race.event);
  officialData = out;
  ladder = aggregate(out, { progLang: progLangOf });
  officialDataLoaded = true;
  return officialData;
}

// 起動時の打破通知 (W_spec §8): 自分の公式記録 vs 世界ベスト。抜かれていれば通知1行＋差 (gap)。
function checkBeaten() {
  const me = loadMe();
  if (!me || !ladder) return;
  const beaten = beatenChecks(ladder.records, me);
  if (!beaten.length) return;
  const top = beaten.slice(0, 3);
  for (const b of top) {
    logLine(t('log.w6.beaten', { course: b.course, cls: t('event.class.' + b.cls), who: b.world.author, gap: (b.gapMs / 1000).toFixed(2) }));
  }
  if (beaten.length > top.length) logLine(t('log.w6.beatenMore', { n: beaten.length - top.length }));
}

// ---- ③ 記録プログラム閲覧＋fork (締切後・renderOfficialDetail から呼ぶ) ----
// 締切後のプログラム公開パネル (閲覧 + 🍴 fork・帰属つき)。クリックは $('ofDetail') の委譲で処理。
function officialProgPanels(entries) {
  const esc = escapeHtml;
  let h = '<div class="official-progs">';
  entries.forEach((e, i) => {
    const carLabel = entryCarLabel(e.carType, e.carDef);
    const src = (e.program && e.program.src) || e.src || '';
    h += `<div class="official-prog"><div class="official-prog-head">` +
      `<b>${esc(e.name || '')}</b> <span class="hint">by ${esc(e.author || '?')} · ${esc(carLabel)}</span> ` +
      `<button class="official-viewsrc" data-i="${i}">${esc(t('official.viewSrc'))}</button> ` +
      `<button class="official-fork" data-i="${i}" title="${esc(t('official.fork.title'))}">${esc(t('official.fork'))}</button></div>`;
    if (e.intro) h += `<p class="official-intro"><b>${esc(t('official.intro.h'))}:</b> ${esc(e.intro)}</p>`;
    h += `<pre class="official-prog-src" data-i="${i}" hidden>${esc(src)}</pre></div>`;
  });
  return h + '</div>';
}

function toggleProgSrc(i, btn) {
  const pre = $('ofDetail').querySelector(`.official-prog-src[data-i="${i}"]`);
  if (!pre) return;
  pre.hidden = !pre.hidden;
  btn.textContent = pre.hidden ? t('official.viewSrc') : t('official.hideSrc');
}

// 記録のプログラムを fork: 原作者クレジットをソース先頭に刻み、アクティブな車のエディタへ取り込む。
// クレジットはテキストに残るので共有 (shareProgram) しても帰属が永続する (W_spec §8)。
function forkOfficialEntry(i) {
  if (!officialCurrent) return;
  const e = officialCurrent.entries[i]; if (!e) return;
  const src = (e.program && e.program.src) || e.src || '';
  const lang = (e.program && e.program.lang) || e.lang || 'c';
  const who = e.author || e.name || '?';
  const evTitle = (officialCurrent.event && (officialCurrent.event.title || officialCurrent.event.id)) || '';
  const credit = '// ' + t('official.creditHead', { who, event: evTitle }) + '\n';
  setActiveProgram(credit + src, lang);
  logLine(t('official.forked', { who }));
  $('dlgOfficial').close();   // エディタ (車カード) が見えるよう公式ダイアログを閉じる
}

// ---- ⑤ 🏅 ランキング (クラス別ラダー＋ドライバープロフィール／称号・検証済記録のみ) ----
function openRankingsDlg() {
  exitEdit();
  $('rankYou').value = loadMe();
  $('rankMsg').textContent = '';
  const dlg = $('dlgRankings');
  if (!officialDataLoaded) {
    $('rankBody').innerHTML = `<p class="hint">${escapeHtml(t('rank.loading'))}</p>`;
    loadAllOfficialData().then(() => { if (dlg.open) renderRankings(); });
  } else {
    renderRankings();
  }
  applyI18n(dlg); dlg.showModal();
}

async function reloadRankings() {
  $('rankMsg').textContent = t('rank.loading');
  await loadOfficialRaces();          // 一覧を取り直し
  await loadAllOfficialData(true);    // 詳細を再取得して再集計
  $('rankMsg').textContent = '';
  renderRankings();
}

// AS13: 既定配点の表示ラベル (「10-8-6-5-4-3-2-1」)。規定を画面にも出して黙って配らない。
const POINTS_LABEL = POINTS_DEFAULT.join('-');
// AS13: プログラム言語の表示名。言語名は ja/en で同一なので i18n キーは持たせない (孤児を作らない)。
const LANG_LABEL = { c: 'C', py: 'Python', js: 'JavaScript' };
const langLabel = (l) => LANG_LABEL[String(l)] || String(l || '?').toUpperCase();

// 称号バッジの文言 (リテラル t() = i18n 孤児検査③にも引っかからない)。ラベルはアイコンを内包する。
function titleLabel(x) {
  if (x.key === 'rank.title.record') return t('rank.title.record', { n: x.n });
  if (x.key === 'rank.title.win') return t('rank.title.win', { n: x.n });
  return t('rank.title.podium', { n: x.n });
}

function renderRankings() {
  const esc = escapeHtml;
  const me = loadMe();
  const data = ladder || aggregate(officialData, { progLang: progLangOf });
  const { boards, drivers, verifiedCount } = data;
  if (!verifiedCount || !boards.length) { $('rankBody').innerHTML = `<p class="race-empty">${esc(t('rank.empty'))}</p>`; return; }
  let html = `<p class="hint rank-verifiednote">${esc(t('rank.verified'))} · ${esc(t('rank.intro'))}</p>`;
  // AK6: ボード上に当時のエンジン版で樹立された記録が混ざるとき、現行で完全再現しない可能性を1行で正直明示
  // (記録は除外せず条件付きで保持・尊重)。全記録が現行版なら出さない。
  if (data.records.some((r) => r.engineVer && r.engineVer !== APP_VERSION)) {
    html += `<p class="hint rank-archivednote">${esc(t('rank.archivedNote', { app: APP_VERSION }))}</p>`;
  }

  // 打破通知パネル (me があるとき・自己 vs 世界ベスト・差)
  if (me) {
    const beaten = beatenChecks(data.records, me);
    if (beaten.length) {
      html += `<h3>${esc(t('rank.beaten.h'))}</h3><ul class="rank-beaten">`;
      for (const b of beaten) {
        html += `<li>${esc(t('rank.beaten.row', { course: b.course, cls: t('event.class.' + b.cls), who: b.world.author, mine: fmtTime(b.mine.classifiedMs / 1000), gap: (b.gapMs / 1000).toFixed(2) }))}</li>`;
      }
      html += '</ul>';
    }
  }

  // ── AS13 ①: シーズン/チャンピオンシップ (シーズン × クラス別のポイント順位表) ──────────
  // 配点は規定 (race_season.POINTS_DEFAULT・event.points で上書き可)。順位は補充車を含む実走順位で
  // 引き、ポイントを得るのは実在の著者だけ。リタイアは 0 点だが出走には数える。
  const champs = championships(data.records, data.dnfs || []);
  if (champs.length) {
    html += `<h3>${esc(t('season.h'))}</h3>`;
    html += `<p class="hint">${esc(t('season.note', { pts: POINTS_LABEL }))}</p>`;
    for (const c of champs) {
      const title = c.season ? c.season : t('season.unnamed');
      html += `<div class="rank-board"><div class="rank-board-head">🏆 <b>${esc(title)}</b> — ${esc(t('event.class.' + c.cls))} ` +
        `<span class="hint">${esc(t('season.events', { n: c.events }))}</span></div>`;
      if (c.champion) {
        // キーは静的リテラルで渡す (t(cond ? 'a' : 'b') にすると i18n 孤児検査③ の走査から消える)。
        const cv = { who: c.champion.author, pts: c.champion.points };
        html += `<p class="season-champ">${esc(c.tie ? t('season.champion.tie', cv) : t('season.champion', cv))}</p>`;
      } else {
        html += `<p class="hint">${esc(t('season.champion.none'))}</p>`;
      }
      html += '<table class="race-tab"><thead><tr>' +
        [t('season.col.pos'), t('rank.col.author'), t('season.col.points'), t('rank.driver.wins'),
          t('rank.driver.podiums'), t('season.col.finishes'), t('season.col.dnfs'), t('season.col.starts')]
          .map((x) => `<th>${esc(x)}</th>`).join('') + '</tr></thead><tbody>';
      c.rows.forEach((r, i) => {
        const meMark = (r.author === me) ? ` <span class="rank-me">${esc(t('rank.me'))}</span>` : '';
        html += `<tr${i === 0 && r.points > 0 ? ' class="rank-record"' : ''}><td>${i + 1}</td>` +
          `<td>${esc(r.author)}${meMark}</td><td><b>${r.points}</b></td><td>${r.wins}</td><td>${r.podiums}</td>` +
          `<td>${r.finishes}</td><td>${r.dnfs}</td><td>${r.starts}</td></tr>`;
      });
      html += '</tbody></table></div>';
    }
  }

  // ── AS13 ②: 言語別ラダー (クラス×コース×言語)。言語は entries の program.lang から引く ──────
  const lb = langBoards(data.records);

  // クラス別ラダー (👑コースレコード・🥇🥈🥉・「あなた」ハイライト・👻 vs world)
  html += `<h3>${esc(t('rank.boards.h'))}</h3>`;
  for (const b of boards) {
    html += `<div class="rank-board"><div class="rank-board-head"><b>${esc(t('event.class.' + b.cls))}</b> — ${esc(b.course)} ` +
      `<button class="rank-vsworld" data-cls="${esc(b.cls)}" data-course="${esc(b.course)}" title="${esc(t('ghost.vsWorld.title'))}">${esc(t('ghost.vsWorld'))}</button></div>`;
    // 言語別のコースレコード帯 (同じコース・同じクラスの中で「その言語での最速」を並べる)
    const lrec = langRecordsAt(lb.boards, b.cls, b.course);
    if (lrec.length) {
      html += '<p class="rank-langstrip">' + lrec.map((x) =>
        `<span class="rank-langchip"><b>${esc(langLabel(x.lang))}</b> 👑 ${esc(x.rec.name)}` +
        `<span class="hint"> (${esc(x.rec.author || '—')}) ${fmtTime(x.rec.classifiedMs / 1000)} · n=${x.n}</span></span>`).join(' ') + '</p>';
    }
    html += '<table class="race-tab"><thead><tr>' +
      [t('race.col.rank'), t('race.col.name'), t('rank.col.author'), t('race.col.car'), t('race.col.time'), t('race.col.best'), t('rank.col.event')]
        .map((x) => `<th>${esc(x)}</th>`).join('') + '</tr></thead><tbody>';
    b.rows.forEach((r, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
      const crown = i === 0 ? ` <span class="rank-crown" title="${esc(t('rank.record'))}">👑</span>` : '';
      const meMark = (r.author && r.author === me) ? ` <span class="rank-me">${esc(t('rank.me'))}</span>` : '';
      html += `<tr${i === 0 ? ' class="rank-record"' : ''}><td>${medal}${crown}</td>` +
        `<td>${esc(r.name)}${meMark}</td><td>${esc(r.author || '—')}</td>` +
        `<td>${esc(carTypeLabel(r.carType))}</td><td>${fmtTime(r.classifiedMs / 1000)}</td>` +
        `<td>${r.bestLapMs != null ? fmtTime(r.bestLapMs / 1000) : '—'}</td><td class="hint">${esc(r.eventTitle)}</td></tr>`;
    });
    html += '</tbody></table></div>';
  }

  // ── AS13 ②: 言語別の集計 (どの言語がどれだけ走っているか)。言語不明は混ぜず件数で明示 ──────
  const lprof = langProfiles(data.records);
  if (lprof.length) {
    html += `<h3>${esc(t('lang.h'))}</h3>`;
    html += `<p class="hint">${esc(t('lang.note'))}</p>`;
    if (lb.unknown) html += `<p class="hint">${esc(t('lang.unknown', { n: lb.unknown }))}</p>`;
    html += '<table class="race-tab"><thead><tr>' +
      [t('lang.col.lang'), t('lang.col.records'), t('lang.col.authors'), t('rank.driver.wins'), t('lang.col.best')]
        .map((x) => `<th>${esc(x)}</th>`).join('') + '</tr></thead><tbody>';
    for (const p of lprof) {
      html += `<tr><td><b>${esc(langLabel(p.lang))}</b></td><td>${p.entries}</td><td>${p.authors}</td>` +
        `<td>${p.wins}</td><td>${p.bestMs != null ? fmtTime(p.bestMs / 1000) : '—'}</td></tr>`;
    }
    html += '</tbody></table>';
  }

  // ドライバープロフィール／称号
  html += `<h3>${esc(t('rank.drivers.h'))}</h3>`;
  html += '<table class="race-tab"><thead><tr>' +
    [t('rank.col.author'), t('rank.driver.records'), t('rank.driver.wins'), t('rank.driver.podiums'), t('rank.driver.events'), '🏷']
      .map((x) => `<th>${esc(x)}</th>`).join('') + '</tr></thead><tbody>';
  for (const d of drivers) {
    const meMark = (d.author === me) ? ` <span class="rank-me">${esc(t('rank.me'))}</span>` : '';
    const titles = d.titles.map((x) => `<span class="rank-badge">${esc(titleLabel(x))}</span>`).join(' ');
    html += `<tr${d.author === me ? ' class="rank-record"' : ''}><td>${esc(d.author)}${meMark}</td>` +
      `<td>${d.recordsHeld}</td><td>${d.wins}</td><td>${d.podiums}</td><td>${d.events}</td><td>${titles}</td></tr>`;
  }
  html += '</tbody></table>';
  $('rankBody').innerHTML = html;
}

// ---- ① 👻 ゴースト対戦 (決定論リプレイをコース上に重ねる・animateは UI のみ・物理非参加) ----
// 記録 (eventId) を持つ取得済みレースを引く。
function raceForEvent(eventId) {
  return officialData.find((r) => ((r.result && r.result.eventId) || (r.event && r.event.id)) === eventId) || null;
}
// 記録に対応するエントリー (program+carDef) を author / programRef で引く。
function entryForRecord(race, rec) {
  if (!race || !race.entries) return null;
  let e = rec.author ? race.entries.find((x) => (x.author || '') === rec.author) : null;
  if (!e && rec.programRef) {
    const base = String(rec.programRef).split('/').pop().replace(/\.json$/i, '');
    e = race.entries.find((x) => (x.author || '') === base);
  }
  return e || null;
}

// 👻 あなた vs 世界ベスト: アクティブ車と、このクラス×コースの世界ベスト記録を同じ時間軸で
// ゴースト対戦させ差を体感する (interact=false で衝突させず純粋に走りを並べる・ローカル参考)。
function ghostVsWorld(cls, course) {
  if (!ladder) return;
  const rec = worldBest(ladder.boards, cls, course);
  if (!rec) { logLine(t('ghost.none')); return; }
  const race = raceForEvent(rec.eventId);
  const wEntry = race ? entryForRecord(race, rec) : null;
  if (!race || !wEntry) { logLine(t('ghost.none')); return; }
  const rcourse = resolveRaceCourse(race.event.course);
  if (!rcourse) { logLine(t('official.verify.noCourse', { name: course })); return; }
  const s = activeSlot(); if (!s) return;
  const field = [
    { name: t('ghost.you'), lang: s.lang, src: s.src, carType: s.carType },
    { name: rec.name || rec.author, lang: (wEntry.program && wEntry.program.lang) || 'c',
      src: (wEntry.program && wEntry.program.src) || '', carType: wEntry.carType, carDef: wEntry.carDef },
  ];
  let res;
  try {
    res = runRace({ course: rcourse, regime: race.event.regime || null,
      laps: Math.max(1, Math.round(race.event.laps || 3)), field,
      crashRule: race.event.crashRule || { rejoin: false }, interact: false,
      maxSec: race.event.maxSec != null ? race.event.maxSec : 180,   // AB2: 記録の凍結 timeout で忠実再現
      ghost: true });
  } catch (e) { logLine(t('log.race.err', { e: (e && e.message) || e })); return; }
  $('dlgRankings').close();
  // AK6: 公式記録は frames を保存しないため、世界ベストのゴーストは現行エンジンでの再走 (rerun)。記録の
  // engineVer を添えて「収録フレーム再生ではない=別物になり得る」を正直に表示する。
  openGhostReplay({ ghost: res.ghost, course: rcourse, title: t('ghost.vsWorld'), replay: { kind: 'rerun', recVer: rec.engineVer || '' } });
}

// ===== AB11 (PX-004): 観戦リプレイの車間(gap)/オーバーテイク可視化 (DOM 層) =====
// 算出本体は ./ghost_gap.js の純関数 (ghostCumDist/ghostStandingsAt/ghostPasses)＝node↔browser 同一。
// すべてゴーストフレームからの「観測のみ」＝race_engine 非改変・verifyHash/traceHash 不変 (CI-5)。
const GHOST_FLASH_MS = 1700;   // オーバーテイク・ハイライトの表示時間 (ms)

// 順位差からオーバーテイクを検出 (純関数 ghostPasses)。上昇した車を flash し、奪った相手を notice に。
function ghostDetectOvertakes(a, st, now) {
  for (const p of ghostPasses(st, a.prevRank)) {
    a.flash[p.ci] = now;
    if (p.passed != null) a.notice = { txt: t('ghost.overtake', { a: a.g.names[p.ci], b: a.g.names[p.passed] }), at: now };
  }
}

// 順位/車間表 (#ghostStandings) とオーバーテイク告知 (#ghostFlash) を再描画。t() で言語追従。
function renderGhostStandings(a, st, now) {
  const esc = escapeHtml;
  const rowsHtml = st.rows.map((r) => {
    const passing = a.flash[r.ci] && (now - a.flash[r.ci]) < GHOST_FLASH_MS;
    const gapTxt = r.rank === 1 ? t('ghost.leader') : (r.gap != null ? '+' + r.gap.toFixed(1) + 's' : '');
    return `<tr class="ghost-st-row${passing ? ' passing' : ''}">`
      + `<td class="ghost-st-pos">P${r.rank}</td>`
      + `<td><span class="race-dot" style="background:${a.colorOf(r.ci)}"></span>${esc(a.g.names[r.ci])}`
        + `${passing ? ' <span class="ghost-st-up">▲</span>' : ''}</td>`
      + `<td class="ghost-st-lap">${esc(t('ghost.lap', { n: r.lap }))}</td>`
      + `<td class="ghost-st-gap">${esc(gapTxt)}</td></tr>`;
  }).join('');
  $('ghostStandings').innerHTML = `<table class="ghost-st-tab"><caption>${esc(t('ghost.standings'))}</caption>${rowsHtml}</table>`;
  const fl = $('ghostFlash');
  fl.textContent = (a.notice && (now - a.notice.at) < GHOST_FLASH_MS) ? '🔃 ' + a.notice.txt : '';
}

// ゴースト再生を開始 (dlgGhost)。data = { ghost, course, title }。
// AB10: onClose を渡すと dlgGhost を閉じたとき一度だけ呼ぶ (観戦リプレイ→結果ダイアログの連結用)。
//       軌跡が無い/再生不能のときは即 onClose (観戦をスキップして結果へ)。
function openGhostReplay(data, onClose) {
  ghostOnClose = onClose || null;
  if (!data || !data.ghost || !data.ghost.frames || !data.ghost.frames.length) {
    logLine(t('ghost.none'));
    const cb = ghostOnClose; ghostOnClose = null; if (cb) { try { cb(); } catch (e) {} }
    return;
  }
  stopGhost();
  const esc = escapeHtml;
  const rc = data.course, g = data.ghost;
  const maxW = 520, maxH = 300;
  const sc = Math.min(maxW / rc.bounds.w, maxH / rc.bounds.h);
  const mview = { hM: rc.bounds.h, pxPerM: sc, wPx: Math.round(rc.bounds.w * sc), hPx: Math.round(rc.bounds.h * sc) };
  const cv = $('ghostMap'); cv.width = mview.wPx; cv.height = mview.hPx;
  const colorOf = (i) => FLEET.colors[i % FLEET.colors.length];
  // AK6: 収録フレーム再生 (recorded=このレースで実際に走った軌跡=本物) と 最新エンジン再走 (rerun=記録とは
  // 別物になり得る) を正直に区別する (UI のみ・hash 非参加)。公式記録は frames を保存しないため、👻あなた vs
  // 世界ベスト等は現行エンジンでの再走 (rerun) になる。data.replay 未指定は recorded 扱い (このレースの ghost)。
  const rep = data.replay || { kind: 'recorded' };
  const repNote = rep.kind === 'rerun'
    ? `<p class="ghost-replaynote warn">${esc(t('ghost.replay.rerun', { app: APP_VERSION, rec: rep.recVer || '?' }))}</p>`
    : `<p class="ghost-replaynote">${esc(t('ghost.replay.recorded'))}</p>`;
  $('ghostMeta').innerHTML = `<table class="race-metatab"><tr><th>${esc(t('race.meta.course'))}</th><td>${esc(courseDisplayName(rc))}</td></tr></table>` + repNote;
  $('ghostLegend').innerHTML = g.names.map((nm, i) =>
    `<span class="ghost-leg"><span class="race-dot" style="background:${colorOf(i)}"></span>${esc(nm)} <span class="hint">${esc(carTypeLabel(g.carTypes[i]))}</span></span>`).join('');
  // AB11: 順位/車間/オーバーテイク用の状態 (累積距離を前計算・観測のみ＝hash 不変)。
  ghostAnim = { g, rc, mview, colorOf, frame: 0, playing: true, lastTs: null,
    model: ghostProgressModel(g.frames, g.names.length, rc.bounds.w, rc.bounds.h),
    prevRank: null, prevFi: -1, flash: [], notice: null, lastStandFi: -1,
    // AB12: 効果音用の遷移検出状態 (観測のみ＝hash 不変)。周回(先頭)・クラッシュ(各車)・ゴール(再生終端)。
    _sfxFi: -1, _sfxMaxLap: 0, _sfxCrashed: [], _sfxEnded: false };
  $('ghostFlash').textContent = ''; $('ghostStandings').innerHTML = '';
  renderGhostSectors(g, rc);        // AS13: 区間別 並走比較 (事後解析・1 回だけ)
  $('ghostPlay').textContent = t('ghost.pause');
  const dlg = $('dlgGhost'); applyI18n(dlg); dlg.showModal();
  drawGhostFrame();   // カウントダウン中の静止初期フレームを描いておく
  // AB9: 観戦再生も発走演出 (3-2-1-GO) を重ねてから再生開始 (UI のみ)。
  playCountdown(dlg, () => { if (ghostAnim) { ghostAnim.lastTs = null; ghostRaf = requestAnimationFrame(ghostStep); } });
}

// ── AS13 ④: テレメトリ区間別 並走比較 (W_spec §8 バックログ) ─────────────────────────
// 再生開始時に一度だけ算出する事後解析 (フレーム毎に変わらないため rAF ループに載せない=描画コスト0)。
// 算出本体は ./sector.js の純関数＝node ゲートと同一コード。ゴーストからの「観測のみ」ゆえ
// race_engine 非改変・verifyHash/traceHash 不変 (ghost_gap.js と同じ契約)。
function renderGhostSectors(g, rc) {
  const el = $('ghostSectors'); if (!el) return;
  const esc = escapeHtml;
  el.innerHTML = '';
  const an = sectorAnalysis(g, rc.bounds, SECTORS_DEFAULT);
  if (!an.lapsCounted) {
    // 1 周も完了していない (全車リタイア・峠で未到達など)。区間は「周を等分する」ものなので出せない。
    el.innerHTML = `<h3>${esc(t('sect.h'))}</h3><p class="hint">${esc(t('sect.none'))}</p>`;
    return;
  }
  const K = an.k;
  const secName = (j) => 'S' + (j + 1);
  const fmtSec = (v) => (v == null ? '—' : v.toFixed(2) + 's');
  let h = `<h3>${esc(t('sect.h'))}</h3>`;
  h += `<p class="hint">${esc(t('sect.note', { k: K }))}</p>`;
  h += `<p class="hint">${esc(t('sect.quant', { ms: Math.round(an.dt * 1000) }))}</p>`;
  h += '<table class="race-tab sect-tab"><thead><tr>' +
    [t('sect.col.car'), ...Array.from({ length: K }, (_, j) => secName(j)), t('sect.col.best'), t('sect.col.laps')]
      .map((x) => `<th>${esc(x)}</th>`).join('') + '</tr></thead><tbody>';
  for (const c of an.cars) {
    h += `<tr><td><span class="race-dot" style="background:${FLEET.colors[c.ci % FLEET.colors.length]}"></span>${esc(c.name)}</td>`;
    for (let j = 0; j < K; j++) {
      const v = c.bestSectors[j];
      const isBest = (an.holderOf[j] === c.ci && v != null);
      h += `<td class="${isBest ? 'sect-best' : ''}">${esc(fmtSec(v))}${isBest ? ' ●' : ''}</td>`;
    }
    h += `<td>${esc(fmtSec(c.bestLapSec))}</td><td class="hint">${c.laps.length}</td></tr>`;
  }
  // 理論ベスト = 各区間の全車最速の和。定義上 実ベストラップ以下で、その差が「1 周で取りこぼした合計」。
  if (an.theoreticalBestSec != null) {
    h += `<tr class="sect-theo"><td><b>${esc(t('sect.theoretical'))}</b></td>`;
    for (let j = 0; j < K; j++) {
      const who = an.holderOf[j] != null ? an.cars.find((c) => c.ci === an.holderOf[j]) : null;
      h += `<td><b>${esc(fmtSec(an.bestOf[j]))}</b><br><span class="hint">${esc(who ? who.name : '—')}</span></td>`;
    }
    h += `<td><b>${esc(fmtSec(an.theoreticalBestSec))}</b></td><td class="hint">—</td></tr>`;
  }
  h += '</tbody></table>';
  if (an.gainSec != null) h += `<p class="hint">${esc(t('sect.gain', { s: an.gainSec.toFixed(2) }))}</p>`;
  el.innerHTML = h;
}

function stopGhost() { if (ghostRaf) { cancelAnimationFrame(ghostRaf); ghostRaf = 0; } ghostAnim = null; }

function ghostStep(ts) {
  const a = ghostAnim; if (!a) return;
  if (a.lastTs == null) a.lastTs = ts;
  const dtReal = Math.min(0.1, (ts - a.lastTs) / 1000); a.lastTs = ts;  // タブ復帰の巨大 dt を抑制
  if (a.playing) a.frame += dtReal / a.g.dt;
  const last = a.g.frames.length - 1;
  if (a.frame >= last) {
    a.frame = last;
    if (a.playing) { a.playing = false; $('ghostPlay').textContent = t('ghost.play'); }
    if (!a._sfxEnded) { a._sfxEnded = true; SFX.play('goal'); }   // AB12: 観戦再生の終端=ゴール
  }
  drawGhostFrame();
  ghostRaf = requestAnimationFrame(ghostStep);
}

function drawGhostFrame() {
  const a = ghostAnim; if (!a) return;
  const ctx = $('ghostMap').getContext('2d');
  drawCourse(ctx, a.rc, a.mview, { grid: false });
  const fi = Math.max(0, Math.min(a.g.frames.length - 1, Math.floor(a.frame)));
  const now = a.lastTs || 0;   // flash 計時用 (再生中の rAF タイムスタンプ)
  // AB12: 整数フレーム前進時のみ効果音遷移を判定 (rAF 毎の再発火を防ぐ・観測のみ＝hash 不変)。
  if (fi !== a._sfxFi) {
    let mx = 0;
    for (let ci = 0; ci < a.g.names.length; ci++) {
      const p = a.g.frames[fi][ci]; if (!p) continue;
      const cr = !!p.crashed;
      if (cr && !a._sfxCrashed[ci]) SFX.play('crash');   // クラッシュ遷移 (各車)
      a._sfxCrashed[ci] = cr;
      if ((p.laps | 0) > mx) mx = p.laps | 0;
    }
    if (a.playing && mx > a._sfxMaxLap) SFX.play('lap');  // 先頭の周回計上
    if (mx > a._sfxMaxLap) a._sfxMaxLap = mx;
    a._sfxFi = fi;
  }
  // AB11: 順位/車間を算出し、整数フレーム前進時にオーバーテイクを検出 (グリッド直後の揺れは抑制)。
  const st = a.model ? ghostStandingsAt(a.model, a.g.frames, fi, a.g.dt) : null;
  const rankOf = [];
  if (st) {
    st.rows.forEach((r) => { rankOf[r.ci] = r.rank; });
    if (a.prevRank == null) { a.prevRank = rankOf.slice(); a.prevFi = fi; }
    else if (fi !== a.prevFi) {
      if (fi * a.g.dt > 0.8) ghostDetectOvertakes(a, st, now);
      a.prevRank = rankOf.slice(); a.prevFi = fi;
    }
  }
  const ncar = a.g.names.length, TRAIL = 18;
  for (let ci = 0; ci < ncar; ci++) {
    // 軌跡 (直近 TRAIL サンプル)
    ctx.beginPath(); let started = false;
    for (let k = Math.max(0, fi - TRAIL); k <= fi; k++) {
      const p = a.g.frames[k][ci]; if (!p) continue;
      const sp = worldToScreen({ x: p.x, y: p.y }, a.mview);
      if (!started) { ctx.moveTo(sp.x, sp.y); started = true; } else ctx.lineTo(sp.x, sp.y);
    }
    ctx.strokeStyle = a.colorOf(ci); ctx.lineWidth = 2; ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
    // 頭 ● (クラッシュ中は赤縁)
    const ph = a.g.frames[fi][ci]; const sh = worldToScreen({ x: ph.x, y: ph.y }, a.mview);
    // AB11: オーバーテイク直後の車に金色のグロー環＋▲ を重ねる (接近戦の可視化)。
    const passing = a.flash[ci] && (now - a.flash[ci]) < GHOST_FLASH_MS;
    if (passing) {
      ctx.beginPath(); ctx.arc(sh.x, sh.y, 9, 0, Math.PI * 2);
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#f5b301'; ctx.stroke();
      ctx.font = 'bold 11px system-ui, sans-serif'; ctx.fillStyle = '#f5b301';
      ctx.fillText('▲', sh.x - 4, sh.y - 9);
    }
    ctx.beginPath(); ctx.arc(sh.x, sh.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = a.colorOf(ci); ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = ph.crashed ? '#e33' : 'rgba(0,0,0,0.65)'; ctx.stroke();
    // AB11: 順位ラベル P{rank}＋周回 (先頭/車間が一目で分かる)。順位なしは周回のみ。
    ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = a.colorOf(ci);
    const lbl = (rankOf[ci] ? 'P' + rankOf[ci] + ' ' : '') + t('ghost.lap', { n: ph.laps || 0 });
    ctx.fillText(lbl, sh.x + 7, sh.y - 6);
  }
  // AB11: 順位/車間表は整数フレーム変化時 or flash 表示中のみ再描画 (~12fps・言語追従)。
  if (st) {
    const flashActive = a.flash.some((ts2) => ts2 && (now - ts2) < GHOST_FLASH_MS)
      || (a.notice && (now - a.notice.at) < GHOST_FLASH_MS);
    if (fi !== a.lastStandFi || flashActive) { renderGhostStandings(a, st, now); a.lastStandFi = fi; }
  }
  $('ghostClock').textContent = t('ghost.clock', { s: (fi * a.g.dt).toFixed(1) });
}

// AB11: 先頭へ巻き戻すとき順位ベースライン/flash を初期化 (端→先頭の差で誤検出しないため)。
// AB12: 効果音の遷移状態も初期化し、最初から再生で発走以外の SE が再び鳴るようにする。
function ghostResetOrder(a) {
  a.prevRank = null; a.prevFi = -1; a.flash = []; a.notice = null; a.lastStandFi = -1;
  a._sfxFi = -1; a._sfxMaxLap = 0; a._sfxCrashed = []; a._sfxEnded = false;
}

export function initRaceUI(deps) {
  ({ $, escapeHtml, logLine, activeSlot, exitEdit, courseDisplayName, carTypeLabel, entryCarLabel, setActiveProgram, playCountdown, resolveRaceCourse } = deps);
  $('raceGhost').addEventListener('click', () => { if (pendingRaceGhost) openGhostReplay(pendingRaceGhost); });
  $('ghostPlay').addEventListener('click', () => {
    if (!ghostAnim) return;
    if (ghostAnim.frame >= ghostAnim.g.frames.length - 1) { ghostAnim.frame = 0; ghostResetOrder(ghostAnim); }  // 終了後の再生は最初から
    ghostAnim.playing = !ghostAnim.playing;
    $('ghostPlay').textContent = ghostAnim.playing ? t('ghost.pause') : t('ghost.play');
  });
  $('ghostRestart').addEventListener('click', () => {
    if (!ghostAnim) return; ghostAnim.frame = 0; ghostResetOrder(ghostAnim);
    ghostAnim.playing = true; $('ghostPlay').textContent = t('ghost.pause');
  });
  $('dlgGhost').addEventListener('close', () => {
    stopGhost();
    // AB10: 観戦リプレイを閉じたら一度だけ後処理 (自動観戦時の結果ダイアログ表示など)。
    const cb = ghostOnClose; ghostOnClose = null; if (cb) { try { cb(); } catch (e) {} }
  });
  return { renderRaceResult, loadOfficialRaces, loadAllOfficialData, checkBeaten, openOfficialDlg, reloadOfficial, selectOfficialRace, submitOfficialEntry, toggleProgSrc, forkOfficialEntry, openRankingsDlg, reloadRankings, renderRankings, saveMe, ghostVsWorld, openGhostReplay, stopGhost, drawRaceMap };
}
