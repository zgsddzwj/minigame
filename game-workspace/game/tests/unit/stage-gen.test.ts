import { describe, expect, it } from 'vitest';
import { StageGen, pickBracket } from '../../assets/scripts/core/stage-gen';
import { DEFAULT_CONFIG, type NumericConfig } from '../../assets/scripts/core/config';

import numeric from '../../../data/numeric.json';

const cfg = DEFAULT_CONFIG as unknown as NumericConfig;

describe('StageGen 种子化台座序列', () => {
  it('首台座宽 200 且居中（第一跳必可成功的前提）', () => {
    const g = new StageGen(42, cfg);
    const p = g.first();
    expect(p.centerX).toBe(0);
    expect(p.halfWidth).toBeCloseTo(100, 6);
  });

  it('同种子序列完全一致（可复现）', () => {
    const build = () => {
      const g = new StageGen(20261027, cfg);
      const out = [g.first()];
      for (let i = 0; i < 20; i++) out.push(g.next(out[out.length - 1], i));
      return out;
    };
    expect(build()).toEqual(build());
  });

  it('不同种子产生不同序列', () => {
    const a = new StageGen(1, cfg);
    const b = new StageGen(2, cfg);
    const pa = a.next(a.first(), 0);
    const pb = b.next(b.first(), 0);
    expect(pa.centerX !== pb.centerX || pa.halfWidth !== pb.halfWidth).toBe(true);
  });

  it('宽度与 gap 落在数据表区间内；中心距不小于首台宽', () => {
    const g = new StageGen(7, cfg);
    let cur = g.first();
    for (let score = 0; score < 40; score++) {
      const next = g.next(cur, score);
      const width = next.halfWidth * 2;
      const gap = next.centerX - cur.centerX - cur.halfWidth - next.halfWidth;
      const bracket = pickBracket(cfg, score);
      expect(width).toBeGreaterThanOrEqual(bracket.widthMin);
      expect(width).toBeLessThanOrEqual(bracket.widthMax);
      expect(gap).toBeGreaterThanOrEqual(bracket.gapMin);
      expect(gap).toBeLessThanOrEqual(bracket.gapMax);
      // 蓄满 640px 必须可达下一台中心
      expect(next.centerX - cur.centerX).toBeLessThanOrEqual(cfg.charge.maxDistancePx);
      cur = next;
    }
  });

  it('新手保护：第 1、2 跳目标台 gap 恒等于 novice.gapPx（不随种子漂移），第 3 跳起恢复随机', () => {
    for (const seed of [1, 7, 42, 20261027, 999983]) {
      const g = new StageGen(seed, cfg);
      let cur = g.first();
      const gapOf = (p: typeof cur) => p.centerX - cur.centerX - cur.halfWidth - p.halfWidth;
      const p1 = g.next(cur, 0);
      expect(gapOf(p1)).toBe(cfg.novice.gapPx);
      cur = p1;
      const p2 = g.next(cur, 1);
      expect(gapOf(p2)).toBe(cfg.novice.gapPx);
      cur = p2;
      const p3 = g.next(cur, 2);
      const bracket = pickBracket(cfg, 2);
      expect(gapOf(p3)).toBeGreaterThanOrEqual(bracket.gapMin);
      expect(gapOf(p3)).toBeLessThanOrEqual(bracket.gapMax);
    }
  });

  it('首档生还窗口 ≥ 0.6 秒（H2 返工验收线：最小宽度安全带 ÷ 蓄力速率）', () => {
    const rate = (cfg.charge.maxDistancePx - cfg.charge.minDistancePx) / cfg.charge.maxDurationSec;
    const bracket = pickBracket(cfg, 0);
    const windowSec = (bracket.widthMin - 2 * cfg.landing.safeInsetPx) / rate;
    expect(windowSec).toBeGreaterThanOrEqual(0.6);
  });

  it('data/numeric.json 与 DEFAULT_CONFIG 数值一致（防两处漂移）', () => {
    expect(numeric.charge).toEqual(cfg.charge);
    expect(numeric.jump).toEqual(cfg.jump);
    expect(numeric.landing).toEqual(cfg.landing);
    expect(numeric.novice.jumpCount).toBe(cfg.novice.jumpCount);
    expect(numeric.novice.gapPx).toBe(cfg.novice.gapPx);
    expect(numeric.novice.perfectThresholdPx).toBe(cfg.novice.perfectThresholdPx);
    expect(numeric.score).toEqual(cfg.score);
    expect(numeric.stage.first).toEqual(cfg.stage.first);
    expect(numeric.stage.brackets.length).toBe(cfg.stage.brackets.length);
  });
});
