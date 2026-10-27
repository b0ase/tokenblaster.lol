'use client';

/**
 * CHOOSE YOUR GIRL in 3D (owner, 27 Oct): each portrait slot shows a small live model of the girl, turning on a
 * turntable in an idle pose; the selected one stands bigger and brighter. Every girl is the NPG rigged chibi body
 * plus a hair model, tinted to her 2D portrait (scripts/npg-girls-3d/build.sh makes the meshopt + webp GLBs).
 * ONE WebGL canvas over the whole row, a scissored viewport per slot. Not used in the mobile-lite tier (2D
 * portraits there, to protect the iPhone memory budget). The 2D portraits stay underneath until the models load.
 */
import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const BASE = '/terrornode/girls3d/';
/** Hair model and colours per girl, read off her portrait (public/npg/girls). */
export const GIRL_LOOKS: Record<string, { hair: string; hairTint: string; cloth: string; skin?: string }> = {
  aika: { hair: 'E001MiyukiHair', hairTint: '#c24cf0', cloth: '#3a3156' },
  ayumi: { hair: 'E002YamarashiiHair', hairTint: '#ff3d6e', cloth: '#3c4a4c' },
  kimiko: { hair: 'E003HikaruHair', hairTint: '#22d6a8', cloth: '#2a2236' },
  nao: { hair: 'E011NaoHair', hairTint: '#f6c4dc', cloth: '#f27fb4' },
  kazuyo: { hair: 'E002YamarashiiHair', hairTint: '#b02adf', cloth: '#262230' },
};

type Slot = { id: string; scene: THREE.Scene; root: THREE.Group; mats: THREE.Material[]; spine: THREE.Object3D | null; phase: number };

function tintedMaterial(m: THREE.Material, tint: string | null) {
  const c = m.clone() as THREE.MeshStandardMaterial;
  if (tint) {
    // the chibi is emissive-textured (flat, toon look): tint through the emissive colour, keep some detail
    const t = new THREE.Color(tint);
    if (c.emissiveMap) c.emissive = new THREE.Color(1, 1, 1).lerp(t, 0.75);
    else c.color = t;
  }
  return c;
}

