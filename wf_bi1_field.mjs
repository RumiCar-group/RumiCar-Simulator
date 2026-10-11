// wf_bi1_field.mjs — Stage BI1 常設ゲート: 公式レースのフィールド構成の決定論。
// ════════════════════════════════════════════════════════════════════════════
// 何を守るゲートか（2026-10-11・BI1）:
//   公式レースの確定フィールドは `race_event.js` の frozenField が組み、生成（pinned Node の `wf_official_result.mjs`）と
//   再検証（ブラウザ `race_ui.js` の verifyOfficialLocally）が同じ関数を呼ぶ。BI1 の前は次の 3 点で「同じ入力から同じ記録」が
//   崩れえた。
//     ・グリッド順のタイブレークをロケール依存の照合で比べていた → 検証する人の既定ロケールで並びが変わる
//       （改修前の木で実測: 下の B) の列が LANG=tr_TR だけ別の並びになった）。同じ鍵のエントリーは入力順のまま残った。
//     ・entryWindow.close より後の submittedAt のエントリーが field に入っていた（W_spec §1「締切時の確定エントリー列」）。
//     ・result.json の author を車名で引いていた → 同名のエントリーが 2 件あると 2 台とも先に並んだ方の author になった
//       （改修前の木で実測: 'Twin' alice / 'Twin' bob の束で bob の行が alice になった）。
//
// 章立て:
//   A) 構造: race_event.js にロケール依存の照合の語（localeCompare・Intl）が 0 件。コード部分（コメントを除く）に
//      toLocale*・Date・Math.random が 0 件（ロケール・タイムゾーン・時計に依存しない）。
//   B) 並び: 同時刻の submittedAt を多数含む敵対的な entries（'Émile'/'emile'/'Zoe'/'z'/''・トルコ語の i 4 種・同名あり・
//      鍵が同じで本文だけ違う 2 件）を、LANG/LC_ALL=C・ja_JP.UTF-8・tr_TR.UTF-8（TZ も UTC・Asia/Tokyo・America/Los_Angeles）
//      の node 3 起動で frozenField にかけ、並びの直列化の sha256 が一致し、凍結した期待の並び（UTF-16 の符号単位の順）と一致。
//      入力の順を逆にしても同じ並び。3 起動が実際に別のロケール・タイムゾーンで動いたこと（Intl の既定値）を確かめる＝空振りしない。
//      陰性対照: 改修前の frozenField（文字列で埋め込んだ原文）を同じ 3 起動にかけ、並びが期待と異なることを測って印字する。
//   C) 締切: 締切ちょうど・1 ms 後・ミリ秒より下の桁・オフセット付き・オフセット無し・暦にない日付・読めない値を混ぜた entries で、
//      close（Z／+09:00／同時刻の別表記／1 ms 前）に対する採否が期待と一致（3 起動とも同じ）。close 未記載（欄なし・空文字・null）と
//      読めない close は全件。決定論的な疑似乱数で作った 400 組の (submittedAt, close) で、採否が Date.parse（オフセット付きの
//      ISO 8601 は仕様で値が決まる＝独立な基準）による「submittedAt ≤ close」と一致。
//   D) 生成側（本番フロー `wf_official_result.mjs` を子プロセスで実行）: 同名 2 件（author 相異）の小さな束で、result.json の各
//      finisher/dnf の author が field の同じ添字の author と一致（filler は null）。締切と同時刻のエントリーは記録に入り、締切後の
//      エントリーは入らない。読めない close・オフセット無しの close は exit 2。改修前の帰属（車名で引く）に戻した写しでは
//      bob の行が alice になる＝取り違えの再現と、この章の検出力。
//      ※ 束は正準サンプルではないので ③ Node pin 照合は不一致（exit 3）になる。この章は ①② の合格と出力だけを見る。
//   E) 回帰: 出荷の正準サンプル束（close 未記載）の frozenField の並びが従来どおり（Circuit-FF → FR → AWD）。
//      resultSha256 の pin 一致は wf_official_result.mjs（wf_run_all の最後のゲート）が見る。
//   F) 検出力: race_event.js の写しを壊した変異（ロケール依存の比較・締切の除外を外す・同時刻を除く・地方時で読む・未記載で全件
//      除外・タイブレークを外す・暦の検査を外す・改修前の原文）が B) か C) を赤にする（product のファイルは無改変）。
//   G) 【BI2・2026-10-11】event の欠落欄の既定（laps・regime・crashRule・interact・maxSec・physicsMode・recon・wear）は
//      race_event.js の resolveEventSpec だけが持ち、生成（wf_official_result.mjs runOfficial）・再検証（race_ui.js
//      verifyOfficialLocally）・👻 ゴースト対戦（ghostVsWorld）が同じ関数を呼ぶ。BI2 の前は maxSec の無い event を生成側が
//      computeRaceTimeout・ブラウザが固定 180 秒で走らせ、regime の無い event はブラウザだけ利用者の選んでいる領域で走った。
//      G1 構造（2 ファイルのコード部分に既定のリテラルが 0 件・3 経路が関数を通る・race_ui.js は名前空間 import＝BA1）／
//      G2 関数の既定値（maxSec＝computeRaceTimeout・峠は runRace と同じく 1 本・regime='tabletop'・書かれた欄はそのまま）／
//      G3 正準サンプルから maxSec と regime を落とした束を本番の wf_official_result.mjs で生成（①② 合格・③ は exit 3）→
//      --verify exit 0・result.json に実効の regime／maxSec／laps が刻まれる／G4 検出力（写しを壊す変異 11 件）。
//      ※ maxSec は resultSha256 の canon に入れない（正準サンプルの pin は wf_official_result.mjs が見る）。
//
// 見張れていないもの（限界）: ①submittedAt はエントリー側が自分で書く値（PR のマージ時刻ではない）。締切前の時刻を偽って書いた
//   エントリーは除けない。②並べ替えは submittedAt を書かれた文字列のまま比べる（旧実装と同じ鍵）ので、表記の違う時刻（Z と +09:00
//   など）が混ざると時刻順にならない（エントリー画面が書く toISOString() の形どうしなら時刻順）。③ブラウザの UI（開催状態の表示・
//   👻 の作者引き・殿堂入りの作者引き）は測らない（👻 と殿堂入りは author で entries を引く＝同じ作者が 2 件出すと先の 1 件になる）。
// 所要: 本ホスト実測 約 55 秒（単独・2026-10-11・BI2 の G3 が約 40 秒＝既定を落とした束は卓上の領域で全車が上限 1800 秒まで走る）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const JS_ROOT = path.join(ROOT, 'public/js');
const RE_PATH = path.join(JS_ROOT, 'race_event.js');
const OFFICIAL = path.join(ROOT, 'wf_official_result.mjs');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const RAW_RE = fs.readFileSync(RE_PATH, 'utf8');
const RAW_OFF = fs.readFileSync(OFFICIAL, 'utf8');
const { frozenField } = await import(pathToFileURL(RE_PATH).href);

