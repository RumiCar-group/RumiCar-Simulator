// wf_be6_intake.mjs — 投稿コースの入口で重さの上限と名前の取り違えを止める常設ゲート (BE6・2026-09-25)。
// ════════════════════════════════════════════════════════════════════════════
// 背景 (改修前 HEAD dd3677f の本番の入口で実測・internal 決定ログ「BE6 着手前」):
//   ④ 名前・説明・ファイル全体の大きさに上限が無かった。名前 20 万字・説明 500 万字の投稿コースが検査を通って
//      一覧に載り、選ぶと 1.9 秒かかった (区切りの無い説明文は 300 字でもページを横へ 1,199px はみ出させた＝CSS 側)。
//   ⑤ 名前で引く場所が名前を同一性として扱っていた: 保存名がプリセット名と同じだとプリセットの項目で保存コースが
//      開き、名前がプリセット名の投稿コースから公式開催すると event.json の course が名前だけになって
//      再検証はプリセットを走らせ、name が同じ投稿 2 本は黙って先頭が選ばれた。
//   ⑥ エディタで枠を縮めて壁が枠の外に残っても、寸法変更・✔適用・保存は黙って通った (壁は残って当たる・
//      枠の外は描かれない・投稿すると他人の一覧から除外される)。
//
// 検査:
//   A) 上限の導出と損失 0: COURSE_LIMITS の nameMax/descMax/jsonMax が「出荷 66 本の実測最大の 2 倍」以上で、
//      jsonMax が壁本数の上限 maxWalls を実質的に下げない (出荷の壁 1 本あたり最大の文字数 × maxWalls × 2 以上)。
//      出荷 66 本 × 3 形 (buildFromSpec の出力・normalizeCourse・エディタの書き出し形) が std/own とも合格。
//      上流の投稿 2 本は 2026-09-25 の実測値 (下の UPSTREAM) が上限の内側であることを数で示す (ネットワークに依らない)。
//   B) 境目: 各上限ちょうどは std 合格・1 超えると std は `<項目>:size` で拒否・own は合格 (own ⊇ std を崩さない)。
//      maxWalls 本の正規の壁 (有効桁いっぱいの座標) は jsonMax に掛からない。
//   C) 枠の外の壁の数え方 (wallsOutsideFrame) が投稿基準と一致: own が通る (＝形が正しい) 入力で、
//      「本数 > 0 ⇔ std が walls[i].x1〜y2 を理由に拒否する」。枠を 1×1 m へ縮めた出荷 66 本は全部 > 0、元の 66 本は全部 0。
//   D) main.js の配線 (ソースで固定): 枠外の告知 4 経路 (寸法変更・✔適用・保存・JSON 取込)・保存コースの option value の
//      衝突回避・🗑 は保存名で消す・保存名の trim・名前で引く 2 か所が同じ「ちょうど 1 件」規則・公式開催は
//      officialCourseRef の参照だけを書き、別コースに当たるなら書き出さない・lap.js は名前空間 import・CSS の折り返し。
//   E) 変異試験: course.js の上限・std/own の分かれ目・数え方と、D) の配線を 1 つずつ壊すと必ず赤。
//      product は読むだけ (変異はメモリ上＝ゲート実行中にソースを触らない・BD-1 ②)。
// 本番 UI での確認 (選ぶ・開催する・縮める・投稿コースを読む) は browser/check_be6_names.mjs。
//
// 使い方: node wf_be6_intake.mjs      依存: node のみ (node_modules 不要)。
// ════════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import { buildFromSpec, normalizeCourse, checkCourseData, checkOwnCourseData, wallsOutsideFrame } from './public/js/course.js';
import { SHAPES, SYNTAX_ONLY } from './wf_course_corpus.mjs';

let bad = 0;
const section = (title, fails) => {
  console.log(`\n${title}`);
  for (const f of fails) console.log('       - ' + f);
  console.log(`  ${fails.length ? '✗' : '○'} 崩れた箇所: ${fails.length} 件`);
  bad += fails.length;
};

