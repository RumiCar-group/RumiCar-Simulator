// wf_bl1_ui.mjs — Stage BL（UI 不具合）の常設ゲート。BL1 が新設し、BL2〜BL7 が章を足す（A＝BL1・B＝BL2・C〜F＝BL3・G＝BL4・H/I＝BL5・J＝BL6・K＝BL7）。
// ════════════════════════════════════════════════════════════════════════════
// 本番モジュールを import して答えさせる（再実装しない・CI-9）。実ブラウザでしか測れない部分は
// browser/check_bl<n>_*.mjs（run_all.sh が glob で拾う）。
//
// A) BL1 質問・提案（💬）の NG ワード判定 — public/js/moderate.js の moderate()（main.js の askSendBtn が呼ぶ唯一の判定）。
//    是正前（ad5ddd1＝v10.3.0）は main.js の中の NG 語を `includes` で部分一致させていたため、アプリ自身の語彙
//    「カスタム車種」（カス）・「cockpit」（cock）・「Essex」「Sussex」（sex）・「Dickens」（dick）・「die hard」（"die "）・
//    「スカスカ」（カス）が拒否された。A-1 の通過表（PLAN BL1 の 9 行＋設計で決めた規則の行）と A-2 の拒否表
//    （product の NG_WORDS の全語から機械生成・語ごとに複数の文）と A-3 の URL 過多・A-4 の配線、A-5 の取りこぼし側の表
//    （v10.3.0 は拒否していた攻撃表現: 語境界化で通るようになり一覧・規則に足した行＝拒否／直さずに残した行＝
//    moderate.js 冒頭「既知の残り」と一致すること／v10.3.0 から残る誤検出）、A-6／A-7 の前後の文字の機械列挙
//    （日本語の短い語・英字の語の前後に小書き仮名・長音・促音・半角カナ・記号・数字・英字などを付けた文を、文字の分類表と
//    規則から決まる期待と照合し、v10.3.0 は拒否・現在は通る行を「既知の残り」の型 (j1)〜(j3)・(e1) ごとに表で出す）を固定する。
//    `--root <是正前の木>` で回すと、moderate.js が無い木では main.js の NG_WORDS と moderate の本文を
//    取り出して評価する（是正前の木の判定を是正前のまま測るためだけの読み口＝product の経路は変えない）。
//    赤になる章（2026-10-16 の実測・件数は決定ログ BL1 結果）: ad5ddd1（v10.3.0）＝A-1（PLAN の 9 行のうち diesel・
//    differential 以外の 7 行と規則の行）・A-4・A-5・A-6・A-7。9f5b4c2（BL1 初版）＝A-1 の 2 行・A-5・A-6・A-7。
//    e2869c0（層4 往復 1）＝A-5・A-6・A-7（添え字の付いた短い語・数字の後の英字の語・sexual）。
//
// B) BL2 走行中の設定変更の停止処理 — main.js の配線（本文を読む・DOM 前提で import できないため）。
//    是正前（ad5ddd1〜b649a95＝v10.3.0）は loadCourse と設定の change 8 経路（optTire/optGear/optSusp/optSteer/optBrake/
//    optWear/optPhysMode/regimeSel）が `running = false; paused = false; syncButtons();` だけで止め、setRunView(false)・
//    releaseDrive を通らなかった（走行中に変えるとコード表示のまま固定・■ が無効）。B-1 `running = false` の出現が stopAuto の
//    中だけ（是正前 11 箇所＝stopAuto・loadCourse・change 8 本・startAuto の ok === 0）、B-2 stopAuto の本文、B-3 9 経路が
//    stopAuto() を呼ぶ、B-4 発火元（courseSel → selectCourse → applyCourse → loadCourse・enforceFitRatio の fx.regime →
//    regimeSel の change・startAuto の失敗経路）。見た目（■・.cc-editor・.cc-code）は browser/check_bl2_runview.mjs。
//    赤になる章（2026-10-16 の実測）: ad5ddd1／b649a95（BL1 後・BL2 前）＝B-1・B-3・B-4（startAuto の行）。
//
// C) BL3 ① 順位表（HUD の leaderboard）の並び — hud.js drawFleetHud を mock ctx で呼び fillText の順で読む。
//    lap.js の lapTime は現周回の経過時間（周回を数えると 0）＝同じ周回数なら lapTime の長い車が先に線を越えた。
//    是正前は同周回を lapTime の昇順に並べ後続車を 1 位に描いた。峠のゴール済み同士はタイムの短い順・周回数違いは従来どおり。
// D) BL3 ② 記録 → エントリーの名前引き — race_ladder.js recordsFrom（言語別ラダーの lang）と race_ui.js の 2 か所
//    （📖 ショーケースの優勝エントリーの intro＝D-3・👻 の相手のプログラム＝D-4。E/F の治具で本番の経路から測る）。
//    是正前は作者の先勝ちで、同じ作者の 2 件目（C と py）の記録が 1 件目を引いた。
// E) BL3 ③ 再実行検証（verifyOfficialLocally）— frozenField を try の中へ。carDef.key が {toString:1} のエントリーで
//    TypeError が漏れず official.verify.badEntry（ja/en）を出す。正常な event は生成側（frozenField → resolveEventSpec →
//    runRace＝wf_official_result と同じ）と同じ verifyHash で「一致」と出す（是正前後で同じ値）。
// F) BL3 ④ 👻 あなた vs 世界ベスト（ghostVsWorld）の runRace の spec に physics/recon/wear が resolveEventSpec と同じ値で入る。
//    E/F の治具: race_ui.js を本番のまま import し、それが import する './race_engine.js'・'./loader.js' だけを
//    module.registerHooks で「本物を再輸出して runRace（呼び出しを記録して本物を呼ぶ）・上流の取得（治具の大会を返す）を
//    包む module」に解決する。🏆 の大会選択（selectOfficialRace）→「再実行検証」の click、🏅 の集計（loadAllOfficialData →
//    renderRankings）→ 👻 ボタンの data-cls/data-course で ghostVsWorld、と利用者と同じ入口から呼ぶ。DOM は $ の mock。
//    赤になる章（2026-10-16 の実測・--root）: f61d970（BL2 後・BL3 前）＝C-1・C-5・D-1・D-2b・D-3・E（例外と文言 ja/en）・
//    F（physics・recon・wear）・D-4 の 15 件。実ブラウザは browser/check_bl3_rankorder.mjs（順位表を実走で測る）。
//
// G) BL4 未エスケープの innerHTML と esc の非文字列耐性 — 表示側のエスケープ（入口の検査に頼らない）。
//    G-1 esc（public/js/escape.js の escapeHtml。BL4 で main.js から分離・main.js が import して race_ui/car_crud へ注入）が
//    {toString:1}・Object.create(null)・Proxy・Symbol・null・undefined・数値でも投げず文字列を返す（String(s) が投げる値は '?'）。
//    G-2 race_ui.js 🏆 の詳細の順位・ペナルティ（result.json）と再実行検証の結果の予算（event.budget.total）が文字列のまま見える。
//    G-3 🏆 の詳細は名前・intro・carDef.key が文字列にできないエントリーでも最後まで描ける（esc と main.js entryCarLabel の
//    hasOwnProperty.call を本文のまま評価して注入・決定ログ BL-3 の申し送り）。G-4 配線: car_crud.js・race_ui.js の
//    テンプレート文字列の ${…} を字句解析で全部取り出し、esc／fmtTime／t('…') で包まれていない式は一覧（理由つき）に
//    あるものだけ（一覧に無い式・ソースから消えた一覧の式は赤）。G-4b metaRows の値は全部 esc。G-5 car_crud.js の車種表と
//    編集フォーム（自作車〔localStorage〕・投稿車種〔registerCarType〕・組込の上書き〔applyCarOverride〕・JSON → フォーム）で
//    `<img`・onerror を持つタグが 0・`&lt;img` があり、value 属性が元の文字列のまま。出荷 6 車種の行は是正前の書き方と同一。
//    「onerror= を含まない」は**タグの中に**含まないことで測る（エスケープした本文は onerror= の綴りを文字として残す）。
//    G-4c 属性の値に入る ${…} は " 囲み（escape.js は ' をエスケープしない＝' 囲み・引用符なしは赤）。
//    G-6（層4 往復 1）文字列・数にできない値の同族: t() の {var} の差し込み（i18n.js の 1 か所＝join が投げたら String(v)／'?'）・
//    大会（event／entries／result）の値の欄を 1 つずつ {"toString":1}・Object.create(null)・Symbol() に替えて 🏆 詳細・🍴 fork・
//    再実行検証・🏅 の集計・打破通知・👻 の 6 入口で例外が漏れない表（race_ui.js の asText／asNum・aggregateNow の
//    「単独で通らない大会を外す」）・結果ダイアログの t()（:115 新記録・:123 最速ラップ・:127 勝者）・🏆 の公式記録の 1 行／
//    旧版の注記・main.js carTypeName（投稿車種の name）・carTypeLabel・loadCommunityCars（key が文字列にできない投稿）。
//    G-6（層4 往復 2）欄は event・entries・result の全部の葉と途中の object（regime・maxSec・crashRule・physicsMode・recon・wear・
//    minField・result の class／course／regime／laps・finishers[].programRef／classifiedMs・entries[].carDef の全パラメータ）。
//    大会は 2 つ（正常な bl4-h は bl4-f の 2 位と classifiedMs・bestLapMs が並ぶ＝race_ladder の名前比較が走る）で、🏅 から正常な
//    bl4-h が外れたら赤。各入口は「正常に描く／個別の 1 行」だけが緑（入口の try が拾った＝欄ごとの防御の漏れも赤）。F4（finishers の
//    object でない 1 件は空の行）・F2（単独なら通り組で投げる 2 大会・一覧の順は両方）。G-6e 入口の try そのもの＝依存
//    （courseDisplayName・carTypeLabel・setActiveProgram）を投げさせて 🏆 詳細・再実行検証・👻・🍴・🏅（1 つも残らない／描画だけ
//    投げる）が「【エラー】…」の 1 行を出す。打破通知の try は依存の側から届かない（漏れないことだけを測る）。
//    赤になる章（2026-10-16 の実測・--root 8248a58＝BL3 後・BL4 前）: 件数は決定ログ BL4 結果。--root 8a4bd2e（BL4 初版）＝
//    G-4（renderOfficialDetail の fmtTime(asNum(…)) の 2 行）・G-6。--root b8c7e21（層4 往復 1）＝G-4（renderRankings を
//    rankingsHtml に分けた 2 行）・G-6 の表（regime・タイの name／bestLapMs・programRef・🍴 の言語 の 16 行）・F4・F2 の 4 行・
//    G-6e の 7 行。実ブラウザは browser/check_bl4_escape.mjs
//    （自作車の車種表と編集フォームを実画面で開き、img 要素 0・alert 0）。
//
// H) BL5 ① CSS 変数の未定義と ③ ファイル入力の a11y の配線 — H-1 style.css・index.html・public/js の全 .js で var(--x) が参照する
//    変数は全部どこかで定義（docs/stage_bl/probe/cssvars.mjs の型。`var(--warn, …)` のようなフォールバック付きは対象外＝一覧に出す）。
//    H-2 style.css のフォールバックの無い参照は :root で定義（テーマは :root の上書き＝:root にあれば 11 テーマ全部で値が決まる）・
//    .dlg-editor の background。H-3 `.filebtn input` を display:none／visibility:hidden にしない・<input type=file> を index.html と
//    public/js の全 .js から引用符の形を問わず数えて計 3 個（index.html #dataImport・#edImport／main.js .cc-file・コメントは数えない・
//    JS で type を file にする形 0）・名前は見える文言と一致（見える文言のある label は aria の上書きなし＝label の文言が名前・
//    アイコンだけの ⬆ は aria-label="${t('aria.file.program')}"）。H-4 矢印キーの手動運転の判定 arrowKeysForCar（main.js の本文を評価）
//    はファイル入力にフォーカスがあっても走る（BL5 fix1・層4 F1 の回帰: マウスで label を押すとフォーカスが隠した入力へ移る）。
//    是正前は `.dlg-editor { background: var(--surface-1) }`（全テーマで未定義＝透明）・`.filebtn input { display: none; }`。
// I) BL5 ② elev3d.js（峠コースの立体プレビュー）の canvas 文言の i18n — I-1 文字列リテラルに日本語 0（字句解析・コメントは数えない・
//    検出力の自己点検つき）・I-2 カタログ elev3d.top／foot／title（ja/en 非空・en に日本語なし・{m}）・I-3 courses.json の峠全部を
//    buildFromSpec で作り drawTougeElevation を mock の canvas で ja／en の両方で呼び、fillText が t() の値と一致・ja は是正前の
//    固定文言と同一・I-4 elev3d.js が t を import・main.js の言語切替（setOnLangChange）が drawTougeElevation を呼ぶ。
//    赤になる章（2026-10-16 の実測・--root 81e44bf＝BL4 後・BL5 前）: H-1・H-2（2 行）・H-3（4 行）・I-1・I-2（4 行）・I-3・I-4（2 行）の
//    15 件。実ブラウザは browser/check_bl5_a11y.mjs（全 11 テーマのエディタの背景の計算値・Tab で到達して Space でファイル選択・
//    言語切替後の立体プレビューの fillText）。
//    BL5 fix1（層4 往復 1・2026-10-17 の実測）: --root 95ef692（BL5 初版）＝H-3（#dataImport・#edImport の aria の上書き＝見える文言と
//    食い違う名前）・H-4（file・FILE の 2 行）の 4 件。--root 81e44bf＝H-1・H-2（2 行）・H-3（display:none・⬆ の名前）・H-4（2 行＝判定は
//    BL5 前から同じ。81e44bf では入力が display:none でフォーカスが移らなかったので実害は無かった）・I-1・I-2（4 行）・I-3・I-4（2 行）の
//    15 件。I-1／G-4 の字句解析は後置 ++／-- の後の / を割り算と読み、I-1 も正規表現の途中の改行で投げる（層4 F3）。
//
// J) BL6 live の loop() の段取り — main.js frame の走行中・非ポーズ分岐の本文（是正後は loopsched.js の runLiveFrame を呼ぶ形）を切り出し、
//    tickSlot・integrateLive を記録だけする治具で評価する（是正前の木も同じ読み口で是正前の本文を評価）。J-1 条件表（60 fps×1×・60 fps×3×・
//    30 fps×3×・20 fps×3×・10 fps×3×＋参考の行・probe/loopdebt.mjs の型）の 60 sim 秒で loop() の頻度が loopHz ±5 %・負債 ≤ 1 周期・
//    60 fps×1× に戻した最初の 1 sim 秒が loopHz ± 1・負の delay でも負債 ≤ 1 周期。J-2 delay(100) で次の loop() が呼ばない双子より
//    100 ms ± 1 周期 遅れる。J-3 上限 LIVE_MAX_TICKS_PER_FRAME ≥ UI で出せる最大の区間の数（index.html #speed の max × main.js の打ち切り）と
//    上限に当たったときの挙動（UI の外・速度 5×）。J-4 sdt ≤ 1 周期のフレーム列で是正前の式と呼び出し・値が 1 ビットも違わない。J-5 配線。
//    J-6（BL6 fix1・層4 F3）loop() を呼ぶ時刻が、治具の外で独立に作った期限の列の「期限の来た区間の始まり」で、続く 2 回の間隔が 0 より長く
//    2 周期＋delay 以下（Δt の揺れ・端数の区間・delay の 7 行。続けて呼んだ回数〔間隔 5 ms 未満〕は参考の印字）。
//    赤になる章（2026-10-17 の実測・--root fee6e7a＝BL5 後・BL6 前）: J-1（30・20・10 fps×3× と参考の 45・40 fps×3×・負の delay）・
//    J-2（同じ 5 条件）・J-3（2 行）・J-5（4 行）の 17 件（BL6 初版の時点）＋fix1 の J-6 は 60 fps×1× 以外の 6 行（是正前は loop() が期限より
//    遅れ・頻度が落ちる）＝計 23 件（739/23）。J-4 は是正前の木では同じ本文どうしの比較で緑。実ブラウザは
//    browser/check_bl6_loop.mjs（本物の rAF の間隔と速度で、loop() のたびに回数を print するプログラムのシリアル出力から頻度を測る）。
//
// K) BL7 インタプリタ残件 — 本番の buildController（runner.js → evaluator.js・api.js）で走らせる（probe/{interp,deep,deepB}.mjs の型）。
//    K-1 len(None)・len(5)・random.choice(None)・random.choice([]) ほかが ja/en とも RuntimeError（i18nKey＝interp.err.lenArg／choiceArg／
//    choiceEmpty・行＝len／choice を呼んだ文の行・文言＝カタログの値）・python3 も例外・選べる列の値と乱数の消費は是正前と同じ・配線（api.js の
//    throw new Error( 0 件・evaluator.js callHost が行を付ける）。K-2 Model B（while True:）・1 回だけ走る本文・setup 前の初期化の str()／print()
//    （深い入れ子の list）が RangeError を漏らさず interp.err.recursion（文言 recursionStack・行＝その文・「1 段」なし）・def loop() の中も同じ文言・
//    上限 SIM.maxCallDepth の経路は従来の文言（BK1 の値を定数で照合）。K-3 dict の真偽（if／while／not／bool()／三項）と len は是正前と同じ値・
//    python3 と同じ出力・配線（evaluator.js pyTruthy と api.js pyLen に Object.keys が無い＝**形の検査であって速さの主張ではない**。BL7 fix1・
//    層4 F1: V8 の辞書モードの for … in も鍵を全部集める＝鍵の数に比例・割り当ても Object.keys と同じ。速さは参考の印字だけで判定しない）。
//    BL7 fix1（層4 往復 1）: K-1 に引数の数（len()・len(a, b)・random.choice()・random.choice(a, b) → interp.err.oneArg・python3 も TypeError）、
//    K-2 にスタック切れの文言の例が list だけ（dict は浅くても str() が TypeError＝BK-9 の未是正の差・スタック切れに届かない）、K-4 にループの
//    条件の行（while〔py・C〕の 2 回目以降・C の for の条件と更新部・do-while の条件で出たエラーの行＝そのループの行〔do-while は while の行〕・
//    エラーの出ない tick の実行位置ハイライトとステップ上限エラーの行は是正前と同じ）。
//    BL7 fix2（層4 往復 2）: K-1 に引数の数を数える経路（py・C の呼び出しだけ＝evaluator.js callHost の ONE_ARG。JS のプログラムと
//    `["ab", "c"].map(len)`／`.map(random.choice)` のネイティブの呼び出しは 15341f4 と同じ値＝fix1 の回帰 F2）、K-3 の速さの語の検査の範囲を
//    注記まで（evaluator.js pyTruthy の上の注記〜dictNonEmpty・api.js pyLen の上の注記〜本体・physics_model §9 の dict を含む行・changelog.js の
//    dict／辞書を含む文。語＝O(1)・定数時間・一定時間・高速・鍵の一覧を作らない・constant time・faster・quicker・no longer builds the list of keys）、
//    K-4 にステップ上限の行（条件の中の関数の呼び出しの 1 歩で上限を越えるとループ／elif の行＝F1・行は SIM.maxStepsPerTick で決まる）と
//    elif／else if の条件のエラーの行（parser の列挙しない condLine・AST の JSON は不変＝F4）。
//    赤になる章（2026-10-17 の実測・--root 15341f4＝BL6 後・BL7 前）: 件数は決定ログ BL7 結果。--root e961e4b（BL7 初版）＝K-1 の引数の数の行・
//    K-2 の文言の例・K-4 の条件の行（件数は決定ログ BL7 fix1 結果）。fix2 の行（K-1 のネイティブの呼び出し・K-3 の注記・K-4 のステップ上限と
//    elif）の赤は決定ログ BL7 fix2 結果（--root 15341f4・e961e4b・cb9ea81）。
//
// 使い方: node wf_bl1_ui.mjs              … 検査
//         node wf_bl1_ui.mjs --root <dir>  … <dir>/public/js の product で回す（是正前の木で赤になることの確認用）
// exit: 0=全緑 / 1=いずれか赤。
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const rootIdx = process.argv.indexOf('--root');
const ROOT = rootIdx >= 0 ? resolve(process.argv[rootIdx + 1]) : HERE;
const JS = join(ROOT, 'public/js');

let pass = 0, fail = 0;
const fails = [];
const ok = (cond, msg) => { console.log(`  ${cond ? '○' : '✗'} ${msg}`); if (cond) pass++; else { fail++; fails.push(msg); } return cond; };
const J = (v) => JSON.stringify(v);

console.log(`[BL1] wf_bl1_ui — product: ${JS}${ROOT === HERE ? '' : '（--root）'}`);

// ── 判定関数の読み口 ─────────────────────────────────────────────────────────
// 是正後: moderate.js を import。是正前の木（moderate.js が無い）: main.js から NG_WORDS と moderate の本文を
// 切り出して評価する（main.js は DOM を前提にするので module として import できない）。
async function loadModerate() {
  const mod = join(JS, 'moderate.js');
  if (existsSync(mod)) {
    const m = await import(pathToFileURL(mod).href);
    return { moderate: m.moderate, NG_WORDS: m.NG_WORDS, from: 'moderate.js' };
  }
  const src = readFileSync(join(JS, 'main.js'), 'utf8');
  const a = src.indexOf('const NG_WORDS = [');
  const b = src.indexOf("$('askSendBtn')", a);
  if (a < 0 || b < 0) throw new Error('main.js に NG_WORDS／askSendBtn が見つからない');
  const body = src.slice(a, b);
  const f = new Function(`${body}\nreturn { moderate, NG_WORDS };`);
  return { ...f(), from: 'main.js（是正前の木の本文を評価）' };
}
const { moderate, NG_WORDS, from } = await loadModerate();

// BL4: innerHTML のエスケープ（escapeHtml）の読み口。是正後: escape.js を import。是正前の木（escape.js が無い）:
// main.js の `function escapeHtml(` の 1 行を取り出して評価する（loadModerate と同じ・product の経路は変えない）。
async function loadEscape() {
  const mod = join(JS, 'escape.js');
  if (existsSync(mod)) return { escapeHtml: (await import(pathToFileURL(mod).href)).escapeHtml, from: 'escape.js' };
  const src = readFileSync(join(JS, 'main.js'), 'utf8');
  const m = /^function escapeHtml\(s\) \{.*\}$/m.exec(src);
  if (!m) throw new Error('main.js に function escapeHtml が見つからない');
  return { escapeHtml: new Function(`${m[0]}\nreturn escapeHtml;`)(), from: 'main.js（是正前の木の本文を評価）' };
}
const { escapeHtml: ESC, from: escFrom } = await loadEscape();
console.log(`  エスケープ: ${escFrom}`);
console.log(`  判定関数: ${from}・NG 語 ${NG_WORDS.length} 語`);

// ── A) NG ワード判定 ───────────────────────────────────────────────────────────
console.log('\nA-1) 通過（NG 語の綴りを語の一部に含むだけの文）— 是正前: diesel・differential 以外は拒否');
const PASS_PLAN = [  // PLAN BL1 の受け入れ基準の 9 行（実装前固定）
  'カスタム車種を作りたい', 'cockpit view', 'Essex のコース', 'Sussex', 'Dickens', 'die hard', 'スカスカ', 'diesel', 'differential',
];
const PASS_RULE = [  // moderate.js 冒頭の規則 ①② から導いた行（大小文字・語の前後の文字種・語の文字＝\w）
  'ESSEX', 'Charles Dickens の小説', 'peacock', 'Hancock', 'cocktail', 'sextant と sexagesimal', 'the skill you need',
  'the engine would die here', 'RC_xxx の関数', 'retarder（減速装置）', 'バカンス', 'デブリ', 'コロンブス', 'エロージョン',
  'クズネツォフ', '差別化する', '無差別', '滞在日数', 'カスケード制御', '少しねじれる',
  // 層4 F1/F3/F4 の是正で足した規則の行（retard は -s/-ed だけ・kill your は kill you と別・在日は直前だけを見る・
  // ひらがなに挟まれた しね・サロゲート対の漢字〔CJK 拡張 B〕も漢字として読む）
  'retarding force', 'retardation', 'kill your speed before the corner', '現在日時', 'わたしね、', 'もしね、', '\u{20BB7}在日',
  // 層4 往復 2 の F1（添え字の先がカタカナの文字なら長い語の一部）
  'エロージョン', 'パーカス', 'ルーカス', 'ホッブス', 'ジョブス', 'sextant',
];
for (const s of [...PASS_PLAN, ...PASS_RULE]) {
  const r = moderate(s);
  ok(r && r.ok === true, `通過「${s}」（実 ${J(r)}）${PASS_PLAN.includes(s) ? '' : '〔規則〕'}`);
}

console.log('\nA-2) 拒否（product の NG_WORDS の全語から機械生成）');
// 語の前後に句読点・空白・括弧を置いた文（どの規則でも NG 語そのものとして一致すべき形）。
const T_ALL = [(w) => w, (w) => `「${w}」と言われた`, (w) => `>> ${w} <<`, (w) => `${w}。`, (w) => `title: ${w}!`];
// 語の前後が別の文字種の文（ひらがなだけの 2 文字以下の語は前後のひらがなと区別できない＝対象外。moderate.js ②）。
const isShortHira = (w) => [...w].length <= 2 && /^[\u3041-\u3096]+$/.test(w);
const T_JA = (w) => `お前は${w}だ`;
const T_UP = (w) => `YOU ARE ${w.toUpperCase()}`;
let generated = 0;
const perWord = {};
for (const w of NG_WORDS) {
  const ts = [...T_ALL];
  if (!isShortHira(w)) ts.push(T_JA);
  if (/^[a-z ]+$/.test(w)) ts.push(T_UP);
  perWord[w] = 0;
  for (const tpl of ts) {
    const s = tpl(w);
    const r = moderate(s);
    generated++;
    if (ok(r && r.ok === false && r.word === w, `拒否「${s}」→ 語「${w}」（実 ${J(r)}）`)) perWord[w]++;
  }
}
ok(NG_WORDS.length >= 30, `NG 語の一覧が空でない（${NG_WORDS.length} 語・是正前は 39 語）`);
ok(Object.values(perWord).every((n) => n >= 1) && generated >= NG_WORDS.length,
   `全語で 1 本以上の拒否が成立（生成 ${generated} 本・拒否に失敗した語 ${J(Object.keys(perWord).filter((w) => perWord[w] < 1))}）`);
// 語尾の活用・合成語（moderate.js ①: -s/-es/-ed/-ing/-y・sub の語は部分一致）。是正前も拒否（部分一致）だった形。
for (const [s, w] of [['idiots everywhere', 'idiot'], ['so retarded', 'retard'], ['a sexy line', 'sex'], ['fucking slow', 'fuck'],
  ['motherfucker', 'fuck'], ['nudes', 'nude'], ['pornography', 'porn'], ['このカスが', 'カス'], ['エロい', 'エロ'], ['バカな車', 'バカ'],
  ['死ねない', '死ね']]) {
  const r = moderate(s);
  ok(r && r.ok === false && r.word === w, `拒否（活用・合成）「${s}」→ 語「${w}」（実 ${J(r)}）`);
}

console.log('\nA-3) URL 過多（http(s):// が 4 本以上で拒否・3 本は通過）');
const urls = (n, p = 'https') => Array.from({ length: n }, (_, i) => `${p}://e${i}.example/`).join(' ');
ok(J(moderate(urls(4))) === J({ ok: false, word: 'リンク過多' }), `https 4 本 → リンク過多（実 ${J(moderate(urls(4)))}）`);
ok(J(moderate(urls(4, 'http'))) === J({ ok: false, word: 'リンク過多' }), 'http 4 本 → リンク過多');
ok(moderate(urls(3)).ok === true, 'https 3 本 → 通過');
ok(moderate('').ok === true && moderate(null).ok === true && moderate(undefined).ok === true, '空・null・undefined → 通過（例外を投げない）');

console.log('\nA-4) 配線（main.js の askSendBtn が moderate.js の moderate を呼ぶ・main.js に判定の写しが無い）');
{
  const main = readFileSync(join(JS, 'main.js'), 'utf8');
  ok(/^import \{ moderate \} from '\.\/moderate\.js';/m.test(main), "main.js が import { moderate } from './moderate.js'");
  ok(!/const NG_WORDS\b/.test(main) && !/function moderate\b/.test(main), 'main.js に NG_WORDS／function moderate の写しが無い');
  const h = main.indexOf("$('askSendBtn').addEventListener");
  ok(h >= 0 && /const m = moderate\(title \+ '\\n' \+ body\);/.test(main.slice(h, h + 1200)),
     "askSendBtn のハンドラが moderate(title + '\\n' + body) を呼ぶ");
  const msrc = existsSync(join(JS, 'moderate.js')) ? readFileSync(join(JS, 'moderate.js'), 'utf8') : '';
  ok(msrc !== '' && !/\b(document|window|localStorage)\b/.test(msrc.replace(/^\s*\/\/.*$/gm, '')),
     'moderate.js は DOM に触れない（document/window/localStorage の参照 0 件・コメントを除く）');
}

