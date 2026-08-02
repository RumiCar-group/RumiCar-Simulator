// RumiCar Simulator — 共有設定・定数
// すべての調整可能パラメータをここに集約する。

// アプリのバージョン (ヘッダーのバッジ・起動ログに表示する単一ソース)。
export const APP_VERSION = 'v5.1.0';

// 変更履歴 (版バッジのホバーで全件表示する単一ソース・最新を先頭に)。
// 表示用データのみ — 物理・挙動には一切影響しない。先頭の版は APP_VERSION と一致させる。
// 版を上げたら必ずここへ1行追加する (versioned 履歴は v3.1.0 から。それ以前は版定数なし)。
// 各エントリは ja(note)/en(noteEn) 併記＋陳腐化印 h=hash(note)。ja を直したら
// en も直し node wf_i18n_rehash.mjs で h を更新する (未更新は wf_i18n_check.mjs ⑤ が exit 1 で検知)。
export const CHANGELOG = [
  { v: 'v5.1.0', note: 'サンプル参照 (GitHub の RumiCar 教材リポジトリを辿る画面) に「廃止された置き場」のガードを追加した (表示・取込の制御のみ・走行物理は不変)。RumiCar の Arduino ライブラリは Arduino 公式の Library Manager に登録され、ソースは後継リポジトリ RumiCar-group/RumiCar-lib へ移りました。ところが教材リポジトリの ArduinoAndESP32/Libraries/ には旧版のローカルライブラリが残っており、サンプル参照はリポジトリのルートから自由に辿れるため、そこの RumiCar.h / RumiCar.cpp を「サンプル」と思って取り込めてしまう状態でした。旧版には後方センサーの定義 (REAR) が無いなど新機能が入っておらず、取り込んでも最新の課題が動かないうえ、原因が分かりにくくなります。そこで廃止された置き場を開いたときは警告を出し、そこのファイルは取込不可 (🚫 表示) にし、Arduino IDE の「ライブラリを管理...」から RumiCar を入れるよう案内するようにしました。通常のサンプル (Exercise など) はこれまでどおり取り込めます。走行物理・決定論ハッシュ f0〜f3・公式レース記録・共有 URL はすべて不変です。', noteEn: 'Added a "deprecated location" guard to the sample browser (the screen that walks the RumiCar teaching repository on GitHub) - display and loading control only; the driving physics is unchanged. The RumiCar Arduino library is now published in the official Arduino Library Manager and its source has moved to the successor repository RumiCar-group/RumiCar-lib. The old local copy, however, still sat under ArduinoAndESP32/Libraries/ in the teaching repository, and because the sample browser can walk the repository freely from its root, it was possible to load that RumiCar.h / RumiCar.cpp as if it were a sample. The old copy lacks newer features such as the rear sensor definition (REAR), so loading it means recent exercises do not work and the cause is hard to see. Opening a deprecated location now shows a warning, its files are marked not loadable (shown with a no-entry mark), and you are directed to install RumiCar from "Manage Libraries..." in the Arduino IDE. Ordinary samples (the Exercises and so on) load exactly as before. The driving physics, the deterministic hashes f0-f3, official race records and share URLs are all unchanged.', h: '2f04799d' },
  { v: 'v5.0.1', note: '車を1台だけにしているとき、車両カードの右に出る「車両を追加して並べて比較」タイルが、横長の画面で右にはみ出して見切れていた不具合を直した (表示のみの是正・走行物理は不変)。原因はこのタイルが最小幅 160px を絶対に譲らない指定になっていたことで、車両カード列の必要幅が画面幅によらず常に 494px に固定されていました。一方 v5.0.0 までにコース表示 (ステージ) と右側パネルが幅を分け合うレイアウトへ改めたため、横並びになる画面では右側パネルが 380〜441px まで縮み、必ず 55〜116px はみ出していました。縦長の画面では折り返して右側パネルが全幅になるため起きず、「縦長なら正しいのに横長だけ見切れる」という症状になっていました。修正後はタイルが「余った幅ぶんだけを占める」指定になり、構造的にはみ出せなくなります。あわせて余白の広さに応じて中身を2段階に落とし、余白が広いときは説明の札つき、狭いときは「＋」だけのコンパクト表示にします (説明はツールチップと読み上げラベルに常に残るので、コンパクト表示でも意味が分かります)。コース表示と右側パネルの幅の配分は変えていないので、コースの見え方は従来どおりです。実測で 420〜1920px の13通りの画面幅すべてではみ出し0を確認しました。あわせて、車両カード列の横スクロール位置の計算がページ全体を基準にしてしまい、初期表示が右にずれることがあった不具合も直しています。走行物理・決定論ハッシュ f0〜f3・公式レース記録・共有 URL はすべて不変です。', noteEn: 'Fixed a bug where, with only one car, the "Add a car to compare" tile shown to the right of the car card overflowed and was clipped on wide (landscape) screens (a display-only fix; the driving physics is unchanged). The cause was that the tile refused to give up its 160px minimum width, which pinned the car-card strip\'s required width at 494px regardless of the screen size. Meanwhile, up to v5.0.0 the layout had been changed so that the course view (stage) and the right-hand panel share the available width, so on screens where they sit side by side the right-hand panel shrinks to 380–441px and the strip always overflowed by 55–116px. On tall (portrait) screens the layout wraps and the right-hand panel becomes full width, so it did not happen there — hence the symptom "correct when tall, clipped only when wide". After the fix the tile is set to occupy only the leftover width, so it cannot overflow by construction. Its contents now also degrade in two steps according to how much room is left: with plenty of room it shows the explanatory label, and when the space is tight it becomes a compact "+"-only tile (the explanation always remains in the tooltip and the screen-reader label, so the compact form is still meaningful). The width split between the course view and the right-hand panel is unchanged, so the course looks exactly as before. Measured across 13 screen widths from 420 to 1920px, the overflow is zero in every case. Also fixed alongside it: the horizontal scroll position of the car-card strip was computed relative to the whole page, which could shift the initial view to the right. The driving physics, the deterministic hashes f0–f3, official race records, and share URLs are all unchanged.', h: 'cf21d530' },
  { v: 'v5.0.0', note: 'OSS 公開の準備として、コース名・コーナー名・プログラム名から実在の固有名 (サーキット名・地名・実在車種名・商標語) を排し、走りの性格を表す記述的な名前へ全面的に改めました (走行物理・測距・コースの幾何は一切変えていません)。コース 20 件を改名し (例: 鈴鹿→エッセ・レイアウト / モナコ→ストリート・レイアウト / モンツァ→ハイスピード・レイアウト / 峠②秋名風→峠② タイトヘアピン (急な下り) / ウェット鈴鹿風→ウェットテクニカル (雨))、説明文中のコーナー名 (パラボリカ・オールージュ・セナのS ほか) も「大きな複合コーナー」「登りの高速esse」のような性格の記述へ置き換え、プログラム「Quattro Blitz」は「Traction Blitz」へ、車種コメントの実在車名は「軽量ライトウェイトスポーツ級」等の一般表現へ改めています。【重要・再現しなくなるもの】コース名は共有 URL の c= パラメータと、ブラウザに保存される練習ベスト記録のキーそのものです。そのため旧コース名で作った共有 URL と、旧コース名で保存された練習ベスト記録は再現しません。旧名の共有 URL を開いた場合は「共有されたコースが見つかりません」と通知したうえでランダムなコースで開始します (無言で壊れることはありません)。公式レース記録は改名対象のコースを使ったものが 1 件も無いため影響を受けません。それ以外はすべて不変で、決定論ハッシュ f0〜f3・正準レースの verifyHash・コースの寸法や難易度は従来どおりです。', noteEn: 'In preparation for the open-source release, every real-world proper name (circuit names, place names, real car models, trademarked words) has been removed from course names, corner names and program names and replaced with descriptive names that state the character of the driving (the driving physics, the ranging and the course geometry are all unchanged). 20 courses were renamed (for example Suzuka to Esses Layout, Monaco to Street Layout, Monza to High-Speed Layout, Touge 2 to Touge 2: Tight Hairpins (Steep Descent), Wet Suzuka to Wet Technical (Rain)); corner names inside the descriptions (Parabolica, Eau Rouge, the Senna S and others) were replaced with character descriptions such as "a large compound corner" or "an uphill fast esse"; the program "Quattro Blitz" became "Traction Blitz"; and the real car models in the car-type comments became generic wording such as "lightweight sports class". IMPORTANT — what no longer reproduces: a course name is literally the c= parameter of a share URL and the key of the practice best-lap record stored in your browser. Share URLs created with the old course names, and practice best-lap records saved under the old names, therefore no longer reproduce. Opening a share URL with an old name shows a "the shared course was not found" notice and starts on a random course instead (it does not break silently). Official race records are unaffected because none of them use a renamed course. Everything else is unchanged: the deterministic hashes f0–f3, the verifyHash of the canonical race, and the dimensions and difficulty of every course are exactly as before.', h: '4bac9a2d' },
  { v: 'v4.1.0', note: 'センサー扇 (コーン) の描画を方向別の終端に直した (GitHub #30「同じ車種なのにレーザーの長さ(?)が違ってる」・表示のみの是正・測距/物理は不変)。これまで扇全体を「扇内で最も近い反射面までの距離」の一定半径で打ち切っていたため、発走グリッドなどで自分の横の壁が視野コーン (25°) の端に掠っただけで、前方が開けていても扇が短く空中で終端し、車ごとに「レーザーの長さ」が大きく違って見えました (#30 の3台は横位置の差で 1223/770/578mm)。修正後は扇を方向ごとに実際の壁/他車まで伸ばして描くので、開いた方向はレンジ (卓上2m) まで伸び、壁のある方向は壁の上で終端します (空中終端が消える)。学習プログラムが読む測距値 (RC_read 系=扇内最近反射面)・ヒット点マーカ・数値ラベルは従来どおりで一切変わりません。物理・決定論ハッシュ f0〜f3・公式/正準記録はすべて不変です。', noteEn: 'Fixed the sensor fan (cone) rendering to terminate per direction (GitHub #30 "the laser length differs between identical car types" — a display-only fix; ranging and physics are unchanged). Previously the whole fan was cut off at a single radius equal to the distance to the nearest reflecting surface anywhere inside the fan, so when a side wall merely grazed the edge of the 25° field-of-view cone (e.g. on the starting grid), the fan ended short in mid-air even though the road ahead was open, making the "laser length" look very different per car (the three cars in #30 read 1223/770/578 mm due to their lateral offsets). After the fix the fan is drawn per direction out to the actual wall/other car, so open directions extend to the range limit (2 m tabletop) and walled directions terminate on the wall (no more mid-air endings). The ranging values the learning programs read (the RC_read family = nearest reflecting surface in the fan), the hit marker, and the numeric label are all unchanged. The physics, the deterministic hashes f0–f3, and official/canonical records are all unchanged.', h: '0eda75f3' },
  { v: 'v4.0.1', note: '物理モデル解説 (docs/physics_model.md 日英) に、v4.0.0 のエンジン改良で反映漏れていた項目を補完した (記載漏れの是正・物理は不変)。①精密 v2 の車輪回転 ODE の半陰的化 (卓上/中スケールでサブステップ数を約1/9に削減して高速化・フルスケールと低グリップは従来どおり陽的) を §13.2 に明記。②勾配 (坂道) の物理の節 (§13.9) を新設: 重力を世界座標の坂方向へ射影する登坂減速/下降加速・峠コースの道追従な坂方向・elev との g·sinθ 整合。あわせて「エンジン (走行物理) を改修したら物理モデル解説へ反映し『質問・提案』経由で GitHub にも記載する」運用を定めた。ロジックは不変で、卓上既定の物理・決定論ハッシュ f0〜f3・公式/正準記録はすべて再現する。', noteEn: 'Filled in items in the physics-model guide (docs/physics_model.md, Japanese and English) that had been left out of the v4.0.0 engine improvements (a documentation-omission fix; the physics is unchanged). (1) Documented the semi-implicit integration of the precision-v2 wheel-rotation ODE in §13.2 (cutting the sub-step count to about 1/9 for a speedup in the tabletop / mid-scale regimes; full scale and low grip stay explicit as before). (2) Added a slope (gradient) physics section (§13.9): projecting gravity onto the world-frame slope direction so climbs decelerate and descents accelerate, the road-following slope direction on touge courses, and g·sinθ reconciliation with elev. Also established the practice that "when the engine (driving physics) is modified, it is reflected in the physics-model guide and recorded on GitHub via the Q&A channel". The logic is unchanged, and the default tabletop physics, the deterministic hashes f0–f3, and official/canonical records all reproduce.', h: 'bb42eefd' },
  { v: 'v4.0.0', note: 'シミュレータの品質・性能を全域で底上げする大改修 Stage AP を実施した (品質最優先の新方針の初適用)。過去の再現性に関わるエンジン改良・パラメータ追加を含むため本メジャー版とした: 卓上の既定エンジンと公式・正準レースの決定論 (凍結ハッシュ f0〜f3) は完全に不変で従来の記録はそのまま再現するが、峠コース (下り較正のやり直し)・勾配走行の精密v2・卓上v2 を任意選択したときの走行だけは挙動が変わり、当時の記録は「(当時 vX)」注記付きで正直に保持される (改変しない)。主な内容: ①練習ベスト記録を版・条件 (エンジン/タイヤ/路面/コース・車種ハッシュ) 付きの時点記録にし、版をまたいだ誤解を防止した (NaN で記録更新が永久停止する不具合も修正)。②性能: 距離センサーの tick 単位キャッシュ・壁のブロードフェーズ・精密v2 の毎サブステップ不変量巻き上げ・卓上v2 の半陰的化 (サブステップ数を約1/9に削減し大幅高速化) でフレーム余裕を大きく広げた。③精密v2 の勾配モデルを実物理へ忠実化 (世界方向・登坂・静止転動・勾配輪荷重) し、峠の下り較正を g·sinθ で整合させ現実的な勾配に正した。④学習用インタプリタを大幅強化: C は配列/switch/do-while/ビット演算/16進・指数リテラル/pow、Arduino の millis/map/constrain/#define に対応。Python は len/append/f-string/for-in/dict/int/str メソッド/math/random/time に対応。さらに黙って誤動作していた意味論 (Python 負index・連鎖比較・文字列演算・0除算) を是正し、実行時エラーに行番号と英訳を付けた。⑤センサーを実機 VL53L0X に寄せる任意設定 (更新レート/レイテンシの sample-and-hold・外れ値/距離依存の欠測・他車反射) を追加した (既定 OFF ゆえ既定の決定論は不変)。⑥データ保全 (全設定・記録の一括エクスポート/インポート)・UI 安全化 (車種名の XSS 対策・保存失敗の可視化)・Python 入門サンプルの追加・公式レース正準実行ツール。⑦内部整備: main.js のモジュール分割・重複実装の統合・凍結ハッシュの中央マニフェスト化と刻み直しツール・常設ゲート標準ランナー・ドキュメント/エクスポート面の棚卸し。あわせて版番号に意味を持たせる3桁方式を定めた (1桁=過去再現性を壊すエンジン改良/パラメータ追加・2桁=その他の改良・3桁=表示等ロジック以外の是正・上位桁更新で下位桁は0リセット) ＝本版はその最初のメジャー適用。', noteEn: 'Carried out Stage AP, a broad overhaul that raises the simulator\'s quality and performance across the board (the first application of the new quality-first policy). Because it includes engine improvements and parameter additions that affect past reproducibility, this is a major version: the tabletop default engine and the deterministic official/canonical races (frozen hashes f0–f3) are completely unchanged and existing records reproduce as before, but only driving on touge courses (downhill recalibration), sloped precision-v2, and opting into tabletop v2 changes behavior — records from that time are honestly kept with an "(as of vX)" note (never altered). Highlights: (1) Practice-best records are now point-in-time records stamped with version and conditions (engine/tire/road/course & car-type hashes), preventing cross-version misunderstanding (also fixed a bug where a NaN permanently froze record updates). (2) Performance: per-tick caching of the distance sensors, wall broadphase, hoisting per-substep invariants in precision v2, and semi-implicit integration of tabletop v2 (cutting substeps to about 1/9 for a large speedup) greatly widen the frame-time headroom. (3) The precision-v2 slope model was made faithful to real physics (world-direction, climbing, standstill rolling, slope wheel-load), and the touge downhill calibration was reconciled to g·sinθ with corrected, realistic gradients. (4) The learning interpreter was substantially strengthened: C now supports arrays/switch/do-while/bit operations/hex & exponent literals/pow and Arduino millis/map/constrain/#define; Python supports len/append/f-strings/for-in/dict/int/str methods/math/random/time. Silently misbehaving semantics (Python negative index, chained comparison, string arithmetic, divide-by-zero) were corrected, and runtime errors gained line numbers and English translations. (5) Optional settings that bring the sensors closer to the real VL53L0X (update-rate/latency sample-and-hold, outliers/range-dependent dropout, other-car reflection) were added (default OFF, so the default determinism is unchanged). (6) Data preservation (bulk export/import of all settings and records), UI hardening (XSS protection for car-type names, visibility of save failures), new Python beginner samples, and an official-race canonical-run tool. (7) Internal cleanup: splitting main.js into modules, merging duplicate implementations, a central manifest and re-freeze tool for the frozen hashes, a standard runner for the standing gates, and an inventory of the docs/export surface. A three-digit versioning scheme was also established (1st digit = engine improvements/parameter additions that break past reproducibility; 2nd = other improvements; 3rd = non-logic fixes such as display; an upper-digit bump resets the lower digits to 0) — this version is its first major application.', h: '4ef70179' },
  { v: 'v3.57.1', note: '精密 v2 エンジン化 (v3.57.0) に追随できていなかった説明・UI 文言の齟齬を是正した (表示文言のみ・物理は不変)。①物理エンジンセレクトと切替ログの「精密 v2 (実験)…開発中」を除去し「精密 v2 (Stage AO・フルスケール推奨)」に統一 (Stage AO で完成・本番昇格・フルスケール自動切替済のため「開発中」は事実誤り)。②「仕様と制限」ダイアログの車両物理説明を、旧「動力学モデル OFF でクラシックに切替」= 2エンジンのトグル前提から、3エンジン (クラシック/動力学/精密 v2) のセレクト説明へ改め v2 を明記。③システム仕様の主要モジュール列挙 (sys.arch.body カタログ＋index.html インライン) に physics_v2.js＋contact_v2.js を追加。④物理モデル解説 §10「実装を読む」とアプリ内クレジットに v2 実装・v2 エンジンを追記 (docs/physics_model.md との不整合を解消)。⑤CLAUDE.md の主要ソースパスに v2 実装を追記。日英とも修正し、i18n 陳腐化ゲート (wf_i18n_check.mjs) で h 再計算・日英同期を機械確認。卓上物理 byte・決定論レース verifyHash f0〜f3 はいずれも不変。物理は不変。', noteEn: 'Corrected residual explanation/UI-text drift that had not followed the switch to the precise v2 engine (v3.57.0) (display text only; the physics is unchanged). (1) Removed "Precise v2 (experimental) … in development" from the physics-engine selector and the switch log, unifying it to "Precise v2 (Stage AO, recommended for full-scale)" ("in development" was factually wrong since Stage AO completed it, promoted it to production, and auto-switches to it at full scale). (2) Updated the vehicle-physics description in the "Specs and limits" dialog from the old two-engine toggle premise ("turning the Dynamics model OFF switches to Classic") to the three-engine (Classic / Dynamics / Precise v2) selector, explicitly naming v2. (3) Added physics_v2.js + contact_v2.js to the main-module list in the system spec (the sys.arch.body catalog entry and the index.html inline fallback). (4) Added the v2 implementation and engine to the physics-model guide §10 "read the implementation" and the in-app credit (resolving the mismatch with docs/physics_model.md). (5) Added the v2 implementation to the main source paths in CLAUDE.md. Both languages were fixed, with h recomputed and Japanese/English sync machine-verified by the i18n staleness gate (wf_i18n_check.mjs). The tabletop physics bytes and the deterministic-race verifyHashes f0–f3 are all unchanged. The physics is unchanged.', h: '2f01084e' },
  { v: 'v3.57.0', note: '走行エンジン v2 プロジェクト (Stage AO) の締めくくりとして、ドキュメントと解説を精密 v2 エンジンの実態に揃え、仕上げの全域監査で見つかった穴も塞いだ (卓上既定の物理 byte・決定論レース verifyHash f0〜f3 はいずれも不変)。①物理モデル解説 (docs/physics_model.md・日英) に v2 章 (§13) を新設: 4輪 two-track (輪別荷重・デフ・車輪ODE)・インパルス接触 (CCD・運動量交換)・フルスケール較正・タイヤセット normal/slip・路面 muDecay・タイヤ熱/摩耗・「既定では何も変わらない」決定論と互換性・そして v2 で測って分かった正直な結論の総括 (ドリフトはグリップに勝てない=20セル全 NO-GO 表 docs/stage_ao/drift_gonogo.md・姿勢βは地図があっても読めない・位置は周回内~0.5区画まで解ける・精密な速度プロファイル計画は均一コースでは概ね中立)。§10 に地図事前分布つきβ再挑戦の NO-GO、§11 に v2 の go/no-go 表参照も追記。②英語版解説に v3.50.0 の ToF 視野コーン章 (§12) が漏れていたのを補完し日英を完全同構成に。③アプリ内の物理解説 §1 が「2つのモデル」のままだったのを3エンジン (クラシック/動力学/精密v2) に是正。④レースガイドに「装備と条件」節を新設: エンジン・タイヤ・試走・摩耗が記録に刻まれ同条件で再現/検証されること、既定のままなら従来と byte 単位で一致することを明記。⑤v2 検証ゲート一式 (wf_ao1〜ao12・公開面互換/摩擦円不変条件/エネルギー監査/貫通ゼロ/運動量保存/較正帯/go-no-go/自己位置/摩耗) と v2 エンジン本体・測定正本をリポジトリ追跡に昇格。⑥仕上げに全 AO 横断監査 (9次元 fan-out) を行い、見つかった不整合を全て是正: 精密 v2 で事故車・発走待ち車を後続車が車の並び順によってはすり抜けられた接触の穴を修正 (凍結済み決定論ハッシュ f0〜f3 は不変=既存記録に影響なし・回帰ゲートを常設)、Apex Strategist のプログラム解説が生キー表示になる翻訳カタログ欠落を補完、フルスケールで手動選択した動力学エンジンが共有 URL の受信側で v2 に昇格してしまう非対称を修正 (既定の URL は不変)、docs の測定値の転記ゆれ (β符号一致 14%・絶対位置 3.12 区画・go/no-go 表の比率帯) を検証ゲートの実出力へ統一。物理の既定挙動は不変 (卓上 byte・決定論レース verifyHash f0〜f3・既定の共有 URL いずれも不変を全ゲートで機械確認)。', noteEn: 'Closing out the driving-engine v2 project (Stage AO), the documentation and guides were brought in line with the precise v2 engine as built, and the holes found by a final full audit were closed (the default tabletop physics bytes and the deterministic-race verifyHashes f0–f3 are all unchanged). (1) The physics-model guide (docs/physics_model.md, Japanese and English) gains a new v2 chapter (§13): the four-wheel two-track body (per-wheel loads, differential, wheel ODE), impulse contact (CCD, momentum exchange), full-scale calibration, tire sets normal/slip, the road attribute muDecay, tire heat/wear, "with defaults nothing changes" determinism and compatibility, and an honest summary of what v2\'s measurements settled (drift cannot beat grip = the all-NO-GO 20-cell table docs/stage_ao/drift_gonogo.md; attitude β cannot be read even with a map; position is solvable to ~0.5 bins within a lap; precise speed-profile planning is roughly neutral on a uniform course). §10 gains the map-prior β re-challenge NO-GO and §11 the v2 go/no-go table reference. (2) The English guide was missing v3.50.0\'s ToF field-of-view cone chapter (§12); it is now added, making the two languages structurally identical. (3) The in-app physics dialog §1 still said "two models"; corrected to the three engines (Classic / Dynamics / Precise v2). (4) The race guide gains an "Equipment and conditions" section stating that engine, tires, recon, and wear are stamped into records and replayed/verified under the same conditions, and that with defaults everything matches byte-for-byte. (5) The v2 verification gates (wf_ao1–ao12: public-surface compatibility, friction-circle invariants, energy audit, zero tunneling, momentum conservation, calibration bands, go/no-go, localization, wear), the v2 engine sources, and the measurement references were promoted to repository tracking. (6) A final cross-cutting audit of all of Stage AO (a nine-dimension fan-out) was run and every inconsistency it found was fixed: a contact hole in precise v2 where, depending on car ordering, a following car could pass through a crashed or gate-held car (the frozen deterministic hashes f0–f3 are unchanged = no effect on existing records; a regression gate is now permanent); the missing translation-catalog entries that made the Apex Strategist program description show raw keys; an asymmetry where a manually selected Dynamics engine at full scale was promoted to v2 on the receiving side of a share URL (default URLs are unchanged); and transcription drift in measured numbers across the docs (β sign agreement 14%, absolute position 3.12 bins, the ratio band in the go/no-go table), unified to the actual output of the verification gates. The default physics behavior is unchanged (tabletop bytes, deterministic-race verifyHashes f0–f3, and default share URLs all machine-verified unchanged by the full gate suite).', h: 'bb130233' },
  { v: 'v3.56.0', note: 'タイヤの熱・摩耗を任意で有効にできる『タイヤ摩耗』モデルを追加した (Stage AO12・精密 v2 エンジン向け・既定 OFF)。ON にすると、輪ごとに接地タイヤの「滑り仕事率」(タイヤが路面を擦る強さ×滑る速さ) から温度と摩耗を決定論的に積み上げ、限界グリップを温度 (冷え/最適/過熱) と摩耗で少しずつ変調します。核心は『ドリフトは後輪を消耗する』こと=激しく滑らせるほど後輪が減り、常時ドリフト戦略は長丁場でグリップを失って自滅しうる=タイヤが「使いどころを選ぶ戦略資源」になります。実測では、同じ時間だけ走らせたとき ドリフト周回 (スリップタイヤ FR で滑らせ続ける) の後輪摩耗は グリップ周回 (穏やかに転がす) の数万倍で、狙いどおり後輪だけが顕著に減ります (前輪はほとんど減らない)。ただし合計効果は 10% 以内にクランプしてあり (支配しない設計)、勝敗は依然として走りで決まります——摩耗はグリップ限界を最大 10% 削るだけで、限界内で丁寧に走れば大きな不利にはなりません。HUD には輪ごとの摩擦円利用率 (どれだけグリップを使い切っているか)・温度・摩耗が 2×2 のタイヤ図で出ます (表示のみ=物理は HUD を読み戻しません)。既定 OFF では一切の挙動・ハッシュが従来と完全に一致します (卓上物理 byte・決定論レース verifyHash f0〜f3・設定共有 URL いずれも不変)。摩耗を有効にした記録は verifyHash と公式開催記録に刻まれ、そのまま再現・検証できます。物理は不変 (既定 OFF)。', noteEn: 'Added a "Tire wear" model you can optionally enable (Stage AO12; for the precision v2 engine; default OFF). When ON, each wheel deterministically accumulates temperature and wear from the contact tire\'s "slip power" (how hard the tire scrubs the road × how fast it slides), and peak grip is modulated slightly by temperature (cold / optimal / overheated) and wear. The core idea is that "drifting consumes the rear tires": the harder you slide, the more the rears wear, so an always-drift strategy can lose grip and self-destruct over a long stint = tires become a "strategic resource you spend wisely". Measured, for the same amount of running time, the rear wear of a drift stint (sliding continuously on slip tires, FR) is tens of thousands of times that of a grip stint (rolling gently), so — as intended — only the rears wear noticeably (the fronts barely wear). But the total effect is clamped to within 10% (by design it never dominates), so results are still decided by driving — wear shaves at most 10% off the grip limit, and driving tidily within the limit is not a big handicap. The HUD shows each wheel\'s friction-circle usage (how much of the grip is being used up), temperature, and wear in a 2×2 tire diagram (display only; the physics does not read the HUD back). With the default OFF, every behavior and hash is exactly as before (tabletop physics bytes, the deterministic-race verifyHashes f0–f3, and share URLs are all unchanged). A record that enabled wear has it stamped into the verifyHash and the official event record, so it reproduces and verifies as-is. The physics is unchanged (default OFF).', h: '9c1fc087' },
  { v: 'v3.55.0', note: '試走(recon)で覚えた地図から速度プロファイルを計画して先読み最速で周回する戦略レーサー『Apex Strategist』を追加した (Stage AO11・上級 Python サンプル)。走りの土台は「recon で"踏める"と分かったコースを反応型で攻めチューンする」ことです: 標準の Circuit Racer は精密動力学 v2 で全舵=切りすぎスピンを避けるため保守的に組み一定速(~31m/s)で流しますが、Apex Strategist は直線を踏み切り(pwm 255)、操舵中だけ出力を抑えて前輪の空転→巻き込み(オーバーステア)を防ぎます。これで標準 Circuit Racer 比 約11〜22% 速く周回します(クラッシュ0)。加えて、曲率代理(各バケツで実際に舵を当てていた割合)から速度プロファイル vmax=前進/後退パス(O(N))を計画し、きつい区間の手前でスロットルを絞る「加速ガバナ」に使います。戦略ドリフト状態機械・他車の残差ゲーティング検知・TTC(衝突余裕時間)制動ガードも実装しています。正直な実測(Stage AO8/AO10 と同型に隠さない): このコースは4コーナー全部 R≈116m と均一で"どのコーナーを速く"の差が無く、ToF 自己位置も幅28m・2回対称の超楕円では loop closure(周回の閉じ込み)が粗い(数バケツ=AO10 の絶対位置限界と同根)ため、地図で更に踏み込む「精密な後追い制動」は安全に成立しません。ゆえに速さの大半は"recon が保証する攻めチューン"で生まれ、精密な速度プロファイルの純利得はこの清潔なコースでは概ね中立でした(加速ガバナは安全側の保険)。戦略ドリフトは AO8 の go/no-go 実測どおり最小 R≈116m ≫ 6.4m(車の最小回転半径×1.1)ゆえ発動区間が無く、状態機械は常に grip・非発動になります(=速いのは正確な grip、drift は限界を超えた時だけ・ここでは出番なし、を正直に見せる)。他車3台(Circuit Racer)との混走でも全車完走・追突誘発ゼロ、エンコーダ未装備なら地図を作れず反応型(攻めチューン)へフォールバックします。卓上(初心者教材)の物理 byte・決定論レースの verifyHash(f0〜f3)・設定共有 URL はいずれも不変です(追加はフルスケール競技サンプル1本のみ)。物理は不変。', noteEn: 'Added "Apex Strategist", a strategy racer that plans a speed profile from a course map learned during recon and laps fastest by looking ahead (Stage AO11, an advanced Python sample). Its foundation is "aggressively tuning reactive driving on a course recon has shown is floor-able": the standard Circuit Racer, to avoid full-lock over-steer spins under the precision-dynamics v2 engine, is tuned conservatively and cruises at a constant ~31 m/s, whereas Apex Strategist floors the straights (pwm 255) and throttles back only while steering to prevent the front wheels from spinning up into wrap-in (oversteer). This laps about 11–22% faster than the standard Circuit Racer (zero crashes). In addition, from a curvature proxy (the fraction of each bucket in which steering was actually applied) it plans a speed profile vmax via forward/backward passes (O(N)), used as an "acceleration governor" that eases the throttle ahead of tight sections. It also implements a strategic-drift state machine, residual-gating detection of other cars, and a TTC (time-to-collision) braking guard. Honestly measured (not hidden, same as Stage AO8/AO10): this course has all four corners at a uniform R≈116 m, so there is no "which corner to take faster" to exploit, and ToF self-localization on the 28 m-wide, 2-fold-symmetric superellipse has coarse loop closure (a few buckets — the same root as AO10\'s absolute-position limit), so "precise trailing braking" that would push harder from the map cannot be done safely. Thus most of the speed comes from the "aggressive tuning that recon guarantees", and the net gain of the precise speed profile was roughly neutral on this clean course (the acceleration governor is a safety-side insurance). The strategic drift, per AO8\'s measured go/no-go, finds no activation zone because the minimum R≈116 m ≫ 6.4 m (the car\'s minimum turning radius × 1.1), so the state machine is always grip and never fires (honestly showing: what is fast is precise grip, and drift is only for beyond-the-limit — with no role here). Even mixed with three other cars (Circuit Racers) all finish with zero induced rear-ends, and without a wheel encoder it cannot build a map and falls back to reactive (aggressive-tuned) driving. The tabletop (beginner) physics bytes, the deterministic-race verifyHashes (f0–f3), and share URLs are all unchanged (the only addition is one full-scale competition sample). The physics is unchanged.', h: 'afa2ed01' },
  { v: 'v3.54.0', note: '前方3つの距離センサー(ToF)と車輪エンコーダだけで「今コースのどこにいるか(スタートからの周回距離)」を推定する研究サンプル『Self-Locator』を追加した (Stage AO10)。仕組みは実車の自己位置推定と同じで、①1周目に各地点の前方/左右の壁距離を距離目盛りの「指紋」として覚え ②方位が一周ぶん回りスタートの壁パターンに戻ったら1周と判定(loop closure=1周の長さを確定)し ③2周目以降はエンコーダで進めた確率分布(1次元ヒストグラム)を前方3センサーの指紋照合で補正して、分布のピークで自己位置と信頼度を出します。前方/側方が覚えた壁より有意に近ければ他車と見なし位置更新から外します(残差ゲーティング=壁は位置に・地図差分は他車に)。正直な実測(隠さない): 周回内の相対位置(=次コーナーまでの距離＝先読みに効く量)は約0.5bin(9m/1周2057m)と高精度で、他車5台混走でも約0.8bin・前方検知recall96%・発散なし。ただしこの清潔なコースでは ToF照合はエンコーダ単独に勝てず(観測はむしろ追従ノイズを足す)、位置の骨格はエンコーダのデッドレコニング、ヒストグラムは軽い補正＋信頼度＋他車分離の役でした。周回の原点(絶対位置)は loop closure の ToF ノイズで周ごとに約2.6bin(46m)ブレる=これが ToF 閉じ込みの原点精度限界です。方位/横滑り角βは地図事前分布つきでも推定できませんでした(Phase J1 と同じ=符号が当たらない)。卓上物理 byte・決定論レース verifyHash(f0〜f3)・設定共有 URL はいずれも不変。地図を前提に最速化するのは今後の Apex Strategist へ。', noteEn: 'Added "Self-Locator", a research sample that estimates "where you are on the course now (lap distance from the start)" using only the three forward distance sensors (ToF) and the wheel encoder (Stage AO10). It works like real self-localization: (1) on lap 1 it memorizes each spot’s forward/left/right wall distances as a distance-indexed "fingerprint"; (2) when the heading has wound a full turn and the wall pattern returns to the start’s, it declares one lap (loop closure = fixing the lap length); and (3) from lap 2 it advances a probability distribution (a 1-D histogram) by the encoder and corrects it by matching the three forward sensors to the fingerprints, reporting position and confidence from the distribution’s peak. If the forward/side reading is significantly closer than the memorized wall, it is treated as another car and excluded from the position update (residual gating = walls for position, map differences for other cars). Honestly measured (not hidden): the within-lap relative position (distance to the next corner — what look-ahead needs) is about 0.5 bin (9 m over the 2057 m lap), and even with five other cars it is about 0.8 bin with 96% forward-detection recall and no divergence. But on this clean course, ToF matching cannot beat the encoder alone (the observation actually adds tracking noise): the backbone of position is the encoder’s dead-reckoning, and the histogram serves as a light correction plus confidence plus other-car separation. The lap origin (absolute position) drifts about 2.6 bin (46 m) lap-to-lap from ToF noise at loop closure — this is the origin-precision limit of ToF loop-closure. Heading/side-slip angle β still could not be estimated even with a map prior (same as Phase J1 — the sign is not recovered). Tabletop physics bytes, the deterministic-race verifyHashes (f0–f3), and share URLs are all unchanged. Racing fastest from a pre-built map is for the upcoming Apex Strategist.', h: 'e7ea6531' },
  { v: 'v3.53.0', note: 'レース前に各車がコースを単独で下見する『試走 0〜3周』を追加した (Stage AO9)。実車のレースが本番前にコースを試走(recon)するのと同じで、試走で覚えた地図をそのまま本番へ持ち込みます。設計は ①各車が単独で走る (他車なし) ②計時外 (本番タイムに一切足さない) ③打ち切っても DNF にしない (部分地図のまま本番＝正直) ④同じ設定なら決定論的に完全再現、の4点です。コースを学習するプログラム (Recon Racer 等) は、試走ありなら本番1周目から覚えた地図で先読み走行に入れます (試走なしは1周目が学習)。ただし正直な実測として、Recon Racer 自身は本番1周目に自前で下見する自己完結型なので、事前試走は概ね冗長でした (タイムはほぼ変わらない)——この機構の真価は『地図を前提に速度プロファイルを計画する』戦略プログラム (今後の上級サンプル) 向けです。試走 0 (既定) では一切の挙動・ハッシュが従来と完全に一致します (卓上物理 byte・決定論レース verifyHash f0〜f3・設定共有 URL いずれも不変)。試走を使った記録は verifyHash と公式開催記録に試走周回数が刻まれ、そのまま再現・検証できます。物理は不変。', noteEn: 'Added "Recon 0–3 laps", where each car scouts the course alone (recon) before the race (Stage AO9). Just as a real race runs a recon of the course beforehand, the map learned during recon is carried straight into the race. The design has four points: (1) each car runs alone (no other cars); (2) it is off-clock (adds nothing to the race time); (3) if cut off it is not a DNF (you race with the partial map — honest); and (4) it is fully reproduced deterministically for the same settings. Course-learning programs (e.g. Recon Racer) can, with recon on, enter the race driving with look-ahead from the learned map on lap 1 (without recon, lap 1 is the learning lap). Honestly measured, though, Recon Racer itself is self-contained — it scouts on its own during race lap 1 — so pre-recon is largely redundant for it (times barely change); the real value of this mechanism is for strategy programs that "plan a speed profile from a pre-built map" (an advanced sample to come). With Recon 0 (the default), every behavior and hash is exactly as before (tabletop physics bytes, the deterministic-race verifyHashes f0–f3, and share URLs are all unchanged). A record that used recon has the recon lap count stamped into the verifyHash and the official event record, so it reproduces and verifies as-is. The physics is unchanged.', h: '2be245c7' },
  { v: 'v3.52.0', note: 'フルスケール競技領域の走行エンジンを、新しい精密動力学エンジン『v2』(4輪 two-track・忠実な荷重移動・インパルス接触) に切り替えたのに合わせて、実寸サーキットの競技サンプルプログラムを v2 向けに再チューンした (Stage AO)。卓上 (初心者教材) の既定エンジンとノーマルタイヤの物理 byte・決定論レースの verifyHash は完全に不変で、変わるのはフルスケール領域を選んだときだけです。v2 は実車どおり荷重移動を忠実に解くため、旧エンジンでは見えなかった挙動が現れます: 3値ステア (左/中央/右) の『全舵』は、この大R コーナー (直線×4+大きな角丸) には切りすぎで、後輪の横グリップを破ってオーバーステア→スピン (β→180°) します。対策は操舵を脈打たせる『全舵デューティ変調』——2ループに1回だけ実際に舵を当て残りは中央に戻すことで、実効的な舵角を半分に薄め、大R にちょうど合った素直な旋回にします (あわせて旋回中の速度上限も下げる)。これで『Circuit Racer』『Range-Flow Estimator』『Recon Racer』はいずれも清潔に (スピンなし・リカバリ0で) 周回し、しかも旧エンジン基準より速くなりました (実測: Circuit Racer / Range-Flow Estimator 約69秒・Recon Racer 約88秒/β2°)。教訓: 操舵の『強さ』は連続量。3値しか無くても『当てる割合 (デューティ)』で実効舵角を作れる——センサー (実機コーン) だけでなくエンジン (物理) が変わっても、プログラムは新しい挙動へ合わせ直す、という教材です。ドリフト演目 (Sustained Drift / Slip Attack) は、この高速な実寸コーナーでは最初のコーナーでスピンします: ToF×3+3値ステアでは姿勢を読めず逆ハンできない=持続ドリフト不成立、という正直な限界は v2 でも不変で、むしろ荷重移動が忠実なぶん一層はっきり出ます (=最速レースにはグリップの弱アンダー FF が有利・ドリフトは不利、という物理が創発)。ドリフトの意味/利点を安全に学ぶ環境として卓上スリップタイヤ (低速で滑りを保てる) を用意しています。あわせて、フルスケール v2 の決定論を凍結する新しい基準ハッシュ (f2=競技サーキット×3車種×normal タイヤ・f3=ドリフト FR×slip タイヤ) を常設ゲートに追加しました。物理は不変 (卓上既定)。', noteEn: 'Switched the driving engine for the full-scale competition regime to a new precision-dynamics engine, "v2" (4-wheel two-track, faithful load transfer, impulse contacts), and re-tuned the real-scale circuit\'s competition sample programs for it (Stage AO). The tabletop (beginner) default engine and normal-tire physics bytes, and the deterministic-race verifyHashes, are completely unchanged — things differ only when you select the full-scale regime. Because v2 solves load transfer faithfully like a real car, behavior the old engine hid now appears: the "full lock" of 3-value steering (left/center/right) is too much steering for these large-radius corners (4 straights + a big rounded square), breaking the rear tires\' lateral grip into oversteer → a spin (β→180°). The fix is to pulse the steering — "full-lock duty modulation": apply lock only once every two loops and return to center the rest, thinning the effective steer angle by half into a clean turn matched to the large radius (and also lowering the cornering speed cap). With this, "Circuit Racer", "Range-Flow Estimator", and "Recon Racer" all lap cleanly (no spin, zero recoveries) and are even faster than the old-engine baseline (measured: Circuit Racer / Range-Flow Estimator about 69 s; Recon Racer about 88 s / β2°). The lesson: the "strength" of steering is a continuous quantity — even with only 3 values you can build an effective steer angle from the "fraction applied (duty)"; just as with the sensor (a real-device cone), when the engine (physics) changes the program too must be re-fitted to the new behavior. The drift show routines (Sustained Drift / Slip Attack) spin at the first corner on these fast real-scale corners: the honest limit — that with ToF×3 + 3-value steering you cannot read attitude and cannot counter-steer, so sustained drift is not achievable — holds under v2 too, and shows even more clearly now that load transfer is faithful (the physics that a mildly understeering grip FF is favored for the fastest, safest race while drift is disfavored emerges on its own). As an environment to safely learn the meaning/advantage of drift, a tabletop slip-tire mode (which can hold a slide at low speed) is provided. Alongside this, new reference hashes that freeze the full-scale v2 determinism (f2 = competition circuit × 3 car types × normal tire; f3 = drift FR × slip tire) were added to the standing gate. The physics is unchanged (tabletop default).', h: 'b817bec6' },
  { v: 'v3.51.0', note: 'フルスケール競技サンプルの「最速プログラム」を、視野コーン (25°) 測距に合わせて再チューンした (Stage AN・GitHub #27 関連)。Stage AM で距離センサーを実機 VL53L0X 相当の 25° 視野コーンにした結果、実寸サーキットでは前方センサーの読みが直線レイ時代の約半分になります (扇が近いコーナー内側を先に捉えるため。実測: 中央センサーで cone/thin≈48%・全ポーズで短縮)。そのため、直線レイの距離に合わせて較正していた『Circuit Racer』『Recon Racer』『Range-Flow Estimator』は、コーン化後は「常に壁が近い」と誤認して早すぎるブレーキ・操舵でラインを失い、スピンして大きく遅くなっていました (Circuit Racer で実測 61→160秒・スピン)。判定距離のしきい値を約半分へ下げて再チューンし、いずれも清潔に周回するようにしました (実測: Circuit Racer 90.8秒/リカバリ0/スピンなし・Recon Racer 89.2秒/0・Range-Flow Estimator 90.8秒/0)。コーンは実機に忠実なぶん遠くを見通せない (直線レイは非現実的に約150m先の壁まで見えていた) ので、コーン後のタイムが直線レイ時代より遅いのは正直な帰結です=理想化に合わせた較正は、センサーを実機に近づけた瞬間にズレる。現実に忠実にするほど、プログラム側も実機の見え方へ合わせ直す (実機に載せ替えるときと同じ作業)、という教材になっています。ドリフト演目 (Sustained Drift / Slip Attack) はコーン下でもクラッシュせず完走します (もともと ToF だけで全周ドリフトは成立しない、という正直な設計どおり)。卓上 (初心者教材) の物理 byte と決定論レースの verifyHash は不変です (変更はフルスケール競技プログラムの定数・コメントのみ)。物理は不変。', noteEn: 'Re-tuned the full-scale competition "fastest programs" to match the 25° field-of-view cone ranging (Stage AN; related to GitHub #27). After Stage AM made the distance sensor a real-VL53L0X-like 25° cone, on a real-scale circuit the forward sensor reads about half of what the old zero-width ray did (because the fan catches the near inside of a corner first; measured: cone/thin ≈ 48% on the center sensor, shorter at every pose). So "Circuit Racer", "Recon Racer", and the "Range-Flow Estimator" — calibrated to the straight-ray distances — after cone ranging mistook it for "a wall is always close", braked/steered too early, lost the line, and spun and slowed badly (Circuit Racer measured 61 → 160 s, spinning). Halving the distance thresholds re-tuned them so all lap cleanly (measured: Circuit Racer 90.8 s / 0 recoveries / no spin; Recon Racer 89.2 s / 0; Range-Flow Estimator 90.8 s / 0). A cone, being faithful to the real device, cannot see as far (the straight ray unrealistically saw walls ~150 m ahead), so the post-cone times being slower than the straight-ray era is an honest consequence: a calibration tuned to the idealization drifts the moment you bring the sensor closer to the real device. The more faithful to reality, the more the program too must be re-fitted to how the real device sees — the same work as porting to real hardware. The drift show routines (Sustained Drift / Slip Attack) still complete under the cone without crashing (as their honest design says, a full-lap drift is not achievable with ToF alone). The tabletop (beginner) physics bytes and the deterministic-race verifyHash are unchanged (the change is only constants/comments in the full-scale competition programs). The physics is unchanged.', h: '5982f797' },
  { v: 'v3.50.0', note: '距離センサー (ToF) を、これまでの「太さゼロの直線1本」から、実機 VL53L0X の視野に合わせた 25° の視野コーン (扇) として測距するようにした (Stage AM・GitHub #27)。#27「レーザーが壁の外に出る」の原因は、壁沿いに走ると道を横断する側の長いレイがタイトなコーナーの角のすぐ外を掠め、描かれた壁を素通りして遠くの壁で止まる (壁を突き抜けて見える) ことでした。これは計算方式の退行ではなく初期からの潜在で、実機の ToF は点ではなく 25° の広がりを持つコーンで「扇の中の最も近い反射面まで」を測るため、コーン化すると角の掠め抜けが原理的に起きなくなります (扇内最近距離を返すので、中心1本のレイより遠い値=壁の外へ伸びる値は出ません)。あわせて、①距離センサーの表示を扇 (コーン) にし、遠いほど淡くなる距離減衰グラデーションで塗り、扇内の最近反射面で終端するようにした (前方の照射が他車を隠さず、壁抜けが見た目でも消える)。②各サンプルプログラムが「信頼区間 (CONF)」パラメータを持ち、これを超える測距や範囲外 (-3) を『遠い/開放』とみなすようにした=実機 VL53L0X は地面反射などで遠方の値が信頼できないため。卓上コースは実機模型の約2.5倍スケールなので信頼区間は実スケール換算で約 640mm を既定にし、実機へ移すときは自機の車体・搭載高に合わせて約 250mm へ下げ、あわせて速度も落とす旨をコメントで明記 (フルスケール競技サンプルは実車レーダ相当の地平 150m を信頼区間に据える)。開ループ演目や車輪エンコーダで走るサンプルは測距航法をしないので信頼区間は設けません。③後方センサーも同じコーン測距。これは測距・走行・決定論を実機へ寄せる意図的な変更なので、卓上の物理 byte とレース記録の verifyHash を新しい値へ基準化し直し、記録には engine 版が刻まれるので旧記録は「当時の版で記録・現行版では完全再現しない可能性」の注記対象になります (改変せず条件付きで保持)。#27 の根治。', noteEn: 'Changed the distance sensor (ToF) from a single zero-width straight ray to a 25° field-of-view cone (fan) that matches the real VL53L0X\'s field of view (Stage AM; GitHub #27). The cause of #27 ("the laser goes outside the wall") was that, driving along a wall, the long ray on the road-crossing side grazed just outside the corner of a tight corner, slipped past the drawn wall, and stopped at a far wall (looking as if it pierced the wall). This was not a regression in the calculation but latent from the start; because a real ToF measures with a 25°-wide cone "to the nearest reflecting surface within the fan" — not a point — cone ranging makes the corner graze-through impossible in principle (it returns the nearest distance within the fan, so it never yields a value farther than the single center ray = a value that stretches outside the wall). Alongside this: (1) the distance sensor is now displayed as a fan (cone) filled with a distance-decay gradient that fades with range and terminates at the nearest reflecting surface within the fan (the forward beam no longer hides other cars, and the wall-piercing disappears visually too); (2) each sample program now has a "confidence interval (CONF)" parameter and treats readings beyond it, or out of range (-3), as "far / open" — because a real VL53L0X cannot be trusted at long range (ground reflection, etc.). Tabletop courses are about 2.5× the scale of the real model, so the confidence interval defaults to about 640 mm in real-scale-equivalent units, with a comment that when moving to the real device you lower it toward about 250 mm to match your body/mount height and slow down accordingly (the full-scale competition samples put the confidence interval at the ~150 m radar horizon of a real car). Open-loop show routines and wheel-encoder-driven samples do no ranging navigation, so they have no confidence interval. (3) The rear sensor uses the same cone ranging. This is an intentional change to bring ranging, driving, and determinism closer to the real device, so the tabletop physics bytes and the race-record verifyHashes are re-baselined to new values; since the engine version is stamped into records, older records fall under the "recorded on the version of its time; may not reproduce exactly on the current version" note (kept conditionally, not altered). The root fix for #27.', h: 'ee84da22' },
  { v: 'v3.49.0', note: '車両の表示を、レーシングカー風 (本体・前後ウイング・露出した4輪が分離した複数の塊) から、一体のスポーツカー・シルエットに置き換え、さらに6つの組込車種 (ノーマル/ドリフト × FR・FF・4WD) を一目で見分けられるよう車種別のシルエットにした (Stage AL)。本シミュレータは自動運転アルゴリズムの検証環境なので、狙いは走行時の見た目のリアルさと、複数台を走らせたときの認知性 (どの車がどれか一目で分かる) の向上です。従来の表示は複数の塊が分離して「車に見えない」帯があり、当たり判定の矩形フットプリントと見た目がずれていました。これを一体のボディで埋めてフットプリント充填率を上げ (既定スポーツカーで約85%→約98%)、描画が常に当たり判定の矩形の内側に収まる不変条件を、前輪の操舵範囲まで含めて機械ゲートで守るようにしました。車種の見分けは、共有ボディの上でグラスハウス (キャビン) 位置・ホイールベース・トレッド (スタンス幅)・ドリフト系のリアウイングといったプロポーション/可視特徴で付け、色と形の二重符号化にしました (色覚セーフ配色と相乗)。custom/未知の車種は既定スポーツカーで表示します。これは表示 (描画) 層のみの改修で、走行物理・接触/当たり判定・初期配置・決定論レース記録のハッシュはすべて byte 不変です (当たり/接触/配置は車体の外形矩形だけで判定し、形状を参照しないため)。物理は不変。', noteEn: 'Replaced the car display — from a racing-car look (separate blobs for the body, front/rear wings, and four exposed wheels) — with a single unified sports-car silhouette, and gave the six built-in car types (Normal/Drift × FR, FF, AWD) distinct silhouettes so they can be told apart at a glance (Stage AL). This simulator is an environment for verifying self-driving algorithms, so the aim is drive-time visual realism and, when running several cars, recognizability (knowing which car is which at a glance). The previous display had a band that "did not look like a car" because separate blobs were scattered, and it looked offset from the rectangular collision footprint. A single body now fills that in, raising the footprint fill ratio (from about 85% to about 98% for the default sports car), and a machine gate enforces the invariant that the drawing always stays inside the rectangular collision footprint, including across the front-wheel steering range. Car types are distinguished on a shared body by proportions / visible features — greenhouse (cabin) position, wheelbase, track (stance width), and a rear wing on the drift types — a dual coding of color and shape (synergizing with the color-blind-safe palette). Custom / unknown car types are shown with the default sports car. This is a display (rendering) layer change only; the driving physics, contact/collision judgment, initial placement, and deterministic race-record hashes are all byte-for-byte unchanged (collision/contact/placement are judged from the car\'s outline rectangle only and do not reference the shape). The physics is unchanged.', h: '6839cdf0' },
  { v: 'v3.48.0', note: '複数台で密集してスタートしたとき、1台が他車に押されて壁の角へ楽め込み、そのまま走り出せなくなる不具合を直した (Stage AK7・GitHub #26)。原因は「全車が密集グリッドから同時に発走し、1台が箱詰めになって壁ポケットへ刺さる」ことでした。直し方は発走の順次化 (anti-pile-up): 各車は自分の進行方向の前方が空くまで発走を待ち、前の車が離れたら発走します。これで密集グリッドが数珠つなぎにほどけて団子発走が起きなくなり、スタートで走り出せない車が解消しました。横並びのグリッド (正準レースなど「前に他車が居ない」配置) は発走保留に一切入らない構造なので、正準レース記録・公式フルスケール競技記録の verifyHash は完全に不変・卓上の物理 byte も不変です (後方に車を持つ多台レースの軌跡は順次発走により変わり得ますが、記録自体は改変せず保持)。さらに、最狭の「ナローシケイン・レイアウト」は「既定プログラム normal_fr が単独でコーナー壁へ舵を切り込む」スポーン位置が生じ配置では避けられないため、このコースだけ実際に走り出せる台数 (実走で測った実態容量=4台) へ自動調整します (他コースは6台のまま)。物理は不変。', noteEn: 'Fixed a bug where, starting several cars in a tight pack, one car could be shoved into a wall corner by the others and then be unable to drive off (Stage AK7; GitHub #26). The cause was that all cars launched simultaneously from a dense grid, and one got boxed in and wedged into a wall pocket. The fix is a sequential, anti-pile-up start: each car waits to launch until the lane ahead of it is clear, and launches once the car ahead pulls away. The dense grid then strings out instead of piling up, eliminating cars that cannot drive off at the start. Side-by-side grids (e.g. the canonical races, where no car is ahead of another) never enter the launch hold by construction, so the canonical and official full-scale records keep identical verifyHashes and the tabletop physics bytes are unchanged (multi-car races that have cars behind others may follow a different trajectory due to the sequential start, but the records themselves are not altered and are kept). In addition, the narrowest layout (the "Narrow Chicane Layout") has spawn positions where the default program normal_fr steers itself into a corner wall on its own (unavoidable by placement), so that one course auto-adjusts to the number of cars that can actually drive off (its real capacity, measured by an actual run = 4 cars); other courses stay at 6. The physics is unchanged.', h: 'b87aa0c8' },
  { v: 'v3.47.0', note: '複数台で走らせたとき、壁に刺さった車が「後退して切り返す」リカバリで逆に壁の方へ下がって永久に抜け出せなくなる不具合を直した (Stage AK・GitHub #26)。後退中はハンドルと車体の動く向きが前進と逆になる (舵を左へ切って下がるとリアは左へ寄る) のに、従来は前方センサーで切り返す向きを決めていたため、壁へ下がって何度もリカバリを繰り返していました。直し方は「実際に動ける向きへ下がる」: 同じ場所での切り返し回数に応じて まっすぐ後退→左→右 と向きを変え、原子棄却 (壁にめり込む一歩を丸ごと取り消す) のもとで実際に車体が動ける向きで抜けます。狭い楔では「後方が開いて見えても車体の角が壁に当たって動けない」ことがあるため、レイ測距でなくこの実動作で当てます。袋小路 (両側壁) では一定回数で一旦待避し他車を塞がないようにしてから再挑戦します (無限後退/振動・「全時間 壁張付き」をなくす)。これで発走時に壁へ刺さって走り出せない車が大幅に減りました (発走位置に永久固着する元の不具合は一掃)。決定論レース (固定60Hz) はリカバリを含むクリーンなレースのハッシュも含め完全に不変で、正準レース記録・公式フルスケール競技記録・卓上の物理 byte はすべて不変です。一方、卓上で壁にぶつかって切り返すレースは、より素直なリカバリにより当時とまったく同じ軌跡には再現されない場合があります (記録自体は改変せず保持)。物理は不変。', noteEn: 'Fixed a bug where, when running several cars, a car stuck against a wall could back itself further into the wall during its "reverse and turn out" recovery and never escape (Stage AK; GitHub #26). When reversing, the steering and the car\'s motion are mirrored versus going forward (turn the wheel left while backing and the rear goes left), yet the turn direction used to be chosen from the front sensors, so the car backed into the wall and looped recovery endlessly. The fix is to "reverse in a direction the car can actually move": the steer cycles straight-back → left → right by how many times it has retried in the same spot, and under atomic rejection (a step that penetrates a wall is undone whole) it escapes in whichever direction the body can actually move. In a tight wedge the rear can "look open" yet the body corner hits the wall, so this is decided by real motion rather than ray ranging. In a dead end (walls on both sides) it parks for a while so as not to block other cars, then retries (removing endless reversing / oscillation and the "stuck to the wall the whole time" look). This greatly reduces cars that get stuck against a wall at the start and cannot drive off (the original bug of permanent lock at the start position is eliminated). Deterministic races (fixed 60 Hz) are completely unchanged, including the hashes of clean races that involve recovery, so the canonical race records, official full-scale competition records, and tabletop physics bytes are all unchanged. However, tabletop races that bump a wall and turn out may no longer reproduce the exact same trajectory, due to the more straightforward recovery (the records themselves are not altered and are kept). The physics is unchanged.', h: 'e1f8f838' },
  { v: 'v3.46.0', note: '複数台で走らせるとき、コースの広さに対して台数が多すぎて一部の車が発走位置で壁にめり込んだまま走り出せない問題を、初期配置を「実態の収容容量」で持つことで根本から直した (Stage AK・GitHub #26)。これまでは「単独の車が外形のだいたい4分の1に収まるか」という代理の目安で判定し、最後の手段ではコース外形やスケールによっては壁の中のスタート地点をそのまま返していたため、湿った狭いコースに6台といった詰め込みで車が壁に刺さっていました。判定を、本物の配置計算で「N 台を実際に置いて全車が壁交差0・重なり0で並べられるか」という実態に置き換え、車体スケールを最小まで縮めても収まらない台数は無言で団子にせず、走り出せる最大台数へ自動で減らして理由を1行で知らせるようにしました (もっと並べたいときは大きいコースへ)。配置の最後の保険も、壁の中ではなく必ず壁に当たらない実在の点を返します。通常のコースは従来どおり全6台が収まるため、この自動調整は一切働きません (初期配置・卓上の物理 byte・公式レース記録のハッシュは不変)。物理は不変。', noteEn: 'Fixed, at its root, a problem where — when running several cars — too many cars for the course size left some embedded in the wall at their start position and unable to drive off, by holding the initial placement as the "actual capacity" (Stage AK; GitHub #26). It used to judge with a proxy ("does a single car fit within roughly a quarter of the course\'s smaller side") and, as a last resort, for some course shapes/scales returned the start point even when it was inside a wall, so packing e.g. 6 cars onto a damp, narrow course stuck them in the wall. The judgement is now the real thing — using the actual placement routine to ask "can N cars actually be placed with zero wall crossings and zero overlaps" — and any car count that still does not fit after shrinking the car scale to its minimum is no longer silently piled up: the field is automatically reduced to the largest number that can drive off, with a one-line note of why (switch to a larger course to line up more). The placement\'s last-resort fallback now always returns a real point clear of the walls, never one inside a wall. Normal courses still hold all 6 cars, so this auto-adjustment never fires (initial placement, tabletop physics bytes, and official race-record hashes are unchanged). The physics is unchanged.', h: '9a30a23c' },
  { v: 'v3.45.0', note: '走行モデルの衝突応答を一本化し、複数台で走らせたとき1台が初期位置で壁に刺さって走り出せなくなる不具合を根本から修正 (Stage AK・GitHub #26)。これまで物理は毎秒60回の細かさで進めるのに、壁・他車への当たり判定は描画フレームごとに1回しか行っていませんでした。そのためライブ走行 (特に多台・速い再生) では、当たりに気づくまでに車が進みすぎ、(a) フルスケールの高速で薄い壁をすり抜ける、(b) 角の車が前を塞がれて少しずつ回頭しながら自分の発走位置の壁にねじ込まれ二度と動けなくなる、が起きていました。判定を物理の各サブステップ (60分の1秒) ごとに行い、壁にめり込む一歩は向き (回転) ごと丸ごと取り消して「壁際で待つ」ようにしました。これでライブもレースも同じ一つのモデルで衝突を解決します。他車との接触だけは従来どおりわずかな回頭を残し、隣をすり抜けられる流れを保ちます (密集レースが団子で全車リタイアにならないように)。決定論レース (固定60Hz=1サブステップ) は判定回数が従来と完全に同一のため、正準レース記録のハッシュ・公式フルスケール競技記録・卓上の物理 byte はすべて不変です。一方、卓上で車が壁にクラッシュするレースは、より正直な壁処理により当時とまったく同じ軌跡には再現されない場合があります (記録自体は改変せず、当時のエンジンでの記録として保持します)。', noteEn: 'Unified the driving model\'s collision response and fixed, at its root, a bug where — when running several cars — one car could get stuck against a wall at its start position and never move (Stage AK; GitHub #26). Physics was stepped at a fine 60 times per second, but wall/other-car collision was checked only once per render frame. So in live driving (especially many cars / fast playback) a car moved too far before the hit was noticed, causing (a) tunneling through a thin wall at full-scale high speed, and (b) a cornered car, blocked ahead, slowly rotating itself into the wall at its own start position and never moving again. Collision is now checked at each physics substep (1/60 s), and a step that penetrates a wall is rejected whole — position and heading (rotation) together — so the car simply waits at the wall. Live and race now resolve collisions with one and the same model. Only car-to-car contact keeps a slight rotation as before, preserving the flow to slip past a neighbour (so a packed race does not jam into a pile-up with everyone retiring). Deterministic races (fixed 60 Hz = one substep) check collision exactly as many times as before, so the canonical race-record hashes, official full-scale competition records, and tabletop physics bytes are all unchanged. However, tabletop races in which a car crashes into a wall may no longer reproduce the exact same trajectory as before, due to the more honest wall handling (the records themselves are not altered and are kept as records made on the engine of their time).', h: 'bc08b3b6' },
  { v: 'v3.44.0', note: '現在の設定を共有できる URL パーマリンクと、アクセシビリティ (読み上げ・色覚) を追加 (Stage AF・GitHub #26)。①設定共有パーマリンク＝コース・車種・プログラム・領域・周回数・実機ノイズ・テーマ・言語を URL の末尾 (#…) に載せ、「🔗 共有リンクをコピー」で今の設定で開けるリンクを渡せる。設定を変えると URL が自動で更新され (ブラウザの「戻る」履歴は汚さない)、その URL を開くと同じ設定で起動する。自作コース・編集したプログラムは URL に載せず名前で参照し、見つからなければ既定に戻して理由を1行で知らせる (無言で失敗しない)。共有できるのは「設定」まで＝決定論レースの記録は同じ入力から完全に再現でき、ライブ走行の軌跡は描画タイミング差で完全一致はしない (正直な限界)。②アクセシビリティ＝5つのキャンバス (レース地図/ゴースト/コース/一人称/3D) に読み上げ用の説明 (aria-label/role) を付け、走行状態 (選択車の周回・状態・速度) を読み上げ領域で要点のみ伝える。さらに「色覚セーフ配色」トグル (既定オフ) で、赤いセンサーレイ・緑のテレメトリを色覚特性に依らず区別できるよう、色だけでなく破線やマーカ形状でも区別する。すべて表示・共有層のみの追加で、卓上 (初心者教材) の物理と既存の決定論レース記録のハッシュは不変。物理は不変。', noteEn: 'Added a shareable-settings URL permalink and accessibility (screen-reader and color-blind) features (Stage AF; GitHub #26). (1) Settings-share permalink: the course, car type, program, regime, lap count, real-device noise, theme, and language are carried in the URL hash (#…), and "🔗 Copy share link" hands someone a link that opens with your current settings. Changing a setting updates the URL automatically (without polluting the browser Back history), and opening that URL launches with the same settings. Custom courses and edited programs are not put in the URL but referenced by name; if one cannot be found it falls back to the default and tells you why in one line (no silent failure). Only "settings" are shareable: deterministic race records reproduce exactly from the same input, while a live run\'s trajectory does not match exactly due to rendering-timing differences (an honest limit). (2) Accessibility: the five canvases (race map / ghost / course / first-person / 3D) gained screen-reader descriptions (aria-label/role), and the driving state (the selected car\'s lap, status, and speed) is conveyed via a live region with only the essentials. A "Color-blind-safe colors" toggle (off by default) also makes the red sensor rays and green telemetry distinguishable regardless of color vision, using dashes and marker shapes in addition to color. Everything is a display/share-layer addition only; the tabletop (beginner) physics and the hashes of existing deterministic race records are unchanged. The physics is unchanged.', h: '4f518214' },
  { v: 'v3.43.0', note: '上級者・レースを楽しむ人向けに「コースを試走して覚える学習モデルを内蔵したプログラム」を追加 (Stage AE・GitHub #23)。新サンプル Recon Racer (コース試走学習・Python) は、まず試走の1周でコースを走りながら、車輪エンコーダの速度から進んだ距離を積み上げてコースを区間 (距離インデックス) に区切り、各区間のコーナーのきつさ (前方センサーがどれだけ詰まるか) を覚える。2周目以降は覚えた地図で先読みし、コーナー手前で反応だけのプログラムより早めに減速して構える。さらに本番は他車がいるので、覚えた地図の「壁までの距離」と今のセンサー値の差から他車を検知し (記憶より近ければそこに他車)、前が詰まったら今ほんとうに空いている側＝多くはアウト側へ寄せて抜き、抜けないときは無理せず追従して自滅しないよう、その時の最善手を計算する。学習に使うのは前方3センサー＋任意の車輪エンコーダだけで、絶対位置や方位は使わない (実機と同じ条件)。初の Python サンプルで、状態を周回をまたいで保持する。正直な限界＝自己位置は推測 (デッドレコニング) で誤差が溜まる・地図は固定長・発走で団子になると試走自体が難しい。単独走行・卓上 (初心者教材) の物理と既存の決定論レース記録のハッシュは不変。物理は不変。', noteEn: 'Added a program with a built-in learning model that studies the course by driving it (Stage AE; GitHub #23), aimed at advanced players who enjoy racing. The new sample Recon Racer (course-recon learning; Python) first drives one recon lap: it integrates the distance travelled from the wheel-encoder speed to divide the course into segments (a distance index) and learns how tight each segment\'s corner is (how much the front sensors close up). From the second lap it looks ahead with the learned map and brakes earlier before corners than a purely reactive program. And because a real race has other cars, it detects them from the difference between the wall distance it memorized and the current sensor reading (closer than memory = a car there); when blocked ahead it moves to the side that is actually open now — usually the outside — to pass, and when it cannot pass it follows without overreaching so it does not take itself out, computing the best move for that moment. It learns from only the three front sensors plus an optional wheel encoder, using no absolute position or heading (the same conditions as the real device). It is the first Python sample and keeps state across laps. Honest limits: self-position is dead-reckoned so error accumulates, the map is fixed-length, and a packed start makes the recon lap itself hard. Single-car driving, the tabletop (beginner) physics, and the hashes of existing deterministic race records are unchanged. The physics is unchanged.', h: 'a5d85da1' },
  { v: 'v3.42.0', note: '複数台レースの初期配置 (グリッド) を改善した (Stage AD)。①初期位置を「コース＋配置データ」で再現できるようデータ駆動化し、エンジン (レース計算) と初期位置パラメータを分離した。これにより配置アルゴリズムを将来変えても、配置データを持つ公式記録は同じ位置で忠実に再現できる (再現性をデータで取る)。②その土台の上で初期配置を「賢い配置」に改善＝各車を進行方向の正面に他車が来ないよう千鳥 (前車の隙間) に置き、発走時に前方センサー (中央ToF) が前の車を即ロックしないようにした。スタート地点 (ポール) は従来どおりで、千鳥に置けない狭いコースでは従来配置へ安全に戻す。これで複数台 (3〜6台) の発走がスムーズになり、前版の発走デッドロック修正 (サブステップ化) と合わせて発走の堅牢性が二重化した。単独走行・卓上 (初心者教材) の物理・既存の決定論レース記録 (2〜3台) のハッシュは不変。物理は不変。', noteEn: 'Improved the starting grid for multi-car races (Stage AD). (1) Made the initial positions data-driven so they can be reproduced from "course + placement data", separating the engine (race computation) from the initial-position parameters; this means that even if the placement algorithm changes in the future, official records that carry placement data reproduce faithfully at the same positions (reproducibility is taken from data). (2) On that foundation, improved the placement to be "smart" = each car is staggered (into the gaps ahead) so that no other car sits directly in its travel direction, so the forward sensor (center ToF) does not immediately lock onto the car ahead at the start. The start point (pole) is unchanged, and on narrow courses where staggering is impossible it falls back safely to the previous placement. This makes multi-car (3–6 car) starts smoother and, combined with the previous start-deadlock fix (sub-stepping), doubly hardens the launch. Single-car driving, the tabletop (beginner) physics, and the hashes of existing deterministic race records (2–3 cars) are unchanged. The physics is unchanged.', h: '7b62d04d' },
  { v: 'v3.41.0', note: '複数台を並べて走らせたとき、スタート地点で密集した一部の車が動き出せずスタックする不具合を修正 (GitHub #22)。原因は、画面の再生速度を上げると1フレームあたりの物理計算ステップが大きくなり、密集した車同士の重なり回避 (前進の取り消し) が毎フレーム起きて発走できなくなることだった。走行中の物理計算を内部で細かい時間刻みに分割 (サブステップ化) し、混雑したスタートでも各車が順に離れて発走できるようにした (複数台かつ「他車を障害物にする」がONのときのみ・単独走行や決定論レースの結果・記録は不変)。物理は不変。', noteEn: 'Fixed a bug where, when running multiple cars, some cars packed at the start could not get moving and stayed stuck (GitHub #22). The cause was that raising the playback speed made each frame\'s physics step large, so the overlap-avoidance between packed cars (which cancels forward motion) fired every frame and they never launched. The in-sim physics step is now split into smaller sub-steps so that, even on a crowded start, each car separates and launches in turn (only when there are multiple cars and "treat other cars as obstacles" is ON; single-car driving and deterministic race results/records are unchanged). The physics is unchanged.', h: '366355da' },
  { v: 'v3.40.0', note: 'レースモードの手動QAレポートに基づく改善をまとめて反映 (Stage AB)。①レース結果の見立てを「完走できなかった理由 (時間切れ=周回数/時間が過大／クラッシュ=コース不適合)」と「完走 (無事故/滑走多め)」で正直に出し分け、0完走時は能動的なサマリを表示するようにした。②制限時間を周回数・コース規模に応じて自動でスケールし、高周回や巨大コースでも完走できるようにした (公式記録の再現性は、凍結した制限時間を記録に同梱することで保全)。③周回数の入力を実行値へ書き戻して正規化 (50入力→上限30実行なら欄も30に)。④コース名・説明を英語表示に対応し、コース難易度★・推奨領域 (卓上/フルスケール)・🔰入門のバッジ表示と、起動時のコースを入門プールに限定することを追加。⑤速度表示で卓上スケールは「(実車換算)」と明示 (フルスケールは実車 km/h)。⑥キャンバスの背景をテーマ連動の配色にし、軌跡をフェード表示、縦長コースでも操作部が隠れないように、×閉じるボタンに読み上げラベルを付与。⑦レース体感を強化＝発走の 3-2-1 カウントダウン・勝者演出/コースレコード祝祭・🏁レース後の自動観戦リプレイ (順位・車間 gap・オーバーテイクの可視化)・任意 ON/OFF の効果音 (発走/周回/ゴール/クラッシュ)・走行軌跡をなめらかにした「お手本ライン」表示・自動走行が周回で止まらない無限の練習走行である旨の明示。物理は不変。', noteEn: 'Rolled in improvements from the manual race-mode QA report (Stage AB). (1) Race-result reads now honestly distinguish "could not finish" reasons (timeout = laps/time too high / crash = course mismatch) from "finished" (clean / lots of sliding), and show an active summary when no car finishes. (2) The time limit auto-scales with the lap count and course size so high lap counts and huge courses are finishable (official-record reproducibility is preserved by bundling the frozen time limit into the record). (3) Lap input is written back and normalized to the value actually run (enter 50 with a cap of 30 and the field becomes 30). (4) Course names/descriptions now have English display, with course-difficulty ★, recommended-regime (tabletop / full-scale) and 🔰 beginner badges, plus restricting the startup course to a beginner pool. (5) The speed display marks tabletop scale as "(real-car eq.)" (full scale stays real km/h). (6) The canvas background is theme-linked, the trail fades, the controls stay visible on tall courses, and close (×) buttons gained a screen-reader label. (7) Race feel is enhanced: a 3-2-1 start countdown, a winner ceremony / course-record celebration, an automatic spectator replay after a 🏁 race (visualizing order, gap, and overtakes), optional on/off sound effects (start / lap / goal / crash), a smooth "reference line" over the driving trail, and a clear note that auto-run is an unlimited practice run that does not stop at the lap count. The physics is unchanged.', h: 'c9fff059' },
  { v: 'v3.39.0', note: 'コース表示の拡大縮小を、コース上のマウスホイールでの操作から、コース倍率表示のとなりの「＋」「－」ボタンでの操作に変えた。これまではページを下にスクロールして読んでいる途中でマウスがコースに乗った瞬間にコースが拡大縮小してしまい、同じホイール操作の途中で挙動が変わって分かりにくかった。意図して押すボタンに変えることで、画面のどこでホイールを回してもページがスクロールするだけになり、操作の一貫性が増した（拡大時の移動はこれまでどおりドラッグ。物理・コース寸法・走行は不変）。', noteEn: 'Changed course zoom from the mouse wheel over the course to explicit "+" / "−" buttons next to the zoom-level readout. Previously, while scrolling the page down to read, the course would zoom the moment the cursor passed over it — the same wheel gesture changed behaviour mid-scroll, which was confusing. With intentional buttons, turning the wheel anywhere just scrolls the page, making the interaction consistent (panning when zoomed is still done by dragging; physics, course dimensions, and driving are unchanged).', h: '76619cac' },
  { v: 'v3.38.0', note: '起動時、コースが表示されるまでの間に「RumiCar」起動アニメーション（コースが線で描かれ、車が1周するローダー）を表示するようにした。これまでは読み込み中にコース領域が左上に小さなグレーの箱として出たままだったのを、ブランドのプレースホルダで覆い、コースが描けた瞬間にフェードで消えるようにして体感を改善した（静的なHTML/CSSなので最初の表示時点ですぐ出る・物理や動作は不変）。', noteEn: 'On startup, a "RumiCar" launch animation (a loader where the course is drawn as a line and a car laps it) is now shown until the course appears. Previously the course area stayed as a small grey box in the top-left while loading; it is now covered by a branded placeholder that fades out the moment the course is drawn, improving the perceived speed (it appears immediately at first paint since it is static HTML/CSS; physics and behaviour are unchanged).', h: 'e910c551' },
  { v: 'v3.37.0', note: 'コース編集で、先にコースの縦横寸法 (W×H m) を数値で決めてから空コースに描けるようにした (1グリッド=5cm のマス寸法も明示・先に枠の大きさを決めてから描けるフロー)。あわせて、フルスケール競技領域の物理に左右 (横) の荷重移動を導入し、旋回やトレイル制動 (曲がりながらの制動) で外側・内側のタイヤへ荷重が移ってグリップが配分され、アンダー/オーバーステアが荷重で創発するようにした (前後の荷重移動は従来からあり、今回は欠けていた左右を追加)。卓上 (初心者教材) の物理は従来どおり byte 不変で、荷重移動が効くのはフルスケール競技領域のみ。物理の卓上挙動は不変。', noteEn: 'In course editing, you can now set the course\'s width × height (m) numerically up front before drawing on an empty course (the grid square size, 1 grid = 5 cm, is shown too — decide the frame size first, then draw). Also introduced lateral (sideways) load transfer into the full-scale competition-regime physics: during cornering and trail braking (braking while turning) weight shifts to the outer/inner tyres, grip is redistributed, and under/oversteer emerges from load (longitudinal load transfer already existed; this adds the lateral component that was missing). The tabletop (beginner) physics stays byte-for-byte identical as before, and load transfer applies only in the full-scale competition regime. The tabletop driving behaviour is unchanged.', h: '68926945' },
  { v: 'v3.36.0', note: 'コースと車両の比率を、どの操作・順序・組み合わせでも常にレース可能になるよう自動補正するようにした。小さなコースに「フルスケール」領域や大きな車体スケールを選んでも、領域を一段下げる→車体スケールを上限でクランプ、の順で自動で適合させて収める (競技用のフルスケール設計コースはフルスケールを維持)。コース選択時だけでなく領域変更・車体スケール変更でも補正が効き、補正が起きたら理由を1行で告知する。あわせて、フルスケールでの測距表示を m 単位にし、現在の領域の測距上限と単位 (ToF≤2000mm / ToF≤150m) を常時明示、コースを選ぶと想定スケール (卓上=実機相当の模型サイズ／フルスケール=実車相当の実寸) を1行で告知するようにした (GitHub #20 のセンサー値が大きくなる件の明確化)。物理は不変。', noteEn: 'The course-to-car ratio is now auto-corrected so racing is always possible under any operation, order, or combination. Even if you pick the "full-scale" regime or a large car scale on a small course, it now fits automatically by stepping the regime down, then clamping the car scale at its limit (competition full-scale-designed courses keep full scale). The correction applies not only when selecting a course but also when changing the regime or car scale, and announces the reason in one line when it triggers. Ranging readouts in full scale are now shown in metres, the current regime\'s ranging limit and unit are always shown (ToF≤2000mm / ToF≤150m), and selecting a course announces its intended scale in one line (tabletop = real-device-equivalent model size / full scale = real-car-equivalent real size) — clarifying the GitHub #20 report about sensor values growing large. The physics is unchanged.', h: '900561b4' },
  { v: 'v3.35.0', note: 'ヘッダに「🏁 レースガイド」ボタンとダイアログを追加 (上級者向けレース Stage W の使い方・ルール・設計思想をまとめたドキュメント・日本語/英語)。①二層モデル (練習=非公式ソロ／本番=公式開催) ②使い方をボタン別に (🏁レース・📋開催・🏆公式レース・🏅ランキング) ③ルール (クラス=ワンメイク/バランス/無制限・最小3台と補充車・グリッド=エントリー順・クラッシュ規則=リタイア/3秒ペナルティ復帰・公式はノイズOFF・プログラムは締切後公開) ④設計思想 (決定論が公式記録の土台・クロスPF差は固定環境の正準エンジンで判定しローカルは参考・持ち込み車種はJSON同梱で再現・適不適は走った結果で気づく・学習側はToF×3のみ・"勝つ"より"学んで伸びる"を報いる)。物理は不変。', noteEn: 'Added a "🏁 Race Guide" button and dialog to the header (a document summarizing how to use, the rules, and the design philosophy of the advanced racing in Stage W; Japanese/English). (1) The two-layer model (practice = unofficial solo / production = official hosting). (2) How to use, by button (🏁 Race, 📋 Event, 🏆 Official races, 🏅 Rankings). (3) Rules (classes = One-make/Balance/Open, minimum 3 cars with fillers, grid = entry order, crash rule = retire / rejoin with a 3-second penalty, noise off for official, programs published after the deadline). (4) Design philosophy (determinism is the basis of official records; cross-platform differences are decided by a canonical engine in a fixed environment while the local result is a reference; bring-your-own car types are bundled as JSON and reproduced; fit is learned from the result it ran; the learner side uses only the three front ToF sensors; reward "learn and grow" over "win"). The physics is unchanged.', h: '386f4ecb' },
  { v: 'v3.34.0', note: '公式レースに「学んで伸びる」エンゲージメント層を追加 (上級者向けレース Stage W)。①レース結果・公式記録を「👻 ゴースト再生」でコース上に決定論リプレイし、複数の車を重ねて走らせて差を体感できる (「あなた vs 世界ベスト」も)。②起動時に自分の公式記録と世界ベストを比べ、抜かれていれば通知1行＋差 (gap) を表示する。③締切後に公開された記録のプログラムを閲覧し「🍴 fork (帰属つき)」で自分のエディタへ取り込んで研究・改良できる (原作者クレジットはソースに刻まれ fork に残る)。④締切後の公開を「📖 殿堂入りロジック」として讃え、作者は解説 (intro) を添えて発表できる。⑤「🏅 ランキング」でクラス別 (ワンメイク/バランス/無制限)・コース別のリーダーボード (👑コースレコード・🥇🥈🥉) とドライバープロフィール・称号を表示する。すべて再実行で検証できる公式記録のみを反映する (偽記録に尊敬は集まらない)。物理は不変。', noteEn: 'Added a "learn and grow" engagement layer to official racing (advanced racing, Stage W). (1) Replay race results and official records on the course with "👻 Ghost replay" — overlay multiple cars to feel the gap ("You vs world best" too). (2) On startup, compare your official records with the world best and, if you have been beaten, show a one-line notice plus the gap. (3) Browse the programs of records published after the deadline and "🍴 Fork (with credit)" them into your own editor to study and improve (the original author\'s credit is stamped into the source and stays through forks). (4) Celebrate the post-deadline reveal as "📖 Featured Logic", where the author can present it with an intro. (5) "🏅 Rankings" shows per-class (One-make/Balance/Open), per-course leaderboards (👑 course record, 🥇🥈🥉) plus driver profiles and titles. Everything reflects only official records that anyone can re-run to verify (fake records earn no respect). The physics is unchanged.', h: 'c7ae8ae6' },
  { v: 'v3.33.0', note: 'GitHub での「公式レース開催」を追加 (上級者向けレース Stage W)。ヘッダの「🏆 公式レース」から、GitHub の races/ で開かれている大会を一覧・閲覧でき、各大会のエントリー (名前・GitHub アカウント・プログラム・車種定義を同梱) と確定結果 (公式記録) を見られる。「📋 開催」ダイアログには「🌐 GitHubで公式開催」、公式レース画面には「🌐 この大会にエントリー」ボタンを追加し、押すと内容が事前入力された GitHub の新規ファイル作成画面が開きコミットでプルリクエストになる。結果は「ローカルで再実行して検証 (参考)」でき、決定論レースエンジンが同じ入力から結果を再現する (公式の確定は環境差をなくすため固定環境の正準エンジンで判定＝ブラウザ結果は参考と正直に表示)。大会が未作成のとき (races/ 未シード) は通知1行を出すだけで本体はそのまま動く。物理は不変。', noteEn: 'Added "official race hosting" on GitHub (advanced racing, Stage W). From "🏆 Official" in the header you can list and browse races opened under races/ on GitHub, and view each race\'s entries (bundling name, GitHub account, program, and car definition) and finalized result (the official record). The "📋 Event" dialog gained a "🌐 Host officially on GitHub" button and the official-races screen a "🌐 Enter this race" button; pressing either opens GitHub\'s new-file page pre-filled, and committing creates a pull request. Results can be re-run locally ("Re-run locally to verify (reference)"): the deterministic race engine reproduces the result from the same input (official results are decided by the canonical engine in a fixed environment to remove environment differences, so the browser result is honestly shown as a reference). When no race exists yet (races/ not seeded) the app just shows a one-line notice and keeps working. The physics is unchanged.', h: '4d695254' },
  { v: 'v3.32.0', note: 'ローカル開催 (クラス＋エントリー＋フィールド成立) を追加 (Stage W)。「📋 開催」ボタンで、クラス (ワンメイク=全車同一の規定車で純ロジック競争／バランス=性能にコスト予算を配分／無制限) を決めてエントリーを集め、規定外の車 (バランスで予算超過など) は決定論的に弾く。エントリーが3台未満なら決められた補充車で埋めて成立させ (グリッド=エントリー順)、締切で決定論レースとして走らせて結果を出す (公式記録の土台・練習記録とは別経路)。物理は不変。', noteEn: 'Added local event hosting (class + entries + field formation) (Stage W). The "📋 Event" button lets you pick a class (One-make = all cars on the same spec car, pure logic / Balance = spend a cost budget on performance / Open), collect entries, and deterministically reject cars that break the class rule (e.g. over budget in Balance). If fewer than 3 cars enter, fixed filler cars fill the field (grid = entry order); closing entries runs it as a deterministic race and produces a result (the basis for official records, separate from practice records). The physics is unchanged.', h: '727d49da' },
  { v: 'v3.31.0', note: '本番レースモードを追加 (上級者向けレース機能 Stage W)。「🏁 レース」ボタンで、いま並べた車両編成 (各車のプログラム+車種) をそのまま決定論レースエンジンで走らせ、順位・総時間・ベストラップと「レースレポート」を表示する。周回数とクラッシュ規則 (リタイア / 3秒ペナルティで復帰) を選べ、結果ダイアログにはコース上のクラッシュ地点 (✕) と最終位置 (●)、各車の μ円使用率ピーク・βピーク・クラッシュ数・見立て (適不適) が出る。先回り警告はせず「走った結果」でコースへの向き不向きが分かる。物理は不変。', noteEn: 'Added a production race mode (advanced racing feature, Stage W). The "🏁 Race" button takes your current line-up (each car\'s program + car type) and runs it through the deterministic race engine, showing standings, total time, best lap, and a "race report". You can choose the number of laps and the crash rule (retire / rejoin with a 3-second penalty); the result dialog shows crash spots (✕) and final positions (●) on the course, plus each car\'s μ-circle usage peak, β peak, crash count, and a read on whether it suits the course. No upfront warnings — the result it ran tells you whether a car fits the course. The physics is unchanged.', h: '1103b48a' },
  { v: 'v3.30.0', note: '上級者向けレース機能の基盤を着工 (Stage W)。まず決定論レースエンジン (固定60Hz・ノイズOFF・処理順固定で衝突/周回/順位を再現可能に計算する内部エンジン) を追加し、ソロ走行を「練習走行 (非公式)」と位置づけてベストラップを<b>コース×車種別</b>の練習記録としてこのブラウザに保存するようにした (将来の公式レース記録とは別経路)。リーダーボードに「BEST=練習ベスト (非公式・車種別)」の注記を表示。物理は不変。', noteEn: 'Started the foundation for the advanced racing feature (Stage W). First, added a deterministic race engine (an internal engine that computes collisions/laps/standings reproducibly at a fixed 60 Hz, noise off, fixed processing order), and reframed solo driving as a "practice run (unofficial)", saving best laps as practice records <b>per course × car type</b> in this browser (a separate path from future official race records). The leaderboard now shows a "BEST = practice best (unofficial, per car)" note. The physics is unchanged.', h: '35c7c477' },
  { v: 'v3.29.0', note: '作った車種を GitHub で共有できるようにした (コース/プログラムと同じ仕組み)。車種ダイアログに「🌐 GitHubで共有」ボタンを追加し、押すと車種定義 (JSON) が事前入力された GitHub の新規ファイル作成画面が開き、コミットするとプルリクエストが作られる (cars/community/ に新規・上書きなし)。承認された投稿車種は起動時に読み込まれ、車種メニュー (走行カードの車種セレクタ・車種パラメータ表) に「🌐 名前」として並び、選んで走らせられる。取得に失敗したとき (未作成/レート制限/オフライン) は通知1行を出すだけで本体はそのまま動く。', noteEn: 'You can now share the car types you make via GitHub (the same mechanism as courses and programs). The car dialog gained a "🌐 Share on GitHub" button; pressing it opens GitHub\'s new-file page pre-filled with the car definition (JSON), and committing creates a pull request (new file under cars/community/, no overwrite). Approved community car types are loaded at startup and appear as "🌐 Name" in the car menu (the car-type selector on each driving card and the car-parameter table), ready to drive. If fetching fails (not created / rate limit / offline), the app just shows a one-line notice and keeps working.', h: '1018796f' },
  { v: 'v3.28.0', note: '組込の6車種 (ノーマル/ドリフト FR・FF・4WD) もローカルに上書き編集できるようにした。車種パラメータ表の各車種に「編集」を追加し、フォーム/JSON で値を変えて「組込に上書き保存」すると走行挙動に反映される (このブラウザに保存)。出荷時の既定は一切変えず (卓上の物理は byte 不変)、上書き中の車種は「上書き中」と表示され、「既定に戻す」(個別) や「全上書き解除」でいつでも完全に元へ戻せる。', noteEn: 'The six built-in car types (Normal/Drift FR, FF, 4WD) can now be overridden locally too. Each car in the parameter table gained an "Edit" button; change the values in the form/JSON and press "Save built-in override" to apply them to driving (saved in this browser). The shipped defaults are never changed (the tabletop physics stays byte-for-byte identical); overridden cars are marked "overridden", and "Reset" (per car) or "Reset all overrides" returns them fully to the originals at any time.', h: 'e6c23751' },
  { v: 'v3.27.0', note: '独自車種をフォーム (スライダー + 数値入力) でも作れるようにした。車種ダイアログに「フォームで作る」エディタを追加し、各パラメータ (車重・加速・制動・最高速・アンダー/オーバー・ドリフト設定など) をスライダーや数値で設定できる。フォームと下の JSON 欄はリアルタイムに双方向同期し (フォーム編集→JSON、JSON 貼付→フォーム)、数値以外・必須欠落・組込車種との key 重複は日本語/英語のエラーで弾く。保存は従来と同じ「追加」ボタンに一本化。', noteEn: 'You can now build custom car types with a form (sliders + number inputs) too. The car dialog gained a "Build with a form" editor where you set each parameter (mass, acceleration, braking, top speed, under/oversteer, drift settings, etc.) with sliders or numbers. The form and the JSON box below stay in two-way real-time sync (form edit → JSON, JSON paste → form), and non-numeric values, missing required fields, or a key that collides with a built-in type are rejected with errors in Japanese / English. Saving still goes through the same "Add" button.', h: '44daa4ea' },
  { v: 'v3.26.0', note: '独自車種を1台ずつ管理できるようにした。車種ダイアログに登録済み独自車種の一覧を追加し、各車種を個別に編集 (定義を上の欄へ読み込み「追加」で同じ車種を更新)・複製 (別キーでコピー)・削除 (1台だけ) できる (従来は「追加」と「全削除」のみ)。組込の6車種はここでは編集できない (実験用の上書きは今後の版で対応予定)。', noteEn: 'You can now manage your custom car types one by one. The car dialog gained a list of your custom car types where you can edit each one (load its definition into the box above, then press "Add" to update the same type), duplicate it (a copy under a new key), or delete just that one (previously only "Add" and "Remove all" were available). The six built-in car types cannot be edited here (overriding them for experiments is planned for a future version).', h: '6ea18b04' },
  { v: 'v3.25.0', note: 'フルスケール領域のまま卓上設計の小さなコースを選ぶと、車体がコースから左右にはみ出し、車体スケールを変えても収まらない問題を修正。収まらないコースを選んだら領域を自動で「卓上」に戻すようにした (競技コース→フルスケール自動切替の対称。中スケールや、領域セレクタでの明示的な選択は維持)。', noteEn: 'Fixed an issue where, while in the full-scale regime, selecting a small tabletop-designed course made the car overflow the course on both sides with no car-scale setting able to make it fit. Selecting such a course now switches the regime back to "Tabletop" automatically (mirroring the competition-course to full-scale auto-switch; mid-scale and explicit regime-selector choices are preserved).', h: '66e31375' },
  { v: 'v3.24.0', note: '英語表示の取りこぼしを補完 (一時停止ボタン・コース名の既定値・走行の学習ヒント・独自車種の追加/削除メッセージ)。拡大プログラムエディタで、マウスホイールが背景コースを巻き込んでスクロールする不具合を修正し、「🌐保存」(別名で新規保存・上書きなし) ボタンを追加。仕様ダイアログに「システム仕様 (技術アーキテクチャ)」節を新設 (システム構成・実行モデル・独自車種JSON・プログラムAPI・localStorage を日本語/英語で記載)。', noteEn: 'Filled remaining gaps in the English UI (the pause button, the default course name, the driving learning hints, and the custom-car add/remove messages). Fixed the expanded program editor so the mouse wheel no longer scrolls the background course, and added a "🌐 Save" button (save under a new name; no overwrite). Added a "System Specification (Technical Architecture)" section to the Specs dialog documenting the architecture, execution model, custom-car JSON, program API, and localStorage in Japanese / English.', h: 'd2676253' },
  { v: 'v3.23.0', note: '車種の表示名 (ノーマル/ドリフト FR/FF/4WD) を言語切替に対応 (英語では Normal/Drift RWD/FWD/AWD)。車種セレクタと車種パラメータ表が現在の言語で表示される。', noteEn: 'Translated the car type display names (Normal / Drift FR/FF/4WD) so they follow the language toggle (shown as Normal/Drift RWD/FWD/AWD in English). The car-type selector and the car-parameter table now display in the current language.', h: 'bbb240c2' },
  { v: 'v3.22.0', note: 'コースデータ (courses.json) の書式を解説する「📐 コースデータ仕様」ボタンとダイアログをヘッダに追加 (共通フィールドと track/annulus/touge/raw の各 kind のパラメータを実装どおりに記載・日本語/英語)。', noteEn: 'Added a "📐 Course Data Spec" button and dialog to the header that documents the courses.json format (the common fields and each kind\'s parameters — track / annulus / touge / raw — as implemented; Japanese / English).', h: '4d7631fe' },
  { v: 'v3.21.0', note: 'コース表示をマウスホイールで拡大縮小・ドラッグで移動（パン）できるように。拡大すると大きなコースでも車両やセンサーを近くで追え、「全体表示」ボタンで等倍（全体表示）に戻せる（物理・コース寸法・走行は不変）。', noteEn: 'You can now zoom the course view with the mouse wheel and pan by dragging. Zoom in to follow the car and sensors up close even on large courses, and the “Fit view” button resets to 1× (physics, course dimensions, and driving are unchanged).', h: 'ea928123' },
  { v: 'v3.20.0', note: 'フルスケール設計コース (競技サーキット/競技グラウンド) を選ぶと領域を自動でフルスケールに切替え、車両との比率が最初から正しくなるように。コミュニティコース/プログラムの取得に失敗したとき (レート制限等) は無言にせず通知するように。', noteEn: 'Selecting a full-scale course (Competition Circuit / Ground) now switches the regime to full-scale automatically, so the car-to-course ratio is correct from the start. When fetching community courses / programs fails (e.g. a rate limit), the app now notifies you instead of failing silently.', h: '0ee10b07' },
  { v: 'v3.19.0', note: '「質問・アイデアを投稿」ダイアログとコースエディタの描画モード説明、投稿フォームの実況メッセージを英語に対応 (国際化 Phase 1/2 で未対応だった取りこぼしを補完)。', noteEn: 'Translated the "Post a question / idea" dialog, the course-editor drawing-mode guide, and the submission-form messages into English (filling gaps left by i18n Phases 1 and 2).', h: 'd7b89207' },
  { v: 'v3.18.0', note: '別ウインドウで開く長文ヘルプ (使い方・仕様と制限・物理モデル・車種) とプログラム解説・変更履歴を英語に対応。日本語を直して英語を直し忘れた「古い訳」を卓上ゲートで検知する陳腐化チェックも追加。', noteEn: 'Translated the long-form help opened in separate windows (How to use, Specs and limits, Physics model, Cars), the program descriptions, and this changelog into English. Added a staleness check so the desktop gate flags any English text left stale after its Japanese was edited.', h: 'a975420c' },
  { v: 'v3.17.0', note: '日本語/英語の言語切替を追加 (ヘッダの言語セレクタで切替・選択は保存・未設定時はブラウザ設定に従う)。操作系UIと実況メッセージを ja/en の外部カタログに分離し、版アップ時の翻訳漏れを卓上ゲートで検査する。長文ヘルプ本文の英訳は後続。', noteEn: 'Added Japanese/English language switching (toggle via the header language selector; your choice is saved; defaults to your browser setting). Separated the control UI and live messages into an external ja/en catalog and added a desktop gate that checks for missing translations on version bumps. English for the long-form help text comes later.', h: '4404dc95' },
  { v: 'v3.16.0', note: '各車カードに「⤢ 拡大」を追加し、行番号つきの大きなプログラムエディタをモーダルで開けるように (長く複雑なプログラムも全体を見渡せる・編集はカード側と即同期・走行中は閲覧のみ)。質問・提案フォームに画像/動画を添付できる旨の案内も追加。', noteEn: 'Added a ⤢ Expand button to each car card to open a larger program editor with line numbers in a modal (survey long, complex programs at a glance; edits stay in sync with the card; view-only while running). Also added a note that images/videos can be attached to the question/suggestion form.', h: 'bc4e12fa' },
  { v: 'v3.15.0', note: 'センサーの実機相当ノイズ/欠測の任意注入トグル (実機頑健性の確認用・既定オフ) と、摩擦円の使用率オーバレイ (グリップ限界への近さを可視化) を追加。', noteEn: 'Added an optional toggle to inject real-device-like sensor noise/dropout (for checking real-device robustness; off by default) and a friction-circle usage overlay (visualizes how close you are to the grip limit).', h: '1f2ea160' },
  { v: 'v3.14.0', note: 'コースエディタの操作性を改良 (折れ線のクリック配置・矩形範囲消去・モード説明とコース寸法表示・車体スケール上限拡大)。', noteEn: "Improved the course editor's usability (click placement for polylines, rectangle-area erase, mode descriptions and course-dimension display, and a higher car-scale limit).", h: '23e56a9e' },
  { v: 'v3.13.0', note: 'フルスケールのドリフト研究環境 (持続ドリフト/最速⇄リア流しの演目・ToF からの姿勢推定リファレンスと、その成立/非成立条件)。', noteEn: "A full-scale drift research environment (sustained-drift / fastest-to-rear-slide demos, a ToF-based attitude-estimation reference, and the conditions under which drift does or doesn't hold).", h: '1fb2d612' },
  { v: 'v3.12.0', note: '峠ドリフトの正直なガイド・フルスケール車の舵角拡大・コースエディタに連続描画/曲線モードを追加。', noteEn: 'An honest guide to mountain-pass drifting, a wider steering range for full-scale cars, and continuous-draw / curve modes in the course editor.', h: '7e94fb15' },
  { v: 'v3.11.0', note: '進行方位 θ を 0–360° 表示・スリップ角/速度の数値表示・フルスケール×小型コースの誤用警告を追加。', noteEn: 'Display heading θ as 0–360°, show slip-angle / velocity values, and warn about misusing full scale on small courses.', h: 'a43bfaad' },
  { v: 'v3.10.0', note: 'フルスケール実寸サーキットと、前方3センサーで先読みするレース演目 (Circuit Racer) を追加。', noteEn: 'Added a full-scale, real-size circuit and a racing demo (Circuit Racer) that looks ahead with the three front sensors.', h: 'ebe83c65' },
  { v: 'v3.9.0', note: 'ゼロカウンターでドリフトを保持する魅せ演目 (Drift Showtime) を追加。', noteEn: 'Added a showcase demo that sustains a drift with zero counter-steer (Drift Showtime).', h: '71f8daf7' },
  { v: 'v3.8.0', note: '実効舵角を走行領域でフェードし、フルスケールでは US/OS 挙動を物理に委ねるようにした。', noteEn: 'Faded the effective steering angle by driving regime so that, at full scale, US/OS behavior is left to the physics.', h: '86035a12' },
  { v: 'v3.7.0', note: '競技 (フルスケール) カリキュラム・車輪エンコーダ・トラクションコントロール/ABS サンプルを追加。', noteEn: 'Added the competition (full-scale) curriculum, a wheel encoder, and traction-control / ABS samples.', h: 'c0e5b9cc' },
  { v: 'v3.6.0', note: '車輪スリップ率と縦力のモデル化 (ホイールスピン/タイヤロック) を追加。', noteEn: 'Added modeling of wheel slip ratio and longitudinal force (wheelspin / tire lock).', h: 'a42042cd' },
  { v: 'v3.5.0', note: 'タイヤの限界曲線 (Pacejka) を導入し、グリップの頭打ちを再現。', noteEn: 'Introduced the tire limit curve (Pacejka) to reproduce the grip plateau.', h: 'd9f08479' },
  { v: 'v3.4.0', note: '空力 (抗力＋ダウンフォース) とフルスケール・レース領域を追加。', noteEn: 'Added aerodynamics (drag + downforce) and the full-scale race regime.', h: 'b2088c75' },
  { v: 'v3.3.1', note: '摩擦円の双方向結合 (前後グリップと横グリップの取り合い) を実装。', noteEn: 'Implemented bidirectional coupling of the friction circle (the trade-off between longitudinal and lateral grip).', h: 'a0553046' },
  { v: 'v3.3.0', note: '走行領域 (regime) の選択 UI と ToF 連動を追加。', noteEn: 'Added a driving-regime selection UI and ToF coupling.', h: '01ee6114' },
  { v: 'v3.2.0', note: '動力学モデルを既定化 (スリップ角と荷重で挙動が決まる物理へ)。', noteEn: 'Made the dynamics model the default (physics where slip angle and load determine behavior).', h: '0fd39128' },
  { v: 'v3.1.2', note: '走行姿勢の描画を改善 (前輪の操舵角表示・ドリフトのタイヤスモーク)。', noteEn: 'Improved the rendering of driving attitude (front-wheel steering-angle display, drift tire smoke).', h: '003da489' },
  { v: 'v3.1.1', note: '速度を体感に合わせた相対補正表示に変更。', noteEn: 'Changed speed to a perceptually-adjusted relative display.', h: 'c34c2cfd' },
  { v: 'v3.1.0', note: 'UI を整理し、版バッジ・GitHub ボタン・バージョン表示を追加。', noteEn: 'Tidied the UI and added the version badge, GitHub button, and version display.', h: '76705db4' },
];

