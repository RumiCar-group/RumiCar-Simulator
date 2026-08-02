// AP24: データ保全 — `rumicar.*` localStorage の一括エクスポート/インポート。
// 端末移行・ブラウザ更新・誤消去に備え、このブラウザに保存された全 `rumicar.*` キー
// (言語/テーマ/トグル・独自車種・組込上書き・自作コース・練習ベスト・作者名 等) を
// 1 ファイルに書き出し / 読み戻せるようにする。サーバーには一切送信しない。
//
// 本モジュールは DOM/物理に触れない純関数群 (storage は引数で受ける) = 卓上でヘッドレス検証可能。
// UI (ダウンロード/アップロード/確認ダイアログ) は main.js が本関数を呼んで配線する (関心分離)。

// バックアップ対象は接頭辞 `rumicar.` の全キー。個別列挙せず接頭辞で束ねるので、
// 将来キーが増えても (旧 `rumicar.best.*` 等の遺物も) 取りこぼさない。
export const BACKUP_PREFIX = 'rumicar.';
export const BACKUP_FORMAT = 'rumicar-backup';
export const BACKUP_VERSION = 1;

// storage から接頭辞一致キーを全収集し、キー昇順 (決定論) に並べた {key: value} を返す。
// 値は localStorage の生文字列そのまま (JSON パースしない = byte 同値復元のため)。
export function collectBackup(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith(BACKUP_PREFIX)) keys.push(k);
  }
  keys.sort();
  const data = {};
  for (const k of keys) data[k] = storage.getItem(k);
  return data;
}

// エクスポートファイル用の封筒 (メタ付き)。format/version で読込時に素性を確認できる。
export function makeBackupEnvelope(storage, appVersion) {
  const data = collectBackup(storage);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: String(appVersion || ''),
    count: Object.keys(data).length,
    data,
  };
}

// 封筒を検証し {key: stringValue} を取り出す (キー昇順)。不正なら Error を投げる。
// `rumicar.` 以外のキーは無視 (他アプリの混入を取り込まない安全側)。値は文字列必須。
export function parseBackup(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('backup: 形式が不正です');
  if (obj.format !== BACKUP_FORMAT) throw new Error('backup: format が一致しません');
  const src = obj.data;
  if (!src || typeof src !== 'object' || Array.isArray(src)) throw new Error('backup: data がありません');
  const keys = Object.keys(src).filter(k => k.startsWith(BACKUP_PREFIX)).sort();
  const out = {};
  for (const k of keys) {
    const v = src[k];
    if (typeof v !== 'string') throw new Error('backup: 値が文字列でありません (' + k + ')');
    out[k] = v;
  }
  return out;
}

// 適用前プレビュー。現在の storage と突き合わせ、キーを分類する:
//   collisions … 既存かつ値が異なる (上書き=要確認)   additions … 新規   identical … 既存で同値 (無変更)
export function previewImport(storage, data) {
  const collisions = [], additions = [], identical = [];
  for (const k of Object.keys(data)) {
    const cur = storage.getItem(k);
    if (cur === null) additions.push(k);
    else if (cur === data[k]) identical.push(k);
    else collisions.push(k);
  }
  return { total: Object.keys(data).length, collisions, additions, identical };
}

// import を適用する。opts.overwrite=false のとき衝突キー (既存と値が異なる) はスキップ。
// 返り値: {applied:[...], skipped:[...]} (いずれもキー昇順)。追加・同値は常に適用 (同値は書いても無害・byte 同一)。
export function applyImport(storage, data, opts) {
  const overwrite = !!(opts && opts.overwrite);
  const applied = [], skipped = [];
  for (const k of Object.keys(data).sort()) {
    const cur = storage.getItem(k);
    if (cur !== null && cur !== data[k] && !overwrite) { skipped.push(k); continue; }
    storage.setItem(k, data[k]);
    applied.push(k);
  }
  return { applied, skipped };
}
