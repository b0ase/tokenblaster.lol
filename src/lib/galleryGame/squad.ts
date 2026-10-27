/**
 * THE NPG SQUAD (owner, 27 Oct 2026): five Ninja Punk Girls go in together. In SOLO you are the girl you
 * picked and the other four are AI squadmates (Left 4 Dead style); in TEAM mode real players take their
 * slots and AI fills only the empty ones (see `squadSlots`).
 *
 * Pure logic, no three.js: the engine feeds positions in (camera-local metres, -z ahead) and applies the
 * shots that come back straight to the Erobotz. AI shots are NEVER paid or broadcast: no wallet, no
 * receipts, no split. They are plain damage numbers; only the player's own rounds are transactions.
 */

export type SquadState = 'follow' | 'engage' | 'protect' | 'downed';

export type Mate = {
  id: string;
  name: string;
  /** Always true here; a human in the slot is not simulated (see squadSlots). */
  ai: true;
  slot: number;
  x: number;
  z: number;
  yaw: number;
  hp: number;
  hpMax: number;
  state: SquadState;
  /** Seconds left down (back up at 0). */
  downT: number;
  /** Seconds to the next shot. */
  cd: number;
  target: string | null;
  sinceHurt: number;
  /** Personal sway phase (keeps the formation loose). */
  phase: number;
};

/** An Erobot (or horde mob) in view. `onKweg`: it is attacking Dr Kweg Wong. */
export type Foe = { id: string; x: number; z: number; onKweg?: boolean };

export type SquadWorld = {
  /** `fwd`: the camera's flat view direction (unit, defaults to -z). The formation turns with it. */
  player: { x: number; z: number; fwd?: { x: number; z: number } };
  foes: Foe[];
  /** Dr Kweg Wong while he is being escorted (Act 2), else null. */
  kweg: { x: number; z: number } | null;
  act: 1 | 2;
  /** The player's recent damage per second (the engine measures it from landed rounds). */
  playerDps: number;
};

export type SquadShot = { mate: string; foe: string; dmg: number };

export const SQUAD = {
  /**
   * Formation in the player's VIEW frame (x right, z back; -z is ahead), one per AI slot (owner, 27 Oct: they
   * stood in front of the camera, backs of heads blocking the shot). Two flank at ~5.5 m / ~32 deg off the
   * view axis, two further ahead and out wide (~10 m / ~30 deg): inside the 60 deg FOV (feet included, past
   * the ~3 m the eye line hides) at 16:10 and phone landscape, and well clear of the crosshair.
   */
  formation: [
    { x: -2.9, z: -4.7 },
    { x: 2.9, z: -4.7 },
    { x: -5.0, z: -8.8 },
    { x: 5.0, z: -8.8 },
  ] as const,
  /** Never inside this half-angle (rad, ~12 deg) round the crosshair, nor closer than `minR` m to the camera. */
  clearCone: (12 * Math.PI) / 180,
  minR: 2,
  hp: 100,
  speed: 4.2,
  sway: 0.7,
  /** Engage range (m) and Kweg guard radius. */
  range: 34,
  guard: 9,
  /** Seconds between AI shots (plus jitter): with dmgK this keeps four girls well under the player's kills. */
  fireGap: 0.55,
  jitter: 0.35,
  /** The WHOLE squad's damage as a share of the player's (owner: ~35-50%), so the player still makes most kills. */
  dmgK: 0.42,
  /** Player DPS floor (they still fight while the player reloads or isn't firing). */
  minDps: 12,
  /** Down for this long, then back up (never permanently dead in solo). */
  downSecs: 10,
  reviveHp: 0.5,
  /** Foes this close chip at a girl (melee / point blank), per second each. */
  biteR: 3.2,
  biteDps: 9,
  regenDelay: 4,
  regen: 6,
} as const;

/** The five NPG slots: humans keep theirs, AI fills only the empty ones. */
export function squadSlots<G extends { id: string; name: string }>(roster: readonly G[], humans: readonly { girl: string }[]): { girl: G; ai: boolean }[] {
  const taken = new Set(humans.map((h) => h.girl));
  return roster.slice(0, 5).map((g) => ({ girl: g, ai: !taken.has(g.id) }));
}

/** Four AI squadmates for a solo run as `playerGirl`. */
export function makeSquad(roster: readonly { id: string; name: string }[], playerGirl: string): Mate[] {
  const ai = squadSlots(roster, [{ girl: playerGirl }]).filter((s) => s.ai);
  return ai.slice(0, SQUAD.formation.length).map((s, i) => {
    const f = SQUAD.formation[i];
    return { id: s.girl.id, name: s.girl.name, ai: true as const, slot: i, x: f.x, z: f.z, yaw: 0, hp: SQUAD.hp, hpMax: SQUAD.hp, state: 'follow', downT: 0, cd: 0.6 + i * 0.2, target: null, phase: i * 1.7, sinceHurt: 99 };
  });
}

/** One AI round: the girls share SQUAD.dmgK of the player's DPS between them. */
export const shotDmg = (playerDps: number, n: number) => (Math.max(SQUAD.minDps, playerDps) * SQUAD.dmgK * (SQUAD.fireGap + SQUAD.jitter / 2)) / Math.max(1, n);

