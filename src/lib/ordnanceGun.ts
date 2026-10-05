/** Three.js side of 1Sat Ordnance: give an ordnance gun its own finish (gold SAFU, red laser…). */
import * as THREE from 'three';

export function tintGun(group: THREE.Object3D, color: string | undefined, amount = 0.65) {
  if (!color) return;
  const c = new THREE.Color(color);
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const tint = (mat: THREE.Material) => {
      const n = mat.clone() as THREE.MeshStandardMaterial;
      if (n.color) n.color.lerp(c, amount);
      if ('metalness' in n) n.metalness = Math.max(n.metalness, 0.7);
      if (n.emissive) n.emissive.lerp(c, 0.12);
      return n;
    };
    m.material = Array.isArray(m.material) ? m.material.map(tint) : tint(m.material);
  });
}
