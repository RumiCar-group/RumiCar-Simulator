#!/usr/bin/env bash
# RumiCar Simulator — 「人が同じ画面を見る」ための VNC セッション管理。
#
# 何のためにあるか
#   検証ドクトリン(CI-14)で機械化できずに残る札は「人にどう映るか」だけ。
#   その札を、スクリーンショット越しでなく **Claude が今まさに動かしている当のブラウザ** で
#   人が直接見て確認できるようにする。見る/操作するのは同一の X ディスプレイ。
#
# 構成 (すべて 127.0.0.1 に束縛する。外部には一切公開しない)
#   Xvfb :99        仮想ディスプレイ
#   x11vnc          :99 を VNC で配信 (-localhost + パスワードファイル)
#   websockify      noVNC (ブラウザだけで見られる) を 127.0.0.1:6080 で提供
#
# 見る側 (手元の PC) の手順
#   ssh -N -L 6080:127.0.0.1:6080 <このホスト>
#   → 手元のブラウザで http://127.0.0.1:6080/vnc.html を開く
#
# 使い方
#   bash vnc.sh start | status | stop
#   セッションが上がっている間は run.sh が自動でそのディスプレイを使う (RC_DISPLAY 不要)。
#
# 運用方針 (2026-08-03 利用者決定) —— **既定は「落ちている」**
#   VNC は「人が Claude の操作を目で見て確認する必要があるとき」だけ上げる。
#   常設しない。用が済んだら必ず `bash vnc.sh stop` で落とす。攻撃面(待受ポート・
#   X ディスプレイ・クリップボード経路)を、必要な時間だけに限るのが目的。
#   落ちていても検証は止まらない: run.sh は使い捨て Xvfb にフォールバックする
#   (人が見られないだけで、機械検証の結果は同じ)。
set -uo pipefail

DISP="${RC_DISPLAY:-:99}"
GEOM="${RC_SCREEN:-1440x900x24}"
VNC_PORT="${RC_VNC_PORT:-5900}"
WEB_PORT="${RC_WEB_PORT:-6080}"
PWFILE="$HOME/.config/rumicar/vncpasswd"
RUNDIR="${XDG_RUNTIME_DIR:-/tmp}/rumicar-vnc"
mkdir -p "$RUNDIR"

say() { printf '%s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null || {
    say "✗ $1 が見つかりません。導入は sudo が要るため利用者にお願いしています:"
    say "    sudo apt install -y x11vnc novnc websockify"
    exit 1
  }
}

pidof_file() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null && cat "$1"; }

start() {
  need Xvfb; need x11vnc; need websockify

  # ── 認証方式 ────────────────────────────────────────────────────────────
  # 既定は **パスワードなし** (RC_VNC_AUTH=none)。
  #   このセッションは 127.0.0.1 にしか出ていないので、到達できる者＝先に SSH 認証を
  #   通した者に限られる。VNC パスワードはその上に重ねるもう一段だが、
  #   ・プロトコル上 8 文字までしか効かない (DES 鍵長)
  #   ・x11vnc の保存形式が難読化バイナリで人が読めない
  #   という制約から取り違えが起きやすく、実際に接続できない事故だけを生んだ。
  #   **守りの主体は loopback 束縛と SSH 認証**であり、そこは status で毎回実測する。
  # RC_VNC_AUTH=password にすると従来どおり平文8文字のパスワードを使う。
  AUTH_ARGS=(-nopw)
  if [ "${RC_VNC_AUTH:-none}" = "password" ]; then
    if [ ! -f "$PWFILE" ] || file -b "$PWFILE" | grep -q '^data'; then
      mkdir -p "$(dirname "$PWFILE")"; chmod 700 "$(dirname "$PWFILE")"
      [ -f "$PWFILE" ] && mv "$PWFILE" "$PWFILE.obfuscated.bak"
      umask 077
      # ちょうど 8 文字 = VNC の実効長。紛らわしい字 (0/O/1/l/I) は除く。
      tr -dc 'A-HJ-NP-Za-km-z2-9' < /dev/urandom | head -c 8 > "$PWFILE"
      printf '\n' >> "$PWFILE"
      chmod 600 "$PWFILE"
    fi
    AUTH_ARGS=(-passwdfile "$PWFILE")
  fi

  if [ -z "$(pidof_file "$RUNDIR/xvfb.pid")" ]; then
    Xvfb "$DISP" -screen 0 "$GEOM" -nolisten tcp >"$RUNDIR/xvfb.log" 2>&1 &
    echo $! > "$RUNDIR/xvfb.pid"; sleep 1
  fi
  if [ -z "$(pidof_file "$RUNDIR/x11vnc.pid")" ]; then
    # -localhost = 127.0.0.1 のみ待受。-forever = 切断後も生き続ける。
    # -localhost が安全性の要 (外部インタフェースに出さない)。status で毎回実測する。
    #
    # ── クリップボード共有は無効 (2026-08-03 利用者決定) ──────────────────
    # x11vnc の既定は **双方向で共有する**。この経路は VNC を「見るため」に上げた
    # だけのつもりでも、見る側 PC のクリップボード (パスワード・トークンを載せがち)
    # とサーバー側の X セレクションを勝手に往復させる。用途は「画面を見る」なので
    # クリップボードは要らない ＝ 要らない経路は開けない。
    #   -nosel           セレクション/カットバッファの授受を一切行わない (傘)
    #   -noclipboard     CLIPBOARD を読んでクライアントへ送らない (サーバー → 見る側)
    #   -nosetclipboard  クライアントから受けた文字列で CLIPBOARD を書かない (見る側 → サーバー)
    #   -noprimary/-nosetprimary  同じことを PRIMARY (X の中クリック貼付) について
    # 傘の -nosel だけでも足りるが、版差で意味がずれても穴が開かないよう両方向を明示する。
    # 実際に無効かは check_vnc.mjs の ④ が起動中プロセスの引数で毎回実測する。
    CLIP_ARGS=(-nosel -noclipboard -nosetclipboard -noprimary -nosetprimary)
    x11vnc -display "$DISP" -rfbport "$VNC_PORT" -localhost -forever -shared \
           "${CLIP_ARGS[@]}" "${AUTH_ARGS[@]}" -quiet >"$RUNDIR/x11vnc.log" 2>&1 &
    echo $! > "$RUNDIR/x11vnc.pid"; sleep 1
  fi
  if [ -z "$(pidof_file "$RUNDIR/web.pid")" ]; then
    web=/usr/share/novnc
    [ -d "$web" ] || web=""
    websockify ${web:+--web="$web"} "127.0.0.1:$WEB_PORT" "127.0.0.1:$VNC_PORT" \
               >"$RUNDIR/web.log" 2>&1 &
    echo $! > "$RUNDIR/web.pid"; sleep 1
  fi

  status
  say ""
  say "見る側 (手元の PC) で開く URL —— ここを開けば即接続します:"
  say ""
  say "    http://127.0.0.1:${WEB_PORT}/vnc.html?autoconnect=true&resize=scale&reconnect=true"
  say ""
  say "  ※ VS Code Remote-SSH なら「ポート」タブの ${WEB_PORT} を右クリック →「ブラウザーで開く」。"
  say "     **内蔵の Simple Browser では操作できない** (キーボード/マウスを捕捉しないため)。"
  say "     必ず手元の Chrome 等の実ブラウザで開くこと。"
  say "  ※ VS Code を使っていない場合はトンネルを張る:"
  say "       ssh -N -L ${WEB_PORT}:127.0.0.1:${WEB_PORT} <このホスト>"
  if [ "${RC_VNC_AUTH:-none}" = "password" ]; then
    # 値は伏せない。使い捨てのセッション鍵であり、読むのは所有者本人だけ。
    say "  パスワード:  $(tr -d '\n' < "$PWFILE")      ($PWFILE)"
  else
    say "  パスワード:  なし (到達には SSH 認証が必要。RC_VNC_AUTH=password で有効化)"
  fi
  say "  クリップボード: 無効 (見る側 PC との往復なし。コピー&ペーストは使えません)"
  say ""
  say "  ※ 常設しない運用です。見終わったら落としてください:  bash vnc.sh stop"
}

