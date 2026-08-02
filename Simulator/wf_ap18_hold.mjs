// AP18 常設アサートゲート: センサー実機化 opt-in ① 更新レート/レイテンシ (sample-and-hold)。
// 本番フロー (buildApi の refresh キャッシュ・runRace) を実データで駆動し、受け入れ基準①②③を
// 連続量マージンで検証する (知覚→測定・CI-14)。1 つでも外れたら exit(1)。
//   ① OFF 既定: 全読み値 byte 一致・乱数非消費 0 回 (f0〜f3 は wf_ab8_bench が別途担保)。
//   ② ON: (a) 保持窓内の分散=0 (b) 更新間隔[物理tick]=round(physicsHz/hz) 全窓一致
//          (c) 1 反復内 100 回読み平均の sd/単発 sd=1.00±0.05 (平均化エクスプロイト閉塞)。
//   ③ 公式レース強制 OFF: hold ON でも verifyHash 不変 (= f0)。
import { SENSOR_HOLD, SENSOR_NOISE, SIM, CONST } from './public/js/config.js';
import { Car } from './public/js/physics.js';
import { readAll } from './public/js/sensors.js';
import { buildApi } from './public/js/api.js';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';

let fail = 0;
const chk = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) fail++; };
const sd = (a) => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length); };

