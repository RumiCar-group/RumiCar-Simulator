// 決定論レースエンジン (Stage W / W1)。正準スペック docs/phase_w/W_spec.md §5 の実装。
//
// 既存の本番物理 (fleet.integrateSlot/tickSlot・physics_dyn・sensors・lap・api・runner) を
// 「固定 60Hz・ノイズ強制 OFF・決定論的処理順 (car index 昇順)」で駆動し、衝突・周回・
// クラッシュ規則 (DNF / 3秒ペナルティ復帰)・順位を含む正準結果を出すヘッドレス実行。
//
// 設計の核: runRace は main.js の frame() の「走行中・非ポーズ」分岐そのものを、
// wall-clock 由来の可変 sdt の代わりに固定刻み DT=1/60 で回すだけ。レンダリング・
// requestAnimationFrame・performance.now を一切使わない。⇒ ブラウザでも node でも同一の
// ピュアコードが同一シーケンスを生成する (node↔browser 一致の実測対象 = 最大リスクの検証)。
//
// 正準性の根拠 (W_spec §5):
//  - コア物理 (physics_dyn.js) に乱数ゼロ。唯一の乱数 sensors.js M1 ノイズは本エンジンが強制 OFF。
//  - 処理順は car index 昇順で固定 (tickSlot → integrateSlot を frame() と同順で適用)。
//  - 入力 {course, regime, field, laps, crashRule, interact} が同一なら結果は純関数。
//  - ⚠ クロスPF 浮動小数決定論 (Math.sin/cos 等の last-ULP 差) は W1 で実測 → policy 確定。
//    verifyHash / 毎tick チェックサムでビット差を検出できるよう設計。
import { SIM, CONST, SENSOR_NOISE, SENSOR_HOLD, REGIME_STATE, REGIMES, registerCarType, SCALE_STATE, setCarScale, APP_VERSION, PHYSICS, setPhysicsMode } from './config.js';
import { applyRegime } from './physics_dyn.js';
import { carEdges } from './physics.js';
import { makeSlot, rebuildSpawns, integrateSlot, integrateFleetV2, tickSlot, othersFor, releaseDrive, applyStartGate, fitsAllCars } from './fleet.js';
import { buildController } from './runner.js';
import { buildApi } from './api.js';

// ============================================================================
// 正準検証ポリシー (W1 で実測確定・W_spec §5/§11)
// ----------------------------------------------------------------------------
// W1 実測 (2026-06-18・wf_w1_race.mjs ↔ HeadlessChrome Playwright):
//  - 再現性 (同一環境・N=3): node→node・browser→browser とも verifyHash/traceHash 完全一致。
//    ⇒ エンジンは同一環境内で完全に決定論的 (乱数ゼロ・固定刻み・固定処理順)。
//  - クロス環境 (node V8 12.x ↔ Chrome V8 147): **ビット一致しない**。
//    ・raw(整数座標)コースは構築は一致するが、fullscale 物理の毎tick 全精度状態が tick0 から分岐
//      (Math.sin/atan/sqrt/hypot 等の last-ULP が V8 版で差る)。
//    ・superellipse コースは構築(Math.cos/pow)も分岐し、閾値近傍カオス(BEH-03)で増幅され
//      **レース結果(順位/DNF)が反転**し得る (実測: node=2 完走 / browser=1 完走+2クラッシュ)。
// ⇒ 結論: 「ブラウザ結果 = 公式」は成立しない。**公式記録は固定環境の正準エンジンで判定する。**
//
// 正準エンジン = この runRace を **固定 engineVer (= 物理版 APP_VERSION) かつ固定 JS エンジン版**
//   (公式検証は pinned Node/V8) で実行したもの。検証経路:
//     公式結果 = runRace(event, frozenField)  in pinned engine → verifyHash を result に刻む。
//     第三者検証 = 同じ pinned engine で再実行 → verifyHash 一致で「検証済」(中央サーバ不要)。
//   利用者のブラウザ走行は『あなたのローカル結果(参考)』= 環境差で公式と一致しないことがある (正直表示)。
//   engineFingerprint() が実行環境を返す (記録の engineVer/exec env タグ付け・検証時の照合用)。
// この分離は W_spec §5 が予め定義した fallback そのもの (W1 実測で「必要」が確定した)。
// W3/W5/W6 がこのポリシーを UI/記録 schema/称号に適用する (W1 はエンジンとポリシーを確立)。
// ============================================================================

// 固定刻み: 60Hz (= browser frame の公称刻み・physicsHz)。W_spec §5「固定60Hz」。
export const RACE_DT = 1 / SIM.physicsHz;

