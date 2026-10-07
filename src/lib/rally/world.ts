/**
 * Builds a rally stage in three.js from a Track: splatted PBR terrain, merged scenery blocks with
 * obstacle colliders, start/finish/checkpoint gates, skid marks, dust/gravel particles and snow.
 */
import * as THREE from 'three';
import { clamp, fbm, lerp, rng, smooth } from './noise';
import { barkTextures, clearProtoCache, foliageAtlas, getProto, grassTuftGeometry, newArr, type Arr, type PlantKind, type Proto } from './plants';
import type { Stage } from './stages';
import { groundNormal, groundY, nearest, pointAt, ROAD_HALF, STEP, type Near, type Track } from './track';

export type Quality = 'low' | 'high' | 'ultra';

// ───────────────────────────── Terrain ─────────────────────────────

const CH = 64; // chunk size in metres
const REACH = 112; // terrain extends this far from the road

export type TerrainTex = { ground: THREE.Texture; groundN: THREE.Texture; road: THREE.Texture; roadN: THREE.Texture; rock: THREE.Texture; rockN: THREE.Texture };

export function loadTerrainTextures(stage: Stage, renderer: THREE.WebGLRenderer): Promise<TerrainTex> {
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = (name: string, srgb: boolean) =>
    new Promise<THREE.Texture>((res, rej) =>
      loader.load(
        `/rally/tex/${name}.webp`,
        (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = aniso;
          t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          res(t);
        },
        undefined,
        rej,
      ),
    );
  return Promise.all([
    load(`${stage.ground}_diff`, true),
    load(`${stage.ground}_nor`, false),
    load('road_diff', true),
    load('road_nor', false),
    load('rock_diff', true),
    load('rock_nor', false),
  ]).then(([ground, groundN, road, roadN, rock, rockN]) => ({ ground, groundN, road, roadN, rock, rockN }));
}

