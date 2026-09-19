// check_bc6_hudband.mjs — 計器パネルの帯 (#hudBand) を実ブラウザで product の描画呼び出しから測る (BC6)。
// ════════════════════════════════════════════════════════════════════════════
// なぜ要るか: 狭い画面 (スマホ幅) では、読める大きさ (文字 ≥10 CSS px) を保った HUD がコース表示域の
//   34〜79% を覆い、表示高さの低い横長コースでは下端が切れていた (BC6 の改修前実測・出荷 66＋投稿 ×
//   390/320 幅)。BC6 は「メーターと順位表が横に並ばない幅」では HUD をコースの上ではなくコースの下の
//   帯 (#hudBand) へ描くようにした。このゲートはその性質を毎回測る。
//
// 測るもの (見た目で判定しない・CI-14。量はすべて CSS px へ正規化する＝BC-8①):
//   狭い画面 {390×844, 320×568} × 出荷の全プリセット + 上流の投稿コース:
//     B1 コースキャンバスに HUD 部品 (メーター/タイヤ/順位表) が **1 つも描かれない** (被覆率 0)
//     B2 帯が展開され、3 部品すべてが**帯に**描かれる (欠けが無い＝HUD を失っていない)
//     B3 帯に描かれた文字の箱が帯の中に収まる (はみ出し 0)
//     B4 帯の文字の表示高さの最小 ≥ 10 CSS px (BB3 H1 と同じ基準・帯でも守る)
//     B5 帯の中で 3 部品が互いに重ならない
//     B6 帯の表示幅がコースキャンバスの表示幅と一致する (順位表は右詰めなので、ずれると右端が揃わない)
//     B7 帯の高さが HUD の下端 + 余白 ちょうど (余白 ≤ 13 CSS px)。必要以上に縦を食わない
//     B9 追従 ON にするとミニマップが出る (コース面が空いた＝BC6 の狙いの 3 つ目)
//   広い画面 {1440×900, 1920×1080}: B8 **既定の表示 (ja・1 台・既定装備)** では帯は畳まれたまま・HUD は
//     従来どおりコースに描かれる＝改修前と画素一致する。⚠ 判定はウィンドウ幅ではなく**コースキャンバスの
//     表示寸法**なので、.side と幅を分け合った結果 1440px のウィンドウでも表示幅は 539〜612 CSS px しかない。
//     英語 UI ＋装備の注記で順位表が広がる変種では 1440 で 11/68 コースが帯へ出る (1920 は 0/68・実測)。
//     それは「入らないなら帯」という設計どおりの帰結なので、変種の置き場所は check_bb3_hud.mjs の V が
//     「どちらに描かれても基準 (はみ出し 0・重なり 0・文字 ≥10px) を満たす」形で受け持つ。
//   B13 devicePixelRatio > 1 の端末でも帯の文字が CSS px で同じ大きさ・同じ基準を満たす (backing store が DPR 倍)
//   B10 編集モードでは帯が畳まれる (編集中は HUD 自体を描かない)
//   B11 横はみ出し 0 / E JS・HTTP エラー 0
//   ℹ ミニマップが出る画面幅の下限を走査して表示する (受け入れ基準の記録用・ゲートは 320 幅の全セル)
//
// 使い方: bash run.sh check_bc6_hudband.mjs   (RC_BC6_ONLY=<数>・RC_BC6_MATCH=<正規表現> は試走用)
import { launch, newPage, setLang, appModule, overflowX } from './lib.mjs';

const NARROW = [[390, 844], [320, 568]];
const WIDE = [[1440, 900], [1920, 1080]];
const TEXT_MIN = 10, EPS = 0.01;
const BAND_SLACK = 13;    // 帯の下端余白の上限 [CSS px] (layoutHud が取る余白 12 ＋ 切り上げ 1)
const SCAN = [280, 300, 320, 360, 390, 414, 480, 540, 600, 700, 820, 1000];   // ミニマップの下限走査

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m); } };