console.log('\nA-5) 取りこぼし側（v10.3.0 は部分一致で拒否していた攻撃表現。層4 F1 の実測）');
// A-5a: BL1 初版（9f5b4c2）の語境界化で通るようになったため一覧・規則に足した行＝拒否（是正前の木でも拒否）。
for (const [s, w] of [['kill yourself', 'kill yourself'], ['you should kill yourselves', 'kill yourselves'],
  ['dickhead', 'dickhead'], ['cocksucker', 'cocksucker'], ['idiotic', 'idiot'], ['idiotically slow', 'idiot'],
  ['stupidity', 'stupid'], ['stupidly', 'stupid'], ['die in a fire', 'die in a fire'], ['you should die now', 'you should die'],
  ['バカヤロー', 'バカヤロ'], ['バカヤロウ', 'バカヤロ'], ['デブス', 'デブス'], ['アホンダラ', 'アホンダラ'],
  ['在日韓国人は出ていけ', '在日'], ['在日朝鮮人', '在日'], ['人種差別', '人種差別'], ['差別的な発言', '差別的'],
  ['sex_toy', 'sex'], ['sex69', 'sex'], ['sexy69', 'sex'], ['dickface', 'dickface'], ['dickwad', 'dickwad'],
  ['cockhead', 'cockhead'], ['エロゲーム', 'エロゲ'], ['stupider', 'stupid'],
  // 層4 往復 2 の F1／F3（添え字の読み飛ばし・数字は区切り・sex の語尾 -ual）
  ['お前はバカッ', 'バカ'], ['バカッ！', 'バカ'], ['アホー！', 'アホ'], ['おまえ、バカッ！', 'バカ'], ['ちょーバカ', 'バカ'],
  ['マジでちょーカスだな', 'カス'], ['すげーアホ', 'アホ'], ['お前はエロッ', 'エロ'], ['クズーッ', 'クズ'], ['ブスｯ', 'ブス'],
  ['デブァ', 'デブ'], ['しねっ！', 'しね'], ['しねぇ', 'しね'], ['sexual content', 'sex'], ['69sex', 'sex']]) {
  const r = moderate(s);
  ok(r && r.ok === false, `拒否（取りこぼしの是正）「${s}」（実 ${J(r)}・現行の語「${w}」）`);
}
// A-5b／A-5c: 直さずに残した行。moderate.js 冒頭「既知の残り」に同じ文が書いてあり、挙動もその記述どおりであること
// （直したらここが赤になる＝記述も直す）。
const MSRC = existsSync(join(JS, 'moderate.js')) ? readFileSync(join(JS, 'moderate.js'), 'utf8') : '';
for (const s of ['お前はしね', 'しねよ', 'もうしね', 'i will kill your family', 'エロイ', '性差別', '差別発言',
  'クソバカ', 'ドアホ', 'カスヤロー', '差別野郎', 'sexist', 'cockface',
  'バカッタレ', 'スーパーバカ', 'バカバカ', 'しねぇよ', 'homosexual', 'just die already', 'die bitch']) {
  const r = moderate(s);
  ok(r && r.ok === true && MSRC.includes(`「${s}」`), `既知の取りこぼし「${s}」＝通過かつ moderate.js に記述あり（実 ${J(r)}）`);
}
for (const [s, w] of [['少しね', 'しね'], ['勢いを殺す', '殺す'], ['pussyfoot', 'pussy'], ['Penistone', 'penis'],
  ['在日外国人向けの英語 UI', '在日'], ['在日本大使館', '在日'], ['非差別的な扱い', '差別的'], ['無差別的', '差別的'],
  ['反人種差別', '人種差別'], ['人種差別撤廃条約', '人種差別'], ['エラーコード 0xxx', 'xxx']]) {
  const r = moderate(s);
  ok(r && r.ok === false && r.word === w && MSRC.includes(`「${s}」`),
     `既知の誤検出「${s}」→ 語「${w}」かつ moderate.js に記述あり（実 ${J(r)}）`);
}

// ── A-6／A-7: 前後の文字を機械的に並べて v10.3.0（部分一致）と突き合わせる（層4 往復 2 の F1／F3）─────────────
// v10.3.0 の判定は「NG 語のどれかを部分一致で含めば拒否」だったので、NG 語を含む文は全部拒否していた。
// ここでは NG 語の前後に付きうる文字（小書き仮名・長音・促音・半角カナ・半角濁点・踊り字・ひらがな・漢字・記号・感嘆・
// 数字・英字）を文字の分類つきで列挙し、moderate.js 冒頭の規則（② の添え字の読み飛ばし・① の語境界）から決まる
// 期待（通過／拒否）と product の答えを全行で照合する。通過の行＝「v10.3.0 は拒否・現在は通る」行で、その表を
// 分類（moderate.js「既知の残り」の (j1)〜(j3)・(e1)）ごとに全件出す。期待は文字の分類表から決める（判定の写しではない）。
const OLD_V1030 = ['セックス', 'エロ', 'av女優', 'ちんちん', 'まんこ', 'ペニス', 'ヴァギナ', 'パイズリ', 'オナニー',
  'sex', 'porn', 'pussy', 'dick', 'cock', 'penis', 'vagina', 'boobs', 'nude', 'xxx', 'fuck',
  '死ね', '殺す', 'しね', 'バカ', 'アホ', 'クズ', 'カス', 'キモい', 'ブス', 'デブ', 'きちがい', 'キチガイ',
  '在日', '差別', 'idiot', 'stupid', 'retard', 'kill you', 'die '];  // ad5ddd1 main.js:2685-2692 の写し（比較専用・39 語）
const oldRejects = (s) => { const t = s.toLowerCase(); return OLD_V1030.some((w) => t.includes(w.toLowerCase())); };

console.log('\nA-6) 日本語の短い語の前後の文字（v10.3.0 は全行拒否。通過は「既知の残り」(j1)〜(j3) の型だけ）');
// 文字の分類。kata/hira/kanji＝その文字種の文字、kataM/hiraM＝その文字種の語で読み飛ばす添え字、other＝区切り。
const CH = [];
const addCh = (cat, str) => { for (const c of str) CH.push({ c, cat }); };
addCh('kata', 'アカンタｱｶスパルホジレマエロバクズブデ');
addCh('kataM', 'ァィゥェォッャュョヮヵヶㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿｧｨｩｪｫｬｭｮｯーｰﾞﾟヽヾ');
addCh('hira', 'あはちげよだなてのすめおまえでたれしね');
addCh('hiraM', 'ぁぃぅぇぉっゃゅょゎゕゖゝゞ');
addCh('kanji', '漢超々〆\u{20BB7}前在日差別');
addCh('other', '！？!?。、…〜～・「」（）() 　wｗ♪☆♡💢#@-_/.,01１a');
const catOf = new Map(CH.map((x) => [x.c, x.cat]));
const SCRIPT_OF_CAT = { kata: 'kata', kataM: 'kata', hira: 'hira', hiraM: 'hira', kanji: 'kanji', other: null };
// 規則②: 語の文字種 sc の添え字（sc+'M'）を読み飛ばし、その先の文字（無ければ文の端）が sc なら「続き」。
const contOf = (chars, sc) => {
  for (const c of chars) {
    const k = catOf.get(c);
    if (!k) throw new Error(`A-6 の文字の分類表に無い文字「${c}」`);
    if (k === sc + 'M') continue;
    return SCRIPT_OF_CAT[k] === sc;
  }
  return false;
};
const scriptOfWord = (w) => (/^[ァ-ヺ]+$/.test(w) ? 'kata' : /^[ぁ-ゖ]+$/.test(w) ? 'hira' : /^[一-鿿]+$/.test(w) ? 'kanji' : null);
const SHORT = NG_WORDS.filter((w) => [...w].length <= 2 && scriptOfWord(w));
const LEFT_ONLY = new Set(['在日']);  // moderate.js の side: 'left'
const NG3 = NG_WORDS.filter((w) => !/^[a-z ]+$/.test(w) && !SHORT.includes(w));  // 規則③（部分一致）の日本語の語
// 文 s の期待（規則②③）: ③ の語を含めば拒否。② の語は出現ごとに、直前（leftOnly でなければ直後も）が「続き」で
// なければ拒否（「バカ」＋「ス」＝バカス は カス の直前が カ＝続き・直後が文の端＝拒否。デブス は ③）。
const specPassJa = (s) => {
  if (NG3.some((x) => s.includes(x))) return false;
  for (const x of SHORT) {
    const sc = scriptOfWord(x);
    for (let i = s.indexOf(x); i >= 0; i = s.indexOf(x, i + 1)) {
      const lc = contOf([...s.slice(0, i)].reverse(), sc);
      const rc = contOf([...s.slice(i + x.length)], sc);
      if (!(lc || (!LEFT_ONLY.has(x) && rc))) return false;
    }
  }
  return true;
};
ok(J(SHORT) === J(['エロ', 'しね', 'バカ', 'アホ', 'クズ', 'カス', 'ブス', 'デブ', '在日', '差別']),
   `2 文字以下の日本語の語＝${J(SHORT)}`);
// 文脈: 1 文字ぜんぶ＋各添え字の先に代表の文字を 1 つ（右は「添え字＋X」、左は「X＋添え字」）＋語ごとの実例。
const REPS = ['', '！', 'ア', 'あ', '漢', 'ー', 'ッ', 'っ'];
const RIGHT = new Set(['']), LEFT = new Set(['']);
for (const { c, cat } of CH) {
  RIGHT.add(c); LEFT.add(c);
  if (cat === 'kataM' || cat === 'hiraM') for (const r of REPS) { RIGHT.add(c + r); LEFT.add(r + c); }
}
for (const r of ['ーッ！', 'ッ！', 'ー！', 'ーーー', 'ッッ', 'ァァ', 'ーｯ', 'ージョン', 'ッタレ', 'ッたれ', 'ぇよ', 'ーよ', 'っての', 'だな', 'だ']) RIGHT.add(r);
for (const l of ['ちょー', 'すげー', 'めっちゃー', 'スーパー', 'パー', 'ルー', 'ホッ', 'ジョ', 'ちょっ', 'お前は', 'おまえ、', 'マジでちょー', 'ーー']) LEFT.add(l);
const passTable = new Map();  // `${sc}|${side}` → Map(文脈 → 通った語の配列)
let a6rows = 0;
for (const w of SHORT) {
  const sc = scriptOfWord(w);
  const lo = LEFT_ONLY.has(w);
  const bad = { left: [], right: [], cross: [] };
  const run = (side, l, r) => {
    const s = l + w + r;
    const expPass = specPassJa(s);
    const got = moderate(s);
    a6rows++;
    if (!oldRejects(s)) bad[side].push(`${s}（v10.3.0 が拒否しない＝表の前提外）`);
    if (!got || got.ok !== expPass) bad[side].push(`${s}（期待 ${expPass ? '通過' : '拒否'}・実 ${J(got)}）`);
    if (expPass && side !== 'cross') {
      const key = `${sc}|${side}`, ctx = side === 'left' ? l : r;
      if (!passTable.has(key)) passTable.set(key, new Map());
      const m = passTable.get(key);
      if (!m.has(ctx)) m.set(ctx, []);
      m.get(ctx).push(w);
    }
  };
  for (const l of LEFT) run('left', l, '');
  if (!lo) for (const r of RIGHT) run('right', '', r);
  const CL = ['', 'ー', 'ッ', 'ちょー', 'パー', 'あ', 'ア', '漢', '！', 'お前は'];
  const CR = ['', 'ー', 'ッ！', 'ージョン', 'あ', 'ア', '漢', '！', 'ぇよ', 'だな'];
  for (const l of CL) for (const r of CR) run('cross', l, r);
  for (const side of ['left', 'right', 'cross']) {
    if (side === 'right' && lo) continue;
    const n = side === 'left' ? LEFT.size : side === 'right' ? RIGHT.size : CL.length * CR.length;
    ok(bad[side].length === 0, `「${w}」${side === 'left' ? '直前' : side === 'right' ? '直後' : '前後の組'} ${n} 通りが規則②どおり${bad[side].length ? `（食い違い ${bad[side].length}: ${bad[side].slice(0, 6).join(' / ')}）` : ''}`);
  }
}
// 表は文字種×側で 1 本（文字種の全語では通らない文脈は「（…だけ）」で通る語を示す）。
const CLASS = { kata: '(j1)', hira: '(j2)', kanji: '(j3)' };
console.log(`  ── 表: v10.3.0 は拒否・現在は通る文脈（${a6rows} 文から機械生成。語の前後の片側だけに付けた文脈）`);
for (const [key, m] of [...passTable].sort()) {
  const [sc, side] = key.split('|');
  const words = SHORT.filter((w) => scriptOfWord(w) === sc && !(side === 'right' && LEFT_ONLY.has(w)));
  const cell = ([ctx, ws]) => `[${ctx}]${ws.length < words.length ? `（${ws.join('・')}だけ）` : ''}`;
  console.log(`  ${CLASS[sc]} ${sc}（${words.join('・')}）の${side === 'left' ? '直前' : '直後'} ${m.size} 種: ${[...m].map(cell).join(' ')}`);
  ok(MSRC.includes(CLASS[sc]), `表の型 ${CLASS[sc]} が moderate.js「既知の残り」に書いてある`);
  // 型の中身: 通る文脈は、添え字の先に語と同じ文字種の文字（添え字でない）を含むものだけ（「ちょーバカ」「すげーアホ」は拒否）。
  ok([...m.keys()].every((ctx) => [...ctx].some((c) => catOf.get(c) === sc)),
     `${CLASS[sc]} の${side === 'left' ? '直前' : '直後'}で通る文脈はすべて ${sc} の文字を含む（添え字・記号だけの文脈は拒否）`);
}
// 参考: ひらがな書き・半角カナ書き・全角英字は v10.3.0 から一覧に無い（v10.3.0 と同じく通る＝回帰ではない）。
for (const s of ['ばか', 'あほ', 'かす', 'ﾊﾞｶ', 'ｱﾎ', 'ｶｽ', 'ＳＥＸ']) {
  const r = moderate(s);
  ok(r && r.ok === !oldRejects(s) && MSRC.includes(`「${s}」`), `v10.3.0 と同じ「${s}」（実 ${J(r)}・v10.3.0 ${oldRejects(s) ? '拒否' : '通過'}）かつ moderate.js に記述あり`);
}

console.log('\nA-7) 英字の語の前後の文字（v10.3.0 は全行拒否〔一覧に無かった句を除く〕。通過は (e1) の型だけ）');
const DEF_SUF = ['', 's', 'es', 'ed', 'ing', 'y'];
const ASCII_SPEC = {  // moderate.js ① の語尾（suf）。一覧を変えたらここも変える（下の照合が赤になる）。
  sex: [...DEF_SUF, 'ual', 'ually', 'uality'], dick: DEF_SUF, cock: DEF_SUF, nude: DEF_SUF, xxx: DEF_SUF,
  idiot: ['', 's', 'ic', 'ically'], stupid: ['', 's', 'ity', 'ly', 'er', 'est'], retard: ['', 's', 'ed'],
  'kill you': DEF_SUF, 'kill yourself': DEF_SUF, 'kill yourselves': DEF_SUF, 'go die': DEF_SUF, 'die in a fire': DEF_SUF,
  'you should die': DEF_SUF,
};
const SUB_ASCII = ['porn', 'pussy', 'penis', 'vagina', 'boobs', 'fuck', 'dickhead', 'dickface', 'dickwad', 'cockhead', 'cocksucker'];
ok(J(NG_WORDS.filter((w) => /^[a-z ]+$/.test(w)).sort()) === J([...Object.keys(ASCII_SPEC), ...SUB_ASCII].sort()),
   '英字の語＝語境界の語（ASCII_SPEC）＋部分一致の語（SUB_ASCII）');
// 直前: 英字・_ は語の続き（通過）、それ以外（数字・記号・空白・日本語・文の端）は区切り。
const PRE = { '': false, ' ': false, a: true, x: true, Q: true, homo: true, _: true, 9: false, 69: false, 0: false, '-': false,
  '#': false, '.': false, '@': false, "'": false, '(': false, 'の': false, 'お前は': false, 'é': false };
const SUFS = ['', 's', 'es', 'ed', 'ing', 'y', 'ual', 'ually', 'uality', 'ual content', 'ic', 'ically', 'ity', 'ly', 'er', 'est',
  'ist', 'ish', 'tant', 'ens', 'pit', 'x', 'S', 'ED', 'Y', '69', '9', '_', '_toy', '!', '.', ' ', ' content', '-', 'é', 'の'];
const sufCont = (w, s) => { const t = s.toLowerCase(); return !ASCII_SPEC[w].some((x) => t.startsWith(x) && !/[a-z]/.test(t[x.length] ?? '')); };
const passE = new Map();
let a7rows = 0;
for (const w of Object.keys(ASCII_SPEC)) {
  const bad = [];
  for (const [pre, pc] of Object.entries(PRE)) for (const suf of SUFS) {
    const s = pre + w + suf;
    const expPass = pc || sufCont(w, suf);
    const got = moderate(s);
    a7rows++;
    if (!got || got.ok !== expPass) bad.push(`${s}（期待 ${expPass ? '通過' : '拒否'}・実 ${J(got)}）`);
    if (expPass && oldRejects(s)) {
      if (!passE.has(w)) passE.set(w, { pre: new Set(), suf: new Set() });
      if (pc) passE.get(w).pre.add(pre);
      else passE.get(w).suf.add(suf);
    }
  }
  ok(bad.length === 0, `「${w}」前 ${Object.keys(PRE).length}×後 ${SUFS.length} 通りが規則①どおり${bad.length ? `（食い違い ${bad.length}: ${bad.slice(0, 6).join(' / ')}）` : ''}`);
}
console.log(`  ── 表: v10.3.0 は拒否・現在は通る形（${a7rows} 文から機械生成。前だけ／後だけに付けた形）`);
for (const [w, { pre, suf }] of passE) console.log(`  (e1) ${w}: 前 [${[...pre].join('] [')}]・後 [${[...suf].join('] [')}]`);
ok(passE.size === 0 || MSRC.includes('(e1)'), '表の型 (e1) が moderate.js「既知の残り」に書いてある');
// "die "（v10.3.0 の末尾空白つきの語）にだけ当たっていた文: 意図の明らかな句だけ拒否・ほかは (e2)。
for (const [s, exp] of [['go die now', false], ['die in a fire now', false], ['you should die now', false], ['die idiot', false],
  ['just die already', true], ['die bitch', true], ['die hard', true], ['the engine would die here', true]]) {
  const r = moderate(s);
  ok(r && r.ok === exp && oldRejects(s) && (!exp || PASS_PLAN.includes(s) || PASS_RULE.includes(s) || MSRC.includes(`「${s}」`)),
     `"die " の文「${s}」→ ${exp ? '通過' : '拒否'}（実 ${J(r)}・v10.3.0 は拒否）`);
}

