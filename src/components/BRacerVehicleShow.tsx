'use client';
/**
 * bRacer vehicle turntable: every team vehicle (src/lib/hyper/vehicles) and every claw preset on lit turntables.
 * Query: ?spin=0 freezes the turntables, ?yaw=<radians> sets their angle, ?thrust=0..1 opens claws / lights jets,
 * ?boost=1 shows boost (claws wide, Tesla arcs), ?only= limits the line-up (claws, teams, or ids), ?cols=, ?q=low|high|ultra.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SHIPS } from '@/lib/hyper/content';
import { teamById } from '@/lib/hyper/registry';
import { buildVehicle, CLAW_PRESETS, type Detail } from '@/lib/hyper/vehicles';
import type { Rig } from '@/lib/hyper/ships';

type Item = { label: string; sub: string; team: string; vehicle: string; variant?: string };

export function BRacerVehicleShow() {
  const host = useRef<HTMLDivElement>(null);
  const [labels, setLabels] = useState<{ label: string; sub: string; x: number; y: number }[]>([]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const q = new URLSearchParams(window.location.search);
    const spin = q.get('spin') !== '0';
    const yaw0 = Number(q.get('yaw') ?? '0.75');
    const thrust = Math.max(0, Math.min(1, Number(q.get('thrust') ?? '0.6')));
    const boost = q.get('boost') === '1';
    const only = q.get('only');
    const detail = (['low', 'high', 'ultra'].includes(q.get('q') ?? '') ? q.get('q') : 'high') as Detail;
    const teams: Item[] = [
      { label: 'V3XV0ID', sub: 'Tesla jet-bike', team: 'vexvoid', vehicle: 'jetbike' },
      { label: 'GITDEX', sub: 'Blueprint paper plane', team: 'gitdex', vehicle: 'paperplane' },
    ];
    const claws: Item[] = CLAW_PRESETS.map((p) => ({ label: `CLAW-DEX ${p.name}`, sub: p.blurb, team: 'clawdex', vehicle: 'claw', variant: p.preset }));
    const all = [...teams, ...claws];
    // ?only=claws | teams | a comma list of jetbike, paperplane, or claw preset ids.
    const items =
      only === 'claws' ? claws : only === 'teams' ? [...teams, claws[0]] : only ? only.split(',').flatMap((id) => all.filter((it) => (it.variant ?? it.vehicle) === id)) : all;
    const cols = Number(q.get('cols')) || (items.length <= 3 ? items.length : items.length <= 6 ? 3 : 4);
    const rows = Math.ceil(items.length / cols);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#07080c');
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    scene.add(new THREE.HemisphereLight('#9fb4ff', '#120a06', 0.6));
    const key = new THREE.DirectionalLight('#fff3e6', 2.4);
    key.position.set(8, 14, 10);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#5aa0ff', 1.6);
    rim.position.set(-10, 6, -12);
    scene.add(rim);
    const grid = new THREE.GridHelper(200, 100, '#1b2440', '#11172a');
    grid.position.y = -1.6;
    scene.add(grid);

    const camera = new THREE.PerspectiveCamera(32, el.clientWidth / el.clientHeight, 0.5, 400);
    const sx = 9.5;
    const sz = 10;
    const w = (cols - 1) * sx;
    const d = (rows - 1) * sz;
    camera.position.set(0, 7 + d * 1.05 + w * 0.45, 9 + d * 0.95 + w * 0.85);
    camera.lookAt(0, -0.5, 0);

    const spec = SHIPS.find((s) => s.id === 'wedge') ?? SHIPS[0];
    const rigs: { rig: Rig; table: THREE.Group; pos: THREE.Vector3; item: Item }[] = [];
    const discMat = new THREE.MeshStandardMaterial({ color: '#111318', metalness: 0.8, roughness: 0.35 });
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#f97316').multiplyScalar(1.6) });
    items.forEach((it, i) => {
      const t = teamById(it.team)!;
      const c = i % cols;
      const r = Math.floor(i / cols);
      const pos = new THREE.Vector3(c * sx - w / 2, 0, r * sz - d / 2);
      const table = new THREE.Group();
      table.position.copy(pos);
      scene.add(table);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 0.25, 48), discMat);
      disc.position.y = -1.55;
      table.add(disc);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(4.3, 0.04, 6, 64), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -1.42;
      table.add(ring);
      const rig = buildVehicle({ vehicle: it.vehicle, variant: it.variant, seed: 0, detail }, spec, { base: t.base, accent: t.accent, trim: t.trim, ticker: `$${t.name.slice(0, 5)}`, number: String(7 + i * 11).padStart(2, '0'), team: t.name, logo: null, decal: { text: 'bAcc', bg: '#f5b800', fg: '#010101' } }, t.accent === '#ffffff' ? t.base : t.accent);
      rig.root.rotation.y = yaw0;
      table.add(rig.root);
      rigs.push({ rig, table, pos, item: it });
    });

    const size = new THREE.Vector2(el.clientWidth, el.clientHeight);
    const comp = new EffectComposer(renderer);
    comp.addPass(new RenderPass(scene, camera));
    comp.addPass(new UnrealBloomPass(size, 0.45, 0.6, 1.2));
    comp.addPass(new OutputPass());

    let raf = 0;
    let frames = 0;
    const t0 = performance.now();
    const v = new THREE.Vector3();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = (performance.now() - t0) / 1000;
      for (const [i, r] of rigs.entries()) {
        if (spin) r.rig.root.rotation.y = yaw0 + t * 0.35;
        r.rig.tilt.position.y = Math.sin(t * 1.8 + i) * 0.08;
        r.rig.flame.scale.set(1, 1, 0.3 + thrust * 0.6 + (boost ? 0.9 : 0) + Math.random() * 0.1);
        r.rig.flameMat.opacity = 0.55 + thrust * 0.4;
      }
      comp.render();
      if (++frames === 3 || frames % 30 === 0) {
        setLabels(
          rigs.map((r) => {
            v.copy(r.pos).setY(-1.6).add(new THREE.Vector3(0, 0, 4.6)).project(camera);
            return { label: r.item.label, sub: r.item.sub, x: (v.x * 0.5 + 0.5) * el.clientWidth, y: (-v.y * 0.5 + 0.5) * el.clientHeight };
          }),
        );
        (window as unknown as { __vehiclesReady?: number }).__vehiclesReady = frames;
      }
    };
    loop();
    const onResize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      comp.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      for (const r of rigs) r.rig.dispose();
      comp.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div ref={host} style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#07080c', overflow: 'hidden' }}>
      {labels.map((l) => (
        <div key={l.label} style={{ position: 'absolute', left: l.x, top: l.y, transform: 'translate(-50%, 0)', textAlign: 'center', pointerEvents: 'none', fontFamily: 'ui-monospace, Menlo, monospace', color: '#e8ecf1', textShadow: '0 1px 3px #000', whiteSpace: 'nowrap' }}>
          <div style={{ fontWeight: 900, fontSize: 13, letterSpacing: 1 }}>{l.label}</div>
          <div style={{ fontSize: 11, color: '#9aa4b2' }}>{l.sub}</div>
        </div>
      ))}
    </div>
  );
}
