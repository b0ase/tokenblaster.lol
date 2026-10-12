/**
 * Satoshi City heat: the Miners (the city's police). Visual and audio pieces live here: the light bar
 * on a patrol car, the siren (Web Audio, one shared voice that wails louder as the nearest cop closes in),
 * the 5-star helicopter with its searchlight, and the heat rules. The chase AI itself sits in
 * SatoshiCity.tsx next to the car physics it shares.
 */
import * as THREE from 'three';

/** Heat added per crime (stars = ceil(heat), capped at 5). */
export const CRIME = {
  steal: 0.6, // a parked car
  carjack: 1, // dragging a driver out
  runOver: 1, // a pedestrian
  crash: 0.35, // ramming traffic
  hitCop: 1, // ramming a patrol car
  takedown: 0.8, // wrecking one
} as const;

/** Seconds out of every cop's sight before the stars go (a little longer per star). */
export const loseAfter = (stars: number) => 5 + stars * 1.6;
/** Patrol cars hunting you at this many stars. */
export const copsFor = (stars: number) => (stars <= 0 ? 0 : Math.min(6, stars + 1));
/** Top speed of a patrol car (the player's is 44 m/s). */
export const copVmax = (stars: number) => 26 + stars * 2.8;

/** A Miner patrol car's roof bar: red and blue strobes plus a gold ₿ badge bar. */
export function buildLightBar(len: number) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 1.3), new THREE.MeshStandardMaterial({ color: '#111', metalness: 0.6, roughness: 0.4 }));
  const red = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff1030'), toneMapped: false });
  const blue = new THREE.MeshBasicMaterial({ color: new THREE.Color('#1060ff'), toneMapped: false });
  const lr = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.56), red);
  const lb = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.56), blue);
  lr.position.set(0, 0.12, -0.34);
  lb.position.set(0, 0.12, 0.34);
  g.add(base, lr, lb);
  g.position.set(-len * 0.04, 1.42, 0);
  const R = new THREE.Color('#ff1030').multiplyScalar(3);
  const B = new THREE.Color('#1060ff').multiplyScalar(3);
  const DIM = new THREE.Color('#200006');
  const DIMB = new THREE.Color('#000620');
  /** Strobe pattern: double flash red, double flash blue. */
  const update = (now: number, phase: number) => {
    const t = ((now / 1000 + phase) * 2.2) % 1;
    const redOn = (t < 0.1 || (t > 0.18 && t < 0.28)) as boolean;
    const blueOn = (t > 0.5 && t < 0.6) || (t > 0.68 && t < 0.78);
    red.color.copy(redOn ? R : DIM);
    blue.color.copy(blueOn ? B : DIMB);
    return redOn ? 1 : blueOn ? 2 : 0;
  };
  return { g, update, dispose: () => [base.geometry, lr.geometry, lb.geometry, red, blue, base.material].forEach((x) => (x as { dispose(): void }).dispose()) };
}

