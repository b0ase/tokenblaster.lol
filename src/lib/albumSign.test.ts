import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TTL_SECS, signedAlbumUrl, verifyAlbumSig } from './albumSign';
import { ALBUM_TRACKS } from './terrornodeAlbum';

const parse = (u: string) => {
  const q = new URL(u, 'https://x').searchParams;
  return [q.get('e'), q.get('s')] as const;
};

test('album: track 1 is Welcome to Terrornode, twelve tracks in order', () => {
  assert.equal(ALBUM_TRACKS[0].title, 'Welcome to Terrornode');
  assert.deepEqual(ALBUM_TRACKS.map((t) => t.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('signed album URL verifies for its own track only, and expires', () => {
  const now = 1_800_000_000;
  const [e, s] = parse(signedAlbumUrl(3, now + TTL_SECS));
  assert.equal(verifyAlbumSig(3, e, s, now), true);
  assert.equal(verifyAlbumSig(4, e, s, now), false);
  assert.equal(verifyAlbumSig(3, e, s, now + TTL_SECS + 1), false);
  assert.equal(verifyAlbumSig(3, e, 'x' + (s ?? '').slice(1), now), false);
  assert.equal(verifyAlbumSig(3, String(now + TTL_SECS * 10), s, now), false);
});
