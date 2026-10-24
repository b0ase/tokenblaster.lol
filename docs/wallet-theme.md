# bWalletX site theme for tokenblaster.lol

The wallet dresses its approval sheets in a connected site's look (spec: bwalletX repo, `docs/SITE-THEME.md` on
branch `bwallet`). tokenblaster.lol serves:

| File | What |
| --- | --- |
| `public/.well-known/bwalletx-theme.json` | The site theme: "TokenBlaster", red on ink (the SIGNAL palette in `src/app/globals.css`) |
| `public/brand/wallet-logo.png` | Logo (the site icon, 13 KB) |
| `public/brand/wallet-card.jpg` | Card art (the arcade OG image, 140 KB) |
| `public/.well-known/bwalletx-theme.assault.json` | Proposed sub-theme for ASSAULT ON TERRORNODE (below) |
| `public/brand/assault-logo.svg`, `public/brand/assault-card.jpg` | Its logo and card art |

`next.config.ts` serves both theme files and `/brand/*` with `Access-Control-Allow-Origin: *`.
`src/lib/walletTheme.test.ts` checks the rules: keys, `#RRGGBB`, file ≤ 8 KB, logo ≤ 64 KB, card art ≤ 256 KB,
text ≥ 4.5:1 on bg and surface, accent ≥ 3:1 on bg.

| Theme | bg | surface | text | accent | accentHi | text/bg | text/surface | accent/bg |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TokenBlaster | `#0A0A0C` | `#121317` | `#F2EFE6` | `#FF3B30` | `#FFB800` | 17.20 | 16.15 | 5.58 |
| Assault on Terrornode | `#05090F` | `#0A121C` | `#E8F1F6` | `#FF3B3B` | `#3FD8E8` | 17.43 | 16.43 | 5.64 |

The Assault colours are the game's TBX tokens (`src/components/coinop/ui.css`): Neo-Tokyo night ink, one red
accent, teal as the highlight.

## Proposal for the wallet team: per-path sub-themes

Today the wallet keeps one theme per origin, so every page on tokenblaster.lol (including /arcade/assault) gets
the TokenBlaster theme. The game has its own look, and the pay sheet you see mid-game would read better in it.

Proposed: an optional `paths` map in the v2 file. Each key is a path prefix on the same origin; each value is a
same-origin path to another v2 theme file that follows every existing rule.

```json
{
  "v": 2,
  "name": "TokenBlaster",
  "mode": "dark",
  "accent": "#FF3B30",
  "bg": "#0A0A0C",
  "surface": "#121317",
  "text": "#F2EFE6",
  "logo": "/brand/wallet-logo.png",
  "paths": { "/arcade/assault": "/.well-known/bwalletx-theme.assault.json" }
}
```

How the wallet would use it:

1. Fetch the origin's theme as now. If it has `paths`, validate it: at most 8 entries, keys start with `/` and
   carry no query, `#` or `..`, values are same-origin paths under `/.well-known/` ending in `.json`.
2. When a request comes in, take the page path the wallet already knows (extension: the sender tab's URL; in-app
   browser: the current URL). Pick the longest key that is a prefix of that path on a `/` boundary, so
   `/arcade/assault` matches `/arcade/assault/play` but not `/arcade/assaulted`.
3. Fetch, validate and cache that sub-theme exactly like a root theme (same caps, timeout, contrast checks,
   image rules). If it fails, fall back to the root theme, never to no theme.
4. Where the wallet only knows the origin (BRC-100 originators carry no path, paired sessions), use the root
   theme. A sub-theme is cosmetic and never changes the host shown in the wallet's own strip.

Until the wallet supports it, the extra key must not be shipped in the live root file (the spec says "no other
keys", so today's wallet would refuse the whole theme). That is why `bwalletx-theme.json` has no `paths` yet and
the Assault theme sits beside it as a ready-to-use file.
