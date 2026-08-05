# 実ブラウザ(非ヘッドレス)検証ハーネス

`[cpo]` RumiCar Simulator の動作確認を、**実際の headed Chrome** で行うための常設ハーネス。

## なぜ要るのか

これまで実ブラウザ検証は、セッションごとに `/tmp` のスクラッチへ Playwright を入れて
使い捨てスクリプトを書く運用だった（2026-08-02 の OSS-PREP-2 / UI-FIX-1 / LIB-DEPRECATE-1）。
セッションが終わると消えるため、

- 「本サーバーにはブラウザが無い」という**誤った前提が記録に残り**（PROGRESS AR2/AR4 の目視必須札）、
  機械で測れるはずの項目まで人間へ委ねられていた
- 毎回ゼロから書き直すので、検証の書き方が揃わない

この2点を解消するために恒久化した。

## ヘッドレスにしない理由

Chrome の「ヘッドレス」は3層あり、**見落とすのは①**。

| | 実体 | 見落とすもの |
|---|---|---|
| ① `chrome-headless-shell` | 機能を削った別バイナリ。Playwright の `headless: true` の既定 | 拡張・GPU 合成・一部 API |
| ② `chrome --headless=new` | フルバイナリの無画面モード | Blink/V8 は headed と同一経路。window/フォーカス周りが残る |
| ③ headed + Xvfb（**本ハーネス**） | 実ウィンドウ・実コンポジタ | ほぼ無し |

本アプリは canvas 描画・`requestAnimationFrame` 前提の物理ループ・WebGL（`elev3d.js`）・
CSS `@container`（`fleet-cols`）に依存するため ③ を採る。

## 構成

| ファイル | 役割 |
|---|---|
| `run.sh` | 起動ラッパ。検証対象 URL を docker から解決し、実ディスプレイ上で node を実行する |
| `vnc.sh` | **人が同じ画面を見る**ための VNC セッション管理（`start`/`status`/`stop`） |
| `lib.mjs` | 共有部。headed 起動・計装済みページ・**配信中モジュールの評価**・言語切替・はみ出し測定 |
| `check_hello.mjs` | 最小の生存確認（title／UA／WebGL／エラー件数）。移設直後に最初に走らせる |
| `check_smoke.mjs` | 常設スモークゲート（版バッジ／CHANGELOG ja-en／JS エラー／横はみ出し） |
| `drive.mjs` | 本番 UI を実際に操作して走らせる（コース選択→自動走行→計測→言語切替） |
| `hold.mjs` | アプリを開いたまま保持する（VNC で人が見て触るための窓。既定30分で自動終了） |
| `check_vnc.mjs` | VNC 経路の検証（loopback 束縛／実ブラウザで画面が出る／認証方式が設定どおり） |
| `shots/` | スクリーンショット出力先（`*.png` は git 無視） |

## 使い方

```bash
cd Simulator/browser
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install   # 初回のみ。ブラウザ本体は再利用する
bash run.sh check_smoke.mjs
```

対象 URL は既定でコンテナ `rumicar-simulator` を docker から直接引く
（`public/` は bind mount なので **編集 → 再読込で即反映**・ポート公開も外部通信も不要）。
明示指定もできる:

```bash
RC_URL=https://www.rumicar.com/simulator/ bash run.sh check_smoke.mjs
RC_SCREEN=1920x1080x24 bash run.sh check_smoke.mjs
```

## 検証の書き方（`docs/oracle_inventory.md` の「使い方の型」に従う）

述語を再実装せず、**ページが現に読み込んでいるモジュールに答えさせる**。

```js
import { launch, newPage, appModule } from './lib.mjs';
const browser = await launch();
const { page, errors, benign } = await newPage(browser, { width: 1440 });
const ver = await appModule(page, 'js/config.js', (m) => m.APP_VERSION);  // 本物の値
```

- `errors` は異常、`benign` は「想定内として除外したもの」。**除外を黙って捨てない**
  （`races/` の 404 は上流にディレクトリが無いのが正常＝REBUILD.md 記載の挙動）。
