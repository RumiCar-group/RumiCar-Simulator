// RumiCar API ホスト実装。Arduino 系 (RC_*) と Raspberry Pi 系 (rc_*) の両方を提供し、
// インタープリタ / JS 実行へバインドする共通環境を構築する。
import { CONST, SENSOR_NOISE, SENSOR_HOLD, SIM } from './config.js';
import { DYN } from './physics_dyn.js';
import { readAll, readRear } from './sensors.js';
import { t } from './i18n.js';
import { RuntimeError, typeName, ONE_ARG } from './interp/evaluator.js';

// World は { car, walls, log(msg), rear?, encoder? } を持つ実行コンテキスト。
// world.rear=true のとき後方センサー(任意装備)が、world.encoder=true のとき車輪エンコーダ(任意装備)が有効になる。
export function buildApi(world) {
  // 最新センサー値をキャッシュ (loop の1反復内で複数回読まれる想定)。
  // world._others = 他車の車体エッジ線分 (干渉ONのとき) を距離計測に含める。
  // AP5: 同一 tick 内は姿勢・walls・他車エッジが不変なので、初回の測距結果を tick 世代
  //   (world._sensGen: tickSlot が毎 tick 進める) 単位でキャッシュし再測距を抑止する。
  //   RC_read の L/C/R を読む典型ループの refresh ×3.00 増幅を ×1.00 へ (byte 同値=姿勢不変ゆえ)。
  //   ノイズ ON 時は 1計測ごとに乱数を消費する実機経路ゆえキャッシュせず毎回再測 = 乱数消費列を
  //   従来どおり保つ (SENSOR_NOISE.on 経路 byte 不変)。公式レースはノイズ強制 OFF (race_engine.js)。
  // AP18: SENSOR_HOLD.on のとき、キャッシュ鍵を tick 世代から「経過物理 tick / 保持窓幅」へ切り替える
  //   (sample-and-hold)。1/hz 秒 (=round(physicsHz/hz) 物理 tick) が経過するまで前回の測距を保持し、
  //   実機 VL53L0X の更新レート/レイテンシを模す。保持中は readAll を呼ばない=(a) 同一保持窓内の分散0
  //   (b) 1 反復内で何度読んでも同一値 (=多数回読み平均でノイズσを縮めるエクスプロイトの閉塞)。
  //   経過 tick は round で整数化 (_simMs=Σ(1000/loopHz) の浮動小数誤差に非依存=更新間隔が厳密一定)。
  let sensGen = -1;   // world._sensors/_rear が対応する tick 世代 (-1 = 未計測)
  let holdKey = -1;   // AP18: world._sensors が対応する保持窓 index (-1 = 未サンプル)
  const refresh = () => {
    if (SENSOR_HOLD.on) {
      const elapsedTicks = Math.round((world._simMs || 0) * SIM.physicsHz / 1000);  // 経過物理 tick (整数化=float 安全)
      const period = Math.max(1, Math.round(SIM.physicsHz / SENSOR_HOLD.hz));        // 保持窓幅[物理tick] = round(physicsHz/hz)
      const key = Math.floor(elapsedTicks / period);
      if (key === holdKey && world._sensors.length) return;   // 同一保持窓 = 前回サンプルを保持 (再測距しない)
      world._sensors = readAll(world.car, world.walls, world._others || []);
      world._rear = world.rear ? readRear(world.car, world.walls, world._others || []) : null;
      holdKey = key;
      return;
    }
    if (!SENSOR_NOISE.on && sensGen === world._sensGen && world._sensors.length) return;
    world._sensors = readAll(world.car, world.walls, world._others || []);
    world._rear = world.rear ? readRear(world.car, world.walls, world._others || []) : null;
    sensGen = world._sensGen;
  };
  refresh();

  const clampPwm = (p) => Math.max(0, Math.min(255, Math.round(Number(p) || 0)));

  // 操舵。実機 RumiCar は 3値 (LEFT/CENTER/RIGHT) — これが D-1 の学習 API 表面 (AO_spec §0)。
  // AS12: **比例操舵サーボ (任意装備)** を積んだ車だけ第2引数で舵の強さを指定できる。
  //   RC_steer(LEFT)        → 全舵 左 (従来どおり。装備の有無に関わらず常に有効)
  //   RC_steer(LEFT, 128)   → 約 半舵 左 (0..255・RC_drive(direc,pwm) と同形。255=全舵で3値と bit 一致)
  // 第2引数を省略した呼び出しは steerAmt を null へ戻す = 3値へ復帰する (直前の連続舵指令が
  // 残り続けない)。**未装備で第2引数を渡したら 0 (失敗) を返し、舵指令を一切変えない** —
  // 黙って全舵にすると AP16/AS4 が潰した「サイレント意味論乖離」になるため、既存の
  // 「引数エラーは 0」契約 (下の return 0) に合わせて失敗を返す。
  // ただし RC_steer の返り値は普通読まれない ⇒ 未装備だと「舵が一切効かない車」になり
  // 学習者に原因が見えない (実測: 連続舵プログラム×未装備で DNF timeout)。∴ **最初の1回だけ**
  // ログへ理由を出す (毎 tick 出すと 20Hz でログが溢れるので one-shot)。沈黙截断の禁止。
  let steerPropWarned = false;
  function steer(direc, amount) {
    if (direc === CONST.LEFT || direc === CONST.CENTER || direc === CONST.RIGHT) {
      if (amount === undefined) { world.car.steer = direc; world.car.steerAmt = null; return 1; }
      if (world.steerSet !== 'prop') {           // 比例操舵サーボ 未装備 = 連続舵は使えない
        if (!steerPropWarned) { steerPropWarned = true; world.log(t('log.steer.needProp'), true); }
        return 0;
      }
      world.car.steer = direc; world.car.steerAmt = clampPwm(amount);
      return 1;
    }
    return 0;
  }
  function drive(direc, pwm) {
    if ([CONST.FREE, CONST.REVERSE, CONST.FORWARD, CONST.BRAKE].includes(direc)) {
      world.car.driveDir = direc;
      world.car.pwm = clampPwm(pwm);
      return 1;
    }
    return 0;
  }
  function readDir(direc) {
    refresh();
    if (direc === CONST.LEFT) return world._sensors[0].mm;
    if (direc === CONST.CENTER) return world._sensors[1].mm;
    if (direc === CONST.RIGHT) return world._sensors[2].mm;
    if (direc === CONST.BACK) return world._rear ? world._rear.mm : -2; // 後方: 未装備なら -2
    return -2; // 引数エラー
  }
  // 実機 VL53L0X は範囲外で大きな値 (約 8190) を返す。生読取はこれに準拠。
  // i=3 は後方センサー (未装備時は 8190=範囲外相当)。
  const rawRead = (i) => {
    refresh();
    const s = i === 3 ? world._rear : world._sensors[i];
    const v = s ? s.mm : -1;
    return v < 0 ? 8190 : v;
  };
  const sensorObj = (i) => ({
    readRangeSingleMillimeters: () => rawRead(i),
    get_distance: () => rawRead(i),
  });

  // 車輪エンコーダ (任意装備): 前軸/後軸の車輪面速度 [m/s] を返す。未装備なら -1 (センチネル)。
  // 競技(フルスケール)領域では駆動輪が空転(ローンチ)/ロック(制動)するため、駆動輪と非駆動輪の
  // 速度差からスリップ率を計算でき、トラクション制御/ABS が書ける (実車の車輪速センサーと同じ原理)。
  // 卓上など車輪スリップ率モデル(F5)が無効な領域では車輪は滑らない=接地速度を返す。
  const groundSpeed = () => Math.abs(world.car.u != null ? world.car.u : (world.car.v || 0));
  function wheelSpeed(axle) {
    if (!world.encoder) return -1;                 // 未装備
    const car = world.car;
    const vw = axle === CONST.REAR ? car.vwR : car.vwF;
    if (vw == null || !DYN.wheelDyn) return groundSpeed(); // 車輪ダイナミクス無効=滑らない
    return Math.abs(vw);
  }

  const Serial = {
    print: (...a) => world.log(a.join(' '), false),
    println: (...a) => world.log(a.join(' '), true),
  };

  // AP9: Python 組込関数 (学習頻出)。既存プログラム未使用＝byte 不変 (f0〜f3 は C プログラムで interp/api 非参照)。
  // BL7 ①: 長さの無い値（None・数・bool・関数）は実行時エラー interp.err.lenArg（python3 は TypeError: object of type '…' has no len()）。
  //   ここでは行を付けない＝evaluator の callHost が呼び出した文の行を付ける（JS で書いたプログラムは行なし）。是正前は
  //   JS の Error を日本語固定の文言（「len(): 対象がありません」／「len(): 対象は list/str/dict のみ」）で投げた＝英語モードでも日本語・行番号なし・i18n キーなし。
  // BL7 ③: dict（object）の長さは for … in で鍵を数える（Object.keys を呼ばない）。数える鍵は Object.keys と同じ自前の列挙できる鍵
  //   （py の dict はプロトタイプ無し・ホストのオブジェクトも自前の鍵だけを数える）＝値は是正前と同じ。速くはならない（BL7 fix1・層4 F1 の
  //   実測〔Node 22.22.1〕: V8 の辞書モードの for … in も鍵を全部集める＝鍵の数に比例。鍵 2 つの dict で 186 ns〔15341f4・Object.keys〕→
  //   250 ns・N＝1000／20000 で 1.2〜1.6 倍遅い。理由と数は evaluator.js dictNonEmpty の注記・決定ログ BL7 fix1）。
  // BL7 fix1（層4 F5）＋fix2（層4 往復 2 F2）: 引数の数（1 つでなければ interp.err.oneArg・python3 は TypeError: len() takes exactly one
  //   argument (0 given)）は**ここでは数えない**。py・C のプログラムが len(…) と書いた呼び出しだけを evaluator の callHost が数える
  //   （下の ONE_ARG の印）。JS で書いたプログラムと、ホストの関数（Array.prototype.map ほか）がネイティブに呼ぶ形（`["ab", "c"].map(len)`＝
  //   要素・添字・配列の 3 つを渡す）は従来どおり 1 つ目だけを使う＝15341f4・e961e4b と同じ値（"2,1"）。cb9ea81（fix1）は
  //   pyLen の中で arguments.length を数えたので、map(len) が「3 個渡されました」で止まった（回帰）。
  const pyLen = (x) => {
    if (typeof x === 'string' || Array.isArray(x)) return x.length;
    if (x != null && typeof x === 'object') {
      let n = 0;
      for (const k in x) if (Object.prototype.hasOwnProperty.call(x, k)) n++;
      return n;
    }
    throw new RuntimeError('lenArg', { type: typeName(x) });
  };
  const pyRange = (a, b, c) => {
    let start = 0, end, step = 1;
    if (b === undefined) { end = a; } else { start = a; end = b; if (c !== undefined) step = c; }
    const out = [];
    if (step > 0) for (let i = start; i < end; i += step) out.push(i);
    else if (step < 0) for (let i = start; i > end; i += step) out.push(i);
    return out;
  };
  // math モジュール (Python 風・純粋数学)。三角/平方根/対数/角度変換。物理状態は肩代わりしない (J-1)。
  const mathMod = {
    pi: Math.PI, e: Math.E, tau: Math.PI * 2, inf: Infinity, nan: NaN,
    sqrt: Math.sqrt, pow: Math.pow, exp: Math.exp, log: Math.log, log10: Math.log10, log2: Math.log2,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
    atan2: Math.atan2, hypot: Math.hypot, floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc,
    fabs: Math.abs, fmod: (a, b) => a % b, copysign: (a, b) => (b < 0 ? -Math.abs(a) : Math.abs(a)),
    radians: (d) => d * Math.PI / 180, degrees: (r) => r * 180 / Math.PI,
  };
  // random モジュール: 決定論 PRNG (mulberry32・固定既定シード)。wallclock/エントロピー非依存＝同一入力で
  //   同一列 (verifyHash 2回一致)。world ごとに初期化されるので走行のたびに再現。公式レースも決定論のまま。
  let _rs = 0x9E3779B9 >>> 0;                       // 固定既定シード
  const _rand = () => {
    _rs = (_rs + 0x6D2B79F5) >>> 0;
    let t = _rs;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const randomMod = {
    random: () => _rand(),
    seed: (s) => { _rs = (Number(s) >>> 0) || 0; },
    randint: (a, b) => a + Math.floor(_rand() * (b - a + 1)),
    randrange: (a, b) => (b === undefined ? Math.floor(_rand() * a) : a + Math.floor(_rand() * (b - a))),
    uniform: (a, b) => a + _rand() * (b - a),
    // BL7 ②: list・tuple・str 以外（None・数・dict ほか）は interp.err.choiceArg・空の列は interp.err.choiceEmpty（python3 は TypeError／
    //   IndexError: Cannot choose from an empty sequence）。どちらも乱数を引く前に投げる。行は evaluator の callHost が付ける。是正前は
    //   choice(None) が JS の TypeError「Cannot read properties of null (reading 'length')」・choice([]) は例外にならず値なし（print は空行）・
    //   dict や数は黙って値なし。選べる列の選び方（乱数 1 回・同じ添字）は是正前と同じ＝出荷・既存の列は不変。
    // BL7 fix1＋fix2: 引数の数（1 つでなければ interp.err.oneArg・python3 は choice() が TypeError: … missing 1 required positional
    //   argument: 'seq'）は pyLen と同じく evaluator の callHost が py・C の呼び出しだけで数える（ONE_ARG の印）。JS・ネイティブの
    //   `[["a"], ["b"]].map(random.choice)` は従来どおり 1 つ目から選ぶ（15341f4 と同じ値と乱数の消費）。
    choice: (arr) => {
      if (!(Array.isArray(arr) || typeof arr === 'string')) throw new RuntimeError('choiceArg', { type: typeName(arr) });
      if (arr.length === 0) throw new RuntimeError('choiceEmpty', {});
      return arr[Math.floor(_rand() * arr.length)];
    },
  };
  // BL7 fix2（層4 往復 2 F2）: 引数を 1 つだけ取る組込関数の印（値＝文言の {fn}）。evaluator の callHost が py・C の呼び出しの引数の数を
  //   この印で数える（JS のプログラム・ネイティブの呼び出しは数えない）。
  pyLen[ONE_ARG] = 'len';
  randomMod.choice[ONE_ARG] = 'random.choice';

  const env = {
    // 定数
    LEFT: CONST.LEFT, CENTER: CONST.CENTER, RIGHT: CONST.RIGHT, BACK: CONST.BACK,
    FREE: CONST.FREE, REVERSE: CONST.REVERSE, FORWARD: CONST.FORWARD, BRAKE: CONST.BRAKE,
    FRONT: CONST.FRONT, REAR: CONST.REAR,   // 車輪エンコーダの車軸 (任意装備)
    // Arduino 系
    RC_setup: () => { world.car.reset(world.start); world._sensGen = (world._sensGen || 0) + 1; holdKey = -1; refresh(); },  // AP5: reset で姿勢が変わる=世代を進めキャッシュ無効化。AP18: 保持窓もリセット (テレポート=不連続)
    RC_steer: steer,
    RC_drive: drive,
    RC_read: readDir,
    RC_wheel_speed: wheelSpeed,   // 車輪面速度[m/s] (任意装備の車輪エンコーダ)。未装備 -1
    Serial,
    delay: (ms) => { world._pendingDelay = (world._pendingDelay || 0) + (Number(ms) || 0); },
    // Raspberry Pi 系
    rc_steer: steer,
    rc_drive: drive,
    rc_wheel_speed: wheelSpeed,   // 車輪面速度[m/s] (任意装備の車輪エンコーダ)。未装備 -1
    rc_clear: () => { world.car.driveDir = CONST.FREE; world.car.pwm = 0; },
    read_one_sensor: () => readDir(CONST.CENTER),
    read_all_sensors: () => { refresh(); return world._sensors.map(s => s.mm); },
    // センサーオブジェクト (sensor3 は任意装備の後方センサー。未装備時は 8190 を返す)
    sensor0: sensorObj(0), sensor1: sensorObj(1), sensor2: sensorObj(2), sensor3: sensorObj(3),
    // 共通ユーティリティ
    print: (...a) => world.log(a.join(' '), true),
    abs: Math.abs, min: Math.min, max: Math.max,
    sqrt: Math.sqrt, pow: Math.pow, floor: Math.floor, ceil: Math.ceil, round: Math.round,
    // AP8: Arduino 標準関数。millis/micros はシム時刻由来 (world._simMs=tickSlot が loop 周期ぶん進める)。
    //   wallclock 非依存＝決定論 (同一 spec→同一 verifyHash)・単調増加。未走行 (setup) 時は 0。
    millis: () => Math.floor(world._simMs || 0),
    micros: () => Math.floor((world._simMs || 0) * 1000),
    // map/constrain は純関数。map は Arduino 同様の整数割り算 (long) 意味論に合わせ商を切り捨てる。
    map: (x, il, ih, ol, oh) => Math.trunc((x - il) * (oh - ol) / (ih - il)) + ol,
    constrain: (x, lo, hi) => (x < lo ? lo : (x > hi ? hi : x)),
    // 研究(姿勢推定)用の純粋数学関数。センサーではない=物理状態(ヨー/β/位置)を肩代わりしない(J-1 順守)。
    // ToF の時間変化から β=atan2(vy,vx) を自分で推定する等のために提供 (既存プログラムは未使用=byte 不変)。
    atan2: Math.atan2, atan: Math.atan, sin: Math.sin, cos: Math.cos, hypot: Math.hypot, pi: Math.PI,
    // AP9: Python 組込関数・モジュール (学習頻出構文ギャップ解消)。
    len: pyLen, range: pyRange, list: (x) => (Array.isArray(x) ? x.slice() : (typeof x === 'string' ? x.split('') : (x && typeof x === 'object' ? Object.keys(x) : Array.from(x || [])))),
    int: (x) => Math.trunc(Number(x)), float: (x) => Number(x), str: (x) => String(x),
    bool: (x) => !(x === 0 || x === false || x === '' || x == null),
    sum: (arr, s = 0) => (Array.isArray(arr) ? arr.reduce((a, b) => a + b, s) : s),
    math: mathMod, random: randomMod,
    // time モジュール: sleep(sec) は次反復へ遅延・time() はシム時刻[秒] (決定論・wallclock 非依存)。
    time: {
      sleep: (sec) => { world._pendingDelay = (world._pendingDelay || 0) + (Number(sec) || 0) * 1000; },
      time: () => (world._simMs || 0) / 1000,
    },
  };
  return env;
}
