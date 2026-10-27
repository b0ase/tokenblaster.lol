/** Dr Kweg S Wong's body for the Act 2 escort (the AI is ./escort.ts). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { loadLibrary, retarget } from './enemies';
import { ESCORT, type EscortAI } from './escort';

// ── The body ─────────────────────────────────────────────────────────────────────────────────────────────

/** Standing height (m): a little shorter than the girls, big cartoon head. */
const HEIGHT = 1.65;

export class KwegBody {
  readonly root = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private acts: Partial<Record<'idle' | 'run' | 'walk' | 'death', THREE.AnimationAction>> = {};
  private cur: THREE.AnimationAction | null = null;
  private bar: HTMLDivElement;
  private fill: HTMLDivElement;
  /** Off-screen pointer: a small gold KWEG chip pinned to the screen edge, its arrow turned towards him. */
  private edge: HTMLDivElement;
  private edgeArrow: HTMLDivElement;
  private barK = -1;
  private v = new THREE.Vector3();
  private disp: { dispose: () => void }[] = [];
  private odd = false;
  private fallback: THREE.Mesh;
  /** Where to aim a tap test: the chest, world space. */
  readonly chest = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private high: boolean,
    private canvas: HTMLCanvasElement,
  ) {
    this.root.name = 'kweg';
    this.root.visible = false;
    scene.add(this.root);
    // a placeholder until the GLB is in (never a blank)
    const fg = new THREE.CapsuleGeometry(0.25, 0.9, 4, 8);
    const fm = new THREE.MeshStandardMaterial({ color: '#c9a36a' });
    this.fallback = new THREE.Mesh(fg, fm);
    this.fallback.position.y = 0.75;
    this.root.add(this.fallback);
    this.disp.push(fg, fm);
    // HP bar over his head: a DOM bar over the canvas (always on top, no extra draw calls), placed by projection
    this.bar = document.createElement('div');
    this.bar.setAttribute('data-kweg-hp', '');
    this.bar.style.cssText = 'position:absolute;left:0;top:0;width:64px;height:7px;margin:-3px 0 0 -32px;border-radius:4px;background:rgba(18,5,9,.8);border:1px solid rgba(255,255,255,.35);pointer-events:none;z-index:5;display:none;will-change:transform';
    this.fill = document.createElement('div');
    this.fill.style.cssText = 'height:100%;width:100%;border-radius:3px;background:#3dff8a;transform-origin:left center';
    this.bar.appendChild(this.fill);
    canvas.parentElement?.appendChild(this.bar);
    this.edge = document.createElement('div');
    this.edge.setAttribute('data-kweg-edge', '');
    this.edge.style.cssText = 'position:absolute;left:0;top:0;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;background:rgba(10,6,2,.7);border:2px solid #ffc21a;color:#ffc21a;font:900 9px/26px system-ui,sans-serif;text-align:center;letter-spacing:.04em;pointer-events:none;z-index:5;display:none;will-change:transform';
    this.edge.textContent = 'DR K';
    this.edgeArrow = document.createElement('div');
    this.edgeArrow.style.cssText = 'position:absolute;left:50%;top:50%;width:0;height:0;margin:-5px 0 0 15px;border:5px solid transparent;border-left:7px solid #ffc21a;transform-origin:-15px 5px';
    this.edge.appendChild(this.edgeArrow);
    canvas.parentElement?.appendChild(this.edge);
    void this.load();
  }

  private async load() {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const [g, lib] = await Promise.all([loader.loadAsync(`/terrornode/kweg/${this.high ? 'hi' : 'lo'}.glb`).catch(() => null), loadLibrary()]);
    if (!g) return;
    const model = g.scene;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.frustumCulled = false;
        m.castShadow = this.high;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat) mat.envMapIntensity = 1.2;
      }
    });
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const s = HEIGHT / (box.max.y - box.min.y || 1);
    model.scale.setScalar(s);
    model.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
    this.root.add(model);
    this.root.remove(this.fallback);
    this.model = model;
    const clips = retarget(lib, model);
    this.mixer = new THREE.AnimationMixer(model);
    const mk = (name: string, alt: string, loop = true) => {
      const c = clips.get(name) ?? clips.get(alt);
      if (!c) return undefined;
      const a = this.mixer!.clipAction(c);
      if (!loop) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      return a;
    };
    this.acts = { idle: mk('Idle_Loop', 'Idle_Loop'), run: mk('Sprint_Loop', 'Jog_Fwd_Loop'), walk: mk('Jog_Fwd_Loop', 'Walk_Loop') };
    if (this.high) this.acts.death = mk('Death01', 'Death_A', false);
    this.play('idle');
  }

  private play(k: 'idle' | 'run' | 'walk' | 'death') {
    const a = this.acts[k] ?? this.acts.idle;
    if (!a || a === this.cur) return;
    a.reset().fadeIn(0.2).play();
    this.cur?.fadeOut(0.2);
    this.cur = a;
  }

  show(on: boolean) {
    this.root.visible = on;
    if (!on) {
      this.bar.style.display = 'none';
      this.edge.style.display = 'none';
    }
  }

  update(dt: number, ai: EscortAI, camera: THREE.Camera) {
    if (!this.root.visible) return;
    this.root.position.set(ai.x, 0, ai.z);
    // ease the turn
    const cur = this.root.rotation.y;
    let d = ai.heading + Math.PI - cur; // the model faces +Z; heading 0 is -Z
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y = cur + d * Math.min(1, dt * 10);
    if (ai.state === 'dead') {
      if (this.acts.death) this.play('death');
      else this.root.rotation.x = Math.min(Math.PI / 2, this.root.rotation.x + dt * 3); // low tier: just topple
    } else {
      this.root.rotation.x = 0;
      this.play(ai.speed > 4.5 ? 'run' : ai.speed > 0.4 ? 'walk' : 'idle');
    }
    // half-rate animation on Low
    this.odd = !this.odd;
    if (this.mixer && (this.high || this.odd)) this.mixer.update(this.high ? dt : dt * 2);
    // HP bar: over his head, in screen space
    const k = Math.max(0, ai.hp / ESCORT.hp);
    const show = ai.state !== 'dead' && ai.state !== 'safe';
    this.v.set(ai.x, HEIGHT + 0.25, ai.z).project(camera);
    const on = show && this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
    this.bar.style.display = on ? 'block' : 'none';
    // OFF SCREEN (owner, 27 Oct: "you can't see who you're protecting"): pin a chip to the nearest edge, arrow pointing at him
    const off = show && !on;
    this.edge.style.display = off ? 'block' : 'none';
    if (off) {
      let nx = this.v.x;
      let ny = this.v.y;
      if (this.v.z >= 1) {
        // behind the camera: the projection flips
        nx = -nx;
        ny = -ny;
      }
      if (Math.abs(nx) < 1e-3 && Math.abs(ny) < 1e-3) ny = -1;
      const m = Math.max(Math.abs(nx), Math.abs(ny));
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      const ex = Math.min(w - 22, Math.max(22, ((nx / m + 1) / 2) * w)) + this.canvas.offsetLeft;
      const ey = Math.min(h - 22, Math.max(22, ((1 - ny / m) / 2) * h)) + this.canvas.offsetTop;
      this.edge.style.transform = `translate(${ex.toFixed(1)}px,${ey.toFixed(1)}px)`;
      this.edgeArrow.style.transform = `rotate(${Math.atan2(-ny, nx).toFixed(3)}rad)`;
      this.edge.style.borderColor = k > 0.5 ? '#ffc21a' : k > 0.25 ? '#ff9a1a' : '#ff2a3a';
    }
    if (on) {
      const x = ((this.v.x + 1) / 2) * this.canvas.clientWidth + this.canvas.offsetLeft;
      const y = ((1 - this.v.y) / 2) * this.canvas.clientHeight + this.canvas.offsetTop;
      this.bar.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      if (Math.abs(k - this.barK) > 0.005) {
        this.barK = k;
        this.fill.style.transform = `scaleX(${k.toFixed(3)})`;
        this.fill.style.background = k > 0.5 ? '#3dff8a' : k > 0.25 ? '#ffc21a' : '#ff2a3a';
      }
    }
    this.chest.set(ai.x, HEIGHT * 0.6, ai.z);
  }

  /** Does the ray pass within reach of him (a tap / click on him)? */
  hitBy(ray: THREE.Ray) {
    return this.root.visible && ray.distanceToPoint(this.chest) < 0.8;
  }

  dispose() {
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
    this.bar.remove();
    this.edge.remove();
    this.disp.forEach((d) => d.dispose());
    this.model?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.map?.dispose();
        mat.dispose();
      }
    });
  }
}
