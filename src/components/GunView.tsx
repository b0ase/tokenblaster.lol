'use client';

/**
 * Side view of the arena's 3D minigun for the BSVGun page. Barrel spins up and the muzzle flashes
 * while `firing` is true.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildGun, GUNS } from '@/lib/arenaHD';

export function GunView({ firing }: { firing: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const fire = useRef(firing);
  useEffect(() => {
    fire.current = firing;
  }, [firing]);

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

    const holder = new THREE.Group();
    scene.add(holder);
    const flash = new THREE.PointLight('#ffb070', 0, 3);
    const flare = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffd090', transparent: true, opacity: 0 }));
    let held: ReturnType<typeof buildGun> | null = null;
    const def = GUNS[0]; // minigun
    new GLTFLoader().load(def.url, (gltf) => {
      held = buildGun(def, gltf);
      holder.add(held.group);
      held.group.add(flash, flare);
      flash.position.copy(held.muzzle);
      flare.position.copy(held.muzzle);
      // Side-on: barrel points left to right.
      holder.rotation.y = -Math.PI / 2;
      const box = new THREE.Box3().setFromObject(holder, true);
      const r = box.getSize(new THREE.Vector3()).length() / 2;
      camera.position.set(0, r * 0.35, r * 2.6);
      camera.lookAt(0, 0, 0);
    });

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
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
      // Idle sway; shake while firing.
      holder.position.set(fire.current ? (Math.random() - 0.5) * 0.006 : 0, Math.sin(t * 1.3) * 0.01 + (fire.current ? (Math.random() - 0.5) * 0.006 : 0), 0);
      holder.rotation.x = Math.sin(t * 0.7) * 0.04;
      renderer.render(scene, camera);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className="h-48 w-full sm:h-64" aria-label="3D minigun" />;
}
