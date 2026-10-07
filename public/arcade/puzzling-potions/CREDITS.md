# Token Potions (Puzzling Potions): credits and licence audit

Token Potions is a reskin of **Puzzling Potions**, an open-source PixiJS match-3.

- Upstream: https://github.com/pixijs/open-games/tree/main/puzzling-potions (commit 83b4676)
- Upstream licence: MIT, Copyright 2025 PixiJS. The upstream `LICENSE` is kept next to this file.
- Our changes (TokenBlaster.lol): new "Token Potions" logo and loading text, a postMessage bridge so the arcade page owns the coin slot and high-score board (games started from the page always run in Normal mode), replaced audio, Spine removed. The source diff is in `scripts/pixi-open-games/` in the TokenBlaster repo. Built with the upstream tooling (AssetPack + Vite).

## Per-file asset audit (done 7 Oct 2026)

The upstream README does not state an asset licence, and there is no per-file notice in the repository. Each asset was classified by what could be verified.

| Asset | Files | Finding | Action |
|---|---|---|---|
| Code (`src/`) | all | MIT, repository `LICENSE` | kept |
| Art atlases (`raw-assets/*/*-atlas`) | 47 PNGs: potion pieces, specials, shelves, buttons, icons, header, backgrounds, PixiJS logo | Authored for the project by PixiJS; shipped in a repository whose only licence is MIT (copyright PixiJS). No separate asset licence, no third-party attribution. | kept (judgement call, see below); the old "Puzzling Potions" logo is replaced by our own text logo drawn with Bungee (SIL OFL) |
| Spine rigs | `dragon-skeleton.{json,atlas,png}`, `cauldron-skeleton.{json,atlas,png}` | The art is PixiJS's, but playing it needs the Spine runtime (`@esotericsoftware/spine-pixi-v8`), whose licence requires each user to hold a paid Spine Editor licence. Not permissive. | **dropped**: the runtime is removed; the dragon is the static `character.png` sprite with a squash-and-stretch tween, the cauldron is a static sprite cropped from the rig's own cauldron art |
| Audio | 9 WAV sfx + `bgm-main.mp3`, `bgm-game.mp3` | No licence, author or provenance in the files or the repo. Not clearly permissive. | **replaced** with original synthesised sound and music (below) |
| Fonts | none shipped (system fonts) | n/a | n/a |

**Judgement call on the art:** it is kept under the repository's MIT licence because PixiJS is the sole author and nothing in the repo restricts it. If you want certainty, ask PixiJS to confirm that the images are MIT too, or swap them.

## Replacement audio

All eleven sounds are generated from scratch by `scripts/pixi-open-games/synth.py` (sine, square, triangle and noise maths plus a small chiptune sequencer), the two music tracks encoded to MP3 with ffmpeg/LAME. No third-party recordings or samples. Dedicated to the public domain (CC0 1.0).

## Runtime libraries (bundled in the JS)

- PixiJS (pixi.js), @pixi/ui, @pixi/sound: MIT
- GSAP (animation): GreenSock "Standard No Charge" licence. Free for commercial use, but it is not an OSI licence (it forbids using GSAP to build a competing visual-animation tool). Not replaced.
