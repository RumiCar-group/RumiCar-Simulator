// プログラム取込: GitHub URL 取得 / ファイルアップロード / 言語判定。
import { t } from './i18n.js';

export function langFromName(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.py')) return 'py';
  if (n.endsWith('.js')) return 'js';
  if (n.endsWith('.ino') || n.endsWith('.cpp') || n.endsWith('.c') || n.endsWith('.cc') || n.endsWith('.h')) return 'c';
  return null;
}

// 任意の GitHub URL → raw URL へ正規化
function toRaw(url) {
  // https://github.com/owner/repo/blob/branch/path -> raw.githubusercontent.com/owner/repo/branch/path
  let m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  if (/^https?:\/\/raw\.githubusercontent\.com\//.test(url)) return url;
  return url; // その他はそのまま fetch
}

// リポジトリ/ディレクトリ URL から最初のスケッチを探す (GitHub API)
async function resolveRepoUrl(url) {
  // https://github.com/owner/repo(/tree/branch/path)?
  const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)(?:\/(.+))?)?\/?$/);
  if (!m) return null;
  const [, owner, repo, branch, path] = m;
  const ref = branch ? `?ref=${branch}` : '';
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path || ''}${ref}`;
  const res = await fetch(api);
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const items = await res.json();
  const list = Array.isArray(items) ? items : [items];
  // スケッチファイルを優先探索
  const file = list.find(f => f.type === 'file' && langFromName(f.name));
  if (file) return { url: file.download_url, name: file.name };
  // サブディレクトリを1段だけ探索
  const dir = list.find(f => f.type === 'dir');
  if (dir) return resolveRepoUrl(`https://github.com/${owner}/${repo}/tree/${branch || 'HEAD'}/${dir.path}`);
  return null;
}

// 戻り値: { code, name, lang }
export async function fetchFromGithub(url) {
  url = url.trim();
  if (!url) throw new Error(t('loader.urlEmpty'));
  // ディレクトリ/リポジトリ URL ?
  if (/^https?:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(url) || /\/tree\//.test(url)) {
    const r = await resolveRepoUrl(url);
    if (!r) throw new Error(t('loader.noSketch'));
    const code = await (await fetch(r.url)).text();
    return { code, name: r.name, lang: langFromName(r.name) };
  }
  const raw = toRaw(url);
  const res = await fetch(raw);
  if (!res.ok) throw new Error(t('loader.fetchFail', { status: res.status }));
  const code = await res.text();
  const name = raw.split('/').pop();
  return { code, name, lang: langFromName(name) };
}

// ===== RumiCar サンプルリポジトリのファイラー (GitHub API でツリーを辿る) =====
// 公開リポジトリ RumiCar-group/RumiCar を既定とする。
export const SAMPLE_REPO = { owner: 'RumiCar-group', repo: 'RumiCar', branch: 'master' };

