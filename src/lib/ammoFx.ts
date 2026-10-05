/**
 * In-game projectiles for 1Sat Ordnance ammo types (Arena and Double-O Kweg), matching the store's
 * test-fire: bullets are small yellow tracers, pellets a fast spray, lasers an instant beam with a
 * hit flash, plasma glowing bolts, rockets a slow round with a smoke trail and an area blast,
 * grenades an arcing round that bounces once and bursts. Purely visual + a blast callback: the game
 * decides damage and what goes on chain.
 */
import * as THREE from 'three';
import type { Ammo } from './ordnance';

export type AmmoFx = {
  /**
   * Fire one projectile from `from` toward `to` (the ray's hit point or far point). For rockets and
   * grenades `onBlast(at)` runs when it explodes; for the rest `onHit(at)` runs when it arrives
   * (immediately for lasers).
   */
  fire: (kind: Ammo, from: THREE.Vector3, to: THREE.Vector3, color: string, cb?: { onHit?: (at: THREE.Vector3) => void; onBlast?: (at: THREE.Vector3) => void }) => void;
  update: (dt: number) => void;
  dispose: () => void;
};

type Live = {
  obj: THREE.Object3D;
  kind: Ammo | 'smoke' | 'boom' | 'flash';
  v: THREE.Vector3;
  age: number;
  life: number;
  to?: THREE.Vector3;
  bounced?: boolean;
  onHit?: (at: THREE.Vector3) => void;
  onBlast?: (at: THREE.Vector3) => void;
};

