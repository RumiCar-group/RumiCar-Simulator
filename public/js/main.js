// 統合: シミュレーションループ・UI 結線・手動操作・プログラム取込・
//       ラップ計測 / コースエディタ / デバッグ機能 (Phase 2) +
//       複数台同時走行 (各車に個別プログラムを割当, Phase 3)。
import { CONST, VIEW, SIM, FLEET, TRAIL, CAR, CAR_TYPES, CAR_TYPE_BY_KEY, CAR_TYPE_DEFAULT, setCarScale, CAR_PARAM_DOC, registerCarType, unregisterCarType, APP_VERSION, displayKmh, setPhysicsMode, PHYSICS, SENSOR_NOISE, SENSOR_HOLD, SENSOR_OPTICS, A11Y, CVD, REGIMES, REGIME_STATE, GRID } from './config.js';
// CHANGELOG は表示専用の 124KB のデータ塊なので critical path から外し (Stage AS2)、
// 版ポップアップを組むときにだけ動的 import する (下の loadChangelog)。
import { PROGRAMS, PROGRAM_BY_CARTYPE, PROGRAM_BY_KEY, programKeyForCode } from './programs.js';
import {
  drawCourse, screenToWorld, worldToScreen,
  PRESETS, presetByName, normalizeCourse, loadPresets,
} from './course.js';
import { carEdges } from './physics.js';
import { applyRegime } from './physics_dyn.js';
import { readAll, readRear } from './sensors.js';
import { buildApi } from './api.js';
import { buildController } from './runner.js';
import {
  makeSlot, rebuildSpawns, integrateSlot, integrateFleetV2, tickSlot, othersFor, releaseDrive, swapPhysics, fitsAllCars, minClearance, applyStartGate,
  normTire, normGear, normSusp, normSteer, normBrake,   // AS9/AS11/AS12/AV2: 装備値の正規化 (白リスト外は既定へ) — UI/共有 URL/レース field で単一実装
  // (driveableCapN は capacity.js から別 import)
} from './fleet.js';
import { driveableCapN } from './capacity.js';   // Stage AK7: 実態容量 (実走で「走り出せる最大台数」)
import { runRace, engineFingerprint, computeRaceTimeout } from './race_engine.js';
import { ghostProgressModel, ghostStandingsAt, ghostPasses } from './ghost_gap.js';
import { costOf, validateEntry, formField, frozenField, FILLER_POOL } from './race_event.js';
import { aggregate, worldBest, beatenChecks } from './race_ladder.js';
import { challengeState } from './challenge.js';   // AS13: 練習記録から難度別チャレンジ進捗/バッジ (純関数)
import {
  fetchFromGithub, readFile, listRepoDir, fetchRawFile,
  listCommunityCourses, fetchCommunityCourse, courseSubmission,
  listCommunityPrograms, programSubmission, uploadPageUrl,
  listCommunityCars, fetchCommunityCar,
  listOfficialRaces, fetchRace, shareEventUrl,
} from './loader.js';
import { SAMPLES } from './samples.js';
import { makeBackupEnvelope, parseBackup, previewImport, applyImport } from './data_backup.js';
import { encodeState, decodeState, hasShareState } from './share.js';
import { t, applyI18n, getLang, setLang, setOnLangChange, warnMissing, hasKey } from './i18n.js';
import * as SFX from './sfx.js';

// 車種の表示名 (言語追従)。既定車種は i18n カタログ car.<key>、カスタム登録車種は
// カタログに無いので登録時の name をそのまま表示する (拡張性を壊さない)。
// GitHub 投稿車種 (community・V4) は出所が分かるよう「🌐 」を前置する (fleet セレクタ/車種表で共通)。
const carTypeName = (ct) => {
  const base = hasKey('car.' + ct.key) ? t('car.' + ct.key) : ct.name;
  return ct.community ? '🌐 ' + base : base;
};
import { drawTrail, drawReferenceLine, drawSensors, drawCar, drawMeters, drawFleetHud, updatePanel, drawTireHud } from './hud.js';
import { drawDepthView } from './depth.js';
import { drawTougeElevation } from './elev3d.js';
import { fmtTime, loadBestRec } from './lap.js';
import {
  CourseEditor, loadSavedCourses, saveCourse, deleteCourse,
} from './course_editor.js';
import { safeSetItem, setStoreFailHandler } from './storage.js'; // AP4: data 系保存失敗の可視化
import { course, setCourse } from './state.js';
import { initRaceUI } from './race_ui.js';
import { initCarCrud } from './car_crud.js';

const $ = (id) => document.getElementById(id);

// ---- コース ----

// ---- 車両スロット (各車が独自のプログラム・物理・ラップを持つ) ----
let slots = [];
let activeIdx = 0;
const activeSlot = () => slots[activeIdx];
// Stage AK (GitHub #26 D6/D7): このコース×領域×スケールで「実際に走り出せる最大台数」(実 fitsAllCars 判定)。
// enforceFitRatio が更新し、車両追加ガード (carCap) と台数自動調整 (台数告知) が参照する。既定=maxCars。
let courseCapN = FLEET.maxCars;
const carCap = () => Math.min(FLEET.maxCars, courseCapN);   // 車両追加の実上限 (外形代理でなく実態容量)

// ---- 設定共有パーマリンク (Stage AF / AF2) ----
// 起動時に location.hash から復元した状態 (decodeState の結果, または null)。
let shareState = null;
// hash 書き戻しゲート: 起動時の復元が完全に終わるまで replaceState を抑止する
// (復元の途中で部分状態が hash を上書きしないように)。bootstrap の最後で true。
let shareReady = false;

// 各車の Serial 出力は車両ごとのバッファ slot.serial に貯める (列の cc-serial に毎フレーム反映)。
function makeCarLog(slot) {
  return (msg, nl = true) => {
    const pre = (opts.timestamp && nl) ? `[${fmtTime(slot.lap ? slot.lap.totalTime : 0)}] ` : '';
    slot.serial += pre + msg + (nl ? '\n' : ' ');
    if (slot.serial.length > 8000) slot.serial = slot.serial.slice(-6000);
  };
}

const newSlot = (i, lang, src) =>
  makeSlot({ i, lang, src, course, slotCount: slots.length, logFor: makeCarLog });

// ---- Canvas ----
const canvas = $('course');
const ctx = canvas.getContext('2d');
const view = { hM: 0, wPx: 0, hPx: 0 };

// ---- ビューポート変換 (P2: ホイール拡大縮小 + ドラッグ移動)。描画と入力にのみ作用し、物理/判定/ラップは不変。
//      基準スクリーン座標 (worldToScreen の fit 済み内部キャンバス px) に zoom/pan を後段で重ねる。
//      既定 zoom=1 / pan=0 は恒等変換 = 従来描画と完全一致 (回帰)。
const VT = { min: 1, max: 8 };               // 表示倍率の下限/上限 (1.0〜8.0倍)
const vt = { zoom: 1, panX: 0, panY: 0 };    // panX/panY は内部キャンバス px
function clampPan() {
  // 拡大時もコースがキャンバスを覆い続けるよう pan をクランプ (空背景の隙間を作らない)。
  // zoom=1 では下限=0 となり pan は 0 に固定される (全体が収まるため移動不要)。
  const loX = Math.min(0, canvas.width * (1 - vt.zoom));
  const loY = Math.min(0, canvas.height * (1 - vt.zoom));
  vt.panX = Math.max(loX, Math.min(0, vt.panX));
  vt.panY = Math.max(loY, Math.min(0, vt.panY));
}
function updateViewBadge() {
  const b = $('viewZoom'); if (b) b.textContent = vt.zoom.toFixed(1) + '×';
  const r = $('viewReset'); if (r) r.disabled = (vt.zoom === 1 && vt.panX === 0 && vt.panY === 0);
  const zi = $('viewIn'); if (zi) zi.disabled = (vt.zoom >= VT.max - 1e-6);
  const zo = $('viewOut'); if (zo) zo.disabled = (vt.zoom <= VT.min + 1e-6);
}
// ボタンによる段階ズーム (キャンバス中心を固定して拡大/縮小)。1 クリック ≒ 1.3 倍。
function zoomStep(dir) { zoomAt(canvas.width / 2, canvas.height / 2, vt.zoom * (dir > 0 ? 1.3 : 1 / 1.3)); }
function resetView() { vt.zoom = 1; vt.panX = 0; vt.panY = 0; updateViewBadge(); }
// カーソル位置 (内部キャンバス px) の world 点を固定したまま倍率を newZoom へ。
function zoomAt(cx, cy, newZoom) {
  newZoom = Math.max(VT.min, Math.min(VT.max, newZoom));
  if (newZoom === vt.zoom) return;
  const bx = (cx - vt.panX) / vt.zoom, by = (cy - vt.panY) / vt.zoom; // 基準px (zoom/pan を剥がす)
  vt.zoom = newZoom;
  vt.panX = cx - bx * vt.zoom;
  vt.panY = cy - by * vt.zoom;
  clampPan(); updateViewBadge();
}
// 2026-08-02 利用者指摘「右側に余裕があるのに窓内だけで拡大される」への対応 (RC-UX-004)。
// 従来は基準 pxPerM=280 固定 (大コースのみ maxCanvasPx で縮小)だったため、.stage が .side より
// 広い画面では余白ができていた。ここでは「.stage の実際の表示幅・表示可能高さいっぱいに収める
// pxPerM」を都度計算し、基準 280 を下回らない (=退行しない・モバイル等の狭い画面では 280 のまま
// CSS 側の max-width:100% が従来どおり縮小を担う) 範囲で、余裕があれば自動的に拡大する。
// 巨大コースの保護 (maxCanvasPx) は従来どおり維持。物理・判定には一切関与しない (描画のみ)。
function fitPxPerM(c) {
  const stageEl = canvas.parentElement; // <section class="stage">
  const padPx = 24; // .stage の左右 padding 12px×2
  const availW = Math.max(200, (stageEl?.clientWidth || 0) - padPx);
  const availH = Math.max(200, Math.min(window.innerHeight * 0.68, 1400));
  const wantPxPerM = Math.min(availW / c.bounds.w, availH / c.bounds.h);
  return Math.min(
    VIEW.maxCanvasPx / Math.max(c.bounds.w, c.bounds.h),  // 巨大コースの保護 (従来どおり)
    Math.max(VIEW.pxPerM, wantPxPerM),                     // 基準 280 を下限に、余裕があれば拡大
  );
}
function setView(c) {
  view.hM = c.bounds.h;
  const fit = fitPxPerM(c);
  view.pxPerM = fit;   // worldToScreen / screenToWorld はこの view.pxPerM を参照する
  view.wPx = c.bounds.w * fit;
  view.hPx = c.bounds.h * fit;
  canvas.width = view.wPx; canvas.height = view.hPx;
  resetView();   // コース変更/キャンバスリサイズ時は表示を全体 (等倍) に戻す
}
setView(course);
// ウィンドウ幅変更 (リサイズ・スマホ回転) に追従して再フィット (デバウンス)。
let _resizeT = null;
window.addEventListener('resize', () => {
  clearTimeout(_resizeT);
  _resizeT = setTimeout(() => { if (!editing) setView(course); }, 200);
});

// ---- 実行状態 ----
let running = false;      // 全車の走行状態 (ユーザーの開始/停止)
let paused = false;
let stepRequest = false;
let speed = 3;   // 再生速度の初期値 (×)。スライダー既定と一致させる。
let interact = true;      // 他車を障害物として扱うか (検知 + 重なり防止)。既定 ON
let rearOn = false;       // 後方センサー(任意装備)を有効にするか。既定 OFF=前方3つのみ(実機 faithful)
let encoderOn = false;    // 車輪エンコーダ(任意装備)を有効にするか。既定 OFF。競技 TC/ABS で使う
let tireSet = 'normal';   // v2 タイヤセット (normal|slip|rain)。既定 normal。slip=疑似ドリフト環境 (AO6)・rain=ウェット向き (AS9)。v2 のみ物理反映
let gearSet = 'direct';   // v2 ギア比 (direct|short|tall|auto2・Stage AS9 任意装備)。既定 direct=直結=byte 不変。v2 のみ物理反映
let suspSet = 'quasi';    // v2 サス自由度 (quasi|soft|balanced|stiff・Stage AS11 任意装備)。既定 quasi=自由度なし=byte 不変。v2 のみ物理反映
let steerSet = 'tri';     // 操舵サーボ (tri|prop・Stage AS12 任意装備)。既定 tri=実機準拠の3値=byte 不変。**3エンジン共通**で物理反映
let brakeSet = 'motor';   // 制動装置 (motor|friction|frictionFront|frictionRear・Stage AV2 任意装備)。既定 motor=駆動軸のみ=byte 不変。v2 のみ物理反映
let wearOn = false;       // タイヤ熱・摩耗モデル (Stage AO12・v2 専用 opt-in)。既定 OFF=byte 不変。ドリフトは後輪を消耗=戦略資源
const keys = {};
const opts = { rays: true, labels: false, grid: false, timestamp: false, depth: true };
let recover = false;   // 衝突したら自動で後退・切り返し復帰するか (#optRecover トグル)
const depthCanvas = $('depth');
const depthCtx = depthCanvas.getContext('2d');
let perCarSensors = []; // 各車の最新センサー値 (render で更新, 測距表示に使用)
let perCarRear = [];    // 各車の後方センサー値 (rearOn 時のみ)

// ---- 編集状態 ----
let editing = false;
let editor = null;
let courseSources = {};
let _loaderHidden = false;   // 起動ローダー(案C)を初回コース描画で一度だけ隠すフラグ

// ---- HUD refs ----
const refs = { sL: $('sL'), sC: $('sC'), sR: $('sR'), sB: $('sB'), sRange: $('sRange'), pos: $('pos'), spd: $('spd'), state: $('state') };

// ---- ログ ----
function appendLog(s) {
  const el = $('log');
  el.textContent += s;
  if (el.textContent.length > 8000) el.textContent = el.textContent.slice(-6000);
  el.scrollTop = el.scrollHeight;
}
function clearLog() { $('log').textContent = ''; }
// システムメッセージ (車両に属さないログ)。
function logLine(msg, nl = true) {
  const a = activeSlot();
  const pre = (opts.timestamp && nl) ? `[${fmtTime(a && a.lap ? a.lap.totalTime : 0)}] ` : '';
  appendLog((nl ? pre : '') + msg + (nl ? '\n' : ' '));
}

// ---- 投稿導線 (AZ1): GitHub へコース/プログラムを投稿する共通処理 ----
// loader.js の courseSubmission/programSubmission が組んだ投稿物を、
//   ① ファイルとして書き出し
//   ② 投稿先ディレクトリのアップロード画面を新しいタブで開く
// の順に処理する。**URL に投稿物を載せない** (載せると github.com の受理上限
// 約 6,600 文字を実データが 12〜38 倍超過して「押しても開かない」= AZ1 の欠陥 1)。
//
// ①を先に・独立して行うのは、②が塞がれても投稿物を残せるようにするため。ただし
// **「必ず手元に残る」とは言えない**: `a.click()` はダウンロードが拒否されても例外を投げず、
// JS には完了を確かめる API が無い (Chrome の「自動ダウンロードを許可しない」設定・企業ポリシー・
// 拡張で普通に起きる。CDP で deny にして実測済み)。ゆえに `started` は「開始した」までしか
// 意味せず、利用者向けの文言もそこまでしか言わない。**測っていないことを言わない。**
//
// window.open に 'noopener' を渡さないのは、渡すと**成功時も null が返る**仕様のため
// (阻止されたのか成功したのか区別できなくなる)。代わりに戻り値で判定し、
// 新しいタブがまだ about:blank のうちに opener を切る。
// これは `noopener` と同一ではない (browsing context group は分かれない) が、
// **tabnabbing に対する保護は同等**。実 github.com ページ上で window.opener === null を実測済み。
function submitToGithub({ dir, filename, text, mime }) {
  let started = false;
  try {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    started = true;
  } catch (e) {
    logLine(t('log.submit.saveFail', { file: filename, e: e.message }));
  }
  let url = null, opened = false;
  try {
    url = uploadPageUrl(dir);
    const w = window.open(url, '_blank');
    // 阻止されると null。ブロッカーによっては「即座に閉じた窓」を返すので closed も見る。
    if (w && !w.closed) { opened = true; try { w.opener = null; } catch (e) { /* 既に遷移済み */ } }
  } catch (e) {
    logLine(t('log.submit.openFail', { e: e.message }));
  }
  if (url && !opened) logLine(t('log.submit.popupBlocked', { url }));
  return { started, opened, filename, url };
}

// ---- コース読込 ----
function loadCourse(c) {
  setCourse(c);
  setView(c);
  rebuildSpawns(slots, course);
  running = false; paused = false;
  for (const s of slots) s.controller = null;
}

// コース適用 + 説明表示 + ログ (選択時/起動時の共通処理)
function applyCourse(c) {
  loadCourse(c);
  const dEl = $('courseDesc');
  if (dEl) dEl.textContent = courseDisplayDesc(c);
  renderCourseBadge(c);   // 難易度/推奨領域バッジ (AB5・PX-021)
  if (c.desc) logLine(`▶ ${courseDisplayName(c)}: ${courseDisplayDesc(c)}`);
  // このコースの想定スケール (卓上=実機相当/フルスケール=実車相当) を1行で示す (Stage Y/Y2・Issue #20)。
  // noRace=フルスケール設計コース (競技サーキット/グラウンド)・それ以外は卓上 (模型サイズ) 想定。
  logLine(c.noRace === true ? t('course.scaleHint.real') : t('course.scaleHint.model'));
  // 峠(高低差あり)コースは立体プレビューと高低差バッジを表示
  const elevC = $('elev3d'), badge = $('elevBadge');
  if (c.touge && c.elev) {
    if (elevC) { elevC.hidden = false; drawTougeElevation(elevC, c); }
    if (badge) { badge.hidden = false; badge.textContent = t('course.elevBadge', { m: c.elev }); }
  } else {
    if (elevC) elevC.hidden = true;
    if (badge) badge.hidden = true;
  }
  syncButtons();
}

// ---- 制御 ----
function resetWorld() {
  rebuildSpawns(slots, course);
  for (const s of slots) { s.world._pendingDelay = 0; s.hostEnv = buildApi(s.world); }
}

function startAuto() {
  exitEdit();
  stopAuto();
  enforceFitRatio('race');   // Stage AK7: 発走直前に実態容量へ確定 (carScale ドラッグで静的のままだった場合の安全網=楽め込み台数で走り出さない)
  rebuildSpawns(slots, course);
  clearLog();
  let ok = 0;
  for (const slot of slots) {
    slot.car.reset(slot.spawn);
    slot.serial = '';
    slot.world._pendingDelay = 0; slot.world._others = [];
    slot.hostEnv = buildApi(slot.world);
    slot.lap.reset(course, { carType: slot.carType, tire: slot.world.tire, wear: slot.world.wear, gear: slot.world.gear });   // 練習記録(非公式)はコース×車種別 (W2)・装備を記録へ刻む (AP2/AS9)
    try {
      slot.controller = buildController(slot.src, slot.lang, slot.hostEnv);
      slot.controller.setup();
      slot.running = true; slot.loopTimer = 0; ok++;
    } catch (e) {
      slot.world.log(t('log.err.setup', { e: (e.message || e) }));
      slot.controller = null; slot.running = false;
    }
  }
  if (ok === 0) { running = false; syncButtons(); return; }
  running = true; paused = false;
  setRunView(true); // 走行中は各列を実行行ハイライト表示に切替
  logLine(t('log.runStart', { n: ok }) + (interact ? t('log.runStart.detect') : t('log.runStart.pass')));
  logLine(t('log.runStart.practice'));   // ソロ走行=練習(非公式)。記録はコース×車種別にローカル保存 (W2)
  logLine(t('log.runStart.raceHint'));   // 自動走行=無限。終わる競争は 🏁 レースへ (PX-001/AB8)
  syncButtons();
}

function stopAuto() {
  running = false; paused = false;
  releaseDrive(slots);
  setRunView(false); // 編集可能なテキストエリアへ戻す
  syncButtons();
}

function resetAll() { stopAuto(); resetWorld(); }

function togglePause() {
  if (!running) return;
  paused = !paused;
  syncButtons();
}

function syncButtons() {
  $('run').disabled = running && !paused;
  $('stop').disabled = !running;
  $('pause').disabled = !running;
  $('pause').textContent = paused ? t('ctl.resume') : t('ctl.pause');
  $('step').disabled = !(running && paused);
  // 自動走行=無限の練習走行であることを明示する常設バッジ (PX-001/AB8)。
  // 走行中のみ表示。順位確定・チェッカーで「終わる競争」は 🏁 レースへ誘導 (tooltip)。
  const pf = $('practiceFlag'); if (pf) pf.hidden = !running;
  refreshColControls();
}

// ---- 手動操作 (選択中の車のみ) ----
function applyManual() {
  if (running) return;
  const a = activeSlot(); if (!a) return;
  const car = a.car;
  const pwm = Number($('pwm').value);
  if (keys.ArrowUp) { car.driveDir = CONST.FORWARD; car.pwm = pwm; }
  else if (keys.ArrowDown) { car.driveDir = CONST.REVERSE; car.pwm = pwm; }
  else { car.driveDir = CONST.FREE; car.pwm = 0; }
  if (keys.ArrowLeft) car.steer = CONST.LEFT;
  else if (keys.ArrowRight) car.steer = CONST.RIGHT;
  else car.steer = CONST.CENTER;
}

