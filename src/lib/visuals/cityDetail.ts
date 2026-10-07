/**
 * Satoshi City dressing: the things that make a street feel lived in and a night feel wet.
 *  - street furniture (bins, hydrants, benches, bus shelters with lit posters), merged per material
 *  - rooftop billboards that show the live mainnet ticker (a small canvas, redrawn only on change)
 *  - lamp light pools + glow sprites, wet puddles, a star field and a moon for the night
 * Everything static is merged into a handful of draw calls; nothing allocates per frame.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CURB_H, HALF_ROAD, N, nodeCoord, rng, type Block } from '@/lib/city/layout';
import type { CityQuality } from './cityQuality';

export type TickerLine = { text: string; color: string };

const glowTexture = (inner: string, outer: string, size = 128) => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

const POSTERS: [string, string, string][] = [
  ['HODL', '#ff2d6f', 'every sat counts'],
  ['BLAST IT', '#28e7ff', 'tokenblaster.lol'],
  ['MINE SATS', '#ffd23f', 'proof of indexing'],
  ['PLAY ARCADE', '#9b5cff', 'pay per hop'],
];

export function buildCityDetail(scene: THREE.Scene, blocks: Block[], quality: CityQuality) {
  const r = rng(77);
  const disposables: { dispose(): void }[] = [];
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const m4 = new THREE.Matrix4();
  const qn = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rotY = 0, sx = 1, sy = 1, sz = 1) => {
    qn.setFromAxisAngle(up, rotY);
    m4.compose(new THREE.Vector3(x, y, z), qn, new THREE.Vector3(sx, sy, sz));
    const g = geo.clone().applyMatrix4(m4);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat)!.push(g);
  };
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  disposables.push(unit, cyl);

  // ── Materials ──
  const binMat = new THREE.MeshStandardMaterial({ color: '#2f4a3a', roughness: 0.5, metalness: 0.5 });
  const hydrantMat = new THREE.MeshStandardMaterial({ color: '#c42a1e', roughness: 0.45, metalness: 0.4 });
  const woodMat = new THREE.MeshStandardMaterial({ color: '#6b4a2e', roughness: 0.75 });
  const steelMat = new THREE.MeshStandardMaterial({ color: '#8c9097', roughness: 0.35, metalness: 0.9 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: '#9fc4d8', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.28, clearcoat: 1, envMapIntensity: 1.4, depthWrite: false });
  const posterTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const x = c.getContext('2d')!;
    POSTERS.forEach(([title, col, sub], k) => {
      const ox = (k % 2) * 256;
      const oy = Math.floor(k / 2) * 256;
      x.fillStyle = '#07080b';
      x.fillRect(ox, oy, 256, 256);
      x.strokeStyle = col;
      x.lineWidth = 6;
      x.strokeRect(ox + 8, oy + 8, 240, 240);
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.font = 'bold 54px "Arial Black", Impact, sans-serif';
      x.shadowColor = col;
      x.shadowBlur = 14;
      x.fillStyle = '#fff';
      x.fillText(title, ox + 128, oy + 108, 220);
      x.shadowBlur = 0;
      x.font = '20px monospace';
      x.fillStyle = col;
      x.fillText(sub, ox + 128, oy + 170, 220);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  })();
  const posterMat = new THREE.MeshStandardMaterial({ map: posterTex, emissive: '#ffffff', emissiveMap: posterTex, emissiveIntensity: 0.25, roughness: 0.4 });

  // ── Street furniture along every city sidewalk ──
  const posterGeo = (k: number) => {
    const g = new THREE.PlaneGeometry(1.7, 1.15);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const ox = (k % 2) * 0.5;
    const oy = k < 2 ? 0.5 : 0;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, ox + uv.getX(i) * 0.5, oy + uv.getY(i) * 0.5);
    return g;
  };
  for (const b of blocks) {
    if (b.type !== 'city') continue;
    const sides: [number, number, number, number, number][] = [
      [b.x0, b.z0 + 0.6, b.x1, b.z0 + 0.6, Math.PI],
      [b.x0, b.z1 - 0.6, b.x1, b.z1 - 0.6, 0],
      [b.x0 + 0.6, b.z0, b.x0 + 0.6, b.z1, -Math.PI / 2],
      [b.x1 - 0.6, b.z0, b.x1 - 0.6, b.z1, Math.PI / 2],
    ];
    for (const [ax, az, bx, bz, ang] of sides) {
      const len = Math.hypot(bx - ax, bz - az);
      const nx = Math.sin(ang);
      const nz = Math.cos(ang);
      const tx = (bx - ax) / len;
      const tz = (bz - az) / len;
      for (let s = 12.5; s < len - 8; s += 18) {
        const roll = r();
        const x = ax + tx * s - nx * 0.9;
        const z = az + tz * s - nz * 0.9;
        const y = CURB_H;
        if (roll < 0.28) {
          put(cyl, binMat, x, y + 0.45, z, 0, 0.55, 0.9, 0.55);
          put(cyl, steelMat, x, y + 0.93, z, 0, 0.6, 0.06, 0.6);
        } else if (roll < 0.45) {
          put(cyl, hydrantMat, x, y + 0.4, z, 0, 0.3, 0.8, 0.3);
          put(cyl, hydrantMat, x, y + 0.82, z, 0, 0.36, 0.1, 0.36);
          put(unit, hydrantMat, x, y + 0.5, z, ang, 0.7, 0.1, 0.1);
        } else if (roll < 0.7) {
          // Bench facing the street.
          put(unit, woodMat, x, y + 0.45, z, ang, 1.8, 0.06, 0.45);
          put(unit, woodMat, x - nx * 0.2, y + 0.8, z - nz * 0.2, ang, 1.8, 0.4, 0.05);
          for (const o of [-0.75, 0.75]) put(unit, steelMat, x + tx * o, y + 0.22, z + tz * o, ang, 0.06, 0.45, 0.4);
        } else if (roll < 0.86) {
          // Bus shelter: roof, posts, glass back and a lit poster.
          const k = Math.floor(r() * 4);
          put(unit, steelMat, x, y + 2.5, z, ang, 3.2, 0.08, 1.4);
          for (const o of [-1.5, 1.5]) put(unit, steelMat, x + tx * o, y + 1.25, z + tz * o, ang, 0.07, 2.5, 0.07);
          put(unit, glassMat, x - nx * 0.6, y + 1.25, z - nz * 0.6, ang, 3.0, 2.3, 0.03);
          put(posterGeo(k), posterMat, x + tx * 2.2 + nx * 0.0, y + 1.15, z + tz * 2.2, ang);
          put(unit, steelMat, x + tx * 2.2 - nx * 0.04, y + 1.15, z + tz * 2.2 - nz * 0.04, ang, 1.8, 1.25, 0.05);
        } else {
          // Bollard pair.
          for (const o of [-0.6, 0.6]) put(cyl, steelMat, x + tx * o + nx * 0.9, y + 0.4, z + tz * o + nz * 0.9, 0, 0.16, 0.8, 0.16);
        }
      }
    }
  }
  for (const [mat, geos] of buckets) {
    const g = mergeGeometries(geos);
    for (const x of geos) x.dispose();
    if (!g) continue;
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.castShadow = mat !== glassMat && mat !== posterMat;
    if (mat === glassMat) m.renderOrder = 2;
    scene.add(m);
  }
  buckets.clear();

  // ── Lamp pools (on the road) and glow sprites (at the lamp heads) ──
  const lampPts: [number, number][] = [];
  const poolPts: [number, number][] = [];
  for (const b of blocks) {
    const sides: [number, number, number, number, number][] = [
      [b.x0, b.z0 + 0.6, b.x1, b.z0 + 0.6, Math.PI],
      [b.x0, b.z1 - 0.6, b.x1, b.z1 - 0.6, 0],
      [b.x0 + 0.6, b.z0, b.x0 + 0.6, b.z1, -Math.PI / 2],
      [b.x1 - 0.6, b.z0, b.x1 - 0.6, b.z1, Math.PI / 2],
    ];
    for (const [ax, az, bx, bz, ang] of sides) {
      const len = Math.hypot(bx - ax, bz - az);
      const nx = Math.sin(ang);
      const nz = Math.cos(ang);
      for (let s = 8; s < len - 6; s += 18) {
        const x = ax + ((bx - ax) * s) / len;
        const z = az + ((bz - az) * s) / len;
        lampPts.push([x + nx * 1.5, z + nz * 1.5]);
        poolPts.push([x + nx * 3.4, z + nz * 3.4]);
      }
    }
  }
  const poolTex = glowTexture('rgba(255,214,150,0.95)', 'rgba(255,170,80,0.38)');
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, poolPts.length);
  const tmp = new THREE.Object3D();
  poolPts.forEach(([x, z], k) => {
    tmp.position.set(x, 0.028, z);
    tmp.scale.setScalar(13);
    tmp.updateMatrix();
    pools.setMatrixAt(k, tmp.matrix);
  });
  pools.frustumCulled = false;
  pools.visible = false;
  pools.renderOrder = 1;
  scene.add(pools);

  const glowPos = new Float32Array(lampPts.length * 3);
  lampPts.forEach(([x, z], k) => glowPos.set([x, CURB_H + 6.25, z], k * 3));
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
  const glowMat = new THREE.PointsMaterial({ map: glowTexture('rgba(255,236,200,1)', 'rgba(255,180,90,0.35)'), size: 4.2, sizeAttenuation: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Points(glowGeo, glowMat);
  glow.frustumCulled = false;
  glow.visible = false;
  scene.add(glow);

  // ── Wet puddles: dark, near-mirror patches that sparkle once it is night ──
  const puddleGeos: THREE.BufferGeometry[] = [];
  const roadSpan = nodeCoord(N - 1);
  for (let k = 0; k < 70; k++) {
    const line = Math.floor(r() * N);
    const along = (r() * 2 - 1) * roadSpan;
    const lateral = (r() * 2 - 1) * (HALF_ROAD - 0.8);
    const alongX = r() < 0.5;
    const s = 0.9 + r() * 1.8;
    const g = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
    g.scale(s * (1 + r() * 0.8), 1, s);
    g.rotateY(r() * 3);
    g.translate(alongX ? along : nodeCoord(line) + lateral, 0.02, alongX ? nodeCoord(line) + lateral : along);
    puddleGeos.push(g);
  }
  const puddleMat = new THREE.MeshStandardMaterial({ color: '#05070a', roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0, envMapIntensity: 2.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const puddles = new THREE.Mesh(mergeGeometries(puddleGeos), puddleMat);
  for (const g of puddleGeos) g.dispose();
  puddles.visible = false;
  scene.add(puddles);

  // ── Rooftop billboards with the live ticker ──
  const BW = 1024;
  const BH = 256;
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = BW;
  boardCanvas.height = BH;
  const bctx = boardCanvas.getContext('2d')!;
  const boardTex = new THREE.CanvasTexture(boardCanvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  boardTex.anisotropy = 4;
  let lastSig = '';
  const drawBoard = (lines: TickerLine[]) => {
    bctx.fillStyle = '#06080c';
    bctx.fillRect(0, 0, BW, BH);
    bctx.fillStyle = '#ffd23f';
    bctx.fillRect(0, 0, BW, 46);
    bctx.fillStyle = '#000';
    bctx.font = 'bold 32px "Arial Black", Impact, sans-serif';
    bctx.textBaseline = 'middle';
    bctx.fillText('BSV MAINNET · LIVE', 18, 25);
    bctx.textAlign = 'right';
    bctx.fillText('SATOSHI CITY', BW - 18, 25);
    bctx.textAlign = 'left';
    bctx.font = 'bold 36px "SFMono-Regular", Menlo, Consolas, monospace';
    const rows = lines.length ? lines : [{ text: 'waiting for the next block…', color: '#8aa' }];
    rows.slice(0, 4).forEach((l, i) => {
      bctx.fillStyle = l.color;
      bctx.fillRect(18, 68 + i * 46, 14, 30);
      bctx.fillStyle = '#e8eef5';
      bctx.fillText(l.text, 46, 84 + i * 46, BW - 70);
    });
    boardTex.needsUpdate = true;
  };
  drawBoard([]);
  const boardMat = new THREE.MeshStandardMaterial({ map: boardTex, emissive: '#ffffff', emissiveMap: boardTex, emissiveIntensity: 0.55, roughness: 0.5 });
  const frameMat = new THREE.MeshStandardMaterial({ color: '#15171b', roughness: 0.6, metalness: 0.6 });
  const boardGeos: THREE.BufferGeometry[] = [];
  const frameGeos: THREE.BufferGeometry[] = [];
  let boards = 0;
  const maxBoards = quality === 'high' ? 6 : 3;
  const bm = new THREE.Matrix4();
  const bq = new THREE.Quaternion();
  for (const b of blocks)
    for (const l of b.lots) {
      if (boards >= maxBoards || l.h < 42 || r() > 0.35) continue;
      const w = l.x1 - l.x0;
      const d = l.z1 - l.z0;
      const cx = (l.x0 + l.x1) / 2;
      const cz = (l.z0 + l.z1) / 2;
      const faces: [number, number, number, number][] = [
        [l.x1, cz, Math.PI / 2, d],
        [l.x0, cz, -Math.PI / 2, d],
        [cx, l.z1, 0, w],
        [cx, l.z0, Math.PI, w],
      ];
      const [fx, fz, ry, len] = faces[Math.floor(r() * 4)];
      const bw = Math.min(len - 2, 15);
      if (bw < 8) continue;
      const bh = bw / 4;
      const top = CURB_H + l.h;
      const nx = Math.sin(ry);
      const nz = Math.cos(ry);
      const px = fx - nx * 1.4;
      const pz = fz - nz * 1.4;
      bq.setFromAxisAngle(up, ry);
      const place = (g: THREE.BufferGeometry, ox: number, oy: number, oz: number) => {
        // local (ox, oz) are across / out-of-face offsets
        const tx = Math.cos(ry);
        const tz = -Math.sin(ry);
        bm.compose(new THREE.Vector3(px + tx * ox + nx * oz, top + oy, pz + tz * ox + nz * oz), bq, new THREE.Vector3(1, 1, 1));
        return g.applyMatrix4(bm);
      };
      boardGeos.push(place(new THREE.PlaneGeometry(bw, bh), 0, 2.4 + bh / 2, 0.16));
      frameGeos.push(place(new THREE.BoxGeometry(bw + 0.5, bh + 0.5, 0.3), 0, 2.4 + bh / 2, 0));
      for (const ox of [-bw * 0.35, bw * 0.35]) frameGeos.push(place(new THREE.BoxGeometry(0.4, 2.8, 0.4), ox, 1.4, 0));
      boards++;
    }
  if (boardGeos.length) {
    const bmesh = new THREE.Mesh(mergeGeometries(boardGeos), boardMat);
    const fmesh = new THREE.Mesh(mergeGeometries(frameGeos), frameMat);
    for (const g of [...boardGeos, ...frameGeos]) g.dispose();
    scene.add(bmesh, fmesh);
  }

  // ── Night sky: stars and a moon, glued to the camera ──
  const STARS = 700;
  const starPos = new Float32Array(STARS * 3);
  const sr = rng(5);
  for (let i = 0; i < STARS; i++) {
    const th = sr() * Math.PI * 2;
    const y = 0.04 + sr() * 0.96;
    const rad = Math.sqrt(1 - y * y);
    starPos.set([Math.cos(th) * rad * 900, y * 900, Math.sin(th) * rad * 900], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: '#dfe8ff', size: 2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.visible = false;
  stars.renderOrder = -1;
  scene.add(stars);
  const moonMat = new THREE.SpriteMaterial({ map: glowTexture('rgba(255,255,255,1)', 'rgba(210,225,255,0.55)', 256), transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false });
  const moon = new THREE.Sprite(moonMat);
  moon.scale.setScalar(110);
  moon.visible = false;
  scene.add(moon);

  let q = quality;
  const setQuality = (nq: CityQuality) => {
    q = nq;
  };
  const setNight = (night: number) => {
    const hi = q === 'high';
    const dark = night > 0.02;
    pools.visible = false; // coloured pools + wet streaks now come from createStreetLight (city/art.ts)
    poolMat.opacity = 0;
    glow.visible = dark && hi;
    glowMat.opacity = night * 0.9;
    puddles.visible = hi && night > 0.35;
    puddleMat.opacity = Math.min(0.85, (night - 0.35) * 1.6);
    const stl = night > 0.55;
    stars.visible = stl;
    moon.visible = stl;
    starMat.opacity = Math.min(1, (night - 0.55) * 2.2);
    moonMat.opacity = Math.min(0.95, (night - 0.55) * 2.2);
    posterMat.emissiveIntensity = 0.25 + night * 1.5;
    boardMat.emissiveIntensity = 0.55 + night * 1.2;
  };
  const update = (cam: THREE.Vector3) => {
    if (stars.visible) {
      stars.position.copy(cam);
      moon.position.set(cam.x - 380, cam.y + 330, cam.z - 520);
    }
  };
  /** Redraw the billboard only when the lines changed. */
  const setTicker = (lines: TickerLine[]) => {
    const sig = lines.map((l) => l.text).join('|');
    if (sig === lastSig) return;
    lastSig = sig;
    drawBoard(lines);
  };
  const dispose = () => {
    for (const d of disposables) d.dispose();
    poolTex.dispose();
    boardTex.dispose();
    posterTex.dispose();
  };
  return { setNight, setQuality, setTicker, update, dispose };
}