// 実行環境フィンガープリント (記録の exec-env タグ付け・正準判定の照合用)。物理版は APP_VERSION
// (config) が持つ。ここでは JS エンジン同一性 (クロスPF 決定論の pin) を返す。node/browser 両対応。
export function engineFingerprint() {
  let exec = 'unknown';
  try {
    if (typeof process !== 'undefined' && process.versions) {
      exec = 'node/' + process.versions.node + ' v8/' + process.versions.v8;       // pinned 検証環境
    } else if (typeof navigator !== 'undefined') {
      exec = 'browser/' + (navigator.userAgent || '');                              // 参考(ローカル)環境
    }
  } catch (e) { /* noop */ }
  // AK2/D11: 「実行環境」だけでなく「挙動を決める要素」も含める = 記録の版照合 (record version
  // matching) が機能する。APP_VERSION は物理/モデル版で、版が変われば同一入力でも挙動が変わり得る
  // (Stage AK のように衝突モデルを正すと卓上クラッシュ系レースの軌跡が変わる) → 旧記録が現行で
  // 再現しない可能性を版で照合・明示できる。regimeK は現在の領域長さスケールのスナップショット、
  // userKDefault は公式実行が userK をこの値へ正規化する契約 (スライダー位置非依存・AK2/D10)。
  return {
    exec,
    appVersion: APP_VERSION,
    raceDt: RACE_DT, loopHz: SIM.loopHz, physicsHz: SIM.physicsHz,
    regimeK: SCALE_STATE.regimeK,
    userKDefault: 1,
    // AO5/D-AO5: 挙動を決める要素に物理エンジンを追加 (standard/dynamic/v2)。v2 は 4輪 two-track で
    // dynamic と別軌跡ゆえ、記録の版照合 (AK2/AK6) が「どのエンジンで採った記録か」を保持・照合できる
    // (canon には入れない=表示/照合メタ。verifyHash は canon のみ由来で不変)。
    physicsMode: PHYSICS.mode,
  };
}

// 決定論 32-bit FNV-1a 文字列ハッシュ。Math.random/Date 不使用 = どの環境でも同値。
export function fnv1a(str) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // h *= 16777619 (mod 2^32) をシフト和で (32bit 安全)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

// 1tick の全車状態チェックサム。Number.prototype.toString は最短往復可能な10進=double をビット一意に
// 表す → 丸めず連結することで「どこか1ビットでも違えば必ず異なる文字列」になる (分岐検出力 最大)。
function tickChecksum(slots) {
  let s = '';
  for (const sl of slots) {
    const c = sl.car;
    s += c.x.toString() + ',' + c.y.toString() + ',' + c.theta.toString() + ',' +
         ((c.u || 0)).toString() + ',' + ((c.vlat || 0)).toString() + ',' + ((c.r || 0)).toString() +
         ',' + (c.crashed ? 1 : 0) + ';';
  }
  return fnv1a(s);
}

// ============================================================================
// レース有効 timeout の自動スケール (AB2 / RC-RACE-001)。固定 180s は高周回・巨大コースで
// 事実上完走不能 (例: 卓上オーバル 1周≈17s × 30周 ≈ 510s ≫ 180s) を生む。そこで maxSec を
// 明示しない場合のみ「コース規模 × 周回数」に連動した有効 timeout を算出する。明示時 (公式記録の
// 再実行・卓上回帰 fixture) は与えた値をそのまま使う ＝ engine 挙動は maxSec を pin すれば不変
// (verifyHash 保全・byte 不変)。
//
// 設計の核 (実測キャリブレーション wf_ab2_measure.mjs):
//  - 1周見積り perLapEst = boundsPerimeter / maxSpeed(regime)。**これは領域不変**= fullscale は
//    コース寸法も最高速も比例して上がるため、卓上/フルスケールとも実測 ~16–25s/周に収まる
//    (オーバル16.3・エッセ24.0・ストリート24.8・競技サーキットFS22.5)。
//  - 実測の最遅完走ペースは perLapEst の ~2.5倍 (競技サーキットFS 56.7s vs 22.5 / ストリート 48.2 vs 24.8)
//    ＝ 安全係数 LAP_SAFETY=3.0 で完走可能ペースの車を取りこぼさない。
//  - 下限 = 旧固定既定 180s ＝ **新挙動は旧の厳密な上位集合** (時間を奪わない=旧で完走した casual を
//    退行させない・scaled<180 は完全に旧と同一)。上限 = 1800s (ストリート級30周の正当完走 ~1450s を
//    収めつつ、詰まり車の同期計算を有界化。全車 finish/DNF で早期終了するので通常レースは即抜ける)。
const RACE_TO = { STARTUP: 12, LAP_SAFETY: 3.0, PERLAP_FLOOR: 10, MIN_SEC: 180, MAX_SEC: 1800 };

