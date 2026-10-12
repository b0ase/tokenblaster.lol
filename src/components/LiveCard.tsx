'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { chibiClips } from '@/lib/chibiAnims';

/**
 * A live NPG card: the card's background, the rigged 3D girl in a transparent canvas, then the card's frame (name, QR,
 * stats) on top, so she stands inside the card exactly where the 2D art does. Idle loops; click / Space swings. Drag turns
 * her. The camera is orthographic and scaled so her bounding box matches the 2D girl's: `box` is the 2D girl's pixel box on
 * the 961×1441 card [left, top, right, bottom], and the model's own bounding box is fitted to it.
 */
export type CardBox = [number, number, number, number];
const CARD_W = 961;
const CARD_H = 1441;

export function LiveCard({ base, name, box }: { base: string; name: string; box: CardBox }) {
  const wrap = useRef<HTMLDivElement>(null);
  const swing = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);
  const [rigged, setRigged] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    el.insertBefore(renderer.domElement, el.lastElementChild); // between the background and the frame
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
    camera.position.set(0, 0, 3);

    scene.add(new THREE.HemisphereLight('#c9d8ff', '#2a1030', 1.1));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(1, 2, 3);
    const pink = new THREE.DirectionalLight('#ff3fb4', 2.4);
    pink.position.set(-3, 1, -1);
    const cyan = new THREE.DirectionalLight('#28e7ff', 2.2);
    cyan.position.set(3, 0.5, -2);
    scene.add(key, pink, cyan);

    const root = new THREE.Group();
    scene.add(root);
    let mixer: THREE.AnimationMixer | null = null;
    let idle: THREE.AnimationAction | null = null;
    let attack: THREE.AnimationAction | null = null;

    new GLTFLoader().load(`${base}.glb`, (g) => {
      if (disposed) return;
      const model = g.scene;
      const mb = new THREE.Box3().setFromObject(model);
      const h = mb.max.y - mb.min.y;
      model.position.set(-(mb.min.x + mb.max.x) / 2, -mb.min.y, -(mb.min.z + mb.max.z) / 2);
      root.add(model);
      // frame the card so she's GIRL_PX tall with her feet on FEET_PX and centred on CENTRE_PX, like the 2D art
      const [bl, bt, br, bb] = box;
      const ppu = (bb - bt) / h;
      const cx = (bl + br) / 2;
      camera.left = -cx / ppu;
      camera.right = (CARD_W - cx) / ppu;
      camera.bottom = -(CARD_H - bb) / ppu;
      camera.top = bb / ppu;
      camera.updateProjectionMatrix();
      mixer = new THREE.AnimationMixer(model);
      // Girls on the chibi doll's 84-bone rig share the code-made chibi clips (rest pose already arms-down);
      // older exports carry their own baked idle/attack.
      const onDollRig = Boolean(model.getObjectByName('upper_torso'));
      const anims = onDollRig ? chibiClips(model, { armsDown: false }) : g.animations;
      const clip = (n: string) => anims.find((a) => a.name.startsWith(n));
      const ic = clip('idle');
      const ac = clip('attack');
      if (ic) (idle = mixer.clipAction(ic)).play();
      if (ac) {
        attack = mixer.clipAction(ac);
        attack.setLoop(THREE.LoopOnce, 1);
        attack.clampWhenFinished = true;
      }
      mixer.addEventListener('finished', () => {
        attack?.fadeOut(0.15);
        idle?.reset().fadeIn(0.15).play();
      });
      setRigged(Boolean(ac));
      setReady(true);
    });

    swing.current = () => {
      if (!attack || !idle || attack.isRunning()) return;
      idle.fadeOut(0.08);
      attack.reset().setEffectiveWeight(1).fadeIn(0.08).play();
    };

    // drag to turn her
    let dragX: number | null = null;
    let yaw = 0;
    const down = (e: PointerEvent) => (dragX = e.clientX);
    const move = (e: PointerEvent) => {
      if (dragX === null) return;
      yaw += (e.clientX - dragX) * 0.012;
      dragX = e.clientX;
    };
    const up = () => (dragX = null);
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);

    const size = () => {
      const r = el.getBoundingClientRect();
      renderer.setSize(r.width, r.height, false);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);

    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      mixer?.update(dt);
      if (dragX === null) yaw *= 0.92; // ease back to facing out of the card
      root.rotation.y = yaw;
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the box is fixed per card
  }, [base]);

  useEffect(() => {
    const onK = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        swing.current();
      }
    };
    window.addEventListener('keydown', onK);
    return () => window.removeEventListener('keydown', onK);
  }, []);

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={wrap}
        onClick={() => swing.current()}
        className="relative w-full max-w-[420px] cursor-pointer select-none overflow-hidden rounded-lg shadow-2xl"
        style={{ aspectRatio: `${CARD_W} / ${CARD_H}`, touchAction: 'none' }}
        role="img"
        aria-label={`${name}, live 3D card`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${base}-card-bg.webp`} alt="" className="absolute inset-0 h-full w-full" draggable={false} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${base}-card-frame.webp`} alt="" className="pointer-events-none absolute inset-0 h-full w-full" draggable={false} />
      </div>
      <p className="text-sm text-dim">{ready ? (rigged ? 'Click or press Space to swing · drag to turn her' : 'Drag to turn her · not rigged yet') : `Loading ${name}…`}</p>
    </div>
  );
}
