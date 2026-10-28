import { chargeDistance, chargeRatio } from './charge';
import { normalizeConfig, type NumericConfig } from './config';
import { EventSink, LocalEventCounter } from './events';
import { judgeLanding, perfectThresholdForJump, type LandingResult } from './landing';
import { SaveStore, type KVStore, type SaveData } from './save';
import { ScoreService } from './score';
import { StageGen, type Platform } from './stage-gen';

export type GameState = 'home' | 'playing' | 'paused' | 'gameover';

/** 教程步骤：0=未开始 1=按住蓄力 2=松手起跳 3=完成（game-design §6） */
export type TutorialStep = 0 | 1 | 2 | 3;

export interface SessionOptions {
  config?: unknown;
  storage?: KVStore;
  sink?: EventSink;
  /** 秒；默认 Date.now()/1000，测试注入固定时钟。 */
  clock?: () => number;
  seed?: number;
}

export interface SessionSnapshot {
  state: GameState;
  score: number;
  best: number;
  combo: number;
  games: number;
  platforms: Platform[];
  currentIndex: number;
  standX: number;
  charging: boolean;
  chargeRatioValue: number;
  pressSeconds: number;
  targetCenterDist: number;
  targetHalfWidth: number;
  tutorialStep: TutorialStep;
  tutorialDone: boolean;
  sound: boolean;
  haptics: boolean;
  newRecord: boolean;
  lastLanding: LandingResult | null;
  /** 最近一跳：实际跳跃距离与目标台中心距（px），供结算校准提示。 */
  lastJump: { distance: number; targetDist: number } | null;
  seed: number;
}

/**
 * 玩法状态机（game-design §3）：home / playing / paused / gameover。
 * 所有判定为纯函数；同 seed 同输入必同结果（回放依据）。
 */
export class GameSession {
  readonly config: NumericConfig;
  state: GameState = 'home';
  score = 0;
  best = 0;
  games = 0;
  combo = 0;
  platforms: Platform[] = [];
  currentIndex = 0;
  standX = 0;
  charging = false;
  pressStart = 0;
  tutorialStep: TutorialStep = 0;
  tutorialDone = false;
  sound = true;
  haptics = true;
  newRecord = false;
  lastLanding: LandingResult | null = null;
  lastJump: { distance: number; targetDist: number } | null = null;
  seed = 0;
  sink: EventSink;

  private gen: StageGen | null = null;
  private scores: ScoreService;
  private store: SaveStore | null;
  private clock: () => number;
  private seedCounter = 0;

  constructor(options: SessionOptions = {}) {
    this.config = normalizeConfig(options.config);
    this.sink = options.sink || new LocalEventCounter();
    this.clock = options.clock || (() => Date.now() / 1000);
    this.store = options.storage ? new SaveStore(options.storage, this.config) : null;
    this.scores = new ScoreService(this.config, this.sink);
    if (this.store) {
      const save = this.store.load();
      this.best = save.best;
      this.games = save.games;
      this.sound = save.sound;
      this.haptics = save.haptics;
      this.tutorialDone = save.tutorialDone;
    }
    this.seedCounter = (Math.floor(this.clock() * 1000) & 0x7fffffff) || 1;
    if (options.seed !== undefined) this.seed = options.seed >>> 0;
  }

  /** home/gameover/paused → playing，重置一局。 */
  start(seed?: number): void {
    this.seed = (seed !== undefined ? seed >>> 0 : this.nextSeed()) >>> 0;
    this.gen = new StageGen(this.seed, this.config);
    this.platforms = [this.gen.first(), this.gen.next(this.gen.first(), 0)];
    this.currentIndex = 0;
    this.standX = this.platforms[0].centerX;
    this.score = 0;
    this.combo = 0;
    // 计分服务内部也必须清零，否则重开后的首次落地会把上一局分数带回来
    this.scores.reset();
    this.charging = false;
    this.pressStart = 0;
    this.newRecord = false;
    this.lastLanding = null;
    this.lastJump = null;
    this.state = 'playing';
    this.tutorialStep = this.tutorialDone ? 3 : 1;
    this.sink.emit('game_start', { seed: this.seed });
  }

  /** Playing 中重开也走这里（暂停面板/结算面板共用）。 */
  restart(): void {
    this.start();
  }

  pressDown(): boolean {
    if (this.state !== 'playing' || this.charging) return false;
    this.charging = true;
    this.pressStart = this.clock();
    if (this.tutorialStep === 1) this.tutorialStep = 2;
    return true;
  }

