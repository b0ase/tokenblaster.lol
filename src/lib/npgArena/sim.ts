/**
 * NPG Arena: the fight itself, with no three.js in it. Two fighters, each driven by an `Input` per step (keyboard,
 * gamepad, CPU or, later, a remote player), on a round floor. The renderer reads fighter state + `anim` descriptors and
 * consumes `events` (hits, whooshes, callouts) for particles, sound and camera shake.
 */

export type Stats = [number, number, number, number, number, number]; // strength, speed, skill, stamina, stealth, style

/** One step of control for one fighter. `x`/`z` is the wanted move direction in world space (length ≤ 1). */
export type Input = { x: number; z: number; jump: boolean; roll: boolean; light: boolean; heavy: boolean; block: boolean };
export const NO_INPUT: Input = { x: 0, z: 0, jump: false, roll: false, light: false, heavy: false, block: false };

/** Clip lengths (seconds) of the Quaternius UAL clips in public/npg/anims/mixamo-anims.glb. */
export const CLIP_LEN: Record<string, number> = {
  Sword_Idle: 1.67, Idle_Loop: 2.5, Sword_Attack: 1.53, Punch_Jab: 0.87, Punch_Cross: 1.0, Hit_Chest: 0.33, Hit_Head: 0.43,
  Death01: 2.4, Walk_Loop: 1.33, Jog_Fwd_Loop: 0.93, Jump_Loop: 2.5, Jump_Land: 1.27, Roll: 1.47, Dance_Loop: 1.0,
  Sword_Regular_A: 0.43, Sword_Regular_B: 0.53, Sword_Block: 1.23, Melee_Hook: 0.47, Hit_Knockback: 0.83,
  NinjaJump_Idle_Loop: 2.0, Yes: 2.5, Spell_Simple_Shoot: 0.5,
};

export type Anim = { clip: string; speed: number; loop: boolean; key: number; fade: number; hold?: number };

type AttackDef = {
  clip: string;
  speed: number;
  /** active window and recovery end, as fractions of the clip */
  active: [number, number];
  end: number;
  dmg: number;
  range: number;
  react: 'Hit_Head' | 'Hit_Chest' | 'Hit_Knockback';
  heavy?: boolean;
  /** forward step during the swing (m/s while before the active window ends) */
  lunge: number;
};

// light presses in rhythm walk this chain; heavy is its own big swing
export const LIGHT: AttackDef[] = [
  { clip: 'Punch_Jab', speed: 1.7, active: [0.2, 0.38], end: 0.56, dmg: 5, range: 1.4, react: 'Hit_Head', lunge: 1.2 },
  { clip: 'Punch_Cross', speed: 1.7, active: [0.24, 0.42], end: 0.6, dmg: 6, range: 1.45, react: 'Hit_Chest', lunge: 1.4 },
  { clip: 'Sword_Regular_A', speed: 1.05, active: [0.25, 0.62], end: 0.9, dmg: 7, range: 1.5, react: 'Hit_Chest', lunge: 1.6 },
  { clip: 'Melee_Hook', speed: 0.95, active: [0.28, 0.62], end: 1, dmg: 11, range: 1.5, react: 'Hit_Knockback', heavy: true, lunge: 2.2 },
];
export const HEAVY: AttackDef = { clip: 'Sword_Attack', speed: 1.3, active: [0.36, 0.56], end: 0.8, dmg: 17, range: 1.65, react: 'Hit_Knockback', heavy: true, lunge: 2.4 };

export type FState = 'idle' | 'walk' | 'jump' | 'roll' | 'attack' | 'block' | 'hit' | 'ko' | 'win' | 'lose';

export type Fighter = {
  slug: string;
  name: string;
  stats: Stats;
  x: number;
  z: number;
  y: number;
  vy: number;
  /** knockback / roll velocity */
  vx: number;
  vz: number;
  face: number; // yaw; the model's +Z points along (sin face, cos face)
  hp: number;
  maxHp: number;
  state: FState;
  t: number;
  atk: AttackDef | null;
  combo: number;
  hitDone: boolean;
  stun: number;
  wins: number;
  anim: Anim;
  /** input buffer: seconds since each button was pressed (Infinity = not pressed) */
  buf: { jump: number; roll: number; light: number; heavy: number };
  rollCd: number;
  /** stat-derived tuning */
  dmgMul: number;
  move: number;
  tempo: number;
  chip: number;
  iframes: number;
  /** last movement for walk anim direction (+1 toward opponent, -1 away, 0 strafe) */
  walkDir: number;
};

