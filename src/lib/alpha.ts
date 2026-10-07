/** A–Z by title, ignoring case ("bRacer" sits with the Bs), for every game list on the site (owner, 7 Oct 2026). */
export const byTitle = <T extends { title: string }>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base', numeric: true }));
