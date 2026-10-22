/** bRacer teams + sponsors registry (src/lib/hyper/registry.ts): URL parsing, grids, adverts, sponsor copy. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_TEAMS, BRACER_TEAMS, dealTeams, FAMILY_TEAMS, luminance, MAX_TEAMS, parseIds, resolveRace, SPONSORS, teamById, teamGlow } from './hyper/registry';

const FAMILY_HOSTS = ['dns-dex.com', 'claw-dex.com', 'repo-dex.com', 'git-dex.com', 'bwalletx.com', 'bit-sign.online', 'vexvoid.com', 'ninjapunkgirls.com', 'npgx.website', 'bmovies.online', 'b0ase.com', 'path402.com'];

test('launch teams are unchanged and first; family teams follow', () => {
  assert.deepEqual(BRACER_TEAMS.map((t) => t.id), ['house', 'token', 'inscription', 'payment', 'data', 'social']);
  assert.deepEqual(teamById('house'), { id: 'house', name: 'TOKENBLASTER', kana: 'トークンブラスター', code: 'TB-01', base: '#e8261d', accent: '#ffffff', trim: '#111111', motto: 'BLAST MORE' });
  assert.deepEqual(FAMILY_TEAMS.map((t) => t.id), ['dnsdex', 'clawdex', 'repodex', 'gitdex', 'bwalletx', 'vexvoid', 'npg', 'npgx']);
  assert.equal(new Set(ALL_TEAMS.map((t) => t.id)).size, ALL_TEAMS.length, 'ids unique');
  assert.equal(new Set(ALL_TEAMS.map((t) => t.code)).size, ALL_TEAMS.length, 'codes unique');
  assert.equal(new Set(ALL_TEAMS.map((t) => t.base)).size, ALL_TEAMS.length, 'no two teams share a body colour');
});

test('the name is bRacer: no "Open GP" or "bRacerX" anywhere in the data', () => {
  const blob = JSON.stringify({ ALL_TEAMS, SPONSORS });
  assert.doesNotMatch(blob, /open\s*gp|bracerx/i);
});

test('every team shows a visible light (trails and minimap) and a readable name tag', () => {
  for (const t of ALL_TEAMS) {
    assert.ok(luminance(teamGlow(t)) >= 0.03, `${t.id} glow too dark`);
    if (t.ink) {
      const [a, b] = [luminance(t.ink), luminance(t.base)].sort((x, y) => y - x);
      assert.ok((a + 0.05) / (b + 0.05) >= 4.5, `${t.id} ink contrast`);
    }
  }
});

test('ids: aliases, unknown ignored, duplicates dropped, order kept, capped', () => {
  assert.deepEqual(parseIds('dnsdex, nope ,CLAW-DEX,tokenblaster,dnsdex,,bAcc', teamById, 8), ['dnsdex', 'clawdex', 'house', 'bwalletx']);
  assert.deepEqual(parseIds(null, teamById, 8), []);
  assert.deepEqual(parseIds('toString,constructor', teamById, 8), [], 'prototype keys are not teams');
  assert.equal(parseIds(ALL_TEAMS.map((t) => t.id).join(','), teamById, MAX_TEAMS).length, MAX_TEAMS);
});

test('no params: every team on the menu, no URL player, adverts on', () => {
  const r = resolveRace('');
  assert.equal(r.customGrid, false);
  assert.equal(r.player, null);
  assert.equal(r.teams.length, ALL_TEAMS.length);
  assert.equal(r.ads, true);
  assert.deepEqual(r.sponsors.map((s) => s.id), SPONSORS.map((s) => s.id));
});

test('?teams= builds the grid; ?team= picks the player', () => {
  const r = resolveRace('teams=dnsdex,clawdex,tokenblaster,vexvoid');
  assert.equal(r.customGrid, true);
  assert.deepEqual(r.teams.map((t) => t.id), ['dnsdex', 'clawdex', 'house', 'vexvoid']);
  assert.equal(r.player?.id, 'dnsdex');
  const p = resolveRace('teams=dnsdex,clawdex&team=npg');
  assert.deepEqual(p.teams.map((t) => t.id), ['npg', 'dnsdex', 'clawdex']);
  assert.equal(p.player?.id, 'npg');
  assert.equal(resolveRace('team=npgx').player?.id, 'npgx', '?team= alone picks from the full list');
  assert.equal(resolveRace('teams=nope,also-nope').customGrid, false);
  assert.equal(resolveRace(`teams=${ALL_TEAMS.map((t) => t.id).join(',')}&team=npgx`).teams.length, MAX_TEAMS);
});

test('sponsors: override, unknown ignored, ads=0 removes them all', () => {
  assert.deepEqual(resolveRace('sponsors=dnsdex,zzz,bmovies').sponsors.map((s) => s.id), ['dnsdex', 'bmovies']);
  assert.equal(resolveRace('sponsors=zzz').sponsors.length, SPONSORS.length);
  assert.deepEqual(resolveRace('ads=0').sponsors, []);
  assert.deepEqual(resolveRace('ads=0&sponsors=dnsdex').sponsors, []);
});

test('every sponsor links to a family site over https, no tracking, factual short tagline', () => {
  for (const s of SPONSORS) {
    const u = new URL(s.url);
    assert.equal(u.protocol, 'https:', s.id);
    assert.ok(FAMILY_HOSTS.includes(u.hostname), `${s.id}: ${u.hostname}`);
    assert.equal(u.search, '', `${s.id}: no query/tracking parameters`);
    assert.ok(s.tagline.length <= 40, `${s.id} tagline too long`);
    assert.doesNotMatch(s.tagline, /earn|profit|return|yield|income|invest|dividend|passive|\bgains?\b|\bROI\b/i, `${s.id}: no income claims`);
  }
});

test('rival teams are dealt round-robin with the player team last', () => {
  const teams = ['dnsdex', 'clawdex', 'npg'].map((i) => teamById(i)!);
  assert.deepEqual(dealTeams(teams, 7).map((t) => t.id), ['clawdex', 'npg', 'dnsdex', 'clawdex', 'npg', 'dnsdex', 'clawdex']);
  assert.deepEqual(dealTeams([], 7), []);
  assert.ok(dealTeams([teams[0]], 3).every((t) => t.id === 'dnsdex'));
});
