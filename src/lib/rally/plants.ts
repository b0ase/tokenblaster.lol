/**
 * Procedural vegetation + rocks: alpha-card conifers/broadleaf/palms with trunk geometry, saguaro
 * cacti, displaced-icosphere rocks and grass tufts. Every prototype has a high and a low LOD; the
 * scenery builder merges instances per stage block and swaps LODs by distance. Wind weights ride
 * in a vertex attribute (`aWind`).
 */
import * as THREE from 'three';
import { clamp, rng, vnoise } from './noise';

export type Arr = { pos: number[]; nor: number[]; uv: number[]; col: number[]; wind: number[]; idx: number[] };
export const newArr = (): Arr => ({ pos: [], nor: [], uv: [], col: [], wind: [], idx: [] });
export type PlantKind = 'pine' | 'oak' | 'birch' | 'palm' | 'deadpine' | 'cactus' | 'cactusShort' | 'rock' | 'rockTall' | 'stump' | 'log' | 'bush' | 'fern';
export type Proto = { kind: PlantKind; h: number; w: number; foliage?: Arr; bark?: Arr; rock?: Arr; cactus?: Arr; collide: number };

// Atlas quadrants: 0 needles, 1 broadleaf, 2 frond, 3 grass.
export function foliageAtlas() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const R = rng(5);
  const h = S / 2;
  // 0: needle branch along +x (u), centre line v=.5
  g.save();
  g.translate(0, 0);
  g.beginPath();
  g.rect(0, 0, h, h);
  g.clip();
  g.strokeStyle = '#3d2a1a';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(0, h / 2);
  g.lineTo(h, h / 2);
  g.stroke();
  for (let i = 0; i < 1100; i++) {
    const x = R() * h;
    const reach = (1 - x / h) * 0.9 + 0.1;
    const a = (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.8);
    const len = (14 + R() * 50) * reach;
    const sh = 120 + R() * 110;
    g.strokeStyle = `rgb(${sh * 0.6},${sh * 1.0},${sh * 0.5})`;
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(x, h / 2);
    g.lineTo(x + Math.cos(a) * len * 0.5, h / 2 + Math.sin(a) * len);
    g.stroke();
  }
  g.restore();
  // 1: broadleaf cluster
  g.save();
  g.beginPath();
  g.rect(h, 0, h, h);
  g.clip();
  for (let i = 0; i < 260; i++) {
    const x = h + h * 0.12 + R() * h * 0.76;
    const y = h * 0.12 + R() * h * 0.76;
    const dx = x - (h + h / 2);
    const dy = y - h / 2;
    if (dx * dx + dy * dy > (h * 0.4) ** 2) continue;
    const sh = 130 + R() * 110;
    g.fillStyle = `rgb(${sh * 0.66},${sh},${sh * 0.45})`;
    g.save();
    g.translate(x, y);
    g.rotate(R() * 6.28);
    g.beginPath();
    g.ellipse(0, 0, 11 + R() * 9, 5 + R() * 4, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.restore();
  // 2: palm frond along +x
  g.save();
  g.beginPath();
  g.rect(0, h, h, h);
  g.clip();
  g.strokeStyle = '#5a7a3a';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(0, h + h / 2);
  g.lineTo(h, h + h / 2);
  g.stroke();
  for (let i = 0; i < 70; i++) {
    const x = (i / 70) * h * 0.97;
    const reach = Math.sin((i / 70) * Math.PI * 0.9 + 0.2) * 0.45 + 0.05;
    for (const s of [-1, 1]) {
      g.strokeStyle = `rgb(${70 + R() * 30},${120 + R() * 50},${55 + R() * 20})`;
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(x, h + h / 2);
      g.lineTo(x + 20, h + h / 2 + s * h * reach);
      g.stroke();
    }
  }
  g.restore();
  // 3: grass blades growing up (v up)
  g.save();
  g.beginPath();
  g.rect(h, h, h, h);
  g.clip();
  for (let i = 0; i < 46; i++) {
    const x = h + 8 + R() * (h - 16);
    const hgt = h * (0.35 + R() * 0.6);
    const sh = 110 + R() * 100;
    g.fillStyle = `rgb(${sh * 0.72},${sh},${sh * 0.38})`;
    g.beginPath();
    g.moveTo(x - 5, S);
    g.quadraticCurveTo(x - 2 + (R() - 0.5) * 30, S - hgt * 0.6, x + (R() - 0.5) * 40, S - hgt);
    g.quadraticCurveTo(x + 4 + (R() - 0.5) * 20, S - hgt * 0.6, x + 5, S);
    g.fill();
  }
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  return t;
}

export function barkTextures() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const R = rng(9);
  g.fillStyle = '#6b5340';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 300; i++) {
    const x = R() * 256;
    const w = 2 + R() * 6;
    const sh = 40 + R() * 70;
    g.fillStyle = `rgb(${sh * 1.2},${sh},${sh * 0.8})`;
    g.fillRect(x, 0, w, 256);
  }
  for (let i = 0; i < 120; i++) {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(R() * 256, R() * 256, 1 + R() * 3, 6 + R() * 30);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const bc = document.createElement('canvas');
  bc.width = bc.height = 256;
  const b = bc.getContext('2d')!;
  b.drawImage(c, 0, 0);
  b.globalCompositeOperation = 'saturation';
  b.fillStyle = '#808080';
  b.fillRect(0, 0, 256, 256);
  const bump = new THREE.CanvasTexture(bc);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  return { map, bump };
}