let pass = true;
const report = (label, violations) => {
  if (violations.length) { pass = false; console.log(`  ✗ ${label}: ${violations.length} 件`); for (const v of violations.slice(0, 12)) console.log(`      - ${v}`); if (violations.length > 12) console.log(`      … ほか ${violations.length - 12} 件`); }
  else console.log(`  ✓ ${label}: 0 件`);
};
const tmps = [];
const mkTmp = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `wf_bi1_${tag}_`)); tmps.push(d); return d; };

console.log('='.repeat(78));
console.log('BI1 公式レースのフィールド構成の決定論（グリッド順・締切・同名エントリーの帰属）＋ BI2 既定値の集約');
console.log('='.repeat(78));

// ── A) 構造 ──────────────────────────────────────────────────────────────────
console.log('\n  A) race_event.js がロケール・タイムゾーン・時計に依存しない');
{
  const v = [];
  const nLocale = (RAW_RE.match(/localeCompare|Intl/g) || []).length;
  if (nLocale) v.push(`localeCompare／Intl の出現 ${nLocale} 件（コメントを含めて 0 件であること）`);
  const code = RAW_RE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const [re, what] of [[/toLocale\w*/g, 'toLocale*'], [/\bDate\b/g, 'Date'], [/Math\.random/g, 'Math.random']]) {
    const n = (code.match(re) || []).length;
    if (n) v.push(`コード部分に ${what} が ${n} 件`);
  }
  console.log(`     localeCompare／Intl の出現: ${nLocale} 件（ファイル全体）`);
  report('A) 違反', v);
}

// ── B)・C) の入力 ─────────────────────────────────────────────────────────────
const S = '2026-07-01T12:00:00Z';
const E = (name, author, submittedAt, src) => ({ name, author, program: { src, lang: 'c' }, carType: 'normal_fr', ...(submittedAt === undefined ? {} : { submittedAt }) });
const ORDER_ENTRIES = [
  E('Car-z', 'z', S, 'p1'), E('Car-E', 'Émile', S, 'A2'), E('Car-e', 'emile', S, 'p3'), E('Car-Zoe', 'Zoe', S, 'p4'),
  E('Same', '', S, 'B5'), E('Same', 'ı', S, 'p6'), E('Same', 'I', S, 'p7'), E('Car-i', 'i', S, 'p8'), E('Car-İ', 'İ', S, 'p9'),
  E('Same', '', S, 'A10'), E('Early', 'zz', '2026-07-01T11:59:59Z', 'p11'), E('NoTime', 'a', undefined, 'p12'), E('Beta', 'Émile', S, 'Z13'),
];
// 期待の並び [name, author, src]（UTF-16 の符号単位の順）: submittedAt（'' が最小）→ author（'' なら name）→ name → 本文。
//   鍵 2 段目: 'I'(0x49) < 'Same'(0x53) < 'Zoe' < 'emile' < 'i' < 'z' < 'Émile'(0xC9) < 'İ'(0x130) < 'ı'(0x131)。
//   'Same' の 2 件（author ''）は本文 'A10' < 'B5'、'Émile' の 2 件は name 'Beta' < 'Car-E'。
const EXPECTED_ORDER = [
  ['NoTime', 'a', 'p12'], ['Early', 'zz', 'p11'], ['Same', 'I', 'p7'], ['Same', '', 'A10'], ['Same', '', 'B5'],
  ['Car-Zoe', 'Zoe', 'p4'], ['Car-e', 'emile', 'p3'], ['Car-i', 'i', 'p8'], ['Car-z', 'z', 'p1'],
  ['Beta', 'Émile', 'Z13'], ['Car-E', 'Émile', 'A2'], ['Car-İ', 'İ', 'p9'], ['Same', 'ı', 'p6'],
];
const CLOSE = '2026-07-14T23:59:59Z';
const CUT = [   // [name, submittedAt(undefined=欄なし), close=CLOSE で入るか]
  ['early', '2026-07-01T00:00:00.000Z', true], ['same', '2026-07-14T23:59:59Z', true], ['sameMs', '2026-07-14T23:59:59.000Z', true],
  ['sameSub', '2026-07-14T23:59:59.000000Z', true], ['sameJst', '2026-07-15T08:59:59+09:00', true], ['earlyMinus', '2026-07-14T18:59:58-05:00', true],
  ['leapDay', '2024-02-29T12:00:00Z', true], ['noSec', '2026-07-14T23:59Z', true],
  ['late1ms', '2026-07-14T23:59:59.001Z', false], ['lateSub', '2026-07-14T23:59:59.0000001Z', false], ['late1s', '2026-07-15T00:00:00Z', false],
  ['lateJst', '2026-07-15T09:00:00+09:00', false], ['noTz', '2026-07-14T23:59:58', false], ['empty', '', false], ['missing', undefined, false],
  ['garbage', 'yesterday', false], ['feb30', '2026-02-30T00:00:00Z', false], ['h24', '2026-07-13T24:00:00Z', false],
  ['lower', '2026-07-01t00:00:00z', false], ['numeric', 1, false], ['off24', '2026-07-01T00:00:00+24:00', false],
];
const CUT_ENTRIES = CUT.map(([n, t]) => E(n, 'u-' + n, t, 's-' + n));
const ALL = CUT.map(([n]) => n).sort();
const IN = CUT.filter((c) => c[2]).map(([n]) => n).sort();
const IN_EARLIER = ['early', 'earlyMinus', 'leapDay', 'noSec'].sort();   // close を 1 ms 前にしたとき
const ev = (entryWindow) => ({ class: 'open', minField: 1, ...(entryWindow === undefined ? {} : { entryWindow }) });
const CUT_EVENTS = [
  ['close=Z', ev({ open: '2026-07-01T00:00:00Z', close: CLOSE }), IN],
  ['close=+09:00（同時刻）', ev({ close: '2026-07-15T08:59:59+09:00' }), IN],
  ['close=.000Z（同時刻の別表記）', ev({ close: '2026-07-14T23:59:59.000Z' }), IN],
  ['close=1 ms 前', ev({ close: '2026-07-14T23:59:58.999Z' }), IN_EARLIER],
  ['entryWindow 欄なし', ev(undefined), ALL],
  ["close=''（空文字・ブラウザ治具の形）", ev({ open: '', close: '' }), ALL],
  ['close=null', ev({ close: null }), ALL],
  ['close=読めない値', ev({ close: 'garbage' }), ALL],
];
// Date.parse を基準にした 400 組。表記はオフセット付き・秒まで／ミリ秒 3 桁（ES の Date Time String Format＝値が仕様で決まる形）。
function oraclePairs() {
  let seed = 20261011;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
  const p2 = (x) => String(x).padStart(2, '0');
  const render = (ms) => {
    const offMin = rnd(3) === 0 ? 0 : (rnd(2) ? 1 : -1) * (rnd(14) * 60 + [0, 30, 45][rnd(3)]);
    const iso = new Date(ms + offMin * 60000).toISOString();   // 壁時計の表記を作るだけ（UTC の算術）
    const body = rnd(2) ? iso.slice(0, 19) : iso.slice(0, 23);
    if (body.length === 19 && ms % 1000 !== 0) return null;   // 秒までの表記にできない時刻は使わない
    return body + (offMin === 0 && rnd(2) ? 'Z' : `${offMin < 0 ? '-' : '+'}${p2(Math.floor(Math.abs(offMin) / 60))}:${p2(Math.abs(offMin) % 60)}`);
  };
  const out = [];
  const bases = [Date.UTC(2026, 6, 14, 23, 59, 59), Date.UTC(2024, 1, 29, 0, 0, 0), Date.UTC(1999, 11, 31, 23, 59, 59, 999), Date.UTC(2100, 1, 28, 12, 0, 0)];
  const deltas = [0, 0, 1, -1, 999, -999, 1000, -1000, 3600000, -3600000, 86400000, -86400000];
  while (out.length < 400) {
    const c = bases[rnd(bases.length)] + rnd(2000) * 1000;
    const s = c + deltas[rnd(deltas.length)];
    const cs = render(c), ss = render(s);
    if (cs && ss) out.push([ss, cs]);
  }
  return out;
}
const ORACLE = oraclePairs();
const ORACLE_EXP = ORACLE.map(([s, c]) => Date.parse(s) <= Date.parse(c));

