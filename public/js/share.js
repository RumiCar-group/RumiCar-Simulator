// share.js — 設定共有パーマリンク基盤 (Stage AF / AF1)
// =====================================================================
// 「現在の設定」を 1 本の URL hash 文字列へ正規化・往復変換する純粋層。
//   encodeState(state) -> hashString   (副作用なし・決定論)
//   decodeState(hash)  -> state        (例外を投げない・不正/欠落は既定へ)
// UI 配線 (location.hash 読み書き・共有リンクコピー・自作物フォールバック通知) は
// AF2 で行う。本モジュールは DOM/localStorage/物理に一切触れない=卓上 byte 不変。
//
// 設計方針 (実装前固定・CI-7):
//  - 依存ゼロ (import なし)。本モジュールが「共有スキーマの単一ソース」。
//  - 対象は AF1 の最小確定セット 8 フィールド＋Stage AO の任意 4 フィールド
//    (physics/tire/recon/wear) ＋ Stage AS9 の 1 フィールド (gear) ＋ Stage AS11 の 1 フィールド
//    (susp) ＋ Stage AS12 の 1 フィールド (steerSet) ＋ Stage AV2 の 1 フィールド (brake)。
//    既定値は捕捉側 null=省略で既存 URL byte 不変 = 計 16 (下記 SHARE_FIELDS)。
//  - course/car/program/regime/theme/lang は「内容識別子」= 不透明な無害化文字列として
//    扱い、実在判定 (組込 id / 自作名の解決) と既定フォールバック+通知は AF2 が
//    レジストリ突き合わせで行う (AF2 受け入れ基準: 自作物は名前参照+フォールバック+通知)。
//  - laps は整数・noise は真偽として構造的に強制 (適用時の clamp は AF2/clampLaps)。
//  - 未知キー/将来追加は decode 時に無視 (後方互換)。
//  - 不正値/欠落フィールドは null = 「未指定」= AF2 は上書きしない (=アプリ既定のまま)。
//
// hash 書式 (自己記述・key=value を & で連結・各値は encodeURIComponent):
//   v=1&c=<course>&car=<carKey>&p=<progKey>&rg=<regime>&l=<laps>&n=<0|1>&th=<theme>&lg=<lang>
//   (任意・非既定時のみ) &ph=<physics>&tr=<tire>&rc=<recon>&we=<0|1>&gr=<gear>&sp=<susp>&ss=<steerSet>&bk=<brake>
//   先頭 'v' は将来のスキーマ移行用バージョン印 (decode は寛容に解釈)。

export const SHARE_VERSION = 1;

// 共有スキーマの単一ソース。name=状態キー / k=hash 短縮キー / type=構造型。
// 新フィールドはここに 1 行追加すれば encode/decode/正規化が自動追従する。
export const SHARE_FIELDS = [
  { name: 'course',  k: 'c',   type: 'str'  }, // コース: 組込 name か自作コース名
  { name: 'car',     k: 'car', type: 'str'  }, // 車種: 組込 key (normal_fr 等) か自作 key
  { name: 'program', k: 'p',   type: 'str'  }, // プログラム: サンプル key (comp_circuit 等)
  { name: 'regime',  k: 'rg',  type: 'str'  }, // 領域: tabletop|midscale|fullscale (AF2 で検証)
  { name: 'laps',    k: 'l',   type: 'int'  }, // 周回数 (適用時に 1..30 へ clamp)
  { name: 'noise',   k: 'n',   type: 'bool' }, // 実機ノイズ注入 ON/OFF
  { name: 'theme',   k: 'th',  type: 'str'  }, // テーマ: green|dark|light|glass|neon|paper|sunset|ocean|mono|lavender|carbon (AF2 で検証)
  { name: 'lang',    k: 'lg',  type: 'str'  }, // 言語: ja|en (AF2 で検証)
  { name: 'physics', k: 'ph',  type: 'str'  }, // 物理エンジン: standard|dynamic|v2 (Stage AO1・前方互換。既定 dynamic は捕捉側で null=省略ゆえ既存 hash byte 不変)
  { name: 'tire',    k: 'tr',  type: 'str'  }, // v2 タイヤセット: normal|slip|rain (Stage AO6/AS9・v2 専用。既定 normal は捕捉側で null=省略ゆえ既存 hash byte 不変)
  { name: 'recon',   k: 'rc',  type: 'int'  }, // 試走周回数 0..3 (Stage AO9・レース前の単独試走。既定 0 は捕捉側で null=省略ゆえ既存 hash byte 不変)
  { name: 'wear',    k: 'we',  type: 'bool' }, // タイヤ熱・摩耗 ON/OFF (Stage AO12・v2 専用の opt-in。既定 false は捕捉側で null=省略ゆえ既存 hash byte 不変)
  { name: 'gear',    k: 'gr',  type: 'str'  }, // ギア比: direct|short|tall|auto2 (Stage AS9・v2 専用の任意装備。既定 direct は捕捉側で null=省略ゆえ既存 hash byte 不変)
  { name: 'susp',    k: 'sp',  type: 'str'  }, // サス自由度: quasi|soft|balanced|stiff (Stage AS11・v2 専用の任意装備。既定 quasi は捕捉側で null=省略ゆえ既存 hash byte 不変)
  { name: 'steerSet',k: 'ss',  type: 'str'  }, // 操舵サーボ: tri|prop (Stage AS12・**全エンジン共通**の任意装備。既定 tri=実機準拠の3値は捕捉側で null=省略ゆえ既存 hash byte 不変。car.steerSet と同名にして「同じ値が意味の違う複数箇所」を作らない=api.js の world.steerSet も同名)
  { name: 'brake',   k: 'bk',  type: 'str'  }, // 制動装置: motor|friction|frictionFront|frictionRear (Stage AV2・v2 専用の任意装備。既定 motor=駆動軸のモーターブレーキは捕捉側で null=省略ゆえ既存 hash byte 不変)
];

