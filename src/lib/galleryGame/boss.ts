/**
 * The LIQUID UNIT: OMNICORE's chrome android, an original faceless design.
 *
 * A properly rigged humanoid (Mixamo's faceless "X Bot" mannequin, `public/arena/models/liquid/xbot.glb`, see
 * public/arena/CREDITS.md) carrying one red visor slit and plated in mirror-polished liquid metal: MeshPhysical,
 * metal 1, low roughness, clearcoat, lit by a dedicated night-street environment (the Arena HDRI plus neon
 * softboxes) with cyan and amber rim lights and a red eye light. Its joints are dark gunmetal. The surface keeps moving (slow mercury wobble), takes a crater plus a spreading ripple ring at
 * every hit that heals over in about a second (displacement in the vertex shader, ripple normals in the fragment
 * shader), and only sustained fire takes it down: let up and it regenerates. At zero it melts into a puddle,
 * then pulls itself back up, 1.5x tougher, further down the street.
 *
 * Animation: the clips (idle, walk) are blended by speed; a menacing posture, breathing, head scan, a periodic
 * roar and a hit flinch are layered on top by nudging the spine, head and arm bones after the mixer runs.
 * If the model can't load, a primitive-shape figure stands in so the game still works.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { halo } from '../bsvgun/targets';

const HITS = 12;
const MODEL_URL = '/arena/models/liquid/xbot.glb';
/** Standing height in metres: the unit towers over the street. */
const HEIGHT = 7;
/** World metres per metre of a 1.8 m source character. */
const AM = HEIGHT / 1.8;

// ── Liquid-metal surface (shared by the vertex and fragment stages, in world metres) ─────────────────────

const SURF_GLSL = /* glsl */ `
  varying vec3 vWP;
  uniform float uTime; uniform float uAgitate; uniform float uBump; uniform float uRim; uniform vec4 uHits[${HITS}];
  // Height (w) and gradient (xyz) of the liquid skin at p, in world metres: a slow wobble everywhere, plus a
  // crater and a ripple ring per recent hit. fine > 0.5 adds small, quick surface shimmer (fragment stage only).
  vec4 surfG(vec3 p, float fine, int n){
    vec3 a = vec3(1.3, 1.1, 1.2);
    vec3 ph = vec3(p.x*a.x + uTime*2.1, p.y*a.y - uTime*1.7, p.z*a.z + uTime*1.3);
    vec3 s = sin(ph), c = cos(ph);
    float amp = (0.03 + 0.07 * uAgitate) * (1.0 - 0.0 * fine);
    float d = s.x*s.y*s.z * amp;
    vec3 g = vec3(c.x*s.y*s.z*a.x, s.x*c.y*s.z*a.y, s.x*s.y*c.z*a.z) * amp;
    if (fine > 0.5) {
      vec3 b = vec3(6.0, 5.0, 6.0);
      vec3 q = vec3(p.x*b.x + uTime*3.0, p.y*b.y - uTime*2.4, p.z*b.z + uTime*2.7);
      vec3 sq = sin(q), cq = cos(q);
      d += 0.006 * sq.x*sq.y*sq.z;
      g += 0.006 * vec3(cq.x*sq.y*sq.z*b.x, sq.x*cq.y*sq.z*b.y, sq.x*sq.y*cq.z*b.z);
    }
    for (int i = 0; i < ${HITS}; i++) {
      if (i >= n) break;
      vec4 h = uHits[i];
      float age = uTime - h.w;
      if (age < 0.0 || age > 1.8) continue;
      vec3 dv = p - h.xyz;
      float r = max(length(dv), 1e-4);
      vec3 dir = dv / r;
      float cr = 0.17 * exp(-r*r*10.0) * exp(-age*3.0);                              // the crater
      d -= cr;  g += 20.0 * r * cr * dir;
      float amp2 = (0.045 + 0.04*fine) * exp(-age*2.4) * exp(-r*0.9);                 // the ripple
      float ph2 = r*11.0 - age*20.0;
      d += amp2 * sin(ph2);
      g += amp2 * (11.0 * cos(ph2) - 0.9 * sin(ph2)) * dir;
    }
    return vec4(g, d);
  }`;

