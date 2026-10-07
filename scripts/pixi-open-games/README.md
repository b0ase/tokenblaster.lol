# PixiJS open games: how Coin Pop and Token Potions were built

Both games are static builds of https://github.com/pixijs/open-games (MIT, commit 83b4676) served from
`public/arcade/bubbo-bubbo/` and `public/arcade/puzzling-potions/`. Licence audit: see each folder's `CREDITS.md`.

To rebuild (outside this repo; the games use their own npm-era tooling, run here with pnpm):

1. Clone upstream, copy `bubbo-bubbo` / `puzzling-potions` to a scratch dir, `pnpm install`.
2. `patch -p0` / apply `bubbo-bubbo.patch` or `puzzling-potions.patch` (source changes only: tb.ts bridge, text, gating, Spine removal).
3. Binary assets (not in the patches):
   - `synth.py <bubbo|potions> <raw-assets audio dir>`: writes the original CC0 sfx and music (bubbo: rename `_bgm.wav` to `bubbo-bubbo-bg-music.wav`).
   - `coins.py`: draws the B / $ / X / T glyphs onto Bubbo's four bubble sprites.
   - `logo.py`: draws the Token Potions logo.
   - Potions: delete the Spine rig files (`*-skeleton.*`) and add `cauldron.png` (crop `106x91+2+2` from the old `cauldron-skeleton.png`) to the preload atlas.
   - These scripts have the scratch paths they were run with hard-coded; edit them first.
4. `pnpm exec assetpack`, then `pnpm exec vite build --base ./` (bubbo) / `pnpm exec vite build` (potions; its config already has `base: './'`).
5. Copy `dist/` over the matching `public/arcade/<slug>/` (keep `LICENSE`, `CREDITS.md`, `OFL.txt`).

The page side is `src/components/PixiOpenGame.tsx`: it owns the coin slot and score board and talks to the game over same-origin postMessage (`tb: 'start'` in; `tb: 'ready' | 'gameover' | 'menu'` out).
