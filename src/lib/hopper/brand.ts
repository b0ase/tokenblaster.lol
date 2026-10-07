/** Block Hopper: names, per-kind colours and the few tuning numbers the shell and the engine share. */
import type { TxKind } from '@/lib/feed';

export const GAME_NAME = 'Block Hopper';
export const GAME_SLUG = 'hopper';
export const GAME_KANA = 'ブロック・ホッパー';
export const GAME_TAGLINE = 'Run the live chain';

/** What each transaction kind looks like as a platform (DR palette, bright on dark). */
export const KIND_STYLE: Record<TxKind | 'quiet' | 'block', { color: string; tag: string; name: string }> = {
  payment: { color: '#27e6ff', tag: 'PAY', name: 'Payment' },
  blast: { color: '#ffb800', tag: 'BLAST', name: 'TokenBlaster blast' },
  token: { color: '#c8ff1a', tag: 'TKN', name: 'Token transfer' },
  inscription: { color: '#e8261d', tag: 'INS', name: 'Inscription' },
  social: { color: '#ff2f92', tag: 'SOC', name: 'Social post' },
  data: { color: '#2a5bff', tag: 'DATA', name: 'Data (crumbles)' },
  quiet: { color: '#6b6b74', tag: 'QUIET', name: 'Mempool quiet' },
  block: { color: '#ffb800', tag: 'BLOCK', name: 'Block checkpoint' },
};

export type BlockInfo = { height: number; txCount: number; miner: string };