/** Push a point (world x,z) out of the aim cone and the camera's personal space. Pure; tested. */
export function keepClear(px: number, pz: number, fwd: { x: number; z: number }, x: number, z: number, side: number): { x: number; z: number } {
  const rx = -fwd.z;
  const rz = fwd.x;
  let lx = (x - px) * rx + (z - pz) * rz; // right
  let lf = (x - px) * fwd.x + (z - pz) * fwd.z; // ahead
  const r = Math.hypot(lx, lf);
  if (r < SQUAD.minR) {
    const k = r > 1e-6 ? SQUAD.minR / r : 0;
    if (k) {
      lx *= k;
      lf *= k;
    } else lx = SQUAD.minR * (side || 1);
  }
  if (lf > 0 && Math.abs(lx) < lf * Math.tan(SQUAD.clearCone)) lx = (Math.sign(lx) || side || 1) * lf * Math.tan(SQUAD.clearCone) * 1.02;
  return { x: px + lx * rx + lf * fwd.x, z: pz + lx * rz + lf * fwd.z };
}

const d2 = (ax: number, az: number, bx: number, bz: number) => (ax - bx) ** 2 + (az - bz) ** 2;

/** Damage a girl (bites, bolts). Downs her at 0; she gets back up after SQUAD.downSecs. */
export function hurtMate(m: Mate, dmg: number) {
  if (m.state === 'downed' || dmg <= 0) return;
  m.hp -= dmg;
  m.sinceHurt = 0;
  if (m.hp <= 0) {
    m.hp = 0;
    m.state = 'downed';
    m.downT = SQUAD.downSecs;
    m.target = null;
  }
}

/** Who a girl should shoot: Erobotz on Dr Wong first (Act 2), else the nearest in range. */
function pick(m: Mate, w: SquadWorld): { foe: Foe | null; protect: boolean } {
  const r2 = SQUAD.range * SQUAD.range;
  if (w.act === 2 && w.kweg) {
    const k = w.kweg;
    let best: Foe | null = null;
    let bd = Infinity;
    for (const f of w.foes) {
      const kd = d2(f.x, f.z, k.x, k.z);
      if (!f.onKweg && kd > SQUAD.guard * SQUAD.guard) continue;
      if (d2(f.x, f.z, m.x, m.z) > r2) continue;
      if (kd < bd) {
        bd = kd;
        best = f;
      }
    }
    if (best) return { foe: best, protect: true };
  }
  let best: Foe | null = null;
  let bd = r2;
  for (const f of w.foes) {
    const d = d2(f.x, f.z, m.x, m.z);
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return { foe: best, protect: false };
}

/**
 * One AI tick for the whole squad. Moves the girls, takes bite damage, handles down/up, and returns the
 * shots to apply this tick. `rnd` is injectable for tests.
 */
export function stepSquad(mates: Mate[], w: SquadWorld, dt: number, rnd: () => number = Math.random): SquadShot[] {
  const shots: SquadShot[] = [];
  for (const m of mates) {
    m.sinceHurt += dt;
    if (m.state === 'downed') {
      m.downT -= dt;
      if (m.downT <= 0) {
        m.downT = 0;
        m.hp = Math.round(m.hpMax * SQUAD.reviveHp);
        m.state = 'follow';
        m.cd = 0.8;
      }
      continue;
    }
    // follow loosely: home = the player's spot + this girl's formation slot, with a slow personal sway
    m.phase += dt;
    const f = SQUAD.formation[m.slot % SQUAD.formation.length];
    const fw = w.player.fwd ?? { x: 0, z: -1 };
    const ox = f.x + Math.sin(m.phase * 0.6) * SQUAD.sway;
    const oz = f.z + Math.cos(m.phase * 0.45) * SQUAD.sway * 0.6;
    // view frame -> world: right = (-fwd.z, fwd.x), back = -fwd
    const hx = w.player.x + ox * -fw.z - oz * fw.x;
    const hz = w.player.z + ox * fw.x - oz * fw.z;
    const dx = hx - m.x;
    const dz = hz - m.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.25) {
      const step = Math.min(dist, SQUAD.speed * dt * (dist > 6 ? 2 : 1));
      m.x += (dx / dist) * step;
      m.z += (dz / dist) * step;
    }
    const side = Math.sign(f.x) || 1;
    const c = keepClear(w.player.x, w.player.z, fw, m.x, m.z, side);
    m.x = c.x;
    m.z = c.z;
    // bites from anything on top of her
    let bites = 0;
    for (const fo of w.foes) if (d2(fo.x, fo.z, m.x, m.z) < SQUAD.biteR * SQUAD.biteR) bites++;
    if (bites) hurtMate(m, bites * SQUAD.biteDps * dt);
    if ((m.state as SquadState) === 'downed') continue;
    if (m.sinceHurt > SQUAD.regenDelay && m.hp < m.hpMax) m.hp = Math.min(m.hpMax, m.hp + SQUAD.regen * dt);
    const { foe, protect } = pick(m, w);
    if (!foe) {
      m.state = 'follow';
      m.target = null;
      // idle: face ahead with the player, turned a little outward (three-quarter, not the back of her head)
      m.yaw = Math.atan2(fw.x, -fw.z) + side * 0.7;
      continue;
    }
    m.state = protect ? 'protect' : 'engage';
    m.target = foe.id;
    m.yaw = Math.atan2(foe.x - m.x, -(foe.z - m.z));
    m.cd -= dt;
    if (m.cd <= 0) {
      m.cd = SQUAD.fireGap + rnd() * SQUAD.jitter;
      shots.push({ mate: m.id, foe: foe.id, dmg: shotDmg(w.playerDps, mates.length) });
    }
  }
  return shots;
}
