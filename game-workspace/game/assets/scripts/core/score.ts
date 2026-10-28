import type { NumericConfig } from './config';
import type { EventSink } from './events';

export interface PerfectOutcome {
  kind: 'perfect';
  points: number;
  bonus: number;
  combo: number;
  milestone: boolean;
}

export interface SafeOutcome {
  kind: 'safe';
  points: number;
}

/** 计分与连击。规则（game-design §5 计分行）：
 * 站稳 +safePoints 且连击清零；Perfect +perfectPoints + max(0, min(连击前次数−1, comboBonusMax))，
 * 每 milestoneEvery 连击触发一次 combo_milestone 事件。 */
export class ScoreService {
  score = 0;
  combo = 0;

  constructor(private config: NumericConfig, private sink: EventSink | null = null) {}

  registerPerfect(): PerfectOutcome {
    const before = this.combo;
    this.combo = before + 1;
    const bonus = Math.max(0, Math.min(before - 1, this.config.score.comboBonusMax));
    const points = this.config.score.perfectPoints + bonus;
    this.score += points;
    const every = this.config.score.milestoneEvery;
    const milestone = every > 0 && this.combo % every === 0;
    if (milestone) this.sink?.emit('combo_milestone', { combo: this.combo });
    return { kind: 'perfect', points, bonus, combo: this.combo, milestone };
  }

  registerSafe(): SafeOutcome {
    this.score += this.config.score.safePoints;
    this.combo = 0;
    return { kind: 'safe', points: this.config.score.safePoints };
  }

  reset(): void {
    this.score = 0;
    this.combo = 0;
  }
}
