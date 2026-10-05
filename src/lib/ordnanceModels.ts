'use client';

/**
 * 1Sat Ordnance weapons in 3D: the held-gun definition for a weapon (its own model if it has one,
 * stats from the catalogue) and a cached loader. Shared by the store art, the Arena and Double-O Kweg
 * so a gun looks and sits the same everywhere.
 */
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUNS, type GunDef } from './arenaHD';
import { modelPath, type Ordnance } from './ordnance';

/** How the weapon is held: its base gun's placement, its own model and fit, its own stats. */
export function gunDefFor(o: Ordnance): GunDef {
  const base = GUNS.find((g) => g.id === o.base) ?? GUNS[0];
  const own = Boolean(o.model);
  return {
    ...base,
    ...o.stats,
    id: o.id,
    name: o.name,
    key: '',
    url: modelPath(o),
    flip: own ? (o.fit?.flip ?? false) : base.flip,
    roll: o.fit?.roll,
    length: o.fit?.length ?? base.length,
    spin: own ? undefined : base.spin,
  };
}

const cache = new Map<string, Promise<GLTF>>();
/** Load (once) a gun model by site path. */
export function loadGunModel(url: string): Promise<GLTF> {
  let p = cache.get(url);
  if (!p) {
    p = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}
