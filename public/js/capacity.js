// Stage AK7 (GitHub #26 続報・実態容量): このコース×領域×スケールで「実際に走り出せる最大台数」を
// **本物のレースエンジン (runRace) を回して** 測る。AK3 の静的 fitsAllCars (壁交差0・前方0.5車長クリア)
// では、最狭のナローシケイン・レイアウトのように「静的には置けるが normal_fr がコーナー壁へ舵を切り込んで
// 単独で楽め込む」スポーンを区別できない (実測: 静的クリアランスは正準オーバルの方が悪いのに正常走行)。
// よって容量は静的幾何でなく **実走 (発走順次化ゲート込み・recover ON) で全車が carLen 以上動けるか** で
// 測るしかない。driveableCapN = max{ n∈1..maxN : 1..n 台すべてが走り出せる }。
//
// 設計判断: ① 判定プログラムは normal_fr (既定サンプル=容量の保守的代表・楽め込みが顕在化する母体)。
//   ② trackNet (観測のみ=verifyHash 不変) で各車の spawn からの最大変位を読み、 < carLen かつ非クラッシュを
//   「走り出せない」とする (wf_recover_model と同一述語=ライブとゲートが同じオラクルを使う・CI-9)。
//   ③ 結果は (コース形状の digest, regime, carLen, maxN, PHYSICS.mode) でキャッシュする。
//      ・**形状依存=digest**〔BD1 で `course.name` から置換。同名で壁だけ違うコースを区別できていなかった〕
//      ・領域依存=regime ・**エンジン依存=PHYSICS.mode**〔AZ6 で追加〕
//      ・carLen は **判定閾値**として効く。**【BD1 で是正した旧注記】**「スケール依存=carLen に内包」は誤りで、
//        `runRace` は `race_engine.js` の `setCarScale(1)` で **carScale スライダーを既定へ固定して走る**ので
//        シミュレーション自体は userK に依存しない (実測 2026-09-20: userK 0.6/1/2 で verifyHash・netMax とも同一)。
//        依存するのは上の `r.netMax[i] < CAR.length` の閾値だけで、その閾値は `runRace` の finally が復元した
//        **呼び出し側の** CAR.length である。∴ 鍵に carLen が要るのは本当だが、理由は「シムが変わるから」ではない。
//   ④ ライブは tabletop でのみ使う (楽め込みバグと判定述語の母体は卓上。fullscale は専用コース×凍結グリッド)。
import { runRace } from './race_engine.js';
import { CAR, FLEET, PHYSICS } from './config.js';
import { PROGRAM_BY_KEY } from './programs.js';

// 【BD1・2026-09-20】実走判定の覚え書き。**鍵はコース形状の同一性から導く**（下の `courseShapeDigest`）。
// 項目数には上限を置く: 鍵に形状が入って次元が 1 つ増えるので、無制限のままだと 1 セッションで
// 「形状 × 閾値(carScale) × 領域 × 上限台数 × エンジン」の直積が溜まりうる（`contact_v2.js` の
// `_gridCache` と同型の罠）。**直積を全部覚えきれる数ではない**（出荷 66 形状 × スライダー 16 段 ×
// maxN 2 通り〔`fitguard.js` は ⑥ の多台分岐で capN・1 台分岐で 1 を渡す〕だけで 2112 通りある）。
// 256 が意味するのは「**直近に触った 256 通りは覚えている**」であって「全部覚える」ではない。
// 実利用の 1 セッションで触る組み合わせはこの桁に収まり、1 項目は鍵の文字列と整数 1 つ＝数十 byte。
// 溢れたら**最も長く使われていないもの**から 1 つ捨てる（`Map` は挿入順を保つので、参照のたびに
// delete→set で末尾へ移せば `keys().next().value` が最も参照の古いものになる）。
// **上限は速さの話であって正しさの話ではない**: 追い出された鍵は次に引かれたとき実走で測り直される。
const CACHE_MAX = 256;
const _cache = new Map();