// ---- メインループ ----
// #22: ライブ積分のサブステップ化。ライブ frame は sdt=real*speed(速度倍率)で大 dt の単一積分に
// なり得るため、密集スタートで他車と重なる前進が fleet.integrateSlot の「位置全取り消し+halt」で
// 恒久デッドロックする(速度0で発走できない)。多台×interact のときだけ積分を ≤1/loopHz に分割し、
// 各サブステップで車体エッジを再計算する(決定論レースエンジンの固定60Hzと同じ細かさで順次分離)。
// 単独車 or interact OFF は othersFor が常に [] を返すため従来の単一積分と完全に等価(ライブ単独挙動 不変)。
// freeSpawn/integrateSlot 自体は無改変=レースエンジン共有コードの verifyHash/卓上 byte 不変。
function integrateLive(dt) {
  applyStartGate(slots, interact);   // Stage AK7: 発走の順次化 (held を1フレーム1回更新・レースと同一機構)
  // Stage AO4: mode==='v2' は全車同時積分＋インパルス接触 (integrateFleetV2 が内部で 1/60 サブステップ＋
  // 接触一括解決＝#22 のライブ大 dt デッドロックは構造的に非発生)。dynamic/standard は従来サブステップ経路。
  if (PHYSICS.mode === 'v2') { integrateFleetV2(slots, dt, course.walls, recover, interact); return; }
  const subStep = slots.length > 1 && interact;
  const max = subStep ? (1 / SIM.loopHz) : dt;
  let rem = dt;
  while (rem > 1e-6) {
    const step = Math.min(max, rem);
    const e = slots.map(s => carEdges(s.car));
    slots.forEach((s, i) => integrateSlot(s, step, othersFor(e, i, interact), course.walls, recover));
    rem -= step;
  }
}

let lastT = performance.now();
function frame(t) {
  const real = Math.min(0.05, (t - lastT) / 1000); lastT = t;
  requestAnimationFrame(frame);

  if (editing) { render(); return; }

  applyManual();
  const sdt = real * speed;
  const edges = slots.map(s => carEdges(s.car));

  if (running) {
    if (paused) {
      if (stepRequest) {
        stepRequest = false;
        slots.forEach((s, i) => tickSlot(s, othersFor(edges, i, interact)));
        applyStartGate(slots, interact);   // Stage AK7: 一時停止ステップ実行でも発走順次化を一貫適用
        if (PHYSICS.mode === 'v2') integrateFleetV2(slots, 1 / SIM.loopHz, course.walls, recover, interact);
        else slots.forEach((s, i) => integrateSlot(s, 1 / SIM.loopHz, othersFor(edges, i, interact), course.walls, recover));
      }
    } else {
      slots.forEach((s, i) => {
        if (!s.running) return;
        s.loopTimer -= sdt;
        if (s.loopTimer <= 0) {
          tickSlot(s, othersFor(edges, i, interact));
          s.loopTimer += (1 / SIM.loopHz) + (s.world._pendingDelay || 0) / 1000;
        }
      });
      integrateLive(sdt);
    }
  } else {
    // 手動運転 (選択車のみ動く)
    integrateLive(sdt);
  }

  pollLiveSfx();
  render(edges);
  updateFleetColumns();
}

// AB12: ライブ走行(自動▶/手動)の効果音 — クラッシュ/周回/ゴール遷移で SE を鳴らす (presentation のみ・物理不変)。
//   周回は選択車のみ (多台同時で鳴り過ぎないように)。クラッシュ/ゴールは全車。OFF or 未解錠なら無音。
function pollLiveSfx() {
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]; const lp = s.lap; if (!lp) continue;
    const crashed = !!s.car.crashed;
    if (crashed && !s._sfxCrashed) SFX.play('crash');
    s._sfxCrashed = crashed;
    const fin = !!lp.finished;          // 峠モードのゴール (周回計上と同時に finished=true)
    if (fin && !s._sfxFinished) SFX.play('goal');
    s._sfxFinished = fin;
    const laps = lp.laps | 0;
    if (i === activeIdx && laps > (s._sfxLaps | 0) && !(lp.touge && fin)) SFX.play('lap');
    s._sfxLaps = laps;
  }
}

// 色覚セーフ配色 (AF4): ON のとき各車の表示色を色覚安全パレットへ写像する (描画専用・slot.color は不変
// ＝共有/テーマ/物理に影響しない)。既定 OFF (A11Y.cvdSafe=false) では元の色をそのまま返す＝従来描画と一致。
function dispColor(i, orig) { return A11Y.cvdSafe ? CVD.fleet[i % CVD.fleet.length] : orig; }

function render(edges) {
  const c = editing ? editor.course : course;
  // ビューポート変換 (P2): まず全面を背景色でクリアし (pan/zoom で基準コース矩形の外に隙間を作らない)、
  // 次に zoom/pan を適用してから world 空間レイヤ (コース/軌跡/センサー/車体/編集オーバレイ) を描く。
  // 既定 zoom=1 / pan=0 では恒等変換＋同色全面クリアで従来描画と画素一致 (回帰)。
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = VIEW.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(vt.zoom, 0, 0, vt.zoom, vt.panX, vt.panY);
  drawCourse(ctx, c, view, { grid: editing ? true : opts.grid });
  // 初回のコース描画が出たら起動ローダー(案C)をフェードで隠す (一度だけ)。
  if (!_loaderHidden) {
    _loaderHidden = true;
    const ld = $('courseLoader'); if (ld) ld.classList.add('hidden');
    const st = document.querySelector('.stage'); if (st) st.classList.remove('loading');
  }
  if (editing) { editor.drawOverlay(ctx, view); ctx.setTransform(1, 0, 0, 1, 0, 0); return; }

  edges = edges || slots.map(s => carEdges(s.car));
  // 軌跡 (各車の色。色覚セーフ ON 時は安全パレットへ写像)
  slots.forEach((s, i) => drawTrail(ctx, s.car, view, dispColor(i, s.color)));
  // お手本ライン (AB13・PX-014): ON のとき選択車の実走軌跡をなめらか化した基準線を重ねる (表示のみ)。
  // 選択車のみ＝多車の線が重なって読めなくなるのを避け、観たい1台の「理想ライン」を明確に示す。
  if (refLineOn()) { const ra = activeSlot(); if (ra) drawReferenceLine(ctx, ra.car, view, dispColor(activeIdx, ra.color)); }

  // 全車のセンサー計測 (車両ごとの測距表示にも使う)。レイは各車色、ラベルは選択車のみ。
  // 色覚セーフ ON 時は色を安全パレットへ写像し、レイを破線/ヒット点を四角にして実走軌跡(実線)と形状でも区別する。
  const a = activeSlot();
  // AP18: sample-and-hold ON のときはコーン/HUD 読値も学習プログラムが読む「保持値」(world._sensors) を
  //   表示する=画面のコーンが実機の更新レートでカクつき、プログラムの見え方と一致する (保持値の可視化)。
  //   保持値が未サンプル (プログラム未走行等) の車だけ従来どおり現時刻で測距してフォールバックする。
  //   OFF (既定) は従来どおり毎フレーム readAll=byte 不変・描画不変。
  const heldOrFresh = (s, i) => (SENSOR_HOLD.on && s.world._sensors && s.world._sensors.length)
    ? s.world._sensors : readAll(s.car, course.walls, othersFor(edges, i, interact));
  perCarSensors = slots.map((s, i) => heldOrFresh(s, i));
  if (opts.rays) slots.forEach((s, i) => drawSensors(ctx, perCarSensors[i], view, { show: true, labels: opts.labels && i === activeIdx, color: dispColor(i, s.color), dash: A11Y.cvdSafe, walls: course.walls, extra: othersFor(edges, i, interact) }));
  // 後方センサー(任意装備): 有効時のみ計測・レイ描画。AP18 保持値も同様 (world._rear)。
  perCarRear = rearOn ? slots.map((s, i) => (SENSOR_HOLD.on && s.world._rear) ? s.world._rear : readRear(s.car, course.walls, othersFor(edges, i, interact))) : [];
  if (opts.rays && rearOn) slots.forEach((s, i) => drawSensors(ctx, [perCarRear[i]], view, { show: true, labels: false, color: dispColor(i, s.color), dash: A11Y.cvdSafe, walls: course.walls, extra: othersFor(edges, i, interact) }));
  const aSensors = perCarSensors[activeIdx] || null;

  // 車体: 選択車を最後に描いて最前面へ
  const ordered = slots.map((s, i) => i).sort((x, y) => (x === activeIdx) - (y === activeIdx));
  for (const i of ordered) drawCar(ctx, slots[i].car, view, dispColor(i, slots[i].color));

  // ここから先は画面固定 HUD (メーター/リーダーボード)。zoom/pan の影響を受けないよう恒等変換へ戻す。
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // メーター/パネルは選択車
  if (a) {
    const reg = REGIMES[REGIME_STATE.active] || REGIMES.tabletop;   // 現在領域 (測距単位/上限の明示用・Y2)
    const data = {
      left: aSensors[0].mm, center: aSensors[1].mm, right: aSensors[2].mm,
      x: a.car.x, y: a.car.y, theta: a.car.theta, speed: a.car.v, steer: a.car.steer,
      dispKmh: displayKmh(a.car.v, course),   // 相対補正した表示速度 (サーキット≒350 / 峠≒180)
      speedScaled: reg.realKmh !== true,      // 卓上/中スケールは没入写像=「実車換算」マーカを付ける (PX-010・AB7)

      back: rearOn && perCarRear[activeIdx] ? perCarRear[activeIdx].mm : null, // 後方測距 (任意装備)
      // 測距の単位/上限明示 (Stage Y/Y2・Issue #20)。実車相当 (realKmh=true=フルスケール) は m 表記、
      // 卓上/中スケールは従来 mm。maxMm=現在領域の ToF レンジ上限 (sensorMaxMm)。
      meters: reg.realKmh === true, maxMm: reg.sensorMaxMm,
      // slip角 β=atan2(vlat,u) [deg]。dynamic 車のみ (u/vlat を持つ)。kinematic 車は null=非表示 (IMP-03)。
      slip: a.car.u !== undefined
        ? ((Math.abs(a.car.u) > 0.03 || Math.abs(a.car.vlat) > 0.03) ? Math.atan2(a.car.vlat, a.car.u) * 180 / Math.PI : 0)
        : null,
      // 摩擦円使用率 (M2 / #18②)。dynamic 車のみ (読み取り専用診断 _muUseF/_muUseR)。kinematic は null=非表示。
      muUse: (a.car.u !== undefined && a.car._muUseF != null)
        ? { f: a.car._muUseF, r: a.car._muUseR }
        : null,
      // Stage AO12: 輪ごと摩擦円利用率＋タイヤ熱・摩耗状態 (v2 車のみ・読み取り専用診断=表示層のみ・物理非読取)。
      // wear=car.wear=true のとき温度/摩耗を表示。utilW は wear OFF でも常に有効 (輪ごと摩擦円利用率 HUD)。
      tire4: (a.car.engine === 'v2' && a.car._muUse4)
        ? { util: a.car._muUse4.slice(), wear: !!a.car.wear, temp: a.car._temp ? a.car._temp.slice() : null, worn: a.car._wear ? a.car._wear.slice() : null }
        : null,
      crashed: a.car.crashed, running: running && a.running,
    };
    drawMeters(ctx, data);
    updatePanel(refs, data);
    drawTireHud(ctx, data);   // Stage AO12: 輪ごと摩擦円/タイヤ状態 HUD (表示層のみ・v2 のみ・data.tire4 が null なら no-op)
  }
  // リーダーボード (全車)
  drawFleetHud(ctx, slots.map((s, i) => ({ name: s.name, color: dispColor(i, s.color), lap: s.lap, car: s.car, running: running && s.running })), view, activeIdx);

  // Depth View (選択車の一人称・他車はリアビュー風スプライトで表示)
  if (opts.depth && a) {
    const others = [];
    slots.forEach((s, j) => { if (j !== activeIdx) others.push({ x: s.car.x, y: s.car.y, theta: s.car.theta, color: dispColor(j, s.color) }); });
    drawDepthView(depthCtx, depthCanvas.width, depthCanvas.height, a.car, course.walls, others);
    const dc = $('depthCar'); if (dc) dc.textContent = a.name;
  }
}

// ============================================================================
//  本番レース (Stage W / W3)。現在の車両編成 (各車のプログラム+車種) を W1 決定論エンジン
//  (race_engine.runRace) で走らせ、順位・タイムとレースレポート (適不適の手がかり) を表示する。
//  live frame でなく正準エンジンを使う = 決定論的に再現できる結果 (W_spec §5.1)。ブラウザ実行は
//  『ローカル結果(参考)』= 公式は固定環境の正準エンジンで判定 (環境差あり) と正直に明示する。
// ============================================================================

// 車種キー → 表示名 (言語追従)。CAR_TYPE_BY_KEY に無い key はそのまま表示。
function carTypeLabel(key) { const ct = CAR_TYPE_BY_KEY[key]; return ct ? carTypeName(ct) : key; }

// 公式レースのエントリー/結果の車種表示 (W5)。登録済み (組込/独自/community) の key は言語追従で
// 表示し、未登録の持ち込み車種は同梱 carDef.name をそのまま表示する (custom 車のポータビリティ)。
function entryCarLabel(carType, carDef) {
  const key = carType || (carDef && carDef.key) || '';
  if (key && CAR_TYPE_BY_KEY[key]) return carTypeLabel(key);
  return (carDef && carDef.name) || key || '';
}

// 現在の編成からレースフィールドを作る (グリッド=列順=エントリー順・W_spec §3)。
function buildRaceField() {
  return slots.map((s) => ({
    name: s.name, lang: s.lang, src: s.src,
    carType: s.carType, rear: rearOn, encoder: encoderOn, tire: tireSet, gear: gearSet, susp: suspSet, steerSet, brake: brakeSet,
  }));
}

// AB3 (RC-UX-002): 周回入力の正規化。空欄/0/範囲外/非数は HTML の min=1 に整合させて 1 に丸め、
// [1,30] にクランプする (旧 `Number(v)||3` は 0→3 と min=1 が不一致だった)。0 と空欄を同一規則に統一。
function clampLaps(raw) {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) ? Math.max(1, Math.min(30, n)) : 1;
}

// AO9: 試走周回数 (0..3) の読取・正規化。select は 0..3 のみ持つが範囲外/非数は 0 (試走なし) へ。
function reconLapsOf(id) { const el = $(id); const n = el ? Math.round(Number(el.value)) : 0; return Number.isFinite(n) ? Math.max(0, Math.min(3, n)) : 0; }

// レース実行 (🏁 ボタン)。live 走行を止め、現在編成を決定論エンジンで走らせて結果を出す。
// AB9: 発走カウントダウン演出 (3-2-1-GO)。UI のみ・レース計算には一切触れない (presentation)。
// host = 演出を重ねる位置指定済み要素 (.stage / dlgGhost)。reduced-motion / 多重時は即 onDone。
let countdownActive = false;
function playCountdown(host, onDone) {
  const done = () => { try { onDone && onDone(); } catch (e) {} };
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!host || countdownActive || reduce) { done(); return; }
  countdownActive = true;
  const ov = document.createElement('div');
  ov.className = 'countdown-overlay';
  host.appendChild(ov);
  const steps = ['3', '2', '1', t('countdown.go')];
  let i = 0;
  const timers = [];
  let finished = false;
  const finish = () => {
    if (finished) return; finished = true;
    timers.forEach(clearTimeout); ov.remove(); countdownActive = false;
    done();
  };
  const show = () => {
    if (i >= steps.length) { finish(); return; }
    const isGo = i === steps.length - 1;
    SFX.play(isGo ? 'go' : 'count');   // AB12: 発走演出に効果音 (3-2-1=count / GO=go)
    ov.innerHTML = `<span class="cd-num${isGo ? ' cd-go' : ''}">${escapeHtml(steps[i])}</span>`;
    i++;
    timers.push(setTimeout(show, isGo ? 600 : 550));
  };
  ov.addEventListener('click', finish);   // クリックでスキップ
  show();
}

// AB10: 観戦リプレイ(自動) トグル。ON のとき 🏁/📋 レース後に全車ゴースト再生で観戦してから結果を開く。
function autoSpectate() { const c = $('raceWatch'); return !!(c && c.checked); }
// AB13: お手本ライン トグル (PX-014)。ON のとき frame() が実走軌跡のなめらか基準線を重ねる。
function refLineOn() { const c = $('refLine'); return !!(c && c.checked); }

// AS3: 完走判定 (finish ライン) を持たないコース = 開けた raw コース (ドリフト広場 / 競技グラウンド)。
//   lap.js は finish が無いと update() が即 return するため周回が **原理的に** 計上されず、レースを
//   始めても全車が timeout DNF になるだけだった。開始せず理由を明示する (両コースの desc 自身が
//   「通常の走行プログラムには不向き」と述べているショー/実演用コース)。ソロ走行 (▶) は従来どおり可能。
function raceableCourse() {
  if (course && course.finish) return true;
  logLine(t('log.race.nofinish', { name: courseDisplayName(course) }));
  return false;
}

function runRaceNow() {
  exitEdit();
  stopAuto();
  if (!slots.length) { logLine(t('log.race.nofield')); return; }
  if (!raceableCourse()) return;
  enforceFitRatio('race');   // AK5/D8: 発走直前に実態容量へ確定 (startAuto と同型=carScale ドラッグ後の stale 台数でも団子発走を防ぐ)
  const laps = clampLaps($('raceLaps').value);
  $('raceLaps').value = laps;   // AB3 (RC-UX-001): 実効値を入力欄へ反映 (50→30・0/空欄→1)
  const reconN = reconLapsOf('raceRecon');   // AO9: レース前の単独試走周回数 (0=従来)
  const rejoin = $('raceRejoin').checked;
  const crashRule = { rejoin, penaltySec: 3 };
  const regime = $('regimeSel') ? $('regimeSel').value : null;
  const crashTxt = rejoin ? t('race.crashRule.rejoin', { s: 3 }) : t('race.crashRule.dnf');
  logLine(t('log.race.start', { n: slots.length, laps, crash: crashTxt }));
  if (reconN > 0) logLine(t('log.race.recon', { n: reconN }));   // AO9: 試走ありを告知
  warnFragileClearance();   // Stage AI: レース開始時の配置で連続クリアランスを監視 (脆弱なら警告)
  let res;
  try {
    // AO9: recon>0 のとき各車が本番前に単独で N 周試走し学習地図を持ち込む (計時外・§8)。0 は null=従来。
    // AO12: wearOn=true で v2 タイヤ熱・摩耗を作動 (§6・既定 false=byte 不変)。
    res = runRace({ course, regime, laps, field: buildRaceField(), crashRule, interact, report: true, ghost: true,
      recon: reconN > 0 ? { laps: reconN } : null, wear: wearOn });
  } catch (e) {
    logLine(t('log.race.err', { e: (e && e.message) || e }));
    return;
  }
  const showResults = () => {
    renderRaceResult(res, { laps, regime, crashTxt });
    logLine(t('log.race.done', { fin: res.finishers.length, dnf: res.dnf.length, sec: res.simSec.toFixed(1), hash: res.verifyHash }));
    if (res.finishers.length) logLine(t('race.win', { name: res.finishers[0].name }));
  };
  // AB10: 観戦リプレイ(自動) ON なら、まず全車ゴースト再生で観戦 → 閉じたら結果ダイアログ。
  //   発走演出 (3-2-1-GO) は観戦リプレイ側 (openGhostReplay 内 playCountdown) が担う＝二重 countdown を回避。
  //   OFF (or 軌跡なし) は従来どおり .stage に発走演出を重ねてから結果を開く (AB9)。
  //   レース計算・結果・hash は上で確定済＝観戦の有無で不変 (presentation のみ・CI-5/W1)。
  const ghostData = (res.ghost && res.ghost.frames && res.ghost.frames.length)
    ? { ghost: res.ghost, course, title: escapeHtml(courseDisplayName(course)), replay: { kind: 'recorded' } } : null;  // AK6: このレースの収録フレーム=本物
  if (autoSpectate() && ghostData) {
    openGhostReplay(ghostData, showResults);
  } else {
    playCountdown(document.querySelector('.stage'), showResults);
  }
}

// 結果ダイアログ (メタ・ミニマップ・完走/DNF 表・レースレポート) を生成して開く。

// ============================================================================
//  ローカル開催 (Stage W / W4)。クラス (spec/budget/open) を決めてエントリーを集め、
//  3台未満は filler 補充で成立させ (race_event.formField)・グリッド=エントリー順、決定論レース
//  (race_engine) を公式として走らせる。同じ validateEntry/formField を W5 (GitHub 公式) が再利用。
//  二層モデル(W_spec §0): runRace は persist:false で練習記録(W2)に書かない=公式/非公式が分離。
// ============================================================================
let raceEvent = null;   // { class, specCar, budget:{total}, laps, rejoin, minField, entries:[] }

const evClassLabel = (cls) => t('event.class.' + cls);

// 開催ダイアログを開く (エントリー期間=開く)。
function openEventDlg() {
  exitEdit();
  const spec = $('evSpecCar');
  if (spec) spec.innerHTML = CAR_TYPES.map((ct) => `<option value="${ct.key}">${escapeHtml(carTypeName(ct))}</option>`).join('');
  if (!raceEvent) raceEvent = { class: 'open', specCar: CAR_TYPE_DEFAULT, budget: { total: 60 }, laps: 3, rejoin: false, minField: 3, entries: [] };
  if (!CAR_TYPE_BY_KEY[raceEvent.specCar]) raceEvent.specCar = CAR_TYPE_DEFAULT;   // 削除された独自車種の保険
  $('evClass').value = raceEvent.class;
  $('evBudget').value = raceEvent.budget.total;
  if (spec) spec.value = raceEvent.specCar;
  $('evLaps').value = raceEvent.laps;
  if ($('evRecon')) $('evRecon').value = String(raceEvent.recon || 0);   // AO9: 試走周回数 (既定 0)
  $('evRejoin').checked = raceEvent.rejoin;
  syncEventClassUI();
  $('evMsg').textContent = '';
  renderEventEntries();
  const dlg = $('dlgEvent'); applyI18n(dlg); dlg.showModal();
}

