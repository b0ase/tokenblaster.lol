/**
 * GITDEX "blueprint paper plane": an architect's-desk paper dart. Folded, flat-shaded paper (drafting paper with
 * blue-ink grid, a git branch graph and a title block), every fold inked as a line, floating dimension lines like a
 * technical drawing, two rolled-paper jets, and a dashed construction line for a jet trail. Cosmetic only.
 */
import * as THREE from 'three';
import type { ShipSpec } from '../sim';
import type { Livery } from '../teams';
import type { Rig } from '../ships';
import { bare, liveryCanvas, mergeBare, onFrame, shieldMesh, type Detail } from './kit';

const L = 5.8;
const W = 4.4;
const INK = '#1d4fa8';
const GIT = '#f05032';

type PlaneGeo = { paper: THREE.BufferGeometry; edges: THREE.BufferGeometry; dims: THREE.BufferGeometry; glow: THREE.BufferGeometry; flame: THREE.BufferGeometry; engine: THREE.Vector3[]; nozzleZ: number };
const cache = new Map<Detail, PlaneGeo>();

type V = [number, number, number];

function planeGeo(detail: Detail): PlaneGeo {
  const hit = cache.get(detail);
  if (hit) return hit;
  const zR = -L / 2 + 0.3;
  const N: V = [0, 0.14, L / 2];
  const S: V = [0.05, 0.16, zR];
  const K: V = [0, -0.68, zR + 0.15];
  const K0: V = [0, -0.06, L / 2 - 0.9];
  const T: V = [W / 2, 0.46, zR];
  const M: V = [W * 0.2, 0.26, zR];
  const xf = W / 2 * 0.8;
  const s = xf / T[0];
  const Ff: V = [xf, N[1] + (T[1] - N[1]) * s, N[2] + (T[2] - N[2]) * s];
  const yr = M[1] + ((T[1] - M[1]) * (xf - M[0])) / (T[0] - M[0]);
  const Fr: V = [xf, yr, zR];
  const Tu: V = [xf + 0.06, yr + (W / 2 - xf) * 0.95, zR - 0.05];
  // One side (+X, left); mirrored for the other.
  const tris: [V, V, V, 'top' | 'keel'][] = [
    [N, S, M, 'top'],
    [N, M, Fr, 'top'],
    [N, Fr, Ff, 'top'],
    [Ff, Fr, Tu, 'top'],
    [N, K0, S, 'keel'],
    [K0, K, S, 'keel'],
  ];
  const pos: number[] = [];
  const uv: number[] = [];
  for (const side of [1, -1]) {
    for (const [a, b, c, kind] of tris) {
      const vs = side > 0 ? [a, b, c] : [a, c, b];
      for (const v of vs) {
        const x = v[0] * side;
        pos.push(x, v[1], v[2]);
        if (kind === 'top') uv.push(0.5 - x / (W * 1.02), 0.5 + v[2] / (L * 1.02));
        else uv.push(0.5 + side * (0.02 + (0.2 - v[1]) * 0.12), 0.5 + v[2] / (L * 1.02));
      }
    }
  }
  const paper = new THREE.BufferGeometry();
  paper.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  paper.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  paper.computeVertexNormals();
  // Rolled-paper jets under the wings.
  const engine: THREE.Vector3[] = [];
  const nozzleZ = zR - 0.1;
  const tubes: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const lines: number[] = [];
  const seg = detail === 'low' ? 10 : 18;
  for (const sx of [1, -1]) {
    const x = sx * 0.78;
    const y = -0.05;
    const c = new THREE.CylinderGeometry(0.2, 0.17, 1.2, seg, 1, true);
    c.rotateX(Math.PI / 2);
    tubes.push(bare(c.translate(x, y, nozzleZ + 0.6), true));
    const gd = new THREE.CircleGeometry(0.15, seg);
    gd.rotateY(Math.PI);
    glow.push(bare(gd.translate(x, y, nozzleZ + 0.1)));
    engine.push(new THREE.Vector3(x, y, nozzleZ));
    for (const [z, r] of [[nozzleZ, 0.17], [nozzleZ + 1.2, 0.2]] as const) {
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        lines.push(x + Math.cos(a0) * r, y + Math.sin(a0) * r, z, x + Math.cos(a1) * r, y + Math.sin(a1) * r, z);
      }
    }
    lines.push(x, y + 0.2, nozzleZ + 1.2, x, y + 0.17, nozzleZ); // the paper's seam
  }
  // Tubes get the paper's uv (a band of the grid).
  const paperAll = new THREE.BufferGeometry();
  const tg = mergeBare(tubes);
  const tp = tg.attributes.position.array as Float32Array;
  const tu = tg.attributes.uv.array as Float32Array;
  const allPos = new Float32Array(pos.length + tp.length);
  allPos.set(pos);
  allPos.set(tp, pos.length);
  const allUv = new Float32Array(uv.length + tu.length);
  allUv.set(uv);
  for (let i = 0; i < tu.length; i += 2) {
    allUv[uv.length + i] = 0.05 + tu[i] * 0.1;
    allUv[uv.length + i + 1] = 0.1 + tu[i + 1] * 0.25;
  }
  paperAll.setAttribute('position', new THREE.BufferAttribute(allPos, 3));
  paperAll.setAttribute('uv', new THREE.BufferAttribute(allUv, 2));
  paperAll.computeVertexNormals();
  tg.dispose();
  // Ink every fold and edge.
  const e = new THREE.EdgesGeometry(paper, 1);
  const ep = e.attributes.position.array as Float32Array;
  const edges = new THREE.BufferGeometry();
  edges.setAttribute('position', new THREE.Float32BufferAttribute([...ep, ...lines], 3));
  e.dispose();
  // Dimension lines: span under the trailing edge, length along the right side, centre line through the nose.
  const d: number[] = [];
  const seg3 = (a: V, b: V) => d.push(...a, ...b);
  const arrow = (p: V, dir: V, side: V) => {
    const k = 0.18;
    seg3(p, [p[0] - dir[0] * k + side[0] * k * 0.4, p[1] - dir[1] * k + side[1] * k * 0.4, p[2] - dir[2] * k + side[2] * k * 0.4]);
    seg3(p, [p[0] - dir[0] * k - side[0] * k * 0.4, p[1] - dir[1] * k - side[1] * k * 0.4, p[2] - dir[2] * k - side[2] * k * 0.4]);
  };
  const yd = -0.95;
  const zd = zR - 0.55;
  seg3([W / 2, yd, zd], [-W / 2, yd, zd]);
  arrow([W / 2, yd, zd], [1, 0, 0], [0, 1, 0]);
  arrow([-W / 2, yd, zd], [-1, 0, 0], [0, 1, 0]);
  seg3([W / 2, T[1], zR - 0.05], [W / 2, yd - 0.15, zd]);
  seg3([-W / 2, T[1], zR - 0.05], [-W / 2, yd - 0.15, zd]);
  const xd = -W / 2 - 0.45;
  seg3([xd, 0.1, zR], [xd, 0.1, L / 2]);
  arrow([xd, 0.1, L / 2], [0, 0, 1], [1, 0, 0]);
  arrow([xd, 0.1, zR], [0, 0, -1], [1, 0, 0]);
  seg3([xd - 0.15, 0.1, L / 2], [0, N[1], L / 2]);
  seg3([xd - 0.15, 0.1, zR], [-M[0], M[1], zR]);
  // Dash-dot centre line ahead of the nose and behind the tail.
  for (let z = L / 2 + 0.25; z < L / 2 + 1.9; z += 0.42) seg3([0, N[1], z], [0, N[1], z + 0.24]);
  if (detail !== 'low') {
    // Construction circle round each jet.
    for (const sx of [1, -1]) {
      for (let i = 0; i < 24; i += 2) {
        const a0 = (i / 24) * Math.PI * 2;
        const a1 = ((i + 1) / 24) * Math.PI * 2;
        d.push(sx * 0.78 + Math.cos(a0) * 0.42, -0.05 + Math.sin(a0) * 0.42, nozzleZ - 0.02, sx * 0.78 + Math.cos(a1) * 0.42, -0.05 + Math.sin(a1) * 0.42, nozzleZ - 0.02);
      }
    }
  }
  const dims = new THREE.BufferGeometry();
  dims.setAttribute('position', new THREE.Float32BufferAttribute(d, 3));
  // Dashed construction-line trail: dashes from z=0 back.
  const fl: THREE.BufferGeometry[] = [];
  for (const en of engine) {
    for (let z = 0; z > -3.4; z -= 0.42) {
      const b = new THREE.BoxGeometry(0.07, 0.07, 0.24);
      fl.push(bare(b.translate(en.x, en.y, z - 0.12)));
    }
    const r = new THREE.TorusGeometry(0.13, 0.025, 4, 12);
    fl.push(bare(r.translate(en.x, en.y, -0.05)));
  }
  const g: PlaneGeo = { paper: paperAll, edges, dims, glow: mergeBare(glow), flame: mergeBare(fl), engine, nozzleZ };
  cache.set(detail, g);
  return g;
}

