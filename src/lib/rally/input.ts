/** Keyboard + gamepad + on-screen touch controls, merged into one CarInput per frame. */
import type { CarInput } from './car';

export type Touch = { left: boolean; right: boolean; gas: boolean; brake: boolean; hand: boolean; nitro: boolean };
export const newTouch = (): Touch => ({ left: false, right: false, gas: false, brake: false, hand: false, nitro: false });

export type Edges = { reset: boolean; cam: boolean; pause: boolean; start: boolean };

const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'KeyR', 'KeyC', 'KeyN']);

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private padPrev: boolean[] = [];
  touch: Touch = newTouch();
  padActive = false;
  /** Only swallow game keys (arrows, space) while a run is on screen, so the page still scrolls in menus. */
  capture = false;
  /** Gamepad analog steer shown in the UI hint. */
  private onDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.capture && GAME_KEYS.has(e.code)) e.preventDefault();
    if (!this.keys.has(e.code)) this.pressed.add(e.code);
    this.keys.add(e.code);
  };
  private onUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
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
  private key(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }
  /** Reads this frame's input. Edge flags fire once per press. */
  read(): { car: CarInput; edges: Edges } {
    let steer = (this.key('ArrowLeft', 'KeyA') ? 1 : 0) - (this.key('ArrowRight', 'KeyD') ? 1 : 0);
    let throttle = this.key('ArrowUp', 'KeyW') ? 1 : 0;
    let brake = this.key('ArrowDown', 'KeyS') ? 1 : 0;
    let hand = this.key('Space');
    let nitro = this.key('ShiftLeft', 'ShiftRight', 'KeyN');
    const edges: Edges = {
      reset: this.pressed.has('KeyR'),
      cam: this.pressed.has('KeyC'),
      pause: this.pressed.has('KeyP') || this.pressed.has('Escape'),
      start: this.pressed.has('Enter'),
    };
    this.pressed.clear();
    // Touch.
    const t = this.touch;
    if (t.left || t.right) steer = (t.left ? 1 : 0) - (t.right ? 1 : 0);
    if (t.gas) throttle = 1;
    if (t.brake) brake = 1;
    if (t.hand) hand = true;
    if (t.nitro) nitro = true;
    // Gamepad.
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    if (pad) {
      const dead = (v: number) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const ax = dead(pad.axes[0] ?? 0);
      const btn = (i: number) => pad.buttons[i]?.pressed ?? false;
      const val = (i: number) => pad.buttons[i]?.value ?? 0;
      if (ax !== 0) steer = -ax;
      else if (btn(14) || btn(15)) steer = btn(14) ? 1 : -1;
      const rt = val(7);
      const lt = val(6);
      if (rt > 0.05) throttle = Math.max(throttle, rt);
      if (lt > 0.05) brake = Math.max(brake, lt);
      if (btn(0) || btn(1)) hand = true;
      if (btn(5) || btn(2)) nitro = true;
      const cur = [btn(3), btn(4), btn(9), btn(0), btn(8)];
      const was = this.padPrev;
      if (cur[0] && !was[0]) edges.reset = true;
      if (cur[1] && !was[1]) edges.cam = true;
      if (cur[2] && !was[2]) edges.pause = true;
      if (cur[3] && !was[3]) edges.start = true;
      this.padPrev = cur;
      if (ax !== 0 || rt > 0.05 || lt > 0.05 || cur.some(Boolean)) this.padActive = true;
    }
    return { car: { throttle, brake, steer, hand, nitro }, edges };
  }
}
