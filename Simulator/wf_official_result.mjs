// wf_official_result.mjs — 公式レース正準実行ツール (Stage AP20・critic X1)。
//
// 目的: result.json を生成する in-repo 手段 (旧 wf_w1_race.mjs=W7 後始末で消失) を正準ツールとして復活し、
//   さらに (a) 決定論の二重確認 (同一入力2回→verifyHash/順位 一致)・(b) 出力 result.json のローカル再検証
//   経路 (runRace 直呼び=ブラウザ verifyOfficialLocally 同契約)・(c) 生成環境 Node/V8 版の pin 照合 を統合する。
//   本番フローのみ (race_engine.runRace はノイズ/sample-and-hold 強制 OFF・固定60Hz・car index 昇順=決定論)。
//
// 使い方:
//   node wf_official_result.mjs [--event <bundle.json>] [--out <result.json>] [--now <iso>]
//         … 既定 bundle=docs/phase_w/official_sample_event.json。生成→自己再検証(①②)→pin照合(③)。
//   node wf_official_result.mjs --verify <result.json> [--event <bundle.json>]
//         … 既存 result.json を「ローカル再検証経路 (runRace 直呼び)」で再計算し verifyHash 照合 (②)。
//   node wf_official_result.mjs --pin --reason "<理由>" [--event <bundle.json>]
//         … 現ホストの node/v8/resultSha256 を wf_frozen_manifest.json の canonicalNode へ書込 (人間承認・CI-11)。
//
// exit code: 0=全合格 / 1=決定論不一致(①②) / 2=引数/入力不備 / 3=Node pin 不一致(③)。
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, isAbsolute } from 'path';
import { createHash } from 'crypto';
import { buildFromSpec } from './public/js/course.js';
import { runRace, engineFingerprint } from './public/js/race_engine.js';
import { frozenField } from './public/js/race_event.js';
import { PROGRAM_BY_KEY } from './public/js/programs.js';
import { APP_VERSION } from './public/js/config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, 'wf_frozen_manifest.json');
const DEFAULT_EVENT = join(HERE, 'docs/phase_w/official_sample_event.json');

// ── CLI 解析 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, def = null) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const abspath = (p) => (isAbsolute(p) ? p : resolve(process.cwd(), p));

const doPin = flag('--pin');
const verifyPath = opt('--verify');
const eventPath = abspath(opt('--event', DEFAULT_EVENT));
const outPath = abspath(opt('--out', join(process.cwd(), 'official_result.json')));
const nowIso = opt('--now', new Date().toISOString());

