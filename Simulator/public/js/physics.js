// 車両運動モデル (自転車モデル) と衝突判定。
import { CAR, CONST, TRAIL, CAR_TYPE_BY_KEY, CAR_TYPE_DEFAULT, MASS_REF, MASS, gForward } from './config.js';
import { segIntersect } from './geom.js';
import { wallsNear } from './contact_v2.js';

export class Car {
  constructor(start) {
    this.type = CAR_TYPE_DEFAULT;   // 車種 (reset では保持。CAR_TYPES のキー)
    this.reset(start);
  }
  profile() { return CAR_TYPE_BY_KEY[this.type] || CAR_TYPE_BY_KEY[CAR_TYPE_DEFAULT]; }
  reset(start) {
    this.x = start.x;       // 後輪軸中心 (m)
    this.y = start.y;
    this.theta = start.theta; // rad (0 = +x)
    this.v = 0;             // m/s
    this.steer = CONST.CENTER;
    this.driveDir = CONST.FREE;
    this.pwm = 0;
    this.crashed = false;
    this.recoverT = 0;   // >0 のあいだ「衝突から後退で復帰中」(プログラム指令を上書きして後退)
    this.recoverSteer = CONST.CENTER; // 復帰中の操舵方向 (開いている側へ)
    this.recoverN = 0; this.recoverX = 0; this.recoverY = 0; this.gaveUp = false; this.recoverCooldownT = 0; // Stage AK4/D5: 後退リカバリの袋小路ガード
    this.held = false; this.released = false; // Stage AK7: 発走の順次化(anti-pile-up)。前方に他車が居る間 held=発走保留・空けば released(ラッチ)
    this.slip = 0;       // ドリフト状態 0..1 (滑り具合。立ち上がり/収束はプロファイルのレート依存)
    this.slipSign = 1;   // 滑り方向 (+1=左旋回で右へ流れる)。舵を戻しても滑り終わるまで保持
    this.steerAngle = 0; // 実際の操舵角(rad)。steerRate で目標へ有限速度で動く (サーボ模擬)
    // 下り勾配による前進加速 (m/s^2)。峠コースで course から設定。0=平地 (通常コース)。
    this.downhill = (start && start.downhill) || 0;
    // 勾配の下り方向 (世界固定の fall-line 方位角 rad・AP10)。downhill を「常に車体前方」でなく
    // 世界方向ベクトルとして扱う参照軸。既定 0 (=世界+x)。course.start.slopeDir で上書き可 (未指定=0)。
    this.slopeDir = (start && start.slopeDir) || 0;
    // 路面グリップ係数 (1=ドライ標準, <1=低グリップ/ウェット)。低いほど限界が早く来て
    // オーバーステア車は滑りやすく、制動も伸びる。アンダーのFFは穏やかで御しやすい。
    this.grip = (start && start.grip) || 1;
    this.trail = [{ x: this.x, y: this.y }];
  }

  // 速度状態を完全に止める (衝突取り消し等)。動力学版は u/vlat/r も消すため、
  // 呼び出し側は car.v=0 ではなく必ずこれを使う (実装差を吸収する共通口)。
  halt() { this.v = 0; }

  // δ: 実際の操舵角(rad)。指令(3値)ではなく、サーボが追従中の現在角。
  get delta() { return this.steerAngle; }

  // 指令(3値)に対する目標舵角。
  get steerTarget() {
    if (this.steer === CONST.LEFT) return CAR.maxSteer;
    if (this.steer === CONST.RIGHT) return -CAR.maxSteer;
    return 0;
  }

  // 1 物理ステップ。操舵サーボ → 縦方向 (駆動/制動) → 横方向 (操舵/ドリフト/姿勢)。
  step(dt) {
    if (this.crashed) { this.v = 0; return; }
    const p = this.profile();
    const maxV = CAR.maxSpeed * p.maxSpeed;
    this._stepSteering(dt);
    const lon = this._stepLongitudinal(p, maxV, dt);
    this._stepLateral(p, lon, dt);
    this._recordTrail();
  }

  // 操舵サーボ: 実舵角を目標へ steerRate(rad/s) で近づける。
  // 3値指令を小刻みにオン/オフすると、ここで平均化されて中間舵角になる (デューティ操舵)。
  _stepSteering(dt) {
    const tgt = this.steerTarget;
    const maxd = CAR.steerRate * dt;
    this.steerAngle += Math.max(-maxd, Math.min(maxd, tgt - this.steerAngle));
  }

