import { test } from 'node:test';
import assert from 'node:assert/strict';
import { albumSource } from './albumSource';
import { ALBUM_TRACKS } from './terrornodeAlbum';

const t1 = ALBUM_TRACKS[0];

test('album source: private blob full track only when TB_ALBUM_SOURCE=blob and a token is set', () => {
  assert.deepEqual(albumSource(t1, { TB_ALBUM_SOURCE: 'blob', BLOB_READ_WRITE_TOKEN: 'x' }), {
    kind: 'blob',
    pathname: 'terrornode-album/terrornode/welcome-to-terrornode.m4a',
  });
  assert.equal(albumSource(t1, { TB_ALBUM_SOURCE: 'blob' }).kind, 'url');
  assert.equal(albumSource(t1, { BLOB_READ_WRITE_TOKEN: 'x' }).kind, 'url');
});

test('album source: falls back to bMusicX samples', () => {
  assert.deepEqual(albumSource(t1, {}), { kind: 'url', url: 'https://bmusicx.com/bmx/samples/terrornode/welcome-to-terrornode-sample.m4a' });
  assert.deepEqual(albumSource(t1, { TB_ALBUM_AUDIO_BASE: 'https://a.b/c/' }), { kind: 'url', url: 'https://a.b/c/terrornode/welcome-to-terrornode-sample.m4a' });
});

test('album: every track has a full-length master and no sample as master', () => {
  for (const t of ALBUM_TRACKS) {
    assert.match(t.master, /^[a-z0-9-]+\/[a-z0-9-]+\.(m4a|mp3)$/);
    assert.doesNotMatch(t.master, /sample/);
    assert.ok(t.seconds > 45);
  }
});
