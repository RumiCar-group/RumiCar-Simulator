// wf_ghostgap_cap.mjs — 観戦リプレイ距離集計のテレポート抑制上限 cap の実測ゲート (v5.2.0・CI-14)。
//
// 対象: ghost_gap.js ghostCumDist の cap = max(0.5, 0.25×min(boundsW,boundsH))。
// これは proxy_thresholds_audit.md 表A で「同じ 0.25×外形最小辺 パターンの二例目 (🟡 代理量・要確認)」
// と棚卸しされた値。害のある破綻モード = **本物の1フレーム移動が cap 以上になり、正当な走行距離が
// 距離集計から捨てられて進行度 rp (順位・車間) が狂う** こと。これを知覚でなく実レースの連続量で測る:
//   実レース (runRace ghost:true・本番フロー) のゴーストフレーム間変位を全車・全フレームで観測し、
//   ① cap 以上の変位が 0 件 (正当な移動は一切抑制されない)
//   ② マージン: cap ≥ 2 × 最大観測変位 (2倍の安全余裕・連続量で出す)
//   ③ 実オラクル照合: ghostCumDist の総距離 = 無抑制の総和 (抑制発火 0 の機械確認・CI-9)
// を、卓上×2 (通常/最狭=クラッシュ復帰の動きを含む) とフルスケール v2 (正準サンプルイベント=
// 大変位側の代表) の 3 構成で検査する。exit: 0=全緑 / 1=違反。
import { readFileSync } from 'node:fs';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { ghostCumDist } from './public/js/ghost_gap.js';
import { PROGRAM_BY_CARTYPE, PROGRAM_BY_KEY } from './public/js/programs.js';

const specs = JSON.parse(readFileSync('public/data/courses.json', 'utf8'));
const specByName = Object.fromEntries(specs.map((s) => [s.name, s]));
const bundle = JSON.parse(readFileSync('docs/phase_w/official_sample_event.json', 'utf8'));

// 卓上フィールド: 組込3車種×その最速プログラム (実データ・グリッド=配列順)。
const tabletopField = ['normal_fr', 'normal_awd', 'normal_ff'].map((ct, i) => {
  const p = PROGRAM_BY_CARTYPE[ct];
  return { name: `car${i}`, lang: p.lang, src: p.code, carType: ct };
});
// フルスケール: 正準サンプルイベントの entries (progKey → 実 PROGRAMS へ展開・wf_official_result 同型)。
const fsField = bundle.entries.map((e) => {
  const p = PROGRAM_BY_KEY[e.progKey];
  return { ...e, src: p.code, lang: p.lang || 'c' };
});

const CONFIGS = [
  { label: '卓上 オーバル (rejoin)', course: 'オーバル', regime: 'tabletop', field: tabletopField, laps: 2 },
  { label: '卓上 ナローシケイン (最狭・rejoin)', course: 'ナローシケイン・レイアウト', regime: 'tabletop', field: tabletopField, laps: 2 },
  { label: 'フルスケール 競技サーキット (v2・正準サンプル)', bundleCourse: bundle.courseSpec, regime: bundle.event.regime, physics: bundle.event.physicsMode, field: fsField, laps: bundle.event.laps },
];

let ok = true;
for (const cfg of CONFIGS) {
  const course = buildFromSpec(cfg.bundleCourse || specByName[cfg.course]);
  const res = runRace({
    course, regime: cfg.regime, physics: cfg.physics || null, laps: cfg.laps, field: cfg.field,
    crashRule: { rejoin: true, penaltySec: 3 }, interact: true, ghost: true,
  });
  const { frames } = res.ghost;
  const nc = cfg.field.length;
  const bw = course.bounds.w, bh = course.bounds.h;
  const cap = Math.max(0.5, 0.25 * Math.min(bw, bh));   // ghost_gap.js:14 と同一式 (被測定値)
  let maxStep = 0, overCap = 0, rawSum = 0;
  const crashes = new Set();
  for (let ci = 0; ci < nc; ci++) {
    for (let fi = 1; fi < frames.length; fi++) {
      const p0 = frames[fi - 1][ci], p1 = frames[fi][ci];
      if (p1 && p1.crashed) crashes.add(ci);
      if (!p0 || !p1 || p0.crashed) continue;            // ghostCumDist と同一の観測条件
      const step = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      rawSum += step;
      if (step > maxStep) maxStep = step;
      if (step >= cap) overCap++;
    }
  }
  // ③ 実オラクル照合: 本物の ghostCumDist の総距離 = 無抑制総和 (抑制発火 0 の機械確認)。
  const cum = ghostCumDist(frames, nc, bw, bh);
  const cumSum = cum.reduce((a, arr) => a + arr[arr.length - 1], 0);
  const oracleMatch = Math.abs(cumSum - rawSum) < 1e-9;
  const margin = maxStep > 0 ? cap / maxStep : Infinity;
  const pass1 = overCap === 0;
  const pass2 = margin >= 2;
  const allPass = pass1 && pass2 && oracleMatch;
  if (!allPass) ok = false;
  console.log(`${allPass ? '✓' : '✗'} ${cfg.label}`);
  console.log(`    bounds ${bw.toFixed(1)}×${bh.toFixed(1)}m cap=${cap.toFixed(2)}m | 最大観測変位 ${maxStep.toFixed(3)}m | マージン ${Number.isFinite(margin) ? margin.toFixed(1) : '∞'}× (基準≥2) | cap超 ${overCap}件 (基準0) | オラクル照合 ${oracleMatch ? '一致' : '不一致'} | クラッシュ経験車 ${crashes.size}/${nc} | frames ${frames.length}`);
}
console.log(ok ? '結果: PASS (cap は実レースの正当な移動を一切抑制せず・マージン≥2)' : '結果: FAIL');
process.exit(ok ? 0 : 1);