// コース形状の同一性（FNV-1a を 2 本立てで回した 64bit・16 桁 hex）。**ここが「同じコースか」を決める唯一の場所。**
//
// なぜ「答えを変えうる場の一覧」を書かないか: 旧実装の鍵は `course.name` で、名前は識別子であって
// 形状ではない。∴ **保存コースの壁だけを編集して同じ名前で ✔適用すると古い実走判定を返していた**
// （BC-12 ③(a)。実ブラウザで再現: 廊下 [0.30,1.50]×0.20m・卓上・スライダー 0.8→落ち着き 0.6 で、
//   実走の最大変位 7.370×車長 → 壁を 1 本足して 0.789×車長 に変わっても「走り出せる」と答え、
//   `log.capZeroDriveWarnOnly` が出なかった）。ここで「壁・枠・スタート・峠の勾配…」と場を数え上げると、
// **場が増えたときに同じ壊れ方をする**。∴ 列挙せずオブジェクトを歩く。
//
// **何を歩けるか（＝この関数が成り立つ前提。列挙をやめた代わりに入った暗黙の前提なので明記する）**:
//   歩くのは **プレーンなオブジェクト／配列の own enumerable な文字列キー**と、数値・文字列・真偽・null・undefined。
//   ∴ **`Map`/`Set`/`Date`/`TypedArray` の中身・Symbol キー・非列挙プロパティ・プロトタイプに持たせた状態は
//   見えない**（空オブジェクトと同じ digest になる）。コースがこの形を外れた日に「静かに古い答えを返す」ので、
//   **前提そのものを常設ゲートが測る**: `wf_bd1_capkey.mjs` の C) が、出荷コースと `normalizeCourse` の出力が
//   JSON 往復で同値（＝素のデータしか含まない）ことを毎回確かめる。同じ理由で **循環参照は歩けない**
//   （再帰が `RangeError` になる）が、コースは `course.js` の `normalizeCourse`/`buildFromSpec` が作る
//   平坦な素データだけなので到達しない — これも上の往復検査が前提として押さえる。
// 値の混ぜ方は「型印 ＋ 鍵の昇順 ＋ 倍精度のビットそのもの」なので、生成経路が違っても同じ内容なら同じ digest、
// 量子化による取りこぼしも無い（壁 1 本の x1 を 1e-12 動かしただけでも区別する＝C) が毎回測る）。
// `course.js` の描画層の指紋 `courseFingerprint` が 0.1mm へ量子化しているのとは**意図的に別方針**
// （あちらは「同じ絵になるか」・こちらは「同じ答えになるか」）。
//
// **幅を 64bit にしてある理由**: 衝突は「別の形に古い答えを返す」＝BD1 が直したのと同じ症状になる。
//   32bit だと上限 256 項目での誕生日確率が約 7.6e-6 だが、2 本立ての 64bit では約 1.8e-15 まで下がる。
//   コストは本ホスト実測（2026-09-20・出荷最多の壁 960 本『ウェットテクニカル (雨)』）で 0.70 → 0.92 ms/回。
//   **この所要は凍結した点測定で、常設ゲートは測っていない**（測るのは相異性と識別力）。比較対象の
//   「実走プローブ 1 回＝中央値 18.8ms」も AZ6（2026-09-13・出荷 66 コース卓上）の点測定で、
//   `fitguard.js` ⑥ の注記と同じ出所。∴ 0.92ms は実走プローブの約 5%・UI の目安 50ms の約 1.8%。
const _f64 = new Float64Array(1), _u32 = new Uint32Array(_f64.buffer);
export function courseShapeDigest(v) {
  let h1 = 0x811c9dc5 >>> 0, h2 = 0x2545f491 >>> 0;   // 2 本立て（別の初期値・別の乗数）＝64bit 相当
  const mixU = (u) => { u >>>= 0; h1 = Math.imul(h1 ^ u, 0x01000193) >>> 0; h2 = Math.imul(h2 ^ u, 0x85ebca6b) >>> 0; };
  const mixN = (n) => { _f64[0] = n; mixU(_u32[0]); mixU(_u32[1]); };   // 倍精度のビット（量子化しない）
  const mixS = (str) => { mixU(str.length); for (let i = 0; i < str.length; i++) mixU(str.charCodeAt(i)); };
  const walk = (x) => {
    if (x === null) { mixU(1); return; }
    const t = typeof x;
    if (t === 'number') { mixU(2); mixN(x); return; }
    if (t === 'string') { mixU(3); mixS(x); return; }
    if (t === 'boolean') { mixU(x ? 4 : 5); return; }
    if (t === 'undefined') { mixU(6); return; }
    if (t === 'object') {
      if (Array.isArray(x)) { mixU(7); mixU(x.length); for (const e of x) walk(e); return; }
      const ks = Object.keys(x).sort();   // 生成経路で鍵の並びが違っても同じ digest になる
      mixU(8); mixU(ks.length);
      for (const k of ks) { mixS(k); walk(x[k]); }
      return;
    }
    mixU(9); mixS(String(x));   // 関数・Symbol・BigInt: 素性を落とさず文字列として混ぜる
  };
  walk(v);
  return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
}

