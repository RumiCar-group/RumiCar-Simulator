// AO10 自己位置推定 常設アサートゲート＋検証オラクル (AO_spec §9.1・§12 AO10)。
//
// 検証する主張 (知覚→測定・CI-14):
//  「ToF×3+エンコーダだけで "今コースのどこにいるか" を1次元ヒストグラムフィルタで当てられる」
//   → 失敗述語: 推定弧長 ŝ と 真の弧長 (エンジン側=コース幾何の射影) の誤差 RMSE (bin/実距離)。
//  「壁測定は位置に・地図差分は他車に (残差ゲーティング)」→ 前方他車の検知 recall と、他車近接でも発散しない。
//  「地図事前分布つき β 再挑戦」→ J-1 と同一基準 (MAE≤15° かつ 符号一致≥80%) で go/no-go を記録。
//
// オラクルの真値 (プログラム非公開=D-1): 競技サーキット(superellipse track)の中心線を解析再構成し
//  (finish 中点から平行移動量を厳密導出・_ao10_geom で検証済=壁間 13.93–14.00m/halfW14)、
//  車位置 (car.x,car.y) を中心線へ射影して真の周回弧長 φ_geo を得る。プログラムの推定は runRace の
//  probe フックで interp.global.vars を読むだけ (本番物理に不干渉=byte 不変)。bin↔幾何 warp
//  (レーシングラインのコーン取りで odo 弧長は中心線より ~12% 短い) は「binPhi 較正」(phase0 に
//  fine バケツ→真φ を実測) で吸収する=代理量でなく実態で測る (CI-14)。
//
// 1つでも受け入れ基準を割ったら exit(1)。
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';   // 出荷本体 (comp_localize) を検証 (CI-9)

