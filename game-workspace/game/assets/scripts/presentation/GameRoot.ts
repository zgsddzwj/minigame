import { _decorator, Color, Component, EventTouch, Graphics, JsonAsset, Label, Layers, Node, ResolutionPolicy, UITransform, UIOpacity, view, resources } from 'cc';
import { GameSession } from '../core/session';
import { normalizeConfig, type NumericConfig } from '../core/config';
import { LocalEventCounter, type EventProps } from '../core/events';
import { perfectThresholdForJump } from '../core/landing';
import { detectPlatform, type PlatformService } from '../platform/types';

const { ccclass } = _decorator;

const UI_2D = Layers.Enum.UI_2D;
const COL_BG = new Color(16, 34, 46, 255);
const COL_PLATFORM = new Color(58, 90, 72, 255);
const COL_PERFECT = new Color(217, 176, 74, 255);
const COL_CHAR = new Color(240, 178, 74, 255);
const COL_PANEL = new Color(24, 48, 62, 235);
const COL_BTN = new Color(47, 111, 79, 255);
const COL_TEXT = new Color(235, 240, 235, 255);
const COL_SUBTLE = new Color(160, 176, 170, 255);
const COL_ACCENT = new Color(255, 214, 102, 255);
const COL_DANGER = new Color(255, 120, 90, 255);
const COL_TRACK = new Color(255, 255, 255, 40);

interface AnimJump {
  startX: number;
  endX: number;
  t: number;
  dur: number;
  fall: boolean;
}

interface ButtonRef {
  node: Node;
  label: Label;
  w: number;
  h: number;
}

/**
 * 灰盒原型主组件：把 core/GameSession 的状态画出来并喂入输入。
 * 全部 UI 程序化构建；场景里只挂这一个组件。
 */
@ccclass('GameRoot')
export class GameRoot extends Component {
  private platform!: PlatformService;
  private session!: GameSession;
  private config: NumericConfig = normalizeConfig(null);
  private counter = new LocalEventCounter();

  private worldNode!: Node;
  private charNode!: Node;
  private chargeBarNode!: Node;
  private chargeFillGfx!: Graphics;
  private chargeBarWidth = 0;
  private targetMarker!: Node;
  private markerGfx!: Graphics;
  private markerColor = new Color(255, 214, 102, 255);
  private scoreLabel!: Label;
  private comboLabel!: Label;
  private bestLabel!: Label;
  private toastNode!: Node;
  private toastLabel!: Label;
  private toastOpacity!: UIOpacity;
  private homePanel!: Node;
  private pausePanel!: Node;
  private overPanel!: Node;
  private tutorialNode!: Node;
  private tutorialLabel!: Label;
  private overScoreLabel!: Label;
  private overBestLabel!: Label;
  private overDistLabel!: Label;
  private inputLayer!: Node;
  private pauseBtn!: Node;

  private buttons: Record<string, ButtonRef> = {};
  private platformNodes: Node[] = [];
  private drawnPlatformCount = -1;

  private scrollX = 0;
  private baseY = 0;
  private jump: AnimJump | null = null;
  private fallTimer = -1;
  private toastTimer = -1;
  private shakeTimer = -1;
  private touchId: number | null = null;
  private lastOutcome: { verdict: string; offset: number; points: number } | null = null;

  onLoad(): void {
    view.setDesignResolutionSize(750, 1334, ResolutionPolicy.FIXED_WIDTH);
  }

  start(): void {
    this.platform = detectPlatform();
    resources.load('config/numeric', JsonAsset, (err, asset) => {
      if (!err && asset && asset.json) this.config = normalizeConfig(asset.json);
      this.boot();
    });
  }

  private boot(): void {
    this.session = new GameSession({
      config: this.config,
      storage: this.platform.storage,
      clock: () => performance.now() / 1000
    });
    this.session.sink = {
      emit: (event, props) => {
        this.counter.emit(event, props);
        this.onGameEvent(event, props);
      }
    };

    const vis = view.getVisibleSize();
    this.buildBackground(vis.width, vis.height);
    this.baseY = -vis.height / 2 + vis.height * 0.3;
    this.buildWorld();
    this.buildCharacter();
    this.buildHud(vis.width, vis.height);
    this.homePanel = this.buildHomePanel(vis.width, vis.height);
    this.pausePanel = this.buildPausePanel(vis.width, vis.height);
    this.overPanel = this.buildOverPanel(vis.width, vis.height);
    this.tutorialNode = this.buildTutorial(vis.width, vis.height);
    this.buildToast(vis.width, vis.height);
    this.inputLayer = this.buildInputLayer(vis.width, vis.height);

    this.platform.lifecycle.onHide(() => this.session.handleHide());
    this.platform.audio.preload(['charge', 'jump', 'land', 'perfect', 'milestone', 'fall', 'ui']);

    this.exposeDebugHook();
  }