const glow = (c: string, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

/** One instance per scene. `floorY` is where grenades bounce. */
export function makeAmmoFx(scene: THREE.Scene, floorY = 0): AmmoFx {
  const geo = {
    bullet: new THREE.CapsuleGeometry(0.012, 0.32, 3, 6).rotateX(Math.PI / 2),
    pellet: new THREE.SphereGeometry(0.02, 6, 4),
    beam: new THREE.CylinderGeometry(0.018, 0.018, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5), // 0..1 along +Z (lookAt aims +Z)
    plasma: new THREE.CapsuleGeometry(0.04, 0.4, 4, 8).rotateX(Math.PI / 2),
    rocket: new THREE.CapsuleGeometry(0.05, 0.3, 4, 8).rotateX(Math.PI / 2),
    grenade: new THREE.SphereGeometry(0.07, 10, 8),
    smoke: new THREE.SphereGeometry(0.04, 8, 6),
    boom: new THREE.SphereGeometry(0.4, 16, 12),
    flash: new THREE.SphereGeometry(0.12, 10, 8),
  };
  const mats = {
    bullet: glow('#ffe9a0', 2.6),
    pellet: glow('#ffd27a', 2.6),
    rocket: new THREE.MeshStandardMaterial({ color: '#3d4a2a', metalness: 0.4, roughness: 0.5, emissive: '#1a1a10' }),
    grenade: new THREE.MeshStandardMaterial({ color: '#40d070', metalness: 0.3, roughness: 0.5, emissive: '#103018' }),
    smoke: new THREE.MeshBasicMaterial({ color: '#8a8580', transparent: true, opacity: 0.3, depthWrite: false }),
  };
  const colorMats = new Map<string, THREE.MeshBasicMaterial>(); // plasma / beam / flash per colour
  const tinted = (c: string, k: number) => {
    const key = `${c}:${k}`;
    let m = colorMats.get(key);
    if (!m) colorMats.set(key, (m = glow(c, k)));
    return m;
  };
  const live: Live[] = [];
  const add = (l: Live) => {
    scene.add(l.obj);
    live.push(l);
  };
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, at: THREE.Vector3) => {
    const o = new THREE.Mesh(g, m);
    o.position.copy(at);
    o.frustumCulled = false;
    return o;
  };
  const boom = (at: THREE.Vector3) => {
    const b = mesh(geo.boom, glow('#ffb070', 3), at);
    add({ obj: b, kind: 'boom', v: new THREE.Vector3(), age: 0, life: 0.35 });
    for (let i = 0; i < 6; i++) add({ obj: mesh(geo.smoke, mats.smoke, at), kind: 'smoke', v: new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).multiplyScalar(1.6), age: 0, life: 0.9 });
  };

  const fire: AmmoFx['fire'] = (kind, from, to, color, cb = {}) => {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    dir.normalize();
    if (kind === 'laser') {
      const b = mesh(geo.beam, tinted(color, 3), from);
      b.lookAt(to);
      b.scale.set(1, 1, dist);
      add({ obj: b, kind: 'laser', v: new THREE.Vector3(), age: 0, life: 0.09 });
      add({ obj: mesh(geo.flash, tinted(color, 3), to), kind: 'flash', v: new THREE.Vector3(), age: 0, life: 0.12 });
      cb.onHit?.(to.clone());
      return;
    }
    const speed = kind === 'bullet' ? 140 : kind === 'pellet' ? 110 : kind === 'plasma' ? 45 : kind === 'rocket' ? 18 : 14;
    const g = kind === 'plasma' ? geo.plasma : kind === 'pellet' ? geo.pellet : geo[kind as 'bullet' | 'rocket' | 'grenade'];
    const m = kind === 'plasma' ? tinted(color, 2.2) : mats[kind as 'bullet' | 'pellet' | 'rocket' | 'grenade'];
    const o = mesh(g, m, from);
    o.lookAt(to);
    const v = dir.clone().multiplyScalar(speed);
    if (kind === 'grenade') v.y += Math.min(6, dist * 0.35); // lob it
    add({ obj: o, kind, v, age: 0, life: kind === 'grenade' ? 2.2 : Math.max(0.05, dist / speed), to: to.clone(), onHit: cb.onHit, onBlast: cb.onBlast });
  };

  const update = (dt: number) => {
    for (let i = live.length - 1; i >= 0; i--) {
      const l = live[i];
      l.age += dt;
      const f = l.age / l.life;
      const o = l.obj;
      switch (l.kind) {
        case 'grenade':
          l.v.y -= 9.8 * dt;
          o.position.addScaledVector(l.v, dt);
          o.rotation.x += dt * 8;
          if (o.position.y < floorY + 0.07 && l.v.y < 0) {
            o.position.y = floorY + 0.07;
            if (l.bounced) l.age = l.life;
            else {
              l.bounced = true;
              l.v.multiplyScalar(0.4);
              l.v.y = Math.abs(l.v.y) + 1.5;
            }
          }
          break;
        case 'rocket':
          o.position.addScaledVector(l.v, dt);
          // Trail starts a little way out so it doesn't fog the shooter's own view.
          if (l.age > 0.08 && Math.random() < 0.7) add({ obj: mesh(geo.smoke, mats.smoke, o.position), kind: 'smoke', v: new THREE.Vector3(0, 0.4, 0), age: 0, life: 0.6 });
          break;
        case 'smoke':
          o.position.addScaledVector(l.v, dt);
          o.scale.setScalar(1 + f * 2.5);
          break;
        case 'boom':
          o.scale.setScalar(0.3 + f * 2.2);
          ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 1 - f;
          break;
        case 'laser':
        case 'flash':
          o.scale.multiplyScalar(l.kind === 'flash' ? 1 + dt * 6 : 1);
          break;
        default:
          o.position.addScaledVector(l.v, dt);
      }
      if (l.age >= l.life) {
        const at = l.kind === 'grenade' ? o.position.clone() : (l.to ?? o.position.clone());
        if (l.kind === 'rocket' || l.kind === 'grenade') {
          boom(at);
          l.onBlast?.(at);
        } else if (l.kind === 'bullet' || l.kind === 'pellet' || l.kind === 'plasma') l.onHit?.(at);
        if (l.kind === 'boom') ((o as THREE.Mesh).material as THREE.Material).dispose();
        scene.remove(o);
        live.splice(i, 1);
      }
    }
  };

  const dispose = () => {
    for (const l of live) scene.remove(l.obj);
    live.length = 0;
    for (const g of Object.values(geo)) g.dispose();
    for (const m of Object.values(mats)) m.dispose();
    for (const m of colorMats.values()) m.dispose();
  };
  return { fire, update, dispose };
}

/** Blast radius (world units) for explosive ammo. */
export const BLAST_RADIUS: Partial<Record<Ammo, number>> = { rocket: 3, grenade: 2.5 };
/** Minigun-type ordnance (whine while firing). */
export const isMinigunOrdnance = (id: string | undefined) => id === 'big-block' || id === 'fee-spike' || id === 'block-reward' || id === 'minigun-of-the-mempool';