export const CONST = {
  // 操舵 (RumiCar API)
  LEFT: 0, CENTER: 1, RIGHT: 2,
  // 走行 (RumiCar API)
  FREE: 0, REVERSE: 1, FORWARD: 2, BRAKE: 3,
  // 測距の方向。BACK は任意装備の後方センサー (実機は I2C アドレス確保済・物理追加可能)。
  BACK: 3,
  // 車輪エンコーダ (任意装備) の対象車軸。RC_wheel_speed(FRONT/REAR) で前/後軸の車輪面速度[m/s]を読む。
  // 競技(フルスケール)領域でトラクション制御/ABS を書くための信号。実機は車輪エンコーダで追加可能。
  FRONT: 0, REAR: 1,
};

export const CAR = {
  length: 0.19,        // m (車体長 / 衝突ボックス)
  width: 0.08,         // m (車体幅)
  wheelBase: 0.13,     // m (前軸〜後軸)
  rearToBack: 0.03,    // m (後輪軸中心から車体後端まで)
  maxSteer: 24 * Math.PI / 180, // rad (最大操舵角)
  // 操舵サーボの動作速度 (rad/s)。瞬時ではなく有限速度で目標舵角へ動く。
  // これにより 3値操舵を小刻みにオン/オフ (デューティ制御) すると、車体が平均値で
  // ローパスされ「実効的な中間舵角」が得られる (Step2)。中立↔全開(24°)を約0.06秒で移動。
  steerRate: 7.0,      // rad/s
  maxSpeed: 0.7,       // m/s (pwm=255 相当の最高速)
  accel: 2.5,          // m/s^2 (加速)
  brake: 4.0,          // m/s^2 (制動: BRAKE)
  coast: 1.2,          // m/s^2 (惰性減速: FREE。転がり抵抗のみでゆっくり落ちる)
};