// ── 子プロセス（ロケール・タイムゾーンを変えた node） ────────────────────────────
const ENVS = [
  { LANG: 'C', TZ: 'UTC' },
  { LANG: 'ja_JP.UTF-8', TZ: 'Asia/Tokyo' },
  { LANG: 'tr_TR.UTF-8', TZ: 'America/Los_Angeles' },
];
const CHILD = `
import fs from 'node:fs';
const { frozenField } = await import(process.env.BI1_JS);
const P = JSON.parse(fs.readFileSync(0, 'utf8'));
const pick = (f) => f.map((e) => [e.name, e.author == null ? null : e.author, e.src]);
const one = (sub, close) => frozenField({ class: 'open', minField: 1, entryWindow: { close } },
  [{ name: 'x', author: 'x', submittedAt: sub, program: { src: '', lang: 'c' }, carType: 'normal_fr' }]).some((e) => e.name === 'x');
process.stdout.write(JSON.stringify({
  locale: new Intl.Collator().resolvedOptions().locale,
  tz: new Intl.DateTimeFormat().resolvedOptions().timeZone,
  order: pick(frozenField(P.orderEvent, P.order)),
  orderRev: pick(frozenField(P.orderEvent, [...P.order].reverse())),
  cutoff: P.cutEvents.map((ev) => frozenField(ev, P.cut).map((e) => e.name).sort()),
  oracle: P.oracle.map(([s, c]) => one(s, c)),
}));
`;
const PAYLOAD = JSON.stringify({ orderEvent: { class: 'open', minField: 1 }, order: ORDER_ENTRIES, cutEvents: CUT_EVENTS.map((c) => c[1]), cut: CUT_ENTRIES, oracle: ORACLE });
function runChildren(reUrl) {
  return ENVS.map((e) => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], {
      env: { ...process.env, LANG: e.LANG, LC_ALL: e.LANG, TZ: e.TZ, BI1_JS: reUrl }, input: PAYLOAD, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    if (r.status !== 0) return { env: e, error: ((r.stderr || '') + (r.stdout || '')).trim().split('\n').slice(-3).join(' / ') };
    return { env: e, ...JSON.parse(r.stdout) };
  });
}
const envTag = (o) => `LANG=${o.env.LANG}・TZ=${o.env.TZ}`;
function checkB(outs) {
  const v = [];
  for (const o of outs) if (o.error) v.push(`${envTag(o)}: 子プロセスが失敗（${o.error}）`);
  if (v.length) return v;
  const locales = new Set(outs.map((o) => o.locale)), tzs = new Set(outs.map((o) => o.tz));
  if (locales.size !== outs.length) v.push(`3 起動の既定ロケールが分かれていない（${outs.map((o) => o.locale).join(', ')}）＝ロケール非依存を測れていない（この Node は LANG に従わない）`);
  if (tzs.size !== outs.length) v.push(`3 起動のタイムゾーンが分かれていない（${outs.map((o) => o.tz).join(', ')}）`);
  const hashes = outs.map((o) => sha(JSON.stringify(o.order)));
  if (new Set(hashes).size !== 1) v.push(`並びの sha256 が起動ごとに違う（${outs.map((o, i) => `${o.locale}=${hashes[i].slice(0, 12)}`).join(' / ')}）`);
  const exp = JSON.stringify(EXPECTED_ORDER);
  for (const o of outs) {
    if (JSON.stringify(o.order) !== exp) v.push(`${o.locale}: 並びが期待と違う（${o.order.map((x) => x[0] + '/' + x[1] + '/' + x[2]).join(' → ')}）`);
    if (JSON.stringify(o.orderRev) !== exp) v.push(`${o.locale}: 入力を逆順にすると並びが変わる（${o.orderRev.map((x) => x[0] + '/' + x[1] + '/' + x[2]).join(' → ')}）`);
  }
  return v;
}
function checkC(outs) {
  const v = [];
  for (const o of outs) if (o.error) v.push(`${envTag(o)}: 子プロセスが失敗（${o.error}）`);
  if (v.length) return v;
  for (const o of outs) {
    CUT_EVENTS.forEach(([label, , want], i) => {
      const got = o.cutoff[i];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        const extra = got.filter((n) => !want.includes(n)), lack = want.filter((n) => !got.includes(n));
        v.push(`${envTag(o)}・${label}: 余分 [${extra.join(', ')}]・欠落 [${lack.join(', ')}]`);
      }
    });
    const bad = ORACLE.map((p, i) => [p, o.oracle[i], ORACLE_EXP[i]]).filter((x) => x[1] !== x[2]);
    if (bad.length) v.push(`${envTag(o)}・Date.parse 基準の 400 組: ${bad.length} 組が不一致（例 ${bad.slice(0, 2).map(([[s, c], g, w]) => `${s} ≤ ${c} → ${g}（基準 ${w}）`).join(' / ')}）`);
  }
  return v;
}

