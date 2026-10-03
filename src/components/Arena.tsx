'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { iconUrl } from '@/lib/tokens';
import { useBlaster } from '@/lib/useBlaster';
import { PACKS, formatCount, packSats } from '@/lib/pricing';
import { WalletChooser } from './WalletChooser';

/** 1 = wall. The player starts at S. */
const MAP = [
  '1111111111111111',
  '1S00000100000001',
  '1011110101111101',
  '1010000000000101',
  '1010111111110101',
  '1000100000010001',
  '1110101111010111',
  '1000001001000001',
  '1011101001011101',
  '1000100000010001',
  '1010111011110101',
  '1010000000000101',
  '1011110111111101',
  '1000000100000001',
  '1000000000000001',
  '1111111111111111',
];
const SIZE = 4; // world units per cell
const MAX_HEAT = 12; // shots queued for the chain before the gun overheats
const DRONES = 6;

const isWall = (x: number, z: number) => {
  const cx = Math.floor(x / SIZE);
  const cz = Math.floor(z / SIZE);
  return MAP[cz]?.[cx] !== '0' && MAP[cz]?.[cx] !== 'S';
};
const freeCells = () => {
  const out: [number, number][] = [];
  MAP.forEach((row, z) => [...row].forEach((c, x) => c === '0' && out.push([x, z])));
  return out;
};

type Hud = { kills: number; shots: number; onChain: number; heat: number; last: string | null };

/**
 * Stage 1 of the arena: a solo DOOM-style maze. Every trigger pull is a real blast for your token,
 * tagged `arena`, fired by the same in-browser gun as /blast. Drones are practice targets; other
 * players arrive in stage 2.
 */