export function terrainMaterial(stage: Stage, tex: TerrainTex, quality: Quality) {
  const mat = new THREE.MeshStandardMaterial({ map: tex.ground, normalMap: tex.groundN, roughness: 0.95, metalness: 0, color: '#ffffff' });
  mat.normalScale.set(1.25, 1.25);
  const wet = stage.id === 'forest' ? 0.55 : stage.id === 'snow' ? 0.15 : 0.0;
  const verge = stage.id === 'forest' ? '#5b8a3a' : stage.id === 'desert' ? '#b09a5a' : '#dfe6ee';
  const uniforms = {
    tRoad: { value: tex.road },
    tRoadN: { value: tex.roadN },
    tRock: { value: tex.rock },
    tRockN: { value: tex.rockN },
    uGroundTint: { value: new THREE.Color(stage.groundTint) },
    uRoadTint: { value: new THREE.Color(stage.roadTint) },
    uRockTint: { value: new THREE.Color(stage.rockTint) },
    uVerge: { value: new THREE.Color(verge) },
    uVergeAmt: { value: stage.id === 'forest' ? 0.6 : stage.id === 'desert' ? 0.4 : 0.35 },
    uWet: { value: wet },
    uRoadHalf: { value: ROAD_HALF },
    uGScale: { value: stage.groundScale },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aD;\nvarying float vD;\nvarying vec3 vWP3;\nvarying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvD = aD; vWP3 = position; vWN = normal;');
    const hi = quality !== 'low' ? '#define HQ\n' : '';
    sh.fragmentShader =
      hi +
      sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform sampler2D tRoad; uniform sampler2D tRoadN; uniform sampler2D tRock; uniform sampler2D tRockN;
uniform vec3 uGroundTint; uniform vec3 uRoadTint; uniform vec3 uRockTint; uniform vec3 uVerge; uniform float uVergeAmt; uniform float uWet; uniform float uRoadHalf; uniform float uGScale;
varying float vD; varying vec3 vWP3; varying vec3 vWN;
float tWRoad; float tWRock; float tRut; float tPud; float tDetail;
float tHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tNoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(tHash(i), tHash(i+vec2(1,0)), f.x), mix(tHash(i+vec2(0,1)), tHash(i+vec2(1,1)), f.x), f.y); }`,
        )
        .replace(
          '#include <map_fragment>',
          `
        vec2 wp = vWP3.xz;
        float camD = length( vViewPosition );
        tDetail = 1.0 - smoothstep( 8.0, 45.0, camD );
        // Parallax-lite: shift the lookups along the view ray by the albedo's own relief.
        vec3 vdir = normalize( cameraPosition - vWP3 );
        vec2 par = -vdir.xz / max( vdir.y, 0.25 );
        vec2 gUv = vMapUv;
        float relief = texture2D( map, gUv ).g - 0.5;
        vec2 shift = par * relief * 0.06 * tDetail;
        gUv += shift / uGScale;
        vec3 gA = texture2D( map, gUv ).rgb;
        #ifdef HQ
          vec3 gB = texture2D( map, gUv * 0.173 + vec2(0.37, 0.11) ).rgb;
          float lowN = gB.g;
          gA = mix( gA, gB, 0.4 );
          vec3 gC = texture2D( map, gUv * 3.7 ).rgb;
          gA *= mix( vec3( 1.0 ), gC * 1.9, 0.35 * tDetail );
        #else
          float lowN = gA.g;
        #endif
        float edgeN = ( lowN - 0.5 ) * 1.5;
        tWRoad = 1.0 - smoothstep( uRoadHalf - 1.0 + edgeN, uRoadHalf + 0.5 + edgeN, vD );
        float ad = abs( vD );
        // Two wheel ruts, a raised crown between them and loose gravel kicked to the edges.
        float rutL = exp( -pow( ( ad - 1.05 ) / 0.28, 2.0 ) );
        tRut = rutL * tWRoad;
        float berm = exp( -pow( ( ad - 2.0 ) / 0.6, 2.0 ) ) * tWRoad;
        float edgeG = smoothstep( uRoadHalf - 1.6, uRoadHalf - 0.2, ad ) * ( 1.0 - smoothstep( uRoadHalf - 0.2, uRoadHalf + 1.2, ad ) );
        tWRock = smoothstep( 0.82, 0.6, normalize( vWN ).y ) * ( 1.0 - tWRoad );
        vec2 rUv = ( wp + shift ) / 3.2;
        vec3 gR = texture2D( tRoad, rUv ).rgb;
        vec3 gR2 = texture2D( tRoad, rUv * 5.3 ).rgb;
        gR *= mix( vec3( 1.0 ), gR2 * 1.7, 0.4 * tDetail );
        vec3 gK = texture2D( tRock, wp / 5.5 ).rgb;
        vec3 albedo = gA * uGroundTint;
        // Verge grass fringe.
        float vergeM = smoothstep( uRoadHalf + 0.3, uRoadHalf + 1.2, ad ) * ( 1.0 - smoothstep( uRoadHalf + 3.5, uRoadHalf + 9.0, ad + ( tNoise( wp * 0.7 ) - 0.5 ) * 6.0 ) );
        albedo = mix( albedo, uVerge * ( 0.45 + gA.g * 0.9 ), vergeM * uVergeAmt * ( 0.5 + 0.5 * tNoise( wp * 1.9 ) ) );
        albedo = mix( albedo, gK * uRockTint * 1.5, tWRock );
        vec3 roadCol = gR * uRoadTint * 1.25;
        roadCol *= 1.0 - tRut * 0.38;
        roadCol = mix( roadCol, roadCol * 1.18, berm * 0.6 );
        roadCol = mix( roadCol, gR * uRoadTint * 1.5, edgeG * 0.5 );
        albedo = mix( albedo, roadCol, tWRoad );
        // Puddles pool in the ruts and low patches.
        tPud = uWet * tWRoad * smoothstep( 0.6, 0.74, tNoise( wp * 0.45 + 7.0 ) * 0.6 + rutL * 0.45 );
        albedo = mix( albedo, albedo * vec3( 0.5, 0.48, 0.45 ), tPud );
        diffuseColor.rgb *= albedo;
        `,
        )
        .replace(
          '#include <normal_fragment_maps>',
          THREE.ShaderChunk.normal_fragment_maps
            .split('texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0')
            .join(
              `( ( mix( mix( texture2D( normalMap, vNormalMapUv ).xyz, texture2D( tRockN, wp / 5.5 ).xyz, tWRock ), texture2D( tRoadN, wp / 3.2 ).xyz, tWRoad ) * 2.0 - 1.0 + ( texture2D( tRoadN, wp * 1.4 ).xyz * 2.0 - 1.0 ) * vec3( 0.6, 0.6, 0.0 ) * tDetail * 0.6 ) * vec3( 1.0 - tPud * 0.95, 1.0 - tPud * 0.95, 1.0 ) )`,
            ),
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.78, tWRoad * 0.5 );\nroughnessFactor = mix( roughnessFactor, 0.035, tPud );');
  };
  mat.customProgramCacheKey = () => `rally-terrain-${quality}`;
  return mat;
}

export function buildTerrain(track: Track, mat: THREE.Material, quality: Quality) {
  const group = new THREE.Group();
  const N = quality === 'ultra' ? 64 : quality === 'high' ? 48 : 20;
  const need = new Set<number>();
  const R = REACH + CH * 0.7;
  for (let i = 0; i < track.n; i += 4) {
    const x0 = Math.floor((track.x[i] - R) / CH);
    const x1 = Math.floor((track.x[i] + R) / CH);
    const z0 = Math.floor((track.z[i] - R) / CH);
    const z1 = Math.floor((track.z[i] + R) / CH);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) need.add((cx + 512) * 1024 + (cz + 512));
  }
  const near: Near = { i: 0, s: 0, lat: 0, dist: 0 };
  const nrm = { x: 0, y: 1, z: 0 };
  const cell = CH / N;
  const V = N + 1;
  const index = new Uint32Array(N * N * 6);
  let k = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const a = j * V + i;
      index[k++] = a;
      index[k++] = a + V;
      index[k++] = a + 1;
      index[k++] = a + 1;
      index[k++] = a + V;
      index[k++] = a + V + 1;
    }
  for (const code of need) {
    const cx = Math.floor(code / 1024) - 512;
    const cz = (code % 1024) - 512;
    const ox = cx * CH;
    const oz = cz * CH;
    // Skip chunks whose centre is too far from the road.
    nearest(track, ox + CH / 2, oz + CH / 2, near);
    if (near.dist > REACH + CH * 0.75) continue;
    const pos = new Float32Array(V * V * 3);
    const nor = new Float32Array(V * V * 3);
    const uv = new Float32Array(V * V * 2);
    const dd = new Float32Array(V * V);
    let minY = 1e9;
    let maxY = -1e9;
    for (let j = 0; j < V; j++)
      for (let i = 0; i < V; i++) {
        const wx = ox + i * cell;
        const wz = oz + j * cell;
        const y = groundY(track, wx, wz, false, near);
        dd[j * V + i] = near.lat; // signed: the ruts / edge use abs()
        groundNormal(track, wx, wz, nrm);
        const o = j * V + i;
        // Vertices are chunk-local so each chunk can be culled on its own.
        pos[o * 3] = wx - ox;
        pos[o * 3 + 1] = y;
        pos[o * 3 + 2] = wz - oz;
        nor[o * 3] = nrm.x;
        nor[o * 3 + 1] = nrm.y;
        nor[o * 3 + 2] = nrm.z;
        uv[o * 2] = wx / track.stage.groundScale;
        uv[o * 2 + 1] = wz / track.stage.groundScale;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    // The splat shader reads world xz from `position`, so keep world-space x/z by baking the offset.
    for (let o = 0; o < V * V; o++) {
      pos[o * 3] += ox;
      pos[o * 3 + 2] += oz;
      dd[o] = Math.abs(dd[o]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aD', new THREE.BufferAttribute(dd, 1));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(ox, minY - 1, oz), new THREE.Vector3(ox + CH, maxY + 1, oz + CH));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.castShadow = quality === 'high';
    group.add(m);
  }
  return group;
}

// ───────────────────────────── Scenery ─────────────────────────────

export type Obstacles = {
  hit(x: number, z: number, r: number, out: { nx: number; nz: number; pen: number }): boolean;
  count: number;
};

export type SceneryMats = { foliage: THREE.MeshStandardMaterial; bark: THREE.MeshStandardMaterial; rock: THREE.MeshStandardMaterial; cactus: THREE.MeshStandardMaterial; grass: THREE.MeshStandardMaterial; wind: { value: number }; atlas: THREE.Texture; barkMap: THREE.Texture; barkBump: THREE.Texture };

export function sceneryMaterials(stage: Stage, rockTex: THREE.Texture): SceneryMats {
  const wind = { value: 0 };
  const atlas = foliageAtlas();
  const bk = barkTextures();
  const windPatch = (m: THREE.MeshStandardMaterial, amp: number, tag: string, twoSided = false) => {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = wind;
      // Alpha cards: light the back face like the front so canopies are not black from behind.
      if (twoSided) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'));
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aWind; uniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 wp = vec3(instanceMatrix[3].x, 0.0, instanceMatrix[3].z);
          #else
            vec3 wp = vec3(position.x, 0.0, position.z);
          #endif
          float ph = uTime * 1.6 + wp.x * 0.21 + wp.z * 0.17;
          float gust = sin(uTime * 0.37 + wp.x * 0.02) * 0.5 + 0.8;
          transformed.x += (sin(ph) + sin(ph * 2.3 + 1.7) * 0.4) * aWind * ${amp.toFixed(2)} * gust;
          transformed.z += (cos(ph * 0.9) * 0.5) * aWind * ${amp.toFixed(2)} * gust;`,
        );
    };
    m.customProgramCacheKey = () => 'wind-' + tag;
  };
  const foliage = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 });
  windPatch(foliage, 0.28, 'f', true);
  const bark = new THREE.MeshStandardMaterial({ map: bk.map, bumpMap: bk.bump, bumpScale: 2.5, vertexColors: true, roughness: 0.95 });
  windPatch(bark, 0.12, 'b');
  const rock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, map: rockTex });
  const cactus = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  const grass = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
  windPatch(grass, 0.4, 'g', true);
  void stage;
  return { foliage, bark, rock, cactus, grass, wind, atlas, barkMap: bk.map, barkBump: bk.bump };
}

