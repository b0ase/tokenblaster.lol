/** House ammo bits: the badge on a game's own coin, and the "buy it on BlastPad" line. */
import { HOUSE_GOLD, type GameCoin } from '@/lib/gameCoins';

export function HouseBadge({ label = 'HOUSE AMMO' }: { label?: string }) {
  return (
    <span className="shrink-0 rounded-sm border px-1 text-[10px] font-bold leading-4 tracking-widest" style={{ color: HOUSE_GOLD, borderColor: HOUSE_GOLD }}>
      {label}
    </span>
  );
}

export function BuyHouse({ coin }: { coin: GameCoin }) {
  return (
    <p className="text-xs text-dim">
      <span style={{ color: HOUSE_GOLD }}>${coin.sym}</span> is the house ammo ·{' '}
      <a href={coin.url} target="_blank" rel="noopener noreferrer" className="text-accent underline hover:text-hot">
        Buy on BlastPad ›
      </a>
    </p>
  );
}
