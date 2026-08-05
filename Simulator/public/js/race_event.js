// ローカル開催・エントリー・フィールド成立 (Stage W / W4)。正準スペック docs/phase_w/W_spec.md
// §1 (イベント schema)・§2 (クラス spec/budget/open)・§3 (フィールド成立: 補充≥3・グリッド=エントリー順) の
// **純粋ロジック**実装。UI を持たず決定論的 (Math.random/Date 不使用)。W4 はローカル開催を実装し、
// 同じ validateEntry / formField を W5 (GitHub 公式) が再利用する (エントリー受理＝再実行検証で同検査)。
//
// 二層モデル (W_spec §0): 公式 (開催) はこのモジュール → race_engine.runRace で走り、練習記録
// (localStorage・W2) には一切混ざらない (runRace が persist:false で練習ベストを書かない)。
import { CAR_TYPE_BY_KEY, CAR_TYPE_DEFAULT } from './config.js';
import { PROGRAM_BY_KEY } from './programs.js';

// ============================================================================
// クラス (class) 規定 — W_spec §2。リーダーボードはクラス別 (複数の梯子)。
//  - spec  : 全車 specCar に固定 (純ロジック競争)。field 構築で carType を specCar に上書き。
//  - budget: cost(carDef) ≤ budget.total を満たすこと。超過エントリーは決定論的に弾く。
//  - open  : 無制約 (現行の「車種も自由」)。
// ============================================================================

// 車種キー or 完全 def → 解決済みパラメータ。CAR_TYPE_BY_KEY は組込/独自/community の runtime レイヤ
// (V1〜V4・組込上書き V3 も反映)。未知 key は既定 (ノーマル FR) にフォールバック。
function resolveCar(carRef) {
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
    const cost = costOf(entry.carDef || entry.carType);
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
// runRace の field 形 {name, lang, src, carType, carDef} へ正規化し、**グリッド=エントリー順** を
// submittedAt 昇順 (タイブレーク author→name) で復元 → validateEntry でクラス規定違反を弾き →
// formField で filler 補充。**純関数・決定論** (Math.random/Date 不使用) なので、ブラウザの
// 「ローカル再実行 (参考)」と pinned Node の「公式検証」が必ず同一 field を再構成する
// (= 誰でも同じ入力から同じ結果を再現できる＝公式記録が成立する根拠・W_spec §5/§7)。
// ============================================================================

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

export function frozenField(event, entries) {
  const ordered = [...(entries || [])].map(normEntry).sort((a, b) =>
    String(a.submittedAt).localeCompare(String(b.submittedAt)) ||
    String(a.author || a.name || '').localeCompare(String(b.author || b.name || '')));
  const valid = ordered.filter((e) => validateEntry(event, e).ok);
  return formField(event, valid);
}
