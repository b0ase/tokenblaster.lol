/**
 * Custom materials for the NEO-TOKYO set. Everything animates on the GPU from one `uT` clock, so the
 * per-frame CPU cost of rain, signs, ripples, steam, mist and holograms is a handful of uniform writes.
 * Additive effects do their own distance fade (three's fog would brighten them toward the fog colour).
 */
import * as THREE from 'three';

export type Shared = { uT: { value: number }; uFog: { value: number }; uFogColor: { value: THREE.Color }; uPx: { value: number } };

export function makeShared(fog: THREE.FogExp2): Shared {
  return { uT: { value: 0 }, uFog: { value: fog.density }, uFogColor: { value: new THREE.Color(fog.color) }, uPx: { value: 700 } };
}

const FADE = /* glsl */ `float fadeAt(float d, float u){ return exp(-u*u*d*d*0.6); }`;

/** Vertical blade signs: instanced, per-instance atlas rect and animation mode (steady, buzz, blink, chase). */
export function signMaterial(map: THREE.Texture, sh: Shared) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uMap: { value: map }, uT: sh.uT, uFog: sh.uFog, uFogColor: sh.uFogColor },
    vertexShader: /* glsl */ `
      attribute vec4 aRect; attribute vec3 aAnim;
      varying vec2 vUv; varying vec3 vAnim; varying float vD;
      void main(){
        vUv = aRect.xy + uv * aRect.zw; vAnim = aAnim;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vD = -mv.z; gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform float uT, uFog; uniform vec3 uFogColor;
      varying vec2 vUv; varying vec3 vAnim; varying float vD;
      float h(float n){ return fract(sin(n * 91.345) * 47453.5453); }
      void main(){
        vec3 c = texture2D(uMap, vUv).rgb;
        float m = vAnim.y, ph = vAnim.x;
        float f = 1.0;
        if (m > 0.5 && m < 1.5) f = 0.55 + 0.45 * step(0.12, h(floor(uT * 11.0 + ph * 40.0)));        // buzz
        else if (m > 1.5 && m < 2.5) f = 0.2 + 0.8 * step(0.5, fract(uT * vAnim.z + ph));                 // blink
        else if (m > 2.5 && m < 3.5) f = 0.45 + 0.55 * smoothstep(-0.2, 0.9, sin(vUv.y * 60.0 - uT * 6.0 * vAnim.z + ph * 6.28)); // chase
        else if (m > 3.5) f = mix(1.0, 0.1, step(0.93, h(floor(uT * 3.0 + ph * 20.0))));                   // dying tube
        c *= f * 1.9;
        float fog = 1.0 - exp(-uFog * uFog * vD * vD);
        c = mix(c, uFogColor * 0.6, fog * 0.75);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/** Holographic billboard: additive, scanlines, RGB split, glitch bands, shimmer. */
export function holoAdMaterial(map: THREE.Texture, rect: readonly number[], sh: Shared, tint: string, phase: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uMap: { value: map }, uRect: { value: new THREE.Vector4(...rect) }, uT: sh.uT, uFog: sh.uFog, uTint: { value: new THREE.Color(tint) }, uPh: { value: phase } },
    vertexShader: 'varying vec2 vUv; varying float vD; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.); vD = -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform vec4 uRect; uniform float uT, uFog, uPh; uniform vec3 uTint;
      varying vec2 vUv; varying float vD;
      float h(float n){ return fract(sin(n * 91.345) * 47453.5453); }
      ${FADE}
      void main(){
        float band = step(0.965, h(floor(vUv.y * 24.0) + floor(uT * 7.0 + uPh * 9.0)));
        float sh = band * (h(floor(uT * 7.0) + vUv.y * 24.0) - 0.5) * 0.12;
        vec2 uv = uRect.xy + vec2(vUv.x + sh, vUv.y) * uRect.zw;
        float s = 0.0035;
        vec3 c = vec3(texture2D(uMap, uv + vec2(s, 0.0)).r, texture2D(uMap, uv).g, texture2D(uMap, uv - vec2(s, 0.0)).b);
        c *= uTint;
        float scan = 0.72 + 0.28 * sin(vUv.y * 420.0 + uT * 8.0);
        float sweep = 0.75 + 0.5 * smoothstep(0.0, 0.1, abs(fract(vUv.y * 0.6 - uT * 0.18 + uPh) - 0.5) - 0.4);
        float flick = 0.85 + 0.15 * step(0.1, h(floor(uT * 13.0 + uPh * 31.0)));
        float edge = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x) * smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.95, vUv.y);
        gl_FragColor = vec4(c * scan * sweep * flick * edge * 1.7 * fadeAt(vD, uFog), 1.0);
      }`,
  });
}