// ───────────── Geometry helpers ─────────────

function pushQuad(a: Arr, p: THREE.Vector3[], nrm: THREE.Vector3, uv: [number, number][], col: number[][], wind: number[]) {
  const b = a.pos.length / 3;
  for (let i = 0; i < 4; i++) {
    a.pos.push(p[i].x, p[i].y, p[i].z);
    a.nor.push(nrm.x, nrm.y, nrm.z);
    a.uv.push(uv[i][0], uv[i][1]);
    a.col.push(col[i][0], col[i][1], col[i][2]);
    a.wind.push(wind[i]);
  }
  a.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
}

function pushTube(a: Arr, pts: THREE.Vector3[], r0: number, r1: number, seg: number, col: [number, number, number], windScale: number, h: number) {
  const base = a.pos.length / 3;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    const r = r0 + (r1 - r0) * t;
    const tan = (i < pts.length - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
    const side = new THREE.Vector3().crossVectors(tan, Math.abs(tan.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up).normalize();
    const fwd = new THREE.Vector3().crossVectors(side, tan).normalize();
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const n = side.clone().multiplyScalar(Math.cos(th)).add(fwd.clone().multiplyScalar(Math.sin(th)));
      a.pos.push(pts[i].x + n.x * r, pts[i].y + n.y * r, pts[i].z + n.z * r);
      a.nor.push(n.x, n.y, n.z);
      a.uv.push((k / seg) * 2, pts[i].y * 0.3);
      a.col.push(col[0], col[1], col[2]);
      a.wind.push(clamp(pts[i].y / h, 0, 1) ** 2 * windScale);
    }
  }
  const row = seg + 1;
  for (let i = 0; i < pts.length - 1; i++)
    for (let k = 0; k < seg; k++) {
      const p = base + i * row + k;
      a.idx.push(p, p + row, p + 1, p + 1, p + row, p + row + 1);
    }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function pineProto(seed: number, hi: boolean, dead: boolean): Proto {
  const R = rng(seed);
  const H = 13 + R() * 6;
  const foliage = newArr();
  const bark = newArr();
  const trunk: THREE.Vector3[] = [];
  const steps = hi ? 7 : 3;
  for (let i = 0; i <= steps; i++) trunk.push(V(Math.sin(i * 1.3 + seed) * 0.12 * (i / steps), (i / steps) * H, 0));
  pushTube(bark, trunk, 0.34, 0.04, hi ? 10 : 5, [0.8, 0.78, 0.76], 0.5, H);
  const whorls = dead ? Math.floor(whorlsFor(hi) * 0.4) : whorlsFor(hi);
  const per = hi ? 6 : 4;
  for (let w = 0; w < whorls; w++) {
    const f = w / (whorls - 1);
    const y = H * (0.2 + 0.78 * f);
    const len = (1 - f) ** 0.85 * 3.6 + 0.5;
    const rot = R() * 6.28;
    for (let b = 0; b < per; b++) {
      const a = rot + (b / per) * Math.PI * 2 + (R() - 0.5) * 0.4;
      const dir = V(Math.cos(a), 0, Math.sin(a));
      const sideV = V(-dir.z, 0, dir.x);
      const droop = 0.42 * len;
      const half = len * (hi ? 0.78 : 0.95);
      const tip = dir.clone().multiplyScalar(len).add(V(0, -droop, 0));
      const o = V(0, y, 0);
      const p = [o.clone().addScaledVector(sideV, -0.12), o.clone().addScaledVector(sideV, 0.12), o.clone().add(tip).addScaledVector(sideV, half), o.clone().add(tip).addScaledVector(sideV, -half)];
      const nrm = new THREE.Vector3().crossVectors(p[1].clone().sub(p[0]), p[3].clone().sub(p[0])).normalize();
      if (nrm.y < 0) nrm.negate();
      const shade = 0.55 + 0.45 * f;
      pushQuad(foliage, p, nrm, [[0, 0.52], [0, 0.98], [0.49, 0.98], [0.49, 0.52]] as [number, number][], [[shade * 0.7, shade * 0.7, shade * 0.7], [shade * 0.7, shade * 0.7, shade * 0.7], [shade, shade, shade], [shade, shade, shade]], [0.1, 0.1, 0.9, 0.9]);
      if (hi) {
        // Second, steeper card for body.
        const tilt = V(0, 0.25 * len, 0);
        const p2 = [o.clone(), o.clone(), o.clone().add(tip).add(tilt).addScaledVector(sideV, half * 0.7), o.clone().add(tip).add(tilt).addScaledVector(sideV, -half * 0.7)];
        pushQuad(foliage, p2, V(0, 1, 0), [[0, 0.52], [0, 0.98], [0.49, 0.98], [0.49, 0.52]] as [number, number][], [[0.6, 0.6, 0.6], [0.6, 0.6, 0.6], [shade, shade, shade], [shade, shade, shade]], [0.1, 0.1, 0.9, 0.9]);
      }
    }
  }
  return { kind: dead ? 'deadpine' : 'pine', h: H, w: 3.4, foliage, bark, collide: 0.5 };
}
const whorlsFor = (hi: boolean) => (hi ? 17 : 8);

function broadProto(seed: number, hi: boolean, birch: boolean): Proto {
  const R = rng(seed + 100);
  const H = (birch ? 9 : 8) + R() * 3;
  const foliage = newArr();
  const bark = newArr();
  const th = H * 0.42;
  pushTube(bark, [V(0, 0, 0), V(0.1, th * 0.5, 0), V(0, th, 0.1)], birch ? 0.18 : 0.38, 0.12, hi ? 9 : 5, birch ? [1.3, 1.3, 1.25] : [0.8, 0.78, 0.76], 0.4, H);
  const clusters = hi ? 26 : 9;
  for (let i = 0; i < clusters; i++) {
    const a = R() * 6.28;
    const r = Math.sqrt(R()) * H * 0.34;
    const cy = th + 0.1 * H + R() * H * 0.5;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const s = (hi ? 2.1 : 3.2) * (0.8 + R() * 0.5);
    const shade = 0.6 + 0.4 * ((cy - th) / (H * 0.6));
    for (const rot of hi ? [0, Math.PI / 2, Math.PI / 4] : [0, Math.PI / 2]) {
      const d = V(Math.cos(rot), 0, Math.sin(rot)).multiplyScalar(s);
      const p = [V(cx - d.x, cy - s * 0.5, cz - d.z), V(cx + d.x, cy - s * 0.5, cz + d.z), V(cx + d.x, cy + s * 0.5, cz + d.z), V(cx - d.x, cy + s * 0.5, cz - d.z)];
      const nrm = V(-d.z, 0, d.x).normalize();
      pushQuad(foliage, p, V(nrm.x * 0.4, 0.9, nrm.z * 0.4).normalize(), [[0.51, 0.52], [0.99, 0.52], [0.99, 0.98], [0.51, 0.98]] as [number, number][], [[shade * 0.6, shade * 0.6, shade * 0.6], [shade * 0.6, shade * 0.6, shade * 0.6], [shade, shade, shade], [shade, shade, shade]], [0.7, 0.7, 1, 1]);
    }
  }
  return { kind: birch ? 'birch' : 'oak', h: H, w: H * 0.7, foliage, bark, collide: 0.45 };
}

function palmProto(seed: number, hi: boolean): Proto {
  const R = rng(seed + 200);
  const H = 7 + R() * 4;
  const bend = (R() - 0.5) * 2.4;
  const pts: THREE.Vector3[] = [];
  const n = hi ? 8 : 4;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(V(bend * t * t, t * H, 0.3 * bend * t * t));
  }
  const bark = newArr();
  pushTube(bark, pts, 0.28, 0.16, hi ? 9 : 5, [1, 0.95, 0.85], 0.6, H);
  const foliage = newArr();
  const top = pts[pts.length - 1];
  const fronds = hi ? 14 : 8;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + R() * 0.3;
    const dir = V(Math.cos(a), 0, Math.sin(a));
    const side = V(-dir.z, 0, dir.x);
    const segs = hi ? 5 : 2;
    let prev = top.clone();
    for (let s = 1; s <= segs; s++) {
      const t = s / segs;
      const out = t * 3.4;
      const y = top.y + Math.sin(t * 2.2) * 1.1 - t * t * 1.6;
      const cur = top.clone().addScaledVector(dir, out).add(V(0, y - top.y, 0));
      const w0 = 0.55 * (1 - ((s - 1) / segs) ** 2) + 0.05;
      const w1 = 0.55 * (1 - (s / segs) ** 2) + 0.05;
      const p = [prev.clone().addScaledVector(side, -w0), prev.clone().addScaledVector(side, w0), cur.clone().addScaledVector(side, w1), cur.clone().addScaledVector(side, -w1)];
      const u0 = ((s - 1) / segs) * 0.49;
      const u1 = (s / segs) * 0.49;
      pushQuad(foliage, p, V(0, 1, 0), [[u0, 0.02], [u0, 0.48], [u1, 0.48], [u1, 0.02]] as [number, number][], [[0.8, 0.8, 0.8], [0.8, 0.8, 0.8], [1, 1, 1], [1, 1, 1]], [0.6 + t * 0.4, 0.6 + t * 0.4, 1, 1].map((v, i) => (i < 2 ? ((s - 1) / segs) * 0.9 + 0.1 : (s / segs) * 0.9 + 0.1)));
      prev = cur;
    }
  }
  return { kind: 'palm', h: H, w: 6, foliage, bark, collide: 0.35 };
}

