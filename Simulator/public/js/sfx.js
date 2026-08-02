// sfx.js — 最小限の効果音 (AB12 / PX-013)。WebAudio で合成した軽量 SE を任意 ON/OFF で鳴らす。
// presentation 専用＝物理/レース計算/決定論には一切関与しない (音は slots/hash 非参加)。
// OFF or 未対応環境では完全無音 (発振器を一切作らない＝play() が即 return)。
// 自動再生ポリシー順守: AudioContext はユーザー操作起点 (unlock) で生成/解錠する。
let ctx = null;
let enabled = true;        // マスタ ON/OFF (既定 ON・main.js が localStorage 'rumicar.sfx' と同期)
const MASTER = 0.18;       // 控えめな既定音量 (子ども向け教材・耳に優しい・決定ログ AB-12)

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch (e) { ctx = null; }
  return ctx;
}

// ユーザー操作起点で AudioContext を生成/解錠する (自動再生ポリシー順守)。冪等。
export function unlock() {
  const c = ensureCtx();
  if (!c) return;
  if (c.state === 'suspended') { try { c.resume(); } catch (e) {} }
}

export function setEnabled(v) { enabled = !!v; if (enabled) unlock(); }
export function isEnabled() { return enabled; }

// 短いエンベロープのトーン (sine/triangle/sawtooth)。slideTo 指定で周波数を滑らせる。
function tone(freq, dur, type, peak, slideTo, delay = 0) {
  const c = ctx; if (!c) return;
  const now = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, now);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), now + dur);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(peak * MASTER, now + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(g); g.connect(c.destination);
  osc.start(now); osc.stop(now + dur + 0.03);
}

// クラッシュ用の減衰ノイズバースト (低域通過でやや鈍い衝突音)。Math.random は音色専用＝物理非干渉。
function noiseBurst(dur, peak) {
  const c = ctx; if (!c) return;
  const now = c.currentTime;
  const n = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource(); src.buffer = buf;
  const g = c.createGain();
  g.gain.setValueAtTime(peak * MASTER, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
  src.connect(lp); lp.connect(g); g.connect(c.destination);
  src.start(now); src.stop(now + dur);
}

// 効果音を鳴らす。name: 'count'(3-2-1) / 'go'(発走) / 'lap'(周回) / 'goal'(ゴール) / 'crash'(クラッシュ)。
export function play(name) {
  if (!enabled) return;
  const c = ensureCtx(); if (!c) return;
  if (c.state === 'suspended') { try { c.resume(); } catch (e) {} }
  try {
    switch (name) {
      case 'count': tone(660, 0.12, 'triangle', 0.5); break;                 // 3-2-1 の各「ピッ」
      case 'go':    tone(990, 0.30, 'triangle', 0.85); break;               // GO! 高め・長め
      case 'lap':   tone(880, 0.10, 'sine', 0.5); break;                    // 周回通過 軽いチャイム
      case 'goal':                                                          // ゴール: 上昇する2音 (ファンファーレ風)
        tone(784, 0.14, 'triangle', 0.7);
        tone(1175, 0.34, 'triangle', 0.85, null, 0.13);
        break;
      case 'crash':                                                         // クラッシュ: ノイズ＋下降する低音
        noiseBurst(0.22, 0.6);
        tone(150, 0.24, 'sawtooth', 0.5, 70);
        break;
      default: break;
    }
  } catch (e) { /* 音は壊れても本体に影響させない */ }
}