const browser = await launch();
const cells = [];
try {
  const { page, errors, benign } = await newPage(browser, {
    before: async (p) => {
      await p.addInitScript(() => {
        try { localStorage.setItem('rumicar.lang', 'ja'); } catch (e) {}
        try { localStorage.removeItem('rumicar.follow'); } catch (e) {}
        // 観測だけ: コースと帯への描画呼び出しを記録し、描画は product のまま (BB3/BB4 と同じ計装)。
        window.__bc6 = null;
        const P = CanvasRenderingContext2D.prototype;
        const whoOf = () => (/at (draw[A-Za-z]+)/.exec(new Error().stack.split('\n').slice(3).join('\n')) || [])[1] || '?';
        const box = (T, pts) => {
          const q = pts.map(([u, v]) => [T.a * u + T.c * v + T.e, T.b * u + T.d * v + T.f]);
          return { x0: Math.min(...q.map((z) => z[0])), y0: Math.min(...q.map((z) => z[1])), x1: Math.max(...q.map((z) => z[0])), y1: Math.max(...q.map((z) => z[1])) };
        };
        const on = (c) => window.__bc6 && c.canvas && (c.canvas.id === 'course' || c.canvas.id === 'hudBand');
        const wrap = (name, fn) => {
          const orig = P[name];
          P[name] = function (...a) {
            if (on(this)) { try { fn.call(this, this.getTransform(), whoOf(), ...a); } catch (e) { window.__bc6.push({ kind: 'spyErr', e: String(e) }); } }
            return orig.apply(this, a);
          };
        };
        wrap('fillText', function (T, who, txt, x, y) {
          const m = /(\d+(?:\.\d+)?)px/.exec(this.font), px = m ? +m[1] : NaN, w = this.measureText(txt).width;
          window.__bc6.push({ kind: 'text', cv: this.canvas.id, who, px, sx: Math.hypot(T.a, T.b), sy: Math.hypot(T.c, T.d),
            text: String(txt).slice(0, 60), ...box(T, [[x, y - px], [x + w, y - px], [x, y], [x + w, y]]) });
        });
        for (const name of ['fillRect', 'strokeRect']) wrap(name, function (T, who, x, y, w, h) {
          window.__bc6.push({ kind: 'rect', call: name, cv: this.canvas.id, who, ...box(T, [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) });
        });
      });
    },
  });
  await setLang(page, 'ja');
  // 物理 v2 = タイヤ HUD が出る＝HUD の種類が最大 (BB3 と同じ条件)。距離ラベル ON。
  await page.selectOption('#optPhysMode', 'v2');
  await page.evaluate(() => { const c = document.getElementById('optLabels'); if (c && !c.checked) c.click(); });
  await page.waitForFunction(() => [...document.querySelectorAll('#courseSel option')].some((o) => o.value.startsWith('gh:')), null, { timeout: 30000 }).catch(() => {});
  const allOpts = await page.evaluate(() => [...document.querySelectorAll('#courseSel option')]
    .filter((o) => !o.textContent.startsWith('★ ')).map((o) => o.value));
  const presetN = await appModule(page, 'js/course.js', (m) => m.PRESETS.length);
  const ghN = allOpts.filter((v) => v.startsWith('gh:')).length;
  const only = Number(process.env.RC_BC6_ONLY || 0);
  const match = process.env.RC_BC6_MATCH ? new RegExp(process.env.RC_BC6_MATCH) : null;
  const opts = (match ? allOpts.filter((v) => match.test(v)) : allOpts).slice(0, only > 0 ? only : undefined);
  ok(presetN > 0 && ghN > 0 && allOpts.length === presetN + ghN && opts.length === allOpts.length,
    `B0 母集団: プリセット ${presetN} + 投稿 ${ghN} = ${allOpts.length} コース × 狭い画面 ${NARROW.length}${opts.length !== allOpts.length ? ` (試走指定で ${opts.length} だけ＝常設の判定にならない)` : ''}`);

  // 1 フレームぶんの描画呼び出しから、帯とコースそれぞれの量を返す。
  const measure = () => page.evaluate(async () => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    const cv = document.getElementById('course'), bd = document.getElementById('hudBand');
    await raf(); window.__bc6 = []; await raf(); await raf();
    const all = window.__bc6; window.__bc6 = null;
    const bandOn = !!(bd && !bd.hidden);
    const rc = cv.getBoundingClientRect(), rb = bandOn ? bd.getBoundingClientRect() : null;
    const SC = {
      course: { kx: rc.width / cv.width, ky: rc.height / cv.height, w: rc.width, h: rc.height },
      hudBand: bandOn ? { kx: rb.width / bd.width, ky: rb.height / bd.height, w: rb.width, h: rb.height } : null,
    };
    const sc = (r) => SC[r.cv] || SC.course;
    const HUD = ['drawMeters', 'drawTireHud', 'drawFleetHud'];
    // 部品の外接矩形 (描かれたキャンバスの縮尺で CSS px へ)
    const parts = {};
    for (const r of all) {
      if (!HUD.includes(r.who) || !(r.kind === 'text' || r.kind === 'rect')) continue;
      const S = sc(r);
      const b = parts[r.who] ||= { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9, cv: r.cv };
      b.x0 = Math.min(b.x0, r.x0 * S.kx); b.y0 = Math.min(b.y0, r.y0 * S.ky);
      b.x1 = Math.max(b.x1, r.x1 * S.kx); b.y1 = Math.max(b.y1, r.y1 * S.ky);
    }
    const names = Object.keys(parts), overlaps = [];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const A = parts[names[i]], B = parts[names[j]];
      if (A.cv !== B.cv) continue;
      const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
      if (ox > 0.5 && oy > 0.5) overlaps.push(`${names[i]}×${names[j]}:${ox.toFixed(0)}×${oy.toFixed(0)}`);
    }
    // コース面が HUD に覆われる面積 (部品は互いに重ならないので和で足りる)
    let courseCover = 0, bandBottom = 0;
    for (const k of names) {
      const b = parts[k];
      if (b.cv === 'course') courseCover += Math.max(0, Math.min(b.x1, rc.width) - Math.max(b.x0, 0)) * Math.max(0, Math.min(b.y1, rc.height) - Math.max(b.y0, 0));
      else bandBottom = Math.max(bandBottom, b.y1);
    }
    // 文字: 描かれたキャンバスごとに表示高さとはみ出しを測る
    const txt = all.filter((r) => r.kind === 'text' && r.who !== 'drawSensors');
    // はみ出しは辺ごとに量を出す (「はみ出した/しない」の 2 値では、どの辺がどれだけ足りないのかが分からず、
    // 既知の限界と新しい退行を区別できない)。
    const ovr = (r) => { const S = sc(r); return { l: Math.max(0, -(r.x0 * S.kx)), r: Math.max(0, r.x1 * S.kx - S.w), t: Math.max(0, -(r.y0 * S.ky)), b: Math.max(0, r.y1 * S.ky - S.h) }; };
    const outside = (r) => { const o = ovr(r); return o.l > 0.5 || o.r > 0.5 || o.t > 0.5 || o.b > 0.5; };
    const hOf = (r) => { const S = sc(r); return Math.min(r.px * r.sx * S.kx, r.px * r.sy * S.ky); };
    const side = { l: 0, r: 0, t: 0, b: 0 };
    const outWho = new Set();
    for (const r of txt) {
      const o = ovr(r);
      for (const k of ['l', 'r', 't', 'b']) side[k] = Math.max(side[k], o[k]);
      if (outside(r)) outWho.add(r.who);
    }
    const bandTxt = txt.filter((r) => r.cv === 'hudBand');
    const mini = all.filter((r) => r.kind === 'rect' && r.who === 'drawMinimap' && r.call === 'strokeRect');
    return {
      bandOn, cssW: rc.width, cssH: rc.height,
      bandCssW: bandOn ? rb.width : 0, bandCssH: bandOn ? rb.height : 0, bandAttr: bandOn ? [bd.width, bd.height] : null,
      hudCv: [...new Set(names.map((k) => parts[k].cv))].sort(), parts: names.sort(), partBox: parts, overlaps,
      courseCover, courseCoverRatio: courseCover / (rc.width * rc.height),
      bandBottom, bandSlack: bandOn ? rb.height - bandBottom : null,
      txtN: txt.length, outN: txt.filter(outside).length, outTxt: [...new Set(txt.filter(outside).map((r) => r.text))].slice(0, 5),
      outSide: side, outWho: [...outWho].sort(),
      lbBox: parts.drawFleetHud ? { x0: parts.drawFleetHud.x0, x1: parts.drawFleetHud.x1, w: parts.drawFleetHud.x1 - parts.drawFleetHud.x0 } : null,
      // 順位表の**文字**の最左 (枠の左端ではない)。枠の内側の余白を実測で導くために持つ。
      lbTextX0: (() => { const t2 = txt.filter((r) => r.who === 'drawFleetHud'); return t2.length ? Math.min(...t2.map((r) => r.x0 * sc(r).kx)) : null; })(),
      bandTxtN: bandTxt.length, bandMinH: bandTxt.length ? Math.min(...bandTxt.map(hOf)) : null,
      bandMinText: bandTxt.length ? bandTxt.reduce((a, r) => (!a || hOf(r) < hOf(a) ? r : a)).text : null,
      miniN: mini.length, miniBox: mini.length ? { x: mini[0].x0 * SC.course.kx, y: mini[0].y0 * SC.course.ky, x1: mini[0].x1 * SC.course.kx, y1: mini[0].y1 * SC.course.ky } : null,
      spyErr: all.filter((r) => r.kind === 'spyErr').length,
      editing: !document.getElementById('editorPanel').classList.contains('hidden'),
    };
  });
  const setFollow = (on) => page.evaluate((w) => { const el = document.getElementById('optFollow'); if (el && el.checked !== w) el.click(); return !!el?.checked; }, on);

  for (const v of opts) {
    await page.setViewportSize({ width: WIDE[0][0], height: WIDE[0][1] });
    await page.selectOption('#courseSel', v);
    await page.waitForTimeout(1300);
    for (const [W, H] of [...NARROW, ...WIDE]) {
      await page.setViewportSize({ width: W, height: H });
      await page.waitForTimeout(600);       // resize デバウンス 200ms → setView
      const m = await measure();
      m.opt = v; m.W = W; m.H = H; m.narrow = W < 1000;
      m.ovX = await overflowX(page, W);
      if (m.narrow) {                        // 追従 ON でミニマップが出るか (コース面が空いたことの帰結)
        await setFollow(true); await page.waitForTimeout(400);
        m.follow = await measure();
        await setFollow(false); await page.waitForTimeout(250);
      }
      cells.push(m);
    }
    const last = cells.slice(-(NARROW.length + WIDE.length));
    console.log(`  · ${v.padEnd(22)} ` + last.map((c) => `${c.W}:${c.hudCv.join('+') || '—'}${c.narrow ? `/被覆${(c.courseCoverRatio * 100).toFixed(0)}%/印${c.follow.miniN}` : ''}`).join(' '));
  }

  const narrow = cells.filter((c) => c.narrow), wide = cells.filter((c) => !c.narrow);
  // ── B1〜B7: 狭い画面 ──
  const covered = narrow.filter((c) => c.courseCover > 0);
  ok(narrow.length > 0 && covered.length === 0,
    `B1 狭い画面の全セル (${narrow.length}) でコースキャンバスに HUD 部品が 1 つも描かれない (覆っている ${covered.length}: ${JSON.stringify(covered.slice(0, 3).map((c) => [c.opt, c.W, (c.courseCoverRatio * 100).toFixed(1) + '%', c.hudCv]))})`);
  const notBand = narrow.filter((c) => !c.bandOn || c.hudCv.length !== 1 || c.hudCv[0] !== 'hudBand' || c.parts.length !== 3);
  ok(notBand.length === 0,
    `B2 狭い画面の全セルで帯が展開され、メーター・タイヤ・順位表の 3 部品が揃って帯に描かれる (欠け ${notBand.length}: ${JSON.stringify(notBand.slice(0, 3).map((c) => [c.opt, c.W, c.bandOn, c.hudCv, c.parts]))})`);
  // B3: 上・右・下 は 1 px も出ない。**下**が BC6 が直した軸 (改修前は 390 幅で 20/68・320 幅で 37/68 のセルが切れていた)。
  const outTRB = narrow.filter((c) => c.outSide.t > 0.5 || c.outSide.r > 0.5 || c.outSide.b > 0.5);
  ok(outTRB.length === 0,
    `B3 帯に描かれた文字が帯の上・右・下からはみ出さない (違反 ${outTRB.length}/${narrow.length}・最大 上 ${Math.max(...narrow.map((c) => c.outSide.t)).toFixed(1)} / 右 ${Math.max(...narrow.map((c) => c.outSide.r)).toFixed(1)} / 下 ${Math.max(...narrow.map((c) => c.outSide.b)).toFixed(1)} px: ${JSON.stringify(outTRB.slice(0, 3).map((c) => [c.opt, c.W, c.outSide, c.outTxt]))})`);
  // B3b 左のはみ出しは「順位表の枠 (右詰め・右余白 12) が表示幅に入らない」ときだけ・量も枠幅から導ける値ちょうど。
  //   ⚠ これは **BC6 以前からある性質** で、BC6 の受け入れ基準 (下端の切れ) とは別の軸。改修前の実測でも
  //     320 幅は 68/68 セルではみ出していた (390 幅は 0)。順位表の最小枠 (hud.js LB.wMin) が表示幅を超えるため。
  //     「既知だから見ない」にすると枠が更に大きくなる退行を見逃すので、**導出した上界で縛る**:
  //       期待はみ出し = max(0, 枠幅 + 右余白 − 表示幅)   (右余白は広い画面のセルから実測する＝定数を写さない)
  //   右余白と枠内の左余白は、枠が収まっている**広い画面のセルから実測**する (product の定数を写さない)。
  const wideLb = wide.filter((c) => c.lbBox && c.lbTextX0 != null);
  const rightPad = Math.min(...wideLb.map((c) => c.cssW - c.lbBox.x1));
  const innerPad = Math.min(...wideLb.map((c) => c.lbTextX0 - c.lbBox.x0));
  const wantLeft = (c) => Math.max(0, c.lbBox.w + rightPad - c.cssW - innerPad);   // 文字の左端が表示域から出る量
  const lbLeftBad = narrow.filter((c) => !c.lbBox || Math.abs(c.outSide.l - wantLeft(c)) > 0.5
    || (c.outSide.l > 0.5 && c.outWho.join() !== 'drawFleetHud'));
  ok(wideLb.length > 0 && lbLeftBad.length === 0,
    `B3b 左のはみ出しは順位表だけ・量は「枠幅 + 右余白 ${rightPad.toFixed(0)} − 表示幅 − 枠内の左余白 ${innerPad.toFixed(0)}」ちょうど (違反 ${lbLeftBad.length}/${narrow.length}: ${JSON.stringify(lbLeftBad.slice(0, 3).map((c) => [c.opt, c.W, c.outSide.l.toFixed(1), c.lbBox ? wantLeft(c).toFixed(1) : null, c.outWho]))})`);
  // B3d 順位表の枠幅そのものを**独立の上界**で縛る。B3b/B3c の式には枠幅が両辺に現れて相殺するので、
  //   枠が太る退行は B3b/B3c だけでは緑のまま通る (層 4 レビュー指摘)。上界は product の hud.js が持つ
  //   最小枠 LB.wMin ＝この母集団 (ja・1 台・既定装備) で順位表が取る幅そのもの。注記がこれを超えて
  //   広がったら赤になる。
  const LBW = await appModule(page, 'js/hud.js', (m) => (m.LB ? m.LB.wMin : null));
  const fatLb = LBW == null ? cells.filter(() => true) : cells.filter((c) => c.lbBox && c.lbBox.w > LBW + 0.5);
  ok(LBW != null && fatLb.length === 0,
    `B3d 順位表の枠幅が hud.js の LB.wMin (${LBW}px) 以下 (実測 ${Math.min(...cells.filter((c) => c.lbBox).map((c) => c.lbBox.w)).toFixed(1)}〜${Math.max(...cells.filter((c) => c.lbBox).map((c) => c.lbBox.w)).toFixed(1)}px・超過 ${fatLb.length}${LBW == null ? '・LB が hud.js から引けない' : ''}: ${JSON.stringify(fatLb.slice(0, 3).map((c) => [c.opt, c.W, c.lbBox?.w.toFixed(1)]))})`);
  // B3c 枠が入る表示幅のセルでは左のはみ出しも 0 (= 「入るのに切れる」退行を落とす)。
  const roomy = narrow.filter((c) => c.lbBox && c.cssW >= c.lbBox.w + rightPad + innerPad - 0.5);
  const roomyBad = roomy.filter((c) => c.outSide.l > 0.5);
  ok(roomy.length > 0 && roomyBad.length === 0,
    `B3c 順位表の枠が入る表示幅のセル (${roomy.length}/${narrow.length}) では左のはみ出しも 0 (違反 ${roomyBad.length})`);
  for (const [W] of NARROW) {
    const cs = narrow.filter((c) => c.W === W);
    const short = cs.filter((c) => c.outSide.l > 0.5);
    console.log(`  ℹ ${W} 幅: 表示幅 ${cs[0].cssW.toFixed(0)}px・順位表の枠 ${cs[0].lbBox.w.toFixed(0)}px → 左のはみ出し ${cs.length ? Math.max(...cs.map((c) => c.outSide.l)).toFixed(0) : 0}px (${short.length}/${cs.length} セル)${short.length ? ' ← BC6 以前からの既知の限界 (順位表の最小枠 > 表示幅)。BC6 は下端の切れを 0 にした軸' : ''}`);
  }
  const worst = narrow.reduce((a, c) => (c.bandMinH != null && (!a || c.bandMinH < a.bandMinH) ? c : a), null);
  ok(!!worst && worst.bandMinH >= TEXT_MIN - EPS,
    `B4 帯の文字の表示高さの最小 ≥ ${TEXT_MIN} CSS px (最小 ${worst ? worst.bandMinH.toFixed(2) : '—'}px「${worst?.bandMinText}」@ ${worst?.opt} ${worst?.W})`);
  const lap = narrow.filter((c) => c.overlaps.length > 0);
  ok(lap.length === 0, `B5 帯の中で 3 部品が互いに重ならない (重なり ${lap.length}: ${JSON.stringify(lap.slice(0, 3).map((c) => [c.opt, c.W, c.overlaps]))})`);
  const widthBad = narrow.filter((c) => Math.abs(c.bandCssW - c.cssW) > 1);
  ok(widthBad.length === 0,
    `B6 帯の表示幅がコースキャンバスの表示幅と一致 (最大ずれ ${Math.max(0, ...narrow.map((c) => Math.abs(c.bandCssW - c.cssW))).toFixed(2)}px・違反 ${widthBad.length}: ${JSON.stringify(widthBad.slice(0, 3).map((c) => [c.opt, c.W, c.cssW.toFixed(1), c.bandCssW.toFixed(1)]))})`);
  const slackBad = narrow.filter((c) => !(c.bandSlack >= -0.5 && c.bandSlack <= BAND_SLACK));
  ok(slackBad.length === 0,
    `B7 帯の高さが HUD の下端ちょうど＋余白 ≤ ${BAND_SLACK} CSS px (余白 ${Math.min(...narrow.map((c) => c.bandSlack)).toFixed(1)}〜${Math.max(...narrow.map((c) => c.bandSlack)).toFixed(1)}px・違反 ${slackBad.length}: ${JSON.stringify(slackBad.slice(0, 3).map((c) => [c.opt, c.W, c.bandCssH.toFixed(1), c.bandBottom.toFixed(1)]))})`);
  // ── B8: 広い画面は従来どおり ──
  const wideBad = wide.filter((c) => c.bandOn || c.hudCv.length !== 1 || c.hudCv[0] !== 'course' || c.parts.length !== 3);
  ok(wide.length > 0 && wideBad.length === 0,
    `B8 広い画面・**既定の表示 (ja・1 台・既定装備)** の全セル (${wide.length}) で帯は畳まれ、HUD 3 部品は従来どおりコースに描かれる (違反 ${wideBad.length}: ${JSON.stringify(wideBad.slice(0, 3).map((c) => [c.opt, c.W, c.bandOn, c.hudCv]))})`);
  // ── B9: コース面が空いた帰結＝ミニマップが出る ──
  const noMini = narrow.filter((c) => c.follow.miniN < 2);
  ok(noMini.length === 0,
    `B9 狭い画面の全セルで追従 ON にするとミニマップが出る (出ない ${noMini.length}/${narrow.length}: ${JSON.stringify(noMini.slice(0, 3).map((c) => [c.opt, c.W, c.cssW.toFixed(0) + 'x' + c.cssH.toFixed(0), c.follow.miniN]))})`);
  const miniOut = narrow.filter((c) => c.follow.miniBox && (c.follow.miniBox.x < -0.5 || c.follow.miniBox.y < -0.5 || c.follow.miniBox.x1 > c.cssW + 0.5 || c.follow.miniBox.y1 > c.cssH + 0.5));
  ok(miniOut.length === 0, `B9b ミニマップの箱がコースキャンバスの中に収まる (外へ出た ${miniOut.length})`);
  const spy = cells.filter((c) => c.spyErr > 0);
  ok(spy.length === 0, `B0b 観測の記録で例外 0 (${spy.length} セル)`);
  const ovx = cells.filter((c) => c.ovX > 0);
  ok(ovx.length === 0, `B11 横はみ出し 0 (${ovx.length} セル: ${JSON.stringify(ovx.slice(0, 3).map((c) => [c.opt, c.W, c.ovX]))})`);

  // ── B10: 編集モードでは帯を畳む ──
  await page.setViewportSize({ width: NARROW[0][0], height: NARROW[0][1] });
  await page.waitForTimeout(500);
  const beforeEdit = await measure();
  await page.click('#editToggle'); await page.waitForTimeout(500);
  const inEdit = await measure();
  await page.click('#editToggle'); await page.waitForTimeout(500);
  const afterEdit = await measure();
  ok(beforeEdit.bandOn && inEdit.editing && !inEdit.bandOn && afterEdit.bandOn,
    `B10 編集モードでは帯が畳まれ、戻ると再び出る (編集前 ${beforeEdit.bandOn} → 編集中 editing=${inEdit.editing}/帯 ${inEdit.bandOn} → 復帰 ${afterEdit.bandOn})`);

  // ── ℹ ミニマップが出る画面幅の下限 (受け入れ基準の記録用) ──
  const scanCourses = [...new Set(['gh:racing-course', 'オーバル', opts.find((v) => /ワインディング/.test(v))].filter(Boolean))].filter((v) => allOpts.includes(v));
  const scanRes = [];
  for (const v of scanCourses) {
    await page.setViewportSize({ width: 1000, height: 844 });
    await page.selectOption('#courseSel', v); await page.waitForTimeout(1300);
    await setFollow(true); await page.waitForTimeout(400);
    let low = null;
    for (const W of SCAN) {
      await page.setViewportSize({ width: W, height: 844 });
      await page.waitForTimeout(600);
      const m = await measure();
      if (m.miniN >= 2 && low === null) low = W;
      if (m.miniN < 2) low = null;   // 出なくなったら下限を取り直す (連続して出る最小幅を探す)
      scanRes.push({ v, W, mini: m.miniN >= 2, band: m.bandOn, cssH: m.cssH });
    }
    await setFollow(false);
  }
  for (const v of scanCourses) {
    const r = scanRes.filter((x) => x.v === v);
    const first = r.find((x) => x.mini);
    console.log(`  ℹ ミニマップが出る画面幅の下限: ${v} = ${first ? first.W + 'px' : '走査範囲 ' + SCAN[0] + '〜' + SCAN.at(-1) + 'px では出ない'} (走査 ${r.map((x) => `${x.W}:${x.mini ? '出' : '×'}`).join(' ')})`);
  }
  // ⚠ コース名はハードコードなので、上流の投稿が消える/改名されると scanCourses が空になりうる。
  //   空配列に対する every は true ＝ **無言で緑**になるので、母集団が空でないことを同じ行で要求する。
  const scanNarrow = scanRes.filter((x) => x.W <= 320);
  ok(scanCourses.length > 0 && scanNarrow.length > 0 && scanNarrow.every((x) => x.mini),
    `B12 走査した ${scanCourses.length} コース (${scanNarrow.length} 標本) で画面幅 ${SCAN[0]}〜320px でもミニマップが出る (出ない ${scanNarrow.filter((x) => !x.mini).length}: ${JSON.stringify(scanNarrow.filter((x) => !x.mini).slice(0, 4).map((x) => [x.v, x.W]))})`);
  // B14 帯の出る/出ないが画面幅に対して**単調**である (広げたら出て、狭めたら消える、が混在しない)。
  //   走査したのは 280〜1000px。境界が 1 つだけであることを求める＝幅を少し変えるたびに出入りが跳ねる退行を落とす。
  const flips = [];
  for (const v of scanCourses) {
    const r = scanRes.filter((x) => x.v === v);   // SCAN の昇順
    let n = 0;
    for (let i = 1; i < r.length; i++) if (r[i].band !== r[i - 1].band) n++;
    flips.push([v, n, r.filter((x) => x.band).length + '/' + r.length]);
  }
  ok(flips.length > 0 && flips.every((f) => f[1] <= 1),
    `B14 帯の出る/出ないが画面幅に対して単調 (境界は高々 1 つ・[コース, 切替回数, 帯だった標本] = ${JSON.stringify(flips)})`);

  // ── B13: devicePixelRatio > 1 の端末 (Xvfb は DPR=1 なので context で明示する) ──
  {
    const dprPage = await newPage(browser, { width: NARROW[0][0], height: NARROW[0][1], deviceScaleFactor: 2 });
    await setLang(dprPage.page, 'ja');
    await dprPage.page.selectOption('#optPhysMode', 'v2');
    await dprPage.page.waitForTimeout(1200);
    const r = await dprPage.page.evaluate(async () => {
      const raf = () => new Promise((r2) => requestAnimationFrame(() => r2()));
      for (let i = 0; i < 4; i++) await raf();
      const bd = document.getElementById('hudBand'), cv = document.getElementById('course');
      const rb = bd.getBoundingClientRect();
      return { dpr: window.devicePixelRatio, on: !bd.hidden, attrW: bd.width, attrH: bd.height,
        cssW: rb.width, cssH: rb.height, courseCssW: cv.getBoundingClientRect().width };
    });
    // 帯の backing store が DPR 倍で、表示寸法は CSS px のまま＝文字の実解像度が DPR 倍になる。
    ok(r.dpr > 1 && r.on && Math.abs(r.attrW - r.cssW * r.dpr) <= 1 && Math.abs(r.attrH - r.cssH * r.dpr) <= 1
      && Math.abs(r.cssW - r.courseCssW) <= 1,
      `B13 DPR=${r.dpr} の端末で帯の内部解像度が DPR 倍・表示寸法は CSS px のまま (属性 ${r.attrW}×${r.attrH} / 表示 ${r.cssW.toFixed(1)}×${r.cssH.toFixed(1)} / コース表示幅 ${r.courseCssW.toFixed(1)})`);
    ok(dprPage.errors.length === 0, `B13b DPR=2 のページで JS/HTTP エラー 0 (${dprPage.errors.length}: ${JSON.stringify(dprPage.errors.slice(0, 3))})`);
    await dprPage.page.close();
  }

  ok(errors.length === 0, `E JS/HTTP エラー 0 (${errors.length}: ${JSON.stringify(errors.slice(0, 3))}) / 想定内 ${benign.length}`);
} finally {
  await browser.close();
}
console.log(`\n集計: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('失敗:\n  - ' + fails.join('\n  - ')); process.exit(1); }
console.log('結果: PASS');
