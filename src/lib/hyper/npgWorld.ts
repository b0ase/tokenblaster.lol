/**
 * NPG Racing world look: a bright cartoon sunset instead of bRacer's night megacity. Toon sky with puffy clouds,
 * a cel-shaded track with pink/white checker kerbs, flat-colour toy-town blocks with NPG graffiti, big NPG card
 * billboards, Erobot factories on the rival side. Visual only: the track geometry and sim are bRacer's.
 */
import * as THREE from 'three';
import { rng } from '@/lib/rally/noise';
import { frameAt, HALF_W, newFrame, type Track, type TrackDef } from './track';
import type { Own } from './architecture';

export const NPG_PINK = '#ff2d95';
export const NPG_CYAN = '#22e6ff';

/** Per-circuit NPG names (layouts are bRacer's). */
const NAMES: Record<string, { name: string; kana: string; blurb: string }> = {
  canyon: { name: 'Shuriken Sunset', kana: 'シュリケン', blurb: 'Warm-up run through Punk Town at golden hour: sweeping bends, one big drop and a graffiti tunnel.' },
  spiral: { name: 'Dojo Corkscrew', kana: 'ドージョー', blurb: 'Twisting up past the rooftop dojos: corkscrews, half-pipes and a lot of air.' },
  void: { name: 'Erobot Foundry', kana: 'エロボット', blurb: "Straight through the Erobots' smoking foundry. Don't let them catch you." },
  'mempool-loop': { name: 'Bubblegum Loop', kana: 'バブルガム', blurb: 'A candy-pink loop around the arcade district.' },
};
const SUNSETS: [string, string, string][] = [
  ['#3b8cff', '#ff9ad5', '#ffd27a'],
  ['#5a6bff', '#ffb36b', '#fff0a8'],
  ['#2fb8ff', '#ff7ac0', '#ffe28a'],
  ['#6c5cff', '#ff8f6b', '#ffd0f0'],
];

export function npgName(def: { id: string; name: string; kana: string; blurb: string }) {
  return NAMES[def.id] ?? { name: `Punk ${def.name}`, kana: 'ニンジャパンク', blurb: def.blurb };
}

/** bRacer's track definition re-themed for NPG Racing (same layout, same id so boards still key by track). */
export function npgTrackDef(def: TrackDef): TrackDef {
  const n = npgName(def);
  const [zen, hor, glow] = SUNSETS[Math.abs(def.seed) % SUNSETS.length];
  // Kart circuits: about 60% of the hover lap, with extra wiggle harmonics (hairpins) and more ramps.
  const extraHarm: [number, number, number][] = def.points ? [] : [[5, 0.17, 0.9 + def.seed * 0.3], [8, 0.08, 2.1]];
  const jumps = Array.from(new Set([...def.jumps, 0.3, 0.52, 0.86].map((j) => Math.round(j * 100) / 100))).filter((j) => !def.tunnels.some(([a, b]) => j > a - 0.02 && j < b + 0.02)).sort((a, b) => a - b);
  let points = def.points;
  if (points) {
    const cx = points.reduce((a, p) => a + p.x, 0) / points.length;
    const cz = points.reduce((a, p) => a + p.z, 0) / points.length;
    const cy = points.reduce((a, p) => a + p.y, 0) / points.length;
    points = points.map((p) => ({ ...p, x: cx + (p.x - cx) * 0.62, z: cz + (p.z - cz) * 0.62, y: cy + (p.y - cy) * 0.8 }));
  }
  return {
    ...def,
    points,
    R: def.R * 0.62,
    harm: [...def.harm, ...extraHarm],
    jumps,
    par: def.par ? { lapSeconds: def.par.lapSeconds ? Math.round(def.par.lapSeconds * 0.85) : undefined, raceSeconds: def.par.raceSeconds ? Math.round(def.par.raceSeconds * 0.85) : undefined } : undefined,
    name: n.name,
    kana: n.kana,
    blurb: n.blurb,
    palette: { zenith: zen, horizon: hor, glow, fog: '#ffc6e4', a1: NPG_PINK, a2: NPG_CYAN, sun: '#fff4c8', fogDensity: Math.min(def.palette.fogDensity, 0.00045) },
    signs: ['NINJA PUNK GIRLS', 'NPG RACING', 'EROBOTS GO HOME', 'PUNK NEVER DIES'],
  };
}