// 速度の「相対補正表示」。物理は卓上スケール (実寸 cm) なので計算上の km/h は小さく人間の感覚と
// 合わない。そこで表示用に、車の最高速 (CAR.maxSpeed) に対する割合を、実車の代表的な最高速へ写像する。
//   サーキット ≒ 350 km/h / 峠 ≒ 180 km/h を満タン (全開) の目安とする。
// ※ あくまで体感に近づける表示専用の係数で、物理モデル・判定・テストには一切影響しない。
export const SPEED_DISPLAY = { circuit: 350, touge: 180 };
export function displayKmh(v, course) {
  // フルスケール領域 (realKmh) は物理的に実速度が出るので m/s×3.6 を直接表示する (没入写像なし)。
  // 卓上/中スケールは従来どおり「最高速比×topKmh」の没入写像 (実速度は cm/s 級で体感と合わないため)。
  const reg = REGIMES[REGIME_STATE.active];
  if (reg && reg.realKmh) return Math.abs(v) * 3.6;
  const ref = (course && course.topKmh) || (course && course.touge ? SPEED_DISPLAY.touge : SPEED_DISPLAY.circuit);
  return Math.abs(v) / CAR.maxSpeed * ref;
}

// 勾配重力の車体前方成分 (AP10・世界方向射影)。downhill(=g·sinθ, m/s²) を世界固定の下り方向 slopeDir
// へ向くベクトルとみなし車体前方へ射影する (gFwd = downhill·cos(theta−slopeDir))。下り向き(theta=slopeDir)
// で +downhill・登り向き(theta=slopeDir±π)で −downhill。downhill===0 (平地・全凍結シナリオ・全オラクル
// ゲート) は 0 を返し、以降の勾配項が完全 no-op = byte 不変。**3エンジン共通** (physics.js/physics_dyn.js/
// physics_v2.js)＝AP22 で 3箇所の同一式を 1 実装へ統合 (純リファクタ・traceHash 不変)。呼び側の FREE 静止
// 転動・勾配ピッチ荷重の扱いはエンジンごとに異なる (std=簡易/dyn=two-track/v2=substep・意図的差異) ため
// 統合せず各エンジンに残す (誤統合防止・決定ログ AP-22)。
export function gForward(downhill, theta, slopeDir) {
  return downhill !== 0 ? downhill * Math.cos(theta - slopeDir) : 0;
}

