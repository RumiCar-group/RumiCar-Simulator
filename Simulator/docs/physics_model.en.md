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

The non-dimensional shape coefficients (the tire curve's `α_peak` / `k_decay`) are invariant under Froude similarity, so they carry over the tabletop values.

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

**Conditions under which it doesn't hold (vary by where you place the same program):**
- **Too open** (a plaza with no walls in view = the competition ground): `comp_slip`, which judges corners by wall distance, cannot recognize a corner, so it **drives straight off the course** without ever drifting.
- **Too tight / too slow** (e.g. a tabletop mountain pass): the full-scale absolute thresholds don't fit the small scale, so it sticks to the wall guard and **can't move forward**. Tabletop is also low-speed with narrow paths, so there is no "space to hold a slide" and it polarizes into grip ↔ spin (I-1).

→ Running the same `comp_slip` on the competition circuit / competition ground / tabletop mountain pass lets you experience the contrast directly: **holds (rear slides) / too open (doesn't slide, goes off course) / too tight (stalls)**. Program selection does not force a regime or course, so you can confirm it **just by placing it on any course and running**.

### Re-measured on the precise v2 engine — the "can drift beat grip?" go/no-go table (Stage AO8)

Note that `muXDrift` above (lowering the drift car's longitudinal friction at full scale only) is a mechanism of the **dynamics model (default)**. The precise v2 engine (§13) **abolishes** that hack (and unifies steering at the real-device ±24°), leaves whether drift appears entirely to the faithful four-wheel physics, and then answers "**is drift entry faster than grip driving?**" with a table of **deterministic scripted measurements** over dedicated benchmark corners (hairpins R5/6.5/8 m, medium-speed R50, high-speed R120, each in dry and low-μ versions) × car types × strategies — the result is **NO-GO in all 20 cells** (either grip is faster, or the drift does not complete cleanly). The reference table is `docs/stage_ao/drift_gonogo.md`.

The mechanism is instructive: (a) **there really are segments where drift rotates faster** (on a low-μ hairpin, 90° of rotation takes 1.50 s < grip's 2.0–2.35 s). But (b) **three-valued steering (left / center / right only) cannot continuously hold the equilibrium drift angle** (no continuous counter-steer modulation), so after the rotation the car keeps sliding at β≈60° and **cannot re-grip at the exit** — the full sequence "entry → rotation → re-grip → drive out" never completes. Under this sim's real-device constraints (three-valued steering, no attitude sensor §10), **drift cannot beat grip** — an honest conclusion settled by measurement. As an environment for learning "controlled sustained sliding" anyway, v2 provides **tabletop slip tires** (§13): starting wheelspin and power-over become safely reachable at low speed and low μ, and adding the opt-in **tire wear** (§13) teaches the full lesson that "drift consumes the rear tires = a resource you spend wisely."

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
- **Semi-implicit wheel ODE (tabletop / mid-scale; v4.0.0):** the wheel-rotation ODE is stiff, so explicit Euler needs many sub-steps to avoid divergence (~253 on average for tabletop v2). For grip-sufficient tires in the tabletop / mid-scale regimes the **wheel ODE is integrated semi-implicitly (backward Euler)**, cutting the sub-step count to about 1/9 (~28 on average) for a large speedup. **Full scale and the low-grip (slip) regime stay explicit as before (adaptive sub-steps, §5)**, and the default tabletop physics, the deterministic hashes f0–f3, and official/canonical records are unchanged. Only opting into tabletop v2 changes the numbers; earlier records are honestly kept with an "(as of vX)" note.

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

### 13.6 Tire heat and wear (opt-in) — tires as a "strategic resource"
With "Tire wear" ON, each wheel deterministically accumulates **temperature** (first-order relaxation; cold/optimal/overheated) and **wear** (monotone accumulation) from its **slip power P = friction-circle utilization × normalized slip speed** (dimensionless = the same scale on tabletop and real car), modulating peak grip by `clamp(fT·fW, [0.9, 1])` — **the total effect is clamped within 10%** (wear is designed not to dominate the outcome). Measured: for the same running time, a drift stint's (slip FR) rear-tire wear is **tens of thousands of times** a grip stint's — "drift consumes the rears = a resource you spend wisely," and "an always-drift strategy can self-destruct over a long stint" come out as measurements. The HUD shows a 2×2 tire panel with per-wheel friction-circle utilization, temperature, and wear (**display only** = the physics never reads the HUD back). With the default OFF, behavior and hashes match the previous ones exactly.

### 13.7 Determinism and compatibility — with defaults, nothing changes
Engine (v2), tires (slip), recon laps, and wear are stamped into the race record's canonical form (the seed of verifyHash) **only when a non-default is chosen**. So **default tabletop physics, past deterministic race records, and official records all stay byte-for-byte unchanged**, while non-default records carry their conditions and can be fully replayed and verified later (records also carry the engine version).

### 13.8 What v2 taught us — an honest summary of the measurements
v2 was built not to make things "fast and flashy" but to **measure faithfully what does and does not hold under the real-device constraints (forward ToF×3, three-valued steering, no attitude sensor)**. None of the conclusions are hidden; all are teaching material:
- **Drift cannot beat grip** (§11; NO-GO in all 20 cells; `docs/stage_ao/drift_gonogo.md`). Segments where rotation alone is faster do exist, but with three-valued steering the exit re-grip never completes.
- **Attitude (β) cannot be read even with a map** (§10; range-flow NO-GO, and the map-prior re-challenge is NO-GO too).
- **Position is solvable** — the self-localization sample "Self-Locator" (`comp_localize`) uses encoder dead-reckoning as the skeleton, re-anchors each lap by loop closure (matching the start-wall pattern), and applies histogram matching of ToF fingerprints as a weak correction, producing a within-lap position good to **~0.5 bins** (with other cars present, residual gating separates walls from cars; forward detection 96%). But **absolute position is limited by the loop-closure origin accuracy (~2.6 bins)**, which ToF alone cannot shrink on a symmetric course. And as an honest surprise: **on this clean course, ToF map-matching cannot beat the encoder alone** (matching noise > within-lap drift) — the matcher's real value is not correction but confidence, separating other cars, and recovery.
- **The net gain of precise speed-profile planning is roughly neutral on a uniform, symmetric course.** The strategy racer "Apex Strategist" (`strategist`) carries a curvature → target-speed forward/backward-pass plan built from its recon map, but most of its measured speed comes from "aggressive tuning that recon certifies as safe"; per-corner precision braking stayed neutral because (a) all corners share the same radius, so there is no per-corner difference to exploit, and (b) the absolute self-localization accuracy (above) is not enough to brake later safely (11% faster than Circuit Racer, with the mechanism honestly attributed to recon).
- **Pre-race recon (`spec.recon`):** choosing **0–3 recon laps** in 🏁 Race / 📋 Host makes each car preview the course alone, off the clock, before the start (deterministic; stamped into official records too). It is nearly redundant for self-contained learners (Recon Racer previews by itself) — it is **machinery for strategy programs that plan on top of a map**.

### 13.9 Slope (gradient) physics — downhill on touge courses (v4.0.0)
- **World-frame gravity projection:** a gradient acts not as a constant push toward the car's nose but as the gravity component along the **world-frame slope direction**, `gFwd = downhill·cos(θ−slopeDir)` (θ = car heading, slopeDir = the downhill direction). So **climbs decelerate and descents accelerate** correctly according to direction (previously it was always added forward — a "conveyor" that accelerated even uphill). **Roll-away from rest** and, optionally, a **static front/rear load transfer due to the gradient** are also modeled.
- **Road-following slope direction (touge courses):** because a touge road descends continuously, the slope direction `slopeDir` is **updated every sub-step to the centerline tangent (the direction of travel)** (a fixed direction would make part of the arc run uphill through switchbacks). With `downhill = g·sinθ` the gradient is reconciled to what the elev badge implies, and the touge elev values were corrected to realistic gradients (up to ~15%) (elev had been a display-only decoration; it is now aligned to a physically meaningful value). Even after recalibration the top speed is capped by the drivetrain servo, so a descent mainly strengthens corner-exit acceleration.
- **Defaults unchanged:** downhill = 0 (non-touge courses) takes the previous path and is byte-identical. Only driving on touge courses and sloped v2 changes; records from that time are honestly kept with an "(as of vX)" note.

### 13.10 Read the implementation
- `public/js/physics_v2.js` — four-wheel two-track, combined MF, relaxation length, differential / wheel ODE, tire sets, heat/wear (`TH`)
- `public/js/contact_v2.js` — broadphase grid, CCD, impulse contact (`resolveFleetContacts`)
- `integrateFleetV2` in `public/js/fleet.js` — simultaneous whole-fleet integration + batch contact resolution; `public/js/race_engine.js` — the recon phase, canonical form, determinism
- Verification gates (tracked in the repository; every item machine-asserted): `wf_ao1_v2.mjs`–`wf_ao12_wear.mjs` (public-surface compatibility, friction-circle invariants, energy audit, zero tunneling, momentum conservation, calibration bands, the go/no-go table, the localization oracle, wear measurements, and more)

---

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
