// state.js — Stage AP23: モジュール境界を跨ぐ共有可変ワールド状態。ES module の live binding で
// 全モジュールが常に最新値を読む(読みは bare `course` のまま=byte 不変)。import 束縛へは代入
// できないので、再束縛は setter 経由 (setCourse)。第1弾では course のみを外出しする。
import { defaultCourse } from './course.js';
export let course = defaultCourse();
export function setCourse(c) { course = c; }
