// Stage AZ6 — フィットガードの**判定コア**（DOM に触れない単位）。
//
// なぜ分離したか（AZ2 の層 4 敵対的検証の指摘・2026-09-12 実測）:
//   `enforceFitRatio` は `$('regimeSel')` / `$('carScale')` / `logLine` / `rebuildSpawns` と結合していたため
//   node から呼べず、常設ゲート `wf_az2_fitguard.mjs` は **判定順序の写し**を持たざるを得なかった。
//   ∴ ゲートの A)〜C) は **product の main.js を 1 行も実行しない**（写しが緑でも product が壊れていてよい）。
//   構造検査（正規表現）で隙間を埋めていたが、「呼ばれる関数の中身の意味変更」は原理的に捕まえられない。
//   本モジュールは **main.js（ライブ）とゲートの両方が呼ぶ唯一の判定**である（CI-9「再実装しない」を
//   判定ロジックそのものにも適用する）。
//
// 分け方: **判定（純粋）と適用（DOM・イベント）を分ける。**
//   ・判定 = 「どの領域・どの carScale・何台に落ち着くか」＝本モジュール。
//   ・適用 = セレクタの値を書き、change を発火し、スライダー/ラベルを同期し、ログを出す＝呼び出し側。
//   適用は**注入されたフック `fx` 経由**で、判定が効果を必要とするその瞬間に呼ぶ。こうすると
//   **領域変更が出す行（`fx.regime` → change ハンドラのログ）との相対位置が改修前と同じ**になる。
//   順序を後から組み立て直す設計（イベント列を返して呼び出し側が流す）にすると、この相対位置が崩れる。
//   ⚠ **「改修前と 1 対 1 で一致する」とは言えない。** carScale の告知は下記のとおり AZ6 で意図的に
//   「最後の 1 回」へ寄せたので、行数が減るセルがある（常設ゲート `wf_az2_fitguard.mjs` の A) が
//   「AZ6-告知1本化」として全件を分類し、件数を出す）。変えていないのは**落ち着き先と相対順序**である。
//
// 本モジュールが触ってよいグローバルは **CAR 寸法（config.js の SCALE_STATE 経由）だけ**。
// `fx.regime()` / `fx.scale()` が実際にスケールを適用し、本モジュールは適用後の `CAR.length` を読む。
import { CAR, FLEET } from './config.js';
import { fitsAllCars, capacityOf } from './fleet.js';
import { driveableCapN } from './capacity.js';

export const FIT = {
  // 代理量（安い前段のふるい）: 実効車長の上限 = proxyFrac × 外形最小辺。Stage U/BUG-02 と同一閾値。
  proxyFrac: 0.25,
  // 【AZ6・2026-09-12 是正】carScale の下限を **UI スライダーの min と一致させた**。
  //   旧: ③④ が `Math.max(0.4, …)` まで下げる一方 `index.html:695` のスライダーは `min="0.5"`。
  //   Chromium は `csEl.value = "0.4"` を **"0.5" に丸める**ので、SCALE_STATE.userK=0.4 ／ DOM="0.5" ／
  //   表示ラベル="0.4×" の **三重のズレ**が残り、直後の再クランプが「実状態 0.4 なのに 0.5」を読んでいた
  //   （AZ2 の層 4 レビューが実測: 病的コースで `log.autoCarScale`「0.4×」が 2 回出る）。
  //   下限は **UI の契約（スライダーが出せる最小値）** が正なので、そちらへ合わせる。
  //   `config.js:setCarScale` のハードクランプ 0.4 は**プログラム値に対する防御**として残す。UI 経路からは
  //   0.4 に到達しない — `setCarScale` の呼び出しは実測 5 箇所（2026-09-13・public/js 配下を grep）で、
  //   `main.js:1376`（本ガードの fx.scale）・`main.js:2188`（スライダーの input）・`main.js:2777`（起動時にスライダー値を反映）・
  //   `race_engine.js:193`（公式は ×1 へ正規化）・`race_engine.js:560`（同・復元）。スライダー由来の 3 箇所は `min="0.5"` に縛られ、
  //   race_engine は 1 と退避値しか渡さない。∴ 0.4 を渡しうるのは本ガードだけで、その本ガードが下限を 0.5 にした。
  //   一致の機械確認は `wf_az2_fitguard.mjs` の D) が `index.html` の min と突き合わせる。
  userKMin: 0.5,
  step: 0.1,
  // ① 上方向（フルスケール設計の大型コース）の発火条件。
  bigCourseMinDim: 50,
};

// 0.1 刻みの丸め（③④ で共用。浮動小数の桁落ちを 1 箇所に閉じる）。
const step10 = (v) => Math.round(v * 10) / 10;

