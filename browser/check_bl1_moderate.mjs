// check_bl1_moderate.mjs — BL1 質問・提案の NG ワード判定（語境界化）の実ブラウザ検証 (headed Chrome on Xvfb)
// ════════════════════════════════════════════════════════════════════════════
// 受け入れ基準 (PLAN BL1) のうち **卓上ゲート (wf_bl1_ui.mjs A 章) では測れない部分** を実機で測る:
//   ① 💬 質問・提案 → タイトルと本文を入れて「GitHub に投稿する」を押す本番の経路で、アプリ自身の語彙
//      「カスタム車種を作りたい」などが **NG 拒否の表示を出さずに** 投稿画面を開く段まで進む
//   ② NG 語を含む本文では拒否の表示が出て、投稿画面は開かない
//   ③ 表示の文言は messages.js のキー (ask.msg.blocked / ask.msg.opened) どおり (ja・en)
//
// 投稿先 endpoint は叩かない: check_az1_submit.mjs ④ と同じく **ページ側の window.open だけ**を
// 「URL を記録して null を返す」実装に差し替える。差し替えるのはブラウザ API であって product ではない
// — 走るのは main.js の askSendBtn の click ハンドラと本物の判定 (moderate) そのもの (CI-8)。
//
// 是正前 (ad5ddd1・v10.3.0) は ① の「カスタム車種を作りたい」「cockpit view」「Essex のコース」が
// 「投稿できません: 不適切な可能性のある表現(カス/cock/sex)…」で止まる＝赤。
// 使い方: cd browser && bash run.sh check_bl1_moderate.mjs
import { launch, newPage, appModule, setLang } from './lib.mjs';

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };

const browser = await launch();
const { page, errors, benign } = await newPage(browser, {
  width: 1440,
  // goto より前に入れる (起動後に差し替えると main.js が先に参照を握る経路を取りこぼしうる)。
  before: (p) => p.addInitScript(() => {
    window.__bl1Opened = [];
    window.open = (url) => { window.__bl1Opened.push(String(url)); return null; };
  }),
});

// 期待文言はページが現に読み込んでいる i18n の t() に答えさせる (再実装しない)。
const texts = () => appModule(page, 'js/i18n.js', (m) => {
  const mark = '\u0001';
  const blocked = m.t('ask.msg.blocked', { word: mark });
  return { opened: m.t('ask.msg.opened'), blockedHead: blocked.split(mark)[0], blockedTail: blocked.split(mark)[1] };
});

async function send(title, body) {
  const before = await page.evaluate(() => window.__bl1Opened.length);
  await page.fill('#askTitle', title);
  await page.fill('#askBody', body);
  await page.click('#askSendBtn');
  await page.waitForTimeout(150);
  const msg = await page.evaluate(() => document.getElementById('askMsg').textContent);
  const opened = await page.evaluate((n) => window.__bl1Opened.slice(n), before);
  return { msg, opened };
}

await page.click('#helpAsk');
await page.waitForSelector('#askSendBtn', { state: 'visible', timeout: 10000 });

const NEUTRAL_BODY = 'ブレーキの効かせ方を調整したいです。';
// [タイトル, 本文] — アプリ自身の語彙と、地名・人名・語の一部に NG 語の綴りを含む文 (是正前は拒否された)。
const PASS_CASES = [
  ['カスタム車種を作りたい', NEUTRAL_BODY],
  ['cockpit view が欲しい', NEUTRAL_BODY],
  ['Essex のコースを作った', NEUTRAL_BODY],
  ['質問: die hard な設定', 'Dickens と Sussex の名前を付けたカスタム車種で differential と diesel を試した。'],
];
// [タイトル, 本文, 拒否の表示に出るはずの語]
const REJECT_CASES = [
  ['このコースについて', 'お前はカスだ。もう投稿するな。', 'カス'],
  ['about the course', 'you are an idiot, stop posting.', 'idiot'],
  // 層4 往復 2 の F1: 短い語の直後の添え字（促音・感嘆）。e2869c0 では通っていた（v10.3.0 は拒否）。
  ['このコースについて', 'お前はバカッ！もう投稿するな。', 'バカ'],
  ['リンク集を置きます', 'https://a.example/ https://b.example/ https://c.example/ https://d.example/', 'リンク過多'],
];

for (const lang of ['ja', 'en']) {
  await setLang(page, lang);
  const T = await texts();
  console.log(`\n[${lang}] 投稿ダイアログ (ask.msg.opened="${T.opened}")`);
  for (const [title, body] of PASS_CASES) {
    const r = await send(title, body);
    const blocked = r.msg.startsWith(T.blockedHead);
    ok(!blocked, `[${lang}] 通過「${title}」: NG 拒否の表示が出ない (表示="${r.msg}")`);
    ok(r.msg === T.opened, `[${lang}] 通過「${title}」: 投稿画面を開いた旨の表示 (ask.msg.opened)`);
    ok(r.opened.length === 1 && r.opened[0].startsWith('https://github.com/RumiCar-group/RumiCar/issues/new?'),
       `[${lang}] 通過「${title}」: 投稿画面の URL を 1 回開こうとした (実 ${r.opened.length} 回)`);
  }
  for (const [title, body, word] of REJECT_CASES) {
    const r = await send(title, body);
    ok(r.msg === T.blockedHead + word + T.blockedTail,
       `[${lang}] 拒否「${body.slice(0, 24)}…」: 拒否の表示に語「${word}」 (表示="${r.msg}")`);
    ok(r.opened.length === 0, `[${lang}] 拒否「${body.slice(0, 24)}…」: 投稿画面を開かない (実 ${r.opened.length} 回)`);
  }
}

ok(errors.length === 0, `JS エラー 0 件 (実測 ${errors.length}${errors.length ? ': ' + errors.join(' | ') : ''})`);
if (benign.length) console.log(`  (想定内として除外した応答 ${benign.length} 件: ${benign.slice(0, 3).join(' | ')}${benign.length > 3 ? ' …' : ''})`);
await browser.close();

const line = '─'.repeat(64);
console.log('\n' + line);
console.log('BL1 質問・提案の NG ワード判定 実ブラウザゲート');
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log(line); for (const m of fails) console.log('  ✗ ' + m); }
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