// センサー (車体前部・tof_1 基準。URDF 準拠)
// CENTER 正面, LEFT +65°, RIGHT -65°
export const SENSORS = [
  { name: 'LEFT',   idx: 0, dx: 0.130, dy: 0.018, yaw:  65 * Math.PI / 180 },
  { name: 'CENTER', idx: 1, dx: 0.135, dy: 0.000, yaw:  0 },
  { name: 'RIGHT',  idx: 2, dx: 0.130, dy: -0.018, yaw: -65 * Math.PI / 180 },
];
// 任意装備の後方センサー (既定OFF=前方3つのみで実機 faithful。ONで追走車の察知などに使える)。
// 後輪軸より少し後ろから真後ろ(yaw=180°)を見る。
export const SENSOR_REAR = { name: 'BACK', idx: 3, dx: -0.045, dy: 0.0, yaw: Math.PI };
// 計測レンジ上限 (mm)。Phase F1: 領域の長さスケールに連動するため可変ホルダーにした
// (applyRegime が SENSOR_RANGE.maxMm を書き換える。卓上=2000mm)。
export const SENSOR_RANGE = { maxMm: 2000 };

// VL53L0X 相当の視野コーン (Stage AM1・#27 根治)。全角 25°(半角 12.5°)。測距は中心1本の
// 「太さゼロ直線レイ」でなく扇内の最近反射面 (geom.coneNearest) を返す=端点掠め貫通を原理的に排除。
// 視野角は角度量ゆえレジーム(卓上/フルスケール)で不変 (スケール不変)=領域スケールしない。
const SENSOR_FOV_HALF = 12.5 * Math.PI / 180;
export const SENSOR_FOV = { halfRad: SENSOR_FOV_HALF, cosHalf: Math.cos(SENSOR_FOV_HALF), sinHalf: Math.sin(SENSOR_FOV_HALF) };

