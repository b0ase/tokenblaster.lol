/**
 * The neon night range: a long concrete lane under floodlights, a shooter's booth, clay traps left
 * and right, pop-up stations, rail gantries, earth berms and a back wall with the BSVGUN sign.
 * PBR concrete (Poly Haven CC0, shared with Double-O), a procedural IBL environment of neon strip
 * lights, a star sky, drifting embers. All geometry is static; the engine calls update() per frame.
 */
import * as THREE from 'three';
import { glowTexture } from './targets';

export const RANGE = {
  eye: 1.62,
  half: 30, // lane half-width
  far: -86, // back wall z
  railZ: -34,
  railY: 8,
  rail2Z: -52,
  rail2Y: 4.4,
};

export type Range = {
  group: THREE.Group;
  env: THREE.Texture;
  traps: [THREE.Vector3, THREE.Vector3];
  stations: THREE.Vector3[];
  /** Pulse the neon (0..1) and flash a trap house (0 left, 1 right). */
  update: (t: number, dt: number, pulse: number) => void;
  flashTrap: (side: 0 | 1) => void;
  /** Light that follows the action (the engine moves it to hits). */
  hitLight: THREE.PointLight;
  dispose: () => void;
};

type Opts = { high: boolean; font: string; renderer: THREE.WebGLRenderer; scene: THREE.Scene };

const loader = new THREE.TextureLoader();
const loadTex = (url: string, srgb: boolean, rep: [number, number], aniso: number) =>
  new Promise<THREE.Texture | null>((ok) =>
    loader.load(
      url,
      (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(...rep);
        t.anisotropy = aniso;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        ok(t);
      },
      undefined,
      () => ok(null),
    ),
  );

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const neon = (color: string, k = 2.2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });

