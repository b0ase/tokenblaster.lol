/**
 * Vehicles for Satoshi City: the same CC-BY models as Chain Frogger (public/arcade/frogger/vehicles,
 * credited in public/arena/CREDITS.md), loaded once, normalised to a 1 m template (nose +x, wheels
 * on y = 0), repainted per car, lamp atlas glowing at night, token logos on box trucks.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { FeedTx } from '@/lib/feed';
import { tokenMeta } from '@/lib/tokenMeta';

export type ModelKey = 'sports' | 'sedan' | 'cruiser' | 'taxi' | 'van' | 'boxtruck' | 'bus' | 'supercar';
const MODELS: Record<ModelKey, { rotY: number; paint: boolean }> = {
  sports: { rotY: 0, paint: true },
  sedan: { rotY: 0, paint: true },
  cruiser: { rotY: 0, paint: true },
  taxi: { rotY: 0, paint: false },
  van: { rotY: 0, paint: true },
  boxtruck: { rotY: 0, paint: true },
  bus: { rotY: 0, paint: false },
  supercar: { rotY: Math.PI / 2, paint: true },
};
const DECAL_Z = 0.214; // boxtruck cargo-box side, in the 1 m template's units
export const PAINTS = ['#d81b2a', '#f2f2f2', '#111216', '#1e5bd8', '#f5b700', '#2bb673', '#8a2be2', '#ff6a00', '#9aa3ad'];
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

const truckLen = (f: FeedTx) => Math.min(12, 7 + Math.log2(Math.max(2, f.bytes)) * 0.4);
/** Body and length for a transaction: kind picks the vehicle, size picks how long it is. */
export function pickModel(f: FeedTx): { k: ModelKey; len: number } {
  if (f.kind === 'blast') return { k: 'supercar', len: 4.7 };
  if (f.kind === 'token') return { k: 'boxtruck', len: Math.min(9, truckLen(f)) };
  if (f.kind === 'inscription' || (f.kind === 'data' && f.bytes > 2000)) {
    const len = truckLen(f);
    return len > 9.5 ? { k: 'bus', len } : { k: 'boxtruck', len };
  }
  if (f.kind === 'payment') return { k: pick(['sports', 'sports', 'sedan', 'cruiser'] as const), len: 4.5 };
  if (f.kind === 'data') return { k: 'van', len: 5.4 };
  return { k: pick(['sedan', 'cruiser', 'taxi', 'taxi'] as const), len: 4.7 };
}

export type Built = { g: THREE.Group; len: number; w: number; k: ModelKey; decal?: THREE.MeshStandardMaterial };

