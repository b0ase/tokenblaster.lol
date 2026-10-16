/**
 * White theme ("ink") for bRacer: the scene renders as usual, then one post pass turns it into
 * white / light-grey surfaces with black linework (depth + luminance edges). Gameplay is untouched.
 * bWalletX opens the game with ?theme=white when the wallet is in its White theme.
 */
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export type BRacerTheme = 'default' | 'white';

export const parseTheme = (v: string | null | undefined): BRacerTheme => (v === 'white' ? 'white' : 'default');

/** Every colour the white post pass uses, in one place (linear RGB, 0..1). */
export const INK = {
  paper: [1, 1, 1],
  /** Fill for strongly coloured things: ships, team colours, pickups, pads. */
  tone1: [0.86, 0.86, 0.86],
  /** Fill for dark / shadowed surfaces. */
  tone2: [0.93, 0.93, 0.93],
  /** Fill for very saturated *and* bright things (glowing pickups, boost pads, weapons fire). */
  tone3: [0.62, 0.62, 0.62],
  line: [0, 0, 0],
} as const;

const v3 = (c: readonly number[]) => new THREE.Vector3(c[0], c[1], c[2]);

const INK_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uLineW: { value: 1 },
    uNear: { value: 0.3 },
    uFar: { value: 5200 },
    uPaper: { value: v3(INK.paper) },
    uTone1: { value: v3(INK.tone1) },
    uTone2: { value: v3(INK.tone2) },
    uTone3: { value: v3(INK.tone3) },
    uLine: { value: v3(INK.line) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D tDepth;
    uniform vec2 uTexel; uniform float uLineW; uniform float uNear; uniform float uFar;
    uniform vec3 uPaper; uniform vec3 uTone1; uniform vec3 uTone2; uniform vec3 uTone3; uniform vec3 uLine;
    varying vec2 vUv;
    float linZ(vec2 uv){
      float d = texture2D(tDepth, uv).x;
      return (uNear * uFar) / (uFar - d * (uFar - uNear));
    }
    float lum(vec2 uv){
      vec3 c = texture2D(tDiffuse, uv).rgb;
      c = c / (1.0 + c);
      return dot(c, vec3(0.299, 0.587, 0.114));
    }
    void main(){
      vec2 o = uTexel * uLineW;
      float raw = texture2D(tDepth, vUv).x;
      float z = linZ(vUv);
      // Depth edges (silhouettes, creases between objects): relative to distance so far things still outline.
      float zl = linZ(vUv - vec2(o.x, 0.0)), zr = linZ(vUv + vec2(o.x, 0.0));
      float zd = linZ(vUv - vec2(0.0, o.y)), zu = linZ(vUv + vec2(0.0, o.y));
      float dz = abs(zl + zr - 2.0 * z) + abs(zd + zu - 2.0 * z);
      float eDepth = smoothstep(0.012, 0.03, dz / z);
      // Close objects (ships, pickups) get a second, wider silhouette sample: bolder outlines up close.
      vec2 o2 = o * 2.0;
      float zl2 = linZ(vUv - vec2(o2.x, 0.0)), zr2 = linZ(vUv + vec2(o2.x, 0.0));
      float zd2 = linZ(vUv - vec2(0.0, o2.y)), zu2 = linZ(vUv + vec2(0.0, o2.y));
      float dz2 = max(max(abs(zl2 - z), abs(zr2 - z)), max(abs(zd2 - z), abs(zu2 - z)));
      eDepth = max(eDepth, smoothstep(0.08, 0.2, dz2 / z) * smoothstep(60.0, 25.0, z));
      // Luminance edges (panel lines, markings, ship liveries) via Sobel.
      float l00 = lum(vUv + vec2(-o.x, -o.y)), l10 = lum(vUv + vec2(0.0, -o.y)), l20 = lum(vUv + vec2(o.x, -o.y));
      float l01 = lum(vUv + vec2(-o.x, 0.0)), l21 = lum(vUv + vec2(o.x, 0.0));
      float l02 = lum(vUv + vec2(-o.x, o.y)), l12 = lum(vUv + vec2(0.0, o.y)), l22 = lum(vUv + vec2(o.x, o.y));
      float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
      float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
      float eLum = smoothstep(0.16, 0.34, length(vec2(gx, gy)));
      // Lines fade with distance so the horizon doesn't turn into a black scribble.
      float near = exp(-z * 0.0022);
      float sky = step(0.99999, raw);
      float edge = max(eDepth * (1.0 - sky), eLum * (1.0 - sky * 0.85)) * mix(0.25, 1.0, near);
      // Fill: three light tones from the original colour, so coloured things read as grey shapes.
      vec3 c = texture2D(tDiffuse, vUv).rgb; c = c / (1.0 + c);
      float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
      float sat = mx > 0.001 ? (mx - mn) / mx : 0.0;
      float L = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 fill = uPaper;
      fill = mix(fill, uTone2, smoothstep(0.10, 0.03, L) * (1.0 - sky));
      fill = mix(fill, uTone1, smoothstep(0.35, 0.6, sat) * smoothstep(0.08, 0.2, mx));
      fill = mix(fill, uTone3, smoothstep(0.55, 0.8, sat) * smoothstep(0.45, 0.7, mx));
      fill = mix(uPaper, fill, mix(0.35, 1.0, near));
      gl_FragColor = vec4(mix(fill, uLine, edge), 1.0);
    }`,
};

/** The ink pass. Needs the composer's render targets to carry a DepthTexture. */
export class InkPass extends ShaderPass {
  constructor(camera: THREE.PerspectiveCamera) {
    super(INK_SHADER);
    this.uniforms.uNear.value = camera.near;
    this.uniforms.uFar.value = camera.far;
  }
  setSize(w: number, h: number) {
    this.uniforms.uTexel.value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
    this.uniforms.uLineW.value = Math.max(1, Math.round(h / 720));
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}