const COURSE_SRC = fs.readFileSync('./public/js/course.js', 'utf8');
const MAIN_SRC = fs.readFileSync('./public/js/main.js', 'utf8');
const CSS_SRC = fs.readFileSync('./public/css/style.css', 'utf8');
const limSrc = /const COURSE_LIMITS = (\{[^}]*\});/.exec(COURSE_SRC);
const LIM = limSrc ? Function(`return ${limSrc[1]};`)() : null;
const specs = JSON.parse(fs.readFileSync('./public/data/courses.json', 'utf8'));
const shipped = specs.map((s) => buildFromSpec(s));
const exportForm = (c) => { const e = normalizeCourse(JSON.parse(JSON.stringify(c))); return { name: e.name, bounds: e.bounds, start: e.start, finish: e.finish, walls: e.walls }; };
// 上流の投稿 (RumiCar-group/RumiCar courses/community/・2026-09-25 に gh api と raw で取得して実測)。
const UPSTREAM = [
  { file: 'example-community-course.json', bytes: 134300, name: 18, desc: 38, name_en: 0, desc_en: 0, walls: 960 },
  { file: 'racing-course.json', bytes: 36000, name: 8, desc: 0, name_en: 13, desc_en: 0, walls: 366 },
];

// ── 検査本体 (product の関数を引数で受ける＝E) の変異版にも同じ検査を当てる) ─────────────────
function runA(f) {
  const v = [];
  if (!LIM) { v.push('course.js の COURSE_LIMITS を読めない'); return { v }; }
  const mx = { name: 0, name_en: 0, desc: 0, desc_en: 0, perWall: 0 };
  for (const c of shipped) {
    for (const k of ['name', 'name_en', 'desc', 'desc_en']) if (typeof c[k] === 'string') mx[k] = Math.max(mx[k], c[k].length);
    if (c.walls.length) mx.perWall = Math.max(mx.perWall, Math.ceil(JSON.stringify(c.walls).length / c.walls.length));
  }
  const nMax = Math.max(mx.name, mx.name_en), dMax = Math.max(mx.desc, mx.desc_en);
  // main.js rebuildCourseList の保存コースの値 (★＋保存名) が出荷コースの値と重ならない前提。
  const star = shipped.filter((c) => c.name.startsWith('★')).map((c) => c.name);
  if (star.length) v.push(`★ で始まる出荷コース名がある (${star.join(', ')})＝保存コースの逃がし先と衝突しうる`);
  if (!(LIM.nameMax >= 2 * nMax)) v.push(`nameMax ${LIM.nameMax} < 出荷最大 ${nMax} の 2 倍`);
  if (!(LIM.descMax >= 2 * dMax)) v.push(`descMax ${LIM.descMax} < 出荷最大 ${dMax} の 2 倍`);
  if (!(LIM.jsonMax >= 2 * mx.perWall * LIM.maxWalls)) v.push(`jsonMax ${LIM.jsonMax} が壁本数の上限を下げる (1 本あたり ${mx.perWall} 字 × ${LIM.maxWalls} × 2)`);
  for (const u of UPSTREAM) {
    if (Math.max(u.name, u.name_en) > LIM.nameMax || Math.max(u.desc, u.desc_en) > LIM.descMax || u.bytes > LIM.jsonMax || u.walls > LIM.maxWalls)
      v.push(`上流の投稿 ${u.file} (実測) が上限の外`);
  }
  let pass = 0;
  for (const c of shipped) {
    for (const d of [c, normalizeCourse(JSON.parse(JSON.stringify(c))), exportForm(c)]) {
      const s = f.std(d), o = f.own(d);
      if (s || o) v.push(`出荷『${c.name}』が落ちた (std=${s} own=${o})`); else pass++;
    }
  }
  return { v, mx, pass };
}

