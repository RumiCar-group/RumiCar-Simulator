// wf_run_all.mjs — 常設ゲート標準ランナー (Stage AP21・本番フロー/実データ・CI-8/9/14)。
// ════════════════════════════════════════════════════════════════════════════
// 目的: 散在する常設アサーションゲート (exit 非0=失敗) を「任意 cwd から1本で・機械集約」実行し、
//       全緑なら exit 0・1本でも失敗なら exit 非0＋**失敗ゲート名を列挙**する。AP29 最終監査
//       (受け入れ①「全常設ゲート緑をランナーで機械集約」) の常設インフラ。
//
// 設計 (CI-14 実態志向):
//  ・cwd 非依存: ROOT を import.meta.url から解決し、各ゲートを **cwd=ROOT** で子プロセス実行する。
//    (ゲートの多くは `fs.readFileSync('public/data/courses.json')` 等の相対読取を持つため cwd 固定が要る。
//     module import 系は module 相対で cwd 非依存だが、混在するので cwd=ROOT に統一するのが唯一安全。)
//  ・非変異の機械証明: 実行前後で product ソース (messages.js / config.js) の sha256 を照合し、
//    **ランナーが product を書換えない**ことを証明する。ゆえに変異ツール (wf_i18n_rehash / wf_refreeze) と
//    書込を伴う maintenance は集合外。official_result の副作用 (result.json 書込) は --out を tmp へ隔離。
//  ・timing 隔離: WF_SKIP_TIMING=1 を子へ透過 (env 継承)。対応しているのは **wf_bc7_budget の C/D 章だけ**
//    (その章だけ skip・他の章は走る)。BD5 (2026-09-21) で wf_ao5_calib の J 章を撤去するまでは 2 本あった。
//    **これで全部ではない**: wf_az2_fitguard は PERF_BUDGET_MS=50ms の壁時計判定を持ち
//    WF_SKIP_TIMING の対象外 (BC7 で確認)。
//  ・沈黙截断の禁止 (CI-14): 意図的に非実行にした probe / library / 変異ツール / 生成ツール / ランナー自身を EXCLUDED として明示表示し、
//    ROOT 直下の wf_*.mjs 実ファイルと GATES＋EXCLUDED を突合する (BE5。食い違えばゲートを回さず exit 1)。
//
// 使い方:
//   node wf_run_all.mjs                # 全ゲート実行 (壁時計の章を含む)
//   WF_SKIP_TIMING=1 node wf_run_all.mjs   # 壁時計に依存する章 (bc7 C/D) を隔離した安定実行
//   node wf_run_all.mjs --list         # 実行対象/除外の一覧だけ表示 (実行しない)
// exit: 0=全緑かつ guard 不変 / 1=いずれかのゲート失敗 or guard 変化 or 一覧の不整合 (--list でも 1)。
// ════════════════════════════════════════════════════════════════════════════
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = dirname(fileURLToPath(import.meta.url)); // = Simulator ディレクトリ (cwd 非依存)
const sha256 = (p) => createHash('sha256').update(readFileSync(join(ROOT, p))).digest('hex');

// 実行前後で不変を証明する product ソース (ランナーが変異ツールを含まない機械証明)。
const GUARD_FILES = ['public/js/i18n/messages.js', 'public/js/config.js'];

