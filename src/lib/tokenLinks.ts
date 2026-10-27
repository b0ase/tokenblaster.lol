/**
 * Where a token link goes. Our own coins open on tokenblaster.lol (BlastPad coins at /launch/<id>, other
 * b0ase tokens at /token/<id>); 1sat.market has no data for pools on our own curve. Anything else keeps
 * its 1Sat market link.
 */
import { GAME_COINS } from './gameCoins';
import { OUR_TOKENS } from './ourTokens';

const BLASTPAD = new Set<string>(Object.values(GAME_COINS).map((c) => c.id));
const OTHER = new Set(OUR_TOKENS.map((t) => t.id));

/** Teach the module the live BlastPad board (coins launched after this build). */
export function learnBlastpad(ids: Iterable<string>) {
  for (const id of ids) BLASTPAD.add(id);
}

let loading: Promise<void> | null = null;
/** Browser only: fetch the board once so new coins link home too. */
export function loadBlastpadIds(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  loading ??= fetch('/api/launch/coins')
    .then((r) => r.json())
    .then((d: { coins?: { token_id?: string }[] }) => learnBlastpad((d.coins ?? []).map((c) => c.token_id ?? '').filter(Boolean)))
    .catch(() => {});
  return loading;
}

export function tokenHref(id: string): { href: string; external: boolean } {
  void loadBlastpadIds();
  if (BLASTPAD.has(id)) return { href: `/launch/${id}`, external: false };
  if (OTHER.has(id)) return { href: `/token/${id}`, external: false };
  return { href: /_\d+$/.test(id) ? `https://1sat.market/market/bsv21/${id}` : `https://1sat.market/market/bsv20/${id}`, external: true };
}

export const linkProps = (id: string) => {
  const { href, external } = tokenHref(id);
  return external ? { href, target: '_blank', rel: 'noopener noreferrer' } : { href };
};
