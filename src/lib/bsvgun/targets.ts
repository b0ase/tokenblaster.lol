/**
 * BSVGun range targets: how a live chain transaction becomes something to shoot. Kind decides the
 * body (clay pigeon, token coin with its logo, ordinal gem, duck, pop-up plate, tracer drone,
 * golden whale, the block), size follows what moved, and the pattern decides how it flies.
 */
import * as THREE from 'three';
import type { FeedTx } from '../feed';
import { GAME_COINS } from '../gameCoins';
import { tokenMeta } from '../tokenMeta';

export type TargetKind = 'payment' | 'token' | 'inscription' | 'social' | 'data' | 'blast' | 'whale' | 'block';
export type Pattern = 'clay' | 'duck' | 'popup' | 'rail' | 'float' | 'blockrail' | 'static';

export const TARGET_INFO: Record<TargetKind, { label: string; color: string; glow: string; pts: number; hp: number; radius: number; pattern: Pattern }> = {
  payment: { label: 'PAYMENT', color: '#ff7a1a', glow: '#ff5a00', pts: 100, hp: 1, radius: 1.05, pattern: 'clay' },
  blast: { label: 'BLAST', color: '#f4f4ee', glow: '#9fd8ff', pts: 160, hp: 1, radius: 0.85, pattern: 'clay' },
  token: { label: 'TOKEN', color: '#e8b53a', glow: '#ffb800', pts: 250, hp: 1, radius: 1.35, pattern: 'rail' },
  inscription: { label: 'ORDINAL', color: '#ff3a52', glow: '#ff1f3a', pts: 300, hp: 1, radius: 1.2, pattern: 'rail' },
  social: { label: 'POST', color: '#ff9a85', glow: '#ff5fa8', pts: 200, hp: 1, radius: 1.3, pattern: 'duck' },
  data: { label: 'DATA', color: '#c9372c', glow: '#ff2a2a', pts: 120, hp: 1, radius: 1.25, pattern: 'popup' },
  whale: { label: 'WHALE', color: '#ffd24a', glow: '#ffc400', pts: 1000, hp: 2, radius: 1.9, pattern: 'float' },
  block: { label: 'BLOCK', color: '#ffb800', glow: '#ff8a00', pts: 2500, hp: 7, radius: 2.6, pattern: 'blockrail' },
};

/** Which target a feed transaction becomes. Big moves are rare golden whales. */
export function kindOf(f: FeedTx): TargetKind {
  if (f.sats >= 50_000_000 || f.bytes >= 150_000) return 'whale';
  switch (f.kind) {
    case 'payment':
      return 'payment';
    case 'token':
      return 'token';
    case 'inscription':
      return 'inscription';
    case 'social':
      return 'social';
    case 'data':
      return 'data';
    case 'blast':
      return 'blast';
  }
}

/** 0.75..1.5 from what moved and how big the tx is. */
export function sizeOf(f: FeedTx): number {
  const s = 0.75 + Math.log10(1 + Math.max(0, f.sats)) * 0.055 + Math.log10(1 + Math.max(0, f.bytes)) * 0.05;
  return Math.min(1.7, Math.max(0.9, s * 1.15));
}

/** Short label for the kill popup. */
export function labelOf(f: FeedTx, kind: TargetKind): string {
  if (kind === 'token' && f.token) {
    const m = tokenMeta(f.token);
    return `$${m?.sym ?? f.token.slice(0, 6)}${f.amt ? ` ${f.amt.length > 9 ? f.amt.slice(0, 6) + '…' : f.amt}` : ''}`;
  }
  if (kind === 'whale') return `WHALE ${(f.sats / 1e8).toFixed(f.sats >= 1e9 ? 1 : 2)} BSV`;
  if (kind === 'payment') return f.sats > 0 ? `${f.sats >= 1e6 ? (f.sats / 1e8).toFixed(3) + ' BSV' : f.sats.toLocaleString() + ' sats'}` : 'PAYMENT';
  if (kind === 'social') return f.appName ?? 'POST';
  if (kind === 'data') return `DATA ${f.bytes.toLocaleString()}B`;
  if (kind === 'inscription') return f.preview ? `ORDINAL ${f.preview.slice(0, 14)}` : 'ORDINAL';
  if (kind === 'blast') return f.game ? `BLAST · ${f.game}` : 'BLAST';
  return TARGET_INFO[kind].label;
}