function baseCourse() {
  const walls = [];
  for (let i = 0; i < 24; i++) {
    const a = 2 * Math.PI * i / 24, b = 2 * Math.PI * (i + 1) / 24;
    walls.push({ x1: 1.5 + 1.2 * Math.cos(a), y1: 1 + 0.8 * Math.sin(a), x2: 1.5 + 1.2 * Math.cos(b), y2: 1 + 0.8 * Math.sin(b) });
  }
  return { name: 'BE6 基準形', bounds: { w: 3, h: 2 }, start: { x: 1.5, y: 0.3, theta: 0 }, walls };
}
function runB(f) {
  const v = [];
  const exp = (label, d, std, own) => {
    const s = f.std(d), o = f.own(d);
    if (s !== std) v.push(`${label}: std=${s} (期待 ${std})`);
    if (o !== own) v.push(`${label}: own=${o} (期待 ${own})`);
    if (s === null && o !== null) v.push(`${label}: std が通すのに own が落とす (own ⊇ std が崩れた)`);
  };
  for (const k of ['name', 'name_en']) {
    exp(`${k} ${LIM.nameMax} 字`, { ...baseCourse(), [k]: 'n'.repeat(LIM.nameMax) }, null, null);
    exp(`${k} ${LIM.nameMax + 1} 字`, { ...baseCourse(), [k]: 'n'.repeat(LIM.nameMax + 1) }, `${k}:size`, null);
  }
  for (const k of ['desc', 'desc_en']) {
    exp(`${k} ${LIM.descMax} 字`, { ...baseCourse(), [k]: 'd'.repeat(LIM.descMax) }, null, null);
    exp(`${k} ${LIM.descMax + 1} 字`, { ...baseCourse(), [k]: 'd'.repeat(LIM.descMax + 1) }, `${k}:size`, null);
  }
  // 全体の大きさ: 知らない項目 junk で詰めた JSON の文字数をちょうど jsonMax / +1 にする。
  const b = baseCourse(); b.junk = '';
  const pad = LIM.jsonMax - JSON.stringify(b).length;
  exp(`詰めた JSON ${LIM.jsonMax} 字`, { ...b, junk: 'j'.repeat(pad) }, null, null);
  exp(`詰めた JSON ${LIM.jsonMax + 1} 字`, { ...b, junk: 'j'.repeat(pad + 1) }, '$:size', null);
  // maxWalls 本の正規の壁 (座標は有効桁いっぱい・短い壁＝セル数は上限の内側) は jsonMax に掛からない。
  const many = { name: 'BE6 壁 maxWalls 本', bounds: { w: 999.999, h: 999.999 }, start: { x: 1, y: 1, theta: 0 }, walls: [] };
  for (let i = 0; i < LIM.maxWalls; i++) {
    const x = 1.0000000000000002 + (i % 140) * 7.123456789012345, y = 1.0000000000000002 + Math.floor(i / 140) * 6.987654321098765;
    many.walls.push({ x1: x, y1: y, x2: x + 0.012345678901234567, y2: y + 0.012345678901234567 });
  }
  const s = f.std(many);
  if (s !== null) v.push(`maxWalls 本の正規の壁 (${JSON.stringify(many).length} 字) が std で落ちた (${s})＝jsonMax が壁本数の上限を下げている`);
  return { v, manyChars: JSON.stringify(many).length };
}