export type SimEvent =
  | { type: 'hit'; x: number; y: number; z: number; blocked: boolean; heavy: boolean; dmg: number; to: number }
  | { type: 'swing'; who: number; heavy: boolean }
  | { type: 'jump' | 'land' | 'roll'; who: number }
  | { type: 'ko'; who: number }
  | { type: 'callout'; text: string; big?: boolean }
  | { type: 'round'; winner: number | null }
  | { type: 'match'; winner: number };

export type Phase = 'intro' | 'fight' | 'ko' | 'roundEnd' | 'matchEnd';

export type Sim = {
  f: [Fighter, Fighter];
  phase: Phase;
  phaseT: number;
  round: number;
  timer: number;
  freeze: number;
  slow: number;
  events: SimEvent[];
  time: number;
  roundsToWin: number;
  roundTime: number;
};

export const RING = 5.2;
const GRAV = 15;
const MIN_SEP = 0.95;

const BASE_ANIM = (clip: string, speed = 1, loop = true): Anim => ({ clip, speed, loop, key: 0, fade: 0.2 });

export function makeFighter(slug: string, name: string, stats: Stats, side: -1 | 1): Fighter {
  const [str, spd, skl, sta, stl] = stats;
  const maxHp = Math.round(180 + (sta - 10) * 6);
  return {
    slug, name, stats,
    x: side * 1.6, z: 0, y: 0, vy: 0, vx: 0, vz: 0,
    face: side < 0 ? Math.PI / 2 : -Math.PI / 2,
    hp: maxHp, maxHp,
    state: 'idle', t: 0, atk: null, combo: 0, hitDone: false, stun: 0, wins: 0,
    anim: BASE_ANIM('Sword_Idle'),
    buf: { jump: Infinity, roll: Infinity, light: Infinity, heavy: Infinity },
    rollCd: 0,
    dmgMul: 0.8 + str * 0.025,
    move: 2.3 * (0.86 + spd * 0.018),
    tempo: 0.92 + spd * 0.01,
    chip: Math.max(0.06, 0.2 - skl * 0.008),
    iframes: 0.38 + stl * 0.012,
    walkDir: 0,
  };
}

export function makeSim(a: Fighter, b: Fighter, roundsToWin = 2, roundTime = 60): Sim {
  const s: Sim = { f: [a, b], phase: 'intro', phaseT: 0, round: 1, timer: roundTime, freeze: 0, slow: 1, events: [], time: 0, roundsToWin, roundTime };
  startRound(s);
  return s;
}

function setAnim(f: Fighter, clip: string, speed = 1, loop = true, fade = 0.18, hold?: number) {
  f.anim = { clip, speed, loop, key: f.anim.key + 1, fade, hold };
}

function setState(f: Fighter, st: FState) {
  f.state = st;
  f.t = 0;
}

function resetFighter(f: Fighter, side: -1 | 1) {
  f.x = side * 1.6;
  f.z = 0;
  f.y = f.vy = f.vx = f.vz = 0;
  f.face = side < 0 ? Math.PI / 2 : -Math.PI / 2;
  f.hp = f.maxHp;
  f.atk = null;
  f.combo = 0;
  f.stun = 0;
  f.rollCd = 0;
  f.buf = { jump: Infinity, roll: Infinity, light: Infinity, heavy: Infinity };
  setState(f, 'idle');
  setAnim(f, 'Sword_Idle', f.tempo, true, 0.3);
}

function startRound(s: Sim) {
  resetFighter(s.f[0], -1);
  resetFighter(s.f[1], 1);
  s.phase = 'intro';
  s.phaseT = 0;
  s.timer = s.roundTime;
  s.slow = 1;
  s.freeze = 0;
  s.events.push({ type: 'callout', text: s.f[0].wins === s.roundsToWin - 1 && s.f[1].wins === s.roundsToWin - 1 ? 'FINAL ROUND' : `ROUND ${s.round}` });
}

export function rematch(s: Sim) {
  s.f[0].wins = s.f[1].wins = 0;
  s.round = 1;
  startRound(s);
}

const yawTo = (a: Fighter, b: Fighter) => Math.atan2(b.x - a.x, b.z - a.z);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const can = (f: Fighter) => f.state === 'idle' || f.state === 'walk' || f.state === 'block';

