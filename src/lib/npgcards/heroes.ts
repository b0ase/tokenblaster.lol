import { makeHero, type HeroInfo } from './engine';

/** Starter heroes: NPG girls from the sample cards, with the attributes printed on each card
 *  [strength, speed, skill, stamina, stealth, style ("sexiness" on the card)]. */
export const HERO_IMG_BASE = '/arcade/npg-cards/heroes/';
const RAW: [string, string, number[]][] = [
  ['card_0026_Miwako', 'Miwako', [4, 7, 4, 2, 7, 4]],
  ['card_0347_Tsuguri', 'Tsuguri', [3, 3, 4, 6, 19, 6]],
  ['card_0454_Junrei', 'Junrei', [2, 4, 5, 7, 8, 7]],
  ['card_0651_Atsuna', 'Atsuna', [6, 3, 4, 8, 5, 4]],
  ['card_0754_Aoki', 'Aoki', [6, 4, 5, 8, 3, 6]],
  ['card_0834_Yuzumi', 'Yuzumi', [4, 4, 5, 2, 6, 6]],
  ['card_1082_Mutsuka', 'Mutsuka', [4, 5, 4, 3, 2, 6]],
  ['card_1308_Miho', 'Miho', [3, 7, 2, 11, 13, 10]],
  ['card_1499_Mizue', 'Mizue', [5, 6, 2, 5, 8, 3]],
  ['card_1794_Kiyomi', 'Kiyomi', [5, 5, 5, 2, 7, 11]],
  ['card_1936_Ayu', 'Ayu', [10, 5, 0, 1, 8, 5]],
  ['card_2190_Marise', 'Marise', [7, 6, 2, 3, 4, 9]],
  ['card_2343_Makiho', 'Makiho', [6, 2, 4, 5, 0, 11]],
  ['card_2823_Kotoki', 'Kotoki', [4, 2, 1, 4, 5, 5]],
  ['card_3008_Aiki', 'Aiki', [3, 4, 3, 3, 6, 5]],
];
export const heroesFor = (base = HERO_IMG_BASE): HeroInfo[] => RAW.map(([id, name, s]) => makeHero(id, name, `${base}${id}.jpg`, s));