// 実データのコース (卓上オーバル=f0 と同一 spec)。
const oval = buildFromSpec({ name: 'オーバル', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
const walls = oval.walls;

function makeWorld(car) {
  return { car, walls, start: { x: car.x, y: car.y, theta: car.theta }, log: () => {},
    _sensors: [], _pendingDelay: 0, _others: [], rear: false, _sensGen: 0, _simMs: 0 };
}

// 中央センサーが中距離 (250〜1200mm・-3 でも 0 clamp でもない) を読む姿勢を実測で選ぶ (Gaussian を綺麗に測る)。
function pickPose() {
  for (let x = -1.0; x <= 1.0; x += 0.1) for (let y = -0.6; y <= 0.6; y += 0.1)
    for (const th of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
      const c = new Car({ x, y, theta: th });
      const mm = readAll(c, walls, [])[1].mm;
      if (mm >= 250 && mm <= 1200) return { x, y, theta: th, mm };
    }
  return null;
}
const pose = pickPose();
if (!pose) { console.error('FAIL: 適切な測距姿勢が見つからない'); process.exit(1); }
console.log(`基準姿勢: x=${pose.x.toFixed(1)} y=${pose.y.toFixed(1)} θ=${pose.theta.toFixed(2)} 中央mm=${pose.mm}`);

// 退避 (本番 live globals を汚さない)。
const savHold = SENSOR_HOLD.on, savHz = SENSOR_HOLD.hz, savNoise = SENSOR_NOISE.on, savDrop = SENSOR_NOISE.dropout;

// ─────────────────────────────────────────────────────────────────────
console.log('\n[① OFF 既定: 全読み値 byte 一致・乱数非消費 0 回]');
SENSOR_HOLD.on = false; SENSOR_NOISE.on = false;
{
  const car = new Car({ x: pose.x, y: pose.y, theta: pose.theta });
  const world = makeWorld(car);
  // Math.random スパイ (OFF 既定は乱数を一切呼ばない=卓上決定論の要)。
  const realRand = Math.random; let randCount = 0;
  Math.random = () => { randCount++; return realRand(); };
  const env = buildApi(world);
  const expect = readAll(car, walls, []).map(s => s.mm);   // 独立再計算 (本番 readAll)
  let allEq = true;
  for (let tk = 0; tk < 12; tk++) {
    world._sensGen++; world._simMs += 1000 / SIM.loopHz;
    // 1 反復内で複数回読む典型ループ (L/C/R を各 3 回)。
    for (let r = 0; r < 3; r++) {
      const got = [env.RC_read(env.LEFT), env.RC_read(env.CENTER), env.RC_read(env.RIGHT)];
      for (let i = 0; i < 3; i++) if (got[i] !== expect[i]) allEq = false;
    }
  }
  Math.random = realRand;
  chk(allEq, `OFF 既定の全読み値が本番 readAll と byte 一致 (期待 ${expect.join('/')})`);
  chk(randCount === 0, `乱数非消費 0 回 (実測 ${randCount})`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n[② ON: 保持窓内 分散0 ・ 更新間隔=round(physicsHz/hz)]');
SENSOR_HOLD.on = true; SENSOR_HOLD.hz = 30; SENSOR_NOISE.on = true; SENSOR_NOISE.dropout = 0;
const period = Math.max(1, Math.round(SIM.physicsHz / SENSOR_HOLD.hz));
{
  const car = new Car({ x: pose.x, y: pose.y, theta: pose.theta });   // 静止姿勢=値変化は再サンプル(新ノイズ)のみ由来
  const world = makeWorld(car);
  const env = buildApi(world);
  const dt = 1000 / SIM.physicsHz;
  let prevRef = null; const resampleTicks = []; const mmByTick = [];
  for (let tk = 0; tk <= 40; tk++) {
    world._simMs = tk * dt;
    env.read_all_sensors();               // refresh 発火 (本番読取口)
    if (world._sensors !== prevRef) { resampleTicks.push(tk); prevRef = world._sensors; }
    mmByTick.push(world._sensors[1].mm);
  }
  // (a) 更新間隔: 連続再サンプル tick の差が全て period か。
  const intervals = resampleTicks.slice(1).map((t, i) => t - resampleTicks[i]);
  const allPeriod = intervals.length > 0 && intervals.every(d => d === period);
  chk(allPeriod, `更新間隔[物理tick]=round(${SIM.physicsHz}/${SENSOR_HOLD.hz})=${period} 全窓一致 (実測間隔 {${[...new Set(intervals)].join(',')}})`);
  // (b) 保持窓内の分散=0: 各再サンプル tick からの period tick で mm 一定。
  let varZero = true;
  for (const st of resampleTicks) {
    for (let k = 1; k < period && st + k < mmByTick.length; k++) if (mmByTick[st + k] !== mmByTick[st]) varZero = false;
  }
  // 窓間では (新ノイズで) 値が変わることも確認 (=本当に保持で 0 になっている・恒常値の見かけ 0 でない)。
  const distinct = new Set(resampleTicks.map(t => mmByTick[t])).size;
  chk(varZero, '保持窓内の測距分散=0 (全窓で保持値一定)');
  chk(distinct > 1, `窓ごとに再サンプルで値が更新 (相異値 ${distinct}/${resampleTicks.length} 窓 — 見かけ0でない)`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n[② ON: 多数回読み平均の sd 比 (エクスプロイト閉塞)]');
{
  const M = 3000, READS = 100;
  const dt = 1000 / SIM.physicsHz;
  // HOLD ON: 各窓の先頭 tick で 100 回読む → 全て保持値 → avg==single → sd 比 1.00。
  SENSOR_HOLD.on = true; SENSOR_NOISE.on = true; SENSOR_NOISE.dropout = 0;
  const carH = new Car({ x: pose.x, y: pose.y, theta: pose.theta });
  const worldH = makeWorld(carH);
  const envH = buildApi(worldH);
  const avgH = [], sglH = [];
  for (let m = 0; m < M; m++) {
    worldH._simMs = m * period * dt;         // 各試行=新しい保持窓 (新ノイズ)
    let s = 0, first = null;
    for (let r = 0; r < READS; r++) { const v = envH.RC_read(envH.CENTER); if (first === null) first = v; s += v; }
    avgH.push(s / READS); sglH.push(first);
  }
  const ratioHold = sd(avgH) / sd(sglH);
  // HOLD OFF (対照): NOISE ON で 100 回読むと毎回新ノイズ → 平均で sd≈1/√100 に縮む (エクスプロイト存在の実証)。
  SENSOR_HOLD.on = false; SENSOR_NOISE.on = true; SENSOR_NOISE.dropout = 0;
  const carN = new Car({ x: pose.x, y: pose.y, theta: pose.theta });
  const worldN = makeWorld(carN);
  const envN = buildApi(worldN);
  const avgN = [], sglN = [];
  for (let m = 0; m < M; m++) {
    worldN._sensGen++;                       // 各試行=新 tick (NOISE ON は毎読取で再測=新ノイズ)
    let s = 0, first = null;
    for (let r = 0; r < READS; r++) { const v = envN.RC_read(envN.CENTER); if (first === null) first = v; s += v; }
    avgN.push(s / READS); sglN.push(first);
  }
  const ratioNoHold = sd(avgN) / sd(sglN);
  console.log(`  対照 (HOLD OFF): sd比 ${ratioNoHold.toFixed(3)} (エクスプロイト有効=σを ~1/√${READS}=${(1 / Math.sqrt(READS)).toFixed(3)} へ縮小)`);
  chk(Math.abs(ratioHold - 1.00) <= 0.05, `HOLD ON: 100回読み平均の sd/単発 sd=${ratioHold.toFixed(3)} ∈ 1.00±0.05 (平均化が効かない=閉塞)`);
  chk(ratioNoHold < 0.2, `対照で閉塞前は sd比 ${ratioNoHold.toFixed(3)} < 0.2 (エクスプロイトが実在=閉塞の意義を確認)`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n[③ 公式レース強制 OFF: hold ON でも verifyHash 不変 (=f0)]');
SENSOR_NOISE.on = false; SENSOR_NOISE.dropout = savDrop;
{
  const prog = (key) => { const p = PROGRAMS.find(x => x.key === key); return { src: p.code, lang: p.lang || 'c', carType: p.carType }; };
  const fieldOf = (...keys) => keys.map((k, i) => { const p = prog(k); return { name: 'C' + i, lang: p.lang, src: p.src, carType: p.carType, rear: false, encoder: false }; });
  const F0 = '4bbed0f4';
  SENSOR_HOLD.on = false;
  const rOff = runRace({ report: true, course: oval, laps: 3, field: fieldOf('normal_fr', 'normal_awd', 'normal_ff'), crashRule: { rejoin: false, penaltySec: 3 } });
  SENSOR_HOLD.on = true;   // ライブ UI トグル ON を模す
  const rOn = runRace({ report: true, course: oval, laps: 3, field: fieldOf('normal_fr', 'normal_awd', 'normal_ff'), crashRule: { rejoin: false, penaltySec: 3 } });
  chk(rOff.verifyHash === F0, `hold OFF レース verifyHash=${rOff.verifyHash} = f0 ${F0}`);
  chk(rOn.verifyHash === F0, `hold ON でも強制 OFF で verifyHash=${rOn.verifyHash} = f0 ${F0} (verifyHash 不変)`);
  chk(SENSOR_HOLD.on === true, 'runRace 後に SENSOR_HOLD.on が呼出時の値へ復元 (退避/復元が機能)');
}

// 復元。
SENSOR_HOLD.on = savHold; SENSOR_HOLD.hz = savHz; SENSOR_NOISE.on = savNoise; SENSOR_NOISE.dropout = savDrop;

console.log('');
if (fail === 0) { console.log('OK: AP18 受け入れ基準①②③ 全て PASS'); }
else { console.error(`FAIL: ${fail} 件の基準未達`); process.exit(1); }