function startAttack(s: Sim, f: Fighter, def: AttackDef, i: number) {
  setState(f, 'attack');
  f.atk = def;
  f.hitDone = false;
  f.face = yawTo(f, s.f[1 - i]);
  setAnim(f, def.clip, def.speed * f.tempo, false, 0.08);
  s.events.push({ type: 'swing', who: i, heavy: Boolean(def.heavy) });
}

/** Seconds of the current attack clip, for its fractions. */
const atkLen = (f: Fighter) => (f.atk ? CLIP_LEN[f.atk.clip] / (f.atk.speed * f.tempo) : 0);

function press(f: Fighter, inp: Input, dt: number) {
  const b = f.buf;
  b.jump = inp.jump ? 0 : b.jump + dt;
  b.roll = inp.roll ? 0 : b.roll + dt;
  b.light = inp.light ? 0 : b.light + dt;
  b.heavy = inp.heavy ? 0 : b.heavy + dt;
}
const BUF = 0.22;

function control(s: Sim, i: number, inp: Input, dt: number) {
  const f = s.f[i];
  const o = s.f[1 - i];
  const b = f.buf;
  f.rollCd = Math.max(0, f.rollCd - dt);
  if (s.phase !== 'fight') return;
  // combo: a light press after this swing's hit window chains into the next link
  if (f.state === 'attack' && f.atk) {
    const len = atkLen(f);
    const frac = f.t / len;
    const li = LIGHT.indexOf(f.atk);
    if (li >= 0 && li < LIGHT.length - 1 && b.light < BUF && frac > f.atk.active[1] - 0.05) {
      b.light = Infinity;
      f.combo = li + 1;
      startAttack(s, f, LIGHT[li + 1], i);
      return;
    }
    if (b.roll < BUF && frac > f.atk.active[1]) {
      // roll-cancel out of recovery
    } else return;
  }
  if (!can(f) && f.state !== 'attack') return;
  const mv = Math.hypot(inp.x, inp.z);
  if (b.roll < BUF && f.rollCd <= 0 && f.y <= 0) {
    b.roll = Infinity;
    // roll the way you're pushing, or back out if you aren't
    let dx = inp.x, dz = inp.z;
    if (mv < 0.2) {
      dx = f.x - o.x;
      dz = f.z - o.z;
    }
    const l = Math.hypot(dx, dz) || 1;
    f.vx = (dx / l) * 4.6;
    f.vz = (dz / l) * 4.6;
    f.face = Math.atan2(dx, dz);
    setState(f, 'roll');
    setAnim(f, 'Roll', 2.1, false, 0.06);
    f.rollCd = 0.25;
    s.events.push({ type: 'roll', who: i });
    return;
  }
  if (b.heavy < BUF) {
    b.heavy = Infinity;
    f.combo = 0;
    startAttack(s, f, HEAVY, i);
    return;
  }
  if (b.light < BUF) {
    b.light = Infinity;
    f.combo = 0;
    startAttack(s, f, LIGHT[0], i);
    return;
  }
  if (b.jump < BUF && f.y <= 0) {
    b.jump = Infinity;
    f.vy = 5.6;
    f.vx = inp.x * f.move * 0.9;
    f.vz = inp.z * f.move * 0.9;
    setState(f, 'jump');
    setAnim(f, 'Jump_Loop', 1, true, 0.1);
    s.events.push({ type: 'jump', who: i });
    return;
  }
  if (inp.block) {
    if (f.state !== 'block') {
      setState(f, 'block');
      setAnim(f, 'Sword_Block', 1.6, false, 0.08, 0.32);
    }
    return;
  }
  if (mv > 0.15) {
    const ax = o.x - f.x, az = o.z - f.z;
    const al = Math.hypot(ax, az) || 1;
    const along = (inp.x * ax + inp.z * az) / (al * mv);
    const dir = along > 0.4 ? 1 : along < -0.4 ? -1 : 0;
    const sp = f.move * (dir < 0 ? 0.78 : dir === 0 ? 0.85 : 1);
    f.x += inp.x * sp * dt;
    f.z += inp.z * sp * dt;
    if (f.state !== 'walk' || f.walkDir !== dir) {
      setState(f, 'walk');
      f.walkDir = dir;
      // backing off plays the walk in reverse; strafing uses the walk too, at a shuffle
      setAnim(f, dir === 1 ? 'Jog_Fwd_Loop' : 'Walk_Loop', dir === 1 ? 0.95 : dir < 0 ? -1.25 : 1.15, true, 0.15);
    }
  } else if (f.state !== 'idle') {
    setState(f, 'idle');
    setAnim(f, 'Sword_Idle', f.tempo, true, 0.2);
  }
}

