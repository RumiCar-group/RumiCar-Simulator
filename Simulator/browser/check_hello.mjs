// 最小の生存確認。移設先で「そもそも headed ブラウザが動くか」を最初に測る。
import { launch, newPage, APP_URL } from './lib.mjs';
const browser = await launch();
const { page, errors, benign } = await newPage(browser, { width: 1280, height: 800 });
console.log('対象       :', APP_URL);
console.log('title      :', await page.title());
console.log('UA         :', await page.evaluate(() => navigator.userAgent));
console.log('webdriver  :', await page.evaluate(() => navigator.webdriver));
console.log('WebGL      :', await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl');
  return gl ? gl.getParameter(gl.VERSION) : '利用不可';
}));
console.log('errors     :', errors.length, '/ 想定内除外', benign.length);
await page.screenshot({ path: 'shots/hello.png' });
await browser.close();