const REAL_URL = pathToFileURL(RE_PATH).href;
const real = runChildren(REAL_URL);
console.log('\n  B) グリッド順はロケール・入力順に依存しない（node 3 起動）');
for (const o of real) if (!o.error) console.log(`     ${envTag(o)} → 既定ロケール ${o.locale}・TZ ${o.tz}・並びの sha256 ${sha(JSON.stringify(o.order)).slice(0, 16)}…`);
report('B) 違反', checkB(real));

// 写しの race_event.js を作る（import を本物の public/js へ向け直す。product は無改変）。
const reDir = mkTmp('re');
function writeRe(name, text) {
  const jsUrl = pathToFileURL(JS_ROOT).href + '/';
  // BI2: race_event.js は race_engine.js（computeRaceTimeout）も import する＝向け直す相対 import は 3 本。
  const out = text.replace(/from '\.\/(config|programs|race_engine)\.js'/g, (m, f) => `from '${jsUrl}${f}.js'`);
  if ((out.match(/from 'file:/g) || []).length !== 3) throw new Error('写しの import を向け直せない（race_event.js の import が変わった）');
  const p = path.join(reDir, name + '.js');
  fs.writeFileSync(p, out);
  return pathToFileURL(p).href;
}
// 改修前の frozenField（HEAD c7b3ee5・v10.0.0 の原文）。陰性対照と変異に使う。
const PRE_FIX = `export function frozenField(event, entries) {
  const ordered = [...(entries || [])].map(normEntry).sort((a, b) =>
    String(a.submittedAt).localeCompare(String(b.submittedAt)) ||
    String(a.author || a.name || '').localeCompare(String(b.author || b.name || '')));
  const valid = ordered.filter((e) => validateEntry(event, e).ok);
  return formField(event, valid);
}
`;
const replaceFrozen = (s, body) => { const a = s.indexOf('export function frozenField(event, entries) {'); return a < 0 ? s : s.slice(0, a) + body; };
console.log('     陰性対照（改修前の frozenField の原文を同じ 3 起動にかける）:');
{
  const pre = runChildren(writeRe('prefix_control', replaceFrozen(RAW_RE, PRE_FIX)));
  const v = [];
  if (pre.some((o) => o.error)) v.push('改修前の写しが動かない: ' + pre.filter((o) => o.error).map((o) => o.error).join(' / '));
  else {
    const hs = pre.map((o) => sha(JSON.stringify(o.order)));
    for (const [o, h] of pre.map((o, i) => [o, hs[i]])) console.log(`       ${o.locale}: sha256 ${h.slice(0, 16)}…・期待（符号単位の順）と ${JSON.stringify(o.order) === JSON.stringify(EXPECTED_ORDER) ? '同じ' : '異なる'}`);
    const distinct = new Set(hs).size;
    const diffFromExp = pre.filter((o) => JSON.stringify(o.order) !== JSON.stringify(EXPECTED_ORDER)).length;
    console.log(`       → ロケール間で ${distinct} 通り・期待と異なる起動 ${diffFromExp}/3`);
    if (distinct < 2 && diffFromExp === 0) v.push('改修前の実装でも並びが変わらない＝列が弱い（強くする）');
  }
  report('B) 陰性対照の不成立', v);
}

console.log('\n  C) 締切: close より後の submittedAt は入らない・同時刻は入る・未記載は全件（3 起動・Date.parse 基準 400 組）');
console.log(`     close=${CLOSE} で入る ${IN.length} 件／入らない ${CUT.length - IN.length} 件・Date.parse 基準で入る組 ${ORACLE_EXP.filter(Boolean).length}/${ORACLE.length}`);
report('C) 違反', checkC(real));

// ── D) 生成側（wf_official_result.mjs を子プロセスで） ──────────────────────────
console.log('\n  D) 生成側 wf_official_result.mjs: 同名エントリーの帰属・締切の採否・読めない close の拒否');
const SPECS = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/courses.json'), 'utf8'));
const TWINS_ENTRIES = [
  { name: 'Twin', author: 'alice', progKey: 'normal_fr', carType: 'normal_fr', submittedAt: '2026-01-01T00:00:00Z' },
  { name: 'Twin', author: 'bob', program: { src: 'void setup() {}\nvoid loop() {}\n', lang: 'c' }, carType: 'normal_ff', submittedAt: '2026-01-01T00:00:01Z' },
];
const twinsBundle = (close) => ({
  courseSpec: SPECS.find((x) => x.name === 'オーバル'),
  event: { id: 'bi1-twins', title: 'BI1 同名エントリーの帰属', course: 'オーバル', regime: 'tabletop', physicsMode: 'dynamic', laps: 1,
    class: 'open', crashRule: { rejoin: false, penaltySec: 3 }, interact: false, minField: 3, maxSec: 20,
    ...(close === undefined ? {} : { entryWindow: { open: '2025-12-01T00:00:00Z', close } }) },
  entries: TWINS_ENTRIES,
});
const dDir = mkTmp('d');
function runOfficial(script, bundle, tag) {
  const bp = path.join(dDir, tag + '_bundle.json'), rp = path.join(dDir, tag + '_result.json');
  fs.writeFileSync(bp, JSON.stringify(bundle));
  const r = spawnSync(process.execPath, [script, '--event', bp, '--out', rp, '--now', '2026-10-11T00:00:00Z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  let result = null;
  try { result = JSON.parse(fs.readFileSync(rp, 'utf8')); } catch (e) { /* 生成されていない */ }
  return { code: r.status, out, result };
}
// result の各行を field の添字へ対応づけ（name と carType の組が field で一意になる束を使う）、author を突き合わせる。
function checkAttribution(run, bundle, wantRows, needDnf) {
  const v = [];
  const ok12 = /① 決定論 \(2回実行\): verifyHash ✓ 一致 \/ 順位 ✓ 一致/.test(run.out) && /② result\.json 再検証: verifyHash ✓ 一致 \/ 順位 ✓ 一致/.test(run.out);
  if (!ok12 || !run.result || ![0, 3].includes(run.code)) { v.push(`①② が合格していない・または result.json が無い（exit ${run.code}）: ${run.out.trim().split('\n').slice(-3).join(' / ')}`); return v; }
  const field = frozenField(bundle.event, bundle.entries);
  const rows = [...run.result.finishers.map((f) => ({ ...f, kind: 'finisher' })), ...run.result.dnf.map((d) => ({ ...d, kind: 'dnf' }))];
  const rowKeys = rows.map((r) => `${r.name}/${r.carType}`).sort();
  if (JSON.stringify(rowKeys) !== JSON.stringify([...wantRows].sort())) v.push(`記録に載った車が期待と違う（${rowKeys.join(', ')}／期待 ${[...wantRows].sort().join(', ')}）`);
  for (const r of rows) {
    const idxs = field.map((f, i) => (f.name === r.name && f.carType === r.carType ? i : -1)).filter((i) => i >= 0);
    if (idxs.length !== 1) { v.push(`${r.kind} ${r.name}/${r.carType}: field で一意に引けない（${idxs.length} 件）`); continue; }
    const want = field[idxs[0]].author || null;
    if (r.author !== want) v.push(`${r.kind} ${r.name}/${r.carType}: author ${JSON.stringify(r.author)}（field[${idxs[0]}] は ${JSON.stringify(want)}）`);
  }
  if (needDnf && (!rows.some((r) => r.kind === 'finisher') || !rows.some((r) => r.kind === 'dnf'))) v.push(`finisher と dnf の両方が出ていない（finisher ${run.result.finishers.length}・dnf ${run.result.dnf.length}）＝束が弱い`);
  return v;
}
const ROWS_BOTH = ['Twin/normal_fr', 'Twin/normal_ff', 'BOT-1/normal_fr'];
const ROWS_LATE_OUT = ['Twin/normal_fr', 'BOT-1/normal_fr', 'BOT-2/normal_awd'];
function checkD(script) {
  const v = [];
  // D1: 締切ちょうど（bob の submittedAt＝close）→ 2 台とも入り、bob の行は bob。
  const b1 = twinsBundle('2026-01-01T00:00:01Z');
  const r1 = runOfficial(script, b1, 'd1');
  v.push(...checkAttribution(r1, b1, ROWS_BOTH, true).map((s) => 'D1（close＝bob の時刻）' + s));
  if (r1.result) {
    const twins = [...r1.result.finishers, ...r1.result.dnf].filter((x) => x.name === 'Twin').map((x) => `${x.carType}:${x.author}`).sort();
    console.log(`     D1 close＝締切ちょうど: 記録の Twin の行 ${twins.join(' / ')}（exit ${r1.code}＝③ は正準サンプル専用の照合）`);
    if (JSON.stringify(twins) !== JSON.stringify(['normal_ff:bob', 'normal_fr:alice'])) v.push(`D1: 同名 2 台の author が ${twins.join(' / ')}（期待 normal_ff:bob / normal_fr:alice）`);
  }
  // D2: 締切＝alice の時刻 → bob（1 秒後）は入らず、filler が 2 台補充される。
  const b2 = twinsBundle('2026-01-01T00:00:00Z');
  const r2 = runOfficial(script, b2, 'd2');
  v.push(...checkAttribution(r2, b2, ROWS_LATE_OUT, false).map((s) => 'D2（close＝alice の時刻）' + s));
  if (r2.result) console.log(`     D2 close＝1 秒前: 記録の車 ${[...r2.result.finishers, ...r2.result.dnf].map((x) => `${x.name}/${x.carType}:${x.author}`).join(' / ')}`);
  // D3: 読めない close・オフセット無しの close は exit 2（runRace の前で止まる）。
  for (const [label, close] of [['読めない close', 'garbage'], ['オフセット無しの close', '2026-01-01T00:00:01']]) {
    const r = runOfficial(script, twinsBundle(close), 'd3');
    const said = /entryWindow\.close を時刻として読めない/.test(r.out);
    console.log(`     D3 ${label} ${JSON.stringify(close)} → exit ${r.code}${said ? '・理由を表示' : ''}`);
    if (r.code !== 2 || !said) v.push(`D3 ${label}: exit ${r.code}（期待 2 と理由の表示）`);
  }
  return v;
}
report('D) 違反', checkD(OFFICIAL));
console.log('     改修前の帰属（車名で引く）に戻した写しで同じ束を生成（取り違えの再現と検出力）:');
const offDir = mkTmp('off');
function writeOfficial(name, mutate) {
  const jsUrl = pathToFileURL(JS_ROOT).href + '/';
  let s = RAW_OFF.replace(/from '\.\/public\/js\//g, `from '${jsUrl}`);
  const m = mutate(s);
  if (m === s) return null;
  const p = path.join(offDir, name + '.mjs');
  fs.writeFileSync(p, m);
  fs.copyFileSync(path.join(ROOT, 'wf_frozen_manifest.json'), path.join(offDir, 'wf_frozen_manifest.json'));
  return p;
}
const OFF_MUTATIONS = [
  ['帰属を車名で引く（改修前）', (s) => s
    .replace('const authorAt = (idx) => { const f = Number.isInteger(idx) ? field[idx] : undefined; return (f && f.author) || null; };',
      'const authorAt = (name) => { const f = field.find((x) => x.name === name); return (f && f.author) || null; };')
    .replace('author: authorAt(f.idx)', 'author: authorAt(f.name)').replace('author: authorAt(d.idx)', 'author: authorAt(d.name)'), true],
  ['読めない close を拒まない', (s) => s.replace("if (close.kind === 'invalid') {", "if (close.kind === 'invalid' && false) {"), false],
];
const offMiss = [], offNoop = [];
for (const [name, mutate, showRepro] of OFF_MUTATIONS) {
  const p = writeOfficial(name.replace(/\W/g, '_'), mutate);
  if (!p) { offNoop.push(`${name}（変異が適用されていない＝パターンが実装とズレた）`); continue; }
  const log = console.log; console.log = () => {};
  let v;
  try { v = checkD(p); } finally { console.log = log; }
  if (showRepro) {
    const r = runOfficial(p, twinsBundle('2026-01-01T00:00:01Z'), 'repro');
    const twins = r.result ? [...r.result.finishers, ...r.result.dnf].filter((x) => x.name === 'Twin').map((x) => `${x.carType}:${x.author}`).sort() : [];
    console.log(`       ${name}: 記録の Twin の行 ${twins.join(' / ') || '(なし)'}${twins.includes('normal_ff:alice') ? '＝bob の行が alice（取り違えを再現）' : ''}`);
    if (!twins.includes('normal_ff:alice')) offMiss.push(`${name}: 取り違えが再現しない＝束が弱い`);
  }
  if (!v.length) offMiss.push(`${name} → D) が見逃した`);
  else console.log(`     ✓ ${name} → D) が ${v.length} 件で赤`);
}
report('D) 見逃した変異・再現しない取り違え', offMiss);
report('D) 適用できなかった変異（パターン腐り）', offNoop);

// ── E) 回帰: 正準サンプル束 ─────────────────────────────────────────────────────
console.log('\n  E) 出荷の正準サンプル束（close 未記載）の並びは従来どおり');
{
  const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/phase_w/official_sample_event.json'), 'utf8'));
  const names = frozenField(sample.event, sample.entries).map((e) => e.name);
  console.log(`     並び: ${names.join(' → ')}`);
  report('E) 違反', JSON.stringify(names) === JSON.stringify(['Circuit-FF', 'Circuit-FR', 'Circuit-AWD']) ? [] : [`並びが変わった（${names.join(', ')}）`]);
}

// ── F) 検出力（race_event.js の写しを壊す） ────────────────────────────────────
console.log('\n  F) 変異試験（race_event.js の写しを壊して B) か C) が赤くなるか）');
const RE_MUTATIONS = [
  ['改修前の frozenField（原文）', (s) => replaceFrozen(s, PRE_FIX)],
  ['比較をロケール依存の照合にする', (s) => s.replace('const cmpStr = (x, y) => (x < y ? -1 : (x > y ? 1 : 0));', 'const cmpStr = (x, y) => String(x).localeCompare(String(y));')],
  ['締切の除外を外す', (s) => s.replace('.map(normEntry).filter(onTime).sort(cmpEntry)', '.map(normEntry).sort(cmpEntry)')],
  ['締切と同時刻を除く（≤ を < に）', (s) => s.replace('cmpInstant(t, close.at) <= 0', 'cmpInstant(t, close.at) < 0')],
  ['submittedAt を Date.parse で読む（オフセット無しが地方時になる）', (s) => s.replace('const t = parseInstant(e.submittedAt);',
    'const t = Number.isNaN(Date.parse(e.submittedAt)) ? null : { ms: Date.parse(e.submittedAt), sub: \'\' };')],
  ['close 未記載で全件を除く', (s) => s.replace("if (close.kind !== 'at') return true;", "if (close.kind === 'none') return false; if (close.kind !== 'at') return true;")],
  ['タイブレークの name を外す', (s) => s.replace("    || cmpStr(String(a.name == null ? '' : a.name), String(b.name == null ? '' : b.name))\n", '')],
  ['タイブレークの本文を外す', (s) => s.replace('    || cmpStr(tieKey(a), tieKey(b));', '    || 0;')],
  ['暦の検査を外す（2 月 30 日を 3 月へ繰り越す）', (s) => s.replace('  if (D > dim) return null;\n', '')],
  ['ミリ秒より下の桁を捨てる', (s) => s.replace("  return cmpStr(a.sub.padEnd(n, '0'), b.sub.padEnd(n, '0'));", '  return 0;')],
];
const miss = [], noop = [];
RE_MUTATIONS.forEach(([name, fn], i) => {
  const m = fn(RAW_RE);
  if (m === RAW_RE) { noop.push(`${name}（変異が適用されていない＝パターンが実装とズレた）`); return; }
  const outs = runChildren(writeRe('mut' + i, m));
  const vb = checkB(outs), vc = checkC(outs);
  if (!vb.length && !vc.length) miss.push(`${name} → B)・C) が見逃した`);
  else console.log(`     ✓ ${name} → B) ${vb.length} 件・C) ${vc.length} 件で赤`);
});
console.log(`  変異 ${RE_MUTATIONS.length} 件を注入（product のファイルは無改変）`);
report('F) 見逃した変異', miss);
report('F) 適用できなかった変異（パターン腐り）', noop);

// ── G) BI2: 生成側と再検証側の既定値（maxSec・regime ほか）を race_event.js の 1 関数に集約 ───────────────
console.log('\n  G) BI2: event の欠落欄の既定は resolveEventSpec だけ（生成側・再検証・👻 が同じ関数）');
const UI_PATH = path.join(JS_ROOT, 'race_ui.js');
const RAW_UI = fs.readFileSync(UI_PATH, 'utf8');
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
// G1) 構造: 既定のリテラルが race_ui.js・wf_official_result.mjs のコード部分に残っていない／両者が同じ関数を呼ぶ。
const DEFAULT_LITERALS = [
  [/maxSec\b[^;\n]*\b180\b/g, 'maxSec の固定 180'],
  [/regime\s*\|\|\s*null/g, "regime の `|| null` 既定"],
  [/physicsMode\s*\|\|\s*['"]dynamic['"]/g, "physicsMode || 'dynamic'"],
  [/laps\s*\|\|\s*3\b/g, 'laps || 3'],
  [/crashRule\s*\|\|\s*\{/g, 'crashRule の既定オブジェクト'],
  [/rejoin:\s*false/g, 'crashRule 既定の rejoin: false'],
  [/penaltySec\s*\|\|\s*3\b/g, 'penaltySec || 3'],
];
function checkG1(ui, off) {
  const v = [];
  for (const [name, text] of [['race_ui.js', ui], ['wf_official_result.mjs', off]]) {
    const code = stripComments(text);
    for (const [re, what] of DEFAULT_LITERALS) { const n = (code.match(re) || []).length; if (n) v.push(`${name}: ${what} が ${n} 件`); }
  }
  const uiCode = stripComments(ui), offCode = stripComments(off);
  const need = [
    [uiCode, /typeof eventNS\.resolveEventSpec === 'function' \? eventNS\.resolveEventSpec\(event, course\) : null/g, 1, 'race_ui.js の eventSpecOf が resolveEventSpec を名前空間から呼ぶ'],
    [uiCode, /const es = eventSpecOf\(event, rcourse\);/g, 1, 'verifyOfficialLocally が eventSpecOf(event, rcourse) を呼ぶ'],
    [uiCode, /const es = eventSpecOf\(race\.event, rcourse\);/g, 1, 'ghostVsWorld が eventSpecOf(race.event, rcourse) を呼ぶ'],
    [uiCode, /maxSec: es\.maxSec/g, 2, 'race_ui.js の 2 経路が maxSec を es から渡す'],
    [offCode, /const spec = resolveEventSpec\(event, course\);/g, 1, 'wf_official_result.mjs の runOfficial が resolveEventSpec を呼ぶ'],
    [offCode, /regime: spec\.regime, laps: spec\.laps, field, crashRule: spec\.crashRule, interact: spec\.interact, maxSec: spec\.maxSec/g, 1, 'runOfficial が spec の値で runRace を呼ぶ'],
    [offCode, /\n    laps: spec\.laps,\n    maxSec: spec\.maxSec,\n    finishers:/g, 1, 'result.json に実効の laps・maxSec を刻む'],
  ];
  for (const [code, re, want, what] of need) { const n = (code.match(re) || []).length; if (n !== want) v.push(`${what}: ${n} 件（期待 ${want}）`); }
  if (/import\s*\{[^}]*\bresolveEventSpec\b[^}]*\}\s*from\s*'\.\/race_event\.js'/.test(ui)) v.push('race_ui.js が resolveEventSpec を名前付き import している（BA1: 古い race_event.js がキャッシュに残ると全体が読めない）');
  return v;
}
report('G1) 既定リテラルの残り・関数を通らない経路', checkG1(RAW_UI, RAW_OFF));

// G2) 関数: resolveEventSpec の既定値（maxSec＝computeRaceTimeout・峠は 1 本・regime='tabletop' ほか）。
const { resolveEventSpec } = await import(pathToFileURL(RE_PATH).href);
const { computeRaceTimeout } = await import(pathToFileURL(path.join(JS_ROOT, 'race_engine.js')).href);
const { buildFromSpec } = await import(pathToFileURL(path.join(JS_ROOT, 'course.js')).href);
const SAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/phase_w/official_sample_event.json'), 'utf8'));
const NODEF = JSON.parse(JSON.stringify(SAMPLE));
delete NODEF.event.maxSec; delete NODEF.event.regime; NODEF.event.id = 'bi2-nodefaults';
function checkG2(resolve) {
  const v = [];
  const sCourse = buildFromSpec(SAMPLE.courseSpec);
  const sp = resolve(NODEF.event, sCourse);
  const wantMax = computeRaceTimeout({ course: sCourse, laps: sp.laps, regime: 'tabletop' });
  console.log(`     サンプル（maxSec・regime を落とした束）: regime=${sp.regime}・laps=${sp.laps}・maxSec=${sp.maxSec}（computeRaceTimeout=${wantMax}）`);
  if (sp.regime !== 'tabletop') v.push(`regime が ${JSON.stringify(sp.regime)}（期待 'tabletop'）`);
  if (sp.maxSec !== wantMax) v.push(`maxSec が ${sp.maxSec}（computeRaceTimeout は ${wantMax}）`);
  const touge = buildFromSpec(SPECS.find((x) => x.kind === 'touge'));
  const tg = resolve({ laps: 30 }, touge);
  const t1 = computeRaceTimeout({ course: touge, laps: 1, regime: 'tabletop' }), t30 = computeRaceTimeout({ course: touge, laps: 30, regime: 'tabletop' });
  if (!touge.touge || t1 === t30) v.push(`峠の検査が空振り（touge=${touge.touge}・1 本 ${t1}・30 本 ${t30}）`);
  else if (tg.maxSec !== t1) v.push(`峠（laps 30）の maxSec が ${tg.maxSec}（runRace と同じく 1 本で ${t1}）`);
  const empty = resolve({}, sCourse);
  const want = { laps: 3, regime: 'tabletop', crashRule: { rejoin: false, penaltySec: 3 }, interact: true, physics: 'dynamic', recon: null, wear: false };
  for (const [k, w] of Object.entries(want)) if (JSON.stringify(empty[k]) !== JSON.stringify(w)) v.push(`空の event の ${k} が ${JSON.stringify(empty[k])}（期待 ${JSON.stringify(w)}）`);
  const given = resolve({ laps: 2.6, regime: 'fullscale', maxSec: 0, crashRule: { rejoin: 1 }, interact: false, physicsMode: 'v2', recon: 2, wear: 1 }, sCourse);
  const wantG = { laps: 3, regime: 'fullscale', maxSec: 0, crashRule: { rejoin: true, penaltySec: 3 }, interact: false, physics: 'v2', recon: { laps: 2 }, wear: true };
  for (const [k, w] of Object.entries(wantG)) if (JSON.stringify(given[k]) !== JSON.stringify(w)) v.push(`書かれた欄の ${k} が ${JSON.stringify(given[k])}（期待 ${JSON.stringify(w)}）`);
  const a = resolve({}, sCourse); a.crashRule.rejoin = true;
  if (resolve({}, sCourse).crashRule.rejoin !== false) v.push('返した crashRule を書き換えると次の呼び出しの既定が変わる（共有オブジェクト）');
  return v;
}
report('G2) resolveEventSpec の既定値', checkG2(resolveEventSpec));

// G3) 生成側の本番フロー: サンプルから maxSec と regime を落とした束で、生成 →（①② 合格・③ は正準サンプル専用で exit 3）→ --verify exit 0。
//     result.json には実効の regime='tabletop'・maxSec＝computeRaceTimeout が刻まれる。
function checkG3() {
  const v = [];
  const run = runOfficial(OFFICIAL, NODEF, 'g3');
  const ok12 = /① 決定論 \(2回実行\): verifyHash ✓ 一致 \/ 順位 ✓ 一致/.test(run.out) && /② result\.json 再検証: verifyHash ✓ 一致 \/ 順位 ✓ 一致/.test(run.out);
  if (!ok12 || !run.result || run.code !== 3) { v.push(`生成: ①② 合格かつ exit 3 でない（exit ${run.code}）: ${run.out.trim().split('\n').slice(-3).join(' / ')}`); return v; }
  const sCourse = buildFromSpec(NODEF.courseSpec);
  const wantMax = computeRaceTimeout({ course: sCourse, laps: run.result.laps, regime: 'tabletop' });
  if (run.result.regime !== 'tabletop') v.push(`result.regime が ${JSON.stringify(run.result.regime)}（期待 'tabletop'）`);
  if (run.result.maxSec !== wantMax) v.push(`result.maxSec が ${run.result.maxSec}（computeRaceTimeout は ${wantMax}）`);
  const rp = path.join(dDir, 'g3_result.json'), bp = path.join(dDir, 'g3_bundle.json');
  const r = spawnSync(process.execPath, [OFFICIAL, '--verify', rp, '--event', bp], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const vOut = (r.stdout || '') + (r.stderr || '');
  const vm = /verifyHash: 保存 (\w+) \/ 再計算 (\w+) → ✓ 一致/.exec(vOut);
  console.log(`     生成 exit ${run.code}（①② 合格・③ は正準サンプル専用）・verifyHash=${run.result.verifyHash}・regime=${run.result.regime}・maxSec=${run.result.maxSec}・--verify exit ${r.status}${vm ? `（保存 ${vm[1]} / 再計算 ${vm[2]}）` : ''}`);
  if (r.status !== 0 || !vm || !/順位:\s+✓ 一致/.test(vOut)) v.push(`--verify が一致しない（exit ${r.status}）: ${vOut.trim().split('\n').slice(-3).join(' / ')}`);
  return v;
}
report('G3) 既定を落とした束の生成と再検証', checkG3());

// G4) 検出力: 写しを壊すと G1／G2 が赤になる（product のファイルは無改変）。
{
  const miss = [], noop = [];
  const UI_MUT = [
    ['検証再走を旧固定 180 秒に戻す', (s) => s.replace('maxSec: es.maxSec, grid,', 'maxSec: event.maxSec != null ? event.maxSec : 180, grid,')],
    ['👻 の regime を旧 `|| null` に戻す', (s) => s.replace('res = runRace({ course: rcourse, regime: es.regime,', 'res = runRace({ course: rcourse, regime: race.event.regime || null,')],
    ['resolveEventSpec を名前付き import する', (s) => s.replace("import { frozenField } from './race_event.js';", "import { frozenField, resolveEventSpec } from './race_event.js';")],
    ['検証再走が関数を通らない', (s) => s.replace('const es = eventSpecOf(event, rcourse);', 'const es = { ...event };')],
  ];
  const OFF_MUT = [
    ['生成側の regime を旧 `|| null` に戻す', (s) => s.replace('course, regime: spec.regime,', 'course, regime: event.regime || null,')],
    ['生成側の physicsMode 既定を書き戻す', (s) => s.replace('physics: spec.physics,', "physics: event.physicsMode || 'dynamic',")],
  ];
  for (const [name, fn] of UI_MUT) { const m = fn(RAW_UI); if (m === RAW_UI) { noop.push(name); continue; } if (!checkG1(m, RAW_OFF).length) miss.push(`${name} → G1 が見逃した`); else console.log(`     ✓ ${name} → G1 で赤`); }
  for (const [name, fn] of OFF_MUT) { const m = fn(RAW_OFF); if (m === RAW_OFF) { noop.push(name); continue; } if (!checkG1(RAW_UI, m).length) miss.push(`${name} → G1 が見逃した`); else console.log(`     ✓ ${name} → G1 で赤`); }
  const RE_MUT2 = [
    ['maxSec の既定を固定 180 にする', (s) => s.replace('const maxSec = ev.maxSec != null ? ev.maxSec\n    : computeRaceTimeout(', 'const maxSec = ev.maxSec != null ? ev.maxSec : 180; void (')],
    ["regime の既定を null にする", (s) => s.replace("const regime = ev.regime || 'tabletop';", 'const regime = ev.regime || null;')],
    ['峠を 1 本に正規化しない', (s) => s.replace('laps: (course && course.touge) ? 1 : laps, regime })', 'laps, regime })')],
    ['penaltySec を補わない', (s) => s.replace('penaltySec: cr.penaltySec != null ? cr.penaltySec : 3 }', 'penaltySec: cr.penaltySec }')],
    ['crashRule を共有オブジェクトにする', (s) => s.replace("const crashRule = { rejoin: !!cr.rejoin, penaltySec: cr.penaltySec != null ? cr.penaltySec : 3 };", 'const crashRule = SHARED_CR; SHARED_CR.rejoin = SHARED_CR.rejoin || !!cr.rejoin;').replace('export function resolveEventSpec(event, course) {', 'const SHARED_CR = { rejoin: false, penaltySec: 3 };\nexport function resolveEventSpec(event, course) {')],
  ];
  for (const [name, fn] of RE_MUT2) {
    const m = fn(RAW_RE);
    if (m === RAW_RE) { noop.push(name); continue; }
    const mod = await import(writeRe('g4_' + name.replace(/\W/g, '_') + '_' + RE_MUT2.findIndex((x) => x[0] === name), m));
    const log = console.log; console.log = () => {};
    let v; try { v = checkG2(mod.resolveEventSpec); } finally { console.log = log; }
    if (!v.length) miss.push(`${name} → G2 が見逃した`); else console.log(`     ✓ ${name} → G2 で ${v.length} 件の赤`);
  }
  report('G4) 見逃した変異', miss);
  report('G4) 適用できなかった変異（パターン腐り）', noop);
}

{
  const changed = [[RE_PATH, RAW_RE], [OFFICIAL, RAW_OFF], [UI_PATH, RAW_UI]].filter(([p, raw]) => fs.readFileSync(p, 'utf8') !== raw).map(([p]) => path.relative(ROOT, p));
  if (changed.length) { pass = false; console.log(`  ✗ ゲートの実行で ${changed.join(', ')} が変化した`); }
  else console.log('  ✓ public/js/race_event.js・wf_official_result.mjs・public/js/race_ui.js は実行前後で無変化');
}
for (const d of tmps) fs.rmSync(d, { recursive: true, force: true });

console.log('\n' + '='.repeat(78));
console.log(pass ? 'BI1 フィールド構成の決定論・ゲート: 全パス ○' : 'BI1 フィールド構成の決定論・ゲート: ✗ 不合格');
console.log('='.repeat(78));
process.exit(pass ? 0 : 1);
