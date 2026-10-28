import { describe, expect, it } from 'vitest';
import { judgeLanding, perfectThresholdForJump } from '../../assets/scripts/core/landing';
import { DEFAULT_CONFIG } from '../../assets/scripts/core/config';

const cfg = DEFAULT_CONFIG;
const HALF = 80; // game-design §4 设定

describe('LandingJudge 落点判定（game-design §4 走查例）', () => {
  it('例1：偏移 10 ≤ 18 → Perfect', () => {
    const r = judgeLanding(10, HALF, cfg);
    expect(r.verdict).toBe('perfect');
    expect(r.stumble).toBe(false);
  });

  it('例3：偏移 55 → 站稳，无踉跄', () => {
    const r = judgeLanding(55, HALF, cfg);
    expect(r.verdict).toBe('safe');
    expect(r.stumble).toBe(false);
  });

  it('例4：偏移 74（60~76 区间）→ 站稳 + 踉跄提示', () => {
    const r = judgeLanding(74, HALF, cfg);
    expect(r.verdict).toBe('safe');
    expect(r.stumble).toBe(true);
  });

  it('例5：偏移 80 > 76 → 坠落', () => {
    expect(judgeLanding(80, HALF, cfg).verdict).toBe('fall');
    expect(judgeLanding(81, HALF, cfg).verdict).toBe('fall');
  });

  it('边界：恰在 Perfect 阈值内/外', () => {
    expect(judgeLanding(18, HALF, cfg).verdict).toBe('perfect');
    expect(judgeLanding(18.01, HALF, cfg).verdict).toBe('safe');
  });

  it('边界：恰好落在安全内缩线上站稳，超出 0.01 坠落', () => {
    expect(judgeLanding(76, HALF, cfg).verdict).toBe('safe');
    expect(judgeLanding(76.01, HALF, cfg).verdict).toBe('fall');
  });

  it('负向偏移对称判定', () => {
    expect(judgeLanding(-10, HALF, cfg).verdict).toBe('perfect');
    expect(judgeLanding(-77, HALF, cfg).verdict).toBe('fall');
  });

  it('窄台（safeLimit < perfect 阈值）时 Perfect 区间收缩，安全带随之消失', () => {
    // halfW=20 → safeLimit=16，perfectLimit=min(18,16)=16：≤16 Perfect，>16 直接坠落
    expect(judgeLanding(16, 20, cfg).verdict).toBe('perfect');
    expect(judgeLanding(17, 20, cfg).verdict).toBe('fall');
    expect(judgeLanding(20, 20, cfg).verdict).toBe('fall');
    // halfW=25 → safeLimit=21，perfectLimit=18：18~21 之间仍可站稳
    expect(judgeLanding(20, 25, cfg).verdict).toBe('safe');
  });

  it('新手保护阈值覆盖：偏移 20px 在旧全局阈值（18）下只是站稳，传入 24 判 Perfect', () => {
    expect(judgeLanding(20, HALF, cfg).verdict).toBe('safe');
    expect(judgeLanding(20, HALF, cfg, 24).verdict).toBe('perfect');
  });

  it('新手阈值 24px 边界：≤24 Perfect，24.01 站稳，超安全带仍坠落', () => {
    expect(judgeLanding(24, HALF, cfg, 24).verdict).toBe('perfect');
    expect(judgeLanding(24.01, HALF, cfg, 24).verdict).toBe('safe');
    expect(judgeLanding(80, HALF, cfg, 24).verdict).toBe('fall');
  });

  it('阈值覆盖不会越过安全内缩线：窄台 + 24px 仍以 safeLimit 收缩', () => {
    // halfW=25 → safeLimit=21：即使阈值 24，Perfect 区也被压到 21，21.01 直接坠落
    expect(judgeLanding(21, 25, cfg, 24).verdict).toBe('perfect');
    expect(judgeLanding(21.01, 25, cfg, 24).verdict).toBe('fall');
  });

  it('perfectThresholdForJump：第 1、2 跳放宽为 24，第 3 跳起回到 18', () => {
    expect(perfectThresholdForJump(cfg, 1)).toBe(24);
    expect(perfectThresholdForJump(cfg, 2)).toBe(24);
    expect(perfectThresholdForJump(cfg, 3)).toBe(18);
    expect(perfectThresholdForJump(cfg, 50)).toBe(18);
  });
});
