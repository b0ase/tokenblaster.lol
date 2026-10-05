/** Three.js side of 1Sat Ordnance: give an ordnance gun its own finish (gold SAFU, red laser…). */
import * as THREE from 'three';

/** How strongly to tint: its own textured model only gets a hint of its finish; stock models get the full colour. */
export const tintAmount = (o: { model?: string; fit?: { tint?: number } }) => o.fit?.tint ?? (o.model ? 0.22 : 0.65);

export function tintGun(group: THREE.Object3D, color: string | undefined, amount = 0.65) {
  if (!color) return;
  const c = new THREE.Color(color);
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const tint = (mat: THREE.Material) => {
      const n = mat.clone() as THREE.MeshStandardMaterial;
      if (n.color) n.color.lerp(c, amount);
      if ('metalness' in n && amount >= 0.5) n.metalness = Math.max(n.metalness, 0.7); // a full recolour reads as a metal finish
      if (n.emissive) n.emissive.lerp(c, 0.12);
      return n;
    };
    m.material = Array.isArray(m.material) ? m.material.map(tint) : tint(m.material);
  });
}

let logoTex: Promise<THREE.Texture> | null = null;
/** The PNEEs logo as a texture (for the PNEE Shotgun's stock). */
function pneeLogo() {
  logoTex ??= new THREE.TextureLoader().loadAsync('/ordnance/pnee-logo.png').then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
  return logoTex;
}

/**
 * Brand marks on a weapon (only the PNEE Shotgun so far): its logo on each side of the stock.
 * Works in `group`'s own frame, so it can be called on a gun already placed in a scene. Resolves
 * once the logo texture has loaded and the marks are attached.
 */
export async function brandGun(group: THREE.Object3D, ordnanceId: string | undefined) {
  if (ordnanceId !== 'pnee-shotgun') return;
  const tex = await pneeLogo();
  group.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const m4 = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const pts: THREE.Vector3[] = [];
  group.traverse((n) => {
    const m = n as THREE.Mesh;
    const pos = m.isMesh ? (m.geometry.getAttribute('position') as THREE.BufferAttribute | undefined) : undefined;
    if (!pos) return;
    m4.multiplyMatrices(toLocal, m.matrixWorld);
    for (let i = 0; i < pos.count; i += 3) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(m4).clone());
  });
  if (!pts.length) return;
  const box = new THREE.Box3().setFromPoints(pts);
  const dim = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());
  const long = dim.x >= dim.z ? 'x' : 'z';
  const side = long === 'x' ? 'z' : 'x';
  const size = Math.max(dim.x, dim.z) * 0.1;
  // Which end is the butt? The stock is the deep end: compare vertical spread in each end fifth.
  const ends = { lo: [Infinity, -Infinity, -Infinity, Infinity], hi: [Infinity, -Infinity, -Infinity, Infinity] }; // y min, y max, side max, side min
  for (const p of pts) {
    const t = p[long] - mid[long];
    const e = t < -dim[long] * 0.3 ? ends.lo : t > dim[long] * 0.3 ? ends.hi : null;
    if (!e) continue;
    e[0] = Math.min(e[0], p.y);
    e[1] = Math.max(e[1], p.y);
    e[2] = Math.max(e[2], p[side]);
    e[3] = Math.min(e[3], p[side]);
  }
  const butt = ends.lo[1] - ends.lo[0] >= ends.hi[1] - ends.hi[0] ? -1 : 1;
  const stock = butt < 0 ? ends.lo : ends.hi;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, metalness: 0.3, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const sgn of [1, -1]) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(size / 2, 48), mat);
    m.position[long] = mid[long] + butt * dim[long] * 0.38;
    m.position.y = (stock[0] + stock[1]) / 2;
    m.position[side] = (sgn > 0 ? stock[2] : stock[3]) + sgn * size * 0.02;
    m.rotation.y = side === 'z' ? (sgn > 0 ? 0 : Math.PI) : sgn > 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(m);
  }
}
