// 常設ゲート: lap.js fmtTime の出力不変条件を本物のオラクルで検査する (GitHub #26 §C7・Stage AJ)。
//   核心の不変条件 = 「秒桁は常に 0..59、丸めは分へ桁上げされ ":60" は表現されない」。
//   旧実装は s%60 を後から toFixed(2) で丸めたため、各分境界の最後 ~4ms (例 59.996) で
//   "00:60.00" の桁上がり崩れがあった。整数センチ秒へ一度だけ丸めてから分解する新実装では
//   構造的に発生しえない。本ゲートはその「実装の証明」が将来退行しないかを見張る番人。
//   サンプリング自体が証明なのではなく、証明は実装側 (整数化) にあり、本ゲートは密サンプルで
//   退行を検出する (検証ドクトリン: 二値でなく連続量・札を立てる)。
//   再実装せず実アプリと同一の ES モジュールを import する (実装と検証が永久に一致)。
import { fmtTime } from './public/js/lap.js';

let fail = 0;
const bad = [];
function check(cond, msg) { if (!cond) { fail++; if (bad.length < 40) bad.push(msg); } }

const FMT = /^\d{2,}:[0-5]\d\.\d{2}$/;   // 分は2桁以上・秒は 0..59・センチ秒2桁

// (1) 密サンプル: 0..100 分を 0.01s (1 センチ秒) 刻みで全掃き。形式と round-trip を構造検査。
//     round-trip = 出力を mm:ss.cc に分解し直し Math.round(s*100) と一致するか (情報を落とさない)。
for (let cs = 0; cs <= 600000; cs++) {
  const s = cs / 100;
  const out = fmtTime(s);
  if (!FMT.test(out)) { check(false, `format s=${s} -> "${out}"`); continue; }
  const ci = out.indexOf(':');
  const mm = parseInt(out.slice(0, ci), 10);
  const ss = parseInt(out.slice(ci + 1, ci + 3), 10);
  const cc = parseInt(out.slice(ci + 4, ci + 6), 10);
  check(mm * 6000 + ss * 100 + cc === cs, `roundtrip s=${s} -> "${out}" (${mm}:${ss}.${cc} != ${cs}cs)`);
}

// (2) 桁上がり境界: 各分の直前 ~4ms (旧バグ窓) を「センチ秒に丸まらない実数」で攻める。
//     toFixed(2) なら "60.00" に化けていた値が、正しく次の分へ繰り上がることを表明。
for (let min = 0; min <= 5; min++) {
  const base = min * 60;
  for (const eps of [0.001, 0.004, 0.005, 0.006, 0.009, 0.0099]) {
    const s = base + 60 - eps;            // 例 59.996 / 119.996 / 179.999 ...
    const out = fmtTime(s);
    check(FMT.test(out), `boundary format s=${s} -> "${out}"`);
    // 59.996 は四捨五入で 60.00s = 次の分の 00.00。秒桁が 60 でないことを直接確認。
    check(!out.includes(':60.'), `carry s=${s} -> "${out}" (秒桁が 60)`);
  }
}
// 旧実装が崩していた代表値を名指しで固定 (回帰の見張り)。
const fixtures = [
  [59.996, '01:00.00'], [59.999, '01:00.00'], [119.996, '02:00.00'],
  [179.999, '03:00.00'], [0, '00:00.00'], [60.5, '01:00.50'],
  [5999.99, '99:59.99'], [0.01, '00:00.01'],
];
for (const [s, want] of fixtures) {
  const got = fmtTime(s);
  check(got === want, `fixture fmtTime(${s}) = "${got}" want "${want}"`);
}

// (3) セントネル: 非有限・負値は一括で "--:--.--" (旧実装は NaN/Infinity/負値が素通りしていた)。
for (const v of [null, undefined, NaN, Infinity, -Infinity, -0.01, -1, -1000]) {
  const out = fmtTime(v);
  check(out === '--:--.--', `sentinel fmtTime(${String(v)}) = "${out}" want "--:--.--"`);
}

if (fail === 0) {
  console.log('wf_fmttime_check: PASS (dense 0..100min @1cs + carry boundaries + sentinels; ":60" 表現不能・round-trip 一致)');
  process.exit(0);
} else {
  console.error(`wf_fmttime_check: FAIL ${fail} 件`);
  for (const m of bad) console.error('  - ' + m);
  process.exit(1);
}