  // 縦方向: 目標速度への加減速。駆動方式の荷重/トラクション状態を返す。
  _stepLongitudinal(p, maxV, dt) {
    // 目標速度 (車種で最高速を変える)。FREE / BRAKE は 0 へ。
    const target = (this.pwm / 255) * maxV;
    let desired = 0;
    if (this.driveDir === CONST.FORWARD) desired = target;
    else if (this.driveDir === CONST.REVERSE) desired = -target;

    const thr = this.driveDir === CONST.FORWARD ? this.pwm / 255 : 0; // アクセル開度 0..1
    const sp0 = Math.min(1, Math.abs(this.v) / Math.max(0.05, maxV));
    const accelerating = this.driveDir === CONST.FORWARD && desired > this.v + 0.02;

    // 重さ係数 (基準比)。重い車は制動が伸びる。
    const massK = (p.mass || MASS_REF) / MASS_REF;

    // 加減速レート (車種で倍率)。FREE は惰行 (coast)、BRAKE は制動。
    let rate;
    if (this.driveDir === CONST.FORWARD || this.driveDir === CONST.REVERSE) {
      rate = CAR.accel * p.accel;
      // 発進ホイールスピン: 2WD は低速×高スロットルで駆動輪が空転し加速が鈍る。
      // FF は加速で前 (駆動) 輪の荷重が抜けて空転が大きく、FR はリアに荷重が乗り軽度、
      // 4WD は四輪で路面を掴むためほぼ空転しない。
      if (accelerating) {
        const gripLack = Math.max(0, 1 - sp0 / 0.3); // 停止時 1 → 最高速の3割で 0 (発進時のみ)
        rate *= 1 - p.spin * thr * gripLack;
      }
    } else if (this.driveDir === CONST.BRAKE) {
      // 低グリップでは制動距離が伸びる (タイヤが路面を掴めない)
      rate = CAR.brake * p.brake * (this.grip || 1) / (1 + MASS.brake * (massK - 1));
    } else {
      rate = CAR.coast;
    }

    const dv = desired - this.v, maxdv = rate * dt;
    this.v += Math.max(-maxdv, Math.min(maxdv, dv));

    // 下り勾配の重力 (前進方向への加速)。加速度は重量に依らない(g·sinθ)。駆動/制動とは別に働く。
    // AP10: 世界固定の下り方向 slopeDir へ向くベクトルとして車体前方へ射影 (gFwd=config.gForward・AP22 で3→1統合)。
    // 旧「常に車体前方」のコンベア (向き無関係・登り不能) を是正。登り向きは減速、theta=π で −downhill。
    // FREE 静止は転がり抵抗 CAR.coast を超える勾配でのみ転動開始 (defect③)、BRAKE 静止は保持 (現仕様)。
    // downhill===0 (平地・通常コース) は gFwd=0 で完全 no-op = byte 不変。
    const driven = this.driveDir === CONST.FORWARD || this.driveDir === CONST.REVERSE;
    const gFwd = gForward(this.downhill, this.theta, this.slopeDir);
    if (gFwd !== 0) {
      if (driven || Math.abs(this.v) > 1e-3) this.v += gFwd * dt;
      else if (this.driveDir === CONST.FREE) this.v += (gFwd - Math.sign(gFwd) * Math.min(CAR.coast, Math.abs(gFwd))) * dt;
    }

    if (Math.abs(this.v) < 1e-4) this.v = 0;

    const sp = Math.min(1, Math.abs(this.v) / Math.max(0.05, maxV)); // 正規化速度 0..1
    return {
      thr, accelerating, sp,
      // リフトオフ = アクセルOFF or 減速中 (荷重が前へ移りリアが軽くなる)
      liftOff: sp > 0.25 && (this.driveDir !== CONST.FORWARD || desired < this.v - 0.02),
      // 制動中 (BRAKE)。前荷重でリアが軽くなり挙動が乱れやすい
      braking: this.driveDir === CONST.BRAKE && sp > 0.25,
    };
  }

