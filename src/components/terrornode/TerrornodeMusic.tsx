'use client';
/**
 * The TERRORNODE page's one music player (owner, 31 Oct 2026): WELCOME TO TERRORNODE from track 1 on page load, the
 * whole album in order, round again. Held at page level so the game remounting under it (demo, results, reload)
 * never restarts or switches the song. Browsers that block autoplay start it on the first tap or key.
 */
import { useGameAudio } from '@/lib/sfx';

export function TerrornodeMusic() {
  useGameAudio('terror', { autoplay: true });
  return null;
}
