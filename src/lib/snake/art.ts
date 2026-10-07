/**
 * Token Snake art: the arena floor / energy walls / sky / skyline shaders, canvas textures (block labels, power-up
 * labels, glow sprites) and the neon environment map. House look = the Designers Republic-style language of bRacer:
 * ink black, cyan / magenta / acid / amber, hazard stripes, chevrons, katakana.
 */
import * as THREE from 'three';

export const PAL = {
  ink: 0x07070b,
  cyan: 0x27e6ff,
  magenta: 0xff2f92,
  acid: 0xc8ff1a,
  amber: 0xffb800,
  signal: 0xe8261d,
  blue: 0x2a5bff,
  gold: 0xffcf4a,
} as const;

export type Fonts = { display: string; mono: string; jp: string };
export const DEFAULT_FONTS: Fonts = { display: 'Impact, "Arial Black", sans-serif', mono: 'ui-monospace, Menlo, monospace', jp: 'sans-serif' };

const cv = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** Soft radial glow sprite (white; tint with material colour). */
export function glowTexture() {
  const c = cv(128, 128);
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A DR-style label plate for a block monolith: hazard bar, big block number, tx count. */
export function blockLabel(label: string, sub: string, f: Fonts) {
  const c = cv(256, 256);
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a0a10';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#ffb800';
  g.fillRect(0, 0, 256, 14);
  g.fillStyle = '#0a0a10';
  for (let x = -20; x < 280; x += 28) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + 14, 0);
    g.lineTo(x - 2, 14);
    g.lineTo(x - 16, 14);
    g.fill();
  }
  g.textAlign = 'center';
  g.fillStyle = '#f2efe6';
  g.font = `900 italic 60px ${f.display}`;
  g.textBaseline = 'middle';
  g.fillText(label, 128, 118, 236);
  g.fillStyle = '#27e6ff';
  g.font = `700 24px ${f.mono}`;
  g.fillText(sub, 128, 178, 236);
  g.strokeStyle = '#ffb800';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 250, 250);
  g.fillStyle = '#ffb800';
  g.fillRect(0, 236, 256, 20);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Floating tag above a power-up. */
export function tagTexture(text: string, colour: string, f: Fonts) {
  const c = cv(256, 64);
  const g = c.getContext('2d')!;
  g.fillStyle = colour;
  g.fillRect(6, 8, 244, 48);
  g.fillStyle = '#0a0a10';
  g.font = `900 italic 40px ${f.display}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 34, 228);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Token coin face: the token icon (or its symbol) on dark gold. `img` may still be loading; call again when it lands. */
export function coinFace(img: HTMLImageElement | null, sym: string, f: Fonts, into?: THREE.CanvasTexture) {
  const c = into ? (into.image as HTMLCanvasElement) : cv(128, 128);
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = '#2a1a04';
  g.beginPath();
  g.arc(64, 64, 64, 0, Math.PI * 2);
  g.fill();
  let drawn = false;
  if (img?.complete && img.naturalWidth) {
    try {
      g.save();
      g.beginPath();
      g.arc(64, 64, 58, 0, Math.PI * 2);
      g.clip();
      g.drawImage(img, 6, 6, 116, 116);
      g.restore();
      drawn = true;
    } catch {
      /* tainted or broken icon: fall back to the symbol */
    }
  }
  if (!drawn) {
    g.fillStyle = '#ffd36a';
    g.font = `900 italic 52px ${f.display}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(sym.slice(0, 4).toUpperCase(), 64, 68, 104);
  }
  if (into) {
    into.needsUpdate = true;
    return into;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Far-away billboard poster: the game name in the house type, hazard bars, katakana. */
export function posterTexture(f: Fonts) {
  const c = cv(1024, 384);
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 1024, 384);
  const bar = (y: number) => {
    g.fillStyle = '#ffb800';
    g.fillRect(0, y, 1024, 26);
    g.fillStyle = '#07070b';
    for (let x = -40; x < 1060; x += 56) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 28, y);
      g.lineTo(x + 4, y + 26);
      g.lineTo(x - 24, y + 26);
      g.fill();
    }
  };
  bar(0);
  bar(358);
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.fillStyle = '#f2efe6';
  g.font = `900 italic 214px ${f.display}`;
  g.fillText('TOKEN', 30, 232);
  g.fillStyle = '#c8ff1a';
  g.fillText('SNAKE', 440, 232);
  g.fillStyle = '#27e6ff';
  g.font = `900 48px ${f.jp}`;
  g.fillText('トークン・スネーク', 36, 318);
  g.fillStyle = '#ff2f92';
  g.font = `700 30px ${f.mono}`;
  g.textAlign = 'right';
  g.fillText('EAT THE CHAIN / TB-SNK-003', 996, 318);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A small studio of neon panels, baked to an environment map so the glossy snake picks up cyan / magenta / amber streaks. */