export function Girls3D({ container, ids, selected, onReady }: { container: RefObject<HTMLDivElement | null>; ids: string[]; selected: string; onReady: (ready: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sel = useRef(selected);
  useEffect(() => {
    sel.current = selected;
  }, [selected]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = container.current;
    if (!canvas || !box) return;
    let dead = false;
    let raf = 0;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setScissorTest(true);
    const camera = new THREE.PerspectiveCamera(26, 0.55, 0.1, 20);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const load = (f: string) => loader.loadAsync(BASE + f + '.glb');
    const slots: Slot[] = [];

    (async () => {
      const hairs = [...new Set(ids.map((id) => GIRL_LOOKS[id]?.hair).filter(Boolean))];
      const [body, ...hairGltfs] = await Promise.all([load('chibi'), ...hairs.map(load)]);
      if (dead) return;
      const hairOf = Object.fromEntries(hairs.map((h, i) => [h, hairGltfs[i].scene]));
      for (const [i, id] of ids.entries()) {
        const look = GIRL_LOOKS[id];
        if (!look) continue;
        const scene = new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xffffff, 0x302040, 2.2));
        const key = new THREE.DirectionalLight(0xffffff, 2.4);
        key.position.set(1, 2, 2);
        scene.add(key);
        const root = new THREE.Group();
        const model = cloneSkinned(body.scene);
        const mats: THREE.Material[] = [];
        let hairBox: THREE.Box3 | null = null;
        let head: THREE.Object3D | null = null;
        let spine: THREE.Object3D | null = null;
        model.updateMatrixWorld(true);
        model.traverse((o) => {
          if (/head/i.test(o.name) && !head && (o as THREE.Bone).isBone) head = o;
          if (/spine/i.test(o.name) && !spine && (o as THREE.Bone).isBone) spine = o;
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const name = (mesh.material as THREE.Material).name;
          if (name === 'hair_material') {
            hairBox = new THREE.Box3().setFromObject(mesh);
            mesh.visible = false;
            return;
          }
          if (name === 'weapon_material') {
            mesh.visible = false; // the loadout's weapons are picked separately
            return;
          }
          mesh.material = tintedMaterial(mesh.material as THREE.Material, name === 'cloth_material' ? look.cloth : null);
          mats.push(mesh.material as THREE.Material);
          mesh.frustumCulled = false;
        });
        root.add(model);
        const hb = hairBox as THREE.Box3 | null;
        if (hb) {
          const hair = hairOf[look.hair].clone(true);
          hair.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const m = (mesh.material as THREE.MeshStandardMaterial).clone();
            m.color = new THREE.Color(look.hairTint).lerp(new THREE.Color(1, 1, 1), 0.15);
            m.emissive = new THREE.Color(look.hairTint).multiplyScalar(0.25);
            m.roughness = 0.6;
            m.metalness = 0;
            mesh.material = m;
            mats.push(m);
          });
          const src = new THREE.Box3().setFromObject(hair);
          const want = hb.getSize(new THREE.Vector3());
          const have = src.getSize(new THREE.Vector3());
          const s = (Math.max(want.x, want.z) / Math.max(have.x, have.z)) * 1.12;
          hair.scale.setScalar(s);
          const c = hb.getCenter(new THREE.Vector3());
          const sc = src.getCenter(new THREE.Vector3()).multiplyScalar(s);
          hair.position.set(c.x - sc.x, hb.max.y + 0.01 - src.max.y * s, c.z - sc.z);
          model.add(hair);
          if (head) (head as THREE.Object3D).attach(hair);
        }
        root.userData.phase = i;
        scene.add(root);
        slots.push({ id, scene, root, mats, spine, phase: i * 1.3 });
      }
      onReady(true);
      const t0 = performance.now();
      let last = 0;
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        if (document.hidden || now - last < 33) return; // ~30 fps is plenty for a turntable
        last = now;
        const t = (now - t0) / 1000;
        const cr = box.getBoundingClientRect();
        if (cr.width < 1 || cr.bottom < 0 || cr.top > innerHeight) return;
        const w = Math.round(cr.width);
        const h = Math.round(cr.height);
        const size = renderer.getSize(new THREE.Vector2());
        if (size.x !== w || size.y !== h) renderer.setSize(w, h, false);
        renderer.setScissor(0, 0, w, h);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        for (const s of slots) {
          const el = box.querySelector<HTMLElement>(`[data-npg-girl="${s.id}"]`);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const x = r.left - cr.left;
          const y = cr.bottom - r.bottom;
          renderer.setViewport(x, y, r.width, r.height);
          renderer.setScissor(x, y, r.width, r.height);
          const on = s.id === sel.current;
          s.root.rotation.y = t * (on ? 0.9 : 0.45) + s.phase;
          s.root.position.y = Math.sin(t * 2 + s.phase) * 0.008;
          if (s.spine) s.spine.rotation.z = Math.sin(t * 1.6 + s.phase) * 0.04;
          s.root.scale.setScalar(on ? 1.08 : 0.9);
          for (const m of s.mats) {
            const mm = m as THREE.MeshStandardMaterial;
            mm.emissiveIntensity = on ? 1 : 0.5;
            mm.opacity = 1;
          }
          (s.scene.children[0] as THREE.HemisphereLight).intensity = on ? 2.4 : 1.1;
          camera.aspect = r.width / r.height;
          // fit the 0.9-high chibi into the slot, a little headroom
          const dist = 0.52 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, camera.aspect * 1.9);
          camera.position.set(0, 0.47, dist);
          camera.lookAt(0, 0.44, 0);
          camera.updateProjectionMatrix();
          renderer.render(s.scene, camera);
        }
      };
      raf = requestAnimationFrame(frame);
    })().catch(() => onReady(false));

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      for (const s of slots) s.scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      for (const s of slots) s.mats.forEach((m) => m.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      onReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, ids.join(',')]);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 z-[2] h-full w-full" data-girls-3d />;
}
