# Coin Pop (Bubbo Bubbo): credits and licence audit

Coin Pop is a reskin of **Bubbo Bubbo**, an open-source PixiJS bubble shooter.

- Upstream: https://github.com/pixijs/open-games/tree/main/bubbo-bubbo (commit 83b4676, author AshsHub)
- Upstream licence: MIT, Copyright 2025 PixiJS. The upstream `LICENSE` is kept next to this file.
- Our changes (TokenBlaster.lol): token-coin bubbles, new title text, a postMessage bridge so the arcade page owns the coin slot and high-score board, replaced audio. The source diff is in `scripts/pixi-open-games/` in the TokenBlaster repo. Built with the upstream tooling (AssetPack + Vite).

## Per-file asset audit (done 7 Oct 2026)

The upstream README does not state an asset licence, and there is no per-file notice in the repository. Each asset was classified by what could be verified.

| Asset | Files | Finding | Action |
|---|---|---|---|
| Code (`src/`) | all | MIT, repository `LICENSE` | kept |
| Art (`raw-assets/images/`) | 45 PNGs: bubbles, cannon, trays, panels, buttons, icons, backgrounds, PixiJS logo | Authored for the project by PixiJS; shipped in a repository whose only licence is MIT (copyright PixiJS). No separate asset licence, no third-party attribution. The README's "cannot use the assets" note is about the read-only Figma design file only. | kept (judgement call, see below); the 4 bubble sprites were redrawn as token coins; the PixiJS logo is kept as the credit |
| Font `Bungee-Regular.ttf` | 1 | SIL OFL 1.1, stated inside the font (name table ID 13). Copyright 2008 The Bungee Project Authors. | kept, `OFL.txt` |
| Font `OpenSans-SemiBold.ttf` | 1 | SIL OFL 1.1, stated inside the font. Copyright 2020 The Open Sans Project Authors. | kept, `OFL.txt` |
| Audio (`raw-assets/audio/`) | 9 WAVs (sfx x8, 1 music loop, 4.6 MB) | No licence, author or provenance in the files or the repo (no tags, no credits). Not clearly permissive. | **replaced** with original synthesised sound and music (below) |

**Judgement call on the art:** it is kept under the repository's MIT licence because PixiJS is the sole author and nothing in the repo restricts it. If you want certainty, ask PixiJS to confirm that the images are MIT too, or swap them.

## Replacement audio

All nine sounds are generated from scratch by `scripts/pixi-open-games/synth.py` (sine, square, triangle and noise maths plus a small chiptune sequencer). No third-party recordings or samples. Dedicated to the public domain (CC0 1.0).

## Runtime libraries (bundled in the JS)

- PixiJS (pixi.js), @pixi/ui, @pixi/sound, pixi-filters, typed-signals: MIT
- GSAP (animation): GreenSock "Standard No Charge" licence. Free for commercial use, but it is not an OSI licence (it forbids using GSAP to build a competing visual-animation tool). Not replaced.
