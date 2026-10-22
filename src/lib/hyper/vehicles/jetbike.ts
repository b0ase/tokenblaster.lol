/**
 * V3XV0ID "Tesla jet-bike": a long, low, obsidian-black glossy jet-bike with brushed-chrome panels, a glowing blue
 * hover ring where the front wheel would be, two turbine nacelles with electric-blue jets, blue strip lights, and a
 * pair of Tesla coils that arc when it boosts. Cosmetic only: physics come from the hull the player picked.
 */
import * as THREE from 'three';
import type { ShipSpec } from '../sim';
import type { Livery } from '../teams';
import type { Rig } from '../ships';
import { bare, flameGeo, flameMaterial, kitMaterial, liveryCanvas, merge, mergeBare, onFrame, part, ring, rng, rtaper, shieldMesh, SURF, tube, type Detail, type Surf } from './kit';

const OBSIDIAN: Surf = { c: '#07080b', m: 0.55, r: 0.08, cc: 1 };
const CHROME: Surf = { c: '#c9ced6', m: 1, r: 0.3, cc: 0 };
const BRIGHT: Surf = { c: '#e8ecf1', m: 1, r: 0.12, cc: 0.4 };
const BLUE = '#2f8cff';
const LED: Surf = { c: BLUE, m: 0, r: 0.5, g: 5 };
const LEATHER: Surf = { c: '#121214', m: 0.1, r: 0.62, cc: 0.2 };

type BikeGeo = { hull: THREE.BufferGeometry; glass: THREE.BufferGeometry; plates: THREE.BufferGeometry; glow: THREE.BufferGeometry; trim: THREE.BufferGeometry; flame: THREE.BufferGeometry; engine: THREE.Vector3[]; nozzleZ: number; coils: THREE.Vector3[] };
const cache = new Map<Detail, BikeGeo>();