function rockProto(seed: number, hi: boolean, tall: boolean): Proto {
  const R = rng(seed + 300);
  const g = new THREE.IcosahedronGeometry(1, hi ? 4 : 2);
  const p = g.attributes.position;
  const sx = 0.9 + R() * 0.5;
  const sz = 0.8 + R() * 0.6;
  const sy = tall ? 1.6 + R() * 0.8 : 0.55 + R() * 0.35;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = vnoise(x * 1.7 + seed, y * 1.7 + z * 0.7, seed) * 0.5 + vnoise(x * 4.1, y * 4.1 + seed, z * 4.1) * 0.22 + vnoise(x * 9, y * 9, z * 9 + seed) * 0.06;
    const k = 0.72 + n * 0.75;
    // Quantise the surface into rough facets with strata.
    const strata = Math.floor((y + 1) * 3.5) / 3.5;
    p.setXYZ(i, x * k * sx, (strata * 0.5 + y * 0.5) * k * sy, z * k * sz);
  }
  g.deleteAttribute('uv');
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  // flatten bottom
  const q = ng.attributes.position;
  let minY = 1e9;
  let maxY = -1e9;
  let maxXZ = 0;
  for (let i = 0; i < q.count; i++) {
    minY = Math.min(minY, q.getY(i));
    maxY = Math.max(maxY, q.getY(i));
    maxXZ = Math.max(maxXZ, Math.abs(q.getX(i)), Math.abs(q.getZ(i)));
  }
  const rock = newArr();
  const nrm = ng.attributes.normal;
  for (let i = 0; i < q.count; i++) {
    rock.pos.push(q.getX(i), Math.max(q.getY(i), minY + (maxY - minY) * 0.18) - minY - (maxY - minY) * 0.18, q.getZ(i));
    rock.nor.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    rock.uv.push(0, 0);
    const sh = 0.78 + vnoise(q.getX(i) * 5, q.getY(i) * 5, q.getZ(i) * 5) * 0.4;
    rock.col.push(sh, sh, sh);
    rock.wind.push(0);
    rock.idx.push(i);
  }
  const hgt = maxY - minY;
  return { kind: tall ? 'rockTall' : 'rock', h: hgt * 0.82, w: maxXZ * 2, rock, collide: 0.8 };
}

