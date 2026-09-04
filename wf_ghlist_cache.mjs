// wf_ghlist_cache.mjs — コミュニティ一覧取得の常設ゲート (v7.4.0 / 会話ベース RATELIMIT-1)。
//
// 背景: 未認証の GitHub API は IP あたり 60 回/時。起動のたびに一覧を 4 回
// (races/courses/programs/cars) 叩いていたため、教室のように 1 回線を大勢で共有すると
// 数人で使い切り、コミュニティ投稿が読めなくなっていた (実測: 15 回開くと枯渇)。
// v7.4.0 で「ブラウザ側キャッシュ → マニフェスト(raw・制限なし) → API」の3段にした。
// この経路は外部ネットワークに依存するため実ブラウザ検証だけでは回帰を捕まえにくい。
// fetch・localStorage・Date.now を差し替えて、**呼び出し回数と分岐**を機械で確認する。
//
// 検査の設計方針: 「守っているロジックを 1 行消したらこのゲートが赤くなるか」で項目を選ぶ。
// 初版は index.json 除外を listCommunityPrograms で検査していたが、そちらは
// langFromName フィルタが先に .json を落とすため、除外を消しても緑のままだった
// (変異テストで確認)。混入が実際に起きるのは .json を受け入れる courses/cars 側なので、
// 検査対象をそちらに移してある。
//
// 検査項目:
//   ① マニフェストがあるとき: API を 1 回も呼ばない / 一覧が正しく読める
//   ② マニフェストが無いとき: API へフォールバックする (従来互換)
//   ③ キャッシュが効くとき: 2 回目は fetch を 1 回も呼ばない
//   ④ 未作成 (404) を覚える: 2 回目は fetch を呼ばず null を返す (races の空振り防止)
//   ⑤ レート制限 (403) は覚えない: 2 回目に再挑戦する (復帰したらすぐ拾う)
//   ⑥ clearListCache() で捨てられる (「再読込」ボタンの意味を保つ)
//   ⑦ index.json を一覧に混ぜない — **マニフェスト経路と API 経路の両方**
//   ⑧ 危険な entries (`../` `sub/x` `.`) を弾く
//   ⑨ 特殊文字のファイル名を URL エンコードする (`a#b.json` で別物を取りにいかない)
//   ⑩ TTL が切れたら取り直す
//   ⑪ 壊れたキャッシュを掴んだら捨てる (「失敗は null」契約を破って例外にしない)
//   ⑫ ディレクトリ一覧 (races) はマニフェストを使わない (0 件と誤認しない)
// exit: 0=全緑 / 1=失敗。
const fails = [];
let checks = 0;
const ok = (cond, label) => {
  checks++; console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) fails.push(label);
};

// --- ブラウザ環境の最小模擬 (localStorage / fetch / 時計) ---------------------
const store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

// 時計を進められるようにする (TTL 満了を実時間を待たずに検査するため)。
let clock = 1_700_000_000_000;
const realNow = Date.now;
Date.now = () => clock;

let calls = [];
const mkFetch = (routes) => async (url) => {
  calls.push(String(url));
  for (const [re, res] of routes) if (re.test(String(url))) return res();
  return { ok: false, status: 404, json: async () => ({}) };
};
const jsonRes = (body) => () => ({ ok: true, status: 200, json: async () => body });
const errRes = (status) => () => ({ ok: false, status, json: async () => ({}) });
const apiFile = (name, dir) => ({
  type: 'file', name, path: `${dir}/${name}`,
  download_url: `https://raw.githubusercontent.com/RumiCar-group/RumiCar/master/${dir}/${name}`,
  sha: 'x'.repeat(40), size: 123, _links: { self: 'https://…' },   // 後段が使わない余計なフィールド
});

const RAW = /raw\.githubusercontent\.com/;
const API = /api\.github\.com/;
const apiCalls = () => calls.filter((u) => API.test(u));
const reset = () => { store.clear(); calls = []; };

const {
  listCommunityPrograms, listCommunityCourses, listOfficialRaces, clearListCache,
} = await import('./public/js/loader.js');

