/**
 * Shooting Gallery set: a rain-wet night street running up to the OMNICORE DYNAMICS tower (red-eye logo,
 * 8 x 14 smashable windows, a lobby of server racks), a canyon of lit towers either side, neon, street
 * lamps, searchlights and rain. All original. PBR ground/brick/metal from the shared look sets
 * (src/lib/visuals/look.ts), a procedural neon IBL like the BSVGun range, filmic lights like the Arena.
 *
 * Coordinates: the player stands at the origin looking down -Z. The tower face is at z = TOWER.z.
 */
import * as THREE from 'three';
import type { Look } from '../visuals/look';
import { halo } from '../bsvgun/targets';

export const TOWER = { z: -70, w: 34, h: 56, d: 26, cols: 8, rows: 10, winY0: 12 };
export const EYE = 1.62;

export type Window = { i: number; x: number; y: number; hp: number; broke: boolean; lit: number };
export type Rack = { mesh: THREE.Mesh; hp: number; broke: boolean; t: number };

export type City = {
  group: THREE.Group;
  windows: THREE.InstancedMesh;
  wins: Window[];
  racks: Rack[];
  towerBody: THREE.Mesh;
  ground: THREE.Mesh;
  eye: THREE.Group;
  hitLight: THREE.PointLight;
  breakWindow: (w: Window) => void;
  breakRack: (r: Rack) => void;
  rebuild: () => void;
  update: (dt: number, t: number, cam: THREE.Camera) => void;
  dispose: () => void;
};

const neon = (c: string, k = 2.4) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Office-block facade: dark panels with a scatter of lit windows (map + emissive). */
function facade(seed: number) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const draw = (g: CanvasRenderingContext2D, emissive: boolean) => {
    g.fillStyle = emissive ? '#000' : '#141a26';
    g.fillRect(0, 0, 256, 512);
    s = seed;
    for (let y = 6; y < 512; y += 16)
      for (let x = 6; x < 256; x += 14) {
        const v = r();
        if (emissive) {
          if (v > 0.8) {
            g.fillStyle = v > 0.93 ? '#9fd8ff' : v > 0.86 ? '#ffe1b0' : '#ffb766';
            g.globalAlpha = 0.5 + r() * 0.5;
            g.fillRect(x, y, 9, 10);
            g.globalAlpha = 1;
          }
        } else {
          g.fillStyle = v > 0.72 ? '#3a3a3a' : '#0b0f18';
          g.fillRect(x, y, 9, 10);
        }
      }
  };
  const map = canvasTex(256, 512, (g) => draw(g, false));
  const em = canvasTex(256, 512, (g) => draw(g, true));
  map.wrapS = map.wrapT = em.wrapS = em.wrapT = THREE.RepeatWrapping;
  return { map, em };
}

