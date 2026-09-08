/**
 * @module render/canvas-viewport
 * @description 画布的拖拽平移 + 滚轮缩放 + 触控 pan + pinch 缩放
 *
 * 触摸端关键约束：tap 不能 preventDefault，否则浏览器不再派发 click，
 * 节点的选中逻辑会全部失效。因此单指只有位移超过阈值后才进入 pan 并拦截默认行为
 */

interface ViewportState {
  tx: number;
  ty: number;
  scale: number;
}

const SCALE_MIN = 0.1;
const SCALE_MAX = 8;
/** 每次滚轮 deltaY 对应的缩放步长 */
const WHEEL_STEP = 0.0015;
/** 单指位移超过该值（像素）才视为拖拽，否则保留为 tap */
const PAN_START_PX = 8;

interface Point {
  x: number;
  y: number;
}

export class CanvasViewport {
  private state: ViewportState = { tx: 0, ty: 0, scale: 1 };
  private holder: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private stateStartX = 0;
  private stateStartY = 0;

  /** 当前跟踪的触控点：id 到视口坐标 */
  private activeTouches = new Map<number, Point>();
  /** 单指按下位置，用于判断位移阈值 */
  private touchStart: Point | null = null;
  /** 单指 pan 是否已确认（越过阈值） */
  private touchPanning = false;
  /** 单指 pan 起始状态 */
  private oneFingerPan: { startX: number; startY: number; stateTx: number; stateTy: number } | null = null;
  /** 双指 pinch 起始状态 */
  private twoFingerPinch: null | {
    startDist: number;
    startScale: number;
    /** pinch 中心点（相对 body） */
    centerX: number;
    centerY: number;
  } = null;

  private readonly boundMouseDown = (e: MouseEvent): void => this.onMouseDown(e);
  private readonly boundMouseMove = (e: MouseEvent): void => this.onMouseMove(e);
  private readonly boundMouseUp = (e: MouseEvent): void => this.onMouseUp(e);
  private readonly boundWheel = (e: WheelEvent): void => this.onWheel(e);
  private readonly boundContextMenu = (e: MouseEvent): void => {
    // 画布上右键是 pan 的备用触发器，阻止默认菜单
    e.preventDefault();
  };

  private readonly boundTouchStart = (e: TouchEvent): void => this.onTouchStart(e);
  private readonly boundTouchMove = (e: TouchEvent): void => this.onTouchMove(e);
  private readonly boundTouchEnd = (e: TouchEvent): void => this.onTouchEnd(e);
  private readonly boundTouchCancel = (e: TouchEvent): void => this.onTouchEnd(e);

  attach(body: HTMLElement, holder: HTMLElement): void {
    this.detach();
    this.body = body;
    this.holder = holder;
    body.addEventListener('mousedown', this.boundMouseDown);
    body.addEventListener('wheel', this.boundWheel, { passive: false });
    body.addEventListener('contextmenu', this.boundContextMenu);

    body.addEventListener('touchstart', this.boundTouchStart, { passive: false });
    body.addEventListener('touchmove', this.boundTouchMove, { passive: false });
    body.addEventListener('touchend', this.boundTouchEnd, { passive: false });
    body.addEventListener('touchcancel', this.boundTouchCancel, { passive: false });

    // 全局监听 move / up，避免在 body 外松开导致状态卡住
    window.addEventListener('mousemove', this.boundMouseMove);
    window.addEventListener('mouseup', this.boundMouseUp);
    this.apply();
  }

  detach(): void {
    if (this.body) {
      this.body.removeEventListener('mousedown', this.boundMouseDown);
      this.body.removeEventListener('wheel', this.boundWheel);
      this.body.removeEventListener('contextmenu', this.boundContextMenu);
      this.body.removeEventListener('touchstart', this.boundTouchStart);
      this.body.removeEventListener('touchmove', this.boundTouchMove);
      this.body.removeEventListener('touchend', this.boundTouchEnd);
      this.body.removeEventListener('touchcancel', this.boundTouchCancel);
    }
    window.removeEventListener('mousemove', this.boundMouseMove);
    window.removeEventListener('mouseup', this.boundMouseUp);
    this.body = null;
    this.holder = null;
    this.isPanning = false;
    this.activeTouches.clear();
    this.touchStart = null;
    this.touchPanning = false;
    this.oneFingerPan = null;
    this.twoFingerPinch = null;
  }

  reset(): void {
    this.state = { tx: 0, ty: 0, scale: 1 };
    this.oneFingerPan = null;
    this.twoFingerPinch = null;
    this.apply();
  }

  private apply(): void {
    if (!this.holder) return;
    const { tx, ty, scale } = this.state;
    this.holder.style.transformOrigin = '0 0';
    this.holder.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }

