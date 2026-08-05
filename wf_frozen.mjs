// wf_frozen.mjs — 凍結回帰ハッシュ中央マニフェストの共有リーダ (Stage AP3・単一の真実源)。
// 5 参照ゲート (wf_ab8_bench / wf_ak5_robustness / wf_ao5_calib / wf_collision_model /
// wf_recover_model) はこのモジュール経由で凍結値を読む。ハードコード撤廃により、物理を
// 意図的に変えた版の刻み直しが「5 ファイル手編集」→「wf_refreeze.mjs 1 回＋人間承認」になる。
// 本モジュール自体は凍結ハッシュのリテラルを一切持たない (全て JSON 由来)。
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MANIFEST_PATH = join(HERE, 'wf_frozen_manifest.json');
export const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

// 現在版の凍結値 { f0, f1, f2, f3 } — ゲートはこれと実測 verifyHash を照合する。
export const FROZEN = MANIFEST.current.hashes;
export const FROZEN_META = MANIFEST.current.meta;
export const FROZEN_VER = MANIFEST.current.appVersion;
export const FROZEN_STAMPED_AT = MANIFEST.current.stampedAt;

// 参照整合性の軽量ガード (壊れたマニフェスト早期検出)。
for (const k of ['f0', 'f1', 'f2', 'f3']) {
  if (!/^[0-9a-f]{8}$/.test(FROZEN[k] || '')) {
    throw new Error(`wf_frozen_manifest.json: current.hashes.${k} が 8桁hex でない (実 ${FROZEN[k]})`);
  }
}
