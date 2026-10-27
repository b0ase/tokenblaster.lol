/**
 * TERRORNODE team-match TEXT chat (shared by the game server and the browser).
 * Channels: 'team' (your own side only), 'all' (everyone in the match, opponents and spectators too), 'dm' (one player).
 * Ephemeral: the server relays and keeps nothing; messages die with the match. Spectators read 'all' and never send.
 * Routing is decided here on the server, so a team message is never written to the other side's sockets.
 */
export type ChatChannel = 'team' | 'all' | 'dm';
export const CHAT_MAX = 280;
export const CHAT_RATE = { n: 5, ms: 5000 };
/** Advertised in the welcome / watching reply; the site hides chat when the server doesn't list it. */
export const CHAT_FEATURE = 'chat';

export type ChatMsg = { t: 'chat'; ch: ChatChannel; from: string; name: string; team: string; to?: string; text: string; at: number };

/** Strip control / bidi-override chars, collapse whitespace, clamp length. Empty result = drop. */
export function cleanText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_MAX);
}

/** Sliding-window limiter: true when this send is allowed (and recorded). */
export function allowChat(times: number[], now: number, rate = CHAT_RATE): boolean {
  while (times.length && now - times[0] >= rate.ms) times.shift();
  if (times.length >= rate.n) return false;
  times.push(now);
  return true;
}

export type ChatPeer = { player: string | null; team: string | null; watch: boolean };

/**
 * Who hears a message. Returns null (with a reason) when the sender may not send it.
 * `peers` is every socket in the match; `sender` is one of them.
 */
export function routeChat<P extends ChatPeer>(
  sender: P,
  peers: Iterable<P>,
  input: { ch?: unknown; to?: unknown; text?: unknown },
): { ok: true; ch: ChatChannel; text: string; to?: string; recipients: P[] } | { ok: false; error: string } {
  if (sender.watch || !sender.player || !sender.team) return { ok: false, error: 'Spectators can read the All channel but not send.' };
  const ch: ChatChannel | null = input.ch === 'team' || input.ch === 'all' || input.ch === 'dm' ? input.ch : null;
  if (!ch) return { ok: false, error: 'Unknown chat channel.' };
  const text = cleanText(input.text);
  if (!text) return { ok: false, error: 'Empty message.' };
  const all = [...peers];
  if (ch === 'all') return { ok: true, ch, text, recipients: all };
  if (ch === 'team') return { ok: true, ch, text, recipients: all.filter((p) => !p.watch && p.player && p.team === sender.team) };
  const to = typeof input.to === 'string' ? input.to : '';
  if (!to || to === sender.player) return { ok: false, error: 'Pick a player to message.' };
  const target = all.filter((p) => !p.watch && p.player === to);
  if (!target.length) return { ok: false, error: 'That player is not in the match.' };
  return { ok: true, ch, text, to, recipients: [...target, ...all.filter((p) => p === sender)] };
}

/** Client side: validate a server frame as a chat message (anything malformed is null). */
export function parseChat(m: unknown): ChatMsg | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (o.t !== 'chat' || (o.ch !== 'team' && o.ch !== 'all' && o.ch !== 'dm')) return null;
  if (typeof o.from !== 'string' || typeof o.text !== 'string') return null;
  const text = cleanText(o.text);
  if (!text) return null;
  return {
    t: 'chat',
    ch: o.ch,
    from: o.from,
    name: cleanText(o.name).slice(0, 32) || 'player',
    team: typeof o.team === 'string' ? o.team : '',
    to: typeof o.to === 'string' ? o.to : undefined,
    text,
    at: typeof o.at === 'number' ? o.at : Date.now(),
  };
}

/** Does the welcome / watching reply advertise chat? */
export const serverHasChat = (reply: { features?: unknown }) => Array.isArray(reply.features) && reply.features.includes(CHAT_FEATURE);
