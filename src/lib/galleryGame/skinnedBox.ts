import * as THREE from 'three';

const v = new THREE.Vector3();

/**
 * The world-space box of skinned meshes in their current pose, from an even sample of about `samples` vertices per
 * mesh instead of every one. A precise `Box3.setFromObject(m, true)` or `computeBoundingBox()` skins each of a
 * model's 20-30k vertices on the CPU (tens to hundreds of ms on the main thread per model at load); a spread
 * sample finds the same feet, crown and sides to well under a centimetre at game scale.
 */
export function skinnedBox(meshes: Iterable<THREE.SkinnedMesh>, samples = 1500, out = new THREE.Box3()): THREE.Box3 {
  out.makeEmpty();
  for (const sm of meshes) {
    sm.updateMatrixWorld(true);
    sm.skeleton?.update();
    const n = sm.geometry.attributes.position.count;
    const step = Math.max(1, Math.floor(n / samples));
    for (let i = 0; i < n; i += step) out.expandByPoint(sm.getVertexPosition(i, v).applyMatrix4(sm.matrixWorld));
  }
  return out;
}
