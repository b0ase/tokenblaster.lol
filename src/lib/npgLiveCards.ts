/**
 * The canonical NPG characters as live 3D cards (public/npg/cards/<slug>.glb + -card-bg.webp + -card-frame.webp).
 * `box` is the 2D girl's pixel box on the 961×1441 S3 card [left, top, right, bottom] (LiveCard fits the model to it).
 * `stats` are the six attributes printed on each card's frame:
 * [strength, speed, skill, stamina, stealth, style].
 */
export type CardBox = [number, number, number, number];
export type LiveCardInfo = { slug: string; name: string; box: CardBox; stats: number[]; rig?: boolean };

export const LIVE_CARDS: LiveCardInfo[] = [
  { slug: 'phi-phi', name: 'Phi-Phi', box: [44, 157, 922, 1164], stats: [8, 10, 9, 7, 8, 14], rig: true },
  { slug: 'hikaru', name: 'Hikaru', box: [182, 351, 828, 1164], stats: [9, 9, 7, 9, 9, 6], rig: true },
  { slug: 'joy', name: 'Joy', box: [236, 385, 719, 1167], stats: [8, 10, 10, 9, 10, 8] },
  { slug: 'yamarashii', name: 'Yamarashii', box: [203, 191, 758, 1165], stats: [11, 4, 13, 8, 8, 12], rig: true },
  { slug: 'miyuki', name: 'Miyuki', box: [38, 315, 923, 1168], stats: [11, 13, 10, 11, 9, 11], rig: true },
  { slug: 'payne', name: 'Payne', box: [110, 246, 848, 1169], stats: [9, 9, 10, 10, 13, 11], rig: true },
  { slug: 'peggy', name: 'Peggy', box: [218, 402, 857, 1162], stats: [7, 11, 12, 9, 10, 10], rig: true },
  { slug: 'scarlet', name: 'Scarlet', box: [208, 355, 754, 1167], stats: [9, 7, 9, 9, 9, 13], rig: true },
  { slug: 'matoko', name: 'Matoko', box: [118, 438, 848, 1157], stats: [9, 8, 4, 11, 10, 10], rig: true },
  { slug: 'ayumi', name: 'Ayumi', box: [147, 337, 829, 1163], stats: [13, 12, 13, 19, 12, 12], rig: true },
  { slug: 'kimiko', name: 'Kimiko', box: [279, 414, 710, 1160], stats: [5, 6, 13, 13, 10, 7], rig: true },
  { slug: 'kazuyo', name: 'Kazuyo', box: [204, 242, 763, 1177], stats: [7, 7, 9, 6, 10, 8], rig: true },
  { slug: 'nao', name: 'Nao', box: [46, 380, 916, 1171], stats: [8, 5, 9, 13, 12, 12], rig: true },
  { slug: 'aika', name: 'Aika', box: [243, 341, 906, 1163], stats: [7, 8, 8, 10, 8, 9], rig: true },
  { slug: 'doctor', name: 'Doctor', box: [249, 389, 706, 1161], stats: [5, 11, 9, 15, 7, 10], rig: true },
  // Generic Erobots: the five bot bodies in the sample Erobot outfit (the game's grunts)
  { slug: 'bot', name: 'Bot', box: [262, 449, 681, 1158], stats: [5, 4, 7, 12, 13, 5], rig: true },
  { slug: 'tech', name: 'Tech', box: [262, 450, 680, 1155], stats: [6, 6, 6, 13, 12, 6], rig: true },
  { slug: 'graf-bot', name: 'Graf-Bot', box: [262, 438, 680, 1155], stats: [7, 5, 5, 13, 12, 6], rig: true },
  { slug: 'frog-bot', name: 'Frog-Bot', box: [262, 450, 680, 1155], stats: [5, 5, 7, 14, 11, 5], rig: true },
  { slug: 'stripey-bot', name: 'Stripey-Bot', box: [262, 449, 680, 1154], stats: [5, 5, 5, 13, 13, 5], rig: true },
];

export const liveCardBase = (slug: string) => `/npg/cards/${slug}`;
export const liveCardBySlug = (slug: string) => LIVE_CARDS.find((c) => c.slug === slug) ?? null;
