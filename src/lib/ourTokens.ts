/**
 * b0ase-portfolio BSV-20/21 tokens that are NOT BlastPad coins, shown read-only at /token/<outpoint>.
 * Only tokens whose deploy outpoint is verified on GorillaPool (ordinals.gorillapool.io/api/bsv20/id/<id>)
 * and found in our own repos are listed; `source` says where the id came from. Never add a guessed id.
 */
export type OurToken = {
  id: string;
  /** Ticker exactly as inscribed on chain. */
  sym: string;
  /** Short-link names: /token/<alias> (case-insensitive). */
  aliases: string[];
  name: string;
  project: { name: string; url: string };
  blurb: string;
  /** Repo file the id was taken from. */
  source: string;
  legacy?: boolean;
};

export const OUR_TOKENS: OurToken[] = [
  {
    id: 'c3bf2d7a4519ddc633bc91bbfd1022db1a77da71e16bb582b0acc0d8f7836161_1',
    sym: '$BOASE',
    aliases: ['BOASE'],
    name: 'b0ase studio token',
    project: { name: 'b0ase.com', url: 'https://b0ase.com' },
    blurb: 'The master studio token for the b0ase portfolio.',
    source: 'b0ase.com/lib/treasury.ts',
  },
  {
    id: 'b8747a4b356875cc90842c733ad2770b12bf50c17cf204afd0605f9dcba67d31_1',
    sym: '$NINJAPUNKGIRLS',
    aliases: ['NPG', 'NINJAPUNKGIRLS'],
    name: 'Ninja Punk Girls ($NPG)',
    project: { name: 'Ninja Punk Girls', url: 'https://www.ninjapunkgirls.com' },
    blurb: 'The $NPG token, 1:1 with the NPG Ltd share structure.',
    source: 'ninja-punk-girls-com/src/lib/services/tokenSupplyVerifier.ts',
  },
  {
    id: '294691e2069ce8f6b9a1afd1022c6d32f8b30cb24c07b6584385bd6066e95502_0',
    sym: '402',
    aliases: ['402', 'HTM'],
    name: '$402 Protocol Token (HTM)',
    project: { name: 'PATH402.com', url: 'https://path402.com' },
    blurb: 'PoW20 hash-to-mint token for the $402 network: 21M supply, 100% mined, 0% pre-mine.',
    source: 'path402-com/lib/types.ts, b0ase.com/docs/TOKEN_ARCHITECTURE.md',
  },
  {
    id: '17ee7fcc9c5764dc9983af912e044da8d11f26db17a5f68a0757a250db5cf983_0',
    sym: 'KWEG',
    aliases: ['KWEG'],
    name: 'KWEGWONG',
    project: { name: 'KWEGWONG.com', url: 'https://kwegwong.com' },
    blurb: 'The $KWEG token of KWEGWONG.',
    source: 'kwegwong/src/app/api/path402/device-purchase/route.ts',
  },
  {
    id: '936a9effd2fc85c47ab205cab1ae94a5d1888f8349429ac1e2c769e1e0ba5572_0',
    sym: 'MONEYBUTTON',
    aliases: ['MONEYBUTTON'],
    name: 'MoneyButton',
    project: { name: 'MoneyButton', url: 'https://moneybutton2.vercel.app' },
    blurb: 'The $MONEYBUTTON token.',
    source: 'moneybutton2/app/token/moneybutton/page.tsx',
  },
  {
    id: 'fa6cf4066dadfd9e9d64dcd1f86edbf5bb4a31ce4a1e6ba4c0f889c509f5fa34_1',
    sym: '1FeeX',
    aliases: ['1FEEX'],
    name: '1FeeX',
    project: { name: 'b0ase.com/1feex', url: 'https://b0ase.com/1feex' },
    blurb: 'The 1FeeX token: 21M supply.',
    source: 'b0ase.com/app/1feex/page.tsx',
  },
  {
    id: '5bf47d3af709a385d3a50a298faa18f9479b090114a69ce8308055861d20e18d_1',
    sym: 'PATH402.com',
    aliases: ['PATH402.COM', 'PATH402'],
    name: '$PATH402 (legacy)',
    project: { name: 'PATH402.com', url: 'https://path402.com' },
    blurb: 'The original $PATH402 token, replaced by $402. Kept for reference.',
    source: 'path402-com/lib/types.ts (TOKEN_CONFIG.legacy)',
    legacy: true,
  },
];

const key = (s: string) => s.trim().replace(/^\$/, '').toUpperCase();

export const ourTokenById = (id: string) => OUR_TOKENS.find((t) => t.id === id) ?? null;

/** /token/NPG, /token/$boase, /token/htm → the token. */
export function ourTokenByTicker(raw: string): OurToken | null {
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  const k = key(s);
  return OUR_TOKENS.find((t) => key(t.sym) === k || t.aliases.some((a) => key(a) === k)) ?? null;
}
