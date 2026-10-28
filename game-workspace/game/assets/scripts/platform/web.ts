import type { IAnalytics, IAudio, IDevice, ILifecycle, IRewardedAd, IShare, IStorage, PlatformService } from './types';

/** Web 冒烟/浏览器预览实现：localStorage + visibilitychange + WebAudio 合成短音。 */
export class WebPlatformService implements PlatformService {
  env = 'web' as const;
  storage: IStorage;
  lifecycle: ILifecycle;
  audio: IAudio;
  share: IShare;
  rewardedAd: IRewardedAd;
  analytics: IAnalytics;
  device: IDevice;

  constructor() {
    this.storage = new WebStorage();
    this.lifecycle = new WebLifecycle();
    this.audio = new WebAudio();
    this.share = new DisabledShare();
    this.rewardedAd = new DisabledRewardedAd();
    this.analytics = new LocalAnalytics();
    this.device = new WebDevice();
  }
}

class WebStorage implements IStorage {
  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  set(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* 隐私模式：忽略 */
    }
  }
  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* 忽略 */
    }
  }
}

class WebLifecycle implements ILifecycle {
  private hideCbs: Array<() => void> = [];
  private showCbs: Array<() => void> = [];
  constructor() {
    const doc = globalThis.document;
    if (doc?.addEventListener) {
      doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState === 'hidden') this.hideCbs.forEach(cb => cb());
        else this.showCbs.forEach(cb => cb());
      });
    }
  }
  onHide(cb: () => void): void {
    this.hideCbs.push(cb);
  }
  onShow(cb: () => void): void {
    this.showCbs.push(cb);
  }
}

interface BeepSpec {
  freq: number;
  endFreq?: number;
  durationSec: number;
  type: OscillatorType;
  gain: number;
}

/** 灰盒短音效：振荡器合成，无音频资源依赖。 */
const BEEPS: Record<string, BeepSpec> = {
  charge: { freq: 180, endFreq: 320, durationSec: 0.3, type: 'sine', gain: 0.05 },
  jump: { freq: 420, endFreq: 720, durationSec: 0.12, type: 'triangle', gain: 0.12 },
  land: { freq: 300, durationSec: 0.09, type: 'sine', gain: 0.15 },
  perfect: { freq: 660, endFreq: 990, durationSec: 0.16, type: 'triangle', gain: 0.18 },
  milestone: { freq: 523, endFreq: 1046, durationSec: 0.3, type: 'triangle', gain: 0.2 },
  fall: { freq: 400, endFreq: 110, durationSec: 0.45, type: 'sawtooth', gain: 0.12 },
  ui: { freq: 800, durationSec: 0.05, type: 'square', gain: 0.06 }
};

class WebAudio implements IAudio {
  private ctx: AudioContext | null = null;
  preload(): void {
    /* 合成音无需预载 */
  }
  play(name: string): void {
    const spec = BEEPS[name];
    if (!spec) return;
    try {
      if (!this.ctx) {
        const Ctor = (globalThis as Record<string, unknown>).AudioContext as typeof AudioContext | undefined;
        if (!Ctor) return;
        this.ctx = new Ctor();
      }
      const ctx = this.ctx;
      if (ctx.state === 'suspended') void ctx.resume();
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = spec.type;
      osc.frequency.setValueAtTime(spec.freq, t0);
      if (spec.endFreq !== undefined) osc.frequency.linearRampToValueAtTime(spec.endFreq, t0 + spec.durationSec);
      gain.gain.setValueAtTime(spec.gain, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.durationSec);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + spec.durationSec + 0.02);
    } catch {
      /* 音频失败不阻塞玩法 */
    }
  }
}

/** v1 disabled：无 UI 入口（02-architecture §4）。 */
class DisabledShare implements IShare {
  canShare(): boolean {
    return false;
  }
  shareAppMessage(): void {
    /* no-op */
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

class WebDevice implements IDevice {
  getMenuButtonRect(): null {
    return null;
  }
  getSafeArea(): { top: number; bottom: number } {
    return { top: 0, bottom: 0 };
  }
  vibrateShort(): void {
    /* Web no-op */
  }
}