function bikeGeo(detail: Detail): BikeGeo {
  const hit = cache.get(detail);
  if (hit) return hit;
  const lo = detail === 'low';
  const seg = lo ? 12 : 28;
  const hull: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  // Main body: a long teardrop, pointed nose, squashed low.
  const zN = 2.95;
  const zT = -2.35;
  const rB = (t: number) => 0.56 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.62) + 0.12 * (1 - t) + 0.01;
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 22; i++) {
    const t = i / 22;
    prof.push(new THREE.Vector2(Math.max(0.01, rB(t)), zT + t * (zN - zT)));
  }
  const body = new THREE.LatheGeometry(prof, seg);
  body.rotateX(Math.PI / 2);
  body.scale(0.82, 0.62, 1);
  hull.push(part(body.translate(0, 0.08, 0), OBSIDIAN));
  // Spine: a raised obsidian fairing ridge with a chrome crest line.
  hull.push(part(rtaper(0.34, 0.2, 0.16, 0.12, 3.6, 0.45).translate(0, 0.36, -1.9), OBSIDIAN));
  hull.push(part(rtaper(0.05, 0.03, 0.03, 0.02, 3.0, 0.4, 1).translate(0, 0.47, -1.7), BRIGHT));
  // Brushed chrome side panels (flank cowls).
  for (const sx of [1, -1]) {
    const cowl = new THREE.CylinderGeometry(0.6, 0.6, 2.7, lo ? 6 : 14, 1, true, sx > 0 ? Math.PI / 2 - 0.55 : (3 * Math.PI) / 2 - 0.55, 1.1);
    cowl.rotateX(Math.PI / 2);
    cowl.scale(0.88, 0.66, 1);
    hull.push(part(cowl.translate(0, 0.06, 0.15), CHROME));
    // Blue strip light along each flank.
    const s = rtaper(0.03, 0.03, 0.03, 0.03, 4.1, 0.4, 1);
    hull.push(part(s.translate(sx * 0.43, -0.05, -1.9), LED));
    const s2 = rtaper(0.025, 0.025, 0.02, 0.02, 1.5, 0.4, 1);
    s2.rotateY(sx * 0.12);
    hull.push(part(s2.translate(sx * 0.36, 0.2, 0.9), LED));
  }
  // Belly pan, brushed.
  hull.push(part(rtaper(0.7, 0.16, 0.5, 0.1, 3.8, 0.35).translate(0, -0.3, -1.9), CHROME));
  hull.push(part(rtaper(0.08, 0.04, 0.08, 0.04, 3.3, 0.4, 1).translate(0, -0.39, -1.6), LED));
  // Seat + tank + bars.
  hull.push(part(rtaper(0.46, 0.14, 0.4, 0.12, 1.15, 0.5).translate(0, 0.36, -1.6), LEATHER));
  hull.push(part(rtaper(0.5, 0.22, 0.3, 0.2, 1.0, 0.5).translate(0, 0.38, -0.45), OBSIDIAN));
  const bar = new THREE.CylinderGeometry(0.035, 0.035, 1.05, 8);
  bar.rotateZ(Math.PI / 2);
  hull.push(part(bar.translate(0, 0.52, 0.55), BRIGHT));
  for (const sx of [1, -1]) {
    const grip = new THREE.CylinderGeometry(0.055, 0.055, 0.22, 8);
    grip.rotateZ(Math.PI / 2);
    hull.push(part(grip.translate(sx * 0.6, 0.52, 0.55), SURF.rubber));
  }
  // Front fork + hover ring (the wheel, as light).
  for (const sx of [1, -1]) {
    const fork = rtaper(0.07, 0.16, 0.05, 0.12, 1.3, 0.3);
    fork.rotateX(0.62);
    hull.push(part(fork.translate(sx * 0.22, 0.25, 1.0), BRIGHT));
  }
  const wheelZ = 1.85;
  const wheelY = -0.28;
  const ringG = new THREE.TorusGeometry(0.46, 0.06, 8, lo ? 18 : 40);
  ringG.rotateY(Math.PI / 2);
  hull.push(part(ringG.translate(0, wheelY, wheelZ), { c: BLUE, m: 0, r: 0.4, g: 6 }));
  const rim = new THREE.TorusGeometry(0.53, 0.035, 6, lo ? 18 : 40);
  rim.rotateY(Math.PI / 2);
  hull.push(part(rim.translate(0, wheelY, wheelZ), BRIGHT));
  const hub = new THREE.CylinderGeometry(0.16, 0.16, 0.3, 14);
  hub.rotateZ(Math.PI / 2);
  hull.push(part(hub.translate(0, wheelY, wheelZ), BRIGHT));
  // Turbine nacelles.
  const nx = 0.86;
  const ny = -0.12;
  const nz0 = -2.7;
  const nz1 = -0.35;
  const nR = (t: number) => 0.27 + 0.08 * Math.sin(Math.PI * Math.min(1, t * 1.3)) - 0.05 * t;
  const nAt = (z: number) => nR((z - nz0) / (nz1 - nz0));
  const nProf: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    nProf.push(new THREE.Vector2(nR(t), nz0 + t * (nz1 - nz0)));
  }
  const engine: THREE.Vector3[] = [];
  const nozzleZ = nz0 - 0.18;
  for (const sx of [1, -1]) {
    const x = sx * nx;
    const nac = new THREE.LatheGeometry(nProf, lo ? 12 : 24, 0, Math.PI * 2);
    nac.rotateX(Math.PI / 2);
    hull.push(part(nac.translate(x, ny, 0), OBSIDIAN));
    // Chrome bands and intake lip.
    for (const z of [-2.3, -1.95, -0.9]) hull.push(part(ring(nAt(z) + 0.01, 0.03, z, lo ? 12 : 24).translate(x, ny, 0), CHROME));
    hull.push(part(ring(nAt(nz1) - 0.02, 0.05, nz1, lo ? 12 : 24).translate(x, ny, 0), BRIGHT));
    const fan = new THREE.CircleGeometry(0.2, lo ? 12 : 24);
    hull.push(part(fan.translate(x, ny, nz1 - 0.06), { c: BLUE, m: 0, r: 0.5, g: 2.5 }));
    if (!lo) {
      for (let b = 0; b < 8; b++) {
        const blade = rtaper(0.03, 0.18, 0.03, 0.18, 0.03, 0.3, 1);
        blade.translate(0, 0.09, 0);
        blade.rotateZ((b * Math.PI) / 4);
        hull.push(part(blade.translate(x, ny, nz1 - 0.04), BRIGHT));
      }
    }
    // Nozzle.
    hull.push(part(tube(0.25, 0.22, nozzleZ, nz0 + 0.05, lo ? 12 : 22, true).translate(x, ny, 0), BRIGHT));
    hull.push(part(ring(0.25, 0.035, nozzleZ, lo ? 12 : 22).translate(x, ny, 0), CHROME));
    const gd = new THREE.CircleGeometry(0.2, 18);
    gd.rotateY(Math.PI);
    glow.push(bare(gd.translate(x, ny, nozzleZ + 0.08)));
    trim.push(bare(ring(0.21, 0.022, nozzleZ + 0.02, 22).translate(x, ny, 0)));
    // Pylon from body to nacelle.
    const py = rtaper(0.12, 0.62, 0.08, 0.32, 1.2, 0.3);
    py.rotateZ(sx * Math.PI / 2);
    hull.push(part(py.translate(sx * 0.45, 0.02, -2.0), CHROME));
    // Stabiliser wings.
    const w = rtaper(0.62, 0.05, 0.25, 0.035, 0.9, 0.3);
    w.rotateY(-sx * 0.55);
    hull.push(part(w.translate(x + sx * 0.2, ny + 0.05, -2.55), BRIGHT));
    const wl = rtaper(0.03, 0.03, 0.03, 0.03, 0.75, 0.4, 1);
    wl.rotateY(-sx * 0.55);
    trim.push(bare(wl.translate(x + sx * 0.48, ny + 0.09, -2.5)));
    engine.push(new THREE.Vector3(x, ny, nozzleZ));
  }
  // Tesla coils at the tail.
  const coils: THREE.Vector3[] = [];
  for (const sx of [1, -1]) {
    const x = sx * 0.3;
    hull.push(part(tube(0.05, 0.05, 0, 0.42, 10).rotateX(-Math.PI / 2).translate(x, 0.3, -2.15), BRIGHT));
    if (!lo) for (let k = 0; k < 5; k++) hull.push(part(ring(0.075, 0.018, 0, 12).rotateX(Math.PI / 2).translate(x, 0.36 + k * 0.06, -2.15), { c: '#b87333', m: 1, r: 0.3 }));
    hull.push(part(ring(0.13, 0.05, 0, 16).rotateX(Math.PI / 2).translate(x, 0.74, -2.15), BRIGHT));
    coils.push(new THREE.Vector3(x, 0.74, -2.15));
  }
  // Tail light bar.
  trim.push(bare(rtaper(0.62, 0.05, 0.62, 0.05, 0.04, 0.4, 1).translate(0, 0.16, zT + 0.02)));
  // Windscreen.
  const ws = new THREE.SphereGeometry(0.42, lo ? 10 : 20, lo ? 6 : 12, 0, Math.PI * 2, 0, Math.PI / 2);
  ws.scale(0.95, 0.6, 1.6);
  ws.rotateX(-0.25);
  const glass = part(ws.translate(0, 0.42, 0.3), { c: '#0a1830', m: 0.2, r: 0.04, cc: 1 });
  // Number boards: both flanks + the tail.
  const plates: THREE.BufferGeometry[] = [];
  for (const sx of [1, -1]) {
    const p = new THREE.PlaneGeometry(0.8, 0.42);
    p.rotateY((sx * Math.PI) / 2);
    plates.push(p.translate(sx * 0.56, 0.1, 0.75));
  }
  const tp = new THREE.PlaneGeometry(0.7, 0.36);
  tp.rotateY(Math.PI);
  plates.push(tp.translate(0, -0.06, zT - 0.02));
  const flame = flameGeo(engine.map((e) => new THREE.Vector3(e.x, e.y, 0)), 0.19, 3.2, lo ? 8 : 14);
  const g: BikeGeo = { hull: merge(hull), glass: glass, plates: mergeBare(plates.map((p) => bare(p, true))), glow: mergeBare(glow), trim: mergeBare(trim), flame, engine, nozzleZ, coils };
  cache.set(detail, g);
  return g;
}

