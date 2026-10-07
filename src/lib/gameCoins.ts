/**
 * Each game's own BlastPad coin (BSV-21, 0 decimals). It is the game's house ammo: listed first in
 * the picker, a perk when fired LIVE (gold rounds, 1.5x damage), and Chain Frogger takes it per move.
 */
import { iconUrl } from './tokens';

export type GameKey = 'arena' | 'doubleo' | 'frogger' | 'bsvgun';
export type GameCoin = { game: GameKey | 'bracer'; id: string; sym: string; name: string; url: string; icon: string | null };

const coin = (game: GameKey | 'bracer', sym: string, name: string, id: string): GameCoin => ({
  game,
  id,
  sym,
  name,
  url: `/launch/${id}`,
  icon: iconUrl(`${id.split('_')[0]}_0`),
});

export const GAME_COINS: Record<GameKey, GameCoin> = {
  arena: coin('arena', 'ARENA', 'Arena', '79d84d2f194ef324837b6dc69e39afc404d1a1dc3cbadb0215d5fa06c2269a0f_1'),
  doubleo: coin('doubleo', 'DOUBLEO', 'Double-O Satoshi', '7f055b146c00b1f05bf7fe74ab5488fa69fec7d38c215e262ee23e01a768612d_1'),
  frogger: coin('frogger', 'FROGGER', 'Chain Frogger', 'af9c528abf0300cd08f1c41c1c3941e71e737bb9f76e5264399d7d2f93cb0c0a_1'),
  bsvgun: coin('bsvgun', 'BSVGUN', 'BSVGun', '4c01e6de8441295316c5c11e18631871cf4de99b90673bfe0e582f4e2115bc34_1'),
};

/** bRacer's own coin, once it exists: set NEXT_PUBLIC_TB_BRACER_COIN to its BSV-21 id. Undefined until then. */
export const BRACER_COIN: GameCoin | undefined = process.env.NEXT_PUBLIC_TB_BRACER_COIN ? coin('bracer', 'BRACER', 'bRacer', process.env.NEXT_PUBLIC_TB_BRACER_COIN) : undefined;

/** Home-turf perk for firing a game's own coin LIVE. */
export const HOUSE_GOLD = '#f5b800';
export const HOUSE_DMG = 1.5;

/** The wallet's tokens with the house coin first. */
export const houseFirst = <T extends { id: string }>(tokens: T[], house?: GameCoin) =>
  !house ? tokens : [...tokens.filter((t) => t.id === house.id), ...tokens.filter((t) => t.id !== house.id)];

/** Whole house coins the wallet holds (0 when it holds none). */
export const houseHeld = (tokens: { id: string; balance?: number }[], house?: GameCoin) =>
  !house ? 0 : Math.max(0, Math.floor(tokens.find((t) => t.id === house.id)?.balance ?? 0));