/** Giant hologram figure: fresnel rim, climbing scan bands, glitch displacement. */
export function holoFigureMaterial(sh: Shared, a: string, b: string) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uT: sh.uT, uFog: sh.uFog, uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) } },
    vertexShader: /* glsl */ `
      uniform float uT; varying vec3 vN; varying vec3 vV; varying float vY; varying float vD;
      float h(float n){ return fract(sin(n * 91.345) * 47453.5453); }
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float g = step(0.985, h(floor(wp.y * 0.9) + floor(uT * 6.0)));
        wp.x += g * (h(floor(uT * 6.0) + wp.y) - 0.5) * 2.2;
        vec4 mv = viewMatrix * wp;
        vN = normalize(mat3(viewMatrix) * mat3(modelMatrix) * normal); vV = -mv.xyz; vY = wp.y; vD = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uT, uFog; uniform vec3 uA, uB; varying vec3 vN; varying vec3 vV; varying float vY; varying float vD;
      ${FADE}
      void main(){
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(f, 1.6);
        float bands = 0.55 + 0.45 * sin(vY * 3.2 - uT * 2.4);
        float fine = 0.7 + 0.3 * sin(vY * 38.0 + uT * 14.0);
        float climb = smoothstep(0.92, 1.0, sin(vY * 0.35 - uT * 1.1));
        vec3 c = mix(uA, uB, clamp(vY * 0.018 - 0.2 + 0.25 * sin(uT * 0.5), 0.0, 1.0));
        float k = (0.12 + rim * 1.15) * bands * fine + climb * 0.9;
        gl_FragColor = vec4(c * k * 3.0 * fadeAt(vD, uFog * 0.5), 1.0);
      }`,
  });
}

