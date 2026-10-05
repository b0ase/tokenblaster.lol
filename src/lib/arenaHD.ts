/**
 * HD arena assets (credits in public/arena/CREDITS.md): PBR wall/floor textures (Poly Haven, CC0),
 * monsters and guns from Sketchfab (CC-BY 4.0) and KayKit skeletons (CC0). Loads once, then hands
 * out materials, ready-to-animate monsters and first-person guns.
 */
import * as THREE from 'three';
import { chibiClips } from './chibiAnims';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

// ── Roster ──────────────────────────────────────────────────────────

type Role = 'idle' | 'walk' | 'run' | 'attack' | 'death' | 'hit';
export type MonsterDef = {
  id: string;
  url: string;
  height: number; // world units, feet to top
  hover?: number; // lift off the floor (floaters)
  facing?: number; // extra yaw so the model faces +Z
  hp: number;
  speed: number;
  ranged: boolean;
  damage: number;
  maze: number; // how many roam the maze
  showcaseOnly?: boolean; // only appears with ?showcase (preview of a coming character)
  horde?: number; // how many swarm the horde hall
  anims: Partial<Record<Role, string>>;
};

export const MONSTERS: MonsterDef[] = [
  {
    id: 'helldemon',
    url: '/arena/models/monsters/helldemon.glb',
    height: 3.3,
    hp: 30,
    speed: 2,
    ranged: false,
    damage: 30,
    maze: 1,
    anims: { idle: 'Armature|await x 2', walk: 'Armature|WALKING', run: 'Armature|WALKING', attack: 'Armature|atack', death: 'Armature|dying' },
  },
  {
    id: 'hazmat',
    url: '/arena/models/monsters/hazmat.glb',
    height: 2,
    hp: 4,
    speed: 1.7,
    ranged: false,
    damage: 12,
    maze: 3,
    anims: { idle: 'Zombie_Idle', walk: 'Zombie_Walk_Root', run: 'Zombie_Walk_Root', attack: 'Zombie_Skill', hit: 'Zombie_EnemySpotted' },
  },
  {
    id: 'zombiewarrior',
    url: '/arena/models/monsters/zombiewarrior.glb',
    height: 2.05,
    hp: 3,
    speed: 3.4,
    ranged: false,
    damage: 10,
    maze: 2,
    anims: { idle: 'idle', walk: 'walk', run: 'run' },
  },
  {
    id: 'eyebeast',
    url: '/arena/models/monsters/eyebeast.glb',
    height: 1.3,
    hover: 1.1,
    hp: 3,
    speed: 1.5,
    ranged: true,
    damage: 12,
    maze: 2,
    anims: { idle: 'Take 001', walk: 'Take 001', run: 'Take 001', attack: 'Take 001' },
  },
  {
    id: 'spiderthing',
    url: '/arena/models/monsters/spiderthing.glb',
    height: 1.1,
    hp: 2,
    speed: 4,
    ranged: false,
    damage: 8,
    maze: 2,
    anims: { idle: 'Armature|Armature|ArmatureAction', walk: 'Armature|Armature|ArmatureAction', run: 'Armature|Armature|subjectAction' },
  },
  {
    // Ninja Punk Girls: first 3D test (Tripo image-to-3D + auto-rig). Player character, not yet playable.
    id: 'miyuki',
    url: '/arena/models/npg/miyuki.glb',
    height: 1.9,
    hp: 10,
    speed: 3,
    ranged: false,
    damage: 10,
    maze: 1,
    showcaseOnly: true,
    anims: { idle: 'hurt', walk: 'hurt', run: 'hurt' },
  },
  {
    // Ninja Punk Girls chibi base: properly rigged (84 bones); idle/walk/run are made in code (chibiAnims.ts).
    id: 'chibi',
    url: '/arena/models/npg/stack/chibi_base.glb',
    height: 1.4,
    hp: 6,
    speed: 3,
    ranged: false,
    damage: 8,
    maze: 2,
    anims: { idle: 'idle', walk: 'walk', run: 'run' },
  },
  {
    id: 'minion',
    url: '/arena/models/skeleton_minion.glb',
    height: 2.1,
    hp: 1,
    speed: 3.2,
    ranged: false,
    damage: 5,
    maze: 0,
    horde: 24,
    anims: { idle: 'Idle', walk: 'Walking_D_Skeletons', run: 'Running_C', attack: 'Unarmed_Melee_Attack_Punch_A', death: 'Death_A', hit: 'Hit_A' },
  },
];

export type GunDef = {
  id: string;
  name: string;
  key: string; // number key to select
  url: string;
  fireMs: number; // time between trigger pulls while held
  pellets: number; // blasts per pull (each pellet is its own on-chain blast)
  spread: number;
  length: number; // model length in camera space
  flip?: boolean; // the model's barrel ends up pointing at you: turn it round
  roll?: number; // radians about the barrel: rights a model that comes out upside-down or on its side
  pos: [number, number, number]; // where it sits in front of the camera
  bolt: string; // tracer / bolt colour
  spin?: string; // animation to play while firing
  kick: number;
};

