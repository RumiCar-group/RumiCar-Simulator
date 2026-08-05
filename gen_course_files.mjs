// テストコース courses.json を GitHub 公開用に「1コース1ファイル」へ分割し、
// 索引 (index.json)・README・コミュニティ投稿の例を /tmp/rc_courses 配下へ生成する。
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { buildFromSpec } from './public/js/course.js';

const OUT = '/tmp/rc_courses';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT + '/courses/community', { recursive: true });

const specs = JSON.parse(readFileSync('./public/data/courses.json', 'utf8'));

// 日本語コース名 → ファイル名用ローマ字 (カタログを読みやすくするため)
const ROMAJI = {
  'オーバル': 'oval', 'スピードウェイ': 'speedway', 'ヘアピン': 'hairpin',
  '90度サーキット': '90deg-circuit', 'S字シケイン': 's-chicane', '複合コーナー': 'compound-corner',
  'ナローゲート': 'narrow-gate', 'ボトルネック': 'bottleneck', '丸の中の四角': 'square-in-circle',
  '四角の中の丸': 'circle-in-square', '六角と三角': 'hexagon-triangle', 'うねりと円': 'wavy-circle',
  'テクニカル周回 (簡易)': 'technical-loop-simple', 'タイト市街地 (簡易)': 'tight-street-simple', 'ロングオーバル': 'long-oval',
  'オクタゴン': 'octagon', 'トライアングル': 'triangle', 'ハイスピード・レイアウト': 'high-speed',
  'エッセ・レイアウト': 'esses', 'ストリート・レイアウト': 'street', 'フローイング・レイアウト': 'flowing',
  'ロングラン・レイアウト': 'long-run', 'ロングストレート・レイアウト': 'long-straight', 'コンパクト・レイアウト': 'compact',
  'ツイスティ・レイアウト': 'twisty', 'ショート・レイアウト': 'short',
  'モダン・レイアウト': 'modern', 'ストップ＆ゴー・レイアウト': 'stop-and-go',
  'ナローシケイン・レイアウト': 'narrow-chicane', 'バンク・レイアウト': 'banked',
  '峠① 中速ヘアピン (緩い下り)': 'touge-1-gentle', '峠② タイトヘアピン (急な下り)': 'touge-2-tight',
  '峠③ 高速ヘアピン (大R下り)': 'touge-3-fast',
  'ウェットテクニカル (雨)': 'wet-technical', 'ウェットS字 (雨)': 'wet-esses',
  '架空峠 ロング・ワインディング(緩斜面)': 'touge-winding-gentle',
  '架空峠 ロング・ワインディング(中斜面)': 'touge-winding-mid',
  '架空峠 ロング・ワインディング(激坂)': 'touge-winding-steep',
  'ドリフト広場 (ショー会場)': 'drift-plaza',
  // フルスケール競技コース。対応表に無いと slug が 'course' へ落ちて
  // 40-course.json のような無意味なファイル名になるため明示する。
  '競技グラウンド (フルスケール)': 'competition-ground',
  '競技サーキット (フルスケール)': 'competition-circuit',
};

function slug(name, i) {
  const r = ROMAJI[name]
    || (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    || 'course';
  return String(i + 1).padStart(2, '0') + '-' + r;
}

const index = [];
specs.forEach((spec, i) => {
  const fn = slug(spec.name, i) + '.json';
  writeFileSync(`${OUT}/courses/${fn}`, JSON.stringify(spec, null, 2) + '\n');
  index.push({ file: `courses/${fn}`, name: spec.name, kind: spec.kind || 'loop', desc: spec.desc || '' });
});
writeFileSync(`${OUT}/courses/index.json`, JSON.stringify(index, null, 2) + '\n');

// コミュニティ投稿の例 (エディタ書出と同じ正規化フォーマット: walls/start/finish/bounds)
const ex = buildFromSpec({
  name: 'サンプル8の字風 (コミュニティ例)', kind: 'track', shape: 'lobed',
  rBase: 1.0, amp: 0.34, lobes: 2, width: 0.5, samples: 120, smooth: 2,
  desc: 'コミュニティ投稿の例。エディタの「GitHubで共有」で同形式が作られます。',
});
writeFileSync(`${OUT}/courses/community/example-community-course.json`,
  JSON.stringify({ name: ex.name, desc: ex.desc, bounds: ex.bounds, start: ex.start, finish: ex.finish, walls: ex.walls }, null, 2) + '\n');

writeFileSync(`${OUT}/courses/README.md`, `# RumiCar Simulator — コースカタログ

このフォルダは [RumiCar Simulator](https://www.rumicar.com/simulator/) のコースデータです。

## 構成
- \`courses/*.json\` — 公式テストコース (1 コース 1 ファイル, スペック形式)
- \`courses/index.json\` — 上記の索引 (file / name / kind / desc)
- \`courses/community/*.json\` — **利用者が投稿したコース** (正規化形式: walls/start/finish/bounds)

シミュレータは起動時に \`courses/community/\` を読み込み、コース選択メニューに
「🌐 名前」として追加します。

## コースを投稿する (PR)
1. シミュレータで「コース編集 ✎」からコースを作成
2. 「GitHubで共有」ボタンを押す → GitHub の新規ファイル作成画面が JSON 入りで開きます
3. そのままコミットするとプルリクエストが作成されます (書込権限が無い場合は自動で fork されます)
4. マージ後、全利用者のメニューに表示されます

## フォーマット (community)
\`\`\`json
{
  "name": "コース名",
  "desc": "説明 (任意)",
  "bounds": { "w": 3.0, "h": 2.0 },
  "start": { "x": 0.4, "y": 0.3, "theta": 0 },
  "finish": { "x1": 0.4, "y1": 0.0, "x2": 0.4, "y2": 0.6 },
  "walls": [ { "x1": 0, "y1": 0, "x2": 3, "y2": 0 }, ... ]
}
\`\`\`
壁は線分 (メートル単位) の配列です。RumiCar は左右の壁に追従するため、必ず
内外2本で囲まれた周回路にしてください。
`);

console.log(`生成完了: テストコース ${specs.length} 件 + index.json + README + コミュニティ例 1 件`);
console.log('出力先:', OUT);