/** Soft volumetric light cone (searchlights, street lamps). axial: power of brightness along the cone. */
export function beamMaterial(color: string, k: number, axialPow: number, invertAxis: boolean, sh: Shared) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uC: { value: new THREE.Color(color) }, uK: { value: k }, uP: { value: axialPow }, uInv: { value: invertAxis ? 1 : 0 }, uT: sh.uT, uFog: sh.uFog },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying float vY; varying float vD; varying vec3 vW;
      void main(){
        #ifdef USE_INSTANCING
          mat4 im = instanceMatrix;
        #else
          mat4 im = mat4(1.0);
        #endif
        vec4 wp = modelMatrix * im * vec4(position, 1.0);
        vec4 mv = viewMatrix * wp;
        vN = normalize(mat3(viewMatrix) * mat3(modelMatrix) * mat3(im) * normal); vV = -mv.xyz; vY = uv.y; vD = -mv.z; vW = wp.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uC; uniform float uK, uP, uInv, uT, uFog; varying vec3 vN; varying vec3 vV; varying float vY; varying float vD; varying vec3 vW;
      ${FADE}
      void main(){
        float f = abs(dot(normalize(vN), normalize(vV)));
        float ax = pow(clamp(mix(vY, 1.0 - vY, uInv), 0.0, 1.0), uP);
        float dust = 0.82 + 0.18 * sin(vW.y * 0.7 + vW.x * 0.3 + uT * 0.8) * sin(vW.z * 0.4 - uT * 0.5);
        float edge = smoothstep(0.0, 0.7, f);
        float near = smoothstep(0.4, 3.0, vD);
        gl_FragColor = vec4(uC * uK * pow(f, 1.4) * edge * ax * dust * near * fadeAt(vD, uFog * 0.7), 1.0);
      }`,
  });
}

/** Rain: streaks fall and wrap entirely in the vertex shader. aEnd 0 = head, 1 = tail. */
export function rainMaterial(sh: Shared, color: string) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uT: sh.uT, uFog: sh.uFog, uC: { value: new THREE.Color(color) } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; attribute float aEnd; uniform float uT;
      varying float vA; varying float vD;
      void main(){
        float speed = 26.0 + aSeed.w * 14.0;
        float y = mod(position.y - uT * speed, 38.0);
        vec3 p = vec3(position.x + y * 0.04, y, position.z);
        float len = 0.55 + aSeed.w * 0.7;
        p.y += aEnd * len; p.x -= aEnd * len * 0.04;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vD = -mv.z;
        vA = (1.0 - aEnd * 0.85) * smoothstep(0.0, 1.5, p.y) * smoothstep(1.0, 4.0, vD);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: 'uniform vec3 uC; uniform float uFog; varying float vA; varying float vD; void main(){ gl_FragColor = vec4(uC * vA * 0.5 * exp(-uFog*uFog*vD*vD*0.5), 1.0); }',
  });
}

/** Ring ripples on the wet street. Instanced flat planes, per-instance phase/rate. */
export function rippleMaterial(map: THREE.Texture, sh: Shared) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uMap: { value: map }, uT: sh.uT, uFog: sh.uFog },
    vertexShader: /* glsl */ `
      attribute vec2 aPh; uniform float uT; varying vec2 vUv; varying float vL; varying float vD;
      void main(){
        float life = fract(uT * aPh.y + aPh.x);
        vL = life; vUv = uv;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position * (0.08 + life * 0.55), 1.0);
        vD = -mv.z; gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: 'uniform sampler2D uMap; uniform float uFog; varying vec2 vUv; varying float vL; varying float vD; void main(){ float a = texture2D(uMap, vUv).r * pow(1.0 - vL, 2.0) * smoothstep(0.0, 0.08, vL); gl_FragColor = vec4(vec3(0.55, 0.7, 1.0) * a * 0.55 * exp(-uFog*uFog*vD*vD*0.6), 1.0); }',
  });
}

/** Glow points (lanterns, bulbs, aircraft lights, neon glints): size is in metres, attenuated by distance. */
export function glowMaterial(map: THREE.Texture, sh: Shared) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uMap: { value: map }, uT: sh.uT, uFog: sh.uFog, uPx: sh.uPx },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aSize; attribute vec2 aPh;
      uniform float uT, uPx, uFog; varying vec3 vC; varying float vK;
      float h(float n){ return fract(sin(n * 91.345) * 47453.5453); }
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = max(0.5, -mv.z);
        float m = aPh.y, k = 1.0;
        if (m > 0.5 && m < 1.5) k = step(0.6, fract(uT * 0.55 + aPh.x));              // aircraft beacon
        else if (m > 1.5 && m < 2.5) k = 0.65 + 0.35 * step(0.15, h(floor(uT * 9.0 + aPh.x * 50.0))); // flicker
        else if (m > 2.5) k = 0.75 + 0.25 * sin(uT * 1.7 + aPh.x * 6.28);              // lantern sway
        vC = aColor; vK = k * exp(-uFog * uFog * d * d * 0.35) * smoothstep(3.0, 14.0, d) * 0.8;
        gl_PointSize = clamp(aSize * uPx / d, 1.5, 96.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: 'uniform sampler2D uMap; varying vec3 vC; varying float vK; void main(){ float a = texture2D(uMap, gl_PointCoord).r; gl_FragColor = vec4(vC * a * vK, 1.0); }',
  });
}

