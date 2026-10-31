/**
 * TERRORNODE fire gate (owner, 31 Oct 2026): a paid (on-chain) round may only be broadcast while a round is
 * visibly live and the player has fired it. Before this gate, a storm session left over from the last round kept
 * draining its queue while the LOADING YOUR AMMO screen was up (block 973421: 100+ shots mined behind a stuck
 * loading screen). Every sender in src/components/gallery/ShootingGallery.tsx asks this before it sends.
 */
export type FireState = {
  mode: 'off' | 'warm' | 'live';
  /** The loadout (weapon pick / LOCK & LOAD screen) is open. */
  loadout: boolean;
  /** The results screen is up. */
  over: boolean;
  /** FLATLINED (the CONTINUE? screen). */
  flat: boolean;
  /** PAUSE. */
  paused: boolean;
  /** Rounds the trigger has fired this round, and rounds already sent. */
  fired: number;
  sent: number;
};

/** True only when real rounds may go out right now. */
export function mayBroadcast(s: FireState): boolean {
  return s.mode === 'live' && !s.loadout && !s.over && !s.flat && !s.paused && s.fired > s.sent;
}

/**
 * Starting a load (LOCK & LOAD, CONTINUE, RETRY): rounds fired but never sent are dropped (the sats stay in the
 * gun as credit), so nothing from the last round can be sent while the next one loads.
 */
export function dropBacklog(s: { fired: number; sent: number }): { fired: number; dropped: number } {
  return { fired: s.sent, dropped: Math.max(0, s.fired - s.sent) };
}
