'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { chibiClips } from '@/lib/chibiAnims';
import type { CardBox } from '@/lib/npgLiveCards';

// Skeletal animation is OFF for now: the Tripo meshes are hundreds of loose fragments and any bone motion tears or smears
// them (owner, 2026-10-12: "still a mess"). Until each girl has a clean single-surface mesh she moves as one solid piece:
// a breathing bob and sway at idle, a lunge-and-spin for the attack.
const SKIN = false;
import { mocap } from '@/lib/npgMocap';
import { mixamoRig, type MixamoRig } from '@/lib/mixamoPose';
import { rigClips, IDLE, ATTACKS } from '@/lib/npgRigMocap';

/**
 * A live NPG card: the card's background, the rigged 3D girl in a transparent canvas, then the card's frame (name, QR,
 * stats) on top, so she stands inside the card exactly where the 2D art does. Idle loops; click / Space swings. Drag turns
 * her. The camera is orthographic and scaled so her bounding box matches the 2D girl's: `box` is the 2D girl's pixel box on
 * the 961×1441 card [left, top, right, bottom], and the model's own bounding box is fitted to it.
 */
export type { CardBox };
const CARD_W = 961;
const CARD_H = 1441;

/**
 * `compact`: a small in-game portrait (fills its parent, no caption, no drag or Space key; the game swings her by
 * changing `swing`). Each mounted card is one WebGL view, so games keep it to one or two.
 */
export function LiveCard({ base, name, box, compact = false, swing: swingKey = 0, rig: hasRig = false }: { base: string; name: string; box: CardBox; compact?: boolean; swing?: number; rig?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const swing = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);
  const [rigged, setRigged] = useState(false);
  // Browsers cap live WebGL contexts (~16), so a card only holds a 3D view while it's on (or near) the screen.
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const near = () => {
      const r = el.getBoundingClientRect();
      return r.top < innerHeight + 200 && r.bottom > -200;
    };
    const check = () => setOnScreen(near());
    check();
    addEventListener('scroll', check, { passive: true });
    addEventListener('resize', check);
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { rootMargin: '200px' });
    io.observe(el);
    return () => {
      io.disconnect();
      removeEventListener('scroll', check);
      removeEventListener('resize', check);
    };
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el || !onScreen) return;
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
    // Tripo's own clean Mixamo rig (owner-rigged in Tripo): real bone animation, no tearing
    let mix: MixamoRig | null = null;
    // ...driven by real motion capture when it loads
    let mo = false;
    let moIdle: THREE.AnimationAction | null = null;
    let moActs: THREE.AnimationAction[] = [];
    let moCur: THREE.AnimationAction | null = null;
    let moN = 0;

    new GLTFLoader().load(hasRig ? `${base}-rigged.glb` : `${base}.glb`, async (g) => {
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
      model.traverse((o) => {
        if (o.name.startsWith('Icosphere')) o.visible = false; // Tripo's rig-preview marker
      });
      mix = hasRig ? mixamoRig(model) : null;
      if (hasRig)
        rigClips(model, base.split('/').pop() ?? '').then((clips) => {
          const m = mixer;
          const idleClip = clips.find((c) => c.name === IDLE);
          if (disposed || !m || !idleClip) return;
          moIdle = m.clipAction(idleClip);
          moIdle.play();
          moActs = ATTACKS.flatMap((n) => {
            const c = clips.find((k) => k.name === n);
            if (!c) return [];
            const a = m.clipAction(c);
            a.setLoop(THREE.LoopOnce, 1);
            a.clampWhenFinished = true;
            return [a];
          });
          m.addEventListener('finished', (e) => {
            if (e.action !== moCur) return;
            moIdle?.reset().play();
            moCur?.crossFadeTo(moIdle!, 0.25, false);
            moCur = null;
          });
          mo = true;
        });
      mixer = new THREE.AnimationMixer(model);
      // Girls on the chibi doll's 84-bone rig share the code-made chibi clips (rest pose already arms-down);
      // older exports carry their own baked idle/attack.
      const onDollRig = Boolean(model.getObjectByName('upper_torso'));
      // Mocap (npgMocap) is off: big mocap motion tears these meshes far worse than the gentle code clips (owner, 2026-10-12).
      const mc: THREE.AnimationClip[] = [];
      if (disposed) return;
      const coded = onDollRig ? chibiClips(model, { armsDown: false }) : g.animations;
      // Real mocap when we have it (sword stance + sword slash), the code-made clips otherwise.
      const ic = mocap(mc, 'Sword_Idle') ?? mocap(mc, 'Idle_Loop') ?? coded.find((a) => a.name.startsWith('idle'));
      const ac = mocap(mc, 'Sword_Attack') ?? coded.find((a) => a.name.startsWith('attack'));
      if (ic && SKIN) (idle = mixer.clipAction(ic)).play();
      if (ac) {
        attack = mixer.clipAction(ac);
        attack.setLoop(THREE.LoopOnce, 1);
        attack.clampWhenFinished = true;
      }
      mixer.addEventListener('finished', () => {
        attack?.fadeOut(0.15);
        idle?.reset().fadeIn(0.15).play();
      });
      setRigged(SKIN ? Boolean(ac) : true);
      setReady(true);
    });

    let lunge = -1; // seconds into the whole-body attack (-1 = idle)
    swing.current = () => {
      if (mo) {
        if (moCur || !moIdle || !moActs.length) return;
        const a = moActs[moN++ % moActs.length];
        a.reset().play();
        moIdle.crossFadeTo(a, 0.12, false);
        moCur = a;
        return;
      }
      if (!SKIN || mix) {
        if (lunge < 0) lunge = 0;
        return;
      }
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
    if (!compact) {
      el.addEventListener('pointerdown', down);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

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
      if (SKIN) mixer?.update(dt);
      if (dragX === null) yaw *= 0.92; // ease back to facing out of the card
      const t = clock.elapsedTime;
      // solid-body motion: breathe + sway; the attack is a quick lunge with a full spin, then settle
      let spin = 0;
      let fwd = 0;
      let hop = 0;
      if (mo) mixer?.update(dt);
      if (!mo && lunge >= 0) {
        lunge += dt;
        const k = Math.min(1, lunge / (mix ? 0.8 : 0.55));
        const e = 1 - Math.pow(1 - k, 3);
        spin = mix ? 0 : e * Math.PI * 2;
        fwd = Math.sin(k * Math.PI) * 0.08;
        hop = Math.sin(k * Math.PI) * 0.03;
        mix?.pose(t, k);
        if (k >= 1) lunge = -1;
      } else if (!mo) mix?.pose(t, -1);
      root.rotation.y = yaw + spin;
      root.rotation.z = mix ? 0 : Math.sin(t * 1.3) * 0.02;
      root.position.set(0, Math.sin(t * 2.2) * 0.004 + hop, fwd);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the box (and compact) is fixed per card
  }, [base, onScreen]);

  // the game asks for a swing by bumping `swing`
  useEffect(() => {
    if (swingKey) swing.current();
  }, [swingKey]);

  useEffect(() => {
    if (compact) return;
    const onK = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        swing.current();
      }
    };
    window.addEventListener('keydown', onK);
    return () => window.removeEventListener('keydown', onK);
  }, [compact]);

  if (compact)
    return (
      <div ref={wrap} className="relative h-full w-full select-none overflow-hidden" role="img" aria-label={`${name}, live 3D card`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${base}-card-bg.webp`} alt="" className="absolute inset-0 h-full w-full" draggable={false} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${base}-card-frame.webp`} alt="" className="pointer-events-none absolute inset-0 h-full w-full" draggable={false} />
      </div>
    );

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