/** Steam plumes: cheap rising soft puffs. */
export function steamMaterial(map: THREE.Texture, sh: Shared) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uMap: { value: map }, uT: sh.uT, uFog: sh.uFog, uPx: sh.uPx, uC: { value: new THREE.Color('#9a8cc0') } },
    vertexShader: /* glsl */ `
      attribute vec3 aVent; attribute vec2 aSeed; uniform float uT, uPx, uFog; varying float vA; varying vec3 vWp;
      void main(){
        float life = fract(uT * (0.18 + aSeed.y * 0.12) + aSeed.x);
        vec3 p = aVent + vec3(sin(aSeed.x * 40.0 + life * 3.0) * life * 1.1, life * 5.0, cos(aSeed.x * 23.0) * life * 0.8);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = max(0.5, -mv.z);
        vA = sin(life * 3.14159) * 0.09 * exp(-uFog * uFog * d * d * 0.5); vWp = p;
        gl_PointSize = clamp((0.9 + life * 3.6) * uPx / d, 1.0, 140.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: 'uniform sampler2D uMap; uniform vec3 uC; varying float vA; varying vec3 vWp; void main(){ float a = texture2D(uMap, gl_PointCoord).r; vec3 tint = uC + vec3(0.25, 0.05, 0.2) * smoothstep(-2.0, 2.0, vWp.x) ; gl_FragColor = vec4(tint * 0.7, a * vA); }',
  });
}

/** Low-lying mist bank: drifting fbm alpha, fades near the camera. */
export function mistMaterial(sh: Shared, color: string, strength: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uT: sh.uT, uC: { value: new THREE.Color(color) }, uK: { value: strength } },
    vertexShader: 'varying vec2 vUv; varying float vD; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.); vD = -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: /* glsl */ `
      uniform float uT, uK; uniform vec3 uC; varying vec2 vUv; varying float vD;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec2 p = vUv * vec2(7.0, 2.0) + vec2(uT * 0.03, uT * 0.01);
        float n = vn(p) * 0.6 + vn(p * 2.3 + 7.0) * 0.3 + vn(p * 5.1) * 0.1;
        float a = smoothstep(0.35, 0.85, n) * smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.45, vUv.y) * smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        a *= smoothstep(10.0, 34.0, vD);
        gl_FragColor = vec4(uC, a * uK);
      }`,
  });
}

export type GroundUniforms = { tReflect: { value: THREE.Texture | null }; uReflMat: { value: THREE.Matrix4 }; uReflOn: { value: number }; uT: { value: number }; uWet: { value: number } };

/**
 * Wet asphalt: patches a MeshStandardMaterial with procedural puddles (mirror-smooth, darker, flat normal)
 * and, on High, a planar reflection sampled with ripple distortion and a roughness-driven blur.
 */
export function patchWetGround(mat: THREE.MeshStandardMaterial, u: GroundUniforms) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec4 vRc; uniform mat4 uReflMat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvec4 wpp = modelMatrix * vec4(transformed, 1.0); vWp = wpp.xyz; vRc = uReflMat * wpp;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vWp; varying vec4 vRc; uniform sampler2D tReflect; uniform float uReflOn, uT, uWet;
        float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float gn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(gh(i),gh(i+vec2(1,0)),f.x), mix(gh(i+vec2(0,1)),gh(i+vec2(1,1)),f.x), f.y); }
        float gf(vec2 p){ return gn(p)*0.55 + gn(p*2.1+3.7)*0.3 + gn(p*4.7+1.3)*0.15; }
        float puddleAt(vec3 w){
          float n = gf(w.xz * 0.16 + 4.0);
          float lane = smoothstep(14.0, 4.0, abs(w.x)) * 0.12; // the middle of the street dries slightly less
          return smoothstep(0.5 - lane, 0.62 - lane, n) * uWet;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        float puddle = puddleAt(vWp);
        roughnessFactor = mix(roughnessFactor * 0.8, 0.025, puddle);
        diffuseColor.rgb *= mix(1.0, 0.4, puddle);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = normalize(mix(normal, nonPerturbedNormal, puddle));`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        {
          vec3 vd = normalize(vViewPosition);
          float ndv = clamp(dot(normal, vd), 0.0, 1.0);
          float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
          if (uReflOn > 0.5) {
            vec2 ruv = vRc.xy / vRc.w;
            vec2 wob = (vec2(gn(vWp.xz * 3.1 + uT * 0.6), gn(vWp.xz * 3.1 + 9.0 - uT * 0.5)) - 0.5) * (0.004 + puddle * 0.003);
            ruv += wob + normal.xz * 0.0;
            float blur = mix(0.012, 0.0015, puddle);
            vec3 r = texture2D(tReflect, ruv).rgb * 0.36
                   + texture2D(tReflect, ruv + vec2(blur, 0.0)).rgb * 0.16 + texture2D(tReflect, ruv - vec2(blur, 0.0)).rgb * 0.16
                   + texture2D(tReflect, ruv + vec2(0.0, blur * 1.6)).rgb * 0.16 + texture2D(tReflect, ruv - vec2(0.0, blur * 1.6)).rgb * 0.16;
            float amt = clamp(fres * (0.3 + 0.3 * uWet) + puddle * 0.5, 0.0, 0.8);
            outgoingLight = mix(outgoingLight, r * (1.0 + puddle * 0.3), amt);
          }
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'wetground-v1';
}