/** Drafting paper: blue-ink grid, construction lines, a git branch graph, title block, the number in red pencil. */
export function paintPaper(c: HTMLCanvasElement, l: Livery) {
  const g = c.getContext('2d')!;
  const S = c.width;
  g.fillStyle = '#f3f3ee';
  g.fillRect(0, 0, S, S);
  // Grid.
  for (let i = 0; i <= 64; i++) {
    const p = (i / 64) * S;
    g.strokeStyle = i % 8 === 0 ? 'rgba(29,79,168,0.42)' : 'rgba(29,79,168,0.14)';
    g.lineWidth = i % 8 === 0 ? S / 512 * 1.4 : S / 512;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, S);
    g.moveTo(0, p);
    g.lineTo(S, p);
    g.stroke();
  }
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.lineWidth = S / 300;
  // Centre line (dash-dot).
  g.setLineDash([S / 30, S / 80, S / 200, S / 80]);
  g.beginPath();
  g.moveTo(S / 2, 0);
  g.lineTo(S / 2, S);
  g.stroke();
  g.setLineDash([]);
  // Planform offsets (construction lines) and rivet marks.
  g.beginPath();
  g.moveTo(S / 2, S * 0.02);
  g.lineTo(S * 0.06, S * 0.93);
  g.moveTo(S / 2, S * 0.02);
  g.lineTo(S * 0.94, S * 0.93);
  g.moveTo(S * 0.06, S * 0.93);
  g.lineTo(S * 0.94, S * 0.93);
  g.stroke();
  for (const [x, y] of [[0.3, 0.62], [0.7, 0.62], [0.38, 0.78], [0.62, 0.78]]) {
    g.beginPath();
    g.arc(S * x, S * y, S * 0.018, 0, Math.PI * 2);
    g.moveTo(S * x - S * 0.03, S * y);
    g.lineTo(S * x + S * 0.03, S * y);
    g.moveTo(S * x, S * y - S * 0.03);
    g.lineTo(S * x, S * y + S * 0.03);
    g.stroke();
  }
  // Dimension across the wing.
  const dim = (x0: number, x1: number, y: number, label: string) => {
    g.beginPath();
    g.moveTo(S * x0, S * y);
    g.lineTo(S * x1, S * y);
    for (const [x, d] of [[x0, 1], [x1, -1]] as const) {
      g.moveTo(S * x, S * y);
      g.lineTo(S * x + d * S * 0.025, S * y - S * 0.01);
      g.moveTo(S * x, S * y);
      g.lineTo(S * x + d * S * 0.025, S * y + S * 0.01);
      g.moveTo(S * x, S * (y - 0.03));
      g.lineTo(S * x, S * (y + 0.03));
    }
    g.stroke();
    g.font = `${S * 0.026}px ui-monospace, Menlo, monospace`;
    g.textAlign = 'center';
    g.fillText(label, S * (x0 + x1) / 2, S * (y - 0.012));
  };
  dim(0.12, 0.88, 0.88, '4400');
  dim(0.32, 0.68, 0.45, `R${l.number}0`);
  // The number: red pencil stencil, boxed with construction ticks.
  g.save();
  g.translate(S * 0.5, S * 0.33);
  g.font = `900 ${S * 0.15}px Impact, "Arial Black", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.strokeStyle = GIT;
  g.lineWidth = S / 160;
  g.strokeText(l.number, 0, 0);
  g.globalAlpha = 0.3;
  g.fillStyle = GIT;
  g.fillText(l.number, 0, 0);
  g.globalAlpha = 1;
  g.strokeStyle = INK;
  g.lineWidth = S / 512;
  g.strokeRect(-S * 0.12, -S * 0.09, S * 0.24, S * 0.18);
  g.restore();
  // Git graph on the right wing (canvas right): main, a branch, a merge.
  g.save();
  g.lineWidth = S / 220;
  g.strokeStyle = GIT;
  g.fillStyle = GIT;
  const gx = S * 0.7;
  g.beginPath();
  g.moveTo(gx, S * 0.55);
  g.lineTo(gx, S * 0.86);
  g.moveTo(gx, S * 0.6);
  g.bezierCurveTo(gx + S * 0.08, S * 0.63, gx + S * 0.08, S * 0.66, gx + S * 0.08, S * 0.7);
  g.lineTo(gx + S * 0.08, S * 0.76);
  g.bezierCurveTo(gx + S * 0.08, S * 0.8, gx, S * 0.8, gx, S * 0.83);
  g.stroke();
  for (const [x, y] of [[0, 0.57], [0, 0.66], [0, 0.74], [0.08, 0.7], [0.08, 0.76], [0, 0.83]]) {
    g.beginPath();
    g.arc(gx + S * x, S * y, S * 0.011, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = INK;
  g.font = `${S * 0.022}px ui-monospace, Menlo, monospace`;
  g.textAlign = 'left';
  g.fillText('main', gx - S * 0.075, S * 0.575);
  g.fillText(`feat/${l.ticker.replace(/^\$/, '').toLowerCase()}`.slice(0, 14), gx + S * 0.1, S * 0.705);
  g.restore();
  // Title block, rear left (in view of the chase camera).
  g.save();
  const bx = S * 0.1;
  const by = S * 0.66;
  const bw = S * 0.3;
  const bh = S * 0.2;
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillRect(bx, by, bw, bh);
  g.strokeStyle = INK;
  g.lineWidth = S / 300;
  g.strokeRect(bx, by, bw, bh);
  g.beginPath();
  g.moveTo(bx, by + bh * 0.42);
  g.lineTo(bx + bw, by + bh * 0.42);
  g.moveTo(bx, by + bh * 0.7);
  g.lineTo(bx + bw, by + bh * 0.7);
  g.moveTo(bx + bw * 0.5, by + bh * 0.42);
  g.lineTo(bx + bw * 0.5, by + bh);
  g.stroke();
  g.fillStyle = INK;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = `900 ${S * 0.05}px Impact, "Arial Black", sans-serif`;
  g.fillText(l.team, bx + bw * 0.05, by + bh * 0.22, bw * 0.9);
  g.font = `${S * 0.022}px ui-monospace, Menlo, monospace`;
  g.fillText('DWG GX-03', bx + bw * 0.05, by + bh * 0.56);
  g.fillText(`NO. ${l.number}`, bx + bw * 0.55, by + bh * 0.56);
  g.fillText('SCALE 1:1', bx + bw * 0.05, by + bh * 0.85);
  g.fillText(l.ticker.slice(0, 8), bx + bw * 0.55, by + bh * 0.85, bw * 0.42);
  g.restore();
  // Sponsor decal as a rubber stamp near the nose.
  if (l.decal) {
    g.save();
    g.translate(S * 0.5, S * 0.14);
    g.rotate(-0.06);
    g.fillStyle = l.decal.bg;
    g.globalAlpha = 0.9;
    g.fillRect(-S * 0.15, -S * 0.035, S * 0.3, S * 0.07);
    g.globalAlpha = 1;
    g.strokeStyle = INK;
    g.lineWidth = S / 256;
    g.strokeRect(-S * 0.155, -S * 0.04, S * 0.31, S * 0.08);
    g.fillStyle = l.decal.fg;
    g.font = `900 ${S * 0.04}px Impact, "Arial Black", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(l.decal.text, 0, 0, S * 0.28);
    g.restore();
  }
}

