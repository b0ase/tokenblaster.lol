/**
 * Satoshi City pedestrians: rigged low-poly people (Sketchfab, CC BY; docs/arena-city-models.md)
 * walking loops around the block sidewalks. Shared GLTFs, one SkeletonUtils clone per walker; only
 * walkers near the camera animate, far ones are hidden. A car that hits one knocks them down; they
 * get back up somewhere else a few seconds later. If no model loads, the city simply has no walkers.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CURB_H, SIDEWALK, rng, type Block } from './layout';

type PedModel = { url: string; height: number; facing: number; walk: string; down?: string };
const MODELS: PedModel[] = [
  { url: '/city/models/ped_bearded.glb', height: 1.78, facing: 0, walk: 'walk', down: 'death' },
  { url: '/city/models/ped_shirt.glb', height: 1.8, facing: 0, walk: 'Armature|walking', down: 'Armature|fall' },
  { url: '/city/models/ped_female.glb', height: 1.68, facing: 0, walk: 'walking' },
];

type Walker = {
  root: THREE.Group;
  body: THREE.Group;
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction;
  down: THREE.AnimationAction | null;
  loop: [number, number][]; // sidewalk loop corners
  leg: number; // current corner index
  s: number; // distance along the current leg
  dir: 1 | -1;
  speed: number;
  knocked: number; // seconds left on the ground (0 = walking)
};

export type Hazard = { x: number; z: number; speed: number };

export function createPeds(scene: THREE.Scene, blocks: Block[], count = 36) {
  const walkers: Walker[] = [];
  const r = rng(1984);
  let disposed = false;
  const m = SIDEWALK * 0.55; // walk a little inside the kerb
  const loops = blocks.map(
    (b) =>
      [
        [b.x0 + m, b.z0 + m],
        [b.x1 - m, b.z0 + m],
        [b.x1 - m, b.z1 - m],
        [b.x0 + m, b.z1 - m],
      ] as [number, number][],
  );

  const place = (w: Walker) => {
    w.loop = loops[Math.floor(r() * loops.length)];
    w.leg = Math.floor(r() * 4);
    w.s = r() * legLen(w);
    w.dir = r() < 0.5 ? 1 : -1;
    w.speed = 1.1 + r() * 0.6;
  };
  const corner = (w: Walker, i: number) => w.loop[((i % 4) + 4) % 4];
  const legEnds = (w: Walker) => (w.dir === 1 ? [corner(w, w.leg), corner(w, w.leg + 1)] : [corner(w, w.leg + 1), corner(w, w.leg)]);
  const legLen = (w: Walker) => {
    const [a, b] = legEnds(w);
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const ready = Promise.all(MODELS.map((md) => loader.loadAsync(md.url).then((g) => [md, g] as const).catch(() => null))).then((list) => {
    const ok = list.filter((x): x is readonly [PedModel, GLTF] => Boolean(x));
    if (disposed || !ok.length) return;
    for (let i = 0; i < count; i++) {
      const [md, g] = ok[i % ok.length];
      const model = cloneSkinned(g.scene);
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model, true);
      const sc = md.height / Math.max(0.01, box.max.y - box.min.y);
      model.scale.multiplyScalar(sc);
      const c = box.getCenter(new THREE.Vector3()).multiplyScalar(sc);
      model.position.set(-c.x, -box.min.y * sc, -c.z);
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.frustumCulled = false; // skinned bounds lie when animated
        }
      });
      const turn = new THREE.Group();
      turn.rotation.y = md.facing;
      turn.add(model);
      const body = new THREE.Group();
      body.add(turn);
      const root = new THREE.Group();
      root.add(body);
      scene.add(root);
      const mixer = new THREE.AnimationMixer(model);
      const clip = (n?: string) => (n ? g.animations.find((a) => a.name === n) : undefined);
      const wc = clip(md.walk) ?? g.animations[0];
      const walk = mixer.clipAction(wc);
      walk.play();
      walk.time = r() * wc.duration;
      const dc = clip(md.down);
      const down = dc ? mixer.clipAction(dc) : null;
      if (down) {
        down.setLoop(THREE.LoopOnce, 1);
        down.clampWhenFinished = true;
      }
      const w: Walker = { root, body, mixer, walk, down, loop: loops[0], leg: 0, s: 0, dir: 1, speed: 1.3, knocked: 0 };
      place(w);
      walkers.push(w);
    }
  });

  const pos = (w: Walker): [number, number, number] => {
    const [a, b] = legEnds(w);
    const L = Math.max(0.001, Math.hypot(b[0] - a[0], b[1] - a[1]));
    const t = Math.min(1, w.s / L);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[0] - a[0], b[1] - a[1])];
  };

  /** Advance walkers. `focus` is where the camera looks; `hazards` are cars that can knock people down. */
  const update = (dt: number, focusX: number, focusZ: number, hazards: Hazard[]) => {
    for (const w of walkers) {
      const d = Math.hypot(w.root.position.x - focusX, w.root.position.z - focusZ);
      w.root.visible = d < 110;
      if (w.knocked > 0) {
        w.knocked -= dt;
        if (!w.down) w.body.rotation.x = Math.min(Math.PI / 2, w.body.rotation.x + dt * 6);
        if (w.root.visible) w.mixer.update(dt);
        if (w.knocked <= 0) {
          w.body.rotation.x = 0;
          w.down?.stop();
          w.walk.reset().play();
          place(w);
        }
        continue;
      }
      w.s += w.speed * dt;
      const L = legLen(w);
      if (w.s >= L) {
        w.s -= L;
        w.leg += w.dir;
      }
      const [x, z, heading] = pos(w);
      w.root.position.set(x, CURB_H, z);
      w.root.rotation.y = heading;
      if (w.root.visible && d < 70) w.mixer.update(dt);
      for (const h of hazards)
        if (Math.abs(h.speed) > 3 && Math.hypot(h.x - x, h.z - z) < 1.6) {
          w.knocked = 6;
          w.walk.stop();
          w.down?.reset().play();
          break;
        }
    }
  };

  const dispose = () => {
    disposed = true;
    for (const w of walkers) {
      w.mixer.stopAllAction();
      scene.remove(w.root);
    }
    walkers.length = 0;
  };

  return { ready, update, dispose, walkers };
}
