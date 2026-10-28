import { describe, expect, it } from 'vitest';
import { chargeDistance } from '../../assets/scripts/core/charge';
import { judgeLanding, perfectThresholdForJump } from '../../assets/scripts/core/landing';
import { StageGen } from '../../assets/scripts/core/stage-gen';
import { DEFAULT_CONFIG } from '../../assets/scripts/core/config';

const cfg = DEFAULT_CONFIG;

/**
 * H2 返工调校回归（2026-10-28）：
 * 返工前缺陷 = 蓄满 0.9s/640px 必越过首档全部目标，生还窗口 0.36~0.67s，新手按住 1-2 秒的本能节奏必死。
 * 本文件把返工验收线固化为可执行断言：本能节奏（按住 0.5~1.05s）在前 2 跳（新手保护）必须全部生还。
 */
describe('H2 返工调校回归：新手本能节奏生还', () => {
  const HOLDS = [0.5, 0.55, 0.6, 0.7, 0.8, 0.9, 1.0, 1.05];

  it('按住 0.5~1.05 秒（本能节奏）在前 2 跳全部生还，30 个种子无一坠落', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const g = new StageGen(seed, cfg);
      const p0 = g.first();
      const p1 = g.next(p0, 0);
      const p2 = g.next(p1, 1);
      const jumps: Array<[number, typeof p0, typeof p1]> = [
        [1, p0, p1],
        [2, p1, p2]
      ];
      for (const [jumpNumber, from, to] of jumps) {
        for (const hold of HOLDS) {
          const dist = chargeDistance(hold, cfg);
          const offset = dist - (to.centerX - from.centerX);
          const r = judgeLanding(offset, to.halfWidth, cfg, perfectThresholdForJump(cfg, jumpNumber));
          expect(
            r.verdict,
            `seed=${seed} 第${jumpNumber}跳 hold=${hold}s 判定=${r.verdict}（offset=${r.offset.toFixed(1)}px, halfWidth=${to.halfWidth}）`
          ).not.toBe('fall');
        }
      }
    }
  });

  it('新手生还窗口确实变宽：单跳安全带时间宽度 ≥ 0.6s（首档最小宽度）', () => {
    const rate = (cfg.charge.maxDistancePx - cfg.charge.minDistancePx) / cfg.charge.maxDurationSec;
    const bracket = cfg.stage.brackets[0];
    const windowSec = (bracket.widthMin - 2 * cfg.landing.safeInsetPx) / rate;
    expect(rate).toBeCloseTo(260, 6);
    expect(windowSec).toBeGreaterThanOrEqual(0.6);
  });

  it('新手保护期外（第 3 跳起）窗口仍在 0.3s 以上——难度保留，但已比旧版速率（577.8px/s）宽约一倍', () => {
    const oldRate = (640 - 120) / 0.9; // 返工前速率，作为对比基线
    const rate = (cfg.charge.maxDistancePx - cfg.charge.minDistancePx) / cfg.charge.maxDurationSec;
    expect(rate).toBeLessThan(oldRate / 1.9); // 2.0s vs 0.9s：速率必须实质放缓
    for (let seed = 1; seed <= 10; seed++) {
      const g = new StageGen(seed, cfg);
      const p0 = g.first();
      const p1 = g.next(p0, 0); // 第 1 跳目标（新手固定 gap）
      const p2 = g.next(p1, 1); // 第 2 跳目标（新手固定 gap）
      const p3 = g.next(p2, 2); // 第 3 跳目标：恢复随机难度
      const windowSec = (p3.halfWidth * 2 - 2 * cfg.landing.safeInsetPx) / rate;
      expect(windowSec).toBeGreaterThan(0.3);
    }
  });
});
