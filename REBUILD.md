# ゼロからの再構築手順

このリポジトリだけで、他サーバーに RumiCar Simulator を新規構築できます。外部リポジトリも、このリポジトリ外の資産も必要ありません。

## 前提として必要なもの

| | バージョン | 用途 |
|---|---|---|
| Docker | 20.10 以降 (検証時 29.6.1) | 配信コンテナ |
| Docker Compose | v2 以降 (検証時 v5.3.0) | 構成管理 |
| Node.js | 18 以降 (検証時 v22.22.1) | 検証ゲートの実行のみ。配信には不要 |

インターネット接続は**初回ビルド時のみ**必要です (`nginx:alpine` の取得)。

## 依存関係について

再構築を難しくする要素が無いことを確認済みです。

- **バイナリ資産ゼロ** — `public/` は JS 40件 + `index.html` + `style.css` + `data/courses.json` のみ。画像は1枚も使っておらず、車体・コース・エフェクトはすべて実行時に手続き的に描画されます
- **外部ライブラリ・CDN 依存ゼロ** — npm パッケージも CDN 参照もありません。`node_modules` は配信・実行のどちらにも不要です
- **ビルドが単純** — `nginx:alpine` に `public/` を `COPY` するだけです

### 唯一の外部通信

アプリは実行時に `RumiCar-group/RumiCar` (公開リポジトリ) の GitHub API を参照し、コミュニティ投稿コンテンツを一覧します。

| 参照先 | 用途 | 現状 |
|---|---|---|
| `courses/community` | 投稿コース | 存在する |
| `programs/community` | 投稿プログラム | 存在する |
| `cars/community` | 投稿車種 | **未作成 (404)** |

**これは必須依存ではありません。** 取得に失敗した場合 (オフライン・レート制限・404) はコードが `null` を返して1行通知するだけで、シミュレータ本体は完全に動作します。オフライン環境でも問題なく使えます。

なお GitHub の未認証 API アクセスは**1時間あたり60回**のレート制限があります。多人数が同一 IP (社内ネットワーク等) から使う環境では、コミュニティ一覧の取得がこの制限に達して失敗することがあります (本体動作には影響しません)。

### コミュニティ機能の投稿先について (デフォルトでは RumiCar 側 GitHub に追加される仕様)

「🌐 GitHubで共有」(コース・プログラム・車種) と「💬 質問・提案」は、**既定で本プロジェクトの上流リポジトリ `RumiCar-group/RumiCar` へ投稿されます**(プルリクエスト / Issue 作成。投稿者自身の GitHub アカウントで行われ、書込権限が無ければ GitHub が自動で fork します)。このリポジトリを再構築・自己ホストしても、投稿先はこの既定のままです。

自分専用のコミュニティ投稿先 (自分の fork や別リポジトリ) に変更したい場合は、次の2箇所を書き換えてください:

| 機能 | 変更箇所 |
|---|---|
| コース/プログラム/車種の一覧取得・共有 (🌐) | `public/js/loader.js` の `SAMPLE_REPO`(`{owner, repo, branch}`) |
| 質問・提案 (💬) | `public/js/main.js` の `helpAsk` クリックハンドラ内の GitHub Issue URL (`RumiCar-group/RumiCar/issues/new`) |

投稿先を変更する場合は、投稿先リポジトリ側に `courses/community/` `programs/community/` `cars/community/` の3ディレクトリを用意しておく必要があります (無くても動きますが、共有機能はエラーになります)。

---

## 手順A: シミュレータ単体で立てる (推奨・最短)

WordPress など既存サイトが不要な場合はこちらです。

```bash
git clone <このリポジトリのURL> RumiCar-Simulator
cd RumiCar-Simulator/deploy/standalone
docker compose up -d --build
```

これだけで完了です。

```
http://<ホスト>:8090/simulator/
```

公開ポートを変える場合:

```bash
SIM_PORT=80 docker compose up -d --build
```

### なぜルート直下ではなく /simulator/ なのか

アプリ内の共有 URL・GitHub Issue へのリンク・相対パス解決が `/simulator/` 配下を前提に組まれています。ルート直下で配信すると、既存の共有 URL との互換性が壊れます。本番と同じプレフィックスを保つのが安全です。

### 動作確認

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8090/simulator/          # → 200
curl -s http://127.0.0.1:8090/simulator/data/courses.json | grep -c '"name"'       # → 41
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8090/healthz             # → 200
```

---

## 手順B: 既存サイトの一部として組み込む (本番と同じ形)

すでに nginx で動いているサイトの `/simulator/` に相乗りさせる構成です。rumicar.com はこの形で動いています。

### B-1. 外部ネットワークを作る

**これを忘れると compose up が失敗します。** 両方の compose が `external: true` で宣言しており、どちらもこのネットワークを作りません。

```bash
docker network create rumicar-net
```

### B-2. シミュレータを起動する

```bash
cd RumiCar-Simulator
docker compose up -d --build
```

`compose.yaml` は `rumicar-net` に参加し、ポートを公開しません。到達経路は既存 nginx 経由のみになります。

### B-3. 既存 nginx を rumicar-net に参加させる

既存サイトの compose の nginx サービスに追記します。

```yaml
    networks:
      - web              # 既存サイト用 (名前は環境により異なる)
      - rumicar-net      # ← 追加

