'use client';

/**
 * The arena's 3D minigun for the BSVGun page. It follows the pointer (mouse or finger) around the
 * window and tilts with it; click/tap fires. While `firing`, the barrel spins, the muzzle flashes and
 * tracers spray wherever the gun points.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildGun, GUNS } from '@/lib/arenaHD';

export function GunView({ firing, onFire }: { firing: boolean; onFire?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const fire = useRef(firing);
  const fireCb = useRef(onFire);
  useEffect(() => {
    fire.current = firing;
    fireCb.current = onFire;
  }, [firing, onFire]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return; // no WebGL: the page works without the picture
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.HemisphereLight('#fff4e8', '#3a1410', 2));
    const key = new THREE.DirectionalLight('#ffffff', 4);
    key.position.set(1, 3, 3);
    scene.add(key);
    const rim = new THREE.PointLight('#ff3020', 6, 6);
    rim.position.set(-1, 0.5, -1.5);
    scene.add(rim);
    const camera = new THREE.PerspectiveCamera(28, 2, 0.01, 50);

    // rig: follows the pointer. holder: turns the gun side-on, sways and shakes.
    const rig = new THREE.Group();
    scene.add(rig);
    const holder = new THREE.Group();
    rig.add(holder);
    let reach = { x: 0, y: 0 }; // how far the rig may travel from the centre (world units)
    let size = 0.5; // the gun's radius, for tracer speed
    const want = new THREE.Vector2(); // pointer, -1..1
    const onMove = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      want.set(((e.clientX - b.left) / b.width) * 2 - 1, -(((e.clientY - b.top) / b.height) * 2 - 1));
    };
    const onDown = (e: PointerEvent) => {
      onMove(e);
      // Mouse click fires. A finger only steers (dragging on a phone shouldn't start a storm).
      if (e.pointerType === 'mouse' && !fire.current) fireCb.current?.();
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    const flash = new THREE.PointLight('#ffb070', 0, 3);
    const flare = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffd090', transparent: true, opacity: 0 }));
    let held: ReturnType<typeof buildGun> | null = null;
    const def = GUNS[0]; // minigun
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(def.url, (gltf) => {
      held = buildGun(def, gltf);
      holder.add(held.group);
      held.group.add(flash, flare);
      flash.position.copy(held.muzzle);
      flare.position.copy(held.muzzle);
      // Side-on: barrel points left to right.
      holder.rotation.y = -Math.PI / 2;
      const box = new THREE.Box3().setFromObject(holder, true);
      const r = box.getSize(new THREE.Vector3()).length() / 2;
      size = r;
      camera.position.set(0, 0, r * 3.2);
      camera.lookAt(0, 0, 0);
      fit();
    });
    // Tracers: a pool of thin glowing bolts.
    const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    const tracerMat = new THREE.MeshBasicMaterial({ color: '#ffb070', transparent: true, opacity: 0.95 });
    const tracers = Array.from({ length: 160 }, () => {
      const m = new THREE.Mesh(tracerGeo, tracerMat);
      m.visible = false;
      scene.add(m);
      return { m, v: new THREE.Vector3(), life: 0 };
    });
    let nextTracer = 0;
    let emit = 0;
    const fit = () => {
      // Half the visible area at the gun's depth, less a margin so the gun stays on screen.
      const d = camera.position.z;
      const hh = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * d;
      reach = { x: Math.max(0, hh * camera.aspect - size * 0.9), y: Math.max(0, hh - size * 0.45) };
    };

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      fit();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const clock = new THREE.Clock();
    let spin = 0;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, clock.getDelta());
      const t = clock.elapsedTime;
      spin += ((fire.current ? 3 : 0) - spin) * Math.min(1, dt * 3);
      if (held?.spin && held.mixer) {
        held.spin.timeScale = spin;
        held.mixer.update(dt);
      }
      const on = fire.current && Math.sin(t * 90) > 0;
      flash.intensity = on ? 8 : 0;
      (flare.material as THREE.MeshBasicMaterial).opacity = on ? 0.9 : 0;
      flare.scale.setScalar(on ? 1 + Math.random() : 1);
      // Follow the pointer, tilting with the movement (nose up when moving up, a lean when moving fast).
      const tx = want.x * reach.x;
      const ty = want.y * reach.y;
      const vx = (tx - rig.position.x) * Math.min(1, dt * 8);
      const vy = (ty - rig.position.y) * Math.min(1, dt * 8);
      rig.position.x += vx;
      rig.position.y += vy;
      rig.rotation.z += (want.y * 0.35 + (vy / Math.max(1e-3, dt)) * 0.02 - rig.rotation.z) * Math.min(1, dt * 6);
      rig.rotation.y += (-want.x * 0.25 - rig.rotation.y) * Math.min(1, dt * 6);
      // Idle sway; shake while firing.
      const shake = fire.current ? 0.006 : 0;
      holder.position.set((Math.random() - 0.5) * shake, Math.sin(t * 1.3) * 0.01 + (Math.random() - 0.5) * shake, 0);
      holder.rotation.x = Math.sin(t * 0.7) * 0.04;
      // Tracers out of the muzzle, along the barrel.
      if (held && fire.current) {
        emit += dt * 40;
        held.group.updateMatrixWorld(true);
        const from = held.group.localToWorld(held.muzzle.clone());
        const dir = held.group.localToWorld(held.muzzle.clone().add(new THREE.Vector3(0, 0, -1))).sub(from).normalize();
        while (emit >= 1) {
          emit--;
          const tr = tracers[nextTracer++ % tracers.length];
          tr.m.visible = true;
          tr.m.position.copy(from);
          const spread = new THREE.Vector3((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06);
          tr.v.copy(dir).add(spread).normalize().multiplyScalar(size * 9);
          tr.m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tr.v.clone().normalize());
          tr.m.scale.set(size * 0.35, size * 0.012, size * 0.012);
          tr.life = 0.7;
        }
      }
      for (const tr of tracers) {
        if (!tr.m.visible) continue;
        tr.life -= dt;
        if (tr.life <= 0) tr.m.visible = false;
        else tr.m.position.addScaledVector(tr.v, dt);
      }
      renderer.render(scene, camera);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      tracerGeo.dispose();
      tracerMat.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className="h-72 w-full cursor-crosshair touch-none sm:h-96" aria-label="3D minigun: move to aim, click to fire" />;
}
