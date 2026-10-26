import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RING } from './sim';

/**
 * The NPG Arena set: a neon rooftop dojo over a night city, lit and graded like the TokenBlaster Arena (ACES, bloom,
 * colour grade + vignette) but in the NPG palette (magenta / cyan / hazard yellow). One renderer for everything.
 */
const PINK = '#ff2bd6';
const CYAN = '#18e8ff';
const YELLOW = '#ffe100';

export type StageKind = 'rooftop' | 'dojo';
/** The cyber dojo (NPG asset, optimised in Blender: platform top centred on the origin, metres, 1:1 with the girls). */
const DOJO_URL = '/arena/models/npg/dojo.glb';

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, srgb = true) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function floorTextures() {
  const S = 1024;
  const paint = (c: CanvasRenderingContext2D, glow: boolean) => {
    c.fillStyle = glow ? '#000' : '#14141c';
    c.fillRect(0, 0, S, S);
    const m = S / 2;
    if (!glow) {
      // brushed panels
      for (let i = 0; i < 1400; i++) {
        c.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
        c.fillRect(Math.random() * S, Math.random() * S, Math.random() * 90, 1);
      }
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.lineWidth = 3;
      for (let k = 1; k < 8; k++) {
        c.beginPath();
        c.arc(m, m, (k / 8) * m, 0, Math.PI * 2);
        c.stroke();
      }
      for (let a = 0; a < 16; a++) {
        c.beginPath();
        c.moveTo(m, m);
        c.lineTo(m + Math.cos((a / 16) * Math.PI * 2) * m, m + Math.sin((a / 16) * Math.PI * 2) * m);
        c.stroke();
      }
    }
    // neon circles + hazard band
    c.lineWidth = 6;
    c.strokeStyle = glow ? PINK : '#5a1050';
    c.beginPath();
    c.arc(m, m, m * 0.97, 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 3;
    c.strokeStyle = glow ? CYAN : '#0a4a55';
    c.beginPath();
    c.arc(m, m, m * 0.9, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(m, m, m * 0.22, 0, Math.PI * 2);
    c.stroke();
    // hazard ring
    c.save();
    c.translate(m, m);
    for (let a = 0; a < 72; a++) {
      c.rotate((Math.PI * 2) / 72);
      c.fillStyle = a % 2 ? (glow ? '#2a2600' : '#0a0a0a') : glow ? '#3a3300' : YELLOW;
      c.beginPath();
      c.moveTo(m * 0.92, -10);
      c.lineTo(m * 0.955, -10);
      c.lineTo(m * 0.955, 22);
      c.lineTo(m * 0.92, 22);
      c.fill();
    }
    c.restore();
    // centre mark: NPG in the DR display face
    c.save();
    c.translate(m, m);
    c.rotate(-Math.PI / 2);
    c.font = 'italic 900 150px Impact, "Arial Black", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = glow ? 'rgba(255,43,214,0.55)' : 'rgba(255,43,214,0.35)';
    c.fillText('NPG', 0, 0);
    c.font = '700 34px "Hiragino Sans", sans-serif';
    c.fillStyle = glow ? 'rgba(24,232,255,0.5)' : 'rgba(24,232,255,0.3)';
    c.fillText('忍者パンクガールズ', 0, 105);
    c.restore();
  };
  return { map: canvasTex(S, S, (c) => paint(c, false)), glow: canvasTex(S, S, (c) => paint(c, true)) };
}

function windowsTex() {
  return canvasTex(128, 256, (c) => {
    c.fillStyle = '#000';
    c.fillRect(0, 0, 128, 256);
    for (let y = 4; y < 256; y += 10)
      for (let x = 4; x < 128; x += 9) {
        if (Math.random() < 0.55) continue;
        const r = Math.random();
        c.fillStyle = r < 0.12 ? PINK : r < 0.24 ? CYAN : r < 0.3 ? YELLOW : `rgba(255,${190 + Math.random() * 50},${140 + Math.random() * 60},${0.4 + Math.random() * 0.5})`;
        c.fillRect(x, y, 5, 5);
      }
  });
}

function signTex(lines: { text: string; font: string; color: string; y: number }[], bg: string, w = 1024, h = 256, stripes = false) {
  return canvasTex(w, h, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    if (stripes) {
      c.fillStyle = YELLOW;
      for (let x = -h; x < w; x += 48) {
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x + 24, 0);
        c.lineTo(x + 24 + 26, 26);
        c.lineTo(x + 26, 26);
        c.fill();
        c.beginPath();
        c.moveTo(x, h - 26);
        c.lineTo(x + 24, h - 26);
        c.lineTo(x + 24 + 26, h);
        c.lineTo(x + 26, h);
        c.fill();
      }
    }
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const l of lines) {
      c.font = l.font;
      c.fillStyle = l.color;
      c.fillText(l.text, w / 2, l.y);
    }
  });
}

