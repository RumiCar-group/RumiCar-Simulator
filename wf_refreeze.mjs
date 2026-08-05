// wf_refreeze.mjs — 凍結回帰ハッシュ (f0〜f3) の刻み直しツール (Stage AP3・CI-11)。
//
// 物理を「意図的に」変えた版で、中央マニフェスト wf_frozen_manifest.json の凍結値を更新する。
// 手順: 実行 → 差分表示 → **人間承認 (--write を人間が付けて再実行)** → 書込＋history 追記。
//
//   node wf_refreeze.mjs                       … 差分のみ (dry-run・書込なし・決定論)。
//   node wf_refreeze.mjs --write --reason "…"  … 差分があれば承認とみなし書込 (--reason 必須)。
//
// 凍結値の計算は wf_ab8_bench.mjs と**同一の本番 runRace 呼出**を再現する (両者が同じ真実源=
// 本番物理を叩く)。書込後は 5 参照ゲートが新値で緑化する (意図せぬ変化検出は維持)。
//
// 冪等性 (受け入れ ④): 再計算値が現マニフェストと一致し appVersion も同じなら no-op。
// よって dry-run を2回、あるいは --write を2回連続で実行しても byte 一致する。
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';
import { APP_VERSION } from './public/js/config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, 'wf_frozen_manifest.json');

// ── 本番 runRace で f0〜f3 を再計算 (wf_ab8_bench.mjs と同一) ───────────────────
const prog = (key) => { const p = PROGRAMS.find((x) => x.key === key); return { src: p.code, lang: p.lang || 'c', carType: p.carType }; };
const fieldOf = (...keys) => keys.map((k, i) => { const p = prog(k); return { name: 'C' + i, lang: p.lang, src: p.src, carType: p.carType, rear: false, encoder: false }; });

function recompute() {
  const oval = buildFromSpec({ name: 'オーバル', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
  const r0 = runRace({ report: true, course: oval, laps: 3, field: fieldOf('normal_fr', 'normal_awd', 'normal_ff'), crashRule: { rejoin: false, penaltySec: 3 } });
  const r1 = runRace({ report: true, course: oval, laps: 2, field: fieldOf('normal_ff', 'normal_fr'), crashRule: { rejoin: true, penaltySec: 3 } });
  const circuit = buildFromSpec({ name: '競技サーキット (フルスケール)', kind: 'track', shape: 'superellipse', rx: 360, ry: 230, k: 0.55, width: 28, samples: 160 });
  const ccSrc = prog('comp_circuit').src;
  const csSrc = prog('comp_slip').src;
  const r2 = runRace({ report: true, physics: 'v2', regime: 'fullscale', course: circuit, laps: 1, interact: false,
    field: ['normal_ff', 'normal_fr', 'normal_awd'].map((ct, i) => ({ name: 'C' + i, lang: 'c', src: ccSrc, carType: ct, rear: false, encoder: false })),
    crashRule: { rejoin: true, penaltySec: 3 }, maxSec: 200 });
  const r3 = runRace({ report: true, physics: 'v2', regime: 'fullscale', course: circuit, laps: 1, interact: false,
    field: [{ name: 'C0', lang: 'c', src: csSrc, carType: 'drift_fr', rear: false, encoder: false, tire: 'slip' }],
    crashRule: { rejoin: true, penaltySec: 3 }, maxSec: 120 });
  const allFinite = [r0, r1, r2, r3].every((r) => r.report.every((x) => Number.isFinite(x.finalX) && Number.isFinite(x.finalY)));
  return { hashes: { f0: r0.verifyHash, f1: r1.verifyHash, f2: r2.verifyHash, f3: r3.verifyHash }, allFinite };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const doWrite = argv.includes('--write');
const reasonIdx = argv.indexOf('--reason');
const reason = reasonIdx >= 0 ? argv[reasonIdx + 1] : null;
const dateIdx = argv.indexOf('--date');
const stampDate = dateIdx >= 0 ? argv[dateIdx + 1] : new Date().toISOString().slice(0, 10);

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const cur = manifest.current;
const { hashes, allFinite } = recompute();

const KEYS = ['f0', 'f1', 'f2', 'f3'];
const changed = KEYS.filter((k) => hashes[k] !== cur.hashes[k]);
const verChanged = APP_VERSION !== cur.appVersion;

console.log('凍結回帰ハッシュ 刻み直し (wf_refreeze) — 中央マニフェスト:', MANIFEST_PATH);
console.log(`  マニフェスト current: appVersion=${cur.appVersion} stampedAt=${cur.stampedAt}`);
console.log(`  再計算 (本番 runRace): APP_VERSION=${APP_VERSION}`);
for (const k of KEYS) {
  const mark = hashes[k] === cur.hashes[k] ? '=' : '≠';
  console.log(`    ${k}: 再計算 ${hashes[k]}  ${mark}  マニフェスト ${cur.hashes[k]}`);
}
if (!allFinite) {
  console.error('  ✗ 非有限な最終座標 (発散/NaN) を検出。刻み直しを中止する。');
  process.exit(1);
}

if (changed.length === 0) {
  if (verChanged) {
    console.log(`  ハッシュ変化なし。appVersion のみ ${cur.appVersion}→${APP_VERSION} の差 (物理不変)。`);
    console.log('  物理無変更のためハッシュ刻み直しは不要 (版スタンプの更新が要る場合のみ --write)。');
  } else {
    console.log('  ✓ マニフェストは最新 (物理無変更)。刻み直し不要。');
  }
}

if (!doWrite) {
  if (changed.length > 0) {
    console.log(`\n  刻み直しが必要: ${changed.join(', ')} が変化。`);
    console.log('  → 意図した物理変更なら、人間が承認して次を実行:');
    console.log(`     node wf_refreeze.mjs --write --reason "<なぜ変えたか / どのブロック>"`);
  }
  process.exit(0);
}

// --write 経路 (人間承認・CI-11)
if (changed.length === 0 && !verChanged) {
  console.log('  (--write 指定だが変更なし) 書込スキップ=冪等 no-op。');
  process.exit(0);
}
if (!reason) {
  console.error('  ✗ --write には --reason "<理由>" が必須 (監査証跡・CI-3)。');
  process.exit(2);
}

const prevHashes = { ...cur.hashes };
cur.appVersion = APP_VERSION;
cur.stampedAt = stampDate;
cur.hashes = { ...hashes };
manifest.history.unshift({ appVersion: APP_VERSION, stampedAt: stampDate, hashes: { ...hashes }, reason });
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
console.log('\n  ✓ 書込完了 (人間承認 --write)。');
console.log(`    ${KEYS.filter((k) => prevHashes[k] !== hashes[k]).map((k) => `${k}: ${prevHashes[k]}→${hashes[k]}`).join(' / ') || '(ハッシュ不変・版スタンプのみ更新)'}`);
console.log(`    history 先頭に追記 (appVersion=${APP_VERSION} stampedAt=${stampDate} reason="${reason}")。`);
console.log('    → 5 参照ゲートを再実行して新値で緑化することを確認してください。');
process.exit(0);