// ───────────────────────── 1. comp_localize プログラム源 (Python) ─────────────────────────
// 反応駆動 (毎周同一ライン=指紋が周回間で再現。実測: 同φ周回間差 ΔC~3100/ΔL~1950 ≪ 1bin あたり
//  読み変化 ΔC~11000 ⇒ SNR 2-3倍) + loop closure (開始指紋一致で「1周した」を検出=full lap 較正) +
//  1次元ヒストグラムフィルタ (予測=エンコーダ前進・観測=指紋残差カーネル)。有理演算のみ (interp 安全)。
const NMAXF = 160;
function jsArr(n, v) { return '[' + Array(n).fill(v).join(', ') + ']'; }
function buildLocalizeCode() {
  return `# Self-Locator — ToF×3 + 車輪エンコーダで「今コースのどこにいるか」を1次元ヒストグラムフィルタで推定する  [競技 / フルスケール・Python・要エンコーダ]  by Opus 4.8
# ★領域=フルスケール / コース=競技サーキット / 車=ノーマルFF / 車輪エンコーダ(任意)ON★
# 実車の自己位置推定を ToF×3+エンコーダだけで再現する研究/競技サンプル。絶対位置・方位は与えられない(D-1)。
#   1周目(試走): 反応走行しながら「スタートからの距離」を目盛りに、各地点の前方/左右の壁距離を
#                「指紋(fingerprint)」として記録する。スタート地点の壁パターンも覚える。
#   周回検出=loop closure: 十分走って方位が一周ぶん回り、かつ「今の壁パターンが覚えたスタートの
#                パターンに戻った」ら1周完了とみなす(実車のループ閉じ込み)。1周の距離 LAPLEN が確定。
#   2周目以降(本番): 前方3センサーの今の値を各目盛りの指紋と照合し、どの目盛り(=弧長)に居るかを
#                確率分布(ヒストグラム)で追跡する。予測=エンコーダで分布を前へ、観測=指紋残差
#                k=1/(1+(err/σ)^2) で重み付け→正規化。推定 ŝ=分布のピーク近傍の加重平均・信頼度=ピーク比。
#   他車分離(残差ゲーティング): 「壁測定は位置に・地図差分は他車に」。前方/側方が覚えた壁より有意に
#                近ければ そこに他車(その channel は位置更新から外す=他車が居ても位置は発散しない)。
# ★毎周おなじ反応ラインで走る(先読みで線を変えない)=指紋が周回間で再現し照合が効く。速さより
#   「自分がどこに居るか正確に知る」ことを見せるサンプル(先読み最速化は Apex Strategist へ)。★
# ★D-1: 学習側は ToF×3 + 任意エンコーダのみ。位置は自前計測の学習物(コースデータは渡されない)。★
# 走行(反応)定数
CONF=150000
D_TURN=16000
D_MID=22000
D_OPEN=33000
BIAS=2000
TOP=91
MID=72
SLOW=53
TCAP=58
CLOSE=1600
BRK=240
# 自己位置(loop closure)定数
BLF=380
NF=${NMAXF}
LAP_MIN_S=30000
LAP_HDG=6300
CLOSURE=4000
MINWAIT=6
# 観測カーネルσ² (残差の効き。σ大=甘い・小=多峰へ発散)
SC2=64000000
SS2=100000000
CARGAP2=9000
DT=0.05
WIN=7
GAIN=0.05
# 指紋(fine バケツ)・ヒストグラム
fpC=${jsArr(NMAXF, 99000)}
fpL=${jsArr(NMAXF, 99000)}
fpR=${jsArr(NMAXF, 99000)}
fpN=${jsArr(NMAXF, 0)}
w=${jsArr(NMAXF, 0)}
wt=${jsArr(NMAXF, 0)}
LAPLEN=0
LAPBF=0
lp=0
s=0
sl=0
hdg=0
prevC=0
started=0
sc=0
fs0C=0
fs0L=0
fs0R=0
lstart=0
armed=0
mmin=999999
mminSl=0
sinceMin=0
mdbg=0
estb=0
ests=0
conf=0
carF=0
carL=0
carR=0
pe=0
betaEst=0
betaN=0

def setup():
    global LAPLEN, LAPBF, lp, s, sl, hdg, prevC, started, sc, fs0C, fs0L, fs0R, lstart, armed, mmin, mminSl, sinceMin, mdbg, estb, ests, conf, carF, carL, carR, pe, betaEst, betaN
    RC_setup()
    LAPLEN=0
    LAPBF=0
    lp=0
    s=0
    sl=0
    hdg=0
    prevC=0
    started=0
    sc=0
    fs0C=0
    fs0L=0
    fs0R=0
    lstart=0
    armed=0
    mmin=999999
    mminSl=0
    sinceMin=0
    mdbg=0
    estb=0
    ests=0
    conf=0
    carF=0
    carL=0
    carR=0
    pe=0
    betaEst=0
    betaN=0
    for i in range(NF):
        fpC[i]=99000
        fpL[i]=99000
        fpR[i]=99000
        fpN[i]=0
        w[i]=0
        wt[i]=0

def loop():
    global LAPLEN, LAPBF, lp, s, sl, hdg, prevC, started, sc, fs0C, fs0L, fs0R, lstart, armed, mmin, mminSl, sinceMin, mdbg, estb, ests, conf, carF, carL, carR, pe, betaEst, betaN
    v=RC_wheel_speed(REAR)
    if v<0:
        v=0
    s=s+v
    sl=sl+v
    L=RC_read(LEFT)
    C=RC_read(CENTER)
    R=RC_read(RIGHT)
    if L<0 or L>CONF:
        L=99000
    if C<0 or C>CONF:
        C=99000
    if R<0 or R>CONF:
        R=99000
    dC=0
    if started==1:
        dC=prevC-C
    prevC=C
    started=1
    # ── 反応走行 (毎周同一ライン=指紋再現性の源) ──
    turning=1
    st=0
    dir=CENTER
    if C<D_TURN:
        if L>R:
            dir=LEFT
            st=1
        else:
            dir=RIGHT
            st=0-1
    elif L-R>BIAS:
        dir=LEFT
        st=1
    elif R-L>BIAS:
        dir=RIGHT
        st=0-1
    else:
        dir=CENTER
        turning=0
    sc=sc+1
    if turning==1 and (sc%2)<1:
        RC_steer(dir)
    else:
        RC_steer(CENTER)
    hdg=hdg+st*v
    pwm=SLOW
    if C>D_OPEN:
        pwm=TOP
    elif C>D_MID:
        pwm=MID
    if turning==1 and pwm>TCAP:
        pwm=TCAP
    if dC>CLOSE and C<D_OPEN:
        RC_drive(BRAKE,BRK)
    else:
        RC_drive(FORWARD,pwm)
    # ── 指紋づくり (fine バケツ・lap-local 弧長 sl 目盛り・初回入場時に1回) ──
    bf=sl//BLF
    if bf<0:
        bf=0
    if bf>=NF:
        bf=NF-1
    if lstart==0:
        fs0C=C
        fs0L=L
        fs0R=R
        lstart=1
    if lp==0:
        if fpN[bf]==0:
            fpC[bf]=C
            fpL[bf]=L
            fpR[bf]=R
            fpN[bf]=1
    # ── loop closure (局所最小): 方位が一周ぶん回ったら武装し、スタート指紋との差 match が「最小」に
    #    なった点=真のスタート(=φ1.0)で1周確定。単なる閾値割れは対称ゴーストで早発火するので最小追跡。──
    match=abs(C-fs0C)+abs(L-fs0L)+abs(R-fs0R)
    mdbg=match
    # 武装 = 方位が一周ぶん回った。以後 スタート壁パターンとの差 match が「局所最小」になった点=スタート
    #   復帰 で1周を確定 (単なる閾値割れは対称ゴーストで早発火するので最小追跡)。実測: 周回内の相対位置は
    #   in-sample 0.30bin と高精度。絶対原点は閉じ込み点の ToF ノイズで周ごとに ~2.5bin ブレる (held-out
    #   2.59bin) =この差が loop closure の原点精度限界 (docs/stage_ao/localize_result.md)。
    if sl>LAP_MIN_S and (hdg>LAP_HDG or hdg<0-LAP_HDG):
        armed=1
    if armed==1:
        if match<mmin:
            mmin=match
            mminSl=sl
            sinceMin=0
        else:
            sinceMin=sinceMin+1
        # 最小を過ぎ (match が再上昇) かつ最小が十分小さいなら発火。LAPLEN=mminSl (真の1周長)。
        if sinceMin>MINWAIT and mmin<CLOSURE:
            if lp==0:
                LAPLEN=mminSl
                LAPBF=mminSl//BLF
                if LAPBF<1:
                    LAPBF=1
                if LAPBF>=NF:
                    LAPBF=NF-1
                i=0
                while i<LAPBF:
                    if fpN[i]==0:
                        pj=i-1
                        if pj<0:
                            pj=LAPBF-1
                        fpC[i]=fpC[pj]
                        fpL[i]=fpL[pj]
                        fpR[i]=fpR[pj]
                    w[i]=0.0
                    i=i+1
                lp=1
                Serial.println("localizer ready: " + LAPBF + " bins (loop closed)")
            # 再アンカー: sl を「最小からの走行ぶん」へ (=真スタートから今までの距離)。信念もそこへ。
            sl=sl-mminSl
            bb=sl//BLF
            if bb<0:
                bb=0
            if bb>=LAPBF:
                bb=LAPBF-1
            estb=bb
            i=0
            while i<LAPBF:
                if i==bb:
                    w[i]=1.0
                else:
                    w[i]=0.0
                i=i+1
            armed=0
            mmin=999999
            sinceMin=0
    # ============ 自己位置推定 (lp==1・ヒストグラムフィルタ) ============
    if lp==1:
        # 予測: エンコーダで前進 dsb ビン (小数)。前方移流 + 小拡散。
        dsb=v/BLF
        if dsb<0:
            dsb=0
        if dsb>0.9:
            dsb=0.9
        i=0
        while i<LAPBF:
            wt[i]=w[i]
            i=i+1
        i=0
        while i<LAPBF:
            jm=i-1
            if jm<0:
                jm=LAPBF-1
            jp=i+1
            if jp>=LAPBF:
                jp=0
            w[i]=(1-dsb)*wt[i]+dsb*wt[jm]
            w[i]=0.96*w[i]+0.02*wt[jm]+0.02*wt[jp]
            i=i+1
        # 他車ゲーティング (現ベスト bin の指紋より有意に近ければ その channel は位置更新から除外)
        cb=floor(estb)
        if cb<0:
            cb=0
        if cb>=LAPBF:
            cb=LAPBF-1
        useC=1
        useL=1
        useR=1
        if C<fpC[cb]-CARGAP2:
            useC=0
        if L<fpL[cb]-CARGAP2:
            useL=0
        if R<fpR[cb]-CARGAP2:
            useR=0
        # 観測: 指紋残差 → 有理カーネル k=1/(1+err)。ソフト適用 w*=(SOFTA+SOFTB*k) で1tick の
        #   誤マッチ(知覚エイリアシング=別地点が似て見える)では信念が飛ばず、持続証拠で徐々に収束させる。
        i=0
        while i<LAPBF:
            err=0
            if useC==1:
                d0=C-fpC[i]
                err=err+d0*d0/SC2
            if useL==1:
                d1=L-fpL[i]
                err=err+d1*d1/SS2
            if useR==1:
                d2=R-fpR[i]
                err=err+d2*d2/SS2
            kk=1/(1+err)
            w[i]=w[i]*(0.6+0.4*kk)
            i=i+1
        # 正規化 (総和ガード)
        sm=0
        i=0
        while i<LAPBF:
            sm=sm+w[i]
            i=i+1
        if sm<0.000000001:
            i=0
            while i<LAPBF:
                w[i]=1.0/LAPBF
                i=i+1
            sm=1.0
        i=0
        while i<LAPBF:
            w[i]=w[i]/sm
            i=i+1
        # 推定 ŝ = オドメトリ位置 (=lap-local 弧長 sl の bin・毎周 loop closure で再アンカー=高精度な骨格)
        #   を中心に、その ±WIN 窓内の地図照合ピークへ GAIN だけ寄せる (=有界な地図補正)。実測で ToF 照合
        #   はこの清潔コースでエンコーダに勝てない (観測は追従ノイズを足す) ため、骨格をオドメトリに固定し
        #   観測は「軽い補正＋信頼度・他車ゲーティングの源」に留める (docs/stage_ao/localize_result.md・CI-14)。
        center=sl/BLF
        if center<0:
            center=0
        if center>=LAPBF:
            center=center%LAPBF
        c0=floor(center)
        if c0<0:
            c0=0
        if c0>=LAPBF:
            c0=LAPBF-1
        pk=0
        pi=c0
        jw=0-WIN
        while jw<=WIN:
            kw=(c0+jw)%LAPBF
            if kw<0:
                kw=kw+LAPBF
            if w[kw]>pk:
                pk=w[kw]
                pi=kw
            jw=jw+1
        csum=0
        wsum=0
        jj=0-3
        while jj<=3:
            kk=(pi+jj)%LAPBF
            if kk<0:
                kk=kk+LAPBF
            csum=csum+w[kk]*jj
            wsum=wsum+w[kk]
            jj=jj+1
        off=0
        if wsum>0:
            off=csum/wsum
        estRaw=pi+off
        # 相補フィルタ: 出力=オドメトリ予測 + GAIN×(観測ピーク−予測) の円環ブレンド。オドメトリ(=予測)は
        #   滑らかで既に高精度なので主体にし、観測は「遅いドリフト補正」として少しだけ効かせる(観測ノイズを
        #   出力へ持ち込まない=正しいベイズ融合は予測のみより悪化しない)。
        diff=estRaw-center
        if diff>LAPBF/2:
            diff=diff-LAPBF
        if diff<0-LAPBF/2:
            diff=diff+LAPBF
        estb=center+GAIN*diff
        if estb<0:
            estb=estb+LAPBF
        if estb>=LAPBF:
            estb=estb-LAPBF
        ests=estb*BLF
        conf=pk
        # 他車フラグ (recall 用・driver は他車回避しないがフラグは出す)
        carF=0
        carL=0
        carR=0
        if useC==0:
            carF=1
        if useL==0:
            carL=1
        if useR==0:
            carR=1
        # (毎周の再アンカーは上の loop closure 局所最小で sl をリセット=信念もスタートへ再同期済)
        # ── β 再挑戦 (地図事前分布つき・実験): レコンライン からの横ずれ e とそのレート ──
        cbf=floor(estb)
        if cbf<0:
            cbf=0
        if cbf>=LAPBF:
            cbf=LAPBF-1
        if useL==1 and useR==1 and v>3:
            e=((fpL[cbf]-L)+(R-fpR[cbf]))/2
            de=e-pe
            pe=e
            braw=atan2(de/1000/DT,v)*57.29578
            betaEst=0.7*betaEst+0.3*braw
            betaN=betaN+1
        if (sc%10)==0:
            Serial.println("pos=bin " + round(estb) + "/" + LAPBF + " conf=" + round(conf*100) + "%")
`;
}