/** Stand-in transactions when the live stream is off or quiet, so the range is never empty. */
const SYNTH: { w: number; kind: FeedTx['kind'] }[] = [
  { w: 34, kind: 'payment' },
  { w: 20, kind: 'data' },
  { w: 16, kind: 'social' },
  { w: 12, kind: 'token' },
  { w: 10, kind: 'inscription' },
  { w: 8, kind: 'blast' },
];
export function synthTx(rnd: () => number): FeedTx {
  let r = rnd() * 100;
  let kind: FeedTx['kind'] = 'payment';
  for (const s of SYNTH) {
    if ((r -= s.w) < 0) {
      kind = s.kind;
      break;
    }
  }
  const whale = rnd() < 0.016;
  const sats = whale ? 60_000_000 + Math.floor(rnd() * 400_000_000) : Math.floor(10 ** (2 + rnd() * 5));
  const id = Array.from({ length: 16 }, () => Math.floor(rnd() * 16).toString(16)).join('');
  // Simulated tokens are this site's own game coins, so the coin faces show real logos.
  const coins = Object.values(GAME_COINS);
  const token = kind === 'token' ? coins[Math.floor(rnd() * coins.length)].id : undefined;
  return { id: `sim${id}`, kind: whale ? 'payment' : kind, bytes: Math.floor(200 + rnd() * 3000), sats, mined: false, token, appName: kind === 'social' ? 'MAP · sim' : undefined };
}

// ── Meshes ──────────────────────────────────────────────────────────

const glowTex = (() => {
  let t: THREE.CanvasTexture | null = null;
  return () => {
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
})();
export const glowTexture = glowTex;

/** Soft additive halo sprite. */
export function halo(color: string, size: number, opacity = 0.7) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  s.scale.setScalar(size);
  return s;
}

const std = (color: string, glow: string, emissive = 0.55, rough = 0.38, metal = 0.25) =>
  new THREE.MeshStandardMaterial({ color, emissive: glow, emissiveIntensity: emissive, roughness: rough, metalness: metal });

let G: ReturnType<typeof makeGeos> | null = null;
function makeGeos() {
  // Clay pigeon: a shallow saucer, lathe of its half profile.
  const prof = [new THREE.Vector2(0.001, 0.16), new THREE.Vector2(0.42, 0.13), new THREE.Vector2(0.96, 0.02), new THREE.Vector2(1, -0.03), new THREE.Vector2(0.86, -0.08), new THREE.Vector2(0.45, -0.1), new THREE.Vector2(0.001, -0.02)];
  return {
    clay: new THREE.LatheGeometry(prof, 28),
    coin: new THREE.CylinderGeometry(1, 1, 0.16, 36).rotateX(Math.PI / 2),
    face: new THREE.CircleGeometry(0.82, 36),
    gem: new THREE.OctahedronGeometry(1, 0),
    plate: new THREE.CylinderGeometry(1, 1, 0.1, 6).rotateX(Math.PI / 2),
    body: new THREE.SphereGeometry(1, 16, 12),
    beak: new THREE.ConeGeometry(0.28, 0.7, 8).rotateX(Math.PI / 2),
    wing: new THREE.BoxGeometry(1.5, 0.06, 0.85),
    drone: new THREE.IcosahedronGeometry(1, 1),
    ring: new THREE.TorusGeometry(1, 0.05, 8, 40),
    cube: new THREE.BoxGeometry(1, 1, 1),
  };
}
const geos = () => (G ??= makeGeos());

const symCache = new Map<string, THREE.CanvasTexture>();
function symbolTexture(key: string, sym: string, ring: string): THREE.CanvasTexture {
  const hit = symCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#14151a';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = ring;
  g.font = '900 italic 46px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(sym.slice(0, 5).toUpperCase(), 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  symCache.set(key, t);
  return t;
}
const logoCache = new Map<string, THREE.CanvasTexture>();
/** The token's logo as a texture once its image has loaded (null until then). */
function logoTexture(id: string): THREE.CanvasTexture | null {
  const hit = logoCache.get(id);
  if (hit) return hit;
  const m = tokenMeta(id);
  const img = m?.icon;
  if (!img || !img.complete || !img.naturalWidth) return null;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#14151a';
    g.fillRect(0, 0, 128, 128);
    g.drawImage(img, 0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    logoCache.set(id, t);
    return t;
  } catch {
    return null;
  }
}

export type TargetRig = {
  group: THREE.Group;
  /** Per-frame animation (wing flap, spin). */
  tick: (t: number, dt: number) => void;
  /** Materials this rig owns (for hit flash / disposal). */
  mats: THREE.MeshStandardMaterial[];
  /** The logo/symbol face, if any, and a retry to swap in the real logo. */
  upgradeLogo?: () => boolean;
  dispose: () => void;
};