const col = (c: string, k = 1) => new THREE.Color(c).multiplyScalar(k);
const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
const tex = (c: HTMLCanvasElement, rep = true) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
};

let ramp: THREE.DataTexture | null = null;
/** 3-step cel ramp shared by the NPG world and karts. */
export function toonRamp() {
  if (ramp) return ramp;
  ramp = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}
export const toonMat = (o: THREE.MeshToonMaterialParameters) => screentone(new THREE.MeshToonMaterial({ gradientMap: toonRamp(), ...o }));

/**
 * Manga screen-tone: a screen-space dot pattern printed into the shadow side of a toon material, like the halftone
 * shading on the NPG cards. Dots are drawn where the lit colour falls below the mid band.
 */
export function screentone<T extends THREE.Material>(m: T): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      {
        float lum = dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11));
        vec2 cell = fract(gl_FragCoord.xy / 7.0) - 0.5;
        float dot_ = 1.0 - smoothstep(0.22, 0.3, length(cell));
        float shade = smoothstep(0.62, 0.3, lum);
        gl_FragColor.rgb *= 1.0 - dot_ * shade * 0.42;
      }`,
    );
  };
  m.customProgramCacheKey = () => 'screentone';
  return m;
}

// ───────────── Sky ─────────────

/** Flat saturated sunset gradient, a big cartoon sun with rays. Clouds are real meshes (buildNpgProps). */
export function buildToonSky(p: TrackDef['palette']) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uZen: { value: col(p.zenith) }, uHor: { value: col(p.horizon) }, uGlow: { value: col(p.glow) }, uSun: { value: col(p.sun) } },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uGlow; uniform vec3 uSun;
      varying vec3 vD;
      void main(){
        vec3 d = normalize(vD);
        float h = d.y;
        // Posterised bands: cartoon, not photographic.
        float t = clamp(h, 0.0, 1.0);
        float b = floor(pow(t, 0.55) * 7.0) / 7.0;
        vec3 c = mix(uGlow, uHor, smoothstep(0.0, 0.25, b));
        c = mix(c, uZen, smoothstep(0.2, 0.9, b));
        c = mix(c, uHor * 0.9, smoothstep(0.0, -0.2, h));
        vec3 sd = normalize(vec3(-0.5, 0.12, 0.85));
        float a = dot(d, sd);
        // Sun disc with a black outline and stripes, rays fanned around it.
        float disc = step(0.9955, a);
        float ring = step(0.9945, a) - disc;
        float stripe = step(0.5, fract((d.y - sd.y) * 90.0)) * step(d.y, sd.y);
        vec3 sunC = mix(uSun, uGlow, stripe * 0.6);
        vec3 q = normalize(d - sd * a);
        float ang = atan(dot(q, normalize(cross(sd, vec3(0.0, 1.0, 0.0)))), q.y);
        float rays = step(0.5, fract(ang * 2.54)) * smoothstep(0.85, 0.99, a) * (1.0 - step(0.9945, a));
        c = mix(c, mix(c, uSun, 0.35), rays);
        c = mix(c, vec3(0.05), ring);
        c = mix(c, sunC * 1.15, disc);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

// ───────────── Track ─────────────

/** Cel deck: lilac asphalt, white centre dashes, chunky pink/white checker kerbs with a black edge. u = across. */
export function npgDeckTexture() {
  const S = 512;
  const c = canvas(S, S);
  const g = c.getContext('2d')!;
  g.fillStyle = '#5e5578';
  g.fillRect(0, 0, S, S);
  const R = rng(5);
  g.fillStyle = '#6c6388';
  for (let i = 0; i < 220; i++) g.fillRect(R() * S, R() * S, 3 + R() * 6, 3 + R() * 6);
  // Lane dashes.
  g.fillStyle = '#ffffff';
  for (const u of [0.335, 0.665]) g.fillRect(u * S - 4, 0, 8, S * 0.45);
  g.fillStyle = '#ffd93a';
  g.fillRect(S * 0.5 - 6, 0, 12, S);
  // Checker kerbs.
  const kw = S * 0.075;
  const rows = 4;
  for (const side of [0, 1]) {
    const x0 = side ? S - kw : 0;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < 2; k++) {
        g.fillStyle = (r + k) % 2 ? NPG_PINK : '#ffffff';
        g.fillRect(x0 + (k * kw) / 2, (r * S) / rows, kw / 2, S / rows);
      }
    }
    g.fillStyle = '#111111';
    g.fillRect(side ? S - kw - 8 : kw, 0, 8, S);
  }
  const t = tex(c);
  return t;
}

// ───────────── Boards ─────────────

/** Start banner: NINJA PUNK GIRLS / NPG RACING on a black band (white type). */
export function drawNpgBanner(c: HTMLCanvasElement, logoFont: string) {
  const g = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  g.fillStyle = '#111111';
  g.fillRect(0, 0, W, H);
  for (let x = -H; x < W; x += 48) {
    g.fillStyle = NPG_PINK;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + 24, 0);
    g.lineTo(x + 24 - 26, 26);
    g.lineTo(x - 26, 26);
    g.fill();
    g.fillStyle = NPG_CYAN;
    g.beginPath();
    g.moveTo(x, H - 26);
    g.lineTo(x + 24, H - 26);
    g.lineTo(x - 2, H);
    g.lineTo(x - 26, H);
    g.fill();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.font = `400 ${H * 0.2}px ${logoFont}, Impact, sans-serif`;
  g.fillText('NINJA PUNK GIRLS', W / 2, H * 0.36);
  g.font = `400 ${H * 0.34}px ${logoFont}, Impact, sans-serif`;
  g.fillStyle = NPG_PINK;
  g.fillText('NPG RACING', W / 2, H * 0.68);
}

/** Gantry sponsor strips for the NPG skin. */
export function npgSponsorTex(i: number) {
  const c = canvas(1024, 128);
  const g = c.getContext('2d')!;
  const set = [
    ['#ffffff', '#111111', 'NINJA PUNK GIRLS'],
    [NPG_PINK, '#ffffff', 'NPG RACING'],
    ['#111111', '#ffffff', 'NPG ✕ NPG ✕ NPG'],
    [NPG_CYAN, '#111111', 'PUNK NEVER DIES'],
    ['#e8261d', '#111111', 'EROBOTS: KEEP OUT'],
    ['#ffd93a', '#111111', 'PENNY RACING 1P'],
  ][i % 6];
  g.fillStyle = set[0];
  g.fillRect(0, 0, 1024, 128);
  g.fillStyle = set[1];
  g.font = 'italic 900 84px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(set[2], 512, 68);
  g.lineWidth = 10;
  g.strokeStyle = '#111111';
  g.strokeRect(5, 5, 1014, 118);
  return tex(c, false);
}

/** Hero card art bundled with the site (full NPG cards with the girls on them). */
const HERO_CARDS = [
  'card_0026_Miwako', 'card_0347_Tsuguri', 'card_0454_Junrei', 'card_0651_Atsuna', 'card_0754_Aoki', 'card_0834_Yuzumi', 'card_1082_Mutsuka',
  'card_1308_Miho', 'card_1499_Mizue', 'card_1794_Kiyomi', 'card_1936_Ayu', 'card_2190_Marise', 'card_2343_Makiho', 'card_2823_Kotoki', 'card_3008_Aiki',
].map((n) => `/arcade/npg-cards/heroes/${n}.jpg`);

/** Roadside billboards (2:1): NPG girl cards, the graffiti NPG tag, Erobot warnings. Card art streams in. */
export function npgSignTextures(count: number): THREE.CanvasTexture[] {
  const out: THREE.CanvasTexture[] = [];
  for (let i = 0; i < count; i++) {
    const c = canvas(1024, 512);
    const g = c.getContext('2d')!;
    const kind = i % 3;
    const t = tex(c, false);
    if (kind === 0) {
      // Card wall: three girls' cards on pink.
      g.fillStyle = i % 2 ? NPG_PINK : NPG_CYAN;
      g.fillRect(0, 0, 1024, 512);
      g.fillStyle = '#111';
      g.font = 'italic 900 70px Impact, "Arial Black", sans-serif';
      g.fillText('NPG', 40, 90);
      for (let k = 0; k < 3; k++) {
        const img = new Image();
        img.onload = () => {
          const x = 300 + k * 240;
          g.save();
          g.translate(x + 100, 256);
          g.rotate((k - 1) * 0.08);
          g.fillStyle = '#111';
          g.fillRect(-108, -158, 216, 316);
          g.drawImage(img, -100, -150, 200, 300);
          g.restore();
          t.needsUpdate = true;
        };
        img.src = HERO_CARDS[(i * 3 + k) % HERO_CARDS.length];
      }
    } else if (kind === 1) {
      // Graffiti wall: the NPG tag, always white on black or black on white.
      const inv = (i >> 1) % 2 === 0;
      g.fillStyle = inv ? '#111111' : '#ffffff';
      g.fillRect(0, 0, 1024, 512);
      const R = rng(i + 3);
      for (let k = 0; k < 18; k++) {
        g.fillStyle = [NPG_PINK, NPG_CYAN, '#ffd93a'][k % 3];
        g.globalAlpha = 0.8;
        g.beginPath();
        g.arc(R() * 1024, R() * 512, 10 + R() * 50, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      g.save();
      g.translate(512, 270);
      g.rotate(-0.1);
      g.font = 'italic 900 300px Impact, "Arial Black", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 22;
      g.strokeStyle = inv ? '#111111' : '#ffffff';
      g.fillStyle = inv ? '#ffffff' : '#111111';
      g.fillText('NPG', 0, 0);
      g.restore();
    } else {
      // Erobot warning.
      g.fillStyle = '#ffd93a';
      g.fillRect(0, 0, 1024, 512);
      g.fillStyle = '#111';
      for (let x = -512; x < 1024; x += 80) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + 40, 0);
        g.lineTo(x + 40 + 60, 60);
        g.lineTo(x + 60, 60);
        g.fill();
        g.beginPath();
        g.moveTo(x, 452);
        g.lineTo(x + 40, 452);
        g.lineTo(x + 100, 512);
        g.lineTo(x + 60, 512);
        g.fill();
      }
      g.fillStyle = '#e8261d';
      g.fillRect(40, 110, 944, 292);
      g.fillStyle = '#ffffff';
      g.font = 'italic 900 150px Impact, "Arial Black", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('EROBOTS', 512, 220);
      g.font = 'italic 900 70px Impact, "Arial Black", sans-serif';
      g.fillText('WILL BE SCRAPPED', 512, 335);
    }
    t.needsUpdate = true;
    out.push(t);
  }
  return out;
}

// ───────────── Scenery ─────────────

/** Puffy clouds, Erobot factories and grass, added on top of the toon-town buildings. */
export function buildNpgProps(tr: Track, own: Own, hi: boolean): THREE.Group {
  const group = new THREE.Group();
  const R = rng(tr.def.seed * 13 + 5);
  const bd = tr.bounds;
  const cx = (bd.minX + bd.maxX) / 2;
  const cz = (bd.minZ + bd.maxZ) / 2;
  const span = Math.max(bd.maxX - bd.minX, bd.maxZ - bd.minZ) / 2;
  const outline = own(new THREE.MeshBasicMaterial({ color: '#111111', side: THREE.BackSide }));
  // Clouds: clusters of fat spheres, cel-shaded white with a black outline.
  const puff = own(new THREE.IcosahedronGeometry(1, 2));
  const cloudMat = own(toonMat({ color: '#ffffff', emissive: col('#ffd6ec', 0.35), fog: false }));
  const nC = hi ? 46 : 22;
  const cm: THREE.Matrix4[] = [];
  for (let k = 0; k < nC; k++) {
    const a = R() * Math.PI * 2;
    const r = span + 300 + R() * 1400;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    const y = bd.maxY + 120 + R() * 380;
    const s = 40 + R() * 50;
    const blobs = 4 + Math.floor(R() * 4);
    for (let b = 0; b < blobs; b++) {
      const bs = s * (0.6 + R() * 0.6);
      cm.push(new THREE.Matrix4().compose(new THREE.Vector3(x + (b - blobs / 2) * s * 0.7, y + R() * s * 0.4, z + (R() - 0.5) * s), new THREE.Quaternion(), new THREE.Vector3(bs, bs * 0.8, bs)));
    }
  }
  const clouds = new THREE.InstancedMesh(puff, cloudMat, cm.length);
  const cloudsO = new THREE.InstancedMesh(puff, outline, cm.length);
  cm.forEach((m, i) => {
    clouds.setMatrixAt(i, m);
    cloudsO.setMatrixAt(i, m.clone().scale(new THREE.Vector3(1.06, 1.06, 1.06)));
  });
  clouds.frustumCulled = cloudsO.frustumCulled = false;
  group.add(clouds, cloudsO);
  // Erobot factories: grey sheds with red bands and smokestacks, out beyond the track.
  const shed = own(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const stack = own(new THREE.CylinderGeometry(0.5, 0.65, 1, 12).translate(0, 0.5, 0));
  const shedMat = own(toonMat({ color: '#8d939c' }));
  const redMat = own(toonMat({ color: '#e8261d' }));
  const smokeMat = own(toonMat({ color: '#d9d4e2', transparent: true, opacity: 0.85 }));
  const f = newFrame();
  const sheds: THREE.Matrix4[] = [];
  const bands: THREE.Matrix4[] = [];
  const stacks: THREE.Matrix4[] = [];
  const smoke: THREE.Matrix4[] = [];
  const nF = hi ? 10 : 5;
  for (let k = 0; k < nF; k++) {
    frameAt(tr, ((k + 0.3) / nF) * tr.len, f);
    const side = k % 2 ? 1 : -1;
    const off = HALF_W + 140 + R() * 120;
    const x = f.px + f.rx * side * off;
    const z = f.pz + f.rz * side * off;
    const w = 70 + R() * 50;
    const d = 50 + R() * 40;
    const h = 40 + R() * 30;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(f.tx, f.tz));
    sheds.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(w, h, d)));
    bands.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h * 0.62, z), q, new THREE.Vector3(w + 1, h * 0.14, d + 1)));
    for (let s = 0; s < 3; s++) {
      const sx = x + (s - 1) * w * 0.3;
      const sh = h + 40 + R() * 50;
      stacks.push(new THREE.Matrix4().compose(new THREE.Vector3(sx, 0, z), new THREE.Quaternion(), new THREE.Vector3(9, sh, 9)));
      for (let p = 0; p < 3; p++) smoke.push(new THREE.Matrix4().compose(new THREE.Vector3(sx + p * 6, sh + 8 + p * 14, z), new THREE.Quaternion(), new THREE.Vector3(9 + p * 5, 8 + p * 4, 9 + p * 5)));
    }
  }
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], line = true) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.frustumCulled = false;
    group.add(im);
    if (line) {
      const o = new THREE.InstancedMesh(geo, outline, list.length);
      list.forEach((m, i) => o.setMatrixAt(i, m.clone().multiply(new THREE.Matrix4().makeScale(1.03, 1.02, 1.03))));
      o.frustumCulled = false;
      group.add(o);
    }
  };
  inst(shed, shedMat, sheds);
  inst(shed, redMat, bands, false);
  inst(stack, shedMat, stacks);
  inst(puff, smokeMat, smoke, false);
  return group;
}

/** Toy-town building material: flat cel colour per instance (instanceColor), no glowing windows. */
export function npgBuildingMat() {
  return toonMat({ color: '#ffffff' });
}
export const NPG_BUILDING_TINTS = ['#ff8cc6', '#7fe8ff', '#ffe27a', '#b9a4ff', '#ffffff', '#ff6f6f'].map((c) => new THREE.Color(c));
