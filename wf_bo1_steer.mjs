// wf_bo1_steer.mjs — Stage BO「RC_steer の強さ (第2引数) を既定の車で受け付ける・値の扱いを正本に合わせる・loop() の直下の delay で区切る」常設ゲート
// =============================================================================
// 実装を再実装せず、本番の buildApi / pythonEnv / buildController / Car・DynCar・CarV2 / runRace を呼ぶ。期待値の正は正本:
//   ・RC_steer／RC_drive／RC_state の戻り値とハードウェアへ渡る値 = Raspberry Pi 版 RumiCar.py 0.6.0 (RumiCar リポジトリ
//     RasPi/RumiCar.py・コミット 24168ec51e68d8c32c7f168ea5999cd3d672a5ad) を python3 で実行し、_use_zero2cam() のハードウェア層
//     (_Zero2CamHardware の steer・steer_pwm・drive_dir・drive_pwm) に記録された値を表にしたもの (下の RASPI。生成スクリプトは
//     RumiCar.py の RC_steer／RC_drive／RC_state を値の組み合わせで呼ぶだけ・2026-11-14)。Arduino RumiCar-lib v0.6.0 の RC_steer は
//     段階2で RumiCar.py とピン出力・戻り値が全組み合わせで一致することを確かめてある (正本どうしの照合)。
//   ・Exercise-2.5／3.3 は RumiCar-lib v0.6.0 のスケッチ例 (examples/Exercise-2.5・3.3/*.ino) と RumiCar リポジトリ
//     RasPi/Exercise-2.5・3.3/*.py (コミット 24168ec) の本文をそのまま埋め込む (書き換えずに処理系を通すことを測る)。
//
//  A: 値の扱い — RC_steer 240 通り・RC_drive 90 通り・RC_state 12 通りが正本と同じ戻り値・同じ指令 (sim の強さ: CENTER→0・null→255)。
//     警告は同じ関数・同じ値で 1 回だけ。
//  B: 操舵の法則 (3 エンジン・卓上/フルスケール) — 目標舵角＝全舵×s/255。既定の車 (tri) は外へ切る速さが steerRate×s/255、
//     中央へ戻る向きは steerRate。比例サーボ (prop) は強さに依らず steerRate。1 引数と強さ 255 は軌跡が bit 一致 (runRace traceHash)。
//  C: loop() の直下の delay()／time.sleep() の区切り — 区切る条件・区切らない条件・ローカル変数・millis()・return・while True:。
//  D: Exercise-2.5／3.3 (C・Python) を本番 runRace で走らせる — 2.5 は RIGHT255→LEFT255→RIGHT128→LEFT128 を 0.5 s ごと (周期 2.05 s)、
//     3.3 は実行時エラーなしで強さが 40〜255 の中で変わり Power を出力する (完走数は印字)。
//  E: 読み込み互換 (BA1) — Stage BO で足した名前 (config.js steerAdvance・evaluator.js PENDING_DELAY・fleet.js loopPeriodAfter) を
//     名前付き import しない (古いモジュールがキャッシュに残るブラウザでも起動する)。
//  F: 引数の数 (Stage BP) — py・C の RC_* の呼び出しは正本と同じ数 (RC_setup 0・RC_steer 1〜2・RC_drive 2・RC_read 1・
//     RC_wheel_speed 1・Python の RC_params 0・RC_state 1) でなければ行番号付きの実行時エラー (種類 interp.err.argCount)。正しい数は
//     従来どおり。JS は従来どおり足りない引数を 0 として警告。ARITY を名前付き import しない (BA1)。
// =============================================================================
import { readFileSync } from 'fs';
import { buildApi, pythonEnv } from './public/js/api.js';
import { buildController } from './public/js/runner.js';
import { Car } from './public/js/physics.js';
import { DynCar, applyRegime } from './public/js/physics_dyn.js';
import { CarV2 } from './public/js/physics_v2.js';
import { CAR, CONST, steerTargetOf } from './public/js/config.js';
import * as configNS from './public/js/config.js';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { tickSlot } from './public/js/fleet.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };
const DT = 1 / 60;