// ───────────────────────── 2. オラクル幾何 (中心線再構成・射影・弧長) ─────────────────────────
const CIRCUIT_SPEC = { name: '競技サーキット (フルスケール)', kind: 'track', shape: 'superellipse', rx: 360, ry: 230, k: 0.55, width: 28, samples: 160 };
function buildCenterline(course, spec, M = 2000) {
  const sg = (v) => (v < 0 ? -1 : 1);
  const se = (t) => [spec.rx * sg(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), spec.k),
                     spec.ry * sg(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), spec.k)];
  const f = course.finish, cl0 = se(0);
  const shx = (f.x1 + f.x2) / 2 - cl0[0], shy = (f.y1 + f.y2) / 2 - cl0[1];
  const pts = [];
  for (let i = 0; i < M; i++) { const p = se(2 * Math.PI * i / M); pts.push([p[0] + shx, p[1] + shy]); }
  const cum = [0];
  for (let i = 1; i <= M; i++) { const a = pts[(i - 1) % M], b = pts[i % M]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  return { pts, cum, perim: cum[M], M };
}
function projectArc(cl, x, y, hint) {
  const { pts, cum, M } = cl;
  let best = Infinity, bi = 0, bt = 0;
  const lo = hint == null ? 0 : hint - 40, hi = hint == null ? M : hint + 40;
  for (let ii = lo; ii < hi; ii++) {
    const i = ((ii % M) + M) % M, j = (i + 1) % M;
    const ax = pts[i][0], ay = pts[i][1], bx = pts[j][0], by = pts[j][1];
    const ex = bx - ax, ey = by - ay, len2 = ex * ex + ey * ey || 1e-9;
    let tt = ((x - ax) * ex + (y - ay) * ey) / len2; if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
    const px = ax + ex * tt, py = ay + ey * tt, d = (px - x) * (px - x) + (py - y) * (py - y);
    if (d < best) { best = d; bi = i; bt = tt; }
  }
  return { arc: cum[bi] + (cum[bi + 1] - cum[bi]) * bt, seg: bi, dist: Math.sqrt(best) };
}

