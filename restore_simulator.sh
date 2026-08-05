#!/usr/bin/env bash
# rumicar-simulator コンテナ復旧スクリプト。
# 502 Bad Gateway (nginx の転送先 = simulator コンテナが消失) からの復旧用。
# 統合構成 (REBUILD.md 手順B) 向け。リポジトリのルートで実行する:
#   bash restore_simulator.sh
# 引数 --build を付けるとイメージ再ビルドも行う (配信設定を変えたとき等)。
# 前提ネットワークの確認・残骸コンテナの除去・起動待ち・疎通確認・コース数照合・
# CSS 反映確認まで行い、最後に一行で結果をまとめる。
set -euo pipefail

# スクリプト自身の位置から解決する。絶対パス固定だとクローン先が変わると動かないため
# (他サーバーへ移した際にここで詰まる)。
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="rumicar-simulator"
NET="rumicar-net"

# 疎通確認の入口。本コンテナはポートを publish せず rumicar-net 経由でのみ配信するため、
# 確認は「前段 nginx が公開している URL」に対して行う。既定は本番 (rumicar.com) の統合構成。
# 別構成なら環境変数で差し替える:  CHECK_URL=http://127.0.0.1:8090/simulator/ bash restore_simulator.sh
CHECK_URL="${CHECK_URL:-https://www.rumicar.com/simulator/}"

cd "$DIR"

echo "== 1. 前提確認 =="
# 外部ネットワークが無いと compose up が失敗するため確認 (無ければ作成)。
if ! docker network inspect "$NET" >/dev/null 2>&1; then
  echo "  $NET が無いので作成します"
  docker network create "$NET"
else
  echo "  $NET: OK"
fi

echo "== 2. 既存の simulator コンテナを掃除 =="
# 固定 container_name の停止済み残骸があると up が衝突するため先に除去。
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "  既存 $NAME を削除します"
  docker rm -f "$NAME"
else
  echo "  既存コンテナ無し: OK"
fi

echo "== 3. コンテナ起動 =="
if [ "${1:-}" = "--build" ]; then
  echo "  再ビルドして起動 (--build)"
  docker compose up -d --build
else
  echo "  既存イメージから起動"
  docker compose up -d
fi

echo "== 4. 起動待ち (最大 30 秒) =="
ok=""
for i in $(seq 1 15); do
  status="$(docker inspect -f '{{.State.Status}}' "$NAME" 2>/dev/null || echo none)"
  if [ "$status" = "running" ]; then ok="1"; break; fi
  sleep 2
done
if [ -z "$ok" ]; then
  echo "  起動を確認できませんでした。直近ログ:"
  docker logs --tail 30 "$NAME" 2>&1 || true
  exit 1
fi

echo "== 5. 疎通確認 =="
# 前段 nginx 経由で 200 が返るか。-k は自己署名証明書の検証環境でも確認できるようにするため。
code="$(curl -sk -o /dev/null -w '%{http_code}' "$CHECK_URL" || echo 000)"
echo "  $CHECK_URL -> $code"
if [ "$code" != "200" ]; then
  echo "  ※ 200 以外です。コンテナ自体は下の確認で判定できるため、前段 nginx 側"
  echo "     (rumicar-net への参加・/simulator/ の location) を疑ってください。"
  echo "     別構成なら CHECK_URL を指定してください。"
fi

# 前段に依存せず、simulator コンテナ自身の配信を直接確認する (ネットワーク内)。
echo "== 6. コース数確認 =="
# courses.json が read-only マウントで配信されているか。期待値は public/data/courses.json の実数。
expected="$(grep -o '"name"' "$DIR/public/data/courses.json" | wc -l | tr -d ' ')"
count="$(docker exec "$NAME" sh -c 'wget -qO- http://127.0.0.1/data/courses.json 2>/dev/null | grep -o "\"name\"" | wc -l' 2>/dev/null || echo '?')"
echo "  配信中のコース数: $count (期待値: $expected)"
if [ "$count" != "$expected" ]; then
  echo "  ※ 期待値と不一致です。public/ のマウントを確認してください。"
fi

echo "== 7. 新デザイン配信確認 =="
# モダン UI CSS (CSS 変数) が配信されているか。public 全体マウントなら即反映される。
if docker exec "$NAME" sh -c 'wget -qO- http://127.0.0.1/css/style.css 2>/dev/null | grep -q -- "--accent"'; then
  design="モダン版 OK"
else
  design="旧版 (CSS 未反映 — public マウントを確認)"
fi
echo "  $design"

echo ""
echo "復旧完了: $NAME は running、nginx 経由 HTTP=$code、コース数=$count/$expected、デザイン=$design"
echo "ブラウザで再読込 (キャッシュが残る場合はハードリロード) してください。"
