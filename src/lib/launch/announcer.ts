/**
 * Token-page announcer voice: plays once per visit (sessionStorage), never when the viewer muted it or muted the site.
 * Pure helpers so the rules are unit-tested (announcer.test.ts); the player is components/launch/TokenAnnouncer.tsx.
 */
type Store = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

export const PLAYED_KEY = (tokenId: string) => `tb-announcer-played:${tokenId}`;
/** Per-viewer speaker toggle (localStorage): '0' = off. Covers the voice and the page music. */
export const PREF_KEY = 'tb-announcer-sound';

const read = (s: Store, k: string): string | null => {
  try {
    return s?.getItem(k) ?? null;
  } catch {
    return null;
  }
};
const write = (s: Store, k: string, v: string) => {
  try {
    s?.setItem(k, v);
  } catch {}
};

/** Has this visit (tab session) already heard the line? Storage that throws counts as "not yet". */
export const alreadyPlayed = (session: Store, tokenId: string) => read(session, PLAYED_KEY(tokenId)) === '1';
export const markPlayed = (session: Store, tokenId: string) => write(session, PLAYED_KEY(tokenId), '1');

export const speakerOn = (local: Store) => read(local, PREF_KEY) !== '0';
export const setSpeaker = (local: Store, on: boolean) => write(local, PREF_KEY, on ? '1' : '0');

/** The game bar's global mute (sfx.ts keeps { muted } under 'tb.audio') and the site player's mute ('tb-preview-sound' = '0'). */
export function siteMuted(local: Store): boolean {
  if (read(local, 'tb-preview-sound') === '0') return true;
  try {
    return JSON.parse(read(local, 'tb.audio') ?? '{}')?.muted === true;
  } catch {
    return false;
  }
}

/** Should the line play now? */
export const shouldAnnounce = (session: Store, local: Store, tokenId: string) =>
  !alreadyPlayed(session, tokenId) && speakerOn(local) && !siteMuted(local);