// 指定パスのディレクトリ内容を取得。entries は dir→file、名前順。loadable= 取込可能スケッチ。
export async function listRepoDir(path = '') {
  const { owner, repo, branch } = SAMPLE_REPO;
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=${branch}`;
  const res = await fetch(api);
  if (res.status === 403) throw new Error(t('loader.rateLimit'));
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const items = await res.json();
  const list = Array.isArray(items) ? items : [items];
  return list
    .map(f => ({
      name: f.name, type: f.type, path: f.path,
      download_url: f.download_url,
      loadable: f.type === 'file' && !!langFromName(f.name),
    }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : (a.type === 'dir' ? -1 : 1)));
}

// raw URL からコード取得。戻り値: { code, name, lang }
export async function fetchRawFile(downloadUrl, name) {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(t('loader.fetchFail', { status: res.status }));
  const code = await res.text();
  return { code, name, lang: langFromName(name) };
}

// ファイルアップロード (File オブジェクト)
export function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ code: String(r.result), name: file.name, lang: langFromName(file.name) });
    r.onerror = () => reject(new Error(t('loader.readFail')));
    r.readAsText(file);
  });
}

// ===== コミュニティコース (GitHub の courses/community/ で共有) =====
// 利用者がエディタで作ったコースを PR で投稿し、全利用者がメニューから選べるようにする。
// 読み取りは公開リポジトリなので認証不要 (一覧は index.json→GitHub API の順、本文は raw)。
export const COURSE_REPO = SAMPLE_REPO;          // 同じ RumiCar-group/RumiCar
const COMMUNITY_DIR = 'courses/community';

// ===== 一覧取得の共通処理 (v7.4.0 / 2026-09-04) ==========================
// 【背景 (実測)】未認証の GitHub API は **IP あたり 60 回/時**。一方このアプリは
// 起動のたびに一覧を 4 回 (races / courses / programs / cars) 叩いていたため、
// 同一 IP から 15 回開くと上限に達し、コミュニティ投稿が読めなくなっていた。
// 教室の会場 Wi-Fi のように 1 つの IP を 10 人で共有する使い方では現実的な問題。
// ETag による条件付き取得も試したが **304 でも 1 回消費する** ことを実測で確認
// (57→56→55)。したがって「問い合わせ自体を減らす」しかない。
//
// 【対策 3 段】
//  1. マニフェスト優先: 各ディレクトリの index.json を raw から読む。
//     raw.githubusercontent.com には API のレート制限が無い (応答に x-ratelimit
//     ヘッダが存在しないことを実測確認)。これが効けばファイル一覧の API 消費は 0 回。
//     **ディレクトリ一覧 (races/) には使えない**: マニフェストはファイル名しか並べられず、
//     置かれると「0 件・正常」に見えて大会一覧が無言で空になる。races は API のまま。
//  2. API へフォールバック: マニフェストが無いリポジトリ (古いクローン・フォーク)
//     でも従来どおり動く。互換性のために必ず残す。
//  3. ブラウザ側キャッシュ: 成功も「未作成 (404)」も localStorage に置き、
//     TTL の間は問い合わせない。リロードを繰り返す開発中の消費を 0 にする。
//     レート制限 (403) や通信失敗は **キャッシュしない** (復帰したら即座に拾う)。
// いずれもブラウザ内で完結する。サーバ側の仕組みは増やさない (README「このリポジトリは
// 単体で完結しています」を崩さないため)。
// 保持時間は「取得元がどれだけ貴重か」で変える。
//  ・マニフェスト(raw)は無制限なので短く保つ = 新しい投稿がすぐ見える
//  ・API は 60回/時 の希少資源なので長く保つ = 教室での枯渇を防ぐ
//  ・未作成(404)も API 枠を 1 回食うので、同じだけ覚える
// コミュニティ一覧 (courses/programs/cars) には「再読込」ボタンが無く起動時に 1 回読むだけなので、
// マニフェスト経路の短い TTL がそのまま鮮度の担保になる。
// races/ だけは事情が違う。「大会が始まった瞬間に 404 でなくなる」ディレクトリなので、
// 未作成を長く覚えると開催初日に見えない時間ができる。TTL_MISS を API と同じ 1 時間に留め、
// さらに公式レース/ランキング両方の「再読込」で clearListCache() して即座に取り直せるようにした。
const TTL_MANIFEST = 5 * 60 * 1000;        // マニフェスト由来: 5分
const TTL_API      = 60 * 60 * 1000;       // API 由来: 1時間
const TTL_MISS     = 60 * 60 * 1000;       // 未作成(404): 1時間 (races の開催開始を待たせすぎない)
const LIST_CACHE_NS = 'rcsim.ghlist.';     // localStorage のキー接頭辞

// マニフェストの entries に許すファイル名。ディレクトリ区切りと相対参照を弾き、
// index.json (マニフェスト自身) も一覧に出さない。entries はコミュニティ PR でも
// 書き換わりうるので、素性を確かめていない文字列を URL とパスに通さないための門。
const NAME_OK = (n) => typeof n === 'string' && /^[^/\\]+$/.test(n)
  && n !== '.' && n !== '..' && n !== 'index.json';

// raw の URL を組み立てる (download_url を API に頼らず自前で作るため)。
// dir は呼び出し側がエンコード済みの前提 (fetchRace が eventId を encodeURIComponent する)。
// ファイル名は投稿者が自由に付けられるので必ずここでエンコードする —
// 素のまま繋ぐと `a#b.json` が「a を取ってフラグメント #b.json」になり別物を取りに行く
// (従来は API が download_url をエンコード済みで返していた。自前生成でその保証が消えた)。
function rawUrl(path) {
  const { owner, repo, branch } = COURSE_REPO;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
}
function rawFileUrl(dir, name) { return rawUrl(`${dir}/${encodeURIComponent(name)}`); }

// 一覧項目を 1 つの形に揃える。マニフェスト経路と API 経路で同じ関数を通すことで、
// 「片方の経路にだけ除外が掛かっている」という取りこぼしを構造的に起こさせない。
// 後段が読むのは name/type/path/download_url の 4 つだけなので、API 応答の
// sha/size/_links 等は捨てる (localStorage の消費も経路間で揃う)。
function listItem(dir, name, dirs) {
  return {
    name, type: dirs ? 'dir' : 'file', path: `${dir}/${name}`,
    download_url: dirs ? null : rawFileUrl(dir, name),
  };
}

// キャッシュキーには取得元 (owner/repo/branch) と dirs 種別も入れる。
// dir だけだと、別 fork 向けビルドを同じオリジンに置いたときに中身が入れ替わる。
function cacheKey(dir, dirs) {
  const { owner, repo, branch } = COURSE_REPO;
  return `${owner}/${repo}@${branch}:${dirs ? 'd' : 'f'}:${dir}`;
}

function listCacheGet(key) {
  try {
    const s = localStorage.getItem(LIST_CACHE_NS + key);
    if (!s) return null;
    const o = JSON.parse(s);
    if (!o || typeof o.at !== 'number') return null;
    // 中身の形も見る。items が配列でなければ捨てる — 拡張機能や別版に汚された
    // localStorage で undefined を返すと、呼び出し側の「失敗は null」契約が破れて
    // 例外になり、しかも TTL の間ずっとそれが続く。
    if (!o.miss && !Array.isArray(o.items)) return null;
    const ttl = o.miss ? TTL_MISS : (o.src === 'manifest' ? TTL_MANIFEST : TTL_API);
    const age = Date.now() - o.at;
    if (age > ttl || age < 0) return null;     // age<0 = 端末の時計がずれている。信用しない
    return o;                                  // { at, src, items | miss:true }
  } catch (e) { return null; }                 // localStorage 不可 (プライベート等) は素通り
}

function listCacheSet(key, value) {
  try { localStorage.setItem(LIST_CACHE_NS + key, JSON.stringify({ at: Date.now(), ...value })); }
  catch (e) { /* 容量超過等は無視 = キャッシュ無しで動く */ }
}

/** 「再読込」操作用: 一覧キャッシュを捨てて次回に取り直させる。 */
export function clearListCache() {
  try {
    const del = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LIST_CACHE_NS)) del.push(k);
    }
    del.forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* 使えない環境では何もしない */ }
}