  // ---------- 输入 ----------
  private bindInput(layer: Node): void {
    layer.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
      if (this.touchId !== null) return; // 多点触控只取第一指
      this.touchId = e.getID();
      if (this.session.pressDown()) this.platform.audio.play('charge');
    }, this);
    const release = (e: EventTouch) => {
      if (this.touchId === null || e.getID() !== this.touchId) return;
      this.touchId = null;
      this.session.pressUp();
    };
    layer.on(Node.EventType.TOUCH_END, release, this);
    layer.on(Node.EventType.TOUCH_CANCEL, release, this);
  }

  // ---------- 构建 ----------
  private buildBackground(w: number, h: number): void {
    const node = this.newNode('bg', this.node);
    const g = node.addComponent(Graphics);
    g.fillColor = COL_BG;
    g.rect(-w / 2, -h / 2, w, h);
    g.fill();
  }

  private buildWorld(): void {
    this.worldNode = this.newNode('world', this.node);
    // 目标台高亮光标（跟随当前目标台移动，update 中重绘）
    this.targetMarker = this.newNode('targetMarker', this.worldNode);
    this.markerGfx = this.targetMarker.addComponent(Graphics);
  }

  private buildCharacter(): void {
    this.charNode = this.newNode('character', this.node);
    const gfx = this.charNode.addComponent(Graphics);
    gfx.fillColor = COL_CHAR;
    gfx.circle(0, 26, 26);
    gfx.fill();
  }

  private buildHud(w: number, h: number): void {
    const hud = this.newNode('hud', this.node);
    this.size(hud, w, h);
    this.scoreLabel = this.makeLabel(hud, '得分 0', 64, COL_TEXT, 0, h / 2 - 160);
    this.comboLabel = this.makeLabel(hud, '', 40, COL_ACCENT, 0, h / 2 - 226);
    this.bestLabel = this.makeLabel(hud, '', 28, COL_SUBTLE, 0, h / 2 - 272);
    this.pauseBtn = this.makeButton(hud, '暂停', 140, 88, () => {
      if (this.session.state === 'playing') this.session.pause();
    }, 'pause');
    this.pauseBtn.setPosition(-w / 2 + 108, h / 2 - 130);
    // 蓄力条（H2 返工）：固定屏幕底部居中，宽度 ≥ 可见屏宽 60%
    this.chargeBarWidth = Math.max(w * 0.66, 320);
    this.chargeBarNode = this.newNode('chargeBar', hud);
    this.chargeBarNode.setPosition(0, -h / 2 + 120);
    this.chargeFillGfx = this.chargeBarNode.addComponent(Graphics);
  }

  private buildHomePanel(w: number, h: number): Node {
    const panel = this.makePanel('homePanel', w, h);
    this.makeLabel(panel, '节气跳跳', 84, COL_ACCENT, 0, h * 0.16);
    this.makeLabel(panel, '灰盒原型 v0.1', 32, COL_TEXT, 0, h * 0.16 - 70);
    this.makeLabel(panel, '按住蓄力，松手起跳', 36, COL_TEXT, 0, h * 0.16 - 140);
    this.makeLabel(panel, '越靠近石面中心分越高', 36, COL_TEXT, 0, h * 0.16 - 195);
    this.makeLabel(panel, `最高 ${this.session.best} · 已玩 ${this.session.games} 局`, 30, COL_SUBTLE, 0, -h * 0.05);
    this.makeButton(panel, '开始游戏', 420, 132, () => this.uiAction('home.start', () => this.session.start()), 'home.start').setPosition(0, -h * 0.14);
    this.makeButton(panel, this.soundText(), 320, 96, () => this.uiAction('home.sound', () => this.session.toggleSound()), 'home.sound').setPosition(0, -h * 0.14 - 160);
    this.makeButton(panel, this.hapticsText(), 320, 96, () => this.uiAction('home.haptics', () => this.session.toggleHaptics()), 'home.haptics').setPosition(0, -h * 0.14 - 286);
    return panel;
  }

  private buildPausePanel(w: number, h: number): Node {
    const panel = this.makePanel('pausePanel', w, h);
    this.makeLabel(panel, '已暂停', 72, COL_TEXT, 0, h * 0.18);
    this.makeButton(panel, '继续', 420, 128, () => this.uiAction('pause.resume', () => this.session.resume()), 'pause.resume').setPosition(0, -h * 0.02);
    this.makeButton(panel, '重开一局', 420, 128, () => this.uiAction('pause.restart', () => this.session.restart()), 'pause.restart').setPosition(0, -h * 0.02 - 160);
    this.makeButton(panel, '回首页', 420, 128, () => this.uiAction('pause.home', () => this.session.toHome()), 'pause.home').setPosition(0, -h * 0.02 - 320);
    this.makeButton(panel, this.soundText(), 320, 96, () => this.uiAction('pause.sound', () => this.session.toggleSound()), 'pause.sound').setPosition(0, -h * 0.02 - 480);
    return panel;
  }

  private buildOverPanel(w: number, h: number): Node {
    const panel = this.makePanel('overPanel', w, h);
    this.makeLabel(panel, '坠落', 72, COL_TEXT, 0, h * 0.2);
    this.overScoreLabel = this.makeLabel(panel, '', 56, COL_ACCENT, 0, h * 0.2 - 110);
    this.overDistLabel = this.makeLabel(panel, '', 38, COL_TEXT, 0, h * 0.2 - 196);
    this.makeLabel(panel, '（距离可校准：按住越久跳越远）', 26, COL_SUBTLE, 0, h * 0.2 - 246);
    this.overBestLabel = this.makeLabel(panel, '', 36, COL_TEXT, 0, h * 0.2 - 300);
    this.makeButton(panel, '再来一局', 420, 132, () => this.uiAction('over.restart', () => this.session.restart()), 'over.restart').setPosition(0, -h * 0.1);
    this.makeButton(panel, '回首页', 420, 112, () => this.uiAction('over.home', () => this.session.toHome()), 'over.home').setPosition(0, -h * 0.1 - 160);
    return panel;
  }

  private buildTutorial(w: number, h: number): Node {
    const node = this.newNode('tutorial', this.node);
    this.size(node, w, h);
    const g = node.addComponent(Graphics);
    g.fillColor = new Color(0, 0, 0, 96);
    g.rect(-w / 2, -h / 2, w, h);
    g.fill();
    this.tutorialLabel = this.makeLabel(node, '', 42, COL_TEXT, 0, -h * 0.18);
    const skip = this.makeButton(node, '跳过', 200, 84, () => this.uiAction('tutorial.skip', () => this.session.skipTutorial()), 'tutorial.skip');
    skip.setPosition(w / 2 - 150, h / 2 - 360);
    return node;
  }

  private buildToast(w: number, h: number): void {
    this.toastNode = this.newNode('toast', this.node);
    this.toastLabel = this.makeLabel(this.toastNode, '', 56, COL_ACCENT, 0, h * 0.24);
    this.toastOpacity = this.toastNode.addComponent(UIOpacity);
    this.toastOpacity.opacity = 0;
  }

  private buildInputLayer(w: number, h: number): Node {
    const layer = this.newNode('inputLayer', this.node);
    this.size(layer, w, h);
    layer.setSiblingIndex(0);
    this.bindInput(layer);
    return layer;
  }

  private makePanel(name: string, w: number, h: number): Node {
    const panel = this.newNode(name, this.node);
    this.size(panel, w, h);
    const g = panel.addComponent(Graphics);
    g.fillColor = COL_PANEL;
    g.rect(-w / 2, -h / 2, w, h);
    g.fill();
    return panel;
  }

  private makeLabel(parent: Node, text: string, fontSize: number, color: Color, x: number, y: number): Label {
    const node = this.newNode('label', parent);
    node.setPosition(x, y);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.round(fontSize * 1.25);
    label.color = color;
    return label;
  }

  private makeButton(parent: Node, text: string, w: number, h: number, onTap: () => void, name: string): Node {
    const node = this.newNode(`btn_${name}`, parent);
    this.size(node, w, h);
    const g = node.addComponent(Graphics);
    g.fillColor = COL_BTN;
    g.roundRect(-w / 2, -h / 2, w, h, 14);
    g.fill();
    const label = this.makeLabel(node, text, Math.round(h * 0.42), COL_TEXT, 0, 0);
    node.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      e.propagationStopped = true;
      onTap();
    }, this);
    this.buttons[name] = { node, label, w, h };
    return node;
  }

  private newNode(name: string, parent: Node): Node {
    const node = new Node(name);
    node.layer = UI_2D;
    node.addComponent(UITransform);
    parent.addChild(node);
    return node;
  }

  private size(node: Node, w: number, h: number): void {
    node.getComponent(UITransform)!.setContentSize(w, h);
  }

  // ---------- UI 动作与音效 ----------
  private uiAction(name: string, action: () => void): void {
    this.platform.audio.play('ui');
    action();
    if (name.endsWith('.sound') || name.endsWith('.haptics')) this.refreshToggleTexts();
  }

  private soundText(): string {
    return this.session && !this.session.sound ? '音效：关' : '音效：开';
  }

  private hapticsText(): string {
    return this.session && !this.session.haptics ? '振动：关' : '振动：开';
  }

  private refreshToggleTexts(): void {
    const map: Array<[string, string]> = [
      ['home.sound', this.soundText()],
      ['pause.sound', this.soundText()],
      ['home.haptics', this.hapticsText()]
    ];
    for (const [key, text] of map) {
      const ref = this.buttons[key];
      if (ref) ref.label.string = text;
    }
  }

  private onGameEvent(event: string, props?: EventProps): void {
    if (event === 'jump') {
      const dist = Number(props?.distance ?? 0);
      const snap = this.session.snapshot();
      this.jump = { startX: snap.standX, endX: snap.standX + dist, t: 0, dur: this.config.jump.durationSec, fall: false };
      this.platform.audio.play('jump');
    } else if (event === 'perfect') {
      this.lastOutcome = { verdict: 'perfect', offset: Number(props?.offset ?? 0), points: Number(props?.points ?? 0) };
      this.showToast(`PERFECT +${props?.points ?? 0}`);
      this.platform.audio.play('perfect');
      if (this.session.haptics) this.platform.device.vibrateShort();
    } else if (event === 'stumble') {
      this.shakeTimer = 0.4;
    } else if (event === 'combo_milestone') {
      this.showToast(`${props?.combo ?? 0} 连击！`);
      this.platform.audio.play('milestone');
    } else if (event === 'fall') {
      this.lastOutcome = { verdict: 'fall', offset: Number(props?.offset ?? 0), points: 0 };
      if (this.jump) this.jump.fall = true;
      this.platform.audio.play('fall');
    } else if (event === 'game_start') {
      this.resetViewForNewRun();
    }
  }

  private resetViewForNewRun(): void {
    this.jump = null;
    this.fallTimer = -1;
    this.drawnPlatformCount = -1;
    this.overScoreLabel.string = '';
    this.overDistLabel.string = '';
    this.overBestLabel.string = '';
    const snap = this.session.snapshot();
    this.scrollX = -150 - snap.platforms[snap.currentIndex].centerX;
    for (const child of [...this.platformNodes]) child.destroy();
    this.platformNodes = [];
  }

  private showToast(text: string): void {
    this.toastLabel.string = text;
    this.toastOpacity.opacity = 255;
    this.toastTimer = 0.9;
  }

  // ---------- 每帧渲染 ----------
  update(dt: number): void {
    if (!this.session) return;
    const s = this.session.snapshot();

    if (s.tutorialStep === 3 && !s.tutorialDone) this.session.skipTutorial();

    this.homePanel.active = s.state === 'home';
    this.pausePanel.active = s.state === 'paused';
    this.overPanel.active = s.state === 'gameover' && this.fallTimer < 0;
    this.inputLayer.active = s.state === 'playing';
    this.tutorialNode.active = s.state === 'playing' && !s.tutorialDone && s.tutorialStep < 3;
    if (this.tutorialNode.active) {
      this.tutorialLabel.string = s.tutorialStep === 1 ? '① 按住屏幕任意处蓄力' : s.tutorialStep === 2 ? '② 松手起跳' : '越靠近中心分越高';
    }

    this.scoreLabel.string = `得分 ${s.score}`;
    this.comboLabel.string = s.combo >= 2 ? `连击 x${s.combo}` : '';
    this.bestLabel.string = `最高 ${s.best}`;
    this.pauseBtn.active = s.state === 'playing';

    if (s.platforms.length > 0) {
      const targetScroll = -150 - s.platforms[s.currentIndex].centerX;
      this.scrollX += (targetScroll - this.scrollX) * Math.min(1, dt * 8);
      this.worldNode.setPosition(this.scrollX, this.baseY);

      this.syncPlatforms(s);
      this.updateTargetMarker(s);
      this.updateCharacter(s, dt);
    }

    this.drawChargeBar(s);

    if (this.toastTimer >= 0) {
      this.toastTimer -= dt;
      this.toastOpacity.opacity = Math.max(0, Math.round(255 * Math.min(1, this.toastTimer / 0.5)));
      if (this.toastTimer < 0) this.toastOpacity.opacity = 0;
    }

    if (s.state === 'gameover') {
      this.overScoreLabel.string = s.newRecord ? `新纪录！${s.score}` : `本局 ${s.score}`;
      this.overDistLabel.string = s.lastJump
        ? `本跳 ${Math.round(s.lastJump.distance)} / 目标 ${Math.round(s.lastJump.targetDist)} px`
        : '';
      this.overBestLabel.string = `最高 ${s.best} · 共 ${s.games} 局`;
    }
  }

  /** 底部大蓄力条：轨道常驻；填充随比例增长；满蓄力变红并水平抖动。 */
  private drawChargeBar(s: { state: string; chargeRatioValue: number }): void {
    const g = this.chargeFillGfx;
    g.clear();
    if (s.state !== 'playing') return;
    const W = this.chargeBarWidth;
    const H = 28;
    g.fillColor = COL_TRACK;
    g.roundRect(-W / 2, -H / 2, W, H, H / 2);
    g.fill();
    const pad = 4;
    const ratio = Math.max(0, Math.min(1, s.chargeRatioValue));
    const fw = (W - pad * 2) * ratio;
    if (fw > 2) {
      g.fillColor = ratio >= 1 ? COL_DANGER : COL_ACCENT;
      g.roundRect(-W / 2 + pad, -H / 2 + pad, fw, H - pad * 2, (H - pad * 2) / 2);
      g.fill();
    }
    const x = ratio >= 1 ? Math.sin(performance.now() / 28) * 7 : 0;
    if (x !== 0 || this.chargeBarNode.position.x !== 0) this.chargeBarNode.setPosition(x, this.chargeBarNode.position.y);
  }

  /** 目标台理想落点区高亮：呼吸闪烁的指示三角 + 与判定同源宽度的落点区带。 */
  private updateTargetMarker(s: { state: string; currentIndex: number; platforms: Array<{ centerX: number; halfWidth: number }> }): void {
    const g = this.markerGfx;
    g.clear();
    if (s.state !== 'playing') return;
    const target = s.platforms[s.currentIndex + 1];
    if (!target) return;
    const jumpNumber = s.currentIndex + 1;
    const threshold = perfectThresholdForJump(this.config, jumpNumber);
    const band = Math.min(threshold, Math.max(0, target.halfWidth - this.config.landing.safeInsetPx));
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
    this.markerColor.a = Math.round(120 + 110 * pulse);
    g.fillColor = this.markerColor;
    g.rect(-band, 2, band * 2, 10);
    g.fill();
    const top = 150 + 14 * pulse;
    g.moveTo(0, 36);
    g.lineTo(-20, top);
    g.lineTo(20, top);
    g.close();
    g.fill();
    this.targetMarker.setPosition(target.centerX, 0);
  }

  private syncPlatforms(s: { platforms: Array<{ centerX: number; halfWidth: number }> }): void {
    if (this.drawnPlatformCount !== s.platforms.length) {
      for (let i = this.drawnPlatformCount < 0 ? 0 : this.drawnPlatformCount; i < s.platforms.length; i++) {
        this.drawPlatform(s.platforms[i], i);
      }
      this.drawnPlatformCount = s.platforms.length;
    }
  }

  /** index = 台座序号；第 i 块是第 i 跳的目标，理想落点区宽度与判定阈值同源（新手跳更宽）。 */
  private drawPlatform(p: { centerX: number; halfWidth: number }, index: number): void {
    const node = this.newNode('platform', this.worldNode);
    node.setPosition(p.centerX, 0);
    const g = node.addComponent(Graphics);
    g.fillColor = COL_PLATFORM;
    g.roundRect(-p.halfWidth, -30, p.halfWidth * 2, 30, 6);
    g.fill();
    const threshold = perfectThresholdForJump(this.config, index);
    const perfectW = Math.min(threshold, Math.max(0, p.halfWidth - this.config.landing.safeInsetPx));
    g.fillColor = COL_PERFECT;
    g.rect(-perfectW, -6, perfectW * 2, 6);
    g.fill();
    this.platformNodes.push(node);
  }

  private updateCharacter(s: { state: string; standX: number; charging: boolean; chargeRatioValue: number }, dt: number): void {
    let x = s.standX;
    let y = 0;
    let scaleY = 1;
    if (this.jump && s.state === 'playing') {
      this.jump.t += dt;
      const k = Math.min(this.jump.t / this.jump.dur, 1);
      x = this.jump.startX + (this.jump.endX - this.jump.startX) * k;
      y = this.config.jump.arcHeightPx * 4 * k * (1 - k);
      if (this.jump.fall && k >= 1) {
        this.fallTimer = this.fallTimer < 0 ? this.jump.dur : this.fallTimer - dt;
        y = -((1 - Math.max(this.fallTimer, 0) / this.jump.dur) * 600);
        scaleY = 0.7;
        if (this.fallTimer < 0) {
          this.jump = null;
          this.fallTimer = -1;
        }
      } else if (!this.jump.fall && k >= 1) {
        this.jump = null;
      }
    } else if (s.charging) {
      scaleY = 1 - 0.3 * s.chargeRatioValue;
      if (s.chargeRatioValue >= 1) x += Math.sin(performance.now() / 40) * 2;
    }

    let shakeX = 0;
    if (this.shakeTimer >= 0) {
      this.shakeTimer -= dt;
      shakeX = this.shakeTimer >= 0 ? Math.sin(performance.now() / 25) * 6 * this.shakeTimer : 0;
    }

    this.charNode.setPosition(x + this.scrollX + shakeX, this.baseY + y);
    this.charNode.setScale(1, scaleY, 1);
  }

  // ---------- 调试钩子（Web 冒烟与回放用；不进任何上报通道） ----------
  private exposeDebugHook(): void {
    const self = this;
    (globalThis as unknown as Record<string, unknown>).__jieqi = {
      version: '0.2.0-prototype',
      env: self.platform.env,
      session: self.session,
      outcome: () => self.lastOutcome,
      targetInfo: () => {
        const s = self.session.snapshot();
        return { centerDist: s.targetCenterDist, halfWidth: s.targetHalfWidth, standX: s.standX };
      },
      buttonPagePos: (name: string) => self.buttonPagePos(name),
      recentEvents: () => self.counter.log.slice(-40).map(e => `${e.event}:${JSON.stringify(e.props ?? {})}`)
    };
  }

  /** 按钮设计坐标 → 页面像素坐标（供自动化点击）。 */
  private buttonPagePos(name: string): { x: number; y: number; w: number; h: number } | null {
    const ref = this.buttons[name];
    if (!ref || !ref.node.activeInHierarchy) return null;
    const vis = view.getVisibleSize();
    const canvasPx = this.canvasSize();
    const ratioX = canvasPx.width / vis.width;
    const ratioY = canvasPx.height / vis.height;
    const world = ref.node.worldPosition;
    const origin = this.node.worldPosition;
    const designX = vis.width / 2 + (world.x - origin.x);
    const designY = vis.height / 2 - (world.y - origin.y);
    return { x: designX * ratioX, y: designY * ratioY, w: ref.w * ratioX, h: ref.h * ratioY };
  }

  private canvasSize(): { width: number; height: number } {
    const v = view as unknown as { getCanvasSize?: () => { width: number; height: number } };
    if (typeof v.getCanvasSize === 'function') return v.getCanvasSize();
    const g = globalThis as unknown as { innerWidth: number; innerHeight: number };
    return { width: g.innerWidth, height: g.innerHeight };
  }
}