// 常設アサーションゲート (exit 非0=失敗)。名前は wf_*.mjs 実ファイル (ROOT 直下)。
// wf_am2_cone は process.exitCode=1 のソフト終了 (完走してから非0)。spawnSync は最終 exit code を拾う。
const GATES = [
  'wf_ab8_bench.mjs', 'wf_ak5_robustness.mjs', 'wf_am1_cone.mjs', 'wf_am2_cone.mjs', 'wf_am4_rear.mjs',
  'wf_ao1_v2.mjs', 'wf_ao2_tire.mjs', 'wf_ao3_drivetrain.mjs', 'wf_ao4_contact.mjs', 'wf_ao5_calib.mjs',
  'wf_ao6_slip.mjs', 'wf_ao8_gonogo.mjs', 'wf_ao9_recon.mjs', 'wf_ao10_localize.mjs', 'wf_ao11_strategist.mjs',
  'wf_ao12_wear.mjs', 'wf_ap4_uisafe.mjs', 'wf_ap6_equiv.mjs', 'wf_ap14_wallhairpin.mjs', 'wf_ap15_downhill_gonogo.mjs',
  'wf_ap16_semantics.mjs', 'wf_ap17_errmsg.mjs', 'wf_ap18_hold.mjs', 'wf_ap19_noise.mjs', 'wf_ap25_roundtrip.mjs', 'wf_ap26_pendulum.mjs', 'wf_capacity_fit.mjs',
  'wf_carscale_determinism.mjs', 'wf_clearance.mjs', 'wf_collision_model.mjs', 'wf_recover_model.mjs', 'wf_ratio_audit.mjs',
  'wf_sprite_extent.mjs', 'wf_silhouette_fill.mjs', 'wf_share_check.mjs', 'wf_fmttime_check.mjs', 'wf_i18n_check.mjs',
  'wf_fan_render.mjs', 'wf_version_check.mjs', 'wf_ghostgap_cap.mjs', 'wf_modulepreload.mjs',
  'wf_ghlist_cache.mjs',
  'wf_as3_samples.mjs', 'wf_as4_carray.mjs', 'wf_as5_calibrate.mjs', 'wf_as7_midscale.mjs', 'wf_as8_optics.mjs',
  'wf_as9_tire_gear.mjs', 'wf_as10_cant.mjs', 'wf_as11_susp.mjs', 'wf_as12_steer.mjs', 'wf_as13_engage.mjs',
  // AU1: 逆ハン符号是正にともない probe(アサート無し) から常設ゲートへ昇格。
  'wf_touge_drift_probe.mjs',
  // AU3: 2026-09-04 の再検証スクラッチ3本(自由空間/切替最適化/2台走行)を統合して常設ゲート化。
  //   ランナーは既定(縮小掃引)で回す。--full は docs 転記用で桁違いに長い(実測 約30分)ため対象外。
  //   ※ 既定と --full で **結論が変わらない**ことは AU3 で確認済み(縮小格子が --full の唯一の GO を
  //     見つけられるよう β=35/pCatch=110 を含めてある)。所要はゲート自身が Part 別に印字する。
  'wf_drift_reexam.mjs',
  // AV1: ルーズ路面属性 course.surface='loose'（掘り込み項）の受け入れゲート。
  //   既定=縮小掃引。--full は docs 転記用で長い。Part C（実走 go/no-go）が所要の大半を占める。
  'wf_av1_loose.mjs',
  // AV2: 4輪摩擦ブレーキ brakeSet（車両の任意装備）の受け入れゲート。
  //   既定=縮小掃引（D 章の格子2 を 32 セルへ）。--full は docs 転記用で 288 セルへ広げる。
  'wf_av2_brake.mjs',
  // AW1: 車輪 ODE と車体加速度の同一 substep 連成（AP13 半陰的化の過小伝達の是正）の受け入れゲート。
  //   参照解（同じ製品コードの陽的経路）との一致・本番 nSub での安定性・陽的経路の回帰指紋・avgNSub を固定。
  'wf_aw1_coupled.mjs',
  // AX1: 峠を安定して走る基準ドライバ（Stage AX の測定の土台）の受け入れゲート。
  //   完走 18 セル・決定論 5 回・既定サンプルとの ±30% 帯・横位置追従・予備実装の欠陥 2 件の固定。
  //   本体は library `wf_touge_driver.mjs`（下の EXCLUDED に明示）。
  'wf_ax1_touge_base.mjs',
  // AX2: 峠の「速いライン」の同定とブロック対象の定義。コーナー 20 本 × 横位置 7 分割で
  //   到達可能性（実走判定）・最大通過速度・区間所要・「内側 1/3 を占有されたときのコスト」を固定。
  'wf_ax2_lines.mjs',
  // AX3: 多車・片道レースでのブロック戦術の測定（道幅比の掃引を含む）。既定=縮小掃引。--full は docs 転記用で長い。
  'wf_ax3_block.mjs',
  // AY1: 逆算ベンチ（外径比 R_out/R_min × 道幅）での grip vs drift 同予算比較。既定=縮小掃引（本ホスト実測 約 225 秒）。
  //   --full は予算 2 倍・二分探索を細かく（docs 転記用）。本体の最適化器は library `wf_drift_opt.mjs`
  //   （= wf_drift_reexam から純粋抽出したもの。下の EXCLUDED に明示）。
  'wf_ay1_rmin_bench.mjs',
  // AZ2: フィットガードが落ち着いた先で「実態収容 capN ≥ 1」（＝車が壁の中に湧いたまま留まらない）。
  //   出荷全コース × 3 領域 × 6 carScale の全格子で改修前後の落ち着き先を突き合わせ（救済以外の変化を 0 に
  //   固定）、閉じた細い廊下の治具で欠陥の再現を保ち、product 側に「1 台は必ず置ける」仮定が戻っていないかを
  //   ソースの構造条件で検査する。所要は本ホスト実測 7m38s（2026-09-15・BA1 前・単独）→ 66s（BA1 後・単独）。
  //   BA1 で判定コアの fitsAllCars メモの契約（鍵・寿命）と「判定をまたいで持ち越さない」振る舞い（H)）を追加。
  'wf_az2_fitguard.mjs',
  // BA1: 判定コアの性能改修（fleet.js/physics.js/geom.js/fitguard.js）が収容オラクルの答えを 1 ビットも変えていないこと。
  //   改修前ツリーで取った出力ダイジェスト（配置列・fitsAllCars・capacityOf・minClearance）の凍結と突合・その感度の
  //   自己検査・性能改修の形（とキャッシュ混在で起動しなくなる import を作らないこと）の構造検査・変異試験。
  //   wf_az2_fitguard の A) は新旧とも同じ product オラクルを呼ぶのでオラクルの中身の変化を検出できない＝その穴を埋める。
  //   所要は本ホスト実測 約 100s（2026-09-15・単独）。
  'wf_ba1_fitcore.mjs',
  // AZ5: 収容ゼロ (capN=0) をどの経路でも黙って 1 に丸めない。race_engine の fit ガードが 0 台のレースを
  //   成立させないこと、capacity.js の driveableCapN が実走の 0 を返せること、main.js ⑥ と 4 つのレース
  //   呼び出し側が 0 と減台を無言にしないことを、治具での再現・出荷コースの回帰・構造検査・変異試験で固定する。
  //   所要は本ホスト実測 43.7s（2026-09-12・wf_run_all 内）。内訳の大半は B-1（出荷 66 コース × driveableCapN）と
  //   B-2（実態収容 0 台の 74 セル × 旧挙動の反証レース）。
  'wf_az5_capzero.mjs',
  // BB2: 投稿コースの形式検査 course.js:checkCourseData。出荷全コース（とエディタ形の JSON 往復）を 1 件も落とさない・
  //   形ごとの期待（除外理由の JSON パスまで）・合格した変種を normalizeCourse が安全に扱える・大きさの上限と利用側の壁グリッド・変異試験・
  //   course.js の新しい名前を名前付き import しない（キャッシュ混在で起動しなくなる）。上流の現行投稿は
  //   実ブラウザゲート browser/check_bb2_community_bad.mjs が本物で見る（本ゲートはネットワーク不要）。所要は本ホスト実測 約 6s。
  'wf_bb2_course_check.mjs',
  // BC3: コースの取り込み経路が「1 つの入口」(course.js:acceptCourseData = 検査 → 正規化) を通ることの固定。
  //   入口の契約 (例外を投げない・合格時は normalizeCourse と byte 同値＝決定論を変えない)・**取り込み元で
  //   分けた 2 つの基準の関係** (own は std より緩い／枠を縮めた自作コースは開ける／own が受け取った入力では
  //   本物の壁グリッドが終わる)・main.js の経路ごとの配線と裸の normalizeCourse( が残っていないこと・
  //   名前空間 import の互換 (BA1)・配線の変異試験。不正入力コーパスは wf_course_corpus.mjs (実ブラウザ
  //   ゲートと共有＝写しを作らない)。所要は本ホスト実測 約 2s。
  'wf_bc3_intake.mjs',
  // BC7: 性能予算。旧 AP13「µs/tick/台 ≤60」(絶対時間の代理量・当時のホストの実測値を丸めたもの) を
  //   「FLEET.maxCars 台を UI が出せる最大の速度倍率で走らせてシム時刻が遅れないこと」という実態へ
  //   置き換え、下限を product (index.html の #speed の max / config の FLEET.maxCars) から導出する。
  //   壁時計アサートを含むので WF_SKIP_TIMING=1 では C/D だけを skip する (AP21 の運用)。
  //   BD5 で wf_ao5_calib J を撤去し、その床 10× を本ゲートの E3 へ backstop として移設した。
  //   ライブ経路 (requestAnimationFrame) の実測は実ブラウザゲート browser/check_bc7_frame.mjs。
  //   所要は本ホスト実測 9.1s（wf_run_all 内・2026-09-19）。
  'wf_bc7_budget.mjs',
  // BD1: 実走容量 driveableCapN の覚え書きが「同じコース」を**形状**で判定すること。鍵が course.name だった
  //   ため、保存コースの壁だけを編集して同じ名前で ✔適用すると古い実走判定が返っていた（BC-12 ③(a)）。
  //   壁だけ違う 2 組（本数が変わる/座標だけ変わる）× 順序の両方向で真値（stuckAtN）との一致・digest の
  //   衝突ゼロ・項目数の上限・carScale 掃引で増えないこと・鍵を壊す変異 4 件の検出力を固定する。
  //   本番 UI（▶→編集→✔適用→▶）での再現と是正は browser/check_bd1_capkey.mjs。所要は本ホスト実測 11.5s（単独・2026-09-20）。
  'wf_bd1_capkey.mjs',
  // BE2: 練習ベストを「コース名」でなく「コースの形」で引くこと（BD-3(a)・BB-4 ⑤）。鍵が course.name だったため、
  //   保存コースの壁だけを編集して同じ名前で ✔適用すると別レイアウトのベストが自分の記録として出た。
  //   v8.7.0 形式の記録の後方互換（出荷全コース × 全車種で損失 0）・形の差で分かれ名前/説明では分かれないこと・
  //   同名の別コースを取り違えないこと・証明できない旧記録を出さず消さないこと・バックアップ往復・出荷全コースの
  //   指紋と courseHashOf の凍結表（鍵は指紋の値に・旧記録の採否は courseHashOf の値に永続的に依存する）・
  //   ±1/±8 ulp の揺れで指紋が変わらないこと（別系統のブラウザへの移行）・rebuildSpawns の memo の配線・変異 12 件の検出力。
  //   本番 UI（走る→編集→✔適用→HUD の BEST）での再現と是正は browser/check_be2_practicekey.mjs。所要は本ホスト実測 1.7s（単独・2026-09-24）。
  'wf_be2_practicekey.mjs',
  // BE3: 投稿車種・自作車・公式レースの持ち込み車種が組込車種を上書きしないこと（BD-3(b)）。registerCarType が組込 key も
  //   置き換えていたので、起動時の自作車・公式レースの持ち込み車種で組込 FR（容量プローブ車）の物理が変わっていた。
  //   組込 6 車種 × 5 形の def で 1 bit も変わらないこと・自作車の追加/更新/drift 継承/削除が従来どおりなこと・
  //   持ち込み車種はレース中だけ効き（改修前ツリーで刻んだ verifyHash と一致）レース後は車種表が参照ごと元どおりなこと・
  //   形の変わった key（'__proto__'・非文字列）や登録中/レース中の例外でも元どおりなこと・改修前相当の config.js が
  //   キャッシュに残っても読み込めること（BA1）・変異 13 件の検出力。本番 UI（起動時の告知・追加ボタン・複製での救済・
  //   公式レース再実行の結果表/ゴースト凡例の車種名）は browser/check_be3_cartype.mjs。所要は本ホスト実測 6.7s（単独・2026-09-24）。
  'wf_be3_cartype.mjs',
  // BE6: 投稿コースの入口で重さの上限と名前の取り違えを止める（BB-4 ④⑤⑥）。名前/説明/ファイル全体の大きさの上限（std だけ・
  //   出荷と上流の投稿の実測最大の 2 倍・壁本数の上限は下げない）と境目・own ⊇ std・枠の外の壁の数え方が投稿基準と一致すること・
  //   main.js の配線（枠外の告知 4 経路・保存コースの option value の衝突回避・名前で引く 2 か所の「ちょうど 1 件」規則・
  //   公式開催は同じ形に当たる参照だけを書き、別コース・複数のコースに当たるなら書き出さない）・変異 35 件の検出力。本番 UI は browser/check_be6_names.mjs。所要は本ホスト実測 6.1s（単独・2026-09-25）。
  'wf_be6_intake.mjs',
].map((name) => ({ name, args: [] }));