/**
 * ディレクトリ一覧を「キャッシュ → マニフェスト(raw) → GitHub API」の順で取得する。
 * 戻り値は API の contents と同じ形の配列 ({name,type,path,download_url})、
 * 取得失敗は null (呼び出し側の Q1/V4 契約 = 失敗 null / 0 件 [] を保つ)。
 *
 * @param {string} dir   'courses/community' 等のディレクトリパス
 * @param {boolean} dirs true ならディレクトリ一覧 (races 用)、false ならファイル一覧
 */
async function listDirCached(dir, dirs = false) {
  const key = cacheKey(dir, dirs);
  const cached = listCacheGet(key);
  if (cached) return cached.miss ? null : cached.items;

  // 1) マニフェスト (raw・レート制限なし)。無ければ 404 で素通りして API へ。
  //    dirs=true (races 一覧) では使わない。マニフェストはファイル名しか並べられず、
  //    生成器がディレクトリを列挙しないため、置かれると「0 件・正常」に見えて
  //    大会一覧が理由の表示なしに空になる。ディレクトリ一覧は API のままにする。
  if (!dirs) {
    try {
      const r = await fetch(rawUrl(`${dir}/index.json`), { cache: 'no-cache' });
      if (r.ok) {
        const j = await r.json();
        const names = Array.isArray(j) ? j : (Array.isArray(j && j.entries) ? j.entries : null);
        if (names) {
          const items = names
            .map((n) => (typeof n === 'string' ? n : (n && n.name)))
            .filter(NAME_OK)
            .map((n) => listItem(dir, n, false));
          listCacheSet(key, { items, src: 'manifest' });
          return items;
        }
      }
    } catch (e) { /* マニフェスト無し・通信失敗 → API を試す */ }
  }

  // 2) GitHub API (従来経路)。
  let res;
  try { res = await fetch(`https://api.github.com/repos/${COURSE_REPO.owner}/${COURSE_REPO.repo}`
    + `/contents/${dir}?ref=${COURSE_REPO.branch}`); } catch (e) { return null; }
  if (res.status === 404) { listCacheSet(key, { miss: true }); return null; }  // 未作成は覚える
  if (!res.ok) return null;                    // 403 (レート制限) 等は覚えない = 復帰後すぐ拾う
  let items;
  try { items = await res.json(); } catch (e) { return null; }
  // API 経路もマニフェスト経路と同じ門・同じ形に通す。ここを共通にしておかないと、
  // 上流にマニフェストを置いた途端 index.json が「投稿コース」として一覧に並ぶ
  // (API 経路にしか通らない旧版クライアントで実際に起きる)。
  const list = (Array.isArray(items) ? items : [])
    .filter((f) => f && NAME_OK(f.name) && (dirs ? f.type === 'dir' : f.type === 'file'))
    .map((f) => listItem(dir, f.name, dirs));
  listCacheSet(key, { items: list, src: 'api' });
  return list;
}