// 実機(VL53L0X)相当のセンサー外乱モデル (M1, #18①)。既定 OFF=従来経路 (sensors.js が乱数を一切呼ばない=
// 卓上 byte 不変)。ON で readSensor が有効測距値に「距離依存ガウスノイズ + 確率的欠測(範囲外コード)」を注入する。
// 注入は表示(レイ/距離ラベル)だけでなく api.js 経由で学習プログラムが読む値にも効く=頑健性を試せる。
// 学習側 ToF×3 方針(D-1)は不変: センサーは増やさず、既存 ToF の値を実機的に劣化させるだけ。
export const SENSOR_NOISE = {
  on: false,        // 既定 OFF。ON のときのみ乱数注入 (OFF は従来の決定論経路に厳密縮退=byte 不変)。
  sigmaBaseMm: 8,   // 近距離での測距ノイズ標準偏差 (mm)。VL53L0X の典型 ±数mm 相当。
  sigmaFrac: 0.02,  // 距離比例のノイズ成分 (σ += sigmaFrac × 測距mm)。遠いほど荒れる。
  dropout: 0.03,    // 1計測あたりの欠測(タイムアウト)確率。欠測時は範囲外コード(-3)を返す=実機の無効測距。
  // AP19 (opt-in ②・外れ値/距離依存欠測/他車反射率)。**出荷既定は全て中立 (0 / 倍率1)** = 従来経路
  //   (ガウス+距離非依存 dropout) へ厳密縮退し、追加の乱数を一切消費しない = 卓上 byte 不変 (受け入れ①)。
  //   ON の実効値は main.js の optNoise トグルが「実機相当プリセット」として与える (config 既定は byte 基準線)。
  outlier: 0,        // spurious 外れ値の発生確率/計測。実機 VL53L0X のクロストーク/2次反射で稀に真距離と無相関な
                     //   値を返す現象。発火時は [outlierMinMm, 測距レンジ] の一様乱数で mm を差し替える (CONF 信頼
                     //   区間ゲートが実際に発火し得る=samples の CONF 教材を演習可能に)。0=無効=Math.random 短絡で非消費。
  outlierMinMm: 20,  // spurious 値の下限 [mm] (上限は SENSOR_RANGE.maxMm)。
  dropoutFar: 0,     // 距離依存欠測の傾き [/m]。実効欠測率 = dropout + dropoutFar × 測距[m] (0=距離非依存=従来)。
                     //   実機 ToF は遠距離ほど信号品質が落ち欠測が増える。dropout=0 でも遠方だけ欠ける挙動を作れる。
  carSigmaMul: 1,    // 他車の車体エッジを標的にしたときの σ 倍率 (低反射率=荒れる)。1=中立 (壁と同じ精度)。
                     //   混走で「他車までの距離だけ荒れる」実機挙動を模す。壁標的読には影響しない (×1)。
};

