import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * The NPG girls in 3D (squadmates in TERRORNODE, and CHOOSE YOUR GIRL): the Tripo rigged girls NPG Arena uses
 * (public/npg/cards/<slug>-rigged.glb, Mixamo bone names, rest = identity), rebuilt with 1024px textures into
 * public/terrornode/squad by scripts/npg-squad-3d/build.sh (the 4096px originals are ~900MB of GPU for five girls).
 * They play the shared Quaternius UAL clips (public/npg/anims/mixamo-anims.glb) retargeted by bone name, the same
 * library the Erobotz and Dr Kweg use. One load per girl for the whole page; every body is a SkeletonUtils clone
 * sharing that girl's geometry, materials and textures. Never a T-pose: a clip that does not bind falls back to the
 * bound idle, and a body is only handed out with its idle already playing. Desktop only; mobile-lite keeps billboards.
 */
const BASE = '/terrornode/squad/';
const ANIMS = '/npg/anims/mixamo-anims.glb';

/** Height the bodies are scaled to (m). */
export const BODY_H = 1.7;

export type Move = 'idle' | 'jog' | 'sprint' | 'shoot' | 'down' | 'yes' | 'folds' | 'punch' | 'dance' | 'ready';
const CLIP: Record<Move, string> = { idle: 'Idle_Loop', jog: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop', shoot: 'Spell_Simple_Shoot', down: 'Crouch_Idle_Loop', yes: 'Yes', folds: 'Idle_FoldArms_Loop', punch: 'Punch_Cross', dance: 'Dance_Loop', ready: 'Sword_Idle' };

export type GirlTemplate = { scene: THREE.Object3D; clips: Map<Move, THREE.AnimationClip>; scale: number; offset: THREE.Vector3 };

const keyOf = (n: string) => n.replace(/^mixamorig\d*[:_]?/, '');
const KIMIKO_HIPS = new THREE.Vector3(-0.0172, 0.2806, 0.0248);
let loader: GLTFLoader | null = null;
const gl = () => (loader ??= new GLTFLoader());
let lib: Promise<THREE.AnimationClip[]> | null = null;
const library = () => (lib ??= gl().loadAsync(ANIMS).then((g) => g.animations));

/** Retarget one clip onto this model's bones (port of npgRigMocap / enemies.ts); null when it does not bind. */
function bind(c: THREE.AnimationClip, names: Map<string, string>, off: THREE.Vector3): THREE.AnimationClip | null {
  const q = new THREE.Quaternion();
  const ident = new THREE.Quaternion();
  const tracks = c.tracks.flatMap((t) => {
    const dot = t.name.lastIndexOf('.');
    const bn = keyOf(t.name.slice(0, dot));
    const bone = names.get(bn);
    if (!bone || /^(Neck|Head)$/.test(bn)) return []; // the big heads ride on the spine
    const k = t.clone();
    k.name = `${bone}${t.name.slice(dot)}`;
    const damp = /^Spine\d?$/.test(bn) ? 0.3 : bn === 'Hips' ? 0.2 : 0;
    if (damp > 0 && t.name.endsWith('.quaternion')) {
      const v = k.values;
      for (let i = 0; i < v.length; i += 4) q.fromArray(v, i).slerp(ident, damp).toArray(v, i);
    }
    if (t.name.endsWith('.position')) {
      const v = k.values;
      for (let i = 0; i < v.length; i += 3) {
        v[i] += off.x;
        v[i + 1] += off.y;
        v[i + 2] += off.z;
      }
    }
    return [k];
  });
  // arms + legs at least: a clip that moves only a bone or two did not bind to this rig
  return tracks.filter((t) => t.name.endsWith('.quaternion')).length >= 8 ? new THREE.AnimationClip(c.name, c.duration, tracks) : null;
}

const cache = new Map<string, Promise<GirlTemplate>>();
/** The girl's shared template, loaded once per page. */
export function loadGirl(slug: string): Promise<GirlTemplate> {
  let p = cache.get(slug);
  if (p) return p;
  p = Promise.all([gl().loadAsync(`${BASE}${slug}.glb`), library()]).then(([g, anims]) => {
    const scene = g.scene;
    const names = new Map<string, string>();
    const hips = KIMIKO_HIPS.clone();
    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        names.set(keyOf(o.name), o.name);
        if (keyOf(o.name) === 'Hips') hips.copy(o.position);
      }
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      // the night street is dark: her own albedo as a soft glow keeps her readable (shared by every clone)
      const m = mesh.material as THREE.MeshStandardMaterial;
      if (m.map && !m.emissiveMap) {
        m.emissiveMap = m.map;
        m.emissive = new THREE.Color(0.45, 0.45, 0.45);
      }
    });
    const off = hips.sub(KIMIKO_HIPS);
    const byName = new Map(anims.map((c) => [c.name, c]));
    const idleSrc = byName.get(CLIP.idle);
    const idle = idleSrc ? bind(idleSrc, names, off) : null;
    if (!idle) throw new Error(`no idle binds on ${slug}`);
    const clips = new Map<Move, THREE.AnimationClip>();
    for (const mv of Object.keys(CLIP) as Move[]) {
      const src = byName.get(CLIP[mv]);
      clips.set(mv, (src && bind(src, names, off)) || idle);
    }
    // size her from the idle pose (the rest pose is a T: its arms would set the width)
    const probe = cloneSkinned(scene);
    const mx = new THREE.AnimationMixer(probe);
    mx.clipAction(idle).play();
    mx.update(0.2);
    probe.updateMatrixWorld(true);
    const box = new THREE.Box3();
    probe.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      sm.skeleton.update();
      sm.computeBoundingBox();
      box.union(sm.boundingBox!.clone().applyMatrix4(sm.matrixWorld));
    });
    mx.stopAllAction();
    mx.uncacheRoot(probe);
    const h = box.max.y - box.min.y || 1;
    const scale = BODY_H / h;
    return { scene, clips, scale, offset: new THREE.Vector3(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale) };
  });
  p.catch(() => cache.delete(slug));
  cache.set(slug, p);
  return p;
}