// 投稿コース一覧を取得。**取得失敗** (レート制限/オフライン/通信瞬断/JSON 異常) 時は `null` を、
// **正常取得** 時は配列 (0 件なら `[]`) を返す。呼び出し側が失敗と 0 件を区別して通知できるよう
// するため (Q1[B]・無言失敗で「コースが消えた」と誤解させない)。本体動作はどちらでも止めない。
export async function listCommunityCourses() {
  const list = await listDirCached(COMMUNITY_DIR);   // キャッシュ→マニフェスト→API
  if (list === null) return null;                    // 取得失敗 (Q1[B] 契約は不変)
  return list
    .filter(f => f.type === 'file' && /\.json$/i.test(f.name))
    .map(f => ({ name: f.name.replace(/\.json$/i, ''), path: f.path, download_url: f.download_url }));
}

// 投稿コースの JSON 本体を取得 (正規化フォーマット: name/bounds/start/finish/walls)。
export async function fetchCommunityCourse(downloadUrl) {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(t('loader.fetchFail', { status: res.status }));
  return res.json();
}

// ===== 投稿導線 (AZ1・2026-09-12) =================================================
// 【なぜ方式を変えたか — 実測】
// 以前は GitHub の「新規ファイル作成」画面の `?value=` に投稿物の全文を載せていた。
// ところが **github.com の受理上限は約 6,600 文字** (実測: 6,692→302 正常 / 7,092→500 /
// 8,092→接続断 / 9,092 以上→414)。利用者の実投稿コース (壁 366 本) は 5 桁に丸めた
// 提出ファイルでも 80,391 文字、編集器が持つ生の値では 250,233 文字で、**12〜38 倍の超過**。
// 超過時は 414 が返るか、送り終える前に接続を切られる (どちらになるかはタイミング次第)。
// 利用者からは **ボタンを押しても何も開かない** ように見える。2026-09-11 の実報告がこれ。
// 同梱プログラムでも 23 本中 18 本が超過していた (日本語コメントは URL 符号化で約 3 倍に膨らむ)。
// minify・座標 3 桁丸め・壁の配列化まで全部やっても 36,829 文字 = なお上限の 5.6 倍なので、
// **「URL に載せる」方式そのものが成立しない**。
//
// 【新方式】データを URL から外す。
//   ① 投稿物をファイルとして書き出す (ここは必ず成功させる — ②が塞がれても手元に残る)
//   ② GitHub の**アップロード画面**を開き、そのファイルを置いてもらう
// 遷移先 URL は投稿物の大きさに **一切依存しない** (下記 uploadPageUrl は本文を含まない)。
//
// ⚠ **未実測**: 「書込権限の無いログイン済み利用者に GitHub が fork 導線を出す」ことは
// `/upload/` では**確かめていない** (実測済みなのは「未ログインでも HTTP 200 を返す」ことだけ。
// 200 を返すことと fork 導線が出ることは別の事実)。旧 `/new/` では自動 fork が既知の挙動だった。
// **設計全体がこの 1 点に乗っている**ので、実アカウントで 1 回確認して記録すること。
// ---------------------------------------------------------------------------------
// slug 化。空なら時刻フォールバック (shareCarUrl/races と同型)。
// **長さを切る**: GitHub のパス構成要素は 255 byte が上限で、超えると投稿そのものが通らない。
// 投稿者は名前を自由に付けられる (300 文字の名前を実測で踏んだ) ので、ここで必ず抑える。
// 拡張子 (最長 '.json' = 5) を足しても余る 200 に切り、切り口にハイフンを残さない。
const SLUG_MAX = 200;
// **export する理由 (AZ4)**: `hostOfficialEvent` が独自の inline slug で大会 ID を作っており、
// そちらには 200 文字の上限が無かった。300 文字のコース名で「event.json の中身の id (300 文字)」と
// 「置くディレクトリ名 (200 文字)」が食い違う —— AZ4 が entry 側で潰した「id ≠ dir」の同族。
// 名付ける側と投稿先を組む側が **同じ 1 つの計算**を使うようにする。
export function slugify(s, fallbackPrefix) {
  let base = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (base.length > SLUG_MAX) base = base.slice(0, SLUG_MAX).replace(/-+$/, '');
  return base || (fallbackPrefix + '-' + Date.now());
}

