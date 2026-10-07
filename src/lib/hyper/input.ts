/** Keyboard + gamepad + on-screen touch, merged into one SimInput per frame. */
import type { SimInput } from './sim';

export type Touch = { left: boolean; right: boolean; brake: boolean; boost: boolean; airL: boolean; airR: boolean; fire: boolean; roll: boolean };
export const newTouch = (): Touch => ({ left: false, right: false, brake: false, boost: false, airL: false, airR: false, fire: false, roll: false });
export type Edges = { fire: boolean; cam: boolean; pause: boolean; start: boolean };

const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'KeyQ', 'KeyE', 'KeyZ', 'KeyX', 'KeyF', 'KeyC']);

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private padPrev: boolean[] = [];
  touch: Touch = newTouch();
  padActive = false;
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
  private edge(...c: string[]) {
    return c.some((k) => this.pressed.has(k));
  }
  /** `touchDevice`: throttle is automatic (hands are busy steering). */
  read(touchDevice: boolean): { inp: SimInput; edges: Edges } {
    let steer = (this.key('ArrowRight', 'KeyD') ? 1 : 0) - (this.key('ArrowLeft', 'KeyA') ? 1 : 0);
    let throttle = this.key('ArrowUp', 'KeyW') ? 1 : 0;
    let brake = this.key('ArrowDown', 'KeyS') ? 1 : 0;
    let airL = this.key('KeyQ');
    let airR = this.key('KeyE');
    let boost = this.key('ShiftLeft', 'ShiftRight');
    let rollL = this.edge('KeyZ');
    let rollR = this.edge('KeyX');
    const edges: Edges = { fire: this.edge('Space', 'KeyF'), cam: this.edge('KeyC'), pause: this.edge('KeyP', 'Escape'), start: this.edge('Enter') };
    const t = this.touch;
    if (t.left || t.right) steer = (t.right ? 1 : 0) - (t.left ? 1 : 0);
    if (t.brake) brake = 1;
    if (t.airL) airL = true;
    if (t.airR) airR = true;
    if (t.boost) boost = true;
    if (t.fire) {
      edges.fire = true;
      t.fire = false;
    }
    if (t.roll) {
      if (steer >= 0) rollR = true;
      else rollL = true;
      t.roll = false;
    }
    if (touchDevice) throttle = 1;
    this.pressed.clear();
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    if (pad) {
      const dead = (v: number) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const ax = dead(pad.axes[0] ?? 0);
      const btn = (i: number) => pad.buttons[i]?.pressed ?? false;
      const val = (i: number) => pad.buttons[i]?.value ?? 0;
      if (ax !== 0) steer = ax;
      else if (btn(14) || btn(15)) steer = btn(15) ? 1 : -1;
      const rt = val(7);
      const lt = val(6);
      if (rt > 0.05) throttle = Math.max(throttle, rt);
      if (lt > 0.05) brake = Math.max(brake, lt);
      if (btn(4)) airL = true;
      if (btn(5)) airR = true;
      if (btn(0)) boost = true;
      const cur = [btn(3), btn(8), btn(9), btn(2), btn(1), btn(0)];
      const was = this.padPrev;
      if (cur[0] && !was[0]) edges.fire = true;
      if (cur[1] && !was[1]) edges.cam = true;
      if (cur[2] && !was[2]) edges.pause = true;
      if (cur[3] && !was[3]) rollL = true;
      if (cur[4] && !was[4]) rollR = true;
      if (cur[5] && !was[5]) edges.start = true;
      this.padPrev = cur;
      if (ax !== 0 || rt > 0.05 || lt > 0.05 || cur.some(Boolean)) this.padActive = true;
    }
    return { inp: { throttle, brake, steer, airL, airR, boost, rollL, rollR }, edges };
  }
}