// 公式記録の凍結 spec (event.json) に同梱する有効 timeout を、レース実行と同一式で算出する純関数
// (Math.random/Date 不使用=決定論)。course.bounds と regime の maxSpeed のみ参照 ＝ live globals に
// 非依存。これを event.json へ刻めば、result.json 生成 (pinned Node) と再検証 (verifyOfficialLocally)
// が同じ maxSec を渡し verifyHash が一致する (W_spec §5・CI-5)。
export function computeRaceTimeout({ course, laps = 3, regime = null }) {
  const reg = (regime && REGIMES[regime]) ? REGIMES[regime] : REGIMES.tabletop;
  const maxSpeed = reg.maxSpeed || REGIMES.tabletop.maxSpeed;   // m/s (領域の最高速)
  const b = (course && course.bounds) || { w: 3, h: 2 };
  const perim = 2 * (b.w + b.h);                                // 周回距離 proxy (領域不変・全コース型で存在)
  const perLapEst = perim / maxSpeed;                          // ~16–25s (実測・領域不変)
  const perLapBudget = Math.max(RACE_TO.PERLAP_FLOOR, perLapEst * RACE_TO.LAP_SAFETY);
  const eff = RACE_TO.STARTUP + perLapBudget * Math.max(1, laps);
  return Math.min(RACE_TO.MAX_SEC, Math.max(RACE_TO.MIN_SEC, eff));
}

