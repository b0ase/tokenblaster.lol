import { HEAVY, LIGHT, type Input, type Sim } from './sim';

export type Difficulty = 'easy' | 'normal' | 'hard';

const TUNE: Record<Difficulty, { react: number; aggro: number; block: number; dodge: number; combo: number; heavy: number }> = {
  easy: { react: 0.42, aggro: 0.9, block: 0.15, dodge: 0.05, combo: 0.25, heavy: 0.15 },
  normal: { react: 0.26, aggro: 1.6, block: 0.4, dodge: 0.14, combo: 0.6, heavy: 0.25 },
  hard: { react: 0.14, aggro: 2.4, block: 0.7, dodge: 0.25, combo: 0.9, heavy: 0.3 },
};

/** CPU brain state: one per CPU fighter. */
export type Brain = { diff: Difficulty; think: number; plan: 'approach' | 'poke' | 'back' | 'circle' | 'wait'; planT: number; side: number; blockT: number; saw: number };

export const makeBrain = (diff: Difficulty): Brain => ({ diff, think: 0, plan: 'approach', planT: 0, side: 1, blockT: 0, saw: -1 });

/** One step of CPU control for fighter `i`, as the same Input a player would give. */
export function cpuInput(s: Sim, i: number, br: Brain, dt: number): Input {
  const me = s.f[i];
  const o = s.f[1 - i];
  const T = TUNE[br.diff];
  const inp: Input = { x: 0, z: 0, jump: false, roll: false, light: false, heavy: false, block: false };
  if (s.phase !== 'fight' || me.state === 'ko' || me.state === 'hit') return inp;
  const dx = o.x - me.x, dz = o.z - me.z;
  const d = Math.hypot(dx, dz) || 1;
  const fx = dx / d, fz = dz / d;
  br.think -= dt;
  br.planT -= dt;
  br.blockT -= dt;

  // see the opponent's swing coming (after a reaction delay), then block or dodge it
  const threat = o.state === 'attack' && o.atk && d < o.atk.range + 0.6;
  if (threat && br.saw < 0) br.saw = 0;
  if (!threat) br.saw = -1;
  if (br.saw >= 0) {
    br.saw += dt;
    if (br.saw > T.react && br.saw - dt <= T.react) {
      const r = Math.random();
      if (r < T.block) br.blockT = 0.5;
      else if (r < T.block + T.dodge) inp.roll = true;
    }
  }
  if (br.blockT > 0 && me.state !== 'attack') {
    inp.block = true;
    return inp;
  }

  // keep the chain going in rhythm
  if (me.state === 'attack' && me.atk) {
    const li = LIGHT.indexOf(me.atk);
    if (li >= 0 && li < LIGHT.length - 1 && me.hitDone && Math.random() < T.combo * dt * 12) inp.light = true;
    return inp;
  }

  if (br.planT <= 0) {
    const r = Math.random();
    br.plan = d > 2.2 ? (r < 0.75 ? 'approach' : 'circle') : r < 0.55 ? 'poke' : r < 0.75 ? 'circle' : r < 0.9 ? 'back' : 'wait';
    br.planT = 0.4 + Math.random() * 0.8;
    br.side = Math.random() < 0.5 ? -1 : 1;
  }
  const inRange = d < LIGHT[0].range - 0.05;
  if (inRange && br.think <= 0 && o.state !== 'ko') {
    br.think = 1 / T.aggro;
    if (Math.random() < 0.8) {
      if (Math.random() < T.heavy && d < HEAVY.range) inp.heavy = true;
      else inp.light = true;
      return inp;
    }
  }
  if (o.y > 0.3 && d < 1.6 && Math.random() < T.heavy * dt * 6) inp.heavy = true; // anti-air
  switch (br.plan) {
    case 'approach':
    case 'poke':
      if (d > 1.35) {
        inp.x = fx;
        inp.z = fz;
      }
      break;
    case 'circle':
      inp.x = -fz * br.side * 0.9 + fx * 0.25;
      inp.z = fx * br.side * 0.9 + fz * 0.25;
      break;
    case 'back':
      inp.x = -fx;
      inp.z = -fz;
      if (Math.random() < dt * 0.5) inp.jump = true;
      break;
  }
  return inp;
}