// 正本 RasPi RumiCar.py 0.6.0 の表 (生成方法は冒頭)。値の符号化: {none}=None・{nan}=NaN・{inf:±1}=±inf・{bool}=True/False・{list}=list・'__omit__'=省略。
const RASPI = {"version":"0.6.0","steer":[{"d":0,"p":"__omit__","ret":1,"steer":0,"pwm":255},{"d":0,"p":0,"ret":1,"steer":0,"pwm":0},{"d":0,"p":1,"ret":1,"steer":0,"pwm":1},{"d":0,"p":127.9,"ret":1,"steer":0,"pwm":127},{"d":0,"p":128,"ret":1,"steer":0,"pwm":128},{"d":0,"p":254,"ret":1,"steer":0,"pwm":254},{"d":0,"p":255,"ret":1,"steer":0,"pwm":255},{"d":0,"p":256,"ret":1,"steer":0,"pwm":255},{"d":0,"p":-5,"ret":1,"steer":0,"pwm":0},{"d":0,"p":-0.5,"ret":1,"steer":0,"pwm":0},{"d":0,"p":"12","ret":1,"steer":0,"pwm":12},{"d":0,"p":" 7 ","ret":1,"steer":0,"pwm":7},{"d":0,"p":"+9","ret":1,"steer":0,"pwm":9},{"d":0,"p":"1_0","ret":1,"steer":0,"pwm":10},{"d":0,"p":"1.5","ret":1,"steer":0,"pwm":0},{"d":0,"p":"abc","ret":1,"steer":0,"pwm":0},{"d":0,"p":"","ret":1,"steer":0,"pwm":0},{"d":0,"p":{"none":true},"ret":1,"steer":0,"pwm":0},{"d":0,"p":{"bool":true},"ret":1,"steer":0,"pwm":1},{"d":0,"p":{"bool":false},"ret":1,"steer":0,"pwm":0},{"d":0,"p":{"nan":true},"ret":1,"steer":0,"pwm":0},{"d":0,"p":{"inf":1},"ret":1,"steer":0,"pwm":0},{"d":0,"p":{"list":[1]},"ret":1,"steer":0,"pwm":0},{"d":0,"p":1e+30,"ret":1,"steer":0,"pwm":255},{"d":1,"p":"__omit__","ret":1,"steer":1,"pwm":0},{"d":1,"p":0,"ret":1,"steer":1,"pwm":0},{"d":1,"p":1,"ret":1,"steer":1,"pwm":0},{"d":1,"p":127.9,"ret":1,"steer":1,"pwm":0},{"d":1,"p":128,"ret":1,"steer":1,"pwm":0},{"d":1,"p":254,"ret":1,"steer":1,"pwm":0},{"d":1,"p":255,"ret":1,"steer":1,"pwm":0},{"d":1,"p":256,"ret":1,"steer":1,"pwm":0},{"d":1,"p":-5,"ret":1,"steer":1,"pwm":0},{"d":1,"p":-0.5,"ret":1,"steer":1,"pwm":0},{"d":1,"p":"12","ret":1,"steer":1,"pwm":0},{"d":1,"p":" 7 ","ret":1,"steer":1,"pwm":0},{"d":1,"p":"+9","ret":1,"steer":1,"pwm":0},{"d":1,"p":"1_0","ret":1,"steer":1,"pwm":0},{"d":1,"p":"1.5","ret":1,"steer":1,"pwm":0},{"d":1,"p":"abc","ret":1,"steer":1,"pwm":0},{"d":1,"p":"","ret":1,"steer":1,"pwm":0},{"d":1,"p":{"none":true},"ret":1,"steer":1,"pwm":0},{"d":1,"p":{"bool":true},"ret":1,"steer":1,"pwm":0},{"d":1,"p":{"bool":false},"ret":1,"steer":1,"pwm":0},{"d":1,"p":{"nan":true},"ret":1,"steer":1,"pwm":0},{"d":1,"p":{"inf":1},"ret":1,"steer":1,"pwm":0},{"d":1,"p":{"list":[1]},"ret":1,"steer":1,"pwm":0},{"d":1,"p":1e+30,"ret":1,"steer":1,"pwm":0},{"d":2,"p":"__omit__","ret":1,"steer":2,"pwm":255},{"d":2,"p":0,"ret":1,"steer":2,"pwm":0},{"d":2,"p":1,"ret":1,"steer":2,"pwm":1},{"d":2,"p":127.9,"ret":1,"steer":2,"pwm":127},{"d":2,"p":128,"ret":1,"steer":2,"pwm":128},{"d":2,"p":254,"ret":1,"steer":2,"pwm":254},{"d":2,"p":255,"ret":1,"steer":2,"pwm":255},{"d":2,"p":256,"ret":1,"steer":2,"pwm":255},{"d":2,"p":-5,"ret":1,"steer":2,"pwm":0},{"d":2,"p":-0.5,"ret":1,"steer":2,"pwm":0},{"d":2,"p":"12","ret":1,"steer":2,"pwm":12},{"d":2,"p":" 7 ","ret":1,"steer":2,"pwm":7},{"d":2,"p":"+9","ret":1,"steer":2,"pwm":9},{"d":2,"p":"1_0","ret":1,"steer":2,"pwm":10},{"d":2,"p":"1.5","ret":1,"steer":2,"pwm":0},{"d":2,"p":"abc","ret":1,"steer":2,"pwm":0},{"d":2,"p":"","ret":1,"steer":2,"pwm":0},{"d":2,"p":{"none":true},"ret":1,"steer":2,"pwm":0},{"d":2,"p":{"bool":true},"ret":1,"steer":2,"pwm":1},{"d":2,"p":{"bool":false},"ret":1,"steer":2,"pwm":0},{"d":2,"p":{"nan":true},"ret":1,"steer":2,"pwm":0},{"d":2,"p":{"inf":1},"ret":1,"steer":2,"pwm":0},{"d":2,"p":{"list":[1]},"ret":1,"steer":2,"pwm":0},{"d":2,"p":1e+30,"ret":1,"steer":2,"pwm":255},{"d":3,"p":"__omit__","ret":0,"steer":null,"pwm":null},{"d":3,"p":0,"ret":0,"steer":null,"pwm":null},{"d":3,"p":1,"ret":0,"steer":null,"pwm":null},{"d":3,"p":127.9,"ret":0,"steer":null,"pwm":null},{"d":3,"p":128,"ret":0,"steer":null,"pwm":null},{"d":3,"p":254,"ret":0,"steer":null,"pwm":null},{"d":3,"p":255,"ret":0,"steer":null,"pwm":null},{"d":3,"p":256,"ret":0,"steer":null,"pwm":null},{"d":3,"p":-5,"ret":0,"steer":null,"pwm":null},{"d":3,"p":-0.5,"ret":0,"steer":null,"pwm":null},{"d":3,"p":"12","ret":0,"steer":null,"pwm":null},{"d":3,"p":" 7 ","ret":0,"steer":null,"pwm":null},{"d":3,"p":"+9","ret":0,"steer":null,"pwm":null},{"d":3,"p":"1_0","ret":0,"steer":null,"pwm":null},{"d":3,"p":"1.5","ret":0,"steer":null,"pwm":null},{"d":3,"p":"abc","ret":0,"steer":null,"pwm":null},{"d":3,"p":"","ret":0,"steer":null,"pwm":null},{"d":3,"p":{"none":true},"ret":0,"steer":null,"pwm":null},{"d":3,"p":{"bool":true},"ret":0,"steer":null,"pwm":null},{"d":3,"p":{"bool":false},"ret":0,"steer":null,"pwm":null},{"d":3,"p":{"nan":true},"ret":0,"steer":null,"pwm":null},{"d":3,"p":{"inf":1},"ret":0,"steer":null,"pwm":null},{"d":3,"p":{"list":[1]},"ret":0,"steer":null,"pwm":null},{"d":3,"p":1e+30,"ret":0,"steer":null,"pwm":null},{"d":-1,"p":"__omit__","ret":0,"steer":null,"pwm":null},{"d":-1,"p":0,"ret":0,"steer":null,"pwm":null},{"d":-1,"p":1,"ret":0,"steer":null,"pwm":null},{"d":-1,"p":127.9,"ret":0,"steer":null,"pwm":null},{"d":-1,"p":128,"ret":0,"steer":null,"pwm":null},{"d":-1,"p":254,"ret":0,"steer":null,"pwm":null},{"d":-1,"p":255,"ret":0,"steer":null,"pwm":null},{"d":-1,"p":256,"ret":0,"steer":null,"pwm":null},{"d":-1,"p":-5,"ret":0,"steer":null,"pwm":null},{"d":-1,"p":-0.5,"ret":0,"steer":null,"pwm":null},{"d":-1,"p":"12","ret":0,"steer":null,"pwm":null},{"d":-1,"p":" 7 ","ret":0,"steer":null,"pwm":null},{"d":-1,"p":"+9","ret":0,"steer":null,"pwm":null},{"d":-1,"p":"1_0","ret":0,"steer":null,"pwm":null},{"d":-1,"p":"1.5","ret":0,"steer":null,"pwm":null},{"d":-1,"p":"abc","ret":0,"steer":null,"pwm":null},{"d":-1,"p":"","ret":0,"steer":null,"pwm":null},{"d":-1,"p":{"none":true},"ret":0,"steer":null,"pwm":null},{"d":-1,"p":{"bool":true},"ret":0,"steer":null,"pwm":null},{"d":-1,"p":{"bool":false},"ret":0,"steer":null,"pwm":null},{"d":-1,"p":{"nan":true},"ret":0,"steer":null,"pwm":null},{"d":-1,"p":{"inf":1},"ret":0,"steer":null,"pwm":null},{"d":-1,"p":{"list":[1]},"ret":0,"steer":null,"pwm":null},{"d":-1,"p":1e+30,"ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":"__omit__","ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":0,"ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":1,"ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":127.9,"ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":128,"ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":254,"ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":255,"ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":256,"ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":-5,"ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":-0.5,"ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":"12","ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":" 7 ","ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":"+9","ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":"1_0","ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":"1.5","ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":"abc","ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":"","ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":{"none":true},"ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":{"bool":true},"ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":{"bool":false},"ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":{"nan":true},"ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":{"inf":1},"ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":{"list":[1]},"ret":0,"steer":null,"pwm":null},{"d":{"bool":true},"p":1e+30,"ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":"__omit__","ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":0,"ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":1,"ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":127.9,"ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":128,"ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":254,"ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":255,"ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":256,"ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":-5,"ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":-0.5,"ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":"12","ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":" 7 ","ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":"+9","ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":"1_0","ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":"1.5","ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":"abc","ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":"","ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":{"none":true},"ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":{"bool":true},"ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":{"bool":false},"ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":{"nan":true},"ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":{"inf":1},"ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":{"list":[1]},"ret":0,"steer":null,"pwm":null},{"d":{"bool":false},"p":1e+30,"ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":"__omit__","ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":0,"ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":1,"ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":127.9,"ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":128,"ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":254,"ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":255,"ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":256,"ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":-5,"ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":-0.5,"ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":"12","ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":" 7 ","ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":"+9","ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":"1_0","ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":"1.5","ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":"abc","ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":"","ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":{"none":true},"ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":{"bool":true},"ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":{"bool":false},"ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":{"nan":true},"ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":{"inf":1},"ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":{"list":[1]},"ret":0,"steer":null,"pwm":null},{"d":{"none":true},"p":1e+30,"ret":0,"steer":null,"pwm":null},{"d":"0","p":"__omit__","ret":0,"steer":null,"pwm":null},{"d":"0","p":0,"ret":0,"steer":null,"pwm":null},{"d":"0","p":1,"ret":0,"steer":null,"pwm":null},{"d":"0","p":127.9,"ret":0,"steer":null,"pwm":null},{"d":"0","p":128,"ret":0,"steer":null,"pwm":null},{"d":"0","p":254,"ret":0,"steer":null,"pwm":null},{"d":"0","p":255,"ret":0,"steer":null,"pwm":null},{"d":"0","p":256,"ret":0,"steer":null,"pwm":null},{"d":"0","p":-5,"ret":0,"steer":null,"pwm":null},{"d":"0","p":-0.5,"ret":0,"steer":null,"pwm":null},{"d":"0","p":"12","ret":0,"steer":null,"pwm":null},{"d":"0","p":" 7 ","ret":0,"steer":null,"pwm":null},{"d":"0","p":"+9","ret":0,"steer":null,"pwm":null},{"d":"0","p":"1_0","ret":0,"steer":null,"pwm":null},{"d":"0","p":"1.5","ret":0,"steer":null,"pwm":null},{"d":"0","p":"abc","ret":0,"steer":null,"pwm":null},{"d":"0","p":"","ret":0,"steer":null,"pwm":null},{"d":"0","p":{"none":true},"ret":0,"steer":null,"pwm":null},{"d":"0","p":{"bool":true},"ret":0,"steer":null,"pwm":null},{"d":"0","p":{"bool":false},"ret":0,"steer":null,"pwm":null},{"d":"0","p":{"nan":true},"ret":0,"steer":null,"pwm":null},{"d":"0","p":{"inf":1},"ret":0,"steer":null,"pwm":null},{"d":"0","p":{"list":[1]},"ret":0,"steer":null,"pwm":null},{"d":"0","p":1e+30,"ret":0,"steer":null,"pwm":null},{"d":1.0,"p":"__omit__","ret":1,"steer":1,"pwm":0},{"d":1.0,"p":0,"ret":1,"steer":1,"pwm":0},{"d":1.0,"p":1,"ret":1,"steer":1,"pwm":0},{"d":1.0,"p":127.9,"ret":1,"steer":1,"pwm":0},{"d":1.0,"p":128,"ret":1,"steer":1,"pwm":0},{"d":1.0,"p":254,"ret":1,"steer":1,"pwm":0},{"d":1.0,"p":255,"ret":1,"steer":1,"pwm":0},{"d":1.0,"p":256,"ret":1,"steer":1,"pwm":0},{"d":1.0,"p":-5,"ret":1,"steer":1,"pwm":0},{"d":1.0,"p":-0.5,"ret":1,"steer":1,"pwm":0},{"d":1.0,"p":"12","ret":1,"steer":1,"pwm":0},{"d":1.0,"p":" 7 ","ret":1,"steer":1,"pwm":0},{"d":1.0,"p":"+9","ret":1,"steer":1,"pwm":0},{"d":1.0,"p":"1_0","ret":1,"steer":1,"pwm":0},{"d":1.0,"p":"1.5","ret":1,"steer":1,"pwm":0},{"d":1.0,"p":"abc","ret":1,"steer":1,"pwm":0},{"d":1.0,"p":"","ret":1,"steer":1,"pwm":0},{"d":1.0,"p":{"none":true},"ret":1,"steer":1,"pwm":0},{"d":1.0,"p":{"bool":true},"ret":1,"steer":1,"pwm":0},{"d":1.0,"p":{"bool":false},"ret":1,"steer":1,"pwm":0},{"d":1.0,"p":{"nan":true},"ret":1,"steer":1,"pwm":0},{"d":1.0,"p":{"inf":1},"ret":1,"steer":1,"pwm":0},{"d":1.0,"p":{"list":[1]},"ret":1,"steer":1,"pwm":0},{"d":1.0,"p":1e+30,"ret":1,"steer":1,"pwm":0}],"drive":[{"d":0,"p":0,"ret":1,"dir":0,"pwm":0},{"d":0,"p":99.9,"ret":1,"dir":0,"pwm":99},{"d":0,"p":150,"ret":1,"dir":0,"pwm":150},{"d":0,"p":255,"ret":1,"dir":0,"pwm":255},{"d":0,"p":300,"ret":1,"dir":0,"pwm":255},{"d":0,"p":-3,"ret":1,"dir":0,"pwm":0},{"d":0,"p":"200","ret":1,"dir":0,"pwm":200},{"d":0,"p":"x","ret":1,"dir":0,"pwm":0},{"d":0,"p":{"none":true},"ret":1,"dir":0,"pwm":0},{"d":0,"p":{"nan":true},"ret":1,"dir":0,"pwm":0},{"d":1,"p":0,"ret":1,"dir":1,"pwm":0},{"d":1,"p":99.9,"ret":1,"dir":1,"pwm":99},{"d":1,"p":150,"ret":1,"dir":1,"pwm":150},{"d":1,"p":255,"ret":1,"dir":1,"pwm":255},{"d":1,"p":300,"ret":1,"dir":1,"pwm":255},{"d":1,"p":-3,"ret":1,"dir":1,"pwm":0},{"d":1,"p":"200","ret":1,"dir":1,"pwm":200},{"d":1,"p":"x","ret":1,"dir":1,"pwm":0},{"d":1,"p":{"none":true},"ret":1,"dir":1,"pwm":0},{"d":1,"p":{"nan":true},"ret":1,"dir":1,"pwm":0},{"d":2,"p":0,"ret":1,"dir":2,"pwm":0},{"d":2,"p":99.9,"ret":1,"dir":2,"pwm":99},{"d":2,"p":150,"ret":1,"dir":2,"pwm":150},{"d":2,"p":255,"ret":1,"dir":2,"pwm":255},{"d":2,"p":300,"ret":1,"dir":2,"pwm":255},{"d":2,"p":-3,"ret":1,"dir":2,"pwm":0},{"d":2,"p":"200","ret":1,"dir":2,"pwm":200},{"d":2,"p":"x","ret":1,"dir":2,"pwm":0},{"d":2,"p":{"none":true},"ret":1,"dir":2,"pwm":0},{"d":2,"p":{"nan":true},"ret":1,"dir":2,"pwm":0},{"d":3,"p":0,"ret":1,"dir":3,"pwm":0},{"d":3,"p":99.9,"ret":1,"dir":3,"pwm":99},{"d":3,"p":150,"ret":1,"dir":3,"pwm":150},{"d":3,"p":255,"ret":1,"dir":3,"pwm":255},{"d":3,"p":300,"ret":1,"dir":3,"pwm":255},{"d":3,"p":-3,"ret":1,"dir":3,"pwm":0},{"d":3,"p":"200","ret":1,"dir":3,"pwm":200},{"d":3,"p":"x","ret":1,"dir":3,"pwm":0},{"d":3,"p":{"none":true},"ret":1,"dir":3,"pwm":0},{"d":3,"p":{"nan":true},"ret":1,"dir":3,"pwm":0},{"d":4,"p":0,"ret":0,"dir":null,"pwm":null},{"d":4,"p":99.9,"ret":0,"dir":null,"pwm":null},{"d":4,"p":150,"ret":0,"dir":null,"pwm":null},{"d":4,"p":255,"ret":0,"dir":null,"pwm":null},{"d":4,"p":300,"ret":0,"dir":null,"pwm":null},{"d":4,"p":-3,"ret":0,"dir":null,"pwm":null},{"d":4,"p":"200","ret":0,"dir":null,"pwm":null},{"d":4,"p":"x","ret":0,"dir":null,"pwm":null},{"d":4,"p":{"none":true},"ret":0,"dir":null,"pwm":null},{"d":4,"p":{"nan":true},"ret":0,"dir":null,"pwm":null},{"d":-1,"p":0,"ret":0,"dir":null,"pwm":null},{"d":-1,"p":99.9,"ret":0,"dir":null,"pwm":null},{"d":-1,"p":150,"ret":0,"dir":null,"pwm":null},{"d":-1,"p":255,"ret":0,"dir":null,"pwm":null},{"d":-1,"p":300,"ret":0,"dir":null,"pwm":null},{"d":-1,"p":-3,"ret":0,"dir":null,"pwm":null},{"d":-1,"p":"200","ret":0,"dir":null,"pwm":null},{"d":-1,"p":"x","ret":0,"dir":null,"pwm":null},{"d":-1,"p":{"none":true},"ret":0,"dir":null,"pwm":null},{"d":-1,"p":{"nan":true},"ret":0,"dir":null,"pwm":null},{"d":{"bool":true},"p":0,"ret":0,"dir":null,"pwm":null},{"d":{"bool":true},"p":99.9,"ret":0,"dir":null,"pwm":null},{"d":{"bool":true},"p":150,"ret":0,"dir":null,"pwm":null},{"d":{"bool":true},"p":255,"ret":0,"dir":null,"pwm":null},{"d":{"bool":true},"p":300,"ret":0,"dir":null,"pwm":null},{"d":{"bool":true},"p":-3,"ret":0,"dir":null,"pwm":null},{"d":{"bool":true},"p":"200","ret":0,"dir":null,"pwm":null},{"d":{"bool":true},"p":"x","ret":0,"dir":null,"pwm":null},{"d":{"bool":true},"p":{"none":true},"ret":0,"dir":null,"pwm":null},{"d":{"bool":true},"p":{"nan":true},"ret":0,"dir":null,"pwm":null},{"d":{"none":true},"p":0,"ret":0,"dir":null,"pwm":null},{"d":{"none":true},"p":99.9,"ret":0,"dir":null,"pwm":null},{"d":{"none":true},"p":150,"ret":0,"dir":null,"pwm":null},{"d":{"none":true},"p":255,"ret":0,"dir":null,"pwm":null},{"d":{"none":true},"p":300,"ret":0,"dir":null,"pwm":null},{"d":{"none":true},"p":-3,"ret":0,"dir":null,"pwm":null},{"d":{"none":true},"p":"200","ret":0,"dir":null,"pwm":null},{"d":{"none":true},"p":"x","ret":0,"dir":null,"pwm":null},{"d":{"none":true},"p":{"none":true},"ret":0,"dir":null,"pwm":null},{"d":{"none":true},"p":{"nan":true},"ret":0,"dir":null,"pwm":null},{"d":2.0,"p":0,"ret":1,"dir":2,"pwm":0},{"d":2.0,"p":99.9,"ret":1,"dir":2,"pwm":99},{"d":2.0,"p":150,"ret":1,"dir":2,"pwm":150},{"d":2.0,"p":255,"ret":1,"dir":2,"pwm":255},{"d":2.0,"p":300,"ret":1,"dir":2,"pwm":255},{"d":2.0,"p":-3,"ret":1,"dir":2,"pwm":0},{"d":2.0,"p":"200","ret":1,"dir":2,"pwm":200},{"d":2.0,"p":"x","ret":1,"dir":2,"pwm":0},{"d":2.0,"p":{"none":true},"ret":1,"dir":2,"pwm":0},{"d":2.0,"p":{"nan":true},"ret":1,"dir":2,"pwm":0}],"state":[{"n":"start","ret":1},{"n":"Turn Left","ret":1},{"n":"AAAAAAAAAAAAAAAAAAAAAAAA","ret":1},{"n":"AAAAAAAAAAAAAAAAAAAAAAAAA","ret":0},{"n":"","ret":0},{"n":"  ","ret":0},{"n":"a-b","ret":0},{"n":"é","ret":0},{"n":{"none":true},"ret":1},{"n":{"bool":true},"ret":1},{"n":12,"ret":1},{"n":"x_1","ret":1}]};
const dec = (v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? (v.none ? null : v.nan ? NaN : v.inf ? v.inf * Infinity : 'bool' in v ? v.bool : 'list' in v ? v.list : v) : v);
const show = (v) => (v === '__omit__' ? '(省略)' : JSON.stringify(v));

