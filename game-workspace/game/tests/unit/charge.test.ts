import { describe, expect, it } from 'vitest';
import { chargeDistance, chargeRatio } from '../../assets/scripts/core/charge';
import { DEFAULT_CONFIG } from '../../assets/scripts/core/config';

const cfg = DEFAULT_CONFIG;
// 蓄力速率（px/s）：H2 返工后 520px / 2.0s = 260，为旧版 577.8 的一半
const RATE = (cfg.charge.maxDistancePx - cfg.charge.minDistancePx) / cfg.charge.maxDurationSec;

describe('ChargeSim 蓄力映射（game-design §5，H2 返工 v2）', () => {
  it('t=0 未蓄力返回最小距离', () => {
    expect(chargeDistance(0, cfg)).toBeCloseTo(cfg.charge.minDistancePx, 6);
  });

  it('线性映射保持：t=1.0s（半程）→ 380px，t=0.9s → 354px', () => {
    expect(chargeDistance(1.0, cfg)).toBeCloseTo(120 + 520 * 0.5, 6);
    expect(chargeDistance(0.9, cfg)).toBeCloseTo(120 + 520 * 0.45, 6);
  });

  it('蓄满封顶：t 超过 2.0s 仍为 640px', () => {
    expect(chargeDistance(2.0, cfg)).toBeCloseTo(640, 6);
    expect(chargeDistance(3, cfg)).toBeCloseTo(640, 6);
    expect(chargeDistance(60, cfg)).toBeCloseTo(640, 6);
  });

  it('蓄力速率放慢到 ≤300px/s（生还窗口时间 = 距离窗/速率，速率过快窗口不可命中）', () => {
    expect(RATE).toBeLessThanOrEqual(300);
    expect(RATE).toBeCloseTo(260, 6);
  });

  it('新手本能按压 1 秒 ≈ 380px，处于首跳目标（中心距 ~315-335px）安全带内', () => {
    const d = chargeDistance(1.0, cfg);
    // 首跳目标中心距范围（首台半宽 100 + novice gap 120 + 首档半宽 95~115）
    expect(d).toBeGreaterThanOrEqual(315 - 91);
    expect(d).toBeLessThanOrEqual(335 + 111);
  });

  it('非法输入（负数/NaN）按未蓄力处理，不产生 NaN 距离', () => {
    expect(chargeDistance(-0.5, cfg)).toBeCloseTo(120, 6);
    expect(chargeDistance(Number.NaN, cfg)).toBeCloseTo(120, 6);
    expect(Number.isFinite(chargeDistance(Number.POSITIVE_INFINITY, cfg))).toBe(true);
  });

  it('chargeRatio 单调且封顶 1', () => {
    expect(chargeRatio(0, cfg)).toBe(0);
    expect(chargeRatio(0.9, cfg)).toBeCloseTo(0.45, 6);
    expect(chargeRatio(9, cfg)).toBe(1);
  });
});
