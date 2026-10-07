/**
 * Satoshi City: builds the static world (roads and markings, kerbed blocks, towers with lit
 * windows, storefronts, neon, street lamps, trees, traffic lights, the square, the car park, the
 * harbour and a far skyline). Static meshes sharing a material are merged into one draw call.
 * Textures: Poly Haven CC0 asphalt and concrete (public/arcade/frogger/tex).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOUND, CURB_H, EDGE, HALF_ROAD, INT, N, SIDEWALK, lightState, makeEdges, nodeCoord, nodeXZ, rng, squareCentre, type Block, type Edge } from './layout';

const TEX = '/arcade/frogger/tex';
const NEON = ['BSV', 'MEMPOOL', '24/7', 'HOTEL', 'TOKENS', 'LIQUOR', 'BLOCK 21', "SATOSHI'S", 'PAWN', 'NOODLES', 'CASH', 'SATS', 'UTXO BAR', 'MINER', 'NODE', 'HASH'];
const NEON_COLS = ['#ff2d6f', '#28e7ff', '#ffd23f', '#9b5cff', '#3bff8a', '#ff7a1a'];

function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function buildWorld(scene: THREE.Scene, blocks: Block[]) {
  const texLoader = new THREE.TextureLoader();
  const pbr = (name: string, rx: number, ry: number) => {
    const load = (suffix: string, srgb: boolean) => {
      const t = texLoader.load(`${TEX}/${name}_${suffix}.webp`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(rx, ry);
      t.anisotropy = 8;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    return { map: load('diff', true), normalMap: load('nor_gl', false), roughnessMap: load('rough', false) };
  };

  // ── Merge buckets: every static piece goes in its material's bucket, merged at the end ──
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const castsShadow = new Set<THREE.Material>();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rotY = 0, sx = 1, sy = 1, sz = 1) => {
    q.setFromAxisAngle(up, rotY);
    m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
    const g = geo.clone().applyMatrix4(m4);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat)!.push(g);
  };
  const scaleUV = (g: THREE.BufferGeometry, su: number, sv: number) => {
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
    return g;
  };

  // ── Ground: asphalt island, water round it, kerbed blocks, the promenade ──
  const span = BOUND * 2;
  const asphalt = new THREE.MeshStandardMaterial({ ...pbr('asphalt_02', span / 7, span / 7), color: '#8a8a8e', roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.8, 0.8) });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(span, span), asphalt);
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  scene.add(road);
  // Sea: glossy physical water with two scrolling procedural wave normal maps (tileable sum of sines).
  const waveTex = (() => {
    const S = 256;
    const data = new Uint8Array(S * S * 4);
    const hgt = (x: number, y: number) => {
      const u = (x / S) * Math.PI * 2;
      const v = (y / S) * Math.PI * 2;
      return Math.sin(u * 3 + v * 2) * 0.5 + Math.sin(u * 7 - v * 5) * 0.25 + Math.sin(u * 13 + v * 11) * 0.12 + Math.sin(-u * 2 + v * 9) * 0.3;
    };
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = hgt(x + 1, y) - hgt(x - 1, y);
        const dy = hgt(x, y + 1) - hgt(x, y - 1);
        const n = new THREE.Vector3(-dx * 2.2, -dy * 2.2, 1).normalize();
        const o = (y * S + x) * 4;
        data[o] = (n.x * 0.5 + 0.5) * 255;
        data[o + 1] = (n.y * 0.5 + 0.5) * 255;
        data[o + 2] = (n.z * 0.5 + 0.5) * 255;
        data[o + 3] = 255;
      }
    const t = new THREE.DataTexture(data, S, S);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(60, 60);
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  })();
  const waterMat = new THREE.MeshPhysicalMaterial({ color: '#06202c', metalness: 0.1, roughness: 0.06, envMapIntensity: 1.3, normalMap: waveTex, normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 1, clearcoatRoughness: 0.08, clearcoatNormalMap: waveTex.clone(), clearcoatNormalScale: new THREE.Vector2(0.25, 0.25) });
  waterMat.clearcoatNormalMap!.repeat.set(23, 23);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.6;
  scene.add(water);
  const concrete = new THREE.MeshStandardMaterial({ ...pbr('concrete_pavement', 1, 1), color: '#b8b3ad', roughness: 1 });
  const grassMat = new THREE.MeshStandardMaterial({ color: '#35612e', roughness: 1 });
  const curbMat = new THREE.MeshStandardMaterial({ color: '#8a8780', roughness: 0.9 });
  const parkTop = new THREE.MeshStandardMaterial({ ...pbr('asphalt_02', 8, 8), color: '#6d6d70', roughness: 0.95 });
  const box = (w: number, h: number, d: number, uvTile = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    return uvTile ? scaleUV(g, w / uvTile, d / uvTile) : g;
  };
  for (const b of blocks) {
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    if (b.type === 'parking') {
      put(box(w, CURB_H, d), curbMat, cx, CURB_H / 2 - 0.001, cz);
      put(box(w - SIDEWALK * 2, 0.02, d - SIDEWALK * 2, 0), parkTop, cx, CURB_H + 0.005, cz);
      // concrete ring round it
      for (const [ox, oz, ww, dd] of [
        [0, -(d - SIDEWALK) / 2, w, SIDEWALK],
        [0, (d - SIDEWALK) / 2, w, SIDEWALK],
        [-(w - SIDEWALK) / 2, 0, SIDEWALK, d - SIDEWALK * 2],
        [(w - SIDEWALK) / 2, 0, SIDEWALK, d - SIDEWALK * 2],
      ])
        put(box(ww, 0.02, dd, 3), concrete, cx + ox, CURB_H + 0.006, cz + oz);
    } else put(box(w, CURB_H, d, 3), concrete, cx, CURB_H / 2, cz);
  }
  // Promenade between the ring road and the harbour wall.
  const PW = BOUND - EDGE;
  for (const [x, z, w, d] of [
    [0, -(EDGE + PW / 2), span, PW],
    [0, EDGE + PW / 2, span, PW],
    [-(EDGE + PW / 2), 0, PW, EDGE * 2],
    [EDGE + PW / 2, 0, PW, EDGE * 2],
  ])
    put(box(w, CURB_H, d, 3), concrete, x, CURB_H / 2, z);
  // Harbour wall: a low concrete parapet with railings, the island's edge.
  const wallMat = new THREE.MeshStandardMaterial({ color: '#9a958c', roughness: 0.9 });
  castsShadow.add(wallMat);
  for (const [x, z, w, d] of [
    [0, -BOUND - 1, span + 4, 2],
    [0, BOUND + 1, span + 4, 2],
    [-BOUND - 1, 0, 2, span],
    [BOUND + 1, 0, 2, span],
  ]) {
    put(box(w, 1.2, d), wallMat, x, 0.6, z);
    put(box(w, 4, d), wallMat, x, -2, z); // sea wall down to the water
  }

  // ── Road markings: dashed centre lines, stop lines, zebra crossings ──
  const white = new THREE.MeshStandardMaterial({ color: '#d6d3c9', roughness: 0.7 });
  const yellow = new THREE.MeshStandardMaterial({ color: '#e6b800', roughness: 0.6 });
  const flat = (w: number, d: number) => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N - 1; j++) {
      // segment along z at x = c(i), and along x at z = c(i)
      const a = nodeCoord(j) + INT;
      const bEnd = nodeCoord(j + 1) - INT;
      for (let s = a + 1; s < bEnd - 1; s += 6) {
        put(flat(0.18, 3), yellow, nodeCoord(i), 0.012, s + 1.5);
        put(flat(3, 0.18), yellow, s + 1.5, 0.012, nodeCoord(i));
      }
    }
  const edges = makeEdges();
  for (const e of edges) {
    const [bx, bz] = nodeXZ(e.b);
    // Stop line across the incoming (right-hand) half, at the stop distance.
    const sx = bx - e.dx * INT - e.dz * (HALF_ROAD / 2);
    const sz = bz - e.dz * INT + e.dx * (HALF_ROAD / 2);
    put(flat(e.axis === 'x' ? 0.45 : HALF_ROAD, e.axis === 'x' ? HALF_ROAD : 0.45), white, sx, 0.013, sz);
    // Zebra across the whole road, between the box and the stop line (drawn once per arm).
    if (e.a > e.b) continue;
    const [ax0, az0] = nodeXZ(e.a);
    const ends: [number, number, number][] = [
      [ax0, az0, 1],
      [bx, bz, -1],
    ];
    for (const [nx, nz, sign] of ends) {
      const mid = (HALF_ROAD + INT) / 2;
      for (let o = -HALF_ROAD + 0.6; o < HALF_ROAD - 0.3; o += 1.1) {
        const px = nx + e.dx * mid * sign + (e.axis === 'z' ? o : 0);
        const pz = nz + e.dz * mid * sign + (e.axis === 'x' ? o : 0);
        put(flat(e.axis === 'x' ? INT - HALF_ROAD - 0.6 : 0.55, e.axis === 'x' ? 0.55 : INT - HALF_ROAD - 0.6), white, px, 0.014, pz);
      }
    }
  }

  // ── Building materials (glass towers, concrete/brick/stone blocks, lit windows at night) ──
  /** Emissive window map: whole office floors lit or dark, a few lone lights, warm and cool tints. */
  const windowTex = (seed: number) =>
    canvasTex(128, 256, (x) => {
      x.fillStyle = '#000';
      x.fillRect(0, 0, 128, 256);
      const r = rng(seed);
      for (let yy = 4; yy < 256; yy += 10) {
        const floorLit = r() < 0.45;
        const tint = r() < 0.6 ? '#ffd9a0' : r() < 0.5 ? '#d8ecff' : '#ffc07a';
        for (let xx = 4; xx < 128; xx += 9) {
          const on = floorLit ? r() < 0.82 : r() < 0.07;
          x.fillStyle = on ? tint : '#050608';
          x.fillRect(xx, yy, 6, 7);
        }
      }
    });
  const towerMats: THREE.MeshStandardMaterial[] = [];
  ['#5b7a99', '#3d5466', '#7a8fa3', '#2f4a5e', '#8aa0b0', '#4a6070'].forEach((c, i) =>
    towerMats.push(
      new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.85, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6, emissive: '#ffffff', emissiveMap: windowTex(i * 977 + 13), emissiveIntensity: 0 }),
    ),
  );
  // Facades: 8 m x 16 m bays at 64 px/m. Brick (Poly Haven CC0) is composited under the window grid
  // once it loads; the matching normal map gets recessed window reveals so the walls have depth.
  const brickDiff = new Image();
  const brickNor = new Image();
  brickDiff.src = `${TEX}/brick_wall_diff.webp`;
  brickNor.src = `${TEX}/brick_wall_nor_gl.webp`;
  const facades: { paint: () => void }[] = [];
  const makeFacade = (brick: boolean) => {
    const W = 512;
    const H = 1024;
    const dc = document.createElement('canvas');
    const nc = document.createElement('canvas');
    dc.width = nc.width = W;
    dc.height = nc.height = H;
    const map = new THREE.CanvasTexture(dc);
    map.colorSpace = THREE.SRGBColorSpace;
    const normalMap = new THREE.CanvasTexture(nc);
    for (const t of [map, normalMap]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
    }
    const tile = (x: CanvasRenderingContext2D, img: HTMLImageElement, fallback: string) => {
      if (brick && img.complete && img.naturalWidth) for (let ty = 0; ty < H; ty += 92) for (let tx = 0; tx < W; tx += 92) x.drawImage(img, tx, ty, 92, 92);
      else {
        x.fillStyle = fallback;
        x.fillRect(0, 0, W, H);
      }
    };
    const paint = () => {
      const x = dc.getContext('2d')!;
      tile(x, brickDiff, '#e4e0d8');
      const n = nc.getContext('2d')!;
      tile(n, brickNor, '#8080ff');
      x.save();
      n.save();
      x.scale(4, 4);
      n.scale(4, 4);
      for (let yy = 4; yy < 256; yy += 10) {
        // floor slab line + sill shadow
        x.fillStyle = 'rgba(30,26,22,0.35)';
        x.fillRect(0, yy + 7, 128, 2);
        x.fillStyle = 'rgba(255,255,255,0.18)';
        x.fillRect(0, yy + 9, 128, 0.6);
        n.fillStyle = 'rgb(128,150,255)';
        n.fillRect(0, yy + 7, 128, 1.2);
        for (let xx = 4; xx < 128; xx += 9) {
          const g = x.createLinearGradient(xx, yy, xx + 6, yy + 7);
          g.addColorStop(0, '#2a3340');
          g.addColorStop(1, '#14181f');
          x.fillStyle = g;
          x.fillRect(xx, yy, 6, 7);
          x.fillStyle = 'rgba(190,215,240,0.22)';
          x.fillRect(xx, yy, 6, 1.4);
          x.fillStyle = 'rgba(15,12,10,0.5)';
          x.fillRect(xx - 0.5, yy - 0.5, 7, 0.6);
          // reveal: flat pane, lit edges on the recessed frame
          n.fillStyle = '#8080ff';
          n.fillRect(xx, yy, 6, 7);
          n.fillStyle = 'rgb(176,128,240)';
          n.fillRect(xx - 0.5, yy, 0.6, 7);
          n.fillStyle = 'rgb(80,128,240)';
          n.fillRect(xx + 5.9, yy, 0.6, 7);
          n.fillStyle = 'rgb(128,86,240)';
          n.fillRect(xx, yy - 0.5, 6, 0.6);
        }
      }
      x.restore();
      n.restore();
      map.needsUpdate = true;
      normalMap.needsUpdate = true;
    };
    paint();
    facades.push({ paint });
    return { map, normalMap };
  };
  const brickFacade = makeFacade(true);
  const plainFacade = makeFacade(false);
  let loaded = 0;
  const onBrick = () => {
    if (++loaded === 2) for (const f of facades) f.paint();
  };
  brickDiff.onload = brickNor.onload = onBrick;
  // [colour, brick?]: warm tints over brick, original tones over painted render.
  (
    [
      ['#d9cfc6', true],
      ['#f0b090', true],
      ['#b7ad9c', false],
      ['#56575c', false],
      ['#dccfbc', true],
      ['#e6b89c', true],
    ] as [string, boolean][]
  ).forEach(([c, brick], i) => {
    const f = brick ? brickFacade : plainFacade;
    towerMats.push(
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.82, metalness: 0.04, map: f.map, normalMap: f.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), emissive: '#ffffff', emissiveMap: windowTex(i * 541 + 101), emissiveIntensity: 0 }),
    );
  });
  for (const m of towerMats) castsShadow.add(m);
  const shopTex = canvasTex(512, 64, (x) => {
    x.fillStyle = '#16181c';
    x.fillRect(0, 0, 512, 64);
    const awn = ['#9c1c24', '#1d4f8a', '#2c6b3c', '#c47a12', '#5a2a7a'];
    for (let k = 0; k < 8; k++) {
      const x0 = k * 64 + 4;
      x.fillStyle = k % 3 === 0 ? '#ffe2b0' : k % 3 === 1 ? '#cfe8ff' : '#ffd0e0';
      x.fillRect(x0, 22, 56, 38);
      x.fillStyle = 'rgba(0,0,0,0.35)';
      x.fillRect(x0 + 27, 22, 3, 38);
      x.fillStyle = awn[k % awn.length];
      x.fillRect(x0 - 2, 6, 60, 12);
    }
  });
  const shopMat = new THREE.MeshStandardMaterial({ map: shopTex, emissive: '#ffffff', emissiveMap: shopTex, emissiveIntensity: 0.15, roughness: 0.35, metalness: 0.2 });
  const podiumMat = new THREE.MeshStandardMaterial({ color: '#3a3a3e', roughness: 0.6, metalness: 0.3 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#5d5f63', roughness: 0.8, metalness: 0.4 });
  castsShadow.add(podiumMat);
  const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2020').multiplyScalar(3), toneMapped: false });
  const neonMats: THREE.MeshStandardMaterial[] = [];
  const neonSign = (text: string, col: string, font = 84) => {
    const t = canvasTex(512, 128, (x) => {
      x.fillStyle = '#050507';
      x.fillRect(0, 0, 512, 128);
      x.font = `bold ${font}px "Arial Black", Impact, sans-serif`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.shadowColor = col;
      x.shadowBlur = 18;
      x.strokeStyle = col;
      x.lineWidth = 6;
      x.strokeText(text, 256, 68, 480);
      x.fillStyle = '#ffffff';
      x.fillText(text, 256, 68, 480);
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    const m = new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.3, roughness: 0.5 });
    neonMats.push(m);
    return m;
  };

  /** A box whose window grid repeats with its size; roof and floor sample a blank texel. */
  const buildingGeo = (w: number, h: number, d: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) {
      const face = Math.floor(k / 4);
      if (face === 2 || face === 3) uv.setXY(k, 0.005, 0.002);
      else uv.setXY(k, uv.getX(k) * ((face < 2 ? d : w) / 8), uv.getY(k) * (h / 16));
    }
    return g;
  };
  const tankGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  const tankMat = new THREE.MeshStandardMaterial({ color: '#6b4a32', roughness: 0.85 });
  castsShadow.add(tankMat);
  const beaconGeos: THREE.BufferGeometry[] = [];
  const r = rng(21);
  let neonI = 0;
  const unit = new THREE.BoxGeometry(1, 1, 1);
  for (const b of blocks)
    for (const l of b.lots) {
      const w = l.x1 - l.x0;
      const d = l.z1 - l.z0;
      const cx = (l.x0 + l.x1) / 2;
      const cz = (l.z0 + l.z1) / 2;
      const y0 = CURB_H;
      const faces: [number, number, number, number][] = [
        [l.x1, cz, Math.PI / 2, d],
        [l.x0, cz, -Math.PI / 2, d],
        [cx, l.z1, 0, w],
        [cx, l.z0, Math.PI, w],
      ];
      if (l.kind === 'glass') {
        put(unit, podiumMat, cx, y0 + 2.5, cz, 0, w, 5, d);
        put(buildingGeo(w - 1.2, l.h, d - 1.2), towerMats[l.mat], cx, y0 + l.h / 2, cz);
      } else put(buildingGeo(w, l.h, d), towerMats[6 + l.mat], cx, y0 + l.h / 2, cz);
      for (const [fx, fz, ry, len] of faces) {
        const off = 0.04;
        const g = scaleUV(new THREE.PlaneGeometry(len - 0.4, 3.2), (len - 0.4) / 10, 1);
        put(g, shopMat, fx + Math.sin(ry) * off, y0 + 1.8, fz + Math.cos(ry) * off, ry);
      }
      // Neon over the street on one face.
      if (r() < 0.55) {
        const [fx, fz, ry, len] = faces[Math.floor(r() * 4)];
        const sm = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(len - 1, 7), 1.75), neonSign(NEON[neonI % NEON.length], NEON_COLS[neonI % NEON_COLS.length]));
        sm.position.set(fx + Math.sin(ry) * 0.3, y0 + 5.6 + r() * 2.5, fz + Math.cos(ry) * 0.3);
        sm.rotation.y = ry;
        scene.add(sm);
        neonI++;
      }
      // Rooftop: stepped crown on the tall ones, plant room, AC units, water tanks, masts with beacons.
      const bodyMat = l.kind === 'glass' ? towerMats[l.mat] : towerMats[6 + l.mat];
      const top = y0 + l.h;
      let topY = top;
      if (l.h > 36) {
        const ch = 5 + r() * 9;
        put(buildingGeo(w * 0.62, ch, d * 0.62), bodyMat, cx + (r() - 0.5) * w * 0.2, topY + ch / 2, cz + (r() - 0.5) * d * 0.2);
        topY += ch;
        if (l.h > 70) {
          const ch2 = 4 + r() * 6;
          put(buildingGeo(w * 0.34, ch2, d * 0.34), bodyMat, cx, topY + ch2 / 2, cz);
          topY += ch2;
        }
      }
      put(unit, roofMat, cx + (r() - 0.5) * w * 0.3, top + 1.1, cz + (r() - 0.5) * d * 0.3, 0, w * 0.4, 2.2, d * 0.35);
      for (let k = 0; k < 3; k++) put(unit, roofMat, cx + (r() - 0.5) * (w - 3), top + 0.45, cz + (r() - 0.5) * (d - 3), 0, 1.2, 0.9, 1.2);
      if (l.h <= 36 && r() < 0.45) {
        // Rooftop water tank on legs.
        const tx = cx + (r() - 0.5) * (w - 6);
        const tz = cz + (r() - 0.5) * (d - 6);
        put(tankGeo, tankMat, tx, top + 3.2, tz, 0, 2.6, 2.8, 2.6);
        put(unit, roofMat, tx, top + 1.1, tz, 0, 0.25, 2.2, 0.25);
        put(unit, roofMat, tx + 1, top + 1.1, tz + 1, 0, 0.25, 2.2, 0.25);
        put(unit, roofMat, tx - 1, top + 1.1, tz - 1, 0, 0.25, 2.2, 0.25);
      }
      if (l.h > 60) {
        put(unit, roofMat, cx, topY + 4.5, cz, 0, 0.25, 9, 0.25);
        beaconGeos.push(new THREE.SphereGeometry(0.4, 8, 6).translate(cx, topY + 9.1, cz));
      }
    }
  const beacons = new THREE.Mesh(beaconGeos.length ? mergeGeometries(beaconGeos) : new THREE.BufferGeometry(), beaconMat);
  for (const g of beaconGeos) g.dispose();
  scene.add(beacons);

  // ── Satoshi Square: fountain, lawns, trees, big sign ──
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 1 });
  const leafMats = ['#2f6a2f', '#3b7a35', '#28592b'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }));
  for (const m of [trunkMat, ...leafMats]) castsShadow.add(m);
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 2.4, 7);
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  const tree = (x: number, z: number, y = CURB_H, s = 1) => {
    put(trunkGeo, trunkMat, x, y + 1.2 * s, z, 0, s, s, s);
    for (let k = 0; k < 3; k++) {
      const cs = (0.8 + r() * 0.35) * s;
      put(crownGeo, leafMats[Math.floor(r() * 3)], x + (k - 1) * 0.5 * s, y + (2.9 + (k % 2) * 0.5) * s, z + (k === 1 ? 0.3 : -0.2) * s, r() * 3, cs, cs, cs);
    }
  };
  const [sqx, sqz] = squareCentre();
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#c9c3b8', roughness: 0.7 });
  castsShadow.add(stoneMat);
  put(new THREE.CylinderGeometry(4.2, 4.4, 0.8, 32), stoneMat, sqx, CURB_H + 0.4, sqz);
  const waterTop = new THREE.Mesh(new THREE.CircleGeometry(3.8, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#2a6f8f', metalness: 0.6, roughness: 0.05, emissive: '#0a3a55', emissiveIntensity: 0.4 }));
  waterTop.position.set(sqx, CURB_H + 0.75, sqz);
  scene.add(waterTop);
  put(new THREE.CylinderGeometry(0.5, 0.7, 2.6, 16), stoneMat, sqx, CURB_H + 1.3, sqz);
  // A gold "₿" obelisk on top.
  const goldMat = new THREE.MeshStandardMaterial({ color: '#d4a843', metalness: 1, roughness: 0.25, emissive: '#3a2600', emissiveIntensity: 0.3 });
  castsShadow.add(goldMat);
  put(new THREE.OctahedronGeometry(1.1, 0), goldMat, sqx, CURB_H + 3.6, sqz, 0, 0.8, 1.4, 0.8);
  for (const [ox, oz] of [
    [-16, -16],
    [16, -16],
    [-16, 16],
    [16, 16],
  ]) {
    put(box(14, 0.06, 14), grassMat, sqx + ox, CURB_H + 0.03, sqz + oz);
    tree(sqx + ox, sqz + oz, CURB_H, 1.4);
    tree(sqx + ox + 4, sqz + oz - 3, CURB_H, 1.1);
  }
  {
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(22, 5.5), neonSign('SATOSHI CITY', '#ff2d3c', 92));
    sm.position.set(sqx, 13, sqz - 22);
    scene.add(sm);
    const back = sm.clone();
    back.rotation.y = Math.PI;
    back.position.z = sqz - 22.05;
    scene.add(back);
    for (const sx of [-10.5, 10.5]) put(unit, roofMat, sqx + sx, CURB_H + 7.8, sqz - 22, 0, 0.35, 15.6, 0.35);
  }
  // Car park bays.
  {
    const b = blocks.find((bb) => bb.type === 'parking')!;
    for (let x = b.x0 + SIDEWALK + 3; x < b.x1 - SIDEWALK - 2; x += 3.2)
      for (const z of [b.z0 + SIDEWALK + 6, b.z0 + SIDEWALK + 20, b.z1 - SIDEWALK - 20, b.z1 - SIDEWALK - 6]) put(flat(0.12, 5), white, x, CURB_H + 0.02, z);
  }

  // ── Street lamps and trees along every sidewalk ──
  const poleMat = new THREE.MeshStandardMaterial({ color: '#2b2e33', metalness: 0.7, roughness: 0.4 });
  const headMat = new THREE.MeshStandardMaterial({ color: '#fff3d0', emissive: '#ffcf80', emissiveIntensity: 0 });
  castsShadow.add(poleMat);
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 6.5, 8);
  for (const b of blocks) {
    const sides: [number, number, number, number, number][] = [
      // x0,z0 → x1,z1 along the kerb, outward normal (nx,nz) packed as angle
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
        put(poleGeo, poleMat, x, CURB_H + 3.25, z);
        put(unit, poleMat, x + nx * 0.8, CURB_H + 6.4, z + nz * 0.8, ang, 0.12, 0.12, 1.6);
        put(unit, headMat, x + nx * 1.5, CURB_H + 6.3, z + nz * 1.5, ang, 0.5, 0.15, 0.8);
        if (b.type === 'city' && r() < 0.7) tree(x + ((bx - ax) * 9) / len - nx * 0.4, z + ((bz - az) * 9) / len - nz * 0.4);
      }
    }
  }

  // ── Traffic lights: a pole per approach, lamps instanced and recoloured by phase ──
  const lightGeo = new THREE.SphereGeometry(0.17, 10, 8);
  const lampMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const lamps = new THREE.InstancedMesh(lightGeo, lampMat, edges.length * 3);
  const housing = new THREE.MeshStandardMaterial({ color: '#1b1d20', roughness: 0.6, metalness: 0.4 });
  castsShadow.add(housing);
  const tmp = new THREE.Object3D();
  edges.forEach((e, k) => {
    const [bx, bz] = nodeXZ(e.b);
    const x = bx - e.dx * (INT + 0.4) - e.dz * (HALF_ROAD + 0.7);
    const z = bz - e.dz * (INT + 0.4) + e.dx * (HALF_ROAD + 0.7);
    const facing = Math.atan2(-e.dx, -e.dz); // towards the oncoming cars
    put(new THREE.CylinderGeometry(0.1, 0.12, 4.4, 8), housing, x, CURB_H + 2.2, z);
    put(unit, housing, x, CURB_H + 4.55, z, facing, 0.45, 1.35, 0.4);
    for (let c = 0; c < 3; c++) {
      tmp.position.set(x - e.dx * 0.22, CURB_H + 5.0 - c * 0.42, z - e.dz * 0.22);
      tmp.updateMatrix();
      lamps.setMatrixAt(k * 3 + c, tmp.matrix);
      lamps.setColorAt(k * 3 + c, new THREE.Color('#111'));
    }
  });
  scene.add(lamps);
  const LIT = [new THREE.Color('#ff2a1a').multiplyScalar(3), new THREE.Color('#ffb000').multiplyScalar(3), new THREE.Color('#30ff70').multiplyScalar(3)];
  const DARK = [new THREE.Color('#2a0806'), new THREE.Color('#2a1d00'), new THREE.Color('#06200c')];
  let lastLightT = -1;
  const updateLights = (t: number) => {
    if (Math.abs(t - lastLightT) < 0.25) return;
    lastLightT = t;
    edges.forEach((e: Edge, k) => {
      const st = lightState(e.b, e.axis, t);
      const on = st === 'r' ? 0 : st === 'a' ? 1 : 2;
      for (let c = 0; c < 3; c++) lamps.setColorAt(k * 3 + c, c === on ? LIT[c] : DARK[c]);
    });
    lamps.instanceColor!.needsUpdate = true;
  };

  // ── Far skyline across the water ──
  const skyMat = new THREE.MeshStandardMaterial({ color: '#4a5560', roughness: 0.9, map: plainFacade.map, emissive: '#ffffff', emissiveMap: windowTex(4242), emissiveIntensity: 0 });
  for (let k = 0; k < 90; k++) {
    const a = (k / 90) * Math.PI * 2 + r() * 0.05;
    const dist = 330 + r() * 120;
    const w = 14 + r() * 26;
    const h = 30 + r() * 140;
    const g = buildingGeo(w, h, w);
    put(g, skyMat, Math.cos(a) * dist, h / 2 - 1.6, Math.sin(a) * dist, -a);
  }

  // ── Merge every bucket into one mesh per material ──
  const merged: THREE.Mesh[] = [];
  for (const [mat, geos] of buckets) {
    const g = mergeGeometries(geos);
    for (const x of geos) x.dispose();
    if (!g) continue;
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = castsShadow.has(mat);
    scene.add(mesh);
    merged.push(mesh);
  }
  unit.dispose();
  tankGeo.dispose();
  trunkGeo.dispose();
  crownGeo.dispose();
  poleGeo.dispose();

  /** Day/night: windows, neon, shops and lamps light up; the road gets wet. */
  const setNight = (night: number, now: number, t: number) => {
    asphalt.roughness = 1 - night * 0.62;
    asphalt.envMapIntensity = 0.9 - night * 0.45;
    asphalt.color.setScalar(0.3 - night * 0.12);
    for (const m of neonMats) m.emissiveIntensity = 0.3 + night * 1.3;
    shopMat.emissiveIntensity = 0.2 + night * 0.45;
    for (const m of towerMats) {
      m.emissiveIntensity = night * 0.55;
      m.envMapIntensity = 0.15 + 1.45 * (1 - night);
    }
    skyMat.emissiveIntensity = night * 0.7;
    headMat.emissiveIntensity = night * 3;
    beacons.visible = night > 0.3 && Math.floor(now / 700) % 2 === 0;
    const ws = now / 1000;
    waveTex.offset.set(ws * 0.011, ws * 0.007);
    waterMat.clearcoatNormalMap!.offset.set(-ws * 0.006, ws * 0.009);
    waterMat.color.setRGB(0.024 - night * 0.012, 0.125 - night * 0.08, 0.17 - night * 0.09);
    updateLights(t);
  };
  /** Give the reflective materials the HDRI once it loads. */
  const setEnv = (env: THREE.Texture) => {
    for (const m of [asphalt, waterMat, ...towerMats.slice(0, 6)]) {
      m.envMap = env;
      m.needsUpdate = true;
    }
  };
  return { setNight, setEnv, edges, merged };
}