console.log('① マニフェストがあるとき: API を使わない');
reset();
globalThis.fetch = mkFetch([[RAW, jsonRes({ generated: 'x', entries: ['a.ino', 'b.py', 'index.json'] })]]);
let r = await listCommunityPrograms();
ok(Array.isArray(r) && r.length === 2, `一覧が読める (実測 ${r ? r.length : 'null'} 件)`);
ok(apiCalls().length === 0, `API 呼び出しが 0 回 (実測 ${apiCalls().length} 回)`);
ok(r && r[0].download_url.startsWith('https://raw.githubusercontent.com/'), 'download_url を raw で組み立てる');

console.log('② マニフェストが無いとき: API へフォールバック');
reset();
globalThis.fetch = mkFetch([[RAW, errRes(404)],
  [API, jsonRes([apiFile('c.ino', 'programs/community')])]]);
r = await listCommunityPrograms();
ok(Array.isArray(r) && r.length === 1, `API から読める (実測 ${r ? r.length : 'null'} 件)`);
ok(apiCalls().length === 1, `API を 1 回だけ呼ぶ (実測 ${apiCalls().length} 回)`);

console.log('③ キャッシュ: 2 回目は通信しない');
calls = [];
r = await listCommunityPrograms();
ok(Array.isArray(r) && r.length === 1, '2 回目も同じ一覧を返す');
ok(calls.length === 0, `通信が 0 回 (実測 ${calls.length} 回)`);

console.log('④ 未作成 (404) を覚える: races の空振りを繰り返さない');
reset();
globalThis.fetch = mkFetch([[RAW, errRes(404)], [API, errRes(404)]]);
r = await listOfficialRaces();
ok(r === null, '1 回目は null (取得失敗の契約を維持)');
const first404 = calls.length;
calls = [];
r = await listOfficialRaces();
ok(r === null, '2 回目も null');
ok(calls.length === 0, `2 回目は通信 0 回 (1 回目は ${first404} 回)`);

console.log('⑤ レート制限 (403) は覚えない: 復帰したら拾う');
reset();
globalThis.fetch = mkFetch([[RAW, errRes(404)], [API, errRes(403)]]);
r = await listCommunityPrograms();
ok(r === null, '制限中は null');
calls = [];
globalThis.fetch = mkFetch([[RAW, errRes(404)],
  [API, jsonRes([apiFile('d.py', 'programs/community')])]]);
r = await listCommunityPrograms();
ok(Array.isArray(r) && r.length === 1, '復帰後は取得できる (403 をキャッシュしていない)');

console.log('⑥ clearListCache() で捨てられる');
reset();
globalThis.fetch = mkFetch([[RAW, jsonRes({ entries: ['a.ino'] })]]);
await listCommunityPrograms();
calls = [];
await listCommunityPrograms();
ok(calls.length === 0, 'キャッシュが効いている');
clearListCache();
calls = [];
await listCommunityPrograms();
ok(calls.length > 0, `捨てたので取り直す (実測 ${calls.length} 回)`);

console.log('⑦ index.json を一覧に混ぜない (マニフェスト経路・API 経路の両方)');
// 混入が実害になるのは .json をそのままコースとして受け入れる courses/cars 側。
// 上流にマニフェストを置くと同じディレクトリに index.json が並ぶため、除外を落とすと
// 「index」という名の空コース (3m×2m) がメニューに現れる。
reset();
globalThis.fetch = mkFetch([[RAW, jsonRes({ entries: ['oval.json', 'index.json'] })]]);
r = await listCommunityCourses();
ok(r && r.length === 1 && !r.some((c) => c.name === 'index'),
  `マニフェスト経路で除外 (実測 ${JSON.stringify((r || []).map((c) => c.name))})`);
reset();
globalThis.fetch = mkFetch([[RAW, errRes(404)],
  [API, jsonRes([apiFile('oval.json', 'courses/community'), apiFile('index.json', 'courses/community')])]]);