function physics(s: Sim, i: number, dt: number) {
  const f = s.f[i];
  const o = s.f[1 - i];
  f.t += dt;
  // turn toward the opponent unless mid-swing or rolling
  if (f.state !== 'attack' && f.state !== 'roll' && f.state !== 'ko' && f.state !== 'hit') {
    const want = yawTo(f, o);
    const d = wrap(want - f.face);
    f.face += Math.sign(d) * Math.min(Math.abs(d), 12 * dt);
  }
  if (f.state === 'attack' && f.atk) {
    const len = atkLen(f);
    const frac = f.t / len;
    // track a little during the windup so swings don't whiff on a sidestep
    if (frac < f.atk.active[0]) {
      const d = wrap(yawTo(f, o) - f.face);
      f.face += Math.sign(d) * Math.min(Math.abs(d), 5 * dt);
    }
    if (frac < f.atk.active[1]) {
      const dist = Math.hypot(o.x - f.x, o.z - f.z);
      if (dist > MIN_SEP + 0.25) {
        f.x += Math.sin(f.face) * f.atk.lunge * dt;
        f.z += Math.cos(f.face) * f.atk.lunge * dt;
      }
    }
    if (!f.hitDone && frac >= f.atk.active[0] && frac <= f.atk.active[1]) tryHit(s, i);
    if (frac >= f.atk.end) {
      f.atk = null;
      setState(f, 'idle');
      setAnim(f, 'Sword_Idle', f.tempo, true, 0.25);
    }
  }
  if (f.state === 'roll') {
    const k = Math.max(0, 1 - f.t / 0.6);
    f.x += f.vx * k * dt;
    f.z += f.vz * k * dt;
    if (f.t > 0.62) {
      f.vx = f.vz = 0;
      setState(f, 'idle');
      setAnim(f, 'Sword_Idle', f.tempo, true, 0.2);
    }
  }
  if (f.state === 'hit' || f.state === 'ko' || f.state === 'block') {
    f.x += f.vx * dt;
    f.z += f.vz * dt;
    const damp = Math.exp(-6 * dt);
    f.vx *= damp;
    f.vz *= damp;
    f.stun -= dt;
    if (f.state === 'hit' && f.stun <= 0) {
      setState(f, 'idle');
      setAnim(f, 'Sword_Idle', f.tempo, true, 0.25);
    }
  }
  if (f.state === 'jump' || f.y > 0) {
    f.vy -= GRAV * dt;
    f.y += f.vy * dt;
    if (f.state === 'jump') {
      f.x += f.vx * dt;
      f.z += f.vz * dt;
    }
    if (f.y <= 0) {
      f.y = 0;
      f.vy = 0;
      if (f.state === 'jump') {
        f.vx = f.vz = 0;
        setState(f, 'idle');
        setAnim(f, 'Sword_Idle', f.tempo, true, 0.3);
        s.events.push({ type: 'land', who: i });
      }
    }
  }
  // stay on the floor
  const r = Math.hypot(f.x, f.z);
  if (r > RING) {
    f.x *= RING / r;
    f.z *= RING / r;
  }
}

function separate(s: Sim) {
  const [a, b] = s.f;
  if (a.y > 0.5 || b.y > 0.5) return; // jump over
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d >= MIN_SEP) return;
  const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
  const push = (MIN_SEP - d) / 2;
  a.x -= nx * push;
  a.z -= nz * push;
  b.x += nx * push;
  b.z += nz * push;
}