  /** 松手起跳：结算本跳。无有效按压时返回 null。 */
  pressUp(): LandingResult | null {
    if (this.state !== 'playing' || !this.charging) return null;
    this.charging = false;
    const pressSeconds = this.clock() - this.pressStart;
    const distance = chargeDistance(pressSeconds, this.config);
    this.sink.emit('jump', { distance: Math.round(distance * 100) / 100, pressSeconds: Math.round(pressSeconds * 1000) / 1000 });

    const current = this.platforms[this.currentIndex];
    const target = this.platforms[this.currentIndex + 1];
    const offset = this.standX + distance - target.centerX;
    // 新手保护：第 1..jumpCount 跳用放宽的 Perfect 阈值（landing/session/表现层同源）
    const jumpNumber = this.currentIndex + 1;
    const threshold = perfectThresholdForJump(this.config, jumpNumber);
    const result = judgeLanding(offset, target.halfWidth, this.config, threshold);
    this.lastJump = {
      distance: Math.round(distance * 100) / 100,
      targetDist: Math.round((target.centerX - this.standX) * 100) / 100
    };

    if (this.tutorialStep === 2) this.tutorialStep = 3;

    if (result.verdict === 'fall') {
      this.lastLanding = result;
      this.state = 'gameover';
      this.games += 1;
      this.newRecord = this.score > this.best;
      if (this.newRecord) this.best = this.score;
      this.persist();
      this.sink.emit('fall', {
        offset: Math.round(result.offset * 100) / 100,
        score: this.score,
        jumpDistance: this.lastJump.distance,
        targetDist: this.lastJump.targetDist
      });
      this.sink.emit('game_end', { score: this.score, best: this.best, games: this.games, reason: 'fall' });
      return result;
    }

    // 站稳：推进世界
    this.standX += distance;
    this.currentIndex += 1;
    const next = this.gen!.next(this.platforms[this.platforms.length - 1], this.score);
    this.platforms.push(next);
    if (result.verdict === 'perfect') {
      const outcome = this.scores.registerPerfect();
      this.combo = outcome.combo;
      this.score = this.scores.score;
      this.lastLanding = result;
      this.sink.emit('perfect', { combo: outcome.combo, points: outcome.points, offset: Math.round(result.offset * 100) / 100 });
    } else {
      const outcome = this.scores.registerSafe();
      this.combo = 0;
      this.score = this.scores.score;
      this.lastLanding = result;
      if (result.stumble) this.sink.emit('stumble', { offset: Math.round(result.offset * 100) / 100 });
    }
    return result;
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.charging = false;
    this.pressStart = 0;
    this.state = 'paused';
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
  }

  toHome(): void {
    this.charging = false;
    this.state = 'home';
  }

  /** 切后台（wx.onHide / visibilitychange）：Playing 一律暂停。 */
  handleHide(): void {
    if (this.state === 'playing') this.pause();
  }

  toggleSound(): boolean {
    this.sound = !this.sound;
    this.persist();
    return this.sound;
  }

  toggleHaptics(): boolean {
    this.haptics = !this.haptics;
    this.persist();
    return this.haptics;
  }

  /** 教程可跳过；完成/跳过均写档，之后不再出现。 */
  skipTutorial(): void {
    if (this.tutorialDone) return;
    this.tutorialDone = true;
    this.tutorialStep = 3;
    this.persist();
  }

  snapshot(): SessionSnapshot {
    const pressSeconds = this.charging ? this.clock() - this.pressStart : 0;
    const target = this.platforms[this.currentIndex + 1];
    return {
      state: this.state,
      score: this.score,
      best: this.best,
      combo: this.combo,
      games: this.games,
      platforms: this.platforms,
      currentIndex: this.currentIndex,
      standX: this.standX,
      charging: this.charging,
      chargeRatioValue: pressSeconds > 0 ? chargeRatio(pressSeconds, this.config) : 0,
      pressSeconds,
      targetCenterDist: target ? target.centerX - this.standX : 0,
      targetHalfWidth: target ? target.halfWidth : 0,
      tutorialStep: this.tutorialStep,
      tutorialDone: this.tutorialDone,
      sound: this.sound,
      haptics: this.haptics,
      newRecord: this.newRecord,
      lastLanding: this.lastLanding,
      lastJump: this.lastJump,
      seed: this.seed
    };
  }

  /** 当前蓄力是否已达上限（表现层持续抖动提示依据）。 */
  isChargeFull(): boolean {
    return this.charging && this.clock() - this.pressStart >= this.config.charge.maxDurationSec;
  }

  private nextSeed(): number {
    this.seedCounter = (Math.imul(this.seedCounter, 1664525) + 1013904223) >>> 0;
    return this.seedCounter;
  }

  private persist(): void {
    if (!this.store) return;
    const save: SaveData = {
      v: this.config.save.version,
      best: this.best,
      games: this.games,
      sound: this.sound,
      haptics: this.haptics,
      tutorialDone: this.tutorialDone
    };
    this.store.write(save);
  }
}