status() {
  say "ディスプレイ : $DISP ($GEOM)"
  for n in xvfb x11vnc web; do
    p="$(pidof_file "$RUNDIR/$n.pid")"
    say "  $(printf '%-8s' "$n"): $([ -n "$p" ] && echo "稼働中 pid=$p" || echo '停止')"
  done
  # 待受が本当に localhost 限定かを実測する (設定を信じず確かめる)。
  if command -v ss >/dev/null; then
    say "  待受(実測):"
    ss -ltnp 2>/dev/null | grep -E ":($VNC_PORT|$WEB_PORT)\b" | sed 's/^/    /' || say "    (なし)"
  fi
  # クリップボード共有の有無も、設定ファイルでなく **起動中プロセスの引数** で実測する。
  # (スクリプトを直したつもりでも、古い引数のまま生き残っている x11vnc を掴んでいたら意味がない)
  local vp; vp="$(pidof_file "$RUNDIR/x11vnc.pid")"
  if [ -n "$vp" ]; then
    local vargs; vargs="$(tr '\0' ' ' < "/proc/$vp/cmdline" 2>/dev/null)"
    case "$vargs" in
      *-nosel*) say "  クリップボード: 無効 (-nosel 等を付けて起動されている)" ;;
      *)        say "  クリップボード: ⚠ 有効のまま。この x11vnc は古い引数で起動されている。stop → start し直すこと" ;;
    esac
  else
    say "  クリップボード: — (未起動)"
  fi
}

stop() {
  for n in web x11vnc xvfb; do
    p="$(pidof_file "$RUNDIR/$n.pid")"
    [ -n "$p" ] && { kill "$p" 2>/dev/null; say "  $n 停止 (pid=$p)"; }
    rm -f "$RUNDIR/$n.pid"
  done
  sleep 1
  # 「kill を打った」と「落ちている」は別の事実。待受が消えたことを実測して初めて停止と言う。
  # (pid ファイルを失った残骸は kill 対象にならないので、ここで初めて姿を現す)
  local left; left="$(ss -ltn 2>/dev/null | grep -E ":($VNC_PORT|$WEB_PORT)\b" || true)"
  if [ -n "$left" ]; then
    say "⚠ まだ待受が残っています (pid ファイルの無い残骸の可能性):"
    printf '%s\n' "$left" | sed 's/^/    /'
    say "  → pgrep -af '[x]11vnc|[X]vfb :99|[w]ebsockify' で PID を特定してから kill してください"
    return 1
  fi
  say "停止しました (待受 $VNC_PORT/$WEB_PORT が消えたことを ss で実測)。"
}

case "${1:-status}" in
  start) start ;;
  status) status ;;
  stop) stop ;;
  *) die "使い方: bash vnc.sh start|status|stop" ;;
esac
