// RumiCar Simulator — 実ブラウザ(非ヘッドレス)検証ハーネス 共有部
//
// ══════════════════════════════════════════════════════════════════════════════
// なぜ「ヘッドレスでない」のか（この選択の理由をここに固定する）
//   Chrome の「ヘッドレス」には3層あり、見落とすのは①である。
//     ① chrome-headless-shell … 機能を削った別バイナリ。Playwright の headless:true の既定。
//     ② chrome --headless=new  … フルバイナリの無画面モード。Blink/V8 は headed と同一経路。
//     ③ headed + Xvfb         … 実ウィンドウ・実コンポジタ。差はほぼ無い。
//   本アプリは canvas 描画・requestAnimationFrame 前提の物理ループ・WebGL(elev3d.js)・
//   CSS @container(fleet-cols) に依存するため ③ を採る。
//   → 起動は必ず run.sh (xvfb-run) 経由。DISPLAY が無いと launch は失敗する。
//
// なぜこのディレクトリが独立しているのか
//   `wf_*.mjs` の常設ゲート群は「node_modules 不要」であることがフレッシュクローン検証の
//   前提になっている(REBUILD.md 経路)。ブラウザ依存をそこへ持ち込まないよう、
//   Playwright を使う検証だけを本ディレクトリに隔離する。node_modules は git 無視済み。
//
// 検証の書き方（docs/oracle_inventory.md の「使い方の型」に従う）
//   述語は再実装せず、ページが現に読み込んでいるモジュールを import して本物に答えさせる。
//   例: await appModule(page, 'config.js') → 配信中の config.js の APP_VERSION をそのまま得る。
// ══════════════════════════════════════════════════════════════════════════════

import { chromium } from 'playwright';

/** 検証対象の配信元。run.sh が docker から解決して渡す。 */
export const APP_URL = process.env.RC_URL || 'https://www.rumicar.com/simulator/';

/**
 * 「異常ではない」と分類してよい HTTP 応答。**素性が言えるものだけ**をここに書く
 * (状態コードだけで判断しない。URL とセットで初めて意味が決まる)。
 *   - 上流に `races/` `cars/` ディレクトリが無いのは正常状態。アプリは通知して継続する。
 *   - GitHub 未認証 API は **60回/時**の制限があり、超過すると 403 を返す。
 *     REBUILD.md:35 が「本体動作には影響しない」と明記する既知の挙動。
 *     ※ 検証を短時間に繰り返すと**検証者自身が使い切る**ので、ここに出たら回数を疑う。
 * 除外したものは捨てずに `benign` へ積み、件数を必ず表示する（沈黙截断の禁止）。
 */
export function classify(status, url) {
  if (status === 404 && /\/(races|cars)\//.test(url)) return 'benign:未シードのディレクトリ';
  if ((status === 403 || status === 429) && /api\.github\.com/.test(url))
    return 'benign:GitHub 未認証APIレート制限(60回/時)';
  if (status === 404 && /githubusercontent|api\.github\.com/.test(url))
    return 'benign:上流に未配置';
  return null;
}

/**
 * headed Chrome を Xvfb 上で起動する。--no-sandbox はコンテナ/CI 相当環境のため。
 * opts.slowMo = 各操作の間に入れる待ち(ms)。VNC で人が見ているときに使う
 *   (機械にとっては不要だが、人が追えない速さで動かしても「見せる」目的を果たさない)。
 */
export async function launch({ slowMo = Number(process.env.RC_SLOWMO || 0) } = {}) {
  if (!process.env.DISPLAY) {
    throw new Error(
      'DISPLAY が空です。headed 起動には仮想ディスプレイが要ります。' +
      ' bash run.sh <script.mjs> の形で起動してください。'
    );
  }
  return chromium.launch({ headless: false, args: ['--no-sandbox'], slowMo });
}

/**
 * 計装済みページを開く。console error / pageerror / requestfailed を最初から拾う
 * (goto の前に配線しないと起動時のエラーを取りこぼす)。
 * 返り値の errors/benign は配列参照なので、操作後に読めば累積が見える。
 */
export async function newPage(browser, { width = 1440, height = 900, path = '' } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];   // 異常とみなすもの
  const benign = [];   // 想定内として除外したもの（沈黙截断しないため保持）

  // HTTP の失敗は response で拾う。console の "Failed to load resource" は URL を持たず
  // 素性が言えない（＝分類できない）ので、重複として捨て、こちらを単一の真実源にする。
  page.on('response', (r) => {
    const s = r.status();
    if (s < 400) return;
    const url = r.url();
    const why = classify(s, url);
    (why ? benign : errors).push(`http ${s} ${url}${why ? ` [${why}]` : ''}`);
  });
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(t)) return; // 上の response が同じ事象を URL 付きで持つ
    errors.push(`console: ${t}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`)); // JS 例外は常に異常
  page.on('requestfailed', (r) =>
    errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));

  const url = new URL(path, APP_URL.endsWith('/') ? APP_URL : APP_URL + '/').href;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1200); // 起動ローダー(Stage AA)がコース描画を終えるまで
  return { page, errors, benign, url };
}

/**
 * 配信中の ES モジュールを、ページと同一 URL・同一インスタンスで評価する。
 * 再実装せず本物に答えさせるための口 (CI-9 / oracle_inventory.md)。
 *   const ver = await appModule(page, 'js/config.js', (m) => m.APP_VERSION);
 */
export async function appModule(page, spec, pick) {
  const fn = pick ? pick.toString() : '(m) => m';
  return page.evaluate(
    ([s, f]) => import(new URL(s, location.href).href).then(eval(`(${f})`)),
    [spec, fn]
  );
}

/** 言語を切り替える (本番 UI の経路をそのまま使う)。lang = 'ja' | 'en' (index.html の option value)。 */
export async function setLang(page, lang) {
  await page.selectOption('#langSel', lang);
  await page.waitForTimeout(400);
}

/** 横方向のはみ出し量(px)。0 が正常。UI-FIX-1 の回帰監視用。 */
export async function overflowX(page, width) {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  return Math.max(0, sw - width);
}

/** 結果表示のごく薄いヘルパ。合否は呼び出し側が決める。 */
export function report(label, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ' — ' + detail : ''}`);
  return ok;
}