export function buildCity({ renderer, scene, high, look }: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; high: boolean; look: Look }): City {
  const group = new THREE.Group();
  const disp: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(o: T) => (disp.push(o), o);

  // ── IBL: a dark dome with neon strips, so chrome and wet asphalt have something to reflect ──
  const envScene = new THREE.Scene();
  envScene.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(50, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: 'varying vec3 p; void main(){ float h = normalize(p).y; vec3 lo = vec3(0.10,0.05,0.10); vec3 hi = vec3(0.01,0.02,0.06); gl_FragColor = vec4(mix(lo, hi, smoothstep(-0.1,0.7,h)),1.); }',
      }),
    ),
  );
  const strip = (c: string, k: number, w: number, h: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide, toneMapped: false }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  };
  strip('#ff2a2a', 7, 30, 4, 0, 16, -40);
  strip('#27e6ff', 6, 34, 3, -30, 10, -10);
  strip('#ffb35a', 5, 30, 3, 30, 12, -6);
  strip('#ff2f92', 4, 20, 4, 18, 24, 20);
  strip('#ffffff', 3, 14, 2, -8, 32, -12);
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(envScene, 0.03).texture;
  pm.dispose();
  envScene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  scene.environment = env;
  scene.environmentIntensity = 0.85;
  scene.background = new THREE.Color('#05070f');
  scene.fog = new THREE.FogExp2('#0a1020', 0.0095);

  // ── Sky dome: storm clouds lit orange from below, the red eye's glow, stars ──
  const skyMat = track(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uT: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: /* glsl */ `
        varying vec3 vP; uniform float uT;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vn(p); p*=2.03; a*=0.5; } return s; }
        void main(){
          vec3 d = normalize(vP);
          float y = d.y;
          vec3 c = mix(vec3(0.20,0.07,0.08), vec3(0.04,0.05,0.11), smoothstep(0.0,0.25,y));
          c = mix(c, vec3(0.006,0.01,0.03), smoothstep(0.2,0.8,y));
          vec2 cp = vec2(atan(d.x,d.z)*1.8 + uT*0.006, y*3.0);
          float cl = fbm(cp*2.4);
          c += vec3(0.45,0.16,0.10) * cl * smoothstep(0.0,0.35,y) * (1.0-smoothstep(0.3,0.8,y)) * 0.6;
          // red glow over the tower
          vec3 td = normalize(vec3(0.0, 0.55, -1.0));
          c += vec3(0.6,0.03,0.02) * pow(max(dot(d, td), 0.0), 18.0) * 0.8;
          vec2 g = floor(vec2(atan(d.x,d.z)*80.0, y*120.0));
          float s = step(0.997, h21(g)) * smoothstep(0.25,0.6,y) * (1.0 - cl);
          c += vec3(s) * (0.6 + 0.4*sin(uT*2.0 + h21(g)*30.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  const sky = new THREE.Mesh(track(new THREE.SphereGeometry(400, 32, 20)), skyMat);
  sky.renderOrder = -10;
  group.add(sky);

  // ── Lights ──
  group.add(new THREE.HemisphereLight('#5d6ed0', '#2a0a10', 0.45));
  const moon = new THREE.DirectionalLight('#9fb2ff', 1.2);
  moon.position.set(-40, 70, 10);
  moon.target.position.set(0, 0, -40);
  if (high) {
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const c = moon.shadow.camera;
    c.left = -50;
    c.right = 50;
    c.top = 60;
    c.bottom = -60;
    c.near = 10;
    c.far = 200;
    moon.shadow.bias = -0.0005;
    moon.shadow.normalBias = 0.05;
  }
  group.add(moon, moon.target);
  const redWash = new THREE.PointLight('#ff2418', high ? 500 : 300, 90, 1.6);
  redWash.position.set(0, TOWER.h - 4, TOWER.z + 14);
  group.add(redWash);
  const hitLight = new THREE.PointLight('#ffd27a', 0, 26, 1.6);
  group.add(hitLight);

  // ── Ground: wet asphalt street, sidewalks, lane markings ──
  const asphalt = look.material('concrete_floor_02', [24, 60], '#4a505c', 0.35);
  asphalt.roughness = 0.32;
  asphalt.envMapIntensity = 1.5;
  track(asphalt);
  const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(60, 240)), asphalt);
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -80;
  ground.receiveShadow = true;
  group.add(ground);
  const walkMat = track(look.material('large_floor_tiles_02', [6, 60], '#6b6f78', 0.1));
  for (const sx of [-1, 1]) {
    const walk = new THREE.Mesh(track(new THREE.BoxGeometry(10, 0.25, 240)), walkMat);
    walk.position.set(sx * 21, 0.12, -80);
    walk.receiveShadow = true;
    group.add(walk);
  }
  const laneMat = track(new THREE.MeshStandardMaterial({ color: '#d8c890', roughness: 0.5, emissive: '#3a3420' }));
  for (let z = -4; z > -150; z -= 9) {
    const m = new THREE.Mesh(track(new THREE.PlaneGeometry(0.25, 4)), laneMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.02, z);
    group.add(m);
  }

  // ── Canyon of towers either side ──
  const blds: THREE.Mesh[] = [];
  let seed = 11;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const fac = [facade(7), facade(31), facade(97)];
  for (const f of fac) disp.push(f.map, f.em);
  const bldMats = fac.map((f) => track(new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.em, emissive: '#ffffff', emissiveIntensity: 0.75, roughness: 0.55, metalness: 0.4 })));
  for (const sx of [-1, 1])
    for (let z = -6; z > -170; ) {
      const w = 12 + r() * 10;
      const h = 22 + r() * 70;
      const d = 14 + r() * 10;
      const geo = track(new THREE.BoxGeometry(d, h, w));
      // repeat the facade to the building's size
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 12), uv.getY(i) * (h / 24));
      const m = new THREE.Mesh(geo, bldMats[Math.floor(r() * 3)]);
      m.position.set(sx * (27 + d / 2), h / 2, z - w / 2);
      m.castShadow = high;
      m.receiveShadow = true;
      group.add(m);
      blds.push(m);
      z -= w + 2 + r() * 4;
    }

  // ── Neon signs (original copy) ──
  const sign = (text: string, color: string, x: number, y: number, z: number, side: 1 | -1, w = 12) => {
    const t = canvasTex(512, 128, (g) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, 512, 128);
      g.font = '900 italic 78px Impact, "Arial Black", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = color;
      g.shadowBlur = 18;
      g.fillStyle = color;
      g.fillText(text, 256, 68);
    });
    disp.push(t);
    const m = new THREE.Mesh(track(new THREE.PlaneGeometry(w, w / 4)), track(new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color('#ffffff').multiplyScalar(1.1), toneMapped: false, blending: THREE.AdditiveBlending, transparent: true })));
    m.position.set(x, y, z);
    m.rotation.y = side * Math.PI / 2;
    group.add(m);
  };
  sign('TOKENBLASTER', '#ffb800', -21.9, 14, -26, 1);
  sign('BLOCK 21', '#27e6ff', 21.9, 10, -40, -1, 10);
  sign('NIGHT SHIFT', '#ff2f92', -21.9, 22, -60, 1, 11);
  sign('NO REFUNDS*', '#e8261d', 21.9, 26, -88, -1, 11);

  // ── Street lamps ──
  const poleMat = track(new THREE.MeshStandardMaterial({ color: '#1b1e25', roughness: 0.5, metalness: 0.8 }));
  const bulbMat = neon('#ffcf8a', 3);
  track(bulbMat);
  const lamps: THREE.PointLight[] = [];
  for (let i = 0; i < 6; i++) {
    const sx = i % 2 ? 1 : -1;
    const z = -10 - i * 14;
    const pole = new THREE.Mesh(track(new THREE.CylinderGeometry(0.12, 0.16, 8, 8)), poleMat);
    pole.position.set(sx * 16.5, 4, z);
    const arm = new THREE.Mesh(track(new THREE.BoxGeometry(2.6, 0.15, 0.15)), poleMat);
    arm.position.set(sx * 15.3, 8, z);
    const bulb = new THREE.Mesh(track(new THREE.BoxGeometry(0.9, 0.12, 0.4)), bulbMat);
    bulb.position.set(sx * 14.3, 7.9, z);
    group.add(pole, arm, bulb);
    const glow = halo('#ffb860', 3.2, 0.55);
    glow.position.copy(bulb.position);
    group.add(glow);
    if (high || i < 3) {
      const l = new THREE.PointLight('#ffb35a', 60, 26, 1.7);
      l.position.set(sx * 14.3, 7.4, z);
      group.add(l);
      lamps.push(l);
    }
  }

  // ── OMNICORE DYNAMICS tower ──
  const T = TOWER;
  const glass = track(
    new THREE.MeshPhysicalMaterial({ color: '#0b1222', metalness: 0.9, roughness: 0.16, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.08 }),
  );
  const towerBody = new THREE.Mesh(track(new THREE.BoxGeometry(T.w, T.h, T.d)), glass);
  towerBody.position.set(0, T.h / 2, T.z - T.d / 2);
  towerBody.castShadow = high;
  towerBody.receiveShadow = true;
  group.add(towerBody);
  // mullions
  const mull = track(new THREE.MeshStandardMaterial({ color: '#2a3346', roughness: 0.35, metalness: 0.9 }));
  const cw = (T.w - 4) / T.cols;
  const ch = (T.h - T.winY0 - 10) / T.rows;
  for (let c = 0; c <= T.cols; c++) {
    const m = new THREE.Mesh(track(new THREE.BoxGeometry(0.35, T.h - T.winY0 - 6, 0.5)), mull);
    m.position.set(-T.w / 2 + 2 + c * cw, T.winY0 + (T.h - T.winY0 - 6) / 2 - 2, T.z + 0.2);
    group.add(m);
  }
  for (let rr = 0; rr <= T.rows; rr++) {
    const m = new THREE.Mesh(track(new THREE.BoxGeometry(T.w - 3, 0.3, 0.5)), mull);
    m.position.set(0, T.winY0 + rr * ch - 0.2, T.z + 0.2);
    group.add(m);
  }
  // crown: stepped top, antenna, beacon
  const crown = new THREE.Mesh(track(new THREE.CylinderGeometry(0.1, T.w * 0.62, 14, 4, 1)), glass);
  crown.rotation.y = Math.PI / 4;
  crown.position.set(0, T.h + 7, T.z - T.d / 2);
  group.add(crown);
  const ant = new THREE.Mesh(track(new THREE.CylinderGeometry(0.15, 0.3, 22, 6)), mull);
  ant.position.set(0, T.h + 24, T.z - T.d / 2);
  group.add(ant);
  const beacon = halo('#ff2020', 4, 0.9);
  beacon.position.set(0, T.h + 35.5, T.z - T.d / 2);
  group.add(beacon);

  // windows: one instanced mesh, per-window colour
  const wins: Window[] = [];
  const winGeo = track(new THREE.PlaneGeometry(cw - 0.9, ch - 0.8));
  const winMat = track(new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: true, fog: true }));
  const windows = new THREE.InstancedMesh(winGeo, winMat, T.cols * T.rows);
  const mtx = new THREE.Matrix4();
  const col = new THREE.Color();
  const litColor = (lit: number) => (lit > 0.82 ? col.set('#ffd9a6').multiplyScalar(1.15) : lit > 0.55 ? col.set('#8fd0ff').multiplyScalar(0.95) : col.set('#1a2846').multiplyScalar(0.9));
  const placeWindows = () => {
    wins.length = 0;
    let s2 = 4242;
    const rr = () => ((s2 = (s2 * 16807) % 2147483647) / 2147483647);
    for (let row = 0; row < T.rows; row++)
      for (let c = 0; c < T.cols; c++) {
        const i = row * T.cols + c;
        const x = -T.w / 2 + 2 + cw * (c + 0.5);
        const y = T.winY0 + ch * (row + 0.5);
        const lit = rr();
        wins.push({ i, x, y, hp: 30, broke: false, lit });
        mtx.makeTranslation(x, y, T.z + 0.06);
        windows.setMatrixAt(i, mtx);
        windows.setColorAt(i, litColor(lit));
      }
    windows.instanceMatrix.needsUpdate = true;
    if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
  };
  placeWindows();
  group.add(windows);
  const burning: Window[] = [];
  const breakWindow = (w: Window) => {
    w.broke = true;
    windows.setColorAt(w.i, col.set('#120604'));
    if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
    if (Math.random() < 0.35) burning.push(w);
  };

  // logo: OMNICORE / DYNAMICS with the red eye
  const logoTex = canvasTex(1024, 256, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 1024, 256);
    g.font = '900 120px "Arial Black", Impact, sans-serif';
    g.textBaseline = 'middle';
    g.fillStyle = '#eef3fb';
    g.shadowColor = '#9fc0ff';
    g.shadowBlur = 10;
    g.fillText('OMNICORE', 250, 108);
    g.font = '700 46px Arial, sans-serif';
    g.fillStyle = '#ff4a3a';
    g.shadowColor = '#ff2020';
    g.fillText('D  Y  N  A  M  I  C  S', 258, 200);
  });
  disp.push(logoTex);
  const logo = new THREE.Mesh(
    track(new THREE.PlaneGeometry(30, 7.5)),
    track(new THREE.MeshBasicMaterial({ map: logoTex, color: new THREE.Color('#ffffff').multiplyScalar(1.6), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending })),
  );
  logo.position.set(2.2, T.h - 3.8, T.z + 0.4);
  group.add(logo);
  const eye = new THREE.Group();
  eye.position.set(-12.6, T.h - 4.4, T.z + 0.8);
  const sclera = new THREE.Mesh(track(new THREE.SphereGeometry(2.4, 32, 16)), track(new THREE.MeshStandardMaterial({ color: '#1a0204', roughness: 0.2, metalness: 0.6 })));
  sclera.scale.set(1.5, 0.8, 0.4);
  const iris = new THREE.Mesh(track(new THREE.SphereGeometry(1.0, 24, 12)), track(neon('#ff2a1a', 4)));
  iris.position.z = 0.75;
  iris.scale.z = 0.4;
  const ring = new THREE.Mesh(track(new THREE.TorusGeometry(2.6, 0.18, 8, 48)), track(neon('#ff3030', 3)));
  ring.scale.set(1.45, 0.82, 1);
  const eyeGlow = halo('#ff2a1a', 12, 0.65);
  eye.add(sclera, iris, ring, eyeGlow);
  group.add(eye);

  // lobby: server racks behind the canopy
  const canopy = new THREE.Mesh(track(new THREE.BoxGeometry(T.w + 4, 0.6, 7)), mull);
  canopy.position.set(0, 9, T.z + 3);
  group.add(canopy);
  const canopyLight = new THREE.Mesh(track(new THREE.BoxGeometry(T.w + 2, 0.1, 0.4)), track(neon('#27e6ff', 3)));
  canopyLight.position.set(0, 8.66, T.z + 6.3);
  group.add(canopyLight);
  const rackTex = canvasTex(64, 128, (g) => {
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, 64, 128);
    for (let y = 6; y < 128; y += 8) {
      g.fillStyle = '#0d1520';
      g.fillRect(4, y, 56, 6);
      for (let x = 8; x < 58; x += 6) {
        g.fillStyle = Math.random() < 0.5 ? '#27e6ff' : Math.random() < 0.3 ? '#ff3030' : '#0a3a44';
        g.fillRect(x, y + 2, 3, 2);
      }
    }
  });
  rackTex.wrapS = rackTex.wrapT = THREE.RepeatWrapping;
  disp.push(rackTex);
  const racks: Rack[] = [];
  const rackMats: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 8; i++) {
    const mat = track(new THREE.MeshStandardMaterial({ color: '#141a24', metalness: 0.7, roughness: 0.4, emissive: '#ffffff', emissiveMap: rackTex.clone(), emissiveIntensity: 2.2 }));
    mat.emissiveMap!.repeat.set(1, 1);
    mat.emissiveMap!.needsUpdate = true;
    rackMats.push(mat);
    const m = new THREE.Mesh(track(new THREE.BoxGeometry(2.6, 6.4, 1.6)), mat);
    m.position.set(-T.w / 2 + 4 + i * ((T.w - 8) / 7), 3.2, T.z + 2.2);
    m.castShadow = high;
    group.add(m);
    racks.push({ mesh: m, hp: 160, broke: false, t: 0 });
  }
  const breakRack = (rk: Rack) => {
    rk.broke = true;
    const mat = rk.mesh.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 0.05;
    mat.color.set('#0a0a0a');
    rk.mesh.rotation.z = (Math.random() - 0.5) * 0.25;
  };
  const rebuild = () => {
    placeWindows();
    burning.length = 0;
    for (const rk of racks) {
      rk.broke = false;
      rk.hp = 160;
      const mat = rk.mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 2.2;
      mat.color.set('#141a24');
      rk.mesh.rotation.z = 0;
    }
  };

  // ── Searchlights from the crown ──
  const beams: THREE.Mesh[] = [];
  const beamMat = track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uC: { value: new THREE.Color('#bcd4ff') } },
      vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform vec3 uC; varying float vY; void main(){ gl_FragColor = vec4(uC * 0.16 * pow(vY, 1.6), 1.0); }',
    }),
  );
  for (let i = 0; i < 2; i++) {
    const g = new THREE.Group();
    g.position.set(i ? 9 : -9, T.h + 2, T.z - 4);
    const cone = new THREE.Mesh(track(new THREE.CylinderGeometry(9, 0.6, 160, 24, 1, true)), beamMat);
    cone.position.y = 80;
    g.add(cone);
    group.add(g);
    beams.push(g as unknown as THREE.Mesh);
  }

  // ── Rain ──
  let rain: THREE.LineSegments | null = null;
  const RN = high ? 2600 : 900;
  const rp = new Float32Array(RN * 6);
  if (RN) {
    for (let i = 0; i < RN; i++) {
      const x = (Math.random() - 0.5) * 70;
      const y = Math.random() * 40;
      const z = -Math.random() * 90 + 6;
      rp.set([x, y, z, x + 0.05, y - 0.9, z], i * 6);
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rain = new THREE.LineSegments(g, track(new THREE.LineBasicMaterial({ color: '#9fb8d8', transparent: true, opacity: 0.32, depthWrite: false })));
    rain.frustumCulled = false;
    group.add(rain);
  }

  scene.add(group);

  const tmp = new THREE.Vector3();
  const update = (dt: number, t: number, cam: THREE.Camera) => {
    skyMat.uniforms.uT.value = t;
    beacon.material.opacity = Math.sin(t * 3) > 0 ? 0.95 : 0.1;
    beams[0].rotation.set(Math.sin(t * 0.33) * 0.55, 0, Math.cos(t * 0.27) * 0.45 - 0.2);
    beams[1].rotation.set(Math.cos(t * 0.29) * 0.5, 0, Math.sin(t * 0.35) * 0.45 + 0.2);
    // the eye follows the player
    cam.getWorldPosition(tmp);
    const dx = THREE.MathUtils.clamp((tmp.x - eye.position.x) / 60, -0.4, 0.4);
    iris.position.x = dx * 1.6;
    iris.position.y = -0.4 + Math.sin(t * 0.7) * 0.15;
    (iris.material as THREE.MeshBasicMaterial).color.setRGB(4 + Math.sin(t * 5) * 0.8, 0.4, 0.2);
    eyeGlow.material.opacity = 0.55 + Math.sin(t * 2.3) * 0.15;
    // broken windows: some burn
    if (burning.length) {
      for (const w of burning) windows.setColorAt(w.i, col.setRGB(1.6 + Math.random() * 0.8, 0.45 + Math.random() * 0.25, 0.08));
      if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
    }
    for (let i = 0; i < rackMats.length; i++) {
      const em = rackMats[i].emissiveMap!;
      if (!racks[i].broke) em.offset.y = Math.floor(t * 6 + i) * 0.125;
    }
    for (const l of lamps) l.intensity = 60 * (0.94 + Math.random() * 0.06);
    if (rain) {
      const a = rain.geometry.attributes.position as THREE.BufferAttribute;
      const arr = a.array as Float32Array;
      const fall = dt * 34;
      for (let i = 0; i < RN; i++) {
        const o = i * 6;
        arr[o + 1] -= fall;
        arr[o + 4] -= fall;
        if (arr[o + 4] < 0) {
          const y = 30 + Math.random() * 10;
          arr[o + 1] = y;
          arr[o + 4] = y - 0.9;
        }
      }
      a.needsUpdate = true;
    }
    hitLight.intensity *= Math.pow(0.002, dt);
  };

  return {
    group,
    windows,
    wins,
    racks,
    towerBody,
    ground,
    eye,
    hitLight,
    breakWindow,
    breakRack,
    rebuild,
    update,
    dispose: () => {
      scene.remove(group);
      disp.forEach((d) => d.dispose());
      for (const rk of racks) rk.mesh.geometry.dispose();
      windows.dispose();
      env.dispose();
      scene.environment = null;
    },
  };
}