export function createVehicleKit() {
  type Tpl = { obj: THREE.Group; w: number; h: number };
  const tpls: Partial<Record<ModelKey, Tpl>> = {};
  const lightMats = new Set<THREE.MeshStandardMaterial>();
  const paintCache = new Map<string, THREE.Material>();
  const headlight = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6e0', emissiveIntensity: 0.4 });
  const taillight = new THREE.MeshStandardMaterial({ color: '#550000', emissive: '#ff1a1a', emissiveIntensity: 0.4 });
  const lampGeo = new THREE.PlaneGeometry(1, 1);
  const fallbackGeo = new THREE.BoxGeometry(1, 1, 1);
  let disposed = false;

  const prep = (k: ModelKey, src: THREE.Object3D): Tpl => {
    src.rotation.y = MODELS[k].rotY;
    const root = new THREE.Group();
    root.add(src);
    root.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(root, true);
    const len = b.max.x - b.min.x;
    src.position.set(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    root.scale.setScalar(1 / len);
    const obj = new THREE.Group();
    obj.add(root);
    src.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (/bodymat/i.test(mat.name) || (k === 'supercar' && /_bod_/.test(m.name))) m.userData.paint = true;
      if (mat.name === 'UCB_Lights_and_Glass' && mat.map) {
        mat.emissive = new THREE.Color('#ffffff');
        mat.emissiveMap = mat.map;
        lightMats.add(mat);
      }
      if (k === 'supercar' && /_emit_/.test(m.name)) m.material = headlight;
      if (k === 'supercar' && /_remit_/.test(m.name)) m.material = taillight;
    });
    return { obj, w: (b.max.z - b.min.z) / len, h: (b.max.y - b.min.y) / len };
  };

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const ready = Promise.all(
    (Object.keys(MODELS) as ModelKey[]).map((k) =>
      loader
        .loadAsync(`/arcade/frogger/vehicles/${k}.glb`)
        .then((gl) => {
          if (!disposed) tpls[k] = prep(k, gl.scene);
        })
        .catch(() => {
          /* falls back to a box body */
        }),
    ),
  );

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

  /** A car of model k, length len (m), painted hex; f adds the token decal. */
  const build = (k: ModelKey, len: number, hex: string, f?: FeedTx | null): Built => {
    const g = new THREE.Group();
    const tpl = tpls[k];
    if (!tpl) {
      const w = len * 0.42;
      const body = new THREE.Mesh(fallbackGeo, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.4, metalness: 0.4 }));
      body.scale.set(len, 1.4, w);
      body.position.y = 0.8;
      body.castShadow = true;
      g.add(body);
      return { g, len, w, k };
    }
    const v = tpl.obj.clone(true);
    v.scale.setScalar(len);
    if (MODELS[k].paint)
      v.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.userData.paint) return;
        const key = `${k}|${hex}`;
        let pm = paintCache.get(key);
        if (!pm) {
          const c = (m.material as THREE.MeshStandardMaterial).clone();
          c.color.set(hex);
          if (k === 'supercar') {
            c.map = null;
            c.metalness = 0.55;
            c.roughness = 0.22;
          }
          pm = c;
          paintCache.set(key, pm);
        }
        m.material = pm;
      });
    if (k === 'bus') {
      for (const s of [1, -1]) {
        const hl = new THREE.Mesh(lampGeo, headlight);
        hl.scale.set(0.035, 0.018, 1);
        hl.rotation.y = Math.PI / 2;
        hl.position.set(0.502, tpl.h * 0.14, s * tpl.w * 0.36);
        const tl = new THREE.Mesh(lampGeo, taillight);
        tl.scale.set(0.02, 0.03, 1);
        tl.rotation.y = -Math.PI / 2;
        tl.position.set(-0.502, tpl.h * 0.2, s * tpl.w * 0.4);
        v.add(hl, tl);
      }
    }
    let decal: THREE.MeshStandardMaterial | undefined;
    if (f?.kind === 'token' && k === 'boxtruck') {
      decal = new THREE.MeshStandardMaterial({ map: logoTex(f), roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -2 });
      for (const s of [1, -1]) {
        const d = new THREE.Mesh(lampGeo, decal);
        d.scale.set(0.6, 0.24, 1);
        d.position.set(-0.14, 0.32, s * DECAL_Z);
        d.rotation.y = s > 0 ? 0 : Math.PI;
        v.add(d);
      }
    }
    g.add(v);
    return { g, len, w: tpl.w * len, k, decal };
  };

  /** A car for a live transaction. */
  const forTx = (f: FeedTx): Built => {
    const { k, len } = pickModel(f);
    const hex = f.kind === 'blast' ? '#f4f4f4' : f.kind === 'inscription' ? pick(['#c8c2b8', '#e9e6df', '#9aa3ad']) : pick(PAINTS);
    return build(k, len, hex, f);
  };

  /** Free a built car's own resources (shared templates stay). */
  const release = (b: Built) => {
    b.decal?.map?.dispose();
    b.decal?.dispose();
    if (!tpls[b.k])
      b.g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) (m.material as THREE.Material).dispose();
      });
  };

  const setNight = (night: number) => {
    for (const m of lightMats) m.emissiveIntensity = 0.15 + night * 1.6;
    headlight.emissiveIntensity = 0.3 + night * 2.5;
    taillight.emissiveIntensity = 0.3 + night * 2;
  };

  const dispose = () => {
    disposed = true;
    const textures = new Set<THREE.Texture>();
    for (const tpl of Object.values(tpls))
      tpl?.obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        const mat = m.material as THREE.Material;
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) textures.add(v);
        mat.dispose();
      });
    for (const m of paintCache.values()) m.dispose();
    for (const t of textures) t.dispose();
    headlight.dispose();
    taillight.dispose();
    lampGeo.dispose();
    fallbackGeo.dispose();
  };

  return { ready, build, forTx, release, setNight, dispose };
}
export type VehicleKit = ReturnType<typeof createVehicleKit>;
