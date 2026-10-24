/**
 * The mega-tower hologram: a giant idol figure (original design, stylised kimono-cyberwear silhouette)
 * projected above a skyscraper roof. Built from a dozen primitives sharing one additive hologram material;
 * she turns, sways and waves. Height is 1.8 units; scale the group to taste.
 */
import * as THREE from 'three';
import { holoFigureMaterial, type Shared } from './cityShaders';

export type HoloFigure = { group: THREE.Group; update: (t: number) => void; dispose: () => void };

export function buildHoloFigure(sh: Shared): HoloFigure {
  const mat = holoFigureMaterial(sh, '#35e8ff', '#ff4fc8');
  const geos: THREE.BufferGeometry[] = [];
  const g = <T extends THREE.BufferGeometry>(x: T) => (geos.push(x), x);
  const mesh = (geo: THREE.BufferGeometry, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.userData.noAO = true;
    parent.add(m);
    return m;
  };
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // kimono skirt: lathe from the waist to a flared hem
  const skirt = g(new THREE.LatheGeometry([new THREE.Vector2(0.15, 1.0), new THREE.Vector2(0.2, 0.88), new THREE.Vector2(0.26, 0.62), new THREE.Vector2(0.34, 0.36), new THREE.Vector2(0.4, 0.2)], 28));
  mesh(skirt, body);
  for (const sx of [-1, 1]) mesh(g(new THREE.CapsuleGeometry(0.05, 0.2, 4, 10)), body, sx * 0.08, 0.1, 0);
  mesh(g(new THREE.CapsuleGeometry(0.13, 0.3, 6, 14)), body, 0, 1.2, 0).scale.set(1.15, 1, 0.8);
  const obi = mesh(g(new THREE.TorusGeometry(0.17, 0.045, 8, 28)), body, 0, 1.02, 0);
  obi.rotation.x = Math.PI / 2;
  mesh(g(new THREE.BoxGeometry(0.26, 0.2, 0.06)), body, 0, 1.02, -0.2);
  mesh(g(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 10)), body, 0, 1.43, 0);
  const head = new THREE.Group();
  head.position.set(0, 1.56, 0);
  body.add(head);
  mesh(g(new THREE.SphereGeometry(0.105, 18, 14)), head).scale.set(0.95, 1.08, 1);
  mesh(g(new THREE.SphereGeometry(0.125, 16, 12)), head, 0, 0.02, -0.03).scale.set(1, 1, 1.05);
  mesh(g(new THREE.SphereGeometry(0.07, 12, 10)), head, 0, 0.16, -0.02);
  mesh(g(new THREE.ConeGeometry(0.1, 0.55, 12, 1, true)), head, 0, -0.26, -0.1);
  const halo = mesh(g(new THREE.TorusGeometry(0.34, 0.01, 6, 48)), head, 0, 0.02, -0.22);
  // arms with a shoulder and an elbow pivot each
  const arms: { sh: THREE.Group; el: THREE.Group }[] = [];
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.2, 1.34, 0);
    body.add(shoulder);
    mesh(g(new THREE.CapsuleGeometry(0.04, 0.26, 4, 8)), shoulder, 0, -0.17, 0);
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.34, 0);
    shoulder.add(elbow);
    mesh(g(new THREE.CapsuleGeometry(0.035, 0.24, 4, 8)), elbow, 0, -0.15, 0);
    // the long furisode sleeve
    mesh(g(new THREE.PlaneGeometry(0.22, 0.42)), elbow, sx * 0.05, -0.2, 0);
    arms.push({ sh: shoulder, el: elbow });
  }
  // projector ring at her feet
  const ring = mesh(g(new THREE.TorusGeometry(0.55, 0.012, 6, 56)), root, 0, 0.01, 0);
  ring.rotation.x = Math.PI / 2;
  const ring2 = mesh(g(new THREE.TorusGeometry(0.4, 0.008, 6, 48)), root, 0, 0.01, 0);
  ring2.rotation.x = Math.PI / 2;

  const update = (t: number) => {
    body.rotation.y = Math.sin(t * 0.25) * 0.7;
    body.rotation.z = Math.sin(t * 0.9) * 0.025;
    body.position.y = Math.sin(t * 1.3) * 0.015;
    head.rotation.z = Math.sin(t * 0.7 + 1) * 0.07;
    head.rotation.y = Math.sin(t * 0.4) * 0.25;
    halo.rotation.z = t * 0.6;
    const [l, r] = arms;
    r.sh.rotation.z = -2.4 + Math.sin(t * 0.9) * 0.1; // raised, waving
    r.el.rotation.z = -0.5 + Math.sin(t * 3.2) * 0.55;
    l.sh.rotation.z = 0.35 + Math.sin(t * 0.7) * 0.05;
    l.el.rotation.z = 0.5;
    ring.scale.setScalar(1 + Math.sin(t * 1.5) * 0.04);
    ring2.rotation.z = t * 0.8;
  };
  return {
    group: root,
    update,
    dispose: () => {
      geos.forEach((x) => x.dispose());
      mat.dispose();
    },
  };
}