// クラスに応じて予算/規定車の入力欄を出し分け。
function syncEventClassUI() {
  const cls = $('evClass').value;
  $('evBudgetWrap').hidden = cls !== 'budget';
  $('evSpecWrap').hidden = cls !== 'spec';
}

// 現在の UI をイベント状態へ反映。
function readEventConfig() {
  if (!raceEvent) return;
  raceEvent.class = $('evClass').value;
  raceEvent.budget.total = Math.max(20, Math.min(200, Math.round(Number($('evBudget').value) || 60)));
  raceEvent.specCar = $('evSpecCar') ? $('evSpecCar').value : CAR_TYPE_DEFAULT;
  raceEvent.laps = clampLaps($('evLaps').value);
  $('evLaps').value = raceEvent.laps;   // AB3 (RC-UX-001): 開催側も実効値を入力欄へ反映 (raceLaps と同様)
  raceEvent.recon = reconLapsOf('evRecon');   // AO9: 試走周回数 (0..3・0=従来)
  raceEvent.rejoin = $('evRejoin').checked;
}

// 現在の車両編成をエントリーに追加 (クラス規定違反は決定論的に弾く)。
function addFleetEntries() {
  readEventConfig();
  let added = 0; const rejected = [];
  for (const s of slots) {
    const entry = { name: s.name, lang: s.lang, src: s.src, carType: s.carType };
    const v = validateEntry(raceEvent, entry);
    if (v.ok) { raceEvent.entries.push(entry); added++; }
    else rejected.push(s.name + ' (' + entryRejectText(v) + ')');
  }
  let msg = t('event.msg.added', { n: added });
  if (rejected.length) msg += ' / ' + t('event.msg.rejected', { list: rejected.join(', ') });
  $('evMsg').textContent = msg;
  renderEventEntries();
}

function entryRejectText(v) {
  if (v.reason === 'budget') return t('event.reject.budget', { cost: v.cost, total: v.total });
  return t('event.reject.generic');
}

function clearEntries() { if (raceEvent) raceEvent.entries = []; $('evMsg').textContent = ''; renderEventEntries(); }