// official_result は決定論2回照合→result.json 再検証→Node pin 照合の複合ゲート (AP20)。
// 既定の書込先が cwd/official_result.json ゆえ --out を tmp へ向け副作用を repo 外へ隔離する。
const OFFICIAL_OUT = join(tmpdir(), 'wf_run_all_official_result.json');
GATES.push({ name: 'wf_official_result.mjs', args: ['--out', OFFICIAL_OUT] });

// 意図的に非実行 (沈黙截断の禁止・CI-14 — 何を回さないかを明示する)。
const EXCLUDED = {
  'probe (常に exit0・計測のみ＝アサート無し)': ['wf_ab5_measure.mjs'],
  // wf_roomfixture.mjs = 「閉じた部屋」治具の寸法と枠の導出 (BD4・卓上 2 本と browser/check_az2_fitguard.mjs が共有)。
  'library (単体実行不可・ゲートが import)': ['wf_i18n_hash.mjs', 'wf_frozen.mjs', 'wf_touge_driver.mjs', 'wf_drift_opt.mjs', 'wf_course_corpus.mjs', 'wf_roomfixture.mjs'],
  '変異ツール (product/manifest を書換＝non-変異証明のため除外)': ['wf_i18n_rehash.mjs', 'wf_refreeze.mjs'],
  // wf_release_notes.mjs = changelog.js から Release 本文を出力する (内容の品質は wf_i18n_check の ⑤ が見る)。
  '生成ツール (Release 本文を出力する＝ゲートではない・引数の誤りでだけ非 0)': ['wf_release_notes.mjs'],
  'ランナー自身': ['wf_run_all.mjs'],
};

