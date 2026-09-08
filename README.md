# RumiCar Simulator

**日本語** | [English](README.en.md)

自動運転アルゴリズムをブラウザ上で開発・検証するシミュレータです。実車の RumiCar と同じセンサー構成 (前方3つの ToF 距離センサー + 車輪エンコーダ) を模擬し、C / Python / JavaScript で書いたプログラムをそのまま走らせて評価できます。

**このリポジトリは単体で完結しています。** クローンして `deploy/standalone` で `docker compose up -d --build` すれば、それだけで動きます。手順は **[REBUILD.md](REBUILD.md)** にあります。

稼働中のインスタンス: <https://www.rumicar.com/simulator/>

## 構成

```
public/                   配信物 = アプリ本体
├── index.html
├── css/style.css
├── js/                   45 モジュール (物理・描画・レース・言語処理系・i18n)
└── data/courses.json     66 コースのカタログ

docs/
└── physics_model.md(.en.md)   走行物理モデルの解説 (数式・較正値つき・日英)

Dockerfile                nginx:alpine + public/ (これだけ)
compose.yaml              統合構成用 (rumicar-net 参加・ポート非公開)
nginx-default.conf        gzip 有効化した配信設定
gen_course_files.mjs / gen_program_files.mjs   コース/プログラムのカタログ生成ツール
validate_courses.mjs      コースデータの整合性検証
wf_*.mjs                  常設検証ゲート 62 本 (改変後の回帰確認に使用)
browser/                  実ブラウザ検証ハーネス (headed Chrome。配信・実行には不要)

deploy/
├── standalone/           WordPress 等の既存サイト不要。単体で立てる構成 (推奨)
└── integrated/           既存 nginx へ相乗りさせる構成 (location スニペット)
```

`js/` の主なもの: `physics.js` / `physics_dyn.js` / `physics_v2.js` (3種の走行エンジン)、`race_engine.js` (決定論レース)、`interp/` (C・Python のレキサ/パーサ/評価器)、`car_sprite.js` `elev3d.js` `depth.js` (手続き的描画)、`i18n/` (日英)。

## 特徴的な設計

- **バイナリ資産を一切持ちません。** 車体・コース・エフェクトはすべて実行時に手続き的に描画されます。画像ファイルは1枚もありません
- **外部ライブラリ・CDN 依存ゼロ。** npm パッケージも使っていません。`node_modules` は配信・実行のどちらにも不要です
- **決定論的です。** 同じ入力から同じ結果 (byte 一致) が再現されます。62本の検証ゲートがこの不変性を機械確認しており、レース記録や共有 URL の互換性を保証しています。ゲートはこのリポジトリに同梱されているので、**クローンして `node wf_run_all.mjs` を走らせれば誰でも自分の手で確認できます** (Node.js 以外の依存はありません)
- **オフラインで動きます。** 外部への参照はコミュニティ投稿の一覧取得のみで、失敗しても本体は止まりません。投稿 (コース・プログラム・車種) の一覧は各ディレクトリの `index.json` を raw から読み (レート制限なし)、無ければ GitHub API へ自動で切り替えます。公式レースの一覧だけはディレクトリを数える必要があるため API を使います。取得結果はブラウザに一時保存するため、教室のように 1 つの回線を大勢で共有しても API の上限 (未認証で 60 回/時・IP 単位) に届きにくくなっています (v7.4.0)

## コミュニティ機能について (重要)

コース・走行プログラム・車種を「🌐 GitHubで共有」した場合や、「💬 質問・提案」から投稿した場合、**投稿先は既定でこのプロジェクトの上流リポジトリ [RumiCar-group/RumiCar](https://github.com/RumiCar-group/RumiCar) に固定されています**（プルリクエスト / Issue 作成という形で、投稿者自身の GitHub アカウントで行われます）。

このリポジトリをクローンして自分のサーバーで動かす場合も、この投稿先は自動では変わりません。自分専用のコミュニティ投稿先に変更したい場合は `REBUILD.md` の「コミュニティ機能の投稿先について」を参照してください。

Issue・プルリクエストは**英語でも日本語でも歓迎**します。 / Questions, bug reports, and pull requests are welcome in English or Japanese.

## 関連リポジトリ

- **[RumiCar-group/RumiCar](https://github.com/RumiCar-group/RumiCar)** (公開) — RumiCar プラットフォーム本体。実車のハードウェア (基板・シャシー・ESP32 / RasPi / RasPiPico / SPRESENSE)、教材、そしてコミュニティ投稿の `courses/` `programs/` `cars/`。シミュレータは実行時にここの投稿コンテンツを一覧します

## ライセンス

MIT License (Copyright (c) 2026 RumiCar Development Group)。詳細は [LICENSE](LICENSE) を参照してください。上流の [RumiCar-group/RumiCar](https://github.com/RumiCar-group/RumiCar) と同一のライセンスです。
