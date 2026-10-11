// ローカル開催・エントリー・フィールド成立 (Stage W / W4)。正準スペック docs/phase_w/W_spec.md
// §1 (イベント schema)・§2 (クラス spec/budget/open)・§3 (フィールド成立: 補充≥3・グリッド=エントリー順) の
// **純粋ロジック**実装。UI を持たず決定論的 (Math.random/Date 不使用)。W4 はローカル開催を実装し、
// 同じ validateEntry / formField を W5 (GitHub 公式) が再利用する (エントリー受理＝再実行検証で同検査)。
//
// 二層モデル (W_spec §0): 公式 (開催) はこのモジュール → race_engine.runRace で走り、練習記録
// (localStorage・W2) には一切混ざらない (runRace が persist:false で練習ベストを書かない)。
import { CAR_TYPE_BY_KEY, CAR_TYPE_DEFAULT } from './config.js';
import * as configNS from './config.js';   // BI3: 足した名前 (fillCarDef) は名前空間から「あれば使う」(BA1・キャッシュ混在)
import { PROGRAM_BY_KEY } from './programs.js';
import { computeRaceTimeout } from './race_engine.js';

// ============================================================================
// クラス (class) 規定 — W_spec §2。リーダーボードはクラス別 (複数の梯子)。
//  - spec  : 全車 specCar に固定 (純ロジック競争)。field 構築で carType を specCar に上書き。
//  - budget: cost(carDef) ≤ budget.total を満たすこと。超過エントリーは決定論的に弾く。
//  - open  : 無制約 (現行の「車種も自由」)。
// ============================================================================

// 車種キー or carDef → 解決済みパラメータ。CAR_TYPE_BY_KEY は組込/独自/community の runtime レイヤ
// (V1〜V4・組込上書き V3 も反映)。未知 key は既定 (ノーマル FR) にフォールバック。
// 【BI3・2026-10-11】key を持つ carDef は、公式レースが登録する定義 (config.js registerRaceCarTypes → _putCarType) と
//   同じ関数 fillCarDef で埋めた定義を返す＝コストを測る車と走る車が同じ。BI3 の前は maxSpeed の無い carDef を key の
//   車種表の値か既定車へ落としていた (表に無い key なら既定車のコストで受理され、レースは FR 土台とマージした定義で走った)。
//   key の無い carDef はここでは従来どおり解決する。ただしレースでは登録されない (registerRaceCarTypes は key の無い定義を飛ばす)
//   ので、validateEntry は key の無い carDef を測らず carType で測る。
//   fillCarDef の無い古い config.js と組み合わさったとき (キャッシュ混在) は従来の解決で測る。
function resolveCar(carRef) {
  if (carRef && typeof carRef === 'object' && carRef.key && typeof configNS.fillCarDef === 'function') {
    return configNS.fillCarDef(carRef, CAR_TYPE_BY_KEY);
  }
  if (carRef && typeof carRef === 'object' && carRef.maxSpeed != null) return carRef;     // full def
  const key = (carRef && typeof carRef === 'object') ? carRef.key : carRef;
  return CAR_TYPE_BY_KEY[key] || CAR_TYPE_BY_KEY[CAR_TYPE_DEFAULT];
}

// バランス (budget) クラスのコスト関数 (W_spec §2.2)。**性能を上げる方向にコスト**＝
// 最高速・加速・制動・グリップ(低 us/os)・軽量・ドリフト装備。基準からの差を正規化して加重和。
// ⚠ 初期 weight は仮置き (W_spec §11)。運用でリーダーボードの支配ビルドを検知して再調律する
// (構造は固定・値は調整可)。決定論的 (純算術・Math.random/Date 不使用)。
const clamp01 = (x) => Math.max(0, Math.min(1, x));
export function costOf(carRef) {
  const c = resolveCar(carRef);
  let cost = 0;
  cost += 30 * clamp01((c.maxSpeed - 0.85) / 0.35);            // 最高速 0.85..1.20
  cost += 22 * clamp01((c.accel - 0.85) / 0.55);              // 加速 0.85..1.40
  cost += 12 * clamp01((c.brake - 0.85) / 0.40);             // 制動
  cost += 20 * clamp01((0.50 - c.us) / 0.50);                // アンダー小=グリップ高=高コスト
  cost += 8 * clamp01((0.30 - Math.abs(c.os || 0)) / 0.30);  // |os| 小
  cost += 18 * clamp01((1500 - c.mass) / 500);               // 軽い=高コスト (重い=安い)
  if (c.drift) cost += 12;                                    // ドリフト装備
  return Math.round(cost);
}