// ── B) BL2 走行中の設定変更の停止処理（main.js の配線）────────────────────────────
// main.js は DOM を前提にするので import できない＝本文を読んで配線だけを検査する（挙動は browser/check_bl2_runview.mjs）。
// 行コメントを落としてから数える（コメントの中の `running = false` は配線ではない）。`//` の直前が行頭か空白のときだけ
// コメントとみなす（'https://…' の // は落とさない）。
console.log('\nB-1) `running = false`（全体の走行状態を落とす代入）は stopAuto の中だけ');
const MAIN = readFileSync(join(JS, 'main.js'), 'utf8');
const CODE = MAIN.split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
const lineOf = (i) => CODE.slice(0, i).split('\n').length;
// i（`{` の位置）から対応する `}` までを返す（行コメントは落とし済み。文字列・テンプレートの中の括弧は数えない）。
function blockAt(i) {
  let d = 0, q = null;
  for (let k = i; k < CODE.length; k++) {
    const c = CODE[k];
    if (q) { if (c === '\\') k++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') d++;
    else if (c === '}' && --d === 0) return { a: i, b: k, text: CODE.slice(i, k + 1) };
  }
  return null;
}
function fnBody(name) {
  const m = new RegExp(`\\nfunction ${name}\\s*\\([^)]*\\)\\s*\\{`).exec(CODE);
  return m ? blockAt(m.index + m[0].length - 1) : null;
}
// `$('<id>')` を受けた変数に繋いだ change ハンドラ（`const xEl = $('id'); if (xEl) xEl.addEventListener('change', (e) => {…})`）、
// または `$('<id>').addEventListener('change', …)` の本文。
function changeHandler(id) {
  // 宣言と登録が隣り合う最上位の形だけを拾う（関数の中の `const sel = $('regimeSel')` などを取り違えない）。
  const h = new RegExp(`\\nconst (\\w+) = \\$\\('${id}'\\);\\s*\\n(?:if \\(\\1\\) )?\\1\\.addEventListener\\('change',\\s*\\(e\\)\\s*=>\\s*\\{`).exec(CODE)
         || new RegExp(`\\n\\$\\('${id}'\\)\\.addEventListener\\('change',\\s*\\(e\\)\\s*=>\\s*\\{`).exec(CODE);
  return h ? blockAt(h.index + h[0].length - 1) : null;
}
const stopB = fnBody('stopAuto');
const RUN_FALSE = /(?<![\w.$])running\s*=\s*false/g;
const sites = [];
for (let mm; (mm = RUN_FALSE.exec(CODE));) {
  if (/let\s+$/.test(CODE.slice(Math.max(0, mm.index - 8), mm.index))) continue;   // 宣言 `let running = false;` は代入ではない
  sites.push({ at: mm.index, line: lineOf(mm.index), inStop: !!stopB && mm.index > stopB.a && mm.index < stopB.b });
}
// 是正前（ad5ddd1〜b649a95）の実数は 11 箇所（stopAuto・loadCourse・change ハンドラ 8 本・startAuto の ok === 0）。
// PLAN の「10 箇所」は startAuto の 1 箇所を数えていなかった（先頭で stopAuto を呼んだ後の重ね書き＝同じ姿）。
console.log(`  出現 ${sites.length} 箇所（main.js:${sites.map((x) => x.line + (x.inStop ? '〔stopAuto〕' : '')).join(', ')}）`);
ok(!!stopB, 'stopAuto() の定義がある');
const outside = sites.filter((x) => !x.inStop);
ok(sites.length >= 1 && outside.length === 0,
   `running = false は stopAuto の中だけ（外 ${outside.length} 箇所${outside.length ? ': main.js:' + outside.map((x) => x.line).join(', ') : ''}）`);

console.log('\nB-2) stopAuto が停止の姿を全部つくる（駆動解除・編集表示・ボタン）');
for (const want of [/(?<![\w.$])running\s*=\s*false/, /(?<![\w.$])paused\s*=\s*false/, /releaseDrive\(slots\)/, /setRunView\(false\)/, /syncButtons\(\)/]) {
  ok(!!stopB && want.test(stopB.text), `stopAuto の本文に ${want.source.replace(/\(\?<!\[\\w\.\$\]\)/, '').replace(/\\s\*/g, ' ').replace(/\\/g, '')}`);
}

console.log('\nB-3) 走行中の設定変更 9 経路が stopAuto を呼ぶ（是正前は 9 経路とも running = false の直書き）');
const PATHS9 = [
  ['loadCourse（コース選択・投稿コースの復元・エディタ適用）', fnBody('loadCourse')],
  ...['optTire', 'optGear', 'optSusp', 'optSteer', 'optBrake', 'optWear', 'optPhysMode', 'regimeSel'].map((id) => [`${id} の change`, changeHandler(id)]),
];
for (const [label, b] of PATHS9) {
  const calls = b ? (b.text.match(/(?<![\w.$])stopAuto\(\)/g) || []).length : 0;
  const direct = b ? (b.text.match(RUN_FALSE) || []).length : 0;
  ok(!!b && calls >= 1 && direct === 0, `${label}${b ? `（main.js:${lineOf(b.a)}）` : '（本文が見つからない）'}: stopAuto() ${calls} 回・running = false の直書き ${direct}`);
}

console.log('\nB-4) 9 経路へ繋がる発火元（コース選択 → loadCourse・enforceFitRatio の領域切替 → regimeSel の change）');
const selB = fnBody('selectCourse'), appB = fnBody('applyCourse'), fitB = fnBody('enforceFitRatio');
ok(/\$\('courseSel'\)\.addEventListener\('change',[^\n]*selectCourse\(/.test(CODE), 'courseSel の change → selectCourse');
ok(!!selB && /(?<![\w.$])applyCourse\(/.test(selB.text), 'selectCourse → applyCourse');
ok(!!appB && /(?<![\w.$])loadCourse\(/.test(appB.text), 'applyCourse → loadCourse');
ok(!!fitB && /const sel = \$\('regimeSel'\)/.test(fitB.text) && /sel\.dispatchEvent\(new Event\('change'/.test(fitB.text),
   'enforceFitRatio の fx.regime は regimeSel の change を発火する（＝B-3 の regimeSel の経路を通る）');
const startB = fnBody('startAuto');
ok(!!startB && /if \(ok === 0\) \{ stopAuto\(\); return; \}/.test(startB.text), 'startAuto の「全車の setup 失敗」も stopAuto で止める');

// ── C) BL3 ① 順位表（HUD の leaderboard）の同周回内の並び ────────────────────────────
// 本番 hud.js の drawFleetHud を mock ctx で呼び、fillText の順で行（順位・名前）を読む（probe/rank.mjs の型）。
// lap.js の lapTime は現周回の経過時間（周回を数えると 0 へ戻る）＝同じ周回数なら lapTime が長い車ほど先に線を越えた。
// 峠（lap.touge）はゴールまで lapTime == totalTime で、ゴール済み（finished・laps=1）はタイム（totalTime）の短い順。
if (!globalThis.localStorage || typeof globalThis.localStorage.getItem !== 'function') {
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
}
console.log('\nC) 順位表の並び（hud.js drawFleetHud を mock ctx で呼ぶ）— 是正前: 同周回は lapTime の昇順＝後続車が 1 位');
const hud = await import(pathToFileURL(join(JS, 'hud.js')).href);
function lbOrder(slots) {
  const texts = [];
  const ctx = new Proxy({}, { get(t, k) {
    if (k === 'measureText') return (x) => ({ width: String(x).length * 7 });
    if (k === 'fillText') return (x) => texts.push(String(x));
    if (k in t) return t[k];
    return () => {};
  }, set(t, k, v) { t[k] = v; return true; } });
  hud.drawFleetHud(ctx, slots, { wPx: 800 }, -1);
  const names = new Set(slots.map((x) => x.name));   // 名前は 5 文字以下（lbName が切らない長さ）
  return texts.filter((x) => names.has(x));
}
const car = (name, lap) => ({ name, color: '#888', running: true, car: {}, lap });
const C_CASES = [
  // [見出し, slots, 期待の並び（1 位→）, 是正前も緑か]
  ['C-1 同周回（laps=2）: lapTime 10.0 の車（先行）が 1 位・1.0（後続）が 2 位',
    [car('AHEAD', { laps: 2, lapTime: 10.0, totalTime: 40 }), car('BACK', { laps: 2, lapTime: 1.0, totalTime: 31 })], ['AHEAD', 'BACK'], false],
  ['C-2 周回数が違えば周回数の多い順（lapTime に依らない）',
    [car('L2', { laps: 2, lapTime: 9.0 }), car('L3', { laps: 3, lapTime: 0.5 }), car('L0', { laps: 0, lapTime: 20 })], ['L3', 'L2', 'L0'], true],
  ['C-3 峠のゴール済み 2 台（laps=1・lapTime==totalTime）は totalTime の短い順',
    [car('SLOW', { laps: 1, finished: true, touge: true, lapTime: 30, totalTime: 30, lastLap: 30 }),
     car('FAST', { laps: 1, finished: true, touge: true, lapTime: 25, totalTime: 25, lastLap: 25 })], ['FAST', 'SLOW'], true],
  ['C-4 峠: ゴール済み（laps=1）は走行中（laps=0）より上',
    [car('RUN', { laps: 0, touge: true, lapTime: 50, totalTime: 50 }), car('GOAL', { laps: 1, finished: true, touge: true, lapTime: 40, totalTime: 40 })], ['GOAL', 'RUN'], true],
  ['C-5 3 台: 周回数 → 同周回は先に線を越えた順（lapTime の長い順）',
    [car('P3', { laps: 1, lapTime: 2.0 }), car('P1', { laps: 2, lapTime: 1.0 }), car('P2', { laps: 1, lapTime: 7.5 })], ['P1', 'P2', 'P3'], false],
  ['C-6 同周回・同じ lapTime は入力順のまま（安定）・lap の無い車は 0 周',
    [car('X1', { laps: 1, lapTime: 3 }), car('X2', { laps: 1, lapTime: 3 }), { name: 'NOLAP', color: '#888', running: false, car: {} }], ['X1', 'X2', 'NOLAP'], true],
];
for (const [label, slots, want] of C_CASES) {
  for (const rev of [false, true]) {
    if (rev && label.startsWith('C-6')) continue;   // 安定性の行は入力順そのものが期待
    const got = lbOrder(rev ? [...slots].reverse() : slots);
    ok(J(got) === J(want), `${label}${rev ? '（入力を逆順）' : ''}: 実 ${got.join(' → ')}`);
  }
}

// ── D) BL3 ② 記録 → エントリーの名前引き（同じ作者の 2 件目）───────────────────────
// 本番 race_ladder.js の recordsFrom（言語別ラダーの lang を entries から引く）。是正前は entryIndex の byAuthor が
// 先勝ちで、同じ作者の C と py の 2 エントリーの記録がどちらも 1 件目（C）を引いた（probe/author.mjs）。
// race_ui.js の 2 か所（📖 ショーケースの優勝エントリー・👻 の entryForRecord）は下の E/F の治具で本番の経路から測る（D-3・D-4）。
console.log('\nD) 記録 → エントリーの名前引き（race_ladder.js recordsFrom）— 是正前: 同じ作者の 2 件目を引けない');
const ladderM = await import(pathToFileURL(join(JS, 'race_ladder.js')).href);
const langOfRecs = (race) => Object.fromEntries(ladderM.recordsFrom([race]).map((r) => [r.name, r.lang]));
const raceOf = (entries, finishers) => ({ event: { id: 'ev', course: 'X' }, entries, result: { eventId: 'ev', verifyHash: 'h', finishers } });
{
  const r = langOfRecs(raceOf(
    [{ name: 'carC', author: 'alice', program: { lang: 'c', src: 'c' } }, { name: 'carPy', author: 'alice', program: { lang: 'py', src: 'p' } }],
    [{ rank: 1, name: 'carPy', author: 'alice', totalTimeMs: 1000 }, { rank: 2, name: 'carC', author: 'alice', totalTimeMs: 2000 }]));
  ok(r.carPy === 'py', `D-1 同じ作者 alice の py エントリーの記録 carPy → lang py（実 ${r.carPy}）`);
  ok(r.carC === 'c', `D-1 同じ作者 alice の C エントリーの記録 carC → lang c（実 ${r.carC}）`);
}
{  // 既存の引き方（是正前も緑）: 作者違い・名前の無い記録・作者の無い記録・改名（記録の名前と entries の名前が違う）・補充車
  const r = langOfRecs(raceOf(
    [{ name: 'b1', author: 'bob', program: { lang: 'c' } }, { name: 'c1', author: 'carol', program: { lang: 'py' } },
     { name: 'anon', author: '', program: { lang: 'js' } }, { name: 'old', author: 'dave', program: { lang: 'py' } }],
    [{ rank: 1, name: 'b1', author: 'bob' }, { rank: 2, name: 'c1', author: 'carol' }, { rank: 3, name: 'anon', author: '' },
     { rank: 4, name: 'renamed', author: 'dave' }, { rank: 5, name: 'BOT-1', author: '(filler)' }]));
  ok(J(r) === J({ b1: 'c', c1: 'py', anon: 'js', renamed: 'py', 'BOT-1': null }),
     `D-2 作者違い・作者の無い記録（名前で引く）・改名（作者で引く）・補充車（null）は従来どおり（実 ${J(r)}）`);
}
{  // 同じ作者で名前の一致が無い記録は作者の 1 件目（従来どおり）。名前が同じで作者が違うエントリーは引かない。
  const r = langOfRecs(raceOf(
    [{ name: 'same', author: 'erin', program: { lang: 'js' } }, { name: 'e1', author: 'frank', program: { lang: 'c' } },
     { name: 'same', author: 'frank', program: { lang: 'py' } }],
    [{ rank: 1, name: 'same', author: 'frank' }, { rank: 2, name: 'zzz', author: 'frank' }]));
  ok(r.same === 'py' && r.zzz === 'c', `D-2b 名前が同じでも作者の違うエントリーは引かない・名前の一致が無ければ作者の 1 件目（実 ${J(r)}）`);
}

// ── E/F の治具: race_ui.js を本番のまま import し、上流（loader.js の一覧・大会の取得）と runRace の呼び出しだけを差し替える ──
// race_ui.js が import する './race_engine.js'・'./loader.js' だけを、本物を再輸出して 1 関数だけ包む module に解決する
// （module.registerHooks。ほかのモジュールは本物の race_engine.js / loader.js と同じ実体を使う）。runRace は本物を呼び、
// 受け取った spec と結果を記録する（＝呼び出しの捕捉。結果は product のまま）。DOM は $ の mock（innerHTML を読むだけ）。
const { registerHooks } = await import('node:module');
const BL3 = (globalThis.__BL3 = { calls: [], list: [], races: {} });
const UI_URL = pathToFileURL(join(JS, 'race_ui.js')).href;
const ENGINE_URL = pathToFileURL(join(JS, 'race_engine.js')).href;
const LOADER_URL = pathToFileURL(join(JS, 'loader.js')).href;
const SPY_SRC = {
  'bl3-spy:engine': `import * as real from ${J(ENGINE_URL)};\nexport * from ${J(ENGINE_URL)};\n` +
    'export function runRace(spec) { const c = { spec }; globalThis.__BL3.calls.push(c); c.res = real.runRace(spec); return c.res; }\n',
  'bl3-spy:loader': `export * from ${J(LOADER_URL)};\n` +
    'export async function listOfficialRacesState() { return { list: globalThis.__BL3.list.map((id) => ({ id })), state: "ok" }; }\n' +
    'export async function listOfficialRaces() { return globalThis.__BL3.list.map((id) => ({ id })); }\n' +
    'export async function fetchRace(id) { const r = globalThis.__BL3.races[id]; if (!r) throw new Error("no race " + id); return r(); }\n',
};
registerHooks({
  resolve(spec, ctx, next) {
    if (ctx.parentURL === UI_URL && spec === './race_engine.js') return { url: 'bl3-spy:engine', shortCircuit: true };
    if (ctx.parentURL === UI_URL && spec === './loader.js') return { url: 'bl3-spy:loader', shortCircuit: true };
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (SPY_SRC[url]) return { format: 'module', source: SPY_SRC[url], shortCircuit: true };
    return next(url, ctx);
  },
});
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => {};
const ctx2d = new Proxy({}, { get(t, k) {
  if (k === 'measureText') return (x) => ({ width: String(x).length * 7 });
  if (k in t) return t[k];
  return () => ({ addColorStop() {} });
}, set(t, k, v) { t[k] = v; return true; } });
const ELS = new Map();
function el(id) {
  if (!ELS.has(id)) {
    ELS.set(id, {
      id, innerHTML: '', textContent: '', value: '', hidden: false, open: false, disabled: false, checked: false,
      width: 300, height: 200, clientWidth: 300, clientHeight: 200, style: {}, dataset: {}, _l: {},
      addEventListener(type, fn) { (this._l[type] ||= []).push(fn); }, removeEventListener() {},
      fire(type, ev = {}) { for (const fn of this._l[type] || []) fn(ev); },
      showModal() { this.open = true; }, show() { this.open = true; }, close() { this.open = false; this.fire('close'); },
      querySelector() { return null; }, querySelectorAll() { return []; },
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute() {}, getAttribute() { return null; }, appendChild() {}, focus() {}, scrollIntoView() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200 }; },
      getContext() { return ctx2d; },
    });
  }
  return ELS.get(id);
}
// escapeHtml は product（BL4 以降は escape.js を import・それより前の木は main.js の本文を評価＝loadEscape）を依存注入する。
const escH = ESC;
const unescH = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const { buildFromSpec } = await import(pathToFileURL(join(JS, 'course.js')).href);
const { PROGRAM_BY_KEY } = await import(pathToFileURL(join(JS, 'programs.js')).href);
const engine = await import(ENGINE_URL);
const raceEvent = await import(pathToFileURL(join(JS, 'race_event.js')).href);
const i18n = await import(pathToFileURL(join(JS, 'i18n.js')).href);
const COURSE_SPECS = JSON.parse(readFileSync(join(ROOT, 'public/data/courses.json'), 'utf8'));
const OVAL = buildFromSpec(COURSE_SPECS.find((x) => x.name === 'オーバル'));
const logs = [];
// 車種の表示名の依存注入。C〜F 章は従来どおり key の文字列、G 章は main.js の entryCarLabel（product の本文）に差し替える。
let ECL = (k) => String(k || '');
let CTL = (k) => String(k);   // G-6 は main.js の carTypeLabel（product の本文）に差し替える
// G-6／G-6e（層4 往復 2）: コースの表示名と 🍴 の取り込み先も差し替えられるようにする（G-6 は呼び出しの引数を記録・G-6e は投げさせる）。
const CDN0 = (c) => (c && typeof c === 'object' ? c.name : String(c || ''));
let CDN = CDN0;
let SAP = () => {};
const ui = (await import(UI_URL)).initRaceUI({
  $: el, escapeHtml: escH, logLine: (x) => logs.push(String(x)),
  activeSlot: () => ({ name: 'ME', lang: 'c', src: PROGRAM_BY_KEY.normal_fr.code, carType: 'normal_fr' }),
  exitEdit() {}, courseDisplayName: (c) => CDN(c),
  carTypeLabel: (k) => CTL(k), entryCarLabel: (k, d) => ECL(k, d), setActiveProgram: (c, l) => SAP(c, l), playCountdown() {},
  resolveRaceCourse: (ref) => (ref === 'オーバル' ? OVAL : null), submitToGithub() {}, raceCourseUnit: undefined,
});
const SRC_C = PROGRAM_BY_KEY.normal_fr.code, SRC_PY = PROGRAM_BY_KEY.py_normal_fr.code;
const ent = (name, author, lang, extra = {}) => ({ name, author, program: { lang, src: lang === 'py' ? SRC_PY : SRC_C },
  carType: 'normal_fr', submittedAt: '2026-01-01T00:00:0' + (extra.k || 0) + 'Z', ...extra });
// 大会を 1 つ置き、🏆 で選んで（本番の selectOfficialRace → renderOfficialDetail）「再実行検証」を押す（ofVerify の click）。
async function openRace(id, make) {
  BL3.races[id] = () => JSON.parse(JSON.stringify(make()));
  await ui.selectOfficialRace(id);
  return el('ofDetail').innerHTML;
}
async function clickVerify(id, make) {
  el('ofVerify')._l = {}; el('ofVerifyNote').innerHTML = '';
  await openRace(id, make);
  BL3.calls.length = 0;
  let thrown = null;
  try { el('ofVerify').fire('click'); } catch (e) { thrown = e; }
  return { thrown, note: el('ofVerifyNote').innerHTML, calls: [...BL3.calls] };
}

// D-3: 📖 ショーケース（締切後の優勝エントリーの intro）— 是正前は作者の 1 件目の intro を出した
console.log('\nD-3/D-4) race_ui.js の名前引き（📖 ショーケースの intro・👻 のエントリー）');
const TWO = () => ({
  event: { id: 'bl3-two', course: 'オーバル', laps: 1, class: 'open' },
  entries: [ent('carC', 'alice', 'c', { intro: 'INTRO-OF-C', k: 0 }), ent('carPy', 'alice', 'py', { intro: 'INTRO-OF-PY', k: 1 })],
  result: { eventId: 'bl3-two', verifyHash: 'h-two', course: 'オーバル', class: 'open',
    finishers: [{ rank: 1, name: 'carPy', author: 'alice', carType: 'normal_fr', totalTimeMs: 1000 },
                { rank: 2, name: 'carC', author: 'alice', carType: 'normal_fr', totalTimeMs: 2000 }] },
});
{
  // 締切後はプログラム公開欄が全エントリーの intro を出すので、📖 ショーケースの区画（official-showcase〜再実行ボタン）だけを見る。
  const html = await openRace('bl3-two', TWO);
  const a = html.indexOf('class="official-showcase"'), sc = a >= 0 ? html.slice(a, html.indexOf('id="ofVerify"', a)) : '';
  ok(sc.includes('INTRO-OF-PY') && !sc.includes('INTRO-OF-C'),
     `D-3 📖 ショーケースは優勝 carPy（alice の 2 件目）の intro を出す（区画 ${sc.length} 字・INTRO-OF-PY ${sc.includes('INTRO-OF-PY')}・INTRO-OF-C ${sc.includes('INTRO-OF-C')}）`);
}

// ── E) BL3 ③ 再実行検証（verifyOfficialLocally）の frozenField を try の中へ ──────────────
console.log('\nE) 再実行検証の読めないエントリー（race_ui.js verifyOfficialLocally）— 是正前: frozenField が try の外で TypeError が漏れる');
const BAD_KEY = () => ({
  event: { id: 'bl3-badkey', course: 'オーバル', laps: 1, class: 'budget', budget: { total: 100 } },
  entries: [ent('x', 'a', 'c', { carDef: { key: { toString: 1 } }, k: 0 }), ent('y', 'b', 'c', { k: 1 })],
  result: null,
});
const wantKey = 'official.verify.badEntry';
for (const lang of ['ja', 'en']) {
  i18n.setLang(lang);
  const pre = i18n.t(wantKey, { e: '\u0001' }).split('\u0001')[0];
  for (const [label, id, make] of [['carDef.key が {toString:1}（budget クラス）', 'bl3-badkey', BAD_KEY]]) {
    const r = await clickVerify(id, make);
    ok(r.thrown === null, `E [${lang}] ${label}: 例外が漏れない（実 ${r.thrown ? r.thrown.constructor.name + ': ' + r.thrown.message : 'なし'}）`);
    ok(i18n.hasKey(wantKey) && pre.length > 0 && r.note.includes(escH(pre)) && r.calls.length === 0,
       `E [${lang}] ${label}: 利用者向けの失敗文言（${wantKey}）を出し、再走しない（文言 ${r.note.includes(escH(pre))}・runRace ${r.calls.length} 回・実「${r.note.replace(/<[^>]+>/g, '').slice(0, 70)}」）`);
  }
}
i18n.setLang('ja');
{  // 参考（合否に数えない）: name が object のエントリーは、BL4 より前は再実行検証より前に 🏆 の詳細の描画（renderOfficialDetail の
   // escapeHtml(e.name)＝main.js の String(s)）で止まり、ボタンまで届かなかった（決定ログ BL-3 → BL4 で是正・合否は G-3 が測る）。
  let th = null;
  try { await openRace('bl3-badname', () => ({ event: { id: 'bl3-badname', course: 'オーバル', laps: 1, class: 'open' },
    entries: [ent({ toString: 1 }, '', 'c', { k: 0 }), ent('y', 'b', 'c', { k: 1 })], result: null })); } catch (e) { th = e; }
  console.log(`  参考: name が {toString:1} の大会を 🏆 で選ぶ → ${th ? `詳細の描画で ${th.constructor.name}（${th.message}）＝再実行検証に届かない` : '詳細を描けた'}`);
}
{  // 正常な event: 生成側（wf_official_result.mjs runOfficial と同じ: frozenField → resolveEventSpec → runRace）と同じ verifyHash
  const NORMAL = () => ({
    event: { id: 'bl3-normal', course: 'オーバル', laps: 1, class: 'open', physicsMode: 'v2' },
    entries: [ent('n1', 'alice', 'c', { k: 0 }), ent('n2', 'alice', 'py', { k: 1 }), ent('n3', 'bob', 'c', { k: 2 })],
    result: null,
  });
  const nr = NORMAL();
  const es = raceEvent.resolveEventSpec(nr.event, OVAL);
  const direct = engine.runRace({ course: OVAL, regime: es.regime, laps: es.laps, field: raceEvent.frozenField(nr.event, nr.entries),
    crashRule: es.crashRule, interact: es.interact, maxSec: es.maxSec, physics: es.physics, recon: es.recon, wear: es.wear, report: true, ghost: true });
  const r = await clickVerify('bl3-normal', () => ({ ...NORMAL(), result: { eventId: 'bl3-normal', verifyHash: direct.verifyHash, finishers: [] } }));
  const got = r.calls[0] && r.calls[0].res ? r.calls[0].res.verifyHash : null;
  console.log(`  正常な event の verifyHash: 生成側 ${direct.verifyHash}・再実行検証 ${got}`);
  ok(r.thrown === null && r.calls.length === 1 && got === direct.verifyHash && r.note.includes(escH(i18n.t('official.verify.match', { hash: direct.verifyHash }))),
     `E 正常な event は生成側と同じ verifyHash で「一致」と出す（${got} / ${direct.verifyHash}）`);
}

// ── F) BL3 ④ 👻 あなた vs 世界ベスト（ghostVsWorld）の runRace に physics/recon/wear ────────────
// 🏅 の集計（本番の loadAllOfficialData → renderRankings）が描いた 👻 ボタンの data-cls/data-course で ghostVsWorld を呼ぶ
// （main.js の click 委譲と同じ引数）。runRace の呼び出しを捕捉し、spec の physics/recon/wear が resolveEventSpec と一致するか。
console.log('\nF) 👻 ゴースト対戦の再走条件（race_ui.js ghostVsWorld）— 是正前: physics/recon/wear を渡さない');
{
  const GH = () => {
    const r = TWO();
    r.event = { id: 'bl3-ghost', course: 'オーバル', laps: 1, class: 'open', physicsMode: 'v2', recon: 1, wear: true };
    r.result = { ...r.result, eventId: 'bl3-ghost', verifyHash: 'h-ghost' };
    return r;
  };
  BL3.list = ['bl3-ghost']; BL3.races['bl3-ghost'] = () => JSON.parse(JSON.stringify(GH()));
  await ui.loadAllOfficialData(true);
  ui.renderRankings();
  const html = el('rankBody').innerHTML;
  const m = /class="rank-vsworld" data-cls="([^"]*)" data-course="([^"]*)"/.exec(html);
  ok(!!m, `🏅 の集計に 👻 ボタンがある（${m ? `data-cls=${unescH(m[1])}・data-course=${unescH(m[2])}` : '無し'}）`);
  BL3.calls.length = 0; logs.length = 0;
  let thrown = null;
  if (m) { try { ui.ghostVsWorld(unescH(m[1]), unescH(m[2])); } catch (e) { thrown = e; } }
  const c = BL3.calls[0];
  const es = raceEvent.resolveEventSpec(GH().event, OVAL);
  ok(thrown === null && BL3.calls.length === 1, `ghostVsWorld が runRace を 1 回呼ぶ（${BL3.calls.length} 回${thrown ? '・例外 ' + thrown.message : ''}${logs.length ? '・ログ ' + logs.join(' / ') : ''}）`);
  const sp = c ? c.spec : {};
  for (const k of ['physics', 'recon', 'wear']) {
    ok(c && k in sp && J(sp[k]) === J(es[k]), `F ${k}: spec ${c && k in sp ? J(sp[k]) : '（渡していない）'}・resolveEventSpec ${J(es[k])}`);
  }
  for (const k of ['regime', 'laps', 'crashRule', 'maxSec']) ok(c && J(sp[k]) === J(es[k]), `F ${k} は従来どおり resolveEventSpec の値（${c ? J(sp[k]) : '-'}）`);
  ok(c && sp.interact === false && sp.ghost === true, 'F interact=false・ghost=true（ゴースト対戦の条件は従来どおり）');
  // D-4: 世界ベスト carPy（alice の 2 件目）のプログラムで走る（是正前は alice の 1 件目＝C）
  const w = c && Array.isArray(sp.field) ? sp.field[1] : null;
  ok(!!w && w.lang === 'py' && w.src === SRC_PY, `D-4 👻 の相手は世界ベスト carPy のエントリー（lang ${w ? w.lang : '-'}・src が py の本文 ${!!w && w.src === SRC_PY}）`);
}

// ── G) BL4 未エスケープの innerHTML（car_crud の車種表と編集フォーム・race_ui の順位・ペナルティ・予算）と esc の非文字列耐性 ──
// 判定の述語（PLAN BL4 の「<img・onerror= を含まず &lt;img を含む」）: エスケープした文字列は本文に "onerror=" の綴りを
// 文字として残す（&lt;img src=x onerror=…&gt; は表示される文字列）。∴ onerror= は**タグの中（属性）に無いこと**で測る:
// ① `<img` の出現 0 ② `<…>` のタグのうち onerror を含むもの 0 ③ `&lt;img` を含む。属性からの抜け出しは、該当の
// <input> タグを属性の並びとして読み、value 属性を実体参照を戻して元の文字列と比べる（抜け出すと value="" で切れる）。
const XT = '<img src=x onerror=alert(1)>';      // 本文に入る形
const XA = '"><img src=x onerror=alert(1)>';    // 属性 value="…" から抜け出す形
const tagsOf = (h) => String(h).match(/<[a-zA-Z][^>]*>/g) || [];
// タグの中の onerror 属性＝引用符で囲んだ属性値を除いた残りに onerror= がある（value="…onerror=…" の値の中の綴りは数えない）。
const onAttr = (tag) => /\bonerror\s*=/i.test(tag.replace(/"[^"]*"/g, '""'));
const inert = (h) => ({ img: (String(h).match(/<img/gi) || []).length, onTag: tagsOf(h).filter(onAttr).length,
  lt: String(h).includes('&lt;img') });
const inertOk = (r) => r.img === 0 && r.onTag === 0 && r.lt;
const attrsOf = (tag) => { const o = {}; for (const m of String(tag).matchAll(/([\w-]+)="([^"]*)"/g)) o[m[1]] = unescH(m[2]); return o; };

console.log('\nG-1) esc（escapeHtml）は文字列にできない値でも投げず文字列を返す — 是正前: String(s) が TypeError');
{
  const nullProto = Object.create(null);
  const trap = new Proxy({}, { get() { throw new Error('trap'); } });
  const CASES = [
    ['{toString:1}', { toString: 1 }, null], ['JSON の {"toString":1}', JSON.parse('{"toString":1}'), null],
    ['Object.create(null)', nullProto, null], ['Proxy（どの読み出しも投げる）', trap, null],
    ['Symbol()', Symbol(), 'Symbol()'], ["Symbol('<b>')", Symbol('<b>'), 'Symbol(&lt;b&gt;)'],
    ['null', null, 'null'], ['undefined', undefined, 'undefined'], ['数値 5', 5, '5'], ['数値 1.5', 1.5, '1.5'], ['NaN', NaN, 'NaN'],
    ['真偽 true', true, 'true'], ["{toString(){return '<b>'}}", { toString() { return '<b>'; } }, '&lt;b&gt;'],
    ['配列 [1,"<"]', [1, '<'], '1,&lt;'], ['文字列 `a&<>"\'`', 'a&<>"\'', 'a&amp;&lt;&gt;&quot;\''],
  ];
  for (const [label, v, want] of CASES) {
    let r, th = null;
    try { r = ESC(v); } catch (e) { th = e; }
    ok(th === null && typeof r === 'string' && (want === null || r === want) && !/[<>"]/.test(r),
       `esc(${label}) → ${th ? `${th.constructor.name}: ${th.message}` : J(r)}${want === null ? '（文字列を返す）' : `（期待 ${J(want)}）`}`);
  }
  // 配線: main.js は escape.js の escapeHtml を import して両モジュールへ注入し、自前の定義を持たない
  const MAINS = readFileSync(join(JS, 'main.js'), 'utf8');
  ok(/^import \{ escapeHtml \} from '\.\/escape\.js';/m.test(MAINS) && !/^function escapeHtml\(/m.test(MAINS),
     `main.js は escape.js の escapeHtml を import し、自前の定義が無い（import ${/from '\.\/escape\.js'/.test(MAINS)}・自前 ${/^function escapeHtml\(/m.test(MAINS)}）`);
  ok(/initRaceUI\(\{ \$, escapeHtml,/.test(MAINS) && /initCarCrud\(\{ \$, escapeHtml,/.test(MAINS),
     'main.js は同じ escapeHtml を initRaceUI・initCarCrud に注入する');
}

console.log('\nG-2) race_ui.js 🏆 の詳細（順位・ペナルティ）と再実行検証の結果（予算）— 是正前: f.rank・f.penaltiesSec・budget が生のまま');
{
  const RX = () => ({
    event: { id: 'bl4-x', title: 'T', course: 'オーバル', laps: 1, class: 'budget', budget: { total: XT } },
    entries: [ent('e1', 'a1', 'c', { k: 0 }), ent('e2', 'b2', 'c', { k: 1 })],
    result: { eventId: 'bl4-x', verifyHash: 'h', finishers: [
      { rank: XT, name: 'e1', author: 'a1', carType: 'normal_fr', totalTimeMs: 1000, bestLapMs: 1000, penaltiesSec: XT },
      { rank: XA, name: 'e2', author: 'b2', carType: 'normal_fr', totalTimeMs: 2000, bestLapMs: 1000, penaltiesSec: XA }] },
  });
  let th = null, d = '';
  try { d = await openRace('bl4-x', RX); } catch (e) { th = e; }
  const r1 = inert(d);
  ok(th === null && inertOk(r1), `ofDetail（順位・ペナルティ）: <img ${r1.img}・onerror を持つタグ ${r1.onTag}・&lt;img ${r1.lt}${th ? '・例外 ' + th.message : ''}`);
  const rows = [...d.matchAll(/<tr><td>([^<]*)<\/td><td>e[12]<\/td>[^]*?<td>([^<]*)<\/td><\/tr>/g)].map((m) => [unescH(m[1]), unescH(m[2])]);
  ok(J(rows) === J([[XT, '+' + XT + 's'], [XA, '+' + XA + 's']]), `順位・ペナルティのセルは文字列のまま見える（実 ${J(rows)}）`);
  // 予算は本文に入る形（XT）と属性から抜け出す形（XA）の両方を与える（層4 往復 1 の F5）
  for (const [lb, X] of [['XT', XT], ['XA', XA]]) {
    const RB = () => { const r = RX(); r.event.budget.total = X; return r; };
    const v = await clickVerify('bl4-x', RB);
    const m = el('raceMeta').innerHTML;
    const r2 = inert(m);
    ok(v.thrown === null && v.calls.length === 1 && inertOk(r2), `raceMeta（予算 ${lb}）: <img ${r2.img}・onerror を持つタグ ${r2.onTag}・&lt;img ${r2.lt}（runRace ${v.calls.length} 回${v.thrown ? '・例外 ' + v.thrown.message : ''}）`);
    const bud = /<tr><th>([^<]*)<\/th><td>([^<]*&lt;img[^<]*)<\/td><\/tr>/.exec(m);
    ok(!!bud && unescH(bud[2]) === X && bud[1] === escH(i18n.t('event.meta.budget')), `予算の行（${lb}）は文字列のまま見える（${bud ? `${bud[1]} = ${J(unescH(bud[2]))}` : '無し'}）`);
  }
}

console.log('\nG-3) 🏆 の詳細は名前・車種 key が文字列にできないエントリーでも描ける（BL-3 の申し送り）— 是正前: esc(e.name)・entryCarLabel が TypeError');
{
  // entryCarLabel は main.js の本文（DOM を前提にする main.js は import できない）を取り出し、本物の CAR_TYPE_BY_KEY で評価する。
  const MAINS = readFileSync(join(JS, 'main.js'), 'utf8');
  const a = MAINS.indexOf('function entryCarLabel('), b = MAINS.indexOf('\n}\n', a);
  ok(a >= 0 && b > a, 'main.js に entryCarLabel の本文がある');
  const cfg = await import(pathToFileURL(join(JS, 'config.js')).href);
  const prodECL = new Function('CAR_TYPE_BY_KEY', 'carTypeLabel', `${MAINS.slice(a, b + 2)}\nreturn entryCarLabel;`)(cfg.CAR_TYPE_BY_KEY, (k) => 'LABEL:' + String(k));
  const BAD = { toString: 1 };
  {
    let th = null, r;
    try { r = prodECL(undefined, { key: BAD, name: 'NM' }); } catch (e) { th = e; }
    ok(th === null && r === 'NM', `entryCarLabel(carType 無し, carDef.key={toString:1}) は投げず carDef.name（実 ${th ? th.constructor.name + ': ' + th.message : J(r)}）`);
    let r2, th2 = null;
    try { r2 = [prodECL('normal_fr'), prodECL(undefined, { key: 'normal_ff' }), prodECL('nokey', { name: 'Mine' }), prodECL('constructor'), prodECL(undefined, undefined)]; } catch (e) { th2 = e; }
    ok(th2 === null && J(r2) === J(['LABEL:normal_fr', 'LABEL:normal_ff', 'Mine', 'constructor', '']),
       `entryCarLabel の正常値は従来どおり（実 ${th2 ? th2.message : J(r2)}）`);
  }
  ECL = prodECL;
  const BADR = () => ({
    event: { id: 'bl4-bad', course: 'オーバル', laps: 1, class: 'open' },
    entries: [ent(BAD, 'a1', 'c', { k: 0, intro: BAD }), { ...ent('y', 'b2', 'c', { k: 1 }), carType: undefined, carDef: { key: BAD, name: 'NM' } }],
    result: { eventId: 'bl4-bad', verifyHash: 'h', finishers: [
      { rank: 1, name: BAD, author: 'a1', carType: 'normal_fr', totalTimeMs: 1000, bestLapMs: 1000 },
      { rank: 2, name: 'y', author: 'b2', carDef: { key: BAD, name: 'NM' }, totalTimeMs: 2000, penaltiesSec: BAD }] },
  });
  // JSON 経由で配ると toString:1 は「文字列にできない object」のまま届く（openRace は JSON で複製する＝上流の取得と同じ形）。
  let th = null, d = '';
  try { d = await openRace('bl4-bad', BADR); } catch (e) { th = e; }
  ok(th === null && d.includes('id="ofVerify"'), `🏆 の詳細を最後（再実行検証のボタン）まで描く（${th ? `${th.constructor.name}: ${th.message}` : `${d.length} 字`}）`);
  const v = th === null ? await clickVerify('bl4-bad', BADR) : { thrown: new Error('詳細を描けない') };
  ok(v.thrown === null, `「再実行検証」も例外を漏らさない（${v.thrown ? v.thrown.message : v.note.replace(/<[^>]+>/g, '').slice(0, 60)}）`);
  // 持ち込み車種（carDef）の name が文字列にできない値: runRace は走り、結果ダイアログの車種名（race_ui.js fieldCarLabeler）で止まった
  const cfgM = await import(pathToFileURL(join(JS, 'config.js')).href);
  const CARR = () => ({
    event: { id: 'bl4-car', course: 'オーバル', laps: 1, class: 'open' },
    entries: [ent('own', 'a1', 'c', { k: 0, carType: 'bl4_car', carDef: { ...JSON.parse(JSON.stringify(cfgM.CAR_TYPE_BY_KEY.normal_fr)), key: 'bl4_car', name: BAD } }),
      ent('y', 'b2', 'c', { k: 1 })],
    result: null,
  });
  el('raceMeta').innerHTML = ''; el('raceResults').innerHTML = '';
  let vc;
  try { vc = await clickVerify('bl4-car', CARR); } catch (e) { vc = { thrown: e, calls: [] }; }   // 是正前は 🏆 の詳細（esc(carLabel)）で先に止まる
  const rr = el('raceResults').innerHTML;
  ok(vc.thrown === null && vc.calls.length === 1 && rr.includes('race-tab'),
     `持ち込み車種の name が {toString:1} でも再実行検証の結果ダイアログを描く（runRace ${vc.calls.length} 回・結果表 ${rr.includes('race-tab')}${vc.thrown ? '・例外 ' + vc.thrown.constructor.name + ': ' + vc.thrown.message : ''}）`);
  ECL = (k) => String(k || '');
}

console.log('\nG-4) 配線: car_crud.js・race_ui.js のテンプレート文字列の ${…} は esc／数値／固定の一覧のどれか（一覧に無い式は赤）');
// テンプレート文字列の ${…} を全部取り出す（文字列・コメント・正規表現・入れ子のテンプレートを読み飛ばす最小の字句解析）。
function templateSubs(src) {
  const out = [];
  let i = 0;
  const KW = /(?:^|[^\w$])(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;
  const regexAllowed = (j) => {
    let k = j - 1; while (k >= 0 && /\s/.test(src[k])) k--;
    if (k < 0) return true;
    const c = src[k];
    // 後置の ++／--（`k++ / 2`）の後の / は割り算（層4 F3）。前置（`++/re/`）は文法上ありえないので後置だけ見る。
    if ((c === '+' || c === '-') && src[k - 1] === c) { let m = k - 2; while (m >= 0 && /\s/.test(src[m])) m--; if (m >= 0 && /[\w$)\]]/.test(src[m])) return false; }
    if ('(,=:[!&|?{};+-*%<>~^'.includes(c)) return true;
    return /[\w$]/.test(c) ? KW.test(src.slice(Math.max(0, k - 10), k + 1)) : false;
  };
  const skipString = (q) => { i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; };
  const skipRegex = () => {
    i++; let cls = false;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '[') cls = true; else if (c === ']') cls = false; else if (c === '/' && !cls) break;
      else if (c === '\n') throw new Error('正規表現の途中で改行 @' + i);
      i++;
    }
    i++; while (/[a-z]/.test(src[i] || '')) i++;
  };
  function code(inSub) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) throw new Error('コメント未終端'); i = e + 2; continue; }
      if (c === "'" || c === '"') { skipString(c); continue; }
      if (c === '`') { template(); continue; }
      if (c === '/' && regexAllowed(i)) { skipRegex(); continue; }
      if (c === '{') depth++;
      if (c === '}') { if (depth === 0 && inSub) return; depth--; }
      i++;
    }
    if (inSub) throw new Error('${ が未終端');
  }
  function template() {
    i++;
    let lit = '';   // このテンプレートの ${ より前の字面（前の ${…} は \u0001 に置く）＝G-4c が属性の引用符を読む
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { lit += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { i++; return; }
      if (c === '$' && src[i + 1] === '{') {
        const rec = { start: i + 2, before: lit }; out.push(rec); i += 2;
        code(true);
        rec.expr = src.slice(rec.start, i).trim(); i++;
        lit += '\u0001';
        continue;
      }
      lit += c;
      i++;
    }
    throw new Error('テンプレート未終端');
  }
  code(false);
  const fns = [...src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([\w$]+)\s*\(/gm)].map((m) => ({ name: m[1], at: m.index }));
  for (const r of out) {
    r.fn = '(top)';
    for (const f of fns) if (f.at < r.start) r.fn = f.name;
    r.line = src.slice(0, r.start).split('\n').length;
  }
  return out;
}
// 式全体が 1 つの呼び出し name(…) か（括弧の対応を見る・文字列の中の括弧は数えない）。
function wholeCall(expr, names) {
  const m = new RegExp(`^(?:${names})\\(`).exec(expr); if (!m) return false;
  let depth = 0, q = null;
  for (let k = m[0].length - 1; k < expr.length; k++) {
    const c = expr[k];
    if (q) { if (c === '\\') k++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return k === expr.length - 1; }
  }
  return false;
}
const autoSafe = (e) => wholeCall(e, 'esc|escapeHtml') || wholeCall(e, 'fmtTime') || /^t\('[^']*'\)$/.test(e);
// 一覧（関数 → 式 → 安全な理由）。利用者由来の値（carDef・entry・event・meta・result の欄）はここに置かない（esc で包む）。
// §5（docs/stage_bl/recheck_v10.3.0.md）の「問題なし」の箇所＝runRace・集計の数値と、エスケープ済みの断片・固定文字列。
const NUM_RACE = 'runRace の出力（race_engine が数値で作る）';
const NUM_AGG = '集計の数え上げ（race_season／race_ladder が数値で作る）';
const PIECE = 'esc 済みの断片か固定文字列だけで組んだ HTML';
const CONST = '固定文字列・定数・インデックス';
const ALLOW = {
  'car_crud.js': {
    renderCarParamTable: { c: 'cols の定数（mass 等）', badge: PIECE, ops: PIECE + '（data-key は escapeHtml）',
      "ct.drift ? `grip ${escapeHtml(ct.drift.grip)}` : '—'": '内側の ${} は escapeHtml（別の行で検査）・ほかは固定文字列',
      k: 'CAR_PARAM_DOC のキー（config.js の定数）', "t('cars.pdoc.' + k)": '自前のカタログ（i18n）の文言' },
    renderCustomCarList: { k: 'const k = escapeHtml(def.key || \'\')（エスケープ済み）' },
    uniqueCarKey: { base: 'HTML ではない（key の文字列を作る）', n: 'HTML ではない（数）' },
    carNumRow: { tip: 'escapeHtml 済み', p: 'CAR_NUM_PARAMS／DRIFT_NUM_PARAMS の定数', numId: "'cf_num_' + 定数",
      min: CONST, max: CONST, step: CONST },
    renderCarForm: { ro: CONST, "on ? ' checked' : ''": CONST, "d.drift.trigger === 'power' ? ' selected' : ''": CONST,
      "d.drift.trigger === 'liftoff' ? ' selected' : ''": CONST, "d.drift.brakeDrift ? ' checked' : ''": CONST },
  },
  'race_ui.js': {
    renderRaceResult: { v: 'metaRows の値（G-4b で全部 esc を確認）', rec: PIECE, recordHtml: PIECE, 'rowCls.trim()': CONST,
      'f.rank': NUM_RACE, 'colorOf(f.idx)': 'FLEET.colors（config.js の定数）', 'colorOf(d.idx)': 'FLEET.colors', 'colorOf(r.idx)': 'FLEET.colors',
      "f.bestLapMs != null ? fmtTime(f.bestLapMs / 1000) : '—'": 'fmtTime（数でなければ --:--.--）',
      "f.penaltiesSec ? '+' + f.penaltiesSec + 's' : '—'": NUM_RACE + '（crashCount×penaltySec）', 'd.lapsCompleted': NUM_RACE,
      "r.muPeakPct != null ? r.muPeakPct + '%' : '—'": NUM_RACE, "r.betaPeakDeg != null ? r.betaPeakDeg + '°' : '—'": NUM_RACE,
      crashCell: NUM_RACE + '＋esc 済みの内訳' },
    renderOfficialDetail: { v: 'metaRows の値（G-4b で全部 esc を確認）',
      "f.totalTimeMs != null ? fmtTime(asNum(f.totalTimeMs) / 1000) : '—'": 'fmtTime（数でなければ --:--.--・割り算の前に asNum＝G-6）',
      "f.bestLapMs != null ? fmtTime(asNum(f.bestLapMs) / 1000) : '—'": 'fmtTime（数でなければ --:--.--・割り算の前に asNum＝G-6）',
      "f.penaltiesSec ? '+' + esc(f.penaltiesSec) + 's' : '—'": 'esc 済み（result.json の値）' },
    officialProgPanels: { i: 'forEach のインデックス' },
    toggleProgSrc: { i: 'HTML ではない（querySelector の数）' },
    rankingsHtml: { "i === 0 && r.points > 0 ? ' class=\"rank-record\"' : ''": CONST, 'i + 1': CONST, meMark: PIECE,
      'r.points': NUM_AGG + '（pointsFor の +t[i]）', 'r.wins': NUM_AGG, 'r.podiums': NUM_AGG, 'r.finishes': NUM_AGG, 'r.dnfs': NUM_AGG,
      'r.starts': NUM_AGG, 'x.n': NUM_AGG, "i === 0 ? ' class=\"rank-record\"' : ''": CONST, medal: CONST, crown: PIECE,
      "r.bestLapMs != null ? fmtTime(asNum(r.bestLapMs) / 1000) : '—'": 'fmtTime（割り算の前に asNum＝G-6）', 'p.entries': NUM_AGG, 'p.authors': NUM_AGG, 'p.wins': NUM_AGG,
      "p.bestMs != null ? fmtTime(asNum(p.bestMs) / 1000) : '—'": 'fmtTime（割り算の前に asNum＝G-6）', "d.author === me ? ' class=\"rank-record\"' : ''": CONST,
      'd.recordsHeld': NUM_AGG, 'd.wins': NUM_AGG, 'd.podiums': NUM_AGG, 'd.events': NUM_AGG, titles: PIECE },
    renderGhostStandings: { "passing ? ' passing' : ''": CONST, 'r.rank': 'ghost_gap の順位（数値）', 'a.colorOf(r.ci)': 'FLEET.colors',
      "passing ? ' <span class=\"ghost-st-up\">▲</span>' : ''": CONST, rowsHtml: PIECE },
    openGhostReplay: { 'colorOf(i)': 'FLEET.colors' },
    renderGhostSectors: { 'FLEET.colors[c.ci % FLEET.colors.length]': 'FLEET.colors', "isBest ? 'sect-best' : ''": CONST,
      "isBest ? ' ●' : ''": CONST, 'c.laps.length': '件数' },
  },
};
for (const file of ['car_crud.js', 'race_ui.js']) {
  const src = readFileSync(join(JS, file), 'utf8');
  let subs;
  try { subs = templateSubs(src); } catch (e) { ok(false, `${file}: 字句解析が通らない（${e.message}）`); continue; }
  const allow = ALLOW[file];
  const used = new Set();
  const bad = [];
  let auto = 0;
  for (const r of subs) {
    if (autoSafe(r.expr)) { auto++; continue; }
    const why = allow[r.fn] && Object.prototype.hasOwnProperty.call(allow[r.fn], r.expr) ? allow[r.fn][r.expr] : null;
    if (why) used.add(r.fn + '\u0000' + r.expr); else bad.push(`${file}:${r.line} ${r.fn} \${${r.expr}}`);
  }
  const stale = Object.entries(allow).flatMap(([fn, o]) => Object.keys(o).filter((e) => !used.has(fn + '\u0000' + e)).map((e) => `${fn} \${${e}}`));
  console.log(`  ${file}: \${…} ${subs.length} 個（esc／fmtTime／t('…') ${auto}・一覧 ${subs.length - auto - bad.length}・一覧に無い ${bad.length}）`);
  ok(bad.length === 0, `${file}: 一覧に無い \${…} が 0 個（実 ${bad.length}${bad.length ? ': ' + bad.join(' / ') : ''}）`);
  ok(stale.length === 0, `${file}: 一覧の式がすべてソースにある（古い行 ${stale.length}${stale.length ? ': ' + stale.join(' / ') : ''}）`);
}
// G-4c（層4 往復 1 の F2）: 属性の値に入る ${…} は " で囲む（escape.js は ' をエスケープしない＝' 囲み・引用符なしの属性に
//   入れると esc を通しても抜け出せる）。テンプレートの字面で ${ の直前がタグの中（最後の < が最後の > より後）なら、
//   直前の `=` からの字面を読み、`="…` の中なら可・`='…` の中と `=` の直後（引用符なし）は赤。
console.log('\nG-4c) 配線: car_crud.js・race_ui.js のテンプレート文字列で属性の値に入る ${…} は " で囲む（\' 囲み・引用符なしは赤）');
const attrCtx = (before) => {
  const lt = before.lastIndexOf('<'), gt = before.lastIndexOf('>');
  if (lt < 0 || lt < gt) return 'text';
  const tag = before.slice(lt);
  if (/=\s*"[^"]*$/.test(tag)) return 'dq';
  if (/=\s*'[^']*$/.test(tag)) return 'sq';
  if (/=\s*$/.test(tag)) return 'bare';
  return 'tag';   // タグの中だが属性の値ではない（例: <tr${cls}>）
};
{
  // 判定の自己検査（検査が「' 囲みを赤にする」ことを、合成したソースで確かめる）
  const synth = "function f(x) { return `<b title='${esc(x)}'>a</b><i title=${esc(x)}>b</i><u title=\"${esc(x)}\">c</u><s data-i=\"${x} ${esc(x)}\">d</s><p>${esc(x)}</p>`; }";
  const got = templateSubs(synth).map((r) => attrCtx(r.before));
  ok(J(got) === J(['sq', 'bare', 'dq', 'dq', 'dq', 'text']), `判定の自己検査: ' 囲み・引用符なし・" 囲み×3・本文 → ${J(got)}`);
  // BL5 層4 F3 の兄弟: 後置 ++／-- の後の / を正規表現と取り違えない（取り違えると正規表現の途中の改行で投げる＝G-4 が赤で止まる）
  const pf = (src) => { try { return templateSubs(src).map((r) => r.expr); } catch (e) { return 'throw'; } };
  const q1 = pf("k++ / 2;\nconst s = `${esc(a)}`;\nconst q = W / 3;"), q2 = pf("k-- / 2;\nconst s = `${esc(b)}`;\nconst q = W / 3;");
  ok(J(q1) === J(['esc(a)']) && J(q2) === J(['esc(b)']), `字句解析の自己検査: 後置 ++／-- の後の / は割り算 → ${J(q1)}・${J(q2)}`);
  for (const file of ['car_crud.js', 'race_ui.js']) {
    const subs = templateSubs(readFileSync(join(JS, file), 'utf8'));
    const tally = { text: 0, tag: 0, dq: 0, sq: 0, bare: 0 };
    const bad = [];
    for (const r of subs) { const c = attrCtx(r.before); tally[c]++; if (c === 'sq' || c === 'bare') bad.push(`${file}:${r.line} ${r.fn} \${${r.expr}}（${c}）`); }
    console.log(`  ${file}: 本文 ${tally.text}・属性の値（" 囲み）${tally.dq}・タグの中（値でない）${tally.tag}・' 囲み ${tally.sq}・引用符なし ${tally.bare}`);
    ok(bad.length === 0 && tally.dq > 0, `${file}: 属性の値の \${…} は全部 " 囲み（' 囲み・引用符なし ${bad.length}${bad.length ? ': ' + bad.join(' / ') : ''}）`);
  }
}

console.log('\nG-4b) 配線: race_ui.js の metaRows（renderRaceResult・renderOfficialDetail の表の値）は全部 esc');
{
  const src = readFileSync(join(JS, 'race_ui.js'), 'utf8');
  const vals = [];
  for (const m of src.matchAll(/metaRows(?: = \[|\.push\()/g)) {
    // 対応する ] / ) までを取り、その中の [k, v] の v を読む
    let k = m.index + m[0].length, depth = 1, q = null;
    const start = k;
    for (; k < src.length && depth > 0; k++) {
      const c = src[k];
      if (q) { if (c === '\\') k++; else if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; continue; }
      if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--;
    }
    const body = src.slice(start, k - 1);
    // 各 [t('…'), 値] の値＝`, ` の後から、対応の取れた ] までを読む（値の中の括弧・文字列は数えない）
    for (const p of body.matchAll(/\[t\('[^']+'\),\s*/g)) {
      let j = p.index + p[0].length, dep = 0, qq = null;
      for (; j < body.length; j++) {
        const c = body[j];
        if (qq) { if (c === '\\') j++; else if (c === qq) qq = null; continue; }
        if (c === "'" || c === '"' || c === '`') { qq = c; continue; }
        if ('([{'.includes(c)) dep++;
        else if (')]}'.includes(c)) { if (dep === 0) break; dep--; }
      }
      vals.push({ line: src.slice(0, start).split('\n').length, v: body.slice(p.index + p[0].length, j).trim() });
    }
  }
  const okv = (v) => wholeCall(v, 'esc') || v === "'<code>' + esc(res.verifyHash) + '</code>'";
  const badv = vals.filter((x) => !okv(x.v));
  ok(vals.length >= 17, `metaRows の値を読めた（${vals.length} 個・renderRaceResult 10＋renderOfficialDetail 7）`);
  ok(badv.length === 0, `metaRows の値は全部 esc（esc でない値 ${badv.length}${badv.length ? ': ' + badv.map((x) => x.v).join(' / ') : ''}）`);
}

console.log('\nG-5) car_crud.js 車種表と編集フォーム（自作車・投稿車種・組込の上書き）— 是正前: パラメータ値・drift.grip・value="…" が生のまま');
{
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } } });
  globalThis.confirm = () => true;
  // 経路 ①: localStorage の自作車（initCarCrud が起動時に registerCarType）② 組込の上書き（applyCarOverride）③ 投稿車種（registerCarType）
  store.set('rumicar.customCars', JSON.stringify([{ key: 'bl4_evil', name: 'BL4 evil', mass: XA, accel: XT, drift: { grip: XT, trigger: 'power' } }]));
  store.set('rumicar.carOverrides', JSON.stringify({ normal_fr: { mass: XA } }));
  const cfg = await import(pathToFileURL(join(JS, 'config.js')).href);
  const shippedMass = cfg.CAR_TYPE_BY_KEY.normal_fr.mass;
  const { initCarCrud } = await import(pathToFileURL(join(JS, 'car_crud.js')).href);
  const CC = initCarCrud({ $: el, escapeHtml: ESC, carTypeName: (ct) => String(ct.name), logLine() {}, buildFleetColumns() {}, pruneSlotCarTypes() {}, submitToGithub() {} });
  const comm = cfg.registerCarType({ key: 'bl4_comm', name: 'BL4 comm', brake: XT, drift: { grip: XA } });
  comm.community = true;
  CC.renderCarParamTable();
  const h = el('carParamTable').innerHTML;
  const rowOf = (name) => (h.split('<tr>').find((r) => r.includes(name)) || '');
  const cells = (row) => [...row.matchAll(/<td[^>]*>([^]*?)<\/td>/g)].map((m) => unescH(m[1].replace(/<[^>]+>/g, '')));
  for (const [label, name, want] of [
    ['自作車（localStorage）', 'BL4 evil', { 1: XA, 2: XT, 10: 'grip ' + XT }],
    ['投稿車種（registerCarType）', 'BL4 comm', { 3: XT, 10: 'grip ' + XA }],
    ['組込の上書き（applyCarOverride）', '<td class="pname">ノーマル', { 1: XA }],
  ]) {
    const row = name.startsWith('<') ? (h.split('<tr>').find((r) => r.includes(name) && r.includes('car-ovr-reset')) || '') : rowOf(name);
    const r = inert(row), c = cells(row);
    const seen = Object.entries(want).every(([i, v]) => c[i] === v);
    ok(row.length > 0 && inertOk(r) && seen, `車種表 ${label}: <img ${r.img}・onerror を持つタグ ${r.onTag}・&lt;img ${r.lt}・値は文字列のまま ${seen}（${J(Object.keys(want).map((i) => c[i]))}）`);
  }
  // 編集フォーム: 自作車の一覧の「編集」（customCarList の click 委譲）・組込の「編集」（carParamTable の click 委譲）・JSON → フォーム
  const clickOn = (id, cls, key) => el(id).fire('click', { target: { closest: () => ({ dataset: { key }, classList: { contains: (c) => c === cls } }) } });
  const formCases = [
    ['自作車の「編集」', () => clickOn('customCarList', 'carlist-edit', 'bl4_evil'), { mass: XA, accel: XT, grip: XT }],
    ['組込の上書きの「編集」', () => clickOn('carParamTable', 'car-ovr-edit', 'normal_fr'), { mass: XA }],
    ['JSON → フォーム', () => { el('carOvrCancelBtn').fire('click'); el('carJsonInput').value = JSON.stringify({ key: 'k', name: 'n', mass: XA, slide: XT }); el('carFormFromJson').fire('click'); }, { mass: XA, slide: XT }],
  ];
  for (const [label, act, want] of formCases) {
    let th = null;
    try { act(); } catch (e) { th = e; }
    const f = el('carForm').innerHTML;
    const r = inert(f);
    const got = {};
    for (const p of Object.keys(want)) {
      const num = tagsOf(f).find((x) => x.includes(`id="cf_num_${p}"`));
      const rng = tagsOf(f).find((x) => x.includes(`data-num="cf_num_${p}"`));
      got[p] = [num ? attrsOf(num).value : null, rng ? attrsOf(rng).value : null];
    }
    const same = Object.entries(want).every(([p, v]) => got[p][0] === v && got[p][1] === v);
    ok(th === null && inertOk(r) && same, `編集フォーム ${label}: <img ${r.img}・onerror を持つタグ ${r.onTag}・&lt;img ${r.lt}・value 属性は元の文字列のまま ${same}${th ? '・例外 ' + th.message : ''}`);
  }
  // 正常値: 出荷車種の行の textContent は是正前の書き方（`${ct[c] != null ? ct[c] : '-'}`・`grip ${ct.drift.grip}`）と同じ
  el('carOvrCancelBtn').fire('click');
  el('carOvrBar').fire('click', { target: { closest: () => ({ dataset: {}, classList: { contains: (c) => c === 'car-ovr-clearall' } }) } });
  ok(cfg.CAR_TYPE_BY_KEY.normal_fr.mass === shippedMass, `組込の上書きを全解除して出荷値へ戻った（normal_fr.mass ${cfg.CAR_TYPE_BY_KEY.normal_fr.mass}）`);
  CC.renderCarParamTable();
  const h2 = el('carParamTable').innerHTML;
  const cols = ['mass', 'accel', 'brake', 'maxSpeed', 'spin', 'us', 'os', 'powerUs', 'powerOs'];
  const builtin = cfg.CAR_TYPES.filter((ct) => !ct.custom && !ct.community);
  let same = 0; const diff = [];
  for (const ct of builtin) {
    const row = h2.split('<tr>').find((r) => r.includes(`data-key="${escH(ct.key)}"`)) || '';
    const got = cells(row).slice(1, 11);
    const want = cols.map((c) => String(ct[c] != null ? ct[c] : '-')).concat([ct.drift ? `grip ${ct.drift.grip}` : '—']);
    if (J(got) === J(want)) same++; else diff.push(`${ct.key}: ${J(got)} / ${J(want)}`);
  }
  ok(builtin.length === 6 && same === 6, `出荷車種 6 種の行の表示は是正前の書き方と同一（${same}/${builtin.length}${diff.length ? '・' + diff.join(' ; ') : ''}）`);
  cfg.unregisterCarType('bl4_evil'); cfg.unregisterCarType('bl4_comm');
}

console.log('\nG-6) 層4 往復 1・2（F1〜F4）: 文字列にできない値の同族 — t() の差し込み・🏆 詳細／🍴／再実行検証／🏅／打破通知／👻 を値の欄ごとに・車種名');
// 是正前（8a4bd2e）: i18n.js t() の `s.split('{k}').join(vars[k])` は join が値を文字列にするところで TypeError を投げ、
// t() を esc の前に呼ぶ全部の経路（race_ui の勝者・最速ラップ・公式結果の 1 行・旧版の注記 等）が止まった。
// 設計: 差し込みの 1 か所（i18n.js t()）で守る。join が投げたときだけ String(v)（Symbol は "Symbol()"）、それも投げれば '?'
// （escape.js と同じ規則）。投げない値は従来の join と 1 文字も変わらない（undefined は従来どおり join の既定の ","）。
// 車種名の依存注入は main.js の product の本文（carTypeName・carTypeLabel・entryCarLabel）を取り出して評価する（mock だと
// mock 自身の String() が投げて product と違う答えになる）。
const MAIN6 = readFileSync(join(JS, 'main.js'), 'utf8');
const cut6 = (from, to) => { const a = MAIN6.indexOf(from); const b = MAIN6.indexOf(to, a); if (a < 0 || b < 0) throw new Error('main.js に ' + from + ' が無い'); return MAIN6.slice(a, b + to.length); };
const cfg6 = await import(pathToFileURL(join(JS, 'config.js')).href);
const L6 = new Function('CAR_TYPE_BY_KEY', 'hasKey', 't',
  `${cut6('const carTypeName = (ct) => {', '\n};')}\n${cut6('function carTypeLabel(key) {', '}\n')}\n${cut6('function entryCarLabel(', '\n}\n')}\nreturn { carTypeName, carTypeLabel, entryCarLabel };`)(cfg6.CAR_TYPE_BY_KEY, i18n.hasKey, i18n.t);
{
  const BADS = [
    ['JSON の {"toString":1}', () => JSON.parse('{"toString":1}'), '?'], ['{toString:1}', () => ({ toString: 1 }), '?'],
    ['Object.create(null)', () => Object.create(null), '?'], ['Symbol()', () => Symbol(), 'Symbol()'],
    ["Symbol('<b>')", () => Symbol('<b>'), 'Symbol(<b>)'], ['Proxy（どの読み出しも投げる）', () => new Proxy({}, { get() { throw new Error('trap'); } }), '?'],
    ['配列 [{"toString":1}]', () => JSON.parse('[{"toString":1}]'), '?'],
  ];
  const tmpl = (key) => i18n.t(key);   // 差し込み前の文言（{name} 等が残る）
  for (const key of ['race.winner', 'official.result.verified']) {
    const toks = (tmpl(key).match(/\{(\w+)\}/g) || []).map((x) => x.slice(1, -1));
    for (const [label, mk, want] of BADS) {
      const vars = Object.fromEntries(toks.map((k) => [k, mk()]));
      let r, th = null;
      try { r = i18n.t(key, vars); } catch (e) { th = e; }
      const exp = toks.reduce((s, k) => s.split('{' + k + '}').join(want), tmpl(key));
      ok(th === null && r === exp, `t('${key}', {${toks.join(',')}: ${label}}) → ${th ? th.constructor.name + ': ' + th.message : J(r)}（期待 ${J(exp)}）`);
    }
  }
  // 投げない値は是正前の式（join）と同じ文字列
  const NORMAL = [['文字列', 'x<y'], ['空文字', ''], ['数値 5', 5], ['0', 0], ['1.5', 1.5], ['NaN', NaN], ['null', null], ['undefined', undefined],
    ['true', true], ['配列 ["a","b"]', ['a', 'b']], ["{toString(){return 'z'}}", { toString() { return 'z'; } }], ['{}', {}]];
  let same = 0; const diff = [];
  for (const [label, v] of NORMAL) {
    const want = tmpl('race.winner').split('{name}').join(v);
    const got = i18n.t('race.winner', { name: v });
    if (got === want) same++; else diff.push(`${label}: ${J(got)} / ${J(want)}`);
  }
  ok(same === NORMAL.length, `t() の差し込みは投げない値で是正前の join と同一（${same}/${NORMAL.length}${diff.length ? '・' + diff.join(' ; ') : ''}）`);
  // 差し込みの実装は i18n.js の 1 か所だけ（写しがあればそこは守られない）。呼び出しの数は表に出す（全部この 1 か所を通る）。
  const interp = [];
  const { readdirSync } = await import('node:fs');
  const all = readdirSync(JS).filter((f) => f.endsWith('.js'));
  for (const f of all) {
    const s = readFileSync(join(JS, f), 'utf8');
    for (const m of s.matchAll(/split\(\s*'\{'/g)) interp.push(`${f}:${s.slice(0, m.index).split('\n').length}`);
  }
  ok(interp.length === 1 && interp[0].startsWith('i18n.js:'), `{…} の差し込みは i18n.js t() の 1 か所だけ（${interp.join(' / ')}）`);
  const counts = all.map((f) => [f, (readFileSync(join(JS, f), 'utf8').match(/\bt\(\s*(?:'[^']*'|[\w.$]+(?:\s*\+\s*[^,()]+)?)\s*,\s*\{/g) || []).length]).filter(([, n]) => n);
  console.log(`  t(…, {…}) の呼び出し（差し込みのある t・ファイル別）: ${counts.map(([f, n]) => `${f} ${n}`).join('・')}＝計 ${counts.reduce((a, [, n]) => a + n, 0)}`);
}

// G-6b: 🏆 詳細（selectOfficialRace → renderOfficialDetail）・🍴 fork・「再実行検証」（ofVerify の click → verifyOfficialLocally →
//   renderRaceResult）・🏅 の集計（loadAllOfficialData → renderRankings）・打破通知（checkBeaten）・👻（ghostVsWorld）を、大会
//   （event／entries／result）の値の欄を 1 つずつ文字列にできない値に替えて呼ぶ（欄 × 入口の表）。
//   JSON で届く値（上流の取得は JSON）＝{"toString":1}。Object.create(null)・Symbol() は JSON から作れないが、同じ表で試す（複製しない）。
//   層4 往復 2: 欄は event・entries・result の**全部の葉と途中の object**（regime・maxSec・crashRule・physicsMode・recon・wear・
//   minField・result の class／course／regime／laps・finishers[].programRef／classifiedMs・entries[].carDef の全パラメータと drift.*）。
//   大会は 2 つ（bl4-f＝値を替える側・bl4-h＝正常で、bl4-f の 2 位〔b2〕と classifiedMs・bestLapMs が並ぶ＝race_ladder の
//   並べ替えの名前比較が走る）。各入口の判定: ok／入口の try が拾った（「【エラー】…」の 1 行＝欄ごとの防御の漏れ・この表では赤）／
//   例外が漏れた（赤）／無言（赤）／🏅 から正常な bl4-h が外れた（赤）。入口の try そのものは G-6e が依存の側から投げて測る。
{
  ECL = L6.entryCarLabel; CTL = L6.carTypeLabel;
  const CD = () => ({ ...JSON.parse(JSON.stringify(cfg6.CAR_TYPE_BY_KEY.drift_ff)), key: 'bl4_cd', name: 'CD' });
  const RICH = () => ({
    event: { id: 'bl4-f', title: 'T', course: 'オーバル', laps: 1, class: 'open', engineVer: 'v0.0.1', season: 'S1', points: [10, 8],
      regime: 'tabletop', maxSec: 120, crashRule: { rejoin: true, penaltySec: 3 }, interact: true, physicsMode: 'dynamic', recon: 0, wear: false,
      minField: 3, entryWindow: { open: '2026-01-01T00:00:00Z', close: '2026-01-02T00:00:00Z' } },
    entries: [ent('e1', 'a1', 'c', { k: 0, intro: 'I1', carDef: CD() }), ent('e2', 'b2', 'py', { k: 1 })],
    result: { eventId: 'bl4-f', verifyHash: 'h', engineVer: 'v0.0.1', exec: 'x', class: 'open', course: 'オーバル', regime: 'tabletop', laps: 1,
      finishers: [
        { rank: 1, name: 'e1', author: 'a1', carType: 'normal_fr', totalTimeMs: 1000, bestLapMs: 900, penaltiesSec: 2, programRef: 'entries/e1.json', classifiedMs: 3000 },
        { rank: 2, name: 'e2', author: 'b2', carType: 'normal_fr', totalTimeMs: 2000, bestLapMs: 1000, penaltiesSec: 0, programRef: 'entries/e2.json', classifiedMs: 2000 }],
      dnf: [{ name: 'e3', author: 'c3', carType: 'normal_fr', lapsCompleted: 0, reason: 'crash' }] },
  });
  // 正常な 2 つ目の大会（同じクラス×コース・b2 と並ぶ 1 件）
  const H = () => ({
    event: { id: 'bl4-h', title: 'H', course: 'オーバル', laps: 1, class: 'open', engineVer: 'v0.0.1', season: 'S1' },
    entries: [ent('h1n', 'h1', 'c', { k: 0 })],
    result: { eventId: 'bl4-h', verifyHash: 'hh', engineVer: 'v0.0.1', exec: 'x', finishers: [
      { rank: 1, name: 'h1n', author: 'h1', carType: 'normal_fr', totalTimeMs: 2000, bestLapMs: 1000, penaltiesSec: 0 }], dnf: [] },
  });
  BL3.races['bl4-h'] = () => JSON.parse(JSON.stringify(H()));
  {
    // 前提: bl4-f の b2 と bl4-h の h1 は同じ枠で classifiedMs・bestLapMs が並ぶ（名前比較まで進む）
    const ladderM = await import(pathToFileURL(join(JS, 'race_ladder.js')).href);
    const bd = ladderM.aggregate([RICH(), H()]).boards;
    const rows = bd.length === 1 ? bd[0].rows : [];
    const b2 = rows.find((r) => r.author === 'b2'), h1 = rows.find((r) => r.author === 'h1');
    ok(!!b2 && !!h1 && b2.classifiedMs === h1.classifiedMs && b2.bestLapMs === h1.bestLapMs,
       `前提: 2 大会は 1 つの枠で b2 と h1 が classifiedMs・bestLapMs とも並ぶ（枠 ${bd.length}・${b2 && h1 ? `${b2.classifiedMs}/${h1.classifiedMs}・${b2.bestLapMs}/${h1.bestLapMs}` : '行なし'}）`);
  }
  // 打破通知（checkBeaten・🏅 の「抜かれた記録」の行）も通す: 自分＝a1（ペナルティ 2 秒で換算 3.0 秒＞b2 の 2.0 秒＝b2 が世界ベスト）
  localStorage.setItem('rumicar.author', 'a1');
  const leaves = [];
  const walk = (o, p) => {
    for (const k of Object.keys(o)) {
      const v = o[k], q = [...p, k];
      if (k === 'src') { leaves.push(q); continue; }
      if (v && typeof v === 'object') { leaves.push(q); walk(v, q); } else leaves.push(q);
    }
  };
  walk(RICH(), []);
  const setAt = (o, p, v) => { let x = o; for (const k of p.slice(0, -1)) x = x[k]; x[p[p.length - 1]] = v; return o; };
  // 予算クラスの欄（class: 'budget' のときだけ読む）・エントリー／完走の 1 件そのものが object でない（loader.js fetchRace は
  // null 以外の JSON をそのまま entries に積む・result.json の finishers は上流の値のまま）
  const extra = [[['event', 'budget', 'total'], (r) => { r.event.class = 'budget'; r.event.budget = { total: 1e9 }; }],
    // 結果の無い大会は受付期間で状態を決める（race_ui.js raceStatus の Date.parse。結果があれば読まない）
    [['event', 'entryWindow', 'open'], (r) => { r.result = null; }], [['event', 'entryWindow', 'close'], (r) => { r.result = null; }],
    // 世界ベスト（b2）の作者がどのエントリーにも一致しないとき、👻 は programRef で引く（race_ui.js entryForRecord・F3）
    [['result', 'finishers', 1, 'programRef'], (r) => { r.result.finishers[1].author = 'zz'; }]];
  const whole = [[['entries', 0], 5], [['entries', 1], 'x'], [['entries', 1], true], [['entries', 0], []],
    [['result', 'finishers', 0], null], [['result', 'finishers', 1], 5], [['result'], 5], [['result', 'finishers'], 'x']];
  const VALS = [['{"toString":1}', () => JSON.parse('{"toString":1}'), true], ['Object.create(null)', () => Object.create(null), false], ['Symbol()', () => Symbol(), false]];
  const ERRP = i18n.t('log.err.setup', { e: '\u0000' }).split('\u0000')[0];   // 入口の try の 1 行の頭（「【エラー】」）
  const REFUSE = i18n.t('log.err.setup', { e: 'program.lang' });              // 🍴 は言語が文字列でないエントリーを取り込まない
  const strip = (h) => String(h).replace(/<[^>]+>/g, '').slice(0, 120);
  const sapCalls = [];
  const runEntries = async (withFork) => {
    const st = {};
    try { await ui.selectOfficialRace('bl4-f'); const d = el('ofDetail').innerHTML; st.detail = d.includes(ERRP) ? '入口の try: ' + strip(d) : d.includes('id="ofVerify"') ? 'ok' : 'ボタン無し'; } catch (e) { st.detail = `漏れ ${e.constructor.name}: ${e.message}`; }
    if (withFork) {
      logs.length = 0; sapCalls.length = 0;
      try {
        for (let i = 0; i < 2; i++) ui.forkOfficialEntry(i);
        const outer = logs.filter((x) => x.startsWith(ERRP) && x !== REFUSE);
        const badArgs = sapCalls.filter(([c, l]) => typeof c !== 'string' || typeof l !== 'string');
        st.fork = outer.length ? '入口の try: ' + outer[0] : badArgs.length ? 'setActiveProgram に文字列でない値' : 'ok';
      } catch (e) { st.fork = `漏れ ${e.constructor.name}: ${e.message}`; }
    }
    el('ofVerify')._l = {}; el('ofVerifyNote').innerHTML = ''; el('dlgRace').open = false;
    try {
      await ui.selectOfficialRace('bl4-f'); el('ofVerify').fire('click');
      const n = el('ofVerifyNote').innerHTML;
      st.verify = n.includes(ERRP) ? '入口の try: ' + strip(n) : (el('dlgRace').open || n.trim()) ? 'ok' : '無言';
    } catch (e) { st.verify = `漏れ ${e.constructor.name}: ${e.message}`; }
    let rk = '';
    try {
      await ui.loadOfficialRaces(true); await ui.loadAllOfficialData(true); ui.renderRankings(); rk = el('rankBody').innerHTML;
      st.rank = rk.includes(ERRP) ? '入口の try: ' + strip(rk) : !rk.includes('h1n') ? '正常な bl4-h が外れた' : 'ok';
    } catch (e) { st.rank = `漏れ ${e.constructor.name}: ${e.message}`; }
    const m = /class="rank-vsworld" data-cls="([^"]*)" data-course="([^"]*)"/.exec(rk);
    logs.length = 0;
    try { ui.checkBeaten(); const o = logs.filter((x) => x.startsWith(ERRP)); st.beaten = o.length ? '入口の try: ' + o[0] : 'ok'; } catch (e) { st.beaten = `漏れ ${e.constructor.name}: ${e.message}`; }
    logs.length = 0;
    if (m) { try { ui.ghostVsWorld(unescH(m[1]), unescH(m[2])); const o = logs.filter((x) => x.startsWith(ERRP)); st.ghost = o.length ? '入口の try: ' + o[0] : 'ok'; } catch (e) { st.ghost = `漏れ ${e.constructor.name}: ${e.message}`; } } else st.ghost = '—';
    return st;
  };
  SAP = (c, l) => { sapCalls.push([c, l]); };
  const rows = [];
  let cases = 0;
  BL3.list = ['bl4-f', 'bl4-h'];
  for (const [vl, mk, viaJson] of VALS) {
    for (const [p, pre] of [...leaves.map((p) => [p, null]), ...extra]) {
      cases++;
      const make = () => { const r = RICH(); if (pre) pre(r); return setAt(r, p, mk()); };
      BL3.races['bl4-f'] = viaJson ? () => JSON.parse(JSON.stringify(make())) : make;
      const st = await runEntries(true);
      rows.push({ v: vl, path: p.join('.'), st, bad: Object.entries(st).filter(([, v]) => v !== 'ok' && v !== '—') });
    }
  }
  for (const [p, v] of whole) {
    cases++;
    const make = () => setAt(RICH(), p, v);
    BL3.races['bl4-f'] = () => JSON.parse(JSON.stringify(make()));
    const st = await runEntries(false);
    rows.push({ v: J(v), path: p.join('.'), st, bad: Object.entries(st).filter(([, x]) => x !== 'ok' && x !== '—') });
  }
  console.log(`  欄 ${leaves.length + extra.length} 個（葉と途中の object・予算／受付期間／programRef の前提つき）× 値 ${VALS.length} ＋ 1 件ごと object でない ${whole.length} 通り＝${cases} 通り`);
  // 表が空振りしていない: 元の大会は 6 つの入口を全部通る（👻 のボタンが出て runRace を呼ぶ・再実行検証は「一致／不一致」の行）
  {
    BL3.races['bl4-f'] = () => JSON.parse(JSON.stringify(RICH()));
    el('ofVerify')._l = {}; el('ofVerifyNote').innerHTML = '';
    await ui.selectOfficialRace('bl4-f'); BL3.calls.length = 0; el('ofVerify').fire('click');
    const vn = el('ofVerifyNote').innerHTML, rr = el('raceResults').innerHTML;
    await ui.loadOfficialRaces(true); await ui.loadAllOfficialData(true); ui.renderRankings();
    const rb = el('rankBody').innerHTML;
    const m = /class="rank-vsworld" data-cls="([^"]*)" data-course="([^"]*)"/.exec(rb);
    const n0 = BL3.calls.length;
    if (m) ui.ghostVsWorld(unescH(m[1]), unescH(m[2]));
    logs.length = 0; ui.checkBeaten();
    const beatenLog = logs.some((x) => x.includes('b2')), beatenRow = rb.includes('<ul class="rank-beaten"><li>');
    sapCalls.length = 0; ui.forkOfficialEntry(0); ui.forkOfficialEntry(1);
    const forkOk = sapCalls.length === 2 && sapCalls.every(([c, l]) => typeof c === 'string' && c.includes(SRC_C.slice(0, 20)) === (l === 'c'));
    ok(n0 === 1 && /official-verify-note/.test(vn) && rr.includes('race-tab') && !!m && BL3.calls.length === 2 && beatenLog && beatenRow && rb.includes('h1n') && rb.includes('e1') && forkOk,
       `元の 2 大会で 6 つの入口を通る（再実行の runRace ${n0} 回・結果表 ${rr.includes('race-tab')}・🏅 の 👻 ボタン ${!!m}・👻 の runRace ${BL3.calls.length - n0} 回・打破通知 ${beatenLog}・🏅 の抜かれた記録の行 ${beatenRow}・🏅 に bl4-f と bl4-h ${rb.includes('e1')}/${rb.includes('h1n')}・🍴 ${sapCalls.map(([, l]) => l).join(',')}）`);
  }
  const badRows = rows.filter((r) => r.bad.length);
  for (const r of badRows) console.log(`    ✗ ${r.v} ${r.path}: ${r.bad.map(([k, v]) => `${k}=${v}`).join(' ; ')}`);
  const outerN = rows.filter((r) => r.bad.some(([, v]) => v.startsWith('入口の try'))).length;
  const leakN = rows.filter((r) => r.bad.some(([, v]) => v.startsWith('漏れ'))).length;
  ok(badRows.length === 0, `大会の値の欄 × 値 ${cases} 通り × 入口（🏆 詳細・🍴 fork・再実行検証・🏅 の集計・打破通知・👻）がどれも正常に描くか個別の 1 行で知らせる（赤の行 ${badRows.length}＝うち例外が漏れた ${leakN}・入口の try が拾った ${outerN}）`);
  // 🏅: 読めない大会が 1 つあっても、ほかの大会の集計は出る（外すのは読めない値を持つ大会）。
  {
    const G = () => { const r = RICH(); r.event.id = r.result.eventId = 'bl4-g'; r.event.title = 'G';
      r.entries = [ent('g1n', 'g1', 'c', { k: 0, program: { lang: JSON.parse('{"toString":1}'), src: SRC_C } })];
      r.result.finishers = [{ rank: 1, name: 'g1n', author: 'g1', carType: 'normal_fr', totalTimeMs: 500, bestLapMs: 500, penaltiesSec: 0 }];
      r.result.dnf = []; return r; };
    BL3.races['bl4-f'] = () => JSON.parse(JSON.stringify(RICH()));
    BL3.races['bl4-g'] = () => JSON.parse(JSON.stringify(G()));
    BL3.list = ['bl4-f', 'bl4-g'];
    let th = null, rb = '';
    try { await ui.loadOfficialRaces(true); await ui.loadAllOfficialData(true); ui.renderRankings(); rb = el('rankBody').innerHTML; } catch (e) { th = e; }
    const hasF = rb.includes('rank-board') && rb.includes('b2'), hasG = rb.includes('g1');
    ok(th === null && hasF && !hasG, `🏅 は読めない大会（entries の program.lang が {"toString":1}）だけを外し、ほかの大会の表を出す（例外 ${th ? th.message : 'なし'}・bl4-f の行 ${hasF}・bl4-g の行 ${hasG}）`);
  }
  // F4（層4 往復 2）: result.json の finishers の object でない 1 件（null・数）は 7 つの空のセルの行（旧実装は順位のセルに undefined）
  {
    const NR = () => { const r = RICH(); r.result.finishers = [null, 5, r.result.finishers[0]]; return r; };
    BL3.races['bl4-f'] = () => JSON.parse(JSON.stringify(NR())); BL3.list = ['bl4-f'];
    let d = '', th = null;
    try { await ui.selectOfficialRace('bl4-f'); d = el('ofDetail').innerHTML; } catch (e) { th = e; }
    const tb = d.slice(d.lastIndexOf('<tbody>')).split('</tbody>')[0];
    const trs = tb.match(/<tr>.*?<\/tr>/g) || [];
    const EMPTY = '<tr>' + '<td></td>'.repeat(7) + '</tr>';
    ok(th === null && trs.length === 3 && trs[0] === EMPTY && trs[1] === EMPTY && trs[2].includes('<td>e1</td>') && !d.includes('undefined'),
       `🏆 の公式記録: finishers の null・5 は空の行・3 行目は e1（${th ? '例外 ' + th.message : `行 ${trs.length}・空の行 ${trs.filter((x) => x === EMPTY).length}・undefined ${d.includes('undefined')}`}）`);
  }
  // F2（層4 往復 2）: どちらも単独なら通る 2 大会が、組み合わさったときだけ投げる（同タイムで名前比較が走る）。一覧の順を
  //   どちらにしても、読めない値を持つ側（bl4-x）だけが外れ、正常な側（bl4-h）の行・打破通知・👻 が出る。
  {
    const BADV = JSON.parse('{"toString":1}');
    const X = (field) => () => { const r = H(); r.event.id = r.result.eventId = 'bl4-x'; r.result.verifyHash = 'hx';
      r.entries = [ent('x1n', 'x1', 'c', { k: 0 })];
      r.result.finishers = [{ rank: 1, name: 'x1n', author: 'x1', carType: 'normal_fr', totalTimeMs: 2000, bestLapMs: 1000, penaltiesSec: 0 }];
      r.result.finishers[0][field] = BADV; return JSON.parse(JSON.stringify(r)); };
    localStorage.setItem('rumicar.author', 'h9');   // 打破通知: h9 の記録（2.5 秒）が h1（2.0 秒）に抜かれている
    const H9 = () => { const r = H(); r.entries.push(ent('h9n', 'h9', 'c', { k: 1 }));
      r.result.finishers.push({ rank: 2, name: 'h9n', author: 'h9', carType: 'normal_fr', totalTimeMs: 2500, bestLapMs: 1200, penaltiesSec: 0 }); return JSON.parse(JSON.stringify(r)); };
    for (const field of ['name', 'bestLapMs']) {
      for (const order of [['bl4-x', 'bl4-h'], ['bl4-h', 'bl4-x']]) {
        BL3.races['bl4-x'] = X(field); BL3.races['bl4-h'] = H9; BL3.list = order;
        // 単独なら通る（＝往復 1 の「単独で通らない大会を外す」では外れない組）
        const ladderM = await import(pathToFileURL(join(JS, 'race_ladder.js')).href);
        let alone = true, both = true;
        try { ladderM.aggregate([BL3.races['bl4-x']()]); } catch (e) { alone = false; }
        try { ladderM.aggregate([BL3.races['bl4-x'](), BL3.races['bl4-h']()]); } catch (e) { both = false; }
        let th = null, rb = '';
        logs.length = 0;
        try { await ui.loadOfficialRaces(true); await ui.loadAllOfficialData(true); ui.renderRankings(); rb = el('rankBody').innerHTML; ui.checkBeaten(); } catch (e) { th = e; }
        const m = /class="rank-vsworld" data-cls="([^"]*)" data-course="([^"]*)"/.exec(rb);
        const n0 = BL3.calls.length;
        if (m) { try { ui.ghostVsWorld(unescH(m[1]), unescH(m[2])); } catch (e) { th = th || e; } }
        const ghostRan = BL3.calls.length === n0 + 1;
        const hasH = rb.includes('h1n'), hasX = rb.includes('x1n'), beaten = logs.some((x) => x.includes('h1'));
        ok(alone && !both && th === null && hasH && !hasX && !rb.includes(ERRP) && beaten && ghostRan,
           `F2 ${field} が {"toString":1}・一覧 ${order.join('→')}: 単独 ${alone ? '通る' : '投げる'}・組で ${both ? '通る' : '投げる'} → 例外 ${th ? th.message : 'なし'}・bl4-h の行 ${hasH}・bl4-x の行 ${hasX}・打破通知 ${beaten}・👻 の runRace ${ghostRan}`);
      }
    }
    BL3.races['bl4-h'] = () => JSON.parse(JSON.stringify(H()));
    BL3.list = ['bl4-f'];
  }
  localStorage.removeItem('rumicar.author');
  SAP = () => {};
  ECL = (k) => String(k || ''); CTL = (k) => String(k);
}

// G-6e（層4 往復 2）: 入口の try そのもの — 大会の値でなく依存の側（main.js の courseDisplayName・carTypeLabel・setActiveProgram）が
//   投げても、各入口は例外を漏らさず「【エラー】…」の 1 行を出す（欄ごとの防御が見落とした値の代わり）。🏅 は描けない大会を外した
//   結果 1 つも残らないとき、空の表（「まだ記録がありません」）と言い切らずに例外を出す（race_ui.js aggregateNow の ladder.error）。
{
  const ERRP = i18n.t('log.err.setup', { e: '\u0000' }).split('\u0000')[0];
  const R = () => ({ event: { id: 'bl4-e', course: 'オーバル', laps: 1, class: 'open' }, entries: [ent('n1', 'a1', 'c', { k: 0 }), ent('n2', 'b2', 'c', { k: 1 })],
    result: { eventId: 'bl4-e', verifyHash: 'h', finishers: [{ rank: 1, name: 'n1', author: 'a1', carType: 'normal_fr', totalTimeMs: 1000, bestLapMs: 900 },
      { rank: 2, name: 'n2', author: 'b2', carType: 'normal_fr', totalTimeMs: 2000, bestLapMs: 1000 }] } });
  BL3.races['bl4-e'] = () => JSON.parse(JSON.stringify(R())); BL3.list = ['bl4-e'];
  const boom = (tag) => () => { throw new TypeError(tag); };
  const res = {};
  // 🏆 詳細: courseDisplayName が投げる（詳細は event.course の文字列で呼ぶ）
  CDN = boom('bl4-cdn');
  try { await ui.selectOfficialRace('bl4-e'); const d = el('ofDetail').innerHTML; res.detail = d.includes(ERRP) && d.includes('bl4-cdn'); } catch (e) { res.detail = '漏れ ' + e.message; }
  // 再実行検証: 結果ダイアログ（renderRaceResult）がコースの object で courseDisplayName を呼んで投げる（詳細は文字列なので描ける）
  CDN = (c) => { if (c && typeof c === 'object') throw new TypeError('bl4-cdn-obj'); return String(c || ''); };
  try {
    el('ofVerify')._l = {}; el('ofVerifyNote').innerHTML = '';
    await ui.selectOfficialRace('bl4-e'); el('ofVerify').fire('click');
    const n = el('ofVerifyNote').innerHTML; res.verify = n.includes(ERRP) && n.includes('bl4-cdn-obj') && /official-verify-note (ok|warn)/.test(n.split(ERRP)[0]);
  } catch (e) { res.verify = '漏れ ' + e.message; }
  // 👻: 走った後のゴースト再生（openGhostReplay の courseDisplayName）が投げる
  localStorage.setItem('rumicar.author', 'a1');
  try {
    await ui.loadOfficialRaces(true); await ui.loadAllOfficialData(true); ui.renderRankings();
    const m = /class="rank-vsworld" data-cls="([^"]*)" data-course="([^"]*)"/.exec(el('rankBody').innerHTML);
    logs.length = 0; if (m) ui.ghostVsWorld(unescH(m[1]), unescH(m[2]));
    res.ghost = !!m && logs.some((x) => x.startsWith(ERRP) && x.includes('bl4-cdn-obj'));
  } catch (e) { res.ghost = '漏れ ' + e.message; }
  CDN = CDN0;
  // 🍴: setActiveProgram が投げる
  SAP = boom('bl4-sap');
  try { await ui.selectOfficialRace('bl4-e'); logs.length = 0; ui.forkOfficialEntry(0); res.fork = logs.some((x) => x.startsWith(ERRP) && x.includes('bl4-sap')); } catch (e) { res.fork = '漏れ ' + e.message; }
  SAP = () => {};
  // 🏅・打破通知: carTypeLabel が投げる＝どの大会も描けない → 空の表と言わずに例外の 1 行
  CTL = boom('bl4-ctl');
  try {
    await ui.loadOfficialRaces(true); await ui.loadAllOfficialData(true); ui.renderRankings();
    const rb = el('rankBody').innerHTML; logs.length = 0; ui.checkBeaten();
    res.rank = rb.includes(ERRP) && rb.includes('bl4-ctl') && !rb.includes(escH(i18n.t('rank.empty')));
    res.beaten = logs.length === 0;   // 集計が error のとき打破通知は出さない（外側の try まで届く経路は依存の側から作れない＝漏れないことだけ）
  } catch (e) { res.rank = res.beaten = '漏れ ' + e.message; }
  // 🏅 の描画そのもの（aggregateNow が試した後の rankingsHtml）が投げる: 状態で答えが変わる依存（試す 1 回目は通り、描く 2 回目で
  //   投げる）。aggregateNow の試しをすり抜けて renderRankings の try だけが拾う経路。
  {
    let calls = 0; CTL = (k) => { calls++; return String(k); };
    await ui.loadOfficialRaces(true); await ui.loadAllOfficialData(true);
    calls = 0; ui.renderRankings(); const per = calls / 2;   // 試す 1 回＋描く 1 回
    let i = 0; CTL = (k) => { if (i++ >= per) throw new TypeError('bl4-ctl-late'); return String(k); };
    try { ui.renderRankings(); const rb = el('rankBody').innerHTML; res.rankRender = per > 0 && rb.includes(ERRP) && rb.includes('bl4-ctl-late'); } catch (e) { res.rankRender = '漏れ ' + e.message; }
  }
  CTL = (k) => String(k);
  localStorage.removeItem('rumicar.author');
  BL3.list = ['bl4-f'];
  for (const [k, v] of Object.entries(res)) {
    ok(v === true, k === 'beaten' ? `打破通知: carTypeLabel が投げて 🏅 が描けないときも例外を漏らさず、通知も出さない（${v}）`
      : `入口の try（${k}）: 依存が投げても例外を漏らさず「${ERRP}…」の 1 行（${v}）`);
  }
}

// G-6c: 層4 が名指しした t() の呼び出し（race_ui.js の結果ダイアログ :115 新記録・:123 最速ラップ・:127 勝者／🏆 の詳細の
//   公式記録の 1 行・旧版の注記）を、本番の入口から文字列にできない名前・result.json の値で通す。是正前は全部 TypeError。
{
  ECL = L6.entryCarLabel; CTL = L6.carTypeLabel;
  const { practiceCourseId } = await import(pathToFileURL(join(JS, 'lap.js')).href);
  const recKey = 'rumicar.practiceShape.' + practiceCourseId(OVAL) + '::normal_fr';
  const BADN = JSON.parse('{"toString":1}');
  const R1 = () => ({
    event: { id: 'bl4-t', course: 'オーバル', laps: 1, class: 'open' },
    entries: [ent(BADN, 'a1', 'c', { k: 0 }), ent(BADN, 'b2', 'c', { k: 1 })],   // どちらが勝っても勝者・最速ラップの名前が {"toString":1}
    result: { eventId: 'bl4-t', verifyHash: BADN, engineVer: BADN, exec: BADN, finishers: [
      { rank: 1, name: BADN, author: 'a1', carType: 'normal_fr', totalTimeMs: 1000, bestLapMs: 900 }] },
  });
  for (const [label, rec, wantKey] of [['記録なし（:115 新記録）', null, 'race.record.new'], ['自分の記録の方が速い（:123 最速ラップ）', JSON.stringify({ t: 0.001 }), 'race.fastestLap']]) {
    if (rec) localStorage.setItem(recKey, rec); else localStorage.removeItem(recKey);
    el('raceResults').innerHTML = '';
    let d = '', th = null;
    try { d = await openRace('bl4-t', R1); } catch (e) { th = e; }
    const v = th === null ? await clickVerify('bl4-t', R1) : { thrown: th, calls: [] };
    const rr = el('raceResults').innerHTML;
    const winner = escH(i18n.t('race.winner', { name: '?' }));
    const sub = escH(i18n.t(wantKey, { name: '?', time: '\u0000', gap: '' }).split('\u0000')[0]);   // 名前 '?' までの文言
    ok(th === null && v.thrown === null && v.calls.length === 1 && rr.includes(winner) && rr.includes(sub),
       `再実行検証の結果ダイアログ（${label}）: 勝者 ${rr.includes(winner)}・${wantKey} ${rr.includes(sub)}${v.thrown ? '・例外 ' + v.thrown.constructor.name + ': ' + v.thrown.message : ''}`);
    if (!rec) {
      const vf = escH(i18n.t('official.result.verified', { hash: '?', ver: '?', exec: '?' }));
      const ar = escH(i18n.t('official.result.archived', { rec: '?', app: '\u0000' }).split('\u0000')[0]);   // engineVer ? までの文言
      ok(d.includes(vf) && d.includes(ar), `🏆 の詳細の公式記録の 1 行（official.result.verified）${d.includes(vf)}・旧版の注記（official.result.archived）${d.includes(ar)}`);
    }
  }
  localStorage.removeItem(recKey);
  ECL = (k) => String(k || ''); CTL = (k) => String(k);
}

// G-6d（F3）: 車種名 main.js carTypeName — 投稿車種（community）の name が文字列にできない値でも投げない。是正前は '🌐 ' + base の
//   連結が escapeHtml より先に投げ、車種表（car_crud.js renderCarParamTable）と fleet の車種セレクタ（main.js）が止まった。
//   併せて main.js loadCommunityCars: key が文字列にできない投稿は「key/name」の不正として数え、後続の投稿を読み続ける
//   （是正前は isReservedCarKey の String(key) がループごと投げた）。
{
  const ctn = L6.carTypeName;
  const CASES = [['JSON の {"toString":1}', JSON.parse('{"toString":1}'), '🌐 ?'], ['Object.create(null)', Object.create(null), '🌐 ?'],
    ['Symbol()', Symbol(), '🌐 Symbol()'], ['Proxy（どの読み出しも投げる）', new Proxy({}, { get() { throw new Error('trap'); } }), '🌐 ?']];
  for (const [label, v, want] of CASES) {
    let r, th = null;
    try { r = ctn({ key: 'bl4_x', name: v, community: true }); } catch (e) { th = e; }
    ok(th === null && r === want, `carTypeName(投稿車種・name=${label}) → ${th ? th.constructor.name + ': ' + th.message : J(r)}（期待 ${J(want)}）`);
  }
  const norm = [ctn(cfg6.CAR_TYPE_BY_KEY.normal_fr), ctn({ key: 'bl4_m', name: 'Mine', custom: true }), ctn({ key: 'bl4_c', name: 'Comm', community: true }),
    ctn({ key: 'bl4_n', name: 5, community: true }), ctn({ key: 'bl4_o', name: { valueOf() { return 1; }, toString() { return 'a'; } }, community: true })];
  ok(J(norm) === J([i18n.t('car.normal_fr'), 'Mine', '🌐 Comm', '🌐 5', '🌐 1']), `carTypeName の正常値は従来どおり（${J(norm)}）`);
  // 車種表: product の carTypeName を注入して投稿車種（name が {"toString":1}）の行を描く
  const BADN = JSON.parse('{"toString":1}');
  const comm = cfg6.registerCarType({ key: 'bl4_cn', name: BADN }); comm.community = true;
  const { initCarCrud } = await import(pathToFileURL(join(JS, 'car_crud.js')).href);
  const CC2 = initCarCrud({ $: el, escapeHtml: ESC, carTypeName: ctn, logLine() {}, buildFleetColumns() {}, pruneSlotCarTypes() {}, submitToGithub() {} });
  let th = null;
  try { CC2.renderCarParamTable(); } catch (e) { th = e; }
  const h = el('carParamTable').innerHTML;
  ok(th === null && h.includes('<td class="pname">🌐 ?'), `車種表は投稿車種の name が {"toString":1} でも描く（${th ? th.constructor.name + ': ' + th.message : '行 ' + h.includes('<td class="pname">🌐 ?')}）`);
  cfg6.unregisterCarType('bl4_cn');
  for (const ct of cfg6.CAR_TYPES.filter((c) => c.custom)) cfg6.unregisterCarType(ct.key);   // initCarCrud が localStorage の自作車を登録し直した分
  // loadCommunityCars（本文を取り出して、取得・登録・描画の依存を注入して呼ぶ）
  const body = cut6('async function loadCommunityCars() {', '\n}\n');
  const logs6 = []; let fleetN = 0, tableN = 0;
  const DEFS = { A: { key: 'bl4_ca', name: 'CA' }, B: { key: JSON.parse('{"toString":1}'), name: 'CB' }, C: { key: 'bl4_cc', name: JSON.parse('{"toString":1}') } };
  const f = new Function('listCommunityCars', 'fetchCommunityCar', 'logLine', 't', 'hasKey', 'loadCustomCars', 'isReservedCarKey', 'isBuiltinKey', 'registerCarType',
    'buildFleetColumns', 'renderCarParamTable', `let communityCars = [];\n${body}\nreturn loadCommunityCars;`)(
    async () => [{ name: 'a.json', download_url: 'A' }, { name: 'b.json', download_url: 'B' }, { name: 'c.json', download_url: 'C' }],
    async (u) => JSON.parse(JSON.stringify(DEFS[u], (k, v) => v)), (x) => logs6.push(String(x)), i18n.t, i18n.hasKey, () => [],
    (k) => String(k) in Object.prototype, (k) => Object.prototype.hasOwnProperty.call(cfg6.CAR_TYPE_BY_KEY, k) && !cfg6.CAR_TYPE_BY_KEY[k].custom && !cfg6.CAR_TYPE_BY_KEY[k].community,
    cfg6.registerCarType, () => { fleetN++; }, () => { tableN++; });
  // DEFS.B の key は JSON 経由で {"toString":1}（JSON.stringify は toString:1 を数のまま書く）
  let th2 = null;
  try { await f(); } catch (e) { th2 = e; }
  const reg = ['bl4_ca', 'bl4_cc'].map((k) => !!cfg6.CAR_TYPE_BY_KEY[k] && cfg6.CAR_TYPE_BY_KEY[k].community === true);
  const badLine = logs6.find((x) => x.includes('b.json (key/name)'));
  ok(th2 === null && reg.every(Boolean) && !!badLine && fleetN === 1 && tableN === 1,
     `投稿車種の取り込みは key が {"toString":1} の 1 件を不正として数え、後続を読む（${th2 ? '例外 ' + th2.constructor.name + ': ' + th2.message : `登録 ${J(reg)}・不正の行 ${!!badLine}・セレクタ/車種表の描き直し ${fleetN}/${tableN}`}）`);
  let r3, th3 = null;
  try { r3 = ctn(cfg6.CAR_TYPE_BY_KEY.bl4_cc); } catch (e) { th3 = e; }
  ok(th3 === null && r3 === '🌐 ?', `取り込んだ投稿車種（name が {"toString":1}）の車種名 → ${th3 ? th3.message : J(r3)}`);
  cfg6.unregisterCarType('bl4_ca'); cfg6.unregisterCarType('bl4_cc');
}

// ── H) BL5 ① style.css の CSS 変数の未定義（.dlg-editor の --surface-1）──────────────────────────
// 是正前（81e44bf まで）: `.dlg-editor { background: var(--surface-1) }` の --surface-1 は :root にも 11 テーマのどれにも無い
// ＝計算値の時点で無効＝背景が透明（実ブラウザの計算値は browser/check_bl5_a11y.mjs (a)）。
// 定義の集め方は docs/stage_bl/probe/cssvars.mjs の型（style.css・index.html・public/js の全 .js の `--x:` と setProperty('--x')）。
// フォールバック付きの参照（`var(--warn, …)`）は未定義でも値が決まるので対象外（一覧には出す）。
{
  const { readdirSync } = await import('node:fs');
  const PUB = join(ROOT, 'public');
  const jsFiles = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) jsFiles.push(p); } };
  walk(JS);
  const files = [join(PUB, 'css/style.css'), join(PUB, 'index.html'), ...jsFiles];
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));   // CSS のコメント（行番号は保つ）
  const defs = new Map(), uses = [];
  for (const f of files) {
    const raw = readFileSync(f, 'utf8');
    const s = f.endsWith('.css') ? strip(raw) : raw;
    const rel = f.slice(PUB.length + 1);
    for (const m of s.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) if (!defs.has(m[1])) defs.set(m[1], rel);
    for (const m of s.matchAll(/setProperty\(\s*['"](--[a-zA-Z0-9_-]+)/g)) if (!defs.has(m[1])) defs.set(m[1], rel + '（setProperty）');
    s.split('\n').forEach((ln, i) => { for (const m of ln.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)\s*(,)?/g)) uses.push({ v: m[1], at: `${rel}:${i + 1}`, fb: !!m[2] }); });
  }
  console.log('\nH-1) CSS 変数の参照 var(--x) は全部どこかで定義されている（フォールバック付きは対象外）— 是正前: --surface-1（style.css .dlg-editor）');
  const undef = uses.filter((u) => !defs.has(u.v));
  const hard = undef.filter((u) => !u.fb), soft = undef.filter((u) => u.fb);
  ok(uses.length > 100 && defs.size > 30, `走査 ${files.length} ファイル・参照 ${uses.length} 箇所（変数 ${new Set(uses.map((u) => u.v)).size} 種）・定義 ${defs.size} 種`);
  ok(hard.length === 0, `フォールバックの無い参照で未定義の変数 ${hard.length} 件${hard.length ? '（' + hard.map((u) => u.v + ' ' + u.at).join('・') + '）' : ''}`);
  console.log(`  （対象外＝フォールバック付きで未定義: ${soft.length ? soft.map((u) => u.v + ' ' + u.at).join('・') : 'なし'}）`);

  // H-2: style.css の中でフォールバックの無い参照は :root に定義がある（テーマは :root の上書き＝:root にあれば全 11 テーマで値が決まる）。
  console.log('\nH-2) style.css のフォールバックの無い参照は :root で定義（全テーマで値が決まる）');
  const css = strip(readFileSync(join(PUB, 'css/style.css'), 'utf8'));
  const rootDefs = new Set();
  let nRoot = 0;
  for (const m of css.matchAll(/(^|[}\s])(:root)\s*\{([^{}]*)\}/g)) { nRoot++; for (const d of m[3].matchAll(/(--[\w-]+)\s*:/g)) rootDefs.add(d[1]); }
  const themes = [...css.matchAll(/html\[data-theme="([\w-]+)"\]\s*\{[^{}]*--[\w-]+\s*:/g)].map((m) => m[1]);
  const cssUses = uses.filter((u) => u.at.startsWith('css/style.css:') && !u.fb);
  const notRoot = cssUses.filter((u) => !rootDefs.has(u.v));
  ok(nRoot >= 1 && rootDefs.size > 30, `:root のブロック ${nRoot} 個・定義 ${rootDefs.size} 種・変数を上書きするテーマ ${themes.length} 個（${themes.join(',')}）＋既定（:root）`);
  ok(new Set(themes).size === 10, `テーマのブロックは 10 個（既定の :root と合わせて 11 テーマ）`);
  ok(notRoot.length === 0, `style.css のフォールバックの無い参照 ${cssUses.length} 箇所のうち :root に定義の無いもの ${notRoot.length} 件${notRoot.length ? '（' + notRoot.map((u) => u.v + ' ' + u.at).join('・') + '）' : ''}`);
  const dlgRule = /\.dlg-editor\s*\{([^{}]*)\}/.exec(css);
  const bg = dlgRule && /background\s*:\s*([^;]+);/.exec(dlgRule[1]);
  const bgVars = bg ? [...bg[1].matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]) : [];
  ok(!!bg && bgVars.length >= 1 && bgVars.every((v) => rootDefs.has(v)), `.dlg-editor の background（${bg ? bg[1].trim() : '無し'}）の変数が :root で定義済み`);
  // H-3: ファイル入力の a11y の配線（実ブラウザの到達・ファイル選択・名前は browser/check_bl5_a11y.mjs (b)）。
  // 是正前: `.filebtn input { display: none; }` で 3 つの <input type=file> がタブ順とアクセシビリティツリーから消え、名前の属性も無かった。
  console.log('\nH-3) ファイル入力の a11y の配線 — .filebtn input を display:none／visibility:hidden にしない・全 <input type=file> にカタログの aria 名');
  const fileRules = [...css.matchAll(/([^{}]*\.filebtn[^{}]*\binput\b[^{}]*)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const hiding = fileRules.filter((r) => /display\s*:\s*none|visibility\s*:\s*hidden/.test(r.body));
  ok(fileRules.length >= 1 && hiding.length === 0, `.filebtn の input の規則 ${fileRules.length} 個のうち display:none／visibility:hidden ${hiding.length} 個${hiding.length ? '（' + hiding.map((r) => r.sel).join('・') + '）' : ''}`);
  // 母集団（層4 F4）: index.html と public/js の全 .js から、引用符の形を問わず（"file"・'file'・file・大文字）<input …type=file…> を数え、
  // JS で作る形（.type = 'file'・setAttribute('type', 'file')）も数える。各入力の名前は次のどちらか（層4 F5・WCAG 2.5.3 Label in Name）:
  //   ・包む label に見える文言がある（data-i18n の span）→ aria-label／data-i18n-aria を付けない（label の文言がそのまま名前＝見える文言と一致）
  //   ・label がアイコンだけ（文字＝\p{L} を含まない・⬆ など）→ aria-label="${t('…')}" か data-i18n-aria でカタログの名前
  const FILE_TAG = /<input\b[^>]*?(?<![\w-])type\s*=\s*(?:"file"|'file'|file)(?=[\s/>])[^>]*>/gi;
  // コメントの中の記述（例: 「視覚的に隠した <input type=file>」）は数えない。JS は行頭か空白の後の // と /* … */、HTML は <!-- … -->
  // （'https://…' のような文字列の中の // は : の後なので消さない）。行番号は保つ。
  const noComments = (rel, t) => (rel.endsWith('.html')
    ? t.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    : t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|\s)\/\/.*$/gm, '$1'));
  const FILE_DYN = /\.type\s*=\s*['"]file['"]|setAttribute\(\s*['"]type['"]\s*,\s*['"]file['"]/gi;
  const selfTags = '<input type="file"><input type=\'file\' id=a><INPUT TYPE=FILE><input type=file/><input type="filex"><input data-type="file">';
  const selfDyn = "e.type = 'file'; e.setAttribute('type', \"file\"); e.type = 'text';";
  ok((selfTags.match(FILE_TAG) || []).length === 4 && (selfDyn.match(FILE_DYN) || []).length === 2,
    `数え方の自己点検: "file"・'file'・FILE・file/ の 4 形を数え、"filex"・data-type は数えない（${(selfTags.match(FILE_TAG) || []).length}）・JS で作る形 2（${(selfDyn.match(FILE_DYN) || []).length}）`);
  const { MESSAGES: MSG } = await import(pathToFileURL(join(JS, 'i18n/messages.js')).href);
  const srcs = [{ rel: 'index.html', text: readFileSync(join(PUB, 'index.html'), 'utf8') }, ...jsFiles.map((f) => ({ rel: f.slice(PUB.length + 1), text: readFileSync(f, 'utf8') }))]
    .map((x) => ({ rel: x.rel, text: noComments(x.rel, x.text) }));
  const selfCm = noComments('a.js', "// 隠した <input type=file>\n/* <input type=\"file\"> */ const u = 'https://x/<input type=file>';") + noComments('a.html', '<!-- <input type="file"> --><input type="file">');
  ok((selfCm.match(FILE_TAG) || []).length === 2, `数え方の自己点検: コメントの中は数えず文字列の中（'https://…' の後も）と本文は数える（${(selfCm.match(FILE_TAG) || []).length}＝2）`);
  const fileInputs = [], dyn = [];
  for (const { rel, text } of srcs) {
    for (const m of text.matchAll(FILE_TAG)) {
      const lo = text.lastIndexOf('<label', m.index), lc = text.lastIndexOf('</label>', m.index), hi = text.indexOf('</label>', m.index);
      const lab = lo >= 0 && lc < lo && hi > 0 ? text.slice(lo, hi + 8) : null;
      const visible = lab ? lab.replace(m[0], '').replace(/\$\{[^}]*\}/g, '').replace(/<[^>]*>/g, '').trim() : '';
      const spanKey = lab ? (/<span\b[^>]*\bdata-i18n="([^"]+)"/.exec(lab) || [])[1] : undefined;
      const ariaKey = (/data-i18n-aria="([^"]+)"/.exec(m[0]) || /aria-label="\$\{t\('([^']+)'\)\}"/.exec(m[0]) || [])[1];
      const ariaAny = /\baria-label(ledby)?\s*=|data-i18n-aria\s*=/i.test(m[0]);
      fileInputs.push({ at: rel, tag: m[0], lab, visible, spanKey, ariaKey, ariaAny });
    }
    for (const m of text.matchAll(FILE_DYN)) dyn.push(`${rel}:${text.slice(0, m.index).split('\n').length}`);
  }
  const byFile = {}; for (const f of fileInputs) byFile[f.at] = (byFile[f.at] || 0) + 1;
  ok(fileInputs.length === 3 && byFile['index.html'] === 2 && byFile['js/main.js'] === 1,
    `<input type=file> は計 ${fileInputs.length} 個（${Object.entries(byFile).map(([k, v]) => k + ' ' + v).join('・')}）＝index.html 2・main.js 1`);
  ok(dyn.length === 0, `JS で type を file にする形 ${dyn.length} 件${dyn.length ? '（' + dyn.join('・') + '）' : ''}（足すなら上の数と名前の検査に入れる）`);
  for (const f of fileInputs) {
    const who = `${f.at} ${(/id="([^"]+)"|class="([^"]+)"/.exec(f.tag) || [])[0] || f.tag}`;
    const textLabel = /\p{L}/u.test(f.visible);
    if (!f.lab) { ok(false, `${who}: 包む <label> が無い`); continue; }
    if (textLabel) {
      const e = f.spanKey && MSG[f.spanKey];
      ok(!f.ariaAny && !!e && !!e.ja && !!e.en,
        `${who}: label に見える文言（${J(f.visible)}・キー ${f.spanKey ? J(f.spanKey) : '無し'}${e ? `＝ja ${J(e.ja)}・en ${J(e.en)}` : ''}）があり aria の上書きなし（${f.ariaAny ? 'あり＝名前が見える文言と食い違う' : 'なし'}）`);
    } else {
      const e = f.ariaKey && MSG[f.ariaKey];
      ok(!!e && !!e.ja && !!e.en, `${who}: label はアイコンだけ（${J(f.visible)}）→ aria の名前のキー ${f.ariaKey ? J(f.ariaKey) : '無し'}${e ? `（ja ${J(e.ja)}・en ${J(e.en)}）` : ''}`);
    }
  }

  // H-4（層4 F1・回帰）: 矢印キーの手動運転の判定 arrowKeysForCar（main.js の本文を切り出して評価）。ファイル入力にフォーカスがあっても走る
  // （マウスで ⬆ などの label を押すとフォーカスが視覚的に隠した入力へ移る＝95ef692 では矢印が無言で効かなくなった）。ほかの判定は BF1 のまま。
  // 実ブラウザ（マウスで ⬆ → ArrowUp → ToF が変わる）は browser/check_bl5_a11y.mjs (d)。
  console.log('\nH-4) 矢印キーの手動運転の判定（arrowKeysForCar）— ファイル入力にフォーカスがあっても走る・入力欄／select／ダイアログでは走らない');
  const ms = readFileSync(join(JS, 'main.js'), 'utf8');
  const fa = ms.indexOf('function arrowKeysForCar() {');
  const fb = fa >= 0 ? ms.indexOf('\n}\n', fa) : -1;
  if (fa < 0 || fb < 0) ok(false, 'main.js に function arrowKeysForCar() が無い');
  else {
    const body = ms.slice(fa, fb + 2);
    const judge = (ae, dlg = false) => new Function('document', body + '\nreturn arrowKeysForCar();')({ activeElement: ae, querySelector: (q) => (q === 'dialog[open]' && dlg ? {} : null) });
    const el = (tagName, type, extra = {}) => ({ tagName, type, isContentEditable: false, ...extra });
    const CASES = [
      ['<body>', el('BODY'), false, true], ['ボタン', el('BUTTON', 'submit'), false, true], ['activeElement 無し', null, false, true],
      ['<input type=file>', el('INPUT', 'file'), false, true], ['<input type=FILE>（大文字）', el('INPUT', 'FILE'), false, true],
      ['<input type=text>', el('INPUT', 'text'), false, false], ['<input type=range>', el('INPUT', 'range'), false, false],
      ['<input type=checkbox>', el('INPUT', 'checkbox'), false, false], ['<textarea>', el('TEXTAREA'), false, false],
      ['<select>', el('SELECT'), false, false], ['contentEditable', el('DIV', undefined, { isContentEditable: true }), false, false],
      ['ダイアログが開いている＋<input type=file>', el('INPUT', 'file'), true, false], ['ダイアログが開いている＋<body>', el('BODY'), true, false],
    ];
    const bad = CASES.filter(([, ae, dlg, want]) => judge(ae, dlg) !== want);
    for (const [name, ae, dlg, want] of CASES) if (name.includes('file')) ok(judge(ae, dlg) === want, `${name}: ${want ? '走る' : '走らない'}（実 ${judge(ae, dlg) ? '走る' : '走らない'}）`);
    ok(bad.length === 0, `判定表 ${CASES.length} 行のうち期待と違う ${bad.length} 行${bad.length ? '（' + bad.map(([n]) => n).join('・') + '）' : ''}（BF1 の入力欄・select・contentEditable・ダイアログは走らないまま）`);
  }
}

// ── I) BL5 ② elev3d.js（峠コースの立体プレビュー）の canvas 文言の i18n ──────────────────────────
// 是正前（81e44bf まで）: elev3d.js は i18n を import せず「頂上 +…m」「麓 0m」「立体プレビュー — 高低差 …m を下る ▼」を固定で描き、
// main.js の言語切替（setOnLangChange）でも描き直さなかった。I-1 文字列リテラルに日本語 0（字句解析・コメントは数えない）・
// I-2 カタログ elev3d.* の ja/en（en に日本語なし）・I-3 drawTougeElevation を mock の canvas で ja／en の両方で呼び、
// fillText の文言が t() の値と一致・en に日本語なし・I-4 配線（elev3d.js が i18n.js の t を import・main.js の言語切替で描き直す）。
{
  const JA = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;
  // 文字列リテラル（'…'・"…"・テンプレートの字面）を全部取り出す（コメント・正規表現は読み飛ばす・${…} の中も読む）。
  function stringLiterals(src) {
    const out = [];
    let i = 0;
    const KW = /(?:^|[^\w$])(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;
    const regexAllowed = (j) => {
      let k = j - 1; while (k >= 0 && /\s/.test(src[k])) k--;
      if (k < 0) return true;
      const c = src[k];
      // 後置の ++／--（`k++ / 2`）の後の / は割り算（層4 F3・G-4 の写しと同じ）。
      if ((c === '+' || c === '-') && src[k - 1] === c) { let m = k - 2; while (m >= 0 && /\s/.test(src[m])) m--; if (m >= 0 && /[\w$)\]]/.test(src[m])) return false; }
      if ('(,=:[!&|?{};+-*%<>~^'.includes(c)) return true;
      return /[\w$]/.test(c) ? KW.test(src.slice(Math.max(0, k - 10), k + 1)) : false;
    };
    const lineAt = (p) => src.slice(0, p).split('\n').length;
    const str = (q) => { const st = i; i++; let v = ''; while (i < src.length && src[i] !== q) { if (src[i] === '\\') { v += src.slice(i, i + 2); i += 2; continue; } v += src[i]; i++; } i++; out.push({ text: v, line: lineAt(st) }); };
    // 正規表現の途中で改行が来たら読み違い（割り算を正規表現と取った）＝黙って先を飲み込まず投げる（層4 F3・G-4 の写しと同じ）。
    const regex = () => { i++; let cls = false; while (i < src.length) { const c = src[i]; if (c === '\\') { i += 2; continue; } if (c === '[') cls = true; else if (c === ']') cls = false; else if (c === '/' && !cls) break; else if (c === '\n') throw new Error('正規表現の途中で改行 @' + i); i++; } i++; while (/[a-z]/.test(src[i] || '')) i++; };
    function code(inSub) {
      let depth = 0;
      while (i < src.length) {
        const c = src[i], d = src[i + 1];
        if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) throw new Error('コメント未終端'); i = e + 2; continue; }
        if (c === "'" || c === '"') { str(c); continue; }
        if (c === '`') { template(); continue; }
        if (c === '/' && regexAllowed(i)) { regex(); continue; }
        if (c === '{') depth++;
        if (c === '}') { if (depth === 0 && inSub) return; depth--; }
        i++;
      }
      if (inSub) throw new Error('${ が未終端');
    }
    function template() {
      const st = i; i++; let v = '';
      while (i < src.length) {
        const c = src[i];
        if (c === '\\') { v += src.slice(i, i + 2); i += 2; continue; }
        if (c === '`') { i++; out.push({ text: v, line: lineAt(st) }); return; }
        if (c === '$' && src[i + 1] === '{') { i += 2; code(true); i++; v += '${…}'; continue; }
        v += c; i++;
      }
      throw new Error('テンプレート未終端');
    }
    code(false);
    return out;
  }
  const ELEV = join(JS, 'elev3d.js');
  const esrc = readFileSync(ELEV, 'utf8');
  console.log('\nI-1) elev3d.js の文字列リテラルに日本語が無い（コメントは数えない）— 是正前: :66・:67・:71 の 3 件');
  let lits = [];
  try { lits = stringLiterals(esrc); } catch (e) { ok(false, `elev3d.js の字句解析が通らない（${e.message}）`); }
  const jaLits = lits.filter((l) => JA.test(l.text));
  ok(lits.length >= 5, `文字列リテラル ${lits.length} 件を取り出した（字句解析の自己点検: 色の '#…' などを含む）`);
  ok(jaLits.length === 0, `日本語を含む文字列リテラル ${jaLits.length} 件${jaLits.length ? '（' + jaLits.map((l) => `:${l.line} ${J(l.text)}`).join('・') + '）' : ''}`);
  // 字句解析の検出力: 是正前の 3 行と同じ形（テンプレート・'…'）を入れた写しで 3 件拾えること
  const probeSrc = "// 頂上 コメント\nconst a = `頂上 +${e}m`; const b = '麓 0m'; /* 麓 */ const c = x / 2 / 3; f(`立体 ${g(`内側 ${h}`)}`);";
  const pr = stringLiterals(probeSrc).filter((l) => JA.test(l.text)).map((l) => l.text);
  ok(J(pr) === J(['頂上 +${…}m', '麓 0m', '内側 ${…}', '立体 ${…}']), `字句解析の検出力（コメントの日本語は数えず・入れ子のテンプレートも拾う）: ${J(pr)}`);
  // 層4 F3: 後置 ++ の後の割り算を正規表現と取り違えて次の行の文字列を飲み込まない・正規表現の途中の改行は投げる（黙って 0 件にしない）
  const pp = (src) => { try { return stringLiterals(src).filter((l) => JA.test(l.text)).map((l) => l.text); } catch (e) { return 'throw'; } };
  const p1 = pp("k++ / 2;\nconst s = '頂上';\nconst q = W / 3;"), p2 = pp("k-- / 2;\nconst s = '麓';\nconst q = W / 3;"), p3 = pp("a = (x) / 2;\nconst s = '頂上';"), p4 = pp("x = /ab\nc/ + '頂上';");
  ok(J(p1) === J(['頂上']) && J(p2) === J(['麓']) && J(p3) === J(['頂上']) && p4 === 'throw',
    `字句解析の検出力（後置 ++／-- と ) の後の / は割り算・正規表現の途中の改行は投げる）: ${J(p1)}・${J(p2)}・${J(p3)}・${J(p4)}`);

  console.log('\nI-2) カタログ elev3d.*（ja/en 非空・en に日本語なし・{m} の差し込み）');
  const KEYS = ['elev3d.top', 'elev3d.foot', 'elev3d.title'];
  const { MESSAGES } = await import(pathToFileURL(join(JS, 'i18n/messages.js')).href);
  for (const k of KEYS) {
    const e = MESSAGES[k];
    ok(!!e && typeof e.ja === 'string' && e.ja !== '' && typeof e.en === 'string' && e.en !== '' && !JA.test(e.en),
      `${k}: ${e ? `ja ${J(e.ja)}・en ${J(e.en)}` : '未登録'}`);
  }
  ok(!!MESSAGES['elev3d.top'] && MESSAGES['elev3d.top'].ja.includes('{m}') && MESSAGES['elev3d.top'].en.includes('{m}')
    && !!MESSAGES['elev3d.title'] && MESSAGES['elev3d.title'].ja.includes('{m}') && MESSAGES['elev3d.title'].en.includes('{m}'),
    'elev3d.top・elev3d.title の ja/en に高低差の差し込み {m} がある');

  console.log('\nI-3) drawTougeElevation（実コースの峠・mock の canvas）の fillText — ja／en とも t() の値・en に日本語なし');
  const elevM = await import(pathToFileURL(ELEV).href);
  const { buildFromSpec: bfs } = await import(pathToFileURL(join(JS, 'course.js')).href);
  const specs = JSON.parse(readFileSync(join(ROOT, 'public/data/courses.json'), 'utf8'));
  const tougeSpecs = specs.filter((s) => { try { const c = bfs(s); return !!(c && c.touge && c.elev); } catch (e) { return false; } });
  ok(tougeSpecs.length >= 3, `courses.json の峠コース（buildFromSpec の touge かつ elev）${tougeSpecs.length} 本`);
  const mockCanvas = (texts) => {
    const ctx = new Proxy({}, { get(t, k) {
      if (k === 'fillText') return (s) => texts.push(String(s));
      if (k in t) return t[k];
      return () => ({ addColorStop() {} });
    }, set(t, k, v) { t[k] = v; return true; } });
    return { width: 560, height: 150, getContext: () => ctx };
  };
  const lang0 = i18n.getLang();
  let drawn = 0, bad = [], jaDiff = [];
  for (const lg of ['ja', 'en']) {
    i18n.setLang(lg);
    for (const s of tougeSpecs) {
      const c = bfs(s);
      const texts = [];
      let th = null;
      try { elevM.drawTougeElevation(mockCanvas(texts), c); } catch (e) { th = e; }
      const want = [i18n.t('elev3d.top', { m: c.elev }), i18n.t('elev3d.foot'), i18n.t('elev3d.title', { m: c.elev })];
      const good = th === null && i18n.getLang() === lg && J(texts) === J(want) && (lg !== 'en' || !texts.some((x) => JA.test(x)));
      drawn++;
      if (!good) bad.push(`${lg} ${s.name}: ${th ? '例外 ' + th.message : J(texts) + ' ≠ ' + J(want)}`);
      // ja の描画は是正前の固定文言と 1 文字も変わらない（キー化は表示を変えない）
      const old = [`頂上 +${c.elev}m`, '麓 0m', `立体プレビュー — 高低差 ${c.elev}m を下る ▼`];
      if (lg === 'ja' && J(texts) !== J(old)) jaDiff.push(`${s.name}: ${J(texts)} ≠ 是正前 ${J(old)}`);
    }
  }
  i18n.setLang(lang0);
  ok(jaDiff.length === 0, `ja の描画 ${tougeSpecs.length} 本が是正前の固定文言と同一（違い ${jaDiff.length} 件${jaDiff.length ? '：' + jaDiff.slice(0, 2).join(' ／ ') : ''}）`);
  ok(drawn === tougeSpecs.length * 2 && bad.length === 0, `${drawn} 回の描画（峠 ${tougeSpecs.length} 本 × ja/en）のうち t() の値と違う／en に日本語 ${bad.length} 件${bad.length ? '（' + bad.slice(0, 3).join(' ／ ') + (bad.length > 3 ? ' …' : '') + '）' : ''}`);
  ok(i18n.getLang() === lang0, `言語を元に戻した（${lang0}）`);

  console.log('\nI-4) 配線: elev3d.js が i18n.js の t を import・main.js の言語切替（setOnLangChange）で立体プレビューを描き直す');
  ok(/^import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*'\.\/i18n\.js';/m.test(esrc), 'elev3d.js が ./i18n.js から t を import');
  const msrc = readFileSync(join(JS, 'main.js'), 'utf8');
  const a = msrc.indexOf('setOnLangChange(() => {');
  let lcBody = '';
  if (a >= 0) { const b = msrc.indexOf('\n  });', a); lcBody = msrc.slice(a, b); }
  ok(a >= 0 && /drawTougeElevation\(/.test(lcBody), `main.js の言語切替の本文（${lcBody.split('\n').length} 行）が drawTougeElevation を呼ぶ`);
}

// ── J) BL6 live の loop() の段取り（main.js frame の走行中・非ポーズ分岐）──────────────────────────
// 是正前（fee6e7a まで・v10.3.0）: frame は sdt = min(0.05, Δt)×速度 を物理に全部積分するのに、loop() は `if (s.loopTimer <= 0)` で
// 1 フレーム 1 回まで。sdt > 1/loopHz で loop() がフレームの数に落ち、loopTimer は下限なく負へ溜まった（recheck §3・probe/loopdebt.mjs）。
// 測り方: main.js の frame の `if (paused) {…} else {…}` の else の本文（＝本物の段取り）を切り出し、tickSlot・integrateLive・othersFor・
// fleetEdgesOf を記録だけする治具に替えて評価する（是正後の木は loopsched.js の runLiveFrame を本物のまま渡す）。是正前の木も同じ読み口で
// 是正前の本文を評価する（product の経路は変えない・BL-2 の作法）。sim 時間＝治具の integrateLive に渡った区間の合計。
// J-1 条件表（60 fps×1×・60 fps×3×・30 fps×3×・20 fps×3×・10 fps×3×＋参考の 45・40 fps×3×・10 fps×1×）を 60 sim 秒: loop() の頻度が
// loopHz の ±5 %・負債（−loopTimer の最大。loop() を呼ぶ直前の値と各区間の積分の後の値）≤ 1 周期・続けて 60 fps×1× に戻した最初の 1 sim 秒の
// loop() が loopHz ± 1。負の delay(-1000) を毎回呼んでも負債 ≤ 1 周期。J-2 delay(100) を呼んだ回の次の loop() が、呼ばない双子の走りより
// 100 ms ± 1 周期 遅れる（位相 4 通り）・その間隔 − 1 周期 も 100 ms ± 1 周期。J-3 上限: UI で出せる最大の sdt（main.js の 1 フレームの打ち切り
// × index.html #speed の max）の区間の数 ≤ LIVE_MAX_TICKS_PER_FRAME・UI の外（速度 5×・10 fps）で上限に当たったときの挙動（1 フレーム ≤ 上限の
// loop()・物理は sdt を全部積分・負債 ≤ 1 周期・60 fps×1× に戻した直後 loopHz ± 1）。J-4 sdt ≤ 1 周期のフレーム列（乱数 3 系列・4 台・
// delay と running の切替あり）で tick と積分の呼び出しの並び・loopTimer の値が是正前の式と 1 ビットも違わない。J-5 配線。J-6 loop() を呼ぶ
// 時刻と間隔を独立の期限の列と照合（BL6 fix1・下の注記）。
{
  console.log('\nJ) BL6 live の loop() の段取り — main.js frame の走行中・非ポーズ分岐の本文を治具で評価');
  const cfg = await import(pathToFileURL(join(JS, 'config.js')).href);
  const loopHz = cfg.SIM.loopHz, P = 1 / loopHz;
  const LS_PATH = join(JS, 'loopsched.js');
  const LS = existsSync(LS_PATH) ? await import(pathToFileURL(LS_PATH).href) : null;
  const fr = fnBody('frame');
  let branch = '', capSec = NaN;
  if (fr) {
    const a = fr.text.indexOf('if (paused) {');
    const b1 = a >= 0 ? blockAt(fr.a + a + 'if (paused) '.length) : null;
    if (b1) {
      const rest = CODE.slice(b1.b + 1);
      const m = /^\s*else\s*\{/.exec(rest);
      const b2 = m ? blockAt(b1.b + 1 + m[0].length - 1) : null;
      if (b2) branch = b2.text.slice(1, -1);
    }
    const mc = /Math\.min\(([\d.]+), \(t - lastT\) \/ 1000\)/.exec(fr.text);
    if (mc) capSec = Number(mc[1]);
  }
  ok(branch.length > 0, `main.js frame の走行中・非ポーズ分岐の本文を切り出せた（${branch.split('\n').length} 行）・1 フレームの実時間の打ち切り ${capSec} s・loopHz ${loopHz}・loopsched.js ${LS ? 'あり' : 'なし（是正前の木）'}`);
  const PARAMS = ['slots', 'sdt', 'edges', 'interact', 'SIM', 'tickSlot', 'othersFor', 'integrateLive', 'fleetEdgesOf', 'runLiveFrame'];
  let branchFn = null;
  try { branchFn = new Function(...PARAMS, branch); } catch (e) { ok(false, `分岐の本文を評価できない（${e.message}）`); }
  const runLive = LS ? LS.runLiveFrame : () => { throw new Error('runLiveFrame が無い（是正前の木）'); };

  // 治具: 1 フレームを本物の分岐で回す。delayOf(slot, n) → その回の loop() が積む delay [ms]（n＝そのスロットの何回目の loop() か・0 始まり）。
  function makeRig(nSlots, delayOf = () => 0) {
    const R = { simT: 0, minTimer: 0, calls: [], slots: [], log: null, sl: [] };   // sl＝積分した区間 [始まりの sim 時刻, 長さ] の列（J-6）
    for (let i = 0; i < nSlots; i++) R.slots.push({ running: true, loopTimer: 0, world: { _pendingDelay: 0 }, ticks: [] });
    const watch = (v) => { if (v < R.minTimer) R.minTimer = v; };
    const tickSlot = (s, others) => {
      const i = R.slots.indexOf(s);
      watch(s.loopTimer);
      s.ticks.push(R.simT);
      s.world._pendingDelay = 0;                                     // fleet.js tickSlot と同じ（loop() の前に 0 へ）
      const d = delayOf(s, s.ticks.length - 1, i);
      if (d) s.world._pendingDelay += d;                               // loop() の中の delay(ms)（api.js と同じ積み方）
      if (R.log) R.log.push(`T${i}:${s.loopTimer}`);
    };
    const integrateLive = (dt) => {
      R.sl.push([R.simT, dt]);
      R.simT += dt;
      for (const s of R.slots) watch(s.loopTimer);
      if (R.log) R.log.push(`I:${dt}`);
    };
    R.frame = (sdt) => {
      branchFn(R.slots, sdt, [], false, { loopHz }, tickSlot, () => [], integrateLive, () => [], runLive);
      for (const s of R.slots) { watch(s.loopTimer); if (R.log) R.log.push(`L:${s.loopTimer}`); }
    };
    return R;
  }
  const sdtOf = (fps, speed) => speed * Math.min(capSec, 1 / fps);
  const runFor = (R, sdt, sec) => { const t0 = R.simT; let f = 0; while (R.simT < t0 + sec - 1e-9 && f < 1e6) { R.frame(sdt); f++; } return f; };

  console.log('\nJ-1) 60 sim 秒の loop() の頻度・負債・60 fps×1× に戻した直後の 1 sim 秒（PLAN の条件表＋参考の行）');
  const COND = [[60, 1, 'PLAN'], [60, 3, 'PLAN'], [30, 3, 'PLAN'], [20, 3, 'PLAN'], [10, 3, 'PLAN'], [45, 3, '参考'], [40, 3, '参考'], [10, 1, '参考']];
  for (const [fps, speed, tag] of COND) {
    if (!branchFn) break;
    const R = makeRig(1);
    let err = null, hz = NaN, debt = NaN, after = NaN, afterSpan = NaN;
    try {
      runFor(R, sdtOf(fps, speed), 60);
      const n60 = R.slots[0].ticks.length, t60 = R.simT;
      hz = n60 / t60; debt = -R.minTimer;
      runFor(R, sdtOf(60, 1), 1);
      after = R.slots[0].ticks.filter((t) => t >= t60 - 1e-9).length; afterSpan = R.simT - t60;
    } catch (e) { err = e; }
    const good = !err && hz >= loopHz * 0.95 && hz <= loopHz * 1.05 && debt <= P + 1e-12 && Math.abs(after - loopHz) <= 1;
    ok(good, `${tag} ${fps} fps×${speed}×（sdt ${sdtOf(fps, speed).toFixed(4)} s）: ${err ? '例外 ' + err.message : `loop() ${hz.toFixed(3)} Hz（${(loopHz * 0.95).toFixed(1)}〜${(loopHz * 1.05).toFixed(1)}）・負債 ${debt.toFixed(4)} s（≤ ${P}）・60 fps×1× に戻した最初の ${afterSpan.toFixed(3)} sim 秒の loop() ${after} 回（${loopHz} ± 1）`}`);
  }
  if (branchFn) {
    const R = makeRig(1, () => -1000);
    let err = null;
    try { runFor(R, sdtOf(60, 1), 10); } catch (e) { err = e; }
    ok(!err && -R.minTimer <= P + 1e-12, `毎回 delay(-1000) を呼ぶ（負の delay）60 fps×1× 10 sim 秒: 負債 ${err ? '例外 ' + err.message : (-R.minTimer).toFixed(4)} s ≤ ${P}（是正前は負の delay が負債として溜まり毎フレーム返した）・loop() ${R.slots[0].ticks.length} 回`);
  }

  console.log('\nJ-2) delay(100) を呼んだ回の次の loop() — 呼ばない双子の走りより 100 ms ± 1 周期 遅れる・間隔 − 1 周期 も 100 ms ± 1 周期');
  for (const [fps, speed, tag] of COND) {
    if (!branchFn) break;
    const rows = [];
    let good = true;
    for (const k of [200, 201, 202, 203]) {
      let post = NaN, gap = NaN, err = null;
      try {
        const A = makeRig(1), B = makeRig(1, (s, n) => (n === k ? 100 : 0));
        for (const R of [A, B]) { let f = 0; while (R.slots[0].ticks.length < k + 2 && f < 1e6) { R.frame(sdtOf(fps, speed)); f++; } }
        post = B.slots[0].ticks[k + 1] - A.slots[0].ticks[k + 1];
        gap = B.slots[0].ticks[k + 1] - B.slots[0].ticks[k] - P;
      } catch (e) { err = e; }
      const g = !err && Math.abs(post - 0.1) <= P + 1e-9 && Math.abs(gap - 0.1) <= P + 1e-9;
      if (!g) good = false;
      rows.push(err ? `${k} 回目: 例外 ${err.message}` : `${k} 回目 ${(post * 1000).toFixed(1)}／${(gap * 1000).toFixed(1)} ms`);
    }
    ok(good, `${tag} ${fps} fps×${speed}×: 遅れ／間隔−1 周期 ＝ ${rows.join('・')}（どちらも ${100 - P * 1000}〜${100 + P * 1000} ms）`);
  }

  console.log('\nJ-3) 1 フレームの loop() の回数の上限 LIVE_MAX_TICKS_PER_FRAME とその挙動');
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  const sm = /<input id="speed"[^>]*\bmax="([\d.]+)"/.exec(html);
  const speedMax = sm ? Number(sm[1]) : NaN;
  const MAXT = LS ? LS.LIVE_MAX_TICKS_PER_FRAME : NaN;
  const uiSlices = LS ? LS.liveSlices(capSec * speedMax, loopHz, Infinity).length : NaN;
  ok(Number.isInteger(MAXT) && MAXT >= 1 && uiSlices <= MAXT, `UI で出せる最大の sdt（打ち切り ${capSec} s × #speed の max ${speedMax}＝${(capSec * speedMax).toFixed(3)} s）の区間の数 ${uiSlices} ≤ 上限 ${MAXT}（UI で出せる条件では上限に当たらない）`);
  if (branchFn && LS) {
    const R = makeRig(2);
    const sdt = capSec * 5;   // 速度 5×・1 フレーム 50 ms 超（UI の外）
    const perFrame = [];
    let err = null, sumSdt = 0;
    try {
      const t0 = R.simT;
      while (R.simT < t0 + 60 - 1e-9) { const n0 = R.slots[0].ticks.length; R.frame(sdt); sumSdt += sdt; perFrame.push(R.slots[0].ticks.length - n0); }
    } catch (e) { err = e; }
    const hz = R.slots[0].ticks.length / R.simT, debt = -R.minTimer;
    const t60 = R.simT;
    if (!err) runFor(R, sdtOf(60, 1), 1);
    const after = R.slots[0].ticks.filter((t) => t >= t60 - 1e-9).length;
    ok(!err && Math.max(...perFrame) <= MAXT && Math.abs(t60 - sumSdt) < 1e-9 && debt <= P + 1e-12 && Math.abs(after - loopHz) <= 1,
      `速度 5×・10 fps（sdt ${sdt.toFixed(3)} s・区間 ${LS.liveSlices(sdt, loopHz).map((x) => x.toFixed(3)).join('/')}）: 1 フレームの loop() 最大 ${err ? '例外 ' + err.message : Math.max(...perFrame)} 回（≤ ${MAXT}）・積分した sim 時間 ${t60.toFixed(6)} ＝ Σsdt ${sumSdt.toFixed(6)}・頻度 ${hz.toFixed(2)} Hz（上限で ${(MAXT / sdt).toFixed(1)} Hz に下がる）・負債 ${debt.toFixed(4)} s ≤ ${P}（取りこぼしは捨てる）・60 fps×1× に戻した直後 1 sim 秒の loop() ${after} 回（${loopHz} ± 1）`);
  } else ok(false, 'UI の外で上限に当たったときの挙動を測れない（loopsched.js が無い）');

  console.log('\nJ-4) sdt ≤ 1 周期のフレーム列で、tick と積分の呼び出しの並び・loopTimer の値が是正前の式と同じ（ビット単位）');
  // 是正前の式（fee6e7a の main.js frame の分岐。比べるための参照＝ここだけの写し）。
  const OLD = `slots.forEach((s, i) => {
        if (!s.running) return;
        s.loopTimer -= sdt;
        if (s.loopTimer <= 0) {
          tickSlot(s, othersFor(edges, i, interact));
          s.loopTimer += (1 / SIM.loopHz) + (s.world._pendingDelay || 0) / 1000;
        }
      });
      integrateLive(sdt);`;
  const oldFn = new Function(...PARAMS, OLD);
  if (branchFn) {
    const diffs = [];
    let frames = 0, ticksN = 0;
    for (const seed of [1, 7, 42]) {
      let x = seed >>> 0;
      const rnd = () => { x = (x + 0x6D2B79F5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const seq = [];
      for (let f = 0; f < 3000; f++) {
        const r = rnd();
        const fps = r < 0.4 ? 60 : r < 0.6 ? 59 + rnd() * 2 : r < 0.8 ? 61 + rnd() * 120 : 60;   // 60 fps 前後の揺れ（Δt ≤ 16.7 ms 側）
        const speed = rnd() < 0.5 ? 1 : (rnd() < 0.5 ? 3 : 0.1 + rnd() * 2.9);
        let sdt = speed * Math.min(capSec, 1 / fps);
        if (sdt > P) sdt = P;                                         // sdt ≤ 1 周期だけ（ちょうど 1 周期を含む）
        seq.push({ sdt, delay: rnd() < 0.05 ? Math.floor(rnd() * 300) : 0, flip: rnd() < 0.01 ? Math.floor(rnd() * 4) : -1 });
      }
      const logs = [];
      for (const fn of [branchFn, oldFn]) {
        const L = [];
        const sl = [0, 1, 2, 3].map(() => ({ running: true, loopTimer: 0, world: { _pendingDelay: 0 }, n: 0 }));
        const tickSlot = (s) => { const i = sl.indexOf(s); s.world._pendingDelay = 0; const d = seq[cur].delay * (i + 1) % 250; if (d && s.n % 3 === 0) s.world._pendingDelay += d; s.n++; L.push(`T${i}:${s.loopTimer}`); };
        const integrateLive = (dt) => L.push(`I:${dt}`);
        let cur = 0;
        for (cur = 0; cur < seq.length; cur++) {
          const q = seq[cur];
          if (q.flip >= 0) sl[q.flip].running = !sl[q.flip].running;
          fn(sl, q.sdt, [], false, { loopHz }, tickSlot, () => [], integrateLive, () => [], runLive);
          L.push(`L:${sl.map((s) => s.loopTimer).join(',')}`);
        }
        logs.push(L);
      }
      frames += seq.length;
      ticksN += logs[1].filter((l) => l[0] === 'T').length;
      const n = Math.max(logs[0].length, logs[1].length);
      for (let i = 0; i < n; i++) if (logs[0][i] !== logs[1][i]) { diffs.push(`seed ${seed} #${i}: ${logs[0][i]} ≠ 是正前 ${logs[1][i]}`); break; }
    }
    ok(diffs.length === 0, `乱数 3 系列 ${frames} フレーム（4 台・loop() ${ticksN} 回・delay と running の切替あり）で呼び出しの並びと loopTimer が是正前の式と一致${diffs.length ? '（' + diffs.join(' ／ ') + '）' : ''}`);
  }

  console.log('\nJ-5) 配線: main.js が loopsched.js の runLiveFrame で段取りする・loopTimer を main.js で直接いじらない');
  const MAINJ = readFileSync(join(JS, 'main.js'), 'utf8');
  ok(/^import \{ runLiveFrame \} from '\.\/loopsched\.js';/m.test(MAINJ), "main.js が './loopsched.js' から runLiveFrame を import");
  ok(/runLiveFrame\(sdt, SIM\.loopHz, slots,/.test(branch), 'frame の走行中・非ポーズ分岐が runLiveFrame(sdt, SIM.loopHz, slots, …) を呼ぶ');
  ok(!/loopTimer\s*(?:[-+]=|<=)/.test(fr ? fr.text : ''), 'frame の本文に loopTimer の引き算・足し算・比較が無い（段取りは loopsched.js の 1 か所）');
  ok(/integrateLive\(dt\)/.test(branch) && /tickSlot\(s, othersFor\(e, i, interact\)\)/.test(branch) && /return s\.world\._pendingDelay \|\| 0;/.test(branch),
    '分岐の tick は tickSlot(s, othersFor(e, i, interact)) の後に world._pendingDelay を返し、積分は integrateLive(dt)（区間ごと）');

  console.log('\nJ-6) loop() を呼ぶ時刻 — 期限（前の期限＋1 周期＋delay）の来た区間の始まり・続く 2 回の間隔は 0 より長く 2 周期＋delay 以下（Δt の揺れ・端数の区間）');
  // 層4 F3（BL6 fix1）: 既定の速度 3× で Δt が 16.7 ms をわずかに超えると [P, 端数] に刻まれ、loop() が sim 時間 1 ms 未満の間隔で続けて
  // 呼ばれることがある（許容した設計判断＝loopsched.js 冒頭）。ここでは physics_model §0 の主張「期限の来た区間の始まりで呼ぶ（期限より最大
  // 1 区間早い）」「間隔は 0 より長く 2 周期＋delay 以下」を、治具の外で独立に作った期限の列と照合する: 期限₀ = 0（▶ の直後の loopTimer 0）・
  // 期限ₖ₊₁ = 期限ₖ + P + delayₖ/1000。k 回目の loop() の時刻 cₖ（治具の simT）が積分した区間の始まりで、その区間 [cₖ, cₖ＋長さ] に期限ₖ が
  // 入ること（遅れない・最大 1 区間早い）・呼んだ回数＝sim 時間の中に来た期限の数 ±1。続けて呼んだ回数（間隔 5 ms 未満）は参考の印字。
  if (branchFn) {
    let seed = 20261017;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
    const gauss = () => { let u = 0; for (let i = 0; i < 12; i++) u += rnd(); return u - 6; };
    const mkJit = (sigmaMs, missP, speed) => { const a = []; for (let i = 0; i < 4000; i++) { let ms = 1000 / 60 + gauss() * sigmaMs; if (rnd() < missP) ms += 1000 / 60; a.push(speed * Math.min(capSec, Math.max(0, ms) / 1000)); } return (f) => a[f % a.length]; };
    const ROWS = [
      ['60 fps×3×・Δt 16.5/16.8/16.8/16.5/16.7 ms の繰り返し', (f) => 3 * Math.min(capSec, [16.5, 16.8, 16.8, 16.5, 16.7][f % 5] / 1000), () => 0],
      ['60 fps×3×・Δt の揺れ σ 0.3 ms＋5 % のフレームで 1 回取りこぼし', mkJit(0.3, 0.05, 3), () => 0],
      ['60 fps×3×・Δt の揺れ σ 1 ms', mkJit(1, 0, 3), () => 0],
      ['45 fps×3×', () => sdtOf(45, 3), () => 0],
      ['40 fps×3×', () => sdtOf(40, 3), () => 0],
      ['30 fps×3×・7 回に 1 回 delay(0〜150)', () => sdtOf(30, 3), (s, n) => (n % 7 === 3 ? (n * 37) % 151 : 0)],
      ['60 fps×1×・7 回に 1 回 delay(0〜150)', () => sdtOf(60, 1), (s, n) => (n % 7 === 3 ? (n * 37) % 151 : 0)],
    ];
    for (const [label, sdtFn, delayOf] of ROWS) {
      let err = null, bad = 0, ex = '', ivBad = 0, ivEx = '', nearDup = 0, ivMin = Infinity, earlyMax = 0, calls = 0, dues = 0, frames = 0;
      try {
        const R = makeRig(1, delayOf);
        while (R.simT < 60 - 1e-9 && frames < 1e6) { R.frame(sdtFn(frames)); frames++; }
        const T = R.slots[0].ticks, SL = R.sl;
        calls = T.length;
        let due = 0, j = 0;
        const dueOf = [];
        for (let k = 0; k < T.length; k++) {
          const c = T[k];
          while (j < SL.length && SL[j][0] < c) j++;
          const atStart = j < SL.length && SL[j][0] === c;
          const len = atStart ? SL[j][1] : NaN;
          const early = due - c;
          if (!(atStart && early >= -1e-9 && early <= len + 1e-9)) { bad++; if (!ex) ex = `${k} 回目: 時刻 ${c.toFixed(4)}・期限 ${due.toFixed(4)}・${atStart ? '区間の長さ ' + len.toFixed(4) : '区間の始まりでない'}`; }
          if (early > earlyMax) earlyMax = early;
          dueOf.push(due);
          due += P + delayOf(null, k) / 1000;
        }
        for (let k = 0; k + 1 < T.length; k++) {
          const iv = T[k + 1] - T[k], cap = 2 * P + delayOf(null, k) / 1000;
          if (iv < ivMin) ivMin = iv;
          if (iv < 0.005) nearDup++;
          if (!(iv > 1e-12 && iv <= cap + 1e-9)) { ivBad++; if (!ivEx) ivEx = `${k}→${k + 1} 回目 ${(iv * 1000).toFixed(2)} ms（上限 ${(cap * 1000).toFixed(1)}）`; }
        }
        let d2 = 0; while (d2 <= R.simT + 1e-9) { dues++; d2 += P + delayOf(null, dues - 1) / 1000; }
      } catch (e) { err = e; }
      ok(!err && bad === 0 && ivBad === 0 && Math.abs(calls - dues) <= 1,
        `${label}（${frames} フレーム・60 sim 秒）: ${err ? '例外 ' + err.message : `期限の来た区間の始まりで呼んだ ${calls - bad}/${calls} 回（期限より早い最大 ${(earlyMax * 1000).toFixed(1)} ms）${ex ? '・外れ ' + ex : ''}・間隔が 0 より長く 2 周期＋delay 以下 ${calls - 1 - ivBad}/${calls - 1}${ivEx ? '・外れ ' + ivEx : ''}・呼んだ回数 ${calls}＝期限の数 ${dues} ±1・参考: 最短の間隔 ${(ivMin * 1000).toFixed(2)} ms・5 ms 未満 ${nearDup} 回`}`);
    }
  }
}

// ── K) BL7 インタプリタ残件（len()・random.choice・dict の真偽・深い str()・スタック切れの文言）──────────────────────────
{
  const impK = (f) => import(pathToFileURL(join(JS, f)).href);
  const { buildController } = await impK('runner.js');
  const { buildApi } = await impK('api.js');
  const { buildFromSpec: bfsK } = await impK('course.js');
  const { DynCar } = await impK('physics_dyn.js');
  const i18nK = await impK('i18n.js');
  const { MESSAGES } = await impK('i18n/messages.js');
  const { SIM } = await impK('config.js');
  const { spawnSync } = await import('node:child_process');
  const JP = /[぀-ヿ一-龯]/;
  const courseK = bfsK(JSON.parse(readFileSync(join(ROOT, 'public/data/courses.json'), 'utf8'))[0]);
  // 1 本を本番経路（buildController → setup → tick×n）で走らせる。probe/{interp,deep,deepB}.mjs の型。
  const runK = (code, lang, ticks = 0) => {
    const out = [];
    const world = { car: new DynCar(courseK.start), walls: courseK.walls, start: courseK.start, log: (m) => out.push(String(m)),
      _sensors: [], _pendingDelay: 0, _others: [], _simMs: 0 };
    let ctrl = null;
    try { ctrl = buildController(code, lang, buildApi(world)); ctrl.setup(); for (let i = 0; i < ticks; i++) ctrl.tick(); return { out, ctrl }; }
    catch (e) { return { out, ctrl, ctor: e && e.constructor && e.constructor.name, key: e && e.i18nKey, msgKey: e && e.i18nMsgKey, params: e && e.i18nParams, line: e && e.line, msg: e && e.message != null ? String(e.message) : String(e) }; }
  };
  const runKBoth = (code, lang, ticks) => { i18nK.setLang('en'); const en = runK(code, lang, ticks); i18nK.setLang('ja'); const ja = runK(code, lang, ticks); return { ja, en }; };
  // 期待の文言＝カタログの値に {var} を差し込み、行の接尾（interp.err.line）を付けたもの（t() を通さず独立に組む）。
  const fill = (s, p) => s.replace(/\{(\w+)\}/g, (m, k) => (p && k in p ? String(p[k]) : m));
  //   カタログに無いキー（是正前の木の recursionStack ほか）は一致しない印を返す（--root で章を最後まで回す）。
  const want = (lang, key, p, ln) => (MESSAGES[key] && MESSAGES[key][lang] != null
    ? fill(MESSAGES[key][lang], p) + (ln ? fill(MESSAGES['interp.err.line'][lang], { n: ln }) : '') : `（カタログに無い ${key}）`);
  const PY3K = (() => { const r = spawnSync('python3', ['-I', '-c', 'print(1)'], { encoding: 'utf8', timeout: 20000 }); return !r.error && r.status === 0; })();
  const py3 = (code) => { const r = spawnSync('python3', ['-I', '-c', code], { encoding: 'utf8', timeout: 60000 }); return { out: r.stdout.trim().split('\n').filter(Boolean), err: (r.stderr || '').trim().split('\n').pop() || '' }; };

  console.log('\nK-1) len()・random.choice の引数のエラー（api.js）— 是正前: len は日本語固定の Error（行なし）・choice(None) は JS の TypeError・choice([]) は値なし');
  const A = 'def setup():\n    pass\ndef loop():\n    x = 1\n';
  const ROWS = [
    // [ラベル, 言語, 本文, tick 数, 期待のキー, 期待の {type}, 行, python3 の本文（例外の種類を突き合わせる）, python3 の例外]
    ['len(None)（Model A）', 'py', A + '    n = len(None)\n', 1, 'interp.err.lenArg', 'None', 5, 'len(None)', 'TypeError'],
    ['len(5)（Model A）', 'py', A + '    n = len(5)\n', 1, 'interp.err.lenArg', 'int', 5, 'len(5)', 'TypeError'],
    ['len(True)', 'py', A + '    n = len(True)\n', 1, 'interp.err.lenArg', 'bool', 5, 'len(True)', 'TypeError'],
    ['len(2.5)（Model C・トップレベル）', 'py', 'a = 1\nn = len(2.5)\n', 0, 'interp.err.lenArg', 'float', 2, 'len(2.5)', 'TypeError'],
    ['len(None)（Model B の while True: の本体）', 'py', 'x = 0\nwhile True:\n    x = x + 1\n    n = len(None)\n', 1, 'interp.err.lenArg', 'None', 4, 'len(None)', 'TypeError'],
    ['len(None) を関数の引数の中で（行＝呼び出した文）', 'py', 'def f(v):\n    return v\ndef loop():\n    x = 1\n    y = f(len(None))\n', 1, 'interp.err.lenArg', 'None', 5, null, null],
    ['len(5) を関数の本体で（行＝関数の中の文）', 'py', 'def g():\n    return len(5)\ndef loop():\n    x = 1\n    y = g()\n', 1, 'interp.err.lenArg', 'int', 2, null, null],
    ['C の len(5)', 'c', 'void setup(){}\nvoid loop(){\n  int a = 1;\n  int n = len(5);\n}', 1, 'interp.err.lenArg', 'int', 4, null, null],
    ['random.choice(None)', 'py', 'import random\n' + A + '    n = random.choice(None)\n', 1, 'interp.err.choiceArg', 'None', 6, 'import random; random.choice(None)', 'TypeError'],
    ['random.choice([])', 'py', 'import random\n' + A + '    n = random.choice([])\n    print(n)\n', 1, 'interp.err.choiceEmpty', null, 6, 'import random; random.choice([])', 'IndexError'],
    ['random.choice("")', 'py', 'import random\n' + A + '    n = random.choice("")\n', 1, 'interp.err.choiceEmpty', null, 6, 'import random; random.choice("")', 'IndexError'],
    ['random.choice(5)', 'py', 'import random\n' + A + '    n = random.choice(5)\n', 1, 'interp.err.choiceArg', 'int', 6, 'import random; random.choice(5)', 'TypeError'],
    ['random.choice({"a": 1})（dict は選べない＝python3 は KeyError）', 'py', 'import random\n' + A + '    n = random.choice({"a": 1})\n', 1, 'interp.err.choiceArg', 'dict', 6, 'import random; random.choice({"a": 1})', 'KeyError'],
  ];
  // BL7 fix1（層4 F5）: 引数の数（期待の {fn}・{n} は K1N で）。e961e4b は len() が lenArg（None）・len(a, b) は黙って len(a)・choice() は choiceArg（None）。
  const K1N = [
    ['len()（引数なし）', 'py', A + '    n = len()\n', 1, 'len', 0, 5, 'len()', 'TypeError'],
    ['len([1], [2])（引数 2 つ）', 'py', A + '    n = len([1], [2])\n', 1, 'len', 2, 5, 'len([1], [2])', 'TypeError'],
    ['C の len()', 'c', 'void setup(){}\nvoid loop(){\n  int a = 1;\n  int n = len();\n}', 1, 'len', 0, 4, null, null],
    ['random.choice()（引数なし）', 'py', 'import random\n' + A + '    n = random.choice()\n', 1, 'random.choice', 0, 6, 'import random; random.choice()', 'TypeError'],
    ['random.choice([1], [2])（引数 2 つ）', 'py', 'import random\n' + A + '    n = random.choice([1], [2])\n', 1, 'random.choice', 2, 6, 'import random; random.choice([1], [2])', 'TypeError'],
  ];
  for (const [label, lang, code, ticks, fn, n, ln, pyc, pyErr] of K1N) {
    const { ja, en } = runKBoth(code, lang, ticks);
    const key = 'interp.err.oneArg', p = { fn, n };
    ok(ja.ctor === 'RuntimeError' && ja.key === key && ja.line === ln && ja.msg === want('ja', key, p, ln),
      `K-1 ${label} → RuntimeError ${key}（行 ${ln}）ja ${J(ja.msg)}${ja.ctor !== 'RuntimeError' ? '（実 ' + ja.ctor + '）' : ''}`);
    ok(en.ctor === 'RuntimeError' && en.key === key && en.line === ln && en.msg === want('en', key, p, ln) && !JP.test(en.msg), `K-1 ${label}: en ${J(en.msg)}`);
    if (pyc && PY3K) { const r = py3(pyc); ok(r.err.startsWith(pyErr + ':'), `K-1 ${label}: python3 も例外（${r.err}）`); }
  }
  for (const [label, lang, code, ticks, key, type, ln, pyc, pyErr] of ROWS) {
    const { ja, en } = runKBoth(code, lang, ticks);
    const p = type == null ? {} : { type };
    ok(ja.ctor === 'RuntimeError' && ja.key === key && ja.line === ln && ja.msg === want('ja', key, p, ln),
      `K-1 ${label} → RuntimeError ${key}（行 ${ln}）ja ${J(ja.msg)}${ja.ctor !== 'RuntimeError' ? '（実 ' + ja.ctor + '）' : ''}`);
    ok(en.ctor === 'RuntimeError' && en.key === key && en.line === ln && en.msg === want('en', key, p, ln) && !JP.test(en.msg),
      `K-1 ${label}: en ${J(en.msg)}`);
    if (pyc && PY3K) { const r = py3(pyc); ok(r.err.startsWith(pyErr + ':'), `K-1 ${label}: python3 も例外（${r.err}）`); }
  }
  { // JS で書いたプログラム（ネイティブ実行）は行を持たない＝行の接尾なしの同じ文言（参考の型・ctor は RuntimeError）。
    const { ja, en } = runKBoth('function setup(){}\nfunction loop(){ len(null); }', 'js', 1);
    ok(ja.ctor === 'RuntimeError' && ja.key === 'interp.err.lenArg' && !ja.line && ja.msg === want('ja', 'interp.err.lenArg', { type: 'None' }, 0)
      && en.msg === want('en', 'interp.err.lenArg', { type: 'None' }, 0), `K-1 JS の len(null) → 行なしの lenArg（ja ${J(ja.msg)}・en ${J(en.msg)}）`);
  }
  { // BL7 fix2（層4 往復 2 F2）: 引数の数を数えるのは py・C のプログラムに書いた呼び出しだけ（evaluator.js callHost が api.js の付けた ONE_ARG の
    //   印で数える）。JS のプログラムと、ホストの関数がネイティブに呼ぶ形（Array.prototype.map は要素・添字・配列の 3 つを渡す）は 15341f4・e961e4b と
    //   同じ値。cb9ea81（fix1）は api.js の関数の中で arguments.length を数え「3 個渡されました」で止めた（回帰）。py の len()／len(a, b) は上の K1N。
    const NATIVE = [
      ['JS の ["ab", "c"].map(len)', 'js', 'function setup(){ print(["ab", "c"].map(len).join(",")); }\nfunction loop(){}', ['2,1']],
      ['JS の [["a"], ["b"]].map(random.choice)', 'js', 'function setup(){ print([["a"], ["b"]].map(random.choice).join(",")); }\nfunction loop(){}', ['a,b']],
      ['JS の len([1], [2, 3])（JS は引数の数を数えない＝1 つ目）', 'js', 'function setup(){ print(len([1], [2, 3])); }\nfunction loop(){}', ['1']],
      ['py の ["ab", "c"].map(len)（list の map＝JS のネイティブの経路）', 'py', 'x = ["ab", "c"].map(len)\nprint(x[0], x[1], len(x))\n', ['2 1 2']],
      ['py の [["a"], ["b"]].map(random.choice)', 'py', 'import random\nx = [["a"], ["b"]].map(random.choice)\nprint(x[0], x[1])\n', ['a b']],
    ];
    for (const [label, lang, code, want1] of NATIVE) {
      const r = runK(code, lang, 0);
      ok(!r.ctor && J(r.out) === J(want1), `K-1 ${label} → ${J(want1)}（実 ${r.ctor ? r.ctor + ' ' + J(r.msg) : J(r.out)}）`);
    }
    const apiSrc = readFileSync(join(JS, 'api.js'), 'utf8'), evSrc = readFileSync(join(JS, 'interp/evaluator.js'), 'utf8');
    ok(!/arguments\.length/.test(apiSrc.replace(/\/\/.*$/gm, '')) && /callHost\(fn, self, args\)\s*\{\s*const one = fn\[ONE_ARG\];/.test(evSrc),
      'K-1 配線: 引数の数は evaluator.js callHost が ONE_ARG の印で数え、api.js（コメントを除く）は arguments.length を使わない');
  }
  { // 選べる列の値と乱数の消費は是正前と同じ: choice(L) の列が L[randrange(len(L))]（同じ式 Math.floor(rand×長さ）を独立に使う経路）と一致。
    const code = 'import random\nL = [3, 1, 4, 1, 5, 9, 2, 6]\nS = "rumicar"\nrandom.seed(7)\na = []\nfor i in range(60):\n    a.append(random.choice(L))\n    a.append(random.choice(S))\n'
      + 'random.seed(7)\nb = []\nfor i in range(60):\n    b.append(L[random.randrange(len(L))])\n    b.append(S[random.randrange(len(S))])\nprint(a == b, len(a))\n';
    const r = runK(code, 'py');
    ok(!r.ctor && J(r.out) === J(['True 120']), `K-1 選べる列（list・str）の choice は是正前と同じ値と乱数の消費（${r.ctor ? 'ERR ' + r.msg : J(r.out)}）`);
  }
  { // 配線: api.js に JS の素の Error を投げる行が無い（コメントを含めて 0）・len／choice は RuntimeError（キー経由）。
    const apiSrc = readFileSync(join(JS, 'api.js'), 'utf8');
    const nErr = (apiSrc.match(/throw new Error\(/g) || []).length;
    const nRt = (apiSrc.match(/throw new RuntimeError\(\s*'(lenArg|choiceArg|choiceEmpty)'/g) || []).length;
    ok(nErr === 0 && nRt === 3, `K-1 配線: api.js の throw new Error( ${nErr} 件（期待 0）・RuntimeError('lenArg'／'choiceArg'／'choiceEmpty') ${nRt} 件（期待 3）`);
    const evSrc = readFileSync(join(JS, 'interp/evaluator.js'), 'utf8');
    ok(/callHost\(fn, self, args\)\s*\{[\s\S]*?instanceof RuntimeError && !e\.line/.test(evSrc), 'K-1 配線: evaluator.js の callHost が行の無い RuntimeError に呼び出した文の行を付ける');
  }

  console.log('\nK-2) 深い str() とスタック切れの文言 — 是正前: Model B の str(深い入れ子) は素の RangeError・def loop() の中は「1 段に達しました」');
  const REC_SUB = 'interp.err.recursionStack', REC = 'interp.err.recursion';
  // 是正前の上限の文言（BK1・ad5ddd1 のカタログの値そのもの）。上限 SIM.maxCallDepth の経路はこの文言のまま。
  const OLD_REC = ['関数の呼び出しが深すぎます (呼び出しの入れ子が {n} 段に達しました)。再帰を止める条件が正しいか確かめるか、ループで書き直してください',
    'Function calls are nested too deeply (the nesting reached {n} levels). Check the condition that stops the recursion, or rewrite it as a loop'];
  ok(MESSAGES[REC] && MESSAGES[REC].ja === OLD_REC[0] && MESSAGES[REC].en === OLD_REC[1], 'K-2 上限の文言 interp.err.recursion はカタログ上 BK1 の値のまま（ja/en）');
  ok(MESSAGES[REC_SUB] && MESSAGES[REC_SUB].ja && MESSAGES[REC_SUB].en && !/\{n\}|段/.test(MESSAGES[REC_SUB].ja) && !/\{n\}|level/.test(MESSAGES[REC_SUB].en) && !JP.test(MESSAGES[REC_SUB].en),
    `K-2 スタック切れの文言 ${REC_SUB}（ja/en 非空・段数を書かない・en に日本語なし）`);
  { // BL7 fix1（層4 F4）: 文言の例は list だけ。dict は浅くても str() が実行環境の TypeError（BK-9 の未是正の差）＝スタック切れの経路に届かない。
    const r = runK('d = {"a": 1}\ns = str(d)\n', 'py');
    ok(MESSAGES[REC_SUB] && !/dict/.test(MESSAGES[REC_SUB].ja + MESSAGES[REC_SUB].en) && r.key !== REC,
      `K-2 スタック切れの文言の例に dict を書かない（浅い dict の str() は ${r.ctor || '例外なし'}・${REC} ではない＝BK-9 の未是正の差）`);
  }
  const NEST = (n) => `for i in range(${n}):\n    a = [a]\n`;
  const DEEP = [
    // [ラベル, 本文, tick 数, 行]  — while True:／loop() は入れ子 40 万段（deepB.mjs と同じ 20 tick × 2 万段）・トップレベルで 1 回だけ走る本文は
    //   5 万段（1 回の評価ステップ上限 SIM.maxStepsPerTick の内側・Node 22 の既定のスタックでは str() が約 3300 段で尽きる）
    ['Model B（while True:）の str(深い入れ子の list)', 'a = []\nn = 0\nwhile True:\n    for i in range(20000):\n        a = [a]\n    n = n + 1\n    if n >= 20:\n        s = str(a)\n        print(len(s))\n', 20, 8],
    ['Model B の print(深い入れ子の list)', 'a = []\nn = 0\nwhile True:\n    for i in range(20000):\n        a = [a]\n    n = n + 1\n    if n >= 20:\n        print(a)\n', 20, 8],
    ['Model C（1 回だけ走る）の str(深い入れ子の list)', 'a = []\n' + NEST(50000) + 's = str(a)\n', 0, 4],
    ['Model A の setup 前の初期化（トップレベル）の print(深い入れ子)', 'a = []\n' + NEST(50000) + 'print(a)\ndef loop():\n    pass\n', 0, 4],
    ['def loop() の中の str(深い入れ子)（deep.mjs・既存の callUser の経路）', 'a = []\nn = 0\ndef setup():\n    pass\ndef loop():\n    global a\n    global n\n    for i in range(20000):\n        a = [a]\n    n = n + 1\n    if n >= 20:\n        s = str(a)\n        print(len(s))\n', 20, 12],
  ];
  for (const [label, code, ticks, ln] of DEEP) {
    const { ja, en } = runKBoth(code, 'py', ticks);
    const depth0 = ja.ctrl && ja.ctrl.interp ? ja.ctrl.interp.depth : '?';
    ok(ja.ctor === 'RuntimeError' && ja.key === REC && ja.msgKey === REC_SUB && ja.line === ln && ja.msg === want('ja', REC_SUB, {}, ln) && !ja.msg.includes('1 段') && depth0 === 0,
      `K-2 ${label} → ${REC}（文言 ${REC_SUB}・行 ${ln}・「1 段」なし・後の段数 ${depth0}）（実 ${ja.ctor} ${J(String(ja.msg).slice(0, 90))}・行 ${ja.line}）`);
    ok(en.key === REC && en.line === ln && en.msg === want('en', REC_SUB, {}, ln) && !JP.test(en.msg), `K-2 ${label}: en ${J(String(en.msg).slice(0, 90))}`);
  }
  { // 上限 SIM.maxCallDepth の経路の文言は従来どおり（n＝上限・BK1 C 章の型）。スタック切れでない RangeError（toFixed の桁数）はトップレベルでも変換しない。
    const LIM = SIM.maxCallDepth;
    const { ja, en } = runKBoth(`def f(n):\n    if n == 0:\n        return 0\n    return 1 + f(n-1)\nprint(f(5000))`, 'py', 0);
    ok(LIM === 200 && ja.key === REC && ja.msgKey === REC && ja.line === 4 && ja.msg === OLD_REC[0].replace('{n}', String(LIM)) + ' (行 4)' && en.msg === OLD_REC[1].replace('{n}', String(LIM)) + ' (line 4)',
      `K-2 上限 ${LIM} 段の経路は従来の文言（ja ${J(String(ja.msg).slice(0, 60))}…・行 ${ja.line}）`);
    const r = runK('x = "%.200f" % 1.5\n', 'py');
    ok(r.ctor === 'RangeError' && r.key !== REC, `K-2 トップレベルのスタック切れでない RangeError（"%.200f" % 1.5）は変換しない（実 ${r.ctor}）`);
  }

  console.log('\nK-3) dict の真偽と len — 是正前: Object.keys(v).length。値は不変・Object.keys を呼ばない（形）だけを主張し、速さは主張しない（BL7 fix1）');
  const DICT = 'e = {}\nd = {"a": 1}\np = {"__proto__": 1}\nprint(bool(e), bool(d), bool(p), not e, not d)\nif e:\n    print("e-if")\nif d:\n    print("d-if")\nif p:\n    print("p-if")\n'
    + 'n = 0\nwhile d:\n    n += 1\n    d.pop("a")\nprint(n, bool(d))\nwhile e:\n    print("never")\nq = {"x": 1, "y": 2}\nq.clear()\nprint(bool(q), "t" if q else "f")\n'
    + 'print(len({}), len({"a": 1, "b": 2}), len({1: 2, True: 3}), len(p), len(q))\n';
  const DICT_WANT = ['False True True True False', 'd-if', 'p-if', '1 False', 'False f', '0 2 1 1 0'];
  {
    const r = runK(DICT, 'py');
    ok(!r.ctor && J(r.out) === J(DICT_WANT), `K-3 if／while／not／bool()／三項の dict の真偽と len（トップレベル）: ${r.ctor ? 'ERR ' + r.msg : J(r.out)}`);
    const body = DICT.split('\n').filter(Boolean).map((l) => '    ' + l).join('\n');
    const r2 = runK('def setup():\n    pass\ndef loop():\n' + body + '\n', 'py', 1);
    ok(!r2.ctor && J(r2.out) === J(DICT_WANT), `K-3 同じ本文を def loop() の中で: ${r2.ctor ? 'ERR ' + r2.msg : J(r2.out)}`);
    if (PY3K) { const p = py3(DICT); ok(J(p.out) === J(DICT_WANT), `K-3 python3 も同じ出力（${J(p.out)}）`); }
  }
  { // 配線: evaluator.js の py の真偽（pyTruthy と dict の判定）と api.js の len は Object.keys を使わない。
    const evSrc = readFileSync(join(JS, 'interp/evaluator.js'), 'utf8');
    const apiSrc = readFileSync(join(JS, 'api.js'), 'utf8');
    const fnBody = (src, re) => { const m = re.exec(src); if (!m) return null; const i = m.index; const j = src.indexOf('\n}', i); return j < 0 ? null : src.slice(i, j + 2); };
    const truthy = fnBody(evSrc, /^function pyTruthy\(v\) \{/m);
    const nonEmpty = fnBody(evSrc, /^function dictNonEmpty\(o\) \{/m) || ((/^function dictNonEmpty\(o\) \{.*\}$/m.exec(evSrc) || [])[0] || null);
    const lenM = /const pyLen = (?:\(x\) =>|function \(x\)) \{[\s\S]*?\n {2}\};/.exec(apiSrc);   // e961e4b までは (x) =>・fix1 から function (x)（arguments.length）
    ok(truthy && !truthy.includes('Object.keys') && /dictNonEmpty\(v\)/.test(truthy) && nonEmpty && !nonEmpty.includes('Object.keys') && /for \(const k in o\) return true/.test(nonEmpty),
      `K-3 配線（形）: evaluator.js pyTruthy は dictNonEmpty（for … in）で判定し Object.keys を呼ばない（pyTruthy ${truthy ? truthy.length + ' 字' : '無し'}）`);
    ok(lenM && !lenM[0].includes('Object.keys') && /for \(const k in x\)/.test(lenM[0]), `K-3 配線（形）: api.js pyLen は for … in で鍵を数え Object.keys を呼ばない（${lenM ? lenM[0].length + ' 字' : 'pyLen 無し'}）`);
    // BL7 fix1（層4 F1）＋fix2（層4 往復 2 F3）: 速さを主張しない（e961e4b は dictNonEmpty の上の注記と physics_model §9 に「O(1)」「鍵の一覧を
    //   作らない」と書いた）。見る範囲＝evaluator.js の pyTruthy の上の注記から dictNonEmpty の行まで・api.js の pyLen の上の注記から本体の終わりまで・
    //   physics_model.md／.en.md の §9 の dict を含む行・changelog.js の dict／辞書を含む文（。か ". " で区切る）。語は言い換えを含めて SPEED。
    const SPEED = /O\(1\)|定数時間|一定時間|高速|鍵の一覧を作らない|constant[- ]time|faster|quicker|no longer builds the list of keys/gi;
    const noteStart = (src, at) => {   // at を含む行の上に続く // の注記の始まり
      let s0 = src.lastIndexOf('\n', at - 1) + 1;
      while (s0 > 0) { const p = src.lastIndexOf('\n', s0 - 2) + 1; if (!/^\s*\/\//.test(src.slice(p, s0 - 1))) break; s0 = p; }
      return s0;
    };
    const span = (src, startRe, endRe) => { const a = startRe.exec(src); const b = endRe.exec(src); if (!a || !b) return ''; const e = src.indexOf('\n', b.index); return src.slice(noteStart(src, a.index), e < 0 ? src.length : e); };
    const evNotes = span(evSrc, /^function pyTruthy\(v\) \{/m, /^function dictNonEmpty\(o\) \{/m);
    const lenNotes = lenM ? apiSrc.slice(noteStart(apiSrc, lenM.index), lenM.index + lenM[0].length) : '';
    const sec9 = (md) => { const a = md.search(/^## 9\./m); if (a < 0) return ''; const b = md.slice(a + 3).search(/^## /m); return md.slice(a, b < 0 ? md.length : a + 3 + b); };
    const pmJa = readFileSync(join(ROOT, 'docs/physics_model.md'), 'utf8'), pmEn = readFileSync(join(ROOT, 'docs/physics_model.en.md'), 'utf8');
    const dictLines = (md) => sec9(md).split('\n').filter((l) => /dict/.test(l)).join('\n');
    const clSrc = readFileSync(join(JS, 'changelog.js'), 'utf8');
    const clDict = clSrc.split(/。|\. /).filter((x) => /dict|辞書/.test(x)).join('\n');
    const hits = (label, txt) => [...new Set(txt.match(SPEED) || [])].map((w) => `${label} の「${w}」`);
    const claims = [...hits('evaluator.js pyTruthy〜dictNonEmpty の注記', evNotes), ...hits('api.js pyLen の注記と本体', lenNotes),
      ...hits('physics_model.md §9 の dict の行', dictLines(pmJa)), ...hits('physics_model.en.md §9 の dict の行', dictLines(pmEn)), ...hits('changelog.js の dict の文', clDict)];
    ok(evNotes.length > 200 && lenNotes.length > 200 && dictLines(pmJa) && dictLines(pmEn),
      `K-3 速さの語を探す範囲が取れた（evaluator ${evNotes.length} 字・api ${lenNotes.length} 字・§9 の dict の行 ja ${dictLines(pmJa).split('\n').length}／en ${dictLines(pmEn).split('\n').length} 行・changelog の dict の文 ${clDict ? clDict.split('\n').length : 0}）`);
    ok(claims.length === 0, `K-3 速さの主張が無い（注記・§9・changelog の語 SPEED）${claims.length ? '（残り: ' + claims.join('・') + '）' : ''}`);
  }
  { // 参考の印字（判定しない）: 本番の pyTruthy（Interp.tr）と pyLen の 1 回あたりの時間を、是正前の式（Object.keys(v).length）と並べる。
    const ipK = runK('x = 1\n', 'py').ctrl.interp;   // 本番の buildController が作った py の Interp
    const lenK = buildApi({ car: new DynCar(courseK.start), walls: courseK.walls, start: courseK.start, log() {}, _sensors: [], _pendingDelay: 0, _others: [], _simMs: 0 }).len;
    const per = (f, d, it) => { let s = 0; const t0 = process.hrtime.bigint(); for (let i = 0; i < it; i++) s += f(d) ? 1 : 0; return [Number(process.hrtime.bigint() - t0) / it / 1000, s]; };
    const row = [];
    for (const N of [1, 1000, 20000]) {
      const d = Object.create(null); for (let i = 0; i < N; i++) d['k' + i] = i;
      const it = N >= 20000 ? 50 : N >= 1000 ? 2000 : 50000;
      const [a] = per((v) => ipK.tr(v), d, it), [b] = per((v) => Object.keys(v).length > 0, d, it), [c] = per(lenK, d, it), [e] = per((v) => Object.keys(v).length, d, it);
      row.push(`N=${N} 真偽 ${a.toFixed(2)}／${b.toFixed(2)} µs・len ${c.toFixed(2)}／${e.toFixed(2)} µs`);
    }
    console.log(`  （参考・判定しない）本番／Object.keys 版: ${row.join('・')}`);
  }

  console.log('\nK-4) ループの条件で出たエラーの行（BL7 fix1・層4 F3）— e961e4b まで: 2 回目以降の条件は本体の最後の文の行のまま評価した');
  const LOOPS = [
    // [ラベル, 言語, 本文, tick 数, 期待のキー, 行]
    ['py while の条件の len(None)（2 回目）', 'py', 'x = 2\ny = [1]\nwhile len(y) > 0:\n    x = x - 1\n    y = None\n', 0, 'interp.err.lenArg', 3],
    ['py while の条件のゼロ除算（2 回目・def loop() の中）', 'py', 'def loop():\n    k = 1\n    while 10 / k:\n        k = k - 1\n        z = 5\n', 1, 'interp.err.divZero', 3],
    ['py while の条件が呼んだ関数の中のエラー（行＝関数の中の文）', 'py', 'def f(v):\n    return len(v)\nx = 2\ny = [1]\nwhile f(y) > 0:\n    y = None\n    x = 0\n', 0, 'interp.err.lenArg', 2],
    ['C while の条件（2 回目）', 'c', 'void setup(){\n  int k = 1;\n  while ((10 % k) + 1) {\n    k = k - 1;\n    k = k + 0;\n  }\n}\nvoid loop(){}', 0, 'interp.err.divZero', 3],
    ['C for の条件（2 回目）', 'c', 'void setup(){\n  int k = 1;\n  for (int i = 0; (10 % k) + 1; i++) {\n    k = k - 1;\n    k = k + 0;\n  }\n}\nvoid loop(){}', 0, 'interp.err.divZero', 3],
    ['C for の更新部', 'c', 'void setup(){\n  int k = 1;\n  for (int i = 0; i < 3; i = 10 % k) {\n    k = k - 1;\n    k = k + 0;\n  }\n}\nvoid loop(){}', 0, 'interp.err.divZero', 3],
    ['C do-while の条件（行＝while の行）', 'c', 'void setup(){\n  int k = 1;\n  do {\n    k = k - 1;\n    k = k + 0;\n  } while (10 % k);\n}\nvoid loop(){}', 0, 'interp.err.divZero', 6],
  ];
  for (const [label, lang, code, ticks, key, ln] of LOOPS) {
    const r = runK(code, lang, ticks);
    ok(r.ctor === 'RuntimeError' && r.key === key && r.line === ln && r.ctrl && r.ctrl.line() === ln, `K-4 ${label} → ${key}（行 ${ln}）（実 ${r.ctor || '例外なし'} ${r.key || ''}・行 ${r.line}・ハイライト ${r.ctrl ? r.ctrl.line() : '?'}）`);
  }
  // エラーの出ない tick の後の実行位置ハイライトと、条件に関数の呼び出しの無いループのステップ上限エラーの行は是正前と同じ（条件の評価の後に
  //   curLine を戻す・条件の評価そのものは tick しない・更新部の tick は先）。条件の中の関数の呼び出しの 1 歩で上限を越える形は下の STEPC。
  const SAME = [
    ['py while の後のハイライト（本体の最後の文）', 'py', 'def loop():\n    x = 3\n    while x > 0:\n        x = x - 1\n        y = 1\n', 1, null, 5],
    ['C for の後のハイライト（本体の最後の文）', 'c', 'void setup(){}\nvoid loop(){\n  int k = 0;\n  for (int i = 0; i < 3; i++) {\n    k = k + 1;\n    k = k + 0;\n  }\n}', 1, null, 6],
    ['py while のステップ上限（行＝本体の最後の文）', 'py', 'def loop():\n    x = 1\n    while x > 0:\n        x = x + 1\n        y = 2\n', 1, 'interp.err.stepLimit', 5],
    ['C for のステップ上限（行＝本体の最後の文）', 'c', 'void setup(){}\nvoid loop(){\n  int k = 0;\n  for (int i = 0; i < 3; i = i + 0) {\n    k = k + 1;\n    k = k + 0;\n  }\n}', 1, 'interp.err.stepLimit', 6],
  ];
  for (const [label, lang, code, ticks, key, ln] of SAME) {
    const r = runK(code, lang, ticks);
    const got = key ? r.line : (r.ctor ? 'ERR ' + r.msg : r.ctrl.line());
    ok((key ? r.key === key : !r.ctor) && got === ln && r.ctrl && r.ctrl.line() === ln, `K-4 ${label}: 行 ${ln}（実 ${r.key || '例外なし'}・${got}）`);
  }
  // BL7 fix2（層4 往復 2 F1）: ステップ上限エラーは「上限を越えた 1 歩」の行。その 1 歩が条件（while・C の for の条件と更新部・elif／else if）の中の
  //   関数の呼び出し（evalCall の tick）なら、そのループ／elif／else if の行（e961e4b までは本体の最後に実行した文・最初の if の行）。どの 1 歩で
  //   越えるかは SIM.maxStepsPerTick（刻んだ時 200000）とステップの数え方で決まる＝上限を変えたら刻み直す。変種は層4 の probe（条件に abs()／f() を
  //   書き本体の文の数を 0〜5 で振った 36 変種中 10 が変化）から経路ごとに 1 つ＋elif／else if（本体 0〜11 の文で探索）。[ラベル, 言語, 本文, 行, e961e4b の行]
  const B = (n, l) => Array.from({ length: n }, () => l).join('');
  const STEPC = [
    ['py while の条件の abs()', 'py', 'def loop():\n    x = 1\n    while abs(x) > 0:\n        x = x + 1\n', 3, 4],
    ['py while の条件の自作の関数 f()', 'py', 'def f(v):\n    return v\ndef loop():\n    x = 1\n    while f(x) > 0:\n        x = x + 1\n' + B(2, '        y = 2\n'), 5, 8],
    ['C while の条件の abs()', 'c', 'void setup(){}\nvoid loop(){\n  int k = 0;\n  while (abs(k) >= 0) {\n    k = k + 1;\n  }\n}', 4, 5],
    ['C for の条件の abs()', 'c', 'void setup(){}\nvoid loop(){\n  int k = 0;\n  for (int i = 0; abs(i) < 3; i = i + 0) {\n    k = k + 1;\n' + B(3, '    k = k + 0;\n') + '  }\n}', 4, 8],
    ['C for の更新部の abs()', 'c', 'void setup(){}\nvoid loop(){\n  int k = 0;\n  for (int i = 0; i < 3; i = i + abs(0)) {\n    k = k + 1;\n' + B(2, '    k = k + 0;\n') + '  }\n}', 4, 7],
    ['py elif の条件の abs()', 'py', 'def loop():\n    x = 1\n    while True:\n        if x < 0:\n            y = 1\n        elif abs(x) < 0:\n            y = 2\n        y = 2\n', 6, 4],
    ['C else if の条件の abs()', 'c', 'void setup(){}\nvoid loop(){\n  int k = 0;\n  while (1) {\n    if (k < 0) {\n      k = 1;\n    } else if (abs(k) < 0) {\n      k = 2;\n    }\n    k = k + 0;\n  }\n}', 7, 5],
  ];
  ok(SIM.maxStepsPerTick === 200000, `K-4 ステップ上限の行の表を刻んだ時の SIM.maxStepsPerTick＝200000（実 ${SIM.maxStepsPerTick}・違えば STEPC を刻み直す）`);
  for (const [label, lang, code, ln, old] of STEPC) {
    const r = runK(code, lang, 1);
    ok(r.key === 'interp.err.stepLimit' && r.line === ln && r.ctrl && r.ctrl.line() === ln,
      `K-4 ${label}の 1 歩で上限 → ステップ上限の行 ${ln}（e961e4b まで ${old}）（実 ${r.key || '例外なし'}・行 ${r.line}・ハイライト ${r.ctrl ? r.ctrl.line() : '?'}）`);
  }
  // BL7 fix2（層4 往復 2 F4）: elif／else if の条件で出たエラーの行＝その elif／else if の行（parser が列挙しない condLine を付け、evaluator の if が
  //   condAt で評価）。e961e4b・cb9ea81 は最初の if の行（elif の節は行を持たない）。本体・else の本体・条件が呼んだ関数の中のエラーの行と、
  //   エラーの出ないときのハイライトは従来どおり。
  const ELIF = [
    // [ラベル, 言語, 本文, tick 数, 期待のキー（null＝エラーなし）, 行（エラーの行かハイライト）, 是正前の行]
    ['py elif の条件のゼロ除算', 'py', 'k = 0\nif k > 5:\n    x = 1\nelif 10 / k:\n    x = 2\n', 0, 'interp.err.divZero', 4, 2],
    ['py elif の条件の len(None)', 'py', 'y = None\nif y == 1:\n    x = 1\nelif len(y):\n    x = 2\n', 0, 'interp.err.lenArg', 4, 2],
    ['py 2 つ目の elif の条件', 'py', 'k = 0\nif k > 5:\n    x = 1\nelif k > 6:\n    x = 2\nelif 10 / k:\n    x = 3\n', 0, 'interp.err.divZero', 6, 2],
    ['py def loop() の中の elif の条件', 'py', 'def loop():\n    k = 0\n    if k > 5:\n        x = 1\n    elif 10 / k:\n        x = 2\n', 1, 'interp.err.divZero', 5, 3],
    ['C else if の条件のゼロ除算', 'c', 'void setup(){\n  int k = 0;\n  if (k > 5) {\n    k = 1;\n  } else if (10 % k) {\n    k = 2;\n  }\n}\nvoid loop(){}', 0, 'interp.err.divZero', 5, 3],
    ['py else の本体のエラー（行＝本体の文・従来どおり）', 'py', 'k = 0\nif k > 5:\n    x = 1\nelif k > 6:\n    x = 2\nelse:\n    x = 10 / k\n', 0, 'interp.err.divZero', 7, 7],
    ['C else if の条件が呼んだ関数の中のエラー（行＝関数の中の文・従来どおり）', 'c', 'int g(int v){\n  return 10 % v;\n}\nvoid setup(){\n  int k = 0;\n  if (k > 5) {\n    k = 1;\n  } else if (g(k)) {\n    k = 2;\n  }\n}\nvoid loop(){}', 0, 'interp.err.divZero', 2, 2],
    ['py elif が偽のときのハイライト（if の行・従来どおり）', 'py', 'def loop():\n    k = 0\n    if k > 5:\n        x = 1\n    elif k > 9:\n        x = 2\n', 1, null, 3, 3],
    ['py elif が真のときのハイライト（本体の文・従来どおり）', 'py', 'def loop():\n    k = 0\n    if k > 5:\n        x = 1\n    elif k < 9:\n        x = 2\n', 1, null, 6, 6],
    ['C else if が偽のときのハイライト（if の行・従来どおり）', 'c', 'void setup(){}\nvoid loop(){\n  int k = 0;\n  if (k > 5) {\n    k = 1;\n  } else if (k > 9) {\n    k = 2;\n  }\n}', 1, null, 4, 4],
  ];
  for (const [label, lang, code, ticks, key, ln, old] of ELIF) {
    const r = runK(code, lang, ticks);
    const got = key ? r.line : (r.ctor ? 'ERR ' + r.msg : r.ctrl.line());
    ok((key ? r.ctor === 'RuntimeError' && r.key === key : !r.ctor) && got === ln && r.ctrl && r.ctrl.line() === ln,
      `K-4 ${label} → ${key || 'エラーなし'}・行 ${ln}（是正前 ${old}）（実 ${r.key || (r.ctor ? r.ctor : '例外なし')}・${got}）`);
  }
  { // condLine は列挙しない＝AST の JSON（出荷サンプルの AST 指紋・wf_bj1_pysem E 章）に出ない。
    const { parsePy } = await impK('interp/parser_py.js');
    const { parseC } = await impK('interp/parser_c.js');
    const ap = parsePy('k = 0\nif k > 5:\n    x = 1\nelif k > 6:\n    x = 2\nelif k:\n    x = 3\n');
    const ac = parseC('void setup(){\n  int k = 0;\n  if (k > 5) {\n    k = 1;\n  } else if (k) {\n    k = 2;\n  }\n}\nvoid loop(){}');
    const e1 = ap.body[1].els && ap.body[1].els[0], e2 = e1 && e1.els && e1.els[0];
    const sc = ac.body.find((f) => f.name === 'setup'), ce = sc && sc.body[1].els && sc.body[1].els[0];
    ok(e1 && e1.condLine === 4 && e2 && e2.condLine === 6 && ce && ce.condLine === 5 && !JSON.stringify(ap).includes('condLine') && !JSON.stringify(ac).includes('condLine')
      && !Object.keys(e1).includes('condLine') && e1.line == null,
      `K-4 elif／else if の condLine（py ${e1 && e1.condLine}・${e2 && e2.condLine}／C ${ce && ce.condLine}）は列挙しない（AST の JSON に出ない・elif の節は line を持たない）`);
  }
  i18nK.setLang('ja');
}

const line = '─'.repeat(64);
console.log('\n' + line);
console.log(`wf_bl1_ui: pass=${pass} fail=${fail}`);
if (fail) { for (const m of fails.slice(0, 40)) console.log('  ✗ ' + m); if (fails.length > 40) console.log(`  … ほか ${fails.length - 40} 件`); }
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