// ───────────────────────── 3. 実行＋観測 (runRace + probe) ─────────────────────────
const circuit = buildFromSpec(CIRCUIT_SPEC);
const cl = buildCenterline(circuit, CIRCUIT_SPEC);
// 出荷本体を検証 (CI-9)。buildLocalizeCode は provenance 記録用に残置 (呼ばない=出荷 programs.js が正)。
const localizeSrc = PROGRAMS.find((p) => p.key === 'comp_localize').code;
const BLF = 380;

// targets: 観測する車の番号（1 回の走りで複数の車を記録できる＝同じレースの別の車を比べるのに走り直さない）。rows は targets[0] の記録。
//   【BH5・2026-10-05】行に run（その車が走行中＝完走・リタイアの後は 0）と near（走行中の他車が 22 m 以内にいる）を足し、
//   carsAheadTrue は**走行中の他車**だけで数える（完走して外れた車はセンサーに映らない＝BG2）。
function runLocalize({ field, laps = 3, interact = false, target = 0, targets = null, recon = null }) {
  const T = targets || [target];
  const rowsBy = new Map(T.map((t) => [t, []]));
  const hints = new Array(field.length).fill(null);
  const unwrap = new Array(field.length).fill(null);
  const probe = (tick, slots) => {
    for (const target of T) {
      const s = slots[target];
      const g = s.controller.interp.global.vars;
      const pr = projectArc(cl, s.car.x, s.car.y, hints[target]);
      hints[target] = pr.seg;
      let uw = unwrap[target];
      if (uw == null) { uw = { cum: 0, prev: pr.arc }; unwrap[target] = uw; }
      let d = pr.arc - uw.prev; if (d < -cl.perim / 2) d += cl.perim; else if (d > cl.perim / 2) d -= cl.perim;
      uw.cum += d; uw.prev = pr.arc;
      let carsAheadTrue = 0, near = 0;
      for (let k = 0; k < slots.length; k++) {
        if (k === target || !slots[k].running) continue;
        const o = slots[k].car; const dx = o.x - s.car.x, dy = o.y - s.car.y;
        if (Math.hypot(dx, dy) > 22) continue;
        near = 1;
        const fwd = Math.cos(s.car.theta) * dx + Math.sin(s.car.theta) * dy;
        const lat = -Math.sin(s.car.theta) * dx + Math.cos(s.car.theta) * dy;
        if (fwd > 0 && Math.abs(Math.atan2(lat, fwd)) < 0.35) carsAheadTrue = 1;
      }
      const tb = (Math.abs(s.car.u) > 0.03 || Math.abs(s.car.vlat) > 0.03) ? Math.atan2(s.car.vlat, s.car.u) * 180 / Math.PI : 0;
      if (process.env.AO10_LAPDBG && target === 0 && g.lp === 0 && tick % 30 === 0) {
        const frac = (((uw.cum - (unwrap[0]._u0 ?? (unwrap[0]._u0 = uw.cum))) / cl.perim) % 1 + 1) % 1;
        if (frac > 0.90 || frac < 0.12) console.error(`  φ=${frac.toFixed(3)} sl=${Math.round(g.sl)} hdg=${Math.round(g.hdg)} match=${Math.round(g.mdbg)} armed=${g.armed} mmin=${Math.round(g.mmin)} lp=${g.lp}`);
      }
      rowsBy.get(target).push({ tick, laps: s.lap.laps, uarc: uw.cum, estb: g.estb, conf: g.conf, LAPBF: g.LAPBF, LAPLEN: g.LAPLEN,
        lp: g.lp, s: g.s, sl: g.sl, carF: g.carF, betaEst: g.betaEst, betaN: g.betaN, trueBeta: tb,
        steps: s.controller.interp.steps, carsAheadTrue, run: s.running ? 1 : 0, near });
    }
  };
  const r = runRace({ physics: 'v2', regime: 'fullscale', course: circuit, laps, interact,
    crashRule: { rejoin: true, penaltySec: 3 }, maxSec: 600, report: true, probe, field, recon });
  return { r, rows: rowsBy.get(T[0]), rowsBy };
}
// 6 台レース中の位置推定を「別の周で較正」して測る（較正＝本番の 2 周目 laps==1。採点＝それ以外の全部の周＝他車が近くにいる 1 周目を含む・
//   走行中の行だけ）＋前方検知 recall／誤報率。周をまたぐずれ（原点が動く・真位置と無関係に進む）は、ここの誤差の最大に出る。
function scoreMulti(rows, target) {
  const R = rows.filter((r) => r.lp === 1);
  if (!R.length) return null;
  const LAPBF = R[0].LAPBF;
  const uarc0 = rows[0].uarc;
  const trueFracOf = (r) => (((r.uarc - uarc0) / cl.perim) % 1 + 1) % 1;
  const circd = (a, b) => { let d = Math.abs(a - b) % 1; if (d > 0.5) d = 1 - d; return d; };
  const laps = [...new Set(R.map((r) => r.laps))].sort((a, b) => a - b);
  const calibLap = laps.find((l) => l >= 1);
  const scoreLapSet = laps.filter((l) => l !== calibLap);   // 【BH5】1 周目 (laps==0) も採点する（それまでは較正の周より後だけ）
  if (!scoreLapSet.length) return null;
  const VX = new Array(LAPBF).fill(0), VY = new Array(LAPBF).fill(0), N = new Array(LAPBF).fill(0);
  for (const r of R) { if (r.laps !== calibLap) continue; const b = ((Math.floor(r.estb) % LAPBF) + LAPBF) % LAPBF;
    const a = 2 * Math.PI * trueFracOf(r); VX[b] += Math.cos(a); VY[b] += Math.sin(a); N[b]++; }
  const phi = new Array(LAPBF).fill(null);
  for (let b = 0; b < LAPBF; b++) if (N[b] > 0) { let a = Math.atan2(VY[b], VX[b]); if (a < 0) a += 2 * Math.PI; phi[b] = a / (2 * Math.PI); }
  for (let b = 0; b < LAPBF; b++) if (phi[b] == null) { for (let k = 1; k < LAPBF; k++) { const pj = ((b - k) % LAPBF + LAPBF) % LAPBF; if (phi[pj] != null) { phi[b] = phi[pj]; break; } } }
  const phiAt = (fb) => { const b0 = ((Math.floor(fb) % LAPBF) + LAPBF) % LAPBF; return phi[b0]; };
  const err = [];
  let carTrue = 0, carHit = 0, noCar = 0, falseHit = 0;
  for (const r of R) {
    // 前方検知は走行中の tick だけで数える（完走後は carF が最後の値のまま止まる）。誤報率＝前に車がいない tick で carF が立つ割合（記録）。
    if (r.run) { if (r.carsAheadTrue) { carTrue++; if (r.carF) carHit++; } else { noCar++; if (r.carF) falseHit++; } }
    if (!r.run || !scoreLapSet.includes(r.laps)) continue;   // 完走後（推定が止まったまま惰行する）の行は採点しない
    const p = phiAt(r.estb); if (p != null) err.push(circd(p, trueFracOf(r)) * LAPBF);
  }
  const rms = err.length ? Math.sqrt(err.reduce((t, v) => t + v * v, 0) / err.length) : null;
  const maxErr = err.length ? Math.max(...err) : null;
  return { rms, maxErr, binLenM: cl.perim / LAPBF, recall: carTrue ? carHit / carTrue : null, carTrue, falseRate: noCar ? falseHit / noCar : null, noCar, LAPBF };
}
// 【BH5・2026-10-05】6 台レース中の **周回内** の位置推定: 同じ周で bin→真φ を較正して同じ周を採点する（単独走行の章の「周回内 相対位置」と
//   同じ考え方＝原点の取り直しの精度に左右されない・lookahead に効く量。こちらは bin の中を補間せず、本番の全周を周ごとに出して最大を取る）。
//   走行中の行だけ・10 秒に満たない周（端数）は採点しない。near＝採点した周で、走行中の他車が 22 m 以内にいた tick（「他車近接下」の実体）。
//   ⚠ この測り方は、周をまたぐずれ（原点が周ごとに動く・その周の間じゅう一様にずれる）を見ない。それは scoreMulti の「別の周で較正した誤差の最大」で見る。
function scoreMultiIn(rows, lapsTotal) {
  const R = rows.filter((r) => r.lp === 1 && r.run);
  if (!R.length) return null;
  const LAPBF = R[0].LAPBF;
  const uarc0 = rows[0].uarc;
  const trueFracOf = (r) => (((r.uarc - uarc0) / cl.perim) % 1 + 1) % 1;
  const circd = (a, b) => { let d = Math.abs(a - b) % 1; if (d > 0.5) d = 1 - d; return d; };
  const binOf = (r) => ((Math.floor(r.estb) % LAPBF) + LAPBF) % LAPBF;
  const per = [];
  for (const lap of [...new Set(R.map((r) => r.laps))].sort((a, b) => a - b)) {
    if (lap < 0 || lap > lapsTotal - 1) continue;
    const Q = R.filter((r) => r.laps === lap);
    if (Q.length < 600) continue;
    const VX = new Array(LAPBF).fill(0), VY = new Array(LAPBF).fill(0);
    for (const r of Q) { const b = binOf(r), a = 2 * Math.PI * trueFracOf(r); VX[b] += Math.cos(a); VY[b] += Math.sin(a); }
    const err = [];
    for (const r of Q) { const b = binOf(r); let a = Math.atan2(VY[b], VX[b]); if (a < 0) a += 2 * Math.PI; err.push(circd(a / (2 * Math.PI), trueFracOf(r)) * LAPBF); }
    per.push({ lap, rms: Math.sqrt(err.reduce((t, v) => t + v * v, 0) / err.length), max: Math.max(...err), n: err.length, near: Q.reduce((t, r) => t + (r.near ? 1 : 0), 0) });
  }
  if (!per.length) return null;
  return { per, rmsMax: Math.max(...per.map((x) => x.rms)), near: per.reduce((t, x) => t + x.near, 0), LAPBF };
}

