/**
 * Satoshi City pedestrians: rigged low-poly people (Sketchfab, CC BY; docs/arena-city-models.md)
 * walking loops around the block sidewalks. Shared GLTFs, one SkeletonUtils clone per walker; only
 * walkers near the camera animate, far ones are hidden. A car that hits one knocks them down; they
 * get back up somewhere else a few seconds later. If no model loads, the city simply has no walkers.
 *
 * Crowd brain: a walker nearing a corner is queued; every couple of seconds the queue goes to /api/city/crowd
 * in one batch, where Jev picks what each one does at that corner (keep going, cross, turn back, pause).
 * Code keeps the safety rule: nobody crosses with fast traffic near the crossing (they pause instead).
 * If the route is offline (no key, error) walkers fall back to weighted dice, so the city never stalls.
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
  plan: CrowdAction | null; // what to do at the next corner (from Jev or the dice)
  asked: boolean; // waiting on a crowd-brain answer
  pause: number; // seconds left standing on a corner
  cross: { ax: number; az: number; bx: number; bz: number; t: number; len: number; loop: [number, number][]; leg: number } | null;
  onBlock: number; // seconds on the current block
  id: string;
};

type CrowdAction = 'continue' | 'cross' | 'turn_back' | 'pause';
const DICE: [CrowdAction, number][] = [['continue', 0.55], ['cross', 0.2], ['pause', 0.15], ['turn_back', 0.1]];
const ASK_EVERY = 2; // seconds between crowd-brain batches
const ASK_AHEAD = 4; // queue a walker this many seconds before their corner

export type Hazard = { x: number; z: number; speed: number };

export function createPeds(scene: THREE.Scene, blocks: Block[], count = 36) {
  const walkers: Walker[] = [];
  const r = rng(1984);
  let disposed = false;
  const m = SIDEWALK * 0.55; // walk a little inside the kerb
  const kindOf = new Map<[number, number][], Block>();
  const loops = blocks.map(
    (b) =>
      [
        [b.x0 + m, b.z0 + m],
        [b.x1 - m, b.z0 + m],
        [b.x1 - m, b.z1 - m],
        [b.x0 + m, b.z1 - m],
      ] as [number, number][],
  );
  loops.forEach((l, i) => kindOf.set(l, blocks[i]));
  let brainOnline = true;
  let askClock = 0;
  let lastHazards: Hazard[] = [];
  const roll = (): CrowdAction => {
    let x = r();
    for (const [a, p] of DICE) if ((x -= p) < 0) return a;
    return 'continue';
  };
  /** The nearest corner on another block, i.e. across the street. */
  const across = (x: number, z: number, own: [number, number][]) => {
    let best: { loop: [number, number][]; leg: number; d: number } | null = null;
    for (const l of loops) {
      if (l === own) continue;
      l.forEach(([cx, cz], i) => {
        const d = Math.hypot(cx - x, cz - z);
        if (d > 4 && d < 30 && (!best || d < best.d)) best = { loop: l, leg: i, d };
      });
    }
    return best as { loop: [number, number][]; leg: number; d: number } | null;
  };
  const traffic = (x: number, z: number, radius: number) => {
    let n = 0;
    let nearest = Infinity;
    let fastest = 0;
    for (const h of lastHazards) {
      const d = Math.hypot(h.x - x, h.z - z);
      if (d < radius) {
        n++;
        nearest = Math.min(nearest, d);
        fastest = Math.max(fastest, Math.abs(h.speed));
      }
    }
    return { n, nearest, fastest };
  };
  const ask = () => {
    const batch = walkers.filter((w) => w.asked && !w.plan).slice(0, 16);
    if (!batch.length) return;
    if (!brainOnline) {
      for (const w of batch) {
        w.plan = roll();
        w.asked = false;
      }
      return;
    }
    const peds = batch.map((w) => {
      const [a, b] = legEnds(w);
      const t = traffic(b[0], b[1], 30);
      const next = across(b[0], b[1], w.loop);
      const block = kindOf.get(w.loop)!;
      return {
        id: w.id,
        block: block.type === 'city' ? `city block with ${block.lots.filter((l) => l.kind === 'shop').length} shops` : block.type,
        across_the_street: next ? (kindOf.get(next.loop)!.type === 'city' ? 'more city blocks' : kindOf.get(next.loop)!.type) : 'nothing (edge of town)',
        minutes_on_this_block: +(w.onBlock / 60).toFixed(1),
        walking_pace: w.speed > 1.5 ? 'brisk' : 'strolling',
        heading: Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? 'east-west' : 'north-south',
        cars_near_corner: t.n,
        nearest_car_m: Number.isFinite(t.nearest) ? Math.round(t.nearest) : null,
        fastest_car_kmh: Math.round(t.fastest * 3.6),
      };
    });
    fetch('/api/city/crowd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ peds }) })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((out: { decisions?: Record<string, { action: CrowdAction }> }) => {
        for (const w of batch) {
          w.plan = out.decisions?.[w.id]?.action ?? roll();
          w.asked = false;
        }
      })
      .catch((status) => {
        if (status === 503 || status === 404) brainOnline = false; // no key / no route: dice from now on
        for (const w of batch) {
        w.plan = roll();
        w.asked = false;
      }
      });
  };

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
      const w: Walker = { root, body, mixer, walk, down, loop: loops[0], leg: 0, s: 0, dir: 1, speed: 1.3, knocked: 0, plan: null, asked: false, pause: 0, cross: null, onBlock: 0, id: `p${i}` };
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

  /** Is the player standing just ahead of this walker? */
  const blocked = (w: Walker, p: { x: number; z: number }) => {
    const dx = p.x - w.root.position.x;
    const dz = p.z - w.root.position.z;
    const d = Math.hypot(dx, dz);
    if (d > 1.3) return false;
    return dx * Math.sin(w.root.rotation.y) + dz * Math.cos(w.root.rotation.y) > 0; // in front, not behind
  };

  /** Advance walkers. `focus` is where the camera looks; `hazards` are cars that can knock people down. */
  const update = (dt: number, focusX: number, focusZ: number, player: { x: number; z: number } | null, hazards: Hazard[]) => {
    lastHazards = hazards;
    if ((askClock += dt) > ASK_EVERY) {
      askClock = 0;
      ask();
    }
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
          w.cross = null;
          w.pause = 0;
          w.plan = null;
          w.onBlock = 0;
          place(w);
        }
        continue;
      }
      w.onBlock += dt;
      let x: number, z: number, heading: number;
      if (w.pause > 0) {
        w.pause -= dt;
        w.walk.paused = w.pause > 0;
        [x, z] = [w.root.position.x, w.root.position.z];
        heading = w.root.rotation.y;
      } else if (w.cross) {
        const c = w.cross;
        c.t = Math.min(1, c.t + (w.speed * dt) / c.len);
        x = c.ax + (c.bx - c.ax) * c.t;
        z = c.az + (c.bz - c.az) * c.t;
        heading = Math.atan2(c.bx - c.ax, c.bz - c.az);
        if (c.t >= 1) {
          w.loop = c.loop;
          w.dir = r() < 0.5 ? 1 : -1;
          w.leg = w.dir === 1 ? c.leg : c.leg - 1; // start the new leg at the corner we arrived on
          w.s = 0;
          w.onBlock = 0;
          w.cross = null;
        }
      } else if (player && blocked(w, player)) {
        w.walk.paused = true; // someone's in the way: wait for them rather than walk through them
        [x, z] = [w.root.position.x, w.root.position.z];
        heading = w.root.rotation.y;
      } else {
        w.walk.paused = false;
        w.s += w.speed * dt;
        const L = legLen(w);
        if (!w.plan && !w.asked && (L - w.s) / w.speed < ASK_AHEAD) w.asked = true;
        if (w.s >= L) {
          w.s -= L;
          const [, at] = legEnds(w);
          const plan = w.plan ?? roll();
          w.plan = null;
          w.asked = false;
          let next: ReturnType<typeof across> = null;
          const t = traffic(at[0], at[1], 14);
          if (plan === 'cross' && (next = across(at[0], at[1], w.loop))) {
            // safety stays in code: never step out with fast traffic near the crossing
            if (t.fastest > 3) w.pause = 2 + r() * 2;
            else {
              const [bx, bz] = next.loop[next.leg];
              w.cross = { ax: at[0], az: at[1], bx, bz, t: 0, len: Math.max(0.5, next.d), loop: next.loop, leg: next.leg };
              w.s = 0;
            }
          } else if (plan === 'turn_back') {
            w.dir = w.dir === 1 ? -1 : 1;
            w.s = 0;
          } else if (plan === 'pause') w.pause = 2 + r() * 3;
          if (!w.cross && plan !== 'turn_back') w.leg += w.dir;
        }
        [x, z, heading] = pos(w);
      }
      w.root.position.set(x, CURB_H, z);
      w.root.rotation.y = heading;
      if (w.root.visible && d < 70) w.mixer.update(dt);
      if (w.pause <= 0) for (const h of hazards)
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
