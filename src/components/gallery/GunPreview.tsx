'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadGunModel } from '@/lib/ordnanceModels';
import { isMobileLite } from '@/lib/mobileLite';
import { addPreview } from '@/lib/previewRenderer';

/** A slowly turning 3D model of one gun, for the loadout cards. */
export function GunPreview({ url, active }: { url: string; active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Phones: one WebGL context per card is too many for iOS (memory, context limits), so only the chosen gun turns in 3D.
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    void Promise.resolve().then(() => setCoarse(window.matchMedia('(pointer: coarse)').matches));
  }, []);
  // Mobile-lite: the game holds the only WebGL context, so the cards show no 3D model at all (read on the
  // client before the first effect, so a phone never opens a second context even briefly)
  const [lite] = useState(() => typeof window !== 'undefined' && isMobileLite());
  const live = !lite && (!coarse || active);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !live) return;
    // drawn by the page's one shared preview context (src/lib/previewRenderer.ts), not a context per card
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    camera.position.set(0, 0.35, 3.2);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xbfe6ff, 0x301010, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 3, 2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xe8261d, 2);
    rim.position.set(-3, 1, -2);
    scene.add(rim);
    const pivot = new THREE.Group();
    scene.add(pivot);

    let gone = false;
    loadGunModel(url)
      .then((gltf) => {
        if (gone) return;
        // SkeletonUtils keeps rigged guns (Quad Plasma, Minigun) intact; a plain clone() drops their skin.
        // The clone shares the cached model's geometry and materials, so nothing is disposed here.
        const model = cloneSkinned(gltf.scene);
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model, true);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        model.position.sub(centre);
        // Fill the card: the long side spans the frame, capped so a tall gun still fits.
        const k = Math.min(2.9 / Math.max(size.x, size.z, 1e-3), 1.3 / Math.max(size.y, 1e-3));
        model.scale.setScalar(k);
        model.position.multiplyScalar(k);
        pivot.add(model);
      })
      .catch(() => {});

    const release = addPreview({
      canvas: cv,
      draw: (renderer, _t, dt) => {
        pivot.rotation.y += dt * (activeRef.current ? 1.4 : 0.5);
        camera.aspect = cv.width / Math.max(1, cv.height);
        camera.updateProjectionMatrix();
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.render(scene, camera);
      },
    });
    return () => {
      gone = true;
      release?.();
    };
  }, [url, live]);

  if (!live) return <div className="grid h-28 w-full place-items-center rounded-md bg-gradient-to-br from-white/5 to-transparent text-[10px] font-bold tracking-[0.3em] text-white/35 sm:h-36" aria-hidden>TAP TO EQUIP</div>;
  return <canvas ref={ref} className="h-28 w-full sm:h-36" aria-hidden />;
}