export function neonEnvironment(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05050a);
  const panel = (w: number, h: number, col: number, intensity: number, pos: [number, number, number], look: [number, number, number] = [0, 0, 0]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(...look);
    scene.add(m);
  };
  panel(14, 6, PAL.cyan, 5, [-12, 6, 2]);
  panel(14, 6, PAL.magenta, 4.5, [12, 5, -4]);
  panel(30, 3, 0xffffff, 3.5, [0, 14, 0]);
  panel(10, 10, PAL.amber, 3, [0, 4, -16]);
  panel(18, 2, PAL.acid, 2, [0, 3, 14]);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.04);
  pm.dispose();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  return rt.texture;
}

// ───────────── Shaders ─────────────

export function floorMaterial(n: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uHead: { value: new THREE.Vector2() },
      uN: { value: n },
      uBeat: { value: 0 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uRip: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -1, 0)) },
      uRipCol: { value: Array.from({ length: 6 }, () => new THREE.Color()) },
      uFog: { value: new THREE.Color(0x07070b) },
    },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime; uniform vec2 uHead; uniform float uN; uniform float uBeat; uniform vec3 uTint; uniform vec3 uFog;
      uniform vec4 uRip[6]; uniform vec3 uRipCol[6];
      varying vec3 vW;
      float grid(vec2 p, float w){ vec2 g = abs(fract(p - 0.5) - 0.5) / max(fwidth(p), vec2(1e-4)); return 1.0 - clamp(min(g.x, g.y) / w, 0.0, 1.0); }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec2 p = vW.xz + uN * 0.5;
        float inside = step(0.0, p.x) * step(p.x, uN) * step(0.0, p.y) * step(p.y, uN);
        vec2 ci = floor(p);
        float chk = mod(ci.x + ci.y, 2.0);
        vec3 col = mix(vec3(0.010, 0.012, 0.026), vec3(0.020, 0.026, 0.062), inside);
        col += inside * (chk * 0.010 + (hash(ci) - 0.5) * 0.006);
        float g1 = grid(p, 1.0);
        float g4 = grid(p / 4.0, 1.4);
        vec3 lineA = vec3(0.14, 0.36, 1.0) * uTint;
        vec3 lineB = vec3(0.15, 0.9, 1.0) * uTint;
        col += inside * (g1 * lineA * (0.13 + uBeat * 0.2) + g4 * lineB * (0.32 + uBeat * 0.5));
        // Outside the arena: a sparse far grid that fades into the dark.
        float dOut = max(max(-p.x, p.x - uN), max(-p.y, p.y - uN));
        float fadeOut = exp(-max(dOut, 0.0) * 0.045);
        col += (1.0 - inside) * (grid(p / 4.0, 1.0) * vec3(0.55, 0.10, 0.38) * 0.30 * fadeOut + grid(p / 16.0, 1.2) * vec3(0.1, 0.5, 0.9) * 0.22 * fadeOut);
        // Hazard strip along the inside edge.
        float eIn = min(min(p.x, uN - p.x), min(p.y, uN - p.y));
        float strip = inside * step(0.0, eIn) * (1.0 - step(0.5, eIn));
        float diag = step(0.5, fract((p.x + p.y) * 1.2));
        col = mix(col, mix(vec3(0.03, 0.03, 0.035), vec3(1.0, 0.68, 0.0), diag) * 0.55, strip);
        float rail = inside * smoothstep(0.55, 0.5, eIn) * smoothstep(0.44, 0.5, eIn);
        col += rail * vec3(1.0, 0.7, 0.1) * 0.9;
        // Light pool under the snake.
        float dh = length(vW.xz - uHead);
        col += vec3(0.05, 0.22, 0.4) * exp(-dh * dh * 0.04) * 0.45 * (0.5 + 0.5 * inside);
        // Transaction ripples.
        for (int i = 0; i < 6; i++) {
          float age = uRip[i].z;
          if (age >= 0.0) {
            float d = length(vW.xz - uRip[i].xy);
            float r = age * 15.0;
            float w = exp(-pow((d - r) * 2.1, 2.0)) * (1.0 - age / 1.7) * uRip[i].w;
            col += uRipCol[i] * w * 1.0;
          }
        }
        float far = length(vW.xz);
        col = mix(col, uFog, smoothstep(55.0, 170.0, far));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/** The four energy walls: scrolling chevrons, brighter as the head nears. */