networks:
  rumicar-net:
    external: true       # ← 追加
```

### B-4. location を差し込む

`deploy/integrated/simulator-location.conf` の内容を、対象の `server { ... }` の中に貼ります。HTTPS でも配信する場合は 443 用の server にも同じ内容を入れてください。

### B-5. 反映

```bash
docker compose up -d        # nginx をネットワーク追加ぶん再作成
```

### 踏みやすい罠

- **`location ^~ /simulator/` の `^~` は必須です。** 付けないと静的ファイル用の regex location (`\.(js|css|json)$` 等) が `/simulator/js/...` を先に捕まえて 404 になります
- **`proxy_pass` は変数経由にしてください。** `proxy_pass http://simulator:80` と直接書くと起動時に1度だけ名前解決され、コンテナ再作成後に到達不能になります。同梱の設定は `set $rumicar_sim simulator;` を経由させて回避しています
- 既存 nginx が `fastcgi_pass wordpress:9000` のように**静的名**を使っている場合、その解決も起動時固定です。WordPress 側コンテナを再作成したときは nginx も restart が必要です

再構築に必要なのは本節までの内容のみです。（本番サイトの実設定は機微情報を含むため公開していません。本節の手順だけで同等の構成を再現できます。）

---

## 検証ゲートの実行

52本の常設ゲートが同梱されています。改変後の回帰確認に使ってください。

```bash
cd RumiCar-Simulator
node wf_run_all.mjs                    # 全ゲート実行
WF_SKIP_TIMING=1 node wf_run_all.mjs   # 壁時計依存の1本を隔離した安定実行
node wf_run_all.mjs --list             # 実行対象/除外の一覧のみ
```

全緑で exit 0、1本でも失敗すれば exit 非0で失敗ゲート名が列挙されます。`node_modules` は不要です。

物理挙動の不変性 (卓上既定の byte 一致・決定論レースの verifyHash) までゲートが機械確認するため、改良時にここが赤くなったら既存の記録・共有 URL との互換性を壊しています。

---

## 改変するときの勘所

| やりたいこと | 触る場所 | 反映方法 |
|---|---|---|
| コース追加・調整 | `public/data/courses.json` | ページ再読込のみ (マウント済み) |
| UI・物理・描画 | `public/js/*.js` | ページ再読込のみ |
| 見た目 | `public/css/style.css` | ページ再読込のみ |
| 配信設定 (gzip 等) | `nginx-default.conf` | `docker compose up -d --build` |

`public/` は read-only マウントされているため、**JS/CSS/JSON/HTML の変更は再ビルド不要**でページ再読込だけで反映されます。イメージにも `COPY` 済みなので、マウントを外しても動作します (フォールバック)。

走行物理モデルの解説は `docs/physics_model.md` (日本語) と `docs/physics_model.en.md` (英語) にあります。

---

## 既存コンテナの復旧

統合構成 (手順B) で simulator コンテナが消えて 502 になった場合は、復旧スクリプトが使えます。

```bash
cd RumiCar-Simulator
bash restore_simulator.sh              # 既存イメージから起動
bash restore_simulator.sh --build      # 配信設定を変えたときは再ビルド
```

前提ネットワークの確認・残骸コンテナの除去・起動待ち・疎通確認・コース数照合・CSS 反映確認まで行います。

疎通確認の宛先は既定で本番 URL (`https://www.rumicar.com/simulator/`) です。別環境では上書きしてください。

```bash
CHECK_URL=http://127.0.0.1:8090/simulator/ bash restore_simulator.sh
```

スクリプト自身の位置からディレクトリを解決するのでクローン先がどこでも動き、コース数の期待値も `public/data/courses.json` の実数から算出するため、コース追加時にスクリプトを直す必要はありません。

## カタログの再生成

`RumiCar-group/RumiCar` へ公開するコース・プログラムのカタログは、正本から生成します。

```bash
cd RumiCar-Simulator
node gen_course_files.mjs      # → /tmp/rc_courses  (1コース1ファイル + index.json + README)
node gen_program_files.mjs     # → /tmp/rc_programs (.ino + index.json + README)
```

生成物を `RumiCar-group/RumiCar` の `courses/` `programs/` へ反映します。**`programs/community/` と `courses/community/` の投稿物は生成対象外なので、消さないよう追加・更新のみ行ってください。**