const mk = (steerSet = 'tri') => {
  const car = new Car({ x: 0, y: 0, theta: 0 }); car.steerSet = steerSet;
  const logs = [];
  const world = { car, walls: [], log: (m) => logs.push(String(m)), _sensors: [], _others: [], _sensGen: 0, _simMs: 0, _pendingDelay: 0,
    start: { x: 0, y: 0, theta: 0 }, steerSet };
  return { car, world, env: buildApi(world), logs };
};

// ============================================================================
console.log('\n=== A: 値の扱い (正本 RasPi RumiCar.py ' + RASPI.version + ' の表と照合) ===');
{
  let bad = 0;
  for (const e of RASPI.steer) {
    const { car, env } = mk();
    car.steer = 'X'; car.steerAmt = 'X';
    const d = dec(e.d), p = dec(e.p);
    const r = e.p === '__omit__' ? env.RC_steer(d) : env.RC_steer(d, p);
    let good = r === e.ret;
    if (e.ret === 1) {
      const pwm = car.steer === CONST.CENTER ? 0 : (car.steerAmt == null ? 255 : car.steerAmt);
      good = good && car.steer === e.steer && pwm === e.pwm;
    } else good = good && car.steer === 'X' && car.steerAmt === 'X';
    if (!good) { bad++; if (bad <= 5) console.log(`    RC_steer(${show(e.d)}, ${show(e.p)}): sim ret=${r} steer=${car.steer} amt=${car.steerAmt} / 正本 ret=${e.ret} steer=${e.steer} pwm=${e.pwm}`); }
  }
  ok(bad === 0, `A1 RC_steer: ${RASPI.steer.length - bad}/${RASPI.steer.length} が正本と同じ戻り値・同じ方向と強さ`);
  bad = 0;
  for (const e of RASPI.drive) {
    const { car, env } = mk();
    car.driveDir = 'X'; car.pwm = 'X';
    const r = env.RC_drive(dec(e.d), dec(e.p));
    const good = r === e.ret && (e.ret === 1 ? (car.driveDir === e.dir && car.pwm === e.pwm) : (car.driveDir === 'X' && car.pwm === 'X'));
    if (!good) { bad++; if (bad <= 5) console.log(`    RC_drive(${show(e.d)}, ${show(e.p)}): sim ret=${r} dir=${car.driveDir} pwm=${car.pwm} / 正本 ret=${e.ret} dir=${e.dir} pwm=${e.pwm}`); }
  }
  ok(bad === 0, `A2 RC_drive: ${RASPI.drive.length - bad}/${RASPI.drive.length} が正本と同じ戻り値・同じ方向と速さ`);
  bad = 0;
  for (const e of RASPI.state) {
    const { env } = mk();
    const r = pythonEnv(env).RC_state(dec(e.n));
    if (r !== e.ret) { bad++; console.log(`    RC_state(${show(e.n)}): sim ${r} / 正本 ${e.ret}`); }
  }
  ok(bad === 0, `A3 RC_state: ${RASPI.state.length - bad}/${RASPI.state.length} が正本と同じ戻り値`);
  // A4: 警告は同じ関数・同じ値で 1 回だけ (正本の _warn と同じ)。正しい値では出さない。
  {
    const { env, logs } = mk();
    env.RC_steer(CONST.LEFT, 128); env.RC_steer(CONST.LEFT); env.RC_drive(CONST.FORWARD, 200);
    ok(logs.length === 0, 'A4 正しい引数では警告を出さない');
    for (let i = 0; i < 3; i++) env.RC_steer(CONST.LEFT, 'abc');
    ok(logs.length === 1 && /RC_steer/.test(logs[0]) && /abc/.test(logs[0]), `A4 数でない強さの警告は 1 回 (${logs.length} 件)`);
    env.RC_steer(CONST.LEFT, 'xyz'); env.RC_drive(CONST.FORWARD, 'abc');
    ok(logs.length === 3, `A4 値・関数が違えば別の警告 (${logs.length} 件)`);
    for (let i = 0; i < 3; i++) env.RC_steer(9);
    env.RC_drive(true, 100);
    ok(logs.length === 5, `A4 方向の誤りも値ごとに 1 回 (${logs.length} 件)`);
    const py = pythonEnv(env); py.RC_state('a-b'); py.RC_state('a-b');
    ok(logs.length === 6, `A4 RC_state の不正な名前も 1 回 (${logs.length} 件)`);
  }
}