r = await listCommunityCourses();
ok(r && r.length === 1 && !r.some((c) => c.name === 'index'),
  `API 経路でも除外 (実測 ${JSON.stringify((r || []).map((c) => c.name))})`);

console.log('⑧ 危険な entries を弾く');
reset();
globalThis.fetch = mkFetch([[RAW, jsonRes({ entries: ['../../secret.json', 'sub/deep.json', '.', 'ok.json'] })]]);
r = await listCommunityCourses();
ok(r && r.length === 1 && r[0].name === 'ok',
  `区切り文字と相対参照を落とす (実測 ${JSON.stringify((r || []).map((c) => c.name))})`);

console.log('⑨ 特殊文字のファイル名を URL エンコードする');
reset();
globalThis.fetch = mkFetch([[RAW, jsonRes({ entries: ['a#b.json', 'sp ace.json'] })]]);
r = await listCommunityCourses();
const u0 = new URL(r[0].download_url);
ok(u0.hash === '' && u0.pathname.endsWith('/a%23b.json'),
  `# がフラグメントにならない (実測 pathname=${u0.pathname.split('/').pop()} hash=${JSON.stringify(u0.hash)})`);
ok(new URL(r[1].download_url).pathname.endsWith('/sp%20ace.json'), '空白をエンコードする');

console.log('⑩ TTL が切れたら取り直す');
reset();
globalThis.fetch = mkFetch([[RAW, jsonRes({ entries: ['a.ino'] })]]);
await listCommunityPrograms();
clock += 4 * 60 * 1000;                       // マニフェスト TTL は 5 分。4 分ならまだ有効
calls = [];
await listCommunityPrograms();
ok(calls.length === 0, `4 分後はキャッシュのまま (実測 ${calls.length} 回)`);
clock += 2 * 60 * 1000;                       // 合計 6 分 = 満了
calls = [];
await listCommunityPrograms();
ok(calls.length > 0, `6 分後は取り直す (実測 ${calls.length} 回)`);

console.log('⑪ 壊れたキャッシュを掴んだら捨てる');
reset();
// items が無い / 配列でない値を注入する (拡張機能・別版・手編集による汚染を想定)。
for (const bad of ['{"at":' + clock + ',"src":"api"}', '{"at":' + clock + ',"src":"api","items":{}}', 'not json']) {
  store.clear();
  for (const k of ['RumiCar-group/RumiCar@master:f:courses/community']) {
    store.set('rcsim.ghlist.' + k, bad);
  }
  globalThis.fetch = mkFetch([[RAW, errRes(404)],
    [API, jsonRes([apiFile('oval.json', 'courses/community')])]]);
  let threw = null;
  try { r = await listCommunityCourses(); } catch (e) { threw = e; }
  ok(!threw && Array.isArray(r) && r.length === 1,
    `汚染 ${bad.slice(0, 34)}… でも例外を出さず取り直す${threw ? ` (実測 例外 ${threw.name})` : ''}`);
}

console.log('⑫ ディレクトリ一覧 (races) はマニフェストを使わない');
reset();
// マニフェスト生成器はファイルしか列挙できない。races/index.json が置かれたときに
// それを信じると entries:[] = 「大会 0 件・正常」になり、通知も出ないまま一覧が空になる。
globalThis.fetch = mkFetch([[RAW, jsonRes({ entries: [] })],
  [API, jsonRes([{ type: 'dir', name: 'cup-2026', path: 'races/cup-2026' }])]]);
r = await listOfficialRaces();
ok(r && r.length === 1 && r[0].id === 'cup-2026',
  `API を見て大会を拾う (実測 ${JSON.stringify((r || []).map((x) => x.id))})`);
ok(!calls.some((u) => RAW.test(u)), `races では raw を叩かない (実測 ${calls.filter((u) => RAW.test(u)).length} 回)`);

Date.now = realNow;
console.log('');
console.log(fails.length ? `結果: FAIL (${fails.length} / ${checks} 件)` : `結果: PASS (全 ${checks} 項目)`);
process.exit(fails.length ? 1 : 0);