/** Brushed metal: fine horizontal streaks (roughness and bump). Deterministic. */
let brushed: THREE.CanvasTexture | null = null;
function brushedTex() {
  if (brushed) return brushed;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const r = rng(1337);
  g.fillStyle = '#d8d8d8';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const v = Math.floor(150 + r() * 105);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.globalAlpha = 0.35 + r() * 0.5;
    g.fillRect(r() * 256 - 64, r() * 256, 40 + r() * 200, 1);
  }
  g.globalAlpha = 1;
  brushed = new THREE.CanvasTexture(c);
  brushed.wrapS = brushed.wrapT = THREE.RepeatWrapping;
  brushed.repeat.set(2, 6);
  return brushed;
}

/** Number board: gloss black, chrome-edged, the race number big in white, ticker and team underneath. */
export function paintBike(c: HTMLCanvasElement, l: Livery) {
  const g = c.getContext('2d')!;
  const S = c.width;
  const grd = g.createLinearGradient(0, 0, 0, S);
  grd.addColorStop(0, '#16181d');
  grd.addColorStop(1, '#030304');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#c9ced6';
  g.lineWidth = S * 0.03;
  g.strokeRect(S * 0.03, S * 0.03, S * 0.94, S * 0.94);
  g.fillStyle = BLUE;
  g.fillRect(S * 0.08, S * 0.66, S * 0.84, S * 0.012);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f4f6f8';
  g.font = `900 ${S * 0.42}px Impact, "Arial Black", sans-serif`;
  g.fillText(l.number, S * 0.5, S * 0.38, S * 0.86);
  g.fillStyle = '#9fb3c8';
  g.font = `bold ${S * 0.1}px ui-monospace, Menlo, monospace`;
  g.fillText(l.ticker, S * 0.5, S * 0.76, S * 0.86);
  g.fillStyle = l.decal ? l.decal.bg : '#8a8a8a';
  g.font = `900 ${S * 0.08}px Impact, "Arial Black", sans-serif`;
  g.fillText(l.decal ? l.decal.text : l.team, S * 0.5, S * 0.89, S * 0.86);
}

