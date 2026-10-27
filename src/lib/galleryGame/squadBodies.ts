import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * The squadmates' 3D bodies: the same NPG chibi + hair GLBs as CHOOSE YOUR GIRL (#137, public/terrornode/girls3d),
 * tinted per girl. Desktop only; mobile-lite keeps the portrait billboards.
 */
const BASE = '/terrornode/girls3d/';
export const SQUAD_LOOKS: Record<string, { hair: string; hairTint: string; cloth: string }> = {
  aika: { hair: 'E001MiyukiHair', hairTint: '#c24cf0', cloth: '#3a3156' },
  ayumi: { hair: 'E002YamarashiiHair', hairTint: '#ff3d6e', cloth: '#3c4a4c' },
  kimiko: { hair: 'E003HikaruHair', hairTint: '#22d6a8', cloth: '#2a2236' },
  nao: { hair: 'E011NaoHair', hairTint: '#f6c4dc', cloth: '#f27fb4' },
  kazuyo: { hair: 'E002YamarashiiHair', hairTint: '#b02adf', cloth: '#262230' },
};

/** Height the bodies are scaled to (m). */
export const BODY_H = 1.7;

export async function loadSquadBodies(ids: string[]): Promise<Map<string, THREE.Object3D>> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const load = (f: string) => loader.loadAsync(BASE + f + '.glb');
  const hairs = [...new Set(ids.map((id) => SQUAD_LOOKS[id]?.hair).filter(Boolean))];
  const [body, ...hg] = await Promise.all([load('chibi'), ...hairs.map(load)]);
  const hairOf = Object.fromEntries(hairs.map((h, i) => [h, hg[i].scene]));
  const out = new Map<string, THREE.Object3D>();
  for (const id of ids) {
    const look = SQUAD_LOOKS[id];
    if (!look) continue;
    const model = cloneSkinned(body.scene);
    model.updateMatrixWorld(true);
    let hairBox: THREE.Box3 | null = null;
    let head: THREE.Object3D | null = null;
    model.traverse((o) => {
      if (!head && (o as THREE.Bone).isBone && /head/i.test(o.name)) head = o;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = (mesh.material as THREE.Material).name;
      if (name === 'hair_material') {
        hairBox = new THREE.Box3().setFromObject(mesh);
        mesh.visible = false;
        return;
      }
      if (name === 'weapon_material') return; // squadmates carry the chibi's own blades
      const c = (mesh.material as THREE.MeshStandardMaterial).clone();
      if (name === 'cloth_material') {
        const t = new THREE.Color(look.cloth);
        if (c.emissiveMap) c.emissive = new THREE.Color(1, 1, 1).lerp(t, 0.75);
        else c.color = t;
      }
      mesh.material = c;
      mesh.frustumCulled = false;
    });
    const hb = hairBox as THREE.Box3 | null;
    if (hb) {
      const hair = hairOf[look.hair].clone(true);
      hair.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const m = (mesh.material as THREE.MeshStandardMaterial).clone();
        m.color = new THREE.Color(look.hairTint).lerp(new THREE.Color(1, 1, 1), 0.15);
        m.emissive = new THREE.Color(look.hairTint).multiplyScalar(0.25);
        mesh.material = m;
      });
      const src = new THREE.Box3().setFromObject(hair);
      const want = hb.getSize(new THREE.Vector3());
      const have = src.getSize(new THREE.Vector3());
      const s = (Math.max(want.x, want.z) / Math.max(have.x, have.z)) * 1.12;
      hair.scale.setScalar(s);
      const c = hb.getCenter(new THREE.Vector3());
      const sc = src.getCenter(new THREE.Vector3()).multiplyScalar(s);
      hair.position.set(c.x - sc.x, hb.max.y + 0.01 - src.max.y * s, c.z - sc.z);
      model.add(hair);
      if (head) (head as THREE.Object3D).attach(hair);
    }
    const g = new THREE.Group();
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y || 1;
    model.scale.setScalar(BODY_H / h);
    model.position.y = -box.min.y * (BODY_H / h);
    g.add(model);
    out.set(id, g);
  }
  return out;
}