export const sparkTex = () =>
  canvasTex(64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  });

const starTex = () =>
  canvasTex(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
    c.translate(64, 64);
    c.fillStyle = 'rgba(255,255,255,0.95)';
    for (let i = 0; i < 8; i++) {
      c.rotate(Math.PI / 4 + 0.1);
      c.beginPath();
      c.moveTo(0, -3);
      c.lineTo(62 - (i % 2) * 26, 0);
      c.lineTo(0, 3);
      c.fill();
    }
  });

export type Stage = ReturnType<typeof makeStage>;

export function makeStage(el: HTMLElement, phone: boolean) {
  const renderer = new THREE.WebGLRenderer({ antialias: !phone, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, phone ? 1 : 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#05030a');
  scene.fog = new THREE.FogExp2('#12061c', 0.022);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  camera.position.set(0, 1.6, 6);

  // ── Post: bloom, then a cyber grade (teal shadows, magenta highlights), vignette, hit aberration ──
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), phone ? 0.5 : 0.65, 0.6, 0.85);
  composer.addPass(bloom);
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uVig: { value: 0.6 }, uAb: { value: 0 }, uFlash: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig; uniform float uAb; uniform float uFlash; varying vec2 vUv;
      void main(){
        vec2 off = (vUv - 0.5) * uAb;
        vec4 c = texture2D(tDiffuse, vUv);
        c.r = texture2D(tDiffuse, vUv + off).r;
        c.b = texture2D(tDiffuse, vUv - off).b;
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = mix(vec3(l), c.rgb, 1.18);
        c.rgb *= mix(vec3(0.78, 0.92, 1.12), vec3(1.1, 0.98, 1.04), smoothstep(0.02, 0.7, l));
        c.rgb = pow(max(c.rgb, vec3(0.0)), vec3(1.05));
        float d = distance(vUv, vec2(0.5));
        c.rgb *= 1.0 - smoothstep(0.3, 0.95, d) * uVig;
        c.rgb += uFlash;
        gl_FragColor = c;
      }`,
  });
  composer.addPass(grade);
  composer.addPass(new OutputPass());

  const roofStart = scene.children.length;
  // ── Sky: gradient dome + a low magenta sun, DR-style ──
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(200, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {},
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; void main(){
        float h = vP.y;
        vec3 top = vec3(0.01, 0.005, 0.03);
        vec3 hor = vec3(0.32, 0.03, 0.26);
        vec3 c = mix(hor, top, smoothstep(-0.02, 0.45, h));
        c += vec3(0.05, 0.35, 0.45) * pow(max(0.0, 1.0 - abs(h - 0.02) * 9.0), 3.0) * 0.4;
        gl_FragColor = vec4(c, 1.0);
      }`,
    }),
  );
  scene.add(sky);
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(22, 64),
    new THREE.ShaderMaterial({
      transparent: true,
      fog: false,
      depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; void main(){
        float y = vUv.y;
        vec3 c = mix(vec3(1.6, 0.1, 0.9), vec3(2.2, 1.6, 0.2), y);
        float band = step(0.5, fract(y * 14.0 + y * y * 6.0)) + step(0.55, y);
        if (band < 0.5 && y < 0.55) discard;
        gl_FragColor = vec4(c, 1.0);
      }`,
    }),
  );
  sun.position.set(0, 14, -150);
  scene.add(sun);

  // ── The rooftop dojo floor ──
  const ft = floorTextures();
  const floorMat = new THREE.MeshStandardMaterial({ map: ft.map, emissiveMap: ft.glow, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.55, roughness: 0.32, metalness: 0.55 });
  const floorR = RING + 0.8;
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(floorR, floorR + 0.3, 0.5, 96, 1), [
    new THREE.MeshStandardMaterial({ color: '#0d0d14', roughness: 0.6, metalness: 0.4, emissive: new THREE.Color(PINK), emissiveIntensity: 0.05 }),
    floorMat,
    floorMat,
  ]);
  // map the top cap UVs to a disc
  floor.position.y = -0.25;
  floor.receiveShadow = true;
  scene.add(floor);
  // neon lip around the edge
  const lip = new THREE.Mesh(new THREE.TorusGeometry(floorR + 0.02, 0.04, 8, 160), new THREE.MeshBasicMaterial({ color: new THREE.Color(PINK).multiplyScalar(3), toneMapped: false }));
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.0;
  scene.add(lip);
  const lip2 = new THREE.Mesh(new THREE.TorusGeometry(floorR + 0.32, 0.025, 8, 160), new THREE.MeshBasicMaterial({ color: new THREE.Color(CYAN).multiplyScalar(2.5), toneMapped: false }));
  lip2.rotation.x = Math.PI / 2;
  lip2.position.y = -0.5;
  scene.add(lip2);

  // the roof below the platform
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: '#07070b', roughness: 0.25, metalness: 0.7 }));
  roof.rotation.x = -Math.PI / 2;
  roof.position.y = -0.52;
  roof.receiveShadow = true;
  scene.add(roof);

  // torii-style gate frames + light pillars around the ring
  const pillarMat = new THREE.MeshStandardMaterial({ color: '#111018', roughness: 0.4, metalness: 0.6 });
  const neon = (c: string, k = 3) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });
  const ringGroup = new THREE.Group();
  scene.add(ringGroup);
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + Math.PI / N;
    const r = floorR + 1.4;
    const g = new THREE.Group();
    g.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
    g.rotation.y = a;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.28, 4.2, 0.28), pillarMat);
    p.position.y = 1.6;
    p.castShadow = true;
    g.add(p);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 3.8, 0.05), neon(i % 2 ? CYAN : PINK, 3.2));
    strip.position.set(0, 1.6, -0.16);
    g.add(strip);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), neon(YELLOW, 1.6));
    cap.position.y = 3.75;
    g.add(cap);
    ringGroup.add(g);
  }

  // ── The city: towers with lit windows, neon crowns, billboards ──
  const wt = windowsTex();
  const towerMat = new THREE.MeshStandardMaterial({ color: '#0b0a12', roughness: 0.7, metalness: 0.3, emissiveMap: wt, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 1.1 });
  const towers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), towerMat, 170);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let ti = 0;
  const crowns: THREE.Mesh[] = [];
  while (ti < 170) {
    const a = Math.random() * Math.PI * 2;
    const r = 16 + Math.random() * 60;
    const w = 3 + Math.random() * 6;
    const h = 6 + Math.random() * (r > 40 ? 50 : 28);
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
    m4.compose(new THREE.Vector3(x, h / 2 - 22, z), q, new THREE.Vector3(w, h, w * (0.7 + Math.random() * 0.6)));
    towers.setMatrixAt(ti++, m4);
    if (Math.random() < 0.18) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, 0.25, w * 1.02), neon(Math.random() < 0.5 ? PINK : CYAN, 2.2));
      c.position.set(x, h - 22 + 0.1, z);
      c.quaternion.copy(q);
      scene.add(c);
      crowns.push(c);
    }
  }
  scene.add(towers);

  const billboard = (tex: THREE.Texture, w: number, h: number, pos: [number, number, number], rotY: number) => {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false, fog: true }));
    b.position.set(...pos);
    b.rotation.y = rotY;
    scene.add(b);
    return b;
  };
  billboard(
    signTex(
      [
        { text: 'NINJA PUNK GIRLS', font: 'italic 900 120px Impact, "Arial Black", sans-serif', color: '#ffffff', y: 110 },
        { text: '忍者パンクガールズ · ARENA', font: '700 44px "Hiragino Sans", sans-serif', color: CYAN, y: 200 },
      ],
      '#e0119d',
    ),
    16, 4, [-14, 9, -26], 0.45,
  );
  billboard(
    signTex([{ text: 'NPG', font: 'italic 900 200px Impact, sans-serif', color: '#111', y: 130 }], YELLOW, 512, 256, true),
    7, 3.5, [16, 6, -22], -0.6,
  );
  billboard(
    signTex(
      [
        { text: '闘', font: '900 200px "Hiragino Sans", sans-serif', color: PINK, y: 140 },
      ],
      '#04161a', 256, 256,
    ),
    4, 4, [22, 12, 6], -1.4,
  );
  billboard(
    signTex(
      [
        { text: 'TOKENBLASTER', font: 'italic 900 110px Impact, sans-serif', color: '#04161a', y: 105 },
        { text: '.LOL  //  ROUND  //  FIGHT  //  K.O.', font: '700 40px "Courier New", monospace', color: '#04161a', y: 195 },
      ],
      CYAN,
    ),
    14, 3.5, [-20, 5, 14], 1.9,
  );

  // everything added since roofStart is the rooftop set (sky, city, floor, signs); the dojo swaps it out
  const rooftop = scene.children.slice(roofStart);
  const roofFog = scene.fog;
  const roofBg = scene.background;

  // ── Lights ──
  scene.add(new THREE.HemisphereLight('#5a4a8a', '#0a0610', 0.9));
  const key = new THREE.DirectionalLight('#fff0f8', 2.2);
  key.position.set(3, 9, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(phone ? 1024 : 2048, phone ? 1024 : 2048);
  const sc = key.shadow.camera;
  sc.left = sc.bottom = -7;
  sc.right = sc.top = 7;
  sc.near = 1;
  sc.far = 25;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rimP = new THREE.PointLight(PINK, 28, 16, 1.6);
  rimP.position.set(-5, 3.5, -4);
  const rimC = new THREE.PointLight(CYAN, 24, 16, 1.6);
  rimC.position.set(5, 3, -4);
  const front = new THREE.PointLight('#ffd9f0', 6, 12, 1.8);
  front.position.set(0, 2.5, 6);
  scene.add(rimP, rimC, front);
  const hitLight = new THREE.PointLight('#ffffff', 0, 6, 2);
  scene.add(hitLight);

  // ── Rain streaks (cheap) ──
  const RAIN = phone ? 500 : 1400;
  const rainGeo = new THREE.BufferGeometry();
  const rp = new Float32Array(RAIN * 6);
  for (let i = 0; i < RAIN; i++) {
    const x = (Math.random() - 0.5) * 30, y = Math.random() * 14, z = (Math.random() - 0.5) * 30;
    rp.set([x, y, z, x + 0.03, y - 0.35, z], i * 6);
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#9fdcff', transparent: true, opacity: 0.22, depthWrite: false }));
  scene.add(rain);
  rooftop.push(rain);

  // ── The cyber dojo (loaded on first use) ──
  let dojo: THREE.Group | null = null;
  let dojoLoad: Promise<THREE.Group> | null = null;
  const dojoLights = new THREE.Group();
  {
    // neon practicals inside the hall: magenta + cyan from the shoji walls, a warm overhead over the mat
    const top = new THREE.PointLight('#ffe6f6', 7, 16, 1.6);
    top.position.set(0, 7, 0);
    const m = new THREE.PointLight(PINK, 10, 14, 1.8);
    m.position.set(-6, 7, 6);
    const c = new THREE.PointLight(CYAN, 10, 14, 1.8);
    c.position.set(6, 7, -6);
    dojoLights.add(top, m, c);
    dojoLights.visible = false;
    scene.add(dojoLights);
  }
  const loadDojo = () =>
    (dojoLoad ??= new GLTFLoader().loadAsync(DOJO_URL).then((g) => {
      const root = g.scene;
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.receiveShadow = true;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mt of mats as THREE.MeshStandardMaterial[]) {
          if (!mt.emissive) continue;
          const glow = mt.emissive.r + mt.emissive.g + mt.emissive.b > 0.1;
          // the neon strips bloom; everything else stays a dark lacquered hall
          if (glow) {
            mt.emissiveIntensity = 1.4;
            mt.toneMapped = false;
          } else {
            // the mirror-gloss floor turned every point light into a white hotspot
            mt.roughness = Math.max(mt.roughness, 0.45);
            mt.metalness = Math.min(mt.metalness, 0.4);
          }
          if (!glow && mt.color.r > 0.5) {
            mt.color.multiplyScalar(0.28); // the bright shoji panels would blow out under the neon
            mt.roughness = 0.35;
          }
        }
      });
      root.visible = false;
      scene.add(root);
      dojo = root;
      return root;
    }));
  let kind: StageKind = 'rooftop';

  // ── Hit FX: sparks (points) + flash sprites ──
  const SP = 400;
  const spGeo = new THREE.BufferGeometry();
  const spPos = new Float32Array(SP * 3);
  const spCol = new Float32Array(SP * 3);
  const spVel = new Float32Array(SP * 3);
  const spLife = new Float32Array(SP);
  spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
  spGeo.setAttribute('color', new THREE.BufferAttribute(spCol, 3));
  const sparks = new THREE.Points(
    spGeo,
    new THREE.PointsMaterial({ size: 0.09, map: sparkTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  sparks.frustumCulled = false;
  scene.add(sparks);
  let spNext = 0;
  const flashes: { s: THREE.Sprite; t: number; life: number; size: number }[] = [];
  const fTex = starTex();
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    s.visible = false;
    scene.add(s);
    flashes.push({ s, t: 1, life: 0.2, size: 1 });
  }
  let fNext = 0;
  let shakeAmt = 0;
  let abAmt = 0;
  let flashAmt = 0;

  const burst = (at: THREE.Vector3, color: THREE.Color, n: number, speed: number) => {
    for (let k = 0; k < n; k++) {
      const i = spNext++ % SP;
      spPos.set([at.x, at.y, at.z], i * 3);
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const v = speed * (0.4 + Math.random() * 0.8);
      spVel.set([r * Math.cos(th) * v, Math.abs(u) * v * 0.9 + 1, r * Math.sin(th) * v], i * 3);
      spLife[i] = 0.35 + Math.random() * 0.4;
      const c = color.clone().multiplyScalar(2 + Math.random() * 2);
      spCol.set([c.r, c.g, c.b], i * 3);
    }
  };
  const flash = (at: THREE.Vector3, color: THREE.Color, size: number) => {
    const f = flashes[fNext++ % flashes.length];
    f.s.position.copy(at);
    (f.s.material as THREE.SpriteMaterial).color.copy(color).multiplyScalar(3);
    f.t = 0;
    f.size = size;
    f.s.visible = true;
  };

  const resize = () => {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(el);

  let clock = 0;
  return {
    renderer,
    scene,
    camera,
    /** world-space hit: sparks, flash, light, shake */
    hit(at: THREE.Vector3, opts: { blocked: boolean; heavy: boolean; color: string }) {
      const c = new THREE.Color(opts.blocked ? CYAN : opts.color);
      burst(at, c, opts.blocked ? 14 : opts.heavy ? 50 : 24, opts.heavy ? 5 : 3.5);
      burst(at, new THREE.Color('#ffffff'), opts.heavy ? 20 : 8, 3);
      flash(at, c, opts.heavy ? 1.1 : 0.6);
      hitLight.position.copy(at);
      hitLight.color.copy(c);
      hitLight.intensity = opts.heavy ? 12 : 5;
      shakeAmt = Math.max(shakeAmt, opts.blocked ? 0.04 : opts.heavy ? 0.22 : 0.09);
      abAmt = Math.max(abAmt, opts.heavy ? 0.012 : 0.005);
      if (opts.heavy && !opts.blocked) flashAmt = 0.12;
    },
    dust(at: THREE.Vector3) {
      burst(at, new THREE.Color('#b5a6ff'), 10, 1.6);
    },
    ko() {
      shakeAmt = 0.35;
      abAmt = 0.02;
      flashAmt = 0.3;
    },
    shake: () => shakeAmt,
    get kind() {
      return kind;
    },
    /** Switch sets. Resolves once the set is showing (the dojo loads on first use). */
    async setStage(k: StageKind) {
      if (k === 'dojo') await loadDojo();
      kind = k;
      for (const o of rooftop) o.visible = k === 'rooftop';
      if (dojo) dojo.visible = k === 'dojo';
      dojoLights.visible = k === 'dojo';
      scene.fog = k === 'rooftop' ? roofFog : new THREE.FogExp2('#0a0412', 0.03);
      scene.background = k === 'rooftop' ? roofBg : new THREE.Color('#040208');
    },
    /** advance fx + render. `look` is the camera target; camera position must be set before. */
    render(dt: number) {
      clock += dt;
      // sparks
      for (let i = 0; i < SP; i++) {
        if (spLife[i] <= 0) continue;
        spLife[i] -= dt;
        spVel[i * 3 + 1] -= 9 * dt;
        spPos[i * 3] += spVel[i * 3] * dt;
        spPos[i * 3 + 1] = Math.max(0.02, spPos[i * 3 + 1] + spVel[i * 3 + 1] * dt);
        spPos[i * 3 + 2] += spVel[i * 3 + 2] * dt;
        if (spLife[i] <= 0) spPos[i * 3 + 1] = -100;
        const k = Math.max(0, Math.min(1, spLife[i] * 3));
        spCol[i * 3] *= 0.9 + 0.1 * k;
        spCol[i * 3 + 1] *= 0.86 + 0.14 * k;
        spCol[i * 3 + 2] *= 0.86 + 0.14 * k;
      }
      spGeo.attributes.position.needsUpdate = true;
      spGeo.attributes.color.needsUpdate = true;
      for (const f of flashes) {
        if (!f.s.visible) continue;
        f.t += dt;
        const k = f.t / f.life;
        if (k >= 1) {
          f.s.visible = false;
          continue;
        }
        const s = f.size * (0.6 + k * 0.8);
        f.s.scale.set(s, s, s);
        (f.s.material as THREE.SpriteMaterial).opacity = 1 - k;
        f.s.material.rotation = clock * 3;
      }
      hitLight.intensity *= Math.exp(-14 * dt);
      // rain
      if (rain.visible) for (let i = 0; i < RAIN; i++) {
        let y = rp[i * 6 + 1] - 18 * dt;
        if (y < -0.4) y += 14;
        rp[i * 6 + 1] = y;
        rp[i * 6 + 4] = y - 0.35;
      }
      rainGeo.attributes.position.needsUpdate = true;
      // shake
      if (shakeAmt > 0.001) {
        camera.position.x += (Math.random() - 0.5) * shakeAmt;
        camera.position.y += (Math.random() - 0.5) * shakeAmt;
        shakeAmt *= Math.exp(-9 * dt);
      }
      abAmt *= Math.exp(-8 * dt);
      flashAmt *= Math.exp(-10 * dt);
      grade.uniforms.uAb.value = abAmt;
      grade.uniforms.uFlash.value = flashAmt;
      composer.render(dt);
    },
    dispose() {
      ro.disconnect();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mt of mats) {
          for (const v of Object.values(mt)) if (v instanceof THREE.Texture) v.dispose();
          mt.dispose();
        }
      });
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
