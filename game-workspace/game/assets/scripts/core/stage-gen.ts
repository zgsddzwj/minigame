import type { NumericConfig, StageBracket } from './config';
import { mulberry32, randIntInclusive, type Rng } from './rng';

export interface Platform {
  /** 台面中心 X（世界坐标，向前跳跃为 +X）。 */
  centerX: number;
  halfWidth: number;
}

/**
 * 种子化台座序列。gap 语义：前后台座顶面边缘净距（data/numeric.json stage.gapMeaning）。
 * 下一台中心 = prev.centerX + prev.halfWidth + gap + halfWidthNext。
 * 新手保护（stage.novice）：第 1..jumpCount 跳的目标台（即第 2..jumpCount+1 块）用固定 gapPx，
 * 不消耗随机 gap 抽取；此后恢复按难度档随机。
 */
export class StageGen {
  private rng: Rng;
  /** 已生成台座数（first() 计 1；next() 每次 +1）。 */
  private generated = 0;

  constructor(seed: number, private config: NumericConfig) {
    this.rng = mulberry32(seed >>> 0);
    this.generated = 1;
  }

  first(): Platform {
    const half = this.config.stage.first.widthPx / 2;
    return { centerX: 0, halfWidth: half };
  }

  /** 生成 current 之后的下一台；难度档位按玩家当前分数选取。 */
  next(current: Platform, score: number): Platform {
    const bracket = pickBracket(this.config, score);
    const width = randIntInclusive(this.rng, bracket.widthMin, bracket.widthMax);
    const novice = this.config.novice;
    const noviceGap = novice && this.generated <= novice.jumpCount ? novice.gapPx : null;
    const gap = noviceGap ?? randIntInclusive(this.rng, bracket.gapMin, bracket.gapMax);
    const halfWidth = width / 2;
    const centerX = current.centerX + current.halfWidth + gap + halfWidth;
    this.generated += 1;
    return { centerX, halfWidth };
  }
}

export function pickBracket(config: NumericConfig, score: number): StageBracket {
  const brackets = config.stage.brackets;
  for (const b of brackets) {
    if (b.maxScore === null || score <= b.maxScore) return b;
  }
  return brackets[brackets.length - 1];
}