const MAX_STR = 200; // 文字列値の上限長 (自作名の暴走/巨大 hash を防ぐ安全弁)。

// ---- 型ごとの構造的強制 (coerce)。妥当なら値、そうでなければ null。-------------
function coerceStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > MAX_STR ? s.slice(0, MAX_STR) : s;
}
function coerceInt(v) {
  if (v == null || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}
function coerceBool(v) {
  if (v === true || v === 1 || v === '1' || v === 'true') return true;
  if (v === false || v === 0 || v === '0' || v === 'false') return false;
  return null; // 'yes'/5/空/未定義 等は未指定扱い
}
function coerceByType(type, v) {
  if (type === 'int') return coerceInt(v);
  if (type === 'bool') return coerceBool(v);
  return coerceStr(v);
}

// 任意入力 → SHARE_FIELDS 全 16 キーを持つ正規化状態 (各キーは値 or null)。冪等。入力は変更しない。
export function normalizeState(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const out = {};
  for (const f of SHARE_FIELDS) out[f.name] = coerceByType(f.type, src[f.name]);
  return out;
}

// 値 → hash 用の素の文字列 (encodeURIComponent 前)。
function serializeVal(type, value) {
  if (type === 'bool') return value ? '1' : '0';
  return String(value);
}

// state -> hashString (先頭 '#' は付けない=付与は AF2)。副作用なし・決定論。
export function encodeState(state) {
  const n = normalizeState(state);
  const parts = ['v=' + SHARE_VERSION];
  for (const f of SHARE_FIELDS) {
    const value = n[f.name];
    if (value == null) continue; // 未指定は省略 (=既定)
    parts.push(f.k + '=' + encodeURIComponent(serializeVal(f.type, value)));
  }
  return parts.join('&');
}

// hashString -> state。例外を投げず、不正/欠落は null へフォールバック。未知キーは無視。
export function decodeState(hash) {
  if (hash == null) return normalizeState({});
  let s = String(hash);
  if (s.charAt(0) === '#') s = s.slice(1); // location.hash の先頭 '#' を許容
  if (s.charAt(0) === '!') s = s.slice(1); // '#!' 形式も許容
  const byShort = {};
  for (const f of SHARE_FIELDS) byShort[f.k] = f.name;
  const raw = {};
  for (const pair of s.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = eq < 0 ? pair : pair.slice(0, eq);
    const rawVal = eq < 0 ? '' : pair.slice(eq + 1);
    const name = byShort[key];
    if (!name) continue; // 'v' や未知キーは無視 (後方互換)
    let dec;
    try { dec = decodeURIComponent(rawVal); }
    catch (e) { continue; } // 不正な % シーケンスは当該ペアのみ捨てる (全体は壊さない)
    raw[name] = dec;
  }
  return normalizeState(raw);
}

// 適用すべきフィールド (非 null) が 1 つ以上あるか。AF2 が「hash 由来の設定あり」判定に使う。
export function hasShareState(state) {
  const n = normalizeState(state);
  return SHARE_FIELDS.some(f => n[f.name] != null);
}
