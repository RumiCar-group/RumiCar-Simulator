# RumiCar Simulator — Vehicle Physics Model (Detailed)

> The long-form version of the in-app "🔬 Physics Model" dialog. It collects the actual numeric value, derivation, and design intent of each constant so you can re-read it later or compare it against what you find on your own.
> Japanese version: [`physics_model.md`](./physics_model.md).
> Implementation: `public/js/physics_dyn.js` (dynamics engine), `public/js/physics.js` (classic = kinematic version), `public/js/physics_v2.js` + `public/js/contact_v2.js` (precise v2 engine = four-wheel two-track + impulse contact; §13), `public/js/config.js` (`REGIMES` / `DYN_DRIVE` / car parameters).

---

## 0. Overview — What We're Solving

The car on screen moves by integrating, every frame, the **forces the tires generate against the road**, using a **single-track (bicycle) model**. Understeer, oversteer, drift, spin, wheelspin, and lock are not "effects" produced by individual rules — they are all **results that emerge from this one set of dynamics**.

You can switch between three physics engines (the "Physics engine" select below the toolbar, since v3.52.0):

| | Dynamics model (default) | Classic physics | Precise v2 (§13) |
|---|---|---|---|
| Implementation | `physics_dyn.js` | `physics.js` | `physics_v2.js` + `contact_v2.js` |
| Principle | Integrate tire forces (u, v_lat, r independently); single-track | Velocity = determined by geometry (kinematics) | **Four-wheel two-track** (per-wheel loads, differential, wheel ODE) + **impulse contact** |
| Side-slip | Emerges from forces (transients beyond 90° possible) | Velocity vector constrained to ±45° of the body = structurally cannot appear | Emerges from forces (combined-slip MF, per wheel) |
| Use | Default. Drift / back-entry / donuts | Smooth and predictable. For beginners | Full-scale racing (recommended); tabletop slip-tire learning |

§1–§8 of this guide describe the **dynamics model (default)**. What the precise v2 engine changes, and how, is collected in **§13** (the tabletop default remains the dynamics model = behavior and records stay byte-for-byte unchanged).

Execution rates: user program `loop()` = 20 Hz, physics integration = 60 Hz.

---

## 1. Equations of Motion (Single-Track Model)

The left and right wheels of each axle are lumped into one, and three state variables are integrated over time about the center of gravity (CG).

- `u` : longitudinal body velocity (m/s, forward +)
- `v_lat` : lateral body velocity (m/s, left +)
- `r` : yaw rate (rad/s, counterclockwise +)

With mass `m`, yaw inertia `I_z`, front-axle distance `a`, rear-axle distance `b` (`a + b = L` = wheelbase):

```
m·(u̇   − v_lat·r) = Fx_front + Fx_rear      … longitudinal (centripetal term −v_lat·r included)
m·(v̇_lat + u·r)   = Fy_front + Fy_rear      … lateral (centripetal term +u·r included)
I_z·ṙ             = a·Fy_front − b·Fy_rear   … yaw moment
```

The third equation is the tug-of-war that turns the car. If `a·Fy_front − b·Fy_rear > 0` remains, the car keeps rotating (self-sustained drift). Lowering the rear lateral μ on a drift car (`muRK<1`) saturates the rear first so this term is left over, making the rotation self-sustaining. If front and rear saturate simultaneously the moment balances and the car settles into a neutral four-wheel drift (measured).

The public coordinates `x, y` are the rear-axle center (a distance `b` behind the CG) for compatibility; the internal `_cx, _cy` are the CG.

---

## 2. Friction Circle (Ellipse) — The Tire-Force Limit

For each tire, the longitudinal force `Fx` and lateral force `Fy` are limited so their combination stays inside a circle (ellipse).

```
(Fx / (μx·n))² + (Fy / (μy·n))² ≤ 1     (n = the load on that tire)
```

- Use it all up longitudinally → nothing left for lateral, the car pushes wide (understeer, wheelspin)
- Add drive where lateral is already used up → it breaks loose (oversteer, spin)

### Anisotropic vs. Isotropic (varies by regime)

| Regime | μy (lateral) | μx (longitudinal) | Circle shape | Reason |
|---|---|---|---|---|
| Tabletop | 0.19 (drift 0.13) | 0.75 (drift 0.35) | Tall ellipse | **Intentional trick** (below) |
| Full scale | 1.4 (drift 1.0) | 1.4 (drift 1.0) | Isotropic true circle | Real tires |

> **Difference from reality:** at tabletop scale (wheelbase 0.13 m, top speed 0.7 m/s), against the real μ≈1 (lateral limit ≈ μg = 9.8 m/s²) the lateral acceleration reachable even at full throttle and full steering is tiny, so it **never slides**. We therefore shrink the tabletop lateral μ (making the ellipse tall) so that "the onset of sliding is visible." The maximum reachable a_y at full lock and full speed is ≈1.74 m/s², so Normal (lateral limit 1.86) just barely doesn't slide, while Drift (lateral limit 1.28) starts to slide at full lock around u≈0.61 (calibrated to match the old model's "starts sliding at PWM215").

The coupling of the friction circle is the regime parameter `circleBi` (`DYN.circleBi` in `physics_dyn.js`):

- `circleBi = 0` (tabletop) = one-directional (longitudinal priority). When a driven wheel spins, the lateral force drops to nearly zero (= the basis of power-oversteer / donuts). Tabletop slip tires are wheelspin-limited, so this is physically correct.
- `circleBi = 1` (full scale) = isotropic radial circle. Combined slip gives the grip limit, and lateral load eats into longitudinal force.

---

## 3. Lateral Force — Slip Angle and the Tire Curve (simplified Pacejka, F4)

A tire generates lateral force in response to the mismatch (slip angle `α`) between the direction it points and the direction it travels.

```
linear region (small α):  Fy ≈ C·α              C = cornering stiffness (how hard it digs in)
beyond the peak:          Fy = Fy_max / (1 + k_decay·(|α| − α_peak))   (|α| > α_peak)
```

- `|α| ≤ α_peak`: lateral force is at the friction-ellipse peak `Fy_max` (full).
- `|α| > α_peak`: gently decays (never drops to zero).
- The slip angle is bound to the physical range `(−π/2, π/2)` (preventing sign flips from `tan` wrapping).

| Regime | α_peak | k_decay | Meaning |
|---|---|---|---|
| Tabletop | 1.35 rad | 0.50 | Sticky. Kept shallow because too much drop-off is a known regression that kills full-speed drift |
| Full scale | 0.25 rad (≈14°) | 0.60 | Early peak like real tires; drops a bit deeper past the limit |

Cornering-stiffness baseline `C0`: tabletop 10.0, full scale 60.0 (m/s²/rad, mass-normalized). The non-dimensional form `Cα* = C0/(μ·g)` lets you compare across regimes.

### What Under/Oversteer Really Is

The **ratio** of front and rear cornering stiffness sets the speed dependence of the steady-state gain (= the US/OS gradient). The `CfK` (front) / `CrK` (rear) multipliers in `DYN_DRIVE`:

| Drive | CfK | CrK | Tendency |
|---|---|---|---|
| FF | 0.95 | 1.30 | Weak front → understeer |
| FR | 1.15 | 1.00 | Strong front → toward oversteer |
| 4WD | 1.00 | 1.10 | Toward neutral |

---

## 4. Longitudinal Force — Drive, Braking, Load Transfer

### Drive split `split` (`DYN_DRIVE`)

| Drive | split [front, rear] | CG a/L (`aFrac`) |
|---|---|---|
| FF | [1.0, 0.0] | 0.42 (front-biased) |
| FR | [0.0, 1.0] | 0.55 (rear-biased) |
| 4WD | [0.4, 0.6] | 0.50 (centered) |

> **Exactly as the real RumiCar behaves:** BRAKE is not a friction brake but a **motor brake**, so it acts only on the driven wheels (braking is also distributed by `split`). Hence FR brakes the rear only = locks up and turns in (brake drift), while FF brakes the front only = stays straight — both emerge from the structure. Combined with the rear lateral-μ multiplier `muRK` (FR 0.80 / 4WD 0.95 / FF 1.05), FR's brake oversteer becomes pronounced.

### Load Transfer (longitudinal & lateral)

**Longitudinal load transfer (all regimes · Phase B):**

```
Δn = m·a_x·(h/L)      h/L = hOverL = 0.35 (CG height / wheelbase)
```

Load shifts to the rear under acceleration and to the front under braking. As the axle load `n` (= `nF`/`nR`) moves, the friction-circle radius `μ·n` changes front-to-rear, producing "the rear is light under braking = prone to slide." It is calibrated against the tabletop benches, so it does **not** fade by regime — it is **common to all regimes**.

**Lateral load transfer (full scale only · IMP-01 / Z2):**

The single-track (bicycle) model has no left/right wheels, so the outer/inner load transfer of cornering is folded into a per-axle term as **tire load sensitivity** (the nonlinearity by which μ drops as the contact load grows). The previous step's lateral tire force `ayLat` (mass-normalized, delayed one step to avoid an algebraic loop) shifts load to the outer/inner wheels via CG-height × track, and an **axle grip factor** that analytically folds the outer+inner sensitivities

```
gmF = max(0.5, 1 − latLoadK·(φF·ayLat/nF)²)
gmR = max(0.5, 1 − latLoadK·((1−φF)·ayLat/nR)²)      φF = b/L (front static load fraction)
```

is multiplied into each axle's lateral capacity `FyF`/`FyR` (derivation: the outer+inner sum of `μ(Fz)=μ0·(1−k·ΔFz/w)` equals `μ0·N·(1−k·(ΔFz/w)²)`). The lower clamp of 0.5 prevents extreme load transfer from collapsing grip entirely and causing an instant spin.

- **Regime fade (`latLoadK`):** full scale = `0.05` / tabletop & mid-scale = `0` (zero contribution = identity). When `latLoadK = 0` the entire block is skipped, so tabletop matches the legacy path **byte-for-byte** (byte-invariant), exactly like the friction-circle bidirectional coupling (`circleBi`).
- **Emergence of US/OS:** φF is the static load fraction, so in **steady-state cornering both axles lose grip equally**, leaving the full-scale Froude-similarity gate (Ay* · §7) intact. But once longitudinal load transfer (`hOverL`) moves `nF`/`nR` away from the static ratio, the relative grip loss of `gmF`/`gmR` becomes asymmetric and **load-coupled US/OS emerges** (trail-braking → `nR`↓ → `(φ·ayLat/nR)²`↑ → `gmR`↓ = rear lets go = oversteer). The effect **concentrates itself on trail-braking and combined loads** (accelerating/braking while turning).
- **Coefficient basis:** `latLoadK = 4·loadSens·(h/track)²`. With CG height `h ≈ 0.45 m` and track `track ≈ 1.6 m` → `(h/track)² ≈ 0.079`, and load sensitivity `loadSens ≈ 0.158` (lateral grip down ~16% when load doubles = dry race tire) → `latLoadK ≈ 0.05`. A sweep shows the Part F gate (`Ay* > 1.05`) survives up to 0.06 and breaks at 0.08, so **0.05** is adopted with margin to spare.
- The learner side is never shown load or contact load `Fz` (front ToF×3 only · policy D-1).

---

## 5. Wheel Slip Ratio / Longitudinal Force (full scale only, F5)

At full scale the wheel rotation becomes a state (`wheelDyn = 1`). The wheel-surface speed `vw = ω·R` is integrated with explicit Euler, and the longitudinal force comes from the longitudinal Pacejka via the slip ratio.

```
s  = (vw − u) / |u|                       slip ratio
Fx = μx·n·sin(wheelC·atan(wheelB·s)) / normalization(sPeak)   longitudinal Magic Formula
```

Full-scale values: `sPeak = 0.10` (dry asphalt), `wheelB = 14.0`, `wheelC = 1.7`, `wheelLambda = λ = m·R²/Iw = 28.0` (how fast the wheel responds). Constant-power drivetrain `wheelPower = 547`, `launchAccel = 15.0`: at low speed it is torque-limited `launchAccel·accel`, at high speed power-limited `wheelPower/|u|`.

Emergent behavior: **wheelspin** on launch (torque > grip → spin loss → loses to slew-rate control), and **lock** under hard braking (`s → −1` loses lateral grip). It hooks up at 251 km/h, and steady cruise at 347 km/h has `s≈0.01 < sPeak` so it doesn't spin and is drag-limited.

