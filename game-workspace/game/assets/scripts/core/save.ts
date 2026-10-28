import type { NumericConfig } from './config';

export interface SaveData {
  v: number;
  best: number;
  games: number;
  sound: boolean;
  haptics: boolean;
  tutorialDone: boolean;
}

/** 逻辑层只依赖此最小存储接口（Web 实现 localStorage / 微信实现 wx storage）。 */
export interface KVStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export function defaultSave(): SaveData {
  return { v: 1, best: 0, games: 0, sound: true, haptics: true, tutorialDone: false };
}

/** 版本迁移纯函数链；当前只有 v1，未来 vN→vN+1 在此追加。 */
export function migrate(data: SaveData): SaveData {
  return data;
}

function valid(d: unknown): d is SaveData {
  if (!d || typeof d !== 'object') return false;
  const s = d as Record<string, unknown>;
  return (
    s.v === 1 &&
    typeof s.best === 'number' && Number.isFinite(s.best) && s.best >= 0 &&
    typeof s.games === 'number' && Number.isFinite(s.games) && s.games >= 0 &&
    typeof s.sound === 'boolean' &&
    typeof s.haptics === 'boolean' &&
    typeof s.tutorialDone === 'boolean'
  );
}

/**
 * 解析存档：任何损坏（JSON 非法、版本不符、字段缺失）一律降级为默认档，不崩溃。
 * 返回值永远是结构完整的 SaveData。
 */
export function parseSave(raw: string | null): SaveData {
  if (!raw) return defaultSave();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultSave();
  }
  if (!valid(parsed)) return defaultSave();
  if (parsed.v !== 1) return migrate(parsed);
  return migrate(parsed);
}

export function serializeSave(data: SaveData): string {
  return JSON.stringify(data);
}

export class SaveStore {
  constructor(private store: KVStore, private config: NumericConfig) {}

  load(): SaveData {
    return parseSave(this.store.get(this.config.save.key));
  }

  write(data: SaveData): void {
    try {
      this.store.set(this.config.save.key, serializeSave(data));
    } catch {
      /* 存储满/隐私模式：忽略，游戏继续（仅丢持久化） */
    }
  }
}
