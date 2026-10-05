@AGENTS.md

## Project notes

TokenBlaster.lol: one site for live BSV chain visuals/games (our take on bsv.lol) and the token-blasting
competition (TeraGun / TXBlaster style). See README.md for routes and the roadmap.

- pnpm only. Next.js 16 App Router, Tailwind 4, @bsv/sdk.
- Never put private keys in code or committed files. The blaster reads BLASTER_WIF from the environment.
- Fees are normal: this is BSV, every action is a real transaction and the player pays its network fee. Games may charge per action (e.g. Chain Frogger: 1 sat per hop/shot to the house address in NEXT_PUBLIC_TB_HOUSE_ADDRESS). Not an App Store app; don't add "free entry / no fees / bragging rights" wording.