/** `flat`: no vertex displacement (the puddle: ripples come from the fragment shader only, so it never dips under the street). */
function liquidMaterial(high: boolean, uniforms: Record<string, THREE.IUniform>, joint = false, flat = false) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: joint ? '#2c323c' : '#b4c0cf',
    metalness: 1,
    roughness: joint ? 0.3 : high ? 0.085 : 0.1,
    clearcoat: high && !joint ? 1 : 0,
    clearcoatRoughness: 0.07,
    envMapIntensity: joint ? 0.7 : 0.8,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${SURF_GLSL}`).replace(
      '#include <skinning_vertex>',
      `#include <skinning_vertex>
      {
        vec3 wp0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
        float sc = length(modelMatrix[0].xyz);
        ${flat ? '' : `transformed += normalize(objectNormal) * (surfG(wp0, 0.0, ${high ? HITS : 6}).w / sc);`}
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
      }`,
    );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${SURF_GLSL}`)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // ripples and craters tilt the normal by the skin's slope (analytic, so no 2x2 derivative blockiness)
          vec3 gv = (viewMatrix * vec4(surfG(vWP, ${flat ? '0.0' : '1.0'}, ${high ? HITS : 0}).xyz, 0.0)).xyz;
          normal = normalize(normal - uBump * (gv - normal * dot(gv, normal)));
          nonPerturbedNormal = normal;
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // cool cyan on the left edge, sodium amber on the right: the silhouette never melts into the night
          float fr = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
          vec3 rim = mix(vec3(0.10, 0.85, 1.0), vec3(1.0, 0.55, 0.16), step(0.0, normal.x));
          totalEmissiveRadiance += rim * fr * uRim;
        }`,
      );
  };
  mat.customProgramCacheKey = () => `liquid-unit-${high ? 'h' : 'l'}${joint ? 'j' : ''}${flat ? 'f' : ''}`;
  return mat;
}

/** The unit's own reflections: the Arena HDRI as a dim backdrop, then neon softboxes where a mirror wants them. */
function buildEnv(renderer: THREE.WebGLRenderer, hdr: THREE.Texture | null) {
  const s = new THREE.Scene();
  if (hdr) {
    s.background = hdr;
    s.backgroundIntensity = 0.3;
  } else {
    s.background = new THREE.Color('#0a0c18');
  }
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(48, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      // wet-asphalt floor that catches sodium light, a hot horizon band, a deep navy sky
      fragmentShader:
        'varying vec3 p; void main(){ float h = normalize(p).y; vec3 floorC = vec3(0.07,0.04,0.07); vec3 band = vec3(0.30,0.12,0.05) * exp(-h*h*60.0); vec3 sky = vec3(0.01,0.02,0.07); vec3 c = mix(floorC, sky, smoothstep(-0.15,0.5,h)) + band; gl_FragColor = vec4(c, 0.8); }',
    }),
  );
  s.add(dome);
  const box = (c: string, k: number, w: number, h: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide, toneMapped: false }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  box('#ff3a22', 2.2, 34, 10, 0, 16, -42); //  the tower's red eye behind it
  box('#27e6ff', 2.8, 6, 34, -30, 8, -24); //   tall cyan tube, back left
  box('#ffab4a', 1.5, 6, 34, 30, 8, -22); //    sodium tube, back right
  box('#ff2f92', 1.3, 5, 26, 26, 6, 14); //     neon sign, front right
  box('#9fd6ff', 1.6, 30, 9, 0, 40, 4); //    cold overhead softbox
  box('#ffd9a0', 1.2, 16, 5, -14, 8, 30); //  streetlamp behind the player
  box('#ffffff', 1.5, 4, 18, 8, 6, 32); //    a thin white strip: the mirror's sharp highlight
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.02).texture;
  pm.dispose();
  s.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  return tex;
}

// ── Rig helpers ──────────────────────────────────────────────────────────────────────────────────────────

const norm = (s: string) => s.replace(/[\s_:]+/g, '').toLowerCase();

/** Hit-proxy spheres: bone, child bone (the sphere sits halfway to it), radius in metres on a 1.8 m source. */
const PROXIES: [string, string | null, number][] = [
  ['Hips', 'Spine', 0.2],
  ['Spine', 'Spine1', 0.2],
  ['Spine1', 'Spine2', 0.22],
  ['Spine2', 'Neck', 0.25],
  ['LeftUpLeg', 'LeftLeg', 0.14],
  ['LeftLeg', 'LeftFoot', 0.11],
  ['RightUpLeg', 'RightLeg', 0.14],
  ['RightLeg', 'RightFoot', 0.11],
  ['LeftArm', 'LeftForeArm', 0.09],
  ['LeftForeArm', 'LeftHand', 0.08],
  ['RightArm', 'RightForeArm', 0.09],
  ['RightForeArm', 'RightHand', 0.08],
];

export class LiquidUnit {
  group = new THREE.Group();
  /** Meshes the ray can hit (invisible proxies that follow the skeleton). */
  parts: THREE.Mesh[] = [];
  hp: number;
  max: number;
  wave = 1;
  melt = 0; // 0 standing; 0..1 melting; 1..2 reforming
  /** Resolves once the model is in (or the fallback figure is standing). */
  ready: Promise<void>;
  private lastHit = -10;
  private t = 0;
  private step = 0;
  private z = -30;
  private x = 0;
  private yaw = 0;
  private walking = false;
  private uniforms = {
    uTime: { value: 0 },
    uHits: { value: Array.from({ length: HITS }, () => new THREE.Vector4(0, -100, 0, -100)) },
    uAgitate: { value: 0 },
    uBump: { value: 1.2 },
    uRim: { value: 0.7 },
  };
  private hitCursor = 0;
  private ringT = 0;
  private mat: THREE.MeshPhysicalMaterial;
  private jointMat: THREE.MeshPhysicalMaterial;
  private puddleMat: THREE.MeshPhysicalMaterial;
  private puddle: THREE.Mesh;
  private body = new THREE.Group(); // holds the model (or the fallback figure); melted by scaling
  private geos: THREE.BufferGeometry[] = [];
  private envTex: THREE.Texture | null = null;
  private disposed = false;

  // model rig
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private idleA: THREE.AnimationAction | null = null;
  private walkA: THREE.AnimationAction | null = null;
  private driven: Record<string, THREE.Object3D | undefined> = {};
  private tv = new THREE.Vector3();
  private tq = new THREE.Quaternion();
  private moveBlend = 0;
  private flinch = 0;
  private hitSide = 0;
  private phase: 'stalk' | 'windup' | 'lunge' | 'recover' | 'roar' | 'stagger' = 'stalk';
  private phaseT = 0;
  private nextLunge = 9;
  private nextRoar = 4;
  private heavyAcc = 0;
  private staggerCd = 0;
  private stepPh = 0;
  private impulseV = 0;
  private roarFired = false;
  /** Shape of the current pose, eased toward each phase's target. */
  private P = { lean: 0, crouch: 0, swing: 0, flare: 0, back: 0, chest: 0, shove: 0 };
  /** Armour plates that follow a bone (pauldrons, head blades). */
  private orn: { mesh: THREE.Mesh; bone: THREE.Object3D; restRel: THREE.Quaternion; off: THREE.Vector3 }[] = [];
  /** Fired on big moments so the engine can add rings, sparks and shake. */
  onEvent: ((kind: 'roar' | 'stomp' | 'lunge' | 'stagger', at: THREE.Vector3) => void) | null = null;
  private eyeMat: THREE.MeshBasicMaterial | null = null;
  private eyeGlow: THREE.Sprite | null = null;
  private eyeLight: THREE.PointLight;
  // scratch (no allocation per frame)
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private qh = new THREE.Quaternion();
  private eul = new THREE.Euler();

  // fallback figure
  private legs: THREE.Group[] = [];
  private arms: THREE.Group[] = [];

  constructor(
    private base: number,
    private high: boolean,
  ) {
    this.hp = this.max = base;
    this.mat = liquidMaterial(high, this.uniforms);
    this.jointMat = liquidMaterial(high, this.uniforms, true);
    this.puddleMat = liquidMaterial(high, this.uniforms, false, true);
    const pgeo = new THREE.CircleGeometry(1, 64);
    this.geos.push(pgeo);
    this.puddle = new THREE.Mesh(pgeo, this.puddleMat);
    this.puddle.rotation.x = -Math.PI / 2;
    this.puddle.position.y = 0.05;
    this.puddle.visible = false;
    this.group.add(this.body, this.puddle);
    this.group.position.set(this.x, 0, this.z);
    // Rim lights (cyan back-left, amber back-right) and the red eye light ride with the unit.
    const rimL = new THREE.PointLight('#27e6ff', high ? 14 : 12, 26, 1.7);
    rimL.position.set(-6.5, 6.5, -5);
    const rimR = new THREE.PointLight('#ffa040', high ? 12 : 11, 26, 1.7);
    rimR.position.set(6.5, 5, -5);
    this.eyeLight = new THREE.PointLight('#ff2418', 0, 16, 1.6);
    this.eyeLight.position.set(0, HEIGHT * 0.93, 1.2);
    this.group.add(rimL, rimR, this.eyeLight);
    this.ready = this.load().catch(() => {
      if (!this.disposed) this.buildFallback();
    });
  }

  /** Give the unit the Arena-style environment (call once, right after construction, with the look's HDRI). */
  setEnv(renderer: THREE.WebGLRenderer, hdr: THREE.Texture | null) {
    this.envTex?.dispose();
    this.envTex = buildEnv(renderer, hdr);
    for (const m of [this.mat, this.jointMat, this.puddleMat]) {
      m.envMap = this.envTex;
      m.needsUpdate = true;
    }
  }

  // ── Model ──

  private async load() {
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(MODEL_URL);
    if (this.disposed) return;
    const model = cloneSkinned(gltf.scene);
    // Chrome body, gunmetal joints (told apart by the source material's name).
    const kept: THREE.SkinnedMesh[] = [];
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      const joint = /joint/i.test((m.material as THREE.Material).name);
      m.material = joint ? this.jointMat : this.mat;
      m.frustumCulled = false; // skinned bounds lie when animated
      m.castShadow = this.high;
      kept.push(m);
    });
    // Silhouette: a broader, deeper chest, a narrower, taller head. Plates are added below.
    const early = new Map<string, THREE.Object3D>();
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) early.set(norm(o.name), o);
    });
    const eb = (n: string) => early.get(norm(`mixamorig${n}`));
    eb('Spine2')?.scale.set(1.22, 1, 1.2);
    eb('Spine1')?.scale.set(1.06, 1, 1.06);
    eb('Head')?.scale.set(0.86, 1.14, 0.9);
    eb('Hips')?.scale.set(1.08, 1, 1.05);
    model.updateMatrixWorld(true);
    for (const m of kept) m.skeleton?.update();
    const box = new THREE.Box3();
    for (const m of kept) box.union(new THREE.Box3().setFromObject(m, true));
    const size = box.getSize(new THREE.Vector3());
    const k = HEIGHT / Math.max(0.001, size.y);
    const holder = new THREE.Group();
    holder.scale.setScalar(k);
    model.position.set(-(box.min.x + size.x / 2), -box.min.y, -(box.min.z + size.z / 2));
    holder.add(model);
    this.body.add(holder);
    this.model = holder;
    holder.updateMatrixWorld(true);

    const bones = new Map<string, THREE.Object3D>();
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(norm(o.name), o);
    });
    const find = (name: string) => bones.get(norm(`mixamorig${name}`)) ?? null;

    // Hit proxies: invisible spheres riding on the bones, so shots land on the animated body
    // without ray-testing a skinned mesh.
    const sgeo = new THREE.SphereGeometry(1, 10, 8);
    this.geos.push(sgeo);
    const pmat = new THREE.MeshBasicMaterial({ visible: false });
    const ws = new THREE.Vector3();
    const addProxy = (bone: THREE.Object3D, local: THREE.Vector3, r: number) => {
      bone.getWorldScale(ws);
      const p = new THREE.Mesh(sgeo, pmat);
      p.position.copy(local);
      p.scale.setScalar((r * AM) / Math.max(1e-6, ws.x));
      bone.add(p);
      this.parts.push(p);
    };
    for (const [bn, cn, r] of PROXIES) {
      const b = find(bn);
      if (!b) continue;
      const c = cn ? find(cn) : null;
      addProxy(b, c ? c.position.clone().multiplyScalar(0.5) : new THREE.Vector3(), r);
    }

    // The red visor: a thin strip laid on the faceless head at eye height, wrapped to the true surface by
    // ray-casting the (bind-pose) head from the inside out, so it fits whatever the model's shape.
    const head = find('Head');
    const top = find('HeadTop_End');
    if (head && top) {
      for (const m of kept) m.skeleton?.update();
      const holderQ = holder.getWorldQuaternion(new THREE.Quaternion());
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(holderQ);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(holderQ);
      const hw = head.getWorldPosition(new THREE.Vector3());
      const tw = top.getWorldPosition(new THREE.Vector3());
      const hh = tw.distanceTo(hw);
      const centre = hw.clone().lerp(tw, 0.5);
      const eL = find('LeftEye');
      const eR = find('RightEye');
      // eye line: the model's eye bones when it has them, else a bit above the head bone
      const eyeC = eL && eR ? eL.getWorldPosition(new THREE.Vector3()).add(eR.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5).addScaledVector(up, hh * 0.02) : hw.clone().addScaledVector(up, hh * 0.25);
      eyeC.addScaledVector(fwd, -fwd.dot(eyeC.clone().sub(centre))); // slide back onto the head's axis
      const half = hh * 0.07; // half the visor's height
      const ray = new THREE.Raycaster();
      const N = 25;
      const rowTop: THREE.Vector3[] = [];
      const rowBot: THREE.Vector3[] = [];
      const nrm: THREE.Vector3[] = []; // outward direction in head space, for displacing the strip with the skin
      let mid: THREE.Vector3 | null = null;
      for (let i = 0; i < N; i++) {
        const a = ((i / (N - 1)) * 2 - 1) * 1.15; // wraps ~130 degrees round the front
        const dir = fwd.clone().applyAxisAngle(up, a);
        for (const [dst, dy] of [
          [rowTop, half],
          [rowBot, -half],
        ] as const) {
          const o = eyeC.clone().addScaledVector(up, dy).addScaledVector(dir, hh * 2);
          ray.set(o, dir.clone().negate());
          ray.far = hh * 3;
          const hit = ray.intersectObjects(kept, false)[0];
          // lift 1.5% of the head height off the skin so the strip never z-fights
          const pt = hit ? hit.point.clone().addScaledVector(dir, hh * 0.015) : eyeC.clone().addScaledVector(up, dy).addScaledVector(dir, hh * 0.5);
          dst.push(head.worldToLocal(pt));
          nrm.push(head.worldToLocal(pt.clone().add(dir)).sub(head.worldToLocal(pt.clone())).normalize());
          if (i === (N - 1) / 2 && dy === half) mid = pt.clone();
        }
      }
      const pos: number[] = [];
      const nor: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i < N; i++) {
        pos.push(rowTop[i].x, rowTop[i].y, rowTop[i].z, rowBot[i].x, rowBot[i].y, rowBot[i].z);
        nor.push(nrm[i * 2].x, nrm[i * 2].y, nrm[i * 2].z, nrm[i * 2 + 1].x, nrm[i * 2 + 1].y, nrm[i * 2 + 1].z);
      }
      for (let i = 0; i < N - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      const strip = new THREE.BufferGeometry();
      strip.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      strip.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      strip.setIndex(idx);
      this.geos.push(strip);
      this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.03, 0.015), side: THREE.DoubleSide, toneMapped: false });
      // the slit rides the liquid skin: same displacement as the head under it
      const eyeUniforms = this.uniforms;
      const nVis = this.high ? HITS : 6;
      this.eyeMat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, eyeUniforms);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${SURF_GLSL}`).replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            vec3 wp0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
            transformed += normalize(normal) * (surfG(wp0, 0.0, ${nVis}).w / length(modelMatrix[0].xyz));
          }`,
        );
      };
      this.eyeMat.customProgramCacheKey = () => 'liquid-visor';
      const visor = new THREE.Mesh(strip, this.eyeMat);
      visor.frustumCulled = false;
      head.add(visor);
      // glow and light where the slit meets the front of the face
      head.getWorldScale(ws);
      const inv = 1 / Math.max(1e-6, ws.x);
      const frontLocal = head.worldToLocal((mid ?? eyeC).clone().addScaledVector(up, -half * 0.5));
      const glow = halo('#ff2a1a', 1.4 * inv, 0.5);
      glow.position.copy(frontLocal);
      head.add(glow);
      this.eyeGlow = glow;
      this.group.remove(this.eyeLight);
      this.eyeLight.position.copy(head.worldToLocal((mid ?? eyeC).clone().addScaledVector(fwd, hh * 1.5)));
      head.add(this.eyeLight);
      addProxy(head, head.worldToLocal(centre.clone()), 0.14);
    }

    // Bones the menace layer drives.
    for (const [key, name] of [
      ['hips', 'Hips'],
      ['upLegL', 'LeftUpLeg'],
      ['upLegR', 'RightUpLeg'],
      ['legL', 'LeftLeg'],
      ['legR', 'RightLeg'],
      ['spine', 'Spine'],
      ['spine1', 'Spine1'],
      ['chest', 'Spine2'],
      ['neck', 'Neck'],
      ['head', 'Head'],
      ['clavL', 'LeftShoulder'],
      ['clavR', 'RightShoulder'],
      ['armL', 'LeftArm'],
      ['armR', 'RightArm'],
      ['foreL', 'LeftForeArm'],
      ['foreR', 'RightForeArm'],
    ] as const) {
      this.driven[key] = find(name) ?? undefined;
    }

    this.mixer = new THREE.AnimationMixer(model);
    this.buildPlates(holder, find);

    // Clips.
    const idle = gltf.animations.find((a) => a.name === 'idle');
    const walk = gltf.animations.find((a) => a.name === 'walk');
    if (idle) {
      this.idleA = this.mixer.clipAction(idle);
      this.idleA.timeScale = 0.55;
      this.idleA.play();
    }
    if (walk) {
      this.walkA = this.mixer.clipAction(walk);
      this.walkA.timeScale = 0.6;
      this.walkA.play();
      this.walkA.setEffectiveWeight(0);
    }
    this.mixer.update(0);
  }

  /** Angular liquid-metal pauldrons and head blades, riding the chest and head bones. */
  private buildPlates(holder: THREE.Object3D, find: (n: string) => THREE.Object3D | null) {
    const chest = find('Spine2');
    const head = find('Head');
    holder.updateMatrixWorld(true);
    const hq = holder.getWorldQuaternion(new THREE.Quaternion()).invert();
    const add = (geo: THREE.BufferGeometry, bone: THREE.Object3D | null, off: THREE.Vector3, rot: THREE.Euler, scale: THREE.Vector3, joint = false) => {
      if (!bone) return;
      this.geos.push(geo);
      const m = new THREE.Mesh(geo, joint ? this.jointMat : this.mat);
      m.castShadow = this.high;
      m.frustumCulled = false;
      m.scale.copy(scale);
      const rest = hq.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
      // local shape rotation baked in via a child-less pre-rotation of the geometry
      geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot));
      holder.add(m);
      this.orn.push({ mesh: m, bone, restRel: rest.invert(), off });
    };
    // positions are in the 1.8 m source model's metres, in the holder frame (x right, y up, z forward)
    for (const side of [-1, 1]) {
      // pauldron: a squashed, faceted dome with a swept spike
      add(new THREE.OctahedronGeometry(0.17, 1), chest, new THREE.Vector3(side * 0.3, 0.1, -0.01), new THREE.Euler(0, 0, side * 0.35), new THREE.Vector3(1.35, 0.7, 1.15));
      add(new THREE.ConeGeometry(0.06, 0.34, 6), chest, new THREE.Vector3(side * 0.42, 0.2, -0.04), new THREE.Euler(0, 0, -side * 1.15), new THREE.Vector3(1, 1, 1), true);
      // cheek blade swept back from the head
      add(new THREE.ConeGeometry(0.025, 0.22, 5), head, new THREE.Vector3(side * 0.085, 0.06, -0.05), new THREE.Euler(-1.2, 0, side * 0.3), new THREE.Vector3(1, 1, 1), true);
    }
    // crest: a tall blade over the skull
    add(new THREE.ConeGeometry(0.035, 0.34, 4), head, new THREE.Vector3(0, 0.2, -0.1), new THREE.Euler(-1.05, 0, 0), new THREE.Vector3(0.6, 1, 1.6), true);
  }

  private followPlates() {
    for (const o of this.orn) {
      o.bone.getWorldPosition(this.tv);
      // bones carry the holder's scale; offsets are in holder space
      const h = o.mesh.parent!;
      h.worldToLocal(this.tv);
      o.bone.getWorldQuaternion(this.tq);
      this.tq.premultiply(this.qh).multiply(o.restRel);
      o.mesh.position.copy(this.tv).add(this.tmpOff.copy(o.off).applyQuaternion(this.tq));
      o.mesh.quaternion.copy(this.tq);
    }
  }
  private tmpOff = new THREE.Vector3();

  // ── Fallback figure (only if the model can't be loaded) ──

  private buildFallback() {
    const mat = this.mat;
    const seg = this.high ? 1 : 0.6;
    const mk = (geo: THREE.BufferGeometry, parent: THREE.Object3D, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      this.geos.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      parent.add(m);
      this.parts.push(m);
      return m;
    };
    const cap = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, Math.round(10 * seg), Math.round(28 * seg));
    const fig = new THREE.Group();
    mk(cap(0.3, 0.52), fig, 0, 1.42, 0, 1.15, 1, 0.72);
    mk(cap(0.22, 0.12), fig, 0, 0.98, 0, 1.2, 1, 0.8);
    mk(cap(0.07, 0.1), fig, 0, 1.9, 0);
    mk(new THREE.SphereGeometry(0.15, Math.round(40 * seg), Math.round(28 * seg)), fig, 0, 2.08, 0.01, 0.92, 1.18, 1.0);
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.15, 0.92, 0);
      mk(cap(0.1, 0.36), hip, 0, -0.24, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.46;
      hip.add(knee);
      mk(cap(0.085, 0.36), knee, 0, -0.22, 0);
      mk(new THREE.BoxGeometry(0.15, 0.07, 0.3), knee, 0, -0.46, 0.06);
      fig.add(hip);
      this.legs.push(hip);
      const sh = new THREE.Group();
      sh.position.set(side * 0.42, 1.72, 0);
      mk(cap(0.075, 0.3), sh, 0, -0.2, 0);
      const el = new THREE.Group();
      el.position.y = -0.4;
      sh.add(el);
      mk(cap(0.065, 0.28), el, 0, -0.18, 0);
      fig.add(sh);
      this.arms.push(sh);
    }
    fig.scale.setScalar(HEIGHT / 2.3);
    this.body.add(fig);
  }

  get alive() {
    return this.melt === 0;
  }

  /** Damage from accepted transactions. Returns true if this took it down. */
  hit(n: number, at: THREE.Vector3) {
    if (!this.alive) return false;
    this.hp -= n;
    this.lastHit = this.t;
    this.heavyAcc += n;
    const v = this.uniforms.uHits.value[this.hitCursor++ % HITS];
    v.set(at.x, at.y, at.z, this.t);
    // flinch: rock back, twist away from the side that was hit
    this.flinch = Math.min(1, Math.max(this.flinch, 0.45) + 0.08);
    this.hitSide = THREE.MathUtils.clamp((at.x - this.group.position.x) / 1.6, -1, 1);
    if (this.hp <= 0) {
      this.hp = 0;
      this.melt = 0.0001;
      this.phase = 'stalk';
      return true;
    }
    return false;
  }

  takeImpulse() {
    const v = this.impulseV;
    this.impulseV = 0;
    return v;
  }

  setBase(n: number) {
    this.base = n;
    this.max = n * Math.pow(1.5, this.wave - 1);
    this.hp = Math.min(this.hp, this.max);
    if (this.alive) this.hp = this.max;
  }

  /** Where to aim for the chest, in world space. */
  chest(out: THREE.Vector3) {
    return out.set(this.group.position.x, HEIGHT * 0.6, this.group.position.z);
  }

  /** Nudge a bone by (x, y, z) radians about the model's own axes (x right, y up, z forward). */
  private nudge(bone: THREE.Object3D | undefined, ax: number, ay: number, az: number) {
    if (!bone) return;
    bone.getWorldQuaternion(this.qa);
    this.qa.premultiply(this.qh); // the bone's current rotation in the model's frame
    this.qb.setFromEuler(this.eul.set(ax, ay, az));
    // local delta = R^-1 . D . R, applied on the right of the bone's local rotation
    this.qb.premultiply(this.qa.clone().invert()).multiply(this.qa);
    bone.quaternion.multiply(this.qb);
  }

  private ease(k: keyof LiquidUnit['P'], target: number, dt: number, rate: number) {
    this.P[k] += (target - this.P[k]) * Math.min(1, dt * rate);
  }

  private emit(kind: 'roar' | 'stomp' | 'lunge' | 'stagger', imp: number) {
    this.impulseV = Math.max(this.impulseV, imp);
    this.onEvent?.(kind, this.tv.set(this.group.position.x, kind === 'roar' ? HEIGHT * 0.65 : 0.4, this.group.position.z + (kind === 'roar' ? 1.5 : 0)));
  }

  private setPhase(p: LiquidUnit['phase']) {
    this.phase = p;
    this.phaseT = 0;
    this.roarFired = false;
  }

  private poseModel(dt: number, slump: number) {
    const model = this.model;
    if (!model || !this.mixer) return;
    const t = this.t;
    const ph = this.phase;
    const pt = this.phaseT;
    // Phase targets: how hunched, crouched, swung, flared, rocked back, chest-swollen
    let lean = 0.12, crouch = 0.12, swing = 0, flare = 0, back = 0, chest = 0, rate = 5;
    if (ph === 'stalk') {
      lean = 0.2 + 0.1 * this.moveBlend;
      crouch = 0.22 + 0.1 * this.moveBlend; // stalks low: knees bent, shoulders rolling
    } else if (ph === 'windup') {
      back = 0.5 * Math.min(1, pt / 0.4);
      crouch = 0.75;
      swing = -0.9; // arms drawn back
      lean = -0.1;
      rate = 9;
    } else if (ph === 'lunge') {
      lean = 0.75;
      crouch = 0.35;
      swing = 1.2; // arms thrust forward
      rate = 16;
    } else if (ph === 'recover') {
      lean = 0.35 - pt * 0.15;
      crouch = 0.4 * Math.max(0, 1 - pt);
      swing = 0.3;
      rate = 4;
    } else if (ph === 'roar') {
      const up = pt < 0.35 ? pt / 0.35 : pt < 1.7 ? 1 : Math.max(0, 1 - (pt - 1.7) / 0.5);
      back = 0.9 * up;
      flare = 1 * up;
      chest = 1 * up;
      crouch = 0.15 + 0.2 * (pt < 0.35 ? pt / 0.35 : 0);
      rate = 10;
    } else if (ph === 'stagger') {
      back = 1.1 * (pt < 0.15 ? pt / 0.15 : Math.max(0, 1 - (pt - 0.15) / 0.8));
      crouch = 0.65 * (pt < 0.3 ? 1 : Math.max(0, 1 - (pt - 0.3) / 0.6));
      flare = 0.6;
      rate = 14;
    }
    this.ease('lean', lean + slump * 0.7, dt, rate);
    this.ease('crouch', crouch, dt, rate);
    this.ease('swing', swing, dt, rate);
    this.ease('flare', flare, dt, rate);
    this.ease('back', back, dt, rate);
    this.ease('chest', chest, dt, rate);
    const P = this.P;

    this.moveBlend += ((this.walking ? 1 : 0) - this.moveBlend) * Math.min(1, dt * 3);
    const m = this.moveBlend;
    this.idleA?.setEffectiveWeight(1 - m);
    this.walkA?.setEffectiveWeight(m);
    this.mixer.update(dt);
    // footfalls: two per walk cycle shake the street
    if (this.walkA && m > 0.5 && ph === 'stalk') {
      const dur = this.walkA.getClip().duration;
      const cyc = (this.walkA.time % dur) / dur;
      const step = Math.floor(cyc * 2);
      if (step !== this.stepPh) {
        this.stepPh = step;
        this.emit('stomp', 0.14);
      }
    }
    model.updateMatrixWorld(true);
    model.getWorldQuaternion(this.qh).invert();

    const breathe = Math.sin(t * 1.5);
    const fl = this.flinch * (1 + 0.3 * Math.sin(t * 40));
    const D = this.driven;
    const bk = P.back;
    this.nudge(D.hips, -P.crouch * 0.1, 0, 0);
    this.nudge(D.spine, P.lean * 0.3 - fl * 0.1 - bk * 0.2 + breathe * 0.012, this.hitSide * fl * 0.1, 0);
    this.nudge(D.spine1, P.lean * 0.3 - fl * 0.12 - bk * 0.25, this.hitSide * fl * 0.1, 0);
    this.nudge(D.chest, P.lean * 0.25 - fl * 0.16 - bk * 0.3 + breathe * 0.02 + P.chest * 0.05, this.hitSide * fl * 0.14, 0);
    this.nudge(D.neck, 0.05 - fl * 0.1 - bk * 0.2, 0, 0);
    this.nudge(D.head, 0.14 + slump * 0.5 - fl * 0.3 - bk * 0.6 + (ph === 'lunge' ? 0.3 : 0), Math.sin(t * 0.45) * 0.2 * (1 - fl) * (ph === 'stalk' ? 1 : 0.2), Math.sin(t * 0.31) * 0.05);
    // legs: thighs forward (negative x), shins back (positive x)
    this.nudge(D.upLegL, -P.crouch * 0.6, 0, 0);
    this.nudge(D.upLegR, -P.crouch * 0.6, 0, 0);
    this.nudge(D.legL, P.crouch * 1.1, 0, 0);
    this.nudge(D.legR, P.crouch * 1.1, 0, 0);
    const spread = 0.3 + P.flare * 0.75 + breathe * 0.015 + fl * 0.12;
    this.nudge(D.clavL, 0, 0, -0.08 - P.flare * 0.2);
    this.nudge(D.clavR, 0, 0, 0.08 + P.flare * 0.2);
    this.nudge(D.armL, P.swing * 0.9, 0, -spread);
    this.nudge(D.armR, P.swing * 0.9, 0, spread);
    this.nudge(D.foreL, 0.45 + P.flare * 0.3 - fl * 0.2 - P.swing * 0.2, 0, 0);
    this.nudge(D.foreR, 0.45 + P.flare * 0.3 - fl * 0.2 - P.swing * 0.2, 0, 0);
    // the chest swells with the roar; the whole body is shoved back by hits and staggers; crouching drops the hips
    this.driven.chest?.scale.set(1.22 + P.chest * 0.12, 1 + P.chest * 0.04, 1.2 + P.chest * 0.1);
    this.body.position.z = -this.flinch * 0.22 - P.back * 0.35;
    this.body.position.y = -P.crouch * 0.5;
    this.followPlates();
  }

  update(dt: number) {
    this.t += dt;
    this.uniforms.uTime.value = this.t;
    this.flinch *= Math.exp(-dt * 6);
    if (this.flinch < 0.002) this.flinch = 0;
    const recent = this.t - this.lastHit < 0.25;
    this.uniforms.uAgitate.value += ((recent ? 1 : 0) - this.uniforms.uAgitate.value) * Math.min(1, dt * 6);
    if (this.eyeMat) {
      const f = 0.85 + 0.15 * Math.sin(this.t * 7.3) * Math.sin(this.t * 2.1);
      const on = this.melt > 0 ? Math.max(0, 1 - this.melt * 1.6) : 1;
      this.eyeMat.color.setRGB(6 * f * on, 0.03 * on, 0.015 * on);
      if (this.eyeGlow) this.eyeGlow.material.opacity = 0.5 * on * f;
      this.eyeLight.intensity = 40 * on * (1 + 0.8 * this.flinch);
    }
    if (this.melt > 0) {
      this.melt += dt * 0.45;
      const k = Math.min(1, this.melt);
      const back = Math.max(0, this.melt - 1.15) / 0.85;
      this.walking = false;
      this.poseModel(dt, this.melt < 1 ? k : 1 - back);
      this.body.visible = this.melt < 1 || back > 0.05;
      const sy = this.melt < 1 ? 1 - k * 0.97 : 0.03 + back * 0.97;
      const sxz = this.melt < 1 ? 1 + k * 1.2 : 2.2 - back * 1.2;
      this.body.scale.set(sxz, sy, sxz);
      this.puddle.visible = true;
      // the puddle keeps shivering: a ring spreads from the middle every few tenths of a second
      this.ringT -= dt;
      if (this.ringT <= 0 && this.melt < 1.7) {
        this.ringT = 0.45;
        this.uniforms.uHits.value[this.hitCursor++ % HITS].set(this.group.position.x, 0.05, this.group.position.z, this.t);
      }
      const pr = this.melt < 1 ? 0.8 + k * 3.2 : 4 * (1 - back) + 0.3;
      this.puddle.scale.setScalar(pr);
      this.uniforms.uAgitate.value = 1;
      if (this.melt >= 1 && this.melt - dt * 0.45 < 1) {
        // re-form further down the street, tougher
        this.wave++;
        this.max = this.base * Math.pow(1.5, this.wave - 1);
        this.hp = this.max;
        this.z = -32 - Math.random() * 6;
        this.x = (Math.random() - 0.5) * 16;
        this.group.position.set(this.x, 0, this.z);
      }
      if (this.melt >= 2) {
        this.melt = 0;
        this.body.scale.setScalar(1);
        this.body.visible = true;
        this.puddle.visible = false;
      }
      return;
    }
    // Relentless, heavy stalk toward the player; it stops 16 m out and looms, and every few seconds
    // it roars, or winds up and lunges. Heavy sustained fire staggers it.
    const speed = 2.1;
    this.phaseT += dt;
    this.staggerCd -= dt;
    this.heavyAcc *= Math.exp(-dt * 1.6);
    if (this.phase !== 'stagger' && this.staggerCd <= 0 && this.heavyAcc > this.max * 0.035) {
      this.setPhase('stagger');
      this.staggerCd = 5;
      this.heavyAcc = 0;
      this.emit('stagger', 0.45);
    }
    this.walking = false;
    switch (this.phase) {
      case 'stalk':
        this.walking = this.z < -16;
        if (this.walking) this.z += speed * dt;
        this.nextRoar -= dt;
        this.nextLunge -= dt;
        if (this.nextRoar <= 0 && this.z >= -30) {
          this.nextRoar = 11 + Math.random() * 6;
          this.setPhase('roar');
        } else if (this.nextLunge <= 0 && this.z >= -18) {
          this.nextLunge = 8 + Math.random() * 5;
          this.setPhase('windup');
        }
        break;
      case 'windup':
        if (this.phaseT > 0.6) this.setPhase('lunge');
        break;
      case 'lunge':
        this.z += 11 * dt * Math.max(0, 1 - this.phaseT / 0.42);
        if (this.phaseT > 0.42) {
          this.emit('lunge', 0.7);
          this.setPhase('recover');
        }
        break;
      case 'recover':
        this.z -= 1.4 * dt * Math.min(1, this.phaseT);
        if (this.phaseT > 1.3) this.setPhase('stalk');
        break;
      case 'roar':
        if (!this.roarFired && this.phaseT > 0.4) {
          this.roarFired = true;
          this.emit('roar', 0.6);
          this.uniforms.uHits.value[this.hitCursor++ % HITS].set(this.group.position.x, HEIGHT * 0.65, this.group.position.z + 0.6, this.t);
        }
        if (this.phaseT > 2.2) this.setPhase('stalk');
        break;
      case 'stagger':
        this.z -= 2.2 * dt * Math.max(0, 1 - this.phaseT / 0.5);
        if (this.phaseT > 1.0) this.setPhase('stalk');
        break;
    }
    this.z = Math.min(this.z, -9.5);
    this.x = THREE.MathUtils.clamp(this.x, -12, 12);
    this.group.position.set(this.x, 0, this.z);
    const want = Math.atan2(-this.x, -this.z) * 0.6;
    this.yaw += (want - this.yaw) * Math.min(1, dt * 2);
    this.group.rotation.y = this.yaw;
    if (this.model) this.poseModel(dt, 0);
    else if (this.legs.length) {
      // fallback figure: the old stiff-legged march
      this.step += dt * (this.walking ? 4.2 : 2);
      const sw = Math.sin(this.step);
      this.legs[0].rotation.x = sw * 0.55;
      this.legs[1].rotation.x = -sw * 0.55;
      this.arms[0].rotation.x = -sw * 0.4;
      this.arms[1].rotation.x = sw * 0.3 - 0.2;
    }
    // regenerate when the fire stops
    if (this.t - this.lastHit > 0.45) this.hp = Math.min(this.max, this.hp + this.max * 0.07 * dt);
  }

  dispose() {
    this.disposed = true;
    this.geos.forEach((g) => g.dispose());
    this.model?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && !this.geos.includes(m.geometry)) m.geometry.dispose();
    });
    this.mixer?.stopAllAction();
    this.eyeMat?.dispose();
    this.eyeGlow?.material.dispose();
    this.envTex?.dispose();
    this.mat.dispose();
    this.jointMat.dispose();
    this.puddleMat.dispose();
  }
}
