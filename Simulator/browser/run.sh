#!/usr/bin/env bash
# RumiCar Simulator — 実ブラウザ(非ヘッドレス)検証の起動ラッパ。
#
# これがやること:
#   ① 検証対象 URL を解決して RC_URL に入れる
#        既定 = 本番配信コンテナ rumicar-simulator を docker から直接引く
#        (public/ は bind mount なので編集→再読込で即反映。ポート公開も外部通信も要らない)
#        コンテナが無ければ公開 URL へフォールバック。RC_URL を明示指定すればそれを使う。
#   ② 実ディスプレイ上で node を実行する (headed Chrome には実ディスプレイが要る)
#        vnc.sh のセッションが上がっていればそれに相乗りする（＝人が同じ画面を見られる）。
#        上がっていなければ使い捨ての xvfb-run を使う。
#
# 使い方:
#   bash run.sh check_smoke.mjs                 # 既定 1440x900
#   RC_SCREEN=1920x1080x24 bash run.sh foo.mjs  # 画面サイズを変える
#   RC_URL=https://www.rumicar.com/simulator/ bash run.sh foo.mjs
#   RC_DISPLAY=:99 bash run.sh foo.mjs          # 既存ディスプレイを明示指定
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

[ -d node_modules/playwright ] || {
  echo "✗ node_modules がありません。先に実行してください:" >&2
  echo "    cd \"$HERE\" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install" >&2
  exit 1
}
command -v xvfb-run >/dev/null || { echo "✗ xvfb-run がありません (Xvfb 未導入)。" >&2; exit 1; }

# 移設先ではコンテナ名と公開 URL だけ変えれば済むよう外出しする。
RC_CONTAINER="${RC_CONTAINER:-rumicar-simulator}"
RC_FALLBACK_URL="${RC_FALLBACK_URL:-https://www.rumicar.com/simulator/}"

if [ -z "${RC_URL:-}" ]; then
  ip="$(docker inspect "$RC_CONTAINER" \
        --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null || true)"
  if [ -n "$ip" ]; then
    RC_URL="http://$ip/"
  else
    RC_URL="$RC_FALLBACK_URL"
    echo "! コンテナ $RC_CONTAINER が見つからないため $RC_FALLBACK_URL を使います。" >&2
  fi
fi
export RC_URL
echo "対象: $RC_URL"

# vnc.sh のセッションが生きていれば相乗りする（人が同じ画面を見ている状態で走らせるため）。
# RC_FRESH=1 で相乗りを拒否する（VNC 画面そのものをブラウザで検証するときに使う。
# :99 の noVNC を :99 のブラウザで開くと合わせ鏡になるため）。
VNC_RUNDIR="${XDG_RUNTIME_DIR:-/tmp}/rumicar-vnc"
if [ -z "${RC_DISPLAY:-}" ] && [ "${RC_FRESH:-0}" != "1" ] && [ -f "$VNC_RUNDIR/xvfb.pid" ] \
   && kill -0 "$(cat "$VNC_RUNDIR/xvfb.pid")" 2>/dev/null; then
  RC_DISPLAY=":99"
fi

if [ -n "${RC_DISPLAY:-}" ]; then
  echo "画面: $RC_DISPLAY (既存セッションに相乗り＝VNC で見えます)"
  exec env DISPLAY="$RC_DISPLAY" node "$@"
fi

echo "画面: 使い捨て Xvfb (VNC で見るには先に bash vnc.sh start)"
exec xvfb-run -a --server-args="-screen 0 ${RC_SCREEN:-1440x900x24}" node "$@"
