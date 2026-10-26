import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { KWEG, BANNERS, BRIEFING, CHARACTERS, FLATLINED, GAME_OVER, GAME_TITLE, LORE, LOADING_SHOTS, PREMISE, RANKS, RESCUED, STAGE_COUNT, TAGLINES, TERRORNODE_SLOGANS, TIPS, characterById, rankFor, shareText, stageBrief, PRACTICE, forPractice, practiceCopy } from './gallery/story';

const all = () => JSON.stringify({ GAME_TITLE, KWEG, PREMISE, TAGLINES, LORE, CHARACTERS, BRIEFING, BANNERS, RANKS, TIPS, FLATLINED, GAME_OVER, RESCUED, TERRORNODE_SLOGANS, stages: Array.from({ length: STAGE_COUNT }, (_, i) => stageBrief(i + 1)) });

test('story: 5 to 12 lore beats, all with text', () => {
  assert.ok(LORE.length >= 5 && LORE.length <= 12);
  for (const b of LORE) assert.ok(b.title && b.line.length > 20);
});

test('story: required characters and erobot types exist', () => {
  for (const id of ['gunner', 'npg', 'kweg', 'liquid', 'bot', 'frog', 'graf', 'stripey', 'tech']) assert.ok(characterById(id), id);
  for (const c of CHARACTERS) assert.ok(c.bio && c.threat && (!c.portrait || c.portrait.startsWith('/gallery/')));
});

test('story: every listed image is committed under public/ (a missing one 404s on every load)', () => {
  const paths = [...LOADING_SHOTS.map((s) => s.src), ...CHARACTERS.flatMap((c) => [c.portrait, c.shot].filter((x): x is string => !!x))];
  for (const p of paths) assert.ok(existsSync(join(process.cwd(), 'public', p)), p);
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
  assert.doesNotMatch(all(), /blockchain|\btxs?\b|transaction|satoshi|\bsats?\b|\bwallet\b|\bnode\b|\bhash\b|\bminer\b|\bOP_RETURN\b|\bARC\b|\bmempool\b/i);
});

test('story: four stages, each with a brief and a radio line from Kweg', () => {
  assert.equal(STAGE_COUNT, 4);
  assert.deepEqual(['STREET', 'HQ FLOORS', 'SERVER CORE', 'ROOFTOP'], [1, 2, 3, 4].map((n) => stageBrief(n).code.split('· ')[1]));
  for (let n = 1; n <= STAGE_COUNT; n++) {
    const b = stageBrief(n);
    assert.equal(b.n, n);
    assert.ok(b.title && b.brief && b.goal);
    assert.equal(b.kweg, KWEG.stages[n - 1]);
  }
  assert.equal(stageBrief(0).n, 1);
  assert.equal(stageBrief(99).n, STAGE_COUNT);
});

test('story: the Liquid Unit is the final boss and is only on the roof', () => {
  assert.doesNotMatch(stageBrief(1).brief + stageBrief(2).brief + stageBrief(3).brief, /liquid unit/i);
  assert.match(stageBrief(4).title, /LIQUID UNIT/);
  assert.match(BANNERS.boss.top, /FINAL BOSS/);
});

test('story: ranks cover every count', () => {
  assert.equal(rankFor(0).title, 'ROOKIE');
  assert.equal(rankFor(1_000_000).title, 'NETWORK BREAKER');
  assert.equal(rankFor(5_000).title, 'NEON HERO');
});

test('story: share text carries the numbers', () => {
  const t = shareText({ rounds: 12345, score: 999, stage: 3, name: 'rich' });
  assert.match(t, /12,345/);
  assert.match(t, /@rich/);
  assert.match(t, /stage 3/);
  assert.match(shareText({ rounds: 1, score: 1, stage: 4, rescued: true }), /rescued Dr Kweg S Wong/);
});