/** One siren voice for the whole chase: a two-tone wail whose level follows the nearest cop. */
export function createSiren(ctx: AudioContext, out: AudioNode) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const osc2 = ctx.createOscillator();
  osc2.type = 'square';
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.55;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 260;
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);
  lfoGain.connect(osc2.frequency);
  osc.frequency.value = 900;
  osc2.frequency.value = 903;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1100;
  bp.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.value = 0;
  osc.connect(bp);
  osc2.connect(bp);
  bp.connect(g).connect(out);
  osc.start();
  osc2.start();
  lfo.start();
  let mode = 0;
  return {
    /** level 0..1 (distance), yelp: fast wail when close. */
    set(level: number, yelp: boolean) {
      const t = ctx.currentTime;
      g.gain.setTargetAtTime(level * 0.05, t, 0.15);
      const m = yelp ? 1 : 0;
      if (m !== mode) {
        mode = m;
        lfo.frequency.setTargetAtTime(yelp ? 3.2 : 0.55, t, 0.05);
      }
    },
    stop() {
      try {
        osc.stop();
        osc2.stop();
        lfo.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

/** The 5-star helicopter: a dark gunship silhouette with rotor and a searchlight cone that sweeps for you. */
export function buildHeli(scene: THREE.Scene) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: '#16181f', metalness: 0.7, roughness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: '#0a1830', metalness: 0.9, roughness: 0.1, emissive: '#0a2a50', emissiveIntensity: 0.6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 2.6, 6, 12).rotateZ(Math.PI / 2), dark);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.95, 12, 8), glass);
  nose.position.set(1.7, -0.1, 0);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.35, 0.35), dark);
  tail.position.set(-3.6, 0.3, 0);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.1), dark);
  fin.position.set(-5.5, 0.8, 0);
  const skid = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 0.1), dark);
  const skid2 = skid.clone();
  skid.position.set(0, -1.35, 0.8);
  skid2.position.set(0, -1.35, -0.8);
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.05, 0.35), dark);
  const rotor2 = rotor.clone();
  rotor2.rotation.y = Math.PI / 2;
  const hub = new THREE.Group();
  hub.add(rotor, rotor2);
  hub.position.y = 1.25;
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff1030').multiplyScalar(4), toneMapped: false }));
  strobe.position.set(-5.6, 1.4, 0);
  g.add(body, nose, tail, fin, skid, skid2, hub, strobe);
  // Searchlight: a real spot (no shadow) plus a soft additive cone so the beam reads in the air.
  const spot = new THREE.SpotLight('#e8f2ff', 0, 120, 0.2, 0.5, 1.1);
  const target = new THREE.Object3D();
  spot.target = target;
  spot.position.set(1.2, -1, 0);
  g.add(spot);
  scene.add(target);
  const CONE_H = 60;
  const coneGeo = new THREE.ConeGeometry(Math.tan(0.2) * CONE_H, CONE_H, 24, 1, true).translate(0, -CONE_H / 2, 0);
  const coneMat = new THREE.MeshBasicMaterial({ color: '#bcd8ff', transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  scene.add(cone);
  g.visible = false;
  cone.visible = false;
  scene.add(g);
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  let x = 0;
  let z = 0;
  let y = 45;
  let heading = 0;
  let active = false;
  let sweep = 0;
  /** Light lands here (with a lazy sweep around the suspect). */
  const aim = new THREE.Vector3();
  return {
    get active() {
      return active;
    },
    get pos() {
      return { x, y, z };
    },
    get aim() {
      return aim;
    },
    spawn(px: number, pz: number) {
      active = true;
      const a = Math.random() * Math.PI * 2;
      x = px + Math.cos(a) * 140;
      z = pz + Math.sin(a) * 140;
      y = 42;
      aim.set(px, 0, pz);
      g.visible = cone.visible = true;
    },
    despawn() {
      active = false;
      g.visible = cone.visible = false;
      spot.intensity = 0;
    },
    update(dt: number, now: number, px: number, pz: number, night: number, seen: boolean) {
      if (!active) return;
      // orbit the suspect at ~30 m, leaning into the turn
      const ang = now / 5200;
      const tx = px + Math.cos(ang) * 30;
      const tz = pz + Math.sin(ang) * 30;
      const dx = tx - x;
      const dz = tz - z;
      const d = Math.hypot(dx, dz);
      const v = Math.min(36, d * 0.9);
      if (d > 0.01) {
        x += (dx / d) * v * dt;
        z += (dz / d) * v * dt;
        const h = Math.atan2(-dz, dx);
        heading += Math.atan2(Math.sin(h - heading), Math.cos(h - heading)) * Math.min(1, dt * 2);
      }
      y += (38 - y) * Math.min(1, dt * 0.5);
      g.position.set(x, y + Math.sin(now / 700) * 0.4, z);
      g.rotation.set(0, heading, -Math.min(0.3, v / 120));
      hub.rotation.y += dt * 38;
      strobe.visible = now % 1000 < 90;
      // the light chases the suspect with lag; sweeps wider when it has lost you
      sweep += dt;
      const wob = seen ? 2 : 9;
      const lx = px + Math.sin(sweep * 1.3) * wob;
      const lz = pz + Math.cos(sweep * 0.9) * wob;
      aim.x += (lx - aim.x) * Math.min(1, dt * (seen ? 2.5 : 0.8));
      aim.z += (lz - aim.z) * Math.min(1, dt * (seen ? 2.5 : 0.8));
      target.position.copy(aim);
      spot.intensity = 900 * (0.35 + night * 0.65);
      // cone from the heli down to the aim point
      const origin = new THREE.Vector3(x, y - 1, z);
      dir.copy(aim).sub(origin);
      const len = dir.length();
      cone.position.copy(origin);
      cone.quaternion.setFromUnitVectors(up, dir.normalize().negate());
      cone.scale.set(1, len / CONE_H, 1);
      coneMat.opacity = 0.03 + night * 0.09;
    },
    dispose() {
      scene.remove(g, cone, target);
      coneGeo.dispose();
      coneMat.dispose();
    },
  };
}
