import { describe, expect, it } from 'vitest';
import { ScoreService } from '../../assets/scripts/core/score';
import { DEFAULT_CONFIG } from '../../assets/scripts/core/config';
import { LocalEventCounter } from '../../assets/scripts/core/events';

const cfg = DEFAULT_CONFIG;

describe('ScoreService 计分与连击（game-design §4 例1/例2）', () => {
  it('例1：首次 Perfect +2，连击数 1，无奖励', () => {
    const s = new ScoreService(cfg);
    const o = s.registerPerfect();
    expect(o).toMatchObject({ kind: 'perfect', points: 2, bonus: 0, combo: 1 });
    expect(s.score).toBe(2);
  });

  it('例2：连击已达 3 时再次 Perfect → 本跳 +4（+2+min(3-1,4)）', () => {
    const s = new ScoreService(cfg);
    s.registerPerfect();
    s.registerPerfect();
    s.registerPerfect();
    expect(s.score).toBe(2 + 2 + 3);
    const o = s.registerPerfect();
    expect(o.points).toBe(4);
    expect(o.bonus).toBe(2);
    expect(s.score).toBe(11);
  });

  it('站稳 +1 且连击清零', () => {
    const s = new ScoreService(cfg);
    s.registerPerfect();
    s.registerPerfect();
    const o = s.registerSafe();
    expect(o.points).toBe(1);
    expect(s.combo).toBe(0);
    expect(s.score).toBe(5);
  });

  it('连击奖励封顶 +4', () => {
    const s = new ScoreService(cfg);
    let last = 0;
    for (let i = 0; i < 10; i++) last = s.registerPerfect().points;
    expect(last).toBe(2 + cfg.score.comboBonusMax);
  });

  it('每 5 连击触发一次 combo_milestone 事件', () => {
    const sink = new LocalEventCounter();
    const s = new ScoreService(cfg, sink);
    for (let i = 0; i < 5; i++) s.registerPerfect();
    expect(sink.counts['combo_milestone']).toBe(1);
    for (let i = 0; i < 5; i++) s.registerPerfect();
    expect(sink.counts['combo_milestone']).toBe(2);
    s.registerSafe();
    for (let i = 0; i < 4; i++) s.registerPerfect();
    expect(sink.counts['combo_milestone']).toBe(2); // 清零后重新计数，未到 5
  });
});
