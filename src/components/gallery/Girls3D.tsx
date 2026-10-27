'use client';

/**
 * CHOOSE YOUR GIRL in 3D (owner, 27 Oct): each portrait slot shows a small live model of the girl, turning on a
 * turntable in her idle; the selected one stands bigger and brighter. The girls are the Tripo rigged NPG models
 * (src/lib/galleryGame/squadBodies.ts, the same shared, once-per-page loads the squadmates use), animated with the
 * shared mocap clips. Drawn by the page's one preview context (src/lib/previewRenderer.ts), a scissored viewport per
 * slot, released (context force-lost) the moment the picker unmounts. Not used in the mobile-lite tier (2D
 * portraits there). The 2D portraits stay underneath until the models load.
 */
import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { BODY_H, GirlBody, loadGirl } from '@/lib/galleryGame/squadBodies';
import { addPreview } from '@/lib/previewRenderer';

type Slot = { id: string; body: GirlBody; phase: number };

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
    let release: (() => void) | null = null;
    const slots: Slot[] = [];
    const scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(0xffffff, 0x302040, 2.2);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(1, 2, 2);
    scene.add(key);
    const camera = new THREE.PerspectiveCamera(26, 0.55, 0.1, 30);

    void Promise.all(ids.map((id) => loadGirl(id).catch(() => null)))
      .then((ts) => {
        if (dead) return;
        ts.forEach((t, i) => {
          if (t) slots.push({ id: ids[i], body: new GirlBody(t), phase: i * 1.3 });
        });
        if (!slots.length) return onReady(false);
        onReady(true);
        release = addPreview({
          canvas,
          every: 33, // ~30 fps is plenty for a turntable
          draw: (renderer, t, dt) => {
            const cr = box.getBoundingClientRect();
            const k = canvas.width / Math.max(1, cr.width);
            renderer.toneMapping = THREE.NoToneMapping;
            renderer.setScissorTest(true);
            for (const s of slots) {
              const el = box.querySelector<HTMLElement>(`[data-npg-girl="${s.id}"]`);
              if (!el) continue;
              const r = el.getBoundingClientRect();
              const x = (r.left - cr.left) * k;
              const y = (cr.bottom - r.bottom) * k;
              renderer.setViewport(x, y, r.width * k, r.height * k);
              renderer.setScissor(x, y, r.width * k, r.height * k);
              const on = s.id === sel.current;
              s.body.root.rotation.y = t * (on ? 0.9 : 0.45) + s.phase;
              s.body.root.scale.setScalar(on ? 1.08 : 0.9);
              s.body.update(dt * 1.6);
              hemi.intensity = on ? 2.4 : 1.1;
              scene.add(s.body.root);
              camera.aspect = r.width / r.height;
              // fit the BODY_H-tall girl into the slot, a little headroom
              const half = BODY_H * 0.58;
              const dist = half / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, camera.aspect * 1.9);
              camera.position.set(0, BODY_H * 0.52, dist);
              camera.lookAt(0, BODY_H * 0.5, 0);
              camera.updateProjectionMatrix();
              renderer.render(scene, camera);
              scene.remove(s.body.root);
            }
            renderer.setScissorTest(false);
          },
        });
      })
      .catch(() => onReady(false));

    return () => {
      dead = true;
      release?.();
      for (const s of slots) s.body.dispose();
      onReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, ids.join(',')]);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 z-[2] h-full w-full" data-girls-3d />;
}
