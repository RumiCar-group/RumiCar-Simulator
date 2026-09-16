// BC1 常設ゲート — 配信ヘッダが「毎回再検証」を指示していることを実サーバから測る。
//
// なぜ要るのか:
//   public/ の 49 ファイル（js 46・css 1・html 1・json 1）のうち、版番付きで読まれるのは
//   style.css だけ（index.html が `css/style.css?v=…` で読む）。残りはファイル名に版を持たない。
//   Cache-Control が落ちるとブラウザはヒューリスティック鮮度（Date − Last-Modified の約 10%）に
//   戻り、長く変わっていないモジュールほど古い版が長く残る。ES モジュールは名前付き import で
//   互いを参照するので、新しい側が「改修前に無かった名前」を import した瞬間に
//   does not provide an export named でアプリ全体が起動しなくなる（BA1 で実測）。
//   配信設定は nginx イメージ側にあり public/ の編集では変わらないため、
//   「いつの間にか外れていた」を捕まえる口がここしか無い。
//
// 測る述語（代理量でなく、実際に配られているヘッダそのもの）:
//   A) 200 応答の Cache-Control が鮮度を持たないこと（引数なしの no-cache、または max-age=0）。
//   B) 再検証の材料（ETag もしくは Last-Modified）があること。
//      A だけでは不十分で、B が無いと毎回**本体ごと**取り直すことになる。
//   C) 条件付き要求が 304 になり、その 304 にも Cache-Control が乗ること。
//      ここが抜けると、一度再検証した後のエントリが鮮度情報を失いヒューリスティックへ戻りうる。
//      （注: nginx の add_header は 304 を既定の対象に含むので `always` 無しでも 304 には乗る。
//        隔離コンテナで実測済み。`always` が効くのは 404 等のいわゆる safe status 以外。）
//
// なぜ browser/ に置くか: **実際に配信しているサーバが要る**検査だから。`wf_*.mjs` は
//   「node_modules もサーバも要らない」がフレッシュクローン検証の前提（lib.mjs:13-16）なので
//   そちらには載せられない。ただし本ゲート自身はブラウザを使わないので playwright に依存させず、
//   `node browser/check_bc1_cache.mjs` 単体でも走る（run_all.sh からは run.sh 経由で回る）。
//
// 対象 URL は RC_URL（run.sh が既定で配信コンテナを直に引く）。エッジ（webstack-nginx）が
// 途中で書き換えていないかは既定では測れないので、必要なら明示して撃つ:
//   RC_URL=https://www.rumicar.com/simulator/ bash run.sh check_bc1_cache.mjs
// （エッジ側 `location ^~ /simulator/` の `^~` が消えると WP 用の `expires max` に捕まる。
//   その設定は本リポジトリの外にあるため、ここからは押さえられない＝既知の限界。）

const APP_URL = process.env.RC_URL || 'https://www.rumicar.com/simulator/';
const base = APP_URL.endsWith('/') ? APP_URL : APP_URL + '/';

// html / css / js / json の 4 種に加え、**gzip されない小さい js** を 1 本入れる。
// gzip 応答は ETag が weak（W/"…"）になるため、それだけだと strong ETag の経路を一度も通らない。
// js/state.js は 1KB 未満（gzip_min_length 1024 の下）なので identity で配られる。
const TARGETS = ['', 'css/style.css', 'js/main.js', 'js/state.js', 'data/courses.json'];

let fail = 0;
const ok = (label, cond, detail = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!cond) fail++;
  return cond;
};

/**
 * 「鮮度を持たない＝毎回再検証される」指示か。
 * 通すのは **引数なしの no-cache** と **max-age=0** だけ。意図的に狭くしてある:
 *  ・`no-cache="Set-Cookie"` のフィールド限定形は列挙したヘッダにしか効かず、本体の鮮度は
 *    max-age が決める（RFC 9111 §5.2.2.4）。`\bno-cache\b` で拾うと
 *    `no-cache="Set-Cookie", max-age=31536000` が緑になり、1 年の鮮度を持つ応答を見逃す。
 *  ・`no-store` も古い版は残らないが、**毎回 49 本を本体ごと取り直す**別の方針であり、
 *    このゲートが固定したい方針（304 で終わる再検証）ではない。緑にしない。
 *  ・正の max-age が併記されていたら、他に何が書かれていても赤にする（多層防御）。
 */
function revalidatesEveryTime(cc) {
  if (!cc) return false;
  const v = cc.toLowerCase();
  const bareNoCache = /(^|,)\s*no-cache\s*(,|$)/.test(v);
  const m = v.match(/(^|,)\s*max-age\s*=\s*"?(\d+)"?/);
  const maxAge = m ? Number(m[2]) : null;
  if (maxAge !== null && maxAge > 0) return false;
  return bareNoCache || maxAge === 0;
}

console.log('対象:', base);
for (const path of TARGETS) {
  const url = new URL(path, base).href;
  const label = path || '(index)';
  const res = await fetch(url, { redirect: 'follow' });
  if (!ok(`${label}: 200 で配られている`, res.status === 200, `HTTP ${res.status}`)) continue;

  const cc = res.headers.get('cache-control');
  const etag = res.headers.get('etag');
  const lm = res.headers.get('last-modified');

  ok(`${label}: 毎回再検証させる Cache-Control`, revalidatesEveryTime(cc), `cache-control: ${cc ?? 'なし'}`);
  ok(`${label}: 再検証の材料がある`, Boolean(etag || lm),
     `etag=${etag ?? 'なし'} / last-modified=${lm ?? 'なし'}`);

  if (etag || lm) {
    const cond = await fetch(url, {
      headers: etag ? { 'If-None-Match': etag } : { 'If-Modified-Since': lm },
    });
    if (ok(`${label}: 条件付き要求が 304 になる`, cond.status === 304, `HTTP ${cond.status}`)) {
      ok(`${label}: その 304 にも Cache-Control が乗る`,
         revalidatesEveryTime(cond.headers.get('cache-control')),
         `cache-control: ${cond.headers.get('cache-control') ?? 'なし'}`);
    }
  }
}

console.log(fail === 0 ? '結果: PASS' : `結果: FAIL (${fail} 件)`);
process.exit(fail === 0 ? 0 : 1);
