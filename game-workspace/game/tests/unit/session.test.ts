import { describe, expect, it } from 'vitest';
import { GameSession } from '../../assets/scripts/core/session';
import { DEFAULT_CONFIG, type NumericConfig } from '../../assets/scripts/core/config';
import { LocalEventCounter } from '../../assets/scripts/core/events';

const cfg = DEFAULT_CONFIG as unknown as NumericConfig;

function makeClock() {
  let now = 1000;
  return { get: () => now, set: (v: number) => { now = v; }, advance: (s: number) => { now += s; } };
}

function makeSession(seed = 42) {
  const clock = makeClock();
  const sink = new LocalEventCounter(clock.get);
  const session = new GameSession({ config: cfg, clock: clock.get, sink, seed: 1 });
  return { clock, sink, session };
}

/** 落到下一台中心（Perfect）所需的按压秒数 */
function perfectPressSeconds(session: GameSession): number {
  const s = session.snapshot();
  return ((s.targetCenterDist - cfg.charge.minDistancePx) / (cfg.charge.maxDistancePx - cfg.charge.minDistancePx)) * cfg.charge.maxDurationSec;
}

describe('GameSession 状态机与玩法闭环', () => {
  it('初始为 home；start 后进入 playing 且有 2 个台座', () => {
    const { session } = makeSession();
    expect(session.state).toBe('home');
    session.start(42);
    expect(session.state).toBe('playing');
    expect(session.platforms.length).toBe(2);
    expect(session.platforms[0].halfWidth).toBeCloseTo(100, 6);
  });

  it('第一跳按中心距蓄力 → Perfect +2，教程推进 1→2→3', () => {
    const { clock, session } = makeSession();
    session.start(42);
    expect(session.tutorialStep).toBe(1);
    session.pressDown();
    expect(session.tutorialStep).toBe(2);
    clock.advance(perfectPressSeconds(session));
    const r = session.pressUp();
    expect(r?.verdict).toBe('perfect');
    expect(session.score).toBe(2);
    expect(session.combo).toBe(1);
    expect(session.currentIndex).toBe(1);
    expect(session.platforms.length).toBe(3);
    expect(session.tutorialStep).toBe(3);
  });

  it('过短按压（连点）欠距离 → 坠落 → gameover，最高分与局数入档', () => {
    const savedRef: { value: string | null } = { value: null };
    const clock = makeClock();
    const session = new GameSession({
      config: cfg,
      clock: clock.get,
      storage: { get: () => null, set: (_k, v) => { savedRef.value = v; } }
    });
    session.start(42);
    session.pressDown();
    clock.advance(0.01); // 连点：距离不足
    expect(session.pressUp()?.verdict).toBe('fall');
    expect(session.state).toBe('gameover');
    expect(session.games).toBe(1);
    expect(session.best).toBe(0);
    expect(savedRef.value).toBeTruthy();
    expect(JSON.parse(savedRef.value as string)).toMatchObject({ v: 1, best: 0, games: 1 });
  });

  it('蓄满后 pressSeconds 持续增长但蓄力比例封顶 1；松手结果合法', () => {
    const { clock, session } = makeSession();
    session.start(42);
    session.pressDown();
    clock.advance(5);
    let s = session.snapshot();
    expect(s.charging).toBe(true);
    expect(s.pressSeconds).toBeCloseTo(5, 6);
    expect(s.chargeRatioValue).toBe(1);
    const r = session.pressUp();
    s = session.snapshot();
    expect(['perfect', 'safe', 'fall']).toContain(r?.verdict);
    expect(['playing', 'gameover']).toContain(s.state);
  });

  it('同 seed 同输入 → 完全相同的结果序列（回放依据）', () => {
    const play = () => {
      const { clock, session } = makeSession();
      session.start(7);
      const log: Array<string | number> = [];
      for (let i = 0; i < 6; i++) {
        session.pressDown();
        clock.advance(perfectPressSeconds(session) + (i % 3) * 0.02);
        const r = session.pressUp();
        log.push(r ? r.verdict : 'null', session.score);
        if (session.state === 'gameover') break;
      }
      return { log, platforms: session.platforms.map(p => [p.centerX, p.halfWidth]) };
    };
    expect(play()).toEqual(play());
  });

  it('暂停/恢复；暂停中忽略按压；蓄力中暂停取消蓄力；回首页后可重开', () => {
    const { clock, session } = makeSession();
    session.start(42);
    session.pause();
    expect(session.state).toBe('paused');
    expect(session.pressDown()).toBe(false);
    session.resume();
    expect(session.state).toBe('playing');
    session.pressDown();
    clock.advance(0.2);
    session.pause();
    expect(session.state).toBe('paused');
    expect(session.pressUp()).toBeNull(); // 蓄力已取消
    session.toHome();
    expect(session.state).toBe('home');
    session.start(43);
    expect(session.state).toBe('playing');
    expect(session.score).toBe(0);
  });

  it('切后台自动暂停（handleHide）', () => {
    const { session } = makeSession();
    session.start(42);
    session.handleHide();
    expect(session.state).toBe('paused');
    session.handleHide();
    expect(session.state).toBe('paused');
  });

  it('gameover 后 restart 重置分数与台座，games 累计', () => {
    const { clock, session } = makeSession();
    session.start(42);
    session.pressDown();
    clock.advance(0.01);
    session.pressUp();
    expect(session.state).toBe('gameover');
    session.restart();
    expect(session.state).toBe('playing');
    expect(session.score).toBe(0);
    expect(session.currentIndex).toBe(0);
    expect(session.games).toBe(1);
  });

  it('重开后再落地，分数从 0 重新累计而非叠加上一局（跨局分数泄漏回归）', () => {
    const { clock, session } = makeSession();
    session.start(42);
    for (let i = 0; i < 3; i++) {
      session.pressDown();
      clock.advance(perfectPressSeconds(session));
      session.pressUp();
    }
    expect(session.score).toBe(7); // 2+2+3：连击奖励从第 3 次 Perfect 起
    session.pressDown();
    clock.advance(0.01);
    session.pressUp(); // 坠落
    expect(session.state).toBe('gameover');
    session.restart();
    expect(session.score).toBe(0);
    session.pressDown();
    clock.advance(perfectPressSeconds(session));
    expect(session.pressUp()?.verdict).toBe('perfect');
    // 修复前：ScoreService 未随 start() 清零，这里会得到 7+2=9
    expect(session.score).toBe(2);
    expect(session.combo).toBe(1);
    expect(session.currentIndex).toBe(1);
  });

  it('多点触控防御：蓄力中再次 pressDown 不重置蓄力起点', () => {
    const { clock, session } = makeSession();
    session.start(42);
    expect(session.pressDown()).toBe(true);
    clock.advance(0.1);
    expect(session.pressDown()).toBe(false);
    clock.advance(perfectPressSeconds(session) - 0.1);
    expect(session.pressUp()?.verdict).toBe('perfect');
  });

  it('音效/振动开关切换并写档；教程跳过后新一局不再出现', () => {
    const backing = new Map<string, string>();
    const clock = makeClock();
    const session = new GameSession({ config: cfg, clock: clock.get, storage: { get: k => backing.get(k) ?? null, set: (k, v) => void backing.set(k, v) } });
    session.start(42);
    expect(session.toggleSound()).toBe(false);
    expect(session.toggleHaptics()).toBe(false);
    session.skipTutorial();
    expect(session.tutorialDone).toBe(true);
    session.restart();
    expect(session.tutorialStep).toBe(3);
    expect(JSON.parse(backing.get('save_v1')!)).toMatchObject({ sound: false, haptics: false, tutorialDone: true });
  });

  it('5 连 Perfect 计 16 分并触发一次里程碑；坠落结算 game_end', () => {
    const { clock, sink, session } = makeSession();
    session.start(42);
    for (let i = 0; i < 5; i++) {
      session.pressDown();
      clock.advance(perfectPressSeconds(session));
      session.pressUp();
    }
    expect(session.score).toBe(16); // 2+2+3+4+5
    session.pressDown();
    clock.advance(0.01);
    session.pressUp();
    expect(sink.counts['game_start']).toBe(1);
    expect(sink.counts['jump']).toBe(6);
    expect(sink.counts['perfect']).toBe(5);
    expect(sink.counts['combo_milestone']).toBe(1);
    expect(sink.counts['fall']).toBe(1);
    expect(sink.counts['game_end']).toBe(1);
    expect(session.best).toBe(16);
  });

  it('任意已生成台座的中心距都在蓄力可达范围内（≤ 蓄满距离），40 跳全程可 Perfect', () => {
    const { clock, session } = makeSession();
    session.start(20261027);
    let checked = 0;
    for (let i = 0; i < 40 && session.state === 'playing'; i++) {
      const s = session.snapshot();
      expect(s.targetCenterDist).toBeLessThanOrEqual(cfg.charge.maxDistancePx);
      checked++;
      session.pressDown();
      clock.advance(perfectPressSeconds(session));
      session.pressUp();
    }
    expect(checked).toBeGreaterThanOrEqual(20);
  });

  it('新手保护：第 1、2 跳目标台用固定 gap，落点偏 20px 仍 Perfect，第 3 跳恢复 18px 阈值', () => {
    const { clock, session } = makeSession();
    session.start(99);
    // 前两跳目标台 gap 固定
    const gapOf = (i: number) =>
      session.platforms[i].centerX - session.platforms[i - 1].centerX - session.platforms[i - 1].halfWidth - session.platforms[i].halfWidth;
    expect(gapOf(1)).toBe(cfg.novice.gapPx);
    // 第 1 跳：瞄准中心偏 20px（旧全局阈值 18 会判 safe，新手阈值 24 应判 Perfect）
    const pressForOffset = (offsetPx: number) => {
      const s = session.snapshot();
      return ((s.targetCenterDist + offsetPx - cfg.charge.minDistancePx) / (cfg.charge.maxDistancePx - cfg.charge.minDistancePx)) * cfg.charge.maxDurationSec;
    };
    session.pressDown();
    clock.advance(pressForOffset(20));
    expect(session.pressUp()?.verdict).toBe('perfect');
    expect(gapOf(2)).toBe(cfg.novice.gapPx);
    // 第 2 跳：同样 20px 偏移仍 Perfect
    session.pressDown();
    clock.advance(pressForOffset(20));
    expect(session.pressUp()?.verdict).toBe('perfect');
    // 第 3 跳：新手保护结束，20px 偏移退回 safe（Perfect 阈值 18）
    session.pressDown();
    clock.advance(pressForOffset(20));
    expect(session.pressUp()?.verdict).toBe('safe');
    expect(session.combo).toBe(0);
  });

  it('坠落记录本跳距离与目标中心距（结算校准用），重开后清空', () => {
    const { clock, session } = makeSession();
    session.start(42);
    const targetDist = session.snapshot().targetCenterDist;
    session.pressDown();
    clock.advance(0.05);
    session.pressUp();
    expect(session.state).toBe('gameover');
    const j = session.lastJump;
    expect(j).not.toBeNull();
    // 0.05s → 120 + 520*(0.05/2) = 133px，必短于目标 → 坠落
    expect(j!.distance).toBeCloseTo(133, 0);
    expect(j!.targetDist).toBeCloseTo(targetDist, 0);
    expect(session.snapshot().lastJump).toEqual(j);
    session.restart();
    expect(session.lastJump).toBeNull();
  });
});
