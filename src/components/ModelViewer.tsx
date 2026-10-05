'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GUNS, MONSTERS } from '@/lib/arenaHD';
import { chibiClips } from '@/lib/chibiAnims';
import { retargetMixamo } from '@/lib/mixamoRetarget';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const MIXAMO: [string, string][] = [
  ['mixamo_walk.fbx', 'Mixamo walk'],
  ['mixamo_walk2.fbx', 'Mixamo walk 2'],
  ['mixamo_zombie_idle.fbx', 'Mixamo zombie idle'],
];

const MODELS = [
  { id: 'miyuki_parts', label: 'Miyuki split into parts (Tripo segmentation)', url: '/arena/models/npg/miyuki_parts.glb' },
  ...MONSTERS.map((m) => ({ id: m.id, label: m.id === 'miyuki' ? 'Miyuki (Ninja Punk Girls)' : m.id, url: m.url })),
  ...GUNS.map((g) => ({ id: g.id, label: `gun: ${g.name}`, url: g.url })),
  { id: 'doubleo_agent', label: 'Double-O: agent (Business Man)', url: '/arena/models/doubleo/agent.glb' },
  { id: 'doubleo_goon', label: 'Double-O: goon (Mob Suit)', url: '/arena/models/doubleo/goon.glb' },
  { id: 'doubleo_bot', label: 'Double-O: guard bot (Evil Robot)', url: '/arena/models/doubleo/bot.glb' },
];

// NPG 3D part cards (hair from Anything.world; masks/horns from Tripo, listed in parts.json).
const NPG_HAIR = ['E001MiyukiHair', 'E002YamarashiiHair', 'E003HikaruHair', 'E011NaoHair'].map((id) => ({
  id,
  label: `NPG hair: ${id.slice(4).replace(/Hair$/, '')}`,
  url: `/arena/models/npg/stack/${id}.glb`,
}));
type Model = { id: string; label: string; url: string; node?: string };
// The chibi base's own mask (the Ayumi design), pulled out of the base model for side-by-side checks.
const BASE_MASK: Model = { id: 'base_mask', label: 'NPG mask: Base mask (chibi) = Ayumi', url: '/arena/models/npg/stack/chibi_base.glb', node: 'mask' };

/** A whole model, or one named mesh pulled out of it (as a plain mesh in its bind pose). */
function pickNode(root: THREE.Object3D, id: string): THREE.Object3D {
  const name = id === BASE_MASK.id ? BASE_MASK.node : undefined;
  if (!name) return root;
  root.updateMatrixWorld(true);
  const out = new THREE.Group();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (o.name === name || o.parent?.name === name)) {
      const copy = new THREE.Mesh(m.geometry, m.material);
      copy.applyMatrix4(m.matrixWorld);
      out.add(copy);
    }
  });
  return out.children.length ? out : root;
}

type Clip = { name: string; duration: number };

/**
 * Inspect any arena model: orbit/zoom/pan, studio lighting, play or scrub animations, wireframe,
 * auto-spin, and WASD to walk the character about the floor.
 */
