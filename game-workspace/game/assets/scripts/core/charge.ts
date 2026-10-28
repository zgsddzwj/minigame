import type { NumericConfig } from './config';

/**
 * 蓄力时长 → 跳跃距离。game-design §5：d = minD + (maxD − minD) × clamp(t / maxT, 0, 1)。
 * 纯函数；t 非法（NaN/≤0）按未蓄力处理。
 */
export function chargeDistance(pressSeconds: number, config: NumericConfig): number {
  const { maxDurationSec, minDistancePx, maxDistancePx } = config.charge;
  if (!Number.isFinite(pressSeconds) || pressSeconds <= 0) return minDistancePx;
  const t = Math.min(pressSeconds, maxDurationSec);
  const ratio = t / maxDurationSec;
  return minDistancePx + (maxDistancePx - minDistancePx) * ratio;
}

/** 蓄力比例 0..1（表现层用于下蹲压缩与蓄力条）。 */
export function chargeRatio(pressSeconds: number, config: NumericConfig): number {
  if (!Number.isFinite(pressSeconds) || pressSeconds <= 0) return 0;
  return Math.min(pressSeconds / config.charge.maxDurationSec, 1);
}