// 覚え書きの状態を**観測するための口**。判定にも本番の分岐にも一切使わない（CI-8: テスト用の分岐・
// バイパスを作らない — 読むだけの窓を 1 つ開ける）。常設ゲートが「項目数が上限を超えない」「carScale の
// 掃引で 1 件も増えない」を**数で**測るのに使い、実ブラウザゲートは「▶ で実際に 1 件積まれたか」を
// これで確かめる（積まれていなければ、その後の検査は再現経路を通っていない＝空振り）。
export const CAP_CACHE = { max: CACHE_MAX, get size() { return _cache.size; } };

const _field = (n) => { const p = PROGRAM_BY_KEY['normal_fr']; return Array.from({ length: n }, () => ({ lang: p.lang, src: p.code, carType: p.carType })); };

// この (course, regime, 現 CAR 寸法) で n 台を実走させ「走り出せない車 (最大変位 < carLen・非クラッシュ)」数。
export function stuckAtN(course, regime, n) {
  const r = runRace({ course, regime, laps: 2, field: _field(n), crashRule: { rejoin: true, penaltySec: 3 }, interact: true, maxSec: 14, trackNet: true, fitGuard: false });
  let s = 0;
  for (let i = 0; i < r.netMax.length; i++) if (r.netMax[i] < CAR.length && !r.carCrashed[i]) s++;
  return s;
}

