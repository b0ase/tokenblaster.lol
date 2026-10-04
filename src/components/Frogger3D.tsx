'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { KINDS, type FeedTx, type TxKind } from '@/lib/feed';
import { chibiClips } from '@/lib/chibiAnims';
import { tokenMeta } from '@/lib/tokenMeta';
import { useChainFeed } from '@/lib/useChainFeed';

/**
 * Chain Frogger, in 3D: cross a city avenue where every vehicle is a real BSV transaction from
 * mainnet, live. Lane = what it carries; payments are sports cars, inscriptions trucks (bigger tx,
 * bigger truck), token transfers box trucks wearing the token's logo. Glass towers, day and night.
 */
const LANE_W = 3.4;
const LANES: TxKind[] = ['payment', 'data', 'social', 'inscription', 'token', 'payment', 'data', 'social'];
const ROAD_HALF = 70; // vehicles live in x ∈ [-ROAD_HALF, ROAD_HALF]
const START_Z = (LANES.length / 2) * LANE_W + 3; // south sidewalk
const GOAL_Z = -START_Z; // north sidewalk
const DAY_S = 150; // seconds for a full day
const BEST = 'tokenblaster:frogger-best';

const laneZ = (i: number) => (i - (LANES.length - 1) / 2) * LANE_W;
const laneDir = (i: number) => (i < LANES.length / 2 ? 1 : -1); // drive on the right
const PAINTS = ['#d81b2a', '#f2f2f2', '#111216', '#1e5bd8', '#f5b700', '#2bb673', '#8a2be2', '#ff6a00', '#9aa3ad'];