export function wallMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uHead: { value: new THREE.Vector2() }, uCol: { value: new THREE.Color(PAL.magenta) }, uLen: { value: 28 } },
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec2 uHead; uniform vec3 uCol; uniform float uLen;
      varying vec2 vUv; varying vec3 vW;
      void main(){
        float h = vUv.y;
        float base = pow(1.0 - h, 2.2);
        float chev = smoothstep(0.35, 0.5, abs(fract(vUv.x * uLen * 0.5 - uTime * 0.35 + h * 0.9) - 0.5));
        float near = exp(-length(vec2(vW.x, vW.z) - uHead) * 0.22);
        float a = base * (0.16 + chev * 0.25) + near * base * 0.9;
        float rail = smoothstep(0.93, 0.99, h) * 0.9;
        vec3 col = uCol * (a * 1.8) + vec3(1.0, 0.7, 0.12) * rail;
        gl_FragColor = vec4(col, clamp(a + rail, 0.0, 1.0));
      }`,
  });
}

export function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir; uniform float uTime;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 top = vec3(0.012, 0.010, 0.040);
        vec3 mid = vec3(0.10, 0.02, 0.16);
        vec3 hor = vec3(0.55, 0.05, 0.22);
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, top, smoothstep(0.18, 0.8, h));
        col += vec3(0.05, 0.25, 0.4) * exp(-abs(vDir.x + 0.1) * 5.0) * smoothstep(0.35, 0.0, h) * 0.5;
        vec3 s = floor(vDir * 160.0);
        float star = step(0.9965, hash(s)) * smoothstep(0.1, 0.5, h);
        col += star * (0.5 + 0.5 * sin(uTime * 2.0 + hash(s + 3.0) * 20.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/** Distant megastructure towers with procedurally lit windows (instanced; per-instance tint). */
export function towerMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFog: { value: new THREE.Color(0x07070b) } },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying vec3 vS;
      void main(){
        mat4 im = instanceMatrix;
        vec4 w = modelMatrix * im * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix * im) * normal);
        vTint = instanceColor;
        vS = vec3(length(im[0].xyz), length(im[1].xyz), length(im[2].xyz));
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uFog;
      varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying vec3 vS;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec2 uv = vec2(vW.x + vW.z, vW.y);
        vec2 cell = floor(uv * vec2(0.9, 0.5));
        vec2 f = fract(uv * vec2(0.9, 0.5));
        float win = step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.7);
        float on = step(0.62, hash(cell + floor(vS.xy)));
        float flick = 0.75 + 0.25 * sin(uTime * 1.5 + hash(cell) * 30.0);
        float top = smoothstep(0.7, 1.0, abs(vN.y));
        vec3 col = vec3(0.012, 0.012, 0.03) + vTint * win * on * flick * 1.1 * (1.0 - top);
        col += vTint * 0.10 * smoothstep(0.0, 40.0, vW.y);
        col += vTint * top * 0.6;
        float far = length(vW.xz);
        col = mix(col, uFog, smoothstep(60.0, 150.0, far) * 0.75);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/** Soft point-sprite particles with per-particle size and colour (additive). */
export function particleMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uPx: { value: 600 } },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute vec4 aCol; varying vec4 vCol; uniform float uPx;
      void main(){
        vCol = aCol;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * uPx / max(-mv.z, 0.1), 0.0, 220.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec4 vCol;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d);
        a = a * a;
        gl_FragColor = vec4(vCol.rgb * a * vCol.a, 1.0);
      }`,
  });
}
