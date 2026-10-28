/** 平台适配层接口（02-architecture §4）。core/表现层只依赖本接口。 */
import { isWechatEnv, WechatPlatformService } from './wechat';
import { WebPlatformService } from './web';

export type Env = 'web' | 'wechat';

export interface IStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface ILifecycle {
  onHide(cb: () => void): void;
  onShow(cb: () => void): void;
}

export interface IAudio {
  preload(names: string[]): void;
  /** 短音效；是否播放由调用方按 sound 开关裁决。 */
  play(name: string): void;
}

export interface IShare {
  canShare(): boolean;
  shareAppMessage(msg: { title: string }): void;
}

export interface IRewardedAd {
  isAvailable(): boolean;
  load(): Promise<void>;
  show(): Promise<'completed' | 'aborted'>;
}

export interface IAnalytics {
  track(event: string, props?: Record<string, number | string>): void;
}

export interface IDevice {
  getMenuButtonRect(): { left: number; top: number; right: number; bottom: number } | null;
  getSafeArea(): { top: number; bottom: number };
  /** Web 实现 no-op；是否振动由调用方按 haptics 开关裁决。 */
  vibrateShort(): void;
}

export interface PlatformService {
  env: Env;
  storage: IStorage;
  lifecycle: ILifecycle;
  audio: IAudio;
  share: IShare;
  rewardedAd: IRewardedAd;
  analytics: IAnalytics;
  device: IDevice;
}

/** 按运行环境选择实现；wx 相关判断封装在 wechat.ts。 */
export function detectPlatform(): PlatformService {
  return isWechatEnv() ? new WechatPlatformService() : new WebPlatformService();
}
