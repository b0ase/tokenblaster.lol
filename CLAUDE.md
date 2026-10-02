@AGENTS.md

## Project notes

TokenBlaster.lol: one site for live BSV chain visuals/games (our take on bsv.lol) and the token-blasting
competition (TeraGun / TXBlaster style). See README.md for routes and the roadmap.

- pnpm only. Next.js 16 App Router, Tailwind 4, @bsv/sdk.
- Never put private keys in code or committed files. The blaster reads BLASTER_WIF from the environment.
- No entry fees or prize pools (gambling rules, App Store): free entry, bragging rights.
