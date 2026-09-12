#!/usr/bin/env bash
# 実ブラウザゲートの一括実行。
#
# なぜ要るのか: `wf_run_all.mjs` は **node_modules 不要** であることがフレッシュクローン検証の
# 前提なので、Playwright に依存する browser/check_*.mjs をそこへ載せられない。その結果
# 「どの runner からも呼ばれない検証」になり、実ブラウザでしか捕まらない退行
# (例: 投稿先 endpoint を戻す・submitToGithub から window.open を消す) を取りこぼす。
# 1 コマンドで全部回せる入口をここに置いて、その穴を塞ぐ。
#
#   bash browser/run_all.sh            # 全 check_*.mjs
#   bash browser/run_all.sh check_smoke.mjs check_az1_submit.mjs   # 指定だけ
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

# check_vnc.mjs は **VNC セッションが上がっているときだけ**意味がある検査で、
# 本サーバーの運用は「VNC は既定で落としておく」(README・2026-08-03 利用者決定)。
# 既定の一括実行に入れると必ず赤になり、ランナー全体が信用されなくなるので既定から外す。
# VNC を検証したいときは名前を明示する: bash run_all.sh check_vnc.mjs (先に vnc.sh start)
SKIP_BY_DEFAULT="check_vnc.mjs"
if [ "$#" -gt 0 ]; then
  CHECKS=("$@")
else
  mapfile -t CHECKS < <(ls check_*.mjs | grep -vxF "$SKIP_BY_DEFAULT" | sort)
  printf '既定から除外: %s (VNC は既定で停止。検証するには先に bash vnc.sh start)\n' "$SKIP_BY_DEFAULT"
fi

pass=0; fail=0; failed=()
printf '実ブラウザゲート: %d 本\n' "${#CHECKS[@]}"
printf '%s\n' "────────────────────────────────────────────────────────────"
for c in "${CHECKS[@]}"; do
  printf '[%s] ... ' "$c"
  if out="$(bash run.sh "$c" 2>&1)"; then
    printf '✓\n'; pass=$((pass+1))
  else
    printf '✗\n'; fail=$((fail+1)); failed+=("$c")
    printf '%s\n' "$out" | tail -15 | sed 's/^/    /'
  fi
done
printf '%s\n' "────────────────────────────────────────────────────────────"
printf '集計: PASS %d / FAIL %d / 全 %d 本\n' "$pass" "$fail" "${#CHECKS[@]}"
[ "$fail" -eq 0 ] || { printf '失敗: %s\n' "${failed[*]}"; exit 1; }
printf '結果: PASS (全実ブラウザゲート緑)\n'
