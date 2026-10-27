import * as THREE from 'three';
import type { Mate } from './squad';
import { loadSquadBodies } from './squadBodies';

/**
 * The AI squad on screen: each girl as a standing billboard of her NPG portrait (placeholder until the 3D
 * girls land; `setBody` swaps one in) with her name, a small "AI" tag and a health bar above her head.
 * Labels redraw only when what they show changes. Lite: smaller label textures, no shadows of any kind.
 */
type View = { g: THREE.Group; body: THREE.Sprite; label: THREE.Sprite; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; key: string; mat: THREE.SpriteMaterial; model?: THREE.Object3D };

const BODY_H = 1.75;

export class SquadView {
  readonly group = new THREE.Group();
  private views = new Map<string, View>();
  private loader = new THREE.TextureLoader();
  private gone = false;

  constructor(
    scene: THREE.Scene,
    mates: Mate[],
    private opts: { lite: boolean; img: (id: string) => string },
  ) {
    this.group.name = 'npg-squad';
    scene.add(this.group);
    for (const m of mates) this.add(m);
    // desktop: swap the billboards for the 3D NPG girls (#137 models) once they load; lite keeps billboards
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
    this.views.set(m.id, { g, body, label, ctx, tex: lt, key: '', mat });
  }

  /** Swap a girl's placeholder billboard for a real body (the 3D NPG girls, when they are in). */
  setBody(id: string, obj: THREE.Object3D) {
    const v = this.views.get(id);
    if (!v) return;
    v.body.visible = false;
    v.model = obj;
    v.g.add(obj);
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
    for (const m of mates) {
      const v = this.views.get(m.id);
      if (!v) continue;
      const down = m.state === 'downed';
      v.g.position.set(m.x, 0, m.z);
      // downed: she drops to a knee (sunk, greyed); up: a light bob on the move
      v.body.position.y = down ? -0.7 : Math.abs(Math.sin(t * 6 + m.phase)) * 0.04;
      v.mat.color.set(down ? '#6a6a7a' : '#ffffff');
      if (v.model) {
        // the 3D girl faces her target; downed she drops on her side
        v.model.rotation.set(0, Math.PI - m.yaw, down ? Math.PI / 2.4 : 0);
        v.model.position.y = down ? 0.25 : Math.abs(Math.sin(t * 6 + m.phase)) * 0.04;
      }
      v.label.position.y = down ? BODY_H - 0.5 : BODY_H + 0.15;
      this.paint(v, m);
    }
  }

  dispose() {
    this.gone = true;
    for (const v of this.views.values()) {
      v.mat.map?.dispose();
      v.mat.dispose();
      v.tex.dispose();
      (v.label.material as THREE.SpriteMaterial).dispose();
    }
    this.group.removeFromParent();
  }
}