// 実機(VL53L0X)相当のセンサー更新レート/レイテンシ = sample-and-hold (AP18・#18① D1)。既定 OFF=
// 従来経路 (api.js が tick 世代キャッシュのみ=AP5 の挙動に厳密縮退=byte 不変・乱数非消費)。ON で
// api.js の測距キャッシュ鍵が「直近サンプルからの経過時間」に切り替わり、1計測に一定時間を要する実機を
// 模して 1/hz 秒経過するまで前回の測距値を「保持」する。実機 VL53L0X は 1 計測に 20-33ms を要し
// (レート ~30-50Hz)、理想センサー (レイテンシ0・レート無制限) との最大の構造差。保持により
//  (a) 同一保持窓内は分散0 (b) 1 反復内に何度読んでも同一値 = 多数回読み平均でノイズσを縮める
//     エクスプロイト (実測 ×9.8 縮小) が同時に閉じる。学習側 ToF×3 方針(D-1)は不変=センサーは増やさず
//     既存 ToF の「更新の遅さ」を実機的に付与するだけ。公式レースは決定論ゆえ強制 OFF (race_engine.js)。
export const SENSOR_HOLD = {
  on: false,        // 既定 OFF。ON のときのみ sample-and-hold (OFF は AP5 の tick 世代キャッシュに厳密縮退=byte 不変)。
  hz: 30,           // センサー更新レート [Hz]。実機 VL53L0X 既定 (~30Hz=33ms 積分) 相当。更新間隔[物理tick]=round(physicsHz/hz)。
};

// 描画
export const VIEW = {
  pxPerM: 280,         // m → px (基準スケール。大きなコースは setView がこれ以下へ自動縮小=フィット)
  maxCanvasPx: 2400,   // キャンバス最大辺[px]。これを超える大コース(フルスケール競技グラウンド 200m 等)は
                       //   pxPerM を下げて収める。既存コースは最大 7.99m (架空峠激坂→2237px) なので全て 280 のまま不変。
  bg: '#d9d9d9',       // 背景 (明るいグレー)
  wall: '#e0a878',     // 壁: 淡い暖色 (ソフトなアプリコット)。怖くない優しい色
  wallWidth: 5,
  ray: '#ff3030',
  trail: '#36d36b',
  // レーシングカー描画
  carBody: '#e2202a',     // ボディ主色
  carBody2: '#8d1117',    // ボディ陰 (グラデーション)
  carAccent: '#f4f4f4',   // センターストライプ
  carCanopy: '#16243c',   // コックピット
  carWing: '#232323',     // 前後ウイング
  carWheel: '#161616',    // タイヤ
  carCrash: '#ff7a7a',    // 衝突時
  meter: '#1fa85a',
  finish: '#2244ff',     // フィニッシュライン
  finishAlt: '#ffffff',  // フィニッシュライン (チェッカー)
  grid: 'rgba(0,0,0,0.10)',
  editGhost: '#0a84ff',  // 編集中の壁プレビュー
  carScale: 1,           // 車体スケール (コースに対する車の大きさ比率)。setCarScale で変更
};

// 車体スケール: コースと車両の比率を利用者が変更できるようにする。
// 車体の物理寸法 (全長/全幅/ホイールベース/後端) とセンサー取付位置、描画サイズを
// 同じ倍率 k で拡縮する (速度 m/s・操舵角・センサーレンジは実値なので据置)。
// CAR / SENSORS は各モジュールが参照で共有しているため、フィールドを書き換えれば全体に反映される。
const CAR_BASE = { length: CAR.length, width: CAR.width, wheelBase: CAR.wheelBase, rearToBack: CAR.rearToBack };
// 衝突フットプリント（設計/k=1 単位）= physics.Car.corners() が成す矩形。描画スプライト(car_sprite.js)を
// この中へ写像して「描画 ⊆ 衝突矩形」を保証する（Stage AH・GitHub #26）。CAR_BASE 由来で carScale に依らず不変。
export const CAR_FOOTPRINT = { back: -CAR_BASE.rearToBack, front: CAR_BASE.length - CAR_BASE.rearToBack, hw: CAR_BASE.width / 2 };
const SENSOR_BASE = SENSORS.map(s => ({ dx: s.dx, dy: s.dy }));
// 実効スケール = 領域の長さ倍率 (regimeK = regime.L/卓上L) × ユーザーの carScale スライダー (userK)。
// Phase F1 で領域を一級化したため2軸に分離した。既定 1×1 は従来の geometry×1 と byte 完全一致。
// AK2/D10: 公式レースエンジン (race_engine.runRace) が userK を退避→既定固定→復元するため export する
// (SENSOR_NOISE/REGIME_STATE と同型の「退避対象 live state」)。既定値・挙動は不変 = byte 不変。
export const SCALE_STATE = { regimeK: 1, userK: 1 };
function _applyScale() {
  const k = SCALE_STATE.regimeK * SCALE_STATE.userK;
  CAR.length = CAR_BASE.length * k;
  CAR.width = CAR_BASE.width * k;
  CAR.wheelBase = CAR_BASE.wheelBase * k;
  CAR.rearToBack = CAR_BASE.rearToBack * k;
  SENSORS.forEach((sd, i) => { sd.dx = SENSOR_BASE[i].dx * k; sd.dy = SENSOR_BASE[i].dy * k; });
  VIEW.carScale = k;
  return k;
}
export function setCarScale(s) {
  // 上限 4: 大コース (例フルスケール競技グラウンド 200×100m) で車体が小さすぎる問題 (#19④b) 用に
  // 拡大。卓上既定 (UI 0.8) / ベンチ母集団 (userK=1) は不変で byte 不変。
  SCALE_STATE.userK = Math.max(0.4, Math.min(4, Number(s) || 1));
  _applyScale();
  return SCALE_STATE.userK; // UI 表示はユーザー倍率を返す (従来互換)
}
// 領域の長さスケール (= regime.L / 卓上 L)。動的相似で幾何 (wheelBase 等) を V と一緒に伸ばす。
// ユーザーの carScale スライダーと合成される (実効 = regimeK×userK)。
export function setRegimeScale(kL) {
  SCALE_STATE.regimeK = Math.max(0.05, Number(kL) || 1);
  return _applyScale();
}

// 複数台同時走行: 車両ごとの識別色 (最大台数 = 配列長)。
export const FLEET = {
  colors: ['#e2202a', '#2a7fff', '#28c76f', '#f4b400', '#a259ff', '#ff7ac2'],
  names: ['A', 'B', 'C', 'D', 'E', 'F'],
  maxCars: 6,
  // グリッドスタート配置 (スタートライン後方へ縦一列)。他車を障害物扱いするので
  // 発進時に張り付かないよう前後間隔は車体長(0.19m)より十分大きく取る。狭いコースでも
  // 横並びで競合しないよう左右ずれ(gridLateral)は小さめ。
  gridBack: 0.30,    // m: 1 台ごとの後方間隔
  gridLateral: 0.10, // m: 左右の僅かなジグザグ量
  gridFront: 0.16,   // m: 1 台目をラインからどれだけ後方に置くか
};