// 正準レース実行。spec:
//   course   : 走行可能なコースオブジェクト (course.buildFromSpec の出力。純データ = JSON 往復可)。
//   regime   : 'tabletop'|'midscale'|'fullscale'|null。指定時 applyRegime で物理スケールを適用。
//   laps     : 完了に要する周回数 (>=1)。
//   field    : [{ name, lang:'c'|'py'|'js', src, carType?, carDef?, rear?, encoder?, tire? }]。グリッド=配列順。
//              tire='slip' は v2 エンジンのスリップ/ドリフトタイヤ (Stage AO6・v2 のみ参照・既定 normal)。
//              carDef を与えると registerCarType で登録 (持ち込み車種=full JSON・W_spec §1)。
//   crashRule: { rejoin:false→クラッシュ=DNF / true→penaltySec 加算で復帰, penaltySec:3 }。
//   interact : 他車を障害物/センサー対象に含めるか (true=対戦/false=独立TT)。
//   maxSec   : セーフティ上限秒 (未完走はこの時点で DNF=timeout)。**未指定なら computeRaceTimeout で
//              コース規模×周回数に連動スケール (AB2)**。公式記録の再実行は event.maxSec を明示して渡す
//              こと (同 maxSec ⇒ 同結果 ⇒ verifyHash 一致)。
//   trace    : true で毎tick チェックサムを収集 (node↔browser 突合用)。
// 戻り値: { finishers[], dnf[], ticks, simSec, verifyHash, traceHash, trace?, ... }。
export function runRace(spec) {
  const {
    course, regime = null, laps = 3, field,
    crashRule = { rejoin: false, penaltySec: 3 },
    interact = true, maxSec, trace = false, report = false, ghost = false,
    probe = null,   // AO10: 検証オラクル専用の毎tick観測フック probe(tick, slots)。未指定(既定 null)は完全 no-op
    //                = tickChecksum/finishers/verifyHash/traceHash を一切変えない (trace/report/ghost と同型の
    //                  「読むだけ・slots 非改変」観測・W1 byte 不変)。プログラムへ course は渡さない (D-1)。
    trackNet = false,   // AK7: 各車の spawn からの最大変位 (観測のみ=verifyHash 不変)。容量判定 (走り出せたか) に使う。
    grid = null,   // AD1: 凍結グリッド位置 [{x,y,theta},…]。null=従来の freeSpawn 算法 (byte 不変)。
    recon = null,   // AO9: 試走フェーズ {laps:N} (N=0..3)。未指定/0 は完全 no-op (既存 hash byte 不変・§8)。
    wear = false,   // AO12: タイヤ熱・摩耗モデル (opt-in・§6)。既定 false は完全 no-op (fT=fW=1=既存 hash byte 不変)。
  } = spec;
  // AO9: 試走周回数を 0..3 に正規化 (UI/event/share は 0..3 のみ渡すが再現性のため clamp=canon に載る値と一致)。
  const reconLaps = (recon && recon.laps != null) ? Math.max(0, Math.min(3, Math.round(recon.laps))) : 0;
  // maxSec 明示時はそのまま (公式再実行/fixture=byte 不変)。未指定のみスケール (AB2/RC-RACE-001)。
  const effMaxSec = (maxSec != null) ? maxSec : computeRaceTimeout({ course, laps, regime });
  if (!course || !Array.isArray(field) || field.length === 0) {
    throw new Error('runRace: course と field(>=1) が必要');
  }
  const penaltySec = (crashRule && crashRule.penaltySec != null) ? crashRule.penaltySec : 3;
  const recover = !!(crashRule && crashRule.rejoin);

  // --- 副作用の退避 (公式実行が live globals を恒久汚染しないよう終了時に復元) ---
  const noisePrev = SENSOR_NOISE.on;
  const holdPrev = SENSOR_HOLD.on;          // AP18: sample-and-hold を退避 (SENSOR_NOISE と同型・復元は finally)
  const regimePrev = REGIME_STATE.active;
  const userKPrev = SCALE_STATE.userK;      // AK2/D10: carScale スライダー位置を退避 (公式は非依存に固定)
  const physModePrev = PHYSICS.mode;        // AO5: 物理エンジンを退避 (SENSOR_NOISE/userK と同型・復元は finally)
  SENSOR_NOISE.on = false;                  // 公式は決定論 = ノイズ強制 OFF (W_spec §5)
  SENSOR_HOLD.on = false;                   // AP18: 公式は決定論 = sample-and-hold 強制 OFF (ライブ UI トグルを排除=verifyHash 不変)
  // AO5: spec.physics 指定時のみエンジンをピン留め (公式/fixture の再現性・SENSOR_NOISE と同型)。未指定は
  // 現在のグローバル PHYSICS.mode をそのまま使う (ライブ選択の尊重＝既定 dynamic の f0/f1 は byte 不変)。
  if (spec.physics != null) setPhysicsMode(spec.physics);
  // AK2/D10: 公式実行中は userK を既定(1)へ固定する。setRegimeScale/_applyScale が CAR 寸法を
  // regimeK×userK で決めるため、ブラウザのスライダー位置 (userK≠1) が混入すると同一 grid 記録でも
  // verifyHash が変わる穴があった (SENSOR_NOISE/regime は退避済だが userK だけ漏れていた)。これを
  // applyRegime より前に正規化しておく (applyRegime も userK=1 で再適用される)。
  setCarScale(1);
  if (regime) applyRegime(regime);          // 物理スケール適用 (CAR 寸法が変わる → spawn より前)

  // AK5/D8: アルゴリズム配置 (grid 無し) のとき、field がこのコース×領域の静的容量を超える
  // (領域/コース不一致で容量が縮む) と発走で団子になる。AK3 の審判 fitsAllCars (実 freeSpawn=
  // 壁交差0・前方クリア) を applyRegime 後 (=正しい CAR 寸法) で共用し、収まる台数へ減らす。
  // 凍結グリッド (公式記録/fixture) は対象外=byte 不変の忠実再現。capacity.js は実態容量を「測る」
  // 側なので fitGuard:false で本ガードを外す (団子を先に潰すと実態容量が測れない=AK7 を壊さない)。
  // 出荷の全コース×卓上は静的に 6 台収まるので減らさない=既定レース/正準は no-op (verifyHash 不変)。
  let fitField = field;
  let fitReduced = 0;
  if (grid == null && spec.fitGuard !== false) {
    let nFit = field.length;
    while (nFit > 1 && !fitsAllCars(course, nFit)) nFit--;
    if (nFit < field.length) { fitReduced = field.length - nFit; fitField = field.slice(0, nFit); }
  }

  try {
    // --- 持ち込み車種 (full JSON) を登録 ---
    for (const e of fitField) if (e.carDef && e.carDef.key) registerCarType(e.carDef);

    // --- スロット生成 (グリッド = エントリー順)。log は収集のみ (描画/DOM 非依存) ---
    const logs = [];
    const slots = fitField.map((e, i) => {
      const slot = makeSlot({
        i, lang: e.lang, src: e.src, course, slotCount: fitField.length,
        logFor: () => (msg) => logs.push({ i, msg }),
      });
      const ct = e.carType || (e.carDef && e.carDef.key) || slot.carType;
      slot.carType = ct; slot.car.type = ct;
      slot.world.rear = !!e.rear; slot.world.encoder = !!e.encoder;
      // AO6: タイヤセット (v2 エンジンのみ物理として反映)。world にも保持し swapPhysics 経路と一貫させる。
      slot.world.tire = (e.tire === 'slip') ? 'slip' : 'normal';
      if (slot.car.engine === 'v2') slot.car.tireSet = slot.world.tire;
      // AO12: タイヤ熱・摩耗 (レース全体の opt-in オプション=spec.wear。v2 のみ物理反映・§6)。
      slot.world.wear = !!wear;
      if (slot.car.engine === 'v2') slot.car.wear = !!wear;
      return slot;
    });

    // --- spawn 配置 (grid 指定なら凍結位置で忠実再現・無ければ freeSpawn 算法) + 走行開始 ---
    rebuildSpawns(slots, course, grid);
    // AD1: 実際に使った初期位置を配置データとして外部化する (result に刻めば算法非依存に再現可能)。
    const usedGrid = slots.map((s) => ({ x: s.spawn.x, y: s.spawn.y, theta: s.spawn.theta }));
    for (const s of slots) {
      s.car.reset(s.spawn);
      s.world._pendingDelay = 0; s.world._others = [];
      s.hostEnv = buildApi(s.world);        // rear/encoder 反映後の hostEnv (startAuto 同様に再構築)
      s.lap.reset(course, { carType: s.carType, persist: false }); // 公式=練習記録 localStorage に書かない (W2/W_spec §0)
      try {
        s.controller = buildController(s.src, s.lang, s.hostEnv);
        s.controller.setup();
        s.running = true; s.loopTimer = 0;
      } catch (err) {
        logs.push({ i: -1, msg: 'setup error: ' + (err && err.message || err) });
        s.controller = null; s.running = false;
      }
    }

    // --- Stage AO9: 試走フェーズ (spec.recon) ---
    // 各車を index 昇順に単独 N 周 (interact 強制 OFF・othersFor 空・計時外・打ち切り=DNF にしない) 走らせ、
    // controller を再構築せず car/lap のみグリッドへ戻す = interp.global(学習地図)を本番へ持ち込む。
    // recon 未指定 (N=0) は完全 no-op = 既存全ハッシュ byte 不変 (f0/f1/f2/f3)。決定論: 同一 spec →
    // 同一試走 → 同一本番開始状態。地図を使うプログラム(recon_racer 等)は本番1周目から phase=1 で走る
    // (試走なしは1周目が学習 phase=0)=「recon あり/なしで1周目挙動差」が観測できる (§12 AO9)。
    if (reconLaps > 0) {
      // 予算: 1台 N 周ぶんの通常タイムアウト。超過は打ち切り (部分地図のまま本番=正直・DNF にしない)。
      const reconMaxTicks = Math.max(1, Math.ceil(computeRaceTimeout({ course, laps: reconLaps, regime }) / RACE_DT));
      for (let ci = 0; ci < slots.length; ci++) {
        const s = slots[ci];
        if (!s.controller) continue;   // setup 失敗車は試走せず (本番で DNF 扱い=no-recon と同一)。
        for (let rt = 0; rt < reconMaxTicks && s.running; rt++) {
          // 1) プログラム tick (loopHz ゲート・delay 反映) = 本番ループと同一構造 (単独=others 空)。
          s.loopTimer -= RACE_DT;
          if (s.loopTimer <= 0) {
            tickSlot(s, []);
            s.loopTimer += (1 / SIM.loopHz) + (s.world._pendingDelay || 0) / 1000;
          }
          // 2) 物理積分 (単独・interact=false)。v2 は全車同時積分を1台で (壁のみ)・他は原子棄却。
          if (PHYSICS.mode === 'v2') integrateFleetV2([s], RACE_DT, course.walls, recover, false);
          else integrateSlot(s, RACE_DT, [], course.walls, recover);
          if (s.lap.laps >= reconLaps) break;   // N 周到達で試走終了。
        }
        // グリッド復帰: car/lap を戻す (controller は再構築しない=学習地図保持)。本番開始状態を no-recon
        // 経路と byte 一致させるため v2 のスタック検出トランジェント _stuckT もクリア (car.reset は
        // recoverT/crashed 等は消すが _stuckT/_stuckX/_stuckY は消さない=本ブロックでのみクリア=physics 非改変)。
        s.car.reset(s.spawn);
        s.car._stuckT = 0; s.car._stuckX = s.car.x; s.car._stuckY = s.car.y;
        s.world._pendingDelay = 0; s.world._others = [];
        s.lap.reset(course, { carType: s.carType, persist: false });
        s.running = true; s.loopTimer = 0;
      }
    }

    // --- 決定論ループ (固定 DT・処理順 = car index 昇順) = frame() の running/非paused 分岐 ---
    const n = slots.length;
    const maxTicks = Math.max(1, Math.ceil(effMaxSec / RACE_DT));
    const finished = new Array(n).fill(null);
    const dnf = new Array(n).fill(null);
    const bestLapMs = new Array(n).fill(null);
    const crashCount = new Array(n).fill(0);
    const prevRecoverT = new Array(n).fill(0);
    const prevLaps = new Array(n).fill(0);
    const netMax = trackNet ? new Array(n).fill(0) : null;   // AK7: spawn からの最大変位 (走り出せたか)
    const armMax = trackNet ? new Array(n).fill(0) : null;   // AK7: recoverN ピーク (リカバリ発散検査用)
    const traceArr = trace ? [] : null;

    // レースレポート telemetry (W3・観測のみ・物理非干渉)。摩擦円使用率ピーク・|β|ピーク・初回
    // クラッシュ世界座標を集める。**car 状態を読むだけで slots を一切変えない** ので、report の
    // 有無に関わらず tickChecksum/finishers/dnf は同一 = verifyHash/traceHash は不変 (W1 byte 不変)。
    const muPeak = new Array(n).fill(0);     // 摩擦円使用率ピーク (0..1+ ・ξ=hypot(fx/Fx,fyd/Fy))
    const betaPeak = new Array(n).fill(0);   // |β| ピーク [deg] (β=atan2(vlat,u))
    const crashAt = new Array(n).fill(null); // 初回クラッシュ世界座標 {x,y,tick} (適不適の可視化)
    const isDyn = new Array(n).fill(false);  // dynamic 車か (μ円/β を持つ。kinematic は null 表示)

    // ゴーストリプレイ用の軌跡サンプリング (W6・観測のみ・物理非干渉)。一定 tick ごとに全車の
    // {x,y,theta,crashed,laps} を読むだけ = slots を一切変えない ので report/trace と同様に
    // verifyHash/traceHash は ghost の有無で不変 (W1 byte 不変を維持・CI-5)。frame 間隔は GHOST_EVERY
    // tick (≒12Hz) でリプレイを滑らかにしつつ配列を小さく保つ。クロスPF 差はゴースト=視覚参照で許容
    // (公式順位は §5 正準エンジン・W_spec §8)。
    const GHOST_EVERY = Math.max(1, Math.round(SIM.physicsHz / 12));
    const ghostFrames = ghost ? [] : null;

    let tick = 0;
    for (; tick < maxTicks; tick++) {
      const edges = slots.map((s) => carEdges(s.car));

      // 1) プログラム tick (index 昇順・loopHz ゲート・delay 反映) — frame() と同一
      slots.forEach((s, i) => {
        if (!s.running) return;
        s.loopTimer -= RACE_DT;
        if (s.loopTimer <= 0) {
          tickSlot(s, othersFor(edges, i, interact));
          s.loopTimer += (1 / SIM.loopHz) + (s.world._pendingDelay || 0) / 1000;
        }
      });
      // Stage AK7: 発走の順次化 (anti-pile-up)。積分前に全車の held を更新 (frame() と同一機構=一つのモデル)。
      // 正準 f0/f1 はグリッド横並び=held に入らない構造 no-op ⇒ verifyHash 不変 (CI-7 ハードゲート)。
      applyStartGate(slots, interact);
      // 2) 物理積分 (index 昇順・全スロット) — frame() と同一 (crashed は integrateSlot 内で不動)。
      // Stage AO4: mode==='v2' は全車同時積分＋インパルス接触 (integrateFleetV2)。dynamic/standard は
      // 従来の 1台ずつ原子棄却 (integrateSlot) を **byte 不変** で維持 (guarded branch=canonical f0/f1 不変)。
      if (PHYSICS.mode === 'v2') integrateFleetV2(slots, RACE_DT, course.walls, recover, interact);
      else slots.forEach((s, i) => integrateSlot(s, RACE_DT, othersFor(edges, i, interact), course.walls, recover));

      // AK7: spawn からの最大変位・recoverN ピークを観測 (容量判定/リカバリ検査用・読み取りのみ=verifyHash 不変)。
      if (trackNet) slots.forEach((s, i) => {
        const nn = Math.hypot(s.car.x - s.spawn.x, s.car.y - s.spawn.y); if (nn > netMax[i]) netMax[i] = nn;
        if ((s.car.recoverN || 0) > armMax[i]) armMax[i] = s.car.recoverN;
      });
      // 3) レース判定 (観測のみ・物理非干渉)
      slots.forEach((s, i) => {
        // クラッシュ計数: recoverT が増加 (=新規復帰開始で 0.7 にセット) した tick を1回と数える。
        // recoverT は通常 dt ずつ減るだけなので「増加」が復帰開始を一意に表す (端境ケースも捕捉)。
        if (recover && s.car.recoverT > prevRecoverT[i] + 1e-9) {
          crashCount[i]++;
          if (report && crashAt[i] == null) crashAt[i] = { x: s.car.x, y: s.car.y, tick };
        }
        prevRecoverT[i] = s.car.recoverT;
        // DNF (rejoin=false): crashed 遷移を1回だけ記録
        if (!recover && s.car.crashed && dnf[i] == null && finished[i] == null) {
          dnf[i] = { lapsCompleted: s.lap.laps, tick, reason: 'crash' };
          if (report) crashAt[i] = { x: s.car.x, y: s.car.y, tick };
        }
        // レースレポート: 摩擦円使用率/β のピークを観測 (dynamic 車のみ・読み取り専用)。
        if (report && s.car.u !== undefined && s.car._muUseF != null) {
          isDyn[i] = true;
          // 衝突瞬間は容量がほぼ0で demand 巨大 → ξ が桁あふれするので 9.99(=999%) で頭打ち
          // (報告の可読性。物理へは読み戻さない=不変)。150% 超で既に「限界を大きく超え滑走」を意味する。
          const mu = Math.min(9.99, Math.max(s.car._muUseF, s.car._muUseR));
          if (mu > muPeak[i]) muPeak[i] = mu;
          if (Math.abs(s.car.u) > 0.03 || Math.abs(s.car.vlat) > 0.03) {
            const b = Math.abs(Math.atan2(s.car.vlat, s.car.u) * 180 / Math.PI);
            if (b > betaPeak[i]) betaPeak[i] = b;
          }
        }
        // ベストラップ: 周回が増えた tick の lastLap を採る
        if (s.lap.laps > prevLaps[i]) {
          const lt = s.lap.lastLap;
          if (lt != null && (bestLapMs[i] == null || lt * 1000 < bestLapMs[i])) bestLapMs[i] = lt * 1000;
          prevLaps[i] = s.lap.laps;
        }
        // フィニッシュ: 目標周回到達 → 駆動解除 (以後は惰行・タイム凍結)
        if (finished[i] == null && dnf[i] == null && s.lap.laps >= laps) {
          finished[i] = { tick, totalTimeMs: s.lap.totalTime * 1000 };
          s.running = false; s.car.driveDir = CONST.FREE; s.car.pwm = 0;
        }
      });

      // ゴースト軌跡サンプリング (観測のみ・slots 不変)。tick0 (グリッド) から GHOST_EVERY 間隔。
      if (ghost && (tick % GHOST_EVERY === 0)) {
        ghostFrames.push(slots.map((s) => ({
          x: s.car.x, y: s.car.y, th: s.car.theta,
          crashed: !!s.car.crashed, laps: s.lap.laps,
        })));
      }

      if (trace) traceArr.push(tickChecksum(slots));
      // AO10: 検証オラクル観測 (probe があるときだけ・読むだけ)。真の弧長 (car.x/y から) と
      //       プログラムの自己位置推定 (controller.interp.global.vars) を突合するために毎tick呼ぶ。
      //       probe==null の本番/正準は分岐に入らない=byte 不変 (trace と同じ末尾観測点)。
      if (probe) probe(tick, slots);

      // 終了: 全車が finish か dnf
      if (slots.every((s, i) => finished[i] != null || dnf[i] != null)) { tick++; break; }
    }

    // --- 順位確定 ---
    releaseDrive(slots);
    const finishers = [];
    slots.forEach((s, i) => {
      if (!finished[i]) return;
      const pen = recover ? crashCount[i] * penaltySec : 0;
      finishers.push({
        idx: i, name: field[i].name, carType: s.carType, laps,
        totalTimeMs: finished[i].totalTimeMs, bestLapMs: bestLapMs[i],
        penaltiesSec: pen, classifiedMs: finished[i].totalTimeMs + pen * 1000,
        finishTick: finished[i].tick,
      });
    });
    // 公式順位 = classified time (総時間+ペナルティ) 昇順・タイブレーク idx
    finishers.sort((a, b) => (a.classifiedMs - b.classifiedMs) || (a.idx - b.idx));
    finishers.forEach((f, k) => { f.rank = k + 1; });

    const dnfList = [];
    slots.forEach((s, i) => {
      if (finished[i]) return;
      const info = dnf[i] || { lapsCompleted: s.lap.laps, reason: 'timeout' };
      dnfList.push({ idx: i, name: field[i].name, carType: s.carType,
        lapsCompleted: info.lapsCompleted, reason: info.reason });
    });
    dnfList.sort((a, b) => (b.lapsCompleted - a.lapsCompleted) || (a.idx - b.idx));

    // verifyHash: 結果の正準直列化 (ms 丸め・順位・周回・ペナルティ)。誰でも再実行して1値で照合可。
    const canonObj = {
      course: course.name, regime: regime || regimePrev, laps,
      crashRule: { rejoin: recover, penaltySec }, interact,
      finishers: finishers.map((f) => [f.rank, f.name, f.carType, Math.round(f.totalTimeMs),
        f.bestLapMs != null ? Math.round(f.bestLapMs) : null, f.penaltiesSec]),
      dnf: dnfList.map((d) => [d.name, d.carType, d.lapsCompleted, d.reason]),
    };
    // AO5: 物理エンジンを canon に含めるのは **非既定 (v2/standard) のときだけ** (AD1 grid 前例と同型)。
    // 既定 dynamic は末尾キーを付けない = 既存全ハッシュ (f0/f1 等) が byte 完全不変。v2/standard の公式記録は
    // physics キーで dynamic と別ハッシュになり (同コースでも別軌跡=別結果ゆえ正しい)、再実行で照合できる。
    if (PHYSICS.mode !== 'dynamic') canonObj.physics = PHYSICS.mode;
    // AO6: タイヤセットを canon に含めるのは **slip 装備車が居るときだけ** (physics/grid 前例と同型)。全車 normal は
    // 末尾キーを付けない = AO7 の f2 (v2×normal) 等 既定タイヤ記録が byte 不変。slip 記録は別ハッシュで決定論。
    const tires = fitField.map((e) => (e && e.tire === 'slip') ? 'slip' : 'normal');
    if (tires.some((tt) => tt === 'slip')) canonObj.tire = tires;
    // AO9: 試走 (spec.recon) を canon に含めるのは N>0 のときだけ (physics/tire/grid 前例と同型・末尾追加)。
    // 未指定/0 は末尾キーを付けない = 既存全ハッシュ (f0/f1/f2/f3) byte 完全不変。recon>0 は学習地図で
    // 本番挙動が変わり別ハッシュ (同コースでも別結果=正しい)、再実行で照合できる (自己記述的・§7)。
    if (reconLaps > 0) canonObj.recon = reconLaps;
    // AO12: タイヤ熱・摩耗を canon に含めるのは wear:true のときだけ (physics/tire/recon 前例と同型・末尾追加)。
    // 既定 false は末尾キーを付けない = 既存全ハッシュ (f0/f1/f2/f3) byte 完全不変。wear:true は摩耗で
    // 本番挙動が変わり別ハッシュ (同コースでも別結果=正しい)、再実行で照合できる (自己記述的・§7)。
    if (wear) canonObj.wear = true;
    const canon = JSON.stringify(canonObj);
    const verifyHash = fnv1a(canon);

    // レースレポート (W3): フィールド順 (= グリッド順) で 1 台 1 オブジェクト。順位/タイムは finishers
    // を使い、ここは「適不適の手がかり」= 周回数・摩擦円使用率ピーク・|β|ピーク・クラッシュ地点を持つ。
    const reportArr = report ? slots.map((s, i) => ({
      idx: i, name: field[i].name, carType: s.carType,
      lapsCompleted: s.lap.laps,
      finished: finished[i] != null,
      dynamic: isDyn[i],
      muPeakPct: isDyn[i] ? Math.round(muPeak[i] * 100) : null,
      betaPeakDeg: isDyn[i] ? Math.round(betaPeak[i]) : null,
      crashed: crashAt[i] != null,
      crashCount: recover ? crashCount[i] : (crashAt[i] != null ? 1 : 0),
      crashX: crashAt[i] ? crashAt[i].x : null,
      crashY: crashAt[i] ? crashAt[i].y : null,
      finalX: s.car.x, finalY: s.car.y,
    })) : null;

    return {
      finishers, dnf: dnfList, ticks: tick, simSec: tick * RACE_DT,
      grid: usedGrid,   // AD1: 実際の初期位置 (配置データ)。result に刻めば算法非依存に再現可能。
      // AK7: 容量判定用 (観測のみ)。各車の spawn からの最大変位 / recoverN ピーク / クラッシュ有無。trackNet=false なら null。
      netMax, armMax, carCrashed: trackNet ? slots.map((s) => !!s.car.crashed) : null,
      verifyHash,
      traceHash: trace ? fnv1a(traceArr.join('|')) : null,
      trace: trace ? traceArr : null,
      report: reportArr,
      ghost: ghost ? {
        every: GHOST_EVERY, dt: RACE_DT * GHOST_EVERY,
        names: fitField.map((e) => e.name),
        carTypes: slots.map((s) => s.carType),
        frames: ghostFrames,
      } : null,
      logsCount: logs.length,
      fitReduced,   // AK5/D8: 静的容量超過で減らした台数 (0=減らさず=既定/正準。呼出側が告知に使える)
    };
  } finally {
    // --- live globals 復元 (公式実行の副作用を残さない) ---
    SENSOR_NOISE.on = noisePrev;
    SENSOR_HOLD.on = holdPrev;                // AP18: sample-and-hold を復元

    if (regime && regimePrev) applyRegime(regimePrev);
    setCarScale(userKPrev);                  // AK2/D10: スライダー位置を復元 (regime 復元後に再適用=最終状態を厳密復元)
    setPhysicsMode(physModePrev);            // AO5: 物理エンジンを復元 (spec.physics 未指定なら no-op=元と同値)
  }
}