// ───────────────────────── 4. スコアリング (frame 較正=held-out) ─────────────────────────
// プログラムの推定 estb は「自己の一貫した座標系」(原点=loop closure 点・warp 込)。実位置知覚の
// 測定は「推定が真位置の一貫した関数か」= 較正ラップ(lap2)で bin→真φ の写像を学習し、別ラップ
// (lap3+)で残差を測る(=原点/warp は座標変換として除去し、追従ノイズだけを測る=真の位置推定精度)。
function scoreLocalize(rows) {
  let LAPBF = 0, LAPLEN = 0;
  for (const r of rows) if (r.lp === 1) { LAPBF = r.LAPBF; LAPLEN = r.LAPLEN; break; }
  if (!LAPBF) return null;
  const uarc0 = rows[0].uarc;
  const trueFracOf = (r) => (((r.uarc - uarc0) / cl.perim) % 1 + 1) % 1;
  const circd = (a, b) => { let d = Math.abs(a - b) % 1; if (d > 0.5) d = 1 - d; return d; };
  // bin→φ 写像を較正ラップから円環平均で学習し、円環補間で引く関数を返す。
  const calibrate = (calibLap, binOf) => {
    const VX = new Array(LAPBF).fill(0), VY = new Array(LAPBF).fill(0), N = new Array(LAPBF).fill(0);
    for (const r of rows) { if (r.lp !== 1 || r.laps !== calibLap) continue; const b = binOf(r); if (b < 0 || b >= LAPBF) continue;
      const a = 2 * Math.PI * trueFracOf(r); VX[b] += Math.cos(a); VY[b] += Math.sin(a); N[b]++; }
    const phi = new Array(LAPBF).fill(null);
    for (let b = 0; b < LAPBF; b++) if (N[b] > 0) { let a = Math.atan2(VY[b], VX[b]); if (a < 0) a += 2 * Math.PI; phi[b] = a / (2 * Math.PI); }
    for (let b = 0; b < LAPBF; b++) if (phi[b] == null) { for (let k = 1; k < LAPBF; k++) { const pj = ((b - k) % LAPBF + LAPBF) % LAPBF; if (phi[pj] != null) { phi[b] = phi[pj]; break; } } }
    return (fb) => { const b0 = ((Math.floor(fb) % LAPBF) + LAPBF) % LAPBF, b1 = (b0 + 1) % LAPBF, ft = fb - Math.floor(fb);
      let p0 = phi[b0], p1 = phi[b1]; if (p0 == null || p1 == null) return p0 == null ? p1 : p0;
      let d = p1 - p0; if (d < -0.5) d += 1; else if (d > 0.5) d -= 1; return ((p0 + d * ft) % 1 + 1) % 1; };
  };
  // 較正=lap2、採点=lap3以降 (held-out)。lap が足りなければ全 lp==1 で自己較正 (下限報告)。
  const scoreLaps = [...new Set(rows.filter((r) => r.lp === 1).map((r) => r.laps))].filter((l) => l >= 3);
  const calibLap = 2;
  const phiEstAt = calibrate(calibLap, (r) => ((Math.floor(r.estb) % LAPBF) + LAPBF) % LAPBF);
  const phiDRAt = calibrate(calibLap, (r) => ((Math.floor(r.sl / BLF) % LAPBF) + LAPBF) % LAPBF);
  // 診断: DR を「同一ラップで較正＆採点」(in-sample) すると再アンカー原点ずれが消える=within-lap
  //  ドリフトのみ。held-out との差が「ラップ間の再アンカー jitter」寄与。
  const phiDR_L3 = calibrate(3, (r) => ((Math.floor(r.sl / BLF) % LAPBF) + LAPBF) % LAPBF);
  const phiEst_L3 = calibrate(3, (r) => ((Math.floor(r.estb) % LAPBF) + LAPBF) % LAPBF);
  const errDRin = [], errGin = [];
  for (const r of rows) { if (r.lp !== 1 || r.laps !== 3) continue;
    errDRin.push(circd(phiDR_L3(((Math.floor(r.sl / BLF) % LAPBF) + LAPBF) % LAPBF), trueFracOf(r)) * LAPBF);
    errGin.push(circd(phiEst_L3(r.estb), trueFracOf(r)) * LAPBF); }
  const errG = [], errDR = [];
  let sumBudget = 0, nBudget = 0, maxBudget = 0;
  for (const r of rows) {
    if (r.lp !== 1) continue;
    if (r.steps > 0) { sumBudget += r.steps; nBudget++; if (r.steps > maxBudget) maxBudget = r.steps; }
    if (!scoreLaps.includes(r.laps)) continue;
    const tf = trueFracOf(r);
    errG.push(circd(phiEstAt(r.estb), tf) * LAPBF);
    errDR.push(circd(phiDRAt(((Math.floor(r.sl / BLF) % LAPBF) + LAPBF) % LAPBF), tf) * LAPBF);
    if (process.env.AO10_DBG && rows.indexOf(r) % 40 === 0)
      console.error(`  lap${r.laps} trueφ=${tf.toFixed(3)} estb=${r.estb.toFixed(1)} phiEst=${phiEstAt(r.estb).toFixed(3)} conf=${(r.conf * 100).toFixed(0)}% errG=${(circd(phiEstAt(r.estb), tf) * LAPBF).toFixed(1)}`);
  }
  const stat = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const rms = Math.sqrt(a.reduce((t, v) => t + v * v, 0) / a.length); return { rms, p95: s[Math.floor(0.95 * (s.length - 1))], max: s[s.length - 1], n: a.length }; };
  let carTrue = 0, carHit = 0;
  for (const r of rows) { if (r.lp !== 1) continue; if (r.carsAheadTrue) { carTrue++; if (r.carF) carHit++; } }
  let bAbs = 0, bN = 0, bSign = 0, bSignN = 0;
  for (const r of rows) { if (r.lp !== 1 || r.betaN == null || r.betaN < 3) continue;
    bAbs += Math.abs(r.betaEst - r.trueBeta); bN++;
    if (Math.abs(r.trueBeta) > 1.5) { bSignN++; if (Math.sign(r.betaEst) === Math.sign(r.trueBeta)) bSign++; } }
  return { LAPBF, LAPLEN, binLenM: cl.perim / LAPBF, scoreLaps,
    G: stat(errG), dr: stat(errDR), drIn: stat(errDRin), gIn: stat(errGin),
    budget: { avg: nBudget ? sumBudget / nBudget : 0, max: maxBudget },
    recall: carTrue ? carHit / carTrue : null, carTrue,
    beta: { mae: bN ? bAbs / bN : null, signRate: bSignN ? bSign / bSignN : null, n: bN, signN: bSignN } };
}

