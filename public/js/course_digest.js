// コース形状の同一性（FNV-1a を 2 本立てで回した 64bit・16 桁 hex）。**ここが「同じコースか」を決める唯一の場所。**
// 依存ゼロの葉モジュール。`capacity.js`（実走容量の覚え書きの鍵・BD1）と `lap.js`（練習ベストの鍵・BE2）が共用する。
// 【BE2・2026-09-24】BD1 では `capacity.js` の中に置いていたが、`lap.js` から import すると
//   lap → capacity → race_engine → fleet → lap の循環になる（`fnv1a.js` を葉に切り出したのと同じ理由）。
//   ∴ 関数本体とこの注記を**そのまま**ここへ移した（写しは作らない。`capacity.js` は再 export する）。
//   出力は移す前と byte 一致（移設時に出荷 66 本で実測）。**値そのもの**は `wf_be2_practicekey` の P)（出荷全コースの
//   練習記録の指紋の凍結表）が毎回固定する — 練習ベストの鍵がこの値に永続的に依存するため（値が変わると利用者の
//   記録が見えなくなる）。`wf_bd1_capkey` の B)/C) が測るのは相異性と安定性で、値の固定ではない。
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
//
// **grid（既定 0＝丸めない）**: 0 でなければ、数値を 1/grid の格子へ丸めてから混ぜる（`Math.round(n*grid)/grid`・`-0` は `+0`・
//   非有限はそのまま）。【BE2・2026-09-24】練習ベストの鍵（`lap.js` `practiceCourseId`）だけが 1e6 を渡す — 理由はそちらの注記。
//   `capacity.js` は渡さない（＝この引数を足す前と byte 一致の出力。1e-12 の差も区別する方針のまま）。
const _f64 = new Float64Array(1), _u32 = new Uint32Array(_f64.buffer);
export function courseShapeDigest(v, grid = 0) {
  let h1 = 0x811c9dc5 >>> 0, h2 = 0x2545f491 >>> 0;   // 2 本立て（別の初期値・別の乗数）＝64bit 相当
  const mixU = (u) => { u >>>= 0; h1 = Math.imul(h1 ^ u, 0x01000193) >>> 0; h2 = Math.imul(h2 ^ u, 0x85ebca6b) >>> 0; };
  const mixN = (n) => { _f64[0] = n; mixU(_u32[0]); mixU(_u32[1]); };   // 倍精度のビット（量子化しない）
  const mixS = (str) => { mixU(str.length); for (let i = 0; i < str.length; i++) mixU(str.charCodeAt(i)); };
  const walk = (x) => {
    if (x === null) { mixU(1); return; }
    const t = typeof x;
    if (t === 'number') { mixU(2); mixN(grid && Number.isFinite(x) ? (Math.round(x * grid) / grid || 0) : x); return; }
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
