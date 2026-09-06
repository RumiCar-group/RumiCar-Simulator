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
//  ・timing 隔離: WF_SKIP_TIMING=1 を子へ透過 (env 継承)。wf_ao5_calib は J (唯一の壁時計アサート) のみ skip。
//  ・沈黙截断の禁止 (CI-14): 意図的に非実行にした probe / library / 変異ツールを EXCLUDED として明示表示する。
//
// 使い方:
//   node wf_run_all.mjs                # 全ゲート実行 (J 含む)
//   WF_SKIP_TIMING=1 node wf_run_all.mjs   # 壁時計 J を隔離した安定実行
//   node wf_run_all.mjs --list         # 実行対象/除外の一覧だけ表示 (実行しない)
// exit: 0=全緑かつ guard 不変 / 1=いずれかのゲート失敗 or guard 変化。
// ════════════════════════════════════════════════════════════════════════════
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
].map((name) => ({ name, args: [] }));

// official_result は決定論2回照合→result.json 再検証→Node pin 照合の複合ゲート (AP20)。
// 既定の書込先が cwd/official_result.json ゆえ --out を tmp へ向け副作用を repo 外へ隔離する。
const OFFICIAL_OUT = join(tmpdir(), 'wf_run_all_official_result.json');
GATES.push({ name: 'wf_official_result.mjs', args: ['--out', OFFICIAL_OUT] });

// 意図的に非実行 (沈黙截断の禁止・CI-14 — 何を回さないかを明示する)。
const EXCLUDED = {
  'probe (常に exit0・計測のみ＝アサート無し)': ['wf_ab5_measure.mjs'],
  'library (単体実行不可・ゲートが import)': ['wf_i18n_hash.mjs', 'wf_frozen.mjs', 'wf_touge_driver.mjs'],
  '変異ツール (product/manifest を書換＝non-変異証明のため除外)': ['wf_i18n_rehash.mjs', 'wf_refreeze.mjs'],
};

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
console.log(`WF_SKIP_TIMING = ${process.env.WF_SKIP_TIMING === '1' ? '1 (wf_ao5_calib J をスキップ)' : '(未設定=J を実行)'}`);
console.log('除外(明示・非実行):');
for (const [why, files] of Object.entries(EXCLUDED)) console.log(`  - ${why}: ${files.join(', ')}`);

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
console.log(`結果: ${overallOk ? 'PASS (全常設ゲート緑・guard 不変)' : 'FAIL'}`);
process.exit(overallOk ? 0 : 1);
