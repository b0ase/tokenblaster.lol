/**
 * Double-O Satoshi "look": real CC0 PBR texture sets (Poly Haven, see public/doubleo/CREDITS.md), an HDRI
 * for image-based lighting, a per-mission colour grade, and the Low/High quality switch.
 */
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export type Quality = 'low' | 'high';
const QKEY = 'doubleo:quality';

/** Phones and small touch devices start on Low; everything else on High. A saved choice wins. */
export function detectQuality(): Quality {
  try {
    const q = localStorage.getItem(QKEY);
    if (q === 'low' || q === 'high') return q;
  } catch {
    /* private mode */
  }
  const phone = /iPhone|iPad|Android/i.test(navigator.userAgent);
  const weak = (navigator.hardwareConcurrency ?? 8) <= 4;
  return phone || weak ? 'low' : 'high';
}
export function saveQuality(q: Quality) {
  try {
    localStorage.setItem(QKEY, q);
  } catch {
    /* private mode */
  }
}

export const LOOK_TEX = ['concrete_wall_006', 'concrete_floor_02', 'large_floor_tiles_02', 'dark_wood', 'metal_plate_02', 'wood_floor_deck', 'plastered_wall_04', 'brick_wall_02'] as const;
export type LookTex = (typeof LOOK_TEX)[number];

export type LookSpec = {
  wall: LookTex;
  trim: LookTex;
  floor: LookTex;
  ceiling: LookTex;
  wallTint: string;
  trimTint: string;
  floorTint: string;
  ceilingTint: string;
  fogDensity: number;
  exposure: number;
  envIntensity: number;
  /** Colour grade: shadows tint, highlights tint, saturation, contrast, vignette strength. */
  grade: { shadow: [number, number, number]; high: [number, number, number]; sat: number; contrast: number; vignette: number };
};

/** One look per mission: Far Cry 2 grit (concrete, rust, tile, wood) rather than uniform sci-fi metal. */
export const LOOKS: Record<string, LookSpec> = {
  facility: { wall: 'concrete_wall_006', trim: 'metal_plate_02', floor: 'large_floor_tiles_02', ceiling: 'concrete_floor_02', wallTint: '#b8c0c8', trimTint: '#8a9096', floorTint: '#9aa6ad', ceilingTint: '#50555a', fogDensity: 0.018, exposure: 1.15, envIntensity: 0.55, grade: { shadow: [0.92, 1.0, 1.1], high: [1.04, 1.02, 0.98], sat: 0.92, contrast: 1.1, vignette: 0.55 } },
  tower: { wall: 'plastered_wall_04', trim: 'dark_wood', floor: 'dark_wood', ceiling: 'plastered_wall_04', wallTint: '#a8794e', trimTint: '#6a3f24', floorTint: '#a8643a', ceilingTint: '#3a2418', fogDensity: 0.022, exposure: 1.05, envIntensity: 0.3, grade: { shadow: [1.06, 0.92, 0.88], high: [1.08, 0.98, 0.86], sat: 1.12, contrast: 1.22, vignette: 0.65 } },
  vault: { wall: 'concrete_wall_006', trim: 'metal_plate_02', floor: 'concrete_floor_02', ceiling: 'concrete_wall_006', wallTint: '#8f9a90', trimTint: '#6a7a6e', floorTint: '#7d857d', ceilingTint: '#384038', fogDensity: 0.024, exposure: 1.1, envIntensity: 0.5, grade: { shadow: [0.88, 1.06, 0.94], high: [0.98, 1.06, 0.98], sat: 0.85, contrast: 1.16, vignette: 0.65 } },
  farm: { wall: 'brick_wall_02', trim: 'metal_plate_02', floor: 'concrete_floor_02', ceiling: 'metal_plate_02', wallTint: '#9a8478', trimTint: '#7a8a82', floorTint: '#8a8a82', ceilingTint: '#3a403c', fogDensity: 0.022, exposure: 1.12, envIntensity: 0.55, grade: { shadow: [0.9, 1.04, 1.02], high: [1.0, 1.08, 1.0], sat: 0.95, contrast: 1.14, vignette: 0.6 } },
  yacht: { wall: 'plastered_wall_04', trim: 'dark_wood', floor: 'wood_floor_deck', ceiling: 'plastered_wall_04', wallTint: '#a9b4ba', trimTint: '#7a4a2a', floorTint: '#c08a58', ceilingTint: '#6a737a', fogDensity: 0.016, exposure: 1.0, envIntensity: 0.45, grade: { shadow: [0.9, 0.98, 1.12], high: [1.08, 1.03, 0.94], sat: 1.12, contrast: 1.22, vignette: 0.6 } },
};

