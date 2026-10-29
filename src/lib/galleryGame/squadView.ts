import * as THREE from 'three';
import type { Mate } from './squad';
import { loadSquadBodies, type GirlBody, type Move } from './squadBodies';

/**
 * The AI squad on screen: each girl as a standing billboard of her NPG portrait (placeholder until the 3D
 * girls land; `setBody` swaps one in) with her name, a small "AI" tag and a health bar above her head.
 * Labels redraw only when what they show changes. Lite: smaller label textures, no shadows of any kind.
 */
type View = { g: THREE.Group; body: THREE.Sprite; label: THREE.Sprite; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; key: string; mat: THREE.SpriteMaterial; model?: GirlBody; px: number; pz: number; yaw: number; sp: number; mv: Move };

const BODY_H = 1.75;

export class SquadView {
  readonly group = new THREE.Group();
  private views = new Map<string, View>();
  private loader = new THREE.TextureLoader();
  private gone = false;
  private lastT = -1;

  constructor(
    scene: THREE.Scene,
    mates: Mate[],
    private opts: { lite: boolean; img: (id: string) => string },
  ) {
    this.group.name = 'npg-squad';
    scene.add(this.group);
    for (const m of mates) this.add(m);
    // desktop: swap the billboards for the rigged 3D NPG girls (squadBodies.ts) once they load; lite keeps billboards
    if (!opts.lite)
      void loadSquadBodies(mates.map((m) => m.id))
        .then((bodies) => {
          if (this.gone) return;
          for (const [id, o] of bodies) this.setBody(id, o);
        })
        .catch(() => undefined);
  }

