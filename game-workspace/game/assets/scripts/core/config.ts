/**
 * 数值配置（唯一源 data/numeric.json 的运行时形态）。
 * core 只依赖本文件的类型与默认值；实际数值由表现层从 resources 加载后注入。
 */
export interface StageBracket {
  maxScore: number | null;
  widthMin: number;
  widthMax: number;
  gapMin: number;
  gapMax: number;
}

export interface NumericConfig {
  charge: { maxDurationSec: number; minDistancePx: number; maxDistancePx: number };
  jump: { durationSec: number; arcHeightPx: number };
  landing: { perfectThresholdPx: number; safeInsetPx: number; stumbleBandPx: number };
  /** 新手保护：前 jumpCount 跳目标台固定 gapPx，Perfect 阈值放宽为 perfectThresholdPx。 */
  novice: { jumpCount: number; gapPx: number; perfectThresholdPx: number };
  stage: { first: { widthPx: number }; brackets: StageBracket[] };
  score: { safePoints: number; perfectPoints: number; comboBonusMax: number; milestoneEvery: number };
  save: { key: string; version: number };
}

/** 与 data/numeric.json 同步的默认值；仅当运行时配置缺失/损坏时兜底使用。 */
export const DEFAULT_CONFIG: NumericConfig = {
  charge: { maxDurationSec: 2.0, minDistancePx: 120, maxDistancePx: 640 },
  jump: { durationSec: 0.55, arcHeightPx: 180 },
  landing: { perfectThresholdPx: 18, safeInsetPx: 4, stumbleBandPx: 20 },
  novice: { jumpCount: 2, gapPx: 120, perfectThresholdPx: 24 },
  stage: {
    first: { widthPx: 200 },
    brackets: [
      { maxScore: 9, widthMin: 190, widthMax: 230, gapMin: 100, gapMax: 200 },
      { maxScore: 29, widthMin: 120, widthMax: 180, gapMin: 150, gapMax: 320 },
      { maxScore: null, widthMin: 100, widthMax: 160, gapMin: 180, gapMax: 420 }
    ]
  },
  score: { safePoints: 1, perfectPoints: 2, comboBonusMax: 4, milestoneEvery: 5 },
  save: { key: 'save_v1', version: 1 }
};

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback;

/** 宽松归一化：字段缺失/类型错误回退默认值；保证 core 拿到的配置永远结构完整。 */
export function normalizeConfig(raw: unknown): NumericConfig {
  const d = DEFAULT_CONFIG;
  if (!raw || typeof raw !== 'object') return { ...d, stage: { ...d.stage, brackets: d.stage.brackets.map(b => ({ ...b })) } };
  const r = raw as Record<string, any>;
  const charge = r.charge || {};
  const jump = r.jump || {};
  const landing = r.landing || {};
  const novice = r.novice || {};
  const stage = r.stage || {};
  const first = stage.first || {};
  const bracketsSrc = Array.isArray(stage.brackets) && stage.brackets.length > 0 ? stage.brackets : d.stage.brackets;
  const score = r.score || {};
  const save = r.save || {};
  return {
    charge: {
      maxDurationSec: num(charge.maxDurationSec, d.charge.maxDurationSec),
      minDistancePx: num(charge.minDistancePx, d.charge.minDistancePx),
      maxDistancePx: num(charge.maxDistancePx, d.charge.maxDistancePx)
    },
    jump: {
      durationSec: num(jump.durationSec, d.jump.durationSec),
      arcHeightPx: num(jump.arcHeightPx, d.jump.arcHeightPx)
    },
    landing: {
      perfectThresholdPx: num(landing.perfectThresholdPx, d.landing.perfectThresholdPx),
      safeInsetPx: num(landing.safeInsetPx, d.landing.safeInsetPx),
      stumbleBandPx: num(landing.stumbleBandPx, d.landing.stumbleBandPx)
    },
    novice: {
      jumpCount: Math.max(0, Math.round(num(novice.jumpCount, d.novice.jumpCount))),
      gapPx: num(novice.gapPx, d.novice.gapPx),
      perfectThresholdPx: num(novice.perfectThresholdPx, d.novice.perfectThresholdPx)
    },
    stage: {
      first: { widthPx: num(first.widthPx, d.stage.first.widthPx) },
      brackets: bracketsSrc.map((b: Record<string, unknown>, i: number) => {
        const fb = d.stage.brackets[Math.min(i, d.stage.brackets.length - 1)];
        const max = b.maxScore;
        return {
          maxScore: max === null || max === undefined ? null : num(max as number, fb.maxScore as number),
          widthMin: num(b.widthMin, fb.widthMin),
          widthMax: num(b.widthMax, fb.widthMax),
          gapMin: num(b.gapMin, fb.gapMin),
          gapMax: num(b.gapMax, fb.gapMax)
        };
      })
    },
    score: {
      safePoints: num(score.safePoints, d.score.safePoints),
      perfectPoints: num(score.perfectPoints, d.score.perfectPoints),
      comboBonusMax: num(score.comboBonusMax, d.score.comboBonusMax),
      milestoneEvery: num(score.milestoneEvery, d.score.milestoneEvery)
    },
    save: {
      key: typeof save.key === 'string' && save.key ? save.key : d.save.key,
      version: num(save.version, d.save.version)
    }
  };
}