  // ---------- 鼠标

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0 && e.button !== 1) return;
    if (!this.body) return;
    this.isPanning = true;
    this.panStartX = e.clientX;
    this.panStartY = e.clientY;
    this.stateStartX = this.state.tx;
    this.stateStartY = this.state.ty;
    this.body.classList.add('is-panning');
    e.preventDefault();
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.isPanning) return;
    const dx = e.clientX - this.panStartX;
    const dy = e.clientY - this.panStartY;
    this.state.tx = this.stateStartX + dx;
    this.state.ty = this.stateStartY + dy;
    this.apply();
  }

  private onMouseUp(_e: MouseEvent): void {
    if (!this.isPanning) return;
    this.isPanning = false;
    this.body?.classList.remove('is-panning');
  }

  private onWheel(e: WheelEvent): void {
    if (!this.body || !this.holder) return;
    e.preventDefault();
    const rect = this.body.getBoundingClientRect();
    this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, this.state.scale * (1 - e.deltaY * WHEEL_STEP));
  }

  // ---------- 触控

  private onTouchStart(e: TouchEvent): void {
    if (!this.body) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      this.activeTouches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }

    const touches = [...this.activeTouches.values()];
    if (touches.length >= 2) {
      // 双指手势浏览器必须交给我们接管，否则会触发页面缩放
      e.preventDefault();
      this.touchPanning = false;
      this.oneFingerPan = null;
      this.beginPinch(touches);
      this.body.classList.add('is-panning');
    } else if (touches.length === 1) {
      // 记录起点但不要 preventDefault：tap 需要靠后续 click 派发到节点
      this.touchStart = { x: touches[0].x, y: touches[0].y };
      this.touchPanning = false;
    }
  }

  private onTouchMove(e: TouchEvent): void {
    if (!this.body) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const existing = this.activeTouches.get(touch.identifier);
      if (existing) {
        existing.x = touch.clientX;
        existing.y = touch.clientY;
      }
    }

    const touches = [...this.activeTouches.values()];
    if (touches.length >= 2 && this.twoFingerPinch) {
      e.preventDefault();
      this.updatePinch(touches);
      return;
    }

    if (touches.length === 1 && !this.twoFingerPinch) {
      const t = touches[0];
      if (!this.touchPanning && this.touchStart
        && Math.hypot(t.x - this.touchStart.x, t.y - this.touchStart.y) > PAN_START_PX) {
        // 越过阈值才确认为拖拽，之后才拦截默认行为
        this.touchPanning = true;
        this.oneFingerPan = {
          startX: t.x,
          startY: t.y,
          stateTx: this.state.tx,
          stateTy: this.state.ty,
        };
        this.body.classList.add('is-panning');
      }
      if (this.touchPanning && this.oneFingerPan) {
        e.preventDefault();
        this.state.tx = this.oneFingerPan.stateTx + t.x - this.oneFingerPan.startX;
        this.state.ty = this.oneFingerPan.stateTy + t.y - this.oneFingerPan.startY;
        this.apply();
      }
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    if (!this.body) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      this.activeTouches.delete(e.changedTouches[i].identifier);
    }

    const touches = [...this.activeTouches.values()];
    if (touches.length === 0) {
      this.body.classList.remove('is-panning');
      this.touchStart = null;
      this.touchPanning = false;
      this.oneFingerPan = null;
      this.twoFingerPinch = null;
    } else if (touches.length === 1) {
      // pinch 剩一指：以剩余手指为起点重新判定 pan
      this.twoFingerPinch = null;
      this.touchStart = { x: touches[0].x, y: touches[0].y };
      this.touchPanning = false;
    }
  }

  // ---------- 缩放

  private beginPinch(touches: Point[]): void {
    if (!this.body) return;
    const [a, b] = touches;
    const rect = this.body.getBoundingClientRect();
    this.twoFingerPinch = {
      startDist: Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1),
      startScale: this.state.scale,
      centerX: (a.x + b.x) / 2 - rect.left,
      centerY: (a.y + b.y) / 2 - rect.top,
    };
  }

  private updatePinch(touches: Point[]): void {
    if (!this.twoFingerPinch) return;
    const [a, b] = touches;
    const dist = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
    this.zoomAt(this.twoFingerPinch.centerX, this.twoFingerPinch.centerY,
      this.twoFingerPinch.startScale * (dist / this.twoFingerPinch.startDist));
  }

  /** 以 body 内坐标 (mx, my) 为中心缩放到 newScale */
  private zoomAt(mx: number, my: number, targetScale: number): void {
    const newScale = Math.min(Math.max(targetScale, SCALE_MIN), SCALE_MAX);
    const oldScale = this.state.scale;
    if (newScale === oldScale) return;
    const worldX = (mx - this.state.tx) / oldScale;
    const worldY = (my - this.state.ty) / oldScale;
    this.state.tx = mx - worldX * newScale;
    this.state.ty = my - worldY * newScale;
    this.state.scale = newScale;
    this.apply();
  }
}