// エントリー検証 (決定論)。entry = { name, lang, src, carType, carDef? }。
// 戻り値: { ok, reason?, cost?, total?, need? }。**W4 のエントリー受理と W5 の再実行検証の両方で適用**。
export function validateEntry(event, entry) {
  const cls = (event && event.class) || 'open';
  if (cls === 'spec') {
    // 規定車固定: エントリーの車は無視され field 構築で specCar に固定される (純ロジック競争)。
    // ⇒ 受理は常に ok (car は強制される)。enforcement の実体は formField の carType 上書き。
    return { ok: true, forced: event.specCar || null };
  }
  if (cls === 'budget') {
    const total = (event.budget && event.budget.total != null) ? event.budget.total : 100;
    // BI3: レースが登録する carDef は key のあるものだけ (config.js registerRaceCarTypes)。key の無い carDef は登録されず、
    //   その車は carType の車種で走る (race_engine.js のスロット生成) ので、carType で測る (BI3 の前は使われない carDef で測っていた)。
    const def = entry.carDef;
    const cost = costOf((def && typeof def === 'object' && def.key) ? def : entry.carType);
    return cost <= total ? { ok: true, cost, total } : { ok: false, reason: 'budget', cost, total };
  }
  return { ok: true };   // open
}

// コース別キュレーション固定プール (W_spec §3・決定論・順序付き)。フィールドが minField 未満の
// とき先頭から順に補充する。まずはどのコースでも完走を狙える汎用の競技プログラム×組込車を既定
// プールとする (コース別の細分化は運用で拡張・W_spec §3/§9)。
// **AS5 較正 (2026-08-04・実測)**: 旧プール (comp_circuit を2枠) は comp_circuit 単体で 39 コース中
// 10 完走 (実測) しかない「フルスケール競技サーキット専用チューン」のプログラムで、"どのコースでも
// 完走を狙える" という設計意図に反していた。5台グループ走行の population 実測=完走ペア 195中79
// (40.5%)・1台以上完走コース 34/39。**AS3 で頑健化した3本 (normal_fr/awd/ff) と、単体実測で同等に
// 頑健な drift 系2本 (drift_awd/ff) へ差し替え**(全5本とも組込 carType と一致=プログラムの車種別
// チューニング前提を崩さない)。差替後の population 実測=完走ペア 195中115 (59.0%)・1台以上完走コース
// 37/39・全5台完走コース 1→4/39 (母集団述語・Stage AS 共通測定作法=コース別0/1で受け入れ基準を書かない)。
export const FILLER_POOL = [
  { name: 'BOT-1', progKey: 'normal_fr',  carType: 'normal_fr' },
  { name: 'BOT-2', progKey: 'normal_awd', carType: 'normal_awd' },
  { name: 'BOT-3', progKey: 'normal_ff',  carType: 'normal_ff' },
  { name: 'BOT-4', progKey: 'drift_awd',  carType: 'drift_awd' },
  { name: 'BOT-5', progKey: 'drift_ff',   carType: 'drift_ff' },
];

// 補充車 1 台を field エントリー形に展開。
// f.program.src (文字列) があれば**それをそのまま使う**(公式記録に凍結された本文=AS5)。
// 無ければ f.progKey で**現在の** PROGRAM_BY_KEY から都度解決する (ローカル/暫定イベント向け・未凍結)。
export function fillerEntry(f) {
  if (f.program && typeof f.program.src === 'string') {
    return { name: f.name, lang: f.program.lang || 'c', src: f.program.src, carType: f.carType, filler: true };
  }
  const prog = PROGRAM_BY_KEY[f.progKey];
  return { name: f.name, lang: 'c', src: prog ? prog.code : '', carType: f.carType, filler: true };
}

