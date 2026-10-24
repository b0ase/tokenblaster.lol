import test from 'node:test';
import assert from 'node:assert/strict';
import { BANNERS, BRIEFING, CHARACTERS, LORE, LOADING_SHOTS, PREMISE, RANKS, TAGLINES, TIPS, WAVE_COUNT, characterById, rankFor, shareText, waveBrief } from './gallery/story';

const all = () => JSON.stringify({ PREMISE, TAGLINES, LORE, CHARACTERS, BRIEFING, BANNERS, RANKS, TIPS, waves: Array.from({ length: 8 }, (_, i) => waveBrief(i + 1)) });

test('story: 5 to 7 lore beats, all with text', () => {
  assert.ok(LORE.length >= 5 && LORE.length <= 7);
  for (const b of LORE) assert.ok(b.title && b.line.length > 20);
});

test('story: required characters and erobot types exist', () => {
  for (const id of ['gunner', 'liquid', 'bot', 'frog', 'graf', 'stripey', 'tech']) assert.ok(characterById(id), id);
  for (const c of CHARACTERS) assert.ok(c.bio && c.threat && c.portrait.startsWith('/gallery/'));
});

test('story: every shot points at a real lore beat and character', () => {
  const beats = new Set(LORE.map((b) => b.id));
  for (const s of LOADING_SHOTS) {
    assert.ok(beats.has(s.beat), s.src);
    if (s.focus) assert.ok(characterById(s.focus), s.src);
  }
});

test('story: no Terminator / T2 names or likeness', () => {
  assert.doesNotMatch(all(), /terminator|skynet|t-?1000|t-?800|cyberdyne|sarah connor|john connor|arnold|hasta la vista|judgment day|miles dyson/i);
});

test('story: plain words for players (no tech terms)', () => {
  assert.doesNotMatch(all(), /blockchain|\btxs?\b|transaction|satoshi|\bsats?\b|\bBSV\b|\bwallet\b|\bnode\b|\bhash\b|\bminer\b|\bOP_RETURN\b|\bARC\b|\bmempool\b/i);
});

test('story: waves escalate and never run out', () => {
  assert.equal(waveBrief(1).n, 1);
  assert.equal(waveBrief(WAVE_COUNT).n, WAVE_COUNT);
  const past = waveBrief(WAVE_COUNT + 3);
  assert.equal(past.n, WAVE_COUNT + 3);
  assert.ok(past.title && past.brief);
  assert.equal(waveBrief(0).n, 1);
});

test('story: ranks cover every count', () => {
  assert.equal(rankFor(0).title, 'ROOKIE');
  assert.equal(rankFor(1_000_000).title, 'GRID BREAKER');
  assert.equal(rankFor(5_000).title, 'NEON HERO');
});

test('story: share text carries the numbers', () => {
  const t = shareText({ rounds: 12345, score: 999, waves: 3, name: 'rich' });
  assert.match(t, /12,345/);
  assert.match(t, /@rich/);
});

test('story: set in Neo-Tokyo, 2048 (not London 1991)', () => {
  assert.match(all(), /Neo-Tokyo/);
  assert.match(all(), /2048/);
  assert.doesNotMatch(all(), /London|1991/);
});