const BLOCK = 150; // metres of stage per merged scenery block
const LOD_DIST = 150;

type Acc = Record<'foliage' | 'bark' | 'rock' | 'cactus', Arr>;
const mkAcc = (): Acc => ({ foliage: newArr(), bark: newArr(), rock: newArr(), cactus: newArr() });

export async function buildScenery(track: Track, mats: SceneryMats, quality: Quality) {
  const st = track.stage;
  const hiOk = quality !== 'low';
  const r = rng(st.seed * 977 + 5);
  const group = new THREE.Group();
  const cellsObs = new Map<number, number[]>();
  let obsCount = 0;
  const OC = 12;
  const addObs = (x: number, z: number, rad: number) => {
    const k = (Math.floor(x / OC) + 2048) * 4096 + (Math.floor(z / OC) + 2048);
    const a = cellsObs.get(k);
    if (a) a.push(x, z, rad);
    else cellsObs.set(k, [x, z, rad]);
    obsCount++;
  };
  const pal = { leaf: st.leaf.map((c) => new THREE.Color(c)), bark: new THREE.Color('#ffffff'), rock: new THREE.Color(st.rock), moss: new THREE.Color(st.moss) };
  const snowCol = new THREE.Color('#f4f7fb');
  const tmpC = new THREE.Color();
  const tmp: Near = { i: 0, s: 0, lat: 0, dist: 0 };
  const dens = quality === 'ultra' ? 1.25 : quality === 'high' ? 1 : 0.5;
  const blocks = Math.ceil(track.len / BLOCK);

  const place = (acc: Acc, proto: Proto, x: number, z: number, scale: number, yaw: number, leafIdx: number, tintJ: number, hs: number, y0: number) => {
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    for (const cls of ['foliage', 'bark', 'rock', 'cactus'] as const) {
      const src = proto[cls];
      if (!src) continue;
      const a = acc[cls];
      const base = a.pos.length / 3;
      const n = src.pos.length / 3;
      for (let v = 0; v < n; v++) {
        const px = src.pos[v * 3] * scale * hs;
        const py = src.pos[v * 3 + 1] * scale;
        const pz = src.pos[v * 3 + 2] * scale * hs;
        a.pos.push(x + px * cs + pz * sn, y0 + py, z - px * sn + pz * cs);
        const nx = src.nor[v * 3];
        const nz = src.nor[v * 3 + 2];
        a.nor.push(nx * cs + nz * sn, src.nor[v * 3 + 1], -nx * sn + nz * cs);
        a.uv.push(src.uv[v * 2], src.uv[v * 2 + 1]);
        const ny = src.nor[v * 3 + 1];
        const cr = src.col[v * 3];
        const cg = src.col[v * 3 + 1];
        const cb = src.col[v * 3 + 2];
        if (cls === 'foliage') tmpC.copy(pal.leaf[leafIdx % pal.leaf.length]).multiplyScalar(st.snow ? 1.15 : 1.9);
        else if (cls === 'rock') tmpC.copy(pal.rock).multiplyScalar(1.15);
        else tmpC.setRGB(1, 1, 1);
        tmpC.r *= cr * tintJ;
        tmpC.g *= cg * tintJ;
        tmpC.b *= cb * tintJ;
        if (st.snow && cls !== 'cactus') tmpC.lerp(snowCol, (cls === 'foliage' ? 0.3 : 0.8) * clamp((ny + 0.1) * 1.1, 0, 1) * (cls === 'bark' ? 0.3 : 1));
        a.col.push(tmpC.r, tmpC.g, tmpC.b);
        a.wind.push(src.wind[v] ?? 0);
      }
      for (let i = 0; i < src.idx.length; i++) a.idx.push(base + (src.idx[i] ?? 0));
    }
  };

  const toMesh = (acc: Acc, into: THREE.Group, cast: boolean) => {
    for (const cls of ['foliage', 'bark', 'rock', 'cactus'] as const) {
      const a = acc[cls];
      if (!a.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(a.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(a.col, 3));
      g.setAttribute('aWind', new THREE.Float32BufferAttribute(a.wind, 1));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(a.idx), 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mats[cls]);
      m.castShadow = cast;
      m.receiveShadow = true;
      into.add(m);
    }
  };

  type Blk = { hi: THREE.Group; lo: THREE.Group; cx: number; cz: number; grass: THREE.InstancedMesh | null };
  const blks: Blk[] = [];
  const grassGeo = quality !== 'low' ? grassTuftGeometry() : null;
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const variant = () => Math.floor(r() * 4);
  const dummy = new THREE.Object3D();

  for (let bi = 0; bi < blocks; bi++) {
    const accHi = mkAcc();
    const accLo = mkAcc();
    const s0 = bi * BLOCK;
    const s1 = Math.min(track.len, s0 + BLOCK);
    const mid = { x: 0, y: 0, z: 0, yaw: 0 };
    pointAt(track, (s0 + s1) / 2, 0, mid);
    const put = (kind: PlantKind, x: number, z: number, hT: number, leafIdx: number, hs: number) => {
      const v = variant();
      const pl = getProto(kind, v, false);
      const sc = hT / pl.h;
      const yaw = r() * 6.283;
      const j = 0.85 + r() * 0.3;
      const y0 = groundY(track, x, z, false, tmp) - 0.15;
      place(accLo, pl, x, z, sc, yaw, leafIdx, j, hs, y0);
      if (hiOk) place(accHi, getProto(kind, v, true), x, z, hT / getProto(kind, v, true).h, yaw, leafIdx, j, hs, y0);
      return { pl, sc };
    };
    for (let s = s0; s < s1; s += 2.4) {
      const sp = { x: 0, y: 0, z: 0, yaw: 0 };
      for (const side of [-1, 1]) {
        const tries = quality === 'ultra' ? 4 : quality === 'high' ? 3 : 2;
        for (let t = 0; t < tries; t++) {
          const lat = side * (ROAD_HALF + 3.4 + Math.pow(r(), 1.7) * 58);
          pointAt(track, s + r() * 2.4, lat, sp);
          const cl = 0.5 + 0.7 * fbm(sp.x / 55, sp.z / 55, st.seed, 3) + 0.25;
          const p = st.treeDensity * dens * clamp(cl, 0.05, 1.2) * (Math.abs(lat) > 42 ? 0.55 : 1);
          if (r() > p * 0.78) continue;
          nearest(track, sp.x, sp.z, tmp);
          if (tmp.dist < ROAD_HALF + 3.2) continue;
          const kind = pick(st.trees) as PlantKind;
          const hT = kind === 'palm' ? 7 + r() * 4 : kind === 'oak' || kind === 'birch' ? 8 + r() * 4 : 11 + r() * 8;
          const { sc } = put(kind, sp.x, sp.z, hT, Math.floor(r() * 3), 1);
          addObs(sp.x, sp.z, 0.45 + hT * 0.02 * (sc > 0 ? 1 : 1));
        }
        if (r() < 0.22 * st.rockDensity * (quality === 'low' ? 0.6 : 1)) {
          const lat = side * (ROAD_HALF + 2.4 + Math.pow(r(), 1.5) * 40);
          pointAt(track, s + r() * 2.4, lat, sp);
          nearest(track, sp.x, sp.z, tmp);
          const kind = pick(st.rocks) as PlantKind;
          const big = kind === 'rockTall' || (kind === 'rock' && r() < 0.35);
          const hT = kind === 'rock' || kind === 'rockTall' ? (big ? 2.6 + r() * 3.4 : 0.8 + r() * 1.3) : kind === 'cactus' ? 3.2 + r() * 2.6 : kind === 'cactusShort' ? 1.0 + r() * 0.6 : 1;
          const need = ROAD_HALF + 1.6 + (kind === 'rock' || kind === 'rockTall' ? hT * 0.7 : 0.4);
          if (tmp.dist >= need) {
            const { pl, sc } = put(kind, sp.x, sp.z, hT, 0, 1);
            const solid = kind === 'rock' || kind === 'rockTall' ? hT > 1.3 : kind !== 'log';
            if (solid) addObs(sp.x, sp.z, Math.max(0.35, pl.w * sc * (kind === 'cactus' || kind === 'cactusShort' ? 0.12 : 0.36)));
          }
        }
        if (quality !== 'low' && r() < 0.6) {
          const lat = side * (ROAD_HALF + 1.2 + Math.pow(r(), 1.3) * 18);
          pointAt(track, s + r() * 2.4, lat, sp);
          nearest(track, sp.x, sp.z, tmp);
          if (tmp.dist >= ROAD_HALF + 1.2) {
            const kind = pick(st.bushes) as PlantKind;
            put(kind, sp.x, sp.z, kind === 'cactusShort' ? 0.9 + r() * 0.5 : 0.9 + r() * 0.9, Math.floor(r() * 3), 1);
          }
        }
      }
    }
    const hi = new THREE.Group();
    const lo = new THREE.Group();
    toMesh(accLo, lo, true);
    if (hiOk) toMesh(accHi, hi, true);
    group.add(hi, lo);
    // Roadside grass tufts (instanced, wind-swayed).
    let grass: THREE.InstancedMesh | null = null;
    if (grassGeo && st.id !== 'snow') {
      const per = quality === 'ultra' ? 1900 : 1000;
      const inst = new THREE.InstancedMesh(grassGeo, mats.grass, per);
      let n = 0;
      const sp = { x: 0, y: 0, z: 0, yaw: 0 };
      const gc = new THREE.Color();
      for (let i = 0; i < per; i++) {
        const side = r() < 0.5 ? -1 : 1;
        const lat = side * (ROAD_HALF + 0.9 + Math.pow(r(), 1.6) * 12);
        pointAt(track, s0 + r() * (s1 - s0), lat, sp);
        nearest(track, sp.x, sp.z, tmp);
        if (tmp.dist < ROAD_HALF + 0.7) continue;
        const dry = st.id === 'desert';
        dummy.position.set(sp.x, groundY(track, sp.x, sp.z, false, tmp) - 0.02, sp.z);
        const sc = dry ? 0.7 + r() * 0.8 : 0.9 + r() * 1.1;
        dummy.scale.set(sc, sc * (0.55 + r() * 0.4), sc);
        dummy.rotation.set(0, r() * 6.28, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(n, dummy.matrix);
        gc.set(dry ? '#c8b070' : st.leaf[1]).multiplyScalar(dry ? 0.9 + r() * 0.2 : 1.5 + r() * 0.6);
        inst.setColorAt(n, gc);
        n++;
      }
      inst.count = n;
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.receiveShadow = true;
      inst.frustumCulled = true;
      inst.computeBoundingSphere();
      group.add(inst);
      grass = inst;
    }
    blks.push({ hi, lo, cx: mid.x, cz: mid.z, grass });
  }

  const obstacles: Obstacles = {
    count: obsCount,
    hit(x, z, rad, out) {
      const cx = Math.floor(x / OC);
      const cz = Math.floor(z / OC);
      let best = 0;
      let found = false;
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          const a = cellsObs.get((cx + dx + 2048) * 4096 + (cz + dz + 2048));
          if (!a) continue;
          for (let i = 0; i < a.length; i += 3) {
            const ddx = x - a[i];
            const ddz = z - a[i + 1];
            const rr = a[i + 2] + rad;
            const d2 = ddx * ddx + ddz * ddz;
            if (d2 < rr * rr) {
              const d = Math.sqrt(d2) || 0.001;
              const pen = rr - d;
              if (pen > best) {
                best = pen;
                out.nx = ddx / d;
                out.nz = ddz / d;
                out.pen = pen;
                found = true;
              }
            }
          }
        }
      return found;
    },
  };
  /** Per frame: swap LODs by distance, advance the wind. */
  const update = (cx: number, cz: number, time: number) => {
    mats.wind.value = time;
    for (const b of blks) {
      const d = Math.hypot(b.cx - cx, b.cz - cz);
      const near = d < LOD_DIST && hiOk;
      b.hi.visible = near;
      b.lo.visible = !near && d < st.fogFar + 260;
      if (b.grass) b.grass.visible = d < 260;
    }
  };
  const dispose = () => {
    group.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
    grassGeo?.dispose();
    clearProtoCache();
  };
  return { group, obstacles, update, dispose };
}