// 実態容量: 1..n 台すべてが走り出せる最大 n。発走順次化ゲートにより卓上はおおむね単調 (n台 OK なら n-1 台も OK) な
// ので **maxN から下げて最初に全車走り出せた台数** で確定する (=clean なコースは1走で maxN 確定。ナローシケインは
// 6→5→4 で確定)。単調性は wf_recover_model が「stuck⊆{n>capN}」で構造検査する。
// **【AX4・2026-09-07 是正】単調性は「必ず成り立つ」ではなく「既知の例外つき」である。** 上の探索は単調性を前提に
// 「降順で最初に stuck=0 になった n」を返すので、単調性が破れたコースでは *その n より少ない台数で走り出せない車が出る*。
// 実在の反例: 派生峠「架空峠 ロング・ワインディング(激坂)〔道幅 2 台分〕」は stuck(3)=2 なのに stuck(4)=0 で、cap は 4 を返す
// (狭路で前方の車が give-up し、後続が発走順次化 AK7 で永久 held になる。3 台では詰まり 4 台では詰まらない)。
// wf_recover_model.mjs の既知例外リスト (単一真実源 = wf_touge_driver.mjs の AX3.KNOWN_STUCK) がこの 1 件を明示的に
// 許容している ＝ **CI はこの破れでは落ちない**。利用者裁定 (2026-09-07) は「コースを公開に残し、コース説明に注記する」で、
// driveableCapN 自体は変更していない。新しい破れは同リストに載っていないので従来どおり赤になる。
// **【AZ5・2026-09-12 是正】0 を返せるようにした。** 旧実装は末尾に `if (cap < 1) cap = 1;` を置き
// 「1台は必ず置ける (構造上の下限)」と注記していたが、これは **実走の結果に対する仮定であって構造では
// ない**。実測 (卓上・閉じた部屋 幅 4×車幅 × 奥行 1.7×車長): 静的 fitsAllCars は 3 台まで真なのに
// stuckAtN(1)=1 ＝ 1 台も carLen 動けない。旧実装はここで cap=0 を 1 へ丸めるため、呼び出し側
// (main.js ⑥) は `log.capReduced`「最大 1 台なら走り出せます」と **嘘を告知していた**。
// capacityOf (fleet.js・静的側) が AZ2 で 0 を返せるようになったのと同じ是正を、実走側にも当てる。
// 0 = 「この構成では 1 台も走り出せない」。**呼び出し側は 0 を無言で握りつぶさないこと**
// (main.js は capZero を立てて log.capZeroDriveWarn を出す)。
export function driveableCapN(course, regime, maxN = FLEET.maxCars) {
  // **【AZ6・2026-09-13】鍵に物理エンジン (PHYSICS.mode) を入れた。** `stuckAtN` は `runRace` に
  // `physics` を渡さない (下の `_field` と同じ行) ので、`race_engine.js` の
  // `if (spec.physics != null) setPhysicsMode(spec.physics);` により **現在のグローバル
  // `PHYSICS.mode` で走る**。鍵に入っていないと classic↔dynamic↔v2 を切り替えても古い答えを返す。
  // AZ6 以前はこの経路が多台編成限定だったが、⑥ の 1 台分岐で **既定編成の ▶/🏁 のたびに通る主経路**
  // になったので、取り違えの実害が全利用者へ広がる前に塞ぐ (層 4 レビュー 2026-09-13 の指摘。
  // **エンジン差で答えが変わる実例はまだ見つかっていない**＝構造上の危険を先に塞ぐ側の判断)。
  // **【BD1・2026-09-20】鍵の 1 つ目をコース名から形状の digest へ替えた。** 名前は識別子であって形状では
  //   ないので、同名で壁だけ違うコース（＝保存コースを編集して ✔適用した結果）を区別できなかった。
  //   他の 4 つは従来どおり: 領域・判定閾値になる車長・上限台数・物理エンジン（AZ6）。
  // **【BD1・2026-09-20】`regime` の正規化を鍵の中から関数の入口へ出した。** 旧実装は鍵の中だけで
  //   `regime || 'tabletop'` と補っており、falsy を渡すと **鍵は tabletop・実行は現在の `REGIME_STATE.active`**
  //   （`race_engine.js` の `if (regime) applyRegime(regime);`）という食い違いが起きた。製品側
  //   （`fitguard.js` ⑥）は常に領域名を渡すので到達しないが、鍵と実行が別の値を見る形は残さない。
  regime = regime || 'tabletop';
  const key = `${courseShapeDigest(course)}|${regime}|${CAR.length.toFixed(4)}|${maxN}|${PHYSICS.mode}`;
  if (_cache.has(key)) { const hit = _cache.get(key); _cache.delete(key); _cache.set(key, hit); return hit; }   // LRU: 参照で最新へ
  let cap = maxN;
  while (cap >= 1 && stuckAtN(course, regime, cap) > 0) cap--;
  _cache.set(key, cap);
  if (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value);   // 溢れたら最も長く使われていないものを 1 つ捨てる
  return cap;   // 0 = 1台も走り出せない (呼び出し側が告知する)
}
