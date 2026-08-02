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
// 読み取りは公開リポジトリなので認証不要 (ディレクトリ一覧のみ GitHub API、本文は raw)。
export const COURSE_REPO = SAMPLE_REPO;          // 同じ RumiCar-group/RumiCar
const COMMUNITY_DIR = 'courses/community';

// 投稿コース一覧を取得。**取得失敗** (レート制限/オフライン/通信瞬断/JSON 異常) 時は `null` を、
// **正常取得** 時は配列 (0 件なら `[]`) を返す。呼び出し側が失敗と 0 件を区別して通知できるよう
// するため (Q1[B]・無言失敗で「コースが消えた」と誤解させない)。本体動作はどちらでも止めない。
export async function listCommunityCourses() {
  const { owner, repo, branch } = COURSE_REPO;
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${COMMUNITY_DIR}?ref=${branch}`;
  let res;
  try { res = await fetch(api); } catch (e) { return null; }   // 取得失敗 (オフライン等)
  if (!res.ok) return null;                                     // レート制限 (403) 等
  let items;
  try { items = await res.json(); } catch (e) { return null; }  // JSON 異常
  const list = Array.isArray(items) ? items : [];
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

// 現在のコース JSON を GitHub の「新規ファイル作成」画面に渡す URL を作る。
// 開くと内容が事前入力され、コミットすると PR が作られる (書込権限が無ければ自動 fork)。
export function shareCourseUrl(json) {
  const { owner, repo, branch } = COURSE_REPO;
  const base = (json.name || 'course').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const slug = base || ('course-' + Date.now());
  const content = JSON.stringify(json, null, 2);
  return `https://github.com/${owner}/${repo}/new/${branch}/${COMMUNITY_DIR}`
    + `?filename=${encodeURIComponent(slug)}.json&value=${encodeURIComponent(content)}`;
}

// ===== コミュニティ走行プログラム (GitHub の programs/community/ で共有) =====
// 利用者が改変したプログラムを別名で PR 投稿し、全利用者が「走行」メニューから選べるようにする。
const COMMUNITY_PROGRAM_DIR = 'programs/community';

// 投稿プログラム一覧を取得。**取得失敗**時は `null`・**正常取得**時は配列 (0 件なら `[]`) を返す
// (Q1[B]・失敗と 0 件を区別)。本体動作はどちらでも止めない。loadable= 取込可能な拡張子。
export async function listCommunityPrograms() {
  const { owner, repo, branch } = COURSE_REPO;
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${COMMUNITY_PROGRAM_DIR}?ref=${branch}`;
  let res;
  try { res = await fetch(api); } catch (e) { return null; }   // 取得失敗 (オフライン等)
  if (!res.ok) return null;                                     // レート制限 (403) 等
  let items;
  try { items = await res.json(); } catch (e) { return null; }  // JSON 異常
  const list = Array.isArray(items) ? items : [];
  return list
    .filter(f => f.type === 'file' && langFromName(f.name))
    .map(f => ({
      name: f.name.replace(/\.[^.]+$/, ''), file: f.name, path: f.path,
      download_url: f.download_url, lang: langFromName(f.name),
    }));
}

// 現在のプログラム本文を GitHub の「新規ファイル作成」画面に渡す URL を作る (別名保存)。
// lang に応じた拡張子で programs/community/ に新規ファイルとして開く (上書きしない)。
export function shareProgramUrl(code, name, lang = 'c') {
  const { owner, repo, branch } = COURSE_REPO;
  const ext = lang === 'py' ? 'py' : (lang === 'js' ? 'js' : 'ino');
  const base = (name || 'my-program').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const slug = base || ('program-' + Date.now());
  return `https://github.com/${owner}/${repo}/new/${branch}/${COMMUNITY_PROGRAM_DIR}`
    + `?filename=${encodeURIComponent(slug)}.${ext}&value=${encodeURIComponent(code || '')}`;
}

// ===== コミュニティ車種 (GitHub の cars/community/ で共有・V4) =====
// 利用者が作った車種 (key/name/物理パラメータ/drift の JSON) を PR で投稿し、全利用者が
// 車種メニューから選べるようにする。読み取りは公開リポジトリなので認証不要 (一覧のみ API)。
// 取得元ディレクトリ cars/community/ の作成・シードは人間承認 (CI-11)。未作成のうちは下記
// listCommunityCars が null (取得失敗) を返し、呼び出し側が通知 1 行を出して本体は止めない。
const COMMUNITY_CAR_DIR = 'cars/community';