function cactusProto(seed: number, hi: boolean, short: boolean): Proto {
  const R = rng(seed + 400);
  const H = short ? 1.1 + R() * 0.6 : 4 + R() * 2.2;
  const cactus = newArr();
  const seg = hi ? 12 : 6;
  const col: [number, number, number] = [0.2, 0.42, 0.14];
  const main: THREE.Vector3[] = [];
  const n = hi ? 9 : 4;
  for (let i = 0; i <= n; i++) main.push(V(0, (i / n) * H, 0));
  pushTube(cactus, main, 0.3, 0.2, seg, col, 0, H);
  const arms = short ? 0 : 1 + Math.floor(R() * 2.4);
  for (let a = 0; a < arms; a++) {
    const y = H * (0.35 + R() * 0.3);
    const dir = R() * 6.28;
    const out = 0.8 + R() * 0.5;
    const up = H * (0.18 + R() * 0.15);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= (hi ? 7 : 4); i++) {
      const t = i / (hi ? 7 : 4);
      const e = Math.min(1, t * 2.2);
      pts.push(V(Math.cos(dir) * out * e, y + Math.max(0, t - 0.4) * up * 1.6, Math.sin(dir) * out * e));
    }
    pushTube(cactus, pts, 0.17, 0.13, seg, col, 0, H);
  }
  return { kind: short ? 'cactusShort' : 'cactus', h: H, w: 1.4, cactus, collide: 0.35 };
}