function runC(f) {
  const v = [];
  let domain = 0, outs = 0;
  const judge = (label, d) => {
    if (f.own(d) !== null) return;   // 形が正しいもの (own が通る) だけが対象
    const why = f.std(d);
    if (why !== null && !/^(walls\[\d+\]\.[xy][12]|start\.[xy]|finish\.[xy][12])$/.test(why)) return;   // 大きさの理由で先に落ちたものは外す
    domain++;
    const n = f.wof(d);
    if (n > 0) outs++;
    const wallWhy = why !== null && why.startsWith('walls[');
    if ((n > 0) !== wallWhy) v.push(`${label}: 枠外の壁 ${n} 本だが std の理由は ${why}`);
  };
  for (const s of SHAPES) if (!SYNTAX_ONLY.includes(s[0])) judge(s[0], JSON.parse(s[1]));
  // 端点 4 つのどれか 1 つだけが窓の外に出た壁 (x1 だけ見る等の手抜きを突く)・bounds の無い形 (既定 3×2 の窓)。
  const inner = { x1: 1, y1: 0.5, x2: 2, y2: 1.5 };
  for (const [k, out] of [['x1', -0.5], ['y1', 2.6], ['x2', 3.6], ['y2', -0.4]]) {
    judge(`端点 ${k} だけが窓の外`, { ...baseCourse(), walls: [...baseCourse().walls, { ...inner, [k]: out }] });
    judge(`端点 ${k} だけが窓の内側ぎりぎり`, { ...baseCourse(), walls: [...baseCourse().walls, { ...inner, [k]: k[0] === 'x' ? (out < 0 ? -0.149 : 3.149) : (out < 0 ? -0.149 : 2.149) }] });
  }
  const noB = baseCourse(); delete noB.bounds;
  judge('bounds が無い (既定 3×2)・壁が x=3.5', { ...noB, walls: [...noB.walls, { x1: 3.5, y1: 1, x2: 3.5, y2: 1.5 }] });
  judge('bounds が無い (既定 3×2)・壁が x=3.1', { ...noB, walls: [...noB.walls, { x1: 3.1, y1: 1, x2: 3.1, y2: 1.5 }] });
  let shrunkOut = 0, shipZero = 0;
  for (const c of shipped) {
    const e = exportForm(c);
    judge(`出荷『${c.name}』`, e);
    if (f.wof(e) === 0) shipZero++;
    const sh = { ...e, bounds: { w: 1, h: 1 } };
    judge(`出荷『${c.name}』を 1×1 m へ縮めた形`, sh);
    if (f.wof(sh) > 0) shrunkOut++;
  }
  if (shipZero !== shipped.length) v.push(`出荷コースで枠外の壁を数えたものが ${shipped.length - shipZero} 本ある`);
  if (shrunkOut !== shipped.length) v.push(`1×1 m へ縮めた出荷コースで枠外の壁を数えなかったものが ${shipped.length - shrunkOut} 本ある`);
  // 母集団ガード: 数えた側・数えなかった側の両方が居ること (片側だけなら ⇔ の検査が空振りする)。
  if (!(outs > 0 && outs < domain)) v.push(`母集団が片寄っている (対象 ${domain}・枠外あり ${outs})`);
  if (f.wof(null) !== 0 || f.wof({ walls: {} }) !== 0 || f.wof({ walls: [null] }) !== 0) v.push('壊れた入力で 0 を返さない (例外・誤計数)');
  return { v, domain, outs, shrunkOut, shipZero };
}