// ── イベント束を runRace 入力へ展開 (frozenField=本番フロー・実データ) ─────────
// entries は progKey (実 PROGRAMS 参照) or program:{src,lang} のいずれか。progKey は
// PROGRAM_BY_KEY で src へ焼込む (fillerEntry と同型=実データ)。course は courseSpec を
// buildFromSpec で再構築 (courses.json 同一値インライン=決定論・自己完結・DOM 非依存)。
function loadBundle(path) {
  let bundle;
  try { bundle = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { console.error(`✗ イベント束を読めない: ${path}\n  ${e.message}`); process.exit(2); }
  const { event, entries, courseSpec } = bundle;
  if (!event || !Array.isArray(entries) || !courseSpec) {
    console.error(`✗ イベント束の必須欄が欠落 (event / entries[] / courseSpec): ${path}`); process.exit(2);
  }
  const expanded = entries.map((e) => {
    if (e.progKey && !e.program && !e.src) {
      const p = PROGRAM_BY_KEY[e.progKey];
      if (!p) { console.error(`✗ 未知の progKey: ${e.progKey}`); process.exit(2); }
      return { ...e, src: p.code, lang: p.lang || 'c' };
    }
    return e;
  });
  return { event, entries: expanded, courseSpec };
}

// runRace を1回実行 (公式=正準)。grid を渡せば AD1 で凍結グリッドを算法非依存に忠実再現。
function runOfficial(bundle, grid = null) {
  const { event, entries, courseSpec } = bundle;
  const course = buildFromSpec(courseSpec);
  const laps = Math.max(1, Math.round(event.laps || 3));
  const regime = event.regime || null;
  const crashRule = event.crashRule || { rejoin: false, penaltySec: 3 };
  const interact = event.interact !== false;
  const maxSec = event.maxSec != null ? event.maxSec : undefined;
  const field = frozenField(event, entries);   // 決定論: submittedAt 昇順→validateEntry→filler 補充
  const res = runRace({
    course, regime, laps, field, crashRule, interact, maxSec,
    grid: (grid && Array.isArray(grid)) ? grid : undefined,
    physics: event.physicsMode || 'dynamic',   // 記録のエンジンで再走 (旧記録=dynamic フォールバック)
    recon: event.recon > 0 ? { laps: event.recon } : null,
    wear: !!event.wear,
    report: true,
  });
  return { res, course, field, event };
}

// runRace 出力 → W_spec §6 result.json schema へ整形。author は field から name 一致で引く。
function buildResult(bundle, runOut) {
  const { event } = bundle;
  const { res, field } = runOut;
  const authorOf = (name) => { const f = field.find((x) => x.name === name); return (f && f.author) || null; };
  return {
    eventId: event.id,
    engineVer: APP_VERSION,
    class: event.class || 'open',
    course: event.course,
    regime: event.regime || null,
    laps: Math.max(1, Math.round(event.laps || 3)),
    finishers: res.finishers.map((f) => ({
      rank: f.rank, name: f.name, author: authorOf(f.name), carType: f.carType,
      totalTimeMs: Math.round(f.totalTimeMs),
      bestLapMs: f.bestLapMs != null ? Math.round(f.bestLapMs) : null,
      penaltiesSec: f.penaltiesSec,
    })),
    dnf: res.dnf.map((d) => ({
      name: d.name, author: authorOf(d.name), carType: d.carType,
      lapsCompleted: d.lapsCompleted, reason: d.reason,
    })),
    grid: res.grid,   // AD1: 凍結グリッド (算法非依存の忠実再現に使う)
    verifyHash: res.verifyHash,
    engineFingerprint: engineFingerprint(),
    computedAt: nowIso,
  };
}

// 決定論の結果指紋 (computedAt を除いた再現可能部分の SHA-256)。canonicalNode.resultSha256 の pin 値。
function resultSha256(result) {
  const canon = JSON.stringify({
    eventId: result.eventId, engineVer: result.engineVer, class: result.class,
    course: result.course, regime: result.regime, laps: result.laps,
    finishers: result.finishers, dnf: result.dnf, grid: result.grid,
    verifyHash: result.verifyHash,
  });
  return createHash('sha256').update(canon).digest('hex');
}

// 順位の正準表現 (①の「全順位一致」照合用)。
const rankSig = (result) => result.finishers.map((f) => `${f.rank}:${f.name}:${f.totalTimeMs}`).join('|') +
  '#' + result.dnf.map((d) => `${d.name}:${d.lapsCompleted}:${d.reason}`).join('|');

// ── Node pin 照合 (③) ──────────────────────────────────────────────────────
// manifest.canonicalNode に対し現ホストの node/v8 を exit code でアサート。未 pin(null) は情報表示のみ。
function pinCheck(manifest, result) {
  const cn = manifest.canonicalNode || {};
  const node = process.versions.node;
  const v8 = process.versions.v8;
  console.log(`  ③ Node pin 照合: 現ホスト node=${node} v8=${v8}`);
  if (cn.node == null) {
    console.log('     manifest.canonicalNode.node=null (未 pin)。--pin --reason "…" で確立できる (人間承認・CI-11)。');
    return 0;
  }
  const nodeOk = node === cn.node;
  const v8Ok = v8 === cn.v8;
  console.log(`     manifest pin: node=${cn.node} v8=${cn.v8}  → node ${nodeOk ? '✓' : '✗'} / v8 ${v8Ok ? '✓' : '✗'}`);
  if (cn.resultSha256 && result) {
    const sha = resultSha256(result);
    const shaOk = sha === cn.resultSha256;
    console.log(`     resultSha256: 実測 ${sha.slice(0, 16)}…  ${shaOk ? '✓ 一致' : '✗ 不一致 (pin ' + cn.resultSha256.slice(0, 16) + '…)'}`);
    if (!shaOk) return 3;
  }
  if (!nodeOk || !v8Ok) { console.error('     ✗ Node/V8 版が canonicalNode pin と不一致=非正準環境。'); return 3; }
  console.log('     ✓ 現ホストは canonicalNode pin と一致 (正準生成環境)。');
  return 0;
}

// ── --pin: canonicalNode 書込 (人間承認・冪等) ────────────────────────────────
function doPinWrite() {
  const reason = opt('--reason');
  if (!reason) { console.error('✗ --pin には --reason "<理由>" が必須 (監査証跡・CI-3)。'); process.exit(2); }
  const bundle = loadBundle(eventPath);
  const runOut = runOfficial(bundle);
  const result = buildResult(bundle, runOut);
  const sha = resultSha256(result);
  const node = process.versions.node, v8 = process.versions.v8;

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const prev = manifest.canonicalNode || {};
  const same = prev.node === node && prev.v8 === v8 && prev.resultSha256 === sha;
  console.log('canonicalNode pin (wf_official_result --pin) — マニフェスト:', MANIFEST_PATH);
  console.log(`  現ホスト: node=${node} v8=${v8}`);
  console.log(`  result.verifyHash=${result.verifyHash} resultSha256=${sha.slice(0, 16)}…`);
  console.log(`  既存 pin: node=${prev.node} v8=${prev.v8} resultSha256=${prev.resultSha256 ? String(prev.resultSha256).slice(0, 16) + '…' : null}`);
  if (same) { console.log('  ✓ 既に同値=冪等 no-op (書込スキップ)。'); process.exit(0); }
  manifest.canonicalNode = {
    node, v8, resultSha256: sha,
    pinnedAt: nowIso.slice(0, 10),
    eventId: result.eventId,
    appVersion: APP_VERSION,
    note: `AP20 公式レース正準実行ツール (wf_official_result.mjs) が pin。result.json 生成環境の Node/V8 版と正準サンプル (${result.eventId}) の resultSha256。第三者は同 pin で再実行→verifyHash=${result.verifyHash} 照合で検証済。理由: ${reason}`,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log('  ✓ canonicalNode 書込完了 (人間承認・--pin)。git 可逆・working tree。');
  process.exit(0);
}

// ── --verify: 既存 result.json をローカル再検証経路 (runRace 直呼び) で照合 (②) ──
function doVerify() {
  let stored;
  try { stored = JSON.parse(readFileSync(abspath(verifyPath), 'utf8')); }
  catch (e) { console.error(`✗ result.json を読めない: ${verifyPath}\n  ${e.message}`); process.exit(2); }
  const bundle = loadBundle(eventPath);
  // 記録に凍結グリッドがあれば渡す (AD1・verifyOfficialLocally 同契約=算法非依存の忠実再現)。
  const runOut = runOfficial(bundle, stored.grid);
  const recomputed = buildResult(bundle, runOut);
  const hashOk = recomputed.verifyHash === stored.verifyHash;
  const rankOk = rankSig(recomputed) === rankSig(stored);
  console.log(`  ② ローカル再検証 (runRace 直呼び): result ${verifyPath}`);
  console.log(`     verifyHash: 保存 ${stored.verifyHash} / 再計算 ${recomputed.verifyHash} → ${hashOk ? '✓ 一致' : '✗ 不一致'}`);
  console.log(`     順位:       ${rankOk ? '✓ 一致' : '✗ 不一致'}`);
  if (stored.engineVer && stored.engineVer !== APP_VERSION) {
    console.log(`     ⚠ 記録 engineVer=${stored.engineVer} ≠ 現行 APP_VERSION=${APP_VERSION} (版差=環境差で不一致し得る=正準は固定環境)。`);
  }
  process.exit(hashOk && rankOk ? 0 : 1);
}

// ── 既定 (生成): 生成 → 自己再検証(①②) → pin照合(③) ─────────────────────────
function doGenerate() {
  const bundle = loadBundle(eventPath);
  console.log('公式レース正準実行 (wf_official_result) — イベント:', eventPath);
  console.log(`  APP_VERSION=${APP_VERSION} / exec=${engineFingerprint().exec}`);

  // 1回目 (公式 result)。
  const run1 = runOfficial(bundle);
  const result = buildResult(bundle, run1);
  writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
  console.log(`  生成: ${outPath}`);
  console.log(`     eventId=${result.eventId} verifyHash=${result.verifyHash} finishers=${result.finishers.length} dnf=${result.dnf.length}`);
  console.log(`     順位: ${result.finishers.map((f) => `${f.rank}.${f.name}(${f.totalTimeMs}ms)`).join(' / ') || '(完走なし)'}`);

  // ① 同一入力2回→verifyHash/全順位 完全一致 (決定論)。凍結グリッドを渡して忠実再現。
  const run2 = runOfficial(bundle, result.grid);
  const result2 = buildResult(bundle, run2);
  const detHash = result2.verifyHash === result.verifyHash;
  const detRank = rankSig(result2) === rankSig(result);
  console.log(`  ① 決定論 (2回実行): verifyHash ${detHash ? '✓ 一致' : '✗ 不一致 (' + result.verifyHash + ' vs ' + result2.verifyHash + ')'} / 順位 ${detRank ? '✓ 一致' : '✗ 不一致'}`);

  // ② 出力 result.json をローカル再検証経路 (runRace 直呼び) で照合。
  const stored = JSON.parse(readFileSync(outPath, 'utf8'));
  const run3 = runOfficial(bundle, stored.grid);
  const result3 = buildResult(bundle, run3);
  const reHash = result3.verifyHash === stored.verifyHash;
  const reRank = rankSig(result3) === rankSig(stored);
  console.log(`  ② result.json 再検証: verifyHash ${reHash ? '✓ 一致' : '✗ 不一致'} / 順位 ${reRank ? '✓ 一致' : '✗ 不一致'}`);

  // ③ Node pin 照合。
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const pinRc = pinCheck(manifest, stored);

  const ok12 = detHash && detRank && reHash && reRank;
  if (!ok12) { console.error('FAIL: 決定論/再検証 不一致 (①②)。'); process.exit(1); }
  if (pinRc !== 0) { console.error('FAIL: Node pin 照合 不一致 (③)。'); process.exit(pinRc); }
  console.log('OK: ①決定論 ②再検証 ③pin照合 全合格。');
  process.exit(0);
}

// ── ディスパッチ ──────────────────────────────────────────────────────────
if (doPin) doPinWrite();
else if (verifyPath) doVerify();
else doGenerate();
