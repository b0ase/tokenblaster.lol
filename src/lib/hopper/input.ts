/** Keyboard, gamepad and on-screen touch merged into one input per step. */
import type { SimInput } from './sim';

export type Touch = { left: boolean; right: boolean; jump: boolean; dash: boolean };
export const newTouch = (): Touch => ({ left: false, right: false, jump: false, dash: false });
export type Edges = { pause: boolean; start: boolean };

const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'KeyZ', 'KeyX', 'KeyK', 'KeyJ']);

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private padPrev: boolean[] = [];
  touch: Touch = newTouch();
  padActive = false;
  /** While true, game keys are swallowed so the page doesn't scroll. */
  capture = false;
  private onDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.capture && GAME_KEYS.has(e.code)) e.preventDefault();
    if (!this.keys.has(e.code)) this.pressed.add(e.code);
    this.keys.add(e.code);
  };
  private onUp = (e: KeyboardEvent) => void this.keys.delete(e.code);
  private onBlur = () => {
    this.keys.clear();
    this.touch = newTouch();
  };
  attach() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }
  detach() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
  private key(...c: string[]) {
    return c.some((k) => this.keys.has(k));
  }
  read(): { inp: SimInput; edges: Edges } {
    let x = (this.key('ArrowRight', 'KeyD') ? 1 : 0) - (this.key('ArrowLeft', 'KeyA') ? 1 : 0);
    let jump = this.key('Space', 'ArrowUp', 'KeyW', 'KeyZ', 'KeyJ');
    let dash = this.key('ShiftLeft', 'ShiftRight', 'KeyX', 'KeyK');
    const edges: Edges = { pause: ['KeyP', 'Escape'].some((k) => this.pressed.has(k)), start: ['Enter', 'Space'].some((k) => this.pressed.has(k)) };
    const t = this.touch;
    if (t.left || t.right) x = (t.right ? 1 : 0) - (t.left ? 1 : 0);
    if (t.jump) jump = true;
    if (t.dash) dash = true;
    this.pressed.clear();
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const btn = (i: number) => pad.buttons[i]?.pressed ?? false;
      if (Math.abs(ax) > 0.2) x = Math.sign(ax) * Math.min(1, (Math.abs(ax) - 0.2) / 0.7);
      else if (btn(14) || btn(15)) x = btn(15) ? 1 : -1;
      if (btn(0) || btn(12)) jump = true;
      if (btn(2) || btn(1) || btn(5) || btn(7)) dash = true;
      const start = btn(9);
      if (start && !this.padPrev[0]) edges.pause = true;
      if (btn(0) && !this.padPrev[1]) edges.start = true;
      this.padPrev = [start, btn(0)];
      if (Math.abs(ax) > 0.2 || btn(0) || btn(2)) this.padActive = true;
    }
    return { inp: { x, jump, dash }, edges };
  }
}