function bushProto(seed: number, hi: boolean, fern: boolean): Proto {
  const R = rng(seed + 500);
  const foliage = newArr();
  const cards = hi ? 8 : 4;
  for (let i = 0; i < cards; i++) {
    const a = (i / cards) * Math.PI * 2 + R();
    const s = 0.9 + R() * 0.6;
    const d = V(Math.cos(a), 0, Math.sin(a));
    const side = V(-d.z, 0, d.x);
    const lean = fern ? 0.5 : 0.2;
    const p = [V(0, 0, 0).addScaledVector(side, -0.2), V(0, 0, 0).addScaledVector(side, 0.2), V(0, s * 0.85, 0).addScaledVector(d, s * lean * 2).addScaledVector(side, 0.55 * s), V(0, s * 0.85, 0).addScaledVector(d, s * lean * 2).addScaledVector(side, -0.55 * s)];
    pushQuad(foliage, p, V(0, 1, 0), [[0.51, 0.52], [0.99, 0.52], [0.99, 0.98], [0.51, 0.98]] as [number, number][], [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 1], [1, 1, 1]], [0, 0, 1, 1]);
  }
  return { kind: fern ? 'fern' : 'bush', h: 1, w: 1.8, foliage, collide: 0 };
}

function stumpProto(seed: number, log: boolean): Proto {
  const bark = newArr();
  if (log) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 4; i++) pts.push(V((i / 4 - 0.5) * 4.2, 0.32, 0));
    pushTube(bark, pts, 0.34, 0.3, 9, [0.8, 0.75, 0.7], 0, 1);
    return { kind: 'log', h: 0.7, w: 4.2, bark, collide: 0 };
  }
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 3; i++) pts.push(V(0, (i / 3) * 0.9, 0));
  pushTube(bark, pts, 0.42, 0.34, 9, [0.8, 0.75, 0.7], 0, 1);
  return { kind: 'stump', h: 0.9, w: 0.8, bark, collide: 0.45 };
}

const cache = new Map<string, Proto>();
export function getProto(kind: PlantKind, variant: number, hi: boolean): Proto {
  const k = `${kind}:${variant}:${hi}`;
  let p = cache.get(k);
  if (!p) {
    const seed = variant * 17 + 3;
    p =
      kind === 'pine' ? pineProto(seed, hi, false)
      : kind === 'deadpine' ? pineProto(seed, hi, true)
      : kind === 'oak' ? broadProto(seed, hi, false)
      : kind === 'birch' ? broadProto(seed, hi, true)
      : kind === 'palm' ? palmProto(seed, hi)
      : kind === 'rock' ? rockProto(seed, hi, false)
      : kind === 'rockTall' ? rockProto(seed, hi, true)
      : kind === 'cactus' ? cactusProto(seed, hi, false)
      : kind === 'cactusShort' ? cactusProto(seed, hi, true)
      : kind === 'bush' ? bushProto(seed, hi, false)
      : kind === 'fern' ? bushProto(seed, hi, true)
      : kind === 'log' ? stumpProto(seed, true)
      : stumpProto(seed, false);
    cache.set(k, p);
  }
  return p;
}
export const clearProtoCache = () => cache.clear();

/** Crossed grass tuft (instanced). */
export function grassTuftGeometry() {
  const a = newArr();
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI;
    const d = V(Math.cos(ang), 0, Math.sin(ang)).multiplyScalar(0.55);
    const p = [V(-d.x, 0, -d.z), V(d.x, 0, d.z), V(d.x, 0.9, d.z), V(-d.x, 0.9, -d.z)];
    pushQuad(a, p, V(0, 1, 0), [[0.51, 0.02], [0.99, 0.02], [0.99, 0.48], [0.51, 0.48]] as [number, number][], [[0.7, 0.7, 0.7], [0.7, 0.7, 0.7], [1, 1, 1], [1, 1, 1]], [0, 0, 1, 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(a.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(a.col, 3));
  g.setAttribute('aWind', new THREE.Float32BufferAttribute(a.wind, 1));
  g.setIndex(a.idx);
  return g;
}