/**
 * 投稿先ディレクトリの「ファイルをアップロード」画面の URL。
 * **投稿物を一切含まない**ので、壁が 8 本でも 10,000 本でも長さは変わらない。
 * (未ログインでも HTTP 200 を返すことを実測確認。`/new/` は 302→ログインへ飛ぶ)
 *
 * AZ4: **まだ存在しないディレクトリでも 200 で本物の「Upload files」画面が返る**ことを実測した
 * (`races/` は `/tree` が 404 なのに `/upload` は 200・title は既存ディレクトリと同一)。
 * これで公式レース (races/<大会>/entries) のように「投稿と同時に作られる」場所にも使える。
 *
 * dir は **投稿先の生パス** (符号化前) を渡す。ここで区切りごとに符号化するので、
 * 大会 ID のような**上流由来の素性不明な文字列**を呼び出し側で加工する必要が無い
 * — 逆に呼び出し側が符号化して渡すと二重符号化になるので渡さないこと。
 */
export function uploadPageUrl(dir) {
  const { owner, repo, branch } = COURSE_REPO;
  // dir を取り違えると `.../master/undefined` という実在しないページを開いてしまい、
  // 「開いたのに投稿できない」という AZ1 が潰したはずの失敗形に戻る。ここで止める。
  if (typeof dir !== 'string' || !dir) throw new Error('uploadPageUrl: dir が不正です');
  // 区切りごとに検査してから符号化する。races/<大会> の <大会> は上流のディレクトリ名
  // (投稿 PR で誰でも足せる) なので、`..` や空区切りを URL のパスへ通さない
  // — listDirCached の NAME_OK と同じ門を、URL を組む側にも置く (二重の防御)。
  const parts = dir.split('/');
  for (const p of parts) {
    if (!p || p === '.' || p === '..') throw new Error(`uploadPageUrl: dir の区切りが不正です (${JSON.stringify(dir)})`);
  }
  const path = parts.map(encodeURIComponent).join('/');
  return `https://github.com/${owner}/${repo}/upload/${branch}/${path}`;
}

/**
 * コースの投稿物を組み立てる。**URL は返さない**(返すと再び URL に載せる誘惑が生まれる)。
 * 戻り値 { dir, filename, text, mime } は UI 側が ①書き出し ②uploadPageUrl(dir) に使う。
 */
export function courseSubmission(json) {
  return {
    dir: COMMUNITY_DIR,
    filename: slugify(json && json.name, 'course') + '.json',
    text: JSON.stringify(json, null, 2),
    mime: 'application/json',
  };
}

// ===== コミュニティ走行プログラム (GitHub の programs/community/ で共有) =====
// 利用者が改変したプログラムを別名で PR 投稿し、全利用者が「走行」メニューから選べるようにする。
const COMMUNITY_PROGRAM_DIR = 'programs/community';

// 投稿プログラム一覧を取得。**取得失敗**時は `null`・**正常取得**時は配列 (0 件なら `[]`) を返す
// (Q1[B]・失敗と 0 件を区別)。本体動作はどちらでも止めない。loadable= 取込可能な拡張子。
export async function listCommunityPrograms() {
  const list = await listDirCached(COMMUNITY_PROGRAM_DIR);   // キャッシュ→マニフェスト→API
  if (list === null) return null;                            // 取得失敗 (Q1[B] 契約は不変)
  return list
    .filter(f => f.type === 'file' && langFromName(f.name))
    .map(f => ({
      name: f.name.replace(/\.[^.]+$/, ''), file: f.name, path: f.path,
      download_url: f.download_url, lang: langFromName(f.name),
    }));
}