// FILLER_POOL (または任意の pool) を W_spec §1 event.fillerPool の schema (program.src 凍結済み) へ
// 変換する。GitHub 公式イベント (W5) の event.json 作成時に埋め込む用 (人間 CI-11)。埋め込んだ
// event.fillerPool を formField/frozenField が優先して使うため、以後 programs.js の該当プログラムが
// 改良されても**この記録の再検証結果は変わらない**(補充車もエントリーと同じく本文が凍結される。
// AS3 決定ログの持ち越し課題=補充車だけ凍結されない問題への対処)。
export function freezeFillerPool(pool = FILLER_POOL) {
  return pool.map((f) => {
    const prog = PROGRAM_BY_KEY[f.progKey];
    return { name: f.name, program: { src: prog ? prog.code : '', lang: 'c' }, carType: f.carType };
  });
}

// フィールド成立 (W_spec §3)。entries (エントリー順) に不足分を filler 先頭から決定論補充して
// ≥ minField(既定3) にし、グリッド=エントリー順 (filler は末尾) の field 配列を返す。
// spec クラスは全車を specCar に固定する (carType 上書き・carDef 無視)。
// **event.fillerPool があればそれを使う**(凍結済み・公式記録の再検証で確定挙動)。無ければ
// 生きた既定 FILLER_POOL へフォールバック (ローカル開催・未凍結の暫定イベント向け・後方互換)。
export function formField(event, entries) {
  const minField = (event && event.minField) || 3;
  const pool = (event && Array.isArray(event.fillerPool) && event.fillerPool.length) ? event.fillerPool : FILLER_POOL;
  const field = entries.map((e) => ({ ...e }));
  for (let i = 0; field.length < minField && i < pool.length; i++) {
    field.push(fillerEntry(pool[i]));
  }
  if (event && event.class === 'spec' && event.specCar) {
    for (const f of field) { f.carType = event.specCar; f.carDef = undefined; }
  }
  return field;
}

// ============================================================================
// W5 (GitHub 公式開催) — 締切時の確定エントリー列から「再実行用フィールド」を決定論的に組む。
// イベント schema (W_spec §1) のエントリー {name, author, program:{src,lang}, carDef, submittedAt} を
// runRace の field 形 {name, lang, src, carType, carDef} へ正規化し、**締切 (entryWindow.close) より後の
// submittedAt を除き** → **グリッド=エントリー順** を submittedAt 昇順 (タイブレーク author→name→本文) で復元 →
// validateEntry でクラス規定違反を弾き → formField で filler 補充。**純関数・決定論** (Math.random/Date 不使用・
// ロケールにもタイムゾーンにも依存しない) なので、ブラウザの「ローカル再実行 (参考)」と pinned Node の「公式検証」が
// 必ず同一 field を再構成する (= 誰でも同じ入力から同じ結果を再現できる＝公式記録が成立する根拠・W_spec §5/§7)。
//
// 【BI1・2026-10-11】フィールド構成の決定論を 3 点直した (常設ゲート wf_bi1_field.mjs が見張る):
//   ① 並べ替えの比較を、ロケール依存の照合から文字列の `<`/`>` (UTF-16 の符号単位の大小) へ変えた。旧実装は
//      同時刻 submittedAt のタイブレーク (author) を検証する人の既定ロケールで並べていたため、同じ entries から
//      別のグリッドができえた (実測: LANG=tr_TR では 'i'/'I'/'ı'/'İ' の並びが LANG=C・ja_JP と異なる)。
//      このファイルではロケール・タイムゾーン・実行環境に依存する API を使わない (ゲートの A 章が語を数える)。
//   ② タイブレークを author→name→本文まで延ばした。旧実装は (submittedAt, author||name) が同じエントリーを
//      **入力順のまま**残したので、エントリーの取得順 (ブラウザ=GitHub の一覧順・Node=束の並び) が違えば
//      グリッドが変わりえた。いまは内容が完全に同じエントリーどうしだけが入力順に残る (同じ車なので入れ替わっても同じ)。
//   ③ entryWindow.close より後の submittedAt のエントリーを field に入れない (W_spec §1「締切時の確定エントリー列」)。
//      close と同時刻は入る。close が未記載 (欄が無い・空文字) なら従来どおり全件。時刻は下の parseInstant が
//      **タイムゾーン付きの ISO 8601 だけ**を読む (オフセット無しの日時は実行環境の地方時で解釈が変わるので読まない)。
//      close があるとき、時刻として読めない submittedAt のエントリーは「締切までに出した」と言えないので入れない。
//      close が書かれているのに読めない event は、生成側 (wf_official_result.mjs) が受け付けない (exit 2)。
//      ここ (frozenField) では未記載と同じに扱う (ブラウザの開催状態 raceStatus も Date.parse で読めない close を
//      「締切なし」と見る。オフセット無しの close だけは raceStatus が地方時で読むので解釈が分かれるが、生成側が
//      受け付けないので公式記録にはならない)。
// ============================================================================

