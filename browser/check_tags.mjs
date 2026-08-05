// RumiCar Simulator — 「目視必須札」の機械化ゲート（Stage AS / AS1）
//
// 目的（CI-14）: これまで「人が見るしかない」として札で残してきた事項のうち、
//   実ブラウザでなら測定述語に翻訳できるものを常設チェックへ移す。
//   **札の数が減ること自体を、検証境界が前へ動いた証拠として扱う。**
//   翻訳しきれない「人にどう映るか」だけを札として残す（棚卸し表＝docs/stage_as/AS1_visual_tags.md）。
//
// 測るもの（左が札ID・正本は AP1_audit §5 と PROGRESS の各 Stage 決定ログ）:
//   T1  AR2札(b) 旧コース名の共有 URL を開いたときの通知が実画面に出る（ja/en＋対照）
//   T2  札(f)    HUD「(当時 vX)」注記がパネル幅からはみ出さない（重なりの幾何マージン）
//   T3  札(l)    プログラム選択のグルーピング表示（optgroup 構造・ja/en）
//   T4  札(k)    抽出後ダイアログの操作系（開く→本文→閉じる が実画面で成立）
//   T5  札(b)    長文ドキュメントが切れずに表示され末尾まで到達できる
//   T6  札(e)    実描画込みのフレーム間隔（headless では描画が無く測れなかった量）
//
// 使い方: bash run.sh check_tags.mjs
// 終了コード: 0=全項目 PASS / 1=いずれか FAIL
//
// 設計上の約束:
//   - 述語は再実装しない。配信中のモジュール（i18n.js / config.js / programs.js）に答えさせる（CI-9）。
//   - 触るのは利用者と同じ UI 要素だけ。検査用の抜け道を作らない（CI-8）。
//   - 二値でなく連続量マージンを出す。除外したものは件数を必ず表示する（沈黙截断の禁止）。

import { launch, newPage, appModule, report, APP_URL } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const ok = (label, cond, detail) => (report(label, cond, detail) ? pass++ : fail++);

// AR2（2026-08-02）で改名される前の実コース名。git 履歴 93f7a37^ の courses.json から採取した実物で、
// 「現レジストリで解決できない名前」の代表として使う（作り物の名前では札の再現にならない）。
const OLD_NAMES = [
  '鈴鹿・レイアウト', 'モナコ・レイアウト', 'モンツァ・レイアウト',
  'ザントフォールト・レイアウト', 'インディオーバル風',
];
const NEW_NAME = 'エッセ・レイアウト';   // 対照: 現存する名前は復元されるべき

const browser = await launch();
console.log(`\n== 目視必須札の機械化ゲート (headed Chrome on Xvfb) ==\n対象: ${APP_URL}\n`);