export function Frogger3D() {
  const mount = useRef<HTMLDivElement>(null);
  const feed = useChainFeed();
  const feedRef = useRef(feed);
  useEffect(() => {
    feedRef.current = feed;
  });
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [best, setBest] = useState(0);
  const [killer, setKiller] = useState<FeedTx | null>(null);
  const [wasted, setWasted] = useState(false);
  const [over, setOver] = useState(false);
  const [started, setStarted] = useState(false);
  const [clock, setClock] = useState('');
  const control = useRef<{ move: (dx: number, dz: number) => void; restart: () => void; skip: () => void } | null>(null);

  useEffect(() => {
    let saved = 0;
    try {
      saved = Number(localStorage.getItem(BEST) ?? 0);
    } catch {
      /* storage blocked */
    }
    void Promise.resolve().then(() => setBest(saved));
  }, []);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMappingExposure = 0.8;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.fog = new THREE.Fog('#9fb4c8', 110, 320);
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
    camera.position.set(0, 7.5, START_Z + 11);
    camera.lookAt(0, 1.2, START_Z - 6);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.25, 0.5, 0.95); // only real lights bloom
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // ── Light: sun + sky, driven by the day cycle ──
    const hemi = new THREE.HemisphereLight('#cfe4ff', '#3a2a22', 1);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff1dc', 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 300 });
    scene.add(sun, sun.target);

    // ── Ground: avenue, sidewalks, crosswalk, lane markings ──
    const asphalt = new THREE.MeshStandardMaterial({ color: '#2a2b2e', roughness: 0.75, metalness: 0.05 });
    // City ground under everything (plazas, the far side of the blocks).
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ color: '#3a3836', roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);
    const roadW = LANES.length * LANE_W;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2 + 60, roadW), asphalt);
    road.rotation.x = -Math.PI / 2;
    road.receiveShadow = true;
    scene.add(road);
    const walkMat = new THREE.MeshStandardMaterial({ color: '#6f6c68', roughness: 0.9 });
    for (const z of [START_Z + 3, GOAL_Z - 3]) {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 + 60, 0.25, 6 + 2), walkMat);
      walk.position.set(0, 0.125, z + Math.sign(z) * 1);
      walk.receiveShadow = true;
      scene.add(walk);
    }
    const paint = new THREE.MeshStandardMaterial({ color: '#cfccc2', roughness: 0.7 });
    const yellow = new THREE.MeshStandardMaterial({ color: '#f2c200', roughness: 0.6 });
    for (let i = 1; i < LANES.length; i++) {
      const centre = i === LANES.length / 2;
      for (let x = -ROAD_HALF - 20; x < ROAD_HALF + 20; x += centre ? 200 : 6) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(centre ? 300 : 3, 0.18), centre ? yellow : paint);
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, 0.02, (i - LANES.length / 2) * LANE_W);
        scene.add(m);
      }
    }
    // Zebra crossing where you cross: bars along the walking direction, spaced along the road.
    for (let x = -3.6; x <= 3.6; x += 1.2) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.6, roadW - 0.6), paint);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(x, 0.025, 0);
      scene.add(stripe);
    }

    // ── Glass towers with lit windows (shiny by day, glowing at night) ──
    const windowTex = (seed: number) => {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 256;
      const x = c.getContext('2d')!;
      x.fillStyle = '#000';
      x.fillRect(0, 0, 128, 256);
      let r = seed;
      const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
      for (let yy = 4; yy < 256; yy += 10)
        for (let xx = 4; xx < 128; xx += 9) {
          const on = rnd() < 0.42;
          x.fillStyle = on ? (rnd() < 0.5 ? '#ffd9a0' : '#d8ecff') : '#050608';
          x.fillRect(xx, yy, 6, 7);
        }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    };
    const towerMats: THREE.MeshPhysicalMaterial[] = [];
    const glassTints = ['#5b7a99', '#3d5466', '#7a8fa3', '#2f4a5e', '#8aa0b0', '#4a6070'];
    for (let i = 0; i < 6; i++) {
      const w = windowTex(i * 977 + 13);
      towerMats.push(
        new THREE.MeshPhysicalMaterial({
          color: glassTints[i],
          metalness: 0.85,
          roughness: 0.08,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
          envMapIntensity: 1.6,
          emissive: '#ffffff',
          emissiveMap: w,
          emissiveIntensity: 0,
        }),
      );
    }
    const towers: { m: THREE.Mesh }[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const side of [1, -1]) {
      for (let row = 0; row < 3; row++) {
        for (let x = -ROAD_HALF - 30; x < ROAD_HALF + 30; ) {
          const w = 8 + rnd() * 10;
          const d = 8 + rnd() * 10;
          const h = 18 + rnd() * (row === 0 ? 40 : 90);
          const mat = towerMats[Math.floor(rnd() * towerMats.length)];
          const geo = new THREE.BoxGeometry(w, h, d);
          const m = new THREE.Mesh(geo, mat);
          // Window texture repeats with tower size.
          const uv = geo.attributes.uv as THREE.BufferAttribute;
          for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (w / 8), uv.getY(k) * (h / 16));
          // Behind you (south) the blocks start beyond the chase camera so they never fill the view.
          m.position.set(x + w / 2, h / 2, side * (START_Z + (side > 0 ? 24 : 12) + row * 22 + rnd() * 6));
          m.castShadow = row === 0;
          m.receiveShadow = true;
          scene.add(m);
          towers.push({ m });
          x += w + 2 + rnd() * 4;
        }
      }
    }

    // ── Street lamps (glow at night; light pools faked with emissive heads + bloom) ──
    const lampHeads: THREE.MeshStandardMaterial[] = [];
    const poleMat = new THREE.MeshStandardMaterial({ color: '#2b2e33', metalness: 0.7, roughness: 0.4 });
    const headMat = new THREE.MeshStandardMaterial({ color: '#fff3d0', emissive: '#ffcf80', emissiveIntensity: 0 });
    lampHeads.push(headMat);
    for (const z of [START_Z + 1.2, GOAL_Z - 1.2]) {
      for (let x = -ROAD_HALF; x <= ROAD_HALF; x += 18) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 6.5), poleMat);
        pole.position.set(x, 3.25, z);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.6), poleMat);
        arm.position.set(x, 6.4, z - Math.sign(z) * 0.8);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.8), headMat);
        head.position.set(x, 6.3, z - Math.sign(z) * 1.5);
        scene.add(pole, arm, head);
      }
    }
    // A few real lights for night pools near the crossing.
    const nightLights: THREE.PointLight[] = [];
    for (const z of [START_Z - 1, GOAL_Z + 1])
      for (const x of [-12, 12]) {
        const l = new THREE.PointLight('#ffcf80', 0, 24, 1.6);
        l.position.set(x, 6, z);
        scene.add(l);
        nightLights.push(l);
      }

    // ── Vehicles ──
    const glassMat = new THREE.MeshPhysicalMaterial({ color: '#0b0f14', metalness: 0.2, roughness: 0.05, clearcoat: 1 });
    const tyreMat = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 1, roughness: 0.25 });
    const headlight = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6e0', emissiveIntensity: 0.4 });
    const taillight = new THREE.MeshStandardMaterial({ color: '#550000', emissive: '#ff1a1a', emissiveIntensity: 0.4 });
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 18).rotateX(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.32, 10).rotateX(Math.PI / 2);
    const paintMat = (hex: string) =>
      new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.4 });
    const logoTex = (f: FeedTx) => {
      const meta = f.token ? tokenMeta(f.token) : null;
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 192;
      const x = c.getContext('2d')!;
      x.fillStyle = '#f4f1e8';
      x.fillRect(0, 0, 512, 192);
      x.fillStyle = '#d81b2a';
      x.fillRect(0, 160, 512, 32);
      if (meta?.icon?.complete && meta.icon.naturalWidth) x.drawImage(meta.icon, 16, 16, 128, 128);
      x.fillStyle = '#111';
      x.font = 'bold 54px sans-serif';
      x.fillText(meta ? `$${meta.sym}`.slice(0, 12) : 'BSV-21', 160, 100);
      x.font = '24px monospace';
      x.fillText(f.id.slice(0, 16), 160, 142);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const wheels = (g: THREE.Group, len: number, width: number, axles: number[]) => {
      for (const ax of axles)
        for (const s of [1, -1]) {
          const w = new THREE.Mesh(wheelGeo, tyreMat);
          w.position.set(ax * len, 0.42, (s * width) / 2);
          const r = new THREE.Mesh(rimGeo, rimMat);
          r.position.copy(w.position);
          g.add(w, r);
        }
    };
    /** A vehicle for a transaction: kind picks the body, size picks the length. */
    const makeVehicle = (f: FeedTx, lane: number) => {
      const g = new THREE.Group();
      const kind: TxKind = f.kind;
      const truck = kind === 'inscription' || kind === 'token' || (kind === 'data' && f.bytes > 2000);
      const blast = kind === 'blast';
      if (truck) {
        const len = Math.min(13, 7 + Math.log2(Math.max(2, f.bytes)) * 0.45);
        const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 2.3), paintMat(PAINTS[Math.floor(Math.random() * PAINTS.length)]));
        cab.position.set(len / 2 - 1.1, 1.7, 0);
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(len - 2.6, 3, 2.4),
          kind === 'token'
            ? [new THREE.MeshStandardMaterial({ color: '#eee' }), new THREE.MeshStandardMaterial({ color: '#eee' }), new THREE.MeshStandardMaterial({ color: '#ddd' }), new THREE.MeshStandardMaterial({ color: '#ddd' }), new THREE.MeshStandardMaterial({ map: logoTex(f), roughness: 0.4 }), new THREE.MeshStandardMaterial({ map: logoTex(f), roughness: 0.4 })]
            : new THREE.MeshStandardMaterial({ color: kind === 'inscription' ? '#c8c2b8' : '#9aa3ad', roughness: 0.5, metalness: 0.3 }),
        );
        // Box truck: logo panels face the sides (±z after the group turns along x).
        box.rotation.y = kind === 'token' ? Math.PI / 2 : 0;
        if (kind === 'token') box.geometry = new THREE.BoxGeometry(2.4, 3, len - 2.6);
        box.position.set(-1.2, 2, 0);
        const ws = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 2), glassMat);
        ws.position.set(len / 2 - 0.02, 2.2, 0);
        const hl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.25, 0.5), headlight);
        hl.position.set(len / 2, 1, 0.75);
        const hr = hl.clone();
        hr.position.z = -0.75;
        const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.25, 0.4), taillight);
        tl.position.set(-len / 2 + 0.05, 1, 0.9);
        const tr = tl.clone();
        tr.position.z = -0.9;
        g.add(cab, box, ws, hl, hr, tl, tr);
        wheels(g, len / 2, 2.2, [0.75, -0.55, -0.75]);
        g.userData.len = len;
      } else {
        // Sports car / hatch / van silhouette.
        const len = kind === 'payment' || blast ? 4.6 : kind === 'data' ? 5.2 : 4.2;
        const low = kind === 'payment' || blast;
        const body = new THREE.Mesh(new THREE.BoxGeometry(len, low ? 0.75 : 1.1, 2), paintMat(blast ? '#ffffff' : PAINTS[Math.floor(Math.random() * PAINTS.length)]));
        body.position.y = low ? 0.62 : 0.8;
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(len * (low ? 0.45 : kind === 'data' ? 0.7 : 0.55), low ? 0.55 : 0.85, 1.75), glassMat);
        cabin.position.set(low ? -0.3 : -0.2, low ? 1.25 : 1.75, 0);
        const hl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.5), headlight);
        hl.position.set(len / 2, body.position.y, 0.6);
        const hr = hl.clone();
        hr.position.z = -0.6;
        const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 1.6), taillight);
        tl.position.set(-len / 2, body.position.y + 0.1, 0);
        g.add(body, cabin, hl, hr, tl);
        if (low) {
          const wing = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 1.9), body.material);
          wing.position.set(-len / 2 + 0.2, 1.15, 0);
          g.add(wing);
        }
        wheels(g, len / 2, 1.9, [0.65, -0.65]);
        g.userData.len = len;
      }
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      const dir = laneDir(lane);
      g.rotation.y = dir > 0 ? 0 : Math.PI;
      g.position.set(dir > 0 ? -ROAD_HALF : ROAD_HALF, 0, laneZ(lane));
      scene.add(g);
      return g;
    };
    type Veh = { g: THREE.Group; f: FeedTx; lane: number; speed: number; len: number };
    const vehicles: Veh[] = [];
    let level = 1;
    const laneSpeed = (i: number) => (9 + (i % 3) * 4 + (i % 2) * 2) * (1 + (level - 1) * 0.12);

    // ── Player: the NPG chibi, rigged, walking ──
    const player = new THREE.Group();
    scene.add(player);
    let mixer: THREE.AnimationMixer | null = null;
    let walkAct: THREE.AnimationAction | null = null;
    let idleAct: THREE.AnimationAction | null = null;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load('/arena/models/npg/stack/chibi_base.glb', (gl) => {
      if (disposed) return;
      const clips = chibiClips(gl.scene);
      const model = cloneSkinned(gl.scene);
      model.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(model, true);
      const s = 1.6 / (b.max.y - b.min.y);
      model.scale.setScalar(s);
      model.position.y = -b.min.y * s;
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.frustumCulled = false;
        }
      });
      player.add(model);
      mixer = new THREE.AnimationMixer(model);
      walkAct = mixer.clipAction(clips.find((c) => c.name === 'walk')!);
      idleAct = mixer.clipAction(clips.find((c) => c.name === 'idle')!);
      idleAct.play();
    });

    // ── Game state ──
    const STEP = LANE_W;
    let pos = new THREE.Vector3(0, 0, START_Z);
    let target = pos.clone();
    let heading = Math.PI; // facing north (−z)
    let pts = 0;
    let lifeLeft = 3;
    let dead = 0;
    let fling: { v: THREE.Vector3; spin: number } | null = null;
    let dayT = 0.32; // start mid-morning
    const move = (dx: number, dz: number) => {
      if (lifeLeft <= 0 || dead) return;
      setStarted(true);
      target = new THREE.Vector3(Math.max(-ROAD_HALF + 6, Math.min(ROAD_HALF - 6, target.x + dx * STEP)), 0, Math.max(GOAL_Z, Math.min(START_Z, target.z + dz * STEP)));
      heading = Math.atan2(dx, dz);
    };
    const restart = () => {
      pts = 0;
      lifeLeft = 3;
      level = 1;
      pos = new THREE.Vector3(0, 0, START_Z);
      target = pos.clone();
      setScore(0);
      setLives(3);
      setOver(false);
      setKiller(null);
    };
    const skip = () => (dayT = (dayT + 0.5) % 1);
    control.current = { move, restart, skip };
    const key = (e: KeyboardEvent) => {
      const k = e.key;
      const d = k === 'ArrowUp' || k === 'w' ? [0, -1] : k === 'ArrowDown' || k === 's' ? [0, 1] : k === 'ArrowLeft' || k === 'a' ? [-1, 0] : k === 'ArrowRight' || k === 'd' ? [1, 0] : null;
      if (!d) return;
      e.preventDefault();
      move(d[0], d[1]);
    };
    window.addEventListener('keydown', key);

    const sky = new THREE.Color();
    const DAY = new THREE.Color('#8fb8e8');
    const DUSK = new THREE.Color('#e8845a');
    const NIGHT = new THREE.Color('#05070f');
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const sz = renderer.getSize(new THREE.Vector2());
      if (sz.x !== w || sz.y !== h) {
        renderer.setSize(w, h, false);
        composer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }

      // Day cycle: sun arc, sky colour, windows and lamps by night.
      dayT = (dayT + dt / DAY_S) % 1;
      const ang = dayT * Math.PI * 2 - Math.PI / 2; // 0.25 = noon
      const elev = Math.sin(ang);
      sun.position.set(Math.cos(ang) * 120, Math.max(5, elev * 140), 60);
      sun.target.position.set(pos.x, 0, pos.z);
      const night = THREE.MathUtils.clamp(-elev * 3 + 0.2, 0, 1);
      const dusk = THREE.MathUtils.clamp(1 - Math.abs(elev) * 4, 0, 1);
      sky.copy(DAY).lerp(DUSK, dusk * 0.8).lerp(NIGHT, night);
      scene.background = sky;
      (scene.fog as THREE.Fog).color.copy(sky);
      sun.intensity = 3.2 * (1 - night);
      sun.color.set(dusk > 0.4 ? '#ffb27a' : '#fff1dc');
      hemi.intensity = 0.12 + 0.6 * (1 - night);
      renderer.toneMappingExposure = 0.8 - night * 0.15;
      for (const m of towerMats) {
        m.emissiveIntensity = night * 0.55;
        m.envMapIntensity = 0.4 + 1.2 * (1 - night);
      }
      headMat.emissiveIntensity = night * 3;
      headlight.emissiveIntensity = 0.3 + night * 2.5;
      taillight.emissiveIntensity = 0.3 + night * 2;
      for (const l of nightLights) l.intensity = night * 14;
      bloom.strength = 0.05 + night * 0.4;
      const hrs = (dayT * 24 + 6) % 24;
      if (Math.floor(now / 1000) !== Math.floor((now - dt * 1000) / 1000)) setClock(`${String(Math.floor(hrs)).padStart(2, '0')}:${String(Math.floor((hrs % 1) * 60)).padStart(2, '0')}`);

      // Spawn: each lane takes the next live transaction of its kind when its entry is clear.
      LANES.forEach((kind, i) => {
        const dir = laneDir(i);
        const entry = vehicles.filter((v) => v.lane === i).reduce((m, v) => Math.min(m, dir > 0 ? v.g.position.x + ROAD_HALF - v.len / 2 : ROAD_HALF - v.g.position.x - v.len / 2), Infinity);
        if (entry < 10) return;
        const f = feedRef.current.take((t) => t.kind === kind || (kind === 'payment' && t.kind === 'blast'));
        if (!f) return;
        const g = makeVehicle(f, i);
        vehicles.push({ g, f, lane: i, speed: laneSpeed(i) * (0.85 + Math.random() * 0.3), len: g.userData.len });
      });
      for (let i = vehicles.length - 1; i >= 0; i--) {
        const v = vehicles[i];
        // Keep a gap to the vehicle ahead (no clipping through each other).
        const dir = laneDir(v.lane);
        const ahead = vehicles.filter((o) => o !== v && o.lane === v.lane && (o.g.position.x - v.g.position.x) * dir > 0);
        const gap = ahead.reduce((m, o) => Math.min(m, Math.abs(o.g.position.x - v.g.position.x) - (o.len + v.len) / 2), Infinity);
        const sp = gap < 3 ? Math.min(v.speed, (ahead.find((o) => Math.abs(o.g.position.x - v.g.position.x) - (o.len + v.len) / 2 === gap)?.speed ?? v.speed)) : v.speed;
        v.g.position.x += dir * sp * dt;
        if (Math.abs(v.g.position.x) > ROAD_HALF + 20) {
          scene.remove(v.g);
          vehicles.splice(i, 1);
        }
      }

      // Player: glide to the target cell, walk while moving.
      if (!dead) {
        const toGo = target.clone().sub(pos);
        const moving = toGo.length() > 0.05;
        pos.addScaledVector(toGo, Math.min(1, dt * 9));
        if (walkAct && idleAct) {
          if (moving && !walkAct.isRunning()) {
            walkAct.reset().play();
            idleAct.crossFadeTo(walkAct, 0.12, false);
          } else if (!moving && walkAct.isRunning() && walkAct.getEffectiveWeight() > 0.5) {
            idleAct.reset().play();
            walkAct.crossFadeTo(idleAct, 0.2, false);
            setTimeout(() => walkAct?.stop(), 220);
          }
        }
        player.position.copy(pos);
        player.rotation.set(0, THREE.MathUtils.lerp(player.rotation.y, heading, Math.min(1, dt * 12)), 0);
        // Crossed?
        if (target.z <= GOAL_Z + 0.01 && pos.z <= GOAL_Z + 0.2) {
          pts++;
          level = 1 + Math.floor(pts / 3);
          setScore(pts);
          try {
            if (pts > Number(localStorage.getItem(BEST) ?? 0)) {
              localStorage.setItem(BEST, String(pts));
              setBest(pts);
            }
          } catch {
            /* storage blocked */
          }
          pos = new THREE.Vector3(pos.x, 0, START_Z);
          target = pos.clone();
        }
        // Hit?
        const hit = vehicles.find((v) => Math.abs(v.g.position.z - pos.z) < LANE_W * 0.45 && Math.abs(v.g.position.x - pos.x) < v.len / 2 + 0.35);
        if (hit) {
          dead = now;
          lifeLeft--;
          setLives(lifeLeft);
          setKiller(hit.f);
          setWasted(true);
          fling = { v: new THREE.Vector3(laneDir(hit.lane) * hit.speed * 0.6, 9, (Math.random() - 0.5) * 4), spin: 12 };
        }
      } else if (fling) {
        fling.v.y -= 22 * dt;
        player.position.addScaledVector(fling.v, dt);
        player.rotation.x += fling.spin * dt;
        player.rotation.z += fling.spin * 0.6 * dt;
        if (player.position.y < 0) {
          player.position.y = 0;
          fling.v.multiplyScalar(0.3);
          fling.v.y = Math.abs(fling.v.y) * 0.3;
        }
        if (now - dead > 2200) {
          dead = 0;
          fling = null;
          setWasted(false);
          if (lifeLeft <= 0) setOver(true);
          pos = new THREE.Vector3(0, 0, START_Z);
          target = pos.clone();
          player.rotation.set(0, Math.PI, 0);
        }
      }
      mixer?.update(dt);

      // GTA-style chase camera: behind and above, looking across the avenue.
      const camGoal = new THREE.Vector3(player.position.x, 7.5, player.position.z + 11);
      camera.position.lerp(camGoal, Math.min(1, dt * 3));
      camera.lookAt(player.position.x, 1.2, player.position.z - 6);

      composer.render();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    let touch: { x: number; y: number } | null = null;
    const ts = (e: TouchEvent) => (touch = { x: e.touches[0].clientX, y: e.touches[0].clientY });
    const te = (e: TouchEvent) => {
      if (!touch) return;
      const dx = e.changedTouches[0].clientX - touch.x;
      const dy = e.changedTouches[0].clientY - touch.y;
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) move(0, -1);
      else if (Math.abs(dx) > Math.abs(dy)) move(Math.sign(dx), 0);
      else move(0, Math.sign(dy));
      touch = null;
    };
    renderer.domElement.addEventListener('touchstart', ts, { passive: true });
    renderer.domElement.addEventListener('touchend', te);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', key);
      renderer.domElement.removeEventListener('touchstart', ts);
      renderer.domElement.removeEventListener('touchend', te);
      composer.dispose();
      pmrem.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  const meta = killer?.token ? tokenMeta(killer.token) : null;
  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">Chain Frogger</span>
        <span className="text-accent">
          {feed.status === 'live' ? (
            <>
              <span className="blink">●</span> LIVE MAINNET TRAFFIC
            </>
          ) : feed.status === 'off' ? (
            'no feed configured'
          ) : (
            'connecting to the chain…'
          )}
        </span>
      </div>
      <div className="relative">
        <div ref={mount} className="inset h-[72vh] min-h-96 w-full touch-none overflow-hidden" />
        <div className="pointer-events-none absolute right-3 top-3 text-right font-bold text-hot drop-shadow">
          <div className="text-2xl">{clock}</div>
          <div className="text-sm">{'♥'.repeat(Math.max(0, lives))}</div>
        </div>
        <button onClick={() => control.current?.skip()} className="btn absolute left-3 top-3 text-xs">
          ☀/☾ skip
        </button>
        {wasted && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-6xl font-bold tracking-widest text-[#d81b2a] drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]" style={{ fontFamily: 'Georgia, serif' }}>
              WASTED
            </span>
          </div>
        )}
        {!started && !over && (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-1 text-center">
            <p className="bg-black/60 px-3 py-1 text-2xl font-bold text-hot">CHAIN FROGGER</p>
            <p className="max-w-md bg-black/60 px-3 py-1 text-sm text-fg">Every vehicle is a real BSV transaction, live. Cross the avenue: arrows / WASD, or swipe and tap.</p>
          </div>
        )}
        {over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-center">
            <p className="text-3xl font-bold text-hot">GAME OVER</p>
            <p className="text-sm text-fg">
              You crossed {score} times. Best: {best}.
            </p>
            <button onClick={() => control.current?.restart()} className="btn-fire">
              AGAIN
            </button>
          </div>
        )}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <div className="inset px-2 py-1">
          <span className="text-dim">Crossings: </span>
          <span className="text-hot">{score}</span>
        </div>
        <div className="inset px-2 py-1">
          <span className="text-dim">Lives: </span>
          <span className="text-hot">{Math.max(0, lives)}</span>
        </div>
        <div className="inset px-2 py-1">
          <span className="text-dim">Best: </span>
          <span className="text-hot">{best}</span>
        </div>
      </div>
      {killer && (
        <p className="mt-2 text-sm text-dim">
          Run over by a {KINDS.find((k) => k.id === killer.kind)?.label.toLowerCase()}
          {meta ? ` moving $${meta.sym}` : ''} ({killer.bytes.toLocaleString()} bytes, {killer.mined ? 'mined' : 'in mempool'}):{' '}
          <a href={`https://whatsonchain.com/tx/${killer.id}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">
            {killer.id.slice(0, 16)}… ↗
          </a>
        </p>
      )}
      <div className="mt-2 flex justify-center gap-2 sm:hidden">
        {(
          [
            ['←', -1, 0],
            ['↑', 0, -1],
            ['↓', 0, 1],
            ['→', 1, 0],
          ] as const
        ).map(([l, dx, dz]) => (
          <button key={l} onClick={() => control.current?.move(dx, dz)} className="btn px-5 py-3 text-xl">
            {l}
          </button>
        ))}
      </div>
    </section>
  );
}
