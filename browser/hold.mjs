// アプリを開いたまま保持する。VNC で人が見て、実際に触るためのもの。
//
//   bash vnc.sh start
//   bash run.sh hold.mjs &        # 既定 30 分で自動終了 (放置しても残らない)
//   RC_HOLD_MIN=120 bash run.sh hold.mjs &
//
// 検証スクリプトと違い「測って終わる」ことをしない。人の目と手のための窓。
// Xvfb 上にウィンドウマネージャは無いので、ブラウザ窓は画面いっぱいに開く。

import { launch, newPage, APP_URL } from './lib.mjs';

const MIN = Number(process.env.RC_HOLD_MIN || 30);
const [w, h] = (process.env.RC_SCREEN || '1440x900x24').split('x').map(Number);

const browser = await launch();
const { page, errors, benign } = await newPage(browser, { width: w, height: h });

console.log(`開いたまま保持します: ${APP_URL}`);
console.log(`  画面 ${w}x${h} / ${MIN} 分後に自動終了 (先に閉じるなら Ctrl-C)`);
console.log(`  起動時のエラー ${errors.length} 件 / 想定内として除外 ${benign.length} 件`);
errors.forEach((e) => console.log('   ! ' + e));

const close = async () => { try { await browser.close(); } catch {} process.exit(0); };
process.on('SIGINT', close);
process.on('SIGTERM', close);
setTimeout(close, MIN * 60_000);

// ページが閉じられたら(人が操作して閉じた等)そこで終わる
page.on('close', close);
