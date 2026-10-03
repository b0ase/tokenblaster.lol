'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * 3D card stacks: the Ninja Punk Girls cards stack in 2D because every part shares one canvas.
 * Here every 3D part card snaps onto one rigged chibi base. Rigid parts (hair, horns, masks,
 * weapons) attach to a bone; the slot's box on the base says where the part goes and how big.
 */
const BASE = '/arena/models/npg/stack/chibi_base.glb';
const HAIR = [
  { id: 'base', name: 'Base hair (chibi)', url: null, turn: 0 },
  { id: 'miyuki', name: 'Miyuki hair', url: '/arena/models/npg/stack/E001MiyukiHair.glb', turn: 0 },
  { id: 'yamarashii', name: 'Yamarashii hair', url: '/arena/models/npg/stack/E002YamarashiiHair.glb', turn: Math.PI },
  { id: 'hikaru', name: 'Hikaru hair', url: '/arena/models/npg/stack/E003HikaruHair.glb', turn: 0 },
  { id: 'nao', name: 'Nao hair', url: '/arena/models/npg/stack/E011NaoHair.glb', turn: Math.PI },
];

export function StackBuilder() {
  const mount = useRef<HTMLDivElement>(null);
  const [hair, setHair] = useState('miyuki');
  const [fit, setFit] = useState({ scale: 1, y: 0, z: 0, turn: 0 });
  const [showClothes, setShowClothes] = useState(true);
  const [status, setStatus] = useState('loading…');
  const api = useRef<{ setHair: (id: string) => void; setFit: (f: typeof fit) => void; setClothes: (v: boolean) => void } | null>(null);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#120707');
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    camera.position.set(0, 1.2, 4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight('#ffe8dc', '#2a0c0c', 0.7));
    const key = new THREE.DirectionalLight('#fff2e6', 2);
    key.position.set(2, 4, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#ff5a48', 1.4);
    rim.position.set(-3, 2, -3);
    scene.add(rim);
    const grid = new THREE.GridHelper(6, 12, '#5a1a14', '#2a0a0a');
    scene.add(grid);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const load = (url: string) => new Promise<GLTF>((ok, no) => loader.load(url, ok, undefined, no));

    let base: THREE.Object3D | null = null;
    let head: THREE.Object3D | null = null;
    let baseHair: THREE.Object3D | null = null;
    let clothes: THREE.Object3D | null = null;
    let slot: THREE.Box3 | null = null; // where hair goes, in the head bone's space
    let current: THREE.Object3D | null = null;
    let fitNow = { scale: 1, y: 0, z: 0, turn: 0 };
    const cache = new Map<string, THREE.Object3D>();

    const place = () => {
      if (!current || !slot) return;
      // Fit the part's box into the slot box (same width, centred), then apply manual tweaks.
      const raw = current.userData.raw as THREE.Box3;
      const rs = raw.getSize(new THREE.Vector3());
      const ss = slot.getSize(new THREE.Vector3());
      const k = Math.max(ss.x / rs.x, ss.z / rs.z) * fitNow.scale;
      current.scale.setScalar(k);
      // Each part card came out of its own generation facing its own way: per-card turn, plus any manual turn.
      current.rotation.set(0, ((current.userData.turn as number) ?? 0) + fitNow.turn, 0);
      const rc = raw.getCenter(new THREE.Vector3()).multiplyScalar(k).applyEuler(current.rotation);
      const sc = slot.getCenter(new THREE.Vector3());
      current.position.set(sc.x - rc.x, sc.y - rc.y + fitNow.y, sc.z - rc.z + fitNow.z);
    };

    const setHairPart = async (id: string) => {
      const def = HAIR.find((h) => h.id === id);
      if (!head || !def) return;
      if (current) head.remove(current);
      current = null;
      if (baseHair) baseHair.visible = !def.url;
      if (!def.url) return;
      let part = cache.get(id);
      if (!part) {
        const g = await load(def.url);
        if (disposed) return;
        part = g.scene;
        part.updateMatrixWorld(true);
        part.userData.raw = new THREE.Box3().setFromObject(part, true);
        part.userData.turn = def.turn;
        cache.set(id, part);
      }
      current = part;
      head.add(part);
      place();
    };

    (async () => {
      try {
        const g = await load(BASE);
        if (disposed) return;
        base = g.scene;
        // Stand her at 2 m on the floor.
        base.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(base, true);
        const s = 2 / b.getSize(new THREE.Vector3()).y;
        base.scale.setScalar(s);
        base.position.y = -b.min.y * s;
        scene.add(base);
        base.updateMatrixWorld(true);
        base.traverse((o) => {
          if (o.name === 'head') head = o;
          if (o.name === 'hair' && (o as THREE.Mesh).isMesh !== undefined) baseHair = o;
          if (o.name === 'clothes') clothes = o;
          if ((o as THREE.Mesh).isMesh) o.frustumCulled = false;
        });
        if (!head) throw new Error('No head bone in the base model.');
        const hb = baseHair as THREE.Object3D | null;
        if (hb) {
          // The slot: the base hair's bounds, expressed in the head bone's local space.
          const world = new THREE.Box3().setFromObject(hb, true);
          const inv = (head as THREE.Object3D).matrixWorld.clone().invert();
          slot = world.clone().applyMatrix4(inv);
        } else slot = new THREE.Box3(new THREE.Vector3(-0.3, 0, -0.3), new THREE.Vector3(0.3, 0.6, 0.3));
        api.current = {
          setHair: (id) => void setHairPart(id),
          setFit: (f) => {
            fitNow = f;
            place();
          },
          setClothes: (v) => {
            if (clothes) clothes.visible = v;
          },
        };
        await setHairPart('miyuki');
        setStatus('');
      } catch (e) {
        setStatus(`Could not load: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();

    let raf = 0;
    const tick = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const sz = renderer.getSize(new THREE.Vector2());
      if (sz.x !== w || sz.y !== h) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      controls.dispose();
      pmrem.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => api.current?.setHair(hair), [hair]);
  useEffect(() => api.current?.setFit(fit), [fit]);
  useEffect(() => api.current?.setClothes(showClothes), [showClothes]);

  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">3D card stack builder (Ninja Punk Girls)</span>
        <span className="text-xs text-dim">base: rigged chibi · parts snap to bones</span>
      </div>
      <div className="relative">
        <div ref={mount} className="inset h-[60vh] min-h-72 w-full touch-none" />
        {status && <p className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 text-dim">{status}</p>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-dim">HAIR CARD:</span>
        {HAIR.map((h) => (
          <button key={h.id} onClick={() => setHair(h.id)} className={`btn ${hair === h.id ? 'btn-on' : ''}`}>
            {h.name}
          </button>
        ))}
        <button onClick={() => setShowClothes((v) => !v)} className={`btn ${showClothes ? 'btn-on' : ''}`}>
          CLOTHES
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-dim">
        {(['scale', 'y', 'z', 'turn'] as const).map((k) => (
          <label key={k} className="flex items-center gap-1">
            {k === 'scale' ? 'size' : k === 'y' ? 'up/down' : k === 'z' ? 'fwd/back' : 'turn'}
            <input
              type="range"
              min={k === 'scale' ? 0.6 : k === 'turn' ? -Math.PI : -0.3}
              max={k === 'scale' ? 1.6 : k === 'turn' ? Math.PI : 0.3}
              step={0.005}
              value={fit[k]}
              onChange={(e) => setFit((f) => ({ ...f, [k]: Number(e.target.value) }))}
              className="w-32 accent-[#ff5a48]"
            />
          </label>
        ))}
        <span>Fit tweaks get saved per card once the set is final.</span>
      </div>
    </section>
  );
}