// ── 一覧の突合 (BE5・BD-12(a)) ─────────────────────────────────────────────────
//   EXCLUDED を表示するだけでは「足し忘れ」が何も赤くならない (沈黙截断の禁止が表示上の誠実さに留まる)。
//   ROOT 直下の wf_*.mjs の実ファイルと GATES＋EXCLUDED を突合し、①どちらにも無いファイル
//   ②実在しないエントリ ③二重に載ったエントリ のどれかがあれば、ゲートを回す前に非 0 で止める
//   (--list・--only でも同じ＝一覧の数を読む経路も同じ根拠に立つ)。
const onDisk = readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isFile() && /^wf_.*\.mjs$/.test(e.name)).map((e) => e.name).sort();
const listed = [...GATES.map((g) => g.name), ...Object.values(EXCLUDED).flat()];
const inventory = {
  'どちらにも無いファイル (GATES か EXCLUDED に理由つきで足す)': onDisk.filter((f) => !listed.includes(f)),
  '実在しないエントリ (名前の誤り・削除漏れ)': [...new Set(listed.filter((f) => !onDisk.includes(f)))],
  '二重に載ったエントリ': [...new Set(listed.filter((f, i) => listed.indexOf(f) !== i))],
};
const inventoryBad = Object.values(inventory).some((v) => v.length > 0);