let inkMat: THREE.LineBasicMaterial | null = null;
let dimMat: THREE.LineBasicMaterial | null = null;
let planeGlow: THREE.MeshBasicMaterial | null = null;

export function buildPaperPlane(spec: ShipSpec, l: Livery, _accent: string, detail: Detail = 'high'): Rig {
  const G = planeGeo(detail);
  inkMat ??= new THREE.LineBasicMaterial({ color: '#163a80' });
  dimMat ??= new THREE.LineBasicMaterial({ color: new THREE.Color('#5fb0ff').multiplyScalar(1.8), transparent: true, opacity: 0.85 });
  planeGlow ??= new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd0c0').multiplyScalar(1.5), side: THREE.DoubleSide });
  const { canvas, tex } = liveryCanvas(512);
  paintPaper(canvas, l);
  // Paper is matte and a little grey so it never blows out under the track's lights and bloom.
  const bodyMat = new THREE.MeshPhysicalMaterial({ map: tex, color: new THREE.Color(0.66, 0.67, 0.7), emissiveMap: tex, emissive: new THREE.Color(0.07, 0.07, 0.08), metalness: 0, roughness: 0.92, envMapIntensity: 0.45, side: THREE.DoubleSide, flatShading: true });
  const trimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(GIT).multiplyScalar(3) });
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(GIT).lerp(new THREE.Color('#ffd0a0'), 0.3).multiplyScalar(1.6), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);
  const k = Math.max(0.85, Math.min(1.15, (spec.length / L + spec.span / W) / 2));
  const model = new THREE.Group();
  model.scale.setScalar(k);
  tilt.add(model);
  const add = <T extends THREE.Object3D>(o: T) => {
    o.frustumCulled = false;
    model.add(o);
    return o;
  };
  const paper = add(new THREE.Mesh(G.paper, bodyMat));
  add(new THREE.LineSegments(G.edges, inkMat));
  const dims = add(new THREE.LineSegments(G.dims, dimMat));
  const glow = add(new THREE.Mesh(G.glow, planeGlow));
  const flame = add(new THREE.Mesh(G.flame, flameMat));
  flame.position.z = G.nozzleZ;
  // A small trim mesh so the team accent shows (wing-tip pencil marks).
  const tipGeo = new THREE.BoxGeometry(0.05, 0.05, 0.6);
  const trims = new THREE.Group();
  for (const sx of [1, -1]) {
    const m = new THREE.Mesh(tipGeo, trimMat);
    m.position.set(sx * (W / 2 * 0.8 + 0.03), 0.52, -L / 2 + 0.6);
    m.frustumCulled = false;
    trims.add(m);
  }
  model.add(trims);
  onFrame(paper, tilt, flame, (m) => {
    // Dashes stream back; paper flutters a little with speed.
    flame.position.z = G.nozzleZ + 0.42 - ((m.t * (1.5 + m.thrust * 5 + m.boost * 6)) % 0.42);
    model.rotation.z = Math.sin(m.t * 7.3) * 0.012 * (0.4 + m.thrust);
    model.rotation.x = Math.sin(m.t * 5.1) * 0.008 * (0.4 + m.thrust);
    (dims.material as THREE.LineBasicMaterial).opacity = 0.42 + Math.sin(m.t * 2) * 0.14;
  });
  const shield = shieldMesh(5.8 * k);
  tilt.add(shield);
  return {
    root, tilt, flame, flameMat, glow, canvas, tex, bodyMat, trimMat, shield,
    engine: G.engine.map((e) => e.clone().multiplyScalar(k)),
    setLivery(nl) {
      paintPaper(canvas, nl);
      tex.needsUpdate = true;
    },
    dispose() {
      tex.dispose();
      bodyMat.dispose();
      trimMat.dispose();
      flameMat.dispose();
      tipGeo.dispose();
      shield.geometry.dispose();
      (shield.material as THREE.Material).dispose();
    },
  };
}