/**
 * 領域と carScale の確定（①〜④'）。**DOM に触れない。**
 * 収容台数（⑤⑥）まで要るときは `settleFitRatio` を使う。スケールだけ要る検査はこちらを呼ぶ
 * （収容オラクルを呼ばないぶん安い）。
 *
 * @param {object} course  正規化済みコース（bounds/walls/start/noRace）
 * @param {object} ctx     { regime, userK, slotCount, reason }  ＝ 判定の入力状態
 * @param {object} fx      効果フック（呼び出し側が実際の適用を行う）
 *   fx.regime(name, logKey, params)  領域を name にし、logKey を告知してから副作用（物理差替等）を適用する。
 *                                    **適用後に CAR 寸法が name のスケールになっていること**が契約。
 *   fx.scale(userK) -> k             carScale を適用し実効ユーザー倍率 k を返す（DOM 同期はしない）。
 *   fx.sync(k, userK)                スライダー値/表示ラベル/スポーンを補正後の値へ追従させる。
 *   fx.log(key, params)              1 行告知する。
 * @returns {object} { regime, userK }
 */
export function settleScale(course, ctx, fx) {
  const b = course.bounds || { w: 0, h: 0 };
  const minDim = Math.min(b.w, b.h);
  const noRace = course.noRace === true;
  const target = FIT.proxyFrac * minDim;   // 実効車長の上限（過大判定の境界）
  const name = course.name;
  let regime = ctx.regime;
  let userK = ctx.userK;
  const userK0 = ctx.userK;                // ④' の復元用（利用者が指定した倍率）

  // 判定不能な入力では**何もしない**（効果フックも呼ばない）。`minDim <= 0` だと代理量 target が 0 になり、
  // ② が必ず真・③ が必ず下限まで縮めるので、**黙って 0.5 へ縮めて「縮小しました」と告知する**という
  // 一番やってはいけない振る舞いになる（実測 2026-09-13: bounds 欠損／minDim=0 の両方で再現）。
  // 呼び出し側（main.js）にも同じガードはあるが、**判定コアが入力を選ばない純関数を名乗る以上ここにも要る**
  // ——`settleScale` は常設ゲート 3 本からも直接呼ばれる。
  if (!(minDim > 0)) return { regime, userK };

  // ① 上方向: フルスケール設計の大型コースは領域を fullscale へ（微小車=比率おかしいを防ぐ）。
  if (noRace && minDim >= FIT.bigCourseMinDim && regime !== 'fullscale') {
    regime = 'fullscale';
    fx.regime('fullscale', 'log.autoFullscale', { name });
  }

  // ② 下方向: 通常コースで領域 fullscale のまま過大なら卓上へ自動復帰（手動選択も必ず補正）。
  if (!noRace && regime === 'fullscale' && CAR.length > target) {
    regime = 'tabletop';
    fx.regime('tabletop', 'log.autoTabletop', { name });
  }

  // 【AZ6・2026-09-13】**carScale の告知とスライダー同期は「最後に 1 回」へ寄せた。**
  //   旧実装は ③ と ④ がそれぞれ `log.autoCarScale` を出し、④' 後の再クランプでさらに出していたため、
  //   1 回の判定で **途中経過が複数行**流れていた（AZ2 の層 4 レビューが実測: 病的コースで「0.4×」が 2 回）。
  //   下の ④' の復元を入れると、これは単なる冗長ではなく **矛盾する 2 行**になる（「0.5× に縮小しました」
  //   と出した直後に 0.8× へ戻す）。∴ 判定中はスケールを当てるだけにし、**入口の倍率から実際に縮んだか**を
  //   最後に 1 回だけ告知する（「押しても開かないのに『開きました』と言わない」AZ1 と同じ型）。
  let scaleK = null;                     // 最後に適用した実効倍率（null = 一度も当てていない）
  const applyUserK = (v) => { userK = v; scaleK = fx.scale(v); };

  // ③ carScale クランプ（代理量）: 領域確定後もなお過大なら、収まる最大のユーザー倍率へ自動で縮める。
  const clampByProxy = () => {
    if (!(CAR.length > target)) return;
    if (!(userK > 0)) return;
    const lenAtUserK1 = CAR.length / userK;              // = baseLen × regimeK（現領域）
    const maxUserK = target / lenAtUserK1;               // これ以下なら必ず収まる
    // step 0.1 へ切り下げる。**下限で床打ちするので「必ず target 以下」にはならない**
    // （`maxUserK < FIT.userKMin` のときは下限のまま＝代理量では収まらない。そこから先は ④ の実態判定と
    //   ④' の領域フォールバックが引き取る）。AZ2 以前から続く設計で、旧注記の「必ず」は誤りだった。
    const newUserK = Math.max(FIT.userKMin, Math.floor(maxUserK * 10) / 10);
    if (newUserK < userK) applyUserK(newUserK);
  };

  // ④ N台フィット保証（Stage AG・GitHub #26 §3/§7・CI-14）: 単独車が target に収まっても FLEET.maxCars 台が
  //   収まるとは限らない。代理量でなく実態（実 freeSpawn で全車交差ゼロ）で判定し、収まるまで 0.1 刻みで
  //   下限まで追加縮小する。
  //   戻り値は **「この関数が何もせずに済んだか」**: `true` = 入口の判定で既に maxCars 台が収まっていた、
  //   `null` = それ以外（縮小した／userK が下限で評価していない）。④' がこれを見て、`true` のときは
  //   オラクルを一切呼ばずに素通りする。
  //   **確かめていないことを true と言わない**（下限では `fitsAllCars` を呼ばないので `null`＝不明）。
  const clampByFit = () => {
    if (!(userK > FIT.userKMin + 1e-9)) return null;
    if (!fitsAllCars(course, FLEET.maxCars)) {
      while (userK > FIT.userKMin + 1e-9 && !fitsAllCars(course, FLEET.maxCars)) {
        applyUserK(Math.max(FIT.userKMin, step10(userK - FIT.step)));
      }
      return null;   // 縮小後に収まったかは不明（短絡で評価しない場合がある）
    }
    return true;     // 実際に fitsAllCars が真だった = ④' は判定不要
  };

  clampByProxy();                // ③
  const fits6 = clampByFit();    // ④

  // ④' 実態収容ゼロの救済（Stage AZ2・利用者投稿コースで露見・CI-14「判定基準は代理量でなく実態」）。
  //   ②③④ がそろって「収まる」と判定しても、**実際には 1 台も置けない**構成が実在する（外形が広くても
  //   廊下が狭ければ収容ゼロはありうる）。∴ 実態（`fitsAllCars(course,1)`）が偽なら領域を卓上へ落として
  //   ③④ をやり直す（ループではなく 1 回の判定。卓上まで落とせばそれ以上下げる領域が無いため）。
  //   **限界**: noRace（① が意図して fullscale に固定する大型コース）と、既に卓上の場合は対象外。
  //   （`noRace` 側は `normalizeCourse` が写さないので投稿/保存/編集コースは持てず、出荷 2 本は実測で
  //     capN≥1 ＝到達不能。決定ログ AZ-5）
  if (!noRace && regime !== 'tabletop' && fits6 !== true && !fitsAllCars(course, 1)) {
    regime = 'tabletop';
    fx.regime('tabletop', 'log.autoTabletopFit', { name });
    // 【AZ6・2026-09-13 是正】**卓上へ戻す前に、利用者が指定した倍率へ carScale を復元する。**
    //   ② の経路（代理量で領域を落とす）は ③④ より**前**に領域を落とすので carScale が保たれるのに、
    //   ④' の経路は ③④ が**先に**下限まで削ってしまうため復元されず、同じコースで
    //   スライダー 0.8 → 車長 0.076m ／ 2 → 0.380m と **5 倍の不連続**が出ていた（実測 2026-09-13・
    //   治具「外形 18×18m・閉じた廊下 0.30m」。しかも 0.8 は UI の既定値）。
    //   復元してから ③④ をやり直せば、④' は ② と**同じ意味**になる（＝落とした領域で測り直す）。
    //   ③④ は縮める方向にしか動かないので、復元しても「収まらないのに大きいまま」にはならない。
    if (userK !== userK0) applyUserK(userK0);
    clampByProxy();
    clampByFit();
  }

  // carScale の確定と告知（1 回だけ）。入口の倍率から実際に縮んだときにのみ出す。
  if (scaleK !== null && userK !== userK0) {
    fx.sync(scaleK, userK);
    fx.log('log.autoCarScale', { name, scale: scaleK.toFixed(1) });
  } else if (scaleK !== null) {
    // 途中で当てたが入口と同じ値へ戻った（④' の復元）。状態は合わせるが告知はしない（変化が無いため）。
    fx.sync(scaleK, userK);
  }

  return { regime, userK };
}