const listOnly = process.argv.includes('--list');
// --only <substr>: 名前に部分一致するゲートだけ実行 (運用: 失敗ゲートの再実行・pytest -k 相当)。
// 実行/集約/exit の経路は全実行と同一＝テスト専用バイパスではない (CI-8)。集合が空なら FAIL。
const onlyIdx = process.argv.indexOf('--only');
const onlySub = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
const activeGates = onlySub ? GATES.filter((g) => g.name.includes(onlySub)) : GATES;
const line = '═'.repeat(72);
console.log(line);
console.log('wf_run_all — 常設ゲート標準ランナー (AP21)');
console.log(line);
console.log(`ROOT      : ${ROOT}`);
console.log(`cwd(起動) : ${process.cwd()}`);
console.log(`ゲート数  : 全 ${GATES.length} (アサーションゲート ${GATES.length - 1} ＋ official_result[--out 隔離])${onlySub ? ` / --only "${onlySub}" → ${activeGates.length} 本に絞込` : ''}`);
console.log(`WF_SKIP_TIMING = ${process.env.WF_SKIP_TIMING === '1'
  ? '1 (wf_bc7_budget C/D をスキップ)' : '(未設定=すべて実行)'}`);
console.log('除外(明示・非実行):');
for (const [why, files] of Object.entries(EXCLUDED)) console.log(`  - ${why}: ${files.join(', ')}`);
console.log(`一覧の突合: wf_*.mjs 実ファイル ${onDisk.length} ／ GATES ${GATES.length} ＋ EXCLUDED ${listed.length - GATES.length} = ${listed.length}`
  + (inventoryBad ? '' : ' → 一致'));