  private add(m: Mate) {
    const g = new THREE.Group();
    g.name = `squad-${m.id}`;
    const mat = new THREE.SpriteMaterial({ color: '#ffffff', transparent: true, depthWrite: false });
    const tex = this.loader.load(this.opts.img(m.id), (t) => {
      // keep the portrait's own aspect ratio
      const im = t.image as { width: number; height: number } | undefined;
      if (im?.width && im.height) body.scale.set(BODY_H * (im.width / im.height), BODY_H, 1);
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    mat.map = tex;
    const body = new THREE.Sprite(mat);
    body.center.set(0.5, 0);
    body.scale.set(BODY_H * 0.75, BODY_H, 1);
    g.add(body);
    const W = this.opts.lite ? 192 : 256;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = W / 4;
    const ctx = cv.getContext('2d')!;
    const lt = new THREE.CanvasTexture(cv);
    lt.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt, transparent: true, depthWrite: false, depthTest: false }));
    label.center.set(0.5, 0);
    label.scale.set(1.6, 0.4, 1);
    label.position.y = BODY_H + 0.15;
    label.renderOrder = 5;
    g.add(label);
    this.group.add(g);
    this.views.set(m.id, { g, body, label, ctx, tex: lt, key: '', mat, px: m.x, pz: m.z, yaw: m.yaw, sp: 0, mv: 'idle' });
  }

  /** Swap a girl's placeholder billboard for a real body (the 3D NPG girls, when they are in). */
  setBody(id: string, body: GirlBody) {
    const v = this.views.get(id);
    if (!v) return body.dispose();
    v.model?.dispose();
    v.body.visible = false;
    v.model = body;
    v.g.add(body.root);
  }

  private paint(v: View, m: Mate) {
    const hpK = m.hpMax ? m.hp / m.hpMax : 0;
    const key = `${m.state === 'downed' ? Math.ceil(m.downT) : 'u'}|${Math.round(hpK * 20)}`;
    if (key === v.key) return;
    v.key = key;
    const c = v.ctx;
    const W = c.canvas.width;
    const H = c.canvas.height;
    c.clearRect(0, 0, W, H);
    const f = Math.round(H * 0.42);
    c.font = `800 ${f}px system-ui, sans-serif`;
    c.textBaseline = 'middle';
    const name = m.name.toUpperCase();
    const tagW = f * 1.5;
    const nw = c.measureText(name).width;
    const x0 = (W - (nw + tagW + 8)) / 2;
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(x0 - 6, 2, nw + tagW + 20, f + 8);
    c.fillStyle = m.state === 'downed' ? '#ff6b6b' : '#ffffff';
    c.fillText(name, x0, 6 + f / 2);
    c.fillStyle = '#ff2bd6';
    c.fillRect(x0 + nw + 8, 6, tagW, f);
    c.fillStyle = '#ffffff';
    c.font = `900 ${Math.round(f * 0.7)}px system-ui, sans-serif`;
    c.fillText('AI', x0 + nw + 8 + tagW * 0.2, 6 + f / 2);
    const by = f + 16;
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(W * 0.2, by, W * 0.6, H * 0.14);
    if (m.state === 'downed') {
      c.fillStyle = '#ff6b6b';
      c.font = `800 ${Math.round(f * 0.6)}px system-ui, sans-serif`;
      c.fillText(`DOWN ${Math.ceil(m.downT)}s`, W * 0.36, by + H * 0.07);
    } else {
      c.fillStyle = hpK > 0.5 ? '#3cff9a' : hpK > 0.25 ? '#ffd24a' : '#ff4a3a';
      c.fillRect(W * 0.2, by, W * 0.6 * hpK, H * 0.14);
    }
    v.tex.needsUpdate = true;
  }

  update(mates: Mate[], t: number) {
    const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    for (const m of mates) {
      const v = this.views.get(m.id);
      if (!v) continue;
      const down = m.state === 'downed';
      // The squad AI steps at 30 Hz (10 Hz on lite) while we draw every frame: follow its positions smoothly
      // instead of snapping, or the girls stutter and their run clip flickers idle/jog on every other frame.
      const jump = (m.x - v.px) ** 2 + (m.z - v.pz) ** 2 > 64; // a respawn or a new run: snap, don't glide
      const k = dt > 0 && !jump ? 1 - Math.exp(-dt * 12) : 1;
      const nx = v.px + (m.x - v.px) * k;
      const nz = v.pz + (m.z - v.pz) * k;
      const inst = dt > 0 && !jump ? Math.hypot(nx - v.px, nz - v.pz) / dt : 0;
      v.sp += (inst - v.sp) * (dt > 0 ? 1 - Math.exp(-dt * 6) : 0);
      v.px = nx;
      v.pz = nz;
      v.g.position.set(nx, 0, nz);
      // downed: she drops to a knee (sunk, greyed); up: a light bob on the move
      v.body.position.y = down ? -0.7 : Math.abs(Math.sin(t * 6 + m.phase)) * 0.04;
      v.mat.color.set(down ? '#6a6a7a' : '#ffffff');
      if (v.model) {
        // the 3D girl faces her target and runs, shoots or crouches with real clips
        let d = m.yaw - v.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        v.yaw += d * (dt > 0 ? 1 - Math.exp(-dt * 10) : 1);
        v.model.root.rotation.set(0, Math.PI - v.yaw, 0);
        // hysteresis so a speed near a threshold never flips the clip back and forth
        const sp = v.sp;
        const moving = v.mv === 'jog' || v.mv === 'sprint' ? sp > 0.35 : sp > 0.9;
        const fast = v.mv === 'sprint' ? sp > 3.8 : sp > 5;
        const mv: Move = down ? 'down' : moving ? (fast ? 'sprint' : 'jog') : m.state === 'engage' && m.target ? 'shoot' : 'idle';
        v.mv = mv;
        v.model.play(mv);
        v.model.update(dt);
      }
      v.label.position.y = down ? BODY_H - 0.5 : BODY_H + 0.15;
      this.paint(v, m);
    }
  }

  dispose() {
    this.gone = true;
    for (const v of this.views.values()) {
      v.model?.dispose();
      v.mat.map?.dispose();
      v.mat.dispose();
      v.tex.dispose();
      (v.label.material as THREE.SpriteMaterial).dispose();
    }
    this.group.removeFromParent();
  }
}