/**
 * フィットガードの判定全体（①〜⑥）。`settleScale` で領域と carScale を確定させてから、
 * ⑤⑥ で実態の収容台数を決める。**DOM に触れない。**
 * 引数・フックは `settleScale` と同じ。戻り値に収容の判定が加わる。
 * @returns {object} { regime, userK, capN, capZeroStatic, capZeroDrive, capZero, zeroKey, zeroKeyOnly }
 */
export function settleFitRatio(course, ctx, fx) {
  const { regime, userK } = settleScale(course, ctx, fx);

  // ⑤ 実態の収容容量で台数を持つ（Stage AK・GitHub #26 D6/D7・CI-14）。
  //   代理量でなく実態（実 fitsAllCars = 実 freeSpawn/checkCollision/carEdges）で「実際に壁交差0・
  //   重なり0で走り出せる最大台数」capN を測る。**0 を返せる共有オラクル `capacityOf` を使う**
  //   （`while (capN > 1 && …)` の形は「1 台は必ず置ける」という仮定を構文に埋め込むので書かない）。
  let capN = capacityOf(course, FLEET.maxCars);            // 0..maxCars
  let capZeroStatic = capN < 1;
  let capZeroDrive = false;

  // ⑥ 実態容量へ更に絞る（Stage AK7・CI-14）: 静的に置けても normal_fr が単独でコーナー壁へ舵を切り込んで
  //   楽め込むコースがあり、静的幾何では正常スポーンと区別不可。よって卓上は **実走で「実際に走り出せる
  //   最大台数」**（発走順次化ゲート込み・`driveableCapN`）へ絞る。実走は重いので carScale ドラッグでは避ける。
  //   fullscale/midscale は専用コース×凍結グリッドで判定述語の母体外＝静的のまま。
  //
  //   **【AZ6・2026-09-13】既定の 1 台編成にも実走ゼロの告知を届かせた。**
  //   旧実装は `slots.length > 1` で落としており、その理由として「単独車は楽め込み（他車に押される）が
  //   原理上起きない」と書かれていた。**この理由は AZ5 が見つけた失敗モードを説明していない** — 「閉じた
  //   部屋で 1 台が自力で動けない」は他車と無関係に起きる（実測: 幅 4×車幅 × 奥行 1.7×車長 の部屋で
  //   静的 `capacityOf`=3・`stuckAtN(1)`=1 なのに無言。🏁 も `capacityOf(course,1)`=1 なので NO_ROOM に
  //   ならず「0台完走 / 1台リタイア」だけが出る）。∴ 理由を実態へ書き直したうえで 1 台へ広げる。
  //   **ただし発走直前（reason==='race'）に限る。** 1 台ぶんの実走プローブの実測コスト（2026-09-13・
  //   出荷 66 コース卓上）は中央値 18.8ms・最大 90.6ms で、コース選択のたびに払うと UI の目安 50ms を
  //   超えるケースが出る。▶ / 🏁 の直前なら「これから数秒走る」ので払える。これで**既定 1 台の利用者も
  //   走らせる前に必ず知る**。多台の分岐は従来どおり（発火条件・呼び出し回数とも不変）。
  const regNow = regime;
  if (!capZeroStatic && regNow === 'tabletop' && ctx.reason !== 'carScale' && capN > 1 && ctx.slotCount > 1) {
    const drv = driveableCapN(course, regNow, capN);        // 0..capN（AZ5: 0 を返せる）
    if (drv < 1) capZeroDrive = true; else capN = Math.min(capN, drv);
  } else if (!capZeroStatic && regNow === 'tabletop' && ctx.reason === 'race' && capN >= 1) {
    // **この分岐は「上が走らなかったとき」に効く**＝実際に並ぶのが 1 台になるケース:
    //   ・編成が 1 台（既定）           … ctx.slotCount <= 1
    //   ・静的収容が 1 台（⑤ が 1 へ減らす）… capN === 1（**兄弟の穴**: 多台編成でもここへ落ちる。
    //     旧条件 `ctx.slotCount <= 1` だけだと、3 台編成 × capN=1 のとき「最大 1 台しか走り出せません」
    //     と言いながら、その 1 台が動けるかを一度も測っていなかった）
    // 1 台ぶんだけ測る（`driveableCapN` のキャッシュは maxN を鍵に含むので多台の結果と混ざらない）。
    if (driveableCapN(course, regNow, 1) < 1) capZeroDrive = true;
  }

  const capZero = capZeroStatic || capZeroDrive;
  if (capZero) capN = 1;                                   // 0 台は表示できないので 1 に留める（告知は必ず出す）
  const zeroKey = capZeroDrive ? 'log.capZeroDriveWarn' : 'log.capZeroWarn';
  // **【AZ6】減らす台数が無い経路（既に 1 台・走行中で splice しない）は別の文言を使う。**
  //   `zeroKey` は「台数を {was} 台から {n} 台にします」と必ず言うので、減らしていない経路へ流すと
  //   「1 台から 1 台にします」という無意味な文になり、走行中なら**していない台数変更を告げる嘘**になる。
  //   AZ6 で ⑥ の告知を既定の 1 台編成へ広げたことでこちらが主経路になった。
  const zeroKeyOnly = capZeroDrive ? 'log.capZeroDriveWarnOnly' : 'log.capZeroWarnOnly';

  return { regime, userK, capN, capZeroStatic, capZeroDrive, capZero, zeroKey, zeroKeyOnly };
}
