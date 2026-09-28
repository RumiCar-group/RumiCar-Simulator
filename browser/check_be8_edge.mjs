// BE8 常設ゲート — エッジ（公開 URL の前段 nginx）越しでも「毎回再検証」の配信ヘッダが届くことを測る。
//
// なぜ要るのか:
//   check_bc1_cache.mjs は run.sh の既定（RC_URL＝配信コンテナ rumicar-simulator を直に引く）で回るので、
//   **エッジが途中で書き換える退行は見えない**。エッジ設定は本リポジトリの外（別リポジトリ ~/infra の
//   nginx/conf.d/snippets/wp-server-common.conf）にあり、シミュレータ配下が WP 用の `expires max`
//   （同ファイルの `location ~* \.(js|css|…)$`）に捕まらないのは `location ^~ /simulator/` の
//   **`^~` 2 文字だけ**が理由（nginx は最長の前方一致が `^~` なら正規表現 location を評価しない）。
//   `^~` が消えると /simulator/ 配下の .js/.css は正規表現 location に奪われ、プロキシされずに
//   WP の root から探される（本サーバでは 404。ファイルが置かれていれば `expires max` の 200）。
//   どちらでも check_bc1_cache の述語は赤になるので、**同じ述語をエッジへ向けて撃つ**のが本ゲート。
//   （BC-3 の未決「エッジ側 `^~` の消失を機械で検出する口が無い」を BE8 で塞いだ・利用者裁定 2026-09-28。）
//
// 測る述語:
//   E0) 対象が 200 で応答し、その応答が **エッジを通っている**こと。エッジの server 設定（wp-server-common.conf
//       の server 直下 `add_header X-Frame-Options "SAMEORIGIN" always;`）が付けるヘッダの有無で見分ける。
//       これが無いまま緑にすると、RC_EDGE_URL を配信コンテナへ向けたときに「エッジを測ったつもり」の緑になる。
//   E3) E0 の見分けの**対照**: 配信コンテナ直（run.sh が入れる RC_URL）の応答には X-Frame-Options が**無い**
//       こと。配信コンテナの nginx-default.conf に同じヘッダを足すと E0 は見分けにならなくなるので、
//       その前提を毎回測る（赤になったら E0 の見分けを別の印へ替える）。RC_URL が無い・エッジと同じ
//       （run.sh がコンテナを見つけられず公開 URL へフォールバックした）ときは対照を取れないので赤にする。
//   E1) check_bc1_cache.mjs を **RC_URL＝エッジ**で子プロセスとして走らせ、exit 0 であること。
//       述語（200・鮮度なしの Cache-Control・再検証の材料・304 とその Cache-Control）は複製せず本物を使う。
//   E2) 子が RC_URL＝エッジを受け取ったこと（子の出力の「対象:」行で照合。子が RC_URL を読まなくなった・
//       印字の前に落ちた、を捕まえる。子の要求が最終的にどこへ着いたかは E1 の各応答が表す）。
//
// 対象 URL: RC_EDGE_URL（既定 https://www.rumicar.com/simulator/）。run.sh が入れる RC_URL は**測る対象には
//   使わない**（配信コンテナを指すのが既定なので、使うと check_bc1_cache の重複になる）。E3 の対照にだけ使う。
//   エッジに届かない環境では赤になる（黙って skip しない＝CI-14）。別のエッジを測るときは RC_EDGE_URL を渡す。
//
// 既知の限界:
//   ・逆向きの偽の赤: エッジの `location ^~ /simulator/` の中に add_header を 1 行でも足すと、server 直下の
//     X-Frame-Options が継承されなくなり（wp-server-common.conf のセキュリティヘッダ節の注記）E0 が赤になる。
//     安全側の赤なので、そのときは E0 の印を替える。
//   ・check_bc1_cache の TARGETS の js/state.js は「gzip されない小さい js で strong ETag の経路を通す」ために
//     入っているが、エッジは gzip_min_length 256（~/infra の default.conf）で 487 byte の state.js も gzip する
//     ので、エッジ越しでは weak ETag になる（BE8 で実測）。strong ETag の経路は配信コンテナ直の
//     check_bc1_cache が受け持つ（配信コンテナの gzip_min_length は 1024）。
//
// 赤になることの確認（BE8）: 本番のエッジは触らず、同じイメージ（nginx:1.30-alpine）の使い捨てコンテナで
//   wp-server-common.conf の複製を配信し、`^~` を残した複製で緑・外した複製で赤になることを確かめた
//   （記録は internal の docs/stage_be/be8/）。
//
// 使い方: bash browser/run.sh check_be8_edge.mjs（run_all.sh からもこの形で回る。E3 の対照に RC_URL が要る）
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const EDGE_URL = process.env.RC_EDGE_URL || 'https://www.rumicar.com/simulator/';
const base = EDGE_URL.endsWith('/') ? EDGE_URL : EDGE_URL + '/';