// ─────────────────────────────────────────────────────────────────────────────
// T1 — AR2札(b): 旧コース名の共有 URL を開いたときの通知（実画面）
//   AR2 では本番モジュール（decodeState/loadPresets/t）までは機械確認したが、
//   「実ブラウザで通知が現に画面に出ること」だけが札として残っていた。ここで解消する。
// ─────────────────────────────────────────────────────────────────────────────
console.log('T1 旧コース名の共有 URL の通知（AR2 札(b)）');
{
  const missed = [], noMsg = [];
  for (const lang of ['ja', 'en']) {
    for (const name of OLD_NAMES) {
      const hash = `#v=1&lg=${lang}&c=${encodeURIComponent(name)}`;
      const { page: p } = await newPage(browser, { width: 1280, height: 860, path: hash });
      // 期待文字列は再実装せず、ページが読んでいる i18n に {name} 差し込み込みで作らせる
      const expect = await p.evaluate(
        ([n]) => import(new URL('js/i18n.js', location.href).href)
          .then((m) => m.t('log.share.course.missing', { name: n })), [name]);
      const logText = await p.locator('#log').textContent() ?? '';
      const shown = logText.includes(expect);
      // 通知が出たうえで「別コースで開始している」こと（無言失敗でも、固まりでもない）
      const sel = await p.locator('#courseSel').inputValue();
      if (!shown) noMsg.push(`${lang}/${name}`);
      if (sel === name) missed.push(`${lang}/${name}=未解決名のまま`);
      if (lang === 'ja' && name === OLD_NAMES[1])
        await p.screenshot({ path: SHOTS + 'tag_share_missing_ja.png' });
      await p.close();
    }
  }
  ok('T1a 旧名10通り(ja/en×5) で通知が実画面に出る', noMsg.length === 0,
     noMsg.length ? `欠落: ${noMsg.join(', ')}` : '10/10 で {name} 差し込み込みの本文を #log に確認');
  ok('T1b 通知後に別コースで開始している', missed.length === 0,
     missed.length ? missed.join(', ') : '10/10 で未解決名を選択したままではない');

  // 対照: 現存する名前は通知を出さずに復元される（「常に通知が出る」壊れ方を検出するため）
  const { page: p2 } = await newPage(browser, {
    width: 1280, height: 860, path: `#v=1&c=${encodeURIComponent(NEW_NAME)}` });
  const log2 = await p2.locator('#log').textContent() ?? '';
  const sel2 = await p2.locator('#courseSel').inputValue();
  await p2.close();
  ok('T1c 対照: 現存名は通知なしで復元される', sel2 === NEW_NAME && !/見つかりません/.test(log2),
     `選択="${sel2}" 通知=${/見つかりません/.test(log2) ? 'あり(異常)' : 'なし'}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// T2 — 札(f): HUD「(当時 vX)」注記の重なり（AP2）
//   「重なる」= 注記がパネルの内幅を超えて外へ出ること。幾何で決まるので測れる。
//   hud.js の実際の寸法定数に依存するため、**定数が変わっていないことも同時に検査**する
//   （変わったのに検査だけ生き残ると、緑のまま無意味になるため）。
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nT2 HUD「(当時 vX)」注記の収まり（札(f)）');
{
  const { page: p } = await newPage(browser, { width: 1440, height: 900 });
  // 幾何を検査側で組み直さない。**本番の drawFleetHud を実際に呼び**、その描画呼び出しを
  // 記録する Proxy で「実際に置かれた座標」を読む（CI-9 / oracle_inventory の型）。
  const probe = async (lang, archived, canvasW) => p.evaluate(async ([lg, arch, cw]) => {
    const [hud, i18n, cfg] = await Promise.all(['js/hud.js', 'js/i18n.js', 'js/config.js']
      .map((s) => import(new URL(s, location.href).href)));
    i18n.setLang(lg);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = 700;
    const ctx = cv.getContext('2d');
    const texts = [], rects = [];
    const rec = new Proxy(ctx, {
      get(tg, k) {
        const v = tg[k];
        if (typeof v !== 'function') return v;
        return (...a) => {
          if (k === 'fillText') texts.push({ s: a[0], x: a[1], font: tg.font });
          if (k === 'strokeRect') rects.push(a);
          return v.apply(tg, a);
        };
      },
      set(tg, k, v) { tg[k] = v; return true; },
    });
    const slot = {
      name: 'CAR1', color: '#6cf', running: true, car: { crashed: false },
      lap: { laps: 3, lapTime: 4.2, bestLap: 3.9, improved: false,
             bestRec: arch ? { ver: 'v0.0.1' } : { ver: cfg.APP_VERSION } },
    };
    hud.drawFleetHud(rec, [slot, { ...slot, name: 'CAR2' }], { wPx: cw }, 0);
    const noteStr = i18n.t('hud.lb.note');
    const drawn = texts.filter((e) => e.s.startsWith(noteStr)).pop();
    const panel = rects[rects.length - 1];               // strokeRect(x0,y0,w,h)
    if (!drawn || !panel) return null;
    ctx.font = drawn.font;
    const wTxt = ctx.measureText(drawn.s).width;
    i18n.setLang('ja');
    // 是正後のパネルが人にどう見えるかは機械化しない残り。判断材料として画像を残す。
    const crop = document.createElement('canvas');
    crop.width = Math.ceil(panel[2]) + 24; crop.height = Math.ceil(panel[3]) + 24;
    crop.getContext('2d').drawImage(cv, panel[0] - 12, panel[1] - 12, crop.width, crop.height,
                                    0, 0, crop.width, crop.height);
    return { note: drawn.s, font: drawn.font, x: drawn.x, wTxt,
             x0: panel[0], w: panel[2], canvasW: cw, png: crop.toDataURL('image/png') };
  }, [lang, archived, canvasW]);

  for (const [lang, arch, cw, tag] of [
    ['ja', true, 1245, 'ja・旧版記録あり'], ['en', true, 1245, 'en・旧版記録あり'],
    ['en', false, 1245, 'en・注記なし'],    ['en', true, 380, 'en・狭い画面(380px)'],
  ]) {
    const r = await probe(lang, arch, cw);
    if (!r) { ok(`T2 ${tag}`, false, 'drawFleetHud の描画呼び出しを捕捉できず'); continue; }
    writeFileSync(SHOTS + `tag_hud_${lang}_${arch ? 'archived' : 'plain'}_${cw}.png`,
                  Buffer.from(r.png.split(',')[1], 'base64'));
    const end = r.x + r.wTxt;                        // 注記の実描画終端
    const inPanel = end <= r.x0 + r.w - (r.x - r.x0);// 左パディングと同じ余白を右にも要求
    const inCanvas = r.x0 >= 0 && r.x0 + r.w <= r.canvasW && end <= r.canvasW;
    ok(`T2 ${tag}: 注記がパネル内・canvas 内に収まる`, inPanel && inCanvas,
       `パネル x0=${r.x0.toFixed(0)} w=${r.w.toFixed(0)} / 注記 ${r.wTxt.toFixed(1)}px(${r.font})` +
       ` 終端 ${end.toFixed(1)} ≤ 枠内 ${(r.x0 + r.w - (r.x - r.x0)).toFixed(1)}` +
       `（余裕 ${(r.x0 + r.w - (r.x - r.x0) - end).toFixed(1)}px・canvas ${r.canvasW}）`);
  }
  await p.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// T3 — 札(l): プログラム選択のグルーピング表示（AP27）
//   「グルーピングが見えているか」= optgroup が現に組まれ、どのプログラムも
//   いずれかの群に属し、空の群が出ていないか。ja/en で群名が翻訳されているか。
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nT3 プログラム選択のグルーピング（札(l)）');
{
  const { page: p } = await newPage(browser, { width: 1440, height: 900 });
  const progKeys = await appModule(p, 'js/programs.js', (m) => m.PROGRAMS.map((x) => x.key));
  const snap = async () => p.evaluate(() => {
    const sel = document.querySelector('.cc-program');
    if (!sel) return null;
    const groups = [...sel.querySelectorAll('optgroup')]
      .map((g) => ({ label: g.label, n: g.querySelectorAll('option').length }));
    return { groups, inGroup: [...sel.querySelectorAll('optgroup > option')].map((o) => o.value),
             loose: [...sel.querySelectorAll(':scope > option')].map((o) => o.value) };
  });
  const ja = await snap();
  await p.selectOption('#langSel', 'en'); await p.waitForTimeout(500);
  const en = await snap();
  await p.selectOption('#langSel', 'ja'); await p.waitForTimeout(500);
  await p.close();

  ok('T3a グルーピングが実在し空の群が無い', !!ja && ja.groups.length >= 3 && ja.groups.every((g) => g.n > 0),
     ja ? ja.groups.map((g) => `${g.label}:${g.n}`).join(' / ') : 'select 不在');
  // 群外に出るのは main.js:870-871 が意図して置く 'generic'（プログラムなし）と
  // 'custom'（自作コード・hidden）の2つだけ。PROGRAMS は全数がいずれかの群に入るべき。
  const missing = ja ? progKeys.filter((k) => !ja.inGroup.includes(k)) : progKeys;
  const unexpected = ja ? ja.loose.filter((v) => v !== 'generic' && v !== 'custom') : ['-'];
  ok('T3b PROGRAMS 全数が群に属し、群外は設計上の2つのみ',
     missing.length === 0 && unexpected.length === 0,
     `群内 ${ja ? ja.inGroup.length : 0}/${progKeys.length}・群外 [${ja ? ja.loose.join(',') : ''}]` +
     `${missing.length ? ' 欠落:' + missing.join(',') : ''}${unexpected.length ? ' 想定外:' + unexpected.join(',') : ''}`);
  ok('T3c 群名が en で翻訳される', !!en && en.groups.length === ja.groups.length &&
     en.groups.every((g, i) => g.label && g.label !== ja.groups[i].label),
     en ? en.groups.map((g) => g.label).join(' / ') : '-');
}

// ─────────────────────────────────────────────────────────────────────────────
// T4/T5 — 札(k) 抽出後ダイアログの操作系 ／ 札(b) 長文が切れずに出るか
//   AP23 で main.js から抽出したドメイン（公式レース UI）と、長文ドキュメント群を
//   本番の入口ボタンからだけ操作して、開く→本文が出る→末尾まで辿れる→閉じる を測る。
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nT4/T5 ダイアログの操作系と長文表示（札(k)・札(b)）');
{
  const DIALOGS = [
    ['helpUsage',    'dlgUsage',     'doc'],   // 使い方（長文）
    ['helpRace',     'dlgRaceGuide', 'doc'],   // レースガイド（長文）
    ['helpSpec',     'dlgSpec',      'doc'],   // 仕様・制限（長文・§13 システム仕様）
    ['helpPhysics',  'dlgPhysics',   'doc'],   // 物理モデル解説（長文）
    ['helpCars',     'dlgCars',      'doc'],   // 車種パラメータ
    ['eventOpen',    'dlgEvent',     'ui'],    // 開催（AP23 抽出域）
    ['officialOpen', 'dlgOfficial',  'ui'],    // 公式レース（AP23 抽出域）
    ['rankOpen',     'dlgRankings',  'ui'],    // ランキング（AP23 抽出域）
  ];
  const { page: p, errors, benign } = await newPage(browser, { width: 1280, height: 860 });
  const bad = [], thin = [], overflow = [], tail = [];
  for (const [btn, dlg, kind] of DIALOGS) {
    await p.click('#' + btn);
    await p.waitForTimeout(600);
    const st = await p.evaluate(([id]) => {
      const d = document.getElementById(id);
      if (!d || !d.open) return { open: false };
      const body = d.querySelector('.docdlg-body');
      const r = d.getBoundingClientRect();
      return {
        open: true,
        text: (body?.innerText ?? '').trim().length,
        scrollH: d.scrollHeight, clientH: d.clientHeight,
        outX: Math.max(0, Math.round(r.right - document.documentElement.clientWidth)) +
              Math.max(0, Math.round(-r.left)),
      };
    }, [dlg]);
    if (!st.open) { bad.push(`${dlg}:開かない`); continue; }
    if (st.text < 40) thin.push(`${dlg}:本文${st.text}字`);
    if (st.outX > 0) overflow.push(`${dlg}:+${st.outX}px`);
    // 長文は末尾まで到達できること（スクロール不能なまま切れている壊れ方を検出）
    if (kind === 'doc') {
      const reached = await p.evaluate(([id]) => {
        const d = document.getElementById(id);
        if (d.scrollHeight <= d.clientHeight + 1) return true;  // そもそも収まっている
        d.scrollTop = d.scrollHeight;
        return d.scrollTop + d.clientHeight >= d.scrollHeight - 2;
      }, [dlg]);
      if (!reached) tail.push(dlg);
    }
    if (dlg === 'dlgRaceGuide') await p.screenshot({ path: SHOTS + 'tag_dialog_raceguide.png' });
    await p.click(`.docdlg-x[data-close="${dlg}"]`);
    await p.waitForTimeout(300);
    const closed = await p.evaluate(([id]) => !document.getElementById(id).open, [dlg]);
    if (!closed) bad.push(`${dlg}:閉じない`);
  }
  ok(`T4a ${DIALOGS.length} ダイアログが開いて閉じる`, bad.length === 0, bad.length ? bad.join(' ') : '全て open→close');
  ok('T4b 本文が非空', thin.length === 0, thin.length ? thin.join(' ') : '全て 40字以上');
  ok('T4c 画面外へはみ出さない', overflow.length === 0, overflow.length ? overflow.join(' ') : '全て 0px');
  ok('T5  長文が末尾まで到達できる', tail.length === 0, tail.length ? tail.join(' ') : '5 ドキュメント全て到達');
  ok('T4d 操作中に pageerror / console error 0', errors.length === 0,
     errors.length ? errors.slice(0, 3).join(' | ') : `想定内として除外 ${benign.length} 件`);
  await p.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// T6 — 札(e): 実描画込みのフレーム間隔
//   この札の理由は「headless には描画が無いので測れない」だった。headed なら測れる。
//   ただし Xvfb + ソフトウェア描画（SwiftShader）は実機 GPU より不利なので、
//   ここで出る値は**悲観側の下限**として扱う（体感そのものは札に残す）。
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nT6 実描画込みのフレーム間隔（札(e)）');
{
  const { page: p, errors } = await newPage(browser, {
    width: 1440, height: 900, path: '#v=1&c=' + encodeURIComponent('オーバル') });
  await p.click('#run');
  await p.waitForTimeout(1500);                       // 立ち上がりは測らない
  const s = await p.evaluate(() => new Promise((res) => {
    const d = []; let prev = performance.now(); const t0 = prev;
    const tick = (now) => {
      d.push(now - prev); prev = now;
      if (now - t0 < 5000) requestAnimationFrame(tick);
      else { d.sort((a, b) => a - b);
        res({ n: d.length, med: d[d.length >> 1], p95: d[Math.floor(d.length * 0.95)],
              max: d[d.length - 1], longRatio: d.filter((x) => x > 33.4).length / d.length }); }
    };
    requestAnimationFrame(tick);
  }));
  await p.click('#stop');
  const spd = (await p.locator('#spd').textContent() ?? '').trim();
  await p.close();
  const det = `N=${s.n} 中央値 ${s.med.toFixed(1)}ms / p95 ${s.p95.toFixed(1)}ms / 最悪 ${s.max.toFixed(1)}ms` +
              ` / 33.4ms 超 ${(s.longRatio * 100).toFixed(1)}%（走行中・速度 ${spd}）`;
  ok('T6a 走行中フレーム間隔 中央値 ≤ 25ms', s.med <= 25, det);
  ok('T6b 長フレーム(>33.4ms) 比率 ≤ 20%', s.longRatio <= 0.20,
     'Xvfb+SwiftShader ゆえ実機 GPU より悲観側＝下限保証として読む');
  ok('T6c 走行中に pageerror / console error 0', errors.length === 0,
     errors.length ? errors.slice(0, 3).join(' | ') : '0 件');
}

await browser.close();
console.log(`\n結果: PASS ${pass} / FAIL ${fail}   スクリーンショット: browser/shots/`);
console.log('残す札（機械化しない）は docs/stage_as/AS1_visual_tags.md の棚卸し表を参照。');
process.exit(fail === 0 ? 0 : 1);