test('story: ESCAPE FROM TERRORNODE, Neo-Tokyo 2048, Kweg S Wong, the Ninja Punk Girls', () => {
  const a = all();
  assert.equal(GAME_TITLE, 'ESCAPE FROM TERRORNODE');
  assert.match(a, /Neo-Tokyo/);
  assert.match(a, /2048/);
  assert.match(a, /KWEG S WONG/i);
  assert.match(a, /NINJA PUNK GIRLS/i);
  assert.match(a, /TERRORNODE/);
  assert.match(a, /Storm TERRORNODE HQ\. Rescue Dr Kweg\./);
  assert.doesNotMatch(a, /nSLAVE|エヌスレイブ/i, 'nSLAVE is renamed TERRORNODE everywhere');
  assert.doesNotMatch(a, /bCorp/i, 'bCorp is out of the story');
  assert.doesNotMatch(a, /OMNICORE/i);
  assert.doesNotMatch(a, /London|1991|\bX Corp/i);
});

test('story: Kweg is the good hostage; the Erobots are evil; the Liquid Unit is NOT Kweg', () => {
  assert.equal(characterById('kweg')?.kind, 'hostage');
  assert.equal(characterById('kweg')?.bio, KWEG.bio);
  assert.equal(characterById('liquid')?.kind, 'boss');
  for (const c of CHARACTERS.filter((x) => x.kind === 'erobot')) assert.ok(c.threat.length > 10);
  assert.equal(KWEG.bio, 'Held hostage at the top of TERRORNODE HQ. Get him out.'); // owner, 25 Oct: one plain line
  assert.ok(!/founder|inventor/i.test(KWEG.role), 'Kweg is a good hostage, not the founder');
  assert.doesNotMatch(KWEG.bio + KWEG.threat, /villain|evil|Hyde|liquid metal/i, 'no Jekyll/Hyde, no liquid Kweg');
  assert.doesNotMatch(characterById('liquid')?.bio ?? '', /Dr Kweg Wong\.|It is Dr Kweg/, 'the Liquid Unit is not Kweg');
  assert.match(all(), /is not Kweg/);
  assert.match(KWEG.stages[0], /Rescue accepted, with required revisions/);
});

test('story: the affectionate parody touches survive', () => {
  const a = all();
  assert.match(a, /established .{0,40}in 2009/);
  assert.match(a, /peer-review/i);
  assert.match(a, /patent… for your soul/);
  assert.match(a, /as long as it’s BSV/);
  assert.match(a, /SOUL CHAIN/);
  assert.match(a, /accident/);
  assert.match(a, /hacking/);
  assert.match(a, /incident with the cow/);
  assert.match(a, /trial/);
  assert.match(a, /RESCUED/);
});

test('story: the lines are deadpan hostage lines, short enough for a radio caption', () => {
  const lines = [KWEG.intro, ...KWEG.stages, ...KWEG.clear, KWEG.boss, KWEG.melt, KWEG.rescued, KWEG.flatlined, KWEG.over];
  for (const l of lines) assert.ok(l.length > 15 && l.length < 200, l);
  assert.equal(KWEG.clear.length, STAGE_COUNT - 1);
});

test('free play: no copy claims live rounds, a chain, the record, real transactions or acceptance', () => {
  // The hostage's "accepted, with required revisions" is a peer-review joke about the rescue, not about rounds.
  const text = practiceCopy().join('\n').replace(/accepted, with required revisions/gi, 'reviewed')
    .replace(/\b(nothing|not)( goes| is)? on chain/gi, 'ok'); // the honest negation ("nothing goes on chain") is the point
  assert.doesNotMatch(text, /\blive\b|on chain|on the record|real transaction|real BSV|\baccepted\b/i);
  assert.match(PRACTICE.loaded.bottom, /PRACTICE ROUNDS/);
  assert.equal(PRACTICE.loaded.top, 'GUN LOADED.');
  assert.match(PRACTICE.badge, /nothing on chain/);
  assert.match(PRACTICE.kicker, /FREE PLAY/);
});

test('live copy keeps its claims (the swap only applies in free play)', () => {
  assert.match(BANNERS.loaded.bottom, /LIVE ROUNDS/);
  assert.match(forPractice(BANNERS.loaded.bottom), /PRACTICE ROUNDS/);
});
