'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  ceilingTexture,
  fireballTexture,
  floorTexture,
  impFrames,
  makeSfx,
  medkitTexture,
  slimeTexture,
  zoneMaterials,
  type ImpFrame,
  type Sfx,
} from '@/lib/arenaArt';
import { PACKS, formatCount, packSats } from '@/lib/pricing';
import { iconUrl, tokenById, type Token } from '@/lib/tokens';
import { useBlaster } from '@/lib/useBlaster';
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
const FEE_PER_SHOT = 23; // sats: a ~224-byte blast at 100 sat/kB (src/lib/gun.ts)
const IMPS = 6;
const SLIME: [number, number][] = [
  [5, 3],
  [9, 9],
  [3, 13],
  [12, 13],
];
const LAMPS: [number, number][] = [
  [4, 1],
  [12, 7],
  [5, 14],
];
const MEDKITS: [number, number][] = [
  [14, 1],
  [7, 7],
  [1, 11],
  [14, 14],
];

const cellAt = (x: number, z: number) => MAP[Math.floor(z / SIZE)]?.[Math.floor(x / SIZE)];
const isWall = (x: number, z: number) => {
  const c = cellAt(x, z);
  return c !== '0' && c !== 'S';
};
const zoneOf = (x: number, z: number) => (x < 8 ? 0 : 1) + (z < 8 ? 0 : 2);
const centre = ([x, z]: [number, number], y: number) => new THREE.Vector3((x + 0.5) * SIZE, y, (z + 0.5) * SIZE);
const freeCells = () => {
  const out: [number, number][] = [];
  MAP.forEach((row, z) => [...row].forEach((c, x) => c === '0' && out.push([x, z])));
  return out;
};

type Hud = { kills: number; shots: number; onChain: number; heat: number; health: number; last: string | null };

/**
 * The arena: a DOOM-style maze. Imps wearing your token hunt you and throw fireballs; every
 * trigger pull is a real blast for your token, tagged `arena`, fired by the same in-browser gun
 * as /blast. Fills the window while you play. Multiplayer is the next stage (docs/arena.md).
 */
