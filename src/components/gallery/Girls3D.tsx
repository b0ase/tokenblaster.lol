'use client';

/**
 * CHOOSE YOUR GIRL in 3D (owner, 27 Oct): each portrait slot shows a live model of the girl facing the
 * camera (a slight 3/4, no turntable: owner, 27 Oct) in her idle, breaking into a gesture (nod, folded arms, punch,
 * dance, guard) every 6-12 s, staggered, and at once on hover, focus or tap; the selected one stands bigger and brighter. The girls are the Tripo rigged NPG models
 * (src/lib/galleryGame/squadBodies.ts, the same shared, once-per-page loads the squadmates use), animated with the
 * shared mocap clips. Drawn by the page's one preview context (src/lib/previewRenderer.ts), a scissored viewport per
 * slot, released (context force-lost) the moment the picker unmounts. Not used in the mobile-lite tier (2D
 * portraits there). The 2D portraits stay underneath until the models load.
 */
import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { BODY_H, GirlBody, loadGirl, type Move } from '@/lib/galleryGame/squadBodies';
import { addPreview } from '@/lib/previewRenderer';

type Slot = { id: string; body: GirlBody; next: number };
const GESTURES: Move[] = ['yes', 'folds', 'punch', 'dance', 'ready'];
const pickGesture = () => GESTURES[Math.floor(Math.random() * GESTURES.length)];

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
    let unpoke: (() => void) | null = null;
    let clock = 0;
    let last = 0;
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
          if (t) slots.push({ id: ids[i], body: new GirlBody(t), next: 2.5 + i * 1.4 + Math.random() * 2 });
        });
        if (!slots.length) return onReady(false);
        onReady(true);
        // hover / keyboard focus / tap on a portrait: that girl gestures now
        const poke = (e: Event) => {
          const id = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-npg-girl]')?.dataset.npgGirl;
          const s = id && slots.find((x) => x.id === id);
          if (s && !s.body.busy) {
            s.body.gesture(pickGesture());
            s.next = clock + 6 + Math.random() * 6;
          }
        };
        box.addEventListener('pointerover', poke);
        box.addEventListener('focusin', poke);
        box.addEventListener('pointerdown', poke);
        unpoke = () => {
          box.removeEventListener('pointerover', poke);
          box.removeEventListener('focusin', poke);
          box.removeEventListener('pointerdown', poke);
        };
        release = addPreview({
          canvas,
          every: 33, // ~30 fps is plenty for an idle
          draw: (renderer) => {
            const cr = box.getBoundingClientRect();
            const k = canvas.width / Math.max(1, cr.width);
            renderer.toneMapping = THREE.NoToneMapping;
            renderer.setScissorTest(true);
            // the shared loop's dt is per global frame; this view draws every ~33 ms, so time it here
            const now = performance.now() / 1000;
            const dt = Math.min(0.1, last ? now - last : 0);
            last = now;
            clock += dt;
            for (const s of slots) {
              const el = box.querySelector<HTMLElement>(`[data-npg-girl="${s.id}"]`);
              if (!el) continue;
              const r = el.getBoundingClientRect();
              const x = (r.left - cr.left) * k;
              const y = (cr.bottom - r.bottom) * k;
              renderer.setViewport(x, y, r.width * k, r.height * k);
              renderer.setScissor(x, y, r.width * k, r.height * k);
              const on = s.id === sel.current;
              s.body.root.rotation.y = 0.32; // facing us, a slight 3/4
              s.body.root.scale.setScalar(on ? 1.04 : 0.94);
              if (clock >= s.next) {
                if (!s.body.busy) s.body.gesture(pickGesture());
                s.next = clock + 6 + Math.random() * 6;
              }
              s.body.update(dt);
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
      unpoke?.();
      for (const s of slots) s.body.dispose();
      onReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, ids.join(',')]);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 z-[2] h-full w-full" data-girls-3d />;
}
