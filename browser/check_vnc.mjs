// VNC 経路そのものを実ブラウザで検証する。
//
// パスワードなし運用(既定)で守りの主体になるのは **待受が loopback 限定であること**
// なので、それを検査の第一項目にする。「繋がった」だけを見る検査では、
// うっかり 0.0.0.0 に晒しても緑のままになってしまう。
//
// 使い方: RC_FRESH=1 bash run.sh check_vnc.mjs
//   RC_FRESH=1 は必須。:99 の noVNC を :99 のブラウザで開くと合わせ鏡になる。

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { report } from './lib.mjs';

const WEB_PORT = process.env.RC_WEB_PORT || 6080;
const VNC_PORT = process.env.RC_VNC_PORT || 5900;
const WEB = `http://127.0.0.1:${WEB_PORT}/vnc.html?autoconnect=true&reconnect=false`;
const PWFILE = process.env.HOME + '/.config/rumicar/vncpasswd';
const USE_PW = (process.env.RC_VNC_AUTH || 'none') === 'password';

let pass = 0, fail = 0;
const ok = (l, c, d) => (report(l, c, d) ? pass++ : fail++);

// ── ① 待受が loopback 限定か（設定を信じず ss で実測）──────────────────────
const listen = execSync(`ss -ltn 2>/dev/null | grep -E ':(${VNC_PORT}|${WEB_PORT})\\b' || true`)
  .toString().trim().split('\n').filter(Boolean);
const addrs = listen.map((l) => l.trim().split(/\s+/)[3]);
const exposed = addrs.filter((a) => !/^(127\.0\.0\.1|\[::1\]):/.test(a));
ok('① 待受が loopback 限定（外部に晒していない）', addrs.length > 0 && exposed.length === 0,
   addrs.length === 0 ? '待受なし＝セッション未起動' : `${addrs.join(' ')}${exposed.length ? ' ← 外部に出ている' : ''}`);

// ── ② 実ブラウザで実際に画面が出るか ────────────────────────────────────────
const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(WEB, { waitUntil: 'domcontentloaded', timeout: 30000 });

const connectBtn = page.locator('#noVNC_connect_button');
if (await connectBtn.isVisible().catch(() => false)) await connectBtn.click();

// パスワード運用のときだけ資格情報ダイアログが出る
let prompted = false;
if (USE_PW && existsSync(PWFILE)) {
  const inp = page.locator('#noVNC_password_input');
  await inp.waitFor({ state: 'visible', timeout: 15000 });
  prompted = true;
  await inp.fill(readFileSync(PWFILE, 'utf8').split('\n')[0]);
  await page.locator('#noVNC_credentials_button').click();
} else {
  prompted = await page.locator('#noVNC_password_input')
    .isVisible({ timeout: 4000 }).catch(() => false);
}

// 接続成立の判定 = フレームバッファ canvas が実寸を持ち、資格情報ダイアログが閉じていること。
//   noVNC 1.6 の canvas は **id も class も持たない**（`#noVNC_canvas` は存在しない）。
//   `#noVNC_status` は成功時にクリアされず直前の文言が残るので**判定に使わない**（表示のみ）。
let dims = null, dlgOpen = true;
for (let i = 0; i < 40; i++) {
  ({ dims, dlgOpen } = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const dlg = document.querySelector('#noVNC_credentials_dlg');
    return {
      dims: c ? { w: c.width, h: c.height } : null,
      dlgOpen: !!dlg && dlg.classList.contains('noVNC_open'),
    };
  }));
  if (dims && dims.w > 0 && dims.h > 0 && !dlgOpen) break;
  await page.waitForTimeout(500);
}
const status = (await page.locator('#noVNC_status').textContent().catch(() => '') || '').trim();
const connected = !!(dims && dims.w > 0 && dims.h > 0 && !dlgOpen);
if (connected) await page.screenshot({ path: new URL('./shots/vnc_connected.png', import.meta.url).pathname });

ok('② 実ブラウザで画面が出る', connected,
   connected ? `framebuffer ${dims.w}x${dims.h}` : `status="${status}"`);
ok(`③ 認証方式が設定どおり (${USE_PW ? 'password' : 'none'})`, prompted === USE_PW,
   prompted ? 'パスワードを要求された' : 'パスワード要求なし');

// ── ④ クリップボード共有が無効か（vnc.sh を信じず、**動いているプロセスの引数**で実測）──
//    スクリプトを直しても、直す前に起動した x11vnc が生き残っていれば共有は有効のまま。
//    見ているのが「設定ファイル」ではなく「今 5900 を持っている当のプロセス」であること。
let clipDetail = '';
let clipOff = false;
try {
  // 5900 を実際に持っているプロセスの PID を取り、その cmdline を読む。
  // ps|grep 方式は自分自身のコマンドラインを拾うので使わない。
  const pids = execSync(
    `ss -ltnp 2>/dev/null | grep -E ':${VNC_PORT}\\b' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u`
  ).toString().trim().split('\n').filter(Boolean);
  const args = pids.map((p) => {
    try { return readFileSync(`/proc/${p}/cmdline`, 'utf8').split('\0').filter(Boolean); }
    catch { return []; }
  }).filter((a) => a[0] && /x11vnc/.test(a[0]));
  if (args.length === 0) {
    clipDetail = `:${VNC_PORT} を持つ x11vnc プロセスを特定できず（未起動か権限不足）`;
  } else {
    const need = ['-nosel', '-noclipboard', '-nosetclipboard', '-noprimary', '-nosetprimary'];
    const missing = args.map((a) => need.filter((f) => !a.includes(f)));
    clipOff = missing.every((m) => m.length === 0);
    clipDetail = clipOff
      ? `${need.join(' ')} を確認（pid ${pids.join(',')}）`
      : `不足: ${[...new Set(missing.flat())].join(' ')} ← 古い引数のまま。vnc.sh stop → start`;
  }
} catch (e) {
  clipDetail = `実測できず: ${e.message}`;
}
ok('④ クリップボード共有が無効（見る側 PC と往復しない）', clipOff, clipDetail);

await browser.close();
console.log(`\n結果: PASS ${pass} / FAIL ${fail}`);
if (!USE_PW) console.log('※ パスワードなし運用。安全性の根拠は ① の loopback 束縛と SSH 認証。');
console.log('※ VNC は常設しない運用。見終わったら bash vnc.sh stop で落とすこと。');
process.exit(fail === 0 ? 0 : 1);