// 投稿車種一覧を取得。**取得失敗** (レート制限/オフライン/未作成 404/JSON 異常) 時は `null`・
// **正常取得** 時は配列 (0 件なら `[]`) を返す (Q1[B]・listCommunityCourses と同契約＝失敗と 0 件を
// 区別)。本体動作はどちらでも止めない。未作成 (404) は取得失敗扱い＝通知 1 行 (Q1 と同方針)。
export async function listCommunityCars() {
  const { owner, repo, branch } = COURSE_REPO;
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${COMMUNITY_CAR_DIR}?ref=${branch}`;
  let res;
  try { res = await fetch(api); } catch (e) { return null; }   // 取得失敗 (オフライン等)
  if (!res.ok) return null;                                     // 未作成 (404)/レート制限 (403) 等
  let items;
  try { items = await res.json(); } catch (e) { return null; }  // JSON 異常
  const list = Array.isArray(items) ? items : [];
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

// 車種 def を GitHub の「新規ファイル作成」画面に渡す URL を作る (cars/community/ に新規・上書きなし)。
// ファイル名は車種 key を slug 化したものを優先 (無ければ name → 'car-<時刻>')。
export function shareCarUrl(json) {
  const { owner, repo, branch } = COURSE_REPO;
  const base = String(json.key || json.name || 'car').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const slug = base || ('car-' + Date.now());
  const content = JSON.stringify(json, null, 2);
  return `https://github.com/${owner}/${repo}/new/${branch}/${COMMUNITY_CAR_DIR}`
    + `?filename=${encodeURIComponent(slug)}.json&value=${encodeURIComponent(content)}`;
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

// slug 化 (shareCourseUrl/shareCarUrl と同型)。空なら時刻フォールバック。
function slugify(s, fallbackPrefix) {
  const base = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base || (fallbackPrefix + '-' + Date.now());
}

// 公式レース一覧を取得 (races/ 直下のディレクトリ = eventId)。**取得失敗** (未作成 404/レート制限
// /オフライン/JSON 異常) 時は `null`・**正常取得** 時は配列 (0 件なら `[]`) を返す (Q1/V4 同契約)。
export async function listOfficialRaces() {
  const { owner, repo, branch } = COURSE_REPO;
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${RACE_DIR}?ref=${branch}`;
  let res;
  try { res = await fetch(api); } catch (e) { return null; }   // 取得失敗 (オフライン等)
  if (!res.ok) return null;                                     // 未作成 (404)/レート制限 (403) 等
  let items;
  try { items = await res.json(); } catch (e) { return null; }  // JSON 異常
  const list = Array.isArray(items) ? items : [];
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
  const entries = [];
  try {
    const api = `https://api.github.com/repos/${owner}/${repo}/contents/${dir}/entries?ref=${branch}`;
    const r = await fetch(api);
    if (r.ok) {
      const items = await r.json();
      const files = (Array.isArray(items) ? items : []).filter((f) => f.type === 'file' && /\.json$/i.test(f.name));
      for (const f of files) {
        try { entries.push(await (await fetch(f.download_url)).json()); } catch (e) { /* 1 件失敗はスキップ */ }
      }
    }
  } catch (e) { /* entries 無し = [] */ }
  // 確定結果 (任意・締切後のみ)。
  let result = null;
  try { const r = await fetch(raw('result.json')); if (r.ok) result = await r.json(); } catch (e) { /* 未確定 */ }
  return { event, entries, result };
}

// イベント定義を GitHub の「新規ファイル作成」画面に渡す URL (races/<id>/event.json 新規・PR・上書きなし)。
export function shareEventUrl(event) {
  const { owner, repo, branch } = COURSE_REPO;
  const id = slugify(event.id, 'event');
  const content = JSON.stringify(event, null, 2);
  return `https://github.com/${owner}/${repo}/new/${branch}/${RACE_DIR}/${encodeURIComponent(id)}`
    + `?filename=event.json&value=${encodeURIComponent(content)}`;
}

// エントリーを GitHub の「新規ファイル作成」画面に渡す URL (races/<id>/entries/<author>.json 新規・PR)。
// entry は **車種 def 全体 (carDef) を同梱** する (custom/override/community 車は shipped に無く key 参照
// では再現不可＝ポータビリティのため・W_spec §1)。プログラムも program.src に焼き込む。
export function shareEntryUrl(eventId, entry) {
  const { owner, repo, branch } = COURSE_REPO;
  const id = slugify(eventId, 'event');
  const author = slugify(entry.author || entry.name, 'entry');
  const content = JSON.stringify(entry, null, 2);
  return `https://github.com/${owner}/${repo}/new/${branch}/${RACE_DIR}/${encodeURIComponent(id)}/entries`
    + `?filename=${encodeURIComponent(author)}.json&value=${encodeURIComponent(content)}`;
}

// 確定結果を GitHub の「新規ファイル作成」画面に渡す URL (races/<id>/result.json 新規・PR)。
// 公式 verifyHash は **固定環境の正準エンジン** (pinned Node) で算出したものを刻む (W_spec §5.1)。
export function shareResultUrl(eventId, result) {
  const { owner, repo, branch } = COURSE_REPO;
  const id = slugify(eventId, 'event');
  const content = JSON.stringify(result, null, 2);
  return `https://github.com/${owner}/${repo}/new/${branch}/${RACE_DIR}/${encodeURIComponent(id)}`
    + `?filename=result.json&value=${encodeURIComponent(content)}`;
}