// ============================================================================
console.log('\n=== B: 操舵の法則 (目標舵角＝全舵×s/255・既定の車は外へ切る速さも ×s/255) ===');
{
  const mkCar = (eng, set) => {
    const st = { x: 0, y: 0, theta: 0, grip: 1 };
    const c = eng === 'v2' ? new CarV2(st) : eng === 'dynamic' ? new DynCar(st) : new Car(st);
    c.type = 'normal_fr'; c.steerSet = set; return c;
  };
  for (const regime of ['tabletop', 'fullscale']) {
    applyRegime(regime);
    const md = CAR.steerRate * DT;
    for (const eng of ['standard', 'dynamic', 'v2']) {
      const mx = mkCar(eng, 'tri'); mx.steer = CONST.LEFT; mx.steerAmt = null;
      const full = mx.steerTarget;
      // v2 は 1 物理ステップを複数の substep で進めるので、ここでは 1 ステップ後の角度＝steerRate×dt×比 を比べる (substep の合計は dt)。
      for (const s of [1, 64, 128, 200, 254]) {
        const t = mkCar(eng, 'tri'); t.steer = CONST.LEFT; t.steerAmt = s;
        const p = mkCar(eng, 'prop'); p.steer = CONST.LEFT; p.steerAmt = s;
        ok(Object.is(t.steerTarget, p.steerTarget) && Math.abs(t.steerTarget - full * s / 255) < 1e-15, `B1 ${regime} ${eng} s=${s}: 目標舵角＝全舵×s/255 (装備に依らない)`);
        t.step(DT); p.step(DT);
        const wantT = Math.min(md * s / 255, full * s / 255), wantP = Math.min(md, full * s / 255);
        ok(Math.abs(t.steerAngle - wantT) < 1e-12, `B2 ${regime} ${eng} s=${s}: 既定の車の 1 ステップ ${t.steerAngle.toExponential(4)} ＝ steerRate×dt×s/255 (${wantT.toExponential(4)})`);
        ok(Math.abs(p.steerAngle - wantP) < 1e-12, `B2 ${regime} ${eng} s=${s}: 比例サーボの 1 ステップ ${p.steerAngle.toExponential(4)} ＝ steerRate×dt (${wantP.toExponential(4)})`);
      }
      // B3: 中央へ戻る向き (強さを下げた・CENTER) は従来の速さ。全舵から LEFT 64 へ。
      const r = mkCar(eng, 'tri'); r.steer = CONST.LEFT; r.steerAmt = null;
      for (let i = 0; i < 400; i++) r.step(DT);
      const a0 = r.steerAngle; r.steerAmt = 64; r.step(DT);
      ok(Math.abs((a0 - r.steerAngle) - Math.min(md, a0 - full * 64 / 255)) < 1e-12, `B3 ${regime} ${eng}: 強さを下げたときは従来の速さで戻る`);
      // B4: 中央をまたぐ 1 ステップ: 右へ少し切った状態から LEFT 128 → 中央までは従来の速さ・残りは ×128/255。
      const x = mkCar(eng, 'tri'); x.steer = CONST.RIGHT; x.steerAmt = 100; x.step(DT);
      const b0 = x.steerAngle;   // < 0 (右・1 ステップで steerRate×dt×100/255＝|b0| < steerRate×dt)
      x.steer = CONST.LEFT; x.steerAmt = 128; x.step(DT);
      const want = (md - Math.abs(b0)) * 128 / 255;
      ok(b0 < 0 && Math.abs(b0) < md && Math.abs(x.steerAngle - want) < 1e-12, `B4 ${regime} ${eng}: 中央をまたぐステップ ${x.steerAngle.toExponential(4)} ＝ (steerRate×dt−|右|)×128/255 (${want.toExponential(4)})`);
    }
  }
  applyRegime('tabletop');
  // B5: 1 引数と強さ 255 は軌跡が bit 一致 (本番 runRace・3 エンジン・既定の車と比例サーボ)。強さ 254 とは一致しない (検出力)。
  const oval = buildFromSpec({ name: 'オーバル', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
  const SRC = (arg) => `void setup(){ RC_setup(); }
void loop(){
  int L=RC_read(LEFT), R=RC_read(RIGHT);
  if (L==-3) L=300; if (R==-3) R=300;
  if (L>R+30) RC_steer(LEFT${arg}); else if (R>L+30) RC_steer(RIGHT${arg}); else RC_steer(CENTER);
  RC_drive(FORWARD, 160);
}`;
  for (const physics of ['standard', 'dynamic', 'v2']) for (const ss of ['tri', 'prop']) {
    const race = (arg) => runRace({ course: oval, regime: 'tabletop', physics, laps: 1, trace: true, maxSec: 25,
      field: [{ name: 'A', lang: 'c', src: SRC(arg), carType: 'normal_fr', steerSet: ss }], crashRule: { rejoin: true, penaltySec: 3 }, interact: false });
    const a = race(''), b = race(', 255'), c = race(', 254');
    ok(a.traceHash === b.traceHash && a.verifyHash === b.verifyHash, `B5 ${physics} ${ss}: RC_steer(方向) と RC_steer(方向, 255) は軌跡が bit 一致 (${a.traceHash})`);
    ok(a.traceHash !== c.traceHash, `B5 ${physics} ${ss}: 強さ 254 とは軌跡が違う (検出力)`);
  }
  // B6: steerAdvance の早期 return は旧式と同一式 (比例サーボ・1 引数・255)。
  const adv = configNS.steerAdvance;
  let bad = 0, n = 0;
  for (const cur of [-0.4, -0.05, 0, 0.03, 0.4]) for (const tgt of [-0.4, -0.1, 0, 0.2, 0.4]) for (const [set, amt] of [['prop', 100], ['prop', null], ['tri', null], ['tri', 255], ['tri', 300]]) {
    n++; if (!Object.is(adv(cur, tgt, 0.1, set, amt), cur + Math.max(-0.1, Math.min(0.1, tgt - cur)))) bad++;
  }
  ok(bad === 0, `B6 steerAdvance は比例サーボ・1 引数・255 以上で旧式と同一 double (${n - bad}/${n})`);
  ok(steerTargetOf(CONST.LEFT, 0.4, 'tri', 0) === 0 && steerTargetOf(CONST.RIGHT, 0.4, 'tri', 0) === 0, 'B6 強さ 0 は中立 (目標舵角 0)');
}

// ============================================================================
console.log('\n=== C: loop() の直下の delay()／time.sleep() の区切り ===');
{
  // tick ごとに (方向, 強さ, その回の delay, 区切ったか) を記録する。
  const run = (src, lang, n = 6, steerSet = 'tri') => {
    const { car, world, env, logs } = mk(steerSet);
    const ctl = buildController(src, lang, env); ctl.setup();
    const seq = [];
    for (let k = 0; k < n; k++) { world._pendingDelay = 0; const p = ctl.tick(); seq.push([car.steer, car.steerAmt, world._pendingDelay, p === true]); }
    return { seq, logs, world, car };
  };
  const S = (seq) => seq.map(([d, a, w, p]) => `${d}/${a}/${w}/${p ? 'P' : '-'}`).join(' ');
  // C1: 直下の delay で区切る。最後の delay は区切らない (従来どおり周期＋待ち)。
  {
    const c = run('void setup(){} void loop(){ RC_steer(RIGHT); delay(500); RC_steer(LEFT); delay(300); }', 'c', 4);
    ok(S(c.seq) === '2/null/500/P 0/null/300/- 2/null/500/P 0/null/300/-', `C1 C: 直下の delay で区切り、最後の delay は区切らない (${S(c.seq)})`);
    const p = run('import time\ndef loop():\n    RC_steer(RIGHT)\n    time.sleep(0.5)\n    RC_steer(LEFT)\n    time.sleep(0.3)\n', 'py', 4);
    ok(S(p.seq) === '2/null/500/P 0/null/300/- 2/null/500/P 0/null/300/-', `C1 Python: 直下の time.sleep で区切る (${S(p.seq)})`);
    const b = run('import time\nwhile True:\n    RC_steer(RIGHT)\n    time.sleep(0.5)\n    RC_steer(LEFT)\n    time.sleep(0.3)\n', 'py', 4);
    ok(S(b.seq) === '2/null/500/P 0/null/300/- 2/null/500/P 0/null/300/-', `C1 Python while True: も同じ (${S(b.seq)})`);
  }
  // C2: 区切らない書き方 — if の中・自作の関数の中・delay(0)・同名のユーザー関数・JavaScript・式の一部。
  {
    const a = run('void setup(){} void loop(){ if (1) { RC_steer(RIGHT); delay(500); } RC_steer(LEFT); }', 'c', 2);
    ok(S(a.seq) === '0/null/500/- 0/null/500/-', `C2 if の中の delay は区切らない (${S(a.seq)})`);
    const f = run('void w(){ delay(500); } void setup(){} void loop(){ RC_steer(RIGHT); w(); RC_steer(LEFT); }', 'c', 2);
    ok(S(f.seq) === '0/null/500/- 0/null/500/-', `C2 関数の中の delay は区切らない (${S(f.seq)})`);
    const z = run('void setup(){} void loop(){ RC_steer(RIGHT); delay(0); RC_steer(LEFT); }', 'c', 2);
    ok(S(z.seq) === '0/null/0/- 0/null/0/-', `C2 待ちを増やさない delay(0) は区切らない (${S(z.seq)})`);
    const u = run('void delay(int ms){ } void setup(){} void loop(){ RC_steer(RIGHT); delay(500); RC_steer(LEFT); }', 'c', 2);
    ok(S(u.seq) === '0/null/0/- 0/null/0/-', `C2 同名のユーザー関数 delay は区切らない (${S(u.seq)})`);
    const j = run('function setup(){} function loop(){ RC_steer(RIGHT); delay(500); RC_steer(LEFT); }', 'js', 2);
    ok(S(j.seq) === '0/null/500/- 0/null/500/-', `C2 JavaScript は区切らない (${S(j.seq)})`);
    const e = run('void setup(){} void loop(){ RC_steer(RIGHT); int x = delay(500); RC_steer(LEFT); }', 'c', 2);
    ok(S(e.seq) === '0/null/500/- 0/null/500/-', `C2 式の一部の delay は区切らない (${S(e.seq)})`);
  }
  // C3: 区切っても同じ回のローカル変数で続ける・次の回は新しいローカル・return でその回を終える・millis は待ちの分だけ進む。
  {
    const src = 'int g = 0; void setup(){} void loop(){ int a = g * 10; g++; delay(100); Serial.println(a); if (g >= 2) return; delay(100); Serial.println(99); }';
    const r = run(src, 'c', 7);
    ok(r.logs.join(',') === '0,99,10,20', `C3 区切りの前後で同じ回のローカル変数・return でその回を終える (出力 ${r.logs.join(',')})`);
  }
  // C4: millis() — 本番の tickSlot で回す。区切った回の続きは周期を足さず待ちの分だけ後 (50 → 150)、最後の delay の後は周期＋待ち (150 → 300)。
  {
    const { world, env, logs } = mk();
    const slot = { controller: buildController('void setup(){} void loop(){ Serial.println(millis()); delay(100); Serial.println(millis()); delay(100); }', 'c', env), running: true, world };
    slot.controller.setup();
    for (let k = 0; k < 4; k++) tickSlot(slot, []);
    ok(logs.join(',') === '50,150,300,400', `C4 millis(): 区切りの後は待ちの分だけ・回の終わりは周期＋待ち (${logs.join(',')})`);
  }
}

// ============================================================================
console.log('\n=== D: Exercise-2.5／3.3 (RumiCar-lib v0.6.0 と RasPi の本文そのまま) を本番 runRace で ===');
{
  const EX = {
    ino25: "#include <RumiCar.h>\n\nvoid setup()\n{\n  RC_setup();\n}\n\nvoid loop()\n{\n  RC_steer(RIGHT,255);\n  delay(500);\n  RC_steer(LEFT,255);\n  delay(500);\n  RC_steer(RIGHT,128);\n  delay(500);\n  RC_steer(LEFT,128);\n  delay(500);\n}\n",
    ino33: "#include <RumiCar.h>\n\nint ipower = 128;       // steering strength 0-255 (start at half)\nint lastTurn = CENTER;  // the side we steered to last time\nint lastGap = 0;        // left/right difference last time [mm]\n\nvoid setup()\n{\n  RC_setup();\n}\n\nvoid loop()\n{\n\n  int iband = 30;       // if left and right differ by this much or less, go straight [mm]\n  int s0, s1, s2;\n  s0=RC_read(LEFT);\n  s1=RC_read(CENTER);\n  s2=RC_read(RIGHT);\n  if(s0==-3) s0=250;    // -3: nothing within 20 cm = open road\n  if(s1==-3) s1=250;\n  if(s2==-3) s2=250;\n\n\n  Serial.print(\"Sensor0:\");\n  Serial.print(s0);\n  Serial.print(\"  Sensor1:\");\n  Serial.print(s1);\n  Serial.print(\"  Sensor2:\");\n  Serial.print(s2);\n  Serial.print(\"  Power:\");\n  Serial.println(ipower);\n\n  if(s0==-1 || s1==-1 || s2==-1){\n    return;             // -1: a sensor did not answer, keep driving as before\n  }\n\n  if(s1<100){\n    RC_drive(REVERSE,150);\n  }else if (s1<150){\n    RC_drive(FORWARD,150);\n  }else if (s1<200){\n    RC_drive(FORWARD,200);\n  }else{\n    RC_drive(FORWARD,255);\n  }\n\n  int gap = abs(s0-s2);\n  if(gap<=iband){\n    RC_steer(CENTER);\n  }else{\n    int side;\n    if(s0>s2){\n      side=LEFT;\n    }else{\n      side=RIGHT;\n    }\n    if(lastTurn!=CENTER && side!=lastTurn){\n      ipower=ipower/2;        // went past the middle: too strong, use half\n    }else if(side==lastTurn && gap>=lastGap){\n      ipower=ipower*13/10;    // not getting closer to the middle: too weak, use 1.3 times\n    }\n    ipower=constrain(ipower,40,255);  // keep at least 40 so that 1.3 times can grow again\n    RC_steer(side,ipower);\n    lastTurn=side;\n  }\n  lastGap=gap;\n}\n",
    py25: "from RumiCar import *\nimport time\n\n# ハンドルの強さを変えてみよう: 強さ 255 (いちばん強い) と 128 (半分) で右・左に切る\n# 実行: python3 ../RumiCar.py Exercise-2.5.py\n\n\ndef setup():\n    RC_setup()\n\n\ndef loop():\n    RC_steer(RIGHT, 255)\n    time.sleep(0.5)\n    RC_steer(LEFT, 255)\n    time.sleep(0.5)\n    RC_steer(RIGHT, 128)\n    time.sleep(0.5)\n    RC_steer(LEFT, 128)\n    time.sleep(0.5)\n",
    py33: "from RumiCar import *\n\n# なめらかに走る車: Exercise-3.2 の「左右どちらかに必ず切る」の代わりに、\n# 左右の差が小さければまっすぐ (CENTER)、大きければ広い側へ切り、\n# ハンドルの強さを走りながら調整する (効かなければ 1.3 倍、行き過ぎたら半分)\n# 実行: python3 ../RumiCar.py Exercise-3.3.py\n\nipower = 128            # ハンドルの強さ 0〜255 (半分から始める)\nlast_turn = CENTER      # 前回切った側\nlast_gap = 0            # 前回の左右の差 [mm]\n\n\ndef setup():\n    RC_setup()\n\n\ndef loop():\n    global ipower, last_turn, last_gap\n\n    iband = 30          # 左右の差がこれ以下ならまっすぐ [mm]\n    s0 = RC_read(LEFT)\n    s1 = RC_read(CENTER)\n    s2 = RC_read(RIGHT)\n    if s0 == -3:        # -3: 20 cm 以内に何もない = 開けている\n        s0 = 250\n    if s1 == -3:\n        s1 = 250\n    if s2 == -3:\n        s2 = 250\n\n    print(\"Sensor0:\", s0, \" Sensor1:\", s1, \" Sensor2:\", s2, \" Power:\", ipower)\n\n    if s0 == -1 or s1 == -1 or s2 == -1:\n        return          # -1: センサーが応答しない。この回は何もせず、前の動きを続ける\n\n    if s1 < 100:\n        RC_drive(REVERSE, 150)\n    elif s1 < 150:\n        RC_drive(FORWARD, 150)\n    elif s1 < 200:\n        RC_drive(FORWARD, 200)\n    else:\n        RC_drive(FORWARD, 255)\n\n    gap = abs(s0 - s2)\n    if gap <= iband:\n        RC_steer(CENTER)\n    else:\n        if s0 > s2:\n            side = LEFT\n        else:\n            side = RIGHT\n        if last_turn != CENTER and side != last_turn:\n            ipower = ipower // 2            # 真ん中を越えた: 強すぎるので半分にする\n        elif side == last_turn and gap >= last_gap:\n            ipower = ipower * 13 // 10      # 真ん中に近づいていない: 弱いので 1.3 倍にする\n        ipower = max(40, min(ipower, 255))  # 1.3 倍でまた増やせるよう 40 以上に保つ\n        RC_steer(side, ipower)\n        last_turn = side\n    last_gap = gap\n",
  };
  const oval = buildFromSpec({ name: 'オーバル', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
  const race = (src, lang, maxSec, carType = 'normal_fr') => {
    const seq = [];
    const r = runRace({ course: oval, regime: 'tabletop', physics: 'dynamic', laps: 3, maxSec, report: true,
      field: [{ name: 'A', lang, src, carType }], crashRule: { rejoin: true, penaltySec: 3 }, interact: false,
      probe: (tick, slots) => { const c = slots[0].car; seq.push([tick, c.steer, c.steerAmt]); } });
    return { r, seq };
  };
  // D1: 2.5 — 指令が変わった tick を拾う。0.5 s ごとに RIGHT255 → LEFT255 → RIGHT128 → LEFT128、1 周 2.05 s (最後の delay は周期＋待ち)。
  for (const [label, src, lang] of [['C (.ino)', EX.ino25, 'c'], ['Python (.py)', EX.py25, 'py']]) {
    const { seq } = race(src, lang, 6);
    const ch = []; let prev = null;
    for (const [tick, d, a] of seq) { const k = `${d}/${a}`; if (k !== prev) { ch.push([tick, k]); prev = k; } }
    const got = ch.slice(0, 8).map(([t, k]) => `${(t / 60).toFixed(2)}s:${k}`).join(' ');
    const want = ['0.00s:2/null', '0.50s:0/null', '1.00s:2/128', '1.50s:0/128', '2.05s:2/null', '2.55s:0/null', '3.05s:2/128', '3.55s:0/128'].join(' ');
    ok(got === want, `D1 Exercise-2.5 ${label}: ${got}`);
  }
  // D2: 3.3 — 実行時エラーなしで走り、強さが 40〜255 の中で変わり、Power を出力する。
  for (const [label, src, lang] of [['C (.ino)', EX.ino33, 'c'], ['Python (.py)', EX.py33, 'py']]) {
    const { r, seq } = race(src, lang, 60);
    const amts = new Set(seq.map(([, , a]) => a).filter((a) => a != null));
    const inRange = [...amts].every((a) => a >= 40 && a <= 255 && Number.isInteger(a));
    const errs = (r.dnf || []).filter((d) => /error|エラー/i.test(String(d.reason)));
    ok(errs.length === 0, `D2 Exercise-3.3 ${label}: 実行時エラーなし`);
    ok(amts.size >= 3 && inRange, `D2 Exercise-3.3 ${label}: 強さが変わる (${amts.size} 通り・すべて 40〜255 の整数)`);
    ok(r.logsCount > 100, `D2 Exercise-3.3 ${label}: シリアル出力あり (${r.logsCount} 行)`);
    console.log(`    Exercise-3.3 ${label}: 卓上オーバル 3 周・60 s → 完走 ${r.finishers.length}/1${r.finishers[0] ? ' (' + (r.finishers[0].totalTimeMs / 1000).toFixed(1) + ' s)' : ''}・強さ ${[...amts].sort((a, b) => a - b).slice(0, 12).join(',')}${amts.size > 12 ? '…' : ''}`);
  }
}

// ============================================================================
console.log('\n=== E: 読み込み互換 (Stage BO で足した名前を名前付き import しない・BA1) ===');
{
  const src = (f) => readFileSync('./public/js/' + f, 'utf8');
  const named = (s, mod) => [...s.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)].filter((m) => m[2].endsWith(mod)).map((m) => m[1]).join(',');
  const files = ['physics.js', 'physics_dyn.js', 'physics_v2.js', 'api.js', 'race_engine.js', 'runner.js', 'main.js', 'fleet.js', 'loopsched.js', 'interp/evaluator.js'];
  let v = [];
  for (const f of files) {
    const s = src(f);
    if (/\bsteerAdvance\b/.test(named(s, 'config.js'))) v.push(`${f}: steerAdvance`);
    if (/\bPENDING_DELAY\b/.test(named(s, 'evaluator.js'))) v.push(`${f}: PENDING_DELAY`);
    if (/\bloopPeriodAfter\b/.test(named(s, 'fleet.js'))) v.push(`${f}: loopPeriodAfter`);
  }
  ok(v.length === 0, `E1 足した名前を名前付き import していない ${v.length ? '(' + v.join(' / ') + ')' : ''}`);
  // 変異: 名前付き import に足すと検出する (検査の空振りの排除)
  const mut = src('physics.js').replace("steerTargetOf } from './config.js';", "steerTargetOf, steerAdvance } from './config.js';");
  ok(/\bsteerAdvance\b/.test(named(mut, 'config.js')), 'E1 変異 (physics.js が steerAdvance を名前付き import) を検出する');
  ok(/typeof configNS\.steerAdvance === 'function'/.test(src('physics.js')) && /typeof interp\.runLoopFrame !== 'function'/.test(src('runner.js'))
     && /typeof fleetNS\.loopPeriodAfter === 'function'/.test(src('race_engine.js')), 'E2 古いモジュールのときの代わりの経路がある (physics.js・runner.js・race_engine.js)');
}

// ============================================================================
console.log('\n=== F: 引数の数 (Stage BP・正本の def／宣言と同じ数でなければ実行時エラー) ===');
{
  // 1 回 setup()＋tick() して、エラー (文言・種類・行) とログを返す。
  const run = (src, lang) => {
    const { world, env, logs } = mk('tri');
    try { const ctl = buildController(src, lang, env); ctl.setup(); ctl.tick(); return { err: null, logs }; }
    catch (e) { return { err: e, logs }; }
  };
  const PY = (body) => `from RumiCar import *\ndef setup():\n    pass\ndef loop():\n    ${body}\n`;
  const C = (body) => `void setup(){}\nvoid loop(){\n  ${body};\n}\n`;
  // [呼び出し, 渡した数, 受け付ける数の文言]。Python だけの関数は C では試さない。
  const BAD = [['RC_setup(1)', 1, '0', 'both'], ['RC_steer()', 0, '1〜2', 'both'], ['RC_steer(LEFT, 9, 9)', 3, '1〜2', 'both'],
    ['RC_drive(FORWARD)', 1, '2', 'both'], ['RC_drive(FORWARD, 9, 9)', 3, '2', 'both'], ['RC_read()', 0, '1', 'both'],
    ['RC_read(LEFT, 1)', 2, '1', 'both'], ['RC_wheel_speed()', 0, '1', 'both'], ['RC_params(1)', 1, '0', 'py'], ['RC_state()', 0, '1', 'py']];
  for (const [call, n, want, langs] of BAD) {
    for (const lang of langs === 'py' ? ['py'] : ['py', 'c']) {
      const r = run(lang === 'py' ? PY(call) : C(call), lang);
      const fn = call.slice(0, call.indexOf('('));
      const [lo, hi] = want.includes('〜') ? want.split('〜').map(Number) : [Number(want), Number(want)];
      const pr = r.err ? r.err.i18nParams || {} : {};
      ok(r.err && r.err.i18nKey === 'interp.err.argCount' && r.err.i18nMsgKey === (lo === hi ? 'interp.err.argCount' : 'interp.err.argRange')
        && r.err.line === (lang === 'py' ? 5 : 3) && pr.fn === fn && pr.n === n && pr.min === lo && pr.max === hi && r.err.message.includes(`${fn}()`),
        `F1 ${lang} ${call} → argCount・呼び出しの行 (${r.err ? r.err.message : 'エラーなし'})`);
    }
  }
  // `import RumiCar` の形 (モジュールオブジェクト経由) も同じ
  {
    const r = run('import RumiCar\ndef setup():\n    pass\ndef loop():\n    RumiCar.RC_drive(RumiCar.FORWARD)\n', 'py');
    ok(r.err && r.err.i18nKey === 'interp.err.argCount' && r.err.line === 5, `F2 py RumiCar.RC_drive(FORWARD) → argCount (${r.err ? r.err.message : 'エラーなし'})`);
  }
  // 正しい数はエラーにならない (1 引数・2 引数の RC_steer を含む)
  {
    const p = run('from RumiCar import *\ndef setup():\n    RC_setup()\ndef loop():\n    RC_steer(LEFT)\n    RC_steer(RIGHT, 100)\n    RC_drive(FORWARD, 100)\n    x = RC_read(CENTER)\n    w = RC_wheel_speed(FRONT)\n    RC_state("RUN")\n    q = RC_params()\n', 'py');
    ok(!p.err, `F3 py 正しい数の呼び出しはエラーにならない (${p.err ? p.err.message : ''})`);
    const c = run('void setup(){ RC_setup(); }\nvoid loop(){ RC_steer(LEFT); RC_steer(RIGHT, 100); RC_drive(FORWARD, 100); int x = RC_read(CENTER); float w = RC_wheel_speed(FRONT); }\n', 'c');
    ok(!c.err, `F3 c 正しい数の呼び出しはエラーにならない (${c.err ? c.err.message : ''})`);
  }
  // JS は従来どおり (足りない引数は 0 として警告して続ける)
  {
    const j = run('function setup(){}\nfunction loop(){ RC_drive(FORWARD); }\n', 'js');
    ok(!j.err && j.logs.some((l) => /RC_drive/.test(l)), `F4 js RC_drive(FORWARD) は従来どおり警告して続ける (${j.err ? j.err.message : JSON.stringify(j.logs)})`);
  }
  // BA1: ARITY を名前付き import しない (古い evaluator.js がキャッシュに残るブラウザでも api.js が読める)
  {
    const a = readFileSync('./public/js/api.js', 'utf8');
    const named = [...a.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)].filter((m) => m[2].endsWith('evaluator.js')).map((m) => m[1]).join(',');
    ok(!/\bARITY\b/.test(named) && /interpNS\.ARITY/.test(a), 'F5 api.js は ARITY を名前空間から読む (名前付き import しない)');
  }
}

console.log(`\n[結果] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