/** Build the body for a target. `scale` multiplies the base radius. */
export function buildTarget(kind: TargetKind, f: FeedTx, scale: number): TargetRig {
  const info = TARGET_INFO[kind];
  const g = geos();
  const group = new THREE.Group();
  const mats: THREE.MeshStandardMaterial[] = [];
  const own = <T extends THREE.Material>(m: T) => m;
  const mat = (color = info.color, glow = info.glow, em = 0.55, rough = 0.38, metal = 0.25) => {
    const m = std(color, glow, em, rough, metal);
    mats.push(m);
    return m;
  };
  const extra: { dispose: () => void }[] = [];
  const haloOf = (color: string, size: number, opacity: number) => {
    const h = halo(color, size, opacity);
    extra.push(h.material);
    return h;
  };
  let tick: TargetRig['tick'] = () => undefined;
  let upgradeLogo: TargetRig['upgradeLogo'];

  if (kind === 'payment' || kind === 'blast') {
    const m = new THREE.Mesh(g.clay, mat());
    m.scale.setScalar(info.radius * scale);
    group.add(m);
    // A bright rim ring so it reads against the night sky and blooms.
    const rim = new THREE.Mesh(g.ring, own(new THREE.MeshBasicMaterial({ color: new THREE.Color(info.glow).multiplyScalar(1.7), toneMapped: false })));
    extra.push(rim.material as THREE.Material);
    rim.rotation.x = Math.PI / 2;
    rim.scale.setScalar(info.radius * scale * 0.98);
    group.add(rim);
    tick = (_t, dt) => {
      m.rotation.y += dt * 11;
      m.rotation.z = Math.sin(_t * 3) * 0.22;
    };
  } else if (kind === 'token') {
    const body = new THREE.Group();
    const coin = new THREE.Mesh(g.coin, mat('#e8b53a', '#ffb800', 0.4, 0.28, 0.85));
    const faceMat = new THREE.MeshBasicMaterial({ map: symbolTexture(f.token ?? 'tok', (f.token && tokenMeta(f.token)?.sym) || 'TOKEN', '#e8b53a'), toneMapped: false });
    extra.push(faceMat);
    const front = new THREE.Mesh(g.face, faceMat);
    front.position.z = 0.085;
    const back = new THREE.Mesh(g.face, faceMat);
    back.position.z = -0.085;
    back.rotation.y = Math.PI;
    body.add(coin, front, back);
    body.scale.setScalar(info.radius * scale);
    group.add(body);
    group.add(haloOf(info.glow, info.radius * scale * 3.2, 0.35));
    upgradeLogo = () => {
      if (!f.token) return true;
      const t = logoTexture(f.token);
      if (!t) return false;
      faceMat.map = t;
      faceMat.needsUpdate = true;
      return true;
    };
    upgradeLogo();
    tick = (t, dt) => {
      body.rotation.y += dt * 2.8;
      body.rotation.x = Math.sin(t * 2) * 0.15;
    };
  } else if (kind === 'inscription') {
    const gem = new THREE.Mesh(g.gem, mat('#ff3a52', '#ff1f3a', 0.75, 0.15, 0.4));
    gem.scale.set(0.75, 1, 0.75);
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(g.gem), new THREE.LineBasicMaterial({ color: '#ffd0d6', toneMapped: false }));
    extra.push(wire.material as THREE.Material, wire.geometry);
    wire.scale.copy(gem.scale).multiplyScalar(1.01);
    const body = new THREE.Group();
    body.add(gem, wire);
    body.scale.setScalar(info.radius * scale);
    group.add(body, haloOf(info.glow, info.radius * scale * 3, 0.4));
    tick = (t, dt) => {
      body.rotation.y += dt * 2.2;
      body.rotation.z = Math.sin(t * 1.7) * 0.2;
    };
  } else if (kind === 'social') {
    const s = info.radius * scale;
    const white = mat('#f6efe6', '#ff9a85', 0.12, 0.6, 0);
    const body = new THREE.Mesh(g.body, white);
    body.scale.set(0.8 * s, 0.55 * s, 1.15 * s);
    const head = new THREE.Mesh(g.body, mat('#2fbf8f', '#00ff9c', 0.3, 0.4, 0.1));
    head.scale.setScalar(0.38 * s);
    head.position.set(0, 0.5 * s, -0.95 * s);
    const beak = new THREE.Mesh(g.beak, mat('#ff9a1a', '#ff7a00', 0.5));
    beak.scale.setScalar(s * 0.9);
    beak.position.set(0, 0.46 * s, -1.4 * s);
    const wingMat = mat('#e86ab0', '#ff2f92', 0.45, 0.5, 0.05);
    const wl = new THREE.Group();
    const wr = new THREE.Group();
    const wingL = new THREE.Mesh(g.wing, wingMat);
    wingL.position.x = -0.75;
    const wingR = new THREE.Mesh(g.wing, wingMat);
    wingR.position.x = 0.75;
    wl.add(wingL);
    wr.add(wingR);
    wl.position.set(-0.4 * s, 0.1 * s, 0);
    wr.position.set(0.4 * s, 0.1 * s, 0);
    wl.scale.setScalar(s);
    wr.scale.setScalar(s);
    const tail = new THREE.Mesh(g.wing, white);
    tail.scale.set(0.25 * s, 1, 0.5 * s);
    tail.position.set(0, 0.15 * s, 1.2 * s);
    group.add(body, head, beak, wl, wr, tail);
    group.add(haloOf(info.glow, s * 3.2, 0.25));
    tick = (t) => {
      const a = Math.sin(t * 13) * 0.75;
      wl.rotation.z = a;
      wr.rotation.z = -a;
      body.position.y = Math.sin(t * 13) * 0.04 * s;
    };
  } else if (kind === 'data') {
    const s = info.radius * scale;
    const plate = new THREE.Mesh(g.plate, mat('#9c241c', '#ff2a2a', 0.5, 0.45, 0.5));
    plate.scale.setScalar(s);
    const ring = new THREE.Mesh(g.ring, own(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3a30').multiplyScalar(1.6), toneMapped: false })));
    extra.push(ring.material as THREE.Material);
    ring.scale.setScalar(s * 0.7);
    ring.position.z = 0.06;
    const dot = new THREE.Mesh(g.ring, ring.material);
    dot.scale.setScalar(s * 0.28);
    dot.position.z = 0.06;
    group.add(plate, ring, dot);
  } else if (kind === 'whale') {
    const s = info.radius * scale;
    const body = new THREE.Group();
    const disc = new THREE.Mesh(g.clay, mat('#ffd24a', '#ffb800', 0.8, 0.2, 0.9));
    disc.scale.setScalar(s);
    const r1 = new THREE.Mesh(g.ring, own(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd24a').multiplyScalar(2), toneMapped: false })));
    extra.push(r1.material as THREE.Material);
    r1.scale.setScalar(s * 1.35);
    r1.rotation.x = Math.PI / 2;
    const r2 = new THREE.Mesh(g.ring, r1.material);
    r2.scale.setScalar(s * 1.7);
    body.add(disc, r1, r2);
    group.add(body, haloOf('#ffc400', s * 4.2, 0.28));
    tick = (t, dt) => {
      disc.rotation.y += dt * 6;
      r1.rotation.z += dt * 1.4;
      r2.rotation.x = Math.PI / 2 + Math.sin(t * 2) * 0.35;
    };
  } else {
    // block
    const s = info.radius * scale;
    const cube = new THREE.Mesh(g.cube, mat('#ffb800', '#ff8a00', 0.55, 0.25, 0.6));
    cube.scale.setScalar(s * 1.5);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g.cube), new THREE.LineBasicMaterial({ color: '#fff2c0', toneMapped: false }));
    extra.push(edges.material as THREE.Material, edges.geometry);
    edges.scale.copy(cube.scale).multiplyScalar(1.005);
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d')!;
    x.fillStyle = '#1a1208';
    x.fillRect(0, 0, 256, 256);
    x.strokeStyle = '#ffb800';
    x.lineWidth = 10;
    x.strokeRect(10, 10, 236, 236);
    x.fillStyle = '#ffb800';
    x.textAlign = 'center';
    x.font = '900 italic 44px Impact, "Arial Black", sans-serif';
    x.fillText('BLOCK', 128, 100);
    x.font = '900 italic 52px Impact, "Arial Black", sans-serif';
    x.fillStyle = '#fff';
    x.fillText(f.op ?? '', 128, 170);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    extra.push(label, tex);
    const faces: THREE.Mesh[] = [];
    for (const [px, py, pz, ry] of [[0, 0, 0.76, 0], [0, 0, -0.76, Math.PI], [0.76, 0, 0, Math.PI / 2], [-0.76, 0, 0, -Math.PI / 2]] as const) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), label);
      extra.push(p.geometry);
      p.position.set(px * s * 1.5 * 0.99, py, pz * s * 1.5 * 0.99);
      p.rotation.y = ry;
      p.scale.setScalar(s * 1.5);
      faces.push(p);
    }
    const body = new THREE.Group();
    body.add(cube, edges, ...faces);
    group.add(body, haloOf('#ff8a00', s * 5, 0.5));
    tick = (t, dt) => {
      body.rotation.y += dt * 0.6;
      body.rotation.x = Math.sin(t * 0.9) * 0.12;
    };
  }

  return {
    group,
    tick,
    mats,
    upgradeLogo,
    dispose: () => {
      for (const m of mats) m.dispose();
      for (const e of extra) e.dispose();
    },
  };
}
