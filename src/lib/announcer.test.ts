import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alreadyPlayed, markPlayed, setSpeaker, shouldAnnounce, siteMuted, speakerOn } from './launch/announcer';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
const T = 'abc_1';

test('plays once per visit', () => {
  const s = mem(), l = mem();
  assert.equal(shouldAnnounce(s, l, T), true);
  markPlayed(s, T);
  assert.equal(alreadyPlayed(s, T), true);
  assert.equal(shouldAnnounce(s, l, T), false);
  assert.equal(shouldAnnounce(mem(), l, T), true, 'a new visit (fresh session) hears it again');
  assert.equal(shouldAnnounce(s, l, 'other_1'), true, 'per token');
});

test('blocked storage never throws and still plays', () => {
  assert.doesNotThrow(() => markPlayed(broken, T));
  assert.equal(shouldAnnounce(broken, broken, T), true);
  assert.equal(shouldAnnounce(null, undefined, T), true);
});

test('speaker toggle and site mute silence it', () => {
  const l = mem();
  setSpeaker(l, false);
  assert.equal(speakerOn(l), false);
  assert.equal(shouldAnnounce(mem(), l, T), false);
  setSpeaker(l, true);
  assert.equal(shouldAnnounce(mem(), l, T), true);
  l.setItem('tb.audio', JSON.stringify({ muted: true }));
  assert.equal(siteMuted(l), true);
  assert.equal(shouldAnnounce(mem(), l, T), false);
  const p = mem();
  p.setItem('tb-preview-sound', '0');
  assert.equal(shouldAnnounce(mem(), p, T), false);
  p.setItem('tb-preview-sound', '1');
  p.setItem('tb.audio', 'not json');
  assert.equal(siteMuted(p), false);
});