// 色覚セーフ配色 (AF4 / GitHub #26②): 既定 OFF = 従来描画と完全一致 (VIEW/FLEET の既定は不変)。
// ON のときだけ描画系が参照する可変フラグ (SENSOR_NOISE.on と同型のホルダー)。物理・学習・レース
// 計算には一切関与しない (描画専用)。色だけに依存しないよう、ON では破線/マーカ形状の冗長コーディング
// も併用する (レイ=破線・ヒット点=四角・状態テキストは元々語で区別)。
export const A11Y = { cvdSafe: false };
// Okabe–Ito 由来の色覚安全な定性パレット。既定 FLEET.colors の赤(#e2202a)と緑(#28c76f) は
// 1型/2型色覚 (赤緑) で混同しやすいが、本パレットは相互に判別しやすい (青/橙/緑(青寄)/桃/空/朱)。
// ON 時のみ描画層が各車色とテレメトリ色をここへ写像する (既定 OFF では一切参照しない)。
export const CVD = {
  fleet: ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#d55e00'],
  run:   '#0072b2',   // 走行中テレメトリ (既定の緑 #6fe39a に代えて青)
  crash: '#d55e00',   // クラッシュ (既定の赤 #ff6b6b に代えて朱)
  lap:   '#56b4e9',   // 周回数 (既定の緑 #7fe0a0 に代えて空色)
};

// 車種 = 挙動(ノーマル/ドリフト) × 駆動方式(FF/FR/4WD)。
// キネマティック自転車モデルを実車の駆動方式特性で変調して差別化する。
//
// 共通係数:
//   yawGain  : 旋回ヨーの基本倍率
//   us       : 定常アンダーステア量 (速度が上がるほど曲がりにくい) → ヨーを 1/(1+us·sp) 倍
//   os       : 定常オーバーステア量 (速度が上がるほど巻き込む)     → ヨーを (1+os·sp) 倍
//   powerUs  : アクセルON時に加算されるアンダー (FF: 前輪が駆動+操舵を兼ねて飽和)
//   powerOs  : アクセルON時に加算されるオーバー (FR: パワーオーバーステア)
//   liftOffOs: アクセルOFF旋回時に加算されるオーバー (タックイン)
//   brakeOs  : BRAKE 中に加算されるオーバー (制動の前荷重でリアが軽くなる。FR 顕著・FF 安定)
//   spin     : 発進ホイールスピン量 (低速×高スロットルで駆動輪が空転し加速が鈍る。
//              FF=加速で駆動輪の荷重が抜け大、FR=リア荷重で軽度、4WD=ほぼ無し)
//   slide    : 通常時の横滑り量 (旋回で車体が外へ滑る)
//   accel/brake/maxSpeed : 既定 CAR 値に対する倍率
//
// drift (ドリフト車のみ。null=滑らない=ノーマル):
//   trigger  : 滑り出す要求の種類
//              'power'   = 駆動(アクセル開度)で滑る (FR/4WD: パワースライド)
//              'liftoff' = 高速旋回中のアクセルOFF/減速で滑る (FF: リフトオフオーバーステア。
//                          再加速すると前輪が引っ張ってドリフトが速く収束する)
//   grip     : グリップ上限 (0..1)。要求がこれを超えた分だけ滑り出す (旧 PWM 閾値の連続版)
//   gain     : 超過量→滑り量の感度 (大きいほど少しの超過で一気に滑る)
//   brakeDrift: true なら旋回中の急ブレーキでも滑り出す (ブレーキングドリフト。'power' 車のみ)
//   minSp    : 滑り出しに必要な正規化速度 (0..1)
//   slipYaw  : 滑り中の追加回頭 (リアが流れて車体が巻き込む量)
//   slipSlide: 滑り中の横滑り量 (車体が外へ流れる量)
//   attack   : 滑りの立ち上がり速さ (1/s)
//   release  : グリップ回復の速さ (1/s)。逆ハン(カウンター)中は半分の速さで“保持”寄りになる。
// ※ 滑走中、滑り方向と逆へ舵を当てる(逆ハン)と回頭が打ち消され姿勢が安定、
//    滑り方向へ切り込むと滑りが深まる(スピン方向)。
const DRIVE = {
  // FF: パワーオンで強アンダー・タックインあり。エンジン重量が前にあり制動安定。
  ff: {
    label: 'FF (前輪駆動)', mass: 1380,   // 例: 量産スポーツコンパクトの高性能グレード級 (中量)
    yawGain: 0.95, us: 0.45, os: 0.00, powerUs: 0.50, powerOs: 0.00, liftOffOs: 0.18,
    brakeOs: 0.02, spin: 0.45,
    accel: 1.00, brake: 1.08, maxSpeed: 0.97, slide: 0.04,
    // FF ドリフト = リフトオフでリアだけ滑り出す (回頭強め・横流れは控えめ)
    drift: { trigger: 'liftoff', grip: 0.70, gain: 3.0, minSp: 0.45, slipYaw: 0.85, slipSlide: 0.45, attack: 6.0, release: 4.0 },
  },
  // FR: 駆動と操舵が分離して素直に曲がるが、パワーオンでリアが流れる。制動でも姿勢が乱れやすい。
  fr: {
    label: 'FR (後輪駆動)', mass: 1180,   // 例: 軽量ライトウェイトスポーツ級 (軽量で俊敏)
    yawGain: 1.05, us: 0.10, os: 0.10, powerUs: 0.00, powerOs: 0.40, liftOffOs: 0.05,
    brakeOs: 0.22, spin: 0.18,
    accel: 1.05, brake: 0.95, maxSpeed: 1.02, slide: 0.10,
    // FR ドリフト = パワーオーバーステア。リアが大きく流れて回頭、アクセルを戻すと素早く回復。
    // 旋回中の急ブレーキでも滑る (ブレーキングドリフト)。grip 0.84 ≒ 旧 PWM220 相当。
    drift: { trigger: 'power', grip: 0.84, gain: 6.0, brakeDrift: true, minSp: 0.40, slipYaw: 1.20, slipSlide: 0.45, attack: 4.5, release: 5.0 },
  },
  // 4WD: トラクション最強で発進加速に優れ (空転ほぼ無し)、弱アンダーの安定志向。だが重い。
  awd: {
    label: '4WD', mass: 1560,            // 例: 高出力ハイパフォーマンス4WD級 (高出力だが重量級)
    yawGain: 1.00, us: 0.30, os: 0.00, powerUs: 0.15, powerOs: 0.10, liftOffOs: 0.08,
    brakeOs: 0.08, spin: 0.00,
    accel: 1.25, brake: 1.10, maxSpeed: 1.06, slide: 0.02,
    // 4WD ドリフト = ラリー的な四輪ドリフト。回頭は穏やかだが車体ごと外へ流れ、回復が速い。
    // ラリーの振り回し同様、旋回中の急ブレーキでも滑る。grip 0.85 ≒ 旧 PWM220 相当。
    drift: { trigger: 'power', grip: 0.85, gain: 6.0, brakeDrift: true, minSp: 0.50, slipYaw: 0.25, slipSlide: 0.15, attack: 5.0, release: 6.0 },
  },
};
// 重量効果の基準質量(kg)。各車の mass/MASS_REF が「重さ係数」。
// 重い車ほど旋回で慣性が勝りアンダー(曲がりにくい)、制動も僅かに伸びる。下り(重力)では
// 加速は重量に依らない(g·sinθ)が、コーナーでの“曲げにくさ”が効くため軽い車が有利になる。
export const MASS_REF = 1370;
export const MASS = {
  us: 0.85,    // (重さ係数-1) × これ を定常アンダーに加算 (重い=曲がらない/軽い=俊敏)
  brake: 0.25, // 制動の伸び (重い=止まりにくい)
};
function mkType(behavior, dk) {
  const d = DRIVE[dk], drift = behavior === 'drift';
  return {
    key: `${behavior}_${dk}`,
    name: `${drift ? 'ドリフト' : 'ノーマル'} ${d.label}`,
    mass: d.mass,
    yawGain: d.yawGain, us: d.us, os: d.os,
    powerUs: d.powerUs, powerOs: d.powerOs, liftOffOs: d.liftOffOs,
    brakeOs: d.brakeOs, spin: d.spin,
    accel: d.accel, brake: d.brake, maxSpeed: d.maxSpeed,
    slide: d.slide,
    drift: drift ? d.drift : null,
  };
}
export const CAR_TYPES = [
  mkType('normal', 'fr'), mkType('normal', 'ff'), mkType('normal', 'awd'),
  mkType('drift', 'ff'), mkType('drift', 'fr'), mkType('drift', 'awd'),
];
export const CAR_TYPE_BY_KEY = Object.fromEntries(CAR_TYPES.map(t => [t.key, t]));
export const CAR_TYPE_DEFAULT = CAR_TYPES[0].key; // ノーマル FR

// ===== 車種パラメータの公開 + 利用者の独自車種追加 =====
// 各パラメータの意味 (UI「車種パラメータ」表示・独自車種定義の参考に)。
export const CAR_PARAM_DOC = [
  ['mass', '車重(kg)。重いほど旋回でアンダー(慣性)・制動が伸びる。'],
  ['accel', '加速の倍率。大きいほど速く目標速度へ。'],
  ['brake', '制動の倍率。大きいほど短く止まる。'],
  ['maxSpeed', '最高速の倍率(基準 0.7 m/s に対する比)。'],
  ['spin', '発進ホイールスピン量。大きいほど発進で空転し加速が鈍る(FF大/4WD≈0)。'],
  ['yawGain', '旋回ヨーの基本倍率。'],
  ['us', '定常アンダーステア量。大きいほど高速で曲がりにくい。'],
  ['os', '定常オーバーステア量。大きいほど高速で巻き込む。'],
  ['powerUs', 'アクセルON時に増すアンダー(FF: 前輪が駆動+操舵で飽和)。'],
  ['powerOs', 'アクセルON時に増すオーバー(FR: パワーオーバーステア)。'],
  ['liftOffOs', 'アクセルOFF旋回で増すオーバー(タックイン)。'],
  ['brakeOs', '制動中に増すオーバー(前荷重でリアが軽い。FR顕著)。'],
  ['slide', '通常時の横滑り量。'],
  ['drift', 'ドリフト設定(null=滑らない)。{trigger,grip,gain,minSp,slipYaw,slipSlide,attack,release,brakeDrift}'],
];

// 独自車種を登録する (利用者定義。最低限 key/name と駆動系パラメータがあればよい)。
// 既定値で埋めるので、一部だけ指定しても動く。重複キーは置き換える。
export function registerCarType(def) {
  if (!def || !def.key) return null;
  const base = mkType('normal', 'fr'); // 既定の土台 (FR ノーマル)
  const t = { ...base, ...def, custom: true };
  // drift は { ...} or null。指定が object なら既定とマージ。
  if (def.drift && typeof def.drift === 'object') {
    const dbase = DRIVE.fr.drift;
    t.drift = { ...dbase, ...def.drift };
  } else if (def.drift === null || def.drift === undefined) {
    t.drift = def.key && CAR_TYPE_BY_KEY[def.key] ? CAR_TYPE_BY_KEY[def.key].drift : null;
    if (def.drift === null) t.drift = null;
  }
  const idx = CAR_TYPES.findIndex(x => x.key === t.key);
  if (idx >= 0) CAR_TYPES[idx] = t; else CAR_TYPES.push(t);
  CAR_TYPE_BY_KEY[t.key] = t;
  return t;
}

// 独自車種の登録解除 (個別削除)。組込車種 (custom でない既定6種) は保護して解除しない
// (= shipped 既定の CAR_TYPES は壊さない)。解除できたら true。
export function unregisterCarType(key) {
  const idx = CAR_TYPES.findIndex(x => x.key === key);
  if (idx < 0) return false;
  if (!CAR_TYPES[idx].custom) return false; // 組込は保護 (V3 で別途扱う)
  CAR_TYPES.splice(idx, 1);
  delete CAR_TYPE_BY_KEY[key];
  return true;
}

// ===== 物理モデルの切替 =====
// dynamic  = 単軌道動力学モデル (physics_dyn.js DynCar。既定。ドリフト/バックエントリーが物理として可能)
// standard = キネマティック自転車モデル (physics.js Car。クラシック物理として選択可)
// v2       = 精密動力学 (physics_v2.js CarV2。Stage AO。4輪 two-track＋緻密接触・fullscale 向け。
//            AO1 骨格では dynamic 相当の挙動=guarded branch のため卓上既定 byte 不変)
// Phase D4-B6 (2026-06-13) で dynamic を既定化 (test_programs 161/180・峠47/48・ウェット全完走を確認済み)。
// UI の初期選択 (index.html #optPhysMode) はこの既定値と一致させること。
export const PHYSICS = { mode: 'dynamic' };
export const PHYSICS_MODES = ['standard', 'dynamic', 'v2'];   // 3値白リスト (Stage AO1)
// v2 エンジンのタイヤセット (Stage AO6・car.tireSet)。normal=既定 (ゴム/スリック)。slip=スリップタイヤ
// (硬質プラ/ハードコンパウンド=疑似ドリフト環境)。物理定数は REGIMES[name].v2tire に領域別に持つ。
// **既定 normal のときは共有 URL/レース canon に載せない=既存ハッシュ byte 不変** (physics/grid と同型)。
export const TIRE_SETS = ['normal', 'slip'];
export const TIRE_DEFAULT = 'normal';
export function setPhysicsMode(m) {
  PHYSICS.mode = PHYSICS_MODES.includes(m) ? m : 'dynamic';   // 未知値は既定 dynamic へフォールバック
  return PHYSICS.mode;
}

// 領域適用フック (Stage AO5)。applyRegime(physics_dyn.js) は DYN/CAR というグローバル holder を書くが、
// v2 エンジンは自前の holder (V2・physics_v2.js) を持つ。両者を単一の choke point (applyRegime) から
// 同期させるため、physics_v2.js が applyRegimeV2 をここへ登録し、applyRegime が末尾で全フックを呼ぶ。
// **循環 import を避ける**ため (physics_dyn ↔ physics_v2)、両モジュールが config.js のみに依存する形にする
// (physics_dyn は本配列を呼ぶだけ・v2 の存在を知らない/ physics_v2 は本関数で登録するだけ)。フックは
// v2 が到達可能な全経路 (fleet.js が CarV2 を top-level import・全 v2 ゲートが physics_v2 を import) で
// モジュール読込時に登録済 = applyRegime の初回呼出 (ユーザー操作/runRace・全 import 解決後) までに必ず在る。
export const REGIME_HOOKS = [];
export function registerRegimeHook(fn) { if (typeof fn === 'function' && !REGIME_HOOKS.includes(fn)) REGIME_HOOKS.push(fn); }

// ===== 領域(regime) — 物理スケールのプリセット (Phase F1) =====
// 同じ動力学エンジンで卓上 (RumiCar 実機, 1.3km/h) 〜 フルスケールレース (350km/h) を扱う。
// 設計原理: 支配比 Ay*=(v²/R)/(μg) を領域不変に保つ「動的相似 (dynamic similarity)」。
// 領域は長さ L・特性速度 V・重力 g・路面μ という次元パラメータで定義し、Froude 相似則
//   kV=√(kL·kG) (kMu=1)  ⇒ (V²/L)/(μg) 不変
// で全ての速度・加速度・時間レートの量をスケールする。学習者は「卓上で走るプログラムが
// フルスケールでスピンする → なぜ?」を相似則として体得できる。
//
// プリセットは物理スカラー (DYN/CAR が読む量) を flat に保持する。applyRegime() (physics_dyn.js)
// が DYN.* / CAR.* へ書き込む。**卓上(tabletop) = 現値そのもの** なので applyRegime('tabletop')
// は byte no-op (f0_regime Part A の退行ゼロ契約)。L/sensorMaxMm/topKmh は派生・表示用メタ。
export const REGIMES = {
  tabletop: {
    name: '卓上 (RumiCar 実機相当)',
    desc: '実寸 13cm・1.3km/h。異方性摩擦で滑り出しが見える卓上スケール。初心者はここで滑らず学ぶ。',
    L: 0.13,            // 長さスケール (wheelBase, m) — 無次元化/ToF レンジの基準
    // 重力・摩擦 (DYN へ)
    g: 9.81, muY: 0.19, muYDrift: 0.13, muX: 0.75, muXDrift: 0.35, C0: 10.0,
    // 速度・加速度系 (CAR へ)
    maxSpeed: 0.7, accel: 2.5, brake: 4.0, coast: 1.2, steerRate: 7.0,
    // 低速・数値系 (DYN へ)
    uBlend0: 0.02, uBlend1: 0.08, absUFloor: 0.05, uStop: 0.02, uStopHard: 1e-4,
    vlatStop: 2.5, nSub: 4, adaptiveSub: false,
    // タイヤ横力曲線のピーク+穏やか減衰 (tire-1, Phase F4)。alphaPeak = ピーク滑り角 (rad, 無次元なので
    // Froude スケール不変)。|α|≤alphaPeak はピーク横力 (摩擦楕円) フル、超えると 1/(1+kDecay·(|α|−αpeak))
    // で穏やかに減衰 (ゼロには落とさない)。卓上は alphaPeak 大きめ・kDecay 浅めで創発を等価角で維持
    // (落ち込み過大は全速ドリフトを殺す既往退行 β68→3 があるため)。線形域 (小α) は不変 → std/dyn byte 維持。
    alphaPeak: 1.35, kDecay: 0.50,
    // kinFactor (実効舵角シム) のフェード強度 (Phase F-kin)。卓上=1 = シム全量 (US/OS を異方性摩擦ハック上の
    // 入力側シムで再現=操縦感/プログラム互換/教材パラメータ us/os/powerUs/liftOffOs/brakeOs/yawGain を保持)。
    // フルスケール (等方実μ+空力+F4 曲線=US/OS の物理母体がそろう) でのみ 0 へフェードし kinFactor/steerK を
    // 撤去して US/OS を物理から創発させる。適用は連続ブレンド (二値禁止)。midscale は相似保持なので 1 のまま。
    kinFade: 1,
    // 左右(横)荷重移動の強さ (Z2 / IMP-01)。卓上=0 = 寄与ゼロ=恒等 (横荷重移動ブロックをスキップ=byte 完全
    // 不変)。卓上は異方性摩擦ハック (μ を線形に逆算した値) で滑り出しを作っており、実タイヤの荷重感度
    // 非線形性 (荷重移動で軸グリップが目減りする) は相似破れの実μ領域 (fullscale) でのみ物理的に正しい。
    // ∴ circleBi/kinFade と同じ相似破れ境界で fullscale のみ >0 にする (中スケールは Froude 相似保持=0)。
    latLoadK: 0,
    // 摩擦円の双方向結合強度 (tire-3, Phase F2)。卓上=0 = 片方向(縦優先)。卓上のスリップタイヤは
    // 駆動輪空転で横力が消える (=パワーオーバー/ドーナツの母体) wheelspin 律速のため縦優先が物理的に
    // 正しく、双方向化は創発を壊す (sweep_f2.mjs 実測: κ=0.05 でパワーオーバー156→145°・ドーナツβ87→63°)。
    // 等方実μのフルスケール領域では 1 (=ラジアル円) が正しい (combined-slip でグリップ限界。F3 で活性化)。
    circleBi: 0,
    // 車輪スリップ率/縦力 (Phase F5, 任意・競技題材)。wheelDyn=0 で車輪角速度ブロックを丸ごとスキップ
    // → 従来の「指令の瞬時クランプ」のまま = byte 完全不変。卓上は 0 (過去2度棄却 156/180 を領域ゲートで回避)。
    // フルスケールでのみ活性化し、車輪面速度 vw=ωR を陽的 Euler 積分してスリップ率 s=(vw−u)/|u| から縦版
    // Pacejka 縦力を導く → ローンチ・ホイールスピン (全開ベタ踏みが空転損失でスルーレート制御に負ける) と
    // ブレーキ・ロック (s→−1 で横グリップ喪失) が創発する。driveBand=0.06 は卓上の従来駆動レート (不変)、
    // wheelPower/launchAccel は fullscale 専用の定出力ドライブトレイン (accel/muX は不変=空転は車輪慣性から創発)。
    wheelDyn: 0, wheelLambda: 0, sPeak: 0, wheelB: 0, wheelC: 0,
    driveBand: 0.06, wheelPower: 0, launchAccel: 0,
    // 空力 (Phase F3)。卓上は ρ=0/A=0 で完全 no-op (動圧 ½ρ·A·u² がゼロ → 抗力もダウンフォースもゼロ)。
    // 卓上スケール (13cm, 0.7m/s) では v² が小さく空力は実質無視できる (フルスケール比で約7万分の1)。
    rho: 0, Cd: 0, Cl: 0, frontalArea: 0, downforceBalance: 0.5,
    // 表示・知覚メタ。realKmh=false は displayKmh が「最高速比×topKmh」の没入写像を使う (卓上の体感維持)。
    sensorMaxMm: 2000, topKmh: 350, realKmh: false,
    // ── v2 エンジン専用タイヤセット較正 (Stage AO6・AO_spec §4・車ごと car.tireSet で選択) ──
    // 卓上は RC 実機ハード相当: normal=ゴム (μ0≈0.8・§4 帯 0.7–0.9) で「通常ドリフトは起きない」
    // (最大到達 ay=v²/R≈1.6 ≪ μg≈7.8 → 機械述語 max|β|<5°)。slip=硬質プラ (μ0≈0.20・帯 0.15–0.30)
    // で μg≈2.0 → 限界超過が到達可能・後軸縦容量≈1.0<accel 2.5 → 発進空転/パワーオーバーが成立し
    // 疑似ドリフト練習場になる (§10.2)。μ0/αP/κP/muDecay は無次元 ⇒ Froude 相似の midscale は本表を
    // そのまま継承 (scaleRegime が v2tire をコピー=「Froude 導出」)。normal は fullscale normal と同じ
    // 数理性質 (摩擦円・定常円・散逸) ゆえ AO2/AO3 ゲートは緑・卓上既定は dynamic なので f0/f1 は byte 不変。
    v2tire: {
      normal: { mu0: 0.8,  muDecay: 0.75, alphaP: 0.14, kappaP: 0.10, relLenFrac: 0.5 },
      slip:   { mu0: 0.20, muDecay: 0.95, alphaP: 0.25, kappaP: 0.18, relLenFrac: 0.6 },
    },
  },
};
// 現在アクティブな領域名 (applyRegime が更新)。既定=卓上。
export const REGIME_STATE = { active: 'tabletop' };

