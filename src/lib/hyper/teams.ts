/** Racing teams: one per chain-transaction kind, plus the house team. Big flat colours, chevrons, a code. */
import type { TxKind } from '@/lib/feed';
import { RIVAL_PAINT } from '@/lib/rally/rivals';

export type Team = { id: string; name: string; kana: string; code: string; base: string; accent: string; trim: string; motto: string };

export const TEAMS: Team[] = [
  { id: 'house', name: 'TOKENBLASTER', kana: 'トークンブラスター', code: 'TB-01', base: '#e8261d', accent: '#ffffff', trim: '#111111', motto: 'BLAST MORE' },
  { id: 'token', name: 'TOKEN GUILD', kana: 'トークンギルド', code: 'TG-07', base: '#101015', accent: '#e8b53a', trim: '#ffffff', motto: 'HOLD NOTHING' },
  { id: 'inscription', name: 'ORDINAL ORDER', kana: 'オーディナル', code: 'OO-21', base: '#f2f2ee', accent: '#c4161c', trim: '#101010', motto: 'ETCHED FOREVER' },
  { id: 'payment', name: 'MERCHANT CORP', kana: 'マーチャント', code: 'MC-05', base: '#1f8f4a', accent: '#f4efe2', trim: '#101010', motto: 'BUY NOW' },
  { id: 'data', name: 'DATASTREAM', kana: 'データストリーム', code: 'DS-64', base: '#2a5bff', accent: '#ff5a48', trim: '#e8e8e8', motto: 'ALWAYS ON' },
  { id: 'social', name: 'SIGNAL FM', kana: 'シグナル', code: 'SF-99', base: '#d33d8c', accent: '#fff2f8', trim: '#2a0a1a', motto: 'TURN IT UP' },
];

const KIND_TEAM: Record<TxKind, string> = { token: 'token', inscription: 'inscription', social: 'social', data: 'data', payment: 'payment', blast: 'house' };
export const teamOfKind = (k: TxKind): Team => TEAMS.find((t) => t.id === KIND_TEAM[k]) ?? TEAMS[0];

export type Livery = { base: string; accent: string; trim: string; ticker: string; number: string; team: string; logo: HTMLImageElement | null };
export const liveryOfKind = (k: TxKind) => {
  const [base, accent, trim] = RIVAL_PAINT[k];
  return { base, accent, trim };
};

/**
 * NPG Racing (the Ninja Punk Girls skin): the player's side is Ninja Punk Girls, the rivals are the evil Erobots.
 * `trim` doubles as the graffiti-tag colour and is always pure white or black: the NPG tag is never tinted.
 */
export const NPG_TEAMS: Team[] = [
  { id: 'npg-pink', name: 'NPG PINK', kana: 'ニンジャパンク', code: 'NPG-01', base: '#ff2d95', accent: '#22e6ff', trim: '#ffffff', motto: 'PUNK NEVER DIES' },
  { id: 'npg-cyan', name: 'NPG CYAN', kana: 'ニンジャパンク', code: 'NPG-02', base: '#22e6ff', accent: '#ff2d95', trim: '#111111', motto: 'BLADE AND BASS' },
  { id: 'npg-noir', name: 'NPG NOIR', kana: 'ニンジャパンク', code: 'NPG-03', base: '#111111', accent: '#ff2d95', trim: '#ffffff', motto: 'SILENT AND LOUD' },
  { id: 'npg-blanc', name: 'NPG BLANC', kana: 'ニンジャパンク', code: 'NPG-04', base: '#f4f4f4', accent: '#ff2d95', trim: '#111111', motto: 'CLEAN KILLS' },
];
export const EROBOT_TEAMS: Team[] = [
  { id: 'erobot-red', name: 'EROBOTS', kana: 'エロボット', code: 'ERO-66', base: '#9aa0a8', accent: '#e8261d', trim: '#111111', motto: 'OBEY THE CIRCUIT' },
  { id: 'erobot-iron', name: 'EROBOTS', kana: 'エロボット', code: 'ERO-13', base: '#3a3d44', accent: '#ff3b2a', trim: '#ffffff', motto: 'RESISTANCE IS SCRAP' },
];
/** Every team any skin can field (multiplayer looks up a remote player's team here). */
export const ALL_TEAMS: Team[] = [...TEAMS, ...NPG_TEAMS, ...EROBOT_TEAMS];
export const isNpgTeam = (id: string) => id.startsWith('npg-');
export const isErobotTeam = (id: string) => id.startsWith('erobot-');