export function Arena() {
  const b = useBlaster();
  const mount = useRef<HTMLDivElement>(null);
  const weapon = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<Hud>({ kills: 0, shots: 0, onChain: 0, heat: 0, health: 100, last: null });
  const [flashing, setFlashing] = useState(false);
  const [hurt, setHurt] = useState(false);
  const [dead, setDead] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [packIdx, setPackIdx] = useState(0);
  const [custom, setCustom] = useState('');
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
    scene.fog = new THREE.Fog('#050202', 7, 32);
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);

    // ── Level: a wall set per quarter, slime pools, ceiling lamps ──
    const zones = zoneMaterials();
    const wallGeo = new THREE.BoxGeometry(SIZE, SIZE * 0.9, SIZE);
    const walls: THREE.Mesh[] = [];
    let start = new THREE.Vector3(SIZE * 1.5, 1.6, SIZE * 1.5);
    MAP.forEach((row, z) =>
      [...row].forEach((c, x) => {
        if (c === 'S') start = centre([x, z], 1.6);
        if (c !== '1') return;
        const zone = zones[zoneOf(x, z)];
        const m = new THREE.Mesh(wallGeo, (x * 7 + z * 3) % 5 === 0 ? zone.trim : zone.wall);
        m.position.copy(centre([x, z], SIZE * 0.45));
        scene.add(m);
        walls.push(m);
      }),
    );
    const span = MAP.length * SIZE;
    const plane = (tex: THREE.Texture, y: number, up: boolean) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(span, span), new THREE.MeshLambertMaterial({ map: tex }));
      m.rotation.x = up ? -Math.PI / 2 : Math.PI / 2;
      m.position.set(span / 2, y, span / 2);
      scene.add(m);
    };
    plane(floorTexture(MAP.length), 0, true);
    plane(ceilingTexture(MAP.length), SIZE * 0.9, false);
    const slimeTex = slimeTexture();
    const slimeMat = new THREE.MeshBasicMaterial({ map: slimeTex, color: '#b0ff90' });
    for (const cell of SLIME) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 0.9, SIZE * 0.9), slimeMat);
      m.rotation.x = -Math.PI / 2;
      m.position.copy(centre(cell, 0.02));
      scene.add(m);
    }
    for (const cell of LAMPS) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1, 0.15, 1), new THREE.MeshBasicMaterial({ color: '#ffe066' }));
      lamp.position.copy(centre(cell, SIZE * 0.88));
      scene.add(lamp);
      const l = new THREE.PointLight('#ffd27a', 40, 16, 1.6);
      l.position.copy(centre(cell, SIZE * 0.7));
      scene.add(l);
    }
    scene.add(new THREE.AmbientLight('#ffb0a0', 0.3));
    const torch = new THREE.PointLight('#ffc8b4', 55, 20, 1.6);
    scene.add(torch);
    const muzzle = new THREE.PointLight('#fff0c0', 0, 12, 2);
    scene.add(muzzle);
    camera.position.copy(start);

    // ── Imps: animated sprites wearing the player's token ──
    const frames = impFrames();
    let faceSrc: string | null = null;
    type Imp = {
      s: THREE.Sprite;
      hp: number;
      dir: THREE.Vector3;
      state: 'walk' | 'pain' | 'dying' | 'dead';
      since: number;
      nextShot: number;
    };
    const cells = freeCells();
    const imps: Imp[] = [];
    const placeImp = (m: Imp, now: number) => {
      let cell: [number, number];
      do cell = cells[Math.floor(Math.random() * cells.length)];
      while (centre(cell, 0).distanceTo(new THREE.Vector3(camera.position.x, 0, camera.position.z)) < SIZE * 3.5);
      m.s.position.copy(centre(cell, 1.25));
      m.hp = 3;
      m.state = 'walk';
      m.since = now;
      m.nextShot = now + 2000 + Math.random() * 2000;
      m.dir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    };
    for (let i = 0; i < IMPS; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: frames.tex('walk0'), transparent: true }));
      s.scale.set(2.5, 2.5, 2.5);
      scene.add(s);
      const m: Imp = { s, hp: 3, dir: new THREE.Vector3(), state: 'walk', since: 0, nextShot: 0 };
      placeImp(m, performance.now());
      imps.push(m);
    }
    const setFrame = (m: Imp, f: ImpFrame) => {
      const mat = m.s.material as THREE.SpriteMaterial;
      if (mat.map !== frames.tex(f)) {
        mat.map = frames.tex(f);
        mat.needsUpdate = true;
      }
    };

    // ── Fireballs and medkits ──
    const fireTex = fireballTexture();
    const fireballs: { s: THREE.Sprite; v: THREE.Vector3 }[] = [];
    const medTex = medkitTexture();
    const medkits = MEDKITS.map((cell) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: medTex, transparent: true }));
      s.scale.set(0.9, 0.9, 0.9);
      s.position.copy(centre(cell, 0.45));
      scene.add(s);
      return { s, back: 0 };
    });

    // ── Player ──
    let health = 100;
    let deadUntil = 0;
    let sfx: Sfx | null = null;
    const damage = (n: number, now: number) => {
      if (deadUntil) return;
      health = Math.max(0, health - n);
      sfx?.hurt();
      setHurt(true);
      setTimeout(() => setHurt(false), 120);
      if (health <= 0) {
        deadUntil = now + 1800;
        sfx?.dead();
        setDead(true);
      }
      setHud((h) => ({ ...h, health }));
    };

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
    const touch = {
      move: null as null | { id: number; x: number; y: number; dx: number; dy: number },
      look: null as null | { id: number; x: number; y: number },
    };
    const onTouchStart = (e: TouchEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX - r.left < r.width / 2) touch.move = { id: t.identifier, x: t.clientX, y: t.clientY, dx: 0, dy: 0 };
        else touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
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
    let walkPhase = 0;
    let recoil = 0;
    const queue: string[][] = [];
    let draining = false;
    const drain = async () => {
      if (draining) return;
      draining = true;
      while (queue.length) {
        try {
          const txid = await live.current.fire(++n, queue[0]);
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
      heat = queue.length;
      setHud((h) => ({ ...h, heat }));
      draining = false;
    };
    const shoot = () => {
      const now = performance.now();
      if (now - lastShot < 140 || deadUntil) return; // trigger rate
      if (!live.current.armed || heat >= MAX_HEAT) return;
      lastShot = now;
      sfx?.shoot();
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const targets = imps.filter((m) => m.state === 'walk' || m.state === 'pain').map((m) => m.s);
      const first = raycaster.intersectObjects([...walls, ...targets], false)[0];
      const end = first ? first.point : camera.position.clone().add(raycaster.ray.direction.clone().multiplyScalar(40));
      const from = camera.position.clone().add(new THREE.Vector3(0.3, -0.35, 0).applyEuler(camera.rotation));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, end]), tracerMat);
      scene.add(line);
      tracers.push({ line, born: now });
      const imp = first && imps.find((m) => m.s === first.object);
      let killed = false;
      if (imp) {
        imp.hp--;
        sfx?.hit();
        if (imp.hp <= 0) {
          killed = true;
          imp.state = 'dying';
          sfx?.die();
        } else {
          imp.state = 'pain';
          if (Math.random() < 0.5) sfx?.growl();
        }
        imp.since = now;
      }
      queue.push(['arena', imp ? (killed ? 'kill' : 'hit') : 'miss']);
      heat = queue.length;
      setHud((h) => ({ ...h, shots: h.shots + 1, kills: h.kills + (killed ? 1 : 0), heat }));
      setFlashing(true);
      setTimeout(() => setFlashing(false), 60);
      muzzle.intensity = 40;
      recoil = 1;
      void drain();
    };
    const onFireButton = () => shoot();
    window.addEventListener('arena:fire', onFireButton);
    const onEnter = () => {
      // Play even if the browser refuses pointer lock (arrows aim, click on the arena fires).
      setPlaying(true);
      if (!sfx) sfx = makeSfx();
      sfx?.resume();
      try {
        void Promise.resolve(renderer.domElement.requestPointerLock?.()).catch(() => undefined);
      } catch {
        /* refused */
      }
    };
    window.addEventListener('arena:enter', onEnter);

    // ── Line of sight from an imp to the player (walls only) ──
    const sight = new THREE.Raycaster();
    const canSee = (from: THREE.Vector3) => {
      const to = camera.position.clone().sub(from);
      const dist = to.length();
      if (dist > 18) return false;
      sight.set(from, to.normalize());
      sight.far = dist;
      return sight.intersectObjects(walls, false).length === 0;
    };

    // ── Loop ──
    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      const dt = Math.min(0.05, clock.getDelta());
      const now = performance.now();
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (renderer.domElement.width !== Math.floor(w * 0.4) || renderer.domElement.height !== Math.floor(h * 0.4)) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      // Token on the imps' chests.
      if (live.current.icon !== faceSrc) {
        faceSrc = live.current.icon;
        if (faceSrc) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => frames.paint(img);
          img.src = faceSrc;
        } else frames.paint(null);
      }
      // Respawn after death.
      if (deadUntil && now > deadUntil) {
        deadUntil = 0;
        health = 100;
        camera.position.copy(start);
        yaw = -Math.PI / 2;
        setDead(false);
        setHud((s) => ({ ...s, health }));
      }
      // Move with wall sliding.
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      const f = deadUntil ? 0 : (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (touch.move?.dy ?? 0);
      const s = deadUntil ? 0 : (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + (touch.move?.dx ?? 0);
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
      walkPhase += f || s ? dt * 10 : 0;
      camera.position.y = deadUntil ? 0.4 : 1.6 + (f || s ? Math.sin(walkPhase) * 0.05 : 0);
      torch.position.copy(camera.position);
      muzzle.position.copy(camera.position);
      muzzle.intensity = Math.max(0, muzzle.intensity - dt * 400);
      recoil = Math.max(0, recoil - dt * 6);
      if (weapon.current) {
        const bx = f || s ? Math.cos(walkPhase / 2) * 10 : 0;
        const by = (f || s ? Math.abs(Math.sin(walkPhase / 2)) * 8 : 0) + recoil * 26 + (deadUntil ? 200 : 0);
        weapon.current.style.transform = `translate(calc(-50% + ${bx}px), ${by}px)`;
      }
      // Slime burns.
      const here: [number, number] = [Math.floor(camera.position.x / SIZE), Math.floor(camera.position.z / SIZE)];
      if (SLIME.some(([x, z]) => x === here[0] && z === here[1]) && Math.random() < dt * 2) damage(5, now);
      slimeTex.offset.x = (now / 4000) % 1;
      // Medkits.
      for (const m of medkits) {
        if (m.back && now > m.back) {
          m.back = 0;
          m.s.visible = true;
        }
        m.s.position.y = 0.45 + Math.sin(now / 400) * 0.08;
        if (m.s.visible && health < 100 && m.s.position.distanceTo(new THREE.Vector3(camera.position.x, 0.45, camera.position.z)) < 1.2) {
          health = Math.min(100, health + 25);
          m.s.visible = false;
          m.back = now + 20000;
          sfx?.pickup();
          setHud((x) => ({ ...x, health }));
        }
      }
      // Imps: wander, chase when they see you, throw fireballs; pain and death animate.
      for (const m of imps) {
        const p = m.s.position;
        const age = now - m.since;
        if (m.state === 'dying') {
          setFrame(m, age < 150 ? 'die0' : age < 300 ? 'die1' : 'die2');
          if (age > 300) m.state = 'dead';
          continue;
        }
        if (m.state === 'dead') {
          if (age > 5000) placeImp(m, now);
          continue;
        }
        if (m.state === 'pain' && age > 200) m.state = 'walk';
        setFrame(m, m.state === 'pain' ? 'pain' : Math.floor(now / 220) % 2 ? 'walk1' : 'walk0');
        if (m.state === 'pain') continue;
        const sees = !deadUntil && canSee(p);
        if (sees) {
          m.dir.set(camera.position.x - p.x, 0, camera.position.z - p.z).normalize();
          if (now > m.nextShot) {
            m.nextShot = now + 2200 + Math.random() * 1600;
            const fb = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, transparent: true }));
            fb.scale.set(0.7, 0.7, 0.7);
            fb.position.copy(p).add(new THREE.Vector3(0, 0.2, 0));
            scene.add(fb);
            fireballs.push({ s: fb, v: camera.position.clone().sub(fb.position).normalize().multiplyScalar(9) });
            sfx?.fireball();
          }
        }
        const sp = (sees ? 1.8 : 1.3) * dt;
        const nxt = p.clone().addScaledVector(m.dir, sp);
        if (isWall(nxt.x + m.dir.x * 0.9, nxt.z + m.dir.z * 0.9)) m.dir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        else if (!sees || p.distanceTo(camera.position) > 3) p.copy(nxt);
        p.y = 1.25;
      }
      for (let i = fireballs.length - 1; i >= 0; i--) {
        const fb = fireballs[i];
        fb.s.position.addScaledVector(fb.v, dt);
        fb.s.material.rotation += dt * 8;
        const hitPlayer = fb.s.position.distanceTo(camera.position) < 0.8;
        if (hitPlayer) damage(12, now);
        if (hitPlayer || isWall(fb.s.position.x, fb.s.position.z)) {
          scene.remove(fb.s);
          fb.s.material.dispose();
          fireballs.splice(i, 1);
        }
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
  // Drop the counter the moment you fire: queued shots will each burn about one blast fee.
  const ammoNow = Math.max(0, b.ammo - hud.heat * FEE_PER_SHOT);
  const shotsLeft = Math.floor(ammoNow / FEE_PER_SHOT);

  const pickCustom = async () => {
    try {
      b.setToken(await tokenById(custom.trim()));
      setCustom('');
    } catch (e) {
      b.setError(e instanceof Error ? e.message : String(e));
    }
  };
  const choices: Token[] = [...(b.token ? [b.token] : []), ...b.tokens.filter((t) => t.id !== b.token?.id)].slice(0, 7);

  return (
    <section className={playing ? 'fixed inset-0 z-40 flex flex-col bg-bg' : 'panel'}>
      {!playing && (
        <div className="panel-header">
          <span className="panel-title">Arena</span>
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
      )}

      <div className={playing ? 'relative min-h-0 flex-1' : 'relative'}>
        <div ref={mount} className={`touch-none select-none overflow-hidden ${playing ? 'h-full w-full' : 'inset h-[62vh] min-h-72 w-full'}`} />
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-xl text-hot">+</div>
        <div ref={weapon} className="pointer-events-none absolute bottom-0 left-1/2" style={{ transform: 'translate(-50%, 0)' }}>
          <WeaponSprite flash={flashing} />
        </div>
        {hurt && <div className="pointer-events-none absolute inset-0 bg-red-600/35" />}
        {dead && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-red-900/50">
            <span className="text-4xl font-bold text-hot">YOU DIED</span>
          </div>
        )}
        {hud.heat >= MAX_HEAT && <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 text-2xl font-bold text-hot blink">OVERHEAT</div>}
        {playing && (
          <button
            onPointerDown={() => window.dispatchEvent(new Event('arena:fire'))}
            className="btn-fire absolute bottom-4 right-4 sm:hidden"
            disabled={!armed}
          >
            FIRE
          </button>
        )}
        {!playing && (
          <div
            className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-3 bg-black/70 p-4 text-center"
            onClick={(e) => e.target === e.currentTarget && window.dispatchEvent(new Event('arena:enter'))}
          >
            <p className="text-2xl font-bold text-hot">ARENA</p>
            <p className="max-w-md text-sm text-dim">
              Imps wear your token and throw fire. WASD / arrows move, mouse aims, click or space fires, Esc pauses. Phone: left thumb
              moves, right thumb aims. Every shot is a real blast.
            </p>
            <div className="flex max-w-xl flex-wrap items-center justify-center gap-1 text-xs">
              <span className="text-dim">BLAST:</span>
              {choices.map((t) => (
                <button key={t.id} onClick={() => b.setToken(t)} className={`btn ${t.id === b.token?.id ? 'btn-on' : ''}`}>
                  ${t.sym}
                </button>
              ))}
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && pickCustom()}
                placeholder="token id (txid_vout)"
                className="inset w-44 bg-input px-2 py-1 text-hot placeholder:text-muted"
              />
            </div>
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
            <p className="text-xs text-muted">{b.wallet && armed ? 'click here to play' : 'click here to walk around without ammo'}</p>
          </div>
        )}
      </div>

      {/* DOOM status bar */}
      <div className={`grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-6 ${playing ? 'p-2' : 'mt-2'}`}>
        <Cell label="HEALTH" value={`${hud.health}%`} />
        <Cell label="AMMO" value={shotsLeft.toLocaleString()} sub={`shots · ${ammoNow.toLocaleString()} sats`} />
        <Cell label="ON CHAIN" value={`${hud.onChain.toLocaleString()} / ${hud.shots.toLocaleString()}`} />
        <Cell label="KILLS" value={hud.kills.toLocaleString()} />
        <Cell label="HEAT" value={`${Math.round((hud.heat / MAX_HEAT) * 100)}%`} />
        <div className="inset flex items-center justify-center gap-2 px-2 py-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {icon ? <img src={icon} alt="" className="h-8 w-8 [image-rendering:pixelated]" /> : null}
          <span className="text-hot">${b.token?.sym ?? '…'}</span>
        </div>
      </div>

      {!playing && hud.last && (
        <p className="mt-2 truncate text-xs text-dim">
          last shot on chain:{' '}
          <a href={`https://whatsonchain.com/tx/${hud.last}`} target="_blank" rel="noreferrer" className="text-accent hover:text-hot">
            {hud.last}
          </a>
        </p>
      )}
      {(chainError || b.error) && <p className={`text-sm text-hot ${playing ? 'px-2 pb-2' : 'mt-2'}`}>⚠ {chainError ?? b.error}</p>}
      {!playing && b.wallet && b.ammo > 0 && (
        <button onClick={b.unload} disabled={!!b.busy} className="btn mt-2 text-xs">
          UNLOAD → wallet
        </button>
      )}
      {b.chooser && <WalletChooser note={b.chooser.note} onPick={b.pick} onClose={() => b.setChooser(null)} />}
    </section>
  );
}

/** Pixel-art blaster seen from behind, DOOM style. */
function WeaponSprite({ flash }: { flash: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, 48, 40);
    const px = (x: number, y: number, w: number, h: number, col: string) => {
      c.fillStyle = col;
      c.fillRect(x, y, w, h);
    };
    if (flash) {
      px(19, 0, 10, 8, '#ffd0c0');
      px(16, 3, 16, 3, '#ff9a85');
      px(22, 0, 4, 11, '#ffffff');
    }
    px(20, 8, 8, 6, '#3a1010'); // muzzle
    px(21, 9, 6, 4, '#0a0404');
    px(18, 14, 12, 10, '#6a3632'); // barrel
    px(19, 14, 2, 10, '#a05a52');
    px(14, 22, 20, 10, '#4a1414'); // body
    px(15, 22, 3, 10, '#8a2222');
    px(22, 25, 4, 3, '#7dff9a'); // sight light
    px(8, 30, 32, 10, '#2a0a0a'); // grip / hands
    px(10, 30, 8, 10, '#5e2a20');
    px(30, 30, 8, 10, '#5e2a20');
  }, [flash]);
  return <canvas ref={ref} width={48} height={40} className="w-[min(46vw,300px)] [image-rendering:pixelated]" />;
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