// 動的相似スケーリング: 基準領域 base を 長さ kL・摩擦 kMu・重力 kG 倍した派生領域を生成する。
// Froude 相似 kV=√(kL·kG·kMu) で速度を、時間は kT=√(kL/(kG·kMu)) でスケールし、Ay* を不変に保つ。
//   速度 (m/s)     : ×kV      … maxSpeed, uBlend0/1, absUFloor, uStop, uStopHard
//   加速度 (m/s²)  : ×kG·kMu  … accel, brake, coast, C0 (=Cα*·μg なので μ·g に比例)
//   重力 (m/s²)    : ×kG      … g
//   摩擦 (無次元)  : ×kMu     … muY, muYDrift, muX, muXDrift
//   レート (1/s)   : ÷kT      … steerRate, vlatStop
//   長さ (m)       : ×kL      … L, sensorMaxMm
// これにより同じ走行プログラムを領域を変えて走らせても、滑り出し (Ay*=1) が同じ操作で起きる。
export function scaleRegime(base, { name, desc, kL = 1, kMu = 1, kG = 1, topKmh } = {}) {
  const kV = Math.sqrt(kL * kG * kMu);   // 速度スケール (Froude)
  const kT = Math.sqrt(kL / (kG * kMu)); // 時間スケール
  const kA = kG * kMu;                   // 加速度スケール (=kV²/kL)
  return {
    name: name || `${base.name} ×${kL}`,
    desc: desc || `${base.name} を 長さ${kL}・μ${kMu}・g${kG} 倍した相似領域 (Ay* 不変)`,
    L: base.L * kL,
    g: base.g * kG,
    muY: base.muY * kMu, muYDrift: base.muYDrift * kMu,
    muX: base.muX * kMu, muXDrift: base.muXDrift * kMu,
    C0: base.C0 * kA,
    maxSpeed: base.maxSpeed * kV, accel: base.accel * kA, brake: base.brake * kA,
    coast: base.coast * kA, steerRate: base.steerRate / kT,
    uBlend0: base.uBlend0 * kV, uBlend1: base.uBlend1 * kV, absUFloor: base.absUFloor * kV,
    uStop: base.uStop * kV, uStopHard: base.uStopHard * kV,
    vlatStop: base.vlatStop / kT, nSub: base.nSub, adaptiveSub: true,
    // タイヤ横力曲線の形状係数 (tire-1, F4) は無次元 (滑り角・減衰率) なので Froude 相似で不変 (base 引き継ぎ)。
    alphaPeak: (base.alphaPeak != null) ? base.alphaPeak : 1.35,
    kDecay: (base.kDecay != null) ? base.kDecay : 0.50,
    // kinFactor フェード (F-kin) は base から引き継ぐ。Froude 相似領域 (midscale) は卓上と同じ異方性摩擦・
    // 同じ Ay* (相似保持) なので kinFade=1 のまま (シムが等しく妥当)。kinFade を 0 へ落とすのは相似破れの
    // 実μ等方領域 (fullscale) のみ=circleBi 0→1 と同じ境界 (相似破れ以外の confound を作らない)。
    kinFade: (base.kinFade != null) ? base.kinFade : 1,
    // 摩擦円双方向結合は μ の等方性で決まる。Froude 相似 (kMu 一律) は μx/μy 比を保つので
    // base の値を引き継ぐ (kMu でスケールしても異方→等方の度合いは変わらない)。等方実μ領域は
    // 生成後に circleBi=1 を明示上書きする (F3)。連続ブレンドなので領域間に不連続帯は生じない。
    circleBi: base.circleBi || 0,
    // 左右(横)荷重移動 (Z2)。base から引き継ぐ (Froude 相似領域 midscale は base=卓上=0 のまま縮退=byte 不変・
    // Part C の Ay* 領域不変ゲートを保つ)。荷重感度は相似破れの fullscale でのみ正しい (circleBi/kinFade と同型)。
    latLoadK: base.latLoadK || 0,
    // 車輪スリップ率/縦力 (Phase F5) は base から引き継ぐ (Froude 相似領域は base=卓上=0 のまま縮退=byte 不変)。
    // driveBand のみ従来駆動レート 0.06 をフォールバック (未定義なら 0.06)。
    wheelDyn: base.wheelDyn || 0, wheelLambda: base.wheelLambda || 0,
    sPeak: base.sPeak || 0, wheelB: base.wheelB || 0, wheelC: base.wheelC || 0,
    driveBand: (base.driveBand != null) ? base.driveBand : 0.06,
    wheelPower: base.wheelPower || 0, launchAccel: base.launchAccel || 0,
    // v2 タイヤセット (Stage AO6)。μ0/αP/κP/muDecay/relLenFrac は無次元 ⇒ Froude 相似 (kMu=1) は μ を
    // 保つので base (卓上) の v2tire をそのまま継承する (=「midscale は Froude 導出」)。参照コピーで可
    // (読み取り専用・applyRegimeV2 は値を複製して V2 へ書く)。base に無い場合は undefined (V2 既定へ)。
    v2tire: base.v2tire,
    // 空力 (Phase F3) は base から引き継ぐ (Froude 相似領域は base=卓上=0 のまま no-op)。
    // 真のフルスケール race は相似が破れる (実μ等方+ダウンフォース) ため scaleRegime ではなく
    // 直接定義する (下記 REGIMES.fullscale)。
    rho: base.rho || 0, Cd: base.Cd || 0, Cl: base.Cl || 0,
    frontalArea: base.frontalArea || 0,
    downforceBalance: (base.downforceBalance != null) ? base.downforceBalance : 0.5,
    sensorMaxMm: Math.round(base.sensorMaxMm * kL), topKmh: topKmh || base.topKmh,
    realKmh: base.realKmh || false,
  };
}

// 登録済み第二領域: 卓上を 長さ2倍 (μ/g 同) した Froude 相似領域 (中スケール ≒ 屋外 RC)。
// 動的相似により Ay* は卓上と不変 = 「同じプログラムが大きく速い世界でも同じ操作で滑り出す」。
// 車体は2倍 (carScale と合成)。既存コースでも操作可能 (コース側のスケール化は Phase F の後段)。
// 真のフルスケール 350km/h レース (等方実μ+ダウンフォースで相似が破れ「速度=グリップ」) は
// 空力が要るため F3 で追加する (F0 監査 regime-7 と一致)。
REGIMES.midscale = scaleRegime(REGIMES.tabletop, {
  name: '中スケール (屋外 RC 相当)',
  desc: '卓上を長さ2倍・速度√2倍した相似領域。Ay* は卓上と同じ=同じプログラムが同じ挙動 (動的相似)。',
  kL: 2, topKmh: 500,
});

// 登録済み第三領域: 真のフルスケール・レース (実車 2.6m・最高速 ~350km/h) (Phase F3)。
// 中スケール (Froude 相似) と違い、これは**動的相似が意図的に破れた**領域:
//   - 路面μが等方の実μ (muY=muX) — 卓上の異方性ハック (muY≪muX) は不要 (本物のタイヤは等方)。
//     → ノーマル車は grip 化し、滑るには本物どおり「攻めて荷重/速度で限界を超える」必要がある。
//       (ドリフト車の縦μ muXDrift のみ Phase J2 で 0.48 に下げ、持続ドリフトを成立させた=下記 muXDrift コメント)
//   - 空力 (抗力+ダウンフォース) が効く: ダウンフォースが荷重 n を v² で増やし、摩擦円半径 μ·n が
//     速度依存になる → 「速度=グリップ」(速いほど曲がれる)。抗力が推力と釣り合って最高速を自然決定。
//   - 摩擦円が双方向ラジアル (circleBi=1): combined-slip でグリップ限界、横荷重が縦力を削る (sign-2 解消)。
// これらで卓上では到達不能な a_y/(μg)→1 が「速度を上げるだけ」で自然に起き、ハック無しで本物どおり滑る。
// 速度は実速度 (realKmh=true) なので displayKmh は m/s×3.6 を直接表示する (写像しない)。
REGIMES.fullscale = {
  name: 'フルスケール・レース (実車 350km/h)',
  desc: '実寸 2.6m・最高速約350km/h。等方実μ+空力ダウンフォースで「速度=グリップ」。上級/競技向け。',
  L: 2.6,                  // 実車ホイールベース (m)
  g: 9.81,
  // 等方実μ (前後横とも縦と同じ=本物のグリップ)。ノーマル車は circleBi=1 の combined-slip で
  // 「攻めて限界を超える」スピン (G2 の US/OS 教材) が創発する。
  // muXDrift (ドリフト車の縦μ) だけは 1.0→0.48 に下げる (Phase J2・再スコープ direction c)。
  //   理由: フルスケールは等方実μで「drift 車も grip 化」する設計だったため、ドリフト車が
  //   サーキットで即スピンし**持続ドリフトが物理的に存在しなかった** (J-4 付随事実)。縦μを下げると
  //   全開で後軸の駆動需要が縦容量を超えて空転 → 摩擦楕円で後軸横力が抜ける = パワーオーバーが復活し、
  //   保持プログラムで持続スライド (旋回平均|β|≈53°・90秒無事故・~1186m 周回) が成立する (J-5 実測)。
  //   muXDrift はドリフト車のみ参照 (physics_dyn.js: `drift ? DYN.muXDrift : DYN.muX`) ＝ ノーマル車
  //   (normal_ff/fr/awd, muX=1.4) は完全不変 (G2/test_g2/test_comp 非影響)。卓上/中スケールも不変 (byte 不変)。
  muY: 1.4, muYDrift: 1.0, muX: 1.4, muXDrift: 0.48,
  C0: 60.0,                // 実タイヤ相当のコーナリング剛性 (α_peak≈0.1rad で飽和)
  // 速度・加速度系 (実車スケール)。最高速 maxSpeed は目標値で、実際の頭打ちは抗力との釣り合いで決まる。
  maxSpeed: 110, accel: 5.4, brake: 40.0, coast: 3.0, steerRate: 2.0,
  // ドリフト車のみ操舵上限を ×2.5 (≈±60°) に拡大 (I2)。実車レーサー的な大舵角カウンター(逆ハン)を
  // 可能にする。卓上/中スケールは driftSteerMul 未定義=1 で ±24° 実機準拠のまま (byte 不変)。
  // ノーマル車には非適用 (Circuit Racer の安定周回=test_g2 に非影響)。
  driftSteerMul: 2.5,
  // 低速・数値系 (実速度スケールの停止特異点ガード。~m/s 域でのみ作用)。
  uBlend0: 0.5, uBlend1: 2.0, absUFloor: 0.5, uStop: 0.3, uStopHard: 0.01,
  vlatStop: 0.5, nSub: 4, adaptiveSub: true,
  // タイヤ横力曲線 (tire-1, F4)。実タイヤは早期 (≈0.25rad≈14°) にピーク → 限界後はやや深く落ち込む
  // (荷重/速度で限界を超える本物の挙動)。卓上より αpeak 小・kDecay 大。ダウンフォースで μ·n が v² 成長し
  // ピーク横力自体が増えるため Part F の steady-turn では Ay*>1.05 (bare μg 超のグリップ) が成立する。
  // 暫定値: F3 (空力) 本活性化時に f1_regime Part F で全車種 Ay* を実測しながら早期ピークへ調律する。
  alphaPeak: 0.25, kDecay: 0.60,
  // kinFactor フェード (F-kin)。フルスケールは相似破れ (等方実μ+空力+早期ピーク F4 曲線) で US/OS の
  // 物理母体がそろうため、入力側シム kinFactor/steerK を恒等(0)へ撤去し US/OS を物理から創発させる。
  // 卓上(1)→fullscale(0) は連続ブレンドで適用 (二値禁止)・circleBi 0→1 と同じ境界 (相似破れと一致)。
  kinFade: 0,
  // 摩擦円双方向結合 (tire-3, F2)。等方実μで combined-slip = ラジアル円。
  circleBi: 1,
  // 左右(横)荷重移動 (Z2 / IMP-01)。実車の横加速度が重心高×トレッドで外内輪へ荷重を移し、タイヤ荷重感度で
  // 各軸の有効横グリップが gm=1−latLoadK·(φ·ay/n)² に目減りする。値の根拠 (重心/トレッド/ホイールベース基準):
  // latLoadK = 4·loadSens·(h/track)²。h≈0.45m(実車重心高)・track≈1.6m → (h/track)²≈0.079、loadSens≈0.158
  // (荷重倍化で横グリップ約16%減の乾燥レースタイヤ相当) → latLoadK≈0.05。φ=前軸静的比なので定常旋回は前後
  // 均等目減りで Part F(normal_awd 定常 Ay*=1.067>1.05・余裕 0.017) を保ち、効果はトレイル制動/複合荷重
  // (nR↓で(φ·ay/nR)²増) に自己集中して荷重連成 US/OS を創発 (FR ブレーキOS β偏移 +75°→+80°・FF +3°→+8°)。
  // 上限 0.06 まで Part F 維持・0.08 で割れる (sweep 実測)。卓上/中スケールは latLoadK=0 で寄与ゼロ (byte 不変)。
  latLoadK: 0.05,
  // 車輪スリップ率/縦力 (Phase F5)。フルスケールでのみ活性化。車輪面速度 vw=ωR を陽的 Euler 積分し、
  // スリップ率 s=(vw−u)/|u| から縦版 Pacejka Fx=μx·n·gx(s) (sin(C·atan(B·s)) を sPeak で正規化) を導く。
  // wheelLambda=λ=m·R²/Iw (車輪応答の速さ・剛さ)、sPeak=ピークスリップ率 (乾燥アスファルト ≈0.10)。
  // driveBand/wheelPower/launchAccel = 定出力ドライブトレイン: 低速はトルク律速 launchAccel·accel、高速は
  // 出力律速 wheelPower/|u| で、ローンチでトルク>グリップ → 車輪が空転 (accel=5.4/muX=1.4 は不変)。
  // 251km/h で hook-up し定常巡航 347km/h は s≈0.01<sPeak で空転せず抗力律速 (Part F 維持)。
  wheelDyn: 1, wheelLambda: 28.0, sPeak: 0.10, wheelB: 14.0, wheelC: 1.7,
  driveBand: 6.0, wheelPower: 547, launchAccel: 15.0,
  // 空力 (F3)。トップフォーミュラ級の高ダウンフォース。ダウンフォースで μ·n が v² 成長 → 高速ほどグリップ。
  rho: 1.225, Cd: 0.9, Cl: 3.0, frontalArea: 1.3, downforceBalance: 0.45,
  // ── v2 エンジン専用の較正 (Stage AO5・applyRegimeV2 が V2 holder へ書込・**旧 DYN 経路は無改変**) ──
  // DYN.launchAccel(=15)/wheelPower(=547) は単軌道 DynCar 向けで、v2 の4輪 two-track では後軸グリップに対し
  // 過大 (AO-3 intel: FR launch 需要15.75/後軸グリップ7.55≈2.09 → κが±3クランプに張り付く全面空転)。v2 は
  // 4輪で軸荷重を正しく分けるため、駆動を実際の軸容量へ再フィットする。DynCar (=AN 較正の fullscale サンプル)
  // は DYN.* をそのまま読むので不変。tabletop/midscale は .v2 を持たない=applyRegimeV2 が 0 (CAR.accel 律速)
  // へフォールバック (卓上 dynamic と同型・AO6 が tire セット/領域可変化で拡張)。
  v2: { launchAccel: 7.0, wheelPower: 455 },
  // v2 タイヤセット (Stage AO6・AO_spec §4)。normal=スリック μ0=1.4 (=AO5 較正の現行値そのまま=fullscale
  // 既定 v2 の byte 不変)。slip=ハードコンパウンド相当 μ0=0.9 (帯 0.8–1.0)＝縦グリップが下がり全開で後軸が
  // 縦容量を超えて空転 → パワーオーバー/ブレーキドリフトの母体 (卓上 slip と同型の縮尺値・§11「slip タイヤで
  // 同型」)。muDecay=0.95 でピーク後ほぼ平坦=滑っても食い続けるドリフト向き。既定 normal は AO5 と完全一致。
  v2tire: {
    normal: { mu0: 1.4, muDecay: 0.75, alphaP: 0.14, kappaP: 0.10, relLenFrac: 0.5 },
    slip:   { mu0: 0.9, muDecay: 0.95, alphaP: 0.25, kappaP: 0.18, relLenFrac: 0.6 },
  },
  // 表示・知覚メタ。realKmh=true → displayKmh は実速度を直接 km/h 化 (没入写像なし)。
  // sensorMaxMm=150000 (150m): フルスケールは ~96m/s・brake40m/s² で停止距離 ~115m。ToF 40m では
  // 「見えてから止まれない」ため、3センサーで先読みブレーキ&ターンの実寸サーキットレース (G2) が
  // 成立しない。実車のレーダ/LiDAR 相当の見通し (120〜250m) に合わせ 150m へ拡張 (Phase G2・許可済み
  // fullscale チューニング)。競技グラウンドの TC/ABS サンプルは ToF を読まない (車輪エンコーダのみ) ので
  // この拡張の影響を受けない (test_comp 不変)。卓上/中スケールの sensorMaxMm は不変 (卓上 byte 不変)。
  sensorMaxMm: 150000, topKmh: 350, realKmh: true,
};

// 走行軌跡の保持量 (利用者が増減可能)。max = 保持する最大点数 (点間隔は約1cm)。
export const TRAIL = { max: 4000 };

// コースエディタのグリッドスナップ単位 (m)
export const GRID = { step: 0.05 };

// 実行
export const SIM = {
  loopHz: 20,          // ユーザー loop() 呼び出し頻度
  physicsHz: 60,       // 物理更新頻度
  maxStepsPerTick: 200000, // 1 反復あたりの評価ステップ上限 (暴走防止)
};