- 二値で止めず**連続量マージン**まで出す（`overflowX` は px を返す）。
- 検証次元は代表1ケースでなく直積の隅を掃く（`check_smoke.mjs` は7画面幅）。

## 既存ゲート群との関係

`wf_*.mjs` の常設ゲート（`wf_run_all.mjs` の39本）は **`node_modules` 不要**であることが
フレッシュクローン検証の前提になっている。ブラウザ依存をそこへ持ち込まないよう、
Playwright を使う検証は**本ディレクトリに隔離**する。`node_modules` は git 無視済み。

## 人が同じ画面を見る（VNC）

機械化できずに残る札は「人にどう映るか」だけ。それをスクリーンショット越しでなく
**Claude が今まさに動かしている当のブラウザ**で直接見るための経路。

### 既定は「落ちている」（2026-08-03 利用者決定）

**VNC は常設しない。人が実際に画面を見て確認する必要があるときだけ上げ、済んだら落とす。**
待受ポート・X ディスプレイ・クリップボード経路という攻撃面を、必要な時間だけに限るため。

- 落ちていても**検証は止まらない**。`run.sh` は VNC セッションが無ければ使い捨て Xvfb に
  フォールバックする（人が見られないだけで、機械検証の結果は同じ）。
- Claude 側は**人が見る必要があると分かっているときだけ** `vnc.sh start` する。
  検証を走らせるためだけに上げない。上げたブロックの中で落とす。
- 自動起動の仕掛けは置かない（systemd unit・cron・シェル rc への記述はいずれも無し）。

```bash
sudo apt install -y x11vnc novnc websockify   # 初回のみ（sudo が要るので利用者が実行）
bash vnc.sh start                             # 人が見るときだけ。Xvfb :99 + x11vnc + noVNC
bash run.sh check_smoke.mjs                   # ← 自動で :99 に相乗りする
bash run.sh hold.mjs &                        # 開いたまま保持（人が見て触るとき）
bash vnc.sh stop                              # ← 見終わったら必ず。ss で消えたことまで実測する
```

> `apt install` の際に needrestart が「Pending kernel upgrade!」「Service restarts being
> deferred」を出すことがあるが、**これは告知であってエラーではない**。挙げられる
> `systemctl restart docker.service` は**実行すると本番コンテナが再起動する**ので、
> 必要性を判断せずに走らせないこと。

手元の PC のブラウザで開く URL（`vnc.sh start` が毎回表示する）:

```
http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale&reconnect=true
```

- **VS Code Remote-SSH** なら「ポート」タブの `6080` を右クリック →「ブラウザーで開く」。
  **内蔵の Simple Browser では操作できない**（キーボード/マウスを捕捉しないため、
  画面は出るが触れない）。必ず手元の Chrome 等の実ブラウザで開くこと。
- VS Code を使わない場合は `ssh -N -L 6080:127.0.0.1:6080 <このホスト>` でトンネルを張る。

URL パラメータの意味: `autoconnect`=開いた瞬間に接続／`resize=scale`=ウィンドウに合わせて
縮尺（1440x900 の画面が小さなウィンドウでも全体が見える）／`reconnect`=切れたら再接続。

**`run.sh` はこのセッションが生きていれば自動で相乗りする**ので、検証を走らせている間の
ブラウザ操作がそのまま見える。`hold.mjs` を上げておけば、人が自由に触ることもできる。

### 認証は「パスワードなし」が既定

**守りの主体は VNC パスワードではなく、loopback 束縛と SSH 認証。**
待受は `127.0.0.1` にしか出ていないので、到達できる者＝先に SSH 認証を通した者に限られる。

VNC パスワードはその上に重ねるもう一段だが、次の制約から取り違えが起きやすく、
実際には**接続できない事故だけを生んだ**ので既定では使わない。

- プロトコル上 **先頭8文字しか効かない**（DES 鍵長）＝どこまで入力すべきかが曖昧になる
- `x11vnc -storepasswd` の保存形式は**難読化バイナリ**で、`cat` しても入力すべき文字にならない