> Numerical stability: if the wheel time constant `1/(λ·∂Fx/∂vw)` is faster than the integration step `h`, explicit Euler diverges, so adaptive sub-steps `nSub` are increased to satisfy `λ·(∂Fx/∂vw)·h < subSafety` (`adaptiveSub`).

Enabling the "wheel encoder (optional)" lets you read front/rear wheel-surface speeds via `RC_wheel_speed(FRONT/REAR)`, so you can estimate the slip ratio from the front-rear difference and write your own traction control or ABS.

---

## 6. Aerodynamics — Drag and Downforce (full scale only, F3)

Two forces proportional to the square of speed (`½·ρ·coefficient·A·u²`):

```
drag        Fd = ½·ρ·Cd·A·u²    always decelerating (opposite the longitudinal direction)
downforce   Fl = ½·ρ·Cl·A·u²    increases the load n (distributed front/rear by downforceBalance)
```

Full-scale values: `ρ = 1.225`, `Cd = 0.9`, `Cl = 3.0`, `frontal area A = 1.3 m²`, `downforceBalance = 0.45` (front-biased).

- **"Faster means you can corner harder":** downforce increases the load `n` with `u²`, so the friction-circle radius `μ·n` becomes speed-dependent. On tabletop, `ρ = 0 / A = 0` makes this a complete no-op (zero dynamic pressure). At tabletop scale v² is tiny, so aero is about 1/70,000 of full scale = effectively negligible.
- **Top speed is set naturally:** the speed at which drive force = drag balances is the cap (the setting `maxSpeed = 110` is a target; the actual cap ≈347 km/h is the result of that balance).

---

## 7. Regimes (Scale) and Dynamic Similarity (F1)

The same dynamics engine runs at three scales. The key to behavior is the governing ratio:

```
Ay* = (v²/R) / (μ·g)     required lateral acceleration ÷ what the road can provide. Exceeding 1 means sliding
```

| Regime | L (wheelbase) | Top speed | Speed display | ToF range | Friction | Aero | Wheel slip |
|---|---|---|---|---|---|---|---|
| Tabletop | 0.13 m | 0.7 m/s (≈1.3 km/h) | Relative-corrected (≈350/180) | 2,000 mm | Anisotropic | None | None |
| Mid-scale | 0.26 m | √2× | Relative-corrected | 4,000 mm | Anisotropic | None | None |
| Full scale | 2.6 m | ≈347 km/h | Real speed ×3.6 | 150 m | Isotropic real μ | Yes | Yes |

### Tabletop ↔ Mid-scale = Froude Similarity (similarity preserved)

When scaling length by `kL`, scaling velocity by `kV = √(kL·kG·kμ)`, time by `kT = √(kL/(kG·kμ))`, and acceleration by `kG·kμ` keeps **Ay\* invariant**. The result: **the same driving program slides the same way under the same operation, even in a larger, faster world**. Mid-scale uses `kL=2` (generated by `scaleRegime`).

```
kV = √(kL·kG·kμ)   velocity      (maxSpeed, uBlend, absUFloor, uStop …)
kA = kG·kμ          acceleration  (accel, brake, coast, C0)
kT = √(kL/(kG·kμ))  time          (steerRate, vlatStop are ÷kT)
```

The non-dimensional shape coefficients (the tire curve's `α_peak` / `k_decay`) are invariant under Froude similarity, so they carry over the tabletop values. For the same reason the v2 engine's tire constants (`v2tire` = `μ0` / `muDecay` / `α_P` / `κ_P` / `relLenFrac`) are **inherited verbatim from the tabletop** at mid-scale (`scaleRegime` in `config.js` does `v2tire: base.v2tire`).

#### Is that inheritance correct? — measured (v6.2.1, `wf_as7_midscale.mjs`)

"It is non-dimensional, so inheriting is fine" is an argument, not an observation, so **we measured the behavior**. A pure-sideslip sweep gives the vehicle-level lateral-force peak position α_peak and the break-away Ay\* in each regime, compared **with the step size scaled by the Froude time factor `kT=√k_L`** (similarity holds only as the three-way set of length, velocity **and time**).

| Comparison | Result |
|---|---|
| Compared in Froude time (4 car types × normal/slip = 8 pairs) | α_peak **exactly equal (Δ=0.00°)**; relative difference of Ay\* **≤2.2×10⁻¹⁶** |
| Detection power (perturb mid-scale μ0 by 1%) | Ay\* relative difference 1.05×10⁻³ — **detected** (so the test is not blunt) |

→ **No mid-scale-specific tire calibration is needed.** Injecting regime-specific values here would introduce a difference that does not exist and break Ay\* invariance, which is the design principle of this regime.

#### Two ways the similarity is not exact (an honest note)

1. **The integration step does not scale with time.** The outer step is fixed at 1/60 s in every regime, so at the production step size α_peak reads 16.75° (tabletop) vs 13.75° (mid-scale). Refine the step, however, and **both converge to 8.25°** (regime difference 0.00°), so this is **discretization, not a broken model**. Mid-scale's non-dimensional step is `1/kT` times finer, so it actually sits closer to the continuum limit (deviation 5.50° vs the tabletop's 8.50°).
2. **Program-side decision distances do not scale with the regime.** The bundled samples are written with **absolute millimetres** (`CONF=640`, `D_OPEN=620`) so they can be ported to the real device, and those values do not change with the regime. Put the same sample on a geometrically similar course (the course scaled by `k_L` as well) and lap times deviate from the expected `kT=1.414` by **up to 7.99%**; scale only the decision distances by `k_L` and that shrinks to **at most 1.66%** (9 combinations). In other words, **the dominant cause of "mid-scale behaves differently" in actual driving is not the tire but the program's absolute length constants.**

Note also that **switching the regime does not enlarge the course** — only the car and the ToF range scale. Similarity holds when "the course is enlarged by the same factor"; keeping the same course and changing only the regime changes the car-to-course ratio (the UI auto-corrects combinations where that ratio breaks down, via `enforceFitRatio`).

#### The integration-scheme switch is not non-dimensional (where the cliff is)

The semi-implicit wheel ODE (§13) is enabled when the explicit sub-step demand `needW` at the regime's representative top speed exceeds the threshold 128. Since `needW ∝ 1/√k_L`, **that comparison is not non-dimensional**: grow a Froude-similar regime and the integration scheme flips discontinuously while the physics stays similar. The measured cliff is at **`k_L ≈ 2.396`** (tabletop `needW`=198.1, ×1.548 / mid-scale 140.1, ×1.094 / full scale 9.0, ×0.070). Today's mid-scale `k_L=2` sits at **83.5%** of the cliff, on the tabletop side. That margin is monitored permanently by `wf_as7_midscale.mjs` section C.

### Full scale = Broken Similarity (intentional)

We drop the tabletop anisotropy hack (μy≪μx) for **isotropic real μ**, turn on **aero**, **lateral load transfer** (`latLoadK` · §4), and enable **wheel slip**. We also set `kinFade` to 0 to remove the input-side steering shim (`kinFactor` / `steerK`), letting US/OS emerge purely from physics. All of these transitions are **continuous blends** (binary switches forbidden), so there is no discontinuity band between regimes (`circleBi 0→1` and `kinFade 1→0` share the same boundary as the broken similarity).

---

## 8. Steering Shim (kinFactor) — Why Tabletop Keeps Its "Feel"

On tabletop, US/OS and power-on behavior are reproduced by the input-side shim on the effective steering angle, `kinFactorEff = 1 + kinFade·(kinFactor − 1)` (and `steerKEff`). This gives a two-tier design where **the feel stays as in the classic (kinematic) version**, while only the limit behavior (saturation, sliding, transients beyond 90°) is delegated to the dynamics. Calibration is done with the "calib fit" scenarios in `test_dyn.mjs`, and tabletop satisfies the contract of reproducing the legacy behavior byte-for-byte (std/dyn output invariant).

At full scale, `kinFade=0` removes this shim; since the "physical basis of US/OS" (isotropic real μ + aero + early-peak F4 curve) is all present, the real behavior appears without any shim.

---

## 9. Differences from Reality / Usage Notes (summary)

- **Speed display is relative-corrected.** The real tabletop speed is too slow to match perception, so full throttle is mapped to circuit ≈350 / mountain pass ≈180 km/h. **It does not affect the physics calculation, decisions, or lap times** (only full scale shows the real speed directly).
- **Steering is only the three values left / center / right** (same as the real RumiCar). It is not continuously variable. The servo follows toward the real steering angle at a finite rate `steerRate`.
- **No distinction between left and right wheels** (bicycle model). Left-right differences such as a differential, LSD, or one-wheel spin are not represented. → **The precise v2 engine (§13) removes this restriction** (four-wheel two-track, open/LSD differential, one-wheel spin).
- **The tabletop friction anisotropy is a convenience** trick (§2). It is not the physics of a real tire. → v2 uses an isotropic combined-slip MF (§13).
- The tire curve is a **simplified Pacejka**. It has no temperature, wear, or fine road-surface differences (load sensitivity is introduced per-axle at full scale only, as the lateral load transfer in §4). → v2 has a road-surface attribute muDecay (§13) and **opt-in tire heat and wear** (§13).
- Body: 0.19 × 0.08 m / wheelbase 0.13 m / max steering ±24° (tabletop). Top speed 0.7 m/s baseline with per-car multipliers. Acceleration 2.5 / braking 4.0 / coast 1.2 m/s² baseline.
- ToF distance sensors: three units at left +65° / center / right −65° (plus an optional rear unit). Each unit measures the **nearest reflecting surface inside a 25° field-of-view cone** (matching the real VL53L0X; §12). Out of range / low signal returns −3 via the `RC_read` family, and the raw reading is 8190 per the real device. Distant readings cannot be trusted, so each sample treats readings `>CONF` / −3 as "open" via its confidence limit `CONF` (§12).
- **Learning-program language semantics**: division by zero (`1/0`, `x%0`) is a **runtime error with a line number** (it does not silently return Infinity). Python handles negative indexing `a[-1]` (last element), chained comparison `a<b<c` (= `a<b and b<c`), string repetition `"ab"*2`→`"abab"`, and `%` formatting `"x=%d"%5`→`"x=5"` as on the real device. **However, C integer division is not modeled** — in this sim C's `/` is also **true division** (`7/2`→3.5, whereas real Arduino C does integer division `7/2`→3). This is a deliberate limitation (type tracking would be required — JS cannot distinguish the float literal `4.0` from the integer `4`); where integer division is needed, truncate explicitly (`floor`, etc.) or keep the true value.
- **C arrays (Stage AS4)**: declaration, indexed read/write, fixed length, multiple dimensions, brace initializers (missing elements are zero-filled), global arrays, array parameters (`int a[]` / `int a[N]` / `int *a` — all **passed by reference**, equivalent to pointer decay) and declaration qualifiers (`const`, `static`, …) are supported. **`sizeof` returns the total number of leaf elements**, so both `sizeof(a)/sizeof(a[0])` and `sizeof(a)/sizeof(int)` give the element count, and for a 2-D `m[2][3]`, `sizeof(m)/sizeof(m[0])` gives the row count 2. **This differs from the byte count on real hardware** — a deliberate choice, because even on real Arduino `sizeof(int)` is board-dependent (AVR=2, ESP32=4), so the byte semantics are not unique; the idiom is what is preserved. **Initializing an array from a string, `char s[] = "ab";`, is not supported**: instead of silently producing an empty array it raises a **runtime error with a line number**.

---

## 10. Attitude Estimation from ToF Time-Variation (Range-Flow) — Why It Doesn't Hold in This Sim

The real RumiCar has no attitude sensor such as a gyro, and this sim likewise gives the learning side only **three front ToF sensors (left +65° / center / right −65°) + an optional rear sensor (180°) + an optional wheel encoder (longitudinal speed)** (`api.js`). We **do not add a sensor that directly reads** yaw rate or side-slip angle β (faithful to the real device, policy D-1).