let fail = 0;
const ok = (label, cond, detail = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!cond) fail++;
  return cond;
};

console.log('対象（エッジ）:', base);

// E0: エッジを通った応答か
const head = async (url) => {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
    return { status: res.status, xfo: res.headers.get('x-frame-options'), err: null };
  } catch (e) { return { status: null, xfo: null, err: e }; }
};
const errText = (e) => `${e.name}: ${e.message}${e.cause ? ' / ' + e.cause.message : ''}`;
const { status, xfo, err } = await head(base);
ok('E0: エッジが 200 で応答した', err == null && status === 200, err ? errText(err) : `HTTP ${status}`);
ok('E0: 応答がエッジの server 設定を通っている（X-Frame-Options がある）', Boolean(xfo),
   `x-frame-options: ${xfo ?? 'なし（配信コンテナ直を測っている疑い）'}`);

// E3: E0 の見分けの対照（配信コンテナ直には X-Frame-Options が無い）
const ctlRaw = process.env.RC_URL || '';
const ctl = ctlRaw && (ctlRaw.endsWith('/') ? ctlRaw : ctlRaw + '/');
if (!ctl || ctl === base) {
  ok('E3: 対照（配信コンテナ直）を取れた', false,
     `RC_URL=${ctlRaw || '未設定'}（bash run.sh 経由で走らせる。コンテナが無く公開 URL へフォールバックした場合も対照を取れない）`);
} else {
  const c = await head(ctl);
  ok('E3: 対照（配信コンテナ直）が 200 で応答した', c.err == null && c.status === 200,
     `${ctl} — ${c.err ? errText(c.err) : 'HTTP ' + c.status}`);
  ok('E3: 対照には X-Frame-Options が無い（＝E0 の印がエッジを見分ける）', c.err == null && !c.xfo,
     `x-frame-options: ${c.xfo ?? 'なし'}`);
}

// E1/E2: 本物の述語をエッジへ向けて走らせる
const child = spawnSync(process.execPath, [join(HERE, 'check_bc1_cache.mjs')], {
  env: { ...process.env, RC_URL: base }, encoding: 'utf8', timeout: 60000,
});
const out = (child.stdout || '') + (child.stderr || '');
for (const l of out.split('\n')) if (l.trim()) console.log('    │ ' + l);
const target = (out.match(/^対象: (.+)$/m) || [])[1];
ok('E2: 子（check_bc1_cache）が RC_URL＝エッジを受け取った', target === base, `子の対象: ${target ?? '（出力に無い）'}`);
ok('E1: エッジ越しの配信ヘッダが check_bc1_cache の述語をすべて満たす', child.status === 0,
   `exit=${child.status}${child.error ? ' / ' + child.error.message : ''}`);

console.log(fail === 0 ? '結果: PASS' : `結果: FAIL (${fail} 件)`);
process.exit(fail === 0 ? 0 : 1);
