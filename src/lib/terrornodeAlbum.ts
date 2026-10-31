/**
 * WELCOME TO TERRORNODE, the album (NPGX, bMusicX: https://bmusicx.com/album/welcome-to-terrornode).
 * Owner, 31 Oct 2026: the TERRORNODE page plays this album from track 1 ("Welcome to Terrornode"), in order, the whole
 * way through and round again, one player across lobby, loading, match and results. Nothing in the game skips it.
 *
 * Track order and titles copy bMusicX's shelf (bitcoin-music lib/bmx/albums.ts, TERRORNODE). `file` is the path under
 * bMusicX's audio root. The browser never sees that path: it gets short-lived signed URLs from /api/music/terrornode
 * and the audio is streamed through /api/music/terrornode/[n] (src/app/api/music/terrornode).
 */
export type AlbumTrack = { n: number; title: string; seconds: number; file: string };

export const ALBUM = {
  slug: 'welcome-to-terrornode',
  title: 'WELCOME TO TERRORNODE',
  artist: 'NPGX',
  site: 'bMusicX',
  url: 'https://bmusicx.com/album/welcome-to-terrornode',
} as const;

export const ALBUM_TRACKS: AlbumTrack[] = [
  { n: 1, title: 'Welcome to Terrornode', seconds: 164, file: 'terrornode/welcome-to-terrornode-sample.m4a' },
  { n: 2, title: 'March of the Erobotz', seconds: 108, file: 'terrornode/march-of-the-erobotz-sample.m4a' },
  { n: 3, title: 'I Am TERRORNODE', seconds: 138, file: 'terrornode/i-am-terrornode-sample.m4a' },
  { n: 4, title: 'KAIJU-01', seconds: 193, file: 'terrornode/kaiju-01-sample.m4a' },
  { n: 5, title: 'Tokyo Gutter Queen', seconds: 192, file: 'tokyo-gutter-punk/01-sample.m4a' },
  { n: 6, title: 'Shibuya Mosh Pit', seconds: 135, file: 'tokyo-gutter-punk/03-sample.m4a' },
  { n: 7, title: 'Akihabara Fury', seconds: 144, file: 'neon-blood-riot/08-sample.m4a' },
  { n: 8, title: 'Shinobi Girls', seconds: 200, file: 'neon-blood-riot/07-sample.m4a' },
  { n: 9, title: '赤い雨 (Red Rain Signal)', seconds: 198, file: 'terrornode/shibuya-breaker-sample.m4a' },
  { n: 10, title: 'Underground Empress', seconds: 165, file: 'tokyo-gutter-punk/09-sample.m4a' },
  { n: 11, title: 'Molotov Kiss', seconds: 110, file: 'neon-blood-riot/06-sample.m4a' },
  { n: 12, title: 'Electric Geisha (電気芸者)', seconds: 244, file: 'terrornode/electric-geisha-sample.m4a' },
];

/** Same-origin stream path for track n (the signed query string is added by the playlist API). */
export const albumStreamPath = (n: number) => `/api/music/terrornode/${n}`;