// エントリー表 + 成立見込み (filler 補充後の台数) を描画。
function renderEventEntries() {
  readEventConfig();
  const el = $('evEntries'); if (!el || !raceEvent) return;
  const cls = raceEvent.class;
  const rows = raceEvent.entries.map((e, i) => {
    const carLabel = cls === 'spec' ? carTypeLabel(raceEvent.specCar) : carTypeLabel(e.carType);
    const costTxt = cls === 'budget' ? (costOf(e.carType) + '/' + raceEvent.budget.total) : '—';
    return `<tr><td>${i + 1}</td><td><span class="race-dot" style="background:${FLEET.colors[i % FLEET.colors.length]}"></span>${escapeHtml(e.name)}</td>` +
      `<td>${escapeHtml(carLabel)}</td>${cls === 'budget' ? `<td>${costTxt}</td>` : ''}` +
      `<td><button class="ev-del" data-i="${i}" title="${escapeHtml(t('event.entry.del'))}">✕</button></td></tr>`;
  }).join('');
  const fillerN = Math.max(0, (raceEvent.minField || 3) - raceEvent.entries.length);
  let html = `<h3>${escapeHtml(t('event.entries'))} (${raceEvent.entries.length})</h3>`;
  if (raceEvent.entries.length) {
    html += '<table class="race-tab"><thead><tr>' +
      [t('event.col.no'), t('race.col.name'), t('race.col.car')].concat(cls === 'budget' ? [t('event.col.cost')] : []).concat([''])
        .map((h) => `<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead><tbody>' + rows + '</tbody></table>';
  } else {
    html += `<p class="race-empty">${escapeHtml(t('event.entries.empty'))}</p>`;
  }
  html += `<p class="event-field">${escapeHtml(t('event.field', { entries: raceEvent.entries.length, filler: fillerN, total: raceEvent.entries.length + fillerN }))}</p>`;
  el.innerHTML = html;
}

// 締切してレース: フィールド成立 (補充≥3・グリッド=エントリー順) → 決定論レース (公式) → 結果。
function closeAndRace() {
  if (!raceableCourse()) return;   // AS3: 完走判定の無いコースは開催レースも成立しない (🏁 と同じガード)
  readEventConfig();
  raceEvent.minField = 3;
  const field = formField(raceEvent, raceEvent.entries);
  const regime = $('regimeSel') ? $('regimeSel').value : null;
  const crashRule = { rejoin: raceEvent.rejoin, penaltySec: 3 };
  const crashTxt = raceEvent.rejoin ? t('race.crashRule.rejoin', { s: 3 }) : t('race.crashRule.dnf');
  const fillerCount = field.filter((f) => f.filler).length;
  logLine(t('log.event.start', { cls: evClassLabel(raceEvent.class), n: field.length, filler: fillerCount }));
  const reconN = raceEvent.recon || 0;   // AO9: 開催設定の試走周回数 (0=従来)
  let res;
  try {
    res = runRace({ course, regime, laps: raceEvent.laps, field, crashRule, interact, report: true, ghost: true,
      recon: reconN > 0 ? { laps: reconN } : null, wear: wearOn });   // AO12: タイヤ摩耗 (現 UI 設定・§6)
  } catch (e) { logLine(t('log.race.err', { e: (e && e.message) || e })); return; }
  $('dlgEvent').close();
  const eventInfo = {
    classLabel: evClassLabel(raceEvent.class),
    budget: raceEvent.class === 'budget' ? raceEvent.budget.total : null,
    fillerCount,
  };
  const showResults = () => {
    renderRaceResult(res, { laps: raceEvent.laps, regime, crashTxt, eventInfo });
    logLine(t('log.race.done', { fin: res.finishers.length, dnf: res.dnf.length, sec: res.simSec.toFixed(1), hash: res.verifyHash }));
    if (res.finishers.length) logLine(t('race.win', { name: res.finishers[0].name }));
  };
  // AB10: 📋 開催レースも観戦リプレイ(自動)に追従 (🏁 と同パターン)。OFF/軌跡なしは AB9 の .stage 発走演出。
  const ghostData = (res.ghost && res.ghost.frames && res.ghost.frames.length)
    ? { ghost: res.ghost, course, title: escapeHtml(courseDisplayName(course)), replay: { kind: 'recorded' } } : null;  // AK6: このレースの収録フレーム=本物
  if (autoSpectate() && ghostData) {
    openGhostReplay(ghostData, showResults);
  } else {
    playCountdown(document.querySelector('.stage'), showResults);
  }
}

// GitHub で公式開催 (W5): 現在の 📋 開催 設定からイベント定義を組み、shareEventUrl で
// races/<id>/event.json の新規ファイル作成画面 (PR) を開く。締切窓は主催が PR で設定する。
function hostOfficialEvent() {
  readEventConfig();
  const regime = $('regimeSel') ? $('regimeSel').value : 'fullscale';
  const slug = course.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const id = slug || ('race-' + Date.now());
  const event = {
    id, title: course.name, course: course.name, regime,
    laps: raceEvent.laps,
    // AB2: 有効 timeout を spec に同梱凍結する。result.json 生成 (pinned Node) と再検証
    // (verifyOfficialLocally) が同じ maxSec で走り verifyHash が一致する (RC-RACE-001・CI-5)。
    maxSec: computeRaceTimeout({ course, laps: raceEvent.laps, regime }),
    class: raceEvent.class,
    specCar: raceEvent.class === 'spec' ? raceEvent.specCar : null,
    budget: raceEvent.class === 'budget' ? { total: raceEvent.budget.total } : null,
    crashRule: { rejoin: raceEvent.rejoin, penaltySec: 3 },
    minField: 3, grid: 'entryOrder', interact: true, noise: false,
    engineVer: APP_VERSION,
    physicsMode: PHYSICS.mode,   // AO5: どの物理エンジンで確定/検証する大会か (fullscale=v2 既定)。再検証が
                                 // ライブ選択に依存せず記録のエンジンで再走するため。旧イベント(未刻)は verify で dynamic。
    // AO9: 試走周回数を記録に凍結 (0=試走なしのときはキーを付けない=既存 event.json byte 不変・verify で 0)。
    ...(raceEvent.recon > 0 ? { recon: raceEvent.recon } : {}),
    // AO12: タイヤ熱・摩耗を記録に凍結 (OFF のときはキーを付けない=既存 event.json byte 不変・verify で false)。
    ...(wearOn ? { wear: true } : {}),
    entryWindow: { open: '', close: '' },   // 主催が PR で設定 (空=即受付の運用も可)
  };
  window.open(shareEventUrl(event), '_blank');
  $('evMsg').textContent = t('event.share.opened');
}

// ============================================================================
//  公式レース (Stage W / W5)。GitHub の races/ で開かれた大会を一覧・閲覧し、確定結果 (公式記録) を
//  表示・締切時の確定エントリー列をローカル決定論エンジンで再実行して検証 (参考)・現在の車を
//  エントリー (PR)。**公式の確定は固定環境の正準エンジンで判定 = ブラウザは参考** (W_spec §5.1/§7)。
//  取得失敗 (未シード/レート制限) は通知1行で本体継続 (Q1/V4 契約)。races/ のシードは人間 (CI-11)。
// ============================================================================
const RU = initRaceUI({ $, escapeHtml, logLine, activeSlot, exitEdit, courseDisplayName, carTypeLabel, entryCarLabel, setActiveProgram, playCountdown, resolveRaceCourse });
const { renderRaceResult, loadOfficialRaces, loadAllOfficialData, checkBeaten, openOfficialDlg, reloadOfficial, selectOfficialRace, submitOfficialEntry, toggleProgSrc, forkOfficialEntry, openRankingsDlg, reloadRankings, renderRankings, saveMe, ghostVsWorld, openGhostReplay } = RU;
// イベントの course (名前 or 同梱 courseDef) → 走行可能なコースに解決。組込名→プリセット、
// community 名→投稿コース、object→正規化。見つからなければ null (再実行不可)。
function resolveRaceCourse(courseRef) {
  if (courseRef && typeof courseRef === 'object') return normalizeCourse(courseRef);   // 同梱 def
  if (!courseRef) return null;
  const p = presetByName(courseRef);                                                    // 組込コース名
  if (p) return p;
  const cc = communityCourses.find((c) => (c.data && c.data.name) === courseRef || c.name === courseRef);
  return cc ? normalizeCourse(cc.data) : null;
}

// ---- 車両カラム UI (色・測距・プログラム・シリアルを縦に、列を横並びで同時表示) ----
const LANG_OPTS = [['c', 'Arduino C++ (Nano / Pico)'], ['py', 'Python (RasPi Zero)'], ['js', 'JavaScript']];
function buildFleetColumns() {
  const wrap = $('fleetCols'); if (!wrap) return;
  wrap.innerHTML = '';
  slots.forEach((s, i) => {
    const col = document.createElement('div');
    col.className = 'carcol' + (i === activeIdx ? ' active' : '');
    col.dataset.idx = i;
    const optsHtml = LANG_OPTS.map(([v, l]) => `<option value="${v}"${s.lang === v ? ' selected' : ''}>${l}</option>`).join('');
    col.innerHTML =
      '<div class="cc-head">' +
        `<span class="cc-dot" style="background:${s.color}"></span>` +
        `<input class="cc-name" value="${s.name}" maxlength="6" title="${t('cc.name.title')}">` +
        `<select class="cc-lang" title="${t('cc.lang.title')}">${optsHtml}</select>` +
        `<button class="cc-sample" title="${t('cc.sample.title')}">📄</button>` +
        `<button class="cc-del" title="${t('cc.del.title')}"${(slots.length <= 1 || running) ? ' disabled' : ''}>✕</button>` +
      '</div>' +
      `<div class="cc-typerow"><span class="cc-typelabel">${t('cc.cartype')}</span>` +
        `<select class="cc-cartype" title="${t('cc.cartype.title')}">${CAR_TYPES.map(ct => `<option value="${ct.key}"${s.carType === ct.key ? ' selected' : ''}>${escapeHtml(carTypeName(ct))}</option>`).join('')}</select>` +
      '</div>' +
      `<div class="cc-typerow"><span class="cc-typelabel">${t('cc.program')}</span>` +
        `<select class="cc-program" title="${t('cc.program.title')}">${programSelectOptions()}</select>` +
      '</div>' +
      `<div class="cc-row"><span class="cc-statlap">L0 ${t('hud.lb.stop')}</span><span class="cc-dist" title="${t('cc.dist.title')}">–/–/–</span></div>` +
      `<div class="cc-row"><span class="cc-speedlabel">${t('cc.speed')}</span><span class="cc-speed" title="${t('cc.speed.title')}">0 km/h</span></div>` +
      '<div class="cc-load">' +
        '<input class="cc-ghurl" type="text" placeholder="GitHub URL">' +
        `<button class="cc-ghload" title="${t('cc.ghload.title')}">${t('cc.ghload')}</button>` +
        `<button class="cc-repo" title="${t('cc.repo.title')}">${t('cc.repo')}</button>` +
        `<label class="cc-up filebtn" title="${t('cc.up.title')}">⬆<input type="file" class="cc-file" accept=".ino,.cpp,.c,.cc,.h,.py,.js"></label>` +
        `<button class="cc-share" title="${t('cc.share.title')}">${t('cc.share')}</button>` +
      '</div>' +
      `<div class="cc-label">${t('cc.progLabel')} <button class="cc-expand" title="${t('cc.expand.title')}">${t('cc.expand')}</button></div>` +
      '<textarea class="cc-editor" spellcheck="false"></textarea>' +
      '<pre class="cc-code hidden"></pre>' +
      `<div class="cc-label">${t('cc.serial')}</div>` +
      '<pre class="cc-serial"></pre>';
    wrap.appendChild(col);
    col.querySelector('.cc-editor').value = s.src;
    syncProgramSelect(i);
    s._cvBuilt = null;
  });
  // 車1台時は右側に広い空白が残る (RC-UX-004)。車両追加への導線タイルで埋める。
  // .carcol ではないので colEl(i)=children[i] (i<slots.length) の索引には影響しない。
  if (slots.length === 1 && slots.length < carCap()) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'carcol-add';
    // 余白が狭いときは CSS (@container) が .ca-label を隠して「＋」だけのコンパクト表示にする。
    // そのとき説明が消えるので title/aria-label を常に持たせる (言語切替は buildFleetColumns 再生成で追従)。
    add.title = t('fleet.addCard');
    add.setAttribute('aria-label', t('fleet.addCard'));
    add.innerHTML = `<span class="ca-plus" aria-hidden="true">＋</span><span class="ca-label">${t('fleet.addCard')}</span>`;
    add.addEventListener('click', addCar);   // addCar 自身が running/maxCars をガード
    wrap.appendChild(add);
  }
  setRunView(running);
}
function colEl(i) { return $('fleetCols').children[i]; }

// ---- 走行プログラム (車種別最速 + みんなの投稿 + 汎用 + カスタム) ----
// GitHub から取得した投稿プログラム [{name, path, code, lang}]。起動後に非同期で埋まる。
let communityPrograms = [];

// 走行セレクタの <option> 群を生成 (buildFleetColumns / 投稿読込後の更新で共用)。
function programSelectOptions() {
  // カリキュラム順: ①基礎〜応用(卓上レース) → ②競技(フルスケール) → ③ショー。
  // level/label は言語追従 (t())、name は英語ブランド固有名で共通。strategy/learns は選択時に読める
  // ように option の title (ツールチップ) で提示する (言語追従)。buildFleetColumns 再生成で切替に追従。
  const opt = p => {
    const lvl = t('prog.' + p.key + '.level'), lbl = t('prog.' + p.key + '.label');
    const tip = escapeHtml(t('prog.' + p.key + '.strategy') + '\n\n' + t('prog.' + p.key + '.learns'));
    return `<option value="${p.key}" title="${tip}">${lvl ? lvl + ' — ' : ''}${p.name} (${lbl})</option>`;
  };
  // 役割表示: 汎用(実機準拠=実機 RumiCar でそのまま動く) と sim最適化(この sim 向け) を分ける。
  let html = `<optgroup label="${t('prog.group.generic')}">${PROGRAMS.filter(p => !p.kind).map(opt).join('')}</optgroup>`;
  html += `<optgroup label="${t('prog.group.comp')}">${PROGRAMS.filter(p => p.kind === 'comp').map(opt).join('')}</optgroup>`;
  html += `<optgroup label="${t('prog.group.show')}">${PROGRAMS.filter(p => p.kind === 'show').map(opt).join('')}</optgroup>`;
  if (communityPrograms.length) {
    html += `<optgroup label="${t('prog.group.community')}">${communityPrograms.map((p, k) => `<option value="ghprog:${k}">${escapeHtml(p.name)}</option>`).join('')}</optgroup>`;
  }
  html += `<option value="generic">${t('prog.opt.generic')}</option>`;
  html += `<option value="custom" hidden>${t('prog.opt.custom')}</option>`;
  return html;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// src が既定/投稿/汎用プログラムのどれかなら、その選択を走行セレクタに反映 (一致しなければ「カスタム」)。
function syncProgramSelect(i) {
  const col = colEl(i); if (!col) return;
  const sel = col.querySelector('.cc-program'); if (!sel) return;
  const src = (slots[i].src || '').trim();
  const key = programKeyForCode(slots[i].src);
  if (key) { sel.value = key; return; }
  const ghIdx = communityPrograms.findIndex(p => (p.code || '').trim() === src);
  if (ghIdx >= 0) { sel.value = 'ghprog:' + ghIdx; return; }
  const isGeneric = Object.values(SAMPLES).some(s => s.trim() === src);
  sel.value = isGeneric ? 'generic' : 'custom';
}
// プログラムをスロットへ読み込む (車種は変えない)。
//   'generic'=汎用サンプル / 'ghprog:<n>'=投稿プログラム / それ以外=車種別最速プログラム
function loadProgramIntoSlot(i, value) {
  const s = slots[i];
  if (value === 'generic') {
    s.src = SAMPLES[s.lang] || '';
  } else if (value.startsWith('ghprog:')) {
    const prog = communityPrograms[Number(value.slice(7))];
    if (!prog) return;
    s.src = prog.code; s.lang = prog.lang || 'c';
  } else {
    const prog = PROGRAM_BY_KEY[value];
    if (!prog) return;
    s.src = prog.code; s.lang = prog.lang;
  }
  const col = colEl(i);
  if (col) {
    col.querySelector('.cc-editor').value = s.src;
    const lang = col.querySelector('.cc-lang'); if (lang) lang.value = s.lang;
  }
  s._cvBuilt = null;
  syncProgramSelect(i);
}

// GitHub の programs/community/ から投稿プログラムを読み込み、各列の走行セレクタへ反映する。
async function loadCommunityPrograms() {
  let list;
  try { list = await listCommunityPrograms(); } catch (e) { list = null; }
  // Q1[B]: 取得失敗 (null) は無言にせず 1 行通知。正常に 0 件 ([]) は静か。本体は止めない。
  if (list === null) { logLine(t('log.ghProgramsFail')); return; }
  // v5.2.0: 逐次 await を並列取得へ (1 件失敗はスキップ=従来同値)。メニュー順は list 一覧順を維持。
  const fetched = await Promise.all(list.map(async (e) => {
    try { const { code, lang } = await fetchRawFile(e.download_url, e.file); return { name: e.name, path: e.path, code, lang: lang || e.lang || 'c' }; }
    catch (err) { return null; /* 1 件失敗はスキップ */ }
  }));
  const loaded = fetched.filter(Boolean);
  if (!loaded.length) return;
  communityPrograms = loaded;
  // 既存の各列の走行セレクタへ「🌐 みんなの投稿」を反映 (選択状態は維持)
  slots.forEach((s, i) => {
    const col = colEl(i); if (!col) return;
    const sel = col.querySelector('.cc-program'); if (!sel) return;
    sel.innerHTML = programSelectOptions();
    syncProgramSelect(i);
  });
  logLine(t('log.ghProgsLoaded', { n: loaded.length }));
}

function refreshColControls() {
  $('carAdd').disabled = running || slots.length >= carCap();
  slots.forEach((s, i) => {
    const col = colEl(i); if (!col) return;
    col.classList.toggle('active', i === activeIdx);
    const del = col.querySelector('.cc-del'); if (del) del.disabled = (slots.length <= 1 || running);
  });
  const rt = $('repoTarget'), a = activeSlot();
  if (rt && a) { rt.textContent = a.name; rt.style.color = a.color; }
}

function selectCar(i) {
  if (i < 0 || i >= slots.length) return;
  activeIdx = i;
  refreshColControls();
  updateShareHash();   // 共有 hash はアクティブ車の車種/プログラムを反映 (AF2)。shareReady 前は no-op
  // 列ストリップ内だけを横スクロール (ページ全体はスクロールさせない=キャンバスから飛ばない)
  const col = colEl(i), wrap = $('fleetCols');
  if (col && wrap) {
    const cl = col.offsetLeft, cr = cl + col.offsetWidth;
    if (cl < wrap.scrollLeft) wrap.scrollLeft = cl;
    else if (cr > wrap.scrollLeft + wrap.clientWidth) wrap.scrollLeft = cr - wrap.clientWidth;
  }
}

// 走行中は各列のエディタを実行行ハイライト付きコード表示へ切替
function setRunView(on) {
  slots.forEach((s, i) => {
    const col = colEl(i); if (!col) return;
    col.querySelector('.cc-editor').classList.toggle('hidden', on);
    const code = col.querySelector('.cc-code');
    code.classList.toggle('hidden', !on);
    if (on) buildColCode(i);
  });
}
function buildColCode(i) {
  const s = slots[i], col = colEl(i); if (!col) return;
  const code = col.querySelector('.cc-code');
  code.innerHTML = ''; s._cvLines = [];
  (s.src || '').split('\n').forEach((ln, k) => {
    const d = document.createElement('div'); d.className = 'cv-line';
    const num = document.createElement('span'); num.className = 'cv-num'; num.textContent = k + 1;
    const cc = document.createElement('span'); cc.className = 'cv-code'; cc.textContent = ln || ' ';
    d.append(num, cc); code.appendChild(d); s._cvLines.push(d);
  });
  s._cvBuilt = s.src;
}

// 毎フレーム: 各列の 状態/測距/シリアル/実行行 をテキスト更新 (DOM 再構築なし)
function updateFleetColumns() {
  const dfmt = (mm) => mm < 0 ? '∞' : mm;
  // 速度表示の領域連動マーカ (PX-010・AB7)。卓上/中スケール (没入写像) は「実車換算」を付け、
  // フルスケール (実速度 km/h) は付けない。領域は実行時に変わり得るので毎フレーム参照する。
  const _spdReg = REGIMES[REGIME_STATE.active];
  const _spdEquiv = (_spdReg && _spdReg.realKmh === true) ? '' : t('speed.equiv');
  slots.forEach((s, i) => {
    const col = colEl(i); if (!col) return;
    const sl = col.querySelector('.cc-statlap');
    if (sl) {
      if (s.lap.touge) {
        // 峠: ゴール済みなら到達タイム、走行中は経過時間
        sl.textContent = s.lap.finished ? t('fleet.goal', { t: fmtTime(s.lap.lastLap) })
          : (s.car.crashed ? t('fleet.retired') : (running && s.running ? t('fleet.descending', { t: fmtTime(s.lap.totalTime) }) : t('fleet.summit')));
      } else {
        const stat = s.car.crashed ? t('hud.lb.crash') : (running && s.running ? t('hud.lb.run') : t('hud.lb.stop'));
        sl.textContent = `L${s.lap.laps} ${stat}`;
      }
    }
    const ds = col.querySelector('.cc-dist'), se = perCarSensors[i];
    if (ds && se) ds.textContent = `${dfmt(se[0].mm)}/${dfmt(se[1].mm)}/${dfmt(se[2].mm)}`;
    const sp = col.querySelector('.cc-speed');
    if (sp) sp.textContent = `${displayKmh(s.car.v, course).toFixed(0)} km/h${_spdEquiv}`;
    const ser = col.querySelector('.cc-serial');
    if (ser && ser._shown !== s.serial) { ser.textContent = s.serial; ser._shown = s.serial; ser.scrollTop = ser.scrollHeight; }
    if (running) {
      const code = col.querySelector('.cc-code');
      if (!code.classList.contains('hidden')) {
        if (s._cvBuilt !== s.src) buildColCode(i);
        const ln = (s.controller && s.controller.line) ? s.controller.line() : 0;
        let active = null;
        s._cvLines.forEach((d, k) => { const onl = (k + 1 === ln); if (onl) active = d; if (d.classList.contains('cv-active') !== onl) d.classList.toggle('cv-active', onl); });
        if (active) { const top = active.offsetTop, h = active.offsetHeight;
          if (top < code.scrollTop) code.scrollTop = top; else if (top + h > code.scrollTop + code.clientHeight) code.scrollTop = top + h - code.clientHeight; }
      }
    }
  });
  updateDriveStatus();
}

// AF3: 走行状態 (選択車の周回/状態/速度) を polite live region でスクリーンリーダーへ通知する。
//   過剰更新を避けるため「要点 (選択車・周回数・状態)」が変化した時だけ本文を書き換え、速度はその時点のスナップショットを添える。
//   速度は毎フレーム揺れるので signature には含めない (含めると読み上げが洪水になる)。表示層のみ・物理非参加。
let _driveSig = null;
function updateDriveStatus() {
  const el = $('driveStatus'); if (!el) return;
  const s = activeSlot();
  if (!s || !s.lap) { if (_driveSig !== '') { el.textContent = ''; _driveSig = ''; } return; }
  const touge = !!s.lap.touge;
  const stateKey = touge
    ? (s.lap.finished ? 'goal' : (s.car.crashed ? 'retired' : (running && s.running ? 'descending' : 'summit')))
    : (s.car.crashed ? 'crash' : (running && s.running ? 'run' : 'stop'));
  const sig = touge ? `${activeIdx}|t|${stateKey}` : `${activeIdx}|${s.lap.laps}|${stateKey}`;
  if (sig === _driveSig) return;
  _driveSig = sig;
  const kmh = displayKmh(s.car.v, course).toFixed(0);
  if (touge) {
    const stateTxt = stateKey === 'goal' ? t('fleet.goal', { t: fmtTime(s.lap.lastLap) })
      : stateKey === 'retired' ? t('fleet.retired')
      : stateKey === 'descending' ? t('fleet.descending', { t: fmtTime(s.lap.totalTime) })
      : t('fleet.summit');
    el.textContent = t('aria.drive.touge', { name: s.name, state: stateTxt, kmh });
  } else {
    const stateTxt = stateKey === 'crash' ? t('hud.lb.crash') : (stateKey === 'run' ? t('hud.lb.run') : t('hud.lb.stop'));
    el.textContent = t('aria.drive.status', { name: s.name, n: s.lap.laps, state: stateTxt, kmh });
  }
}

function addCar() {
  if (running || slots.length >= carCap()) return;
  const i = slots.length;
  // 新規車両は既定車種 (ノーマルFR) の最速プログラムを初期搭載する
  const prog = PROGRAM_BY_CARTYPE[CAR_TYPE_DEFAULT];
  slots.push(newSlot(i, prog.lang, prog.code));
  slots[slots.length - 1].world.rear = rearOn;
  slots[slots.length - 1].world.encoder = encoderOn;
  { const s = slots[slots.length - 1]; s.world.tire = tireSet; s.world.wear = wearOn; s.world.gear = gearSet; s.world.susp = suspSet; s.world.brake = brakeSet; s.world.steerSet = steerSet; s.car.steerSet = steerSet; if (s.car.engine === 'v2') { s.car.tireSet = tireSet; s.car.wear = wearOn; s.car.gearSet = gearSet; s.car.suspSet = suspSet; s.car.brakeSet = brakeSet; } }
  rebuildSpawns(slots, course);
  buildFleetColumns();
  selectCar(slots.length - 1);
  logLine(t('log.carAdded', { name: slots[slots.length - 1].name, n: slots.length }));
  warnFragileClearance();   // Stage AI: 台数を増やした配置の連続クリアランス監視 (脆弱なら警告)
  syncButtons();
}

function removeCar(i) {
  if (running || slots.length <= 1) return;
  const name = slots[i].name;
  slots.splice(i, 1);
  if (activeIdx >= slots.length) activeIdx = slots.length - 1;
  rebuildSpawns(slots, course);
  buildFleetColumns();
  selectCar(activeIdx);
  logLine(t('log.carRemoved', { name, n: slots.length }));
  syncButtons();
}

// 取込系 (GitHub/アップロード/サンプル) は「取込先=選択中の車」へ反映する。
function setActiveProgram(code, lang) {
  const s = activeSlot(); if (!s) return;
  s.src = code; if (lang) s.lang = lang;
  const col = colEl(activeIdx);
  if (col) { col.querySelector('.cc-editor').value = code; if (lang) col.querySelector('.cc-lang').value = lang; }
  s._cvBuilt = null;
}

// ---- コース選択 UI ----
// GitHub から取得した投稿コース [{name, data}]。起動後に非同期で埋まる。
let communityCourses = [];

// コースの表示名/説明 (AB4・RC-I18N-001)。en モードで *_en があれば訳す。
// 識別子 c.name (ja) は不変=公式記録の course 識別子・courseSel option value・presetByName
// マッチ・courseSources キーを壊さない (表示名のみ訳す)。引数はコースオブジェクト、または
// 公式記録の course 識別子 (文字列)。識別子文字列はプリセット解決で name_en を引く。投稿/保存/
// 未解決コースは原文フォールバック (空にしない)。
function courseDisplayName(c) {
  if (!c) return '';
  if (typeof c === 'string') {
    const p = presetByName(c);
    return (getLang() === 'en' && p && p.name_en) ? p.name_en : c;
  }
  return (getLang() === 'en' && c.name_en) ? c.name_en : (c.name || '');
}
function courseDisplayDesc(c) {
  return (getLang() === 'en' && c && c.desc_en) ? c.desc_en : ((c && c.desc) || '');
}

// コース難易度/推奨領域バッジ (AB5・PX-021)。diff(1-5) を持つビルトインで表示、無ければ隠す。
// 難易度は既定3台の本番完走実測で段階化 (★1 入門〜★5 上級)。推奨領域は noRace を真実源。
function renderCourseBadge(c) {
  const el = $('courseBadge');
  if (!el) return;
  const diff = c && c.diff;
  if (!(diff >= 1 && diff <= 5)) { el.hidden = true; el.className = 'course-badge'; el.innerHTML = ''; el.title = ''; return; }
  const stars = '★'.repeat(diff) + '☆'.repeat(5 - diff);
  let html = `<span class="stars">${stars}</span> ${escapeHtml(t('course.diff.' + diff))}`;
  let cls = 'course-badge';
  if (c.beginner) { html += ' 🔰'; cls += ' beginner'; }
  if (c.noRace) { html += ' ・ ' + escapeHtml(t('course.badge.fullscaleOnly')); cls += ' fs'; }
  el.className = cls;
  el.title = c.beginner ? t('course.badge.beginner') : '';
  el.innerHTML = html;
  el.hidden = false;
}

// courseSel の option ラベルに付ける難易度サフィックス (選択前に難易度が分かる=PX-021)。
// value は識別子 c.name のまま (AB4 不変契約)。ビルトインのみ diff を持つ。
function courseListSuffix(c) {
  if (!(c.diff >= 1 && c.diff <= 5)) return '';
  return '  ' + '★'.repeat(c.diff) + (c.beginner ? ' 🔰' : '');
}

// ── 🎯 チャレンジ (Stage AS13・W_spec §8 バックログ「チャレンジ (難コース完走バッジ)」) ─────────
// 母集団 = 組込コースのうち**完走が定義される**もの (finish 線を持つ・AS3 の raceableCourse と同述語)。
// 完走の証拠は練習ベスト記録の存在そのもの (lap.js は周回/ゴール計上時にしか書かない)。集計は
// challenge.js の純関数が行い、ここは組立て (PRESETS/CAR_TYPES/loadBestRec の注入) と描画だけ。
function challengeName(r) { return (getLang() === 'en' && r.nameEn) ? r.nameEn : r.name; }

function renderChallenge() {
  const esc = escapeHtml;
  const built = PRESETS.map((f) => f());
  const st = challengeState(built, CAR_TYPES.map((c) => c.key), loadBestRec);
  let h = '';
  // 総合進捗
  h += `<p class="chal-total"><b>${esc(t('chal.total', { done: st.total.done, total: st.total.total }))}</b></p>`;
  if (st.excluded) h += `<p class="hint">${esc(t('chal.excluded', { n: st.excluded }))}</p>`;
  // AY2: 除外の理由は 2 種類ある (ゴールライン無し / 完走を前提にしない教材ベンチ)。理由ごとに書く。
  if (st.excludedBench) h += `<p class="hint">${esc(t('chal.excludedBench', { n: st.excludedBench }))}</p>`;
  // バッジ (取得済みは色つき・未取得は灰。件数を必ず添えて「あと何個か」が分かるようにする)
  h += '<p class="chal-badges">' + st.badges.map((b) => {
    const label = t('chal.badge.' + b.key, { n: b.total });
    return `<span class="chal-badge${b.got ? ' got' : ''}" title="${esc(label)}">${b.icon} ${esc(label)}` +
      `<span class="hint"> ${b.done}/${b.total}</span></span>`;
  }).join(' ') + '</p>';
  // 難度別の進捗
  h += `<h3>${esc(t('chal.byDiff.h'))}</h3>`;
  h += '<table class="race-tab"><thead><tr>' +
    [t('chal.col.diff'), t('chal.col.done'), t('chal.col.state')].map((x) => `<th>${esc(x)}</th>`).join('') +
    '</tr></thead><tbody>';
  for (const d of st.byDiff) {
    if (!d.total) continue;
    const icon = d.state === 'clear' ? '🏆' : (d.state === 'started' ? '⭐' : '—');
    h += `<tr${d.state === 'clear' ? ' class="rank-record"' : ''}>` +
      `<td>${'★'.repeat(d.diff)}${'☆'.repeat(5 - d.diff)} <span class="hint">${esc(t('course.diff.' + d.diff))}</span></td>` +
      `<td>${d.done}/${d.total}</td><td>${icon} ${esc(t('chal.state.' + d.state))}</td></tr>`;
  }
  h += '</tbody></table>';
  // 次の一歩 (未完走のうち最もやさしいもの)
  if (st.next) h += `<p class="chal-next">${esc(t('chal.next', { name: challengeName(st.next) }))}</p>`;
  else if (st.total.total) h += `<p class="chal-next">${esc(t('chal.next.none'))}</p>`;
  // コース別の一覧
  h += `<h3>${esc(t('chal.courses.h'))}</h3>`;
  h += '<table class="race-tab"><thead><tr>' +
    [t('chal.col.course'), t('chal.col.diff'), t('chal.col.result'), t('chal.col.best'), t('chal.col.cars')]
      .map((x) => `<th>${esc(x)}</th>`).join('') + '</tr></thead><tbody>';
  for (const r of st.rows) {
    const stars = r.diff ? '★'.repeat(r.diff) : '—';
    // AP2: 版スタンプの無い旧記録・当時版で樹立した記録は「(当時 vX)」相当を正直に添える。
    const verNote = r.done ? (r.stale ? ` <span class="hint">${esc(t('chal.ver.unstamped'))}</span>`
      : (r.ver && r.ver !== APP_VERSION ? ` <span class="hint">${esc(t('chal.ver.old', { v: r.ver }))}</span>` : '')) : '';
    h += `<tr class="${r.done ? 'chal-done' : 'chal-todo'}">` +
      `<td>${esc(challengeName(r))}${r.beginner ? ' 🔰' : ''}</td><td>${stars}</td>` +
      `<td>${r.done ? '✅' : '⬜'}</td>` +
      `<td>${r.bestSec != null ? fmtTime(r.bestSec) : '—'}${verNote}</td>` +
      `<td class="hint">${r.cars.length ? esc(r.cars.map(carTypeLabel).join(', ')) : '—'}</td></tr>`;
  }
  h += '</tbody></table>';
  $('chalBody').innerHTML = h;
}

function openChallengeDlg() {
  exitEdit();
  renderChallenge();
  const dlg = $('dlgChallenge'); applyI18n(dlg); dlg.showModal();
}

function rebuildCourseList(selectName) {
  const sel = $('courseSel');
  sel.innerHTML = '';
  courseSources = {};
  for (const f of PRESETS) {
    const c = f();
    courseSources[c.name] = { type: 'preset' };
    // option value は識別子 c.name (ja・不変)、label のみ言語追従 (AB4)＋難易度サフィックス (AB5)。
    addOpt(sel, courseDisplayName(c) + courseListSuffix(c), c.name);
  }
  const saved = loadSavedCourses();
  for (const n of Object.keys(saved)) {
    courseSources[n] = { type: 'saved', data: saved[n] };
    addOpt(sel, '★ ' + n, n);
  }
  // GitHub 投稿コース (プリセット名との衝突を避けるため value を 'gh:' で前置)
  for (const c of communityCourses) {
    const key = 'gh:' + c.name;
    courseSources[key] = { type: 'community', data: c.data };
    addOpt(sel, '🌐 ' + (c.data.name || c.name), key);
  }
  if (selectName && courseSources[selectName]) sel.value = selectName;
}
function addOpt(sel, label, value) {
  const o = document.createElement('option');
  o.textContent = label; o.value = value; sel.appendChild(o);
}
function selectCourse(name) {
  const src = courseSources[name];
  if (!src) return;
  applyCourse(src.type === 'preset' ? presetByName(name) : normalizeCourse(src.data));
  enforceFitRatio('course');   // Stage Y/Y1: コース変更でも car↔course 比率を自動で正す
}

// Stage Y / Y1 (利用者要望 2026-06-19): コースと車両の比率を「初期値だけでなく拡大縮小・
// コースのみ/車両のみ変更・組み合わせ」でも常に正すための単一フィット・ガード (真実源)。
// 比率を動かす入力は regime・carScale・course の3つだけ (車種 CAR_TYPES は length/width を
// 持たず物理サイズに不干渉)。本ガードを course 選択・regime 変更・carScale 変更・起動時の全
// トリガから呼ぶ。実効車長 CAR.length (regime×carScale 反映済み) がコース最小寸法の 1/4 を超え
// たら「過大」とみなす (Stage U/BUG-02 と同一閾値・CI-7 で事後緩めない)。
//   ① noRace 設計の大型コース (競技サーキット/グラウンド) は領域を fullscale へ自動切替=実寸車が
//      微小になり不可視になる「比率おかしい」の上方向を正す (旧 maybeAutoFullscale)。
//   ② 通常コース×領域 fullscale のまま過大なら卓上へ自動復帰 (旧 maybeAutoTabletop)。Stage U は
//      手動 fullscale 選択を「尊重 (警告のみ)」にしていたが、利用者決定 (2026-06-19=「自動で必ず
//      合わせる」) でこれを上書き=手動の不一致選択も必ず補正する (CI-5 で U1 挙動を明示変更)。
//   ③ 領域確定後もなお過大 (carScale を上げ過ぎ) なら、収まる最大のユーザー倍率へ carScale を
//      自動クランプし、スライダー値/表示も補正後の値へ追従させる (車両のみ変更=carScale の補正)。
// 領域切替の副作用 (車リセット/物理差替/スポーン再生成/ログ) は既存 regimeSel change ハンドラを
// change 発火で再利用。dispatch は本ガードを再入させるが _enforcingFit でガード=冪等 (再呼出しで
// 不変)。既定 (tabletop・carScale 既定) の通常コースは過大にならず補正は一切発火しない (no-op=
// 卓上 byte 不変)。zoom (ホイール vt.zoom/Fit view) は worldToScreen が course+car を同係数で写す
// view 専用で物理・比率に不干渉=本ガードの対象外。
let _enforcingFit = false;
function enforceFitRatio(reason) {
  if (_enforcingFit) return;   // 領域 change の再発火による再入を防ぐ (冪等)
  _enforcingFit = true;
  try {
    const sel = $('regimeSel');
    const b = course.bounds || { w: 0, h: 0 };
    const minDim = Math.min(b.w, b.h);
    if (!sel || !(minDim > 0)) return;
    const noRace = course.noRace === true;
    const target = 0.25 * minDim;   // 実効車長の上限 (過大判定の境界)

    // ① 上方向: フルスケール設計の大型コースは領域を fullscale へ (微小車=比率おかしいを防ぐ)。
    if (noRace && minDim >= 50 && sel.value !== 'fullscale') {
      sel.value = 'fullscale';
      logLine(t('log.autoFullscale', { name: course.name }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));  // 物理差替等は既存ハンドラへ委譲
    }

    // ② 下方向: 通常コースで領域 fullscale のまま過大なら卓上へ自動復帰 (手動選択も必ず補正)。
    if (!noRace && sel.value === 'fullscale' && CAR.length > target) {
      sel.value = 'tabletop';
      logLine(t('log.autoTabletop', { name: course.name }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ③ carScale クランプ: 領域確定後もなお過大 (carScale 過大による超過) なら、収まる最大の
    //    ユーザー倍率へ自動で縮める。スライダー値/表示も補正後の値へ追従。
    if (CAR.length > target) {
      const csEl = $('carScale');
      const userK = csEl ? (Number(csEl.value) || 1) : 1;
      if (userK > 0) {
        const lenAtUserK1 = CAR.length / userK;             // = baseLen × regimeK (現領域)
        const maxUserK = target / lenAtUserK1;              // これ以下なら必ず収まる
        const newUserK = Math.max(0.4, Math.floor(maxUserK * 10) / 10);  // スライダー step 0.1・必ず target 以下
        if (newUserK < userK) {
          const k = setCarScale(newUserK);
          if (csEl) csEl.value = String(newUserK);
          const v = $('carScalev'); if (v) v.textContent = k.toFixed(1) + '×';
          if (!running) rebuildSpawns(slots, course);
          logLine(t('log.autoCarScale', { name: course.name, scale: k.toFixed(1) }));
        }
      }
    }
    // ④ N台フィット保証 (Stage AG・GitHub #26 §3/§7・CI-14): 単独車が target(=0.25×外形最小辺) に
    //    収まっても FLEET.maxCars 台が収まるとは限らない (最狭コース×大スケールで freeSpawn の有効点が
    //    枯渇し残りが start に団子)。代理量(外形)でなく実態(実 freeSpawn で全車交差ゼロ)で判定し、
    //    収まるまで carScale を 0.1 刻みで floor(0.4) まで追加縮小。既定スケール・少数台が既に収まる
    //    コースは初回判定が真=この分岐に入らない = no-op (初期配置/卓上 byte 不変)。floor でも収まらない
    //    極小ケースは無言で団子にせず最小スケールまで縮める (実コースでは floor 未到達)。
    {
      const csEl = $('carScale');
      let userK = csEl ? (Number(csEl.value) || 1) : 1;
      if (userK > 0.4 + 1e-9 && !fitsAllCars(course, FLEET.maxCars)) {
        let k = userK;
        while (userK > 0.4 + 1e-9 && !fitsAllCars(course, FLEET.maxCars)) {
          userK = Math.max(0.4, Math.round((userK - 0.1) * 10) / 10);
          k = setCarScale(userK);
        }
        if (csEl) csEl.value = String(userK);
        const v = $('carScalev'); if (v) v.textContent = k.toFixed(1) + '×';
        if (!running) rebuildSpawns(slots, course);
        logLine(t('log.autoCarScale', { name: course.name, scale: k.toFixed(1) }));
      }
    }
    // ⑤ 実態の収容容量で台数を持つ (Stage AK・GitHub #26 D6/D7・CI-14): carScale を floor まで
    //    縮めてもこのコース×領域に全 FLEET.maxCars 台が収まらないことがある (湿+狭の最狭コース)。
    //    代理量 (0.25×外形最小辺) でなく実態 (実 fitsAllCars=実 freeSpawn/checkCollision/carEdges) で
    //    「実際に壁交差0・重なり0で走り出せる最大台数」capN を測り、現在の台数がそれを超えるなら
    //    無言で start に団子させず capN へ自動で減らして告知する (1台は start に必ず置けるので capN≥1)。
    //    既定 (通常コース) は capN=maxCars=6 で全 N 台が収まる=この分岐は no-op (初期配置/卓上 byte 不変)。
    {
      let capN = FLEET.maxCars;
      while (capN > 1 && !fitsAllCars(course, capN)) capN--;   // 静的容量 (壁交差0・前方クリア・実オラクル)
      // ⑥ 実態容量へ更に絞る (Stage AK7・GitHub #26 続報・CI-14): 静的に置けても normal_fr が単独で
      //    コーナー壁へ舵を切り込んで楽め込むコース (最狭のナローシケイン等) があり、静的幾何では正常スポーンと
      //    区別不可 (正準オーバルの方が静的クリアランスは悪いのに正常走行)。よって卓上は **実走で「実際に
      //    走り出せる最大台数」** へ絞る (発走順次化ゲート込み・driveableCapN)。実走は重いので carScale
      //    ドラッグ (input 連発) では避け静的のまま、course/regime/carAdd/startup と発走直前 (startAuto) で確定。
      //    fullscale/midscale は専用コース×凍結グリッドで判定述語の母体外=静的のまま (卓上の楽め込みバグの領分)。
      //    perf: 単独車 (slots.length≤1) は楽め込み (他車に押される) が原理上起きず縮小も発火しないので
      //    実走プローブを省く (コース閲覧の体感を保つ)。多台のときだけ実態容量を測る。発走直前 startAuto でも確定。
      const regNow = sel ? sel.value : 'tabletop';
      if (regNow === 'tabletop' && reason !== 'carScale' && capN > 1 && slots.length > 1) {
        capN = Math.min(capN, driveableCapN(course, regNow, capN));
      }
      courseCapN = capN;                                       // carCap()/refreshColControls の追加上限
      if (!running && slots.length > capN) {
        const was = slots.length;
        slots.splice(capN);                                    // 収容超過の末尾車 (後から追加した分) を除去
        if (activeIdx >= slots.length) activeIdx = slots.length - 1;
        rebuildSpawns(slots, course);
        buildFleetColumns();
        selectCar(activeIdx);
        logLine(t('log.capReduced', { name: course.name, n: capN, was }));
      }
    }
    warnFragileClearance();   // Stage AI: 比率補正/N台縮小が落ち着いた配置で連続クリアランスを監視
  } finally {
    _enforcingFit = false;
  }
}

// Stage AI (GitHub #26 §7-4・CI-14): 配置の健全性を二値(fits/不fits)でなく連続量(最小クリアランス)で
// 監視し、閾値未満を「脆弱」として壊れる前に警告する (観測のみ=配置/スケール/物理/決定論ハッシュは不変)。
// 閾値はスケール不変な車幅相対 (FRAGILE_CLEARANCE_FRAC×CAR.width): 実測較正(決定ログ AI-1)で、既定プレイ
// (1台) は最小クリアランス床が車幅の ~1.8× で常に非発火=no-op、多台数を狭コースへ詰めたとき (例 6台×GP
// レイアウト=0.15mm=車幅の 0.2%) だけ発火する。負値=交差(防御的・AG1 が通常は消す)。
const FRAGILE_CLEARANCE_FRAC = 0.05;   // 最小クリアランス < 車幅×5% を「脆弱」とみなす (実測でこの帯に境界)
function warnFragileClearance() {
  if (!course || slots.length < 2) return;   // 1台は構造的に非脆弱 (car↔car 無)・無駄な評価を避ける
  const mc = minClearance(course, slots.length);   // 実 freeSpawn/carEdges/距離オラクル (再実装しない)
  if (!(mc < FRAGILE_CLEARANCE_FRAC * CAR.width)) return;
  const reg = REGIMES[REGIME_STATE.active] || REGIMES.tabletop;
  const v = reg.realKmh === true ? `${mc.toFixed(2)}m` : `${(mc * 1000).toFixed(1)}mm`;  // 表示単位 (Y/Y2)
  logLine(t('log.fragileClearance', { v, n: slots.length }));
}

// ドリフト車を選んだときの導線。利用者の「もっと滑らせたい」期待への正直な案内。
// 検証結果(実測): 卓上は実機相当(低速)+ToF×3+3値操舵+狭い走路のため、峠の連続ヘアピンでは
// 車を“滑らせ続ける”余地がなく、グリップ(スリップ角~10°)かスピンに二極化する(ドリフト車でも
// グリップ車と大差は出ない)。派手で持続する滑り(ドーナツ/8の字/β>90°)は、広い「ドリフト広場」+
// ショー演目『Drift Showtime』/『Zero-Counter Drift』で“だけ”物理的に成立する(空転代に要る空間)。
let _driftHintShown = false;
function driftHint() {
  if (_driftHintShown) return; _driftHintShown = true;
  logLine(t('log.driftHint'));
}

// GitHub の courses/community/ から投稿コースを読み込み、選択メニューへ反映する。
// 失敗 (オフライン/レート制限/未作成) しても本体動作は止めない。
async function loadCommunityCourses() {
  let list;
  try { list = await listCommunityCourses(); } catch (e) { list = null; }
  // Q1[B]: 取得失敗 (null) は無言にせず 1 行通知する (「コースが消えた」誤解を防ぐ)。
  // 正常に 0 件 ([]) のときは従来どおり静か。失敗しても本体は止めない (プリセット/保存で動く)。
  if (list === null) { logLine(t('log.ghCoursesFail')); return; }
  // v5.2.0: 逐次 await を並列取得へ (1 件失敗はスキップ=従来同値)。メニュー順は list 一覧順を維持。
  const fetched = await Promise.all(list.map(async (e) => {
    try { return { name: e.name, data: await fetchCommunityCourse(e.download_url) }; }
    catch (err) { return null; /* 1 件失敗はスキップ */ }
  }));
  const loaded = fetched.filter(Boolean);
  communityCourses = loaded;
  if (loaded.length) {
    const cur = $('courseSel').value;
    rebuildCourseList(cur);
    logLine(t('log.ghCoursesLoaded', { n: loaded.length }));
  }
}

// GitHub から取得した投稿車種の def [{key,name,...}]。起動後に非同期で埋まる (registerCarType で
// CAR_TYPES に入り、community フラグで「🌐」識別する)。localStorage には保存しない (毎回 GitHub から)。
let communityCars = [];

// GitHub の cars/community/ から投稿車種を読み込み、車種メニュー (fleet セレクタ・車種表) へ反映する。
// 失敗 (オフライン/レート制限/未作成) しても本体動作は止めない (Q1[B]・失敗と 0 件を区別)。
// 組込 key・ローカル独自車種と衝突する key はスキップ (出荷既定/利用者のローカル定義を優先)。
async function loadCommunityCars() {
  let list;
  try { list = await listCommunityCars(); } catch (e) { list = null; }
  // Q1[B]: 取得失敗 (null・未作成 404 含む) は無言にせず 1 行通知する。正常 0 件 ([]) は静か。
  // 失敗しても本体は止めない (組込6車種 + ローカル独自車種で動く)。
  if (list === null) { logLine(t('log.ghCarsFail')); return; }
  const localKeys = new Set(loadCustomCars().map(c => c.key));
  // v5.2.0: 取得のみ並列化。registerCarType は従来どおり list 一覧順の逐次ループで呼ぶ
  // (登録順=メニュー順の決定性を保つ・検査/スキップ条件も従来と同一)。
  const defs = await Promise.all(list.map(async (e) => {
    try { return await fetchCommunityCar(e.download_url); }
    catch (err) { return null; /* 1 件失敗はスキップ */ }
  }));
  const loaded = [];
  for (const def of defs) {
    if (def == null) continue;                       // 1 件失敗はスキップ
    if (!def || !def.key || !def.name) continue;     // 不正 JSON はスキップ
    if (isBuiltinKey(def.key)) continue;             // 組込 key は保護 (上書きしない)
    if (localKeys.has(def.key)) continue;            // ローカル独自車種を優先
    let ct;
    try { ct = registerCarType(def); } catch (err) { continue; }
    if (!ct) continue;
    ct.community = true;                             // 「🌐」識別 + 車種表バッジ抑止 (custom 扱いしない)
    loaded.push(def);
  }
  communityCars = loaded;
  if (loaded.length) {
    buildFleetColumns();        // fleet carType セレクタに「🌐 名前」を反映
    renderCarParamTable();      // 車種表にも反映
    logLine(t('log.ghCarsLoaded', { n: loaded.length }));
  }
}

// ---- コースエディタ ----
// 編集中コースの寸法 (bounds W×H m) をパネルに表示 (#19 ④a「コースの大きさが不明」対応)
function updateEdDims() {
  const el = $('edDims'); if (!el || !editor) return;
  const b = editor.course.bounds || { w: 0, h: 0 };
  el.textContent = `${b.w.toFixed(2)} × ${b.h.toFixed(2)} m`;
}
// コース寸法の事前設定 (#20①)。妥当域 [1, 60] m にクランプし、5cm グリッドに丸める
// (1 マス=GRID.step=0.05m なので枠も 5cm 単位だと格子に乗ってきれい)。
// 編集中コースの bounds 座標枠のみを動かす=物理・既存ベンチコース・courses.json に不干渉。
const ED_DIM_MIN = 1, ED_DIM_MAX = 60;
function syncEdDimInputs() {
  if (!editor) return;
  const b = editor.course.bounds || { w: 0, h: 0 };
  const wIn = $('edW'), hIn = $('edH');
  if (wIn) wIn.value = b.w.toFixed(2);
  if (hIn) hIn.value = b.h.toFixed(2);
}
function applyEditDims() {
  if (!editor) return;
  const wIn = $('edW'), hIn = $('edH');
  const cur = editor.course.bounds || { w: 3, h: 2 };
  let w = parseFloat(wIn && wIn.value), h = parseFloat(hIn && hIn.value);
  if (!isFinite(w)) w = cur.w;
  if (!isFinite(h)) h = cur.h;
  const q = (v) => {
    v = Math.max(ED_DIM_MIN, Math.min(ED_DIM_MAX, v));
    return Math.round(v / GRID.step) * GRID.step;   // 5cm 単位に丸める
  };
  w = q(w); h = q(h);
  if (w === cur.w && h === cur.h) { syncEdDimInputs(); return; }  // 変化なしは静か
  editor.course.bounds = { w, h };
  setView(editor.course);   // キャンバス再フィット (グリッドは編集中 render が毎フレーム再描画)
  syncEdDimInputs();        // クランプ/丸め後の確定値を入力へ反映
  updateEdDims();           // 読み出し表示も追従
  logLine(t('log.edDims', { w: w.toFixed(2), h: h.toFixed(2) }));
}
function enterEdit() {
  stopAuto();
  editor = new CourseEditor(course);
  const m = document.querySelector('input[name=emode]:checked');
  editor.setMode(m ? m.value : 'wall');
  editing = true;
  canvas.style.cursor = 'crosshair';
  $('editorPanel').classList.remove('hidden');
  $('editToggle').textContent = t('ed.closeEdit');
  updateEdDims();
  syncEdDimInputs();
}
function exitEdit() {
  if (!editing) return;
  editing = false;
  canvas.style.cursor = 'default';
  $('editorPanel').classList.add('hidden');
  $('editToggle').textContent = t('course.edit');
  setView(course);
}
function applyEdit() {
  const c = editor.result();
  exitEdit();
  loadCourse(c);
  rebuildCourseList();
  syncButtons();
  logLine(t('log.courseApplied', { name: c.name }));
}

// クライアント座標 → 内部キャンバス px (CSS 表示スケール sx/sy を補正)。
function canvasPx(ev) {
  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width, sy = canvas.height / r.height;
  return { cx: (ev.clientX - r.left) * sx, cy: (ev.clientY - r.top) * sy };
}
function canvasPt(ev) {
  const { cx, cy } = canvasPx(ev);
  // ビューポート変換の逆: 表示px → 基準px (zoom/pan を剥がしてから world へ)。
  return screenToWorld((cx - vt.panX) / vt.zoom, (cy - vt.panY) / vt.zoom, view);
}

// ---- UI 結線 ----
$('run').addEventListener('click', startAuto);
$('pause').addEventListener('click', togglePause);
$('step').addEventListener('click', () => { stepRequest = true; });
$('stop').addEventListener('click', stopAuto);
$('raceRun').addEventListener('click', runRaceNow);   // 本番レース (W3)
// 本番レース ローカル開催 (W4)
$('eventOpen').addEventListener('click', openEventDlg);
$('evClass').addEventListener('change', () => { syncEventClassUI(); renderEventEntries(); });
for (const id of ['evBudget', 'evSpecCar', 'evLaps']) $(id).addEventListener('change', renderEventEntries);
$('evAddFleet').addEventListener('click', addFleetEntries);
$('evClear').addEventListener('click', clearEntries);
$('evRace').addEventListener('click', closeAndRace);
$('evEntries').addEventListener('click', (e) => {
  const btn = e.target.closest('.ev-del'); if (!btn || !raceEvent) return;
  const i = +btn.dataset.i;
  if (i >= 0 && i < raceEvent.entries.length) { raceEvent.entries.splice(i, 1); renderEventEntries(); }
});
$('evShare').addEventListener('click', hostOfficialEvent);   // GitHub 公式開催 (W5)
// 公式レース ダイアログ (W5)
$('officialOpen').addEventListener('click', openOfficialDlg);
$('ofReload').addEventListener('click', reloadOfficial);
$('ofRace').addEventListener('change', (e) => selectOfficialRace(e.target.value));
$('ofSubmit').addEventListener('click', submitOfficialEntry);
// 公式詳細の委譲: 締切後プログラムの 📄 閲覧 / 🍴 fork (ofDetail は innerHTML 差替えされるが親は不変)。
$('ofDetail').addEventListener('click', (e) => {
  const v = e.target.closest('.official-viewsrc'); if (v) { toggleProgSrc(+v.dataset.i, v); return; }
  const f = e.target.closest('.official-fork'); if (f) { forkOfficialEntry(+f.dataset.i); return; }
});
// 🎯 チャレンジ (AS13): 練習記録から難度別の完走進捗とバッジを出す (公式記録とは別・W_spec §0 二層モデル)
$('chalOpen').addEventListener('click', openChallengeDlg);
// 🏅 ランキング / 👻 ゴースト再生 (W6)
$('rankOpen').addEventListener('click', openRankingsDlg);
$('rankReload').addEventListener('click', reloadRankings);
$('rankYouSave').addEventListener('click', () => {
  const v = ($('rankYou').value || '').trim(); saveMe(v);
  $('rankMsg').textContent = t('rank.you.saved', { who: v || '—' }); renderRankings();
});
$('rankBody').addEventListener('click', (e) => {
  const b = e.target.closest('.rank-vsworld'); if (b) ghostVsWorld(b.dataset.cls, b.dataset.course);
});
// 新ダイアログの枠外クリックで閉じる (docdlg-x の × は querySelectorAll で配線済み)
for (const _id of ['dlgRankings', 'dlgGhost', 'dlgChallenge']) {
  const _d = $(_id); if (_d) _d.addEventListener('click', (e) => { if (e.target === _d) _d.close(); });
}
$('reset').addEventListener('click', resetAll);

$('carAdd').addEventListener('click', addCar);
$('optInteract').addEventListener('change', (e) => {
  interact = e.target.checked;
  logLine(interact ? t('log.interact.on') : t('log.interact.off'));
});
const optRecoverEl = $('optRecover');
const RECOVER_KEY = 'rumicar.optRecover';
if (optRecoverEl) {
  // 自動復帰は既定 ON: クラッシュしても恒久停止せず走り続けるので、同じ時間でより多く走れ、
  // 失敗(そのプログラムでは上手く走れないこと)は走行軌跡で伝わる。OFF にした場合は
  // localStorage に保存して次回も尊重する (恒久停止でラップタイムを取りたい上級者向け)。
  let stored = null;
  try { stored = localStorage.getItem(RECOVER_KEY); } catch (e) {}
  recover = (stored === null) ? true : (stored === '1');
  optRecoverEl.checked = recover;
  optRecoverEl.addEventListener('change', (e) => {
    recover = e.target.checked;
    try { localStorage.setItem(RECOVER_KEY, recover ? '1' : '0'); } catch (err) {}
    logLine(recover ? t('log.recover.on') : t('log.recover.off'));
  });
}
const optRearEl = $('optRear');
if (optRearEl) optRearEl.addEventListener('change', (e) => {
  rearOn = e.target.checked;
  slots.forEach(s => { s.world.rear = rearOn; });
  logLine(rearOn ? t('log.rear.on') : t('log.rear.off'));
});
// AB12: 効果音トグル。既定 ON (レポート PX-013「音が皆無」の是正)・選択は localStorage に保存。
//   自動再生ポリシー順守＝最初のユーザー操作で AudioContext を解錠 (一度きり)。OFF は完全無音。
const SFX_KEY = 'rumicar.sfx';
const sfxEl = $('sfxOn');
if (sfxEl) {
  let stored = null;
  try { stored = localStorage.getItem(SFX_KEY); } catch (e) {}
  const on = (stored === null) ? true : (stored === '1');   // 既定 ON
  sfxEl.checked = on;
  SFX.setEnabled(on);
  sfxEl.addEventListener('change', (e) => {
    SFX.setEnabled(e.target.checked);   // ON 時に unlock も実行 (ユーザー操作起点)
    try { localStorage.setItem(SFX_KEY, e.target.checked ? '1' : '0'); } catch (err) {}
    logLine(e.target.checked ? t('log.sfx.on') : t('log.sfx.off'));
  });
}
// AB13: お手本ライン トグル (PX-014)。既定 OFF・選択は localStorage に保存。frame() が毎フレーム
//   チェック状態を読み、ON のとき実走軌跡をなめらか化した基準線を重ねる (表示のみ・物理非干渉)。
const REFLINE_KEY = 'rumicar.refline';
const refEl = $('refLine');
if (refEl) {
  let stored = null;
  try { stored = localStorage.getItem(REFLINE_KEY); } catch (e) {}
  refEl.checked = (stored === '1');   // 既定 OFF
  refEl.addEventListener('change', (e) => {
    try { localStorage.setItem(REFLINE_KEY, e.target.checked ? '1' : '0'); } catch (err) {}
    logLine(e.target.checked ? t('log.refline.on') : t('log.refline.off'));
  });
}
// AF4 (#26②): 色覚セーフ配色 トグル。既定 OFF・選択は localStorage に保存。描画層 (render/hud) は
//   config の A11Y.cvdSafe フラグを参照するため、起動時に保存値→フラグへ同期し、change でフラグを更新する
//   (frame() が毎フレーム render するので即時反映)。表示のみ＝物理/学習/レース計算に一切関与しない。
const CVD_KEY = 'rumicar.cvd';
const cvdEl = $('optCvd');
if (cvdEl) {
  let stored = null;
  try { stored = localStorage.getItem(CVD_KEY); } catch (e) {}
  cvdEl.checked = (stored === '1');   // 既定 OFF
  A11Y.cvdSafe = cvdEl.checked;       // 描画フラグへ同期 (リロードで選択が保持される)
  cvdEl.addEventListener('change', (e) => {
    A11Y.cvdSafe = e.target.checked;
    try { localStorage.setItem(CVD_KEY, e.target.checked ? '1' : '0'); } catch (err) {}
    logLine(e.target.checked ? t('log.cvd.on') : t('log.cvd.off'));
  });
}
// 最初のユーザー操作 (クリック/キー) で AudioContext を解錠する (発走 SE が初回レースから鳴るように)。
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => SFX.unlock(), { once: true }));
const optEncoderEl = $('optEncoder');
if (optEncoderEl) optEncoderEl.addEventListener('change', (e) => {
  encoderOn = e.target.checked;
  slots.forEach(s => { s.world.encoder = encoderOn; });
  logLine(encoderOn ? t('log.encoder.on') : t('log.encoder.off'));
});
// タイヤセット切替 (normal=ゴム/スリック / slip=スリップ・ドリフトタイヤ・Stage AO6)。v2 エンジンのみ物理へ
// 反映される (旧エンジンは無視=byte 不変)。装備を変えたら全車へ適用し初期位置へリセット (タイヤ交換=挙動が変わる)。
const optTireEl = $('optTire');
if (optTireEl) optTireEl.addEventListener('change', (e) => {
  tireSet = normTire(e.target.value);
  slots.forEach(s => { s.world.tire = tireSet; if (s.car.engine === 'v2') s.car.tireSet = tireSet; });
  rebuildSpawns(slots, course);   // reset は tireSet を保持する (装備は reset で不変)。位置/ラップのみ戻す。
  running = false; paused = false;
  syncButtons();
  const v2 = (PHYSICS.mode === 'v2');
  logLine(t('log.tire.' + tireSet, { note: v2 ? '' : t('log.tire.v2only') }));
});
// ギア比切替 (Stage AS9・任意装備)。既定 direct=直結=従来と完全一致。v2 エンジンのみ物理へ反映
// (旧エンジンは無視=byte 不変)。装備変更は全車へ適用し初期位置へリセット (ギア交換=挙動が変わる)。
const optGearEl = $('optGear');
if (optGearEl) optGearEl.addEventListener('change', (e) => {
  gearSet = normGear(e.target.value);
  slots.forEach(s => { s.world.gear = gearSet; if (s.car.engine === 'v2') s.car.gearSet = gearSet; });
  rebuildSpawns(slots, course);
  running = false; paused = false;
  syncButtons();
  const v2 = (PHYSICS.mode === 'v2');
  logLine(t('log.gear.' + gearSet, { note: v2 ? '' : t('log.tire.v2only') }));
});
// サスペンション自由度 切替 (Stage AS11・任意装備)。既定 quasi=自由度なし=従来と完全一致。v2 エンジンのみ
// 物理へ反映 (旧エンジンは無視=byte 不変)。装備変更は全車へ適用し初期位置へリセット (足回り交換=挙動が変わる)。
const optSuspEl = $('optSusp');
if (optSuspEl) optSuspEl.addEventListener('change', (e) => {
  suspSet = normSusp(e.target.value);
  slots.forEach(s => { s.world.susp = suspSet; if (s.car.engine === 'v2') s.car.suspSet = suspSet; });
  rebuildSpawns(slots, course);
  running = false; paused = false;
  syncButtons();
  const v2 = (PHYSICS.mode === 'v2');
  logLine(t('log.susp.' + suspSet, { note: v2 ? '' : t('log.tire.v2only') }));
});
// 操舵サーボ 切替 (Stage AS12・任意装備)。既定 tri=実機準拠の3値=従来と完全一致。**3エンジン共通**で
// 物理へ反映する (サーボは Car が持つ共通機構ゆえ tire/gear/susp と違い v2 限定ではない)。prop を選ぶと
// 学習 API で RC_steer(dir, 0..255) が使えるようになる。装備変更は全車へ適用し初期位置へリセット。
const optSteerEl = $('optSteer');
if (optSteerEl) optSteerEl.addEventListener('change', (e) => {
  steerSet = normSteer(e.target.value);
  slots.forEach(s => { s.world.steerSet = steerSet; s.car.steerSet = steerSet; });
  rebuildSpawns(slots, course);
  running = false; paused = false;
  syncButtons();
  logLine(t('log.steer.' + steerSet));
});
// 制動装置 切替 (Stage AV2・任意装備)。既定 motor=駆動軸のモーターブレーキ=従来と完全一致。v2 エンジンのみ
// 物理へ反映 (旧エンジンは無視=byte 不変)。4輪摩擦を選ぶと同じ総制動力が前後配分で 4 輪へ配られ、ロックが
// 輪ごとに創発する。装備変更は全車へ適用し初期位置へリセット (ブレーキ交換=挙動が変わる)。
const optBrakeEl = $('optBrake');
if (optBrakeEl) optBrakeEl.addEventListener('change', (e) => {
  brakeSet = normBrake(e.target.value);
  slots.forEach(s => { s.world.brake = brakeSet; if (s.car.engine === 'v2') s.car.brakeSet = brakeSet; });
  rebuildSpawns(slots, course);
  running = false; paused = false;
  syncButtons();
  const v2 = (PHYSICS.mode === 'v2');
  logLine(t('log.brake.' + brakeSet, { note: v2 ? '' : t('log.tire.v2only') }));
});
// タイヤ熱・摩耗トグル (Stage AO12)。opt-in=既定 OFF。v2 エンジンのみ物理へ反映 (旧エンジンは無視=byte 不変)。
// ON にするとドリフト等の激しい滑りが後輪を消耗し、長丁場でグリップが目減りする「戦略資源」になる。装備変更=
// 新品タイヤで再スタート (位置/ラップのみリセット)。HUD にタイヤ状態 (温度/摩耗) が表示される。
const optWearEl = $('optWear');
if (optWearEl) optWearEl.addEventListener('change', (e) => {
  wearOn = !!e.target.checked;
  slots.forEach(s => { s.world.wear = wearOn; if (s.car.engine === 'v2') s.car.wear = wearOn; });
  rebuildSpawns(slots, course);   // reset で温度=冷間・摩耗=0 の新品タイヤへ (位置/ラップも初期化)。
  running = false; paused = false;
  syncButtons();
  const v2 = (PHYSICS.mode === 'v2');
  logLine(t(wearOn ? 'log.wear.on' : 'log.wear.off', { note: v2 ? '' : t('log.tire.v2only') }));
});
const optNoiseEl = $('optNoise');
if (optNoiseEl) optNoiseEl.addEventListener('change', (e) => {
  SENSOR_NOISE.on = e.target.checked;  // sensors.js が参照する単一フラグ (config の可変ホルダー)
  // AP19: 実機相当プリセット。config 既定は中立 (byte 基準線=受け入れ①) ゆえ、トグル ON のときだけ
  //   外れ値/距離依存欠測/他車反射率を実機相当の控えめな値へ立てる (OFF で 0/1 へ戻す)。これで単一
  //   トグルが「更に実機的なノイズ」を有効化し、samples の CONF 信頼区間ゲートが実際に演習される。
  if (SENSOR_NOISE.on) {
    SENSOR_NOISE.outlier = 0.02;      // 2%/計測: クロストーク/2次反射相当の spurious 値
    SENSOR_NOISE.dropoutFar = 0.02;   // /m: 遠距離 (~2m) で +4% 程度の追加欠測
    SENSOR_NOISE.carSigmaMul = 1.8;   // 他車エッジ標的は精度 1.8× 荒れる (低反射率)
  } else {
    SENSOR_NOISE.outlier = 0; SENSOR_NOISE.dropoutFar = 0; SENSOR_NOISE.carSigmaMul = 1;
  }
  logLine(SENSOR_NOISE.on
    ? t('log.noise.on', { sig: SENSOR_NOISE.sigmaBaseMm, drop: Math.round(SENSOR_NOISE.dropout * 100) })
    : t('log.noise.off'));
});
// AS8: ToF 光学モデル (反射率/入射角/混入反射/クロストーク)。sensors.js が参照する単一フラグ。
// SENSOR_NOISE (確率的) と独立の決定論モデルなので別トグルにしてある (両方 ON なら光学→ノイズの順に重なる)。
const optOpticsEl = $('optOptics');
if (optOpticsEl) optOpticsEl.addEventListener('change', (e) => {
  SENSOR_OPTICS.on = e.target.checked;
  logLine(SENSOR_OPTICS.on
    ? t('log.optics.on', { car: Math.round(SENSOR_OPTICS.carRefl * 100), xt: Math.round(SENSOR_OPTICS.xtalk * 100) })
    : t('log.optics.off'));
});
// AP18: センサー更新遅延 (sample-and-hold)。api.js の測距キャッシュが参照する単一フラグ (config の可変ホルダー)。
const optHoldEl = $('optHold');
if (optHoldEl) optHoldEl.addEventListener('change', (e) => {
  SENSOR_HOLD.on = e.target.checked;
  logLine(SENSOR_HOLD.on ? t('log.hold.on', { hz: SENSOR_HOLD.hz }) : t('log.hold.off'));
});
// 物理エンジン切替 (standard=キネマティック / dynamic=動力学 / v2=精密動力学・Stage AO)。
// 車オブジェクトを入れ替えるため全車を初期位置へリセットして停止する (コース変更と同じ扱い)。プログラムは保持。
// AO5: ユーザーが物理モデルを手で選んだら以後は自動提示しない (fullscale の v2 既定提示を尊重で抑止)。
let physModeUserPicked = false;
const optPhysEl = $('optPhysMode');
if (optPhysEl) optPhysEl.addEventListener('change', (e) => {
  physModeUserPicked = true;               // 手動選択=以後 regime 切替で自動上書きしない
  const m = setPhysicsMode(e.target.value);
  swapPhysics(slots);
  rebuildSpawns(slots, course);
  running = false; paused = false;
  syncButtons();
  logLine(t(m === 'v2' ? 'log.physics.v2' : m === 'dynamic' ? 'log.physics.dynamic' : 'log.physics.classic'));
});
// 領域(regime)切替: 物理スケール (長さ/速度/μ/重力) のプリセットを適用する。車体スケールと
// ToF レンジが連動するため全車を初期位置へリセット (物理モデル切替と同じ扱い)。動的相似なので
// 同じプログラムでも領域を変えると挙動の意味が変わる (Ay*=(v²/R)/(μg) の支配比は不変)。
const regimeEl = $('regimeSel');
if (regimeEl) regimeEl.addEventListener('change', (e) => {
  const r = applyRegime(e.target.value);  // DYN/CAR + 幾何スケール + ToF レンジを書き換える
  // AO5: regime=fullscale で精密 v2 を既定提示 (空力/荷重/駆動が実車スケールで意味を持つ領域)。手動で
  // 物理モデルを選んでいない間だけ自動で v2 へ (離脱時は dynamic へ戻す)。swapPhysics より前に確定させる。
  if (!physModeUserPicked && optPhysEl) {
    if (e.target.value === 'fullscale' && PHYSICS.mode !== 'v2') {
      setPhysicsMode('v2'); optPhysEl.value = 'v2'; logLine(t('log.physics.v2fullscale'));
    } else if (e.target.value !== 'fullscale' && PHYSICS.mode === 'v2') {
      setPhysicsMode('dynamic'); optPhysEl.value = 'dynamic'; logLine(t('log.physics.dynrevert'));
    }
  }
  swapPhysics(slots);
  rebuildSpawns(slots, course);
  running = false; paused = false;
  syncButtons();
  // 車体スケール表示はユーザー倍率 (slider) のまま。実効サイズは領域倍率×ユーザー倍率。
  logLine(t('log.regime', { name: r.name, desc: r.desc || '', size: (r.L / 0.13).toFixed(1), mm: r.sensorMaxMm }));
  // カリキュラム案内: 各領域に合うサンプルへ誘導する。
  if (e.target.value === 'fullscale') {
    logLine(t('log.learn.fullscale'));
  } else if (e.target.value === 'midscale') {
    logLine(t('log.learn.midscale'));
  } else {
    logLine(t('log.learn.tabletop'));
  }
  enforceFitRatio('regime');  // Stage Y/Y1: 手動の領域変更でも比率を自動補正 (不一致を必ず正す)
});
// 車両カラムのイベント (委譲)
const fleetCols = $('fleetCols');
const colIdx = (e) => { const c = e.target.closest('.carcol'); return c ? Number(c.dataset.idx) : -1; };
fleetCols.addEventListener('click', (e) => {
  const i = colIdx(e); if (i < 0) return;
  if (e.target.classList.contains('cc-del')) { removeCar(i); return; }
  if (e.target.classList.contains('cc-sample')) {       // 既定サンプル
    selectCar(i); slots[i].lang = colEl(i).querySelector('.cc-lang').value;
    setActiveProgram(SAMPLES[slots[i].lang] || '', null);
    return;
  }
  if (e.target.classList.contains('cc-ghload')) {        // GitHub URL 取込
    selectCar(i);
    loadGithubTo(i, colEl(i).querySelector('.cc-ghurl').value);
    return;
  }
  if (e.target.classList.contains('cc-repo')) {          // サンプル参照 (この車へ)
    selectCar(i); openFiler();
    return;
  }
  if (e.target.classList.contains('cc-share')) {         // 今のプログラムを別名で GitHub 保存
    selectCar(i); shareProgram(i);
    return;
  }
  if (e.target.classList.contains('cc-expand')) {        // 大きなエディタで開く
    selectCar(i); openBigEditor(i);
    return;
  }
  selectCar(i);
});

// ---- 大きなプログラムエディタ (モーダル・行番号つき・カード側と双方向同期) ----
// モーダル表示中は背景(カード)が inert になるため、同期は「大→カード」の一方向で足りる。
let bigEditIdx = -1;
const leText = $('leText'), leGutter = $('leGutter');
function renderGutter() {
  const n = (leText.value.match(/\n/g) || []).length + 1;
  let s = '';
  for (let k = 1; k <= n; k++) s += k + '\n';
  leGutter.textContent = s;
  leGutter.scrollTop = leText.scrollTop;
}
// 大エディタの動的ラベル (題名/状態/メッセージ) を現在言語で流し込む。
// 言語切替時にも (ダイアログを開いたまま) 再適用できるよう関数化。
function applyBigEditorLabels() {
  if (bigEditIdx < 0) return;
  const s = slots[bigEditIdx]; if (!s) return;
  $('leTitle').textContent = t('bigedit.title', { name: s.name });
  $('leState').textContent = running ? t('bigedit.viewonly') : '';
  $('leMsg').textContent = running ? t('bigedit.msg.running') : t('bigedit.msg.editing');
}
function openBigEditor(i) {
  bigEditIdx = i;
  const s = slots[i];
  $('leDot').style.background = s.color;
  $('leLang').textContent = (LANG_OPTS.find(([v]) => v === s.lang) || [, ''])[1] || s.lang;
  leText.value = s.src || '';
  leText.readOnly = running;
  applyBigEditorLabels();
  renderGutter();
  $('dlgEditor').showModal();
  leText.focus();
}
leText.addEventListener('input', () => {
  renderGutter();
  if (bigEditIdx < 0) return;
  const i = bigEditIdx;
  slots[i].src = leText.value;
  slots[i]._cvBuilt = null;
  const ce = colEl(i) && colEl(i).querySelector('.cc-editor');
  if (ce) ce.value = leText.value;            // カード側テキストエリアへ反映
  syncProgramSelect(i);
});
leText.addEventListener('scroll', () => { leGutter.scrollTop = leText.scrollTop; });
$('leClose').addEventListener('click', () => $('dlgEditor').close());
$('dlgEditor').addEventListener('close', () => { bigEditIdx = -1; });
// 保存 = カード側の「🌐保存」と同じ＝別名で GitHub へ新規保存 (上書き禁止)。編集はすでに slot へ同期済み。
$('leSave').addEventListener('click', () => { if (bigEditIdx >= 0) shareProgram(bigEditIdx); });
$('leCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(leText.value); }
  catch { leText.select(); try { document.execCommand('copy'); } catch (e) {} }
  $('leMsg').textContent = t('bigedit.msg.copied');
});
fleetCols.addEventListener('focusin', (e) => { const i = colIdx(e); if (i >= 0) selectCar(i); });
fleetCols.addEventListener('input', (e) => {
  const i = colIdx(e); if (i < 0) return;
  if (e.target.classList.contains('cc-editor')) { slots[i].src = e.target.value; slots[i]._cvBuilt = null; syncProgramSelect(i); }
  else if (e.target.classList.contains('cc-name')) {
    slots[i].name = e.target.value || FLEET.names[i] || ('C' + (i + 1));
    if (i === activeIdx) { const rt = $('repoTarget'); if (rt) rt.textContent = slots[i].name; }
  }
});
fleetCols.addEventListener('change', (e) => {
  const i = colIdx(e); if (i < 0) return;
  if (e.target.classList.contains('cc-lang')) {
    slots[i].lang = e.target.value;
    syncProgramSelect(i);
  } else if (e.target.classList.contains('cc-cartype')) {
    const newType = e.target.value;
    slots[i].carType = newType;
    slots[i].car.type = newType; // 物理に即反映 (走行中でも可)
    const typeName = e.target.options[e.target.selectedIndex].text;
    // 車種を選んだら、その車の最速プログラムを既定で読み込む。
    // ただし利用者が手編集したカスタムコードは壊さない (既定/汎用のときだけ差し替え)。
    const isCustom = !programKeyForCode(slots[i].src)
      && !Object.values(SAMPLES).some(s => s.trim() === (slots[i].src || '').trim())
      && (slots[i].src || '').trim() !== '';
    if (isCustom) {
      syncProgramSelect(i);
      logLine(t('log.cartype.custom', { name: slots[i].name, type: typeName }));
    } else {
      const prog = PROGRAM_BY_CARTYPE[newType];
      if (prog) {
        loadProgramIntoSlot(i, newType);
        logLine(t('log.cartype.loaded', { name: slots[i].name, type: typeName, prog: prog.name }));
      } else {
        // 独自車種には専用の既定プログラムが無い → 汎用サンプルを読み込んで走れるようにする。
        loadProgramIntoSlot(i, 'generic');
        logLine(t('log.cartype.custom', { name: slots[i].name, type: typeName }));
      }
    }
    if (newType.startsWith('drift')) driftHint();
  } else if (e.target.classList.contains('cc-program')) {  // 走行プログラム選択
    const v = e.target.value;
    if (v === 'custom') return; // カスタムは表示用
    loadProgramIntoSlot(i, v);
    const label = e.target.options[e.target.selectedIndex].text;
    const note = v.startsWith('ghprog:') ? t('log.prog.community')
      : (v !== 'generic' && v !== slots[i].carType ? t('log.prog.compare') : '');
    logLine(t('log.progLoaded', { name: slots[i].name, label, note }));
    // 競技プログラムは領域/コース/エンコーダのセットアップが要るので案内する。
    const cprog = PROGRAM_BY_KEY[v];
    if (cprog && cprog.regime === 'fullscale') {
      logLine(t('log.compSetup', { course: cprog.course, rear: cprog.rear ? t('log.compSetup.rear') : '', enc: cprog.encoder ? t('log.compSetup.enc') : '' }));
    }
    selectCar(i);
  } else if (e.target.classList.contains('cc-file')) {   // ファイルアップロード
    const file = e.target.files[0]; if (!file) return;
    selectCar(i); uploadTo(file);
  }
  updateShareHash();   // 車種/プログラム/言語の変更を共有 hash に反映 (AF2)
});

// ---- テーマ切替 (CSS 変数差し替え。選択は localStorage に保存し、index.html の
//      先頭スクリプトが描画前に反映する) ----
{
  const THEME_KEY = 'rumicar.theme';
  // キャンバス描画色をテーマ連動にする (RC-VIS-001)。CSS 変数 --canvas-bg/--canvas-grid を
  // 単一ソースとして読み、VIEW.bg/VIEW.grid を上書きする。描画は frame() が毎フレーム render()
  // するので次フレームで反映。config.js は無改変 (卓上 byte 不変)。
  const applyCanvasTheme = () => {
    try {
      const cs = getComputedStyle(document.documentElement);
      const bg = cs.getPropertyValue('--canvas-bg').trim();
      const grid = cs.getPropertyValue('--canvas-grid').trim();
      if (bg) VIEW.bg = bg;
      if (grid) VIEW.grid = grid;
    } catch (e) { /* 非対応環境は config.js 既定色のまま */ }
  };
  const applyTheme = (t) => {
    if (t && t !== 'green') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    applyCanvasTheme();
  };
  const sel = $('themeSel');
  if (sel) {
    let saved = 'green';
    try { saved = localStorage.getItem(THEME_KEY) || 'green'; } catch (e) { /* private mode 等 */ }
    sel.value = saved;
    applyTheme(saved);
    sel.addEventListener('change', (e) => {
      applyTheme(e.target.value);
      try { localStorage.setItem(THEME_KEY, e.target.value); } catch (err) { /* 保存不可でも動作 */ }
    });
  }
  applyCanvasTheme();   // themeSel が無い場合も現テーマの描画色を反映
}

// ---- 言語 (i18n): 既定=ブラウザ設定(ja*→日本語/他→英語)・切替を localStorage 記憶 (Phase N) ----
{
  document.documentElement.lang = getLang();
  applyI18n(document);           // HTML の data-i18n* を現在言語で流し込む
  warnMissing();                 // 欠落/未登録キーを console.warn (更新漏れ早期検出)
  // コース名入力の既定値 (新規コース名) を現在言語で設定する。利用者が編集 or コース読込で
  // 値が既定から変わっていれば言語切替で上書きしない (現値が直前の既定と一致するときのみ追従)。
  let edNameDefault = '';
  const setEdNameDefault = () => {
    const en = $('edName'); if (!en) return;
    const next = t('ed.name.default');
    if (en.value === '' || en.value === edNameDefault) en.value = next;
    edNameDefault = next;
  };
  setEdNameDefault();
  const ls = $('langSel');
  if (ls) {
    ls.value = getLang();
    ls.addEventListener('change', (e) => setLang(e.target.value));
  }
  // 言語切替時: JS が動的に生成/設定する操作系UIを現在言語で作り直す (N3)。
  // (静的 data-i18n* は setLang→applyI18n が処理済み。ここはそれで届かない動的部のみ)
  setOnLangChange(() => {
    buildFleetColumns();   // 車両カード (ラベル/ツールチップ/プログラム選択肢) を再生成
    selectCar(activeIdx);  // アクティブ列を復元
    syncButtons();         // 一時停止/再開ボタン等の動的ラベル
    // applyI18n が editToggle を course.edit に戻すため、編集中は閉じる表記へ上書き。
    if (editing) { const et = $('editToggle'); if (et) et.textContent = t('ed.closeEdit'); }
    // 高低差バッジ (峠コース) は applyCourse 時のみ設定されるので言語に追従させる。
    const badge = $('elevBadge');
    if (badge && !badge.hidden && course.touge && course.elev) badge.textContent = t('course.elevBadge', { m: course.elev });
    // 大きなプログラムエディタが開いていればラベルを更新。
    const dlg = $('dlgEditor');
    if (dlg && dlg.open) applyBigEditorLabels();
    // 車種ダイアログの表 (車種表/パラメータ説明/例) は JS 生成なので言語に追従させる。
    renderCarParamTable();
    // 車種フォーム (名前ラベル/ドリフトラベル/ツールチップ) も言語に追従 (入力値は保持)。
    if ($('carForm') && $('carForm').children.length) renderCarForm(readCarForm());
    // コース選択肢の表示名と現在コースの説明文を現在言語で作り直す (AB4・識別子は不変)。
    rebuildCourseList(course.name);
    const dEl = $('courseDesc'); if (dEl) dEl.textContent = courseDisplayDesc(course);
    renderCourseBadge(course);   // 難易度/推奨領域バッジも現在言語へ (AB5)
    // 変更履歴ポップアップ (見出し/各 note) も現在言語で作り直す (O5)。
    renderChangelogPopup();
    // ランキング (JS 生成) が開いていれば現在言語で作り直す (W6)。
    if ($('dlgRankings') && $('dlgRankings').open) renderRankings();
    setEdNameDefault();    // コース名の既定値も言語に追従 (未編集時のみ)
    updateShareHash();     // 言語切替を共有 hash に反映 (AF2)
    _driveSig = null;      // 走行状態 live region を次フレームで現在言語へ再描画 (AF3)
  });
}

// ---- 利用者向けドキュメント (使い方 / 仕様・制限 / 車種 / 質問) ----
for (const [btn, dlg] of [['helpUsage', 'dlgUsage'], ['helpSpec', 'dlgSpec'], ['helpCars', 'dlgCars'], ['helpPhysics', 'dlgPhysics'], ['helpRace', 'dlgRaceGuide'], ['helpAsk', 'dlgAsk'], ['docSpec', 'dlgDoc']]) {
  const b = $(btn), d = $(dlg);
  if (b && d) {
    b.addEventListener('click', () => d.showModal());
    // 枠外クリックで閉じる (dialog 本体がターゲット = backdrop クリック)
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  }
}
document.querySelectorAll('.docdlg-x').forEach((x) =>
  x.addEventListener('click', () => { const d = $(x.dataset.close); if (d) d.close(); }));

// 操作子の横の ⓘ から物理モデル解説の該当セクションへディープリンク (動力学モデル / 領域)
document.querySelectorAll('.infohint').forEach((h) =>
  h.addEventListener('click', () => {
    const d = $('dlgPhysics'); if (!d) return;
    if (!d.open) d.showModal();
    const sec = h.dataset.pm && $('pm-' + h.dataset.pm);
    // スクロールコンテナは .docdlg 本体 (sticky ヘッダのため body ではない)。
    // showModal 直後はレイアウト未確定なので次フレームで、矩形差から確実にスクロールする。
    const head = d.querySelector('.docdlg-head');
    if (sec) requestAnimationFrame(() => {
      const headH = head ? head.getBoundingClientRect().height : 0;
      d.scrollTop += sec.getBoundingClientRect().top - d.getBoundingClientRect().top - headH - 6;
    });
  }));

// ---- ③ 車種パラメータの公開 + 独自車種の追加 ----
const CC = initCarCrud({ $, escapeHtml, carTypeName, logLine, buildFleetColumns, pruneSlotCarTypes });
const { loadCustomCars, isBuiltinKey, renderCarParamTable, renderCarForm, readCarForm } = CC;
// 削除/編集で key が消えたスロットは既定車種へ戻す (セレクタの stale option を防ぐ)。
function pruneSlotCarTypes() {
  for (const s of slots) {
    if (!CAR_TYPE_BY_KEY[s.carType]) {
      s.carType = CAR_TYPE_DEFAULT;
      if (s.car) s.car.type = CAR_TYPE_DEFAULT;
    }
  }
}

// ---- ⑤ コミュニティ Q&A 投稿 (技術・アイデア限定。猥褻/誹謗をクライアント側で防御) ----
// 注: クライアント側フィルタは回避可能。最終的な可視性は GitHub 上のレビュー(承認/削除)で担保する。
const NG_WORDS = [
  // 猥褻・性的 (日本語/ローマ字/英)
  'セックス', 'エロ', 'av女優', 'ちんちん', 'まんこ', 'ペニス', 'ヴァギナ', 'パイズリ', 'オナニー',
  'sex', 'porn', 'pussy', 'dick', 'cock', 'penis', 'vagina', 'boobs', 'nude', 'xxx', 'fuck',
  // 誹謗中傷・差別・攻撃
  '死ね', '殺す', 'しね', 'バカ', 'アホ', 'クズ', 'カス', 'キモい', 'ブス', 'デブ', 'きちがい', 'キチガイ',
  '在日', '差別', 'idiot', 'stupid', 'retard', 'kill you', 'die ',
];
function moderate(text) {
  const t = (text || '').toLowerCase();
  for (const w of NG_WORDS) if (t.includes(w.toLowerCase())) return { ok: false, word: w };
  // 連絡先/URLスパムの軽い抑止 (技術的議論に限定)
  if ((t.match(/https?:\/\//g) || []).length > 3) return { ok: false, word: 'リンク過多' };
  return { ok: true };
}
$('askSendBtn').addEventListener('click', () => {
  const title = ($('askTitle').value || '').trim();
  const body = ($('askBody').value || '').trim();
  const msg = $('askMsg');
  if (title.length < 4 || body.length < 8) {
    msg.textContent = t('ask.msg.tooShort'); msg.style.color = 'var(--red)'; return;
  }
  const m = moderate(title + '\n' + body);
  if (!m.ok) {
    msg.textContent = t('ask.msg.blocked', { word: m.word });
    msg.style.color = 'var(--red)'; return;
  }
  // GitHub Issue の新規作成画面を事前入力で開く (投稿者自身のアカウントで投稿 → Fable/他者が回答)
  const labelled = encodeURIComponent('question,community');
  const bodyText = body + '\n\n' + t('ask.body.hint') + '\n\n' + t('ask.body.footer');
  const url = `https://github.com/RumiCar-group/RumiCar/issues/new`
    + `?title=${encodeURIComponent('[Q&A] ' + title)}&labels=${labelled}&body=${encodeURIComponent(bodyText)}`;
  window.open(url, '_blank', 'noopener');
  msg.textContent = t('ask.msg.opened'); msg.style.color = 'var(--green)';
  logLine(t('log.askOpened', { title }));
});

// スライダーの塗りつぶし (値の位置を可視化)。背景を value までアクセント色で塗る。
function paintRange(el) {
  const min = +el.min || 0, max = +el.max || 100;
  const p = Math.round(((+el.value - min) / (max - min)) * 100);
  el.style.background = `linear-gradient(to right, var(--accent-hi) 0 ${p}%, var(--surface-3) ${p}% 100%)`;
}
for (const id of ['speed', 'pwm', 'carScale', 'trailLen']) {
  const el = $(id); if (!el) continue;
  paintRange(el);
  el.addEventListener('input', () => paintRange(el));
}
$('pwm').addEventListener('input', (e) => { $('pwmv').textContent = e.target.value; });

$('speed').addEventListener('input', (e) => {
  speed = Number(e.target.value);
  $('speedv').textContent = speed.toFixed(1) + '×';
});

// 車体スケール (コースと車両の比率)。停止中は配置も作り直して新サイズで整列。
$('carScale').addEventListener('input', (e) => {
  const k = setCarScale(e.target.value);
  $('carScalev').textContent = k.toFixed(1) + '×';
  if (!running) rebuildSpawns(slots, course);
  enforceFitRatio('carScale');  // Stage Y/Y1: 車両のみ変更 (carScale 過大) でも比率を自動補正
});

// 走行軌跡の保持量 (点数 → 約 m 表示。点間隔 約1cm)。
$('trailLen').addEventListener('input', (e) => {
  TRAIL.max = Math.max(50, Number(e.target.value) || 4000);
  $('trailLenv').textContent = '~' + Math.round(TRAIL.max * 0.01) + 'm';
});

for (const [id, key] of [['optRays', 'rays'], ['optLabels', 'labels'], ['optGrid', 'grid'], ['optTimestamp', 'timestamp'], ['optDepth', 'depth']]) {
  $(id).addEventListener('change', (e) => { opts[key] = e.target.checked; });
}
$('optDepth').addEventListener('change', (e) => { $('depthWrap').classList.toggle('hidden', !e.target.checked); });

$('courseSel').addEventListener('change', (e) => selectCourse(e.target.value));
$('editToggle').addEventListener('click', () => { editing ? exitEdit() : enterEdit(); });

for (const r of document.querySelectorAll('input[name=emode]')) {
  r.addEventListener('change', (e) => { if (editor) editor.setMode(e.target.value); });
}
$('edUndo').addEventListener('click', () => { if (editor) editor.undo(); });
$('edClear').addEventListener('click', () => { if (editor) editor.clearWalls(); });
// コース寸法の事前設定 (#20①): 入力確定 (change) または「この大きさにする」で適用
$('edSize').addEventListener('click', applyEditDims);
$('edW').addEventListener('change', applyEditDims);
$('edH').addEventListener('change', applyEditDims);
$('edSave').addEventListener('click', () => {
  if (!editor) return;
  const name = ($('edName').value || t('ed.name.default')).trim();
  editor.course.name = name;
  saveCourse(name, editor.toJSON());
  rebuildCourseList(name);
  logLine(t('log.courseSaved', { name }));
});
$('edExport').addEventListener('click', () => {
  if (!editor) return;
  const blob = new Blob([JSON.stringify(editor.toJSON(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (editor.course.name || 'course') + '.json';
  a.click(); URL.revokeObjectURL(a.href);
});
$('edImport').addEventListener('change', async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    editor.load(normalizeCourse(data));
    setView(editor.course);
    $('edName').value = editor.course.name;
    updateEdDims();
    syncEdDimInputs();
    logLine(t('log.courseJsonLoaded', { name: editor.course.name || '' }));
  } catch (e) { logLine(t('log.err.json', { e: e.message })); }
});
$('edShare').addEventListener('click', () => {
  if (!editor) return;
  const json = editor.toJSON();
  json.name = ($('edName').value || json.name || t('ed.name.default')).trim();
  // ①コース JSON を書き出し ②GitHub のアップロード画面を開く (AZ1)。
  // 投稿物の組み立て (JSON.stringify) 自体が投げても「押しても何も起きない」にしない。
  let r;
  try { r = submitToGithub(courseSubmission(json)); }
  catch (e) { logLine(t('log.submit.buildFail', { e: e.message })); return; }
  // 開けなかったときに「開いた GitHub のページに」と言わない (矛盾する 2 行を出さない)。
  if (r.started) {
    logLine(t(r.opened ? 'log.courseSubmitReady' : 'log.courseSubmitSavedOnly',
              { name: json.name, file: r.filename }));
  }
});
$('edDelete').addEventListener('click', () => {
  const n = $('courseSel').value;
  if (loadSavedCourses()[n]) { deleteCourse(n); rebuildCourseList(); logLine(t('log.savedCourseDeleted', { name: n })); }
  else logLine(t('log.presetNoDelete'));
});
$('edApply').addEventListener('click', applyEdit);

// ---- AP24: データ保全 (rumicar.* 一括エクスポート/インポート) ----
// このブラウザの localStorage に保存された全 rumicar.* キーを 1 JSON に書き出し / 読み戻す。
// 純ロジックは data_backup.js (ヘッドレス検証可能)。ここは download/upload + 確認ダイアログの配線のみ。
$('dataExport').addEventListener('click', () => {
  const env = makeBackupEnvelope(localStorage, APP_VERSION);
  if (env.count === 0) { logLine(t('log.backup.empty')); return; }
  const blob = new Blob([JSON.stringify(env, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'rumicar-backup.json';   // Date に依存しない固定名 (決定論)
  a.click(); URL.revokeObjectURL(a.href);
  logLine(t('log.backup.exported', { count: env.count }));
});
$('dataImport').addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';   // 同じファイルを続けて選べるようリセット
  if (!f) return;
  try {
    const data = parseBackup(JSON.parse(await f.text()));
    const pv = previewImport(localStorage, data);
    // CI-11 の精神: 既存と値が異なるキー (衝突) は件数を確認してからのみ上書きする。
    let overwrite = true;
    if (pv.collisions.length > 0) {
      overwrite = window.confirm(t('backup.confirm.overwrite', { n: pv.collisions.length }));
    }
    const res = applyImport(localStorage, data, { overwrite });
    if (!overwrite && res.applied.length === 0) { logLine(t('log.backup.cancelled')); return; }
    logLine(t('log.backup.imported', { applied: res.applied.length, skipped: res.skipped.length }));
  } catch (e) { logLine(t('log.backup.err', { e: e.message })); }
});

// ---- 車両のマウス移動 (編集中以外) ----
// 点が車体(回転矩形)内か。小さい車も掴めるよう中心近傍も許容。
function pointInCar(car, p) {
  const c = car.corners();
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const s = Math.sign(cross);
    if (s !== 0) { if (sign === 0) sign = s; else if (s !== sign) { sign = NaN; break; } }
  }
  if (!Number.isNaN(sign)) return true;
  return Math.hypot(car.x - p.x, car.y - p.y) < 0.22; // 近傍フォールバック (掴みやすく)
}
function carAt(p) {
  for (let i = slots.length - 1; i >= 0; i--) if (pointInCar(slots[i].car, p)) return i; // 上面(後勝ち)優先
  return -1;
}
let dragSlot = -1;
let edDrawing = false;   // コースエディタの連続描画/曲線モードでドラッグ中か
// ---- P2: ビューのパン (ドラッグ移動) 状態 ----
let panning = false, panLastX = 0, panLastY = 0;
function startPan(ev) {
  panning = true;
  const p = canvasPx(ev); panLastX = p.cx; panLastY = p.cy;
  canvas.style.cursor = 'grabbing'; ev.preventDefault();
}
canvas.addEventListener('mousedown', (ev) => {
  // 中ボタンはどのモードでもパン (描画/車ドラッグと衝突しない)。
  if (ev.button === 1) { startPan(ev); return; }
  if (editing) {
    if (editor.mode === 'draw' || editor.mode === 'curve') {
      editor.startStroke(canvasPt(ev)); edDrawing = true; ev.preventDefault();
    } else if (editor.mode === 'rect') {
      editor.startRect(canvasPt(ev)); edDrawing = true; ev.preventDefault();
    }
    return;
  }
  const i = carAt(canvasPt(ev));
  if (i >= 0) { dragSlot = i; selectCar(i); canvas.style.cursor = 'grabbing'; ev.preventDefault(); return; }
  // 左ボタン・非編集・空白・拡大中 = パン (中ボタンの無いトラックパッド/マウス向け)。
  if (ev.button === 0 && vt.zoom > 1) startPan(ev);
});
canvas.addEventListener('mousemove', (ev) => {
  if (panning) {
    const p = canvasPx(ev);
    vt.panX += p.cx - panLastX; vt.panY += p.cy - panLastY;
    panLastX = p.cx; panLastY = p.cy;
    clampPan(); updateViewBadge();
    return;
  }
  const p = canvasPt(ev);
  if (editing) {
    if (edDrawing) { if (editor.mode === 'rect') editor.extendRect(p); else editor.extendStroke(p); }
    else editor.move(p);
    return;
  }
  if (dragSlot >= 0) {
    const c = slots[dragSlot].car;
    // ドラッグ中は自走を止めて (古い driveDir で暴走しないよう) カーソルへ追従、衝突状態は解除。
    c.x = p.x; c.y = p.y; c.v = 0; c.crashed = false;
    c.driveDir = CONST.FREE; c.pwm = 0; c.steer = CONST.CENTER;
    c.trail = [{ x: p.x, y: p.y }];
    if (!running) slots[dragSlot].spawn = { x: p.x, y: p.y, theta: c.theta };
  } else {
    // 拡大中は空白でも 'grab' (パン可能) を示唆。
    canvas.style.cursor = carAt(p) >= 0 ? 'grab' : (vt.zoom > 1 ? 'grab' : 'default');
  }
});
window.addEventListener('mouseup', () => {
  if (panning) { panning = false; canvas.style.cursor = editing ? 'crosshair' : 'default'; return; }
  if (edDrawing) { if (editor.mode === 'rect') editor.endRect(); else editor.endStroke(); edDrawing = false; return; }
  if (dragSlot < 0) return;
  const slot = slots[dragSlot];
  // 走行中にドラッグで復帰させた車は、プログラム実行(loop)を再開させる。
  // (これをしないと slot.running=false のままで loop が呼ばれず、古い driveDir で暴走する)
  if (running && slot && !slot.car.crashed) { slot.running = true; slot.loopTimer = 0; }
  dragSlot = -1; canvas.style.cursor = 'default';
});
// 拡大縮小は明示ボタンで行う (ホイールはページスクロールに任せ、コース上で挙動が変わらない=一貫操作)。
// 拡大時の移動はドラッグ (左/中ボタン) で行う。
const viewInBtn = $('viewIn'); if (viewInBtn) viewInBtn.addEventListener('click', () => zoomStep(+1));
const viewOutBtn = $('viewOut'); if (viewOutBtn) viewOutBtn.addEventListener('click', () => zoomStep(-1));
const viewResetBtn = $('viewReset');
if (viewResetBtn) viewResetBtn.addEventListener('click', resetView);
canvas.addEventListener('click', (ev) => { if (editing) editor.click(canvasPt(ev)); });
// 折れ線(クリック配置)モードはダブルクリックで確定 (先行する click 2 発で最終点は追加済み)。
canvas.addEventListener('dblclick', (ev) => {
  if (editing && editor.mode === 'poly') { editor.finalizePoly(); ev.preventDefault(); }
});

// 各列の取込操作 (取込先 = その列)
async function loadGithubTo(i, url) {
  if (!url) { logLine(t('log.ghUrlEmpty')); return; }
  logLine(t('log.ghFetching', { url }));
  try {
    const { code, name, lang } = await fetchFromGithub(url);
    setActiveProgram(code, lang);
    logLine(t('log.fetchOk', { name, lang: lang || t('log.langUnknown'), target: slots[i] ? slots[i].name : '' }));
  } catch (e) { logLine(t('log.err.fetch', { e: e.message })); }
}

// 今のプログラムを「別名で」GitHub へ保存 (PR)。上書きせず programs/community/ に新規ファイル。
function shareProgram(i) {
  const s = slots[i]; if (!s) return;
  if (!(s.src || '').trim()) { logLine(t('log.progEmpty')); return; }
  const def = `${(s.name || 'car')}-custom`;
  const name = window.prompt(t('prompt.shareProg'), def);
  if (name == null) return; // キャンセル
  const trimmed = name.trim() || def;
  // ①プログラム本文を書き出し ②GitHub のアップロード画面を開く (AZ1)。
  let r;
  try { r = submitToGithub(programSubmission(s.src, trimmed, s.lang)); }
  catch (e) { logLine(t('log.submit.buildFail', { e: e.message })); return; }
  if (r.started) {
    logLine(t(r.opened ? 'log.progSubmitReady' : 'log.progSubmitSavedOnly',
              { name: trimmed, file: r.filename }));
  }
}
async function uploadTo(file) {
  try {
    const { code, name, lang } = await readFile(file);
    setActiveProgram(code, lang);
    logLine(t('log.uploadOk', { name, lang: lang || t('log.langUnknown'), target: activeSlot() ? activeSlot().name : '' }));
  } catch (e) { logLine(t('log.err.upload', { e: e.message })); }
}

// ---- RumiCar サンプル ファイラー ----
const filer = $('repoFiler');
let filerPath = '';
// 上流リポジトリの「廃止された場所」。ここのファイルは取り込ませず、後継を案内する。
// ファイラーはリポジトリのルートから辿れる (openFiler→navFiler('')) ので、廃止済みの
// 置き場にも到達できてしまう。古い実装を誤って取り込むと、新機能 (例: 後方センサー
// RC_read(BACK) 相当の REAR 定義) が無いために動かず、原因が分かりにくい。
// prefix 一致で判定し、増えたらここに1行足すだけで済むようにしておく。
const DEPRECATED_REPO_PATHS = [
  // msg は関数にしておく: 言語切替に追従し、かつ i18n 孤児検査 (wf_i18n_check ③ は t('key') の
  // リテラルを走査する) にも検出される。
  { prefix: 'ArduinoAndESP32/Libraries', msg: () => t('filer.deprecated.arduinoLib') },
];
function deprecatedPathInfo(path) {
  return DEPRECATED_REPO_PATHS.find(d => path === d.prefix || path.startsWith(d.prefix + '/')) || null;
}
function openFiler() { filer.hidden = false; navFiler(''); }
function closeFiler() { filer.hidden = true; }
async function navFiler(path) {
  filerPath = path;
  $('repoPath').textContent = '/' + path;
  const list = $('repoList');
  list.innerHTML = `<li class="filer-loading">${t('filer.loading')}</li>`;
  try {
    const entries = await listRepoDir(path);
    list.innerHTML = '';
    if (path) {
      const up = path.split('/').slice(0, -1).join('/');
      addFilerItem('up', '⬆', t('filer.up'), () => navFiler(up));
    }
    const dep = deprecatedPathInfo(path);
    if (dep) addFilerItem('deprecated', '⚠', dep.msg(), null);
    let loadable = 0;
    for (const e of entries) {
      if (e.type === 'dir') addFilerItem('dir', '📁', e.name, () => navFiler(e.path));
      // 廃止された場所のファイルは一覧には出すが取込不可 (クリックしても何も起きない)。
      else if (e.loadable && dep) addFilerItem('nofile', '🚫', e.name, null);
      else if (e.loadable) { loadable++; addFilerItem('file', '📄', e.name, () => loadFilerFile(e)); }
    }
    if (dep) return;   // 廃止フォルダでは「取込可能なスケッチはありません」を出さない (警告で十分)
    if (!entries.some(e => e.type === 'dir') && loadable === 0) {
      addFilerItem('nofile', '—', t('filer.nofile'), null);
    }
  } catch (err) {
    list.innerHTML = '';
    addFilerItem('nofile', '⚠', t('filer.error', { e: err.message }), null);
  }
}
function addFilerItem(cls, icon, label, onClick) {
  const li = document.createElement('li');
  li.className = cls;
  li.innerHTML = `<span class="ic">${icon}</span><span></span>`;
  li.lastElementChild.textContent = label;
  if (onClick) li.addEventListener('click', onClick);
  $('repoList').appendChild(li);
}
async function loadFilerFile(entry) {
  // 多重防御: 一覧側で取込不可にしてあるが、経路が増えても取り込まないようここでも止める。
  const dep = deprecatedPathInfo(entry.path || '');
  if (dep) { logLine(dep.msg()); return; }
  logLine(t('log.ghSampleFetching', { path: entry.path }));
  try {
    const { code, name, lang } = await fetchRawFile(entry.download_url, entry.name);
    setActiveProgram(code, lang);
    logLine(t('log.fetchOk', { name, lang: lang || t('log.langUnknown'), target: activeSlot().name }));
    closeFiler();
  } catch (e) { logLine(t('log.err.fetch', { e: e.message })); }
}
$('repoClose').addEventListener('click', closeFiler);

// 手動ボタン (押下中のみ)
function holdButton(id, key) {
  const el = $(id);
  const dn = (e) => { e.preventDefault(); keys[key] = true; };
  const up = () => { keys[key] = false; };
  el.addEventListener('mousedown', dn); el.addEventListener('touchstart', dn, { passive: false });
  el.addEventListener('mouseup', up); el.addEventListener('mouseleave', up); el.addEventListener('touchend', up);
}
holdButton('mFwd', 'ArrowUp'); holdButton('mBack', 'ArrowDown');
holdButton('mLeft', 'ArrowLeft'); holdButton('mRight', 'ArrowRight');

// キーボード
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT')) return; // 入力中は捕捉しない
    keys[e.key] = true; e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => { keys[e.key] = false; });

// ---- 起動 ----
// バージョン表示 + 変更履歴ポップアップ (ヘッダーのバッジ。単一ソース = config.APP_VERSION と changelog.js の CHANGELOG)。
// ホバーで開く (CSS :hover)・マウスが外れたら閉じる。バッジの子要素なのでポップアップ上でも開いたまま。
// 見出し/各 note は現在言語に追従する (O5: 言語切替時に onLangChange から再生成)。
// CHANGELOG の遅延読込 (Stage AS2)。1 度だけ import し、以後は解決済み Promise を使い回す。
// 版バッジの表示自体 (APP_VERSION) は同期のまま＝起動直後から正しい版が出る。
let _changelogP = null;
function loadChangelog() {
  if (!_changelogP) _changelogP = import('./changelog.js').then((m) => m.CHANGELOG);
  return _changelogP;
}

// 版バッジのテキストだけ先に確定させる (ポップアップ本体は loadChangelog の解決後)。
function renderVersionBadge() {
  const v = $('appVer');
  if (!v) return;
  v.textContent = APP_VERSION;
  v.removeAttribute('title'); // OS 標準ツールチップは下のポップアップに置き換える
}

async function renderChangelogPopup() {
  const CHANGELOG = await loadChangelog();
  const v = $('appVer');
  if (!v) return;
  v.textContent = APP_VERSION;
  v.removeAttribute('title'); // OS 標準ツールチップは下のポップアップに置き換える
  let pop = v.querySelector('.ver-pop');
  if (!pop) {
    pop = document.createElement('div');
    pop.className = 'ver-pop';
    pop.setAttribute('role', 'tooltip');
    const head = document.createElement('div');
    head.className = 'ver-pop-head';
    pop.appendChild(head);
    const list = document.createElement('div');
    list.className = 'ver-pop-list';
    pop.appendChild(list);
    v.appendChild(pop);
  }
  pop.querySelector('.ver-pop-head').textContent = t('ver.changelog');
  const list = pop.querySelector('.ver-pop-list');
  list.textContent = '';
  const en = getLang() === 'en';
  for (const e of CHANGELOG) {
    const row = document.createElement('div');
    row.className = 'ver-pop-row';
    const tag = document.createElement('span');
    tag.className = 'ver-pop-v';
    tag.textContent = e.v;
    const note = document.createElement('span');
    note.className = 'ver-pop-note';
    note.textContent = (en && e.noteEn) ? e.noteEn : e.note;
    row.appendChild(tag); row.appendChild(note);
    list.appendChild(row);
  }
}

// ===== 設定共有パーマリンク (Stage AF / AF2) ============================
// 「現在の設定」を share.js (AF1・純粋層) で URL hash へ往復変換し、
//  ① 起動時に hash があれば既存の適用経路を通して復元 (applyShareState/course)
//  ② 設定変更で history.replaceState により hash を更新 (戻る操作を汚さない)
//  ③ 🔗ボタンで現在 hash 付き URL をクリップボードへコピー
// を行う薄い配線。物理/api/race_engine/fleet/学習サンプルには一切触れない
// (= 卓上 byte 不変・race verifyHash 不変)。自作コース/編集プログラムは hash に
// 載らない (programKeyForCode が null) → 名前参照+フォールバック+通知 (無言失敗にしない)。

// 現在の UI 状態を share.js の状態オブジェクトへ集約 (読み取り専用)。
//  - program は組込キー (PROGRAM_BY_KEY) のみ。自作/投稿 (custom/ghprog) は null=URL 非搭載。
function currentShareState() {
  const s = activeSlot();
  return {
    course:  course ? course.name : null,
    car:     s ? s.carType : null,
    program: s ? programKeyForCode(s.src) : null,   // 自作/投稿は null (=共有対象外)
    regime:  $('regimeSel') ? $('regimeSel').value : null,
    laps:    $('raceLaps') ? clampLaps($('raceLaps').value) : null,
    noise:   $('optNoise') ? $('optNoise').checked : null,
    theme:   $('themeSel') ? $('themeSel').value : null,
    lang:    getLang(),
    // 物理エンジン (Stage AO1): 既定 dynamic のときは null=hash に載せない=既存共有 URL byte 不変。
    // AO13: 手動選択済み (physModeUserPicked) は値が dynamic でも直列化=「fullscale で手動 dynamic」を
    // 受信側の v2 自動昇格から守る (未選択の既定状態は従来どおり省略=byte 不変)。
    physics: ($('optPhysMode') && (physModeUserPicked || $('optPhysMode').value !== 'dynamic')) ? $('optPhysMode').value : null,
    // タイヤセット (Stage AO6/AS9): 既定 normal のときは null=hash に載せない=既存共有 URL byte 不変。
    tire: ($('optTire') && $('optTire').value !== 'normal') ? $('optTire').value : null,
    // ギア比 (Stage AS9): 既定 direct のときは null=hash に載せない=既存共有 URL byte 不変。
    gear: ($('optGear') && $('optGear').value !== 'direct') ? $('optGear').value : null,
    // サス自由度 (Stage AS11): 既定 quasi のときは null=hash に載せない=既存共有 URL byte 不変。
    susp: ($('optSusp') && $('optSusp').value !== 'quasi') ? $('optSusp').value : null,
    // 操舵サーボ (Stage AS12): 既定 tri のときは null=hash に載せない=既存共有 URL byte 不変。
    steerSet: ($('optSteer') && $('optSteer').value !== 'tri') ? $('optSteer').value : null,
    // 制動装置 (Stage AV2): 既定 motor のときは null=hash に載せない=既存共有 URL byte 不変。
    brake: ($('optBrake') && $('optBrake').value !== 'motor') ? $('optBrake').value : null,
    // 試走周回数 (Stage AO9): 既定 0 のときは null=hash に載せない=既存共有 URL byte 不変。
    recon: reconLapsOf('raceRecon') > 0 ? reconLapsOf('raceRecon') : null,
    // タイヤ熱・摩耗 (Stage AO12): 既定 false のときは null=hash に載せない=既存共有 URL byte 不変。
    wear: ($('optWear') && $('optWear').checked) ? true : null,
  };
}

// 現在状態を URL hash へ反映 (戻る履歴を汚さない replaceState)。復元完了前 (shareReady=false)
// は no-op=復元途中の部分状態で hash を壊さない。URL 操作の失敗で本体を止めない。
function updateShareHash() {
  if (!shareReady) return;
  try { history.replaceState(null, '', '#' + encodeState(currentShareState())); }
  catch (e) { /* about: 等 replaceState 不可環境でも走行は継続 */ }
}

// 現在の設定を再現する絶対 URL を返す。
function currentShareUrl() {
  return location.origin + location.pathname + location.search + '#' + encodeState(currentShareState());
}

// 🔗 共有リンクをクリップボードへ (Clipboard API → execCommand フォールバック)。
async function copyShareLink() {
  const url = currentShareUrl();
  let ok = false;
  try { await navigator.clipboard.writeText(url); ok = true; }
  catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      ok = document.execCommand('copy'); ta.remove();
    } catch (e2) { ok = false; }
  }
  logLine(ok ? t('log.share.copied') : t('log.share.copyFail'));
}