/**
 * プログラムの投稿物を組み立てる (別名で追加する運用)。コースと同じ理由で URL に載せない
 * — ⚠ 旧 `/new/` は**新規作成専用の endpoint** だったので「上書きしない」ことを endpoint が
 * 構造的に保証していたが、`/upload/` にはその保証が無い。既定名は `<プログラム名>-custom` で
 * 別々の利用者が既定のまま押すと**同名になりうる**。ゆえに文言からも「上書きしません」という
 * 断定を外してある (main.js 側の案内も同様)。
 * — 同梱 23 本のうち 18 本が旧方式では上限超過だった (最大 40,747 文字)。
 * lang に応じた拡張子を付ける (c→.ino / py→.py / js→.js)。
 */
export function programSubmission(code, name, lang = 'c') {
  const ext = lang === 'py' ? 'py' : (lang === 'js' ? 'js' : 'ino');
  return {
    dir: COMMUNITY_PROGRAM_DIR,
    filename: slugify(name, 'program') + '.' + ext,
    text: String(code == null ? '' : code),
    mime: 'text/plain',
  };
}

// ===== コミュニティ車種 (GitHub の cars/community/ で共有・V4) =====
// 利用者が作った車種 (key/name/物理パラメータ/drift の JSON) を PR で投稿し、全利用者が
// 車種メニューから選べるようにする。読み取りは公開リポジトリなので認証不要 (一覧は index.json→API の順)。
// 取得元ディレクトリ cars/community/ の作成・シードは人間承認 (CI-11)。未作成のうちは下記
// listCommunityCars が null (取得失敗) を返し、呼び出し側が通知 1 行を出して本体は止めない。
const COMMUNITY_CAR_DIR = 'cars/community';

// 投稿車種一覧を取得。**取得失敗** (レート制限/オフライン/未作成 404/JSON 異常) 時は `null`・
// **正常取得** 時は配列 (0 件なら `[]`) を返す (Q1[B]・listCommunityCourses と同契約＝失敗と 0 件を
// 区別)。本体動作はどちらでも止めない。未作成 (404) は取得失敗扱い＝通知 1 行 (Q1 と同方針)。
export async function listCommunityCars() {
  const list = await listDirCached(COMMUNITY_CAR_DIR);   // キャッシュ→マニフェスト→API
  if (list === null) return null;                        // 取得失敗 (Q1[B] 契約は不変)
  return list
    .filter(f => f.type === 'file' && /\.json$/i.test(f.name))
    .map(f => ({ name: f.name.replace(/\.json$/i, ''), path: f.path, download_url: f.download_url }));
}

// 投稿車種の JSON 本体を取得 (車種 def フォーマット: key/name/mass/.../drift)。
export async function fetchCommunityCar(downloadUrl) {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(t('loader.fetchFail', { status: res.status }));
  return res.json();
}

/**
 * 車種の投稿物を組み立てる (cars/community/ へ別名で追加)。ファイル名は車種 key を slug 化した
 * ものを優先 (無ければ name → 'car-<時刻>')。
 *
 * AZ4: **旧 `shareCarUrl` は「原理的に膨らまない」と書かれていたが誤りだった**。車種 def の
 * 数値欄は固定でも `key`/`name` は利用者が自由に入力する欄で、実測は
 * 出荷 6 車種 721〜1,092 文字 / 名前 300 文字で 3,339 / **1,000 文字で 9,639＝受理上限 6,600 を超過**。
 * 「今のところ短いから大丈夫」は性質ではなく偶然なので、コース・プログラムと**同じ門**に通す。
 * (同じ門を全経路に通す＝RATELIMIT-1 で `listItem()` に集約したのと同じ是正)
 *
 * ⚠ **上書きは防げない**: 旧 `/new/` は新規作成専用の endpoint だったが `/upload/` には
 * その保証が無い。`key` は利用者が自由に付けるので、別の投稿車種と同名になりうる。
 * 「別名投稿」は組込 6 車種と別名という意味で、投稿車種どうしの衝突までは防がない。
 */
export function carSubmission(json) {
  const src = json || {};
  return {
    dir: COMMUNITY_CAR_DIR,
    filename: slugify(src.key || src.name, 'car') + '.json',
    text: JSON.stringify(src, null, 2),
    mime: 'application/json',
  };
}