export const GUNS: GunDef[] = [
  { id: 'minigun', name: 'Minigun', key: '1', url: '/arena/models/guns/minigun.glb', flip: true, fireMs: 33, pellets: 1, spread: 0.03, length: 0.9, pos: [0.24, -0.3, -0.55], bolt: '#ffb070', spin: 'Minigun_Rig|Rotation', kick: 0.25 },
  { id: 'plasmarifle', name: 'Plasma MG', key: '2', url: '/arena/models/guns/plasmarifle.glb', fireMs: 55, pellets: 1, spread: 0.015, length: 0.6, pos: [0.22, -0.24, -0.5], bolt: '#6ae0ff', kick: 0.4 },
  { id: 'quadplasma', name: 'Quad Plasma', key: '3', url: '/arena/models/guns/quadplasma.glb', fireMs: 140, pellets: 4, spread: 0.035, length: 0.75, pos: [0.22, -0.25, -0.5], bolt: '#b46aff', kick: 0.9 },
  { id: 'sawedoff', name: 'Sawed-off', key: '4', url: '/arena/models/guns/sawedoff.glb', fireMs: 600, pellets: 8, spread: 0.09, length: 0.65, pos: [0.22, -0.25, -0.48], bolt: '#ffd27a', kick: 1.6 },
];

// ── Loading ─────────────────────────────────────────────────────────

const TEX = ['castle_brick_07', 'metal_plate', 'rough_block_wall', 'rusty_metal_02', 'painted_metal_shutter', 'concrete_floor_worn_001', 'metal_grate_rusty', 'corrugated_iron_02'] as const;
type TexId = (typeof TEX)[number];

export type ArenaAssets = {
  material: (id: TexId, repeat?: [number, number]) => THREE.MeshStandardMaterial;
  monsters: Record<string, GLTF>;
  guns: Record<string, GLTF>;
};

/** Load everything; `onProgress` gets 0..1. */
export async function loadArenaAssets(renderer: THREE.WebGLRenderer, onProgress: (p: number) => void): Promise<ArenaAssets> {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, done, total) => onProgress(total ? done / total : 0);
  const tl = new THREE.TextureLoader(manager);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = (url: string, srgb: boolean) =>
    new Promise<THREE.Texture>((ok, no) =>
      tl.load(
        url,
        (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = aniso;
          if (srgb) t.colorSpace = THREE.SRGBColorSpace;
          ok(t);
        },
        undefined,
        no,
      ),
    );
  const gl = new GLTFLoader(manager);
  gl.setMeshoptDecoder(MeshoptDecoder);

  const [maps, monsters, guns] = await Promise.all([
    Promise.all(
      TEX.map(async (id) => {
        const base = `/arena/tex/${id}`;
        const [map, normalMap, roughnessMap] = await Promise.all([load(`${base}/diff.jpg`, true), load(`${base}/nor.jpg`, false), load(`${base}/rough.jpg`, false)]);
        return [id, { map, normalMap, roughnessMap }] as const;
      }),
    ),
    Promise.all(
      MONSTERS.map(async (m) => {
        const g = await gl.loadAsync(m.url);
        if (m.id === 'chibi') g.animations = chibiClips(g.scene);
        return [m.id, g] as const;
      }),
    ),
    Promise.all(GUNS.map(async (g) => [g.id, await gl.loadAsync(g.url)] as const)),
  ]);
  const byId = new Map(maps);

  return {
    material: (id, repeat = [1, 1]) => {
      const src = byId.get(id)!;
      const clone = (t: THREE.Texture) => {
        const c = t.clone();
        c.repeat.set(repeat[0], repeat[1]);
        c.needsUpdate = true;
        return c;
      };
      return new THREE.MeshStandardMaterial({
        map: clone(src.map),
        normalMap: clone(src.normalMap),
        roughnessMap: clone(src.roughnessMap),
        metalness: id.includes('metal') || id.includes('iron') || id.includes('shutter') ? 0.55 : 0.05,
      });
    },
    monsters: Object.fromEntries(monsters),
    guns: Object.fromEntries(guns),
  };
}

// ── Monsters ────────────────────────────────────────────────────────

/** One animated monster: scaled model clone, mixer, role-named actions, and a hitbox for shots. */
export class Monster {
  root = new THREE.Group();
  body = new THREE.Group(); // tipped over for monsters with no death animation
  mixer: THREE.AnimationMixer;
  hitbox: THREE.Mesh;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;

