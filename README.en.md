# RumiCar Simulator

**English** | [日本語](README.md)

A browser-based simulator for developing and testing autonomous-driving algorithms. It reproduces the same sensor setup as the real RumiCar vehicle — three front time-of-flight (ToF) distance sensors plus wheel encoders — and runs programs written in C / Python / JavaScript unmodified, so you can evaluate them exactly as they would drive.

**This repository is self-contained.** Clone it, run `docker compose up -d --build` inside `deploy/standalone`, and it works — nothing else required. See **[REBUILD.md](REBUILD.md)** for the full procedure (Japanese).

Live instance: <https://www.rumicar.com/simulator/>

## Layout

```
public/                   what is served = the app itself
├── index.html
├── css/style.css
├── js/                   45 modules (physics, rendering, racing, language runtimes, i18n)
└── data/courses.json     catalogue of 41 courses

docs/
└── physics_model.md(.en.md)   the driving-physics model, with equations and calibration values (Japanese & English)

Dockerfile                nginx:alpine + public/ (that is all)
compose.yaml              for the integrated setup (joins rumicar-net, no published ports)
nginx-default.conf        serving config with gzip enabled
gen_course_files.mjs / gen_program_files.mjs   catalogue generators for courses/programs
validate_courses.mjs      consistency checks for course data
wf_*.mjs                  53 permanent verification gates (regression checks after changes)
browser/                  real-browser verification harness (headed Chrome; not needed to serve or run)

deploy/
├── standalone/           runs on its own — no WordPress or existing site needed (recommended)
└── integrated/           piggybacks on an existing nginx (location snippet)
```

Highlights inside `js/`: `physics.js` / `physics_dyn.js` / `physics_v2.js` (three driving engines), `race_engine.js` (deterministic racing), `interp/` (lexer/parser/evaluator for C and Python), `car_sprite.js` `elev3d.js` `depth.js` (procedural rendering), `i18n/` (Japanese & English).

## Design highlights

- **No binary assets at all.** Vehicles, courses, and effects are drawn procedurally at runtime. There is not a single image file.
- **Zero external libraries or CDNs.** No npm packages either — `node_modules` is needed neither to serve nor to run.
- **Deterministic.** The same input reproduces the same result, byte for byte. 53 verification gates machine-check this invariance, guaranteeing the compatibility of race records and share URLs. The gates ship inside this repository, so **anyone can clone it and run `node wf_run_all.mjs` to verify with their own hands** (no dependency beyond Node.js).
- **Works offline.** The only external access is listing community contributions, and the app keeps working if it fails. Listings of contributions (courses, programs, car types) are read from an `index.json` in each directory via raw (no rate limit), falling back to the GitHub API when that file is absent. Only the official race listing still uses the API, since it has to enumerate directories. Results are cached briefly in the browser, so even when many people share one connection - a classroom, say - the unauthenticated API ceiling (60 requests per hour per IP) is far less likely to be hit (v7.4.0).

## About the community features (important)

When you share a course, driving program, or car via "🌐 Share on GitHub", or post from "💬 Questions & suggestions", **the destination is fixed by default to this project's upstream repository, [RumiCar-group/RumiCar](https://github.com/RumiCar-group/RumiCar)** (as a pull request / issue, created under the contributor's own GitHub account).

If you clone this repository and run it on your own server, that destination does not change automatically. To point the community features at your own repository, see "コミュニティ機能の投稿先について" in `REBUILD.md`.

Questions, bug reports, and pull requests are welcome **in English or Japanese**.

## Related repositories

- **[RumiCar-group/RumiCar](https://github.com/RumiCar-group/RumiCar)** (public) — the RumiCar platform itself: the real vehicle's hardware (boards, chassis, ESP32 / RasPi / RasPiPico / SPRESENSE), learning materials, and the community-contributed `courses/` `programs/` `cars/`. At runtime the simulator lists the contributed content from there.

## License

MIT License (Copyright (c) 2026 RumiCar Development Group). See [LICENSE](LICENSE) for details — the same license as the upstream [RumiCar-group/RumiCar](https://github.com/RumiCar-group/RumiCar).
