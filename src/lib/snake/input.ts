/** Token Snake input: keyboard, gamepad and a floating touch stick (swipes work too). Everything reports screen-space directions. */
import type { Dir } from './sim';

const KEYS: Record<string, Dir> = { ArrowRight: 0, KeyD: 0, ArrowDown: 1, KeyS: 1, ArrowLeft: 2, KeyA: 2, ArrowUp: 3, KeyW: 3 };

export type Stick = { active: boolean; ax: number; ay: number; x: number; y: number };

export class SnakeInput {
  onDir: (d: Dir) => void = () => {};
  onPause: () => void = () => {};
  onCam: () => void = () => {};
  /** Set while a run is in progress: game keys are then swallowed so the page does not scroll. */
  capture = false;
  padActive = false;
  stick: Stick = { active: false, ax: 0, ay: 0, x: 0, y: 0 };
  touchSeen = false;
  private el: HTMLElement | null = null;
  private lastStick: Dir | -1 = -1;
  private padDir: Dir | -1 = -1;
  private padPrev: boolean[] = [];
  private tid: number | null = null;

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const d = KEYS[e.code];
    if (d !== undefined) {
      if (this.capture) e.preventDefault();
      if (!e.repeat) this.onDir(d);
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      if (!e.repeat) this.onPause();
    } else if (e.code === 'KeyC') {
      if (!e.repeat) this.onCam();
    } else if (e.code === 'Space' && this.capture) e.preventDefault();
  };
  private ts = (e: TouchEvent) => {
    this.touchSeen = true;
    if ((e.target as HTMLElement | null)?.closest('button,a,input,textarea,select')) return;
    if (this.tid !== null) return;
    const t = e.changedTouches[0];
    this.tid = t.identifier;
    this.stick = { active: true, ax: t.clientX, ay: t.clientY, x: t.clientX, y: t.clientY };
    this.lastStick = -1;
  };
  private tm = (e: TouchEvent) => {
    if (this.tid === null) return;
    const t = Array.from(e.changedTouches).find((x) => x.identifier === this.tid);
    if (!t) return;
    e.preventDefault();
    const s = this.stick;
    s.x = t.clientX;
    s.y = t.clientY;
    let dx = s.x - s.ax;
    let dy = s.y - s.ay;
    const len = Math.hypot(dx, dy);
    // The stick base follows the thumb when it is dragged past its radius, so a new swipe from anywhere turns at once.
    const R = 42;
    if (len > R) {
      s.ax += (dx / len) * (len - R);
      s.ay += (dy / len) * (len - R);
      dx = s.x - s.ax;
      dy = s.y - s.ay;
    }
    if (len > 16) {
      const d: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
      if (d !== this.lastStick) {
        this.lastStick = d;
        this.onDir(d);
      }
    }
  };
  private te = (e: TouchEvent) => {
    if (this.tid === null) return;
    if (Array.from(e.changedTouches).some((x) => x.identifier === this.tid)) {
      this.tid = null;
      this.stick.active = false;
    }
  };
  private onBlur = () => {
    this.tid = null;
    this.stick.active = false;
  };

  attach(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('blur', this.onBlur);
    el.addEventListener('touchstart', this.ts, { passive: true });
    el.addEventListener('touchmove', this.tm, { passive: false });
    el.addEventListener('touchend', this.te);
    el.addEventListener('touchcancel', this.te);
  }
  detach() {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('blur', this.onBlur);
    const el = this.el;
    if (el) {
      el.removeEventListener('touchstart', this.ts);
      el.removeEventListener('touchmove', this.tm);
      el.removeEventListener('touchend', this.te);
      el.removeEventListener('touchcancel', this.te);
    }
  }

  /** Call once per frame: reads the first connected gamepad. */
  poll() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const p = Array.from(pads).find((g) => g && g.connected);
    if (!p) {
      this.padActive = false;
      return;
    }
    const b = (i: number) => !!p.buttons[i]?.pressed;
    const ax = p.axes[0] ?? 0;
    const ay = p.axes[1] ?? 0;
    let d: Dir | -1 = -1;
    if (b(15) || ax > 0.55) d = 0;
    else if (b(13) || ay > 0.55) d = 1;
    else if (b(14) || ax < -0.55) d = 2;
    else if (b(12) || ay < -0.55) d = 3;
    if (Math.abs(ax) > 0.55 && Math.abs(ay) > 0.55) d = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 0 : 2) : ay > 0 ? 1 : 3;
    if (d !== -1 && d !== this.padDir) {
      this.padActive = true;
      this.onDir(d);
    }
    this.padDir = d;
    const pressed = [b(0), b(3), b(9)];
    if (pressed[0] && !this.padPrev[0]) this.padActive = true;
    if ((pressed[2] && !this.padPrev[2]) || (pressed[0] && !this.padPrev[0] && this.capture)) this.onPause();
    if (pressed[1] && !this.padPrev[1]) this.onCam();
    this.padPrev = pressed;
  }
}