if (inventoryBad) {
  for (const [why, files] of Object.entries(inventory)) if (files.length) console.log(`  ✗ ${why}: ${files.join(', ')}`);
  console.log(line);
  console.log('結果: FAIL (一覧の不整合・ゲートは実行していない)');
  process.exit(1);
}

if (listOnly) { console.log(line); console.log('--list: 実行はしない。'); process.exit(0); }
if (onlySub && activeGates.length === 0) { console.log(line); console.log(`✗ --only "${onlySub}" に一致するゲートが無い。`); process.exit(1); }

// ── guard sha (実行前) ────────────────────────────────────────────────────────
const shaBefore = {};
for (const f of GUARD_FILES) shaBefore[f] = sha256(f);
console.log(line);
console.log('guard sha (実行前):');
for (const f of GUARD_FILES) console.log(`  ${f} = ${shaBefore[f]}`);
console.log(line);

// ── 逐次実行 ──────────────────────────────────────────────────────────────────
const results = [];
const t0all = process.hrtime.bigint();
let idx = 0;
for (const g of activeGates) {
  idx++;
  const tag = `[${String(idx).padStart(2)}/${activeGates.length}] ${g.name}${g.args.length ? ' ' + g.args.join(' ') : ''}`;
  process.stdout.write(`${tag} ... `);
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [join(ROOT, g.name), ...g.args], {
    cwd: ROOT,            // 相対読取ゲートのため cwd を ROOT へ固定
    env: process.env,     // WF_SKIP_TIMING 等を透過
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  const code = r.status;
  const ok = code === 0 && r.error == null;
  results.push({ name: g.name, code, ok, secs, out: (r.stdout || '') + (r.stderr || ''), spawnErr: r.error });
  console.log(`${ok ? '✓' : '✗'} ${ok ? '' : `exit=${code == null ? 'null(' + (r.error && r.error.code) + ')' : code} `}${secs.toFixed(1)}s`);
  if (!ok) {
    const tail = ((r.stdout || '') + (r.stderr || '')).trimEnd().split('\n').slice(-15);
    for (const l of tail) console.log(`      │ ${l}`);
  }
}
const wallAll = Number(process.hrtime.bigint() - t0all) / 1e9;

// ── guard sha (実行後) ────────────────────────────────────────────────────────
const shaChanged = [];
for (const f of GUARD_FILES) { const now = sha256(f); if (now !== shaBefore[f]) shaChanged.push(`${f} (${shaBefore[f]} → ${now})`); }

// ── 結果集約 ──────────────────────────────────────────────────────────────────
console.log(line);
const failed = results.filter((r) => !r.ok);
const passN = results.length - failed.length;
console.log(`集計: PASS ${passN} / FAIL ${failed.length} / 全 ${results.length} ゲート / 総壁時計 ${wallAll.toFixed(1)}s`);
if (shaChanged.length === 0) {
  console.log(`guard 不変: messages.js / config.js は実行前後で sha256 一致 (ランナーは product を変異させない)`);
} else {
  console.log(`✗ guard 変化: ランナー実行で product ソースが変わった (異常):`);
  for (const s of shaChanged) console.log(`    - ${s}`);
}
if (failed.length) {
  console.log(`✗ 失敗ゲート (${failed.length}): ${failed.map((r) => r.name).join(', ')}`);
}
console.log(line);
const overallOk = failed.length === 0 && shaChanged.length === 0;
// --only のときは「全常設ゲート」と名乗らない (回したのは一部だけ・BE5 の層 4 指摘)。
const scope = onlySub ? `--only "${onlySub}" の ${activeGates.length}/${GATES.length} 本だけ緑＝全ゲートではない` : '全常設ゲート緑';
console.log(`結果: ${overallOk ? `PASS (${scope}・guard 不変)` : 'FAIL'}`);
process.exit(overallOk ? 0 : 1);