let bikeMat: THREE.MeshPhysicalMaterial | null = null;
let glassMat: THREE.MeshPhysicalMaterial | null = null;
let bikeGlow: THREE.MeshBasicMaterial | null = null;

export function buildJetBike(spec: ShipSpec, l: Livery, _accent: string, detail: Detail = 'high'): Rig {
  const G = bikeGeo(detail);
  bikeMat ??= kitMaterial({ roughnessMap: brushedTex(), bumpMap: brushedTex(), bumpScale: 0.6, clearcoatRoughness: 0.03, envMapIntensity: 1.9 }, 'jetbike');
  glassMat ??= kitMaterial({ transparent: true, opacity: 0.82, envMapIntensity: 2.5 }, 'jetbike-glass');
  bikeGlow ??= new THREE.MeshBasicMaterial({ color: new THREE.Color('#bfe0ff').multiplyScalar(1.6), side: THREE.DoubleSide });
  const { canvas, tex } = liveryCanvas(256);
  paintBike(canvas, l);
  const bodyMat = new THREE.MeshPhysicalMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(0.5, 0.5, 0.55), metalness: 0.3, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04 });
  const trimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(BLUE).multiplyScalar(3.6) });
  const flameMat = flameMaterial('#3f9bff', 0.9);
  const arcMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#9fd0ff').multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);
  const k = Math.max(0.85, Math.min(1.15, spec.length / 5.8));
  const model = new THREE.Group();
  model.scale.setScalar(k);
  tilt.add(model);
  const mk = (g: THREE.BufferGeometry, m: THREE.Material) => {
    const me = new THREE.Mesh(g, m);
    me.frustumCulled = false;
    model.add(me);
    return me;
  };
  const hull = mk(G.hull, bikeMat);
  mk(G.glass, glassMat);
  mk(G.plates, bodyMat);
  mk(G.trim, trimMat);
  const glow = mk(G.glow, bikeGlow);
  const flame = mk(G.flame, flameMat);
  flame.position.z = G.nozzleZ;
  // Tesla arc between the coil tops: a jagged line re-drawn every frame, mostly when boosting.
  const N = 10;
  const arcPos = new Float32Array(N * 3 * 2);
  const arcGeo = new THREE.BufferGeometry();
  arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPos, 3));
  const arc = new THREE.Line(arcGeo, arcMat);
  arc.frustumCulled = false;
  arc.visible = false;
  model.add(arc);
  const [a, b] = G.coils;
  const R = rng(Math.floor(Math.random() * 1e9));
  onFrame(hull, tilt, flame, (m) => {
    const p = m.boost > 0.5 ? 0.85 : 0.08 + m.thrust * 0.12;
    arc.visible = R() < p;
    if (!arc.visible) return;
    // Two passes of the bolt, end to end, for a doubled flicker.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) {
        const t = pass ? 1 - i / (N - 1) : i / (N - 1);
        const o = (pass * N + i) * 3;
        const j = t < 0.01 || t > 0.99 ? 0 : 0.1;
        arcPos[o] = a.x + (b.x - a.x) * t + (R() - 0.5) * j * 0.5;
        arcPos[o + 1] = a.y + Math.sin(Math.PI * t) * 0.14 + (R() - 0.5) * j * 1.6;
        arcPos[o + 2] = a.z + (R() - 0.5) * j * 1.6;
      }
    }
    arcGeo.attributes.position.needsUpdate = true;
  });
  const shield = shieldMesh(5.8 * k);
  tilt.add(shield);
  return {
    root, tilt, flame, flameMat, glow, canvas, tex, bodyMat, trimMat, shield,
    engine: G.engine.map((e) => e.clone().multiplyScalar(k)),
    setLivery(nl) {
      paintBike(canvas, nl);
      tex.needsUpdate = true;
    },
    dispose() {
      tex.dispose();
      bodyMat.dispose();
      trimMat.dispose();
      flameMat.dispose();
      arcMat.dispose();
      arcGeo.dispose();
      shield.geometry.dispose();
      (shield.material as THREE.Material).dispose();
    },
  };
}