  // 横方向: 自転車モデル + 駆動方式特性 (アンダー/オーバーステア・ドリフト) で姿勢を更新。
  _stepLateral(p, { thr, accelerating, sp, liftOff, braking }, dt) {
    const d = this.delta;
    const yawKin = (this.v / CAR.wheelBase) * Math.tan(d);

    // 定常 + 荷重連動のアンダー/オーバーステア
    //   FF: アクセルONで前輪が駆動+操舵を兼ねて飽和 → powerUs で曲がらなくなる
    //   FR: アクセルONでリアのグリップが食われる → powerOs で巻き込む
    //   タックイン: アクセルOFF旋回で荷重が前に移り liftOffOs だけ回頭が増す
    //   制動: 前荷重でリアが軽くなり brakeOs だけ巻き込む (FR が顕著、FF は安定)
    // 重さ係数: 重い車は慣性が勝りアンダー(曲がりにくい)、軽い車は俊敏に向きを変える。
    // これが峠(連続ヘアピン)で効く。基準=1, 4WD>1, FR<1。
    const massUs = MASS.us * (((p.mass || MASS_REF) / MASS_REF) - 1);
    const usEff = p.us + p.powerUs * thr + Math.max(-0.3, massUs);
    const osEff = p.os + p.powerOs * thr + (liftOff ? p.liftOffOs : 0) + (braking ? p.brakeOs : 0);
    // 低グリップ時の非対称な効き: 実車で危険なのは「オーバーステア=リアが出てスピン」。
    // アンダーは膨らむだけで御しやすい。そこでウェットでは “オーバー側を強く” “アンダーは穏やかに”
    // 増幅する。→ パワーオーバーのFRやドリフト車はスピンして飛び、アンダーのFFは安全に曲がれる。
    // 低グリップでは「オーバーステア=リアが出てスピン」だけを強く増幅する。アンダーは膨らむだけで
    // リフトすれば前が再び食う=御せる(クラッシュしにくい)ので悪化させない。→ 雨ではテールの
    // 出る車(FRのパワーオーバー/ドリフト車)が飛び、アンダーのFFは安全に完走できる。
    const g = this.grip || 1;
    const spOver = Math.min(1.9, sp / g);   // 低グリップでオーバーを強く増幅(スピン誘発)
    let yaw = yawKin * p.yawGain * (1 + osEff * spOver) / (1 + usEff * sp);

    // ドリフト状態 (slip 0..1)。Step1: 単一PWM閾値ではなく「連続グリップ余裕」で滑り出す。
    //   要求(駆動 or 制動 × 速度) が grip を超えた分だけ滑り目標が 0..1 で連続的に立つ。
    //   slipSign(滑り方向) は滑り出し時に確定し滑走中は保持 → 逆ハン(カウンター)が
    //   回頭を打ち消して姿勢を安定させ、切り込み(同方向の舵)は滑りを深める。
    const D = p.drift;
    let slideK = p.slide;
    if (D) {
      const turning = Math.abs(d) > 0.02; // 実舵角が中立でない (スルー中は完全0が稀)
      // (1) グリップ余裕による滑り出し目標
      let load = 0;
      if (turning && sp >= D.minSp) {
        if (D.trigger === 'power') {
          const powerLoad = this.driveDir === CONST.FORWARD ? thr : 0;      // アクセル開度
          const brakeLoad = (D.brakeDrift && braking) ? 0.95 : 0;           // 旋回中の急制動
          load = Math.max(powerLoad, brakeLoad);
        } else { // liftoff (FF): アクセルOFF/減速で前荷重→リアが軽くなる。速いほど効く。
          load = liftOff ? (0.62 + 0.42 * sp) : 0;
        }
      }
      // 低グリップでは滑り出しの閾値が下がる (ウェットでは軽い操作でも流れ出す)
      let slipTarget = Math.max(0, Math.min(1, (load - D.grip * (this.grip || 1)) * D.gain));

      // (2) 滑走中の操舵による変調 (逆ハン=保持/安定, 切り込み=深化)
      const counter = this.slip > 0.05 && Math.abs(d) > 0.02 && Math.sign(d) !== this.slipSign;
      const sameDir = this.slip > 0.05 && Math.abs(d) > 0.02 && Math.sign(d) === this.slipSign;
      // 滑り方向へ切り込む=巻き込み深化 (パワースライド固有。FFのリフトオフ滑りは再加速で収束優先)
      if (sameDir && D.trigger === 'power') slipTarget = Math.max(slipTarget, 0.9);
      // counter のときは目標を保持寄りに (急に消さず、当て続けて滑り角を維持)
      if (counter) slipTarget = Math.max(slipTarget, this.slip * 0.85);

      // 立ち上がり attack / 回復 release。カウンター中は“当てて保持”=ゆっくり収束。
      // FF は再加速すると前輪が引っ張って倍速で収束。
      let slipRate = slipTarget > this.slip ? D.attack : (counter ? D.release * 0.5 : D.release);
      if (slipTarget < this.slip && D.trigger === 'liftoff' && accelerating) slipRate *= 2;
      const dslip = Math.max(-slipRate * dt, Math.min(slipRate * dt, slipTarget - this.slip));
      this.slip = Math.max(0, Math.min(1, this.slip + dslip));

      // 滑り方向は滑り出し時のみ確定 (舵では反転させない=逆ハンが効く鍵)
      if (this.slip < 0.05 && turning && yawKin !== 0) this.slipSign = Math.sign(yawKin);

      if (this.slip > 0.01) {
        // リアが流れる回頭 (slipYaw)。舵を戻しても滑り終わるまで車体は巻き込み続ける。
        // 逆ハンのときは上の yawKin が滑りと逆向きなので net 回頭が打ち消され姿勢が安定する。
        const yawRef = (Math.abs(this.v) / CAR.wheelBase) * Math.tan(CAR.maxSteer);
        yaw += this.slipSign * D.slipYaw * this.slip * yawRef * 0.6;
        slideK = p.slide + D.slipSlide * this.slip;
      }
    }

    // 横滑り: 旋回時に車体外側へ滑る。前進速度を超えないようクランプ。
    let slide = slideK * yaw * this.v;
    const cap = Math.abs(this.v);
    slide = Math.max(-cap, Math.min(cap, slide));
    this.x += (this.v * Math.cos(this.theta) + slide * Math.sin(this.theta)) * dt;
    this.y += (this.v * Math.sin(this.theta) - slide * Math.cos(this.theta)) * dt;
    this.theta += yaw * dt;
  }