// ───────────────────────── 5. 実行 ─────────────────────────
const rr = { name: 'LOC', lang: 'py', src: localizeSrc, carType: 'normal_ff', rear: false, encoder: true };
console.log('=== comp_localize 単独走行 (競技サーキット・v2・fullscale) ===');
const solo = runLocalize({ field: [rr], laps: 5, interact: false });
console.log('finishers:', solo.r.finishers.length, 'ticks:', solo.r.ticks, 'lap times ms:', solo.r.finishers.map((f) => Math.round(f.totalTimeMs)));
const sc = scoreLocalize(solo.rows);
if (!sc) { console.error('scoreLocalize: lp==1 に到達せず (loop closure 未発火=地図未形成)'); process.exit(1); }
console.log('LAPBF(bins):', sc.LAPBF, ' LAPLEN(odo):', Math.round(sc.LAPLEN), ' binLen:', sc.binLenM.toFixed(1), 'm', ' 較正lap=2 採点lap=', sc.scoreLaps.join(','));
console.log('── 自己位置推定 (RMSE・bin / binLen=' + sc.binLenM.toFixed(1) + 'm) ──');
console.log('  周回内 相対位置 (within-lap・lookahead に効く量):  フィルタ ' + (sc.gIn ? sc.gIn.rms.toFixed(2) : '-') + ' bin / DR ' + (sc.drIn ? sc.drIn.rms.toFixed(2) : '-') + ' bin  = ' + (sc.gIn ? (sc.gIn.rms * sc.binLenM).toFixed(1) : '-') + ' m');
console.log('  絶対位置 (held-out・原点=loop closure 精度に律速): フィルタ ' + (sc.G ? sc.G.rms.toFixed(2) : '-') + ' bin (95%tile ' + (sc.G ? sc.G.p95.toFixed(2) : '-') + ') / DR ' + (sc.dr ? sc.dr.rms.toFixed(2) : '-') + ' bin  = ' + (sc.G ? (sc.G.rms * sc.binLenM).toFixed(1) : '-') + ' m');
console.log('演算予算:', `avg ${Math.round(sc.budget.avg)} / max ${sc.budget.max} steps/loop (hard limit 200000・目標 ≤300 は N=` + sc.LAPBF + ' bin フィルタで超過だが limit の ' + (100 * sc.budget.max / 200000).toFixed(1) + '%=十分収まる)');
console.log('β 再挑戦 (地図事前分布):', sc.beta.mae != null ? `MAE ${sc.beta.mae.toFixed(1)}° / 符号一致 ${(sc.beta.signRate * 100).toFixed(0)}% (n=${sc.beta.n}/${sc.beta.signN})  基準 MAE≤15°∧符号≥80% → ${sc.beta.signRate >= 0.8 && sc.beta.mae <= 15 ? 'GO' : 'NO-GO (J-1 と同じく不成立)'}` : '—');