// ── D) 配線 ───────────────────────────────────────────────────────────────────
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => (/:\/\//.test(l) ? l : l.replace(/\/\/.*$/, ''))).join('\n');
function slice(src, from, to) {
  const i = src.indexOf(from);
  if (i < 0) return null;
  const j = src.indexOf(to, i);
  return j < 0 ? src.slice(i) : src.slice(i, j + to.length);
}
const WIRING = [
  { id: '⑥ 寸法変更 (applyEditDims)', from: 'function applyEditDims() {', to: '\n}\n',
    must: [[/logLine\(t\('log\.edDims'[^\n]*\n\s*noteWallsOutside\(editor\.toJSON\(\)\);/, '縮めた直後に枠外の壁を知らせていない']] },
  { id: '⑥ ✔適用 (applyEdit)', from: 'function applyEdit() {', to: '\n}\n',
    must: [[/noteWallsOutside\(c\);/, '✔適用で枠外の壁を知らせていない'],
           [/currentCourseKey = savedKeyOf\(c\.name\) \|\| \(courseSources\[c\.name\] \? c\.name : ''\);/, '✔適用後の走行中コースの値が、同名の保存コースでなくプリセットを指す']] },
  { id: '⑤⑥ 保存 (edSave)', from: "$('edSave').addEventListener", to: '\n});',
    must: [[/noteWallsOutside\(editor\.toJSON\(\)\);/, '保存で枠外の壁を知らせていない'],
           [/const name = \(\$\('edName'\)\.value\.trim\(\) \|\| t\('ed\.name\.default'\)\);/, '空白だけの名前が既定名へ落ちない (trim が既定名の後)'],
           [/rebuildCourseList\(\);\s*const savedKey = savedKeyOf\(name\);\s*if \(savedKey != null\) \{ \$\('courseSel'\)\.value = savedKey; courseSelValue = savedKey; \}/,
            '一覧を作り直してから保存コースの値を引いていない (初めて保存した逃がし対象の名前で別の項目を選び、🗑 で別の保存コースが消える)']] },
  { id: '⑥ JSON 取込 (edImport)', from: "$('edImport').addEventListener", to: '\n});',
    must: [[/noteWallsOutside\(editor\.toJSON\(\)\);/, 'JSON 取込で枠外の壁を知らせていない']] },
  { id: '⑤ 投稿 (edShare)', from: "$('edShare').addEventListener", to: '\n});',
    must: [[/json\.name = \(\$\('edName'\)\.value\.trim\(\) \|\|/, '投稿の名前で空白だけを既定名へ落としていない']] },
  { id: '⑥ 告知の本体 (noteWallsOutside)', from: 'function noteWallsOutside(data) {', to: '\n}\n',
    must: [[/const f = courseParts\.wallsOutsideFrame;/, 'course.js の数え方を名前空間で受けていない (写し or 名前付き import)'],
           [/typeof f === 'function' \? f\(data\) : 0/, '古い course.js へのフォールバックが無い'],
           [/if \(n > 0 && hasKey\('log\.edWallsOutside'\)\) logLine\(t\('log\.edWallsOutside', \{ n \}\)\);/, '本数を知らせていない (または hasKey ガードが無い)']] },
  { id: '⑤ 一覧の再構築 (rebuildCourseList)', from: 'function rebuildCourseList(selectName) {', to: '\n}\n',
    must: [[/const key = \(courseSources\[n\] \|\| n\.startsWith\('gh:'\) \|\| n\.startsWith\('★'\)\) \? '★' \+ n : n;/, '保存名だけで決まる逃がし方 (プリセット名・gh:・★ で始まる名前に ★ を 1 つ) になっていない (保存順で値が入れ替わる)'],
           [/courseSources\[key\] = \{ type: 'saved', data: saved\[n\], savedName: n \};/, '保存名を savedName に持っていない'],
           [/addOpt\(sel, '★ ' \+ n, key\);/, 'option value に逃がした値を使っていない']] },
  { id: '⑤ 🗑 削除 (edDelete)', from: "$('edDelete').addEventListener", to: '\n});',
    must: [[/const n = src && src\.type === 'saved' \? src\.savedName : null;/, 'option value を保存名として消している (同名のプリセットを選んで 🗑 で保存コースが消える)']] },
  { id: '⑤ 名前で引く規則 (communityByRef)', from: 'function communityByRef(ref) {', to: '\n}\n',
    must: [[/return \{ cc: hits\.length === 1 \? hits\[0\] : null, n: hits\.length \};/, '複数に当たっても 1 件を選んでいる']] },
  { id: '⑤ 公式レースのコース解決 (resolveRaceCourse)', from: 'function resolveRaceCourse(courseRef, opts) {', to: '\n}\n',
    must: [[/const \{ cc, n \} = communityByRef\(courseRef\);/, 'communityByRef を経ていない'],
           [/if \(n > 1 && !quiet && hasKey\('log\.courseAmbiguous'\)\)/, '決められないことを知らせていない']] },
  { id: '⑤ 共有 URL の解決 (resolveCourseKey)', from: 'function resolveCourseKey(ref) {', to: '\n}\n',
    must: [[/const \{ cc \} = communityByRef\(ref\);/, 'communityByRef を経ていない (resolveRaceCourse と規則が割れる)']] },
  { id: '⑤ 公式開催の参照 (officialCourseRef)', from: 'function officialCourseRef(c) {', to: '\n}\n',
    must: [[/if \(id\(rc\) === mine\) return \{ ref: r, clash: null \};/, '同じ形に当たる参照だけを選んでいない'],
           [/if \(!rc\) \{ if \(clash == null && communityByRef\(r\)\.n > 1\) clash = r; continue; \}/, '複数に当たって決められない参照を「引けない」と同じに扱っている (黙って名前を書き出す)'],
           [/if \(clash != null\) return \{ ref: null, clash \};/, '別コースに当たるときに止めない'],
           [/if \(communityListState !== 'ok'\) return \{ ref: null, clash: null, unknown: true \};\s*return \{ ref: c\.name, clash: null \};/, '投稿コースの一覧を読めていないのに名前を書く / 読めているとき従来の名前へ戻さない'],
           [/for \(const cc of communityCourses\) if \(cc\.data && cc\.data\.name === c\.name && !cands\.includes\(cc\.name\)\) cands\.push\(cc\.name\);/, '同名の投稿コースのファイル名を候補にしていない (✔適用した投稿コースが同じ形でも止まる)'],
           [/cands\.push\(currentCourseKey\.slice\(3\)\)/, '投稿コースのファイル名を候補にしていない']] },
  { id: '⑤ 投稿コース一覧の読込状態 (loadCommunityCourses)', from: 'async function loadCommunityCourses() {', to: '\n}\n',
    must: [[/if \(list === null\) \{ communityListState = 'failed';/, '取得失敗を記録していない'],
           [/if \(err instanceof SyntaxError\) bad\.push\(\{ e, why: 'JSON' \}\); else missed\+\+;/, '本体の取得失敗を数えていない'],
           [/communityCourses = loaded;[\s\S]*?communityListState = missed \? 'partial' : 'ok';/, '本体に欠けがあっても「読めた」にしている']] },
  { id: '⑤ 公式開催 (hostOfficialEvent)', from: 'function hostOfficialEvent() {', to: '\n}\n',
    must: [[/const cref = officialCourseRef\(course\);\s*if \(cref\.ref == null\) \{[\s\S]*?return;\s*\}/, '別コースに当たる参照でも書き出している'],
           [/course: cref\.ref,/, 'event.json の course に名前をそのまま書いている']] },
];
function runD(mainSrc, cssSrc) {
  const v = [];
  const m = strip(mainSrc);
  for (const w of WIRING) {
    const body = slice(m, w.from, w.to);
    if (!body) { v.push(`${w.id}: 目印「${w.from}」が main.js に無い`); continue; }
    for (const [re, why] of w.must) if (!re.test(body)) v.push(`${w.id}: ${why}`);
  }
  if (/communityCourses\.find\(/.test(m)) v.push('投稿コースを名前で find する経路が残っている (communityByRef を経ない)');
  if (!/^import \* as lapParts from '\.\/lap\.js';$/m.test(m)) v.push('lap.js を名前空間で受けていない');
  if (/import \{[^}]*practiceCourseId[^}]*\} from '\.\/lap\.js'/.test(m)) v.push('practiceCourseId を名前付き import している (古い lap.js のキャッシュで全体が落ちる・BA1)');
  if (/import \{[^}]*wallsOutsideFrame[^}]*\} from '\.\/course\.js'/.test(m)) v.push('wallsOutsideFrame を名前付き import している (BA1)');
  const cd = /\.course-desc \{[^}]*\}/.exec(cssSrc);
  if (!cd || !/overflow-wrap: anywhere;/.test(cd[0])) v.push('.course-desc が折り返さない (区切りの無い説明文で横にはみ出す)');
  return v;
}

// ── E) 変異 ───────────────────────────────────────────────────────────────────
function extractCourse(src) {
  const lim = src.indexOf('const COURSE_LIMITS = {'); if (lim < 0) return null;
  const i = src.indexOf('function checkCourse(data, own) {', lim); if (i < 0) return null;
  const j = src.indexOf('\n}\n', i); if (j < 0) return null;
  const w = src.indexOf('export function wallsOutsideFrame(data) {'); if (w < 0) return null;
  const k = src.indexOf('\n}\n', w); if (k < 0) return null;
  return (src.slice(lim, j + 2) + '\n' + src.slice(w, k + 2)).replace(/^export /gm, '');
}
const compile = (s) => new Function(`${s}\nreturn { std: checkCourseData, own: checkOwnCourseData, wof: wallsOutsideFrame };`)();
const REAL = { std: checkCourseData, own: checkOwnCourseData, wof: wallsOutsideFrame };
const allFails = (f) => runA(f).v.length + runB(f).v.length + runC(f).v.length;

const a = runA(REAL);
section(`A) 上限の導出と損失 0 (出荷最大 name ${Math.max(a.mx?.name || 0, a.mx?.name_en || 0)}・desc ${Math.max(a.mx?.desc || 0, a.mx?.desc_en || 0)}・壁 1 本あたり ${a.mx?.perWall} 字 → 上限 ${LIM?.nameMax}/${LIM?.descMax}/${LIM?.jsonMax}・出荷 ${shipped.length} 本 × 3 形 × 2 基準の合格 ${a.pass})`, a.v);
const b = runB(REAL);
section(`B) 境目 (各上限ちょうど/+1 × std/own・maxWalls 本の正規の壁 ${b.manyChars} 字)`, b.v);
const c = runC(REAL);
section(`C) 枠の外の壁の数え方 ⇔ 投稿基準 (対象 ${c.domain}・枠外あり ${c.outs}・縮めた出荷 ${c.shrunkOut}/${shipped.length}・元の出荷で 0 本 ${c.shipZero}/${shipped.length})`, c.v);
const d = runD(MAIN_SRC, CSS_SRC);
section(`D) main.js の配線 (${WIRING.length} 項目＋import・CSS)`, d);

const ev = [];
const ORIG = extractCourse(COURSE_SRC);
if (!ORIG) ev.push('course.js から検査と数え方を切り出せない');
else {
  if (allFails(compile(ORIG))) ev.push('切り出した写しが product と違う答えを出す (変異の土台が壊れている)');
  const CM = [
    ['名前の上限を 10 倍にする', s => s.replace('nameMax: 120,', 'nameMax: 1200,')],
    ['説明の上限を 10 倍にする', s => s.replace('descMax: 3300,', 'descMax: 33000,')],
    ['全体の大きさの上限を 10 倍にする', s => s.replace('jsonMax: 4000000 }', 'jsonMax: 40000000 }')],
    ['全体の大きさの上限を壁本数を削る値にする', s => s.replace('jsonMax: 4000000 }', 'jsonMax: 400000 }')],
    ['own にも上限を当てる (長い名前の保存コースが開けなくなる)', s => s.replace('  if (!own) {   // BE6', '  if (true) {   // BE6')],
    ['std から上限を外す', s => s.replace('  if (!own) {   // BE6', '  if (false) {   // BE6')],
    ['name_en を見ない', s => s.replace("for (const k of ['name', 'name_en']) if (!absent(data[k]) && data[k].length > L.nameMax)", "for (const k of ['name']) if (!absent(data[k]) && data[k].length > L.nameMax)")],
    ['desc_en を見ない', s => s.replace("for (const k of ['desc', 'desc_en']) if (!absent(data[k]) && data[k].length > L.descMax)", "for (const k of ['desc']) if (!absent(data[k]) && data[k].length > L.descMax)")],
    ['全体の大きさを見ない', s => s.replace("if (!(n <= L.jsonMax)) return '$:size';", '')],
    ['枠外の数え方に own の窓を使う', s => s.replace('frameWindow(bw, bh, false);\n  let n = 0;', 'frameWindow(bw, bh, true);\n  let n = 0;')],
    ['枠外の数え方で x1 しか見ない', s => s.replace('if (outX(w.x1) || outY(w.y1) || outX(w.x2) || outY(w.y2)) n++;', 'if (outX(w.x1)) n++;')],
    ['枠外の数え方で bounds が無いときの既定を変える', s => s.replace("(b && typeof b.w === 'number') ? b.w : 3.0", "(b && typeof b.w === 'number') ? b.w : 30")],
  ];
  for (const [label, fn] of CM) {
    const m = fn(ORIG);
    if (m === ORIG) { ev.push(`変異「${label}」が当たらない (product の形が変わった＝変異を直すこと)`); continue; }
    let f; try { f = compile(m); } catch (e) { ev.push(`変異「${label}」が構文エラー: ${e.message}`); continue; }
    if (!allFails(f)) ev.push(`変異「${label}」を A)〜C) が捕まえない`);
  }
}
const MM = [
  ['寸法変更で告知しない', s => s.replace("  noteWallsOutside(editor.toJSON());   // BE6 (⑥): 縮めた瞬間", "  // (変異) 縮めた瞬間")],
  ['✔適用で告知しない', s => s.replace('  noteWallsOutside(c);   // BE6 (⑥)', '  // (変異)')],
  ['保存で告知しない', s => s.replace("  logLine(t('log.courseSaved', { name }));\n  noteWallsOutside(editor.toJSON());", "  logLine(t('log.courseSaved', { name }));")],
  ['JSON 取込で告知しない', s => s.replace('    noteWallsOutside(editor.toJSON());   // BE6 (⑥): own で通した', '    // (変異) own で通した')],
  ['告知の hasKey ガードを外す', s => s.replace("if (n > 0 && hasKey('log.edWallsOutside')) logLine", 'if (n > 0) logLine')],
  ['保存名の衝突を逃がさない', s => s.replace("const key = (courseSources[n] || n.startsWith('gh:') || n.startsWith('★')) ? '★' + n : n;", 'const key = n;')],
  ['空くまで ★ を足す (保存順で値が入れ替わる・層 4 の指摘)', s => s.replace("const key = (courseSources[n] || n.startsWith('gh:') || n.startsWith('★')) ? '★' + n : n;", "let key = n; while (courseSources[key] || key.startsWith('gh:')) key = '★' + key;")],
  ['決められない参照を「引けない」と同じに扱う', s => s.replace('if (!rc) { if (clash == null && communityByRef(r).n > 1) clash = r; continue; }', 'if (!rc) continue;')],
  ['✔適用後の値をプリセットから引く (旧式)', s => s.replace("currentCourseKey = savedKeyOf(c.name) || (courseSources[c.name] ? c.name : '');", "currentCourseKey = courseSources[c.name] ? c.name : '';")],
  ['🗑 が option value で消す (旧式)', s => s.replace("const n = src && src.type === 'saved' ? src.savedName : null;", "const n = $('courseSel').value;")],
  ['保存後の選択を作り直す前に引く (層 4 の 2 回目)', s => s.replace("  rebuildCourseList();\n  const savedKey = savedKeyOf(name);\n  if (savedKey != null) { $('courseSel').value = savedKey; courseSelValue = savedKey; }", '  rebuildCourseList(savedKeyOf(name) || name);')],
  ['一覧を読めていなくても名前を書く', s => s.replace("  if (communityListState !== 'ok') return { ref: null, clash: null, unknown: true };\n", '')],
  ['同名の投稿コースを候補にしない', s => s.replace("  for (const cc of communityCourses) if (cc.data && cc.data.name === c.name && !cands.includes(cc.name)) cands.push(cc.name);\n", '')],
  ['本体に欠けがあっても ok にする (層 4 の 3 回目)', s => s.replace("communityListState = missed ? 'partial' : 'ok';", "communityListState = 'ok';")],
  ['取得失敗を記録しない', s => s.replace("if (list === null) { communityListState = 'failed';", 'if (list === null) {')],
  ['保存名の trim を既定名の後へ戻す', s => s.replace("const name = ($('edName').value.trim() || t('ed.name.default'));", "const name = ($('edName').value || t('ed.name.default')).trim();")],
  ['名前で引いて先頭を選ぶ (旧式)', s => s.replace('return { cc: hits.length === 1 ? hits[0] : null, n: hits.length };', 'return { cc: hits[0] || null, n: hits.length };')],
  ['resolveRaceCourse が find に戻る', s => s.replace('const { cc, n } = communityByRef(courseRef);', 'const n = 0, cc = communityCourses.find((c) => (c.data && c.data.name) === courseRef || c.name === courseRef);')],
  ['公式開催が名前をそのまま書く (旧式)', s => s.replace('course: cref.ref,', 'course: course.name,')],
  ['公式開催が別コースに当たっても止めない', s => s.replace(/  if \(cref\.ref == null\) \{[\s\S]*?\n    return;\n  \}\n/, '')],
  ['参照選びが形を比べない', s => s.replace('if (id(rc) === mine) return { ref: r, clash: null };', 'return { ref: r, clash: null };')],
  ['lap.js を名前付きで受ける', s => s.replace("import * as lapParts from './lap.js';", "import { practiceCourseId } from './lap.js';")],
];
let hitM = 0;
for (const [label, fn] of MM) {
  const m = fn(MAIN_SRC);
  if (m === MAIN_SRC) { ev.push(`変異「${label}」が当たらない (目印が変わった＝変異を直すこと)`); continue; }
  if (!runD(m, CSS_SRC).length) ev.push(`変異「${label}」を D) が捕まえない`); else hitM++;
}
{
  const m = CSS_SRC.replace(/  overflow-wrap: anywhere;\n\}\n\.course-desc:empty/, '}\n.course-desc:empty');
  if (m === CSS_SRC) ev.push('変異「説明を折り返さない」が当たらない');
  else if (!runD(MAIN_SRC, m).length) ev.push('変異「説明を折り返さない」を D) が捕まえない');
}
section(`E) 変異試験 (course.js ${12} 件・main.js ${MM.length} 件・CSS 1 件)`, ev);

console.log(bad ? '\nFAIL — wf_be6_intake' : '\nPASS — wf_be6_intake');
process.exit(bad ? 1 : 0);
