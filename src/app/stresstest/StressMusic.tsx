'use client';
/**
 * /stresstest plays WELCOME TO TERRORNODE (owner, 8 Nov 2026), as the game page does: track 1 on load where the browser
 * allows it, otherwise on the first tap or key, the whole album in order. The game's sound control sits bottom-right.
 */
import { SoundToggle } from '@/components/SoundToggle';
import { TerrornodeMusic } from '@/components/terrornode/TerrornodeMusic';

export function StressMusic() {
  return (
    <>
      <TerrornodeMusic />
      <SoundToggle className="fixed bottom-3 right-3 z-[60]" />
    </>
  );
}