// ───────────────────────────── Gates ─────────────────────────────

function bannerTexture(text: string, sub: string, hot: string) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b0d12';
  g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 32; i++) {
    g.fillStyle = i % 2 ? '#f5f5f5' : '#111';
    g.fillRect(i * 16, 0, 16, 10);
    g.fillRect(i * 16 + (i % 2 ? 0 : 0), 118, 16, 10);
  }
  g.fillStyle = hot;
  g.font = 'bold 66px ui-monospace, Menlo, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 56);
  g.fillStyle = '#9aa3ad';
  g.font = '20px ui-monospace, Menlo, monospace';
  g.fillText(sub, 256, 100);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A gantry across the road at stage distance s. */
export function gate(track: Track, s: number, label: string, sub: string, hot = '#ffd23f') {
  const p = { x: 0, y: 0, z: 0, yaw: 0 };
  pointAt(track, s, 0, p);
  const g = new THREE.Group();
  const post = new THREE.MeshStandardMaterial({ color: '#2a2e36', metalness: 0.6, roughness: 0.4 });
  const half = ROAD_HALF + 1.6;
  for (const sd of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6.4, 0.35), post);
    m.position.set(sd * half, 3.2, 0);
    m.castShadow = true;
    g.add(m);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.4, 0.3, 0.3), post);
  bar.position.set(0, 6.4, 0);
  g.add(bar);
  const ban = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2 - 0.4, (half * 2 - 0.4) / 4),
    new THREE.MeshBasicMaterial({ map: bannerTexture(label, sub, hot), side: THREE.DoubleSide, toneMapped: false }),
  );
  ban.position.set(0, 5.6 - 0.05, 0);
  ban.rotation.y = Math.PI; // faces the traffic approaching from behind (the road runs +z)
  g.add(ban);
  // Light strip.
  const light = new THREE.Mesh(new THREE.BoxGeometry(half * 2 - 0.6, 0.08, 0.08), new THREE.MeshBasicMaterial({ color: hot, toneMapped: false }));
  light.position.set(0, 6.25, 0.2);
  g.add(light);
  g.position.set(p.x, p.y, p.z);
  g.rotation.y = p.yaw;
  return g;
}