// 他車5台 (計6台)・spec.recon で各車が単独で地図形成 → interact レースで他車近接下の位置推定+recall。
console.log('\n=== comp_localize 6台 interact (他車5台・recon2 で地図形成→混走) ===');
const field6 = [];
for (let i = 0; i < 6; i++) field6.push({ name: 'L' + i, lang: 'py', src: localizeSrc, carType: 'normal_ff', rear: false, encoder: true });
const RACE_LAPS = 4, RECALL_CAR = 4;
const IN_MAX = 2.0;        // 周回内 RMSE の上限 (bin)
const DIVERGE_MAX = 10;    // 発散なし: 別の周で較正した誤差の最大の上限 (bin)。実測は 6 台 4.0・単独 4.6（原点の取り直しのずれ 2〜3 bin が律速）
// 前方検知は、前に車がいる車で測る（車0 の前に車がいない走りでは検査が空振りする）。1 回の走りで車0 と車4 を両方記録する。
const multi = runLocalize({ field: field6, laps: RACE_LAPS, interact: true, targets: [0, RECALL_CAR], recon: { laps: 2 } });
console.log('finishers:', multi.r.finishers.length, '/ 6  ticks:', multi.r.ticks);
// ③ の判定。失敗を { tag, msg } の配列で返す（tag: in＝周回内・div＝発散・nan＝測れない・near＝近接の空振り・recall＝前方検知）。
//   下の「判定の検出力」で、推定を壊した行にも同じ判定を当てる。
function judge6(rows0, rowsR) {
  const out = [], bad = (tag, msg) => out.push({ tag, msg });
  const scM = scoreMulti(rows0, 0), scIn = scoreMultiIn(rows0, RACE_LAPS), scR = scoreMulti(rowsR, RECALL_CAR);
  if (!scIn) bad('nan', '6台 車0: lp==1 未到達（または採点できる周が無い）');
  else {
    if (!(scIn.per.length >= 3)) bad('in', '6台 車0 の採点できた周が ' + scIn.per.length + ' 周（3 周以上）');
    if (!(scIn.rmsMax <= IN_MAX)) bad('in', '6台 車0 周回内の位置推定 RMSE ' + scIn.rmsMax.toFixed(2) + ' > ' + IN_MAX + '×BL');
    if (!(scIn.near > 30)) bad('near', '6台 車0 の採点した周で、他車が 22 m 以内にいた tick が ' + scIn.near + '（30 以下＝「他車が近くにいる周」が空振り）');
  }
  if (!scM || scM.rms == null || !isFinite(scM.rms) || !isFinite(scM.maxErr)) bad('nan', '6台 車0: 別の周で較正した誤差が測れない（推定が有限でない・採点できる周が無い）');
  else if (!(scM.maxErr <= DIVERGE_MAX)) bad('div', '6台 車0 が発散（別の周で較正した誤差の最大 ' + scM.maxErr.toFixed(1) + ' > ' + DIVERGE_MAX + ' bin）');
  if (!scR) bad('recall', '6台 車' + RECALL_CAR + ' で lp==1 未到達');
  else if (!(scR.carTrue > 30)) bad('recall', '前方検知: 車' + RECALL_CAR + ' の前に車がいた tick が ' + scR.carTrue + '（30 以下＝検査が空振り）');
  else if (!(scR.recall >= 0.7)) bad('recall', '前方検知 recall ' + (scR.recall * 100).toFixed(0) + '% < 70%（車' + RECALL_CAR + '）');
  return { out, scM, scIn, scR };
}
const rows0 = multi.rowsBy.get(0), rowsR = multi.rowsBy.get(RECALL_CAR);
const J6 = judge6(rows0, rowsR);
{ const { scM, scIn, scR } = J6;
  if (scIn) console.log('  車0 位置推定 (6 台レース中・周回内＝同じ周で較正): RMSE ' + scIn.per.map((x) => `lap${x.lap} ${x.rms.toFixed(2)} (max ${x.max.toFixed(1)}・近接 ${x.near} tick)`).join(' / ') + ' bin / 基準 最大 ≤' + IN_MAX + '×BL・近接 tick > 30');
  if (scM && scM.rms != null) {
    console.log('  車0 位置推定 (別の周で較正＝原点の取り直しの精度に律速・1 周目を含む): RMSE ' + scM.rms.toFixed(2) + ' bin＝記録 ／ 最大 ' + scM.maxErr.toFixed(1) + ' bin (' + (scM.maxErr * scM.binLenM).toFixed(0) + ' m) / 基準 ≤' + DIVERGE_MAX + ' bin＝発散なし');
    console.log('  車0 前方他車 検知 recall: ' + (scM.recall != null ? (scM.recall * 100).toFixed(0) + '% (前に車がいた tick=' + scM.carTrue + ')' : '— (前方車なし)') + ' ＝記録');
  }
  if (scR) console.log('  車' + RECALL_CAR + ' 前方他車 検知 recall: ' + (scR.recall != null ? (scR.recall * 100).toFixed(0) + '% (前に車がいた tick=' + scR.carTrue + ') / 基準 ≥70%・tick > 30' : '— (前方車なし)') + ' ／ 誤報率（前に車がいない tick で立つ割合）' + (scR.falseRate != null ? (scR.falseRate * 100).toFixed(0) + '% (' + scR.noCar + ' tick)' : '—') + '＝記録');
}
// 判定の検出力: 推定を壊した行に同じ判定を当てて、**狙った判定が**赤になること（判定が空振り・恒真でないことを、判定ごとにゲート自身が見張る）。
//   [差し替え, 赤になるべき判定の札]。「周ごとに原点」「1 周目だけ一様にずれる」は周回内では見えず、発散（別の周で較正した誤差の最大）だけが止める。
//   「12 bin 刻み」は発散の上限の内側で、周回内だけが止める。
const POWER = [];
{ let seed = 20261005; const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };   // mulberry32
  const LB = rows0.find((r) => r.lp === 1)?.LAPBF || 100;
  const car0 = (fn) => [rows0.map((r) => ({ ...r, estb: fn(r) })), rowsR];
  for (const [label, want, [r0, rR]] of [
    ['車0 の推定を定数に', 'in', car0(() => 7)],
    ['車0 の推定を乱数に', 'in', car0(() => rnd() * LB)],
    ['車0 の推定を 12 bin 刻みに丸める', 'in', car0((r) => Math.floor(r.estb / 12) * 12)],
    ['車0 の推定を、真位置と無関係に進む時間カウンタ (0.02 bin/tick) に', 'div', car0((r) => r.tick * 0.02)],
    ['車0 の推定の原点が周ごとに 20 bin ずれる', 'div', car0((r) => r.estb + 20 * r.laps)],
    ['車0 の推定が 1 周目だけ一様に 20 bin ずれる', 'div', car0((r) => r.estb + (r.laps === 0 ? 20 : 0))],
    ['車0 の推定を NaN に', 'nan', car0(() => NaN)],
    ['車' + RECALL_CAR + ' の前方検知の旗を常に 0 に', 'recall', [rows0, rowsR.map((r) => ({ ...r, carF: 0 }))]],
  ]) { const tags = judge6(r0, rR).out.map((x) => x.tag); POWER.push([label, want, tags.includes(want), tags]); }
  console.log('  判定の検出力（差し替え → 狙った判定が赤か）: ' + POWER.map(([l, w, hit]) => `${l} → ${w} ${hit ? '赤' : '緑'}`).join(' ／ ')); }

