import type { NumericConfig } from './config';

export type LandingVerdict = 'perfect' | 'safe' | 'fall';

export interface LandingResult {
  verdict: LandingVerdict;
  /** 有符号落点偏移：落点 X − 台面中心 X。 */
  offset: number;
  /** 仅站稳且接近边缘时为 true（踉跄动画提示，不影响判定与得分）。 */
  stumble: boolean;
}

/**
 * 第 jumpNumber 跳（1 起）生效的 Perfect 阈值：
 * 新手保护期（≤ novice.jumpCount）用放宽阈值，之后回到全局阈值。
 * 表现层画理想落点区与判定共用本函数，保证视觉与规则一致。
 */
export function perfectThresholdForJump(config: NumericConfig, jumpNumber: number): number {
  const novice = config.novice;
  if (novice && jumpNumber >= 1 && jumpNumber <= novice.jumpCount) return novice.perfectThresholdPx;
  return config.landing.perfectThresholdPx;
}

/**
 * 落点判定。规则（game-design §4/§5）：
 * - perfect：|offset| ≤ min(threshold, safeLimit)；threshold 默认取全局阈值，
 *   新手保护跳由调用方传入 perfectThresholdForJump 的结果（24px）
 * - safe：perfect < |offset| ≤ safeLimit = halfWidth − safeInset（超出即坠落）
 * - stumble 提示区间：halfWidth − stumbleBand < |offset| ≤ safeLimit
 */
export function judgeLanding(offset: number, halfWidthPx: number, config: NumericConfig, perfectThresholdPxOverride?: number): LandingResult {
  const abs = Math.abs(offset);
  const safeLimit = Math.max(0, halfWidthPx - config.landing.safeInsetPx);
  const threshold = perfectThresholdPxOverride ?? config.landing.perfectThresholdPx;
  const perfectLimit = Math.min(threshold, safeLimit);
  if (abs <= perfectLimit) return { verdict: 'perfect', offset, stumble: false };
  if (abs <= safeLimit) {
    return { verdict: 'safe', offset, stumble: abs > halfWidthPx - config.landing.stumbleBandPx };
  }
  return { verdict: 'fall', offset, stumble: false };
}
