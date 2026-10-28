/** 可复现随机：mulberry32。core 内禁止 Math.random（verify 纯净性检查）。 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [min, max] 闭区间整数，含端点；确定性依赖注入的 rng。 */
export function randIntInclusive(rng: Rng, min: number, max: number): number {
  if (max < min) {
    const tmp = min;
    min = max;
    max = tmp;
  }
  return min + Math.floor(rng() * (max - min + 1));
}