/** The OMNICORE eye: an additive LED-wall eye with blinking lid, tracking iris, dilating slit pupil and a HUD ring. */
export function eyeMaterial(sh: Shared) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uT: sh.uT, uFog: sh.uFog, uLook: { value: new THREE.Vector2() }, uK: { value: 1 } },
    vertexShader: 'varying vec2 vUv; varying float vD; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.); vD = -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: /* glsl */ `
      uniform float uT, uFog, uK; uniform vec2 uLook; varying vec2 vUv; varying float vD;
      ${FADE}
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      void main(){
        vec2 p = (vUv - 0.5) * vec2(2.0 * 16.0 / 9.0, 2.0);
        float cyc = fract(uT / 6.0);
        float blink = smoothstep(0.0, 0.02, cyc) * smoothstep(0.075, 0.04, cyc);
        float hl = max(0.0, 0.62 * (1.0 - pow(abs(p.x) / 1.3, 2.2))) * (1.0 - blink * 0.97);
        float ay = abs(p.y);
        vec3 col = vec3(0.0);
        float inside = step(ay, hl);
        vec2 c = uLook * vec2(0.4, 0.16);
        vec2 q = p - c;
        float r = length(q);
        float ang = atan(q.y, q.x);
        float streak = 0.55 + 0.45 * sin(ang * 22.0 + uT * 0.6) * sin(ang * 7.0 - uT * 0.3);
        vec3 sclera = vec3(0.34, 0.025, 0.03) * (0.6 + 0.4 * h(floor(p * 40.0)));
        vec3 iris = mix(vec3(3.4, 0.55, 0.16), vec3(1.5, 0.05, 0.03), smoothstep(0.1, 0.34, r)) * streak;
        col = sclera;
        col = mix(col, iris, smoothstep(0.35, 0.32, r));
        float slit = 0.045 + 0.03 * sin(uT * 1.3);
        col = mix(col, vec3(0.0), step(abs(q.x), slit) * step(abs(q.y), 0.3) * step(r, 0.34));
        col += vec3(2.2, 1.0, 0.8) * smoothstep(0.06, 0.0, length(q - vec2(-0.1, 0.12))) * 0.7; // catchlight
        col *= inside * (0.65 + 0.35 * smoothstep(hl, hl * 0.2, ay)); // shaded toward the lids
        float lid = smoothstep(0.045, 0.0, abs(ay - hl)) * step(hl, 0.62) * step(0.01, hl);
        col += vec3(4.0, 0.45, 0.25) * lid * (0.85 + 0.15 * sin(uT * 9.0));
        // HUD ring
        float rr = length(p);
        float ticks = step(0.5, fract(atan(p.y, p.x) * 24.0 / 6.2832 + uT * 0.05));
        col += vec3(3.0, 0.3, 0.2) * smoothstep(0.012, 0.0, abs(rr - 0.96)) * (0.35 + 0.65 * ticks);
        col += vec3(2.2, 0.2, 0.15) * smoothstep(0.01, 0.0, abs(rr - 0.9)) * step(0.5, fract(atan(p.y, p.x) * 5.0 / 6.2832 - uT * 0.12)) * 0.8;
        // halo
        col += vec3(1.0, 0.08, 0.05) * exp(-pow(max(0.0, ay - hl), 1.0) * 3.0) * exp(-abs(p.x) * 1.1) * 0.35 * step(0.001, hl + 0.001);
        float scan = 0.85 + 0.15 * sin(vUv.y * 300.0 + uT * 6.0);
        float edge = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x) * smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.96, vUv.y);
        gl_FragColor = vec4(col * scan * edge * uK * fadeAt(vD, uFog), 1.0);
      }`,
  });
}
