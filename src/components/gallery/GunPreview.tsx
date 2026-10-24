'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadGunModel } from '@/lib/ordnanceModels';

/** A slowly turning 3D model of one gun, for the loadout cards. */
export function GunPreview({ url, active }: { url: string; active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
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

    let raf = 0;
    let gone = false;
    loadGunModel(url)
      .then((gltf) => {
        if (gone) return;
        // SkeletonUtils keeps rigged guns (Quad Plasma, Minigun) intact; a plain clone() drops their skin.
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

    const resize = () => {
      const w = Math.max(2, cv.clientWidth);
      const h = Math.max(2, cv.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    let last = performance.now();
    const frame = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      pivot.rotation.y += dt * (activeRef.current ? 1.4 : 0.5);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      gone = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
    };
  }, [url]);

  return <canvas ref={ref} className="h-28 w-full sm:h-36" aria-hidden />;
}