So can the program **estimate** the attitude? That is the research theme. The principle is **range-flow**: from the rate of change ḋ_i of the three rays' distances (= the difference between this ToF reading and the previous one), solve for the body's (vx, vy, ω) by least squares and produce the side-slip angle **β = atan2(vy, vx)**. Because the ±65° wide beams pick up the side-slip vy strongly as a left-right difference, in principle it looks solvable. You can try this with the competition sample **"Range-Flow Estimator" (`comp_estimate`)**, which outputs the estimated β to Serial so you can compare it against the **true β** (the answer physics knows) on the DEPTH panel.

**Conclusion: it does not hold under this sim's conditions (NO-GO).** Against the pass line fixed in advance — "in a turn where the wall is in view, estimated β MAE ≤ 15° **and** sign agreement ≥ 80% (real run)" — the measurement is **MAE 10–12° / sign agreement 70–72%**. Worse, it **loses to** the trivial estimate of "assume β = 0 (zero side-slip)" (MAE 3°) = the **sign** of the side-slip (sliding right or left) is not predicted. There are three root causes:

- **Unobservability of the wall normal (a loop):** when the three wide beams hit different wall faces, the local orientation of each wall cannot be determined from a single scan. Knowing the correct wall normal requires the self-motion (which includes vy), and getting that vy requires the correct wall normal — **chicken and egg**. Solving them jointly diverges; decoupling by assuming vy=0 makes the wall look tilted and collapses the estimate toward 0.
- **Ill-conditioning of distant walls:** at full scale the wall is tens of meters away. The coefficient of the distance change due to yaw, ω·(lever arm), has the lever arm (tens) as its coefficient, which **dwarfs** the translation vx/vy coefficient (~1). The side-slip contribution is buried under the yaw contribution.
- **In stable laps the true β is tiny to begin with** (a few degrees on average), so "sign agreement ≥ 80%" effectively demands "nearly perfect."

This NO-GO is stated **plainly** in the sample's header too. "How to improve the naive wall-normal assumption" is the next research theme built on this sample (the same "honest guide" policy as I-1).

**Follow-up (v3.54.0, Stage AO10): it does not hold with a map prior either.** The natural re-challenge — "if the wall normal is unobservable, wouldn't a **map** learned during recon work as a prior?" — was measured with the self-localization sample **"Self-Locator" (`comp_localize`)**: using the 1-D histogram filter's position (within-lap accuracy ~0.5 bins) and the map's distance gradient as a prior, and inverting β from the rate of change of (left − right) ToF. The result is **MAE 10.3° / sign agreement 14%**, short of the pass line fixed in advance (identical to J-1 above) = **NO-GO**. In other words, **attitude (β) cannot be read from ToF×3 even with a map** — that is the settled conclusion in this sim. By contrast, **position** (where you are on the course) can be estimated to ~0.5 bins within a lap from the same ToF + encoder (§13). "**Position is solvable; attitude is not**" — that is where the forward ToF×3 observation system tops out, and it is exactly why the v2 strategy programs are designed without any attitude feedback (§13).

---

## 11. When Drift Does / Doesn't Hold

Drift (sliding the rear out widely and driving while holding β) does **not** appear in this sim **everywhere, with any program**. **There are conditions under which it holds and conditions under which it doesn't, and rather than warning you in advance, it is built so you can notice from "what happened when you drove"** (policy J-2).

**Minimum conditions for it to hold:**
- **Car type:** a drift car (`drift_fr`, etc.). Normal cars are built isotropic and grip-biased at full scale (§2, §7), so they have no sustained-slide region.
- **Regime:** full scale. Only the drift car at full scale has its longitudinal friction `muXDrift` (=0.48) lowered to revive power-oversteer (spinning the rear under drive). Tabletop / mid-scale are byte-invariant = this relaxation is **not applied**.
- **Course:** a walled course (the competition circuit). The walls entering the ToF's field of view is the prerequisite for recognizing corners and applying steering and throttle.
- When these line up, the samples **"Sustained Drift" (`comp_drift`)** and **"Slip Attack" (`comp_slip`)** let you observe rear-sliding behavior at each corner (turn-average \|β\| ≈ 50°, peak 180°).

**Structurally impossible things (not doable with ToF alone):**
- **Held drift (maintaining a constant β), full-lap drift (sliding the whole way around), and counter-steer (opposite lock)** have **no stable solution** in an open loop with only the front ToF. Once the rear starts sliding, β inevitably rotates all the way to 180° (full spin). Wiped out across about 70 settings × 6 control structures. The reason: holding a drift angle or catching a spin with corrective steer requires **attitude feedback**, but that attitude estimation does not hold, as in §10. So the "drift" of `comp_slip` is in reality a **rhythm of straight = grip → slide for an instant at the corner to round it → recover**, not a held or counter-steered drift (stated in the header).

> **Note (added in Stage AU, 2026-09)**: this is a statement about the **open loop that has only the forward ToF sensors**. A measurement harness that is allowed to read the car's sideslip angle β directly — an omniscient script — *can* **apply counter-steer** (measured: on 100% of the ticks where the slip exceeded its target, opposite lock was being commanded), and the go/no-go tables below are measured under that (drift-favourable) condition. **Holding a constant β**, however, does not hold even for an omniscient script: the hold time plateaus at 0.27–0.28 s even with a 64× faster servo (§13.14), and on the low-μ 180° hairpins \|β\| swings all the way to 90° and collapses into a **pivot** (rotation in place). With ToF alone it fails one step earlier still — the attitude that a counter-steer decision needs cannot be read at all (§10).

**Conditions under which it doesn't hold (vary by where you place the same program):**
- **Too open** (a plaza with no walls in view = the competition ground): `comp_slip`, which judges corners by wall distance, cannot recognize a corner, so it **drives straight off the course** without ever drifting.
- **Too tight / too slow** (e.g. a tabletop mountain pass): the full-scale absolute thresholds don't fit the small scale, so it sticks to the wall guard and **can't move forward**. Tabletop is also low-speed with narrow paths, so there is no "space to hold a slide" and it polarizes into grip ↔ spin (I-1).