// ───────────────────────────── Skid marks ─────────────────────────────

export class Skids {
  mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private head = 0;
  private cap: number;
  private last: ({ x: number; z: number } | null)[] = [null, null, null, null];
  private dirty = false;
  constructor(cap = 2600) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 4 * 3);
    this.col = new Float32Array(cap * 4 * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array(cap * 6);
    for (let i = 0; i < cap; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e5);
    const m = new THREE.MeshBasicMaterial({ color: '#0d0b09', vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: true });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }
  /** Lay a mark from the wheel's last point to (x,z,y); strength 0 breaks the line. */
  mark(w: number, x: number, y: number, z: number, strength: number, width = 0.3) {
    const last = this.last[w];
    if (strength < 0.08) {
      this.last[w] = null;
      return;
    }
    if (!last) {
      this.last[w] = { x, z };
      return;
    }
    const dx = x - last.x;
    const dz = z - last.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35) return;
    const nx = (-dz / d) * width * 0.5;
    const nz = (dx / d) * width * 0.5;
    const o = this.head * 12;
    const p = this.pos;
    const lyY = y + 0.06;
    p[o] = last.x - nx; p[o + 1] = this.lastY(w, lyY); p[o + 2] = last.z - nz;
    p[o + 3] = last.x + nx; p[o + 4] = this.lastY(w, lyY); p[o + 5] = last.z + nz;
    p[o + 6] = x - nx; p[o + 7] = lyY; p[o + 8] = z - nz;
    p[o + 9] = x + nx; p[o + 10] = lyY; p[o + 11] = z + nz;
    const a = clamp(strength, 0, 1) * 0.42;
    for (let k = 0; k < 4; k++) {
      const c = this.head * 16 + k * 4;
      this.col[c] = 1;
      this.col[c + 1] = 1;
      this.col[c + 2] = 1;
      this.col[c + 3] = a * (k < 2 ? 0.7 : 1);
    }
    this.head = (this.head + 1) % this.cap;
    this.last[w] = { x, z };
    this.lastYs[w] = y + 0.06;
    this.dirty = true;
  }
  private lastYs = [0, 0, 0, 0];
  private lastY(w: number, fallback: number) {
    return this.lastYs[w] || fallback;
  }
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
  clear() {
    this.pos.fill(0);
    this.col.fill(0);
    this.head = 0;
    this.last = [null, null, null, null];
    this.dirty = true;
  }
  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ───────────────────────────── Particles ─────────────────────────────