export function ModelViewer() {
  const mount = useRef<HTMLDivElement>(null);
  const [modelId, setModelId] = useState('miyuki_parts');
  const [cards, setCards] = useState<Model[]>([...NPG_HAIR, BASE_MASK]);
  const [compareId, setCompareId] = useState('');
  const cardsRef = useRef(cards);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);
  useEffect(() => {
    fetch('/arena/models/npg/stack/parts.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((ps: { id: string; name: string; slot: string; url: string }[]) =>
        setCards([...NPG_HAIR, BASE_MASK, ...ps.map((p) => ({ id: p.id, label: `NPG ${p.slot}: ${p.name}`, url: p.url }))]),
      )
      .catch(() => {});
  }, []);
  const [clips, setClips] = useState<Clip[]>([]);
  const [clipIdx, setClipIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [time, setTime] = useState(0);
  const [wire, setWire] = useState(false);
  const [spin, setSpin] = useState(false);
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(true);
  const [parts, setParts] = useState<{ name: string; visible: boolean }[]>([]);
  const [colourParts, setColourParts] = useState(false);
  const [explode, setExplode] = useState(0);
  // The render loop reads UI state through this ref; UI writes scrubs through `seek`.
  const ui = useRef({ playing, speed, wire, spin, clipIdx, colourParts, explode, hidden: new Set<string>(), seek: null as number | null });
  useEffect(() => {
    ui.current = { ...ui.current, playing, speed, wire, spin, clipIdx, colourParts, explode, hidden: new Set(parts.filter((p) => !p.visible).map((p) => p.name)) };
  }, [playing, speed, wire, spin, clipIdx, colourParts, explode, parts]);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#120707');
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
    camera.position.set(0, 1.4, 4.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.enableDamping = true;

    scene.add(new THREE.HemisphereLight('#ffe8dc', '#2a0c0c', 0.6));
    const key = new THREE.DirectionalLight('#fff2e6', 2.2);
    key.position.set(3, 5, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#f5b800', 1.6);
    rim.position.set(-4, 3, -4);
    scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.MeshStandardMaterial({ color: '#1e0c0a', roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(12, 24, '#5a1a14', '#1a1300');
    grid.position.y = 0.002;
    scene.add(grid);

    const holder = new THREE.Group(); // walked about with WASD
    scene.add(holder);
    let mixer: THREE.AnimationMixer | null = null;
    let actions: THREE.AnimationAction[] = [];
    let current = -1;
    let meshes: { mesh: THREE.Mesh; name: string; original: THREE.Material | THREE.Material[]; debug: THREE.Material; home: THREE.Vector3; dir: THREE.Vector3 }[] = [];
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const url = [...cardsRef.current, ...MODELS].find((m) => m.id === modelId)?.url ?? MODELS[0].url;
    loader.load(
      url,
      async (gltf) => {
        if (disposed) return;
        if (modelId === 'chibi') {
          // Code-made loops plus the owner's Mixamo downloads, retargeted onto her rig.
          gltf.animations = chibiClips(gltf.scene);
          const fbx = new FBXLoader();
          for (const [file, label] of MIXAMO) {
            try {
              const src = await fbx.loadAsync(`/arena/models/npg/anims/${file}`);
              if (src.animations[0]) gltf.animations.push(retargetMixamo(src, src.animations[0], gltf.scene, label));
            } catch (e) {
              console.warn('mixamo', file, e);
            }
          }
          if (disposed) return;
        }
        const model = pickNode(gltf.scene, modelId);
        // Tripo part cards often come out lying along Z: turn them to face the camera.
        if (cardsRef.current.some((c) => c.id === modelId)) {
          const raw = new THREE.Box3().setFromObject(model, true).getSize(new THREE.Vector3());
          if (raw.z > raw.x) model.rotation.y = -Math.PI / 2;
        }
        // Stand it on the floor at about 2 m (guns: 1 m long), centred.
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model, true);
        const size = box.getSize(new THREE.Vector3());
        const isGun = GUNS.some((g) => g.id === modelId);
        const isCard = cardsRef.current.some((c) => c.id === modelId);
        // Guns 1 m long; part cards 1 m across, floating at 1 m; characters 2 m tall on the floor.
        const s = isGun || isCard ? 1 / Math.max(size.x, size.y, size.z) : 2 / Math.max(0.001, size.y);
        model.scale.setScalar(s);
        const c = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
        model.position.set(-c.x, isGun || isCard ? 1 - c.y : -box.min.y * s, -c.z);
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.frustumCulled = false;
          }
        });
        holder.add(model);
        if (compareId) model.position.x -= 0.7;
        // Parts: every mesh, with its original material, a debug colour and its direction from the centre (for explode).
        const centre = new THREE.Box3().setFromObject(model, true).getCenter(new THREE.Vector3());
        meshes = [];
        let k = 0;
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const c = new THREE.Box3().setFromObject(m, true).getCenter(new THREE.Vector3());
          const dir = c.sub(centre);
          const local = m.parent ? m.parent.worldToLocal(m.getWorldPosition(new THREE.Vector3()).add(dir)).sub(m.position) : dir;
          meshes.push({ mesh: m, name: m.name || `part_${k}`, original: m.material, debug: new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL((k * 0.618) % 1, 0.75, 0.55), roughness: 0.6 }), home: m.position.clone(), dir: local });
          k++;
        });
        setParts(meshes.length > 1 ? meshes.map((x) => ({ name: x.name, visible: true })) : []);
        let tris = 0;
        model.traverse((o) => {
          const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
          if (g) tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
        });
        setInfo(`${Math.round(tris).toLocaleString()} triangles · ${gltf.animations.length} animation clip(s)`);
        if (gltf.animations.length && modelId !== BASE_MASK.id) {
          mixer = new THREE.AnimationMixer(model);
          actions = gltf.animations.map((a) => mixer!.clipAction(a));
          setClips(gltf.animations.map((a) => ({ name: a.name, duration: a.duration })));
        } else setClips([]);
        setLoading(false);
      },
      undefined,
      (e) => !disposed && setInfo(`Could not load: ${e instanceof Error ? e.message : String(e)}`),
    );

    // Side-by-side: a second model, same height, to the right.
    if (compareId) {
      const cdef = [...cardsRef.current, ...MODELS].find((m) => m.id === compareId);
      if (cdef)
        loader.load(cdef.url, (g) => {
          if (disposed) return;
          const m2 = pickNode(g.scene, compareId);
          const raw = new THREE.Box3().setFromObject(m2, true).getSize(new THREE.Vector3());
          if (cardsRef.current.some((c) => c.id === compareId) && raw.z > raw.x) m2.rotation.y = -Math.PI / 2;
          m2.updateMatrixWorld(true);
          const b2 = new THREE.Box3().setFromObject(m2, true);
          const sz2 = b2.getSize(new THREE.Vector3());
          const s2 = 1 / Math.max(sz2.x, sz2.y, sz2.z);
          m2.scale.setScalar(s2);
          const c2 = b2.getCenter(new THREE.Vector3()).multiplyScalar(s2);
          m2.position.set(0.7 - c2.x, 1 - c2.y, -c2.z);
          m2.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) {
              o.castShadow = true;
              o.frustumCulled = false;
            }
          });
          holder.add(m2);
        });
    }

    const keys = new Set<string>();
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.type === 'keydown') keys.add(e.code);
      else keys.delete(e.code);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    const timer = new THREE.Timer();
    let raf = 0;
    let lastPush = 0;
    const tick = (t?: number) => {
      timer.update(t);
      const dt = Math.min(0.05, timer.getDelta());
      const w = el.clientWidth;
      const h = el.clientHeight;
      const sz = renderer.getSize(new THREE.Vector2());
      if (sz.x !== w || sz.y !== h) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      const u = ui.current;
      if (mixer && actions.length) {
        if (current !== u.clipIdx) {
          actions.forEach((a) => a.stop());
          current = u.clipIdx;
          actions[current]?.play();
        }
        const a = actions[current];
        if (a) {
          if (u.seek !== null) {
            a.time = u.seek;
            u.seek = null;
            mixer.update(0);
          } else if (u.playing) mixer.update(dt * u.speed);
          if (performance.now() - lastPush > 100) {
            lastPush = performance.now();
            setTime(a.time);
          }
        }
      }
      holder.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && 'wireframe' in m) m.wireframe = u.wire;
      });
      for (const x of meshes) {
        x.mesh.material = u.colourParts ? x.debug : x.original;
        x.mesh.visible = !u.hidden.has(x.name);
        x.mesh.position.copy(x.home).addScaledVector(x.dir, u.explode);
      }
      if (u.spin) holder.rotation.y += dt * 0.6;
      // WASD: walk the model about, facing the way it moves (relative to the camera).
      const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      if (f || r) {
        const fwd = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize();
        const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
        const dir = fwd.multiplyScalar(f).add(right.multiplyScalar(r)).normalize();
        holder.position.addScaledVector(dir, dt * 1.6);
        holder.position.clampLength(0, 5);
        holder.rotation.y = Math.atan2(dir.x, dir.z);
        controls.target.set(holder.position.x, 1, holder.position.z);
      }
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      controls.dispose();
      pmrem.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [modelId, compareId]);

  const clip = clips[clipIdx];
  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">Inspect</span>
        <select
          value={modelId}
          onChange={(e) => {
            setLoading(true);
            setClipIdx(0);
            setParts([]);
            setExplode(0);
            setModelId(e.target.value);
          }}
          className="inset bg-input px-2 py-1 text-hot"
        >
          <optgroup label="NPG 3D cards">
            {cards.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Arena">
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
        </select>
        <select value={compareId} onChange={(e) => setCompareId(e.target.value)} className="inset bg-input px-2 py-1 text-hot">
          <option value="">compare with… (none)</option>
          {cards.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="relative">
        <div ref={mount} className="inset h-[68vh] min-h-80 w-full touch-none" />
        {loading && <p className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 text-dim">loading…</p>}
        <p className="pointer-events-none absolute left-2 top-2 text-xs text-dim">drag: orbit · scroll: zoom · right-drag: pan · WASD: walk</p>
        <p className="pointer-events-none absolute right-2 top-2 text-xs text-dim">{info}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {clips.length > 1 && (
          <select value={clipIdx} onChange={(e) => setClipIdx(Number(e.target.value))} className="inset bg-input px-2 py-1 text-hot">
            {clips.map((c, i) => (
              <option key={c.name + i} value={i}>
                {c.name} ({c.duration.toFixed(1)}s)
              </option>
            ))}
          </select>
        )}
        {clip && (
          <>
            <button onClick={() => setPlaying((p) => !p)} className="btn text-xs">
              {playing ? 'PAUSE' : 'PLAY'}
            </button>
            <input
              type="range"
              min={0}
              max={clip.duration}
              step={0.01}
              value={time}
              onChange={(e) => {
                ui.current.seek = Number(e.target.value);
                setTime(Number(e.target.value));
              }}
              className="min-w-40 flex-1 accent-[#f5b800]"
              aria-label="Scrub animation"
            />
            <span className="w-24 text-right tabular-nums text-dim">
              {time.toFixed(2)} / {clip.duration.toFixed(1)}s
            </span>
            <label className="flex items-center gap-1 text-xs text-dim">
              speed
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="inset bg-input px-1 text-hot">
                {[0.25, 0.5, 1, 1.5, 2].map((v) => (
                  <option key={v} value={v}>
                    {v}×
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {parts.length > 0 && (
          <>
            <button onClick={() => setColourParts((v) => !v)} className={`btn text-xs ${colourParts ? 'btn-on' : ''}`}>
              COLOUR PARTS
            </button>
            <label className="flex items-center gap-1 text-xs text-dim">
              explode
              <input type="range" min={0} max={2.5} step={0.01} value={explode} onChange={(e) => setExplode(Number(e.target.value))} className="w-28 accent-[#f5b800]" />
            </label>
          </>
        )}
        <button onClick={() => setWire((v) => !v)} className={`btn text-xs ${wire ? 'btn-on' : ''}`}>
          WIREFRAME
        </button>
        <button onClick={() => setSpin((v) => !v)} className={`btn text-xs ${spin ? 'btn-on' : ''}`}>
          AUTO-SPIN
        </button>
      </div>
      {parts.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 text-xs">
          <span className="text-dim">{parts.length} parts (click to hide/show):</span>
          {parts.map((p, i) => (
            <button
              key={p.name}
              onClick={() => setParts((ps) => ps.map((q, k) => (k === i ? { ...q, visible: !q.visible } : q)))}
              className={`btn px-1 ${p.visible ? 'btn-on' : 'opacity-50'}`}
            >
              {i}
            </button>
          ))}
        </div>
      )}
      {modelId === 'miyuki' && (
        <p className="mt-2 text-xs text-dim">
          Miyuki: Tripo image-to-3D from her Ninja Punk Girls layers, auto-rigged. Her five test moves (idle, walk, run, slash, hurt) came back
          blended into one clip; scrub through it. A full batch would request each move separately.
        </p>
      )}
    </section>
  );
}