// 変更イベントを既存ハンドラへ委譲するための合成発火 (bubbles=true で委譲リスナにも届く)。
function fireChange(el) { if (el) el.dispatchEvent(new Event('change', { bubbles: true })); }

// hash 由来の状態を「既存の適用経路」を必ず通して復元する (CI-5: 直接代入で Stage U/Y の
// 比率自動補正をバイパスしない)。course は loadPresets 完了後に別途適用 (下の bootstrap)。
// 非 null フィールドのみ適用 (null=未指定=現状維持)。未解決の識別子は既定フォールバック+通知。
function applyShareState(st) {
  if (!st) return;
  // ① 言語を最初に (以降の復元ログ/フォールバック通知を共有言語で出す)。
  if ((st.lang === 'ja' || st.lang === 'en') && st.lang !== getLang()) {
    const ls = $('langSel'); if (ls) ls.value = st.lang;
    setLang(st.lang);   // setOnLangChange → fleet 再生成 (既存経路)
  }
  // ② テーマ (themeSel change → applyTheme + localStorage 保存・既存経路)。
  if (st.theme != null) {
    const sel = $('themeSel');
    if (sel && [...sel.options].some(o => o.value === st.theme) && sel.value !== st.theme) {
      sel.value = st.theme; fireChange(sel);
    }
  }
  // ②' 物理エンジン (Stage AO1・optPhysMode change → setPhysicsMode + swapPhysics + rebuildSpawns=既存経路)。
  //     既定 dynamic は捕捉側で省略されるため通常 null。未知値は select に無い=既存経路で無視 (安全)。
  if (st.physics != null) {
    const sel = $('optPhysMode');
    if (sel && [...sel.options].some(o => o.value === st.physics)) {
      if (sel.value !== st.physics) { sel.value = st.physics; fireChange(sel); }
      // AO13: 値が既に一致でも「明示指定」として pin する (ph=dynamic が後続の regime=fullscale
      // 適用の v2 自動昇格に上書きされない=送信側の手動選択を忠実に復元)。
      else physModeUserPicked = true;
    }
  }
  // ②'' タイヤセット (Stage AO6・optTire change → tireSet 適用 + reset=既存経路)。既定 normal は捕捉側で省略ゆえ通常 null。
  if (st.tire != null) {
    const sel = $('optTire');
    if (sel && [...sel.options].some(o => o.value === st.tire) && sel.value !== st.tire) {
      sel.value = st.tire; fireChange(sel);
    }
  }
  // ②''b ギア比 (Stage AS9・optGear change → gearSet 適用 + reset=既存経路)。既定 direct は捕捉側で省略ゆえ通常 null。
  if (st.gear != null) {
    const sel = $('optGear');
    if (sel && [...sel.options].some(o => o.value === st.gear) && sel.value !== st.gear) {
      sel.value = st.gear; fireChange(sel);
    }
  }
  // ②''c サス自由度 (Stage AS11・optSusp change → suspSet 適用 + reset=既存経路)。既定 quasi は捕捉側で省略ゆえ通常 null。
  if (st.susp != null) {
    const sel = $('optSusp');
    if (sel && [...sel.options].some(o => o.value === st.susp) && sel.value !== st.susp) {
      sel.value = st.susp; fireChange(sel);
    }
  }
  // ②''d 操舵サーボ (Stage AS12・optSteer change → steerSet 適用 + reset=既存経路)。既定 tri は捕捉側で省略ゆえ通常 null。
  if (st.steerSet != null) {
    const sel = $('optSteer');
    if (sel && [...sel.options].some(o => o.value === st.steerSet) && sel.value !== st.steerSet) {
      sel.value = st.steerSet; fireChange(sel);
    }
  }
  // ②'''' 制動装置 (Stage AV2・optBrake change → brakeSet 適用 + reset=既存経路)。既定 motor は捕捉側で省略ゆえ通常 null。
  if (st.brake != null) {
    const sel = $('optBrake');
    if (sel && [...sel.options].some(o => o.value === st.brake) && sel.value !== st.brake) {
      sel.value = st.brake; fireChange(sel);
    }
  }
  // ②''' タイヤ熱・摩耗 (Stage AO12・optWear change → wearOn 適用 + reset=既存経路)。既定 false は捕捉側で省略ゆえ通常 null。
  if (st.wear != null) {
    const el = $('optWear');
    if (el && el.checked !== !!st.wear) { el.checked = !!st.wear; fireChange(el); }
  }
  // ③ 領域 regime (regimeSel change → applyRegime + enforceFitRatio=Stage U/Y 比率補正)。
  //    最終的な regime は course のフィット比率に従って自動補正される (= hash はヒント・CI-5)。
  if (st.regime != null && REGIMES[st.regime]) {
    const sel = $('regimeSel');
    if (sel && sel.value !== st.regime) { sel.value = st.regime; fireChange(sel); }
  }
  // ④ 実機ノイズ (optNoise change → SENSOR_NOISE.on・既存経路)。
  if (st.noise != null) {
    const el = $('optNoise');
    if (el && el.checked !== st.noise) { el.checked = st.noise; fireChange(el); }
  }
  // ⑤ 周回数 (clampLaps で 1..30 に正規化して入力欄へ)。
  if (st.laps != null) { const el = $('raceLaps'); if (el) el.value = clampLaps(st.laps); }
  // ⑤' 試走周回数 (Stage AO9・raceRecon select・0..3)。既定 0 は捕捉側で省略ゆえ通常 null。raceRecon は
  //     ライブ副作用が無い (レース開始時に読む) ため raceLaps と同型で値を直接反映 (fireChange 不要)。
  if (st.recon != null) { const el = $('raceRecon'); const v = String(Math.max(0, Math.min(3, Math.round(st.recon)))); if (el && [...el.options].some(o => o.value === v)) el.value = v; }
  // ⑥ 車種 (アクティブ列の cc-cartype change → 既定プログラム自動読込)。未解決は通知。
  if (st.car != null) {
    if (CAR_TYPE_BY_KEY[st.car]) {
      const col = colEl(activeIdx);
      const sel = col && col.querySelector('.cc-cartype');
      if (sel && sel.value !== st.car) { sel.value = st.car; fireChange(sel); }
    } else {
      logLine(t('log.share.car.missing', { key: st.car }));   // 投稿車種等は名前参照で解決不能=既定維持
    }
  }
  // ⑦ プログラム (車種より後=車種が自動読込した既定を上書き)。組込キー/汎用のみ・未解決は通知。
  if (st.program != null) {
    if (st.program === 'generic' || PROGRAM_BY_KEY[st.program]) {
      const col = colEl(activeIdx);
      const sel = col && col.querySelector('.cc-program');
      if (sel) { sel.value = st.program; fireChange(sel); }
    } else {
      logLine(t('log.share.program.missing', { key: st.program }));   // 自作/投稿プログラムは URL 非搭載
    }
  }
}