どうしても要るときは `RC_VNC_AUTH=password bash vnc.sh start`（平文ちょうど8文字を
`~/.config/rumicar/vncpasswd` に生成し、`vnc.sh start` が値を表示する。使い捨ての
セッション鍵なので伏せない。**長期の資格情報 (API トークン等) とは扱いを分ける** — そちらは
値も保管場所も画面に出さない）。

### クリップボード共有は無効（2026-08-03 利用者決定）

**x11vnc の既定は双方向でクリップボードを共有する。これを止めてある。**
用途は「画面を見る」ことであってテキストの受け渡しではない。共有したままだと、
見る側 PC のクリップボード（パスワードやトークンを載せがち）とサーバー側の X セレクションが
勝手に往復する。**要らない経路は開けない。**

`vnc.sh` は x11vnc に次を渡す（傘の `-nosel` だけでも足りるが、版差で意味がずれても
穴が開かないよう両方向を明示している）:

    -nosel -noclipboard -nosetclipboard -noprimary -nosetprimary

副作用として、noVNC 画面と手元 PC の間で**コピー&ペーストはできない**（意図どおり）。
noVNC の UI にクリップボードパネルは残るが、そこへ書いてもサーバー側には入らない。

**パスワードを外した以上、loopback 束縛が唯一の砦になる。** そこは毎回機械で確かめる:

```bash
RC_FRESH=1 bash run.sh check_vnc.mjs
#   ① 待受が loopback 限定か（ss で実測。0.0.0.0 に出ていたら FAIL）
#   ② 実ブラウザで画面が出るか（framebuffer の実寸で判定）
#   ③ 認証方式が設定どおりか（none なのに要求される／その逆を検出）
#   ④ クリップボード共有が無効か（5900 を持つ当のプロセスの /proc/PID/cmdline で実測）
```

④を「スクリプトの中身」でなく**起動中プロセスの引数**で見ているのは、`vnc.sh` を直しても
直す前に起動した x11vnc が生き残っていれば共有は有効のままだから。`vnc.sh status` も
同じ実測を表示し、古い引数の x11vnc を掴んでいれば警告する。

`RC_FRESH=1` は必須（`:99` の noVNC を `:99` のブラウザで開くと合わせ鏡になる）。

> ①を第一項目にしているのは、「繋がった」だけを見る検査では**うっかり `0.0.0.0` に
> 晒しても緑のまま**になるため。パスワードなし運用では、そこが唯一の防御線。

## 人が見ている前で操作してみせる

```bash
RC_SLOWMO=400 bash run.sh drive.mjs              # 人が追える速さで
RC_COURSE="峠" RC_RUN_SEC=30 bash run.sh drive.mjs
```

コース選択 → `自動 ▶` → 速度サンプリング → `停止 ■` → 言語切替 を実行し、終わっても
ウィンドウを開いたまま残す（人が続けて触れるように）。**デモ専用の抜け道は作らず、
利用者と同じ UI 要素（`#courseSel`／`#run`／`#stop`／`#langSel`）だけを触る**（CI-8）。

`RC_SLOWMO` は人が見ているときだけ使う。機械には不要だが、追えない速さで動かしては
「見せる」目的を果たさない。

## 他サーバーへ導入する

環境調査から撤去まで、実測しながら進める手順書がある（コア3本の全文と落とし穴集11件を収録）:

    Simulator/docs/実ブラウザ検証環境_導入手順.md

2026-08-03 に `~/` からこのリポジトリへ移して版管理下に置いた（バックアップのため）。
移設先サーバー向けの記述や過去の記録は `~/実ブラウザ検証環境_導入手順.md` を指しているので、
このホストでは同パスに**シンボリックリンク**を残してある（`readlink -f` で上記に解決する）。

`run.sh` は `RC_CONTAINER` / `RC_FALLBACK_URL` を環境変数で受けるので、移設先ではそこだけ変える。