→ Running the same `comp_slip` on the competition circuit / competition ground / tabletop mountain pass lets you experience the contrast directly: **holds (rear slides) / too open (doesn't slide, goes off course) / too tight (stalls)**. Program selection does not force a regime or course, so you can confirm it **just by placing it on any course and running**.

### Re-measured on the precise v2 engine — the "can drift beat grip?" go/no-go table (Stage AO8)

Note that `muXDrift` above (lowering the drift car's longitudinal friction at full scale only) is a mechanism of the **dynamics model (default)**. The precise v2 engine (§13) **abolishes** that hack (and unifies steering at the real-device ±24°), leaves whether drift appears entirely to the faithful four-wheel physics, and then answers "**is drift entry faster than grip driving?**" with a table of **deterministic scripted measurements** over dedicated benchmark corners (hairpins R5/6.5/8 m, medium-speed R50, high-speed R120, each in dry and low-μ versions) × car types × strategies — the result is **NO-GO in all 20 cells** (either grip is faster, or the drift does not complete cleanly). The table is printed by the bundled gate `wf_ao8_gonogo.mjs` (`node wf_ao8_gonogo.mjs`).

The mechanism is instructive: (a) **there really are segments where drift rotates faster** (on a low-μ hairpin, 90° of rotation takes 1.50 s < grip's 2.0–2.35 s). But (b) after the rotation the car keeps sliding at β≈60° and **cannot re-grip at the exit**, so the full sequence "entry → rotation → re-grip → drive out" never completes. **What limits this is not the steering but the car's own recovery limit** — testing, from each point of the real trajectory, "if I straighten the wheel, can it return to \|β\| < 35° within 0.6 s", it **can up to about 29° and cannot from 36°** (§13.14). That is why switching to continuous steering (optional equipment, §13.14) **turns not a single one of the 20 cells GO**, and making the servo 64× faster leaves the hold time flat at 0.27–0.28 s. Within the range measured, **drift cannot beat grip** — an honest conclusion settled by measurement. As an environment for learning "controlled sustained sliding" anyway, v2 provides **tabletop slip tires** (§13): starting wheelspin and power-over become safely reachable at low speed and low μ, and adding the opt-in **tire wear** (§13) teaches the full lesson that "drift consumes the rear tires = a resource you spend wisely."

#### How far this conclusion reaches — it is *not* "drift never wins anywhere" (re-measured in Stage AU on engine v7.4.0)

What those 20 cells measure is **holding a deep β (≈35–60°) inside a corridor that grip can follow geometrically** (the dedicated benchmark corners). We have now measured outside that range.

- **In a wall-bounded tight hairpin, grip's geometric best line does not fit in the first place.** A steady-arc geometric sweep fails in **8 of the 10 cells**, and those 8 split into two mechanisms: **6 cells** where the corridor's outer radius is below the minimum turning radius R_min (= 5.84 m), and **2 cells** where the outer radius clears R_min but the **car's own footprint** does not fit (a point could round it, but the body's outer front corner cuts the wall). Applying **active driving that carries a shallow slip (peak \|β\| of 12–15°)** to those cells, **5 of the 8 complete the full 180° without ever touching a wall** (rear-wheel drive FR only; AWD is **0/8** under the same sweep — the front wheels' drive torque kills the rotation before it develops). The clearance left to the wall is **0.03–0.71 m**. Those 5 cells **never apply counter-steer at all**, though (the minimum **achieved** steering angle — where the servo actually pointed — is 0%; the *command* did swing to full opposite lock, so counter-steer must be read from the achieved angle).
- **Grip does not get through when you actually *drive* it either (measured in Stage AU3).** Beyond the geometric sweep, we ran **grip driving that never creates a deliberate slip** on the real engine. Across those 8 cells (× 2 drivetrains = **16 rows**), **0 rows** complete 180° without touching a wall (the longest-held line reaches only 121° of 180°). **The same driver completes 2/2 on the control cells** (rr6.0 / rr7.0, where grip's geometry does fit), so this is not "the driver is bad". **What we searched, however, was two kinds of steady arc** (holding full lock, and holding a target radius of R_min under yaw-rate feedback) swept over entry speeds of 2–8 m/s, turn-in point and steering type — **genuinely transient lines, such as a multi-point turn or braking to shorten the effective radius, are still unmeasured**. So what can be said is: **driving that traces a steady arc cannot get through, while active driving that uses a shallow slip gets through in some cells**. It is still **not** true that "rear-wheel drift is the only way through" — the 5 cells that got through peak at \|β\| = 12–15°, which is not a deep rear-wheel drift.
- **Adding downhill gradient (5°/10°) does not change the conclusion.** Flat / 5° / 10° × 24 = **all 72 cells remain NO-GO** (the **smallest** drift/grip total-time ratio is 0.990, short of the 0.98 required for GO). What the gradient does change is the **mechanism**: on the **low-μ 180° hairpins**, FR runs out of its speed budget at every gradient and collapses into a **pivot** (rotation in place), whereas **AWD escapes that exhaustion on the 10° descent** (from flat to 5° the minimum speed during the slide is 0.11–0.57 m/s — essentially stopped — while at 10° it jumps to **1.67–2.04 m/s**, a factor of 3.6–8.8). It still does not become faster than grip.
- **We retract the earlier statement that "drift can also finish on the flat / low-μ / 180° / FR cells" (Stage AU3).** The three cells recorded then as 3/3 clean (taking 1.94–1.97× grip's time) were **a car rolling backwards being read as a car sliding**. Sideslip is measured as \|β\| = atan2(lateral speed, **\|longitudinal speed\|**), and because the denominator is an absolute value it **cannot tell a reversing car from a forward one**. Add a guard that aborts a run as broken once the longitudinal speed drops below −0.5 m/s, and those three cells fall back to **0/3** (clean runs across the 72 cells go 145 → **136/216**). The correct phrasing is "**the drift was not finishing at all**".
- **What is fast is the *shallow* slip — and we measured that directly with a constrained optimisation (Stage AU3).** We optimised a "drift ⇄ grip switching" driver (which controls rear-wheel slip ratio with the throttle) by random search plus local refinement, and optimised grip under **the same budget** for comparison. The switching driver is **faster than grip in 7 of the 8 baseline cells** (total-time ratio 0.794–0.970, i.e. up to 20.6% faster), and **every one of those optima peaks at \|β\| ≤ 14.8°**. Re-running the same budget with **being deep** imposed as a constraint (peak \|β\| ≥ 20°), all 16 rows that produced a solution are **never faster than the shallow optimum** (1.000–1.279×; the equality is a row whose unconstrained optimum was already deep). **Doubling the drive power leaves the fastest solution shallow.** To be precise, this is not "deep can't beat grip" — in **5 of those 16 rows the deep solution did beat grip** (ratio 0.866–0.997). What holds is: **sliding deeper never makes it the fastest**.
- **In free space exactly *one* drift-only window does open (Stage AU3; this corrects our earlier statement).** Sweeping **36 wall-free corridor-proxy cells** systematically, **GO comes out in 1 cell** — the **tightest R5 × low-μ × 180° × rear-wheel drive**, where driving to a 35° slip target (actual peak \|β\| of 27°) is **11.9% faster** than grip (ratio 0.881) **and keeps 3/3 clean when the entry speed is varied by ±10%**. The other 35 cells stay shut. **5 cells** meet the speed condition (ratio ≤ 0.98) on a single run, but **only this one survives the ±10% entry variation** — so in most cells what fails is not speed but **robustness**. Note that **the 2026-09-04 investigation recorded "all 36 cells NO-GO", but that was under a unit bug in the measurement driver**: the expression that tapers the slip target as the remaining heading shrinks was written as `remaining[rad] × gain[deg/rad] × 57.3`, which is **dimensionally inconsistent** and does not begin tapering until under 0.33° remain — i.e. **the taper was effectively disabled**. Grip's side of that same cell is 6.03 s, exactly as before (the grip driver is unchanged); only that unit was fixed, and the cell's drift went from **0/1152 clean runs to 24/1152**.
- **Blocking in a two-car race costs the blocker (Stage AU3).** When the leader deliberately turns sideways in the hairpin to fill the corridor with the car's width, the leader's average lap goes from **15.78 s to 23.19 s (+7.41 s/lap, +47%)**. The positions swap too: racing normally the leader finishes **582 m** ahead, while with the sideways block the follower ends **69 m** ahead. **We do not claim a breakdown of that cost** (how much is "the slowing down" versus "turning sideways itself"): the difference against a control arm that slows down identically but never turns sideways flips sign when the lap count changes (+2.37 s over 3 laps, −0.11 s over 4), so it is lost in measurement noise. What the data supports is only this: attempting to block makes the leader much slower, and the leader gets passed.

> **Primary data**: `wf_ao8_gonogo.mjs` (20 cells), `wf_ap14_wallhairpin.mjs` (10 wall-bounded cells × 2 drivetrains plus grip's dynamic arm), `wf_ap15_downhill_gonogo.mjs` (72 cells) and `wf_drift_reexam.mjs` (36 free-space cells, the switching optimisation and the two-car runs) **print their tables directly** — run `node wf_<name>.mjs`. **The figures quoted in this section come from `--full`** (the systematic sweep, about 30 minutes); the default run uses a reduced grid (8 free-space cells, about 2.5 minutes) and confirms the same conclusion (there is exactly one window, and it is R5 x low-grip x 180 degrees x FR) in a fraction of the time. Continuous steering and the recovery boundary (29°/36°) are **pinned as regression assertions** by `wf_as12_steer.mjs` (that one prints pass/fail only, not the numbers).
> **How to read a NO-GO**: every table is the best result **within a finite sweep grid**. It means "not found within that grid"; the existence of better conditions outside the grid cannot be ruled out.

---

## 12. The ToF Distance-Sensor Model — Field-of-View Cone, Confidence Limit, Ground Constraint, Real-Car Conversion

Since v3.50.0 (Stage AM, GitHub #27), the three forward distance sensors (ToF) plus the optional rear one measure **not as a single zero-width straight ray but as a 25° field-of-view cone (a fan)** matching the real VL53L0X's field of view. What they return is **the distance to the nearest reflecting surface inside the fan**.

### Why a cone (#27 "the laser escapes outside the wall")
With a single center ray, when driving along a wall, the long ray crossing the track can graze **just outside the endpoint of a tight corner's wall segment** (the endpoint test `u∈[0,1]` in `raySeg` misses everywhere), pass straight through the drawn wall, and stop at a distant one. That is the "sees through the wall" phenomenon — not a computational regression but a latent issue present from the beginning. A real ToF is not a point but a **cone with a 25° spread (half-angle 12.5°)** returning the nearest reflecting surface inside the fan, so with the cone model the corner graze-through **cannot occur in principle** (it returns the nearest distance inside the fan, so it can never report a value farther than the single center ray = a value extending beyond a wall).

- Implementation: `geom.js coneNearest()` clips each wall segment to the fan's two boundary half-planes (the center bearing rotated ±12.5°) and finds the closest point to the origin on the remaining sub-segment **analytically** (half-angle < 90° = the fan is convex, so the intersection is a single sub-segment; **deterministic, no randomness**). `sensors.js readSensor()` takes the minimum over all walls plus other cars' edges. Return shape `{mm, hit, origin, dir}` (`dir` = the fan's center bearing; a backwards-compatible addition used only for drawing).
- Range: 0–2000 mm (tabletop) / regime-scaled (150 m at full scale). Out of range, no reflecting surface inside the fan, or low signal returns **−3**.
- Display (`hud.js drawSensors`) fills the 25° fan with a gradient fading with distance squared, drawn **per direction out to the actual wall / other car** (v4.1.0; GitHub #30). Open directions extend to the range limit and walled directions terminate on the wall (no mid-air endings; the forward beam no longer hides other cars, and wall pass-through disappears visually too). Up to v4.0.1 the whole fan was cut off at a single radius equal to the nearest in-fan reflection distance, so a side wall merely grazing the fan edge (±12.5°) made the fan look short even with open road ahead (#30). **The ranging value is independent of the display and remains "the nearest reflecting surface inside the fan"** (the hit marker and numeric label show that point and value).
- The rear sensor (`readRear`) uses **the same mechanism** (`readSensor(SENSOR_REAR)`).

### The confidence limit (CONF) — don't trust the far field
The real VL53L0X cannot be trusted at long range because of **ground reflection** and similar effects. The ground constraint is `d = h / tan(12.5°) ≈ 4.51·h` (mount height h≈3.3 cm (1/32) → ~15 cm; h≈4.4 cm (1/24) → ~20 cm). From the decision thresholds of the official RumiCar exercise `Exercise-3.2` (100/150/**250 mm**), the effective software limit is about **250 mm**. So each sample program has a **confidence limit `CONF`** and treats readings `>CONF` or out-of-range (−3) as **"far / open"** (that direction is judged clear). This is not a library-wide constant but a **program-side parameter** that varies with the body, mount height, and course/regime scale.

### Scale and real-car conversion
- **The tabletop course is about 2.5× the scale of the real RumiCar model** (corridor width ~550 mm). The real device's 250 mm corresponds to about **640 mm** in tabletop units (=250×~2.56), so the tabletop samples default to **`CONF=640`**. **When moving to the real device, lower it to ~250 mm to match your body and mount height, and slow down accordingly** — stated in the samples' comments.
- **The full-scale competition samples** (`comp_circuit`/`comp_drift`/`comp_slip`/`comp_estimate`/`recon_racer`) are designed as real-car radar equivalents (sensorMaxMm=150 m), so their confidence limit sits at the **radar horizon of 150 m (`CONF=150000`)** (the honest real-ToF value of ~5 m is stated in the comments).
- **Open-loop showpieces** (shows / zero-counter) and **samples that drive by wheel encoder** (TC launch / ABS) don't navigate by ranging, so they have no confidence-limit parameter.

### Optics model (opt-in, v6.3.0 / Stage AS8) — reflectance, incidence, target size, mixed returns, crosstalk
The default ranging is an idealization: it **always** returns the nearest reflecting surface inside the cone. Real hardware does not. **A real VL53L0X reports a valid range only while the signal rate coming back from the target stays above a threshold** (`setSignalRateLimit` in the Pololu library the real RumiCar uses; default 0.25 MCPS. Upstream `ArduinoAndESP32/Libraries/RumiCar/RumiCar.cpp:74-86` lowers it to 0.1 only when `LONG_RANGE` is defined, and that define is commented out by default). The library's own note says lowering it "extends its potential range, but increases the likelihood of getting an inaccurate reading because of **reflections from objects other than the intended target**. It works best in dark conditions." The vendor's product page likewise states that "its **effective range and accuracy (noise) depend heavily on ambient conditions and target characteristics like reflectance and size**", and that time-of-flight determines "the absolute distance to a target **without the object's reflectance greatly influencing the measurement**".

Switching on **"ToF optics model (real-device)"** in the toolbar reproduces that criterion (default OFF; **deterministic — it uses no randomness**, so you can study it independently of "sensor noise". Official races force it OFF).

- **Signal rate**: for a Lambertian extended target the illuminated area (∝d²) and the collected solid angle (∝1/d²) cancel, leaving the tilt factor, so `S ∝ ρ·cosθ / d²` (ρ = reflectance, θ = incidence angle, d = distance). Normalizing so the nominal range `maxMm` sits exactly at the threshold gives `S = ρ·cosθ·(maxMm/d)²`, and **S < 1 means an invalid reading (−3)**.
- **Effective range is `d_max = maxMm·√(ρ·cosθ)`.** Measured (permanent gate `wf_as8_optics.mjs` section A5): the reference target's boundary is 1.953 m; ρ = 0.5 gives 1.397 m (+1.1% vs the √0.5 prediction); 30° incidence gives 1.778 m (+2.2%); 45° gives 1.647 m (+0.3%). Beyond 45° the 25° cone is wide enough that **its nearer part dominates, so the measurement lands farther than the prediction** (+5.9% at 60°, +17.3% at 70°). This is a structural departure from the narrow-beam limit whose direction and size both follow from the cone geometry.
- **Target size**: the signal is averaged over the whole cone, so **a small target that fills only part of it is a weak signal and reads invalid**. Refining the angular sampling does not remove this (measured: 79 of 2952 readings over all 41 courses x 24 poses, and 81/79/79 at 33/129/513 samples). **"Visible but not measurable" is the most confusing real-hardware behavior**, and here it emerges from the model itself.
- **Mixed returns (multipath / mixed pixel)**: with several surfaces inside the cone, real hardware returns a **signal-weighted mixture** of their distances (landing between the nearest and the farthest). This is exactly the library's "reflections from objects other than the intended target".
- **Crosstalk**: the parasitic reflection from the cover glass mixes in as a zero-distance signal, so `d_meas = d·S̄/(S̄+xtalk)` — a systematic bias that **pulls readings short, and more so the weaker the signal** (far, dark, or glancing). Measured: −0.0% at 20% of range (below 1 mm quantization), −0.8% at 60%, −1.8% at 95%. Real devices can calibrate this out; the Pololu library does not do so by default.
- **Reflectance does not distort the distance value.** Within the valid range, changing ρ from 1.0 to 0.6 to 0.3 leaves the reading identical (measured: 781 mm throughout). That reproduces the product page's "reflectance does not greatly influence the measurement": **reflectance only moves the valid/invalid boundary**.
- **Angular sampling** defaults to 33 rays. In the neutral configuration the worst discretization error converges monotonically — 20 mm at 9 rays, **5 mm at 33**, 1 mm at 513 — and **5 mm sits below the real device's ranging noise σ = 8 mm**, which is why 33 is the default.
- **Regime-scale invariance**: the threshold has the form `(d/maxMm)²`, i.e. it is dimensionless. Measured, "effective-range boundary ÷ nominal range" is **82.375% in all three regimes** (tabletop / mid-scale / full-scale; relative spread 0.000%). A permanent check keeps a new threshold from creating a cliff across regimes (a hand-off from Stage AS7).
- **What it teaches** (measured over 38 courses x the 3 default samples, solo driving): invalid readings go **0.01% → 4.56%** (x721), and readings judged "open because > CONF" go **15.79% → 21.65%**. Even so, the samples hardened in Stage AS3 still **complete 111/114, unchanged**. So the honest conclusion is: the quality of information you can rely on drops sharply, yet a straightforward sensor-reactive logic survives it.

> Note: this change **deliberately** brings ranging, driving, and determinism closer to the real device. The tabletop physics bytes and race-record verifyHash were **re-baselined** to new values; records carry the engine version (`engineFingerprint.appVersion`), so old records fall under the note "recorded on that version; may not replay exactly on the current one" (kept conditionally, unmodified).

---

## 13. The Precise Dynamics Engine v2 — Four-Wheel Two-Track, Impulse Contact, Tire Sets, Heat and Wear (Stage AO)

Since v3.52.0 you can select a third physics engine, **"Precise v2"** (the "Physics engine" select below the toolbar; the full-scale regime suggests v2 as the recommended choice, while **the tabletop default remains the dynamics model** = if you keep the defaults, behavior, records, and deterministic hashes stay byte-for-byte unchanged). Implementation: `public/js/physics_v2.js` (vehicle) + `public/js/contact_v2.js` (contact). Here is what changes relative to the single-track model of §1–§8, following the implementation.

### 13.1 Four-wheel two-track — a body with left and right wheels
- **Per-wheel vertical load Fz:** on top of the front/rear split (§4's longitudinal load transfer), **lateral load transfer** (lateral acceleration × CG height) is distributed to the axles by `rollBalance ζF`, downforce (§6) is added, and each of the **four wheels carries its own Fz** (floored at 0 = a lifting wheel). The inner wheel unloading and the outer wheel taking load now happen per wheel.
- **Combined-slip Magic Formula (robust form):** each wheel's tire force rises, peaks, and decays with the total slip σ (lateral slip angle and longitudinal slip ratio combined) via `g(σ)=sin(C·atan(Bp·σ))`. The coefficients are **derived in closed form from a single number — the post-peak asymptotic ratio muDecay** (`C=2−(2/π)·asin(muDecay)`, `Bp=tan(π/(2C))`; `g(1)=1` (peak) and `g(∞)=muDecay` verified numerically). Where the dynamics model uses "separate simplified Pacejka curves for lateral and longitudinal, bundled by a friction circle," in v2 **the combining law itself is the tire curve**.
- **Relaxation length:** tire forces do not build instantly; they follow with a first-order lag over distance travelled (**implicit Euler = unconditionally stable**). Transients in quick direction changes and damping at speed become natural.
- **Ackermann steering, β-dependent lateral drag, and downforce from u² only** (lost while sliding sideways = drifting also throws away downforce) are also introduced in v2.

### 13.2 Drivetrain — differential, wheel ODE, motor braking
- **Constant-power drivetrain → axle split → differential:** an open differential (equal torque left/right = the inner/outer wheel-speed difference follows geometry) and an **LSD** (smooth viscous coupling — no discontinuous sign()) are modeled, and power-on behavior changes accordingly.
- **A wheel-rotation ODE:** each wheel's rotation speed is a state (stiffness handled by automatic substepping), so **one-wheel spin at launch** and braking lock-up emerge per wheel. The encoder-facing surface `RC_wheel_speed` is the axle average = **the learning API is unchanged**.
- **Motor braking acts on the driven axle only** (same real-device fidelity as §4). Since v2 applies it per wheel, FR braking shows "rear-axle lock = handbrake analog" even more faithfully. Braking distance depends on the axle layout (measured: AWD 33.7 m; FF/FR longer) — stated plainly as the faithful consequence of the real device's characteristics.
- **Semi-implicit wheel ODE (tabletop / mid-scale; v4.0.0):** the wheel-rotation ODE is stiff, so explicit Euler needs many sub-steps to avoid divergence (~253 on average for tabletop v2). For grip-sufficient tires in the tabletop / mid-scale regimes the **wheel ODE is integrated semi-implicitly (backward Euler)**, cutting the sub-step count to about 1/9 (~28 on average) for a large speedup. (Those ~253/~28 figures are from the v4.0.0-era scenario; the 17.3/17.5 quoted below for v8.0.0 come from a different scenario and are not directly comparable.) **Full scale and the low-grip (slip) regime stay explicit as before (adaptive sub-steps, §5)**, and the default tabletop physics, the deterministic hashes f0–f3, and official/canonical records are unchanged. Only opting into tabletop v2 changes the numbers; earlier records are honestly kept with an "(as of vX)" note.
- **Under-delivery of the semi-implicit scheme, and its fix (v8.0.0 / Stage AW):** from v4.0.0 to v7.8.0 that semi-implicit update **froze the ground-contact speed `vcx` while it solved** (an operator split). When the body decelerates, the contact speed drops by `a·h` every sub-step, but the wheel was solved without knowing that, so the slip `s = vw − vcx` never built up and the wheel **delivered less force to the road than it was commanded** (the error scales with the sub-step width h times the damping kD). Measured, motor braking came out **36% weaker on the tabletop and 32% weaker at mid-scale** than the reference solution (the explicit integration used before v4.0.0), and the distance covered in the first second of a launch was **9% short on the tabletop and 13% short at mid-scale**. **v8.0.0 fixes it:** `_substep` is now two passes — ① the body accelerations `(ax, ay, rdot)` are computed first from all four tire forces, and ② the **same-sub-step change of contact speed** `Δvcx_i = (ax − rdot·y_i)·h·cosδ_i + (Δv_lat + rdot·x_i·h)·sinδ_i` enters the implicit update of the slip variable (`vw' = v0 + λh(fApp − fx)/(1 + λh·kD) + Δvcx·λh·kD/(1 + λh·kD)`, where `kD = ∂fx/∂vw` is the linear-region upper bound `μ·Fz·C·Bp/(kP·denom)`). In reverse the lateral speed `vlat` is itself integrated semi-implicitly, so `Δv_lat` is predicted with that same formula. **A predictor using the previous sub-step is deliberately not used** — it was measured to turn four-wheel braking into a period-2 numerical oscillation. The gap to the reference is now **within 3.0% for braking and 0.15% for launch**, with the sub-step count going 17.3 → 17.5, i.e. effectively unchanged (the speedup is preserved). **Full scale and low grip do not change by a single bit**: the per-wheel arithmetic is identical, and moving the wheel-ODE update out of the loop reorders statements that have no data dependence between wheels, so the values cannot change (machine-confirmed by f0–f3, `verifyHash` and shared URLs matching). **Tabletop and mid-scale v2 results do change**, which is why this is a MAJOR release. The standing gate `wf_aw1_coupled.mjs` machine-checks braking, launch, reverse cornering (18 cells), stability and cost against the explicit path of the same shipped code as the reference.
  - **Known differences that remain (recorded honestly):** ① the **first one or two ticks of a standing start** lie in the low-speed kinematic blend (`|u| < uBlend1`), where the sideslip angle β does not match between the semi-implicit and explicit paths (across six full-lock reverse conditions v7.8.0 was +13% to +71% of the reference; v8.0.0 is −1% to −30%; outside the blend v8.0.0 is within 2.7%). The standing gate `wf_aw1_coupled.mjs` prints this in its G chapter **as a record** (the βmax over the first 5 s after the steering input), not as a pass/fail criterion. ② In one specific manoeuvre — **reversing fast and then flicking the steering the other way** (mid-scale FF) — the semi-implicit path settles into a different steady turn from the reference (yaw rate 0.49 vs 2.75 rad/s), because the outer front wheel stays pinned at the slip-ratio clamp (|κ|=3). **v7.8.0 produced the same values**; the coupling fix did not create it. The 2.7% figure in ① and the whole of ② lie outside the gate's judged cells and come from **a one-off measurement harness that is not shipped**.

### 13.3 The contact model — from "stop and cancel" to "push back"
The dynamics model resolves collisions by "cancel the movement and stop" (atomic pose rejection). v2 uses **rigid-body impulse contact**:
- **Swept CCD** (no tunneling even at high speed = zero penetrations verified mechanically at 96 m/s × thin walls), a **two-point wall manifold**, **normal/tangential impulses** (walls have zero restitution; the tangential side is Coulomb friction μc=0.5×grip), and **split-impulse position correction** (resolving penetration without adding energy).
- **Car-to-car is momentum exchange:** in a side impact (T-bone), angular momentum is handed over; pushing and deflection come out as physics (momentum conservation verified to ≤1e-6).
- A hard wall hit (normal approach speed above a threshold) still routes to the **race-rule crash decision**, and being stuck (commanded forward but unable to move) routes to **recovery steering** — as before.
- A **broadphase grid** (cell = 2× car length) avoids scanning every wall, with **result equality against the full scan verified at zero difference** (it makes things faster without changing any answer).

### 13.4 Full-scale calibration — target bands for real-car feel
Top speed 300–360 km/h (drag-limited), lateral grip capacity 1.40 g at low speed / ≥1.8 g at high speed (with downforce), the **corner-entry rule v=√(μgR)** (holds at 1.0×, lost at 1.15×), and the emergence of FR power-on oversteer / FF understeer / lift-off oversteer were calibrated against bands fixed before implementation. Exceeding the driven axle's grip at launch produces per-wheel wheelspin (power-over).

### 13.5 Tire sets (normal/slip) and the road attribute muDecay — a tabletop drift-learning environment
To reproduce the real RumiCar practice of "swap to slippery tires and practice drifting at low speed," v2 lets each vehicle equip a **tire set: normal / slip** (the constants are calibrated per regime: tabletop slip is μ0≈0.20 = starting wheelspin and power-over become reachable even on the tabletop, while full-scale slip is a hard-compound-like μ0≈0.9; with normal tires the tabletop matches the real-device observation that "ordinary driving doesn't drift"). Courses can also carry a **road-surface muDecay attribute** (post-peak slipperiness = low-μ surfaces). The go/no-go table of §11 was measured with this machinery.


#### Rain tires (v6.4.0 / Stage AS9) — when the road gets wet, the "right choice" changes
A third tire set, **rain** (a grooved soft compound), is **worse than normal on a dry surface and better on a wet one**. Real rain tires are quick in the wet because their grooves clear the water film and win back the road's friction; on a dry surface the soft compound overheats and cannot match a slick. The model is built exactly that way:

- The tire's own peak friction is **ρ = 0.85×** that of normal (tabletop μ0 0.68 / full-scale 1.19).
- Against the road's `course.grip` (<1 = wet) it **recovers a wetGain = 0.70 share of the deficit** (1−grip):
  **gripEff = 1 − (1−grip)·(1−wetGain)**. normal / slip have wetGain = 0, so the expression is the identity (unchanged).

Those two numbers alone fix, in closed form, the road grip at which the faster tire swaps over:

**g\* = ρ·w / (1 − ρ·(1−w)) = 0.85·0.70 / (1 − 0.85·0.30) = 0.7987**

Above 0.7987 (drier) normal is stronger; below it (wetter) rain is. Because ρ is the same in every regime, **g\* is regime-invariant** — measured at 0.798657718 in all three regimes (relative difference 1.4×10⁻¹⁶). Both shipped wet courses (grip 0.5 / 0.55) sit below g\*, i.e. on the rain-favouring side.

**But a faster lap requires actually reaching the friction limit.** Giving the full-scale competition circuit a `grip` value and running Circuit Racer on it, normal's lap time stretches as the surface degrades (**+4.47%** from grip 1.0 to 0.5) while rain stays nearly flat (**0.30%**); at grip 0.5 **rain is 3.93% faster**. On the **tabletop wet courses, by contrast, changing tires barely changes the lap** — the reachable lateral acceleration there is ay ≈ 1.63 m/s², under 60% of a wet normal tire's lateral capacity of 3.92 m/s² (i.e. the car is not sliding at all). That follows directly from the §13.5 design ("a tabletop normal tire hardly ever slides") and is not a defect.

### 13.6 Tire heat and wear (opt-in) — tires as a "strategic resource"
With "Tire wear" ON, each wheel deterministically accumulates **temperature** (first-order relaxation; cold/optimal/overheated) and **wear** (monotone accumulation) from its **slip power P = friction-circle utilization × normalized slip speed** (dimensionless = the same scale on tabletop and real car), modulating peak grip by `clamp(fT·fW, [0.9, 1])` — **the total effect is clamped within 10%** (wear is designed not to dominate the outcome). Measured: for the same running time, a drift stint's (slip FR) rear-tire wear is **tens of thousands of times** a grip stint's — "drift consumes the rears = a resource you spend wisely," and "an always-drift strategy can self-destruct over a long stint" come out as measurements. The HUD shows a 2×2 tire panel with per-wheel friction-circle utilization, temperature, and wear (**display only** = the physics never reads the HUD back). With the default OFF, behavior and hashes match the previous ones exactly.

### 13.7 Determinism and compatibility — with defaults, nothing changes
Engine (v2), tires (slip / rain), **gearing (short / tall / auto2)**, recon laps, and wear are stamped into the race record's canonical form (the seed of verifyHash) **only when a non-default is chosen**. So **default tabletop physics, past deterministic race records, and official records all stay byte-for-byte unchanged**, while non-default records carry their conditions and can be fully replayed and verified later (records also carry the engine version).

### 13.8 What v2 taught us — an honest summary of the measurements
v2 was built not to make things "fast and flashy" but to **measure faithfully what does and does not hold under the real-device constraints (forward ToF×3, three-valued steering, no attitude sensor)**. None of the conclusions are hidden; all are teaching material:
- **Drift cannot beat grip** (§11; NO-GO in all 20 cells; `wf_ao8_gonogo.mjs`). Segments where rotation alone is faster do exist, but the exit re-grip never completes because the run passes **the car's own recovery limit** (past about \|β\| = 36° it can no longer recover within 0.6 s even with the wheel straightened, §13.14). **The steering resolution is not what limits this** (re-measured with continuous steering, GO is still 0). That conclusion is about "holding a deep β inside a corridor that grip can follow geometrically", though — **in a wall-bounded tight hairpin, grip's geometric best line does not fit at all** (8 of 10 cells; §11 "How far this conclusion reaches", re-measured in Stage AU).
- **Attitude (β) cannot be read even with a map** (§10; range-flow NO-GO, and the map-prior re-challenge is NO-GO too).
- **Position is solvable** — the self-localization sample "Self-Locator" (`comp_localize`) uses encoder dead-reckoning as the skeleton, re-anchors each lap by loop closure (matching the start-wall pattern), and applies histogram matching of ToF fingerprints as a weak correction, producing a within-lap position good to **~0.5 bins** (with other cars present, residual gating separates walls from cars; forward detection 96%). But **absolute position is limited by the loop-closure origin accuracy (~2.6 bins)**, which ToF alone cannot shrink on a symmetric course. And as an honest surprise: **on this clean course, ToF map-matching cannot beat the encoder alone** (matching noise > within-lap drift) — the matcher's real value is not correction but confidence, separating other cars, and recovery.
- **The net gain of precise speed-profile planning is roughly neutral on a uniform, symmetric course.** The strategy racer "Apex Strategist" (`strategist`) carries a curvature → target-speed forward/backward-pass plan built from its recon map, but most of its measured speed comes from "aggressive tuning that recon certifies as safe"; per-corner precision braking stayed neutral because (a) all corners share the same radius, so there is no per-corner difference to exploit, and (b) the absolute self-localization accuracy (above) is not enough to brake later safely (11% faster than Circuit Racer, with the mechanism honestly attributed to recon).
- **Pre-race recon (`spec.recon`):** choosing **0–3 recon laps** in 🏁 Race / 📋 Host makes each car preview the course alone, off the clock, before the start (deterministic; stamped into official records too). It is nearly redundant for self-contained learners (Recon Racer previews by itself) — it is **machinery for strategy programs that plan on top of a map**.

### 13.9 Slope (gradient) physics — downhill on touge courses (v4.0.0 → made two-axis in v7.0.0)
- **World-frame gravity projection:** a gradient acts not as a constant push toward the car's nose but as the gravity component along the **world-frame slope direction**, `gFwd = downhill·cos(θ−slopeDir)` (θ = car heading, slopeDir = the downhill direction). So **climbs decelerate and descents accelerate** correctly according to direction (previously it was always added forward — a "conveyor" that accelerated even uphill). **Roll-away from rest** and, optionally, a **static front/rear load transfer due to the gradient** are also modeled.
- **Road-following slope direction (touge courses):** because a touge road descends continuously, the slope direction `slopeDir` is **updated every sub-step to the centerline tangent (the direction of travel)** (a fixed direction would make part of the arc run uphill through switchbacks). With `downhill = g·sinθ` the gradient is reconciled to what the elev badge implies, and the touge elev values were corrected to realistic gradients (up to ~15%) (elev had been a display-only decoration; it is now aligned to a physically meaningful value). Even after recalibration the top speed is capped by the drivetrain servo, so a descent mainly strengthens corner-exit acceleration.
- **In-plane gravity has two components (corrected in v7.0.0):** v4.0.0–v6.4.0 applied only the forward component above and **dropped the body-lateral component `downhill·sin(θ−slopeDir)` of the very same gravity vector**. Measured on real touge runs, the car heading and the road direction diverge by up to 80°, so the **lateral gravity being discarded reached 1.47 m/s²** — the same order as the lateral acceleration a_y≈1.63 m/s² actually attainable at tabletop scale. Worse, the wheel loads still used the full `g`, so the model's total gravity was √(g²+downhill²) — **+1.16% of gravity created out of nothing**. v7.0.0 decomposes gravity correctly with respect to the road plane — with δ = θ − slopeDir: `in-plane fwd = g_in·cos δ` / `in-plane left = −g_in·sin δ` / `normal g_N = √(g² − g_in²)`. This finally includes the force that matters most on a real mountain pass: **being pushed from the uphill side toward the valley side through a descending hairpin**. Flat ground (zero in-plane component) is completely unchanged.
- **Defaults unchanged:** downhill = 0 (non-touge courses) takes the previous path and is byte-identical. Only driving on touge courses and sloped v2 changes; records from that time are honestly kept with an "(as of vX)" note.

### 13.10 Read the implementation
- `public/js/physics_v2.js` — four-wheel two-track, combined MF, relaxation length, differential / wheel ODE, tire sets, heat/wear (`TH`)
- `public/js/contact_v2.js` — broadphase grid, CCD, impulse contact (`resolveFleetContacts`)
- `integrateFleetV2` in `public/js/fleet.js` — simultaneous whole-fleet integration + batch contact resolution; `public/js/race_engine.js` — the recon phase, canonical form, determinism
- Verification gates (tracked in the repository; every item machine-asserted): `wf_ao1_v2.mjs`–`wf_ao12_wear.mjs` (public-surface compatibility, friction-circle invariants, energy audit, zero tunneling, momentum conservation, calibration bands, the go/no-go table, the localization oracle, wear measurements, and more)

---


### 13.11 Gearing (optional equipment, v6.4.0 / Stage AS9) — trading acceleration against top speed
The real RumiCar is direct-drive, but on RC cars changing the ratio by swapping the pinion is a standard adjustment, and two-speed mechanical transmissions do exist. v2 offers this as **optional equipment** (the same category as the rear sensor and the wheel encoder). The default is `direct` (ratio 1, single speed), so **if you do not pick it, nothing changes from before**.

With a reduction ratio r, motor torque reaches the wheels multiplied by r and wheel speed is divided by r. Therefore:

- **Torque-limited acceleration cap ×r**, **the gear-imposed speed ceiling ÷r**, and **motor braking ×r** as well (it runs through the same gear train).
- **Power-limited output is unchanged**: the full-scale constant-power drivetrain (`wheelPower`) obeys P = F·v, so gearing cannot change the available power (it is not multiplied).

Measured (on both tabletop and midscale the top-speed ratio matches the predicted 1/r to a relative difference of 10⁻¹⁶):

| Gear | Ratio | 0→50% maxV | Top speed (vs baseline) |
|---|---|---|---|
| Direct (default) | 1.00 | 0.233 s | 102.0% |
| Low (short) | 1.45 | **0.167 s** | 70.3% |
| High (tall) | 0.72 | 0.317 s | **141.7%** |
| 2-speed automatic | 1.45→0.72 | **0.167 s** | **141.7%** |

Acceleration and top speed move in opposite directions — **no single choice is always best**, and that is the lesson. The 2-speed automatic shifts by road speed to chase both, but **drive is cut for a moment at each shift** (0.100 s on the tabletop; the shift time follows the Froude time √(L/0.13), giving 0.133 s at midscale and 0.433 s at full scale).

**At full scale a taller gear does not raise the top speed at all** (ratio 1.0000), exactly as measured. Top speed there is set by **aerodynamic drag**, which bites before the gear ceiling does, so a tall gear only throws away acceleration (0→50% goes from 8.83 s to 12.80 s) for a top speed that never arrives. A low gear, conversely, puts the gear ceiling below the drag ceiling and does lower the top speed (ratio 0.819).

---

### 13.12 Cross-slope (cant / banking, v7.0.0 / Stage AS10) — a road surface that changes the cornering limit

Real roads have **cant (cross-slope / superelevation)**. Raising the outside of a curve turns part of gravity toward the inside of the turn, so **you can corner without relying on tire friction alone**. The optional course field `bank` (degrees) expresses this (omitted = 0 = exactly as before).

- **Where and how much:** `bank` is the **bank angle at this course's tightest corner**; everywhere else it scales **in proportion to the local curvature**, down to 0 (straights are unbanked). That is precisely the superelevation rule used in road design, e ∝ v²·κ/g at a fixed design speed, and it **introduces no new constant**. The sign follows the turn direction, so **the bank leans the same way even if you drive the course backwards** (just like a real bank). Negative values give **adverse camber** (working against the turn).
- **Closed form for the limit speed:** in the road plane the inward acceleration available is "tire μ·(normal gravity) + in-plane gravity", so for a banked corner of radius R the limit speed is `v_max² = R·g·(μ·cos φ + sin φ)` (φ = bank angle; φ=0 recovers the familiar v²=μgR). The **cos φ appears** because the force pressing on the road (the normal load) is reduced by exactly what was taken into the plane. Taking ratios of this formula cancels both the proportionality constant and the absolute μ, so a standing gate can check it **without copying the implementation's internal expression into the test**.
- **Lateral load transfer comes for free:** the lateral gravity produced by the bank is only balanced once **the tires hold it with a lateral force**. Load transfer is computed from that tire lateral force, so there is no need to add the cant term to the load-transfer equation (doing so would double-count it).
- **Which engines interpret it:** **precision v2** and **dynamics**. The simple "classic" engine carries speed as a scalar and **has no lateral degree of freedom (v_lat)**, so it cannot represent lateral gravity (its forward component still works as before). `bank` is also only meaningful for `track`/`touge`, which carry a centerline; `annulus`/`raw` are unsupported.

### 13.13 Suspension degrees of freedom (optional equipment, v7.1.0 / Stage AS11) — letting load transfer overshoot

A car leans (rolls) in a corner because the springs take time to compress. While it is leaning, tyre load moves outwards, and that load transfer sets the grip. **Until now v2 treated load transfer as a quantity that follows acceleration with a first-order lag** (time constant τ_susp ≈ 0.12 s × the regime's time scale). A first-order lag can only lag — it can never overshoot — so it could not produce the transient that a real car shows on a flick transition, where the roll goes past its final value and then settles back. (That simplification was recorded as a deliberate Stage AO design decision.)

Selecting **suspension DOF (optional equipment)** turns roll and pitch into **genuine one-degree-of-freedom spring-damper modes**. Writing q for the effective acceleration that the load transfer reads:

```
q̈ = ω²·(a − q) − 2ζω·q̇          ω = natural frequency, ζ = damping ratio, a = actual acceleration
```

- **Nothing changes in steady state.** The fixed point of this equation is q = a, so once the acceleration settles, the load transfer converges to **exactly the same value as before**. Only the **transient** differs (measured: relative difference from the previous model in a steady turn ≤ 1×10⁻¹⁵).
- **The amount of overshoot depends only on the damping ratio.** For a step-like input the peak overshoot is **Mp = exp(−πζ/√(1−ζ²))** and it is reached at **t_p = π/(ω√(1−ζ²))**; neither contains a proportionality constant (measured: Soft 37.23% / Balanced 4.60% / Stiff 0%, within 4×10⁻⁴ of the closed form).
- **Not a single new absolute constant was added.** The natural frequency is anchored to the existing τ_susp as ω₀ = 1/τ_susp, and the equipment supplies only **two dimensionless numbers** (ω/ω₀ and ζ). Being dimensionless, **the same numbers mean the same thing on the tabletop, mid-scale and full-scale** (measured: spread of ω·τ_susp across the three regimes ≤ 1.5×10⁻⁵).
- **What you can observe**: on a flick, Soft makes the load transfer swing **past the peak of its own input** (measured: ratio 1.57 after normalising by the input's own peak; a first-order lag can never exceed 1 and measures 0.86). The overshooting load transfer transiently **eats into total lateral grip** through load sensitivity (measured on the tabletop: −1.01% for Soft against −0.02% for the previous model), and because the front axle carries the larger share ζF = 0.55, the loss is front-biased and shows up as **transient understeer** (front share of the capacity dips 0.41 pt against 0.16 pt).
- **Numerics**: this one-DOF system is linear and its coefficients are constant throughout a step, so **the analytic solution is used directly as the discrete update** (the transition matrix is built once per step). That gives **zero numerical damping and zero frequency error**, and the eigenvalue magnitude is always e^{−ζωh} < 1, i.e. **unconditionally stable**. Against the ω·h = 2 divergence boundary of an explicit scheme, the worst production value is ω·h = 2.95×10⁻² (a margin of ×68).
- **It is completely inactive by default.** The default "quasi-static" setting carries no degree of freedom and runs only the previous two-line first-order lag, so past records, frozen hashes and official races are unchanged to the byte. It applies only when equipped, and that condition is stamped into the source of the race verification hash. **Precise v2 engine only** (the dynamics and classic engines ignore it).

### 13.14 Continuous steering (optional equipment, v7.2.0 / Stage AS12) — separating steering *resolution* from *bandwidth*

The real RumiCar steers with **three states — left / centre / right** — and that is an invariant of the learning API
itself (D-1). The equipment in this section does not replace it; it is an **opt-in addition** that lets you try
"what changes if I fit a **proportional steering servo** to the real car" (the default `tri` changes nothing, not
one byte). The API mirrors `RC_drive(direction, pwm)` with a second argument: `RC_steer(direction, 0..255)`.

**Three-state steering can already make intermediate angles.** The servo simply travels toward its target at
`steerRate` [rad/s], so toggling the three-state command rapidly averages out to an intermediate angle (duty
steering). Therefore continuous steering changes the *resolution*, not the *bandwidth*:

| Command rate | 3-state hold error (mean / max) | Continuous | Bound `steerRate / command rate` |
|---|---:|---:|---:|
| 60 Hz (physics) | 0.955° / 1.149° | **0.0235°** | 1.910° |
| 20 Hz (**the rate a learning program actually runs at**) | 1.593° / 3.059° | **0.0235°** | 5.730° |

The three-state ripple grows **in proportion to the command interval** (the bound is "how far the servo can travel
during one command"). The residual with continuous steering, by contrast, is **exactly the API's 1/255 quantisation**
and depends on neither the command rate nor the regime (`|round(0.35·255)/255 − 0.35|·δ_max = 0.0235°`). At the 20 Hz
a program really runs at, that is roughly a **68× improvement**.

**Drifting does not become faster with continuous steering (measured).** We re-measured Stage AO8's 20-cell
"is drifting faster?" table with continuous steering: **not a single cell turns GO** (all 20 remain NO-GO). Isolating
the cause:

1. Making the servo rate `steerRate` **64× faster** (full lock to opposite full lock: 0.838 s → 0.013 s) leaves the
   continuous-steering drift-hold time flat at 0.27–0.28 s ⇒ the limit is not steering bandwidth either.
2. The real wall is the **car's own recovery limit**. Testing, from each point of the real trajectory, "if I
   straighten the wheel, can it return to `|β| < 35°` within 0.6 s", it **can up to about 29° and cannot from 36°**.
   The drift operating point (`|β| ≈ 35°`) sits right on that boundary, so no amount of steering precision turns it
   into a controlled pass. **The "why drift cannot win" in §11 and §13.8 is now unified on this recovery limit**
   (older revisions said "because steering is three-valued" in §11 and §13.8, which contradicted the measurement in this
   section; corrected in Stage AU).

∴ **Continuous steering is equipment for placing the steering precisely, not for going faster.** Indeed, three-state
is quicker on the tabletop oval (best-lap ratio 1.030 / 1.061), and on the full-scale circuit the sign depends on the
car (continuous is 8.2% faster for FF, but 27.7% and 22.9% slower for FR and AWD). Speed is set by corner radius and
the friction limit, not by steering resolution.

**Implementation**: the target steering angle is decided in one place, `steerTargetOf(command, δ_max, equipment,
amount)`, which early-returns **the identical double as the old expression** whenever the equipment is `tri` or no
amount was given (shared by all three engines; byte-invariant). `255/255` is exactly 1.0 in IEEE 754, so "full lock"
is **bit-identical** to the three-state call. The equipment is stamped into the share URL (`ss=`) and into the canon
of official records **only when it is not the default**.

### 13.15 Loose surfaces (course attribute, v7.6.0 / Stage AV1) — a road where sliding does not cost you grip

On gravel, dirt or snow the tire sinks into the top layer and **builds a bank of material ahead of itself and pushes it aside** (digging / bulldozing). That part of the force is set not by Coulomb friction but by *how much material was displaced*, so it **grows the more you slide**. This is why the optimal slip angle on tarmac is 5–10° but 20–30° on dirt, and why rally cars corner at large slip angles. The optional course field `surface` (`"paved"` (default) / `"loose"`) expresses it.

- **Why the existing surface fields were not enough:** a surface used to be described by `grip` (peak multiplier) and `muDecay` (post-peak asymptote), and **both can only produce a curve that falls as you slide**. The asymptote of the tire curve g(σ)=sin(C·atan(Bp·σ)) is clamped to [0.35, 0.95] in the implementation, so writing `muDecay: 1.0` still clamps to 0.95 and the curve still decreases monotonically for σ>1 (for instance on a low-μ surface with `muDecay=0.92`, g(1)=1.000 → g(4)=0.956). **"Does not fall" was outside what the model could say.**
- **The equation:** to the magnitude of each wheel's resultant force we add a term that grows in proportion to the normalized slip σ and then stops at a cap: `F = μ·Fz·[ g(σ) + dig·min(σ/digSat, 1) ]`, with an effective friction circle of `μ_eff = μ·(1 + dig)`. `dig` is the force the fully built bank can add (as a ratio of peak friction) and `digSat` is the σ beyond which the bank stops growing. The built-in loose surface uses `dig=0.30 / digSat=3`. **`μ_eff` is an upper bound, not the least upper bound** — the largest force actually reachable is `g(digSat)+dig`, which at the built-in constants is 91.9% of `μ_eff`; the remainder is headroom for the digging term ramping up in proportion to σ.
- **No physical invariant is broken:** the term **changes only the magnitude, never the direction (which stays opposite the normalized slip)**, so the power of the *steady-state* tire force against ground slip stays `F·v_slip = −(F·denom/σ)·(κ²/κP + tanα²/αP) ≤ 0` (always dissipative) and the friction circle `|F| ≤ μ_eff·Fz` is guaranteed structurally. A standing gate checks **that steady-state force** as continuous margins over the whole grid and over whole traces.<br>Note that the force **actually applied to the body** is that quantity after the lateral-force relaxation length (a first-order lag) and the radius clamp, and for it dissipativity is **not guaranteed even on tarmac** — a known property of the relaxation-length model (energy stored in carcass deflection), not something loose surfaces introduced.
- **What actually happens (measured):** the peak moves from `σ=1` (α=8.0°) to `σ=3` (α=22.8°), and the lateral-force-to-peak ratio at σ=2/3/4 goes from 0.94/0.89/0.86 on tarmac to 1.14/1.19/1.16 on loose. **It keeps rising up to σ=digSat and then decays gently in the same shape as tarmac, but never drops below the tarmac peak however far you slide.** Sliding all the way to σ=8 still caps the digging contribution at 0.300 (without the cap it would grow to 0.800 and break the friction circle).
- **Its effect on drifting is not straightforward (an honest measurement):** making the low-μ benchmark (grip 0.6) loose increased the number of drift runs that get round without breaking from **38 to 202 (×5.3)**, and one hairpin that no drift line could clear on tarmac **became clearable** (this effect stays at ×5.3–5.4 when the sweep is made coarser or finer). But **neither of the two expectations we started from was confirmed**: ① "the drift/grip lap-time ratio drops on loose" **flips sign when the sweep grid changes** (with a three-point β grid it is 0.876→0.875; with two points and with five points it reverses). ② "more solutions get round with deep slip (βpk≥20°)" **has a sweep-dependent sign in aggregate** (over the default 6 cells it falls 28 → 18; over the 18 cells of `--full` — 3 corners × 2 angles × 3 car types — it rises 58 → 234). Some cells gain and some lose, and **we have not identified the mechanism** (the minimum turning radius is not the dividing line: R=6.5 m is larger than the 5.84 m minimum radius, yet the deep solutions tarmac had there disappear). **The widening of the feasible region (the ×5.3 above) does survive the 18-cell sweep** (clean runs 74 → 754 (×10.2); cells with a clean drift solution 6/18 → 9/18 — besides R6.5/180, which no line could clear on tarmac, the drift car's R6.5/90 and R8/90 become clearable on loose).
- **It does not make a surface "slippery":** adding digging to the same `grip` makes the surface **uniformly grippier**. Real dirt being slippery comes from its low `grip`, not from digging. To get dirt-like behaviour, lower `grip` *and* set `surface:"loose"`.
- **The HUD / race-report "friction-circle usage" is normalized by the peak σ (v7.8.0):** that display is the normalized slip σ shown as a percentage, and on tarmac the peak is at σ=1, so "100% = at the limit" reads correctly; on a loose surface the peak is at σ=3, so **in v7.6.0/v7.7.0 a car running at maximum grip displayed 300%**. From v7.8.0, on digging surfaces the display divides by the actual peak σ of that surface's tire law (exactly digSat=3 with the built-in tires' default muDecay and on the low-μ bench; on a surface with muDecay ≤ 0.5 the peak moves to an interior σ≈1.2; `surfacePeakSigma`), so **"100% = the peak, over 100% = sliding past the peak" reads the same on tarmac and on loose**. It is a display-layer change only; the physics is unchanged. Tarmac goes through the same expression as before (the else branch), so its value is structurally unchanged, and the standing B8 family (6 assertions) machine-fixes that the display helper's peak σ matches a brute-force argmax of the tire law (for the built-in loose surface and for synthetic surfaces with an interior peak), that tarmac matches the closed-form σ, that loose reads 1.0 at the peak slip angle, that swapping the peak σ leaves the physics state bit-identical while only the display scales with it (on both the tarmac free-rolling path and the tabletop semi-implicit braking path), and — as a static check on the source — that the only line reading sigPk is the display assignment. The race report's suitability label ("a lot of sliding" at a peak usage of 150% or more) is also judged on the normalized value.
- **Which engines interpret it:** **precision v2 only.** The reason is *not* that the other engines lack a tire curve — the dynamics engine does have a simplified Pacejka peak-with-gentle-decay and a friction ellipse. It is that the digging term is defined **as a ratio of each wheel's peak friction μ·Fz, on v2's combined slip σ=√((κ/κP)²+(tanα/αP)²)**, and the single-track (bicycle) dynamics engine has no per-wheel μ·Fz (only per-axle friction-ellipse radii) and normalizes slip differently (|α|/alphaPeak), so **there is nothing to add it to**. Classic additionally has no lateral degree of freedom. Adding it without re-deriving it for those models would be injecting a difference with no substance, so they are declared out of scope and a standing gate machine-fixes that. Unlike `bank`, it **does not care about `kind`** (it needs no centerline, so it works for `track`/`touge`/`annulus`/`raw` alike).
- **Nothing changes by default.** An omitted `surface`, `"paved"`, and unknown values all keep the digging term **out of the expression** (a guarded branch), so the frozen benchmarks f0–f3, the official race `verifyHash` and every existing record are unchanged.

### 13.16 Four-wheel friction brakes (optional equipment, v7.7.0 / Stage AV2) — choosing *which wheels* get the braking

The real RumiCar brakes with **the reverse torque of its drive motor and nothing else**, and v2 reproduces exactly that (a BRAKE command flows to the driven axle). Consequently **an FR car locks only its rear wheels while the fronts keep rolling freely**. That is the same thing as stopping the car on the handbrake: it does not stop well, and touching the brake mid-corner makes the rear step out at once. The optional per-car field `brakeSet` (`"motor"` (default) / `"friction"` / `"frictionFront"` / `"frictionRear"`) lets you "fit" a real car's four-wheel friction brakes.

- **What the default actually does (measured)**: full-scale, normal tires, grip 1.0, braking from 40 m/s down to 2 m/s gives **FR 138.97 m (0.588 g) / FF 88.11 m (0.926 g) / AWD 65.85 m (1.239 g)**. Half a second into the stop, an FR car's wheel surface speeds read `[front 35.73, 35.73 / rear 0.00, 0.00]` against u = 35.72 — the fronts follow the ground, the rears are fully locked. **The same mass and the same tires stop in more than twice the distance purely because of the drivetrain**, because the number of braked wheels differs.
- **The model**: the total braking command `fCmd` is **left unchanged**. A fraction `biasF` goes to the front axle and `1 − biasF` to the rear, split evenly left/right within each axle. So **the equipment does not add braking *command* — it only changes where the command goes** (the standing gate checks that Σ fApp agrees between equipment choices to within 2 ULP). **But the command and the force that actually reaches the road are different things**: a wheel cannot produce force until slip builds up, and a locked wheel produces its full tire capacity regardless of what it was commanded. **So it is only the command whose sum is conserved; the delivered force does change with the split** — see the regime note below for which way it goes. **Only the driven axle has its two wheels coupled through the differential**, so the LSD transfer still applies there (total axle force unchanged — it only alters yaw). Brake calipers on the non-driven axle act independently per wheel.
- **Lock-up emerges; there is no threshold in the code**: each wheel's brake force simply enters that wheel's rotational ODE `dvw/dt = λ·(fApp − fx_tire)`, and if it exceeds that wheel's longitudinal tire capacity the wheel speed falls to zero. **Load transfer and μ therefore act automatically.** Measured (0.42 s of braking in an R = 60 m corner): raising `biasF` through 0.45 → 0.60 → 0.75 raises the front lock fraction monotonically 0.52 → 0.76 → 0.84 and lowers the rear one monotonically 0.68 → 0.36 → 0.00 (the ordering survives changes of grip).
- **A closed form for the deceleration**: under full braking, where every wheel locks, **the ratio of decelerations is the ratio of the capacity of the braked wheels**. A motor-braked FR car can only use the rear axle, so `a_motor / a_friction = (Σ_all μ·Fz − Σ_front μ·Fz) / Σ_all μ·Fz`. Measured error is **0.6–1.1 % at low speed (10 m/s)** and 4.9–8.3 % at 30 m/s — that residual is **aerodynamic drag**, which is not part of tire capacity and therefore inflates the measured ratio (the standing gate confirms that the error grows with speed).
- **Effect on stopping distance (measured, grip 1.0, 40 → 2 m/s)**:

  | Drivetrain | motor (default) | friction (60 front / 40 rear) | front-biased (75/25) | rear-biased (45/55) |
  |---|---|---|---|---|
  | FR | 138.97 m (0.588 g) | **63.40 m (1.288 g)** | 63.38 m | 63.64 m |
  | FF | 88.11 m (0.926 g) | **68.05 m (1.199 g)** | 66.98 m | 68.95 m |
  | AWD | 65.85 m (1.239 g) | 65.70 m (1.242 g) | 65.24 m | 65.85 m |

  **FR gets 54 % shorter; AWD barely moves (0.2 %)** — an AWD car already spreads motor braking over all four wheels, so **this equipment matters for cars that have wheels which receive no braking at all**. **The three splits barely differ in a straight line**, because the braking command is 4.013 g, 2.87× the tire capacity of 1.40 g, so every wheel saturates however you distribute it. **The split matters in corners**, where lateral force is already consuming the friction circle.
- **Braking mid-corner (trail braking) — what can and cannot be claimed**: measured over **two independent grids (54 and 288 cells)** sweeping radius, entry speed, brake duration, road μ and steering type.
  - **Claim 1: the rear of an FR car always locks less.** The mean falls 0.800 → 0.210 (grid 1) and 0.662 → 0.123 (grid 2), and **not one of the 342 cells got worse**.
  - **Claim 2: an FR car's recovery back into the corner never degrades.** Cells that returned to `|β| < 10°` after the brake release went 13 → 39 (grid 1) and 88 → 200 (grid 2): **138 cells gained, 0 lost**.
  - **Claim 3: an FF car locks its rear *more*.** A motor-braked FF car puts no braking on the rear at all, so spreading to four wheels necessarily increases it (0.000 → 0.320 and 0.000 → 0.233, with zero cells decreasing). The equipment is not a "always safer" spell.
  - **FF and AWD cars *lose* recovery cells — unlike FR.** Over the 288-cell grid, **FF loses 18 and gains 5** (283 → 270) and **AWD loses 15 and gains 8** (258 → 251). Only FR "never gets worse in a single cell": **the trade this equipment makes reverses with the drivetrain.** The preset splits are deliberately *not* made drivetrain-dependent (a v7.8.0 ruling): the three presets exist so that learners can measure the stability ⇄ rotation trade themselves, and a per-drivetrain default would make the same equipment name mean different things on different cars, which is unreadable in a record's conditions. Instead, the equipment selector's tooltip states that the trade reverses with the drivetrain.
  - **What cannot be claimed: that the peak sideslip angle βpk falls.** The mean does fall (FR: 55.1° → 22.7° and 47.3° → 23.0°), but **individual cells go the other way** (9 of 54 in grid 1, 54 of 288 in grid 2). It is therefore recorded as **a continuous measurement, not a law**.
- **⚠ On the tabletop and mid-scale this equipment makes braking slightly *worse* — the opposite direction to full scale. Up to v7.8.0 that penalty was reported far larger than it really is.** Comparing decelerations in a straight-line full-braking stop for the same FR car, the equipment makes braking **2.11× stronger at full scale** but **below 1× — weaker — on the tabletop and mid-scale**. **That direction is not a numerical artefact:** the explicit path of the same shipped code (the reference solution) gives **0.94** too, so it is a property of the equipment. What was wrong was the **magnitude**: v7.7.0–v7.8.0 measured **0.76 (tabletop) and 0.77 (mid-scale)**, far worse than the reference, which showed up as stopping distances roughly **30% longer**. The cause was not the regime as such but the **semi-implicit wheel ODE (§13.2, v4.0.0) freezing the ground-contact speed during the implicit update** (an operator split); delivered/commanded was then 0.59 with the default motor brake and 0.43 spread over four wheels, and the detailed measurement of the mechanism is kept in the v7.8.0 changelog entry. **v8.0.0 (Stage AW) couples the wheel ODE to the body acceleration within the same sub-step**, and the ratio is now **0.96 (tabletop) and 0.95 (mid-scale)** — essentially the reference's 0.94, i.e. stopping distances **3.5–6.2% longer**. (These ratios are decelerations computed from the *actual* final speed; chapter B of `wf_aw1_coupled.mjs` prints the decelerations they come from, 3.544/3.389 against the reference 3.654/3.428. Chapter I of `wf_av2_brake.mjs` uses the *target* final speed instead and prints 0.97/0.94 — a different basis, hence different numbers.) Delivered/commanded is back to 0.955 with the motor brake (reference 0.935). **So the penalty is within 5% on the actual-final-speed basis** (5.8% for mid-scale on the target-final-speed basis) — the same direction and the same order as the 0.96–2.11 range of conditions that never take the semi-implicit path (low-grip surfaces, slip tires, full scale). **The discriminating quantity is whether spreading the command gets *more* of it onto the road**, and the standing gate machine-checks across all 8 conditions that "the equipment helps ⟺ the delivered/commanded ratio rises" (that the trade itself comes out differently by regime is a property of the equipment — the reference does the same). **This fix changes tabletop and mid-scale v2 results** (the frozen benches f0–f3 and the official `verifyHash` do not take this path and are unchanged). The stopping-distance table and the trail-braking grids above were measured at full scale and **remain valid as they stand**. One retraction: v7.7.0 explained the mechanism as "the damping uses the safe-side linear-region stiffness", the v7.8.0 measurement showed that was not the main cause (moving the damping to the local slope does not fix it), and v8.0.0 fixed the real one (the operator split) — **that v7.7.0 explanation is withdrawn**.
- **Brakes inject no energy**: the standing gate checks across the whole sweep that wheel surface speed never changes sign while braking (a brake cannot drive a wheel backwards). Note that **for the first 0.1–0.37 s after switching to BRAKE the body is still being pushed forward** — the driven wheels were spinning faster than the ground under full throttle (κ > 0), and braking force cannot build until that slip has washed out. **This is equally true of the default motor brake**; what the gate fixes is that kinetic energy decreases monotonically from the moment every wheel is producing braking-side longitudinal force.
- **On LSD-equipped cars one wheel's command can turn positive (drive-side) during braking — an existing property, left unchanged by the v7.8.0 ruling**: the differential's transfer-torque cap `lsdTtMax` is an **absolute value** (8, mass-normalized), not a ratio of the transmitted torque, so where the axle's braking force is small (the tabletop) the transfer can exceed half of it and the faster wheel's command goes positive. It happens with the default motor brake too (85 of 504 runs across 3 regimes × all 6 car types × 4 brake sets × 7 grips) and is a property of the differential model (§13.2): the total Σ fApp is conserved and no energy is injected after wash-out. It is the same thing as differential wind-up in a real car (a near-locked diff putting opposite torques on the inner and outer wheels), so the cap is **not** changed to a relative one, and the standing gate E5 keeps counting the occurrences.
- **Which engine interprets it**: **the precise v2 engine only**. The reason is **not** that the other engines lack a wheel ODE (the dynamics engine does have an axle-level wheel ODE and a friction ellipse). It is excluded because (1) the meaning of a front/rear split lies in **per-wheel (four)** loads and lock-up — the inner wheel locking first, the front gaining capacity through load transfer — whereas the dynamics engine is **axle-level (two)** and cannot represent left/right asymmetry at all; (2) the dynamics engine's braking machinery (wheel ODE, bidirectional friction-circle coupling, lateral load transfer) is **active only in the full-scale regime**, so on the tabletop it degenerates to an instantaneous clamp with no emergent lock-up — the same equipment would **silently do nothing** depending on the scale; and (3) the classic engine has neither a lateral degree of freedom nor any wheel state, its braking being a scalar deceleration rate. The exclusion is machine-fixed by the standing gate as an unchanged `traceHash`.
- **With defaults, not one byte changes.** An unspecified `brakeSet`, `"motor"`, and unknown values all **skip the distribution block entirely** (a guarded branch), so the frozen benchmarks f0–f3, official-race `verifyHash` values and existing share URLs are all unchanged. **Only a race containing at least one non-default car** stamps the equipment into `verifyHash`, which is what lets a friction-braked record be told apart from a motor-braked one.

## 14. For Those Who Want to Dig Deeper — Index

**Search keywords:** single-track / bicycle model, slip angle, Pacejka "Magic Formula", friction circle (traction circle), combined slip, longitudinal slip ratio, weight (load) transfer, understeer gradient, yaw moment, Froude number, dynamic similarity, aerodynamic downforce, range-flow / optical-flow odometry, observability, least squares (normal equations), time-of-flight (ToF), field of view (FoV) / sensor cone, VL53L0X, ground-plane constraint, two-track (double-track) model, open differential / limited-slip differential (LSD), tire relaxation length, impulse-based contact, continuous collision detection (CCD), sequential impulses / split impulse, tire thermal model / tire wear, histogram filter (Markov localization), loop closure, dead reckoning.

**Read the implementation:**
- `public/js/physics_dyn.js` — equations of motion, friction circle, tire curve, wheel slip, aero, `applyRegime()`
- `public/js/physics_v2.js` + `public/js/contact_v2.js` — the precise v2 engine (§13)
- `public/js/config.js` — `REGIMES` (regime constants), `DYN_DRIVE` (drivetrain parameters), `scaleRegime()` (Froude similarity), car table
- `public/js/physics.js` — classic (kinematic) version
- `public/js/sensors.js` — ToF ranging (`readSensor`/`readRear`, nearest-in-fan), `public/js/geom.js` — `coneNearest()` (analytic nearest point in the FoV cone)

**On the driving-logic side:** how to use each constant "to drive fast" is in GitHub's `programs/README.md` and the header comments ("why this setting") of each program (`programs.js` / .ino).

---

## Credits

Vehicle physics model — design: **Fable 5** (the original kinematics, Fable Racing Line) / dynamics, tires, aero, regime model, and this guide: **Opus 4.8** / the precise dynamics v2 engine (four-wheel two-track, impulse contact, heat/wear; Stage AO): **Opus 4.8**, final consistency audit: **Fable 5**.

Built on the characteristics of the real RumiCar, structured for education so you can trace "why it moves that way" from the equations. The same program runs unchanged on the real RumiCar too.