// 文字列の大小 (UTF-16 の符号単位の順)。ロケールに依存しない。
const cmpStr = (x, y) => (x < y ? -1 : (x > y ? 1 : 0));

// タイムゾーン付きの ISO 8601 日時 → { ms: UTC の整数ミリ秒, sub: ミリ秒より下の桁 (末尾の 0 を除いた数字列) }。
// 読めなければ null。日付と時刻は値の範囲まで検査する (2 月 30 日・24 時・60 秒・オフセット 24 時間以上は読まない)。
// 暦の計算は整数演算 (先発グレゴリオ暦の日数) で行い、組込の日付 API を使わない＝どの実行環境でも同じ値になる。
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:(Z)|([+-])(\d{2}):(\d{2}))$/;
function daysFromCivil(y, m, d) {
  const yy = y - (m <= 2 ? 1 : 0);
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;   // 1970-01-01 からの日数
}
function parseInstant(s) {
  if (typeof s !== 'string') return null;
  const m = ISO_INSTANT.exec(s);
  if (!m) return null;
  const Y = Number(m[1]), Mo = Number(m[2]), D = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
  const sec = m[6] != null ? Number(m[6]) : 0;
  if (Mo < 1 || Mo > 12 || D < 1 || h > 23 || mi > 59 || sec > 59) return null;
  const leap = (Y % 4 === 0 && Y % 100 !== 0) || Y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Mo - 1];
  if (D > dim) return null;
  let off = 0;
  if (!m[8]) {
    const oh = Number(m[10]), om = Number(m[11]);
    if (oh > 23 || om > 59) return null;
    off = (m[9] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  const frac = m[7] || '';
  const msFrac = Number((frac + '000').slice(0, 3));
  const sub = frac.slice(3).replace(/0+$/, '');
  const ms = ((daysFromCivil(Y, Mo, D) * 24 + h) * 60 + mi - off) * 60000 + sec * 1000 + msFrac;
  return { ms, sub };
}
function cmpInstant(a, b) {
  if (a.ms !== b.ms) return a.ms < b.ms ? -1 : 1;
  const n = Math.max(a.sub.length, b.sub.length);
  return cmpStr(a.sub.padEnd(n, '0'), b.sub.padEnd(n, '0'));
}

// 締切 (event.entryWindow.close) の解釈。
//   { kind: 'none' }           … 未記載 (entryWindow が無い・close が無い／null／空文字) ＝ 全件 (後方互換)
//   { kind: 'at', at }         … タイムゾーン付きの ISO 8601 日時 ＝ これより後の submittedAt を除く
//   { kind: 'invalid', raw }   … 書かれているが読めない (生成側 wf_official_result.mjs はこの event を受け付けない)
export function entryClose(event) {
  const w = event && event.entryWindow;
  const raw = (w && typeof w === 'object') ? w.close : undefined;
  if (raw == null || raw === '') return { kind: 'none' };
  const at = parseInstant(raw);
  return at ? { kind: 'at', at } : { kind: 'invalid', raw };
}

// エントリー (W_spec §1 schema) → runRace field エントリー形へ正規化。
function normEntry(e) {
  const carDef = (e.carDef && typeof e.carDef === 'object') ? e.carDef : null;
  return {
    name: e.name, author: e.author,
    lang: (e.program && e.program.lang) || e.lang || 'c',
    src: (e.program && e.program.src) || e.src || '',
    carType: carDef ? (carDef.key || e.carType) : e.carType,
    carDef: carDef || undefined,
    submittedAt: e.submittedAt || '',
  };
}

// グリッド順: submittedAt (書かれた文字列のまま) → author (無ければ name) → name → 本文 (lang・src・carType・carDef)。
// 最初の 2 段は旧実装と同じ鍵 (比較だけをロケール非依存にした)。submittedAt を時刻へ直さずに文字列で比べるのは
// 旧実装と同じで、エントリー画面が書く toISOString() の形 (UTC・ミリ秒 3 桁・Z) どうしなら時刻順と一致する。
const tieKey = (e) => JSON.stringify([e.lang, e.src, e.carType, e.carDef == null ? null : e.carDef]);
function cmpEntry(a, b) {
  return cmpStr(String(a.submittedAt), String(b.submittedAt))
    || cmpStr(String(a.author || a.name || ''), String(b.author || b.name || ''))
    || cmpStr(String(a.name == null ? '' : a.name), String(b.name == null ? '' : b.name))
    || cmpStr(tieKey(a), tieKey(b));
}

export function frozenField(event, entries) {
  const close = entryClose(event);
  const onTime = (e) => {
    if (close.kind !== 'at') return true;            // 未記載 (と読めない close) は全件
    const t = parseInstant(e.submittedAt);
    return t != null && cmpInstant(t, close.at) <= 0;   // 締切と同時刻は入る・時刻として読めない submittedAt は入らない
  };
  const ordered = [...(entries || [])].map(normEntry).filter(onTime).sort(cmpEntry);
  const valid = ordered.filter((e) => validateEntry(event, e).ok);
  return formField(event, valid);
}

// ============================================================================
// 【BI2・2026-10-11】大会 (event.json) の欠落欄の既定を、この 1 関数だけが持つ。
//   公式記録を作る側 (wf_official_result.mjs の runOfficial) と確かめる側 (race_ui.js の verifyOfficialLocally・
//   👻 ゴースト対戦 ghostVsWorld) が、event から runRace の spec を組むときに必ずここを通る。BI2 の前は 3 か所が
//   それぞれ既定を書いており、次の 2 点で食い違っていた (同じ event から別の結果になりえた):
//     ・maxSec が無い event: 作る側は runRace に渡さず runRace が computeRaceTimeout で決め、確かめる側は固定 180 秒を渡した
//       (コースが大きい・周回が多いと 180 秒を超えるので、作る側で完走した車が確かめる側で timeout になる)。
//     ・regime が無い event: 作る側も確かめる側も null を渡し、runRace は領域を切り替えずに「その時点の領域」で走った。
//       Node の起動直後は卓上 (config.js の REGIME_STATE の初期値) だが、ブラウザは利用者が選んでいる領域になる。
//   既定値 (欄が無いとき。laps・regime・physicsMode は null・0・空文字も欄なしと同じに読む。maxSec・penaltySec は null だけを欄なしと読み、0 は 0):
//     laps      … 3 (整数へ丸め、1 未満は 1)。      regime   … 'tabletop' (REGIME_STATE の初期値と同じ値を明示する)
//     crashRule … { rejoin: false, penaltySec: 3 }。 rejoin は真偽へ、penaltySec は欠けていれば 3 で補う (runRace と同じ読み方)。
//     interact  … true (false と書いたときだけ独立走行)。
//     maxSec    … computeRaceTimeout({ course, laps, regime })。laps は runRace と同じく峠 (course.touge) なら 1 本
//                 (runRace が maxSec を受け取らなかったときに自分で出す値と同じ＝BI2 の前の作る側と同じ値)。
//     physics   … event.physicsMode が無ければ 'dynamic'。  recon … event.recon が正のときだけ { laps }。  wear … 真偽。
//   course は runRace に渡すのと同じコースの物 (maxSec の算出だけに使う)。返す物は毎回新しい (呼び出し側が書き換えてよい)。
export function resolveEventSpec(event, course) {
  const ev = (event && typeof event === 'object') ? event : {};
  const laps = Math.max(1, Math.round(ev.laps || 3));
  const regime = ev.regime || 'tabletop';
  const cr = (ev.crashRule && typeof ev.crashRule === 'object') ? ev.crashRule : {};
  const crashRule = { rejoin: !!cr.rejoin, penaltySec: cr.penaltySec != null ? cr.penaltySec : 3 };
  const interact = ev.interact !== false;
  const maxSec = ev.maxSec != null ? ev.maxSec
    : computeRaceTimeout({ course, laps: (course && course.touge) ? 1 : laps, regime });
  const physics = ev.physicsMode || 'dynamic';
  const recon = ev.recon > 0 ? { laps: ev.recon } : null;
  const wear = !!ev.wear;
  return { laps, regime, crashRule, interact, maxSec, physics, recon, wear };
}