  // 走行軌跡の記録。保持量は TRAIL.max (利用者調整可)。
  _recordTrail() {
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(this.x - last.x, this.y - last.y) > 0.01) {
      this.trail.push({ x: this.x, y: this.y });
      while (this.trail.length > TRAIL.max) this.trail.shift();
    }
  }

  // 車体4隅 (ワールド座標, m)。前方+x, 幅±width/2。
  corners() {
    const c = Math.cos(this.theta), s = Math.sin(this.theta);
    const front = CAR.length - CAR.rearToBack; // 後輪軸中心から前端まで
    const back = -CAR.rearToBack;
    const hw = CAR.width / 2;
    const pts = [
      { x: front, y: hw }, { x: front, y: -hw },
      { x: back, y: -hw }, { x: back, y: hw },
    ];
    return pts.map(p => ({ x: this.x + p.x * c - p.y * s, y: this.y + p.x * s + p.y * c }));
  }
}

// 車体4隅を線分壁 4 本に変換 ({x1,y1,x2,y2})。他車検知/車車衝突用。
export function carEdges(car) {
  const c = car.corners();
  return [
    { x1: c[0].x, y1: c[0].y, x2: c[1].x, y2: c[1].y },
    { x1: c[1].x, y1: c[1].y, x2: c[2].x, y2: c[2].y },
    { x1: c[2].x, y1: c[2].y, x2: c[3].x, y2: c[3].y },
    { x1: c[3].x, y1: c[3].y, x2: c[0].x, y2: c[0].y },
  ];
}

// 車4隅の車位置 (this.x,this.y=後輪軸中心) からの最大到達半径。前端 (len−rearToBack) と後端 (rearToBack)
// の遠い方と半幅 (width/2) の斜辺。壁がこの半径の AABB 外にあれば、全て AABB 内にある車エッジ (=隅を結ぶ
// 線分) と交差し得ない → 衝突候補から安全に除外できる (tight=最小の正しい半径・AP6 実測で候補 13.7× 削減)。
export function collisionReach() {
  return Math.hypot(Math.max(CAR.length - CAR.rearToBack, CAR.rearToBack), CAR.width / 2);
}

// 壁 + (任意) 追加線分 (他車の車体エッジ等) との衝突判定。
// AP6: 壁は車位置中心・半径 collisionReach() (車4隅の最大到達) の候補壁のみ検査する (細セル=2×車長の
// グリッド)。車エッジは全てこの半径内ゆえ AABB 外の壁は交差し得ない (=bool 不変)。等価性は wf_ao1_v2 の
// E 手法/専用ゲートで実証。壁数<32 は従来の全走査 (WALL_BP_MIN・受け入れ④)。extra (他車エッジ) は少数ゆえ
// 従来どおり全走査。
export function checkCollision(car, walls, extra = []) {
  const cs = car.corners();
  const edges = [[cs[0], cs[1]], [cs[1], cs[2]], [cs[2], cs[3]], [cs[3], cs[0]]];
  const test = (segs) => {
    for (const w of segs) {
      const wa = { x: w.x1, y: w.y1 }, wb = { x: w.x2, y: w.y2 };
      for (const [p, q] of edges) if (segIntersect(p, q, wa, wb)) return true;
    }
    return false;
  };
  const cand = wallsNear(walls, car.x, car.y, collisionReach(), 2 * CAR.length);
  return test(cand) || (extra.length > 0 && test(extra));
}