export function Arena() {
  const b = useBlaster();
  const mount = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<Hud>({ kills: 0, shots: 0, onChain: 0, heat: 0, last: null });
  const [flashing, setFlashing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [packIdx, setPackIdx] = useState(0);
  const [chainError, setChainError] = useState<string | null>(null);

  // The game loop reads the latest blaster state through refs.
  const armed = b.ammo > 30 && Boolean(b.token);
  const live = useRef({ armed, fire: b.fire, icon: iconUrl(b.token?.icon ?? null) });
  useEffect(() => {
    live.current = { armed, fire: b.fire, icon: iconUrl(b.token?.icon ?? null) };
  }, [armed, b.fire, b.token]);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;

    // ── Renderer: low resolution, scaled up with hard pixels ──
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(0.4);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.imageRendering = 'pixelated';
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#050202');
    scene.fog = new THREE.Fog('#050202', 4, 34);
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);

    // ── Level: dark walls with glowing red edges ──
    const wallGeo = new THREE.BoxGeometry(SIZE, SIZE * 0.9, SIZE);
    const wallMat = new THREE.MeshBasicMaterial({ color: '#1a0606' });
    const edgeGeo = new THREE.EdgesGeometry(wallGeo);
    const edgeMat = new THREE.LineBasicMaterial({ color: '#ff5a48' });
    const walls: THREE.Mesh[] = [];
    let start = new THREE.Vector3(SIZE * 1.5, 1.6, SIZE * 1.5);
    MAP.forEach((row, z) =>
      [...row].forEach((c, x) => {
        if (c === 'S') start = new THREE.Vector3((x + 0.5) * SIZE, 1.6, (z + 0.5) * SIZE);
        if (c !== '1') return;
        const m = new THREE.Mesh(wallGeo, wallMat);
        m.position.set((x + 0.5) * SIZE, SIZE * 0.45, (z + 0.5) * SIZE);
        m.add(new THREE.LineSegments(edgeGeo, edgeMat));
        scene.add(m);
        walls.push(m);
      }),
    );
    const span = MAP.length * SIZE;
    const floor = new THREE.GridHelper(span, MAP.length * 2, '#5a1a14', '#2a0a0a');
    floor.position.set(span / 2, 0, span / 2);
    scene.add(floor);
    const ceiling = new THREE.GridHelper(span, MAP.length, '#2a0a0a', '#1a0606');
    ceiling.position.set(span / 2, SIZE * 0.9, span / 2);
    scene.add(ceiling);
    camera.position.copy(start);

    // ── Drones: token-faced sprites that drift around the maze ──
    const faceCanvas = document.createElement('canvas');
    faceCanvas.width = faceCanvas.height = 64;
    const face = new THREE.CanvasTexture(faceCanvas);
    face.magFilter = THREE.NearestFilter;
    const paintFace = (img?: HTMLImageElement) => {
      const c = faceCanvas.getContext('2d')!;
      c.fillStyle = '#ff5a48';
      c.fillRect(0, 0, 64, 64);
      c.fillStyle = '#050202';
      c.fillRect(6, 6, 52, 52);
      if (img) c.drawImage(img, 10, 10, 44, 44);
      else {
        c.fillStyle = '#ff5a48';
        c.fillRect(16, 20, 10, 10);
        c.fillRect(38, 20, 10, 10);
        c.fillRect(18, 42, 28, 6);
      }
      face.needsUpdate = true;
    };
    paintFace();
    let faceSrc: string | null = null;

    type Drone = { s: THREE.Sprite; hp: number; dir: THREE.Vector3; hitAt: number };
    const cells = freeCells();
    const drones: Drone[] = [];
    const placeDrone = (d: Drone) => {
      let cell: [number, number];
      do cell = cells[Math.floor(Math.random() * cells.length)];
      while (Math.hypot((cell[0] + 0.5) * SIZE - camera.position.x, (cell[1] + 0.5) * SIZE - camera.position.z) < SIZE * 3);
      d.s.position.set((cell[0] + 0.5) * SIZE, 1.5, (cell[1] + 0.5) * SIZE);
      d.hp = 3;
      d.dir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    };
    for (let i = 0; i < DRONES; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: face, color: '#ffffff' }));
      s.scale.set(1.6, 1.6, 1.6);
      scene.add(s);
      const d: Drone = { s, hp: 3, dir: new THREE.Vector3(), hitAt: 0 };
      placeDrone(d);
      drones.push(d);
    }

    // ── Tracers ──
    const tracers: { line: THREE.Line; born: number }[] = [];
    const tracerMat = new THREE.LineBasicMaterial({ color: '#ffd0c0' });

    // ── Input ──
    const keys = new Set<string>();
    let yaw = -Math.PI / 2; // start looking along the first corridor (+x)
    let pitch = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.type === 'keydown') keys.add(e.code);
      else keys.delete(e.code);
      if (e.code === 'Space' && e.type === 'keydown') shoot();
    };
    const onMouse = (e: MouseEvent) => {
      if (document.pointerLockElement !== renderer.domElement) return;
      yaw -= e.movementX * 0.0025;
      pitch = Math.max(-1.2, Math.min(1.2, pitch - e.movementY * 0.0025));
    };
    const onClick = () => shoot();
    let wasLocked = false;
    const onLock = () => {
      const locked = document.pointerLockElement === renderer.domElement;
      if (wasLocked && !locked) setPlaying(false); // Esc pauses
      wasLocked = locked;
    };
    // Touch: left half = move stick, right half = look; FIRE is a DOM button (window event).
    const touch = { move: null as null | { id: number; x: number; y: number; dx: number; dy: number }, look: null as null | { id: number; x: number; y: number } };
    const onTouchStart = (e: TouchEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX - r.left < r.width / 2) touch.move = { id: t.identifier, x: t.clientX, y: t.clientY, dx: 0, dy: 0 };
        else touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
      setPlaying(true);
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (touch.move?.id === t.identifier) {
          touch.move.dx = Math.max(-1, Math.min(1, (t.clientX - touch.move.x) / 50));
          touch.move.dy = Math.max(-1, Math.min(1, (t.clientY - touch.move.y) / 50));
        }
        if (touch.look?.id === t.identifier) {
          yaw -= (t.clientX - touch.look.x) * 0.006;
          pitch = Math.max(-1.2, Math.min(1.2, pitch - (t.clientY - touch.look.y) * 0.006));
          touch.look.x = t.clientX;
          touch.look.y = t.clientY;
        }
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (touch.move?.id === t.identifier) touch.move = null;
        if (touch.look?.id === t.identifier) touch.look = null;
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    document.addEventListener('mousemove', onMouse);
    document.addEventListener('pointerlockchange', onLock);
    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: true });
    renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
    renderer.domElement.addEventListener('touchend', onTouchEnd);

    // ── Shooting: instant on screen, one real blast per shot in the background ──
    const raycaster = new THREE.Raycaster();
    let n = 0;
    let heat = 0;
    let lastShot = 0;
    const queue: string[][] = [];
    let draining = false;
    const drain = async () => {
      if (draining) return;
      draining = true;
      while (queue.length) {
        const extra = queue[0];
        try {
          const txid = await live.current.fire(++n, extra);
          setHud((h) => ({ ...h, onChain: h.onChain + 1, last: txid }));
          setChainError(null);
        } catch (e) {
          setChainError(e instanceof Error ? e.message : String(e));
          queue.length = 0;
          break;
        }
        queue.shift();
        heat = queue.length;
        setHud((h) => ({ ...h, heat }));
      }
      draining = false;
    };
    const shoot = () => {
      const now = performance.now();
      if (now - lastShot < 140) return; // trigger rate
      if (!live.current.armed || heat >= MAX_HEAT) return;
      lastShot = now;
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const hits = raycaster.intersectObjects([...walls, ...drones.map((d) => d.s)], false);
      const first = hits[0];
      const end = first ? first.point : camera.position.clone().add(raycaster.ray.direction.clone().multiplyScalar(40));
      const from = camera.position.clone().add(new THREE.Vector3(0.3, -0.35, 0).applyEuler(camera.rotation));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, end]), tracerMat);
      scene.add(line);
      tracers.push({ line, born: now });
      const drone = first && drones.find((d) => d.s === first.object);
      let killed = false;
      if (drone) {
        drone.hp--;
        drone.hitAt = now;
        if (drone.hp <= 0) {
          killed = true;
          placeDrone(drone);
        }
      }
      queue.push(['arena', drone ? (killed ? 'kill' : 'hit') : 'miss']);
      heat = queue.length;
      setHud((h) => ({ ...h, shots: h.shots + 1, kills: h.kills + (killed ? 1 : 0), heat }));
      setFlashing(true);
      setTimeout(() => setFlashing(false), 60);
      void drain();
    };
    const onFireButton = () => shoot();
    window.addEventListener('arena:fire', onFireButton);
    const onEnter = () => {
      // Play even if the browser refuses pointer lock (arrows aim, click on the arena fires).
      setPlaying(true);
      try {
        void Promise.resolve(renderer.domElement.requestPointerLock?.()).catch(() => undefined);
      } catch {
        /* refused */
      }
    };
    window.addEventListener('arena:enter', onEnter);

    // ── Loop ──
    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      const dt = Math.min(0.05, clock.getDelta());
      const now = performance.now();
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (renderer.domElement.width !== Math.floor(w * 0.4)) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      // Token face on the drones.
      if (live.current.icon !== faceSrc) {
        faceSrc = live.current.icon;
        if (faceSrc) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => paintFace(img);
          img.src = faceSrc;
        } else paintFace();
      }
      // Move with wall sliding.
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (touch.move?.dy ?? 0);
      const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + (touch.move?.dx ?? 0);
      if (keys.has('ArrowLeft')) yaw += 2.2 * dt;
      if (keys.has('ArrowRight')) yaw -= 2.2 * dt;
      const speed = 6 * dt;
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const step = fwd.multiplyScalar(f * speed).add(right.multiplyScalar(s * speed));
      const pad = 0.4;
      const nx = camera.position.x + step.x;
      const nz = camera.position.z + step.z;
      if (!isWall(nx + Math.sign(step.x) * pad, camera.position.z)) camera.position.x = nx;
      if (!isWall(camera.position.x, nz + Math.sign(step.z) * pad)) camera.position.z = nz;
      camera.position.y = 1.6 + (f || s ? Math.sin(now / 90) * 0.05 : 0);
      // Drones drift and bounce off walls; flash white when hit.
      for (const d of drones) {
        const p = d.s.position;
        const nxt = p.clone().addScaledVector(d.dir, 1.6 * dt);
        if (isWall(nxt.x + d.dir.x * 0.8, nxt.z + d.dir.z * 0.8)) d.dir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        else p.copy(nxt);
        p.y = 1.5 + Math.sin(now / 300 + p.x) * 0.15;
        (d.s.material as THREE.SpriteMaterial).color.set(now - d.hitAt < 90 ? '#ffffff' : d.hp < 3 ? '#ff9a85' : '#ffffff');
        d.s.scale.setScalar(now - d.hitAt < 90 ? 1.9 : 1.6);
      }
      for (let i = tracers.length - 1; i >= 0; i--) {
        if (now - tracers[i].born > 70) {
          scene.remove(tracers[i].line);
          tracers[i].line.geometry.dispose();
          tracers.splice(i, 1);
        }
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('arena:fire', onFireButton);
      window.removeEventListener('arena:enter', onEnter);
      document.removeEventListener('mousemove', onMouse);
      document.removeEventListener('pointerlockchange', onLock);
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  const pack = PACKS[packIdx];
  const icon = iconUrl(b.token?.icon ?? null);

  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">Arena · stage 1: solo drones</span>
        <span className="text-dim">
          {b.wallet ? (
            <>
              {b.wallet.name} <span className="text-hot">{b.wallet.address.slice(0, 6)}…</span>
            </>
          ) : (
            'not connected'
          )}
        </span>
      </div>

      <div className="relative">
        <div ref={mount} className="inset h-[58vh] min-h-72 w-full touch-none select-none overflow-hidden" />
        {/* Crosshair */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-xl text-hot">+</div>
        {/* Held gun, DOOM-style, bottom centre */}
        <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2">
          <div className={`mx-auto h-4 w-6 ${flashing ? 'bg-hot' : 'bg-transparent'}`} />
          <div className="mx-auto h-10 w-8 border-x-4 border-t-4 border-fg bg-[#4a1414]" />
          <div className="h-8 w-24 border-4 border-fg bg-[#2a0a0a]" />
        </div>
        {hud.heat >= MAX_HEAT && <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 text-2xl font-bold text-hot blink">OVERHEAT</div>}
        {!playing && (
          <div
            className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-3 bg-black/70 p-4 text-center"
            onClick={(e) => e.target === e.currentTarget && window.dispatchEvent(new Event('arena:enter'))}
          >
            <p className="text-2xl font-bold text-hot">ARENA</p>
            <p className="max-w-md text-sm text-dim">
              WASD / arrows to move, mouse to aim, click or space to fire. On a phone: left thumb moves, right thumb aims, FIRE button
              shoots. Every shot is a real blast for your token.
            </p>
            {!b.wallet ? (
              <button onClick={b.connectWallet} disabled={!!b.busy} className="btn-fire">
                {b.busy === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET'}
              </button>
            ) : !armed ? (
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-2">
                  <button onClick={() => setPackIdx((i) => Math.max(0, i - 1))} className="btn">
                    ‹
                  </button>
                  <span className="w-28 text-hot">{formatCount(pack)} shots</span>
                  <button onClick={() => setPackIdx((i) => Math.min(PACKS.length - 1, i + 1))} className="btn">
                    ›
                  </button>
                </div>
                <button onClick={() => b.load(packSats(pack), `TokenBlaster arena: ${formatCount(pack)} shots`)} disabled={!!b.busy} className="btn-fire">
                  {b.busy === 'loading' ? 'APPROVE IN WALLET…' : `LOAD ${formatCount(pack)}`}
                </button>
              </div>
            ) : null}
            <p className="text-xs text-muted">{b.wallet && armed ? 'click here to play · Esc to pause' : 'click here to walk around without ammo'}</p>
          </div>
        )}
      </div>

      {/* DOOM status bar */}
      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-6">
        <Cell label="AMMO" value={`${b.ammo.toLocaleString()}`} sub="sats" />
        <Cell label="SHOTS" value={hud.shots.toLocaleString()} />
        <Cell label="ON CHAIN" value={hud.onChain.toLocaleString()} />
        <Cell label="KILLS" value={hud.kills.toLocaleString()} />
        <Cell label="HEAT" value={`${Math.round((hud.heat / MAX_HEAT) * 100)}%`} />
        <div className="inset flex items-center justify-center gap-2 px-2 py-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {icon ? <img src={icon} alt="" className="h-8 w-8 [image-rendering:pixelated]" /> : null}
          <span className="text-hot">${b.token?.sym ?? '…'}</span>
        </div>
      </div>

      <button
        onPointerDown={() => window.dispatchEvent(new Event('arena:fire'))}
        className="btn-fire mt-2 w-full sm:hidden"
        disabled={!armed}
      >
        FIRE
      </button>

      {hud.last && (
        <p className="mt-2 truncate text-xs text-dim">
          last shot on chain:{' '}
          <a href={`https://whatsonchain.com/tx/${hud.last}`} target="_blank" rel="noreferrer" className="text-accent hover:text-hot">
            {hud.last}
          </a>
        </p>
      )}
      {(chainError || b.error) && <p className="mt-2 text-sm text-hot">⚠ {chainError ?? b.error}</p>}
      {b.wallet && b.ammo > 0 && !playing && (
        <button onClick={b.unload} disabled={!!b.busy} className="btn mt-2 text-xs">
          UNLOAD → wallet
        </button>
      )}
      {b.chooser && <WalletChooser note={b.chooser.note} onPick={b.pick} onClose={() => b.setChooser(null)} />}
    </section>
  );
}

function Cell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="inset px-2 py-1">
      <div className="text-xs tracking-widest text-dim">{label}</div>
      <div className="text-lg font-bold tabular-nums text-hot">
        {value}
        {sub && <span className="text-xs text-dim"> {sub}</span>}
      </div>
    </div>
  );
}