  constructor(
    public def: MonsterDef,
    gltf: GLTF,
  ) {
    const model = cloneSkinned(gltf.scene);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true);
    const size = box.getSize(new THREE.Vector3());
    const scale = def.height / Math.max(0.001, size.y);
    model.scale.multiplyScalar(scale);
    const centre = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
    model.position.set(-centre.x, -box.min.y * scale + (def.hover ?? 0), -centre.z);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.frustumCulled = false; // skinned bounds lie when animated
    });
    const turn = new THREE.Group();
    turn.rotation.y = def.facing ?? 0;
    turn.add(model);
    this.body.add(turn);
    this.root.add(this.body);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    // Shots test this box, not the skinned mesh (whose bounds stay in bind pose).
    const w = Math.min(1.6, Math.max(0.7, Math.max(size.x, size.z) * scale * 0.6));
    this.hitbox = new THREE.Mesh(new THREE.BoxGeometry(w, def.height, w), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitbox.position.y = def.height / 2 + (def.hover ?? 0);
    this.root.add(this.hitbox);
  }

  has(role: Role) {
    const name = this.def.anims[role];
    return Boolean(name && this.actions.has(name));
  }

  /** Cross-fade to a role's animation. `once` plays it a single time and holds the last frame. */
  play(role: Role, { once = false, fade = 0.15, speed = 1 } = {}) {
    const next = this.actions.get(this.def.anims[role] ?? '');
    if (!next || next === this.current) return next;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.timeScale = speed;
    next.play();
    if (this.current) this.current.crossFadeTo(next, fade, false);
    this.current = next;
    return next;
  }
}

// ── Guns ────────────────────────────────────────────────────────────

export type HeldGun = { def: GunDef; group: THREE.Group; muzzle: THREE.Vector3; mixer: THREE.AnimationMixer | null; spin: THREE.AnimationAction | null };

/** A first-person gun: turned barrel-forward, scaled to `length`, muzzle found from its bounds. */
export function buildGun(def: GunDef, gltf: GLTF): HeldGun {
  const model = cloneSkinned(gltf.scene); // rigged guns (the minigun's spinning barrel) need their skeleton cloned too
  model.updateMatrixWorld(true);
  const raw = new THREE.Box3().setFromObject(model, true).getSize(new THREE.Vector3());
  // Point the longest axis (the barrel) down -Z, whatever axis the artist modelled it along.
  const turn = new THREE.Group();
  if (raw.x >= raw.y && raw.x >= raw.z) turn.rotation.y = Math.PI / 2;
  else if (raw.y >= raw.x && raw.y >= raw.z) turn.rotation.x = Math.PI / 2;
  if (def.flip) turn.rotation.y += Math.PI;
  turn.add(model);
  const rolled = new THREE.Group(); // barrel is along -Z here, so z is the roll axis
  rolled.rotation.z = def.roll ?? 0;
  rolled.add(turn);
  const group = new THREE.Group();
  group.add(rolled);
  const longest = Math.max(raw.x, raw.y, raw.z);
  const scale = def.length / Math.max(1e-6, longest);
  turn.scale.setScalar(scale);
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group, true);
  const centre = box.getCenter(new THREE.Vector3());
  turn.position.sub(centre);
  const size = box.getSize(new THREE.Vector3());
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.frustumCulled = false;
      m.renderOrder = 10;
      // Tame glowing parts so the gun in your face doesn't bloom out.
      const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
      for (const mat of mats) if (mat.emissive) mat.emissiveIntensity = Math.min(mat.emissiveIntensity ?? 1, 0.35);
    }
  });
  // Muzzle: the middle of the gun's front tip (vertices in the frontmost 4% along -Z), so shots and
  // flashes leave the barrel rather than a guessed point. Falls back to a guess for odd models.
  const muzzle = new THREE.Vector3(0, size.y * 0.15, -def.length / 2);
  let skinned = false;
  model.traverse((n) => {
    if ((n as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
  });
  // Rigged models (the minigun): raw vertices aren't where they're drawn, so keep the guess.
  if (!skinned) {
    group.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const tip: THREE.Vector3[] = [];
    let front = Infinity;
    const all: THREE.Vector3[] = [];
    model.traverse((n) => {
      const m = n as THREE.Mesh;
      const pos = m.isMesh ? (m.geometry.getAttribute('position') as THREE.BufferAttribute | undefined) : undefined;
      if (!pos) return;
      const step = Math.max(1, Math.floor(pos.count / 4000));
      for (let i = 0; i < pos.count; i += step) {
        const p = v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).clone();
        all.push(p);
        front = Math.min(front, p.z);
      }
    });
    // Barrels sit in the upper part of a gun; ignore belts, magazines and grips hanging below.
    const ys = all.map((p) => p.y).sort((a, b) => a - b);
    const floorY = ys[Math.floor(ys.length * 0.35)] ?? -Infinity;
    const upper = all.filter((p) => p.y >= floorY);
    front = upper.reduce((m, p) => Math.min(m, p.z), Infinity);
    for (const p of upper) if (p.z < front + def.length * 0.04) tip.push(p);
    if (tip.length) {
      const c = tip.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(tip.length);
      muzzle.set(c.x, c.y, front);
    }
  }
  let mixer: THREE.AnimationMixer | null = null;
  let spin: THREE.AnimationAction | null = null;
  const clip = def.spin && gltf.animations.find((a) => a.name === def.spin);
  if (clip) {
    mixer = new THREE.AnimationMixer(model);
    spin = mixer.clipAction(clip);
    spin.play();
    spin.timeScale = 0;
  }
  return { def, group, muzzle, mixer, spin };
}
