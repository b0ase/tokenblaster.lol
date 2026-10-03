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
 * The four hair cards were made in Anything.world from the 2D hair cards.
 */
const BASE = '/arena/models/npg/stack/chibi_base.glb';
const HAIR = [
  { id: 'base', name: 'Base hair (chibi)', url: null, turn: 0 },
  { id: 'miyuki', name: 'Miyuki hair', url: '/arena/models/npg/stack/E001MiyukiHair.glb', turn: 0 },
  { id: 'yamarashii', name: 'Yamarashii hair', url: '/arena/models/npg/stack/E002YamarashiiHair.glb', turn: Math.PI },
  { id: 'hikaru', name: 'Hikaru hair', url: '/arena/models/npg/stack/E003HikaruHair.glb', turn: 0 },
  { id: 'nao', name: 'Nao hair', url: '/arena/models/npg/stack/E011NaoHair.glb', turn: Math.PI },
];
// First Tripo test: the Mecha-Style mask card (11_011), image-to-3D from the 2D card.
const MASK = '/arena/models/npg/stack/M011MechaMask.glb';

export function StackBuilder() {
  const mount = useRef<HTMLDivElement>(null);
  const [hair, setHair] = useState('miyuki');
  const [fit, setFit] = useState({ scale: 1, y: 0, z: 0, turn: 0 });
  const [showClothes, setShowClothes] = useState(true);
  const [showMask, setShowMask] = useState(false);
  const [maskFit, setMaskFit] = useState({ scale: 1, y: 0, z: 0, turn: 0 });
  const [copied, setCopied] = useState(false);
  const copyFit = () => {
    const r = (f: typeof fit) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v.toFixed(3))]));
    const all = { hair: { card: hair, ...r(fit) }, ...(showMask ? { mask: { card: 'M011MechaMask', ...r(maskFit) } } : {}) };
    navigator.clipboard?.writeText(JSON.stringify(all)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const [status, setStatus] = useState('loading…');
  const api = useRef<{ setHair: (id: string) => void; setFit: (f: typeof fit) => void; setClothes: (v: boolean) => void; setMask: (v: boolean) => void; setMaskFit: (f: typeof fit) => void } | null>(null);

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

    let maskSlot: THREE.Box3 | null = null; // the base mask's bounds in head space
    let maskPart: THREE.Object3D | null = null;
    let baseMask: THREE.Object3D | null = null;
    let maskFit = { scale: 1, y: 0, z: 0, turn: 0 };
    const placeMask = () => {
      if (!maskPart || !maskSlot) return;
      // Tripo built this card lying along Z (its width runs front to back): a quarter turn first,
      // then to the face side, plus the manual turn. Fit the mask's width, front on the face.
      maskPart.rotation.set(0, -Math.PI / 2 + (faceSign > 0 ? 0 : Math.PI) + maskFit.turn, 0);
      const raw = maskPart.userData.raw as THREE.Box3;
      const rb = raw.clone().applyMatrix4(new THREE.Matrix4().makeRotationY(maskPart.rotation.y));
      const k = (maskSlot.getSize(new THREE.Vector3()).x / Math.max(1e-6, rb.getSize(new THREE.Vector3()).x)) * maskFit.scale;
      maskPart.scale.setScalar(k);
      const c = maskSlot.getCenter(new THREE.Vector3());
      const rc = rb.getCenter(new THREE.Vector3());
      const z = faceSign > 0 ? maskSlot.max.z - rb.max.z * k : maskSlot.min.z - rb.min.z * k;
      maskPart.position.set(c.x - rc.x * k, c.y - rc.y * k + maskFit.y, z + maskFit.z * faceSign);
    };
    const setMaskPart = async (on: boolean) => {
      if (!head || !maskSlot) return;
      if (baseMask) baseMask.visible = !on;
      if (!on) {
        if (maskPart) maskPart.visible = false;
        return;
      }
      if (!maskPart) {
        const g = await load(MASK);
        if (disposed) return;
        maskPart = g.scene;
        maskPart.updateMatrixWorld(true);
        maskPart.userData.raw = new THREE.Box3().setFromObject(maskPart, true);
        head.add(maskPart);
      }
      placeMask();
      maskPart.visible = true;
    };

    let faceSign = 1; // which way the face points along the head bone's Z (from where the mask sits)
    const place = () => {
      if (!current || !slot) return;
      // Hair sits like hair: scaled to the head's width, its top on top of the head and its front
      // edge on the hairline. (Centring boxes pushed cards with long tails up and forward.)
      current.rotation.set(0, ((current.userData.turn as number) ?? 0) + fitNow.turn, 0); // per-card facing + manual turn
      const raw = current.userData.raw as THREE.Box3;
      const rb = raw.clone().applyMatrix4(new THREE.Matrix4().makeRotationY(current.rotation.y));
      const k = (slot.getSize(new THREE.Vector3()).x / Math.max(1e-6, rb.getSize(new THREE.Vector3()).x)) * fitNow.scale;
      current.scale.setScalar(k);
      const x = slot.getCenter(new THREE.Vector3()).x - rb.getCenter(new THREE.Vector3()).x * k;
      // Sink it onto the scalp: hair cards include volume above the head line.
      const y = slot.max.y - rb.max.y * k - slot.getSize(new THREE.Vector3()).y * 0.12;
      const z = faceSign > 0 ? slot.max.z - rb.max.z * k : slot.min.z - rb.min.z * k;
      current.position.set(x, y + fitNow.y, z + fitNow.z * faceSign);
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
          let face: THREE.Object3D | null = null;
          (base as THREE.Object3D).traverse((o) => {
            if (o.name === 'mask' || (!face && o.name === 'head_1')) face = o;
          });
          if (face) {
            if ((face as THREE.Object3D).name === 'mask') {
              baseMask = face;
              maskSlot = new THREE.Box3().setFromObject(face, true).applyMatrix4(inv);
            }
            const fc = new THREE.Box3().setFromObject(face, true).applyMatrix4(inv).getCenter(new THREE.Vector3());
            faceSign = fc.z >= slot.getCenter(new THREE.Vector3()).z ? 1 : -1;
          }
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
          setMask: (v) => void setMaskPart(v),
          setMaskFit: (f) => {
            maskFit = f;
            placeMask();
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
  useEffect(() => api.current?.setMask(showMask), [showMask]);
  useEffect(() => api.current?.setMaskFit(maskFit), [maskFit]);

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
        <button onClick={() => setShowMask((v) => !v)} className={`btn ${showMask ? 'btn-on' : ''}`}>
          MECHA MASK (Tripo test)
        </button>
      </div>
      <FitSliders label="HAIR" card={hair} fit={fit} onChange={setFit} />
      {showMask && <FitSliders label="MASK" card="M011MechaMask" fit={maskFit} onChange={setMaskFit} />}
      <button onClick={copyFit} className="btn btn-on mt-2 text-xs">
        {copied ? 'COPIED ✓' : 'COPY ALL FIT SETTINGS'}
      </button>
      <p className="mt-1 text-xs text-dim">Fit tweaks get saved per card once the set is final.</p>
    </section>
  );
}

type Fit = { scale: number; y: number; z: number; turn: number };

function FitSliders({ label, card, fit, onChange }: { label: string; card: string; fit: Fit; onChange: (f: Fit) => void }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify({
    slot: label.toLowerCase(),
    card,
    scale: Number(fit.scale.toFixed(3)),
    y: Number(fit.y.toFixed(3)),
    z: Number(fit.z.toFixed(3)),
    turn: Number(fit.turn.toFixed(3)),
  });
  const copy = () =>
    navigator.clipboard?.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return (
    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-dim">
      <span className="w-10">{label}</span>
      {(['scale', 'y', 'z', 'turn'] as const).map((k) => (
        <label key={k} className="flex items-center gap-1">
          {k === 'scale' ? 'size' : k === 'y' ? 'up/down' : k === 'z' ? 'fwd/back' : 'turn'}
          <input
            type="range"
            min={k === 'scale' ? 0.3 : k === 'turn' ? -Math.PI : -0.3}
            max={k === 'scale' ? 1.6 : k === 'turn' ? Math.PI : 0.3}
            step={0.005}
            value={fit[k]}
            onChange={(e) => onChange({ ...fit, [k]: Number(e.target.value) })}
            className="w-32 accent-[#ff5a48]"
          />
        </label>
      ))}
      <button onClick={() => onChange({ scale: 1, y: 0, z: 0, turn: 0 })} className="btn text-xs">
        reset
      </button>
      <button onClick={copy} className="btn text-xs">
        {copied ? 'copied ✓' : 'copy JSON'}
      </button>
      <code className="select-all text-accent">{json}</code>
    </div>
  );
}
