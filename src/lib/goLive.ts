/**
 * GO LIVE — stream the game you're playing into the token's bChatX room (chat.bwalletx.com/room/<TICKER>).
 *
 * Flow (server side lives in bit-sign: /api/golive/challenge + /api/golive/publish):
 *   1. ask bChatX for a single-use challenge for this wallet's identity key;
 *   2. the wallet signs it (BRC-100 createSignature, protocol [2,'bwallet sign in'], keyID = nonce);
 *   3. bChatX checks the signature, that the player is a member of the room, and that fewer than 16 are live,
 *      then returns a LiveKit publish token;
 *   4. we publish the game canvas (canvas.captureStream) + the game's mixed sound as a screen share.
 *
 * No keys here: the token is minted by bChatX per player. Base URL is public config (NEXT_PUBLIC_BCHAT_URL).
 */
import { Room, Track, type LocalTrack, LocalVideoTrack, LocalAudioTrack } from 'livekit-client';
import type { Wallet } from './wallet';
import { gameAudioStream } from './sfx';

export const BCHAT_URL = (process.env.NEXT_PUBLIC_BCHAT_URL || 'https://chat.bwalletx.com').replace(/\/$/, '');
export const GO_LIVE_FPS = 30;

export type GoLiveError = { error: string; code?: string };

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BCHAT_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as T & Partial<GoLiveError>;
  if (!r.ok) {
    const e = new Error(j.error || `bChatX said ${r.status}`) as Error & { code?: string };
    e.code = j.code;
    throw e;
  }
  return j;
}

/** The biggest visible <canvas> inside `root` — the game's play area. */
export function findGameCanvas(root: ParentNode = document): HTMLCanvasElement | null {
  let best: HTMLCanvasElement | null = null;
  let area = 0;
  root.querySelectorAll('canvas').forEach((c) => {
    const r = c.getBoundingClientRect();
    const a = r.width * r.height;
    if (a > area) { area = a; best = c; }
  });
  return best;
}

export type LiveSession = { room: Room; handle: string; ticker: string; stop: () => Promise<void> };

/** Prove the wallet to bChatX and get a publish token for `ticker`'s room. */
async function publishToken(w: Wallet, ticker: string) {
  const ch = await post<{ nonce: string; message: string; expires_at: string; protocol_id: [0 | 1 | 2, string]; key_id: string }>(
    '/api/golive/challenge',
    { identity_key: w.publicKey },
  );
  const { signature } = await w.client.createSignature({
    protocolID: ch.protocol_id,
    keyID: ch.key_id,
    counterparty: 'anyone',
    data: Array.from(new TextEncoder().encode(ch.message)),
  });
  return post<{ token: string; url: string; room: string; handle: string; live: number; max: number }>('/api/golive/publish', {
    ticker, identity_key: w.publicKey, nonce: ch.nonce, expires_at: ch.expires_at, signature,
  });
}

/** Start streaming `canvas` (and the game sound) into `ticker`'s room. Throws with bChatX's message (e.g. room full). */
export async function goLive(w: Wallet, ticker: string, canvas: HTMLCanvasElement, onEnded?: () => void): Promise<LiveSession> {
  const t = await publishToken(w, ticker);
  const room = new Room({ adaptiveStream: false, dynacast: true });
  await room.connect(t.url, t.token);
  const tracks: LocalTrack[] = [];
  try {
    const v = canvas.captureStream(GO_LIVE_FPS).getVideoTracks()[0];
    if (!v) throw new Error('This game has no canvas to stream.');
    const video = new LocalVideoTrack(v, undefined, false);
    tracks.push(video);
    await room.localParticipant.publishTrack(video, { source: Track.Source.ScreenShare, name: 'game', simulcast: true });
    const a = gameAudioStream()?.getAudioTracks()[0];
    if (a) {
      const audio = new LocalAudioTrack(a.clone(), undefined, false);
      tracks.push(audio);
      await room.localParticipant.publishTrack(audio, { source: Track.Source.ScreenShareAudio, name: 'game-audio' });
    }
  } catch (e) {
    await room.disconnect();
    throw e;
  }
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const tr of tracks) tr.stop();
    await room.disconnect();
  };
  room.on('disconnected', () => { if (!stopped) { stopped = true; tracks.forEach((tr) => tr.stop()); onEnded?.(); } });
  return { room, handle: t.handle, ticker, stop };
}

export const roomUrl = (ticker: string) => `${BCHAT_URL}/room/${encodeURIComponent(ticker)}`;