export type Look = {
  material: (id: LookTex, repeat: [number, number], tint: string, metal?: number) => THREE.MeshStandardMaterial;
  env: THREE.Texture | null;
  dispose: () => void;
};

/** Load the PBR sets and the HDRI. Any file that fails is skipped (callers fall back to the Arena textures). */
export async function loadLook(renderer: THREE.WebGLRenderer, quality: Quality, onProgress?: (p: number) => void): Promise<Look> {
  const aniso = quality === 'high' ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 2;
  const mgr = new THREE.LoadingManager();
  mgr.onProgress = (_u, d, t) => onProgress?.(t ? d / t : 0);
  const tl = new THREE.TextureLoader(mgr);
  const load = (url: string, srgb: boolean) =>
    new Promise<THREE.Texture | null>((ok) =>
      tl.load(
        url,
        (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = aniso;
          if (srgb) t.colorSpace = THREE.SRGBColorSpace;
          ok(t);
        },
        undefined,
        () => ok(null),
      ),
    );
  const sets = new Map<LookTex, { map: THREE.Texture | null; normalMap: THREE.Texture | null; roughnessMap: THREE.Texture | null }>();
  await Promise.all(
    LOOK_TEX.map(async (id) => {
      const b = `/doubleo/tex/${id}`;
      const [map, normalMap, roughnessMap] = await Promise.all([load(`${b}/diff.webp`, true), load(`${b}/nor.webp`, false), load(`${b}/rough.webp`, false)]);
      sets.set(id, { map, normalMap, roughnessMap });
    }),
  );
  let env: THREE.Texture | null = null;
  try {
    const hdr = await new HDRLoader(mgr).loadAsync('/doubleo/warehouse_1k.hdr');
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(renderer);
    env = pm.fromEquirectangular(hdr).texture;
    hdr.dispose();
    pm.dispose();
  } catch {
    env = null;
  }
  const made: THREE.Texture[] = [];
  return {
    env,
    material: (id, repeat, tint, metal = 0.05) => {
      const s = sets.get(id);
      const c = (t: THREE.Texture | null) => {
        if (!t) return null;
        const k = t.clone();
        k.repeat.set(repeat[0], repeat[1]);
        k.needsUpdate = true;
        made.push(k);
        return k;
      };
      return new THREE.MeshStandardMaterial({ map: c(s?.map ?? null), normalMap: c(s?.normalMap ?? null), roughnessMap: c(s?.roughnessMap ?? null), color: tint, metalness: metal, normalScale: new THREE.Vector2(1.6, 1.6) });
    },
    dispose: () => {
      made.forEach((t) => t.dispose());
      env?.dispose();
    },
  };
}

/** Colour grade + vignette + film grain, run after tone mapping (in display-referred space). */
export function makeGradePass() {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uShadow: { value: new THREE.Vector3(1, 1, 1) },
      uHigh: { value: new THREE.Vector3(1, 1, 1) },
      uSat: { value: 1 },
      uContrast: { value: 1 },
      uVignette: { value: 0.5 },
      uTime: { value: 0 },
      uAberr: { value: 0.0012 },
      uHurt: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform vec3 uShadow; uniform vec3 uHigh;
      uniform float uSat, uContrast, uVignette, uTime, uAberr, uHurt;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
      void main(){
        vec2 d = vUv - 0.5;
        float r2 = dot(d, d);
        vec2 off = d * r2 * uAberr * 8.0;
        vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c *= mix(uShadow, uHigh, smoothstep(0.1, 0.8, l));
        c = mix(vec3(l), c, uSat);
        c = mix(c, c * vec3(1.35, 0.6, 0.6), uHurt);
        c = (c - 0.5) * uContrast + 0.5;
        c *= 1.0 - uVignette * smoothstep(0.18, 0.62, r2 * 2.2);
        c += (hash(vUv * 1024.0) - 0.5) * 0.035;
                gl_FragColor = vec4(max(c, 0.0), 1.0);
      }`,
  });
  const u = pass.uniforms as Record<string, { value: unknown }>;
  return {
    pass,
    apply: (g: LookSpec['grade']) => {
      (u.uShadow.value as THREE.Vector3).set(...g.shadow);
      (u.uHigh.value as THREE.Vector3).set(...g.high);
      u.uSat.value = g.sat;
      u.uContrast.value = g.contrast;
      u.uVignette.value = g.vignette;
    },
    tick: (t: number, hurt: number) => {
      u.uTime.value = t % 10;
      u.uHurt.value = hurt;
    },
  };
}