const PV = `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor; attribute float aKind;
varying float vA; varying vec3 vC; varying float vK;
uniform float uScale;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, aSize * uScale / max(0.5, -mv.z));
  vA = aAlpha * smoothstep(260.0, 120.0, -mv.z); vC = aColor; vK = aKind;
}`;
const PF = `
varying float vA; varying vec3 vC; varying float vK;
void main(){
  vec2 p = gl_PointCoord - 0.5; float d = length(p);
  float a;
  if (vK > 0.5) { a = step(d, 0.5); } else { a = smoothstep(0.5, 0.05, d); a *= a; }
  if (a * vA < 0.01) discard;
  gl_FragColor = vec4(vC, a * vA);
}`;

export class Particles {
  points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private col: Float32Array;
  private kind: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private a0: Float32Array;
  private grav: Float32Array;
  private head = 0;
  uniforms = { uScale: { value: 600 } };
  constructor(n = 900) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.col = new Float32Array(n * 3);
    this.kind = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.a0 = new Float32Array(n);
    this.grav = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aKind', new THREE.BufferAttribute(this.kind, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e5);
    const m = new THREE.ShaderMaterial({ vertexShader: PV, fragmentShader: PF, uniforms: this.uniforms, transparent: true, depthWrite: false });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, alpha: number, c: THREE.Color, kind = 0, grav = 0) {
    const i = this.head;
    this.head = (this.head + 1) % this.n;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.max[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.a0[i] = alpha;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
    this.kind[i] = kind;
    this.grav[i] = grav;
  }
  update(dt: number, ground: (x: number, z: number) => number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.max[i];
      const k = this.kind[i];
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      const drag = k > 0.5 ? 0.4 : 2.2;
      const f = Math.exp(-drag * dt);
      this.vel[i * 3] *= f;
      this.vel[i * 3 + 2] *= f;
      if (k < 0.5) this.vel[i * 3 + 1] *= f;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (k > 0.5) {
        const gy = ground(this.pos[i * 3], this.pos[i * 3 + 2]) + 0.04;
        if (this.pos[i * 3 + 1] < gy) {
          this.pos[i * 3 + 1] = gy;
          this.vel[i * 3 + 1] *= -0.3;
          this.vel[i * 3] *= 0.6;
          this.vel[i * 3 + 2] *= 0.6;
        }
      }
      this.size[i] = lerp(this.s0[i], this.s1[i], t);
      this.alpha[i] = this.a0[i] * (k > 0.5 ? 1 - t * t : smooth(0, 0.12, t) * (1 - t));
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aKind.needsUpdate = true;
  }
  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

// ───────────────────────────── Snow ─────────────────────────────

export class Snow {
  points: THREE.Points;
  uniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uScale: { value: 600 } };
  constructor(n = 1600) {
    const pos = new Float32Array(n * 3);
    const r = rng(7);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = r() * 60;
      pos[i * 3 + 1] = r() * 40;
      pos[i * 3 + 2] = r() * 60;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e5);
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        uniform float uTime; uniform vec3 uCam; uniform float uScale; varying float vA;
        void main(){
          vec3 p = position;
          p.y -= uTime * (1.6 + fract(position.x * 7.13) * 1.2);
          p.x += sin(uTime * 0.6 + position.z) * 0.8 + uTime * 1.4;
          p.z += cos(uTime * 0.5 + position.x) * 0.6;
          vec3 box = vec3(60.0, 40.0, 60.0);
          vec3 w = uCam - box * 0.5 + mod(p - uCam + box * 0.5, box);
          vec4 mv = viewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(1.0, (0.09 + fract(position.z * 3.1) * 0.08) * uScale / max(0.5, -mv.z));
          vA = smoothstep(32.0, 6.0, -mv.z) * smoothstep(0.0, 3.0, -mv.z);
        }`,
      fragmentShader: `
        varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.15, d) * vA * 0.9; if (a < 0.02) discard; gl_FragColor = vec4(vec3(0.96, 0.98, 1.0), a); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }
  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

export { STEP };
