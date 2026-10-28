/** 微信小游戏实现。本文件是全工程唯一允许出现 wx 字面量的位置（AGENTS.md）。 */
import type { IAnalytics, IAudio, IDevice, ILifecycle, IRewardedAd, IShare, IStorage, PlatformService } from './types';

declare const wx: {
  setStorageSync(key: string, value: string): void;
  getStorageSync(key: string): string;
  removeStorageSync(key: string): void;
  onHide(cb: () => void): void;
  onShow(cb: () => void): void;
  createInnerAudioContext(): { src: string; loop: boolean; volume: number; play(): void; destroy(): void };
  vibrateShort(opts?: Record<string, string>): void;
  getMenuButtonBoundingClientRect(): { left: number; top: number; right: number; bottom: number };
  getSystemInfoSync(): { safeArea?: { top: number; bottom: number }; pixelRatio: number; windowWidth: number; windowHeight: number };
  onError(cb: (err: unknown) => void): void;
};

/** 微信环境探测：wx 字面量只出现在本文件。 */
export function isWechatEnv(): boolean {
  const g = globalThis as Record<string, unknown>;
  const api = g.wx as Record<string, unknown> | undefined;
  return typeof api !== 'undefined' && typeof api.getSystemInfoSync === 'function';
}

export class WechatPlatformService implements PlatformService {
  env = 'wechat' as const;
  storage: IStorage;
  lifecycle: ILifecycle;
  audio: IAudio;
  share: IShare;
  rewardedAd: IRewardedAd;
  analytics: IAnalytics;
  device: IDevice;

  constructor() {
    this.storage = new WxStorage();
    this.lifecycle = new WxLifecycle();
    this.audio = new WxAudio();
    this.share = new DisabledShare();
    this.rewardedAd = new DisabledRewardedAd();
    this.analytics = new LocalAnalytics();
    this.device = new WxDevice();
  }
}

class WxStorage implements IStorage {
  get(key: string): string | null {
    try {
      const v = wx.getStorageSync(key);
      return typeof v === 'string' && v ? v : null;
    } catch {
      return null;
    }
  }
  set(key: string, value: string): void {
    try {
      wx.setStorageSync(key, value);
    } catch {
      /* 忽略 */
    }
  }
  remove(key: string): void {
    try {
      wx.removeStorageSync(key);
    } catch {
      /* 忽略 */
    }
  }
}

class WxLifecycle implements ILifecycle {
  onHide(cb: () => void): void {
    wx.onHide(cb);
  }
  onShow(cb: () => void): void {
    wx.onShow(cb);
  }
}

/** 灰盒阶段：微信端音频走 resources/audio 下的 wav；真实兼容性 06 构建实测后定稿。 */
class WxAudio implements IAudio {
  private pool: Record<string, { src: string; loop: boolean; volume: number; play(): void; destroy(): void }> = {};
  preload(names: string[]): void {
    for (const name of names) {
      if (this.pool[name]) continue;
      try {
        const ctx = wx.createInnerAudioContext();
        ctx.src = `audio/${name}.wav`;
        ctx.loop = false;
        ctx.volume = 1;
        this.pool[name] = ctx;
      } catch {
        /* 音频不可用时静默降级为无音效 */
      }
    }
  }
  play(name: string): void {
    const ctx = this.pool[name];
    if (!ctx) return;
    try {
      ctx.play();
    } catch {
      /* 忽略 */
    }
  }
}

class DisabledShare implements IShare {
  canShare(): boolean {
    return false;
  }
  shareAppMessage(): void {
    /* v1 无分享入口 */
  }
}

class DisabledRewardedAd implements IRewardedAd {
  isAvailable(): boolean {
    return false;
  }
  async load(): Promise<void> {
    throw new Error('disabled');
  }
  async show(): Promise<'completed' | 'aborted'> {
    throw new Error('disabled');
  }
}

class LocalAnalytics implements IAnalytics {
  private counts: Record<string, number> = {};
  track(event: string): void {
    this.counts[event] = (this.counts[event] || 0) + 1;
  }
}

class WxDevice implements IDevice {
  getMenuButtonRect(): { left: number; top: number; right: number; bottom: number } | null {
    try {
      return wx.getMenuButtonBoundingClientRect();
    } catch {
      return null;
    }
  }
  getSafeArea(): { top: number; bottom: number } {
    try {
      const info = wx.getSystemInfoSync();
      return { top: info.safeArea?.top ?? 0, bottom: info.safeArea?.bottom ?? 0 };
    } catch {
      return { top: 0, bottom: 0 };
    }
  }
  vibrateShort(): void {
    try {
      wx.vibrateShort({ type: 'light' });
    } catch {
      /* 忽略 */
    }
  }
}