// ───────────────────────── 6. アサート (CI-14 再スコープ後の受け入れ基準・人間承認 2026-07-04 Option1) ─────────────────────────
// 主指標=周回内 相対位置 (lookahead に効く実運用量)。絶対は loop closure 原点精度が律速で docs に限界明記。
let ok = true;
const fail = (m) => { ok = false; console.error('  ✗ ' + m); };
// ① 単独: within-lap 相対 RMSE ≤ 1×BL (実運用の位置知覚=lookahead に効く量)。CI-14 再スコープ
//    (絶対でなく相対=真の運用量・人間承認 2026-07-04 Option1)。ŝ=ヒストグラムフィルタ推定で判定。
if (!(sc.gIn && sc.gIn.rms <= 1.0)) fail('単独 within-lap フィルタ RMSE ' + (sc.gIn ? sc.gIn.rms.toFixed(2) : '-') + ' > 1×BL');
// ② 絶対の限界は「記録」する (パスの条件にしない=CI-14 再スコープ・人間承認)。有限性のみ担保。
if (!(sc.G && isFinite(sc.G.rms))) fail('絶対 RMSE 非有限');
// ③ 他車6台: 周回内 RMSE ≤ 2×BL（他車が近くにいた 1 周目を含む）・発散なし（別の周で較正した誤差の最大 ≤ 10 bin。1 周目を含む）・前方検知 recall ≥ 0.7（前に車がいる車で）。
//   【BH5・2026-10-05 再スコープ・利用者承認】それまでは「別の周で較正した RMSE ≤ 2×BL」を車0 で判定していたが、同じ測り方は単独走行でも
//   3.12 bin（②＝原点の取り直しの精度に律速なので 2026-07-04 から記録だけ）で、6 台の章の 2.0 は改修前の 1 本の走りで車0 だけが満たしていた値だった
//   （同じ式でほかの車は 20〜49 bin）。逆走の向き直し（fleet.js の「BH5」）でレースの展開が変わると（全車 372 秒までに完走・改修前は車0 が 560 秒）、
//   車0 は 2.60 bin になり、車0 の前に車がいなくなって前方検知の判定は空振りした（改修前 176 tick・78%）。∴ 位置推定は周回内（lookahead に効く
//   実運用量）で判定し、別の周で較正した RMSE は記録にとどめる。前方検知は前に車がいる車（車4）で測り、前に車がいた tick が 30 以下なら赤。
//   【同・層 4 の指摘で足したもの】(i) 従来の「発散なし (max < LAPBF/2)」は恒真だった（円環の距離は LAPBF/2 を超えない）→ 実効のある上限 10 bin に
//   （実測 4.0・単独 4.6。既存のずれは原点の取り直しの 2〜3 bin）。周回内の測り方は周をまたぐずれを見ないので、これが「周ごとに原点が動く」
//   「真位置と無関係に進む」を止める。採点は較正の周（本番の 2 周目）以外の全部＝他車が近くにいる 1 周目を含む。
//   (ii) 周回内の採点にも 1 周目を入れ、採点した周で他車が近くにいた tick が 30 以下なら赤（「他車が近くにいる周」を空振りさせない）。
//   (iii) 前方検知・採点とも走行中の tick だけ・相手は走行中の他車だけで数える。 (iv) 推定を壊した行に同じ判定を当て、狙った判定が赤になることを毎回確かめる。
//   限界（記録）: ①位置と前方検知を別の車で見ている（車4 の位置推定は周回内 6 bin 超＝このサンプルは集団の中では地図がぶれる） ②前方検知の
//   誤報率は判定していない ③ 1 周目の走りの展開に左右される（v9.0.0＝向き直しの前の木では、車0 が 1 周目に 0.58 周ぶん逆走して周回内 10.7 bin＝赤）
//   ④発散の上限 10 bin より小さいずれ（同じ向きに約 6 bin・逆向きに約 9 bin まで）は通る。
for (const m of J6.out) fail(m.msg);
for (const [label, want, hit, tags] of POWER) if (!hit) fail('判定の検出力: 「' + label + '」で ' + want + ' の判定が赤にならない（赤になった判定: ' + (tags.join(',') || 'なし') + '）');
// ④ β 再挑戦: go/no-go を「記録」(J-1 基準)。NO-GO でも失敗にしない (成果として記録=§13-4)。
if (sc.beta.mae == null) fail('β 再挑戦 未測定');
// ⑤ 演算予算: hard limit 200000 の ≪1% (StepLimit を投げない)。
if (!(sc.budget.max < 20000)) fail('演算予算 max ' + sc.budget.max + ' ≥ hard limit の 10%');
console.log('\n' + (ok ? '✅ AO10 受け入れ基準 全合格 (CI-14 再スコープ後・within-lap 相対=実運用量で判定)' : '❌ AO10 受け入れ基準 不合格'));
if (!ok) process.exit(1);