// ===== 公式レース (GitHub の races/ で開催・W5) =====
// 開催の真実源を GitHub に置く (中央サーバ不要・W_spec §7)。1 イベント = 1 ディレクトリ:
//   races/<eventId>/event.json            … イベント定義 (クラス/コース/周回/予算/締切窓/engineVer)
//   races/<eventId>/entries/<author>.json … エントリー (名前/GitHub/プログラム/車種 def を同梱・PR で追加)
//   races/<eventId>/result.json           … 締切後の確定結果 (公式 verifyHash を刻む・固定環境の正準エンジンで算出)
// 読み取りは公開リポジトリなので認証不要 (一覧のみ GitHub API・本文は raw)。races/ の作成・シードは
// 外部不可逆＝人間承認 (CI-11)。未作成のうちは listOfficialRaces が null (取得失敗) を返し、呼び出し側が
// 通知 1 行を出して本体は止めない (Q1/V4 と同契約＝失敗 null / 正常 0 件 [] を区別)。
const RACE_DIR = 'races';

// 公式レース一覧を取得 (races/ 直下のディレクトリ = eventId)。**取得失敗** (未作成 404/レート制限
// /オフライン/JSON 異常) 時は `null`・**正常取得** 時は配列 (0 件なら `[]`) を返す (Q1/V4 同契約)。
export async function listOfficialRaces() {
  // races/ は「大会が始まるまで存在しない」ディレクトリで、これまで毎回 404 を
  // 引きに行って API 枠を 1 回ずつ無駄にしていた。未作成は listDirCached が
  // localStorage に覚えるので、TTL の間は問い合わせない (v7.4.0)。
  const list = await listDirCached(RACE_DIR, true);   // true = ディレクトリ一覧
  if (list === null) return null;                     // 取得失敗 (Q1/V4 契約は不変)
  return list.filter((f) => f.type === 'dir').map((f) => ({ id: f.name, path: f.path }));
}

// 1 イベントの定義 + エントリー + 結果を取得。戻り値 `{ event, entries[], result }`。
// event.json は必須 (取得不能なら全体 null)。entries/*.json と result.json は任意 (開催中は result 無し
// = null)。entries は各 JSON を集める (1 件の取得失敗はスキップ＝堅牢)。再実行の確定順は呼び出し側の
// frozenField (submittedAt 昇順) が決める＝ファイル取得順には依存しない (決定論)。
export async function fetchRace(eventId) {
  const { owner, repo, branch } = COURSE_REPO;
  const dir = `${RACE_DIR}/${encodeURIComponent(eventId)}`;
  const raw = (p) => `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${dir}/${p}`;
  let event;
  try {
    const r = await fetch(raw('event.json'));
    if (!r.ok) return null;
    event = await r.json();
  } catch (e) { return null; }
  // エントリー (任意)。entries/ ディレクトリを一覧 → 各 JSON を取得。
  // v7.4.0: ここも listDirCached を通す。以前は大会 1 件につき API を 1 回使っており、
  // 起動時に全大会分が走るため、大会を 4 本開催すると起動あたり 4 回 = 改修前と同じ
  // 消費に戻ってしまう。マニフェストとキャッシュを一覧取得の全経路に効かせる。
  const entries = [];
  try {
    const files = (await listDirCached(`${dir}/entries`)) || [];
    const jsons = files.filter((f) => /\.json$/i.test(f.name));
    // v5.2.0: 逐次 await を並列取得へ (1 件失敗はスキップ=従来同値)。結果は files 一覧順に詰める
    // が、確定順は呼び出し側 frozenField (submittedAt 昇順) が決めるため取得順は元々結果に非影響。
    const fetched = await Promise.all(jsons.map(async (f) => {
      try { return await (await fetch(f.download_url)).json(); } catch (e) { return null; /* 1 件失敗はスキップ */ }
    }));
    for (const j of fetched) if (j != null) entries.push(j);
  } catch (e) { /* entries 無し = [] */ }
  // 確定結果 (任意・締切後のみ)。
  let result = null;
  try { const r = await fetch(raw('result.json')); if (r.ok) result = await r.json(); } catch (e) { /* 未確定 */ }
  return { event, entries, result };
}