/** One animated body: a clone of the girl's template, BODY_H tall, feet on y = 0, already in her idle. */
export class GirlBody {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions = new Map<Move, THREE.AnimationAction>();
  private cur: Move = 'idle';
  private model: THREE.Object3D;
  private clock = 0;
  private until = 0;

  constructor(t: GirlTemplate) {
    this.model = cloneSkinned(t.scene);
    this.model.scale.setScalar(t.scale);
    this.model.position.copy(t.offset);
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [mv, c] of t.clips) this.actions.set(mv, this.mixer.clipAction(c));
    this.actions.get('idle')!.play();
    this.mixer.update(Math.random() * 2); // posed before the first frame (never the rest T), girls out of step
  }

  play(mv: Move, fade = 0.2) {
    if (mv === this.cur) return;
    const from = this.actions.get(this.cur)!;
    const to = this.actions.get(mv)!;
    this.cur = mv;
    if (to === from) return;
    to.reset().setEffectiveWeight(1).play();
    from.crossFadeTo(to, fade, false);
  }

  /** A one-off gesture (the loadout picker): play `mv` for its clip length (capped), then fade back to idle. */
  gesture(mv: Move, max = 3.2) {
    const a = this.actions.get(mv);
    if (!a) return;
    this.play(mv, 0.25);
    this.until = this.clock + Math.min(max, Math.max(1, a.getClip().duration));
  }

  get busy() {
    return this.until > 0;
  }

  update(dt: number) {
    this.clock += dt;
    this.mixer.update(dt);
    if (this.until && this.clock >= this.until) {
      this.until = 0;
      this.play('idle', 0.35);
    }
  }

  /** Drops this clone only: the template (geometry, materials, textures) stays shared for the page. */
  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    // each clone has its own Skeleton, whose bone DataTexture lives on the GPU until disposed
    const seen = new Set<THREE.Skeleton>();
    this.model.traverse((o) => {
      const sk = (o as THREE.SkinnedMesh).skeleton;
      if (!sk || seen.has(sk)) return;
      seen.add(sk);
      sk.dispose();
    });
    this.root.removeFromParent();
  }
}

export async function loadSquadBodies(ids: string[]): Promise<Map<string, GirlBody>> {
  const ts = await Promise.all(ids.map((id) => loadGirl(id).catch(() => null)));
  const out = new Map<string, GirlBody>();
  ids.forEach((id, i) => {
    const t = ts[i];
    if (t) out.set(id, new GirlBody(t));
  });
  return out;
}
