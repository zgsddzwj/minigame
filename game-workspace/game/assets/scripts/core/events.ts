/** 事件集（game-design / 02-architecture §7）：逻辑层唯一的对外可观测通道。 */
export type GameEventName =
  | 'game_start'
  | 'jump'
  | 'perfect'
  | 'stumble'
  | 'fall'
  | 'game_end'
  | 'combo_milestone';

export type EventProps = Record<string, number | string | boolean>;

export interface EventSink {
  emit(event: GameEventName | string, props?: EventProps): void;
}

/** 默认实现：内存计数器，debug 模式可导出；不联网、不持久化。 */
export class LocalEventCounter implements EventSink {
  readonly counts: Record<string, number> = {};
  readonly log: Array<{ event: string; props?: EventProps; at: number }> = [];

  constructor(private clock: () => number = () => 0) {}

  emit(event: string, props?: EventProps): void {
    this.counts[event] = (this.counts[event] || 0) + 1;
    this.log.push({ event, props, at: this.clock() });
  }
}