export async function buildRange({ high, font, renderer, scene }: Opts): Promise<Range> {
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(o: T) => {
    disposables.push(o);
    return o;
  };
  const aniso = high ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 2;
  const fam = font || 'Impact, "Arial Black", sans-serif';
  try {
    await document.fonts.load(`900 italic 40px ${fam}`);
  } catch {
    /* fall back to Impact */
  }

  // ── Environment map (IBL): dark dome with neon strip lights ──
  const envScene = new THREE.Scene();
  {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(50, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {},
        vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: 'varying vec3 p; void main(){ float h = normalize(p).y; vec3 lo = vec3(0.16,0.045,0.09); vec3 hi = vec3(0.012,0.02,0.07); gl_FragColor = vec4(mix(lo, hi, smoothstep(-0.1,0.7,h)),1.); }',
      }),
    );
    envScene.add(dome);
    const strip = (c: string, k: number, w: number, h: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide, toneMapped: false }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      envScene.add(m);
    };
    strip('#27e6ff', 6, 30, 3, -28, 16, -26);
    strip('#e8261d', 7, 36, 4, 30, 12, -20);
    strip('#ffb800', 5, 26, 3, 0, 24, 8);
    strip('#ff2f92', 4, 22, 4, 0, 8, -40);
    strip('#ffffff', 3, 14, 2, -10, 30, -12);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const envRT = pm.fromScene(envScene, 0.02);
  const env = envRT.texture;
  pm.dispose();
  envScene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });

  // ── Sky ──
  const sky = new THREE.Mesh(
    track(new THREE.SphereGeometry(300, 32, 20)),
    track(
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
          float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*vn(p); p*=2.03; a*=0.5; } return s; }
          void main(){
            vec3 d = normalize(vP);
            float y = d.y;
            vec3 horizon = vec3(0.62,0.11,0.16);
            vec3 mid = vec3(0.13,0.05,0.24);
            vec3 top = vec3(0.012,0.02,0.07);
            vec3 c = mix(horizon, mid, smoothstep(0.0,0.2,y));
            c = mix(c, top, smoothstep(0.16,0.75,y));
            // drifting clouds lit from the city below and the moon
            vec2 cp = vec2(atan(d.x,d.z)*1.6 + uT*0.01, y*3.2);
            float cl = fbm(cp*2.2) * smoothstep(0.02,0.25,y) * smoothstep(0.85,0.3,y);
            c += vec3(0.5,0.12,0.3) * cl * 0.55 * (1.0 - smoothstep(0.0,0.5,y)) + vec3(0.1,0.12,0.3) * cl * 0.35;
            // city glow band right at the horizon, behind the back wall
            c += vec3(0.7,0.18,0.1) * exp(-abs(y-0.01)*26.0) * 0.55;
            // stars
            vec2 g = floor(vec2(atan(d.x,d.z)*70.0, y*110.0));
            float s = step(0.9965, h21(g)) * smoothstep(0.06,0.4,y);
            s *= 0.55 + 0.45*sin(uT*2.0 + h21(g+3.0)*30.0);
            c += vec3(s);
            // moon
            vec3 md = normalize(vec3(-0.42,0.46,-0.78));
            float m = smoothstep(0.9945, 0.9955, dot(d, md));
            c += vec3(0.85,0.9,1.0) * m + vec3(0.22,0.28,0.5) * pow(max(dot(d, md),0.0), 90.0);
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    ),
  );
  sky.renderOrder = -10;
  group.add(sky);

  // ── Lights ──
  const hemi = new THREE.HemisphereLight('#6d7bd6', '#2a0a14', 0.55);
  group.add(hemi);
  const moon = new THREE.DirectionalLight('#8fa8ff', 1.5);
  moon.position.set(-30, 55, -30);
  moon.target.position.set(0, 0, -26);
  if (high) {
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const c = moon.shadow.camera;
    c.left = -38;
    c.right = 38;
    c.top = 46;
    c.bottom = -46;
    c.near = 10;
    c.far = 130;
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 0.05;
  }
  group.add(moon, moon.target);
  const mk = (c: string, i: number, d: number, x: number, y: number, z: number) => {
    const l = new THREE.PointLight(c, i, d, 1.6);
    l.position.set(x, y, z);
    group.add(l);
    return l;
  };
  const boothLamp = mk('#ffb35a', high ? 26 : 14, 14, 0, 3.0, -0.4);
  const redLamp = mk('#ff2a1a', high ? 120 : 60, 32, -22, 4, -9);
  mk('#ff3a2a', 22, 9, -2.1, 2.4, -2);
  mk('#27e6ff', 22, 9, 2.1, 2.4, -2);
  const cyanLamp = high ? mk('#27e6ff', 120, 32, 22, 4, -9) : null;
  const hitLight = new THREE.PointLight('#ffd27a', 0, 22, 1.6);
  group.add(hitLight);
  // Flood spots from the towers.
  const spots: THREE.SpotLight[] = [];
  if (high) {
    for (const [x, z, c] of [[-23, -24, '#cfe0ff'], [23, -24, '#ffe4c4'], [-23, -56, '#ffd0d8'], [23, -56, '#c8f4ff']] as const) {
      const s = new THREE.SpotLight(c, 1500, 90, 0.5, 0.65, 1.6);
      s.position.set(x, 17, z);
      s.target.position.set(x * 0.2, 0, z - 12);
      group.add(s, s.target);
      spots.push(s);
    }
  }

  // ── Ground (PBR concrete) ──
  const [gMap, gNor, gRough] = await Promise.all([
    loadTex('/doubleo/tex/concrete_floor_02/diff.webp', true, [22, 30], aniso),
    loadTex('/doubleo/tex/concrete_floor_02/nor.webp', false, [22, 30], aniso),
    loadTex('/doubleo/tex/concrete_floor_02/rough.webp', false, [22, 30], aniso),
  ]);
  const ground = new THREE.Mesh(
    track(new THREE.PlaneGeometry(160, 150).rotateX(-Math.PI / 2)),
    track(new THREE.MeshStandardMaterial({ map: gMap, normalMap: gNor, roughnessMap: gRough, color: '#6a6672', roughness: 0.62, metalness: 0.15, envMapIntensity: 1.3, normalScale: new THREE.Vector2(1.2, 1.2) })),
  );
  ground.position.set(0, 0, -62);
  ground.receiveShadow = true;
  group.add(ground);

  // Firing line + distance boards.
  const fire = new THREE.Mesh(track(new THREE.BoxGeometry(80, 0.02, 0.35)), track(neon('#ffb800', 1.6)));
  fire.position.set(0, 0.012, -2.6);
  group.add(fire);
  const hazard = canvasTex(256, 32, (g) => {
    g.fillStyle = '#0a0a0c';
    g.fillRect(0, 0, 256, 32);
    g.fillStyle = '#ffb800';
    for (let x = -32; x < 288; x += 32) {
      g.beginPath();
      g.moveTo(x, 32);
      g.lineTo(x + 16, 32);
      g.lineTo(x + 32, 0);
      g.lineTo(x + 16, 0);
      g.fill();
    }
  });
  hazard.wrapS = THREE.RepeatWrapping;
  hazard.repeat.set(20, 1);
  const haz = new THREE.Mesh(track(new THREE.PlaneGeometry(80, 0.6).rotateX(-Math.PI / 2)), track(new THREE.MeshBasicMaterial({ map: hazard, toneMapped: false })));
  haz.position.set(0, 0.014, -3.3);
  group.add(haz);

  for (const [z, label] of [[-12, '12'], [-25, '25'], [-40, '40'], [-60, '60'], [-80, '80']] as const) {
    for (const side of [-1, 1]) {
      const tex = canvasTex(256, 128, (g) => {
        g.fillStyle = '#0a0a0c';
        g.fillRect(0, 0, 256, 128);
        g.strokeStyle = '#ffb800';
        g.lineWidth = 8;
        g.strokeRect(6, 6, 244, 116);
        g.fillStyle = '#f2efe6';
        g.font = `900 italic 92px ${fam}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(label, 108, 68);
        g.fillStyle = '#ffb800';
        g.font = `900 italic 40px ${fam}`;
        g.fillText('M', 206, 84);
      });
      const board = new THREE.Mesh(track(new THREE.PlaneGeometry(4, 2)), track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })));
      board.position.set(side * 21.5, 3.2, z);
      board.rotation.y = -side * 0.5;
      const post = new THREE.Mesh(track(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 8)), track(new THREE.MeshStandardMaterial({ color: '#222228', metalness: 0.8, roughness: 0.4 })));
      post.position.set(side * 21.5, 1.7, z);
      group.add(board, post);
    }
  }

  // ── Edge neon strips and glow pools ──
  const stripGeo = track(new THREE.BoxGeometry(0.18, 0.12, 92));
  const stripR = new THREE.Mesh(stripGeo, track(neon('#e8261d', 2.4)));
  stripR.position.set(-18, 0.06, -46);
  const stripC = new THREE.Mesh(stripGeo, track(neon('#27e6ff', 2.2)));
  stripC.position.set(18, 0.06, -46);
  group.add(stripR, stripC);
  const poolMat = track(new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const poolGeo = track(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));

  // ── Booth ──
  const [mMap, mNor, mRough] = await Promise.all([
    loadTex('/doubleo/tex/metal_plate_02/diff.webp', true, [3, 1], aniso),
    loadTex('/doubleo/tex/metal_plate_02/nor.webp', false, [3, 1], aniso),
    loadTex('/doubleo/tex/metal_plate_02/rough.webp', false, [3, 1], aniso),
  ]);
  const metal = track(new THREE.MeshStandardMaterial({ map: mMap, normalMap: mNor, roughnessMap: mRough, color: '#8b8d98', metalness: 0.75, roughness: 0.55, envMapIntensity: 1.6 }));
  const counter = new THREE.Mesh(track(new THREE.BoxGeometry(5.6, 0.16, 1.5)), metal);
  counter.position.set(0, 1.02, -1.1);
  counter.castShadow = counter.receiveShadow = true;
  const counterFront = new THREE.Mesh(track(new THREE.BoxGeometry(5.6, 0.9, 0.12)), metal);
  counterFront.position.set(0, 0.55, -0.4);
  const edgeLight = new THREE.Mesh(track(new THREE.BoxGeometry(5.6, 0.05, 0.05)), track(neon('#ffb800', 2.2)));
  edgeLight.position.set(0, 1.11, -0.38);
  group.add(counter, counterFront, edgeLight);
  const panelMat = track(new THREE.MeshStandardMaterial({ map: mMap, normalMap: mNor, color: '#7a7c8a', metalness: 0.3, roughness: 0.6, envMapIntensity: 1.2 }));
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(track(new THREE.BoxGeometry(0.12, 3.2, 2.4)), panelMat);
    panel.position.set(side * 2.9, 1.6, -1.3);
    panel.castShadow = true;
    const trim = new THREE.Mesh(track(new THREE.BoxGeometry(0.14, 0.08, 2.4)), track(neon(side < 0 ? '#e8261d' : '#27e6ff', 2.2)));
    trim.position.set(side * 2.9, 3.18, -1.3);
    const band = new THREE.Mesh(track(new THREE.PlaneGeometry(2.3, 0.42)), track(new THREE.MeshBasicMaterial({ map: hazard, toneMapped: false })));
    band.position.set(side * 2.83, 0.55, -1.3);
    band.rotation.y = -side * Math.PI / 2;
    group.add(panel, trim, band);
  }
  const roof = new THREE.Mesh(track(new THREE.BoxGeometry(6, 0.12, 5.4)), metal);
  roof.position.set(0, 3.25, -2.4);
  roof.castShadow = true;
  const lampBar = new THREE.Mesh(track(new THREE.BoxGeometry(2.8, 0.06, 0.16)), track(neon('#ffd9a0', 3)));
  lampBar.position.set(0, 3.17, -1.2);
  group.add(roof, lampBar);
  // Ammo crates on the counter.
  for (const [x, c] of [[-1.9, '#3a4a34'], [-1.55, '#4a3a2a']] as const) {
    const crate = new THREE.Mesh(track(new THREE.BoxGeometry(0.32, 0.2, 0.22)), track(new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.3 })));
    crate.position.set(x, 1.2, -0.95);
    crate.rotation.y = x * 0.2;
    group.add(crate);
  }

  // ── Berms ──
  const [wMap, wNor, wRough] = await Promise.all([
    loadTex('/doubleo/tex/concrete_wall_006/diff.webp', true, [18, 3], aniso),
    loadTex('/doubleo/tex/concrete_wall_006/nor.webp', false, [18, 3], aniso),
    loadTex('/doubleo/tex/concrete_wall_006/rough.webp', false, [18, 3], aniso),
  ]);
  const earth = track(new THREE.MeshStandardMaterial({ map: wMap, normalMap: wNor, roughnessMap: wRough, color: '#3a2a2a', roughness: 0.95, metalness: 0, envMapIntensity: 0.6, side: THREE.DoubleSide }));
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape();
    const pts: [number, number][] = [[0, 0], [16, 0], [13, 5], [5, 7.5], [0, 3.5]];
    pts.forEach(([x, y], i) => (i ? shape.lineTo(x * side, y) : shape.moveTo(x * side, y)));
    shape.closePath();
    const bg = track(new THREE.ExtrudeGeometry(shape, { depth: 98, bevelEnabled: false }));
    bg.translate(0, 0, -98);
    const berm = new THREE.Mesh(bg, earth);
    berm.position.set(side * 33, 0, 6);
    berm.receiveShadow = true;
    group.add(berm);
  }
  // Back wall with the sign.
  const back = new THREE.Mesh(track(new THREE.BoxGeometry(110, 26, 2)), track(new THREE.MeshStandardMaterial({ map: wMap, normalMap: wNor, roughnessMap: wRough, color: '#2a2630', roughness: 0.9, metalness: 0.05 })));
  back.position.set(0, 12, RANGE.far);
  group.add(back);
  const signTex = canvasTex(2048, 512, (g) => {
    g.fillStyle = '#07060b';
    g.fillRect(0, 0, 2048, 512);
    // grid
    g.strokeStyle = 'rgba(39,230,255,0.18)';
    g.lineWidth = 2;
    for (let x = 0; x < 2048; x += 64) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 512);
      g.stroke();
    }
    for (let y = 0; y < 512; y += 64) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(2048, y);
      g.stroke();
    }
    g.fillStyle = '#e8261d';
    g.fillRect(0, 0, 2048, 20);
    g.fillRect(0, 492, 2048, 20);
    g.shadowColor = '#e8261d';
    g.shadowBlur = 40;
    g.fillStyle = '#f2efe6';
    g.font = `900 italic 330px ${fam}`;
    g.textBaseline = 'middle';
    g.fillText('BSVGUN', 110, 250);
    g.shadowBlur = 0;
    g.fillStyle = '#ffb800';
    g.font = `900 italic 74px ${fam}`;
    g.fillText('LIVE CHAIN RANGE', 1230, 160);
    g.fillStyle = '#27e6ff';
    g.font = `700 52px ${fam}`;
    g.fillText('TOKENBLASTER.LOL · EVERY TARGET IS A REAL TX', 1230, 250);
    g.fillStyle = '#ff2f92';
    g.font = '900 120px "Hiragino Sans","Noto Sans JP",sans-serif';
    g.fillText('射撃場', 1230, 380);
    g.fillStyle = '#f2efe6';
    for (let i = 0; i < 38; i++) g.fillRect(1700 + i * 8 + (i % 3), 340, 3 + (i % 4 === 0 ? 3 : 0), 70);
  });
  const sign = new THREE.Mesh(track(new THREE.PlaneGeometry(72, 18)), track(new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false })));
  sign.position.set(0, 15, RANGE.far + 1.2);
  const signFrame = new THREE.Mesh(track(new THREE.BoxGeometry(73.4, 19.4, 0.4)), track(neon('#e8261d', 1.5)));
  signFrame.position.set(0, 15, RANGE.far + 0.9);
  group.add(signFrame, sign);
  // Skyline behind the wall: block towers with lit windows.
  const sky2 = canvasTex(2048, 256, (g) => {
    g.clearRect(0, 0, 2048, 256);
    let x = 0;
    let seed = 7;
    const r = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    while (x < 2048) {
      const w = 40 + r() * 90;
      const h = 60 + r() * 190;
      g.fillStyle = '#0a0812';
      g.fillRect(x, 256 - h, w, h);
      for (let wy = 256 - h + 8; wy < 248; wy += 10)
        for (let wx = x + 5; wx < x + w - 6; wx += 9)
          if (r() > 0.55) {
            g.fillStyle = r() > 0.8 ? '#27e6ff' : r() > 0.5 ? '#ffb800' : '#ff4a5a';
            g.globalAlpha = 0.5 + r() * 0.5;
            g.fillRect(wx, wy, 4, 5);
            g.globalAlpha = 1;
          }
      x += w + 4 + r() * 10;
    }
  });
  const skyline = new THREE.Mesh(track(new THREE.PlaneGeometry(260, 34)), track(new THREE.MeshBasicMaterial({ map: sky2, transparent: true, toneMapped: false, fog: false })));
  skyline.position.set(0, 24, RANGE.far - 30);
  group.add(skyline);

  // ── Light towers ──
  for (const [x, z] of [[-23, -24], [23, -24], [-23, -56], [23, -56]] as const) {
    const pole = new THREE.Mesh(track(new THREE.CylinderGeometry(0.22, 0.34, 17, 10)), track(new THREE.MeshStandardMaterial({ color: '#22232b', metalness: 0.85, roughness: 0.45 })));
    pole.position.set(x, 8.5, z);
    pole.castShadow = true;
    const head = new THREE.Mesh(track(new THREE.BoxGeometry(2.8, 1.1, 0.5)), track(neon('#f4f0e6', 2.6)));
    head.position.set(x, 17.4, z);
    head.lookAt(x * 0.2, 6, z - 14);
    group.add(pole, head);
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.scale.setScalar(22);
    pool.position.set(x * 0.4, 0.02, z - 6);
    group.add(pool);
    // Fake light cone
    const cone = new THREE.Mesh(
      track(new THREE.ConeGeometry(7, 17, 20, 1, true)),
      track(new THREE.MeshBasicMaterial({ color: '#9fb4ff', transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })),
    );
    cone.position.set(x, 8.8, z);
    group.add(cone);
  }

  // ── Trap houses ──
  const traps: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(-21, 1.5, -8), new THREE.Vector3(21, 1.5, -8)];
  const slits: THREE.MeshBasicMaterial[] = [];
  for (const [i, t] of traps.entries()) {
    const side = i === 0 ? -1 : 1;
    const house = new THREE.Mesh(track(new THREE.BoxGeometry(4, 2.6, 3.4)), metal);
    house.position.set(t.x + side * 1.4, 1.3, t.z);
    house.castShadow = house.receiveShadow = true;
    const slitM = track(neon(i === 0 ? '#ff5a1a' : '#27e6ff', 1.4));
    slits.push(slitM);
    const slit = new THREE.Mesh(track(new THREE.BoxGeometry(0.1, 0.5, 2.2)), slitM);
    slit.position.set(t.x + side * 1.4 - side * 2.02, 2.0, t.z);
    const arm = new THREE.Mesh(track(new THREE.BoxGeometry(2.2, 0.12, 0.5)), track(neon(i === 0 ? '#e8261d' : '#27e6ff', 1.8)));
    arm.position.set(t.x + side * 0.4, 2.7, t.z);
    group.add(house, slit, arm);
    const pool = new THREE.Mesh(poolGeo, track(poolMat.clone()));
    (pool.material as THREE.MeshBasicMaterial).color.set(i === 0 ? '#ff4a2a' : '#27e6ff');
    pool.scale.setScalar(13);
    pool.position.set(t.x, 0.03, t.z);
    group.add(pool);
  }

  // ── Pop-up stations ──
  const stations: THREE.Vector3[] = [];
  const baseMat = track(new THREE.MeshStandardMaterial({ color: '#16171d', metalness: 0.7, roughness: 0.5 }));
  const baseGeo = track(new THREE.BoxGeometry(2.2, 0.3, 1.2));
  for (const [x, z] of [[-14, -22], [-7, -24], [0, -26], [7, -24], [14, -22], [-18, -44], [-9, -46], [9, -46], [18, -44], [0, -48]] as const) {
    const b = new THREE.Mesh(baseGeo, baseMat);
    b.position.set(x, 0.15, z);
    b.receiveShadow = true;
    const lip = new THREE.Mesh(track(new THREE.BoxGeometry(2.2, 0.04, 0.06)), track(neon('#ffb800', 1.6)));
    lip.position.set(x, 0.32, z + 0.6);
    group.add(b, lip);
    stations.push(new THREE.Vector3(x, 0.3, z));
  }

  // ── Rails (gantries) ──
  const railMat = track(new THREE.MeshStandardMaterial({ color: '#26272f', metalness: 0.85, roughness: 0.4 }));
  for (const [z, y, half] of [[RANGE.railZ, RANGE.railY + 0.4, 28], [RANGE.rail2Z, RANGE.rail2Y + 0.4, 24]] as const) {
    const beam = new THREE.Mesh(track(new THREE.BoxGeometry(half * 2, 0.35, 0.35)), railMat);
    beam.position.set(0, y, z);
    const glow = new THREE.Mesh(track(new THREE.BoxGeometry(half * 2, 0.05, 0.05)), track(neon('#ffb800', 1.8)));
    glow.position.set(0, y - 0.22, z);
    group.add(beam, glow);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(track(new THREE.CylinderGeometry(0.18, 0.26, y + 0.2, 8)), railMat);
      leg.position.set(s * half, (y + 0.2) / 2, z);
      leg.castShadow = true;
      group.add(leg);
    }
  }

  // ── Props: barrels ──
  const barrelGeo = track(new THREE.CylinderGeometry(0.5, 0.5, 1.1, 14));
  const barrelMat = [track(new THREE.MeshStandardMaterial({ color: '#8a1d17', metalness: 0.5, roughness: 0.5 })), track(new THREE.MeshStandardMaterial({ color: '#2a3a5a', metalness: 0.5, roughness: 0.5 })), track(new THREE.MeshStandardMaterial({ color: '#b88a1a', metalness: 0.5, roughness: 0.5 }))];
  for (let i = 0; i < 22; i++) {
    const side = i % 2 ? 1 : -1;
    const b = new THREE.Mesh(barrelGeo, barrelMat[i % 3]);
    b.position.set(side * (19 + (i * 7) % 5), 0.55, -6 - i * 3.6);
    b.rotation.y = i;
    b.castShadow = b.receiveShadow = true;
    group.add(b);
  }

  // ── Embers / dust ──
  const dustN = high ? 420 : 140;
  const dp = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) {
    dp[i * 3] = (Math.random() - 0.5) * 60;
    dp[i * 3 + 1] = Math.random() * 20;
    dp[i * 3 + 2] = -Math.random() * 100;
  }
  const dustGeo = track(new THREE.BufferGeometry());
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dustGeo, track(new THREE.PointsMaterial({ size: 0.28, map: glowTexture(), color: '#ffb87a', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
  dust.frustumCulled = false;
  group.add(dust);

  // Apply to the scene.
  scene.add(group);
  scene.environment = env;
  scene.environmentIntensity = 0.9;
  scene.background = new THREE.Color('#05060d');
  scene.fog = new THREE.FogExp2('#1a0a1c', high ? 0.0085 : 0.0105);

  const trapFlash = [0, 0];
  return {
    group,
    env,
    traps,
    stations,
    hitLight,
    flashTrap: (s) => {
      trapFlash[s] = 1;
    },
    update: (t, dt, pulse) => {
      (sky.material as THREE.ShaderMaterial).uniforms.uT.value = t;
      const dpArr = dustGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < dustN; i++) {
        dp[i * 3] += Math.sin(t * 0.3 + i) * dt * 0.4;
        dp[i * 3 + 1] += dt * (0.25 + (i % 5) * 0.08);
        if (dp[i * 3 + 1] > 20) dp[i * 3 + 1] = 0;
      }
      dpArr.needsUpdate = true;
      stripR.scale.set(1, 1 + pulse * 0.6, 1);
      stripC.scale.set(1, 1 + pulse * 0.6, 1);
      redLamp.intensity = (high ? 120 : 60) * (0.85 + pulse * 0.3);
      if (cyanLamp) cyanLamp.intensity = 120 * (0.85 + pulse * 0.3);
      boothLamp.intensity = (high ? 26 : 14) * (0.95 + Math.sin(t * 40) * 0.01);
      for (let s = 0; s < 2; s++) {
        trapFlash[s] = Math.max(0, trapFlash[s] - dt * 4);
        slits[s].color.set(s === 0 ? '#ff5a1a' : '#27e6ff').multiplyScalar(1.4 + trapFlash[s] * 5);
      }
      void spots;
    },
    dispose: () => {
      scene.remove(group);
      for (const d of disposables) d.dispose();
      for (const tx of [gMap, gNor, gRough, mMap, mNor, mRough, wMap, wNor, wRough, hazard, signTex, sky2]) tx?.dispose();
      envRT.dispose();
      scene.environment = null;
      scene.fog = null;
    },
  };
}
