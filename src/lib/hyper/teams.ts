/** Racing teams: one per chain-transaction kind, plus the house team, plus the family teams. Data in ./registry.ts. */
import type { TxKind } from '@/lib/feed';
import { RIVAL_PAINT } from '@/lib/rally/rivals';
import { ALL_TEAMS, BRACER_TEAMS, teamById, type Team } from './registry';

export type { Team };
/** The launch teams (transaction kinds + house). The full list, family included, is ALL_TEAMS. */
export const TEAMS: Team[] = [...BRACER_TEAMS];
export { ALL_TEAMS };
/** Any team by id (or alias), falling back to the house team. */
export const teamOf = (id: string | null | undefined): Team => (id ? teamById(id) : undefined) ?? TEAMS[0];

const KIND_TEAM: Record<TxKind, string> = { token: 'token', inscription: 'inscription', social: 'social', data: 'data', payment: 'payment', blast: 'house' };
export const teamOfKind = (k: TxKind): Team => TEAMS.find((t) => t.id === KIND_TEAM[k]) ?? TEAMS[0];

/** A sponsor decal across the nose. */
export type Decal = { text: string; bg: string; fg: string };
export type Livery = { base: string; accent: string; trim: string; ticker: string; number: string; team: string; logo: HTMLImageElement | null; decal?: Decal };
export const liveryOfKind = (k: TxKind) => {
  const [base, accent, trim] = RIVAL_PAINT[k];
  return { base, accent, trim };
};