function tryHit(s: Sim, i: number) {
  const f = s.f[i];
  const o = s.f[1 - i];
  const def = f.atk!;
  if (o.state === 'ko') return;
  const dx = o.x - f.x, dz = o.z - f.z;
  const d = Math.hypot(dx, dz);
  if (d > def.range) return;
  const ang = Math.abs(wrap(Math.atan2(dx, dz) - f.face));
  if (ang > 1.05) return;
  if (o.y > (def.heavy ? 0.9 : 0.4)) return; // jumped it
  if (o.state === 'roll' && o.t < o.iframes) return; // rolled through it
  f.hitDone = true;
  const nx = dx / (d || 1), nz = dz / (d || 1);
  const hy = def.react === 'Hit_Head' ? 1.25 : 0.95;
  const at = { x: o.x - nx * 0.25, y: hy, z: o.z - nz * 0.25 };
  // blocking works facing the swing
  const facing = Math.abs(wrap(o.face - Math.atan2(-dx, -dz))) < 1.6;
  if (o.state === 'block' && facing) {
    const dmg = def.dmg * f.dmgMul * o.chip;
    o.hp = Math.max(1, o.hp - dmg);
    o.vx = nx * (def.heavy ? 3.2 : 2);
    o.vz = nz * (def.heavy ? 3.2 : 2);
    o.stun = 0.15;
    s.freeze = 0.05;
    s.events.push({ type: 'hit', ...at, blocked: true, heavy: Boolean(def.heavy), dmg, to: 1 - i });
    return;
  }
  // combo scaling keeps long strings fair
  const dmg = def.dmg * f.dmgMul * (o.state === 'hit' ? 0.85 : 1);
  o.hp = Math.max(0, o.hp - dmg);
  o.atk = null;
  s.freeze = def.heavy ? 0.13 : 0.075;
  s.events.push({ type: 'hit', ...at, blocked: false, heavy: Boolean(def.heavy), dmg, to: 1 - i });
  const kb = def.react === 'Hit_Knockback' ? 5.5 : 1.6;
  o.vx = nx * kb;
  o.vz = nz * kb;
  o.face = Math.atan2(-dx, -dz);
  if (o.hp <= 0) {
    setState(o, 'ko');
    o.vx = nx * 4;
    o.vz = nz * 4;
    setAnim(o, 'Death01', 1, false, 0.08);
    s.events.push({ type: 'ko', who: 1 - i });
    endRound(s, i);
    return;
  }
  setState(o, 'hit');
  o.stun = def.react === 'Hit_Knockback' ? 0.62 : 0.36;
  setAnim(o, def.react, def.react === 'Hit_Knockback' ? 1.05 : 0.95, false, 0.05);
}

function endRound(s: Sim, winner: number | null) {
  s.phase = 'ko';
  s.phaseT = 0;
  if (winner !== null) {
    s.f[winner].wins++;
    s.slow = 0.3;
  }
  s.events.push({ type: 'round', winner });
  s.events.push({ type: 'callout', text: winner === null ? 'DRAW' : s.timer <= 0 ? 'TIME' : 'K.O.', big: true });
}

/** Advance the fight by `dt` real seconds. */
export function step(s: Sim, inputs: [Input, Input], dt: number) {
  s.time += dt;
  for (let i = 0; i < 2; i++) press(s.f[i], inputs[i], dt);
  if (s.freeze > 0) {
    s.freeze -= dt;
    return 0;
  }
  const gdt = dt * s.slow;
  s.phaseT += dt;
  if (s.phase === 'intro') {
    if (s.phaseT > 1.5 && s.phaseT - dt <= 1.5) s.events.push({ type: 'callout', text: 'FIGHT', big: true });
    if (s.phaseT > 1.9) {
      s.phase = 'fight';
      s.phaseT = 0;
    }
  } else if (s.phase === 'fight') {
    s.timer = Math.max(0, s.timer - dt);
    if (s.timer <= 0) {
      const [a, b] = s.f;
      const pa = a.hp / a.maxHp, pb = b.hp / b.maxHp;
      const w = Math.abs(pa - pb) < 0.005 ? null : pa > pb ? 0 : 1;
      endRound(s, w);
    }
  } else if (s.phase === 'ko') {
    if (s.phaseT > 1.1) s.slow = 1;
    if (s.phaseT > 2) {
      s.phase = 'roundEnd';
      s.phaseT = 0;
      for (const f of s.f) {
        if (f.state === 'ko') continue;
        const won = s.f.some((o) => o !== f && (o.state === 'ko' || o.hp / o.maxHp < f.hp / f.maxHp));
        setState(f, won ? 'win' : 'lose');
        f.vx = f.vz = 0;
        setAnim(f, won ? 'Yes' : 'Idle_Loop', 1, true, 0.4);
      }
    }
  } else if (s.phase === 'roundEnd') {
    const champ = s.f.findIndex((f) => f.wins >= s.roundsToWin);
    if (s.phaseT > 2.6) {
      if (champ >= 0) {
        s.phase = 'matchEnd';
        s.phaseT = 0;
        const c = s.f[champ];
        
        s.events.push({ type: 'match', winner: champ });
        s.events.push({ type: 'callout', text: `${c.name.toUpperCase()} WINS`, big: true });
      } else {
        s.round++;
        startRound(s);
      }
    }
  }
  for (let i = 0; i < 2; i++) control(s, i, inputs[i], gdt);
  for (let i = 0; i < 2; i++) physics(s, i, gdt);
  separate(s);
  return gdt;
}
