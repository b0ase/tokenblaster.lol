import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN, LEVELS, freshProgress, isReached, levelOf, loadProgress, nextLevel, parseProgress, recordClear, saveProgress, teamWaveSize, waveK, PROGRESS_KEY } from './terrornode/levels';
import { TUNING } from './galleryGame/tuning';

test('four new levels after the block, each its own palette, mix and wave pattern, a boss on the last', () => {
  assert.equal(CAMPAIGN.length, 4);
  assert.deepEqual(CAMPAIGN, ['market', 'rails', 'datacore', 'heart']);
  const fresh = CAMPAIGN.map(levelOf);
  assert.equal(new Set(fresh.map((l) => l.palette.key)).size, 4, 'distinct palettes');
  assert.equal(new Set(fresh.map((l) => JSON.stringify(l.solo.roles))).size, 4, 'distinct enemy mixes');
  assert.equal(new Set(fresh.map((l) => JSON.stringify(l.solo.wave))).size, 4, 'distinct wave patterns');
  assert.equal(fresh.at(-1)!.boss, true);
  assert.ok(fresh.at(-1)!.solo.bossAt! < fresh.at(-1)!.solo.to);
  assert.ok(fresh.at(-1)!.team.bossHp! > 0);
  for (const l of LEVELS) {
    const r = l.solo.roles;
    assert.ok(Math.abs(r.shooter + r.rusher + r.flanker - 1) < 1e-9, `${l.id} roles sum to 1`);
    assert.ok(l.solo.from >= 0 && l.solo.to <= TUNING.run.secs && l.solo.to > l.solo.from, `${l.id} window inside the block`);
    for (const k of Object.keys(l.solo.horde)) assert.ok(TUNING.horde.kinds.some((x) => x.id === k), `${l.id} horde kind ${k}`);
  }
});

test('levels sit on the right stage sets of the route', () => {
  const stageAt = (t: number) => TUNING.stages.reduce((i, s, k) => (t >= s.at ? k : i), 0);
  assert.equal(TUNING.stages[stageAt(levelOf('market').solo.from)].id, 'street');
  assert.equal(TUNING.stages[stageAt(levelOf('rails').solo.from)].id, 'roof');
  assert.equal(TUNING.stages[stageAt(levelOf('datacore').solo.from)].id, 'core');
  assert.equal(TUNING.stages[stageAt(levelOf('datacore').solo.to - 1)].id, 'core');
  assert.equal(TUNING.stages[stageAt(levelOf('heart').solo.bossAt!)].id, 'roof');
  // a level without a boss ends before the block's own boss walks in
  for (const l of LEVELS.filter((x) => !x.boss)) assert.ok(l.solo.to <= TUNING.run.bossAt);
});

test('wave patterns', () => {
  const pulse = levelOf('market').solo.wave;
  assert.ok(waveK(pulse, 1, 140) > waveK(pulse, 10, 140), 'in a pulse the swarm surges');
  const surge = levelOf('heart').solo.wave;
  assert.ok(waveK(surge, 140, 145) > waveK(surge, 0, 145), 'a surge grows across the level');
  assert.equal(waveK({ kind: 'steady', k: 1 }, 99, 100), 1);
  assert.equal(teamWaveSize(levelOf('assault').team, 1), 7); // the original 4 + 3n
});

test('progression: clear a level, the next opens; best score and rounds kept', () => {
  let p = freshProgress();
  assert.ok(isReached(p, 'assault') && isReached(p, 'market'));
  assert.ok(!isReached(p, 'rails'));
  p = recordClear(p, 'market', 12_000, 3_000, 1);
  assert.ok(isReached(p, 'rails'));
  assert.ok(!isReached(p, 'datacore'));
  p = recordClear(p, 'market', 9_000, 4_500, 2);
  assert.deepEqual(p.best.market, { score: 12_000, rounds: 4_500, clears: 2, at: 2 });
  p = recordClear(recordClear(p, 'rails', 1, 1), 'datacore', 1, 1);
  assert.ok(isReached(p, 'heart'));
  assert.equal(nextLevel('heart'), null);
  assert.equal(nextLevel('assault'), 'market');
  const end = recordClear(p, 'heart', 50, 5);
  assert.deepEqual(end.reached, ['assault', 'market', 'rails', 'datacore', 'heart']);
});

test('progress is stored locally and survives junk', () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  saveProgress(recordClear(freshProgress(), 'market', 100, 20), store);
  assert.ok(mem.has(PROGRESS_KEY));
  const back = loadProgress(store);
  assert.ok(isReached(back, 'rails'));
  assert.equal(back.best.market?.score, 100);
  assert.deepEqual(parseProgress('{not json'), freshProgress());
  assert.deepEqual(parseProgress(JSON.stringify({ v: 2, reached: ['heart'] })), freshProgress());
  const tampered = parseProgress(JSON.stringify({ v: 1, reached: ['nope', 'datacore'], best: { market: { score: -5, rounds: 'x' }, bogus: {} } }));
  assert.deepEqual(tampered.reached, ['assault', 'market', 'rails', 'datacore'], 'reaching a level implies the ones before it');
  assert.deepEqual(tampered.best.market, { score: 0, rounds: 0, clears: 0, at: 0 });
  assert.equal(loadProgress(null).reached.length, 2);
});
