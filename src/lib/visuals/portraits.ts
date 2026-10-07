/**
 * Story portraits rendered from the real 3D cast: each speaker is lit like a film still (warm key,
 * coloured rim, soft environment) in a throw-away offscreen renderer, then cached as a canvas.
 * Parody characters only. Kweg uses his illustrated art.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildRig, CAST, loadCastModels, poseRig, type Kind, type Rig } from '@/lib/doubleo/characters';
import { SPEAKERS, type Speaker } from '@/lib/doubleo/story';

const SIZE = 512;
const cache = new Map<Speaker, HTMLCanvasElement>();
let job: Promise<void> | null = null;

type Spec = { kind: Kind; agent?: string; dark?: boolean; hat?: boolean };
const SPECS: Partial<Record<Speaker, Spec>> = {
  m: { kind: 'goon', agent: '#8fa0ba' },
  q: { kind: 'goon', agent: '#60c880' },
  one: { kind: 'custodian', dark: true },
  cz: { kind: 'kingpin' },
  brian: { kind: 'custodian' },
  michael: { kind: 'hoarder' },
  jihan: { kind: 'goon', agent: '#d8a020', hat: true },
  sam: { kind: 'partyboy' },
};

// Dev-only: lets automated checks read the rendered portraits.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') (window as unknown as { __portraits?: unknown }).__portraits = cache;

export function portraitFor(who: Speaker): HTMLCanvasElement | null {
  return cache.get(who) ?? null;
}

/** Render every portrait once (idempotent). Resolves when the cache is filled or the attempt failed. */
export function ensurePortraits(): Promise<void> {
  job ??= (async () => {
    try {
      await loadCastModels();
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setSize(SIZE, SIZE, false);
      renderer.setPixelRatio(1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setClearColor(0x000000, 0);
      const pm = new THREE.PMREMGenerator(renderer);
      const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      for (const [who, spec] of Object.entries(SPECS) as [Speaker, Spec][]) {
        try {
          cache.set(who, renderOne(renderer, env, who, spec));
        } catch {
          /* keep the drawn fallback for this speaker */
        }
      }
      env.dispose();
      pm.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    } catch {
      /* models failed to load: the cartoon portraits stay */
    }
  })();
  return job;
}

function renderOne(renderer: THREE.WebGLRenderer, env: THREE.Texture, who: Speaker, spec: Spec): HTMLCanvasElement {
  const color = SPEAKERS[who].color;
  const rig: Rig = buildRig(spec.kind, spec.agent);
  const def = CAST[spec.kind];
  const height = spec.agent ? 1.9 : def.height;
  for (const b of rig.beams) b.visible = false;
  poseRig(rig, 0.05, 0, false, 0);
  rig.root.rotation.y = who === 'one' ? 0 : -0.35;
  if (spec.dark) {
    rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.material || m.material instanceof THREE.MeshBasicMaterial) return;
      m.material = new THREE.MeshStandardMaterial({ color: '#0a0a0c', roughness: 0.5, metalness: 0.3 });
    });
    for (const x of [-0.07, 0.07]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.3, 0.3), toneMapped: false }));
      const k = height / 1.9;
      eye.scale.setScalar(k * 0.55);
      eye.position.set(x * 1.2 * k, 1.86 * k, 0.215 * k);
      rig.root.add(eye);
    }
  }
  if (spec.hat) {
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: '#f5b800', roughness: 0.35, clearcoat: 1 }));
    hat.position.set(0, height * 0.95, 0.0);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 24), hat.material);
    brim.position.set(0, height * 0.95, 0.02);
    rig.root.add(hat, brim);
  }
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = 0.45;
  scene.add(rig.root);
  const key = new THREE.DirectionalLight('#fff0dc', 3.2);
  key.position.set(1.6, 2.2, 2.6);
  const fill = new THREE.DirectionalLight('#8aa8ff', 0.6);
  fill.position.set(-2, 0.5, 1.5);
  const rim = new THREE.DirectionalLight(color, 4.5);
  rim.position.set(-1.8, 1.8, -2.2);
  scene.add(key, fill, rim);
  const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 30);
  // Frame from the measured top of the figure (hats and hair included) so the whole head always fits.
  rig.root.updateMatrixWorld(true);
  const bb = new THREE.Box3();
  rig.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (m.material as THREE.Material).visible !== false) bb.expandByObject(m);
  });
  const top = Math.min(bb.max.y, height * 1.35);
  const viewH = spec.agent ? height * 0.5 : top * 0.66;
  const lookY = spec.agent ? height * 0.8 : top - viewH * 0.46;
  const dist = viewH / 2 / Math.tan((24 / 2) * (Math.PI / 180));
  cam.position.set(dist * 0.22, lookY + 0.02 * height, dist);
  cam.lookAt(0, lookY, 0);
  renderer.render(scene, cam);

  const out = document.createElement('canvas');
  out.width = out.height = SIZE;
  const g = out.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, SIZE);
  bg.addColorStop(0, '#1b1e26');
  bg.addColorStop(1, '#050507');
  g.fillStyle = bg;
  g.fillRect(0, 0, SIZE, SIZE);
  const glow = g.createRadialGradient(SIZE * 0.3, SIZE * 0.4, 10, SIZE * 0.35, SIZE * 0.45, SIZE * 0.8);
  glow.addColorStop(0, color + 'aa');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, SIZE, SIZE);
  g.drawImage(renderer.domElement, 0, 0, SIZE, SIZE);
  const vg = g.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.3, SIZE / 2, SIZE / 2, SIZE * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = vg;
  g.fillRect(0, 0, SIZE, SIZE);
  return out;
}