// 設定変更 → hash 更新の配線 (既存ハンドラに後追いの第2リスナを足す=非侵襲)。
for (const id of ['courseSel', 'regimeSel', 'optNoise', 'themeSel', 'raceLaps', 'optPhysMode', 'optTire', 'raceRecon', 'optWear', 'optGear', 'optSusp', 'optSteer', 'optBrake']) {
  const el = $(id); if (el) el.addEventListener('change', updateShareHash);
}
// 車種/プログラム/アクティブ車の変更は fleetCols 委譲 change と selectCar から拾う (下記参照)。
{ const b = $('shareLink'); if (b) b.addEventListener('click', copyShareLink); }

// 版バッジは同期で確定させ、変更履歴ポップアップ本体は critical path の外で組む (Stage AS2)。
// ① 初回コース描画のあと (下の起動末尾) に先読みして組む＝人がホバーする頃には出来ている
// ② それより早くホバー/フォーカスされたらその場で組む (先読み前でも空にならない)
renderVersionBadge();
{
  const v = $('appVer');
  if (v) {
    const build = () => { renderChangelogPopup(); };
    v.addEventListener('pointerenter', build, { once: true });
    v.addEventListener('focusin', build, { once: true });
  }
}
// 初期値をスライダー既定に合わせて適用 (再生速度3×・車体スケール0.8×)
{
  const cs = $('carScale'); if (cs) { const k = setCarScale(cs.value); const v = $('carScalev'); if (v) v.textContent = k.toFixed(1) + '×'; }
  const sp = $('speed'); if (sp) { speed = Number(sp.value); const v = $('speedv'); if (v) v.textContent = speed.toFixed(1) + '×'; }
}
// 初期車両: 既定車種 (ノーマルFR) の最速プログラム「Apex Hunter」を搭載
slots = [newSlot(0, PROGRAM_BY_CARTYPE[CAR_TYPE_DEFAULT].lang, PROGRAM_BY_CARTYPE[CAR_TYPE_DEFAULT].code)];
activeIdx = 0;
buildFleetColumns();
selectCar(0);
// Stage AS2「即 render」: 初回のコース描画を **次の rAF を待たずにここで一度** 行う。
// これで起動ローダー(AA1)の退場が 1 フレーム+残りの起動処理 (共有 hash 復元/ボタン同期) ぶん早まる。
// 位置は selectCar(0) の直後＝車両が既に 1 台ある状態で描く (車が後から湧いて見えないように)。
render();
// 設定共有パーマリンク (AF2): 起動時に location.hash があれば、車種/プログラム/領域/ノイズ/
// 周回/テーマ/言語を「既存の適用経路」(applyRegime・cc-cartype/cc-program change 等) を通して
// 復元する。course はプリセット読込後に loadPresets().then で別途復元 (下記)。shareReady は
// 復元が完全に終わる .then の末尾で true=以降の設定変更だけが hash を更新する。
shareState = decodeState(location.hash);
if (hasShareState(shareState)) applyShareState(shareState);
syncButtons();
requestAnimationFrame(frame);
// Stage AS2: 変更履歴 (124KB) の先読み。初回コース描画を済ませた **後** の暇な時間に読む＝
// 起動の critical path には乗らず、人が版バッジへホバーする頃には組み上がっている。
{
  const idle = window.requestIdleCallback ? window.requestIdleCallback.bind(window) : ((f) => setTimeout(f, 300));
  idle(() => { renderChangelogPopup(); });
}
// AP4: data 系 (練習ベスト/自作コース/独自車種) の保存失敗を握りつぶさず 1 行通知する。
// what = 安定 id ('best'|'course'|'car') を i18n 文言化して logLine へ (設定系トグルは対象外)。
setStoreFailHandler((what) => {
  logLine(t('store.saveFail', { what: t('store.what.' + what) }));
});
logLine(t('log.startup', { ver: APP_VERSION }));
loadPresets().then(() => {
  rebuildCourseList(course.name);
  // 設定共有 (AF2): hash にコース名があり、現在のレジストリ (組込/保存/投稿) で解決できれば
  // それを既存の selectCourse 経路 (applyCourse + enforceFitRatio=Stage Y 比率補正) で復元する。
  // 解決不能 (他者の自作コース等) は名前参照のフォールバック=ランダム既定+通知 (無言失敗にしない)。
  let restoredCourse = false;
  if (shareState && shareState.course != null) {
    if (courseSources[shareState.course]) {
      $('courseSel').value = shareState.course;
      selectCourse(shareState.course);
      restoredCourse = true;
    } else {
      logLine(t('log.share.course.missing', { name: shareState.course }));
    }
  }
  // プリセット読込後、ランダムなコースを選択して開始する (hash 復元しなかった場合のみ)。
  // AB5/PX-022: 起動ランダムは入門プール (beginner=既定3台が完走しやすいコース) に限定する。
  // 新規ユーザが初手で完走0台コース (峠/フルスケール等) に当たり「壊れている」と誤解するのを防ぐ。
  if (!restoredCourse && PRESETS.length) {
    const built = PRESETS.map((f) => f());
    const pool = built.filter((c) => c.beginner);
    const src = pool.length ? pool : built;   // 万一プールが空でも従来どおり全体から選ぶ (堅牢性)
    const c = src[Math.floor(Math.random() * src.length)];
    applyCourse(c);
    enforceFitRatio('startup');   // Stage Y/Y1: 初期 (ランダム) コースでも比率を正す
    rebuildCourseList(c.name);
  }
  logLine(t('log.coursesLoaded', { n: PRESETS.length }));
  // 設定共有 (AF2): 復元完了。共有リンク由来なら復元を通知し、以降の設定変更だけが hash を
  // 更新できるようにする (復元途中の部分状態で hash を壊さないためのゲート解除)。
  shareReady = true;
  if (hasShareState(shareState)) {
    logLine(t('log.share.restored'));
    // hash を「実際に適用された状態」へ正規化する (フォールバックした未解決コース/車種/
    // プログラムや、比率補正後の領域をアドレスバーに正しく反映=以降の共有を一貫させる)。
    // hash が無かった通常訪問では呼ばない=URL はクリーンなまま (初回変更で初めて書かれる)。
    updateShareHash();
  }
  syncButtons();
  loadCommunityCourses(); // GitHub 投稿コースを非同期で追加読み込み
  loadCommunityPrograms(); // GitHub 投稿プログラムを非同期で追加読み込み
  loadCommunityCars();     // GitHub 投稿車種を非同期で追加読み込み (V4)
  // GitHub 公式レース: 一覧 → 全詳細を集計 (W5/W6) → 起動時の打破通知 (自分の記録 vs 世界ベスト)。
  // 未シードは [] のまま (通知1行)・打破通知も no-op。失敗しても本体は止めない (Q1/V4 契約)。
  loadOfficialRaces().then(() => loadAllOfficialData()).then(checkBeaten).catch(() => {});
});