// ===== 公式レースの投稿物 (AZ4・2026-09-12) ======================================
// コース/プログラム/車種と**同じ門**に通す。旧 `shareEntryUrl`/`shareEventUrl`/`shareResultUrl` は
// 投稿物の全文を `?value=` に載せていたので、受理上限 (実測 約 6,600 文字) を超えると
// 「押しても何も開かない」に落ちていた。**実測 (2026-09-12・同梱 PROGRAMS 23 本)**:
//   ・shareEntryUrl  … 23 本中 **20 本が超過**・最大 42,317 文字 (プログラム全文＋車種 def 同梱のため)
//   ・shareEventUrl  … 出荷 66 コースで最大 1,512 だが、コース名は投稿者が自由に付けられ
//                      **300 文字なら 6,360 文字＝上限の 96%**。「短いから安全」は性質ではない
//   ・shareResultUrl … **初版から呼び出し 0 件のデッドコード**だったので新設せず削除した
//                      (公式の確定は固定環境の正準エンジン `wf_official_result.mjs` が行う＝W_spec §5.1。
//                       ブラウザから result.json を投稿する導線は、あってはならないもの)
//
// 投稿先は「まだ無いディレクトリ」になりうる (races/<大会>/ は大会が立つまで存在しない) が、
// `/upload/` はそれでも 200 で本物の画面を返すことを実測済み (uploadPageUrl の注記)。

// イベント定義 (races/<id>/event.json) の投稿物。id はこのアプリが**これから名付ける**ものなので
// slug 化する。`hostOfficialEvent` も **この同じ `slugify`** で id を作るので、書き出す JSON の
// `id` と置くディレクトリ名は必ず一致する (以前は main.js 側に 200 文字上限が無く食い違った)。
//
// ⚠ **上書きは防げない**: `/upload/` は新規作成専用ではない。id はコース名の slug なので、
// **同じコース名で 2 人が開催すると同じ `races/<slug>/event.json`** になり、後の PR が
// 先の大会定義を置き換えうる。旧 `/new/` は endpoint がこれを構造的に防いでいた。
export function eventSubmission(event) {
  const id = slugify(event && event.id, 'event');
  return {
    dir: `${RACE_DIR}/${id}`,
    filename: 'event.json',
    text: JSON.stringify(event, null, 2),
    mime: 'application/json',
  };
}

/**
 * エントリー (races/<大会>/entries/<author>.json) の投稿物。
 * entry は **車種 def 全体 (carDef) を同梱** する (custom/override/community 車は shipped に無く
 * key 参照では再現不可＝ポータビリティのため・W_spec §1)。プログラムも program.src に焼き込む。
 *
 * ⚠ **第 1 引数は「上流に実在するディレクトリ名」であって `event.json` の `id` フィールドではない**。
 * 旧 `shareEntryUrl` は `slugify(event.id)` を投稿先にしていたが、この 2 つは一致を強制されていない
 * (`listOfficialRaces` はディレクトリ名を id として返し、`event.id` は JSON の中身)。食い違えば
 * **実在しない場所の投稿画面を開く**＝AZ-0 が潰したはずの「開いたのに投稿できない」に戻る。
 * ゆえに slug 化せず、`fetchRace` に渡した dir をそのまま使う (符号化は uploadPageUrl が行う)。
 *
 * ⚠ **上書きは防げない**: `/upload/` は新規作成専用ではないので、同じ author 名の先行エントリーが
 * あれば置き換えうる (旧 `/new/` は endpoint が防いでいた)。
 */
export function entrySubmission(eventDir, entry) {
  // `.` と `..` も弾く。uploadPageUrl が最終的に止めるので実害は出ないが、そこで throw すると
  // **①のダウンロードだけ済んだ後**に落ちるため、利用者には「ログの URL を自分で開いてください」と
  // 出るのに肝心の URL がログに無い、という筋の通らない状態になる。手前で止める。
  if (typeof eventDir !== 'string' || !eventDir || /[/\\]/.test(eventDir)
      || eventDir === '.' || eventDir === '..') {
    throw new Error(`entrySubmission: 大会ディレクトリ名が不正です (${JSON.stringify(eventDir)})`);
  }
  const src = entry || {};
  return {
    dir: `${RACE_DIR}/${eventDir}/entries`,
    filename: slugify(src.author || src.name, 'entry') + '.json',
    text: JSON.stringify(src, null, 2),
    mime: 'application/json',
  };
}
